import { remote, type Browser } from 'webdriverio';
import { loadAdbConfig, loadAppiumConfig, loadViberConfig } from '../../config/env.js';
import { buildViberCapabilities } from './capabilities.js';

export type ViberDriver = Browser;

/**
 * Opens an Appium session against Viber in the LDPlayer instance.
 *
 * The Appium server has to be running already (`npm run appium`) — starting it
 * per session would add half a minute to every command.
 */
export async function createViberSession(): Promise<ViberDriver> {
  const appium = loadAppiumConfig();
  const viber = loadViberConfig();
  const { serial } = loadAdbConfig();

  return remote({
    hostname: appium.host,
    port: appium.port,
    path: '/',
    logLevel: 'error',
    connectionRetryTimeout: 180_000,
    connectionRetryCount: 2,
    capabilities: buildViberCapabilities(viber, appium, serial),
  });
}

/** Runs `work` in a session and always tears the session down afterwards. */
export async function withViberSession<T>(work: (driver: ViberDriver) => Promise<T>): Promise<T> {
  const driver = await createViberSession();
  try {
    return await work(driver);
  } finally {
    await driver.deleteSession().catch(() => {
      // A session that already died must not mask the original failure.
    });
  }
}
