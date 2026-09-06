import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';

import { AdbError, describeSpawnFailure, isRecoverable, probeTcp } from '../../src/device/adb.js';

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

describe('describeSpawnFailure', () => {
  it('reports a timeout as a timeout rather than a failure to start', () => {
    const failure = describeSpawnFailure(['shell', 'echo hi'], errno('ETIMEDOUT'), 120_000);

    expect(failure.timedOut).toBe(true);
    expect(failure.message).toContain('timed out after 120000ms');
    expect(failure.message).toContain('adb shell echo hi');
    expect(failure.message).not.toContain('failed to start');
  });

  it('treats a killed process as a timeout too', () => {
    const failure = describeSpawnFailure(['shell', 'id'], errno('ENOENT'), 5_000, 'SIGTERM');

    expect(failure.timedOut).toBe(true);
  });

  it('reports a binary that could not be launched as such', () => {
    const failure = describeSpawnFailure(['devices'], errno('ENOENT'), 120_000);

    expect(failure.timedOut).toBe(false);
    expect(failure.message).toContain('failed to start');
  });
});

describe('isRecoverable', () => {
  it('accepts a timeout, which is what a wedged adbd looks like', () => {
    expect(isRecoverable(new AdbError('adb shell timed out', ['shell'], '', '', true))).toBe(true);
  });

  it('accepts an offline device', () => {
    expect(isRecoverable(new AdbError('failed', ['shell'], '', 'adb: device offline'))).toBe(true);
  });

  it('accepts a device that dropped off the list', () => {
    expect(
      isRecoverable(new AdbError('failed', ['shell'], '', 'error: device not found')),
    ).toBe(true);
  });

  it('accepts a closed transport', () => {
    expect(
      isRecoverable(new AdbError('failed', ['shell'], 'error: closed', '')),
    ).toBe(true);
  });

  it('rejects an ordinary command failure that reconnecting will not fix', () => {
    expect(
      isRecoverable(new AdbError('failed', ['shell'], '', 'cp: bad permissions')),
    ).toBe(false);
  });

  it('rejects anything that is not an adb failure', () => {
    expect(isRecoverable(new Error('sqlite3 rejected the query'))).toBe(false);
  });
});

describe('probeTcp', () => {
  it('treats USB serials as reachable so adb still runs', async () => {
    await expect(probeTcp('emulator-5554')).resolves.toBe(true);
  });

  it('returns false when the port refuses connections', async () => {
    await expect(probeTcp('127.0.0.1:1', 250)).resolves.toBe(false);
  });

  it('returns true when the port accepts a connection', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('expected a TCP address');
      }
      await expect(probeTcp(`127.0.0.1:${String(address.port)}`)).resolves.toBe(true);
    } finally {
      server.close();
    }
  });
});
