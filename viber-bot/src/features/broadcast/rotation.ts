/**
 * Picks the next copy variant from a mailing pool. Strategies are
 * deterministic given the same inputs (except `random`, which uses the
 * injected RNG).
 */

export const ROTATION_STRATEGIES = ['round-robin', 'random', 'shuffle-cycle'] as const;

export type RotationStrategy = (typeof ROTATION_STRATEGIES)[number];

export interface RotationInput {
  messages: readonly string[];
  strategy: RotationStrategy;
  conversationId: number;
  /** Successful sends of this campaign into this chat so far. */
  sendCountForChat: number;
  /** Index used on the previous successful send into this chat, if any. */
  lastMessageIndex: number | null;
  /** Override for tests. Defaults to `Math.random`. */
  random?: () => number;
}

export interface RotationPick {
  index: number;
  text: string;
}

export function pickMessage(input: RotationInput): RotationPick {
  if (input.messages.length === 0) {
    throw new Error('Message pool is empty.');
  }

  const index = pickIndex(input.messages.length, input);
  const text = input.messages[index];
  if (text === undefined) {
    throw new Error(`Rotation produced out-of-range index ${String(index)}.`);
  }
  if (text.trim() === '') {
    throw new Error(`Selected message at index ${String(index)} is empty.`);
  }
  return { index, text };
}

function pickIndex(length: number, input: RotationInput): number {
  switch (input.strategy) {
    case 'round-robin':
      return input.sendCountForChat % length;
    case 'random':
      return pickRandomIndex(length, input.lastMessageIndex, input.random ?? Math.random);
    case 'shuffle-cycle':
      return pickShuffledIndex(length, input.conversationId, input.sendCountForChat);
  }
}

/**
 * Uniform pick. When the pool has more than one variant, the previous index
 * is excluded so consecutive sends use different copy.
 */
function pickRandomIndex(
  length: number,
  lastMessageIndex: number | null,
  random: () => number,
): number {
  if (length === 1) return 0;

  const roll = Math.floor(clamp01(random()) * length);
  if (lastMessageIndex === null || roll !== lastMessageIndex) return roll;

  const shifted = Math.floor(clamp01(random()) * (length - 1));
  return shifted >= lastMessageIndex ? shifted + 1 : shifted;
}

/**
 * Fisher–Yates shuffle of `[0..n)` seeded by chat id and cycle number.
 * Within one cycle every text is used once; the next cycle is a new shuffle.
 * Different chats get different orders even on the same send count.
 */
function pickShuffledIndex(length: number, conversationId: number, sendCountForChat: number): number {
  const cycle = Math.floor(sendCountForChat / length);
  const offset = sendCountForChat % length;
  const order = shuffledIndices(length, hashSeed(conversationId, cycle));
  const index = order[offset];
  if (index === undefined) {
    throw new Error(`Shuffle cycle produced out-of-range offset ${String(offset)}.`);
  }
  return index;
}

export function shuffledIndices(length: number, seed: number): number[] {
  const indices = Array.from({ length }, (_, index) => index);
  const random = mulberry32(seed);
  for (let i = length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const current = indices[i];
    const swap = indices[j];
    if (current === undefined || swap === undefined) continue;
    indices[i] = swap;
    indices[j] = current;
  }
  return indices;
}

function hashSeed(conversationId: number, cycle: number): number {
  // Keep it in uint32 without colliding nearby (id, cycle) pairs.
  return ((Math.imul(conversationId, 0x9e3779b1) ^ Math.imul(cycle + 1, 0x85ebca77)) >>> 0);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value >= 1) return 0.999999999999;
  return value;
}
