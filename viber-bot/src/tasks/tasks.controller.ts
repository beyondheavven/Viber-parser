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
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { map, Observable } from 'rxjs';
import { TasksService } from './tasks.service.js';
import { TaskDetailDto, TaskSummaryDto } from './dto/task-response.dto.js';
import { StopTaskResponseDto } from './dto/stop-task.dto.js';
import type { TaskStatus } from './entities/task.entity.js';

@ApiTags('tasks')
@Controller('api/tasks')
export class TasksController {
  constructor(@Inject(TasksService) private readonly tasksService: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'Получить список всех задач' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['initializing', 'starting', 'running', 'stopped', 'error', 'ready'],
    description: 'Фильтр по статусу',
  })
  @ApiResponse({ status: 200, type: [TaskSummaryDto] })
  getAllTasks(@Query('status') status?: TaskStatus): TaskSummaryDto[] {
    return this.tasksService.getAllTasks(status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить подробный статус задачи с историей шагов' })
  @ApiParam({ name: 'id', description: 'ID задачи' })
  @ApiResponse({ status: 200, type: TaskDetailDto })
  @ApiResponse({ status: 404, description: 'Задача не найдена' })
  getTaskDetail(@Param('id') id: string): TaskDetailDto {
    return this.tasksService.getTaskDetail(id);
  }

  @Post(':id/stop')
  @ApiOperation({ summary: 'Остановить выполнение активной задачи' })
  @ApiParam({ name: 'id', description: 'ID задачи' })
  @ApiResponse({ status: 200, type: StopTaskResponseDto })
  stopTask(@Param('id') id: string): StopTaskResponseDto {
    const task = this.tasksService.stopTask(id);
    return {
      taskId: task.id,
      status: task.status,
      message: 'Сигнал остановки отправлен. Задача переведена в статус stopped.',
    };
  }

  @Sse(':id/events')
  @ApiOperation({ summary: 'Server-Sent Events (SSE) поток событий задачи в реальном времени' })
  @ApiParam({ name: 'id', description: 'ID задачи' })
  getTaskEvents(@Param('id') id: string): Observable<MessageEvent> {
    const task = this.tasksService.getTask(id);
    return task.events$.pipe(
      map((event) => ({
        data: JSON.stringify(event),
      })),
    );
  }
}
