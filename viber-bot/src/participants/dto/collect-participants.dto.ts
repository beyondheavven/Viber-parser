import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CollectParticipantsDto {
  @ApiProperty({
    type: String,
    description: 'Имя группы или числовой row ID беседы в Viber (например, "26" или "АVTOTRAL🚨")',
    example: '26',
  })
  @IsString()
  @IsNotEmpty({ message: 'Поле group не может быть пустым' })
  group!: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Разрешить сохранение частичного списка, если пагинация прервалась до последней страницы',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  allowPartial?: boolean = false;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Перезапускать Viber после записи в БД для сетевой синхронизации телефонов',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  restartApp?: boolean = true;

  @ApiPropertyOptional({
    type: Number,
    description: 'Таймаут ожидания ответа Frida на страницу в мс (по умолчанию 15 000 мс)',
    default: 15_000,
  })
  @IsOptional()
  @IsNumber()
  idleTimeoutMs?: number = 15_000;

  @ApiPropertyOptional({
    type: Number,
    description: 'Таймаут ожидания синхронизации номеров телефонов в мс (по умолчанию 45 000 мс)',
    default: 45_000,
  })
  @IsOptional()
  @IsNumber()
  numbersSyncTimeoutMs?: number = 45_000;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Принудительно перезаписывать имена и удалять дубликаты в боевой базе данных эмулятора (по умолчанию false)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  syncLiveDbAfter?: boolean = false;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Сбор статуса активности (В сети / Дата последнего посещения) для всех участников (по умолчанию true)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  fetchOnlineStatus?: boolean = true;
}

export class CollectAcceptedResponseDto {
  @ApiProperty({ type: String, example: 'task_1725547890123' })
  taskId!: string;

  @ApiProperty({ type: String, example: 'initializing' })
  status!: string;

  @ApiProperty({ type: String, example: '26' })
  group!: string;

  @ApiProperty({ type: String, example: 'Задача сбора участников запущена' })
  message!: string;
}
