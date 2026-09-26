import type { ViberScreenKind } from './qr-screens.js';

export type QrAuthState =
  | 'idle'
  | 'starting'
  | 'qr_ready'
  | 'scanned'
  | 'finishing'
  | 'ready'
  | 'error'
  | 'unknown_screen';

export interface QrSnapshot {
  /**
   * The decoded contents of the code. Absent when the frame could not be read:
   * the crop off the screenshot still scans, it just cannot be re-rendered.
   */
  payload?: string | undefined;
  capturedAt: string;
}

export interface QrSession {
  state: QrAuthState;
  // Explicitly `| undefined`: the reducer clears these by assigning undefined,
  // which `exactOptionalPropertyTypes` treats as different from absent.
  qr?: QrSnapshot | undefined;
  /** Last recognised screen, so the operator can see where the flow stands. */
  screenHint?: string | undefined;
  error?: string | undefined;
  /** Consecutive unrecognised screens; reset by anything we do understand. */
  unknownStreak: number;
  /**
   * The phase `unknown_screen` interrupted. Without it a session that got lost
   * after the QR was shown could never tell a scan from a first sighting.
   */
  resumeState?: QrAuthState | undefined;
}

export type QrEvent =
  | { kind: 'start'; at: string }
  | {
      kind: 'screen';
      screen: ViberScreenKind;
      qrPayload?: string | null;
      /** Whether a picture of the code was captured, decoded or not. */
      qrImage?: boolean;
      at: string;
    }
  | { kind: 'error'; message: string; at: string }
  | { kind: 'cancel'; at: string };

/**
 * How many unreadable screens in a row before the operator is asked to look —
 * about a quarter of a minute at the poll rate: long enough to ride out a
 * splash, short enough that a stuck flow is not silent.
 */
export const UNKNOWN_SCREEN_LIMIT = 5;

const TERMINAL: readonly QrAuthState[] = ['ready', 'error'];

/** Screens that mean Viber is working through the tail of the activation. */
const POST_SCAN_SCREENS: readonly ViberScreenKind[] = ['permission', 'dialog', 'profile_name'];

/** Screens that, once the QR was shown, mean Viber abandoned the activation. */
const RESET_SCREENS: readonly ViberScreenKind[] = ['welcome', 'phone_entry', 'confirm_number'];

const SHOWN_QR: readonly QrAuthState[] = ['qr_ready', 'scanned', 'finishing'];

export function initialQrSession(): QrSession {
  return { state: 'idle', unknownStreak: 0 };
}

export function isFinished(session: QrSession): boolean {
  return session.state === 'idle' || TERMINAL.includes(session.state);
}

/**
 * The whole QR flow as one pure function of "what is on screen now".
 *
 * Keeping it apart from the device driver is what makes the awkward parts
 * testable: a code that rotates under us, a scan between two polls, a screen
 * nobody has classified yet.
 */
export function reduceQrSession(session: QrSession, event: QrEvent): QrSession {
  if (event.kind === 'cancel') return initialQrSession();
  if (TERMINAL.includes(session.state)) return session;
  if (event.kind === 'start') return { state: 'starting', unknownStreak: 0 };
  if (event.kind === 'error') {
    return { ...session, state: 'error', error: event.message, qr: undefined };
  }

  const { screen } = event;

  if (screen === 'chat_list') {
    return { state: 'ready', screenHint: screen, unknownStreak: 0 };
  }

  if (screen === 'unknown') {
    const unknownStreak = session.unknownStreak + 1;
    if (session.state !== 'unknown_screen' && unknownStreak >= UNKNOWN_SCREEN_LIMIT) {
      return { ...session, state: 'unknown_screen', resumeState: session.state, unknownStreak };
    }
    return { ...session, unknownStreak };
  }

  // Anything recognised puts the session back into the phase it was in
  // before it got lost.
  const phase =
    session.state === 'unknown_screen' ? (session.resumeState ?? 'starting') : session.state;
  const base: QrSession = {
    ...session,
    state: phase,
    screenHint: screen,
    unknownStreak: 0,
    resumeState: undefined,
  };

  if (screen === 'sms_code') {
    return {
      ...base,
      state: 'error',
      qr: undefined,
      error:
        'Viber увёл номер на подтверждение по SMS вместо QR-кода. Вход по QR для этого номера недоступен.',
    };
  }

  if (screen === 'qr') {
    const payload = event.qrPayload ?? null;

    if (payload !== null) {
      const unchanged = session.qr?.payload === payload;
      return {
        ...base,
        state: 'qr_ready',
        qr: unchanged ? session.qr : { payload, capturedAt: event.at },
      };
    }

    // One unreadable frame is a redraw or a half-captured PNG — neither a new
    // code nor a scan — so a code already in hand stands.
    if (session.qr !== undefined) return { ...base, state: 'qr_ready' };

    // Never decoded, but there is a picture: the crop scans just as well.
    if (event.qrImage === true) {
      return { ...base, state: 'qr_ready', qr: { capturedAt: event.at } };
    }
    return base;
  }

  if (SHOWN_QR.includes(phase) && RESET_SCREENS.includes(screen)) {
    return {
      ...base,
      state: 'error',
      qr: undefined,
      error: `Viber сбросил активацию вторым устройством и вернулся на экран "${screen}".`,
    };
  }

  // The code is gone from a screen that had one: the phone took it.
  if (SHOWN_QR.includes(phase)) {
    const finishing = POST_SCAN_SCREENS.includes(screen) || phase === 'finishing';
    return { ...base, state: finishing ? 'finishing' : 'scanned', qr: undefined };
  }

  return base;
}
