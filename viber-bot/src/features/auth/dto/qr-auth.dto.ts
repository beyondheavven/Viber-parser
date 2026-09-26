import type { QrAuthState } from '../qr/qr-state.js';

export interface QrStartDto {
  /**
   * Number of the Viber account the emulator joins as a secondary device.
   * Falls back to VIBER_DEFAULT_PHONE. No SMS is sent: the number only tells
   * Viber which existing account to look up.
   */
  phoneNumber?: string;
  /** Calling code ("48", "380"). Taken from a `+`-prefixed number when omitted. */
  countryCode?: string;
  /** Wipe Viber's data first (`pm clear`) — required when another account is logged in. */
  clearData?: boolean;
  /** Profile name, if Viber asks for one after the activation. */
  userName?: string;
}

export interface QrStartResponseDto {
  state: QrAuthState;
  message: string;
}

export interface QrCodeDto {
  /** Contents of the code as read off the screenshot (a `viber://…` activation link). */
  payload?: string;
  /** The code re-rendered as SVG — scales without losing scannability. */
  svg?: string;
  /** The code cut out of the screenshot, base64 PNG. Fallback when it would not decode. */
  pngBase64?: string;
  /** When this code was captured, ISO 8601. */
  capturedAt: string;
}

export interface QrStatusDto {
  state: QrAuthState;
  qr?: QrCodeDto;
  /** Last recognised Viber screen (welcome, phone_entry, qr, dialog, …). */
  screenHint?: string;
  /** Full screenshot, base64 PNG — only in `unknown_screen`, so an operator can step in. */
  screenshotBase64?: string;
  error?: string;
  startedAt?: string;
  updatedAt?: string;
}
