import { Module } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module.js';
import { MessagesMonitorService } from './messages-monitor.service.js';

@Module({
  imports: [AutomationModule],
  providers: [MessagesMonitorService],
  exports: [MessagesMonitorService],
})
export class MessagesModule {}
