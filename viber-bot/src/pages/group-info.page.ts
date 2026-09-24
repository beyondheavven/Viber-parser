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
  /**
   * Texts and positions inside the panel. Two scans with the same signature
   * mean a scroll did not move anything — more reliable than UiAutomator's
   * `canScrollMore`, which also answers false when the gesture never landed.
   */
  signature: string;
}

/** Smallest height a target may be clipped to and still be worth tapping. */
const MIN_TAPPABLE_HEIGHT = 24;

/**
 * True when `target` is fully inside the panel and tall enough to hit. A row
 * half-scrolled under the panel's bottom edge has its bounds clipped, and a tap
 * on the sliver that is left tends to land on whatever sits next to it.
 */
export function isTappable(target: Bounds, panel: Bounds | null): boolean {
  if (target.bottom - target.top < MIN_TAPPABLE_HEIGHT) return false;
  if (panel === null) return true;
  return target.top >= panel.top && target.bottom < panel.bottom;
}

/**
 * The rectangle a scroll gesture is drawn in: the panel shrunk away from its
 * edges and from the bottom of the screen.
 *
 * `mobile: scrollGesture` starts its swipe near the bottom of the area it is
 * given. At 1280x720 the info panel reaches the screen's last pixel row, so a
 * swipe drawn over the full panel starts on the very edge, Android drops it,
 * and the call reports that the view cannot scroll.
 */
export function gestureArea(panel: Bounds, windowHeight: number): Bounds {
  const width = panel.right - panel.left;
  const height = panel.bottom - panel.top;
  const bottomLimit = Math.round(windowHeight * 0.92);
  const area = {
    left: Math.round(panel.left + width * 0.1),
    top: Math.round(panel.top + height * 0.12),
    right: Math.round(panel.right - width * 0.1),
    bottom: Math.min(Math.round(panel.bottom - height * 0.12), bottomLimit),
  };
  // A panel squeezed into a strip still gets a usable, if small, area.
  if (area.bottom - area.top < 60) {
    return { ...area, top: panel.top, bottom: Math.min(panel.bottom, bottomLimit) };
  }
  return area;
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
        participantsAction = actionNextTo(nodes, index, actionIds) ?? parseBounds(node.bounds);
      }
    }

    if (showAll === null && isShowAllLabel(text)) {
      showAll = parseBounds(node.bounds);
    }
  }

  const panelNodes: XmlNode[] = [];
  if (panelNode !== undefined) collectAll(panelNode, panelNodes);
  const signature = panelNodes
    .map((node) => {
      const text = normalise(node.text) || normalise(node['content-desc']);
      return text === '' ? '' : `${text}@${String(parseBounds(node.bounds)?.top ?? '?')}`;
    })
    .filter((entry) => entry !== '')
    .join('|');

  return { panel, showAll, participantsAction, sectionTitles, signature };
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
    if (resourceId !== undefined && actionIds.has(resourceId)) {
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
    await this.isPresent(selectors.groupInfo.list, 3_000);
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
    if (await this.participantsListOpened()) {
      return;
    }

    let scan = await this.scanPanel();
    let sectionTitles = scan.sectionTitles;
    let stalled = 0;

    for (let scroll = 0; scroll <= GroupInfoPage.MAX_PANEL_SCROLLS; scroll += 1) {
      const target = scan.showAll ?? scan.participantsAction;
      // A target clipped by the panel edge is scrolled into full view first.
      if (target !== null && isTappable(target, scan.panel)) {
        await this.tapBounds(target);
        if (await this.participantsListOpened()) return;
        // The tap landed on a row that was still settling; carry on scanning.
      }

      const before = scan.signature;
      await this.scrollPanel(scan.panel);
      scan = await this.scanPanel();
      if (scan.sectionTitles.length > 0) sectionTitles = scan.sectionTitles;

      // Judge movement by what is on screen. One still frame can be a gesture
      // that did not register, so give up only after two in a row.
      stalled = scan.signature === before ? stalled + 1 : 0;
      if (stalled >= 2 && scan.showAll === null && scan.participantsAction === null) break;
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
   * Scrolls the info panel down by a good part of its height. Whether it moved
   * is decided by the caller from the next snapshot, not from the gesture's
   * own answer (see {@link gestureArea}).
   */
  private async scrollPanel(panel: Bounds | null): Promise<void> {
    const { height } = await this.driver.getWindowSize();
    const area = gestureArea(panel ?? (await this.fallbackPanelArea()), height);
    await this.driver.execute('mobile: scrollGesture', {
      left: area.left,
      top: area.top,
      width: area.right - area.left,
      height: area.bottom - area.top,
      direction: 'down',
      percent: 0.7,
      speed: 1_600,
    });
    await this.driver.pause(500);
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
