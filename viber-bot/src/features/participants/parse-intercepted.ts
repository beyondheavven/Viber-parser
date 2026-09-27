/**
 * Recognising Viber `em:` member ids in raw text.
 *
 * A Viber `em:` member id is a 42-byte blob, base64-encoded to exactly 56
 * characters. The first two bytes are the version (0x01 0x00), so every real
 * token begins "AQ" — the leading "A" is the anchor the extractor keys on.
 */

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
 * trailing boundary plus the "AQ" anchor is enough.
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
