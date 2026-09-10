import type { ColumnDef, Row, Sqlite } from '../device/sqlite.js';
import { selectList } from '../device/sqlite.js';
import { extractEmKey } from './em-key.js';
import { GROUP_ROLE } from './schema.js';
import type { RosterMember } from '../intercept/parse-pg-roster.js';

export interface RawParticipantInfo {
  id: number;
  memberId: string | null;
  encryptedMemberId: string | null;
  number: string | null;
  participantType: number | null;
  safeContact: number | null;
  contactName: string | null;
  displayName: string | null;
  viberName: string | null;
}

export interface TransformedParticipant {
  id: number;
  name: string | null;
  oldMemberId: string | null;
  newMemberId: string;
  encryptedMemberId: string;
  number: null;
  participantType: 1;
  safeContact: 0;
}

export const PARTICIPANT_INFO_COLUMNS: readonly ColumnDef[] = [
  { name: 'id', kind: 'int' },
  { name: 'memberId', kind: 'text' },
  { name: 'encryptedMemberId', kind: 'text' },
  { name: 'number', kind: 'text' },
  { name: 'participantType', kind: 'int' },
  { name: 'safeContact', kind: 'int' },
  { name: 'contactName', kind: 'text' },
  { name: 'displayName', kind: 'text' },
  { name: 'viberName', kind: 'text' },
];

export const PARTICIPANT_INFO_EXPRS: Readonly<Record<string, string>> = {
  id: '_id',
  memberId: 'member_id',
  encryptedMemberId: 'encrypted_member_id',
  number: 'number',
  participantType: 'participant_type',
  safeContact: 'safe_contact',
  contactName: 'contact_name',
  displayName: 'display_name',
  viberName: 'viber_name',
};

function text(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function num(row: Row, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' ? value : null;
}

function requireNum(row: Row, key: string): number {
  const value = num(row, key);
  if (value === null) throw new Error(`Expected a number in column "${key}".`);
  return value;
}

export function toRawParticipantInfo(row: Row): RawParticipantInfo {
  return {
    id: requireNum(row, 'id'),
    memberId: text(row, 'memberId'),
    encryptedMemberId: text(row, 'encryptedMemberId'),
    number: text(row, 'number'),
    participantType: num(row, 'participantType'),
    safeContact: num(row, 'safeContact'),
    contactName: text(row, 'contactName'),
    displayName: text(row, 'displayName'),
    viberName: text(row, 'viberName'),
  };
}

/** Fetches all rows from the participants_info table. */
export function fetchParticipantsInfo(db: Sqlite): RawParticipantInfo[] {
  const sql = `select ${selectList(PARTICIPANT_INFO_COLUMNS, PARTICIPANT_INFO_EXPRS)} from participants_info order by _id asc;`;
  return db.query(sql, PARTICIPANT_INFO_COLUMNS).map(toRawParticipantInfo);
}

export interface TransformOptions {
  includeSelf?: boolean;
}

/**
 * Transforms a single participants_info row if it has an encrypted_member_id.
 * Extracts the em key, sets number to null, participant_type to 1, and safe_contact to 0.
 * Skips self account (participant_type === 0) by default to avoid breaking Viber login.
 * Returns null if encrypted_member_id is missing, row is self account, or cannot be decoded.
 */
export function transformParticipantInfo(
  row: RawParticipantInfo,
  options?: TransformOptions,
  onError?: (error: Error, row: RawParticipantInfo) => void,
): TransformedParticipant | null {
  const enc = row.encryptedMemberId?.trim();
  if (!enc) return null;

  if (!options?.includeSelf && row.participantType === 0) {
    return null;
  }

  try {
    const decodedKey = extractEmKey(enc);
    const name = row.contactName ?? row.displayName ?? row.viberName;
    return {
      id: row.id,
      name: name && name.trim() !== '' ? name : null,
      oldMemberId: row.memberId,
      newMemberId: decodedKey,
      encryptedMemberId: enc,
      number: null,
      participantType: 1,
      safeContact: 0,
    };
  } catch (error) {
    if (onError && error instanceof Error) {
      onError(error, row);
    }
    return null;
  }
}

/** Escapes a string for safe embedding into SQLite string literal. */
function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Builds the SQL UPDATE statements for the transformed participants.
 */
export function generateUpdateSql(records: readonly TransformedParticipant[]): string {
  if (records.length === 0) return '';
  return records
    .map(
      (record) =>
        `UPDATE participants_info SET member_id = '${escapeSqlString(record.newMemberId)}', number = NULL, participant_type = 1, safe_contact = 0 WHERE _id = ${String(record.id)};`,
    )
    .join('\n');
}

/**
 * Generates SQL UPDATE statements for existing participants_info rows where
 * member_id, encrypted_member_id, and number all have the identical value.
 *
 * For matching rows:
 * - member_id is updated to the decoded key via extractEmKey
 * - encrypted_member_id is left unchanged
 * - number is set to NULL
 * - participant_type is set to 1
 * - safe_contact is set to 0
 */
export function generateMatchingFieldsUpdateSql(
  rows: readonly RawParticipantInfo[],
): string {
  const statements: string[] = [];

  for (const row of rows) {
    // Never touch the very first record (id === 1) or self record (participantType === 0)
    if (row.id === 1 || row.participantType === 0) {
      continue;
    }

    const memberId = row.memberId?.trim();
    const enc = row.encryptedMemberId?.trim();
    const numVal = row.number?.trim();

    if (memberId && enc && numVal && memberId === enc && enc === numVal) {
      try {
        const decodedKey = extractEmKey(enc);
        statements.push(
          `UPDATE participants_info SET member_id = '${escapeSqlString(decodedKey)}', number = NULL, participant_type = 1, safe_contact = 0 WHERE _id = ${String(row.id)};`,
        );
      } catch {
        // Skip un-decodable rows safely
      }
    }
  }
  return statements.join('\n');
}

export interface RosterInsertOptions {
  selfEncryptedMemberId?: string | null | undefined;
  selfMemberId?: string | null | undefined;
}

/**
 * Builds the SQL statements to insert or update participants_info records
 * from intercepted RosterMembers, setting:
 * - member_id: decoded key from em-key
 * - encrypted_member_id: raw mid (em:... token)
 * - number: NULL
 * - participant_type: 1
 * - safe_contact: 0
 * And links each record into the participants table for the given conversationId.
 */
export function generateRosterInsertSql(
  members: readonly RosterMember[],
  conversationId: number,
  options?: RosterInsertOptions,
): string {
  if (members.length === 0) return '';
  const statements: string[] = [];

  const selfEnc = options?.selfEncryptedMemberId?.trim();
  const selfMid = options?.selfMemberId?.trim();

  for (const m of members) {
    const enc = m.emid.trim();
    if (!enc) continue;

    // NEVER touch or insert self account
    if (selfEnc && enc === selfEnc) continue;

    let decodedMid: string;
    try {
      decodedMid = extractEmKey(enc);
    } catch {
      decodedMid = enc;
    }

    if (selfMid && decodedMid === selfMid) continue;

    const nameVal = m.name && m.name.trim() !== '' ? m.name.trim() : null;
    const escapedEnc = escapeSqlString(enc);
    const escapedMid = escapeSqlString(decodedMid);
    const escapedName = nameVal ? `'${escapeSqlString(nameVal)}'` : 'NULL';

    let role: number = GROUP_ROLE.member;
    if (m.role !== null && m.role !== undefined) {
      if (typeof m.role === 'number') {
        role = m.role;
      } else {
        const lower = String(m.role).toLowerCase();
        if (lower.includes('superadmin') || lower === '1') role = GROUP_ROLE.superadmin;
        else if (lower.includes('admin') || lower === '2') role = GROUP_ROLE.admin;
      }
    }

    // 1. Insert into participants_info if not exists (checked against both encrypted_member_id and decoded member_id)
    statements.push(
      `INSERT INTO participants_info (member_id, encrypted_member_id, number, participant_type, safe_contact, contact_name, display_name, viber_name) ` +
        `SELECT '${escapedMid}', '${escapedEnc}', NULL, 1, 0, ${escapedName}, ${escapedName}, ${escapedName} ` +
        `WHERE NOT EXISTS (SELECT 1 FROM participants_info WHERE encrypted_member_id = '${escapedEnc}' OR member_id = '${escapedMid}');`,
    );

    // 2. Update participants_info if already exists (never touching self record and never wiping real phone numbers)
    const nameUpdate = nameVal
      ? `display_name = ${escapedName}, viber_name = ${escapedName}, contact_name = ${escapedName}, `
      : '';
    statements.push(
      `UPDATE participants_info SET member_id = '${escapedMid}', participant_type = 1, safe_contact = 0, ` +
        nameUpdate +
        `number = CASE WHEN number LIKE 'em:%' THEN NULL ELSE number END ` +
        `WHERE (encrypted_member_id = '${escapedEnc}' OR member_id = '${escapedMid}') AND _id != 1 AND coalesce(participant_type, 1) != 0;`,
    );

    // 3. Link into participants table for this conversation_id if not exists (never linking self)
    statements.push(
      `INSERT INTO participants (conversation_id, participant_info_id, active, group_role, group_role_local) ` +
        `SELECT ${String(conversationId)}, pi._id, 1, ${String(role)}, ${String(role)} ` +
        `FROM participants_info pi WHERE (pi.encrypted_member_id = '${escapedEnc}' OR pi.member_id = '${escapedMid}') ` +
        `AND pi._id != 1 AND coalesce(pi.participant_type, 1) != 0 ` +
        `AND NOT EXISTS (SELECT 1 FROM participants p WHERE p.conversation_id = ${String(conversationId)} AND p.participant_info_id = pi._id);`,
    );
  }

  return statements.join('\n');
}
