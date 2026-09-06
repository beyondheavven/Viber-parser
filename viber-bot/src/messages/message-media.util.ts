import type { Message } from '../viber/repository.js';

/** Pair a photo with its caption when they land as two nearby Viber rows. */
export const MEDIA_MERGE_WINDOW_MS = 90_000;

const MEDIA_URI_RE = /^(content|file|android\.resource):\/\//i;
const HTTP_IMAGE_RE = /^https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp)(?:\?|$)/i;

export interface MediaMergedMessage extends Message {
  mediaUris: string[];
  hasMedia: boolean;
  /** Every `messages._id` that was folded into this one logical post. */
  sourceIds: number[];
}

export interface MergeMediaResult {
  emitted: MediaMergedMessage[];
  /** Trailing fresh media-only rows, held until a caption (or the window) arrives. */
  held: Message[];
}

export function isMediaUri(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length === 0) return false;
  return MEDIA_URI_RE.test(trimmed) || HTTP_IMAGE_RE.test(trimmed);
}

export function extractMediaUris(msg: Pick<Message, 'body' | 'mediaUri'>): string[] {
  const uris: string[] = [];
  const mediaUri = msg.mediaUri?.trim() ?? '';
  if (isMediaUri(mediaUri)) uris.push(mediaUri);
  const body = msg.body?.trim() ?? '';
  if (isMediaUri(body) && !uris.includes(body)) uris.push(body);
  return uris;
}

export function collectMediaUris(msg: {
  body?: string | null;
  mediaUri?: string | null;
  mediaUris?: readonly string[] | undefined;
}): string[] {
  const uris = extractMediaUris({
    body: msg.body ?? null,
    mediaUri: msg.mediaUri ?? null,
  });
  for (const uri of msg.mediaUris ?? []) {
    const trimmed = uri.trim();
    if (isMediaUri(trimmed) && !uris.includes(trimmed)) uris.push(trimmed);
  }
  return uris;
}

/** Re-derive hasMedia / body when loading old jsonl rows that stored a content:// URI as text. */
export function normalizeStoredMedia(msg: {
  body: string | null;
  mediaUris?: string[] | undefined;
  mediaUri?: string | null;
}): { body: string | null; hasMedia: boolean; mediaUris: string[] | undefined } {
  const mediaUris = collectMediaUris(msg);
  return {
    body: extractTextBody({ body: msg.body }),
    hasMedia: mediaUris.length > 0,
    mediaUris: mediaUris.length > 0 ? mediaUris : undefined,
  };
}

export function extractTextBody(msg: Pick<Message, 'body'>): string | null {
  const raw = msg.body ?? '';
  const trimmed = raw.trim();
  if (trimmed.length === 0 || isMediaUri(trimmed)) return null;
  return raw;
}

export function isMediaOnly(msg: Pick<Message, 'body' | 'mediaUri'>): boolean {
  return extractMediaUris(msg).length > 0 && extractTextBody(msg) === null;
}

function senderKey(msg: Message): string {
  if (msg.senderId != null) return `id:${String(msg.senderId)}`;
  const memberId = msg.senderMemberId?.trim() ?? '';
  if (memberId.length > 0) return `mid:${memberId}`;
  return 'unknown';
}

interface Bundle {
  conversationId: number;
  sender: string;
  messages: Message[];
}

function canJoin(bundle: Bundle, msg: Message): boolean {
  if (msg.conversationId !== bundle.conversationId) return false;
  if (senderKey(msg) !== bundle.sender) return false;
  const previous = bundle.messages[bundle.messages.length - 1];
  if (previous === undefined) return false;
  if (msg.date.getTime() - previous.date.getTime() > MEDIA_MERGE_WINDOW_MS) return false;

  const incomingHasMedia = extractMediaUris(msg).length > 0;
  const incomingHasText = extractTextBody(msg) !== null;
  const bundleHasText = bundle.messages.some((item) => extractTextBody(item) !== null);
  const bundleHasMedia = bundle.messages.some((item) => extractMediaUris(item).length > 0);

  if (incomingHasText && !incomingHasMedia && bundleHasText) return false;
  return incomingHasMedia || bundleHasMedia;
}

function toMerged(bundle: readonly Message[]): MediaMergedMessage {
  const mediaUris: string[] = [];
  const texts: string[] = [];
  for (const item of bundle) {
    for (const uri of extractMediaUris(item)) {
      if (!mediaUris.includes(uri)) mediaUris.push(uri);
    }
    const text = extractTextBody(item);
    if (text !== null) texts.push(text);
  }
  const primary = bundle.find((item) => extractTextBody(item) !== null) ?? bundle[0];
  const last = bundle[bundle.length - 1];
  if (primary === undefined || last === undefined) {
    throw new Error('Cannot merge an empty message bundle.');
  }
  return {
    ...primary,
    id: last.id,
    date: primary.date,
    body: texts.length > 0 ? texts.join('\n\n') : null,
    mediaUri: mediaUris[0] ?? primary.mediaUri,
    mediaUris,
    hasMedia: mediaUris.length > 0,
    sourceIds: bundle.map((item) => item.id),
  };
}

/**
 * Folds a photo and its caption into one logical message when Viber stored them
 * as adjacent rows. A trailing media-only row newer than `holdWindowMs` is held
 * so the next poll can still attach the caption.
 */
export function mergeMediaWithText(
  messages: readonly Message[],
  options: { now?: number; holdWindowMs?: number } = {},
): MergeMediaResult {
  const now = options.now ?? Date.now();
  const holdWindowMs = options.holdWindowMs ?? MEDIA_MERGE_WINDOW_MS;
  const sorted = [...messages].sort((a, b) => a.id - b.id);

  const bundles: Bundle[] = [];
  let current: Bundle | null = null;
  for (const msg of sorted) {
    if (current !== null && canJoin(current, msg)) {
      current.messages.push(msg);
    } else {
      if (current !== null) bundles.push(current);
      current = {
        conversationId: msg.conversationId,
        sender: senderKey(msg),
        messages: [msg],
      };
    }
  }
  if (current !== null) bundles.push(current);

  const lastIndexByConversation = new Map<number, number>();
  bundles.forEach((bundle, index) => {
    lastIndexByConversation.set(bundle.conversationId, index);
  });

  const emitted: MediaMergedMessage[] = [];
  const held: Message[] = [];
  bundles.forEach((bundle, index) => {
    const lastMessage = bundle.messages[bundle.messages.length - 1];
    const mediaOnly = bundle.messages.every((item) => isMediaOnly(item));
    const isLastForConversation = lastIndexByConversation.get(bundle.conversationId) === index;
    const stillFresh =
      lastMessage !== undefined && now - lastMessage.date.getTime() < holdWindowMs;
    if (mediaOnly && isLastForConversation && stillFresh) {
      held.push(...bundle.messages);
      return;
    }
    emitted.push(toMerged(bundle.messages));
  });

  return { emitted, held };
}
