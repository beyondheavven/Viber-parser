import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { loadAdbConfig, type AdbConfig } from '../config/env.js';

export class AdbError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly stdout: string,
    readonly stderr: string,
    /** The command was killed by its own timeout rather than answering. */
    readonly timedOut = false,
  ) {
    super(message);
    this.name = 'AdbError';
  }
}

/**
 * Explains why `spawnSync` never returned a result.
 *
 * A timeout and a missing binary both surface as `result.error`, and calling
 * both "failed to start" sends you looking for the wrong problem: a timeout
 * means adb launched fine and the device stopped answering.
 */
export function describeSpawnFailure(
  args: readonly string[],
  error: NodeJS.ErrnoException,
  timeout: number,
  signal?: NodeJS.Signals | null,
): { message: string; timedOut: boolean } {
  const timedOut = error.code === 'ETIMEDOUT' || signal === 'SIGTERM';
  if (timedOut) {
    return {
      message:
        `adb ${args.join(' ')} timed out after ${String(timeout)}ms. ` +
        'The device is usually offline or adbd has stopped accepting sessions.',
      timedOut: true,
    };
  }
  return { message: `adb failed to start: ${error.message}`, timedOut: false };
}

/** Fragments adb prints when the transport, not the command, is the problem. */
const TRANSPORT_FAILURES = ['device offline', 'device not found', 'closed', 'protocol fault'];

/**
 * True when reconnecting has a chance of fixing the failure. An ordinary
 * non-zero exit — a missing file, a bad permission — is not worth a reconnect.
 */
export function isRecoverable(error: unknown): boolean {
  if (!(error instanceof AdbError)) return false;
  if (error.timedOut) return true;
  const haystack = `${error.stdout} ${error.stderr}`.toLowerCase();
  return TRANSPORT_FAILURES.some((fragment) => haystack.includes(fragment));
}

/**
 * Leash for recovery commands. Long enough for adb to dial a healthy device,
 * short enough that a dead one is diagnosed in seconds rather than minutes.
 */
const RECOVERY_TIMEOUT = 15_000;

/**
 * `adb connect` must not inherit the 120s command timeout: spawnSync freezes
 * the whole Node event loop, and a down emulator would stall every HTTP request.
 */
const CONNECT_TIMEOUT = 5_000;

/** Non-blocking TCP probe before we pay for a spawnSync `adb connect`. */
const TCP_PROBE_TIMEOUT = 2_500;

/**
 * True when `serial` looks like host:port and that TCP port accepts a connection.
 * USB serials (no host:port) are treated as reachable so the caller still uses adb.
 */
export function probeTcp(serial: string, timeoutMs = TCP_PROBE_TIMEOUT): Promise<boolean> {
  const colon = serial.lastIndexOf(':');
  if (colon <= 0) return Promise.resolve(true);
  const host = serial.slice(0, colon);
  const port = Number.parseInt(serial.slice(colon + 1), 10);
  if (!host || !Number.isInteger(port) || port <= 0) return Promise.resolve(true);

  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export class Adb {
  constructor(private readonly config: AdbConfig = loadAdbConfig()) {}

  get serial(): string {
    return this.config.serial;
  }

  /** Runs adb without the `-s <serial>` prefix (connect, start-server, devices). */
  exec(
    args: readonly string[],
    options: { allowFailure?: boolean; timeout?: number } = {},
  ): string {
    const isPath = this.config.bin.includes('/') || this.config.bin.includes('\\');
    if (isPath && !existsSync(this.config.bin)) {
      throw new AdbError(
        `adb not found at ${this.config.bin}. Set ADB_BIN or ANDROID_HOME in .env.`,
        args,
        '',
        '',
      );
    }
    const timeout = options.timeout ?? this.config.execTimeout;
    let result = spawnSync(this.config.bin, [...args], {
      encoding: 'utf8',
      timeout,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    let stdout = result.stdout ?? '';
    let stderr = result.stderr ?? '';

    // If ADB daemon dropped or disconnected on Windows, restart server and retry once
    if (
      result.status !== 0 &&
      (stderr.includes('cannot connect to daemon') ||
        stderr.includes('daemon still not running') ||
        stderr.includes('daemon not running') ||
        stderr.includes('device offline'))
    ) {
      spawnSync(this.config.bin, ['start-server'], { windowsHide: true, timeout: 5000 });
      if (this.config.serial) {
        spawnSync(this.config.bin, ['connect', this.config.serial], {
          windowsHide: true,
          timeout: 5000,
        });
      }
      result = spawnSync(this.config.bin, [...args], {
        encoding: 'utf8',
        timeout,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      });
      stdout = result.stdout ?? '';
      stderr = result.stderr ?? '';
    }

    if (result.error !== undefined) {
      const failure = describeSpawnFailure(args, result.error, timeout, result.signal);
      throw new AdbError(failure.message, args, stdout, stderr, failure.timedOut);
    }
    if (result.status !== 0 && options.allowFailure !== true) {
      throw new AdbError(
        `adb ${args.join(' ')} exited with code ${String(result.status)}: ${stderr.trim() || stdout.trim()}`,
        args,
        stdout,
        stderr,
      );
    }
    return stdout;
  }

  /** Runs adb against the configured device. */
  device(
    args: readonly string[],
    options: { allowFailure?: boolean; timeout?: number } = {},
  ): string {
    return this.exec(['-s', this.config.serial, ...args], options);
  }

  /**
   * Runs a command in the device shell.
   *
   * adb translates `\n` to `\r\n` on Windows, so the carriage returns are
   * stripped here — every caller downstream can assume plain `\n`.
   */
  shell(command: string, options: { allowFailure?: boolean; timeout?: number } = {}): string {
    return this.device(['shell', command], options).replace(/\r\n/g, '\n');
  }

  connect(): void {
    const output = this.exec(['connect', this.config.serial], {
      allowFailure: true,
      timeout: CONNECT_TIMEOUT,
    });
    if (!/connected to/i.test(output)) {
      throw new AdbError(
        `Could not connect to ${this.config.serial}. Is the LDPlayer instance running with ADB debugging enabled?`,
        ['connect', this.config.serial],
        output,
        '',
      );
    }
  }

  disconnect(): void {
    this.exec(['disconnect', this.config.serial], { allowFailure: true });
  }

  /** True when the device is present and in the `device` state. */
  isOnline(): boolean {
    const output = this.exec(['devices'], { allowFailure: true }).replace(/\r\n/g, '\n');
    return output
      .split('\n')
      .slice(1)
      .some((line) => {
        const [serial = '', state = ''] = line.trim().split(/\s+/);
        return serial === this.config.serial && state === 'device';
      });
  }

  isBooted(): boolean {
    if (!this.isOnline()) return false;
    const value = this.shell('getprop sys.boot_completed', { allowFailure: true }).trim();
    return value === '1';
  }

  /**
   * Restarts adbd as root.
   *
   * LDPlayer runs with root mode enabled, which is what makes reading Viber's
   * private data directory possible at all. `adb root` drops the connection
   * while adbd restarts, so the caller must reconnect afterwards.
   */
  root(): void {
    if (this.isRoot()) return;
    this.device(['root'], { allowFailure: true });
    this.connect();
  }

  isRoot(): boolean {
    const id = this.shell('id', { allowFailure: true });
    return /uid=0\(root\)/.test(id);
  }

  /**
   * Tries to bring a wedged transport back: drop the connection, dial again,
   * and re-assert root, since a restarted adbd comes back unprivileged.
   *
   * Every step runs on a short leash and swallows its own failure — this is
   * called from an error path, and a recovery attempt that itself hangs for
   * the full command timeout would freeze the caller for minutes. Returns
   * whether the device answers again.
   */
  recover(timeout = RECOVERY_TIMEOUT): boolean {
    const attempt = (args: readonly string[]): string => {
      try {
        return this.exec(args, { allowFailure: true, timeout });
      } catch {
        return '';
      }
    };

    attempt(['disconnect', this.config.serial]);
    attempt(['connect', this.config.serial]);
    const state = attempt(['-s', this.config.serial, 'get-state']).trim();
    if (state !== 'device') return false;

    const id = attempt(['-s', this.config.serial, 'shell', 'id']);
    if (!/uid=0\(root\)/.test(id)) {
      attempt(['-s', this.config.serial, 'root']);
      attempt(['connect', this.config.serial]);
    }
    return attempt(['-s', this.config.serial, 'get-state']).trim() === 'device';
  }

  pull(remote: string, local: string): void {
    this.device(['pull', remote, local]);
  }

  push(local: string, remote: string): void {
    this.device(['push', local, remote]);
  }
}
