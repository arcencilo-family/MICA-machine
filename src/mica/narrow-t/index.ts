// ── MICA · narrow-T — the dispositional-drift reader (factor T, D-14) ──────────
//
// narrow-T is the FIFTH Eng-sibling. It re-aims the shared AMI statistic
// (../stat/ami) at ONE new question, read WITHIN A SINGLE RECORD'S OWN ARC,
// TEMPORALLY:
//
//   Has the record's own behavioural signature DRIFTED, over the record's own
//   length, beyond an injected tolerance?
//
// It emits ONE SensorVerdict. There is only ONE leg — no book shape, no declared
// profile, no second declared list — so the leg IS the verdict and blindness
// composes through it directly (missing config -> CANNOT_ASSESS).
//
// ── WHAT IT READS, AND THE ONE THING THAT IS DIFFERENT FROM EVERY SIBLING ──────
//
//   THE SPLIT. The log is cut into an EARLY window and a LATE window by
//   `sequenceNumber` (read for ORDERING ONLY, never as a value). By default the
//   split is the record's structural halves; an injected `temporalWindowSize` — a
//   NUMBER, not a list — overrides it with a fixed window taken from each end
//   (the middle, if any, is counted, excluded from the table, and printed). If a
//   window size is injected and the record is shorter than two such windows, the
//   two windows would overlap and there is nothing to compare: CANNOT_ASSESS,
//   printed.
//
//   THE SIGNATURE. The distribution of the record's OWN event classes
//   C = (moduleId, eventType) — Eng's vocabulary, read straight off the record.
//   Nothing is declared; narrow-T invents no profile and mandates none.
//
//   THE STATISTIC. The adjusted mutual information between WINDOW (a 2-level
//   variable, EARLY vs LATE) and event class C, over the shared ../stat/ami. High
//   dependence means the class distribution DIFFERS by window — the signature
//   moved across the arc — which is DRIFT. Near-zero means the two windows draw
//   from the same distribution — the signature held — which is stability.
//
//   ⚠ THE POLARITY IS INVERTED VS EVERY OTHER SIBLING, AND GETTING IT RIGHT IS THE
//   WHOLE BUILD. In Eng, narrow-W/R/K, LOW AMI is the alarm (structure is health,
//   a collapsed signature is the finding). HERE STRUCTURE IS THE ALARM and
//   FLATNESS IS HEALTH: a stable log reads SILENT, a drifted log reads ALARM. A
//   builder on autopilot wires this backwards. It is stated here, stated in the
//   scope block, and the fixture arms prove it in both directions.
//
// ── THE CEILING — printed loud (F-γ2 + T1) ────────────────────────────────────
//
//   Carried on every verdict, because a reader must not mistake this reader's
//   SILENT for a clean bill of temporal health:
//
//     (i)  SIGNATURE-HOLDING ADVERSARY. A careful adversary that holds its
//          SIGNATURE steady while its substance drifts reads SILENT. T1 catches
//          HONEST and LAZY drift only — a signature that visibly moves — and
//          catches nothing that keeps the observable event-class mix constant
//          while changing underneath it.
//     (ii) DRIFT IS NOT DEGRADATION. Legitimate adaptation drifts the signature
//          too, and it ALARMS. The verdict says the disposition CHANGED BEYOND
//          TOLERANCE. It NEVER says the disposition changed FOR THE WORSE — that
//          is not a reading narrow-T can make, and the alarm must not be read as
//          it.
//     (iii) NO IDENTITY CLAIM (F-γ2). "Is it the same system" is not truth-apt
//          from this read position; the claim carries its vantage,
//          Fair-Witness-scoped. The object narrow-T reads is a DISPOSITIONAL-DRIFT
//          SIGNATURE, vantage-scoped — never a claim about identity, never a claim
//          that this is or is not the same system across the arc.
//
//   The words identity / same-system belong to that ceiling text and to the
//   DOES_NOT_SEE lines that carry it, and NOWHERE ELSE in this file.
//
//   THE AMI CEILING (A5 sibling). A MAXIMAL AMI is not the loudest drift — it is
//   evidence-free. At the top, WINDOW fully determines C: every event class sits
//   in exactly one window, the early and late vocabularies are disjoint. A malign
//   total dispositional drift produces that record — and so does a perfectly
//   BENIGN phased process whose early and late stages simply speak different
//   vocabularies (boot classes early, teardown classes late). The evidence that
//   would separate them is not in the class-by-window table, and narrow-T resolves
//   only at that table. Within the injected `driftCeilingMargin` of the maximum ->
//   CANNOT_ASSESS, never ALARM and never SILENT. Absent a margin the check DOES
//   NOT RUN and every verdict says so.
//
//   THE CLASS-SET GUARD (ticket T1, 2026-09-22). A disjoint table reaches AMI 1
//   only at TWO classes; at k classes the same total turnover reads lower, so the
//   margin alone made the verdict depend on class count. Under the same gate (a
//   margin injected) the guard also reads the class SETS of the two windows:
//   disjoint vocabularies -> CANNOT_ASSESS at any class count; above tolerance,
//   when classes spoken in only one window carry the dependence and the classes
//   both windows speak do not drift beyond tolerance among themselves ->
//   CANNOT_ASSESS, a PHASE CHANGE. Drift among the shared classes still ALARMS.
//
// ── STRUCTURE — route (ii), stated ────────────────────────────────────────────
//
//   This module MIRRORS the siblings' verdict assembly rather than sharing a
//   common core; it shares only the statistic (../stat/ami) and the collision-
//   proof tuple key (../tuple-key). The duplication is STATED, not hidden: each
//   reader keeps its own scope block and verdict vocabulary, reader independence
//   is arbiter-ruled architecture, and a cross-check test asserts narrow-T's AMI is
//   EXACTLY the shared ../stat/ami statistic over its own (window, class) table —
//   it re-derives no arithmetic of its own.
//
// Constraints (../types): reads only the typed chained fields `moduleId`,
// `eventType`, and `sequenceNumber` (the last for window ORDER only); no
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
import type { BlindPath, SensorVerdict } from "../types";
import { NARROW_T_COMPETENCE_LINES } from "../competence";
import { AMI_MAXIMUM, pairedStructure } from "../stat/ami";
import type { PairedStructure } from "../stat/ami";

export const NARROW_T_SENSOR_ID = "MICA/narrow-T";

// ── Configuration — injected, never defaulted ─────────────────────────────────

export interface NarrowTConfig {
  /**
   * The load states this deployment considers readable. INJECTED — no default,
   * no fallback (the ../types load-state gate). Absent/unusable -> CANNOT_ASSESS
   * and no reading is offered.
   */
  readableLoadStates?: readonly string[];
  /**
   * Adjusted mutual information ABOVE which the signature counts as drifted ->
   * ALARM. REQUIRED. No default, no range imposed (calibration belongs to pilot
   * data). Absent or not finite -> CANNOT_ASSESS (MISSING_CONFIGURATION).
   *
   * ⚠ NOTE THE POLARITY. The comparison is `ami > driftTolerance`, the INVERSE of
   * the siblings' `ami < threshold`. Above the tolerance is the alarm; at or below
   * it is health.
   */
  driftTolerance?: number;
  /**
   * The minimum number of records that must fall in EACH window for the read to
   * be attempted. REQUIRED, a non-negative integer. Absent/unusable ->
   * CANNOT_ASSESS (MISSING_CONFIGURATION). Below it in either window the
   * permutation model dominates that window's distribution, so the read is not
   * attempted.
   */
  minimumEventsPerWindow?: number;
  /**
   * OPTIONAL. Fixed window size, in records, taken from EACH end of the arc — a
   * NUMBER, not a list. Absent -> the split is the record's STRUCTURAL HALVES.
   * Present (a positive integer) -> EARLY is the first `temporalWindowSize`
   * records and LATE is the last `temporalWindowSize`; any records between are
   * counted, EXCLUDED from the table, and printed (report-only). If the record is
   * shorter than two such windows the windows would overlap -> CANNOT_ASSESS.
   */
  temporalWindowSize?: number;
  /**
   * OPTIONAL. Distance below AMI_MAXIMUM (1) within which the reading counts as AT
   * THE AMI CEILING -> CANNOT_ASSESS (a total drift and a benign total phase
   * separation print the identical record). Eng ceilingMargin pattern: absent ->
   * the ceiling check DOES NOT RUN and every verdict says so. Never treated as
   * passed. Its PRESENCE also gates the class-set guard (ticket T1: disjoint
   * vocabularies, or dependence carried only by window-exclusive classes ->
   * CANNOT_ASSESS); that guard uses the margin's presence, not its number.
   */
  driftCeilingMargin?: number;
  /**
   * OPTIONAL, report-only. Number of reshuffles used to locate the observed MI
   * within the permutation distribution. Requires driftPermutationSeed alongside
   * it. Absent -> the percentile is NOT PRODUCED and the output says so. Never
   * affects a verdict.
   */
  driftPermutationSamples?: number;
  /**
   * OPTIONAL, report-only. Seed for the reshuffles above. Injected so the caller
   * owns reproducibility and this sensor holds no hidden state. Required alongside
   * driftPermutationSamples.
   */
  driftPermutationSeed?: number;
}

/**
 * PRE-PILOT PROXY CALIBRATION (mirrors the siblings', 2026-08-19).
 *
 * The code keeps ZERO defaults — every number is injected. These are the STARTING
 * CONFIGURATION and are marked, here and at every appearance, as PRE-PILOT PROXY,
 * SUBJECT TO CALIBRATION. They are NOT defaults: nothing in this module reads this
 * constant, and a caller who wants these values must inject them, deliberately.
 *
 *   driftTolerance: 0.30            — DELIBERATELY HIGHER than the siblings' 0.05.
 *     The polarity is inverted: small incidental window-to-window dependence is
 *     NORMAL (finite samples, mild phase structure), and the alarm is reserved for
 *     STRONG drift. A 0.05-class tolerance here would alarm on ordinary sampling
 *     noise. Where "strong" begins is a calibration question owed to pilot data;
 *     0.30 is a proxy, not a finding.
 *   minimumEventsPerWindow: 30      — small-sample rule of thumb, per window.
 *   driftCeilingMargin: 0.02        — within 2% of the maximum counts as at the
 *     ceiling (evidence-free total-turnover territory -> CANNOT_ASSESS).
 *   driftPermutationSamples: 1000   — report-only diagnostic.
 *   driftPermutationSeed: 20260819  — report-only diagnostic.
 */
export const NARROW_T_PROXY_CALIBRATION = {
  driftTolerance: 0.3,
  minimumEventsPerWindow: 30,
  driftCeilingMargin: 0.02,
  driftPermutationSamples: 1000,
  driftPermutationSeed: 20260819,
  provenance:
    "PRE-PILOT PROXY, subject to calibration. These are STARTING values, not " +
    "defaults; the code reads no default and this constant is injected by name, " +
    "never consulted internally. driftTolerance is HIGHER than the siblings' 0.05 " +
    "BECAUSE THE POLARITY IS INVERTED — small incidental window-dependence is " +
    "normal here and the alarm is for STRONG drift.",
} as const;

/**
 * THE CEILING — printed loud, in the header, the scope block, and every verdict
 * summary (F-γ2 + T1). Three parts, carried verbatim. The only place in this file
 * the words identity / same-system are permitted to appear.
 */
export const T_CEILING =
  "T CEILING (printed, not repaired): (i) a careful adversary that holds its " +
  "SIGNATURE steady while its substance drifts reads SILENT — T1 catches HONEST " +
  "and LAZY drift only, a signature that visibly moves, and catches nothing that " +
  "keeps the event-class mix constant while changing underneath it. (ii) DRIFT IS " +
  "NOT DEGRADATION: legitimate adaptation drifts the signature and ALARMS too; " +
  "this verdict says the disposition CHANGED BEYOND TOLERANCE, never that it " +
  "changed FOR THE WORSE. (iii) NO IDENTITY CLAIM (F-γ2): 'is it the same system' " +
  "is not truth-apt from this read position; the object is a DISPOSITIONAL-DRIFT " +
  "SIGNATURE, vantage-scoped, and narrow-T makes no claim that this is or is not " +
  "the same system across the arc.";

/** The inverted-polarity reminder, echoed wherever a verdict prints the read. */
export const T_POLARITY_NOTE =
  "POLARITY IS INVERTED vs the siblings: here STRUCTURE IS THE ALARM and flatness " +
  "is health. AMI ABOVE the injected driftTolerance is drift (ALARM); at or below " +
  "it is stability (SILENT).";

/** Where the calibration numbers come from — echoed wherever a number prints. */
export const T_CALIBRATION_PROVENANCE =
  "Calibration is INJECTED and comes from pilot data this sensor has never seen; " +
  "this reader holds no default and cannot vouch for the value. Where this project " +
  "supplies STARTING numbers (NARROW_T_PROXY_CALIBRATION) they are PRE-PILOT " +
  "PROXY, subject to calibration — and driftTolerance is deliberately higher than " +
  "the siblings' because the polarity is inverted.";

/** The AMI-ceiling-not-performed note, printed when no margin was injected. */
export const T_CEILING_NOT_PERFORMED_NOTE =
  "The AMI CEILING CHECK DID NOT RUN: no driftCeilingMargin was injected. A reading " +
  "at or near the maximum is evidence-free rather than a louder alarm (a total " +
  "dispositional drift and a benign total phase separation produce the identical " +
  "record), and without a margin this reader cannot tell whether this reading is " +
  "one of those. Treat this verdict as not having been checked for that condition. " +
  "The CLASS-SET GUARD, gated on the same margin, did not run either: a phase change " +
  "(disjoint vocabularies, or dependence carried only by classes spoken in one window) " +
  "was not separated from drift.";

export type CeilingCheckStatus = "PERFORMED" | "NOT_PERFORMED";
export type SplitMethod = "STRUCTURAL_HALVES" | "INJECTED_WINDOW";

/** The window cut this run made — carried on the result and printed. */
export interface NarrowTWindowing {
  readonly method: SplitMethod;
  /** The injected window size, or null under structural halves. */
  readonly windowSize: number | null;
  readonly totalRecords: number;
  readonly earlyCount: number;
  readonly lateCount: number;
  /**
   * Records between the two windows, counted and EXCLUDED from the table. Zero
   * under structural halves; the arc's middle under an injected window. Report-
   * only; no verdict rule.
   */
  readonly excludedMiddleCount: number;
  /** sequenceNumber bounds of each window, or null when the window is empty. */
  readonly earlyFromSequence: number | null;
  readonly earlyToSequence: number | null;
  readonly lateFromSequence: number | null;
  readonly lateToSequence: number | null;
}

export interface NarrowTResult {
  readonly verdict: SensorVerdict;
  /** The readable load states this run was told to trust, or null. */
  readonly readableLoadStates: readonly string[] | null;
  /** The window cut, or null when the reader stopped before cutting. */
  readonly windowing: NarrowTWindowing | null;
  /**
   * The AMI structure over the (WINDOW, class) table:
   *   entropyLeft / distinctLeft / hasRepeatedLeft   → WINDOW (2-level)
   *   entropyRight / distinctRight / hasRepeatedRight → event class C
   * Present whenever the table was built; null when the reader stopped earlier.
   */
  readonly structure: PairedStructure | null;
  /** Whether the AMI ceiling check ran at all. */
  readonly ceilingCheck: CeilingCheckStatus;
}

/** Event-class key C = (moduleId, eventType), via the shared collision-proof key. */
function classKey(entry: MicaLogRecord): string {
  return contextTupleKey(entry);
}

const EARLY = "EARLY";
const LATE = "LATE";

/**
 * Cut the ordered records into EARLY and LATE. Returns the two windows plus the
 * excluded middle (empty under structural halves), or null with a printed reason
 * when an injected window cannot be honoured (record shorter than two windows).
 */
function cut(
  ordered: readonly MicaLogRecord[],
  temporalWindowSize: number | undefined
):
  | { ok: true; early: MicaLogRecord[]; late: MicaLogRecord[]; middle: MicaLogRecord[]; method: SplitMethod; windowSize: number | null }
  | { ok: false; detail: string } {
  const n = ordered.length;

  const injected =
    typeof temporalWindowSize === "number" &&
    Number.isInteger(temporalWindowSize) &&
    temporalWindowSize > 0;

  if (injected) {
    const w = temporalWindowSize as number;
    if (n < 2 * w) {
      return {
        ok: false,
        detail:
          `an injected temporalWindowSize of ${w} needs at least ${2 * w} records ` +
          `for two non-overlapping windows; the record holds ${n}. The two windows ` +
          `would overlap, so there is nothing to compare across the arc.`,
      };
    }
    return {
      ok: true,
      early: ordered.slice(0, w),
      late: ordered.slice(n - w),
      middle: ordered.slice(w, n - w),
      method: "INJECTED_WINDOW",
      windowSize: w,
    };
  }

  // Structural halves. The mid index splits first-half / second-half; an odd
  // record gives the extra one to LATE. No middle is excluded.
  const mid = Math.floor(n / 2);
  return {
    ok: true,
    early: ordered.slice(0, mid),
    late: ordered.slice(mid),
    middle: [],
    method: "STRUCTURAL_HALVES",
    windowSize: null,
  };
}

function boundsOf(window: readonly MicaLogRecord[]): {
  from: number | null;
  to: number | null;
} {
  if (window.length === 0) return { from: null, to: null };
  return {
    from: window[0].sequenceNumber,
    to: window[window.length - 1].sequenceNumber,
  };
}

// ── The reader ────────────────────────────────────────────────────────────────

export function assessNarrowT(
  log: MicaReadableLog,
  config?: NarrowTConfig
): NarrowTResult {
  const ceilingMargin = config?.driftCeilingMargin;
  const ceilingUsable =
    typeof ceilingMargin === "number" &&
    Number.isFinite(ceilingMargin) &&
    ceilingMargin >= 0;
  const ceilingCheck: CeilingCheckStatus = ceilingUsable
    ? "PERFORMED"
    : "NOT_PERFORMED";

  const injectedStates = config?.readableLoadStates;
  const readableLoadStates: readonly string[] | null = isUsableLoadStateList(
    injectedStates
  )
    ? injectedStates
    : null;

  const stop = (verdict: SensorVerdict): NarrowTResult => ({
    verdict,
    readableLoadStates,
    windowing: null,
    structure: null,
    ceilingCheck,
  });

  // ── D8 anchor: readability gate, before anything is read ───────────────────
  const unreadable = assessLogReadability(log, NARROW_T_SENSOR_ID, injectedStates);
  if (unreadable !== null) return stop(unreadable);

  // ── Required configuration. One leg only — an unconfigured verdict-bearing
  //    read is BLINDNESS, and the leg IS the verdict. ──────────────────────────
  const tolerance = config?.driftTolerance;
  const minimum = config?.minimumEventsPerWindow;
  const missing: BlindPath[] = [];
  if (typeof tolerance !== "number" || !Number.isFinite(tolerance)) {
    missing.push({
      class: "MISSING_CONFIGURATION",
      detail:
        "driftTolerance was not injected as a finite number. narrow-T is a " +
        "verdict-bearing read with ONE leg, so an unconfigured read is blindness — " +
        "NOT a suppressed diagnostic and NOT a stable-signature SILENT. There is no " +
        "default: a default tolerance is a calibration constant, and calibration is " +
        `not this build's to make. ${T_CALIBRATION_PROVENANCE}`,
    });
  }
  if (typeof minimum !== "number" || !Number.isInteger(minimum) || minimum < 0) {
    missing.push({
      class: "MISSING_CONFIGURATION",
      detail:
        "minimumEventsPerWindow was not injected as a non-negative integer. There " +
        "is no default. narrow-T cannot decide how many records make a window's " +
        "distribution usable without being told.",
    });
  }
  if (missing.length > 0) return stop(cannotAssess(NARROW_T_SENSOR_ID, missing));

  const entries = log.getAll() as readonly MicaLogRecord[];
  const ordered = [...entries].sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber
  );

  // ── The split. sequenceNumber read for ORDER only, never as a value. ───────
  const split = cut(ordered, config?.temporalWindowSize);
  if (!split.ok) {
    return stop(
      cannotAssess(NARROW_T_SENSOR_ID, [
        { class: "INSUFFICIENT_SAMPLE", detail: split.detail },
      ])
    );
  }

  const earlyBounds = boundsOf(split.early);
  const lateBounds = boundsOf(split.late);
  const windowing: NarrowTWindowing = {
    method: split.method,
    windowSize: split.windowSize,
    totalRecords: ordered.length,
    earlyCount: split.early.length,
    lateCount: split.late.length,
    excludedMiddleCount: split.middle.length,
    earlyFromSequence: earlyBounds.from,
    earlyToSequence: earlyBounds.to,
    lateFromSequence: lateBounds.from,
    lateToSequence: lateBounds.to,
  };

  const withWindow = (verdict: SensorVerdict, structure: PairedStructure | null): NarrowTResult => ({
    verdict,
    readableLoadStates,
    windowing,
    structure,
    ceilingCheck,
  });

  const middleNote =
    split.middle.length > 0
      ? ` ${split.middle.length} record(s) between the two windows were counted ` +
        `and EXCLUDED from the table (report-only; no verdict rule).`
      : "";

  // ── Sample gate. BOTH windows non-empty AND each >= the injected minimum. ──
  if (split.early.length === 0 || split.late.length === 0) {
    return withWindow(
      cannotAssess(NARROW_T_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `one of the two windows is empty (EARLY=${split.early.length}, ` +
            `LATE=${split.late.length}). Drift across the arc is undefined without ` +
            `records in both windows to be different from each other.`,
        },
      ]),
      null
    );
  }
  if (split.early.length < (minimum as number) || split.late.length < (minimum as number)) {
    return withWindow(
      cannotAssess(NARROW_T_SENSOR_ID, [
        {
          class: "INSUFFICIENT_SAMPLE",
          detail:
            `a window holds fewer records than the injected minimumEventsPerWindow ` +
            `of ${String(minimum)} (EARLY=${split.early.length}, LATE=${split.late.length}).` +
            `${middleNote} Below the minimum the permutation model dominates that ` +
            `window's distribution, so the read is not attempted.`,
        },
      ]),
      null
    );
  }

  // ── The (WINDOW, class) table. WINDOW is LEFT (2-level), class is RIGHT. ───
  const windowKeys: string[] = [];
  const classKeys: string[] = [];
  for (const e of split.early) {
    windowKeys.push(EARLY);
    classKeys.push(classKey(e));
  }
  for (const e of split.late) {
    windowKeys.push(LATE);
    classKeys.push(classKey(e));
  }

  const structure = pairedStructure(windowKeys, classKeys, {
    samples: config?.driftPermutationSamples,
    seed: config?.driftPermutationSeed,
  });

  // ── Scope eligibility — arity conditions, not thresholds. Below these the
  //    question "does the class distribution differ by window?" is undefined. ──
  if (structure.distinctLeft < 2) {
    // Defensive: both windows are non-empty above, so WINDOW should take both
    // values. Kept so a future change to the windowing cannot silently produce a
    // one-window table that reads as SILENT.
    return withWindow(
      cannotAssess(NARROW_T_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `only ${structure.distinctLeft} distinct window(s) present in the table. ` +
            `Drift is a comparison BETWEEN the two windows and needs both.`,
        },
      ]),
      structure
    );
  }
  if (structure.distinctRight < 2) {
    return withWindow(
      cannotAssess(NARROW_T_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `only ${structure.distinctRight} distinct event class(es) across the ` +
            `${structure.sampleSize} record(s) in scope. With a single class the ` +
            `distribution is 100% that class in BOTH windows by construction, so ` +
            `whether it drifted is undefined — there is no other class for weight to ` +
            `move toward.`,
        },
      ]),
      structure
    );
  }
  if (!structure.hasRepeatedRight) {
    return withWindow(
      cannotAssess(NARROW_T_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `every one of the ${structure.distinctRight} event classes occurs exactly ` +
            `once across the ${structure.sampleSize} record(s) in scope. No class has ` +
            `a distribution to compare across the two windows, so there is nothing for ` +
            `the statistic to read.`,
        },
      ]),
      structure
    );
  }
  if (structure.ami === null) {
    return withWindow(
      cannotAssess(NARROW_T_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `the adjusted-mutual-information denominator max(H(W),H(C)) - E[MI] is ` +
            `not positive (H(W)=${structure.entropyLeft.toFixed(6)}, ` +
            `H(C)=${structure.entropyRight.toFixed(6)}, ` +
            `E[MI]=${structure.expectedMutualInformation.toFixed(6)}). The permutation ` +
            `model already accounts for everything this table could show; no drift ` +
            `reading exists to compare against a tolerance.`,
        },
      ]),
      structure
    );
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
    `split=${split.method}` +
    (split.windowSize === null ? "" : ` (window size ${split.windowSize})`) +
    `, EARLY=${split.early.length} record(s) [seq ${earlyBounds.from}–${earlyBounds.to}], ` +
    `LATE=${split.late.length} record(s) [seq ${lateBounds.from}–${lateBounds.to}], ` +
    `${structure.distinctRight} event class(es) ` +
    `[plug-in MI=${structure.mutualInformation.toFixed(6)}, ` +
    `E[MI]=${structure.expectedMutualInformation.toFixed(6)}, ` +
    `H(W)=${structure.entropyLeft.toFixed(6)}, ` +
    `H(C)=${structure.entropyRight.toFixed(6)}].${middleNote}`;

  // ── The AMI ceiling (A5 sibling), BEFORE the tolerance comparison ──────────
  //
  // A reading at the ceiling is not the loudest alarm — it is evidence-free: a
  // total dispositional drift and a benign total phase separation produce the
  // identical record. NOT ALARM.
  if (ceilingUsable && structure.ami >= AMI_MAXIMUM - (ceilingMargin as number)) {
    return withWindow(
      cannotAssess(NARROW_T_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `AMI=${structure.ami.toFixed(6)} is at the ceiling: within the injected ` +
            `driftCeilingMargin of ${String(ceilingMargin)} below the maximum ` +
            `${AMI_MAXIMUM}. At the ceiling WINDOW fully determines the event class — ` +
            `the early and late vocabularies are DISJOINT. A total dispositional drift ` +
            `produces that record, and SO DOES A BENIGN TOTAL PHASE SEPARATION whose ` +
            `stages simply speak different vocabularies. The evidence that would ` +
            `separate them is not in the class-by-window table, so this is not the ` +
            `loudest drift, it is an absence of evidence — deliberately NOT an alarm. ` +
            `${statNote}${permNote} ${T_CALIBRATION_PROVENANCE}`,
        },
      ]),
      structure
    );
  }

  // ── The class-set guard (ticket T1) — a PHASE CHANGE is not drift ──────────
  //
  // The ceiling above only fires near AMI 1, and a DISJOINT table reaches 1 only
  // at two classes: at k disjoint classes the same total turnover reads lower
  // (≈0.49 at 4, ≈0.37 at 6), so the old guard went silent exactly where the
  // bridge writes seven kinds. The guard therefore reads the class SETS of the
  // two windows, not the class count. Same gate as the ceiling (a margin must be
  // injected), same verdict class.
  //   · DISJOINT vocabularies -> CANNOT_ASSESS at any class count: the ceiling's
  //     own case, total turnover.
  //   · Above tolerance, with classes spoken in only ONE window, while the classes
  //     BOTH windows speak do not themselves drift beyond tolerance -> the
  //     dependence is carried by vocabulary appearing/vanishing, which a benign
  //     phase change prints identically -> CANNOT_ASSESS.
  //   · Drift AMONG the shared classes (their own AMI above tolerance) still
  //     ALARMS, window-exclusive classes or not. That is the reader kept armed.
  if (ceilingUsable) {
    const labelOf = new Map<string, string>();
    const earlySet = new Set<string>();
    const lateSet = new Set<string>();
    for (const e of split.early) {
      const k = classKey(e);
      earlySet.add(k);
      if (!labelOf.has(k)) labelOf.set(k, `${e.moduleId}/${e.eventType}`);
    }
    for (const e of split.late) {
      const k = classKey(e);
      lateSet.add(k);
      if (!labelOf.has(k)) labelOf.set(k, `${e.moduleId}/${e.eventType}`);
    }
    const names = (keys: readonly string[]): string =>
      keys.length === 0
        ? "none"
        : keys.map((k) => labelOf.get(k) as string).sort().join(", ");
    const shared = [...earlySet].filter((k) => lateSet.has(k));
    const onlyEarly = [...earlySet].filter((k) => !lateSet.has(k));
    const onlyLate = [...lateSet].filter((k) => !earlySet.has(k));

    if (shared.length === 0) {
      return withWindow(
        cannotAssess(NARROW_T_SENSOR_ID, [
          {
            class: "INELIGIBLE_SCOPE",
            detail:
              `the EARLY and LATE vocabularies are DISJOINT — no event class is ` +
              `spoken in both windows (EARLY: ${names(onlyEarly)}; LATE: ` +
              `${names(onlyLate)}). AMI=${structure.ami.toFixed(6)} sits below the ` +
              `ceiling only because there are ${structure.distinctRight} classes: ` +
              `total turnover reads lower the more classes it spreads over, so the ` +
              `number reflects the class count, not the evidence. This is the ` +
              `ceiling's case at any class count — a total dispositional drift and ` +
              `a BENIGN PHASE CHANGE whose stages speak different vocabularies print ` +
              `the identical class-by-window table. A PHASE CHANGE (total turnover), ` +
              `deliberately NOT an alarm and NOT a stable-signature SILENT. ` +
              `${statNote}${permNote} ${T_CALIBRATION_PROVENANCE}`,
          },
        ]),
        structure
      );
    }

    if (structure.ami > (tolerance as number) && onlyEarly.length + onlyLate.length > 0) {
      const sharedSet = new Set(shared);
      const inShared = (e: MicaLogRecord): boolean => sharedSet.has(classKey(e));
      const subW: string[] = [];
      const subC: string[] = [];
      for (const e of split.early) if (inShared(e)) { subW.push(EARLY); subC.push(classKey(e)); }
      for (const e of split.late) if (inShared(e)) { subW.push(LATE); subC.push(classKey(e)); }
      const sub = pairedStructure(subW, subC);
      const sharedAmi = sub.distinctRight < 2 ? null : sub.ami;
      if (sharedAmi === null || sharedAmi <= (tolerance as number)) {
        const sharedNote =
          shared.length < 2
            ? `only ${shared.length} class is spoken in both windows (${names(shared)}), ` +
              `so there is no within-vocabulary distribution to have drifted`
            : sharedAmi === null
              ? `the ${shared.length} classes spoken in both windows (${names(shared)}) ` +
                `give no defined AMI of their own`
              : `the ${shared.length} classes spoken in both windows (${names(shared)}) ` +
                `read AMI=${sharedAmi.toFixed(6)} among themselves, at or below the ` +
                `injected driftTolerance=${String(tolerance)}`;
        return withWindow(
          cannotAssess(NARROW_T_SENSOR_ID, [
            {
              class: "INELIGIBLE_SCOPE",
              detail:
                `AMI=${structure.ami.toFixed(6)} is above the injected driftTolerance=` +
                `${String(tolerance)}, but the dependence is carried by classes spoken ` +
                `in only ONE window (EARLY-only: ${names(onlyEarly)}; LATE-only: ` +
                `${names(onlyLate)}), and ${sharedNote}. A BENIGN PHASE CHANGE — one ` +
                `stage's vocabulary ending and another's beginning — and a malign drift ` +
                `print the identical class-by-window table here; the evidence that ` +
                `would separate them is not in the table. A PHASE CHANGE, deliberately ` +
                `NOT an alarm and NOT a stable-signature SILENT. ` +
                `${statNote}${permNote} ${T_CALIBRATION_PROVENANCE}`,
            },
          ]),
          structure
        );
      }
    }
  }

  // ── The read — INVERTED. Strictly ABOVE the injected tolerance alarms. ─────
  //
  // At the tolerance exactly, the signature has not moved BEYOND the point that
  // counts as drifted, so the reader stays silent.
  if (structure.ami > (tolerance as number)) {
    return withWindow(
      alarm(
        NARROW_T_SENSOR_ID,
        `Dispositional drift: the record's event-class distribution DIFFERS between ` +
          `its EARLY and LATE windows beyond what a reshuffle of the same table would ` +
          `produce — the behavioural signature moved across the arc. This states a ` +
          `property of the record. ${T_POLARITY_NOTE} ${T_CEILING} ` +
          `${T_CALIBRATION_PROVENANCE}`,
        [
          {
            code: "T_DISPOSITIONAL_DRIFT",
            detail:
              `AMI=${structure.ami.toFixed(6)} > injected driftTolerance=` +
              `${String(tolerance)} ${statNote}${permNote}` +
              (ceilingUsable ? "" : ` ${T_CEILING_NOT_PERFORMED_NOTE}`),
          },
        ]
      ),
      structure
    );
  }

  return withWindow(
    {
      kind: "SILENT",
      sensorId: NARROW_T_SENSOR_ID,
      summary:
        `Stable signature: AMI=${structure.ami.toFixed(6)} <= injected ` +
        `driftTolerance=${String(tolerance)} — the event-class distribution held ` +
        `across the arc's EARLY and LATE windows. ${statNote}` +
        `${structure.permutation === null ? "" : permNote} ${T_POLARITY_NOTE} ` +
        `${T_CEILING} ${T_CALIBRATION_PROVENANCE}` +
        (ceilingUsable ? "" : ` ${T_CEILING_NOT_PERFORMED_NOTE}`) +
        ` ${SILENCE_IS_NOT_HEALTH}`,
    },
    structure
  );
}

// ── D7: printed scope, in the code's own output ───────────────────────────────

export const NARROW_T_SCOPE_TITLE =
  "MICA/narrow-T — within-record dispositional-drift signature";

export const NARROW_T_SCOPE_READS: readonly string[] = [
  "the declared record's moduleId   } jointly, as the event class C —",
  "the declared record's eventType  } the record's OWN behavioural vocabulary",
  "the declared record's sequenceNumber — for the WINDOW CUT, ORDER ONLY. It cuts",
  "                          the arc into an EARLY and a LATE window (structural",
  "                          halves by default; an injected temporalWindowSize —",
  "                          a NUMBER, not a list — takes a fixed window from each",
  "                          end). Not read as a value.",
  "the WINDOW label (EARLY / LATE) — a DERIVED 2-level variable, paired with the",
  "                          event class as the AMI table. High AMI = the class",
  "                          distribution moved across the arc = drift.",
  "the log's own verify()        — readability gate ONLY, never the finding",
  "the log's own getLoadState()  — readability gate only",
];

export const NARROW_T_SCOPE_DOES_NOT_SEE: readonly string[] = [
  "THE SIGNATURE-HOLDING ADVERSARY (the ceiling, part i). A careful adversary that",
  "  holds its SIGNATURE steady while its substance drifts reads SILENT. T1 catches",
  "  HONEST and LAZY drift only — a signature that visibly moves — and catches",
  "  nothing that keeps the event-class mix constant while changing underneath it.",
  "WHETHER THE DRIFT IS FOR THE WORSE (the ceiling, part ii). DRIFT IS NOT",
  "  DEGRADATION. Legitimate adaptation drifts the signature and ALARMS too. The",
  "  verdict says the disposition CHANGED BEYOND TOLERANCE; it NEVER says it changed",
  "  for the worse — narrow-T cannot read direction, only movement.",
  "WHETHER IT IS THE SAME SYSTEM ACROSS THE ARC (the ceiling, part iii — F-γ2).",
  "  'Is it the same system' is not truth-apt from this read position. The object is",
  "  a DISPOSITIONAL-DRIFT SIGNATURE, vantage-scoped, Fair-Witness-scoped; narrow-T",
  "  makes NO identity claim and no same-system claim, in either direction.",
  "THE AMI CEILING. A MAXIMAL AMI is not the loudest drift — it is evidence-free. At",
  "  the top, WINDOW fully determines the class: the early and late vocabularies are",
  "  disjoint. A malign total drift and a BENIGN total phase separation (boot classes",
  "  early, teardown classes late) print the IDENTICAL record; the evidence that",
  "  separates them is not in the class-by-window table. Within the injected margin",
  "  of the maximum -> CANNOT_ASSESS, never ALARM. Absent a margin the check does",
  "  not run and every verdict says so.",
  "A PHASE CHANGE BELOW THE CEILING (ticket T1). The same evidence-free case at more",
  "  than two classes: DISJOINT early/late vocabularies, or a reading above tolerance",
  "  carried by classes spoken in only one window while the shared classes do not",
  "  drift among themselves -> CANNOT_ASSESS, never ALARM. Consequence, stated: a NEW",
  "  behaviour appearing (or an old one vanishing) beside an unchanged shared mix is",
  "  not read as drift. Drift AMONG the shared classes still alarms. Gated on the",
  "  same injected margin as the ceiling.",
  "CROSS-RUN DRIFT. narrow-T reads ONE record's arc only — EARLY vs LATE WITHIN a",
  "  single log. Drift ACROSS separate runs, sessions, or restarts is invisible to",
  "  it: there is no baseline carried between records and none is invented. That is",
  "  named FUTURE WORK, not a reading offered here.",
  "THE MIDDLE OF THE ARC, under an injected window (report-only). With a fixed",
  "  temporalWindowSize and a record longer than two windows, the records between",
  "  the two ends are counted, EXCLUDED from the table, and printed. They weight no",
  "  verdict. A drift confined to the excluded middle is not read.",
  "THE POLARITY, IF MISREAD. Here STRUCTURE IS THE ALARM and flatness is health —",
  "  the INVERSE of every other MICA sibling. A reader carrying the siblings' habit",
  "  (low score = alarm) inverts this instrument. AMI above the injected tolerance",
  "  is drift; at or below it is stability.",
  "WHETHER A TOLERANCE IS THE RIGHT TOLERANCE. Calibration is injected and comes",
  "  from pilot data this sensor has never seen; driftTolerance is deliberately",
  "  higher than the siblings' because the polarity is inverted, and even that is a",
  "  PRE-PILOT PROXY.",
];

export function narrowTScopeBlockText(
  readableLoadStates?: readonly string[]
): string {
  return formatScopeBlock(
    NARROW_T_SCOPE_TITLE,
    NARROW_T_SCOPE_READS,
    NARROW_T_SCOPE_DOES_NOT_SEE,
    NARROW_T_COMPETENCE_LINES,
    loadStateScopeLines(readableLoadStates)
  );
}

export function printNarrowTScope(readableLoadStates?: readonly string[]): void {
  printScopeBlock(
    NARROW_T_SCOPE_TITLE,
    NARROW_T_SCOPE_READS,
    NARROW_T_SCOPE_DOES_NOT_SEE,
    NARROW_T_COMPETENCE_LINES,
    loadStateScopeLines(readableLoadStates)
  );
}
