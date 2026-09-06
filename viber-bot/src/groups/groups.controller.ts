import { Controller, Get, Inject, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GroupsService } from './groups.service.js';
import { GroupDetailDto, GroupSummaryDto } from './dto/group-response.dto.js';
import { ParticipantDto } from '../participants/dto/participant-response.dto.js';

@ApiTags('groups')
@Controller('api/groups')
export class GroupsController {
  constructor(@Inject(GroupsService) private readonly groupsService: GroupsService) {}

  @Get()
  @ApiOperation({ summary: 'Получить список групп и чатов, представленных в Viber' })
  @ApiQuery({
    name: 'all',
    required: false,
    type: Boolean,
    description: 'Включить личные чаты (1-to-1). По умолчанию false (только группы и сообщества)',
  })
  @ApiResponse({ status: 200, type: [GroupSummaryDto] })
  async getGroups(@Query('all') all?: string): Promise<GroupSummaryDto[]> {
    const includeAll = all === 'true' || all === '1';
    return this.groupsService.getGroups(includeAll);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить подробную информацию о группе по её ID' })
  @ApiParam({ name: 'id', description: 'ID беседы (row ID)' })
  @ApiResponse({ status: 200, type: GroupDetailDto })
  @ApiResponse({ status: 404, description: 'Группа не найдена' })
  async getGroup(@Param('id', ParseIntPipe) id: number): Promise<GroupDetailDto> {
    return this.groupsService.getGroup(id);
  }

  @Get(':id/participants')
  @ApiOperation({ summary: 'Получить текущий список участников группы из базы данных' })
  @ApiParam({ name: 'id', description: 'ID беседы (row ID)' })
  @ApiResponse({ status: 200, description: 'Массив участников', type: [ParticipantDto] })
  @ApiResponse({ status: 404, description: 'Группа не найдена' })
  async getGroupParticipants(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ParticipantDto[]> {
    return this.groupsService.getGroupParticipants(id);
  }
}
