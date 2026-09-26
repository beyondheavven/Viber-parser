import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module.js';
import { ViberModule } from '../../viber/viber.module.js';
import { FridaStreamService } from './frida-stream.service.js';
import { OnlineStatusService } from './online-status.service.js';
import { ParticipantSyncService } from './participant-sync.service.js';
import { ParticipantsCollectorFlow } from './participants-collector.flow.js';
import { ParticipantsController } from './participants.controller.js';

@Module({
  imports: [ViberModule, TasksModule],
  controllers: [ParticipantsController],
  providers: [
    FridaStreamService,
    OnlineStatusService,
    ParticipantSyncService,
    ParticipantsCollectorFlow,
  ],
  exports: [ParticipantsCollectorFlow],
})
export class ParticipantsModule {}
