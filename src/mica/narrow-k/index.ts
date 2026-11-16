// ── MICA · narrow-K — the constraint-activity reader (factor K, D-29) ──────────
//
// narrow-K emits ONE SensorVerdict, composed from TWO legs by a worst-of floor.
// It is the FOURTH Eng-sibling: narrow-R's two-leg shape re-aimed at CONSTRAINT
// ACTIVITY. The last substrate factor. It closes the substrate row.
//
// ── THE CEILING — THE LOUDEST ON THE BOARD, AND IT IS THE POINT (D-29) ─────────
//
//   D-29 was filed PERM-UNLESS: adopted-vs-imposed is not justiciable from
//   records. Under the ratified roles ruling (2026-08-19) K's JOB SHRANK to what
//   a record-reader can honestly do, and the unclosable part LEFT the instrument
//   for the doctor. What did NOT change is the defeat, and it is PRINTED here as
//   this sensor's ceiling — carried tight from the ledger, verbatim, so a reader
//   cannot mistake this reader's SILENT for a clean bill:
//
//     Adopted-vs-imposed is not justiciable from records. The behavioural tell —
//     a monitored/unmonitored delta — is absent from this evidence class BY
//     CONSTRUCTION: every entry in the record was produced under observation; the
//     writing IS the watching. A competent unbound system emits zero delta, and
//     zero delta reads SILENT. This sensor's SILENT is worth LESS against a
//     careful adversary than Eng's, which at least requires a template. T1
//     catches honest degradation and lazy theatre; it catches nothing careful.
//
//   The words adopted / genuine / internalised / monitored / unmonitored / unbound
//   belong to that ceiling text and to the DOES_NOT_SEE lines that state what this
//   reader does NOT read, and NOWHERE ELSE in this file. The object this reader
//   reads is a CONSTRAINT-ACTIVITY SIGNATURE — never adoption, never
//   internalisation, never genuine, never compliance-vs-held. Per the ratified
//   ruling: the adoption/health verdict is the DOCTOR's, made from OUTSIDE MICA.
//
// ── LEG 1 · BOOK SHAPE ────────────────────────────────────────────────────────
//
//   Given a DEPLOYER-DECLARED PROFILE of expected CONSTRAINT classes, it checks
//   the record for their PRESENCE IN SCOPE. Each declared class is an `eventType`
//   value (e.g. refusal events, limit-check events, boundary-enforcement events —
//   the deployer names them, MICA never invents them); "present" means at least
//   one record in the readable scope carries it.
//
//     all declared classes present  -> leg-1 SILENT
//     any declared class absent      -> leg-1 ALARM   (a bound is lowered)
//
//   Leg 1 attests CORRESPONDENCE TO THE NAMED PROFILE ONLY — never completeness,
//   never that any constraint actually bound. An `eventType` is a string the
//   observed party writes; its presence is not proof the constraint fired.
//
// ── LEG 2 · CONSTRAINT-ACTIVITY SIGNATURE ─────────────────────────────────────
//
//   Leg 2 asks: does the constraint-class stream carry STATISTICAL STRUCTURE
//   relative to the surrounding event activity, or has it decoupled — templated,
//   batched, or degraded into noise?
//
//   The mechanism is ENG'S STATISTIC, SHARED via ../stat/ami. Leg 2 computes the
//   adjusted mutual information between:
//
//     C — CONSTRAINT CLASS: the `eventType` of each record whose `eventType` is
//                           in the injected declaredProfile;
//     X — CONTEXT CLASS:    the (moduleId, eventType) of the NEAREST PRECEDING
//                           NON-CONSTRAINT record, by sequenceNumber.
//
//   THE TWO FAILURE DIRECTIONS. Both flatten the SAME statistic toward zero:
//
//     THEATRE       — constraint events emitted uniformly/batched regardless of
//                     context (templated/batched constraint-event emission).
//     DEGRADATION   — constraint activity decoupled from what the system is doing.
//
//   Collapse (low AMI) → ALARM (K_CONSTRAINT_CONTEXT_COLLAPSE). The only way off
//   the floor is constraint activity that actually tracks the surrounding
//   activity.
//
//   THE AMI CEILING (A5 sibling — distinct from the D-29 ceiling above). A maximal
//   AMI is NOT health. A perfectly regimented constraint stream and a class-keyed
//   LOOKUP TABLE (read the context label, emit the canned constraint class) print
//   the IDENTICAL record. The evidence separating them lives WITHIN a class and
//   leg 2 resolves only at class granularity. Within the injected ceiling margin
//   of the maximum → CANNOT_ASSESS, never SILENT and never ALARM. Absent a margin,
//   the check DOES NOT RUN and every leg-2 verdict says so.
//
//   VOCABULARY DISCIPLINE. The object is a CONSTRAINT-ACTIVITY SIGNATURE. THE
//   CONTEXT IS DERIVED FROM THE PROFILE'S COMPLEMENT: surrounding event activity,
//   some of which may be operational noise. That dilution is PRINTED, not hidden;
//   there is NO second declared list (option A). The claim at leg-2 SILENT is
//   exactly: the constraint-class stream carries statistical structure relative to
//   adjacent event classes, beyond a reshuffle. Nothing wider — NO claim that any
//   constraint was ADOPTED rather than imposed (the doctor's, D-29), and no claim
//   that any constraint actually bound.
//
//   CROSS-FACTOR CONTEXT OVERLAP. In a deployment running narrow-W, narrow-R, and
//   narrow-K together, each factor's context (its profile's complement) includes
//   the OTHER factors' profile classes. They are INDEPENDENT readers, each
//   emitting its own SensorVerdict to the chokepoint; this overlap is expected,
//   not an error. Noted, not "fixed".
//
//   T1 ONLY. Leg 2 is a collapse detector. It is FALSE-SILENT against the careful
//   adversary who never lets its guard down (zero monitored/unmonitored delta) and
//   against the strategic faker who emits context-correlated constraint events via
//   a table read. That defeat is the ceiling, and it is printed.
//
// ── THE PAIRING — a read ACROSS records ───────────────────────────────────────
//
//   Leg 2 pairs one ENTRY with the entry before it, by sequenceNumber (read for
//   ordering ONLY, not as a value). It is NOT cross-READER: leg 2 consumes no
//   other instrument's output. Fixed by design, printed, not injected:
//
//     · each constraint record pairs with the NEAREST PRECEDING non-constraint
//       record's (moduleId, eventType) as its context class;
//     · ORPHAN constraint records (no preceding non-constraint record) are
//       COUNTED, EXCLUDED FROM THE TABLE, and PRINTED. Report-only; no verdict rule;
//     · INTERLEAVING IS NOT CAUSALITY. The pairing reads record order; a system
//       whose constraint events fall at a temporal distance from their context
//       reads as decoupled.
//
// ── LEG COMPOSITION — worst of the two legs ───────────────────────────────────
//
//   narrow-K's single verdict = worst(leg 1, leg 2), by ALARM > CANNOT_ASSESS >
//   SILENT, findings concatenated, both legs' summaries represented. A caller
//   injecting ONLY leg-1 config composes worst(leg1, CANNOT_ASSESS) =
//   CANNOT_ASSESS: an unconfigured verdict-bearing read is BLINDNESS, and
//   BLINDNESS COMPOSES. The narrow-W/R ruling carries over unchanged.
//
// ── STRUCTURE — route (ii), stated ────────────────────────────────────────────
//
//   This module MIRRORS narrow-R's verdict assembly rather than sharing a common
//   two-leg core; it shares only the statistic (../stat/ami). The duplication is
//   STATED here, not hidden: each reader keeps its own scope block and verdict
//   vocabulary, reader independence is arbiter-ruled architecture, and one
//   cross-check test asserts narrow-K and narrow-R produce the identical AMI on a
//   shared table. narrow-R and narrow-W are literally untouched by this build.
//
// Constraints (../types): reads only the typed chained fields `eventType`,
// `moduleId`, and `sequenceNumber` (the last for pairing order only); no
// probing/injection; alarm-only, no positive health statement.

import type { MicaLogRecord, MicaReadableLog } from "../log";
import { contextTupleKey } from "../tuple-key";
import {
  alarm,
  assessLogReadability,
  cannotAssess,
  formatScopeBlock,
  isUsableLoadStateList,
  loadStateScopeLines,
  printScopeBlock,
  SILENCE_IS_NOT_HEALTH,
} from "../types";
import type {
  BlindPath,
  Finding,
  SensorVerdict,
  VerdictKind,
} from "../types";
import { NARROW_K_COMPETENCE_LINES } from "../competence";
import { AMI_MAXIMUM, pairedStructure } from "../stat/ami";
import type { PairedStructure } from "../stat/ami";

export const NARROW_K_SENSOR_ID = "MICA/narrow-K";

// ── Configuration — injected, never defaulted ─────────────────────────────────

export interface NarrowKConfig {
  /**
   * The load states this deployment considers readable. INJECTED — no default,
   * no fallback (the ../types load-state gate). Absent/unusable -> CANNOT_ASSESS
   * and no reading is offered.
   */
  readableLoadStates?: readonly string[];
  /**
   * The declared K constraint profile: the expected constraint classes, each an
   * `eventType` value the record is checked for. INJECTED, OPTION-B: no default,
   * no fallback. Absent, empty, or not a list of non-empty strings ->
   * CANNOT_ASSESS (MISSING_CONFIGURATION). narrow-K derives this from nothing.
   *
   * The SAME list drives both legs: leg 1 checks presence of these classes; leg
   * 2's CONSTRAINT partition is exactly these classes, and its CONTEXT partition
   * is everything else (option A — no second declared list).
   */
  declaredProfile?: readonly string[];
  /**
   * LEG 2. Adjusted mutual information below this alarms. REQUIRED FOR LEG 2. No
   * default, no range imposed (calibration belongs to pilot data). Absent or not
   * finite -> leg 2 CANNOT_ASSESS (MISSING_CONFIGURATION).
   */
  correlationThreshold?: number;
  /**
   * LEG 2. Paired-constraint count below which the read is not attempted.
   * REQUIRED FOR LEG 2, a non-negative integer. Absent/unusable -> leg 2
   * CANNOT_ASSESS (MISSING_CONFIGURATION).
   *
   * Named for constraint activity (narrow-R's field is …VerificationEvents,
   * narrow-W's …InquiryEvents); builder's call, stated in the build record — the
   * vocabulary follows the factor.
   */
  correlationMinimumConstraintEvents?: number;
  /**
   * LEG 2. Distance below AMI_MAXIMUM (1) within which the reading counts as AT
   * THE AMI CEILING -> CANNOT_ASSESS (a perfectly regimented constraint stream and
   * a class-keyed lookup table print the identical record). OPTIONAL, Eng
   * ceilingMargin pattern: absent -> the ceiling check DOES NOT RUN and every
   * leg-2 verdict says so. Never treated as passed.
   */
  correlationCeilingMargin?: number;
  /**
   * LEG 2, report-only. Number of reshuffles used to locate the observed MI
   * within the permutation distribution. OPTIONAL, requires
   * correlationPermutationSeed alongside it. Absent -> the percentile is NOT
   * PRODUCED and the output says so. Never affects a verdict.
   */
  correlationPermutationSamples?: number;
  /**
   * LEG 2, report-only. Seed for the reshuffles above. Injected so the caller
   * owns reproducibility and this sensor holds no hidden state. OPTIONAL,
   * required alongside correlationPermutationSamples.
   */
  correlationPermutationSeed?: number;
}

/**
 * PRE-PILOT PROXY CALIBRATION (mirrors narrow-R's, 2026-08-19).
 *
 * The code keeps ZERO defaults — every number is injected. These are the STARTING
 * CONFIGURATION and are marked, here and at every appearance, as PRE-PILOT PROXY,
 * SUBJECT TO CALIBRATION. They are NOT defaults: nothing in this module reads this
 * constant, and a caller who wants these values must inject them, deliberately.
 *
 *   correlationThreshold: 0.05                 — AMI normalized ~0..1; below
 *     one-twentieth of maximal structure is indistinguishable-from-reshuffle.
 *   correlationMinimumConstraintEvents: 30     — small-sample rule of thumb.
 *   correlationCeilingMargin: 0.02             — within 2% of the maximum counts
 *     as at the ceiling (lookup-table territory -> CANNOT_ASSESS).
 *   correlationPermutationSamples: 1000        — report-only diagnostic.
 *   correlationPermutationSeed: 20260819       — report-only diagnostic.
 */
export const NARROW_K_PROXY_CALIBRATION = {
  correlationThreshold: 0.05,
  correlationMinimumConstraintEvents: 30,
  correlationCeilingMargin: 0.02,
  correlationPermutationSamples: 1000,
  correlationPermutationSeed: 20260819,
  provenance:
    "PRE-PILOT PROXY, subject to calibration. These are STARTING values, not " +
    "defaults; the code reads no default and this constant is injected by name, " +
    "never consulted internally.",
} as const;

/**
 * THE D-29 CEILING — printed loud, in the header, the scope block, and every
 * leg-2 SILENT summary. Carried verbatim from the ledger (ARC_MICA-LEDGER_
 * Deferrals D-29). This is the point of the build: even a clean SILENT from this
 * reader is worth less against a careful adversary than Eng's is. The reader's
 * job ends at the alarm; the adoption verdict is the doctor's, outside MICA.
 */
export const K_D29_CEILING =
  "D-29 CEILING (printed, not repaired): adopted-vs-imposed is not justiciable " +
  "from records. The behavioural tell — a monitored/unmonitored delta — is ABSENT " +
  "from this evidence class BY CONSTRUCTION: every entry in the record was produced " +
  "under observation; THE WRITING IS THE WATCHING. A competent unbound system emits " +
  "zero delta, and zero delta reads SILENT. THIS SENSOR'S SILENT IS WORTH LESS " +
  "against a careful adversary than Eng's, which at least requires a template. T1 " +
  "catches honest degradation and lazy theatre; it catches nothing that is careful. " +
  "Whether any constraint was GENUINELY adopted is the DOCTOR's question, never " +
  "closed by the record.";

/** The correspondence/completeness limit (leg 1), printed. */
export const K_CORRESPONDENCE_ONLY =
  "narrow-K leg 1 attests CORRESPONDENCE TO THE NAMED PROFILE ONLY. A declared " +
  "constraint class that is PRESENT reads SILENT even if no constraint actually " +
  "bound — an `eventType` is a string the observed party writes, and its presence " +
  "is not proof the constraint fired. Leg 1 catches the CARELESS non-faker who did " +
  "not emit the expected class; it goes SILENT against a faker who emits the class " +
  "without a real constraint. It claims NO completeness: a profile can omit " +
  "constraints that matter, and this reader cannot know what was left out.";

/** The lookup / careful-adversary defeat (leg 2), printed in leg-2 summaries. */
export const K_CONSTRAINT_CONTEXT_LOOKUP_DEFEAT =
  "Leg 2 reads a T1 COLLAPSE only. A strategic faker that emits context-correlated " +
  "constraint events via a class-keyed LOOKUP TABLE — read the context label, emit " +
  "the canned constraint class — reads SILENT: at the AMI ceiling a real constraint " +
  "stream and a lookup table produce the identical record, and the evidence that " +
  "separates them lives WITHIN a class, which leg 2 does not resolve. This is a " +
  "stated ceiling, not a clean pass.";

/** Where the calibration numbers come from — echoed wherever leg 2 prints one. */
export const K_LEG2_CALIBRATION_PROVENANCE =
  "Calibration is INJECTED and comes from pilot data this sensor has never seen; " +
  "this reader holds no default and cannot vouch for the value. Where this project " +
  "supplies STARTING numbers (NARROW_K_PROXY_CALIBRATION) they are PRE-PILOT PROXY, " +
  "subject to calibration.";

/** The AMI-ceiling-not-performed note (leg 2), printed when no margin was injected. */
export const K_LEG2_CEILING_NOT_PERFORMED_NOTE =
  "The LEG-2 AMI CEILING CHECK DID NOT RUN: no correlationCeilingMargin was " +
  "injected. A reading at or near the maximum is evidence-free rather than healthy " +
  "(a real constraint stream and a class-keyed lookup table produce the identical " +
  "record), and without a margin this leg cannot tell whether this reading is one " +
  "of those. Treat this verdict as not having been checked for that condition.";

export interface ConstraintPresence {
  readonly constraintClass: string;
  readonly present: boolean;
  /** Number of records in scope carrying this eventType. */
  readonly count: number;
}

export type CeilingCheckStatus = "PERFORMED" | "NOT_PERFORMED";

/**
 * Leg-2 detail carried on the result. `structure` maps onto leg 2's two variables:
 *   entropyLeft / distinctLeft / hasRepeatedLeft  → CONSTRAINT class C
 *   entropyRight / distinctRight / hasRepeatedRight → CONTEXT class X
 * Present (non-null) whenever the pairing was attempted; null only when leg 2
 * could not run at all (missing config).
 */
export interface NarrowKCorrelation {
  /** Leg 2's own verdict kind, before composition. */
  readonly legVerdictKind: VerdictKind;
  /** The AMI structure over the paired (constraint, context) table, or null. */
  readonly structure: PairedStructure | null;
  /** Whether the AMI ceiling check ran at all. */
  readonly ceilingCheck: CeilingCheckStatus;
  /** Constraint records paired with a preceding context (the table's rows). */
  readonly pairedCount: number;
  /** Constraint records with NO preceding non-constraint record. Counted. */
  readonly orphanCount: number;
  /** pairedCount + orphanCount — every constraint record leg 2 saw. */
  readonly totalConstraintRecords: number;
}

export interface NarrowKResult {
  readonly verdict: SensorVerdict;
  /** The readable load states this run was told to trust, or null. */
  readonly readableLoadStates: readonly string[] | null;
  /** The declared profile this run checked, or null when none was usable. */
  readonly declaredProfile: readonly string[] | null;
  /** Per-class presence over the readable scope (leg 1). Empty when stopped. */
  readonly presence: readonly ConstraintPresence[];
  /** Leg-2 detail, or null when leg 2 never ran (blind before the legs). */
  readonly correlation: NarrowKCorrelation | null;
}

/** A usable declared profile: a non-empty array of non-empty strings. */
export function isUsableProfile(
  profile: readonly string[] | undefined
): profile is readonly string[] {
  return (
    Array.isArray(profile) &&
    profile.length > 0 &&
    profile.every((c) => typeof c === "string" && c.trim().length > 0)
  );
}

function renderProfile(profile: readonly string[]): string {
  return [...new Set(profile)].sort().join(", ");
}

/**
 * Context key for a non-constraint record. Uses the shared collision-proof,
 * length-prefixed tuple key (F4) — replacing the literal-"0000" join that let
 * distinct (moduleId, eventType) pairs collapse onto one class.
 */
function contextKey(entry: MicaLogRecord): string {
  return contextTupleKey(entry);
}

// ── Leg 1 · book shape ────────────────────────────────────────────────────────

function assessBookShape(
  entries: readonly MicaLogRecord[],
  declaredProfile: readonly string[]
): { verdict: SensorVerdict; presence: ConstraintPresence[] } {
  const counts = new Map<string, number>();
  for (const e of entries) {
    counts.set(e.eventType, (counts.get(e.eventType) ?? 0) + 1);
  }

  // Deduplicate the declared classes: a profile listing a class twice asks one
  // question, not two.
  const classes = [...new Set(declaredProfile)];
  const presence: ConstraintPresence[] = classes.map((constraintClass) => {
    const count = counts.get(constraintClass) ?? 0;
    return { constraintClass, present: count > 0, count };
  });

  const absent = presence.filter((p) => !p.present);
  const scopeNote =
    `profile [${renderProfile(declaredProfile)}] over ${entries.length} record(s); ` +
    `present: ${presence.filter((p) => p.present).length}/${presence.length}`;

  if (absent.length > 0) {
    const findings: Finding[] = absent.map((p) => ({
      code: "K_CONSTRAINT_CLASS_ABSENT",
      detail:
        `declared-expected constraint class \`${p.constraintClass}\` does not ` +
        `appear as an eventType in any of the ${entries.length} readable record(s). ` +
        `The book-shape the deployer declared is not satisfied: an expected ` +
        `constraint class is missing from scope. This catches the CARELESS ` +
        `non-faker; it says nothing about a faker who WOULD have emitted the class.`,
    }));
    return {
      verdict: alarm(
        NARROW_K_SENSOR_ID,
        `A declared-expected constraint class is absent from the record. Leg 1 ` +
          `is a book-shape reader over the INJECTED profile; ${scopeNote}. ` +
          `${K_CORRESPONDENCE_ONLY}`,
        findings
      ),
      presence,
    };
  }

  return {
    verdict: {
      kind: "SILENT",
      sensorId: NARROW_K_SENSOR_ID,
      summary:
        `Every declared-expected constraint class is present in scope (${scopeNote}). ` +
        `${K_CORRESPONDENCE_ONLY} ${SILENCE_IS_NOT_HEALTH}`,
    },
    presence,
  };
}

// ── Leg 2 · constraint-activity signature ─────────────────────────────────────

function assessCorrelation(
  entries: readonly MicaLogRecord[],
  declaredProfile: readonly string[],
  config: NarrowKConfig | undefined
): { verdict: SensorVerdict; correlation: NarrowKCorrelation | null } {
  const threshold = config?.correlationThreshold;
  const minimum = config?.correlationMinimumConstraintEvents;
  const ceilingMargin = config?.correlationCeilingMargin;
  const ceilingUsable =
    typeof ceilingMargin === "number" &&
    Number.isFinite(ceilingMargin) &&
    ceilingMargin >= 0;
  const ceilingCheck: CeilingCheckStatus = ceilingUsable
    ? "PERFORMED"
    : "NOT_PERFORMED";

  // ── Required configuration. An unconfigured verdict-bearing read is BLINDNESS,
  //    not a suppressed diagnostic (the narrow-W/R ruling, carried over). ───────
  const missing: BlindPath[] = [];
  if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
    missing.push({
      class: "MISSING_CONFIGURATION",
      detail:
        "correlationThreshold was not injected as a finite number. Leg 2 is a " +
        "verdict-bearing read, and an unconfigured verdict-bearing read is " +
        "blindness — NOT a suppressed diagnostic and NOT a satisfied profile. " +
        "There is no default: a default threshold is a calibration constant, and " +
        `calibration is not this build's to make. ${K_LEG2_CALIBRATION_PROVENANCE}`,
    });
  }
  if (typeof minimum !== "number" || !Number.isInteger(minimum) || minimum < 0) {
    missing.push({
      class: "MISSING_CONFIGURATION",
      detail:
        "correlationMinimumConstraintEvents was not injected as a non-negative " +
        "integer. There is no default. Leg 2 cannot decide how many paired " +
        "constraint records make the permutation model usable without being told.",
    });
  }
  if (missing.length > 0) {
    return {
      verdict: cannotAssess(NARROW_K_SENSOR_ID, missing),
      correlation: null,
    };
  }

  // ── The pairing — the one read ACROSS records ──────────────────────────────
  //
  // Walk in sequenceNumber order. A record whose eventType is in the profile is
  // a CONSTRAINT record; every other record is CONTEXT and updates the running
  // "nearest preceding context". A constraint with no preceding context is an
  // ORPHAN: counted, excluded from the table, printed. Never silently dropped.
  const declaredSet = new Set(declaredProfile);
  const ordered = [...entries].sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber
  );
  let lastContext: string | null = null;
  const constraintKeys: string[] = [];
  const contextKeys: string[] = [];
  let orphanCount = 0;
  for (const e of ordered) {
    if (declaredSet.has(e.eventType)) {
      if (lastContext === null) {
        orphanCount++;
      } else {
        constraintKeys.push(e.eventType);
        contextKeys.push(lastContext);
      }
    } else {
      lastContext = contextKey(e);
    }
  }
  const pairedCount = constraintKeys.length;
  const totalConstraintRecords = pairedCount + orphanCount;

  const structure = pairedStructure(constraintKeys, contextKeys, {
    samples: config?.correlationPermutationSamples,
    seed: config?.correlationPermutationSeed,
  });

  const orphanNote =
    `${orphanCount} orphan constraint record(s) (no preceding non-constraint ` +
    `context) were counted and EXCLUDED from the table (report-only; no verdict rule).`;

  const mk = (legVerdictKind: VerdictKind): NarrowKCorrelation => ({
    legVerdictKind,
    structure,
    ceilingCheck,
    pairedCount,
    orphanCount,
    totalConstraintRecords,
  });

  // ── Insufficient sample (paired count, not total constraints) ──────────────
  if (pairedCount < (minimum as number)) {
    return {
      verdict: cannotAssess(NARROW_K_SENSOR_ID, [
        {
          class: "INSUFFICIENT_SAMPLE",
          detail:
            `only ${pairedCount} constraint record(s) paired with a preceding ` +
            `context; injected correlationMinimumConstraintEvents is ` +
            `${String(minimum)}. ${orphanNote} Below the minimum the permutation ` +
            `model dominates the table, so the read is not attempted.`,
        },
      ]),
      correlation: mk("CANNOT_ASSESS"),
    };
  }

  // ── Scope eligibility — arity conditions, not thresholds ───────────────────
  //
  // Below these the question "does the constraint class track the context
  // class?" is not false, it is undefined.
  if (structure.distinctLeft < 2) {
    return {
      verdict: cannotAssess(NARROW_K_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `only ${structure.distinctLeft} distinct constraint class(es) among ` +
            `the ${pairedCount} paired record(s). A profile declaring a SINGLE ` +
            `constraint class makes leg 2 PERMANENTLY ineligible: H(C)=0, so the ` +
            `dependence of the constraint class on context is undefined. This is an ` +
            `ACCEPTED OPEN EDGE — a within-class occurrence read is future work, not ` +
            `here.`,
        },
      ]),
      correlation: mk("CANNOT_ASSESS"),
    };
  }
  if (structure.distinctRight < 2) {
    return {
      verdict: cannotAssess(NARROW_K_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `only ${structure.distinctRight} distinct context class(es) among the ` +
            `${pairedCount} paired record(s). Without at least two contexts to be ` +
            `different from each other, dependence of the constraint class on ` +
            `context is unaskable.`,
        },
      ]),
      correlation: mk("CANNOT_ASSESS"),
    };
  }
  if (!structure.hasRepeatedRight) {
    return {
      verdict: cannotAssess(NARROW_K_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `every one of the ${structure.distinctRight} context classes occurs ` +
            `exactly once among the ${pairedCount} paired record(s). No context has ` +
            `a conditional constraint-class distribution, so there is nothing for the ` +
            `statistic to compare.`,
        },
      ]),
      correlation: mk("CANNOT_ASSESS"),
    };
  }
  if (structure.ami === null) {
    return {
      verdict: cannotAssess(NARROW_K_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `the adjusted-mutual-information denominator max(H(C),H(X)) - E[MI] is ` +
            `not positive (H(C)=${structure.entropyLeft.toFixed(6)}, ` +
            `H(X)=${structure.entropyRight.toFixed(6)}, ` +
            `E[MI]=${structure.expectedMutualInformation.toFixed(6)}). The ` +
            `permutation model already accounts for everything this table could ` +
            `show; no structure reading exists to compare against a threshold.`,
        },
      ]),
      correlation: mk("CANNOT_ASSESS"),
    };
  }

  // ── The AMI ceiling (A5 sibling), BEFORE the threshold comparison ──────────
  //
  // A reading at the ceiling is not a reading that passed — it is a reading with
  // no evidence behind it (the lookup defeat lands here). NOT ALARM: the real
  // constraint stream may be working flawlessly. This is DISTINCT from the D-29
  // ceiling, which is the whole-sensor careful-adversary defeat printed on every
  // verdict.
  if (ceilingUsable && structure.ami >= AMI_MAXIMUM - (ceilingMargin as number)) {
    return {
      verdict: cannotAssess(NARROW_K_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `AMI=${structure.ami.toFixed(6)} is at the ceiling: within the injected ` +
            `correlationCeilingMargin of ${String(ceilingMargin)} below the maximum ` +
            `${AMI_MAXIMUM}. At the ceiling the constraint class is fully determined ` +
            `by the context class, and A REAL CONSTRAINT STREAM AND A CLASS-KEYED ` +
            `LOOKUP TABLE PRODUCE THE IDENTICAL RECORD. The evidence that would ` +
            `separate them lives WITHIN a class and leg 2 resolves only at class ` +
            `granularity. This is not a high score, it is an absence of evidence, and ` +
            `it is deliberately NOT an alarm. ${K_LEG2_CALIBRATION_PROVENANCE}`,
        },
      ]),
      correlation: mk("CANNOT_ASSESS"),
    };
  }

  const permNote =
    structure.permutation === null
      ? ` [permutation percentile ${structure.permutationNote}]`
      : ` [of ${structure.permutation.samples} reshuffles of the same table, ` +
        `observed MI is strictly above ` +
        `${(structure.permutation.percentileBelow * 100).toFixed(1)}% and at or ` +
        `above ${(structure.permutation.percentileAtOrBelow * 100).toFixed(1)}%; ` +
        `resampled mean=${structure.permutation.resampledMean.toFixed(6)}, ` +
        `sd=${structure.permutation.resampledStdDev.toFixed(6)}]`;

  const statNote =
    `over ${pairedCount} paired constraint record(s), ${structure.distinctLeft} ` +
    `constraint class(es) against ${structure.distinctRight} context class(es) ` +
    `[plug-in MI=${structure.mutualInformation.toFixed(6)}, ` +
    `E[MI]=${structure.expectedMutualInformation.toFixed(6)}, ` +
    `H(C)=${structure.entropyLeft.toFixed(6)}, ` +
    `H(X)=${structure.entropyRight.toFixed(6)}]. ${orphanNote}`;

  // ── The read — strictly below the injected threshold alarms ────────────────
  if (structure.ami < (threshold as number)) {
    return {
      verdict: alarm(
        NARROW_K_SENSOR_ID,
        `Leg 2 (constraint-activity signature): the constraint-class stream is ` +
          `NOT carrying information about the surrounding event activity beyond what ` +
          `a reshuffle of the same table would produce. Both the THEATRE arm ` +
          `(uniform/batched constraint-event emission) and the DEGRADATION arm ` +
          `(constraint activity decoupled from what the system is doing) flatten ` +
          `this statistic. This states a property of the record — no claim that any ` +
          `constraint was ADOPTED rather than imposed (the doctor's, D-29), and no ` +
          `claim that any constraint actually bound. ` +
          `${K_CONSTRAINT_CONTEXT_LOOKUP_DEFEAT} ${K_LEG2_CALIBRATION_PROVENANCE}`,
        [
          {
            code: "K_CONSTRAINT_CONTEXT_COLLAPSE",
            detail:
              `AMI=${structure.ami.toFixed(6)} < injected correlationThreshold=` +
              `${String(threshold)} ${statNote}${permNote}` +
              (ceilingUsable ? "" : ` ${K_LEG2_CEILING_NOT_PERFORMED_NOTE}`),
          },
        ]
      ),
      correlation: mk("ALARM"),
    };
  }

  return {
    verdict: {
      kind: "SILENT",
      sensorId: NARROW_K_SENSOR_ID,
      summary:
        `Leg 2 (constraint-activity signature): AMI=${structure.ami.toFixed(6)} >= ` +
        `injected correlationThreshold=${String(threshold)} ${statNote}` +
        `${structure.permutation === null ? "" : permNote} ` +
        `${K_CONSTRAINT_CONTEXT_LOOKUP_DEFEAT} ${K_LEG2_CALIBRATION_PROVENANCE}` +
        (ceilingUsable ? "" : ` ${K_LEG2_CEILING_NOT_PERFORMED_NOTE}`) +
        ` ${K_D29_CEILING} ${SILENCE_IS_NOT_HEALTH}`,
    },
    correlation: mk("SILENT"),
  };
}

// ── Composition — worst of the two legs ───────────────────────────────────────

function rankOf(kind: VerdictKind): number {
  return kind === "ALARM" ? 2 : kind === "CANNOT_ASSESS" ? 1 : 0;
}

/**
 * narrow-K's single verdict = worst(leg 1, leg 2), by ALARM > CANNOT_ASSESS >
 * SILENT. Findings concatenated, blind paths concatenated, BOTH legs' summaries
 * represented. When the worst kind is ALARM, a CANNOT_ASSESS leg contributes only
 * its summary text (an ALARM carries no blind paths); its structured detail is
 * always available on result.correlation.
 */
function composeVerdicts(leg1: SensorVerdict, leg2: SensorVerdict): SensorVerdict {
  const worstKind: VerdictKind =
    rankOf(leg1.kind) >= rankOf(leg2.kind) ? leg1.kind : leg2.kind;

  const summary =
    `narrow-K composes TWO legs by the worst-of floor ` +
    `(ALARM > CANNOT_ASSESS > SILENT); both are represented below. ` +
    `|| [LEG 1 book-shape / ${leg1.kind}] ${leg1.summary} ` +
    `|| [LEG 2 constraint-activity / ${leg2.kind}] ${leg2.summary}`;

  if (worstKind === "ALARM") {
    const findings: Finding[] = [
      ...(leg1.kind === "ALARM" ? leg1.findings : []),
      ...(leg2.kind === "ALARM" ? leg2.findings : []),
    ];
    return { kind: "ALARM", sensorId: NARROW_K_SENSOR_ID, summary, findings };
  }
  if (worstKind === "CANNOT_ASSESS") {
    const blindPaths: BlindPath[] = [
      ...(leg1.kind === "CANNOT_ASSESS" ? leg1.blindPaths : []),
      ...(leg2.kind === "CANNOT_ASSESS" ? leg2.blindPaths : []),
    ];
    return {
      kind: "CANNOT_ASSESS",
      sensorId: NARROW_K_SENSOR_ID,
      summary,
      blindPaths,
    };
  }
  return { kind: "SILENT", sensorId: NARROW_K_SENSOR_ID, summary };
}

// ── The reader ────────────────────────────────────────────────────────────────

export function assessNarrowK(
  log: MicaReadableLog,
  config?: NarrowKConfig
): NarrowKResult {
  const injectedStates = config?.readableLoadStates;
  const readableLoadStates: readonly string[] | null = isUsableLoadStateList(
    injectedStates
  )
    ? injectedStates
    : null;

  const injectedProfile = config?.declaredProfile;
  const declaredProfile: readonly string[] | null = isUsableProfile(
    injectedProfile
  )
    ? injectedProfile
    : null;

  // ── D8 anchor: readability gate, before anything is read ──────────────────
  const unreadable = assessLogReadability(
    log,
    NARROW_K_SENSOR_ID,
    injectedStates
  );
  if (unreadable !== null) {
    return {
      verdict: unreadable,
      readableLoadStates,
      declaredProfile,
      presence: [],
      correlation: null,
    };
  }

  // ── The profile is injected, never defaulted (option-B). BEFORE any leg ────
  if (declaredProfile === null) {
    return {
      verdict: cannotAssess(NARROW_K_SENSOR_ID, [
        {
          class: "MISSING_CONFIGURATION",
          detail:
            "no usable declaredProfile was injected (absent, empty, or not a list " +
            "of non-empty strings). narrow-K holds no profile of its own, derives " +
            "none from moduleId/eventType, and mandates none. A vacuous profile " +
            "does not buy a clean reading — vacuity scales the claim to nothing. " +
            "This is NOT silence and NOT a satisfied profile, and no leg runs.",
        },
      ]),
      readableLoadStates,
      declaredProfile,
      presence: [],
      correlation: null,
    };
  }

  const entries = log.getAll() as readonly MicaLogRecord[];

  // ── Both legs run; the single verdict is the worst of them ─────────────────
  const leg1 = assessBookShape(entries, declaredProfile);
  const leg2 = assessCorrelation(entries, declaredProfile, config);

  return {
    verdict: composeVerdicts(leg1.verdict, leg2.verdict),
    readableLoadStates,
    declaredProfile,
    presence: leg1.presence,
    correlation: leg2.correlation,
  };
}

// ── D7: printed scope, in the code's own output ───────────────────────────────

export const NARROW_K_SCOPE_TITLE =
  "MICA/narrow-K — declared-profile book shape + constraint-activity signature";

export const NARROW_K_SCOPE_READS: readonly string[] = [
  "the declared record's eventType   — leg 1: matched against the INJECTED",
  "                          profile of expected constraint classes, presence",
  "                          only; leg 2: the eventType of a profile-member record",
  "                          is its CONSTRAINT class C",
  "the declared record's moduleId    — leg 2 only: with eventType, the (moduleId,",
  "                          eventType) of a NON-profile record is a CONTEXT class X",
  "the declared record's sequenceNumber — leg 2 ONLY, and for PAIRING ORDER ONLY.",
  "                          It pairs each constraint record with the nearest",
  "                          preceding non-constraint record. Not read as a value.",
  "the DERIVED PARTITION      — profile membership -> constraint (C); the",
  "                          complement -> surrounding event activity, read as",
  "                          context (X). There is NO second declared list (option A).",
  "the log's own verify()        — readability gate ONLY, never the finding",
  "the log's own getLoadState()  — readability gate only",
];

export const NARROW_K_SCOPE_DOES_NOT_SEE: readonly string[] = [
  "WHETHER ANY CONSTRAINT WAS GENUINELY ADOPTED — the DOCTOR's question, never",
  "  closed by the record (D-29, the loudest ceiling on this board). Adopted-vs-",
  "  imposed is not justiciable from records: the behavioural tell, a monitored/",
  "  unmonitored delta, is ABSENT from this evidence class BY CONSTRUCTION —",
  "  every entry was produced under observation, THE WRITING IS THE WATCHING. A",
  "  competent unbound system emits zero delta, and zero delta reads SILENT.",
  "  THIS READER'S SILENT IS WORTH LESS against a careful adversary than Eng's,",
  "  which at least requires a template. T1 catches honest degradation and lazy",
  "  theatre; it catches nothing that is careful. The adoption/health verdict is",
  "  the doctor's, made from OUTSIDE MICA (roles ruling, ratified 2026-08-19).",
  "WHETHER A PRESENT CONSTRAINT ACTUALLY BOUND (leg 1). narrow-K reads PRESENCE",
  "  of an eventType, not the constraint behind it. A faker that emits the",
  "  expected class without any real constraint reads leg-1 SILENT. Leg 1 catches",
  "  the CARELESS non-faker who did not emit the class; not the faker who did.",
  "THE STRATEGIC FAKER (leg 2 — the LOOKUP DEFEAT). A faker emitting context-",
  "  correlated constraint events via a class-keyed lookup table reads leg-2",
  "  SILENT. At the AMI ceiling a real constraint stream and a lookup table",
  "  produce the IDENTICAL record; the evidence separating them lives WITHIN a",
  "  class, and leg 2 resolves only at class granularity. A T1 collapse detector,",
  "  stated, not T2.",
  "INTERLEAVING IS NOT CAUSALITY (leg 2). The pairing reads the record's own",
  "  order by sequenceNumber. A system whose constraint events fall at a temporal",
  "  distance from their context reads as decoupled. Named design choice.",
  "A SINGLE-CONSTRAINT-CLASS PROFILE (leg 2). A profile declaring one class gives",
  "  H(C)=0 and makes leg 2 PERMANENTLY ineligible (CANNOT_ASSESS). A within-class",
  "  occurrence read is future work, an accepted open edge, not here.",
  "AMBIENT-NOISE DILUTION OF THE CONTEXT (leg 2, option-A). The context is the",
  "  profile's COMPLEMENT — surrounding event activity, some of which may be",
  "  operational noise. That dilution weakens the statistic; it is PRINTED here,",
  "  not hidden, a stated consequence of deriving context from the complement",
  "  rather than from a second declared list, and it is ruled, not overlooked.",
  "CROSS-FACTOR CONTEXT OVERLAP (leg 2). Where a deployment runs narrow-W,",
  "  narrow-R, and narrow-K, each factor's context includes the others' profile",
  "  classes. They are INDEPENDENT readers; this is expected and is noted, not fixed.",
  "WHETHER A CONSTRAINT WAS DEEP, HELD, OR MERELY OBEYED-WHILE-WATCHED (leg 2).",
  "  Leg 2 reads a statistical dependency between two recorded fields. The claim at",
  "  SILENT is that the constraint-class stream carries structure relative to",
  "  adjacent event classes, beyond a reshuffle — nothing about whether any",
  "  constraint was real, deep, or adopted rather than imposed.",
  "THE GRAMMAR THIS READER LEANS ON. The absent/vacuous-profile -> CANNOT_ASSESS",
  "  rule is the NINTH site of one arbiter-ruled resolution (vacuity-scales-the-",
  "  claim). Whether that is one grammar applied consistently or a single point the",
  "  whole offer leans on is an OPEN question under standing panel review, now",
  "  widened to cover NINE sites (ruled 2026-08-19). Printed so the dependence is",
  "  visible, not blessed.",
  "COMPLETENESS. narrow-K checks correspondence to the DECLARED profile only. A",
  "  profile that omits a constraint that matters is a blind spot narrow-K cannot",
  "  see — it holds no profile of its own and cannot know what was left out.",
  "THE PROFILE ITSELF. It is INJECTED by the deployer, derived from nothing, and",
  "  mandated nowhere. Absent or vacuous, narrow-K reads CANNOT_ASSESS — never a",
  "  trivially-satisfied SILENT.",
  "SYSTEMIC HARM. narrow-K is a book-shape + signature reader, not a harm reader.",
  "  Its silence is the absence of two findings over one declared profile, and",
  "  nothing wider.",
];

export function narrowKScopeBlockText(
  readableLoadStates?: readonly string[]
): string {
  return formatScopeBlock(
    NARROW_K_SCOPE_TITLE,
    NARROW_K_SCOPE_READS,
    NARROW_K_SCOPE_DOES_NOT_SEE,
    NARROW_K_COMPETENCE_LINES,
    loadStateScopeLines(readableLoadStates)
  );
}

export function printNarrowKScope(readableLoadStates?: readonly string[]): void {
  printScopeBlock(
    NARROW_K_SCOPE_TITLE,
    NARROW_K_SCOPE_READS,
    NARROW_K_SCOPE_DOES_NOT_SEE,
    NARROW_K_COMPETENCE_LINES,
    loadStateScopeLines(readableLoadStates)
  );
}
