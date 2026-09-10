import { Injectable, Logger } from '@nestjs/common';
import { openDevice } from '../context.js';
import type {
  AuthResponseDto,
  AuthStatusDto,
  ConfirmCodeDto,
  LoginPhoneDto,
} from './dto/auth.dto.js';

@Injectable()
export class ViberAuthService {
  private readonly logger = new Logger(ViberAuthService.name);

  private getTopDump(adb: any): string {
    return adb.shell('dumpsys activity top', { allowFailure: true }) ?? '';
  }

  async enterPhoneNumber(dto: LoginPhoneDto): Promise<AuthResponseDto> {
    try {
      const defaultPhone = process.env['VIBER_DEFAULT_PHONE']?.trim() ?? '';
      const defaultCountry = process.env['VIBER_DEFAULT_COUNTRY']?.trim() ?? '';

      const phoneNumber = (dto.phoneNumber && dto.phoneNumber.trim().length > 0)
        ? dto.phoneNumber.trim()
        : defaultPhone;

      const countryQuery = (dto.countryName && dto.countryName.trim().length > 0)
        ? dto.countryName.trim()
        : (dto.countryCode && dto.countryCode.trim().length > 0)
          ? dto.countryCode.trim()
          : defaultCountry;

      if (!phoneNumber) {
        throw new Error('Номер телефона не указан в запросе и не задан в переменной окружения VIBER_DEFAULT_PHONE');
      }

      this.logger.log(`Starting auth flow for phone: ${phoneNumber}, country: ${countryQuery || 'auto'}`);
      const { adb } = await openDevice({ ensureUp: false });

      // 1. Wake up device & dismiss lockscreen
      adb.shell('input keyevent 224', { allowFailure: true });
      adb.shell('wm dismiss-keyguard', { allowFailure: true });
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 2. Start WelcomeActivity / Splash
      adb.shell('am start -n com.viber.voip/com.viber.voip.WelcomeActivity', {
        allowFailure: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 3. Handle "Start now" button on SplashActivity
      let topDump = this.getTopDump(adb);
      if (topDump.includes('SplashActivity') || topDump.includes('okBtn') || topDump.includes('Start now')) {
        this.logger.log('Detected Welcome splash screen ("Start now"), clicking okBtn at (160, 558)...');
        adb.shell('input tap 160 558');
        await new Promise((resolve) => setTimeout(resolve, 2500));
        topDump = this.getTopDump(adb);
      }

      // 4. Select country from list if needed
      if (countryQuery) {
        await this.selectCountry(adb, countryQuery);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      // 5. Enter phone number
      await this.typePhoneNumber(adb, phoneNumber, countryQuery);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // 6. Close soft keyboard to reveal Continue button
      adb.shell('input keyevent 4', { allowFailure: true });
      await new Promise((resolve) => setTimeout(resolve, 600));

      // 7. Click Continue button (btn_continue at 160, 401)
      await this.clickContinueButton(adb);
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 8. Permission explanation modal dialog ("Viber will ask you for permission...")
      // Button: continue_btn bounds [209,445][273,467] -> (241, 456)
      await this.handlePermissionExplanationDialog(adb);
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // 9. Android System permission dialogs ("ALLOW" at 160, 369)
      await this.handleSystemPermissionDialogs(adb);
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 10. Activation screen: click "Call me" button (call_me_button at 161, 539)
      const clickedCall = await this.clickCallMeButton(adb);
      if (clickedCall) {
        this.logger.log('Successfully requested verification call ("Call me").');
      }

      return {
        success: true,
        message: `Страна "${countryQuery}" выбрана, номер ${phoneNumber} введен, запрос на звонок отправлен. Введите последние 4 цифры номера входящего звонка.`,
        step: 'WAITING_FOR_CODE',
      };
    } catch (error) {
      this.logger.error(`Error entering phone number: ${String(error)}`);
      return {
        success: false,
        message: `Ошибка ввода номера: ${String(error)}`,
        step: 'ERROR',
      };
    }
  }

  private async selectCountry(adb: any, countryName: string): Promise<boolean> {
    try {
      this.logger.log(`Selecting country "${countryName}" from dropdown...`);
      // registration_country_btn bounds [24,250][296,289] -> center (160, 270)
      adb.shell('input tap 160 270');
      await new Promise((resolve) => setTimeout(resolve, 1500));

      let dump = this.getTopDump(adb);
      if (!dump.includes('SelectCountryActivity')) {
        adb.shell('input tap 200 270');
        await new Promise((resolve) => setTimeout(resolve, 1500));
        dump = this.getTopDump(adb);
      }

      if (dump.includes('SelectCountryActivity')) {
        // Search input at (188, 52)
        adb.shell('input tap 188 52');
        await new Promise((resolve) => setTimeout(resolve, 500));

        adb.shell(`input text "${countryName}"`);
        await new Promise((resolve) => setTimeout(resolve, 1200));

        // First item in list at (160, 109)
        adb.shell('input tap 160 109');
        await new Promise((resolve) => setTimeout(resolve, 1500));
        this.logger.log(`Country "${countryName}" chosen from search list.`);
        return true;
      }
    } catch (err) {
      this.logger.warn(`Could not select country: ${String(err)}`);
    }
    return false;
  }

  private async typePhoneNumber(adb: any, rawPhone: string, countryQuery?: string): Promise<void> {
    try {
      let clean = rawPhone.replace(/\D/g, '');
      if (countryQuery) {
        const cq = countryQuery.toLowerCase();
        if ((cq.includes('belarus') || cq === '375' || cq === 'by') && clean.startsWith('375') && clean.length > 9) {
          clean = clean.substring(3);
        } else if (cq.includes('russia') || cq === '7' || cq === 'ru') {
          if (clean.startsWith('7') && clean.length > 10) clean = clean.substring(1);
        } else if (cq.includes('ukraine') || cq === '380' || cq === 'ua') {
          if (clean.startsWith('380') && clean.length > 9) clean = clean.substring(3);
        }
      }

      this.logger.log(`Typing phone digits: ${clean} into phone field...`);
      // registration_phone_field bounds [111,317][296,354] -> center (203, 335)
      adb.shell('input tap 203 335');
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Clear existing input
      for (let i = 0; i < 15; i++) {
        adb.shell('input keyevent 67'); // KEYCODE_DEL
      }
      await new Promise((resolve) => setTimeout(resolve, 200));

      adb.shell(`input text "${clean}"`);
    } catch (err) {
      this.logger.warn(`Error typing phone number: ${String(err)}`);
    }
  }

  private async clickContinueButton(adb: any): Promise<void> {
    try {
      this.logger.log('Tapping Continue button (btn_continue) at (160, 401)...');
      adb.shell('input tap 160 401');
    } catch (err) {
      this.logger.warn(`Error clicking continue button: ${String(err)}`);
    }
  }

  private async handlePermissionExplanationDialog(adb: any): Promise<void> {
    try {
      const dump = this.getTopDump(adb);
      if (dump.includes('continue_btn') || dump.includes('call logs') || dump.includes('parentPanel')) {
        this.logger.log('Detected permission explanation dialog, clicking continue_btn at (241, 456)...');
        adb.shell('input tap 241 456');
      }
    } catch (err) {
      this.logger.warn(`Error in handlePermissionExplanationDialog: ${String(err)}`);
    }
  }

  private async handleSystemPermissionDialogs(adb: any): Promise<void> {
    try {
      for (let i = 0; i < 4; i++) {
        const dump = this.getTopDump(adb);
        if (dump.includes('permission_allow_button') || dump.includes('permissioncontroller') || dump.includes('ALLOW')) {
          this.logger.log(`Accepting system permission [attempt ${i + 1}] at (160, 369)...`);
          adb.shell('input tap 160 369');
          await new Promise((resolve) => setTimeout(resolve, 1200));
        } else {
          break;
        }
      }
    } catch (err) {
      this.logger.warn(`Error in handleSystemPermissionDialogs: ${String(err)}`);
    }
  }

  private async clickCallMeButton(adb: any): Promise<boolean> {
    try {
      const dump = this.getTopDump(adb);
      this.logger.log('Looking for "Call me" button on activation screen...');

      // call_me_button bounds [12,517][310,561] -> center (161, 539)
      if (dump.includes('call_me_button') || dump.includes('Call me') || dump.includes('almost there')) {
        this.logger.log('Tapping "Call me" button at (161, 539)...');
        adb.shell('input tap 161 539');
        return true;
      }

      adb.shell('input tap 161 539');
      return true;
    } catch (e) {
      this.logger.warn(`Failed to click "Call me": ${String(e)}`);
      return false;
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

      return {
        success: true,
        message: 'Код подтверждения успешно введен, экран профиля подтвержден',
        step: 'AUTHORIZED',
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
