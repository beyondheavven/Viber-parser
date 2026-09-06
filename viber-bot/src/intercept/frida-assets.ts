/**
 * Pure, side-effect-free helpers for the Frida intent tracer
 * (scripts/trace-intent-frida.ts). Nothing here touches the device, the network
 * or the filesystem: it maps a device ABI to the matching frida-server release
 * asset, builds the GitHub download URL, parses the installed client version,
 * and renders the captured intents into a deterministic Markdown summary.
 *
 * The frida client (npm binding or CLI) and the frida-server on the device must
 * be the exact same version, so the asset name is always built from the version
 * the host actually has installed.
 */

/** frida-server release assets use these arch tokens, not the Android ABI names. */
export type FridaArch = 'x86_64' | 'arm64' | 'arm' | 'x86';

const ABI_TO_ARCH: Record<string, FridaArch> = {
  x86_64: 'x86_64',
  'arm64-v8a': 'arm64',
  'armeabi-v7a': 'arm',
  x86: 'x86',
};

/**
 * Maps an Android ABI (`ro.product.cpu.abi`) to the frida-server release arch.
 *
 * Throws on an unknown ABI rather than guessing — downloading the wrong binary
 * would fail on the device with a confusing "not executable" error instead.
 */
export function abiToFridaArch(abi: string): FridaArch {
  const arch = ABI_TO_ARCH[abi.trim()];
  if (arch === undefined) {
    throw new Error(
      `Unknown abi "${abi.trim()}". Expected one of: ${Object.keys(ABI_TO_ARCH).join(', ')}.`,
    );
  }
  return arch;
}

/** e.g. ("17.17.0", "x86_64") -> "frida-server-17.17.0-android-x86_64.xz". */
export function fridaServerAssetName(version: string, abi: string): string {
  return `frida-server-${version}-android-${abiToFridaArch(abi)}.xz`;
}

/** GitHub release download URL for the frida-server asset matching version + abi. */
export function fridaReleaseUrl(version: string, abi: string): string {
  return `https://github.com/frida/frida/releases/download/${version}/${fridaServerAssetName(version, abi)}`;
}

/**
 * Extracts a frida version from a client's self-report — a bare `frida
 * --version` line, a noisier banner, or a package.json `version` field. Keeps a
 * dev/pre-release suffix (e.g. `-dev.3`) because those are distinct server
 * builds that must be matched exactly.
 */
export function parseClientVersion(raw: string): string {
  const match = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?/.exec(raw);
  if (match === null) {
    throw new Error(`Could not find a frida version in "${raw.trim()}".`);
  }
  return match[0];
}

/**
 * Reads the version a frida-server on the device printed for `--version`.
 *
 * Unlike {@link parseClientVersion} this never throws. A server that is
 * missing, not executable or was killed mid-answer prints nothing usable, and
 * the caller has to report that state rather than crash inside a regex.
 */
export function parseServerVersion(raw: string): string | null {
  const match = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?/.exec(raw);
  return match === null ? null : match[0];
}

export interface ServerVersionCheck {
  /** True only when the device runs the exact build this client speaks to. */
  ok: boolean;
  /** What the device reported, or null when it reported nothing usable. */
  version: string | null;
  /** Ready-to-print explanation of the failure; null when ok. */
  problem: string | null;
}

/** Longest slice of raw device output quoted back in a failure message. */
const MAX_ECHO = 120;

/** Folds device output onto one bounded line so it fits in an error message. */
function echoOutput(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (flat === '') return '(nothing)';
  return flat.length > MAX_ECHO ? `${flat.slice(0, MAX_ECHO)}...` : flat;
}

/**
 * Decides whether the frida-server on the device can serve this client.
 *
 * Frida requires client and server to be the exact same build — a mismatch
 * only surfaces later as an opaque failure on attach, so it is worth naming
 * both versions the moment the server answers.
 */
export function checkServerVersion(clientVersion: string, rawDeviceOutput: string): ServerVersionCheck {
  const version = parseServerVersion(rawDeviceOutput);
  if (version === clientVersion) {
    return { ok: true, version, problem: null };
  }
  const problem =
    version === null
      ? `The frida-server on the device reported no version (it printed "${echoOutput(rawDeviceOutput)}"), ` +
        `so it is missing or could not run; the client needs ${clientVersion}.`
      : `The frida-server on the device is ${version}, but the frida client is ${clientVersion}. ` +
        'Frida requires an exact match, so attaching would fail.';
  return { ok: false, version, problem };
}

export interface CapturedExtra {
  key: string;
  /** Java class name of the value, or "null". */
  type: string;
  /** String form of the value. */
  value: string;
}

export interface CapturedIntent {
  /** Which lifecycle method the intent was read in. */
  hook: 'onCreate' | 'onNewIntent' | string;
  /** Runtime class the hook fired on (matters in --all mode). */
  activity: string;
  action: string | null;
  dataString: string | null;
  /** Flags as a hex string, e.g. "0x10000000". */
  flags: string | null;
  component: string | null;
  extras: CapturedExtra[];
}

export interface SummaryMeta {
  device: string;
  package: string;
  clientVersion: string;
  serverVersion: string;
  /** "attach" or "spawn". */
  mode: string;
  /** Filesystem-safe ISO stamp used in the artifact filename. */
  capturedAt: string;
}

/** Keeps a value on one Markdown table cell: no raw pipes, no line breaks. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderIntent(intent: CapturedIntent, index: number): string {
  const header = `## Intent ${String(index + 1)} — ${intent.hook}`;
  const meta = [
    `- activity: \`${intent.activity}\``,
    `- action: ${intent.action === null ? '_(none)_' : `\`${intent.action}\``}`,
    `- data: ${intent.dataString === null ? '_(none)_' : `\`${intent.dataString}\``}`,
    `- flags: ${intent.flags === null ? '_(none)_' : `\`${intent.flags}\``}`,
    `- component: ${intent.component === null ? '_(none)_' : `\`${intent.component}\``}`,
  ].join('\n');

  if (intent.extras.length === 0) {
    return `${header}\n\n${meta}\n\nExtras: _(no extras)_\n`;
  }

  const rows = intent.extras
    .map((extra) => `| ${cell(extra.key)} | ${cell(extra.type)} | ${cell(extra.value)} |`)
    .join('\n');
  return (
    `${header}\n\n${meta}\n\n` +
    '### Extras\n\n' +
    '| key | type | value |\n| --- | --- | --- |\n' +
    rows +
    '\n'
  );
}

/**
 * Renders the captured intents into a deterministic Markdown report. Pure:
 * identical inputs always yield the identical string, which is what makes it
 * unit-testable without a device.
 */
export function formatIntentSummary(intents: CapturedIntent[], meta: SummaryMeta): string {
  const head =
    `# Viber ConversationActivity intent trace — ${meta.capturedAt}\n\n` +
    `- Device: \`${meta.device}\`\n` +
    `- Package: \`${meta.package}\`\n` +
    `- Frida: client \`${meta.clientVersion}\` / server \`${meta.serverVersion}\`\n` +
    `- Mode: ${meta.mode}\n` +
    `- Captured intents: ${String(intents.length)}\n`;

  if (intents.length === 0) {
    return (
      head +
      '\n## Result\n\nNo intents captured during the window. Attach the hook, then ' +
      'tap "Message <participant>" in Viber so ConversationActivity is (re)launched.\n'
    );
  }

  const body = intents.map((intent, index) => renderIntent(intent, index)).join('\n');
  return `${head}\n${body}`;
}
