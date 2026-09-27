import { describe, expect, it, vi } from 'vitest';

import { AdbError } from '../../src/platform/adb.js';
import { restartViberApp, type RestartViberDeps } from '../../src/platform/restart-viber.js';

const PACKAGE = 'com.viber.voip';
const FOCUS_DUMP = `  mCurrentFocus=Window{a1b2 u0 ${PACKAGE}/${PACKAGE}.WelcomeActivity}`;

/** The exact shape `Adb.exec` throws when adbd stops answering mid-command. */
function timedOut(command: string): AdbError {
  return new AdbError(
    `adb shell ${command} timed out after 5000ms.`,
    ['shell', command],
    '',
    '',
    true,
  );
}

/**
 * Virtual clock: only an awaited delay moves time forward, so a run takes no
 * real milliseconds and always makes the same number of polls.
 */
function createClock(): { now: () => number; delay: (ms: number) => Promise<void> } {
  let current = 0;
  return {
    now: () => current,
    delay: (ms: number): Promise<void> => {
      current += ms;
      return Promise.resolve();
    },
  };
}

describe('restartViberApp', () => {
  it('retries past a launch that times out and reports Viber up', async () => {
    const clock = createClock();
    const commands: string[] = [];
    let launches = 0;

    const shell = vi.fn((command: string): string => {
      commands.push(command);
      if (command.startsWith('am start')) {
        launches += 1;
        // The first launch never reaches the device: adbd is still busy.
        if (launches === 1) throw timedOut(command);
        return '';
      }
      if (command.startsWith('pidof')) return launches >= 2 ? '4123\n' : '\n';
      if (command.startsWith('dumpsys')) return FOCUS_DUMP;
      return '';
    });
    const recover = vi.fn(() => true);

    const deps: RestartViberDeps = { shell, recover, delay: clock.delay, now: clock.now };
    const result = await restartViberApp(deps, {
      appPackage: PACKAGE,
      readyTimeoutMs: 3_000,
      settleMs: 100,
    });

    expect(result.started).toBe(true);
    expect(result.attempts).toBeGreaterThanOrEqual(2);
    expect(commands[0]).toBe(`am force-stop ${PACKAGE}`);
    expect(recover).toHaveBeenCalled();
  });

  it('stops after one attempt when Viber comes up straight away', async () => {
    const clock = createClock();
    const shell = vi.fn((command: string): string => {
      if (command.startsWith('pidof')) return '5150\n';
      if (command.startsWith('dumpsys')) return FOCUS_DUMP;
      return '';
    });
    const recover = vi.fn(() => true);

    const result = await restartViberApp(
      { shell, recover, delay: clock.delay, now: clock.now },
      { appPackage: PACKAGE, settleMs: 6_000 },
    );

    expect(result).toEqual({ started: true, attempts: 1, focused: true });
    expect(recover).not.toHaveBeenCalled();
    expect(shell).toHaveBeenCalledWith(
      `am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${PACKAGE}/.WelcomeActivity`,
      expect.objectContaining({ allowFailure: true }),
    );
    expect(shell).toHaveBeenCalledWith(
      `monkey -p ${PACKAGE} -c android.intent.category.LAUNCHER 1`,
      expect.objectContaining({ allowFailure: true }),
    );
    // The settle window is honoured rather than skipped.
    expect(clock.now()).toBeGreaterThanOrEqual(6_000);
  });

  it('gives up without throwing when Viber never comes back', async () => {
    const clock = createClock();
    const shell = vi.fn((command: string): string => {
      if (command.startsWith('am start')) throw timedOut(command);
      if (command.startsWith('pidof')) return '';
      return '';
    });
    const recover = vi.fn(() => false);

    const result = await restartViberApp(
      { shell, recover, delay: clock.delay, now: clock.now },
      { appPackage: PACKAGE, launchAttempts: 3, readyTimeoutMs: 2_000, settleMs: 100 },
    );

    expect(result.started).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.focused).toBe(false);
    expect(recover.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('reports focus when WelcomeActivity takes it', async () => {
    const clock = createClock();
    const shell = vi.fn((command: string): string => {
      if (command.startsWith('pidof')) return '77\n';
      if (command.startsWith('dumpsys')) return FOCUS_DUMP;
      return '';
    });

    const result = await restartViberApp(
      { shell, delay: clock.delay, now: clock.now },
      { appPackage: PACKAGE, settleMs: 100 },
    );

    expect(result.focused).toBe(true);
    expect(result.started).toBe(true);
  });

  it('still counts Viber as started when focus never shows up', async () => {
    const clock = createClock();
    const shell = vi.fn((command: string): string => {
      if (command.startsWith('pidof')) return '77\n';
      if (command.startsWith('dumpsys')) throw timedOut(command);
      return '';
    });

    const result = await restartViberApp(
      { shell, delay: clock.delay, now: clock.now },
      { appPackage: PACKAGE, settleMs: 100 },
    );

    expect(result.focused).toBe(false);
    expect(result.started).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it('ignores a host-side runApp helper that throws', async () => {
    const clock = createClock();
    const shell = vi.fn((command: string): string => {
      if (command.startsWith('pidof')) return '99\n';
      return '';
    });
    const runApp = vi.fn(() => {
      throw new Error('ldconsole.exe is not where we expected');
    });

    const result = await restartViberApp(
      { shell, runApp, delay: clock.delay, now: clock.now },
      { appPackage: PACKAGE, settleMs: 100 },
    );

    expect(result.started).toBe(true);
    expect(runApp).toHaveBeenCalled();
  });

  it('survives a force-stop that times out', async () => {
    const clock = createClock();
    const shell = vi.fn((command: string): string => {
      if (command.startsWith('am force-stop')) throw timedOut(command);
      if (command.startsWith('pidof')) return '31337\n';
      return '';
    });

    const result = await restartViberApp(
      { shell, delay: clock.delay, now: clock.now },
      { appPackage: PACKAGE, settleMs: 100 },
    );

    expect(result.started).toBe(true);
  });
});
