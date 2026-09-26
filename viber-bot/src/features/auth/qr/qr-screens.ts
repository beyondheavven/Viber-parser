import {
  collectAll,
  parseBounds,
  type Bounds,
  type XmlNode,
} from '../../../viber/pages/page-source.js';
import { selectors } from '../../../viber/pages/selectors.js';

/** Every screen the QR activation can be sitting on. */
export type ViberScreenKind =
  | 'welcome'
  | 'phone_entry'
  | 'confirm_number'
  | 'qr'
  | 'sms_code'
  | 'permission'
  | 'dialog'
  | 'profile_name'
  | 'progress'
  | 'chat_list'
  | 'unknown';

/**
 * One way of spotting a node. Alternatives are tried in the order given, so a
 * resource id goes first and the localised texts follow as fallbacks for the
 * system dialogs whose ids differ between Android builds.
 */
export type NodeMatcher = { id: string } | { text: string } | { className: string };

const byId = (id: string): NodeMatcher => ({ id });
const byText = (text: string): NodeMatcher => ({ text });
const byClass = (className: string): NodeMatcher => ({ className });

export const WELCOME_START: readonly NodeMatcher[] = [
  byId(selectors.splash.startButton),
  byText('Start now'),
  byText('Начать сейчас'),
];

export const PHONE_FIELD: readonly NodeMatcher[] = [byId(selectors.registration.phoneField)];
export const CODE_FIELD: readonly NodeMatcher[] = [byId(selectors.registration.codeField)];

export const REGISTRATION_CONTINUE: readonly NodeMatcher[] = [
  byId(selectors.registration.continueButton),
];

export const CONFIRM_NUMBER_YES: readonly NodeMatcher[] = [
  byId(selectors.confirmNumber.yesButton),
];

const QR_IMAGE: readonly NodeMatcher[] = [byId(selectors.qrActivation.image)];
const QR_CONTAINER: readonly NodeMatcher[] = [byId(selectors.qrActivation.container)];

const SMS_CODE: readonly NodeMatcher[] = [
  byId(selectors.smsCode.mainView),
  byId(selectors.smsCode.pinDigit),
  byId(selectors.smsCode.codeInput),
  byId(selectors.smsCode.verificationCode),
];

/** Accepts Android's runtime prompt or Viber's own explanation that precedes it. */
export const PERMISSION_ALLOW: readonly NodeMatcher[] = [
  byId(selectors.systemPermission.allowButton),
  byId(selectors.systemPermission.allowForegroundButton),
  byId(selectors.systemPermission.legacyAllowButton),
  byId(selectors.permissionRationale.continueButton),
  byText('Разрешить'),
  byText('Allow'),
  byText('Только во время использования приложения'),
  byText('While using the app'),
];

const PERMISSION_SCREEN: readonly NodeMatcher[] = [
  byId(selectors.systemPermission.dialog),
  byId(selectors.systemPermission.message),
  byId(selectors.systemPermission.denyButton),
  ...PERMISSION_ALLOW,
];

/**
 * "Not now" for the optional post-activation prompts — backup, contact sync,
 * promos. None of them is needed to reach the chat list, and a Drive backup
 * would bind the session to a Google account the emulator has no business
 * holding.
 */
export const DISMISS_OPTIONAL: readonly NodeMatcher[] = [
  byId(selectors.alert.negativeButton),
  byId(selectors.viberDialog.negativeButton),
  byText('Не сейчас'),
  byText('Позже'),
  byText('Пропустить'),
  byText('Not now'),
  byText('Later'),
  byText('Skip'),
];

/** Anything that closes a modal; only used once the "not now" spellings miss. */
export const DIALOG_ANY_BUTTON: readonly NodeMatcher[] = [
  ...DISMISS_OPTIONAL,
  byId(selectors.alert.positiveButton),
  byId(selectors.viberDialog.positiveButton),
  byText('OK'),
  byText('Готово'),
  byText('Done'),
];

const DIALOG_SCREEN: readonly NodeMatcher[] = [
  byId(selectors.alert.title),
  byId(selectors.alert.positiveButton),
  byId(selectors.alert.negativeButton),
  byId(selectors.viberDialog.positiveButton),
  byId(selectors.viberDialog.negativeButton),
];

export const PROFILE_NAME_FIELD: readonly NodeMatcher[] = [byId(selectors.profile.nameInput)];
export const PROFILE_CONTINUE: readonly NodeMatcher[] = [
  byId(selectors.profile.continueButton),
];

const CHAT_LIST: readonly NodeMatcher[] = [
  byId(selectors.chatList.root),
  byId(selectors.chatList.homeContainer),
];

const PROGRESS: readonly NodeMatcher[] = [
  byClass('android.widget.ProgressBar'),
  byId(selectors.verifying.progress),
];

function matches(node: XmlNode, matcher: NodeMatcher): boolean {
  if ('id' in matcher) return node['resource-id'] === matcher.id;
  if ('className' in matcher) return node.class === matcher.className;
  return (node.text ?? '').trim().toLowerCase() === matcher.text.toLowerCase();
}

/**
 * A parsed screen, flattened once: the classifier and the taps that follow it
 * ask a dozen questions of the same snapshot, and walking the tree for each
 * one would be wasted work.
 */
export class ScreenSnapshot {
  private readonly nodes: XmlNode[] = [];

  constructor(root: XmlNode) {
    collectAll(root, this.nodes);
  }

  /** First node matching the first alternative that matches anything. */
  find(matchers: readonly NodeMatcher[]): XmlNode | null {
    for (const matcher of matchers) {
      const node = this.nodes.find((candidate) => matches(candidate, matcher));
      if (node !== undefined) return node;
    }
    return null;
  }

  has(matchers: readonly NodeMatcher[]): boolean {
    return this.find(matchers) !== null;
  }

  boundsOf(matchers: readonly NodeMatcher[]): Bounds | null {
    return parseBounds(this.find(matchers)?.['bounds']);
  }

  textOf(id: string): string | null {
    const node = this.nodes.find((candidate) => candidate['resource-id'] === id);
    return node?.text?.trim() ?? null;
  }
}

/**
 * `getCurrentActivity()` spells the activity differently across drivers —
 * ".HomeActivity", "com.viber.voip.HomeActivity", "com.viber.voip/.HomeActivity".
 */
export function isHomeActivity(activity: string | null): boolean {
  return activity !== null && /(^|[./])HomeActivity$/u.test(activity.trim());
}

/**
 * Names the screen in front of us.
 *
 * Order matters: the QR screen carries links and the confirmation sheet
 * carries buttons, so the specific ids are asked about before any of the
 * generic shapes.
 */
export function classifyViberScreen(
  screen: ScreenSnapshot,
  activity: string | null,
): ViberScreenKind {
  // The resumed activity outranks the tree: a dump taken mid-animation can
  // read like nothing in particular while HomeActivity is already up.
  if (isHomeActivity(activity) || screen.has(CHAT_LIST)) return 'chat_list';
  if (screen.has(QR_IMAGE) || screen.has(QR_CONTAINER)) return 'qr';
  if (screen.has(PERMISSION_SCREEN)) return 'permission';
  if (screen.has(CONFIRM_NUMBER_YES)) return 'confirm_number';
  if (screen.has(PHONE_FIELD)) return 'phone_entry';
  if (screen.has(SMS_CODE)) return 'sms_code';
  if (screen.has(WELCOME_START)) return 'welcome';
  if (screen.has(PROFILE_NAME_FIELD) || screen.has(PROFILE_CONTINUE)) return 'profile_name';
  if (screen.has(DIALOG_SCREEN)) return 'dialog';
  if (screen.has(PROGRESS)) return 'progress';
  return 'unknown';
}

/** Where on the screenshot the code is drawn, so it can be cut out and decoded. */
export function findQrBounds(screen: ScreenSnapshot): Bounds | null {
  return screen.boundsOf(QR_IMAGE) ?? screen.boundsOf(QR_CONTAINER);
}

/** True for the one control on the QR screen the flow must never touch. */
export function isActivateAsOnlyDevice(node: XmlNode): boolean {
  return node['resource-id'] === selectors.qrActivation.activateAsOnlyDevice;
}
