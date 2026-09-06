import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from './database.service.js';
import { DatabaseStatsDto, SyncResultDto } from './dto/database-stats.dto.js';
import { DecodeRequestDto, DecodeResultDto } from './dto/decode.dto.js';

@ApiTags('database')
@Controller('api/database')
export class DatabaseController {
  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Синхронизировать локальный снимок SQLite с боевой базой данных эмулятора' })
  @ApiResponse({ status: 200, type: SyncResultDto })
  async syncDatabase(): Promise<SyncResultDto> {
    return this.databaseService.syncLiveDatabase();
  }

  @Get('stats')
  @ApiOperation({ summary: 'Получить статистику базы данных Viber (количество чатов, сообщений, участников)' })
  @ApiResponse({ status: 200, type: DatabaseStatsDto })
  async getStats(): Promise<DatabaseStatsDto> {
    return this.databaseService.getDatabaseStats();
  }

  @Post('decode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Дешифровать все недешифрованные записи участников (em:... -> decoded member_id) в боевой БД' })
  @ApiResponse({ status: 200, type: DecodeResultDto })
  async decodeParticipants(@Body() dto: DecodeRequestDto): Promise<DecodeResultDto> {
    return this.databaseService.decodeParticipants(dto);
  }
}
