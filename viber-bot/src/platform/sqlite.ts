import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/**
 * The slice of {@link Adb} this client needs. Narrowing it here keeps the
 * snapshot logic testable without a device attached.
 */
export interface SqliteHost {
  shell(command: string, options?: { allowFailure?: boolean; timeout?: number }): string;
  push(local: string, remote: string): void;
}

/**
 * Reading Viber's database from the emulator has three traps.
 *
 * 1. **Never open the live file.** `sqlite3` opens a database read-write by
 *    default and touches its journal, and on LDPlayer a file written through
 *    the root shell comes back owned by `media_rw` instead of the app's uid.
 *    Viber then cannot open its own database and dies on launch with
 *    `SQLiteCantOpenDatabaseException`. Every query therefore runs against a
 *    throwaway copy in `/data/local/tmp`, and the live file is only ever read
 *    by `cp`.
 * 2. **Quoting.** The SQL crosses the host shell and the device shell, so any
 *    quote or `$` in it is a landmine. Statements are base64'd on the host and
 *    decoded on the device.
 * 3. **Framing.** Results come back pipe-separated, one row per line, but
 *    message bodies contain pipes, newlines and emoji. Every text column is
 *    hex-encoded in SQL and decoded here, which keeps rows on one line and
 *    fields free of the separator. Android 9 ships SQLite 3.22 with no JSON1
 *    extension, so `json_object()` is not available as an alternative.
 */

/** Longest base64 payload we are willing to inline into an `adb shell` command. */
const INLINE_SQL_LIMIT = 2000;

/** Sidecars SQLite keeps beside a database file. */
const SIDECARS = ['-journal', '-wal', '-shm'] as const;

/** How many times a snapshot is re-taken before giving up on a busy database. */
const SNAPSHOT_ATTEMPTS = 3;

const NULL_MARKER = '';
const VALUE_PREFIX = 'X';

export type FieldKind = 'text' | 'int' | 'real';

export interface ColumnDef {
  readonly name: string;
  readonly kind: FieldKind;
}

export type Row = Record<string, string | number | null>;

/**
 * Wraps a text expression so it survives transport: NULL becomes an empty
 * field, anything else becomes `X` followed by the hex of its UTF-8 bytes.
 */
export function textExpr(expr: string): string {
  return `case when (${expr}) is null then '' else '${VALUE_PREFIX}'||hex(${expr}) end`;
}

export function decodeText(raw: string): string | null {
  if (raw === NULL_MARKER) return null;
  if (!raw.startsWith(VALUE_PREFIX)) {
    throw new Error(`Malformed text field "${raw}" — expected the "${VALUE_PREFIX}" marker.`);
  }
  const hex = raw.slice(VALUE_PREFIX.length);
  if (hex.length % 2 !== 0 || (hex.length > 0 && !/^[0-9A-Fa-f]+$/.test(hex))) {
    throw new Error(`Malformed hex in text field "${raw}".`);
  }
  return Buffer.from(hex, 'hex').toString('utf8');
}

function decodeNumber(raw: string, kind: 'int' | 'real'): number | null {
  if (raw === '') return null;
  const parsed = kind === 'int' ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Malformed ${kind} field "${raw}".`);
  }
  return parsed;
}

/** Splits sqlite3's pipe-separated output into rows of raw fields. */
export function splitRows(stdout: string, columnCount: number): string[][] {
  return stdout
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line !== '')
    .map((line) => {
      const fields = line.split('|');
      if (fields.length !== columnCount) {
        throw new Error(
          `Expected ${String(columnCount)} columns but got ${String(fields.length)} in row "${line}".`,
        );
      }
      return fields;
    });
}

export function decodeRow(fields: readonly string[], columns: readonly ColumnDef[]): Row {
  const row: Row = {};
  columns.forEach((column, index) => {
    const raw = fields[index] ?? '';
    row[column.name] = column.kind === 'text' ? decodeText(raw) : decodeNumber(raw, column.kind);
  });
  return row;
}

export function decodeRows(stdout: string, columns: readonly ColumnDef[]): Row[] {
  return splitRows(stdout, columns.length).map((fields) => decodeRow(fields, columns));
}

/** Builds the `select` list, hex-wrapping every text column. */
export function selectList(
  columns: readonly ColumnDef[],
  exprs: Readonly<Record<string, string>>,
): string {
  return columns
    .map((column) => {
      const expr = exprs[column.name] ?? column.name;
      return column.kind === 'text' ? textExpr(expr) : expr;
    })
    .join(', ');
}

export interface SqliteOptions {
  /** Where the working copy is kept on the device. */
  snapshotPath?: string;
  /** Re-copy the live database before each query. */
  refreshPerQuery?: boolean;
}

export class Sqlite {
  private readonly snapshotPath: string;
  private readonly refreshPerQuery: boolean;
  private snapshotTaken = false;

  constructor(
    private readonly adb: SqliteHost,
    private readonly livePath: string,
    options: SqliteOptions = {},
  ) {
    this.snapshotPath = options.snapshotPath ?? '/data/local/tmp/viber-snapshot.db';
    this.refreshPerQuery = options.refreshPerQuery ?? true;
  }

  /** Copies the live database and whichever sidecars exist beside it. */
  private copySnapshot(): void {
    this.adb.shell(`sh -c 'rm -f ${this.snapshotPath}*'`, { allowFailure: true });
    this.adb.shell(`cp -f ${this.livePath} ${this.snapshotPath}`);
    for (const suffix of SIDECARS) {
      if (
        this.adb
          .shell(`test -f ${this.livePath}${suffix} && echo 1`, { allowFailure: true })
          .trim() === '1'
      ) {
        this.adb.shell(`cp -f ${this.livePath}${suffix} ${this.snapshotPath}${suffix}`, {
          allowFailure: true,
        });
      }
    }
  }

  private dropCopiedSidecars(): void {
    this.adb.shell(
      `sh -c 'rm -f ${SIDECARS.map((suffix) => `${this.snapshotPath}${suffix}`).join(' ')}'`,
      { allowFailure: true },
    );
  }

  /**
   * True when the copy still has a schema to query.
   *
   * A snapshot can open cleanly and yet contain nothing: replaying a hot
   * journal rolls the copy back, and if that journal belongs to a later
   * transaction than the copied pages, the rollback can take `sqlite_master`
   * with it. The failure then surfaces far away as `no such table: messages`.
   */
  private snapshotHasSchema(): boolean {
    const output = this.adb.shell(
      `sqlite3 ${this.snapshotPath} "select count(*) from sqlite_master where type='table';"`,
      { allowFailure: true },
    );
    const count = Number.parseInt(output.trim(), 10);
    return Number.isFinite(count) && count > 0;
  }

  /**
   * Copies the live database, plus any journal or WAL sidecar, into the
   * scratch location, and checks the result is actually queryable.
   *
   * The sidecars come along because Viber may be mid-write and SQLite has to
   * replay them. They are copied a moment *after* the database itself, though,
   * so a busy chat can produce a pair that does not belong together. When that
   * happens the sidecars are dropped — a database without them is at worst
   * missing the transaction in flight — and only if that still yields nothing
   * is the whole snapshot taken again.
   */
  refresh(): void {
    for (let attempt = 1; attempt <= SNAPSHOT_ATTEMPTS; attempt += 1) {
      this.copySnapshot();
      if (this.snapshotHasSchema()) {
        this.snapshotTaken = true;
        return;
      }
      this.dropCopiedSidecars();
      if (this.snapshotHasSchema()) {
        this.snapshotTaken = true;
        return;
      }
    }
    this.snapshotTaken = false;
    throw new Error(
      `Could not take a usable snapshot of ${this.livePath} after ${String(SNAPSHOT_ATTEMPTS)} attempts: ` +
        'the copy came back without a schema. The app is probably rewriting the database right now.',
    );
  }

  private ensureSnapshot(): void {
    if (this.refreshPerQuery || !this.snapshotTaken) this.refresh();
  }

  /** Runs a statement against the snapshot and returns sqlite3's raw stdout. */
  raw(sql: string): string {
    this.ensureSnapshot();
    const payload = Buffer.from(sql, 'utf8').toString('base64');
    if (payload.length <= INLINE_SQL_LIMIT) {
      return this.adb.shell(`echo ${payload} | base64 -d | sqlite3 ${this.snapshotPath}`);
    }
    return this.runViaFile(sql);
  }

  /** Falls back to pushing the statement as a file when it is too long to inline. */
  private runViaFile(sql: string): string {
    const localPath = join(tmpdir(), `viber-query-${String(process.pid)}-${String(Date.now())}.sql`);
    const remotePath = '/data/local/tmp/viber-query.sql';
    writeFileSync(localPath, sql, 'utf8');
    try {
      this.adb.push(localPath, remotePath);
      return this.adb.shell(`sh -c 'cat ${remotePath} | sqlite3 ${this.snapshotPath}'`);
    } finally {
      this.adb.shell(`rm -f ${remotePath}`, { allowFailure: true });
      try {
        unlinkSync(localPath);
      } catch {
        // The temp file is disposable; failing to remove it must not mask a query error.
      }
    }
  }

  query(sql: string, columns: readonly ColumnDef[]): Row[] {
    const output = this.raw(sql);
    if (/^Error:/m.test(output)) {
      throw new Error(`sqlite3 rejected the query: ${output.trim()}`);
    }
    return decodeRows(output, columns);
  }

  /** Runs a statement expected to return a single integer, such as a count. */
  count(sql: string): number {
    const output = this.raw(sql).trim();
    const parsed = Number.parseInt(output, 10);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Expected a number from "${sql}" but got "${output}".`);
    }
    return parsed;
  }

  /**
   * Safely applies SQL modifications to the live database file.
   * Runs the SQL in a transaction with timeout, preserves/restores app ownership/permissions,
   * and optionally opens the app again.
   */
  updateLive(
    sql: string,
    options: { restartApp?: boolean; appPackage?: string; forceStop?: boolean } = {},
  ): void {
    const appPackage = options.appPackage ?? 'com.viber.voip';
    const appDir = `/data/data/${appPackage}`;
    const statOut = this.adb.shell(`stat -c "%u:%g" ${appDir}`, { allowFailure: true }).trim();
    const owner = /^\d+:\d+$/.test(statOut) ? statOut : null;

    const forceStop = options.forceStop ?? true;
    if (forceStop) {
      this.adb.shell(`am force-stop ${appPackage}`, { allowFailure: true });
      this.adb.shell(`sh -c "echo 'PRAGMA wal_checkpoint(TRUNCATE);' | sqlite3 ${this.livePath}"`, {
        allowFailure: true,
      });
      this.adb.shell(`rm -f ${this.livePath}-journal ${this.livePath}-wal ${this.livePath}-shm`, {
        allowFailure: true,
      });
    }

    this.adb.shell(`cp -f ${this.livePath} ${this.livePath}.bak`, { allowFailure: true });

    const remotePath = '/data/local/tmp/viber-update.sql';
    const localPath = join(tmpdir(), `viber-update-${String(process.pid)}-${String(Date.now())}.sql`);
    writeFileSync(localPath, `BEGIN TRANSACTION;\n${sql}\nCOMMIT;\n`, 'utf8');

    try {
      this.adb.push(localPath, remotePath);
      let out = this.adb.shell(
        `sh -c 'cat ${remotePath} | sqlite3 -cmd ".timeout 15000" ${this.livePath}'`,
      );
      if (/^Error:.*database is locked/mi.test(out)) {
        // App or lingering lock was still held, force stop again, checkpoint and retry
        this.adb.shell(`am force-stop ${appPackage}`, { allowFailure: true });
        this.adb.shell(`sh -c "echo 'PRAGMA wal_checkpoint(TRUNCATE);' | sqlite3 ${this.livePath}"`, {
          allowFailure: true,
        });
        this.adb.shell(`rm -f ${this.livePath}-journal ${this.livePath}-wal ${this.livePath}-shm`, {
          allowFailure: true,
        });
        out = this.adb.shell(
          `sh -c 'cat ${remotePath} | sqlite3 -cmd ".timeout 15000" ${this.livePath}'`,
        );
      }
      if (/^Error:/m.test(out)) {
        throw new Error(`sqlite3 update rejected: ${out.trim()}`);
      }
    } finally {
      this.adb.shell(`rm -f ${remotePath}`, { allowFailure: true });
      try {
        unlinkSync(localPath);
      } catch {
        // temp file cleanup
      }

      if (owner) {
        this.adb.shell(`sh -c 'chown ${owner} ${this.livePath}*'`, { allowFailure: true });
      }
      this.adb.shell(`sh -c 'chmod 777 ${this.livePath}*'`, { allowFailure: true });

      this.snapshotTaken = false;

      if (options.restartApp) {
        this.adb.shell(`am start -n ${appPackage}/.WelcomeActivity`, {
          allowFailure: true,
        });
      }
    }
  }
}

