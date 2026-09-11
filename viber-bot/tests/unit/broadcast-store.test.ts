import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BroadcastStore } from '../../src/broadcast/broadcast-store.js';
import type { Campaign, SendHistoryEntry } from '../../src/broadcast/types.js';

describe('BroadcastStore', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const createStore = (): BroadcastStore => {
    const dir = mkdtempSync(join(tmpdir(), 'viber-broadcast-'));
    dirs.push(dir);
    return new BroadcastStore(dir);
  };

  const campaign = (overrides: Partial<Campaign> = {}): Campaign => ({
    id: 'campaign_1',
    name: 'Test',
    groups: [{ conversationId: 26, name: 'Alpha' }],
    messages: ['hello', 'world'],
    intervalMs: 60_000,
    minIntervalPerChatMs: 60_000,
    rotation: 'round-robin',
    loop: true,
    activeFrom: null,
    activeTo: null,
    status: 'idle',
    nextGroupIndex: 0,
    rotationState: {},
    sentCount: 0,
    failedCount: 0,
    lastError: null,
    createdAt: '2026-09-06T10:00:00.000Z',
    updatedAt: '2026-09-06T10:00:00.000Z',
    startedAt: null,
    stoppedAt: null,
    ...overrides,
  });

  const send = (overrides: Partial<SendHistoryEntry> = {}): SendHistoryEntry => ({
    id: 'send_1',
    campaignId: 'campaign_1',
    conversationId: 26,
    conversationName: 'Alpha',
    messageIndex: 0,
    text: 'hello',
    status: 'sent',
    error: null,
    sentAt: '2026-09-06T10:01:00.000Z',
    ...overrides,
  });

  it('persists campaigns and reloads them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'viber-broadcast-'));
    dirs.push(dir);
    const store = new BroadcastStore(dir);
    store.saveCampaign(campaign());

    const reloaded = new BroadcastStore(dir);
    expect(reloaded.getCampaign('campaign_1')?.name).toBe('Test');
    expect(reloaded.getCampaign('campaign_1')?.messages).toEqual(['hello', 'world']);
  });

  it('marks a running campaign as stopped after a process restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'viber-broadcast-'));
    dirs.push(dir);
    new BroadcastStore(dir).saveCampaign(campaign({ status: 'running' }));

    const reloaded = new BroadcastStore(dir);
    const restored = reloaded.getCampaign('campaign_1');
    expect(restored?.status).toBe('stopped');
    expect(restored?.lastError).toMatch(/перезапущен/i);
  });

  it('tracks the last successful send per chat', () => {
    const store = createStore();
    store.appendHistory(send({ conversationId: 26, text: 'first', sentAt: '2026-09-06T10:01:00.000Z' }));
    store.appendHistory(
      send({
        id: 'send_2',
        conversationId: 31,
        conversationName: 'Beta',
        text: 'other',
        sentAt: '2026-09-06T10:02:00.000Z',
      }),
    );
    store.appendHistory(
      send({
        id: 'send_3',
        conversationId: 26,
        text: 'second',
        messageIndex: 1,
        sentAt: '2026-09-06T10:03:00.000Z',
      }),
    );

    const last = store.lastSends();
    expect(last).toHaveLength(2);
    expect(store.lastSendForChat(26)?.text).toBe('second');
    expect(store.lastSentAtMap().get(26)).toBe(Date.parse('2026-09-06T10:03:00.000Z'));
  });

  it('does not put failed sends into the per-chat cooldown map', () => {
    const store = createStore();
    store.appendHistory(send({ status: 'failed', error: 'timeout' }));
    expect(store.lastSentAtMap().size).toBe(0);
    expect(store.lastSendForChat(26)?.status).toBe('failed');
  });

  it('filters history by chat and campaign', () => {
    const store = createStore();
    store.appendHistory(send());
    store.appendHistory(
      send({
        id: 'send_2',
        campaignId: 'campaign_2',
        conversationId: 31,
        sentAt: '2026-09-06T10:02:00.000Z',
      }),
    );

    expect(store.listHistory({ conversationId: 26, limit: 10 })).toHaveLength(1);
    expect(store.listHistory({ campaignId: 'campaign_2', limit: 10 })[0]?.id).toBe('send_2');
  });

  it('writes history as jsonl', () => {
    const dir = mkdtempSync(join(tmpdir(), 'viber-broadcast-'));
    dirs.push(dir);
    const store = new BroadcastStore(dir);
    store.appendHistory(send());
    const raw = readFileSync(join(dir, 'history.jsonl'), 'utf8').trim();
    expect(JSON.parse(raw).text).toBe('hello');
  });
});
