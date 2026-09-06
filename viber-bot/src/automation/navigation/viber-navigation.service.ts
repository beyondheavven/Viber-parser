import { Injectable, Logger } from '@nestjs/common';
import { withViberSession } from '../../driver/session.js';
import { ChatListPage } from '../../pages/chat-list.page.js';
import { GroupInfoPage } from '../../pages/group-info.page.js';
import { ParticipantsPage } from '../../pages/participants.page.js';

export interface NavigationResult {
  headerTotal: number | null;
}

@Injectable()
export class ViberNavigationService {
  private readonly logger = new Logger(ViberNavigationService.name);

  /**
   * Opens Viber session, navigates to the specified group, opens group info,
   * then navigates to the participants list.
   */
  async navigateToParticipants(
    groupName: string,
    signal?: AbortSignal,
  ): Promise<NavigationResult> {
    if (signal?.aborted) {
      throw new Error('Navigation aborted before starting Appium session.');
    }

    this.logger.log(`Navigating to participants of "${groupName}" via Appium...`);

    return withViberSession(async (driver) => {
      if (signal?.aborted) {
        throw new Error('Navigation aborted.');
      }

      const chatList = new ChatListPage(driver);
      await chatList.waitUntilLoaded();

      if (signal?.aborted) {
        throw new Error('Navigation aborted.');
      }

      this.logger.log(`Opening chat "${groupName}"...`);
      await chatList.open(groupName);

      // Handle any prompt / modal dialogs if they appear
      try {
        const cancelBtn = await driver.$(
          'android.widget.Button[text="ОТМЕНА"], android.widget.Button[text="CANCEL"], android.widget.Button[text="ОТМЕНИТЬ"]',
        );
        if (await cancelBtn.isExisting()) {
          this.logger.warn('Dismissing unexpected modal dialog in chat...');
          await cancelBtn.click();
          await driver.pause(500);
        }
      } catch {
        // Safe to ignore dialog dismiss errors
      }

      if (signal?.aborted) {
        throw new Error('Navigation aborted.');
      }

      const info = new GroupInfoPage(driver);
      await info.open();

      if (signal?.aborted) {
        throw new Error('Navigation aborted.');
      }

      this.logger.log('Opening full participants list in group info...');
      await info.openAllParticipants();

      const page = new ParticipantsPage(driver);
      await page.waitUntilLoaded();

      const snapshot = await page.snapshot();
      this.logger.log(
        `Participants screen loaded. Header total: ${String(snapshot.totalCount ?? 'unknown')}`,
      );

      return {
        headerTotal: snapshot.totalCount,
      };
    });
  }
}
