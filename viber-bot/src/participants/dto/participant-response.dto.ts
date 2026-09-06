import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ParticipantDto {
  @ApiProperty({
    type: Number,
    description: 'Внутренний числовой ID записи участника в SQLite (_id в таблице participants)',
    example: 42,
  })
  id!: number;

  @ApiPropertyOptional({
    type: String,
    description: 'Уникальный зашифрованный ID участника в Viber (member_id / encrypted_member_id)',
    example: '23v6N7KBqYg3s51vA==',
  })
  memberId!: string | null;

  @ApiPropertyOptional({
    type: String,
    description: 'Номер телефона в международном формате E.164 (null, если скрыт настройками приватности Viber)',
    example: '+380501234567',
  })
  number!: string | null;

  @ApiPropertyOptional({
    type: String,
    description: 'Отображаемое имя участника (наиболее полное и актуальное)',
    example: 'Александр Иванов',
  })
  name!: string | null;

  @ApiPropertyOptional({
    type: String,
    description: 'Имя из телефонной книги контактов устройства (contact_name)',
    example: 'Александр',
  })
  contactName!: string | null;

  @ApiPropertyOptional({
    type: String,
    description: 'Публичное имя профиля Viber (viber_name)',
    example: 'Alex Viber',
  })
  viberName!: string | null;

  @ApiPropertyOptional({
    type: Number,
    description: 'Числовой код роли в группе (1: superadmin, 2: admin, 3: member)',
    example: 3,
  })
  groupRole!: number | null;

  @ApiProperty({
    type: String,
    description: 'Текстовое обозначение роли',
    enum: ['superadmin', 'admin', 'member', 'unknown'],
    example: 'member',
  })
  roleLabel!: 'superadmin' | 'admin' | 'member' | 'unknown';

  @ApiProperty({
    type: Boolean,
    description: 'Флаг активности участника в чате',
    example: true,
  })
  active!: boolean;

  @ApiProperty({
    type: Boolean,
    description: 'Флаг, является ли данный участник текущим аккаунтом бота (participant_type == 0)',
    example: false,
  })
  isSelf!: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Флаг, находится ли пользователь в сети прямо сейчас',
    example: false,
  })
  isOnline?: boolean;

  @ApiPropertyOptional({
    type: String,
    description: 'Дата и время последней активности пользователя (ISO 8601 UTC)',
    example: '2026-09-05T18:19:15.799Z',
  })
  lastSeen?: string | null;
}

export class TaskCollectionResultDto {
  @ApiProperty({
    type: String,
    description: 'Название группы/сообщества',
    example: 'АVTOTRAL🚨',
  })
  group!: string;

  @ApiProperty({
    type: Number,
    description: 'Числовой ID беседы в SQLite базе данных Viber',
    example: 26,
  })
  conversationId!: number;

  @ApiProperty({
    type: String,
    description: '64-битный ID группы в Viber',
    example: '5907779393516782372',
  })
  groupId!: string;

  @ApiPropertyOptional({
    type: Number,
    description: 'Количество участников, заявленное в заголовке Viber UI (null, если не распознано)',
    example: 1632,
  })
  headerTotal?: number | null;

  @ApiProperty({
    type: Number,
    description: 'Количество успешно пролистанных страниц списка участников в Viber',
    example: 66,
  })
  pagesCount!: number;

  @ApiProperty({
    type: Number,
    description: 'Общее количество извлеченных и синхронизированных участников',
    example: 1632,
  })
  participantsCount!: number;

  @ApiProperty({
    type: Number,
    description: 'Количество участников с известным номером телефона',
    example: 25,
  })
  participantsWithPhone!: number;

  @ApiProperty({
    type: String,
    description: 'Абсолютный путь к файлу выгрузки в формате JSON',
    example: 'C:\\Coding\\Projects\\viber-bot\\data\\rosters\\26-full.json',
  })
  savedJsonPath!: string;

  @ApiProperty({
    type: String,
    description: 'Абсолютный путь к файлу выгрузки в формате TXT (таблица)',
    example: 'C:\\Coding\\Projects\\viber-bot\\data\\rosters\\26-full.txt',
  })
  savedTxtPath!: string;

  @ApiProperty({
    type: String,
    description: 'Абсолютный путь к файлу выгрузки в формате CSV',
    example: 'C:\\Coding\\Projects\\viber-bot\\data\\rosters\\26-full.csv',
  })
  savedCsvPath!: string;
}
