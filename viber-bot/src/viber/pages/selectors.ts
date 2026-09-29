/**
 * Every Viber resource id the automation depends on, captured from Viber
 * 20.1.0.0 running in LDPlayer (Android 9).
 *
 * This build ships readable ids rather than the obfuscated ones later Viber
 * releases use, so they are stable to read — but they are still Viber's
 * internals. Re-capture with `npm run inspect:dump` after any app update, and
 * change them only here: nothing else in the codebase references a raw id.
 */

import { CALL_ME_TEXT_PATTERN } from '../../features/auth/verification.js';
import { byTextMatches } from './uiselector.js';

const PACKAGE = 'com.viber.voip';

const id = (name: string): string => `${PACKAGE}:id/${name}`;

export const selectors = {
  /**
   * The welcome splash Viber opens on before an account is activated.
   * Captured from `.splash.SplashActivity`.
   */
  splash: {
    root: id('root_container'),
    /** "Start now" — the only control on the screen. */
    startButton: id('okBtn'),
  },

  /**
   * Phone-number entry, `.registration.RegistrationActivity`.
   *
   * The screen scrolls under the soft keyboard, so the same controls sit at
   * different coordinates depending on whether it is up — every tap here has
   * to be resolved from the element, never from a fixed point.
   */
  registration: {
    title: id('title'),
    /** Opens the country picker; its text is "<flag>  <Country>". */
    countryButton: id('registration_country_btn'),
    /** Country calling code, editable on its own (e.g. "375"). */
    codeField: id('registration_code_field'),
    phoneField: id('registration_phone_field'),
    continueButton: id('btn_continue'),
  },

  /** Country picker, `.registration.SelectCountryActivity`. */
  selectCountry: {
    searchInput: id('search_src_text'),
    searchClear: id('search_close_btn'),
    list: id('list'),
    /** A row's label, "<flag>  <Country> (+<code>)". The row itself has no id. */
    rowName: id('name'),
  },

  /**
   * Viber's own explanation shown before it requests contacts and call-log
   * access. A custom dialog inside RegistrationActivity, not a system one.
   */
  permissionRationale: {
    panel: id('custom'),
    text: id('text'),
    continueButton: id('continue_btn'),
  },

  /** "Is this your phone number?" sheet shown over RegistrationActivity after Continue. */
  confirmNumber: {
    header: id('header'),
    number: id('number'),
    yesButton: id('yes_btn'),
    editButton: id('edit_btn'),
  },

  /**
   * "Success! You have successfully added your Android tablet as a secure
   * device" — RegistrationActivity right after the phone scans the QR.
   */
  activationSuccess: {
    continueButton: id('continueBtn'),
  },

  /**
   * "Control what you see" — the GDPR ads consent (`.feature.gdpr.ui.iabconsent.ConsentActivity`)
   * shown once after activation. "Manage ad preferences" opens a settings maze,
   * so "Allow all and continue" is the only way through.
   */
  adsConsent: {
    allowButton: id('allow_btn'),
    manageButton: id('manage_ads_btn'),
  },

  /**
   * "Viber security update" — activation as a secondary device. Viber only
   * offers it in the `sw600dp` (tablet) layout.
   */
  qrActivation: {
    container: id('qr_container'),
    /** The ImageView the activation code is drawn into. */
    image: id('qrcode'),
    /**
     * "Do you want to activate this device as your only device?" — the way back
     * to the SMS flow. Must never be tapped: it spends a registration attempt
     * and takes the account off its primary phone.
     */
    activateAsOnlyDevice: id('click_here'),
  },

  /** The SMS / call code entry screen. */
  smsCode: {
    mainView: id('view_with_description_main_view_id'),
    pinDigit: id('pin_digit'),
    codeInput: id('code_input'),
    verificationCode: id('verification_code'),
    /**
     * «Call me»: Viber rings the number and the code is the tail of the caller's
     * number. Not captured with an id yet, so it is matched on its label.
     */
    callMeButton: byTextMatches(CALL_ME_TEXT_PATTERN),
  },

  /** Android's runtime permission dialog, `GrantPermissionsActivity`. */
  systemPermission: {
    dialog: 'com.android.permissioncontroller:id/grant_dialog',
    message: 'com.android.permissioncontroller:id/permission_message',
    allowButton: 'com.android.permissioncontroller:id/permission_allow_button',
    allowForegroundButton:
      'com.android.permissioncontroller:id/permission_allow_foreground_only_button',
    /** Pre-Android 10 builds still host the dialog in the package installer. */
    legacyAllowButton: 'com.android.packageinstaller:id/permission_allow_button',
    denyButton: 'com.android.permissioncontroller:id/permission_deny_button',
  },

  /** The spinner Viber shows while it checks the submitted number. */
  verifying: {
    progress: id('progress'),
    message: id('message'),
  },

  /**
   * AlertDialog Viber raises when it refuses to activate the number
   * ("Activation failed" / HELP / CLOSE).
   */
  alert: {
    title: 'android:id/alertTitle',
    message: 'android:id/message',
    /** Right-hand button — CLOSE on the activation-failed dialog. */
    positiveButton: 'android:id/button1',
    /** Left-hand button — HELP on the activation-failed dialog. */
    negativeButton: 'android:id/button2',
  },

  /** Viber's own modal buttons, used by its post-activation prompts. */
  viberDialog: {
    positiveButton: id('btn_positive'),
    negativeButton: id('btn_negative'),
  },

  /**
   * "Your name" profile screen Viber shows once the activation code has been
   * accepted. Ids seen in `dumpsys activity top` on Viber 20.1.
   */
  profile: {
    nameInput: `${id('userNameTextInput')}//android.widget.EditText`,
    nameInputContainer: id('userNameTextInput'),
    nameInputHolder: id('nameInputHolder'),
    continueButton: id('continueButtonView'),
  },

  /** "Introducing Caller ID" bottom sheet shown right after activation. */
  callerId: {
    dialog: id('caller_id_fragment'),
    turnOnButton: id('turn_on'),
    maybeLaterButton:
      '//*[@text="Maybe later" or @text="Позже" or @text="Не сейчас" or @text="Напомнить позже" or contains(@text, "Maybe later") or contains(@text, "Позже")]',
  },

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
 * Regex matching the "show all participants" action in the info panel in
 * various languages. Matches case-insensitively.
 */
export const SHOW_ALL_PARTICIPANTS_REGEX =
  /show all|see all|показать всех|показати всіх|паказаць усё/i;

/**
 * Regex matching the prefix of the participants section title in various languages.
 */
export const PARTICIPANTS_SECTION_REGEX = /участник|учасник|удзельнік|member/i;

/** Prefix of the "message this participant" dialog option. */
export const MESSAGE_OPTION_PREFIX = 'Сообщение ';

/**
 * Body of the dialog Viber shows when a participant has private messages
 * turned off. Detected verbatim so the flow can report the participant as
 * unreachable instead of hanging on a chat screen that never opens.
 */
export const PRIVATE_MESSAGES_BLOCKED_TEXT = 'не может принимать личные сообщения';

export const VIBER_PACKAGE = PACKAGE;
