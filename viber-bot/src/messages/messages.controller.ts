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
import { ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
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

@ApiTags('messages')
@Controller('api/messages')
export class MessagesController {
  constructor(
    @Inject(MessagesMonitorService) private readonly monitorService: MessagesMonitorService,
  ) {}

  @Post('monitor/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Запустить фоновый мониторинг включённых групп (сообщения ловятся в момент записи в Viber)' })
  @ApiResponse({ status: 200, type: MonitorStatusDto })
  async startMonitoring(@Body() dto: StartMonitorDto): Promise<MonitorStatusDto> {
    return this.monitorService.start(dto);
  }

  @Post('monitor/stop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Остановить фоновый опрос (курсоры групп сохраняются)' })
  @ApiResponse({ status: 200, type: MonitorStatusDto })
  stopMonitoring(): MonitorStatusDto {
    return this.monitorService.stop();
  }

  @Get('monitor/status')
  @ApiOperation({ summary: 'Получить текущий статус монитора, список групп и счетчики' })
  @ApiResponse({ status: 200, type: MonitorStatusDto })
  getStatus(): MonitorStatusDto {
    return this.monitorService.getStatus();
  }

  @Get('monitor/groups')
  @ApiOperation({ summary: 'Список групп на мониторинге с флагом enabled и курсором catch-up' })
  @ApiResponse({ status: 200, type: [MonitoredGroupDto] })
  getMonitoredGroups(): MonitoredGroupDto[] {
    return this.monitorService.getGroups();
  }

  @Post('monitor/groups/:id/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Включить мониторинг конкретной группы. После рестарта эмулятора сообщения догоняются с сохранённого курсора.',
  })
  @ApiParam({ name: 'id', description: 'ID беседы (row ID)' })
  @ApiResponse({ status: 200, type: MonitorStatusDto })
  @ApiResponse({ status: 404, description: 'Группа не найдена' })
  async enableGroup(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EnableMonitorGroupDto = {},
  ): Promise<MonitorStatusDto> {
    return this.monitorService.enableGroup(id, dto ?? {});
  }

  @Post('monitor/groups/:id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Выключить мониторинг группы. Курсор сохраняется для следующего включения.' })
  @ApiParam({ name: 'id', description: 'ID беседы (row ID)' })
  @ApiResponse({ status: 200, type: MonitorStatusDto })
  @ApiResponse({ status: 404, description: 'Группа не стоит на мониторинге' })
  disableGroup(@Param('id', ParseIntPipe) id: number): MonitorStatusDto {
    return this.monitorService.disableGroup(id);
  }

  @Get('monitored')
  @ApiOperation({ summary: 'Получить список обработанных сообщений с фильтрацией и пагинацией' })
  @ApiResponse({ status: 200, type: [MonitoredMessageDto] })
  getMonitoredMessages(@Query() query: MonitoredMessagesFilterDto): MonitoredMessageDto[] {
    return this.monitorService.getMonitoredMessages(query);
  }

  @Get('monitored/export')
  @ApiOperation({ summary: 'Скачать обработанные сообщения (json, jsonl или csv). Копия пишется в data/exports.' })
  @ApiProduces('application/json', 'text/csv', 'application/x-ndjson')
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
  @ApiOperation({ summary: 'Подключиться к потоку новоприходящих сообщений (Server-Sent Events)' })
  @ApiProduces('text/event-stream')
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
