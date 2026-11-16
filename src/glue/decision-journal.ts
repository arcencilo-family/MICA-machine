// ── GLUE · the decision journal — PREPARED / FINAL, two-phase (Amendment 1) ──
//
// WHAT THIS IS, AND WHY IT CHANGED
//
//   The first Stage 1 build injected the file-backed `FloorTrail` /
//   `ChokepointLedger` straight into `guard()`, so the mandatory floor reading
//   and the mandatory PASS-BLIND record landed on disk BEFORE the canonical
//   `DECISION_COMMITTED` existed. The verifier's return (Blocker 1) named the
//   defect precisely: a journal-commit failure could leave a real trail/ledger
//   record about a decision that was never canonically committed, and a crash
//   between those two writes left orphans the journal's own replay could not
//   see, own, or repair.
//
//   Amendment 1's fix, implemented here exactly: `guard()`'s two mandatory
//   writes now land INSIDE this journal, as `DECISION_PREPARED` (the floor
//   reading) and `PASSBLIND_PREPARED` (the PASS-BLIND record), via journal-
//   backed subclasses of `FloorTrail`/`ChokepointLedger` (see
//   `evaluate-and-record.ts`). Nothing is returned as executable before
//   `DECISION_FINAL` — a fourth record type, written by the wrapper AFTER
//   `guard()` returns — is durably appended. The real trail/ledger FILES (same
//   classes, same on-disk format G2's `trailLookup` already reads) are written
//   by the wrapper as ordinary repairable projections, strictly AFTER
//   `DECISION_FINAL`, alongside history and the event book.
//
//   This file reuses the ONE append-store transaction contract every durable
//   book in this substrate adopts (`src/mica/store/append-store.ts`) rather
//   than re-deriving the ordering, the lock, or the re-sync. `src/mica/**` is
//   imported here, never edited.
//
// ── THE FOUR RECORD TYPES ─────────────────────────────────────────────────────
//
//   DECISION_PREPARED   — the floor reading `guard()` took, mid-evaluation.
//   PASSBLIND_PREPARED  — the PASS-BLIND record `guard()` took, mid-evaluation
//                          (only when the raw disposition is PASS_BLIND).
//   DECISION_FINAL      — the ONE mandatory boundary. Nothing executable is
//                          returned before this is durable.
//   PROJECTION_DONE /
//   PROJECTION_FAILED   — repairable projections, written strictly after a
//                          DECISION_FINAL for the same identity.
//
// ── REPLAY (§5 of the amendment) ──────────────────────────────────────────────
//
//   Identity present with a FINAL -> that FINAL's decision is authoritative;
//   same requestHash replays byte-identical, different requestHash is
//   CONFLICT. Identity present with PREPARED/PASSBLIND_PREPARED lines but NO
//   FINAL -> those lines are a QUARANTINED EVALUATION: not a decision. A retry
//   evaluates completely afresh (new PREPARED, new FINAL); the orphan lines
//   are never treated as authoritative and are reported by
//   `orphanPreparedFor`. No file book may ever carry an identity that has no
//   preceding DECISION_FINAL — enforced by construction: the wrapper never
//   opens the real trail/ledger/history/events books until after FINAL lands.
//
// ── CANONICAL JSON, PINNED ────────────────────────────────────────────────────
//
//   Keys sorted recursively, UTF-8, strings NFC-normalized, `undefined`
//   (object keys only) omitted, `null` kept, no whitespace.

import { createHash } from "crypto";
import { readFileSync } from "fs";
import {
  appendLockPath,
  appendStoreTransaction,
  durableLineAppender,
  exclusiveFileLock,
  resyncAppendStore,
} from "../mica/store/append-store";
import type {
  AppendOutcome,
  LineAppender,
  LockAcquirer,
} from "../mica/store/append-store";
import {
  hasExactKeys,
  isEnum,
  isFiniteNumber,
  isNonNegInteger,
  isObject,
  isString,
  VERDICT_KINDS,
} from "../mica/store/validate";
import type { Parsed } from "../mica/store/validate";

// ── canonical JSON (§4) ────────────────────────────────────────────────────────

function canonicalValue(v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string") return v.normalize("NFC");
  if (Array.isArray(v)) {
    return v.map((e) => {
      const c = canonicalValue(e);
      return c === undefined ? null : c;
    });
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(o).sort()) {
      const c = canonicalValue(o[key]);
      if (c !== undefined) out[key] = c;
    }
    return out;
  }
  return v;
}

/** Canonical JSON: sorted keys, NFC strings, undefined omitted, null kept, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function sha256Hex(bytes: string): string {
  return createHash("sha256").update(bytes, "utf8").digest("hex");
}

/** sha256 over the canonical JSON of `value`. */
export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

// ── the three canonical-JSON hash fixtures the brief asks for ────────────────

export const CANONICAL_JSON_FIXTURE_1_INPUT = { b: 2, a: 1 } as const;
export const CANONICAL_JSON_FIXTURE_1_HASH = canonicalHash(
  CANONICAL_JSON_FIXTURE_1_INPUT
);

export const CANONICAL_JSON_FIXTURE_2_INPUT = {
  z: "café",
  a: [3, 1, 2],
  n: null,
  u: undefined,
} as const;
export const CANONICAL_JSON_FIXTURE_2_HASH = canonicalHash(
  CANONICAL_JSON_FIXTURE_2_INPUT
);

export const CANONICAL_JSON_FIXTURE_3_INPUT = {
  identity: { subject: "richards-cat", sessionId: "s1", actionId: "a1" },
  nested: { z: 1, y: { b: 2, a: 1 }, a: [1, 2, 3] },
} as const;
export const CANONICAL_JSON_FIXTURE_3_HASH = canonicalHash(
  CANONICAL_JSON_FIXTURE_3_INPUT
);

// ── identity ───────────────────────────────────────────────────────────────────

export interface DecisionIdentity {
  readonly subject: string;
  readonly sessionId: string;
  readonly actionId: string;
}

export function identityKey(identity: DecisionIdentity): string {
  return canonicalJson({
    subject: identity.subject,
    sessionId: identity.sessionId,
    actionId: identity.actionId,
  });
}

export type ProjectionKind = "trail" | "ledger" | "history" | "events";
export const PROJECTION_KINDS: readonly ProjectionKind[] = [
  "trail",
  "ledger",
  "history",
  "events",
];

// ── declaration binding (Blocker 3) ───────────────────────────────────────────
//
// Never a fabricated digest occupying the same field as a real one. A
// DECISION_FINAL either carries a real declaration hash (HASH) or says plainly
// that this evaluation ran with no declaration bound at all (UNBOUND_STAGE_1)
// — a value that cannot be parsed as a sha256 and cannot be mistaken for one.

export type DeclarationBinding =
  | { readonly kind: "HASH"; readonly sha256: string }
  | { readonly kind: "UNBOUND_STAGE_1" };

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function isDeclarationBinding(x: unknown): x is DeclarationBinding {
  if (!isObject(x)) return false;
  if (x.kind === "UNBOUND_STAGE_1") return hasExactKeys(x, ["kind"]);
  if (x.kind === "HASH") {
    return hasExactKeys(x, ["kind", "sha256"]) && isString(x.sha256) && SHA256_HEX.test(x.sha256);
  }
  return false;
}

// ── the floor / pass-blind readings carried on PREPARED lines ────────────────

export interface PreparedFloorReading {
  readonly timestamp: number;
  readonly actionId: string;
  readonly disposition: string; // raw disposition, pre-delivery
  readonly floorKind: string;
  readonly blindSplit: string;
  readonly impactClass: string;
  readonly sensorIds: string;
  readonly sensorKinds: string;
}

export interface PreparedPassBlindReading {
  readonly actionId: string;
  readonly disposition: "PASS_BLIND";
  readonly floorKind: string;
  readonly impactClass: string;
  readonly sensorIds: string;
}

// ── the four record types ─────────────────────────────────────────────────────

export interface DecisionPreparedRecord {
  readonly recordType: "DECISION_PREPARED";
  readonly sequenceNumber: number;
  readonly previousHash: string;
  readonly identity: DecisionIdentity;
  readonly requestHash: string;
  readonly declarationBinding: DeclarationBinding;
  readonly floorReading: PreparedFloorReading;
  readonly at: number;
  readonly hash: string;
}

export interface PassBlindPreparedRecord {
  readonly recordType: "PASSBLIND_PREPARED";
  readonly sequenceNumber: number;
  readonly previousHash: string;
  readonly identity: DecisionIdentity;
  readonly requestHash: string;
  readonly declarationBinding: DeclarationBinding;
  readonly passBlindReading: PreparedPassBlindReading;
  readonly at: number;
  readonly hash: string;
}

export interface DecisionFinalRecord {
  readonly recordType: "DECISION_FINAL";
  readonly sequenceNumber: number;
  readonly previousHash: string;
  readonly identity: DecisionIdentity;
  readonly requestHash: string;
  readonly declarationBinding: DeclarationBinding;
  /** The immutable response object. Never rewritten once final. */
  readonly decision: Record<string, unknown>;
  readonly decisionHash: string;
  readonly at: number;
  readonly hash: string;
}

export interface ProjectionMarkerRecord {
  readonly recordType: "PROJECTION_DONE" | "PROJECTION_FAILED";
  readonly sequenceNumber: number;
  readonly previousHash: string;
  readonly identity: DecisionIdentity;
  readonly projection: ProjectionKind;
  readonly detail: string | null;
  readonly at: number;
  readonly hash: string;
}

export type JournalRecord =
  | DecisionPreparedRecord
  | PassBlindPreparedRecord
  | DecisionFinalRecord
  | ProjectionMarkerRecord;

// ── closed-shape validation ───────────────────────────────────────────────────

function isIdentity(x: unknown): x is DecisionIdentity {
  if (!isObject(x)) return false;
  if (!hasExactKeys(x, ["subject", "sessionId", "actionId"])) return false;
  return isString(x.subject) && isString(x.sessionId) && isString(x.actionId);
}

function isFloorReading(x: unknown): x is PreparedFloorReading {
  if (!isObject(x)) return false;
  if (
    !hasExactKeys(x, [
      "timestamp",
      "actionId",
      "disposition",
      "floorKind",
      "blindSplit",
      "impactClass",
      "sensorIds",
      "sensorKinds",
    ])
  ) {
    return false;
  }
  return (
    isFiniteNumber(x.timestamp) &&
    isString(x.actionId) &&
    isString(x.disposition) &&
    isEnum(x.floorKind, VERDICT_KINDS) &&
    isString(x.blindSplit) &&
    isString(x.impactClass) &&
    isString(x.sensorIds) &&
    isString(x.sensorKinds)
  );
}

function isPassBlindReading(x: unknown): x is PreparedPassBlindReading {
  if (!isObject(x)) return false;
  if (!hasExactKeys(x, ["actionId", "disposition", "floorKind", "impactClass", "sensorIds"])) {
    return false;
  }
  return (
    isString(x.actionId) &&
    x.disposition === "PASS_BLIND" &&
    isEnum(x.floorKind, VERDICT_KINDS) &&
    isString(x.impactClass) &&
    isString(x.sensorIds)
  );
}

const DECISION_PREPARED_KEYS: readonly string[] = [
  "recordType",
  "sequenceNumber",
  "previousHash",
  "identity",
  "requestHash",
  "declarationBinding",
  "floorReading",
  "at",
  "hash",
];

const PASSBLIND_PREPARED_KEYS: readonly string[] = [
  "recordType",
  "sequenceNumber",
  "previousHash",
  "identity",
  "requestHash",
  "declarationBinding",
  "passBlindReading",
  "at",
  "hash",
];

const DECISION_FINAL_KEYS: readonly string[] = [
  "recordType",
  "sequenceNumber",
  "previousHash",
  "identity",
  "requestHash",
  "declarationBinding",
  "decision",
  "decisionHash",
  "at",
  "hash",
];

const PROJECTION_MARKER_KEYS: readonly string[] = [
  "recordType",
  "sequenceNumber",
  "previousHash",
  "identity",
  "projection",
  "detail",
  "at",
  "hash",
];

function validateDecisionPrepared(o: Parsed): DecisionPreparedRecord | null {
  if (!hasExactKeys(o, DECISION_PREPARED_KEYS)) return null;
  if (!isNonNegInteger(o.sequenceNumber)) return null;
  if (!isString(o.previousHash)) return null;
  if (!isIdentity(o.identity)) return null;
  if (!isString(o.requestHash)) return null;
  if (!isDeclarationBinding(o.declarationBinding)) return null;
  if (!isFloorReading(o.floorReading)) return null;
  if (!isFiniteNumber(o.at)) return null;
  if (!isString(o.hash)) return null;
  return o as unknown as DecisionPreparedRecord;
}

function validatePassBlindPrepared(o: Parsed): PassBlindPreparedRecord | null {
  if (!hasExactKeys(o, PASSBLIND_PREPARED_KEYS)) return null;
  if (!isNonNegInteger(o.sequenceNumber)) return null;
  if (!isString(o.previousHash)) return null;
  if (!isIdentity(o.identity)) return null;
  if (!isString(o.requestHash)) return null;
  if (!isDeclarationBinding(o.declarationBinding)) return null;
  if (!isPassBlindReading(o.passBlindReading)) return null;
  if (!isFiniteNumber(o.at)) return null;
  if (!isString(o.hash)) return null;
  return o as unknown as PassBlindPreparedRecord;
}

function validateDecisionFinal(o: Parsed): DecisionFinalRecord | null {
  if (!hasExactKeys(o, DECISION_FINAL_KEYS)) return null;
  if (!isNonNegInteger(o.sequenceNumber)) return null;
  if (!isString(o.previousHash)) return null;
  if (!isIdentity(o.identity)) return null;
  if (!isString(o.requestHash)) return null;
  if (!isDeclarationBinding(o.declarationBinding)) return null;
  if (!isObject(o.decision)) return null;
  if (!isString(o.decisionHash)) return null;
  if (!isFiniteNumber(o.at)) return null;
  if (!isString(o.hash)) return null;
  return o as unknown as DecisionFinalRecord;
}

function validateProjectionMarker(o: Parsed): ProjectionMarkerRecord | null {
  if (!hasExactKeys(o, PROJECTION_MARKER_KEYS)) return null;
  if (!isEnum(o.recordType, ["PROJECTION_DONE", "PROJECTION_FAILED"])) return null;
  if (!isNonNegInteger(o.sequenceNumber)) return null;
  if (!isString(o.previousHash)) return null;
  if (!isIdentity(o.identity)) return null;
  if (!isEnum(o.projection, PROJECTION_KINDS)) return null;
  if (!(o.detail === null || isString(o.detail))) return null;
  if (!isFiniteNumber(o.at)) return null;
  if (!isString(o.hash)) return null;
  return o as unknown as ProjectionMarkerRecord;
}

function validateJournalRecord(x: unknown): JournalRecord | null {
  if (!isObject(x)) return null;
  const o = x as Parsed;
  switch (o.recordType) {
    case "DECISION_PREPARED":
      return validateDecisionPrepared(o);
    case "PASSBLIND_PREPARED":
      return validatePassBlindPrepared(o);
    case "DECISION_FINAL":
      return validateDecisionFinal(o);
    case "PROJECTION_DONE":
    case "PROJECTION_FAILED":
      return validateProjectionMarker(o);
    default:
      return null;
  }
}

function hashOf(recordWithoutHash: Record<string, unknown>): string {
  return canonicalHash(recordWithoutHash);
}

// ── load state, quarantine ────────────────────────────────────────────────────

export type JournalLoadState =
  | "IN_MEMORY"
  | "LOADED_VERIFIED"
  | "FIRST_BOOT_OR_ERASED"
  | "CANNOT_VERIFY";

export interface JournalQuarantine {
  readonly raw: string;
  readonly detail: string;
}

export interface DecisionJournalOptions {
  readonly path?: string;
  readonly appender?: LineAppender;
  readonly acquire?: LockAcquirer;
}

export type ProjectionState = "DONE" | "FAILED" | "PENDING";

export class DecisionJournal {
  private readonly chain: JournalRecord[] = [];
  private readonly path: string | null;
  private readonly appender?: LineAppender;
  private readonly acquire?: LockAcquirer;
  private loadState: JournalLoadState = "IN_MEMORY";
  private persisting = false;
  private lastError: string | null = null;
  private quarantine: JournalQuarantine | null = null;

  // ── replay state ───────────────────────────────────────────────────────────
  private readonly finalByIdentity = new Map<string, DecisionFinalRecord>();
  /**
   * R1 / `/explain`. The SAME records as `finalByIdentity`, keyed by their
   * `decisionHash` instead. Built in `replay()` from the one chain, so the two
   * indexes cannot disagree about what is final.
   *
   * WHY A SECOND INDEX RATHER THAN A SCAN: `/explain` is the only caller and
   * could walk `getAll()` itself — but then the journal's one read path would
   * live outside the journal, and the next caller would write a second walk
   * with its own idea of which record types count. One lookup, here, beside the
   * identity lookup it mirrors.
   *
   * COLLISION, stated rather than assumed away: `decisionHash` is a sha256 over
   * the decision object, whose `identity` and `seq` differ per decision, so two
   * FINALs sharing a hash would mean two decisions identical in every hashed
   * field — not reachable while `seq` increments. If it ever happened, LAST
   * WINS here, matching `finalByIdentity`'s own last-wins replay.
   */
  private readonly finalByDecisionHash = new Map<string, DecisionFinalRecord>();
  private readonly preparedByIdentity = new Map<
    string,
    (DecisionPreparedRecord | PassBlindPreparedRecord)[]
  >();
  private readonly projectionStateByIdentity = new Map<
    string,
    Map<ProjectionKind, ProjectionState>
  >();

  constructor(options?: DecisionJournalOptions) {
    this.path = options?.path ?? null;
    this.appender = options?.appender;
    this.acquire = options?.acquire;
    if (this.path !== null) this.loadFromDisk();
    this.replay();
  }

  private loadFromDisk(): void {
    const path = this.path as string;
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        this.loadState = "FIRST_BOOT_OR_ERASED";
        this.persisting = true;
        return;
      }
      this.loadState = "CANNOT_VERIFY";
      this.lastError = `cannot read journal: ${String(err)}`;
      return;
    }

    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      this.loadState = "FIRST_BOOT_OR_ERASED";
      this.persisting = true;
      return;
    }

    for (let i = 0; i < lines.length - 1; i++) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(lines[i]);
      } catch (err) {
        this.loadState = "CANNOT_VERIFY";
        this.lastError = `malformed JSON at line ${i}: ${String(err)}`;
        return;
      }
      const record = validateJournalRecord(parsed);
      if (record === null) {
        this.loadState = "CANNOT_VERIFY";
        this.lastError = `record at line ${i} does not match the closed journal schema`;
        return;
      }
      this.chain.push(record);
    }

    // The LAST line is quarantined, not treated as a chain break, if it fails
    // to parse or validate — a torn tail from a crash mid-append.
    const lastIndex = lines.length - 1;
    const lastLine = lines[lastIndex];
    let lastOk = true;
    let lastRecord: JournalRecord | null = null;
    try {
      const lastParsed = JSON.parse(lastLine);
      lastRecord = validateJournalRecord(lastParsed);
      if (lastRecord === null) lastOk = false;
    } catch {
      lastOk = false;
    }
    if (lastOk && lastRecord !== null) {
      this.chain.push(lastRecord);
    } else {
      this.quarantine = {
        raw: lastLine,
        detail:
          `the last line of the journal (line ${lastIndex}) is quarantined: it ` +
          `did not parse or validate as a closed journal record, and is treated ` +
          `as a torn write from a crash mid-append rather than as corruption of ` +
          `the verified prefix in front of it.`,
      };
    }

    const verification = this.verify();
    if (!verification.valid) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError = `journal chain verification failed at index ${String(verification.brokenAt)}`;
      return;
    }
    this.loadState = this.chain.length === 0 ? "FIRST_BOOT_OR_ERASED" : "LOADED_VERIFIED";
    this.persisting = true;
  }

  private verify(): { valid: boolean; brokenAt: number | null } {
    for (let i = 0; i < this.chain.length; i++) {
      const r = this.chain[i];
      if (r.sequenceNumber !== i) return { valid: false, brokenAt: i };
      const expectedPrevious = i === 0 ? "" : this.chain[i - 1].hash;
      if (r.previousHash !== expectedPrevious) return { valid: false, brokenAt: i };
      const { hash, ...rest } = r as unknown as Record<string, unknown>;
      if (hashOf(rest) !== hash) return { valid: false, brokenAt: i };
    }
    return { valid: true, brokenAt: null };
  }

  /** Rebuild finalByIdentity / preparedByIdentity / projectionState from the chain. */
  private replay(): void {
    this.finalByIdentity.clear();
    this.finalByDecisionHash.clear();
    this.preparedByIdentity.clear();
    this.projectionStateByIdentity.clear();
    for (const rec of this.chain) {
      const key = identityKey(rec.identity);
      if (rec.recordType === "DECISION_PREPARED" || rec.recordType === "PASSBLIND_PREPARED") {
        const list = this.preparedByIdentity.get(key) ?? [];
        list.push(rec);
        this.preparedByIdentity.set(key, list);
      } else if (rec.recordType === "DECISION_FINAL") {
        this.finalByIdentity.set(key, rec);
        this.finalByDecisionHash.set(rec.decisionHash, rec);
        if (!this.projectionStateByIdentity.has(key)) {
          const m = new Map<ProjectionKind, ProjectionState>();
          for (const p of PROJECTION_KINDS) m.set(p, "PENDING");
          this.projectionStateByIdentity.set(key, m);
        }
      } else {
        let m = this.projectionStateByIdentity.get(key);
        if (m === undefined) {
          m = new Map<ProjectionKind, ProjectionState>();
          for (const p of PROJECTION_KINDS) m.set(p, "PENDING");
          this.projectionStateByIdentity.set(key, m);
        }
        m.set(rec.projection, rec.recordType === "PROJECTION_DONE" ? "DONE" : "FAILED");
      }
    }
  }

  getLoadState(): JournalLoadState {
    return this.loadState;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getQuarantine(): JournalQuarantine | null {
    return this.quarantine;
  }

  getAll(): readonly JournalRecord[] {
    return this.chain;
  }

  /** The authoritative decision for an identity, or null if none is FINAL yet. */
  findFinal(identity: DecisionIdentity): DecisionFinalRecord | null {
    return this.finalByIdentity.get(identityKey(identity)) ?? null;
  }

  /**
   * R1 / `/explain`. The FINAL record whose decision object hashes to
   * `decisionHash`, or null.
   *
   * NULL IS NOT "NO SUCH DECISION" ON ITS OWN, and a caller that renders it as
   * such is wrong in the one case that matters. This map is built from
   * `this.chain`, and `this.chain` is whatever `loadFromDisk()` could verify:
   * on `CANNOT_VERIFY` the chain stops at the break and everything after it is
   * absent from every index here. A caller must read `getLoadState()` beside
   * this answer and say which of the two it is holding — "the journal does not
   * contain this decision" and "the journal could not be verified past line N"
   * are different facts and only one of them is about the decision.
   */
  findFinalByDecisionHash(decisionHash: string): DecisionFinalRecord | null {
    return this.finalByDecisionHash.get(decisionHash) ?? null;
  }

  /**
   * PREPARED / PASSBLIND_PREPARED lines for an identity that has NO FINAL —
   * a quarantined evaluation, never authoritative. Empty when the identity
   * has a FINAL (its PREPARED lines are then just that decision's own
   * evidence, not orphans) or has never been evaluated at all.
   */
  orphanPreparedFor(
    identity: DecisionIdentity
  ): readonly (DecisionPreparedRecord | PassBlindPreparedRecord)[] {
    const key = identityKey(identity);
    if (this.finalByIdentity.has(key)) return [];
    return this.preparedByIdentity.get(key) ?? [];
  }

  /**
   * Every PREPARED/PASSBLIND_PREPARED line for an identity, REGARDLESS of
   * whether a FINAL exists — used by repair to reconstruct the floor/
   * pass-blind readings an evaluation took, when the process that took them
   * is gone and only the journal remains.
   */
  preparedRecordsFor(
    identity: DecisionIdentity
  ): readonly (DecisionPreparedRecord | PassBlindPreparedRecord)[] {
    return this.preparedByIdentity.get(identityKey(identity)) ?? [];
  }

  projectionStatus(identity: DecisionIdentity): Record<ProjectionKind, ProjectionState> {
    const m = this.projectionStateByIdentity.get(identityKey(identity));
    const out: Record<ProjectionKind, ProjectionState> = {
      trail: "PENDING",
      ledger: "PENDING",
      history: "PENDING",
      events: "PENDING",
    };
    if (m === undefined) return out;
    for (const p of PROJECTION_KINDS) out[p] = m.get(p) ?? "PENDING";
    return out;
  }

  /** Every identity that has a DECISION_FINAL, in commit order. */
  allFinalIdentities(): readonly DecisionIdentity[] {
    const out: DecisionIdentity[] = [];
    for (const rec of this.chain) {
      if (rec.recordType === "DECISION_FINAL") out.push(rec.identity);
    }
    return out;
  }

  private resyncUnderLock(): string | null {
    const result = resyncAppendStore<JournalRecord>({
      path: this.path as string,
      known: this.chain,
      validate: validateJournalRecord,
      recomputeHash: (record) => {
        const { hash, ...rest } = record as unknown as Record<string, unknown>;
        return hashOf(rest);
      },
    });
    if (!result.linked) return result.detail;
    for (const record of result.extension) this.chain.push(record);
    this.replay();
    return null;
  }

  private append<T extends JournalRecord>(
    buildWithoutChainFields: (sequenceNumber: number, previousHash: string) => Omit<T, "hash">
  ): AppendOutcome<T> {
    return appendStoreTransaction<T>({
      path: this.path,
      persisting: this.persisting,
      lastError: this.lastError,
      storeLabel: "decision journal",
      prepare: () => {
        const sequenceNumber = this.chain.length;
        const previousHash = sequenceNumber === 0 ? "" : this.chain[sequenceNumber - 1].hash;
        const withoutHash = buildWithoutChainFields(sequenceNumber, previousHash);
        const hash = hashOf(withoutHash as unknown as Record<string, unknown>);
        const record = { ...withoutHash, hash } as unknown as T;
        return {
          record,
          line: JSON.stringify(record) + "\n",
          commit: () => {
            this.chain.push(record);
            this.replay();
          },
        };
      },
      resync: () => this.resyncUnderLock(),
      appender: this.appender,
      acquire: this.acquire,
      memoryDetail:
        "no journal path was injected: this record is IN MEMORY only and does " +
        "not survive the process. It carries integrity but not provenance.",
      notPersistingDetail:
        "the decision journal is not in a persisting state; the record was not written to disk.",
      onAppendBlocked: (detail) => {
        this.lastError = detail;
        return detail;
      },
      onAppendError: (raw) => {
        this.lastError = `cannot append to decision journal: ${raw}`;
        return this.lastError;
      },
    });
  }

  /** Phase 1a: guard()'s mandatory floor reading, mid-evaluation. */
  appendPrepared(
    identity: DecisionIdentity,
    requestHash: string,
    declarationBinding: DeclarationBinding,
    floorReading: PreparedFloorReading,
    at: number
  ): AppendOutcome<DecisionPreparedRecord> {
    return this.append<DecisionPreparedRecord>((sequenceNumber, previousHash) => ({
      recordType: "DECISION_PREPARED",
      sequenceNumber,
      previousHash,
      identity,
      requestHash,
      declarationBinding,
      floorReading,
      at,
    }));
  }

  /** Phase 1b: guard()'s mandatory PASS-BLIND record, mid-evaluation. */
  appendPassBlindPrepared(
    identity: DecisionIdentity,
    requestHash: string,
    declarationBinding: DeclarationBinding,
    passBlindReading: PreparedPassBlindReading,
    at: number
  ): AppendOutcome<PassBlindPreparedRecord> {
    return this.append<PassBlindPreparedRecord>((sequenceNumber, previousHash) => ({
      recordType: "PASSBLIND_PREPARED",
      sequenceNumber,
      previousHash,
      identity,
      requestHash,
      declarationBinding,
      passBlindReading,
      at,
    }));
  }

  /** Phase 2: the ONE mandatory boundary. Nothing executable before this lands. */
  appendFinal(
    identity: DecisionIdentity,
    requestHash: string,
    declarationBinding: DeclarationBinding,
    decision: Record<string, unknown>,
    decisionHash: string,
    at: number
  ): AppendOutcome<DecisionFinalRecord> {
    return this.append<DecisionFinalRecord>((sequenceNumber, previousHash) => ({
      recordType: "DECISION_FINAL",
      sequenceNumber,
      previousHash,
      identity,
      requestHash,
      declarationBinding,
      decision,
      decisionHash,
      at,
    }));
  }

  /** A repairable-projection marker. Only ever meaningful for an identity that has a FINAL. */
  recordProjection(
    identity: DecisionIdentity,
    projection: ProjectionKind,
    kind: "DONE" | "FAILED",
    detail: string | null,
    at: number
  ): AppendOutcome<ProjectionMarkerRecord> {
    return this.append<ProjectionMarkerRecord>((sequenceNumber, previousHash) => ({
      recordType: kind === "DONE" ? "PROJECTION_DONE" : "PROJECTION_FAILED",
      sequenceNumber,
      previousHash,
      identity,
      projection,
      detail,
      at,
    }));
  }
}

export { durableLineAppender, exclusiveFileLock, appendLockPath };
