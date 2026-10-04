import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ probeTcp: vi.fn() }));

vi.mock('../../src/platform/adb.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/platform/adb.js')>()),
  probeTcp: mocks.probeTcp,
}));

import { Adb } from '../../src/platform/adb.js';
import { openDevice } from '../../src/platform/context.js';
import { LdPlayer } from '../../src/platform/ldplayer.js';

describe('openDevice without booting the emulator', () => {
  beforeEach(() => {
    mocks.probeTcp.mockResolvedValue(false);
    vi.spyOn(LdPlayer.prototype, 'isAvailable').mockReturnValue(false);
    vi.spyOn(Adb.prototype, 'connect').mockImplementation(() => undefined);
    vi.spyOn(Adb.prototype, 'root').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the device when the TCP probe misses but adb already holds it', async () => {
    vi.spyOn(Adb.prototype, 'reportsDevice').mockReturnValue(true);

    const context = await openDevice({ ensureUp: false });

    expect(context.adb).toBeInstanceOf(Adb);
    expect(Adb.prototype.connect).toHaveBeenCalledTimes(1);
  });

  it('reports the emulator as unreachable only when adb agrees', async () => {
    vi.spyOn(Adb.prototype, 'reportsDevice').mockReturnValue(false);

    await expect(openDevice({ ensureUp: false })).rejects.toThrow(/Could not connect to/);
    expect(Adb.prototype.connect).not.toHaveBeenCalled();
  });
});
