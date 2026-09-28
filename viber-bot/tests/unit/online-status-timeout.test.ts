import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Adb } from '../../src/platform/adb.js';

const mocks = vi.hoisted(() => ({ createFridaRuntime: vi.fn() }));

vi.mock('../../src/platform/frida/frida-runtime.js', () => ({
  createFridaRuntime: mocks.createFridaRuntime,
}));

vi.mock('../../src/config/env.js', () => ({
  loadAdbConfig: () => ({ bin: 'adb', serial: 'device' }),
  loadViberConfig: () => ({ appPackage: 'com.viber.voip' }),
}));

import { OnlineStatusService } from '../../src/features/participants/online-status.service.js';

/** Builds a mock Frida script whose post() never sends a reply (Viber wedged). */
function silentRuntime(): { postCount: () => number } {
  let posts = 0;
  const script = {
    message: { connect: vi.fn() },
    load: vi.fn().mockResolvedValue(undefined),
    post: vi.fn(() => {
      posts += 1;
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
  return { postCount: () => posts };
}

describe('OnlineStatusService timeouts', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('stops after N consecutive timeouts and leaves unanswered members unknown', async () => {
    vi.useFakeTimers();
    const runtime = silentRuntime();

    const promise = new OnlineStatusService().fetchOnlineStatuses(
      { shell: vi.fn() } as unknown as Adb,
      ['a', 'b', 'c', 'd', 'e'],
      { batchSize: 1, timeoutMs: 1_000, maxConsecutiveTimeouts: 2, pauseBetweenBatchesMs: 0 },
    );

    await vi.advanceTimersByTimeAsync(500); // agent registration delay
    await vi.advanceTimersByTimeAsync(1_000); // batch 1 times out
    await vi.advanceTimersByTimeAsync(1_000); // batch 2 times out -> stop

    const result = await promise;

    // Never answered: no member is invented as offline, and the walk stopped
    // before querying every member.
    expect(result.size).toBe(0);
    expect(runtime.postCount()).toBe(2);
  });
});
