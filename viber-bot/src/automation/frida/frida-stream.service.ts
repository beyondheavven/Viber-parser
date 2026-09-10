import { Injectable, Logger } from '@nestjs/common';
import { MessageType, type Message, type Script, type Session } from 'frida';
import { createFridaRuntime } from '../../intercept/frida-runtime.js';
import { PgWalk } from '../../intercept/pg-walk.js';
import type { PgWalkProgress, PgWalkSummary } from '../../intercept/pg-walk.js';
import { loadAdbConfig, loadViberConfig } from '../../config/env.js';
import type { Adb } from '../../device/adb.js';

const DEFAULT_IDLE_TIMEOUT_MS = 15_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type StreamProgress = PgWalkProgress;

export interface FridaPagingOptions {
  idleTimeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: ((progress: StreamProgress) => void) | undefined;
}

export type FridaPagingResult = PgWalkSummary;

export interface ActiveFridaAgent {
  waitForQueryReady(timeoutMs?: number, signal?: AbortSignal): Promise<boolean>;
  runPaging(
    conversationId: number,
    groupId: string,
    options?: FridaPagingOptions,
  ): Promise<FridaPagingResult>;
  cleanup(): Promise<void>;
}

@Injectable()
export class FridaStreamService {
  private readonly logger = new Logger(FridaStreamService.name);

  /**
   * Attaches Frida to Viber before UI navigation so interceptor hooks the paging controller.
   */
  async attachAgent(adb: Adb, signal?: AbortSignal): Promise<ActiveFridaAgent> {
    if (signal?.aborted) {
      throw new Error('Operation aborted before Frida attachment.');
    }

    const adbConfig = loadAdbConfig();
    const viberConfig = loadViberConfig();

    const fridaRuntime = createFridaRuntime({
      adbBin: adbConfig.bin,
      serial: adbConfig.serial,
      pkg: viberConfig.appPackage,
      logPrefix: '[FridaStreamService]',
    });

    fridaRuntime.ensureRoot();
    const clientVersion = fridaRuntime.readClientVersion();
    const abi = fridaRuntime.deviceAbi();
    await fridaRuntime.ensureServer(clientVersion, abi);

    const fridaDevice = await fridaRuntime.waitForFridaDevice();
    let pid = await fridaRuntime.resolveViberPid(fridaDevice);
    if (pid === undefined) {
      adb.shell(
        `am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${viberConfig.appPackage}/.WelcomeActivity`,
        { allowFailure: true },
      );
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await delay(500);
        pid = await fridaRuntime.resolveViberPid(fridaDevice);
        if (pid !== undefined) break;
      }
    }
    if (pid === undefined) {
      throw new Error(`Frida could not find running process "${viberConfig.appPackage}".`);
    }

    this.logger.log(`Attaching Frida session to process ${String(pid)}...`);
    const session: Session = await fridaRuntime.attachWithRetry(fridaDevice, pid);

    const compiledAgent = fridaRuntime.compileAgent('dump-pg-query');
    const script: Script = await session.createScript(compiledAgent);

    const rawPageJsons: string[] = [];
    let drivePaging: ((json: string) => void) | null = null;
    let driveQueryError: ((message: string) => void) | null = null;
    let queryReady = false;

    script.message.connect((message: Message) => {
      if (message.type !== MessageType.Send) return;
      const payload = (message.payload ?? {}) as Record<string, unknown>;

      if (payload['event'] === 'query-ready') {
        queryReady = true;
      } else if (payload['event'] === 'query-error') {
        // The agent falls back to another call path after reporting this, so it
        // is not fatal on its own — but it explains a walk that then stalls.
        const detail = typeof payload['message'] === 'string' ? payload['message'] : 'unknown';
        this.logger.warn(`Frida agent reported a query error: ${detail}`);
        driveQueryError?.(detail);
      } else if (payload['event'] === 'pg-reply') {
        const json = typeof payload['json'] === 'string' ? payload['json'] : null;
        if (json !== null) {
          rawPageJsons.push(json);
          drivePaging?.(json);
        }
      }
    });

    await script.load();
    this.logger.log(`Frida agent loaded into Viber (PID ${String(pid)}). Interceptor active.`);

    return {
      waitForQueryReady: async (timeoutMs = 10_000, waitSignal?: AbortSignal) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (queryReady) return true;
          if (waitSignal?.aborted || signal?.aborted) return false;
          await delay(100);
        }
        return queryReady;
      },

      runPaging: async (conversationId, groupId, options = {}) => {
        const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
        const pagingSignal = options.signal ?? signal;
        const logger = this.logger;

        return new Promise<FridaPagingResult>((resolve, reject) => {
          let lastActivity = Date.now();

          const walk = new PgWalk(groupId, {
            request: (sindex) => {
              lastActivity = Date.now();
              script.post({ type: 'query', a0: conversationId, a1: sindex, groupId });
            },
            onProgress: options.onProgress,
            onWarning: (message) => logger.warn(message),
          });

          const onAbort = (): void => {
            cleanup();
            reject(new Error('Paging aborted by signal.'));
          };

          const cleanup = (): void => {
            clearInterval(watchdog);
            drivePaging = null;
            driveQueryError = null;
            pagingSignal?.removeEventListener('abort', onAbort);
          };

          const finish = (): void => {
            const summary = walk.summary();
            cleanup();
            resolve(summary);
          };

          if (pagingSignal?.aborted) {
            reject(new Error('Paging aborted by signal.'));
            return;
          }
          pagingSignal?.addEventListener('abort', onAbort, { once: true });

          driveQueryError = (message) => walk.noteQueryError(message);

          drivePaging = (json: string) => {
            // A discarded reply must not refresh the idle timer, or a chatty
            // app could mask a stalled walk indefinitely.
            const outcome = walk.offer(json);
            if (outcome === 'ignored') return;
            lastActivity = Date.now();
            if (outcome === 'complete') finish();
          };

          const watchdog = setInterval(() => {
            if (walk.isDone) {
              cleanup();
              return;
            }
            if (Date.now() - lastActivity > idleTimeoutMs) {
              logger.warn(`Paging went quiet for ${String(idleTimeoutMs)}ms; ending the walk.`);
              finish();
            }
          }, 500);

          walk.start();
        });
      },

      cleanup: async () => {
        try {
          await script.unload();
        } catch {
          // ignore
        }
        try {
          await session.detach();
        } catch {
          // ignore
        }
      },
    };
  }
}
