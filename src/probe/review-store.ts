// ── MICA · review STORE — the D-layer's trail, on disk, inter-process (S117) ──
//
// Build B, deliverable 2.2. The SIXTH adopter of `mica/store/append-store.ts`,
// and it edits that seam by not one byte.
//
// ── IT ADOPTS THE SEAM; IT DOES NOT RESTATE IT [LB] ──────────────────────────
//
//   `mica/store/append-store.ts` states both invariants once — the F2 ordering
//   and the S83 inter-process contract. Read that file's header. This one only
//   says what THIS store does differently, which is nothing about ordering and
//   everything about what a record is.
//
//   THE CONTRACT ADOPTED IS THE INTER-PROCESS ONE. `resync` is a function,
//   never null. A review trail has MORE reason to want it than the evidence log
//   did, not less: the reviewer seat, a reader, and whatever closes a case at
//   the end of a session are not guaranteed to be one process, and two of them
//   writing at one head forks a chain that then fails `verify()` for everyone
//   permanently.
//
// ── REUSE, NOT REBUILD [LB] ──────────────────────────────────────────────────
//
//   `prepare()` calls `review-log.ts`'s OWN `appendReviewState` /
//   `appendJournalEntry` / `appendSignature` over the chain AS IT STANDS AFTER
//   THE RE-SYNC. No hashing, no sequence arithmetic and — the one that matters
//   here — NO TRANSITION-LEGALITY RULE is re-implemented in this file. The
//   legality check runs against the disk-true chain because the pure function
//   runs inside the lock, which is the whole point of the re-sync: a second
//   process that closed a case between this store's load and this append makes
//   this append illegal, and it is refused rather than written.
//
//   The SHAPE of this file is `evidence-store.ts`'s, which took it from
//   `precommit/precommit.ts`'s `PrecommitBook`. Nothing is IMPORTED from
//   either: the sibling coupling bar holds verbatim.
//
// ── IT CREATES NO DIRECTORY, AND IT NAMES NO PATH ────────────────────────────
//
//   There is no default store path in this file and there must never be one.
//   The deploy recipe designates the review room in §5D · ACT (g), with
//   mica-arbiter:mica-readers ownership and mode 2750. The reviewer/runner
//   principal split is deferred in §5D.3. This module names no default path,
//   creates no directory, and refuses to open a log whose directory is absent.
//
// ── THIS MODULE CALLS NO CLOCK ───────────────────────────────────────────────

import { readFileSync, statSync } from "fs";
import type { Stats } from "fs";
import { dirname } from "path";

import { appendStoreTransaction, resyncAppendStore } from "../mica/store/append-store";
import type { AppendOutcome, LineAppender, LockAcquirer } from "../mica/store/append-store";
import {
  appendChainReview,
  appendJournalEntry,
  appendReviewState,
  appendSignature,
  chainReviewsIn,
  computeReviewLogRecordHash,
  currentStateOf,
  currentStates,
  journalIn,
  signaturesIn,
  validateReviewLogRecord,
  verifyReviewChain,
  type ChainReview,
  type ChainReviewRecord,
  type JournalLogRecord,
  type ReviewLog,
  type ReviewLogRecord,
  type ReviewStateRecord,
  type ReviewVerifyResult,
  type SignatureLogRecord,
} from "./review-log";
import type { ReviewJournalEntry, ReviewRecord, SignatureRecord } from "./review";

// ── the deployment act this file names and does not perform ──────────────────

export const THE_REVIEW_STORE_DEPLOYMENT_ACT =
  "The deploy recipe designates the D-review log directory in §5D · ACT (g): " +
  "owner mica-arbiter:mica-readers, mode 2750; one owner today, with the " +
  "reviewer/runner principal split deferred in §5D.3. This module names no " +
  "default path, creates nothing when the directory is absent, and refuses " +
  "to open a log whose directory is not already there.";

/** Its own deployment signpost (S97), citing the existing §5D · ACT (g). */
export class ReviewStoreDeploymentActMissing extends Error {
  constructor(
    message: string,
    readonly path: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "ReviewStoreDeploymentActMissing";
  }
}

function requireReviewStoreDir(dir: string): void {
  const signpost =
    `D-review log directory absent — see deploy recipe §5D · ACT (g). ` +
    `Expected: ${dir}, owner mica-arbiter:mica-readers, mode 2750. ` +
    `Nothing was created. ` +
    THE_REVIEW_STORE_DEPLOYMENT_ACT;
  let stats: Stats;
  try {
    stats = statSync(dir);
  } catch (err) {
    throw new ReviewStoreDeploymentActMissing(`${signpost} (${String(err)})`, dir, err);
  }
  if (!stats.isDirectory()) {
    throw new ReviewStoreDeploymentActMissing(
      `${signpost} That path exists and is not a directory.`,
      dir
    );
  }
}

/** Three answers, not two — the S98 discipline, same reasoning as the sibling. */
export type ReviewFileLook =
  | { readonly state: "PRESENT" }
  | { readonly state: "ABSENT" }
  | { readonly state: "CANNOT_SEE"; readonly detail: string };

export function lookAtReviewFile(path: string): ReviewFileLook {
  try {
    statSync(path);
    return { state: "PRESENT" };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { state: "ABSENT" };
    return { state: "CANNOT_SEE", detail: `${code ?? "no errno"}: ${String(err)}` };
  }
}

export function cannotSeeReviewMessage(path: string, detail: string): string {
  return (
    `the D-review log could not be looked at, which is NOT the finding that it ` +
    `is absent — this process cannot see ${path} (${detail}). Nothing was ` +
    `created and nothing was recorded as a first boot. A review trail that ` +
    `reads as empty because nobody could open it is "no dissent was recorded" ` +
    `read backwards: no journal, therefore no disagreement, therefore a clean ` +
    `review. ` +
    THE_REVIEW_STORE_DEPLOYMENT_ACT
  );
}

// ── the store ────────────────────────────────────────────────────────────────

/** The same four answers to "where did this chain come from" as every sibling. */
export type ReviewLoadState =
  | "IN_MEMORY"
  | "LOADED_VERIFIED"
  | "FIRST_BOOT_OR_ERASED"
  | "CANNOT_VERIFY";

export interface ReviewLogStoreOptions {
  /** Absent OR null means IN_MEMORY, never durable — both spellings. */
  readonly path?: string | null;
  /** Fault-injection seam. Production leaves this absent. */
  readonly appender?: LineAppender;
  /** The inter-process append lock. Production leaves this absent. */
  readonly acquire?: LockAcquirer;
}

export type ReviewAppendOutcome<R extends ReviewLogRecord> = AppendOutcome<R>;

/** The D-review trail with a disk under it. */
export class ReviewLogStore {
  private readonly chain: ReviewLogRecord[] = [];
  private readonly path: string | null;
  private readonly appender?: LineAppender;
  private readonly acquire?: LockAcquirer;
  private loadState: ReviewLoadState = "IN_MEMORY";
  private persisting = false;
  private lastError: string | null = null;

  constructor(options?: ReviewLogStoreOptions) {
    this.path = options?.path ?? null;
    this.appender = options?.appender;
    this.acquire = options?.acquire;
    if (this.path !== null) this.loadFromDisk();
  }

  private loadFromDisk(): void {
    const path = this.path as string;
    // THE PRECONDITION BEFORE THE LOG. Do not add a create-if-missing flag, and
    // do not add one under a test-only branch: a fence with a bypass is not a
    // fence. A caller that wants a store without a deployment act wants an
    // IN-MEMORY one, and gets it by injecting no path.
    requireReviewStoreDir(dirname(path));
    const look = lookAtReviewFile(path);
    if (look.state === "CANNOT_SEE") {
      this.loadState = "CANNOT_VERIFY";
      this.lastError = cannotSeeReviewMessage(path, look.detail);
      return;
    }
    if (look.state === "ABSENT") {
      this.loadState = "FIRST_BOOT_OR_ERASED";
      this.persisting = true;
      return;
    }

    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError = `cannot read D-review log: ${String(err)}`;
      return;
    }

    // The SAME line rule the re-sync uses. One rule, one count.
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    for (let i = 0; i < lines.length; i++) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(lines[i]);
      } catch (err) {
        this.loadState = "CANNOT_VERIFY";
        this.lastError = `malformed JSON at line ${String(i)}: ${String(err)}`;
        return;
      }
      if (!validateReviewLogRecord(parsed)) {
        // THE CONSISTENCY CHECK THAT LANDS HERE IS `review.ts`'s OWN. A CLOSED
        // record whose `finalHumanJudgment` disagrees with
        // `revisedJudgment ?? initialJudgment` is refused by
        // `validateReviewRecord`, which `validateReviewLogRecord` calls — this
        // store holds no copy of that arithmetic.
        this.loadState = "CANNOT_VERIFY";
        this.lastError =
          `record at line ${String(i)} does not match the closed review-log schema ` +
          `(shape, or a payload its own validator refused)`;
        return;
      }
      this.chain.push(parsed);
    }

    const verification = verifyReviewChain(this.chain);
    if (!verification.valid) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError = `D-review chain verification failed at index ${String(verification.brokenAt)}`;
      return;
    }
    this.loadState = this.chain.length === 0 ? "FIRST_BOOT_OR_ERASED" : "LOADED_VERIFIED";
    this.persisting = true;
  }

  private resyncUnderLock(): string | null {
    const result = resyncAppendStore<ReviewLogRecord>({
      path: this.path as string,
      known: this.chain,
      validate: (parsed) => (validateReviewLogRecord(parsed) ? parsed : null),
      recomputeHash: (record) => computeReviewLogRecordHash(record),
    });
    if (!result.linked) return result.detail;
    for (const record of result.extension) this.chain.push(record);
    return null;
  }

  /**
   * The one place this store calls the seam. `derive` runs INSIDE `prepare`,
   * under the lock and after the re-sync — so the legality of a transition is
   * decided against the chain as it stands ON DISK, not as this process loaded
   * it.
   */
  private transact<R extends ReviewLogRecord>(label: string, derive: () => R): AppendOutcome<R> {
    return appendStoreTransaction<R>({
      path: this.path,
      persisting: this.persisting,
      lastError: this.lastError,
      storeLabel: "D-review log",
      prepare: () => {
        // A `ReviewLogRefused` from the pure log — an illegal transition, a
        // malformed payload — throws from HERE and propagates out with the lock
        // released and nothing appended. That is correct and it is not a
        // persistence failure: it is a statement the trail has no shape to hold.
        const record = derive();
        return {
          record,
          line: JSON.stringify(record) + "\n",
          commit: () => {
            this.chain.push(record);
          },
        };
      },
      resync: () => this.resyncUnderLock(),
      appender: this.appender,
      acquire: this.acquire,
      memoryDetail:
        `no D-review log path was injected: this ${label} is IN MEMORY only and ` +
        "does not survive the process. It carries integrity but not provenance, " +
        "and a judgment nobody can read afterwards is not a reviewed case.",
      notPersistingDetail:
        `the D-review log is not in a persisting state; the ${label} was not ` +
        "written to disk.",
      onAppendBlocked: (detail) => {
        this.lastError = detail;
        return detail;
      },
      onAppendError: (raw) => {
        this.lastError = `cannot append to D-review log: ${raw}`;
        return this.lastError;
      },
    });
  }

  /** One transition, refused unless `review.ts` itself would have produced it. */
  appendState(record: ReviewRecord, timestamp: number): ReviewAppendOutcome<ReviewStateRecord> {
    return this.transact<ReviewStateRecord>("transition", () => {
      const log = appendReviewState(this.chain, record, timestamp);
      return log[log.length - 1] as ReviewStateRecord;
    });
  }

  appendJournal(
    entry: ReviewJournalEntry,
    timestamp: number
  ): ReviewAppendOutcome<JournalLogRecord> {
    return this.transact<JournalLogRecord>("journal entry", () => {
      const log = appendJournalEntry(this.chain, entry, timestamp);
      return log[log.length - 1] as JournalLogRecord;
    });
  }

  appendSignatureRecord(
    signature: SignatureRecord,
    timestamp: number
  ): ReviewAppendOutcome<SignatureLogRecord> {
    return this.transact<SignatureLogRecord>("signature", () => {
      const log = appendSignature(this.chain, signature, timestamp);
      return log[log.length - 1] as SignatureLogRecord;
    });
  }

  /**
   * One seat's opening of one chain file (S132). Same seam, same lock, same
   * chain as every other kind — this store learned no new way to write.
   */
  appendChainReviewRecord(
    review: ChainReview,
    timestamp: number
  ): ReviewAppendOutcome<ChainReviewRecord> {
    return this.transact<ChainReviewRecord>("chain review", () => {
      const log = appendChainReview(this.chain, review, timestamp);
      return log[log.length - 1] as ChainReviewRecord;
    });
  }

  /** The chain every consumer reads from. Never a parallel array. */
  records(): ReviewLog {
    return this.chain;
  }

  verify(): ReviewVerifyResult {
    return verifyReviewChain(this.chain);
  }

  getLoadState(): ReviewLoadState {
    return this.loadState;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  get length(): number {
    return this.chain.length;
  }

  get hasDeclaredPath(): boolean {
    return this.path !== null;
  }

  /** Derived ONCE, here, because every consumer wants it. */
  currentStateOf(scenarioId: string): ReviewRecord | null {
    return currentStateOf(this.chain, scenarioId);
  }

  currentStates(): readonly ReviewRecord[] {
    return currentStates(this.chain);
  }
}

// ── the store-aware read — A's 2.1 pattern, same reasoning ───────────────────
//
//   The reader of a review trail needs exactly what the reader of an evidence
//   chain needed: a refusal it cannot forget to make, and provenance it cannot
//   hold a result without. Same shape, its own signpost.

export class ReviewStoreNotReadable extends Error {
  constructor(
    message: string,
    readonly loadState: ReviewLoadState,
    readonly lastError: string | null
  ) {
    super(message);
    this.name = "ReviewStoreNotReadable";
  }
}

export const IN_MEMORY_REVIEW_IS_NOT_READABLE =
  "refused to read: this review store is IN MEMORY. No log path was injected, " +
  "so the trail it holds has integrity and no provenance — nothing on disk says " +
  "these judgments were ever made. " +
  THE_REVIEW_STORE_DEPLOYMENT_ACT;

export function cannotVerifyReviewIsNotReadableMessage(lastError: string | null): string {
  return (
    "refused to read: this review store is in CANNOT_VERIFY. What it was pointed " +
    "at could not be established as this trail's own, so the entries it is " +
    "holding are not a record of anything — they are what one process managed to " +
    "read. Rendering them would show judgments and signatures that look exactly " +
    "like judgments and signatures from a verified trail. The store's last " +
    "error, verbatim: " +
    (lastError ?? "(none recorded — which is itself a finding)")
  );
}

/** Everything a reading surface needs, with its provenance in the same object. */
export interface ReadReviewStoreResult {
  readonly states: readonly ReviewRecord[];
  readonly journal: readonly ReviewJournalEntry[];
  readonly signatures: readonly SignatureRecord[];
  /** S132 — in chain order, never de-duplicated. See `appendChainReview`. */
  readonly chainReviews: readonly ChainReview[];
  readonly loadState: ReviewLoadState;
  readonly hasDeclaredPath: boolean;
}

/**
 * @throws ReviewStoreNotReadable when the load state is `IN_MEMORY` or
 *   `CANNOT_VERIFY`. `FIRST_BOOT_OR_ERASED` is NOT a refusal: a review log that
 *   exists and is empty is the honest state of a probe run nobody has reviewed
 *   yet, and it is exactly what an operator most needs to be able to see.
 */
export function readReviewStore(store: ReviewLogStore): ReadReviewStoreResult {
  const loadState = store.getLoadState();
  if (loadState === "IN_MEMORY") {
    throw new ReviewStoreNotReadable(
      IN_MEMORY_REVIEW_IS_NOT_READABLE,
      loadState,
      store.getLastError()
    );
  }
  if (loadState === "CANNOT_VERIFY") {
    const lastError = store.getLastError();
    throw new ReviewStoreNotReadable(
      cannotVerifyReviewIsNotReadableMessage(lastError),
      loadState,
      lastError
    );
  }
  const chain = store.records();
  return {
    states: store.currentStates(),
    journal: journalIn(chain),
    signatures: signaturesIn(chain),
    chainReviews: chainReviewsIn(chain),
    loadState,
    hasDeclaredPath: store.hasDeclaredPath,
  };
}
