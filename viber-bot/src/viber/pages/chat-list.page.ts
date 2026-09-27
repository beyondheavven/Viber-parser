import { BasePage } from './base.page.js';
import { selectors, VIBER_PACKAGE } from './selectors.js';
import { byId, scrollToText } from './uiselector.js';

/** Viber's conversation list — the screen the app opens on. */
export class ChatListPage extends BasePage {
  /**
   * Brings the chat list to the front, tolerating the two states navigation
   * commonly starts in: Viber sitting in the background (the launcher is in
   * front, so `back()` does nothing) and Viber on a sub-screen that covers the
   * list. Activating the app handles the first, a `back()` the second.
   */
  async waitUntilLoaded(): Promise<void> {
    await this.activateViber();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (await this.isPresent(selectors.chatList.root, 1_500)) return;
      await this.driver.back().catch(() => undefined);
      await this.activateViber();
      await this.driver.pause(800);
    }
    await this.waitFor(selectors.chatList.root);
  }

  /** Foregrounds Viber (launches it if it was only running in the background). */
  private async activateViber(): Promise<void> {
    await this.driver
      .execute('mobile: activateApp', { appId: VIBER_PACKAGE })
      .catch(() => undefined);
  }

  async isLoaded(timeout = 1_000): Promise<boolean> {
    return this.isPresent(selectors.chatList.root, timeout);
  }

  /** Titles of the conversations currently rendered. */
  async visibleTitles(): Promise<string[]> {
    return this.textsOf(selectors.chatList.rowTitle);
  }

  /**
   * Opens a conversation by its exact title.
   *
   * The list is a RecyclerView that only materialises visible rows, so a
   * conversation further down needs scrolling before it can be tapped. When
   * the title is already on screen the scroll is skipped, because
   * `UiScrollable` throws if the list happens not to be scrollable.
   */
  async open(title: string): Promise<void> {
    const rows = await this.driver.$$(byId(selectors.chatList.rowTitle));
    for (const row of rows) {
      if ((await row.getText()) === title) {
        await row.click();
        return;
      }
    }
    await this.tap(scrollToText(title));
  }
}
