import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parsePgRoster } from '../../src/features/participants/parse-pg-roster.js';

/**
 * Real Public-Group General Query reply pages captured from the live app
 * (see scripts/trace-pg-query.ts). Each page is the JSON string the hook read
 * out of onPGGeneralQueryReply's third argument.
 */
const PAGE_1 = readFileSync(new URL('./fixtures/pg-query-page-1.json', import.meta.url), 'utf8');
const PAGE_2 = readFileSync(new URL('./fixtures/pg-query-page-2.json', import.meta.url), 'utf8');

// First member of page 1, verified against the capture.
const IVAN_ID = 'em:AQADRyrqFP/iURpvAAAXKi7YK1a2vvmMtBsF7S/Vxwog34fQd1E9+xAl';
const SLAVIK_ID = 'em:AQAAbOuLMZvMLhpvAAANzTbxL2dpyxZMZfsB7VW7o70TX4jFMHg23ziw';

describe('parsePgRoster', () => {
  it('extracts every member of one page as {emid, name, role}', () => {
    const members = parsePgRoster([PAGE_1]);
    expect(members).toHaveLength(50);
    const ivan = members.find((member) => member.emid === IVAN_ID);
    expect(ivan).toEqual({ emid: IVAN_ID, name: 'Ivan', role: null });
    // Every emid is a canonical em: token and every member has a name here.
    expect(members.every((member) => /^em:AQ[A-Za-z0-9+/]{54}$/.test(member.emid))).toBe(true);
    expect(members.every((member) => member.name !== null && member.name.trim() !== '')).toBe(true);
  });

  it('role is null when the page carries no role field (the real schema)', () => {
    const members = parsePgRoster([PAGE_1]);
    expect(members.every((member) => member.role === null)).toBe(true);
  });

  it('deduplicates the four delegate copies of the same page down to one set', () => {
    // The General Query reply is dispatched through four JNI delegates, so the
    // identical page arrives four times in a real capture.
    const members = parsePgRoster([PAGE_1, PAGE_1, PAGE_1, PAGE_1]);
    expect(members).toHaveLength(50);
  });

  it('unions distinct pages and dedupes by emid', () => {
    const members = parsePgRoster([PAGE_1, PAGE_2]);
    expect(members).toHaveLength(100);
    const ids = new Set(members.map((member) => member.emid));
    expect(ids.has(IVAN_ID)).toBe(true);
    expect(ids.has(SLAVIK_ID)).toBe(true);
    expect(ids.size).toBe(100);
  });

  it('skips blank and unparseable reply strings without throwing', () => {
    const members = parsePgRoster(['', '   ', 'not json', '{}', '[]', PAGE_1]);
    expect(members).toHaveLength(50);
  });

  it('skips members whose id is not a valid em token', () => {
    const page = JSON.stringify({
      result: 0,
      group: {
        members: [
          { name: 'Real', id: IVAN_ID },
          { name: 'Junk', id: 'not-a-token' },
          { name: 'Empty', id: '' },
          { name: 'Missing' },
        ],
      },
    });
    const members = parsePgRoster([page]);
    expect(members).toEqual([{ emid: IVAN_ID, name: 'Real', role: null }]);
  });

  it('reads a numeric role when a member carries one', () => {
    const page = JSON.stringify({
      group: { members: [{ name: 'Admin', id: SLAVIK_ID, role: 2 }] },
    });
    const [member] = parsePgRoster([page]);
    expect(member).toEqual({ emid: SLAVIK_ID, name: 'Admin', role: 2 });
  });

  it('never extracts a phone number field, only emid/name/role', () => {
    // Guard the project scope boundary: a real phone number in the page must
    // not leak into the roster.
    const page = JSON.stringify({
      group: { members: [{ name: 'HasNumber', id: IVAN_ID, number: '+15551234567' }] },
    });
    const [member] = parsePgRoster([page]);
    expect(Object.keys(member ?? {}).sort()).toEqual(['emid', 'name', 'role']);
    expect(JSON.stringify(member)).not.toContain('15551234567');
  });

  it('canonicalises a bare AQ… id (no em: prefix) to an em: token', () => {
    const bare = IVAN_ID.slice('em:'.length);
    const page = JSON.stringify({ group: { members: [{ name: 'Bare', id: bare }] } });
    const [member] = parsePgRoster([page]);
    expect(member?.emid).toBe(IVAN_ID);
  });

  it('fills a null name from a later duplicate of the same member', () => {
    const first = JSON.stringify({ group: { members: [{ name: '', id: IVAN_ID }] } });
    const second = JSON.stringify({ group: { members: [{ name: 'Ivan', id: IVAN_ID }] } });
    const members = parsePgRoster([first, second]);
    expect(members).toEqual([{ emid: IVAN_ID, name: 'Ivan', role: null }]);
  });
});
