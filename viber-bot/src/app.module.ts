import { Module } from '@nestjs/common';
import { TasksModule } from './features/tasks/tasks.module.js';
import { ParticipantsModule } from './features/participants/participants.module.js';
import { GroupsModule } from './features/groups/groups.module.js';
import { DatabaseModule } from './features/database/database.module.js';
import { MessagesModule } from './features/messages/messages.module.js';
import { RabbitMqModule } from './rabbitmq/rabbitmq.module.js';
import { AuthModule } from './features/auth/auth.module.js';
import { BroadcastModule } from './features/broadcast/broadcast.module.js';
import { PlatformModule } from './platform/platform.module.js';

@Module({
  imports: [
    RabbitMqModule,
    PlatformModule,
    AuthModule,
    TasksModule,
    ParticipantsModule,
    GroupsModule,
    DatabaseModule,
    MessagesModule,
    BroadcastModule,
  ],
})
export class AppModule {}
