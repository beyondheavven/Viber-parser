/**
 * Reusable Frida plumbing shared by the on-device tooling: managing the
 * frida-server binary, resolving and attaching to the target app, and compiling
 * a Frida agent (bundling frida-java-bridge, which Frida 17 no longer ships as a
 * global `Java`).
 *
 * The proven logic here was lifted from scripts/trace-intent-frida.ts so a
 * second consumer (the headless chat opener) can reuse it without touching that
 * file; the tracer can later be refactored onto this module in a separate pass.
 *
 * Every adb call is time-boxed — a wedged `adb shell` must never hang a run —
 * and failures throw {@link FridaRuntimeError} (with the same actionable text
 * the tracer printed) rather than calling process.exit, so the host decides how
 * to report and exit.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getDevice, type Device, type Session } from 'frida';

import {
  abiToFridaArch,
  checkServerVersion,
  fridaReleaseUrl,
  fridaServerAssetName,
  parseClientVersion,
  parseServerVersion,
} from './frida-assets.js';

const REMOTE_SERVER = '/data/local/tmp/frida-server';
const DEFAULT_ADB_TIMEOUT = 20_000;

/** Raised for every recoverable failure so the host can print + exit itself. */
export class FridaRuntimeError extends Error {
  public override readonly name = 'FridaRuntimeError';
}

export interface AdbResult {
  stdout: string;
  stderr: string;
  status: number | null;
  timedOut: boolean;
}

export interface FridaRuntimeOptions {
  /** Absolute path to the adb binary. */
  adbBin: string;
  /** adb serial the device is reachable at (always used with `-s`). */
  serial: string;
  /** Target app package (e.g. com.viber.voip). */
  pkg: string;
  /** Prefix for status lines, e.g. "[open:chat]". Defaults to "[frida]". */
  logPrefix?: string;
  /** Default per-call adb timeout in ms. */
  adbTimeout?: number;
}

export interface FridaRuntime {
  adbRun(args: readonly string[], timeoutMs?: number): AdbResult;
  adbShell(command: string, timeoutMs?: number): AdbResult;
  /** The installed frida npm binding's version; server must match it exactly. */
  readClientVersion(): string;
  /** The device's ro.product.cpu.abi. */
  deviceAbi(): string;
  /** Throws unless `adb shell` runs as root (required for frida-server to attach). */
  ensureRoot(): void;
  /** Pids of every running frida-server. */
  serverPids(): string[];
  /**
   * Full idempotent server management: installs the matching build if needed and
   * (re)starts it, stopping stale/mismatched instances first. Destructive — it
   * may kill a running frida-server. Returns the version the device reports.
   */
  ensureServer(version: string, abi: string): Promise<string>;
  /**
   * Non-destructive reuse: if a matching frida-server is already running it is
   * reused as-is; if none is running but the matching binary is installed it is
   * started. Never kills a running server, so it is safe while other Frida work
   * is attached. Throws when it cannot proceed without killing/installing.
   */
  ensureServerRunning(version: string, abi: string): Promise<string>;
  /** Waits for the Frida device (addressed by adb serial) to answer. */
  waitForFridaDevice(): Promise<Device>;
  /** The running target pid from Frida's application list, or undefined. */
  resolveViberPid(device: Device): Promise<number | undefined>;
  /** Attach to a pid, retrying once through a startup race that can kill it. */
  attachWithRetry(device: Device, pid: number): Promise<Session>;
  /**
   * Compiles scripts/frida/<agentBaseName>.js into a single agent bundle and
   * returns its source. Output is cached in the gitignored .frida/ directory.
   */
  compileAgent(agentBaseName: string): string;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createFridaRuntime(options: FridaRuntimeOptions): FridaRuntime {
  const { adbBin, serial, pkg } = options;
  const prefix = options.logPrefix ?? '[frida]';
  const adbTimeout = options.adbTimeout ?? DEFAULT_ADB_TIMEOUT;

  function log(message: string): void {
    console.log(`${prefix} ${message}`);
  }
  function fail(message: string): never {
    throw new FridaRuntimeError(message);
  }

  function adbRun(args: readonly string[], timeoutMs: number = adbTimeout): AdbResult {
    const result = spawnSync(adbBin, ['-s', serial, ...args], {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    const timedOut =
      result.error !== undefined &&
      ((result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' || result.signal === 'SIGTERM');
    return {
      stdout: (result.stdout ?? '').replace(/\r\n/g, '\n'),
      stderr: (result.stderr ?? '').replace(/\r\n/g, '\n'),
      status: result.status,
      timedOut,
    };
  }

  function adbShell(command: string, timeoutMs: number = adbTimeout): AdbResult {
    return adbRun(['shell', command], timeoutMs);
  }

  function readClientVersion(): string {
    const pkgJsonPath = join(process.cwd(), 'node_modules', 'frida', 'package.json');
    const raw = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { version?: string };
    if (typeof raw.version !== 'string') {
      fail('Could not read the installed frida version from node_modules/frida/package.json.');
    }
    return parseClientVersion(raw.version);
  }

  function deviceAbi(): string {
    const result = adbShell('getprop ro.product.cpu.abi');
    if (result.timedOut) fail('`adb shell getprop` timed out — the device transport is wedged.');
    const abi = result.stdout.trim();
    if (abi === '') fail('Could not read ro.product.cpu.abi from the device.');
    return abi;
  }

  function ensureRoot(): void {
    const result = adbShell('id', 10_000);
    if (result.timedOut) {
      fail('`adb shell id` timed out — the device transport is wedged. Restart the LDPlayer instance.');
    }
    const id = result.stdout.trim();
    if (!/uid=0\(root\)/.test(id)) {
      fail(
        `adb shell runs as "${id || '(no answer)'}", not root, so frida-server cannot attach to ${pkg}. ` +
          'Enable root for this LDPlayer instance (Settings -> Other -> Root permission, then restart it) ' +
          `and/or run \`${adbBin} -s ${serial} root\`.`,
      );
    }
  }

  function serverPids(): string[] {
    const out = adbShell('pidof frida-server').stdout.trim();
    return out === '' ? [] : out.split(/\s+/).filter((pid) => pid !== '');
  }

  /**
   * True when a process was started from a binary since replaced on disk:
   * /proc/<pid>/exe then reads "…/frida-server (deleted)". Any read failure
   * answers "not stale" — this check may only ever add a restart, never block a
   * healthy run.
   */
  function isReplacedBinary(pid: string): boolean {
    const link = adbShell(`readlink /proc/${pid}/exe`, 5_000);
    if (link.timedOut) return false;
    return link.stdout.includes('(deleted)');
  }

  async function stopServer(timeoutMs = 5_000): Promise<boolean> {
    adbShell('killall frida-server 2>/dev/null; pkill -x frida-server 2>/dev/null');
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (serverPids().length === 0) return true;
      if (Date.now() >= deadline) return false;
      await delay(250);
    }
  }

  function serverVersionOutput(): string {
    const result = adbShell(`${REMOTE_SERVER} --version 2>/dev/null`);
    if (result.timedOut) {
      fail(
        `\`${REMOTE_SERVER} --version\` timed out — the adb transport is wedged. ` +
          'Restart the LDPlayer instance rather than re-running this script.',
      );
    }
    return result.stdout;
  }

  async function downloadAsset(version: string, abi: string, localPath: string): Promise<void> {
    const url = fridaReleaseUrl(version, abi);
    log(`downloading ${fridaServerAssetName(version, abi)} ...`);
    const response = await fetch(url);
    if (!response.ok) {
      fail(`Download failed (${String(response.status)}) for ${url}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    writeFileSync(localPath, bytes);
    log(`saved ${String(bytes.length)} bytes to ${localPath}`);
  }

  /** Installs the matching build (download + local xz decompression + push) when absent. */
  async function installServer(version: string, abi: string): Promise<void> {
    abiToFridaArch(abi); // validate early; throws on an unsupported abi
    const cacheDir = join(process.cwd(), '.frida');
    mkdirSync(cacheDir, { recursive: true });
    const localXz = join(cacheDir, fridaServerAssetName(version, abi));
    const localBin = join(cacheDir, `frida-server-${version}-android-${abiToFridaArch(abi)}`);

    if (!existsSync(localBin)) {
      if (!existsSync(localXz)) {
        await downloadAsset(version, abi, localXz);
      }
      log(`Decompressing ${localXz} to ${localBin} using local xz...`);
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      try {
        await execFileAsync('xz', ['-d', '-k', '-f', localXz], { windowsHide: true });
      } catch {
        try {
          await execFileAsync('xz', ['-d', '-f', localXz], { windowsHide: true });
        } catch (err) {
          log(`Warning: xz error: ${String(err)}`);
        }
      }
      const decompressedFile = localXz.replace(/\.xz$/, '');
      if (existsSync(decompressedFile) && decompressedFile !== localBin) {
        try {
          const { renameSync } = await import('node:fs');
          renameSync(decompressedFile, localBin);
        } catch {
          // ignore
        }
      }
    }

    const binaryToPush = existsSync(localBin) ? localBin : localXz.replace(/\.xz$/, '');
    if (!existsSync(binaryToPush)) {
      fail(`Failed to decompress frida-server binary locally at ${localBin}`);
    }

    log(`Pushing ${binaryToPush} to ${REMOTE_SERVER} ...`);
    const push = adbRun(['push', binaryToPush, REMOTE_SERVER]);
    if (push.status !== 0) fail(`adb push failed: ${push.stderr.trim() || push.stdout.trim()}`);

    adbShell(`chmod 755 ${REMOTE_SERVER}`);

    const pushed = checkServerVersion(version, serverVersionOutput());
    if (!pushed.ok) {
      fail(`${pushed.problem ?? ''} The binary just pushed to ${REMOTE_SERVER} is not the expected build.`);
    }
    log(`installed frida-server ${version} at ${REMOTE_SERVER}.`);
  }

  /** Starts the on-device binary daemonized and verifies the version it reports. */
  async function startServer(version: string): Promise<string> {
    log('starting frida-server (daemonized) ...');
    adbShell(`${REMOTE_SERVER} -D`, 10_000);
    await delay(1_000);
    const started = serverPids();
    if (started.length === 0) fail('frida-server did not come up after start.');

    const check = checkServerVersion(version, serverVersionOutput());
    if (!check.ok || check.version === null) {
      fail(
        `${check.problem ?? 'The frida-server version could not be verified.'} ` +
          `Stop it (\`${adbBin} -s ${serial} shell killall frida-server\`) and re-run.`,
      );
    }
    log(`frida-server ${check.version} running (pid ${started.join(', ')}).`);
    return check.version;
  }

  async function ensureServer(version: string, abi: string): Promise<string> {
    const installedVersion = parseServerVersion(serverVersionOutput());
    const pids = serverPids();
    const binaryOk = installedVersion === version;
    const staleProcess = pids.some(isReplacedBinary);

    if (binaryOk && pids.length === 1 && !staleProcess) {
      log(`frida-server ${version} already running (pid ${pids[0] ?? ''}).`);
      return version;
    }

    if (pids.length > 0) {
      const reason = staleProcess
        ? 'its binary was replaced on disk'
        : !binaryOk
          ? `device has "${installedVersion ?? 'unknown'}", need ${version}`
          : `${String(pids.length)} instances are running`;
      log(`stopping frida-server (${reason}), pid(s) ${pids.join(', ')}.`);
      if (!(await stopServer())) {
        fail(
          'frida-server is still running after killall/pkill. Kill it by hand ' +
            `(\`${adbBin} -s ${serial} shell killall -9 frida-server\`) or restart the LDPlayer instance.`,
        );
      }
    }

    if (!binaryOk) {
      await installServer(version, abi);
    }

    return startServer(version);
  }

  async function ensureServerRunning(version: string, abi: string): Promise<string> {
    // Kept non-destructive on purpose: other Frida work may already be attached
    // to a running server, so this never kills or restarts one.
    void abi; // accepted for signature parity with ensureServer; no install here
    const installedVersion = parseServerVersion(serverVersionOutput());
    const pids = serverPids();

    if (pids.length > 0) {
      const staleProcess = pids.some(isReplacedBinary);
      if (installedVersion === version && !staleProcess) {
        log(`reusing running frida-server ${version} (pid ${pids.join(', ')}).`);
        return version;
      }
      const why = staleProcess
        ? 'its on-disk binary was replaced'
        : `the installed binary is ${installedVersion ?? 'unknown'}, not ${version}`;
      fail(
        `A frida-server is already running (pid ${pids.join(', ')}) but ${why}. ` +
          'Refusing to kill or restart it because other Frida work may be attached. ' +
          'Reconcile it (e.g. re-run `npm run trace:frida`, which manages the server) before opening a chat.',
      );
    }

    if (installedVersion === version) {
      log('no frida-server running; starting the installed matching binary.');
      return startServer(version);
    }

    fail(
      `No frida-server is running and the installed binary is ${installedVersion ?? 'missing'}, not ${version}. ` +
        'Run `npm run trace:frida` once to install and start the matching build, then retry.',
    );
  }

  async function waitForFridaDevice(): Promise<Device> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const device = await getDevice(serial, { timeout: 5_000 });
        await device.enumerateProcesses(); // confirms the server actually answers
        return device;
      } catch (error) {
        lastError = error;
        await delay(500);
      }
    }
    return fail(`Frida could not reach the device ${serial}: ${String(lastError)}`);
  }

  async function resolveViberPid(device: Device): Promise<number | undefined> {
    // On LDPlayer, frida's process list does not map the package name and its
    // startup process ids are short-lived; the application list carries the
    // stable live pid, so resolve through that.
    const apps = await device.enumerateApplications();
    const app = apps.find((entry) => entry.identifier === pkg);
    if (app === undefined || app.pid === 0) return undefined;
    return app.pid;
  }

  async function attachWithRetry(device: Device, initialPid: number, maxAttempts = 5): Promise<Session> {
    let currentPid = initialPid;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await device.attach(currentPid);
      } catch (error) {
        lastError = error;
        await delay(1000);
        let fresh = await resolveViberPid(device);
        if (fresh === undefined) {
          adbShell(`am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${pkg}/.WelcomeActivity`);
          await delay(1500);
          fresh = await resolveViberPid(device);
        }
        if (fresh !== undefined) {
          currentPid = fresh;
        }
      }
    }
    return fail(`${pkg}'s process vanished while attaching: ${String(lastError)}`);
  }

  function compileAgent(agentBaseName: string): string {
    const srcEntry = join(process.cwd(), 'src', 'platform', 'frida', 'scripts', `${agentBaseName}.js`);
    const fallbackEntry = join(process.cwd(), 'scripts', 'frida', `${agentBaseName}.js`);
    const entry = existsSync(srcEntry) ? srcEntry : fallbackEntry;
    const outPath = join(process.cwd(), '.frida', `${agentBaseName}.compiled.js`);
    const cli = join(process.cwd(), 'node_modules', 'frida-compile', 'dist', 'cli.js');
    mkdirSync(join(process.cwd(), '.frida'), { recursive: true });
    const result = spawnSync(
      process.execPath,
      [cli, entry, '-o', outPath, '--no-source-maps', '--type-check', 'none', '--bundle-format', 'iife'],
      { encoding: 'utf8', timeout: 120_000, windowsHide: true },
    );
    if (result.status !== 0) {
      fail(`frida-compile failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }
    return readFileSync(outPath, 'utf8');
  }

  return {
    adbRun,
    adbShell,
    readClientVersion,
    deviceAbi,
    ensureRoot,
    serverPids,
    ensureServer,
    ensureServerRunning,
    waitForFridaDevice,
    resolveViberPid,
    attachWithRetry,
    compileAgent,
  };
}
