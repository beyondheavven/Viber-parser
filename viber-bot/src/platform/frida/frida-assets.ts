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
