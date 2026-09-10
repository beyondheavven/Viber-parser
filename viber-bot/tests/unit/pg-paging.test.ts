import { describe, expect, it } from 'vitest';

import { nextSindex, pageAnswers, parsePgPage } from '../../src/intercept/pg-paging.js';
import type { PgPage } from '../../src/intercept/pg-paging.js';

const OUR_GROUP = '5907779393516782372';

/** A parsed page carrying just the cursor fields a caller reads. */
function cursor(sindex: number, size: number, count: number, last = false): PgPage {
  return { groupId: OUR_GROUP, result: 0, sindex, size, last, count };
}

/** A minimal but real-shaped General Query page. */
function page(
  sindex: number,
  size: number,
  last: boolean,
  memberCount = size,
  groupId = OUR_GROUP,
): string {
  const members = Array.from({ length: memberCount }, (_, i) => ({
    name: `M${String(sindex + i)}`,
    foto: '',
    id: `em:token${String(sindex + i)}`,
  }));
  return JSON.stringify({
    result: 0,
    group: { id: groupId, sindex, size, last, flags: 0, members },
  });
}

describe('parsePgPage', () => {
  it('extracts sindex, size, last and member count from a real page shape', () => {
    const parsed = parsePgPage(page(50, 50, false));
    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({ sindex: 50, size: 50, last: false, count: 50 });
  });

  it('reads the last-page flag', () => {
    expect(parsePgPage(page(1600, 50, true, 8))?.last).toBe(true);
    expect(parsePgPage(page(1600, 50, true, 8))?.count).toBe(8);
  });

  it('returns null for non-page JSON', () => {
    expect(parsePgPage('{"result":0}')).toBeNull();
    expect(parsePgPage('{"group":{"members":[]}}')).toBeNull();
  });

  it('returns null for malformed input rather than throwing', () => {
    expect(parsePgPage('not json')).toBeNull();
    expect(parsePgPage('')).toBeNull();
  });

  it('falls back to member count when size is absent', () => {
    const raw = JSON.stringify({ group: { sindex: 0, last: false, members: [{ id: 'em:a' }] } });
    expect(parsePgPage(raw)).toMatchObject({ sindex: 0, size: 1, count: 1 });
  });
});

describe('nextSindex', () => {
  it('advances by the page size', () => {
    expect(nextSindex(cursor(0, 50, 50))).toBe(50);
    expect(nextSindex(cursor(100, 50, 50))).toBe(150);
  });

  it('uses the member count when size is zero, so paging never stalls', () => {
    expect(nextSindex(cursor(0, 0, 8))).toBe(8);
  });
});

describe('pageAnswers', () => {
  it('accepts a page for the requested group at an offset we asked for', () => {
    const parsed = parsePgPage(page(50, 50, false))!;
    expect(pageAnswers(parsed, OUR_GROUP, new Set([0, 50]))).toBe(true);
  });

  it('rejects a page belonging to another conversation', () => {
    const stray = parsePgPage(page(0, 50, true, 8, '111222333444555666'))!;
    expect(stray.last).toBe(true);
    expect(pageAnswers(stray, OUR_GROUP, new Set([0]))).toBe(false);
  });

  it('rejects an offset this run never requested', () => {
    const parsed = parsePgPage(page(300, 50, false))!;
    expect(pageAnswers(parsed, OUR_GROUP, new Set([0, 50]))).toBe(false);
  });

  it('accepts a page whose group id the server omitted', () => {
    const raw = JSON.stringify({ result: 0, group: { sindex: 0, size: 1, members: [{ id: 'em:a' }] } });
    const parsed = parsePgPage(raw)!;
    expect(parsed.groupId).toBeNull();
    expect(pageAnswers(parsed, OUR_GROUP, new Set([0]))).toBe(true);
  });
});
