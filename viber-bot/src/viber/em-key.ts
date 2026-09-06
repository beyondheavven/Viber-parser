const BLOB_LENGTH = 42;
const VERSION = Buffer.from([0x01, 0x00]);
const MARKER = Buffer.from([0x1a, 0x6f]);
const KEY_OFFSET = 2;
const KEY_LENGTH = 8;

/** Extracts the base64-encoded key identifier from a Viber `em:` token. */
export function extractEmKey(token: string): string {
  const encoded = token.startsWith('em:') ? token.slice(3) : token;
  const blob = Buffer.from(encoded, 'base64');

  if (blob.length !== BLOB_LENGTH) {
    throw new Error(`Expected a ${String(BLOB_LENGTH)}-byte em blob, got ${String(blob.length)}.`);
  }
  if (!blob.subarray(0, 2).equals(VERSION)) {
    throw new Error(`Unexpected em blob version: ${blob.subarray(0, 2).toString('hex')}.`);
  }
  if (!blob.subarray(10, 12).equals(MARKER)) {
    throw new Error(`Unexpected em blob marker: ${blob.subarray(10, 12).toString('hex')}.`);
  }

  return blob.subarray(KEY_OFFSET, KEY_OFFSET + KEY_LENGTH).toString('base64');
}
