import type { FlowStep, TaskStatus, TaskStepInfo } from '../entities/task.entity.js';
import { TaskCollectionResultDto } from '../../participants/dto/participant-response.dto.js';

export class TaskStepDto {
  /** Идентификатор шага. */
  step!: FlowStep;

  /** Описание выполняемого шага. */
  description!: string;

  /** Время начала шага (ISO 8601). */
  startedAt!: string;

  /** Длительность шага в мс. */
  durationMs?: number | undefined;

  /** Детали прогресса шага. */
  progress?: Record<string, unknown> | undefined;
}

export class TaskSummaryDto {
  /** Уникальный ID задачи. */
  id!: string;

  /** Имя или ID целевой группы. */
  groupTarget!: string;

  /** Название группы. */
  groupName?: string | undefined;

  /** Числовой ID беседы. */
  conversationId?: number | undefined;

  /** Статус задачи: initializing, starting, running, stopped, error, ready. */
  status!: TaskStatus;

  /** Текущий выполняемый шаг. */
  currentStep?: TaskStepDto | null | undefined;

  /** Дата создания задачи. */
  createdAt!: string;

  /** Дата запуска. */
  startedAt?: string | undefined;

  /** Дата завершения. */
  completedAt?: string | undefined;

  /** Текст ошибки, если статус error. В списке тоже: иначе причину падения не видно без второго запроса. */
  error?: string | null | undefined;
}

export class TaskDetailDto extends TaskSummaryDto {
  /** История выполненных шагов с таймингами. */
  stepHistory!: TaskStepInfo[];

  /** Текущий объект прогресса. */
  progress?: Record<string, unknown> | null | undefined;

  /** Итоговый результат задачи сбора участников, если статус ready. */
  result?: TaskCollectionResultDto | Record<string, unknown> | null | undefined;
}
