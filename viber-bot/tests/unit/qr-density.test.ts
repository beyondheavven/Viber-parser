import { describe, expect, it } from 'vitest';
import {
  DENSITY_MARKER_PATH,
  densityForTabletLayout,
  isTabletLayout,
  parseWmDensities,
  parseWmSize,
  widenForTabletLayout,
} from '../../src/features/auth/qr/density.js';

/** A device shell that remembers `wm density` and the marker file. */
function fakeDevice(options: { size: string; physical: number; override?: number; marker?: number }) {
  let override = options.override ?? null;
  let marker = options.marker ?? null;
  const commands: string[] = [];
  return {
    commands,
    get override() {
      return override;
    },
    get marker() {
      return marker;
    },
    shell(command: string): string {
      commands.push(command);
      if (command === 'wm size') return options.size;
      if (command === 'wm density') {
        return `Physical density: ${String(options.physical)}\n` +
          (override === null ? '' : `Override density: ${String(override)}\n`);
      }
      if (command === 'wm density reset') {
        override = null;
        return '';
      }
      const set = /^wm density (\d+)$/u.exec(command);
      if (set) {
        override = Number(set[1]);
        return '';
      }
      if (command.startsWith('cat ')) return marker === null ? '' : `${String(marker)}\n`;
      const echo = /^echo (\d+) > /u.exec(command);
      if (echo) {
        marker = Number(echo[1]);
        return '';
      }
      if (command === `rm -f ${DENSITY_MARKER_PATH}`) {
        marker = null;
        return '';
      }
      return '';
    },
  };
}

describe('screen metrics', () => {
  it('reads both densities and prefers the override size', () => {
    expect(parseWmDensities('Physical density: 160\nOverride density: 120')).toEqual({
      physical: 160,
      override: 120,
    });
    expect(parseWmSize('Physical size: 720x1280\nOverride size: 540x960')).toEqual({
      width: 540,
      height: 960,
    });
  });

  it('decides sw600dp on the smallest side, so a landscape panel is not taken for a tablet', () => {
    expect(isTabletLayout({ width: 1280, height: 720 }, 240)).toBe(false);
    expect(isTabletLayout({ width: 1280, height: 720 }, 160)).toBe(true);
    expect(densityForTabletLayout({ width: 1280, height: 720 })).toBe(192);
    expect(densityForTabletLayout({ width: 540, height: 960 })).toBe(144);
  });
});

describe('widenForTabletLayout', () => {
  it('drops a phone-sized screen to the tablet density and restores it with a reset', () => {
    const device = fakeDevice({ size: 'Physical size: 540x960', physical: 160 });
    const { restore } = widenForTabletLayout(device);
    expect(device.override).toBe(120);
    expect(device.marker).toBe(160);

    restore?.();
    expect(device.override).toBeNull();
    expect(device.marker).toBeNull();
  });

  it('retries a blank `wm size` instead of silently skipping the tablet layout', () => {
    const device = fakeDevice({ size: 'Physical size: 1280x720', physical: 240 });
    let blanks = 2;
    const flaky = {
      ...device,
      shell(command: string): string {
        if (command === 'wm size' && blanks > 0) {
          blanks -= 1;
          return '';
        }
        return device.shell(command);
      },
    };
    const { restore } = widenForTabletLayout(flaky);
    expect(restore).not.toBeNull();
    expect(device.override).toBe(120);
  });

  it('puts back a deliberate override rather than the physical density', () => {
    const device = fakeDevice({ size: 'Physical size: 540x960', physical: 240, override: 200 });
    widenForTabletLayout(device).restore?.();
    expect(device.override).toBe(200);
  });

  it('leaves a screen that already has the tablet layout alone', () => {
    const device = fakeDevice({ size: 'Physical size: 1080x1920', physical: 160 });
    expect(widenForTabletLayout(device).restore).toBeNull();
    expect(device.commands.some((command) => /^wm density \d+$/u.test(command))).toBe(false);
  });

  it('recognises the leftover of an interrupted session by its marker', () => {
    const device = fakeDevice({ size: 'Physical size: 540x960', physical: 160, override: 120, marker: 160 });
    const { restore } = widenForTabletLayout(device);
    expect(device.marker).toBe(160);
    restore?.();
    expect(device.override).toBeNull();
  });

  it('cleans up a leftover even when no widening is needed any more', () => {
    const device = fakeDevice({ size: 'Physical size: 1080x1920', physical: 160, override: 100, marker: 160 });
    expect(widenForTabletLayout(device).restore).toBeNull();
    expect(device.override).toBeNull();
    expect(device.marker).toBeNull();
  });

  it('does nothing when the metrics cannot be read', () => {
    const device = fakeDevice({ size: 'garbage', physical: 160 });
    expect(widenForTabletLayout(device).restore).toBeNull();
    expect(device.override).toBeNull();
  });
});
