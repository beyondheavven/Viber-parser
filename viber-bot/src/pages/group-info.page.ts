import { setTimeout as delay } from 'node:timers/promises';
import { BasePage } from './base.page.js';
import { SHOW_ALL_PARTICIPANTS_TEXT, selectors } from './selectors.js';
import { byText } from './uiselector.js';

/**
 * The group info panel.
 *
 * On LDPlayer's landscape (tablet) layout the info opens as a panel on the
 * right half of the conversation screen rather than as its own activity, and
 * the panel is not exposed as a scrollable node, so its "show all" button is
 * reached by swiping the right half rather than with `UiScrollable`.
 */
export class GroupInfoPage extends BasePage {
  /** How far in from the left the info panel sits (fraction of screen width). */
  private static readonly PANEL_X_FRACTION = 0.72;
  private static readonly MAX_PANEL_SWIPES = 8;

  /**
   * Opens the info panel by tapping the toolbar title.
   *
   * The tap has to land on the title text, which sits at the left of a very
   * wide landscape toolbar — clicking the toolbar element itself would hit its
   * empty centre. The panel's participant section loads a beat later, so this
   * waits for it before returning.
   */
  async open(): Promise<void> {
    if (await this.isOpen()) {
      await this.waitForParticipantsSection();
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
    await this.waitForParticipantsSection();
  }

  async isOpen(): Promise<boolean> {
    return this.isPresent(selectors.groupInfo.fragment);
  }

  private async waitForParticipantsSection(): Promise<void> {
    const deadline = Date.now() + this.timeout;
    while (Date.now() < deadline) {
      if (await this.isPresent(selectors.groupInfo.participantName, 800)) return;
    }
    throw new Error('Group info opened but its participant list never appeared.');
  }

  /**
   * Opens the full participants list via the "show all" button, swiping the
   * info panel up until the button is on screen.
   */
  async openAllParticipants(): Promise<void> {
    for (let swipe = 0; swipe < GroupInfoPage.MAX_PANEL_SWIPES; swipe += 1) {
      if (await this.isPresent(byText(SHOW_ALL_PARTICIPANTS_TEXT), 600)) {
        await this.tap(byText(SHOW_ALL_PARTICIPANTS_TEXT));
        return;
      }
      await this.swipePanelUp();
    }
    throw new Error(`"${SHOW_ALL_PARTICIPANTS_TEXT}" did not appear after scrolling the info panel.`);
  }

  private async swipePanelUp(): Promise<void> {
    const { width, height } = await this.driver.getWindowSize();
    const x = Math.round(width * GroupInfoPage.PANEL_X_FRACTION);
    await this.driver.performActions([
      {
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x, y: Math.round(height * 0.72) },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 80 },
          { type: 'pointerMove', duration: 350, x, y: Math.round(height * 0.28) },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ]);
    await this.driver.releaseActions();
    await this.driver.pause(800);
  }
}
