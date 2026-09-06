import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional } from 'class-validator';

export class EnableMonitorGroupDto {
  @ApiPropertyOptional({
    type: Boolean,
    description:
      'true — начать с текущего последнего сообщения (пропустить историю). false — подтянуть все сообщения с сохранённого курсора или с начала. По умолчанию true только при первом включении группы.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  fromLatest?: boolean;
}

export class MonitoredGroupDto {
  @ApiProperty({ type: Number, example: 26 })
  conversationId!: number;

  @ApiPropertyOptional({ type: String, example: 'АVTOTRAL🚨' })
  name!: string | null;

  @ApiProperty({ type: Boolean, example: true })
  enabled!: boolean;

  @ApiProperty({
    type: Number,
    description: 'Последний обработанный ID сообщения в этой группе. После рестарта эмулятора опрос продолжается отсюда.',
    example: 1542,
  })
  lastMessageId!: number;
}

export class StartMonitorDto {
  @ApiPropertyOptional({
    type: Number,
    description: 'Включить мониторинг этой группы и запустить опрос',
    example: 26,
  })
  @IsOptional()
  @IsNumber()
  conversationId?: number;

  @ApiPropertyOptional({
    type: Number,
    description: 'Интервал опроса базы данных в миллисекундах (по умолчанию 2500 мс)',
    default: 2500,
    example: 2500,
  })
  @IsOptional()
  @IsNumber()
  pollIntervalMs?: number = 2500;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Для conversationId: true — пропустить историю этой группы. false — догнать с сохранённого курсора. Если группа уже мониторилась, по умолчанию курсор не сбрасывается.',
  })
  @IsOptional()
  @IsBoolean()
  fromLatest?: boolean;

  @ApiPropertyOptional({
    type: Number,
    description: 'Начать обработку с конкретного ID сообщения (например, 0 для всей истории)',
    example: 0,
  })
  @IsOptional()
  @IsNumber()
  startFromId?: number | undefined;
}

export class MonitorStatusDto {
  @ApiProperty({
    type: Boolean,
    description: 'Активен ли сейчас фоновый мониторинг сообщений',
    example: true,
  })
  isRunning!: boolean;

  @ApiPropertyOptional({
    type: Number,
    description: 'Устарело: используйте groups. Заполнено, если включена ровно одна группа.',
    example: 26,
  })
  conversationId?: number | null;

  @ApiProperty({
    type: () => [MonitoredGroupDto],
    description: 'Группы, для которых мониторинг включён или выключен, с курсором catch-up',
  })
  groups!: MonitoredGroupDto[];

  @ApiProperty({
    type: Boolean,
    description: 'Frida-перехват записи в SQLite: сообщение обрабатывается сразу при сохранении в Viber',
    example: true,
  })
  liveWatch!: boolean;

  @ApiProperty({
    type: Number,
    description: 'Интервал страховочного опроса в миллисекундах (при liveWatch основной путь — мгновенный хук)',
    example: 2500,
  })
  pollIntervalMs!: number;

  @ApiPropertyOptional({
    type: String,
    description: 'Время последнего цикла опроса (ISO 8601)',
    example: '2026-09-05T16:14:00.000Z',
  })
  lastPollAt?: string | null;

  @ApiProperty({
    type: Number,
    description: 'Последний обработанный ID сообщения в базе SQLite',
    example: 1542,
  })
  lastProcessedMessageId!: number;

  @ApiProperty({
    type: Number,
    description: 'Всего обработано сообщений за текущую сессию',
    example: 48,
  })
  processedMessagesCount!: number;

  @ApiProperty({
    type: Number,
    description: 'Количество сообщений, где номер телефона был извлечен из текста',
    example: 32,
  })
  phonesFromTextCount!: number;

  @ApiProperty({
    type: Number,
    description: 'Количество сообщений, где номер телефона был подтянут из профиля базы Viber',
    example: 9,
  })
  phonesFromViberCount!: number;
}
