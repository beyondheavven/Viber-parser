import { describe, expect, it } from 'vitest';

import { nextSindex, parsePgPage } from '../../src/intercept/pg-paging.js';

/** A minimal but real-shaped General Query page. */
function page(sindex: number, size: number, last: boolean, memberCount = size): string {
  const members = Array.from({ length: memberCount }, (_, i) => ({
    name: `M${String(sindex + i)}`,
    foto: '',
    id: `em:token${String(sindex + i)}`,
  }));
  return JSON.stringify({
    result: 0,
    group: { id: '5907779393516782372', sindex, size, last, flags: 0, members },
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
    expect(nextSindex({ sindex: 0, size: 50, last: false, count: 50 })).toBe(50);
    expect(nextSindex({ sindex: 100, size: 50, last: false, count: 50 })).toBe(150);
  });

  it('uses the member count when size is zero, so paging never stalls', () => {
    expect(nextSindex({ sindex: 0, size: 0, last: false, count: 8 })).toBe(8);
  });
});
