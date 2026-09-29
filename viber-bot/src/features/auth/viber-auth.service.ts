import { Injectable, Logger } from '@nestjs/common';
import { loadViberConfig } from '../../config/env.js';
import { openDevice } from '../../platform/context.js';
import { withViberSession } from '../../platform/appium/session.js';
import { ActivationRejectedError } from '../../viber/pages/errors.js';
import { RegistrationPage } from '../../viber/pages/registration.page.js';
import { grantAppPermissions } from './permissions.js';
import { maskPhone, splitPhoneNumber } from './qr/phone-number.js';
import { callCodeMessage } from './verification.js';
import type {
  AuthResponseDto,
  AuthStatusDto,
  ConfirmCodeDto,
  LoginPhoneDto,
} from './dto/auth.dto.js';


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

  /**
   * Grants Viber its runtime permissions over root adb, so the activation flow
   * meets no "Allow" dialogs. Never decides the outcome of the flow.
   */
  private async grantPermissions(): Promise<void> {
    try {
      const { adb } = await openDevice({ ensureUp: false });
      const granted = grantAppPermissions(adb, loadViberConfig().appPackage);
      if (granted.length > 0) {
        this.logger.log(`Pre-granted ${String(granted.length)} Viber permissions.`);
      }
    } catch (error) {
      this.logger.warn(`Could not pre-grant Viber permissions: ${String(error)}`);
    }
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
    // A number in international form names its own country: +48… is Poland
    // whatever VIBER_DEFAULT_COUNTRY says. The default only fills in for a
    // bare local number.
    const parts = splitPhoneNumber(phoneNumber, dto.countryCode);
    const country = dto.countryName?.trim() || (parts.countryCode ? '' : defaultCountry);

    if (!phoneNumber) {
      return {
        success: false,
        message:
          'Номер телефона не указан в запросе и не задан в переменной окружения VIBER_DEFAULT_PHONE',
        step: 'ERROR',
      };
    }

    try {
      if (dto.clearData === true) {
        this.logger.log('Clearing Viber data before the phone login...');
        const { adb } = await openDevice({ ensureUp: false });
        adb.shell(`pm clear ${loadViberConfig().appPackage}`, { allowFailure: true });
      }
      // After the wipe: `pm clear` takes the runtime permissions with the data.
      await this.grantPermissions();

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
        } else if (parts.countryCode) {
          this.logger.log(`Setting calling code +${parts.countryCode}...`);
          await page.setCallingCode(parts.countryCode);
        }

        const nationalNumber = stripCountryCode(phoneNumber, await page.countryCode());
        this.logger.log(`Entering number ${maskPhone(nationalNumber)} (+${await page.countryCode()})...`);
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

        const call =
          dto.requestCall === false ? { requested: false, codeLength: null } : await page.requestCall();
        if (call.requested) {
          this.logger.log('Requested the verification call («Call me»).');
          return {
            success: true,
            message: callCodeMessage(call.codeLength),
            step: 'WAITING_FOR_CODE' as const,
            verification: 'call' as const,
            codeLength: call.codeLength,
          };
        }
        if (dto.requestCall !== false) {
          this.logger.warn(`«Call me» never showed up: ${await page.describeScreen().catch(() => '?')}`);
        }

        return {
          success: true,
          message:
            `Номер ${maskPhone(phoneNumber)} отправлен (страна: ${await page.selectedCountry().catch(() => '?')}). ` +
            'Введите код из SMS или запросите звонок на экране устройства.',
          step: 'WAITING_FOR_CODE' as const,
          verification: 'sms' as const,
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

  /** Presses «Call me» again, for when the first call was missed. */
  async requestCall(): Promise<AuthResponseDto> {
    try {
      return await withViberSession(async (driver) => {
        const call = await new RegistrationPage(driver).requestCall(5_000);
        return call.requested
          ? {
              success: true,
              message: callCodeMessage(call.codeLength),
              step: 'WAITING_FOR_CODE' as const,
              verification: 'call' as const,
              codeLength: call.codeLength,
            }
          : {
              success: false,
              message:
                'Кнопка «Позвонить мне» сейчас недоступна. Дождитесь окончания таймера Viber и повторите.',
              step: 'WAITING_FOR_CODE' as const,
            };
      });
    } catch (error) {
      this.logger.error(`Error requesting the verification call: ${String(error)}`);
      return { success: false, message: `Ошибка запроса звонка: ${String(error)}`, step: 'ERROR' };
    }
  }

  async enterCode(dto: ConfirmCodeDto): Promise<AuthResponseDto> {
    try {
      const digits = dto.code.replace(/\D/g, '');
      if (digits.length === 0) {
        throw new Error('Код активации должен содержать цифры');
      }
      this.logger.log(`Entering ${String(digits.length)} activation digits...`);
      await this.grantPermissions();
      const { adb } = await openDevice({ ensureUp: false });

      // Digits go in over adb, so the field has to hold focus first.
      const focused = await withViberSession((driver) =>
        new RegistrationPage(driver).focusCodeInput(),
      ).catch((error: unknown) => {
        this.logger.warn(`Could not focus the code field: ${String(error)}`);
        return false;
      });
      if (!focused) this.logger.warn('Code field not found; typing into the focused view.');

      for (const char of digits) {
        adb.shell(`input text ${char}`);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      adb.shell('input keyevent 66');

      this.logger.log('Waiting for code validation and Profile screen...');

      // The activation screen itself has not been captured yet, so the digits
      // are typed blind — but what follows is checked on screen, never on faith.
      const authorized = await withViberSession(async (driver) => {
        const page = new RegistrationPage(driver);
        const userName = dto.userName?.trim() || undefined;
        if (await page.completeProfile(userName)) {
          this.logger.log(
            userName === undefined
              ? 'Profile screen detected, skipped with its Continue button.'
              : 'Profile screen detected, name filled in and continued.',
          );
        }
        return page.isActivated(15_000);
      }).catch((error: unknown) => {
        this.logger.warn(`Could not inspect the screen after the code: ${String(error)}`);
        return false;
      });
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
