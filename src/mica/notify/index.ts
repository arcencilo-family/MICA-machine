// ── MICA · notice sinks — the fan-out, the census, and the composed path ─────
//
// One raising -> BOTH, always, as one act:
//
//   (1) every configured human channel gets its own attempt, and
//   (2) notify's own chained book gets one record carrying the envelope AND all
//       of those sibling attempts, so the trail answers WHAT WAS RAISED and WHAT
//       WAS TRIED at bytes.
//
// ORDERING, AND WHY IT IS NOT AN ORDERING OF PEOPLE
//
//   Human channels are attempted FIRST and the book record is written LAST,
//   because the record carries the attempts. That is a data dependency, not a
//   priority: within the human channels there is no order, no delay, and no
//   condition — the roster is walked, every entry is attempted, and a throw from
//   one cannot stop another. The fan-out NEVER short-circuits.
//
//   If the book write or the head commit fails, that outcome rides in the
//   RETURNED attempts and is printed. It cannot be witnessed — the book is what
//   witnesses — so it has to be loud instead.
//
// THE MAXIMUM IS: ATTEMPT, AND RECORD THE ATTEMPT. Never "they know."

import {
  CENSUS_HAS_NO_CONSUMER_YET,
  CENSUS_IS_NOT_A_VERDICT,
  NOTIFY_SCOPE_LINES,
  PLACEHOLDER_ADDRESSES,
  PLACEHOLDER_ROSTER,
  TOTAL_BLINDNESS_LINE,
} from "./types";
import type {
  DeliveryAttempt,
  NoticeEnvelope,
  NotifyConfigCensus,
  RecipientEntry,
  Roster,
  Transport,
} from "./types";
import { NoticeLog, noticeLogInput } from "./notice-log";
import type { NoticeLogRecord } from "./notice-log";

export * from "./types";
export * from "./notice-log";

/** The book's sink id, used in every attempt it produces. */
export const NOTICE_LOG_SINK_ID = "notice-log";

/** The head-commit sink id. Reported separately: a book write can land while the
 *  commit does not, and collapsing them would hide exactly that case. */
export const HEAD_COMMIT_SINK_ID = "witness-head-commit";

/** One human channel's sink id, derived from its role. */
export function channelSinkId(entry: RecipientEntry): string {
  return `channel:${entry.role}`;
}

// ── the adapter ──────────────────────────────────────────────────────────────

/**
 * Adapt the shipped `BatchNotice` into the envelope the fan-out carries.
 *
 * `BatchNotice` is NOT redesigned: it is pinned machinery and this build does
 * not touch it. Its structured counts are preserved as their own lines rather
 * than reformatted, so nothing is lost in translation and nothing is invented.
 *
 * The parameter is structurally typed rather than imported as a nominal type so
 * this module stays usable by any caller holding that shape. The three fields
 * are exactly `BatchNotice`'s.
 */
export function envelopeFromBatchNotice(
  notice: { readonly count: number; readonly totalSoFar: number; readonly message: string },
  sequence: number
): NoticeEnvelope {
  return {
    sourceId: "MICA/chokepoint/pass-blind-notifier",
    kind: "PASS_BLIND_BATCH",
    lines: [
      `count=${String(notice.count)}`,
      `totalSoFar=${String(notice.totalSoFar)}`,
      notice.message,
    ],
    sequence,
  };
}

// ── the roster ───────────────────────────────────────────────────────────────

/**
 * True when this address is still one MICA shipped. A shipped placeholder is NOT
 * a configured channel: it is guaranteed unusable, and treating it as configured
 * would turn "nobody wired this up" into an ordinary FAILED that reads like bad
 * luck rather than an undeployed tool.
 */
export function isPlaceholderAddress(address: string): boolean {
  return PLACEHOLDER_ADDRESSES.includes(address);
}

export interface NoticeSinksOptions {
  /** The declared roster. Absent -> the shipped placeholders, all unusable. */
  readonly roster?: Roster;
  /** The deployer's wire. Absent -> every channel attempt is NOT_CONFIGURED. */
  readonly transport?: Transport;
  /** The book. Absent -> one is constructed IN_MEMORY, which the census states. */
  readonly noticeLog?: NoticeLog;
}

// ── the fan-out ──────────────────────────────────────────────────────────────

export interface RaiseResult {
  readonly envelope: NoticeEnvelope;
  readonly attempts: readonly DeliveryAttempt[];
  /** The book record, when one was constructed. Null only if the book threw. */
  readonly record: NoticeLogRecord | null;
}

export class NoticeSinks {
  private readonly roster: Roster;
  private readonly transport?: Transport;
  private readonly log: NoticeLog;

  constructor(options?: NoticeSinksOptions) {
    this.roster = options?.roster ?? PLACEHOLDER_ROSTER;
    this.transport = options?.transport;
    this.log = options?.noticeLog ?? new NoticeLog();
  }

  /**
   * Run EVERY sink and return EVERY attempt.
   *
   * Never short-circuits: each human channel is attempted inside its own
   * try/catch, so a transport that throws for one role cannot prevent the next
   * role's attempt, and cannot prevent the book record that carries them all.
   */
  raise(envelope: NoticeEnvelope): RaiseResult {
    const attempts: DeliveryAttempt[] = [];

    for (const entry of this.roster) {
      attempts.push(this.attemptChannel(entry, envelope));
    }

    const outcome = this.log.record(noticeLogInput(envelope, attempts));

    attempts.push({
      sinkId: NOTICE_LOG_SINK_ID,
      role: null,
      outcome: outcome.persisted
        ? "ATTEMPTED"
        : this.log.hasDeclaredPath
          ? "FAILED"
          : "NOT_CONFIGURED",
      detail:
        outcome.detail ??
        `recorded at seq ${String(outcome.record.sequenceNumber)}, ` +
          `hash ${outcome.record.hash}`,
    });

    attempts.push({
      sinkId: HEAD_COMMIT_SINK_ID,
      role: null,
      outcome: !this.log.hasHeadCommitter
        ? "NOT_CONFIGURED"
        : outcome.headCommitted
          ? "ATTEMPTED"
          : "FAILED",
      detail: !this.log.hasHeadCommitter
        ? "no head committer was injected: this book's head is committed nowhere, " +
          "so rewriting it is not loud anywhere"
        : (outcome.headCommitDetail ??
          `head committed at seq ${String(outcome.record.sequenceNumber)}`),
    });

    return { envelope, attempts, record: outcome.record };
  }

  private attemptChannel(
    entry: RecipientEntry,
    envelope: NoticeEnvelope
  ): DeliveryAttempt {
    const sinkId = channelSinkId(entry);
    if (this.transport === undefined) {
      return {
        sinkId,
        role: entry.role,
        outcome: "NOT_CONFIGURED",
        detail:
          "no transport was injected: MICA ships no wire, and nothing under src/ " +
          "opens a network connection",
      };
    }
    if (isPlaceholderAddress(entry.address)) {
      return {
        sinkId,
        role: entry.role,
        outcome: "NOT_CONFIGURED",
        detail:
          `the address is still the placeholder MICA shipped (${entry.address}); ` +
          "a placeholder is not a configured channel",
      };
    }
    try {
      const outcome = this.transport(entry.address, envelope);
      return {
        sinkId,
        role: entry.role,
        outcome: "ATTEMPTED",
        detail: `transport acceptance: ${outcome.detail}`,
      };
    } catch (err) {
      return {
        sinkId,
        role: entry.role,
        outcome: "FAILED",
        detail: `transport threw: ${String(err)}`,
      };
    }
  }

  /** Counts and states only. See CENSUS_IS_NOT_A_VERDICT. */
  census(): NotifyConfigCensus {
    let placeholders = 0;
    for (const entry of this.roster) {
      if (isPlaceholderAddress(entry.address)) placeholders++;
    }
    return {
      rosterRoles: this.roster.length,
      placeholderAddresses: placeholders,
      transportInjected: this.transport !== undefined,
      noticeLog: this.log.hasDeclaredPath ? "DECLARED_PATH" : "IN_MEMORY",
      witnessHeadCommit: this.log.hasHeadCommitter ? "DECLARED" : "NOT_DECLARED",
      declaredModality: this.log.declaredModality,
    };
  }

  getRoster(): Roster {
    return this.roster.map((entry) => ({ ...entry }));
  }

  getNoticeLog(): NoticeLog {
    return this.log;
  }
}

// ── rendering ────────────────────────────────────────────────────────────────

/** True when NOT ONE sink in this result was configured. The maximal blindness. */
export function reachedNoConfiguredSink(
  attempts: readonly DeliveryAttempt[]
): boolean {
  return attempts.every((attempt) => attempt.outcome === "NOT_CONFIGURED");
}

/** The census, rendered. Counts and states, then the two ceilings that bound it. */
export function renderCensus(census: NotifyConfigCensus): string {
  const out: string[] = [];
  out.push("[MICA/notify] CONFIGURATION CENSUS");
  out.push(`  rosterRoles=${String(census.rosterRoles)}`);
  out.push(`  placeholderAddresses=${String(census.placeholderAddresses)}`);
  out.push(`  transportInjected=${String(census.transportInjected)}`);
  out.push(`  noticeLog=${census.noticeLog}`);
  out.push(`  witnessHeadCommit=${census.witnessHeadCommit}`);
  // The VALUE, not merely that one exists. "A modality was declared" is the kind
  // of sentence a census exists to refuse: the reader wants to know WHICH.
  out.push(`  declaredModality=${census.declaredModality}`);
  out.push("");
  out.push(`  ${CENSUS_IS_NOT_A_VERDICT}`);
  out.push(`  ${CENSUS_HAS_NO_CONSUMER_YET}`);
  return out.join("\n");
}

/**
 * One raising, rendered. Every attempt gets its own line — including, and
 * especially, the NOT_CONFIGURED ones. An unconfigured channel is PRINTED as
 * unconfigured; it is never a silent skip.
 */
export function renderRaise(result: RaiseResult): string {
  const out: string[] = [];
  out.push(
    `[MICA/notify] RAISED: ${result.envelope.kind} ` +
      `from ${result.envelope.sourceId} (sequence ${String(result.envelope.sequence)})`
  );
  for (const line of result.envelope.lines) out.push(`  · ${line}`);
  out.push("  ATTEMPTS:");
  for (const attempt of result.attempts) {
    const who = attempt.role === null ? attempt.sinkId : `${attempt.sinkId}`;
    out.push(`    · ${who}: ${attempt.outcome} — ${attempt.detail}`);
  }
  if (reachedNoConfiguredSink(result.attempts)) {
    out.push("");
    out.push(`  ${TOTAL_BLINDNESS_LINE}`);
  }
  out.push("");
  out.push("  WHAT THIS RAISING DOES NOT CLAIM:");
  for (const line of NOTIFY_SCOPE_LINES) out.push(`    ${line}`);
  return out.join("\n");
}

// ── the composed path (R8: the notifier's absent-sink hole) ──────────────────
//
// `BatchedNotifier` with no sink computes notices and hands them nowhere,
// silently. Both of those files are pinned (protected-inventory rows 6 and 8),
// so this is closed BY CONSTRUCTION instead of by an edit: the composer owns the
// options object, and the sink it installs is never absent.
//
// THE HONEST LIMIT, STATED RATHER THAN SMOOTHED: this closes the hole only for
// callers who compose. A caller who writes `new BatchedNotifier()` directly is
// invisible to this and always will be without editing a pinned file. Two such
// constructions exist today, both inside the pinned chokepoint.test.ts
// (`new BatchedNotifier()` and `new BatchedNotifier({ window: 1 })`). They are
// correct for what they test; they are simply not on the composed path.

/**
 * The options shape `BatchedNotifier` accepts. Declared structurally rather than
 * imported, so this module takes no import edge into the chokepoint at all — the
 * composer hands a plain object to a constructor it never references.
 */
export interface ComposedNotifierOptions {
  readonly window?: number;
  readonly sink: (notice: {
    readonly count: number;
    readonly totalSoFar: number;
    readonly message: string;
  }) => void;
}

/**
 * Wraps a `NoticeSinks` into notifier options whose sink is ALWAYS present, and
 * keeps every raising it produced so the caller can render them.
 *
 * The envelope sequence is `this.results.length` — the record's own index in
 * this composer's run. Same idiom as `floor-trail.ts`'s
 * `const sequenceNumber = this.chain.length` and `witness.ts`'s
 * `const seq = this.records.length`, and for the same reason: a deterministic
 * count, never a self-authored clock.
 */
export class ComposedNotifier {
  private readonly results: RaiseResult[] = [];

  constructor(
    private readonly sinks: NoticeSinks,
    private readonly window?: number
  ) {}

  /** Hand this straight to `new BatchedNotifier(...)`. The sink is never absent. */
  get options(): ComposedNotifierOptions {
    return {
      ...(this.window === undefined ? {} : { window: this.window }),
      sink: (notice) => {
        this.results.push(
          this.sinks.raise(envelopeFromBatchNotice(notice, this.results.length))
        );
      },
    };
  }

  get raised(): readonly RaiseResult[] {
    return this.results;
  }

  /**
   * The block a caller appends after `renderDisposition(...)`. On the composed
   * path sinklessness is a PRINTED NOT_CONFIGURED line, never an absence — which
   * is the whole difference this build makes to the existing hole.
   */
  render(): string {
    const out: string[] = [renderCensus(this.sinks.census()), ""];
    if (this.results.length === 0) {
      out.push(
        "[MICA/notify] NO NOTICE HAS BEEN RAISED THROUGH THIS COMPOSER. That is " +
          "a count of raisings, not a statement that none occurred elsewhere — " +
          "the census above says whether anything was configured to carry one."
      );
      return out.join("\n");
    }
    for (const result of this.results) out.push(renderRaise(result), "");
    return out.join("\n").replace(/\n+$/, "");
  }
}

/** Compose a `NoticeSinks` into a notifier whose sink cannot be absent. */
export function composeNoticeSinks(
  sinks: NoticeSinks,
  options?: { readonly window?: number }
): ComposedNotifier {
  return new ComposedNotifier(sinks, options?.window);
}
