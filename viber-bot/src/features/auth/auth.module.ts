import { Module } from '@nestjs/common';
import { ViberAuthService } from './viber-auth.service.js';
import { ViberQrService } from './viber-qr.service.js';
import { AuthController } from './auth.controller.js';

@Module({
  controllers: [AuthController],
  providers: [ViberAuthService, ViberQrService],
  exports: [ViberAuthService, ViberQrService],
})
export class AuthModule {}
