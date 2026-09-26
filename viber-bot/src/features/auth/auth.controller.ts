import { Controller, Inject } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ViberAuthService } from './viber-auth.service.js';
import type {
  AuthResponseDto,
  AuthStatusDto,
  ConfirmCodeDto,
  LoginPhoneDto,
} from './dto/auth.dto.js';

@Controller()
export class AuthController {
  constructor(
    @Inject(ViberAuthService) private readonly authService: ViberAuthService,
  ) {}

  @MessagePattern('viber.auth.phone')
  async enterPhoneNumber(@Payload() dto: LoginPhoneDto): Promise<AuthResponseDto> {
    return this.authService.enterPhoneNumber(dto);
  }

  @MessagePattern('viber.auth.code')
  async enterCode(@Payload() dto: ConfirmCodeDto): Promise<AuthResponseDto> {
    return this.authService.enterCode(dto);
  }

  @MessagePattern('viber.auth.status')
  async getStatus(): Promise<AuthStatusDto> {
    return this.authService.getStatus();
  }
}
