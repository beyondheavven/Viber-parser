import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GroupParticipantSampleDto {
  @ApiProperty({ type: Number, example: 1 })
  id!: number;

  @ApiPropertyOptional({ type: String, example: 'Milena' })
  name!: string | null;

  @ApiPropertyOptional({ type: String, example: '+48794034881' })
  number!: string | null;

  @ApiProperty({ type: String, example: 'superadmin' })
  roleLabel!: string;
}

export class GroupSummaryDto {
  @ApiProperty({ type: Number, description: 'ID беседы (row ID)', example: 26 })
  id!: number;

  @ApiProperty({ type: Number, description: 'Тип беседы (0: 1-to-1, 1: группа, 2: сообщество, 3: рассылка)', example: 2 })
  type!: number;

  @ApiPropertyOptional({ type: String, description: '64-битный ID группы в Viber', example: '5907779393516782372' })
  groupId?: string | null;

  @ApiPropertyOptional({ type: String, description: 'Название группы/чата', example: 'АVTOTRAL🚨' })
  name?: string | null;

  @ApiProperty({ type: Number, description: 'Количество сообщений в чате', example: 1542 })
  messageCount!: number;

  @ApiProperty({ type: Number, description: 'Количество участников в чате', example: 1632 })
  participantCount!: number;

  @ApiProperty({ type: Number, description: 'Количество непрочитанных сообщений', example: 0 })
  unreadCount!: number;

  @ApiPropertyOptional({ type: String, description: 'Дата последнего сообщения (ISO 8601)', example: '2026-09-05T14:40:00.000Z' })
  lastMessageDate?: string | null;
}

export class GroupDetailDto extends GroupSummaryDto {
  @ApiPropertyOptional({ type: () => [GroupParticipantSampleDto], description: 'Список активных участников группы (краткая выгрузка)' })
  sampleParticipants?: GroupParticipantSampleDto[];
}
