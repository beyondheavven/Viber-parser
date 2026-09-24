import { BasePage } from './base.page.js';
import {
  collectAll,
  collectDescendants,
  findDescendant,
  parseBounds,
  parseHierarchy,
  type XmlNode,
} from './page-source.js';
import { ParticipantNotFoundError, ParticipantUnreachableError } from './errors.js';
import {
  MESSAGE_OPTION_PREFIX,
  PRIVATE_MESSAGES_BLOCKED_TEXT,
  selectors,
} from './selectors.js';
import { byId, byText, byTextContains, byTextStartsWith, scrollToText } from './uiselector.js';

export interface VisibleParticipantRow {
  name: string;
  role: string | null;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface RosterViewport {
  rows: VisibleParticipantRow[];
  list: { left: number; top: number; right: number; bottom: number };
  totalCount: number | null;
}

export const ROSTER_SCROLL_PERCENT = 0.75;

/** Parses one Appium hierarchy snapshot into roster rows without per-row roundtrips. */
export function parseRosterPageSource(xml: string): RosterViewport {
  const root = parseHierarchy(xml);
  const allNodes: XmlNode[] = [];
  collectAll(root, allNodes);

  let listNode = findDescendant(root, selectors.participants.list);
  if (listNode === undefined) {
    listNode = allNodes.find(
      (n) =>
        n['resource-id']?.endsWith(':id/recycler_view') ||
        n['resource-id']?.endsWith(':id/list') ||
        n['resource-id']?.includes('recycler') ||
        n['class']?.includes('RecyclerView') ||
        n['class']?.includes('ListView'),
    );
  }

  const list = parseBounds(listNode?.bounds) ?? { left: 0, top: 0, right: 1280, bottom: 720 };

  const rowNodes: XmlNode[] = [];
  collectDescendants(listNode ?? root, selectors.participants.row, rowNodes);
  const rows: VisibleParticipantRow[] = [];
  for (const rowNode of rowNodes) {
    const bounds = parseBounds(rowNode.bounds);
    const nameNode = findDescendant(rowNode, selectors.participants.rowName);
    const name = nameNode?.text?.trim() ?? '';
    if (
      bounds === null ||
      name === '' ||
      bounds.top < list.top ||
      bounds.bottom > list.bottom
    ) {
      continue;
    }
    const roleNode = findDescendant(rowNode, selectors.groupInfo.participantRole);
    rows.push({ ...bounds, name, role: roleNode?.text?.trim() || null });
  }
  rows.sort((left, right) => left.top - right.top);

  let totalCount: number | null = null;
  // Look for total count across all text nodes (e.g. "(1 615)" or "1 615 участников")
  for (const node of allNodes) {
    const text = node.text?.trim();
    if (!text) continue;
    const match = /\(([\d\s\u00a0\u202f,.']+)\)/u.exec(text);
    if (match !== null) {
      const parsed = Number.parseInt((match[1] ?? '').replace(/[^\d]/gu, ''), 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        totalCount = parsed;
        break;
      }
    }
  }

  if (totalCount === null) {
    for (const node of allNodes) {
      const text = node.text?.trim();
      if (!text) continue;
      if (/участник|member|participants/iu.test(text)) {
        const match = /(\d[\d\s\u00a0\u202f,.']*)/u.exec(text);
        if (match !== null) {
          const parsed = Number.parseInt((match[1] ?? '').replace(/[^\d]/gu, ''), 10);
          if (Number.isInteger(parsed) && parsed > 0) {
            totalCount = parsed;
            break;
          }
        }
      }
    }
  }

  return { rows, list, totalCount };
}

/**
 * The full-screen participants list (ParticipantsListActivity) and the dialog
 * that a participant tap opens.
 */
export class ParticipantsPage extends BasePage {
  /**
   * Waits on a row's `itemLayout`, not on its `name`: `name` is also what the
   * info panel labels its participant previews with, and `recycler_view`
   * belongs to a dozen other screens — either would report this list as loaded
   * while Viber is still showing something else.
   */
  async waitUntilLoaded(): Promise<void> {
    await this.waitFor(selectors.participants.row);
  }

  async isLoaded(timeout = 2_000): Promise<boolean> {
    return this.isPresent(selectors.participants.row, timeout);
  }

  /** Display names currently rendered in the list. */
  async visibleNames(): Promise<string[]> {
    return (await this.snapshot()).rows.map(({ name }) => name);
  }

  /** One WebDriver roundtrip captures all visible rows, bounds and the header count. */
  async snapshot(): Promise<RosterViewport> {
    return parseRosterPageSource(await this.driver.getPageSource());
  }

  /** Moves the roster by 75% of a viewport and reports whether more content remains. */
  async scrollForward(viewport: RosterViewport): Promise<boolean> {
    return this.scrollRoster(viewport, 'down');
  }

  private isSelfName(name: string): boolean {
    return /^(?:вы|you|ty)\s*\(/iu.test(name.trim()) || name.trim().toLowerCase().startsWith('вы');
  }

  /** Returns to the beginning using Appium's native can-scroll result. */
  async scrollToTop(maxSwipes: number): Promise<RosterViewport> {
    let viewport = await this.snapshot();
    if (viewport.rows.some((r) => this.isSelfName(r.name))) {
      return viewport;
    }
    for (let swipe = 0; swipe < maxSwipes; swipe += 1) {
      const prev = viewport;
      await this.scrollRoster(viewport, 'up');
      viewport = await this.snapshot();
      if (this.sameViewport(viewport, prev) || viewport.rows.some((r) => this.isSelfName(r.name))) {
        return viewport;
      }
    }
    return viewport;
  }

  /**
   * Restores the viewport saved before opening a private chat. Android normally
   * retains it on the activity back stack; the bounded scan is the fallback.
   */
  async restoreViewport(expected: RosterViewport, maxSwipes: number): Promise<void> {
    if (this.sameViewport(await this.snapshot(), expected)) return;

    let current = await this.scrollToTop(maxSwipes);
    for (let swipe = 0; swipe < maxSwipes; swipe += 1) {
      if (this.sameViewport(current, expected)) return;
      if (!(await this.scrollForward(current))) break;
      current = await this.snapshot();
    }
    throw new Error('Could not restore the saved participants-list position safely.');
  }

  /** Opens the message action for one exact row from the current viewport. */
  async messageVisibleParticipant(row: VisibleParticipantRow): Promise<void> {
    const x = Math.round(row.left + Math.min((row.right - row.left) * 0.35, 400));
    const y = Math.round((row.top + row.bottom) / 2);
    console.log(`[PAGE] Clicking row "${row.name}" at x=${String(x)}, y=${String(y)}`);
    await this.driver.execute('mobile: clickGesture', { x, y });
    await this.driver.pause(600);

    const prefixes = [MESSAGE_OPTION_PREFIX, 'Повідомлення ', 'Message '];
    let tapped = false;
    for (const prefix of prefixes) {
      if (await this.isPresent(byTextStartsWith(prefix), 800)) {
        console.log(`[PAGE] Tapping prefix "${prefix}"`);
        await this.tap(byTextStartsWith(prefix));
        tapped = true;
        break;
      }
    }
    if (!tapped) {
      const messageOption = `${MESSAGE_OPTION_PREFIX}${row.name}`;
      if (await this.isPresent(byText(messageOption), 800)) {
        console.log(`[PAGE] Tapping exact "${messageOption}"`);
        await this.tap(byText(messageOption));
        tapped = true;
      } else {
        const option = await this.driver.$(byId(selectors.participantDialog.option));
        if (await option.isExisting()) {
          console.log('[PAGE] Tapping participantDialog.option');
          await option.click();
          tapped = true;
        }
      }
    }
    console.log(`[PAGE] Option tapped status: ${String(tapped)}`);
    if (!tapped) {
      throw new Error(`Could not find message option in dialog for "${row.name}".`);
    }

    await this.assertChatOpened(row.name);
  }

  /**
   * Opens the message dialog for a participant and taps "Сообщение <name>",
   * landing on the one-to-one chat.
   *
   * Throws {@link ParticipantNotFoundError} when no such name is in the list
   * and {@link ParticipantUnreachableError} when Viber reports that the
   * participant has private messages turned off — the case Viber surfaces as a
   * modal error instead of opening a chat.
   */
  async messageParticipant(name: string): Promise<void> {
    if (!(await this.isPresent(byText(name), 1_500))) {
      try {
        await this.waitFor(scrollToText(name), 8_000);
      } catch {
        throw new ParticipantNotFoundError(name);
      }
    }
    await this.tap(byText(name));

    const messageOption = `${MESSAGE_OPTION_PREFIX}${name}`;
    await this.waitFor(byTextStartsWith(MESSAGE_OPTION_PREFIX));
    await this.tap(byText(messageOption));

    await this.assertChatOpened(name);
  }

  /**
   * Waits for either the chat composer (success) or Viber's "cannot receive
   * private messages" error (failure), whichever appears first.
   */
  private async assertChatOpened(name: string): Promise<void> {
    const deadline = Date.now() + this.timeout;
    while (Date.now() < deadline) {
      if (
        (await this.isPresent(selectors.chat.messageList, 400)) ||
        (await this.isPresent(selectors.chat.composerInput, 400))
      ) {
        return;
      }
      if (
        (await this.isPresent(byTextContains(PRIVATE_MESSAGES_BLOCKED_TEXT), 300)) ||
        (await this.isPresent(byTextContains('не может принимать'), 300)) ||
        (await this.isPresent(byTextContains('не може приймати'), 300))
      ) {
        await this.dismissError();
        throw new ParticipantUnreachableError(name);
      }
      await this.driver.pause(200);
    }
    throw new Error(`Opening a chat with "${name}" neither opened a composer nor raised a known error.`);
  }

  /** Clears the "cannot receive private messages" dialog with its OK button. */
  private async dismissError(): Promise<void> {
    for (const label of ['ОК', 'OK', 'Ок']) {
      if (await this.isPresent(byText(label), 500)) {
        await this.tap(byText(label));
        return;
      }
    }
  }

  private sameViewport(current: RosterViewport, expected: RosterViewport): boolean {
    if (current.rows.length === 0 || expected.rows.length === 0) return false;
    const currentNames = current.rows.map((r) => r.name);
    const expectedNames = expected.rows.map((r) => r.name);
    const matching = currentNames.filter((name) => expectedNames.includes(name)).length;
    const ratio = matching / Math.max(currentNames.length, expectedNames.length);
    return ratio >= 0.6;
  }

  private async scrollRoster(viewport: RosterViewport, direction: 'up' | 'down'): Promise<boolean> {
    const { left, top, right, bottom } = viewport.list;
    const centerX = Math.round((left + right) / 2);
    const startY = direction === 'down' ? Math.round(bottom * 0.8) : Math.round(top + (bottom - top) * 0.2);
    const endY = direction === 'down' ? Math.round(top + (bottom - top) * 0.2) : Math.round(bottom * 0.8);

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
    await this.driver.pause(600);
    return true;
  }
}
