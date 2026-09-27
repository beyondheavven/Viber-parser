import { describe, expect, it } from 'vitest';

import { gestureArea, isTappable, scanInfoPanelSource } from '../../src/pages/group-info.page.js';

/** Info panel exactly as captured at 1280x720: it runs to the last pixel row. */
const PANEL = { left: 90, top: 284, right: 1280, bottom: 720 };

describe('gestureArea', () => {
  it('keeps the swipe off the bottom edge of the screen', () => {
    const area = gestureArea(PANEL, 720);
    expect(area.bottom).toBeLessThanOrEqual(Math.round(720 * 0.92));
    expect(area.top).toBeGreaterThan(PANEL.top);
    expect(area.left).toBeGreaterThan(PANEL.left);
    expect(area.right).toBeLessThan(PANEL.right);
    expect(area.bottom - area.top).toBeGreaterThanOrEqual(60);
  });

  it('still returns a usable area for a squeezed panel', () => {
    const area = gestureArea({ left: 90, top: 600, right: 1280, bottom: 720 }, 720);
    expect(area.top).toBe(600);
    expect(area.bottom).toBe(Math.round(720 * 0.92));
  });
});

describe('isTappable', () => {
  it('rejects a "Show all" row clipped by the panel bottom', () => {
    // Seen live: the row half under the edge, bounds [90,706][200,720].
    expect(isTappable({ left: 90, top: 706, right: 200, bottom: 720 }, PANEL)).toBe(false);
  });

  it('accepts a row fully inside the panel', () => {
    expect(isTappable({ left: 90, top: 415, right: 200, bottom: 454 }, { ...PANEL, top: 108 })).toBe(true);
  });

  it('accepts any tall enough target when the panel is unknown', () => {
    expect(isTappable({ left: 0, top: 0, right: 10, bottom: 40 }, null)).toBe(true);
    expect(isTappable({ left: 0, top: 0, right: 10, bottom: 10 }, null)).toBe(false);
  });
});

describe('scanInfoPanelSource signature', () => {
  const source = (top: number): string => `<?xml version="1.0" encoding="UTF-8"?>
    <hierarchy>
      <node resource-id="com.viber.voip:id/conversationInfo" bounds="[90,108][1280,720]">
        <node text="MEMBERS (1,615)" resource-id="com.viber.voip:id/startText" bounds="[90,${String(top)}][267,${String(top + 36)}]" />
        <node text="GS" resource-id="com.viber.voip:id/name" bounds="[197,${String(top + 60)}][1111,${String(top + 90)}]" />
      </node>
      <node text="outside the panel" bounds="[0,0][90,90]" />
    </hierarchy>`;

  it('changes when the panel content moves and ignores everything outside it', () => {
    const a = scanInfoPanelSource(source(459)).signature;
    const b = scanInfoPanelSource(source(169)).signature;
    expect(a).not.toBe(b);
    expect(a).toContain('MEMBERS (1,615)@459');
    expect(a).not.toContain('outside the panel');
    expect(scanInfoPanelSource(source(459)).signature).toBe(a);
  });

  it('finds the Viber 20.1 "Show all" row, which reuses the section-title id', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <hierarchy>
        <node resource-id="com.viber.voip:id/conversationInfo" bounds="[90,108][1280,720]">
          <node text="Show all" resource-id="com.viber.voip:id/startText" bounds="[90,415][200,454]" />
        </node>
      </hierarchy>`;
    expect(scanInfoPanelSource(xml).showAll).toEqual({ left: 90, top: 415, right: 200, bottom: 454 });
  });
});
