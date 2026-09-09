import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { MessagesMonitorService } from './messages-monitor.service.js';
import {
  EnableMonitorGroupDto,
  MonitorStatusDto,
  MonitoredGroupDto,
  StartMonitorDto,
} from './dto/monitor-control.dto.js';
import {
  ExportMonitoredMessagesDto,
  MonitoredMessageDto,
  MonitoredMessagesFilterDto,
} from './dto/monitored-message.dto.js';

@Controller('api/messages')
export class MessagesController {
  constructor(
    @Inject(MessagesMonitorService) private readonly monitorService: MessagesMonitorService,
  ) {}

  @Post('monitor/start')
  @HttpCode(HttpStatus.OK)
  async startMonitoring(@Body() dto: StartMonitorDto): Promise<MonitorStatusDto> {
    return this.monitorService.start(dto);
  }

  @Post('monitor/stop')
  @HttpCode(HttpStatus.OK)
  stopMonitoring(): MonitorStatusDto {
    return this.monitorService.stop();
  }

  @Get('monitor/status')
  getStatus(): MonitorStatusDto {
    return this.monitorService.getStatus();
  }

  @Get('monitor/groups')
  getMonitoredGroups(): MonitoredGroupDto[] {
    return this.monitorService.getGroups();
  }

  @Post('monitor/groups/:id/enable')
  @HttpCode(HttpStatus.OK)
  async enableGroup(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EnableMonitorGroupDto = {},
  ): Promise<MonitorStatusDto> {
    return this.monitorService.enableGroup(id, dto ?? {});
  }

  @Post('monitor/groups/:id/disable')
  @HttpCode(HttpStatus.OK)
  disableGroup(@Param('id', ParseIntPipe) id: number): MonitorStatusDto {
    return this.monitorService.disableGroup(id);
  }

  @Get('monitored')
  getMonitoredMessages(@Query() query: MonitoredMessagesFilterDto): MonitoredMessageDto[] {
    return this.monitorService.getMonitoredMessages(query);
  }

  @Get('monitored/export')
  @Header('Cache-Control', 'no-store')
  exportMonitoredMessages(@Query() query: ExportMonitoredMessagesDto): StreamableFile {
    const exported = this.monitorService.exportMessages(query);
    return new StreamableFile(Buffer.from(exported.body, 'utf8'), {
      type: exported.mime,
      disposition: `attachment; filename="${exported.filename}"`,
    });
  }

  @Get('monitor/events')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no')
  streamIncomingMessages(@Res() res: Response): void {
    res.flushHeaders();
    res.write(':\n\n');

    const sub = this.monitorService.getMessageStream().subscribe({
      next: (message) => {
        res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
      },
    });
    const ping = setInterval(() => {
      res.write('event: ping\ndata: {"type":"ping"}\n\n');
    }, 15_000);

    res.on('close', () => {
      clearInterval(ping);
      sub.unsubscribe();
    });
  }
}
