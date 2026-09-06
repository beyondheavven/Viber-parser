/**
 * Bringing Viber back up after its database has been rewritten underneath it.
 *
 * The restart runs at the worst possible moment for adb: Frida has just
 * detached and a batch of sqlite writes has just landed, which is exactly when
 * adbd stops answering for a few seconds. `Adb.exec` turns a spawn timeout
 * into a thrown `AdbError` *before* it looks at `allowFailure`, so a stalled
 * `am start` used to abort the whole run — with Viber already force-stopped
 * and nothing left to bring it back.
 *
 * Every command here therefore goes through `safeShell`, which swallows the
 * throw as well as the non-zero exit, and the launch is retried until the
 * process is actually observed running. The function never throws: by the time
 * it is called the roster is already collected and written, so a warning is a
 * far better outcome than losing the run.
 */

export interface RestartViberDeps {
  shell(command: string, options?: { allowFailure?: boolean; timeout?: number }): string;
  /** `Adb.recover`, used to un-wedge the transport between launch attempts. */
  recover?: (timeout?: number) => boolean;
  /** Best-effort host-side nudge (LDPlayer's `ldconsole runapp`). */
  runApp?: () => void;
  /** Injectable for tests; defaults to a real timer. */
  delay?: (ms: number) => Promise<void>;
  /** Injectable clock; defaults to `Date.now`. */
  now?: () => number;
}

export interface RestartViberOptions {
  appPackage: string;
  /** How many times to try launching before giving up. Defaults to 3. */
  launchAttempts?: number;
  /** How long to wait for the process to appear after each launch. Defaults to 15_000 ms. */
  readyTimeoutMs?: number;
  /** Extra time for the chat list to populate once the process is up. Defaults to 6_000 ms. */
  settleMs?: number;
}

export interface RestartViberResult {
  /** Whether Viber's process was observed running. */
  started: boolean;
  /** How many launch attempts were made. */
  attempts: number;
  /** Whether WelcomeActivity took focus — informational, never fatal. */
  focused: boolean;
}

const DEFAULT_LAUNCH_ATTEMPTS = 3;
const DEFAULT_READY_TIMEOUT_MS = 15_000;
const DEFAULT_SETTLE_MS = 6_000;

/** Killing an app can take a while when the system is busy; give it room. */
const FORCE_STOP_TIMEOUT_MS = 20_000;
/** Without `-W` a launch returns immediately, so this only catches a stall. */
const LAUNCH_TIMEOUT_MS = 15_000;
/** Cheap probes (`pidof`, `dumpsys`) either answer fast or not at all. */
const PROBE_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 1_000;
/** Let the process table settle after force-stop before launching again. */
const STOP_SETTLE_MS = 1_500;
/** Focus is a nice-to-have signal, so it gets a short window of its own. */
const FOCUS_TIMEOUT_MS = 10_000;

const realDelay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * True when `pidof` named at least one running process. It prints one or more
 * space-separated pids, and nothing at all when the package is not running.
 */
function hasPid(output: string): boolean {
  return output
    .trim()
    .split(/\s+/)
    .some((token) => /^\d+$/.test(token));
}

export async function restartViberApp(
  deps: RestartViberDeps,
  options: RestartViberOptions,
): Promise<RestartViberResult> {
  const {
    appPackage,
    launchAttempts = DEFAULT_LAUNCH_ATTEMPTS,
    readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
    settleMs = DEFAULT_SETTLE_MS,
  } = options;
  const delay = deps.delay ?? realDelay;
  const now = deps.now ?? Date.now;

  /**
   * The crux of the fix. `allowFailure` only suppresses a non-zero exit code —
   * a spawn timeout still throws — so the throw is caught here instead.
   */
  const safeShell = (command: string, timeout: number): string => {
    try {
      return deps.shell(command, { allowFailure: true, timeout });
    } catch {
      return '';
    }
  };

  /** Polls `check` on the injected clock, so tests need no real timers. */
  const pollUntil = async (check: () => boolean, timeoutMs: number): Promise<boolean> => {
    const deadline = now() + timeoutMs;
    const maxRounds = Math.max(1, Math.ceil(timeoutMs / POLL_INTERVAL_MS) + 1);
    for (let round = 0; round < maxRounds; round += 1) {
      if (check()) return true;
      if (now() >= deadline) return false;
      await delay(POLL_INTERVAL_MS);
    }
    return false;
  };

  safeShell(`am force-stop ${appPackage}`, FORCE_STOP_TIMEOUT_MS);
  await delay(STOP_SETTLE_MS);

  let started = false;
  let attempts = 0;
  const rounds = Math.max(1, launchAttempts);
  for (let attempt = 1; attempt <= rounds; attempt += 1) {
    attempts = attempt;

    safeShell(
      `am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${appPackage}/.WelcomeActivity`,
      LAUNCH_TIMEOUT_MS,
    );
    safeShell(`monkey -p ${appPackage} -c android.intent.category.LAUNCHER 1`, LAUNCH_TIMEOUT_MS);
    try {
      deps.runApp?.();
    } catch {
      // Fronting the window on the host is a nicety, never a reason to fail.
    }

    started = await pollUntil(
      () => hasPid(safeShell(`pidof ${appPackage}`, PROBE_TIMEOUT_MS)),
      readyTimeoutMs,
    );
    if (started) break;

    // Nothing came up, so the launch probably never reached the device. Try to
    // un-wedge the transport — also after the final attempt, so whatever the
    // caller runs next has a chance of talking to a live adbd.
    try {
      deps.recover?.();
    } catch {
      // Recovery is itself a best-effort step on an error path.
    }
  }

  let focused = false;
  if (started) {
    focused = await pollUntil(() => {
      const dump = safeShell('dumpsys window', PROBE_TIMEOUT_MS);
      return dump.includes('mCurrentFocus') && dump.includes(`${appPackage}.WelcomeActivity`);
    }, FOCUS_TIMEOUT_MS);
    await delay(settleMs);
  }

  return { started, attempts, focused };
}
