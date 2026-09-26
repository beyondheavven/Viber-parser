import { Injectable, Logger } from '@nestjs/common';
import type { Sqlite } from '../../platform/sqlite.js';
import type { RosterMember } from './parse-pg-roster.js';
import {
  fetchParticipantsInfo,
  generateMatchingFieldsUpdateSql,
  generateRosterInsertSql,
} from '../../viber/participants-sql.js';

@Injectable()
export class ParticipantSyncService {
  private readonly logger = new Logger(ParticipantSyncService.name);

  /**
   * Applies the initial batch of parsed stream members into the live emulator database.
   */
  applyInitialSync(
    streamMembers: readonly RosterMember[],
    conversationId: number,
    db: Sqlite,
    appPackage: string,
  ): void {
    this.logger.log(
      `Generating initial SQL for ${String(streamMembers.length)} stream members...`,
    );

    const existingRows = fetchParticipantsInfo(db);
    const selfRow = existingRows.find((r) => r.id === 1 || r.participantType === 0);
    const existingUpdateSql = generateMatchingFieldsUpdateSql(existingRows);
    const insertSql = generateRosterInsertSql(streamMembers, conversationId, {
      selfEncryptedMemberId: selfRow?.encryptedMemberId,
      selfMemberId: selfRow?.memberId,
    });

    const selfCleanupSql = [
      `DELETE FROM participants WHERE participant_info_id IN (SELECT _id FROM participants_info WHERE _id != 1 AND (number LIKE '%48794034881%' OR encrypted_member_id = 'em:AQANrniLcl9lwBpvAAD45BjXack2KDDejNcNiXWX7KoogUod/74atmpL'));`,
      `DELETE FROM participants_info WHERE _id != 1 AND (number LIKE '%48794034881%' OR encrypted_member_id = 'em:AQANrniLcl9lwBpvAAD45BjXack2KDDejNcNiXWX7KoogUod/74atmpL');`,
      `UPDATE participants_info SET member_id = 'Da54i3JfZcA=', encrypted_member_id = 'em:AQANrniLcl9lwBpvAAD45BjXack2KDDejNcNiXWX7KoogUod/74atmpL', number = '+48794034881', participant_type = 0, safe_contact = 0, display_name = 'Milena', viber_name = 'Milena', contact_name = 'Milena' WHERE _id = 1;`,
      `UPDATE participants SET active = 0, alias_name = 'Milena' WHERE participant_info_id = 1 AND conversation_id = ${String(conversationId)};`,
      `DELETE FROM participants WHERE participant_info_id = 1 AND conversation_id = ${String(conversationId)} AND _id NOT IN (SELECT min(_id) FROM participants WHERE participant_info_id = 1 AND conversation_id = ${String(conversationId)});`,
      `UPDATE participants_info SET contact_name = coalesce(display_name, viber_name) WHERE _id != 1 AND (contact_name IS NULL OR length(contact_name) = 0) AND coalesce(display_name, viber_name) IS NOT NULL;`,
    ].join('\n');

    const fullSql = [existingUpdateSql, insertSql, selfCleanupSql].filter(Boolean).join('\n');

    if (fullSql) {
      this.logger.log('Writing participants and self safeguard to live emulator DB...');
      db.updateLive(fullSql, {
        restartApp: false,
        forceStop: true,
        appPackage,
      });
    }
  }

  /**
   * Finalizes database records after Viber phone number sync:
   * Sets contact_name = display_name = viber_name, runs deduplication, and safeguards self account.
   */
  finalizeSyncAndDedup(
    streamMembers: readonly RosterMember[],
    conversationId: number,
    db: Sqlite,
    appPackage: string,
    restartApp: boolean = true,
  ): void {
    this.logger.log('Finalizing names and cleaning up duplicates on live DB...');

    const nameStatements: string[] = [];
    for (const m of streamMembers) {
      if (!m.name || m.name.trim() === '') continue;
      const name = m.name.trim().replace(/'/g, "''");
      const enc = m.emid.trim().replace(/'/g, "''");
      nameStatements.push(
        `UPDATE participants_info SET viber_name = '${name}', display_name = '${name}', contact_name = '${name}' ` +
          `WHERE encrypted_member_id = '${enc}' AND _id != 1 AND coalesce(participant_type, 1) != 0;`,
      );
    }

    // Every clause below keys on `member_id`, so it must first be a real id.
    // Without this guard each row carrying an empty or placeholder member_id
    // counts as the same person, and the deletes below collapse all of them
    // into one row — irreversibly, in the live database.
    const REAL_MEMBER_ID = "member_id IS NOT NULL AND length(member_id) > 0";

    const dedupStatements = [
      `UPDATE participants SET participant_info_id = (SELECT min(pi2._id) FROM participants_info pi2 WHERE pi2.member_id = (SELECT pi3.member_id FROM participants_info pi3 WHERE pi3._id = participants.participant_info_id)) WHERE participant_info_id IN (SELECT _id FROM participants_info pi WHERE pi.${REAL_MEMBER_ID} AND _id > (SELECT min(_id) FROM participants_info pi_min WHERE pi_min.member_id = pi.member_id));`,
      `DELETE FROM participants WHERE _id NOT IN (SELECT min(_id) FROM participants GROUP BY conversation_id, participant_info_id);`,
      `DELETE FROM participants_info WHERE _id IN (SELECT pi._id FROM participants_info pi WHERE pi.${REAL_MEMBER_ID} AND pi._id > (SELECT min(pi_min._id) FROM participants_info pi_min WHERE pi_min.member_id = pi.member_id) AND pi._id != 1);`,
      `UPDATE participants_info SET contact_name = coalesce(display_name, viber_name) WHERE _id != 1 AND (contact_name IS NULL OR length(contact_name) = 0) AND coalesce(display_name, viber_name) IS NOT NULL;`,
      `UPDATE participants_info SET contact_name = 'Milena', display_name = 'Milena', viber_name = 'Milena', participant_type = 0 WHERE _id = 1;`,
      `UPDATE participants SET active = 0, alias_name = 'Milena' WHERE participant_info_id = 1 AND conversation_id = ${String(conversationId)};`,
    ];

    const postSyncSql = [...nameStatements, ...dedupStatements].join('\n');
    if (postSyncSql) {
      db.updateLive(postSyncSql, { restartApp, forceStop: true, appPackage });
    }
  }
}
