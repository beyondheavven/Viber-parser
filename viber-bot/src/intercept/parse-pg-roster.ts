/**
 * Pure, side-effect-free parser for Viber's Public-Group General Query reply
 * pages — the server-paged community roster captured by scripts/trace-pg-query.ts.
 *
 * Nothing here touches the device, the network or the filesystem: it takes the
 * JSON strings the hook read out of onPGGeneralQueryReply's third argument and
 * returns the deduped member list.
 *
 * Real page schema (Viber 20.1.0.0), verified against a live capture:
 *
 *   {
 *     "result": 0,
 *     "group": {
 *       "id": "5907779393516782372",
 *       "sindex": 0, "size": 50, "last": false, "flags": 0,
 *       "members": [ { "name": "Ivan", "foto": "", "id": "em:AQAD…" }, … ]
 *     },
 *     "serverDate": "…", "serverHost": "…"
 *   }
 *
 * Each member carries only `name`, `foto` (a photo id, not a phone number) and
 * `id` (the em token). The same page is dispatched through four JNI delegates,
 * so it arrives four times in a capture — dedup by emid collapses that, and
 * unions the pages that scrolling loads.
 *
 * PROJECT SCOPE BOUNDARY: only the em token, display name and role are ever
 * extracted. If a page ever carried a real telephone-number field, it is left
 * untouched and never read or returned — de-anonymising members' hidden numbers
 * is explicitly out of scope for this project.
 */
import { canonicalizeEmToken } from './parse-intercepted.js';

export interface RosterMember {
  /** Canonical `em:<base64>` member token. */
  emid: string;
  name: string | null;
  role: number | null;
}

/** Field names an em token has been seen under, most specific first. */
const ID_FIELDS = ['id', 'member_id', 'emid', 'encrypted_member_id', 'mid'] as const;
/** Field names a display name has been seen under. */
const NAME_FIELDS = ['name', 'contactName', 'viberName', 'displayName'] as const;
/** Field names a numeric role has been seen under. */
const ROLE_FIELDS = ['role', 'groupRole', 'member_role', 'gr'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The members array of a reply page, whichever shape wraps it. */
function membersOf(parsed: unknown): unknown[] {
  if (!isRecord(parsed)) return [];
  const group = parsed.group;
  if (isRecord(group) && Array.isArray(group.members)) return group.members;
  if (Array.isArray(parsed.members)) return parsed.members;
  return [];
}

/**
 * The canonical em token of a member. Reads the known id fields first, then
 * falls back to any top-level string value that is itself an em token (a guard
 * against a field renamed by a future build). Non-tokens — a photo id, a name,
 * a phone number — never canonicalise, so they are silently ignored.
 */
function memberEmid(member: Record<string, unknown>): string | null {
  for (const field of ID_FIELDS) {
    const value = member[field];
    if (typeof value === 'string') {
      const token = canonicalizeEmToken(value);
      if (token !== null) return token;
    }
  }
  for (const value of Object.values(member)) {
    if (typeof value === 'string') {
      const token = canonicalizeEmToken(value);
      if (token !== null) return token;
    }
  }
  return null;
}

function memberName(member: Record<string, unknown>): string | null {
  for (const field of NAME_FIELDS) {
    const value = member[field];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

function memberRole(member: Record<string, unknown>): number | null {
  for (const field of ROLE_FIELDS) {
    const value = member[field];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
      return Number.parseInt(value.trim(), 10);
    }
  }
  return null;
}

/**
 * Parses General Query reply pages into the deduped member roster.
 *
 * Members are keyed by their em token; the first occurrence sets the row and a
 * later duplicate only fills a value the first one left null. Blank or
 * unparseable strings, and members without a valid em token, are skipped.
 */
export function parsePgRoster(replies: readonly string[]): RosterMember[] {
  const byEmid = new Map<string, RosterMember>();
  const order: string[] = [];

  for (const reply of replies) {
    if (typeof reply !== 'string' || reply.trim() === '') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(reply);
    } catch {
      continue;
    }

    for (const raw of membersOf(parsed)) {
      if (!isRecord(raw)) continue;
      const emid = memberEmid(raw);
      if (emid === null) continue;
      const name = memberName(raw);
      const role = memberRole(raw);

      const existing = byEmid.get(emid);
      if (existing === undefined) {
        byEmid.set(emid, { emid, name, role });
        order.push(emid);
      } else {
        if (existing.name === null && name !== null) existing.name = name;
        if (existing.role === null && role !== null) existing.role = role;
      }
    }
  }

  return order.map((emid) => byEmid.get(emid)).filter((member): member is RosterMember => member !== undefined);
}
