import { describe, expect, it } from 'vitest';

import { parseRosterPageSource } from '../../src/viber/pages/participants.page.js';

describe('parseRosterPageSource', () => {
  it('extracts the header count and physical rows from one hierarchy snapshot', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <hierarchy>
        <node resource-id="android:id/content" bounds="[0,0][1000,600]">
          <node text="УЧАСТНИКИ (1 632)" resource-id="com.viber.voip:id/text" bounds="[0,0][1000,80]" />
          <node resource-id="com.viber.voip:id/recycler_view" bounds="[0,80][1000,600]">
            <node resource-id="com.viber.voip:id/itemLayout" bounds="[0,100][1000,180]">
              <node text="LENA &amp; Co" resource-id="com.viber.voip:id/name" bounds="[100,120][800,160]" />
              <node text="АДМИНИСТРАТОР" resource-id="com.viber.voip:id/groupRole" bounds="[800,110][990,170]" />
            </node>
            <node resource-id="com.viber.voip:id/itemLayout" bounds="[0,180][1000,260]">
              <node text="Lena" resource-id="com.viber.voip:id/name" bounds="[100,200][800,240]" />
            </node>
          </node>
        </node>
      </hierarchy>`;

    expect(parseRosterPageSource(xml)).toEqual({
      totalCount: 1_632,
      list: { left: 0, top: 80, right: 1000, bottom: 600 },
      rows: [
        {
          name: 'LENA & Co',
          role: 'АДМИНИСТРАТОР',
          left: 0,
          top: 100,
          right: 1000,
          bottom: 180,
        },
        {
          name: 'Lena',
          role: null,
          left: 0,
          top: 180,
          right: 1000,
          bottom: 260,
        },
      ],
    });
  });

  it('handles Appium-style XML where element tags are Java class names', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <hierarchy rotation="0">
        <android.widget.FrameLayout bounds="[0,0][1000,600]">
          <androidx.recyclerview.widget.RecyclerView resource-id="com.viber.voip:id/recycler_view" bounds="[0,80][1000,600]">
            <android.widget.TextView text="УЧАСТНИКИ (43)" resource-id="com.viber.voip:id/text" bounds="[0,80][1000,120]" />
            <android.view.ViewGroup resource-id="com.viber.voip:id/itemLayout" bounds="[0,120][1000,200]">
              <android.widget.TextView text="Alice" resource-id="com.viber.voip:id/name" bounds="[100,130][800,180]" />
            </android.view.ViewGroup>
          </androidx.recyclerview.widget.RecyclerView>
        </android.widget.FrameLayout>
      </hierarchy>`;

    expect(parseRosterPageSource(xml)).toEqual({
      totalCount: 43,
      list: { left: 0, top: 80, right: 1000, bottom: 600 },
      rows: [
        {
          name: 'Alice',
          role: null,
          left: 0,
          top: 120,
          right: 1000,
          bottom: 200,
        },
      ],
    });
  });
});
