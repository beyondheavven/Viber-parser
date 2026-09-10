import { IsBoolean, IsNumber, IsOptional } from 'class-validator';

export class DecodeRequestDto {
  /** Режим предпросмотра без записи изменений в боевую базу данных (по умолчанию false). */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean = false;

  /** Ограничить количество дешифруемых записей (для тестов). */
  @IsOptional()
  @IsNumber()
  limit?: number | undefined;

  /** Перезапустить Viber после записи в БД для синхронизации контактов и сетевых данных (по умолчанию true). */
  @IsOptional()
  @IsBoolean()
  restartApp?: boolean = true;

  /** Время ожидания сетевой синхронизации контактов после перезапуска Viber в секундах (по умолчанию 10). */
  @IsOptional()
  @IsNumber()
  waitForSyncSeconds?: number = 10;
}

export class DecodedItemDto {
  id!: number;

  name!: string | null;

  oldMemberId!: string | null;

  newMemberId!: string;
}

export class DecodeResultDto {
  success!: boolean;

  message!: string;

  dryRun!: boolean;

  /** Всего записей в participants_info. */
  totalRows!: number;

  /** Найдено недешифрованных записей. */
  undecodedFound!: number;

  /** Успешно дешифровано записей. */
  decodedCount!: number;

  /** Ошибок дешифровки. */
  errorsCount!: number;

  /** Примеры дешифрованных записей. */
  sampleDecoded?: DecodedItemDto[];

  /** Был ли выполнен перезапуск приложения Viber для подтягивания данных. */
  restartedApp?: boolean;
}
