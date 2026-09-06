import { BasePage } from './base.page.js';
import { selectors } from './selectors.js';

/** An open Viber conversation. */
export class ChatPage extends BasePage {
  async waitUntilLoaded(): Promise<void> {
    await this.waitFor(selectors.chat.messageList);
  }

  async isOpen(): Promise<boolean> {
    return this.isPresent(selectors.chat.messageList);
  }

  /**
   * The conversation title from the toolbar.
   *
   * Viber 20 gives the toolbar title no resource id of its own, so it is read
   * as the first TextView inside the toolbar.
   */
  async title(): Promise<string> {
    const toolbar = await this.waitFor(selectors.chat.toolbar);
    const label = await toolbar.$('android.widget.TextView');
    return label.getText();
  }

  /**
   * Text of the message bubbles currently rendered.
   *
   * This is what fits on screen, not the conversation history — read the
   * database for the full record. Its purpose is confirming the right chat is
   * open and that scrolling actually pulled older messages in.
   */
  async visibleMessages(): Promise<string[]> {
    return this.textsOf(selectors.chat.messageText);
  }

  /**
   * Scrolls up through the history so Viber loads and stores older messages.
   *
   * Viber keeps only part of a community's history locally and fetches the
   * rest as the user scrolls, so this is how the database gets backfilled.
   */
  async scrollBack(times: number): Promise<void> {
    const list = await this.waitFor(selectors.chat.messageList);
    const { x, y, width, height } = await list.getLocation().then(async (location) => ({
      ...location,
      ...(await list.getSize()),
    }));
    const centreX = Math.round(x + width / 2);
    const top = Math.round(y + height * 0.25);
    const bottom = Math.round(y + height * 0.75);

    for (let index = 0; index < times; index += 1) {
      await this.driver.performActions([
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: centreX, y: top },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 100 },
            { type: 'pointerMove', duration: 400, x: centreX, y: bottom },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ]);
      await this.driver.releaseActions();
      await this.driver.pause(600);
    }
  }

  /** Opens the group info screen by tapping the toolbar title. */
  async openInfo(): Promise<void> {
    await this.tap(selectors.chat.toolbar);
  }
}
