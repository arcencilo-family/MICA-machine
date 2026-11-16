// ── MICA · the PASS-BLIND notifier — record all, notify sparingly ─────────────
//
// §5: PASS-BLIND records are UNCONDITIONAL (the ledger's job — see ledger.ts).
// The NOTIFICATION is BATCHED, not per-event, and carries "check the line".
//
// This is modelled on the clerk's refusal rate-limiting (src/clerk/core.ts,
// `refuse()`): every event is recorded to a chained store, but at most one
// notice is emitted per window, and the count of SUPPRESSED events since the
// last notice is carried in that notice, NEVER dropped. A flood of PASS-BLINDs
// cannot bury the signal, and it cannot silence it either — the count comes out.
//
// The clerk gates on a wall-clock cooldown. This gates on a COUNT window instead:
// MICA does not stamp self-authored wall-clock time (see the export artifact
// footer), so a deterministic count is the honest, testable choice. The window
// is a calibration detail (§5) and is INJECTED with a simple default; where a
// notice goes (the sink) is injected too, same discipline as every other
// deployment fact.

export interface BatchNotice {
  /**
   * How many PASS-BLIND events this notice accounts for, including the one that
   * triggered it. Every recorded event is covered by exactly one notice's count
   * across the run (plus the final flush) — none is dropped.
   */
  readonly count: number;
  /** Running total of PASS-BLIND events since the notifier was created. */
  readonly totalSoFar: number;
  readonly message: string;
}

export const CHECK_THE_LINE =
  "PASS-BLIND actions executed unread and below the injected stakes line, and " +
  "each was recorded permanently. CHECK THE LINE: if this count is higher than " +
  "expected, either more actions are going unread than the deployment intends, " +
  "or the line is set too low. This notice is BATCHED — 'none since last' means " +
  "none was NOTIFIED, never that none occurred; every event is in the ledger.";

/** Where a notice goes. Injected, so the deployment owns the channel. */
export type NoticeSink = (notice: BatchNotice) => void;

export interface BatchedNotifierOptions {
  /**
   * Emit one notice per this many PASS-BLIND events. INJECTED. Must be a
   * positive integer; a non-usable value falls back to the default below and
   * says so is left to the caller — the default is a calibration detail, not a
   * deployment fact, so a default is permitted here where a threshold would not
   * be.
   */
  readonly window?: number;
  /** Where notices go. Absent -> notices are computed but not delivered anywhere. */
  readonly sink?: NoticeSink;
}

/** A plainly-stated default window. Small enough to be visible, not per-event. */
export const DEFAULT_NOTIFY_WINDOW = 25;

/**
 * Records nothing itself (the ledger does that); it only decides WHEN to notify
 * and carries the suppressed count so the signal survives a flood.
 */
export class BatchedNotifier {
  private readonly window: number;
  private readonly sink: NoticeSink | null;
  private sinceLastNotice = 0;
  private total = 0;

  constructor(options?: BatchedNotifierOptions) {
    const w = options?.window;
    this.window =
      typeof w === "number" && Number.isInteger(w) && w > 0
        ? w
        : DEFAULT_NOTIFY_WINDOW;
    this.sink = options?.sink ?? null;
  }

  /**
   * Count one recorded PASS-BLIND. Returns a notice iff this event closed a
   * window, else null. The returned notice (when non-null) has already been
   * handed to the sink.
   */
  onPassBlindRecorded(): BatchNotice | null {
    this.sinceLastNotice++;
    this.total++;
    if (this.sinceLastNotice < this.window) return null;
    return this.emit();
  }

  /**
   * Emit whatever is pending, even below the window. Call at shutdown so the
   * tail of suppressed events is never silently dropped. Returns null when there
   * is nothing pending.
   */
  flush(): BatchNotice | null {
    if (this.sinceLastNotice === 0) return null;
    return this.emit();
  }

  private emit(): BatchNotice {
    const notice: BatchNotice = {
      count: this.sinceLastNotice,
      totalSoFar: this.total,
      message:
        `${this.sinceLastNotice} PASS-BLIND action(s) since the last notice ` +
        `(${this.total} total this run). ${CHECK_THE_LINE}`,
    };
    this.sinceLastNotice = 0;
    if (this.sink !== null) this.sink(notice);
    return notice;
  }

  /** Suppressed-but-not-yet-notified count, exposed so a caller can see the tail. */
  get pending(): number {
    return this.sinceLastNotice;
  }

  get totalRecorded(): number {
    return this.total;
  }
}
