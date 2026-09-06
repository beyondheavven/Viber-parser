import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module.js';
import { AutomationModule } from './automation/automation.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { ParticipantsModule } from './participants/participants.module.js';
import { GroupsModule } from './groups/groups.module.js';
import { DatabaseModule } from './database/database.module.js';
import { MessagesModule } from './messages/messages.module.js';

@Module({
  imports: [
    CommonModule,
    AutomationModule,
    TasksModule,
    ParticipantsModule,
    GroupsModule,
    DatabaseModule,
    MessagesModule,
  ],
})
export class AppModule {}
