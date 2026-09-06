import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class QueryOnlineStatusDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Массив Base64 member_id участников для проверки активности',
    example: ['HcvrP82KC0w=', 'H87hr/brMzQ='],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  memberIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Массив телефонных номеров для проверки активности (сопоставляются с базой для получения member_id)',
    example: ['+380988806081'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  phoneNumbers?: string[];
}

export class OnlineStatusItemDto {
  @ApiPropertyOptional({ type: String, example: 'HcvrP82KC0w=' })
  memberId!: string;

  @ApiPropertyOptional({ type: String, example: '+380988806081' })
  phoneNumber?: string | null;

  @ApiPropertyOptional({ type: Boolean, example: false })
  isOnline!: boolean;

  @ApiPropertyOptional({ type: String, example: '2026-09-05T18:19:15.799Z' })
  lastSeen?: string | null;
}
