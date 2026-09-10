import { Injectable, Logger } from '@nestjs/common';
import { openDevice } from '../context.js';
import { withViberSession } from '../driver/session.js';
import { ActivationRejectedError } from '../pages/errors.js';
import { RegistrationPage } from '../pages/registration.page.js';
import type {
  AuthResponseDto,
  AuthStatusDto,
  ConfirmCodeDto,
  LoginPhoneDto,
} from './dto/auth.dto.js';

/**
 * Viber keeps the calling code in its own field, so the subscriber digits must
 * not repeat it — "+375 33 643-33-50" with code 375 has to be typed as
 * "336433350", not "375336433350".
 */
function stripCountryCode(phone: string, callingCode: string): string {
  const digits = phone.replace(/\D/gu, '');
  if (callingCode && digits.startsWith(callingCode) && digits.length > callingCode.length) {
    return digits.slice(callingCode.length);
  }
  return digits;
}

@Injectable()
export class ViberAuthService {
  private readonly logger = new Logger(ViberAuthService.name);

  private getTopDump(adb: any): string {
    return adb.shell('dumpsys activity top', { allowFailure: true }) ?? '';
  }

  /**
   * Drives Viber from its welcome splash to a submitted phone number.
   *
   * Runs through Appium rather than `adb input tap`: the screen scrolls under
   * the soft keyboard, so the same button sits at different coordinates
   * depending on the keyboard state, and `adb shell uiautomator dump` is
   * broken on the emulator image (`null root node`), leaving blind taps with
   * no way to check that a step landed.
   */
  async enterPhoneNumber(dto: LoginPhoneDto): Promise<AuthResponseDto> {
    const defaultPhone = process.env['VIBER_DEFAULT_PHONE']?.trim() ?? '';
    const defaultCountry = process.env['VIBER_DEFAULT_COUNTRY']?.trim() ?? '';

    const phoneNumber = dto.phoneNumber?.trim() || defaultPhone;
    const country = dto.countryName?.trim() || defaultCountry;

    if (!phoneNumber) {
      return {
        success: false,
        message:
          'Номер телефона не указан в запросе и не задан в переменной окружения VIBER_DEFAULT_PHONE',
        step: 'ERROR',
      };
    }

    try {
      return await withViberSession(async (driver) => {
        const page = new RegistrationPage(driver);

        if (await page.isActivated(3_000)) {
          return {
            success: true,
            message: 'Viber уже авторизован — экран списка чатов активен.',
            step: 'AUTHORIZED' as const,
          };
        }

        await page.dismissSplash();

        if (country) {
          this.logger.log(`Selecting country "${country}"...`);
          await page.chooseCountry(country);
        }

        const nationalNumber = stripCountryCode(phoneNumber, await page.countryCode());
        this.logger.log(`Entering number ${nationalNumber} (+${await page.countryCode()})...`);
        await page.enterPhone(nationalNumber);
        await page.submitPhone();

        if (await page.acceptPermissionRationale()) {
          this.logger.log('Accepted the contacts/call-log explanation.');
        }
        const granted = await page.allowSystemPermissions();
        for (const permission of granted) {
          this.logger.log(`Granted system permission: ${permission}`);
        }

        const screen = await page.awaitVerificationOutcome();
        this.logger.log(`Number submitted; Viber is now on "${screen}".`);

        return {
          success: true,
          message:
            `Номер ${phoneNumber} отправлен (страна: ${await page.selectedCountry()}). ` +
            'Запросите звонок или SMS и введите код активации.',
          step: 'WAITING_FOR_CODE' as const,
        };
      });
    } catch (error) {
      if (error instanceof ActivationRejectedError) {
        this.logger.warn(`Viber refused the number: ${error.message}`);
        return {
          success: false,
          message: `Viber отклонил активацию — ${error.message}`,
          step: 'ERROR',
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error entering phone number: ${message}`);
      return { success: false, message: `Ошибка ввода номера: ${message}`, step: 'ERROR' };
    }
  }

  async enterCode(dto: ConfirmCodeDto): Promise<AuthResponseDto> {
    try {
      this.logger.log(`Entering activation digits: ${dto.code}`);
      const { adb } = await openDevice({ ensureUp: false });

      const digits = dto.code.replace(/\D/g, '');
      if (digits.length === 0) {
        throw new Error('Код активации должен содержать цифры');
      }

      for (const char of digits) {
        adb.shell(`input text ${char}`);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      adb.shell('input keyevent 66');

      this.logger.log('Waiting for code validation and Profile screen...');
      await new Promise((resolve) => setTimeout(resolve, 3500));

      // Profile screen: continueButtonView bounds [249,310][305,366] -> center (277, 338)
      const dump = this.getTopDump(adb);
      if (dump.includes('continueButtonView') || dump.includes('nameInputHolder') || dump.includes('userNameTextInput')) {
        this.logger.log('Detected Profile screen, clicking continueButtonView at (277, 338)...');
        adb.shell('input tap 277 338');
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      // The activation and profile screens have not been captured yet, so this
      // step still types blind — but it must not report success on faith.
      const authorized = await this.isConversationListUp();
      return authorized
        ? {
            success: true,
            message: 'Код принят, Viber открыл список чатов.',
            step: 'AUTHORIZED',
          }
        : {
            success: false,
            message:
              'Цифры введены, но список чатов не открылся. Экраны активации и профиля ещё ' +
              'не сняты — снимите их рекордером (record-auth.mjs) и допишите RegistrationPage.',
            step: 'WAITING_FOR_CODE',
          };
    } catch (error) {
      this.logger.error(`Error entering verification code: ${String(error)}`);
      return {
        success: false,
        message: `Ошибка ввода кода: ${String(error)}`,
        step: 'ERROR',
      };
    }
  }

  /** Cheap post-condition: activation is only done once the chat list is up. */
  private async isConversationListUp(): Promise<boolean> {
    try {
      return await withViberSession(async (driver) =>
        new RegistrationPage(driver).isActivated(8_000),
      );
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<AuthStatusDto> {
    try {
      const { adb, db } = await openDevice({ ensureUp: false });

      const pidOutput = adb.shell('pidof com.viber.voip', { allowFailure: true }).trim();
      const isAppRunning = Boolean(pidOutput && pidOutput.length > 0);

      let isAuthorized = false;
      try {
        const count = db.count(
          "SELECT COUNT(*) FROM participants_info WHERE participant_type = 0",
        );
        isAuthorized = count > 0;
      } catch {
        isAuthorized = false;
      }

      return {
        isAppRunning,
        isAuthorized,
        step: isAuthorized ? 'AUTHORIZED' : isAppRunning ? 'PHONE_INPUT' : 'UNKNOWN',
      };
    } catch (error) {
      this.logger.warn(`Could not determine auth status: ${String(error)}`);
      return {
        isAppRunning: false,
        isAuthorized: false,
        step: 'UNKNOWN',
      };
    }
  }
}
