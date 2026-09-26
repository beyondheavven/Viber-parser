import { describe, expect, it } from 'vitest';
import { isOneShotComplete, isWithinWorkingHours, msUntilWorkingHours, selectNextTarget } from '../../src/features/broadcast/schedule.js';

describe('selectNextTarget', () => {
  const ids = [10, 20, 30] as const;

  it('returns done when no groups are selected', () => {
    expect(
      selectNextTarget({
        conversationIds: [],
        nextGroupIndex: 0,
        minIntervalPerChatMs: 1_000,
        lastSentAtByChat: new Map(),
        now: 0,
      }),
    ).toEqual({ kind: 'done' });
  });

  it('picks the group at nextGroupIndex when none have been sent to yet', () => {
    expect(
      selectNextTarget({
        conversationIds: ids,
        nextGroupIndex: 1,
        minIntervalPerChatMs: 60_000,
        lastSentAtByChat: new Map(),
        now: 1_000,
      }),
    ).toEqual({ kind: 'send', conversationId: 20, nextGroupIndex: 2 });
  });

  it('skips a chat that is still inside its cooldown and takes the next due one', () => {
    expect(
      selectNextTarget({
        conversationIds: ids,
        nextGroupIndex: 0,
        minIntervalPerChatMs: 60_000,
        lastSentAtByChat: new Map([[10, 50_000]]),
        now: 80_000,
      }),
    ).toEqual({ kind: 'send', conversationId: 20, nextGroupIndex: 2 });
  });

  it('wraps around the group list', () => {
    expect(
      selectNextTarget({
        conversationIds: ids,
        nextGroupIndex: 3,
        minIntervalPerChatMs: 1,
        lastSentAtByChat: new Map(),
        now: 0,
      }),
    ).toEqual({ kind: 'send', conversationId: 10, nextGroupIndex: 1 });
  });

  it('asks the caller to wait when every chat is still cooling down', () => {
    const result = selectNextTarget({
      conversationIds: ids,
      nextGroupIndex: 0,
      minIntervalPerChatMs: 60_000,
      lastSentAtByChat: new Map([
        [10, 10_000],
        [20, 40_000],
        [30, 20_000],
      ]),
      now: 50_000,
    });

    expect(result).toEqual({ kind: 'wait', waitMs: 20_000 });
  });

  it('treats a chat as due exactly when the cooldown elapses', () => {
    expect(
      selectNextTarget({
        conversationIds: [10],
        nextGroupIndex: 0,
        minIntervalPerChatMs: 15_000,
        lastSentAtByChat: new Map([[10, 5_000]]),
        now: 20_000,
      }),
    ).toEqual({ kind: 'send', conversationId: 10, nextGroupIndex: 0 });
  });
});

describe('isOneShotComplete', () => {
  it('is complete after one attempt per group', () => {
    expect(isOneShotComplete(3, 3)).toBe(true);
    expect(isOneShotComplete(2, 3)).toBe(false);
    expect(isOneShotComplete(0, 0)).toBe(true);
  });
});

describe('working hours', () => {
  const at = (hours: number, minutes: number, seconds = 0): Date =>
    new Date(2026, 8, 6, hours, minutes, seconds, 0);

  it('is always open when bounds are missing or equal', () => {
    expect(msUntilWorkingHours(at(3, 0), null, null)).toBe(0);
    expect(msUntilWorkingHours(at(3, 0), '09:00', '09:00')).toBe(0);
  });

  it('is open inside a same-day window and closed at the end minute', () => {
    expect(isWithinWorkingHours(at(9, 0), '09:00', '21:00')).toBe(true);
    expect(isWithinWorkingHours(at(20, 59), '09:00', '21:00')).toBe(true);
    expect(isWithinWorkingHours(at(21, 0), '09:00', '21:00')).toBe(false);
    expect(isWithinWorkingHours(at(8, 59), '09:00', '21:00')).toBe(false);
  });

  it('waits until the next opening when currently closed', () => {
    expect(msUntilWorkingHours(at(8, 30), '09:00', '21:00')).toBe(30 * 60_000);
    expect(msUntilWorkingHours(at(21, 0), '09:00', '21:00')).toBe(12 * 60 * 60_000);
  });

  it('supports an overnight window', () => {
    expect(isWithinWorkingHours(at(23, 0), '22:00', '06:00')).toBe(true);
    expect(isWithinWorkingHours(at(5, 0), '22:00', '06:00')).toBe(true);
    expect(isWithinWorkingHours(at(6, 0), '22:00', '06:00')).toBe(false);
    expect(isWithinWorkingHours(at(12, 0), '22:00', '06:00')).toBe(false);
    expect(msUntilWorkingHours(at(12, 0), '22:00', '06:00')).toBe(10 * 60 * 60_000);
  });
});
