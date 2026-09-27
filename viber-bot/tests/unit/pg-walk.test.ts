import { describe, expect, it } from 'vitest';

import { PgWalk } from '../../src/features/participants/pg-walk.js';

const OUR_GROUP = '5907779393516782372';
const OTHER_GROUP = '111222333444555666';

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

/** A walk wired to a recording `request` hook. */
function walkOf() {
  const requested: number[] = [];
  const warnings: string[] = [];
  const walk = new PgWalk(OUR_GROUP, {
    request: (sindex) => requested.push(sindex),
    onWarning: (message) => warnings.push(message),
  });
  return { walk, requested, warnings };
}

/** Feeds a full roster of `total` members, 50 per page. */
function walkWholeRoster(total: number) {
  const { walk, requested, warnings } = walkOf();
  walk.start();
  for (let offset = 0; offset < total; offset += 50) {
    const count = Math.min(50, total - offset);
    walk.offer(page(offset, 50, offset + count >= total, count));
  }
  return { summary: walk.summary(), requested, warnings };
}

describe('PgWalk', () => {
  it('pages through a whole roster and reports it complete', () => {
    const { summary, requested } = walkWholeRoster(1_632);

    expect(summary.lastReached).toBe(true);
    expect(summary.collectedMembers).toBe(1_632);
    expect(summary.expectedTotal).toBe(1_632);
    expect(summary.pagesCount).toBe(33);
    expect(requested[0]).toBe(0);
    expect(requested.at(-1)).toBe(1_600);
    expect(summary.ignoredPages).toBe(0);
  });

  it('ignores a stray last page from another conversation', () => {
    const { walk, requested } = walkOf();
    walk.start();

    // Viber issues its own General Query for an unrelated chat; that roster is
    // small, so its first page is also its last.
    expect(walk.offer(page(0, 50, true, 3, OTHER_GROUP))).toBe('ignored');

    expect(walk.isDone).toBe(false);
    expect(walk.offer(page(0, 50, false))).toBe('accepted');
    expect(requested).toEqual([0, 50]);

    const summary = walk.summary();
    expect(summary.lastReached).toBe(false);
    expect(summary.ignoredPages).toBe(1);
    expect(summary.collectedMembers).toBe(50);
  });

  it('keeps another conversation’s members out of the collected pages', () => {
    const { walk } = walkOf();
    walk.start();
    walk.offer(page(0, 50, false, 50, OTHER_GROUP));
    walk.offer(page(0, 50, false));

    const summary = walk.summary();
    expect(summary.rawPageJsons).toHaveLength(1);
    expect(summary.rawPageJsons[0]).toContain(OUR_GROUP);
  });

  it('ignores an offset it never requested', () => {
    const { walk } = walkOf();
    walk.start();
    expect(walk.offer(page(300, 50, false))).toBe('ignored');
    expect(walk.summary().collectedMembers).toBe(0);
  });

  it('counts a page once however many delegates deliver it', () => {
    const { walk, requested } = walkOf();
    walk.start();
    for (let copy = 0; copy < 5; copy += 1) walk.offer(page(0, 50, false));

    const summary = walk.summary();
    expect(summary.pagesCount).toBe(1);
    expect(summary.collectedMembers).toBe(50);
    expect(summary.rawPageJsons).toHaveLength(1);
    expect(requested).toEqual([0, 50]);
  });

  it('refuses to call a walk complete when a middle page never arrived', () => {
    const { walk, warnings } = walkOf();
    walk.start();
    walk.offer(page(0, 50, false)); // asks for 50
    walk.offer(page(50, 50, false)); // asks for 100
    // The reply for 100 goes missing; a later page still claims to be the last.
    walk.offer(page(100, 50, false));
    walk.offer(page(150, 50, true, 50));

    const summary = walk.summary();
    expect(summary.expectedTotal).toBe(200);
    expect(summary.collectedMembers).toBe(200);
    expect(summary.lastReached).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  it('reports a short roster when the final page implies more than arrived', () => {
    const { walk, warnings } = walkOf();
    walk.start();
    walk.offer(page(0, 50, false, 10)); // a short page: 10 members, asks for 50
    walk.offer(page(50, 50, true, 50)); // last page claims a total of 100

    const summary = walk.summary();
    expect(summary.expectedTotal).toBe(100);
    expect(summary.collectedMembers).toBe(60);
    expect(summary.lastReached).toBe(false);
    expect(warnings.join(' ')).toContain('100');
  });

  it('discards an error reply instead of treating it as a page', () => {
    const { walk } = walkOf();
    walk.start();
    const errorPage = JSON.stringify({
      result: 7,
      group: { id: OUR_GROUP, sindex: 0, size: 0, last: true, members: [] },
    });
    expect(walk.offer(errorPage)).toBe('ignored');
    expect(walk.isDone).toBe(false);
    expect(walk.summary().ignoredPages).toBe(1);
  });

  it('carries agent query errors into the summary', () => {
    const { walk } = walkOf();
    walk.start();
    walk.noteQueryError('gp0.w path failed: TypeError');
    expect(walk.summary().queryErrors).toEqual(['gp0.w path failed: TypeError']);
  });

  it('stops requesting once the roster is done', () => {
    const { requested } = walkWholeRoster(100);
    expect(requested).toEqual([0, 50]);
  });
});
