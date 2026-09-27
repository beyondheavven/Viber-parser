/**
 * Runs the `trace-http` agent against a live Viber process and prints every
 * HTTP exchange it completes, flagging the ones with no Content-Type — the
 * responses Viber's native layer turns into "No Connectivity".
 *
 *   node trace-http.mjs [pid]
 *
 * Compiles the agent the same way the bot does, so frida-java-bridge is
 * bundled (Frida 17 removed the built-in `Java` global).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDevice } from 'frida';

const SERIAL = process.env.ANDROID_SERIAL ?? 'android-emulator:5555';
const PKG = 'com.viber.voip';

function compileAgent(name) {
  const entry = join(process.cwd(), 'src', 'platform', 'frida', 'scripts', `${name}.js`);
  const outPath = join(process.cwd(), '.frida', `${name}.compiled.js`);
  const cli = join(process.cwd(), 'node_modules', 'frida-compile', 'dist', 'cli.js');
  mkdirSync(join(process.cwd(), '.frida'), { recursive: true });
  const result = spawnSync(
    process.execPath,
    [cli, entry, '-o', outPath, '--no-source-maps', '--type-check', 'none', '--bundle-format', 'iife'],
    { encoding: 'utf8', timeout: 120_000 },
  );
  if (result.status !== 0) {
    throw new Error(`frida-compile failed: ${result.stderr || result.stdout}`);
  }
  return readFileSync(outPath, 'utf8');
}

const device = await getDevice(SERIAL, { timeout: 10_000 });
const target = process.argv[2] ? Number(process.argv[2]) : PKG;
console.error(`device ${device.id} — attaching to ${target}`);

const session = await device.attach(target);
const script = await session.createScript(compileAgent('trace-http'));

script.message.connect((message) => {
  if (message.type !== 'send') {
    console.error('script error:', JSON.stringify(message));
    return;
  }
  const p = message.payload;
  if (p.event === 'http') {
    const flag = p.contentType === null ? '   <<< NO Content-Type' : '';
    console.log(`[${p.code}] ${p.method} ${p.url}  ct=${p.contentType}${flag}`);
    if (p.code >= 400) {
      console.log(`  headers: ${String(p.headers).split('\n').join(' | ')}`);
      console.log(`  body: ${p.body}`);
    }
  } else if (p.event === 'convert-failed') {
    console.log(`!! convertResponse threw for ${p.url}: ${p.message}`);
  } else if (p.event === 'ready') {
    console.error(`hooked ${p.what}`);
  } else {
    console.error(`(${p.event}) ${p.where ?? ''} ${p.message ?? ''}`);
  }
});

await script.load();
console.error('--- reproduce the dialog now ---');
process.stdin.resume();
