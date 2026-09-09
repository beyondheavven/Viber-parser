import { Module } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { ParticipantsCollectorFlow } from './participants-collector.flow.js';

@Module({
  imports: [AutomationModule, TasksModule],
  providers: [ParticipantsCollectorFlow],
  exports: [ParticipantsCollectorFlow],
})
export class ParticipantsModule {}
