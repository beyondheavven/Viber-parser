import { BasePage } from './base.page.js';
import { selectors } from './selectors.js';
import { byId } from './uiselector.js';

/**
 * A one-to-one chat opened from the participants list.
 *
 * Viber reuses ConversationActivity for one-to-one and group chats, so the
 * composer ids are the same ones the group chat uses.
 */
export class PrivateChatPage extends BasePage {
  async waitUntilLoaded(): Promise<void> {
    await this.waitFor(selectors.chat.composerInput);
  }

  /** The chat's toolbar title — the participant's name. */
  async title(): Promise<string> {
    const toolbar = await this.waitFor(selectors.chat.toolbar);
    const label = await toolbar.$('android.widget.TextView');
    return label.getText();
  }

  /** Types text into the composer without sending it. */
  async typeMessage(text: string): Promise<void> {
    const input = await this.waitFor(selectors.chat.composerInput);
    await input.click();
    await input.setValue(text);
  }

  /**
   * The send control only appears once the composer holds text; before that
   * the same slot is the voice-message button.
   */
  async isSendReady(): Promise<boolean> {
    return this.isPresent(byId('com.viber.voip:id/send_icon_container'), 1_500);
  }

  /** Sends whatever is in the composer. */
  async send(): Promise<void> {
    const sendContainer = byId('com.viber.voip:id/send_icon_container');
    if (await this.isPresent(sendContainer, 1_500)) {
      await this.tap(sendContainer);
      return;
    }
    await this.tap(selectors.chat.sendButton);
  }
}
