import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContactEnrichmentService } from '../../src/features/messages/contact-enrichment.service.js';
import type { MessageWatchService } from '../../src/features/messages/message-watch.service.js';
import { MessagesMonitorService } from '../../src/features/messages/messages-monitor.service.js';
import type { MonitoredMessageDto } from '../../src/features/messages/dto/monitored-message.dto.js';
import { DeviceMutexService } from '../../src/platform/mutex/device-mutex.service.js';
import type { DeviceContext } from '../../src/platform/context.js';
import type { ViberLifecycleService } from '../../src/platform/viber-lifecycle.service.js';
import type { RabbitMqPublisher } from '../../src/rabbitmq/rabbitmq-publisher.service.js';
import type { Message } from '../../src/viber/repository.js';

const { openDevice } = vi.hoisted(() => ({ openDevice: vi.fn() }));
vi.mock('../../src/platform/context.js', () => ({ openDevice }));

const ENCRYPTED_MEMBER_ID = 'em:AQBqVX+8eph1gBpvAAC4p8pP+S4/MnTOjv8p6B8oJZ1YNdm55cbue5hJ';

interface FakeContext {
  context: DeviceContext;
  refresh: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  updateLiveRow: ReturnType<typeof vi.fn>;
  messagesSince: ReturnType<typeof vi.fn>;
  communityMessagesSince: ReturnType<typeof vi.fn>;
  lastServerMessageId: ReturnType<typeof vi.fn>;
}

function fakeContext(): FakeContext {
  const refresh = vi.fn();
  const query = vi.fn(() => []);
  const updateLiveRow = vi.fn();
  const messagesSince = vi.fn(() => []);
  const communityMessagesSince = vi.fn(() => []);
  const lastServerMessageId = vi.fn(() => 0);
  const context = {
    adb: {},
    db: { refresh, query, updateLiveRow },
    viber: { messagesSince, communityMessagesSince, lastServerMessageId },
  } as unknown as DeviceContext;
  return { context, refresh, query, updateLiveRow, messagesSince, communityMessagesSince, lastServerMessageId };
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 101,
    conversationId: 26,
    token: '1234567890',
    date: new Date('2026-09-05T12:00:00Z'),
    body: 'Привет',
    senderId: 42,
    senderMemberId: ENCRYPTED_MEMBER_ID,
    senderName: 'Иван',
    senderNumber: null,
    outgoing: false,
    extraMime: null,
    mediaUri: null,
    unread: false,
    ...overrides,
  };
}

function storedMessage(overrides: Partial<MonitoredMessageDto> = {}): MonitoredMessageDto {
  return {
    instanceId: 'emulator-a',
    id: 101,
    conversationId: 26,
    conversationName: 'Группа',
    viberGroupId: '987654321',
    token: '1234567890',
    date: '2026-09-05T12:00:00.000Z',
    body: 'Привет',
    senderId: 42,
    senderName: 'Иван',
    senderMemberId: 'alV/vHqYdYA=',
    outgoing: false,
    hasPhoneInText: false,
    attachedPhone: null,
    phoneSource: 'none',
    hasMedia: false,
    ...overrides,
  };
}

function fakeWatch(): MessageWatchService & {
  attach: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
} {
  return {
    setHandler: vi.fn(),
    isAttached: vi.fn(() => false),
    attach: vi.fn(() => Promise.resolve(true)),
    detach: vi.fn(() => Promise.resolve()),
  } as unknown as MessageWatchService & {
    attach: ReturnType<typeof vi.fn>;
    detach: ReturnType<typeof vi.fn>;
  };
}

interface MonitorInternals {
  pollTick(): Promise<void>;
  nextPollDelay(fetchedCount: number): number;
  ensureLiveWatch(): Promise<void>;
  isRunning: boolean;
  pollTimeout: NodeJS.Timeout | null;
  deviceMutex?: DeviceMutexService;
  contactEnrichment?: ContactEnrichmentService;
  viberLifecycle?: ViberLifecycleService;
}

const dirs: string[] = [];

function publisher(): RabbitMqPublisher & { publishMessage: ReturnType<typeof vi.fn> } {
  return { publishMessage: vi.fn() } as unknown as RabbitMqPublisher & {
    publishMessage: ReturnType<typeof vi.fn>;
  };
}

function createService(options: {
  mutex?: DeviceMutexService;
  enrichment?: ContactEnrichmentService;
  watch?: MessageWatchService;
  lifecycle?: ViberLifecycleService;
  publisher?: RabbitMqPublisher;
} = {}): MessagesMonitorService {
  const dir = mkdtempSync(join(tmpdir(), 'viber-monitor-live-'));
  dirs.push(dir);
  process.env['MONITOR_DATA_DIR'] = dir;
  const service = new MessagesMonitorService(options.watch, options.publisher ?? publisher());
  const internals = service as unknown as MonitorInternals;
  if (options.mutex) internals.deviceMutex = options.mutex;
  if (options.enrichment) internals.contactEnrichment = options.enrichment;
  if (options.lifecycle) internals.viberLifecycle = options.lifecycle;
  return service;
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

async function runOneTick(service: MessagesMonitorService): Promise<void> {
  const internals = service as unknown as MonitorInternals;
  internals.isRunning = true;
  try {
    await internals.pollTick();
  } finally {
    service.stop();
  }
}

beforeEach(() => {
  openDevice.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env['MONITOR_DATA_DIR'];
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('safe monitor polling', () => {
  it('stands down while another task owns the emulator', async () => {
    const fake = fakeContext();
    openDevice.mockResolvedValue(fake.context);
    const mutex = new DeviceMutexService();
    const service = createService({ mutex });
    service.enableTrackedGroup(26, { fromLatest: false });
    mutex.tryLock('collect-participants');

    await runOneTick(service);

    expect(openDevice).not.toHaveBeenCalled();
    expect(fake.refresh).not.toHaveBeenCalled();
  });

  it('holds and always releases the lock around snapshot refresh and message read', async () => {
    const fake = fakeContext();
    fake.refresh.mockImplementation(() => {
      throw new Error('device disappeared');
    });
    openDevice.mockResolvedValue(fake.context);
    const mutex = new DeviceMutexService();
    const service = createService({ mutex });
    service.enableTrackedGroup(26, { fromLatest: false });

    await runOneTick(service);

    expect(fake.refresh).toHaveBeenCalledTimes(1);
    expect(mutex.isLocked()).toBe(false);
  });

  it('backs off an unreachable device and retries after the cooldown', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const fake = fakeContext();
    openDevice.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(fake.context);
    const service = createService({ mutex: new DeviceMutexService() });
    service.enableTrackedGroup(26, { fromLatest: false });

    await runOneTick(service);
    now.mockReturnValue(10_001);
    await runOneTick(service);
    expect(openDevice).toHaveBeenCalledTimes(1);

    now.mockReturnValue(15_001);
    await runOneTick(service);
    expect(openDevice).toHaveBeenCalledTimes(2);
    expect(fake.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not fast-poll the device when the live watch is unavailable', () => {
    const service = createService({ watch: fakeWatch() });
    const internals = service as unknown as MonitorInternals;

    expect(internals.nextPollDelay(0)).toBe(2500);
  });
});

describe('stable message deduplication', () => {
  it('deduplicates valid tokens but keeps the same row id from another conversation', async () => {
    const fake = fakeContext();
    fake.messagesSince
      .mockReturnValueOnce([
        message({ id: 10, conversationId: 26, token: 'shared-token' }),
        message({ id: 10, conversationId: 27, token: null }),
      ])
      .mockReturnValueOnce([
        message({ id: 999, conversationId: 26, token: 'shared-token' }),
        message({ id: 10, conversationId: 28, token: null }),
      ]);
    openDevice.mockResolvedValue(fake.context);
    const out = publisher();
    const service = createService({ publisher: out });
    service.enableTrackedGroup(26, { fromLatest: false });
    service.enableTrackedGroup(27, { fromLatest: false });
    service.enableTrackedGroup(28, { fromLatest: false });

    await runOneTick(service);
    await runOneTick(service);

    expect(out.publishMessage).toHaveBeenCalledTimes(3);
  });

  it('hydrates token dedupe keys from persisted history after restart', async () => {
    const fake = fakeContext();
    fake.messagesSince
      .mockReturnValueOnce([message({ id: 10, token: 'persistent-token' })])
      .mockReturnValueOnce([message({ id: 999, token: 'persistent-token' })]);
    openDevice.mockResolvedValue(fake.context);
    const firstOut = publisher();
    const first = createService({ publisher: firstOut });
    first.enableTrackedGroup(26, { fromLatest: false });
    await runOneTick(first);
    expect(firstOut.publishMessage).toHaveBeenCalledTimes(1);

    const secondOut = publisher();
    const second = new MessagesMonitorService(undefined, secondOut);
    second.enableTrackedGroup(26, { fromLatest: false });
    await runOneTick(second);

    expect(secondOut.publishMessage).not.toHaveBeenCalled();
  });

  it('hydrates dedupe keys from history older than the 2000-message ring buffer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'viber-monitor-live-'));
    dirs.push(dir);
    process.env['MONITOR_DATA_DIR'] = dir;
    const history = Array.from({ length: 2_001 }, (_, index) =>
      JSON.stringify(storedMessage({
        id: index + 1,
        token: index === 0 ? 'old-token' : `token-${String(index + 1)}`,
        senderId: null,
        senderMemberId: null,
      })),
    ).join('\n');
    writeFileSync(join(dir, 'monitored-messages.jsonl'), `${history}\n`, 'utf8');

    const fake = fakeContext();
    fake.messagesSince.mockReturnValue([
      message({ id: 99_999, token: 'old-token', senderId: null, senderMemberId: null }),
    ]);
    openDevice.mockResolvedValue(fake.context);
    const out = publisher();
    const service = new MessagesMonitorService(undefined, out);
    service.enableTrackedGroup(26, { fromLatest: false });

    await runOneTick(service);

    expect(service.getMonitoredMessages({ limit: 0 })).toHaveLength(2_000);
    expect(out.publishMessage).not.toHaveBeenCalled();
  });
});

describe('live participant enrichment', () => {
  it('writes a decoded member id once and never touches self or outgoing rows', async () => {
    const fake = fakeContext();
    openDevice.mockResolvedValue(fake.context);
    const service = createService({ mutex: new DeviceMutexService() });

    service.processMessage(message({ id: 101 }));
    service.processMessage(message({ id: 102 }));
    service.processMessage(message({ id: 103, senderId: 1 }));
    service.processMessage(message({ id: 104, outgoing: true }));
    await settle();

    expect(fake.updateLiveRow).toHaveBeenCalledTimes(1);
    expect(fake.updateLiveRow.mock.calls[0]?.[0]).toContain("member_id = 'alV/vHqYdYA='");
    expect(fake.updateLiveRow.mock.calls[0]?.[0]).toContain('participant_type');
  });

  it('batches writes into one Viber-only restart and reconnects the watcher', async () => {
    vi.useFakeTimers();
    const fake = fakeContext();
    openDevice.mockResolvedValue(fake.context);
    const watch = fakeWatch();
    const lifecycle = { restartApp: vi.fn(() => Promise.resolve(true)) } as unknown as ViberLifecycleService;
    const service = createService({ mutex: new DeviceMutexService(), watch, lifecycle });
    (service as unknown as MonitorInternals).isRunning = true;

    service.processMessage(message({ senderId: 42 }));
    service.processMessage(message({ id: 102, senderId: 43, senderMemberId: 'YWJjZGVmZ2g=' }));
    await vi.advanceTimersByTimeAsync(3_000);

    expect(lifecycle.restartApp).toHaveBeenCalledTimes(1);
    expect(watch.detach).toHaveBeenCalledTimes(1);
    expect(watch.attach).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it('retains a failed restart batch and retries it', async () => {
    vi.useFakeTimers();
    const fake = fakeContext();
    openDevice.mockResolvedValue(fake.context);
    const lifecycle = {
      restartApp: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
    } as unknown as ViberLifecycleService;
    const service = createService({ mutex: new DeviceMutexService(), lifecycle });
    (service as unknown as MonitorInternals).isRunning = true;

    service.processMessage(message());
    await vi.advanceTimersByTimeAsync(3_000);
    expect(lifecycle.restartApp).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lifecycle.restartApp).toHaveBeenCalledTimes(2);
    service.stop();
  });

  it('does not restart after the monitor stops with a batch pending', async () => {
    vi.useFakeTimers();
    const fake = fakeContext();
    openDevice.mockResolvedValue(fake.context);
    const lifecycle = { restartApp: vi.fn(() => Promise.resolve(true)) } as unknown as ViberLifecycleService;
    const service = createService({ mutex: new DeviceMutexService(), lifecycle });
    (service as unknown as MonitorInternals).isRunning = true;

    service.processMessage(message());
    await vi.advanceTimersByTimeAsync(0);
    service.stop();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(lifecycle.restartApp).not.toHaveBeenCalled();
  });

  it('refreshes a late profile phone in memory and persisted history without replacing a text phone', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const fake = fakeContext();
    fake.messagesSince.mockReturnValueOnce([
      message({ id: 101 }),
      message({ id: 102, token: '2', body: 'Звоните +380501234567' }),
    ]);
    fake.query.mockReturnValueOnce([]).mockReturnValueOnce([
      {
        id: 42,
        memberId: 'alV/vHqYdYA=',
        encryptedMemberId: ENCRYPTED_MEMBER_ID,
        number: '+380988806081',
        participantType: 1,
        safeContact: 0,
        contactName: 'Иван',
        displayName: 'Иван',
        viberName: 'Иван',
      },
    ]);
    openDevice.mockResolvedValue(fake.context);
    const out = publisher();
    const service = createService({ enrichment: new ContactEnrichmentService(), publisher: out });
    service.enableTrackedGroup(26, { fromLatest: false });

    await runOneTick(service);
    now.mockReturnValue(15_001);
    await runOneTick(service);

    const messages = service.getMonitoredMessages({ limit: 0 });
    expect(messages.find((item) => item.id === 101)).toMatchObject({
      attachedPhone: '+380988806081',
      phoneSource: 'viber_profile',
    });
    expect(messages.find((item) => item.id === 102)?.attachedPhone).toBe('+380501234567');
    expect(out.publishMessage).toHaveBeenCalledTimes(3);
    const stored = readFileSync(join(process.env['MONITOR_DATA_DIR']!, 'monitored-messages.jsonl'), 'utf8');
    expect(stored).toContain('+380988806081');
  });

  it('does not attach a recycled participant row phone to an older sender identity', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const fake = fakeContext();
    fake.messagesSince.mockReturnValueOnce([message()]);
    fake.query.mockReturnValueOnce([]).mockReturnValueOnce([
      {
        id: 42,
        memberId: 'YWJjZGVmZ2g=',
        encryptedMemberId: null,
        number: '+380988806081',
        participantType: 1,
        safeContact: 0,
        contactName: 'Другой человек',
        displayName: 'Другой человек',
        viberName: 'Другой человек',
      },
    ]);
    openDevice.mockResolvedValue(fake.context);
    const out = publisher();
    const service = createService({ enrichment: new ContactEnrichmentService(), publisher: out });
    service.enableTrackedGroup(26, { fromLatest: false });

    await runOneTick(service);
    now.mockReturnValue(15_001);
    await runOneTick(service);

    expect(service.getMonitoredMessages()[0]).toMatchObject({
      senderMemberId: 'alV/vHqYdYA=',
      attachedPhone: null,
      phoneSource: 'none',
    });
    expect(out.publishMessage).toHaveBeenCalledTimes(1);
  });

  it('persists enrichments by token when recycled rows share conversation and row id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'viber-monitor-live-'));
    dirs.push(dir);
    process.env['MONITOR_DATA_DIR'] = dir;
    writeFileSync(
      join(dir, 'monitored-messages.jsonl'),
      [
        storedMessage({ token: 'old-token', senderMemberId: 'alV/vHqYdYA=' }),
        storedMessage({ token: 'new-token', senderMemberId: 'YWJjZGVmZ2g=' }),
      ].map((item) => JSON.stringify(item)).join('\n') + '\n',
      'utf8',
    );
    const enrichment = new ContactEnrichmentService();
    enrichment.learn('alV/vHqYdYA=', 'Иван', '+380501111111');
    enrichment.learn('YWJjZGVmZ2g=', 'Пётр', '+380502222222');
    const service = new MessagesMonitorService(undefined, publisher(), enrichment);

    service.getMonitoredMessages({ limit: 0 });

    const persisted = readFileSync(join(dir, 'monitored-messages.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as MonitoredMessageDto);
    expect(persisted).toEqual([
      expect.objectContaining({ token: 'old-token', attachedPhone: '+380501111111' }),
      expect.objectContaining({ token: 'new-token', attachedPhone: '+380502222222' }),
    ]);
  });
});

describe('watcher lifecycle', () => {
  it('detaches a session that finishes attaching after the monitor stopped', async () => {
    let finishAttach!: (attached: boolean) => void;
    const fake = fakeContext();
    openDevice.mockResolvedValue(fake.context);
    const watch = fakeWatch();
    watch.attach.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { finishAttach = resolve; }),
    );
    const service = createService({ watch });
    const internals = service as unknown as MonitorInternals;
    internals.isRunning = true;

    const attaching = internals.ensureLiveWatch();
    await vi.waitFor(() => expect(watch.attach).toHaveBeenCalledTimes(1));
    service.stop();
    finishAttach(true);
    await attaching;

    expect(watch.detach).toHaveBeenCalledTimes(2);
  });
});

describe('community message monitoring', () => {
  it('ingests messages from communityMessagesSince and advances lastServerMessageId', async () => {
    const fake = fakeContext();
    fake.messagesSince.mockReturnValue([]);
    fake.communityMessagesSince.mockReturnValueOnce([
      message({
        id: 289585,
        conversationId: 18,
        token: null,
        body: 'Потрібні вантажники 0981234567',
        senderName: 'Олег',
        senderMemberId: null,
        senderNumber: '+380981234567',
      }),
    ]);
    openDevice.mockResolvedValue(fake.context);
    const out = publisher();
    const service = createService({ publisher: out });
    service.enableTrackedGroup(18, { fromLatest: false });

    await runOneTick(service);

    expect(out.publishMessage).toHaveBeenCalledTimes(1);
    const published = out.publishMessage.mock.calls[0]![0];
    expect(published).toMatchObject({
      id: 289585,
      conversationId: 18,
      body: 'Потрібні вантажники 0981234567',
      attachedPhone: '+380981234567',
    });
    expect(service.getStatus().groups.find((g) => g.conversationId === 18)?.lastServerMessageId).toBe(289585);
  });
});
