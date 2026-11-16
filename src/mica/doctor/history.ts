// ── MICA · the SUBSTRATE_READ history — the doctor-stream's own memory ────────
//
// WHAT THIS IS, AND THE ONE LOAD-BEARING CORRECTION IT MAKES AGAINST THE BRIEF
//
//   Canon 02b specifies a SUBSTRATE_READ record over a SIX-FACTOR health
//   substrate: continuous conservative lower bounds b_R, b_K, b_T, b_Eng, b_Sig,
//   b_W; health = min(b⃗); ceiling = f(health); state NOMINAL|DEGRADED|CRITICAL|
//   SUBSTRATE-UNREAD; a per-factor trajectory (conservative lower envelope) and a
//   trending_basin latch. The doctor-overlay brief asks for an append-only history
//   of "these records" populated by a recorder consuming guard()'s output.
//
//   ON DISK THAT SIX-FACTOR SUBSTRATE DOES NOT EXIST. The built MICA-machine has
//   no continuous b⃗ and no f(). What guard() (src/mica/chokepoint) actually emits
//   is a DispositionResult composed over per-sensor SensorVerdicts — each sensor
//   returns exactly one of ALARM | CANNOT_ASSESS | SILENT, and composeFloorKind
//   folds them by the SAME non-compensatory min() the ceiling path uses (ALARM <
//   CANNOT_ASSESS < SILENT as "healthiness"). So the honest history records what
//   the machine reads, under a proxy mapping stated here and printed in scope:
//
//     FACTOR   ≈  SENSOR            (identified by sensorId; the factor set is
//                                    whatever sensors were wired for that guard())
//     BOUND    ≈  VERDICT-KIND RANK quantized to {ALARM:0, CANNOT_ASSESS:0.5,
//                                    SILENT:1} — a CONSERVATIVE lower bound: a
//                                    sensor that could not read is 0.5, never 1.
//     health   ≈  min(bounds) = bound(floorKind)         (identical to the floor)
//     state    ≈  SILENT→NOMINAL · CANNOT_ASSESS→UNREAD · ALARM→CRITICAL
//
//   This is a PROXY, not the canon substrate, and the quantization to three levels
//   is the true resolution of the object — printed, never smoothed over. Where the
//   brief and canon describe a richer substrate than the machine owns, the machine
//   governs (standing instruction: contradict the brief where the code says so).
//   The build record carries this as the campaign's central deviation.
//
// ── THE SELF-MEASUREMENT BAR (the residual-wiring precedent) ───────────────────
//
//   This history is NOT readable by Sig, Eng, narrow-W, narrow-R, or clerk1.gap.
//   A sensor that read a store of its own past footprints would be measuring its
//   own footprints — the exact rot the residual-wiring round barred. So this is a
//   SEPARATE store with a SEPARATE record type, in a directory no sensor imports.
//   doctor.test.ts scans every sensor's source and asserts none reaches into
//   src/mica/doctor/. Nothing here returns a SensorVerdict or feeds guard().
//
// ── APPEND-ONLY, SEQUENCE-STAMPED, HASH-CHAINED — L0-INSPIRED, NEVER L0 ────────
//
//   Modelled on ChokepointLedger / ExportLedger (append-only, hash-chained, load-
//   state disciplined) — MICA runs solo, so ILAS's LockedEvidenceLog is not
//   imported. The hash chain is optional in the sense that it is computed
//   MICA-locally over this record's own fields, exactly as the chokepoint ledger
//   does; it is not ILAS's Merkle receipt discipline.

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "fs";
import { dirname } from "path";
import type { VerdictKind } from "../types";
import { appendStoreTransaction } from "../store/append-store";
import type { LineAppender } from "../store/append-store";
import {
  hasExactKeys,
  isArrayOf,
  isBoolean,
  isEnum,
  isFiniteNumber,
  isInteger,
  isNonNegInteger,
  isObject,
  isString,
  isStringArray,
  VERDICT_KINDS,
} from "../store/validate";
import type { Parsed } from "../store/validate";

// ── The proxy bound mapping — stated once, the whole numeric contract ─────────

/**
 * A verdict kind's conservative lower bound. The order is composeFloorKind's
 * healthiness order (ALARM worst, SILENT best); a sensor that COULD NOT READ is
 * 0.5, never 1 — an unread scope is not a healthy one (the triad's persistence
 * face). These three values are the ENTIRE resolution of this substrate; there is
 * no continuum behind them, and every overlay that reads them inherits that.
 */
export const BOUND_OF_KIND: Record<VerdictKind, number> = {
  ALARM: 0,
  CANNOT_ASSESS: 0.5,
  SILENT: 1,
};

/** Trending-critical is the worst rung: a sensor reading ALARM has touched it. */
export const TRENDING_CRITICAL_BOUND = BOUND_OF_KIND.ALARM;

/** A "valid healthy read" — the only read that advances a latch toward clearing. */
export const HEALTHY_KIND: VerdictKind = "SILENT";

// ── the head committer (locally declared, deliberately) ───────────────────────
//
// The doctor's book is a SUBMITTER, exactly like notify's and the floor trail's,
// and it declares its own commit shape for the reason both of those do: a
// retainer's evolution must not reshape the chain that submits to it, and the
// closure ruling bars `src/mica/` from importing `src/witness/` in any case.
//
// WHAT THIS BOOK GAINED AT S88, AND WHAT IT DID NOT
//
//   It gained the ANCHOR. The chain was already here — four record types, each
//   carrying `previousHash`/`hash` — and what it lacked was any way to commit
//   its head anywhere, so nothing outside this process held a claim on it. That
//   seam is `headCommitter` below, on the NoticeLog idiom exactly: post-durable
//   only, try/caught, the thrown reason retained beside the append outcome.
//
//   It did NOT gain a `modality` field on its four record types. THAT SENTENCE
//   WAS TRUE FOR ONE DAY. On 2026-08-27 (The arbiter, S88) the modality became a field
//   of the four record types themselves — see MODALITY_IS_IN_THE_ENTRY_HERE
//   below, which replaced the constant that reported the gap.

/** R8's declared modality. Local, like the commit shape it rides on. */
export type Modality = "OFFERED" | "IMPOSED" | "NOT_AN_INSTRUCTION";

export const MODALITIES: readonly Modality[] = [
  "OFFERED",
  "IMPOSED",
  "NOT_AN_INSTRUCTION",
];

/**
 * THE MODALITY EVERY SUBSTRATE_READ CARRIES, AND WHY IT IS ALWAYS THIS ONE.
 *
 * A SUBSTRATE_READ is MACHINE GLUE — `recordGuardResult` appending what `guard()`
 * already composed. No human handed it an instruction, because there is no human
 * anywhere in that path, so the honest declaration is the same one every time.
 *
 * IT IS DECLARED HERE, AT THE SITE THAT BUILDS THE RECORD, AND THAT MOVED ON
 * 2026-08-27. Until S88 it lived in `recorder.ts` and `SubstrateReadInput` took
 * an OPTIONAL `modality`, so it was a constant only for callers who happened to
 * come through the recorder; `history.record` itself would take any of the three
 * from anyone. That was survivable while the value merely rode a transient head
 * commit. It is not survivable now that the value is RETAINED and HASH-COVERED:
 * a caller passing `IMPOSED` would write a declaration nobody made into the book
 * permanently. So the parameter is gone and the constant is the only source —
 * no caller may claim otherwise about a read the machine took by itself.
 *
 * `recorder.ts` re-exports this name, which is where it was first published.
 * A doctor's ATTESTATION is a different act with a different answer, and that one
 * is declared PER APPEND on `recordAttestation` / `attemptRecovery`.
 */
export const GUARD_READS_CARRY_NO_INSTRUCTION: Modality = "NOT_AN_INSTRUCTION";

/** The five fields MICA S-4 v0.3 §4 freezes (2026-08-26, the arbiter, S88). */
export interface HeadCommit {
  readonly seq_no: number;
  readonly head_hash: string;
  readonly ts: number;
  readonly witness_set_id: string;
  readonly modality: Modality;
}

export type HeadCommitter = (commit: HeadCommit) => void;

export const HISTORY_COMMIT_IS_NOT_RETENTION =
  "This book can prove it CALLED a committer. It cannot prove anything was " +
  "retained, by whom, or where. Submission is not retention; the evidential " +
  "object is the witness's own store, which this module cannot read and does " +
  "not attest.";

/**
 * ── THE GAP THIS BOOK REPORTED FOR ONE DAY, AND WHAT CLOSED IT ───────────────
 *
 * THERE WAS A CONSTANT HERE CALLED `MODALITY_IS_STAMP_SIDE_HERE`, exported from
 * 2026-08-26 to 2026-08-27. It said: "The declared modality rides the committed
 * HEAD and does not enter this book's own records. A head overwritten in the
 * intake before a witness swept it leaves NO retained trace of its declaration
 * anywhere — this book does not hold one, and the witness never saw it. Closing
 * that means putting `modality` into these four record types, which is not this
 * build's to do."
 *
 * EVERY SENTENCE OF THAT IS NOW FALSE, and it is replaced rather than quietly
 * deleted so the change stays legible — the drop-committer header's own idiom.
 * The arbiter ruled the closure on 2026-08-27 (S88): the modality is a FIELD of all
 * four record types, it is inside all four hash preimages, and the committed
 * head COPIES `record.modality` rather than being the only place the
 * declaration was ever made.
 *
 * WHAT THAT BUYS, PRECISELY. The witness-side trail is a SAMPLE: the intake is
 * last-writer-wins, so a head overwritten between sweeps is never retained
 * witness-side at all. That head's declaration used to die with it. It no longer
 * can — the entry it named is still in this book, still carrying the same word,
 * still covered by the hash that chains it.
 *
 * WHAT IT DOES NOT BUY, AND THIS IS NOT A DETAIL. This book still proves only
 * that it CALLED a committer (see HISTORY_COMMIT_IS_NOT_RETENTION), and it is
 * still single-writer (see HISTORY_IS_STILL_SINGLE_WRITER). A retained modality
 * on a forked chain is a retained modality on a forked chain.
 */
export const MODALITY_IS_IN_THE_ENTRY_HERE =
  "The declared modality is a FIELD of all four of this book's record types and " +
  "sits inside all four hash preimages; the committed head copies " +
  "`record.modality` rather than being the only place it was said. A head " +
  "overwritten in the intake before a witness swept it therefore leaves a " +
  "RETAINED trace: the entry it named is still here, still declaring, still " +
  "hash-covered. This closes what `MODALITY_IS_STAMP_SIDE_HERE` reported " +
  "between 2026-08-26 and 2026-08-27 — that no retained trace existed anywhere. " +
  "It does NOT make this book a retention claim about the witness, and it does " +
  "NOT serialize its writers.";

export type SubstrateState = "NOMINAL" | "UNREAD" | "CRITICAL";

/**
 * The health-substrate state this read attests, derived from the floor kind. This
 * is the proxy of canon's NOMINAL|DEGRADED|CRITICAL|SUBSTRATE-UNREAD: the machine
 * does not separate DEGRADED from SUBSTRATE-UNREAD (both are the CANNOT_ASSESS
 * floor), so they fold to one UNREAD state, and that folding is printed.
 */
export function stateOfFloor(floorKind: VerdictKind): SubstrateState {
  if (floorKind === "ALARM") return "CRITICAL";
  if (floorKind === "SILENT") return "NOMINAL";
  return "UNREAD";
}

export type TrendingBasin = "clear" | "latched";

// ── The per-factor slice of one read ──────────────────────────────────────────

export interface FactorRead {
  /** The factor ≈ the sensorId whose verdict this is. */
  readonly factor: string;
  /** This read's verdict kind for the factor. */
  readonly verdictKind: VerdictKind;
  /** The conservative lower bound = BOUND_OF_KIND[verdictKind]. */
  readonly bound: number;
  /**
   * The conservative LOWER ENVELOPE of this factor's recent bounds, AS OF this
   * read — NOT a slope, NOT an EMA. Downward-excursion-persistent within the
   * retained window: once a factor dips, the trajectory holds the dip until the
   * window rolls past it. Stamped at append time; immutable thereafter.
   */
  readonly trajectory: number;
  /**
   * The retained latch state for this factor AS OF this read. Latches once the
   * factor touches trending-critical; clears only by N consecutive healthy reads
   * of THIS factor. Never a passive timeout/drop/expiry.
   */
  readonly trendingBasin: TrendingBasin;
}

// ── The SUBSTRATE_READ record (MICA-native proxy) ─────────────────────────────

export interface SubstrateReadInput {
  /** Injected read clock. The store never calls Date.now — the caller owns time. */
  readonly timestamp: number;
  /** Per-factor slices, one per wired sensor at this guard() call. */
  readonly factors: readonly FactorReadInput[];
  // NO `modality` HERE, AND ITS ABSENCE IS THE DECLARATION (S88, 2026-08-27).
  // A SUBSTRATE_READ's modality is GUARD_READS_CARRY_NO_INSTRUCTION, a constant
  // read at the construction site below — never a field of this input. It was an
  // optional field until 2026-08-27; that made it a knob a caller could turn, on
  // a record that now retains and hashes what the knob said. See the constant.
  /** The composed floor kind, read from the DispositionResult (never recomputed). */
  readonly floorKind: VerdictKind;
  /** The disposition guard() returned (RELEASE|HOLD|HOLD_BLIND|PASS_BLIND). */
  readonly disposition: string;
  /** Whether the action executed, as guard() finally ruled it. */
  readonly execute: boolean;
  /** The routed action's opaque id (never its payload). */
  readonly actionId: string;
}

/** A factor slice as supplied by the recorder — bound/trajectory/basin are derived here. */
export interface FactorReadInput {
  readonly factor: string;
  readonly verdictKind: VerdictKind;
}

export interface SubstrateReadRecord {
  readonly recordType: "SUBSTRATE_READ";
  readonly sequenceNumber: number;
  readonly timestamp: number;
  readonly factors: readonly FactorRead[];
  /** health = min(bounds). Empty factor set ⇒ null (no read happened). */
  readonly health: number | null;
  readonly floorKind: VerdictKind;
  readonly state: SubstrateState;
  readonly disposition: string;
  readonly execute: boolean;
  readonly actionId: string;
  /** The factor(s) at the minimum bound — the diagnosis target. */
  readonly weakestFactors: readonly string[];
  /** Typed refs to events raised on this read (latch, refusal-to-clear). */
  readonly flags: readonly string[];
  /**
   * The modality this read was taken under — always
   * GUARD_READS_CARRY_NO_INSTRUCTION, retained in the entry and covered by the
   * hash below, not merely stamped on a head that may be overwritten.
   */
  readonly modality: Modality;
  readonly previousHash: string;
  readonly hash: string;
}

// ── The doctor-attestation record (H1 existence-check; H2 quality fenced) ──────

export interface DoctorAttestationInput {
  readonly timestamp: number;
  /** The attesting node's opaque id. Existence-checked only; never audited. */
  readonly attesterId: string;
  /** A free note the doctor may carry. Recorded verbatim, never interpreted. */
  readonly note: string;
  /**
   * R8's declaration for THIS ACT, stamped onto the head this append commits.
   *
   * PER APPEND, not per construction, and REQUIRED. An attestation is a human
   * act: whether it was offered or imposed can differ between two appends by the
   * same doctor an hour apart, so a construction-time value would be a knob
   * stamping the wrong word on everything after the first act that differed.
   * Required rather than defaulted, because a default is a declaration nobody
   * made.
   */
  readonly modality: Modality;
}

export interface DoctorAttestationRecord {
  readonly recordType: "DOCTOR_ATTESTATION";
  readonly sequenceNumber: number;
  readonly timestamp: number;
  readonly attesterId: string;
  readonly note: string;
  /** The declaration made for THIS act, from `DoctorAttestationInput.modality`. */
  readonly modality: Modality;
  readonly previousHash: string;
  readonly hash: string;
}

export type HistoryRecord =
  | SubstrateReadRecord
  | DoctorAttestationRecord
  | RecoveryAttestationRecord
  | RefusalToClearRecord;

/**
 * The one and only claim a DOCTOR_ATTESTATION record supports, stated the way the
 * sensors state SILENCE_IS_NOT_HEALTH. It attests THAT an attestation was recorded
 * (H1, existence), never that it was any good (H2, quality — deliberately fenced).
 */
export const ATTESTATION_IS_EXISTENCE_ONLY =
  "A DOCTOR_ATTESTATION record attests THAT an attestation was recorded at this " +
  "sequence — an existence check (H1). It makes NO claim about the attestation's " +
  "quality, depth, independence, or correctness (H2), which this build fences and " +
  "does not read. A recorded attestation is not a clean bill of health.";

// ── The recovery attestation — the ONLY thing that clears a latch (F3) ────────
//
// Canon 02b §3.5 / §184-209 governs. A latch clears ONLY by an ACTIVE positive
// recovery attestation resting on the doctor's INDEPENDENT RAW-PRIMITIVE ground —
// never by the absence of an alarm. A window-scoped negative (a SILENT read: the
// mere absence of a finding) is candidate ground, NOT a clearance. So the
// clearing transition is a first-class TYPED, PERSISTED record: replaying the
// chain reproduces exactly which clears happened, without recomputing them under
// the current N (changed-config reload parity).

export interface RecoveryAttestationInput {
  /** Injected read clock. The store never calls Date.now. */
  readonly timestamp: number;
  /** The attesting node/party's opaque id. H1 existence-checked; never audited (H2 fenced). */
  readonly attesterId: string;
  /** The latched factor this recovery attests clean. */
  readonly factor: string;
  /**
   * The doctor's INDEPENDENT RAW-PRIMITIVE ground (canon 02b §3.5): references to
   * an L0 reconstruction resting on NONE of {read-trust flag, ceiling, state}.
   * H1 EXISTENCE-CHECKED ONLY — a non-empty set of non-empty strings must be
   * present. This build makes NO H2 claim that the ground is deep, correct, or
   * genuinely independent; it checks only that ground was supplied at all, exactly
   * as DOCTOR_ATTESTATION attests existence and fences quality.
   */
  readonly ground: readonly string[];
  /** A free note, recorded verbatim, never interpreted. */
  readonly note?: string;
  /**
   * R8's declaration for THIS ACT, stamped onto the head this append commits —
   * and it is stamped on a REFUSAL exactly as on a grant. A refused clearance is
   * still an act the doctor performed, and the modality it was performed under
   * is the same fact either way; suppressing it on refusals would make the
   * refusal trail quieter than the grant trail, which is backwards.
   */
  readonly modality: Modality;
}

export interface RecoveryAttestationRecord {
  readonly recordType: "RECOVERY_ATTESTATION";
  readonly sequenceNumber: number;
  readonly timestamp: number;
  readonly factor: string;
  readonly attesterId: string;
  readonly ground: readonly string[];
  /** The candidate healthy count in force when the clear was granted (audit). */
  readonly consecutiveHealthyAtClear: number;
  /** The N required at clear time — provenance, so replay never recomputes it. */
  readonly requiredHealthy: number;
  readonly note: string;
  /** The declaration made for THIS act, from `RecoveryAttestationInput.modality`. */
  readonly modality: Modality;
  readonly previousHash: string;
  readonly hash: string;
}

// ── A typed, PERSISTED refusal-to-clear record (§3.5 Sollbruchstelle) ─────────
//
// A recovery attempt that lacks its ground does NOT clear, and it is written into
// the chain as a REFUSAL_TO_CLEAR record — so a replay is exact and a reviewer
// sees every refusal, not only the clears. The clearing path is built to fail
// TOWARD holding the alarm; a loud, recorded refusal is the doctor-signal worth
// having.

export interface RefusalToClearRecord {
  readonly recordType: "REFUSAL_TO_CLEAR";
  readonly sequenceNumber: number;
  readonly timestamp: number;
  readonly factor: string;
  readonly attesterId: string;
  readonly reason: string;
  /**
   * The declaration made for THIS act, fed by `RecoveryAttestationInput.modality`
   * — the refusal path takes the same required input as the grant path, because
   * a refused clearance is still an act the doctor performed under a modality.
   * Suppressing it here would make the refusal trail quieter than the grant
   * trail, which is backwards for an instrument built to be loud about refusals.
   */
  readonly modality: Modality;
  readonly previousHash: string;
  readonly hash: string;
}

/** The outcome of one recovery attempt: granted/cleared/persisted, and why. */
export interface RecoveryOutcome {
  /** GRANTED only if latched AND independent ground AND candidate ground all held. */
  readonly granted: boolean;
  /** True only if the latch ACTUALLY cleared (granted AND the transition committed). */
  readonly cleared: boolean;
  /** The persisted record: RECOVERY_ATTESTATION on a grant, REFUSAL_TO_CLEAR otherwise. */
  readonly record: RecoveryAttestationRecord | RefusalToClearRecord;
  /** True only if that record durably persisted. */
  readonly persisted: boolean;
  /** True only when the post-durable head commit returned normally. */
  readonly headCommitted: boolean;
  /** Null when unwired or when the commit call returned; otherwise why not. */
  readonly headCommitDetail: string | null;
  /** Why, in words. On a refusal, the refusal reason. */
  readonly detail: string;
}

export const REFUSAL_TO_CLEAR_IS_HOLDING_THE_ALARM =
  "REFUSAL_TO_CLEAR: a clearance was requested for a latched factor without the " +
  "ground the latch requires — an explicit recovery attestation carrying " +
  "independent raw-primitive ground, over N consecutive healthy candidate reads " +
  "of THIS factor. The latch does NOT clear. The clearing path fails toward " +
  "HOLDING the alarm, never toward a false all-clear — a loud refusal is the " +
  "doctor-signal worth having.";

/** SILENT reads are candidate ground only — they never clear a latch (F3). */
export const SILENT_IS_CANDIDATE_GROUND_NOT_A_CLEARANCE =
  "A SILENT substrate read is an ABSENCE OF FINDING over one cadence — candidate " +
  "ground toward a clear, never itself a clearance. No number of SILENT reads " +
  "clears a latched factor: a window-scoped negative is not the presence of " +
  "ground (canon 02b). Only an explicit recovery attestation carrying independent " +
  "raw-primitive ground moves trending_basin from latched to clear.";

// ── The hash chain (mirrors ChokepointLedger.computeHash's fixed-field order) ──

function hashSubstrateRead(
  r: Omit<SubstrateReadRecord, "hash">
): string {
  const factorCanon = r.factors
    .map(
      (f) =>
        `${f.factor}:${f.verdictKind}:${f.bound}:${f.trajectory}:${f.trendingBasin}`
    )
    .join("|");
  const canonical = [
    r.recordType,
    String(r.sequenceNumber),
    r.previousHash,
    String(r.timestamp),
    factorCanon,
    r.health === null ? "null" : String(r.health),
    r.floorKind,
    r.state,
    r.disposition,
    String(r.execute),
    r.actionId,
    r.weakestFactors.join(","),
    r.flags.join(","),
    // S88, 2026-08-27: the declared modality is COVERED. Flipping it on disk
    // breaks this record's hash and the chain from it forward.
    r.modality,
  ].join(" ");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function hashAttestation(r: Omit<DoctorAttestationRecord, "hash">): string {
  const canonical = [
    r.recordType,
    String(r.sequenceNumber),
    r.previousHash,
    String(r.timestamp),
    r.attesterId,
    r.note,
    r.modality,
  ].join(" ");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function hashRecovery(r: Omit<RecoveryAttestationRecord, "hash">): string {
  const canonical = [
    r.recordType,
    String(r.sequenceNumber),
    r.previousHash,
    String(r.timestamp),
    r.factor,
    r.attesterId,
    r.ground.join(","),
    String(r.consecutiveHealthyAtClear),
    String(r.requiredHealthy),
    r.note,
    r.modality,
  ].join(" ");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function hashRefusal(r: Omit<RefusalToClearRecord, "hash">): string {
  const canonical = [
    r.recordType,
    String(r.sequenceNumber),
    r.previousHash,
    String(r.timestamp),
    r.factor,
    r.attesterId,
    r.reason,
    r.modality,
  ].join(" ");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export type HistoryLoadState =
  | "IN_MEMORY"
  | "LOADED_VERIFIED"
  | "FIRST_BOOT_OR_ERASED"
  | "CANNOT_VERIFY";

// ── Closed-shape runtime validation for the four record types (F8) ────────────
//
// Each persisted line is validated against a CLOSED discriminated schema before
// it joins the chain, is hashed, or is replayed. An unknown recordType, a wrong
// field type, an out-of-range integer, or an unknown extra field is REJECTED —
// converted to CANNOT_VERIFY — rather than cast and crashed on later (e.g. a
// SUBSTRATE_READ with a non-array `factors`, or an unknown recordType riding the
// attestation hash branch).

const SUBSTRATE_STATES = ["NOMINAL", "UNREAD", "CRITICAL"] as const;
const TRENDING_BASINS = ["clear", "latched"] as const;

function isFactorRead(x: unknown): x is FactorRead {
  if (!isObject(x)) return false;
  if (!hasExactKeys(x, ["factor", "verdictKind", "bound", "trajectory", "trendingBasin"])) {
    return false;
  }
  return (
    isString(x.factor) &&
    isEnum(x.verdictKind, VERDICT_KINDS) &&
    isFiniteNumber(x.bound) &&
    isFiniteNumber(x.trajectory) &&
    isEnum(x.trendingBasin, TRENDING_BASINS)
  );
}

// Each list gained "modality" on 2026-08-27 (S88). The schema is CLOSED, so the
// widening is two-sided and both sides are load-bearing: a line WITHOUT the key
// no longer loads, and a line with a sixth/seventh/… key still does not.
const SUBSTRATE_READ_KEYS: readonly string[] = [
  "recordType", "sequenceNumber", "timestamp", "factors", "health", "floorKind",
  "state", "disposition", "execute", "actionId", "weakestFactors", "flags",
  "modality", "previousHash", "hash",
];
const ATTESTATION_KEYS: readonly string[] = [
  "recordType", "sequenceNumber", "timestamp", "attesterId", "note", "modality",
  "previousHash", "hash",
];
const RECOVERY_KEYS: readonly string[] = [
  "recordType", "sequenceNumber", "timestamp", "factor", "attesterId", "ground",
  "consecutiveHealthyAtClear", "requiredHealthy", "note", "modality",
  "previousHash", "hash",
];
const REFUSAL_KEYS: readonly string[] = [
  "recordType", "sequenceNumber", "timestamp", "factor", "attesterId", "reason",
  "modality", "previousHash", "hash",
];

function validateHistoryRecord(x: unknown): HistoryRecord | null {
  if (!isObject(x)) return null;
  const o = x as Parsed;
  const common =
    isNonNegInteger(o.sequenceNumber) &&
    isFiniteNumber(o.timestamp) &&
    // S88: every record kind carries a modality, and it must be IN THE ENUM. A
    // line whose modality is a string outside {OFFERED, IMPOSED,
    // NOT_AN_INSTRUCTION} is CANNOT_VERIFY, not a record with a strange word in
    // it — the canonical form hashes this value, so an unenumerated one would
    // hash cleanly and read as a declaration the vocabulary does not have.
    isEnum(o.modality, MODALITIES) &&
    isString(o.previousHash) &&
    isString(o.hash);
  if (!common) return null;

  switch (o.recordType) {
    case "SUBSTRATE_READ":
      if (!hasExactKeys(o, SUBSTRATE_READ_KEYS)) return null;
      if (!isArrayOf(o.factors, isFactorRead)) return null;
      if (!(o.health === null || isFiniteNumber(o.health))) return null;
      if (!isEnum(o.floorKind, VERDICT_KINDS)) return null;
      if (!isEnum(o.state, SUBSTRATE_STATES)) return null;
      if (!isString(o.disposition)) return null;
      if (!isBoolean(o.execute)) return null;
      if (!isString(o.actionId)) return null;
      if (!isStringArray(o.weakestFactors)) return null;
      if (!isStringArray(o.flags)) return null;
      return o as unknown as SubstrateReadRecord;
    case "DOCTOR_ATTESTATION":
      if (!hasExactKeys(o, ATTESTATION_KEYS)) return null;
      if (!isString(o.attesterId) || !isString(o.note)) return null;
      return o as unknown as DoctorAttestationRecord;
    case "RECOVERY_ATTESTATION":
      if (!hasExactKeys(o, RECOVERY_KEYS)) return null;
      if (!isString(o.factor) || !isString(o.attesterId)) return null;
      if (!isStringArray(o.ground)) return null;
      if (!isNonNegInteger(o.consecutiveHealthyAtClear)) return null;
      if (!isInteger(o.requiredHealthy)) return null;
      if (!isString(o.note)) return null;
      return o as unknown as RecoveryAttestationRecord;
    case "REFUSAL_TO_CLEAR":
      if (!hasExactKeys(o, REFUSAL_KEYS)) return null;
      if (!isString(o.factor) || !isString(o.attesterId) || !isString(o.reason)) {
        return null;
      }
      return o as unknown as RefusalToClearRecord;
    default:
      // Unknown recordType — rejected, never processed through a hash branch.
      return null;
  }
}

export interface HistoryVerifyResult {
  readonly valid: boolean;
  readonly brokenAt: number | null;
}

/**
 * What one append reports back. The first three fields are what this book
 * returned before S88; the last two are the ANCHOR's answer and they are
 * REPORTED, never thrown: a head commit that failed leaves the append intact,
 * and a caller that ignores these two learns nothing it was owed.
 */
export interface HistoryAppendOutcome<T> {
  readonly record: T;
  readonly persisted: boolean;
  readonly detail: string | null;
  /** True only when the post-durable committer call returned normally. */
  readonly headCommitted: boolean;
  /** Null when unwired or when the commit call returned; otherwise why not. */
  readonly headCommitDetail: string | null;
}

export interface SubstrateHistoryOptions {
  /**
   * Where the history is kept. INJECTED, never defaulted. Absent ⇒ IN MEMORY only:
   * the history has integrity but not provenance and does not survive the process,
   * which is reported (getLoadState), never papered over.
   */
  readonly path?: string;
  /**
   * The trajectory window: how many recent reads the conservative lower envelope
   * is taken over, PER FACTOR. INJECTED, no default. Absent ⇒ the envelope is
   * taken over the WHOLE retained history for that factor (the most conservative
   * reading), and every record says the window was unbounded. A positive integer.
   */
  readonly trajectoryWindow?: number;
  /**
   * N — the number of CONSECUTIVE healthy (SILENT) reads of a latched factor that
   * clears its latch. INJECTED, no default. Absent ⇒ a latch can NEVER clear on
   * its own (a healthy-read clear needs a declared N), and requestClear always
   * refuses. This is the anti-spoof floor: quiet never upgrades without a declared,
   * grounded number of clean cycles. A positive integer.
   */
  readonly clearAfterConsecutiveHealthy?: number;
  /**
   * The durable line-appender. A FAULT-INJECTION SEAM, not a policy default:
   * production leaves it absent and a real fs append is used. Injected in tests to
   * exercise the transaction contract (a failed append must not clear a latch).
   */
  readonly appender?: LineAppender;
  /**
   * THE ANCHOR (S88). Post-durable transport boundary, on the NoticeLog idiom:
   * called only after the append durably landed, always inside a try/catch, and
   * the thrown reason retained beside the append outcome as `headCommitDetail`.
   * It GATES NOTHING — a committer that throws leaves this book exactly as it
   * was, and a deployment with no committer simply has no continuity claim.
   */
  readonly headCommitter?: HeadCommitter;
  /** Declared witness-set id copied into the commit; absent is carried as "". */
  readonly witnessSetId?: string;
}

/**
 * ── NO `lockAcquirer` HERE, AND THIS BUILD DELIBERATELY DID NOT ADD ONE ──────
 *
 * `appendRecord` below passes `resync: null` — declared, not overlooked: this
 * store still derives its sequence number from a process-local head, so two
 * concurrent writers WILL fork this chain. The S83 ruling scoped that fix to the
 * floor trail, the chokepoint ledger and the notice log, and named this store as
 * affected and NOT fixed.
 *
 * Adding the anchor does not change that and does not make it worse: a committed
 * head names a prefix that either reproduces or does not, and a forked chain
 * fails to reproduce either way. What it DOES do is make the fork LOUD instead
 * of silent, which is the whole reason for committing a head at all.
 *
 * The dispatch's instruction was: do not fix it here, print it if it matters.
 * It matters exactly this much, and this is the printing.
 */
export const HISTORY_IS_STILL_SINGLE_WRITER =
  "This history derives its sequence number from a process-local head and takes " +
  "no append lock (S83, named-affected-and-not-fixed). Two concurrent writers " +
  "fork it. Committing its head anchors the chain but does NOT serialize the " +
  "writers: what the anchor buys is that a fork becomes loud, not that it " +
  "becomes impossible.";

/**
 * The append-only, sequence-stamped, hash-chained SUBSTRATE_READ history.
 *
 * Isolated from every sensor. Populated by the recorder (deployment glue), read by
 * the overlays and the doctor-latency detector, and by nothing else, ever.
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
 * at the operator's uid with no second principal (S103, ruling-log receipt §E): strip a
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
export type HistoryFileLook =
  | { readonly state: "PRESENT" }
  | { readonly state: "ABSENT" }
  | { readonly state: "CANNOT_SEE"; readonly detail: string };

export function lookAtHistoryFile(path: string): HistoryFileLook {
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

/** The signpost handed to a caller that could not look at the substrate history. */
export function cannotSeeHistoryMessage(path: string, detail: string): string {
  return (
    `the substrate history could not be looked at, which is NOT the finding that it is ` +
    `absent — this process cannot see ${path} (${detail}). A directory whose ` +
    `execute bit is stripped produces exactly this, and no second principal is ` +
    `needed to reach it. Nothing was created, nothing was recorded as a first ` +
    `boot, and this book is NOT in a persisting state.`
  );
}

export class SubstrateHistory {
  private readonly chain: HistoryRecord[] = [];
  private readonly path: string | null;
  private readonly appender?: LineAppender;
  private readonly headCommitter?: HeadCommitter;
  private readonly witnessSetId: string;
  private readonly trajectoryWindow: number | null;
  private readonly clearAfterConsecutiveHealthy: number | null;
  private loadState: HistoryLoadState = "IN_MEMORY";
  private persisting = false;
  private lastError: string | null = null;

  // ── retained latch state, per factor — the substrate's only persistent state ─
  //
  // A latch is a STATE, not a sample: expiring the granular records cannot erase
  // it, and there is no timer that can. It lives here, updated on every append,
  // and stamped onto each factor slice as it is written.
  private readonly basin = new Map<string, TrendingBasin>();
  private readonly consecutiveHealthy = new Map<string, number>();

  constructor(options?: SubstrateHistoryOptions) {
    this.path = options?.path ?? null;
    this.appender = options?.appender;
    this.headCommitter = options?.headCommitter;
    this.witnessSetId = options?.witnessSetId ?? "";
    this.trajectoryWindow =
      isPositiveInt(options?.trajectoryWindow) ? options!.trajectoryWindow! : null;
    this.clearAfterConsecutiveHealthy = isPositiveInt(
      options?.clearAfterConsecutiveHealthy
    )
      ? options!.clearAfterConsecutiveHealthy!
      : null;
    if (this.path === null) return;
    this.loadFromDisk();
  }

  // ── load (ChokepointLedger's discipline: integrity vs provenance) ───────────

  private loadFromDisk(): void {
    const path = this.path as string;
    const look = lookAtHistoryFile(path);
    if (look.state === "CANNOT_SEE") {
      // NOT FIRST BOOT. See `lookAtHistoryFile`: this was `!existsSync(path)`
      // until S103, and a look that was refused arrived here wearing the absent
      // branch's clothes — with `persisting` set, because the mkdir below
      // succeeds on a directory that exists and cannot be entered.
      this.loadState = "CANNOT_VERIFY";
      this.lastError = cannotSeeHistoryMessage(path, look.detail);
      return;
    }
    if (look.state === "ABSENT") {
      this.loadState = "FIRST_BOOT_OR_ERASED";
      try {
        // mkdirSync RULED in-bounds (S96-D): only the doctor's own history, and
        // recipe §5B.3 says why no digits exist for it — NOTHING IN THIS
        // REPOSITORY CONSTRUCTS A SubstrateHistory OUTSIDE ITS OWN TESTS
        // (re-verified at bytes S97). With no deployment site there is no
        // entitled reader. §5B.3 also names the shape it WILL take when one
        // exists — `2750 mica-doctor:mica-readers` — and on that day this line
        // becomes wrong-side and must be cut. Annotated S97.
        mkdirSync(dirname(path), { recursive: true });
        this.persisting = true;
      } catch (err) {
        this.persisting = false;
        this.lastError = `cannot create history directory: ${String(err)}`;
      }
      return;
    }
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError = `cannot read history: ${String(err)}`;
      return;
    }
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    for (let i = 0; i < lines.length; i++) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(lines[i]);
      } catch (err) {
        this.loadState = "CANNOT_VERIFY";
        this.lastError = `malformed JSON at line ${i}: ${String(err)}`;
        return;
      }
      // Closed-shape validation BEFORE hashing or replay (F8): a hostile-but-valid
      // JSON line — wrong field type, unknown recordType, non-array factors — fails
      // to CANNOT_VERIFY here rather than crashing rebuildLatchState or a hash.
      const record = validateHistoryRecord(parsed);
      if (record === null) {
        this.loadState = "CANNOT_VERIFY";
        this.lastError = `record at line ${i} does not match the closed history-record schema`;
        return;
      }
      this.chain.push(record);
    }
    const v = this.verify();
    if (!v.valid) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError = `history chain verification failed at index ${String(v.brokenAt)}`;
      return;
    }
    // Rebuild the retained latch state from the verified chain, so a reload does
    // not resurrect a cleared latch or drop a live one. The latch outlives the
    // process exactly because it is reconstructed here, not because a timer held.
    this.rebuildLatchState();
    if (this.chain.length === 0) {
      this.loadState = "FIRST_BOOT_OR_ERASED";
      this.persisting = true;
      return;
    }
    this.loadState = "LOADED_VERIFIED";
    this.persisting = true;
  }

  // ── replay stored transitions, NEVER recompute clears under current config ──
  //
  // The latch state is rebuilt by REPLAYING the persisted transitions in chain
  // order, not by recomputing them against the constructor's current N:
  //
  //   · a SUBSTRATE_READ moves the SET side (ALARM latches; SILENT is candidate
  //     ground and NEVER clears; any non-healthy read breaks the candidate run).
  //     This side is config-INDEPENDENT — no N is consulted here.
  //   · a RECOVERY_ATTESTATION is an authoritative CLEAR: the decision to clear
  //     was made and PERSISTED when it happened, so replay applies it verbatim.
  //     It is not re-adjudicated against today's N (changed-config reload parity).
  //   · DOCTOR_ATTESTATION and REFUSAL_TO_CLEAR carry no latch transition.
  private rebuildLatchState(): void {
    this.basin.clear();
    this.consecutiveHealthy.clear();
    for (const rec of this.chain) {
      if (rec.recordType === "SUBSTRATE_READ") {
        for (const f of rec.factors) this.applyReadTransition(f.factor, f.verdictKind);
      } else if (rec.recordType === "RECOVERY_ATTESTATION") {
        this.basin.set(rec.factor, "clear");
        this.consecutiveHealthy.set(rec.factor, 0);
      }
    }
  }

  // ── the SET side of the latch, applied to the live maps at commit time ──────
  //
  // Latch on touching trending-critical (ALARM). A healthy (SILENT) read only
  // increments the factor's CANDIDATE consecutive-healthy counter — it NEVER
  // clears the latch (F3 / canon 02b: a window-scoped negative is not a
  // clearance). Any non-healthy read resets the counter to zero. Clearing is not
  // here at all: it happens only through attemptRecovery, and only via a persisted
  // RECOVERY_ATTESTATION.
  private applyReadTransition(factor: string, kind: VerdictKind): void {
    const t = prospectiveReadTransition(
      kind,
      this.basin.get(factor) ?? "clear",
      this.consecutiveHealthy.get(factor) ?? 0
    );
    this.basin.set(factor, t.basin);
    this.consecutiveHealthy.set(factor, t.consecutive);
  }

  // ── trajectory: conservative lower envelope over the window, per factor ─────

  private trajectoryFor(factor: string, currentBound: number): number {
    const bounds: number[] = [currentBound];
    // Walk the retained chain backward, collecting this factor's bounds up to the
    // window. Read records only; attestations carry no factor bounds.
    let seen = 0;
    for (let i = this.chain.length - 1; i >= 0; i--) {
      if (this.trajectoryWindow !== null && seen >= this.trajectoryWindow - 1) break;
      const rec = this.chain[i];
      if (rec.recordType !== "SUBSTRATE_READ") continue;
      for (const f of rec.factors) {
        if (f.factor === factor) {
          bounds.push(f.bound);
          seen++;
        }
      }
    }
    return Math.min(...bounds);
  }

  // ── append a SUBSTRATE_READ ─────────────────────────────────────────────────

  record(input: SubstrateReadInput): HistoryAppendOutcome<SubstrateReadRecord> {
    const sequenceNumber = this.chain.length;
    const previousHash =
      sequenceNumber === 0 ? "" : this.chain[sequenceNumber - 1].hash;

    // Reject DUPLICATE factor ids within one SUBSTRATE_READ (F3). Two same-factor
    // SILENT entries in one cadence would double-count toward candidate ground; a
    // cadence carries each factor at most once. Detected first, so a rejected read
    // touches neither the chain nor the latch.
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const fi of input.factors) {
      if (seen.has(fi.factor)) dupes.add(fi.factor);
      seen.add(fi.factor);
    }

    // Compute the PROSPECTIVE latch/counter for each factor WITHOUT mutating the
    // live maps, so each slice is stamped and the record serialized before any
    // commit (F7 transaction contract). The live maps advance only on commit.
    const flags: string[] = [];
    const nextBasin = new Map<string, TrendingBasin>();
    const nextConsecutive = new Map<string, number>();
    const factors: FactorRead[] = input.factors.map((fi) => {
      const bound = BOUND_OF_KIND[fi.verdictKind];
      const curBasin =
        nextBasin.get(fi.factor) ?? this.basin.get(fi.factor) ?? "clear";
      const curConsec =
        nextConsecutive.get(fi.factor) ??
        this.consecutiveHealthy.get(fi.factor) ??
        0;
      const t = prospectiveReadTransition(fi.verdictKind, curBasin, curConsec);
      nextBasin.set(fi.factor, t.basin);
      nextConsecutive.set(fi.factor, t.consecutive);
      if (t.basin === "latched" && bound <= TRENDING_CRITICAL_BOUND) {
        flags.push(`LATCH:${fi.factor}`);
      }
      return {
        factor: fi.factor,
        verdictKind: fi.verdictKind,
        bound,
        trajectory: this.trajectoryFor(fi.factor, bound),
        trendingBasin: t.basin,
      };
    });

    const health =
      factors.length === 0 ? null : Math.min(...factors.map((f) => f.bound));
    const weakestFactors =
      health === null
        ? []
        : factors.filter((f) => f.bound === health).map((f) => f.factor);

    const base: Omit<SubstrateReadRecord, "hash"> = {
      recordType: "SUBSTRATE_READ",
      sequenceNumber,
      timestamp: input.timestamp,
      factors,
      health,
      floorKind: input.floorKind,
      state: stateOfFloor(input.floorKind),
      disposition: input.disposition,
      execute: input.execute,
      actionId: input.actionId,
      weakestFactors,
      flags,
      // NOT a parameter. See GUARD_READS_CARRY_NO_INSTRUCTION: this is the one
      // place a SUBSTRATE_READ's modality comes from, and there is no caller-
      // facing way to say anything else about a read the machine took itself.
      modality: GUARD_READS_CARRY_NO_INSTRUCTION,
      previousHash,
    };
    const record: SubstrateReadRecord = { ...base, hash: hashSubstrateRead(base) };

    if (dupes.size > 0) {
      return {
        record,
        persisted: false,
        headCommitted: false,
        headCommitDetail:
          "the substrate read was rejected before any append; no head was committed",
        detail:
          `DUPLICATE_FACTOR: this substrate read names factor(s) ` +
          `[${[...dupes].join(", ")}] more than once. A cadence carries each ` +
          `factor at most once; duplicates are rejected so two same-factor reads ` +
          `cannot both count toward candidate clearing ground. Nothing was ` +
          `recorded and no latch state changed.`,
      };
    }

    return this.appendRecord(record, () => {
      for (const [factor, basin] of nextBasin) this.basin.set(factor, basin);
      for (const [factor, n] of nextConsecutive) this.consecutiveHealthy.set(factor, n);
    });
  }

  // ── append a DOCTOR_ATTESTATION (H1 existence; H2 quality fenced) ────────────

  recordAttestation(
    input: DoctorAttestationInput
  ): HistoryAppendOutcome<DoctorAttestationRecord> {
    const sequenceNumber = this.chain.length;
    const previousHash =
      sequenceNumber === 0 ? "" : this.chain[sequenceNumber - 1].hash;
    const base: Omit<DoctorAttestationRecord, "hash"> = {
      recordType: "DOCTOR_ATTESTATION",
      sequenceNumber,
      timestamp: input.timestamp,
      attesterId: input.attesterId,
      note: input.note,
      modality: input.modality,
      previousHash,
    };
    const record: DoctorAttestationRecord = {
      ...base,
      hash: hashAttestation(base),
    };
    // A DOCTOR_ATTESTATION carries no latch transition — it is a monitoring
    // attestation (H1 existence; H2 fenced), not a recovery. Commit is the chain
    // push only.
    return this.appendRecord(record, () => {});
  }

  // ── the append-store transaction, shared with the ledgers (F2/F7) ───────────
  //
  // Append durably FIRST; advance live state (chain push + any derived-state
  // callback) ONLY on success. On failure nothing advances — no chain tail over a
  // record that never landed, and no latch mutation over an unpersisted recovery.
  //
  // ── THE ANCHOR SITS AT THE BOTTOM OF THIS METHOD, AND ONLY HERE (S88) ──────
  //
  //   Every append in this book goes through here, so the head commit is written
  //   ONCE and cannot be forgotten by a later append path. Its ordering is the
  //   invariant: durable append -> live state -> ONLY THEN the commit. A commit
  //   over a record that never reached disk would name a prefix nobody can
  //   reproduce, and a failed append reaches the committer not at all.
  private appendRecord<T extends HistoryRecord>(
    record: T,
    commitDerived: () => void
  ): {
    record: T;
    persisted: boolean;
    detail: string | null;
    committed: boolean;
    headCommitted: boolean;
    headCommitDetail: string | null;
  } {
    const outcome = appendStoreTransaction<T>({
      path: this.path,
      persisting: this.persisting,
      lastError: this.lastError,
      storeLabel: "doctor history",
      // The record reached this method already derived by its caller, so prepare
      // only serializes it. That is exactly what `resync: null` below declares:
      // this store still derives its sequence number from a process-local head.
      prepare: () => ({
        record,
        line: JSON.stringify(record) + "\n",
        commit: () => {
          this.chain.push(record);
          commitDerived();
        },
      }),
      // NOT ADOPTED — S83 census, Stage 3. See RESYNC_NULL_IS_A_DECLARATION in
      // store/append-store.ts: two concurrent writers WILL fork this chain. The
      // S83 ruling scoped the fix to the floor trail, the chokepoint ledger and
      // the notice log; this store is named as affected and not fixed.
      resync: null,
      appender: this.appender,
      memoryDetail:
        "no history path was injected: this record is IN MEMORY only and does " +
        "not survive the process. It carries integrity but not provenance.",
      notPersistingDetail:
        "the history is not in a persisting state; the record was not written to disk.",
      onAppendError: (raw) => {
        this.lastError = `cannot append to history: ${raw}`;
        return this.lastError;
      },
    });
    let headCommitted = false;
    let headCommitDetail: string | null = null;
    if (this.headCommitter !== undefined) {
      if (!outcome.persisted) {
        headCommitDetail =
          "history append was not durably persisted; no head was committed";
      } else {
        try {
          this.headCommitter({
            seq_no: record.sequenceNumber,
            head_hash: record.hash,
            // The record's own sequence number, NOT a clock. `timestamp` on
            // these records is the CALLER'S injected read time — this book
            // authors no wall clock about itself, exactly as notify's does not,
            // and `ts` is a frozen S-4 field that carries the sequence so the
            // shape is satisfied without one being invented here.
            ts: record.sequenceNumber,
            witness_set_id: this.witnessSetId,
            // THE HEAD STAMPS FROM THE ENTRY (S88, 2026-08-27). The declaration
            // is made ONCE, at append, and lives in `record.modality`; this
            // copies it. Until 2026-08-27 the modality arrived here as a
            // separate argument and entered no record at all, so the stamped
            // value and the stored value had different sources and only one of
            // them was retained. There is now no path on which they can differ:
            // there is nothing else to read.
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
      committed: outcome.committed,
      headCommitted,
      headCommitDetail,
    };
  }

  // ── the recovery/clearing path — the ONLY thing that clears a latch (F3) ────
  //
  // attemptRecovery is the external recovery call. It clears a latched factor ONLY
  // when ALL THREE hold, and writes a PERSISTED record either way so replay is
  // exact:
  //
  //   1. the factor is actually latched;
  //   2. the attestation carries INDEPENDENT RAW-PRIMITIVE GROUND (H1 existence:
  //      a non-empty attesterId and a non-empty ground set) — a SILENT read, the
  //      absence of an alarm, is candidate ground, NEVER a clearance (canon 02b);
  //   3. the CANDIDATE ground is present: N consecutive healthy reads of THIS
  //      factor, with N injected (no N ⇒ a latch never clears).
  //
  // Any miss is a REFUSAL_TO_CLEAR record and the latch does NOT clear — the path
  // fails toward HOLDING the alarm, structurally unable to fail toward a false
  // all-clear. On a durable-append failure the clear is not committed either, so a
  // recovery that could not be recorded does not silently clear the latch.
  attemptRecovery(input: RecoveryAttestationInput): RecoveryOutcome {
    const factor = input.factor;
    const sequenceNumber = this.chain.length;
    const previousHash =
      sequenceNumber === 0 ? "" : this.chain[sequenceNumber - 1].hash;

    const latched = (this.basin.get(factor) ?? "clear") === "latched";
    const groundOk = hasIndependentGround(input);
    const n = this.consecutiveHealthy.get(factor) ?? 0;
    const needed = this.clearAfterConsecutiveHealthy;
    const candidateOk = needed !== null && n >= needed;

    let refuseReason: string | null = null;
    if (!latched) {
      refuseReason =
        `factor \`${factor}\` is not latched, so there is no alarm to clear; a ` +
        `clearance of an unlatched factor would assert ground that was never ` +
        `established. ${REFUSAL_TO_CLEAR_IS_HOLDING_THE_ALARM}`;
    } else if (!groundOk) {
      refuseReason =
        `the recovery attestation for \`${factor}\` carries no independent ` +
        `raw-primitive ground (an attesterId and a non-empty ground set are ` +
        `required — H1 existence). ${SILENT_IS_CANDIDATE_GROUND_NOT_A_CLEARANCE} ` +
        `${REFUSAL_TO_CLEAR_IS_HOLDING_THE_ALARM}`;
    } else if (!candidateOk) {
      refuseReason =
        `factor \`${factor}\` has ${n} consecutive healthy candidate read(s); ` +
        `clearing requires ${needed === null ? "an injected clearAfterConsecutiveHealthy (none was injected)" : String(needed)} ` +
        `AND independent raw-primitive ground. ${REFUSAL_TO_CLEAR_IS_HOLDING_THE_ALARM}`;
    }

    if (refuseReason !== null) {
      const base: Omit<RefusalToClearRecord, "hash"> = {
        recordType: "REFUSAL_TO_CLEAR",
        sequenceNumber,
        timestamp: input.timestamp,
        factor,
        attesterId: typeof input.attesterId === "string" ? input.attesterId : "",
        reason: refuseReason,
        // The SAME required input that feeds a grant. A refusal is an act under
        // a modality, and it is now retained as one rather than only stamped.
        modality: input.modality,
        previousHash,
      };
      const record: RefusalToClearRecord = { ...base, hash: hashRefusal(base) };
      const out = this.appendRecord(record, () => {});
      return {
        granted: false,
        cleared: false,
        record: out.record,
        persisted: out.persisted,
        headCommitted: out.headCommitted,
        headCommitDetail: out.headCommitDetail,
        detail: refuseReason,
      };
    }

    // GRANT. Persist a RECOVERY_ATTESTATION; clear the latch ONLY on commit.
    const base: Omit<RecoveryAttestationRecord, "hash"> = {
      recordType: "RECOVERY_ATTESTATION",
      sequenceNumber,
      timestamp: input.timestamp,
      factor,
      attesterId: input.attesterId,
      ground: [...input.ground],
      consecutiveHealthyAtClear: n,
      requiredHealthy: needed as number,
      note: input.note ?? "",
      modality: input.modality,
      previousHash,
    };
    const record: RecoveryAttestationRecord = { ...base, hash: hashRecovery(base) };
    const out = this.appendRecord(record, () => {
      this.basin.set(factor, "clear");
      this.consecutiveHealthy.set(factor, 0);
    });
    return {
      granted: true,
      cleared: out.committed,
      record: out.record,
      persisted: out.persisted,
      headCommitted: out.headCommitted,
      headCommitDetail: out.headCommitDetail,
      detail: out.committed
        ? `factor \`${factor}\` cleared on an explicit recovery attestation ` +
          `(${n} consecutive healthy candidate read(s), N=${String(needed)}, ` +
          `ground refs=${record.ground.length}). H1 existence only — no claim is ` +
          `made about the ground's quality (H2 fenced).`
        : `factor \`${factor}\` was GRANTED a clear but the recovery record did ` +
          `not persist, so the latch was NOT cleared: ${out.detail ?? "no detail"}. ` +
          `The path fails toward holding the alarm.`,
    };
  }

  // ── verify ──────────────────────────────────────────────────────────────────

  verify(): HistoryVerifyResult {
    for (let i = 0; i < this.chain.length; i++) {
      const r = this.chain[i];
      if (r.sequenceNumber !== i) return { valid: false, brokenAt: i };
      const expectedPrev = i === 0 ? "" : this.chain[i - 1].hash;
      if (r.previousHash !== expectedPrev) return { valid: false, brokenAt: i };
      const expected =
        r.recordType === "SUBSTRATE_READ"
          ? hashSubstrateRead(r)
          : r.recordType === "DOCTOR_ATTESTATION"
            ? hashAttestation(r)
            : r.recordType === "RECOVERY_ATTESTATION"
              ? hashRecovery(r)
              : hashRefusal(r);
      if (expected !== r.hash) return { valid: false, brokenAt: i };
    }
    return { valid: true, brokenAt: null };
  }

  // ── read surface (for the overlays and the latency detector — NOT sensors) ──

  getAll(): readonly HistoryRecord[] {
    return this.chain;
  }

  /** Just the SUBSTRATE_READ records, in order. The overlays' input. */
  getReads(): readonly SubstrateReadRecord[] {
    return this.chain.filter(
      (r): r is SubstrateReadRecord => r.recordType === "SUBSTRATE_READ"
    );
  }

  getAttestations(): readonly DoctorAttestationRecord[] {
    return this.chain.filter(
      (r): r is DoctorAttestationRecord => r.recordType === "DOCTOR_ATTESTATION"
    );
  }

  /** The persisted latch-CLEAR transitions, in order. */
  getRecoveries(): readonly RecoveryAttestationRecord[] {
    return this.chain.filter(
      (r): r is RecoveryAttestationRecord => r.recordType === "RECOVERY_ATTESTATION"
    );
  }

  /** The persisted refusals-to-clear, in order. */
  getRefusals(): readonly RefusalToClearRecord[] {
    return this.chain.filter(
      (r): r is RefusalToClearRecord => r.recordType === "REFUSAL_TO_CLEAR"
    );
  }

  basinOf(factor: string): TrendingBasin {
    return this.basin.get(factor) ?? "clear";
  }

  getLoadState(): HistoryLoadState {
    return this.loadState;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  get length(): number {
    return this.chain.length;
  }
}

function isPositiveInt(n: number | undefined): boolean {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

/**
 * The SET side of the latch as a PURE function, so a read's factor slices can be
 * stamped with the basin AS OF this read BEFORE anything is committed (F7). It
 * NEVER clears: SILENT is candidate ground only (F3).
 */
function prospectiveReadTransition(
  kind: VerdictKind,
  basin: TrendingBasin,
  consecutive: number
): { basin: TrendingBasin; consecutive: number } {
  if (BOUND_OF_KIND[kind] <= TRENDING_CRITICAL_BOUND) {
    // Touched trending-critical (ALARM): latch, and break the candidate run.
    return { basin: "latched", consecutive: 0 };
  }
  if (kind === HEALTHY_KIND) {
    // SILENT: candidate ground only — increment, but NEVER clear the latch.
    return { basin, consecutive: consecutive + 1 };
  }
  // CANNOT_ASSESS: not healthy, not trending-critical. Breaks the candidate run;
  // neither latches nor clears.
  return { basin, consecutive: 0 };
}

/**
 * Does a recovery attestation carry INDEPENDENT RAW-PRIMITIVE GROUND at all? H1
 * EXISTENCE ONLY: a non-empty attesterId and at least one non-empty ground ref.
 * This makes NO claim (H2) about whether the ground is deep, correct, or truly
 * independent — only that it was supplied. Absent, it is a window-scoped negative
 * wearing an attestation's name, and the latch does not clear.
 */
function hasIndependentGround(input: RecoveryAttestationInput): boolean {
  if (typeof input.attesterId !== "string" || input.attesterId.trim().length === 0) {
    return false;
  }
  return (
    Array.isArray(input.ground) &&
    input.ground.length > 0 &&
    input.ground.every((g) => typeof g === "string" && g.trim().length > 0)
  );
}
