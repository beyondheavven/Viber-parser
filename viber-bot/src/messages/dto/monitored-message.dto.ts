import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsNumber, IsOptional } from 'class-validator';

export type PhoneSource = 'message_text' | 'viber_profile' | 'none';

export class MonitoredMessageDto {
  /** Внутренний ID сообщения в базе SQLite Viber (_id в таблице messages). */
  id!: number;

  /** ID беседы/группы (conversation_id). */
  conversationId!: number;

  /** Название группы или имя чата. */
  conversationName!: string | null;

  /** 64-битный уникальный токен сообщения Viber. */
  token!: string | null;

  /** Дата и время отправки сообщения (ISO 8601). */
  date!: string;

  /** Текст входящего сообщения. */
  body!: string | null;

  /** ID отправителя в таблице participants_info (null, если системное сообщение). */
  senderId!: number | null;

  /** Имя отправителя. */
  senderName!: string | null;

  /** Уникальный зашифрованный или декодированный member_id отправителя. */
  senderMemberId!: string | null;

  /** Флаг, было ли сообщение отправлено самим ботом. */
  outgoing!: boolean;

  /** Был ли номер телефона найден непосредственно в тексте сообщения. */
  hasPhoneInText!: boolean;

  /** Итоговый закрепленный за сообщением номер телефона в международном формате E.164 (null, если не найден). */
  attachedPhone!: string | null;

  /** Источник закрепленного номера: message_text (из текста), viber_profile (из базы Viber) или none (не найден). */
  phoneSource!: PhoneSource;

  /** Все телефонные номера, обнаруженные в тексте сообщения (если их несколько). */
  allFoundPhones?: string[] | undefined;

  /** Сообщение содержит изображение (отдельной строкой или в extra_uri). */
  hasMedia!: boolean;

  /** URI изображений, склеенных с этим текстом. */
  mediaUris?: string[] | undefined;

  /** ID исходных строк SQLite, если фото и текст были склеены в одно сообщение. */
  mergedMessageIds?: number[] | undefined;
}

export class MonitoredMessagesFilterDto {
  /** Фильтр по конкретной беседе (conversationId). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  conversationId?: number | undefined;

  /** Фильтровать только сообщения, где удалось закрепить номер телефона. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  hasPhone?: boolean | undefined;

  /** Фильтровать только сообщения с изображением. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  hasMedia?: boolean | undefined;

  /** Фильтр по источнику номера: message_text или viber_profile. */
  @IsOptional()
  @IsEnum(['message_text', 'viber_profile', 'none'])
  phoneSource?: PhoneSource | undefined;

  /** Максимальное количество сообщений в выдаче (по умолчанию 50, для экспорта 0 = все). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number | undefined = 50;
}

export class ExportMonitoredMessagesDto extends MonitoredMessagesFilterDto {
  /** Формат файла экспорта. */
  @IsOptional()
  @IsIn(['json', 'jsonl', 'csv'])
  format?: 'json' | 'jsonl' | 'csv' = 'json';
}
