import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import QRCode from 'qrcode';
import { cropPng, decodeQrFromPng, renderQrSvg } from '../../src/features/auth/qr/qr-image.js';

const PAYLOAD = 'viber://qr?token=AbCdEf0123456789';

async function makeQrPng(payload: string, scale = 6): Promise<Buffer> {
  return QRCode.toBuffer(payload, { type: 'png', scale, margin: 4 });
}

/** A white canvas with `inner` pasted at (left, top) — a QR on a screenshot. */
function pasteOnCanvas(
  inner: Buffer,
  canvasWidth: number,
  canvasHeight: number,
  left: number,
  top: number,
): Buffer {
  const source = PNG.sync.read(inner);
  const canvas = new PNG({ width: canvasWidth, height: canvasHeight });
  canvas.data.fill(0xff);
  PNG.bitblt(source, canvas, 0, 0, source.width, source.height, left, top);
  return PNG.sync.write(canvas);
}

describe('decodeQrFromPng', () => {
  it('reads back the payload of a QR code rendered as PNG', async () => {
    const png = await makeQrPng(PAYLOAD);
    expect(decodeQrFromPng(png)).toBe(PAYLOAD);
  });

  it('finds a QR that occupies only part of a larger screenshot', async () => {
    const qr = await makeQrPng(PAYLOAD, 4);
    const screenshot = pasteOnCanvas(qr, 540, 960, 60, 240);
    expect(decodeQrFromPng(screenshot)).toBe(PAYLOAD);
  });

  it('returns null when the image carries no QR code', () => {
    const blank = new PNG({ width: 64, height: 64 });
    blank.data.fill(0xff);
    expect(decodeQrFromPng(PNG.sync.write(blank))).toBeNull();
  });

  it('returns null instead of throwing on data that is not a PNG', () => {
    expect(decodeQrFromPng(Buffer.from('not a png at all'))).toBeNull();
  });
});

describe('renderQrSvg', () => {
  it('produces a standalone SVG carrying the same payload', async () => {
    const svg = await renderQrSvg(PAYLOAD);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox');
    // Scalable output: no raster data smuggled in.
    expect(svg).not.toContain('data:image/png');
  });

  it('round-trips: the rendered SVG describes the QR the payload encodes', async () => {
    const svg = await renderQrSvg(PAYLOAD);
    const reference = await QRCode.toString(PAYLOAD, { type: 'svg', margin: 4 });
    // Same module matrix — the path data is what encodes the payload.
    const pathOf = (markup: string): string => /d="([^"]+)"/u.exec(markup)?.[1] ?? '';
    expect(pathOf(svg)).toBe(pathOf(reference));
    expect(pathOf(svg)).not.toBe('');
  });
});

describe('cropPng', () => {
  it('cuts out the requested rectangle so the QR alone can be decoded', async () => {
    const qr = await makeQrPng(PAYLOAD, 4);
    const { width } = PNG.sync.read(qr);
    const screenshot = pasteOnCanvas(qr, 540, 960, 60, 240);

    const cropped = cropPng(screenshot, {
      left: 60,
      top: 240,
      right: 60 + width,
      bottom: 240 + width,
    });

    const out = PNG.sync.read(cropped);
    expect(out.width).toBe(width);
    expect(out.height).toBe(width);
    expect(decodeQrFromPng(cropped)).toBe(PAYLOAD);
  });

  it('clamps a rectangle that runs past the edge of the screenshot', () => {
    const canvas = new PNG({ width: 100, height: 100 });
    canvas.data.fill(0xff);
    const cropped = cropPng(PNG.sync.write(canvas), {
      left: 80,
      top: 80,
      right: 200,
      bottom: 200,
    });
    const out = PNG.sync.read(cropped);
    expect(out.width).toBe(20);
    expect(out.height).toBe(20);
  });

  it('rejects a rectangle that lies entirely outside the screenshot', () => {
    const canvas = new PNG({ width: 100, height: 100 });
    expect(() =>
      cropPng(PNG.sync.write(canvas), { left: 120, top: 120, right: 160, bottom: 160 }),
    ).toThrow(/outside/iu);
  });
});
