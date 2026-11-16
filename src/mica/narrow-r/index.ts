// ── MICA · narrow-R — the verification-context reader (factor R, D-13) ─────────
//
// narrow-R emits ONE SensorVerdict, composed from TWO legs by a worst-of floor.
// It is a THIRD Eng-sibling: narrow-W's two-leg shape re-aimed at VERIFICATION.
//
// ── HISTORICAL NOTE — the one place the dead framing is named ──────────────────
//
//   Factor R's original read was a verification-vs-output RATIO, and it counted
//   self-authored verification records as spend. That framing is DEAD under B-1
//   (ledger D-13): a record the observed party writes about its own verification
//   is not spend, and treating it as cost was the barred move. What survives is
//   the signature shape below. The words ratio / spend / cost do not appear again
//   anywhere this file authors — in code, comment, verdict text, or scope block.
//   (They may still appear in the SHARED common-scope boilerplate this file does
//   not author and must not touch — see the build record.)
//
// ── LEG 1 · BOOK SHAPE ────────────────────────────────────────────────────────
//
//   Given a DEPLOYER-DECLARED PROFILE of expected VERIFICATION classes, it checks
//   the record for their PRESENCE IN SCOPE. Each expected class is an `eventType`
//   value; "present" means at least one record in the readable scope carries it.
//
//     all declared classes present  -> leg-1 SILENT
//     any declared class absent      -> leg-1 ALARM   (a bound is lowered)
//
//   Leg 1 attests CORRESPONDENCE TO THE NAMED PROFILE ONLY — never completeness,
//   never that any verification actually happened. An `eventType` is a string the
//   observed party writes; its presence is not proof the verification occurred.
//
// ── LEG 2 · VERIFICATION-CONTEXT SIGNATURE ────────────────────────────────────
//
//   Leg 2 asks: does the verification-class stream carry STATISTICAL STRUCTURE
//   relative to the surrounding event activity, or has it decoupled — templated,
//   batched, or degraded into noise?
//
//   The mechanism is ENG'S STATISTIC, SHARED via ../stat/ami. Leg 2 computes the
//   adjusted mutual information between:
//
//     V — VERIFICATION CLASS: the `eventType` of each record whose `eventType` is
//                             in the injected declaredProfile;
//     X — CONTEXT CLASS:      the (moduleId, eventType) of the NEAREST PRECEDING
//                             NON-VERIFICATION record, by sequenceNumber.
//
//   THE TWO FAILURE DIRECTIONS. Both flatten the SAME statistic toward zero:
//
//     THEATRE       — verification emitted uniformly/batched regardless of context.
//     DEGRADATION   — verification decoupled from activity through neglect.
//
//   Collapse (low AMI) → ALARM (R_VERIFICATION_CONTEXT_COLLAPSE). The only way off
//   the floor is verification that actually tracks the surrounding activity.
//
//   THE CEILING (A5 sibling). A maximal AMI is NOT health. A perfectly regimented
//   verifier and a class-keyed LOOKUP TABLE (read the context label, emit the
//   canned verification class) print the IDENTICAL record. The evidence separating
//   them lives WITHIN a class and leg 2 resolves only at class granularity. Within
//   the injected ceiling margin of the maximum → CANNOT_ASSESS, never SILENT and
//   never ALARM. Absent a margin, the check DOES NOT RUN and every leg-2 verdict
//   says so.
//
//   VOCABULARY DISCIPLINE (B-1 is a language constraint here). The object is a
//   VERIFICATION-CONTEXT SIGNATURE. THE CONTEXT IS DERIVED FROM THE PROFILE'S
//   COMPLEMENT: surrounding event activity, some of which may be operational
//   noise. That dilution is PRINTED, not hidden; there is NO second declared list
//   (option A). The claim at leg-2 SILENT is exactly: the verification-class
//   stream carries statistical structure relative to adjacent event classes,
//   beyond a reshuffle. Nothing wider — NO claim about verification QUALITY,
//   DEPTH, RIGOR, or TRUTH (D-06 family), and no claim that anything was actually
//   verified.
//
//   CROSS-FACTOR CONTEXT OVERLAP. In a deployment running BOTH narrow-W and
//   narrow-R, each factor's context (its profile's complement) includes the OTHER
//   factor's profile classes. The two are INDEPENDENT readers, each emitting its
//   own SensorVerdict to the chokepoint; this overlap is expected, not an error.
//   Noted, not "fixed".
//
//   T1 ONLY. Leg 2 is a collapse detector. It is FALSE-SILENT against the
//   strategic faker who emits context-correlated verification via a table read;
//   that defeat is the ceiling, and it is printed.
//
// ── THE PAIRING — a read ACROSS records ───────────────────────────────────────
//
//   Leg 2 pairs one ENTRY with the entry before it, by sequenceNumber (read for
//   ordering ONLY, not as a value). It is NOT cross-READER: leg 2 consumes no
//   other instrument's output. Fixed by design, printed, not injected:
//
//     · each verification record pairs with the NEAREST PRECEDING non-verification
//       record's (moduleId, eventType) as its context class;
//     · ORPHAN verifications (no preceding non-verification record) are COUNTED,
//       EXCLUDED FROM THE TABLE, and PRINTED. Report-only; no verdict rule;
//     · INTERLEAVING IS NOT CAUSALITY. The pairing reads record order; a system
//       that verifies at a temporal distance from its context reads as decoupled.
//
// ── LEG COMPOSITION — worst of the two legs ───────────────────────────────────
//
//   narrow-R's single verdict = worst(leg 1, leg 2), by ALARM > CANNOT_ASSESS >
//   SILENT, findings concatenated, both legs' summaries represented. A caller
//   injecting ONLY leg-1 config composes worst(leg1, CANNOT_ASSESS) =
//   CANNOT_ASSESS: an unconfigured verdict-bearing read is BLINDNESS, and
//   BLINDNESS COMPOSES. The narrow-W ruling carries over unchanged.
//
// ── STRUCTURE — route (ii), stated ────────────────────────────────────────────
//
//   This module MIRRORS narrow-W's verdict assembly rather than sharing a common
//   two-leg core; it shares only the statistic (../stat/ami). The duplication is
//   STATED here, not hidden: each reader keeps its own scope block and verdict
//   vocabulary, reader independence is arbiter-ruled architecture, and one
//   cross-check test asserts narrow-R and narrow-W produce the identical AMI on a
//   shared table.
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
import { NARROW_R_COMPETENCE_LINES } from "../competence";
import { AMI_MAXIMUM, pairedStructure } from "../stat/ami";
import type { PairedStructure } from "../stat/ami";

export const NARROW_R_SENSOR_ID = "MICA/narrow-R";

// ── Configuration — injected, never defaulted ─────────────────────────────────

export interface NarrowRConfig {
  /**
   * The load states this deployment considers readable. INJECTED — no default,
   * no fallback (the ../types load-state gate). Absent/unusable -> CANNOT_ASSESS
   * and no reading is offered.
   */
  readableLoadStates?: readonly string[];
  /**
   * The declared R verification profile: the expected verification classes, each
   * an `eventType` value the record is checked for. INJECTED, OPTION-B: no
   * default, no fallback. Absent, empty, or not a list of non-empty strings ->
   * CANNOT_ASSESS (MISSING_CONFIGURATION). narrow-R derives this from nothing.
   *
   * The SAME list drives both legs: leg 1 checks presence of these classes; leg
   * 2's VERIFICATION partition is exactly these classes, and its CONTEXT partition
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
   * LEG 2. Paired-verification count below which the read is not attempted.
   * REQUIRED FOR LEG 2, a non-negative integer. Absent/unusable -> leg 2
   * CANNOT_ASSESS (MISSING_CONFIGURATION).
   *
   * Named for verification (narrow-W's field is …InquiryEvents); builder's call,
   * stated in the build record — the vocabulary follows the factor.
   */
  correlationMinimumVerificationEvents?: number;
  /**
   * LEG 2. Distance below AMI_MAXIMUM (1) within which the reading counts as AT
   * THE CEILING -> CANNOT_ASSESS (a perfectly regimented verifier and a
   * class-keyed lookup table print the identical record). OPTIONAL, Eng
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
 * PRE-PILOT PROXY CALIBRATION (mirrors narrow-W's, 2026-08-18).
 *
 * The code keeps ZERO defaults — every number is injected. These are the STARTING
 * CONFIGURATION and are marked, here and at every appearance, as PRE-PILOT PROXY,
 * SUBJECT TO CALIBRATION. They are NOT defaults: nothing in this module reads this
 * constant, and a caller who wants these values must inject them, deliberately.
 *
 *   correlationThreshold: 0.05                 — AMI normalized ~0..1; below
 *     one-twentieth of maximal structure is indistinguishable-from-reshuffle.
 *   correlationMinimumVerificationEvents: 30   — small-sample rule of thumb.
 *   correlationCeilingMargin: 0.02             — within 2% of the maximum counts
 *     as at the ceiling (lookup-table territory -> CANNOT_ASSESS).
 *   correlationPermutationSamples: 1000        — report-only diagnostic.
 *   correlationPermutationSeed: 20260818       — report-only diagnostic.
 */
export const NARROW_R_PROXY_CALIBRATION = {
  correlationThreshold: 0.05,
  correlationMinimumVerificationEvents: 30,
  correlationCeilingMargin: 0.02,
  correlationPermutationSamples: 1000,
  correlationPermutationSeed: 20260818,
  provenance:
    "PRE-PILOT PROXY, subject to calibration. These are STARTING values, not " +
    "defaults; the code reads no default and this constant is injected by name, " +
    "never consulted internally.",
} as const;

/** The correspondence/completeness/verification limit (leg 1), printed. */
export const R_CORRESPONDENCE_ONLY =
  "narrow-R leg 1 attests CORRESPONDENCE TO THE NAMED PROFILE ONLY. A declared " +
  "verification class that is PRESENT reads SILENT even if the verification was " +
  "faked — an `eventType` is a string the observed party writes, and its presence " +
  "is not proof the verification happened. Leg 1 catches the CARELESS non-faker " +
  "who did not emit the expected class; it goes SILENT against a faker who emits " +
  "the class without real verification. It claims NO completeness: a profile can " +
  "omit verifications that matter, and this reader cannot know what was left out.";

/** The lookup defeat (leg 2), printed in leg-2 SILENT/ALARM summaries. */
export const R_VERIFICATION_CONTEXT_LOOKUP_DEFEAT =
  "Leg 2 reads a T1 COLLAPSE only. A strategic faker that emits context-correlated " +
  "verification via a class-keyed LOOKUP TABLE — read the context label, emit the " +
  "canned verification class — reads SILENT: at the ceiling a real verifier and a " +
  "lookup table produce the identical record, and the evidence that separates them " +
  "lives WITHIN a class, which leg 2 does not resolve. This is a stated ceiling, " +
  "not a clean pass.";

/** Where the calibration numbers come from — echoed wherever leg 2 prints one. */
export const R_LEG2_CALIBRATION_PROVENANCE =
  "Calibration is INJECTED and comes from pilot data this sensor has never seen; " +
  "this reader holds no default and cannot vouch for the value. Where this project " +
  "supplies STARTING numbers (NARROW_R_PROXY_CALIBRATION) they are PRE-PILOT PROXY, " +
  "subject to calibration.";

/** The ceiling-not-performed note (leg 2), printed when no margin was injected. */
export const R_LEG2_CEILING_NOT_PERFORMED_NOTE =
  "The LEG-2 CEILING CHECK DID NOT RUN: no correlationCeilingMargin was injected. " +
  "A reading at or near the maximum is evidence-free rather than healthy (a real " +
  "verifier and a class-keyed lookup table produce the identical record), and " +
  "without a margin this leg cannot tell whether this reading is one of those. " +
  "Treat this verdict as not having been checked for that condition.";

export interface VerificationPresence {
  readonly verificationClass: string;
  readonly present: boolean;
  /** Number of records in scope carrying this eventType. */
  readonly count: number;
}

export type CeilingCheckStatus = "PERFORMED" | "NOT_PERFORMED";

/**
 * Leg-2 detail carried on the result. `structure` maps onto leg 2's two variables:
 *   entropyLeft / distinctLeft / hasRepeatedLeft  → VERIFICATION class V
 *   entropyRight / distinctRight / hasRepeatedRight → CONTEXT class X
 * Present (non-null) whenever the pairing was attempted; null only when leg 2
 * could not run at all (missing config).
 */
export interface NarrowRCorrelation {
  /** Leg 2's own verdict kind, before composition. */
  readonly legVerdictKind: VerdictKind;
  /** The AMI structure over the paired (verification, context) table, or null. */
  readonly structure: PairedStructure | null;
  /** Whether the ceiling check ran at all. */
  readonly ceilingCheck: CeilingCheckStatus;
  /** Verification records paired with a preceding context (the table's rows). */
  readonly pairedCount: number;
  /** Verification records with NO preceding non-verification record. Counted. */
  readonly orphanCount: number;
  /** pairedCount + orphanCount — every verification record leg 2 saw. */
  readonly totalVerificationRecords: number;
}

export interface NarrowRResult {
  readonly verdict: SensorVerdict;
  /** The readable load states this run was told to trust, or null. */
  readonly readableLoadStates: readonly string[] | null;
  /** The declared profile this run checked, or null when none was usable. */
  readonly declaredProfile: readonly string[] | null;
  /** Per-class presence over the readable scope (leg 1). Empty when stopped. */
  readonly presence: readonly VerificationPresence[];
  /** Leg-2 detail, or null when leg 2 never ran (blind before the legs). */
  readonly correlation: NarrowRCorrelation | null;
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

/** Context key for a non-verification record. Both components are typed fields. */
/** Context key for a non-verification record — shared, collision-proof (F4). */
function contextKey(entry: MicaLogRecord): string {
  // Shared collision-proof, length-prefixed tuple key (F4) — one home for W/R/K,
  // so the siblings cannot drift and no delimiter is assumed forbidden.
  return contextTupleKey(entry);
}

// ── Leg 1 · book shape ────────────────────────────────────────────────────────

function assessBookShape(
  entries: readonly MicaLogRecord[],
  declaredProfile: readonly string[]
): { verdict: SensorVerdict; presence: VerificationPresence[] } {
  const counts = new Map<string, number>();
  for (const e of entries) {
    counts.set(e.eventType, (counts.get(e.eventType) ?? 0) + 1);
  }

  // Deduplicate the declared classes: a profile listing a class twice asks one
  // question, not two.
  const classes = [...new Set(declaredProfile)];
  const presence: VerificationPresence[] = classes.map((verificationClass) => {
    const count = counts.get(verificationClass) ?? 0;
    return { verificationClass, present: count > 0, count };
  });

  const absent = presence.filter((p) => !p.present);
  const scopeNote =
    `profile [${renderProfile(declaredProfile)}] over ${entries.length} record(s); ` +
    `present: ${presence.filter((p) => p.present).length}/${presence.length}`;

  if (absent.length > 0) {
    const findings: Finding[] = absent.map((p) => ({
      code: "R_VERIFICATION_CLASS_ABSENT",
      detail:
        `declared-expected verification class \`${p.verificationClass}\` does not ` +
        `appear as an eventType in any of the ${entries.length} readable record(s). ` +
        `The book-shape the deployer declared is not satisfied: an expected ` +
        `verification class is missing from scope. This catches the CARELESS ` +
        `non-faker; it says nothing about a faker who WOULD have emitted the class.`,
    }));
    return {
      verdict: alarm(
        NARROW_R_SENSOR_ID,
        `A declared-expected verification class is absent from the record. Leg 1 ` +
          `is a book-shape reader over the INJECTED profile; ${scopeNote}. ` +
          `${R_CORRESPONDENCE_ONLY}`,
        findings
      ),
      presence,
    };
  }

  return {
    verdict: {
      kind: "SILENT",
      sensorId: NARROW_R_SENSOR_ID,
      summary:
        `Every declared-expected verification class is present in scope (${scopeNote}). ` +
        `${R_CORRESPONDENCE_ONLY} ${SILENCE_IS_NOT_HEALTH}`,
    },
    presence,
  };
}

// ── Leg 2 · verification-context signature ────────────────────────────────────

function assessCorrelation(
  entries: readonly MicaLogRecord[],
  declaredProfile: readonly string[],
  config: NarrowRConfig | undefined
): { verdict: SensorVerdict; correlation: NarrowRCorrelation | null } {
  const threshold = config?.correlationThreshold;
  const minimum = config?.correlationMinimumVerificationEvents;
  const ceilingMargin = config?.correlationCeilingMargin;
  const ceilingUsable =
    typeof ceilingMargin === "number" &&
    Number.isFinite(ceilingMargin) &&
    ceilingMargin >= 0;
  const ceilingCheck: CeilingCheckStatus = ceilingUsable
    ? "PERFORMED"
    : "NOT_PERFORMED";

  // ── Required configuration. An unconfigured verdict-bearing read is BLINDNESS,
  //    not a suppressed diagnostic (the narrow-W ruling, carried over). ─────────
  const missing: BlindPath[] = [];
  if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
    missing.push({
      class: "MISSING_CONFIGURATION",
      detail:
        "correlationThreshold was not injected as a finite number. Leg 2 is a " +
        "verdict-bearing read, and an unconfigured verdict-bearing read is " +
        "blindness — NOT a suppressed diagnostic and NOT a satisfied profile. " +
        "There is no default: a default threshold is a calibration constant, and " +
        `calibration is not this build's to make. ${R_LEG2_CALIBRATION_PROVENANCE}`,
    });
  }
  if (typeof minimum !== "number" || !Number.isInteger(minimum) || minimum < 0) {
    missing.push({
      class: "MISSING_CONFIGURATION",
      detail:
        "correlationMinimumVerificationEvents was not injected as a non-negative " +
        "integer. There is no default. Leg 2 cannot decide how many paired " +
        "verification records make the permutation model usable without being told.",
    });
  }
  if (missing.length > 0) {
    return {
      verdict: cannotAssess(NARROW_R_SENSOR_ID, missing),
      correlation: null,
    };
  }

  // ── The pairing — the one read ACROSS records ──────────────────────────────
  //
  // Walk in sequenceNumber order. A record whose eventType is in the profile is
  // a VERIFICATION record; every other record is CONTEXT and updates the running
  // "nearest preceding context". A verification with no preceding context is an
  // ORPHAN: counted, excluded from the table, printed. Never silently dropped.
  const declaredSet = new Set(declaredProfile);
  const ordered = [...entries].sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber
  );
  let lastContext: string | null = null;
  const verificationKeys: string[] = [];
  const contextKeys: string[] = [];
  let orphanCount = 0;
  for (const e of ordered) {
    if (declaredSet.has(e.eventType)) {
      if (lastContext === null) {
        orphanCount++;
      } else {
        verificationKeys.push(e.eventType);
        contextKeys.push(lastContext);
      }
    } else {
      lastContext = contextKey(e);
    }
  }
  const pairedCount = verificationKeys.length;
  const totalVerificationRecords = pairedCount + orphanCount;

  const structure = pairedStructure(verificationKeys, contextKeys, {
    samples: config?.correlationPermutationSamples,
    seed: config?.correlationPermutationSeed,
  });

  const orphanNote =
    `${orphanCount} orphan verification record(s) (no preceding non-verification ` +
    `context) were counted and EXCLUDED from the table (report-only; no verdict rule).`;

  const mk = (legVerdictKind: VerdictKind): NarrowRCorrelation => ({
    legVerdictKind,
    structure,
    ceilingCheck,
    pairedCount,
    orphanCount,
    totalVerificationRecords,
  });

  // ── Insufficient sample (paired count, not total verifications) ────────────
  if (pairedCount < (minimum as number)) {
    return {
      verdict: cannotAssess(NARROW_R_SENSOR_ID, [
        {
          class: "INSUFFICIENT_SAMPLE",
          detail:
            `only ${pairedCount} verification record(s) paired with a preceding ` +
            `context; injected correlationMinimumVerificationEvents is ` +
            `${String(minimum)}. ${orphanNote} Below the minimum the permutation ` +
            `model dominates the table, so the read is not attempted.`,
        },
      ]),
      correlation: mk("CANNOT_ASSESS"),
    };
  }

  // ── Scope eligibility — arity conditions, not thresholds ───────────────────
  //
  // Below these the question "does the verification class track the context
  // class?" is not false, it is undefined.
  if (structure.distinctLeft < 2) {
    return {
      verdict: cannotAssess(NARROW_R_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `only ${structure.distinctLeft} distinct verification class(es) among ` +
            `the ${pairedCount} paired record(s). A profile declaring a SINGLE ` +
            `verification class makes leg 2 PERMANENTLY ineligible: H(V)=0, so the ` +
            `dependence of verification on context is undefined. This is an ACCEPTED ` +
            `OPEN EDGE — a within-class occurrence read is future work, not here.`,
        },
      ]),
      correlation: mk("CANNOT_ASSESS"),
    };
  }
  if (structure.distinctRight < 2) {
    return {
      verdict: cannotAssess(NARROW_R_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `only ${structure.distinctRight} distinct context class(es) among the ` +
            `${pairedCount} paired record(s). Without at least two contexts to be ` +
            `different from each other, dependence of verification on context is ` +
            `unaskable.`,
        },
      ]),
      correlation: mk("CANNOT_ASSESS"),
    };
  }
  if (!structure.hasRepeatedRight) {
    return {
      verdict: cannotAssess(NARROW_R_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `every one of the ${structure.distinctRight} context classes occurs ` +
            `exactly once among the ${pairedCount} paired record(s). No context has ` +
            `a conditional verification distribution, so there is nothing for the ` +
            `statistic to compare.`,
        },
      ]),
      correlation: mk("CANNOT_ASSESS"),
    };
  }
  if (structure.ami === null) {
    return {
      verdict: cannotAssess(NARROW_R_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `the adjusted-mutual-information denominator max(H(V),H(X)) - E[MI] is ` +
            `not positive (H(V)=${structure.entropyLeft.toFixed(6)}, ` +
            `H(X)=${structure.entropyRight.toFixed(6)}, ` +
            `E[MI]=${structure.expectedMutualInformation.toFixed(6)}). The ` +
            `permutation model already accounts for everything this table could ` +
            `show; no structure reading exists to compare against a threshold.`,
        },
      ]),
      correlation: mk("CANNOT_ASSESS"),
    };
  }

  // ── The ceiling (A5 sibling), BEFORE the threshold comparison ──────────────
  //
  // A reading at the ceiling is not a reading that passed — it is a reading with
  // no evidence behind it (the lookup defeat lands here). NOT ALARM: the real
  // verifier may be working flawlessly.
  if (ceilingUsable && structure.ami >= AMI_MAXIMUM - (ceilingMargin as number)) {
    return {
      verdict: cannotAssess(NARROW_R_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `AMI=${structure.ami.toFixed(6)} is at the ceiling: within the injected ` +
            `correlationCeilingMargin of ${String(ceilingMargin)} below the maximum ` +
            `${AMI_MAXIMUM}. At the ceiling the verification class is fully determined ` +
            `by the context class, and A REAL VERIFIER AND A CLASS-KEYED LOOKUP TABLE ` +
            `PRODUCE THE IDENTICAL RECORD. The evidence that would separate them lives ` +
            `WITHIN a class and leg 2 resolves only at class granularity. This is not ` +
            `a high score, it is an absence of evidence, and it is deliberately NOT an ` +
            `alarm. ${R_LEG2_CALIBRATION_PROVENANCE}`,
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
    `over ${pairedCount} paired verification record(s), ${structure.distinctLeft} ` +
    `verification class(es) against ${structure.distinctRight} context class(es) ` +
    `[plug-in MI=${structure.mutualInformation.toFixed(6)}, ` +
    `E[MI]=${structure.expectedMutualInformation.toFixed(6)}, ` +
    `H(V)=${structure.entropyLeft.toFixed(6)}, ` +
    `H(X)=${structure.entropyRight.toFixed(6)}]. ${orphanNote}`;

  // ── The read — strictly below the injected threshold alarms ────────────────
  if (structure.ami < (threshold as number)) {
    return {
      verdict: alarm(
        NARROW_R_SENSOR_ID,
        `Leg 2 (verification-context signature): the verification-class stream is ` +
          `NOT carrying information about the surrounding event activity beyond what ` +
          `a reshuffle of the same table would produce. Both the THEATRE arm ` +
          `(uniform/batched verification) and the DEGRADATION arm (verification ` +
          `decoupled through neglect) flatten this statistic. This states a property ` +
          `of the record — no claim about verification QUALITY, DEPTH, RIGOR, or ` +
          `TRUTH. ${R_VERIFICATION_CONTEXT_LOOKUP_DEFEAT} ${R_LEG2_CALIBRATION_PROVENANCE}`,
        [
          {
            code: "R_VERIFICATION_CONTEXT_COLLAPSE",
            detail:
              `AMI=${structure.ami.toFixed(6)} < injected correlationThreshold=` +
              `${String(threshold)} ${statNote}${permNote}` +
              (ceilingUsable ? "" : ` ${R_LEG2_CEILING_NOT_PERFORMED_NOTE}`),
          },
        ]
      ),
      correlation: mk("ALARM"),
    };
  }

  return {
    verdict: {
      kind: "SILENT",
      sensorId: NARROW_R_SENSOR_ID,
      summary:
        `Leg 2 (verification-context signature): AMI=${structure.ami.toFixed(6)} >= ` +
        `injected correlationThreshold=${String(threshold)} ${statNote}` +
        `${structure.permutation === null ? "" : permNote} ` +
        `${R_VERIFICATION_CONTEXT_LOOKUP_DEFEAT} ${R_LEG2_CALIBRATION_PROVENANCE}` +
        (ceilingUsable ? "" : ` ${R_LEG2_CEILING_NOT_PERFORMED_NOTE}`) +
        ` ${SILENCE_IS_NOT_HEALTH}`,
    },
    correlation: mk("SILENT"),
  };
}

// ── Composition — worst of the two legs ───────────────────────────────────────

function rankOf(kind: VerdictKind): number {
  return kind === "ALARM" ? 2 : kind === "CANNOT_ASSESS" ? 1 : 0;
}

/**
 * narrow-R's single verdict = worst(leg 1, leg 2), by ALARM > CANNOT_ASSESS >
 * SILENT. Findings concatenated, blind paths concatenated, BOTH legs' summaries
 * represented. When the worst kind is ALARM, a CANNOT_ASSESS leg contributes only
 * its summary text (an ALARM carries no blind paths); its structured detail is
 * always available on result.correlation.
 */
function composeVerdicts(leg1: SensorVerdict, leg2: SensorVerdict): SensorVerdict {
  const worstKind: VerdictKind =
    rankOf(leg1.kind) >= rankOf(leg2.kind) ? leg1.kind : leg2.kind;

  const summary =
    `narrow-R composes TWO legs by the worst-of floor ` +
    `(ALARM > CANNOT_ASSESS > SILENT); both are represented below. ` +
    `|| [LEG 1 book-shape / ${leg1.kind}] ${leg1.summary} ` +
    `|| [LEG 2 verification-context / ${leg2.kind}] ${leg2.summary}`;

  if (worstKind === "ALARM") {
    const findings: Finding[] = [
      ...(leg1.kind === "ALARM" ? leg1.findings : []),
      ...(leg2.kind === "ALARM" ? leg2.findings : []),
    ];
    return { kind: "ALARM", sensorId: NARROW_R_SENSOR_ID, summary, findings };
  }
  if (worstKind === "CANNOT_ASSESS") {
    const blindPaths: BlindPath[] = [
      ...(leg1.kind === "CANNOT_ASSESS" ? leg1.blindPaths : []),
      ...(leg2.kind === "CANNOT_ASSESS" ? leg2.blindPaths : []),
    ];
    return {
      kind: "CANNOT_ASSESS",
      sensorId: NARROW_R_SENSOR_ID,
      summary,
      blindPaths,
    };
  }
  return { kind: "SILENT", sensorId: NARROW_R_SENSOR_ID, summary };
}

// ── The reader ────────────────────────────────────────────────────────────────

export function assessNarrowR(
  log: MicaReadableLog,
  config?: NarrowRConfig
): NarrowRResult {
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
    NARROW_R_SENSOR_ID,
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
      verdict: cannotAssess(NARROW_R_SENSOR_ID, [
        {
          class: "MISSING_CONFIGURATION",
          detail:
            "no usable declaredProfile was injected (absent, empty, or not a list " +
            "of non-empty strings). narrow-R holds no profile of its own, derives " +
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

export const NARROW_R_SCOPE_TITLE =
  "MICA/narrow-R — declared-profile book shape + verification-context signature";

export const NARROW_R_SCOPE_READS: readonly string[] = [
  "the declared record's eventType   — leg 1: matched against the INJECTED",
  "                          profile of expected verification classes, presence",
  "                          only; leg 2: the eventType of a profile-member record",
  "                          is its VERIFICATION class V",
  "the declared record's moduleId    — leg 2 only: with eventType, the (moduleId,",
  "                          eventType) of a NON-profile record is a CONTEXT class X",
  "the declared record's sequenceNumber — leg 2 ONLY, and for PAIRING ORDER ONLY.",
  "                          It pairs each verification record with the nearest",
  "                          preceding non-verification record. Not read as a value.",
  "the DERIVED PARTITION      — profile membership -> verification (V); the",
  "                          complement -> surrounding event activity, read as",
  "                          context (X). There is NO second declared list (option A).",
  "the log's own verify()        — readability gate ONLY, never the finding",
  "the log's own getLoadState()  — readability gate only",
];

export const NARROW_R_SCOPE_DOES_NOT_SEE: readonly string[] = [
  "WHETHER A PRESENT VERIFICATION WAS REAL (leg 1). narrow-R reads PRESENCE of an",
  "  eventType, not the verification behind it. A faker that emits the expected",
  "  class without doing the verification reads leg-1 SILENT. Leg 1 catches the",
  "  CARELESS non-faker who did not emit the class; not the faker who did.",
  "THE STRATEGIC FAKER (leg 2 — the LOOKUP DEFEAT). A faker emitting",
  "  context-correlated verification via a class-keyed lookup table reads leg-2",
  "  SILENT. At the ceiling a real verifier and a lookup table produce the",
  "  IDENTICAL record; the evidence separating them lives WITHIN a class, and leg 2",
  "  resolves only at class granularity. A T1 collapse detector, stated, not T2.",
  "INTERLEAVING IS NOT CAUSALITY (leg 2). The pairing reads the record's own order",
  "  by sequenceNumber. A system that verifies at a temporal distance from its",
  "  context reads as decoupled. Named design choice.",
  "A SINGLE-VERIFICATION-CLASS PROFILE (leg 2). A profile declaring one class gives",
  "  H(V)=0 and makes leg 2 PERMANENTLY ineligible (CANNOT_ASSESS). A within-class",
  "  occurrence read is future work, an accepted open edge, not here.",
  "AMBIENT-NOISE DILUTION OF THE CONTEXT (leg 2, option-A). The context is the",
  "  profile's COMPLEMENT — surrounding event activity, some of which may be",
  "  operational noise. That dilution weakens the statistic; it is PRINTED here,",
  "  not hidden, a stated consequence of deriving context from the complement",
  "  rather than from a second declared list, and it is ruled, not overlooked.",
  "CROSS-FACTOR CONTEXT OVERLAP (leg 2). Where a deployment runs BOTH narrow-W and",
  "  narrow-R, each factor's context includes the other's profile classes. They are",
  "  INDEPENDENT readers; this is expected and is noted, not fixed.",
  "VERIFICATION DEPTH, QUALITY, RIGOR, OR TRUTH (leg 2, the D-06 family). Leg 2",
  "  reads a statistical dependency between two recorded fields. The claim at SILENT",
  "  is that the verification-class stream carries structure relative to adjacent",
  "  event classes, beyond a reshuffle — nothing about whether any verification was",
  "  real or good.",
  "THE GRAMMAR THIS READER LEANS ON. The absent/vacuous-profile -> CANNOT_ASSESS",
  "  rule is the EIGHTH site of one arbiter-ruled resolution (vacuity-scales-the-",
  "  claim). Whether that is one grammar applied consistently or a single point the",
  "  whole offer leans on is an OPEN question under standing panel review (ruled",
  "  2026-08-18). Printed so the dependence is visible, not blessed.",
  "COMPLETENESS. narrow-R checks correspondence to the DECLARED profile only. A",
  "  profile that omits a verification that matters is a blind spot narrow-R cannot",
  "  see — it holds no profile of its own and cannot know what was left out.",
  "THE PROFILE ITSELF. It is INJECTED by the deployer, derived from nothing, and",
  "  mandated nowhere. Absent or vacuous, narrow-R reads CANNOT_ASSESS — never a",
  "  trivially-satisfied SILENT.",
  "SYSTEMIC HARM. narrow-R is a book-shape + signature reader, not a harm reader.",
  "  Its silence is the absence of two findings over one declared profile, and",
  "  nothing wider.",
];

export function narrowRScopeBlockText(
  readableLoadStates?: readonly string[]
): string {
  return formatScopeBlock(
    NARROW_R_SCOPE_TITLE,
    NARROW_R_SCOPE_READS,
    NARROW_R_SCOPE_DOES_NOT_SEE,
    NARROW_R_COMPETENCE_LINES,
    loadStateScopeLines(readableLoadStates)
  );
}

export function printNarrowRScope(readableLoadStates?: readonly string[]): void {
  printScopeBlock(
    NARROW_R_SCOPE_TITLE,
    NARROW_R_SCOPE_READS,
    NARROW_R_SCOPE_DOES_NOT_SEE,
    NARROW_R_COMPETENCE_LINES,
    loadStateScopeLines(readableLoadStates)
  );
}
