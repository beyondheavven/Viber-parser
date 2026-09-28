import test from 'node:test';
import assert from 'node:assert/strict';
import { VersionedAccountCache } from '../src/account-cache.js';

test('logout invalidation prevents an older health request from restoring account data', async () => {
  const cache = new VersionedAccountCache<string>();
  const healthGeneration = cache.capture('emulator-1');
  let finishHealth!: () => void;
  const healthGate = new Promise<void>((resolve) => {
    finishHealth = resolve;
  });

  const healthUpdate = healthGate.then(() =>
    cache.setIfCurrent('emulator-1', healthGeneration, 'stale-account'),
  );

  cache.invalidate('emulator-1');
  finishHealth();

  assert.equal(await healthUpdate, false);
  assert.equal(cache.get('emulator-1'), undefined);
});
