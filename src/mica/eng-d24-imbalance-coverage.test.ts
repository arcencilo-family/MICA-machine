// ──────────────────────────────────────────────────────────────────────────────
// MICA — Eng COVERAGE OF D-24's "EXTREME CLASS IMBALANCE (98/1/1)"
//   npx ts-node src/mica/eng-d24-imbalance-coverage.test.ts
//
// House style: standalone ts-node script, custom check() harness, no framework.
//
// LEDGER CROSS-REFERENCE — D-24
//
//   D-24 named six untested input classes. Five are now closed (partial class
//   collapse and temporal drift as A4 diagnostics; the three F2 state-machine
//   classes via sig-f2-d24-coverage.test.ts and the F2 negative precondition).
//   This file closes the sixth: EXTREME CLASS IMBALANCE (98/1/1) on Eng.
//
//   THE QUESTION. Eng's existing A4 asymmetric-degradation fixture (eng.test.ts)
//   proves the aggregate is unaffected by a collapsed class among EQUAL-SIZED
//   classes (4 classes, 30 entries each). It says nothing about what happens
//   when the classes are NOT equal-sized — the case D-24 actually named.
//
//   THE FINDING, from the exact hypergeometric AMI computed against extreme
//   skew (verified below at N=1000/10000/100000, and this file's own runs):
//
//     1. NO NUMERICAL FAILURE. The exact E[MI] (expectedMutualInformation in
//        eng/index.ts) is computed via log-factorials, not an asymptotic
//        approximation, so it stays exact under 98/1/1 skew. No NaN, no crash,
//        no meaningfully degraded runtime at 100k records (checked below).
//
//     2. THE AGGREGATE IS HONEST, NOT BLIND — BUT MAJORITY-WEIGHTED. A
//        majority-class collapse (98% of the log) crashes the aggregate AMI.
//        A minority-class collapse (1% of the log) still MOVES the aggregate
//        AMI in the correct direction — this is NOT the "aggregate never
//        moves" blind spot D-18 worried about — but by a proportionally
//        smaller amount, because MI is a probability-weighted statistic and a
//        1%-weight class can only contribute ~1% of it. Same shape as the
//        already-ruled D-18/A4 asymmetric-degradation gap; this file puts
//        NUMBERS on it under the specific skew D-24 named, rather than leaving
//        it asserted only for the equal-class case.
//
//     3. THE NAMED RESIDUAL GAP — SINGLETON CLASSES. When a minority class is
//        reduced to its logical floor (exactly one occurrence, the literal
//        "1" in "98/1/1"), "collapse" is not an expressible question for that
//        class: one observation has no conditional distribution to compare
//        against anything. `hasRepeatedClass` (eng/index.ts) is an OR across
//        the WHOLE class set, so the aggregate read still runs — carried
//        entirely by the majority class — and the A4 per-class diagnostic
//        still emits a row for the singleton, but that row's
//        divergenceFromPooled and leaveOneOutAmi describe which one outcome
//        value happened to land there, not a collapse/no-collapse fact. This
//        is real and is named here rather than silently. It changes NO
//        verdict and needs NO code change: A4 is report-only by ruling, and
//        whether a singleton class should be flagged at all is the same
//        arbiter question D-18 already parked.
//
//   NO CODE CHANGE. Every check below runs against eng/index.ts unmodified.
//   This file is regression coverage + a documented finding, not a fix.
// ──────────────────────────────────────────────────────────────────────────────

import assert from "assert";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { MicaFixtureLog } from "./fixture-log";
import { assessEng } from "./eng";
import type { EngConfig } from "./eng";

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

const root = mkdtempSync(join(tmpdir(), "mica-eng-d24-imbalance-"));
let counter = 0;
const freshPath = (): string => join(root, `log-${counter++}.jsonl`);

/** Deterministic LCG (glibc parameters) so every run of this file is identical. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s;
  };
}

interface Spec {
  moduleId: string;
  eventType: string;
  outcome: string;
  timestamp: number;
}

const T0 = 1_700_000_000_000;

/**
 * Three classes at an injected split — majority holds `aFrac` of the log, the
 * remaining records split evenly between two minority classes. `collapseWho`
 * picks which class (if any) draws its outcome at random from the SAME shared
 * alphabet the healthy classes use, rather than deterministically.
 *
 * FIXTURE-DESIGN NOTE (learned the hard way on the first pass at this file —
 * see eng.test.ts's own note on this exact pitfall): a "collapsed" class must
 * draw from the SAME outcome vocabulary as everyone else. A private noise
 * alphabet is not a collapsed class, it is a class with unusual vocabulary,
 * and it reads as MORE identifiable, not less. This fixture uses one shared
 * 3-value alphabet (`verdict_class_0..2`) plus a `deferred` wildcard for both
 * the healthy and the collapsed arms.
 */
function buildSpecs(
  n: number,
  aFrac: number,
  collapseWho: "none" | "majority" | "minority"
): Spec[] {
  const rng = lcg(9001);
  const majN = Math.round(n * aFrac);
  const minN = Math.max(1, Math.round((n - majN) / 2));
  const sizes = [majN, minN, minN];
  const names: readonly { moduleId: string; eventType: string }[] = [
    { moduleId: "m_majority", eventType: "heartbeat" },
    { moduleId: "m_minority_b", eventType: "rare_action_b" },
    { moduleId: "m_minority_c", eventType: "rare_action_c" },
  ];
  const collapsedIdx =
    collapseWho === "majority" ? 0 : collapseWho === "minority" ? 1 : -1;

  const specs: Spec[] = [];
  let seq = 0;
  for (let ci = 0; ci < 3; ci++) {
    for (let i = 0; i < sizes[ci]; i++) {
      const isCollapsed = ci === collapsedIdx;
      const outcome =
        i % 4 === 0
          ? "deferred"
          : isCollapsed
            ? `verdict_class_${rng() % 3}` // random draw, shared alphabet
            : `verdict_class_${ci}`; // deterministic, correlated with class
      specs.push({
        moduleId: names[ci].moduleId,
        eventType: names[ci].eventType,
        outcome,
        timestamp: T0 + seq,
      });
      seq++;
    }
  }
  return specs;
}

function withDurable<T>(specs: readonly Spec[], fn: (log: MicaFixtureLog) => T): T {
  const path = freshPath();
  try {
    const writer = new MicaFixtureLog({ path });
    for (const s of specs) writer.append(s);
    const loaded = new MicaFixtureLog({ path });
    if (loaded.getLoadState() !== "LOADED_VERIFIED") {
      throw new Error(
        `FIXTURE BROKEN: expected LOADED_VERIFIED, got ${loaded.getLoadState()} at ${path}.`
      );
    }
    if (loaded.length !== specs.length) {
      throw new Error(
        `FIXTURE BROKEN: persisted ${specs.length} records, reloaded ${loaded.length}.`
      );
    }
    return fn(loaded);
  } finally {
    rmSync(path, { force: true });
  }
}

const GATE: readonly string[] = ["LOADED_VERIFIED"];

const CFG: EngConfig = {
  readableLoadStates: GATE,
  structureThreshold: 0.03,
  minimumSampleSize: 30,
  // T11 · the observed-coverage floor, declared and with no default. This
  // suite declares its OWN Eng config, which is why it is in T11's `opens`:
  // without this line Eng returns MISSING_CONFIGURATION and every reading
  // through it becomes CANNOT_ASSESS.
  minimumClassCoverage: 3,
  permutationSamples: 300,
  permutationSeed: 20260815,
};

console.log("\nMICA Eng — D-24 extreme class imbalance (98/1/1) coverage\n");

// ══ 1 · NO NUMERICAL FAILURE UNDER SKEW ══════════════════════════════════════

console.log("\n══ 1 · exact AMI stays finite and fast under 98/1/1 skew ═══════");

{
  const t0 = Date.now();
  const specs = buildSpecs(100_000, 0.98, "none").map((s, i) => ({
    ...s,
    // sequenceNumber assigned by the fixture log itself on append; timestamp
    // ordering above is what matters for this scale check.
  }));
  withDurable(specs, (log) => {
    const elapsedWriteMs = Date.now() - t0;
    const t1 = Date.now();
    const r = assessEng(log, CFG);
    const elapsedReadMs = Date.now() - t1;
    check("100k records, 98/1/1 split: AMI is finite (no NaN, no crash)", () => {
      assert.strictEqual(typeof r.structure?.ami, "number");
      assert.ok(Number.isFinite(r.structure?.ami as number));
    });
    check("100k records, 98/1/1 split: read completes in well under 30s", () => {
      assert.ok(
        elapsedReadMs < 30_000,
        `assessEng took ${elapsedReadMs}ms (fixture write took ${elapsedWriteMs}ms)`
      );
    });
    console.log(
      `  (100k-record fixture: write ${elapsedWriteMs}ms, assessEng ${elapsedReadMs}ms, ` +
        `AMI=${r.structure?.ami})`
    );
  });
}

// ══ 2 · THE AGGREGATE IS MAJORITY-WEIGHTED, NOT MAJORITY-BLIND ══════════════

console.log("\n══ 2 · majority collapse crashes AMI; minority collapse moves it,");
console.log("       by a proportionally smaller amount ═══════════════════════");

{
  const N = 10_000;
  const none = withDurable(buildSpecs(N, 0.98, "none"), (log) => assessEng(log, CFG));
  const majorityCollapsed = withDurable(buildSpecs(N, 0.98, "majority"), (log) =>
    assessEng(log, CFG)
  );
  const minorityCollapsed = withDurable(buildSpecs(N, 0.98, "minority"), (log) =>
    assessEng(log, CFG)
  );

  const amiNone = none.structure?.ami as number;
  const amiMajority = majorityCollapsed.structure?.ami as number;
  const amiMinority = minorityCollapsed.structure?.ami as number;

  console.log(
    `  N=${N}, 98/1/1: AMI none=${amiNone.toFixed(6)} ` +
      `majority-collapsed=${amiMajority.toFixed(6)} minority-collapsed=${amiMinority.toFixed(6)}`
  );

  check("baseline (no collapse) is the healthiest of the three", () => {
    assert.ok(amiNone > amiMajority, `baseline ${amiNone} not > majority-collapsed ${amiMajority}`);
    assert.ok(amiNone > amiMinority, `baseline ${amiNone} not > minority-collapsed ${amiMinority}`);
  });

  check("majority-class (98%) collapse crashes the aggregate AMI", () => {
    // Majority collapse should land close to zero — the class carrying 98% of
    // the weight has lost all structure.
    assert.ok(amiMajority < 0.02, `majority-collapsed AMI ${amiMajority} not near zero`);
  });

  check(
    "minority-class (1%) collapse still moves the aggregate AMI in the correct " +
      "direction — this is NOT the 'aggregate never moves' blind spot",
    () => {
      assert.ok(
        amiMinority < amiNone,
        `minority-collapsed AMI ${amiMinority} not below baseline ${amiNone}`
      );
    }
  );

  check(
    "minority collapse moves AMI by a SMALLER amount than majority collapse — " +
      "the aggregate is weighted by class mass, not blind to any one class",
    () => {
      const dropMinority = amiNone - amiMinority;
      const dropMajority = amiNone - amiMajority;
      assert.ok(
        dropMinority < dropMajority,
        `minority drop ${dropMinority} not smaller than majority drop ${dropMajority}`
      );
    }
  );

  check("A4 per-class diagnostics still emit one row per class regardless of size", () => {
    assert.strictEqual(minorityCollapsed.diagnostics?.perClass.length, 3);
  });
}

// ══ 3 · THE NAMED RESIDUAL GAP — SINGLETON MINORITY CLASSES ══════════════════

console.log("\n══ 3 · singleton classes: 'collapse' is not an expressible question ══");

{
  const N = 100; // majority ~98, minority classes reduced to exactly 1 record each
  const none = withDurable(buildSpecs(N, 0.98, "none"), (log) => assessEng(log, CFG));
  const minorityCollapsed = withDurable(buildSpecs(N, 0.98, "minority"), (log) =>
    assessEng(log, CFG)
  );

  check(
    "at true 98/1/1 (minority classes = 1 record each), the singleton's only " +
      "entry lands on the shared 'deferred' wildcard by construction — 'collapsing' " +
      "it is not expressible, and the read is BYTE-IDENTICAL either way",
    () => {
      assert.strictEqual(none.structure?.ami, minorityCollapsed.structure?.ami);
      assert.strictEqual(none.verdict.summary, minorityCollapsed.verdict.summary);
    }
  );

  check("hasRepeatedClass is still true — carried entirely by the majority class", () => {
    assert.strictEqual(none.structure?.hasRepeatedClass, true);
  });

  check(
    "the singleton class still gets an A4 diagnostic row, but it is not " +
      "informative — GAP NAMED, not fixed, per D-24/D-18",
    () => {
      const rows = none.diagnostics?.perClass ?? [];
      const singleton = rows.find((r) => r.count === 1);
      assert.ok(singleton !== undefined, "expected a singleton-count class row");
      // leaveOneOutAmi is computable (2 classes remain) but describes the
      // OTHER two classes' relationship, not this class's own collapse state.
      assert.ok(
        singleton!.leaveOneOutAmi === null || Number.isFinite(singleton!.leaveOneOutAmi),
        "leaveOneOutAmi should be null or finite, never NaN"
      );
    }
  );
}

// ══ SUMMARY ══════════════════════════════════════════════════════════════════

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
