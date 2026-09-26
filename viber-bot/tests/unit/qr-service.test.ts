import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PNG } from 'pngjs';
import QRCode from 'qrcode';
import { beforeAll, describe, expect, it } from 'vitest';
import { DeviceMutexService } from '../../src/platform/mutex/device-mutex.service.js';
import { ViberQrService, type QrClock } from '../../src/features/auth/viber-qr.service.js';
import type { QrDevice } from '../../src/features/auth/qr/qr-device.js';
import type { QrStatusDto } from '../../src/features/auth/dto/qr-auth.dto.js';

const FIXTURES = join(process.cwd(), 'tests', 'unit', 'fixtures', 'viber-qr');
const PAYLOAD = 'viber://auth?token=AbCdEf0123456789';

/** "Do you want to activate this device as your only device?" on the d160 QR screen. */
const CLICK_HERE = { left: 160, top: 837, right: 379, bottom: 872 };

const ACTIVATION_FAILED = `<hierarchy><node resource-id="android:id/content" bounds="[0,0][540,960]">
  <node text="Activation failed" resource-id="android:id/alertTitle" bounds="[40,300][500,340]" />
  <node text="Too many attempts" resource-id="android:id/message" bounds="[40,350][500,400]" />
  <node text="CLOSE" resource-id="android:id/button1" bounds="[400,420][500,470]" />
</node></hierarchy>`;

const ACTIVATED = `<hierarchy><node resource-id="com.viber.voip:id/fragment_container" bounds="[0,0][1280,720]">
  <node text="Continue" resource-id="com.viber.voip:id/continueBtn" bounds="[580,340][700,378]" />
</node></hierarchy>`;

const ADS_CONSENT = `<hierarchy><node resource-id="com.viber.voip:id/root_container" bounds="[0,0][1280,720]">
  <node text="Allow all and continue" resource-id="com.viber.voip:id/allow_btn" bounds="[24,552][1256,612]" />
  <node text="Manage ad preferences" resource-id="com.viber.voip:id/manage_ads_btn" bounds="[24,636][1256,696]" />
</node></hierarchy>`;

function fixture(name: string): string {
  return name.startsWith('<') ? name : readFileSync(join(FIXTURES, `${name}.xml`), 'utf8');
}

let qrScreenshot: Buffer;

beforeAll(async () => {
  const qr = PNG.sync.read(await QRCode.toBuffer(PAYLOAD, { type: 'png', scale: 5, margin: 2 }));
  const canvas = new PNG({ width: 540, height: 960 });
  canvas.data.fill(0xff);
  PNG.bitblt(qr, canvas, 0, 0, qr.width, qr.height, 170, 242);
  qrScreenshot = PNG.sync.write(canvas);
});

interface Step {
  screen: string;
  activity?: string;
}

/**
 * Plays back one screen per read; the last one sticks. `failReads` makes the
 * first N reads throw, the way a dying UiAutomator2 session does.
 */
class ScriptedDevice implements QrDevice {
  readonly taps: { x: number; y: number }[] = [];
  readonly typed: { id: string; text: string }[] = [];
  readonly commands: string[] = [];
  resets = 0;
  closed = false;
  override: number | null = null;
  onRead: ((index: number) => void) | undefined;
  private index = -1;

  constructor(
    private readonly steps: Step[],
    private failReads = 0,
  ) {}

  private get current(): Step {
    return this.steps[Math.min(Math.max(this.index, 0), this.steps.length - 1)]!;
  }

  shell(command: string): string {
    this.commands.push(command);
    if (command === 'wm size') return 'Physical size: 540x960';
    if (command === 'wm density') {
      return `Physical density: 160\n${this.override === null ? '' : `Override density: ${String(this.override)}`}`;
    }
    if (command === 'wm density reset') this.override = null;
    const set = /^wm density (\d+)$/u.exec(command);
    if (set) this.override = Number(set[1]);
    return '';
  }

  async restartViber(): Promise<boolean> {
    return true;
  }

  async pageSource(): Promise<string> {
    if (this.failReads > 0) {
      this.failReads -= 1;
      throw new Error('UiAutomator2 server is not running');
    }
    this.index += 1;
    this.onRead?.(this.index);
    return fixture(this.current.screen);
  }

  async currentActivity(): Promise<string | null> {
    return this.current.activity ?? '.registration.RegistrationActivity';
  }

  async screenshot(): Promise<Buffer> {
    return qrScreenshot;
  }

  async tap(point: { x: number; y: number }): Promise<void> {
    this.taps.push(point);
  }

  async replaceText(id: string, text: string): Promise<string> {
    this.typed.push({ id, text });
    return text;
  }

  async hideKeyboard(): Promise<void> {}
  async pressEnter(): Promise<void> {}

  async resetUi(): Promise<void> {
    this.resets += 1;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

/** Time only moves when the flow sleeps; `hold` parks the loop until a cancel. */
function fakeClock(): QrClock & { hold: boolean } {
  let now = Date.parse('2026-09-26T10:00:00.000Z');
  const clock = {
    hold: false,
    now: () => now,
    sleep: async (ms: number, signal?: AbortSignal): Promise<void> => {
      now += ms;
      if (!clock.hold || signal === undefined) return;
      if (signal.aborted) return;
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    },
  };
  return clock;
}

function setup(device: ScriptedDevice) {
  const mutex = new DeviceMutexService();
  const clock = fakeClock();
  const service = new ViberQrService(mutex, { openDevice: async () => device, clock });
  return { service, mutex, clock };
}

async function settle(service: ViberQrService): Promise<QrStatusDto> {
  for (let i = 0; i < 2_000; i += 1) {
    const status = service.getStatus();
    if (status.state === 'ready' || status.state === 'error') return status;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`QR flow never finished (state ${service.getStatus().state})`);
}

const HAPPY_PATH: Step[] = [
  { screen: 'welcome', activity: '.WelcomeActivity' },
  { screen: 'phone-entry-tablet-d120' },
  { screen: 'phone-entry-tablet-d120' },
  { screen: 'confirm-number-dialog' },
  { screen: 'qr-screen-d160' },
  { screen: 'qr-screen-d160' },
  { screen: 'synthetic-progress' },
  { screen: 'synthetic-permission-dialog', activity: '.permission.GrantPermissionsActivity' },
  { screen: 'synthetic-backup-dialog' },
  { screen: 'synthetic-chat-list', activity: '.HomeActivity' },
];

describe('ViberQrService', () => {
  it('drives Viber to the QR, publishes the code and ends on the chat list', async () => {
    const device = new ScriptedDevice(HAPPY_PATH);
    const { service, mutex } = setup(device);
    let whileShown: QrStatusDto | undefined;
    device.onRead = (index) => {
      if (index === 6) whileShown = service.getStatus();
    };

    expect(service.start({ phoneNumber: '+48 123 456 789' }).state).toBe('starting');
    const final = await settle(service);

    expect(final.state).toBe('ready');
    expect(whileShown?.state).toBe('qr_ready');
    expect(whileShown?.qr?.payload).toBe(PAYLOAD);
    expect(whileShown?.qr?.svg).toMatch(/^<svg/u);
    expect(whileShown?.qr?.pngBase64).toBeTruthy();

    // Poland is prefilled, so only the national part is typed.
    expect(device.typed).toEqual([{ id: 'com.viber.voip:id/registration_phone_field', text: '123456789' }]);
    expect(device.override).toBeNull();
    expect(device.closed).toBe(true);
    expect(mutex.isLocked()).toBe(false);
  });

  it('never taps the "activate as only device" link', async () => {
    const device = new ScriptedDevice(HAPPY_PATH);
    const { service } = setup(device);
    service.start({ phoneNumber: '+48123456789' });
    await settle(service);

    const inside = device.taps.filter(
      ({ x, y }) => x >= CLICK_HERE.left && x <= CLICK_HERE.right && y >= CLICK_HERE.top && y <= CLICK_HERE.bottom,
    );
    expect(device.taps.length).toBeGreaterThan(0);
    expect(inside).toEqual([]);
  });

  it('switches the country code when the number belongs to another country', async () => {
    const device = new ScriptedDevice(HAPPY_PATH);
    const { service } = setup(device);
    service.start({ phoneNumber: '+375 29 123 45 67' });
    await settle(service);

    expect(device.typed.slice(0, 2)).toEqual([
      { id: 'com.viber.voip:id/registration_code_field', text: '375' },
      { id: 'com.viber.voip:id/registration_phone_field', text: '291234567' },
    ]);
  });

  it('reports "Activation failed" before the QR instead of circling until the timeout', async () => {
    const device = new ScriptedDevice([
      { screen: 'welcome' },
      { screen: 'phone-entry-tablet-d120' },
      { screen: 'phone-entry-tablet-d120' },
      { screen: ACTIVATION_FAILED },
    ]);
    const { service, mutex } = setup(device);
    service.start({ phoneNumber: '+48123456789' });
    const final = await settle(service);

    expect(final.state).toBe('error');
    expect(final.error).toContain('Activation failed: Too many attempts');
    expect(mutex.isLocked()).toBe(false);
    expect(device.override).toBeNull();
  });

  it('gives up when Viber sends the number to SMS verification', async () => {
    const device = new ScriptedDevice([
      { screen: 'phone-entry-tablet-d120' },
      { screen: 'phone-entry-tablet-d120' },
      { screen: 'synthetic-sms-code' },
    ]);
    const { service } = setup(device);
    service.start({ phoneNumber: '+48123456789' });
    const final = await settle(service);
    expect(final.state).toBe('error');
    expect(final.error).toMatch(/SMS/u);
  });

  it('taps through the activation success screen, including one left by an earlier scan', async () => {
    const device = new ScriptedDevice([
      { screen: ACTIVATED },
      { screen: ACTIVATED },
      { screen: ADS_CONSENT, activity: '.feature.gdpr.ui.iabconsent.ConsentActivity' },
      { screen: 'synthetic-chat-list', activity: '.HomeActivity' },
    ]);
    const { service, mutex } = setup(device);
    service.start({ phoneNumber: '+48123456789' });
    const final = await settle(service);

    expect(final.state).toBe('ready');
    // Continue on the success screen, then "Allow all and continue".
    expect(device.taps).toEqual([
      { x: 640, y: 359 },
      { x: 640, y: 582 },
    ]);
    expect(device.typed).toEqual([]);
    expect(device.override).toBeNull();
    expect(mutex.isLocked()).toBe(false);
  });

  it('reopens the UI session when a screen read fails', async () => {
    const device = new ScriptedDevice(HAPPY_PATH, 2);
    const { service } = setup(device);
    service.start({ phoneNumber: '+48123456789' });
    expect((await settle(service)).state).toBe('ready');
    expect(device.resets).toBe(2);
  });

  it('cancels a session waiting for the scan and gives the device back', async () => {
    const device = new ScriptedDevice([{ screen: 'qr-screen-d160' }]);
    const { service, mutex, clock } = setup(device);
    device.onRead = (index) => {
      if (index >= 1) clock.hold = true;
    };
    service.start({ phoneNumber: '+48123456789' });
    for (let i = 0; i < 200 && service.getStatus().state !== 'qr_ready'; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(service.getStatus().state).toBe('qr_ready');
    expect(mutex.isLocked()).toBe(true);

    expect((await service.cancel()).state).toBe('idle');
    expect(service.getStatus().state).toBe('idle');
    expect(mutex.isLocked()).toBe(false);
    expect(device.closed).toBe(true);
  });

  it('refuses a missing number, a second session and a busy emulator', () => {
    const device = new ScriptedDevice([{ screen: 'qr-screen-d160' }]);
    const { service, clock } = setup(device);
    clock.hold = true;

    const saved = process.env['VIBER_DEFAULT_PHONE'];
    delete process.env['VIBER_DEFAULT_PHONE'];
    try {
      expect(() => service.start({})).toThrow(BadRequestException);
    } finally {
      if (saved !== undefined) process.env['VIBER_DEFAULT_PHONE'] = saved;
    }

    service.start({ phoneNumber: '+48123456789' });
    expect(() => service.start({ phoneNumber: '+48123456789' })).toThrow(ConflictException);
    void service.cancel();

    const busy = setup(new ScriptedDevice([{ screen: 'welcome' }]));
    busy.mutex.tryLock('participants-task');
    expect(() => busy.service.start({ phoneNumber: '+48123456789' })).toThrow(ConflictException);
  });
});
