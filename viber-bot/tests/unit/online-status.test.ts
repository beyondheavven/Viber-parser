import { describe, expect, it } from 'vitest';
import { normalizeLastSeenTimestamp } from '../../src/automation/frida/online-status.service.js';

describe('normalizeLastSeenTimestamp', () => {
  it('preserves epoch milliseconds returned by current Viber builds', () => {
    expect(normalizeLastSeenTimestamp(1_788_632_355_799)).toBe(1_788_632_355_799);
  });

  it('converts epoch seconds returned by older Viber builds to milliseconds', () => {
    expect(normalizeLastSeenTimestamp(1_788_632_355)).toBe(1_788_632_355_000);
  });

  it('rejects absent and invalid timestamps', () => {
    expect(normalizeLastSeenTimestamp(null)).toBeNull();
    expect(normalizeLastSeenTimestamp(0)).toBeNull();
    expect(normalizeLastSeenTimestamp('invalid')).toBeNull();
  });
});
