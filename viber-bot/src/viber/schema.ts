/**
 * Viber 20.1.0.0 `viber_messages` schema, verified against a live LDPlayer
 * instance. Everything the rest of the code knows about Viber's tables lives
 * here — Viber renames and reshapes columns between releases, so this is the
 * one file to re-verify after an app update.
 */
import type { ColumnDef } from '../device/sqlite.js';

export const CONVERSATION_TYPE = {
  /** A one-to-one chat. */
  oneToOne: 0,
  /** A regular group chat. */
  group: 1,
  /** A community / public group. */
  community: 5,
} as const;

export type ConversationType = (typeof CONVERSATION_TYPE)[keyof typeof CONVERSATION_TYPE];

/**
 * `participants.group_role`, confirmed against two live communities: exactly
 * one role-1 holder per group, a handful of role-2, everyone else role-3.
 */
export const GROUP_ROLE = {
  superadmin: 1,
  admin: 2,
  member: 3,
} as const;

/**
 * `participants_info.participant_type` is 0 for the account itself. Verified by
 * matching those rows against the number in
 * `files/preferences/reg_viber_phone_num_canonized`.
 */
export const SELF_PARTICIPANT_TYPE = 0;

export const CONVERSATION_COLUMNS: readonly ColumnDef[] = [
  { name: 'id', kind: 'int' },
  { name: 'conversationType', kind: 'int' },
  { name: 'groupId', kind: 'text' },
  { name: 'name', kind: 'text' },
  { name: 'lastMessageDate', kind: 'int' },
  { name: 'messageCount', kind: 'int' },
  { name: 'participantCount', kind: 'int' },
  { name: 'unreadCount', kind: 'int' },
];

export const MESSAGE_COLUMNS: readonly ColumnDef[] = [
  { name: 'id', kind: 'int' },
  { name: 'conversationId', kind: 'int' },
  { name: 'token', kind: 'text' },
  { name: 'date', kind: 'int' },
  { name: 'body', kind: 'text' },
  { name: 'senderId', kind: 'int' },
  { name: 'senderMemberId', kind: 'text' },
  { name: 'senderName', kind: 'text' },
  { name: 'senderNumber', kind: 'text' },
  { name: 'senderType', kind: 'int' },
  { name: 'extraMime', kind: 'text' },
  { name: 'mediaUri', kind: 'text' },
  { name: 'unread', kind: 'int' },
];

export const PARTICIPANT_COLUMNS: readonly ColumnDef[] = [
  { name: 'id', kind: 'int' },
  { name: 'memberId', kind: 'text' },
  { name: 'number', kind: 'text' },
  { name: 'contactName', kind: 'text' },
  { name: 'viberName', kind: 'text' },
  { name: 'displayName', kind: 'text' },
  { name: 'groupRole', kind: 'int' },
  { name: 'active', kind: 'int' },
  { name: 'participantType', kind: 'int' },
];

/**
 * `group_id` and `token` are 64-bit identifiers. JavaScript numbers cannot hold
 * them without loss, so they are read as text and kept as strings.
 */
export const BIG_INT_AS_TEXT = ['groupId', 'token'] as const;
