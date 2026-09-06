import { describe, expect, it } from 'vitest';

import {
  describeBody,
  formatMessageLine,
  formatParticipantCsv,
  formatParticipantLine,
  formatParticipantTable,
  formatRosterEntryLine,
  formatTimestamp,
  senderLabel,
} from '../../src/viber/format.js';
import type { Message } from '../../src/viber/repository.js';

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    conversationId: 20,
    token: '77',
    // Local time, because that is what the formatter prints.
    date: new Date(2026, 7, 31, 11, 25, 37),
    body: 'hello',
    senderMemberId: 'em:abc',
    senderName: 'Ivan',
    senderNumber: '+375291112233',
    outgoing: false,
    extraMime: null,
    mediaUri: null,
    unread: true,
    ...overrides,
  };
}

describe('formatTimestamp', () => {
  it('prints local time the way a chat log reads', () => {
    expect(formatTimestamp(new Date(2026, 7, 31, 11, 25, 37))).toBe('2026-08-31 11:25:37');
  });

  it('pads single-digit parts', () => {
    expect(formatTimestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02 03:04:05');
  });
});

describe('describeBody', () => {
  it('marks a message that carries no text', () => {
    expect(describeBody({ body: null })).toBe('[no text]');
    expect(describeBody({ body: '   ' })).toBe('[no text]');
  });

  it('returns the trimmed body otherwise', () => {
    expect(describeBody({ body: '  hi  ' })).toBe('hi');
  });
});

describe('senderLabel', () => {
  it('names the automated account as me', () => {
    expect(senderLabel(message({ outgoing: true }))).toBe('me');
  });

  it('falls back to the number when the name is missing', () => {
    expect(senderLabel(message({ senderName: null }))).toBe('+375291112233');
  });

  it('treats a blank name as missing rather than printing nothing', () => {
    expect(senderLabel(message({ senderName: '   ' }))).toBe('+375291112233');
  });

  it('says unknown when neither a name nor a number survived', () => {
    expect(senderLabel(message({ senderName: '', senderNumber: '' }))).toBe('unknown');
  });
});

describe('formatMessageLine', () => {
  it('prints timestamp, sender and body', () => {
    expect(formatMessageLine(message())).toBe('[2026-08-31 11:25:37] Ivan: hello');
  });

  it('indents continuation lines so a multi-line message stays one block', () => {
    expect(formatMessageLine(message({ body: 'Київ-Варшава\n1 пас\n\n0637925107' }))).toBe(
      '[2026-08-31 11:25:37] Ivan: Київ-Варшава\n    1 пас\n\n    0637925107',
    );
  });

  it('normalises windows line endings', () => {
    expect(formatMessageLine(message({ body: 'a\r\nb' }))).toBe(
      '[2026-08-31 11:25:37] Ivan: a\n    b',
    );
  });
});

describe('formatRosterEntryLine', () => {
  it('prints the roster position, the role and the display name', () => {
    expect(formatRosterEntryLine({ index: 0, name: 'Ira', role: 'Суперадмин' })).toBe(
      '    1  Суперадмин     Ira',
    );
  });

  it('marks a plain member, who has no role at all', () => {
    expect(formatRosterEntryLine({ index: 1628, name: 'Дима', role: null })).toBe(
      ' 1629  -              Дима',
    );
  });
});

describe('formatParticipantLine', () => {
  it('formats participant with memberId fallback when number is missing', () => {
    expect(
      formatParticipantLine({
        id: 10,
        memberId: 'AQAdy+s/zYoLTBpvAAAOWWD8N60tJ5xWUDueu1M7CfqgzymUapk+twp/',
        number: null,
        name: 'Lena',
        contactName: null,
        viberName: 'Lena',
        groupRole: 1,
        roleLabel: 'superadmin',
        active: true,
        isSelf: false,
      }),
    ).toBe(
      'superadmin Lena — AQAdy+s/zYoLTBpvAAAOWWD8N60tJ5xWUDueu1M7CfqgzymUapk+twp/',
    );
  });

  it('marks left participants and self', () => {
    expect(
      formatParticipantLine({
        id: 11,
        memberId: null,
        number: '+380991234567',
        name: 'Me',
        contactName: null,
        viberName: null,
        groupRole: 3,
        roleLabel: 'member',
        active: false,
        isSelf: true,
      }),
    ).toBe('member     Me (me) [left] — +380991234567');
  });
});

describe('formatParticipantTable', () => {
  it('formats participants as an aligned text table with role, name, and phone number columns', () => {
    const participants = [
      {
        id: 1,
        memberId: 'abc',
        number: '+380501234567',
        name: 'Alice',
        contactName: null,
        viberName: null,
        groupRole: 1,
        roleLabel: 'superadmin' as const,
        active: true,
        isSelf: false,
      },
      {
        id: 2,
        memberId: 'def',
        number: null,
        name: 'Bob',
        contactName: null,
        viberName: null,
        groupRole: 3,
        roleLabel: 'member' as const,
        active: false,
        isSelf: false,
      },
    ];

    const table = formatParticipantTable(participants);
    expect(table).toContain('№');
    expect(table).toContain('Роль');
    expect(table).toContain('Имя');
    expect(table).toContain('Номер телефона');
    expect(table).toContain('superadmin');
    expect(table).toContain('Alice');
    expect(table).toContain('+380501234567');
    expect(table).toContain('member');
    expect(table).toContain('Bob [left]');
    expect(table).toContain('-');
    expect(table).toMatch(/\b1\s+superadmin/);
    expect(table).toMatch(/\b2\s+member/);
  });

  it('shows ISO and legacy last-seen values in the activity column', () => {
    const table = formatParticipantTable([
      {
        id: 1,
        memberId: 'iso',
        number: null,
        name: 'ISO',
        contactName: null,
        viberName: null,
        groupRole: 3,
        roleLabel: 'member',
        active: true,
        isSelf: false,
        isOnline: false,
        lastSeen: '2026-09-05T18:19:15.799Z',
      },
      {
        id: 2,
        memberId: 'legacy',
        number: null,
        name: 'Legacy',
        contactName: null,
        viberName: null,
        groupRole: 3,
        roleLabel: 'member',
        active: true,
        isSelf: false,
        isOnline: false,
        lastSeen: '05.09.2026 18:19:15',
      },
    ]);

    expect(table).toContain('2026-09-05 18:19');
    expect(table).toContain('05.09.2026 18:19');
  });
});

describe('formatParticipantCsv', () => {
  it('formats participants as CSV with header, escaping and UTF-8 BOM', () => {
    const participants = [
      {
        id: 1,
        memberId: 'abc',
        number: '+380501234567',
        name: 'Alice "Boss", Jr.',
        contactName: null,
        viberName: null,
        groupRole: 1,
        roleLabel: 'superadmin' as const,
        active: true,
        isSelf: true,
        isOnline: true,
        lastSeen: '2026-09-05T18:19:15.799Z',
      },
      {
        id: 2,
        memberId: 'def',
        number: null,
        name: 'Bob',
        contactName: null,
        viberName: null,
        groupRole: 3,
        roleLabel: 'member' as const,
        active: false,
        isSelf: false,
        isOnline: false,
        lastSeen: null,
      },
    ];

    const csv = formatParticipantCsv(participants);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('№,Имя,Номер телефона,Роль,Активность,В сети,Дата последнего визита,Member ID,Активен,Бот');
    expect(csv).toContain('1,"Alice ""Boss"", Jr.",+380501234567,superadmin,В сети,Да,2026-09-05T18:19:15.799Z,abc,Да,Да');
    expect(csv).toContain('2,Bob,,member,-,Нет,,def,Нет,Нет');
  });
});


