// ──────────────────────────────────────────────────────────────────────────────
// MICA — narrow-K, TWO legs (book shape + constraint-activity signature), wired
// into the chokepoint.
//   npx ts-node src/mica/narrow-k/narrow-k.test.ts
//
// House style: standalone ts-node script, custom check() harness, no framework.
//
// Layers under test:
//   A · LEG 1 in composition — presence of declared constraint classes.
//   L2 · LEG 2 arms — theatre (ALARM), healthy (SILENT), ceiling (CANNOT_ASSESS),
//       flattening / single-context / no-repeated-context (INELIGIBLE_SCOPE),
//       insufficient sample, orphan counting, missing configuration.
//   D · D-29 CEILING — the ceiling text is present in the SILENT summary.
//   C · COMPOSITION MATRIX — worst-of over the two legs.
//   E · end to end through guard() — narrow-K composes with real Sig + Eng +
//       narrow-W + narrow-R through the non-compensatory floor.
//   X · CROSS-CHECK (route ii) — narrow-K and narrow-R produce the IDENTICAL AMI
//       on one shared table (they share only ../stat/ami).
//
// Fixtures were calibrated against the real reader; the pre-pilot PROXY
// calibration (NARROW_K_PROXY_CALIBRATION — threshold 0.05, min 30, margin 0.02)
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
import { assessNarrowR } from "../narrow-r";
import type { PreconditionMap, SigConfig } from "../sig";
import type { EngConfig } from "../eng";
import type { NarrowWConfig } from "../narrow-w";
import { NARROW_W_LEG2_PROXY_CALIBRATION } from "../narrow-w";
import type { NarrowRConfig } from "../narrow-r";
import { NARROW_R_PROXY_CALIBRATION } from "../narrow-r";
import type {
  AlarmVerdict,
  CannotAssessVerdict,
  SensorVerdict,
} from "../types";
import {
  assessNarrowK,
  NARROW_K_SENSOR_ID,
  NARROW_K_PROXY_CALIBRATION,
} from "./index";
import { tupleKey, contextTupleKey } from "../tuple-key";
import type { NarrowKConfig } from "./index";
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

const root = mkdtempSync(join(tmpdir(), "mica-narrowK-"));
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

// ── The constraint / context alphabet ─────────────────────────────────────────
//
// CONSTRAINT classes are the declared profile (eventType in the profile, moduleId
// m6). CONTEXT classes are everything else (eventType ctx_*, moduleId cx) —
// option A: context is the profile's complement, no second declared list.
const CONS: readonly string[] = ["con_refuse", "con_limit", "con_boundary"];
const ctx = (k: string): Spec => ({ eventType: `ctx_${k}`, outcome: "o", moduleId: "cx" });
const con = (c: string): Spec => ({ eventType: c, outcome: "o" });

// Diagonal-dominant constraint↔context table. diag(8,2) lands AMI≈0.164
// (SILENT); diag(15,0) is perfectly deterministic, AMI=1 (ceiling → CA).
function diag(nDiag: number, nOff: number): Spec[] {
  const specs: Spec[] = [];
  const C = ["1", "2", "3"];
  for (let k = 0; k < 3; k++) {
    for (let d = 0; d < nDiag; d++) {
      specs.push(ctx(C[k]));
      specs.push(con(CONS[k]));
    }
    for (let o = 0; o < nOff; o++) {
      specs.push(ctx(C[k]));
      specs.push(con(CONS[(k + 1) % 3]));
      specs.push(ctx(C[k]));
      specs.push(con(CONS[(k + 2) % 3]));
    }
  }
  return specs;
}
// Uniform constraint emission regardless of context → AMI ≈ 0 → ALARM. Theatre.
function theatreUniform(): Spec[] {
  const specs: Spec[] = [];
  for (const cc of ["1", "2", "3"]) {
    for (let rep = 0; rep < 6; rep++) {
      for (const c of CONS) {
        specs.push(ctx(cc));
        specs.push(con(c));
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
const KP = NARROW_K_PROXY_CALIBRATION; // PRE-PILOT PROXY, subject to calibration
const cfgFull = (declaredProfile?: readonly string[]): NarrowKConfig => ({
  readableLoadStates: GATE,
  declaredProfile,
  correlationThreshold: KP.correlationThreshold,
  correlationMinimumConstraintEvents: KP.correlationMinimumConstraintEvents,
  correlationCeilingMargin: KP.correlationCeilingMargin,
  correlationPermutationSamples: KP.correlationPermutationSamples,
  correlationPermutationSeed: KP.correlationPermutationSeed,
});
const cfgNoCeiling = (declaredProfile?: readonly string[]): NarrowKConfig => ({
  readableLoadStates: GATE,
  declaredProfile,
  correlationThreshold: KP.correlationThreshold,
  correlationMinimumConstraintEvents: KP.correlationMinimumConstraintEvents,
});
const cfgLeg1Only = (declaredProfile?: readonly string[]): NarrowKConfig => ({
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

console.log("\nMICA — narrow-K: book shape + constraint-activity signature\n");

// ══ A · leg 1 in composition ═════════════════════════════════════════════════

console.log("\n══ A · leg 1 (book shape), composed with a healthy leg 2 ══");

check("all declared classes present + healthy leg 2 -> SILENT, correspondence limit stated", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowK(log, cfgFull(CONS));
    assert.strictEqual(r.verdict.kind, "SILENT");
    assert.strictEqual(r.verdict.sensorId, NARROW_K_SENSOR_ID);
    assert.ok(r.verdict.summary.includes("CORRESPONDENCE TO THE NAMED PROFILE ONLY"));
    assert.ok(r.verdict.summary.includes("SILENT against a faker"));
    assert.ok(r.presence.every((p) => p.present));
    assert.strictEqual(r.correlation?.legVerdictKind, "SILENT");
  });
});
check("a declared class absent -> ALARM (K_CONSTRAINT_CLASS_ABSENT)", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowK(log, cfgFull([...CONS, "con_absent"]));
    assert.strictEqual(r.verdict.kind, "ALARM");
    assert.ok(findingCodes(r.verdict).includes("K_CONSTRAINT_CLASS_ABSENT"));
    if (r.verdict.kind === "ALARM") {
      assert.ok(r.verdict.findings.some((f) => f.detail.includes("con_absent")));
    }
    assert.deepStrictEqual(
      r.presence.filter((p) => !p.present).map((p) => p.constraintClass),
      ["con_absent"]
    );
  });
});
check("NO profile injected -> CANNOT_ASSESS (MISSING_CONFIGURATION) BEFORE any leg runs", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowK(log, cfgFull(undefined));
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
  const r = assessNarrowK(inMem, cfgFull(CONS));
  assert.deepStrictEqual(blindClasses(r.verdict), ["NON_CLEAN_LOAD_STATE"]);
  assert.strictEqual(r.correlation, null);
});

// ══ L2 · the leg-2 arms ══════════════════════════════════════════════════════

console.log("\n══ L2 · the constraint-activity signature arms ══");

check("THEATRE: constraint emitted uniformly -> ALARM (K_CONSTRAINT_CONTEXT_COLLAPSE)", () => {
  withDurable(THEATRE_L2, (log) => {
    const r = assessNarrowK(log, cfgFull(CONS));
    assert.strictEqual(r.verdict.kind, "ALARM");
    assert.ok(findingCodes(r.verdict).includes("K_CONSTRAINT_CONTEXT_COLLAPSE"));
    assert.ok((r.correlation?.structure?.ami as number) < KP.correlationThreshold);
  });
});
check("HEALTHY: constraint structured on context -> SILENT, lookup defeat printed", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowK(log, cfgFull(CONS));
    assert.strictEqual(r.verdict.kind, "SILENT");
    assert.ok(r.verdict.summary.includes("LOOKUP TABLE"));
    assert.ok((r.correlation?.structure?.ami as number) >= KP.correlationThreshold);
  });
});
check("FLATTENING: single-constraint-class profile -> CANNOT_ASSESS (INELIGIBLE_SCOPE, H(C)=0)", () => {
  const body: Spec[] = [];
  for (let i = 0; i < 40; i++) {
    body.push(ctx(["1", "2", "3"][i % 3]));
    body.push(con("con_solo"));
  }
  withDurable(body, (log) => {
    const r = assessNarrowK(log, cfgFull(["con_solo"]));
    assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"]);
    if (r.verdict.kind === "CANNOT_ASSESS") {
      assert.ok(r.verdict.blindPaths[0].detail.includes("H(C)=0"));
    }
    assert.strictEqual(r.correlation?.structure?.distinctLeft, 1);
  });
});
check("CEILING: deterministic context->constraint, margin injected -> CANNOT_ASSESS (not ALARM)", () => {
  withDurable(CEILING_L2, (log) => {
    const r = assessNarrowK(log, cfgFull(CONS));
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
    const r = assessNarrowK(log, cfgNoCeiling(CONS));
    assert.strictEqual(r.verdict.kind, "SILENT");
    assert.ok(r.verdict.summary.includes("AMI CEILING CHECK DID NOT RUN"));
    assert.strictEqual(r.correlation?.ceilingCheck, "NOT_PERFORMED");
  });
});
check("ARITY: fewer than 2 context classes -> CANNOT_ASSESS (INELIGIBLE_SCOPE)", () => {
  const body: Spec[] = [ctx("1")];
  for (let i = 0; i < 36; i++) body.push(con(CONS[i % 3]));
  withDurable(body, (log) => {
    const r = assessNarrowK(log, cfgFull(CONS));
    assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"]);
    assert.strictEqual(r.correlation?.structure?.distinctRight, 1);
  });
});
check("ARITY: no context class recurs -> CANNOT_ASSESS (INELIGIBLE_SCOPE)", () => {
  const body: Spec[] = [];
  for (let i = 0; i < 36; i++) {
    body.push(ctx(String(i)));
    body.push(con(CONS[i % 3]));
  }
  withDurable(body, (log) => {
    const r = assessNarrowK(log, cfgFull(CONS));
    assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"]);
    assert.strictEqual(r.correlation?.structure?.hasRepeatedRight, false);
  });
});
check("INSUFFICIENT: fewer paired than the injected minimum -> CANNOT_ASSESS (INSUFFICIENT_SAMPLE)", () => {
  const body: Spec[] = [];
  for (let i = 0; i < 12; i++) {
    body.push(ctx(["1", "2", "3"][i % 3]));
    body.push(con(CONS[i % 3]));
  }
  withDurable(body, (log) => {
    const r = assessNarrowK(log, cfgFull(CONS));
    assert.deepStrictEqual(blindClasses(r.verdict), ["INSUFFICIENT_SAMPLE"]);
    assert.strictEqual(r.correlation?.pairedCount, 12);
  });
});
check("MISSING CONFIG: no threshold/minimum -> CANNOT_ASSESS (MISSING_CONFIGURATION), leg 2 blind", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowK(log, cfgLeg1Only(CONS));
    assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
    assert.ok(blindClasses(r.verdict).every((c) => c === "MISSING_CONFIGURATION"));
    assert.strictEqual(r.correlation, null);
  });
});
check("ORPHANS: constraints before any context are counted, excluded, printed (report-only)", () => {
  const body: Spec[] = [con("con_refuse"), con("con_limit"), ...HEALTHY_L2];
  withDurable(body, (log) => {
    const r = assessNarrowK(log, cfgFull(CONS));
    assert.strictEqual(r.verdict.kind, "SILENT");
    assert.strictEqual(r.correlation?.orphanCount, 2);
    assert.strictEqual(r.correlation?.pairedCount, 36);
    assert.strictEqual(r.correlation?.totalConstraintRecords, 38);
    assert.ok(r.verdict.summary.includes("orphan"));
  });
});

// ══ D · the D-29 ceiling text, present in the SILENT summary ══════════════════

console.log("\n══ D · the D-29 ceiling — printed on every SILENT ══");

check("SILENT carries the D-29 ceiling: 'the writing IS the watching' + doctor's question", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowK(log, cfgFull(CONS));
    assert.strictEqual(r.verdict.kind, "SILENT");
    assert.ok(r.verdict.summary.includes("THE WRITING IS THE WATCHING"));
    assert.ok(r.verdict.summary.includes("WORTH LESS"));
    assert.ok(r.verdict.summary.includes("DOCTOR"));
  });
});

// ══ C · composition matrix ═══════════════════════════════════════════════════

console.log("\n══ C · composition matrix (ALARM > CANNOT_ASSESS > SILENT) ══");

check("(leg1 SILENT, leg2 SILENT) -> SILENT", () => {
  withDurable(HEALTHY_L2, (log) => {
    assert.strictEqual(assessNarrowK(log, cfgFull(CONS)).verdict.kind, "SILENT");
  });
});
check("(leg1 ALARM, leg2 SILENT) -> ALARM", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowK(log, cfgFull([...CONS, "con_absent"]));
    assert.strictEqual(r.verdict.kind, "ALARM");
    assert.ok(findingCodes(r.verdict).includes("K_CONSTRAINT_CLASS_ABSENT"));
  });
});
check("(leg1 SILENT, leg2 ALARM) -> ALARM", () => {
  withDurable(THEATRE_L2, (log) => {
    const r = assessNarrowK(log, cfgFull(CONS));
    assert.strictEqual(r.verdict.kind, "ALARM");
    assert.ok(findingCodes(r.verdict).includes("K_CONSTRAINT_CONTEXT_COLLAPSE"));
  });
});
check("(leg1 ALARM, leg2 ALARM) -> ALARM, BOTH findings concatenated", () => {
  withDurable(THEATRE_L2, (log) => {
    const r = assessNarrowK(log, cfgFull([...CONS, "con_absent"]));
    const codes = findingCodes(r.verdict);
    assert.ok(codes.includes("K_CONSTRAINT_CLASS_ABSENT"));
    assert.ok(codes.includes("K_CONSTRAINT_CONTEXT_COLLAPSE"));
  });
});
check("(leg1 SILENT, leg2 CANNOT_ASSESS) -> CANNOT_ASSESS", () => {
  withDurable(CEILING_L2, (log) => {
    const r = assessNarrowK(log, cfgFull(CONS));
    assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
    assert.strictEqual(r.correlation?.legVerdictKind, "CANNOT_ASSESS");
  });
});
check("NAMED CONSEQUENCE: (leg1 SILENT, leg-1-only config) -> CANNOT_ASSESS — blindness composes", () => {
  withDurable(HEALTHY_L2, (log) => {
    const r = assessNarrowK(log, cfgLeg1Only(CONS));
    assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
    assert.ok(blindClasses(r.verdict).includes("MISSING_CONFIGURATION"));
  });
});

// ══ E · end to end through guard() ═══════════════════════════════════════════

console.log("\n══ E · narrow-K flows through guard(), composing with Sig + Eng + narrow-W + narrow-R ══");

const NARROW_W_CFG = (profile: readonly string[]): NarrowWConfig => ({
  readableLoadStates: GATE,
  declaredProfile: profile,
  correlationThreshold: NARROW_W_LEG2_PROXY_CALIBRATION.correlationThreshold,
  correlationMinimumInquiryEvents:
    NARROW_W_LEG2_PROXY_CALIBRATION.correlationMinimumInquiryEvents,
  correlationCeilingMargin: NARROW_W_LEG2_PROXY_CALIBRATION.correlationCeilingMargin,
});
const NARROW_R_CFG = (profile: readonly string[]): NarrowRConfig => ({
  readableLoadStates: GATE,
  declaredProfile: profile,
  correlationThreshold: NARROW_R_PROXY_CALIBRATION.correlationThreshold,
  correlationMinimumVerificationEvents:
    NARROW_R_PROXY_CALIBRATION.correlationMinimumVerificationEvents,
  correlationCeilingMargin: NARROW_R_PROXY_CALIBRATION.correlationCeilingMargin,
});

check("1 · both legs SILENT -> composite SILENT -> RELEASE", () => {
  withDurable(HEALTHY_L2, (log) => {
    const k = assessNarrowK(log, cfgFull(CONS)).verdict;
    assert.strictEqual(k.kind, "SILENT");
    const cp = new Chokepoint({ line: LINE, floorTrail: freshFloorTrail() });
    const r = cp.guard(A("k-release"), [k], { impactClass: "high" });
    assert.strictEqual(r.disposition, "RELEASE");
  });
});
check("2 · leg-2 THEATRE collapse -> ALARM -> HOLD", () => {
  withDurable(THEATRE_L2, (log) => {
    const k = assessNarrowK(log, cfgFull(CONS)).verdict;
    assert.strictEqual(k.kind, "ALARM");
    const cp = new Chokepoint({ line: LINE });
    const r = cp.guard(A("k-hold"), [k], { impactClass: "trivial" });
    assert.strictEqual(r.disposition, "HOLD");
    assert.strictEqual(r.execute, false);
  });
});
check("3 · profile absent -> CANNOT_ASSESS -> blind, never RELEASE", () => {
  withDurable(HEALTHY_L2, (log) => {
    const k = assessNarrowK(log, cfgFull(undefined)).verdict;
    const cp = new Chokepoint({
      line: LINE,
      ledger: new ChokepointLedger({ path: join(root, `l-${counter++}.jsonl`) }),
      floorTrail: freshFloorTrail(),
    });
    const hi = cp.guard(A("k-blind-hi"), [k], { impactClass: "critical" });
    assert.strictEqual(hi.disposition, "HOLD_BLIND");
    const lo = cp.guard(A("k-blind-lo"), [k], { impactClass: "trivial" });
    assert.strictEqual(lo.disposition, "PASS_BLIND");
  });
});
check("4 · non-compensatory: narrow-K ALARM floors real Sig + Eng + narrow-W + narrow-R all SILENT -> HOLD", () => {
  withDurable(SIG_CLEAN, (sigLog) =>
    withDurable(ENG_HEALTHY, (engLog) =>
      withDurable(HEALTHY_L2, (wLog) =>
        withDurable(HEALTHY_L2, (rLog) =>
          withDurable(THEATRE_L2, (kLog) => {
            const sig = assessSig(sigLog, SIG_CFG).verdict; // SILENT
            const eng = assessEng(engLog, ENG_CFG).verdict; // SILENT
            const w = assessNarrowW(wLog, NARROW_W_CFG(CONS)).verdict; // SILENT
            const rr = assessNarrowR(rLog, NARROW_R_CFG(CONS)).verdict; // SILENT
            const kk = assessNarrowK(kLog, cfgFull(CONS)).verdict; // ALARM
            assert.strictEqual(sig.kind, "SILENT");
            assert.strictEqual(eng.kind, "SILENT");
            assert.strictEqual(w.kind, "SILENT");
            assert.strictEqual(rr.kind, "SILENT");
            assert.strictEqual(kk.kind, "ALARM");
            const cp = new Chokepoint({ line: LINE });
            const d = cp.guard(A("k-noncomp"), [sig, eng, w, rr, kk], { impactClass: "critical" });
            assert.strictEqual(d.decision.floorKind, "ALARM");
            assert.strictEqual(d.disposition, "HOLD");
            assert.strictEqual(d.execute, false);
          })
        )
      )
    )
  );
});

// ══ X · cross-check — identical AMI vs narrow-R on a shared table (route ii) ══

console.log("\n══ X · narrow-K and narrow-R share ../stat/ami — identical AMI on one table ══");

check("narrow-K and narrow-R compute the IDENTICAL AMI on the same log + same profile", () => {
  withDurable(HEALTHY_L2, (log) => {
    const kAmi = assessNarrowK(log, cfgFull(CONS)).correlation?.structure?.ami;
    const rAmi = assessNarrowR(log, NARROW_R_CFG(CONS)).correlation?.structure?.ami;
    assert.ok(typeof kAmi === "number" && typeof rAmi === "number");
    assert.strictEqual(kAmi, rAmi); // same statistic, same pairing, byte-for-byte
  });
});

// ══ F4 · the shared collision-proof tuple key ════════════════════════════════
//
// narrow-K used to join (moduleId, eventType) with the LITERAL string "0000",
// which collapsed distinct tuples like ("a0000b","c") and ("a","b0000c") onto one
// context class — silently changing class counts, AMI, and the verdict. All three
// siblings now share one length-prefixed, collision-proof key (tuple-key.ts).

console.log("\n══ F4 · shared collision-proof tuple key (length-prefixed) ══");

check("F4 · the tuple key is collision-proof at adversarial component boundaries", () => {
  // A bare concatenation collapses these; length-prefixing keeps them distinct.
  assert.notStrictEqual(tupleKey(["a", "bc"]), tupleKey(["ab", "c"]));
  assert.notStrictEqual(tupleKey(["a", "b"]), tupleKey(["ab", ""]));
  // The EXACT shape the old narrow-K "0000" join collapsed:
  assert.notStrictEqual(
    contextTupleKey({ moduleId: "a0000b", eventType: "c", timestamp: 0, sequenceNumber: 0, outcome: "o" }),
    contextTupleKey({ moduleId: "a", eventType: "b0000c", timestamp: 0, sequenceNumber: 0, outcome: "o" })
  );
  // Equal tuples still share a key — grouping is preserved.
  assert.strictEqual(tupleKey(["m6", "con_refuse"]), tupleKey(["m6", "con_refuse"]));
});

// Sibling partition parity on ADVERSARIAL inputs: a table whose context tuples
// collide under the old "0000" join. Under the bug, narrow-K would merge two
// context classes and its AMI would drift from narrow-R's. With the shared key it
// partitions identically — same AMI, byte-for-byte.
const ctxAdv = (t: { moduleId: string; eventType: string }): Spec => ({
  eventType: t.eventType,
  outcome: "o",
  moduleId: t.moduleId,
});
const CTX_ADV = [
  { moduleId: "a0000b", eventType: "c" }, // collides with CTX_ADV[1] under "0000"
  { moduleId: "a", eventType: "b0000c" }, // collides with CTX_ADV[0] under "0000"
  { moduleId: "cx", eventType: "ctx_3" },
];
function diagAdv(nDiag: number, nOff: number): Spec[] {
  const specs: Spec[] = [];
  for (let k = 0; k < 3; k++) {
    for (let d = 0; d < nDiag; d++) {
      specs.push(ctxAdv(CTX_ADV[k]));
      specs.push(con(CONS[k]));
    }
    for (let o = 0; o < nOff; o++) {
      specs.push(ctxAdv(CTX_ADV[k]));
      specs.push(con(CONS[(k + 1) % 3]));
      specs.push(ctxAdv(CTX_ADV[k]));
      specs.push(con(CONS[(k + 2) % 3]));
    }
  }
  return specs;
}

check("F4 · adversarial colliding context tuples — narrow-K partitions them like narrow-R (identical AMI)", () => {
  withDurable(diagAdv(8, 2), (log) => {
    const kAmi = assessNarrowK(log, cfgFull(CONS)).correlation?.structure?.ami;
    const rAmi = assessNarrowR(log, NARROW_R_CFG(CONS)).correlation?.structure?.ami;
    assert.ok(typeof kAmi === "number" && typeof rAmi === "number", "both AMIs computed");
    // Under the old "0000" join K would have merged CTX_ADV[0] and CTX_ADV[1] and
    // this equality would fail. The three context classes stay distinct now.
    assert.strictEqual(kAmi, rAmi);
    assert.ok(kAmi > 0, "the diagonal signal is real — the classes were not degenerately merged");
  });
});

rmSync(root, { recursive: true, force: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
