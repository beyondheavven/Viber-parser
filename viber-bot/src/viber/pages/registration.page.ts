import { BasePage } from './base.page.js';
import { ActivationRejectedError } from './errors.js';
import { selectors } from './selectors.js';
import { byIdAndTextContains, byTextContains } from './uiselector.js';

/** Where the registration flow currently stands, as read off the screen. */
export type RegistrationScreen =
  | 'splash'
  | 'phone_input'
  | 'country_picker'
  | 'permission_rationale'
  | 'system_permission'
  | 'verifying'
  | 'alert'
  | 'activated'
  | 'unknown';

/**
 * Viber's account activation screens, captured from `com.viber.voip` 20.1 on
 * the dockerised Android 11 emulator (1280x720, LDPlayer-style tablet preset).
 *
 * Every control is addressed by its resource id. The phone screen scrolls
 * under the soft keyboard — `btn_continue` was observed at y=401 with the
 * keyboard down and at y=356 with it up — so nothing here may tap a fixed
 * coordinate.
 */
export class RegistrationPage extends BasePage {
  /** Reports which of the activation screens is in front right now. */
  async currentScreen(): Promise<RegistrationScreen> {
    if (await this.isPresent(selectors.systemPermission.dialog, 300)) return 'system_permission';
    if (await this.isPresent(selectors.alert.title, 300)) return 'alert';
    if (await this.isPresent(selectors.permissionRationale.continueButton, 300)) {
      return 'permission_rationale';
    }
    if (await this.isPresent(selectors.selectCountry.searchInput, 300)) return 'country_picker';
    if (await this.isPresent(selectors.verifying.message, 300)) return 'verifying';
    if (await this.isPresent(selectors.registration.phoneField, 300)) return 'phone_input';
    if (await this.isPresent(selectors.splash.startButton, 300)) return 'splash';
    if (await this.isPresent(selectors.chatList.root, 300)) return 'activated';
    return 'unknown';
  }

  /** Taps "Start now" on the welcome splash and waits for the phone screen. */
  async dismissSplash(): Promise<void> {
    if (!(await this.isPresent(selectors.splash.startButton, 2_000))) return;
    await this.tap(selectors.splash.startButton);
    await this.waitFor(selectors.registration.phoneField, 20_000);
  }

  /** Country currently shown on the picker button, without its flag emoji. */
  async selectedCountry(): Promise<string> {
    const label = await this.textOf(selectors.registration.countryButton);
    return label.replace(/[^\p{L}\s'.()-]/gu, '').trim();
  }

  /** Country calling code Viber has filled in, e.g. "375". */
  async countryCode(): Promise<string> {
    return (await this.textOf(selectors.registration.codeField)).replace(/\D/gu, '');
  }

  /**
   * Picks a country through the picker's search box.
   *
   * Rows carry no id of their own — the tappable row is an unnamed
   * LinearLayout wrapping a `name` label — so the row is matched on that
   * label's text, which reads "<flag>  Belarus (+375)".
   */
  async chooseCountry(country: string): Promise<void> {
    if ((await this.selectedCountry()).toLowerCase() === country.toLowerCase()) return;

    await this.tap(selectors.registration.countryButton);
    const search = await this.waitFor(selectors.selectCountry.searchInput, 15_000);
    await search.click();
    await search.setValue(country);

    const row = await this.driver.$(
      byIdAndTextContains(selectors.selectCountry.rowName, country),
    );
    await row.waitForExist({
      timeout: 15_000,
      timeoutMsg: `Country "${country}" never appeared in the picker's results.`,
    });
    await row.click();

    await this.waitFor(selectors.registration.phoneField, 15_000);
    const chosen = await this.selectedCountry();
    if (!chosen.toLowerCase().includes(country.toLowerCase())) {
      throw new Error(`Picked "${country}" but the form now shows "${chosen}".`);
    }
  }

  /**
   * Types the subscriber number into the phone field.
   *
   * `registration_code_field` already holds the country's calling code, so the
   * digits here must not repeat it — Viber would otherwise submit 375375…
   */
  async enterPhone(nationalNumber: string): Promise<void> {
    const digits = nationalNumber.replace(/\D/gu, '');
    if (digits === '') throw new Error('The phone number contains no digits.');

    const field = await this.waitFor(selectors.registration.phoneField);
    await field.click();
    await field.clearValue();
    await field.setValue(digits);

    // Viber reformats as it goes ("33 643-33-50"), so compare digits only.
    const shown = (await field.getText()).replace(/\D/gu, '');
    if (shown !== digits) {
      throw new Error(`Phone field holds "${shown}" after typing "${digits}".`);
    }
  }

  /** Submits the number. The keyboard is closed first so the button is on screen. */
  async submitPhone(): Promise<void> {
    if (await this.driver.isKeyboardShown()) {
      await this.driver.execute('mobile: hideKeyboard').catch(() => this.driver.back());
      await this.driver.pause(400);
    }
    await this.tap(selectors.registration.continueButton);
  }

  /** Accepts Viber's own contacts/call-log explanation, when it is shown. */
  async acceptPermissionRationale(timeout = 6_000): Promise<boolean> {
    if (!(await this.isPresent(selectors.permissionRationale.continueButton, timeout))) return false;
    await this.tap(selectors.permissionRationale.continueButton);
    return true;
  }

  /**
   * Clears Android's runtime permission dialogs, which arrive one after
   * another (contacts, then call logs).
   */
  async allowSystemPermissions(maxDialogs = 5): Promise<string[]> {
    const granted: string[] = [];
    for (let dialog = 0; dialog < maxDialogs; dialog += 1) {
      if (!(await this.isPresent(selectors.systemPermission.allowButton, 3_000))) break;
      const message = await this.textOf(selectors.systemPermission.message, 2_000).catch(() => '');
      await this.tap(selectors.systemPermission.allowButton);
      granted.push(message);
      await this.driver.pause(800);
    }
    return granted;
  }

  /**
   * Waits out the "Verifying your number" spinner and reports what came next.
   *
   * Viber answers a rejected number with an "Activation failed" AlertDialog
   * rather than an error on the form, so that dialog is surfaced as
   * {@link ActivationRejectedError} instead of being left on screen.
   */
  async awaitVerificationOutcome(timeout = 60_000): Promise<RegistrationScreen> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const screen = await this.currentScreen();
      if (screen === 'alert') {
        const title = await this.textOf(selectors.alert.title, 2_000).catch(() => 'Activation failed');
        const message = await this.textOf(selectors.alert.message, 2_000).catch(() => '');
        await this.dismissAlert();
        throw new ActivationRejectedError(title.trim(), message.trim());
      }
      if (screen !== 'verifying' && screen !== 'unknown') return screen;
      await this.driver.pause(700);
    }
    throw new Error('Viber never finished verifying the number.');
  }

  /** Closes an AlertDialog with its right-hand button (CLOSE, not HELP). */
  async dismissAlert(): Promise<void> {
    if (await this.isPresent(selectors.alert.positiveButton, 2_000)) {
      await this.tap(selectors.alert.positiveButton);
    }
  }

  /**
   * Gets past the "Your name" profile screen that follows an accepted code,
   * when it is shown — typing `name` first if one is given. Resolved from the
   * element rather than a fixed point, so it survives a change of screen
   * resolution.
   */
  async completeProfile(name?: string, timeout = 6_000): Promise<boolean> {
    if (!(await this.isPresent(selectors.profile.continueButton, timeout))) return false;
    if (name !== undefined && (await this.isPresent(selectors.profile.nameInput, 1_000))) {
      const field = await this.waitFor(selectors.profile.nameInput);
      await field.clearValue();
      await field.setValue(name);
      if (await this.driver.isKeyboardShown()) {
        await this.driver.execute('mobile: hideKeyboard').catch(() => this.driver.back());
        await this.driver.pause(400);
      }
    }
    await this.tap(selectors.profile.continueButton);
    return true;
  }

  /** True once Viber is past activation and showing the conversation list. */
  async isActivated(timeout = 2_000): Promise<boolean> {
    return this.isPresent(selectors.chatList.root, timeout);
  }

  /** Text of whatever is on screen — the evidence an unexpected state needs. */
  async describeScreen(): Promise<string> {
    const activity = await this.currentActivity().catch(() => '?');
    const source = await this.driver.getPageSource();
    const texts = [...source.matchAll(/ text="([^"]{2,80})"/gu)]
      .map((match) => match[1]?.trim())
      .filter((text): text is string => Boolean(text));
    return `${activity}: ${[...new Set(texts)].slice(0, 10).join(' | ') || '(no text on screen)'}`;
  }

  /** Convenience for callers that want to see a specific label. */
  async hasText(fragment: string, timeout = 1_500): Promise<boolean> {
    return this.isPresent(byTextContains(fragment), timeout);
  }
}
