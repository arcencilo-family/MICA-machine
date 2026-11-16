// ── MICA · the notice log — notify's own chained book ────────────────────────
//
// WHY THIS EXISTS RATHER THAN A DROP INTO THE WITNESS INTAKE
//
//   The S-4 witness intake is a HEAD-COMMIT intake, not an evidence intake.
//   `submitRaw` runs `validateHeadCommit`, which is `hasExactKeys(HEAD_KEYS)`
//   over exactly `{seq_no, head_hash, ts, witness_set_id}`. A notice envelope
//   dropped there always falls to MALFORMED_SUBMISSION, which retains only
//   `{byteLength, sha256}` — and `pollIntake` then removes the drop file. The
//   content is destroyed; the hash survives.
//
//   So the shape ruled for this build (S78, fork B) is the same shape the floor
//   trail already uses, and NO sixth witnessed kind: notify keeps its OWN
//   append-only hash-chained book, and commits that book's HEAD through the
//   existing HEAD_COMMIT path. The witness makes rewriting this book loud. It
//   does not hold the book.
//
//   The consequence is worth stating because it turns a hazard into semantics:
//   the intake filename IS the submitter id, so head commits are last-writer-
//   wins. Under a content drop that would be data loss. Under head-commit it is
//   exactly what a head IS — a later head at a later seq constrains a longer
//   prefix of the same chain.
//
// WHAT THIS BOOK CANNOT PROVE
//
//   It can prove it CALLED a committer. It cannot prove anything was retained,
//   by whom, or where. Submission is not retention; the evidential object is the
//   witness's own store, which this module cannot read and does not attest.
//
// CHAIN ARITHMETIC IS LOCAL, LIKE EVERY SIBLING'S
//
//   This duplicates the floor-trail / ledger chain pattern rather than importing
//   either. Their record shapes and purposes differ, and coupling the arithmetic
//   would let one book's evolution silently rewrite another's evidence format.
//   The ONE thing that IS imported is `appendStoreTransaction` — the single
//   append-store contract (F2 + F7), because the ordering guarantee it encodes
//   (validate -> append durably -> only THEN commit to live state) is the thing
//   that must not drift between stores.

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "fs";
import { dirname } from "path";

import {
  appendStoreTransaction,
  blankLineDetail,
  resyncAppendStore,
  storeLines,
} from "../store/append-store";
import type { AppendResyncTorn, LineAppender, LockAcquirer } from "../store/append-store";
import {
  hasExactKeys,
  isArrayOf,
  isEnum,
  isNonNegInteger,
  isObject,
  isString,
  isStringArray,
} from "../store/validate";
import type { Parsed } from "../store/validate";
import {
  ATTEMPT_OUTCOMES,
  RECIPIENT_ROLES,
} from "./types";
import type {
  AttemptOutcome,
  DeliveryAttempt,
  HeadCommitter,
  Modality,
  NoticeEnvelope,
  RecipientRole,
} from "./types";

export const HEAD_COMMIT_IS_NOT_RETENTION =
  "This book can prove it CALLED a committer. It cannot prove anything was " +
  "retained, by whom, or where. Submission is not retention; the evidential " +
  "object is the witness's own store, which this module cannot read and does " +
  "not attest.";

export const COMMIT_MAKES_REWRITING_LOUD =
  "Committing this book's head to a witness makes REWRITING it loud. It gates " +
  "nothing, permits nothing, and is never a precondition of anything here. A " +
  "deployment without a witness simply has no continuity claim over this book.";

export interface NoticeLogRecordInput {
  readonly sourceId: string;
  readonly kind: string;
  readonly lines: readonly string[];
  /** The envelope's own caller-supplied sequence, carried verbatim. */
  readonly envelopeSequence: number;
  /** The sibling attempts this raising produced, so the trail answers both. */
  readonly attempts: readonly DeliveryAttempt[];
}

export interface NoticeLogRecord extends NoticeLogRecordInput {
  readonly sequenceNumber: number;
  readonly previousHash: string;
  readonly hash: string;
}

const RECORD_KEYS = [
  "sourceId",
  "kind",
  "lines",
  "envelopeSequence",
  "attempts",
  "sequenceNumber",
  "previousHash",
  "hash",
] as const;

const ATTEMPT_KEYS = ["sinkId", "role", "outcome", "detail"] as const;

/**
 * The chained hash. Field order is fixed and explicit — never taken from
 * `JSON.stringify` of an object literal — so a future field reordering cannot
 * silently rewrite every hash in an existing book.
 *
 * Two differences from the sibling floor trail's preimage, both deliberate:
 * the separator is the ASCII unit separator rather than a space, and every
 * variable-length run is LENGTH-PREFIXED. The floor trail's fields are all
 * short opaque ids; these carry free prose (`lines`) and free detail strings,
 * where a space-joined preimage would let content move across a field boundary
 * without changing the digest.
 */
const US = "\u001f";

function canonicalNoticeRecord(
  r: NoticeLogRecordInput & { sequenceNumber: number; previousHash: string }
): string {
  const parts: string[] = [
    String(r.sequenceNumber),
    r.previousHash,
    r.sourceId,
    r.kind,
    String(r.envelopeSequence),
    String(r.lines.length),
    ...r.lines,
    String(r.attempts.length),
  ];
  for (const attempt of r.attempts) {
    parts.push(attempt.sinkId, attempt.role ?? "", attempt.outcome, attempt.detail);
  }
  return parts.join(US);
}

export function computeNoticeRecordHash(
  r: NoticeLogRecordInput & { sequenceNumber: number; previousHash: string }
): string {
  return createHash("sha256").update(canonicalNoticeRecord(r), "utf8").digest("hex");
}

/** Identical vocabulary to the sibling books' load state. */
export type NoticeLogLoadState =
  | "IN_MEMORY"
  | "LOADED_VERIFIED"
  | "FIRST_BOOT_OR_ERASED"
  | "CANNOT_VERIFY";

function validateAttempt(value: unknown): DeliveryAttempt | null {
  if (!isObject(value) || !hasExactKeys(value as Parsed, ATTEMPT_KEYS)) return null;
  const o = value as Parsed;
  if (!isString(o.sinkId)) return null;
  if (o.role !== null && !isEnum(o.role, RECIPIENT_ROLES)) return null;
  if (!isEnum(o.outcome, ATTEMPT_OUTCOMES)) return null;
  if (!isString(o.detail)) return null;
  return {
    sinkId: o.sinkId,
    role: (o.role as RecipientRole | null) ?? null,
    outcome: o.outcome as AttemptOutcome,
    detail: o.detail,
  };
}

function validateNoticeLogRecord(value: unknown): NoticeLogRecord | null {
  if (!isObject(value) || !hasExactKeys(value as Parsed, RECORD_KEYS)) return null;
  const o = value as Parsed;
  if (!isString(o.sourceId)) return null;
  if (!isString(o.kind)) return null;
  if (!isStringArray(o.lines)) return null;
  if (!isNonNegInteger(o.envelopeSequence)) return null;
  if (!isArrayOf(o.attempts, (x): x is DeliveryAttempt => validateAttempt(x) !== null)) {
    return null;
  }
  if (!isNonNegInteger(o.sequenceNumber)) return null;
  if (!isString(o.previousHash)) return null;
  if (!isString(o.hash)) return null;
  return o as unknown as NoticeLogRecord;
}

export interface NoticeLogOptions {
  /** Injected deployment path. Absent means IN_MEMORY, never durable. */
  readonly path?: string;
  /** Fault-injection seam. Production leaves this absent. */
  readonly appender?: LineAppender;
  /**
   * The inter-process append lock. Production leaves this absent and gets
   * `exclusiveFileLock`. A deployment that needs a bounded retry injects it
   * HERE — the log holds no timing policy of its own.
   */
  readonly acquire?: LockAcquirer;
  /** Post-durable transport boundary. It gates nothing. */
  readonly headCommitter?: HeadCommitter;
  /** Declared witness-set id copied into the commit; absent is carried as "". */
  readonly witnessSetId?: string;
  /**
   * R8's declaration, made by THIS DEPLOYMENT'S DEPLOYER, stamped onto every
   * head this book commits.
   *
   * IT IS CONSTRUCTION-TIME HERE AND PER-ENTRY IN THE ARBITER'S BOOK, and that
   * is not an inconsistency. This is a MACHINE book: every entry it writes is a
   * notice the machine raised, so every entry carries the same declaration, and
   * a per-entry option here would be a knob with one setting that some later
   * caller varies by accident.
   *
   * Absent is carried as `NOT_AN_INSTRUCTION` — the honest reading of a
   * machine-raised notice, and the value a deployer would type anyway. The
   * DEPLOYMENT-facing option (`WireOptions.witnessIntake.modality`) is
   * type-REQUIRED, so a deployment cannot skip the declaration even though this
   * constructor tolerates its absence for in-process callers.
   */
  readonly modality?: Modality;
}

export interface NoticeLogOutcome {
  readonly record: NoticeLogRecord;
  readonly persisted: boolean;
  readonly detail: string | null;
  /** True only when the post-durable committer call returned normally. */
  readonly headCommitted: boolean;
  /** Null when unwired or when the commit call returned; otherwise why not. */
  readonly headCommitDetail: string | null;
}

export interface NoticeLogVerifyResult {
  readonly valid: boolean;
  readonly brokenAt: number | null;
}

/** Append-only notice records. Read by no sensor, and by no instrument. */
/**
 * WHAT A LOOK AT THE BOOK FILE FOUND — three answers, not two.
 *
 * `existsSync` answers a two-valued question over a three-valued world: it
 * returns FALSE both for "there is no such file" and for "I was not allowed to
 * look", because it swallows every errno alike. Under `!existsSync(path)` this
 * book declared FIRST_BOOT_OR_ERASED over a book it merely could not read.
 *
 * THE MKDIR DID NOT SAVE IT, and that was the assumption worth killing. The
 * absent branch below calls `mkdirSync(dirname(path), { recursive: true })`
 * and sets `persisting` only if that succeeds, so it looks as though a
 * permission fault is caught one line later. Recursive mkdir is IDEMPOTENT: on
 * a directory that already exists and cannot be entered it SUCCEEDS. Measured
 * at uid 1000 with no second principal (S103, ruling-log receipt §E): strip a
 * directory's execute bit and `existsSync` goes false, `statSync` gives EACCES,
 * `mkdirSync` returns cleanly, and the book comes up FIRST_BOOT_OR_ERASED with
 * `persisting = true` over content it never read.
 *
 * S96-D's annotation on that mkdir — "no other principal is entitled" — is a
 * true statement about WHO MAY READ and never was a claim that this state
 * cannot occur. The probe above involved no second principal at all.
 *
 * CANNOT_SEE loads to CANNOT_VERIFY and limps on; it does not throw. That is
 * the line this file already draws for an unreadable file, malformed JSON and a
 * broken chain — facts ABOUT THE BOOK, discovered at runtime, which reporting is
 * this book's job.
 *
 * Duplicated rather than imported, per this project's standing bar on coupling
 * one book's arithmetic to another's (see the header). `ruling-log.ts` and
 * `precommit.ts` each carry their own copy for the same reason.
 */
export type NoticeLogFileLook =
  | { readonly state: "PRESENT" }
  | { readonly state: "ABSENT" }
  | { readonly state: "CANNOT_SEE"; readonly detail: string };

export function lookAtNoticeLogFile(path: string): NoticeLogFileLook {
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

/** The signpost handed to a caller that could not look at the notice log. */
export function cannotSeeNoticeLogMessage(path: string, detail: string): string {
  return (
    `the notice log could not be looked at, which is NOT the finding that it is ` +
    `absent — this process cannot see ${path} (${detail}). A directory whose ` +
    `execute bit is stripped produces exactly this, and no second principal is ` +
    `needed to reach it. Nothing was created, nothing was recorded as a first ` +
    `boot, and this book is NOT in a persisting state.`
  );
}

export class NoticeLog {
  private readonly chain: NoticeLogRecord[] = [];
  private readonly path: string | null;
  private readonly appender?: LineAppender;
  private readonly acquire?: LockAcquirer;
  private readonly headCommitter?: HeadCommitter;
  private readonly witnessSetId: string;
  private readonly modality: Modality;
  private loadState: NoticeLogLoadState = "IN_MEMORY";
  private persisting = false;
  private lastError: string | null = null;

  constructor(options?: NoticeLogOptions) {
    this.path = options?.path ?? null;
    this.appender = options?.appender;
    this.acquire = options?.acquire;
    this.headCommitter = options?.headCommitter;
    this.witnessSetId = options?.witnessSetId ?? "";
    this.modality = options?.modality ?? "NOT_AN_INSTRUCTION";
    if (this.path !== null) this.loadFromDisk();
  }

  private loadFromDisk(): void {
    const path = this.path as string;
    const look = lookAtNoticeLogFile(path);
    if (look.state === "CANNOT_SEE") {
      // NOT FIRST BOOT. See `lookAtNoticeLogFile`: this was `!existsSync(path)`
      // until S103, and a look that was refused arrived here wearing the absent
      // branch's clothes — with `persisting` set, because the mkdir below
      // succeeds on a directory that exists and cannot be entered.
      this.loadState = "CANNOT_VERIFY";
      this.lastError = cannotSeeNoticeLogMessage(path, look.detail);
      return;
    }
    if (look.state === "ABSENT") {
      this.loadState = "FIRST_BOOT_OR_ERASED";
      try {
        // mkdirSync RULED in-bounds (S96-D): only notify's own notice log,
        // written and read back by the same principal; no deployment act names
        // this directory and no other principal is entitled to it. Annotated
        // S97. NOTE the asymmetry that makes this safe: the WITNESS INTAKE this
        // log drops head commits into is a deployment act, and the committer
        // stopped creating it at S86 — see floor-trail.ts's committer comment.
        mkdirSync(dirname(path), { recursive: true });
        this.persisting = true;
      } catch (err) {
        this.lastError = `cannot create notice-log directory: ${String(err)}`;
      }
      return;
    }

    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError = `cannot read notice log: ${String(err)}`;
      return;
    }

    // THE line rule, imported rather than restated: this loader's count and
    // resyncAppendStore's count must be the same count. See `storeLines`.
    const scan = storeLines(raw);
    if (!scan.ok) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError = blankLineDetail(scan.index, scan.count);
      return;
    }
    const lines = scan.lines;
    for (let i = 0; i < lines.length; i++) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(lines[i]);
      } catch (err) {
        this.loadState = "CANNOT_VERIFY";
        this.lastError = `malformed JSON at line ${i}: ${String(err)}`;
        return;
      }
      const record = validateNoticeLogRecord(parsed);
      if (record === null) {
        this.loadState = "CANNOT_VERIFY";
        this.lastError =
          `record at line ${i} does not match the closed notice-log schema`;
        return;
      }
      this.chain.push(record);
    }

    const verification = this.verify();
    if (!verification.valid) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError =
        `notice-log chain verification failed at index ${String(verification.brokenAt)}`;
      return;
    }
    this.loadState =
      this.chain.length === 0 ? "FIRST_BOOT_OR_ERASED" : "LOADED_VERIFIED";
    this.persisting = true;
  }

  /**
   * Append one raising. The sequence number is this record's own index in this
   * chain — the floor-trail / witness pattern, and the reason no clock appears.
   *
   * The head commit is attempted ONLY after a durable append, exactly as the
   * floor trail does it: a head over a record that never reached disk would name
   * a prefix nobody can reproduce.
   */
  /**
   * The disk-truth catch-up, run by the seam while it holds the append lock. The
   * chain loaded at construction may be a stale prefix: another invocation can
   * have appended since. Records that link on are ADOPTED into this chain, so the
   * sequence number derived next is the true one; an extension that does not link
   * adopts nothing and fails the append typed.
   */
  private resyncUnderLock(): string | AppendResyncTorn | null {
    const result = resyncAppendStore<NoticeLogRecord>({
      path: this.path as string,
      known: this.chain,
      validate: validateNoticeLogRecord,
      recomputeHash: (record) => computeNoticeRecordHash(record),
    });
    // A torn file is carried as a torn file, so the seam does not tell the
    // operator another writer forked this log over a line that holds no record.
    if (!result.linked) {
      return result.torn === true
        ? { torn: true, detail: result.detail }
        : result.detail;
    }
    for (const record of result.extension) this.chain.push(record);
    return null;
  }

  record(input: NoticeLogRecordInput): NoticeLogOutcome {
    const outcome = appendStoreTransaction<NoticeLogRecord>({
      path: this.path,
      persisting: this.persisting,
      lastError: this.lastError,
      storeLabel: "notice log",
      prepare: () => {
        const sequenceNumber = this.chain.length;
        const previousHash =
          sequenceNumber === 0 ? "" : this.chain[sequenceNumber - 1].hash;
        const hash = computeNoticeRecordHash({
          ...input,
          sequenceNumber,
          previousHash,
        });
        const record: NoticeLogRecord = {
          ...input,
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
        "no notice-log path was injected: this record is IN MEMORY only and does " +
        "not survive the process. It carries integrity but not provenance.",
      notPersistingDetail:
        "the notice log is not in a persisting state; the record was not written " +
        "to disk.",
      onAppendBlocked: (detail) => {
        this.lastError = detail;
        return detail;
      },
      onAppendError: (raw) => {
        this.lastError = `cannot append to notice log: ${raw}`;
        return this.lastError;
      },
    });

    const record = outcome.record;
    let headCommitted = false;
    let headCommitDetail: string | null = null;
    if (this.headCommitter !== undefined) {
      if (!outcome.persisted) {
        headCommitDetail =
          "notice-log append was not durably persisted; no head was committed";
      } else {
        try {
          this.headCommitter({
            seq_no: record.sequenceNumber,
            head_hash: record.hash,
            // The record's own index, not a clock. This book authors no time
            // about itself; `ts` is a frozen S-4 field and carries the sequence
            // so the shape is satisfied without a self-authored wall clock.
            ts: record.sequenceNumber,
            witness_set_id: this.witnessSetId,
            // R8. THE DEPLOYER'S DECLARATION, copied — never derived from the
            // record. Nothing in a notice's content could tell this book whether
            // a human instruction rode it, and a book that guessed would be
            // fabricating exactly the declaration the field exists to carry.
            modality: this.modality,
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

  verify(): NoticeLogVerifyResult {
    for (let i = 0; i < this.chain.length; i++) {
      const record = this.chain[i];
      if (record.sequenceNumber !== i) return { valid: false, brokenAt: i };
      const expectedPrevious = i === 0 ? "" : this.chain[i - 1].hash;
      if (record.previousHash !== expectedPrevious) {
        return { valid: false, brokenAt: i };
      }
      if (computeNoticeRecordHash(record) !== record.hash) {
        return { valid: false, brokenAt: i };
      }
    }
    return { valid: true, brokenAt: null };
  }

  getAll(): readonly NoticeLogRecord[] {
    return this.chain;
  }

  getLoadState(): NoticeLogLoadState {
    return this.loadState;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  get length(): number {
    return this.chain.length;
  }

  /** True when a path was injected at all. The census reads this. */
  get hasDeclaredPath(): boolean {
    return this.path !== null;
  }

  /** True when a head committer was injected at all. The census reads this. */
  get hasHeadCommitter(): boolean {
    return this.headCommitter !== undefined;
  }

  /** The modality declared on every head this book commits. The census reads it. */
  get declaredModality(): Modality {
    return this.modality;
  }
}

/** Build the record input for one raising. Kept here so the shape has one home. */
export function noticeLogInput(
  envelope: NoticeEnvelope,
  attempts: readonly DeliveryAttempt[]
): NoticeLogRecordInput {
  return {
    sourceId: envelope.sourceId,
    kind: envelope.kind,
    lines: [...envelope.lines],
    envelopeSequence: envelope.sequence,
    attempts: attempts.map((attempt) => ({ ...attempt })),
  };
}
