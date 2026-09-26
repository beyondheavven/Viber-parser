import { loadViberConfig } from '../../../config/env.js';
import type { Adb } from '../../../platform/adb.js';
import { createViberSession, type ViberDriver } from '../../../platform/appium/session.js';
import { openDevice } from '../../../platform/context.js';
import { restartViberApp } from '../../../platform/restart-viber.js';
import { resolveLocator } from '../../../viber/pages/base.page.js';

export interface ShellOptions {
  allowFailure?: boolean;
  timeout?: number;
}

/**
 * Everything the QR flow needs from the emulator, so the flow itself can be
 * driven by a scripted fake in tests.
 */
export interface QrDevice {
  shell(command: string, options?: ShellOptions): string;
  /** Force-stops Viber and brings it back on its launcher activity. */
  restartViber(): Promise<boolean>;
  pageSource(): Promise<string>;
  currentActivity(): Promise<string | null>;
  screenshot(): Promise<Buffer>;
  tap(point: { x: number; y: number }): Promise<void>;
  /** Replaces the text of the field with this resource id and returns what it shows afterwards. */
  replaceText(resourceId: string, text: string): Promise<string>;
  hideKeyboard(): Promise<void>;
  pressEnter(): Promise<void>;
  /** Drops the UI automation session so the next call opens a fresh one. */
  resetUi(): Promise<void>;
  close(): Promise<void>;
}

const KEYCODE_ENTER = 66;

/**
 * Root adb for the device-level steps (density, data, restart) and an Appium
 * session for the screen.
 *
 * The session is opened lazily: the density is changed and Viber restarted
 * before the first look at the screen, and UiAutomator2 is better started
 * against the app that will actually be on screen.
 */
class AppiumQrDevice implements QrDevice {
  private driver: ViberDriver | null = null;

  constructor(private readonly adb: Adb) {}

  shell(command: string, options?: ShellOptions): string {
    return this.adb.shell(command, options);
  }

  async restartViber(): Promise<boolean> {
    const result = await restartViberApp(
      {
        shell: (command, options) => this.adb.shell(command, options),
        recover: (timeout) => this.adb.recover(timeout),
      },
      { appPackage: loadViberConfig().appPackage, settleMs: 2_000 },
    );
    return result.started;
  }

  private async ui(): Promise<ViberDriver> {
    this.driver ??= await createViberSession();
    return this.driver;
  }

  async pageSource(): Promise<string> {
    return (await this.ui()).getPageSource();
  }

  async currentActivity(): Promise<string | null> {
    return (await this.ui()).getCurrentActivity().catch(() => null);
  }

  async screenshot(): Promise<Buffer> {
    return Buffer.from(await (await this.ui()).takeScreenshot(), 'base64');
  }

  async tap(point: { x: number; y: number }): Promise<void> {
    await (await this.ui()).execute('mobile: clickGesture', { x: point.x, y: point.y });
  }

  async replaceText(resourceId: string, text: string): Promise<string> {
    const field = await (await this.ui()).$(resolveLocator(resourceId));
    await field.waitForExist({ timeout: 5_000 });
    await field.click();
    await field.clearValue();
    await field.setValue(text);
    return field.getText();
  }

  async hideKeyboard(): Promise<void> {
    const driver = await this.ui();
    if (!(await driver.isKeyboardShown().catch(() => false))) return;
    await driver.execute('mobile: hideKeyboard').catch(() => driver.back());
    await driver.pause(400);
  }

  async pressEnter(): Promise<void> {
    await (await this.ui()).pressKeyCode(KEYCODE_ENTER);
  }

  async resetUi(): Promise<void> {
    const driver = this.driver;
    this.driver = null;
    await driver?.deleteSession().catch(() => undefined);
  }

  async close(): Promise<void> {
    await this.resetUi();
  }
}

export async function openQrDevice(): Promise<QrDevice> {
  const { adb } = await openDevice({ ensureUp: false });
  return new AppiumQrDevice(adb);
}
