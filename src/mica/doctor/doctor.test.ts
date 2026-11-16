// ── MICA · doctor-overlay campaign — test suite ───────────────────────────────
//
// Runs under ts-node like the rest of the MICA suite. The check() harness and the
// import scanner are lifted from closure.test.ts / the sensor suites for the same
// reasons those state.
//
// Covers: history append/sequence/read-back + hash chain; the SELF-MEASUREMENT BAR
// (no sensor imports the history); latch semantics (latch, no passive clear,
// N-consecutive clear, the consecutive requirement, refusal-to-clear); the four
// overlays (healthy · the failure each exists to see · insufficient-history · config
// absent) and the report-only bar; the floor byte-identical with overlays running;
// B3 (3-strike trigger, reset on attestation, reset on non-hold, re-arm, provenance,
// not-evaluated without N).

import assert from "assert";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

import { lookAtHistoryFile, cannotSeeHistoryMessage } from "./history";
import { join } from "path";

const tmproot = mkdtempSync(join(tmpdir(), "mica-doctor-"));
let histCounter = 0;
const histPath = (): string => join(tmproot, `hist-${histCounter++}.jsonl`);

import { alarm, silent } from "../types";
import type { SensorVerdict, VerdictKind } from "../types";
import { Chokepoint, FloorTrail } from "../chokepoint";

import {
  SubstrateHistory,
  BOUND_OF_KIND,
  GUARD_READS_CARRY_NO_INSTRUCTION,
  HISTORY_IS_STILL_SINGLE_WRITER,
  MODALITY_IS_IN_THE_ENTRY_HERE,
  recordGuardResult,
  assessB6,
  assessB7,
  assessB8,
  assessB9,
  evaluateDoctorLatency,
  OVERLAY_REPORT_ONLY_BAR,
  OVERLAY_ORDINAL_HEURISTIC_CAVEAT,
  B8_D15_CAVEAT,
} from "./index";
import type { FactorReadInput, HeadCommit, Modality } from "./history";

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

// ── helpers ───────────────────────────────────────────────────────────────────

let ts = 0;
function pushRead(
  h: SubstrateHistory,
  factors: readonly FactorReadInput[],
  disposition = "RELEASE",
  execute = true
) {
  return h.record({
    timestamp: ts++,
    factors,
    floorKind: floorOf(factors),
    disposition,
    execute,
    actionId: `a${ts}`,
  });
}

/** The same non-compensatory fold guard() uses, for fixtures' floorKind. */
function floorOf(factors: readonly FactorReadInput[]): VerdictKind {
  const kinds = factors.map((f) => f.verdictKind);
  if (kinds.length === 0) return "CANNOT_ASSESS";
  if (kinds.some((k) => k === "ALARM")) return "ALARM";
  if (kinds.some((k) => k === "CANNOT_ASSESS")) return "CANNOT_ASSESS";
  return "SILENT";
}

function f(factor: string, verdictKind: VerdictKind): FactorReadInput {
  return { factor, verdictKind };
}

console.log("\n── history · append, sequence, read-back, hash chain ──────────");

check("append stamps sequence 0..n-1 and getReads reads them back in order", () => {
  const h = new SubstrateHistory();
  pushRead(h, [f("s1", "SILENT")]);
  pushRead(h, [f("s1", "ALARM")]);
  pushRead(h, [f("s1", "CANNOT_ASSESS")]);
  const reads = h.getReads();
  assert.strictEqual(reads.length, 3);
  assert.deepStrictEqual(
    reads.map((r) => r.sequenceNumber),
    [0, 1, 2]
  );
  assert.strictEqual(reads[0].health, 1);
  assert.strictEqual(reads[1].health, 0);
  assert.strictEqual(reads[1].state, "CRITICAL");
  assert.strictEqual(reads[2].state, "UNREAD");
});

check("the hash chain verifies and links previousHash", () => {
  const h = new SubstrateHistory();
  pushRead(h, [f("s1", "SILENT")]);
  pushRead(h, [f("s2", "ALARM")]);
  const v = h.verify();
  assert.ok(v.valid, `history should verify: ${JSON.stringify(v)}`);
  const recs = h.getAll();
  assert.strictEqual(recs[0].previousHash, "");
  assert.strictEqual(recs[1].previousHash, recs[0].hash);
});

check("health = min(bounds) and weakestFactors names the minimum", () => {
  const h = new SubstrateHistory();
  const { record } = pushRead(h, [
    f("s1", "SILENT"),
    f("s2", "ALARM"),
    f("s3", "SILENT"),
  ]);
  assert.strictEqual(record.health, BOUND_OF_KIND.ALARM);
  assert.deepStrictEqual([...record.weakestFactors], ["s2"]);
});

console.log("\n── the SELF-MEASUREMENT BAR · no sensor imports the history ────");

function importSpecifiers(src: string): string[] {
  const out: string[] = [];
  for (const line of src.split("\n")) {
    const structural = /^\s*(?:import\b|export\b|\}\s*from\b)/.test(line);
    const requiring = line.includes("require(");
    if (!structural && !requiring) continue;
    const re = /(?:from\s*|require\()\s*["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) out.push(m[1]);
  }
  return out;
}

const SRC = join(__dirname, "..", "..");
const SENSOR_FILES = [
  "mica/sig/index.ts",
  "mica/eng/index.ts",
  "mica/narrow-w/index.ts",
  "mica/narrow-r/index.ts",
  "mica/narrow-k/index.ts",
  "mica/chokepoint/index.ts",
  "mica/chokepoint/ledger.ts",
  "mica/chokepoint/notifier.ts",
  "mica/chokepoint/types.ts",
  "clerk/gap.ts",
];

check("no sensor (Sig/Eng/narrow-W/narrow-R/chokepoint/clerk1.gap) imports doctor/", () => {
  const offenders: string[] = [];
  for (const rel of SENSOR_FILES) {
    const src = readFileSync(join(SRC, rel), "utf8");
    for (const spec of importSpecifiers(src)) {
      if (/(^|\/)doctor(\/|$)/.test(spec)) offenders.push(`${rel} → ${spec}`);
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `a sensor reaches into the history — the residual-wiring bar is broken: ${offenders.join(", ")}`
  );
});

check("the recorder imports the chokepoint RESULT TYPE only, never a value from it", () => {
  const src = readFileSync(join(__dirname, "recorder.ts"), "utf8");
  const chokepointImports = src
    .split("\n")
    .filter((l) => /from\s*["']\.\.\/chokepoint["']/.test(l));
  assert.ok(chokepointImports.length > 0, "recorder should import the result type");
  for (const line of chokepointImports) {
    assert.ok(
      /^\s*import\s+type\b/.test(line),
      `recorder must import only TYPES from chokepoint (no value wiring into guard): ${line.trim()}`
    );
  }
});

console.log("\n── latch · F3 — no self-clear, grounded recovery, persisted transitions ──");

check("a factor touching ALARM latches, and the record stamps it + a LATCH flag", () => {
  const h = new SubstrateHistory({ clearAfterConsecutiveHealthy: 2 });
  const { record } = pushRead(h, [f("s1", "ALARM")]);
  assert.strictEqual(h.basinOf("s1"), "latched");
  assert.strictEqual(record.factors[0].trendingBasin, "latched");
  assert.ok(record.flags.includes("LATCH:s1"));
});

check("the latch does NOT clear passively — many unrelated reads leave it latched", () => {
  const h = new SubstrateHistory({ clearAfterConsecutiveHealthy: 2 });
  pushRead(h, [f("s1", "ALARM")]);
  // A pile of healthy reads of OTHER factors, and time passing, never clears s1.
  for (let i = 0; i < 50; i++) pushRead(h, [f("s2", "SILENT")]);
  assert.strictEqual(h.basinOf("s1"), "latched");
});

// ── F3 · no-self-clear: SILENT reads are candidate ground, never a clearance ──
check("F3 · N (and far more) consecutive SILENT reads NEVER self-clear the latch", () => {
  const h = new SubstrateHistory({ clearAfterConsecutiveHealthy: 3 });
  pushRead(h, [f("s1", "ALARM")]);
  for (let i = 0; i < 12; i++) pushRead(h, [f("s1", "SILENT")]); // far past N=3
  assert.strictEqual(h.basinOf("s1"), "latched", "silence is candidate ground, not a clearance");
  assert.strictEqual(h.getRecoveries().length, 0, "no clear transition was ever written");
});

// ── F3 · explicit-attestation clear: grounded recovery clears AND persists ────
check("F3 · a grounded recovery attestation CLEARS the latch and persists a RECOVERY_ATTESTATION", () => {
  const h = new SubstrateHistory({ clearAfterConsecutiveHealthy: 2 });
  pushRead(h, [f("s1", "ALARM")]);
  pushRead(h, [f("s1", "SILENT")]);
  pushRead(h, [f("s1", "SILENT")]); // candidate ground present (2 >= N=2)...
  assert.strictEqual(h.basinOf("s1"), "latched", "...but candidate ground ALONE does not clear");
  const r = h.attemptRecovery({
    timestamp: ts++,
    attesterId: "dr-independent",
    factor: "s1",
    ground: ["l0:raw-primitive-reconstruction#42"],
    modality: "OFFERED",
  });
  assert.strictEqual(r.granted, true);
  assert.strictEqual(r.cleared, true);
  assert.strictEqual(h.basinOf("s1"), "clear");
  assert.strictEqual(r.record.recordType, "RECOVERY_ATTESTATION");
  assert.strictEqual(h.getRecoveries().length, 1, "the transition is persisted, not implicit");
});

// ── F3 · ungrounded attestation → REFUSAL_TO_CLEAR persisted ──────────────────
check("F3 · an UNGROUNDED recovery attestation is refused, does NOT clear, and persists a REFUSAL_TO_CLEAR", () => {
  const h = new SubstrateHistory({ clearAfterConsecutiveHealthy: 2 });
  pushRead(h, [f("s1", "ALARM")]);
  pushRead(h, [f("s1", "SILENT")]);
  pushRead(h, [f("s1", "SILENT")]); // candidate ground present, but...
  // ...no ground refs: an attestation that carries no independent raw-primitive
  // ground is a window-scoped negative wearing an attestation's name.
  const r = h.attemptRecovery({
    timestamp: ts++,
    attesterId: "dr",
    factor: "s1",
    ground: [],
    modality: "OFFERED",
  });
  assert.strictEqual(r.granted, false);
  assert.strictEqual(r.cleared, false);
  assert.strictEqual(h.basinOf("s1"), "latched", "an ungrounded attestation holds the alarm");
  assert.strictEqual(r.record.recordType, "REFUSAL_TO_CLEAR");
  assert.strictEqual(h.getRefusals().length, 1, "the refusal is persisted for exact replay");
  assert.ok(r.detail.includes("independent") && r.detail.includes("ground"));
});

check("F3 · a grounded attestation with too few candidate healthy reads still refuses", () => {
  const h = new SubstrateHistory({ clearAfterConsecutiveHealthy: 3 });
  pushRead(h, [f("s1", "ALARM")]);
  pushRead(h, [f("s1", "SILENT")]); // only 1 < N=3
  const r = h.attemptRecovery({
    timestamp: ts++,
    attesterId: "dr",
    factor: "s1",
    ground: ["l0:x"],
    modality: "OFFERED",
  });
  assert.strictEqual(r.granted, false);
  assert.strictEqual(h.basinOf("s1"), "latched");
});

check("a non-healthy read resets the candidate-healthy run (clear needs CONSECUTIVE)", () => {
  const h = new SubstrateHistory({ clearAfterConsecutiveHealthy: 2 });
  pushRead(h, [f("s1", "ALARM")]);
  pushRead(h, [f("s1", "SILENT")]); // candidate 1
  pushRead(h, [f("s1", "CANNOT_ASSESS")]); // resets candidate to 0
  pushRead(h, [f("s1", "SILENT")]); // candidate 1 again
  const early = h.attemptRecovery({
    timestamp: ts++,
    attesterId: "dr",
    factor: "s1",
    ground: ["l0:x"],
    modality: "OFFERED",
  });
  assert.strictEqual(early.granted, false, "one healthy after a reset is < N=2");
  pushRead(h, [f("s1", "SILENT")]); // candidate 2
  const ok = h.attemptRecovery({
    timestamp: ts++,
    attesterId: "dr",
    factor: "s1",
    ground: ["l0:x"],
    modality: "OFFERED",
  });
  assert.strictEqual(ok.cleared, true);
});

// ── F3 · duplicate-factor rejection ───────────────────────────────────────────
check("F3 · duplicate factor ids in one SUBSTRATE_READ are rejected — no record, no latch change", () => {
  const h = new SubstrateHistory({ clearAfterConsecutiveHealthy: 2 });
  const before = h.length;
  const out = h.record({
    timestamp: ts++,
    factors: [f("s1", "SILENT"), f("s1", "SILENT")],
    floorKind: "SILENT",
    disposition: "RELEASE",
    execute: true,
    actionId: "dup",
  });
  assert.strictEqual(out.persisted, false);
  assert.ok(out.detail !== null && out.detail.includes("DUPLICATE_FACTOR"));
  assert.strictEqual(h.length, before, "the duplicate read did not enter the chain");
  // The doubled SILENT did not sneak two candidate increments through, either.
  pushRead(h, [f("s1", "ALARM")]);
  assert.strictEqual(h.basinOf("s1"), "latched");
});

// ── F3 · changed-config reload parity ─────────────────────────────────────────
check("F3 · a persisted clear replays under a DIFFERENT N (state is not recomputed under current config)", () => {
  const path = histPath();
  const w = new SubstrateHistory({ path, clearAfterConsecutiveHealthy: 2 });
  pushRead(w, [f("s1", "ALARM")]);
  pushRead(w, [f("s1", "SILENT")]);
  pushRead(w, [f("s1", "SILENT")]);
  const cleared = w.attemptRecovery({
    timestamp: ts++,
    attesterId: "dr",
    factor: "s1",
    ground: ["l0:x"],
    modality: "OFFERED",
  });
  assert.strictEqual(cleared.cleared, true);
  assert.strictEqual(w.basinOf("s1"), "clear");
  // Reload under a MUCH larger N: the persisted RECOVERY is replayed verbatim, not
  // re-adjudicated against the new N.
  const r = new SubstrateHistory({ path, clearAfterConsecutiveHealthy: 99 });
  assert.strictEqual(r.getLoadState(), "LOADED_VERIFIED");
  assert.strictEqual(r.basinOf("s1"), "clear", "the persisted clear replays regardless of the new N");
});

check("F3 · a latch with NO persisted clear stays latched on reload under ANY N (even N=1)", () => {
  const path = histPath();
  const w = new SubstrateHistory({ path, clearAfterConsecutiveHealthy: 2 });
  pushRead(w, [f("s2", "ALARM")]);
  for (let i = 0; i < 5; i++) pushRead(w, [f("s2", "SILENT")]);
  const r = new SubstrateHistory({ path, clearAfterConsecutiveHealthy: 1 });
  assert.strictEqual(r.getLoadState(), "LOADED_VERIFIED");
  assert.strictEqual(r.basinOf("s2"), "latched", "no persisted clear => latched under any N");
});

check("with NO clearAfterConsecutiveHealthy injected, a latch never clears and even a grounded recovery refuses", () => {
  const h = new SubstrateHistory(); // no N
  pushRead(h, [f("s1", "ALARM")]);
  for (let i = 0; i < 10; i++) pushRead(h, [f("s1", "SILENT")]);
  assert.strictEqual(h.basinOf("s1"), "latched", "no N => never clears on its own");
  const r = h.attemptRecovery({
    timestamp: ts++,
    attesterId: "dr",
    factor: "s1",
    ground: ["l0:x"],
    modality: "OFFERED",
  });
  assert.strictEqual(r.granted, false, "no N => even a grounded recovery refuses");
  assert.strictEqual(h.basinOf("s1"), "latched");
});

// ── F7 (doctor) · a recovery whose durable append fails does not clear ────────
check("F7 · a recovery whose durable append FAILS does not clear the latch (fail toward holding)", () => {
  const path = histPath();
  const seed = new SubstrateHistory({ path, clearAfterConsecutiveHealthy: 2 });
  pushRead(seed, [f("s1", "ALARM")]);
  pushRead(seed, [f("s1", "SILENT")]);
  pushRead(seed, [f("s1", "SILENT")]);
  // Reload with an appender that always throws, then attempt a grounded recovery.
  const failing = new SubstrateHistory({
    path,
    clearAfterConsecutiveHealthy: 2,
    appender: () => {
      throw new Error("history volume unmounted");
    },
  });
  assert.strictEqual(failing.basinOf("s1"), "latched");
  const r = failing.attemptRecovery({
    timestamp: ts++,
    attesterId: "dr",
    factor: "s1",
    ground: ["l0:x"],
    modality: "OFFERED",
  });
  assert.strictEqual(r.granted, true, "the grant was granted...");
  assert.strictEqual(r.persisted, false, "...but the record did not persist...");
  assert.strictEqual(r.cleared, false, "...so the latch did NOT clear");
  assert.strictEqual(failing.basinOf("s1"), "latched");
});

console.log("\n── F8 · closed-shape loading — hostile valid JSON fails to CANNOT_VERIFY ──");

// A well-formed SUBSTRATE_READ line, as a base to corrupt one field at a time.
function readLine(over: Record<string, unknown>): string {
  const base = {
    recordType: "SUBSTRATE_READ",
    sequenceNumber: 0,
    timestamp: 1,
    factors: [{ factor: "s1", verdictKind: "SILENT", bound: 1, trajectory: 1, trendingBasin: "clear" }],
    health: 1,
    floorKind: "SILENT",
    state: "NOMINAL",
    disposition: "RELEASE",
    execute: true,
    actionId: "a",
    weakestFactors: ["s1"],
    flags: [],
    // S88, 2026-08-27: the closed key set widened. Without this the fixture
    // would fail hasExactKeys for a REASON NO TEST BELOW IS ABOUT, and every
    // check in this block would go green on the wrong corruption.
    modality: "NOT_AN_INSTRUCTION",
    previousHash: "",
    hash: "h",
  };
  return JSON.stringify({ ...base, ...over }) + "\n";
}

check("F8 · a SUBSTRATE_READ with NON-ARRAY factors loads to CANNOT_VERIFY (no crash)", () => {
  const path = histPath();
  writeFileSync(path, readLine({ factors: "not-an-array" }), "utf8");
  const h = new SubstrateHistory({ path });
  assert.strictEqual(h.getLoadState(), "CANNOT_VERIFY");
  assert.strictEqual(h.length, 0);
  assert.ok((h.getLastError() ?? "").includes("schema"));
});

check("F8 · an UNKNOWN recordType is rejected, not run through a hash branch", () => {
  const path = histPath();
  writeFileSync(
    path,
    JSON.stringify({ recordType: "WHO_KNOWS", sequenceNumber: 0, timestamp: 1, previousHash: "", hash: "h" }) + "\n",
    "utf8"
  );
  assert.strictEqual(new SubstrateHistory({ path }).getLoadState(), "CANNOT_VERIFY");
});

check("F8 · a malformed factor slice (bad verdictKind enum) is rejected", () => {
  const path = histPath();
  writeFileSync(
    path,
    readLine({ factors: [{ factor: "s1", verdictKind: "NOPE", bound: 1, trajectory: 1, trendingBasin: "clear" }] }),
    "utf8"
  );
  assert.strictEqual(new SubstrateHistory({ path }).getLoadState(), "CANNOT_VERIFY");
});

check("F8 · an extra field and a wrong-typed execute are both rejected (closed shape)", () => {
  const extra = histPath();
  writeFileSync(extra, readLine({ EXTRA: 1 }), "utf8");
  assert.strictEqual(new SubstrateHistory({ path: extra }).getLoadState(), "CANNOT_VERIFY");
  const badExec = histPath();
  writeFileSync(badExec, readLine({ execute: "true" }), "utf8");
  assert.strictEqual(new SubstrateHistory({ path: badExec }).getLoadState(), "CANNOT_VERIFY");
});

check("F8 · a MISSING modality and an OFF-ENUM modality are both rejected", () => {
  // The widening is two-sided. A line written before 2026-08-27 has no
  // `modality` and no longer loads — which costs nothing, because there is no
  // such line: zero non-test construction sites existed at PRE, so no retained
  // store predates the field.
  const missing = histPath();
  const line = JSON.parse(readLine({}));
  delete (line as Record<string, unknown>).modality;
  writeFileSync(missing, JSON.stringify(line) + "\n", "utf8");
  assert.strictEqual(new SubstrateHistory({ path: missing }).getLoadState(), "CANNOT_VERIFY");

  // And a modality outside the enum is CANNOT_VERIFY, not a record carrying a
  // strange word: the canonical form hashes this value, so an unenumerated one
  // would hash cleanly and read as a declaration the vocabulary does not have.
  const offEnum = histPath();
  writeFileSync(offEnum, readLine({ modality: "MANDATORY" }), "utf8");
  assert.strictEqual(new SubstrateHistory({ path: offEnum }).getLoadState(), "CANNOT_VERIFY");
});

console.log("\n── B6 balance-read ────────────────────────────────────────────");

check("B6 healthy uniform vector reads UNIFORM; a concentrated weakness reads CONCENTRATED", () => {
  const h = new SubstrateHistory();
  pushRead(h, [f("s1", "SILENT"), f("s2", "SILENT"), f("s3", "SILENT")]);
  const uni = assessB6(h, { balanceThreshold: 0.9 });
  assert.strictEqual(uni.kind, "OVERLAY_READ");
  if (uni.kind === "OVERLAY_READ") {
    assert.strictEqual(uni.data.classification, "UNIFORM");
    assert.strictEqual(uni.data.geometricMean, 1);
  }
  const h2 = new SubstrateHistory();
  pushRead(h2, [f("s1", "SILENT"), f("s2", "SILENT"), f("s3", "ALARM")]);
  const con = assessB6(h2, { balanceThreshold: 0.9 });
  assert.ok(con.kind === "OVERLAY_READ" && con.data.classification === "CONCENTRATED");
});

check("B6 insufficient history -> CANNOT_ASSESS; config-absent still reports scalars (NOT_CLASSIFIED)", () => {
  const empty = assessB6(new SubstrateHistory(), { balanceThreshold: 0.9 });
  assert.strictEqual(empty.kind, "OVERLAY_CANNOT_ASSESS");
  const h = new SubstrateHistory();
  pushRead(h, [f("s1", "SILENT"), f("s2", "CANNOT_ASSESS")]);
  const noThr = assessB6(h);
  assert.ok(noThr.kind === "OVERLAY_READ" && noThr.data.classification === "NOT_CLASSIFIED");
});

console.log("\n── B7 fragility lens ──────────────────────────────────────────");

check("B7 max-beacon is loud on a factor at the degraded threshold, quiet on a healthy vector", () => {
  const cfg = { degradedThreshold: 0.5, proximityWindow: 0.5, curvature: 2 };
  const healthy = new SubstrateHistory();
  pushRead(healthy, [f("s1", "SILENT"), f("s2", "SILENT")]);
  const hr = assessB7(healthy, cfg);
  assert.ok(hr.kind === "OVERLAY_READ" && hr.data.maxBeacon === 0);

  const trouble = new SubstrateHistory();
  pushRead(trouble, [f("s1", "SILENT"), f("s2", "CANNOT_ASSESS")]);
  const tr = assessB7(trouble, cfg);
  assert.ok(tr.kind === "OVERLAY_READ" && tr.data.maxBeacon === 1);
  if (tr.kind === "OVERLAY_READ") assert.deepStrictEqual([...tr.data.beaconFactors], ["s2"]);
});

check("B7 config-absent -> CANNOT_ASSESS (MISSING_CONFIGURATION); empty history -> CANNOT_ASSESS", () => {
  const h = new SubstrateHistory();
  pushRead(h, [f("s1", "SILENT")]);
  const noCfg = assessB7(h);
  assert.strictEqual(noCfg.kind, "OVERLAY_CANNOT_ASSESS");
  if (noCfg.kind === "OVERLAY_CANNOT_ASSESS")
    assert.ok(noCfg.blindPaths.some((b) => b.class === "MISSING_CONFIGURATION"));
  const empty = assessB7(new SubstrateHistory(), {
    degradedThreshold: 0.5,
    proximityWindow: 0.5,
    curvature: 2,
  });
  assert.strictEqual(empty.kind, "OVERLAY_CANNOT_ASSESS");
});

console.log("\n── B8 co-collapse covariance ──────────────────────────────────");

check("B8 flags a co-declining pair and carries the D-15 caveat", () => {
  const h = new SubstrateHistory();
  // Two factors falling together, with variance in the gradient so Pearson is defined.
  const path: VerdictKind[] = ["SILENT", "CANNOT_ASSESS", "CANNOT_ASSESS", "ALARM"];
  for (const k of path) pushRead(h, [f("s1", k), f("s2", k)]);
  const r = assessB8(h, {
    covarianceWindow: 10,
    minGradientPoints: 2,
    coDeclineFloor: 0.7,
  });
  assert.strictEqual(r.kind, "OVERLAY_READ");
  if (r.kind === "OVERLAY_READ") {
    assert.strictEqual(r.data.coDeclinePairs.length, 1);
    assert.ok(r.data.pairs[0].correlation !== null && r.data.pairs[0].correlation > 0.7);
  }
  assert.ok(r.caveats.some((c) => c === B8_D15_CAVEAT), "every B8 report carries D-15");
});

check("B8 insufficient history (<3 reads) and config-absent both -> CANNOT_ASSESS", () => {
  const h = new SubstrateHistory();
  pushRead(h, [f("s1", "SILENT"), f("s2", "SILENT")]);
  const few = assessB8(h, { covarianceWindow: 10, minGradientPoints: 2 });
  assert.strictEqual(few.kind, "OVERLAY_CANNOT_ASSESS");
  const noCfg = assessB8(h);
  assert.strictEqual(noCfg.kind, "OVERLAY_CANNOT_ASSESS");
  assert.ok(noCfg.caveats.some((c) => c === B8_D15_CAVEAT), "even a blind B8 report carries D-15");
});

console.log("\n── B9 aggregate-decline ───────────────────────────────────────");

check("B9 raises an early call on a sustained decline, and none on a flat trajectory", () => {
  const cfg = { aggregateWindow: 10, slopeThreshold: -0.01, sustainSteps: 2 };
  const dec = new SubstrateHistory();
  for (const k of ["SILENT", "SILENT", "CANNOT_ASSESS", "CANNOT_ASSESS", "ALARM"] as VerdictKind[])
    pushRead(dec, [f("s1", k)]);
  const dr = assessB9(dec, cfg);
  assert.ok(dr.kind === "OVERLAY_READ" && dr.data.earlyCall === true, "sustained decline should ping");
  assert.ok(dr.kind === "OVERLAY_READ" && dr.data.slope < 0);

  const flat = new SubstrateHistory();
  for (let i = 0; i < 5; i++) pushRead(flat, [f("s1", "SILENT")]);
  const fr = assessB9(flat, cfg);
  assert.ok(fr.kind === "OVERLAY_READ" && fr.data.earlyCall === false);
});

check("B9 insufficient history (<2) and config-absent both -> CANNOT_ASSESS", () => {
  const h = new SubstrateHistory();
  pushRead(h, [f("s1", "SILENT")]);
  const few = assessB9(h, { aggregateWindow: 10, slopeThreshold: -0.01, sustainSteps: 2 });
  assert.strictEqual(few.kind, "OVERLAY_CANNOT_ASSESS");
  const noCfg = assessB9(new SubstrateHistory(), {});
  assert.strictEqual(noCfg.kind, "OVERLAY_CANNOT_ASSESS");
});

console.log("\n── the report-only bar · overlays are never a SensorVerdict ────");

check("every overlay report is DOCTOR-stream, not a VerdictKind, and carries the bar", () => {
  const h = new SubstrateHistory();
  for (const k of ["SILENT", "CANNOT_ASSESS", "ALARM"] as VerdictKind[])
    pushRead(h, [f("s1", k), f("s2", k)]);
  const reports = [
    assessB6(h, { balanceThreshold: 0.9 }),
    assessB7(h, { degradedThreshold: 0.5, proximityWindow: 0.5, curvature: 2 }),
    assessB8(h, { covarianceWindow: 10, minGradientPoints: 2, coDeclineFloor: 0.7 }),
    assessB9(h, { aggregateWindow: 10, slopeThreshold: -0.01, sustainSteps: 2 }),
  ];
  const verdictKinds = new Set<string>(["ALARM", "SILENT", "CANNOT_ASSESS"]);
  for (const r of reports) {
    assert.strictEqual(r.stream, "DOCTOR");
    assert.ok(!verdictKinds.has(r.kind), `overlay kind ${r.kind} collides with a VerdictKind`);
    assert.ok(r.caveats.includes(OVERLAY_REPORT_ONLY_BAR), "the report-only bar must ride every report");
  }
});

check("the floor is BYTE-IDENTICAL whether or not the overlays run", () => {
  const cp = new Chokepoint({
    floorTrail: new FloorTrail({ path: join(tmproot, `floor-trail-${histCounter++}.jsonl`) }),
  });
  const verdicts: SensorVerdict[] = [silent("s1", "scope"), silent("s2", "scope")];
  const before = cp.guard({ id: "a1" }, verdicts, null);

  // Record the read and run every overlay + the latency detector over the history.
  const h = new SubstrateHistory({ clearAfterConsecutiveHealthy: 2 });
  recordGuardResult(h, before, 1);
  assessB6(h, { balanceThreshold: 0.9 });
  assessB7(h, { degradedThreshold: 0.5, proximityWindow: 0.5, curvature: 2 });
  assessB8(h, { covarianceWindow: 10, minGradientPoints: 2 });
  assessB9(h, { aggregateWindow: 10 });
  evaluateDoctorLatency(h, { breachAfterConsecutive: 3 });

  const after = cp.guard({ id: "a1" }, verdicts, null);
  assert.deepStrictEqual(
    { disposition: after.disposition, execute: after.execute, floor: after.decision.floorKind },
    { disposition: before.disposition, execute: before.execute, floor: before.decision.floorKind },
    "running the overlays changed the disposition — the report-only bar is broken"
  );
});

check("recordGuardResult maps sensorIds×sensorKinds into factor slices", () => {
  const cp = new Chokepoint();
  const verdicts: SensorVerdict[] = [alarm("s1", "bad", [{ code: "X", detail: "y" }]), silent("s2", "scope")];
  const result = cp.guard({ id: "act9" }, verdicts, null);
  const h = new SubstrateHistory();
  const { record } = recordGuardResult(h, result, 42);
  assert.strictEqual(record.actionId, "act9");
  assert.strictEqual(record.timestamp, 42);
  assert.strictEqual(record.factors.length, 2);
  const s1 = record.factors.find((x) => x.factor === "s1");
  assert.ok(s1 && s1.verdictKind === "ALARM" && s1.bound === 0);
});

console.log("\n── F6 · overlay numerics are ORDINAL heuristics, not interval-scale ──");

check("F6 · every overlay report carries the ordinal-not-interval caveat", () => {
  const h = new SubstrateHistory();
  for (const k of ["SILENT", "CANNOT_ASSESS", "ALARM"] as VerdictKind[])
    pushRead(h, [f("s1", k), f("s2", k)]);
  const reports = [
    assessB6(h, { balanceThreshold: 0.9 }),
    assessB7(h, { degradedThreshold: 0.5, proximityWindow: 0.5, curvature: 2 }),
    assessB8(h, { covarianceWindow: 10, minGradientPoints: 2, coDeclineFloor: 0.7 }),
    assessB9(h, { aggregateWindow: 10, slopeThreshold: -0.01, sustainSteps: 2 }),
    // also a blind report, to prove the caveat rides CANNOT_ASSESS too
    assessB6(new SubstrateHistory(), { balanceThreshold: 0.9 }),
  ];
  for (const r of reports) {
    assert.ok(
      r.caveats.includes(OVERLAY_ORDINAL_HEURISTIC_CAVEAT),
      `overlay ${r.overlayId} (${r.kind}) is missing the ordinal caveat`
    );
  }
});

check("F6 · the ALARM/CANNOT_ASSESS conflation the caveat names is real: means collapse", () => {
  // Two ALARMs + two SILENTs share the arithmetic mean of four CANNOT_ASSESS,
  // despite entirely different failure geometry — the interval reading is false.
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const twoAlarmTwoSilent = [BOUND_OF_KIND.ALARM, BOUND_OF_KIND.ALARM, BOUND_OF_KIND.SILENT, BOUND_OF_KIND.SILENT];
  const fourCannotAssess = [BOUND_OF_KIND.CANNOT_ASSESS, BOUND_OF_KIND.CANNOT_ASSESS, BOUND_OF_KIND.CANNOT_ASSESS, BOUND_OF_KIND.CANNOT_ASSESS];
  assert.strictEqual(mean(twoAlarmTwoSilent), mean(fourCannotAssess));
  // And the caveat states this consequence in words, so a reader is warned.
  assert.ok(OVERLAY_ORDINAL_HEURISTIC_CAVEAT.includes("SAME arithmetic mean"));
  assert.ok(OVERLAY_ORDINAL_HEURISTIC_CAVEAT.includes("CONFLATE"));
});

console.log("\n── B3 · doctor-latency bound (N = injected Willkür proxy) ──────");

function holdHistory(): SubstrateHistory {
  return new SubstrateHistory();
}

check("3 consecutive un-attested HOLDs with N=3 trips exactly one breach at the 3rd", () => {
  const h = holdHistory();
  pushRead(h, [f("s1", "ALARM")], "HOLD", false);
  pushRead(h, [f("s1", "ALARM")], "HOLD", false);
  pushRead(h, [f("s1", "ALARM")], "HOLD", false);
  const r = evaluateDoctorLatency(h, { breachAfterConsecutive: 3 });
  assert.ok(r.evaluated);
  assert.strictEqual(r.breaches.length, 1);
  assert.strictEqual(r.breaches[0].atSequence, 2);
  assert.ok(r.breaches[0].detail.includes("Willkür"), "provenance must be printed on the breach");
});

check("a recorded doctor attestation RESETS the consecutive-hold count", () => {
  const h = holdHistory();
  pushRead(h, [f("s1", "ALARM")], "HOLD", false);
  pushRead(h, [f("s1", "ALARM")], "HOLD", false);
  h.recordAttestation({
    timestamp: ts++,
    attesterId: "dr",
    note: "looked",
    modality: "OFFERED",
  });
  pushRead(h, [f("s1", "ALARM")], "HOLD", false);
  pushRead(h, [f("s1", "ALARM")], "HOLD", false);
  const r = evaluateDoctorLatency(h, { breachAfterConsecutive: 3 });
  assert.strictEqual(r.breaches.length, 0, "attestation should have reset the run");
  assert.strictEqual(r.openConsecutiveHolds, 2);
});

check("a non-HOLD read (RELEASE) breaks the consecutive run", () => {
  const h = holdHistory();
  pushRead(h, [f("s1", "ALARM")], "HOLD", false);
  pushRead(h, [f("s1", "ALARM")], "HOLD", false);
  pushRead(h, [f("s1", "SILENT")], "RELEASE", true);
  pushRead(h, [f("s1", "ALARM")], "HOLD", false);
  pushRead(h, [f("s1", "ALARM")], "HOLD", false);
  const r = evaluateDoctorLatency(h, { breachAfterConsecutive: 3 });
  assert.strictEqual(r.breaches.length, 0);
});

check("six consecutive holds with N=3 re-arm and trip two breaches", () => {
  const h = holdHistory();
  for (let i = 0; i < 6; i++) pushRead(h, [f("s1", "ALARM")], "HOLD_BLIND", false);
  const r = evaluateDoctorLatency(h, { breachAfterConsecutive: 3 });
  assert.strictEqual(r.breaches.length, 2);
  assert.deepStrictEqual(
    r.breaches.map((b) => b.atSequence),
    [2, 5]
  );
});

check("no N injected -> not evaluated, and the Willkür provenance is stated", () => {
  const h = holdHistory();
  pushRead(h, [f("s1", "ALARM")], "HOLD", false);
  const r = evaluateDoctorLatency(h);
  assert.strictEqual(r.evaluated, false);
  assert.strictEqual(r.breaches.length, 0);
  assert.ok(r.summary.includes("Willkür"));
});

// ══════════════════════════════════════════════════════════════════════════════
// S88 · THE ANCHOR — the doctor's book gains a way to commit its head
//
// The chain was always here. What it lacked was any claim held outside this
// process. These check the seam and its two ceilings: post-durable only,
// try/caught, never a gate — and the gap the build leaves open, in words.

console.log("\n── S88 · the doctor's anchor ──────────────────────────────────");

check("S88-DR-A · an attestation commits a head carrying THAT act's modality", () => {
  const commits: {
    seq_no: number;
    ts: number;
    witness_set_id: string;
    modality: string;
    head_hash: string;
  }[] = [];
  const h = new SubstrateHistory({
    path: histPath(),
    witnessSetId: "set-alpha",
    headCommitter: (c) => commits.push(c),
  });
  const out = h.recordAttestation({
    timestamp: 1_700_000_000_000,
    attesterId: "dr",
    note: "looked",
    modality: "IMPOSED",
  });

  assert.strictEqual(out.persisted, true);
  assert.strictEqual(out.headCommitted, true);
  assert.strictEqual(out.headCommitDetail, null);
  assert.deepStrictEqual(commits, [
    {
      seq_no: 0,
      // The record's own sequence number, NOT the injected read clock. This
      // book authors no wall clock about itself; `timestamp` is the caller's.
      ts: 0,
      witness_set_id: "set-alpha",
      modality: "IMPOSED",
      // The committed head IS this book's entry hash — that is the anchor.
      head_hash: out.record.hash,
    },
  ]);
  // And the RECORD still carries the read clock its caller injected — the two
  // times are different facts and neither is derived from the other.
  assert.strictEqual(out.record.timestamp, 1_700_000_000_000);
});

check("S88-DR-B · the modality is PER APPEND — two acts, two declarations", () => {
  const commits: string[] = [];
  const h = new SubstrateHistory({
    path: histPath(),
    headCommitter: (c) => commits.push(c.modality),
  });
  h.recordAttestation({ timestamp: 1, attesterId: "dr", note: "a", modality: "OFFERED" });
  h.recordAttestation({ timestamp: 2, attesterId: "dr", note: "b", modality: "IMPOSED" });
  assert.deepStrictEqual(commits, ["OFFERED", "IMPOSED"]);
});

check("S88-DR-C · the SUBSTRATE_READ glue declares the MACHINE value, always", () => {
  // `recordGuardResult` appends what guard() already composed. No human handed
  // it an instruction, so the honest declaration is the same one every time —
  // and it is a constant in the recorder, not a parameter a caller can vary.
  assert.strictEqual(GUARD_READS_CARRY_NO_INSTRUCTION, "NOT_AN_INSTRUCTION");
  const commits: string[] = [];
  const h = new SubstrateHistory({
    path: histPath(),
    headCommitter: (c) => commits.push(c.modality),
  });
  const chokepoint = new Chokepoint({});
  const result = chokepoint.guard({ id: "act-s88" }, [silent("s1", "the S88 scope")], null);
  const out = recordGuardResult(h, result, 1_700_000_000_000);

  assert.strictEqual(out.persisted, true);
  assert.strictEqual(out.headCommitted, true);
  assert.deepStrictEqual(commits, ["NOT_AN_INSTRUCTION"]);
});

check("S88-DR-D · POST-DURABLE ONLY — a failed append commits NO head", () => {
  const commits: unknown[] = [];
  const h = new SubstrateHistory({
    path: histPath(),
    headCommitter: (c) => commits.push(c),
    appender: () => {
      throw new Error("ENOSPC");
    },
  });
  const out = h.recordAttestation({
    timestamp: 1,
    attesterId: "dr",
    note: "unheld",
    modality: "OFFERED",
  });

  assert.strictEqual(out.persisted, false);
  assert.strictEqual(out.headCommitted, false);
  assert.deepStrictEqual(commits, [], "a head over a record that never landed names nothing");
  assert.ok((out.headCommitDetail ?? "").includes("not durably persisted"));
});

check("S88-DR-E · a committer that THROWS leaves the book untouched, reason retained", () => {
  const h = new SubstrateHistory({
    path: histPath(),
    headCommitter: () => {
      throw new Error("the intake was never deployed");
    },
  });
  const out = h.recordAttestation({
    timestamp: 1,
    attesterId: "dr",
    note: "kept anyway",
    modality: "OFFERED",
  });

  assert.strictEqual(out.persisted, true, "the append stands; the witness is not a gate");
  assert.strictEqual(out.headCommitted, false);
  assert.ok((out.headCommitDetail ?? "").includes("never deployed"));
  assert.strictEqual(h.getAll().length, 1);
  assert.deepStrictEqual(h.verify(), { valid: true, brokenAt: null });
});

check("S88-DR-F · a REFUSAL commits a head too — the refusal trail is not quieter", () => {
  // A refused clearance is still an act the doctor performed under a modality.
  // Suppressing the head on refusals would make the refusal trail thinner than
  // the grant trail, which is backwards for an instrument built to be loud
  // about refusals.
  const commits: { seq_no: number; modality: string }[] = [];
  const h = new SubstrateHistory({
    path: histPath(),
    clearAfterConsecutiveHealthy: 2,
    headCommitter: (c) => commits.push({ seq_no: c.seq_no, modality: c.modality }),
  });
  const out = h.attemptRecovery({
    timestamp: 1,
    attesterId: "dr",
    factor: "s1",
    ground: [],
    modality: "IMPOSED",
  });

  assert.strictEqual(out.granted, false);
  assert.strictEqual(out.record.recordType, "REFUSAL_TO_CLEAR");
  assert.strictEqual(out.headCommitted, true);
  assert.deepStrictEqual(commits, [{ seq_no: 0, modality: "IMPOSED" }]);
});

check("S88-DR-G · a REJECTED substrate read commits NO head and says why", () => {
  // A duplicate-factor read is rejected before any append. There is no record on
  // disk, so there is no head to name — and the outcome says that in words
  // rather than reporting a silent false.
  const commits: unknown[] = [];
  const h = new SubstrateHistory({
    path: histPath(),
    headCommitter: (c) => commits.push(c),
  });
  const out = h.record({
    timestamp: 1,
    factors: [f("s1", "SILENT"), f("s1", "SILENT")],
    floorKind: "SILENT",
    disposition: "RELEASE",
    execute: true,
    actionId: "dupe",
  });

  assert.strictEqual(out.persisted, false);
  assert.ok((out.detail ?? "").includes("DUPLICATE_FACTOR"));
  assert.strictEqual(out.headCommitted, false);
  assert.ok((out.headCommitDetail ?? "").includes("before any append"));
  assert.deepStrictEqual(commits, []);
});

check("S88-DR-H · UNWIRED is exactly today's behaviour, reported and not implied", () => {
  const h = new SubstrateHistory({ path: histPath() });
  const out = h.recordAttestation({
    timestamp: 1,
    attesterId: "dr",
    note: "n",
    modality: "OFFERED",
  });
  assert.strictEqual(out.persisted, true);
  assert.strictEqual(out.headCommitted, false);
  assert.strictEqual(out.headCommitDetail, null, "null means UNWIRED, not failed");
});

check("S88-DR-I · the ceiling FLIPPED — it asserted the gap, it now asserts the closure", () => {
  // Until 2026-08-27 this check read MODALITY_IS_STAMP_SIDE_HERE and asserted
  // the strings "does not enter" and "NO retained trace" — the gap, in the
  // book's own words. The arbiter closed it (S88, 2026-08-27), so the assertion is
  // inverted rather than deleted: the same check now fails if the closure ever
  // silently regresses to a stamp-side modality.
  assert.ok(MODALITY_IS_IN_THE_ENTRY_HERE.includes("is a FIELD of all four"));
  assert.ok(MODALITY_IS_IN_THE_ENTRY_HERE.includes("RETAINED trace"));
  // And the replacement still carries what it replaced, dated, so the change
  // stays legible rather than being quietly deleted.
  assert.ok(MODALITY_IS_IN_THE_ENTRY_HERE.includes("MODALITY_IS_STAMP_SIDE_HERE"));
  assert.ok(MODALITY_IS_IN_THE_ENTRY_HERE.includes("2026-08-26 and 2026-08-27"));
  // What the closure does NOT buy is still printed beside it.
  assert.ok(MODALITY_IS_IN_THE_ENTRY_HERE.includes("does NOT"));
  // And the S83 single-writer fact is still true, and still printed.
  assert.ok(HISTORY_IS_STILL_SINGLE_WRITER.includes("fork"));
  assert.ok(HISTORY_IS_STILL_SINGLE_WRITER.includes("not that it"));
});

// ══════════════════════════════════════════════════════════════════════════════
// S88 · THE BOOK RETAINS ITS OWN DECLARED MODALITY (The arbiter, 2026-08-27)
//
// The anchor above put the declaration on the committed HEAD. The intake is
// last-writer-wins, so a head overwritten between witness sweeps took its
// declaration to the grave — nowhere in the book, nowhere witness-side. These
// checks are the closure: the modality is IN the entry, INSIDE its hash
// preimage, and the head COPIES what the entry says.

console.log("\n── S88 · the modality is in the entry ─────────────────────────");

/**
 * A store carrying ALL FOUR record kinds, in chain order:
 *
 *   0  SUBSTRATE_READ      s1 ALARM — latches s1
 *   1  DOCTOR_ATTESTATION  modality OFFERED
 *   2  REFUSAL_TO_CLEAR    no ground — the latch holds
 *   3  SUBSTRATE_READ      s1 SILENT (candidate ground 1)
 *   4  SUBSTRATE_READ      s1 SILENT (candidate ground 2)
 *   5  RECOVERY_ATTESTATION  granted, modality IMPOSED
 */
function seedAllFourKinds(path: string, committer?: (c: HeadCommit) => void): void {
  const h = new SubstrateHistory({
    path,
    clearAfterConsecutiveHealthy: 2,
    headCommitter: committer,
  });
  pushRead(h, [f("s1", "ALARM")]);
  h.recordAttestation({ timestamp: 10, attesterId: "dr", note: "looked", modality: "OFFERED" });
  h.attemptRecovery({ timestamp: 11, attesterId: "dr", factor: "s1", ground: [], modality: "OFFERED" });
  pushRead(h, [f("s1", "SILENT")]);
  pushRead(h, [f("s1", "SILENT")]);
  const ok = h.attemptRecovery({
    timestamp: 12,
    attesterId: "dr",
    factor: "s1",
    ground: ["L0-recon-9"],
    modality: "IMPOSED",
  });
  assert.strictEqual(ok.cleared, true, "the seed must reach a granted RECOVERY_ATTESTATION");
  assert.strictEqual(h.length, 6, "the seed must carry all four kinds");
}

/** Flip the declared modality of the record at `seq`, on disk, and nothing else. */
function flipModalityOnDisk(path: string, seq: number): void {
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const rec = JSON.parse(lines[seq]) as Record<string, unknown>;
  const was = rec.modality as Modality;
  rec.modality = was === "IMPOSED" ? "OFFERED" : "IMPOSED";
  lines[seq] = JSON.stringify(rec);
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
}

/** The flip test, one kind at a time: an edited declaration breaks the chain AT that seq. */
function flipBreaksAt(kind: string, seq: number): void {
  const path = histPath();
  seedAllFourKinds(path);
  // Cold, unedited, the same store loads and verifies — so the break below is
  // the edit and not the fixture.
  assert.strictEqual(new SubstrateHistory({ path }).getLoadState(), "LOADED_VERIFIED", kind);
  flipModalityOnDisk(path, seq);
  const reloaded = new SubstrateHistory({ path });
  assert.strictEqual(reloaded.getLoadState(), "CANNOT_VERIFY", kind);
  assert.ok(
    (reloaded.getLastError() ?? "").includes(`at index ${String(seq)}`),
    `${kind}: expected the break at index ${String(seq)}, got: ${String(reloaded.getLastError())}`
  );
  // The break is AT that seq, named — not merely somewhere in the file. The
  // loaded lines are still held (this store separates integrity from
  // provenance: it reports CANNOT_VERIFY rather than emptying itself), so the
  // load state is the claim and `verify()` is the coordinate.
  assert.deepStrictEqual(reloaded.verify(), { valid: false, brokenAt: seq }, kind);
}

check("S88-DR-J · SUBSTRATE_READ · a modality edited on disk BREAKS the chain at that seq", () => {
  flipBreaksAt("SUBSTRATE_READ", 0);
});

check("S88-DR-K · DOCTOR_ATTESTATION · a modality edited on disk BREAKS the chain at that seq", () => {
  flipBreaksAt("DOCTOR_ATTESTATION", 1);
});

check("S88-DR-L · REFUSAL_TO_CLEAR · a modality edited on disk BREAKS the chain at that seq", () => {
  flipBreaksAt("REFUSAL_TO_CLEAR", 2);
});

check("S88-DR-M · RECOVERY_ATTESTATION · a modality edited on disk BREAKS the chain at that seq", () => {
  flipBreaksAt("RECOVERY_ATTESTATION", 5);
});

check("S88-DR-N · the head STAMPS FROM THE ENTRY on every committing path", () => {
  // §2.3: one declaration, made once, at append. No path may survive on which
  // the stamped value and the stored value have separate sources — so on EVERY
  // committing path, including the refusal, the committed head's modality is
  // the record's own, and the committed hash is the record's own.
  const commits: HeadCommit[] = [];
  const path = histPath();
  const h = new SubstrateHistory({
    path,
    clearAfterConsecutiveHealthy: 2,
    headCommitter: (c) => commits.push(c),
  });

  const read = pushRead(h, [f("s1", "ALARM")]);
  const att = h.recordAttestation({
    timestamp: 10,
    attesterId: "dr",
    note: "looked",
    modality: "OFFERED",
  });
  const refusal = h.attemptRecovery({
    timestamp: 11,
    attesterId: "dr",
    factor: "s1",
    ground: [],
    modality: "IMPOSED",
  });
  pushRead(h, [f("s1", "SILENT")]);
  pushRead(h, [f("s1", "SILENT")]);
  const grant = h.attemptRecovery({
    timestamp: 12,
    attesterId: "dr",
    factor: "s1",
    ground: ["L0-recon-9"],
    modality: "OFFERED",
  });

  const records = [read.record, att.record, refusal.record, grant.record];
  assert.strictEqual(commits.length, 6, "every append committed a head");
  assert.strictEqual(refusal.record.recordType, "REFUSAL_TO_CLEAR");
  assert.strictEqual(grant.record.recordType, "RECOVERY_ATTESTATION");

  for (const rec of records) {
    const commit = commits.find((c) => c.seq_no === rec.sequenceNumber);
    assert.ok(commit !== undefined, `no head was committed for seq ${String(rec.sequenceNumber)}`);
    assert.strictEqual(
      commit.modality,
      rec.modality,
      `${rec.recordType}: head.modality must BE record.modality`
    );
    assert.strictEqual(commit.head_hash, rec.hash, `${rec.recordType}: the head names this entry`);
  }

  // The declarations actually differed across the paths — a test where every
  // record said the same word would pass on a hardcoded constant.
  assert.deepStrictEqual(
    records.map((r) => r.modality),
    ["NOT_AN_INSTRUCTION", "OFFERED", "IMPOSED", "OFFERED"]
  );
});

check("S88-DR-O · COLD RELOAD of a store carrying all four widened kinds", () => {
  // §4.3 / the S88-E idiom: the closed schema and the canonical form both cover
  // the new key, proved the only way that proves both at once — write the four
  // kinds, drop the process, read them back from bytes, verify the chain.
  const path = histPath();
  seedAllFourKinds(path);

  const cold = new SubstrateHistory({ path, clearAfterConsecutiveHealthy: 2 });
  assert.strictEqual(cold.getLoadState(), "LOADED_VERIFIED");
  assert.strictEqual(cold.getLastError(), null);
  assert.deepStrictEqual(cold.verify(), { valid: true, brokenAt: null });
  assert.strictEqual(cold.length, 6);

  // Each kind came back carrying the declaration it was written with.
  assert.deepStrictEqual(
    cold.getReads().map((r) => r.modality),
    ["NOT_AN_INSTRUCTION", "NOT_AN_INSTRUCTION", "NOT_AN_INSTRUCTION"]
  );
  assert.deepStrictEqual(cold.getAttestations().map((r) => r.modality), ["OFFERED"]);
  assert.deepStrictEqual(cold.getRefusals().map((r) => r.modality), ["OFFERED"]);
  assert.deepStrictEqual(cold.getRecoveries().map((r) => r.modality), ["IMPOSED"]);

  // And the latch state replayed off the reloaded chain, unchanged by the
  // widening: the RECOVERY_ATTESTATION at seq 5 still clears s1.
  assert.strictEqual(cold.basinOf("s1"), "clear");
});

check("S88-DR-P · a SUBSTRATE_READ's modality is a CONSTANT — there is no input for it", () => {
  // The check-line this build was dispatched with: the doctor's glue got a
  // constant "so no caller can claim otherwise about a read the machine took by
  // itself". That was only half true until 2026-08-27 — `SubstrateReadInput`
  // ALSO took an optional `modality`, so the constant bound only callers coming
  // through `recordGuardResult`. It is now the single source, which matters
  // because the value is retained and hashed rather than merely stamped.
  assert.strictEqual(GUARD_READS_CARRY_NO_INSTRUCTION, "NOT_AN_INSTRUCTION");
  const h = new SubstrateHistory();

  // The direct path and the glue path produce the SAME declaration.
  const direct = pushRead(h, [f("s1", "SILENT")]);
  assert.strictEqual(direct.record.modality, GUARD_READS_CARRY_NO_INSTRUCTION);

  const chokepoint = new Chokepoint({});
  const result = chokepoint.guard({ id: "act-const" }, [silent("s1", "the S88 scope")], null);
  const viaGlue = recordGuardResult(h, result, 1_700_000_000_001);
  assert.strictEqual(viaGlue.record.modality, GUARD_READS_CARRY_NO_INSTRUCTION);

  // And a caller who tries to declare otherwise is refused BY THE TYPE — the
  // field does not exist on the input, so this is a compile error and the cast
  // is what it takes to even write the attempt down. The value written is the
  // constant regardless of what was passed.
  const forced = h.record({
    timestamp: 99,
    factors: [f("s2", "SILENT")],
    floorKind: "SILENT",
    disposition: "RELEASE",
    execute: true,
    actionId: "forced",
    modality: "IMPOSED",
  } as Parameters<SubstrateHistory["record"]>[0]);
  assert.strictEqual(forced.record.modality, "NOT_AN_INSTRUCTION");
});

rmSync(tmproot, { recursive: true, force: true });


// ── SH-S103 · a look that was REFUSED is not a book that is ABSENT ─────────
//
// The class closed in `ruling-log.ts` at S98 and left open in five sibling books
// until S103. `existsSync` returns false both for "no such file" and for "not
// allowed to look"; this book read the second as the first, called it
// FIRST_BOOT_OR_ERASED, and — because `mkdirSync(..., { recursive: true })`
// SUCCEEDS on a directory that exists and cannot be entered — set itself
// persisting over content it never read.

check("SH-S103-1 · the look has three answers, and only ENOENT means absent", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-sh-look-"));
  const present = join(base, "present.jsonl");
  writeFileSync(present, "", "utf8");
  assert.deepStrictEqual(lookAtHistoryFile(present), { state: "PRESENT" });
  assert.deepStrictEqual(lookAtHistoryFile(join(base, "nope.jsonl")), { state: "ABSENT" });

  // ENAMETOOLONG: a refusal every principal reaches, uid 0 included.
  const refused = lookAtHistoryFile(join(base, "x".repeat(300)));
  assert.strictEqual(refused.state, "CANNOT_SEE", "a name too long read as merely absent");
  assert.ok(refused.state === "CANNOT_SEE" && refused.detail.includes("ENAMETOOLONG"));
  rmSync(base, { recursive: true, force: true });
});

check("SH-S103-2 · a book it CANNOT SEE loads to CANNOT_VERIFY, never to first boot", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-sh-cannotsee-"));
  const path = join(base, "x".repeat(300));
  const book = new SubstrateHistory({ path });
  assert.strictEqual(
    book.getLoadState(),
    "CANNOT_VERIFY",
    "a book this process cannot look at came up as a first boot"
  );
  const detail = book.getLastError() ?? "";
  assert.ok(detail.includes("NOT the finding that it is absent"), detail);
  assert.ok(detail.includes("nothing was recorded as a first boot"), detail);
  rmSync(base, { recursive: true, force: true });
});

check("SH-S103-3 · THE REAL SHAPE — a directory whose execute bit is stripped", () => {
  // The live instrument, and the one the mkdir defence dies on: the directory
  // EXISTS, holds a real book, and cannot be entered. `mkdirSync` recursive
  // returns cleanly here, so nothing downstream of the look would have caught it.
  //
  // A mode-based refusal cannot be built for uid 0, which is allowed to traverse
  // regardless. This body SAYS so rather than passing over a check that never
  // ran; SH-S103-1 and -2 reach the same branch by another errno for every
  // principal.
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === 0 || uid === null) {
    console.log(
      "      NOT EXERCISED as this principal: a mode-based refusal cannot be " +
        "built for uid 0. The classification and the load state are covered by " +
        "SH-S103-1..2; this body covers only the mode."
    );
    return;
  }
  const base = mkdtempSync(join(tmpdir(), "mica-sh-noexec-"));
  const dir = join(base, "book");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "book.jsonl");
  writeFileSync(path, "", "utf8");
  chmodSync(dir, 0o600); // readable, NOT searchable
  try {
    const look = lookAtHistoryFile(path);
    assert.strictEqual(look.state, "CANNOT_SEE", "a directory with no execute bit did not refuse the look");
    assert.ok(look.state === "CANNOT_SEE" && look.detail.includes("EACCES"));
    const book = new SubstrateHistory({ path });
    assert.strictEqual(book.getLoadState(), "CANNOT_VERIFY");
    assert.ok((book.getLastError() ?? "").includes("EACCES"));
  } finally {
    chmodSync(dir, 0o700);
    rmSync(base, { recursive: true, force: true });
  }
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
