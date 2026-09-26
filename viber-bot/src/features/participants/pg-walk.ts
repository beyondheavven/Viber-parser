/**
 * The decision logic of one roster walk: which replies count, when to ask for
 * the next offset, and whether the walk actually finished.
 *
 * It owns no timers, no device and no Frida handles — the service around it
 * does the posting and the idle watchdog. Keeping the rules here is what makes
 * them testable: this is where a walk used to end early on a reply that was
 * never meant for it.
 */

import { nextSindex, pageAnswers, parsePgPage } from './pg-paging.js';

export interface PgWalkProgress {
  pagesCount: number;
  currentOffset: number;
  pageSize: number;
  lastPage: boolean;
  headerTotal: number | null;
}

export interface PgWalkSummary {
  /** Only the pages that answered this walk — never another group's. */
  rawPageJsons: string[];
  /** Distinct offsets answered, so duplicate delegate copies do not inflate it. */
  pagesCount: number;
  lastReached: boolean;
  headerTotal: number | null;
  /** Roster size the final page implies (`sindex + count`), when one arrived. */
  expectedTotal: number | null;
  /** Members summed across the distinct pages received. */
  collectedMembers: number;
  /** Replies discarded as belonging to another group or an unrequested offset. */
  ignoredPages: number;
  /** `query-error` reports the agent sent while this walk was running. */
  queryErrors: string[];
}

export interface PgWalkHooks {
  /** Sends a General Query for this offset. */
  request(sindex: number): void;
  onProgress?: ((progress: PgWalkProgress) => void) | undefined;
  onWarning?: ((message: string) => void) | undefined;
}

/** What a reply did to the walk — the caller keys its idle timer off this. */
export type PgWalkOutcome = 'accepted' | 'ignored' | 'complete';

export const SINDEX_CAP = 200_000;

export class PgWalk {
  /** Offsets this walk asked for — the only ones whose replies count. */
  private readonly requested = new Set<number>();
  /** Offsets already answered, so delegate duplicates are counted once. */
  private readonly answered = new Set<number>();
  private readonly pages: string[] = [];
  private readonly queryErrors: string[] = [];

  private ignoredPages = 0;
  private collectedMembers = 0;
  private headerTotal: number | null = null;
  private expectedTotal: number | null = null;
  private lastReached = false;
  private done = false;

  constructor(
    private readonly groupId: string,
    private readonly hooks: PgWalkHooks,
    private readonly sindexCap: number = SINDEX_CAP,
    private readonly initialOffset: number = 0,
  ) {}

  /** Asks for the first page. */
  start(): void {
    this.request(this.initialOffset);
  }

  get isDone(): boolean {
    return this.done;
  }

  /** Offsets requested so far — a reply for anything else is not ours. */
  get requestedOffsets(): ReadonlySet<number> {
    return this.requested;
  }

  noteQueryError(message: string): void {
    if (!this.done) this.queryErrors.push(message);
  }

  /**
   * Feeds one `pg-reply` into the walk.
   *
   * The Frida hook is passive and sees every General Query reply the app
   * receives, including ones Viber issues for other conversations while the UI
   * is open. Accepting those would mix in strangers and — worse — a stray
   * `last: true` would end the walk as if the whole roster had been read.
   */
  offer(json: string): PgWalkOutcome {
    if (this.done) return 'ignored';

    const page = parsePgPage(json);
    if (page === null) return 'ignored';

    if (!pageAnswers(page, this.groupId, this.requested)) {
      this.ignoredPages += 1;
      return 'ignored';
    }
    if (page.result !== null && page.result !== 0) {
      this.ignoredPages += 1;
      this.hooks.onWarning?.(
        `Discarding the page at offset ${String(page.sindex)}: result=${String(page.result)}.`,
      );
      return 'ignored';
    }

    // Up to five JNI delegates are hooked, so the same page arrives several
    // times; only the first copy of an offset is real progress.
    if (!this.answered.has(page.sindex)) {
      this.answered.add(page.sindex);
      this.pages.push(json);
      this.collectedMembers += page.count;
      this.headerTotal = Math.max(this.headerTotal ?? 0, page.sindex + page.count);
    }

    this.hooks.onProgress?.({
      pagesCount: this.answered.size,
      currentOffset: page.sindex,
      pageSize: page.size,
      lastPage: page.last,
      headerTotal: this.headerTotal,
    });

    if (page.last) {
      this.expectedTotal = page.sindex + page.count;
      // `last` alone is not proof the walk is complete: a page in the middle
      // may have been missed. Only a member count reaching the total the final
      // page implies means nothing was skipped.
      this.lastReached = (this.collectedMembers + this.initialOffset) >= this.expectedTotal;
      if (!this.lastReached) {
        this.hooks.onWarning?.(
          `The final page says the roster holds ${String(this.expectedTotal)} members but only ` +
            `${String(this.collectedMembers)} arrived across ${String(this.answered.size)} pages.`,
        );
      }
      this.done = true;
      return 'complete';
    }

    this.request(nextSindex(page));
    return 'accepted';
  }

  /** Freezes the walk and reports what it gathered. */
  summary(): PgWalkSummary {
    this.done = true;
    return {
      rawPageJsons: this.pages,
      pagesCount: this.answered.size,
      lastReached: this.lastReached,
      headerTotal: this.headerTotal,
      expectedTotal: this.expectedTotal,
      collectedMembers: this.collectedMembers,
      ignoredPages: this.ignoredPages,
      queryErrors: this.queryErrors,
    };
  }

  private request(sindex: number): void {
    if (this.done || this.requested.has(sindex) || sindex > this.sindexCap) return;
    this.requested.add(sindex);
    this.hooks.request(sindex);
  }
}
