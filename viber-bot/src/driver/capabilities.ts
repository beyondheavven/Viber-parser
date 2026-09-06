import type { AppiumConfig, ViberConfig } from '../config/env.js';

export type ViberCapabilities = Record<string, unknown>;

/**
 * W3C capabilities for driving Viber inside LDPlayer.
 *
 * The instance answers to two adb serials at once — `127.0.0.1:5555` and
 * `emulator-5554` — so `udid` is always sent explicitly; without it the driver
 * has to guess between them.
 */
export function buildViberCapabilities(
  viber: ViberConfig,
  appium: AppiumConfig,
  udid: string,
): ViberCapabilities {
  const caps: ViberCapabilities = {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:udid': udid,
    'appium:deviceName': udid,
    'appium:appPackage': viber.appPackage,
    // Viber's launcher activity differs between builds, so the driver settles
    // on whatever actually comes up instead of being told a fixed name.
    'appium:appWaitActivity': viber.appActivity ?? '*',
    // Never wipe app data: a reset would drop the Viber login and there is no
    // way to activate the account again from inside an emulator.
    'appium:noReset': true,
    'appium:fullReset': false,
    'appium:newCommandTimeout': appium.newCommandTimeout,
    'appium:disableWindowAnimation': true,
    'appium:ignoreHiddenApiPolicyError': true,
    'appium:autoGrantPermissions': true,
    // The first session sideloads io.appium.settings and the UiAutomator2
    // server. LDPlayer's virtual storage is slower than a real phone's and
    // blows past the 60s default.
    'appium:androidInstallTimeout': appium.installTimeout,
    'appium:uiautomator2ServerInstallTimeout': appium.installTimeout,
    'appium:adbExecTimeout': 120_000,
    // Viber renders long chat lists; keeping the hierarchy uncompressed leaves
    // otherwise-collapsed nodes addressable.
    'appium:settings[allowInvisibleElements]': true,
  };

  if (viber.appActivity !== undefined) caps['appium:appActivity'] = viber.appActivity;
  return caps;
}
