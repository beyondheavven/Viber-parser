import { Controller, Inject } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ViberAuthService } from './viber-auth.service.js';
import { ViberQrService } from './viber-qr.service.js';
import type {
  AuthResponseDto,
  AuthStatusDto,
  ConfirmCodeDto,
  LoginPhoneDto,
} from './dto/auth.dto.js';
import type { QrStartDto, QrStartResponseDto, QrStatusDto } from './dto/qr-auth.dto.js';

@Controller()
export class AuthController {
  constructor(
    @Inject(ViberAuthService) private readonly authService: ViberAuthService,
    @Inject(ViberQrService) private readonly qrService: ViberQrService,
  ) {}

  @MessagePattern('viber.auth.phone')
  async enterPhoneNumber(@Payload() dto: LoginPhoneDto): Promise<AuthResponseDto> {
    return this.authService.enterPhoneNumber(dto);
  }

  @MessagePattern('viber.auth.call')
  async requestCall(): Promise<AuthResponseDto> {
    return this.authService.requestCall();
  }

  @MessagePattern('viber.auth.code')
  async enterCode(@Payload() dto: ConfirmCodeDto): Promise<AuthResponseDto> {
    return this.authService.enterCode(dto);
  }

  @MessagePattern('viber.auth.status')
  async getStatus(): Promise<AuthStatusDto> {
    return this.authService.getStatus();
  }

  @MessagePattern('viber.auth.qr.start')
  startQr(@Payload() dto: QrStartDto | null): QrStartResponseDto {
    return this.qrService.start(dto ?? {});
  }

  @MessagePattern('viber.auth.qr.status')
  getQrStatus(): QrStatusDto {
    return this.qrService.getStatus();
  }

  @MessagePattern('viber.auth.qr.cancel')
  async cancelQr(): Promise<QrStartResponseDto> {
    return this.qrService.cancel();
  }
}
