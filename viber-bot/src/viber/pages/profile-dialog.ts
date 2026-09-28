import { Logger } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import type { ViberDriver } from '../../platform/appium/session.js';
import { selectors } from './selectors.js';
import { loadViberConfig } from '../../config/env.js';

const logger = new Logger('ProfileDialogHandler');

/**
 * Detects and automatically resolves the "Add details: To join this Community, add a name to your profile"
 * dialog by clicking "ADD", filling in the default profile name, and confirming.
 * Also safely dismisses unexpected transient dialogs.
 */
export async function handleProfileModalPrompt(
  driver: ViberDriver,
  fallbackName?: string,
): Promise<boolean> {
  const defaultName = fallbackName || loadViberConfig().defaultName || 'Maks';

  try {
    // 1. Check if an alert dialog is visible
    const alertTitle = await driver.$('android=new UiSelector().resourceId("android:id/alertTitle")');
    const alertMessage = await driver.$('android=new UiSelector().resourceId("android:id/message")');

    let titleText = '';
    let messageText = '';

    if (await alertTitle.isExisting()) {
      titleText = (await alertTitle.getText()).trim().toLowerCase();
    }
    if (await alertMessage.isExisting()) {
      messageText = (await alertMessage.getText()).trim().toLowerCase();
    }

    const isProfileDialog =
      titleText.includes('detail') ||
      titleText.includes('данн') ||
      titleText.includes('дані') ||
      messageText.includes('name') ||
      messageText.includes('имя') ||
      messageText.includes("ім'я") ||
      messageText.includes('profile') ||
      messageText.includes('профил') ||
      messageText.includes('профіл') ||
      messageText.includes('community') ||
      messageText.includes('сообществ') ||
      messageText.includes('спільнот');

    if (isProfileDialog) {
      logger.log(`Detected profile name prompt ("${titleText || messageText}"). Resolving with name "${defaultName}"...`);

      // Click ADD (button1)
      const addBtn = await driver.$('android=new UiSelector().resourceId("android:id/button1")');
      if (await addBtn.isExisting()) {
        await addBtn.click();
        await delay(800);
      }

      // Look for name input field
      const nameInput = await driver.$(selectors.profile.nameInput);
      const fallbackInput = await driver.$('//android.widget.EditText');

      const targetInput = (await nameInput.isExisting()) ? nameInput : (await fallbackInput.isExisting()) ? fallbackInput : null;

      if (targetInput !== null) {
        try {
          await targetInput.click();
          await targetInput.clearValue();
          await targetInput.setValue(defaultName);
        } catch (e) {
          logger.warn(`Could not set profile name in modal: ${String(e)}`);
        }
        await delay(300);

        if (await driver.isKeyboardShown().catch(() => false)) {
          await driver.execute('mobile: hideKeyboard').catch(async () => driver.back());
          await delay(400);
        }

        // Click Continue / Save / Done
        const continueBtn = await driver.$(
          `android=new UiSelector().resourceId("${selectors.profile.continueButton}")`,
        );
        if (await continueBtn.isExisting()) {
          await continueBtn.click();
          await delay(800);
          logger.log(`Profile name set to "${defaultName}" via Continue button.`);
          return true;
        }

        // Fallback save buttons
        const saveBtn = await driver.$(
          'android.widget.Button[text="SAVE"], android.widget.Button[text="Save"], ' +
          'android.widget.Button[text="СОХРАНИТЬ"], android.widget.Button[text="Сохранить"], ' +
          'android.widget.Button[text="DONE"], android.widget.Button[text="Готово"], ' +
          'android.widget.Button[resource-id="android:id/button1"]',
        );
        if (await saveBtn.isExisting()) {
          await saveBtn.click();
          await delay(800);
          logger.log(`Profile name set to "${defaultName}" via save button.`);
          return true;
        }
      }
      return true;
    }

    // 2. Direct check if profile name input is already showing on screen
    const directNameInput = (await (await driver.$(selectors.profile.nameInput)).isExisting())
      ? await driver.$(selectors.profile.nameInput)
      : (await (await driver.$('//android.widget.EditText')).isExisting())
      ? await driver.$('//android.widget.EditText')
      : null;

    if (directNameInput !== null) {
      logger.log(`Direct profile name field detected on screen. Filling with "${defaultName}"...`);
      try {
        await directNameInput.click();
        await directNameInput.clearValue();
        await directNameInput.setValue(defaultName);
      } catch (err) {
        logger.warn(`Could not set value directly on EditText: ${String(err)}`);
      }
      if (await driver.isKeyboardShown().catch(() => false)) {
        await driver.execute('mobile: hideKeyboard').catch(async () => driver.back());
        await delay(400);
      }
      const continueBtn = await driver.$(
        `android=new UiSelector().resourceId("${selectors.profile.continueButton}")`,
      );
      if (await continueBtn.isExisting()) {
        await continueBtn.click();
        await delay(800);
        return true;
      }
    }
  } catch (err) {
    logger.warn(`Error while checking/resolving profile prompt: ${String(err)}`);
  }

  return false;
}
