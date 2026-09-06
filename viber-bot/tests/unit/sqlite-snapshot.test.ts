import { describe, expect, it } from 'vitest';

import { Sqlite, type SqliteHost } from '../../src/device/sqlite.js';

const LIVE = '/data/data/com.viber.voip/databases/viber_messages';
const SNAPSHOT = '/data/local/tmp/viber-snapshot.db';

interface HostOptions {
  /** Sidecars that exist next to the live database. */
  sidecars?: string[];
  /**
   * Answers `usable?` per call, so a test can say "broken while the journal
   * copy is there, fine once it is gone".
   */
  tableCount: (state: { journalCopied: boolean; copies: number }) => number;
}

function fakeHost(options: HostOptions): { host: SqliteHost; commands: string[] } {
  const sidecars = options.sidecars ?? ['-journal'];
  const commands: string[] = [];
  let journalCopied = false;
  let copies = 0;

  const host: SqliteHost = {
    shell(command: string): string {
      commands.push(command);
      if (command.startsWith('rm -f') || command.includes("'rm -f")) {
        if (command.includes(SNAPSHOT)) journalCopied = false;
        return '';
      }
      if (command.startsWith('test -f')) {
        return sidecars.some((suffix) => command.includes(`${LIVE}${suffix}`)) ? '1\n' : '';
      }
      if (command.startsWith('cp -f')) {
        if (command.includes(`${LIVE} ${SNAPSHOT}`)) copies += 1;
        else journalCopied = true;
        return '';
      }
      if (command.includes('sqlite_master')) {
        return `${String(options.tableCount({ journalCopied, copies }))}\n`;
      }
      return '';
    },
    push(): void {
      // Only long statements are pushed; these tests keep them short.
    },
  };

  return { host, commands };
}

describe('Sqlite.refresh', () => {
  it('copies the live database and its sidecars', () => {
    const { host, commands } = fakeHost({ tableCount: () => 58 });

    new Sqlite(host, LIVE).refresh();

    expect(commands.some((c) => c.includes(`cp -f ${LIVE} ${SNAPSHOT}`))).toBe(true);
    expect(commands.some((c) => c.includes(`cp -f ${LIVE}-journal ${SNAPSHOT}-journal`))).toBe(true);
  });

  it('drops the copied journal when replaying it leaves no schema behind', () => {
    // The journal is copied a moment after the database, so it can describe a
    // newer transaction and roll the copy back past its own tables.
    const { host, commands } = fakeHost({
      tableCount: ({ journalCopied }) => (journalCopied ? 0 : 58),
    });

    new Sqlite(host, LIVE).refresh();

    const dropIndex = commands.findIndex(
      (c) => c.includes('rm -f') && c.includes(`${SNAPSHOT}-journal`),
    );
    expect(dropIndex).toBeGreaterThan(0);
    // One copy was enough once the journal was out of the way.
    expect(commands.filter((c) => c.includes(`cp -f ${LIVE} ${SNAPSHOT}`))).toHaveLength(1);
  });

  it('takes the snapshot again when the first attempt is unusable either way', () => {
    const { host, commands } = fakeHost({
      tableCount: ({ copies }) => (copies < 2 ? 0 : 58),
    });

    new Sqlite(host, LIVE).refresh();

    expect(commands.filter((c) => c.includes(`cp -f ${LIVE} ${SNAPSHOT}`))).toHaveLength(2);
  });

  it('explains what went wrong instead of leaving a broken snapshot in place', () => {
    const { host } = fakeHost({ tableCount: () => 0 });

    expect(() => new Sqlite(host, LIVE).refresh()).toThrow(/snapshot/i);
  });

  it('does not ask for a sidecar the live database does not have', () => {
    const { host, commands } = fakeHost({ sidecars: [], tableCount: () => 58 });

    new Sqlite(host, LIVE).refresh();

    expect(commands.some((c) => c.includes(`cp -f ${LIVE}-wal`))).toBe(false);
  });
});
