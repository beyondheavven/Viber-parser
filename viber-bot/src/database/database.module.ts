import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { AutomationModule } from '../automation/automation.module.js';
import { CommonModule } from '../common/common.module.js';

@Module({
  imports: [AutomationModule, CommonModule],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
