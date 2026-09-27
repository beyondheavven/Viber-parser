import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { DatabaseController } from './database.controller.js';

@Module({
  controllers: [DatabaseController],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
