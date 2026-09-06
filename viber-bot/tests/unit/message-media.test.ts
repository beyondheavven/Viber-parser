import { describe, expect, it } from 'vitest';
import type { Message } from '../../src/viber/repository.js';
import {
  MEDIA_MERGE_WINDOW_MS,
  extractMediaUris,
  extractTextBody,
  isMediaOnly,
  mergeMediaWithText,
  normalizeStoredMedia,
} from '../../src/messages/message-media.util.js';

function msg(overrides: Partial<Message> & Pick<Message, 'id' | 'body' | 'date'>): Message {
  return {
    conversationId: 20,
    token: String(overrides.id),
    senderId: 42,
    senderMemberId: 'member',
    senderName: 'Иван',
    senderNumber: '+380501111111',
    outgoing: false,
    extraMime: null,
    mediaUri: null,
    unread: false,
    ...overrides,
  };
}

describe('message media merge', () => {
  const imageUri =
    'content://com.viber.voip.provider.internal_files/pg/0-04-05-aaa/PG_MEDIA/jpg/400';

  it('detects content:// bodies as media-only', () => {
    expect(isMediaOnly(msg({ id: 1, body: imageUri, date: new Date() }))).toBe(true);
    expect(extractTextBody(msg({ id: 1, body: imageUri, date: new Date() }))).toBeNull();
    expect(extractMediaUris(msg({ id: 1, body: imageUri, date: new Date() }))).toEqual([imageUri]);
  });

  it('moves a content:// body into mediaUris when hydrating stored rows', () => {
    const normalized = normalizeStoredMedia({
      body: imageUri,
      mediaUris: undefined,
    });
    expect(normalized.body).toBeNull();
    expect(normalized.hasMedia).toBe(true);
    expect(normalized.mediaUris).toEqual([imageUri]);
  });

  it('keeps caption text when the same row also has extra_uri', () => {
    const row = msg({
      id: 2,
      body: 'Київ — Варшава 0501234567',
      date: new Date(),
      mediaUri: imageUri,
    });
    expect(extractTextBody(row)).toBe('Київ — Варшава 0501234567');
    expect(extractMediaUris(row)).toEqual([imageUri]);
  });

  it('merges an image followed by a caption from the same sender', () => {
    const t0 = new Date('2026-09-05T12:00:00Z');
    const t1 = new Date('2026-09-05T12:00:20Z');
    const { emitted, held } = mergeMediaWithText(
      [
        msg({ id: 10, body: imageUri, date: t0 }),
        msg({ id: 11, body: '1 пас Львів-Вроцлав\n+380683929263', date: t1 }),
      ],
      { now: t1.getTime() + 60_000 },
    );

    expect(held).toHaveLength(0);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.body).toContain('+380683929263');
    expect(emitted[0]?.hasMedia).toBe(true);
    expect(emitted[0]?.mediaUris).toEqual([imageUri]);
    expect(emitted[0]?.sourceIds).toEqual([10, 11]);
    expect(emitted[0]?.id).toBe(11);
  });

  it('merges a caption followed by an image from the same sender', () => {
    const t0 = new Date('2026-09-05T12:00:00Z');
    const t1 = new Date('2026-09-05T12:00:08Z');
    const { emitted } = mergeMediaWithText(
      [
        msg({ id: 20, body: 'Завтра Київ-Антверпен +380(96)6261020', date: t0 }),
        msg({ id: 21, body: imageUri, date: t1 }),
      ],
      { now: t1.getTime() + 60_000 },
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.body).toContain('Київ-Антверпен');
    expect(emitted[0]?.mediaUris).toEqual([imageUri]);
    expect(emitted[0]?.sourceIds).toEqual([20, 21]);
  });

  it('does not glue two consecutive text ads even when they are close in time', () => {
    const t0 = new Date('2026-09-05T12:00:00Z');
    const t1 = new Date('2026-09-05T12:00:05Z');
    const { emitted } = mergeMediaWithText(
      [
        msg({ id: 30, body: 'Первое объявление 0501111111', date: t0 }),
        msg({ id: 31, body: 'Второе объявление 0502222222', date: t1 }),
      ],
      { now: t1.getTime() + 60_000 },
    );

    expect(emitted).toHaveLength(2);
    expect(emitted[0]?.sourceIds).toEqual([30]);
    expect(emitted[1]?.sourceIds).toEqual([31]);
  });

  it('attaches a middle image to the preceding text, not the following ad', () => {
    const t0 = new Date('2026-09-05T12:00:00Z');
    const t1 = new Date('2026-09-05T12:00:10Z');
    const t2 = new Date('2026-09-05T12:00:14Z');
    const { emitted } = mergeMediaWithText(
      [
        msg({ id: 40, body: 'Первое 0501111111', date: t0 }),
        msg({ id: 41, body: imageUri, date: t1 }),
        msg({ id: 42, body: 'Второе 0502222222', date: t2 }),
      ],
      { now: t2.getTime() + 60_000 },
    );

    expect(emitted).toHaveLength(2);
    expect(emitted[0]?.sourceIds).toEqual([40, 41]);
    expect(emitted[0]?.mediaUris).toEqual([imageUri]);
    expect(emitted[1]?.sourceIds).toEqual([42]);
    expect(emitted[1]?.hasMedia).toBe(false);
  });

  it('holds a trailing fresh media-only row so the next poll can attach the caption', () => {
    const t0 = new Date('2026-09-05T12:00:00Z');
    const { emitted, held } = mergeMediaWithText([msg({ id: 50, body: imageUri, date: t0 })], {
      now: t0.getTime() + 5_000,
    });

    expect(emitted).toHaveLength(0);
    expect(held).toHaveLength(1);
    expect(held[0]?.id).toBe(50);
  });

  it('emits an old media-only row after the hold window', () => {
    const t0 = new Date('2026-09-05T12:00:00Z');
    const { emitted, held } = mergeMediaWithText([msg({ id: 51, body: imageUri, date: t0 })], {
      now: t0.getTime() + MEDIA_MERGE_WINDOW_MS + 1,
    });

    expect(held).toHaveLength(0);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.hasMedia).toBe(true);
    expect(emitted[0]?.body).toBeNull();
  });
});
