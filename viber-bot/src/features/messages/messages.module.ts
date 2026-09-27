import { Module } from '@nestjs/common';
import { MessageWatchService } from './message-watch.service.js';
import { MessagesController } from './messages.controller.js';
import { MessagesMonitorService } from './messages-monitor.service.js';

@Module({
  controllers: [MessagesController],
  providers: [MessageWatchService, MessagesMonitorService],
  exports: [MessagesMonitorService],
})
export class MessagesModule {}
