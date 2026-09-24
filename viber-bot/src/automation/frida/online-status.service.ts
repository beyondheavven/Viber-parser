import { Injectable, Logger } from '@nestjs/common';
import { MessageType, type Message, type Script, type Session } from 'frida';
import { createFridaRuntime } from '../../intercept/frida-runtime.js';
import { loadAdbConfig, loadViberConfig } from '../../config/env.js';
import type { Adb } from '../../device/adb.js';

export interface UserOnlineStatus {
  memberId: string;
  isOnline: boolean;
  lastSeenTimestamp: number | null;
  lastSeen: string | null;
}

export interface FetchOnlineOptions {
  batchSize?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /**
   * Stop the whole step after this many batches time out back to back. Once
   * Viber stops answering (it goes ANR under a flood of last-online requests on
   * a huge group), every further batch just burns its timeout, so giving up
   * keeps the already-collected roster instead of stalling for many minutes.
   */
  maxConsecutiveTimeouts?: number;
  /** Idle gap between batches in ms, to keep Viber's main thread breathing. */
  pauseBetweenBatchesMs?: number;
}

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_BATCH_TIMEOUT_MS = 6_000;
const DEFAULT_MAX_CONSECUTIVE_TIMEOUTS = 5;
const DEFAULT_PAUSE_BETWEEN_BATCHES_MS = 0;
const MIN_MILLISECONDS_TIMESTAMP = 100_000_000_000;

export function normalizeLastSeenTimestamp(value: unknown): number | null {
  const timestamp = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;

  const milliseconds =
    timestamp < MIN_MILLISECONDS_TIMESTAMP ? timestamp * 1_000 : timestamp;
  return Number.isNaN(new Date(milliseconds).getTime()) ? null : milliseconds;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class OnlineStatusService {
  private readonly logger = new Logger(OnlineStatusService.name);

  /**
   * Fetches online status and last seen timestamp for a list of member IDs via Frida.
   */
  async fetchOnlineStatuses(
    adb: Adb,
    memberIds: readonly string[],
    options: FetchOnlineOptions = {},
  ): Promise<Map<string, UserOnlineStatus>> {
    const results = new Map<string, UserOnlineStatus>();
    const cleanIds = memberIds.map((id) => id.trim()).filter((id) => id.length > 0);

    if (cleanIds.length === 0) {
      return results;
    }

    if (options.signal?.aborted) {
      throw new Error('Online status query aborted before execution.');
    }

    const adbConfig = loadAdbConfig();
    const viberConfig = loadViberConfig();

    const runtime = createFridaRuntime({
      adbBin: adbConfig.bin,
      serial: adbConfig.serial,
      pkg: viberConfig.appPackage,
      logPrefix: '[OnlineStatusService]',
    });

    runtime.ensureRoot();
    const clientVersion = runtime.readClientVersion();
    const abi = runtime.deviceAbi();
    await runtime.ensureServerRunning(clientVersion, abi);

    const device = await runtime.waitForFridaDevice();
    let pid = await runtime.resolveViberPid(device);

    if (pid === undefined) {
      adb.shell(
        `am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${viberConfig.appPackage}/.WelcomeActivity`,
        { allowFailure: true },
      );
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await delay(500);
        pid = await runtime.resolveViberPid(device);
        if (pid !== undefined) break;
      }
    }

    if (pid === undefined) {
      this.logger.warn('Could not find running Viber process to query online statuses. Skipping.');
      return results;
    }

    this.logger.log(`Attaching Frida to Viber (PID ${String(pid)}) to query online statuses...`);
    const session: Session = await runtime.attachWithRetry(device, pid);

    try {
      const source = runtime.compileAgent('fetch-last-online');
      const script: Script = await session.createScript(source);

      let pendingResolver: ((data: UserOnlineStatus[]) => void) | null = null;
      let currentToken = 0;

      script.message.connect((message: Message) => {
        if (message.type !== MessageType.Send) return;
        const payload = (message.payload ?? {}) as Record<string, unknown>;

        if (payload['event'] === 'onLastOnline-reply') {
          const token = Number(payload['token']);
          if (token === currentToken) {
            const rawResults = (payload['results'] ?? []) as UserOnlineStatus[];
            pendingResolver?.(rawResults);
            pendingResolver = null;
          }
        }
      });

      await script.load();
      await delay(500); // Allow agent registration

      const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
      const batchTimeoutMs = options.timeoutMs ?? DEFAULT_BATCH_TIMEOUT_MS;
      const maxConsecutiveTimeouts =
        options.maxConsecutiveTimeouts ?? DEFAULT_MAX_CONSECUTIVE_TIMEOUTS;
      const pauseMs = options.pauseBetweenBatchesMs ?? DEFAULT_PAUSE_BETWEEN_BATCHES_MS;

      // A distinct value the timeout resolves with, so a batch that genuinely
      // returned zero results is told apart from one that never answered.
      const TIMED_OUT = Symbol('online-batch-timeout');

      let processed = 0;
      let consecutiveTimeouts = 0;
      let stoppedEarly = false;

      for (let i = 0; i < cleanIds.length; i += batchSize) {
        if (options.signal?.aborted) {
          stoppedEarly = true;
          break;
        }

        const chunk = cleanIds.slice(i, i + batchSize);
        currentToken = (currentToken % 900000) + 100000;
        const batchToken = currentToken;

        const batchPromise = new Promise<UserOnlineStatus[]>((resolve) => {
          pendingResolver = resolve;
        });

        script.post({
          type: 'query-last-online',
          memberIds: chunk,
          token: currentToken,
        });

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<typeof TIMED_OUT>((resolve) => {
          timeoutId = setTimeout(() => {
            if (currentToken === batchToken) pendingResolver = null;
            resolve(TIMED_OUT);
          }, batchTimeoutMs);
        });

        const outcome = await Promise.race([batchPromise, timeoutPromise]);
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        processed += chunk.length;

        if (outcome === TIMED_OUT) {
          // No reply means unknown, not offline. These members are deliberately
          // left out of the map so their activity stays undefined downstream,
          // instead of everyone a stall skipped being mislabelled "offline".
          consecutiveTimeouts += 1;
          if (consecutiveTimeouts >= maxConsecutiveTimeouts) {
            this.logger.warn(
              `Online status: ${String(consecutiveTimeouts)} batches in a row timed out — ` +
                'Viber has stopped answering. Ending the step to keep the collected roster.',
            );
            stoppedEarly = true;
            break;
          }
        } else {
          consecutiveTimeouts = 0;
          for (const item of outcome) {
            if (item.memberId) {
              const lastSeenTimestamp = normalizeLastSeenTimestamp(item.lastSeenTimestamp);
              results.set(item.memberId, {
                memberId: item.memberId,
                isOnline: item.isOnline === true,
                lastSeenTimestamp,
                lastSeen:
                  lastSeenTimestamp === null ? null : new Date(lastSeenTimestamp).toISOString(),
              });
            }
          }
        }

        options.onProgress?.(processed, cleanIds.length);

        // Firing thousands of last-online requests back to back is what pushes
        // Viber's main thread into ANR on very large groups; a short breather
        // between batches keeps it responsive.
        if (pauseMs > 0 && i + batchSize < cleanIds.length) {
          await delay(pauseMs);
        }
      }

      if (stoppedEarly) {
        this.logger.warn(
          `Online status incomplete: got replies for ${String(results.size)}/` +
            `${String(cleanIds.length)} participants; the rest keep unknown activity.`,
        );
      } else {
        this.logger.log(
          `Online status done: replies for ${String(results.size)}/${String(cleanIds.length)} ` +
            `participants (${String(cleanIds.length - results.size)} without a reply).`,
        );
      }
    } finally {
      try {
        await session.detach();
      } catch {
        // Session cleanup
      }
    }

    return results;
  }
}
