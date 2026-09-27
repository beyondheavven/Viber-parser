import type Docker from 'dockerode';

const DEVICE_PROFILES = ['random', 'none', 'samsung-s21', 'samsung-s20', 'samsung-a52', 'google-pixel5', 'xiaomi-mi11', 'oneplus-9'];

export function buildSetupOptions(body: Record<string, unknown>): Docker.ExecCreateOptions {
  for (const key of ['regenerate', 'skipViber', 'noReboot']) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') {
      throw new Error(`${key} must be a boolean`);
    }
  }
  for (const key of ['deviceProfile', 'downloadBase', 'cleanupMode']) {
    if (body[key] !== undefined && (typeof body[key] !== 'string' || (body[key] as string).includes('\0'))) {
      throw new Error(`${key} must be a string without null bytes`);
    }
  }
  if (body.cleanupMode !== undefined && !['none', 'stage'].includes(body.cleanupMode as string)) {
    throw new Error('cleanupMode must be none or stage');
  }
  if (body.deviceProfile !== undefined && !DEVICE_PROFILES.includes(body.deviceProfile as string)) {
    throw new Error(`deviceProfile must be one of: ${DEVICE_PROFILES.join(', ')}`);
  }

  const Cmd = ['bash', '/root/scripts/setup-all.sh'];
  if (body.skipViber) Cmd.push('--skip-viber');
  if (body.noReboot) Cmd.push('--no-reboot');
  const Env = [`REGENERATE_DEVICE_PROFILE=${body.regenerate ? '1' : '0'}`];
  if (body.deviceProfile) Env.push(`DEVICE_PROFILE=${body.deviceProfile}`);
  if (body.downloadBase) Env.push(`DOWNLOAD_BASE=${body.downloadBase}`);
  if (body.cleanupMode) Env.push(`CLEANUP_MODE=${body.cleanupMode}`);
  return { Cmd, Env };
}
