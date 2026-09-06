import { Module } from '@nestjs/common';
import { FridaStreamService } from './frida/frida-stream.service.js';
import { OnlineStatusService } from './frida/online-status.service.js';
import { MessageWatchService } from './frida/message-watch.service.js';
import { ViberNavigationService } from './navigation/viber-navigation.service.js';
import { ParticipantSyncService } from './database/participant-sync.service.js';
import { ViberLifecycleService } from './lifecycle/viber-lifecycle.service.js';

@Module({
  providers: [
    FridaStreamService,
    OnlineStatusService,
    MessageWatchService,
    ViberNavigationService,
    ParticipantSyncService,
    ViberLifecycleService,
  ],
  exports: [
    FridaStreamService,
    OnlineStatusService,
    MessageWatchService,
    ViberNavigationService,
    ParticipantSyncService,
    ViberLifecycleService,
  ],
})
export class AutomationModule {}
