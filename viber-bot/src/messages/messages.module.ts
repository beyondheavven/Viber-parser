import { Module } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module.js';
import { MessagesController } from './messages.controller.js';
import { MessagesMonitorService } from './messages-monitor.service.js';

@Module({
  imports: [AutomationModule],
  controllers: [MessagesController],
  providers: [MessagesMonitorService],
  exports: [MessagesMonitorService],
})
export class MessagesModule {}
