/**
 * Chooses the next chat to send into, honouring a per-chat cooldown so the
 * same group is not hit faster than `minIntervalPerChatMs`.
 *
 * Walks the campaign's group list from `nextGroupIndex` and takes the first
 * chat that is due. If every chat is still cooling down, tells the caller how
 * long to wait.
 */

export interface SelectTargetInput {
  conversationIds: readonly number[];
  nextGroupIndex: number;
  minIntervalPerChatMs: number;
  lastSentAtByChat: ReadonlyMap<number, number>;
  now: number;
}

export type SelectTargetResult =
  | { kind: 'send'; conversationId: number; nextGroupIndex: number }
  | { kind: 'wait'; waitMs: number }
  | { kind: 'done' };

export function selectNextTarget(input: SelectTargetInput): SelectTargetResult {
  const ids = input.conversationIds;
  const count = ids.length;
  if (count === 0) return { kind: 'done' };

  const start = ((input.nextGroupIndex % count) + count) % count;
  let soonestWait = Number.POSITIVE_INFINITY;

  for (let offset = 0; offset < count; offset += 1) {
    const index = (start + offset) % count;
    const conversationId = ids[index];
    if (conversationId === undefined) continue;

    const lastSentAt = input.lastSentAtByChat.get(conversationId);
    const remaining =
      lastSentAt === undefined ? 0 : input.minIntervalPerChatMs - (input.now - lastSentAt);

    if (remaining <= 0) {
      return {
        kind: 'send',
        conversationId,
        nextGroupIndex: (index + 1) % count,
      };
    }

    soonestWait = Math.min(soonestWait, remaining);
  }

  return { kind: 'wait', waitMs: Math.max(0, soonestWait) };
}

/** True once a one-shot campaign has attempted every selected group. */
export function isOneShotComplete(attemptsThisRun: number, groupCount: number): boolean {
  return groupCount <= 0 || attemptsThisRun >= groupCount;
}

export const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes from local midnight. `09:30` → 570. */
export function parseClockMinutes(value: string): number | null {
  const match = CLOCK_PATTERN.exec(value.trim());
  if (!match || match[1] === undefined || match[2] === undefined) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isWithinWorkingHours(
  now: Date,
  activeFrom: string | null,
  activeTo: string | null,
): boolean {
  return msUntilWorkingHours(now, activeFrom, activeTo) === 0;
}

/**
 * How long to wait before the next send is allowed by `activeFrom`/`activeTo`.
 * Local time of the machine. Equal from/to or missing bounds mean 24/7.
 * If from > to, the window wraps past midnight (e.g. 22:00–06:00).
 * The end minute is exclusive: 09:00–21:00 allows 20:59 and stops at 21:00.
 */
export function msUntilWorkingHours(
  now: Date,
  activeFrom: string | null,
  activeTo: string | null,
): number {
  if (!activeFrom || !activeTo) return 0;

  const start = parseClockMinutes(activeFrom);
  const end = parseClockMinutes(activeTo);
  if (start === null || end === null) return 0;
  if (start === end) return 0;

  const current = now.getHours() * 60 + now.getMinutes();
  const inWindow =
    start < end ? current >= start && current < end : current >= start || current < end;
  if (inWindow) return 0;

  let waitMinutes = start - current;
  if (waitMinutes <= 0) waitMinutes += 24 * 60;
  const elapsedInMinute = now.getSeconds() * 1_000 + now.getMilliseconds();
  return waitMinutes * 60_000 - elapsedInMinute;
}
