// ──────────────────────────────────────────────────────────────────────────────
// MICA — Sig F2 ACTIVATION, end to end through the chokepoint
//   npx ts-node src/mica/sig-f2-activation.test.ts
//
// House style: standalone ts-node script, custom check() harness, no framework.
//
// WHAT THIS FILE PROVES, AND WHY IT IS SEPARATE FROM sig.test.ts
//
//   sig.test.ts proves F2 at the SENSOR boundary: an injected precondition map,
//   a violation, an ALARM verdict. verdict-logic.frozen.json freezes that ALARM.
//   Neither shows the reading reaching a GATE. F2's second leg is only load-
//   bearing if an F2 ALARM actually FLOORS a chokepoint disposition to HOLD.
//
//   The wiring is deployment glue, not sensor code: assessSig returns a
//   SensorVerdict, guard() composes over SensorVerdict[], and the 2026-08-12
//   closure ruling forbids src/mica taking a downstream dependency — so the
//   composition lives HERE, in a test that imports both sides, exactly as the
//   chokepoint's own header says a new gate is wired ("contributes a
//   SensorVerdict to guard's sensorVerdicts and needs no change here"). No
//   production file wires a sensor into the gate, and none should.
//
//   The four done-conditions, from the activation brief's Step 4:
//     1 · map satisfied      -> SILENT        -> RELEASE
//     2 · precondition violated -> ALARM      -> HOLD          (the second leg)
//     3 · map absent / empty -> CANNOT_ASSESS -> blind, NEVER RELEASE
//     4 · an F2 ALARM floors a composite [Sig, Eng, narrow-W] non-compensatorily,
//         even when Eng and narrow-W both read SILENT.
//
//   Plus the "visible, not free" check: the injected map is carried on the
//   result and printed in the exported artifact. It is NOT in the verdict —
//   the verdict summary is frozen byte-for-byte by verdict-logic.frozen.json.
//
//   THE LIMIT, STATED: Sig reads state->record fidelity, not world->state truth.
//   A consistent-but-false sequence (every precondition present, all fabricated)
//   reads SILENT and RELEASEs. This file demonstrates that too, so the second
//   leg is not mistaken for more than it is.
// ──────────────────────────────────────────────────────────────────────────────

import assert from "assert";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { MicaFixtureLog } from "./fixture-log";
import { assessSig } from "./sig";
import { deliverSigReading } from "./export";
import type { PreconditionMap, SigConfig } from "./sig";
import { assessEng } from "./eng";
import type { EngConfig } from "./eng";
import { assessNarrowW, NARROW_W_LEG2_PROXY_CALIBRATION } from "./narrow-w";
import type { NarrowWConfig } from "./narrow-w";
import { Chokepoint, FloorTrail } from "./chokepoint";
import type { ProposedAction, StakesLine } from "./chokepoint";
import type { AlarmVerdict, SensorVerdict } from "./types";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    failed++;
  }
}

const root = mkdtempSync(join(tmpdir(), "mica-sig-f2-"));
let counter = 0;
const freshFloorTrail = (): FloorTrail =>
  new FloorTrail({ path: join(root, `floor-trail-${counter++}.jsonl`) });
const freshPath = (): string => join(root, `log-${counter++}.jsonl`);

interface Spec {
  timestamp: number;
  eventType: string;
  outcome: string;
  moduleId?: string;
}

function appendAll(log: MicaFixtureLog, specs: readonly Spec[]): void {
  for (const s of specs) {
    log.append({
      timestamp: s.timestamp,
      moduleId: s.moduleId ?? "m6",
      eventType: s.eventType,
      outcome: s.outcome,
    });
  }
}

/** Persist and reload so the sensor sees LOADED_VERIFIED — the only readable
 *  state after A1, and the state a live node is in after a restart. */
function withDurable<T>(specs: readonly Spec[], fn: (log: MicaFixtureLog) => T): T {
  const path = freshPath();
  try {
    appendAll(new MicaFixtureLog({ path }), specs);
    const loaded = new MicaFixtureLog({ path });
    if (loaded.getLoadState() !== "LOADED_VERIFIED") {
      throw new Error(`FIXTURE BROKEN: ${loaded.getLoadState()} at ${path}`);
    }
    return fn(loaded);
  } finally {
    rmSync(path, { force: true });
  }
}

const T0 = 1_700_000_000_000;
const GATE: readonly string[] = ["LOADED_VERIFIED"];

// The precondition map is INJECTED here, in the test. The sensor ships with no
// map: which eventType requires which prior event is a deployment fact.
const TEST_MAP: PreconditionMap = {
  escalation_active: ["escalation_granted"],
  quarantine_lifted: ["quarantine_entered", "operator_override"],
};
const SIG_CFG: SigConfig = {
  readableLoadStates: GATE,
  clockToleranceMs: 0,
  preconditionMap: TEST_MAP,
};

// Both flags read and neither finds anything: clock monotone, every precondition
// satisfied by a prior of the required kind.
const SATISFIED: readonly Spec[] = [
  { timestamp: T0 + 0, eventType: "boot", outcome: "ok" },
  { timestamp: T0 + 10, eventType: "escalation_granted", outcome: "granted" },
  { timestamp: T0 + 20, eventType: "escalation_active", outcome: "active" },
  { timestamp: T0 + 30, eventType: "quarantine_entered", outcome: "entered" },
  { timestamp: T0 + 40, eventType: "quarantine_lifted", outcome: "lifted" },
];

// escalation_active asserts a state whose injected precondition (escalation_granted)
// appears only LATER in the chain — the state is asserted before the chain shows
// it reachable. Clock is monotone, so F1 stays SILENT and only F2 fires.
const VIOLATED: readonly Spec[] = [
  { timestamp: T0 + 0, eventType: "boot", outcome: "ok" },
  { timestamp: T0 + 10, eventType: "escalation_active", outcome: "escalation_in_force" },
  { timestamp: T0 + 20, eventType: "escalation_granted", outcome: "granted" },
];

const A = (id: string): ProposedAction => ({ id });
const LINE: StakesLine = {
  classes: ["trivial", "low", "medium", "high", "critical"],
  holdAtOrAbove: "medium",
};

console.log("\nMICA — Sig F2 activation, end to end through guard()\n");

// ══ 1 · map satisfied -> SILENT -> RELEASE ═══════════════════════════════════

console.log("══ 1 · map satisfied -> SILENT -> RELEASE ══");

withDurable(SATISFIED, (log) => {
  const r = assessSig(log, SIG_CFG);
  check("1a: a satisfied map reads SILENT (F1 and F2 both silent)", () => {
    assert.strictEqual(r.verdict.kind, "SILENT");
    // F5 honest split: no clerkClockSource injected => F3 is NOT_CONFIGURED (a
    // dormant leg excluded from the floor), not a blind CANNOT_ASSESS. The
    // composite is still SILENT. F4 (probe divergence, added 2026-09-01) is
    // likewise unconfigured here: the array grew by one, the first three did not
    // change, and the composite verdict is untouched — which is the freeze fence.
    assert.deepStrictEqual(r.flags.map((f) => f.kind), [
      "SILENT",
      "SILENT",
      "NOT_CONFIGURED",
      "NOT_CONFIGURED",
    ]);
  });
  check("1b: SILENT floors to RELEASE and the action EXECUTES", () => {
    const cp = new Chokepoint({ line: LINE, floorTrail: freshFloorTrail() });
    const d = cp.guard(A("s1"), [r.verdict], null);
    assert.strictEqual(d.disposition, "RELEASE");
    assert.strictEqual(d.execute, true);
  });
  check("1c: THE LIMIT — a satisfied map proves state->record fidelity, not truth", () => {
    // Every precondition is PRESENT; whether the escalation was genuinely
    // granted is world->state truth Sig cannot see. It reads SILENT and the
    // gate RELEASEs. Stated so the second leg is not mistaken for a truth check.
    assert.strictEqual(r.verdict.kind, "SILENT");
  });
});

// ══ 2 · precondition violated -> ALARM -> HOLD  (the second leg) ══════════════

console.log("══ 2 · precondition violated -> ALARM -> HOLD ══");

withDurable(VIOLATED, (log) => {
  const r = assessSig(log, SIG_CFG);
  check("2a: the violation is F2's, and F1 stays silent (only the second leg fired)", () => {
    assert.strictEqual(r.verdict.kind, "ALARM");
    assert.strictEqual(r.flags[0].kind, "SILENT"); // F1
    assert.strictEqual(r.flags[1].kind, "ALARM"); // F2
    const codes = (r.verdict as AlarmVerdict).findings.map((f) => f.code);
    assert.ok(codes.includes("SIG_F2_PRECONDITION_UNREACHED"));
  });
  check("2b: THE DONE-CONDITION — the F2 ALARM floors the gate to HOLD, action DOES NOT execute", () => {
    const cp = new Chokepoint({ line: LINE });
    const d = cp.guard(A("v1"), [r.verdict], { impactClass: "trivial" });
    assert.strictEqual(d.disposition, "HOLD");
    assert.strictEqual(d.execute, false);
  });
  check("2c: no stakes value releases the alarm — HOLD even at the lowest stakes and with no line", () => {
    const cp = new Chokepoint(); // no line at all
    const d = cp.guard(A("v2"), [r.verdict], { impactClass: "trivial" });
    assert.strictEqual(d.disposition, "HOLD");
    assert.strictEqual(d.execute, false);
  });
  check("2d: the adverse F2 finding RIDES ON the disposition, not dropped", () => {
    const cp = new Chokepoint({ line: LINE });
    const d = cp.guard(A("v3"), [r.verdict], null);
    const codes = d.decision.findings.map((f) => f.code);
    assert.ok(codes.includes("SIG_F2_PRECONDITION_UNREACHED"));
  });
});

// ══ 3 · map absent / empty -> CANNOT_ASSESS -> blind, NEVER RELEASE ═══════════

console.log("══ 3 · map absent / empty -> CANNOT_ASSESS -> blind, never RELEASE ══");

withDurable(SATISFIED, (log) => {
  const noMap = assessSig(log, { readableLoadStates: GATE, clockToleranceMs: 0 });
  const emptyMap = assessSig(log, {
    readableLoadStates: GATE,
    clockToleranceMs: 0,
    preconditionMap: {},
  });

  check("3a: with no map F2 is CANNOT_ASSESS, and the composite is CANNOT_ASSESS (not SILENT)", () => {
    assert.strictEqual(noMap.flags[1].kind, "CANNOT_ASSESS");
    assert.strictEqual(noMap.verdict.kind, "CANNOT_ASSESS");
  });
  check("3b: an EMPTY map does not buy a clean reading either", () => {
    assert.strictEqual(emptyMap.flags[1].kind, "CANNOT_ASSESS");
    assert.strictEqual(emptyMap.verdict.kind, "CANNOT_ASSESS");
  });
  check("3c: a blind Sig NEVER RELEASEs — no line -> cautious HOLD-BLIND, action does not run", () => {
    const cp = new Chokepoint({ line: LINE });
    for (const v of [noMap.verdict, emptyMap.verdict]) {
      const d = cp.guard(A("b"), [v], { impactClass: "high" });
      assert.strictEqual(d.disposition, "HOLD_BLIND");
      assert.strictEqual(d.execute, false);
      assert.notStrictEqual(d.disposition, "RELEASE");
    }
  });
  check("3d: even below the line, blind is PASS-BLIND (recorded) or HELD — never a clean RELEASE", () => {
    const cp = new Chokepoint(); // no line, no ledger -> cautious default HOLDs
    const d = cp.guard(A("b2"), [noMap.verdict], { impactClass: "trivial" });
    assert.notStrictEqual(d.disposition, "RELEASE");
    assert.strictEqual(d.execute, false);
  });
});

// ══ 4 · an F2 ALARM floors a composite non-compensatorily ════════════════════
//
// The second leg must cap a floor built across sensors, not only across Sig's
// own two flags. Compose a REAL F2 ALARM with a REAL Eng SILENT and a REAL
// narrow-W SILENT: three readings, one adverse, and the floor is ALARM.

console.log("══ 4 · an F2 ALARM floors [Sig, Eng, narrow-W] non-compensatorily ══");

// A real Eng SILENT: a structured sample whose outcome varies with class. This
// is the eng/healthy-anchor fixture from verdict-logic.test.ts, reused so the
// SILENT is genuine and deterministic (fixed permutation seed), not hand-built.
const ENG_CLASSES = [
  { moduleId: "m3", eventType: "canary_check" },
  { moduleId: "m5", eventType: "drift_sample" },
  { moduleId: "m7", eventType: "permission_check" },
];
function engSpecs(n: number, outcomeOf: (i: number) => string): Spec[] {
  const out: Spec[] = [];
  for (let i = 0; i < n; i++) {
    const c = ENG_CLASSES[i % ENG_CLASSES.length];
    out.push({
      moduleId: c.moduleId,
      eventType: c.eventType,
      outcome: outcomeOf(i),
      timestamp: T0 + i,
    });
  }
  return out;
}
const HEALTHY = engSpecs(90, (i) =>
  i % 4 === 0 ? "deferred" : `verdict_class_${i % ENG_CLASSES.length}`
);
const ENG_CFG: EngConfig = {
  readableLoadStates: GATE,
  structureThreshold: 0.2,
  minimumSampleSize: 30,
  // T11 · the observed-coverage floor, declared and with no default. This
  // suite declares its OWN Eng config, which is why it is in T11's `opens`:
  // without this line Eng returns MISSING_CONFIGURATION and every reading
  // through it becomes CANNOT_ASSESS.
  minimumClassCoverage: 3,
  ceilingMargin: 0.02,
  permutationSamples: 400,
  permutationSeed: 20260806,
};

// A real narrow-W SILENT now needs BOTH legs SILENT: leg 1 (all declared inquiry
// classes present) and leg 2 (the inquiry stream tracks its context, AMI≈0.164).
// Leg 2's required config is injected from NARROW_W_LEG2_PROXY_CALIBRATION —
// PRE-PILOT PROXY, subject to calibration. narrow-W reads a DEDICATED healthy
// inquiry-context log (as the Eng co-sensor already reads its own healthy log);
// the SIG fixture drives Sig only, unchanged.
const NW_Q = ["nw_q1", "nw_q2", "nw_q3"];
const NARROW_L2_HEALTHY: Spec[] = (() => {
  const out: Spec[] = [];
  let t = 0;
  const push = (eventType: string, moduleId: string): void => {
    out.push({ timestamp: T0 + t++, eventType, outcome: "o", moduleId });
  };
  for (let k = 0; k < 3; k++) {
    for (let d = 0; d < 8; d++) { push(`nw_c${k}`, "cx"); push(NW_Q[k], "m6"); }
    for (let o = 0; o < 2; o++) {
      push(`nw_c${k}`, "cx"); push(NW_Q[(k + 1) % 3], "m6");
      push(`nw_c${k}`, "cx"); push(NW_Q[(k + 2) % 3], "m6");
    }
  }
  return out;
})();
const NARROW_CFG: NarrowWConfig = {
  readableLoadStates: GATE,
  declaredProfile: NW_Q,
  correlationThreshold: NARROW_W_LEG2_PROXY_CALIBRATION.correlationThreshold,
  correlationMinimumInquiryEvents:
    NARROW_W_LEG2_PROXY_CALIBRATION.correlationMinimumInquiryEvents,
  correlationCeilingMargin: NARROW_W_LEG2_PROXY_CALIBRATION.correlationCeilingMargin,
};

withDurable(VIOLATED, (sigLog) => {
  const sig = assessSig(sigLog, SIG_CFG).verdict; // F2 ALARM
  const narrowW = withDurable(NARROW_L2_HEALTHY, (wl) =>
    assessNarrowW(wl, NARROW_CFG).verdict
  ); // leg 1 + leg 2 both SILENT
  const eng = withDurable(HEALTHY, (engLog) => assessEng(engLog, ENG_CFG).verdict); // SILENT

  check("4a: the three legs are ALARM (Sig/F2), SILENT (Eng), SILENT (narrow-W)", () => {
    assert.strictEqual(sig.kind, "ALARM");
    assert.strictEqual(eng.kind, "SILENT");
    assert.strictEqual(narrowW.kind, "SILENT");
  });
  check("4b: the composite floors to HOLD — two SILENT co-sensors cannot buy the alarm back", () => {
    const cp = new Chokepoint({ line: LINE });
    const composite: SensorVerdict[] = [sig, eng, narrowW];
    const d = cp.guard(A("c1"), composite, { impactClass: "trivial" });
    assert.strictEqual(d.disposition, "HOLD");
    assert.strictEqual(d.execute, false);
    // order-independent: the alarm caps the floor wherever it sits
    const d2 = cp.guard(A("c2"), [eng, narrowW, sig], { impactClass: "critical" });
    assert.strictEqual(d2.disposition, "HOLD");
  });
  check("4c: drop the F2 ALARM and the SAME two co-sensors RELEASE — the alarm was load-bearing", () => {
    const cp = new Chokepoint({ line: LINE, floorTrail: freshFloorTrail() });
    const d = cp.guard(A("c3"), [eng, narrowW], null);
    assert.strictEqual(d.disposition, "RELEASE");
  });
});

// ══ visible, not free — the injected map is carried and printed, not in the verdict ══

console.log("══ visible, not free · the injected map is carried on the result and printed ══");

withDurable(SATISFIED, (log) => {
  const injected = assessSig(log, SIG_CFG);
  const absent = assessSig(log, { readableLoadStates: GATE, clockToleranceMs: 0 });
  const empty = assessSig(log, {
    readableLoadStates: GATE,
    clockToleranceMs: 0,
    preconditionMap: {},
  });

  check("v1: the injected map is carried on the result (mirrors narrow-W's declaredProfile)", () => {
    assert.strictEqual(injected.preconditionMap, TEST_MAP);
  });
  check("v2: absent OR empty map -> null on the result, never a substituted default", () => {
    assert.strictEqual(absent.preconditionMap, null);
    assert.strictEqual(empty.preconditionMap, null);
  });
  check("v3: NOT IN THE VERDICT — the frozen summary names no governed eventType", () => {
    // The map must not leak into verdict text; verdict-logic.frozen.json owns it.
    assert.ok(!injected.verdict.summary.includes("escalation_active"));
    assert.ok(!injected.verdict.summary.includes("quarantine_lifted"));
  });
  check("v4: the exported artifact PRINTS which preconditions F2 checked (not free)", () => {
    const delivered = deliverSigReading(injected); // no path -> renders, does not write
    assert.ok(delivered.artifact.includes("WHAT F2 WAS TOLD TO CHECK"));
    assert.ok(delivered.artifact.includes("escalation_active"));
    assert.ok(delivered.artifact.includes("quarantine_lifted"));
  });
  check("v5: a dormant F2 artifact says so, in words, rather than printing a phantom map", () => {
    const delivered = deliverSigReading(absent);
    assert.ok(delivered.artifact.includes("WHAT F2 WAS TOLD TO CHECK"));
    assert.ok(delivered.artifact.includes("DORMANT"));
  });
});

// ── Summary ──────────────────────────────────────────────────────────────────

rmSync(root, { recursive: true, force: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
