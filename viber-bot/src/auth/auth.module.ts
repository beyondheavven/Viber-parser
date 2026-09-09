import { Module } from '@nestjs/common';
import { ViberAuthService } from './viber-auth.service.js';
import { AuthController } from './auth.controller.js';

@Module({
  controllers: [AuthController],
  providers: [ViberAuthService],
  exports: [ViberAuthService],
})
export class AuthModule {}
