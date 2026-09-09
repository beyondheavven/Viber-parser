import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TaskEntity, type TaskStatus } from './entities/task.entity.js';
import {
  TaskDetailDto,
  TaskStepDto,
  TaskSummaryDto,
} from './dto/task-response.dto.js';
import { DeviceMutexService } from '../common/mutex/device-mutex.service.js';
import {RabbitMqPublisher} from "../rabbitmq/rabbitmq-publisher.service.js";

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  private readonly tasks = new Map<string, TaskEntity>();

  constructor(
      @Inject(DeviceMutexService)
      private readonly deviceMutex: DeviceMutexService,
      private readonly publisher : RabbitMqPublisher) {}

  createTask(groupTarget: string): TaskEntity {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const task = new TaskEntity(id, groupTarget);
    task.events$.subscribe({
      next: (event) => this.publisher.publishTaskEvent(event),
      error: (err) => this.logger.error(`Ошибка в потоке событий задачи ${id}: ${String(err)}`),
    });

    this.publisher.publishTaskEvent({
      taskId: task.id,
      status: task.status,
      step: task.currentStep ?? undefined,
      timestamp: task.createdAt.toISOString(),
    });

    this.tasks.set(id, task);
    this.logger.log(`Created task ${id} for group "${groupTarget}"`);
    return task;
  }

  getTask(id: string): TaskEntity {
    const task = this.tasks.get(id);
    if (!task) {
      throw new NotFoundException(`Задача с ID "${id}" не найдена`);
    }
    return task;
  }

  getAllTasks(status?: TaskStatus): TaskSummaryDto[] {
    const all = Array.from(this.tasks.values());
    const filtered = status ? all.filter((t) => t.status === status) : all;
    return filtered
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((t) => this.toSummaryDto(t));
  }

  getTaskDetail(id: string): TaskDetailDto {
    const task = this.getTask(id);
    return this.toDetailDto(task);
  }

  stopTask(id: string): TaskEntity {
    const task = this.getTask(id);

    if (task.status === 'ready' || task.status === 'error' || task.status === 'stopped') {
      this.logger.warn(`Task ${id} is already in terminal state "${task.status}"`);
      return task;
    }

    this.logger.log(`Stopping task ${id} by user request...`);
    task.stop();
    this.deviceMutex.unlock(id);
    return task;
  }

  toSummaryDto(task: TaskEntity): TaskSummaryDto {
    return {
      id: task.id,
      groupTarget: task.groupTarget,
      groupName: task.groupName,
      conversationId: task.conversationId,
      status: task.status,
      currentStep: task.currentStep ? this.toStepDto(task.currentStep) : null,
      createdAt: task.createdAt.toISOString(),
      startedAt: task.startedAt?.toISOString(),
      completedAt: task.completedAt?.toISOString(),
    };
  }

  toDetailDto(task: TaskEntity): TaskDetailDto {
    return {
      ...this.toSummaryDto(task),
      stepHistory: task.stepHistory,
      progress: task.progress,
      error: task.error,
      result: task.result,
    };
  }

  private toStepDto(step: NonNullable<TaskEntity['currentStep']>): TaskStepDto {
    return {
      step: step.step,
      description: step.description,
      startedAt: step.startedAt,
      durationMs: step.durationMs,
      progress: step.progress,
    };
  }
}
