// ──────────────────────────────────────────────────────────────────────────────
// MICA — narrow-W, TWO legs (book shape + inquiry-context signature), wired into
// the chokepoint.
//   npx ts-node src/mica/narrow-w/narrow-w.test.ts
//
// House style: standalone ts-node script, custom check() harness, no framework.
//
// Layers under test:
//   A · LEG 1 in composition — presence of declared classes; the composed
//       verdict is worst(leg1, leg2), so leg-1 SILENT/ALARM is asserted with a
//       leg-2-SILENT companion fixture (a healthy inquiry-context table).
//   L2 · LEG 2 arms — theatre (ALARM), healthy (SILENT), ceiling (CANNOT_ASSESS),
//       flattening / single-context / no-repeated-context (INELIGIBLE_SCOPE),
//       insufficient sample, orphan counting, missing configuration.
//   C · COMPOSITION MATRIX — worst-of over the two legs, both directions.
//   E · end to end through guard() — a declared profile + leg-2 config flows
//       through narrow-W into a chokepoint disposition, composing with real Sig +
//       Eng through the non-compensatory floor.
//
// THE STATISTIC IS ENG'S, RE-AIMED (../stat/ami). The AMI fixtures below were
// calibrated against the real reader; the pre-pilot PROXY calibration
// (NARROW_W_LEG2_PROXY_CALIBRATION — threshold 0.05, min 30, margin 0.02) is
// injected wherever leg 2 is exercised, and is SUBJECT TO CALIBRATION.
// ──────────────────────────────────────────────────────────────────────────────

import assert from "assert";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { MicaFixtureLog } from "../fixture-log";
import { assessSig } from "../sig";
import { assessEng } from "../eng";
import type { PreconditionMap, SigConfig } from "../sig";
import type { EngConfig } from "../eng";
import type {
  AlarmVerdict,
  CannotAssessVerdict,
  SensorVerdict,
} from "../types";
import {
  assessNarrowW,
  narrowWScopeBlockText,
  NARROW_W_SENSOR_ID,
  NARROW_W_LEG2_PROXY_CALIBRATION,
} from "./index";
import type { NarrowWConfig } from "./index";
import { NARROW_W_COMPETENCE_LINES } from "../competence";
import { Chokepoint, ChokepointLedger, FloorTrail } from "../chokepoint";
import type { ProposedAction, StakesLine } from "../chokepoint";

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

const root = mkdtempSync(join(tmpdir(), "mica-narrowW-"));
let counter = 0;
const freshFloorTrail = (): FloorTrail =>
  new FloorTrail({ path: join(root, `floor-trail-${counter++}.jsonl`) });
const A = (id: string): ProposedAction => ({ id });
const T0 = 1_700_000_000_000;
const GATE: readonly string[] = ["LOADED_VERIFIED"];
const LINE: StakesLine = {
  classes: ["trivial", "low", "medium", "high", "critical"],
  holdAtOrAbove: "medium",
};

interface Spec {
  eventType: string;
  outcome: string;
  moduleId?: string;
}
function appendAll(log: MicaFixtureLog, specs: readonly Spec[]): void {
  let t = 0;
  for (const s of specs) {
    log.append({
      timestamp: T0 + t++,
      moduleId: s.moduleId ?? "m6",
      eventType: s.eventType,
      outcome: s.outcome,
    });
  }
}
function withDurable<T>(specs: readonly Spec[], fn: (log: MicaFixtureLog) => T): T {
  const path = join(root, `log-${counter++}.jsonl`);
  try {
    appendAll(new MicaFixtureLog({ path }), specs);
    const loaded = new MicaFixtureLog({ path });
    if (loaded.getLoadState() !== "LOADED_VERIFIED") {
      throw new Error(`FIXTURE BROKEN: ${loaded.getLoadState()}`);
    }
    return fn(loaded);
  } finally {
    rmSync(path, { force: true });
  }
}

// ── The inquiry / context alphabet ────────────────────────────────────────────
//
// INQUIRY classes are the declared profile (eventType in the profile, moduleId
// m6). CONTEXT classes are everything else (eventType ctx_*, moduleId cx) —
// option A: the context is the profile's complement, no second declared list.
const INQUIRY: readonly string[] = ["inq_canary", "inq_drift", "inq_perm"];
const ctx = (k: string): Spec => ({ eventType: `ctx_${k}`, outcome: "o", moduleId: "cx" });
const inq = (q: string): Spec => ({ eventType: q, outcome: "o" });

// Diagonal-dominant inquiry↔context table. nDiag on the diagonal (Ck→Qk), nOff
// off each diagonal. diag(8,2) lands AMI≈0.164 (SILENT); diag(15,0) is perfectly
// deterministic, AMI=1 (at the ceiling → CANNOT_ASSESS).
function diag(nDiag: number, nOff: number): Spec[] {
  const specs: Spec[] = [];
  const C = ["1", "2", "3"];
  for (let k = 0; k < 3; k++) {
    for (let d = 0; d < nDiag; d++) {
      specs.push(ctx(C[k]));
      specs.push(inq(INQUIRY[k]));
    }
    for (let o = 0; o < nOff; o++) {
      specs.push(ctx(C[k]));
      specs.push(inq(INQUIRY[(k + 1) % 3]));
      specs.push(ctx(C[k]));
      specs.push(inq(INQUIRY[(k + 2) % 3]));
    }
  }
  return specs;
}
// Uniform inquiry regardless of context: every context sees every inquiry the
// same number of times → AMI ≈ 0 → ALARM. The theatre pattern.
function theatreUniform(): Spec[] {
  const specs: Spec[] = [];
  for (const cc of ["1", "2", "3"]) {
    for (let rep = 0; rep < 6; rep++) {
      for (const q of INQUIRY) {
        specs.push(ctx(cc));
        specs.push(inq(q));
      }
    }
  }
  return specs;
}

const HEALTHY_L2 = diag(8, 2); // leg 1 all present, leg 2 SILENT
const THEATRE_L2 = theatreUniform(); // leg 2 ALARM
const CEILING_L2 = diag(15, 0); // leg 2 CANNOT_ASSESS (ceiling)

// A clean, small log that makes Sig SILENT (monotonic clock; F2 precondition met).
const SIG_CLEAN: readonly Spec[] = [
  { eventType: "boot", outcome: "ok" },
  { eventType: "escalation_granted", outcome: "granted" },
  { eventType: "escalation_active", outcome: "active" },
  { eventType: "canary_check", outcome: "clean" },
];
const SIG_CFG: SigConfig = {
  readableLoadStates: GATE,
  clockToleranceMs: 0,
  preconditionMap: { escalation_active: ["escalation_granted"] } as PreconditionMap,
};
// A healthy Eng log (>= sample, structured outcome).
const ENG_CLASSES = [
  { moduleId: "m3", eventType: "e_a" },
  { moduleId: "m5", eventType: "e_b" },
  { moduleId: "m7", eventType: "e_c" },
];
const ENG_HEALTHY: Spec[] = [];
for (let i = 0; i < 90; i++) {
  const c = ENG_CLASSES[i % ENG_CLASSES.length];
  ENG_HEALTHY.push({
    moduleId: c.moduleId,
    eventType: c.eventType,
    outcome: i % 4 === 0 ? "deferred" : `verdict_class_${i % ENG_CLASSES.length}`,
  });
}
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
};

// ── Config helpers ────────────────────────────────────────────────────────────
const L2 = NARROW_W_LEG2_PROXY_CALIBRATION; // PRE-PILOT PROXY, subject to calibration
// Full config: both legs live.
const cfgFull = (declaredProfile?: readonly string[]): NarrowWConfig => ({
  readableLoadStates: GATE,
  declaredProfile,
  correlationThreshold: L2.correlationThreshold,
  correlationMinimumInquiryEvents: L2.correlationMinimumInquiryEvents,
  correlationCeilingMargin: L2.correlationCeilingMargin,
  correlationPermutationSamples: L2.correlationPermutationSamples,
  correlationPermutationSeed: L2.correlationPermutationSeed,
});
// Full config WITHOUT the ceiling margin (report-only absence → note printed).
const cfgNoCeiling = (declaredProfile?: readonly string[]): NarrowWConfig => ({
  readableLoadStates: GATE,
  declaredProfile,
  correlationThreshold: L2.correlationThreshold,
  correlationMinimumInquiryEvents: L2.correlationMinimumInquiryEvents,
});
// Leg-1 config ONLY — the "named consequence": leg 2 is blind → composite CA.
const cfgLeg1Only = (declaredProfile?: readonly string[]): NarrowWConfig => ({
  readableLoadStates: GATE,
  declaredProfile,
});

function blindClasses(v: SensorVerdict): string[] {
  assert.strictEqual(v.kind, "CANNOT_ASSESS", `expected CANNOT_ASSESS, got ${v.kind}`);
  return (v as CannotAssessVerdict).blindPaths.map((b) => b.class);
}
function findingCodes(v: SensorVerdict): string[] {
  assert.strictEqual(v.kind, "ALARM", `expected ALARM, got ${v.kind}`);
  return (v as AlarmVerdict).findings.map((f) => f.code);
}

console.log("\nMICA — narrow-W: book shape + inquiry-context signature\n");

// ══ A · leg 1 in composition ═════════════════════════════════════════════════

console.log("\n══ A · leg 1 (book shape), composed with a healthy leg 2 ══");

check("all declared classes present + healthy leg 2 -> SILENT, correspondence limit stated", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowW(log, cfgFull(INQUIRY));
    assert.strictEqual(r.verdict.kind, "SILENT");
    assert.strictEqual(r.verdict.sensorId, NARROW_W_SENSOR_ID);
    assert.ok(r.verdict.summary.includes("CORRESPONDENCE TO THE NAMED PROFILE ONLY"));
    assert.ok(r.verdict.summary.includes("SILENT against a faker"));
    assert.ok(r.presence.every((p) => p.present));
    assert.strictEqual(r.correlation?.legVerdictKind, "SILENT");
  });
});
check("a declared class absent -> ALARM (leg 1 floors, whatever leg 2 says)", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowW(log, cfgFull([...INQUIRY, "inq_absent"]));
    assert.strictEqual(r.verdict.kind, "ALARM");
    assert.ok(findingCodes(r.verdict).includes("W_INQUIRY_CLASS_ABSENT"));
    if (r.verdict.kind === "ALARM") {
      assert.ok(r.verdict.findings.some((f) => f.detail.includes("inq_absent")));
    }
    assert.deepStrictEqual(
      r.presence.filter((p) => !p.present).map((p) => p.inquiryClass),
      ["inq_absent"]
    );
  });
});
check("NO profile injected -> CANNOT_ASSESS (MISSING_CONFIGURATION) BEFORE any leg runs", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowW(log, cfgFull(undefined));
    assert.deepStrictEqual(blindClasses(r.verdict), ["MISSING_CONFIGURATION"]);
    if (r.verdict.kind === "CANNOT_ASSESS") {
      assert.ok(r.verdict.blindPaths[0].detail.includes("no leg runs"));
    }
    assert.strictEqual(r.correlation, null); // leg 2 never ran
  });
});
check("a VACUOUS (empty) profile -> CANNOT_ASSESS — vacuity buys no clean reading", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowW(log, cfgFull([]));
    assert.deepStrictEqual(blindClasses(r.verdict), ["MISSING_CONFIGURATION"]);
    assert.strictEqual(r.declaredProfile, null);
    assert.strictEqual(r.correlation, null);
  });
});
check("an unreadable load state -> CANNOT_ASSESS (the D8 gate fires first, before legs)", () => {
  const inMem = new MicaFixtureLog(); // IN_MEMORY, not in GATE
  appendAll(inMem, HEALTHY_L2);
  const r = assessNarrowW(inMem, cfgFull(INQUIRY));
  assert.deepStrictEqual(blindClasses(r.verdict), ["NON_CLEAN_LOAD_STATE"]);
  assert.strictEqual(r.correlation, null);
});
check("the profile this run checked is printed in the verdict", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowW(log, cfgFull(INQUIRY));
    for (const c of INQUIRY) assert.ok(r.verdict.summary.includes(c), `missing ${c}`);
  });
});

// ══ L2 · the leg-2 arms ══════════════════════════════════════════════════════

console.log("\n══ L2 · the inquiry-context signature arms ══");

check("THEATRE: inquiry emitted uniformly, independent of context -> ALARM (W_INQUIRY_CONTEXT_COLLAPSE)", () => {
  withDurable(THEATRE_L2, (log) => {
    const r = assessNarrowW(log, cfgFull(INQUIRY));
    assert.strictEqual(r.verdict.kind, "ALARM");
    assert.ok(findingCodes(r.verdict).includes("W_INQUIRY_CONTEXT_COLLAPSE"));
    assert.strictEqual(r.correlation?.legVerdictKind, "ALARM");
    assert.ok((r.correlation?.structure?.ami as number) < L2.correlationThreshold);
  });
});
check("HEALTHY: inquiry structured on context -> SILENT, with the lookup defeat printed", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowW(log, cfgFull(INQUIRY));
    assert.strictEqual(r.verdict.kind, "SILENT");
    assert.ok(r.verdict.summary.includes("LOOKUP TABLE"));
    assert.ok((r.correlation?.structure?.ami as number) >= L2.correlationThreshold);
  });
});
check("FLATTENING: single-inquiry-class profile -> CANNOT_ASSESS (INELIGIBLE_SCOPE, H(I)=0)", () => {
  const body: Spec[] = [];
  for (let i = 0; i < 40; i++) {
    body.push(ctx(["1", "2", "3"][i % 3]));
    body.push(inq("inq_solo"));
  }
  withDurable(body, (log) => {
    const r = assessNarrowW(log, cfgFull(["inq_solo"]));
    assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"]);
    if (r.verdict.kind === "CANNOT_ASSESS") {
      assert.ok(r.verdict.blindPaths[0].detail.includes("H(I)=0"));
    }
    assert.strictEqual(r.correlation?.structure?.distinctLeft, 1);
  });
});
check("CEILING: deterministic context->inquiry, margin injected -> CANNOT_ASSESS (not ALARM)", () => {
  withDurable(CEILING_L2, (log) => {
    const r = assessNarrowW(log, cfgFull(INQUIRY));
    assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"]);
    if (r.verdict.kind === "CANNOT_ASSESS") {
      assert.ok(r.verdict.blindPaths[0].detail.includes("at the ceiling"));
      assert.ok(r.verdict.blindPaths[0].detail.includes("LOOKUP TABLE"));
    }
    assert.strictEqual(r.correlation?.ceilingCheck, "PERFORMED");
  });
});
check("CEILING margin ABSENT: the same deterministic table reads SILENT but carries the not-performed note", () => {
  withDurable(CEILING_L2, (log) => {
    const r = assessNarrowW(log, cfgNoCeiling(INQUIRY));
    assert.strictEqual(r.verdict.kind, "SILENT"); // AMI=1 >= threshold, ceiling unchecked
    assert.ok(r.verdict.summary.includes("LEG-2 CEILING CHECK DID NOT RUN"));
    assert.strictEqual(r.correlation?.ceilingCheck, "NOT_PERFORMED");
  });
});
check("ARITY: fewer than 2 context classes -> CANNOT_ASSESS (INELIGIBLE_SCOPE)", () => {
  const body: Spec[] = [ctx("1")];
  for (let i = 0; i < 36; i++) body.push(inq(INQUIRY[i % 3]));
  withDurable(body, (log) => {
    const r = assessNarrowW(log, cfgFull(INQUIRY));
    assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"]);
    assert.strictEqual(r.correlation?.structure?.distinctRight, 1);
  });
});
check("ARITY: no context class recurs -> CANNOT_ASSESS (INELIGIBLE_SCOPE)", () => {
  const body: Spec[] = [];
  for (let i = 0; i < 36; i++) {
    body.push(ctx(String(i)));
    body.push(inq(INQUIRY[i % 3]));
  }
  withDurable(body, (log) => {
    const r = assessNarrowW(log, cfgFull(INQUIRY));
    assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"]);
    assert.strictEqual(r.correlation?.structure?.hasRepeatedRight, false);
  });
});
check("INSUFFICIENT: fewer paired than the injected minimum -> CANNOT_ASSESS (INSUFFICIENT_SAMPLE)", () => {
  const body: Spec[] = [];
  for (let i = 0; i < 12; i++) {
    body.push(ctx(["1", "2", "3"][i % 3]));
    body.push(inq(INQUIRY[i % 3]));
  }
  withDurable(body, (log) => {
    const r = assessNarrowW(log, cfgFull(INQUIRY));
    assert.deepStrictEqual(blindClasses(r.verdict), ["INSUFFICIENT_SAMPLE"]);
    assert.strictEqual(r.correlation?.pairedCount, 12);
  });
});
check("MISSING CONFIG: no correlationThreshold/minimum -> CANNOT_ASSESS (MISSING_CONFIGURATION), leg 2 blind", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowW(log, cfgLeg1Only(INQUIRY));
    assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
    assert.ok(blindClasses(r.verdict).every((c) => c === "MISSING_CONFIGURATION"));
    assert.strictEqual(r.correlation, null); // leg 2 could not even pair
  });
});
check("ORPHANS: inquiries before any context are counted, excluded, and printed (report-only)", () => {
  const body: Spec[] = [inq("inq_canary"), inq("inq_drift"), ...HEALTHY_L2];
  withDurable(body, (log) => {
    const r = assessNarrowW(log, cfgFull(INQUIRY));
    assert.strictEqual(r.verdict.kind, "SILENT"); // the read still proceeds
    assert.strictEqual(r.correlation?.orphanCount, 2);
    assert.strictEqual(r.correlation?.pairedCount, 36); // orphans excluded from the table
    assert.strictEqual(r.correlation?.totalInquiryRecords, 38);
    assert.ok(r.verdict.summary.includes("orphan"));
  });
});

// ══ C · composition matrix — worst of the two legs ═══════════════════════════

console.log("\n══ C · composition matrix (ALARM > CANNOT_ASSESS > SILENT) ══");

check("(leg1 SILENT, leg2 SILENT) -> SILENT", () => {
  withDurable(HEALTHY_L2, (log) => {
    assert.strictEqual(assessNarrowW(log, cfgFull(INQUIRY)).verdict.kind, "SILENT");
  });
});
check("(leg1 ALARM, leg2 SILENT) -> ALARM", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowW(log, cfgFull([...INQUIRY, "inq_absent"]));
    assert.strictEqual(r.verdict.kind, "ALARM");
    assert.ok(findingCodes(r.verdict).includes("W_INQUIRY_CLASS_ABSENT"));
    assert.strictEqual(r.correlation?.legVerdictKind, "SILENT");
  });
});
check("(leg1 SILENT, leg2 ALARM) -> ALARM", () => {
  withDurable(THEATRE_L2, (log) => {
    const r = assessNarrowW(log, cfgFull(INQUIRY));
    assert.strictEqual(r.verdict.kind, "ALARM");
    assert.ok(findingCodes(r.verdict).includes("W_INQUIRY_CONTEXT_COLLAPSE"));
  });
});
check("(leg1 ALARM, leg2 ALARM) -> ALARM, BOTH findings concatenated", () => {
  withDurable(THEATRE_L2, (log) => {
    const r = assessNarrowW(log, cfgFull([...INQUIRY, "inq_absent"]));
    assert.strictEqual(r.verdict.kind, "ALARM");
    const codes = findingCodes(r.verdict);
    assert.ok(codes.includes("W_INQUIRY_CLASS_ABSENT"));
    assert.ok(codes.includes("W_INQUIRY_CONTEXT_COLLAPSE"));
  });
});
check("(leg1 SILENT, leg2 CANNOT_ASSESS) -> CANNOT_ASSESS", () => {
  withDurable(CEILING_L2, (log) => {
    const r = assessNarrowW(log, cfgFull(INQUIRY));
    assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
    assert.strictEqual(r.correlation?.legVerdictKind, "CANNOT_ASSESS");
  });
});
check("NAMED CONSEQUENCE: (leg1 SILENT, leg-1-only config) -> CANNOT_ASSESS — an unconfigured read is blindness", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowW(log, cfgLeg1Only(INQUIRY));
    assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
    assert.ok(blindClasses(r.verdict).includes("MISSING_CONFIGURATION"));
  });
});
check("profile absent -> CANNOT_ASSESS BEFORE any leg runs (existing behavior)", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowW(log, cfgFull(undefined));
    assert.deepStrictEqual(blindClasses(r.verdict), ["MISSING_CONFIGURATION"]);
    assert.strictEqual(r.correlation, null);
  });
});

// ══ E · end to end through guard() ═══════════════════════════════════════════

console.log("\n══ E · a declared profile + leg-2 config flows through narrow-W into a disposition ══");

check("1 · both legs SILENT -> composite SILENT -> RELEASE", () => {
  withDurable(HEALTHY_L2, (log) => {
    const w = assessNarrowW(log, cfgFull(INQUIRY)).verdict;
    assert.strictEqual(w.kind, "SILENT");
    const cp = new Chokepoint({ line: LINE, floorTrail: freshFloorTrail() });
    const r = cp.guard(A("w-release"), [w], { impactClass: "high" });
    assert.strictEqual(r.disposition, "RELEASE");
    assert.strictEqual(r.execute, true);
  });
});
check("2 · a declared-expected class missing -> ALARM -> HOLD", () => {
  withDurable(HEALTHY_L2, (log) => {
    const w = assessNarrowW(log, cfgFull([...INQUIRY, "inq_absent"])).verdict;
    assert.strictEqual(w.kind, "ALARM");
    const cp = new Chokepoint({ line: LINE });
    const r = cp.guard(A("w-hold"), [w], { impactClass: "trivial" });
    assert.strictEqual(r.decision.floorKind, "ALARM");
    assert.strictEqual(r.disposition, "HOLD");
    assert.strictEqual(r.execute, false);
  });
});
check("2b · leg-2 THEATRE collapse alone -> ALARM -> HOLD (leg 1 is SILENT)", () => {
  withDurable(THEATRE_L2, (log) => {
    const w = assessNarrowW(log, cfgFull(INQUIRY)).verdict;
    assert.strictEqual(w.kind, "ALARM");
    const cp = new Chokepoint({ line: LINE });
    const r = cp.guard(A("w-theatre-hold"), [w], { impactClass: "trivial" });
    assert.strictEqual(r.disposition, "HOLD");
    assert.strictEqual(r.execute, false);
  });
});
check("3 · profile absent -> CANNOT_ASSESS -> blind, never RELEASE (both sides of the line)", () => {
  withDurable(HEALTHY_L2, (log) => {
    const w = assessNarrowW(log, cfgFull(undefined)).verdict;
    assert.strictEqual(w.kind, "CANNOT_ASSESS");
    const cp = new Chokepoint({
      line: LINE,
      ledger: new ChokepointLedger({ path: join(root, `l-${counter++}.jsonl`) }),
      floorTrail: freshFloorTrail(),
    });
    const hi = cp.guard(A("w-blind-hi"), [w], { impactClass: "critical" });
    assert.strictEqual(hi.disposition, "HOLD_BLIND");
    const lo = cp.guard(A("w-blind-lo"), [w], { impactClass: "trivial" });
    assert.strictEqual(lo.disposition, "PASS_BLIND");
  });
});
check("3b · leg-2 blind (no correlation config) is blind too -> never RELEASE", () => {
  withDurable(HEALTHY_L2, (log) => {
    const w = assessNarrowW(log, cfgLeg1Only(INQUIRY)).verdict;
    assert.strictEqual(w.kind, "CANNOT_ASSESS");
    const cp = new Chokepoint({ line: LINE });
    const r = cp.guard(A("w-leg2-blind"), [w], { impactClass: "high" });
    assert.notStrictEqual(r.disposition, "RELEASE");
    assert.strictEqual(r.disposition, "HOLD_BLIND");
  });
});
check("4 · non-compensatory: narrow-W ALARM floors it even when real Sig + Eng are SILENT", () => {
  withDurable(SIG_CLEAN, (sigLog) =>
    withDurable(ENG_HEALTHY, (engLog) =>
      withDurable(THEATRE_L2, (wLog) => {
        const sig = assessSig(sigLog, SIG_CFG).verdict; // SILENT
        const eng = assessEng(engLog, ENG_CFG).verdict; // SILENT
        const w = assessNarrowW(wLog, cfgFull(INQUIRY)).verdict; // ALARM (leg-2 collapse)
        assert.strictEqual(sig.kind, "SILENT");
        assert.strictEqual(eng.kind, "SILENT");
        assert.strictEqual(w.kind, "ALARM");
        const cp = new Chokepoint({ line: LINE });
        const r = cp.guard(A("w-noncomp"), [sig, eng, w], { impactClass: "critical" });
        assert.strictEqual(r.decision.floorKind, "ALARM");
        assert.strictEqual(r.disposition, "HOLD");
        assert.strictEqual(r.execute, false);
      })
    )
  );
});

// ══ S · scope block / competence content ════════════════════════════════════

console.log("\n══ S · scope block and competence content ══");

check("competence block mentions the ceiling / evidence-free distinction (leg-2 drift guard)", () => {
  const joined = NARROW_W_COMPETENCE_LINES.join(" ");
  assert.ok(
    joined.includes("EVIDENCE-FREE") || joined.includes("evidence-free"),
    "NARROW_W_COMPETENCE_LINES must mention EVIDENCE-FREE so the leg-2 ceiling distinction cannot silently recur"
  );
  assert.ok(
    joined.includes("CEILING") || joined.includes("ceiling"),
    "NARROW_W_COMPETENCE_LINES must mention the ceiling"
  );
});

check("competence block is not leg-1-only: it carries a leg-2 presumption (sibling-parity check)", () => {
  const joined = NARROW_W_COMPETENCE_LINES.join(" ");
  assert.ok(
    joined.includes("LEG-2") || joined.includes("leg 2") || joined.includes("leg-2"),
    "NARROW_W_COMPETENCE_LINES must carry a leg-2 presumption as narrow-R and narrow-K do"
  );
  assert.ok(
    joined.includes("adjusted mutual information") || joined.includes("ADJUSTED mutual information"),
    "NARROW_W_COMPETENCE_LINES must mention adjusted mutual information (the leg-2 statistic)"
  );
});

check("competence block appears in the rendered scope block", () => {
  const scopeText = narrowWScopeBlockText(GATE);
  for (const line of NARROW_W_COMPETENCE_LINES) {
    assert.ok(
      scopeText.includes(line.trim()),
      `scope block missing competence line: "${line.trim().slice(0, 60)}..."`
    );
  }
});

rmSync(root, { recursive: true, force: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
