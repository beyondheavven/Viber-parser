import { Injectable, Logger } from '@nestjs/common';
import { withViberSession } from '../../driver/session.js';
import { ChatListPage } from '../../pages/chat-list.page.js';
import { ChatPage } from '../../pages/chat.page.js';
import { GroupInfoPage } from '../../pages/group-info.page.js';
import { ParticipantsPage } from '../../pages/participants.page.js';

export interface NavigationResult {
  headerTotal: number | null;
}

@Injectable()
export class ViberNavigationService {
  private readonly logger = new Logger(ViberNavigationService.name);

  /**
   * Opens a group by name and posts one message into it.
   *
   * Each call takes its own Appium session so a long-running campaign never
   * holds the device between sends — the device mutex, not the session, is
   * what serialises access.
   */
  async sendGroupMessage(groupName: string, text: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new Error('Send aborted before starting the Appium session.');
    }

    this.logger.log(`Sending a message to "${groupName}" via Appium...`);

    return withViberSession(async (driver) => {
      const abortIfAsked = (): void => {
        if (signal?.aborted) throw new Error('Send aborted.');
      };

      const chatList = new ChatListPage(driver);
      await chatList.waitUntilLoaded();
      abortIfAsked();

      await chatList.open(groupName);
      abortIfAsked();

      const chat = new ChatPage(driver);
      await chat.waitUntilLoaded();

      // Opening the right chat matters more here than anywhere else: a stray
      // tap in the list would post the text into someone else's conversation.
      const title = (await chat.title()).trim();
      if (title !== groupName.trim()) {
        throw new Error(`Asked to post to "${groupName}" but the open chat is "${title}".`);
      }

      abortIfAsked();
      await chat.typeMessage(text);
      abortIfAsked();
      await chat.send();

      this.logger.log(`Message posted to "${groupName}".`);
    });
  }

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
      const abortIfAsked = (): void => {
        if (signal?.aborted) throw new Error('Navigation aborted.');
      };

      abortIfAsked();

      const page = new ParticipantsPage(driver);

      // Check if participants screen is already open
      if (await page.isLoaded(1_000)) {
        this.logger.log('Participants screen is already loaded!');
        const snapshot = await page.snapshot();
        this.logger.log(
          `Participants screen loaded. Header total: ${String(snapshot.totalCount ?? 'unknown')}`,
        );
        try {
          this.logger.log('Triggering initial scroll on participants list to activate paging controller...');
          await page.scrollForward(snapshot);
          await driver.pause(1000);
        } catch (scrollErr) {
          this.logger.warn(`Initial scroll trigger failed (non-fatal): ${String(scrollErr)}`);
        }
        return {
          headerTotal: snapshot.totalCount,
        };
      }

      const chatList = new ChatListPage(driver);
      await chatList.waitUntilLoaded();
      abortIfAsked();

      this.logger.log(`Opening chat "${groupName}"...`);
      await chatList.open(groupName);
      abortIfAsked();

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

      abortIfAsked();

      // Check if selecting the chat opened participants screen directly
      if (await page.isLoaded(1_000)) {
        this.logger.log('Participants screen loaded after opening chat!');
        const snapshot = await page.snapshot();
        try {
          this.logger.log('Triggering initial scroll on participants list to activate paging controller...');
          await page.scrollForward(snapshot);
          await driver.pause(1000);
        } catch (scrollErr) {
          this.logger.warn(`Initial scroll trigger failed (non-fatal): ${String(scrollErr)}`);
        }
        return {
          headerTotal: snapshot.totalCount,
        };
      }

      const info = new GroupInfoPage(driver);
      await info.open();
      abortIfAsked();

      this.logger.log('Opening full participants list in group info...');
      await info.openAllParticipants();
      abortIfAsked();

      await page.waitUntilLoaded();
      await driver.pause(1000);

      const snapshot = await page.snapshot();
      this.logger.log(
        `Participants screen loaded. Header total: ${String(snapshot.totalCount ?? 'unknown')}`,
      );

      // Trigger initial scroll to activate RecyclerView scroll listener and initialize gp0.y
      try {
        this.logger.log('Triggering initial scroll on participants list to activate paging controller...');
        await page.scrollForward(snapshot);
        await driver.pause(1000);
      } catch (scrollErr) {
        this.logger.warn(`Initial scroll trigger failed (non-fatal): ${String(scrollErr)}`);
      }

      return {
        headerTotal: snapshot.totalCount,
      };
    });
  }
}
