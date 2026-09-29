import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScrcpyUrl } from '../src/scrcpy-url.js';

test('buildScrcpyUrl matches the stream link that works on the VM', () => {
  assert.equal(
    buildScrcpyUrl('136.92.24.88', 8000, 5557),
    'http://136.92.24.88:8000/#!action=stream&udid=host.docker.internal%3A5557&player=broadway' +
      '&ws=ws%3A%2F%2F136.92.24.88%3A8000%2F%3Faction%3Dproxy-adb%26remote%3Dtcp%253A8886%26udid%3Dhost.docker.internal%253A5557',
  );
});

test('buildScrcpyUrl addresses the main emulator by its compose name', () => {
  const url = new URL(buildScrcpyUrl('136.92.24.88', 8000, 5555)!);
  const hash = new URLSearchParams(url.hash.slice(2));
  assert.equal(hash.get('udid'), 'android-emulator:5555');
  assert.equal(
    hash.get('ws'),
    'ws://136.92.24.88:8000/?action=proxy-adb&remote=tcp%3A8886&udid=android-emulator%3A5555',
  );
});

test('buildScrcpyUrl has no link without an ADB port', () => {
  assert.equal(buildScrcpyUrl('136.92.24.88', 8000, null), null);
});
