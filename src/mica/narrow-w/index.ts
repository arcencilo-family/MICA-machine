// ── MICA · narrow-W — the book-shape reader, now with the correlation leg ─────
//
// narrow-W emits ONE SensorVerdict, composed from TWO legs by a worst-of floor.
//
// ── LEG 1 · BOOK SHAPE (unchanged) ────────────────────────────────────────────
//
//   Given a DEPLOYER-DECLARED PROFILE of expected inquiry classes, it checks the
//   record for their PRESENCE IN SCOPE. Each expected class is an `eventType`
//   value; "present" means at least one record in the readable scope carries it.
//
//     all declared classes present  -> leg-1 SILENT
//     any declared class absent      -> leg-1 ALARM   (a bound is lowered)
//
//   Leg 1 is a BOOK-SHAPE reader: does the record contain the inquiry classes the
//   deployer declared? It catches the CARELESS NON-FAKER — the system that did not
//   emit an expected class. It goes SILENT against the FAKER who emits the class
//   WITHOUT the inquiry behind it: an eventType is a string the observed party
//   writes, and its presence is not proof the inquiry happened. Leg 1 attests
//   CORRESPONDENCE TO THE NAMED PROFILE ONLY — never completeness, never truth.
//
// ── LEG 2 · INQUIRY-CONTEXT SIGNATURE (this build, D-12) ─────────────────────
//
//   Leg 2 asks a different question: does the inquiry-class stream carry
//   STATISTICAL STRUCTURE relative to the surrounding event activity, or has it
//   decoupled — templated, batched, or degraded into noise?
//
//   The mechanism is ENG'S STATISTIC RE-AIMED (../stat/ami). Leg 2 computes the
//   adjusted mutual information between:
//
//     I — INQUIRY CLASS:   the `eventType` of each record whose `eventType` is in
//                          the injected declaredProfile;
//     X — CONTEXT CLASS:   the (moduleId, eventType) of the NEAREST PRECEDING
//                          NON-INQUIRY record, by sequenceNumber.
//
//   THE TWO FAILURE DIRECTIONS (Eng's two-arm property, re-aimed). Both flatten
//   the SAME statistic toward zero, or leg 2 catches half the failure mode:
//
//     THEATRE       — inquiry emitted uniformly/batched regardless of context.
//     DEGRADATION   — inquiry decoupled from activity through neglect.
//
//   Collapse (low AMI) = inquiry emission independent of surrounding activity, in
//   excess of what a reshuffle of the same table would produce. The only way off
//   the floor is inquiry that actually tracks the surrounding activity — which is
//   the thing itself.
//
//   THE CEILING (A5 sibling). A maximal AMI is NOT health. A perfectly regimented
//   inquirer and a class-keyed LOOKUP TABLE (read the context label, emit the
//   canned inquiry class) print the IDENTICAL record. The evidence that separates
//   them lives WITHIN a class and leg 2 resolves only at class granularity, so at
//   the ceiling it has no evidence to choose. Within the injected ceiling margin
//   of the maximum -> CANNOT_ASSESS, never SILENT and never ALARM. Absent a
//   margin, the check DOES NOT RUN and every leg-2 verdict says so.
//
//   VOCABULARY DISCIPLINE (arbiter-ruled, option A, 2026-08-18). The object is an
//   INQUIRY-CONTEXT SIGNATURE — never "inquiry tracking decisions", never
//   "engagement with decisions". THE CONTEXT IS DERIVED FROM THE PROFILE'S
//   COMPLEMENT: it is SURROUNDING EVENT ACTIVITY, some of which may be operational
//   noise. That dilution is a PRINTED COST, not a hidden one; there is NO second
//   declared list. The claim at leg-2 SILENT is exactly: the inquiry-class stream
//   carries statistical structure relative to adjacent event classes, beyond a
//   reshuffle of the same table. Nothing wider — NO claim about inquiry QUALITY,
//   DEPTH, or TRUTH.
//
//   T1 ONLY. Leg 2 is a collapse detector. It is FALSE-SILENT against the
//   strategic faker who emits context-correlated inquiry via a table read; that
//   defeat is the ceiling, and it is printed, exactly as leg 1 prints its own.
//
// ── THE PAIRING — the first MICA read ACROSS records ──────────────────────────
//
//   Leg 2 is the first MICA reader to pair one ENTRY with the entry before it
//   (Eng reads each entry's fields in isolation and does not read sequenceNumber;
//   leg 2 reads sequenceNumber for ordering ONLY). It is NOT cross-READER: leg 2
//   consumes no other instrument's output, and narrow-W still emits exactly one
//   SensorVerdict. Reader independence holds; the chokepoint alone composes
//   overall substrate health. Fixed by design, printed, not injected:
//
//     · each inquiry record pairs with the NEAREST PRECEDING non-inquiry record's
//       (moduleId, eventType) as its context class;
//     · ORPHAN inquiries (no preceding non-inquiry record — e.g. inquiries batched
//       at chain start) are COUNTED, EXCLUDED FROM THE TABLE, and PRINTED. A high
//       orphan fraction is informative to a human reader but attaches to NO
//       verdict rule in this build (report-only, Eng-A4 style);
//     · INTERLEAVING IS NOT CAUSALITY. The pairing reads the record's own order; a
//       system that emits real inquiry at a temporal distance from its context
//       reads as decoupled. Design choice, named, not smuggled.
//
// ── LEG COMPOSITION — worst of the two legs ───────────────────────────────────
//
//   narrow-W's single verdict = worst(leg 1, leg 2), by ALARM > CANNOT_ASSESS >
//   SILENT, findings concatenated, both legs' summaries represented. Leg 1's
//   behaviour IN ISOLATION is unchanged.
//
//   NAMED CONSEQUENCE: a caller injecting ONLY leg-1 config now composes
//   worst(leg1, CANNOT_ASSESS) = CANNOT_ASSESS, because an unconfigured
//   verdict-bearing read is BLINDNESS, not a suppressed diagnostic. Silence is
//   never safety; a leg that cannot read is blind. This is intended and it breaks
//   existing narrow-W expectations that injected no correlation config. (The Eng
//   OPTIONAL pattern — absence suppresses a check and the output says so —
//   governs the ceiling margin and the permutation diagnostic, which are
//   report-only. It does NOT govern the whole read.)
//
// ── THE PROFILE IS INJECTED — OPTION-B, THE LOAD-STATE-GATE PRECEDENT ──────────
//
//   The declared profile follows the SAME discipline as readableLoadStates
//   (../types, assessLogReadability): a list INJECTED by the deployer, with NO
//   FALLBACK and NO DEFAULT. narrow-W never derives the profile from moduleId or
//   eventType, and never mandates one. Absent, empty, or not a list of non-empty
//   strings -> CANNOT_ASSESS (MISSING_CONFIGURATION), BEFORE any leg runs.
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
import { NARROW_W_COMPETENCE_LINES } from "../competence";
import { AMI_MAXIMUM, pairedStructure } from "../stat/ami";
import type { PairedStructure } from "../stat/ami";

export const NARROW_W_SENSOR_ID = "MICA/narrow-W";

// ── Configuration — injected, never defaulted ─────────────────────────────────

export interface NarrowWConfig {
  /**
   * The load states this deployment considers readable. INJECTED — no default,
   * no fallback (the ../types load-state gate). Absent/unusable -> CANNOT_ASSESS
   * and no reading is offered.
   */
  readableLoadStates?: readonly string[];
  /**
   * The declared W influence profile: the expected inquiry classes, each an
   * `eventType` value the record is checked for. INJECTED, OPTION-B: no default,
   * no fallback. Absent, empty, or not a list of non-empty strings ->
   * CANNOT_ASSESS (MISSING_CONFIGURATION). narrow-W derives this from nothing.
   *
   * The SAME list drives both legs: leg 1 checks presence of these classes; leg
   * 2's INQUIRY partition is exactly these classes, and its CONTEXT partition is
   * everything else (option A — no second declared list).
   */
  declaredProfile?: readonly string[];
  /**
   * LEG 2. Adjusted mutual information below this alarms. REQUIRED FOR LEG 2. No
   * default, no range imposed (calibration belongs to pilot data). Absent or not
   * finite -> leg 2 CANNOT_ASSESS (MISSING_CONFIGURATION).
   */
  correlationThreshold?: number;
  /**
   * LEG 2. Paired-inquiry count below which the read is not attempted. REQUIRED
   * FOR LEG 2, a non-negative integer. Absent/unusable -> leg 2 CANNOT_ASSESS
   * (MISSING_CONFIGURATION).
   */
  correlationMinimumInquiryEvents?: number;
  /**
   * LEG 2. Distance below AMI_MAXIMUM (1) within which the reading counts as AT
   * THE CEILING -> CANNOT_ASSESS (a perfectly regimented inquirer and a
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
 * PRE-PILOT PROXY CALIBRATION (arbiter-requested, 2026-08-18).
 *
 * The code keeps ZERO defaults — every number is injected, Eng-verbatim. But
 * deployments and tests need real numbers before pilot data exists. These are
 * the STARTING CONFIGURATION and are marked, here and at every appearance, as
 * PRE-PILOT PROXY, SUBJECT TO CALIBRATION. They are NOT defaults: nothing in
 * this module reads this constant, and a caller who wants these values must
 * inject them, deliberately, by name or by value.
 *
 *   correlationThreshold: 0.05           — AMI is normalized ~0..1; below
 *     one-twentieth of maximal structure is indistinguishable-from-reshuffle
 *     territory. Conservative: alarms on near-total decoupling (the theatre arm
 *     lands at AMI≈0 by construction), stays quiet mid-band where a proxy has no
 *     business judging.
 *   correlationMinimumInquiryEvents: 30  — small-sample rule of thumb; below ~30
 *     paired inquiry events the permutation model dominates the table.
 *   correlationCeilingMargin: 0.02       — within 2% of the maximum counts as at
 *     the ceiling (lookup-table territory -> CANNOT_ASSESS).
 *   correlationPermutationSamples: 1000  — report-only diagnostic.
 *   correlationPermutationSeed: 20260818 — report-only diagnostic.
 */
export const NARROW_W_LEG2_PROXY_CALIBRATION = {
  correlationThreshold: 0.05,
  correlationMinimumInquiryEvents: 30,
  correlationCeilingMargin: 0.02,
  correlationPermutationSamples: 1000,
  correlationPermutationSeed: 20260818,
  provenance:
    "PRE-PILOT PROXY, subject to calibration. These are STARTING values, not " +
    "defaults; the code reads no default and this constant is injected by name, " +
    "never consulted internally.",
} as const;

/** The correspondence/completeness/inquiry limit (leg 1), printed in the output. */
export const W_CORRESPONDENCE_ONLY =
  "narrow-W leg 1 attests CORRESPONDENCE TO THE NAMED PROFILE ONLY. A declared " +
  "inquiry class that is PRESENT reads SILENT even if the inquiry was faked — an " +
  "`eventType` is a string the observed party writes, and its presence is not " +
  "proof the inquiry happened. Leg 1 catches the CARELESS non-faker who did not " +
  "emit the expected class; it goes SILENT against a faker who emits the class " +
  "without real inquiry. It claims NO completeness: a profile can omit inquiries " +
  "that matter, and this reader cannot know what was left out.";

/** The lookup defeat (leg 2), printed in leg-2 SILENT/ALARM summaries. */
export const W_INQUIRY_CONTEXT_LOOKUP_DEFEAT =
  "Leg 2 reads a T1 COLLAPSE only. A strategic faker that emits " +
  "context-correlated inquiry via a class-keyed LOOKUP TABLE — read the context " +
  "label, emit the canned inquiry class — reads SILENT: at the ceiling a real " +
  "inquirer and a lookup table produce the identical record, and the evidence " +
  "that separates them lives WITHIN a class, which leg 2 does not resolve. This " +
  "is a stated ceiling, not a clean pass.";

/** Where the calibration numbers come from — echoed wherever leg 2 prints one. */
export const W_LEG2_CALIBRATION_PROVENANCE =
  "Calibration is INJECTED and comes from pilot data this sensor has never seen; " +
  "this reader holds no default and cannot vouch for the value. Where this " +
  "project supplies STARTING numbers (NARROW_W_LEG2_PROXY_CALIBRATION) they are " +
  "PRE-PILOT PROXY, subject to calibration.";

/** The ceiling-not-performed note (leg 2), printed when no margin was injected. */
export const W_LEG2_CEILING_NOT_PERFORMED_NOTE =
  "The LEG-2 CEILING CHECK DID NOT RUN: no correlationCeilingMargin was injected. " +
  "A reading at or near the maximum is evidence-free rather than healthy (a real " +
  "inquirer and a class-keyed lookup table produce the identical record), and " +
  "without a margin this leg cannot tell whether this reading is one of those. " +
  "Treat this verdict as not having been checked for that condition.";

export interface InquiryPresence {
  readonly inquiryClass: string;
  readonly present: boolean;
  /** Number of records in scope carrying this eventType. */
  readonly count: number;
}

export type CeilingCheckStatus = "PERFORMED" | "NOT_PERFORMED";

/**
 * Leg-2 detail carried on the result so a consumer can print the statistic
 * without recomputing it. `structure` maps onto leg 2's two variables:
 *   entropyLeft / distinctLeft / hasRepeatedLeft  → INQUIRY class I
 *   entropyRight / distinctRight / hasRepeatedRight → CONTEXT class X
 * Present (non-null) whenever the pairing was attempted, even when a later gate
 * stopped the read; null only when leg 2 could not run at all (missing config).
 */
export interface NarrowWCorrelation {
  /** Leg 2's own verdict kind, before composition. */
  readonly legVerdictKind: VerdictKind;
  /** The AMI structure over the paired (inquiry, context) table, or null. */
  readonly structure: PairedStructure | null;
  /** Whether the ceiling check ran at all. */
  readonly ceilingCheck: CeilingCheckStatus;
  /** Inquiry records paired with a preceding context (the table's rows). */
  readonly pairedCount: number;
  /** Inquiry records with NO preceding non-inquiry record. Excluded, counted. */
  readonly orphanCount: number;
  /** pairedCount + orphanCount — every inquiry record leg 2 saw. */
  readonly totalInquiryRecords: number;
}

export interface NarrowWResult {
  readonly verdict: SensorVerdict;
  /** The readable load states this run was told to trust, or null. */
  readonly readableLoadStates: readonly string[] | null;
  /** The declared profile this run checked, or null when none was usable. */
  readonly declaredProfile: readonly string[] | null;
  /** Per-class presence over the readable scope (leg 1). Empty when stopped. */
  readonly presence: readonly InquiryPresence[];
  /** Leg-2 detail, or null when leg 2 never ran (blind before the legs). */
  readonly correlation: NarrowWCorrelation | null;
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

/** Context key for a non-inquiry record. Both components are typed fields. */
/** Context key for a non-inquiry record — shared, collision-proof (F4). */
function contextKey(entry: MicaLogRecord): string {
  // Shared collision-proof, length-prefixed tuple key (F4) — one home for W/R/K,
  // so the siblings cannot drift and no delimiter is assumed forbidden.
  return contextTupleKey(entry);
}

// ── Leg 1 · book shape ────────────────────────────────────────────────────────

function assessBookShape(
  entries: readonly MicaLogRecord[],
  declaredProfile: readonly string[]
): { verdict: SensorVerdict; presence: InquiryPresence[] } {
  const counts = new Map<string, number>();
  for (const e of entries) {
    counts.set(e.eventType, (counts.get(e.eventType) ?? 0) + 1);
  }

  // Deduplicate the declared classes: a profile listing a class twice asks one
  // question, not two.
  const classes = [...new Set(declaredProfile)];
  const presence: InquiryPresence[] = classes.map((inquiryClass) => {
    const count = counts.get(inquiryClass) ?? 0;
    return { inquiryClass, present: count > 0, count };
  });

  const absent = presence.filter((p) => !p.present);
  const scopeNote =
    `profile [${renderProfile(declaredProfile)}] over ${entries.length} record(s); ` +
    `present: ${presence.filter((p) => p.present).length}/${presence.length}`;

  if (absent.length > 0) {
    const findings: Finding[] = absent.map((p) => ({
      code: "W_INQUIRY_CLASS_ABSENT",
      detail:
        `declared-expected inquiry class \`${p.inquiryClass}\` does not appear as ` +
        `an eventType in any of the ${entries.length} readable record(s). The ` +
        `book-shape the deployer declared is not satisfied: an expected inquiry ` +
        `class is missing from scope. This catches the CARELESS non-faker; it says ` +
        `nothing about a faker who WOULD have emitted the class.`,
    }));
    return {
      verdict: alarm(
        NARROW_W_SENSOR_ID,
        `A declared-expected inquiry class is absent from the record. Leg 1 is ` +
          `a book-shape reader over the INJECTED profile; ${scopeNote}. ` +
          `${W_CORRESPONDENCE_ONLY}`,
        findings
      ),
      presence,
    };
  }

  return {
    verdict: {
      kind: "SILENT",
      sensorId: NARROW_W_SENSOR_ID,
      summary:
        `Every declared-expected inquiry class is present in scope (${scopeNote}). ` +
        `${W_CORRESPONDENCE_ONLY} ${SILENCE_IS_NOT_HEALTH}`,
    },
    presence,
  };
}

// ── Leg 2 · inquiry-context signature ─────────────────────────────────────────

function assessCorrelation(
  entries: readonly MicaLogRecord[],
  declaredProfile: readonly string[],
  config: NarrowWConfig | undefined
): { verdict: SensorVerdict; correlation: NarrowWCorrelation | null } {
  const threshold = config?.correlationThreshold;
  const minimum = config?.correlationMinimumInquiryEvents;
  const ceilingMargin = config?.correlationCeilingMargin;
  const ceilingUsable =
    typeof ceilingMargin === "number" &&
    Number.isFinite(ceilingMargin) &&
    ceilingMargin >= 0;
  const ceilingCheck: CeilingCheckStatus = ceilingUsable
    ? "PERFORMED"
    : "NOT_PERFORMED";

  // ── Required configuration. An unconfigured verdict-bearing read is BLINDNESS,
  //    not a suppressed diagnostic (ruled 2026-08-18). ──────────────────────────
  const missing: BlindPath[] = [];
  if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
    missing.push({
      class: "MISSING_CONFIGURATION",
      detail:
        "correlationThreshold was not injected as a finite number. Leg 2 is a " +
        "verdict-bearing read, and an unconfigured verdict-bearing read is " +
        "blindness — NOT a suppressed diagnostic and NOT a satisfied profile. " +
        "There is no default: a default threshold is a calibration constant, and " +
        `calibration is not this build's to make. ${W_LEG2_CALIBRATION_PROVENANCE}`,
    });
  }
  if (typeof minimum !== "number" || !Number.isInteger(minimum) || minimum < 0) {
    missing.push({
      class: "MISSING_CONFIGURATION",
      detail:
        "correlationMinimumInquiryEvents was not injected as a non-negative " +
        "integer. There is no default. Leg 2 cannot decide how many paired " +
        "inquiry records make the permutation model usable without being told.",
    });
  }
  if (missing.length > 0) {
    return {
      verdict: cannotAssess(NARROW_W_SENSOR_ID, missing),
      correlation: null,
    };
  }

  // ── The pairing — the one read ACROSS records ──────────────────────────────
  //
  // Walk in sequenceNumber order. A record whose eventType is in the profile is
  // an INQUIRY record; every other record is CONTEXT and updates the running
  // "nearest preceding context". An inquiry with no preceding context is an
  // ORPHAN: counted, excluded from the table, printed. Never silently dropped.
  const declaredSet = new Set(declaredProfile);
  const ordered = [...entries].sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber
  );
  let lastContext: string | null = null;
  const inquiryKeys: string[] = [];
  const contextKeys: string[] = [];
  let orphanCount = 0;
  for (const e of ordered) {
    if (declaredSet.has(e.eventType)) {
      if (lastContext === null) {
        orphanCount++;
      } else {
        inquiryKeys.push(e.eventType);
        contextKeys.push(lastContext);
      }
    } else {
      lastContext = contextKey(e);
    }
  }
  const pairedCount = inquiryKeys.length;
  const totalInquiryRecords = pairedCount + orphanCount;

  const structure = pairedStructure(inquiryKeys, contextKeys, {
    samples: config?.correlationPermutationSamples,
    seed: config?.correlationPermutationSeed,
  });

  const orphanNote =
    `${orphanCount} orphan inquiry record(s) (no preceding non-inquiry context) ` +
    `were counted and EXCLUDED from the table (report-only; no verdict rule).`;

  const mk = (
    legVerdictKind: VerdictKind
  ): NarrowWCorrelation => ({
    legVerdictKind,
    structure,
    ceilingCheck,
    pairedCount,
    orphanCount,
    totalInquiryRecords,
  });

  // ── Insufficient sample (paired count, not total inquiries) ────────────────
  if (pairedCount < (minimum as number)) {
    return {
      verdict: cannotAssess(NARROW_W_SENSOR_ID, [
        {
          class: "INSUFFICIENT_SAMPLE",
          detail:
            `only ${pairedCount} inquiry record(s) paired with a preceding ` +
            `context; injected correlationMinimumInquiryEvents is ` +
            `${String(minimum)}. ${orphanNote} Below the minimum the permutation ` +
            `model dominates the table, so the read is not attempted.`,
        },
      ]),
      correlation: mk("CANNOT_ASSESS"),
    };
  }

  // ── Scope eligibility — arity conditions, not thresholds ───────────────────
  //
  // Below these the question "does the inquiry class track the context class?"
  // is not false, it is undefined.
  if (structure.distinctLeft < 2) {
    return {
      verdict: cannotAssess(NARROW_W_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `only ${structure.distinctLeft} distinct inquiry class(es) among the ` +
            `${pairedCount} paired record(s). A profile declaring a SINGLE inquiry ` +
            `class makes leg 2 PERMANENTLY ineligible: H(I)=0, so the dependence of ` +
            `inquiry on context is undefined. This is an ACCEPTED OPEN EDGE — a ` +
            `within-class occurrence read is future work, not smuggled in here.`,
        },
      ]),
      correlation: mk("CANNOT_ASSESS"),
    };
  }
  if (structure.distinctRight < 2) {
    return {
      verdict: cannotAssess(NARROW_W_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `only ${structure.distinctRight} distinct context class(es) among the ` +
            `${pairedCount} paired record(s). Without at least two contexts to be ` +
            `different from each other, dependence of inquiry on context is ` +
            `unaskable.`,
        },
      ]),
      correlation: mk("CANNOT_ASSESS"),
    };
  }
  if (!structure.hasRepeatedRight) {
    return {
      verdict: cannotAssess(NARROW_W_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `every one of the ${structure.distinctRight} context classes occurs ` +
            `exactly once among the ${pairedCount} paired record(s). No context has ` +
            `a conditional inquiry distribution, so there is nothing for the ` +
            `statistic to compare.`,
        },
      ]),
      correlation: mk("CANNOT_ASSESS"),
    };
  }
  if (structure.ami === null) {
    return {
      verdict: cannotAssess(NARROW_W_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `the adjusted-mutual-information denominator max(H(I),H(X)) - E[MI] is ` +
            `not positive (H(I)=${structure.entropyLeft.toFixed(6)}, ` +
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
  // no evidence behind it (the lookup defeat lands exactly here). NOT ALARM: the
  // real inquirer may be working flawlessly.
  if (ceilingUsable && structure.ami >= AMI_MAXIMUM - (ceilingMargin as number)) {
    return {
      verdict: cannotAssess(NARROW_W_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `AMI=${structure.ami.toFixed(6)} is at the ceiling: within the injected ` +
            `correlationCeilingMargin of ${String(ceilingMargin)} below the maximum ` +
            `${AMI_MAXIMUM}. At the ceiling the inquiry class is fully determined by ` +
            `the context class, and A REAL INQUIRER AND A CLASS-KEYED LOOKUP TABLE ` +
            `PRODUCE THE IDENTICAL RECORD. The evidence that would separate them ` +
            `lives WITHIN a class and leg 2 resolves only at class granularity. This ` +
            `is not a high score, it is an absence of evidence, and it is ` +
            `deliberately NOT an alarm. ${W_LEG2_CALIBRATION_PROVENANCE}`,
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
    `over ${pairedCount} paired inquiry record(s), ${structure.distinctLeft} ` +
    `inquiry class(es) against ${structure.distinctRight} context class(es) ` +
    `[plug-in MI=${structure.mutualInformation.toFixed(6)}, ` +
    `E[MI]=${structure.expectedMutualInformation.toFixed(6)}, ` +
    `H(I)=${structure.entropyLeft.toFixed(6)}, ` +
    `H(X)=${structure.entropyRight.toFixed(6)}]. ${orphanNote}`;

  // ── The read — strictly below the injected threshold alarms ────────────────
  if (structure.ami < (threshold as number)) {
    return {
      verdict: alarm(
        NARROW_W_SENSOR_ID,
        `Leg 2 (inquiry-context signature): the inquiry-class stream is NOT ` +
          `carrying information about the surrounding event activity beyond what a ` +
          `reshuffle of the same table would produce. Both the THEATRE arm ` +
          `(uniform/batched inquiry) and the DEGRADATION arm (inquiry decoupled ` +
          `through neglect) flatten this statistic. This states a property of the ` +
          `record — no claim about inquiry QUALITY, DEPTH, or TRUTH. ` +
          `${W_INQUIRY_CONTEXT_LOOKUP_DEFEAT} ${W_LEG2_CALIBRATION_PROVENANCE}`,
        [
          {
            code: "W_INQUIRY_CONTEXT_COLLAPSE",
            detail:
              `AMI=${structure.ami.toFixed(6)} < injected correlationThreshold=` +
              `${String(threshold)} ${statNote}${permNote}` +
              (ceilingUsable ? "" : ` ${W_LEG2_CEILING_NOT_PERFORMED_NOTE}`),
          },
        ]
      ),
      correlation: mk("ALARM"),
    };
  }

  return {
    verdict: {
      kind: "SILENT",
      sensorId: NARROW_W_SENSOR_ID,
      summary:
        `Leg 2 (inquiry-context signature): AMI=${structure.ami.toFixed(6)} >= ` +
        `injected correlationThreshold=${String(threshold)} ${statNote}` +
        `${structure.permutation === null ? "" : permNote} ` +
        `${W_INQUIRY_CONTEXT_LOOKUP_DEFEAT} ${W_LEG2_CALIBRATION_PROVENANCE}` +
        (ceilingUsable ? "" : ` ${W_LEG2_CEILING_NOT_PERFORMED_NOTE}`) +
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
 * narrow-W's single verdict = worst(leg 1, leg 2), by ALARM > CANNOT_ASSESS >
 * SILENT. Findings concatenated, blind paths concatenated, BOTH legs' summaries
 * represented in the composite summary. When the worst kind is ALARM, a leg that
 * is CANNOT_ASSESS contributes only its summary text (an ALARM carries no blind
 * paths); its structured detail is always available on result.correlation.
 */
function composeVerdicts(
  leg1: SensorVerdict,
  leg2: SensorVerdict
): SensorVerdict {
  const worstKind: VerdictKind =
    rankOf(leg1.kind) >= rankOf(leg2.kind) ? leg1.kind : leg2.kind;

  const summary =
    `narrow-W composes TWO legs by the worst-of floor ` +
    `(ALARM > CANNOT_ASSESS > SILENT); both are represented below. ` +
    `|| [LEG 1 book-shape / ${leg1.kind}] ${leg1.summary} ` +
    `|| [LEG 2 inquiry-context / ${leg2.kind}] ${leg2.summary}`;

  if (worstKind === "ALARM") {
    const findings: Finding[] = [
      ...(leg1.kind === "ALARM" ? leg1.findings : []),
      ...(leg2.kind === "ALARM" ? leg2.findings : []),
    ];
    return { kind: "ALARM", sensorId: NARROW_W_SENSOR_ID, summary, findings };
  }
  if (worstKind === "CANNOT_ASSESS") {
    const blindPaths: BlindPath[] = [
      ...(leg1.kind === "CANNOT_ASSESS" ? leg1.blindPaths : []),
      ...(leg2.kind === "CANNOT_ASSESS" ? leg2.blindPaths : []),
    ];
    return {
      kind: "CANNOT_ASSESS",
      sensorId: NARROW_W_SENSOR_ID,
      summary,
      blindPaths,
    };
  }
  return { kind: "SILENT", sensorId: NARROW_W_SENSOR_ID, summary };
}

// ── The reader ────────────────────────────────────────────────────────────────

export function assessNarrowW(
  log: MicaReadableLog,
  config?: NarrowWConfig
): NarrowWResult {
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
    NARROW_W_SENSOR_ID,
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
      verdict: cannotAssess(NARROW_W_SENSOR_ID, [
        {
          class: "MISSING_CONFIGURATION",
          detail:
            "no usable declaredProfile was injected (absent, empty, or not a list " +
            "of non-empty strings). narrow-W holds no profile of its own, derives " +
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

export const NARROW_W_SCOPE_TITLE =
  "MICA/narrow-W — declared-profile book shape + inquiry-context signature";

export const NARROW_W_SCOPE_READS: readonly string[] = [
  "the declared record's eventType   — leg 1: matched against the INJECTED",
  "                          profile of expected inquiry classes, presence only;",
  "                          leg 2: the eventType of a profile-member record is",
  "                          its INQUIRY class I",
  "the declared record's moduleId    — leg 2 only: with eventType, the (moduleId,",
  "                          eventType) of a NON-profile record is a CONTEXT class X",
  "the declared record's sequenceNumber — leg 2 ONLY, and for PAIRING ORDER ONLY.",
  "                          narrow-W is the first MICA reader to read it; it pairs",
  "                          each inquiry record with the nearest preceding",
  "                          non-inquiry record. It is not read as a value.",
  "the DERIVED PARTITION      — profile membership -> inquiry (I); the complement",
  "                          -> surrounding event activity, read as context (X).",
  "                          There is NO second declared list (option A).",
  "the log's own verify()        — readability gate ONLY, never the finding",
  "the log's own getLoadState()  — readability gate only",
];

export const NARROW_W_SCOPE_DOES_NOT_SEE: readonly string[] = [
  "WHETHER A PRESENT INQUIRY WAS REAL (leg 1). narrow-W reads PRESENCE of an",
  "  eventType, not the inquiry behind it. A faker that emits the expected class",
  "  without doing the inquiry reads leg-1 SILENT. Leg 1 catches the CARELESS",
  "  non-faker who did not emit the class; it does not catch the faker who did.",
  "THE STRATEGIC FAKER (leg 2 — the LOOKUP DEFEAT). A faker emitting",
  "  context-correlated inquiry via a class-keyed lookup table reads leg-2 SILENT.",
  "  At the ceiling a real inquirer and a lookup table produce the IDENTICAL",
  "  record; the evidence separating them lives WITHIN a class, and leg 2 resolves",
  "  only at class granularity. This is a T1 collapse detector, stated, not T2.",
  "INTERLEAVING IS NOT CAUSALITY (leg 2). The pairing reads the record's own",
  "  order by sequenceNumber. A system that emits real inquiry at a temporal",
  "  distance from its context reads as decoupled. Named design choice.",
  "A SINGLE-INQUIRY-CLASS PROFILE (leg 2). A profile declaring one inquiry class",
  "  gives H(I)=0 and makes leg 2 PERMANENTLY ineligible (CANNOT_ASSESS). A",
  "  within-class occurrence read is future work, an accepted open edge, not here.",
  "AMBIENT-NOISE DILUTION OF THE CONTEXT (leg 2, option-A cost). The context is",
  "  the profile's COMPLEMENT — surrounding event activity, some of which may be",
  "  operational noise. That dilution weakens the statistic; it is a PRINTED cost",
  "  of deriving context from the complement rather than from a second declared",
  "  list, and it is ruled, not overlooked.",
  "INQUIRY DEPTH, QUALITY, OR TRUTH (leg 2, the D-06 family). Leg 2 reads a",
  "  statistical dependency between two recorded fields. The claim at SILENT is",
  "  that the inquiry-class stream carries structure relative to adjacent event",
  "  classes, beyond a reshuffle — nothing about whether any inquiry was good.",
  "COMPLETENESS. narrow-W checks correspondence to the DECLARED profile only. A",
  "  profile that omits an inquiry that matters is a blind spot narrow-W cannot",
  "  see — it holds no profile of its own and cannot know what was left out.",
  "THE PROFILE ITSELF. It is INJECTED by the deployer, derived from nothing, and",
  "  mandated nowhere. Absent or vacuous, narrow-W reads CANNOT_ASSESS — never a",
  "  trivially-satisfied SILENT.",
  "SYSTEMIC HARM. narrow-W is a book-shape + signature reader, not a harm reader.",
  "  Its silence is the absence of two findings over one declared profile, and",
  "  nothing wider.",
];

export function narrowWScopeBlockText(
  readableLoadStates?: readonly string[]
): string {
  return formatScopeBlock(
    NARROW_W_SCOPE_TITLE,
    NARROW_W_SCOPE_READS,
    NARROW_W_SCOPE_DOES_NOT_SEE,
    NARROW_W_COMPETENCE_LINES,
    loadStateScopeLines(readableLoadStates)
  );
}

export function printNarrowWScope(readableLoadStates?: readonly string[]): void {
  printScopeBlock(
    NARROW_W_SCOPE_TITLE,
    NARROW_W_SCOPE_READS,
    NARROW_W_SCOPE_DOES_NOT_SEE,
    NARROW_W_COMPETENCE_LINES,
    loadStateScopeLines(readableLoadStates)
  );
}
