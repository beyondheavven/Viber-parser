import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BroadcastService } from '../../src/broadcast/broadcast.service.js';
import { abortableSleep } from '../../src/broadcast/sleep.js';
import { DeviceMutexService } from '../../src/common/mutex/device-mutex.service.js';
import type { ViberNavigationService } from '../../src/automation/navigation/viber-navigation.service.js';
import type { GroupsService } from '../../src/groups/groups.service.js';
import type { GroupDetailDto } from '../../src/groups/dto/group-response.dto.js';

const hangUntilAborted: ViberNavigationService['sendGroupMessage'] = async (
  _groupName,
  _text,
  signal,
) => {
  await abortableSleep(60_000, signal ?? new AbortController().signal);
  throw new Error('Send aborted.');
};

describe('BroadcastService', () => {
  const dirs: string[] = [];
  const services: BroadcastService[] = [];

  afterEach(async () => {
    for (const service of services.splice(0)) {
      await service.onModuleDestroy();
    }
    delete process.env['BROADCAST_DATA_DIR'];
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const groupDetail = (id: number, name: string): GroupDetailDto => ({
    id,
    type: 1,
    groupId: null,
    name,
    messageCount: 0,
    participantCount: 0,
    unreadCount: 0,
    lastMessageDate: null,
  });

  const createService = (options?: {
    send?: ViberNavigationService['sendGroupMessage'];
    getGroup?: GroupsService['getGroup'];
  }): BroadcastService => {
    const dir = mkdtempSync(join(tmpdir(), 'viber-broadcast-svc-'));
    dirs.push(dir);
    process.env['BROADCAST_DATA_DIR'] = dir;

    const navigation = {
      sendGroupMessage: options?.send ?? vi.fn(async () => {}),
    } as unknown as ViberNavigationService;

    const groupsService = {
      getGroup:
        options?.getGroup ??
        (async (id: number) => groupDetail(id, `Chat ${String(id)}`)),
    } as unknown as GroupsService;

    const service = new BroadcastService(new DeviceMutexService(), navigation, groupsService);
    services.push(service);
    return service;
  };

  it('creates a campaign, sanitizes messages and fills group names', async () => {
    const service = createService();
    const created = await service.createCampaign({
      name: 'Evening',
      conversationIds: [26, 26, 31],
      messages: ['  hello  ', 'world'],
      intervalMs: 60_000,
    });

    expect(created.status).toBe('idle');
    expect(created.rotation).toBe('shuffle-cycle');
    expect(created.loop).toBe(true);
    expect(created.messages).toEqual(['hello', 'world']);
    expect(created.groups.map((group) => group.conversationId)).toEqual([26, 31]);
    expect(created.groups[0]?.name).toBe('Chat 26');
    expect(created.minIntervalPerChatMs).toBe(60_000);
    expect(created.activeFrom).toBeNull();
    expect(created.activeTo).toBeNull();
    expect(service.listCampaigns()).toHaveLength(1);
  });

  it('stores working hours on the campaign', async () => {
    const service = createService();
    const created = await service.createCampaign({
      conversationIds: [26],
      messages: ['one'],
      intervalMs: 60_000,
      activeFrom: '09:00',
      activeTo: '21:00',
    });
    expect(created.activeFrom).toBe('09:00');
    expect(created.activeTo).toBe('21:00');
  });

  it('refuses to start a second campaign while one is running', async () => {
    const service = createService({
      send: hangUntilAborted,
    });
    const first = await service.createCampaign({
      conversationIds: [26],
      messages: ['one'],
      intervalMs: 60_000,
    });
    const second = await service.createCampaign({
      conversationIds: [31],
      messages: ['two'],
      intervalMs: 60_000,
    });

    await service.startCampaign(first.id);
    await expect(service.startCampaign(second.id)).rejects.toThrow(/уже запущена/i);
    await service.stopCampaign(first.id);
  });

  it('sends with rotation and records last-send history per chat', async () => {
    const sent: string[] = [];
    const service = createService({
      send: async (groupName, text) => {
        sent.push(`${groupName}:${text}`);
      },
    });

    const created = await service.createCampaign({
      conversationIds: [26, 31],
      messages: ['alpha', 'beta'],
      intervalMs: 5_000,
      minIntervalPerChatMs: 5_000,
      rotation: 'round-robin',
      loop: true,
    });

    await service.startCampaign(created.id);
    await vi.waitFor(() => {
      expect(service.getCampaign(created.id).sentCount).toBeGreaterThanOrEqual(1);
    });
    await service.stopCampaign(created.id);

    const last = service.getLastSends();
    expect(last.length).toBeGreaterThanOrEqual(1);
    expect(last[0]?.status).toBe('sent');
    expect(sent[0]).toMatch(/^Chat 26:alpha$/);
    expect(service.getHistory({ campaignId: created.id }).length).toBeGreaterThanOrEqual(1);
  });

  it('records a failed send without stopping the campaign', async () => {
    let calls = 0;
    const service = createService({
      send: async () => {
        calls += 1;
        if (calls === 1) throw new Error('composer not ready');
      },
    });

    const created = await service.createCampaign({
      conversationIds: [26],
      messages: ['alpha'],
      intervalMs: 5_000,
      rotation: 'round-robin',
      loop: true,
    });

    await service.startCampaign(created.id);
    await vi.waitFor(() => {
      expect(service.getCampaign(created.id).failedCount).toBeGreaterThanOrEqual(1);
    });
    await service.stopCampaign(created.id);

    expect(service.getLastSends()[0]?.status).toBe('failed');
    expect(service.getCampaign(created.id).status).toBe('stopped');
  });

  it('does not allow editing a running campaign', async () => {
    const service = createService({
      send: hangUntilAborted,
    });
    const created = await service.createCampaign({
      conversationIds: [26],
      messages: ['one'],
      intervalMs: 60_000,
    });
    await service.startCampaign(created.id);
    await expect(service.updateCampaign(created.id, { name: 'Nope' })).rejects.toThrow(/запущена/i);
    await service.stopCampaign(created.id);
  });
});
