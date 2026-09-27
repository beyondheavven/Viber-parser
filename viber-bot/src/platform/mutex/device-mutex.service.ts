import { Injectable, Logger } from '@nestjs/common';

export interface DeviceLockInfo {
  taskId: string;
  lockedAt: Date;
}

@Injectable()
export class DeviceMutexService {
  private readonly logger = new Logger(DeviceMutexService.name);
  private currentLock: DeviceLockInfo | null = null;

  /**
   * Attempts to acquire exclusive lock for a given task.
   * Returns true if acquired, or false if device is currently busy.
   */
  tryLock(taskId: string): boolean {
    if (this.currentLock) {
      this.logger.warn(
        `Lock acquisition failed for task ${taskId}: Device is currently locked by task ${this.currentLock.taskId} since ${this.currentLock.lockedAt.toISOString()}`,
      );
      return false;
    }

    this.currentLock = {
      taskId,
      lockedAt: new Date(),
    };
    this.logger.log(`Device lock acquired by task ${taskId}`);
    return true;
  }

  /**
   * Releases lock if held by the given taskId.
   */
  unlock(taskId: string): void {
    if (!this.currentLock) {
      return;
    }

    if (this.currentLock.taskId === taskId) {
      this.logger.log(`Device lock released by task ${taskId}`);
      this.currentLock = null;
    } else {
      this.logger.warn(
        `Task ${taskId} attempted to unlock device, but it is locked by ${this.currentLock.taskId}`,
      );
    }
  }

  isLocked(): boolean {
    return this.currentLock !== null;
  }

  getLockInfo(): DeviceLockInfo | null {
    return this.currentLock;
  }
}
