import { describe, expect, it } from 'vitest';

import {
  abiToFridaArch,
  checkServerVersion,
  fridaReleaseUrl,
  fridaServerAssetName,
  parseClientVersion,
  parseServerVersion,
} from '../../src/platform/frida/frida-assets.js';

describe('abiToFridaArch', () => {
  it('maps the emulator abi x86_64', () => {
    expect(abiToFridaArch('x86_64')).toBe('x86_64');
  });

  it('maps arm64-v8a to arm64', () => {
    expect(abiToFridaArch('arm64-v8a')).toBe('arm64');
  });

  it('maps armeabi-v7a to arm', () => {
    expect(abiToFridaArch('armeabi-v7a')).toBe('arm');
  });

  it('maps 32-bit x86', () => {
    expect(abiToFridaArch('x86')).toBe('x86');
  });

  it('ignores surrounding whitespace', () => {
    expect(abiToFridaArch('  x86_64\n')).toBe('x86_64');
  });

  it('throws on an unknown abi rather than guessing', () => {
    expect(() => abiToFridaArch('mips')).toThrow(/unknown abi/i);
  });
});

describe('fridaServerAssetName', () => {
  it('builds the android server asset name for the abi', () => {
    expect(fridaServerAssetName('16.7.19', 'x86_64')).toBe(
      'frida-server-16.7.19-android-x86_64.xz',
    );
  });

  it('uses the mapped arch, not the raw abi', () => {
    expect(fridaServerAssetName('16.7.19', 'arm64-v8a')).toBe(
      'frida-server-16.7.19-android-arm64.xz',
    );
  });
});

describe('fridaReleaseUrl', () => {
  it('points at the github release download for the version tag', () => {
    expect(fridaReleaseUrl('16.7.19', 'x86_64')).toBe(
      'https://github.com/frida/frida/releases/download/16.7.19/frida-server-16.7.19-android-x86_64.xz',
    );
  });
});

describe('parseClientVersion', () => {
  it('reads a bare version line from `frida --version`', () => {
    expect(parseClientVersion('16.7.19\n')).toBe('16.7.19');
  });

  it('reads a version out of a noisier CLI banner', () => {
    expect(parseClientVersion('frida 16.7.19')).toBe('16.7.19');
  });

  it('keeps a dev/pre-release suffix', () => {
    expect(parseClientVersion('16.7.20-dev.3')).toBe('16.7.20-dev.3');
  });

  it('throws when no version is present', () => {
    expect(() => parseClientVersion('not a version')).toThrow(/no.*version/i);
  });
});

describe('parseServerVersion', () => {
  it('reads the bare version a frida-server prints', () => {
    expect(parseServerVersion('17.17.0\n')).toBe('17.17.0');
  });

  it('survives a carriage return left by the device shell', () => {
    expect(parseServerVersion('17.17.0\r\n')).toBe('17.17.0');
  });

  it('reads a version out of a noisier banner', () => {
    expect(parseServerVersion('Frida 17.17.0')).toBe('17.17.0');
  });

  it('keeps a dev/pre-release suffix, which is a distinct server build', () => {
    expect(parseServerVersion('17.18.0-dev.7\n')).toBe('17.18.0-dev.7');
  });

  it('returns null instead of throwing when the device printed nothing', () => {
    expect(parseServerVersion('')).toBeNull();
    expect(parseServerVersion('   \n')).toBeNull();
  });

  it('returns null when the binary is missing or cannot run', () => {
    expect(parseServerVersion('/system/bin/sh: frida-server: not found')).toBeNull();
    expect(parseServerVersion('CANNOT LINK EXECUTABLE: library not found')).toBeNull();
  });
});

describe('checkServerVersion', () => {
  it('accepts a server that reports exactly the client version', () => {
    const check = checkServerVersion('17.17.0', '17.17.0\n');
    expect(check.ok).toBe(true);
    expect(check.version).toBe('17.17.0');
    expect(check.problem).toBeNull();
  });

  it('rejects a server of a different version and names both', () => {
    const check = checkServerVersion('17.17.0', '16.7.19\n');
    expect(check.ok).toBe(false);
    expect(check.version).toBe('16.7.19');
    expect(check.problem).toContain('16.7.19');
    expect(check.problem).toContain('17.17.0');
  });

  it('rejects a pre-release server against a release client', () => {
    const check = checkServerVersion('17.17.0', '17.17.0-dev.1\n');
    expect(check.ok).toBe(false);
    expect(check.version).toBe('17.17.0-dev.1');
  });

  it('rejects a device that reported no version at all and echoes what it printed', () => {
    const check = checkServerVersion('17.17.0', 'CANNOT LINK EXECUTABLE: no such file\n');
    expect(check.ok).toBe(false);
    expect(check.version).toBeNull();
    expect(check.problem).toContain('CANNOT LINK EXECUTABLE');
    expect(check.problem).toContain('17.17.0');
  });

  it('keeps the echoed device output on one short line', () => {
    const noisy = `line one\nline two ${'x'.repeat(400)}`;
    const check = checkServerVersion('17.17.0', noisy);
    expect(check.problem).not.toBeNull();
    expect(check.problem).not.toContain('\n');
    expect(check.problem?.length).toBeLessThan(300);
    expect(check.problem).not.toContain('x'.repeat(200));
  });

  it('does not trip over whitespace differences', () => {
    expect(checkServerVersion('17.17.0', '  17.17.0  ').ok).toBe(true);
  });
});
