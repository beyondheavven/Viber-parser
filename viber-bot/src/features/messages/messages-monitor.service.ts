import { Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openDevice, type DeviceContext } from '../../platform/context.js';
import { int, loadViberConfig } from '../../config/env.js';
import { DeviceMutexService } from '../../platform/mutex/device-mutex.service.js';
import { ViberLifecycleService } from '../../platform/viber-lifecycle.service.js';
import { extractEmKey } from '../../viber/em-key.js';
import { selectList, type Sqlite } from '../../platform/sqlite.js';
import {
  PARTICIPANT_INFO_COLUMNS,
  PARTICIPANT_INFO_EXPRS,
  toRawParticipantInfo,
} from '../../viber/participants-sql.js';
import { extractPhones, normalizePhoneNumber } from './phone-extractor.util.js';
import { ContactEnrichmentService } from './contact-enrichment.service.js';
import { mergeMediaWithText, normalizeStoredMedia, type MediaMergedMessage } from './message-media.util.js';
import { formatMonitoredExport, type MonitorExportFormat } from './monitor-export.util.js';
import { MessageWatchService, shouldIngestMessageWrite, type MessageDbWrite } from './message-watch.service.js';
import type { ExportMonitoredMessagesDto, MonitoredMessageDto, MonitoredMessagesFilterDto, PhoneSource } from './dto/monitored-message.dto.js';
import type { EnableMonitorGroupDto, MonitorStatusDto, MonitoredGroupDto, StartMonitorDto } from './dto/monitor-control.dto.js';
import type { Message } from '../../viber/repository.js';
import { RabbitMqPublisher } from '../../rabbitmq/rabbitmq-publisher.service.js';

const MAX_RING_BUFFER_SIZE = 2000;
const CATCH_UP_BATCH_SIZE = 200;
const LIVE_INGEST_DELAY_MS = 80;
const LIVE_CATCHUP_MS = 8_000;
const DEVICE_RETRY_MS = 5_000;
const LIVE_WRITE_TIMEOUT_MS = 5_000;
const CONTACT_REFRESH_MS = 5_000;
const CONTACT_WRITES_PER_REFRESH = 5;
const DEFAULT_CONTACT_SYNC_BATCH_MS = 3_000;
const DEFAULT_CONTACT_SYNC_MIN_RESTART_MS = 300_000;

interface TrackedGroup {
  conversationId: number;
  viberGroupId: string | null;
  name: string | null;
  enabled: boolean;
  lastMessageId: number;
  lastServerMessageId?: number | undefined;
}

interface PersistedMonitorState {
  isRunning: boolean;
  pollIntervalMs: number;
  groups: TrackedGroup[];
}

@Injectable()
export class MessagesMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagesMonitorService.name);
  private readonly instanceId = process.env['VIBER_INSTANCE_ID']?.trim() || 'default';

  private isRunning = false;
  private pollIntervalMs = 2500;
  private processedMessagesCount = 0;
  private phonesFromTextCount = 0;
  private phonesFromViberCount = 0;
  private lastPollAt: Date | null = null;
  private pollTimeout: NodeJS.Timeout | null = null;
  private isPolling = false;
  private pendingImmediate = false;
  private deviceContext: DeviceContext | null = null;
  private deviceContextPromise: Promise<DeviceContext> | null = null;
  private deviceUnreachable = false;
  private unreachableUntil = 0;
  private resumeOnInit = false;
  private lastContactRefreshAt = 0;
  private contactSyncRestartTimer: NodeJS.Timeout | null = null;
  private contactSyncRestartRunning = false;
  private lastContactSyncRestartAt = 0;
  private lastLiveWatchAttemptAt = 0;
  private readonly disableFridaWatch =
    process.env['MONITOR_DISABLE_FRIDA_WATCH'] === 'true';
  private readonly contactSyncBatchMs = Math.max(
    500,
    int('MONITOR_CONTACT_SYNC_BATCH_MS', DEFAULT_CONTACT_SYNC_BATCH_MS),
  );
  private readonly contactSyncMinRestartMs = Math.max(
    this.contactSyncBatchMs,
    int('MONITOR_CONTACT_SYNC_MIN_RESTART_MS', DEFAULT_CONTACT_SYNC_MIN_RESTART_MS),
  );

  private readonly groups = new Map<number, TrackedGroup>();
  private readonly heldMessages: Message[] = [];
  private readonly recordedKeys = new Set<string>();
  private readonly updatedParticipantTargets = new Set<number | string>();
  private readonly writingParticipantTargets = new Set<number | string>();
  private readonly pendingContactSyncTargets = new Set<number | string>();
  private readonly pendingParticipantUpdates = new Map<number | string, string>();
  private participantWriteQueue: Promise<void> = Promise.resolve();

  private readonly ringBuffer: MonitoredMessageDto[] = [];
  private readonly dataDir: string;
  private readonly storePath: string;
  private readonly statePath: string;
  private readonly exportDir: string;

  constructor(
    @Optional()
    @Inject(MessageWatchService)
    private readonly messageWatch: MessageWatchService | undefined,
    @Inject(RabbitMqPublisher) private readonly publisher: RabbitMqPublisher,
    @Optional()
    @Inject(ContactEnrichmentService)
    private readonly contactEnrichment?: ContactEnrichmentService,
    @Optional() @Inject(DeviceMutexService) private readonly deviceMutex?: DeviceMutexService,
    @Optional() @Inject(ViberLifecycleService) private readonly viberLifecycle?: ViberLifecycleService,
  ) {
    this.dataDir = process.env['MONITOR_DATA_DIR'] ?? join(process.cwd(), 'data');
    this.storePath = join(this.dataDir, 'monitored-messages.jsonl');
    this.statePath = join(this.dataDir, 'monitor-state.json');
    this.exportDir = join(this.dataDir, 'exports');
    this.ensureDirectory(this.dataDir);
    this.loadState();
    this.loadHistoryFromStore();
  }

  onModuleInit(): void {
    this.contactEnrichment?.warmup(this.dataDir);
    this.enrichAndPersistBuffer();
    if (this.resumeOnInit) {
      this.logger.log('Resuming group message monitoring from persisted state.');
      this.beginPolling(100);
    }
  }

  onModuleDestroy(): void {
    this.stop();
  }

  private async getDeviceContext(): Promise<DeviceContext> {
    if (this.deviceContext) return this.deviceContext;
    if (this.deviceContextPromise) return this.deviceContextPromise;
    this.deviceContextPromise = openDevice({ ensureUp: false })
      .then((ctx) => {
        this.deviceContext = ctx;
        return ctx;
      })
      .finally(() => {
        this.deviceContextPromise = null;
      });
    return this.deviceContextPromise;
  }

  async start(dto: StartMonitorDto = {}): Promise<MonitorStatusDto> {
    if (dto.pollIntervalMs !== undefined && dto.pollIntervalMs >= 500) {
      this.pollIntervalMs = dto.pollIntervalMs;
    }

    if (dto.conversationId !== undefined && dto.conversationId !== null) {
      const enableOptions: EnableMonitorGroupDto & { startFromId?: number } = {};
      if (dto.fromLatest !== undefined) enableOptions.fromLatest = dto.fromLatest;
      if (dto.startFromId !== undefined) enableOptions.startFromId = dto.startFromId;
      await this.enableGroup(dto.conversationId, enableOptions);
      return this.getStatus();
    }

    this.persistState();
    this.beginPolling(100);
    this.logger.log(
      `Started group message monitoring (${String(this.enabledGroups().length)} enabled groups, pollInterval: ${String(this.pollIntervalMs)}ms)`,
    );
    return this.getStatus();
  }

  stop(): MonitorStatusDto {
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    if (this.contactSyncRestartTimer) {
      clearTimeout(this.contactSyncRestartTimer);
      this.contactSyncRestartTimer = null;
    }
    this.isRunning = false;
    this.pendingImmediate = false;
    this.deviceContext = null;
    this.messageWatch?.setHandler(null);
    void this.messageWatch?.detach();
    this.persistState();
    this.logger.log('Stopped incoming message monitoring.');
    return this.getStatus();
  }

  async enableGroup(
    conversationId: number,
    dto: EnableMonitorGroupDto & { startFromId?: number } = {},
  ): Promise<MonitorStatusDto> {
    let name: string | null = this.groups.get(conversationId)?.name ?? null;
    let viberGroupId: string | null = this.groups.get(conversationId)?.viberGroupId ?? null;
    let currentLastMessageId = 0;
    let currentLastServerMessageId = 0;
    try {
      const { viber } = await this.getDeviceContext();
      const group =
        viber.findGroup(String(conversationId)) ??
        viber.conversations().find((item) => item.id === conversationId);
      if (group === undefined) {
        throw new NotFoundException(`Группа/беседа с ID ${String(conversationId)} не найдена`);
      }
      name = group.name;
      viberGroupId = group.groupId;
      currentLastMessageId = viber.lastMessageId(conversationId);
      currentLastServerMessageId = viber.lastServerMessageId?.(conversationId) ?? 0;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.warn(
        `Could not resolve group ${String(conversationId)} on device, enabling with saved cursor: ${String(error)}`,
      );
      this.deviceContext = null;
    }

    const tracked: {
      name: string | null;
      viberGroupId: string | null;
      currentLastMessageId: number;
      currentLastServerMessageId: number;
      fromLatest?: boolean;
      startFromId?: number;
    } = { name, viberGroupId, currentLastMessageId, currentLastServerMessageId };
    if (dto.fromLatest !== undefined) tracked.fromLatest = dto.fromLatest;
    if (dto.startFromId !== undefined) tracked.startFromId = dto.startFromId;
    this.enableTrackedGroup(conversationId, tracked);
    this.beginPolling(100);
    this.logger.log(`Enabled monitoring for group ${String(conversationId)} (${name ?? 'unnamed'})`);
    return this.getStatus();
  }

  disableGroup(conversationId: number): MonitorStatusDto {
    const existing = this.groups.get(conversationId);
    if (existing === undefined) {
      throw new NotFoundException(`Группа ${String(conversationId)} не стоит на мониторинге`);
    }
    existing.enabled = false;
    this.persistState();
    this.logger.log(`Disabled monitoring for group ${String(conversationId)}`);
    return this.getStatus();
  }

  getGroups(): MonitoredGroupDto[] {
    return this.listGroups();
  }

  enableTrackedGroup(
    conversationId: number,
    options: {
      name?: string | null;
      viberGroupId?: string | null;
      currentLastMessageId?: number;
      currentLastServerMessageId?: number;
      fromLatest?: boolean;
      startFromId?: number;
    } = {},
  ): MonitorStatusDto {
    const existing = this.groups.get(conversationId);
    const currentLast = options.currentLastMessageId ?? existing?.lastMessageId ?? 0;
    const currentServerLast = options.currentLastServerMessageId ?? existing?.lastServerMessageId ?? 0;
    let lastMessageId = existing?.lastMessageId ?? 0;
    let lastServerMessageId = existing?.lastServerMessageId ?? 0;
    if (options.startFromId !== undefined) {
      lastMessageId = options.startFromId;
    } else if (options.fromLatest === false) {
      lastMessageId = existing?.lastMessageId ?? 0;
      lastServerMessageId = existing?.lastServerMessageId ?? 0;
    } else if (options.fromLatest === true || existing === undefined) {
      lastMessageId = currentLast;
      lastServerMessageId = currentServerLast;
    }

    this.groups.set(conversationId, {
      conversationId,
      viberGroupId: options.viberGroupId ?? existing?.viberGroupId ?? null,
      name: options.name ?? existing?.name ?? null,
      enabled: true,
      lastMessageId,
      lastServerMessageId,
    });
    this.persistState();
    return this.getStatus();
  }

  getStatus(): MonitorStatusDto {
    const groups = this.listGroups();
    const enabled = groups.filter((group) => group.enabled);
    return {
      deviceId: this.instanceId,
      isRunning: this.isRunning,
      conversationId: enabled.length === 1 ? enabled[0]!.conversationId : null,
      groups,
      pollIntervalMs: this.pollIntervalMs,
      lastPollAt: this.lastPollAt ? this.lastPollAt.toISOString() : null,
      lastProcessedMessageId: this.maxCursor(),
      liveWatch: this.messageWatch?.isAttached() === true,
      processedMessagesCount: this.processedMessagesCount,
      phonesFromTextCount: this.phonesFromTextCount,
      phonesFromViberCount: this.phonesFromViberCount,
    };
  }

  getMonitoredMessages(filter: MonitoredMessagesFilterDto = {}): MonitoredMessageDto[] {
    this.enrichAndPersistBuffer();
    const filtered = this.filterMessages(this.ringBuffer, filter);
    const unlimited = filter.limit === 0;
    const limit = unlimited ? filtered.length : filter.limit && filter.limit > 0 ? filter.limit : 50;
    return filtered.slice(0, limit);
  }

  exportMessages(filter: ExportMonitoredMessagesDto = {}): { filename: string; mime: string; body: string; savedPath: string } {
    const format: MonitorExportFormat = filter.format ?? 'json';
    const exportFilter: MonitoredMessagesFilterDto = { ...filter, limit: filter.limit ?? 0 };
    const messages = this.getMonitoredMessages(exportFilter);
    const result = formatMonitoredExport(messages, format);
    this.ensureDirectory(this.exportDir);
    const savedPath = join(this.exportDir, result.filename);
    writeFileSync(savedPath, result.body, 'utf8');
    return { ...result, savedPath };
  }

  processMessage(
    msg: Message | MediaMergedMessage,
    conversationName: string | null = null,
    viberGroupId: string | null = null,
    heldLockId?: string,
  ): MonitoredMessageDto {
    const media = normalizeStoredMedia({
      body: msg.body,
      mediaUri: msg.mediaUri,
      mediaUris: 'mediaUris' in msg ? msg.mediaUris : undefined,
    });
    const { hasMedia, mediaUris } = media;
    const textBody = media.body;
    const allFoundPhones = extractPhones(textBody);
    const primaryTextPhone = allFoundPhones.length > 0 ? allFoundPhones[0]! : null;

    let effectiveMemberId = msg.senderMemberId?.trim() ?? null;
    if (effectiveMemberId?.startsWith('em:')) {
      try {
        effectiveMemberId = extractEmKey(effectiveMemberId);
      } catch {
        // Keep the encrypted token when Viber changes its encoding.
      }
    } else if (!effectiveMemberId && msg.senderNumber?.startsWith('em:')) {
      try {
        effectiveMemberId = extractEmKey(msg.senderNumber.trim());
      } catch {
        effectiveMemberId = msg.senderNumber.trim();
      }
    }

    let attachedPhone: string | null = null;
    let phoneSource: PhoneSource = 'none';
    const hasPhoneInText = primaryTextPhone !== null;

    if (hasPhoneInText) {
      attachedPhone = primaryTextPhone;
      phoneSource = 'message_text';
      this.phonesFromTextCount += 1;
    } else {
      const rawNumber = msg.senderNumber?.trim();
      if (rawNumber && rawNumber.length > 0 && !rawNumber.startsWith('em:')) {
        attachedPhone = normalizePhoneNumber(rawNumber) ?? rawNumber;
        phoneSource = 'viber_profile';
        this.phonesFromViberCount += 1;
        this.contactEnrichment?.learn(effectiveMemberId, msg.senderName, attachedPhone);
      } else {
        const cachedPhone = this.contactEnrichment?.lookup(effectiveMemberId, msg.senderName);
        if (cachedPhone) {
          attachedPhone = cachedPhone;
          phoneSource = 'viber_profile';
          this.phonesFromViberCount += 1;
        }
      }
    }

    const rawEmToken =
      msg.senderNumber?.startsWith('em:')
        ? msg.senderNumber.trim()
        : 'senderMemberId' in msg && msg.senderMemberId?.startsWith('em:')
          ? msg.senderMemberId.trim()
          : null;

    if (
      !attachedPhone &&
      !msg.outgoing &&
      msg.senderId !== 1 &&
      effectiveMemberId &&
      this.isDecodedMemberId(effectiveMemberId)
    ) {
      if (msg.senderId !== null && msg.senderId !== undefined) {
        void this.queueParticipantUpdateInLiveDb(msg.senderId, effectiveMemberId, heldLockId);
      } else if (rawEmToken) {
        void this.queueParticipantUpdateInLiveDb(rawEmToken, effectiveMemberId, heldLockId);
      }
    }

    this.processedMessagesCount += 1;
    const sourceIds = 'sourceIds' in msg ? msg.sourceIds : [msg.id];

    return {
      instanceId: this.instanceId,
      id: msg.id,
      conversationId: msg.conversationId,
      conversationName,
      viberGroupId,
      token: msg.token,
      date: msg.date.toISOString(),
      body: textBody,
      senderId: msg.senderId ?? null,
      senderName: msg.senderName ?? null,
      senderMemberId: effectiveMemberId ?? msg.senderMemberId ?? null,
      outgoing: msg.outgoing,
      hasPhoneInText,
      attachedPhone,
      phoneSource,
      allFoundPhones: allFoundPhones.length > 0 ? allFoundPhones : undefined,
      hasMedia,
      mediaUris: mediaUris !== undefined && mediaUris.length > 0 ? mediaUris : undefined,
      mergedMessageIds: sourceIds.length > 1 ? sourceIds : undefined,
    };
  }

  private isDecodedMemberId(memberId: string): boolean {
    return /^[A-Za-z0-9+/]{11}=$/.test(memberId) && Buffer.from(memberId, 'base64').length === 8;
  }

  private queueParticipantUpdateInLiveDb(
    target: number | string,
    memberId: string,
    heldLockId?: string,
  ): Promise<void> {
    if (this.updatedParticipantTargets.has(target) || this.writingParticipantTargets.has(target)) {
      return Promise.resolve();
    }
    this.writingParticipantTargets.add(target);
    const queued = this.participantWriteQueue.then(() =>
      this.updateParticipantInLiveDb(target, memberId, heldLockId),
    );
    this.participantWriteQueue = queued
      .catch(() => undefined)
      .finally(() => {
        this.writingParticipantTargets.delete(target);
      });
    return queued;
  }

  private async updateParticipantInLiveDb(
    target: number | string,
    memberId: string,
    heldLockId?: string,
  ): Promise<void> {
    const lockId = heldLockId ?? `message-monitor-contact:${String(target)}`;
    const ownsLock = heldLockId === undefined;
    if (ownsLock && this.deviceMutex && !this.deviceMutex.tryLock(lockId)) {
      this.pendingParticipantUpdates.set(target, memberId);
      this.pendingContactSyncTargets.add(target);
      this.scheduleContactSyncRestart();
      return;
    }
    try {
      const { db } = await this.getDeviceContext();
      const escapedMemberId = memberId.replace(/'/g, "''");
      const whereClause =
        typeof target === 'number'
          ? `_id = ${String(target)}`
          : `(encrypted_member_id = '${target.replace(/'/g, "''")}' OR member_id = '${target.replace(/'/g, "''")}')`;
      db.updateLiveRow(
        `PRAGMA busy_timeout=${String(LIVE_WRITE_TIMEOUT_MS)}; ` +
          `UPDATE participants_info SET member_id = '${escapedMemberId}', participant_type = 1, ` +
          `safe_contact = 0, number = CASE WHEN number LIKE 'em:%' THEN NULL ELSE number END ` +
          `WHERE ${whereClause} AND _id != 1 AND coalesce(participant_type, 1) != 0;`,
        { appPackage: loadViberConfig().appPackage, timeout: LIVE_WRITE_TIMEOUT_MS },
      );
      this.pendingParticipantUpdates.delete(target);
      this.updatedParticipantTargets.add(target);
      this.pendingContactSyncTargets.add(target);
      this.scheduleContactSyncRestart();
    } catch (error) {
      this.logger.debug(`Could not update participant ${String(target)} in live DB: ${String(error)}`);
      this.deviceContext = null;
      this.deviceContextPromise = null;
    } finally {
      if (ownsLock) this.deviceMutex?.unlock(lockId);
    }
  }

  private async flushPendingParticipantUpdates(heldLockId: string): Promise<void> {
    if (this.pendingParticipantUpdates.size === 0) return;
    const entries = [...this.pendingParticipantUpdates.entries()];
    for (const [target, memberId] of entries) {
      try {
        await this.updateParticipantInLiveDb(target, memberId, heldLockId);
      } catch (err) {
        this.logger.debug(`Failed to flush participant update ${String(target)}: ${String(err)}`);
      }
    }
  }

  private scheduleContactSyncRestart(delayMs?: number, isRetry = false): void {
    if (!this.isRunning || this.pendingContactSyncTargets.size === 0) return;
    if (this.contactSyncRestartTimer || this.contactSyncRestartRunning) return;
    const elapsed = Date.now() - this.lastContactSyncRestartAt;
    const rateLimitDelay = isRetry ? 0 : Math.max(0, this.contactSyncMinRestartMs - elapsed);
    const delay = Math.max(delayMs ?? this.contactSyncBatchMs, rateLimitDelay);
    this.contactSyncRestartTimer = setTimeout(() => {
      this.contactSyncRestartTimer = null;
      void this.restartViberForContactSync();
    }, delay);
  }

  private async restartViberForContactSync(): Promise<void> {
    if (!this.isRunning || this.pendingContactSyncTargets.size === 0) return;
    if (this.contactSyncRestartRunning || this.isPolling || this.writingParticipantTargets.size > 0) {
      this.scheduleContactSyncRestart(DEVICE_RETRY_MS, true);
      return;
    }

    const lockId = 'message-monitor-contact-sync';
    if (this.deviceMutex && !this.deviceMutex.tryLock(lockId)) {
      this.scheduleContactSyncRestart(DEVICE_RETRY_MS, true);
      return;
    }

    this.contactSyncRestartRunning = true;
    const batch = [...this.pendingContactSyncTargets];
    let restarted = false;
    try {
      await this.messageWatch?.detach();
      const { adb, db } = await this.getDeviceContext();
      if (!this.isRunning) return;

      // Batch transform any pending encrypted participants before restart
      try {
        const rowsToDecode = db
          .query(
            `SELECT _id, encrypted_member_id FROM participants_info ` +
              `WHERE (number LIKE 'em:%' OR member_id LIKE 'em:%') ` +
              `AND encrypted_member_id LIKE 'em:%' AND _id != 1 AND coalesce(participant_type, 1) != 0;`,
            ['id', 'encryptedMemberId'],
          )
          .map((r) => ({ id: Number(r['id']), enc: String(r['encryptedMemberId'] ?? '') }));

        for (const row of rowsToDecode) {
          if (!row.id || !row.enc) continue;
          try {
            const decodedKey = extractEmKey(row.enc);
            if (this.isDecodedMemberId(decodedKey)) {
              db.updateLiveRow(
                `PRAGMA busy_timeout=${String(LIVE_WRITE_TIMEOUT_MS)}; ` +
                  `UPDATE participants_info SET member_id = '${decodedKey.replace(/'/g, "''")}', ` +
                  `participant_type = 1, safe_contact = 0, number = NULL ` +
                  `WHERE _id = ${String(row.id)} AND _id != 1;`,
                { appPackage: loadViberConfig().appPackage, timeout: LIVE_WRITE_TIMEOUT_MS },
              );
              this.updatedParticipantTargets.add(row.id);
            }
          } catch {
            // ignore malformed
          }
        }
      } catch (err) {
        this.logger.debug(`Pre-restart participants scan skipped: ${String(err)}`);
      }

      restarted =
        (await this.viberLifecycle?.restartApp(adb, loadViberConfig())) ?? false;
      if (restarted) {
        this.lastContactSyncRestartAt = Date.now();
        for (const target of batch) this.pendingContactSyncTargets.delete(target);
        this.lastContactRefreshAt = 0;
        this.logger.log(
          `Restarted only Viber for a batch of ${String(batch.length)} decoded participants.`,
        );
      } else {
        this.logger.warn(
          `Could not restart Viber for contact sync; ${String(batch.length)} participant updates remain queued.`,
        );
      }
    } catch (error) {
      this.logger.warn(`Could not restart Viber for contact sync: ${String(error)}`);
    } finally {
      this.contactSyncRestartRunning = false;
      this.deviceMutex?.unlock(lockId);
      if (this.isRunning) {
        if (restarted) {
          await this.ensureLiveWatch();
          if (this.isRunning) this.requestImmediateIngest();
        }
        if (this.pendingContactSyncTargets.size > 0) {
          this.scheduleContactSyncRestart(DEVICE_RETRY_MS, !restarted);
        }
      }
    }
  }

  private async refreshContactPhones(db: Sqlite, heldLockId: string): Promise<void> {
    if (Date.now() - this.lastContactRefreshAt < CONTACT_REFRESH_MS) return;
    const senderIds = new Set<number>();
    const memberIds = new Set<string>();
    for (const message of this.ringBuffer) {
      if (message.hasPhoneInText || message.phoneSource === 'message_text') continue;
      if (message.senderId !== null && Number.isSafeInteger(message.senderId) && message.senderId > 0) {
        senderIds.add(message.senderId);
      }
      if (message.senderMemberId) memberIds.add(message.senderMemberId);
    }
    if (senderIds.size === 0 && memberIds.size === 0) return;

    const conditions: string[] = [];
    if (senderIds.size > 0) conditions.push(`_id IN (${[...senderIds].join(',')})`);
    if (memberIds.size > 0) {
      const escapedIds = [...memberIds].map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
      conditions.push(`member_id IN (${escapedIds})`, `encrypted_member_id IN (${escapedIds})`);
    }
    const rows = db
      .query(
        `SELECT ${selectList(PARTICIPANT_INFO_COLUMNS, PARTICIPANT_INFO_EXPRS)} ` +
          `FROM participants_info WHERE ${conditions.join(' OR ')};`,
        PARTICIPANT_INFO_COLUMNS,
      )
      .map(toRawParticipantInfo);
    this.lastContactRefreshAt = Date.now();

    const phonesByParticipant = new Map<string, string>();
    const phonesByMemberId = new Map<string, string>();
    let writes = 0;
    for (const row of rows) {
      const rawNumber = row.number?.trim();
      const phone = rawNumber && !rawNumber.startsWith('em:')
        ? normalizePhoneNumber(rawNumber)
        : null;
      const name = row.contactName ?? row.displayName ?? row.viberName;
      let memberId = row.memberId?.trim() || row.encryptedMemberId?.trim() || null;
      if (memberId?.startsWith('em:')) {
        try {
          memberId = extractEmKey(memberId);
        } catch {
          memberId = null;
        }
      }

      if (phone) {
        this.pendingContactSyncTargets.delete(row.id);
        if (row.encryptedMemberId) this.pendingContactSyncTargets.delete(row.encryptedMemberId);
        for (const identity of [row.memberId, row.encryptedMemberId]) {
          const stableIdentity = this.stableMemberId(identity);
          if (stableIdentity) {
            phonesByParticipant.set(this.participantPhoneKey(row.id, stableIdentity), phone);
            phonesByMemberId.set(stableIdentity, phone);
          }
        }
        if (memberId) phonesByMemberId.set(memberId, phone);
        this.contactEnrichment?.learn(memberId, name, phone);
        this.contactEnrichment?.learn(row.encryptedMemberId, name, phone);
        continue;
      }

      if (
        row.id !== 1 &&
        row.participantType !== 0 &&
        memberId &&
        this.isDecodedMemberId(memberId)
      ) {
        if (row.memberId !== memberId || row.participantType !== 1 || row.safeContact !== 0) {
          this.updatedParticipantTargets.delete(row.id);
        }
        if (writes < CONTACT_WRITES_PER_REFRESH && !this.updatedParticipantTargets.has(row.id)) {
          this.writingParticipantTargets.add(row.id);
          try {
            await this.updateParticipantInLiveDb(row.id, memberId, heldLockId);
          } finally {
            this.writingParticipantTargets.delete(row.id);
          }
          writes += 1;
        }
      }
    }

    this.enrichAndPersistBuffer(phonesByParticipant, phonesByMemberId);
  }

  private async pollTick(): Promise<void> {
    if (!this.isRunning || this.isPolling) return;
    this.isPolling = true;
    this.pendingImmediate = false;
    let fetchedCount = 0;
    let deviceBusy = false;
    const lockId = 'message-monitor-poll';

    try {
      const enabled = this.enabledGroups();
      if (enabled.length === 0) {
        return;
      }

      if (this.unreachableUntil > Date.now()) {
        this.deviceUnreachable = true;
        return;
      }
      if (this.deviceMutex && !this.deviceMutex.tryLock(lockId)) {
        deviceBusy = true;
        return;
      }

      try {
        const { viber, db } = await this.getDeviceContext();
        db.refresh();
        this.lastPollAt = new Date();
        this.deviceUnreachable = false;
        this.unreachableUntil = 0;

        const cursors = enabled.map((group) => ({
          conversationId: group.conversationId,
          sinceId: group.lastMessageId,
        }));
        const fetched = viber.messagesSince(cursors, { limit: CATCH_UP_BATCH_SIZE });
        fetchedCount = fetched.length;
        this.ingestFetched(fetched, lockId);

        const communityCursors = enabled.map((group) => ({
          conversationId: group.conversationId,
          sinceServerId: group.lastServerMessageId ?? 0,
        }));
        const communityFetched = viber.communityMessagesSince?.(communityCursors) ?? [];
        if (communityFetched.length > 0) {
          fetchedCount += communityFetched.length;
          this.ingestCommunityFetched(communityFetched, lockId);
        }

        await this.flushPendingParticipantUpdates(lockId);
        await this.refreshContactPhones(db, lockId);
        this.persistState();
      } finally {
        this.deviceMutex?.unlock(lockId);
      }
    } catch (err) {
      this.logger.warn(`Error during message monitor poll tick: ${String(err)}`);
      this.deviceContext = null;
      this.deviceContextPromise = null;
      this.deviceUnreachable = true;
      this.unreachableUntil = Date.now() + DEVICE_RETRY_MS;
    } finally {
      this.isPolling = false;
      if (this.isRunning) {
        this.scheduleNextPoll(deviceBusy ? DEVICE_RETRY_MS : this.nextPollDelay(fetchedCount));
        if (!this.deviceUnreachable) {
          void this.ensureLiveWatch();
        }
      }
    }
  }

  private ingestFetched(fetched: Message[], heldLockId?: string): void {
    const combined = [...this.heldMessages, ...fetched].sort((a, b) => a.id - b.id);
    this.heldMessages.length = 0;
    const { emitted, held } = mergeMediaWithText(combined);
    this.heldMessages.push(...held);

    const trackedById = new Map<number, TrackedGroup>();
    for (const group of this.groups.values()) trackedById.set(group.conversationId, group);

    for (const merged of emitted) {
      this.advanceCursor(merged.conversationId, merged.id);
      const token = merged.token?.trim();
      const hasToken = token !== undefined && token !== '' && token !== '0';
      const bk = this.bodyKey(merged.conversationId, merged.body, merged.date);
      const alreadyRecorded = hasToken
        ? this.recordedKeys.has(this.tokenKey(token)) || (bk ? this.recordedKeys.has(bk) : false)
        : merged.sourceIds.every((sourceId) =>
            this.recordedKeys.has(this.rowKey(merged.conversationId, sourceId)),
          ) || (bk ? this.recordedKeys.has(bk) : false);
      if (alreadyRecorded) continue;
      if (hasToken) this.recordedKeys.add(this.tokenKey(token));
      if (bk) this.recordedKeys.add(bk);
      for (const sourceId of merged.sourceIds) {
        this.recordedKeys.add(this.rowKey(merged.conversationId, sourceId));
      }
      const tracked = trackedById.get(merged.conversationId);
      this.recordMessage(this.processMessage(
        merged,
        tracked?.name ?? null,
        tracked?.viberGroupId ?? null,
        heldLockId,
      ));
    }
  }

  private ingestCommunityFetched(fetched: Message[], heldLockId?: string): void {
    const trackedById = new Map<number, TrackedGroup>();
    for (const group of this.groups.values()) trackedById.set(group.conversationId, group);

    for (const msg of fetched) {
      this.advanceServerCursor(msg.conversationId, msg.id);
      const sk = this.serverKey(msg.conversationId, msg.id);
      const bk = this.bodyKey(msg.conversationId, msg.body, msg.date);
      const alreadyRecorded =
        this.recordedKeys.has(sk) || (bk ? this.recordedKeys.has(bk) : false);
      if (alreadyRecorded) continue;
      this.recordedKeys.add(sk);
      if (bk) this.recordedKeys.add(bk);
      const tracked = trackedById.get(msg.conversationId);
      this.recordMessage(
        this.processMessage(msg, tracked?.name ?? null, tracked?.viberGroupId ?? null, heldLockId),
      );
    }
  }

  private tokenKey(token: string): string {
    return `t:${token}`;
  }

  private rowKey(conversationId: number, messageId: number): string {
    return `r:${String(conversationId)}:${String(messageId)}`;
  }

  private serverKey(conversationId: number, serverId: number): string {
    return `s:${String(conversationId)}:${String(serverId)}`;
  }

  private bodyKey(
    conversationId: number,
    body: string | null | undefined,
    date: Date | string,
  ): string | null {
    const clean = (body ?? '').trim();
    if (clean.length < 5) return null;
    const d = typeof date === 'string' ? new Date(date) : date;
    const hourBucket = Math.floor(d.getTime() / 3_600_000);
    return `b:${String(conversationId)}:${String(hourBucket)}:${clean.slice(0, 100)}`;
  }

  private messageIdentity(message: Pick<MonitoredMessageDto, 'token' | 'conversationId' | 'id'>): string {
    const token = message.token?.trim();
    return token && token !== '0'
      ? this.tokenKey(token)
      : this.rowKey(message.conversationId, message.id);
  }

  private stableMemberId(memberId: string | null | undefined): string | null {
    const value = memberId?.trim();
    if (!value) return null;
    if (!value.startsWith('em:')) return value;
    try {
      return extractEmKey(value);
    } catch {
      return null;
    }
  }

  private participantPhoneKey(senderId: number, memberId: string): string {
    return `${String(senderId)}|${memberId}`;
  }

  private onLiveWrite(write: MessageDbWrite): void {
    if (!this.isRunning) return;
    const enabledIds = new Set(this.enabledGroups().map((group) => group.conversationId));
    if (!shouldIngestMessageWrite(write.values, enabledIds, write.table)) return;
    this.requestImmediateIngest();
  }

  private requestImmediateIngest(): void {
    this.pendingImmediate = true;
    if (!this.isPolling && this.isRunning) {
      this.scheduleNextPoll(LIVE_INGEST_DELAY_MS);
    }
  }

  private nextPollDelay(fetchedCount: number): number {
    if (this.pendingImmediate) {
      this.pendingImmediate = false;
      return LIVE_INGEST_DELAY_MS;
    }
    if (this.deviceUnreachable) return DEVICE_RETRY_MS;
    if (fetchedCount >= CATCH_UP_BATCH_SIZE) return 100;
    if (this.messageWatch?.isAttached() === true) return LIVE_CATCHUP_MS;
    return this.pollIntervalMs;
  }

  private async ensureLiveWatch(): Promise<void> {
    if (this.disableFridaWatch) return;
    if (!this.isRunning || this.messageWatch === undefined) return;
    if (this.messageWatch.isAttached()) return;
    if (Date.now() - this.lastLiveWatchAttemptAt < 60_000) return;
    this.lastLiveWatchAttemptAt = Date.now();
    try {
      const { adb } = await this.getDeviceContext();
      const attached = await this.messageWatch.attach(adb);
      if (!this.isRunning) {
        if (attached) await this.messageWatch.detach();
        return;
      }
      if (attached) {
        this.logger.log('Live message watch is on — new messages are ingested as soon as Viber writes them.');
      }
    } catch (err) {
      this.logger.warn(`Live message watch unavailable, falling back to fast poll: ${String(err)}`);
    }
  }

  private recordMessage(dto: MonitoredMessageDto): void {
    this.ringBuffer.unshift(dto);
    if (this.ringBuffer.length > MAX_RING_BUFFER_SIZE) {
      this.ringBuffer.pop();
    }

    try {
      appendFileSync(this.storePath, `${JSON.stringify(dto)}\n`, 'utf8');
    } catch (err) {
      this.logger.warn(`Failed to append message to ${this.storePath}: ${String(err)}`);
    }

    this.publisher.publishMessage(dto)
  }

  private beginPolling(delayMs: number): void {
    this.isRunning = true;
    this.messageWatch?.setHandler((write) => this.onLiveWrite(write));
    this.persistState();
    this.scheduleNextPoll(delayMs);
    this.scheduleContactSyncRestart();
  }

  private scheduleNextPoll(delayMs: number): void {
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
    }
    this.pollTimeout = setTimeout(() => {
      void this.pollTick();
    }, delayMs);
  }

  private advanceCursor(conversationId: number, messageId: number): void {
    const group = this.groups.get(conversationId);
    if (group === undefined) return;
    group.lastMessageId = Math.max(group.lastMessageId, messageId);
  }

  private advanceServerCursor(conversationId: number, serverMessageId: number): void {
    const group = this.groups.get(conversationId);
    if (group === undefined) return;
    group.lastServerMessageId = Math.max(group.lastServerMessageId ?? 0, serverMessageId);
  }

  private enabledGroups(): TrackedGroup[] {
    return [...this.groups.values()].filter((group) => group.enabled);
  }

  private listGroups(): MonitoredGroupDto[] {
    return [...this.groups.values()]
      .sort((a, b) => a.conversationId - b.conversationId)
      .map((group) => ({
        conversationId: group.conversationId,
        name: group.name,
        enabled: group.enabled,
        lastMessageId: group.lastMessageId,
        lastServerMessageId: group.lastServerMessageId ?? 0,
        groupKey: group.viberGroupId ?? null,
        deviceId: this.instanceId,
      }));
  }

  private maxCursor(): number {
    let max = 0;
    for (const group of this.groups.values()) {
      max = Math.max(max, group.lastMessageId);
    }
    return max;
  }

  private filterMessages(
    messages: readonly MonitoredMessageDto[],
    filter: MonitoredMessagesFilterDto,
  ): MonitoredMessageDto[] {
    let result = [...messages];

    if (filter.conversationId !== undefined) {
      result = result.filter((item) => item.conversationId === filter.conversationId);
    }
    if (filter.hasPhone === true) {
      result = result.filter((item) => item.attachedPhone !== null);
    } else if (filter.hasPhone === false) {
      result = result.filter((item) => item.attachedPhone === null);
    }
    if (filter.hasMedia === true) {
      result = result.filter((item) => item.hasMedia === true);
    } else if (filter.hasMedia === false) {
      result = result.filter((item) => item.hasMedia !== true);
    }
    if (filter.phoneSource !== undefined) {
      result = result.filter((item) => item.phoneSource === filter.phoneSource);
    }

    result.sort((a, b) => b.id - a.id);
    return result;
  }

  private ensureDirectory(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private persistState(): void {
    const payload: PersistedMonitorState = {
      isRunning: this.isRunning,
      pollIntervalMs: this.pollIntervalMs,
      groups: [...this.groups.values()],
    };
    try {
      this.ensureDirectory(dirname(this.statePath));
      writeFileSync(this.statePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    } catch (err) {
      this.logger.warn(`Failed to persist monitor state: ${String(err)}`);
    }
  }

  private loadState(): void {
    if (!existsSync(this.statePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.statePath, 'utf8')) as PersistedMonitorState;
      this.pollIntervalMs = parsed.pollIntervalMs >= 500 ? parsed.pollIntervalMs : this.pollIntervalMs;
      this.resumeOnInit = parsed.isRunning === true;
      for (const group of parsed.groups ?? []) {
        if (!Number.isInteger(group.conversationId)) continue;
        this.groups.set(group.conversationId, {
          conversationId: group.conversationId,
          viberGroupId: group.viberGroupId ?? null,
          name: group.name ?? null,
          enabled: group.enabled === true,
          lastMessageId: Number.isInteger(group.lastMessageId) ? group.lastMessageId : 0,
          lastServerMessageId: Number.isInteger(group.lastServerMessageId)
            ? group.lastServerMessageId
            : 0,
        });
      }
    } catch (err) {
      this.logger.warn(`Failed to load monitor state: ${String(err)}`);
    }
  }

  private loadHistoryFromStore(): void {
    if (!existsSync(this.storePath)) return;
    try {
      const raw = readFileSync(this.storePath, 'utf8');
      const lines = raw.split('\n').filter((line) => line.trim().length > 0);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as MonitoredMessageDto;
          parsed.instanceId = parsed.instanceId?.trim() || this.instanceId;
          parsed.viberGroupId ??= null;
          const media = normalizeStoredMedia(parsed);
          parsed.body = media.body;
          parsed.hasMedia = media.hasMedia;
          parsed.mediaUris = media.mediaUris;
          this.ringBuffer.unshift(parsed);
          if (this.ringBuffer.length > MAX_RING_BUFFER_SIZE) this.ringBuffer.pop();
          this.recordedKeys.add(this.messageIdentity(parsed));
          this.recordedKeys.add(this.serverKey(parsed.conversationId, parsed.id));
          const bk = this.bodyKey(parsed.conversationId, parsed.body, parsed.date);
          if (bk) this.recordedKeys.add(bk);
          for (const sourceId of parsed.mergedMessageIds ?? [parsed.id]) {
            this.recordedKeys.add(this.rowKey(parsed.conversationId, sourceId));
          }
        } catch {
          // ignore corrupt line
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to load history from ${this.storePath}: ${String(err)}`);
    }
  }

  private enrichExistingMessage(
    message: MonitoredMessageDto,
    profilePhone?: string,
  ): MonitoredMessageDto {
    let memberId = message.senderMemberId?.trim() ?? null;
    if (memberId?.startsWith('em:')) {
      try {
        memberId = extractEmKey(memberId);
      } catch {
        // Keep the original value when it cannot be decoded.
      }
    }

    if (message.hasPhoneInText || message.phoneSource === 'message_text') {
      return memberId !== message.senderMemberId ? { ...message, senderMemberId: memberId } : message;
    }
    const phone = profilePhone ?? this.contactEnrichment?.lookup(memberId, message.senderName);
    if (phone) {
      if (phone === message.attachedPhone && memberId === message.senderMemberId) return message;
      return {
        ...message,
        senderMemberId: memberId ?? message.senderMemberId,
        attachedPhone: phone,
        phoneSource: 'viber_profile',
      };
    }
    return memberId !== message.senderMemberId ? { ...message, senderMemberId: memberId } : message;
  }

  private enrichAndPersistBuffer(
    phonesByParticipant = new Map<string, string>(),
    phonesByMemberId = new Map<string, string>(),
  ): void {
    const replacements = new Map<string, MonitoredMessageDto>();
    for (let index = 0; index < this.ringBuffer.length; index += 1) {
      const original = this.ringBuffer[index]!;
      const stableMemberId = this.stableMemberId(original.senderMemberId);
      const profilePhone =
        (original.senderId !== null && stableMemberId
          ? phonesByParticipant.get(this.participantPhoneKey(original.senderId, stableMemberId))
          : undefined) ??
        (stableMemberId ? phonesByMemberId.get(stableMemberId) : undefined);
      const enriched = this.enrichExistingMessage(
        original,
        profilePhone,
      );
      if (enriched === original) continue;
      this.ringBuffer[index] = enriched;
      replacements.set(this.messageIdentity(enriched), enriched);
      if (!original.attachedPhone && enriched.attachedPhone) this.phonesFromViberCount += 1;
      this.publisher.publishMessage(enriched);
    }
    if (replacements.size === 0 || !existsSync(this.storePath)) return;

    try {
      const content = readFileSync(this.storePath, 'utf8')
        .split('\n')
        .map((line) => {
          if (!line.trim()) return line;
          try {
            const stored = JSON.parse(line) as MonitoredMessageDto;
            const replacement = replacements.get(this.messageIdentity(stored));
            return replacement ? JSON.stringify(replacement) : line;
          } catch {
            return line;
          }
        })
        .join('\n');
      writeFileSync(this.storePath, content, 'utf8');
    } catch (error) {
      this.logger.warn(`Could not persist enriched messages to ${this.storePath}: ${String(error)}`);
    }
  }
}
