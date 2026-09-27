import { Injectable, Logger } from '@nestjs/common';
import type { Adb } from './adb.js';
import type { ViberConfig } from '../config/env.js';
import { restartViberApp } from './restart-viber.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface NumberSyncStatus {
  syncedCount: number;
  stable: boolean;
}


export function parseSyncedCount(output: string): number {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length < 2) return Number.NaN;
  const last = lines[lines.length - 1] ?? '';
  return /^\d+$/.test(last) ? Number.parseInt(last, 10) : Number.NaN;
}

/**
 * How long to wait for Viber to resolve numbers when the caller set no limit.
 * Viber fills them in over the network in batches, so a big roster needs more
 * than the 45 s that is plenty for a small one: 10 ms per member, capped at
 * five minutes.
 */
export function defaultNumbersSyncTimeoutMs(linkedParticipants: number): number {
  return Math.min(300_000, Math.max(45_000, Math.round(linkedParticipants * 10)));
}

@Injectable()
export class ViberLifecycleService {
  private readonly logger = new Logger(ViberLifecycleService.name);

  async restartApp(
    adb: Adb,
    viberConfig: ViberConfig,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (signal?.aborted) {
      throw new Error('Restart aborted before execution.');
    }

    this.logger.log('Closing Viber and reopening to flush SQLite WAL...');
    const restart = await restartViberApp(
        {
          shell: (command, shellOptions) => adb.shell(command, shellOptions),
          recover: (timeout) => adb.recover(timeout),
        },
        { appPackage: viberConfig.appPackage },
    );

    if (!restart.started) {
      this.logger.warn(
          `Could not confirm Viber relaunched after ${String(restart.attempts)} attempts.`,
      );
      return false;
    }

    this.logger.log('Viber relaunched and WelcomeActivity loaded.');
    return true;
  }

  /**
   * Polls live database until Viber finishes resolving phone numbers from the network.
   */
  async waitForPhoneNumbersSync(
    adb: Adb,
    viberConfig: ViberConfig,
    conversationId: number,
    timeoutMs: number = 45_000,
    signal?: AbortSignal,
    onPoll?: (status: NumberSyncStatus) => void,
  ): Promise<number> {
    this.logger.log('Waiting for Viber background network sync of phone numbers...');

    let lastSyncedCount = -1;
    let stableStreak = 0;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (signal?.aborted) {
        throw new Error('Number sync wait aborted.');
      }

      await delay(2_500);

      if (signal?.aborted) {
        throw new Error('Number sync wait aborted.');
      }

      const countStr = adb
        .shell(
          `sqlite3 /data/data/${viberConfig.appPackage}/databases/viber_messages ` +
            `"PRAGMA busy_timeout=10000; SELECT count(*) FROM participants p JOIN participants_info pi ON p.participant_info_id = pi._id ` +
            `WHERE p.conversation_id = ${String(conversationId)} AND pi.number IS NOT NULL AND length(pi.number) > 0;"`,
          { allowFailure: true },
        )
        .trim();

      const current = parseSyncedCount(countStr);
      if (Number.isFinite(current)) {
        onPoll?.({ syncedCount: current, stable: stableStreak >= 2 });

        if (current > 0 && current === lastSyncedCount) {
          stableStreak += 1;
          if (stableStreak >= 2) {
            this.logger.log(
              `Phone numbers count stabilized at ${String(current)}. Sync complete.`,
            );
            return current;
          }
        } else {
          stableStreak = 0;
          lastSyncedCount = current;
        }
      }
    }

    this.logger.warn(
      `Number sync wait reached timeout (${String(timeoutMs)}ms). Continuing with last count: ${String(lastSyncedCount)}.`,
    );
    return lastSyncedCount;
  }
}
