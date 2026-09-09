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

  async enterPhoneNumber(dto: LoginPhoneDto): Promise<AuthResponseDto> {
    try {
      this.logger.log(`Entering phone number: ${dto.phoneNumber}, country: ${dto.countryName || dto.countryCode || 'auto'}`);
      const { adb } = await openDevice({ ensureUp: false });

      adb.shell('am start -n com.viber.voip/com.viber.voip.WelcomeActivity', {
        allowFailure: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // If user provided a country name (or code like Belarus/BY), select it from the country dropdown
      const countryQuery = dto.countryName || dto.countryCode;
      if (countryQuery) {
        await this.selectCountry(adb, countryQuery);
      }

      // Find and click phone number input field, then type phone number
      await this.typePhoneNumber(adb, dto.phoneNumber);

      // Submit phone number (Enter / Continue button)
      adb.shell('input keyevent 66');
      await this.clickContinueButton(adb);

      // Wait for "You're almost there..." activation screen with "Call me" button
      await new Promise((resolve) => setTimeout(resolve, 3500));

      const clicked = await this.clickCallMeButton(adb);
      if (clicked) {
        this.logger.log('Successfully tapped "Call me" button.');
      } else {
        this.logger.warn('Could not detect "Call me" button directly, tapped by default screen ratio');
      }

      return {
        success: true,
        message: 'Страна выбрана, номер введен, запрос на звонок отправлен. Введите последние 4 цифры входящего номера.',
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
      this.logger.log(`Attempting to select country: ${countryName}`);
      adb.shell('uiautomator dump /sdcard/country_screen.xml', { allowFailure: true });
      const dump = adb.shell('cat /sdcard/country_screen.xml', { allowFailure: true });

      // Look for country picker button or spinner
      // Common IDs in Viber: country_picker, select_country, country_code
      const pickerMatch = dump.match(/resource-id="[^"]*country[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i) ||
                          dump.match(/text="[^"]*(?:Country|Select country|Страна)[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i);

      if (pickerMatch) {
        const cx = Math.round((parseInt(pickerMatch[1], 10) + parseInt(pickerMatch[3], 10)) / 2);
        const cy = Math.round((parseInt(pickerMatch[2], 10) + parseInt(pickerMatch[4], 10)) / 2);
        adb.shell(`input tap ${cx} ${cy}`);
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // In search box or list, search for the country
        adb.shell(`input text "${countryName}"`);
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Dump search results
        adb.shell('uiautomator dump /sdcard/country_list.xml', { allowFailure: true });
        const listDump = adb.shell('cat /sdcard/country_list.xml', { allowFailure: true });

        // Match first item containing the country query
        const escapedCountry = countryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const itemMatch = listDump.match(new RegExp(`text="[^"]*${escapedCountry}[^"]*"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`, 'i'));
        if (itemMatch) {
          const ix = Math.round((parseInt(itemMatch[1], 10) + parseInt(itemMatch[3], 10)) / 2);
          const iy = Math.round((parseInt(itemMatch[2], 10) + parseInt(itemMatch[4], 10)) / 2);
          adb.shell(`input tap ${ix} ${iy}`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          this.logger.log(`Selected country "${countryName}" from list.`);
          return true;
        } else {
          // Tap first item in list or press enter
          adb.shell('input keyevent 66');
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    } catch (err) {
      this.logger.warn(`Could not automatically select country: ${String(err)}`);
    }
    return false;
  }

  private async typePhoneNumber(adb: any, phoneNumber: string): Promise<void> {
    try {
      adb.shell('uiautomator dump /sdcard/phone_input.xml', { allowFailure: true });
      const dump = adb.shell('cat /sdcard/phone_input.xml', { allowFailure: true });

      const inputMatch = dump.match(/resource-id="[^"]*(?:phone|number|edit)[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i) ||
                         dump.match(/class="android.widget.EditText"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i);
      if (inputMatch) {
        const cx = Math.round((parseInt(inputMatch[1], 10) + parseInt(inputMatch[3], 10)) / 2);
        const cy = Math.round((parseInt(inputMatch[2], 10) + parseInt(inputMatch[4], 10)) / 2);
        adb.shell(`input tap ${cx} ${cy}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch {
      // ignore
    }

    const cleanNumber = phoneNumber.replace(/\D/g, '');
    adb.shell(`input text ${cleanNumber}`);
  }

  private async clickContinueButton(adb: any): Promise<void> {
    try {
      adb.shell('uiautomator dump /sdcard/continue_btn.xml', { allowFailure: true });
      const dump = adb.shell('cat /sdcard/continue_btn.xml', { allowFailure: true });

      const btnMatch = dump.match(/text="[^"]*(?:Continue|Далее|Продолжить|OK)[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i);
      if (btnMatch) {
        const bx = Math.round((parseInt(btnMatch[1], 10) + parseInt(btnMatch[3], 10)) / 2);
        const by = Math.round((parseInt(btnMatch[2], 10) + parseInt(btnMatch[4], 10)) / 2);
        adb.shell(`input tap ${bx} ${by}`);
      }
    } catch {
      // ignore
    }
  }

  async enterCode(dto: ConfirmCodeDto): Promise<AuthResponseDto> {
    try {
      this.logger.log(`Entering activation digits/code: ${dto.code}`);
      const { adb } = await openDevice({ ensureUp: false });
      const digits = dto.code.replace(/\D/g, '');
      for (const char of digits) {
        adb.shell(`input text ${char}`);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      adb.shell('input keyevent 66');

      return {
        success: true,
        message: 'Код подтверждения (4 цифры) отправлен в Viber',
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

  private async clickCallMeButton(adb: any): Promise<boolean> {
    try {
      adb.shell('uiautomator dump /sdcard/window_dump.xml', { allowFailure: true });
      const dump = adb.shell('cat /sdcard/window_dump.xml', { allowFailure: true });

      const match = dump.match(/text="[^"]*[Cc]all [Mm]e[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
      if (match) {
        const x1 = parseInt(match[1], 10);
        const y1 = parseInt(match[2], 10);
        const x2 = parseInt(match[3], 10);
        const y2 = parseInt(match[4], 10);
        const centerX = Math.round((x1 + x2) / 2);
        const centerY = Math.round((y1 + y2) / 2);
        this.logger.log(`Found "Call me" bounds: [${x1},${y1}][${x2},${y2}] -> clicking (${centerX}, ${centerY})`);
        adb.shell(`input tap ${centerX} ${centerY}`);
        return true;
      }

      const wmSize = adb.shell('wm size', { allowFailure: true });
      const sizeMatch = wmSize.match(/(\d+)x(\d+)/);
      if (sizeMatch) {
        const width = parseInt(sizeMatch[1], 10);
        const height = parseInt(sizeMatch[2], 10);
        const tapX = Math.round(width / 2);
        const tapY = Math.round(height * 0.76);
        this.logger.log(`Tapping "Call me" fallback position: (${tapX}, ${tapY})`);
        adb.shell(`input tap ${tapX} ${tapY}`);
        return true;
      }
    } catch (e) {
      this.logger.warn(`Failed to auto-click "Call me": ${String(e)}`);
    }
    return false;
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
