// ── MICA · S-4 witness — the diary that writes itself ────────────────
//
// This is a retainer, not a sensor. It records submissions and its own observed
// placement; it emits no verdict, recommendation, certification, or all-clear.
//
// The local receipt copy is a convenience pointer; the evidential object is the
// witness's OWN retention. A receipt therefore accompanies a retained
// HEAD_COMMIT but never replaces the witness record that made it.
//
// Chain arithmetic is local on purpose. Importing another ledger's canonical
// bytes would let changes to that ledger silently rewrite this evidence format.
//
// ── THE INTER-PROCESS CONTRACT (S85) ─────────────────────────────────────────
//
//   The chain arithmetic above is local, and it used to be blind to other
//   processes. `seq` came from an array loaded once at construction, and the
//   append was a bare `appendFileSync`. Because the CONSTRUCTOR ITSELF appends a
//   PLACEMENT record, two constructions on one store — no interleaving and
//   no concurrency, three synchronous steps — were enough to write two
//   records numbered the same. The chain was then semantically FORKED: the next
//   load fails positionally, the store is marked non-appendable, and every later
//   append throws. It fails closed, and it fails permanently.
//
//   So every append now runs: TAKE the sibling lock -> RE-SYNC from disk under
//   it -> DERIVE the record from the disk-true head -> APPEND -> RELEASE, always.
//
//   THE LOCK ALONE WOULD NOT FIX IT. Serializing two writers that each derived a
//   sequence number at construction produces the same two siblings, one after the
//   other. The re-sync is the load-bearing half: a store must ask the disk where
//   the head is while it holds the exclusive right to extend it.
//
//   THE LOCK AND THE RE-SYNC ARE IMPORTED, NOT REIMPLEMENTED. They live in
//   src/mica/store/append-store.ts, where this substrate states its append
//   contract exactly once. A second lock implementation here would be a drift
//   surface, and the witness's independence from the observed node is already
//   declared a DEPLOYMENT fact rather than a code fact (see
//   INDEPENDENCE_IS_A_DEPLOYMENT_FACT below) — same repo, same runtime, same
//   `fs`, whether the seam is shared or copied.
//
//   THE DURABLE WRITE IS AN INJECTED SEAM, for the same reason the lock is: the
//   ordering inside the critical section — write to disk, and only then advance
//   live state — is only testable if the write can be made to fail on demand. The
//   production path is `durableLineAppender` and nothing about it is tuned.
//
//   THE FAILURE IDIOM IS A THROW, because that is the idiom this file already
//   had: a non-appendable store throws, so a lock that cannot be taken and a
//   chain that no longer links throw too, naming the lock path and the drift.
//   There is no expiry, no retry and no timer. A lock file left behind by a crash
//   is cleared by an operator, by hand, and never by a lapse.
//
// ── THE READBACK (S92, 2026-08-28) ───────────────────────────────────────────
//
//   The append named above is a SEAM, and a seam that RETURNS is not a seam that
//   WROTE. A pen that silently wrote nothing — or wrote something other than the
//   record handed to it — let live state advance anyway, and the divergence
//   surfaced only at the NEXT append, when the re-sync found a file shorter than
//   the chain and reported it "truncated or replaced". Deferred, and conditional
//   on there being a next append at all: a witness whose only record vanished
//   raised nothing until something asked it to write again.
//
//   So the critical section now runs: TAKE the lock -> RE-SYNC -> DERIVE ->
//   APPEND -> READ THE BOOK BACK -> ADVANCE -> RELEASE, always. Under the same
//   lock, before the push, the store is re-read and its last non-empty line must
//   be the bytes just handed to the appender.
//
//   ON MISMATCH OR ABSENCE IT THROWS, naming the store, what was expected and
//   what was found. Nothing advances, nothing is written twice, and no repair is
//   attempted — the same idiom as the lock and the fork above, and for the same
//   reason. This witness does not remember what the disk does not hold.

import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import type { Stats } from "fs";
import {
  createHash,
  createPrivateKey,
  KeyObject,
  sign,
} from "crypto";
import { hostname } from "os";
import { dirname, join } from "path";

import {
  appendLockPath,
  durableLineAppender,
  exclusiveFileLock,
  resyncAppendStore,
} from "../mica/store/append-store";
import type {
  ChainedRecord,
  LineAppender,
  LockAcquirer,
} from "../mica/store/append-store";

import { MODALITIES } from "./types";
import type {
  HeadCommit,
  KeyUnavailableObservation,
  MalformedSubmission,
  Modality,
  NamedHeadCommit,
  PlacementObservation,
  PlacementReading,
  UnmodalizedHeadCommit,
  UnreadableDropObservation,
  WitnessLoadState,
  WitnessOptions,
  WitnessReceipt,
  WitnessRecord,
  WitnessSubmissionResult,
  WitnessVerifyResult,
  WitnessedKind,
} from "./types";

export const WITNESS_TITLE =
  "S-4 WITNESS — a tamper-evident append-only retainer of other parties' chain heads. " +
  "A diary that writes itself; anyone can read it.";

export const WITNESS_READS =
  "Head-commit submissions presented to its intake, and nothing else. It cannot see " +
  "chains it is not shown, cannot see submissions that never arrive, and cannot see the world.";

export const WITNESS_CERTIFIES_NOTHING =
  "Retention is not truth. A receipt says one thing: these bytes named this head at this " +
  "arrival stamp, and the witness still holds that. It does not say the chain is complete, " +
  "healthy, honest, or the operational chain. Certification belongs to the doctor and the " +
  "arbiter; interpretation to any reader. This witness recommends nothing.";

export const INDEPENDENCE_IS_A_DEPLOYMENT_FACT =
  "This witness stamps the principal, host, and store permissions it OBSERVED at startup. " +
  "It cannot verify its own independence: a witness the observed node can write to is the " +
  "node holding its own head. Whether this deployment satisfies separation is externally " +
  "auditable and is not attested here — a declared-vs-observed mismatch is a consistency " +
  "signal, never a confirmation of topology.";

export const RETENTION_IS_NOT_TRUTH =
  "A system that lies in real time — submitting false heads promptly, in order, under an " +
  "honest clock — receives flawless receipts. The lie is perfectly preserved. This witness " +
  "kills every easier fraud: backdating, reordering, truncation, and rewriting become loud. " +
  "The smooth live liar it cannot see, and does not claim to.";

export const THE_STORE_REFUSES_TO_FORK =
  "Two writers at one witness store cannot fork the chain: every append takes the " +
  "exclusive sibling lock, re-reads the store under it, and either links onto the " +
  "head the disk actually holds or throws naming the lock — which buys one " +
  "total order a reader can rely on, and says nothing whatever about whether " +
  "what is retained in it is true.";

export const ALL_RECEIPTS_HISTORICAL =
  "A consumer checking continuity must check EVERY retained receipt against the live chain, " +
  "never only the newest. A rebuild that reproduces the current head must also reproduce " +
  "every historical head retained here; each receipt is an independent constraint.";

export const SRSSOT_NAMED_DEPENDENCY =
  "The witnessed chain must BE the operational chain — one chain: emitted, evaluated, " +
  "committed, read. A node can run on one chain and show another to this witness; every " +
  "receipt authentic, the wrong book perfectly audited. That is a deployment-infrastructure " +
  "fact this witness cannot decide.";

const RECORD_KEYS = [
  "seq",
  "arrivalTs",
  "submitterId",
  "kind",
  "witnessed",
  "previousHash",
  "hash",
] as const;
// S-4 v0.3 §4, ruled 2026-08-26 (the arbiter, S88): FIVE keys. `modality` joined the
// freeze on that date. The four-key list it replaced still has a name below,
// because a four-key drop remains something this witness must be able to READ —
// it simply no longer validates as a head commit.
//
// THIS LIST IS DUPLICATED. `DROP_HEAD_KEYS` in `./drop-committer.ts` carries the
// same five names for the PRODUCER end. The duplication is the coupling bar
// working as designed, not drift: this file is the RETAINER's closed schema and
// that one is a SUBMITTER's serializer, and a retainer's schema must not be
// rewritten by an edit to a submitter. `witnessd.test.ts` asserts the two lists
// equal, which is the only place in the repository that may hold them both.
const HEAD_KEYS = ["seq_no", "head_hash", "ts", "witness_set_id", "modality"] as const;
const UNMODALIZED_HEAD_KEYS = ["seq_no", "head_hash", "ts", "witness_set_id"] as const;
// S105, 2026-09-03: the SIX-key shape, `chain_id` last. `HEAD_KEYS` above is NOT
// widened and must not be — every five-key HEAD_COMMIT already on disk is
// re-validated by `validateRecord` on every load, so a wider `HEAD_KEYS` would
// stop a store that verified yesterday from verifying today. See
// `HeadCommitRecord` in ./types for the whole argument.
//
// DUPLICATED, on purpose, exactly as `HEAD_KEYS` is: `NAMED_DROP_HEAD_KEYS` in
// ./drop-committer.ts carries the same six names for the PRODUCER end, and
// `witnessd.test.ts` is the only place in the repository that holds both.
const NAMED_HEAD_KEYS = [
  "seq_no",
  "head_hash",
  "ts",
  "witness_set_id",
  "modality",
  "chain_id",
] as const;
const MALFORMED_KEYS = ["byteLength", "sha256"] as const;
const PLACEMENT_KEYS = [
  "effectiveUid",
  "effectiveGid",
  "hostname",
  "storePath",
  "storeMode",
  "keyAvailable",
  "platform",
] as const;
const KEY_UNAVAILABLE_KEYS = ["keyPath", "detail"] as const;
const UNREADABLE_DROP_KEYS = ["error", "size", "mode"] as const;
const KIND_SET = new Set<WitnessedKind>([
  "HEAD_COMMIT",
  "MALFORMED_SUBMISSION",
  "UNDECLARED_SUBMITTER",
  "PLACEMENT",
  "KEY_UNAVAILABLE",
  "UNREADABLE_DROP",
  "UNDECLARED_MODALITY",
  "NAMED_HEAD_COMMIT",
  "NAMED_UNDECLARED_SUBMITTER",
]);
const MODALITY_SET = new Set<Modality>(MODALITIES);

/** Longest `chain_id` this intake will frame. See CHAIN_ID_GRAMMAR in ./types. */
const CHAIN_ID_MAX = 128;

/**
 * THE CHAIN_ID FRAMING RULE. Every clause is argued at `CHAIN_ID_GRAMMAR` in
 * ./types, which is the copy a reader is meant to find; this is the executable
 * one and the two must not drift — `witness.test.ts` holds them together.
 *
 * This is FRAMING, not adjudication. It says what a field may look like on the
 * wire, exactly as the modality enum does and as "a line ends with a newline"
 * does. It says nothing whatever about WHICH chain is being named, and the
 * witness never supplies, completes, or corrects the value.
 */
function isFramedChainId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > CHAIN_ID_MAX) return false;
  if (value.includes("/") || value.includes("\\") || value.includes("..")) {
    return false;
  }
  for (const ch of value) {
    const code = ch.codePointAt(0) as number;
    // C0, DEL, and C1: unprintable bytes in a field a human is meant to read.
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return false;
    // ANY whitespace, not just the space. The preimage is space-joined, and a
    // tab or a newline inside a retained field is the same seam by another name.
    if (/\s/.test(ch)) return false;
  }
  return true;
}

type PlainObject = Record<string, unknown>;

function isObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: PlainObject, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return (
    own.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPlacementReading(value: unknown): boolean {
  if (!isObject(value) || typeof value.state !== "string") return false;
  if (value.state === "OBSERVED") {
    return hasExactKeys(value, ["state", "value"]) && isNonNegativeInteger(value.value);
  }
  if (value.state === "NOT_OBSERVABLE" || value.state === "READ_FAILED") {
    return hasExactKeys(value, ["state", "reason"]) && typeof value.reason === "string";
  }
  return false;
}

/** The four fields both commit shapes share. Neither shape is judged here. */
function hasValidLegacyFields(value: PlainObject): boolean {
  return (
    typeof value.seq_no === "number" &&
    Number.isSafeInteger(value.seq_no) &&
    value.seq_no >= -1 &&
    typeof value.head_hash === "string" &&
    isFiniteNumber(value.ts) &&
    typeof value.witness_set_id === "string"
  );
}

function validateHeadCommit(value: unknown): HeadCommit | null {
  if (!isObject(value) || !hasExactKeys(value, HEAD_KEYS)) return null;
  if (!hasValidLegacyFields(value)) return null;
  // A FIVE-KEY DROP WHOSE `modality` IS OUTSIDE THE ENUM IS NOT A COMMIT. It
  // falls to MALFORMED_SUBMISSION, exactly as the exact-key rule already makes a
  // six-key drop malformed: the enum is CHANNEL FRAMING, not adjudication of
  // what the submitter meant, and the digest retains the attempt either way.
  if (typeof value.modality !== "string") return null;
  if (!MODALITY_SET.has(value.modality as Modality)) return null;
  return value as unknown as HeadCommit;
}

/**
 * The FOUR-key legacy shape. Reached only after `validateHeadCommit` has already
 * said no, so this never sees a five-key drop.
 *
 * It fabricates nothing: what it returns is exactly what arrived.
 */
function validateUnmodalizedHeadCommit(
  value: unknown
): UnmodalizedHeadCommit | null {
  if (!isObject(value) || !hasExactKeys(value, UNMODALIZED_HEAD_KEYS)) return null;
  if (!hasValidLegacyFields(value)) return null;
  return value as unknown as UnmodalizedHeadCommit;
}

/**
 * The SIX-key shape (S105). Asked FIRST, so it never sees a five-key drop and a
 * five-key drop never reaches it.
 *
 * A six-key drop whose `chain_id` is outside the grammar returns null and falls
 * to MALFORMED_SUBMISSION — the identical treatment an out-of-enum `modality`
 * already gets, for the identical reason. The digest retains the attempt either
 * way, so nothing about what arrived is lost by refusing to call it a commit.
 */
function validateNamedHeadCommit(value: unknown): NamedHeadCommit | null {
  if (!isObject(value) || !hasExactKeys(value, NAMED_HEAD_KEYS)) return null;
  if (!hasValidLegacyFields(value)) return null;
  if (typeof value.modality !== "string") return null;
  if (!MODALITY_SET.has(value.modality as Modality)) return null;
  if (!isFramedChainId(value.chain_id)) return null;
  return value as unknown as NamedHeadCommit;
}

function validateWitnessed(kind: WitnessedKind, value: unknown): boolean {
  if (kind === "HEAD_COMMIT" || kind === "UNDECLARED_SUBMITTER") {
    return validateHeadCommit(value) !== null;
  }
  if (kind === "NAMED_HEAD_COMMIT" || kind === "NAMED_UNDECLARED_SUBMITTER") {
    return validateNamedHeadCommit(value) !== null;
  }
  if (kind === "UNDECLARED_MODALITY") {
    return validateUnmodalizedHeadCommit(value) !== null;
  }
  if (!isObject(value)) return false;
  if (kind === "MALFORMED_SUBMISSION") {
    return (
      hasExactKeys(value, MALFORMED_KEYS) &&
      isNonNegativeInteger(value.byteLength) &&
      typeof value.sha256 === "string"
    );
  }
  if (kind === "PLACEMENT") {
    return (
      hasExactKeys(value, PLACEMENT_KEYS) &&
      typeof value.platform === "string" &&
      isPlacementReading(value.effectiveUid) &&
      isPlacementReading(value.effectiveGid) &&
      typeof value.hostname === "string" &&
      typeof value.storePath === "string" &&
      isPlacementReading(value.storeMode) &&
      typeof value.keyAvailable === "boolean"
    );
  }
  if (kind === "KEY_UNAVAILABLE") {
    return (
      hasExactKeys(value, KEY_UNAVAILABLE_KEYS) &&
      (value.keyPath === null || typeof value.keyPath === "string") &&
      typeof value.detail === "string"
    );
  }
  // UNREADABLE_DROP. No hash key is accepted here, and that is the assertion:
  // no bytes were read, so nothing may claim to have digested any.
  return (
    hasExactKeys(value, UNREADABLE_DROP_KEYS) &&
    typeof value.error === "string" &&
    isPlacementReading(value.size) &&
    isPlacementReading(value.mode)
  );
}

function validateRecord(value: unknown): WitnessRecord | null {
  if (!isObject(value) || !hasExactKeys(value, RECORD_KEYS)) return null;
  if (
    !isNonNegativeInteger(value.seq) ||
    !isFiniteNumber(value.arrivalTs) ||
    typeof value.submitterId !== "string" ||
    typeof value.kind !== "string" ||
    !KIND_SET.has(value.kind as WitnessedKind) ||
    typeof value.previousHash !== "string" ||
    typeof value.hash !== "string"
  ) {
    return null;
  }
  const kind = value.kind as WitnessedKind;
  if (!validateWitnessed(kind, value.witnessed)) return null;
  return value as unknown as WitnessRecord;
}

/**
 * ── EVERY FIELD OF A RETAINED PAYLOAD MUST APPEAR HERE, AND THAT IS THE WHOLE ──
 * ── REASON THIS FUNCTION LISTS FIELDS BY NAME INSTEAD OF SERIALISING OBJECTS ──
 *
 * A field that is STORED but not hashed can be rewritten on disk without
 * breaking the chain. For `modality` that is not a theoretical hole: a declared
 * IMPOSED could be edited to OFFERED and `verify()` would still say the store is
 * intact — the exact false attestation this instrument exists to make loud.
 *
 * So when a payload type grows a field, IT GROWS ONE HERE IN THE SAME EDIT.
 * `witness.test.ts` flips a retained modality byte on disk and requires
 * `verify()` to break at that seq; that test is the guard on this paragraph.
 */
function canonicalWitnessed(kind: WitnessedKind, value: WitnessRecord["witnessed"]): string[] {
  switch (kind) {
    case "HEAD_COMMIT":
    case "UNDECLARED_SUBMITTER": {
      const head = value as HeadCommit;
      return [
        String(head.seq_no),
        head.head_hash,
        String(head.ts),
        head.witness_set_id,
        head.modality,
      ];
    }
    // ── `chain_id` IS LAST, AND ITS NEIGHBOURS ARE THE REASON (S105) ────────
    //
    //   This preimage is SPACE-JOINED. Two adjacent fields that can BOTH hold a
    //   space are two fields whose boundary a disk edit can move: the bytes are
    //   different, the preimage is identical, the hash matches, and `verify()`
    //   says VALID over a record that now claims something else.
    //
    //   `chain_id` cannot hold a space (`isFramedChainId`), and it is placed
    //   between `modality` — a closed enum — and `previousHash`, a hex digest
    //   this witness computes. All three are space-free, so no boundary here
    //   can be moved. Placing it beside `witness_set_id`, which IS a free
    //   submitter-supplied string, would have opened exactly that seam.
    //
    //   DO NOT REORDER THIS LIST to make it match the interface's field order.
    case "NAMED_HEAD_COMMIT":
    case "NAMED_UNDECLARED_SUBMITTER": {
      const named = value as NamedHeadCommit;
      return [
        String(named.seq_no),
        named.head_hash,
        String(named.ts),
        named.witness_set_id,
        named.modality,
        named.chain_id,
      ];
    }
    case "UNDECLARED_MODALITY": {
      // FOUR fields, because four is what arrived. There is no fifth to hash and
      // the witness will not invent one to make the two cases look alike.
      const unmodalized = value as UnmodalizedHeadCommit;
      return [
        String(unmodalized.seq_no),
        unmodalized.head_hash,
        String(unmodalized.ts),
        unmodalized.witness_set_id,
      ];
    }
    case "MALFORMED_SUBMISSION": {
      const malformed = value as MalformedSubmission;
      return [String(malformed.byteLength), malformed.sha256];
    }
    case "PLACEMENT": {
      const placement = value as PlacementObservation;
      return [
        placement.platform,
        placement.effectiveUid.state,
        placement.effectiveUid.state === "OBSERVED"
          ? String(placement.effectiveUid.value)
          : placement.effectiveUid.reason,
        placement.effectiveGid.state,
        placement.effectiveGid.state === "OBSERVED"
          ? String(placement.effectiveGid.value)
          : placement.effectiveGid.reason,
        placement.hostname,
        placement.storePath,
        placement.storeMode.state,
        placement.storeMode.state === "OBSERVED"
          ? String(placement.storeMode.value)
          : placement.storeMode.reason,
        String(placement.keyAvailable),
      ];
    }
    case "KEY_UNAVAILABLE": {
      const unavailable = value as KeyUnavailableObservation;
      return [unavailable.keyPath ?? "null", unavailable.detail];
    }
    case "UNREADABLE_DROP": {
      const denied = value as UnreadableDropObservation;
      return [
        denied.error,
        denied.size.state,
        denied.size.state === "OBSERVED"
          ? String(denied.size.value)
          : denied.size.reason,
        denied.mode.state,
        denied.mode.state === "OBSERVED"
          ? String(denied.mode.value)
          : denied.mode.reason,
      ];
    }
  }
}

/** Fixed field order used for every witness-chain hash. */
export function canonicalWitnessRecord(
  record: Omit<WitnessRecord, "hash">
): string {
  return [
    String(record.seq),
    String(record.arrivalTs),
    record.submitterId,
    record.kind,
    ...canonicalWitnessed(record.kind, record.witnessed),
    record.previousHash,
  ].join(" ");
}

export function computeWitnessRecordHash(
  record: Omit<WitnessRecord, "hash">
): string {
  return createHash("sha256")
    .update(canonicalWitnessRecord(record), "utf8")
    .digest("hex");
}

/** The receipt signature preimage, with contract field order pinned explicitly. */
export function canonicalReceipt(
  receipt: Omit<WitnessReceipt, "witness_sig">
): string {
  return [
    String(receipt.seq_no),
    receipt.head_hash,
    String(receipt.witness_ts),
  ].join(" ");
}

function withoutHash(record: WitnessRecord): Omit<WitnessRecord, "hash"> {
  const { hash: _hash, ...rest } = record;
  return rest;
}

/**
 * THE SEQ BRIDGE, and it is deliberately this thin.
 *
 * The append seam speaks `sequenceNumber`; a witness record on disk says `seq`,
 * and THE ON-DISK FORMAT DOES NOT CHANGE — a stored record that grew a second
 * name for its own sequence number would break every hash retained before today.
 * So the bridge is a VIEW, built for the re-sync and unwrapped immediately after:
 * the seam is untouched, the format is untouched, and nothing outside these three
 * functions ever sees a witness record wearing the seam's field names.
 */
interface WitnessChainView extends ChainedRecord {
  readonly record: WitnessRecord;
}

function chainView(record: WitnessRecord): WitnessChainView {
  return {
    record,
    sequenceNumber: record.seq,
    previousHash: record.previousHash,
    hash: record.hash,
  };
}

/** The store's own closed-shape validator, seen through the bridge. */
function validateChainView(parsed: unknown): WitnessChainView | null {
  const record = validateRecord(parsed);
  return record === null ? null : chainView(record);
}

/** The operator-facing message for an append that could not take the lock. */
function lockUnavailableMessage(lockPath: string, reason: string): string {
  return (
    `the witness append lock could not be taken (${reason}), so this record was ` +
    `NOT retained. The lock is ${lockPath}. It has no expiry and no timer will ` +
    `ever clear it: if another witness process is writing, this is contention and ` +
    `the record is simply not retained; if nothing is writing, the lock file was ` +
    `left behind by a crash and an operator removes THAT FILE by hand. Do not ` +
    `delete the witness store — the record of what happened is the thing being ` +
    `protected here.`
  );
}

/** The operator-facing message for a record that is not in the book it was written to. */
function readbackFailedMessage(
  storePath: string,
  expected: string,
  found: string
): string {
  return (
    `the witness read its own store back and did not find the record it had just ` +
    `written. The store is ${storePath}. The last line was expected to be ` +
    `${expected}; instead ${found}. Nothing was retained and live state did NOT ` +
    `advance: a witness does not remember what the disk does not hold. There is ` +
    `no second attempt and no repair here — an operator establishes what this ` +
    `store actually holds before anything writes to it again.`
  );
}

/** The operator-facing message for an append onto a chain that already forked. */
function forkedOnDiskMessage(drift: string): string {
  return (
    `the witness store on disk no longer links onto the chain loaded from it: ` +
    `${drift}. Nothing was retained. Another writer has already forked this file, ` +
    `and appending onto a fork deepens it.`
  );
}

function privateKeyAt(path: string | undefined): {
  key: KeyObject | null;
  detail: string | null;
} {
  if (path === undefined) {
    return { key: null, detail: "no keyPath was injected" };
  }
  try {
    const key = createPrivateKey(readFileSync(path));
    if (key.asymmetricKeyType !== "ed25519") {
      return {
        key: null,
        detail: `signing key is ${String(key.asymmetricKeyType)}, not ed25519`,
      };
    }
    return { key, detail: null };
  } catch (error) {
    return { key: null, detail: `cannot read signing key: ${String(error)}` };
  }
}

/**
 * A deployment act named in the recipe was never performed. Typed so a caller
 * can tell "the deployer skipped a step" apart from "the disk broke".
 */
export class WitnessDeploymentActMissing extends Error {
  constructor(
    message: string,
    readonly path: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "WitnessDeploymentActMissing";
  }
}

/**
 * The witness store directory is a DEPLOYMENT ACT (recipe §5.1). This checks;
 * it never creates.
 *
 * `statSync` rather than `existsSync` so that "I cannot see it" is not reported
 * as "it is not there": a directory this process may not enter fails here too,
 * and the underlying errno rides along in the message saying which.
 */
function requireWitnessStoreDir(dir: string): void {
  const signpost =
    `witness store directory absent — this is a deployment act ` +
    `(deploy recipe §5.1). Expected: ${dir} at 2750 mica-witness:mica-readers. ` +
    `Nothing was created.`;
  let stats: Stats;
  try {
    stats = statSync(dir);
  } catch (error) {
    throw new WitnessDeploymentActMissing(
      `${signpost} (${String(error)})`,
      dir,
      error
    );
  }
  if (!stats.isDirectory()) {
    throw new WitnessDeploymentActMissing(
      `${signpost} That path exists and is not a directory.`,
      dir
    );
  }
}

export class Witness {
  readonly id: string;

  private readonly records: WitnessRecord[] = [];
  private readonly declaredSubmitters: ReadonlySet<string>;
  private readonly clock: () => number;
  private readonly acquire: LockAcquirer;
  private readonly appendLine: LineAppender;
  private loadState: WitnessLoadState = "EMPTY";
  private loadBrokenAt: number | null = null;

  constructor(private readonly options: WitnessOptions) {
    this.id = options.witnessSetId;
    this.declaredSubmitters = new Set(options.declaredSubmitters);
    this.clock = options.witnessClock ?? Date.now;
    // Assigned before the first append, and the constructor's own PLACEMENT is an
    // append: a witness that cannot take the lock does not come up half-made.
    this.acquire = options.lockAcquirer ?? exclusiveFileLock;
    this.appendLine = options.appender ?? durableLineAppender;
    this.prepareAndLoadStore();
    if (this.loadState === "EMPTY" || this.loadState === "LOADED_VERIFIED") {
      this.appendPlacement();
    }
  }

  private prepareAndLoadStore(): void {
    // ── THE WITNESS DOES NOT CREATE ITS OWN STORE DIRECTORY (S96-D, S97) ──────
    //
    //   This line was `mkdirSync(dirname(this.options.storePath), { recursive:
    //   true })` until 2026-08-31. S86 cut the same call from the intake's
    //   producers, S88 from the intake's consumer, S96 from the outbox — and the
    //   parent of the book itself was never looked at. It is the one that
    //   matters most. Recipe §5.1 makes it `2750 mica-witness:mica-readers`, and
    //   that section carries a correction (S96) written precisely because a
    //   store born under the wrong group is a book no entitled reader can open.
    //
    //   Conjured here it lands at the process umask with the process's PRIMARY
    //   group — under the deployed `UMask=0027` that is `0750
    //   mica-witness:mica-witness`, no setgid. `store.jsonl` is then born
    //   `mica-witness:mica-witness` as well, the four reader roles are locked out
    //   of the primary record, and every mode reads exactly as specified. That is
    //   the S96 defect, reproduced from every fresh start, forever.
    //
    //   So an absent store directory now throws BEFORE the store file is opened
    //   and before the constructor's PLACEMENT is appended. The ordering is the
    //   contract stated at the constructor above: a witness that cannot take the
    //   lock does not come up half-made, and neither does one whose deployment
    //   act was never performed. Nothing is created; no store file appears; no
    //   PLACEMENT is written.
    //
    //   **Do not add a create-if-missing flag here**, and do not add one under a
    //   test-only branch: a fence with a bypass is not a fence.
    requireWitnessStoreDir(dirname(this.options.storePath));
    const existed = existsSync(this.options.storePath);
    if (!existed) {
      closeSync(openSync(this.options.storePath, "a"));
      this.loadState = "EMPTY";
      return;
    }

    let raw: string;
    try {
      raw = readFileSync(this.options.storePath, "utf8");
    } catch (error) {
      this.loadState = "LOADED_UNVERIFIED_JSON";
      this.loadBrokenAt = 0;
      return;
    }
    if (raw.length === 0) {
      this.loadState = "EMPTY";
      return;
    }

    const lines = raw.split(/\r?\n/);
    if (lines[lines.length - 1] === "") lines.pop();
    for (let i = 0; i < lines.length; i++) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(lines[i]);
      } catch {
        this.loadState = "LOADED_UNVERIFIED_JSON";
        this.loadBrokenAt = i;
        return;
      }
      const record = validateRecord(parsed);
      if (record === null) {
        this.loadState = "LOADED_UNVERIFIED_SCHEMA";
        this.loadBrokenAt = i;
        return;
      }
      this.records.push(record);
    }

    const checked = this.verifyChainOnly();
    if (!checked.valid) {
      this.loadState = "STORE_BREAK";
      this.loadBrokenAt = checked.brokenAt;
      return;
    }
    this.loadState = this.records.length === 0 ? "EMPTY" : "LOADED_VERIFIED";
  }

  private appendPlacement(): void {
    const runtime = this.options.placementRuntime ?? {
      platform: process.platform,
      getuid: typeof process.getuid === "function" ? process.getuid.bind(process) : undefined,
      getgid: typeof process.getgid === "function" ? process.getgid.bind(process) : undefined,
      storeMode: (storePath: string) => statSync(storePath).mode & 0o7777,
    };
    const unreadable = "this host cannot express POSIX placement facts";
    const read = (getter: (() => number) | undefined) => {
      if (getter === undefined) {
        return { state: "NOT_OBSERVABLE", reason: unreadable } as const;
      }
      try {
        return { state: "OBSERVED", value: getter() } as const;
      } catch (error) {
        return { state: "READ_FAILED", reason: String(error) } as const;
      }
    };
    const effectiveUid = read(runtime.getuid);
    const effectiveGid = read(runtime.getgid);
    const storeMode =
      runtime.getuid === undefined
        ? ({ state: "NOT_OBSERVABLE", reason: unreadable } as const)
        : read(() => runtime.storeMode(this.options.storePath));
    const key = privateKeyAt(this.options.keyPath);
    this.appendRecord("PLACEMENT", "", {
      platform: runtime.platform,
      effectiveUid,
      effectiveGid,
      hostname: hostname(),
      storePath: this.options.storePath,
      storeMode,
      keyAvailable: key.key !== null,
    });
  }

  /**
   * The disk-truth catch-up, run while this process holds the append lock. The
   * chain loaded at construction may be a stale prefix: another witness process
   * — or another Witness in THIS process — can have appended since, and
   * merely constructing one appends. Records that link on are ADOPTED into this
   * chain, so the sequence number derived next is the true one; an extension that
   * does not link adopts nothing and fails the append typed, because appending onto
   * a fork deepens it.
   */
  private resyncUnderLock(): string | null {
    const result = resyncAppendStore<WitnessChainView>({
      path: this.options.storePath,
      known: this.records.map(chainView),
      validate: validateChainView,
      recomputeHash: (view) => computeWitnessRecordHash(withoutHash(view.record)),
    });
    if (!result.linked) return result.detail;
    for (const view of result.extension) this.records.push(view.record);
    return null;
  }

  /**
   * Read the store back and confirm the line just appended is the one on the end
   * of it. Runs under the append lock, between the durable write and the advance.
   *
   * IT IS A READBACK, NOT A VERIFY. The chain was verified at load and brought to
   * disk-truth by the re-sync while this lock was held; the only question left is
   * whether the bytes THIS process just handed to the appender are in the book.
   * So it compares the last non-empty line against those exact bytes and asks
   * nothing else — a second full verification here would re-answer a question
   * already answered and still would not answer this one.
   *
   * ABSENCE AND MISMATCH ARE THE SAME FINDING: the record is not there. Both
   * throw. Neither retries.
   */
  private readBackOrThrow(expected: string): void {
    const storePath = this.options.storePath;
    let raw: string;
    try {
      raw = readFileSync(storePath, "utf8");
    } catch (error) {
      throw new Error(
        readbackFailedMessage(
          storePath,
          expected,
          `the store could not be re-read: ${String(error)}`
        )
      );
    }
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      throw new Error(
        readbackFailedMessage(storePath, expected, "the store holds no records at all")
      );
    }
    const found = lines[lines.length - 1];
    if (found !== expected) {
      throw new Error(
        readbackFailedMessage(storePath, expected, `the last line is ${found}`)
      );
    }
  }

  private appendRecord<K extends WitnessedKind>(
    kind: K,
    submitterId: string,
    witnessed: Extract<WitnessRecord, { kind: K }>["witnessed"]
  ): Extract<WitnessRecord, { kind: K }> {
    if (this.loadState !== "EMPTY" && this.loadState !== "LOADED_VERIFIED") {
      throw new Error(`witness store is not appendable: ${this.loadState}`);
    }
    const lockPath = appendLockPath(this.options.storePath);
    const lock = this.acquire(lockPath);
    if (!lock.acquired) {
      // Nothing was written and nothing advanced. The lock file is NOT ours to
      // remove: this process never held it.
      throw new Error(lockUnavailableMessage(lockPath, lock.reason));
    }
    try {
      const drift = this.resyncUnderLock();
      if (drift !== null) throw new Error(forkedOnDiskMessage(drift));

      // Only NOW is a sequence number worth deriving: the head is disk-true, and
      // this process holds the exclusive right to extend it.
      const seq = this.records.length;
      const previousHash = seq === 0 ? "" : this.records[seq - 1].hash;
      const unhashed = {
        seq,
        arrivalTs: this.clock(),
        submitterId,
        kind,
        witnessed,
        previousHash,
      } as unknown as Omit<Extract<WitnessRecord, { kind: K }>, "hash">;
      const record = {
        ...unhashed,
        hash: computeWitnessRecordHash(unhashed as Omit<WitnessRecord, "hash">),
      } as Extract<WitnessRecord, { kind: K }>;

      // Append, read the book back, and only THEN advance live state. These three
      // statements are adjacent on purpose and their ORDER is the invariant:
      // nothing may be inserted between them, and a throw from ANY of them must
      // leave the retained prefix exactly as it was. The readback sits in the
      // middle, and it is not an insertion into the old pair but the amended
      // invariant itself: the append is a seam, and a seam that returns is not a
      // seam that wrote (S92; see the header).
      const line = JSON.stringify(record);
      this.appendLine(this.options.storePath, line + "\n");
      this.readBackOrThrow(line);
      this.records.push(record);
      return record;
    } finally {
      // Always. Including over a thrown append and over every early return.
      lock.release();
    }
  }

  /**
   * ── THE CLASSIFICATION ORDER, AND THE ONE CELL IT CANNOT REACH (S88, S105) ─
   *
   *   malformed
   *     -> named undeclared submitter -> undeclared submitter
   *     -> undeclared modality
   *     -> named head commit -> head commit
   *
   * ONE DROP PRODUCES EXACTLY ONE RECORD. The order is IDENTITY BEFORE
   * COMPLETENESS: a submitter this witness never heard of gets its NAME
   * recorded as the finding, and its modality claim — present or absent — earns
   * no more belief than the name did. S105 adds a shape above the others and
   * does not disturb that: the SIX-key shape is asked first because it is the
   * most specific, and the undeclared legs still run before the receipted ones.
   *
   * THE THREE SHAPES ARE MUTUALLY EXCLUSIVE BY CONSTRUCTION, not by ordering.
   * `hasExactKeys` means six, five and four keys are three disjoint sets, so
   * `named`, `commit` and `unmodalized` can never both be non-null. The
   * sequential asking below is belt to that braces.
   *
   * THE CELL THE ORDER CANNOT REACH, stated because it is a real hole and not a
   * shortcut: an UNDECLARED submitter presenting a FOUR-KEY drop. An
   * UNDECLARED_SUBMITTER record's payload IS a five-key `HeadCommit`, and a
   * four-key drop has no fifth key. Retaining one as UNDECLARED_SUBMITTER would
   * require this witness to author the missing modality, which it does not do,
   * ever. So that cell is retained as UNDECLARED_MODALITY instead — AND NOTHING
   * ABOUT THE UNDECLARED NAME IS LOST: `submitterId` sits on the record frame of
   * every kind, so a reader holding the declared roster sees the name is not on
   * it, whichever kind was named. Only the KIND label differs, and it names the
   * more specific finding of the two.
   *
   * The malformed leg stays first because it is the only one that does not need
   * the bytes to have parsed at all.
   */
  submitRaw(bytes: Buffer, submitterId: string): WitnessSubmissionResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      parsed = null;
    }
    const named = validateNamedHeadCommit(parsed);
    const commit = named === null ? validateHeadCommit(parsed) : null;
    // Asked ONLY once the five-key shape has said no, so it never sees a
    // five-key drop and can never re-classify one.
    const unmodalized =
      named === null && commit === null
        ? validateUnmodalizedHeadCommit(parsed)
        : null;

    if (named === null && commit === null && unmodalized === null) {
      const record = this.appendRecord("MALFORMED_SUBMISSION", submitterId, {
        byteLength: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      return { record, receipt: null, receiptPath: null };
    }
    if (named !== null && !this.declaredSubmitters.has(submitterId)) {
      // Naming your chain is not being on the roster (S105). The finding is the
      // NAME, exactly as below; the payload keeps all six fields that arrived
      // because discarding one to reuse the five-key kind would be the witness
      // throwing away something a submitter actually said.
      const record = this.appendRecord(
        "NAMED_UNDECLARED_SUBMITTER",
        submitterId,
        named
      );
      return { record, receipt: null, receiptPath: null };
    }
    if (commit !== null && !this.declaredSubmitters.has(submitterId)) {
      const record = this.appendRecord("UNDECLARED_SUBMITTER", submitterId, commit);
      return { record, receipt: null, receiptPath: null };
    }
    if (unmodalized !== null) {
      // A four-key legacy drop. NOT malformed: it parsed, and every field it
      // presented is well formed. Retained carrying exactly those four fields
      // and NOT ONE MORE, and NO RECEIPT is written — receipts attest
      // HEAD_COMMITs, and this is not one.
      const record = this.appendRecord("UNDECLARED_MODALITY", submitterId, unmodalized);
      return { record, receipt: null, receiptPath: null };
    }
    // Every other shape has returned. Exactly one of `named` and `commit` is
    // non-null here by exhaustion of the legs above; the guard is written out so
    // a later edit that adds a leg cannot reach the receipt path with nothing to
    // receipt.
    if (named === null && commit === null) {
      throw new Error("unreachable: no commit shape survived classification");
    }

    // THE RECEIPT PATH IS GATED ON THE DECLARED-SUBMITTER CHECK ABOVE, NOT ON
    // WHICH SHAPE ARRIVED. A named commit and a nameless one from a declared
    // submitter are both attested; only the KIND label and the retained fields
    // differ. `seq_no` and `head_hash` are common to both shapes, which is why
    // the receipt below needs no branch of its own.
    const attested: HeadCommit | NamedHeadCommit = named ?? (commit as HeadCommit);
    const record =
      named !== null
        ? this.appendRecord("NAMED_HEAD_COMMIT", submitterId, named)
        : this.appendRecord("HEAD_COMMIT", submitterId, commit as HeadCommit);
    const key = privateKeyAt(this.options.keyPath);
    if (key.key === null) {
      this.appendRecord("KEY_UNAVAILABLE", submitterId, {
        keyPath: this.options.keyPath ?? null,
        detail: key.detail ?? "signing key unavailable",
      });
      return { record, receipt: null, receiptPath: null };
    }

    const unsigned = {
      seq_no: attested.seq_no,
      head_hash: attested.head_hash,
      witness_ts: record.arrivalTs,
    };
    const receipt: WitnessReceipt = {
      ...unsigned,
      witness_sig: sign(
        null,
        Buffer.from(canonicalReceipt(unsigned), "utf8"),
        key.key
      ).toString("base64"),
    };
    // ── THE CONSUMER DOES NOT CREATE THE OUTBOX EITHER (S96) ────────────────
    //
    //   This line was `mkdirSync(outboxDir, { recursive: true })` until
    //   2026-08-30. S86 cut the same call from BOTH producers; S88 cut it from
    //   the intake, seventy-four lines below. NOBODY LOOKED ONE FUNCTION OVER.
    //
    //   AND THIS SIDE IS THE QUIETER HALF. Recipe §5.2 says the outbox is
    //   `mica-witness:mica-readers` at 0750 — witness writes, the four entitled
    //   roles read. A directory this process conjures is created at the process
    //   umask with the process's PRIMARY group: under the deployed `UMask=0027`
    //   that is `0750 mica-witness:mica-witness`. Every receipt then lands in a
    //   directory NO READER CAN ENTER, the witness reports nothing wrong, and
    //   the operator finds out when somebody finally goes looking for a receipt.
    //   The intake case at least fails at a submitter, loudly and immediately;
    //   this one fails at a reader who is not looking yet.
    //
    //   So a missing outbox now throws ENOENT out of the `writeFileSync` below,
    //   naming the path, and `sweepOrFail` exits the daemon. THE ARRIVAL IS
    //   ALREADY RETAINED when that happens — `appendRecord` above is durable and
    //   runs first — and `rmSync` in the sweep loop runs AFTER this method, so
    //   the drop survives for the retry. Nothing is lost; a receipt is deferred
    //   and a deployment fault is made visible.
    //
    //   **Do not add a create-if-missing flag here**, and do not add one under a
    //   test-only branch: a fence with a bypass is not a fence. Creating the
    //   outbox is a deployment act (recipe §5.2), and this is the line that
    //   makes skipping it audible.
    const receiptPath = join(
      this.options.outboxDir,
      `receipt-${String(record.seq).padStart(12, "0")}.json`
    );
    writeFileSync(receiptPath, JSON.stringify(receipt) + "\n", {
      encoding: "utf8",
      flag: "wx",
    });
    return { record, receipt, receiptPath };
  }

  /**
   * Retain a drop the OS would not let this process read.
   *
   * WHAT IT COSTS THE SUBMITTER: one retry. The drop is consumed like any
   * other, because leaving it strands a file that stops every later drop in
   * the sweep — which is the exact wedge this record exists to end. The
   * submitter still holds its own head; a head is re-committable, a fact is not.
   */
  private retainUnreadableDrop(
    submitterId: string,
    error: string,
    stats: Stats | null,
    statError: string | null
  ): WitnessSubmissionResult {
    const refused: PlacementReading<number> = {
      state: "READ_FAILED",
      reason: statError ?? "stat was not attempted",
    };
    const record = this.appendRecord("UNREADABLE_DROP", submitterId, {
      error,
      size:
        stats === null
          ? refused
          : { state: "OBSERVED", value: stats.size },
      mode:
        stats === null
          ? refused
          : { state: "OBSERVED", value: stats.mode & 0o7777 },
    });
    return { record, receipt: null, receiptPath: null };
  }

  /**
   * Consume drop files in lexical name order; each filename is the presented id.
   *
   * ── THE FRAMING RULE (RULING A, S86, 2026-08-26) ──────────────────────────
   *
   *   A NAME BEGINNING WITH `.` IS AN IN-FLIGHT FRAME, NOT A SUBMISSION. A
   *   producer writing atomically creates a dotted temp file in this same
   *   directory and renames it onto its bare submitter-id name; without this
   *   rule the witness consumes the half-written temp and retains a
   *   MALFORMED_SUBMISSION that was never sent. This amends the recipe's "it
   *   reads everything" to "it reads every SUBMISSION". It is channel framing,
   *   like a line ending with a newline — the witness still judges nothing
   *   about content.
   *
   * ── THE SILENT EXIT, CLOSED (§4, S86) ─────────────────────────────────────
   *
   *   A drop the OS refuses to let this process read used to throw out of here
   *   before `rmSync`. The file stayed; every drop sorting after it was never
   *   read; the next poll threw at the same file. Permanent, and unrecorded —
   *   reachable by any submitter with `umask 0077`. It now retains an
   *   UNREADABLE_DROP and the sweep continues.
   *
   *   ORDERING IS THE INVARIANT AND IT IS UNCHANGED: read (or fail to) ->
   *   append, durable -> remove. An append failure preserves the drop, in both
   *   branches. Do not reorder.
   */
  pollIntake(): readonly WitnessSubmissionResult[] {
    if (this.options.intakeDir === undefined) {
      throw new Error("no intakeDir was injected");
    }
    // ── THE CONSUMER DOES NOT CREATE THE INTAKE EITHER (S88) ─────────────────
    //
    //   This line was `mkdirSync(intakeDir, { recursive: true })` until
    //   2026-08-26. The S86 Intake-Creation-Cut removed the same call from BOTH
    //   producers and left `witness.ts` untouched — so the deployment act it was
    //   protecting could still be skipped, from this side.
    //
    //   AND THE CONSUMER SIDE IS THE WORSE HALF. A producer that conjures the
    //   directory writes drops into it at the wrong mode; a CONSUMER that
    //   conjures it manufactures an intake at the process umask — no setgid,
    //   wrong group, mode 0755 instead of 3730 — which submitters then cannot
    //   write to at all. Every submission fails at the far end while this sweep
    //   reads an empty directory forever and reports zero drops. THAT READS
    //   EXACTLY LIKE "NOBODY SUBMITTED ANYTHING", which is the one sentence a
    //   witness must never say by accident.
    //
    //   So a missing intake now throws ENOENT out of `readdirSync` below, and
    //   `sweepOrFail` exits the daemon naming the path. Loud and once, instead
    //   of quiet and forever. **Do not add a create-if-missing flag here.**
    const results: WitnessSubmissionResult[] = [];
    for (const name of readdirSync(this.options.intakeDir).sort()) {
      if (name.startsWith(".")) continue;
      const path = join(this.options.intakeDir, name);

      // `stat` may refuse, and its refusal is itself an observation worth
      // keeping. It is no longer allowed to end the sweep either.
      let stats: Stats | null = null;
      let statError: string | null = null;
      try {
        stats = statSync(path);
      } catch (error) {
        statError = String(error);
      }
      // Only a stat that ANSWERED can say this is not a submission. An entry
      // whose kind is unknown is handled, never skipped.
      if (stats !== null && !stats.isFile()) continue;

      let bytes: Buffer | null = null;
      let readError: string | null = null;
      try {
        bytes = readFileSync(path);
      } catch (error) {
        readError = String(error);
      }

      const result =
        bytes === null
          ? this.retainUnreadableDrop(
              name,
              readError ?? statError ?? "the drop could not be read",
              stats,
              statError
            )
          : this.submitRaw(bytes, name);
      rmSync(path);
      results.push(result);
    }
    return results;
  }

  readAll(): readonly WitnessRecord[] {
    return this.records.map((record) => ({
      ...record,
      witnessed: { ...record.witnessed },
    })) as readonly WitnessRecord[];
  }

  private verifyChainOnly(): WitnessVerifyResult {
    for (let i = 0; i < this.records.length; i++) {
      const record = this.records[i];
      if (record.seq !== i) return { valid: false, brokenAt: i };
      const previousHash = i === 0 ? "" : this.records[i - 1].hash;
      if (record.previousHash !== previousHash) {
        return { valid: false, brokenAt: i };
      }
      if (computeWitnessRecordHash(withoutHash(record)) !== record.hash) {
        return { valid: false, brokenAt: i };
      }
    }
    return { valid: true, brokenAt: null };
  }

  verify(): WitnessVerifyResult {
    const chain = this.verifyChainOnly();
    if (!chain.valid) return chain;
    if (this.loadBrokenAt !== null) {
      return { valid: false, brokenAt: this.loadBrokenAt };
    }
    return chain;
  }

  getLoadState(): WitnessLoadState {
    return this.loadState;
  }
}
