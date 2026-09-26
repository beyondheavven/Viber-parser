import { Module } from '@nestjs/common';
import { ViberNavigationService } from './navigation.js';

@Module({
  providers: [ViberNavigationService],
  exports: [ViberNavigationService],
})
export class ViberModule {}
