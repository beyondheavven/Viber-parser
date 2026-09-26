import { setTimeout as delay } from 'node:timers/promises';
import { BasePage } from './base.page.js';
import {
  centerOf,
  collectAll,
  parseBounds,
  parseHierarchy,
  type Bounds,
  type XmlNode,
} from './page-source.js';
import {
  PARTICIPANTS_SECTION_REGEX,
  SHOW_ALL_PARTICIPANTS_REGEX,
  selectors,
} from './selectors.js';

export interface PanelScan {
  /** Bounds of the info panel's own RecyclerView, when it is on screen. */
  panel: Bounds | null;
  /** The "show all participants" action, when it is currently rendered. */
  showAll: Bounds | null;
  /** Trailing action of the participants section header, matched by its title. */
  participantsAction: Bounds | null;
  /** Section titles rendered right now — the evidence in the failure message. */
  sectionTitles: string[];
}

function normalise(text: string | undefined): string {
  return (text ?? '').replace(/\s+/gu, ' ').trim();
}

function isShowAllLabel(text: string): boolean {
  return SHOW_ALL_PARTICIPANTS_REGEX.test(text);
}

function isParticipantsTitle(text: string): boolean {
  return PARTICIPANTS_SECTION_REGEX.test(text);
}

/**
 * Reads one info-panel hierarchy snapshot: where the panel is, whether the
 * "show all participants" action is currently bound, and which sections are
 * rendered — the last of these being what a failure has to report.
 */
export function scanInfoPanelSource(xml: string): PanelScan {
  const nodes: XmlNode[] = [];
  collectAll(parseHierarchy(xml), nodes);

  const panelNode = nodes.find((node) => node['resource-id'] === selectors.groupInfo.list);
  const panel = parseBounds(panelNode?.bounds);

  const titleIds = new Set<string>([
    selectors.groupInfo.sectionTitle,
    selectors.groupInfo.legacySectionTitle,
  ]);
  const actionIds = new Set<string>([
    selectors.groupInfo.sectionAction,
    selectors.groupInfo.legacySectionAction,
  ]);

  const sectionTitles: string[] = [];
  let showAll: Bounds | null = null;
  let participantsAction: Bounds | null = null;

  for (const [index, node] of nodes.entries()) {
    const resourceId = node['resource-id'];
    const text = normalise(node.text);
    if (text === '') continue;

    if (resourceId !== undefined && titleIds.has(resourceId)) {
      sectionTitles.push(text);
      if (participantsAction === null && isParticipantsTitle(text)) {
        participantsAction = actionNextTo(nodes, index, actionIds);
      }
    }

    if (showAll === null && isShowAllLabel(text)) {
      showAll = parseBounds(node.bounds);
    }
  }

  return { panel, showAll, participantsAction, sectionTitles };
}

/**
 * A header's action node follows its title in the hierarchy, so the next
 * action node is the one belonging to that section — matching by id alone
 * would just as happily pick up another section's trailing action.
 */
function actionNextTo(nodes: XmlNode[], titleIndex: number, actionIds: Set<string>): Bounds | null {
  const limit = Math.min(titleIndex + 5, nodes.length);
  for (let index = titleIndex + 1; index < limit; index += 1) {
    const node = nodes[index];
    if (node === undefined) continue;
    const resourceId = node['resource-id'];
    if (resourceId !== undefined && actionIds.has(resourceId) && normalise(node.text) !== '') {
      return parseBounds(node.bounds);
    }
  }
  return null;
}

/**
 * The group info panel.
 *
 * On LDPlayer's landscape (tablet) layout the info opens as a panel on the
 * right half of the conversation screen rather than as its own activity. The
 * conversation's message list stays on screen beside it and is scrollable too,
 * so every scroll here is aimed at the panel's own RecyclerView
 * (`conversationInfo`) rather than at "the first scrollable view".
 */
export class GroupInfoPage extends BasePage {
  /**
   * The participants section sits below the panel's settings rows, so reaching
   * it takes a fair number of scrolls on a long info panel.
   */
  private static readonly MAX_PANEL_SCROLLS = 20;
  /** Fallback panel position when `conversationInfo` cannot be located. */
  private static readonly PANEL_X_FRACTION = 0.72;

  /**
   * Opens the info panel by tapping the toolbar title.
   *
   * The tap has to land on the title text, which sits at the left of a very
   * wide landscape toolbar — clicking the toolbar element itself would hit its
   * empty centre.
   */
  async open(): Promise<void> {
    if (await this.isOpen()) {
      return;
    }

    // Actively check and dismiss any modal dialog (e.g. profile prompt "Добавить информацию")
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const cancelButton = await this.driver.$('android=new UiSelector().resourceId("android:id/button2")');
        if (await cancelButton.isExisting()) {
          await cancelButton.click();
          await delay(500);
        }
      } catch {
        // Ignored
      }

      if (await this.isPresent(selectors.chat.toolbar, 500)) {
        break;
      }
      await delay(500);
    }

    const toolbar = await this.waitFor(selectors.chat.toolbar);
    const title = await toolbar.$('android.widget.TextView');
    await title.waitForExist({ timeout: 10_000 });
    await title.click();
    await this.waitFor(selectors.groupInfo.fragment);
    await delay(600);
  }

  async isOpen(): Promise<boolean> {
    return this.isPresent(selectors.groupInfo.fragment);
  }

  /**
   * Opens the full participants list via the "show all" action, scrolling the
   * info panel until it is rendered.
   *
   * The action lives in a RecyclerView, so it enters the hierarchy only once it
   * has been scrolled close enough to be bound — waiting for it without
   * scrolling finds nothing however long the wait.
   */
  async openAllParticipants(): Promise<void> {
    if (await this.participantsListOpened()) return;

    let scan = await this.scanPanel();
    let sectionTitles = scan.sectionTitles;

    for (let scroll = 0; scroll <= GroupInfoPage.MAX_PANEL_SCROLLS; scroll += 1) {
      const target = scan.showAll ?? scan.participantsAction;
      if (target !== null) {
        await this.tapBounds(target);
        if (await this.participantsListOpened()) return;
        // The tap landed on a row that was still settling; carry on scanning.
      }

      await this.scrollPanel(scan.panel);
      scan = await this.scanPanel();
      if (scan.sectionTitles.length > 0) sectionTitles = scan.sectionTitles;
    }

    const where =
      scan.panel === null
        ? 'the info panel was not on screen'
        : `panel bounds ${JSON.stringify(scan.panel)}`;
    throw new Error(
      `"Show all" button did not appear after scrolling the info panel ` +
        `(${where}; sections seen: ${sectionTitles.length > 0 ? sectionTitles.join(' | ') : 'none'}).`,
    );
  }

  /** One hierarchy snapshot answers every question this screen needs. */
  private async scanPanel(): Promise<PanelScan> {
    return scanInfoPanelSource(await this.driver.getPageSource());
  }

  private async tapBounds(bounds: Bounds): Promise<void> {
    const { x, y } = centerOf(bounds);
    await this.driver.execute('mobile: clickGesture', { x, y });
    await this.driver.pause(600);
  }

  /**
   * `itemLayout` belongs to `participants_list_item` and to nothing else in
   * the app, so it tells the full list apart from the panel's preview rows —
   * which the panel draws with the same `name` id the list rows use.
   */
  private async participantsListOpened(): Promise<boolean> {
    return this.isPresent(selectors.participants.row, 2_500);
  }

  /**
   * Scrolls the info panel down by performing a touch swipe upwards (moving content down).
   */
  private async scrollPanel(panel: Bounds | null): Promise<boolean> {
    const area = panel ?? (await this.fallbackPanelArea());
    const centerX = Math.round((area.left + area.right) / 2);
    const startY = Math.round(area.top + (area.bottom - area.top) * 0.75);
    const endY = Math.round(area.top + (area.bottom - area.top) * 0.25);

    try {
      await this.driver.performActions([
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: centerX, y: startY },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 100 },
            { type: 'pointerMove', duration: 400, x: centerX, y: endY },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ]);
      await this.driver.releaseActions();
      await this.driver.pause(500);
    } catch {
      // Fallback to mobile scrollGesture if actions fail
      await this.driver.execute('mobile: scrollGesture', {
        left: area.left,
        top: area.top,
        width: area.right - area.left,
        height: area.bottom - area.top,
        direction: 'down',
        percent: 0.8,
        speed: 1_600,
      });
      await this.driver.pause(500);
    }
    return true;
  }

  /**
   * Where to scroll when `conversationInfo` is not in the hierarchy: a column
   * on the right of the screen, which is where the panel sits in the landscape
   * layout.
   */
  private async fallbackPanelArea(): Promise<Bounds> {
    const { width, height } = await this.driver.getWindowSize();
    return {
      left: Math.round(width * (GroupInfoPage.PANEL_X_FRACTION - 0.2)),
      top: Math.round(height * 0.2),
      right: Math.min(width - 1, Math.round(width * 0.98)),
      bottom: Math.round(height * 0.85),
    };
  }
}
