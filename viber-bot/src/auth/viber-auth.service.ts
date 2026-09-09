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
      this.logger.log(`Entering phone number: ${dto.phoneNumber}`);
      const { adb } = await openDevice({ ensureUp: false });

      adb.shell('am start -n com.viber.voip/com.viber.voip.WelcomeActivity', {
        allowFailure: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 1500));

      adb.shell(`input text ${dto.phoneNumber}`);
      adb.shell('input keyevent 66');

      return {
        success: true,
        message: 'Номер телефона успешно передан в Viber',
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

  async enterCode(dto: ConfirmCodeDto): Promise<AuthResponseDto> {
    try {
      this.logger.log(`Entering SMS confirmation code: ${dto.code}`);
      const { adb } = await openDevice({ ensureUp: false });

      adb.shell(`input text ${dto.code}`);
      adb.shell('input keyevent 66');

      return {
        success: true,
        message: 'Код подтверждения отправлен в Viber',
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
