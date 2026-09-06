import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsNumber, IsOptional } from 'class-validator';

export type PhoneSource = 'message_text' | 'viber_profile' | 'none';

export class MonitoredMessageDto {
  @ApiProperty({
    type: Number,
    description: 'Внутренний ID сообщения в базе SQLite Viber (_id в таблице messages)',
    example: 1542,
  })
  id!: number;

  @ApiProperty({
    type: Number,
    description: 'ID беседы/группы (conversation_id)',
    example: 26,
  })
  conversationId!: number;

  @ApiPropertyOptional({
    type: String,
    description: 'Название группы или имя чата',
    example: 'АVTOTRAL🚨',
  })
  conversationName!: string | null;

  @ApiPropertyOptional({
    type: String,
    description: '64-битный уникальный токен сообщения Viber',
    example: '5907779393516782372',
  })
  token!: string | null;

  @ApiProperty({
    type: String,
    description: 'Дата и время отправки сообщения (ISO 8601)',
    example: '2026-09-05T16:14:00.000Z',
  })
  date!: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Текст входящего сообщения',
    example: 'Терміново потрібен автовоз, дзвоніть 0501234567',
  })
  body!: string | null;

  @ApiPropertyOptional({
    type: Number,
    description: 'ID отправителя в таблице participants_info (null, если системное сообщение)',
    example: 42,
  })
  senderId!: number | null;

  @ApiPropertyOptional({
    type: String,
    description: 'Имя отправителя',
    example: 'Александр Иванов',
  })
  senderName!: string | null;

  @ApiPropertyOptional({
    type: String,
    description: 'Уникальный зашифрованный или декодированный member_id отправителя',
    example: '23v6N7KBqYg3s51vA==',
  })
  senderMemberId!: string | null;

  @ApiProperty({
    type: Boolean,
    description: 'Флаг, было ли сообщение отправлено самим ботом',
    example: false,
  })
  outgoing!: boolean;

  @ApiProperty({
    type: Boolean,
    description: 'Был ли номер телефона найден непосредственно в тексте сообщения',
    example: true,
  })
  hasPhoneInText!: boolean;

  @ApiPropertyOptional({
    type: String,
    description: 'Итоговый закрепленный за сообщением номер телефона в международном формате E.164 (null, если не найден)',
    example: '+380501234567',
  })
  attachedPhone!: string | null;

  @ApiProperty({
    type: String,
    description: 'Источник закрепленного номера: message_text (из текста), viber_profile (из базы Viber) или none (не найден)',
    enum: ['message_text', 'viber_profile', 'none'],
    example: 'message_text',
  })
  phoneSource!: PhoneSource;

  @ApiPropertyOptional({
    type: [String],
    description: 'Все телефонные номера, обнаруженные в тексте сообщения (если их несколько)',
    example: ['+380501234567'],
  })
  allFoundPhones?: string[] | undefined;

  @ApiProperty({
    type: Boolean,
    description: 'Сообщение содержит изображение (отдельной строкой или в extra_uri)',
    example: true,
  })
  hasMedia!: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'URI изображений, склеенных с этим текстом',
    example: ['content://com.viber.voip.provider.internal_files/pg/.../PG_MEDIA/jpg/400'],
  })
  mediaUris?: string[] | undefined;

  @ApiPropertyOptional({
    type: [Number],
    description: 'ID исходных строк SQLite, если фото и текст были склеены в одно сообщение',
    example: [197, 198],
  })
  mergedMessageIds?: number[] | undefined;
}

export class MonitoredMessagesFilterDto {
  @ApiPropertyOptional({
    type: Number,
    description: 'Фильтр по конкретной беседе (conversationId)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  conversationId?: number | undefined;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Фильтровать только сообщения, где удалось закрепить номер телефона',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  hasPhone?: boolean | undefined;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Фильтровать только сообщения с изображением',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  hasMedia?: boolean | undefined;

  @ApiPropertyOptional({
    type: String,
    description: 'Фильтр по источнику номера: message_text или viber_profile',
    enum: ['message_text', 'viber_profile', 'none'],
  })
  @IsOptional()
  @IsEnum(['message_text', 'viber_profile', 'none'])
  phoneSource?: PhoneSource | undefined;

  @ApiPropertyOptional({
    type: Number,
    description: 'Максимальное количество сообщений в выдаче (по умолчанию 50, для экспорта 0 = все)',
    default: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number | undefined = 50;
}

export class ExportMonitoredMessagesDto extends MonitoredMessagesFilterDto {
  @ApiPropertyOptional({
    type: String,
    enum: ['json', 'jsonl', 'csv'],
    default: 'json',
    description: 'Формат файла экспорта',
  })
  @IsOptional()
  @IsIn(['json', 'jsonl', 'csv'])
  format?: 'json' | 'jsonl' | 'csv' = 'json';
}
