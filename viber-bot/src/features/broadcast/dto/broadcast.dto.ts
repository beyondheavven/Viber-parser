import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
} from 'class-validator';
import { ROTATION_STRATEGIES, type RotationStrategy } from '../rotation.js';
import type { CampaignStatus, SendStatus } from '../types.js';

export class CreateCampaignDto {
  /** Человекочитаемое имя кампании. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  /** ID бесед (row ID из GET /api/groups), в которые идёт рассылка. */
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  conversationIds!: number[];

  /** Варианты текста рассылки. Какую формулировку взять следующей, выбирает стратегия rotation. */
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  messages!: string[];

  /** Пауза между отправками в любые чаты, миллисекунды (минимум 5000). */
  @Type(() => Number)
  @IsNumber()
  @Min(5_000)
  intervalMs!: number;

  /** Минимальный интервал повторной отправки в один и тот же чат, миллисекунды. По умолчанию равен intervalMs. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(5_000)
  minIntervalPerChatMs?: number;

  /** round-robin — по кругу; random — случайно без повтора предыдущего; shuffle-cycle — перемешанный цикл без повторов внутри круга (по умолчанию). */
  @IsOptional()
  @IsIn(ROTATION_STRATEGIES)
  rotation?: RotationStrategy;

  /** true — крутить выбранные группы бесконечно; false — по одному сообщению в каждую и остановиться. */
  @IsOptional()
  @IsBoolean()
  loop?: boolean;

  /** Начало рабочих часов по местному времени, ЧЧ:ММ. Вместе с activeTo задаёт окно, когда рассылка может отправлять. */
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'activeFrom укажите как ЧЧ:ММ' })
  activeFrom?: string;

  /** Конец рабочих часов по местному времени, ЧЧ:ММ (это время уже не входит в окно). */
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'activeTo укажите как ЧЧ:ММ' })
  activeTo?: string;
}

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  conversationIds?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  messages?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(5_000)
  intervalMs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(5_000)
  minIntervalPerChatMs?: number;

  @IsOptional()
  @IsIn(ROTATION_STRATEGIES)
  rotation?: RotationStrategy;

  @IsOptional()
  @IsBoolean()
  loop?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'activeFrom укажите как ЧЧ:ММ' })
  activeFrom?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'activeTo укажите как ЧЧ:ММ' })
  activeTo?: string | null;
}

export class CampaignGroupDto {
  conversationId!: number;

  name!: string | null;
}

export class ChatRotationStateDto {
  conversationId!: number;

  /** Сколько раз эта кампания успешно отправила в этот чат. */
  sendCount!: number;

  /** Индекс последнего отправленного варианта из пула. */
  lastMessageIndex!: number | null;
}

export class CampaignDto {
  id!: string;

  name!: string;

  groups!: CampaignGroupDto[];

  messages!: string[];

  intervalMs!: number;

  minIntervalPerChatMs!: number;

  rotation!: RotationStrategy;

  loop!: boolean;

  activeFrom!: string | null;

  activeTo!: string | null;

  status!: CampaignStatus;

  nextGroupIndex!: number;

  rotationState!: ChatRotationStateDto[];

  sentCount!: number;

  failedCount!: number;

  lastError!: string | null;

  createdAt!: string;

  updatedAt!: string;

  startedAt!: string | null;

  stoppedAt!: string | null;
}

export class SendHistoryDto {
  id!: string;

  campaignId!: string;

  conversationId!: number;

  conversationName!: string | null;

  messageIndex!: number;

  text!: string;

  status!: SendStatus;

  error!: string | null;

  sentAt!: string;
}

export class BroadcastHistoryQueryDto {
  /** Только этот чат. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  conversationId?: number;

  /** Только эта кампания. */
  @IsOptional()
  @IsString()
  campaignId?: string;

  /** Сколько последних записей вернуть. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;
}

export class BroadcastStatusDto {
  isRunning!: boolean;

  campaign!: CampaignDto | null;
}
