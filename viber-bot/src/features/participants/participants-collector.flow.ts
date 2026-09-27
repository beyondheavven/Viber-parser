import { Inject, Injectable, Logger } from '@nestjs/common';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDevice, type DeviceContext } from '../../platform/context.js';
import { loadViberConfig } from '../../config/env.js';
import { parsePgRoster } from './parse-pg-roster.js';
import { extractEmKey } from '../../viber/em-key.js';
import { formatParticipantCsv, formatParticipantTable } from '../../viber/format.js';
import { deduplicateParticipants, resolveGroupExact, type Participant } from '../../viber/repository.js';
import { DeviceMutexService } from '../../platform/mutex/device-mutex.service.js';
import { FridaStreamService, type FridaPagingResult } from './frida-stream.service.js';
import { ViberNavigationService } from '../../viber/navigation.js';
import { ParticipantSyncService } from './participant-sync.service.js';
import { ViberLifecycleService } from '../../platform/viber-lifecycle.service.js';
import { OnlineStatusService } from './online-status.service.js';
import type { TaskEntity } from '../tasks/entities/task.entity.js';
import type { CollectParticipantsDto } from './dto/collect-participants.dto.js';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface CollectionResult {
  group: string;
  conversationId: number;
  groupId: string;
  headerTotal: number | null;
  pagesCount: number;
  participantsCount: number;
  participantsWithPhone: number;
  savedJsonPath: string;
  savedTxtPath: string;
  savedCsvPath: string;
  participants: Participant[];
}

@Injectable()
export class ParticipantsCollectorFlow {
  private readonly logger = new Logger(ParticipantsCollectorFlow.name);

  constructor(
    @Inject(DeviceMutexService) private readonly deviceMutex: DeviceMutexService,
    @Inject(FridaStreamService) private readonly fridaStream: FridaStreamService,
    @Inject(OnlineStatusService) private readonly onlineStatusService: OnlineStatusService,
    @Inject(ViberNavigationService) private readonly viberNavigation: ViberNavigationService,
    @Inject(ParticipantSyncService) private readonly participantSync: ParticipantSyncService,
    @Inject(ViberLifecycleService) private readonly viberLifecycle: ViberLifecycleService,
  ) {}

  /**
   * Rows currently linked to the conversation in the live database — the
   * number that shows whether the stream actually landed in SQLite.
   */
  private countLinkedParticipants(context: DeviceContext, conversationId: number): number {
    try {
      return context.db.count(
        `select count(*) from participants where conversation_id = ${String(conversationId)}`,
      );
    } catch (err) {
      this.logger.warn(`Could not count linked participants: ${String(err)}`);
      return -1;
    }
  }

  /**
   * Orchestrates the complete participant collection flow with real-time state tracking and AbortSignal support.
   */
  async execute(
    task: TaskEntity,
    dto: CollectParticipantsDto,
    customDeviceContext?: DeviceContext,
  ): Promise<void> {
    const signal = task.signal;
    const viberConfig = loadViberConfig();

    try {
      if (signal.aborted) {
        task.stop();
        return;
      }

      // 1. Resolve Group
      task.setStep('resolving_group', 'Определение параметров группы и ID беседы в SQLite');
      const context = customDeviceContext ?? (await openDevice());

      const groupTarget = dto.group;
      const group =
        resolveGroupExact(context.viber.groups(), groupTarget) ??
        context.viber.findGroup(groupTarget);

      if (!group) {
        throw new Error(
          `Группа "${groupTarget.trim()}" не найдена в базе данных. Проверьте имя или ID беседы.`,
        );
      }

      if (group.name === null) {
        throw new Error(`У беседы с ID ${String(group.id)} отсутствует имя.`);
      }

      if (group.groupId === null || group.groupId.trim() === '') {
        throw new Error(`У беседы с ID ${String(group.id)} отсутствует group_id.`);
      }

      const groupName = group.name;
      const conversationId = group.id;
      const groupId = group.groupId.trim();

      task.groupName = groupName;
      task.conversationId = conversationId;
      task.updateProgress({ groupName, conversationId, groupId });
      this.logger.log(`Target group resolved: "${groupName}" (ID ${String(conversationId)}, GroupID ${groupId})`);

      if (signal.aborted) {
        task.stop();
        return;
      }

      // 2. Attach Frida Agent FIRST
      task.setStep('attaching_frida', 'Подключение Frida к процессу com.viber.voip');
      const fridaAgent = await this.fridaStream.attachAgent(context.adb, signal);

      let pagingResult: FridaPagingResult | undefined;
      let headerTotal: number | null = null;
      const combinedRawPageJsons: string[] = [];
      let totalPagesCount = 0;
      let finalExpectedTotal: number | null = null;
      try {
        if (signal.aborted) {
          task.stop();
          return;
        }

        // 3. Navigation in Viber UI via Appium
        task.setStep('navigating_viber', 'Навигация в UI Viber к списку участников группы через Appium');
        const navResult = await this.viberNavigation.navigateToParticipants(groupName, signal);
        headerTotal = navResult.headerTotal;
        task.updateProgress({ headerTotal });

        if (signal.aborted) {
          task.stop();
          return;
        }

        // Wait for controller query readiness. A walk started before the
        // agent's hooks are live gets no reply to its first request and can
        // only end on the idle timeout.
        if (!(await fridaAgent.waitForQueryReady(10_000, signal))) {
          throw new Error(
            'Frida-агент не сообщил о готовности контроллера запросов за 10 секунд. ' +
              'Пагинация не запускалась.',
          );
        }

        // 4. Frida active stream pagination - Multi-pass (1..5 passes from 0)
        const totalPasses =
          typeof dto.passesCount === 'number' && dto.passesCount >= 1
            ? Math.min(Math.floor(dto.passesCount), 10)
            : dto.twoPass === false
              ? 1
              : 5;

        for (let pass = 1; pass <= totalPasses; pass += 1) {
          if (signal.aborted) break;

          task.setStep(
            'paging_participants',
            totalPasses > 1
              ? `Сбор страниц участников через Frida (Проход ${pass}/${totalPasses})...`
              : 'Сбор страниц участников через Frida без прокрутки экрана',
            {
              headerTotal,
              pagesCount: totalPagesCount,
            },
          );

          if (pass > 1) {
            await delay(1000);
          }

          try {
            const currentPassResult = await fridaAgent.runPaging(
              conversationId,
              groupId,
              {
                initialOffset: 0,
                idleTimeoutMs: dto.idleTimeoutMs,
                signal,
                onProgress: (p) => {
                  task.updateProgress({
                    currentPass: pass,
                    totalPasses,
                    pagesCount: totalPagesCount + p.pagesCount,
                    currentOffset: p.currentOffset,
                    pageSize: p.pageSize,
                    lastPage: p.lastPage,
                    streamTotal: p.headerTotal,
                  });
                },
              },
            );

            combinedRawPageJsons.push(...currentPassResult.rawPageJsons);
            totalPagesCount += currentPassResult.pagesCount;
            if (
              currentPassResult.expectedTotal &&
              (!finalExpectedTotal || currentPassResult.expectedTotal > finalExpectedTotal)
            ) {
              finalExpectedTotal = currentPassResult.expectedTotal;
            }
            if (!pagingResult || currentPassResult.lastReached) {
              pagingResult = currentPassResult;
            }
            this.logger.log(
              `Pass ${pass}/${totalPasses} finished — получено ${String(currentPassResult.pagesCount)} страниц (${String(currentPassResult.collectedMembers)} участников).`,
            );
          } catch (err) {
            this.logger.warn(`Pass ${pass}/${totalPasses} warning: ${String(err)}; proceeding with collected pages.`);
            if (!pagingResult) throw err;
          }
        }
      } finally {
        await fridaAgent.cleanup();
      }

      const collectedMembers = pagingResult?.collectedMembers ?? 0;
      const ignoredPages = pagingResult?.ignoredPages ?? 0;
      const queryErrors = pagingResult?.queryErrors ?? [];
      const pagingSummary =
        `страниц ${String(totalPagesCount)}, участников ${String(collectedMembers)}` +
        (finalExpectedTotal === null
          ? ' (последняя страница не пришла)'
          : ` из ${String(finalExpectedTotal)}`) +
        (ignoredPages > 0
          ? `, отброшено чужих ответов ${String(ignoredPages)}`
          : '') +
        (queryErrors.length > 0
          ? `, ошибки агента: ${queryErrors.join('; ')}`
          : '');
      this.logger.log(`Paging finished — ${pagingSummary}.`);
      task.updateProgress({
        pagesCount: totalPagesCount,
        streamMembers: collectedMembers,
        streamTotal: finalExpectedTotal ?? pagingResult?.headerTotal ?? null,
        ignoredPages,
      });

      if (!dto.allowPartial && !pagingResult?.lastReached) {
        throw new Error(
          `Пагинация не завершилась: ${pagingSummary}. ` +
            'Для сохранения неполного списка передайте allowPartial: true.',
        );
      }

      if (signal.aborted) {
        task.stop();
        return;
      }

      // 4. Initial live DB update
      task.setStep('syncing_live_db', 'Запись полученных участников и связей в рабочую базу данных эмулятора');
      const streamMembers = parsePgRoster(combinedRawPageJsons);
      this.logger.log(
        `Parsed ${String(streamMembers.length)} members from ${String(totalPagesCount)} pages across passes.`,
      );
      task.updateProgress({ parsedMembers: streamMembers.length });

      this.participantSync.applyInitialSync(
        streamMembers,
        conversationId,
        context.db,
        viberConfig.appPackage,
      );

      const linkedAfterSync = this.countLinkedParticipants(context, conversationId);
      this.logger.log(`Live DB holds ${String(linkedAfterSync)} participants after the initial sync.`);
      task.updateProgress({ linkedAfterSync });

      if (signal.aborted) {
        task.stop();
        return;
      }

      // 5. Restart Viber
      const shouldRestart = dto.restartApp ?? true;
      if (shouldRestart) {
        task.setStep('restarting_viber', 'Перезапуск Viber для сброса WAL и сетевой синхронизации телефонов');
        await this.viberLifecycle.restartApp(context.adb, viberConfig, signal);

        if (signal.aborted) {
          task.stop();
          return;
        }

        // 6. Wait for Viber phone numbers sync
        task.setStep('waiting_numbers_sync', 'Ожидание сетевой синхронизации телефонных номеров клиентом Viber');
        await this.viberLifecycle.waitForPhoneNumbersSync(
          context.adb,
          viberConfig,
          conversationId,
          dto.numbersSyncTimeoutMs ?? 45_000,
          signal,
          (syncStatus) => {
            task.updateProgress({
              syncedPhoneNumbers: syncStatus.syncedCount,
              stable: syncStatus.stable,
            });
          },
        );

        if (signal.aborted) {
          task.stop();
          return;
        }

        // 7. Deduplicate and finalize names
        task.setStep(
          'deduplicating_and_finalizing',
          'Снятие снимка базы, сопоставление имён и дедупликация участников',
        );
        if (dto.syncLiveDbAfter === true) {
          this.participantSync.finalizeSyncAndDedup(
            streamMembers,
            conversationId,
            context.db,
            viberConfig.appPackage,
            shouldRestart,
          );
        }
      }

      if (signal.aborted) {
        task.stop();
        return;
      }

      // 8. Refresh snapshot, build result files and finish
      task.setStep('exporting_results', 'Формирование отчёта и экспорт в TXT и JSON файлы');
      context.db.refresh();
      const rawParticipants = context.viber.participants(conversationId);
      this.logger.log(`Read back ${String(rawParticipants.length)} participants from the snapshot.`);
      task.updateProgress({ readBack: rawParticipants.length });

      // Supplement any names from stream members if needed
      const streamMap = new Map<string, string>();
      for (const m of streamMembers) {
        if (m.name && m.name.trim().length > 0) {
          try {
            const key = extractEmKey(m.emid.trim());
            streamMap.set(key, m.name.trim());
          } catch {
            streamMap.set(m.emid.trim(), m.name.trim());
          }
        }
      }

      for (const p of rawParticipants) {
        if (!p.name || p.name.trim() === '') {
          const mid = p.memberId?.trim();
          if (mid && streamMap.has(mid)) {
            p.name = streamMap.get(mid)!;
          }
        }
      }

      // Deduplicate participants in memory by memberId and normalized phone number
      const participants = deduplicateParticipants(rawParticipants);
      if (participants.length !== rawParticipants.length) {
        this.logger.log(
          `Dedup merged ${String(rawParticipants.length - participants.length)} of ` +
            `${String(rawParticipants.length)} rows.`,
        );
      }
      task.updateProgress({ afterDedup: participants.length });
      // Safeguard self account
      const selfParticipant = participants.find(
        (p) => p.id === 1 || (p.number !== null && p.number.includes('48794034881')),
      );
      if (selfParticipant) {
        selfParticipant.name = 'Milena';
        selfParticipant.isSelf = true;
      }

      if (signal.aborted) {
        task.stop();
        return;
      }

      // 8. Fetch online activity (Last Seen & Online status)
      const shouldFetchOnline = dto.fetchOnlineStatus ?? true;
      if (shouldFetchOnline) {
        const memberIdsToQuery = participants
          .map((p) => p.memberId)
          .filter(
            (id): id is string => typeof id === 'string' && id.trim().length > 0 && !id.startsWith('em:'),
          );

        if (memberIdsToQuery.length > 0) {
          task.setStep(
            'fetching_online_activity',
            'Сбор последней активности участников (В сети / Дата последнего посещения) через Frida',
            { total: memberIdsToQuery.length, completed: 0 },
          );

          try {
            const onlineMap = await this.onlineStatusService.fetchOnlineStatuses(
              context.adb,
              memberIdsToQuery,
              {
                signal,
                onProgress: (done, total) => {
                  task.updateProgress({
                    onlineChecked: done,
                    onlineTotal: total,
                  });
                },
              },
            );

            for (const p of participants) {
              if (p.memberId && onlineMap.has(p.memberId)) {
                const status = onlineMap.get(p.memberId)!;
                p.isOnline = status.isOnline;
                p.lastSeen = status.lastSeen;
              } else {
                p.isOnline = false;
                p.lastSeen = null;
              }
            }
          } catch (err) {
            this.logger.warn(
              `Failed to fetch online statuses: ${String(err)}. Continuing without activity data.`,
            );
          }
        }
      }

      if (signal.aborted) {
        task.stop();
        return;
      }

      // 9. Build result files and finish
      task.setStep('exporting_results', 'Формирование отчёта и экспорт в TXT, CSV и JSON файлы');
      const outDir = join(process.cwd(), 'data', 'rosters');
      mkdirSync(outDir, { recursive: true });
      const jsonPath = join(outDir, `${String(conversationId)}-full.json`);
      const txtPath = join(outDir, `${String(conversationId)}-full.txt`);
      const csvPath = join(outDir, `${String(conversationId)}-full.csv`);

      const jsonPayload = {
        group: groupName,
        conversationId,
        groupId,
        headerTotal,
        paginationCompleted: pagingResult?.lastReached ?? false,
        pagesCount: pagingResult?.pagesCount ?? totalPagesCount,
        participantsCount: participants.length,
        extractedAt: new Date().toISOString(),
        participants,
      };
      writeFileSync(jsonPath, JSON.stringify(jsonPayload, null, 2), 'utf8');

      const txtLines: string[] = [
        `${groupName} — ${String(participants.length)} participants synced`,
        `conversation ${String(conversationId)} · pages ${String(pagingResult?.pagesCount ?? totalPagesCount)} · pagination ${(pagingResult?.lastReached ?? false) ? 'COMPLETED' : 'PARTIAL'}`,
        '',
        formatParticipantTable(participants),
      ];
      writeFileSync(txtPath, txtLines.join('\n'), 'utf8');
      writeFileSync(csvPath, formatParticipantCsv(participants), 'utf8');

      const participantsWithPhone = participants.filter((p) => p.number && p.number.length > 0).length;

      const result: CollectionResult = {
        group: groupName,
        conversationId,
        groupId,
        headerTotal,
        pagesCount: pagingResult?.pagesCount ?? totalPagesCount,
        participantsCount: participants.length,
        participantsWithPhone,
        savedJsonPath: jsonPath,
        savedTxtPath: txtPath,
        savedCsvPath: csvPath,
        participants,
      };

      task.complete({
        group: result.group,
        conversationId: result.conversationId,
        groupId: result.groupId,
        headerTotal: result.headerTotal,
        pagesCount: result.pagesCount,
        participantsCount: result.participantsCount,
        participantsWithPhone: result.participantsWithPhone,
        savedJsonPath: result.savedJsonPath,
        savedTxtPath: result.savedTxtPath,
        savedCsvPath: result.savedCsvPath,
      });

      this.logger.log(
        `Task ${task.id} completed successfully! Collected ${String(participants.length)} participants.`,
      );
    } catch (err: unknown) {
      if (signal.aborted) {
        this.logger.warn(`Task ${task.id} was aborted.`);
        task.stop();
      } else {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Task ${task.id} failed: ${message}`);
        task.fail(message);
      }
    } finally {
      this.deviceMutex.unlock(task.id);
    }
  }
}
