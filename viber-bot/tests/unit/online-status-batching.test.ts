import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageType, type Message } from 'frida';
import type { Adb } from '../../src/device/adb.js';

const mocks = vi.hoisted(() => ({
  createFridaRuntime: vi.fn(),
}));

vi.mock('../../src/intercept/frida-runtime.js', () => ({
  createFridaRuntime: mocks.createFridaRuntime,
}));

vi.mock('../../src/config/env.js', () => ({
  loadAdbConfig: () => ({ bin: 'adb', serial: 'device' }),
  loadViberConfig: () => ({ appPackage: 'com.viber.voip' }),
}));

import { OnlineStatusService } from '../../src/automation/frida/online-status.service.js';

describe('OnlineStatusService batching', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('does not let a completed batch timeout discard the next batch reply', async () => {
    vi.useFakeTimers();
    let messageHandler: ((message: Message) => void) | undefined;
    let postCount = 0;

    const script = {
      message: {
        connect: vi.fn((handler: (message: Message) => void) => {
          messageHandler = handler;
        }),
      },
      load: vi.fn().mockResolvedValue(undefined),
      post: vi.fn((request: { memberIds: string[]; token: number }) => {
        postCount += 1;
        const delayMs = postCount === 1 ? 100 : 5_950;
        setTimeout(() => {
          messageHandler?.({
            type: MessageType.Send,
            payload: {
              event: 'onLastOnline-reply',
              token: request.token,
              results: [
                {
                  memberId: request.memberIds[0],
                  isOnline: false,
                  lastSeenTimestamp: 1_788_632_355_799,
                  lastSeen: '2026-09-05T18:19:15.799Z',
                },
              ],
            },
          } as Message);
        }, delayMs);
      }),
    };
    const session = {
      createScript: vi.fn().mockResolvedValue(script),
      detach: vi.fn().mockResolvedValue(undefined),
    };

    mocks.createFridaRuntime.mockReturnValue({
      ensureRoot: vi.fn(),
      readClientVersion: vi.fn(() => '17.0.0'),
      deviceAbi: vi.fn(() => 'x86_64'),
      ensureServerRunning: vi.fn().mockResolvedValue(undefined),
      waitForFridaDevice: vi.fn().mockResolvedValue({}),
      resolveViberPid: vi.fn().mockResolvedValue(42),
      attachWithRetry: vi.fn().mockResolvedValue(session),
      compileAgent: vi.fn(() => 'agent source'),
    });

    const promise = new OnlineStatusService().fetchOnlineStatuses(
      { shell: vi.fn() } as unknown as Adb,
      ['first', 'second'],
      { batchSize: 1, timeoutMs: 6_000 },
    );

    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(5_950);
    await vi.advanceTimersByTimeAsync(50);

    const result = await promise;
    expect(result.get('first')?.lastSeen).toBe('2026-09-05T18:19:15.799Z');
    expect(result.get('second')?.lastSeen).toBe('2026-09-05T18:19:15.799Z');
  });
});
