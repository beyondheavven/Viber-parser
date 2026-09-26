import { describe, expect, it } from 'vitest';
import {
  UNKNOWN_SCREEN_LIMIT,
  initialQrSession,
  reduceQrSession,
  type QrSession,
} from '../../src/features/auth/qr/qr-state.js';

const AT = '2026-09-15T10:00:00.000Z';
const LATER = '2026-09-15T10:00:03.000Z';

function starting(): QrSession {
  return reduceQrSession(initialQrSession(), { kind: 'start', at: AT });
}

function shown(payload = 'one'): QrSession {
  return reduceQrSession(starting(), { kind: 'screen', screen: 'qr', qrPayload: payload, at: AT });
}

function lose(session: QrSession): QrSession {
  let next = session;
  for (let i = 0; i < UNKNOWN_SCREEN_LIMIT; i += 1) {
    next = reduceQrSession(next, { kind: 'screen', screen: 'unknown', at: LATER });
  }
  return next;
}

describe('reduceQrSession', () => {
  it('starts idle and moves to starting when the flow is kicked off', () => {
    expect(initialQrSession().state).toBe('idle');
    expect(starting().state).toBe('starting');
  });

  it('goes to qr_ready once the QR screen yields a payload', () => {
    const session = shown('viber://qr?t=1');
    expect(session.state).toBe('qr_ready');
    expect(session.qr).toEqual({ payload: 'viber://qr?t=1', capturedAt: AT });
  });

  it('stays in starting while the QR screen is up and nothing was captured', () => {
    const session = reduceQrSession(starting(), { kind: 'screen', screen: 'qr', qrPayload: null, at: AT });
    expect(session.state).toBe('starting');
    expect(session.qr).toBeUndefined();
  });

  it('publishes a captured code that would not decode, so the crop is still usable', () => {
    const session = reduceQrSession(starting(), {
      kind: 'screen',
      screen: 'qr',
      qrPayload: null,
      qrImage: true,
      at: AT,
    });
    expect(session.state).toBe('qr_ready');
    expect(session.qr).toEqual({ capturedAt: AT });
  });

  it('upgrades an undecoded snapshot as soon as a frame does decode', () => {
    const undecoded = reduceQrSession(starting(), {
      kind: 'screen',
      screen: 'qr',
      qrPayload: null,
      qrImage: true,
      at: AT,
    });
    const decoded = reduceQrSession(undecoded, {
      kind: 'screen',
      screen: 'qr',
      qrPayload: 'one',
      at: LATER,
    });
    expect(decoded.qr).toEqual({ payload: 'one', capturedAt: LATER });
  });

  it('keeps a decoded code when a later frame fails to decode', () => {
    const blurred = reduceQrSession(shown(), {
      kind: 'screen',
      screen: 'qr',
      qrPayload: null,
      qrImage: true,
      at: LATER,
    });
    expect(blurred.state).toBe('qr_ready');
    expect(blurred.qr).toEqual({ payload: 'one', capturedAt: AT });
  });

  it('refreshes the snapshot when Viber rotates the code, and keeps the time otherwise', () => {
    const rotated = reduceQrSession(shown(), { kind: 'screen', screen: 'qr', qrPayload: 'two', at: LATER });
    expect(rotated.qr).toEqual({ payload: 'two', capturedAt: LATER });
    const same = reduceQrSession(shown(), { kind: 'screen', screen: 'qr', qrPayload: 'one', at: LATER });
    expect(same.qr).toEqual({ payload: 'one', capturedAt: AT });
  });

  it('treats the QR leaving the screen as a scan and drops the stale code', () => {
    const scanned = reduceQrSession(shown(), { kind: 'screen', screen: 'progress', at: LATER });
    expect(scanned.state).toBe('scanned');
    expect(scanned.qr).toBeUndefined();
  });

  it('takes the activation success screen as a scan, even one left over from an earlier session', () => {
    const afterQr = reduceQrSession(shown(), { kind: 'screen', screen: 'activated', at: LATER });
    expect(afterQr.state).toBe('finishing');
    expect(afterQr.qr).toBeUndefined();
    const leftover = reduceQrSession(starting(), { kind: 'screen', screen: 'activated', at: LATER });
    expect(leftover.state).toBe('finishing');
    expect(reduceQrSession(lose(shown()), { kind: 'screen', screen: 'activated', at: LATER }).state).toBe(
      'finishing',
    );
    expect(reduceQrSession(starting(), { kind: 'screen', screen: 'ads_consent', at: LATER }).state).toBe(
      'finishing',
    );
  });

  it('reports finishing while post-scan prompts are cleared, and stays there', () => {
    const scanned = reduceQrSession(shown(), { kind: 'screen', screen: 'progress', at: LATER });
    for (const screen of ['permission', 'dialog', 'profile_name'] as const) {
      expect(reduceQrSession(scanned, { kind: 'screen', screen, at: LATER }).state).toBe('finishing');
    }
    const finishing = reduceQrSession(scanned, { kind: 'screen', screen: 'dialog', at: LATER });
    expect(reduceQrSession(finishing, { kind: 'screen', screen: 'progress', at: LATER }).state).toBe(
      'finishing',
    );
  });

  it('reaches ready when the chat list appears, from any live state', () => {
    for (const session of [starting(), shown()]) {
      const ready = reduceQrSession(session, { kind: 'screen', screen: 'chat_list', at: LATER });
      expect(ready.state).toBe('ready');
      expect(ready.qr).toBeUndefined();
    }
  });

  it('fails loudly when the number leads to the SMS flow instead of a QR', () => {
    const session = reduceQrSession(starting(), { kind: 'screen', screen: 'sms_code', at: AT });
    expect(session.state).toBe('error');
    expect(session.error).toMatch(/SMS/u);
  });

  it('calls it an error, not a scan, when Viber falls back to registration after the QR', () => {
    for (const screen of ['welcome', 'phone_entry', 'confirm_number'] as const) {
      const session = reduceQrSession(shown(), { kind: 'screen', screen, at: LATER });
      expect(session.state).toBe('error');
      expect(session.error).toContain(screen);
    }
  });

  it('lets the registration screens pass before any QR was shown', () => {
    for (const screen of ['welcome', 'phone_entry', 'confirm_number'] as const) {
      expect(reduceQrSession(starting(), { kind: 'screen', screen, at: AT }).state).toBe('starting');
    }
  });

  it('counts unknown screens and gives up only after the limit', () => {
    let session = starting();
    for (let i = 0; i < UNKNOWN_SCREEN_LIMIT - 1; i += 1) {
      session = reduceQrSession(session, { kind: 'screen', screen: 'unknown', at: AT });
      expect(session.state).toBe('starting');
    }
    session = reduceQrSession(session, { kind: 'screen', screen: 'unknown', at: AT });
    expect(session.state).toBe('unknown_screen');
  });

  it('leaves unknown_screen for the phase it interrupted once a screen is recognised', () => {
    const lostBefore = lose(starting());
    expect(lostBefore.state).toBe('unknown_screen');
    expect(reduceQrSession(lostBefore, { kind: 'screen', screen: 'phone_entry', at: LATER }).state).toBe(
      'starting',
    );
  });

  it('still recognises a scan when the flow got lost after the QR was shown', () => {
    const lostAfter = lose(shown());
    expect(lostAfter.state).toBe('unknown_screen');
    const next = reduceQrSession(lostAfter, { kind: 'screen', screen: 'dialog', at: LATER });
    expect(next.state).toBe('finishing');
    expect(next.qr).toBeUndefined();
  });

  it('forgets the unknown streak as soon as a screen is recognised again', () => {
    let session = starting();
    for (let i = 0; i < UNKNOWN_SCREEN_LIMIT - 1; i += 1) {
      session = reduceQrSession(session, { kind: 'screen', screen: 'unknown', at: AT });
    }
    session = reduceQrSession(session, { kind: 'screen', screen: 'qr', qrPayload: 'x', at: AT });
    session = reduceQrSession(session, { kind: 'screen', screen: 'unknown', at: AT });
    expect(session.state).toBe('qr_ready');
    expect(session.unknownStreak).toBe(1);
  });

  it('records an error and its message', () => {
    const session = reduceQrSession(starting(), { kind: 'error', message: 'adb died', at: AT });
    expect(session.state).toBe('error');
    expect(session.error).toBe('adb died');
  });

  it('returns to idle on cancel', () => {
    const cancelled = reduceQrSession(shown(), { kind: 'cancel', at: LATER });
    expect(cancelled.state).toBe('idle');
    expect(cancelled.qr).toBeUndefined();
  });

  it('never moves on once ready', () => {
    const ready = reduceQrSession(starting(), { kind: 'screen', screen: 'chat_list', at: AT });
    const after = reduceQrSession(ready, { kind: 'screen', screen: 'sms_code', at: LATER });
    expect(after.state).toBe('ready');
  });

  it('keeps a screen hint so the operator can see where the flow stands', () => {
    const session = reduceQrSession(starting(), { kind: 'screen', screen: 'phone_entry', at: AT });
    expect(session.screenHint).toBe('phone_entry');
  });
});
