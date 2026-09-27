import { existsSync } from 'node:fs';
import { join } from 'node:path';

import 'dotenv/config';

function optional(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? undefined : raw.trim();
}

function str(name: string, fallback: string): string {
  return optional(name) ?? fallback;
}

function required(name: string): string {
  const raw = optional(name);
  if (raw === undefined) {
    throw new Error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
  }
  return raw;
}

function int(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Env var ${name} must be a non-negative integer, got "${raw}".`);
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = optional(name)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error(`Env var ${name} must be true/false, got "${raw}".`);
}

/** Where LDPlayer lives and which instance we drive. */
export interface LdPlayerConfig {
  home: string;
  index: number;
  /** adb serial the instance is reachable at once ADB debugging is on. */
  serial: string;
  /** How long to wait for the instance to finish booting, in ms. */
  bootTimeout: number;
}

export interface AdbConfig {
  /** Absolute path to the adb binary. */
  bin: string;
  serial: string;
  execTimeout: number;
}

export interface ViberConfig {
  appPackage: string;
  appActivity: string | undefined;
  /** On-device path of the Viber messages database. */
  messagesDb: string;
  defaultName: string;
}

export interface AppiumConfig {
  host: string;
  port: number;
  newCommandTimeout: number;
  uiWaitTimeout: number;
  installTimeout: number;
}

/** Where new messages are pushed as they are captured. */
export interface WebhookConfig {
  url: string;
  /** Shared secret for the HMAC body signature; unsigned when unset. */
  secret: string | undefined;
  /** Per-attempt HTTP timeout in ms. */
  timeout: number;
  /** Total attempts per message, including the first. */
  maxAttempts: number;
  /** Base backoff in ms; doubles on every retry. */
  retryDelay: number;
  /** Where messages that exhausted their attempts are parked for replay. */
  deadLetterPath: string;
  /** Skip messages the automated account itself sent. */
  incomingOnly: boolean;
}

export interface MonitorConfig {
  /** How often to re-read the database for new messages, in ms. */
  pollInterval: number;
  /** Where captured messages are appended. */
  storePath: string;
  /** Undefined when no webhook is configured — the monitor then only logs and stores. */
  webhook: WebhookConfig | undefined;
}

/** LDPlayer's own bundled adb, used when no Android SDK is on the machine. */
const DEFAULT_LD_HOME = join('C:', 'LDPlayer', 'LDPlayer9');

function defaultAdbBin(): string {
  const home = optional('ANDROID_HOME') ?? optional('ANDROID_SDK_ROOT');
  if (home !== undefined) {
    const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
    const candidate = join(home, 'platform-tools', exe);
    if (existsSync(candidate)) return candidate;
  }
  if (process.platform === 'win32') {
    const ldAdb = join(str('LD_HOME', DEFAULT_LD_HOME), 'adb.exe');
    if (existsSync(ldAdb)) return ldAdb;
  }
  return 'adb';
}

export function loadLdPlayerConfig(): LdPlayerConfig {
  return {
    home: str('LD_HOME', DEFAULT_LD_HOME),
    index: int('LD_INDEX', 0),
    serial: str('ANDROID_SERIAL', '127.0.0.1:5555'),
    bootTimeout: int('LD_BOOT_TIMEOUT', 180_000),
  };
}

export function loadAdbConfig(): AdbConfig {
  return {
    bin: str('ADB_BIN', defaultAdbBin()),
    serial: str('ANDROID_SERIAL', '127.0.0.1:5555'),
    execTimeout: int('ADB_EXEC_TIMEOUT', 120_000),
  };
}

export function loadViberConfig(): ViberConfig {
  return {
    appPackage: str('VIBER_PACKAGE', 'com.viber.voip'),
    appActivity: optional('VIBER_ACTIVITY'),
    messagesDb: str('VIBER_MESSAGES_DB', '/data/data/com.viber.voip/databases/viber_messages'),
    defaultName: str('VIBER_DEFAULT_NAME', 'Maks'),
  };
}

export function loadAppiumConfig(): AppiumConfig {
  return {
    host: str('APPIUM_HOST', '127.0.0.1'),
    port: int('APPIUM_PORT', 4723),
    newCommandTimeout: int('APPIUM_NEW_COMMAND_TIMEOUT', 300),
    uiWaitTimeout: int('UI_WAIT_TIMEOUT', 15_000),
    installTimeout: int('ANDROID_INSTALL_TIMEOUT', 180_000),
  };
}

/**
 * Reads the webhook block, or undefined when no URL is set.
 *
 * The URL is validated here rather than at the first delivery: a typo would
 * otherwise stay invisible until a message finally arrived, which may be hours
 * into an unattended run.
 */
function loadWebhookConfig(): WebhookConfig | undefined {
  const url = optional('MONITOR_WEBHOOK_URL');
  if (url === undefined) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`MONITOR_WEBHOOK_URL is not a valid URL: "${url}".`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`MONITOR_WEBHOOK_URL must be http or https, got "${parsed.protocol}".`);
  }

  const maxAttempts = int('MONITOR_WEBHOOK_RETRIES', 4);
  if (maxAttempts < 1) {
    throw new Error('MONITOR_WEBHOOK_RETRIES must be at least 1.');
  }

  return {
    url,
    secret: optional('MONITOR_WEBHOOK_SECRET'),
    timeout: int('MONITOR_WEBHOOK_TIMEOUT', 10_000),
    maxAttempts,
    retryDelay: int('MONITOR_WEBHOOK_RETRY_DELAY', 1_000),
    deadLetterPath: str('MONITOR_WEBHOOK_DEAD_LETTER', 'data/webhook-failed.jsonl'),
    incomingOnly: bool('MONITOR_WEBHOOK_INCOMING_ONLY', true),
  };
}

export function loadMonitorConfig(): MonitorConfig {
  return {
    pollInterval: int('MONITOR_POLL_INTERVAL', 2_000),
    storePath: str('MONITOR_STORE', 'data/messages.jsonl'),
    webhook: loadWebhookConfig(),
  };
}

export { bool, int, optional, required, str };
