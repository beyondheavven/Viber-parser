import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadLdPlayerConfig, type LdPlayerConfig } from '../config/env.js';
import type { Adb } from './adb.js';

export interface LdInstance {
  index: number;
  title: string;
  androidStarted: boolean;
  pid: number;
  width: number;
  height: number;
  dpi: number;
}

/**
 * Parses the CSV that `ldconsole list2` prints, one line per instance:
 * `index,title,topWindow,bindWindow,androidStarted,pid,vboxPid,width,height,dpi`
 */
export function parseInstances(stdout: string): LdInstance[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .flatMap((line) => {
      const parts = line.split(',');
      if (parts.length < 10) return [];
      const index = Number.parseInt(parts[0] ?? '', 10);
      if (!Number.isInteger(index)) return [];
      return [
        {
          index,
          title: parts[1] ?? '',
          androidStarted: parts[4] === '1',
          pid: Number.parseInt(parts[5] ?? '-1', 10),
          width: Number.parseInt(parts[7] ?? '0', 10),
          height: Number.parseInt(parts[8] ?? '0', 10),
          dpi: Number.parseInt(parts[9] ?? '0', 10),
        },
      ];
    });
}

/**
 * Flips `basicSettings.adbDebug` in an instance config.
 *
 * LDPlayer ships with ADB debugging off, which makes the instance invisible to
 * adb and therefore to Appium. The setting lives in the instance's JSON config
 * and is only read at boot, so the instance has to be stopped before patching.
 */
export function patchAdbDebug(configJson: string, enabled: boolean): string {
  const value = enabled ? 1 : 0;
  if (new RegExp(`"basicSettings\.adbDebug"\s*:\s*${String(value)}\b`).test(configJson)) {
    return configJson;
  }
  if (!/"basicSettings\.adbDebug"\s*:\s*\d+/.test(configJson)) {
    throw new Error('Instance config has no "basicSettings.adbDebug" key.');
  }
  return configJson.replace(/"basicSettings\.adbDebug"\s*:\s*\d+/, `"basicSettings.adbDebug": ${String(value)}`);
}

export function readAdbDebug(configJson: string): number | undefined {
  const match = /"basicSettings\.adbDebug"\s*:\s*(\d+)/.exec(configJson);
  return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class LdPlayer {
  constructor(private readonly config: LdPlayerConfig = loadLdPlayerConfig()) {}

  get index(): number {
    return this.config.index;
  }

  private get consolePath(): string {
    return join(this.config.home, 'ldconsole.exe');
  }

  private get instanceConfigPath(): string {
    return join(this.config.home, 'vms', 'config', `leidian${String(this.config.index)}.config`);
  }

  private console(args: readonly string[]): string {
    if (!existsSync(this.consolePath)) {
      throw new Error(`ldconsole.exe not found at ${this.consolePath}. Set LD_HOME in .env.`);
    }
    const result = spawnSync(this.consolePath, [...args], {
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
    });
    if (result.error !== undefined) {
      throw new Error(`ldconsole failed to start: ${result.error.message}`);
    }
    return (result.stdout ?? '').replace(/\r\n/g, '\n');
  }

  instances(): LdInstance[] {
    return parseInstances(this.console(['list2']));
  }

  instance(): LdInstance | undefined {
    return this.instances().find((item) => item.index === this.config.index);
  }

  isRunning(): boolean {
    return this.instance()?.androidStarted === true;
  }

  launch(): void {
    this.console(['launch', '--index', String(this.config.index)]);
  }

  quit(): void {
    this.console(['quit', '--index', String(this.config.index)]);
  }

  /**
   * Makes sure ADB debugging is on, stopping the instance first if the setting
   * has to change. Returns true when the config was actually modified.
   */
  ensureAdbDebug(): boolean {
    const path = this.instanceConfigPath;
    if (!existsSync(path)) {
      throw new Error(`Instance config not found at ${path}. Is LD_INDEX=${String(this.config.index)} correct?`);
    }
    const current = readFileSync(path, 'utf8');
    if (readAdbDebug(current) === 1) return false;
    if (this.isRunning()) {
      this.quit();
    }
    writeFileSync(path, patchAdbDebug(current, true), 'utf8');
    return true;
  }

  /** Waits until the instance reports a finished Android boot. */
  async waitForBoot(adb: Adb): Promise<void> {
    const deadline = Date.now() + this.config.bootTimeout;
    let lastError = 'instance never came online';
    while (Date.now() < deadline) {
      try {
        adb.connect();
        if (adb.isBooted()) return;
        lastError = 'adb connected but sys.boot_completed is not 1';
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await sleep(3_000);
    }
    throw new Error(
      `LDPlayer instance ${String(this.config.index)} did not boot within ${String(this.config.bootTimeout)}ms: ${lastError}`,
    );
  }

  /** Brings the instance to a state where adb works as root. */
  async up(adb: Adb): Promise<void> {
    const patched = this.ensureAdbDebug();
    if (patched) {
      console.log(`Enabled ADB debugging on instance ${String(this.config.index)}.`);
    }
    if (!this.isRunning()) {
      this.launch();
    }
    await this.waitForBoot(adb);
    adb.root();
    if (!adb.isRoot()) {
      throw new Error(
        'adb is not running as root. Enable root mode for the instance in LDPlayer settings and restart it.',
      );
    }
  }
}
