import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractEmKey } from '../../viber/em-key.js';
import { normalizePhoneNumber } from './phone-extractor.util.js';

@Injectable()
export class ContactEnrichmentService implements OnModuleInit {
  private readonly logger = new Logger(ContactEnrichmentService.name);
  private readonly phoneByMemberId = new Map<string, string>();
  private readonly phoneByName = new Map<string, string>();
  private readonly ambiguousNames = new Set<string>();

  onModuleInit(): void {
    this.warmup(process.env['MONITOR_DATA_DIR'] ?? join(process.cwd(), 'data'));
  }

  warmup(dataDir: string): void {
    const rostersDir = join(dataDir, 'rosters');
    if (existsSync(rostersDir)) {
      try {
        for (const file of readdirSync(rostersDir)) {
          if (!file.endsWith('.json') || file.includes('-emids')) continue;
          try {
            const parsed = JSON.parse(readFileSync(join(rostersDir, file), 'utf8')) as unknown;
            const participants = Array.isArray(parsed)
              ? parsed
              : (parsed as { participants?: unknown } | null)?.participants;
            if (!Array.isArray(participants)) continue;
            for (const value of participants) {
              const participant = value as Record<string, unknown>;
              this.learn(
                typeof participant['memberId'] === 'string' ? participant['memberId'] : null,
                this.firstString(
                  participant['name'],
                  participant['displayName'],
                  participant['viberName'],
                  participant['contactName'],
                ),
                typeof participant['number'] === 'string' ? participant['number'] : null,
              );
            }
          } catch (error) {
            this.logger.debug(`Could not parse roster file ${file}: ${String(error)}`);
          }
        }
      } catch (error) {
        this.logger.warn(`Could not read rosters dir ${rostersDir}: ${String(error)}`);
      }
    }

    for (const path of [join(dataDir, 'monitored-messages.jsonl'), join(dataDir, 'messages.jsonl')]) {
      if (!existsSync(path)) continue;
      try {
        for (const line of readFileSync(path, 'utf8').split('\n')) {
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line) as Record<string, unknown>;
            const phone =
              message['phoneSource'] === 'viber_profile' && message['hasPhoneInText'] !== true
                ? message['attachedPhone']
                : null;
            this.learn(
              typeof message['senderMemberId'] === 'string' ? message['senderMemberId'] : null,
              this.firstString(message['senderName'], message['sender']),
              typeof phone === 'string' ? phone : null,
            );
          } catch {
            // Ignore a malformed JSONL record; the remaining cache is still useful.
          }
        }
      } catch (error) {
        this.logger.debug(`Could not read messages file ${path}: ${String(error)}`);
      }
    }
  }

  learn(
    memberId: string | null | undefined,
    name: string | null | undefined,
    rawPhone: string | null | undefined,
  ): void {
    if (!rawPhone || rawPhone.trim().startsWith('em:')) return;
    const phone = normalizePhoneNumber(rawPhone.trim());
    if (!phone) return;

    const mid = memberId?.trim();
    if (mid) {
      const decoded = this.decodeMemberId(mid);
      this.phoneByMemberId.set(decoded, phone);
      if (decoded !== mid) this.phoneByMemberId.set(mid, phone);
    }

    const normalizedName = name?.trim().toLowerCase();
    if (!normalizedName) return;
    const existing = this.phoneByName.get(normalizedName);
    if (existing && existing !== phone) {
      this.phoneByName.delete(normalizedName);
      this.ambiguousNames.add(normalizedName);
    } else if (!this.ambiguousNames.has(normalizedName)) {
      this.phoneByName.set(normalizedName, phone);
    }
  }

  lookup(memberId?: string | null, name?: string | null): string | null {
    const mid = memberId?.trim();
    if (mid) {
      return this.phoneByMemberId.get(this.decodeMemberId(mid)) ?? this.phoneByMemberId.get(mid) ?? null;
    }
    const normalizedName = name?.trim().toLowerCase();
    return normalizedName ? this.phoneByName.get(normalizedName) ?? null : null;
  }

  private decodeMemberId(memberId: string): string {
    if (!memberId.startsWith('em:')) return memberId;
    try {
      return extractEmKey(memberId);
    } catch {
      return memberId;
    }
  }

  private firstString(...values: unknown[]): string | null {
    return values.find((value): value is string => typeof value === 'string') ?? null;
  }
}
