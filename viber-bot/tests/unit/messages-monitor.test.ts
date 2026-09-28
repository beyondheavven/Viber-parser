import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MessagesMonitorService } from '../../src/features/messages/messages-monitor.service.js';
import { formatMonitoredExport } from '../../src/features/messages/monitor-export.util.js';
import type { Message } from '../../src/viber/repository.js';
import type { MonitoredMessageDto } from '../../src/features/messages/dto/monitored-message.dto.js';
import type { RabbitMqPublisher } from '../../src/rabbitmq/rabbitmq-publisher.service.js';

/** The monitor publishes every captured message; these tests read its files. */
function silentPublisher(): RabbitMqPublisher {
  return { publishTaskEvent: () => undefined, publish: () => undefined } as unknown as RabbitMqPublisher;
}

describe('MessagesMonitorService', () => {
  const dirs: string[] = [];

  afterEach(() => {
    delete process.env['MONITOR_DATA_DIR'];
    delete process.env['VIBER_INSTANCE_ID'];
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const createService = (): MessagesMonitorService => {
    const dir = mkdtempSync(join(tmpdir(), 'viber-monitor-'));
    dirs.push(dir);
    process.env['MONITOR_DATA_DIR'] = dir;
    return new MessagesMonitorService(undefined, silentPublisher());
  };

  const createMockMessage = (overrides: Partial<Message> = {}): Message => ({
    id: 101,
    conversationId: 26,
    token: '1234567890',
    date: new Date('2026-09-05T12:00:00Z'),
    body: 'Привет, кто свободен?',
    senderId: 42,
    senderMemberId: 'test_member_id',
    senderName: 'Иван',
    senderNumber: '+380988806081',
    outgoing: false,
    extraMime: null,
    mediaUri: null,
    unread: false,
    ...overrides,
  });

  describe('Business Rule: Phone Extraction Precedence', () => {
    const service = (): MessagesMonitorService => createService();

    it('pins phone from text when message body contains a phone number, ignoring Viber profile', () => {
      process.env['VIBER_INSTANCE_ID'] = 'emulator-worker-1';
      const processed = service().processMessage(
        createMockMessage({
          body: 'Продам шины, дзвоніть 0501234567 терміново!',
          senderNumber: '+380988806081',
        }),
        'АVTOTRAL🚨',
        '987654321',
      );

      expect(processed.hasPhoneInText).toBe(true);
      expect(processed.attachedPhone).toBe('+380501234567');
      expect(processed.phoneSource).toBe('message_text');
      expect(processed.allFoundPhones).toEqual(['+380501234567']);
      expect(processed.hasMedia).toBe(false);
      expect(processed.instanceId).toBe('emulator-worker-1');
      expect(processed.viberGroupId).toBe('987654321');
    });

    it('falls back to Viber profile when message body does NOT contain a phone number', () => {
      const processed = service().processMessage(
        createMockMessage({
          body: 'Всім привіт! Які черги на кордоні?',
          senderNumber: '+380988806081',
        }),
        'АVTOTRAL🚨',
      );

      expect(processed.hasPhoneInText).toBe(false);
      expect(processed.attachedPhone).toBe('+380988806081');
      expect(processed.phoneSource).toBe('viber_profile');
    });

    it('sets phoneSource to none when neither text nor Viber profile has a phone number', () => {
      const processed = service().processMessage(
        createMockMessage({
          body: 'Текст без номера',
          senderNumber: null,
        }),
        'АVTOTRAL🚨',
      );

      expect(processed.hasPhoneInText).toBe(false);
      expect(processed.attachedPhone).toBeNull();
      expect(processed.phoneSource).toBe('none');
    });

    it('ignores encrypted member_id placeholders starting with "em:" in senderNumber', () => {
      const processed = service().processMessage(
        createMockMessage({
          body: 'Текст без номера',
          senderNumber: 'em:AQB8B/TzXl9xARpvAABG+hQaJqMfOKK2GLApGEyzQioyT5gR/zZuVogl',
        }),
        'АVTOTRAL🚨',
      );

      expect(processed.hasPhoneInText).toBe(false);
      expect(processed.attachedPhone).toBeNull();
      expect(processed.phoneSource).toBe('none');
    });

    it('treats a content:// body as a photo and does not keep the URI as text', () => {
      const processed = service().processMessage(
        createMockMessage({
          body: 'content://com.viber.voip.provider.internal_files/pg/abc/PG_MEDIA/jpg/400',
          senderNumber: null,
        }),
        '🇺🇦УКРАЇНЦІ В БЕРЛІНІ🇩🇪',
      );

      expect(processed.hasMedia).toBe(true);
      expect(processed.body).toBeNull();
      expect(processed.mediaUris).toEqual([
        'content://com.viber.voip.provider.internal_files/pg/abc/PG_MEDIA/jpg/400',
      ]);
    });

    it('exposes image URI and still extracts the phone from caption text', () => {
      const processed = service().processMessage(
        createMockMessage({
          body: '1 пас Львів-Вроцлав +380683929263',
          mediaUri: 'content://com.viber.voip.provider.internal_files/pg/abc/PG_MEDIA/jpg/400',
        }),
        '🇺🇦УКРАЇНЦІ В БЕРЛІНІ🇩🇪',
      );

      expect(processed.hasMedia).toBe(true);
      expect(processed.mediaUris).toEqual([
        'content://com.viber.voip.provider.internal_files/pg/abc/PG_MEDIA/jpg/400',
      ]);
      expect(processed.attachedPhone).toBe('+380683929263');
      expect(processed.phoneSource).toBe('message_text');
    });
  });

  describe('Stored media hydration', () => {
    it('hydrates a stored content:// body as a photo on startup', () => {
      const dir = mkdtempSync(join(tmpdir(), 'viber-monitor-'));
      dirs.push(dir);
      writeFileSync(
        join(dir, 'monitored-messages.jsonl'),
        `${JSON.stringify({
          id: 755,
          conversationId: 20,
          conversationName: 'Berlin',
          token: '1',
          date: '2026-09-05T12:00:00.000Z',
          body: 'content://com.viber.voip.provider.internal_files/pg/abc/PG_MEDIA/jpg/400',
          senderId: null,
          senderName: null,
          senderMemberId: null,
          outgoing: false,
          hasPhoneInText: false,
          attachedPhone: null,
          phoneSource: 'none',
        })}\n`,
        'utf8',
      );
      process.env['MONITOR_DATA_DIR'] = dir;
      const monitor = new MessagesMonitorService(undefined, silentPublisher());
      const [loaded] = monitor.getMonitoredMessages({ limit: 10 });
      expect(loaded?.hasMedia).toBe(true);
      expect(loaded?.body).toBeNull();
      expect(loaded?.mediaUris).toEqual([
        'content://com.viber.voip.provider.internal_files/pg/abc/PG_MEDIA/jpg/400',
      ]);
    });
  });

  describe('Per-group enable/disable and catch-up cursors', () => {
    it('enables and disables groups independently and keeps the cursor', () => {
      const monitor = createService();
      monitor.enableTrackedGroup(20, { name: 'Berlin', currentLastMessageId: 500 });
      monitor.enableTrackedGroup(22, { name: 'Travel', currentLastMessageId: 10, fromLatest: false });

      let status = monitor.getStatus();
      expect(status.groups).toMatchObject([
        { conversationId: 20, name: 'Berlin', enabled: true, lastMessageId: 500 },
        { conversationId: 22, name: 'Travel', enabled: true, lastMessageId: 0 },
      ]);

      status = monitor.disableGroup(20);
      expect(status.groups.find((group) => group.conversationId === 20)?.enabled).toBe(false);
      expect(status.groups.find((group) => group.conversationId === 20)?.lastMessageId).toBe(500);

      status = monitor.enableTrackedGroup(20);
      expect(status.groups.find((group) => group.conversationId === 20)?.enabled).toBe(true);
      expect(status.groups.find((group) => group.conversationId === 20)?.lastMessageId).toBe(500);
    });

    it('restores enabled groups and cursors after a process restart', () => {
      const dir = mkdtempSync(join(tmpdir(), 'viber-monitor-'));
      dirs.push(dir);
      process.env['MONITOR_DATA_DIR'] = dir;

      const first = new MessagesMonitorService(undefined, silentPublisher());
      first.enableTrackedGroup(26, { name: 'AVTOTRAL', currentLastMessageId: 1542 });
      first.stop();

      const raw = JSON.parse(readFileSync(join(dir, 'monitor-state.json'), 'utf8')) as {
        groups: Array<{ conversationId: number; lastMessageId: number; enabled: boolean }>;
      };
      expect(raw.groups[0]?.lastMessageId).toBe(1542);

      const second = new MessagesMonitorService(undefined, silentPublisher());
      const group = second.getGroups().find((item) => item.conversationId === 26);
      expect(group).toMatchObject({ enabled: true, lastMessageId: 1542, name: 'AVTOTRAL' });
      second.stop();
    });
  });

  describe('Monitoring lifecycle and status', () => {
    it('returns initial status with groups list', () => {
      const status = createService().getStatus();
      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('groups');
      expect(status.liveWatch).toBe(false);
      expect(status.groups).toEqual([]);
    });

    it('stops cleanly when requested', () => {
      const status = createService().stop();
      expect(status.isRunning).toBe(false);
    });
  });
});

describe('formatMonitoredExport', () => {
  const sample: MonitoredMessageDto = {
    instanceId: 'emulator-a',
    id: 11,
    conversationId: 20,
    conversationName: 'Berlin',
    viberGroupId: '987654321',
    token: '1',
    date: '2026-09-05T12:00:00.000Z',
    body: 'Київ-Варшава 0501234567',
    senderId: 5,
    senderName: 'Иван',
    senderMemberId: 'abc',
    outgoing: false,
    hasPhoneInText: true,
    attachedPhone: '+380501234567',
    phoneSource: 'message_text',
    hasMedia: true,
    mediaUris: ['content://image'],
    mergedMessageIds: [10, 11],
  };

  it('writes json with a count envelope', () => {
    const exported = formatMonitoredExport([sample], 'json', new Date('2026-09-05T12:00:00Z'));
    expect(exported.filename).toContain('.json');
    const parsed = JSON.parse(exported.body) as { count: number; messages: unknown[] };
    expect(parsed.count).toBe(1);
    expect(parsed.messages).toHaveLength(1);
  });

  it('writes csv with media columns', () => {
    const exported = formatMonitoredExport([sample], 'csv', new Date('2026-09-05T12:00:00Z'));
    expect(exported.mime).toContain('text/csv');
    expect(exported.body).toContain('hasMedia');
    expect(exported.body).toContain('content://image');
    expect(exported.body).toContain('+380501234567');
  });
});
