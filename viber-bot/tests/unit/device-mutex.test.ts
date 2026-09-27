import { describe, expect, it } from 'vitest';
import { DeviceMutexService } from '../../src/platform/mutex/device-mutex.service.js';

describe('DeviceMutexService', () => {
  it('acquires and releases exclusive lock', () => {
    const mutex = new DeviceMutexService();
    expect(mutex.isLocked()).toBe(false);

    expect(mutex.tryLock('task-1')).toBe(true);
    expect(mutex.isLocked()).toBe(true);
    expect(mutex.getLockInfo()?.taskId).toBe('task-1');

    // Second task fails to acquire lock while held
    expect(mutex.tryLock('task-2')).toBe(false);
    expect(mutex.getLockInfo()?.taskId).toBe('task-1');

    // Unlocking with wrong task id fails silently without releasing
    mutex.unlock('task-wrong');
    expect(mutex.isLocked()).toBe(true);

    // Releasing with correct task id
    mutex.unlock('task-1');
    expect(mutex.isLocked()).toBe(false);

    // Now task-2 can acquire
    expect(mutex.tryLock('task-2')).toBe(true);
    expect(mutex.getLockInfo()?.taskId).toBe('task-2');
  });
});
