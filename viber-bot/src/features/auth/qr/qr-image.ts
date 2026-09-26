import jsQrDefault from 'jsqr';
import type { Options as JsQrOptions, QRCode as JsQrResult } from 'jsqr';
import { PNG } from 'pngjs';
import QRCode from 'qrcode';
import type { Bounds } from '../../../viber/pages/page-source.js';

/**
 * jsqr ships a CommonJS bundle whose types describe an ES default export, and
 * this project compiles without `esModuleInterop` — so the binding types as the
 * module namespace even though it is the function at runtime.
 */
const jsQR = jsQrDefault as unknown as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: JsQrOptions,
) => JsQrResult | null;

/** Four modules of quiet zone is what the QR spec asks for. */
const QUIET_ZONE_MODULES = 4;

/**
 * Reads the QR payload out of a screenshot.
 *
 * Never throws: it runs on every poll, and a frame taken mid-animation is an
 * ordinary "not yet", not a failure of the flow.
 */
export function decodeQrFromPng(png: Buffer): string | null {
  let image: PNG;
  try {
    image = PNG.sync.read(png);
  } catch {
    return null;
  }
  try {
    const result = jsQR(new Uint8ClampedArray(image.data), image.width, image.height, {
      inversionAttempts: 'attemptBoth',
    });
    return result === null || result.data === '' ? null : result.data;
  } catch {
    return null;
  }
}

/**
 * Re-draws a decoded payload as vector art.
 *
 * The code on screen is 150–200 px of pixels; scaling that up in a browser is
 * what makes it unscannable. Re-rendering from the payload is crisp at any size.
 */
export async function renderQrSvg(payload: string): Promise<string> {
  return QRCode.toString(payload, {
    type: 'svg',
    margin: QUIET_ZONE_MODULES,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000ff', light: '#ffffffff' },
  });
}

/**
 * Cuts a rectangle out of a screenshot.
 *
 * Bounds are clamped rather than trusted: uiautomator reports rectangles that
 * reach past the display when a view is partly scrolled off.
 */
export function cropPng(png: Buffer, bounds: Bounds): Buffer {
  const source = PNG.sync.read(png);
  const left = Math.max(0, Math.min(bounds.left, source.width));
  const top = Math.max(0, Math.min(bounds.top, source.height));
  const right = Math.max(left, Math.min(bounds.right, source.width));
  const bottom = Math.max(top, Math.min(bounds.bottom, source.height));

  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) {
    throw new Error(
      `Crop rectangle [${String(bounds.left)},${String(bounds.top)}][${String(bounds.right)},${String(bounds.bottom)}] ` +
        `is outside the ${String(source.width)}x${String(source.height)} screenshot.`,
    );
  }

  const target = new PNG({ width, height });
  PNG.bitblt(source, target, left, top, width, height, 0, 0);
  return PNG.sync.write(target);
}
