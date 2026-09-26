import { BasePage } from './base.page.js';
import { selectors } from './selectors.js';
import { byId, scrollToText } from './uiselector.js';

/** Viber's conversation list — the screen the app opens on. */
export class ChatListPage extends BasePage {
  async waitUntilLoaded(): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (await this.isPresent(selectors.chatList.root, 1_000)) return;
      await this.driver.back();
    }
    await this.waitFor(selectors.chatList.root);
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
