import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { openDevice, type DeviceContext } from '../context.js';
import { deduplicateParticipants, type Participant } from '../viber/repository.js';
import type { GroupDetailDto, GroupSummaryDto } from './dto/group-response.dto.js';

interface RosterExport {
  participants?: unknown;
}

function rosterParticipants(raw: string): Participant[] {
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) return parsed as Participant[];
  if (typeof parsed !== 'object' || parsed === null) return [];

  const participants = (parsed as RosterExport).participants;
  return Array.isArray(participants) ? (participants as Participant[]) : [];
}

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  /**
   * Reads from the device if it is already up. GET handlers must not boot
   * LDPlayer — `ld.up()` waits up to three minutes and freezes the API via spawnSync.
   */
  private async requireDevice(): Promise<DeviceContext> {
    try {
      return await openDevice({ ensureUp: false });
    } catch (error) {
      throw new ServiceUnavailableException(
        error instanceof Error
          ? error.message
          : 'Эмулятор недоступен. Запустите LDPlayer с включённой ADB-отладкой.',
      );
    }
  }

  /**
   * Returns list of conversations (groups, communities, and optionally 1-to-1).
   */
  async getGroups(includeAll = false): Promise<GroupSummaryDto[]> {
    const { viber } = await this.requireDevice();
    const conversations = includeAll ? viber.conversations() : viber.groups();

    return conversations.map((c) => ({
      id: c.id,
      type: c.conversationType,
      groupId: c.groupId,
      name: c.name ?? (c.conversationType === 0 ? '(1-to-1)' : '(без названия)'),
      messageCount: c.messageCount,
      participantCount: c.participantCount,
      unreadCount: c.unreadCount,
      lastMessageDate: c.lastMessageDate ? c.lastMessageDate.toISOString() : null,
    }));
  }

  /**
   * Returns detailed information about a single group.
   */
  async getGroup(id: number): Promise<GroupDetailDto> {
    const { viber } = await this.requireDevice();
    const group = viber.findGroup(String(id)) ?? viber.conversations().find((c) => c.id === id);

    if (!group) {
      throw new NotFoundException(`Группа/беседа с ID ${String(id)} не найдена`);
    }

    const participants = viber.participants(id);
    const sampleParticipants = participants.slice(0, 10).map((p) => ({
      id: p.id,
      name: p.name,
      number: p.number,
      roleLabel: p.roleLabel,
    }));

    return {
      id: group.id,
      type: group.conversationType,
      groupId: group.groupId,
      name: group.name ?? (group.conversationType === 0 ? '(1-to-1)' : '(без названия)'),
      messageCount: group.messageCount,
      participantCount: group.participantCount,
      unreadCount: group.unreadCount,
      lastMessageDate: group.lastMessageDate ? group.lastMessageDate.toISOString() : null,
      sampleParticipants,
    };
  }

  /**
   * Returns participants of a group directly from the local SQLite snapshot,
   * enriched with latest online activity data from rosters if available.
   */
  async getGroupParticipants(id: number): Promise<Participant[]> {
    const { viber } = await this.requireDevice();
    const group = viber.findGroup(String(id)) ?? viber.conversations().find((c) => c.id === id);

    if (!group) {
      throw new NotFoundException(`Группа/беседа с ID ${String(id)} не найдена`);
    }

    const participants = viber.participants(id);

    // Enrich with online activity from latest roster JSON export if exists
    const rosterJsonPath = join(process.cwd(), 'data', 'rosters', `${String(id)}-full.json`);
    if (existsSync(rosterJsonPath)) {
      try {
        const raw = readFileSync(rosterJsonPath, 'utf-8');
        const roster = rosterParticipants(raw);
        const onlineMap = new Map<string, { isOnline?: boolean; lastSeen?: string | null }>();
        for (const r of roster) {
          if (r.memberId) {
            const entry: { isOnline?: boolean; lastSeen?: string | null } = {};
            if (typeof r.isOnline === 'boolean') entry.isOnline = r.isOnline;
            if (r.lastSeen !== undefined) entry.lastSeen = r.lastSeen;
            onlineMap.set(r.memberId, entry);
          }
        }
        for (const p of participants) {
          if (p.memberId && onlineMap.has(p.memberId)) {
            const status = onlineMap.get(p.memberId)!;
            if (status.isOnline !== undefined) p.isOnline = status.isOnline;
            if (status.lastSeen !== undefined) p.lastSeen = status.lastSeen;
          }
        }
      } catch (err) {
        this.logger.debug(`Could not read roster json for conversation ${String(id)}: ${String(err)}`);
      }
    }

    return deduplicateParticipants(participants);
  }
}
