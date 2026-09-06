import { Inject, Injectable, Logger } from '@nestjs/common';
import { MessageType, type Message, type Script, type Session } from 'frida';
import { createFridaRuntime } from '../../intercept/frida-runtime.js';
import { loadAdbConfig, loadViberConfig } from '../../config/env.js';
import { DeviceMutexService } from '../../common/mutex/device-mutex.service.js';
import type { Adb } from '../../device/adb.js';

export interface MessageDbWrite {
  op: string;
  table: string;
  rowId: string | null;
  values: Record<string, string | null>;
}

export type MessageWriteHandler = (write: MessageDbWrite) => void;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * True when a SQLite write should wake the monitor: either the row names an
 * enabled conversation, or the conversation id is missing (an UPDATE of body/uri).
 */
export function shouldIngestMessageWrite(
  values: Readonly<Record<string, string | null | undefined>>,
  enabledConversationIds: ReadonlySet<number>,
): boolean {
  if (enabledConversationIds.size === 0) return false;
  const raw = values['conversation_id'] ?? values['conversationId'];
  if (raw === undefined || raw === null || raw === '') return true;
  const conversationId = Number(raw);
  if (!Number.isInteger(conversationId)) return true;
  return enabledConversationIds.has(conversationId);
}

@Injectable()
export class MessageWatchService {
  private readonly logger = new Logger(MessageWatchService.name);
  private session: Session | null = null;
  private script: Script | null = null;
  private handler: MessageWriteHandler | null = null;
  private attaching = false;

  constructor(@Inject(DeviceMutexService) private readonly deviceMutex: DeviceMutexService) {}

  setHandler(handler: MessageWriteHandler | null): void {
    this.handler = handler;
  }

  isAttached(): boolean {
    return this.script !== null && this.session !== null;
  }

  async attach(adb: Adb): Promise<boolean> {
    if (this.isAttached()) return true;
    if (this.attaching) return false;
    if (this.deviceMutex.isLocked()) {
      this.logger.debug('Skip live message watch: emulator is locked by another task.');
      return false;
    }

    this.attaching = true;
    try {
      const adbConfig = loadAdbConfig();
      const viberConfig = loadViberConfig();
      const runtime = createFridaRuntime({
        adbBin: adbConfig.bin,
        serial: adbConfig.serial,
        pkg: viberConfig.appPackage,
        logPrefix: '[MessageWatchService]',
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
          await delay(400);
          pid = await runtime.resolveViberPid(device);
          if (pid !== undefined) break;
        }
      }
      if (pid === undefined) {
        this.logger.warn('Viber is not running; live message watch not attached.');
        return false;
      }

      const session = await runtime.attachWithRetry(device, pid);
      const source = runtime.compileAgent('watch-messages');
      const script = await session.createScript(source);

      script.message.connect((message: Message) => {
        if (message.type !== MessageType.Send) return;
        const payload = (message.payload ?? {}) as Record<string, unknown>;
        if (payload['event'] === 'watch-ready') {
          this.logger.log(`Live message watch hooked: ${JSON.stringify(payload['hooks'])}`);
          return;
        }
        if (payload['event'] === 'watch-error') {
          this.logger.warn(`Live message watch: ${String(payload['message'] ?? 'unknown error')}`);
          return;
        }
        if (payload['event'] !== 'db-write') return;
        const values = (payload['values'] ?? {}) as Record<string, string | null>;
        this.handler?.({
          op: String(payload['op'] ?? 'insert'),
          table: String(payload['table'] ?? 'messages'),
          rowId: payload['rowId'] === undefined || payload['rowId'] === null ? null : String(payload['rowId']),
          values,
        });
      });

      session.detached.connect(() => {
        this.logger.warn('Live message watch detached (Viber or emulator restarted).');
        this.session = null;
        this.script = null;
      });

      await script.load();
      this.session = session;
      this.script = script;
      this.logger.log(`Live message watch attached to Viber PID ${String(pid)}`);
      return true;
    } catch (error) {
      this.logger.warn(`Failed to attach live message watch: ${String(error)}`);
      await this.detach();
      return false;
    } finally {
      this.attaching = false;
    }
  }

  async detach(): Promise<void> {
    const script = this.script;
    const session = this.session;
    this.script = null;
    this.session = null;
    if (script) {
      try {
        await script.unload();
      } catch {
        // already gone
      }
    }
    if (session) {
      try {
        await session.detach();
      } catch {
        // already gone
      }
    }
  }
}
