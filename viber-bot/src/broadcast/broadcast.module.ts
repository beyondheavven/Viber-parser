import { Module } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module.js';
import { CommonModule } from '../common/common.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { BroadcastController } from './broadcast.controller.js';
import { BroadcastService } from './broadcast.service.js';

@Module({
  imports: [CommonModule, AutomationModule, GroupsModule],
  controllers: [BroadcastController],
  providers: [BroadcastService],
  exports: [BroadcastService],
})
export class BroadcastModule {}
