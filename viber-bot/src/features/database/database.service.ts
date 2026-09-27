import { ConflictException, Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { openDevice } from '../../platform/context.js';
import { loadViberConfig } from '../../config/env.js';
import {
  fetchParticipantsInfo,
  generateUpdateSql,
  transformParticipantInfo,
  type RawParticipantInfo,
  type TransformedParticipant,
} from '../../viber/participants-sql.js';
import type { DatabaseStatsDto, SyncResultDto } from './dto/database-stats.dto.js';
import type { DecodedItemDto, DecodeRequestDto, DecodeResultDto } from './dto/decode.dto.js';
import { ViberLifecycleService } from '../../platform/viber-lifecycle.service.js';
import { DeviceMutexService } from '../../platform/mutex/device-mutex.service.js';
import { restartViberApp } from '../../platform/restart-viber.js';

@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(
    @Optional() @Inject(ViberLifecycleService) private readonly viberLifecycle?: ViberLifecycleService,
    @Optional() @Inject(DeviceMutexService) private readonly deviceMutex?: DeviceMutexService,
  ) {}

  /**
   * Refreshes the local SQLite snapshot from the live emulator database.
   */
  async syncLiveDatabase(): Promise<SyncResultDto> {
    this.logger.log('Syncing database snapshot with live emulator...');
    const context = await openDevice();
    context.db.refresh();

    const stats = await this.getDatabaseStats();
    return {
      success: true,
      message: 'Локальный снимок базы данных успешно обновлен с боевого эмулятора',
      timestamp: new Date().toISOString(),
      stats,
    };
  }

  /**
   * Computes statistics for conversations, participants, and undecoded records.
   */
  async getDatabaseStats(): Promise<DatabaseStatsDto> {
    try {
      const context = await openDevice({ ensureUp: false });
      const conversations = context.viber.conversations();
      const allParticipants = fetchParticipantsInfo(context.db);

      let messagesCount = 0;
      for (const c of conversations) {
        messagesCount += c.messageCount;
      }

      const undecodedCount = allParticipants.filter((r) => this.isUndecoded(r)).length;

      return {
        conversationsCount: conversations.length,
        participantsCount: allParticipants.length,
        undecodedParticipantsCount: undecodedCount,
        messagesCount,
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        error instanceof Error
          ? error.message
          : 'Эмулятор недоступен. Запустите LDPlayer с включённой ADB-отладкой.',
      );
    }
  }

  /**
   * Decodes undecoded participant rows from encrypted_member_id and updates live DB.
   */
  async decodeParticipants(dto: DecodeRequestDto = {}): Promise<DecodeResultDto> {
    const dryRun = dto.dryRun ?? false;
    const shouldRestart = (dto.restartApp ?? true) && !dryRun;
    const waitSeconds = dto.waitForSyncSeconds ?? 10;
    this.logger.log(`Starting participant decryption (dryRun: ${String(dryRun)}, restartApp: ${String(shouldRestart)})...`);

    const lockId = `db_decode_${Date.now()}`;
    if (shouldRestart && this.deviceMutex) {
      const locked = this.deviceMutex.tryLock(lockId);
      if (!locked) {
        const lockInfo = this.deviceMutex.getLockInfo();
        throw new ConflictException(
          `Эмулятор в данный момент занят задачей "${String(lockInfo?.taskId)}". Дождитесь её завершения.`,
        );
      }
    }

    try {
      const context = await openDevice();
      const allRows = fetchParticipantsInfo(context.db);

      const rowsToDecode = allRows.filter((r) => this.isUndecoded(r));
      const invalidRows: Array<{ id: number; error: string }> = [];
      const transformed: TransformedParticipant[] = [];

      for (const row of rowsToDecode) {
        const result = transformParticipantInfo(row, { includeSelf: false }, (err, r) => {
          invalidRows.push({ id: r.id, error: err.message });
        });
        if (result !== null) {
          transformed.push(result);
        }
      }

      let recordsToApply = transformed;
      if (dto.limit !== undefined && dto.limit > 0 && dto.limit < transformed.length) {
        recordsToApply = transformed.slice(0, dto.limit);
      }

      if (!dryRun && recordsToApply.length > 0) {
        this.logger.log(`Applying updates for ${String(recordsToApply.length)} participants to live DB...`);
        const updateSql = generateUpdateSql(recordsToApply);
        context.db.updateLive(updateSql, { restartApp: false, forceStop: true });
      }

      let restarted = false;
      // Restart Viber when records were applied or when caller explicitly requested restartApp: true
      if (shouldRestart && (recordsToApply.length > 0 || dto.restartApp === true)) {
        this.logger.log('Restarting Viber to flush SQLite WAL and trigger contact sync...');
        const viberConfig = loadViberConfig();
        if (this.viberLifecycle) {
          restarted = await this.viberLifecycle.restartApp(context.adb, viberConfig);
        } else {
          const restartResult = await restartViberApp(
            {
              shell: (cmd, opts) => context.adb.shell(cmd, opts),
              recover: (timeout) => context.adb.recover(timeout),
            },
            { appPackage: viberConfig.appPackage },
          );
          restarted = restartResult.started;
        }

        if (restarted && waitSeconds > 0) {
          this.logger.log(`Waiting ${String(waitSeconds)}s for Viber background network sync...`);
          await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
        }
      }

      // Refresh snapshot after updates and potential restart
      context.db.refresh();

      const sampleDecoded: DecodedItemDto[] = recordsToApply.slice(0, 10).map((r) => ({
        id: r.id,
        name: r.name,
        oldMemberId: r.oldMemberId,
        newMemberId: r.newMemberId,
      }));

      let message = dryRun
        ? `[Предпросмотр] Найдено ${String(recordsToApply.length)} записей для дешифровки. База не изменялась.`
        : `Успешно дешифровано и обновлено ${String(recordsToApply.length)} записей в базе данных Viber.`;

      if (restarted) {
        message += ` Приложение Viber успешно перезапущено для сетевой синхронизации данных.`;
      }

      return {
        success: true,
        message,
        dryRun,
        totalRows: allRows.length,
        undecodedFound: rowsToDecode.length,
        decodedCount: recordsToApply.length,
        errorsCount: invalidRows.length,
        sampleDecoded,
        restartedApp: restarted,
      };
    } finally {
      if (shouldRestart && this.deviceMutex) {
        this.deviceMutex.unlock(lockId);
      }
    }
  }

  /**
   * Checks whether a participant row has an encrypted member ID that hasn't been decoded into member_id.
   */
  private isUndecoded(row: RawParticipantInfo): boolean {
    if (row.id === 1 || row.participantType === 0) return false;
    const enc = row.encryptedMemberId?.trim();
    if (!enc) return false;

    const mid = row.memberId?.trim();
    const num = row.number?.trim();

    return (
      mid === enc ||
      (mid !== undefined && mid.startsWith('em:')) ||
      (num !== undefined && num.startsWith('em:'))
    );
  }
}
