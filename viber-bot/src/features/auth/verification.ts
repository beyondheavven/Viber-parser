/**
 * Labels of Viber's «Call me» control on the activation screen, EN and RU.
 *
 * Written as a Java regex for UiSelector.textMatches, which matches the whole
 * label: "(?i)" makes it case-insensitive, the outer \s* absorbs the padding
 * Viber puts around some labels.
 */
export const CALL_ME_TEXT_PATTERN =
  '(?i)\\s*(call me|call me now|get a call|request a call|позвонить мне|позвоните мне|получить звонок|заказать звонок)\\s*';

const CODE_LENGTH = /(?:последни[ехй]|last)\s+(\d{1,2})\b/iu;

/**
 * How many digits Viber wants, when the screen says so ("Enter the last 4
 * digits…", "Введите последние 4 цифры…"). Reads the `text` attributes of a
 * page source dump.
 */
export function readCallCodeLength(pageSource: string): number | null {
  for (const match of pageSource.matchAll(/ text="([^"]*)"/gu)) {
    const found = CODE_LENGTH.exec(match[1] ?? '');
    if (!found) continue;
    const length = Number.parseInt(found[1] ?? '', 10);
    if (length > 0 && length <= 12) return length;
  }
  return null;
}

export function callCodeMessage(codeLength: number | null): string {
  const digits = codeLength ? `последние ${String(codeLength)} цифры` : 'последние цифры';
  return `Viber звонит на ваш номер. Введите ${digits} номера, с которого поступил звонок.`;
}
