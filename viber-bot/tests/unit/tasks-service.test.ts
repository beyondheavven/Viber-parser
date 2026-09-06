import { describe, expect, it } from 'vitest';
import { TasksService } from '../../src/tasks/tasks.service.js';
import { DeviceMutexService } from '../../src/common/mutex/device-mutex.service.js';

describe('TasksService & TaskEntity', () => {
  it('transitions through states correctly from initializing to ready', () => {
    const mutex = new DeviceMutexService();
    const service = new TasksService(mutex);

    const task = service.createTask('26');
    expect(task.status).toBe('initializing');
    expect(task.currentStep?.step).toBe('initializing');

    // Starting steps
    task.setStep('attaching_frida', 'Подключение Frida');
    expect(task.status).toBe('starting');
    expect(task.currentStep?.step).toBe('attaching_frida');

    // Running steps
    task.setStep('paging_participants', 'Сбор страниц', { pagesCount: 1 });
    expect(task.status).toBe('running');
    expect(task.currentStep?.progress?.['pagesCount']).toBe(1);

    // Update progress
    task.updateProgress({ pagesCount: 5, currentOffset: 250 });
    expect(task.progress?.['pagesCount']).toBe(5);

    // Complete
    task.complete({ count: 100 });
    expect(task.status).toBe('ready');
    expect(task.result?.['count']).toBe(100);
    expect(task.stepHistory.length).toBeGreaterThanOrEqual(3);
  });

  it('handles task cancellation via stopTask', () => {
    const mutex = new DeviceMutexService();
    const service = new TasksService(mutex);

    const task = service.createTask('26');
    mutex.tryLock(task.id);
    expect(mutex.isLocked()).toBe(true);

    task.setStep('attaching_frida', 'Подключение');
    task.setStep('paging_participants', 'Пагинация');
    expect(task.status).toBe('running');

    // Stop task
    service.stopTask(task.id);
    expect(task.status).toBe('stopped');
    expect(task.signal.aborted).toBe(true);
    expect(mutex.isLocked()).toBe(false); // Released lock
  });

  it('handles task failure via fail', () => {
    const mutex = new DeviceMutexService();
    const service = new TasksService(mutex);

    const task = service.createTask('26');
    task.setStep('attaching_frida', 'Подключение');
    task.fail('Process crashed');

    expect(task.status).toBe('error');
    expect(task.error).toBe('Process crashed');
  });
});
