// ── GLUE · the SUBJECT LOG as a chained, verified store (Act A) ──────────────
//
// THE ONE SENTENCE THIS FILE IS ALLOWED TO SAY, AND IT IS THE WHOLE PUBLICATION
// WIDTH:
//
//   THIS STORE IS TAMPER-EVIDENT, NOT INDEPENDENT. It attests that the chain
//   loaded from this file is the chain that was written to it — no record
//   rewritten, reordered, spliced or silently dropped between two reads. It
//   attests NOTHING about the party that wrote it, because THE WRITER, THE
//   CHAINER AND THE VERIFIER ARE ALL THE SAME PRINCIPAL (`mica-bridge`). A
//   bridge that rewrote one of its own records and re-chained from that point
//   produces a file that verifies perfectly and loads clean. Closing THAT is
//   Act B — the clerk's independent arrival stamps, a different OS principal
//   and a key this process did not mint — and Act B is not in this file.
//
// ── WHY A NEW STORE AND NOT THE WITNESS ONE (the arbiter, ruling 1, 2026-09-22) ────
//
//   Routing the subject log into `WitnessStoreLog` earns a verified chain by
//   destroying the content the readers need: `WITNESS_LOG_MAPPING` flattens
//   `outcome` to a constant, fixes `moduleId` to a literal, and drops both
//   `submitterId` and the payload. That adapter's own header says Eng "may well
//   ALARM that `outcome` carries no information. THAT ALARM WOULD BE TRUE — and
//   it would be true about this mapping, not about the observed system." A
//   reader alarming truthfully about our own plumbing is worse than no reader.
//
//   So: a new journal, on `decision-journal.ts`'s pattern, reusing THE ONE
//   append-store transaction contract every durable book in this substrate
//   adopts (`src/mica/store/append-store.ts`). `src/mica/**` is IMPORTED here,
//   never edited — the same sentence `decision-journal.ts:25-28` carries, and
//   the reason this whole act needs no core-door ticket.
//
// ── ITS OWN LOAD-STATE NAME (the arbiter, ruling 2) ────────────────────────────────
//
//   `LOADED_SUBJECT_CHAIN_VERIFIED`, never `LOADED_VERIFIED`. NEVER ONE WORD
//   FOR TWO FACTS. `witness-log-file.ts:126-131` already argues this side by
//   name — "a store that verified is not the same fact as a JSONL that merely
//   parsed, and the two must not share a string" — and a bridge-self-chained
//   store is a third fact again: chained by the party it is about. The string
//   an operator has to type is the admission of which fact they are accepting.
//
//   The consequence is a bridge-side change, ruled with it: `computeFooting`'s
//   `verifiedChain` stops being `loadState === "LOADED_VERIFIED"` and becomes
//   membership of a DECLARED LIST. A correct build must not read as FAILED
//   because of one `===`.
//
// ── THE BOUNDARY RECORD LIVES INSIDE THE CHAIN (the arbiter, ruling 3) ─────────────
//
//   Position 0 of every subject chain is a `SUBJECT_LOG_BOUNDARY` record, and
//   a chain whose position 0 is anything else DOES NOT LOAD. It names the file
//   this chain replaced — its path, its record count, its byte count and its
//   SHA-256 — so the new chain's own first line points at what came before.
//   A rename alone is a fact told to a directory listing; this is a fact told
//   to the chain, and it is hashed like every other line.
//
//   E13 is what this is for: today a live rotation of `subject-events.jsonl` is
//   SILENT — the next append re-derives `sequenceNumber` from a fresh file and
//   says nothing. After chaining, a restart at 0 with no recorded predecessor
//   would be a chain that VERIFIES and LIES BY OMISSION. The boundary record is
//   the difference between a declared boundary and amnesia.
//
//   `retired: null` is a genuinely-first boot, and it is a DIFFERENT fact from
//   a rotation, carried in a different value rather than in an absent field.
//
//   WHAT THE READERS DO WHEN THEY MEET IT — stated here because a grammar
//   change that is only discovered downstream is the defect this substrate is
//   about:
//
//     · Sig F2 (positive and re-entry): IGNORES it. `SUBJECT_LOG_BOUNDARY` is
//       declared OUT of both `preconditionMap` and `reentryMap`. F2 governs
//       exactly the eventTypes that are KEYS in those maps
//       (`sig/index.ts:672`, `detectReentry`), so a kind in neither map falls
//       outside F2's scope and is invisible to it. THAT IS THE SAFE DEFAULT AND
//       IT IS DELIBERATE: a new map entry would make the boundary record
//       governed, and the one signal on this log that can alarm about something
//       real would then be spending itself on our own bookkeeping.
//     · Sig F1 (adjacent-pair clock): SEES it. It is a record with a timestamp,
//       it sits at position 0, and it therefore forms F1's first pair with the
//       first subject event. Its timestamp is the rotation instant, which
//       precedes every event in the chain, so the pair's delta is non-negative
//       and F1 reads it as it reads any other ordered pair.
//     · Eng: SEES it. `classKey` is `(moduleId, eventType)` — the boundary is
//       one new event class of exactly one member, carrying one outcome value
//       that occurs nowhere else. It is NOT invisible to Eng and this file does
//       not pretend otherwise: it is one entry in the sample, one singleton
//       class, one singleton outcome. With one record in a chain of dozens the
//       movement in AMI is small; it is not zero, and "small" is measured by
//       the test beside this file rather than asserted here.
//     · Every other instrument: eleven of the thirteen readers are not called
//       by `wire()` at all and have no log to meet it on (SCOPE §4 L2 / §5 P1).
//
// ── A DAMAGED LAST LINE: STOP AND SHOUT (the arbiter, ruling 6) ────────────────────
//
//   THIS IS WHERE THIS STORE DELIBERATELY PARTS FROM ITS OWN PRECEDENT, so the
//   difference is written down rather than discovered as an inconsistency:
//
//     · `decision-journal.ts:566-577` QUARANTINES its last line — a torn write
//       from a crash mid-append — and loads the verified prefix in front of it.
//       Correct there: that store's product is decision replay, an unfinished
//       evaluation is already modelled as a quarantined evaluation, and losing
//       a torn tail loses nothing that was ever authoritative.
//     · `mica-service.ts`'s `SerializedAppender.evictTrailingCorruption()`
//       goes further still: it MOVES the torn bytes to a `.quarantine` sidecar,
//       TRUNCATES them out of the live file, and carries on appending.
//
//   NEITHER IS ALLOWED HERE. In a chained store the torn line was a LINK. Drop
//   it and the chain still verifies positionally while a record is simply gone
//   — which is the silent loss this entire item exists to end. So:
//
//     · the READER reports `SUBJECT_CHAIN_TORN_TAIL`, `verify()` invalid, and
//       `getAll()` EMPTY. Not "n-1 records read clean". Every instrument goes
//       CANNOT_ASSESS(BROKEN_CHAIN) and stays there until a human acts.
//     · the WRITER refuses: a store that did not load verified is not
//       persisting, so `appendStoreTransaction` returns `persisted:false,
//       committed:false` and nothing is written over the damage.
//
//   THE OPERATIONAL CONSEQUENCE, SAID OUT LOUD RATHER THAN DISCOVERED AT 03:00:
//   while the tail is damaged, every `POST /subject-events` fails and the
//   housekeeper's acts go unevaluated — fail-open under ruling J, marked
//   STALE_STREAM. The agent keeps working; the record does not. That is the
//   trade ruling 6 chose, and it is the loud half of it.
//
// ── fsync IS PART OF THIS ACT, NOT AN OPTIMISATION DEFERRED ─────────────────
//
//   The subject log's writer today is a bare `appendFileSync` with no
//   `fsyncSync` (`mica-service.ts:511, :569`). That loses an acked record on
//   power loss — mildly bad while nothing chains. After chaining, a lost or
//   torn tail is a CHAIN BREAK and every reader goes blind until a human acts.
//   So this store's appender is `append-store.ts`'s `durableLineAppender`,
//   which holds the fd and `fsyncSync`s before `closeSync`, and the appender's
//   IDENTITY is pinned by a test so a successor cannot swap a cheaper one in.
//
// ── WHAT A VERIFIED CHAIN STILL DOES NOT BUY ────────────────────────────────
//
//   Not completeness: a truncation of the WHOLE tail leaves a chain that
//   verifies perfectly, and this store cannot tell you how long it should have
//   been. Not authorship of meaning: the bridge retains what arrived and never
//   certifies that what arrived was true. Not that the timestamps are true —
//   one process, one clock, and Sig F1 remains a self-consistency leg reading
//   the writer's own clock (register E5 is NOT closed by this act). Not
//   independence: see the first paragraph.

import { createHash } from "crypto";
import { readFileSync, statSync } from "fs";
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
} from "../mica/store/validate";
import type { Parsed } from "../mica/store/validate";
import type { MicaLogRecord, MicaLogVerifyResult, MicaReadableLog } from "../mica/log";

// ── the attestation sentence, carried in code so it prints where it is used ──

export const SUBJECT_CHAIN_ATTESTS =
  "THIS STORE IS TAMPER-EVIDENT, NOT INDEPENDENT. Every record's hash was " +
  "recomputed over its own canonical content and checked against the hash it " +
  "carries; each record's previousHash was checked against its predecessor; " +
  "each record's sequenceNumber was checked against its position; and position " +
  "0 was checked to be a declared boundary record naming what this chain " +
  "replaced. So a rewritten, reordered, spliced or dropped record is caught, " +
  "and so is a chain that cannot say where it began. IT ATTESTS NOTHING ELSE. " +
  "The writer, the chainer and the verifier are the SAME PRINCIPAL, so it is " +
  "silent about tamper by the party it is about — that is Act B, the clerk's " +
  "independent stamps, and it is not in this store. Not completeness: a " +
  "truncation of the whole tail leaves a chain that verifies perfectly. Not " +
  "authorship of meaning. Not that the timestamps are true: one process, one " +
  "clock, and Sig F1 remains a self-consistency leg over the writer's own.";

/**
 * The load state a GOOD read of a subject chain reports.
 *
 * ITS OWN NAME, never `LOADED_VERIFIED` (the arbiter, ruling 2). An operator who
 * wants MICA to read this store must name THIS string by hand in
 * `readers.readableLoadStates`, and typing it is the admission of which fact
 * they are accepting: chained, verified, and chained by the party it is about.
 */
export const LOADED_SUBJECT_CHAIN_VERIFIED = "LOADED_SUBJECT_CHAIN_VERIFIED";

/**
 * The label a store chained by a party OTHER than the one it describes earns,
 * and this one does not. Held as a constant so the prohibition is a thing a
 * test can point at rather than a habit — the same device
 * `mica-log-file.ts:154` uses for itself.
 */
export const FORBIDDEN_LOAD_STATE = "LOADED_VERIFIED";

/** The boundary record's `eventType`. DECLARED, and OUT of both Sig maps. */
export const SUBJECT_LOG_BOUNDARY_EVENT_TYPE = "SUBJECT_LOG_BOUNDARY";

/** The boundary record's `moduleId`. The chain's own voice, not a subject's. */
export const SUBJECT_LOG_BOUNDARY_MODULE_ID = "MICA/SubjectLog";

/** The boundary record's `outcome`. One value, occurring on no other record. */
export const SUBJECT_LOG_BOUNDARY_OUTCOME = "BOUNDARY_DECLARED";

/**
 * The eventTypes this store MINTS ITSELF, as opposed to the ones a subject
 * event carries. Exported so a declaration author can check, mechanically, that
 * none of them appears in `preconditionMap` or `reentryMap` — the check the
 * test beside this file performs and the declaration's own basis cites.
 */
/**
 * SHAPE (b) · THE BRIDGE'S RECORD THAT IT ONCE LOADED CLERK STAMPS FOR THIS CHAIN.
 *
 * ⛔ WHY THIS LIVES IN THE CHAIN AND NOT IN A FILE BESIDE THE STAMPS. The first
 * design of this witness was the CARRIER'S cursor file, `lstat`ed by the bridge:
 * the carrier writes it only after a successful carry, so its presence was a
 * claim that stamps once existed. Codex FAILED that on 2026-09-29 and was right.
 * The cursor and the stamps sit in ONE directory under ONE principal, so they are
 * CO-DELETABLE — erase both and the pair presents exactly as a genuine first run
 * does. A WITNESS THE SUSPECT CAN REMOVE IS NOT A WITNESS; it only raises the
 * price of one clumsy attack.
 *
 * Here the record is written by the BRIDGE, into the chain, and it is covered by
 * the chain's hash. Removing it is not a delete — it is a chain break, which
 * every reader on this box already detects and names.
 *
 * ⚠ IT CARRIES THE CHAIN GENESIS IT BELONGS TO, so it cannot be replayed onto a
 * different chain: a re-stamp is performed by ROTATING, and a new chain has a new
 * genesis and therefore no prior-load record of its own. That is what makes a
 * deliberate re-stamp legible and an erasure under a live chain not.
 */
export const CLERK_STAMPS_FIRST_LOAD_EVENT_TYPE = "CLERK_STAMPS_FIRST_LOAD";

export const SUBJECT_CHAIN_OWN_EVENT_TYPES: readonly string[] = [
  SUBJECT_LOG_BOUNDARY_EVENT_TYPE,
  CLERK_STAMPS_FIRST_LOAD_EVENT_TYPE,
];

// ── canonical JSON and the hash ──────────────────────────────────────────────
//
// Sorted keys, NFC strings, `undefined` (object keys) omitted, `null` kept, no
// whitespace. IDENTICAL in rule to `decision-journal.ts:85-110`, and it is a
// second copy on purpose rather than an import: a store's hash preimage is the
// one thing that must never move because a neighbour refactored. Both copies
// are pinned by their own fixtures.

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

export function subjectCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

/** sha256 over the canonical JSON of `value`, hex. */
export function subjectCanonicalHash(value: unknown): string {
  return createHash("sha256")
    .update(subjectCanonicalJson(value), "utf8")
    .digest("hex");
}

/**
 * The chain hash of one record: sha256 over the canonical JSON of the record
 * WITHOUT its own `hash` field. EVERY OTHER KEY IS COVERED, including the
 * bridge's own fields that this store does not validate (see
 * `validateSubjectRecord`). That is the point of hashing the whole object: a
 * field this store has no opinion about is still tamper-evident.
 */
export function subjectRecordHash(recordWithoutHash: Record<string, unknown>): string {
  return subjectCanonicalHash(recordWithoutHash);
}

// ── the record types ─────────────────────────────────────────────────────────

/** What this chain replaced. Null is a genuinely-first boot, not an absence. */
export interface RetiredPredecessor {
  /** The path the previous log was renamed to, as a human will find it. */
  readonly path: string;
  /** Its record count, read before the rename. */
  readonly records: number;
  /** Its byte count, read before the rename. */
  readonly bytes: number;
  /** Its SHA-256, read before the rename. Lower-case hex. */
  readonly sha256: string;
}

/**
 * Position 0 of every subject chain. Also a `MicaLogRecord`: the five declared
 * fields are ON THIS RECORD, not projected for it, because it is a line in a
 * log every MICA reader will walk.
 */
export interface SubjectBoundaryRecord {
  readonly recordType: "SUBJECT_LOG_BOUNDARY";
  readonly sequenceNumber: 0;
  readonly previousHash: "";
  readonly retired: RetiredPredecessor | null;
  readonly basis: string;
  readonly timestamp: number;
  readonly moduleId: string;
  readonly eventType: string;
  readonly outcome: string;
  readonly hash: string;
}

/**
 * One subject event. The bridge's own fields ride ALONGSIDE the declared ones,
 * exactly as C9 made them ride: additive, every pre-chain field keeping its
 * name and its value.
 */
export interface SubjectEventRecord {
  readonly recordType: "SUBJECT_EVENT";
  readonly sequenceNumber: number;
  readonly previousHash: string;
  readonly timestamp: number;
  readonly moduleId: string;
  readonly eventType: string;
  readonly outcome: string;
  readonly actionId?: string;
  readonly hash: string;
  /** Whatever else the writer declared. Unvalidated here, and hashed. */
  readonly [extra: string]: unknown;
}

export type SubjectChainRecord = SubjectBoundaryRecord | SubjectEventRecord;

// ── validation ───────────────────────────────────────────────────────────────
//
// THE SHAPE IS CLOSED WHERE THIS STORE OWNS IT AND OPEN WHERE IT DOES NOT, and
// that split is a position, not a gap:
//
//   · the BOUNDARY record is this store's own record. Its keys are enumerated
//     and `hasExactKeys` refuses any other — an extra key on a line this store
//     mints itself would be someone else writing in our voice.
//   · a SUBJECT EVENT is the BRIDGE's record. This store owns its chain fields
//     and MICA's five declared fields and validates exactly those; the
//     bridge's `subjectSeq`, `ts`, `identity`, `kind`, `eventHash`, `peerUid`
//     and `payload` are accepted without inspection. Closing that shape here
//     would make this file the owner of a record grammar it does not write, and
//     the next additive field on the bridge side would fail to load rather than
//     fail to validate. EVERY ONE OF THOSE KEYS IS STILL HASHED, so they are
//     tamper-evident even though they are not type-checked — which is the
//     honest width: this store attests that they were not CHANGED, never that
//     they were WELL-FORMED.

const BOUNDARY_KEYS: readonly string[] = [
  "recordType",
  "sequenceNumber",
  "previousHash",
  "retired",
  "basis",
  "timestamp",
  "moduleId",
  "eventType",
  "outcome",
  "hash",
];

function isRetired(x: unknown): x is RetiredPredecessor {
  if (!isObject(x)) return false;
  if (!hasExactKeys(x, ["path", "records", "bytes", "sha256"])) return false;
  return (
    isString(x.path) &&
    isNonNegInteger(x.records) &&
    isNonNegInteger(x.bytes) &&
    isString(x.sha256) &&
    /^[0-9a-f]{64}$/.test(x.sha256)
  );
}

function validateBoundary(o: Parsed): SubjectBoundaryRecord | null {
  if (!hasExactKeys(o, BOUNDARY_KEYS)) return null;
  if (o.sequenceNumber !== 0) return null;
  if (o.previousHash !== "") return null;
  if (!(o.retired === null || isRetired(o.retired))) return null;
  if (!isString(o.basis)) return null;
  if (!isFiniteNumber(o.timestamp)) return null;
  if (!isString(o.moduleId)) return null;
  if (o.eventType !== SUBJECT_LOG_BOUNDARY_EVENT_TYPE) return null;
  if (!isString(o.outcome)) return null;
  if (!isString(o.hash)) return null;
  return o as unknown as SubjectBoundaryRecord;
}

function validateEvent(o: Parsed): SubjectEventRecord | null {
  if (!isNonNegInteger(o.sequenceNumber)) return null;
  if (!isString(o.previousHash)) return null;
  if (!isFiniteNumber(o.timestamp)) return null;
  if (!isString(o.moduleId)) return null;
  if (!isString(o.eventType)) return null;
  if (!isString(o.outcome)) return null;
  if (o.actionId !== undefined && !isString(o.actionId)) return null;
  if (!isString(o.hash)) return null;
  // A subject event may NOT wear the boundary's eventType. One kind, one
  // meaning: a subject that could post `SUBJECT_LOG_BOUNDARY` could mint a
  // second "log starts here" inside a running chain.
  if (o.eventType === SUBJECT_LOG_BOUNDARY_EVENT_TYPE) return null;
  // SHAPE (b) · AND IT MAY NOT WEAR THE PRIOR-LOAD WITNESS'S EITHER, UNLESS IT
  // SPEAKS IN THE CHAIN'S OWN VOICE.
  //
  // ⛔ THIS IS THE FORGERY THE WITNESS WOULD OTHERWISE INVITE, and it is worth
  // more than the route check that also catches it. The record's meaning is
  // "stamps for this chain were loaded once" — a claim that, once present,
  // turns every later empty stamps file into a REFUSAL. A subject able to mint
  // it could hold the box by writing one line; a subject able to mint it and
  // then empty the stamps file could do so while looking like the victim.
  //
  // `authorizeSubjectEventKind` already refuses it at the route, because it is
  // not in `SUBJECT_EVENT_KINDS`. THIS CHECK DOES NOT DEPEND ON THE ROUTE —
  // it holds for any writer of these bytes, including a future second one, and
  // it is the layer that survives somebody adding a kind to a list.
  if (
    o.eventType === CLERK_STAMPS_FIRST_LOAD_EVENT_TYPE &&
    o.moduleId !== SUBJECT_LOG_BOUNDARY_MODULE_ID
  ) {
    return null;
  }
  return o as unknown as SubjectEventRecord;
}

/** The store's closed-shape validator. Null means "not one of my records". */
export function validateSubjectRecord(x: unknown): SubjectChainRecord | null {
  if (!isObject(x)) return null;
  const o = x as Parsed;
  if (!isEnum(o.recordType, ["SUBJECT_LOG_BOUNDARY", "SUBJECT_EVENT"])) return null;
  return o.recordType === "SUBJECT_LOG_BOUNDARY" ? validateBoundary(o) : validateEvent(o);
}

/** The MicaLogRecord projection of one chain record. Five fields + actionId. */
function toMicaRecord(r: SubjectChainRecord): MicaLogRecord {
  const base = {
    sequenceNumber: r.sequenceNumber,
    timestamp: r.timestamp,
    moduleId: r.moduleId,
    eventType: r.eventType,
    outcome: r.outcome,
  };
  const actionId = (r as SubjectEventRecord).actionId;
  return typeof actionId === "string" ? { ...base, actionId } : base;
}

// ── load states ──────────────────────────────────────────────────────────────

/**
 * A closed union, so the set can be attacked for completeness rather than
 * inferred from the code. EXACTLY ONE of them is the good one, and none of them
 * is `LOADED_VERIFIED`.
 */
export type SubjectChainLoadState =
  /** Chained, hashes recomputed, links checked, boundary at 0. The only good one. */
  | typeof LOADED_SUBJECT_CHAIN_VERIFIED
  /** A hash or a link did not check. Tamper evidence, fired. */
  | "SUBJECT_CHAIN_BROKEN"
  /**
   * The LAST line did not parse or validate. A torn write from a crash
   * mid-append. ITS OWN STATE, distinct from BROKEN, because the cause and the
   * operator's act are different — and REFUSED all the same (ruling 6).
   */
  | "SUBJECT_CHAIN_TORN_TAIL"
  /** A line that is NOT the last one is not JSON. */
  | "SUBJECT_CHAIN_UNVERIFIED_JSON"
  /** A line that is NOT the last one is JSON and not a record of this store. */
  | "SUBJECT_CHAIN_UNVERIFIED_SCHEMA"
  /**
   * A line is EMPTY OR WHITESPACE ONLY. Its own state, and not folded into
   * UNVERIFIED_JSON, because the cause and the operator's act are different:
   * an empty line is an editor, a concatenation, or an interrupted write that
   * put a bare newline down — not a half-written record. Found by the cold
   * verifier 2026-09-23, when this loader still FILTERED such lines away
   * before validating and a fresh writer then extended the file past one.
   */
  | "SUBJECT_CHAIN_BLANK_LINE"
  /** Position 0 is not a boundary record: the chain cannot say where it began. */
  | "SUBJECT_CHAIN_NO_BOUNDARY"
  /** The file exists and holds no records. Not a clean start. */
  | "SUBJECT_CHAIN_EMPTY"
  /** ⚠ NOT "absent". This process could not look, and says which. */
  | "SUBJECT_CHAIN_UNREADABLE"
  /** The file is genuinely not there. */
  | "SUBJECT_CHAIN_ABSENT";

/** The states on which this store may be extended. Exactly two, and stated. */
const PERSISTING_STATES: readonly SubjectChainLoadState[] = [
  LOADED_SUBJECT_CHAIN_VERIFIED,
  // An absent or empty file is where a chain BEGINS — the boundary record is
  // the first thing written to it. Every other state is damage, and damage is
  // not extended (ruling 6).
  "SUBJECT_CHAIN_ABSENT",
  "SUBJECT_CHAIN_EMPTY",
];

// ── how this store cuts a file into lines, in ONE place ─────────────────────

/**
 * ⚠ THIS IS NOT A FILTER, AND THE DIFFERENCE IS THE WHOLE POINT.
 *
 * THE DEFECT THIS ENDS, found by the cold verifier 2026-09-23 and load-bearing:
 * this loader used to read
 *
 *     raw.split(/\r?\n/).filter((l) => l.trim().length > 0)
 *
 * — every whitespace-only line DROPPED before anything was validated. A blank
 * line inserted into a valid chain therefore produced
 * `LOADED_SUBJECT_CHAIN_VERIFIED`, `verify().valid === true`, the full record
 * count, and a fresh writer that appended to the file happily afterwards. A
 * malformed line could be ignored AND the file extended: in a store whose only
 * product is tamper-evidence, the one edit an attacker can make without
 * touching a hash was the one edit this reader could not see.
 *
 * What replaces it: exactly ONE trailing empty element is dropped, because that
 * element is not a line at all — it is the terminator of the last record's own
 * `"\n"`, and a JSONL file that did not end in a newline would be the damaged
 * one. EVERY remaining element is a line, and a line that carries no
 * non-whitespace is DAMAGE, reported under its own name.
 *
 * ⚠ IT IS EXPORTED SO THE WRITER USES THE IDENTICAL CUT. The reader's refusal
 * and the writer's refusal must not be able to drift apart by one definition;
 * `resyncUnderLock` calls this, not a second copy of the expression.
 */
export function cutSubjectChainLines(raw: string): string[] {
  const parts = raw.split(/\r?\n/);
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/**
 * The index of the first empty-or-whitespace-only line, or null. The one
 * predicate both halves of this store ask, so neither can be laxer.
 */
export function firstBlankLineIndex(lines: readonly string[]): number | null {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length === 0) return i;
  }
  return null;
}

/** One sentence for a blank line, so the reader and the writer say the same thing. */
function blankLineDetail(path: string, index: number, total: number): string {
  return (
    `line ${String(index + 1)} of ${path} (of ${String(total)}) is EMPTY or ` +
    `whitespace only. It is not a record and it is not the file's final ` +
    `newline. In a CHAINED store a line is a LINK, and a reader that skipped ` +
    `this one would report a verified chain over a file somebody had edited — ` +
    `then let a writer extend it. Nothing is loaded, nothing is appended, and ` +
    `nothing is removed: a human decides what that line was.`
  );
}

// ── the load, shared by the reader and the writer ────────────────────────────

interface LoadResult {
  readonly loadState: SubjectChainLoadState;
  readonly chain: SubjectChainRecord[];
  readonly problem: string | null;
  readonly brokenAt: number | null;
}

/**
 * Read and verify a subject chain from disk.
 *
 * ⚠ `statSync`/`readFileSync` ONLY, and never `existsSync`: a path this process
 * may not traverse must not be reported as a path that does not exist
 * (S97-D(2), S103). The errno decides.
 *
 * ⚠ ON ANY FAILURE THE CHAIN COMES BACK EMPTY. Not "the verified prefix". A
 * partial chain handed to a reader is the quiet loss ruling 6 forbids: the
 * reader would see n-1 records and no reason to doubt them.
 */
function loadSubjectChain(path: string): LoadResult {
  const fail = (
    loadState: SubjectChainLoadState,
    problem: string,
    brokenAt: number | null = null
  ): LoadResult => ({ loadState, chain: [], problem, brokenAt });

  let raw: string;
  try {
    const st = statSync(path);
    if (!st.isFile()) {
      return fail("SUBJECT_CHAIN_UNREADABLE", `${path} exists and is not a regular file`);
    }
    raw = readFileSync(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return fail("SUBJECT_CHAIN_ABSENT", `${path} does not exist`);
    }
    return fail(
      "SUBJECT_CHAIN_UNREADABLE",
      `${path} could not be read (${String(code ?? err)}). THIS IS NOT an absent ` +
        `store: this process could not look, and a reader that reported blindness ` +
        `as absence would be inventing a fact about the store.`
    );
  }

  // ⚠ `cutSubjectChainLines`, never a `.filter()`. See its doc comment: the
  // filter that used to stand here is the defect the cold verifier found.
  const lines = cutSubjectChainLines(raw);
  if (lines.length === 0) {
    return { loadState: "SUBJECT_CHAIN_EMPTY", chain: [], problem: null, brokenAt: null };
  }

  // A blank line is REFUSED BEFORE ANY PARSE, and under its own name rather
  // than as "not valid JSON" — which it also is, and which would send an
  // operator looking for a half-written record that is not there. It is
  // refused wherever it sits, including last: an extra newline on the end of a
  // tamper-evident file is not a torn write, it is an edit.
  const blankAt = firstBlankLineIndex(lines);
  if (blankAt !== null) {
    return fail(
      "SUBJECT_CHAIN_BLANK_LINE",
      blankLineDetail(path, blankAt, lines.length),
      blankAt
    );
  }

  const chain: SubjectChainRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    const isLast = i === lines.length - 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      // RULING 6. A torn LAST line is named as such and REFUSED — never
      // quarantined, never truncated away, never loaded as "the prefix".
      return isLast
        ? fail(
            "SUBJECT_CHAIN_TORN_TAIL",
            `the last line of ${path} (line ${i + 1} of ${lines.length}) is not ` +
              `valid JSON. It is a torn write from a crash mid-append, and in a ` +
              `CHAINED store that line was a LINK: dropping it would leave a chain ` +
              `that still verifies positionally while a record is simply gone. ` +
              `Nothing is loaded and nothing will be appended until a human acts.`,
            i
          )
        : fail(
            "SUBJECT_CHAIN_UNVERIFIED_JSON",
            `line ${i + 1} of ${path} is not valid JSON, and it is not the last ` +
              `line — so it is not a torn tail. The chain is damaged in its middle.`,
            i
          );
    }
    const record = validateSubjectRecord(parsed);
    if (record === null) {
      return isLast
        ? fail(
            "SUBJECT_CHAIN_TORN_TAIL",
            `the last line of ${path} (line ${i + 1} of ${lines.length}) is JSON ` +
              `and is not a record of this store. Treated as a torn write and ` +
              `REFUSED, not quarantined: see ruling 6.`,
            i
          )
        : fail(
            "SUBJECT_CHAIN_UNVERIFIED_SCHEMA",
            `line ${i + 1} of ${path} is JSON and is not a record of this store.`,
            i
          );
    }
    chain.push(record);
  }

  // ── the boundary, at position 0 and nowhere else ──────────────────────────
  if (chain[0].recordType !== "SUBJECT_LOG_BOUNDARY") {
    return fail(
      "SUBJECT_CHAIN_NO_BOUNDARY",
      `position 0 of ${path} is a ${chain[0].recordType} and not a ` +
        `${SUBJECT_LOG_BOUNDARY_EVENT_TYPE}. This chain cannot say where it began, ` +
        `which is the amnesia the boundary record exists to prevent (E13).`,
      0
    );
  }
  for (let i = 1; i < chain.length; i++) {
    if (chain[i].recordType === "SUBJECT_LOG_BOUNDARY") {
      return fail(
        "SUBJECT_CHAIN_NO_BOUNDARY",
        `${path} carries a second ${SUBJECT_LOG_BOUNDARY_EVENT_TYPE} at position ` +
          `${i}. A chain begins once.`,
        i
      );
    }
  }

  // ── the chain: position, link, and the record's own hash ─────────────────
  for (let i = 0; i < chain.length; i++) {
    const r = chain[i];
    if (r.sequenceNumber !== i) {
      return fail(
        "SUBJECT_CHAIN_BROKEN",
        `the record at position ${i} of ${path} carries sequenceNumber ` +
          `${String(r.sequenceNumber)}. In a chained store the sequence is ` +
          `POSITIONAL, not merely ascending.`,
        i
      );
    }
    const expectedPrevious = i === 0 ? "" : chain[i - 1].hash;
    if (r.previousHash !== expectedPrevious) {
      return fail(
        "SUBJECT_CHAIN_BROKEN",
        `the record at position ${i} of ${path} does not link to its predecessor.`,
        i
      );
    }
    const { hash, ...rest } = r as unknown as Record<string, unknown>;
    if (subjectRecordHash(rest) !== hash) {
      return fail(
        "SUBJECT_CHAIN_BROKEN",
        `the record at position ${i} of ${path} does not hash to the value it ` +
          `carries: it was rewritten after it was written.`,
        i
      );
    }
  }

  return {
    loadState: LOADED_SUBJECT_CHAIN_VERIFIED,
    chain,
    problem: null,
    brokenAt: null,
  };
}

// ── the reader ───────────────────────────────────────────────────────────────

export interface SubjectChainLogOptions {
  /** The store. INJECTED; this adapter invents no path. */
  readonly path: string;
}

/**
 * A read-only `MicaReadableLog` over a subject chain — what `wire()` builds
 * under `logKind: "subject-chain"`.
 *
 * ⚠ IT CREATES NOTHING AND WRITES NOTHING. `statSync` and `readFileSync`, and
 * no other filesystem call is reachable from this class. `witness-log-file.ts`
 * had to say this because the witness's own constructor APPENDS; the same
 * hazard lives here, because `SubjectEventJournal` in this very file is a
 * writer over the same bytes. A reader that mutates its subject is not a
 * reader, so the reading path is a SEPARATE CLASS rather than a flag on the
 * writer.
 */
export class SubjectChainLog implements MicaReadableLog {
  private readonly chain: readonly SubjectChainRecord[];
  private readonly mapped: readonly MicaLogRecord[];
  private readonly loadState: SubjectChainLoadState;
  private readonly problem: string | null;
  private readonly brokenAt: number | null;
  readonly sourcePath: string;

  constructor(options: SubjectChainLogOptions) {
    this.sourcePath = options.path;
    const loaded = loadSubjectChain(options.path);
    this.loadState = loaded.loadState;
    this.chain = loaded.chain;
    this.problem = loaded.problem;
    this.brokenAt = loaded.brokenAt;
    this.mapped = loaded.chain.map(toMicaRecord);
  }

  /**
   * Valid ONLY on a fully verified chain. An empty or absent store is NOT
   * vacuously valid here, and that is the deliberate difference from
   * `mica-log-file.ts:336`: a store with no boundary record has not told anyone
   * where it began, and `assessLogReadability` reads an invalid `verify()` as
   * BROKEN_CHAIN — which is the true reading of a chained store that did not
   * verify, whatever the reason.
   */
  verify(): MicaLogVerifyResult {
    if (this.loadState === LOADED_SUBJECT_CHAIN_VERIFIED) return { valid: true };
    return { valid: false, ...(this.brokenAt === null ? {} : { brokenAt: this.brokenAt }) };
  }

  getLoadState(): SubjectChainLoadState {
    return this.loadState;
  }

  /** EMPTY on every failure path. Never a partial chain. See ruling 6. */
  getAll(): readonly MicaLogRecord[] {
    return this.mapped;
  }

  /**
   * The records as the chain holds them, every key included — for a CENSUS that
   * prints facts about a book (the witness's coverage), never for a reader: a
   * MICA reader is handed this object as a `MicaReadableLog` and reaches only
   * `getAll()`'s six readable fields. EMPTY on every failure path, like `getAll()`.
   */
  getChain(): readonly SubjectChainRecord[] {
    return this.loadState === LOADED_SUBJECT_CHAIN_VERIFIED ? this.chain : [];
  }

  /** The boundary record, or null when the chain did not load. */
  getBoundary(): SubjectBoundaryRecord | null {
    const first = this.chain[0];
    return first !== undefined && first.recordType === "SUBJECT_LOG_BOUNDARY" ? first : null;
  }

  getProblem(): string | null {
    return this.problem;
  }

  get recordCount(): number {
    return this.chain.length;
  }

  /**
   * One line for the census, in the same shape `MicaLogFile.describe()` and
   * `WitnessStoreLog.describe()` return, so every reporting site can ask the
   * reader what it is without knowing which reader it got.
   */
  describe(): string {
    const boundary = this.getBoundary();
    const retired =
      boundary === null
        ? ""
        : boundary.retired === null
          ? " boundary=FIRST_BOOT"
          : ` boundary=retired(${boundary.retired.path}, ${String(boundary.retired.records)} rec, ` +
            `sha256 ${boundary.retired.sha256.slice(0, 12)}…)`;
    return (
      `subject chain ${this.sourcePath}: loadState=${this.loadState} ` +
      `records=${this.chain.length}${retired} ` +
      `verify=${this.verify().valid ? "chain+order OK" : "INVALID"}` +
      (this.problem === null ? "" : ` — ${this.problem}`)
    );
  }
}

/** Compile-time: the reader satisfies the interface it exists to satisfy. */
export type SubjectChainLogIsReadable = SubjectChainLog extends MicaReadableLog
  ? MicaLogRecord
  : never;

// ── the writer ───────────────────────────────────────────────────────────────

export interface SubjectEventJournalOptions {
  /** The store. Null is IN MEMORY only: integrity without provenance. */
  readonly path?: string;
  /** Injected for fault tests. Defaults to `durableLineAppender` — the fsync. */
  readonly appender?: LineAppender;
  /** Injected for lock tests. Defaults to `exclusiveFileLock`. */
  readonly acquire?: LockAcquirer;
}

/**
 * The subject log's writer. One instance per process; the inter-process lock
 * and re-sync come from `append-store.ts` unchanged, so a second writer forks
 * nothing quietly.
 *
 * WHAT IT REFUSES, AND THE REFUSAL IS THE PRODUCT:
 *   · a store that did not load verified is NOT PERSISTING. Damage is never
 *     appended over, never truncated, never quarantined (ruling 6).
 *   · a disk head that no longer links onto the loaded chain blocks the append
 *     (`appendStoreTransaction`'s `forkedOnDiskDetail`) — appending onto a fork
 *     deepens it.
 *   · a `SUBJECT_EVENT` before any boundary record: `appendEvent` refuses,
 *     because position 0 belongs to the boundary and nothing else.
 */
export class SubjectEventJournal {
  private readonly chain: SubjectChainRecord[] = [];
  private readonly path: string | null;
  private readonly appender: LineAppender;
  private readonly acquire: LockAcquirer;
  private loadState: SubjectChainLoadState;
  private persisting = false;
  private lastError: string | null = null;

  constructor(options?: SubjectEventJournalOptions) {
    this.path = options?.path ?? null;
    // ⚠ THE DEFAULT IS THE DURABLE ONE. `durableLineAppender` holds the fd and
    // `fsyncSync`s before `closeSync`; a bare `appendFileSync` returns once the
    // bytes are in the page cache. Before chaining that lost a record; after
    // chaining it is a CHAIN BREAK. Its identity is pinned by a test.
    this.appender = options?.appender ?? durableLineAppender;
    this.acquire = options?.acquire ?? exclusiveFileLock;
    if (this.path === null) {
      this.loadState = "SUBJECT_CHAIN_ABSENT";
      this.persisting = false;
      return;
    }
    const loaded = loadSubjectChain(this.path);
    this.loadState = loaded.loadState;
    for (const r of loaded.chain) this.chain.push(r);
    this.lastError = loaded.problem;
    this.persisting = PERSISTING_STATES.includes(loaded.loadState);
  }

  getLoadState(): SubjectChainLoadState {
    return this.loadState;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  isPersisting(): boolean {
    return this.persisting;
  }

  getAll(): readonly SubjectChainRecord[] {
    return this.chain;
  }

  /** The appender this journal will actually use. Pinned by a test. */
  getAppender(): LineAppender {
    return this.appender;
  }

  /** The next position a record would take. The boundary's is always 0. */
  nextSequenceNumber(): number {
    return this.chain.length;
  }

  /**
   * ⚠ THE WRITER'S OWN RE-READ, AND WHY IT IS HERE AND NOT IN THE CORE.
   *
   * `resyncAppendStore` (`src/mica/store/append-store.ts:278`) cuts the file
   * with the SAME `.filter(l => l.trim().length > 0)` this loader used to
   * carry, so it would hand a blank line straight past — and the append that
   * follows would extend a file the reader has just refused. That file is
   * CORE: it is inside the door's pinned scope, both Act A tickets are spent,
   * and moving one byte of it needs a new ticket from the arbiter.
   *
   * So the refusal is enforced from GLUE, and it is enforceable from glue
   * because of where `append-store.ts` calls this back: inside
   * `appendStoreTransaction`, AFTER the exclusive lock is taken and BEFORE
   * `prepare()` derives a sequence number or `appendAndCommit` writes a byte.
   * Returning a non-null string from here blocks the append outright
   * (`onAppendBlocked`), leaves the committed prefix untouched, and releases
   * the lock in the core's `finally`. Nothing in `src/mica` had to change for
   * that to be true — the seam was already the right shape.
   *
   * ⚠ ONE COST, NAMED RATHER THAN HIDDEN: the core wraps whatever this returns
   * in `forkedOnDiskDetail`, whose sentence ends "Another writer has already
   * forked this file". For a blank line that wording is approximately right —
   * the bytes did change under a loaded reader, and not by this writer — but
   * it is not exact. Tightening it means editing `append-store.ts`.
   * `[owed → the arbiter, part of the same core ticket as the filter itself]`
   *
   * ⚠ THIS IS THE SECOND OF TWO GATES, NOT THE ONLY ONE. A blank line present
   * at LOAD time never reaches here: the loader refuses, `persisting` is
   * false, and `appendStoreTransaction` returns before it takes the lock. This
   * gate is for a line inserted AFTER this process loaded the file.
   */
  private refuseBlankLineOnDisk(): string | null {
    let raw: string;
    try {
      raw = readFileSync(this.path as string, "utf8");
    } catch {
      // Not this check's business: `resyncAppendStore` reads the same file
      // immediately below and names an unreadable one in its own words.
      return null;
    }
    const lines = cutSubjectChainLines(raw);
    const blankAt = firstBlankLineIndex(lines);
    if (blankAt === null) return null;
    return blankLineDetail(this.path as string, blankAt, lines.length);
  }

  private resyncUnderLock(): string | null {
    // FIRST, and before the core's re-sync sees the file at all.
    const blank = this.refuseBlankLineOnDisk();
    if (blank !== null) return blank;
    const result = resyncAppendStore<SubjectChainRecord & { readonly hash: string }>({
      path: this.path as string,
      known: this.chain as (SubjectChainRecord & { readonly hash: string })[],
      validate: validateSubjectRecord as (
        parsed: unknown
      ) => (SubjectChainRecord & { readonly hash: string }) | null,
      recomputeHash: (record) => {
        const { hash, ...rest } = record as unknown as Record<string, unknown>;
        return subjectRecordHash(rest);
      },
    });
    if (!result.linked) return result.detail;
    for (const record of result.extension) this.chain.push(record);
    return null;
  }

  private append<T extends SubjectChainRecord>(
    build: (
      sequenceNumber: number,
      previousHash: string,
      // ⛔ THE PREVIOUS RECORD, NOT JUST ITS HASH, AND THE CLOCK DEPENDS ON IT.
      // The bridge's writer stamps `timestamp` NON-DECREASING by comparing
      // against the last record already in the store, and that guarantee is
      // what S1's known-dirty `clockToleranceMs = 1100` rests on: the basis says
      // in as many words that no LATER record can contradict its own append
      // order. A chained writer that could not see the previous record would
      // silently revoke that, and the tolerance would go from admitting one
      // historical pair to hiding a live defect.
      //
      // It is read HERE, inside `prepare`, which runs after `resyncUnderLock()`
      // under the inter-process lock — so it is the true predecessor at the
      // moment this record is built, not one read a moment earlier by a caller.
      previousRecord: SubjectChainRecord | null
    ) => Omit<T, "hash">
  ): AppendOutcome<T> {
    return appendStoreTransaction<T>({
      path: this.path,
      persisting: this.persisting,
      lastError: this.lastError,
      storeLabel: "subject chain",
      prepare: () => {
        const sequenceNumber = this.chain.length;
        const previous = sequenceNumber === 0 ? null : this.chain[sequenceNumber - 1];
        const previousHash = previous === null ? "" : previous.hash;
        const withoutHash = build(sequenceNumber, previousHash, previous);
        const hash = subjectRecordHash(withoutHash as unknown as Record<string, unknown>);
        const record = { ...withoutHash, hash } as unknown as T;
        return {
          record,
          line: JSON.stringify(record) + "\n",
          commit: () => {
            this.chain.push(record);
            // A store that was ABSENT or EMPTY has now got its first record and
            // is a verified chain of one. Said here rather than re-read from
            // disk: the append just returned durable.
            this.loadState = LOADED_SUBJECT_CHAIN_VERIFIED;
          },
        };
      },
      resync: () => this.resyncUnderLock(),
      appender: this.appender,
      acquire: this.acquire,
      memoryDetail:
        "no subject-chain path was injected: this record is IN MEMORY only and " +
        "does not survive the process. It carries integrity but not provenance.",
      notPersistingDetail:
        "the subject chain is not in a persisting state; the record was not " +
        "written to disk.",
      onAppendBlocked: (detail) => {
        this.lastError = detail;
        return detail;
      },
      onAppendError: (raw) => {
        this.lastError = `cannot append to the subject chain: ${raw}`;
        return this.lastError;
      },
    });
  }

  /**
   * THE FIRST LINE. Names what this chain replaced, inside the chain, hashed
   * like every other record (ruling 3).
   *
   * `retired: null` is a first boot and is a different fact from a rotation —
   * carried in a value, never in an absent field.
   */
  appendBoundary(
    retired: RetiredPredecessor | null,
    basis: string,
    at: number
  ): AppendOutcome<SubjectBoundaryRecord> {
    if (this.chain.length !== 0) {
      // Not a typed refusal from the transaction: this is a caller error, and a
      // second boundary is exactly the "the log starts here, again" line that
      // would make the first one worthless.
      throw new Error(
        `a ${SUBJECT_LOG_BOUNDARY_EVENT_TYPE} may only occupy position 0; this ` +
          `chain already holds ${String(this.chain.length)} record(s).`
      );
    }
    return this.append<SubjectBoundaryRecord>(() => ({
      recordType: "SUBJECT_LOG_BOUNDARY",
      sequenceNumber: 0,
      previousHash: "",
      retired,
      basis,
      timestamp: at,
      moduleId: SUBJECT_LOG_BOUNDARY_MODULE_ID,
      eventType: SUBJECT_LOG_BOUNDARY_EVENT_TYPE,
      outcome: SUBJECT_LOG_BOUNDARY_OUTCOME,
    }));
  }

  /**
   * One subject event. `build` receives the position this record will take —
   * which, with the boundary at 0, is exactly the 1-based `subjectSeq` the
   * bridge has always returned to its caller. The two numbers coincide BY
   * CONSTRUCTION rather than by coincidence, and the test beside this file
   * pins that so a successor does not "tidy" one of them away.
   *
   * The record `build` returns carries MICA's five declared fields and whatever
   * else the writer declares; this journal adds `recordType`, `previousHash`
   * and `hash` and refuses anything that does not validate.
   */
  appendEvent(
    build: (
      sequenceNumber: number,
      previousRecord: Record<string, unknown> | null
    ) => Record<string, unknown>
  ): AppendOutcome<SubjectEventRecord> {
    if (this.persisting && this.path !== null && this.chain.length === 0) {
      throw new Error(
        `this subject chain has no ${SUBJECT_LOG_BOUNDARY_EVENT_TYPE} at position ` +
          `0. A subject event may not be the first line of a chain: the chain ` +
          `would then be unable to say where it began.`
      );
    }
    return this.append<SubjectEventRecord>((sequenceNumber, previousHash, previousRecord) => {
      const body = build(
        sequenceNumber,
        previousRecord as unknown as Record<string, unknown> | null
      );
      return {
        ...body,
        recordType: "SUBJECT_EVENT",
        sequenceNumber,
        previousHash,
      } as unknown as Omit<SubjectEventRecord, "hash">;
    });
  }
}

export { durableLineAppender, exclusiveFileLock, appendLockPath };
