import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { FlowStep, TaskStatus, TaskStepInfo } from '../entities/task.entity.js';
import { TaskCollectionResultDto } from '../../participants/dto/participant-response.dto.js';

export class TaskStepDto {
  @ApiProperty({ type: String, description: 'Идентификатор шага', example: 'paging_participants' })
  step!: FlowStep;

  @ApiProperty({ type: String, description: 'Описание выполняемого шага', example: 'Сбор участников через Frida' })
  description!: string;

  @ApiProperty({ type: String, description: 'Время начала шага (ISO 8601)' })
  startedAt!: string;

  @ApiPropertyOptional({ type: Number, description: 'Длительность шага в мс' })
  durationMs?: number | undefined;

  @ApiPropertyOptional({ type: Object, description: 'Детали прогресса шага' })
  progress?: Record<string, unknown> | undefined;
}

export class TaskSummaryDto {
  @ApiProperty({ type: String, description: 'Уникальный ID задачи', example: 'task_1725547890123' })
  id!: string;

  @ApiProperty({ type: String, description: 'Имя или ID целевой группы', example: '26' })
  groupTarget!: string;

  @ApiPropertyOptional({ type: String, description: 'Название группы', example: 'АVTOTRAL🚨' })
  groupName?: string | undefined;

  @ApiPropertyOptional({ type: Number, description: 'Числовой ID беседы', example: 26 })
  conversationId?: number | undefined;

  @ApiProperty({
    type: String,
    description: 'Статус задачи: initializing, starting, running, stopped, error, ready',
    example: 'running',
    enum: ['initializing', 'starting', 'running', 'stopped', 'error', 'ready'],
  })
  status!: TaskStatus;

  @ApiPropertyOptional({ type: () => TaskStepDto, description: 'Текущий выполняемый шаг' })
  currentStep?: TaskStepDto | null | undefined;

  @ApiProperty({ type: String, description: 'Дата создания задачи' })
  createdAt!: string;

  @ApiPropertyOptional({ type: String, description: 'Дата запуска' })
  startedAt?: string | undefined;

  @ApiPropertyOptional({ type: String, description: 'Дата завершения' })
  completedAt?: string | undefined;
}

export class TaskDetailDto extends TaskSummaryDto {
  @ApiProperty({ description: 'История выполненных шагов с таймингами', type: () => [TaskStepDto] })
  stepHistory!: TaskStepInfo[];

  @ApiPropertyOptional({ type: Object, description: 'Текущий объект прогресса' })
  progress?: Record<string, unknown> | null | undefined;

  @ApiPropertyOptional({ type: String, description: 'Текст ошибки, если статус error' })
  error?: string | null | undefined;

  @ApiPropertyOptional({
    type: () => TaskCollectionResultDto,
    description: 'Итоговый результат задачи сбора участников, если статус ready',
  })
  result?: TaskCollectionResultDto | Record<string, unknown> | null | undefined;
}
