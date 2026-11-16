// ──────────────────────────────────────────────────────────────────────────────
// MICA — narrow-R, TWO legs (book shape + verification-context signature), wired
// into the chokepoint.
//   npx ts-node src/mica/narrow-r/narrow-r.test.ts
//
// House style: standalone ts-node script, custom check() harness, no framework.
//
// Layers under test:
//   A · LEG 1 in composition — presence of declared verification classes.
//   L2 · LEG 2 arms — theatre (ALARM), healthy (SILENT), ceiling (CANNOT_ASSESS),
//       flattening / single-context / no-repeated-context (INELIGIBLE_SCOPE),
//       insufficient sample, orphan counting, missing configuration.
//   C · COMPOSITION MATRIX — worst-of over the two legs.
//   E · end to end through guard() — narrow-R composes with real Sig + Eng +
//       narrow-W through the non-compensatory floor.
//   X · CROSS-CHECK (route ii) — narrow-R and narrow-W produce the IDENTICAL AMI
//       on one shared table (they share only ../stat/ami).
//
// Fixtures were calibrated against the real reader; the pre-pilot PROXY
// calibration (NARROW_R_PROXY_CALIBRATION — threshold 0.05, min 30, margin 0.02)
// is injected wherever leg 2 is exercised, and is SUBJECT TO CALIBRATION.
// ──────────────────────────────────────────────────────────────────────────────

import assert from "assert";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { MicaFixtureLog } from "../fixture-log";
import { assessSig } from "../sig";
import { assessEng } from "../eng";
import { assessNarrowW } from "../narrow-w";
import type { PreconditionMap, SigConfig } from "../sig";
import type { EngConfig } from "../eng";
import type { NarrowWConfig } from "../narrow-w";
import { NARROW_W_LEG2_PROXY_CALIBRATION } from "../narrow-w";
import type {
  AlarmVerdict,
  CannotAssessVerdict,
  SensorVerdict,
} from "../types";
import {
  assessNarrowR,
  NARROW_R_SENSOR_ID,
  NARROW_R_PROXY_CALIBRATION,
} from "./index";
import type { NarrowRConfig } from "./index";
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

const root = mkdtempSync(join(tmpdir(), "mica-narrowR-"));
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

// ── The verification / context alphabet ───────────────────────────────────────
//
// VERIFICATION classes are the declared profile (eventType in the profile,
// moduleId m6). CONTEXT classes are everything else (eventType ctx_*, moduleId
// cx) — option A: context is the profile's complement, no second declared list.
const VERIFY: readonly string[] = ["ver_hash", "ver_sig", "ver_replay"];
const ctx = (k: string): Spec => ({ eventType: `ctx_${k}`, outcome: "o", moduleId: "cx" });
const ver = (v: string): Spec => ({ eventType: v, outcome: "o" });

// Diagonal-dominant verification↔context table. diag(8,2) lands AMI≈0.164
// (SILENT); diag(15,0) is perfectly deterministic, AMI=1 (ceiling → CA).
function diag(nDiag: number, nOff: number): Spec[] {
  const specs: Spec[] = [];
  const C = ["1", "2", "3"];
  for (let k = 0; k < 3; k++) {
    for (let d = 0; d < nDiag; d++) {
      specs.push(ctx(C[k]));
      specs.push(ver(VERIFY[k]));
    }
    for (let o = 0; o < nOff; o++) {
      specs.push(ctx(C[k]));
      specs.push(ver(VERIFY[(k + 1) % 3]));
      specs.push(ctx(C[k]));
      specs.push(ver(VERIFY[(k + 2) % 3]));
    }
  }
  return specs;
}
// Uniform verification regardless of context → AMI ≈ 0 → ALARM. The theatre arm.
function theatreUniform(): Spec[] {
  const specs: Spec[] = [];
  for (const cc of ["1", "2", "3"]) {
    for (let rep = 0; rep < 6; rep++) {
      for (const v of VERIFY) {
        specs.push(ctx(cc));
        specs.push(ver(v));
      }
    }
  }
  return specs;
}

const HEALTHY_L2 = diag(8, 2); // leg 1 all present, leg 2 SILENT
const THEATRE_L2 = theatreUniform(); // leg 2 ALARM
const CEILING_L2 = diag(15, 0); // leg 2 CANNOT_ASSESS (ceiling)

// A clean, small log that makes Sig SILENT.
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
// A healthy Eng log.
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
const RP = NARROW_R_PROXY_CALIBRATION; // PRE-PILOT PROXY, subject to calibration
const cfgFull = (declaredProfile?: readonly string[]): NarrowRConfig => ({
  readableLoadStates: GATE,
  declaredProfile,
  correlationThreshold: RP.correlationThreshold,
  correlationMinimumVerificationEvents: RP.correlationMinimumVerificationEvents,
  correlationCeilingMargin: RP.correlationCeilingMargin,
  correlationPermutationSamples: RP.correlationPermutationSamples,
  correlationPermutationSeed: RP.correlationPermutationSeed,
});
const cfgNoCeiling = (declaredProfile?: readonly string[]): NarrowRConfig => ({
  readableLoadStates: GATE,
  declaredProfile,
  correlationThreshold: RP.correlationThreshold,
  correlationMinimumVerificationEvents: RP.correlationMinimumVerificationEvents,
});
const cfgLeg1Only = (declaredProfile?: readonly string[]): NarrowRConfig => ({
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

console.log("\nMICA — narrow-R: book shape + verification-context signature\n");

// ══ A · leg 1 in composition ═════════════════════════════════════════════════

console.log("\n══ A · leg 1 (book shape), composed with a healthy leg 2 ══");

check("all declared classes present + healthy leg 2 -> SILENT, correspondence limit stated", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowR(log, cfgFull(VERIFY));
    assert.strictEqual(r.verdict.kind, "SILENT");
    assert.strictEqual(r.verdict.sensorId, NARROW_R_SENSOR_ID);
    assert.ok(r.verdict.summary.includes("CORRESPONDENCE TO THE NAMED PROFILE ONLY"));
    assert.ok(r.verdict.summary.includes("SILENT against a faker"));
    assert.ok(r.presence.every((p) => p.present));
    assert.strictEqual(r.correlation?.legVerdictKind, "SILENT");
  });
});
check("a declared class absent -> ALARM (R_VERIFICATION_CLASS_ABSENT)", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowR(log, cfgFull([...VERIFY, "ver_absent"]));
    assert.strictEqual(r.verdict.kind, "ALARM");
    assert.ok(findingCodes(r.verdict).includes("R_VERIFICATION_CLASS_ABSENT"));
    if (r.verdict.kind === "ALARM") {
      assert.ok(r.verdict.findings.some((f) => f.detail.includes("ver_absent")));
    }
    assert.deepStrictEqual(
      r.presence.filter((p) => !p.present).map((p) => p.verificationClass),
      ["ver_absent"]
    );
  });
});
check("NO profile injected -> CANNOT_ASSESS (MISSING_CONFIGURATION) BEFORE any leg runs", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowR(log, cfgFull(undefined));
    assert.deepStrictEqual(blindClasses(r.verdict), ["MISSING_CONFIGURATION"]);
    if (r.verdict.kind === "CANNOT_ASSESS") {
      assert.ok(r.verdict.blindPaths[0].detail.includes("no leg runs"));
    }
    assert.strictEqual(r.correlation, null);
  });
});
check("an unreadable load state -> CANNOT_ASSESS (the D8 gate fires first)", () => {
  const inMem = new MicaFixtureLog(); // IN_MEMORY, not in GATE
  appendAll(inMem, HEALTHY_L2);
  const r = assessNarrowR(inMem, cfgFull(VERIFY));
  assert.deepStrictEqual(blindClasses(r.verdict), ["NON_CLEAN_LOAD_STATE"]);
  assert.strictEqual(r.correlation, null);
});

// ══ L2 · the leg-2 arms ══════════════════════════════════════════════════════

console.log("\n══ L2 · the verification-context signature arms ══");

check("THEATRE: verification emitted uniformly -> ALARM (R_VERIFICATION_CONTEXT_COLLAPSE)", () => {
  withDurable(THEATRE_L2, (log) => {
    const r = assessNarrowR(log, cfgFull(VERIFY));
    assert.strictEqual(r.verdict.kind, "ALARM");
    assert.ok(findingCodes(r.verdict).includes("R_VERIFICATION_CONTEXT_COLLAPSE"));
    assert.ok((r.correlation?.structure?.ami as number) < RP.correlationThreshold);
  });
});
check("HEALTHY: verification structured on context -> SILENT, lookup defeat printed", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowR(log, cfgFull(VERIFY));
    assert.strictEqual(r.verdict.kind, "SILENT");
    assert.ok(r.verdict.summary.includes("LOOKUP TABLE"));
    assert.ok((r.correlation?.structure?.ami as number) >= RP.correlationThreshold);
  });
});
check("FLATTENING: single-verification-class profile -> CANNOT_ASSESS (INELIGIBLE_SCOPE, H(V)=0)", () => {
  const body: Spec[] = [];
  for (let i = 0; i < 40; i++) {
    body.push(ctx(["1", "2", "3"][i % 3]));
    body.push(ver("ver_solo"));
  }
  withDurable(body, (log) => {
    const r = assessNarrowR(log, cfgFull(["ver_solo"]));
    assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"]);
    if (r.verdict.kind === "CANNOT_ASSESS") {
      assert.ok(r.verdict.blindPaths[0].detail.includes("H(V)=0"));
    }
    assert.strictEqual(r.correlation?.structure?.distinctLeft, 1);
  });
});
check("CEILING: deterministic context->verification, margin injected -> CANNOT_ASSESS (not ALARM)", () => {
  withDurable(CEILING_L2, (log) => {
    const r = assessNarrowR(log, cfgFull(VERIFY));
    assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"]);
    if (r.verdict.kind === "CANNOT_ASSESS") {
      assert.ok(r.verdict.blindPaths[0].detail.includes("at the ceiling"));
      assert.ok(r.verdict.blindPaths[0].detail.includes("LOOKUP TABLE"));
    }
    assert.strictEqual(r.correlation?.ceilingCheck, "PERFORMED");
  });
});
check("CEILING margin ABSENT: same table reads SILENT but carries the not-performed note", () => {
  withDurable(CEILING_L2, (log) => {
    const r = assessNarrowR(log, cfgNoCeiling(VERIFY));
    assert.strictEqual(r.verdict.kind, "SILENT");
    assert.ok(r.verdict.summary.includes("LEG-2 CEILING CHECK DID NOT RUN"));
    assert.strictEqual(r.correlation?.ceilingCheck, "NOT_PERFORMED");
  });
});
check("ARITY: fewer than 2 context classes -> CANNOT_ASSESS (INELIGIBLE_SCOPE)", () => {
  const body: Spec[] = [ctx("1")];
  for (let i = 0; i < 36; i++) body.push(ver(VERIFY[i % 3]));
  withDurable(body, (log) => {
    const r = assessNarrowR(log, cfgFull(VERIFY));
    assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"]);
    assert.strictEqual(r.correlation?.structure?.distinctRight, 1);
  });
});
check("ARITY: no context class recurs -> CANNOT_ASSESS (INELIGIBLE_SCOPE)", () => {
  const body: Spec[] = [];
  for (let i = 0; i < 36; i++) {
    body.push(ctx(String(i)));
    body.push(ver(VERIFY[i % 3]));
  }
  withDurable(body, (log) => {
    const r = assessNarrowR(log, cfgFull(VERIFY));
    assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"]);
    assert.strictEqual(r.correlation?.structure?.hasRepeatedRight, false);
  });
});
check("INSUFFICIENT: fewer paired than the injected minimum -> CANNOT_ASSESS (INSUFFICIENT_SAMPLE)", () => {
  const body: Spec[] = [];
  for (let i = 0; i < 12; i++) {
    body.push(ctx(["1", "2", "3"][i % 3]));
    body.push(ver(VERIFY[i % 3]));
  }
  withDurable(body, (log) => {
    const r = assessNarrowR(log, cfgFull(VERIFY));
    assert.deepStrictEqual(blindClasses(r.verdict), ["INSUFFICIENT_SAMPLE"]);
    assert.strictEqual(r.correlation?.pairedCount, 12);
  });
});
check("MISSING CONFIG: no threshold/minimum -> CANNOT_ASSESS (MISSING_CONFIGURATION), leg 2 blind", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowR(log, cfgLeg1Only(VERIFY));
    assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
    assert.ok(blindClasses(r.verdict).every((c) => c === "MISSING_CONFIGURATION"));
    assert.strictEqual(r.correlation, null);
  });
});
check("ORPHANS: verifications before any context are counted, excluded, printed (report-only)", () => {
  const body: Spec[] = [ver("ver_hash"), ver("ver_sig"), ...HEALTHY_L2];
  withDurable(body, (log) => {
    const r = assessNarrowR(log, cfgFull(VERIFY));
    assert.strictEqual(r.verdict.kind, "SILENT");
    assert.strictEqual(r.correlation?.orphanCount, 2);
    assert.strictEqual(r.correlation?.pairedCount, 36);
    assert.strictEqual(r.correlation?.totalVerificationRecords, 38);
    assert.ok(r.verdict.summary.includes("orphan"));
  });
});

// ══ C · composition matrix ═══════════════════════════════════════════════════

console.log("\n══ C · composition matrix (ALARM > CANNOT_ASSESS > SILENT) ══");

check("(leg1 SILENT, leg2 SILENT) -> SILENT", () => {
  withDurable(HEALTHY_L2, (log) => {
    assert.strictEqual(assessNarrowR(log, cfgFull(VERIFY)).verdict.kind, "SILENT");
  });
});
check("(leg1 ALARM, leg2 SILENT) -> ALARM", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowR(log, cfgFull([...VERIFY, "ver_absent"]));
    assert.strictEqual(r.verdict.kind, "ALARM");
    assert.ok(findingCodes(r.verdict).includes("R_VERIFICATION_CLASS_ABSENT"));
  });
});
check("(leg1 SILENT, leg2 ALARM) -> ALARM", () => {
  withDurable(THEATRE_L2, (log) => {
    const r = assessNarrowR(log, cfgFull(VERIFY));
    assert.strictEqual(r.verdict.kind, "ALARM");
    assert.ok(findingCodes(r.verdict).includes("R_VERIFICATION_CONTEXT_COLLAPSE"));
  });
});
check("(leg1 ALARM, leg2 ALARM) -> ALARM, BOTH findings concatenated", () => {
  withDurable(THEATRE_L2, (log) => {
    const r = assessNarrowR(log, cfgFull([...VERIFY, "ver_absent"]));
    const codes = findingCodes(r.verdict);
    assert.ok(codes.includes("R_VERIFICATION_CLASS_ABSENT"));
    assert.ok(codes.includes("R_VERIFICATION_CONTEXT_COLLAPSE"));
  });
});
check("(leg1 SILENT, leg2 CANNOT_ASSESS) -> CANNOT_ASSESS", () => {
  withDurable(CEILING_L2, (log) => {
    const r = assessNarrowR(log, cfgFull(VERIFY));
    assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
    assert.strictEqual(r.correlation?.legVerdictKind, "CANNOT_ASSESS");
  });
});
check("NAMED CONSEQUENCE: (leg1 SILENT, leg-1-only config) -> CANNOT_ASSESS — blindness composes", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowR(log, cfgLeg1Only(VERIFY));
    assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
    assert.ok(blindClasses(r.verdict).includes("MISSING_CONFIGURATION"));
  });
});

// ══ E · end to end through guard() ═══════════════════════════════════════════

console.log("\n══ E · narrow-R flows through guard(), composing with Sig + Eng + narrow-W ══");

const NARROW_W_CFG = (profile: readonly string[]): NarrowWConfig => ({
  readableLoadStates: GATE,
  declaredProfile: profile,
  correlationThreshold: NARROW_W_LEG2_PROXY_CALIBRATION.correlationThreshold,
  correlationMinimumInquiryEvents:
    NARROW_W_LEG2_PROXY_CALIBRATION.correlationMinimumInquiryEvents,
  correlationCeilingMargin: NARROW_W_LEG2_PROXY_CALIBRATION.correlationCeilingMargin,
});

check("1 · both legs SILENT -> composite SILENT -> RELEASE", () => {
  withDurable(HEALTHY_L2, (log) => {
    const w = assessNarrowR(log, cfgFull(VERIFY)).verdict;
    assert.strictEqual(w.kind, "SILENT");
    const cp = new Chokepoint({ line: LINE, floorTrail: freshFloorTrail() });
    const r = cp.guard(A("r-release"), [w], { impactClass: "high" });
    assert.strictEqual(r.disposition, "RELEASE");
  });
});
check("2 · leg-2 THEATRE collapse -> ALARM -> HOLD", () => {
  withDurable(THEATRE_L2, (log) => {
    const w = assessNarrowR(log, cfgFull(VERIFY)).verdict;
    assert.strictEqual(w.kind, "ALARM");
    const cp = new Chokepoint({ line: LINE });
    const r = cp.guard(A("r-hold"), [w], { impactClass: "trivial" });
    assert.strictEqual(r.disposition, "HOLD");
    assert.strictEqual(r.execute, false);
  });
});
check("3 · profile absent -> CANNOT_ASSESS -> blind, never RELEASE", () => {
  withDurable(HEALTHY_L2, (log) => {
    const w = assessNarrowR(log, cfgFull(undefined)).verdict;
    const cp = new Chokepoint({
      line: LINE,
      ledger: new ChokepointLedger({ path: join(root, `l-${counter++}.jsonl`) }),
      floorTrail: freshFloorTrail(),
    });
    const hi = cp.guard(A("r-blind-hi"), [w], { impactClass: "critical" });
    assert.strictEqual(hi.disposition, "HOLD_BLIND");
    const lo = cp.guard(A("r-blind-lo"), [w], { impactClass: "trivial" });
    assert.strictEqual(lo.disposition, "PASS_BLIND");
  });
});
check("4 · non-compensatory: narrow-R ALARM floors real Sig + Eng + narrow-W all SILENT -> HOLD", () => {
  withDurable(SIG_CLEAN, (sigLog) =>
    withDurable(ENG_HEALTHY, (engLog) =>
      withDurable(HEALTHY_L2, (wLog) =>
        withDurable(THEATRE_L2, (rLog) => {
          const sig = assessSig(sigLog, SIG_CFG).verdict; // SILENT
          const eng = assessEng(engLog, ENG_CFG).verdict; // SILENT
          const w = assessNarrowW(wLog, NARROW_W_CFG(VERIFY)).verdict; // SILENT
          const rr = assessNarrowR(rLog, cfgFull(VERIFY)).verdict; // ALARM
          assert.strictEqual(sig.kind, "SILENT");
          assert.strictEqual(eng.kind, "SILENT");
          assert.strictEqual(w.kind, "SILENT");
          assert.strictEqual(rr.kind, "ALARM");
          const cp = new Chokepoint({ line: LINE });
          const d = cp.guard(A("r-noncomp"), [sig, eng, w, rr], { impactClass: "critical" });
          assert.strictEqual(d.decision.floorKind, "ALARM");
          assert.strictEqual(d.disposition, "HOLD");
          assert.strictEqual(d.execute, false);
        })
      )
    )
  );
});

// ══ X · cross-check — identical AMI vs narrow-W on a shared table (route ii) ══

console.log("\n══ X · narrow-R and narrow-W share ../stat/ami — identical AMI on one table ══");

check("narrow-R and narrow-W compute the IDENTICAL AMI on the same log + same profile", () => {
  withDurable(HEALTHY_L2, (log) => {
    const rAmi = assessNarrowR(log, cfgFull(VERIFY)).correlation?.structure?.ami;
    const wAmi = assessNarrowW(log, NARROW_W_CFG(VERIFY)).correlation?.structure?.ami;
    assert.ok(typeof rAmi === "number" && typeof wAmi === "number");
    assert.strictEqual(rAmi, wAmi); // same statistic, same pairing, byte-for-byte
  });
});

rmSync(root, { recursive: true, force: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
