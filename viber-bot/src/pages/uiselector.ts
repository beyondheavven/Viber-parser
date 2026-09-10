/**
 * Helpers that build UiAutomator selector strings for WebdriverIO's
 * `android=` locator strategy.
 *
 * They live apart from the resource-id map in selectors.ts because these are
 * query builders, not ids: composing text, resource-id and scrolling into one
 * UiSelector/UiScrollable expression.
 */

function quote(value: string): string {
  return JSON.stringify(value);
}

export function byText(text: string): string {
  return `android=new UiSelector().text(${quote(text)})`;
}

export function byTextStartsWith(prefix: string): string {
  return `android=new UiSelector().textStartsWith(${quote(prefix)})`;
}

export function byTextContains(part: string): string {
  return `android=new UiSelector().textContains(${quote(part)})`;
}

export function byId(resourceId: string): string {
  return `android=new UiSelector().resourceId(${quote(resourceId)})`;
}

export function byIdAndText(resourceId: string, text: string): string {
  return `android=new UiSelector().resourceId(${quote(resourceId)}).text(${quote(text)})`;
}

export function byIdAndTextContains(resourceId: string, part: string): string {
  return `android=new UiSelector().resourceId(${quote(resourceId)}).textContains(${quote(part)})`;
}

/** Scrolls the first scrollable container until an element with `text` shows. */
export function scrollToText(text: string): string {
  return (
    'android=new UiScrollable(new UiSelector().scrollable(true))' +
    `.scrollIntoView(new UiSelector().text(${quote(text)}))`
  );
}

/** Scrolls the first scrollable container until a substring match shows. */
export function scrollToTextContains(part: string): string {
  return (
    'android=new UiScrollable(new UiSelector().scrollable(true))' +
    `.scrollIntoView(new UiSelector().textContains(${quote(part)}))`
  );
}
