import { existsSync } from 'node:fs';
import { loadViberConfig } from './config/env.js';
import { Adb, AdbError, probeTcp } from './device/adb.js';
import { LdPlayer } from './device/ldplayer.js';
import { Sqlite } from './device/sqlite.js';
import { ViberRepository } from './viber/repository.js';

export interface DeviceContext {
  ld: LdPlayer;
  adb: Adb;
  db: Sqlite;
  viber: ViberRepository;
}

/**
 * Wires the LDPlayer instance, adb, the on-device SQLite client and the Viber
 * repository together.
 *
 * Reading Viber's database needs root, and `adb root` drops the connection
 * while adbd restarts, so bringing the emulator up is an async step that every
 * entry point has to await before touching data.
 */
export async function openDevice(options: { ensureUp?: boolean } = {}): Promise<DeviceContext> {
  const ld = new LdPlayer();
  const adb = new Adb();

  if (options.ensureUp === false || !ld.isAvailable()) {
    const reachable = await probeTcp(adb.serial);
    if (!reachable) {
      throw new AdbError(
        `Could not connect to ${adb.serial}. Is the Android emulator running with ADB debugging enabled?`,
        ['connect', adb.serial],
        '',
        '',
      );
    }
    adb.connect();
    adb.root();
  } else {
    await ld.up(adb);
  }

  const db = new Sqlite(adb, loadViberConfig().messagesDb);
  return { ld, adb, db, viber: new ViberRepository(db) };
}
