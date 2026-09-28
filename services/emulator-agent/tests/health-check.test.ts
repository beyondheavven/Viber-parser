import test from 'node:test';
import assert from 'node:assert/strict';
import { parseContainerHealthOutput } from '../src/health-check.js';

test('parseContainerHealthOutput parses account data and handles empty output', () => {
  const sampleOutput = [
    '1',
    '21746 22242',
    '===PHONE===',
    '380977257103',
    '===NAME===',
    '    <string name="display_name">Maks &amp; Team</string>',
    '',
  ].join('\r\n');

  const result = parseContainerHealthOutput(sampleOutput);
  assert.equal(result.bootCompleted, true);
  assert.equal(result.viberRunning, true);
  assert.ok(result.viberAccount);
  assert.equal(result.viberAccount.phoneNumber, '+380977257103');
  assert.equal(result.viberAccount.displayName, 'Maks & Team');
  assert.equal(result.viberAccount.status, 'authorized');
  assert.equal(result.viberAccount.source, 'device');

  const emptyResult = parseContainerHealthOutput('');
  assert.equal(emptyResult.bootCompleted, false);
  assert.equal(emptyResult.viberRunning, false);
  assert.equal(emptyResult.viberAccount, null);
});
