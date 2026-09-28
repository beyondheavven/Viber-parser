export interface ViberAccountInfo {
  phoneNumber: string;
  displayName: string | null;
  status: 'pending' | 'authorized';
  authorizedAt: string | null;
  source: 'login' | 'device';
}

export interface ContainerHealthResult {
  bootCompleted: boolean;
  viberRunning: boolean;
  viberAccount: ViberAccountInfo | null;
}

function decodeXmlEntities(val: string): string {
  return val
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");
}

export const HEALTH_CHECK_CMD =
  'adb shell "getprop sys.boot_completed; pidof com.viber.voip || true; echo ===PHONE===; strings /data/data/com.viber.voip/files/preferences/reg_viber_phone_num_canonized 2>/dev/null || true; echo ===NAME===; grep display_name /data/data/com.viber.voip/shared_prefs/com.viber.voip.ViberPrefs.xml 2>/dev/null || true" 2>/dev/null || true';

export function parseContainerHealthOutput(rawOutput: string): ContainerHealthResult {
  const normalized = (rawOutput || '').trim();
  const phoneSplit = normalized.split('===PHONE===');
  const statusPart = phoneSplit[0] || '';
  const rest = phoneSplit[1] || '';
  const nameSplit = rest.split('===NAME===');
  const phonePart = nameSplit[0] || '';
  const namePart = nameSplit[1] || '';

  const lines = statusPart.trim().split('\n');
  const bootCompleted = lines.some((l) => l.trim() === '1');
  const viberRunning = lines.some((l) => /\b\d{2,}\b/.test(l.trim()));

  let viberAccount: ViberAccountInfo | null = null;
  const phoneMatch = phonePart.match(/\b(\d{7,15})\b/);
  if (phoneMatch) {
    const rawDigits = phoneMatch[1];
    const phoneNumber = rawDigits.startsWith('+') ? rawDigits : `+${rawDigits}`;
    const nameMatch = namePart.match(/<string\s+name="display_name">(.*?)<\/string>/i);
    const rawName = nameMatch ? nameMatch[1].trim() : null;
    const displayName = rawName ? decodeXmlEntities(rawName) : null;

    viberAccount = {
      phoneNumber,
      displayName: displayName || null,
      status: 'authorized',
      authorizedAt: new Date().toISOString(),
      source: 'device',
    };
  }

  return { bootCompleted, viberRunning, viberAccount };
}
