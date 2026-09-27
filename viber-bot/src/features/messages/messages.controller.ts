import { Controller, Inject } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { MessagesMonitorService } from './messages-monitor.service.js';
import type {
  EnableMonitorGroupDto,
  MonitorStatusDto,
  MonitoredGroupDto,
  StartMonitorDto,
} from './dto/monitor-control.dto.js';
import type {
  ExportMonitoredMessagesDto,
  MonitoredMessageDto,
  MonitoredMessagesFilterDto,
} from './dto/monitored-message.dto.js';

@Controller()
export class MessagesController {
  constructor(
    @Inject(MessagesMonitorService) private readonly monitorService: MessagesMonitorService,
  ) {}

  @MessagePattern('viber.messages.monitor.start')
  async startMonitoring(@Payload() dto: StartMonitorDto = {}): Promise<MonitorStatusDto> {
    return this.monitorService.start(dto ?? {});
  }

  @MessagePattern('viber.messages.monitor.stop')
  stopMonitoring(): MonitorStatusDto {
    return this.monitorService.stop();
  }

  @MessagePattern('viber.messages.monitor.status')
  getStatus(): MonitorStatusDto {
    return this.monitorService.getStatus();
  }

  @MessagePattern('viber.messages.monitor.groups')
  getMonitoredGroups(): MonitoredGroupDto[] {
    return this.monitorService.getGroups();
  }

  @MessagePattern('viber.messages.monitor.enable_group')
  async enableGroup(
    @Payload() data: { id: number; dto?: EnableMonitorGroupDto | string },
  ): Promise<MonitorStatusDto> {
    const id = Number(data.id);
    let dto = data.dto ?? {};
    if (typeof dto === 'string') {
      try {
        dto = JSON.parse(dto) as EnableMonitorGroupDto;
      } catch {
        dto = {};
      }
    }
    return this.monitorService.enableGroup(id, dto as EnableMonitorGroupDto);
  }

  @MessagePattern('viber.messages.monitor.disable_group')
  disableGroup(@Payload() data: { id: number }): MonitorStatusDto {
    const id = Number(data.id);
    return this.monitorService.disableGroup(id);
  }

  @MessagePattern('viber.messages.get_monitored')
  getMonitoredMessages(
    @Payload() query: MonitoredMessagesFilterDto = {},
  ): MonitoredMessageDto[] {
    return this.monitorService.getMonitoredMessages(query ?? {});
  }

  @MessagePattern('viber.messages.export')
  exportMonitoredMessages(
    @Payload() query: ExportMonitoredMessagesDto = {},
  ): { filename: string; mime: string; body: string; savedPath: string } {
    return this.monitorService.exportMessages(query ?? {});
  }
}
