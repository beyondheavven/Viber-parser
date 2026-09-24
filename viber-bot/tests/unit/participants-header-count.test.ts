import { describe, expect, it } from 'vitest';

import { parseRosterPageSource } from '../../src/pages/participants.page.js';

function withHeader(header: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <hierarchy>
      <node resource-id="android:id/content" bounds="[0,0][1280,720]">
        <node text="${header}" resource-id="com.viber.voip:id/text" bounds="[0,108][1280,160]" />
        <node resource-id="com.viber.voip:id/recycler_view" bounds="[0,160][1280,720]" />
      </node>
    </hierarchy>`;
}

describe('participants header count across locales', () => {
  it.each([
    ['MEMBERS (1,615)', 1_615], // English, as captured on the emulator
    ['УЧАСТНИКИ (1 632)', 1_632],
    ['УЧАСТНИКИ (1 632)', 1_632],
    ['MITGLIEDER (1.615)', 1_615],
    ['MEMBERS (43)', 43],
  ])('reads %s as %d', (header, expected) => {
    expect(parseRosterPageSource(withHeader(header)).totalCount).toBe(expected);
  });

  it('keeps grouped digits together in the fallback without brackets', () => {
    expect(parseRosterPageSource(withHeader('1,615 members')).totalCount).toBe(1_615);
  });
});
