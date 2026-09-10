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

      // 8. Confirm dialog "Is this your phone number?" if present
      await this.confirmNumberDialog(adb);
      await new Promise((resolve) => setTimeout(resolve, 3500));

      // 9. Click "Call me" button
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
      // registration_country_btn center is around (200, 270)
      adb.shell('input tap 200 270');
      await new Promise((resolve) => setTimeout(resolve, 1500));

      let dump = this.getTopDump(adb);
      if (!dump.includes('SelectCountryActivity')) {
        // Retry click slightly adjusted
        adb.shell('input tap 160 270');
        await new Promise((resolve) => setTimeout(resolve, 1500));
        dump = this.getTopDump(adb);
      }

      if (dump.includes('SelectCountryActivity')) {
        // Tap search input at (188, 52)
        adb.shell('input tap 188 52');
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Type country name into search box
        adb.shell(`input text "${countryName}"`);
        await new Promise((resolve) => setTimeout(resolve, 1200));

        // Tap first result in list at (160, 109)
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
      // Tap phone field registration_phone_field at (203, 311)
      adb.shell('input tap 203 311');
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
      this.logger.log('Tapping Continue button at (160, 401)...');
      adb.shell('input tap 160 401');
    } catch (err) {
      this.logger.warn(`Error clicking continue button: ${String(err)}`);
    }
  }

  private async confirmNumberDialog(adb: any): Promise<void> {
    try {
      const dump = this.getTopDump(adb);
      if (dump.includes('button1') || dump.includes('AlertDialog') || dump.includes('Dialog') || dump.includes('parentPanel')) {
        this.logger.log('Detected confirmation dialog ("Is this your phone number?"), clicking positive button...');
        const btn1Match = dump.match(/android:id\/button1[^\n]*?(\d+),(\d+)-(\d+),(\d+)/);
        if (btn1Match) {
          const cx = Math.round((parseInt(btn1Match[1], 10) + parseInt(btn1Match[3], 10)) / 2);
          const cy = Math.round((parseInt(btn1Match[2], 10) + parseInt(btn1Match[4], 10)) / 2);
          adb.shell(`input tap ${cx} ${cy}`);
        } else {
          adb.shell('input tap 240 360');
        }
      }
    } catch (err) {
      this.logger.warn(`Error confirming dialog: ${String(err)}`);
    }
  }

  private async clickCallMeButton(adb: any): Promise<boolean> {
    try {
      const dump = this.getTopDump(adb);
      this.logger.log('Looking for "Call me" button on verification screen...');

      const callMatch = dump.match(/id\/[^ \n]*(?:call|phone)[^ \n]*[^\n]*?(\d+),(\d+)-(\d+),(\d+)/i) ||
                        dump.match(/(\d+),(\d+)-(\d+),(\d+)[^\n]*(?:Call|Звонок|Позвонить)/i);

      if (callMatch) {
        const cx = Math.round((parseInt(callMatch[1], 10) + parseInt(callMatch[3], 10)) / 2);
        const cy = Math.round((parseInt(callMatch[2], 10) + parseInt(callMatch[4], 10)) / 2);
        this.logger.log(`Tapping Call me button at (${cx}, ${cy})`);
        adb.shell(`input tap ${cx} ${cy}`);
        return true;
      }

      adb.shell('input tap 160 480');
      return true;
    } catch (e) {
      this.logger.warn(`Failed to auto-click "Call me": ${String(e)}`);
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
