// ── MICA · Eng — engagement-signature sensor ──────────────────────────────────
//
// WHAT IT DETECTS
//
//   Eng-collapse = `outcome` becoming conditionally independent of event class.
//
//     Healthy:    `outcome` varies systematically with (moduleId, eventType).
//     Collapsed:  the same outcome regardless of what came in.
//
// A system that rubber-stamps produces verdicts that stop depending on what it
// is judging. That decoupling is visible in the record without reading any
// self-assessment — it is a property of the JOINT DISTRIBUTION of two typed
// chained fields, not of any single declared value.
//
// Stated at its true width (corrected 2026-08-07): those fields are themselves
// caller-supplied, so the distribution is not outside the observed party's
// control either. Eng's warrant is that a collapsed signature is hard to fake
// WHILE STILL DOING THE WORK — not that its inputs are independently authored.
// No field on the chained record is independently authored. Eng's reading logic
// is unchanged by this correction.
//
// VOCABULARY DISCIPLINE
//
//   The object is an ENGAGEMENT SIGNATURE, never "engagement". This sensor
//   detects that a signature collapsed. It makes NO claim about anything
//   interior — not about attention, not about care, not about intent. It reads
//   a statistical dependency between two recorded fields and nothing else.
//
// THE TWO FAILURE DIRECTIONS
//
//   Both must collapse the SAME statistic, or the sensor catches half the
//   failure mode:
//
//     Templated agreement flattens `outcome` toward a constant  → no structure.
//     Injected noise randomises `outcome`                        → ALSO no
//       structure, because random variation is by construction uncorrelated
//       with event class.
//
//   The sensor does not measure variance. It measures STRUCTURED variance. The
//   only way to restore the statistic is to be actually differentially
//   responsive — which is the thing itself.
//
// ── AND THE CEILING (A5) ──────────────────────────────────────────────────────
//
//   The statistic ALSO fails at the top, and that failure is not symmetric with
//   the two above. A maximal score means the outcome is fully determined by the
//   class. TWO VERY DIFFERENT SYSTEMS PRODUCE THAT:
//
//     THE REAL JUDGE   — assesses every case, and all cases in a class
//                        genuinely warrant the same outcome.
//     THE LOOKUP TABLE — reads nothing, sees the class label, returns a canned
//                        value.
//
//   In the record these are IDENTICAL. Same fields, same values, same score.
//   The evidence that separates them lives WITHIN the class — did it engage
//   with the individual case — and Eng resolves only at class granularity.
//   Eng has no evidence to choose.
//
//   Worse: a system rotting from real judgment toward a lookup table has its
//   score go UP, because real judgment is messy — fallbacks, exceptions, edge
//   cases. The metric improves as the system dies, and no threshold value
//   catches that.
//
//   So a maximal score is NOT evidence of health. It is the point at which Eng
//   has NO EVIDENCE AT ALL — a scope that looks full and is actually empty.
//   The architecture already answers that condition with CANNOT_ASSESS
//   everywhere else it appears, and it answers it that way here.
//
//   NOT ALARM. The real judge may be working flawlessly, and alarming on a
//   perfect score accuses a healthy system.

import type { MicaLogRecord, MicaReadableLog } from "../log";
import {
  alarm,
  assessLogReadability,
  cannotAssess,
  formatScopeBlock,
  isUsableLoadStateList,
  loadStateScopeLines,
  printScopeBlock,
  silent,
} from "../types";
import { ENG_COMPETENCE_LINES } from "../competence";
import type { BlindPath, SensorVerdict } from "../types";
import { AMI_MAXIMUM, pairedStructure } from "../stat/ami";
import { contextTupleKey } from "../tuple-key";
import type { PermutationReference } from "../stat/ami";

export const ENG_SENSOR_ID = "MICA/Eng";

/**
 * The maximum attainable value of the adjusted mutual information. This is a
 * property of the statistic's normalisation, not a calibration choice: AMI is
 * defined as a ratio whose numerator equals its denominator exactly when the
 * observed table attains the maximum the marginals permit. There is no other
 * value it could take and nothing to tune. The DISTANCE BELOW IT that counts as
 * "at the ceiling" is a threshold and IS injected — see EngConfig.ceilingMargin.
 *
 * DEFINED NOW IN ../stat/ami AND RE-EXPORTED HERE. The statistic moved to a
 * shared, sensor-free module so narrow-W leg 2 can compute the same AMI; Eng's
 * exported API is unchanged, so importers of AMI_MAXIMUM from this file are
 * unaffected.
 */
export { AMI_MAXIMUM };

// ── Configuration — injected, never defaulted ─────────────────────────────────
//
// There are no defaults. A default value is a constant, and a constant here is
// a calibration decision smuggled into a build. Absent configuration produces
// CANNOT_ASSESS: the sensor does not fall back, does not guess, and does not
// silently proceed.
//
// Three of the settings below are OPTIONAL in a different sense: their absence
// does not blind the verdict, it suppresses a diagnostic or a check, and the
// sensor SAYS SO in its output rather than proceeding as though the check had
// been performed and passed.

export interface EngConfig {
  /**
   * The load states this deployment considers readable. INJECTED — there is no
   * default and no fallback. Which states a log reports, and which of them are
   * trustworthy, are deployment facts this sensor has no access to.
   *
   * See assessLogReadability in ../types for what this project RECOMMENDS and
   * for the widening exposure a permissive list buys. The list is printed in
   * this sensor's scope block and in any load-state blind path, so a reader can
   * see what this run was told to trust.
   *
   * REQUIRED. Absent, empty, or not a list of non-empty strings ->
   * CANNOT_ASSESS (MISSING_CONFIGURATION), and no other check runs.
   */
  readableLoadStates?: readonly string[];
  /**
   * Structure below which the signature counts as collapsed. Compared against
   * the adjusted mutual information (see engStructure). No default. Any finite
   * number is accepted — this build imposes no range, because where on the
   * scale "collapsed" begins is a calibration question that belongs to pilot
   * data and not to this code.
   *
   * REQUIRED. Absent -> CANNOT_ASSESS.
   */
  structureThreshold?: number;
  /**
   * Entry count below which the read is not attempted at all. No default.
   *
   * REQUIRED. Absent -> CANNOT_ASSESS.
   */
  minimumSampleSize?: number;

  /**
   * T11. REQUIRED. Absent -> CANNOT_ASSESS (MISSING_CONFIGURATION).
   *
   * ⛔ WHY A SECOND FLOOR EXISTS BESIDE minimumSampleSize. That one counts ROWS.
   *    A chain can satisfy it while carrying almost no class variety — 600 rows
   *    of which 598 are one class and two are singletons passes it — and Eng
   *    then answers "does outcome depend on event class?" over a table that has
   *    barely any class to depend on. The three ARITY gates below catch only the
   *    degenerate end; between "degenerate" and "enough to read" there was no
   *    rule, AND minimumSampleSize HAS BEEN STANDING IN FOR ONE.
   *
   *    THE RULE: at least `k` distinct observed classes must EACH carry at least
   *    `k` events, where a class is (moduleId, eventType).
   *
   * ⚠ THE LOOSER OF THE TWO READINGS, DELIBERATELY. Not "every observed class
   *   has >= k events" — that lets ONE rare class block the read forever, which
   *   is the unsatisfiability trap found on the DECLARED-class axis the same day
   *   (five declared lineClasses, one occupied subject: "every declared class
   *   >= k" can never be met, and would hold a deployment permanently on an
   *   artefact of its declaration's shape rather than on its behaviour).
   *
   * NO DEFAULT. A default k is a calibration constant, and calibration is not
   * this build's to make.
   */
  minimumClassCoverage?: number;
  /**
   * Distance below AMI_MAXIMUM within which the reading counts as AT THE
   * CEILING, and therefore as evidence-free (A5). No default: "at or near
   * maximum" needs a bound, that bound is a number, and numbers are injected.
   *
   * OPTIONAL. Absent -> the ceiling check DOES NOT RUN and every verdict says
   * so. It is never silently treated as passed.
   */
  ceilingMargin?: number;
  /**
   * Size of the consecutive non-overlapping windows for the windowed diagnostic
   * (A4). Report-only; never affects a verdict.
   *
   * OPTIONAL. Absent -> the windowed diagnostic is NOT PRODUCED and the output
   * says so.
   */
  windowSize?: number;
  /**
   * Number of reshuffles used to locate the observed mutual information within
   * the permutation distribution (A3). Report-only; never affects a verdict.
   *
   * OPTIONAL, and requires permutationSeed alongside it. Absent -> the
   * percentile is NOT PRODUCED and the output says so.
   */
  permutationSamples?: number;
  /**
   * Seed for the reshuffles above. Injected rather than derived so the caller
   * owns reproducibility and this sensor holds no hidden state.
   *
   * OPTIONAL, required alongside permutationSamples.
   */
  permutationSeed?: number;
}

// ── The statistic ─────────────────────────────────────────────────────────────
//
// ADJUSTED MUTUAL INFORMATION between event class C = (moduleId, eventType)
// and outcome O, against the fixed-marginal permutation model:
//
//     AMI = ( MI(C;O) - E[MI] ) / ( max(H(C), H(O)) - E[MI] )
//
// where E[MI] is the EXACT expected mutual information over all relabelings
// that preserve both marginal count vectors.
//
// WHY THE ADJUSTMENT IS THE WHOLE POINT.
//
// Plain (plug-in) mutual information FAILS the noise arm, and fails it in the
// worst possible direction — silently, with a maximal reading. If injected
// noise gives every entry a distinct `outcome` string, then each outcome value
// occurs exactly once, so observing the outcome determines the class, so
// MI(C;O) = H(C) — the maximum any statistic of this kind can attain. A sensor
// built on plug-in MI would report PERFECT structure on a log whose outcomes
// carry no information about class whatsoever. That is a false SILENT on a live
// degradation, which is the failure this whole architecture exists to prevent.
//
// Against the permutation model that same table is unremarkable: E[MI] for the
// all-distinct-outcomes case is exactly H(C) as well, so the numerator is
// exactly zero and AMI = 0. The adjustment asks "how much more structure than
// a random relabeling of the same shape?" — and random variation, by
// construction, has none.
//
// The flattening arm collapses it too, for the plain reason: one outcome value
// means MI = 0 and E[MI] = 0, so AMI = 0.
//
// So both failure directions land on the same floor, and the only way off the
// floor is a class→outcome dependence that a reshuffle would destroy — i.e.
// actually being differentially responsive.
//
// Natural logarithm throughout. The base cancels in the ratio, so no base is a
// choice this code has to defend.

/**
 * Where the OBSERVED mutual information sits inside the permutation
 * distribution (A3).
 *
 * Reported because the adjusted value alone is misleading to read. A reader
 * seeing an AMI of -0.004 reasonably concludes "basically zero, no signal
 * either way". That reading discards information: the question is not how close
 * the excess is to zero, it is where the observed table falls among the
 * reshuffles of itself. This locates it.
 *
 * ESTIMATED, NOT EXACT. The mean of this distribution is computed exactly (see
 * expectedMutualInformation); its shape is not, because the exact distribution
 * requires enumerating contingency tables with fixed margins, which is not
 * tractable in general. So the position is estimated by resampling with an
 * injected sample count and an injected seed.
 *
 * DEFINED NOW IN ../stat/ami AND RE-EXPORTED HERE, with the statistic itself.
 * Eng's exported API is unchanged; importers of PermutationReference from this
 * file are unaffected.
 */
export type { PermutationReference };

export interface EngStructure {
  /** Adjusted mutual information. Degenerate tables report null. */
  ami: number | null;
  /** Plug-in mutual information, reported for scrutiny, never thresholded. */
  mutualInformation: number;
  /** Exact expected MI under the fixed-marginal permutation model. */
  expectedMutualInformation: number;
  entropyClass: number;
  entropyOutcome: number;
  sampleSize: number;
  distinctClasses: number;
  distinctOutcomes: number;
  /** True when at least one event class occurs more than once. */
  hasRepeatedClass: boolean;
  /** A3. Null when the sample count or seed was not injected. */
  permutation: PermutationReference | null;
  /** Why `permutation` is null, when it is. Always populated. */
  permutationNote: string;
}

/**
 * Class key for an entry — the SHARED, length-prefixed, collision-proof one.
 *
 * ⛔ WHAT STOOD HERE WAS A DELIMITER ASSUMED FORBIDDEN, AND IT SAID SO IN A
 *    COMMENT THAT WAS FALSE: "NUL separator: cannot occur inside a JSON-sourced
 *    identifier, so the join is unambiguous." `moduleId` and `eventType` are
 *    unrestricted strings on `MicaLogRecord`, JSON admits U+0000 via `\u0000`,
 *    and no validator on the readable-log boundary excludes it. So
 *    (moduleId "a", eventType "b\u0000c") and (moduleId "a\u0000b",
 *    eventType "c") keyed to ONE class. Found by Codex on T11's committed bytes,
 *    2026-10-01, with a nine-record counterexample: three genuine classes, three
 *    events each, refused at k=3 because the count said two.
 *
 * ⚠ AND THE REPAIR ALREADY EXISTED IN THIS DIRECTORY, DOCUMENTED, NAMING THIS
 *   EXACT FAILURE. `tuple-key.ts`'s own header: "W and R joined with an
 *   ASSUMED-forbidden delimiter. Its safety rests entirely on NUL never
 *   appearing inside a component, which is a property of the INPUT, not of the
 *   encoding." The F4 repair length-prefixed the parts and migrated narrow-W,
 *   narrow-R, narrow-K, narrow-T and gate1-scope. ENG WAS NEVER MIGRATED — it
 *   has carried the NUL join since the S94 baseline of 2026-08-30 and kept it
 *   straight through the round that fixed its four siblings. The fix pinned the
 *   instances and left the generator.
 *
 * ⚠ THE BLAST RADIUS IS WIDER THAN T11. This key labels the LEFT variable of
 *   the AMI statistic as well as T11's coverage count, so a collapse moved the
 *   structure reading too, silently, for a month. T11 did not introduce the
 *   defect; it made the defect decide whether Eng reads at all.
 */
function classKey(entry: MicaLogRecord): string {
  return contextTupleKey(entry);
}

/**
 * Compute the structure statistic over a set of entries. Exported so a
 * reviewer can call it directly on their own table and check the arithmetic
 * without going through the verdict machinery.
 *
 * THE MATH LIVES IN ../stat/ami NOW. This is a thin wrapper that names Eng's
 * two variables — the event class C = (moduleId, eventType) as the LEFT label,
 * the `outcome` O as the RIGHT label — and maps the neutral PairedStructure
 * back onto EngStructure's field names. `pairedStructure` builds its indices in
 * first-seen order over the pairs, which is the order this function's original
 * single pass produced, so the numbers are unchanged; and it reshuffles the
 * RIGHT (outcome) vector, exactly as Eng's permutation did.
 */
export function engStructure(
  entries: readonly MicaLogRecord[],
  permutationConfig?: { samples?: number; seed?: number }
): EngStructure {
  const s = pairedStructure(
    entries.map((e) => classKey(e)),
    entries.map((e) => e.outcome),
    permutationConfig
  );
  return {
    ami: s.ami,
    mutualInformation: s.mutualInformation,
    expectedMutualInformation: s.expectedMutualInformation,
    entropyClass: s.entropyLeft,
    entropyOutcome: s.entropyRight,
    sampleSize: s.sampleSize,
    distinctClasses: s.distinctLeft,
    distinctOutcomes: s.distinctRight,
    hasRepeatedClass: s.hasRepeatedLeft,
    permutation: s.permutation,
    permutationNote: s.permutationNote,
  };
}

// ── A4 · diagnostics — REPORT ONLY ────────────────────────────────────────────
//
// Eng aggregates across the whole log, and two blind spots follow:
//
//   ASYMMETRIC DEGRADATION — four classes behave perfectly, one collapses
//     entirely; the aggregate stays above threshold and the sensor is SILENT
//     while a subsystem dies.
//   TEMPORAL DRIFT — healthy for the first stretch, unmoored for the last;
//     aggregation blends the window and masks late-stage failure.
//
// ⚠ THESE ARE COMPUTED AND REPORTED. THEY DO NOT AFFECT THE VERDICT.
//
//   There is no alarm rule, no threshold, no bound, and no verdict attached to
//   either. The verdict logic is byte-identical to what it was before these
//   existed, and a test asserts exactly that.
//
//   Whether a single collapsed class among four healthy ones SHOULD alarm is a
//   real question with a real answer on both sides, and it belongs to the
//   arbiter. The job here is to make the fact visible. Someone else decides
//   what it means.
//
// ── A NOTE ON "AMI RESTRICTED TO EACH INDIVIDUAL CLASS" ───────────────────────
//
//   Taken literally that quantity DOES NOT EXIST. Restricting to a single class
//   leaves one class, so H(C) = 0, so the adjusted mutual information between
//   class and outcome is undefined — it is exactly the degenerate table the
//   sensor already refuses to read (see the distinctClasses check below).
//
//   Two well-defined quantities are reported in its place, and the substitution
//   is named here rather than made silently:
//
//     divergenceFromPooled — D( P(O | C=k) || P(O) ), this class's own
//       contribution to the aggregate mutual information. Near zero means this
//       class's outcome distribution is indistinguishable from the pooled one:
//       the class is not being differentiated from anything.
//     leaveOneOutAmi — the aggregate AMI recomputed with this class's records
//       REMOVED. A sharp rise means this class was dragging the aggregate down;
//       a sharp fall means this class was carrying it.

export interface EngClassDiagnostic {
  eventClass: string;
  count: number;
  /** D( P(O|C=k) || P(O) ) — this class's contribution to the aggregate MI. */
  divergenceFromPooled: number;
  /** Aggregate AMI with this class's records removed. Null when degenerate. */
  leaveOneOutAmi: number | null;
}

export interface EngWindowDiagnostic {
  windowIndex: number;
  fromSequence: number;
  toSequence: number;
  size: number;
  ami: number | null;
  note: string;
}

export interface EngDiagnostics {
  perClass: readonly EngClassDiagnostic[];
  /** Null when windowSize was not injected. */
  windows: readonly EngWindowDiagnostic[] | null;
  /** Always populated; explains a null `windows`. */
  windowNote: string;
}

function engDiagnostics(
  entries: readonly MicaLogRecord[],
  windowSize: number | undefined
): EngDiagnostics {
  const total = entries.length;

  // ── per class ────────────────────────────────────────────────────────────
  const byClass = new Map<string, MicaLogRecord[]>();
  for (const e of entries) {
    const k = classKey(e);
    const bucket = byClass.get(k);
    if (bucket === undefined) byClass.set(k, [e]);
    else bucket.push(e);
  }

  const pooled = new Map<string, number>();
  for (const e of entries) pooled.set(e.outcome, (pooled.get(e.outcome) ?? 0) + 1);

  const perClass: EngClassDiagnostic[] = [];
  for (const [key, bucket] of byClass) {
    const local = new Map<string, number>();
    for (const e of bucket) local.set(e.outcome, (local.get(e.outcome) ?? 0) + 1);

    let divergence = 0;
    for (const [outcome, n] of local) {
      const p = n / bucket.length;
      const q = (pooled.get(outcome) as number) / total;
      divergence += p * Math.log(p / q);
    }

    const remainder = entries.filter((e) => classKey(e) !== key);
    const looAmi = remainder.length > 0 ? engStructure(remainder).ami : null;

    perClass.push({
      // ⛔ THE DISPLAY NAME IS BUILT FROM THE RECORD, NOT FROM THE KEY. What stood
      //    here was `key.replace("\u0000", "/")` — a display step COUPLED TO THE
      //    KEY'S ENCODING. T13 changed the encoding to the shared length-prefixed
      //    one and left this line, so two things broke at once (Codex T13 F1):
      //    ordinary labels became raw keys ("15:MICA/SubjectLog14:TOOL_ATTEMPTED"),
      //    and a NUL INSIDE a component was rewritten to "/" so one class could
      //    print under another's name — measured: three buckets, two labels.
      //
      // ⚠ THE KEY IS FOR GROUPING, THE LABEL IS FOR A HUMAN, AND THEY ARE NOW
      //   DERIVED SEPARATELY. A JSON array of the two original components is
      //   unambiguous by construction and stays readable — which `key` never
      //   promised to be; it was readable only by accident of its delimiter.
      eventClass: JSON.stringify([bucket[0].moduleId, bucket[0].eventType]),
      count: bucket.length,
      divergenceFromPooled: divergence,
      leaveOneOutAmi: looAmi,
    });
  }

  // ── windows ──────────────────────────────────────────────────────────────
  if (
    typeof windowSize !== "number" ||
    !Number.isInteger(windowSize) ||
    windowSize < 1
  ) {
    return {
      perClass,
      windows: null,
      windowNote:
        "NOT PRODUCED — windowSize was not injected as a positive integer. A " +
        "window length is a number, and numbers are injected here. Its absence " +
        "is reported, never treated as a passed check.",
    };
  }

  const windows: EngWindowDiagnostic[] = [];
  for (let start = 0, w = 0; start < total; start += windowSize, w++) {
    const slice = entries.slice(start, start + windowSize);
    const s = engStructure(slice);
    let note: string;
    if (s.ami !== null) {
      note = "computed";
    } else if (s.distinctClasses < 2) {
      note = `not computable — ${s.distinctClasses} distinct class(es) in this window`;
    } else if (!s.hasRepeatedClass) {
      note = "not computable — no event class recurs within this window";
    } else {
      note = "not computable — degenerate normalisation within this window";
    }
    windows.push({
      windowIndex: w,
      fromSequence: slice[0].sequenceNumber,
      toSequence: slice[slice.length - 1].sequenceNumber,
      size: slice.length,
      ami: s.ami,
      note,
    });
  }

  return {
    perClass,
    windows,
    windowNote:
      `${windows.length} consecutive non-overlapping window(s) of injected size ${windowSize}` +
      (total % windowSize === 0
        ? ""
        : `; the final window holds the remaining ${total % windowSize} record(s)`),
  };
}

// ── The sensor ────────────────────────────────────────────────────────────────

export type CeilingCheckStatus = "PERFORMED" | "NOT_PERFORMED";

export interface EngResult {
  verdict: SensorVerdict;
  /** Present whenever the statistic was actually computed. */
  structure?: EngStructure;
  /** A4. Report-only. Present whenever the statistic was computed. */
  diagnostics?: EngDiagnostics;
  /** A5. Whether the ceiling check ran at all. */
  ceilingCheck: CeilingCheckStatus;
  /**
   * The readable load states THIS RUN was told to trust, or null when nothing
   * usable was injected. Carried on the result so the exported artifact can
   * print it without re-deriving it from a config it never sees.
   */
  readableLoadStates: readonly string[] | null;
}

/**
 * Exported so the artifact can carry it on EVERY run whose ceiling check did
 * not run — not only on the SILENT run whose summary happens to embed it. An
 * ALARM or a CANNOT_ASSESS produced without a ceiling margin is equally
 * unchecked for that condition, and the outside reader is entitled to know.
 * Exporting the string changes no verdict text: the summary that already
 * embeds it is byte-identical.
 */
export const CEILING_NOT_PERFORMED_NOTE =
  "The CEILING CHECK DID NOT RUN: no ceilingMargin was injected. A reading at " +
  "or near the maximum is evidence-free rather than healthy (a real judge and a " +
  "class-keyed lookup table produce the identical record), and without a margin " +
  "this sensor cannot tell whether this reading is one of those. Treat this " +
  "verdict as not having been checked for that condition.";

export function assessEng(
  log: MicaReadableLog,
  config?: EngConfig
): EngResult {
  const ceilingMargin = config?.ceilingMargin;
  const ceilingUsable =
    typeof ceilingMargin === "number" &&
    Number.isFinite(ceilingMargin) &&
    ceilingMargin >= 0;
  const ceilingCheck: CeilingCheckStatus = ceilingUsable
    ? "PERFORMED"
    : "NOT_PERFORMED";

  // The injected gate list, normalised once. `null` means nothing usable was
  // injected — NEVER a substituted default.
  const injectedStates = config?.readableLoadStates;
  const readableLoadStates: readonly string[] | null = isUsableLoadStateList(
    injectedStates
  )
    ? injectedStates
    : null;

  // ── D8 anchor: the named dependency, checked before anything is read ──────
  const unreadable = assessLogReadability(log, ENG_SENSOR_ID, injectedStates);
  if (unreadable !== null) {
    return { verdict: unreadable, ceilingCheck, readableLoadStates };
  }

  // ── Configuration ────────────────────────────────────────────────────────
  const missing: BlindPath[] = [];
  const threshold = config?.structureThreshold;
  const minimum = config?.minimumSampleSize;

  if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
    missing.push({
      class: "MISSING_CONFIGURATION",
      detail:
        "structureThreshold was not injected as a finite number. There is no " +
        "default: a default threshold is a calibration constant, and calibration " +
        "is not this build's to make.",
    });
  }
  if (
    typeof minimum !== "number" ||
    !Number.isInteger(minimum) ||
    minimum < 0
  ) {
    missing.push({
      class: "MISSING_CONFIGURATION",
      detail:
        "minimumSampleSize was not injected as a non-negative integer. There is " +
        "no default.",
    });
  }
  const classCoverage = config?.minimumClassCoverage;
  if (
    typeof classCoverage !== "number" ||
    !Number.isInteger(classCoverage) ||
    classCoverage < 1
  ) {
    missing.push({
      class: "MISSING_CONFIGURATION",
      detail:
        "minimumClassCoverage was not injected as a positive integer. There is " +
        "no default: how much class variety is enough to read is a calibration " +
        "question, and calibration is not this build's to make.",
    });
  }
  if (missing.length > 0) {
    return {
      verdict: cannotAssess(ENG_SENSOR_ID, missing),
      ceilingCheck,
      readableLoadStates,
    };
  }

  const entries = log.getAll();

  // ── Sample size ──────────────────────────────────────────────────────────
  if (entries.length < (minimum as number)) {
    return {
      verdict: cannotAssess(ENG_SENSOR_ID, [
        {
          class: "INSUFFICIENT_SAMPLE",
          detail:
            `chain holds ${entries.length} entries; injected minimumSampleSize is ` +
            `${String(minimum)}. The read is not attempted.`,
        },
      ]),
      ceilingCheck,
      readableLoadStates,
    };
  }

  const structure = engStructure(entries, {
    samples: config?.permutationSamples,
    seed: config?.permutationSeed,
  });

  // A4 diagnostics are computed here and NEVER consulted below. Every branch
  // from this point forward reads `structure`, `threshold` and `ceilingMargin`
  // only.
  const diagnostics = engDiagnostics(entries, config?.windowSize);

  // ── Scope eligibility ────────────────────────────────────────────────────
  //
  // These are arity conditions, not thresholds. They have no tunable value:
  // below them the question "does outcome depend on event class?" is not
  // false, it is undefined.
  //
  //   · Fewer than two distinct classes: there is no variation in the thing
  //     the outcome is supposed to depend on, so dependence is unaskable.
  //   · No class occurs more than once: every class has a single observation,
  //     so no class has a conditional distribution to compare.

  if (structure.distinctClasses < 2) {
    return {
      verdict: cannotAssess(ENG_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `chain holds ${structure.distinctClasses} distinct (moduleId, eventType) ` +
            `class(es). Dependence of outcome on class is undefined without at ` +
            `least two classes to be different from each other.`,
        },
      ]),
      structure,
      diagnostics,
      ceilingCheck,
      readableLoadStates,
    };
  }

  if (!structure.hasRepeatedClass) {
    return {
      verdict: cannotAssess(ENG_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `every one of the ${structure.distinctClasses} event classes occurs exactly ` +
            `once in ${structure.sampleSize} entries. No class has a conditional ` +
            `outcome distribution, so there is nothing for the statistic to compare.`,
        },
      ]),
      structure,
      diagnostics,
      ceilingCheck,
      readableLoadStates,
    };
  }

  if (structure.ami === null) {
    return {
      verdict: cannotAssess(ENG_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `the adjusted-mutual-information denominator max(H(C),H(O)) - E[MI] is ` +
            `not positive (H(C)=${structure.entropyClass.toFixed(6)}, ` +
            `H(O)=${structure.entropyOutcome.toFixed(6)}, ` +
            `E[MI]=${structure.expectedMutualInformation.toFixed(6)}). The ` +
            `permutation model already accounts for everything this table could ` +
            `show; no structure reading exists to compare against a threshold.`,
        },
      ]),
      structure,
      diagnostics,
      ceilingCheck,
      readableLoadStates,
    };
  }

  // ── T11 · observed class coverage ────────────────────────────────────────
  //
  // ⛔ PLACED HERE ON PURPOSE, AND THE PLACEMENT WAS MEASURED. This sits AFTER
  //    all three arity gates and BEFORE the ceiling. Put before them, a
  //    single-class record reports "insufficient coverage" instead of
  //    INELIGIBLE_SCOPE — a coarser refusal MASKING a more specific and more
  //    truthful one. Measured 2026-09-30 by running this rule in both
  //    positions over the 22 suites that reach Eng: placed early it moved five
  //    assertions across three suites; placed here it moves NONE.
  //
  //    The order says what the sensor means: arity first, because below it the
  //    question is UNDEFINED; coverage second, because above arity the question
  //    is defined but the evidence may still be too thin to answer.
  //
  // ⚠ COUNTED LOCALLY, NOT FROM `diagnostics`. A4 diagnostics are computed above
  //   and NEVER consulted below, and `diagnostics.perClass` already holds
  //   exactly these counts — which is precisely why reading it here would be the
  //   easy wrong move. A verdict that depends on the diagnostic channel ends
  //   that invariant quietly, and the invariant is what lets a reviewer trust
  //   that the diagnostics cannot have steered the reading.
  {
    const perClassCounts = new Map<string, number>();
    for (const e of entries) {
      const key = classKey(e);
      perClassCounts.set(key, (perClassCounts.get(key) ?? 0) + 1);
    }
    let qualifying = 0;
    for (const c of perClassCounts.values()) {
      if (c >= (classCoverage as number)) qualifying++;
    }
    if (qualifying < (classCoverage as number)) {
      return {
        verdict: cannotAssess(ENG_SENSOR_ID, [
          {
            class: "INSUFFICIENT_SAMPLE",
            detail:
              `${String(qualifying)} observed event class(es) carry at least ` +
              `${String(classCoverage)} events; ${String(classCoverage)} such ` +
              `classes are required. The chain holds ${String(entries.length)} ` +
              `entries over ${String(perClassCounts.size)} distinct class(es), so ` +
              `the row count is not the thing that is short — the class variety ` +
              `is. The read is not attempted.`,
          },
        ]),
        structure,
        diagnostics,
        ceilingCheck,
        readableLoadStates,
      };
    }
  }

  // ── A5 · the ceiling ─────────────────────────────────────────────────────
  //
  // Checked BEFORE the threshold comparison, because a reading at the ceiling
  // is not a reading that passed — it is a reading with no evidence behind it.
  //
  // NOT ALARM. The real judge may be working flawlessly.

  if (ceilingUsable && structure.ami >= AMI_MAXIMUM - (ceilingMargin as number)) {
    return {
      verdict: cannotAssess(ENG_SENSOR_ID, [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `AMI=${structure.ami.toFixed(6)} is at the ceiling: within the injected ` +
            `ceilingMargin of ${String(ceilingMargin)} below the maximum ` +
            `${AMI_MAXIMUM}. At the ceiling the outcome is fully determined by the ` +
            `event class, and A REAL JUDGE AND A CLASS-KEYED LOOKUP TABLE PRODUCE ` +
            `THE IDENTICAL RECORD — same fields, same values, same score. The ` +
            `evidence that would separate them lives WITHIN a class and Eng ` +
            `resolves only at class granularity. This is not a high score, it is ` +
            `an absence of evidence: a scope that looks full and is empty. It is ` +
            `deliberately NOT an alarm, because the real judge may be working ` +
            `flawlessly.`,
        },
      ]),
      structure,
      diagnostics,
      ceilingCheck,
      readableLoadStates,
    };
  }

  // ── The read ─────────────────────────────────────────────────────────────
  //
  // Strictly below the injected threshold alarms. At the threshold exactly,
  // structure has not fallen BELOW the point at which it counts as collapsed,
  // so the sensor stays silent.

  if (structure.ami < (threshold as number)) {
    return {
      verdict: alarm(
        ENG_SENSOR_ID,
        "Engagement signature collapsed: `outcome` is not carrying information " +
          "about (moduleId, eventType) beyond what a reshuffle of the same table " +
          "would produce. This states a property of the record. It makes no claim " +
          "about anything interior to the system.",
        [
          {
            code: "ENG_SIGNATURE_COLLAPSE",
            detail:
              `AMI=${structure.ami.toFixed(6)} < injected structureThreshold=` +
              `${String(threshold)} over ${structure.sampleSize} entries, ` +
              `${structure.distinctClasses} classes, ${structure.distinctOutcomes} ` +
              `distinct outcomes. [plug-in MI=${structure.mutualInformation.toFixed(6)}, ` +
              `E[MI]=${structure.expectedMutualInformation.toFixed(6)}, ` +
              `H(C)=${structure.entropyClass.toFixed(6)}, ` +
              `H(O)=${structure.entropyOutcome.toFixed(6)}]` +
              (structure.permutation === null
                ? ` [permutation percentile ${structure.permutationNote}]`
                : ` [of ${structure.permutation.samples} reshuffles of the same ` +
                  `table, observed MI is strictly above ` +
                  `${(structure.permutation.percentileBelow * 100).toFixed(1)}% and at ` +
                  `or above ` +
                  `${(structure.permutation.percentileAtOrBelow * 100).toFixed(1)}%; ` +
                  `resampled mean=${structure.permutation.resampledMean.toFixed(6)}, ` +
                  `sd=${structure.permutation.resampledStdDev.toFixed(6)}]`),
          },
        ]
      ),
      structure,
      diagnostics,
      ceilingCheck,
      readableLoadStates,
    };
  }

  return {
    // ⛔ T17 · THE MARGINS SURVIVE A QUIET VERDICT. Until this, Eng's SILENT text
    //    carried sampleSize, the class count and AMI, and NOT plug-in MI, E[MI] or
    //    either entropy — while its ALARM detail carried all of them. So a reading
    //    that found nothing left no evidence of HOW it found nothing, and nobody
    //    could state its distance to the threshold afterwards or say when it had
    //    last moved. That is T9's defect (F1 retains its gap only when the gap
    //    already exceeds the tolerance, so a quiet run leaves no number anywhere)
    //    generalised to the dependence family, and it is why "since when did op3
    //    cross its floor?" was unanswerable on 2026-10-02 over 500 decisions.
    //
    //    The wording is Eng's OWN alarm-path wording, copied deliberately: one
    //    convention, so the quiet and the alarming reading can be compared field by
    //    field instead of parsed two ways.
    verdict: silent(
      ENG_SENSOR_ID,
      `${structure.sampleSize} entries across ${structure.distinctClasses} event classes, ` +
        `${structure.distinctOutcomes} distinct outcomes ` +
        `[plug-in MI=${structure.mutualInformation.toFixed(6)}, ` +
        `E[MI]=${structure.expectedMutualInformation.toFixed(6)}, ` +
        `H(C)=${structure.entropyClass.toFixed(6)}, ` +
        `H(O)=${structure.entropyOutcome.toFixed(6)}] ` +
        `(AMI=${structure.ami.toFixed(6)} >= injected structureThreshold=${String(threshold)}` +
        (structure.permutation === null
          ? ""
          : `; observed MI is strictly above ` +
            `${(structure.permutation.percentileBelow * 100).toFixed(1)}% of ` +
            `${structure.permutation.samples} reshuffles of the same table`) +
        `)` +
        (ceilingUsable ? "" : ` ${CEILING_NOT_PERFORMED_NOTE}`)
    ),
    structure,
    diagnostics,
    ceilingCheck,
    readableLoadStates,
  };
}

// ── D7: printed scope, in the code's own output ───────────────────────────────

/**
 * Scope block content as data, so the artifact carries the SAME text the
 * console prints. One source: the printed scope and the written scope cannot
 * drift apart.
 */
export const ENG_SCOPE_TITLE = "MICA/Eng — engagement signature";

export const ENG_SCOPE_READS: readonly string[] = [
      "the declared record's moduleId   } jointly, as the event class C",
      "the declared record's eventType  }",
      "the declared record's outcome      as the dependent value O",
      "the log's own verify()        — readability gate only",
      "the log's own getLoadState()  — readability gate only",
];

export const ENG_SCOPE_DOES_NOT_SEE: readonly string[] = [
      "A SYSTEM WHOSE OUTCOME IS FULLY DETERMINED BY EVENT CLASS. At the ceiling",
      "  Eng returns CANNOT_ASSESS, never SILENT and never ALARM. A REAL JUDGE",
      "  that assesses every case, and a LOOKUP TABLE that reads nothing and",
      "  returns a canned value per class, PRODUCE THE IDENTICAL RECORD. The",
      "  evidence separating them lives within a class; Eng resolves only at",
      "  class granularity, so it has no evidence to choose.",
      "  ACCEPTED COST: a genuinely deterministic, well-engineered component",
      "  reads CANNOT_ASSESS. Eng goes blind precisely where systems are most",
      "  reliable. This is ruled, not overlooked.",
      "  Worse, and worth stating plainly: a system rotting from real judgment",
      "  toward a lookup table has its score go UP, because real judgment is",
      "  messy. No threshold value catches that.",
      "THE BAND BELOW THE CEILING. An attacker holding a mid-range score while",
      "  hollowing out is a known open problem and is NOT solved here. There is",
      "  no baseline, no trend, no rate-of-change and no upper-and-lower band.",
      "Anything interior to the system. This sensor reads a dependency between",
      "  two recorded fields. It does not read, model, or claim anything about",
      "  attention, care, effort, or intent. The object is an ENGAGEMENT",
      "  SIGNATURE; the finding is that a signature collapsed.",
      "WHY the signature collapsed. Templated agreement and injected noise land",
      "  on the same floor by design. The sensor cannot tell them apart and does",
      "  not try to.",
      "Anything in the declared record's timestamp or sequenceNumber. Eng does",
      "  not read them. The declared record carries no hash, no previous-hash, no",
      "  lane tag and no untyped bag at all, so there is nothing else there to",
      "  read even if it did.",
      "Structure that exists but is not expressible as (moduleId, eventType) →",
      "  outcome. A system responding differentially to something not recorded",
      "  in those fields is invisible to Eng.",
      "Any single entry. Eng reads a distribution; it never indicts a record.",
      "Whether a threshold is the right threshold. Calibration is injected and",
      "  comes from pilot data this sensor has never seen.",
      "",
      "REPORTED BUT NEVER ACTED ON (A4). Per-class and windowed figures are",
      "  computed and printed. NO alarm rule, threshold, bound or verdict is",
      "  attached to either, and neither can change a verdict. Whether a single",
      "  collapsed class among four healthy ones should alarm belongs to the",
      "  arbiter, not to this instrument.",
];

/** The whole scope block as text, so the artifact can carry it verbatim. */
export function engScopeBlockText(
  readableLoadStates?: readonly string[]
): string {
  return formatScopeBlock(
    ENG_SCOPE_TITLE,
    ENG_SCOPE_READS,
    ENG_SCOPE_DOES_NOT_SEE,
    ENG_COMPETENCE_LINES,
    loadStateScopeLines(readableLoadStates)
  );
}

export function printEngScope(readableLoadStates?: readonly string[]): void {
  printScopeBlock(
    ENG_SCOPE_TITLE,
    ENG_SCOPE_READS,
    ENG_SCOPE_DOES_NOT_SEE,
    ENG_COMPETENCE_LINES,
    loadStateScopeLines(readableLoadStates)
  );
}
