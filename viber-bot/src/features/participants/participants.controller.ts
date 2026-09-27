import {
  ConflictException,
  Controller,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { existsSync, readFileSync } from 'node:fs';
import type {
  CollectAcceptedResponseDto,
  CollectParticipantsDto,
} from './dto/collect-participants.dto.js';
import type { ParticipantDto } from './dto/participant-response.dto.js';
import type {
  QueryOnlineStatusDto,
  OnlineStatusItemDto,
} from './dto/query-online-status.dto.js';
import { TasksService } from '../tasks/tasks.service.js';
import { DeviceMutexService } from '../../platform/mutex/device-mutex.service.js';
import { ParticipantsCollectorFlow } from './participants-collector.flow.js';
import { OnlineStatusService } from './online-status.service.js';
import { openDevice } from '../../platform/context.js';
import { fetchParticipantsInfo } from '../../viber/participants-sql.js';

@Controller()
export class ParticipantsController {
  constructor(
    @Inject(TasksService) private readonly tasksService: TasksService,
    @Inject(DeviceMutexService) private readonly deviceMutex: DeviceMutexService,
    @Inject(ParticipantsCollectorFlow) private readonly collectorFlow: ParticipantsCollectorFlow,
    @Inject(OnlineStatusService) private readonly onlineStatusService: OnlineStatusService,
  ) {}

  @MessagePattern('viber.participants.collect')
  collectParticipants(
    @Payload() dto: CollectParticipantsDto,
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

    void this.collectorFlow.execute(task, dto);

    return {
      taskId: task.id,
      status: task.status,
      group: dto.group,
      message: `Задача сбора участников для группы "${dto.group}" успешно запущена.`,
    };
  }

  @MessagePattern('viber.participants.get_task_participants')
  getTaskParticipants(@Payload() data: { id: string }): ParticipantDto[] {
    const id = data.id;
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
        // ignore parse error
      }
    }

    throw new NotFoundException(`Файл с результатами задачи ${id} не найден на диске.`);
  }

  @MessagePattern('viber.participants.online_status')
  async getOnlineStatuses(
    @Payload() dto: QueryOnlineStatusDto,
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
