import { Global, Module } from '@nestjs/common';
import { DeviceMutexService } from './mutex/device-mutex.service.js';
import { ViberLifecycleService } from './viber-lifecycle.service.js';

@Global()
@Module({
  providers: [DeviceMutexService, ViberLifecycleService],
  exports: [DeviceMutexService, ViberLifecycleService],
})
export class PlatformModule {}
