// ── MICA · probe evidence STORE — the log, on disk, inter-process (S116) ──────
//
// Deliverable 1.4's second half. `evidence-log.ts` holds the FORMAT and the
// pure array-in/array-out operations; this file holds the STORE — a loaded
// chain, a real path, and the ONE append seam. The split is deliberate: the
// pure functions stay pure and byte-testable, and everything that touches a
// disk lives here where the load-state discipline can be read in one place.
//
// ── IT ADOPTS THE SEAM; IT DOES NOT RESTATE IT [LB] ──────────────────────────
//
//   `mica/store/append-store.ts` states BOTH invariants once — the F2 ordering
//   (validate -> append durably -> only THEN commit live state) and the S83
//   inter-process contract (lock -> re-sync from disk -> derive from the
//   disk-true head -> append -> commit -> release, always). They are not
//   restated here, because a second statement is a second thing to drift. Read
//   that file's header; this one only says what THIS store does differently,
//   which is nothing about ordering and everything about what a record is.
//
//   THE CONTRACT ADOPTED IS THE INTER-PROCESS ONE (ruled S116). `resync` is a
//   function, never null. `RESYNC_NULL_IS_A_DECLARATION` — "this store has NOT
//   adopted the inter-process append contract... two concurrent writers will
//   fork its chain" — is the road NOT taken, and it is named here so that a
//   later reader can see it was a choice. A probe run is not guaranteed to be
//   a single process: a delivery harness, a re-grade and an operator's read
//   can all be live at once, and a forked evidence chain fails `verify()`
//   permanently for every one of them.
//
// ── REUSE, NOT REBUILD [LB] ──────────────────────────────────────────────────
//
//   `prepare()` calls `evidence-log.ts`'s OWN `appendAttempt`/`appendOutcome`
//   over the store's chain AS IT STANDS AFTER THE RE-SYNC. No hashing, no
//   sequence arithmetic and no refusal rule is re-implemented here: the
//   sequence number this store writes is the one the pure function derives
//   from the disk-true head, which is the whole point of the re-sync (see the
//   seam's header: "THE LOCK ALONE WOULD NOT FIX IT").
//
//   The SHAPE of this file — options, load states, the three-valued look, the
//   deployment-act precondition — is copied from `precommit/precommit.ts`'s
//   `PrecommitBook`, the reference adoption. Nothing is IMPORTED from it: the
//   sibling coupling bar holds here verbatim, one book's evolution must not
//   rewrite a sibling's evidence format.
//
// ── IT CREATES NO DIRECTORY, AND IT NAMES NO PATH ────────────────────────────
//
//   There is no default store path in this file and there must never be one.
//   Where a probe evidence log lives, who owns it and which principals may
//   read it is a DEPLOYMENT ACT that has NOT been ruled — S116's brief puts it
//   out of scope explicitly and hands it to the arbiter. So this module names
//   no path, creates nothing, and refuses to open a log whose directory is not
//   already there. A store with no injected path is IN MEMORY and says so.
//
// ── THIS MODULE CALLS NO CLOCK ───────────────────────────────────────────────
//
//   `timestamp` is INJECTED on every append, exactly as it is in the pure log.
//   A `Date.now()` in here would be the store quietly testifying about when a
//   subject was reached.

import { readFileSync, statSync } from "fs";
import type { Stats } from "fs";
import { dirname } from "path";

import {
  appendStoreTransaction,
  resyncAppendStore,
} from "../mica/store/append-store";
import type {
  AppendOutcome,
  LineAppender,
  LockAcquirer,
} from "../mica/store/append-store";
import {
  EVIDENCE_DOMAIN_TAG,
  appendAttempt,
  appendOutcome,
  computeEvidenceRecordHash,
  gradeFromLog,
  recognizeSupersededChainTag,
  validateEvidenceRecord,
  recognizeSupersededChainByRederivation,
  verifyEvidenceChain,
  type AttemptAppendInput,
  type AttemptRecord,
  type DeclaredCaptureProvenance,
  type EvidenceLog,
  type EvidenceRecord,
  type EvidenceVerifyResult,
  type GradeFromLogResult,
  type OutcomeRecord,
} from "./evidence-log";
import type { ObservableChecks } from "./scenario";

// ── the deployment act this file names and does not perform ──────────────────

export const THE_EVIDENCE_STORE_LOCATION_IS_UNDESIGNATED =
  "The deploy recipe has NO section for a probe evidence log. Its location, " +
  "its owning principal and which roles may read it are an undesignated " +
  "deployment act — S116 put it out of scope and owed it to the arbiter. " +
  "This module therefore names no path, creates nothing, and refuses to open " +
  "a log whose directory is not already there. Wiring one is the arbiter's " +
  "call, and it is owed.";

/**
 * A deployment act that was never performed. Its own class, not the
 * pre-commitment book's — one signpost per seam (S97). Like that seam's, it
 * cites no recipe section, because none exists: a fabricated citation would
 * hide the finding that the act is undesignated.
 */
export class EvidenceStoreDeploymentActMissing extends Error {
  constructor(
    message: string,
    readonly path: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "EvidenceStoreDeploymentActMissing";
  }
}

function requireEvidenceStoreDir(dir: string): void {
  const signpost =
    `probe evidence log directory absent — this is a deployment act and it has ` +
    `no recipe section yet. Expected: ${dir}, owned and permissioned by whoever ` +
    `the arbiter rules owns a probe evidence log. Nothing was created. ` +
    THE_EVIDENCE_STORE_LOCATION_IS_UNDESIGNATED;
  let stats: Stats;
  try {
    stats = statSync(dir);
  } catch (err) {
    throw new EvidenceStoreDeploymentActMissing(
      `${signpost} (${String(err)})`,
      dir,
      err
    );
  }
  if (!stats.isDirectory()) {
    throw new EvidenceStoreDeploymentActMissing(
      `${signpost} That path exists and is not a directory.`,
      dir
    );
  }
}

/**
 * WHAT A LOOK AT THE LOG FILE FOUND — three answers, not two (S98, item 3,
 * carried here deliberately rather than re-derived). `existsSync` answers a
 * two-valued question over a three-valued world: FALSE both for "there is no
 * such file" and for "I was not allowed to look". For an EVIDENCE log the
 * second reading is the dangerous one: a run that cannot see the log would
 * declare first boot, append from sequence 0, and fork a chain full of
 * attempts it merely could not read.
 *
 * CANNOT_SEE loads to CANNOT_VERIFY and does not throw, for the reason the
 * deployment-act check does throw: an absent DIRECTORY is a missing
 * precondition with no log to report on; an unreadable FILE is a fact about
 * the log, and reporting it is this store's job.
 */
export type EvidenceFileLook =
  | { readonly state: "PRESENT" }
  | { readonly state: "ABSENT" }
  | { readonly state: "CANNOT_SEE"; readonly detail: string };

export function lookAtEvidenceFile(path: string): EvidenceFileLook {
  try {
    statSync(path);
    return { state: "PRESENT" };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOENT is the ONLY errno that means the log is not there.
    if (code === "ENOENT") return { state: "ABSENT" };
    return { state: "CANNOT_SEE", detail: `${code ?? "no errno"}: ${String(err)}` };
  }
}

/** The signpost a principal who cannot see the log is handed. */
export function cannotSeeEvidenceMessage(path: string, detail: string): string {
  return (
    `the probe evidence log could not be looked at, which is NOT the finding ` +
    `that it is absent — this process cannot see ${path} (${detail}). Nothing ` +
    `was created, nothing was recorded as a first boot, and this store is NOT ` +
    `in a persisting state. An empty evidence log from a file nobody could ` +
    `read would be "attempted, never notified" read backwards: no attempts, ` +
    `therefore nothing to answer for. ` +
    THE_EVIDENCE_STORE_LOCATION_IS_UNDESIGNATED
  );
}

/**
 * THE SIGNPOST FOR A CHAIN OLDER THAN THE READER (S125).
 *
 * Its own message, beside `cannotSeeEvidenceMessage`, for the same reason that
 * one exists: `existsSync` answered a three-valued question with two values,
 * and `does not match the closed evidence schema` answers a three-valued one
 * the same way. MALFORMED, TAMPERED and WRITTEN-UNDER-A-SUPERSEDED-PREIMAGE are
 * three findings, and the third is the only one that is nobody's fault and
 * costs nothing to the record it came from.
 *
 * It states the OBSERVATION before the conclusion — which keys were seen, then
 * what that makes the file — because the tag is inferred from a shape and not
 * read from a field, and a reader that hid that step would be broadcasting a
 * fact it did not test.
 */
export function supersededPreimageMessage(
  path: string,
  line: number,
  chainTag: string,
  readerTag: string
): string {
  return (
    `the probe evidence log at ${path} was written under a SUPERSEDED preimage. ` +
    `The provenance block at line ${String(line)} carries exactly the ${chainTag} ` +
    `key set and no \`deliverySeat\`, which is the shape a ${chainTag} ATTEMPT ` +
    `has and a ${readerTag} one cannot. This is NOT the finding that the log is ` +
    `malformed, and NOT the finding that it was tampered with: it is intact and ` +
    `older than this reader. Nothing was loaded from it, nothing was re-hashed ` +
    `under either tag, and no verdict was minted from it. The read that was ` +
    `ratified for this chain stands where it was ratified; history is not ` +
    `rebuilt by re-deriving it here. ` +
    THE_EVIDENCE_STORE_LOCATION_IS_UNDESIGNATED
  );
}

/**
 * THE SAME FINDING, ARRIVED AT BY A DIFFERENT ROUTE, AND THE ROUTE IS THE PART
 * AN OPERATOR HAS TO BE ABLE TO CHECK (S132).
 *
 * `supersededPreimageMessage` above names a SHAPE it saw. This one names an
 * ARITHMETIC it ran, and it must not borrow the other's sentence: "carries
 * exactly the v3 key set" would be false here, and a refusal that describes
 * evidence it did not have is the defect both messages exist to prevent.
 */
export function supersededByRederivationMessage(
  path: string,
  records: number,
  chainTag: string,
  readerTag: string
): string {
  return (
    `the probe evidence log at ${path} was written under a SUPERSEDED preimage. ` +
    `All ${String(records)} record(s) re-derive under ${chainTag} and link under ` +
    `those hashes, and none re-derives under ${readerTag}. That is a PROOF these ` +
    `bytes were hashed under ${chainTag}, not an inference from their shape — a ` +
    `${chainTag} record is on-schema here and carries no marker to read. This is ` +
    `NOT the finding that the log is malformed, and NOT the finding that it was ` +
    `tampered with: it is intact and older than this reader. A chain that failed ` +
    `BOTH tags stays a BREAK and is reported as one. Nothing was loaded from it — ` +
    `the records this store read were DISCARDED when this was recognized — nothing ` +
    `was graded, and no verdict and no CANNOT_ASSESS was minted. The read that was ` +
    `ratified for this chain stands where it was ratified; history is not rebuilt ` +
    `by re-deriving it here. ` +
    THE_EVIDENCE_STORE_LOCATION_IS_UNDESIGNATED
  );
}

// ── the store ────────────────────────────────────────────────────────────────

/**
 * THE FOUR ANSWERS TO "WHERE DID THIS CHAIN COME FROM", the same four the
 * pre-commitment book gives. `IN_MEMORY` is not a failure and not a
 * degradation of the other three: it is integrity without provenance, and the
 * store says so on its face rather than looking like a log that happens to be
 * empty.
 */
export type EvidenceLoadState =
  | "IN_MEMORY"
  | "LOADED_VERIFIED"
  | "FIRST_BOOT_OR_ERASED"
  | "CANNOT_VERIFY";

export interface EvidenceLogStoreOptions {
  /**
   * Injected deployment path. Absent OR null means IN_MEMORY, never durable —
   * both spellings, because `null` is what a caller threading an optional path
   * through actually holds, and silently treating it as "no option given" is
   * the shape that hides a missing deployment act.
   */
  readonly path?: string | null;
  /** Fault-injection seam. Production leaves this absent. */
  readonly appender?: LineAppender;
  /**
   * The inter-process append lock. Production leaves this absent and gets
   * `exclusiveFileLock`. A deployment that needs a bounded retry injects it
   * HERE — this store holds no timing policy of its own.
   */
  readonly acquire?: LockAcquirer;
}

/** What an outcome append must cite, returned so a caller need not re-derive it. */
export interface AttemptAppendOutcome extends AppendOutcome<AttemptRecord> {
  /**
   * The `ref` an OUTCOME must carry. It is the attempt's own sequence number,
   * and it is MEANINGLESS unless `committed` is true: on a failure path this
   * is the number the record WOULD have taken, and citing it would name a
   * record that is not in the chain.
   */
  readonly ref: number;
}

export type OutcomeAppendOutcome = AppendOutcome<OutcomeRecord>;

/**
 * S120: `declared` rides through UNTOUCHED, exactly as `observables` does. This
 * store adds nothing to it, defaults nothing in it and reads nothing out of it
 * — the pure `appendOutcome` below places it in the record and the preimage.
 */
export type OutcomeAppendInput =
  | {
      readonly ref: number;
      readonly outcome: "CAPTURED";
      readonly observables: ObservableChecks;
      readonly declared?: DeclaredCaptureProvenance;
    }
  | { readonly ref: number; readonly outcome: "NO_CAPTURE" | "REFUSED"; readonly detail: string };

/**
 * The probe evidence log with a disk under it.
 *
 * Grading reads FROM `records()` — the store's own loaded-and-extended chain —
 * never from a parallel array a caller kept alongside. That is the same
 * sentence `evidence-log.ts` already makes about `gradeFromLog`, held one
 * layer further out: the chain is the boundary of truth, and after S116 the
 * chain is the one on disk.
 */
export class EvidenceLogStore {
  private readonly chain: EvidenceRecord[] = [];
  private readonly path: string | null;
  private readonly appender?: LineAppender;
  private readonly acquire?: LockAcquirer;
  private loadState: EvidenceLoadState = "IN_MEMORY";
  private persisting = false;
  private lastError: string | null = null;
  /** Set ONLY beside a CANNOT_VERIFY this load raised. Never on a loaded store. */
  private supersededChainTag: string | null = null;

  constructor(options?: EvidenceLogStoreOptions) {
    this.path = options?.path ?? null;
    this.appender = options?.appender;
    this.acquire = options?.acquire;
    if (this.path !== null) this.loadFromDisk();
  }

  private loadFromDisk(): void {
    const path = this.path as string;
    // THE PRECONDITION BEFORE THE LOG. Verified first and thrown out of the
    // constructor: a store whose deployment act was never performed does not
    // come up at all, because a half-made evidence log is worse than none —
    // somebody grades from it.
    //
    // **Do not add a create-if-missing flag here**, and do not add one under a
    // test-only branch: a fence with a bypass is not a fence. A caller that
    // wants a store without a deployment act wants an IN-MEMORY one, and gets
    // it by injecting no path.
    requireEvidenceStoreDir(dirname(path));
    const look = lookAtEvidenceFile(path);
    if (look.state === "CANNOT_SEE") {
      // NOT FIRST BOOT. See `lookAtEvidenceFile`.
      this.loadState = "CANNOT_VERIFY";
      this.lastError = cannotSeeEvidenceMessage(path, look.detail);
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
      this.lastError = `cannot read probe evidence log: ${String(err)}`;
      return;
    }

    // THE SAME LINE RULE THE RE-SYNC USES, deliberately: `resyncAppendStore`
    // splits on /\r?\n/ and compares its line count against `known.length`. A
    // loader that split on "\n" alone would count a CRLF file's lines the same
    // way here but hand the re-sync a `known` prefix derived under a different
    // rule, and the two counts are compared for truncation. One rule, one count.
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
      if (!validateEvidenceRecord(parsed)) {
        this.loadState = "CANNOT_VERIFY";
        // SAME REFUSAL, DIFFERENT SENTENCE. The record is off-schema either way
        // and `this.chain` gets nothing either way — the recognizer grants no
        // tolerance and cannot (`evidence-log.ts`, "never tolerated"). What it
        // changes is whether the operator is told MALFORMED about a file that
        // is merely older than the reader.
        const superseded = recognizeSupersededChainTag(parsed);
        if (superseded !== null) {
          this.supersededChainTag = superseded;
          this.lastError = supersededPreimageMessage(path, i, superseded, EVIDENCE_DOMAIN_TAG);
          return;
        }
        this.lastError =
          `record at line ${String(i)} does not match the closed evidence schema`;
        return;
      }
      this.chain.push(parsed);
    }

    // The same three checks `resyncAppendStore` makes — positional sequence,
    // previousHash, own hash — because `verifyEvidenceChain` IS those three.
    // A store must not catch up under a weaker rule than it loaded under, and
    // it must not load under a weaker rule than it verifies under either.
    const verification = verifyEvidenceChain(this.chain);
    if (!verification.valid) {
      this.loadState = "CANNOT_VERIFY";
      // S132: BEFORE calling it a break, ask whether it is merely OLD. The v3
      // recognizer above could not reach this point — a v3 record is off-schema
      // and returns earlier — but a v4 chain is on-schema, loads whole, and then
      // fails to re-derive at index 0. Asking the v4 preimage is the difference
      // between "intact and older than this reader" and "tampered with", and it
      // is a proof rather than a shape-reading. See `evidence-log.ts`.
      const rederived = recognizeSupersededChainByRederivation(this.chain);
      if (rederived !== null) {
        this.supersededChainTag = rederived;
        this.lastError = supersededByRederivationMessage(
          path,
          this.chain.length,
          rederived,
          EVIDENCE_DOMAIN_TAG
        );
        // DISCARDED, and this line is the whole of "recognition is not a door".
        // The records are on-schema and would otherwise sit in `records()` where
        // a later caller could reach them behind the store's refusal — which is
        // the S116 §E-1 defect, one bump down. Recognizing a chain as history
        // must leave strictly less reachable than not recognizing it.
        this.chain.length = 0;
        return;
      }
      this.lastError =
        `probe evidence chain verification failed at index ` +
        `${String(verification.brokenAt)}`;
      return;
    }
    this.loadState =
      this.chain.length === 0 ? "FIRST_BOOT_OR_ERASED" : "LOADED_VERIFIED";
    this.persisting = true;
  }

  private resyncUnderLock(): string | null {
    const result = resyncAppendStore<EvidenceRecord>({
      path: this.path as string,
      known: this.chain,
      // `validateEvidenceRecord` is a type guard, not a parser; the seam wants
      // `R | null`. Same closed shape either way — this only changes the
      // return convention.
      validate: (parsed) => (validateEvidenceRecord(parsed) ? parsed : null),
      recomputeHash: (record) => computeEvidenceRecordHash(record),
    });
    if (!result.linked) return result.detail;
    for (const record of result.extension) this.chain.push(record);
    return null;
  }

  /**
   * The one place this store calls the seam. `derive` runs INSIDE `prepare`,
   * i.e. under the lock and after the re-sync, so the head it reads is
   * disk-true and the sequence number it takes is the next one on DISK, not
   * the next one this process happened to load at construction.
   */
  private transact<R extends EvidenceRecord>(
    label: string,
    derive: () => R
  ): AppendOutcome<R> {
    return appendStoreTransaction<R>({
      path: this.path,
      persisting: this.persisting,
      lastError: this.lastError,
      storeLabel: "probe evidence log",
      prepare: () => {
        // A refusal from the pure log (`EvidenceLogRefused`: an attempt naming
        // no scenario, an outcome whose ref does not resolve) throws from HERE
        // and propagates out of the transaction with the lock released and
        // nothing appended. That is correct and it is not a persistence
        // failure: it is a statement the chain has no shape to hold.
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
        `no probe evidence log path was injected: this ${label} is IN MEMORY ` +
        "only and does not survive the process. It carries integrity but not " +
        "provenance, and an attempt nobody can read afterwards is not the " +
        "record \"attempted, never notified\" asks for.",
      notPersistingDetail:
        `the probe evidence log is not in a persisting state; the ${label} ` +
        "was not written to disk.",
      onAppendBlocked: (detail) => {
        this.lastError = detail;
        return detail;
      },
      onAppendError: (raw) => {
        this.lastError = `cannot append to probe evidence log: ${raw}`;
        return this.lastError;
      },
    });
  }

  /**
   * Logs the ATTEMPT — the record that must exist BEFORE a subject port is
   * ever called. The returned `ref` is the attempt's sequence number and is
   * only citable when `committed` is true; see `AttemptAppendOutcome`.
   *
   * S120: `input.provenance` is the CALLER's, threaded through unread. This
   * store never supplies one and never infers one from a port — see
   * `evidence-log.ts`'s own header on why a default here would be the store
   * testifying about a subject nobody declared.
   */
  appendAttempt(input: AttemptAppendInput, timestamp: number): AttemptAppendOutcome {
    const outcome = this.transact<AttemptRecord>("attempt", () => {
      const { log } = appendAttempt(this.chain, input, timestamp);
      return log[log.length - 1] as AttemptRecord;
    });
    return { ...outcome, ref: outcome.record.sequenceNumber };
  }

  /**
   * Logs the OUTCOME. `ref` is resolved by the pure `appendOutcome` against
   * the chain AS IT STANDS AFTER THE RE-SYNC — so a ref that resolved when the
   * caller derived it, and no longer resolves against the disk-true chain, is
   * refused rather than written.
   */
  appendOutcome(input: OutcomeAppendInput, timestamp: number): OutcomeAppendOutcome {
    return this.transact<OutcomeRecord>("outcome", () => {
      const log = appendOutcome(this.chain, input, timestamp);
      return log[log.length - 1] as OutcomeRecord;
    });
  }

  /** The chain grading reads from. Never a parallel array. */
  records(): EvidenceLog {
    return this.chain;
  }

  verify(): EvidenceVerifyResult {
    return verifyEvidenceChain(this.chain);
  }

  getLoadState(): EvidenceLoadState {
    return this.loadState;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  /**
   * The superseded preimage this LOAD recognized, or `null`.
   *
   * A separate answer from `getLastError`, deliberately: a caller that had to
   * match a substring of the error prose to tell a v3 chain from a malformed
   * one would be re-deriving a finding from a sentence, and the sentence would
   * be free to change under it. This is the finding itself.
   */
  getSupersededChainTag(): string | null {
    return this.supersededChainTag;
  }

  get length(): number {
    return this.chain.length;
  }

  /** True when a path was injected at all. */
  get hasDeclaredPath(): boolean {
    return this.path !== null;
  }
}

// ── the seam S116 §E-1 named, closed ─────────────────────────────────────────
//
//   "A grader holding only the `EvidenceLog` array cannot tell it came from a
//   truncated file. The store knows; the chain does not." (S116 receipt §E-1.)
//
//   `gradeFromLog` takes a BARE ARRAY and grades the safe prefix of anything
//   handed to it. That is correct for a pure function and it is exactly the
//   hole: the array a `CANNOT_VERIFY` store is holding LOOKS like verdicts,
//   and nothing in the call site says where it came from. The fix is not a
//   check the caller is asked to remember. It is an entry point that takes the
//   STORE, and a result whose provenance is a FIELD — so a verdict cannot be
//   held in a variable without its load state travelling in the same object.
//
//   A FOOTER WOULD NOT HAVE CLOSED IT. Anything a caller can skip — a second
//   method, a printed caveat, a `getLoadState()` the reader is trusted to
//   call — leaves the defect intact for whoever does not call it.

/**
 * The refusal to grade from a store that is not persisting. Its own class,
 * beside `EvidenceStoreDeploymentActMissing` rather than folded into it — one
 * signpost per seam (S97). The two seams are different acts: that one is a
 * deployment act nobody performed, this one is a store whose chain has no
 * standing to be graded from.
 */
export class EvidenceStoreNotGradable extends Error {
  constructor(
    message: string,
    readonly loadState: EvidenceLoadState,
    readonly lastError: string | null
  ) {
    super(message);
    this.name = "EvidenceStoreNotGradable";
  }
}

/** The two refusal sentences, exported so a reader prints them rather than reinventing them. */
export const IN_MEMORY_IS_NOT_GRADABLE =
  "refused to grade: this store is IN MEMORY. No evidence log path was " +
  "injected, so the chain it holds has integrity and no provenance — nothing " +
  "on disk says these attempts were ever made. A verdict derived from it " +
  "would carry an authority the log cannot supply. " +
  THE_EVIDENCE_STORE_LOCATION_IS_UNDESIGNATED;

export function cannotVerifyIsNotGradableMessage(lastError: string | null): string {
  return (
    "refused to grade: this store is in CANNOT_VERIFY. What it was pointed at " +
    "could not be established as this chain's own, so the records it is " +
    "holding are not evidence of anything — they are what one process managed " +
    "to read. Grading them would produce verdicts that look exactly like " +
    "verdicts from a verified chain. The store's last error, verbatim: " +
    (lastError ?? "(none recorded — which is itself a finding)")
  );
}

/** `GradeFromLogResult`, plus the provenance, in ONE object. Never a footer. */
export interface GradeFromStoreResult extends GradeFromLogResult {
  /** Where this chain came from. Always present, never a second call. */
  readonly loadState: EvidenceLoadState;
  /** Whether a path was injected at all — `false` means the store is IN MEMORY. */
  readonly hasDeclaredPath: boolean;
}

/**
 * Grade FROM THE STORE. The only grading entry point a reading surface should
 * ever call.
 *
 * It re-implements no routing, no hashing and no verification: it checks the
 * load state, and then hands `store.records()` to the pure `gradeFromLog`,
 * which is byte-untouched by this build. The refusal is the whole addition.
 *
 * @throws EvidenceStoreNotGradable when the load state is `IN_MEMORY` or
 *   `CANNOT_VERIFY`. `FIRST_BOOT_OR_ERASED` is NOT a refusal: an empty log
 *   that was allowed to be looked at is a finding — zero attempts — and a
 *   reader that refused it would be unable to report the one state a probe
 *   deployment most needs to see on its first day.
 */
export function gradeFromStore(store: EvidenceLogStore): GradeFromStoreResult {
  const loadState = store.getLoadState();
  if (loadState === "IN_MEMORY") {
    throw new EvidenceStoreNotGradable(IN_MEMORY_IS_NOT_GRADABLE, loadState, store.getLastError());
  }
  if (loadState === "CANNOT_VERIFY") {
    const lastError = store.getLastError();
    throw new EvidenceStoreNotGradable(
      cannotVerifyIsNotGradableMessage(lastError),
      loadState,
      lastError
    );
  }
  return { ...gradeFromLog(store.records()), loadState, hasDeclaredPath: store.hasDeclaredPath };
}
