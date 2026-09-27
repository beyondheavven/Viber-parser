import { describe, expect, it } from 'vitest';
import { pickMessage, shuffledIndices } from '../../src/features/broadcast/rotation.js';

describe('pickMessage', () => {
  const messages = ['alpha', 'beta', 'gamma'];

  it('throws when the pool is empty', () => {
    expect(() =>
      pickMessage({
        messages: [],
        strategy: 'round-robin',
        conversationId: 1,
        sendCountForChat: 0,
        lastMessageIndex: null,
      }),
    ).toThrow(/empty/i);
  });

  it('round-robin walks the pool in order and wraps', () => {
    const picks = [0, 1, 2, 3, 4].map((sendCountForChat) =>
      pickMessage({
        messages,
        strategy: 'round-robin',
        conversationId: 26,
        sendCountForChat,
        lastMessageIndex: null,
      }),
    );

    expect(picks.map((pick) => pick.text)).toEqual(['alpha', 'beta', 'gamma', 'alpha', 'beta']);
    expect(picks.map((pick) => pick.index)).toEqual([0, 1, 2, 0, 1]);
  });

  it('random never repeats the previous index when the pool has more than one text', () => {
    const sequence = [0.1, 0.1, 0.9];
    let cursor = 0;
    const random = (): number => {
      const value = sequence[cursor] ?? 0;
      cursor += 1;
      return value;
    };

    const first = pickMessage({
      messages,
      strategy: 'random',
      conversationId: 1,
      sendCountForChat: 0,
      lastMessageIndex: null,
      random,
    });
    expect(first.index).toBe(0);

    const second = pickMessage({
      messages,
      strategy: 'random',
      conversationId: 1,
      sendCountForChat: 1,
      lastMessageIndex: first.index,
      random,
    });
    expect(second.index).not.toBe(first.index);
  });

  it('random still works with a single message', () => {
    const pick = pickMessage({
      messages: ['only'],
      strategy: 'random',
      conversationId: 1,
      sendCountForChat: 9,
      lastMessageIndex: 0,
      random: () => 0.99,
    });
    expect(pick).toEqual({ index: 0, text: 'only' });
  });

  it('shuffle-cycle uses every message once per cycle and then reshuffles', () => {
    const firstCycle = [0, 1, 2].map((sendCountForChat) =>
      pickMessage({
        messages,
        strategy: 'shuffle-cycle',
        conversationId: 42,
        sendCountForChat,
        lastMessageIndex: null,
      }).index,
    );

    expect(new Set(firstCycle).size).toBe(3);

    const secondCycle = [3, 4, 5].map((sendCountForChat) =>
      pickMessage({
        messages,
        strategy: 'shuffle-cycle',
        conversationId: 42,
        sendCountForChat,
        lastMessageIndex: null,
      }).index,
    );

    expect(new Set(secondCycle).size).toBe(3);
  });

  it('shuffle-cycle is deterministic for the same chat and send count', () => {
    const input = {
      messages,
      strategy: 'shuffle-cycle' as const,
      conversationId: 77,
      sendCountForChat: 4,
      lastMessageIndex: null,
    };
    expect(pickMessage(input)).toEqual(pickMessage(input));
  });

  it('shuffle-cycle gives different chats different orders', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f'];
    const orderFor = (conversationId: number): string =>
      pool
        .map((_, sendCountForChat) =>
          pickMessage({
            messages: pool,
            strategy: 'shuffle-cycle',
            conversationId,
            sendCountForChat,
            lastMessageIndex: null,
          }).index,
        )
        .join(',');

    expect(orderFor(1)).not.toEqual(orderFor(2));
  });

  it('rejects a blank slot that rotation landed on', () => {
    expect(() =>
      pickMessage({
        messages: ['keep', '  '],
        strategy: 'round-robin',
        conversationId: 1,
        sendCountForChat: 1,
        lastMessageIndex: null,
      }),
    ).toThrow(/empty/i);
  });
});

describe('shuffledIndices', () => {
  it('returns a permutation of 0..n-1', () => {
    const indices = shuffledIndices(5, 12345);
    expect(indices.slice().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('is stable for a given seed', () => {
    expect(shuffledIndices(8, 99)).toEqual(shuffledIndices(8, 99));
  });
});
