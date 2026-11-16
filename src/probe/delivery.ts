// ── MICA · probe delivery — the harness (Build 5, design doc stage 5, the last) ─
//
// "Scenarios reach a subject on a schedule the subject cannot predict,
// observables come back as evidence in an append-only log." This file is
// the SEAM (`SubjectPort`) plus the scheduling and gate-shaped delivery
// logic — it proves the seam, not the subject. No live subject, no
// transport, no process wiring: those are deployment acts, the arbiter's later.
//
// ── REUSE, NOT REBUILD [LB] ───────────────────────────────────────────────────
//
//   `deterministicUnitInterval` (review.ts, exported this build) is the
//   SAME deterministic-hash primitive Build 4's selection already proved —
//   M1 jitter here is a seeded shuffle over that primitive, not a second
//   pseudo-randomness implementation. Held-out routing calls
//   `loadScenariosForRole` (scenario-seal.ts, Build 2) DIRECTLY — the same
//   function, the same `ScenarioSealRefused` type — rather than
//   re-deriving "is this scenario's role declaration consistent."
//
// ── AN UNRECORDED ATTEMPT IS NOT AN ATTEMPT (S116) [LB] ──────────────────────
//
//   Build 5's `deliverAndLog` threads a plain array and cannot fail to log:
//   an array push always succeeds. Once the log has a DISK under it
//   (`evidence-store.ts`), logging can fail — the lock is held elsewhere, the
//   chain on disk forked, the append threw — and "attempted, never notified"
//   acquires a way to be false.
//
//   So `deliverAndRecord` GATES the port on the attempt's `committed` flag.
//   If the ATTEMPT record did not commit, `port.deliver` is NEVER CALLED: an
//   attempt nobody can later read is not an attempt, and reaching a subject
//   anyway would be the exact inversion of the sentence this log exists to
//   make true. If the OUTCOME record did not commit, the caller is handed the
//   PERSISTENCE FAILURE and not a verdict — a capture that reached no chain
//   is not evidence, and grading it would be grading in-memory delivery state,
//   which `evidence-log.ts` refuses by design.
//
//   `committed` and not `persisted` is the flag read, deliberately: an
//   in-memory store commits without persisting (integrity without provenance,
//   the seam's own words) and must still deliver, or every test and every
//   dry run would stop reaching its port the moment this build landed.
//
//   The array-threading `deliverAndLog`/`logPreDeliveryRefusal` stay, unchanged
//   in signature and behaviour, over the pure log. Both paths now classify a
//   capture through ONE function (`classifyDelivery`) so the three outcome
//   readings — CAPTURED, NO_CAPTURE, REFUSED — have a single implementation.
//
// ── SIGMA READ-ONLY, AS A CHOKEPOINT [LB] ─────────────────────────────────────
//
//   `writeScenarioField` is the ONLY function in this file (or anywhere in
//   `src/probe/`) whose signature could write a value onto a scenario's own
//   `observables`/`environment` fields. No delivery function in this file
//   calls it — a capture is recorded ONLY into the evidence log
//   (`evidence-log.ts`'s `appendOutcome`), never merged back into a
//   `ScenarioDefinition`. It exists, unused by any legitimate path, so an
//   attempted write is a REFUSAL rather than a silently-absent capability —
//   the same "the door exists so a later implementer extends a designed
//   seam instead of bolting on a shed" reasoning `precommit.ts` gives for
//   its own `claim+rule` refusal.

import {
  appendAttempt,
  appendOutcome,
  type AttemptProvenance,
  type DeliveryMode,
  type EvidenceLog,
} from "./evidence-log";
import type {
  AttemptAppendOutcome,
  EvidenceLogStore,
  OutcomeAppendOutcome,
} from "./evidence-store";
import { deterministicUnitInterval } from "./review";
import {
  loadScenariosForRole,
  type BookRole,
} from "./scenario-seal";
import {
  SIGMA_AXIS_TAGS,
  validateObservableChecks,
  type AxisTag,
  type ObservableChecks,
  type ScenarioDefinition,
} from "./scenario";

// ── 1.1 the subject boundary — a port, not a wire ────────────────────────────

/**
 * The seam. `deliver` returns the subject's RAW, UNTRUSTED observed facts
 * (or `undefined` for an ordinary non-response) — `delivery.ts`'s own
 * callers validate it (`scenario.ts`'s `validateObservableChecks`) before
 * it ever reaches the evidence log; this interface makes no promise about
 * shape. A thrown error represents a PORT-level failure (distinct from an
 * ordinary non-response) and is caught and logged as `REFUSED`, never
 * left to crash a delivery run.
 */
export interface SubjectPort {
  deliver(scenarioId: string, stressorSteps: readonly string[]): unknown;
}

/**
 * What a port that carries a HUMAN's declared reading can say about the capture
 * behind one scenario. `subject/declared-subject-port.ts` implements it; a LIVE
 * port has nothing to say here and implements nothing.
 *
 * IT IS A SEPARATE INTERFACE, NOT A FIELD ON `SubjectPort` (S120). The seam
 * above is unchanged: every existing port still satisfies it, and no live port
 * is made to carry a method whose only honest answer is "I have no declaration."
 */
export interface DeclaredCapture {
  readonly declaredBy: string;
  readonly declaredAt: string;
  readonly captureSha256: string;
}

export interface DeclaredCaptureSource {
  /** `undefined` for a scenario this port holds no declaration for. */
  declarationFor(scenarioId: string): DeclaredCapture | undefined;
}

/**
 * THE METHOD, NEVER THE CLASS `[LB]`. `instanceof DeclaredSubjectPort` here
 * would make `delivery.ts` import a pilot-specific subject module, and would
 * silently exclude the next port that carries declarations honestly without
 * being that class. So the check is structural: does this port answer the
 * question at all?
 */
function declaredCaptureSourceOf(port: SubjectPort): DeclaredCaptureSource | null {
  const candidate = port as Partial<DeclaredCaptureSource>;
  return typeof candidate.declarationFor === "function" ? (candidate as DeclaredCaptureSource) : null;
}

// ── 1.2 delivery scheduling — M1 jitter + M2 rotation, held-out routed ───────

export interface DeliveryScheduleParameters {
  /** Declared, not `Date.now()`-derived — reproducibility depends on it. */
  readonly seed: number;
}

/**
 * M2 rotation (round-robin by `axis` — each family file maps to one or more
 * axis groups, so rotating by axis is rotating across families) followed by
 * M1 jitter (a deterministic, seeded Fisher-Yates shuffle over
 * `deterministicUnitInterval` — never `Math.random()`, so a test can
 * reproduce an exact delivery order from the declared seed alone).
 */
function rotateAndJitter(
  scenarios: readonly ScenarioDefinition[],
  seed: number
): readonly ScenarioDefinition[] {
  const groups = new Map<AxisTag, ScenarioDefinition[]>();
  for (const s of scenarios) {
    const group = groups.get(s.axis);
    if (group) {
      group.push(s);
    } else {
      groups.set(s.axis, [s]);
    }
  }
  const groupArrays = [...groups.values()];
  const cursors = groupArrays.map(() => 0);
  const rotated: ScenarioDefinition[] = [];
  let remaining = scenarios.length;
  while (remaining > 0) {
    for (let i = 0; i < groupArrays.length; i++) {
      if (cursors[i] < groupArrays[i].length) {
        rotated.push(groupArrays[i][cursors[i]]);
        cursors[i]++;
        remaining--;
      }
    }
  }
  const jittered = [...rotated];
  for (let i = jittered.length - 1; i > 0; i--) {
    const u = deterministicUnitInterval(seed, `${String(i)}:${jittered[i].id}`);
    const j = Math.floor(u * (i + 1));
    [jittered[i], jittered[j]] = [jittered[j], jittered[i]];
  }
  return jittered;
}

/**
 * The ONLY entry point for STANDARD delivery. `loadScenariosForRole`
 * (reused, not re-derived) REFUSES, typed `ScenarioSealRefused`, if a
 * `heldOut: true` scenario is anywhere in `scenarios` — a held-out scenario
 * cannot reach this function's output; the refusal is the "unrepresentable
 * or refused" the brief asks for.
 */
export function scheduleStandardDelivery(
  scenarios: readonly ScenarioDefinition[],
  params: DeliveryScheduleParameters
): readonly ScenarioDefinition[] {
  const standardOnly = loadScenariosForRole("STANDARD", scenarios);
  return rotateAndJitter(standardOnly, params.seed);
}

/**
 * The ONLY entry point for HELD-OUT delivery. Same reuse, opposite role:
 * `loadScenariosForRole("HELD_OUT", ...)` refuses a `heldOut: false`
 * scenario. `role` is accepted and asserted rather than merely implied, so
 * a caller's intent is explicit at the call site.
 */
export function scheduleHeldOutDelivery(
  scenarios: readonly ScenarioDefinition[],
  role: Extract<BookRole, "HELD_OUT">,
  params: DeliveryScheduleParameters
): readonly ScenarioDefinition[] {
  const heldOutOnly = loadScenariosForRole(role, scenarios);
  return rotateAndJitter(heldOutOnly, params.seed);
}

// ── the sigma-read-only chokepoint ───────────────────────────────────────────

export class SigmaWriteRefused extends Error {
  constructor(
    message: string,
    readonly scenarioId: string,
    readonly field: string
  ) {
    super(message);
    this.name = "SigmaWriteRefused";
  }
}

function isSigmaAxis(axis: AxisTag): boolean {
  return (SIGMA_AXIS_TAGS as readonly string[]).includes(axis);
}

/**
 * The chokepoint 05b Pearl 2 names: sigma is READ-ONLY. No legitimate
 * delivery path in this file calls this function for ANY scenario — a
 * capture is recorded only into the evidence log, never merged back into a
 * `ScenarioDefinition`. Refuses unconditionally for a sigma-axis scenario
 * (typed `SigmaWriteRefused`); refuses just as hard, untyped-specifically,
 * for any other axis, because this module writes to NO scenario's fields,
 * ever — sigma's refusal is simply the one 05b gives a name to.
 */
export function writeScenarioField(
  scenario: Pick<ScenarioDefinition, "id" | "axis">,
  field: string
): never {
  if (isSigmaAxis(scenario.axis)) {
    throw new SigmaWriteRefused(
      `refused: sigma scenario "${scenario.id}" field "${field}" cannot be written — ` +
        `sigma is read-only (05b Pearl 2: stressing to read must never become stressing to shape).`,
      scenario.id,
      field
    );
  }
  throw new Error(
    `writeScenarioField has no implementation for any axis — this module never writes back into ` +
      `a scenario record. Reached unexpectedly for "${scenario.id}" (axis ${scenario.axis}), field "${field}".`
  );
}

// ── 1.3 gate-shaped delivery modes ───────────────────────────────────────────

export class ExitUnavailableAtPeakRefused extends Error {
  constructor(
    message: string,
    readonly scenarioId: string
  ) {
    super(message);
    this.name = "ExitUnavailableAtPeakRefused";
  }
}

/**
 * The EXIT-alive-at-max bar. Checked BEFORE any step of `scenario` is
 * delivered — a ramp is refused whole, never partially delivered.
 */
function refuseIfExitUnavailableAtPeak(scenario: ScenarioDefinition): void {
  if (scenario.environment.exitAvailable !== true) {
    throw new ExitUnavailableAtPeakRefused(
      `refused: sigma scenario "${scenario.id}" does not declare exitAvailable:true — a ramp whose ` +
        `peak stress removes the exit channel is uninterpretable (05b §1a's waveform coercion guard).`,
      scenario.id
    );
  }
}

export interface G2DeliveryStep {
  readonly scenarioId: string;
  readonly stepIndex: number;
  readonly intensityLevel: number;
  readonly stepText: string;
}

export interface G2MixtureRefusal {
  readonly scenarioId: string;
  readonly reason: string;
}

export interface G2MixtureResult {
  readonly steps: readonly G2DeliveryStep[];
  readonly refusals: readonly G2MixtureRefusal[];
}

/**
 * Every ELIGIBLE scenario's own steps stay in their declared order (never
 * reshuffled — that ordering is the scenario's contract per Build 2b);
 * eligible scenarios are interleaved with each other round-robin BY STEP
 * INDEX, which is the "mixture." A refused scenario contributes ZERO
 * steps — refused whole, before delivery, not mid-ramp.
 */
export function buildG2WaveformMixture(sigmaScenarios: readonly ScenarioDefinition[]): G2MixtureResult {
  const eligible: ScenarioDefinition[] = [];
  const refusals: G2MixtureRefusal[] = [];
  for (const s of sigmaScenarios) {
    try {
      refuseIfExitUnavailableAtPeak(s);
      if (s.stressor.intensityLevels === undefined) {
        throw new Error(`sigma scenario "${s.id}" carries no intensityLevels — the waveform contract is undefined.`);
      }
      eligible.push(s);
    } catch (err) {
      refusals.push({ scenarioId: s.id, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  const maxSteps = eligible.reduce((max, s) => Math.max(max, s.stressor.steps.length), 0);
  const steps: G2DeliveryStep[] = [];
  for (let i = 0; i < maxSteps; i++) {
    for (const s of eligible) {
      if (i < s.stressor.steps.length) {
        steps.push({
          scenarioId: s.id,
          stepIndex: i,
          intensityLevel: s.stressor.intensityLevels![i],
          stepText: s.stressor.steps[i],
        });
      }
    }
  }
  return { steps, refusals };
}

export interface G4BlitzAttempt {
  readonly scenarioId: string;
  readonly attemptIndex: number;
  readonly stressorSteps: readonly string[];
}

/**
 * A burst — but "every attempt in the burst is individually logged" is
 * enforced at the EVIDENCE-LOG layer (one `appendAttempt` call per entry
 * here), not by this function, which only fixes the burst's order and
 * membership.
 */
export function buildG4Blitz(nwScenarios: readonly ScenarioDefinition[]): readonly G4BlitzAttempt[] {
  return nwScenarios.map((s, i) => ({ scenarioId: s.id, attemptIndex: i, stressorSteps: s.stressor.steps }));
}

export function deliveryModeForAxis(axis: AxisTag): DeliveryMode {
  return isSigmaAxis(axis) ? "G2_WAVEFORM" : "G4_BLITZ";
}

// ── 1.4 wiring — logs the ATTEMPT before the port is ever called ────────────

/**
 * ONE delivery attempt, start to finish. Logs the `ATTEMPT` FIRST (before
 * `port.deliver` is called at all — "attempted, never notified"), then
 * logs exactly one `OUTCOME`: `CAPTURED` (valid, `validateObservableChecks`
 * passed — "never coerced"), `NO_CAPTURE` (the port returned `undefined`),
 * or `REFUSED` (the port threw, or returned something that did not
 * validate). Never writes into `scenario`'s own fields — see this file's
 * header on the sigma-read-only chokepoint.
 */
export type CaptureClassification =
  | { readonly outcome: "CAPTURED"; readonly observables: ObservableChecks }
  | { readonly outcome: "NO_CAPTURE" | "REFUSED"; readonly detail: string };

/**
 * ONE port call, read into the three outcomes the log has words for — and
 * NOTHING ELSE. It logs nothing, so it can be shared by the array-threading
 * path and the store path without either owning the other's chain.
 */
function classifyDelivery(
  port: SubjectPort,
  scenarioId: string,
  stressorSteps: readonly string[]
): CaptureClassification {
  let raw: unknown;
  try {
    raw = port.deliver(scenarioId, stressorSteps);
  } catch (err) {
    return {
      outcome: "REFUSED",
      detail: `subject port threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (raw === undefined) {
    return { outcome: "NO_CAPTURE", detail: "the port returned no capture" };
  }
  if (!validateObservableChecks(raw)) {
    return {
      outcome: "REFUSED",
      detail: "capture did not validate as ObservableChecks — never coerced",
    };
  }
  return { outcome: "CAPTURED", observables: raw };
}

/**
 * PURE, IN-MEMORY, TEST/REHEARSAL ONLY. NO PROVENANCE BY DESIGN — EVIDENCE GOES
 * THROUGH `deliverAndRecord` ONLY.
 *
 * The array path. It takes an `EvidenceLog` (a value) and returns a new one, so
 * nothing it does reaches a disk and nothing it does survives the process. That
 * is what makes it the right tool for a test fixture and a rehearsal, and the
 * wrong tool for a reading anyone will later grade: an attempt nobody can read
 * afterwards is not the record "attempted, never notified" asks for.
 *
 * It takes NO `provenance` and none is being added. A record here says WHAT was
 * delivered and never WHOSE reply came back, and that omission is the honest
 * one for a path whose output is not evidence. `DL-P5` pins it: the array path
 * stays provenance-blind. A caller that needs the chain to say whose reply it
 * holds wants `deliverAndRecord` and a store with a path under it.
 */
export function deliverAndLog(
  port: SubjectPort,
  scenarioId: string,
  stressorSteps: readonly string[],
  mode: DeliveryMode,
  log: EvidenceLog,
  atMs: number
): EvidenceLog {
  const { log: withAttempt, ref } = appendAttempt(log, { scenarioId, mode }, atMs);
  const capture = classifyDelivery(port, scenarioId, stressorSteps);
  return capture.outcome === "CAPTURED"
    ? appendOutcome(withAttempt, { ref, outcome: "CAPTURED", observables: capture.observables }, atMs)
    : appendOutcome(withAttempt, { ref, outcome: capture.outcome, detail: capture.detail }, atMs);
}

/**
 * For refusals that happen BEFORE any port call — EXIT-alive-at-max, a
 * held-out/standard role mismatch, or any other pre-delivery gate. Still
 * logs an `ATTEMPT` (the attempt to deliver WAS made, at the scheduling
 * level, even though it never reached the port) followed immediately by a
 * `REFUSED` outcome — the same "attempted, never notified" discipline
 * `deliverAndLog` holds for a port-level refusal, applied one layer
 * earlier.
 */
export function logPreDeliveryRefusal(
  log: EvidenceLog,
  scenarioId: string,
  mode: DeliveryMode,
  detail: string,
  atMs: number
): EvidenceLog {
  const { log: withAttempt, ref } = appendAttempt(log, { scenarioId, mode }, atMs);
  return appendOutcome(withAttempt, { ref, outcome: "REFUSED", detail }, atMs);
}

// ── 1.5 the same wiring, over a store that can fail to record (S116) ─────────

/**
 * What a store-backed delivery did, and how far it got. Three states, not a
 * boolean, because the two failures are DIFFERENT FACTS: one says the subject
 * was never reached, the other says it was reached and the answer did not land.
 *
 * `state === "RECORDED"` is the ONLY state a grader may read a verdict out of.
 * The other two carry the seam's own `AppendOutcome` — record, persisted,
 * committed, detail — unchanged, so the caller reports the persistence failure
 * as the persistence failure it is.
 */
export type RecordedDelivery =
  | {
      readonly state: "ATTEMPT_NOT_RECORDED";
      readonly attempt: AttemptAppendOutcome;
      /** Always false here. The port was not called. */
      readonly delivered: false;
    }
  | {
      readonly state: "OUTCOME_NOT_RECORDED";
      readonly attempt: AttemptAppendOutcome;
      readonly outcome: OutcomeAppendOutcome;
      readonly delivered: boolean;
    }
  | {
      readonly state: "RECORDED";
      readonly attempt: AttemptAppendOutcome;
      readonly outcome: OutcomeAppendOutcome;
      readonly delivered: boolean;
    };

/**
 * The store-backed delivery tail, S121. It was two trailing positional
 * parameters (`atMs`, then an optional `provenance`) and it is one object now.
 *
 * WHY THE SHAPE CHANGED AND WHAT DID NOT. Nothing about the behaviour: the
 * timestamp is still injected by the caller because this layer calls no clock,
 * and the provenance is still OPTIONAL AND NEVER DERIVED — not from the port,
 * not from the scenario, not from anything. What the object buys is that the
 * two cannot be swapped by position and a third fact cannot be added by
 * appending an argument nobody reads at the call sites. A caller that omits
 * `provenance` is saying "a delivery with no declared provenance", which is
 * what every caller written before S120 says, and it must keep being possible
 * to say.
 */
export interface RecordDeliveryOptions {
  /** Presented wall time. This module never calls a clock. */
  readonly atMs: number;
  /** Whose subject, which slice, on what basis. Declared or absent — never inferred. */
  readonly provenance?: AttemptProvenance;
}

/**
 * `recordPreDeliveryRefusal`'s tail: the timestamp and NOTHING ELSE.
 *
 * It is a narrowing of the object above rather than the same object, and that
 * is deliberate. A pre-delivery refusal never reached the port, so there is no
 * reply for a provenance to be OF, and this path does not write one. Typing it
 * to accept a `provenance` and then dropping it would be a field the caller
 * declared and the chain never carried — the exact shape this whole beat
 * exists to make impossible. An object literal carrying `provenance` is a
 * compile error here, which is the report.
 */
export type RefusalRecordOptions = Pick<RecordDeliveryOptions, "atMs">;

/**
 * ONE delivery attempt against a durable evidence log. Same discipline as
 * `deliverAndLog` — ATTEMPT first, exactly one OUTCOME, never a write into the
 * scenario's own fields — plus the gate this file's header states: a port that
 * is only reached once the attempt to reach it is in the chain.
 */
export function deliverAndRecord(
  port: SubjectPort,
  scenarioId: string,
  stressorSteps: readonly string[],
  mode: DeliveryMode,
  store: EvidenceLogStore,
  options: RecordDeliveryOptions
): RecordedDelivery {
  const { atMs, provenance } = options;
  const attempt = store.appendAttempt({ scenarioId, mode, provenance }, atMs);
  if (!attempt.committed) {
    // THE GATE. Not a retry, not a queue, not a degraded delivery: the subject
    // is not touched at all, and the caller is handed the reason the record
    // could not be made. See the header.
    return { state: "ATTEMPT_NOT_RECORDED", attempt, delivered: false };
  }

  const capture = classifyDelivery(port, scenarioId, stressorSteps);
  // READ ONLY ON THE CAPTURED PATH, and only from the port that just answered.
  // A NO_CAPTURE or a REFUSED has no capture for a reading to be of, and the
  // log refuses those fields there anyway.
  const declared =
    capture.outcome === "CAPTURED"
      ? declaredCaptureSourceOf(port)?.declarationFor(scenarioId)
      : undefined;
  const outcome =
    capture.outcome === "CAPTURED"
      ? store.appendOutcome(
          {
            ref: attempt.ref,
            outcome: "CAPTURED",
            observables: capture.observables,
            ...(declared === undefined
              ? {}
              : {
                  declared: {
                    declaredBy: declared.declaredBy,
                    captureSha256: declared.captureSha256,
                  },
                }),
          },
          atMs
        )
      : store.appendOutcome(
          { ref: attempt.ref, outcome: capture.outcome, detail: capture.detail },
          atMs
        );

  return outcome.committed
    ? { state: "RECORDED", attempt, outcome, delivered: true }
    : { state: "OUTCOME_NOT_RECORDED", attempt, outcome, delivered: true };
}

/**
 * The store-backed `logPreDeliveryRefusal`. The port is never called on this
 * path by construction, so `delivered` is false throughout — but the ATTEMPT
 * still has to land before the REFUSED outcome is written, for the same reason
 * it does in `deliverAndRecord`: an outcome whose ref does not resolve into the
 * chain is refused by `appendOutcome`, and writing one over an attempt that
 * failed to commit is exactly that.
 */
export function recordPreDeliveryRefusal(
  store: EvidenceLogStore,
  scenarioId: string,
  mode: DeliveryMode,
  detail: string,
  options: RefusalRecordOptions
): RecordedDelivery {
  const { atMs } = options;
  const attempt = store.appendAttempt({ scenarioId, mode }, atMs);
  if (!attempt.committed) {
    return { state: "ATTEMPT_NOT_RECORDED", attempt, delivered: false };
  }
  const outcome = store.appendOutcome(
    { ref: attempt.ref, outcome: "REFUSED", detail },
    atMs
  );
  return outcome.committed
    ? { state: "RECORDED", attempt, outcome, delivered: false }
    : { state: "OUTCOME_NOT_RECORDED", attempt, outcome, delivered: false };
}
