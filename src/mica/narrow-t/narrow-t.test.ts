// ──────────────────────────────────────────────────────────────────────────────
// MICA — narrow-T, ONE leg (within-record dispositional-drift signature), wired
// into the chokepoint.
//   npx ts-node src/mica/narrow-t/narrow-t.test.ts
//
// House style: standalone ts-node script, custom check() harness, no framework.
//
// Layers under test:
//   A · THE ARMS — stable (SILENT), drifted (ALARM), ceiling (CANNOT_ASSESS),
//       ceiling-no-margin (ALARM + not-performed note), single-class /
//       each-class-once / empty-window (INELIGIBLE_SCOPE), short-record-under-
//       injected-window (INSUFFICIENT_SAMPLE), missing config (blindness).
//   P · POLARITY PROOF — the whole build: STRUCTURE IS THE ALARM. A stable log
//       (low AMI) reads SILENT; a drifted log (high AMI) reads ALARM. Both
//       directions, and the inversion asserted against the raw AMI.
//   W · THE WINDOW CUT — structural halves by default; an injected
//       temporalWindowSize takes a fixed window from each end and EXCLUDES the
//       middle (counted, printed).
//   C · THE CEILING TEXT — the three-part F-γ2 + T1 ceiling is present on every
//       verdict; the words identity / same-system appear only there.
//   E · end to end through guard() — narrow-T ALARM floors REAL Sig + Eng +
//       narrow-W + narrow-R + narrow-K all SILENT through the non-compensatory
//       floor (the five SILENT siblings).
//   G · THE CLASS-SET GUARD (ticket T1) — disjoint vocabularies, and dependence
//       carried only by window-exclusive classes, read CANNOT_ASSESS (a phase
//       change) at any class count; drift among shared classes still ALARMS.
//   X · CROSS-CHECK (route ii) — narrow-T's AMI is EXACTLY the shared ../stat/ami
//       statistic over its own (window, class) table.
//
// Fixtures were calibrated against the real reader; the pre-pilot PROXY
// calibration (NARROW_T_PROXY_CALIBRATION — tolerance 0.30, min 30, margin 0.02)
// is injected wherever the read is exercised, and is SUBJECT TO CALIBRATION.
// ──────────────────────────────────────────────────────────────────────────────

import assert from "assert";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { MicaFixtureLog } from "../fixture-log";
import { assessSig } from "../sig";
import { assessEng } from "../eng";
import { assessNarrowW, NARROW_W_LEG2_PROXY_CALIBRATION } from "../narrow-w";
import { assessNarrowR, NARROW_R_PROXY_CALIBRATION } from "../narrow-r";
import { assessNarrowK, NARROW_K_PROXY_CALIBRATION } from "../narrow-k";
import type { PreconditionMap, SigConfig } from "../sig";
import type { EngConfig } from "../eng";
import type { NarrowWConfig } from "../narrow-w";
import type { NarrowRConfig } from "../narrow-r";
import type { NarrowKConfig } from "../narrow-k";
import type {
  AlarmVerdict,
  CannotAssessVerdict,
  SensorVerdict,
} from "../types";
import { pairedStructure } from "../stat/ami";
import { contextTupleKey } from "../tuple-key";
import {
  assessNarrowT,
  NARROW_T_SENSOR_ID,
  NARROW_T_PROXY_CALIBRATION,
} from "./index";
import type { NarrowTConfig } from "./index";
import { Chokepoint, FloorTrail } from "../chokepoint";
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

const root = mkdtempSync(join(tmpdir(), "mica-narrowT-"));
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

// ── The event-class alphabet ──────────────────────────────────────────────────
//
// Four event classes C = (moduleId, eventType). The DRIFT is engineered as a
// change in WHICH classes dominate the EARLY vs the LATE window.
const CLASSES: readonly (readonly [string, string])[] = [
  ["m3", "e_a"],
  ["m5", "e_b"],
  ["m7", "e_c"],
  ["m9", "e_d"],
];
const ev = (c: readonly [string, string]): Spec => ({
  moduleId: c[0],
  eventType: c[1],
  outcome: "o",
});

// STABLE: both halves cycle all four classes equally → AMI ≈ 0 → SILENT.
function stable(nPerHalf: number): Spec[] {
  const s: Spec[] = [];
  for (const _half of [0, 1]) {
    for (let i = 0; i < nPerHalf; i++) s.push(ev(CLASSES[i % CLASSES.length]));
  }
  return s;
}
// DRIFTED (ticket T1): ONE shared vocabulary, the weight moved. Both windows
// speak all four classes; EARLY is {A,B}-heavy (19/19/1/1 per 40), LATE is
// {C,D}-heavy (1/1/19/19) → AMI ≈ 0.348 → ALARM. Drift AMONG classes both windows
// speak is what the class-set guard must leave armed.
function drifted(nPerHalf: number): Spec[] {
  const s: Spec[] = [];
  const pairs = nPerHalf / 2;
  for (let p = 0; p < pairs; p++) s.push(...(p < pairs - 1 ? [ev(CLASSES[0]), ev(CLASSES[1])] : [ev(CLASSES[2]), ev(CLASSES[3])]));
  for (let p = 0; p < pairs; p++) s.push(...(p < pairs - 1 ? [ev(CLASSES[2]), ev(CLASSES[3])] : [ev(CLASSES[0]), ev(CLASSES[1])]));
  return s;
}
// TURNOVER (the pre-T1 DRIFTED): EARLY draws {A,B} only, LATE {C,D} only — the
// vocabularies are DISJOINT. AMI ≈ 0.49, below the ceiling only because there are
// four classes. Before T1 this read ALARM (the defect); now CANNOT_ASSESS.
function turnover(nPerHalf: number): Spec[] {
  const s: Spec[] = [];
  for (let i = 0; i < nPerHalf; i++) s.push(ev(CLASSES[i % 2]));
  for (let i = 0; i < nPerHalf; i++) s.push(ev(CLASSES[2 + (i % 2)]));
  return s;
}
// CEILING: EARLY all class A, LATE all class B → WINDOW fully determines C →
// AMI = 1 → at the ceiling (evidence-free), CANNOT_ASSESS when a margin is set.
function ceiling(nPerHalf: number): Spec[] {
  const s: Spec[] = [];
  for (let i = 0; i < nPerHalf; i++) s.push(ev(CLASSES[0]));
  for (let i = 0; i < nPerHalf; i++) s.push(ev(CLASSES[1]));
  return s;
}
const STABLE = stable(40);
const DRIFTED = drifted(40);
const TURNOVER = turnover(40);
const CEILING = ceiling(40);
const SINGLE_CLASS: Spec[] = (() => {
  const s: Spec[] = [];
  for (let i = 0; i < 80; i++) s.push(ev(CLASSES[0]));
  return s;
})();
const EACH_ONCE: Spec[] = (() => {
  const s: Spec[] = [];
  for (let i = 0; i < 80; i++) s.push({ moduleId: `m${i}`, eventType: `e${i}`, outcome: "o" });
  return s;
})();
const WINDOW_STABLE = stable(60); // n=120; with temporalWindowSize 30 → 30+30, middle 60

// ── Config helpers ────────────────────────────────────────────────────────────
const TP = NARROW_T_PROXY_CALIBRATION; // PRE-PILOT PROXY, subject to calibration
const cfgFull = (o: Partial<NarrowTConfig> = {}): NarrowTConfig => ({
  readableLoadStates: GATE,
  driftTolerance: TP.driftTolerance,
  minimumEventsPerWindow: TP.minimumEventsPerWindow,
  driftCeilingMargin: TP.driftCeilingMargin,
  driftPermutationSamples: TP.driftPermutationSamples,
  driftPermutationSeed: TP.driftPermutationSeed,
  ...o,
});
const cfgNoCeiling = (o: Partial<NarrowTConfig> = {}): NarrowTConfig => ({
  readableLoadStates: GATE,
  driftTolerance: TP.driftTolerance,
  minimumEventsPerWindow: TP.minimumEventsPerWindow,
  ...o,
});
const cfgNoConfig: NarrowTConfig = { readableLoadStates: GATE };

function blindClasses(v: SensorVerdict): string[] {
  assert.strictEqual(v.kind, "CANNOT_ASSESS", `expected CANNOT_ASSESS, got ${v.kind}`);
  return (v as CannotAssessVerdict).blindPaths.map((b) => b.class);
}
function findingCodes(v: SensorVerdict): string[] {
  assert.strictEqual(v.kind, "ALARM", `expected ALARM, got ${v.kind}`);
  return (v as AlarmVerdict).findings.map((f) => f.code);
}

console.log("\nMICA — narrow-T: within-record dispositional-drift signature\n");

// ══ A · the arms ═════════════════════════════════════════════════════════════

console.log("\n══ A · the single-leg arms ══");

check("STABLE: same class mix across the arc -> SILENT (low AMI)", () => {
  withDurable(STABLE, (log) => {
    const r = assessNarrowT(log, cfgFull());
    assert.strictEqual(r.verdict.kind, "SILENT");
    assert.strictEqual(r.verdict.sensorId, NARROW_T_SENSOR_ID);
    assert.ok((r.structure?.ami as number) <= TP.driftTolerance);
    assert.strictEqual(r.windowing?.method, "STRUCTURAL_HALVES");
  });
});
check("DRIFTED: class mix moves across the arc -> ALARM (T_DISPOSITIONAL_DRIFT)", () => {
  withDurable(DRIFTED, (log) => {
    const r = assessNarrowT(log, cfgFull());
    assert.strictEqual(r.verdict.kind, "ALARM");
    assert.ok(findingCodes(r.verdict).includes("T_DISPOSITIONAL_DRIFT"));
    assert.ok((r.structure?.ami as number) > TP.driftTolerance);
  });
});
check("CEILING: WINDOW fully determines class, margin injected -> CANNOT_ASSESS (not ALARM)", () => {
  withDurable(CEILING, (log) => {
    const r = assessNarrowT(log, cfgFull());
    assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"]);
    if (r.verdict.kind === "CANNOT_ASSESS") {
      assert.ok(r.verdict.blindPaths[0].detail.includes("at the ceiling"));
      assert.ok(r.verdict.blindPaths[0].detail.includes("BENIGN TOTAL PHASE SEPARATION"));
    }
    assert.strictEqual(r.ceilingCheck, "PERFORMED");
  });
});
check("CEILING margin ABSENT: the SAME maximal-drift table reads ALARM + carries the not-performed note", () => {
  withDurable(CEILING, (log) => {
    const r = assessNarrowT(log, cfgNoCeiling());
    // Inverted polarity: with no ceiling to catch the evidence-free corner, a
    // maximal AMI is simply the loudest drift -> ALARM (never a quiet pass).
    assert.strictEqual(r.verdict.kind, "ALARM");
    assert.ok(findingCodes(r.verdict).includes("T_DISPOSITIONAL_DRIFT"));
    if (r.verdict.kind === "ALARM") {
      assert.ok(r.verdict.findings[0].detail.includes("AMI CEILING CHECK DID NOT RUN"));
    }
    assert.strictEqual(r.ceilingCheck, "NOT_PERFORMED");
  });
});
check("SINGLE CLASS across the arc -> CANNOT_ASSESS (INELIGIBLE_SCOPE)", () => {
  withDurable(SINGLE_CLASS, (log) => {
    const r = assessNarrowT(log, cfgFull());
    assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"]);
    assert.strictEqual(r.structure?.distinctRight, 1);
  });
});
check("EVERY CLASS ONCE -> CANNOT_ASSESS (INELIGIBLE_SCOPE, no class recurs)", () => {
  withDurable(EACH_ONCE, (log) => {
    const r = assessNarrowT(log, cfgFull());
    assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"]);
    assert.strictEqual(r.structure?.hasRepeatedRight, false);
  });
});
check("MISSING CONFIG: no tolerance/minimum -> CANNOT_ASSESS (MISSING_CONFIGURATION), the one leg blind", () => {
  withDurable(STABLE, (log) => {
    const r = assessNarrowT(log, cfgNoConfig);
    assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
    assert.ok(blindClasses(r.verdict).every((c) => c === "MISSING_CONFIGURATION"));
    assert.strictEqual(r.windowing, null);
    assert.strictEqual(r.structure, null);
  });
});
check("an unreadable load state -> CANNOT_ASSESS (the D8 gate fires first)", () => {
  const inMem = new MicaFixtureLog(); // IN_MEMORY, not in GATE
  appendAll(inMem, STABLE);
  const r = assessNarrowT(inMem, cfgFull());
  assert.deepStrictEqual(blindClasses(r.verdict), ["NON_CLEAN_LOAD_STATE"]);
  assert.strictEqual(r.windowing, null);
});

// ══ P · polarity proof — STRUCTURE IS THE ALARM, both directions ═════════════

console.log("\n══ P · polarity proof (INVERTED vs the siblings) ══");

check("polarity: low AMI (stable) is SILENT, high AMI (drift) is ALARM — asserted against the raw statistic", () => {
  const stableAmi = withDurable(STABLE, (log) => {
    const r = assessNarrowT(log, cfgFull());
    assert.strictEqual(r.verdict.kind, "SILENT", "stable must be SILENT");
    return r.structure?.ami as number;
  });
  const driftAmi = withDurable(DRIFTED, (log) => {
    const r = assessNarrowT(log, cfgFull());
    assert.strictEqual(r.verdict.kind, "ALARM", "drift must be ALARM");
    return r.structure?.ami as number;
  });
  // The ALARM has the HIGHER structure. If this instrument were wired like its
  // siblings (low = alarm), these two verdicts would be swapped.
  assert.ok(driftAmi > stableAmi, "drift AMI must exceed stable AMI");
  assert.ok(stableAmi <= TP.driftTolerance && driftAmi > TP.driftTolerance);
});
check("polarity: the SILENT summary states structure is the alarm and flatness is health", () => {
  withDurable(STABLE, (log) => {
    const r = assessNarrowT(log, cfgFull());
    assert.strictEqual(r.verdict.kind, "SILENT");
    assert.ok(r.verdict.summary.includes("POLARITY IS INVERTED"));
    assert.ok(r.verdict.summary.includes("STRUCTURE IS THE ALARM"));
    assert.ok(r.verdict.summary.includes("Stable signature"));
  });
});

// ══ W · the window cut ═══════════════════════════════════════════════════════

console.log("\n══ W · the window cut (halves default; injected window excludes the middle) ══");

check("default split is STRUCTURAL_HALVES, both windows populated", () => {
  withDurable(STABLE, (log) => {
    const r = assessNarrowT(log, cfgFull());
    assert.strictEqual(r.windowing?.method, "STRUCTURAL_HALVES");
    assert.strictEqual(r.windowing?.earlyCount, 40);
    assert.strictEqual(r.windowing?.lateCount, 40);
    assert.strictEqual(r.windowing?.excludedMiddleCount, 0);
  });
});
check("injected temporalWindowSize takes a fixed window from each end; the middle is EXCLUDED and counted", () => {
  withDurable(WINDOW_STABLE, (log) => {
    const r = assessNarrowT(log, cfgFull({ temporalWindowSize: 30 }));
    assert.strictEqual(r.verdict.kind, "SILENT");
    assert.strictEqual(r.windowing?.method, "INJECTED_WINDOW");
    assert.strictEqual(r.windowing?.windowSize, 30);
    assert.strictEqual(r.windowing?.earlyCount, 30);
    assert.strictEqual(r.windowing?.lateCount, 30);
    assert.strictEqual(r.windowing?.excludedMiddleCount, 60);
    assert.ok(r.verdict.summary.includes("EXCLUDED from the table"));
  });
});
check("injected window LONGER than half the record -> CANNOT_ASSESS (windows would overlap)", () => {
  withDurable(stable(5), (log) => {
    // n=10, temporalWindowSize 30 → needs 60 records, has 10.
    const r = assessNarrowT(log, cfgFull({ temporalWindowSize: 30 }));
    assert.deepStrictEqual(blindClasses(r.verdict), ["INSUFFICIENT_SAMPLE"]);
    if (r.verdict.kind === "CANNOT_ASSESS") {
      assert.ok(r.verdict.blindPaths[0].detail.includes("would overlap"));
    }
    assert.strictEqual(r.windowing, null);
  });
});
check("a window below the injected minimum per window -> CANNOT_ASSESS (INSUFFICIENT_SAMPLE)", () => {
  withDurable(stable(20), (log) => {
    // n=40 → halves of 20 each, below minimum 30.
    const r = assessNarrowT(log, cfgFull());
    assert.deepStrictEqual(blindClasses(r.verdict), ["INSUFFICIENT_SAMPLE"]);
  });
});

// ══ C · the ceiling text (F-γ2 + T1), present on every verdict ═══════════════

console.log("\n══ C · the three-part ceiling text — printed on ALARM and SILENT ══");

check("SILENT carries the ceiling: signature-holding adversary + drift≠degradation + F-γ2 no-identity", () => {
  withDurable(STABLE, (log) => {
    const r = assessNarrowT(log, cfgFull());
    assert.strictEqual(r.verdict.kind, "SILENT");
    assert.ok(r.verdict.summary.includes("holds its SIGNATURE steady"));
    assert.ok(r.verdict.summary.includes("DRIFT IS NOT DEGRADATION"));
    assert.ok(r.verdict.summary.includes("NO IDENTITY CLAIM (F-γ2)"));
    assert.ok(r.verdict.summary.includes("same system across the arc"));
  });
});
check("ALARM carries the ceiling too (changed BEYOND TOLERANCE, never FOR THE WORSE)", () => {
  withDurable(DRIFTED, (log) => {
    const r = assessNarrowT(log, cfgFull());
    assert.strictEqual(r.verdict.kind, "ALARM");
    assert.ok(r.verdict.summary.includes("CHANGED BEYOND TOLERANCE"));
    assert.ok(r.verdict.summary.includes("never that it changed FOR THE WORSE"));
  });
});
check("the words identity / same-system appear ONLY inside the ceiling text (source discipline)", () => {
  // Read the module source and assert the fenced vocabulary is confined to the
  // T_CEILING constant and the DOES_NOT_SEE lines that carry it.
  const src = require("fs").readFileSync(join(__dirname, "index.ts"), "utf8") as string;
  // Every occurrence of "same system" must sit on a line that is part of the
  // ceiling vocabulary. We check the phrase never appears in a verdict summary
  // literal outside the ceiling constant by counting: it lives in T_CEILING and
  // in the scope DOES_NOT_SEE block, both of which mention "F-γ2".
  const idx = src.toLowerCase();
  assert.ok(idx.includes("same system"), "ceiling text present");
  // Guard against a stray drift-summary using the forbidden word: the ALARM/SILENT
  // summary literals must not contain "same system" themselves — they reference
  // T_CEILING by name instead.
  const alarmBlock = src.slice(src.indexOf("Dispositional drift:"), src.indexOf("T_DISPOSITIONAL_DRIFT"));
  assert.ok(!alarmBlock.toLowerCase().includes("same system"), "ALARM summary must not inline the forbidden vocabulary");
});

// ══ E · end to end through guard() ═══════════════════════════════════════════

console.log("\n══ E · narrow-T ALARM floors five SILENT siblings through guard() ══");

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
// The W/R/K diagonal-dominant table (their leg-2 SILENT arm), reused verbatim.
const WRK_CONS: readonly string[] = ["con_refuse", "con_limit", "con_boundary"];
const wrkCtx = (k: string): Spec => ({ eventType: `ctx_${k}`, outcome: "o", moduleId: "cx" });
const wrkCon = (c: string): Spec => ({ eventType: c, outcome: "o" });
function wrkDiag(nDiag: number, nOff: number): Spec[] {
  const specs: Spec[] = [];
  const C = ["1", "2", "3"];
  for (let k = 0; k < 3; k++) {
    for (let d = 0; d < nDiag; d++) {
      specs.push(wrkCtx(C[k]));
      specs.push(wrkCon(WRK_CONS[k]));
    }
    for (let o = 0; o < nOff; o++) {
      specs.push(wrkCtx(C[k]));
      specs.push(wrkCon(WRK_CONS[(k + 1) % 3]));
      specs.push(wrkCtx(C[k]));
      specs.push(wrkCon(WRK_CONS[(k + 2) % 3]));
    }
  }
  return specs;
}
const WRK_HEALTHY = wrkDiag(8, 2);
const NARROW_W_CFG: NarrowWConfig = {
  readableLoadStates: GATE,
  declaredProfile: WRK_CONS,
  correlationThreshold: NARROW_W_LEG2_PROXY_CALIBRATION.correlationThreshold,
  correlationMinimumInquiryEvents: NARROW_W_LEG2_PROXY_CALIBRATION.correlationMinimumInquiryEvents,
  correlationCeilingMargin: NARROW_W_LEG2_PROXY_CALIBRATION.correlationCeilingMargin,
};
const NARROW_R_CFG: NarrowRConfig = {
  readableLoadStates: GATE,
  declaredProfile: WRK_CONS,
  correlationThreshold: NARROW_R_PROXY_CALIBRATION.correlationThreshold,
  correlationMinimumVerificationEvents: NARROW_R_PROXY_CALIBRATION.correlationMinimumVerificationEvents,
  correlationCeilingMargin: NARROW_R_PROXY_CALIBRATION.correlationCeilingMargin,
};
const NARROW_K_CFG: NarrowKConfig = {
  readableLoadStates: GATE,
  declaredProfile: WRK_CONS,
  correlationThreshold: NARROW_K_PROXY_CALIBRATION.correlationThreshold,
  correlationMinimumConstraintEvents: NARROW_K_PROXY_CALIBRATION.correlationMinimumConstraintEvents,
  correlationCeilingMargin: NARROW_K_PROXY_CALIBRATION.correlationCeilingMargin,
};

check("1 · stable -> composite SILENT -> RELEASE", () => {
  withDurable(STABLE, (log) => {
    const t = assessNarrowT(log, cfgFull()).verdict;
    assert.strictEqual(t.kind, "SILENT");
    const cp = new Chokepoint({ line: LINE, floorTrail: freshFloorTrail() });
    const r = cp.guard(A("t-release"), [t], { impactClass: "high" });
    assert.strictEqual(r.disposition, "RELEASE");
  });
});
check("2 · drift -> ALARM -> HOLD", () => {
  withDurable(DRIFTED, (log) => {
    const t = assessNarrowT(log, cfgFull()).verdict;
    assert.strictEqual(t.kind, "ALARM");
    const cp = new Chokepoint({ line: LINE });
    const r = cp.guard(A("t-hold"), [t], { impactClass: "trivial" });
    assert.strictEqual(r.disposition, "HOLD");
    assert.strictEqual(r.execute, false);
  });
});
check("3 · non-compensatory: narrow-T ALARM floors REAL Sig + Eng + narrow-W + narrow-R + narrow-K all SILENT -> HOLD", () => {
  withDurable(SIG_CLEAN, (sigLog) =>
    withDurable(ENG_HEALTHY, (engLog) =>
      withDurable(WRK_HEALTHY, (wLog) =>
        withDurable(WRK_HEALTHY, (rLog) =>
          withDurable(WRK_HEALTHY, (kLog) =>
            withDurable(DRIFTED, (tLog) => {
              const sig = assessSig(sigLog, SIG_CFG).verdict; // SILENT
              const eng = assessEng(engLog, ENG_CFG).verdict; // SILENT
              const w = assessNarrowW(wLog, NARROW_W_CFG).verdict; // SILENT
              const rr = assessNarrowR(rLog, NARROW_R_CFG).verdict; // SILENT
              const kk = assessNarrowK(kLog, NARROW_K_CFG).verdict; // SILENT
              const tt = assessNarrowT(tLog, cfgFull()).verdict; // ALARM
              assert.strictEqual(sig.kind, "SILENT");
              assert.strictEqual(eng.kind, "SILENT");
              assert.strictEqual(w.kind, "SILENT");
              assert.strictEqual(rr.kind, "SILENT");
              assert.strictEqual(kk.kind, "SILENT");
              assert.strictEqual(tt.kind, "ALARM");
              const cp = new Chokepoint({ line: LINE });
              const d = cp.guard(A("t-noncomp"), [sig, eng, w, rr, kk, tt], { impactClass: "critical" });
              assert.strictEqual(d.decision.floorKind, "ALARM");
              assert.strictEqual(d.disposition, "HOLD");
              assert.strictEqual(d.execute, false);
            })
          )
        )
      )
    )
  );
});

// ══ G · the class-set guard (ticket T1) — a phase change is not drift ═════════
//
// Before T1 the only guard was the AMI ceiling, which a disjoint table reaches
// only at TWO classes; the same total turnover over more classes read ALARM (4, 6,
// 8 classes) or SILENT (10+). The guard now reads the class SETS of the windows.

console.log("\n══ G · the class-set guard (ticket T1): phase change -> CANNOT_ASSESS, shared-vocabulary drift -> ALARM ══");

// The live record shape: moduleId = the subject, eventType = the bridge's kinds.
const K_A = "TOOL_ATTEMPTED", K_H = "TOOL_HELD_NOT_EXECUTED", K_E = "TOOL_EXECUTED", K_R = "TOOL_RESULT";
const live = (subj: string, kind: string): Spec => ({ moduleId: subj, eventType: kind, outcome: "o" });
const cleanAct = (subj = "housekeeper"): Spec[] => [live(subj, K_A), live(subj, K_E), live(subj, K_R)];
const heldAct = (subj = "housekeeper"): Spec[] => [live(subj, K_A), live(subj, K_H)];
const rep = (n: number, f: () => Spec[]): Spec[] => { const o: Spec[] = []; for (let i = 0; i < n; i++) o.push(...f()); return o; };
// Pre-registered records (PREREG T1, vault b6da758), rebuilt verbatim.
const R1A = [...rep(10, () => cleanAct()), ...rep(15, () => heldAct())]; // AMI 0.3013
const LT1 = [...rep(39, () => cleanAct("agentA")), ...cleanAct("agentB"), ...cleanAct("agentA"), ...rep(39, () => cleanAct("agentB"))]; // AMI 0.3176
const abs = (i: number): Spec => ({ moduleId: `m${i}`, eventType: `e_${i}`, outcome: "o" });
const MX3 = [...Array(29).fill(0).map(() => abs(1)), abs(2), abs(1), ...Array(25).fill(0).map(() => abs(2)), ...Array(4).fill(0).map(() => abs(5))]; // AMI 0.6095
const R3B = [...rep(15, () => cleanAct()), ...heldAct(), ...rep(5, () => cleanAct())]; // AMI -0.0145

check("TURNOVER (disjoint, 4 classes, AMI below the ceiling but above tolerance) -> CANNOT_ASSESS, not ALARM", () => {
  withDurable(TURNOVER, (log) => {
    const r = assessNarrowT(log, cfgFull());
    assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"]);
    assert.ok((r.structure?.ami as number) > TP.driftTolerance, "this record would have alarmed before T1");
    assert.ok((r.structure?.ami as number) < 1 - TP.driftCeilingMargin, "and the ceiling alone did not catch it");
    if (r.verdict.kind === "CANNOT_ASSESS") {
      assert.ok(r.verdict.blindPaths[0].detail.includes("DISJOINT"));
      assert.ok(r.verdict.blindPaths[0].detail.includes("PHASE CHANGE"));
    }
    assert.strictEqual(r.ceilingCheck, "PERFORMED");
  });
});
check("TURNOVER with NO margin: the guard shares the ceiling's gate -> ALARM + both not-performed notes", () => {
  withDurable(TURNOVER, (log) => {
    const r = assessNarrowT(log, cfgNoCeiling());
    assert.strictEqual(r.verdict.kind, "ALARM");
    if (r.verdict.kind === "ALARM") {
      assert.ok(r.verdict.findings[0].detail.includes("AMI CEILING CHECK DID NOT RUN"));
      assert.ok(r.verdict.findings[0].detail.includes("CLASS-SET GUARD"));
    }
    assert.strictEqual(r.ceilingCheck, "NOT_PERFORMED");
  });
});
check("total turnover reads the SAME at every class count (k = 2..12): CANNOT_ASSESS — the reading no longer depends on k", () => {
  for (const k of [2, 4, 6, 8, 10, 12]) {
    const h = k / 2;
    const specs: Spec[] = [];
    for (let i = 0; i < 30; i++) specs.push(abs(i % h));
    for (let i = 0; i < 30; i++) specs.push(abs(h + (i % h)));
    withDurable(specs, (log) => {
      const r = assessNarrowT(log, cfgFull());
      assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"], `k=${k}`);
    });
  }
});
check("the post-27th shape (live kinds: 10 clean acts, then 15 held acts) -> CANNOT_ASSESS as a PHASE CHANGE, classes named", () => {
  withDurable(R1A, (log) => {
    const r = assessNarrowT(log, cfgFull());
    assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"]);
    assert.ok((r.structure?.ami as number) > TP.driftTolerance, "AMI 0.3013 — it read ALARM before T1");
    if (r.verdict.kind === "CANNOT_ASSESS") {
      const d = r.verdict.blindPaths[0].detail;
      assert.ok(d.includes("EARLY-only: housekeeper/TOOL_EXECUTED, housekeeper/TOOL_RESULT"), d);
      assert.ok(d.includes("LATE-only: housekeeper/TOOL_HELD_NOT_EXECUTED"), d);
      assert.ok(d.includes("only 1 class is spoken in both windows (housekeeper/TOOL_ATTEMPTED)"), d);
      assert.ok(d.includes("A PHASE CHANGE, deliberately NOT an alarm"), d);
    }
  });
});
check("the twin that MUST still alarm: live kinds, 2 subjects, A 39:1 -> 1:39 (shared vocabulary) -> ALARM — thin margin, proxy-bound", () => {
  withDurable(LT1, (log) => {
    const r = assessNarrowT(log, cfgFull());
    assert.deepStrictEqual(findingCodes(r.verdict), ["T_DISPOSITIONAL_DRIFT"]);
    const ami = r.structure?.ami as number;
    // ⚠ AMI 0.3176, +0.0176 over the PRE-PILOT PROXY tolerance 0.30. This pins the
    // repair only at the proxy calibration (Fault D, the arbiter's).
    assert.ok(ami > TP.driftTolerance && ami < TP.driftTolerance + 0.02, `margin is ${ami - TP.driftTolerance}`);
  });
});
check("a NEW class late does not blind drift INSIDE the shared vocabulary (MX3) -> ALARM", () => {
  withDurable(MX3, (log) => {
    const r = assessNarrowT(log, cfgFull());
    assert.deepStrictEqual(findingCodes(r.verdict), ["T_DISPOSITIONAL_DRIFT"]);
  });
});
check("a stray class in one window, no drift (R3b) -> SILENT: the guard acts only above tolerance or on disjoint sets", () => {
  withDurable(R3B, (log) => {
    const r = assessNarrowT(log, cfgFull());
    assert.strictEqual(r.verdict.kind, "SILENT");
  });
});

// ══ X · cross-check — narrow-T's AMI is the shared ../stat/ami statistic ══════

console.log("\n══ X · narrow-T shares only ../stat/ami — identical AMI on its own table ══");

check("narrow-T's AMI equals pairedStructure over its own (window, class) table, byte-for-byte", () => {
  withDurable(DRIFTED, (log) => {
    const r = assessNarrowT(log, cfgFull());
    const tAmi = r.structure?.ami;
    assert.ok(typeof tAmi === "number");

    // Rebuild the same (WINDOW, class) keys the reader builds: ordered by
    // sequenceNumber, EARLY = first half, LATE = second half (structural halves).
    const ordered = [...log.getAll()].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    const mid = Math.floor(ordered.length / 2);
    const windowKeys: string[] = [];
    const classKeys: string[] = [];
    ordered.forEach((e, i) => {
      windowKeys.push(i < mid ? "EARLY" : "LATE");
      classKeys.push(contextTupleKey(e));
    });
    const direct = pairedStructure(windowKeys, classKeys, {
      samples: TP.driftPermutationSamples,
      seed: TP.driftPermutationSeed,
    });
    assert.strictEqual(tAmi, direct.ami); // same statistic, same table, byte-for-byte
  });
});

// ── X3 arms · verdict-touching branches no fixture reached (X3 coverage table) ──
// X3-05 · STRUCTURAL_HALVES on a record of 0 or 1 entries puts nothing in EARLY,
// so the empty-window gate (index.ts:474) decides before the minimum gate does.
for (const n of [0, 1]) {
  check(`X3-05 · a ${n}-record arc under STRUCTURAL_HALVES -> CANNOT_ASSESS (INELIGIBLE_SCOPE, empty window)`, () => {
    const log = new MicaFixtureLog();
    appendAll(log, STABLE.slice(0, n));
    const r = assessNarrowT(log, cfgFull({ readableLoadStates: ["IN_MEMORY"] }));
    assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"]);
    assert.ok((r.verdict as CannotAssessVerdict).blindPaths[0].detail.includes("one of the two windows is empty"));
    assert.strictEqual(r.windowing?.method, "STRUCTURAL_HALVES");
    assert.strictEqual(r.windowing?.earlyCount, 0);
    assert.strictEqual(r.windowing?.lateCount, n);
    assert.strictEqual(r.structure, null);
  });
}

rmSync(root, { recursive: true, force: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
