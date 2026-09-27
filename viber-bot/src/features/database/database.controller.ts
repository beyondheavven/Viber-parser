import { Controller, Inject } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { DatabaseService } from './database.service.js';
import type { DatabaseStatsDto, SyncResultDto } from './dto/database-stats.dto.js';
import type { DecodeRequestDto, DecodeResultDto } from './dto/decode.dto.js';

@Controller()
export class DatabaseController {
  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  @MessagePattern('viber.database.sync')
  async syncDatabase(): Promise<SyncResultDto> {
    return this.databaseService.syncLiveDatabase();
  }

  @MessagePattern('viber.database.stats')
  async getStats(): Promise<DatabaseStatsDto> {
    return this.databaseService.getDatabaseStats();
  }

  @MessagePattern('viber.database.decode')
  async decodeParticipants(@Payload() dto: DecodeRequestDto = {}): Promise<DecodeResultDto> {
    return this.databaseService.decodeParticipants(dto ?? {});
  }
}
