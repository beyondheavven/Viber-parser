import { describe, expect, it } from 'vitest';

import {
  extractEmTokens,
  findMember,
  mergeRosters,
  parseInterceptedLines,
  type DbParticipant,
} from '../../src/intercept/parse-intercepted.js';

// Real tokens from data/rosters + artifacts/participants_info.json, with the
// 8-byte member key extractEmKey() derives from each (verified against a live DB).
const MILENA = 'em:AQANrniLcl9lwBpvAAD45BjXack2KDDejNcNiXWX7KoogUod/74atmpL';
const MILENA_KEY = 'Da54i3JfZcA=';
const IEVGEN = 'em:AQBDSbnJB8CCthpvAADDzFtSX+ITrmsmijma1IhjgtYmCRv02eK4yATf';
const IEVGEN_KEY = 'Q0m5yQfAgrY=';
const ALICE = 'em:AQAY8y8gyFai5BpvAACoLpy+vC3ItcZ2gLLl0f16A7pl+1QI1qRCMXd7';
const ALICE_KEY = 'GPMvIMhWouQ=';
// A real roster token (data/rosters/all-groups.txt) that appears in no fixture below.
const ABSENT = 'em:AQBB0Nvpf8m3TBpvAADtl415+01J/ycxGBYtyf83kzOpblx0zhNRh/TP';
// The same 56-char "AQ…" shape the regex accepts, but the marker bytes at blob
// offset 10-11 are zeroed (base64 chars 13-15 "Bpv" -> "AAA"), so extractEmKey
// refuses it. This is what a false positive carved out of one of the binary
// artifacts/intercept/*.bin dumps looks like.
const WRONG_MARKER = 'em:AQBB0Nvpf8m3TAAAAADtl415+01J/ycxGBYtyf83kzOpblx0zhNRh/TP';
// A spread of real tokens straight out of data/rosters/*.txt.
const REAL_TOKENS = [
  MILENA,
  IEVGEN,
  ALICE,
  ABSENT,
  'em:AQA0w1q4pbyP4BpvAAAO36A0u6U8ps2U5DaS6Fv1iTynNfoWIZ8Wh2s6',
  'em:AQA2/ZsrAdYYShpvAAAOa4TUXI84f7Ky0+UOr4VqKPW85b3Ew4Mcd6u6',
  'em:AQAD4z0XdPzc/hpvAACsfFdRAvnYPWgBRwOGE3Nzt1KWD897ohIk6/FD',
  'em:AQAli7sJJ6olpBpvAACAJ/RCQ2Ls7t3jE0StxCaE/pQBME22zgVHpoWF',
  'em:AQAvXX/DoktGvRpvAADduCiAk0h3Zq9rW9d7CISbr8rXsApvAu5yZYVs',
  'em:AQBVVpixfO39oBpvAADY0SIJAaxiXfR028uWiMzc28hRd+8uCMQ2XRbT',
  'em:AQBhP2JsScL3wRpvAABO6iaEA2m4oANS6pcUfiC6BU4bZf87zFp2Rwd3',
  'em:AQBxl3qHdECBiRpvAAAnL0wqriFZNJnos+tbAPORcd0huwR+f7QFfPf9',
];

describe('extractEmTokens', () => {
  it('extracts an em:-prefixed token from a roster-style line', () => {
    expect(extractEmTokens(`member     Oksana - ${MILENA}`)).toEqual([MILENA]);
  });

  it('extracts a bare token even when a base64-range byte precedes it', () => {
    // In protobuf the em: prefix is absent and the 56-byte body sits right after
    // a length prefix (56 -> 0x38 -> '8'), a base64-range byte: no leading boundary.
    const wire = ` 8${MILENA.slice(3)} `;
    expect(extractEmTokens(wire)).toEqual([MILENA]);
  });

  it('does not carve a token out of a longer base64 run', () => {
    // Begins with the "AQ" anchor, but the 56-char window is followed by more
    // base64, so the trailing boundary rejects it as an ordinary long blob.
    const longBlob = ` AQ${'B'.repeat(94)} `;
    expect(extractEmTokens(longBlob)).toEqual([]);
  });

  it('ignores base64 that lacks the AQ version prefix', () => {
    const notEm = ` B${'Cd3f'.repeat(13)}xyz `; // 56 chars, no "AQ" anywhere
    expect(extractEmTokens(notEm)).toEqual([]);
  });

  it('dedupes repeated tokens and preserves first-seen order', () => {
    const text = `${IEVGEN} noise ${MILENA} more ${IEVGEN}`;
    expect(extractEmTokens(text)).toEqual([IEVGEN, MILENA]);
  });
});

describe('parseInterceptedLines', () => {
  it('parses valid JSONL and skips blank/invalid lines', () => {
    const lines = [
      JSON.stringify({ emId: MILENA, name: 'Milena', host: 'cdn.viber.com', path: '/p', ts: 111 }),
      '',
      '   ',
      '{ not valid json',
      JSON.stringify({ name: 'no id here' }),
      JSON.stringify(['not', 'an', 'object']),
      JSON.stringify({ emId: IEVGEN, name: null, host: 'a', path: 'b', ts: 222 }),
    ];
    const records = parseInterceptedLines(lines);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      emId: MILENA,
      name: 'Milena',
      host: 'cdn.viber.com',
      path: '/p',
      ts: 111,
    });
    expect(records[1]?.emId).toBe(IEVGEN);
    expect(records[1]?.name).toBeNull();
  });

  it('canonicalises a bare (prefixless) emId to em: form', () => {
    const [record] = parseInterceptedLines([JSON.stringify({ emId: MILENA.slice(3), name: 'M' })]);
    expect(record?.emId).toBe(MILENA);
  });

  it('skips a record whose emId is not a valid em token', () => {
    expect(parseInterceptedLines([JSON.stringify({ emId: 'not-a-token', name: 'x' })])).toEqual([]);
  });
});

describe('mergeRosters', () => {
  const db: DbParticipant[] = [
    { memberId: MILENA_KEY, number: '+48794034881', name: 'Milena', contactName: null, viberName: 'Milena' },
    { memberId: ALICE_KEY, number: null, name: null, contactName: null, viberName: null },
    { memberId: 'Zm9vYmFyMDA=', number: null, name: 'Ghost', contactName: null, viberName: null },
  ];
  const intercepted = parseInterceptedLines([
    JSON.stringify({ emId: MILENA, name: 'Milena Intercept', host: 'h', path: 'p', ts: 1 }),
    JSON.stringify({ emId: ALICE, name: 'Alice Fetched', host: 'h', path: 'p', ts: 2 }),
    JSON.stringify({ emId: IEVGEN, name: 'Ievgen', host: 'h', path: 'p', ts: 3 }),
  ]);

  it('unions db + intercept keyed by member id, in db-then-intercept order', () => {
    const merged = mergeRosters(db, intercepted);
    expect(merged.map((m) => m.memberKey)).toEqual([MILENA_KEY, ALICE_KEY, 'Zm9vYmFyMDA=', IEVGEN_KEY]);
  });

  it('flags source db / intercept / both correctly', () => {
    const merged = mergeRosters(db, intercepted);
    expect(findMember(merged, MILENA)?.source).toBe('both');
    expect(findMember(merged, ALICE)?.source).toBe('both');
    expect(findMember(merged, 'Zm9vYmFyMDA=')?.source).toBe('db');
    expect(findMember(merged, IEVGEN)?.source).toBe('intercept');
  });

  it('prefers a real name over null and fills the full em id from the intercept', () => {
    const merged = mergeRosters(db, intercepted);
    const milena = findMember(merged, MILENA_KEY);
    expect(milena?.name).toBe('Milena'); // db name wins over the intercepted name
    expect(milena?.emId).toBe(MILENA); // db side only had the short key
    const alice = findMember(merged, ALICE_KEY);
    expect(alice?.name).toBe('Alice Fetched'); // db name was null, intercept fills it
    expect(alice?.emId).toBe(ALICE);
  });

  it('merges a db participant that carries the em token in its number field', () => {
    const rosterStyle: DbParticipant[] = [{ memberId: null, number: IEVGEN, name: 'Ievgen DB' }];
    const merged = mergeRosters(rosterStyle, intercepted.filter((r) => r.emId === IEVGEN));
    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe('both');
    expect(merged[0]?.emId).toBe(IEVGEN);
    expect(merged[0]?.memberKey).toBe(IEVGEN_KEY);
    expect(merged[0]?.name).toBe('Ievgen DB');
  });

  it('keeps an intercept whose token carries the real em marker', () => {
    const records = parseInterceptedLines([JSON.stringify({ emId: ABSENT, name: 'Marked' })]);
    expect(records).toHaveLength(1);
    const merged = mergeRosters([], records);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.emId).toBe(ABSENT);
    expect(merged[0]?.source).toBe('intercept');
  });

  it('drops an intercept whose token fails em-marker validation', () => {
    // The extraction regex is only a shape heuristic, so the bogus token gets
    // this far: it is the marker check inside mergeRosters that must reject it.
    expect(extractEmTokens(WRONG_MARKER)).toEqual([WRONG_MARKER]);
    const records = parseInterceptedLines([JSON.stringify({ emId: WRONG_MARKER, name: 'Bogus' })]);
    expect(records).toHaveLength(1);
    expect(mergeRosters([], records)).toEqual([]);
    expect(findMember(mergeRosters(db, [...intercepted, ...records]), WRONG_MARKER)).toBeUndefined();
  });

  it('never filters a db participant, even one whose value fails to decode', () => {
    const odd: DbParticipant[] = [{ memberId: null, number: WRONG_MARKER, name: 'Real Row' }];
    const merged = mergeRosters(odd, []);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe('Real Row');
    expect(merged[0]?.source).toBe('db');
  });

  it('keeps every real fixture token from data/rosters', () => {
    const records = parseInterceptedLines(
      REAL_TOKENS.map((emId, i) => JSON.stringify({ emId, name: `member ${String(i)}` })),
    );
    expect(records).toHaveLength(REAL_TOKENS.length);
    const merged = mergeRosters([], records);
    expect(merged).toHaveLength(REAL_TOKENS.length);
    expect(merged.map((m) => m.emId)).toEqual(REAL_TOKENS);
    expect(merged.every((m) => m.memberKey !== null)).toBe(true);
  });
});

describe('findMember', () => {
  const merged = mergeRosters(
    [{ memberId: MILENA_KEY, number: null, name: 'Milena' }],
    parseInterceptedLines([JSON.stringify({ emId: MILENA, name: 'Milena' })]),
  );

  it('matches an em:-prefixed query', () => {
    expect(findMember(merged, MILENA)?.name).toBe('Milena');
  });

  it('matches a bare (prefixless) token query', () => {
    expect(findMember(merged, MILENA.slice(3))?.emId).toBe(MILENA);
  });

  it('matches a short member-key query', () => {
    expect(findMember(merged, MILENA_KEY)?.emId).toBe(MILENA);
  });

  it('returns undefined for a token that is not present', () => {
    expect(findMember(merged, ABSENT)).toBeUndefined();
  });
});
