import { describe, expect, it } from 'vitest';

import {
  canonicalizeEmToken,
  extractEmTokens,
} from '../../src/features/participants/parse-intercepted.js';

// Real tokens from data/rosters + artifacts/participants_info.json.
const MILENA = 'em:AQANrniLcl9lwBpvAAD45BjXack2KDDejNcNiXWX7KoogUod/74atmpL';
const IEVGEN = 'em:AQBDSbnJB8CCthpvAADDzFtSX+ITrmsmijma1IhjgtYmCRv02eK4yATf';

describe('extractEmTokens', () => {
  it('extracts an em:-prefixed token from a roster-style line', () => {
    expect(extractEmTokens(`member     Oksana - ${MILENA}`)).toEqual([MILENA]);
  });

  it('extracts a bare token even when a base64-range byte precedes it', () => {
    // In protobuf the em: prefix is absent and the 56-byte body sits right after
    // a length prefix (56 -> 0x38 -> '8'), a base64-range byte: no leading boundary.
    const wire = ` 8${MILENA.slice(3)} `;
    expect(extractEmTokens(wire)).toEqual([MILENA]);
  });

  it('does not carve a token out of a longer base64 run', () => {
    // Begins with the "AQ" anchor, but the 56-char window is followed by more
    // base64, so the trailing boundary rejects it as an ordinary long blob.
    const longBlob = ` AQ${'B'.repeat(94)} `;
    expect(extractEmTokens(longBlob)).toEqual([]);
  });

  it('ignores base64 that lacks the AQ version prefix', () => {
    const notEm = ` B${'Cd3f'.repeat(13)}xyz `; // 56 chars, no "AQ" anywhere
    expect(extractEmTokens(notEm)).toEqual([]);
  });

  it('dedupes repeated tokens and preserves first-seen order', () => {
    const text = `${IEVGEN} noise ${MILENA} more ${IEVGEN}`;
    expect(extractEmTokens(text)).toEqual([IEVGEN, MILENA]);
  });
});

describe('canonicalizeEmToken', () => {
  it('canonicalises a bare (prefixless) token to em: form', () => {
    expect(canonicalizeEmToken(MILENA.slice(3))).toBe(MILENA);
  });

  it('returns null for a value that is not an em token', () => {
    expect(canonicalizeEmToken('not-a-token')).toBeNull();
  });
});
