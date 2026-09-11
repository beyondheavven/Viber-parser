import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { join } from 'node:path';
import { DeviceMutexService } from '../common/mutex/device-mutex.service.js';
import { ViberNavigationService } from '../automation/navigation/viber-navigation.service.js';
import { GroupsService } from '../groups/groups.service.js';
import { BroadcastStore } from './broadcast-store.js';
import { pickMessage } from './rotation.js';
import { isOneShotComplete, msUntilWorkingHours, selectNextTarget } from './schedule.js';
import { abortableSleep } from './sleep.js';
import type { Campaign, CampaignGroup, SendHistoryEntry } from './types.js';
import type {
  BroadcastHistoryQueryDto,
  BroadcastStatusDto,
  CampaignDto,
  ChatRotationStateDto,
  CreateCampaignDto,
  SendHistoryDto,
  UpdateCampaignDto,
} from './dto/broadcast.dto.js';

const MUTEX_RETRY_MS = 3_000;
const MIN_INTERVAL_MS = 5_000;

interface RunningCampaign {
  campaignId: string;
  abort: AbortController;
  loop: Promise<void>;
}

@Injectable()
export class BroadcastService implements OnModuleDestroy {
  private readonly logger = new Logger(BroadcastService.name);
  private readonly store: BroadcastStore;
  private running: RunningCampaign | null = null;

  constructor(
    @Inject(DeviceMutexService) private readonly deviceMutex: DeviceMutexService,
    @Inject(ViberNavigationService) private readonly navigation: ViberNavigationService,
    @Inject(GroupsService) private readonly groupsService: GroupsService,
  ) {
    const dir = process.env['BROADCAST_DATA_DIR'] ?? join(process.cwd(), 'data', 'broadcast');
    this.store = new BroadcastStore(dir);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.running) return;
    this.running.abort.abort();
    await this.running.loop.catch(() => {
      // Shutdown must not throw because the loop already recorded the stop.
    });
  }

  listCampaigns(): CampaignDto[] {
    return this.store.listCampaigns().map((campaign) => this.toDto(campaign));
  }

  getCampaign(id: string): CampaignDto {
    return this.toDto(this.requireCampaign(id));
  }

  getStatus(): BroadcastStatusDto {
    const campaign = this.store.runningCampaign();
    return {
      isRunning: campaign !== undefined,
      campaign: campaign ? this.toDto(campaign) : null,
    };
  }

  getHistory(query: BroadcastHistoryQueryDto): SendHistoryDto[] {
    const limit = query.limit ?? 100;
    const filter: { limit: number; conversationId?: number; campaignId?: string } = { limit };
    if (query.conversationId !== undefined) filter.conversationId = query.conversationId;
    if (query.campaignId !== undefined) filter.campaignId = query.campaignId;
    return this.store.listHistory(filter);
  }

  getLastSends(): SendHistoryDto[] {
    return this.store.lastSends();
  }

  async createCampaign(dto: CreateCampaignDto): Promise<CampaignDto> {
    const messages = sanitizeMessages(dto.messages);
    const conversationIds = uniqueIds(dto.conversationIds);
    const intervalMs = dto.intervalMs;
    const minIntervalPerChatMs = dto.minIntervalPerChatMs ?? intervalMs;
    assertInterval(intervalMs);
    assertInterval(minIntervalPerChatMs);

    const hours = parseWorkingHours(dto.activeFrom, dto.activeTo);
    const now = new Date().toISOString();
    const campaign: Campaign = {
      id: newCampaignId(),
      name: dto.name?.trim() || defaultCampaignName(now),
      groups: await this.resolveGroups(conversationIds, false),
      messages,
      intervalMs,
      minIntervalPerChatMs,
      rotation: dto.rotation ?? 'shuffle-cycle',
      loop: dto.loop ?? true,
      activeFrom: hours.activeFrom,
      activeTo: hours.activeTo,
      status: 'idle',
      nextGroupIndex: 0,
      rotationState: {},
      sentCount: 0,
      failedCount: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      stoppedAt: null,
    };

    return this.toDto(this.store.saveCampaign(campaign));
  }

  async updateCampaign(id: string, dto: UpdateCampaignDto): Promise<CampaignDto> {
    const campaign = this.requireCampaign(id);
    if (campaign.status === 'running') {
      throw new ConflictException('Нельзя менять кампанию, пока она запущена. Сначала остановите её.');
    }

    if (dto.messages !== undefined) campaign.messages = sanitizeMessages(dto.messages);
    if (dto.conversationIds !== undefined) {
      const ids = uniqueIds(dto.conversationIds);
      campaign.groups = await this.resolveGroups(ids, false);
      campaign.nextGroupIndex = 0;
      campaign.rotationState = keepRotationState(campaign.rotationState, ids);
    }
    if (dto.name !== undefined) campaign.name = dto.name.trim();
    if (dto.intervalMs !== undefined) {
      assertInterval(dto.intervalMs);
      campaign.intervalMs = dto.intervalMs;
    }
    if (dto.minIntervalPerChatMs !== undefined) {
      assertInterval(dto.minIntervalPerChatMs);
      campaign.minIntervalPerChatMs = dto.minIntervalPerChatMs;
    }
    if (dto.rotation !== undefined) campaign.rotation = dto.rotation;
    if (dto.loop !== undefined) campaign.loop = dto.loop;
    if (dto.activeFrom !== undefined || dto.activeTo !== undefined) {
      const hours = parseWorkingHours(
        dto.activeFrom !== undefined ? dto.activeFrom : campaign.activeFrom,
        dto.activeTo !== undefined ? dto.activeTo : campaign.activeTo,
      );
      campaign.activeFrom = hours.activeFrom;
      campaign.activeTo = hours.activeTo;
    }
    campaign.updatedAt = new Date().toISOString();

    return this.toDto(this.store.saveCampaign(campaign));
  }

  deleteCampaign(id: string): void {
    const campaign = this.requireCampaign(id);
    if (campaign.status === 'running') {
      throw new ConflictException('Нельзя удалить запущенную кампанию. Сначала остановите её.');
    }
    this.store.deleteCampaign(id);
  }

  async startCampaign(id: string): Promise<CampaignDto> {
    const campaign = this.requireCampaign(id);
    if (this.running !== null) {
      throw new ConflictException(
        `Уже запущена кампания "${this.running.campaignId}". Остановите её, прежде чем стартовать другую.`,
      );
    }
    if (campaign.status === 'running') {
      throw new ConflictException('Кампания уже запущена.');
    }

    const groups = await this.resolveGroups(
      campaign.groups.map((group) => group.conversationId),
      true,
    );
    const now = new Date().toISOString();
    const started = this.store.saveCampaign({
      ...campaign,
      groups,
      status: 'running',
      lastError: null,
      startedAt: now,
      stoppedAt: null,
      updatedAt: now,
    });

    const abort = new AbortController();
    const loop = this.runLoop(started.id, abort.signal);
    this.running = { campaignId: started.id, abort, loop };
    void loop.finally(() => {
      if (this.running?.campaignId === started.id) this.running = null;
    });

    this.logger.log(`Broadcast campaign ${started.id} started (${String(groups.length)} groups).`);
    return this.toDto(started);
  }

  async stopCampaign(id: string): Promise<CampaignDto> {
    const campaign = this.requireCampaign(id);
    if (campaign.status !== 'running') return this.toDto(campaign);

    if (this.running?.campaignId === id) {
      this.running.abort.abort();
      await this.running.loop.catch(() => {
        // Status is written inside the loop.
      });
    }

    const latest = this.store.getCampaign(id);
    return this.toDto(latest ?? this.markStopped(campaign, null));
  }

  private async runLoop(campaignId: string, signal: AbortSignal): Promise<void> {
    const lockId = `broadcast:${campaignId}`;
    let attemptsThisRun = 0;

    try {
      while (!signal.aborted) {
        const campaign = this.store.getCampaign(campaignId);
        if (!campaign || campaign.status !== 'running') return;

        const conversationIds = campaign.groups.map((group) => group.conversationId);
        if (!campaign.loop && isOneShotComplete(attemptsThisRun, conversationIds.length)) {
          this.markStopped(campaign, null);
          return;
        }

        const waitForHours = msUntilWorkingHours(new Date(), campaign.activeFrom, campaign.activeTo);
        if (waitForHours > 0) {
          await abortableSleep(Math.min(waitForHours, 60_000), signal);
          continue;
        }

        const decision = selectNextTarget({
          conversationIds,
          nextGroupIndex: campaign.nextGroupIndex,
          minIntervalPerChatMs: campaign.minIntervalPerChatMs,
          lastSentAtByChat: this.store.lastSentAtMap(),
          now: Date.now(),
        });

        if (decision.kind === 'done') {
          this.markStopped(campaign, null);
          return;
        }

        if (decision.kind === 'wait') {
          await abortableSleep(Math.max(decision.waitMs, 250), signal);
          continue;
        }

        await this.waitForMutex(lockId, signal);
        if (signal.aborted) {
          this.deviceMutex.unlock(lockId);
          break;
        }

        try {
          await this.sendOne(campaignId, decision.conversationId, signal);
        } finally {
          this.deviceMutex.unlock(lockId);
        }

        const after = this.store.getCampaign(campaignId);
        if (after) {
          this.store.saveCampaign({
            ...after,
            nextGroupIndex: decision.nextGroupIndex,
            updatedAt: new Date().toISOString(),
          });
        }
        attemptsThisRun += 1;

        const interval = this.store.getCampaign(campaignId)?.intervalMs ?? campaign.intervalMs;
        await abortableSleep(interval, signal);
      }

      const latest = this.store.getCampaign(campaignId);
      if (latest && latest.status === 'running') {
        this.markStopped(latest, null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const latest = this.store.getCampaign(campaignId);
      if (latest) {
        this.store.saveCampaign({
          ...latest,
          status: 'error',
          lastError: message,
          stoppedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      this.logger.error(`Broadcast campaign ${campaignId} failed: ${message}`);
    } finally {
      this.deviceMutex.unlock(lockId);
    }
  }

  private async sendOne(
    campaignId: string,
    conversationId: number,
    signal: AbortSignal,
  ): Promise<void> {
    const campaign = this.store.getCampaign(campaignId);
    if (!campaign) return;

    let name = campaign.groups.find((group) => group.conversationId === conversationId)?.name;
    if (!name) {
      try {
        const detail = await this.groupsService.getGroup(conversationId);
        name = detail.name;
      } catch {
        name = null;
      }
    }
    if (!name) {
      this.recordAttempt(campaign, conversationId, null, 0, '', 'failed', 'У беседы нет названия.');
      return;
    }

    const key = String(conversationId);
    const state = campaign.rotationState[key] ?? { sendCount: 0, lastMessageIndex: null };
    let pick;
    try {
      pick = pickMessage({
        messages: campaign.messages,
        strategy: campaign.rotation,
        conversationId,
        sendCountForChat: state.sendCount,
        lastMessageIndex: state.lastMessageIndex,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordAttempt(campaign, conversationId, name, 0, '', 'failed', message);
      return;
    }

    try {
      await this.navigation.sendGroupMessage(name, pick.text, signal);
      if (signal.aborted) return;
      this.recordAttempt(campaign, conversationId, name, pick.index, pick.text, 'sent', null);
    } catch (error) {
      if (signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      this.recordAttempt(campaign, conversationId, name, pick.index, pick.text, 'failed', message);
      this.logger.warn(`Send to "${name}" failed: ${message}`);
    }
  }

  private recordAttempt(
    campaign: Campaign,
    conversationId: number,
    conversationName: string | null,
    messageIndex: number,
    text: string,
    status: SendHistoryEntry['status'],
    error: string | null,
  ): void {
    const latest = this.store.getCampaign(campaign.id) ?? campaign;
    const key = String(conversationId);
    const previous = latest.rotationState[key] ?? { sendCount: 0, lastMessageIndex: null };

    const entry: SendHistoryEntry = {
      id: `send_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      campaignId: latest.id,
      conversationId,
      conversationName,
      messageIndex,
      text,
      status,
      error,
      sentAt: new Date().toISOString(),
    };
    this.store.appendHistory(entry);

    const rotationState = { ...latest.rotationState };
    if (status === 'sent') {
      rotationState[key] = {
        sendCount: previous.sendCount + 1,
        lastMessageIndex: messageIndex,
      };
    }

    this.store.saveCampaign({
      ...latest,
      rotationState,
      sentCount: latest.sentCount + (status === 'sent' ? 1 : 0),
      failedCount: latest.failedCount + (status === 'failed' ? 1 : 0),
      lastError: status === 'failed' ? error : latest.lastError,
      updatedAt: entry.sentAt,
    });
  }

  private async waitForMutex(lockId: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      if (!this.deviceMutex.isLocked() && this.deviceMutex.tryLock(lockId)) return;
      await abortableSleep(MUTEX_RETRY_MS, signal);
    }
  }

  private markStopped(campaign: Campaign, lastError: string | null): Campaign {
    const now = new Date().toISOString();
    return this.store.saveCampaign({
      ...campaign,
      status: lastError ? 'error' : 'stopped',
      lastError,
      stoppedAt: now,
      updatedAt: now,
    });
  }

  private requireCampaign(id: string): Campaign {
    const campaign = this.store.getCampaign(id);
    if (!campaign) {
      throw new NotFoundException(`Кампания "${id}" не найдена`);
    }
    return campaign;
  }

  private async resolveGroups(ids: number[], required: boolean): Promise<CampaignGroup[]> {
    const groups: CampaignGroup[] = [];
    for (const conversationId of ids) {
      try {
        const detail = await this.groupsService.getGroup(conversationId);
        const name = detail.name?.trim() || null;
        if (required && !name) {
          throw new BadRequestException(
            `У беседы ${String(conversationId)} нет названия — её нельзя открыть в списке чатов Viber.`,
          );
        }
        groups.push({ conversationId, name });
      } catch (error) {
        if (required) throw error;
        groups.push({ conversationId, name: null });
      }
    }
    return groups;
  }

  private toDto(campaign: Campaign): CampaignDto {
    const rotationState: ChatRotationStateDto[] = campaign.groups.map((group) => {
      const state = campaign.rotationState[String(group.conversationId)];
      return {
        conversationId: group.conversationId,
        sendCount: state?.sendCount ?? 0,
        lastMessageIndex: state?.lastMessageIndex ?? null,
      };
    });

    return {
      id: campaign.id,
      name: campaign.name,
      groups: campaign.groups.map((group) => ({ ...group })),
      messages: [...campaign.messages],
      intervalMs: campaign.intervalMs,
      minIntervalPerChatMs: campaign.minIntervalPerChatMs,
      rotation: campaign.rotation,
      loop: campaign.loop,
      activeFrom: campaign.activeFrom,
      activeTo: campaign.activeTo,
      status: campaign.status,
      nextGroupIndex: campaign.nextGroupIndex,
      rotationState,
      sentCount: campaign.sentCount,
      failedCount: campaign.failedCount,
      lastError: campaign.lastError,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
      startedAt: campaign.startedAt,
      stoppedAt: campaign.stoppedAt,
    };
  }
}

function newCampaignId(): string {
  return `campaign_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function defaultCampaignName(iso: string): string {
  return `Рассылка ${iso.slice(0, 16).replace('T', ' ')}`;
}

function uniqueIds(ids: number[]): number[] {
  return [...new Set(ids)];
}

function sanitizeMessages(messages: string[]): string[] {
  const cleaned = messages.map((text) => text.trim()).filter((text) => text !== '');
  if (cleaned.length === 0) {
    throw new BadRequestException('Нужен хотя бы один непустой текст сообщения.');
  }
  return cleaned;
}

function parseWorkingHours(
  from: string | null | undefined,
  to: string | null | undefined,
): { activeFrom: string | null; activeTo: string | null } {
  const activeFrom = normalizeClock(from);
  const activeTo = normalizeClock(to);
  if ((activeFrom === null) !== (activeTo === null)) {
    throw new BadRequestException(
      'Укажите и начало, и конец рабочих часов — или оставьте оба пустыми для круглосуточной рассылки.',
    );
  }
  return { activeFrom, activeTo };
}

function normalizeClock(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed)) {
    throw new BadRequestException('Время укажите как ЧЧ:ММ');
  }
  return trimmed;
}

function assertInterval(value: number): void {
  if (!Number.isFinite(value) || value < MIN_INTERVAL_MS) {
    throw new BadRequestException(`Интервал не может быть меньше ${String(MIN_INTERVAL_MS)} мс.`);
  }
}

function keepRotationState(
  state: Campaign['rotationState'],
  ids: number[],
): Campaign['rotationState'] {
  const allowed = new Set(ids.map(String));
  const next: Campaign['rotationState'] = {};
  for (const [key, value] of Object.entries(state)) {
    if (allowed.has(key)) next[key] = value;
  }
  return next;
}
