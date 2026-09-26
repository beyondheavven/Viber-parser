import { Controller, Inject } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { GroupsService } from './groups.service.js';
import type { GroupDetailDto, GroupSummaryDto } from './dto/group-response.dto.js';
import type { ParticipantDto } from '../participants/dto/participant-response.dto.js';

@Controller()
export class GroupsController {
  constructor(@Inject(GroupsService) private readonly groupsService: GroupsService) {}

  @MessagePattern('viber.groups.get_all')
  async getGroups(@Payload() data?: { all?: boolean }): Promise<GroupSummaryDto[]> {
    const includeAll = Boolean(data?.all);
    return this.groupsService.getGroups(includeAll);
  }

  @MessagePattern('viber.groups.get_by_id')
  async getGroup(@Payload() data: { id: number }): Promise<GroupDetailDto> {
    return this.groupsService.getGroup(Number(data.id));
  }

  @MessagePattern('viber.groups.get_participants')
  async getGroupParticipants(
    @Payload() data: { id: number },
  ): Promise<ParticipantDto[]> {
    return this.groupsService.getGroupParticipants(Number(data.id));
  }
}
