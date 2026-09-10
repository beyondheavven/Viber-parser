/**
 * Every Viber resource id the automation depends on, captured from Viber
 * 20.1.0.0 running in LDPlayer (Android 9).
 *
 * This build ships readable ids rather than the obfuscated ones later Viber
 * releases use, so they are stable to read — but they are still Viber's
 * internals. Re-capture with `npm run inspect:dump` after any app update, and
 * change them only here: nothing else in the codebase references a raw id.
 */

const PACKAGE = 'com.viber.voip';

const id = (name: string): string => `${PACKAGE}:id/${name}`;

export const selectors = {
  /** Conversation list — the screen Viber opens on. */
  chatList: {
    root: id('messages_list'),
    homeContainer: id('activity_home_container'),
    toolbar: id('activity_home_toolbar'),
    searchButton: id('menu_search'),
    /** Conversation title inside a list row. */
    rowTitle: id('from'),
    /** Last-message preview inside a list row. */
    rowSubject: id('subject'),
    rowDate: id('date'),
  },

  /** Open conversation. */
  chat: {
    root: id('conversation_fragment'),
    messageList: id('conversation_recycler_view'),
    toolbar: id('toolbar'),
    /** Body text of a message bubble. */
    messageText: id('textMessageView'),
    messageTimestamp: id('timestampView'),
    /** Sender name shown above a bubble in group conversations. */
    messageSender: id('nameView'),
    composer: id('message_composer'),
    composerInput: id('send_text'),
    sendButton: id('btn_send'),
  },

  /**
   * Group info. In LDPlayer's landscape (tablet) layout this opens as a side
   * panel inside ConversationActivity rather than a separate screen, so it is
   * addressed by its fragment id, not by activity.
   */
  groupInfo: {
    fragment: id('conversation_info_fragment'),
    /**
     * The panel's own RecyclerView. Scrolling has to be aimed at this id: in
     * the landscape layout the conversation's message list is on screen at the
     * same time and is also scrollable, so an unscoped scroll moves the wrong
     * view.
     */
    list: id('conversationInfo'),
    /** Section title in a chat-info header row, e.g. "УЧАСТНИКИ (1 632)". */
    sectionTitle: id('startText'),
    /** Trailing action of a chat-info header row, e.g. "Показать всех". */
    sectionAction: id('endText'),
    /** Older chat-info header row, same two halves under different ids. */
    legacySectionTitle: id('tx_start_text'),
    legacySectionAction: id('tx_end_text'),
    /** Participant preview rows inside the info panel. */
    participantName: id('name'),
    participantRole: id('groupRole'),
  },

  /** Full-screen participants list (ParticipantsListActivity). */
  participants: {
    list: id('recycler_view'),
    row: id('itemLayout'),
    /** One row's display name. */
    rowName: id('name'),
    shareLink: id('menu_share_group_link'),
  },

  /**
   * The dialog that appears when a participant is tapped: "Сообщение <name>"
   * opens a one-to-one chat, "Данные <name>" opens their profile. Both are
   * plain list items with the id `title`.
   */
  participantDialog: {
    option: id('title'),
  },
} as const;

/**
 * Label of the "show all participants" action in the info panel — Viber's
 * `string/show_all`, in every language this account may be running in. The
 * device locale is not pinned, so all of them are matched.
 */
export const SHOW_ALL_PARTICIPANTS_TEXTS = [
  'Показать всех',
  'Показати всіх',
  'Паказаць усё',
  'Show all',
] as const;

/**
 * Prefix of the participants section title — Viber's `string/members` and
 * `string/members_count` ("УЧАСТНИКИ (%s)"). Used to find the right section
 * header when the action label itself is not matched.
 */
export const PARTICIPANTS_SECTION_TITLES = [
  'участник',
  'учасник',
  'удзельнік',
  'member',
] as const;

/** Prefix of the "message this participant" dialog option. */
export const MESSAGE_OPTION_PREFIX = 'Сообщение ';

/**
 * Body of the dialog Viber shows when a participant has private messages
 * turned off. Detected verbatim so the flow can report the participant as
 * unreachable instead of hanging on a chat screen that never opens.
 */
export const PRIVATE_MESSAGES_BLOCKED_TEXT = 'не может принимать личные сообщения';

export const VIBER_PACKAGE = PACKAGE;
