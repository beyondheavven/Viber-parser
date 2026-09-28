/**
 * Utility for detecting, extracting and normalizing phone numbers from free-form message text.
 */

// Ukrainian mobile operator prefix codes (first 2 digits after 0: e.g. 050 -> '50')
const UA_OPERATOR_CODES = new Set([
  '39', '50', '63', '66', '67', '68', '73', '75', '77', '89', '91', '92', '93', '94', '95', '96', '97', '98', '99',
  '31', '32', '33', '34', '35', '36', '37', '38', '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '52', '53', '54', '55', '56', '57', '61', '62', '64', '65', '69',
]);

/**
 * Normalizes a raw phone candidate into E.164 (+XXXXXXXXXXX).
 * Returns null if the candidate does not represent a plausible telephone number.
 */
export function normalizePhoneNumber(raw: string, defaultCountryCode = '380'): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');

  // Reject if too short or excessively long (credit cards, VIN, etc.)
  if (digits.length < 9 || digits.length > 15) {
    return null;
  }

  // Reject simple repetitive or invalid sequences (e.g. 0000000000, 1111111111)
  if (/^(\d)\1{7,}$/.test(digits)) {
    return null;
  }

  // Reject dates formatted like 20240501 or 01052024
  if (digits.length === 8) {
    return null;
  }

  // 1. Ukrainian 10-digit format starting with 0: e.g. 0501234567 -> +380501234567
  if (digits.length === 10 && digits.startsWith('0')) {
    if (digits.startsWith('00')) {
      return null;
    }
    const operatorCode = digits.substring(1, 3);
    if (UA_OPERATOR_CODES.has(operatorCode)) {
      return `+38${digits}`;
    }
    return null;
  }

  // 2. Ukrainian full 12-digit format with 380: e.g. 380501234567 -> +380501234567
  if (digits.length === 12 && digits.startsWith('380')) {
    const operatorCode = digits.substring(3, 5);
    if (UA_OPERATOR_CODES.has(operatorCode)) {
      return `+${digits}`;
    }
    return null;
  }

  // 3. Polish 11-digit format with 48: e.g. 48512247055 -> +48512247055
  if (digits.length === 11 && digits.startsWith('48')) {
    return `+${digits}`;
  }

  // 4. Polish 9-digit format: e.g. 512247055 -> +48512247055
  if (digits.length === 9 && defaultCountryCode.startsWith('48')) {
    return `+48${digits}`;
  }

  // 5. Candidate explicitly started with '+' in raw text
  if (trimmed.startsWith('+')) {
    return `+${digits}`;
  }

  return null;
}

/**
 * Extracts all valid phone numbers found in the text, returned in normalized E.164 format.
 * Automatically deduplicates while preserving first occurrence order.
 */
export function extractPhones(text: string | null | undefined): string[] {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // Ignore pure media URIs or content URLs
  const trimmed = text.trim();
  if (
    trimmed.startsWith('content://') ||
    trimmed.startsWith('file://') ||
    trimmed.startsWith('android.resource://')
  ) {
    return [];
  }

  // Strip URLs from text so hashes and IDs in URLs don't trigger false positives
  const sanitizedText = text.replace(/(?:https?|content|file):\/\/\S+/gi, ' ');

  // Regular expression matching phone patterns starting and ending at non-digit/non-time boundaries
  const PHONE_REGEX =
    /(?:^|[^\d+:])(\+?(?:380|48|\d{1,3})?[ \t.-]*\(?\d{2,4}\)?[ \t.-]*\d{2,4}[ \t.-]*\d{2,4}(?:[ \t.-]*\d{1,4})?)(?=[^\d:]|$)/g;

  const results: string[] = [];
  const seen = new Set<string>();

  for (const match of sanitizedText.matchAll(PHONE_REGEX)) {
    const rawCandidate = match[1];
    if (!rawCandidate) continue;

    // Avoid pure dates like 2026-09-05 or 05.09.2026
    if (/^\d{4}[.-]\d{2}[.-]\d{2}$/.test(rawCandidate.trim()) || /^\d{2}[.-]\d{2}[.-]\d{4}$/.test(rawCandidate.trim())) {
      continue;
    }

    const normalized = normalizePhoneNumber(rawCandidate);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      results.push(normalized);
    }
  }

  return results;
}

/**
 * Extracts the first (primary) valid phone number found in the text, or null if none.
 */
export function extractPrimaryPhone(text: string | null | undefined): string | null {
  const phones = extractPhones(text);
  return phones.length > 0 ? phones[0]! : null;
}
