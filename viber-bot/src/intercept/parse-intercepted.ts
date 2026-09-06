/**
 * Pure, side-effect-free helpers for turning intercepted Viber traffic into a
 * roster. Nothing here touches the device, the network or the filesystem — the
 * mitmproxy addon (scripts/intercept/mitm_viber.py) does the capture and writes
 * data/rosters/intercepted.jsonl; these functions parse and reconcile it.
 *
 * A Viber `em:` member id is a 42-byte blob, base64-encoded to exactly 56
 * characters. The first two bytes are the version (0x01 0x00), so every real
 * token begins "AQ" — the leading "A" is the anchor the extractor keys on.
 */
import { extractEmKey } from '../viber/em-key.js';

export type MemberSource = 'db' | 'intercept' | 'both';

export interface InterceptedRecord {
  /** Canonical `em:<base64>` token. */
  emId: string;
  name: string | null;
  host: string | null;
  path: string | null;
  ts: number | null;
}

/**
 * The fields mergeRosters needs from a DB-cached participant. Structurally a
 * superset-compatible view of `Participant` from src/viber/repository.ts, so a
 * `Participant[]` can be passed straight in. Depending on how the row was
 * synced, the `em:` token may live in `memberId` or `number`; otherwise
 * `memberId` holds the short 8-byte member key.
 */
export interface DbParticipant {
  memberId: string | null;
  number?: string | null;
  name?: string | null;
  contactName?: string | null;
  viberName?: string | null;
  displayName?: string | null;
}

export interface MergedMember {
  /** Canonical `em:` token when known, else null (DB rows that only carry the short key). */
  emId: string | null;
  /** 8-byte member key (base64) — the universal join key derived from the em token or read from the DB. */
  memberKey: string | null;
  name: string | null;
  source: MemberSource;
}

/**
 * Matches an em member id, with or without the `em:` prefix.
 *
 * Heuristic, tuned to stay selective without a leading boundary. A real em blob
 * is 42 bytes whose first two are the version 0x01 0x00, so its base64 is always
 * exactly 56 chars beginning "AQ". The rule is therefore:
 *   - anchor on the "AQ" version prefix (this is the "leading A byte" guard, only
 *     stricter — it is well inside the 40-64-char window a looser reading allows);
 *   - pin the length to 56 (`AQ` + 54), the only length a valid blob produces;
 *   - require a non-base64 char (or end of input) right after, so a 56-char slice
 *     is never carved out of a longer base64 run in text (JWTs, keys, data URIs).
 *
 * There is deliberately NO leading boundary: inside binary/protobuf the bytes
 * before the token are arbitrary and frequently land in the base64 range (a
 * length prefix of 56 is 0x38 = '8'), so requiring one would drop real ids.
 * Random binary essentially never yields 56 contiguous base64 chars, so the
 * trailing boundary plus the "AQ" anchor is enough. The one blind spot — an id
 * immediately followed by a base64-range byte in binary — is why the addon also
 * keeps the raw .bin dump for offline `protoc --decode_raw`.
 */
export const EM_TOKEN_RE = /(?:em:)?(AQ[A-Za-z0-9+/]{54})(?![A-Za-z0-9+/=])/g;

/** Returns canonical `em:<base64>` tokens found in `text`, deduped, first-seen order. */
export function extractEmTokens(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(EM_TOKEN_RE)) {
    const body = match[1];
    if (body === undefined) continue;
    const token = `em:${body}`;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/** Canonicalises a single raw value to an `em:` token, or null if it is not one. */
export function canonicalizeEmToken(raw: string): string | null {
  return extractEmTokens(raw)[0] ?? null;
}

/** The 8-byte member key an em token decodes to, or null if it will not decode. */
function emShortKey(emToken: string): string | null {
  try {
    return extractEmKey(emToken);
  } catch {
    return null;
  }
}

/** Parses the JSONL the mitmproxy addon appends, skipping blank/invalid lines. */
export function parseInterceptedLines(lines: readonly string[]): InterceptedRecord[] {
  const out: InterceptedRecord[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;

    const record = parsed as Record<string, unknown>;
    const rawEm = typeof record.emId === 'string' ? record.emId : null;
    if (rawEm === null) continue;
    const emId = canonicalizeEmToken(rawEm);
    if (emId === null) continue;

    const name = typeof record.name === 'string' && record.name.trim() !== '' ? record.name : null;
    out.push({
      emId,
      name,
      host: typeof record.host === 'string' ? record.host : null,
      path: typeof record.path === 'string' ? record.path : null,
      ts: typeof record.ts === 'number' ? record.ts : null,
    });
  }
  return out;
}

function participantName(participant: DbParticipant): string | null {
  const candidates = [
    participant.contactName,
    participant.displayName,
    participant.viberName,
    participant.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate;
  }
  return null;
}

/** The canonical em token a participant carries, if the token is in memberId or number. */
function participantEmId(participant: DbParticipant): string | null {
  for (const field of [participant.memberId, participant.number]) {
    if (typeof field === 'string') {
      const token = canonicalizeEmToken(field);
      if (token !== null) return token;
    }
  }
  return null;
}

/** A participant's identity: its em token (if present) plus the short join key. */
function participantIdentity(participant: DbParticipant): { emId: string | null; key: string } | null {
  const emId = participantEmId(participant);
  if (emId !== null) {
    return { emId, key: emShortKey(emId) ?? emId };
  }
  const raw = participant.memberId?.trim();
  if (raw !== undefined && raw !== '') return { emId: null, key: raw };
  return null;
}

/**
 * Deduped union of the DB-cached participants and the intercepted records, keyed
 * by the short member key (the one identifier both sides share: the DB stores it
 * directly, an intercept derives it from the em token). DB rows come first, then
 * intercept-only rows, both in input order. Names prefer a real value over null.
 *
 * An intercepted record counts as a member only once its token actually decodes.
 * EM_TOKEN_RE is a shape heuristic, so a 56-char "AQ…" run carved out of one of
 * the raw .bin dumps can reach here without being a member id; requiring the
 * 0x1a6f marker at blob offset 10-11 rejects those. DB participants are real by
 * definition and are never subjected to that check — an odd stored value keeps
 * its row rather than silently vanishing from the roster.
 */
export function mergeRosters(
  dbParticipants: readonly DbParticipant[],
  intercepted: readonly InterceptedRecord[],
): MergedMember[] {
  const byKey = new Map<string, MergedMember>();

  const upsert = (
    key: string,
    emId: string | null,
    memberKey: string | null,
    name: string | null,
    side: 'db' | 'intercept',
  ): void => {
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { emId, memberKey, name, source: side });
      return;
    }
    existing.emId ??= emId;
    existing.memberKey ??= memberKey;
    existing.name ??= name;
    if (existing.source !== side) existing.source = 'both';
  };

  for (const participant of dbParticipants) {
    const identity = participantIdentity(participant);
    if (identity === null) continue;
    upsert(identity.key, identity.emId, identity.key, participantName(participant), 'db');
  }

  for (const record of intercepted) {
    const memberKey = emShortKey(record.emId);
    if (memberKey === null) continue;
    upsert(memberKey, record.emId, memberKey, record.name, 'intercept');
  }

  return [...byKey.values()];
}

/** Finds a member by an `em:`/bare em token or a short member key. */
export function findMember(
  members: readonly MergedMember[],
  token: string,
): MergedMember | undefined {
  const emId = canonicalizeEmToken(token);
  const shortKey = emId !== null ? emShortKey(emId) : (token.trim() === '' ? null : token.trim());
  return members.find(
    (member) =>
      (emId !== null && member.emId === emId) ||
      (shortKey !== null && member.memberKey === shortKey),
  );
}
