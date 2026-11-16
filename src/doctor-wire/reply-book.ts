// ── MICA · doctor wire — the reply book ──────────────────────────────────────
//
// WHAT THIS BOOK HOLDS
//
//   One record per reply that arrived on the declared path: the role it is
//   recorded under, the raising it answers, and its own place in this chain.
//   That is all. The wording this wire uses for it is "reply recorded" — never
//   that a person read, knew, agreed, or did anything about the raising.
//
// HOW A REPLY NAMES ITS RAISING (audit condition, 2026-11-02)
//
//   By the notice book's own record `sequenceNumber` AND record `hash`, never by
//   the envelope's caller-supplied `sequence`. The envelope sequence is supplied
//   by whoever raised, and a fresh process can repeat it; the record pair is the
//   chain's own and cannot collide inside one verified book.
//
// WHY IT IS NOT IN notify/
//
//   notify is door-pinned and holds a ruled ceiling: an attempt is the most it
//   can say. A reply is a second fact from outside that ceiling, so it gets its
//   own book beside notify, and notify stays exactly as it is. The same ceilings
//   hold here anyway: no timer, no adequacy judgement, no retry, no second knock.
//   This book authors no time. Nothing here asks for a reply or waits for one.
//
// CHAIN ARITHMETIC IS LOCAL, LIKE EVERY SIBLING'S
//
//   The hash pattern is the notice book's (unit separator, fixed field order),
//   restated rather than imported, for the reason that book gives: one book's
//   evolution must not rewrite another's evidence format. The append contract
//   IS imported — `appendStoreTransaction` with its lock and re-sync — because
//   its ordering guarantee must not drift between stores.
//
// UNLIKE THE NOTICE BOOK, IT CREATES NO DIRECTORY. The notice book's mkdir is
// ruled for notify's own book (S96-D). This book's directory is the deployer's
// to make; if it is missing, the append fails and says so.

import { createHash } from "crypto";
import { readFileSync, statSync } from "fs";

import { RECIPIENT_ROLES } from "../mica/notify";
import type { RecipientRole } from "../mica/notify";
import {
  appendStoreTransaction,
  blankLineDetail,
  resyncAppendStore,
  storeLines,
} from "../mica/store/append-store";
import type { AppendResyncTorn, LineAppender, LockAcquirer } from "../mica/store/append-store";
import { hasExactKeys, isEnum, isNonNegInteger, isObject, isString } from "../mica/store/validate";
import type { Parsed } from "../mica/store/validate";

export interface ReplyRecordInput {
  readonly role: RecipientRole;
  /** The notice book record's sequenceNumber. */
  readonly answersSequenceNumber: number;
  /** The notice book record's hash. */
  readonly answersHash: string;
}

export interface ReplyRecord extends ReplyRecordInput {
  readonly sequenceNumber: number;
  readonly previousHash: string;
  readonly hash: string;
}

const RECORD_KEYS = [
  "role",
  "answersSequenceNumber",
  "answersHash",
  "sequenceNumber",
  "previousHash",
  "hash",
] as const;

const US = "\u001f";

/** The chained hash, over a fixed field order. See the notice book's note. */
export function computeReplyRecordHash(
  r: ReplyRecordInput & { sequenceNumber: number; previousHash: string }
): string {
  const preimage = [
    String(r.sequenceNumber),
    r.previousHash,
    r.role,
    String(r.answersSequenceNumber),
    r.answersHash,
  ].join(US);
  return createHash("sha256").update(preimage, "utf8").digest("hex");
}

const HEX64 = /^[0-9a-f]{64}$/;

function validateReplyRecord(value: unknown): ReplyRecord | null {
  if (!isObject(value) || !hasExactKeys(value as Parsed, RECORD_KEYS)) return null;
  const o = value as Parsed;
  if (!isEnum(o.role, RECIPIENT_ROLES)) return null;
  if (!isNonNegInteger(o.answersSequenceNumber)) return null;
  if (!isString(o.answersHash) || !HEX64.test(o.answersHash)) return null;
  if (!isNonNegInteger(o.sequenceNumber)) return null;
  if (!isString(o.previousHash)) return null;
  if (!isString(o.hash)) return null;
  return o as unknown as ReplyRecord;
}

/** Same vocabulary as the sibling books' load state. */
export type ReplyBookLoadState =
  | "IN_MEMORY"
  | "LOADED_VERIFIED"
  | "FIRST_BOOT_OR_ERASED"
  | "CANNOT_VERIFY";

export interface ReplyBookOptions {
  /** Declared path. Absent means IN_MEMORY, never durable. */
  readonly path?: string;
  /** Fault-injection seam. Production leaves this absent. */
  readonly appender?: LineAppender;
  /** The inter-process append lock. Absent gets `exclusiveFileLock`. */
  readonly acquire?: LockAcquirer;
}

export interface ReplyBookOutcome {
  readonly record: ReplyRecord;
  readonly persisted: boolean;
  readonly detail: string | null;
}

export class ReplyBook {
  private readonly chain: ReplyRecord[] = [];
  private readonly path: string | null;
  private readonly appender?: LineAppender;
  private readonly acquire?: LockAcquirer;
  private loadState: ReplyBookLoadState = "IN_MEMORY";
  private persisting = false;
  private lastError: string | null = null;

  constructor(options?: ReplyBookOptions) {
    this.path = options?.path ?? null;
    this.appender = options?.appender;
    this.acquire = options?.acquire;
    if (this.path !== null) this.loadFromDisk();
  }

  private loadFromDisk(): void {
    const path = this.path as string;
    try {
      statSync(path);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // ENOENT is the only errno that means the book is not there; any other one
      // means the question was not answered (the notice book's S103 lesson).
      if (code === "ENOENT") {
        this.loadState = "FIRST_BOOT_OR_ERASED";
        this.persisting = true;
      } else {
        this.loadState = "CANNOT_VERIFY";
        this.lastError =
          `the reply book could not be looked at, which is NOT the finding that it is ` +
          `absent (${code ?? "no errno"}: ${String(err)})`;
      }
      return;
    }

    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError = `cannot read reply book: ${String(err)}`;
      return;
    }
    const scan = storeLines(raw);
    if (!scan.ok) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError = blankLineDetail(scan.index, scan.count);
      return;
    }
    for (let i = 0; i < scan.lines.length; i++) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(scan.lines[i]);
      } catch (err) {
        this.loadState = "CANNOT_VERIFY";
        this.lastError = `malformed JSON at line ${i}: ${String(err)}`;
        return;
      }
      const record = validateReplyRecord(parsed);
      if (record === null) {
        this.loadState = "CANNOT_VERIFY";
        this.lastError = `record at line ${i} does not match the closed reply-book schema`;
        return;
      }
      this.chain.push(record);
    }
    const verification = this.verify();
    if (!verification.valid) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError = `reply-book chain verification failed at index ${String(verification.brokenAt)}`;
      return;
    }
    this.loadState = this.chain.length === 0 ? "FIRST_BOOT_OR_ERASED" : "LOADED_VERIFIED";
    this.persisting = true;
  }

  /** The disk-truth catch-up under the lock; another process may have appended. */
  private resyncUnderLock(): string | AppendResyncTorn | null {
    const result = resyncAppendStore<ReplyRecord>({
      path: this.path as string,
      known: this.chain,
      validate: validateReplyRecord,
      recomputeHash: (record) => computeReplyRecordHash(record),
    });
    if (!result.linked) {
      return result.torn === true ? { torn: true, detail: result.detail } : result.detail;
    }
    for (const record of result.extension) this.chain.push(record);
    return null;
  }

  /** Append one reply. Its sequence number is its index in this chain. */
  record(input: ReplyRecordInput): ReplyBookOutcome {
    const outcome = appendStoreTransaction<ReplyRecord>({
      path: this.path,
      persisting: this.persisting,
      lastError: this.lastError,
      storeLabel: "reply book",
      prepare: () => {
        const sequenceNumber = this.chain.length;
        const previousHash = sequenceNumber === 0 ? "" : this.chain[sequenceNumber - 1].hash;
        const record: ReplyRecord = {
          role: input.role,
          answersSequenceNumber: input.answersSequenceNumber,
          answersHash: input.answersHash,
          sequenceNumber,
          previousHash,
          hash: computeReplyRecordHash({ ...input, sequenceNumber, previousHash }),
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
        "no reply-book path was declared: this record is IN MEMORY only and does not " +
        "survive the process.",
      notPersistingDetail: "the reply book is not in a persisting state; the record was not written to disk.",
      onAppendBlocked: (detail) => {
        this.lastError = detail;
        return detail;
      },
      onAppendError: (raw) => {
        this.lastError = `cannot append to reply book: ${raw}`;
        return this.lastError;
      },
    });
    return { record: outcome.record, persisted: outcome.persisted, detail: outcome.detail };
  }

  verify(): { readonly valid: boolean; readonly brokenAt: number | null } {
    for (let i = 0; i < this.chain.length; i++) {
      const record = this.chain[i];
      if (record.sequenceNumber !== i) return { valid: false, brokenAt: i };
      const expectedPrevious = i === 0 ? "" : this.chain[i - 1].hash;
      if (record.previousHash !== expectedPrevious) return { valid: false, brokenAt: i };
      if (computeReplyRecordHash(record) !== record.hash) return { valid: false, brokenAt: i };
    }
    return { valid: true, brokenAt: null };
  }

  getAll(): readonly ReplyRecord[] {
    return this.chain;
  }

  getLoadState(): ReplyBookLoadState {
    return this.loadState;
  }

  getLastError(): string | null {
    return this.lastError;
  }
}
