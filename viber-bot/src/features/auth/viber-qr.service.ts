import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { loadViberConfig } from '../../config/env.js';
import { DeviceMutexService } from '../../platform/mutex/device-mutex.service.js';
import { ActivationRejectedError } from '../../viber/pages/errors.js';
import { centerOf, parseBounds, parseHierarchy } from '../../viber/pages/page-source.js';
import { selectors } from '../../viber/pages/selectors.js';
import type { QrStartDto, QrStartResponseDto, QrStatusDto } from './dto/qr-auth.dto.js';
import { widenForTabletLayout } from './qr/density.js';
import { openQrDevice, type QrDevice } from './qr/qr-device.js';
import { cropPng, decodeQrFromPng, renderQrSvg } from './qr/qr-image.js';
import { maskPhone, splitPhoneNumber } from './qr/phone-number.js';
import {
  ACTIVATION_CONTINUE,
  ADS_CONSENT_ALLOW,
  CONFIRM_NUMBER_YES,
  DIALOG_ANY_BUTTON,
  DISMISS_OPTIONAL,
  PERMISSION_ALLOW,
  PROFILE_CONTINUE,
  REGISTRATION_CONTINUE,
  ScreenSnapshot,
  WELCOME_START,
  classifyViberScreen,
  findQrBounds,
  isActivateAsOnlyDevice,
  type NodeMatcher,
  type ViberScreenKind,
} from './qr/qr-screens.js';
import {
  initialQrSession,
  isFinished,
  reduceQrSession,
  type QrEvent,
  type QrSession,
} from './qr/qr-state.js';

/** Gap between two looks at the screen while waiting. */
const POLL_INTERVAL_MS = 3_000;
/** Short pause after a tap, so the next snapshot is of the screen that followed. */
const AFTER_TAP_MS = 1_200;
/** How long the flow may spend getting from the launcher to the QR. */
const DRIVE_TIMEOUT_MS = 120_000;
/** How long a QR may sit unscanned before the session is abandoned. */
const SESSION_TIMEOUT_MS = 15 * 60_000;
/** Lets the activity be recreated after `wm density`. */
const DENSITY_SETTLE_MS = 2_000;

/**
 * How stubbornly the phone-entry screen has to stay up after the number was
 * submitted before that counts as Viber refusing it — both a number of
 * sightings and a grace period, so a slow device is not called a rejection.
 */
const PHONE_ENTRY_RETRIES = 3;
const PHONE_ENTRY_GRACE_MS = 10_000;

/** Consecutive failed screen reads before the Appium session is given up on. */
const UI_READ_ATTEMPTS = 3;

const MIN_PHONE_DIGITS = 6;

export interface QrClock {
  now(): number;
  /** Resolves early when `signal` aborts, so a cancel never waits out a poll. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface QrServiceDeps {
  openDevice(): Promise<QrDevice>;
  clock: QrClock;
}

export const QR_SERVICE_DEPS = Symbol('QR_SERVICE_DEPS');

const realClock: QrClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const timer = setTimeout(done, ms);
      function done(): void {
        clearTimeout(timer);
        signal?.removeEventListener('abort', done);
        resolve();
      }
      signal?.addEventListener('abort', done, { once: true });
    }),
};

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function digitsOf(value: string): string {
  return value.replace(/\D/gu, '');
}

interface QrRuntime {
  session: QrSession;
  abort: AbortController;
  lockId: string;
  startedAt: string;
  updatedAt: string;
  /** The QR as a client will draw it, beside the code it was made from. */
  svg?: string | undefined;
  pngBase64?: string | undefined;
  /** Only filled in while `unknown_screen`, when the operator has to look. */
  screenshotBase64?: string | undefined;
  loop?: Promise<void>;
}

interface Screen {
  snapshot: ScreenSnapshot;
  kind: ViberScreenKind;
  activity: string | null;
}

/**
 * Logs the emulator into an existing Viber account as a *secondary* device.
 *
 * Unlike the SMS flow this never registers an account: Viber's tablet layout
 * offers "scan this code with your phone", the primary handset approves, and
 * the emulator joins the account. No SMS is sent and no registration attempt
 * is spent — as long as nothing taps "activate this device as your only
 * device", which this class refuses to touch.
 */
@Injectable()
export class ViberQrService implements OnModuleDestroy {
  private readonly logger = new Logger(ViberQrService.name);
  private readonly deps: QrServiceDeps;
  private runtime: QrRuntime | null = null;

  constructor(
    @Inject(DeviceMutexService) private readonly deviceMutex: DeviceMutexService,
    @Optional() @Inject(QR_SERVICE_DEPS) deps?: Partial<QrServiceDeps>,
  ) {
    this.deps = {
      openDevice: deps?.openDevice ?? openQrDevice,
      clock: deps?.clock ?? realClock,
    };
  }

  async onModuleDestroy(): Promise<void> {
    // The density is restored on the loop's way out; leaving it overridden
    // would change the layout every other feature was captured against.
    await this.cancel();
  }

  /**
   * Opens the QR screen and leaves a background loop watching for the scan.
   *
   * Returns as soon as the device is claimed: reaching the code takes the best
   * part of a minute, and the caller polls `getStatus` anyway.
   */
  start(dto: QrStartDto = {}): QrStartResponseDto {
    const phoneNumber = dto.phoneNumber?.trim() || process.env['VIBER_DEFAULT_PHONE']?.trim() || '';
    if (digitsOf(phoneNumber).length < MIN_PHONE_DIGITS) {
      throw new BadRequestException(
        'Номер телефона не указан или некорректен (и не задан в VIBER_DEFAULT_PHONE)',
      );
    }

    if (this.runtime !== null && !isFinished(this.runtime.session)) {
      throw new ConflictException('Авторизация по QR-коду уже запущена');
    }

    const lockId = `viber-qr-${String(this.deps.clock.now())}`;
    if (!this.deviceMutex.tryLock(lockId)) {
      const holder = this.deviceMutex.getLockInfo()?.taskId;
      throw new ConflictException(`Эмулятор занят задачей "${String(holder)}". Дождитесь её завершения.`);
    }

    const at = new Date(this.deps.clock.now()).toISOString();
    const runtime: QrRuntime = {
      session: reduceQrSession(initialQrSession(), { kind: 'start', at }),
      abort: new AbortController(),
      lockId,
      startedAt: at,
      updatedAt: at,
    };
    this.runtime = runtime;
    // The loop owns the device lock for the whole session and releases it on
    // its own way out — success, failure or cancel.
    runtime.loop = this.runSession(runtime, dto, phoneNumber);

    return {
      state: runtime.session.state,
      message: 'Запускаем Viber и открываем QR-код. Следите за статусом.',
    };
  }

  getStatus(): QrStatusDto {
    const runtime = this.runtime;
    if (runtime === null) return { state: 'idle' };

    const { session } = runtime;
    const status: QrStatusDto = {
      state: session.state,
      startedAt: runtime.startedAt,
      updatedAt: runtime.updatedAt,
    };
    if (session.screenHint !== undefined) status.screenHint = session.screenHint;
    if (session.error !== undefined) status.error = session.error;
    if (session.qr !== undefined) {
      status.qr = {
        capturedAt: session.qr.capturedAt,
        ...(session.qr.payload === undefined ? {} : { payload: session.qr.payload }),
        ...(runtime.svg === undefined ? {} : { svg: runtime.svg }),
        ...(runtime.pngBase64 === undefined ? {} : { pngBase64: runtime.pngBase64 }),
      };
    }
    if (session.state === 'unknown_screen' && runtime.screenshotBase64 !== undefined) {
      status.screenshotBase64 = runtime.screenshotBase64;
    }
    return status;
  }

  async cancel(): Promise<QrStartResponseDto> {
    const runtime = this.runtime;
    if (runtime === null) {
      return { state: 'idle', message: 'Авторизация по QR-коду не запущена' };
    }
    runtime.abort.abort();
    await runtime.loop?.catch(() => undefined);
    if (this.runtime === runtime) this.runtime = null;
    return { state: 'idle', message: 'Авторизация по QR-коду отменена' };
  }

  // --- The session ---------------------------------------------------------

  private async runSession(runtime: QrRuntime, dto: QrStartDto, phoneNumber: string): Promise<void> {
    let device: QrDevice | null = null;
    let restoreDensity: (() => void) | null = null;
    try {
      device = await this.deps.openDevice();
      const { appPackage } = loadViberConfig();

      if (dto.clearData === true) {
        this.logger.log('Clearing Viber data before the QR login...');
        device.shell(`pm clear ${appPackage}`, { allowFailure: true });
        await this.sleep(1_500, runtime);
      }

      const widened = widenForTabletLayout(device);
      this.logger.log(`Screen layout: ${widened.note}.`);
      restoreDensity = widened.restore;
      if (restoreDensity !== null) await this.sleep(DENSITY_SETTLE_MS, runtime);
      if (runtime.abort.signal.aborted) return;

      if (!(await device.restartViber())) {
        throw new Error('Viber не запустился после перезапуска.');
      }

      await this.driveToQrScreen(device, runtime, dto, phoneNumber);
      if (runtime.abort.signal.aborted || isFinished(runtime.session)) return;

      // The QR step renders at any density, and the code is drawn larger at the
      // device's own one — so the density goes back as soon as the tablet
      // layout has done its job, instead of for the whole wait.
      if (restoreDensity !== null) {
        restoreDensity();
        restoreDensity = null;
        await this.sleep(1_500, runtime);
      }

      await this.watchUntilDone(device, runtime, dto);
    } catch (err) {
      if (!runtime.abort.signal.aborted) {
        const message =
          err instanceof ActivationRejectedError
            ? `Viber отклонил активацию — ${err.message}`
            : describeError(err);
        this.logger.error(`QR login failed: ${message}`);
        this.apply(runtime, { kind: 'error', message, at: this.isoNow() });
      }
    } finally {
      if (restoreDensity !== null) {
        try {
          restoreDensity();
        } catch (err) {
          this.logger.warn(`Could not restore the screen density: ${describeError(err)}`);
        }
      }
      await device?.close().catch(() => undefined);
      this.deviceMutex.unlock(runtime.lockId);
    }
  }

  /** Welcome → phone entry → "Is this your number?" → the QR. */
  private async driveToQrScreen(
    device: QrDevice,
    runtime: QrRuntime,
    dto: QrStartDto,
    phoneNumber: string,
  ): Promise<void> {
    const { clock } = this.deps;
    const deadline = clock.now() + DRIVE_TIMEOUT_MS;
    let submittedAt: number | null = null;
    let sightingsAfterSubmit = 0;

    while (clock.now() < deadline) {
      if (runtime.abort.signal.aborted) return;

      const screen = await this.readScreen(device, runtime);
      if (screen.kind === 'qr') {
        this.logger.log('QR screen reached.');
        return;
      }

      this.apply(runtime, { kind: 'screen', screen: screen.kind, at: this.isoNow() });
      if (isFinished(runtime.session)) return;
      if (runtime.session.state === 'finishing') {
        this.logger.log('The device is already activated — finishing the setup.');
        return;
      }
      await this.captureUnknownScreen(device, runtime);

      switch (screen.kind) {
        case 'welcome':
          await this.tap(device, screen.snapshot, WELCOME_START, 'Start now');
          break;
        case 'phone_entry':
          if (submittedAt === null) {
            await this.enterNumber(device, runtime, screen.snapshot, dto, phoneNumber);
            submittedAt = clock.now();
            sightingsAfterSubmit = 0;
            break;
          }
          // Still on the form. Normal for a moment — Continue enables only once
          // the field validates — so it is pressed again, and the form gets a
          // few seconds to move on before this counts as a refusal.
          sightingsAfterSubmit += 1;
          if (
            sightingsAfterSubmit >= PHONE_ENTRY_RETRIES &&
            clock.now() - submittedAt >= PHONE_ENTRY_GRACE_MS
          ) {
            throw new Error('Viber остался на экране ввода номера — номер не принят.');
          }
          await this.tap(device, screen.snapshot, REGISTRATION_CONTINUE, 'Continue (retry)');
          break;
        case 'confirm_number':
          await this.tap(device, screen.snapshot, CONFIRM_NUMBER_YES, 'Yes');
          break;
        case 'permission':
          await this.tap(device, screen.snapshot, PERMISSION_ALLOW, 'Allow');
          break;
        case 'dialog':
          this.throwIfActivationFailed(screen.snapshot);
          await this.dismissDialog(device, screen.snapshot);
          break;
        default:
          break;
      }

      const waitMs =
        screen.kind === 'unknown' || screen.kind === 'progress' ? POLL_INTERVAL_MS : AFTER_TAP_MS;
      await this.sleep(waitMs, runtime);
    }

    throw new Error('Не удалось дойти до экрана с QR-кодом за отведённое время.');
  }

  /**
   * Watches the QR until the phone takes it, then clears whatever Viber puts
   * up on the way to the chat list.
   */
  private async watchUntilDone(device: QrDevice, runtime: QrRuntime, dto: QrStartDto): Promise<void> {
    const { clock } = this.deps;
    const deadline = clock.now() + SESSION_TIMEOUT_MS;
    let profileFilled = false;

    while (clock.now() < deadline) {
      if (runtime.abort.signal.aborted) return;

      const screen = await this.readScreen(device, runtime);
      if (screen.kind === 'qr') {
        await this.publishQr(device, runtime, screen.snapshot);
      } else {
        this.apply(runtime, { kind: 'screen', screen: screen.kind, at: this.isoNow() });
      }

      if (runtime.session.state === 'ready') {
        this.logger.log('Viber is ready — the chat list is up.');
        return;
      }
      if (runtime.session.state === 'error') return;
      await this.captureUnknownScreen(device, runtime);

      // Required permissions are granted; optional prompts are declined — none
      // of them is needed to reach the chat list.
      if (screen.kind === 'activated') {
        await this.tap(device, screen.snapshot, ACTIVATION_CONTINUE, 'Continue (activated)');
      } else if (screen.kind === 'ads_consent') {
        await this.tap(device, screen.snapshot, ADS_CONSENT_ALLOW, 'Allow all and continue');
      } else if (screen.kind === 'permission') {
        await this.tap(device, screen.snapshot, PERMISSION_ALLOW, 'Allow');
      } else if (screen.kind === 'dialog') {
        await this.dismissDialog(device, screen.snapshot);
      } else if (screen.kind === 'profile_name') {
        if (!profileFilled && dto.userName?.trim()) {
          this.logger.log('Filling in the profile name.');
          await device.replaceText(selectors.profile.nameInput, dto.userName.trim());
          await device.hideKeyboard();
          profileFilled = true;
          const fresh = await this.readScreen(device, runtime);
          await this.tap(device, fresh.snapshot, PROFILE_CONTINUE, 'Continue (profile)');
        } else {
          await this.tap(device, screen.snapshot, PROFILE_CONTINUE, 'Continue (profile)');
        }
      }

      await this.sleep(POLL_INTERVAL_MS, runtime);
    }

    this.apply(runtime, {
      kind: 'error',
      message: 'QR-код не был отсканирован за отведённое время.',
      at: this.isoNow(),
    });
  }

  // --- Device helpers ------------------------------------------------------

  /**
   * One look at the screen. UiAutomator2 occasionally dies during a long wait,
   * so a failed read drops the session and retries on a fresh one before the
   * flow is given up on.
   */
  private async readScreen(device: QrDevice, runtime: QrRuntime): Promise<Screen> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const snapshot = new ScreenSnapshot(parseHierarchy(await device.pageSource()));
        const activity = await device.currentActivity();
        const kind = classifyViberScreen(snapshot, activity);
        if (kind === 'unknown') {
          this.logger.debug(
            `Unrecognised screen: activity=${activity ?? '?'} ids=[${snapshot.resourceIds().join(', ')}]`,
          );
        }
        return { snapshot, kind, activity };
      } catch (err) {
        if (attempt >= UI_READ_ATTEMPTS || runtime.abort.signal.aborted) {
          throw new Error(`Не удалось прочитать экран Viber: ${describeError(err)}`);
        }
        this.logger.warn(`Screen read failed (attempt ${String(attempt)}), reopening the session: ${describeError(err)}`);
        await device.resetUi();
        await this.sleep(AFTER_TAP_MS, runtime);
      }
    }
  }

  /**
   * Taps whatever the matchers found in the snapshot we already have. The
   * point comes from that node's own rectangle, never from a constant.
   */
  private async tap(
    device: QrDevice,
    snapshot: ScreenSnapshot,
    matchers: readonly NodeMatcher[],
    what: string,
  ): Promise<boolean> {
    const node = snapshot.find(matchers);
    if (node === null) return false;
    if (isActivateAsOnlyDevice(node)) {
      this.logger.warn(`Refusing to tap ${what}: it is the "activate as only device" link.`);
      return false;
    }
    const bounds = parseBounds(node.bounds);
    if (bounds === null) return false;
    this.logger.log(`Tapping ${what}.`);
    await device.tap(centerOf(bounds));
    return true;
  }

  private async dismissDialog(device: QrDevice, snapshot: ScreenSnapshot): Promise<void> {
    if (await this.tap(device, snapshot, DISMISS_OPTIONAL, 'Not now')) return;
    await this.tap(device, snapshot, DIALOG_ANY_BUTTON, 'dialog button');
  }

  /**
   * Viber answers a number it will not activate with an "Activation failed"
   * AlertDialog. Before the QR that is final, and dismissing it would only
   * leave the flow circling the phone form until it timed out.
   */
  private throwIfActivationFailed(snapshot: ScreenSnapshot): void {
    const title = snapshot.textOf(selectors.alert.title);
    if (title === null || title === '') return;
    throw new ActivationRejectedError(title, snapshot.textOf(selectors.alert.message) ?? '');
  }

  private async enterNumber(
    device: QrDevice,
    runtime: QrRuntime,
    snapshot: ScreenSnapshot,
    dto: QrStartDto,
    phoneNumber: string,
  ): Promise<void> {
    const parts = splitPhoneNumber(phoneNumber, dto.countryCode);
    const prefilled = digitsOf(snapshot.textOf(selectors.registration.codeField) ?? '');

    if (parts.countryCode !== null && parts.countryCode !== prefilled) {
      const shown = digitsOf(
        await device.replaceText(selectors.registration.codeField, parts.countryCode),
      );
      if (shown !== parts.countryCode) {
        throw new Error(`Поле кода страны содержит "${shown}" вместо "${parts.countryCode}".`);
      }
    }

    const countryCode = parts.countryCode ?? prefilled;
    let national = parts.nationalNumber;
    // A local number that repeats the prefilled code would be submitted twice over.
    if (parts.countryCode === null && countryCode !== '' && national.startsWith(countryCode)) {
      national = national.slice(countryCode.length);
    }
    this.logger.log(`Entering phone: +${countryCode} ${maskPhone(national)}.`);

    const shown = digitsOf(await device.replaceText(selectors.registration.phoneField, national));
    if (shown !== national) {
      throw new Error(`Поле номера содержит ${maskPhone(shown)} вместо ${maskPhone(national)}.`);
    }

    // Continue enables only once the field validates, and the soft keyboard
    // shifts the form — so the button is looked up again on a fresh snapshot.
    await device.hideKeyboard();
    const fresh = await this.readScreen(device, runtime);
    if (!(await this.tap(device, fresh.snapshot, REGISTRATION_CONTINUE, 'Continue'))) {
      await device.pressEnter();
    }
  }

  /**
   * Snapshots the code and republishes it whenever Viber changes it.
   *
   * The screenshot is cut down to the ImageView first: the crop decodes more
   * reliably, and it is what the client gets when decoding fails.
   */
  private async publishQr(device: QrDevice, runtime: QrRuntime, snapshot: ScreenSnapshot): Promise<void> {
    let payload: string | null = null;
    let pngBase64: string | undefined;

    try {
      const png = await device.screenshot();
      const bounds = findQrBounds(snapshot);
      let cropped: Buffer | null = null;
      if (bounds !== null) {
        try {
          cropped = cropPng(png, bounds);
        } catch {
          cropped = null;
        }
      }
      payload = (cropped === null ? null : decodeQrFromPng(cropped)) ?? decodeQrFromPng(png);
      pngBase64 = (cropped ?? png).toString('base64');
    } catch (err) {
      this.logger.warn(`Could not read the QR off the screen: ${describeError(err)}`);
    }

    const previous = runtime.session.qr?.payload;
    this.apply(runtime, {
      kind: 'screen',
      screen: 'qr',
      qrPayload: payload,
      qrImage: pngBase64 !== undefined,
      at: this.isoNow(),
    });

    if (pngBase64 !== undefined) runtime.pngBase64 = pngBase64;
    if (payload !== null && payload !== previous) {
      // The payload is an activation token: it is drawn, never logged.
      this.logger.log(`QR code published (${String(payload.length)} chars).`);
      runtime.svg = await renderQrSvg(payload).catch(() => undefined);
    }
  }

  /** Grabs the screen the first time the flow admits it is lost. */
  private async captureUnknownScreen(device: QrDevice, runtime: QrRuntime): Promise<void> {
    if (runtime.session.state !== 'unknown_screen' || runtime.screenshotBase64 !== undefined) return;
    runtime.screenshotBase64 = await device
      .screenshot()
      .then((png) => png.toString('base64'))
      .catch(() => undefined);
  }

  // --- Bookkeeping ---------------------------------------------------------

  private apply(runtime: QrRuntime, event: QrEvent): void {
    const previous = runtime.session;
    runtime.session = reduceQrSession(previous, event);
    runtime.updatedAt = this.isoNow();
    if (runtime.session.state !== previous.state) {
      const hint = runtime.session.screenHint ?? runtime.session.error ?? '';
      this.logger.log(`State ${previous.state} → ${runtime.session.state}${hint ? ` (${hint})` : ''}.`);
    }
    if (runtime.session.qr === undefined && previous.qr !== undefined) {
      runtime.svg = undefined;
      runtime.pngBase64 = undefined;
    }
    if (runtime.session.state !== 'unknown_screen') runtime.screenshotBase64 = undefined;
  }

  private sleep(ms: number, runtime: QrRuntime): Promise<void> {
    return this.deps.clock.sleep(ms, runtime.abort.signal);
  }

  private isoNow(): string {
    return new Date(this.deps.clock.now()).toISOString();
  }
}
