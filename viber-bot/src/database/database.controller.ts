import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { DatabaseStatsDto, SyncResultDto } from './dto/database-stats.dto.js';
import { DecodeRequestDto, DecodeResultDto } from './dto/decode.dto.js';

@Controller('api/database')
export class DatabaseController {
  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async syncDatabase(): Promise<SyncResultDto> {
    return this.databaseService.syncLiveDatabase();
  }

  @Get('stats')
  async getStats(): Promise<DatabaseStatsDto> {
    return this.databaseService.getDatabaseStats();
  }

  @Post('decode')
  @HttpCode(HttpStatus.OK)
  async decodeParticipants(@Body() dto: DecodeRequestDto): Promise<DecodeResultDto> {
    return this.databaseService.decodeParticipants(dto);
  }
}
