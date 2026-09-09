import {
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { TasksService } from './tasks.service.js';
import { TaskDetailDto, TaskSummaryDto } from './dto/task-response.dto.js';
import { StopTaskResponseDto } from './dto/stop-task.dto.js';
import type { TaskStatus } from './entities/task.entity.js';

@Controller('api/tasks')
export class TasksController {
  constructor(@Inject(TasksService) private readonly tasksService: TasksService) {}

  @Get()
  getAllTasks(@Query('status') status?: TaskStatus): TaskSummaryDto[] {
    return this.tasksService.getAllTasks(status);
  }

  @Get(':id')
  getTaskDetail(@Param('id') id: string): TaskDetailDto {
    return this.tasksService.getTaskDetail(id);
  }

  @Post(':id/stop')
  stopTask(@Param('id') id: string): StopTaskResponseDto {
    const task = this.tasksService.stopTask(id);
    return {
      taskId: task.id,
      status: task.status,
      message: 'Сигнал остановки отправлен. Задача переведена в статус stopped.',
    };
  }

  @Sse(':id/events')
  getTaskEvents(@Param('id') id: string): Observable<MessageEvent> {
    const task = this.tasksService.getTask(id);
    return task.events$.pipe(
      map((event) => ({
        data: JSON.stringify(event),
      })),
    );
  }
}
