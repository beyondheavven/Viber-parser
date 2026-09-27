/**
 * Getting Viber to offer the secondary-device (QR) activation.
 *
 * Viber shows the QR step only in its `sw600dp` layout, and on an emulator
 * with a fixed panel the density is the only lever: dp = px * 160 / dpi.
 * The layout is needed on the phone-entry step only — once Viber has switched
 * to the secondary activation the QR screen renders at any density — so the
 * caller restores the device's own density as soon as the code is up.
 */

/** Narrowest layout Android calls a tablet; below it Viber hides the QR option. */
export const TABLET_MIN_WIDTH_DP = 600;

/**
 * The highest density the flow will use for the tablet layout.
 *
 * {@link densityForTabletLayout} computes the exact threshold, but a screen on
 * the boundary is at the mercy of rounding inside the framework; 120 is the
 * value the secondary-device layout was actually observed at on a 540px panel.
 */
export const TABLET_DENSITY = 120;

/**
 * Where the density to go back to is kept while it is overridden.
 *
 * Lives on the device rather than in this process: if the API dies between
 * widening and restoring, the next session still knows which value is the
 * device's own and which one is our leftover.
 */
export const DENSITY_MARKER_PATH = '/data/local/tmp/viber-qr-density';

export interface DensityShell {
  shell(command: string, options?: { allowFailure?: boolean; timeout?: number }): string;
}

export interface WmDensities {
  /** The panel's own density — what `wm density reset` goes back to. */
  physical: number | null;
  /** Set by whoever last ran `wm density N`; null when nobody has. */
  override: number | null;
}

export interface WmSize {
  width: number;
  height: number;
}

function positiveInt(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseWmDensities(output: string): WmDensities {
  return {
    physical: positiveInt(/Physical density:\s*(\d+)/u.exec(output)?.[1]),
    override: positiveInt(/Override density:\s*(\d+)/u.exec(output)?.[1]),
  };
}

/** The size the layout is built for: the override when there is one. */
export function parseWmSize(output: string): WmSize | null {
  const match =
    /Override size:\s*(\d+)x(\d+)/u.exec(output) ?? /Physical size:\s*(\d+)x(\d+)/u.exec(output);
  const width = positiveInt(match?.[1]);
  const height = positiveInt(match?.[2]);
  return width === null || height === null ? null : { width, height };
}

/**
 * Whether Viber will offer the secondary-device layout.
 *
 * `sw` is the *smallest* width: an emulator in landscape reports 1280x720, and
 * it is the 720 that decides, not the 1280.
 */
export function isTabletLayout(size: WmSize, density: number): boolean {
  if (density <= 0) return false;
  return (Math.min(size.width, size.height) * 160) / density >= TABLET_MIN_WIDTH_DP;
}

/** The highest density that still reaches `sw600dp` on a screen this size. */
export function densityForTabletLayout(size: WmSize): number {
  return Math.floor((Math.min(size.width, size.height) * 160) / TABLET_MIN_WIDTH_DP);
}

const METRICS_ATTEMPTS = 3;

function safeShell(device: DensityShell, command: string): string {
  try {
    return device.shell(command, { allowFailure: true, timeout: 15_000 });
  } catch {
    return '';
  }
}

function readMarker(device: DensityShell): number | null {
  return positiveInt(safeShell(device, `cat ${DENSITY_MARKER_PATH} 2>/dev/null`).trim());
}

function restoreTo(device: DensityShell, normal: number, physical: number | null): void {
  safeShell(device, normal === physical ? 'wm density reset' : `wm density ${String(normal)}`);
  safeShell(device, `rm -f ${DENSITY_MARKER_PATH}`);
}

export interface WidenResult {
  /** Undoes the change; null when the density was left alone. */
  restore: (() => void) | null;
  /** Human-readable account of what was done, for the log. */
  note: string;
}

/**
 * Puts the screen into the `sw600dp` bucket and hands back how to undo it.
 *
 * A marker left by an interrupted session wins over whatever `wm density`
 * reports: the override on the device is then ours, not the device's own
 * setting, and taking it for the latter would strand the emulator there.
 */
export function widenForTabletLayout(device: DensityShell): WidenResult {
  let size: WmSize | null = null;
  let densities: WmDensities = { physical: null, override: null };
  // `wm` answers nothing for a moment while the system server is busy — right
  // after boot or an app being killed — so a blank read is retried.
  for (let attempt = 1; attempt <= METRICS_ATTEMPTS; attempt += 1) {
    size = parseWmSize(safeShell(device, 'wm size'));
    densities = parseWmDensities(safeShell(device, 'wm density'));
    if (size !== null && (densities.override ?? densities.physical) !== null) break;
    if (attempt < METRICS_ATTEMPTS) safeShell(device, 'sleep 2');
  }
  const { physical, override } = densities;
  const current = override ?? physical;
  if (size === null || current === null) {
    return { restore: null, note: 'screen metrics unreadable; density left alone' };
  }

  const leftover = readMarker(device);
  const normal = leftover ?? current;

  if (isTabletLayout(size, normal)) {
    if (leftover !== null) restoreTo(device, normal, physical);
    return {
      restore: null,
      note:
        leftover !== null
          ? `restored leftover density ${String(current)} → ${String(normal)}; layout is already sw600dp`
          : `density ${String(current)} already gives sw600dp`,
    };
  }

  const target = Math.min(densityForTabletLayout(size), TABLET_DENSITY);
  safeShell(device, `echo ${String(normal)} > ${DENSITY_MARKER_PATH}`);
  if (current !== target) safeShell(device, `wm density ${String(target)}`);

  return {
    restore: () => restoreTo(device, normal, physical),
    note: `density ${String(current)} → ${String(target)} for the tablet layout (will restore ${String(normal)})`,
  };
}
