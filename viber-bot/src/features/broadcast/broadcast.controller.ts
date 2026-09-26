import { Controller, Inject } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { BroadcastService } from './broadcast.service.js';
import type {
  BroadcastHistoryQueryDto,
  BroadcastStatusDto,
  CampaignDto,
  CreateCampaignDto,
  SendHistoryDto,
  UpdateCampaignDto,
} from './dto/broadcast.dto.js';

/** Payload shape for the patterns that address one campaign. */
interface CampaignIdDto {
  id: string;
}

interface UpdateCampaignPayload extends UpdateCampaignDto {
  id: string;
}

@Controller()
export class BroadcastController {
  constructor(@Inject(BroadcastService) private readonly broadcast: BroadcastService) {}

  @MessagePattern('viber.broadcast.status')
  getStatus(): BroadcastStatusDto {
    return this.broadcast.getStatus();
  }

  @MessagePattern('viber.broadcast.history')
  getHistory(@Payload() query: BroadcastHistoryQueryDto): SendHistoryDto[] {
    return this.broadcast.getHistory(query ?? {});
  }

  /** Last send into each chat — which campaign, which text, when. */
  @MessagePattern('viber.broadcast.history.last')
  getLastSends(): SendHistoryDto[] {
    return this.broadcast.getLastSends();
  }

  @MessagePattern('viber.broadcast.campaigns.list')
  listCampaigns(): CampaignDto[] {
    return this.broadcast.listCampaigns();
  }

  @MessagePattern('viber.broadcast.campaigns.get')
  getCampaign(@Payload() dto: CampaignIdDto): CampaignDto {
    return this.broadcast.getCampaign(dto.id);
  }

  @MessagePattern('viber.broadcast.campaigns.create')
  async createCampaign(@Payload() dto: CreateCampaignDto): Promise<CampaignDto> {
    return this.broadcast.createCampaign(dto);
  }

  @MessagePattern('viber.broadcast.campaigns.update')
  async updateCampaign(@Payload() dto: UpdateCampaignPayload): Promise<CampaignDto> {
    const { id, ...changes } = dto;
    return this.broadcast.updateCampaign(id, changes);
  }

  @MessagePattern('viber.broadcast.campaigns.delete')
  deleteCampaign(@Payload() dto: CampaignIdDto): { deleted: boolean } {
    this.broadcast.deleteCampaign(dto.id);
    return { deleted: true };
  }

  @MessagePattern('viber.broadcast.campaigns.start')
  async startCampaign(@Payload() dto: CampaignIdDto): Promise<CampaignDto> {
    return this.broadcast.startCampaign(dto.id);
  }

  @MessagePattern('viber.broadcast.campaigns.stop')
  async stopCampaign(@Payload() dto: CampaignIdDto): Promise<CampaignDto> {
    return this.broadcast.stopCampaign(dto.id);
  }
}
