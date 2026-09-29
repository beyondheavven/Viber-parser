import { describe, expect, it, vi } from 'vitest';
import { grantAppPermissions, parseRequestedPermissions } from '../../src/features/auth/permissions.js';
import {
  CALL_ME_TEXT_PATTERN,
  callCodeMessage,
  readCallCodeLength,
} from '../../src/features/auth/verification.js';

const DUMPSYS = `
Packages:
  Package [com.viber.voip] (a1b2c3):
    userId=10123
    requested permissions:
      android.permission.INTERNET
      android.permission.READ_CONTACTS
      android.permission.READ_CALL_LOG: restricted=true
      android.permission.POST_NOTIFICATIONS
    install permissions:
      android.permission.INTERNET: granted=true
    User 0: ceDataInode=1 installed=true
      runtime permissions:
        android.permission.READ_CONTACTS: granted=false
`;

describe('parseRequestedPermissions', () => {
  it('reads only the "requested permissions" block', () => {
    expect(parseRequestedPermissions(DUMPSYS)).toEqual([
      'android.permission.INTERNET',
      'android.permission.READ_CONTACTS',
      'android.permission.READ_CALL_LOG',
      'android.permission.POST_NOTIFICATIONS',
    ]);
  });

  it('returns nothing when the package is not installed', () => {
    expect(parseRequestedPermissions('Unable to find package: com.viber.voip')).toEqual([]);
  });

  it('never lets a malformed name through to the root shell', () => {
    const dump = '    requested permissions:\n      android.permission.CAMERA\n      evil; reboot\n    install permissions:\n';
    expect(parseRequestedPermissions(dump)).toEqual(['android.permission.CAMERA']);
  });
});

describe('grantAppPermissions', () => {
  it('grants every requested permission in one shell call', () => {
    const shell = vi.fn((cmd: string) => (cmd.startsWith('dumpsys') ? DUMPSYS : ''));

    const granted = grantAppPermissions({ shell }, 'com.viber.voip');

    expect(granted).toHaveLength(4);
    expect(shell).toHaveBeenCalledTimes(2);
    expect(shell.mock.calls[1]?.[0]).toContain('pm grant com.viber.voip "$p"');
    expect(shell.mock.calls[1]?.[0]).toContain('android.permission.READ_CALL_LOG');
  });

  it('does not run pm grant when the app declares nothing', () => {
    const shell = vi.fn(() => '');
    expect(grantAppPermissions({ shell }, 'com.viber.voip')).toEqual([]);
    expect(shell).toHaveBeenCalledTimes(1);
  });
});

describe('«Call me» label', () => {
  // UiSelector.textMatches is a Java whole-string match; (?i) maps to the JS i flag.
  const pattern = new RegExp(`^${CALL_ME_TEXT_PATTERN.replace('(?i)', '')}$`, 'iu');

  it.each(['Call me', 'Позвонить мне', 'GET A CALL', ' Call me '])('matches «%s»', (label) => {
    expect(pattern.test(label)).toBe(true);
  });

  it.each(['Позвонить', 'Call', 'Call me back later'])('ignores «%s»', (label) => {
    expect(pattern.test(label)).toBe(false);
  });
});

describe('readCallCodeLength', () => {
  it('reads the digit count Viber asks for', () => {
    expect(readCallCodeLength('<node text="Введите последние 4 цифры номера" />')).toBe(4);
    expect(readCallCodeLength('<node text="Enter the last 6 digits of the number" />')).toBe(6);
  });

  it('returns null when the screen does not say', () => {
    expect(readCallCodeLength('<node text="Введите код" />')).toBeNull();
  });

  it('names the count in the message when known', () => {
    expect(callCodeMessage(4)).toContain('последние 4 цифры');
    expect(callCodeMessage(null)).toContain('последние цифры');
  });
});
