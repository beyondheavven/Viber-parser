import { Controller, Inject } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TasksService } from './tasks.service.js';
import type { TaskDetailDto, TaskSummaryDto } from './dto/task-response.dto.js';
import type { StopTaskResponseDto } from './dto/stop-task.dto.js';
import type { TaskStatus } from './entities/task.entity.js';

@Controller()
export class TasksController {
  constructor(@Inject(TasksService) private readonly tasksService: TasksService) {}

  @MessagePattern('viber.tasks.get_all')
  getAllTasks(@Payload() data?: { status?: TaskStatus }): TaskSummaryDto[] {
    return this.tasksService.getAllTasks(data?.status);
  }

  @MessagePattern('viber.tasks.get_by_id')
  getTaskDetail(@Payload() data: { id: string }): TaskDetailDto {
    return this.tasksService.getTaskDetail(data.id);
  }

  @MessagePattern('viber.tasks.stop')
  stopTask(@Payload() data: { id: string }): StopTaskResponseDto {
    const task = this.tasksService.stopTask(data.id);
    return {
      taskId: task.id,
      status: task.status,
      message: 'Сигнал остановки отправлен. Задача переведена в статус stopped.',
    };
  }
}
