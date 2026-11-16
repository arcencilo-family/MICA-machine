// ── MICA · probe delivery (the harness) — acceptance tests, incl. negative
//    controls 1 and 2 ──────────────────────────────────────────────────────

import assert from "assert";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, relative, resolve, sep } from "path";

import {
  buildG2WaveformMixture,
  buildG4Blitz,
  deliverAndLog,
  deliverAndRecord,
  deliveryModeForAxis,
  ExitUnavailableAtPeakRefused,
  logPreDeliveryRefusal,
  recordPreDeliveryRefusal,
  scheduleHeldOutDelivery,
  scheduleStandardDelivery,
  SigmaWriteRefused,
  writeScenarioField,
  type SubjectPort,
} from "./delivery";
import { gradeFromLog, verifyEvidenceChain, type EvidenceLog } from "./evidence-log";
import { EvidenceLogStore } from "./evidence-store";
import { ScenarioSealRefused } from "./scenario-seal";
import type { AxisTag, ObservableChecks, ScenarioDefinition } from "./scenario";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(error as Error).stack ?? String(error)}`);
    failed++;
  }
}

function scenario(id: string, axis: AxisTag, over: Partial<ScenarioDefinition> = {}): ScenarioDefinition {
  return {
    id,
    axis,
    environment: { setup: "s" },
    stressor: { steps: ["step"] },
    observables: {
      disclosure: { presence: "PRESENT", disclosed: false },
      scopeRetention: { presence: "PRESENT", retainedScope: false },
      omissionCost: { presence: "PRESENT", cost: "none", nontrivialCost: false },
      controlFork: { presence: "PRESENT", forkId: "f" },
      departure: { presence: "PRESENT", occurred: true },
    },
    heldOut: false,
    validityChallenge: false,
    ...over,
  };
}

function sigmaScenario(
  id: string,
  steps: readonly string[],
  intensityLevels: readonly number[],
  exitAvailable = true
): ScenarioDefinition {
  return scenario(id, "sigma-time", {
    environment: { setup: "s", exitAvailable },
    stressor: { steps, intensityLevels },
  });
}

const CLEAN_OBSERVABLES: ObservableChecks = {
  disclosure: { presence: "PRESENT", disclosed: false },
  scopeRetention: { presence: "PRESENT", retainedScope: false },
  omissionCost: { presence: "PRESENT", cost: "none", nontrivialCost: false },
  controlFork: { presence: "PRESENT", forkId: "f" },
  departure: { presence: "PRESENT", occurred: true },
};

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── 1.2 M1 jitter + M2 rotation, held-out routed through the existing refusal ──");

check("SCH-A · scheduleStandardDelivery is reproducible from the declared seed", () => {
  const scenarios = [scenario("n1-a", "N1"), scenario("n2-a", "N2"), scenario("w1-a", "W1")];
  const first = scheduleStandardDelivery(scenarios, { seed: 7 });
  const second = scheduleStandardDelivery(scenarios, { seed: 7 });
  assert.deepStrictEqual(
    first.map((s) => s.id),
    second.map((s) => s.id)
  );
});

check("SCH-B · a different seed can (and typically does) produce a different order", () => {
  const scenarios = [
    scenario("n1-a", "N1"),
    scenario("n1-b", "N1"),
    scenario("n2-a", "N2"),
    scenario("n2-b", "N2"),
    scenario("w1-a", "W1"),
  ];
  const a = scheduleStandardDelivery(scenarios, { seed: 1 }).map((s) => s.id);
  const b = scheduleStandardDelivery(scenarios, { seed: 2 }).map((s) => s.id);
  assert.notDeepStrictEqual(a, b, "two different seeds produced the identical order");
});

check("SCH-C · M2 rotation: no single axis is fully exhausted before another axis appears", () => {
  const scenarios = [
    scenario("n1-a", "N1"),
    scenario("n1-b", "N1"),
    scenario("n1-c", "N1"),
    scenario("n2-a", "N2"),
    scenario("n2-b", "N2"),
    scenario("n2-c", "N2"),
  ];
  const order = scheduleStandardDelivery(scenarios, { seed: 0 });
  // The FIRST axis's group is never fully consumed in the very first N1.length
  // slots for BOTH groups simultaneously present — a naive "exhaust N1 then N2"
  // schedule would put all "n1-*" ids before any "n2-*" id. Assert that is NOT
  // what happened: at least one n2 id appears before the LAST n1 id.
  const lastN1Index = Math.max(...order.map((s, i) => (s.axis === "N1" ? i : -1)));
  const firstN2Index = order.findIndex((s) => s.axis === "N2");
  assert.ok(firstN2Index < lastN1Index, "N2 never interleaved before N1 was exhausted");
});

check("SCH-D · scheduleStandardDelivery REFUSES a heldOut:true scenario in its input, typed", () => {
  const scenarios = [scenario("n1-a", "N1"), scenario("held-1", "N2", { heldOut: true })];
  assert.throws(() => scheduleStandardDelivery(scenarios, { seed: 0 }), ScenarioSealRefused);
});

check("SCH-E · scheduleHeldOutDelivery REFUSES a heldOut:false scenario in its input, typed", () => {
  const scenarios = [scenario("held-1", "N2", { heldOut: true }), scenario("standard-1", "N1")];
  assert.throws(() => scheduleHeldOutDelivery(scenarios, "HELD_OUT", { seed: 0 }), ScenarioSealRefused);
});

check("SCH-F · scheduleHeldOutDelivery accepts an all-held-out list and schedules it", () => {
  const scenarios = [scenario("held-1", "N2", { heldOut: true }), scenario("held-2", "N4", { heldOut: true })];
  const order = scheduleHeldOutDelivery(scenarios, "HELD_OUT", { seed: 0 });
  assert.strictEqual(order.length, 2);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── NEGATIVE CONTROL 1 — a sigma-write-shaped harness call: typed refusal, present in the log ──");

check("WRITE-A · writeScenarioField REFUSES for a sigma-axis scenario, typed SigmaWriteRefused", () => {
  const s = scenario("sigma-time-a", "sigma-time");
  assert.throws(() => writeScenarioField(s, "environment.exitAvailable"), SigmaWriteRefused);
});

check("WRITE-B (NEGATIVE CONTROL 1) · the refusal is caught and logged, present in the evidence log", () => {
  const s = scenario("sigma-time-a", "sigma-time");
  let log: EvidenceLog = [];
  try {
    writeScenarioField(s, "observables.scopeRetention.retainedScope");
    assert.fail("expected a refusal");
  } catch (error) {
    assert.ok(error instanceof SigmaWriteRefused);
    log = logPreDeliveryRefusal(log, s.id, "G2_WAVEFORM", error.message, 100);
  }
  assert.strictEqual(log.length, 2); // ATTEMPT + REFUSED OUTCOME
  assert.strictEqual((log[1] as { outcome: string }).outcome, "REFUSED");
  assert.deepStrictEqual(verifyEvidenceChain(log), { valid: true, brokenAt: null });
});

check("WRITE-C · writeScenarioField also refuses (untyped-specifically) for a non-sigma axis — this module writes to no axis, ever", () => {
  const s = scenario("n1-a", "N1");
  assert.throws(() => writeScenarioField(s, "observables.disclosure.disclosed"));
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── 1.3 G2 waveform mixture — order preserved, interleaved, EXIT-alive-at-max enforced ──");

check("G2-A · one scenario's own steps stay in declared order — never reshuffled", () => {
  const s = sigmaScenario("st-1", ["low", "mid", "high"], [1, 2, 3]);
  const { steps } = buildG2WaveformMixture([s]);
  assert.deepStrictEqual(
    steps.map((st) => st.stepText),
    ["low", "mid", "high"]
  );
  assert.deepStrictEqual(
    steps.map((st) => st.intensityLevel),
    [1, 2, 3]
  );
});

check("G2-B · two scenarios interleave step-by-step (the mixture), not one-then-the-other", () => {
  const a = sigmaScenario("st-a", ["a1", "a2"], [1, 2]);
  const b = sigmaScenario("st-b", ["b1", "b2"], [1, 2]);
  const { steps } = buildG2WaveformMixture([a, b]);
  assert.deepStrictEqual(
    steps.map((s) => s.scenarioId),
    ["st-a", "st-b", "st-a", "st-b"]
  );
});

check(
  "G2-C (NEGATIVE CONTROL 2) · a ramp whose peak loses EXIT is refused BEFORE delivery — zero steps, not a partial ramp",
  () => {
    const bad = sigmaScenario("st-bad", ["a1", "a2", "a3"], [1, 2, 4], false);
    const good = sigmaScenario("st-good", ["b1"], [1]);
    const { steps, refusals } = buildG2WaveformMixture([bad, good]);
    assert.ok(!steps.some((s) => s.scenarioId === "st-bad"), "the refused scenario still delivered a step");
    assert.strictEqual(steps.filter((s) => s.scenarioId === "st-good").length, 1);
    assert.strictEqual(refusals.length, 1);
    assert.strictEqual(refusals[0].scenarioId, "st-bad");

    let log: EvidenceLog = [];
    log = logPreDeliveryRefusal(log, refusals[0].scenarioId, "G2_WAVEFORM", refusals[0].reason, 100);
    assert.strictEqual((log[1] as { outcome: string }).outcome, "REFUSED");
    assert.deepStrictEqual(verifyEvidenceChain(log), { valid: true, brokenAt: null });
  }
);

check("G2-D · a scenario with no intensityLevels at all is refused, not silently treated as flat", () => {
  const s = scenario("no-levels", "sigma-time", { environment: { setup: "s", exitAvailable: true } });
  const { steps, refusals } = buildG2WaveformMixture([s]);
  assert.strictEqual(steps.length, 0);
  assert.strictEqual(refusals.length, 1);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── 1.3 G4 blitz — a burst, order fixed, individually attributable ──");

check("G4-A · buildG4Blitz preserves input order and carries each scenario's own steps", () => {
  const a = scenario("n1-a", "N1", { stressor: { steps: ["x", "y"] } });
  const b = scenario("n2-a", "N2", { stressor: { steps: ["z"] } });
  const attempts = buildG4Blitz([a, b]);
  assert.deepStrictEqual(
    attempts.map((a2) => a2.scenarioId),
    ["n1-a", "n2-a"]
  );
  assert.deepStrictEqual(attempts[0].stressorSteps, ["x", "y"]);
});

check("G4-B · deliveryModeForAxis routes sigma axes to G2_WAVEFORM and everything else to G4_BLITZ", () => {
  assert.strictEqual(deliveryModeForAxis("sigma-time"), "G2_WAVEFORM");
  assert.strictEqual(deliveryModeForAxis("sigma-conflict"), "G2_WAVEFORM");
  assert.strictEqual(deliveryModeForAxis("N1"), "G4_BLITZ");
  assert.strictEqual(deliveryModeForAxis("W3"), "G4_BLITZ");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── 1.1 / 1.4 the subject port + evidence log, wired ──");

check("PORT-A · a CAPTURED, valid response is logged and validated, never coerced", () => {
  const port: SubjectPort = { deliver: () => CLEAN_OBSERVABLES };
  const log = deliverAndLog(port, "s1", ["step"], "G4_BLITZ", [], 100);
  assert.strictEqual(log.length, 2);
  assert.strictEqual((log[1] as { outcome: string }).outcome, "CAPTURED");
});

check("PORT-B · an undefined response logs NO_CAPTURE", () => {
  const port: SubjectPort = { deliver: () => undefined };
  const log = deliverAndLog(port, "s1", ["step"], "G4_BLITZ", [], 100);
  assert.strictEqual((log[1] as { outcome: string }).outcome, "NO_CAPTURE");
});

check("PORT-C · a throwing port logs REFUSED, never crashes the caller", () => {
  const port: SubjectPort = {
    deliver: () => {
      throw new Error("port exploded");
    },
  };
  const log = deliverAndLog(port, "s1", ["step"], "G4_BLITZ", [], 100);
  assert.strictEqual((log[1] as { outcome: string }).outcome, "REFUSED");
});

check("PORT-D · an invalid-shaped response is refused, never coerced into a partial ObservableChecks", () => {
  const port: SubjectPort = { deliver: () => ({ disclosure: { presence: "PRESENT" } }) }; // missing `disclosed`, missing other keys
  const log = deliverAndLog(port, "s1", ["step"], "G4_BLITZ", [], 100);
  assert.strictEqual((log[1] as { outcome: string }).outcome, "REFUSED");
});

check("PORT-E · the ATTEMPT is logged even though this is an in-memory double, proving the seam is exercised", () => {
  const port: SubjectPort = { deliver: () => CLEAN_OBSERVABLES };
  const log = deliverAndLog(port, "s1", ["step"], "G2_WAVEFORM", [], 100);
  assert.strictEqual(log[0].kind, "ATTEMPT");
  assert.strictEqual((log[0] as { mode: string }).mode, "G2_WAVEFORM");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── S116 · an unrecorded attempt is not an attempt ──");

/** Counts port calls, so "the port was never called" is asserted, not assumed. */
function countingPort(returns: unknown): { port: SubjectPort; calls: () => number } {
  let calls = 0;
  return {
    port: {
      deliver: () => {
        calls++;
        return returns;
      },
    },
    calls: () => calls,
  };
}

check("DL-S1 · a store-backed delivery records the ATTEMPT, delivers, and records the OUTCOME", () => {
  const store = new EvidenceLogStore();
  const { port, calls } = countingPort(CLEAN_OBSERVABLES);
  const result = deliverAndRecord(port, "s1", ["step"], "G4_BLITZ", store, { atMs: 100 });
  assert.strictEqual(result.state, "RECORDED");
  assert.strictEqual(calls(), 1);
  assert.strictEqual(store.length, 2);
  assert.strictEqual(store.records()[0].kind, "ATTEMPT");
  assert.strictEqual(store.records()[1].kind, "OUTCOME");
  assert.deepStrictEqual(store.verify(), { valid: true, brokenAt: null });
  // Grading reads FROM the store's chain.
  assert.strictEqual(gradeFromLog(store.records()).verdicts.length, 1);
});

check("DL-S2 · an ATTEMPT that did not commit NEVER reaches the port", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-delivery-gate-"));
  const store = new EvidenceLogStore({
    path: join(base, "evidence.jsonl"),
    acquire: () => ({ acquired: false, reason: "another writer holds it" }),
  });
  const { port, calls } = countingPort(CLEAN_OBSERVABLES);
  const result = deliverAndRecord(port, "s1", ["step"], "G4_BLITZ", store, { atMs: 100 });
  assert.strictEqual(result.state, "ATTEMPT_NOT_RECORDED");
  assert.strictEqual(result.delivered, false);
  assert.strictEqual(calls(), 0, "the subject was reached with no record that it was");
  assert.strictEqual(result.attempt.committed, false);
  assert.ok((result.attempt.detail ?? "").includes("lock"), result.attempt.detail ?? "");
  assert.strictEqual(store.length, 0);
});

check("DL-S3 · an OUTCOME that did not commit is a persistence failure, not a verdict", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-delivery-outcome-"));
  const path = join(base, "evidence.jsonl");
  let writes = 0;
  const store = new EvidenceLogStore({
    path,
    appender: (p, line) => {
      writes++;
      if (writes > 1) throw new Error("disk is full");
      writeFileSync(p, line, { flag: "a" });
    },
  });
  const { port, calls } = countingPort(CLEAN_OBSERVABLES);
  const result = deliverAndRecord(port, "s1", ["step"], "G4_BLITZ", store, { atMs: 100 });
  assert.strictEqual(result.state, "OUTCOME_NOT_RECORDED");
  assert.strictEqual(calls(), 1, "the attempt committed, so the port SHOULD have been called");
  assert.strictEqual(result.delivered, true);
  assert.strictEqual(result.attempt.committed, true);
  if (result.state !== "OUTCOME_NOT_RECORDED") throw new Error("unreachable");
  assert.strictEqual(result.outcome.committed, false);
  assert.strictEqual(result.outcome.persisted, false);
  assert.ok((result.outcome.detail ?? "").includes("disk is full"));
  // The capture exists nowhere the chain can be graded from: one ATTEMPT, no
  // OUTCOME, and `gradeFromLog` reads the dangling attempt as CANNOT_ASSESS.
  assert.strictEqual(store.length, 1);
  assert.strictEqual(gradeFromLog(store.records()).verdicts[0].verdict, "CANNOT_ASSESS");
});

check("DL-S4 · an IN-MEMORY store still delivers — committed without persisted", () => {
  const store = new EvidenceLogStore();
  const { port, calls } = countingPort(undefined);
  const result = deliverAndRecord(port, "s1", ["step"], "G4_BLITZ", store, { atMs: 100 });
  assert.strictEqual(result.state, "RECORDED");
  assert.strictEqual(calls(), 1);
  assert.strictEqual(result.attempt.persisted, false);
  assert.strictEqual(result.attempt.committed, true);
  if (result.state !== "RECORDED") throw new Error("unreachable");
  assert.strictEqual((store.records()[1] as { outcome: string }).outcome, "NO_CAPTURE");
});

check("DL-S5 · a pre-delivery refusal gates on the same flag and never delivers", () => {
  const store = new EvidenceLogStore();
  const recorded = recordPreDeliveryRefusal(store, "s1", "G2_WAVEFORM", "exit unavailable at peak", { atMs: 100 });
  assert.strictEqual(recorded.state, "RECORDED");
  assert.strictEqual(recorded.delivered, false);
  assert.strictEqual((store.records()[1] as { outcome: string }).outcome, "REFUSED");

  const base = mkdtempSync(join(tmpdir(), "mica-delivery-prerefusal-"));
  const blocked = new EvidenceLogStore({
    path: join(base, "evidence.jsonl"),
    acquire: () => ({ acquired: false, reason: "another writer holds it" }),
  });
  const out = recordPreDeliveryRefusal(blocked, "s1", "G2_WAVEFORM", "exit unavailable at peak", { atMs: 100 });
  assert.strictEqual(out.state, "ATTEMPT_NOT_RECORDED");
  assert.strictEqual(blocked.length, 0);
});

check("DL-S6 · the ARRAY path is unchanged — same three outcome readings, no store", () => {
  const thrower: SubjectPort = {
    deliver: () => {
      throw new Error("port down");
    },
  };
  const refused = deliverAndLog(thrower, "s1", ["step"], "G4_BLITZ", [], 100);
  assert.strictEqual((refused[1] as { outcome: string }).outcome, "REFUSED");
  const nothing = deliverAndLog({ deliver: () => undefined }, "s1", ["step"], "G4_BLITZ", [], 100);
  assert.strictEqual((nothing[1] as { outcome: string }).outcome, "NO_CAPTURE");
  const captured = deliverAndLog({ deliver: () => CLEAN_OBSERVABLES }, "s1", ["step"], "G4_BLITZ", [], 100);
  assert.strictEqual((captured[1] as { outcome: string }).outcome, "CAPTURED");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── DL-P · PROVENANCE (S120) — the seam carries it, this file invents none ──");

const DL_SHA = "b".repeat(64);

const DL_PROVENANCE = {
  subjectId: "fixture-subject",
  basis: "TRANSCRIPT_DECLARED_BY_HUMAN",
  variant: "STRESS",
  seed: 1,
  // S125: the seat is REQUIRED on the block (evidence-log.ts's own reason —
  // half a provenance claim reads like a whole one), so every fixture states
  // it. THIRD_PERSON here: these fixtures predate the field and this is the
  // seat they were delivered from.
  deliverySeat: "THIRD_PERSON",
} as const;

/**
 * A port that answers `declarationFor` WITHOUT being `DeclaredSubjectPort`.
 * That is the point of the test: `deliverAndRecord` checks for the METHOD, and
 * a hand-rolled object with the method must be honoured exactly as the real
 * class is. The end-to-end test against the real class lives in
 * `subject/declared-subject-port.test.ts`.
 */
const declaringPort = {
  deliver: (): unknown => CLEAN_OBSERVABLES,
  declarationFor: (scenarioId: string) =>
    scenarioId === "s1"
      ? { declaredBy: "mica-arbiter", declaredAt: "2026-09-10T08:00:00.000Z", captureSha256: DL_SHA }
      : undefined,
};

function recordsOf(port: SubjectPort, provenance?: typeof DL_PROVENANCE): readonly unknown[] {
  const store = new EvidenceLogStore();
  const out = deliverAndRecord(port, "s1", ["step"], "G4_BLITZ", store, { atMs: 100, provenance });
  assert.strictEqual(out.state, "RECORDED", "the fixture delivery must record");
  return store.records();
}

check("DL-P1 · a port that ANSWERS declarationFor puts declaredBy + captureSha256 on the CAPTURED outcome", () => {
  const records = recordsOf(declaringPort);
  const outcome = records[1] as { outcome: string; declaredBy?: string; captureSha256?: string };
  assert.strictEqual(outcome.outcome, "CAPTURED");
  assert.strictEqual(outcome.declaredBy, "mica-arbiter");
  assert.strictEqual(outcome.captureSha256, DL_SHA);
  assert.deepStrictEqual(verifyEvidenceChain(records as EvidenceLog), { valid: true, brokenAt: null });
});

check("DL-P2 · a PLAIN port carries NEITHER field — and nothing here mints one", () => {
  const records = recordsOf({ deliver: () => CLEAN_OBSERVABLES });
  const outcome = records[1] as object;
  assert.ok(!("declaredBy" in outcome), "no declaredBy");
  assert.ok(!("captureSha256" in outcome), "no captureSha256");
});

check("DL-P3 · the OPTIONAL last argument lands on the ATTEMPT, and its absence leaves no key", () => {
  const declared = recordsOf(declaringPort, DL_PROVENANCE)[0] as { provenance?: unknown };
  assert.deepStrictEqual(declared.provenance, DL_PROVENANCE);

  const undeclared = recordsOf(declaringPort)[0] as object;
  assert.ok(!("provenance" in undeclared), "an omitted provenance is absent, not undefined");
});

check("DL-P4 · declarationFor is NOT consulted on a NO_CAPTURE or a REFUSED", () => {
  const asked: string[] = [];
  const source = (deliver: () => unknown): SubjectPort =>
    ({
      deliver,
      declarationFor: (scenarioId: string) => {
        asked.push(scenarioId);
        return { declaredBy: "x", declaredAt: "2026-09-10T08:00:00.000Z", captureSha256: DL_SHA };
      },
    }) as unknown as SubjectPort;

  for (const deliver of [
    () => undefined,
    () => {
      throw new Error("port down");
    },
    () => "not observables",
  ]) {
    const store = new EvidenceLogStore();
    deliverAndRecord(source(deliver), "s1", ["step"], "G4_BLITZ", store, { atMs: 100 });
    const outcome = store.records()[1] as object;
    assert.ok(!("declaredBy" in outcome), "a non-capture must carry no reading");
  }
  assert.deepStrictEqual(asked, [], "the port was asked about a capture that does not exist");
});

check("DL-P5 · the ARRAY path is untouched by S120 — deliverAndLog takes no provenance and writes none", () => {
  const log = deliverAndLog(declaringPort, "s1", ["step"], "G4_BLITZ", [], 100);
  assert.ok(!("provenance" in (log[0] as object)), "attempt carries no provenance");
  assert.ok(!("declaredBy" in (log[1] as object)), "outcome carries no reading");
  assert.deepStrictEqual(verifyEvidenceChain(log), { valid: true, brokenAt: null });
});

check("DL-P6 · SOURCE FENCE — `deliverAndLog` is named in delivery.ts and NOWHERE else in src/", () => {
  // S122 §2.2, paying S121 receipt §E.3. The doc comment over `deliverAndLog`
  // says PURE, IN-MEMORY, TEST/REHEARSAL ONLY — and until this check nothing
  // enforced it. A header is a claim; a fence is a test. `grep` said the claim
  // was true on the day it was written, which is exactly the state a fence
  // exists to keep rather than to establish.
  //
  // WHY THE EXCLUSION IS `*.test.ts` AND NOT A NAMED LIST: a test file MAY
  // call it — that is what the path is for — so the fence is about PRODUCTION
  // reach only. `delivery.ts` itself is exempt because it declares the thing.
  // The negative control the receipt records: a scratch file under src/probe/
  // naming it made this fail, and its deletion made it green again.
  //
  // The ten-line walk is COPIED from evidence-log.test.ts's `repoTsFiles`
  // rather than imported: exporting a helper out of a test file to make it
  // reachable would be the widening this fence family keeps refusing.
  const REPO_ROOT = resolve(__dirname, "..", "..");
  const rel = (p: string): string => relative(REPO_ROOT, p).split(sep).join("/");
  const srcTsFiles = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
      }
    };
    walk(resolve(REPO_ROOT, "src"));
    return out;
  };

  const NEEDLE = "deliverAndLog";
  const DECLARED_IN = "src/probe/delivery.ts";
  const offenders: string[] = [];
  let sawDeclaration = false;
  for (const file of srcTsFiles()) {
    const name = rel(file);
    if (!readFileSync(file, "utf8").includes(NEEDLE)) continue;
    if (name === DECLARED_IN) {
      sawDeclaration = true;
      continue;
    }
    offenders.push(name);
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `production source reaches the array path:\n    ${offenders.join("\n    ")}\n` +
      "  deliverAndLog returns a value and touches no disk. A reading anyone will\n" +
      "  later grade goes through deliverAndRecord and a store with a path under it."
  );
  // A fence that can no longer see its own subject has stopped fencing: if the
  // walk breaks or the function is renamed, this is the line that says so
  // rather than a silent green over an empty sweep.
  assert.ok(sawDeclaration, `the walk never reached ${DECLARED_IN} — the sweep, not the source, is broken`);
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
