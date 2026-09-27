import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CollectParticipantsDto {
  /** Имя группы или числовой row ID беседы в Viber (например, "26" или "АVTOTRAL🚨"). */
  @IsString()
  @IsNotEmpty({ message: 'Поле group не может быть пустым' })
  group!: string;

  /** Разрешить сохранение частичного списка, если пагинация прервалась до последней страницы. */
  @IsOptional()
  @IsBoolean()
  allowPartial?: boolean = false;

  /** Перезапускать Viber после записи в БД для сетевой синхронизации телефонов. */
  @IsOptional()
  @IsBoolean()
  restartApp?: boolean = true;

  /** Таймаут ожидания ответа Frida на страницу в мс (по умолчанию 15 000 мс). */
  @IsOptional()
  @IsNumber()
  idleTimeoutMs?: number = 15_000;

  /**
   * Таймаут ожидания синхронизации номеров телефонов в мс. 0 — автоматически:
   * 45 с для маленьких групп, 10 мс на участника для больших, но не больше 5 минут.
   */
  @IsOptional()
  @IsNumber()
  numbersSyncTimeoutMs?: number = 0;

  /** Принудительно перезаписывать имена и удалять дубликаты в боевой базе данных эмулятора (по умолчанию false). */
  @IsOptional()
  @IsBoolean()
  syncLiveDbAfter?: boolean = false;

  /** Сбор статуса активности (В сети / Дата последнего посещения) для всех участников (по умолчанию true). */
  @IsOptional()
  @IsBoolean()
  fetchOnlineStatus?: boolean = true;

  /** Двойной/тройной проход для устранения пропусков (по умолчанию true). */
  @IsOptional()
  @IsBoolean()
  twoPass?: boolean = true;

  /** Количество полных проходов с 0 для максимального охвата (по умолчанию 5). */
  @IsOptional()
  @IsNumber()
  passesCount?: number = 5;
}

export class CollectAcceptedResponseDto {
  taskId!: string;

  status!: string;

  group!: string;

  message!: string;
}
