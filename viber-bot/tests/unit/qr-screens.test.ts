import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseHierarchy } from '../../src/viber/pages/page-source.js';
import {
  ScreenSnapshot,
  classifyViberScreen,
  findQrBounds,
  isActivateAsOnlyDevice,
  isHomeActivity,
  type ViberScreenKind,
} from '../../src/features/auth/qr/qr-screens.js';
import { maskPhone, splitPhoneNumber } from '../../src/features/auth/qr/phone-number.js';

const FIXTURES = join(process.cwd(), 'tests', 'unit', 'fixtures', 'viber-qr');

function snapshot(name: string): ScreenSnapshot {
  return new ScreenSnapshot(parseHierarchy(readFileSync(join(FIXTURES, `${name}.xml`), 'utf8')));
}

function kindOf(name: string, activity: string | null = null): ViberScreenKind {
  return classifyViberScreen(snapshot(name), activity);
}

describe('classifyViberScreen', () => {
  it('recognises every screen captured on the way to the QR', () => {
    expect(kindOf('welcome')).toBe('welcome');
    expect(kindOf('phone-entry-phone-d160')).toBe('phone_entry');
    expect(kindOf('phone-entry-tablet-d120')).toBe('phone_entry');
    expect(kindOf('confirm-number-dialog')).toBe('confirm_number');
    expect(kindOf('qr-screen-d120')).toBe('qr');
    expect(kindOf('qr-screen-d160')).toBe('qr');
  });

  it('recognises the screens around the scan', () => {
    expect(kindOf('synthetic-sms-code')).toBe('sms_code');
    expect(kindOf('synthetic-permission-dialog')).toBe('permission');
    expect(kindOf('synthetic-backup-dialog')).toBe('dialog');
    expect(kindOf('synthetic-progress')).toBe('progress');
  });

  it('calls the chat list ready whenever HomeActivity is resumed, however it is spelled', () => {
    for (const activity of ['.HomeActivity', 'com.viber.voip.HomeActivity', 'com.viber.voip/.HomeActivity']) {
      expect(kindOf('synthetic-progress', activity)).toBe('chat_list');
    }
    expect(isHomeActivity('.registration.RegistrationActivity')).toBe(false);
    expect(isHomeActivity('.NotHomeActivityX')).toBe(false);
  });

  it('recognises the chat list by its own ids, and not by familiar-looking generic ones', () => {
    const home = new ScreenSnapshot(
      parseHierarchy(
        '<hierarchy><node resource-id="com.viber.voip:id/activity_home_container" bounds="[0,0][10,10]" /></hierarchy>',
      ),
    );
    expect(classifyViberScreen(home, null)).toBe('chat_list');
    expect(kindOf('synthetic-chat-list')).toBe('unknown');
  });

  it('reads the class-named tags of an Appium page source just like uiautomator nodes', () => {
    const xml =
      '<hierarchy><android.widget.FrameLayout resource-id="" bounds="[0,0][540,960]">' +
      '<android.widget.ImageView resource-id="com.viber.voip:id/qrcode" bounds="[170,242][370,442]" />' +
      '</android.widget.FrameLayout></hierarchy>';
    const screen = new ScreenSnapshot(parseHierarchy(xml));
    expect(classifyViberScreen(screen, null)).toBe('qr');
    expect(findQrBounds(screen)).toEqual({ left: 170, top: 242, right: 370, bottom: 442 });
  });

  it('falls back to unknown for anything it has never seen', () => {
    const blank = new ScreenSnapshot(
      parseHierarchy('<hierarchy><node class="android.widget.FrameLayout" bounds="[0,0][540,960]" /></hierarchy>'),
    );
    expect(classifyViberScreen(blank, 'com.android.launcher3/.Launcher')).toBe('unknown');
  });
});

describe('the QR screen', () => {
  it('locates the ImageView the code is drawn into', () => {
    expect(findQrBounds(snapshot('qr-screen-d160'))).toEqual({
      left: 170,
      top: 242,
      right: 370,
      bottom: 442,
    });
  });

  it('flags the "activate as only device" link so it can never be tapped', () => {
    const link = snapshot('qr-screen-d160').find([{ id: 'com.viber.voip:id/click_here' }]);
    expect(link).not.toBeNull();
    expect(isActivateAsOnlyDevice(link!)).toBe(true);
  });
});

describe('splitPhoneNumber', () => {
  it('splits an international number on its calling code', () => {
    expect(splitPhoneNumber('+48 123 456 789')).toEqual({ countryCode: '48', nationalNumber: '123456789' });
    expect(splitPhoneNumber('+375291234567')).toEqual({ countryCode: '375', nationalNumber: '291234567' });
    expect(splitPhoneNumber('+1 202 555 0100')).toEqual({ countryCode: '1', nationalNumber: '2025550100' });
    expect(splitPhoneNumber('00380501234567')).toEqual({ countryCode: '380', nationalNumber: '501234567' });
  });

  it('prefers an explicit country code', () => {
    expect(splitPhoneNumber('48123456789', '+48')).toEqual({ countryCode: '48', nationalNumber: '123456789' });
    expect(splitPhoneNumber('123456789', '48')).toEqual({ countryCode: '48', nationalNumber: '123456789' });
  });

  it('does not guess a country for a bare local number', () => {
    expect(splitPhoneNumber('291234567')).toEqual({ countryCode: null, nationalNumber: '291234567' });
  });

  it('masks all but the last four digits', () => {
    expect(maskPhone('+48123456789')).toBe('***6789');
    expect(maskPhone('12')).toBe('***');
  });
});
