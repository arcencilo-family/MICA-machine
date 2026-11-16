// ── MICA · the ruling log — the ARBITER's own chained book ───────────────────
//
// WHY IT IS HERE AND NOT UNDER src/mica/
//
//   The arbiter is a HUMAN SEAT OUTSIDE MICA (S67 §2, ratified). It is not an
//   organ of the instrument; it is one of the parties the instrument is pointed
//   at. So this book sits at `src/arbiter/`, a sibling of `src/witness/` and
//   `src/clerk/`, and the closure guard — which walks edges OUT OF `src/mica/`
//   — has nothing to say about it. What it is not exempt from is suite
//   registration: `registration.test.ts` walks the whole of `src/`, and
//   `ruling-log.test.ts` is chained in `test:mica` like every other test file.
//
// WHY THE RULING TEXT LIVES HERE, IN FULL
//
//   R2 keeps content out of the WITNESS. It does not keep content out of the
//   AUTHOR'S OWN BOOK — this book is precisely where the content belongs, and
//   putting it here is what makes the anchoring worth anything. A chain over
//   `{sequence, hash}` alone would let every ruling's TEXT be rewritten freely
//   while the chain still verified. The text is in the preimage, so rewriting a
//   ruling breaks the chain, and the committed head makes that break loud.
//
//   Nothing in this file reaches a witness record. The acceptance grep is
//   `rulingText` appearing nowhere under `src/witness/`.
//
// CHAIN ARITHMETIC IS LOCAL, LIKE EVERY SIBLING'S
//
//   This duplicates the notice-log / floor-trail / ledger chain pattern rather
//   than importing any of them, and the coupling bar in `notice-log.ts`'s header
//   holds here verbatim: one book's evolution must not rewrite a sibling's
//   evidence format. The ONE thing imported is `appendStoreTransaction` — the
//   single append seam — because the ordering it encodes (validate -> append
//   durably -> only THEN commit to live state, and only THEN commit the head) is
//   the thing that must not drift between stores.
//
// WHAT THIS BOOK CANNOT PROVE
//
//   It can prove it CALLED a committer. It cannot prove anything was retained,
//   by whom, or where. SUBMISSION IS NOT RETENTION.
//
// THIS MODULE CALLS NO CLOCK
//
//   `timestamp` is INJECTED by the caller, always. The CLI injects the wall
//   clock as the arbiter's own presented data — a time the seat asserts, not a
//   time this module authored on the seat's behalf. A `Date.now()` in here would
//   be the module quietly testifying about when a human acted.

import { createHash } from "crypto";
import { readFileSync, statSync } from "fs";
import type { Stats } from "fs";
import { dirname } from "path";

import {
  appendStoreTransaction,
  resyncAppendStore,
} from "../mica/store/append-store";
import type { LineAppender, LockAcquirer } from "../mica/store/append-store";
import {
  hasExactKeys,
  isEnum,
  isFiniteNumber,
  isNonNegInteger,
  isObject,
  isString,
} from "../mica/store/validate";
import type { Parsed } from "../mica/store/validate";

// ── the head committer (locally declared, deliberately) ──────────────────────
//
// Declared here rather than imported from `src/witness/` for the reason
// `notify/types.ts` and `floor-trail.ts` each declare their own: this module is
// a SUBMITTER, and a retainer's evolution must not reshape the chain that
// submits to it. The function `fileDropCommitter` returns is structurally
// assignable to this type, which is how the CLI wires the two without either
// side importing the other's shape.

/** R8's declared modality. Three spellings, matching the retainer's exactly. */
export type Modality = "OFFERED" | "IMPOSED" | "NOT_AN_INSTRUCTION";

export const MODALITIES: readonly Modality[] = [
  "OFFERED",
  "IMPOSED",
  "NOT_AN_INSTRUCTION",
];

/** The five fields MICA S-4 v0.3 §4 freezes (ruled 2026-08-26, the arbiter, S88). */
export interface HeadCommit {
  readonly seq_no: number;
  readonly head_hash: string;
  readonly ts: number;
  readonly witness_set_id: string;
  readonly modality: Modality;
}

export type HeadCommitter = (commit: HeadCommit) => void;

export const SUBMISSION_IS_NOT_RETENTION =
  "This book can prove it CALLED a committer. It cannot prove anything was " +
  "retained, by whom, or where. Submission is not retention; the evidential " +
  "object is the witness's own store, which this module cannot read and does " +
  "not attest.";

export const THE_WITNESS_TRAIL_IS_A_SAMPLE =
  "The intake is last-writer-wins and the filename is the submitter id, so a " +
  "head committed between two witness sweeps REPLACES the one before it and is " +
  "never retained witness-side. The witness-side modality trail is therefore a " +
  "SAMPLE, not a census of rulings. The per-entry record is THIS BOOK, whose " +
  "chain the retained heads anchor — and a ruling never entered here is " +
  "invisible to everything (R9). Revision and destruction are priced; silence " +
  "is not.";

// ── the record ───────────────────────────────────────────────────────────────

export interface RulingLogRecordInput {
  /**
   * INJECTED wall time, presented by the arbiter. This module never calls a
   * clock; see the file header.
   */
  readonly timestamp: number;
  /** The ruling, verbatim. This book is where the content lives (R2). */
  readonly rulingText: string;
  /** R8. Per ENTRY here: one ruling is offered and the next imposed. */
  readonly modality: Modality;
}

export interface RulingLogRecord extends RulingLogRecordInput {
  readonly sequenceNumber: number;
  readonly previousHash: string;
  readonly hash: string;
}

const RECORD_KEYS = [
  "timestamp",
  "rulingText",
  "modality",
  "sequenceNumber",
  "previousHash",
  "hash",
] as const;

/**
 * The chained hash. Field order is fixed and explicit — never taken from
 * `JSON.stringify` of an object literal — so a future field reordering cannot
 * silently rewrite every hash in an existing book.
 *
 * TWO PROPERTIES TAKEN FROM THE NOTICE LOG'S PREIMAGE, BOTH LOAD-BEARING HERE:
 * the separator is the ASCII unit separator rather than a space, and the
 * variable-length run is LENGTH-PREFIXED. `rulingText` is free prose of
 * unbounded length; with a space-joined preimage a ruling could be edited so
 * that content moved across a field boundary without changing the digest.
 *
 * `modality` IS IN THE PREIMAGE. It is the same trap the witness's
 * `canonicalWitnessed` has to avoid on the other side of the wire: a modality
 * that is stored but not hashed can be flipped from IMPOSED to OFFERED on disk
 * with the chain still verifying, which is the exact false attestation this
 * whole instrument exists to make loud.
 */
const US = "\u001f";

function lengthPrefixed(value: string): string {
  return `${String(value.length)}:${value}`;
}

export function computeRulingRecordHash(
  r: Omit<RulingLogRecord, "hash">
): string {
  const canonical = [
    String(r.sequenceNumber),
    r.previousHash,
    String(r.timestamp),
    r.modality,
    lengthPrefixed(r.rulingText),
  ].join(US);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Closed-shape validation before any parsed record joins the chain. */
export function validateRulingLogRecord(x: unknown): RulingLogRecord | null {
  if (!isObject(x)) return null;
  const o = x as Parsed;
  if (!hasExactKeys(o, RECORD_KEYS)) return null;
  if (!isFiniteNumber(o.timestamp)) return null;
  if (!isString(o.rulingText)) return null;
  if (!isEnum(o.modality, MODALITIES)) return null;
  if (!isNonNegInteger(o.sequenceNumber)) return null;
  if (!isString(o.previousHash)) return null;
  if (!isString(o.hash)) return null;
  return o as unknown as RulingLogRecord;
}

// ── the store ────────────────────────────────────────────────────────────────

export type RulingLogLoadState =
  | "IN_MEMORY"
  | "LOADED_VERIFIED"
  | "FIRST_BOOT_OR_ERASED"
  | "CANNOT_VERIFY";

export interface RulingLogOptions {
  /** Injected deployment path. Absent means IN_MEMORY, never durable. */
  readonly path?: string;
  /** Fault-injection seam. Production leaves this absent. */
  readonly appender?: LineAppender;
  /**
   * The inter-process append lock. Production leaves this absent and gets
   * `exclusiveFileLock`. A deployment that needs a bounded retry injects it
   * HERE — the book holds no timing policy of its own.
   */
  readonly acquire?: LockAcquirer;
  /** Post-durable transport boundary. It gates nothing. */
  readonly headCommitter?: HeadCommitter;
  /** Declared witness-set id copied into the commit; absent is carried as "". */
  readonly witnessSetId?: string;
}

export interface RulingLogOutcome {
  readonly record: RulingLogRecord;
  readonly persisted: boolean;
  readonly detail: string | null;
  /** True only when the post-durable committer call returned normally. */
  readonly headCommitted: boolean;
  /** Null when unwired or when the commit call returned; otherwise why not. */
  readonly headCommitDetail: string | null;
}

export interface RulingLogVerifyResult {
  readonly valid: boolean;
  readonly brokenAt: number | null;
}

/**
 * A deployment act named in the recipe was never performed. Typed so a caller
 * can tell "the deployer skipped a step" apart from "the disk broke".
 *
 * ITS OWN CLASS, NOT THE CLERK'S OR THE WITNESS'S — decided S97. This file's
 * header sets the coupling bar: it duplicates the chain arithmetic of its
 * siblings rather than importing any of it, so that one book's evolution cannot
 * rewrite another book's evidence format. Reaching into `src/clerk/` for an
 * error type would cross that bar for a string. One signpost per seam; the
 * three seams say the same four things in the same order.
 */
export class ArbiterDeploymentActMissing extends Error {
  constructor(
    message: string,
    readonly path: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "ArbiterDeploymentActMissing";
  }
}

/**
 * The arbiter's book directory is a DEPLOYMENT ACT (recipe §5B.2, digits
 * RATIFIED 2026-08-31, S97-A). This checks; it never creates.
 *
 * `statSync` rather than `existsSync` so that "I cannot see it" is not reported
 * as "it is not there": a directory this process may not enter fails here too,
 * and the underlying errno rides along in the message saying which.
 */
function requireArbiterStoreDir(dir: string): void {
  const signpost =
    `arbiter ruling-log directory absent — this is a deployment act ` +
    `(deploy recipe §5B.2). Expected: ${dir} at 2750 mica-arbiter:mica-readers. ` +
    `Nothing was created.`;
  let stats: Stats;
  try {
    stats = statSync(dir);
  } catch (err) {
    throw new ArbiterDeploymentActMissing(`${signpost} (${String(err)})`, dir, err);
  }
  if (!stats.isDirectory()) {
    throw new ArbiterDeploymentActMissing(
      `${signpost} That path exists and is not a directory.`,
      dir
    );
  }
}

/**
 * WHAT A LOOK AT THE BOOK FILE FOUND — three answers, not two (S98).
 *
 * `existsSync` answers a two-valued question over a three-valued world. It
 * returns FALSE both for "there is no such file" and for "I was not allowed to
 * look", because it swallows every errno alike. Under `!existsSync(path)` this
 * book then declared FIRST_BOOT_OR_ERASED and set `persisting = true` — telling
 * a principal that the arbiter's book is BRAND NEW when the truth is that this
 * process cannot see it. That is a falsehood, delivered to the wrong principal,
 * about the one book whose whole purpose is to be readable by the four roles the
 * arbiter rules over.
 *
 * It is the same distinction `requireArbiterStoreDir` was given at S97 —
 * "I cannot see it" is not "it is not there" — applied one level down, to the
 * FILE rather than its directory. The directory check catches a principal who
 * cannot enter the directory at all. It does not catch a directory that stats
 * fine and whose contents cannot be reached: a book directory with its execute
 * bit stripped stats as a directory and refuses every path inside it.
 *
 * CANNOT_SEE loads to CANNOT_VERIFY and limps on; it does not throw. That is
 * the line this file already draws and it is drawn deliberately: an absent
 * DIRECTORY is a missing precondition — nobody performed an act — and there is
 * no book to report anything about. An unreadable FILE is a fact ABOUT THE BOOK,
 * discovered at runtime, and reporting it is this book's job. The existing
 * `readFileSync` catch gives exactly that treatment to a file that exists and
 * will not open; this routes the look-that-was-refused to the same place instead
 * of to the first-boot branch.
 */
export type BookFileLook =
  | { readonly state: "PRESENT" }
  | { readonly state: "ABSENT" }
  | { readonly state: "CANNOT_SEE"; readonly detail: string };

export function lookAtRulingLogFile(path: string): BookFileLook {
  try {
    statSync(path);
    return { state: "PRESENT" };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOENT is the ONLY errno that means the book is not there. Every other one
    // means the question was not answered.
    if (code === "ENOENT") return { state: "ABSENT" };
    return { state: "CANNOT_SEE", detail: `${code ?? "no errno"}: ${String(err)}` };
  }
}

/** The signpost a principal who cannot see the book is handed. */
export function cannotSeeRulingLogMessage(path: string, detail: string): string {
  return (
    `the ruling log could not be looked at, which is NOT the finding that it is ` +
    `absent — this process cannot see ${path} (${detail}). deploy recipe §5B.2 ` +
    `makes the book's directory 2750 mica-arbiter:mica-readers; a principal ` +
    `outside mica-readers, or a directory whose execute bit was stripped, ` +
    `produces exactly this. Nothing was created, nothing was recorded as a ` +
    `first boot, and this book is NOT in a persisting state.`
  );
}

/** Append-only rulings. Read by no sensor, and by no instrument. */
export class RulingLog {
  private readonly chain: RulingLogRecord[] = [];
  private readonly path: string | null;
  private readonly appender?: LineAppender;
  private readonly acquire?: LockAcquirer;
  private readonly headCommitter?: HeadCommitter;
  private readonly witnessSetId: string;
  private loadState: RulingLogLoadState = "IN_MEMORY";
  private persisting = false;
  private lastError: string | null = null;

  constructor(options?: RulingLogOptions) {
    this.path = options?.path ?? null;
    this.appender = options?.appender;
    this.acquire = options?.acquire;
    this.headCommitter = options?.headCommitter;
    this.witnessSetId = options?.witnessSetId ?? "";
    if (this.path !== null) this.loadFromDisk();
  }

  private loadFromDisk(): void {
    const path = this.path as string;
    // ── THE PRECONDITION IS CHECKED BEFORE THE BOOK, AND THE ORDER IS THE POINT
    //
    //   The directory check used to live INSIDE the absent branch, which was
    //   harmless while the branch was `!existsSync`. It stopped being harmless
    //   the moment the look grew a third answer: a regular FILE standing where
    //   §5B.2's directory belongs makes `statSync(dir/book.jsonl)` fail ENOTDIR,
    //   and the look would classify that CANNOT_SEE and limp on — trading a
    //   typed "somebody put a file where the deployment act goes", which names
    //   the remedy, for a vague "I could not look", which does not. RL-U caught
    //   it on the first run of this change.
    //
    //   So: the ACT is verified first, unconditionally, and only then is the
    //   book looked at. An absent or non-directory parent is a missing
    //   PRECONDITION and throws; everything after this line is a fact ABOUT THE
    //   BOOK and is reported rather than thrown.
    requireArbiterStoreDir(dirname(path));
    const look = lookAtRulingLogFile(path);
    if (look.state === "CANNOT_SEE") {
      // NOT FIRST BOOT. See `lookAtRulingLogFile`: this was `!existsSync(path)`
      // until 2026-08-31, and a look that was refused arrived here wearing the
      // absent branch's clothes.
      this.loadState = "CANNOT_VERIFY";
      this.lastError = cannotSeeRulingLogMessage(path, look.detail);
      return;
    }
    if (look.state === "ABSENT") {
      // ── THE ARBITER DOES NOT CREATE ITS OWN BOOK'S DIRECTORY (S97-A) ────────
      //
      //   This line was `mkdirSync(dirname(path), { recursive: true })` until
      //   2026-08-31, inside a try/catch that swallowed the failure and let the
      //   book come up non-persisting. S96-D ruled the class; S97-A ratified
      //   recipe §5B.2's digits and called this door in — the fourth and last.
      //
      //   THE ARBITER'S GROUND, AND IT IS THE REASON THIS SITE IS THE WORST OF THE
      //   FOUR: the seat with the biggest power must be the most transparent.
      //   The duty of transparency rises with the seat's power, twin to S96-G's
      //   rising duty of contradiction. This is the ARBITER'S book — the record
      //   of the one seat that decides — and §5B.2 exists to make it readable by
      //   the four roles the arbiter rules over. `2750 mica-arbiter:mica-readers`
      //   IS that transparency, rendered in POSIX.
      //
      //   MEASURED AT HEAD `7d9d54e`, NOT ARGUED (S97 receipt §1): with the act
      //   never performed, the old line CONJURED the directory at the process
      //   umask — `0755`, no setgid, the arbiter's primary group — wrote
      //   `rulings.jsonl` into it, printed `persisted : true`, and the CLI
      //   exited 0. Under §5B.6's `umask 0027` that is `0750
      //   mica-arbiter:mica-arbiter`: every reader §5B.2 exists to serve locked
      //   out of the rulings, and nothing anywhere saying so. The seat with the
      //   most power, keeping the least readable book, believing it was read.
      //
      //   AND THE CATCH WAS THE QUIETER HALF. When the mkdir FAILED instead, the
      //   old code set `lastError`, left `persisting` false, and came up anyway;
      //   `record()` then returned a hashed, sequenced record with
      //   `persisted: false`, the CLI printed `appended seq : 0` above it, and
      //   still exited 0. A rulings log that loses rulings is the quietest
      //   possible failure in the loudest possible seat.
      //
      //   So it now THROWS out of the constructor. A book whose deployment act
      //   was never performed does not come up at all — the witness precedent
      //   (`witness.ts`, S97), for the same reason: a half-made book is worse
      //   than none, because somebody reads it.
      //
      //   WHAT DID NOT CHANGE, and the distinction is the whole of the design:
      //   an UNREADABLE file, malformed JSON, and a broken chain still load to
      //   CANNOT_VERIFY and limp on, because those are facts ABOUT THE BOOK,
      //   discovered at runtime, and reporting them is this book's job. An
      //   absent directory is a missing PRECONDITION — nobody performed an act
      //   — and there is no book to report anything about.
      //
      //   **Do not add a create-if-missing flag here**, and do not add one under
      //   a test-only branch: a fence with a bypass is not a fence.
      // The directory act was verified above, before the look.
      this.loadState = "FIRST_BOOT_OR_ERASED";
      this.persisting = true;
      return;
    }

    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError = `cannot read ruling log: ${String(err)}`;
      return;
    }

    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    for (let i = 0; i < lines.length; i++) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(lines[i]);
      } catch (err) {
        this.loadState = "CANNOT_VERIFY";
        this.lastError = `malformed JSON at line ${String(i)}: ${String(err)}`;
        return;
      }
      const record = validateRulingLogRecord(parsed);
      if (record === null) {
        this.loadState = "CANNOT_VERIFY";
        this.lastError =
          `record at line ${String(i)} does not match the closed ruling-log schema`;
        return;
      }
      this.chain.push(record);
    }

    const verification = this.verify();
    if (!verification.valid) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError =
        `ruling-log chain verification failed at index ${String(verification.brokenAt)}`;
      return;
    }
    this.loadState =
      this.chain.length === 0 ? "FIRST_BOOT_OR_ERASED" : "LOADED_VERIFIED";
    this.persisting = true;
  }

  /**
   * The disk-truth catch-up, run by the seam while it holds the append lock. The
   * chain loaded at construction may be a stale prefix: another invocation of the
   * one-shot CLI can have appended since — and with a one-shot CLI that is the
   * NORMAL case, not the exotic one. Records that link on are ADOPTED, so the
   * sequence number derived next is the true one; an extension that does not link
   * adopts nothing and fails the append typed, because appending onto a fork
   * deepens it.
   */
  private resyncUnderLock(): string | null {
    const result = resyncAppendStore<RulingLogRecord>({
      path: this.path as string,
      known: this.chain,
      validate: validateRulingLogRecord,
      recomputeHash: (record) => computeRulingRecordHash(record),
    });
    if (!result.linked) return result.detail;
    for (const record of result.extension) this.chain.push(record);
    return null;
  }

  /**
   * Append one ruling, then commit this book's head.
   *
   * THE ORDER IS THE INVARIANT: validate -> append durably -> commit live state
   * -> ONLY THEN commit the head. A head over a record that never reached disk
   * would name a prefix nobody can reproduce. The committer call is try/caught
   * and its failure is REPORTED, never thrown: a witness that is down, an intake
   * that was never deployed, a full disk — none of them may cost this book the
   * ruling it already wrote.
   */
  record(input: RulingLogRecordInput): RulingLogOutcome {
    const outcome = appendStoreTransaction<RulingLogRecord>({
      path: this.path,
      persisting: this.persisting,
      lastError: this.lastError,
      storeLabel: "ruling log",
      prepare: () => {
        const sequenceNumber = this.chain.length;
        const previousHash =
          sequenceNumber === 0 ? "" : this.chain[sequenceNumber - 1].hash;
        const hash = computeRulingRecordHash({
          ...input,
          sequenceNumber,
          previousHash,
        });
        const record: RulingLogRecord = {
          timestamp: input.timestamp,
          rulingText: input.rulingText,
          modality: input.modality,
          sequenceNumber,
          previousHash,
          hash,
        };
        return {
          record,
          line: JSON.stringify(record) + "\n",
          commit: () => this.chain.push(record),
        };
      },
      resync: () => this.resyncUnderLock(),
      appender: this.appender,
      acquire: this.acquire,
      memoryDetail:
        "no ruling-log path was injected: this ruling is IN MEMORY only and does " +
        "not survive the process. It carries integrity but not provenance.",
      notPersistingDetail:
        "the ruling log is not in a persisting state; the ruling was not written " +
        "to disk.",
      onAppendBlocked: (detail) => {
        this.lastError = detail;
        return detail;
      },
      onAppendError: (raw) => {
        this.lastError = `cannot append to ruling log: ${raw}`;
        return this.lastError;
      },
    });

    const record = outcome.record;
    let headCommitted = false;
    let headCommitDetail: string | null = null;
    if (this.headCommitter !== undefined) {
      if (!outcome.persisted) {
        headCommitDetail =
          "ruling-log append was not durably persisted; no head was committed";
      } else {
        try {
          this.headCommitter({
            seq_no: record.sequenceNumber,
            head_hash: record.hash,
            // The record's own index, not a clock. `timestamp` is the ARBITER'S
            // presented wall time and belongs in the record; `ts` is a frozen
            // S-4 field, and it carries the sequence so the shape is satisfied
            // without this book authoring a second time about itself.
            ts: record.sequenceNumber,
            witness_set_id: this.witnessSetId,
            // THE MODALITY OF THIS ONE ENTRY. Because the head commit is per
            // entry, the modality on each committed head is the modality of the
            // single ruling that produced it — which is why no granularity
            // question arises here and why the committer must not be built with
            // a modality of its own.
            modality: record.modality,
          });
          headCommitted = true;
        } catch (err) {
          headCommitDetail = `head committer threw: ${String(err)}`;
        }
      }
    }

    return {
      record,
      persisted: outcome.persisted,
      detail: outcome.detail,
      headCommitted,
      headCommitDetail,
    };
  }

  verify(): RulingLogVerifyResult {
    for (let i = 0; i < this.chain.length; i++) {
      const record = this.chain[i];
      if (record.sequenceNumber !== i) return { valid: false, brokenAt: i };
      const expectedPrevious = i === 0 ? "" : this.chain[i - 1].hash;
      if (record.previousHash !== expectedPrevious) {
        return { valid: false, brokenAt: i };
      }
      if (computeRulingRecordHash(record) !== record.hash) {
        return { valid: false, brokenAt: i };
      }
    }
    return { valid: true, brokenAt: null };
  }

  getAll(): readonly RulingLogRecord[] {
    return this.chain;
  }

  getLoadState(): RulingLogLoadState {
    return this.loadState;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  get length(): number {
    return this.chain.length;
  }

  /** True when a path was injected at all. */
  get hasDeclaredPath(): boolean {
    return this.path !== null;
  }

  /** True when a head committer was injected at all. */
  get hasHeadCommitter(): boolean {
    return this.headCommitter !== undefined;
  }
}
