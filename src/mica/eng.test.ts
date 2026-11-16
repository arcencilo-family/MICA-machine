// ──────────────────────────────────────────────────────────────────────────────
// MICA — Eng (engagement signature) sensor tests
// House style: standalone ts-node script, custom check() harness. No framework.
//   npx ts-node src/mica/eng.test.ts
//
// FIX ROUND A1: the readability gate now admits LOADED_VERIFIED only. Every
// fixture that asserts ALARM, SILENT, or a blindness OTHER than load state is
// therefore persisted to its own file and reloaded through a fresh
// MicaFixtureLog before the sensor sees it. See withDurable().
// ──────────────────────────────────────────────────────────────────────────────

import assert from "assert";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MicaFixtureLog } from "./fixture-log";
import type { MicaLogRecord } from "./log";
import { contextTupleKey } from "./tuple-key";
import { assessEng, printEngScope, AMI_MAXIMUM } from "./eng";
import type {
  EngClassDiagnostic,
  EngConfig,
  EngResult,
  EngWindowDiagnostic,
  PermutationReference,
} from "./eng";
import { renderVerdict } from "./types";
import type { AlarmVerdict, CannotAssessVerdict, SensorVerdict } from "./types";

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

const root = mkdtempSync(join(tmpdir(), "mica-eng-"));
let counter = 0;
const freshPath = (): string => join(root, `log-${counter++}.jsonl`);

// ── Fixture helpers ───────────────────────────────────────────────────────────
//
// NOTE ON `parameters`: there is no longer any such field to supply. MICA's own
// declared record (src/mica/log.ts) never had one, so the fixture's append()
// does not ask for one. What the D2 test below exercises instead is the
// `undeclared` bag — content the fixture writes to disk and hashes, which
// MICA's shape does not declare and no sensor has a typed path to.

interface Spec {
  moduleId: string;
  eventType: string;
  outcome: string;
  timestamp: number;
}

function appendAll(log: MicaFixtureLog, specs: readonly Spec[]): void {
  for (const s of specs) {
    log.append({
      timestamp: s.timestamp,
      moduleId: s.moduleId,
      eventType: s.eventType,
      outcome: s.outcome,
    });
  }
}

/** In-memory build. After A1 this state is BLIND — used only to prove that. */
function buildInMemory(specs: readonly Spec[]): MicaFixtureLog {
  const log = new MicaFixtureLog();
  appendAll(log, specs);
  return log;
}

/**
 * A1 fixture path. Persist the records to their OWN file, then load them back
 * through a FRESH MicaFixtureLog so the sensor sees LOADED_VERIFIED — the
 * only state it will accept, and the state a live node is in after a restart.
 *
 * The load-state assertion is not a formality. A fixture that silently failed
 * to persist would come back as an in-memory or first-boot chain and the test
 * would then pass for the wrong reason — CANNOT_ASSESS for a load-state reason
 * while claiming to test something else. That failure mode is EXACTLY what A1
 * exists to prevent and it would be invisible without this assertion, so it
 * throws rather than merely failing a check.
 *
 * The file is removed in `finally`, so a thrown assertion does not leave an
 * artefact behind. Each call gets its own path: no shared fixture files, no
 * order dependence between tests.
 */
function withDurable<T>(
  specs: readonly Spec[],
  fn: (log: MicaFixtureLog) => T
): T {
  const path = freshPath();
  try {
    const writer = new MicaFixtureLog({ path });
    appendAll(writer, specs);

    const loaded = new MicaFixtureLog({ path });
    if (loaded.getLoadState() !== "LOADED_VERIFIED") {
      throw new Error(
        `FIXTURE BROKEN: expected LOADED_VERIFIED, got ${loaded.getLoadState()} ` +
          `at ${path}. The test below would have passed for the wrong reason.`
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

const T0 = 1_700_000_000_000;

/**
 * THE READABLE LOAD-STATE LIST, INJECTED INTO EVERY FIXTURE IN THIS FILE.
 *
 * The gate holds no list of its own and no default: which load states are
 * trustworthy is a deployment fact, so every caller must say. Injecting exactly
 * ["LOADED_VERIFIED"] here keeps every assertion below reading what it read
 * before the list was injected rather than hardcoded.
 *
 * Written as a literal rather than imported from RECOMMENDED_READABLE_LOAD_STATES
 * ON PURPOSE: a fixture that tracked the recommendation would stop being able to
 * detect the recommendation changing underneath it.
 */
const GATE: readonly string[] = ["LOADED_VERIFIED"];

/** Three event classes, cycled. */
const CLASSES: readonly { moduleId: string; eventType: string }[] = [
  { moduleId: "m3", eventType: "canary_check" },
  { moduleId: "m5", eventType: "drift_sample" },
  { moduleId: "m7", eventType: "permission_check" },
];

function cls(i: number): { moduleId: string; eventType: string } {
  return CLASSES[i % CLASSES.length];
}

/** Deterministic LCG (glibc parameters) so every run of this file is identical. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s;
  };
}

function specs(n: number, outcomeOf: (i: number) => string): Spec[] {
  const out: Spec[] = [];
  for (let i = 0; i < n; i++) {
    const c = cls(i);
    out.push({
      moduleId: c.moduleId,
      eventType: c.eventType,
      outcome: outcomeOf(i),
      timestamp: T0 + i,
    });
  }
  return out;
}

function report(label: string, v: SensorVerdict, extra?: string): void {
  console.log(`\n--- ${label} ---`);
  console.log(renderVerdict(v));
  if (extra !== undefined) console.log(`  stat: ${extra}`);
}

function statLine(r: EngResult): string {
  const s = r.structure;
  if (s === undefined) return "(no statistic computed)";
  return (
    `N=${s.sampleSize} classes=${s.distinctClasses} outcomes=${s.distinctOutcomes} ` +
    `MI=${s.mutualInformation.toFixed(6)} E[MI]=${s.expectedMutualInformation.toFixed(6)} ` +
    `H(C)=${s.entropyClass.toFixed(6)} H(O)=${s.entropyOutcome.toFixed(6)} ` +
    `AMI=${s.ami === null ? "null" : s.ami.toFixed(6)} ceilingCheck=${r.ceilingCheck}` +
    (s.permutation === null
      ? ``
      : ` | permutation: observed MI strictly above ${(s.permutation.percentileBelow * 100).toFixed(1)}%` +
        ` of ${s.permutation.samples} reshuffles (at-or-above ` +
        `${(s.permutation.percentileAtOrBelow * 100).toFixed(1)}%), resampled mean=` +
        `${s.permutation.resampledMean.toFixed(6)} sd=${s.permutation.resampledStdDev.toFixed(6)}`)
  );
}

function printDiagnostics(r: EngResult): void {
  const d = r.diagnostics;
  if (d === undefined) {
    console.log("  diagnostics: (not computed — no statistic)");
    return;
  }
  console.log("  A4 per-class (REPORT ONLY — never affects the verdict):");
  for (const c of d.perClass) {
    console.log(
      `    ${c.eventClass.padEnd(24)} n=${String(c.count).padStart(3)} ` +
        `D(P(O|k)||P(O))=${c.divergenceFromPooled.toFixed(6)} ` +
        `leave-one-out AMI=${c.leaveOneOutAmi === null ? "null" : c.leaveOneOutAmi.toFixed(6)}`
    );
  }
  console.log(`  A4 windowed: ${d.windowNote}`);
  if (d.windows !== null) {
    for (const w of d.windows) {
      console.log(
        `    window ${w.windowIndex} seq ${w.fromSequence}-${w.toSequence} ` +
          `size=${w.size} AMI=${w.ami === null ? "null" : w.ami.toFixed(6)} (${w.note})`
      );
    }
  }
}

function blindClasses(v: SensorVerdict): string[] {
  assert.strictEqual(v.kind, "CANNOT_ASSESS", `expected CANNOT_ASSESS, got ${v.kind}`);
  return (v as CannotAssessVerdict).blindPaths.map((b) => b.class);
}

function blindDetail(v: SensorVerdict): string {
  return (v as CannotAssessVerdict).blindPaths.map((b) => b.detail).join(" | ");
}

// ── Injected configuration ────────────────────────────────────────────────────
//
// These live in the TEST, not in the sensor. The sensor holds no numbers.
// The values are arbitrary placeholders for calibration that has not happened.

const CFG: EngConfig = {
  readableLoadStates: GATE,
  structureThreshold: 0.2,
  minimumSampleSize: 30,
  // T11. Injected here because the sensor has no default and refuses without
  // one — the same discipline structureThreshold and minimumSampleSize already
  // follow. 3 is the value the arbiter ruled; it is a placeholder for calibration
  // that has not happened, exactly like the two above it.
  minimumClassCoverage: 3,
  ceilingMargin: 0.02,
  permutationSamples: 400,
  permutationSeed: 20260806,
};

/** Same as CFG but with the ceiling check disabled, to show the disclosure. */
const CFG_NO_CEILING: EngConfig = {
  readableLoadStates: GATE,
  structureThreshold: 0.2,
  minimumSampleSize: 30,
  minimumClassCoverage: 3,
  permutationSamples: 400,
  permutationSeed: 20260806,
};

console.log("\nMICA Eng sensor tests\n");
printEngScope(GATE);

// ══ A1 — IN_MEMORY IS NOW BLIND ══════════════════════════════════════════════

console.log("\n══ A1 · IN_MEMORY is blind ═══════════════════════════════════");

{
  // The exact fixture that returned SILENT before this round.
  const inMem = buildInMemory(specs(90, (i) => (i % 4 === 0 ? "deferred" : `verdict_class_${i % 3}`)));
  const r = assessEng(inMem, CFG);
  report("A1 / in-memory chain that previously read SILENT", r.verdict);
  check("A1: an IN_MEMORY chain is now CANNOT_ASSESS, whatever it contains", () => {
    assert.strictEqual(inMem.getLoadState(), "IN_MEMORY");
    assert.strictEqual(inMem.verify().valid, true); // integrity holds...
    assert.deepStrictEqual(blindClasses(r.verdict), ["NON_CLEAN_LOAD_STATE"]); // ...provenance does not
  });
  check("A1: the same records, persisted and reloaded, ARE readable", () => {
    withDurable(specs(90, (i) => (i % 4 === 0 ? "deferred" : `verdict_class_${i % 3}`)), (log) => {
      assert.strictEqual(log.getLoadState(), "LOADED_VERIFIED");
      assert.strictEqual(assessEng(log, CFG).verdict.kind, "SILENT");
    });
  });
}

// ══ D4 — degradation ABSENT, sensor must stay SILENT ═════════════════════════

console.log("\n══ D4 · degradation absent ═══════════════════════════════════");

// E2 is the NEW healthy-SILENT anchor. E1 (the perfect-mapping fixture) moved
// to the ceiling section — see A5.
const HEALTHY_ANCHOR = specs(90, (i) =>
  i % 4 === 0 ? "deferred" : `verdict_class_${i % CLASSES.length}`
);

withDurable(HEALTHY_ANCHOR, (log) => {
  const r = assessEng(log, CFG);
  report("HEALTHY ANCHOR / partially responsive (E2)", r.verdict, statLine(r));
  printDiagnostics(r);
  check("E2: partially-but-genuinely responsive log -> SILENT", () => {
    assert.strictEqual(r.verdict.kind, "SILENT");
  });
  check("E2: sits clear of BOTH bounds — above threshold, below ceiling", () => {
    const ami = r.structure?.ami as number;
    assert.ok(ami > (CFG.structureThreshold as number), `AMI ${ami} not above threshold`);
    assert.ok(
      ami < AMI_MAXIMUM - (CFG.ceilingMargin as number),
      `AMI ${ami} not below the ceiling band`
    );
  });
  check("E2: SILENT summary states it is an absence of finding, not health", () => {
    assert.ok(r.verdict.summary.includes("ABSENCE OF FINDING"));
    assert.ok(r.verdict.summary.includes("no positive health statement"));
    assert.ok(!/\bhealthy\b/i.test(r.verdict.summary));
  });
});

// ══ A5 — THE CEILING ═════════════════════════════════════════════════════════

console.log("\n══ A5 · the AMI ceiling ══════════════════════════════════════");

// E1: 60 records, 3 classes, each class always its own outcome. AMI = 1.000000.
// This was the suite's cleanest SILENT. It is also, byte for byte, what a
// per-class lookup table produces.
const PERFECT = specs(60, (i) => `verdict_class_${i % CLASSES.length}`);

withDurable(PERFECT, (log) => {
  const r = assessEng(log, CFG);
  report("E1 / perfect class->outcome mapping", r.verdict, statLine(r));
  printDiagnostics(r);
  check("A5: AMI at the maximum -> CANNOT_ASSESS (was SILENT before this round)", () => {
    assert.strictEqual(r.structure?.ami, AMI_MAXIMUM);
    assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
    assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"]);
  });
  check("A5: the verdict is NOT ALARM — a real judge may be working flawlessly", () => {
    assert.notStrictEqual(r.verdict.kind, "ALARM");
  });
  check("A5: the blind detail names the real-judge / lookup-table indistinguishability", () => {
    const d = blindDetail(r.verdict);
    assert.ok(d.includes("LOOKUP TABLE"));
    assert.ok(d.includes("IDENTICAL RECORD"));
  });
});

withDurable(PERFECT, (log) => {
  const r = assessEng(log, CFG_NO_CEILING);
  report("E1 / perfect mapping, ceilingMargin NOT injected", r.verdict, statLine(r));
  check("A5: with no ceilingMargin the check does not run", () => {
    assert.strictEqual(r.ceilingCheck, "NOT_PERFORMED");
  });
  check("A5: and the verdict SAYS the check did not run, rather than implying it passed", () => {
    assert.strictEqual(r.verdict.kind, "SILENT");
    assert.ok(r.verdict.summary.includes("CEILING CHECK DID NOT RUN"));
    assert.ok(r.verdict.summary.includes("evidence-free rather than healthy"));
  });
});

// ══ D3 — degradation PRESENT, BOTH directions must ALARM ═════════════════════

console.log("\n══ D3 · degradation present — direction 1: FLATTENING ════════");

const FLATTENED = specs(60, () => "approved");

withDurable(FLATTENED, (log) => {
  const r = assessEng(log, CFG);
  report("COLLAPSED / templated agreement", r.verdict, statLine(r));
  printDiagnostics(r);
  check("constant outcome regardless of event class -> ALARM", () => {
    assert.strictEqual(r.verdict.kind, "ALARM");
  });
  check("flattening drives AMI to zero", () => {
    assert.strictEqual(r.structure?.ami, 0);
    assert.strictEqual(r.structure?.distinctOutcomes, 1);
  });
});

withDurable(specs(80, (i) => (i % 20 === 0 ? "escalated" : "approved")), (log) => {
  const r = assessEng(log, CFG);
  report("COLLAPSED / near-templated", r.verdict, statLine(r));
  check("near-constant outcome, variation uncorrelated with class -> ALARM", () => {
    assert.strictEqual(r.verdict.kind, "ALARM");
  });
});

console.log("\n══ D3 · degradation present — direction 2: INJECTED NOISE ════");

withDurable(specs(66, (i) => `outcome_${(i * 7 + 3) % 11}`), (log) => {
  const r = assessEng(log, CFG);
  report("COLLAPSED / cyclic noise (11 outcomes, 3 classes, coprime)", r.verdict, statLine(r));
  check("outcome varying wildly but independently of class -> ALARM", () => {
    assert.strictEqual(r.verdict.kind, "ALARM");
  });
  check("cyclic noise has HIGH outcome entropy and ZERO mutual information", () => {
    assert.ok((r.structure?.entropyOutcome ?? 0) > (r.structure?.entropyClass ?? 0));
    assert.ok(Math.abs(r.structure?.mutualInformation ?? 1) < 1e-12);
  });
});

const rnd = lcg(20260806);
withDurable(specs(90, () => `outcome_${rnd() % 7}`), (log) => {
  const r = assessEng(log, CFG);
  report("COLLAPSED / pseudorandom noise (7 outcomes)", r.verdict, statLine(r));
  check("pseudorandom outcome over a small alphabet -> ALARM", () => {
    assert.strictEqual(r.verdict.kind, "ALARM");
  });
  check("A3: the alarm carries where the observation sits among reshuffles", () => {
    const d = (r.verdict as AlarmVerdict).findings[0].detail;
    assert.ok(d.includes("reshuffles of the same table"));
  });
});

// ── The trap case. This is the test that distinguishes the chosen statistic
//    from the naive one. Plug-in mutual information is MAXIMAL here.

withDurable(specs(60, (i) => `outcome_unique_${i}`), (log) => {
  const r = assessEng(log, CFG);
  report("COLLAPSED / noise with EVERY outcome distinct", r.verdict, statLine(r));
  check("noise with all-distinct outcomes -> ALARM", () => {
    assert.strictEqual(r.verdict.kind, "ALARM");
  });
  check("plug-in MI is MAXIMAL here (would have read as perfect structure)", () => {
    const s = r.structure;
    assert.ok(s !== undefined);
    assert.ok(Math.abs(s.mutualInformation - s.entropyClass) < 1e-12);
  });
  check("the permutation adjustment drives AMI to exactly zero anyway", () => {
    assert.ok(Math.abs(r.structure?.ami ?? 1) < 1e-12);
  });
});

// ══ A2 — BOUNDARY TESTS ══════════════════════════════════════════════════════
//
// Every previous test sat comfortably inside or outside its bound. These sit ON
// the bounds. Where a bound is compared against a continuous statistic, the
// fixture is held fixed and the INJECTED BOUND is moved to the measured value
// and one ulp-ish step either side — which is exact, whereas searching for a
// fixture whose AMI lands near a chosen threshold is approximate.

console.log("\n══ A2 · boundary tests ═══════════════════════════════════════");

const EPS = 1e-9;

// ── bound: structureThreshold. Alarm rule is `ami < threshold`. ─────────────
withDurable(HEALTHY_ANCHOR, (log) => {
  const measured = assessEng(log, CFG).structure?.ami as number;
  console.log(`\n--- A2 / threshold boundary, measured AMI = ${measured.toFixed(12)} ---`);

  const at = assessEng(log, { ...CFG, structureThreshold: measured });
  const justAbove = assessEng(log, { ...CFG, structureThreshold: measured + EPS });
  const justBelow = assessEng(log, { ...CFG, structureThreshold: measured - EPS });

  console.log(`  threshold == AMI exactly   -> ${at.verdict.kind}`);
  console.log(`  threshold == AMI + ${EPS}  -> ${justAbove.verdict.kind}`);
  console.log(`  threshold == AMI - ${EPS}  -> ${justBelow.verdict.kind}`);

  check("A2 threshold: AMI exactly AT the threshold -> SILENT (rule is strict <)", () => {
    assert.strictEqual(at.verdict.kind, "SILENT");
  });
  check("A2 threshold: one step ABOVE the AMI -> ALARM", () => {
    assert.strictEqual(justAbove.verdict.kind, "ALARM");
  });
  check("A2 threshold: one step BELOW the AMI -> SILENT", () => {
    assert.strictEqual(justBelow.verdict.kind, "SILENT");
  });
  check("A2 threshold: the two verdicts either side of the bound DIFFER", () => {
    assert.notStrictEqual(justAbove.verdict.kind, justBelow.verdict.kind);
  });
});

// ── bound: minimumSampleSize. Exact, integer-valued, no approximation. ──────
{
  const N = 40;
  const fixture = specs(N, (i) => (i % 4 === 0 ? "deferred" : `verdict_class_${i % 3}`));
  withDurable(fixture, (log) => {
    const atFloor = assessEng(log, { ...CFG, minimumSampleSize: N });
    const oneBelow = assessEng(log, { ...CFG, minimumSampleSize: N + 1 });
    console.log(`\n--- A2 / sample-size boundary, chain holds ${N} ---`);
    console.log(`  minimumSampleSize == ${N}     -> ${atFloor.verdict.kind}`);
    console.log(`  minimumSampleSize == ${N + 1} -> ${oneBelow.verdict.kind}`);
    check("A2 sample: chain length EXACTLY at the floor -> the read is attempted", () => {
      assert.notStrictEqual(atFloor.verdict.kind, "CANNOT_ASSESS");
    });
    check("A2 sample: one record short of the floor -> INSUFFICIENT_SAMPLE", () => {
      assert.deepStrictEqual(blindClasses(oneBelow.verdict), ["INSUFFICIENT_SAMPLE"]);
    });
  });
}

// ── bound: the A5 ceiling. Same held-fixture / moved-bound technique. ───────
//
// A fixture slightly off the ceiling: the perfect mapping with two records
// perturbed, so AMI lands just under the maximum.
{
  const nearPerfect = specs(60, (i) =>
    i === 7 || i === 31 ? "deferred" : `verdict_class_${i % CLASSES.length}`
  );
  withDurable(nearPerfect, (log) => {
    const measured = assessEng(log, CFG_NO_CEILING).structure?.ami as number;
    const gap = AMI_MAXIMUM - measured;
    console.log(
      `\n--- A2 / ceiling boundary, measured AMI = ${measured.toFixed(12)}, gap = ${gap.toFixed(12)} ---`
    );

    const atIt = assessEng(log, { ...CFG, ceilingMargin: gap });
    const justUnder = assessEng(log, { ...CFG, ceilingMargin: gap - EPS });

    console.log(`  ceilingMargin == gap        -> ${atIt.verdict.kind}`);
    console.log(`  ceilingMargin == gap - ${EPS} -> ${justUnder.verdict.kind}`);

    check("A2 ceiling: AMI exactly AT the ceiling band edge -> CANNOT_ASSESS", () => {
      assert.strictEqual(atIt.verdict.kind, "CANNOT_ASSESS");
      assert.deepStrictEqual(blindClasses(atIt.verdict), ["INELIGIBLE_SCOPE"]);
    });
    check("A2 ceiling: just under the band -> the ordinary read proceeds", () => {
      assert.notStrictEqual(justUnder.verdict.kind, "CANNOT_ASSESS");
    });
    check("A2 ceiling: the two verdicts either side of the bound DIFFER", () => {
      assert.notStrictEqual(atIt.verdict.kind, justUnder.verdict.kind);
    });
  });
}

// ══ A3 — PERMUTATION PERCENTILE ══════════════════════════════════════════════

console.log("\n══ A3 · permutation percentile ═══════════════════════════════");

withDurable(specs(66, (i) => `outcome_${(i * 7 + 3) % 11}`), (log) => {
  const r = assessEng(log, CFG);
  const p = r.structure?.permutation;
  console.log(`\n--- A3 / cyclic noise, MI is exactly zero ---`);
  console.log(`  ${statLine(r)}`);
  check("A3: the percentile is produced when samples and seed are injected", () => {
    assert.ok(p !== null && p !== undefined);
    assert.strictEqual(p.samples, CFG.permutationSamples);
    assert.strictEqual(p.seed, CFG.permutationSeed);
  });
  check("A3: resampled mean tracks the EXACT E[MI] computed independently", () => {
    const exact = r.structure?.expectedMutualInformation as number;
    assert.ok(
      Math.abs((p as PermutationReference).resampledMean - exact) < 0.05,
      `resampled ${(p as PermutationReference).resampledMean} vs exact ${exact}`
    );
  });
  check("A3: MI of exactly zero sits at the very bottom of the reshuffles", () => {
    assert.ok((p as PermutationReference).percentileBelow < 0.01);
  });
});

withDurable(HEALTHY_ANCHOR, (log) => {
  const r = assessEng(log, CFG);
  const p = r.structure?.permutation;
  console.log(`\n--- A3 / healthy anchor, MI well above the null ---`);
  console.log(`  ${statLine(r)}`);
  check("A3: a genuinely structured table sits at the TOP of the reshuffles", () => {
    assert.ok((p as PermutationReference).percentileBelow > 0.99);
  });
});

withDurable(HEALTHY_ANCHOR, (log) => {
  const noSeed = assessEng(log, { ...CFG, permutationSeed: undefined });
  const noSamples = assessEng(log, { ...CFG, permutationSamples: undefined });
  console.log(`\n--- A3 / percentile config absent ---`);
  console.log(`  no seed:    ${noSeed.structure?.permutationNote}`);
  console.log(`  no samples: ${noSamples.structure?.permutationNote}`);
  check("A3: absent seed or sample count -> percentile NOT PRODUCED and said so", () => {
    assert.strictEqual(noSeed.structure?.permutation, null);
    assert.strictEqual(noSamples.structure?.permutation, null);
    assert.ok(noSeed.structure?.permutationNote.includes("NOT PRODUCED"));
    assert.ok(noSamples.structure?.permutationNote.includes("NOT PRODUCED"));
  });
  check("A3: the percentile is REPORT-ONLY — its absence changes no verdict", () => {
    const withP = assessEng(log, CFG);
    assert.strictEqual(noSeed.verdict.kind, withP.verdict.kind);
    assert.strictEqual(noSamples.verdict.kind, withP.verdict.kind);
  });
});

// ══ A4 — PER-CLASS AND WINDOWED DIAGNOSTICS (REPORT ONLY) ════════════════════

console.log("\n══ A4 · diagnostics — report only ════════════════════════════");

// Asymmetric degradation: three classes respond, a fourth stops being
// differentiated.
//
// NOTE ON FIXTURE DESIGN — the first version of this fixture was wrong and the
// diagnostic caught it. Giving the collapsed class its own PRIVATE outcome
// alphabet (`noise_0..4`, used by nobody else) leaves it perfectly identifiable
// from its outcomes, so its divergence from the pooled distribution came out
// HIGH, not low. That is not a collapsed class, it is a class with unusual
// vocabulary. The degradation that actually matters is a class whose outcome
// distribution becomes INDISTINGUISHABLE FROM THE POOLED ONE, so the degraded
// class here draws from the SHARED alphabet at random.
{
  const FOUR: readonly { moduleId: string; eventType: string }[] = [
    ...CLASSES,
    { moduleId: "m6", eventType: "escalation_check" },
  ];
  const noise = lcg(4242);
  const asym: Spec[] = [];
  for (let i = 0; i < 120; i++) {
    const c = FOUR[i % FOUR.length];
    const collapsed = i % FOUR.length === 3;
    asym.push({
      moduleId: c.moduleId,
      eventType: c.eventType,
      outcome: collapsed
        ? `verdict_class_${noise() % FOUR.length}`
        : `verdict_class_${i % FOUR.length}`,
      timestamp: T0 + i,
    });
  }
  withDurable(asym, (log) => {
    const r = assessEng(log, { ...CFG, windowSize: 30 });
    report(
      "A4 / three classes responding, a fourth no longer differentiated",
      r.verdict,
      statLine(r)
    );
    printDiagnostics(r);
    check("A4: the aggregate verdict is unchanged by the diagnostics being present", () => {
      const without = assessEng(log, CFG);
      assert.strictEqual(r.verdict.kind, without.verdict.kind);
      assert.strictEqual(r.verdict.summary, without.verdict.summary);
    });
    check("A4: per-class figures are produced, one row per event class", () => {
      assert.strictEqual(r.diagnostics?.perClass.length, 4);
    });
    check("A4: the collapsed class has the LOWEST divergence from the pooled outcome", () => {
      const rows = r.diagnostics?.perClass as readonly EngClassDiagnostic[];
      const lowest = rows.reduce((a, b) =>
        a.divergenceFromPooled <= b.divergenceFromPooled ? a : b
      );
      assert.ok(
        lowest.eventClass.includes("escalation_check"),
        `lowest divergence was ${lowest.eventClass}`
      );
    });
    check("A4: windowed figures are produced when windowSize is injected", () => {
      assert.strictEqual(r.diagnostics?.windows?.length, 4);
    });
  });
}

// Temporal drift: healthy first half, unmoored second half.
{
  const noise = lcg(777);
  const drift: Spec[] = [];
  for (let i = 0; i < 120; i++) {
    const c = cls(i);
    drift.push({
      moduleId: c.moduleId,
      eventType: c.eventType,
      outcome: i < 60 ? `verdict_class_${i % 3}` : `noise_${noise() % 6}`,
      timestamp: T0 + i,
    });
  }
  withDurable(drift, (log) => {
    const r = assessEng(log, { ...CFG, windowSize: 30 });
    report("A4 / healthy first half, unmoored second half", r.verdict, statLine(r));
    printDiagnostics(r);
    check("A4: windowing makes the drift visible that the aggregate blends away", () => {
      const w = r.diagnostics?.windows as readonly EngWindowDiagnostic[];
      const early = w.slice(0, 2).map((x) => x.ami as number);
      const late = w.slice(2).map((x) => x.ami as number);
      assert.ok(Math.min(...early) > Math.max(...late), `early ${early} late ${late}`);
    });
    check("A4: and the verdict is STILL unaffected by any of it", () => {
      const without = assessEng(log, CFG);
      assert.strictEqual(r.verdict.summary, without.verdict.summary);
    });
  });
}

withDurable(HEALTHY_ANCHOR, (log) => {
  const r = assessEng(log, CFG); // no windowSize
  console.log(`\n--- A4 / windowSize absent ---`);
  console.log(`  ${r.diagnostics?.windowNote}`);
  check("A4: absent windowSize -> windows NOT PRODUCED and said so", () => {
    assert.strictEqual(r.diagnostics?.windows, null);
    assert.ok(r.diagnostics?.windowNote.includes("NOT PRODUCED"));
  });
});

// ══ D5 — blind paths, one test per class ═════════════════════════════════════

console.log("\n══ D5 · blind paths ══════════════════════════════════════════");

// class: BROKEN_CHAIN — on a DURABLE chain, so the load state is LOADED_VERIFIED
// and BROKEN_CHAIN is unambiguously the reason.
withDurable(HEALTHY_ANCHOR, (log) => {
  assert.strictEqual(log.getLoadState(), "LOADED_VERIFIED");
  log.getAll()[17].outcome = "silently_rewritten";
  const r = assessEng(log, CFG);
  report("BLIND / broken chain (load state still LOADED_VERIFIED)", r.verdict);
  check("[BROKEN_CHAIN] tampered entry -> CANNOT_ASSESS, not a load-state artefact", () => {
    assert.strictEqual(log.getLoadState(), "LOADED_VERIFIED");
    assert.deepStrictEqual(blindClasses(r.verdict), ["BROKEN_CHAIN"]);
  });
});

// class: NON_CLEAN_LOAD_STATE (absent file)
{
  const p = freshPath();
  try {
    const log = new MicaFixtureLog({ path: p });
    const r = assessEng(log, CFG);
    report("BLIND / load state FIRST_BOOT_OR_ERASED", r.verdict);
    check("[NON_CLEAN_LOAD_STATE] FIRST_BOOT_OR_ERASED -> CANNOT_ASSESS", () => {
      assert.strictEqual(log.getLoadState(), "FIRST_BOOT_OR_ERASED");
      assert.deepStrictEqual(blindClasses(r.verdict), ["NON_CLEAN_LOAD_STATE"]);
    });
  } finally {
    rmSync(p, { force: true });
  }
}

// class: NON_CLEAN_LOAD_STATE (unparseable file — chain loads empty, so
// verify() is VALID and the load state is the only thing that catches it)
{
  const p = freshPath();
  try {
    writeFileSync(p, "{not json at all\n", "utf8");
    const log = new MicaFixtureLog({ path: p });
    const r = assessEng(log, CFG);
    report("BLIND / load state CANNOT_VERIFY", r.verdict);
    check("[NON_CLEAN_LOAD_STATE] CANNOT_VERIFY with a VALID verify() -> CANNOT_ASSESS", () => {
      assert.strictEqual(log.getLoadState(), "CANNOT_VERIFY");
      assert.strictEqual(log.verify().valid, true); // nothing loaded, so trivially valid
      assert.deepStrictEqual(blindClasses(r.verdict), ["NON_CLEAN_LOAD_STATE"]);
    });
  } finally {
    rmSync(p, { force: true });
  }
}

// class: INSUFFICIENT_SAMPLE
withDurable(specs(10, (i) => `verdict_class_${i % CLASSES.length}`), (log) => {
  const r = assessEng(log, CFG);
  report("BLIND / insufficient sample", r.verdict);
  check("[INSUFFICIENT_SAMPLE] fewer entries than injected minimum -> CANNOT_ASSESS", () => {
    assert.deepStrictEqual(blindClasses(r.verdict), ["INSUFFICIENT_SAMPLE"]);
  });
});

// class: MISSING_CONFIGURATION
withDurable(FLATTENED, (log) => {
  // T11 injected here so each of these isolates the ONE field it names. Without
  // it every row below would also be missing coverage, and a test called
  // "absent threshold" would be passing for two reasons at once.
  const noThreshold = assessEng(log, {
    readableLoadStates: GATE, minimumSampleSize: 30, minimumClassCoverage: 3,
  });
  const noMinimum = assessEng(log, {
    readableLoadStates: GATE, structureThreshold: 0.2, minimumClassCoverage: 3,
  });
  const nothing = assessEng(log, { readableLoadStates: GATE });
  report("BLIND / no structureThreshold", noThreshold.verdict);
  report("BLIND / no minimumSampleSize", noMinimum.verdict);
  report("BLIND / no configuration at all", nothing.verdict);
  check("[MISSING_CONFIGURATION] absent threshold -> CANNOT_ASSESS, not a default", () => {
    assert.deepStrictEqual(blindClasses(noThreshold.verdict), ["MISSING_CONFIGURATION"]);
  });
  check("[MISSING_CONFIGURATION] absent minimum sample -> CANNOT_ASSESS", () => {
    assert.deepStrictEqual(blindClasses(noMinimum.verdict), ["MISSING_CONFIGURATION"]);
  });
  // T11 made this THREE. The count is the point of the test — every absent
  // floor is named separately, so a deployer reading the refusal learns how many
  // things they still owe, not merely that something is missing.
  check("[MISSING_CONFIGURATION] no config -> CANNOT_ASSESS naming all three", () => {
    assert.deepStrictEqual(blindClasses(nothing.verdict), [
      "MISSING_CONFIGURATION",
      "MISSING_CONFIGURATION",
      "MISSING_CONFIGURATION",
    ]);
  });
  check("NaN threshold is not accepted as an injected number", () => {
    const r = assessEng(log, {
      readableLoadStates: GATE, structureThreshold: NaN, minimumSampleSize: 30,
      minimumClassCoverage: 3,
    });
    assert.deepStrictEqual(blindClasses(r.verdict), ["MISSING_CONFIGURATION"]);
  });
});

// class: INELIGIBLE_SCOPE (one event class)
{
  const single: Spec[] = [];
  for (let i = 0; i < 60; i++) {
    single.push({
      moduleId: "m3",
      eventType: "canary_check",
      outcome: `outcome_${i % 4}`,
      timestamp: T0 + i,
    });
  }
  withDurable(single, (log) => {
    const r = assessEng(log, CFG);
    report("BLIND / one event class", r.verdict);
    check("[INELIGIBLE_SCOPE] a single event class -> CANNOT_ASSESS", () => {
      assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"]);
    });
  });
}

// class: INELIGIBLE_SCOPE (every class occurs exactly once)
{
  const singletons: Spec[] = [];
  for (let i = 0; i < 40; i++) {
    singletons.push({
      moduleId: `m${i}`,
      eventType: `event_${i}`,
      outcome: `outcome_${i % 3}`,
      timestamp: T0 + i,
    });
  }
  withDurable(singletons, (log) => {
    const r = assessEng(log, CFG);
    report("BLIND / every event class a singleton", r.verdict);
    check("[INELIGIBLE_SCOPE] no class recurs -> CANNOT_ASSESS", () => {
      assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"]);
    });
  });
}

// ── the three verdicts must be distinguishable in PRINTED output ─────────────
withDurable(FLATTENED, (alarmLog) => {
  withDurable(HEALTHY_ANCHOR, (silentLog) => {
    withDurable(specs(10, () => "x"), (blindLog) => {
      const a = assessEng(alarmLog, CFG).verdict;
      const s = assessEng(silentLog, CFG).verdict;
      const c = assessEng(blindLog, CFG).verdict;
      check("ALARM / SILENT / CANNOT_ASSESS are distinct in rendered output", () => {
        assert.ok(renderVerdict(a).includes("VERDICT: ALARM"));
        assert.ok(renderVerdict(s).includes("VERDICT: SILENT"));
        assert.ok(renderVerdict(c).includes("VERDICT: CANNOT_ASSESS"));
        assert.notStrictEqual(renderVerdict(a), renderVerdict(s));
        assert.notStrictEqual(renderVerdict(s), renderVerdict(c));
      });
    });
  });
});

// ══ D8 — claim-must-fail: SEVERANCE ══════════════════════════════════════════

console.log("\n══ D8 · severance ════════════════════════════════════════════");

withDurable(FLATTENED, (log) => {
  const before = assessEng(log, CFG);
  report("SEVERANCE step 1 / intact chain", before.verdict, statLine(before));
  check("severance step 1: intact chain yields a real reading (ALARM)", () => {
    assert.strictEqual(before.verdict.kind, "ALARM");
    assert.strictEqual(log.verify().valid, true);
  });

  log.getAll()[42].outcome = "rewritten_after_the_fact";
  check("severance step 2: the dependency is actually severed", () => {
    assert.strictEqual(log.verify().valid, false);
  });

  const after = assessEng(log, CFG);
  report("SEVERANCE step 3 / severed chain", after.verdict);
  check("severance step 4: verdict FALLS from ALARM to CANNOT_ASSESS", () => {
    assert.strictEqual(after.verdict.kind, "CANNOT_ASSESS");
    assert.deepStrictEqual(blindClasses(after.verdict), ["BROKEN_CHAIN"]);
  });
  check("severance: the sensor does NOT keep reading a severed chain", () => {
    assert.strictEqual(after.structure, undefined);
    assert.strictEqual(after.diagnostics, undefined);
  });
});

withDurable(HEALTHY_ANCHOR, (log) => {
  const before = assessEng(log, CFG);
  check("severance-2 step 1: configured sensor yields a real reading (SILENT)", () => {
    assert.strictEqual(before.verdict.kind, "SILENT");
  });
  const after = assessEng(log, { readableLoadStates: GATE, });
  report("SEVERANCE-2 / configuration removed", after.verdict);
  check("severance-2 step 4: verdict FALLS from SILENT to CANNOT_ASSESS", () => {
    assert.strictEqual(after.verdict.kind, "CANNOT_ASSESS");
  });
});

// ══ D2 — the forbidden read ══════════════════════════════════════════════════
//
// CHANGED IN KIND, AND THE CHANGE IS NOT NOTHING. This test used to put wildly
// different content in ILAS's `parameters` bag and show the verdict not move.
// MICA's declared record has no `parameters` field and never did, so there is
// no such bag to fill. What is exercised now is the fixture's `undeclared`
// content: written to the file, covered by the fixture's hash, and outside the
// shape MICA declares — so no sensor has a typed path to it.
//
// Narrower than it was in one respect: it no longer demonstrates indifference
// to a field a real system actually writes. Wider in another: `parameters` is
// now unreachable by construction rather than by discipline.

{
  const plain = HEALTHY_ANCHOR;
  const pathA = freshPath();
  const pathB = freshPath();
  try {
    const a = new MicaFixtureLog({ path: pathA });
    const b = new MicaFixtureLog({ path: pathB });
    for (let i = 0; i < plain.length; i++) {
      const s = plain[i];
      const common = {
        timestamp: s.timestamp,
        moduleId: s.moduleId,
        eventType: s.eventType,
        outcome: s.outcome,
      };
      a.append({ ...common });
      b.append({
        ...common,
        undeclared: { verdict: `class_${i % 3}`, i, deep: { x: i } },
      });
    }
    const la = new MicaFixtureLog({ path: pathA });
    const lb = new MicaFixtureLog({ path: pathB });
    check("D2: identical declared fields + wildly different UNDECLARED content -> identical verdict", () => {
      const va = assessEng(la, CFG);
      const vb = assessEng(lb, CFG);
      assert.strictEqual(va.verdict.kind, vb.verdict.kind);
      assert.strictEqual(va.verdict.summary, vb.verdict.summary);
      assert.strictEqual(va.structure?.ami, vb.structure?.ami);
    });
  } finally {
    rmSync(pathA, { force: true });
    rmSync(pathB, { force: true });
  }
}

// ══ D1 — A LOG OF THE DECLARED SHAPE, ACROSS A RESTART ═══════════════════════
//
// ⚠ THIS TEST'S CLAIM HAS BEEN NARROWED, AND THE OLD WORDING IS NOT KEPT.
//
// It used to construct a live ILAS node, let that node write its own chain, and
// read it back. Its evidential value WAS that dependency: it was the one place
// showing this sensor reading a chain some other system actually produced.
//
// MICA no longer takes ILAS as a dependency of any kind, so there is no live
// node here to run. What is read below is A FIXTURE — an append-only file this
// repository writes, with this repository's own record format, through this
// repository's own log (src/mica/fixture-log.ts).
//
// WHAT THIS NOW SHOWS:      the sensor reads a log of MICA's declared shape,
//                           across a real write / teardown / reload cycle, and
//                           returns a typed verdict.
// WHAT IT NO LONGER SHOWS:  that the sensor reads a chain a real system wrote.
//                           NOTHING IN THIS REPOSITORY SHOWS THAT ANY MORE.
//
// It is a fixture. It is not equivalent to, as good as, or a stand-in for a
// real chain. The A1 first-run cost below is still demonstrated rather than
// described, because that is a property of the readability gate and the gate is
// unchanged.

console.log("\n══ D1 · a log of the declared shape, across a restart ════════");

/**
 * An invented trace. The module and event names are plausible-looking and mean
 * nothing: no system produced them, and they are not a model of one.
 */
const D1_FIXTURE_SPECS: readonly Spec[] = [
  { moduleId: "mA", eventType: "resource_registered", outcome: "registered", timestamp: T0 + 0 },
  { moduleId: "mA", eventType: "resource_registered", outcome: "registered", timestamp: T0 + 5 },
  { moduleId: "mA", eventType: "resource_registered", outcome: "registered", timestamp: T0 + 9 },
  { moduleId: "mB", eventType: "threshold_declared", outcome: "declared", timestamp: T0 + 14 },
  { moduleId: "mB", eventType: "threshold_declared", outcome: "declared", timestamp: T0 + 20 },
  { moduleId: "mC", eventType: "outbound_checked", outcome: "match_found", timestamp: T0 + 27 },
  { moduleId: "mB", eventType: "threshold_declared", outcome: "change_recorded", timestamp: T0 + 33 },
];

{
  const p = freshPath();
  try {
    // ── run 1: a first run with no prior file on disk ─────────────────────────
    const first = new MicaFixtureLog({ path: p });
    appendAll(first, D1_FIXTURE_SPECS);

    const firstRead = assessEng(first, { ...CFG, minimumSampleSize: 5 });
    report("FIXTURE log, FIRST RUN (no prior file)", firstRead.verdict);
    check("D1/A1: a node on its FIRST RUN cannot be read — the accepted cost, shown", () => {
      assert.strictEqual(first.getLoadState(), "FIRST_BOOT_OR_ERASED");
      assert.deepStrictEqual(blindClasses(firstRead.verdict), ["NON_CLEAN_LOAD_STATE"]);
    });

    // ── run 2: the same file, reopened — the restart the gate demands ─────────
    const second = new MicaFixtureLog({ path: p });
    const realCfg: EngConfig = { ...CFG, minimumSampleSize: 5 };
    const r = assessEng(second, realCfg);
    report("FIXTURE log, AFTER RESTART", r.verdict, statLine(r));
    printDiagnostics(r);
    const seen = new Set(
      second.getAll().map((e: MicaLogRecord) => `${e.moduleId}/${e.eventType}`)
    );
    console.log(`  event classes present: ${[...seen].sort().join(", ")}`);

    check("D1: reads a FIXTURE log of the declared shape and returns a typed verdict — NOT evidence of reading a real chain", () => {
      assert.strictEqual(second.getLoadState(), "LOADED_VERIFIED");
      assert.ok(second.length > 0);
      assert.strictEqual(second.verify().valid, true);
      assert.ok(["ALARM", "SILENT", "CANNOT_ASSESS"].includes(r.verdict.kind));
    });
  } finally {
    rmSync(p, { force: true });
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

rmSync(root, { recursive: true, force: true });

// ══ T11 · OBSERVED CLASS COVERAGE ═══════════════════════════════════════════
//
// Ticket T11-eng-observed-coverage. The rule: at least k distinct observed
// classes must EACH carry at least k events, k injected, no default.
//
// ⛔ THE FAILURE THAT MATTERS IS THE FALSE HOLD, and it is first below, because
//    it is the one that looks like diligence. A rule that refuses a chain it
//    should have read is not being careful; it is being wrong in the direction
//    nobody audits.
{
  // EXACTLY at the rule: 3 classes × 3 events = 9, plus filler in those same
  // classes to clear minimumSampleSize. Nothing here is thin.
  const ample: Spec[] = [];
  for (let i = 0; i < 36; i++) {
    ample.push({
      moduleId: `m${i % 3}`,
      eventType: `event_${i % 3}`,
      outcome: `outcome_${i % 2}`,
      timestamp: T0 + i,
    });
  }
  withDurable(ample, (log) => {
    const r = assessEng(log, CFG);
    report("T11 / 3 classes each with 12 events", r.verdict);
    check("[T11] a chain whose observed classes are ALL >= k is NOT held", () => {
      // ⚠ ASSERTED ON `kind` DIRECTLY, NOT THROUGH blindClasses(): that helper
      //   asserts the verdict IS a CANNOT_ASSESS before reading its classes, so
      //   calling it here would throw on exactly the outcome this test wants —
      //   a chain that was READ. (It did, on the first run of this test, and the
      //   sensor was right while the assertion was wrong.)
      //
      //   What the reading turns out to BE is not this test's business. This
      //   fixture happens to ALARM, and that is a real reading of a real table;
      //   the claim here is only that coverage did not stand in the way of one.
      assert.notStrictEqual(
        r.verdict.kind, "CANNOT_ASSESS",
        `3 classes of 12 events each clears k=3 and must be READ, not held: ` +
        JSON.stringify(r.verdict)
      );
    });
  });

  // Two fat classes and one singleton: 2 classes qualify, 3 are required.
  const thin: Spec[] = [];
  for (let i = 0; i < 40; i++) {
    thin.push({ moduleId: `m${i % 2}`, eventType: `event_${i % 2}`,
                outcome: `outcome_${i % 2}`, timestamp: T0 + i });
  }
  thin.push({ moduleId: "rare", eventType: "event_rare", outcome: "outcome_0", timestamp: T0 + 99 });
  withDurable(thin, (log) => {
    const r = assessEng(log, CFG);
    report("T11 / 2 fat classes + 1 singleton", r.verdict);
    check("[T11] below the coverage floor -> CANNOT_ASSESS (INSUFFICIENT_SAMPLE)", () => {
      assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
      assert.deepStrictEqual(blindClasses(r.verdict), ["INSUFFICIENT_SAMPLE"]);
    });
    check("[T11] the refusal says the ROW COUNT is not what is short", () => {
      const said = JSON.stringify(r.verdict);
      assert.ok(said.includes("class variety"),
        `the detail must name class variety, not sample size: ${said}`);
    });
  });

  // ⛔ THE PLACEMENT CONDITION OF THE TICKET, asserted rather than trusted.
  const single: Spec[] = [];
  for (let i = 0; i < 40; i++) {
    single.push({ moduleId: "m0", eventType: "event_0",
                  outcome: `outcome_${i % 3}`, timestamp: T0 + i });
  }
  withDurable(single, (log) => {
    const r = assessEng(log, CFG);
    check("[T11] a SINGLE class still reports INELIGIBLE_SCOPE, not insufficient coverage", () => {
      assert.deepStrictEqual(blindClasses(r.verdict), ["INELIGIBLE_SCOPE"],
        "arity is checked before coverage: a coarser refusal must not mask a truer one");
    });
  });

  // No default: absent k refuses, exactly as the other two floors do.
  withDurable(ample, (log) => {
    const r = assessEng(log, {
      readableLoadStates: GATE, structureThreshold: 0.2, minimumSampleSize: 30,
    });
    report("BLIND / no minimumClassCoverage", r.verdict);
    check("[T11] absent k -> CANNOT_ASSESS (MISSING_CONFIGURATION), never a default", () => {
      assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
      assert.ok(blindClasses(r.verdict).includes("MISSING_CONFIGURATION"),
        JSON.stringify(r.verdict));
    });
    const zero = assessEng(log, { ...CFG, minimumClassCoverage: 0 });
    check("[T11] k = 0 is not a number this rule accepts", () => {
      assert.ok(blindClasses(zero.verdict).includes("MISSING_CONFIGURATION"),
        JSON.stringify(zero.verdict));
    });
  });

  // ── T13 / CODEX F1 · DISTINCT CLASSES MUST NOT COLLAPSE ──────────────────
  //
  // ⛔ THE DEFECT THIS PINS SHIPPED IN f7800c6, AND A COLD READ FOUND IT. Eng's
  //    class key joined the pair with U+0000 under a comment asserting NUL
  //    "cannot occur inside a JSON-sourced identifier". `moduleId` and
  //    `eventType` are unrestricted strings on MicaLogRecord, JSON admits
  //    \u0000, and nothing on the readable-log boundary excludes it — so two
  //    LEGAL distinct pairs keyed to one class and the coverage count said two
  //    where three were present.
  //
  // ⚠ THE FIXTURE IS CODEX'S COUNTEREXAMPLE VERBATIM: nine records, three
  //   genuine classes, three events each, k = 3. Under the granted rule it
  //   READS; under the collapsing key it was refused for insufficient coverage.
  {
    const NUL = "\u0000";
    const pairs: readonly [string, string][] = [
      ["a", `b${NUL}c`],
      [`a${NUL}b`, "c"],
      ["m", "e"],
    ];
    const collide: Spec[] = [];
    let t = T0;
    for (const [moduleId, eventType] of pairs) {
      for (let i = 0; i < 3; i++) {
        collide.push({ moduleId, eventType, outcome: `outcome_${i}`, timestamp: t++ });
      }
    }
    withDurable(collide, (log) => {
      const r = assessEng(log, { ...CFG, minimumSampleSize: 1 });
      check("[T13/F1] two pairs sharing a prefix and a suffix are TWO classes", () => {
        // The keys themselves, so the regression names the MECHANISM and not
        // only its consequence. A delimiter-joined key makes these two equal.
        assert.notStrictEqual(
          contextTupleKey({ moduleId: "a", eventType: `b${NUL}c`, timestamp: 0, sequenceNumber: 0, outcome: "o" }),
          contextTupleKey({ moduleId: `a${NUL}b`, eventType: "c", timestamp: 0, sequenceNumber: 0, outcome: "o" }),
          "the class key collapses two distinct (moduleId, eventType) pairs"
        );
      });
      check("[T13/F1] three genuine classes of three events CLEAR k=3 and are READ", () => {
        assert.notStrictEqual(
          r.verdict.kind, "CANNOT_ASSESS",
          "coverage refused a chain that meets the floor — the class key collapsed " +
            "two legal pairs: " + JSON.stringify(r.verdict)
        );
      });
    });
  }

  // ── T14 / CODEX T13 F1 · TWO CLASSES MUST NEVER PRINT UNDER ONE NAME ──────
  //
  // ⛔ THE DEFECT T13 INTRODUCED AND THIS SUITE COULD NOT SEE. The per-class
  //    diagnostic label was built as `key.replace("\u0000", "/")` — derived from
  //    the GROUPING KEY. T13 changed the key to the shared length-prefixed
  //    encoding and left that line, so (a) ordinary labels became raw keys and
  //    (b) a NUL inside a component was rewritten to "/", colliding with a class
  //    whose component genuinely contains one.
  //
  // ⚠ AND THE FULL 43-SUITE SWEEP WAS 43/43 IDENTICAL ACROSS THAT CHANGE:
  //   NOTHING IN THE REPOSITORY ASSERTED THIS LABEL AT ALL. The defect was
  //   invisible to every test, which is why it took a cold read to find and why
  //   this case exists. A channel nobody asserts is a channel that can say
  //   anything.
  {
    const NUL = "\u0000";
    // Codex's pair: a NUL inside a component, and a DIFFERENT class whose
    // component contains the character the old display step substituted.
    const pairs: readonly [string, string][] = [
      ["a", `b${NUL}c`],
      ["a", "b/c"],
      ["m", "e"],
    ];
    const specs: Spec[] = [];
    let t = T0;
    for (const [moduleId, eventType] of pairs) {
      for (let i = 0; i < 4; i++) {
        specs.push({ moduleId, eventType, outcome: `outcome_${i % 2}`, timestamp: t++ });
      }
    }
    withDurable(specs, (log) => {
      const r = assessEng(log, { ...CFG, minimumSampleSize: 1, windowSize: 3 });
      const perClass = r.diagnostics?.perClass ?? [];
      check("[T14/F1] every per-class bucket prints a DISTINCT label", () => {
        assert.strictEqual(perClass.length, 3, `expected 3 buckets, got ${perClass.length}`);
        const labels = perClass.map((c) => c.eventClass);
        assert.strictEqual(
          new Set(labels).size, labels.length,
          "two distinct classes printed under one name: " + JSON.stringify(labels)
        );
      });
      check("[T14/F1] the label is derived from the RECORD, so it survives any key encoding", () => {
        // Asserted as a round-trip rather than against a literal: the claim is
        // that the two original components come back, not that they come back
        // in one particular spelling.
        const got = perClass
          .map((c) => JSON.parse(c.eventClass) as [string, string])
          .map(([m, e]) => `${m}\u0001${e}`)
          .sort();
        const want = pairs.map(([m, e]) => `${m}\u0001${e}`).sort();
        assert.deepStrictEqual(got, want, "the label does not carry the record's own two components");
      });
    });
  }

  // ── T13 / CODEX F2 · THE LOOSER READING, WHICH 68 GREEN TESTS DID NOT PROVE ──
  //
  // ⛔ CODEX MUTATED THE DECISION TO THE FORBIDDEN STRICTER RULE —
  //      if (qualifying < k)  ->  if (qualifying < k || qualifying !== perClass.size)
  //    — AND ALL 68 TESTS STILL PASSED. T11 forbids that reading in capitals
  //    ("at least k classes each with at least k events", NEVER "every observed
  //    class has at least k events") because one rare class would block the read
  //    forever. The suite could not tell them apart: its positive case had three
  //    fat classes and nothing else, its negative case two fat plus a singleton.
  //
  // ⚠ THIS CASE IS THE DIFFERENCE, and it is the rule accepted 2026-10-01 20:29Z:
  //   every "X and NOT Y" condition earns a mutant that implements Y. k
  //   qualifying classes AND a class below k. The granted rule READS it; the
  //   forbidden rule holds it; nothing else in this file separates them.
  {
    const looser: Spec[] = [];
    let t = T0;
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < 12; i++) {
        looser.push({ moduleId: `fat${c}`, eventType: `event_${c}`, outcome: `outcome_${i % 4}`, timestamp: t++ });
      }
    }
    // The rare class: present, observed, and BELOW the floor on purpose.
    looser.push({ moduleId: "rare", eventType: "event_rare", outcome: "outcome_0", timestamp: t++ });
    withDurable(looser, (log) => {
      const r = assessEng(log, CFG);
      check("[T13/F2] k qualifying classes AND one class below k is READ, not held", () => {
        assert.notStrictEqual(
          r.verdict.kind, "CANNOT_ASSESS",
          "one rare class blocked the read — that is the STRICTER reading T11 " +
            "forbids, because a single rare class would block it forever: " +
            JSON.stringify(r.verdict)
        );
      });
    });
  }
}

// ══ T17 · DISCLOSURE — a QUIET reading leaves its evidence behind ════════════
//
// ⛔ WHY. Eng's ALARM detail has always carried plug-in MI, E[MI], H(C) and H(O).
//    Its SILENT summary carried sampleSize, the class count and AMI, and NONE of
//    the four. So a reading that found nothing left no record of HOW, and nobody
//    could state its distance to the threshold afterwards or when it last moved.
//    That is T9's defect — F1 retains its gap only once the gap already exceeds
//    the tolerance, so a quiet run leaves no number anywhere — generalised to the
//    dependence family. It is why "since when did op3 cross its floor?" was
//    unanswerable on 2026-10-02 across 500 decisions.

console.log("\n══ T17 · margins survive a quiet verdict ═════════════════════");

check("T17: a QUIET Eng reading carries plug-in MI, E[MI], both entropies and the distinct counts", () => {
  withDurable(specs(90, (i) => (i % 4 === 0 ? "deferred" : `verdict_class_${i % 3}`)), (log) => {
    const r = assessEng(log, CFG);
    assert.strictEqual(r.verdict.kind, "SILENT");
    const st = r.structure;
    assert.ok(st !== undefined, "a SILENT Eng reading must carry its structure");
    const summary = String(r.verdict.summary);
    for (const field of ["plug-in MI=", "E[MI]=", "H(C)=", "H(O)=", "distinct outcomes"]) {
      assert.ok(summary.includes(field), `a quiet Eng summary must carry ${field}; got: ${summary}`);
    }
    // ⛔ THE SAME OBJECT THE VERDICT WAS TAKEN FROM, never a second computation.
    assert.ok(summary.includes(`plug-in MI=${st.mutualInformation.toFixed(6)}`), "printed MI must be structure.mutualInformation");
    assert.ok(summary.includes(`E[MI]=${st.expectedMutualInformation.toFixed(6)}`), "printed E[MI] must be structure.expectedMutualInformation");
    assert.ok(summary.includes(`H(C)=${st.entropyClass.toFixed(6)}`), "printed H(C) must be structure.entropyClass");
    assert.ok(summary.includes(`H(O)=${st.entropyOutcome.toFixed(6)}`), "printed H(O) must be structure.entropyOutcome");
  });
});

check("T17: Eng's AMI REPRODUCES from the disclosed fields, on the quiet path", () => {
  // AMI = (MI - E[MI]) / (max(H_class, H_outcome) - E[MI]) -- stat/ami.ts. This is
  // the property that let narrow-W's 2026-10-02 alarm be adjudicated from printed
  // output alone, and it is what makes disclosure useful rather than decorative.
  withDurable(specs(90, (i) => (i % 4 === 0 ? "deferred" : `verdict_class_${i % 3}`)), (log) => {
    const st = assessEng(log, CFG).structure;
    assert.ok(st !== undefined, "a reading must carry its structure");
    const denominator = Math.max(st.entropyClass, st.entropyOutcome) - st.expectedMutualInformation;
    const reproduced = (st.mutualInformation - st.expectedMutualInformation) / denominator;
    assert.ok(
      Math.abs(reproduced - (st.ami as number)) < 1e-12,
      `AMI must reproduce from the disclosed fields: reproduced ${reproduced}, reported ${String(st.ami)}`
    );
  });
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

