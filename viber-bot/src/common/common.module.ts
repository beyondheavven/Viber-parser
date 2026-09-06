import { Global, Module } from '@nestjs/common';
import { DeviceMutexService } from './mutex/device-mutex.service.js';

@Global()
@Module({
  providers: [DeviceMutexService],
  exports: [DeviceMutexService],
})
export class CommonModule {}
