import type { RotationStrategy } from './rotation.js';

export type CampaignStatus = 'idle' | 'running' | 'stopped' | 'error';

export interface CampaignGroup {
  conversationId: number;
  name: string | null;
}

export interface ChatRotationState {
  sendCount: number;
  lastMessageIndex: number | null;
}

export interface Campaign {
  id: string;
  name: string;
  groups: CampaignGroup[];
  messages: string[];
  intervalMs: number;
  minIntervalPerChatMs: number;
  rotation: RotationStrategy;
  loop: boolean;
  /** Local HH:mm. Null means no start bound (24/7 together with activeTo). */
  activeFrom: string | null;
  /** Local HH:mm, exclusive. Null means no end bound. */
  activeTo: string | null;
  status: CampaignStatus;
  nextGroupIndex: number;
  rotationState: Record<string, ChatRotationState>;
  sentCount: number;
  failedCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
}

export type SendStatus = 'sent' | 'failed';

export interface SendHistoryEntry {
  id: string;
  campaignId: string;
  conversationId: number;
  conversationName: string | null;
  messageIndex: number;
  text: string;
  status: SendStatus;
  error: string | null;
  sentAt: string;
}
