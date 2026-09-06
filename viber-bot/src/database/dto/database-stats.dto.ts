import { ApiProperty } from '@nestjs/swagger';

export class DatabaseStatsDto {
  @ApiProperty({ type: Number, description: 'Количество чатов/бесед в базе данных', example: 29 })
  conversationsCount!: number;

  @ApiProperty({ type: Number, description: 'Количество участников в базе данных', example: 1972 })
  participantsCount!: number;

  @ApiProperty({ type: Number, description: 'Количество участников с недешифрованными member_id', example: 0 })
  undecodedParticipantsCount!: number;

  @ApiProperty({ type: Number, description: 'Всего сообщений в базе данных', example: 4520 })
  messagesCount!: number;
}

export class SyncResultDto {
  @ApiProperty({ type: Boolean, example: true })
  success!: boolean;

  @ApiProperty({ type: String, example: 'Локальный снимок базы данных успешно обновлен с эмулятора' })
  message!: string;

  @ApiProperty({ type: String, example: '2026-09-05T16:05:00.000Z' })
  timestamp!: string;

  @ApiProperty({ type: () => DatabaseStatsDto })
  stats!: DatabaseStatsDto;
}
