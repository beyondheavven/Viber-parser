import { describe, expect, it } from 'vitest';

import { scanInfoPanelSource } from '../../src/viber/pages/group-info.page.js';

/** A chat-info header row: a section title with its trailing action. */
function header(title: string, action: string, top: number): string {
  return `
    <node resource-id="com.viber.voip:id/header_container" bounds="[600,${String(top)}][1000,${String(top + 60)}]">
      <node text="${title}" resource-id="com.viber.voip:id/startText" bounds="[610,${String(top)}][800,${String(top + 60)}]" />
      <node text="${action}" resource-id="com.viber.voip:id/endText" bounds="[820,${String(top)}][990,${String(top + 60)}]" />
    </node>`;
}

function panel(...rows: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <hierarchy>
      <node resource-id="com.viber.voip:id/conversation_fragment" bounds="[0,0][600,800]">
        <node resource-id="com.viber.voip:id/conversation_recycler_view" bounds="[0,80][600,800]" />
      </node>
      <node resource-id="com.viber.voip:id/conversation_info_fragment" bounds="[600,0][1000,800]">
        <node resource-id="com.viber.voip:id/conversationInfo" bounds="[600,80][1000,800]">${rows.join('')}
        </node>
      </node>
    </hierarchy>`;
}

describe('scanInfoPanelSource', () => {
  it('locates the panel and the "show all" action among the rendered sections', () => {
    const scan = scanInfoPanelSource(
      panel(header('МЕДИА', 'Показать все', 100), header('УЧАСТНИКИ (1 632)', 'Показать всех', 300)),
    );

    expect(scan.panel).toEqual({ left: 600, top: 80, right: 1000, bottom: 800 });
    expect(scan.showAll).toEqual({ left: 820, top: 300, right: 990, bottom: 360 });
    expect(scan.sectionTitles).toEqual(['МЕДИА', 'УЧАСТНИКИ (1 632)']);
  });

  it('does not mistake another section’s trailing action for the participants one', () => {
    const scan = scanInfoPanelSource(panel(header('МЕДИА', 'Показать все', 100)));

    expect(scan.showAll).toBeNull();
    expect(scan.participantsAction).toBeNull();
  });

  it('matches the action in the other languages Viber ships it in', () => {
    for (const label of ['Показати всіх', 'Паказаць усё', 'Show all']) {
      const scan = scanInfoPanelSource(panel(header('MEMBERS (12)', label, 100)));
      expect(scan.showAll, label).toEqual({ left: 820, top: 100, right: 990, bottom: 160 });
    }
  });

  it('falls back to the participants header action when the label is unknown', () => {
    const scan = scanInfoPanelSource(
      panel(header('МЕДИА', 'Больше', 100), header('УЧАСТНИКИ (7)', 'Все', 300)),
    );

    expect(scan.showAll).toBeNull();
    expect(scan.participantsAction).toEqual({ left: 820, top: 300, right: 990, bottom: 360 });
  });

  it('reports no panel and no sections while the info panel is closed', () => {
    const scan = scanInfoPanelSource(`<?xml version="1.0" encoding="UTF-8"?>
      <hierarchy>
        <node resource-id="com.viber.voip:id/conversation_recycler_view" bounds="[0,80][1000,800]" />
      </hierarchy>`);

    expect(scan).toEqual({
      panel: null,
      showAll: null,
      participantsAction: null,
      sectionTitles: [],
    });
  });
});
