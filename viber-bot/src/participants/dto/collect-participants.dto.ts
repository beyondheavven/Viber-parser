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

  /** Таймаут ожидания синхронизации номеров телефонов в мс (по умолчанию 45 000 мс). */
  @IsOptional()
  @IsNumber()
  numbersSyncTimeoutMs?: number = 45_000;

  /** Принудительно перезаписывать имена и удалять дубликаты в боевой базе данных эмулятора (по умолчанию false). */
  @IsOptional()
  @IsBoolean()
  syncLiveDbAfter?: boolean = false;

  /** Сбор статуса активности (В сети / Дата последнего посещения) для всех участников (по умолчанию true). */
  @IsOptional()
  @IsBoolean()
  fetchOnlineStatus?: boolean = true;
}

export class CollectAcceptedResponseDto {
  taskId!: string;

  status!: string;

  group!: string;

  message!: string;
}
