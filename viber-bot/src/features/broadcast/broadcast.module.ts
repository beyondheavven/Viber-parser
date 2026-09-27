import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module.js';
import { ViberModule } from '../../viber/viber.module.js';
import { BroadcastController } from './broadcast.controller.js';
import { BroadcastService } from './broadcast.service.js';

@Module({
  imports: [ViberModule, GroupsModule],
  controllers: [BroadcastController],
  providers: [BroadcastService],
  exports: [BroadcastService],
})
export class BroadcastModule {}
