import { describe, expect, it } from 'vitest';
import {
  describeGroups,
  looseGroupName,
  resolveGroupLoosely,
  type Conversation,
} from '../../src/viber/repository.js';

function group(id: number, name: string | null): Conversation {
  return {
    id,
    conversationType: 5,
    groupId: String(5_000_000_000_000_000_000n + BigInt(id)),
    name,
    lastMessageDate: null,
    messageCount: 0,
    participantCount: 0,
    unreadCount: 0,
    isGroup: true,
  };
}

const groups = [
  group(1, '✅ВДОРОГУ ✅🚘🇺🇦'),
  group(2, 'Тест'),
  group(3, '🇺🇦УКРАЇНЦІ В БЕРЛІНІ🇩🇪'),
  group(4, 'Варшавка Граница Брест'),
  group(5, 'АVTOTRAL🚨'), // Cyrillic А, then Latin
];

describe('looseGroupName', () => {
  it('drops emoji, spaces and case', () => {
    // Cyrillic look-alikes are folded on both sides, so compare against the
    // same function rather than a literal.
    expect(looseGroupName('✅ВДОРОГУ ✅🚘🇺🇦')).toBe(looseGroupName('вдорогу'));
    expect(looseGroupName('✅ВДОРОГУ ✅🚘🇺🇦')).toMatch(/^[\p{L}\p{N}]+$/u);
    expect(looseGroupName('Варшавка Граница Брест')).toBe(looseGroupName('варшавкаграницабрест'));
  });

  it('folds Cyrillic look-alikes into Latin', () => {
    expect(looseGroupName('АVTOTRAL🚨')).toBe('avtotral');
    expect(looseGroupName('AVTOTRAL')).toBe('avtotral');
  });
});

describe('resolveGroupLoosely', () => {
  it('finds a title typed with the wrong alphabet and without its emoji', () => {
    const { group: found, candidates } = resolveGroupLoosely(groups, 'AVTOTRAL');
    expect(found?.id).toBe(5);
    expect(candidates).toHaveLength(1);
  });

  it('matches a partial title', () => {
    expect(resolveGroupLoosely(groups, 'граница брест').group?.id).toBe(4);
  });

  it('refuses to guess between several candidates', () => {
    const ambiguous = [...groups, group(6, 'AVTOTRAL 2')];
    const { group: found, candidates } = resolveGroupLoosely(ambiguous, 'avtotral');
    expect(found).toBeUndefined();
    expect(candidates.map((g) => g.id)).toEqual([5, 6]);
  });

  it('matches nothing for an empty or emoji-only target', () => {
    expect(resolveGroupLoosely(groups, '🚨').group).toBeUndefined();
    expect(resolveGroupLoosely(groups, '   ').candidates).toEqual([]);
  });

  it('ignores groups without a name', () => {
    expect(resolveGroupLoosely([group(9, null)], 'x').group).toBeUndefined();
  });
});

describe('describeGroups', () => {
  it('lists id and name so the caller can retry by id', () => {
    expect(describeGroups(groups.slice(3))).toBe('4 — Варшавка Граница Брест; 5 — АVTOTRAL🚨');
    expect(describeGroups([group(7, null)])).toBe('7 — (без названия)');
  });
});
