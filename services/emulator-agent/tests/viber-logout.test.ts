import test from 'node:test';
import assert from 'node:assert/strict';
import { logoutViber } from '../src/viber-logout.js';

test('logoutViber clears Viber data in the selected emulator container', async () => {
  const selectedContainer = { exec: () => Promise.reject(new Error('not used')) };
  let receivedContainer: unknown;
  let receivedOptions: unknown;
  let receivedTimeout: unknown;

  await logoutViber(selectedContainer as never, async (container, options, timeoutMs) => {
    receivedContainer = container;
    receivedOptions = options;
    receivedTimeout = timeoutMs;
    return {
      output: 'Success\n',
      exitCode: 0,
      timedOut: false,
      outputTruncated: false,
    };
  });

  assert.equal(receivedContainer, selectedContainer);
  assert.deepEqual(receivedOptions, {
    Cmd: ['adb', 'shell', 'pm', 'clear', 'com.viber.voip'],
  });
  assert.equal(receivedTimeout, 15_000);
});

test('logoutViber rejects failed or ambiguous package clear results', async () => {
  const container = { exec: () => Promise.reject(new Error('not used')) } as never;

  await assert.rejects(
    logoutViber(container, async () => ({
      output: 'Failed\n',
      exitCode: 0,
      timedOut: false,
      outputTruncated: false,
    })),
    /не удалось выйти из Viber/i,
  );

  await assert.rejects(
    logoutViber(container, async () => ({
      output: 'Success\n',
      exitCode: 1,
      timedOut: false,
      outputTruncated: false,
    })),
    /не удалось выйти из Viber/i,
  );
});
