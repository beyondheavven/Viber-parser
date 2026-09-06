import type { Message, Participant } from './repository.js';

/** `2026-08-31 11:25:37` in local time, which is how a human reads a chat log. */
export function formatTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/**
 * Describes a message that carries no text.
 *
 * Some rows have an empty body — media placeholders and system events. Viber's
 * `extra_mime` is a numeric code that also appears on ordinary text messages,
 * so it cannot be used to name the kind, and a neutral marker is printed
 * instead of guessing. Printing nothing would silently shorten a transcript.
 */
export function describeBody(message: Pick<Message, 'body'>): string {
  const body = message.body?.trim() ?? '';
  return body === '' ? '[no text]' : body;
}

/**
 * Viber stores a blank name rather than NULL for some participants, so an
 * empty string has to fall through to the next option — otherwise the log
 * prints a line with no sender at all.
 */
function nonBlank(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

export function senderLabel(message: Pick<Message, 'senderName' | 'senderNumber' | 'outgoing'>): string {
  if (message.outgoing) return 'me';
  return nonBlank(message.senderName) ?? nonBlank(message.senderNumber) ?? 'unknown';
}

/** Continuation lines of a multi-line body, so it reads as one message. */
const CONTINUATION_INDENT = '    ';

export function formatMessageLine(message: Message): string {
  const body = describeBody(message)
    .split(/\r?\n/)
    .map((line, index) =>
      index === 0 || line.trim() === '' ? line : `${CONTINUATION_INDENT}${line}`,
    )
    .join('\n');
  return `[${formatTimestamp(message.date)}] ${senderLabel(message)}: ${body}`;
}

/**
 * One row of a UI-collected roster.
 *
 * The participants screen shows a display name and, for the few members who
 * have one, a role — nothing else — so the position in the list is printed
 * alongside as the only other thing that distinguishes two equal names.
 */
export function formatRosterEntryLine(entry: {
  index: number;
  name: string;
  role: string | null;
}): string {
  const position = String(entry.index + 1).padStart(5);
  const role = (entry.role ?? '').trim();
  return `${position}  ${(role === '' ? '-' : role).padEnd(14)} ${entry.name}`;
}

export function formatParticipantLine(participant: Participant): string {
  const rawName = participant.name && participant.name.trim().length > 0 ? participant.name.trim() : '(без имени)';
  const identifier = participant.number ?? participant.memberId ?? '-';
  const self = participant.isSelf ? ' (me)' : '';
  const inactive = participant.active ? '' : ' [left]';
  return `${participant.roleLabel.padEnd(10)} ${rawName}${self}${inactive} — ${identifier}`;
}

/**
 * Formats a list of participants as a table with columns: №, Роль, Имя, Номер телефона, Активность.
 */
export function formatParticipantTable(participants: readonly Participant[]): string {
  const colIndex = '№';
  const colRole = 'Роль';
  const colName = 'Имя';
  const colPhone = 'Номер телефона';
  const colActive = 'Активность';

  const indexWidth = Math.max(colIndex.length, String(participants.length).length, 4);
  const roleWidth = Math.max(colRole.length, ...participants.map((p) => p.roleLabel.length), 10);
  const nameWidth = Math.max(
    colName.length,
    ...participants.map((p) => {
      const rawName = p.name && p.name.trim().length > 0 ? p.name.trim() : '(без имени)';
      const name = `${rawName}${p.isSelf ? ' (me)' : ''}${p.active ? '' : ' [left]'}`;
      return name.length;
    }),
    20,
  );
  const phoneWidth = Math.max(
    colPhone.length,
    ...participants.map((p) => {
      const phone = p.number && p.number.trim().length > 0 ? p.number.trim() : '-';
      return phone.length;
    }),
    16,
  );
  const activeWidth = Math.max(
    colActive.length,
    ...participants.map((p) => {
      if (p.isOnline) return 'В сети'.length;
      if (p.lastSeen) return p.lastSeen.slice(0, 16).replace('T', ' ').length;
      return 1;
    }),
    18,
  );

  const header = `${colIndex.padStart(indexWidth)}  ${colRole.padEnd(roleWidth)}  ${colName.padEnd(nameWidth)}  ${colPhone.padEnd(phoneWidth)}  ${colActive.padEnd(activeWidth)}`;
  const separator = `${'─'.repeat(indexWidth)}  ${'─'.repeat(roleWidth)}  ${'─'.repeat(nameWidth)}  ${'─'.repeat(phoneWidth)}  ${'─'.repeat(activeWidth)}`;

  const rows = participants.map((p, idx) => {
    const num = String(idx + 1).padStart(indexWidth);
    const role = p.roleLabel.padEnd(roleWidth);
    const rawName = p.name && p.name.trim().length > 0 ? p.name.trim() : '(без имени)';
    const name = `${rawName}${p.isSelf ? ' (me)' : ''}${p.active ? '' : ' [left]'}`.padEnd(nameWidth);
    const phone = (p.number && p.number.trim().length > 0 ? p.number.trim() : '-').padEnd(phoneWidth);
    let activeStr = '-';
    if (p.isOnline) {
      activeStr = 'В сети';
    } else if (p.lastSeen) {
      activeStr = p.lastSeen.slice(0, 16).replace('T', ' ');
    }
    const active = activeStr.padEnd(activeWidth);
    return `${num}  ${role}  ${name}  ${phone}  ${active}`;
  });

  return [header, separator, ...rows].join('\n');
}

/**
 * Escapes a cell value according to RFC 4180 CSV specifications.
 */
function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r') || str.includes(';')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Formats a list of participants as an RFC 4180 CSV document with UTF-8 BOM for Excel compatibility.
 */
export function formatParticipantCsv(participants: readonly Participant[]): string {
  const headers = [
    '№',
    'Имя',
    'Номер телефона',
    'Роль',
    'Активность',
    'В сети',
    'Дата последнего визита',
    'Member ID',
    'Активен',
    'Бот',
  ];

  const rows = participants.map((p, idx) => {
    let lastVisit = '';
    if (p.isOnline) {
      lastVisit = 'В сети';
    } else if (p.lastSeen) {
      lastVisit = p.lastSeen.slice(0, 16).replace('T', ' ');
    }

    return [
      idx + 1,
      p.name ?? '',
      p.number ?? '',
      p.roleLabel,
      lastVisit || '-',
      p.isOnline ? 'Да' : 'Нет',
      p.lastSeen ?? '',
      p.memberId ?? '',
      p.active ? 'Да' : 'Нет',
      p.isSelf ? 'Да' : 'Нет',
    ]
      .map(escapeCsvCell)
      .join(',');
  });

  // UTF-8 BOM (\uFEFF) ensures Excel and other spreadsheet software correctly display Cyrillic characters
  return '\uFEFF' + [headers.map(escapeCsvCell).join(','), ...rows].join('\r\n');
}
