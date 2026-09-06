import { Injectable, Logger } from '@nestjs/common';
import { MessageType, type Message, type Script, type Session } from 'frida';
import { createFridaRuntime } from '../../intercept/frida-runtime.js';
import { nextSindex, parsePgPage, type PgPage } from '../../intercept/pg-paging.js';
import { loadAdbConfig, loadViberConfig } from '../../config/env.js';
import type { Adb } from '../../device/adb.js';

const SINDEX_CAP = 200_000;
const DEFAULT_IDLE_TIMEOUT_MS = 15_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface StreamProgress {
  pagesCount: number;
  currentOffset: number;
  pageSize: number;
  lastPage: boolean;
  headerTotal: number | null;
}

export interface FridaPagingOptions {
  idleTimeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: ((progress: StreamProgress) => void) | undefined;
}

export interface FridaPagingResult {
  rawPageJsons: string[];
  pagesCount: number;
  lastReached: boolean;
  headerTotal: number | null;
}

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
    let queryReady = false;

    script.message.connect((message: Message) => {
      if (message.type !== MessageType.Send) return;
      const payload = (message.payload ?? {}) as Record<string, unknown>;

      if (payload['event'] === 'query-ready') {
        queryReady = true;
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

        return new Promise<FridaPagingResult>((resolve, reject) => {
          const requested = new Set<number>();
          let passDone = false;
          let paginationCompleted = false;
          let headerTotal: number | null = null;
          let pagesCount = 0;
          let lastActivity = Date.now();

          const onAbort = (): void => {
            passDone = true;
            clearInterval(watchdog);
            reject(new Error('Paging aborted by signal.'));
          };

          if (pagingSignal?.aborted) {
            onAbort();
            return;
          }

          pagingSignal?.addEventListener('abort', onAbort, { once: true });

          const cleanup = (): void => {
            clearInterval(watchdog);
            pagingSignal?.removeEventListener('abort', onAbort);
          };

          const request = (sindex: number): void => {
            if (passDone || requested.has(sindex) || sindex > SINDEX_CAP) return;
            requested.add(sindex);
            lastActivity = Date.now();
            script.post({ type: 'query', a0: conversationId, a1: sindex, groupId });
          };

          drivePaging = (json: string) => {
            if (passDone) return;
            const page = parsePgPage(json);
            if (page === null) return;

            lastActivity = Date.now();
            pagesCount += 1;
            headerTotal = Math.max(headerTotal ?? 0, page.sindex + page.count);
            options.onProgress?.({
              pagesCount,
              currentOffset: page.sindex,
              pageSize: page.size,
              lastPage: page.last,
              headerTotal: page.sindex + page.count,
            });

            if (page.last) {
              paginationCompleted = true;
              passDone = true;
              cleanup();
              resolve({
                rawPageJsons,
                pagesCount,
                lastReached: paginationCompleted,
                headerTotal,
              });
              return;
            }

            request(nextSindex(page));
          };

          const watchdog = setInterval(() => {
            if (passDone) {
              cleanup();
              return;
            }
            if (Date.now() - lastActivity > idleTimeoutMs) {
              passDone = true;
              cleanup();
              resolve({
                rawPageJsons,
                pagesCount,
                lastReached: paginationCompleted,
                headerTotal,
              });
            }
          }, 500);

          // Start paging from 0
          request(0);
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
