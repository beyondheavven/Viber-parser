import { loadAppiumConfig } from '../../config/env.js';
import type { ViberDriver } from '../../platform/appium/session.js';
import { byId } from './uiselector.js';

/** A bare Viber resource id, e.g. `com.viber.voip:id/messages_list`. */
const RESOURCE_ID = /^[\w.]+:id\/[\w]+$/;

/**
 * Normalises a locator for WebdriverIO.
 *
 * The selectors map holds bare resource ids, but `$()` reads an unprefixed
 * string as a CSS selector and chokes on the `:id/` colon-slash. A bare id is
 * therefore wrapped into a UiSelector; anything already carrying a strategy
 * prefix (`android=`, `~`, `//`) is passed through untouched.
 */
export function resolveLocator(selector: string): string {
  return RESOURCE_ID.test(selector) ? byId(selector) : selector;
}

export class BasePage {
  protected readonly timeout: number;

  constructor(protected readonly driver: ViberDriver) {
    this.timeout = loadAppiumConfig().uiWaitTimeout;
  }

  /** Waits for an element to exist and returns it. */
  protected async waitFor(selector: string, timeout = this.timeout) {
    const element = await this.driver.$(resolveLocator(selector));
    await element.waitForExist({
      timeout,
      timeoutMsg: `Timed out after ${String(timeout)}ms waiting for "${selector}".`,
    });
    return element;
  }

  protected async isPresent(selector: string, timeout = 2_000): Promise<boolean> {
    try {
      const element = await this.driver.$(resolveLocator(selector));
      await element.waitForExist({ timeout });
      return true;
    } catch {
      return false;
    }
  }

  protected async tap(selector: string, timeout = this.timeout): Promise<void> {
    const element = await this.waitFor(selector, timeout);
    await element.click();
  }

  protected async textOf(selector: string, timeout = this.timeout): Promise<string> {
    const element = await this.waitFor(selector, timeout);
    return element.getText();
  }

  /** Text of every element matching the selector, in document order. */
  protected async textsOf(selector: string): Promise<string[]> {
    const elements = await this.driver.$$(resolveLocator(selector));
    const texts: string[] = [];
    for (const element of elements) texts.push(await element.getText());
    return texts;
  }

  async currentActivity(): Promise<string> {
    return this.driver.getCurrentActivity();
  }
}
