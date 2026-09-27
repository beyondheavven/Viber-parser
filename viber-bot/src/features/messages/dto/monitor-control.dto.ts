import { IsBoolean, IsNumber, IsOptional } from 'class-validator';

export class EnableMonitorGroupDto {
  /** true — начать с текущего последнего сообщения (пропустить историю). false — подтянуть все сообщения с сохранённого курсора или с начала. По умолчанию true только при первом включении группы. */
  @IsOptional()
  @IsBoolean()
  fromLatest?: boolean;
}

export class MonitoredGroupDto {
  conversationId!: number;

  name!: string | null;

  enabled!: boolean;

  /** Последний обработанный ID сообщения в этой группе. После рестарта эмулятора опрос продолжается отсюда. */
  lastMessageId!: number;

  /** Глобальный ключ группы Viber (conversations.group_id). */
  groupKey?: string | null;

  /** Инстанс эмулятора, на котором стоит группа. */
  deviceId?: string;
}

export class StartMonitorDto {
  /** Включить мониторинг этой группы и запустить опрос. */
  @IsOptional()
  @IsNumber()
  conversationId?: number;

  /** Интервал опроса базы данных в миллисекундах (по умолчанию 2500 мс). */
  @IsOptional()
  @IsNumber()
  pollIntervalMs?: number = 2500;

  /** Для conversationId: true — пропустить историю этой группы. false — догнать с сохранённого курсора. Если группа уже мониторилась, по умолчанию курсор не сбрасывается. */
  @IsOptional()
  @IsBoolean()
  fromLatest?: boolean;

  /** Начать обработку с конкретного ID сообщения (например, 0 для всей истории). */
  @IsOptional()
  @IsNumber()
  startFromId?: number | undefined;
}

export class MonitorStatusDto {
  /** Активен ли сейчас фоновый мониторинг сообщений. */
  isRunning!: boolean;

  /** Инстанс эмулятора, к которому привязан статус. */
  deviceId?: string;

  /** Устарело: используйте groups. Заполнено, если включена ровно одна группа. */
  conversationId?: number | null;

  /** Группы, для которых мониторинг включён или выключен, с курсором catch-up. */
  groups!: MonitoredGroupDto[];

  /** Frida-перехват записи в SQLite: сообщение обрабатывается сразу при сохранении в Viber. */
  liveWatch!: boolean;

  /** Интервал страховочного опроса в миллисекундах (при liveWatch основной путь — мгновенный хук). */
  pollIntervalMs!: number;

  /** Время последнего цикла опроса (ISO 8601). */
  lastPollAt?: string | null;

  /** Последний обработанный ID сообщения в базе SQLite. */
  lastProcessedMessageId!: number;

  /** Всего обработано сообщений за текущую сессию. */
  processedMessagesCount!: number;

  /** Количество сообщений, где номер телефона был извлечен из текста. */
  phonesFromTextCount!: number;

  /** Количество сообщений, где номер телефона был подтянут из профиля базы Viber. */
  phonesFromViberCount!: number;
}
