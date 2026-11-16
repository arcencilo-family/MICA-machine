// ── MICA · OP-3 co-operator response signatures ─────────────────────────────

import type { MicaLogRecord, MicaReadableLog } from "../log";
import type { OperatorEventClass, OperatorLayerProfile } from "../operator-layer-profile";
import {
  alarm,
  assessLogReadability,
  cannotAssess,
  formatScopeBlock,
  loadStateScopeLines,
  printScopeBlock,
  silent,
} from "../types";
import type { BlindPath, Finding, SensorVerdict, VerdictKind } from "../types";
import { COMMON_COMPETENCE_LINES } from "../competence";
import { AMI_MAXIMUM, pairedStructure } from "../stat/ami";
import type { PairedStructure } from "../stat/ami";
import { tupleKey } from "../tuple-key";

export const OP3_NODE_RESPONSE_SENSOR_ID = "MICA/op3-node-response";

export type Op3BlindReasonCode =
  | "OP3_READABILITY_GATE"
  | "OP3_PROFILE_ABSENT"
  | "OP3_PROFILE_VACUOUS"
  | "OP3_PROFILE_MALFORMED"
  | "OP3_FLATNESS_ABSENT"
  | "OP3_FLATNESS_MALFORMED"
  | "OP3_FLATNESS_INSUFFICIENT_SAMPLE"
  | "OP3_FLATNESS_INELIGIBLE_SCOPE"
  // T18, condition 3: two classes, ONE PER CAUSE, never merged. They are not
  // folded into INELIGIBLE_SCOPE because "the sample cannot resolve this
  // comparison" and "this scope cannot be read at all" are different statements,
  // and a census that cannot tell them apart cannot tell a calibration problem
  // from a record problem.
  | "OP3_FLATNESS_UNRESOLVABLE_AT_FLOOR"
  | "OP3_FLATNESS_UNRESOLVABLE_AT_CEILING"
  | "OP3_CALL_PENDING_OPEN_END";

export interface Op3Pair {
  readonly expectation: {
    readonly sequenceNumber: number;
    readonly eventType: string;
  };
  readonly response: {
    readonly sequenceNumber: number;
    readonly outcome: string;
  };
  /** Nearest preceding non-expectation/non-response class; null is disclosed. */
  readonly contextClass: string | null;
}

export interface Op3LegResult {
  readonly verdict: SensorVerdict;
  readonly blindReasonCodes: readonly Op3BlindReasonCode[];
}

export interface Op3NodeResponseResult {
  readonly verdict: SensorVerdict;
  readonly blindReasonCodes: readonly Op3BlindReasonCode[];
  readonly legA: Op3LegResult;
  readonly legB: Op3LegResult;
  readonly pairs: readonly Op3Pair[];
  readonly pendingNotAssessed: number;
  readonly flatnessContextExcluded: number;
  readonly flatnessStructure: PairedStructure | null;
}

export const OP3_BOUNDED_RESPONSE_CEILING =
  "LEG A BOUNDED MODE: the next matching response in (s, s+B] satisfies; exact B conforms, B+1 does not, and an expectation whose window extends past the readable end is pending-not-assessed.";

export const OP3_ORDER_ONLY_RESPONSE_CEILING =
  "LEG A ORDER-ONLY / LOUDER: response delay is unbounded — any later matching response in the readable range satisfies.";

export const OP3_SHARED_RESPONSE_CEILING =
  "OVERLAPPING EXPECTATIONS SHARE A RESPONSE: each expectation pairs independently to the next matching response, so several calls can share one response and mask a one-response-per-call deficit. The record declares no call-to-response binding.";

export const OP3_DECLARED_CALLS_CEILING =
  "CALLS ARE DECLARED, NEVER DETECTED — this leg pairs only the DECLARED expectation class; a real call logged under an undeclared type is invisible, and the zero-expectation SILENT is silence about the declared class only, never about the deployment's calls.";

// OP3_VOCABULARY_CEILING_FENCE_START
export const OP3_NODE_RESPONSE_CEILING_LINES: readonly string[] = [
  "POLE-SHAPED SHADOW, NEVER CAUSE — off-axis causes (capture, fatigue, incentive, incompetence, brittleness) cast pole-shaped shadows; the record types the symptom, never the cause. COLLUSION CASTS NO SHADOW — a named blind spot.",
  "THE CONSUMER-SEMANTICS FIREWALL — these symptoms may not certify human merit, assign blame, or determine role removal without an external due-process layer; a consumer claiming MICA-conformant consumption is bound by that. Findings are counts and gaps, a self-mirror offered to the node, never a leash.",
  "NON-INTERIOR — ‘N unanswered calls,’ never ‘this human is negligent.’ No interior of the human is implied by any finding.",
  "FLATNESS CEILING — at maximum AMI coherence this leg cannot distinguish diligence from a table and says CANNOT_ASSESS; below the floor it cannot distinguish fatigue from abdication from institutional pressure and does not try.",
  "LEG C PARKED — the over-grip pole (override past record-warrant) is a content judgment this evidence class cannot make; its class-adjacency form was deliberately not built; this instrument reads over-yield's two signatures only.",
  OP3_SHARED_RESPONSE_CEILING,
  OP3_DECLARED_CALLS_CEILING,
];
export const OP3_NODE_RESPONSE_CEILING_FENCE_END = true;
// OP3_VOCABULARY_CEILING_FENCE_END

const OP3_SITE_THIRTEEN =
  "SITE THIRTEEN FLAGGED (one layer-profile, three sections, per-section vacuity independent — arbiter-ruled (ii), 2026-08-21).";

const OP3_COMPETENCE_LINES: readonly string[] = [
  ...COMMON_COMPETENCE_LINES,
  "That the reader treats every result as a record-shape symptom and never as an interior claim about a person.",
  "That the reader keeps ALARM, statistical blindness, and at-ceiling evidence failure distinct under the worst-of composition rule.",
  "That the reader applies the consumer-semantics firewall: no merit certificate, blame assignment, or role-removal decision follows without external due process.",
];

function ceilingText(modeLine?: string): string {
  return [modeLine, ...OP3_NODE_RESPONSE_CEILING_LINES, OP3_SITE_THIRTEEN]
    .filter((line): line is string => line !== undefined).join(" || ");
}

function withCeilings(verdict: SensorVerdict, modeLine?: string): SensorVerdict {
  return { ...verdict, summary: `${verdict.summary} || CEILINGS: ${ceilingText(modeLine)}` };
}

function usableClass(value: OperatorEventClass | undefined): value is OperatorEventClass {
  return value !== undefined &&
    typeof value.moduleId === "string" && value.moduleId.trim().length > 0 &&
    typeof value.eventType === "string" && value.eventType.trim().length > 0;
}

function sameClass(left: OperatorEventClass, right: OperatorEventClass): boolean {
  return left.moduleId === right.moduleId && left.eventType === right.eventType;
}

function matches(record: MicaLogRecord, eventClass: OperatorEventClass): boolean {
  return record.moduleId === eventClass.moduleId && record.eventType === eventClass.eventType;
}

function contextClass(record: MicaLogRecord): string {
  return tupleKey([record.moduleId, record.eventType]);
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function usableFraction(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value < 1;
}

function rank(kind: VerdictKind): number {
  return kind === "ALARM" ? 2 : kind === "CANNOT_ASSESS" ? 1 : 0;
}

function compose(legA: SensorVerdict, legB: SensorVerdict, modeLine: string): SensorVerdict {
  const worst = rank(legA.kind) >= rank(legB.kind) ? legA.kind : legB.kind;
  const blindDisclosure = (verdict: SensorVerdict): string =>
    verdict.kind === "CANNOT_ASSESS"
      ? ` [blind detail: ${verdict.blindPaths.map((path) => path.detail).join(" | ")}]`
      : "";
  const summary =
    `OP-3 composes TWO legs by the worst-of floor (ALARM > CANNOT_ASSESS > SILENT). ` +
    `|| [LEG A unanswered-call / ${legA.kind}] ${legA.summary}${blindDisclosure(legA)} ` +
    `|| [LEG B response-flatness / ${legB.kind}] ${legB.summary}${blindDisclosure(legB)}`;
  if (worst === "ALARM") {
    const findings: Finding[] = [
      ...(legA.kind === "ALARM" ? legA.findings : []),
      ...(legB.kind === "ALARM" ? legB.findings : []),
    ];
    return withCeilings({ kind: "ALARM", sensorId: OP3_NODE_RESPONSE_SENSOR_ID, summary, findings }, modeLine);
  }
  if (worst === "CANNOT_ASSESS") {
    const blindPaths: BlindPath[] = [
      ...(legA.kind === "CANNOT_ASSESS" ? legA.blindPaths : []),
      ...(legB.kind === "CANNOT_ASSESS" ? legB.blindPaths : []),
    ];
    return withCeilings({ kind: "CANNOT_ASSESS", sensorId: OP3_NODE_RESPONSE_SENSOR_ID, summary, blindPaths }, modeLine);
  }
  return withCeilings({ kind: "SILENT", sensorId: OP3_NODE_RESPONSE_SENSOR_ID, summary }, modeLine);
}

function globalBlind(code: Op3BlindReasonCode, path: BlindPath): Op3NodeResponseResult {
  const verdict = withCeilings(cannotAssess(OP3_NODE_RESPONSE_SENSOR_ID, [path]));
  const leg = { verdict, blindReasonCodes: [code] };
  return {
    verdict,
    blindReasonCodes: [code],
    legA: leg,
    legB: leg,
    pairs: [],
    pendingNotAssessed: 0,
    flatnessContextExcluded: 0,
    flatnessStructure: null,
  };
}

/**
 * What ONE record can move the statistic by — the sample's own granularity.
 *
 * ⛔ WHY A GATE NEEDS THIS AT ALL (T18, the arbiter's grant). `ami < amiFloor` is a
 *    comparison between a number computed from a finite table and an injected
 *    constant, and nothing in the reader asked whether the table is fine-grained
 *    enough for the comparison to mean anything. A verdict one record could reverse
 *    is not a reading of the population; it is a reading of one record. Measured on
 *    the live box 2026-10-02: AMI 0.198605 sat 0.001395 from its floor while one
 *    record could move it by 0.004–0.008 — the alarm was inside the noise of its
 *    own granularity.
 *
 * ⛔ THE CHEAP FORM IS REQUIRED, NOT AN OPTIMISATION (condition 6). AMI is a
 *    function of the contingency TABLE, not of which record moved, so the distinct
 *    one-record moves are the (context, from-outcome, to-outcome) triples whose
 *    source cell is non-empty: at most kC·kO·(kO−1), and **n drops out of the
 *    count**. Measured: recomputes fall 646 → 18 at n=323/3×3 and 7055 → 180 at
 *    n=1411/6×6, with the quantum identical to the last digit. The brute force
 *    costs 56.3 s per decision at n=2000/8×8 and is O(n²) in the window — it would
 *    have made this reader the thing that stalls the agent it watches.
 *
 * ⚠ IT TAKES NO INJECTED NUMBER. The quantum is measured from the table, so there
 *   is nothing to tune and nothing to add to the declaration (condition 5).
 */
export interface OneRecordQuantum {
  /** The largest |ΔAMI| any single record move produces. */
  readonly quantum: number;
  /** The move that achieved it, in the reader's own words (condition 4). */
  readonly move: string;
  /** How many AMI recomputes it took — asserted against kC·kO·(kO−1). */
  readonly recomputes: number;
  /**
   * T39 (NARROWED, audit 2026-10-18 06:56Z): the first single move that leaves the table with ONE context class —
   * below op3's arity gate, where AMI is undefined — named in the reader's words; null when no move does. Such a
   * move is NOT a quantum (it never enters `quantum`): the table reads INELIGIBLE, not unbounded.
   */
  readonly belowArityGateBy: string | null;
}

export function oneRecordQuantum(
  left: readonly string[],
  right: readonly string[],
  base: number
): OneRecordQuantum {
  const contexts = [...new Set(left)];
  const outcomes = [...new Set(right)];
  // One representative index per (context, outcome) cell. Which record is moved
  // cannot matter — the statistic reads the table — so one per cell is the whole
  // distinct move set.
  // ⛔ T22 · THE KEY IS THE HOUSE'S OWN COLLISION-PROOF ONE, AND THE PARTS ARE
  //    CARRIED RATHER THAN PARSED BACK OUT. Two defects were stacked here:
  //
  //    (a) T18 hand-rolled `${left}\u0001${right}` — an ASSUMED-FORBIDDEN
  //        delimiter — three weeks after `src/mica/tuple-key.ts` was written to
  //        kill exactly that pattern. Its header says why in its own words: the
  //        safety "rests entirely on NUL never appearing inside a component, which
  //        is a property of the INPUT, not of the encoding." narrow-W/R/K had the
  //        same bug, it was fixed once and shared, and this reader reinvented it.
  //
  //    (b) T20 then PARSED that key back into its parts with `indexOf`, which made
  //        a latent ambiguity into a live miscount. Codex, 2026-10-03: one U+0001
  //        in a context label gives 12 recomputes where the invariant says 8; this
  //        seat reproduced 12 with one label and 16 with two.
  //
  //    The parse is gone. `tupleKey` is length-prefixed and uniquely decodable, so
  //    the SET is right for any content; and carrying `context`/`outcome` in the
  //    value means there is nothing to decode at all. One encoding, one source.
  const representative = new Map<string, { readonly index: number; readonly context: string; readonly outcome: string }>();
  for (let i = 0; i < left.length; i++) {
    const cell = tupleKey([left[i], right[i]]);
    if (!representative.has(cell)) representative.set(cell, { index: i, context: left[i], outcome: right[i] });
  }
  let quantum = 0;
  let move = "no single-record move changes the statistic";
  let recomputes = 0;
  // ⛔ T20 · THE MOVE SET IS EVERY RELABEL OF ONE RECORD, NOT EVERY RELABEL OF ITS
  //    OUTCOME. A record is one ROW of the contingency table and a row carries TWO
  //    labels; T18's definition could move only the right-hand one, which was a
  //    limit of the implementation and not of the question. The arbiter's grant:
  //    "so that the quantum it compares against is never smaller than the record's
  //    reach". The broad set CONTAINS the narrow one, so the maximum cannot
  //    decrease and adopting it can only withdraw a verdict, never create one.
  // ⛔ T39 · NARROWED (audit 2026-10-18 06:56Z, ruling (1)): "a one-record move that only drops the table below
  //    op3's arity gate reads INELIGIBLE (CANNOT_ASSESS), not unbounded; the flat-signature ALARM stays readable
  //    wherever every context class holds ≥ 2 records". a0d3017 SKIPPED a move whose AMI is null, so AAB × YYY read
  //    quantum 0 and ALARMed at AMI 0 although one record stands between the table and the arity gate. The move is
  //    now RECORDED, never measured: it does not enter the quantum (no +Infinity — that was the first T39 draft's
  //    wider reading), and the reader withdraws the comparison as INELIGIBLE_SCOPE, the class the gate itself uses.
  //    ⚠ WHY "AMI null" IS EXACTLY "below the arity gate" HERE (derived, and pinned exhaustively by the op3 arm
  //    "T39 · every reachable undefined move is an arity drop"): AMI's denominator max(H(context),H(outcome)) − E[MI]
  //    is 0 only when both axes are constant or both are all-distinct; a relabel only ever moves a record onto a
  //    label already present, so it cannot make an axis all-distinct, and with distinctLeft ≥ 2 already required by
  //    the gate the only way in is: outcome axis already constant, and the record moved is a context's lone record.
  let belowArityGateBy: string | null = null;
  const consider = (shifted: number | null, describe: () => string): void => {
    recomputes++;
    if (shifted === null) {
      if (belowArityGateBy === null) belowArityGateBy = `${describe()} leaves ONE context class (below the arity gate; AMI undefined)`;
      return;
    }
    const delta = Math.abs(shifted - base);
    if (delta > quantum) { quantum = delta; move = `${describe()} moves AMI by ${delta.toFixed(6)}`; }
  };
  for (const { index, context, outcome: from } of representative.values()) {
    // OUTCOME relabels — T18's set, unchanged. The axis is NAMED in the move
    // string (condition 4): a quantum whose largest move cannot be attributed to
    // an axis is a number without a mechanism, and on the measured table of the
    // live shape the winner was a CONTEXT relabel.
    for (const to of outcomes) {
      if (to === from) continue;
      const moved = right.slice();
      moved[index] = to;
      consider(pairedStructure(left, moved).ami, () =>
        `OUTCOME relabel in context ${JSON.stringify(context)}: one record from outcome ${JSON.stringify(from)} to ${JSON.stringify(to)}`);
    }
    // CONTEXT relabels — T20's addition.
    for (const to of contexts) {
      if (to === context) continue;
      const moved = left.slice();
      moved[index] = to;
      consider(pairedStructure(moved, right).ami, () =>
        `CONTEXT relabel at outcome ${JSON.stringify(from)}: one record from context ${JSON.stringify(context)} to ${JSON.stringify(to)}`);
    }
  }
  return { quantum, move, recomputes, belowArityGateBy };
}

export function assessOp3NodeResponse(
  log: MicaReadableLog,
  profile: OperatorLayerProfile | undefined,
  readableLoadStates?: readonly string[]
): Op3NodeResponseResult {
  const unreadable = assessLogReadability(log, OP3_NODE_RESPONSE_SENSOR_ID, readableLoadStates);
  if (unreadable !== null) {
    return globalBlind("OP3_READABILITY_GATE", unreadable.blindPaths[0]);
  }

  const section = profile?.nodeResponse;
  if (section === undefined) {
    return globalBlind("OP3_PROFILE_ABSENT", {
      class: "MISSING_CONFIGURATION",
      detail: "OP3_PROFILE_ABSENT: no nodeResponse section was injected; another operator-profile section cannot repair it.",
    });
  }
  if (!usableClass(section.expectationClass) || !usableClass(section.responseClass) ||
      sameClass(section.expectationClass, section.responseClass)) {
    return globalBlind("OP3_PROFILE_VACUOUS", {
      class: "MISSING_CONFIGURATION",
      detail: "OP3_PROFILE_VACUOUS: nodeResponse requires two non-empty, distinct expectation and response classes.",
    });
  }
  if (section.responseBoundSteps !== undefined && !positiveInteger(section.responseBoundSteps)) {
    return globalBlind("OP3_PROFILE_MALFORMED", {
      class: "MISSING_CONFIGURATION",
      detail: "OP3_PROFILE_MALFORMED: responseBoundSteps must be a positive integer when present.",
    });
  }

  const ordered = [...log.getAll()].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const expectations = ordered.filter((record) => matches(record, section.expectationClass));
  const responses = ordered.filter((record) => matches(record, section.responseClass));
  const end = ordered.length === 0 ? undefined : ordered[ordered.length - 1].sequenceNumber;
  const bound = section.responseBoundSteps;
  const modeLine = bound === undefined ? OP3_ORDER_ONLY_RESPONSE_CEILING : OP3_BOUNDED_RESPONSE_CEILING;
  const pairs: Op3Pair[] = [];
  const findings: Finding[] = [];
  let pendingNotAssessed = 0;

  for (const expectation of expectations) {
    const response = responses.find((candidate) =>
      candidate.sequenceNumber > expectation.sequenceNumber &&
      (bound === undefined || candidate.sequenceNumber <= expectation.sequenceNumber + bound)
    );
    if (response !== undefined) {
      const context = [...ordered].reverse().find((candidate) =>
        candidate.sequenceNumber < expectation.sequenceNumber &&
        !matches(candidate, section.expectationClass) &&
        !matches(candidate, section.responseClass)
      );
      pairs.push({
        expectation: {
          sequenceNumber: expectation.sequenceNumber,
          eventType: expectation.eventType,
        },
        response: {
          sequenceNumber: response.sequenceNumber,
          outcome: response.outcome,
        },
        contextClass: context === undefined ? null : contextClass(context),
      });
      continue;
    }
    if (bound !== undefined && (end === undefined || end < expectation.sequenceNumber + bound)) {
      pendingNotAssessed++;
      continue;
    }
    const elapsed = end === undefined ? 0 : end - expectation.sequenceNumber;
    findings.push({
      code: "OP3_CALL_UNANSWERED",
      detail: `expectation at sequence ${expectation.sequenceNumber} has no qualifying later response; readable elapsed span is ${elapsed} sequence-step(s).`,
    });
  }

  let legAVerdict: SensorVerdict;
  let legABlindReasonCodes: Op3BlindReasonCode[] = [];
  if (findings.length > 0) {
    legAVerdict = withCeilings(
      alarm(
        OP3_NODE_RESPONSE_SENSOR_ID,
        `${findings.length} expectation record(s) have no qualifying later response; ${pendingNotAssessed} open-end expectation(s) remain pending-not-assessed.`,
        findings
      ),
      modeLine
    );
  } else if (pendingNotAssessed > 0) {
    legAVerdict = withCeilings(
      cannotAssess(OP3_NODE_RESPONSE_SENSOR_ID, [{
        class: "INSUFFICIENT_SAMPLE",
        detail:
          `OP3_CALL_PENDING_OPEN_END: ${pendingNotAssessed} expectation window(s) ` +
          `extend past the readable range end. They are pending-not-assessed, ` +
          `not breaches and not a completed silent read.`,
      }]),
      modeLine
    );
    legABlindReasonCodes = ["OP3_CALL_PENDING_OPEN_END"];
  } else {
    legAVerdict = withCeilings(
      silent(
        OP3_NODE_RESPONSE_SENSOR_ID,
        expectations.length === 0
          ? "the readable range; zero expectation records means there were no calls to answer"
          : `${expectations.length} expectation record(s); ${pairs.length} paired and ${pendingNotAssessed} pending-not-assessed at the open end`
      ),
      modeLine
    );
  }
  const legA: Op3LegResult = { verdict: legAVerdict, blindReasonCodes: legABlindReasonCodes };

  let legB: Op3LegResult;
  let flatnessStructure: PairedStructure | null = null;
  const flatnessPairs = pairs.filter(
    (pair): pair is Op3Pair & { readonly contextClass: string } => pair.contextClass !== null
  );
  const flatnessContextExcluded = pairs.length - flatnessPairs.length;
  const contextDisclosure =
    ` LEG-B CONTEXT SAMPLE: ${flatnessPairs.length} paired expectation(s) had a ` +
    `nearest preceding option-A complement context; ${flatnessContextExcluded} ` +
    `paired expectation(s) had none and were counted and EXCLUDED from AMI.`;
  const discloseContext = (verdict: SensorVerdict): SensorVerdict => ({
    ...verdict,
    summary: verdict.summary + contextDisclosure,
  });
  const flatness = section.flatness;
  if (flatness === undefined) {
    legB = {
      verdict: withCeilings(discloseContext(cannotAssess(OP3_NODE_RESPONSE_SENSOR_ID, [{
        class: "MISSING_CONFIGURATION",
        detail: "OP3_FLATNESS_ABSENT: no flatness configuration was injected. Leg B is blind; this does not erase a leg-A alarm.",
      }])), modeLine),
      blindReasonCodes: ["OP3_FLATNESS_ABSENT"],
    };
  } else if (!usableFraction(flatness.amiFloor) || !usableFraction(flatness.amiCeilingMargin) ||
      !Number.isInteger(flatness.minSample) || flatness.minSample < 3) {
    legB = {
      verdict: withCeilings(discloseContext(cannotAssess(OP3_NODE_RESPONSE_SENSOR_ID, [{
        class: "MISSING_CONFIGURATION",
        detail: "OP3_FLATNESS_MALFORMED: amiFloor and amiCeilingMargin must be finite values in (0,1), and minSample must be an integer at least 3.",
      }])), modeLine),
      blindReasonCodes: ["OP3_FLATNESS_MALFORMED"],
    };
  } else if (flatnessPairs.length < flatness.minSample) {
    legB = {
      verdict: withCeilings(discloseContext(cannotAssess(OP3_NODE_RESPONSE_SENSOR_ID, [{
        class: "INSUFFICIENT_SAMPLE",
        detail:
          `OP3_FLATNESS_INSUFFICIENT_SAMPLE: ${flatnessPairs.length} context-bearing ` +
          `leg-A pair(s) are below injected minSample ${flatness.minSample}; ` +
          `${flatnessContextExcluded} pair(s) without a preceding context were excluded.`,
      }])), modeLine),
      blindReasonCodes: ["OP3_FLATNESS_INSUFFICIENT_SAMPLE"],
    };
  } else {
    const left = flatnessPairs.map((pair) => pair.contextClass);
    const right = flatnessPairs.map((pair) => pair.response.outcome);
    flatnessStructure = pairedStructure(left, right);
    // T18's gate writes its finding here so the branch condition and the branch
    // body read the same measurement — computing the quantum twice would let the
    // two disagree, which is the shape this reader exists to refuse.
    let unresolvable:
      | { at: "FLOOR" | "CEILING"; distance: number; other: boolean; q: OneRecordQuantum }
      | null = null;
    // T39: the one quantum both the arity-ahead branch and T18's gate read (set in the first of them).
    let quantumOnce: OneRecordQuantum | null = null;

    // ── T17 · THE MARGINS, ON EVERY PATH THAT REACHES THE STATISTIC ──────────
    //
    // ⛔ WHY. op3 was the ONLY dependence reader that did not disclose. Measured
    //    2026-10-02 across all six: Eng, narrow-W, narrow-K, narrow-R and
    //    narrow-T each print plug-in MI, E[MI], the entropies and a permutation
    //    note; op3 printed AMI and a pair count and nothing else, on any path.
    //
    //    What that cost, exactly: on 2026-10-02 at 10:48Z this reader alarmed
    //    with AMI=0.190410 over 320 pairs against floor 0.2 and HELD THE BOX, and
    //    nobody — operator, build seat or arbiter — could say whether that was a
    //    reading or the chance correction, because the numbers that decide it were
    //    not printed. narrow-W's alarm the same morning WAS adjudicable in one
    //    pass from its output alone: its 36/36 × 2/70 table was recovered uniquely
    //    from these same fields and its AMI reproduced to six places, without
    //    reading the subject log, which the operator uid cannot read at all.
    //
    // ⚠ PURE EMISSION. `pairedStructure` already computes every field below; this
    //   block prints what the verdict was already taken from. No new statistic, no
    //   second computation — a second E[MI] beside the first is the seam this
    //   project has paid for nine times.
    //
    // ⚠ AXIS NAMES, NOT "left" AND "right". op3's CONDITIONING axis is its LEFT
    //   (does the outcome track what the call was about), which is the opposite
    //   side from narrow-W/K/R. A reader of this output must not have to know that.
    //
    // AMI IS DELIBERATELY NOT IN THIS BLOCK: the `ami === null` path below reaches
    // it with no AMI to print, so each branch prints its own AMI where it has one.
    const flatnessPermNote =
      flatnessStructure.permutation === null
        ? ` [permutation percentile ${flatnessStructure.permutationNote}]`
        : ` [of ${flatnessStructure.permutation.samples} reshuffles of the same table, ` +
          `observed MI is strictly above ` +
          `${(flatnessStructure.permutation.percentileBelow * 100).toFixed(1)}% and at or ` +
          `above ${(flatnessStructure.permutation.percentileAtOrBelow * 100).toFixed(1)}%; ` +
          `resampled mean=${flatnessStructure.permutation.resampledMean.toFixed(6)}, ` +
          `sd=${flatnessStructure.permutation.resampledStdDev.toFixed(6)}]`;
    const flatnessMarginNote =
      `over ${flatnessPairs.length} context-bearing pair(s), ` +
      `${flatnessStructure.distinctLeft} CONTEXT class(es) against ` +
      `${flatnessStructure.distinctRight} OUTCOME class(es) ` +
      `[plug-in MI=${flatnessStructure.mutualInformation.toFixed(6)}, ` +
      `E[MI]=${flatnessStructure.expectedMutualInformation.toFixed(6)}, ` +
      `H(context)=${flatnessStructure.entropyLeft.toFixed(6)}, ` +
      `H(outcome)=${flatnessStructure.entropyRight.toFixed(6)}, ` +
      `n=${flatnessStructure.sampleSize}]`;

    if (flatnessStructure.distinctLeft < 2) {
      legB = {
        verdict: withCeilings(discloseContext(cannotAssess(OP3_NODE_RESPONSE_SENSOR_ID, [{
          class: "INELIGIBLE_SCOPE",
          detail:
            `OP3_FLATNESS_INELIGIBLE_SCOPE: the context-bearing sample contains one distinct context class. H(context)=0, so differential response across what calls were about cannot be read from this single-context stream. ${flatnessMarginNote}${flatnessPermNote}`,
        }])), modeLine),
        blindReasonCodes: ["OP3_FLATNESS_INELIGIBLE_SCOPE"],
      };
    } else if (flatnessStructure.ami === null) {
      legB = {
        verdict: withCeilings(discloseContext(cannotAssess(OP3_NODE_RESPONSE_SENSOR_ID, [{
          class: "INELIGIBLE_SCOPE",
          detail: `OP3_FLATNESS_INELIGIBLE_SCOPE: the adjusted-mutual-information denominator is not positive, so no floor or ceiling comparison exists. ${flatnessMarginNote}${flatnessPermNote}`,
        }])), modeLine),
        blindReasonCodes: ["OP3_FLATNESS_INELIGIBLE_SCOPE"],
      };
    } else if (
      // ── T39 · ONE RECORD ABOVE THE ARITY GATE (NARROWED) ─────────────────────
      //
      // ⛔ AFTER the arity gate and the null-denominator check, BEFORE T18's gate: it is the arity gate's own question
      //    asked one record ahead. If one record's relabel leaves one context class, whether this table has a
      //    context axis at all rests on that record, so the reading is INELIGIBLE — the gate's class and code, with
      //    the move named — never an ALARM at AMI 0 and never an unbounded quantum. The quantum is computed ONCE
      //    here and the T18 gate below reads the same object (one measurement, both branch conditions).
      (() => {
        quantumOnce = oneRecordQuantum(left, right, flatnessStructure.ami);
        return quantumOnce.belowArityGateBy !== null;
      })()
    ) {
      const q = quantumOnce as unknown as OneRecordQuantum;
      legB = {
        verdict: withCeilings(discloseContext(cannotAssess(OP3_NODE_RESPONSE_SENSOR_ID, [{
          class: "INELIGIBLE_SCOPE",
          detail:
            `OP3_FLATNESS_INELIGIBLE_SCOPE: ONE RECORD holds this table above the arity gate — ${q.belowArityGateBy as string}. Without it the context-bearing sample has one distinct context class (H(context)=0), the scope this leg cannot read, so the context axis is that record's and not the population's: AMI=${flatnessStructure.ami.toFixed(6)} is printed, not compared, and no floor or ceiling comparison is made. ${flatnessMarginNote}${flatnessPermNote}`,
        }])), modeLine),
        blindReasonCodes: ["OP3_FLATNESS_INELIGIBLE_SCOPE"],
      };
    } else if (
      // ── T18 · THE RESOLVING-POWER GATE ──────────────────────────────────────
      //
      // ⛔ AFTER the arity gate and the null-denominator check, BEFORE the floor
      //    and ceiling comparisons (condition 1). It changes which branch is
      //    taken and no threshold, no declared value, and no constant.
      //
      // ⛔ SYMMETRIC, BY THE ARBITER'S OWN WORDS: "in either direction, so that an
      //    alarm is never an artefact of granularity and a silence never a gift of
      //    it." A SILENT that one record could turn into an ALARM is exactly as
      //    unsupportable as the ALARM. A rule that only ever downgraded alarms
      //    would be calibration by outcome wearing a statistic's clothes.
      (() => {
        const q = quantumOnce as unknown as OneRecordQuantum;
        const ceiling = AMI_MAXIMUM - flatness.amiCeilingMargin;
        const toFloor = Math.abs(flatnessStructure.ami - flatness.amiFloor);
        const toCeiling = Math.abs(flatnessStructure.ami - ceiling);
        unresolvable =
          toCeiling <= q.quantum
            ? { at: "CEILING", distance: toCeiling, other: toFloor <= q.quantum, q }
            : toFloor <= q.quantum
              ? { at: "FLOOR", distance: toFloor, other: false, q }
              : null;
        return unresolvable !== null;
      })()
    ) {
      // Two classes, one per cause, NEVER merged (condition 3). The chosen cause
      // is named; when the other distance is also inside the quantum the detail
      // says so rather than hiding it behind one label.
      const u = unresolvable as NonNullable<typeof unresolvable>;
      const bothNote = u.other
        ? " The distance to the FLOOR is also inside the quantum, so neither comparison is resolvable on this table."
        : "";
      legB = {
        verdict: withCeilings(discloseContext(cannotAssess(OP3_NODE_RESPONSE_SENSOR_ID, [{
          class: "INELIGIBLE_SCOPE",
          detail:
            `OP3_FLATNESS_UNRESOLVABLE_AT_${u.at}: AMI=${flatnessStructure.ami.toFixed(6)} sits ${u.distance.toFixed(6)} from the ${u.at === "FLOOR" ? `injected floor ${flatness.amiFloor}` : `injected ceiling ${(AMI_MAXIMUM - flatness.amiCeilingMargin).toFixed(6)}`}, and ONE RECORD can move AMI by ${u.q.quantum.toFixed(6)} — ${u.q.move}. A verdict one record could reverse is a reading of that record, not of the population, so no comparison is made in either direction.${bothNote} ${flatnessMarginNote}${flatnessPermNote}`,
        }])), modeLine),
        // ⛔ T20 · BOTH CODES WHEN BOTH BOUNDARIES ARE INSIDE THE QUANTUM. The
        //    arbiter: "never one in code and the other in prose". T18 named the
        //    chosen cause in the code and the other one in `bothNote` only, so a
        //    consumer reading reason codes saw one unresolvable boundary where
        //    there were two. The detail string still names which boundary the
        //    sentence is about; the codes now carry both, ceiling first.
        blindReasonCodes: u.other
          ? ["OP3_FLATNESS_UNRESOLVABLE_AT_CEILING", "OP3_FLATNESS_UNRESOLVABLE_AT_FLOOR"]
          : [`OP3_FLATNESS_UNRESOLVABLE_AT_${u.at}`],
      };
    } else if (flatnessStructure.ami >= AMI_MAXIMUM - flatness.amiCeilingMargin) {
      legB = {
        verdict: withCeilings(discloseContext(cannotAssess(OP3_NODE_RESPONSE_SENSOR_ID, [{
          class: "INELIGIBLE_SCOPE",
          detail: `AMI=${flatnessStructure.ami.toFixed(6)} is within injected ceiling margin ${flatness.amiCeilingMargin} of ${AMI_MAXIMUM}; a diligent responder and a lookup table produce the identical record. ${flatnessMarginNote}${flatnessPermNote}`,
        }])), modeLine),
        blindReasonCodes: ["OP3_FLATNESS_INELIGIBLE_SCOPE"],
      };
    } else if (flatnessStructure.ami < flatness.amiFloor) {
      legB = {
        verdict: withCeilings(discloseContext(alarm(OP3_NODE_RESPONSE_SENSOR_ID,
          "The paired context-to-response-outcome stream is below the injected AMI floor; outcomes are decoupled from what the declared calls were about. This is a present-but-flat record signature, never a claim about a person.", [{
            code: "OP3_RESPONSE_FLATLINE",
            detail: `AMI=${flatnessStructure.ami.toFixed(6)} is below injected floor ${flatness.amiFloor} ${flatnessMarginNote}${flatnessPermNote}; ${flatnessContextExcluded} pair(s) were excluded for no preceding context.`,
          }])), modeLine),
        blindReasonCodes: [],
      };
    } else {
      legB = {
        verdict: withCeilings(discloseContext(silent(OP3_NODE_RESPONSE_SENSOR_ID,
          `AMI=${flatnessStructure.ami.toFixed(6)} is neither below the injected floor nor at the injected ceiling, ${flatnessMarginNote}${flatnessPermNote}; ${flatnessContextExcluded} pair(s) were excluded for no preceding context`)), modeLine),
        blindReasonCodes: [],
      };
    }
  }

  const blindReasonCodes = [...legA.blindReasonCodes, ...legB.blindReasonCodes];
  return {
    verdict: compose(legA.verdict, legB.verdict, modeLine),
    blindReasonCodes,
    legA,
    legB,
    pairs,
    pendingNotAssessed,
    flatnessContextExcluded,
    flatnessStructure,
  };
}

function sectionStatus(profile: OperatorLayerProfile | undefined): string {
  const section = profile?.nodeResponse;
  if (section === undefined) return "nodeResponse section status: ABSENT (OP3_PROFILE_ABSENT).";
  if (!usableClass(section.expectationClass) || !usableClass(section.responseClass) || sameClass(section.expectationClass, section.responseClass)) return "nodeResponse section status: VACUOUS (OP3_PROFILE_VACUOUS).";
  if (section.responseBoundSteps !== undefined && !positiveInteger(section.responseBoundSteps)) return "nodeResponse section status: MALFORMED (OP3_PROFILE_MALFORMED).";
  if (section.flatness === undefined) return `nodeResponse section status: DECLARED (${section.responseBoundSteps === undefined ? "order-only" : "bounded"}); flatness leg ABSENT.`;
  if (!usableFraction(section.flatness.amiFloor) || !usableFraction(section.flatness.amiCeilingMargin) || !Number.isInteger(section.flatness.minSample) || section.flatness.minSample < 3) return "nodeResponse section status: response leg DECLARED; flatness leg MALFORMED (OP3_FLATNESS_MALFORMED).";
  return `nodeResponse section status: DECLARED (${section.responseBoundSteps === undefined ? "order-only" : "bounded"}); flatness configured.`;
}

export function op3NodeResponseScopeBlockText(profile?: OperatorLayerProfile, readableLoadStates?: readonly string[]): string {
  return formatScopeBlock(
    "MICA/op3-node-response — unanswered-call + response-flatness signatures",
    [
      "sequenceNumber for next-response pairing and optional response bounds; never as time.",
      "moduleId + eventType to match the injected expectation and response classes.",
      "the nearest preceding non-expectation/non-response (moduleId,eventType) context class + paired response outcome for leg-B stat/ami; pairs without context are counted and excluded.",
      "verify(), getLoadState(), and getAll() through the shared readability gate.",
    ],
    [...OP3_NODE_RESPONSE_CEILING_LINES, OP3_BOUNDED_RESPONSE_CEILING, OP3_ORDER_ONLY_RESPONSE_CEILING],
    OP3_COMPETENCE_LINES,
    [sectionStatus(profile), OP3_SITE_THIRTEEN, ...loadStateScopeLines(readableLoadStates)]
  );
}

export function printOp3NodeResponseScope(profile?: OperatorLayerProfile, readableLoadStates?: readonly string[]): void {
  printScopeBlock(
    "MICA/op3-node-response — unanswered-call + response-flatness signatures",
    ["sequenceNumber pairing, injected class matches, nearest preceding option-A complement context, and paired response outcome; no timestamp."],
    [...OP3_NODE_RESPONSE_CEILING_LINES, OP3_BOUNDED_RESPONSE_CEILING, OP3_ORDER_ONLY_RESPONSE_CEILING],
    OP3_COMPETENCE_LINES,
    [sectionStatus(profile), OP3_SITE_THIRTEEN, ...loadStateScopeLines(readableLoadStates)]
  );
}
