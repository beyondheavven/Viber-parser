import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Campaign, SendHistoryEntry } from './types.js';

const MAX_HISTORY_MEMORY = 5_000;

interface CampaignsFile {
  campaigns: Campaign[];
}

export class BroadcastStore {
  private readonly campaigns = new Map<string, Campaign>();
  private history: SendHistoryEntry[] = [];
  private readonly lastByChat = new Map<number, SendHistoryEntry>();
  private readonly campaignsPath: string;
  private readonly historyPath: string;
  private readonly lastByChatPath: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.campaignsPath = join(dir, 'campaigns.json');
    this.historyPath = join(dir, 'history.jsonl');
    this.lastByChatPath = join(dir, 'last-by-chat.json');
    this.load();
  }

  listCampaigns(): Campaign[] {
    return Array.from(this.campaigns.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(cloneCampaign);
  }

  getCampaign(id: string): Campaign | undefined {
    const campaign = this.campaigns.get(id);
    return campaign ? cloneCampaign(campaign) : undefined;
  }

  saveCampaign(campaign: Campaign): Campaign {
    this.campaigns.set(campaign.id, cloneCampaign(campaign));
    this.persistCampaigns();
    return cloneCampaign(campaign);
  }

  deleteCampaign(id: string): boolean {
    const deleted = this.campaigns.delete(id);
    if (deleted) this.persistCampaigns();
    return deleted;
  }

  runningCampaign(): Campaign | undefined {
    for (const campaign of this.campaigns.values()) {
      if (campaign.status === 'running') return cloneCampaign(campaign);
    }
    return undefined;
  }

  appendHistory(entry: SendHistoryEntry): SendHistoryEntry {
    this.history.push(entry);
    if (this.history.length > MAX_HISTORY_MEMORY) {
      this.history = this.history.slice(-MAX_HISTORY_MEMORY);
    }
    appendFileSync(this.historyPath, `${JSON.stringify(entry)}\n`, 'utf8');
    this.lastByChat.set(entry.conversationId, entry);
    this.persistLastByChat();
    return entry;
  }

  listHistory(filter: {
    conversationId?: number;
    campaignId?: string;
    limit: number;
  }): SendHistoryEntry[] {
    let items = this.history;
    if (filter.conversationId !== undefined) {
      items = items.filter((entry) => entry.conversationId === filter.conversationId);
    }
    if (filter.campaignId !== undefined) {
      items = items.filter((entry) => entry.campaignId === filter.campaignId);
    }
    return items.slice(-filter.limit).reverse();
  }

  lastSends(): SendHistoryEntry[] {
    return Array.from(this.lastByChat.values()).sort((a, b) =>
      b.sentAt.localeCompare(a.sentAt),
    );
  }

  lastSentAtMap(): Map<number, number> {
    const map = new Map<number, number>();
    for (const [conversationId, entry] of this.lastByChat) {
      if (entry.status !== 'sent') continue;
      map.set(conversationId, Date.parse(entry.sentAt));
    }
    return map;
  }

  lastSendForChat(conversationId: number): SendHistoryEntry | undefined {
    return this.lastByChat.get(conversationId);
  }

  private load(): void {
    if (existsSync(this.campaignsPath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.campaignsPath, 'utf8')) as CampaignsFile;
        for (const campaign of parsed.campaigns ?? []) {
          if (campaign.status === 'running') {
            campaign.status = 'stopped';
            campaign.lastError = campaign.lastError ?? 'Остановлено: процесс API был перезапущен.';
            campaign.stoppedAt = campaign.stoppedAt ?? new Date().toISOString();
            campaign.updatedAt = new Date().toISOString();
          }
          campaign.activeFrom = campaign.activeFrom ?? null;
          campaign.activeTo = campaign.activeTo ?? null;
          this.campaigns.set(campaign.id, campaign);
        }
        this.persistCampaigns();
      } catch {
        // A corrupt store must not prevent the API from booting.
      }
    }

    if (existsSync(this.historyPath)) {
      try {
        const lines = readFileSync(this.historyPath, 'utf8').split('\n');
        for (const line of lines) {
          if (line.trim() === '') continue;
          const entry = JSON.parse(line) as SendHistoryEntry;
          this.history.push(entry);
        }
        if (this.history.length > MAX_HISTORY_MEMORY) {
          this.history = this.history.slice(-MAX_HISTORY_MEMORY);
        }
      } catch {
        this.history = [];
      }
    }

    if (existsSync(this.lastByChatPath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.lastByChatPath, 'utf8')) as Record<
          string,
          SendHistoryEntry
        >;
        for (const [key, entry] of Object.entries(parsed)) {
          const conversationId = Number.parseInt(key, 10);
          if (Number.isInteger(conversationId)) this.lastByChat.set(conversationId, entry);
        }
      } catch {
        this.rebuildLastByChatFromHistory();
      }
    } else {
      this.rebuildLastByChatFromHistory();
    }
  }

  private rebuildLastByChatFromHistory(): void {
    this.lastByChat.clear();
    for (const entry of this.history) {
      this.lastByChat.set(entry.conversationId, entry);
    }
  }

  private persistCampaigns(): void {
    const payload: CampaignsFile = { campaigns: Array.from(this.campaigns.values()) };
    writeFileSync(this.campaignsPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  private persistLastByChat(): void {
    const payload: Record<string, SendHistoryEntry> = {};
    for (const [conversationId, entry] of this.lastByChat) {
      payload[String(conversationId)] = entry;
    }
    writeFileSync(this.lastByChatPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
}

function cloneCampaign(campaign: Campaign): Campaign {
  return {
    ...campaign,
    groups: campaign.groups.map((group) => ({ ...group })),
    messages: [...campaign.messages],
    rotationState: Object.fromEntries(
      Object.entries(campaign.rotationState).map(([key, state]) => [key, { ...state }]),
    ),
  };
}
