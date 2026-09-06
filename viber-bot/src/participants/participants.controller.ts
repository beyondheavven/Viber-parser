import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { existsSync, readFileSync } from 'node:fs';
import {
  CollectAcceptedResponseDto,
  CollectParticipantsDto,
} from './dto/collect-participants.dto.js';
import { ParticipantDto } from './dto/participant-response.dto.js';
import {
  QueryOnlineStatusDto,
  OnlineStatusItemDto,
} from './dto/query-online-status.dto.js';
import { TasksService } from '../tasks/tasks.service.js';
import { DeviceMutexService } from '../common/mutex/device-mutex.service.js';
import { ParticipantsCollectorFlow } from './participants-collector.flow.js';
import { OnlineStatusService } from '../automation/frida/online-status.service.js';
import { openDevice } from '../context.js';
import { fetchParticipantsInfo } from '../viber/participants-service.js';

@ApiTags('participants')
@Controller('api')
export class ParticipantsController {
  constructor(
    @Inject(TasksService) private readonly tasksService: TasksService,
    @Inject(DeviceMutexService) private readonly deviceMutex: DeviceMutexService,
    @Inject(ParticipantsCollectorFlow) private readonly collectorFlow: ParticipantsCollectorFlow,
    @Inject(OnlineStatusService) private readonly onlineStatusService: OnlineStatusService,
  ) {}

  @Post('participants/collect')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Запустить сбор участников группы/сообщества' })
  @ApiResponse({
    status: 202,
    description: 'Задача принята к исполнению',
    type: CollectAcceptedResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Эмулятор занят выполнением другой задачи',
  })
  collectParticipants(
    @Body() dto: CollectParticipantsDto,
  ): CollectAcceptedResponseDto {
    const task = this.tasksService.createTask(dto.group);

    const locked = this.deviceMutex.tryLock(task.id);
    if (!locked) {
      const lockInfo = this.deviceMutex.getLockInfo();
      task.fail(
        `Эмулятор в данный момент занят задачей ${String(lockInfo?.taskId)}. Попробуйте позже.`,
      );
      throw new ConflictException(
        `Эмулятор сейчас занят выполнением задачи "${String(lockInfo?.taskId)}". Дождитесь её завершения.`,
      );
    }

    // Launch execution in the background asynchronously
    void this.collectorFlow.execute(task, dto);

    return {
      taskId: task.id,
      status: task.status,
      group: dto.group,
      message: `Задача сбора участников для группы "${dto.group}" успешно запущена.`,
    };
  }

  @Get('tasks/:id/participants')
  @ApiOperation({ summary: 'Получить список участников завершенной задачи' })
  @ApiParam({ name: 'id', description: 'ID задачи' })
  @ApiResponse({
    status: 200,
    description: 'Массив участников',
    type: [ParticipantDto],
  })
  @ApiResponse({ status: 404, description: 'Задача не найдена или результат еще не готов' })
  getTaskParticipants(@Param('id') id: string): ParticipantDto[] {
    const task = this.tasksService.getTask(id);

    if (task.status !== 'ready') {
      throw new NotFoundException(
        `Результат задачи ${id} еще не готов. Текущий статус: "${task.status}".`,
      );
    }

    const savedJsonPath = task.result?.['savedJsonPath'];
    if (typeof savedJsonPath === 'string' && existsSync(savedJsonPath)) {
      try {
        const raw = readFileSync(savedJsonPath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed.participants ?? [];
      } catch {
        // Fallback to empty array
      }
    }

    throw new NotFoundException(`Файл с результатами задачи ${id} не найден на диске.`);
  }

  @Post('participants/online-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Запросить онлайн-статус и дату последней активности для списка участников',
  })
  @ApiResponse({
    status: 200,
    description: 'Массив статусов активности участников',
    type: [OnlineStatusItemDto],
  })
  async getOnlineStatuses(
    @Body() dto: QueryOnlineStatusDto,
  ): Promise<OnlineStatusItemDto[]> {
    const context = await openDevice();
    let memberIds = dto.memberIds ? [...dto.memberIds] : [];

    if (dto.phoneNumbers && dto.phoneNumbers.length > 0) {
      const phoneSet = new Set(dto.phoneNumbers.map((p) => p.trim()));
      const allParticipants = fetchParticipantsInfo(context.db);
      for (const p of allParticipants) {
        if (p.number && phoneSet.has(p.number) && p.memberId) {
          memberIds.push(p.memberId);
        }
      }
    }

    memberIds = Array.from(new Set(memberIds.filter(Boolean)));
    const onlineMap = await this.onlineStatusService.fetchOnlineStatuses(
      context.adb,
      memberIds,
    );

    return memberIds.map((mid) => {
      const info = onlineMap.get(mid);
      return {
        memberId: mid,
        isOnline: info?.isOnline ?? false,
        lastSeen: info?.lastSeen ?? null,
      };
    });
  }
}
