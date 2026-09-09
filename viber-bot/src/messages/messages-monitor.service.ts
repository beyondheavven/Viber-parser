import { Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Observable, Subject } from 'rxjs';
import { openDevice, type DeviceContext } from '../context.js';
import { extractPhones, normalizePhoneNumber } from './phone-extractor.util.js';
import { mergeMediaWithText, normalizeStoredMedia, type MediaMergedMessage } from './message-media.util.js';
import { formatMonitoredExport, type MonitorExportFormat } from './monitor-export.util.js';
import { MessageWatchService, shouldIngestMessageWrite, type MessageDbWrite } from '../automation/frida/message-watch.service.js';
import type { ExportMonitoredMessagesDto, MonitoredMessageDto, MonitoredMessagesFilterDto, PhoneSource } from './dto/monitored-message.dto.js';
import type { EnableMonitorGroupDto, MonitorStatusDto, MonitoredGroupDto, StartMonitorDto } from './dto/monitor-control.dto.js';
import type { Message } from '../viber/repository.js';

const MAX_RING_BUFFER_SIZE = 2000;
const CATCH_UP_BATCH_SIZE = 200;
const LIVE_INGEST_DELAY_MS = 80;
const LIVE_CATCHUP_MS = 8_000;
const POLL_WITHOUT_HOOK_MS = 400;
const DEVICE_RETRY_MS = 5_000;

interface TrackedGroup {
  conversationId: number;
  name: string | null;
  enabled: boolean;
  lastMessageId: number;
}

interface PersistedMonitorState {
  isRunning: boolean;
  pollIntervalMs: number;
  groups: TrackedGroup[];
}

@Injectable()
export class MessagesMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagesMonitorService.name);

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
  private resumeOnInit = false;

  private readonly groups = new Map<number, TrackedGroup>();
  private readonly heldMessages: Message[] = [];
  private readonly recordedIds = new Set<number>();

  private readonly messageSubject = new Subject<MonitoredMessageDto>();
  private readonly ringBuffer: MonitoredMessageDto[] = [];
  private readonly dataDir: string;
  private readonly storePath: string;
  private readonly statePath: string;
  private readonly exportDir: string;

  constructor(
    @Optional() @Inject(MessageWatchService) private readonly messageWatch?: MessageWatchService,
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
    if (this.resumeOnInit) {
      this.logger.log('Resuming group message monitoring from persisted state.');
      this.beginPolling(100);
    }
  }

  onModuleDestroy(): void {
    this.stop();
    this.messageSubject.complete();
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

  /**
   * Starts background polling. Existing per-group cursors are kept so an
   * emulator restart still catches messages that arrived while it was down.
   */
  async start(dto: StartMonitorDto = {}): Promise<MonitorStatusDto> {
    if (dto.pollIntervalMs !== undefined && dto.pollIntervalMs >= 500) {
      this.pollIntervalMs = dto.pollIntervalMs;
    }

    if (dto.conversationId !== undefined) {
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
    let currentLastMessageId = 0;
    try {
      const { viber } = await this.getDeviceContext();
      const group =
        viber.findGroup(String(conversationId)) ??
        viber.conversations().find((item) => item.id === conversationId);
      if (group === undefined) {
        throw new NotFoundException(`Группа/беседа с ID ${String(conversationId)} не найдена`);
      }
      name = group.name;
      currentLastMessageId = viber.lastMessageId(conversationId);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.warn(
        `Could not resolve group ${String(conversationId)} on device, enabling with saved cursor: ${String(error)}`,
      );
      this.deviceContext = null;
    }

    const tracked: {
      name: string | null;
      currentLastMessageId: number;
      fromLatest?: boolean;
      startFromId?: number;
    } = { name, currentLastMessageId };
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

  /**
   * Test-friendly registry update that does not touch the emulator.
   */
  enableTrackedGroup(
    conversationId: number,
    options: {
      name?: string | null;
      currentLastMessageId?: number;
      fromLatest?: boolean;
      startFromId?: number;
    } = {},
  ): MonitorStatusDto {
    const existing = this.groups.get(conversationId);
    const currentLast = options.currentLastMessageId ?? existing?.lastMessageId ?? 0;
    let lastMessageId = existing?.lastMessageId ?? 0;
    if (options.startFromId !== undefined) {
      lastMessageId = options.startFromId;
    } else if (options.fromLatest === false) {
      lastMessageId = existing?.lastMessageId ?? 0;
    } else if (options.fromLatest === true || existing === undefined) {
      lastMessageId = currentLast;
    }

    this.groups.set(conversationId, {
      conversationId,
      name: options.name ?? existing?.name ?? null,
      enabled: true,
      lastMessageId,
    });
    this.persistState();
    return this.getStatus();
  }

  getStatus(): MonitorStatusDto {
    const groups = this.listGroups();
    const enabled = groups.filter((group) => group.enabled);
    return {
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

  getMessageStream(): Observable<MonitoredMessageDto> {
    return this.messageSubject.asObservable();
  }

  processMessage(
    msg: Message | MediaMergedMessage,
    conversationName: string | null = null,
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
      }
    }

    this.processedMessagesCount += 1;
    const sourceIds = 'sourceIds' in msg ? msg.sourceIds : [msg.id];

    return {
      id: msg.id,
      conversationId: msg.conversationId,
      conversationName,
      token: msg.token,
      date: msg.date.toISOString(),
      body: textBody,
      senderId: msg.senderId ?? null,
      senderName: msg.senderName ?? null,
      senderMemberId: msg.senderMemberId ?? null,
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

  private async pollTick(): Promise<void> {
    if (!this.isRunning || this.isPolling) return;
    this.isPolling = true;
    this.pendingImmediate = false;
    let fetchedCount = 0;

    try {
      const enabled = this.enabledGroups();
      if (enabled.length === 0) {
        return;
      }

      const { viber, db } = await this.getDeviceContext();
      db.refresh();
      this.lastPollAt = new Date();
      this.deviceUnreachable = false;

      const cursors = enabled.map((group) => ({
        conversationId: group.conversationId,
        sinceId: group.lastMessageId,
      }));
      const fetched = viber.messagesSince(cursors, { limit: CATCH_UP_BATCH_SIZE });
      fetchedCount = fetched.length;

      const combined = [...this.heldMessages, ...fetched].sort((a, b) => a.id - b.id);
      this.heldMessages.length = 0;

      const { emitted, held } = mergeMediaWithText(combined);
      this.heldMessages.push(...held);

      const nameById = new Map<number, string | null>();
      for (const group of this.groups.values()) {
        nameById.set(group.conversationId, group.name);
      }

      for (const merged of emitted) {
        this.advanceCursor(merged.conversationId, merged.id);
        if (merged.sourceIds.every((sourceId) => this.recordedIds.has(sourceId))) {
          continue;
        }
        for (const sourceId of merged.sourceIds) {
          this.recordedIds.add(sourceId);
        }
        const convName = nameById.get(merged.conversationId) ?? null;
        this.recordMessage(this.processMessage(merged, convName));
      }

      this.persistState();
    } catch (err) {
      this.logger.warn(`Error during message monitor poll tick: ${String(err)}`);
      this.deviceContext = null;
      this.deviceContextPromise = null;
      this.deviceUnreachable = true;
    } finally {
      this.isPolling = false;
      if (this.isRunning) {
        this.scheduleNextPoll(this.nextPollDelay(fetchedCount));
        if (!this.deviceUnreachable) {
          void this.ensureLiveWatch();
        }
      }
    }
  }

  private onLiveWrite(write: MessageDbWrite): void {
    if (!this.isRunning) return;
    const enabledIds = new Set(this.enabledGroups().map((group) => group.conversationId));
    if (!shouldIngestMessageWrite(write.values, enabledIds)) return;
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
    return POLL_WITHOUT_HOOK_MS;
  }

  private async ensureLiveWatch(): Promise<void> {
    if (!this.isRunning || this.messageWatch === undefined) return;
    if (this.messageWatch.isAttached()) return;
    try {
      const { adb } = await this.getDeviceContext();
      const attached = await this.messageWatch.attach(adb);
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

    this.messageSubject.next(dto);
  }

  private beginPolling(delayMs: number): void {
    this.isRunning = true;
    this.messageWatch?.setHandler((write) => this.onLiveWrite(write));
    this.persistState();
    this.scheduleNextPoll(delayMs);
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

  private enabledGroups(): TrackedGroup[] {
    return [...this.groups.values()].filter((group) => group.enabled);
  }

  private listGroups(): MonitoredGroupDto[] {
    return [...this.groups.values()]
      .sort((a, b) => a.conversationId - b.conversationId)
      .map((group) => ({ ...group }));
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
      groups: this.listGroups(),
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
          name: group.name ?? null,
          enabled: group.enabled === true,
          lastMessageId: Number.isInteger(group.lastMessageId) ? group.lastMessageId : 0,
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
      for (const line of lines.slice(-MAX_RING_BUFFER_SIZE)) {
        try {
          const parsed = JSON.parse(line) as MonitoredMessageDto;
          const media = normalizeStoredMedia(parsed);
          parsed.body = media.body;
          parsed.hasMedia = media.hasMedia;
          parsed.mediaUris = media.mediaUris;
          this.ringBuffer.unshift(parsed);
          this.recordedIds.add(parsed.id);
          for (const sourceId of parsed.mergedMessageIds ?? []) {
            this.recordedIds.add(sourceId);
          }
        } catch {
          // ignore corrupt line
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to load history from ${this.storePath}: ${String(err)}`);
    }
  }
}
