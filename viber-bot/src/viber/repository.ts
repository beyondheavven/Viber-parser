import type { Row, Sqlite } from '../platform/sqlite.js';
import { selectList } from '../platform/sqlite.js';
import {
  CONVERSATION_COLUMNS,
  CONVERSATION_TYPE,
  GROUP_ROLE,
  MESSAGE_COLUMNS,
  PARTICIPANT_COLUMNS,
  SELF_PARTICIPANT_TYPE,
} from './schema.js';

export interface Conversation {
  id: number;
  conversationType: number;
  /** 64-bit Viber group id, kept as a string so no precision is lost. */
  groupId: string | null;
  name: string | null;
  lastMessageDate: Date | null;
  messageCount: number;
  participantCount: number;
  unreadCount: number;
  isGroup: boolean;
}

export interface Message {
  id: number;
  conversationId: number;
  /** 64-bit Viber message token, stable across devices. */
  token: string | null;
  date: Date;
  body: string | null;
  senderId?: number | null | undefined;
  senderMemberId: string | null;
  senderName: string | null;
  senderNumber: string | null;
  /** True when the automated account itself sent the message. */
  outgoing: boolean;
  /**
   * Raw `messages.extra_mime`. In Viber 20 this is a numeric type code, not a
   * MIME string, and it appears on plain text messages too — so it is passed
   * through untouched rather than interpreted.
   */
  extraMime: string | null;
  mediaUri: string | null;
  unread: boolean;
}

export interface Participant {
  id: number;
  memberId: string | null;
  number: string | null;
  /** Best available human-readable name. */
  name: string | null;
  contactName: string | null;
  viberName: string | null;
  groupRole: number | null;
  roleLabel: 'superadmin' | 'admin' | 'member' | 'unknown';
  active: boolean;
  isSelf: boolean;
  isOnline?: boolean;
  lastSeen?: string | null;
}

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

export function roleLabel(role: number | null): Participant['roleLabel'] {
  switch (role) {
    case GROUP_ROLE.superadmin:
      return 'superadmin';
    case GROUP_ROLE.admin:
      return 'admin';
    case GROUP_ROLE.member:
      return 'member';
    default:
      return 'unknown';
  }
}

export function toConversation(row: Row): Conversation {
  const conversationType = requireNum(row, 'conversationType');
  const lastMessageDate = num(row, 'lastMessageDate');
  return {
    id: requireNum(row, 'id'),
    conversationType,
    groupId: text(row, 'groupId'),
    name: text(row, 'name'),
    lastMessageDate:
      lastMessageDate === null || lastMessageDate === 0 ? null : new Date(lastMessageDate),
    messageCount: requireNum(row, 'messageCount'),
    participantCount: requireNum(row, 'participantCount'),
    unreadCount: num(row, 'unreadCount') ?? 0,
    isGroup: conversationType !== CONVERSATION_TYPE.oneToOne,
  };
}

export function toMessage(row: Row): Message {
  return {
    id: requireNum(row, 'id'),
    conversationId: requireNum(row, 'conversationId'),
    token: text(row, 'token'),
    date: new Date(requireNum(row, 'date')),
    body: text(row, 'body'),
    senderId: num(row, 'senderId'),
    senderMemberId: text(row, 'senderMemberId'),
    senderName: text(row, 'senderName'),
    senderNumber: text(row, 'senderNumber'),
    outgoing: num(row, 'senderType') === SELF_PARTICIPANT_TYPE,
    extraMime: text(row, 'extraMime'),
    mediaUri: text(row, 'mediaUri'),
    unread: num(row, 'unread') === 1,
  };
}

export function toParticipant(row: Row): Participant {
  const groupRole = num(row, 'groupRole');
  const contactName = text(row, 'contactName');
  const viberName = text(row, 'viberName');
  const displayName = text(row, 'displayName');
  const rawName = [viberName, displayName, contactName].find(
    (n) => typeof n === 'string' && n.trim().length > 0,
  );
  return {
    id: requireNum(row, 'id'),
    memberId: text(row, 'memberId'),
    number: text(row, 'number'),
    name: rawName?.trim() ?? null,
    contactName,
    viberName,
    groupRole,
    roleLabel: roleLabel(groupRole),
    active: num(row, 'active') !== 0,
    isSelf: num(row, 'participantType') === SELF_PARTICIPANT_TYPE,
  };
}

const CONVERSATION_EXPRS: Readonly<Record<string, string>> = {
  id: 'c._id',
  conversationType: 'c.conversation_type',
  groupId: 'cast(c.group_id as text)',
  name: 'c.name',
  lastMessageDate: '(select max(m.msg_date) from messages m where m.conversation_id = c._id)',
  messageCount: '(select count(*) from messages m where m.conversation_id = c._id)',
  participantCount: '(select count(*) from participants p where p.conversation_id = c._id)',
  unreadCount:
    '(select count(*) from messages m where m.conversation_id = c._id and m.unread = 1)',
};

const MESSAGE_EXPRS: Readonly<Record<string, string>> = {
  id: 'm._id',
  conversationId: 'm.conversation_id',
  token: 'cast(m.token as text)',
  // msg_date is epoch milliseconds, verified against a live database.
  date: 'm.msg_date',
  body: "coalesce(nullif(m.body, ''), nullif(m.description, ''))",
  senderId: 'pi._id',
  senderMemberId: "coalesce(nullif(pi.member_id, ''), nullif(pi.encrypted_member_id, ''))",
  senderName: 'coalesce(pi.contact_name, pi.display_name, pi.viber_name)',
  senderNumber: 'pi.number',
  senderType: 'pi.participant_type',
  extraMime: 'm.extra_mime',
  mediaUri: 'm.extra_uri',
  unread: 'm.unread',
};

const PARTICIPANT_EXPRS: Readonly<Record<string, string>> = {
  id: 'pi._id',
  memberId: 'pi.member_id',
  number: 'pi.number',
  contactName: 'pi.contact_name',
  viberName: 'pi.viber_name',
  displayName: 'pi.display_name',
  groupRole: 'p.group_role',
  active: 'p.active',
  participantType: 'pi.participant_type',
};

/**
 * Every message row carries its sender through two hops. The join is a LEFT
 * join because Viber keeps system events whose participant row has already
 * been pruned, and losing those would silently shorten the history.
 */
const MESSAGE_JOIN =
  'from messages m' +
  ' left join participants p on p._id = m.participant_id' +
  ' left join participants_info pi on pi._id = p.participant_info_id';

export class ViberRepository {
  constructor(private readonly db: Sqlite) {}

  /** Every conversation, most recent activity first. */
  conversations(options: { groupsOnly?: boolean } = {}): Conversation[] {
    const where =
      options.groupsOnly === true
        ? `where c.conversation_type != ${String(CONVERSATION_TYPE.oneToOne)}`
        : '';
    const sql = `select ${selectList(CONVERSATION_COLUMNS, CONVERSATION_EXPRS)} from conversations c ${where} order by 5 desc;`;
    return this.db.query(sql, CONVERSATION_COLUMNS).map(toConversation);
  }

  groups(): Conversation[] {
    return this.conversations({ groupsOnly: true });
  }

  /**
   * Resolves a group by row id, then by exact name, then by case-insensitive
   * substring. Group titles carry emoji and mixed scripts, so exact matching
   * comes first and keeps names addressable verbatim.
   */
  findGroup(nameOrId: string): Conversation | undefined {
    const groups = this.groups();
    const trimmed = nameOrId.trim();
    const asId = Number.parseInt(trimmed, 10);
    if (Number.isInteger(asId) && String(asId) === trimmed) {
      const byId = groups.find((group) => group.id === asId);
      if (byId !== undefined) return byId;
    }
    const exact = groups.find((group) => group.name === nameOrId);
    if (exact !== undefined) return exact;
    const needle = trimmed.toLowerCase();
    return groups.find((group) => (group.name ?? '').toLowerCase().includes(needle));
  }

  /** Messages in a conversation, oldest first. */
  messages(conversationId: number, options: { sinceId?: number; limit?: number } = {}): Message[] {
    const conditions = [`m.conversation_id = ${String(conversationId)}`, 'm.deleted = 0'];
    if (options.sinceId !== undefined) conditions.push(`m._id > ${String(options.sinceId)}`);
    const limit = options.limit === undefined ? '' : ` limit ${String(options.limit)}`;
    const sql = `select ${selectList(MESSAGE_COLUMNS, MESSAGE_EXPRS)} ${MESSAGE_JOIN} where ${conditions.join(' and ')} order by m._id asc${limit};`;
    return this.db.query(sql, MESSAGE_COLUMNS).map(toMessage);
  }

  /** The newest `limit` messages, returned oldest-first within that slice. */
  latestMessages(conversationId: number, limit: number): Message[] {
    const inner = `select ${selectList(MESSAGE_COLUMNS, MESSAGE_EXPRS)} ${MESSAGE_JOIN} where m.conversation_id = ${String(conversationId)} and m.deleted = 0 order by m._id desc limit ${String(limit)}`;
    return this.db.query(`select * from (${inner}) order by 1 asc;`, MESSAGE_COLUMNS).map(toMessage);
  }

  /** Highest message row id in a conversation, or 0 when it has none. */
  lastMessageId(conversationId: number): number {
    return this.db.count(
      `select ifnull(max(_id), 0) from messages where conversation_id = ${String(conversationId)};`,
    );
  }

  /** Messages across all conversations, oldest first. */
  allMessages(options: { sinceId?: number; limit?: number } = {}): Message[] {
    const conditions = ['m.deleted = 0'];
    if (options.sinceId !== undefined) conditions.push(`m._id > ${String(options.sinceId)}`);
    const limit = options.limit === undefined ? '' : ` limit ${String(options.limit)}`;
    const sql = `select ${selectList(MESSAGE_COLUMNS, MESSAGE_EXPRS)} ${MESSAGE_JOIN} where ${conditions.join(' and ')} order by m._id asc${limit};`;
    return this.db.query(sql, MESSAGE_COLUMNS).map(toMessage);
  }

  /**
   * New messages for several conversations, each with its own cursor.
   * One query so a catch-up after an emulator restart does not re-copy the
   * snapshot once per group.
   */
  messagesSince(
    cursors: ReadonlyArray<{ conversationId: number; sinceId: number }>,
    options: { limit?: number } = {},
  ): Message[] {
    const clauses = cursors.flatMap((cursor) => {
      if (!Number.isInteger(cursor.conversationId) || !Number.isInteger(cursor.sinceId)) return [];
      return [
        `(m.conversation_id = ${String(cursor.conversationId)} and m._id > ${String(cursor.sinceId)})`,
      ];
    });
    if (clauses.length === 0) return [];
    const limit = options.limit === undefined ? '' : ` limit ${String(options.limit)}`;
    const sql =
      `select ${selectList(MESSAGE_COLUMNS, MESSAGE_EXPRS)} ${MESSAGE_JOIN}` +
      ` where m.deleted = 0 and (${clauses.join(' or ')}) order by m._id asc${limit};`;
    return this.db.query(sql, MESSAGE_COLUMNS).map(toMessage);
  }

  /** Highest message row id across all conversations, or 0 when it has none. */
  globalLastMessageId(): number {
    return this.db.count('select ifnull(max(_id), 0) from messages;');
  }

  /**
   * Members of one conversation.
   *
   * The join is a LEFT JOIN for the same reason the message query uses one: an
   * inner join silently drops rows whose `participants_info` was pruned, and a
   * roster that quietly loses members is worse than one carrying a nameless
   * entry that shows something went wrong.
   */
  participants(conversationId: number): Participant[] {
    const sql = `select ${selectList(PARTICIPANT_COLUMNS, PARTICIPANT_EXPRS)} from participants p left join participants_info pi on pi._id = p.participant_info_id where p.conversation_id = ${String(conversationId)} order by p.group_role asc, pi._id asc;`;
    return this.db.query(sql, PARTICIPANT_COLUMNS).map(toParticipant);
  }
}

/** Resolves only canonical row ids or exact trimmed names; substring matches are unsafe here. */
export function resolveGroupExact(
  groups: readonly Conversation[],
  target: string,
): Conversation | undefined {
  const value = target.trim();
  const id = Number.parseInt(value, 10);
  if (Number.isInteger(id) && String(id) === value) {
    return groups.find((group) => group.id === id);
  }
  const matches = groups.filter((group) => group.name === value);
  if (matches.length > 1) {
    throw new Error(`More than one group is named "${value}"; use its numeric id.`);
  }
  return matches[0];
}

/**
 * Cyrillic letters that look like Latin ones. Group titles are typed by hand
 * on mixed keyboards, so "АVTOTRAL" (Cyrillic А) and "AVTOTRAL" must match.
 */
const HOMOGLYPHS: Readonly<Record<string, string>> = {
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', х: 'x', у: 'y',
};

/** Lower-case letters and digits only, with Cyrillic look-alikes folded into Latin. */
export function looseGroupName(name: string): string {
  return [...name.toLowerCase()]
    .map((char) => HOMOGLYPHS[char] ?? char)
    .filter((char) => /[\p{L}\p{N}]/u.test(char))
    .join('');
}

/**
 * Last-resort match after {@link resolveGroupExact} and `findGroup`: ignores
 * emoji, spacing, case and Cyrillic/Latin look-alikes. Returns the group only
 * when exactly one title matches, so a loose match can never pick the wrong
 * group silently; the candidates are returned for the error message otherwise.
 */
export function resolveGroupLoosely(
  groups: readonly Conversation[],
  target: string,
): { group: Conversation | undefined; candidates: Conversation[] } {
  const needle = looseGroupName(target);
  if (needle === '') return { group: undefined, candidates: [] };
  const candidates = groups.filter((group) => {
    const title = looseGroupName(group.name ?? '');
    if (title === '') return false; // an empty title would "contain" anything
    return title === needle || title.includes(needle) || needle.includes(title);
  });
  return { group: candidates.length === 1 ? candidates[0] : undefined, candidates };
}

/** "id — name" lines for an error message, so the caller can retry by id. */
export function describeGroups(groups: readonly Conversation[], limit = 15): string {
  return groups
    .slice(0, limit)
    .map((group) => `${String(group.id)} — ${group.name ?? '(без названия)'}`)
    .join('; ');
}

/**
 * Normalizes a phone number for deduplication comparisons.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const clean = phone.trim();
  if (clean.toLowerCase().startsWith('em') || clean === 'Ожидает дешифровки' || clean.length < 5) {
    return null;
  }
  const digits = clean.replace(/\D/g, '');
  // Anything shorter than a real subscriber number is a placeholder, not an
  // identity. Returning it would make every member carrying the same
  // placeholder dedup into a single person.
  return digits.length >= 7 ? digits : null;
}

/**
 * Deduplicates participants by memberId and normalized phone number,
 * merging complementary records so no duplicate contacts remain in output.
 */
export function deduplicateParticipants(participants: readonly Participant[]): Participant[] {
  const result: Participant[] = [];
  const memberIdMap = new Map<string, Participant>();
  const phoneMap = new Map<string, Participant>();

  for (const p of participants) {
    const normPhone = normalizePhone(p.number);
    const cleanMid =
      p.memberId && p.memberId.trim().length > 0 && !p.memberId.startsWith('em:')
        ? p.memberId.trim()
        : null;

    let target: Participant | undefined = undefined;

    if (cleanMid && memberIdMap.has(cleanMid)) {
      target = memberIdMap.get(cleanMid);
    } else if (normPhone && phoneMap.has(normPhone)) {
      target = phoneMap.get(normPhone);
    }

    if (!target) {
      const copy: Participant = { ...p };
      result.push(copy);
      if (cleanMid) memberIdMap.set(cleanMid, copy);
      if (normPhone) phoneMap.set(normPhone, copy);
    } else {
      if (
        (!target.number || target.number.trim().length === 0 || target.number.startsWith('em')) &&
        p.number
      ) {
        target.number = p.number;
      }
      if ((!target.memberId || target.memberId.startsWith('em:')) && cleanMid) {
        target.memberId = cleanMid;
        memberIdMap.set(cleanMid, target);
      }
      if (!target.name || target.name.trim() === '' || target.name === '(без имени)') {
        target.name = p.name;
      }
      if (!target.contactName && p.contactName) target.contactName = p.contactName;
      if (!target.viberName && p.viberName) target.viberName = p.viberName;

      if (target.groupRole === null || (p.groupRole !== null && p.groupRole < target.groupRole)) {
        target.groupRole = p.groupRole;
        target.roleLabel = p.roleLabel;
      }

      if (p.isOnline) target.isOnline = true;
      if (p.lastSeen && (!target.lastSeen || p.lastSeen > target.lastSeen)) {
        target.lastSeen = p.lastSeen;
      }
      if (p.isSelf) target.isSelf = true;
      if (p.active) target.active = true;

      const newPhone = normalizePhone(target.number);
      if (newPhone && !phoneMap.has(newPhone)) {
        phoneMap.set(newPhone, target);
      }
      if (target.memberId && !memberIdMap.has(target.memberId)) {
        memberIdMap.set(target.memberId, target);
      }
    }
  }

  return result;
}

