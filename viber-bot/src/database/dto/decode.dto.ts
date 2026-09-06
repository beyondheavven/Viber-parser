import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional } from 'class-validator';

export class DecodeRequestDto {
  @ApiPropertyOptional({
    type: Boolean,
    description: 'Режим предпросмотра без записи изменений в боевую базу данных (по умолчанию false)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean = false;

  @ApiPropertyOptional({
    type: Number,
    description: 'Ограничить количество дешифруемых записей (для тестов)',
  })
  @IsOptional()
  @IsNumber()
  limit?: number | undefined;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Перезапустить Viber после записи в БД для синхронизации контактов и сетевых данных (по умолчанию true)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  restartApp?: boolean = true;

  @ApiPropertyOptional({
    type: Number,
    description: 'Время ожидания сетевой синхронизации контактов после перезапуска Viber в секундах (по умолчанию 10)',
    default: 10,
  })
  @IsOptional()
  @IsNumber()
  waitForSyncSeconds?: number = 10;
}

export class DecodedItemDto {
  @ApiProperty({ type: Number, example: 154 })
  id!: number;

  @ApiPropertyOptional({ type: String, example: 'Иван' })
  name!: string | null;

  @ApiPropertyOptional({ type: String, example: 'em:AQANrniLcl9lwBpvAAD45BjXack2KDDejNcNiXWX7KoogUod/74atmpL' })
  oldMemberId!: string | null;

  @ApiProperty({ type: String, example: 'Da54i3JfZcA=' })
  newMemberId!: string;
}

export class DecodeResultDto {
  @ApiProperty({ type: Boolean, example: true })
  success!: boolean;

  @ApiProperty({ type: String, example: 'Дешифровка успешно выполнена и сохранена в базе данных' })
  message!: string;

  @ApiProperty({ type: Boolean, example: false })
  dryRun!: boolean;

  @ApiProperty({ type: Number, description: 'Всего записей в participants_info', example: 1972 })
  totalRows!: number;

  @ApiProperty({ type: Number, description: 'Найдено недешифрованных записей', example: 45 })
  undecodedFound!: number;

  @ApiProperty({ type: Number, description: 'Успешно дешифровано записей', example: 45 })
  decodedCount!: number;

  @ApiProperty({ type: Number, description: 'Ошибок дешифровки', example: 0 })
  errorsCount!: number;

  @ApiPropertyOptional({ type: () => [DecodedItemDto], description: 'Примеры дешифрованных записей' })
  sampleDecoded?: DecodedItemDto[];

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Был ли выполнен перезапуск приложения Viber для подтягивания данных',
    example: true,
  })
  restartedApp?: boolean;
}
