/**
 * Pure helpers for driving Viber's Public-Group General Query by offset,
 * without the UI. Nothing here touches the device, the network or the
 * filesystem — the runner (scripts/trace-pg-query.ts, `--no-scroll`) feeds it
 * the JSON pages the Frida hook read out of onPGGeneralQueryReply and uses the
 * result to decide the next `sindex` to request.
 *
 * A page (Viber 20.1.0.0) looks like:
 *
 *   { "result": 0,
 *     "group": { "id": "…", "sindex": 50, "size": 50, "last": false,
 *                "members": [ { "name": "…", "foto": "…", "id": "em:…" }, … ] } }
 *
 * The roster is server-paged: request sindex 0, then sindex + size, and so on
 * until a page reports `last: true`. This module only reads the paging cursor;
 * the member extraction lives in parse-pg-roster.ts.
 */

export interface PgPage {
  /** The offset this page starts at. */
  sindex: number;
  /** The server's page size for this reply. */
  size: number;
  /** True on the final page of the roster. */
  last: boolean;
  /** How many members the page actually carried. */
  count: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
  return null;
}

/**
 * Reads the paging cursor of a General Query reply page. Returns null for any
 * JSON that is not a member page (a different reply, an error, malformed text),
 * so the caller can ignore it without a try/catch of its own.
 */
export function parsePgPage(json: string): PgPage | null {
  if (typeof json !== 'string' || json.trim() === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  const group = parsed.group;
  if (!isRecord(group) || !Array.isArray(group.members)) return null;

  const sindex = asInt(group.sindex);
  if (sindex === null) return null;
  const count = group.members.length;
  const size = asInt(group.size) ?? count;

  return { sindex, size, last: group.last === true, count };
}

/**
 * The offset of the page after this one. Uses the page size, falling back to
 * the member count when the server omits or zeroes `size`, so paging can never
 * stall by re-requesting the same offset.
 */
export function nextSindex(page: PgPage): number {
  const step = page.size > 0 ? page.size : page.count;
  return page.sindex + Math.max(step, 1);
}
