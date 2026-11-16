// ── MICA · the chokepoint record — where every PASS-BLIND lands ───────────────
//
// §5: every PASS-BLIND is recorded, ALWAYS — permanent, auditable, no exception,
// not rate-limited. This is that record.
//
// ── WHY A SEPARATE LEDGER, AND NOT THE LOG A SENSOR READS ──────────────────────
//
//   §5, and the residual-wiring round before it, are explicit: writing MICA's
//   own telemetry into the append-only evidence log a sensor reads CORRUPTS the
//   sensor. Eng reads (moduleId, eventType) against `outcome` across the whole
//   log; a stream of chokepoint records accumulating in one event class, read
//   back next run, is the instrument measuring its own footprints. So these
//   records go in a ledger of their OWN — append-only and hash-chained like the
//   evidence log, but read by no sensor, ever.
//
//   This is the ExportLedger pattern (src/mica/export/ledger.ts) applied to a
//   new purpose. It is modelled on it deliberately — same load-state discipline
//   (integrity vs provenance), same injected-path rule, same "a function someone
//   calls, not a daemon" shape — with fields typed for THIS purpose (a
//   disposition, not an artifact). ExportLedger is not imported or modified;
//   duplicating its ~40 lines of chain arithmetic is cheaper than coupling two
//   ledgers whose record shapes have nothing in common.
//
// ── WHAT THIS RECORD IS NOT ────────────────────────────────────────────────────
//
//   It records that an action was PASSED BLIND — could not be read, was below
//   the injected line, and executed anyway. It attests NOTHING about the
//   action's payload or its truth (§7.3). It is an audit trail of the gate's own
//   permissive decisions, so a deployer can later ask "what did we let through
//   unread, and was the line set right?" — nothing more.

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "fs";
import { dirname } from "path";
import type { VerdictKind } from "../types";
import {
  appendStoreTransaction,
  blankLineDetail,
  resyncAppendStore,
  storeLines,
} from "../store/append-store";
import type { AppendResyncTorn, LineAppender, LockAcquirer } from "../store/append-store";
import {
  hasExactKeys,
  isNonNegInteger,
  isObject,
  isString,
  isEnum,
  VERDICT_KINDS,
} from "../store/validate";
import type { Parsed } from "../store/validate";

export interface ChokepointLedgerRecordInput {
  /** The routed action's opaque id (never its payload). */
  readonly actionId: string;
  /** Always "PASS_BLIND" today — this ledger records only passed-blind actions. */
  readonly disposition: "PASS_BLIND";
  /** The composed floor kind at the moment of the decision. */
  readonly floorKind: VerdictKind;
  /** The action's injected impact class, or "" when none was supplied. */
  readonly impactClass: string;
  /** The ids of the sensors whose verdicts were composed, joined by "|". */
  readonly sensorIds: string;
}

export interface ChokepointLedgerRecord extends ChokepointLedgerRecordInput {
  readonly sequenceNumber: number;
  readonly previousHash: string;
  readonly hash: string;
}

/**
 * The chained hash. Field order is fixed and explicit, not taken from
 * JSON.stringify of an object literal, so a future field reordering cannot
 * silently rewrite every hash in an existing ledger.
 */
function computeHash(
  r: ChokepointLedgerRecordInput & {
    sequenceNumber: number;
    previousHash: string;
  }
): string {
  const canonical = [
    String(r.sequenceNumber),
    r.previousHash,
    r.actionId,
    r.disposition,
    r.floorKind,
    r.impactClass,
    r.sensorIds,
  ].join(" ");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export type LedgerLoadState =
  | "IN_MEMORY"
  | "LOADED_VERIFIED"
  | "FIRST_BOOT_OR_ERASED"
  | "CANNOT_VERIFY";

const CHOKEPOINT_RECORD_KEYS: readonly string[] = [
  "actionId",
  "disposition",
  "floorKind",
  "impactClass",
  "sensorIds",
  "sequenceNumber",
  "previousHash",
  "hash",
];

/**
 * Validate a parsed JSON line against the CLOSED chokepoint-record shape (F8).
 * Returns the typed record, or null if any field is missing, mistyped, an unknown
 * enum value, or an unknown extra field is present. A cast is never a validation:
 * a hostile-but-valid JSON line is rejected here, before it reaches the chain.
 */
function validateChokepointRecord(x: unknown): ChokepointLedgerRecord | null {
  if (!isObject(x)) return null;
  const o = x as Parsed;
  if (!hasExactKeys(o, CHOKEPOINT_RECORD_KEYS)) return null;
  if (!isString(o.actionId)) return null;
  if (o.disposition !== "PASS_BLIND") return null;
  if (!isEnum(o.floorKind, VERDICT_KINDS)) return null;
  if (!isString(o.impactClass)) return null;
  if (!isString(o.sensorIds)) return null;
  if (!isNonNegInteger(o.sequenceNumber)) return null;
  if (!isString(o.previousHash)) return null;
  if (!isString(o.hash)) return null;
  return o as unknown as ChokepointLedgerRecord;
}

export interface LedgerVerifyResult {
  readonly valid: boolean;
  readonly brokenAt: number | null;
}

export interface ChokepointLedgerOptions {
  /**
   * Where the ledger is kept. INJECTED, never defaulted — where evidence lands
   * is a deployment decision. Absent means the ledger is IN MEMORY only and does
   * not survive the process, which is reported (getLoadState) rather than
   * papered over. A PASS-BLIND recorded only in memory is NOT durably recorded,
   * and the chokepoint treats it as an undelivered record (fail closed).
   */
  readonly path?: string;
  /**
   * The durable line-appender. A FAULT-INJECTION SEAM, not a policy default:
   * production leaves it absent and a real fs append is used. A test injects one
   * that throws to exercise the transaction contract's fail-then-recover path.
   */
  readonly appender?: LineAppender;
  /**
   * The inter-process append lock. Production leaves this absent and gets
   * `exclusiveFileLock`. A deployment that needs a bounded retry injects it
   * HERE — the ledger holds no timing policy of its own.
   */
  readonly acquire?: LockAcquirer;
}

/** The outcome of recording, so the caller can enforce "always recorded". */
export interface RecordOutcome {
  readonly record: ChokepointLedgerRecord;
  /** True only when the record was appended to a durable, verified-chain file. */
  readonly persisted: boolean;
  /** Why not, when persisted is false. */
  readonly detail: string | null;
}

/**
 * Append-only, hash-chained ledger of PASS-BLIND decisions.
 *
 * Load-state discipline is LockedEvidenceLog's / ExportLedger's, reused because
 * the reasoning is settled: an in-memory chain has INTEGRITY but not PROVENANCE,
 * and an absent-or-empty file is undecidable between first run and erasure.
 */
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
export type LedgerFileLook =
  | { readonly state: "PRESENT" }
  | { readonly state: "ABSENT" }
  | { readonly state: "CANNOT_SEE"; readonly detail: string };

export function lookAtLedgerFile(path: string): LedgerFileLook {
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

/** The signpost handed to a caller that could not look at the ledger. */
export function cannotSeeLedgerMessage(path: string, detail: string): string {
  return (
    `the ledger could not be looked at, which is NOT the finding that it is ` +
    `absent — this process cannot see ${path} (${detail}). A directory whose ` +
    `execute bit is stripped produces exactly this, and no second principal is ` +
    `needed to reach it. Nothing was created, nothing was recorded as a first ` +
    `boot, and this book is NOT in a persisting state.`
  );
}

export class ChokepointLedger {
  private readonly chain: ChokepointLedgerRecord[] = [];
  private readonly path: string | null;
  private readonly appender?: LineAppender;
  private readonly acquire?: LockAcquirer;
  private loadState: LedgerLoadState = "IN_MEMORY";
  private persisting = false;
  private lastError: string | null = null;

  constructor(options?: ChokepointLedgerOptions) {
    this.path = options?.path ?? null;
    this.appender = options?.appender;
    this.acquire = options?.acquire;
    if (this.path === null) return;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    const path = this.path as string;

    const look = lookAtLedgerFile(path);
    if (look.state === "CANNOT_SEE") {
      // NOT FIRST BOOT. See `lookAtLedgerFile`: this was `!existsSync(path)`
      // until S103, and a look that was refused arrived here wearing the absent
      // branch's clothes — with `persisting` set, because the mkdir below
      // succeeds on a directory that exists and cannot be entered.
      this.loadState = "CANNOT_VERIFY";
      this.lastError = cannotSeeLedgerMessage(path, look.detail);
      return;
    }
    if (look.state === "ABSENT") {
      this.loadState = "FIRST_BOOT_OR_ERASED";
      try {
        // mkdirSync RULED in-bounds (S96-D): only the chokepoint's own ledger,
        // written and read back by the same principal; no deployment act names
        // this directory and no other principal is entitled to it. Annotated
        // S97. A recipe section granting it a reader group moves it wrong-side.
        mkdirSync(dirname(path), { recursive: true });
        this.persisting = true;
      } catch (err) {
        this.persisting = false;
        this.lastError = `cannot create ledger directory: ${String(err)}`;
      }
      return;
    }

    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError = `cannot read ledger: ${String(err)}`;
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
      // Closed-shape validation BEFORE the record joins the chain (F8): a cast is
      // not a check, and hostile valid JSON must fail to CANNOT_VERIFY, not crash
      // a later array/hash operation.
      const record = validateChokepointRecord(parsed);
      if (record === null) {
        this.loadState = "CANNOT_VERIFY";
        this.lastError = `record at line ${i} does not match the closed chokepoint-record schema`;
        return;
      }
      this.chain.push(record);
    }

    const v = this.verify();
    if (!v.valid) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError = `ledger chain verification failed at index ${String(
        v.brokenAt
      )}`;
      return;
    }

    if (this.chain.length === 0) {
      this.loadState = "FIRST_BOOT_OR_ERASED";
      this.persisting = true;
      return;
    }

    this.loadState = "LOADED_VERIFIED";
    this.persisting = true;
  }

  /**
   * Append a PASS-BLIND record. Returns whether it was DURABLY persisted, so the
   * chokepoint can fail closed on a record that did not land — §5's "always
   * recorded" is enforced by the caller degrading an unrecorded PASS-BLIND to
   * HOLD-BLIND, not by pretending the write happened.
   */
  /**
   * The disk-truth catch-up, run by the seam while it holds the append lock. The
   * chain loaded at construction may be a stale prefix: another invocation can
   * have appended since. Records that link on are ADOPTED into this chain, so the
   * sequence number derived next is the true one; an extension that does not link
   * adopts nothing and fails the append typed.
   */
  private resyncUnderLock(): string | AppendResyncTorn | null {
    const result = resyncAppendStore<ChokepointLedgerRecord>({
      path: this.path as string,
      known: this.chain,
      validate: validateChokepointRecord,
      recomputeHash: (record) => computeHash(record),
    });
    // A torn file is carried as a torn file, so the seam does not tell the
    // operator another writer forked this book over a line that holds no record.
    if (!result.linked) {
      return result.torn === true
        ? { torn: true, detail: result.detail }
        : result.detail;
    }
    for (const record of result.extension) this.chain.push(record);
    return null;
  }

  record(input: ChokepointLedgerRecordInput): RecordOutcome {
    // Append durably FIRST; commit the node to the live chain ONLY on success.
    // A failed append leaves the committed prefix unchanged, so a later record
    // links to the last on-disk node and can never report a durable pass over a
    // broken disk chain.
    const outcome = appendStoreTransaction<ChokepointLedgerRecord>({
      path: this.path,
      persisting: this.persisting,
      lastError: this.lastError,
      storeLabel: "chokepoint ledger",
      // Derive the candidate over the LAST COMMITTED node — the chain is only
      // ever advanced after a durable append (the F2 transaction contract), so
      // this predecessor is always one that reached disk.
      prepare: () => {
        const sequenceNumber = this.chain.length;
        const previousHash =
          sequenceNumber === 0 ? "" : this.chain[sequenceNumber - 1].hash;
        const hash = computeHash({ ...input, sequenceNumber, previousHash });
        const record: ChokepointLedgerRecord = {
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
        "no ledger path was injected: this record is IN MEMORY only and does " +
        "not survive the process. It carries integrity but not provenance.",
      notPersistingDetail:
        "the ledger is not in a persisting state; the record was not written to disk.",
      onAppendBlocked: (detail) => {
        this.lastError = detail;
        return detail;
      },
      onAppendError: (raw) => {
        this.lastError = `cannot append to ledger: ${raw}`;
        return this.lastError;
      },
    });
    return {
      record: outcome.record,
      persisted: outcome.persisted,
      detail: outcome.detail,
    };
  }

  verify(): LedgerVerifyResult {
    for (let i = 0; i < this.chain.length; i++) {
      const r = this.chain[i];
      if (r.sequenceNumber !== i) return { valid: false, brokenAt: i };
      const expectedPrev = i === 0 ? "" : this.chain[i - 1].hash;
      if (r.previousHash !== expectedPrev) return { valid: false, brokenAt: i };
      if (computeHash(r) !== r.hash) return { valid: false, brokenAt: i };
    }
    return { valid: true, brokenAt: null };
  }

  getAll(): readonly ChokepointLedgerRecord[] {
    return this.chain;
  }

  getLoadState(): LedgerLoadState {
    return this.loadState;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  get length(): number {
    return this.chain.length;
  }
}
