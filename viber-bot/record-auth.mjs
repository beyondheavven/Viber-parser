/**
 * Records every distinct screen Viber shows while the auth flow is walked by hand.
 *
 * The emulator image's shell `uiautomator dump` is broken ("null root node"), so
 * the hierarchy is read through the Appium server that is already running in the
 * `viber-appium` container. The session attaches with `autoLaunch: false`, so it
 * observes without starting or resetting anything.
 *
 *   node record-auth.mjs [outputDir]
 *
 * Stops on: a STOP file in the output dir, the conversation list staying up after
 * registration screens were seen, or the time limit.
 */
import { remote } from 'webdriverio';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? join(process.cwd(), 'auth-capture');
const MAX_MINUTES = 45;
const POLL_MS = 1_000;

const capabilities = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:udid': 'android-emulator:5555',
  'appium:noReset': true,
  'appium:autoLaunch': false,
  'appium:newCommandTimeout': 3_600,
  'appium:settings[allowInvisibleElements]': true,
};

const connect = () =>
  remote({ hostname: '127.0.0.1', port: 4723, path: '/', logLevel: 'error', capabilities });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Screens are the same when they show the same activity, ids and leading texts. */
function signature(activity, xml) {
  const ids = [...new Set(xml.match(/resource-id="([^"]*)"/g) ?? [])].sort();
  const texts = [...new Set(xml.match(/ text="([^"]{1,40})"/g) ?? [])].sort().slice(0, 14);
  return createHash('md5').update(`${activity}|${ids.join('|')}|${texts.join('|')}`).digest('hex');
}

function summarise(xml) {
  const clickable = [
    ...xml.matchAll(/resource-id="([^"]*)"[^>]*?clickable="true"/g),
    ...xml.matchAll(/clickable="true"[^>]*?resource-id="([^"]*)"/g),
  ]
    .map((m) => m[1])
    .filter(Boolean);
  const inputs = [...xml.matchAll(/class="android\.widget\.EditText"[^>]*resource-id="([^"]*)"/g)].map(
    (m) => m[1],
  );
  return {
    clickable: [...new Set(clickable)],
    inputs: [...new Set(inputs)],
  };
}

mkdirSync(OUT, { recursive: true });
const timeline = [];
const seen = new Map();
let index = 0;
let sawRegistration = false;
let loggedInSince = null;

let driver = await connect();
console.log(`recording into ${OUT} — walk through the auth flow now`);

const deadline = Date.now() + MAX_MINUTES * 60_000;
while (Date.now() < deadline) {
  if (existsSync(join(OUT, 'STOP'))) {
    console.log('STOP file found — finishing');
    break;
  }

  let activity = '?';
  let xml = null;
  try {
    xml = await driver.getPageSource();
    activity = await driver.getCurrentActivity();
  } catch (error) {
    // Viber restarts itself during registration and takes the session with it.
    console.log(`session lost (${String(error).split('\n')[0]}) — reattaching`);
    try {
      await driver.deleteSession();
    } catch {
      /* already gone */
    }
    await sleep(2_000);
    try {
      driver = await connect();
    } catch {
      await sleep(3_000);
    }
    continue;
  }

  const key = signature(activity, xml);
  if (!seen.has(key)) {
    index += 1;
    const slug = activity.replace(/^.*[./]/, '').replace(/[^\w]+/g, '_').slice(0, 50) || 'screen';
    const name = `${String(index).padStart(2, '0')}-${slug}`;
    writeFileSync(join(OUT, `${name}.xml`), xml, 'utf8');
    try {
      writeFileSync(join(OUT, `${name}.png`), Buffer.from(await driver.takeScreenshot(), 'base64'));
    } catch {
      /* a screenshot is a nice-to-have */
    }
    seen.set(key, name);

    const { clickable, inputs } = summarise(xml);
    const stamp = new Date().toTimeString().slice(0, 8);
    timeline.push(
      `${stamp} ${name}\n  activity: ${activity}\n  inputs:    ${inputs.join(', ') || '—'}\n  clickable: ${clickable.join(', ') || '—'}`,
    );
    writeFileSync(join(OUT, 'timeline.txt'), `${timeline.join('\n\n')}\n`, 'utf8');
    console.log(`[${stamp}] ${name}  (${activity})`);
  }

  if (/registration|activation|SelectCountry/i.test(`${activity}${xml}`)) sawRegistration = true;
  if (xml.includes('com.viber.voip:id/messages_list')) {
    loggedInSince ??= Date.now();
    if (sawRegistration && Date.now() - loggedInSince > 8_000) {
      console.log('conversation list is up — auth finished');
      break;
    }
  } else {
    loggedInSince = null;
  }

  await sleep(POLL_MS);
}

await driver.deleteSession().catch(() => {});
console.log(`\ncaptured ${index} distinct screens into ${OUT}`);
