import { IsArray, IsOptional, IsString } from 'class-validator';

export class QueryOnlineStatusDto {
  /** Массив Base64 member_id участников для проверки активности. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  memberIds?: string[];

  /** Массив телефонных номеров для проверки активности (сопоставляются с базой для получения member_id). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  phoneNumbers?: string[];
}

export class OnlineStatusItemDto {
  memberId!: string;

  phoneNumber?: string | null;

  isOnline!: boolean;

  lastSeen?: string | null;
}
