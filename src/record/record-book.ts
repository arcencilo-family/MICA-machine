// ── MICA · the RECORD BOOK — the second book at the registrar's door ──────
//
// S134 Rb (the arbiter), on the beat-1 receipt's PATH 2. Pilot 9 rung 1 needs a place
// to put three facts that are NOT pre-commitments, and the beat-1 read found
// there was nowhere: `PrecommitBook`'s kinds are closed at COMMITMENT / REVEAL /
// GRADING / ANCHOR, every one of them part of the commitment -> reveal ->
// grading discipline, and `Registrar.append()` reaches them through exactly
// three calls.
//
// ── WHY A SECOND BOOK AND NOT TWO MORE KINDS IN THE FIRST ─────────────
//
//   An ESCALATION has no `ref`, no seal and no verdict. Teaching the
//   pre-commitment book to hold one would mean `openCommitments()` skipping
//   kinds, `resolveAnchorable()` growing cases, and `verify()` standing over a
//   chain whose records no longer share a discipline. That book gates MICA's
//   whole "you said it before you saw it" property; it is the one instrument
//   that must keep meaning exactly what it says.
//
//   So: same door, second book. The registrar's identity check (owner uid), its
//   E.1 §2 entitlement table, its refusal log and its frame consumption are
//   act-agnostic and carry these three kinds unchanged. Only `append()` forks.
//
// ── WHAT THIS BOOK CERTIFIES: NOTHING ──────────────────────────
//
//   It records that a named depositor deposited a named kind at a named time,
//   and that the entry sits in a chain whose hashes reproduce. It does not say
//   the escalation was warranted, the request was answered, or the review was
//   correct. Rung 1 is "a record or the absence of one" and NOTHING answers in
//   pilot 9.
//
// ── THE HEAD IS THE REGISTRAR'S SEAM, UNDER THIS BOOK'S OWN CHAIN ID ────
//
//   `Registrar.append()` commits the head, not the book, and namespaces it by
//   `chain_id` under a `<domain>:<owner>` grammar. This book's chain has its own
//   sequence numbers, so it MUST have its own namespace — `record:<book>`, never
//   `precommit:<book>` — or two chains would present two different records as
//   seq 3 of one chain at the witness.
//
//   THERE IS NO ANCHOR RECORD HERE, and that is named rather than silent. In the
//   pre-commitment book an ANCHOR is a fifth kind written INTO the chain saying
//   whether the head was dropped. Rb closed this book's kinds at three, so
//   writing an anchor would widen a list the arbiter has just closed. The head's
//   outcome is REPORTED by the deposit result and not recorded in-chain. The gap
//   is named-head-owed and argued in the S134 beat-2 receipt.

import { createHash } from "crypto";
import { statSync } from "fs";
import type { Stats } from "fs";
import { dirname } from "path";

import { appendStoreTransaction, resyncAppendStore } from "../mica/store/append-store";
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
import { MODALITIES } from "../witness/types";
import type { Modality } from "../witness/types";

export const THE_RECORD_BOOK_CERTIFIES_NOTHING =
  "The record book records that a named depositor deposited a named kind at a " +
  "named time, in a chain whose hashes reproduce. It does not say the " +
  "escalation was warranted, the request was answered, or the review was " +
  "correct. Nothing in pilot 9 answers a record.";

export const THE_RECORD_STORE_LOCATION_IS_UNDESIGNATED =
  "The record book's directory is a DEPLOYMENT ACT at stated modes. Nothing in " +
  "this module creates it: a custodian that made its own room would make it " +
  "with the wrong permissions and hide a missing step behind a working test.";

/** The three kinds. CLOSED — Rb. A fourth is a different book or a new ruling. */
export type RecordKind = "ESCALATION" | "REQUEST" | "PILOT_CHAIN_REVIEWED";

export const RECORD_KINDS: readonly RecordKind[] = [
  "ESCALATION",
  "REQUEST",
  "PILOT_CHAIN_REVIEWED",
];

/** `<domain>:<owner>`, the grammar `precommitChainId` already takes. */
export function recordChainId(book: string): string {
  return `record:${book}`;
}

interface RecordFrame {
  readonly sequenceNumber: number;
  readonly previousHash: string;
  readonly hash: string;
  /** The DEPOSITOR'S wall clock. A cross-check arrow, never the ruling one. */
  readonly timestamp: number;
  readonly modality: Modality;
  /** The principal the registrar read off the frame's owner uid. Never claimed. */
  readonly depositor: string;
  /** Whose book this is. Own-book only for all three kinds (Rb). */
  readonly book: string;
}

/**
 * What an addressed header produced. `addressee` is the ROSTER title the reader
 * resolved; `addresseeVerbatim` is what the reply actually wrote. Both, always —
 * 1c's rule: the resolved title rides BESIDE the text, never instead of it.
 */
export interface AddressedRecordFields {
  readonly addressee: string;
  readonly addresseeVerbatim: string;
  /** The RECORD NEEDED line, verbatim. The thing that is waited for. */
  readonly recordNeeded: string;
  readonly captureSha256: string;
  readonly runId: string;
  readonly scenarioId: string;
  readonly variant: string;
}

export interface EscalationRecord extends RecordFrame, AddressedRecordFields {
  readonly kind: "ESCALATION";
}

export interface RequestRecord extends RecordFrame, AddressedRecordFields {
  readonly kind: "REQUEST";
}

export interface PilotChainReviewedRecord extends RecordFrame {
  readonly kind: "PILOT_CHAIN_REVIEWED";
  readonly chainSha256: string;
  readonly reviewLogSequenceNumber: number;
}

export type RecordBookRecord = EscalationRecord | RequestRecord | PilotChainReviewedRecord;

/**
 * Written as a union of three Omits rather than `Omit<RecordBookRecord, "hash">`
 * — Omit over a union collapses to the keys the members have in COMMON, which
 * would drop every payload field out of the preimage and leave a chain verifying
 * over nothing but the frame. The same trap precommit.ts names.
 */
export type UnhashedRecordBookRecord =
  | Omit<EscalationRecord, "hash">
  | Omit<RequestRecord, "hash">
  | Omit<PilotChainReviewedRecord, "hash">;

const US = "\u001f";

function lengthPrefixed(value: string): string {
  return `${String(value.length)}:${value}`;
}

/**
 * The chained hash. Field order is fixed and explicit, never taken from
 * `JSON.stringify` of an object literal, so a future field reordering cannot
 * silently rewrite every hash in an existing book.
 *
 * `kind`, `modality`, `depositor` and `book` are ALL in the preimage. A
 * depositor stored but not hashed could be swapped on disk with the chain still
 * verifying — and "who deposited this" is the entire reason this book exists
 * rather than a journal line the depositor writes about itself.
 *
 * DOMAIN-SEPARATED from the pre-commitment chain by its own leading tag: a
 * record-book hash can never be presented as a pre-commitment hash or the
 * reverse.
 */
export function computeRecordBookHash(r: UnhashedRecordBookRecord): string {
  const head = [
    "MICA-RUNG1-CHAIN-v1",
    String(r.sequenceNumber),
    r.previousHash,
    String(r.timestamp),
    r.modality,
    r.kind,
    lengthPrefixed(r.depositor),
    lengthPrefixed(r.book),
  ];
  const tail = ((): string[] => {
    switch (r.kind) {
      case "ESCALATION":
      case "REQUEST":
        return [
          lengthPrefixed(r.addressee),
          lengthPrefixed(r.addresseeVerbatim),
          lengthPrefixed(r.recordNeeded),
          r.captureSha256,
          lengthPrefixed(r.runId),
          lengthPrefixed(r.scenarioId),
          lengthPrefixed(r.variant),
        ];
      case "PILOT_CHAIN_REVIEWED":
        return [r.chainSha256, String(r.reviewLogSequenceNumber)];
    }
  })();
  return createHash("sha256").update([...head, ...tail].join(US), "utf8").digest("hex");
}

// ── validation — closed shapes, refused rather than repaired ───────────

const FRAME_KEYS = [
  "sequenceNumber",
  "previousHash",
  "hash",
  "timestamp",
  "modality",
  "depositor",
  "book",
  "kind",
];

const ADDRESSED_KEYS = [
  ...FRAME_KEYS,
  "addressee",
  "addresseeVerbatim",
  "recordNeeded",
  "captureSha256",
  "runId",
  "scenarioId",
  "variant",
];

const REVIEWED_KEYS = [...FRAME_KEYS, "chainSha256", "reviewLogSequenceNumber"];

const SHA256 = /^[0-9a-f]{64}$/;

function validateFrame(o: Parsed): boolean {
  return (
    isNonNegInteger(o.sequenceNumber) &&
    isString(o.previousHash) &&
    isString(o.hash) &&
    isFiniteNumber(o.timestamp) &&
    isEnum(o.modality, MODALITIES) &&
    isString(o.depositor) &&
    (o.depositor as string).length > 0 &&
    isString(o.book) &&
    (o.book as string).length > 0
  );
}

export function validateRecordBookRecord(x: unknown): RecordBookRecord | null {
  if (!isObject(x)) return null;
  const o = x as Parsed;
  if (!isEnum(o.kind, RECORD_KINDS)) return null;
  if (o.kind === "PILOT_CHAIN_REVIEWED") {
    if (!hasExactKeys(o, REVIEWED_KEYS)) return null;
    if (!validateFrame(o)) return null;
    if (!isString(o.chainSha256) || !SHA256.test(o.chainSha256 as string)) return null;
    if (!isNonNegInteger(o.reviewLogSequenceNumber)) return null;
    return x as unknown as RecordBookRecord;
  }
  if (!hasExactKeys(o, ADDRESSED_KEYS)) return null;
  if (!validateFrame(o)) return null;
  for (const k of [
    "addressee",
    "addresseeVerbatim",
    "recordNeeded",
    "runId",
    "scenarioId",
    "variant",
  ]) {
    if (!isString(o[k]) || (o[k] as string).length === 0) return null;
  }
  if (!isString(o.captureSha256) || !SHA256.test(o.captureSha256 as string)) return null;
  return x as unknown as RecordBookRecord;
}

// ── refusals and the deployment act ─────────────────────────

export class RecordBookRefused extends Error {}

export class RecordBookDeploymentActMissing extends Error {
  constructor(message: string, readonly dir: string, readonly cause?: unknown) {
    super(message);
  }
}

function requireRecordStoreDir(dir: string): void {
  const signpost =
    `record book directory absent — this is a DEPLOYMENT ACT at stated modes ` +
    `and nothing here creates it. Expected: ${dir}, registrar-owned, group-read ` +
    `mica-readers. Nothing was created. ${THE_RECORD_STORE_LOCATION_IS_UNDESIGNATED}`;
  let stats: Stats;
  try {
    stats = statSync(dir);
  } catch (err) {
    throw new RecordBookDeploymentActMissing(`${signpost} (${String(err)})`, dir, err);
  }
  if (!stats.isDirectory()) {
    throw new RecordBookDeploymentActMissing(
      `${signpost} That path exists and is not a directory.`,
      dir
    );
  }
}

export type RecordFileLook =
  | { readonly state: "PRESENT" }
  | { readonly state: "ABSENT" }
  | { readonly state: "CANNOT_SEE"; readonly detail: string };

/**
 * "I was not allowed to look" is never "it is not there". ENOENT is the ONLY
 * errno that means the book is absent; every other one is a fact about this
 * process's access and is reported as itself.
 */
export function lookAtRecordFile(path: string): RecordFileLook {
  try {
    statSync(path);
    return { state: "PRESENT" };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { state: "ABSENT" };
    return { state: "CANNOT_SEE", detail: `${code ?? "no errno"}: ${String(err)}` };
  }
}

export type RecordBookLoadState = "IN_MEMORY" | "LOADED" | "FRESH" | "CANNOT_VERIFY";

export interface RecordBookVerifyResult {
  readonly ok: boolean;
  /** 1-indexed chain position of the first break, or null when the chain holds. */
  readonly brokenAt: number | null;
  /** The book's own word for what it found. EMPTY is not the same as verified. */
  readonly state: "EMPTY" | "VERIFIED" | "BROKEN";
  readonly detail: string;
}

export interface RecordBookOptions {
  readonly path?: string;
  readonly appender?: LineAppender;
  readonly acquire?: LockAcquirer;
}

export interface RecordBookOutcome<R extends RecordBookRecord> {
  readonly record: R;
  readonly persisted: boolean;
  readonly detail: string | null;
}

export interface WriteAddressedInput extends AddressedRecordFields {
  readonly kind: "ESCALATION" | "REQUEST";
  readonly depositor: string;
  readonly book: string;
  readonly timestamp: number;
  readonly modality: Modality;
}

export interface WriteReviewedInput {
  readonly depositor: string;
  readonly book: string;
  readonly timestamp: number;
  readonly modality: Modality;
  readonly chainSha256: string;
  readonly reviewLogSequenceNumber: number;
}

/**
 * Append-only rung-1 records. Read by no sensor and by no gate. It answers one
 * question and refuses every other: is this fact in the book, deposited by whom.
 */
export class RecordBook {
  private readonly chain: RecordBookRecord[] = [];
  private readonly path: string | null;
  private readonly appender?: LineAppender;
  private readonly acquire?: LockAcquirer;
  private loadState: RecordBookLoadState = "IN_MEMORY";
  private persisting = false;
  private lastError: string | null = null;

  constructor(options?: RecordBookOptions) {
    this.path = options?.path ?? null;
    this.appender = options?.appender;
    this.acquire = options?.acquire;
    if (this.path !== null) this.loadFromDisk();
  }

  private loadFromDisk(): void {
    const path = this.path as string;
    // The precondition BEFORE the book: a regular file standing where the
    // directory belongs makes statSync fail ENOTDIR, which the look would
    // classify CANNOT_SEE — trading a typed "somebody put a file where the
    // deployment act goes" for a vague "I could not look".
    requireRecordStoreDir(dirname(path));
    const look = lookAtRecordFile(path);
    if (look.state === "CANNOT_SEE") {
      this.loadState = "CANNOT_VERIFY";
      this.lastError =
        `the record book could not be looked at, which is NOT the finding that ` +
        `it is absent — this process cannot see ${path} (${look.detail}). ` +
        `Nothing was created and this book is NOT in a persisting state.`;
      this.persisting = false;
      return;
    }
    if (look.state === "ABSENT") {
      // A book that is not there yet is a FIRST BOOT, not a failure: the
      // DIRECTORY is the deployment act, the file is this book's to open.
      this.loadState = "FRESH";
      this.persisting = true;
      return;
    }
    const detail = this.resyncUnderLock();
    if (detail !== null) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError = detail;
      this.persisting = false;
      return;
    }
    this.loadState = "LOADED";
    this.persisting = true;
  }

  private resyncUnderLock(): string | null {
    const result = resyncAppendStore<RecordBookRecord>({
      path: this.path as string,
      known: this.chain,
      validate: validateRecordBookRecord,
      recomputeHash: (record) => computeRecordBookHash(record),
    });
    if (!result.linked) return result.detail;
    for (const record of result.extension) this.chain.push(record);
    return null;
  }

  private transact<R extends RecordBookRecord>(
    label: string,
    build: () => Omit<R, "hash">
  ): RecordBookOutcome<R> {
    const outcome = appendStoreTransaction<R>({
      path: this.path,
      persisting: this.persisting,
      lastError: this.lastError,
      storeLabel: "record book",
      prepare: () => {
        // Every refusal this book makes is raised HERE or before, and a throw
        // from `prepare` propagates out with the lock released and nothing
        // appended. A refused act leaves no trace, which is correct: it is not a
        // finding about a record, it is a statement the chain has no shape to
        // hold.
        const unhashed = build() as unknown as UnhashedRecordBookRecord;
        const record = {
          ...unhashed,
          hash: computeRecordBookHash(unhashed),
        } as unknown as R;
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
        `no record book path was injected: this ${label} is IN MEMORY only and ` +
        `does not survive the process. A record nobody else can read is not the ` +
        `second party this book exists to be.`,
      notPersistingDetail:
        `the record book is not in a persisting state; the ${label} was not ` +
        `written to disk.`,
      onAppendBlocked: (detail) => {
        this.lastError = detail;
        return detail;
      },
      onAppendError: (raw) => {
        this.lastError = `cannot append to record book: ${raw}`;
        return this.lastError;
      },
    });
    return { record: outcome.record, persisted: outcome.persisted, detail: outcome.detail };
  }

  /** An ESCALATION or a REQUEST — an addressed header, turned into a record. */
  writeAddressed(
    input: WriteAddressedInput
  ): RecordBookOutcome<EscalationRecord | RequestRecord> {
    if (input.addressee.length === 0) {
      throw new RecordBookRefused(
        `a ${input.kind} with no addressee is not a record. R1′: a record exists ` +
          `only when the header NAMES a seat; an unaddressed decision is counted ` +
          `and writes nothing.`
      );
    }
    if (input.addresseeVerbatim.length === 0) {
      throw new RecordBookRefused(
        `a ${input.kind} carries the seat as the reply WROTE it beside the title ` +
          `this reader resolved. Dropping the verbatim spelling is the fold 1c ` +
          `removed; it is not re-introduced at the book.`
      );
    }
    if (!SHA256.test(input.captureSha256)) {
      throw new RecordBookRefused(
        `captureSha256 must be 64 lowercase hex characters — the record points at ` +
          `the capture it was read from, and a pointer that does not resolve is ` +
          `worse than none.`
      );
    }
    return this.transact<EscalationRecord | RequestRecord>(
      input.kind.toLowerCase(),
      () =>
        ({
          kind: input.kind,
          sequenceNumber: this.chain.length,
          previousHash: this.headHash(),
          timestamp: input.timestamp,
          modality: input.modality,
          depositor: input.depositor,
          book: input.book,
          addressee: input.addressee,
          addresseeVerbatim: input.addresseeVerbatim,
          recordNeeded: input.recordNeeded,
          captureSha256: input.captureSha256,
          runId: input.runId,
          scenarioId: input.scenarioId,
          variant: input.variant,
        }) as Omit<EscalationRecord | RequestRecord, "hash">
    );
  }

  /** A PILOT_CHAIN_REVIEWED — the arbiter's review, in the arbiter's own book. */
  writeReviewed(input: WriteReviewedInput): RecordBookOutcome<PilotChainReviewedRecord> {
    if (!SHA256.test(input.chainSha256)) {
      throw new RecordBookRefused(
        `chainSha256 must be 64 lowercase hex characters — the sha IS the link to ` +
          `the chain reviewed (Rb), and no other field says which chain this was.`
      );
    }
    return this.transact<PilotChainReviewedRecord>("pilot chain review", () => ({
      kind: "PILOT_CHAIN_REVIEWED",
      sequenceNumber: this.chain.length,
      previousHash: this.headHash(),
      timestamp: input.timestamp,
      modality: input.modality,
      depositor: input.depositor,
      book: input.book,
      chainSha256: input.chainSha256,
      reviewLogSequenceNumber: input.reviewLogSequenceNumber,
    }));
  }

  private headHash(): string {
    return this.chain.length === 0 ? "" : this.chain[this.chain.length - 1].hash;
  }

  /**
   * Recompute every hash and every link.
   *
   * AN EMPTY BOOK IS `EMPTY`, NOT `VERIFIED`, and it gets its own word rather
   * than borrowing the other one. A chain with nothing in it has nothing broken;
   * printing that as a pass reads identically to a book full of records that all
   * reproduce, which is the blank mirror this repo keeps refusing.
   */
  verify(): RecordBookVerifyResult {
    if (this.chain.length === 0) {
      return {
        ok: true,
        brokenAt: null,
        state: "EMPTY",
        detail: "EMPTY — no records in this book. Nothing is broken and nothing is attested.",
      };
    }
    let previous = "";
    for (let i = 0; i < this.chain.length; i++) {
      const record = this.chain[i];
      if (record.previousHash !== previous) {
        return {
          ok: false,
          brokenAt: i + 1,
          state: "BROKEN",
          detail: `record ${String(i + 1)} does not link to the one before it.`,
        };
      }
      if (computeRecordBookHash(record) !== record.hash) {
        return {
          ok: false,
          brokenAt: i + 1,
          state: "BROKEN",
          detail: `record ${String(i + 1)} does not reproduce its own hash.`,
        };
      }
      previous = record.hash;
    }
    return {
      ok: true,
      brokenAt: null,
      state: "VERIFIED",
      detail: `${String(this.chain.length)} record(s), every hash and link reproduced.`,
    };
  }

  getAll(): readonly RecordBookRecord[] {
    return this.chain;
  }

  getLoadState(): RecordBookLoadState {
    return this.loadState;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  /** One line for a census: what this book holds, by kind. */
  countsLine(): string {
    const counts = new Map<string, number>();
    for (const r of this.chain) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
    if (counts.size === 0) return "record book: EMPTY";
    return `record book: ${[...counts.entries()].map(([k, n]) => `${String(n)} ${k}`).join(" / ")}`;
  }
}
