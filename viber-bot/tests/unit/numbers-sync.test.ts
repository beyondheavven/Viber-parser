import { describe, expect, it } from 'vitest';

import {
  defaultNumbersSyncTimeoutMs,
  parseSyncedCount,
} from '../../src/automation/lifecycle/viber-lifecycle.service.js';

describe('parseSyncedCount', () => {
  it('reads the count from the line after the PRAGMA echo', () => {
    expect(parseSyncedCount('10000\n1587\n')).toBe(1587);
    expect(parseSyncedCount('10000\r\n0')).toBe(0);
  });

  it('treats the PRAGMA echo alone as no answer, not as a count of 10000', () => {
    expect(parseSyncedCount('10000')).toBeNaN();
    expect(parseSyncedCount('10000\nError: database is locked')).toBeNaN();
    expect(parseSyncedCount('')).toBeNaN();
  });
});

describe('defaultNumbersSyncTimeoutMs', () => {
  it('keeps 45 s for small groups and grows with the roster up to five minutes', () => {
    expect(defaultNumbersSyncTimeoutMs(60)).toBe(45_000);
    expect(defaultNumbersSyncTimeoutMs(19_197)).toBe(191_970);
    expect(defaultNumbersSyncTimeoutMs(100_000)).toBe(300_000);
  });
});
