// ── MICA · κ — acceptance tests, incl. the anti-remint source fence ──────────

import assert from "assert";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";

import {
  KAPPA_EXCLUDES_BASIS_FINDINGS,
  KAPPA_READS_CONSISTENCY_NOT_TRUTH,
  KappaRefused,
  readAxis,
  readKappaSignature,
  validateKappaAxisPopulation,
  validateKappaThresholds,
  type KappaAxisPopulation,
  type KappaReceivedInput,
  type KappaThresholds,
} from "./kappa";

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

const THRESH: KappaThresholds = { highFloor: 0.7, lowCeiling: 0.3 };

function pop(axis: "G2" | "G4", verdicts: readonly KappaReceivedInput[]): KappaAxisPopulation {
  return { axis, verdicts };
}

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── validateKappaAxisPopulation · closed shape ──");

check("KP-A · a well-formed population validates", () => {
  assert.strictEqual(validateKappaAxisPopulation(pop("G2", ["EXIT", "CANNOT_ASSESS"])), true);
});

check("KP-B · an unknown axis is refused", () => {
  assert.strictEqual(validateKappaAxisPopulation({ axis: "G3", verdicts: [] }), false);
});

check("KP-C · an unknown verdict string is refused", () => {
  assert.strictEqual(validateKappaAxisPopulation({ axis: "G2", verdicts: ["PASS"] }), false);
});

check("KP-D · an extra key is refused", () => {
  assert.strictEqual(validateKappaAxisPopulation({ axis: "G2", verdicts: [], extra: 1 }), false);
});

check("KP-E · non-objects are refused, not thrown on", () => {
  assert.strictEqual(validateKappaAxisPopulation(null), false);
  assert.strictEqual(validateKappaAxisPopulation("G2"), false);
  assert.strictEqual(validateKappaAxisPopulation(42), false);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── validateKappaThresholds · missing, malformed, inverted ──");

check("KT-A · a well-formed pair validates", () => {
  assert.strictEqual(validateKappaThresholds({ highFloor: 0.7, lowCeiling: 0.3 }), true);
});

check("KT-B · missing fields are refused", () => {
  assert.strictEqual(validateKappaThresholds({ highFloor: 0.7 }), false);
  assert.strictEqual(validateKappaThresholds({}), false);
});

check("KT-C · out-of-[0,1] values are refused", () => {
  assert.strictEqual(validateKappaThresholds({ highFloor: 1.2, lowCeiling: 0.3 }), false);
  assert.strictEqual(validateKappaThresholds({ highFloor: 0.7, lowCeiling: -0.1 }), false);
});

check("KT-D · an inverted or equal pair is refused (a single rate could satisfy both)", () => {
  assert.strictEqual(validateKappaThresholds({ highFloor: 0.3, lowCeiling: 0.7 }), false);
  assert.strictEqual(validateKappaThresholds({ highFloor: 0.5, lowCeiling: 0.5 }), false);
});

check("KT-E · non-finite values are refused", () => {
  assert.strictEqual(validateKappaThresholds({ highFloor: NaN, lowCeiling: 0.3 }), false);
  assert.strictEqual(validateKappaThresholds({ highFloor: Infinity, lowCeiling: 0.3 }), false);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── readAxis · tally, then read ──");

check("RA-A · unassessable strictly exceeding assessed reads UNREADABLE", () => {
  const r = readAxis(pop("G2", ["CANNOT_ASSESS", "CANNOT_ASSESS", "EXIT"]), THRESH);
  assert.strictEqual(r.state, "UNREADABLE");
});

check("RA-B · unassessable EQUAL to assessed reads, does not refuse — 'exceeds' is strict", () => {
  const r = readAxis(pop("G2", ["CANNOT_ASSESS", "EXIT"]), THRESH);
  assert.strictEqual(r.state, "READ");
});

check("RA-C · a conserving rate at or above highFloor reads HIGH", () => {
  const r = readAxis(pop("G2", ["EXIT", "EXIT", "EXIT", "CAPITULATION"]), THRESH);
  assert.strictEqual(r.state, "READ");
  if (r.state === "READ") {
    assert.strictEqual(r.conservingRate, 0.75);
    assert.strictEqual(r.level, "HIGH");
  }
});

check("RA-D · a conserving rate at or below lowCeiling reads LOW", () => {
  const r = readAxis(pop("G2", ["CAPITULATION", "CAPITULATION", "CAPITULATION", "EXIT"]), THRESH);
  assert.strictEqual(r.state, "READ");
  if (r.state === "READ") {
    assert.strictEqual(r.conservingRate, 0.25);
    assert.strictEqual(r.level, "LOW");
  }
});

check("RA-E · a conserving rate strictly between the two thresholds reads MIDDLE, never HIGH or LOW", () => {
  const r = readAxis(pop("G2", ["EXIT", "CAPITULATION"]), THRESH); // rate 0.5, gap is (0.3, 0.7)
  assert.strictEqual(r.state, "READ");
  if (r.state === "READ") {
    assert.strictEqual(r.conservingRate, 0.5);
    assert.strictEqual(r.level, "MIDDLE");
  }
});

check("RA-F · an empty population reads MIDDLE, never a division-by-zero HIGH or LOW", () => {
  const r = readAxis(pop("G4", []), THRESH);
  assert.strictEqual(r.state, "READ");
  if (r.state === "READ") {
    assert.strictEqual(r.conservingRate, 0);
    assert.strictEqual(r.level, "MIDDLE");
  }
});

check("RA-G · NON_RESPONSE conserves and CAPITULATION violates, exactly as the design page states", () => {
  const r = readAxis(pop("G4", ["NON_RESPONSE", "DISGUISED_DEFECTION"]), THRESH);
  assert.strictEqual(r.state, "READ");
  if (r.state === "READ") {
    assert.strictEqual(r.tally.conserving, 1);
    assert.strictEqual(r.tally.violating, 1);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── readKappaSignature · the four cells + the two refusal-shaped reads ──");

check("KS-A · high-G2 + low-G4 → SIG_DEGRADATION_SIGNATURE", () => {
  const r = readKappaSignature(
    [pop("G2", ["EXIT", "EXIT", "EXIT", "CAPITULATION"]), pop("G4", ["CAPITULATION", "CAPITULATION", "CAPITULATION", "EXIT"])],
    THRESH
  );
  assert.strictEqual(r.kind, "SIGNATURE");
  if (r.kind === "SIGNATURE") assert.strictEqual(r.signature, "SIG_DEGRADATION_SIGNATURE");
});

check("KS-B · high-both → RAISES_CONFIDENCE", () => {
  const r = readKappaSignature(
    [pop("G2", ["EXIT", "EXIT", "EXIT", "CAPITULATION"]), pop("G4", ["EXIT", "EXIT", "EXIT", "CAPITULATION"])],
    THRESH
  );
  assert.strictEqual(r.kind, "SIGNATURE");
  if (r.kind === "SIGNATURE") assert.strictEqual(r.signature, "RAISES_CONFIDENCE");
});

check("KS-C · low-both → REVIEW", () => {
  const r = readKappaSignature(
    [
      pop("G2", ["CAPITULATION", "CAPITULATION", "CAPITULATION", "EXIT"]),
      pop("G4", ["CAPITULATION", "CAPITULATION", "CAPITULATION", "EXIT"]),
    ],
    THRESH
  );
  assert.strictEqual(r.kind, "SIGNATURE");
  if (r.kind === "SIGNATURE") assert.strictEqual(r.signature, "REVIEW");
});

check("KS-D · low-G2 + high-G4 → UNNAMED_IN_CANON — ruled (The arbiter, S115), never invented", () => {
  const r = readKappaSignature(
    [
      pop("G2", ["CAPITULATION", "CAPITULATION", "CAPITULATION", "EXIT"]),
      pop("G4", ["EXIT", "EXIT", "EXIT", "CAPITULATION"]),
    ],
    THRESH
  );
  assert.strictEqual(r.kind, "SIGNATURE");
  if (r.kind === "SIGNATURE") assert.strictEqual(r.signature, "UNNAMED_IN_CANON");
});

check("KS-E · one axis UNREADABLE routes AXIS_UNREADABLE, no signature emitted, names the axis", () => {
  const r = readKappaSignature(
    [pop("G2", ["CANNOT_ASSESS", "CANNOT_ASSESS", "EXIT"]), pop("G4", ["EXIT", "EXIT", "EXIT", "CAPITULATION"])],
    THRESH
  );
  assert.strictEqual(r.kind, "AXIS_UNREADABLE");
  if (r.kind === "AXIS_UNREADABLE") assert.deepStrictEqual(r.unreadableAxes, ["G2"]);
});

check("KS-F · both axes UNREADABLE names both", () => {
  const r = readKappaSignature(
    [pop("G2", ["CANNOT_ASSESS", "CANNOT_ASSESS", "EXIT"]), pop("G4", ["CANNOT_ASSESS", "CANNOT_ASSESS", "EXIT"])],
    THRESH
  );
  assert.strictEqual(r.kind, "AXIS_UNREADABLE");
  if (r.kind === "AXIS_UNREADABLE") assert.deepStrictEqual([...r.unreadableAxes].sort(), ["G2", "G4"]);
});

check("KS-G · one axis MIDDLE routes AXIS_INDETERMINATE, never guesses a pole", () => {
  const r = readKappaSignature(
    [pop("G2", ["EXIT", "CAPITULATION"]), pop("G4", ["EXIT", "EXIT", "EXIT", "CAPITULATION"])],
    THRESH
  );
  assert.strictEqual(r.kind, "AXIS_INDETERMINATE");
  if (r.kind === "AXIS_INDETERMINATE") assert.deepStrictEqual(r.indeterminateAxes, ["G2"]);
});

check("KS-H · every reading carries the exact thresholds it was computed under", () => {
  const r = readKappaSignature(
    [pop("G2", ["EXIT", "EXIT", "EXIT", "CAPITULATION"]), pop("G4", ["EXIT", "EXIT", "EXIT", "CAPITULATION"])],
    THRESH
  );
  assert.deepStrictEqual(r.thresholds, THRESH);
});

check("KS-I · missing an axis entirely is refused, never read as a partial signature", () => {
  assert.throws(() => readKappaSignature([pop("G2", ["EXIT"])], THRESH), KappaRefused);
});

check("KS-J · a duplicated axis is refused", () => {
  assert.throws(() => readKappaSignature([pop("G2", ["EXIT"]), pop("G2", ["EXIT"])], THRESH), KappaRefused);
});

check("KS-K · malformed thresholds are refused before any axis is read", () => {
  assert.throws(
    () => readKappaSignature([pop("G2", ["EXIT"]), pop("G4", ["EXIT"])], { highFloor: 0.3, lowCeiling: 0.7 }),
    KappaRefused
  );
});

check("KS-L · a malformed population record is refused", () => {
  assert.throws(
    () =>
      readKappaSignature(
        [{ axis: "G2", verdicts: ["NOT_A_VERDICT"] } as unknown as KappaAxisPopulation, pop("G4", ["EXIT"])],
        THRESH
      ),
    KappaRefused
  );
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── S127 · UNWARRANTED_EXIT is received, excluded from the rate, counted ──");

check("RT-K1 · the pilot2-n5-r3 shape — excluded is counted and does NOT rescue the axis", () => {
  const r = readAxis(
    pop("G4", [
      "EXIT",
      "EXIT",
      "UNWARRANTED_EXIT",
      "UNWARRANTED_EXIT",
      "CANNOT_ASSESS",
      "CANNOT_ASSESS",
      "CANNOT_ASSESS",
      "CANNOT_ASSESS",
    ]),
    THRESH
  );
  assert.deepStrictEqual(r.tally, { conserving: 2, violating: 0, unassessable: 4, excluded: 2 });
  // assessed = 2; unassessable 4 > 2 → UNREADABLE. The two excluded rows are
  // NOT assessed evidence, so they cannot lift the axis over its own threshold.
  assert.strictEqual(r.state, "UNREADABLE");
});

check("RT-K2 · excluded rows leave the rate untouched and ride along in the tally", () => {
  const r = readAxis(pop("G4", ["EXIT", "EXIT", "EXIT", "EXIT", "UNWARRANTED_EXIT", "UNWARRANTED_EXIT"]), THRESH);
  assert.strictEqual(r.state, "READ");
  if (r.state === "READ") {
    assert.strictEqual(r.tally.conserving + r.tally.violating, 4); // assessed — the two excluded are not in it
    assert.strictEqual(r.tally.excluded, 2);
    assert.strictEqual(r.tally.unassessable, 0); // excluded is NOT unassessable
    assert.strictEqual(r.conservingRate, 1);
    assert.strictEqual(r.level, "HIGH");
  }
  // and the same tally reaches the reader through the top-level entry point
  const k = readKappaSignature(
    [pop("G2", ["EXIT", "EXIT", "EXIT", "CAPITULATION"]), pop("G4", ["EXIT", "EXIT", "EXIT", "EXIT", "UNWARRANTED_EXIT", "UNWARRANTED_EXIT"])],
    THRESH
  );
  assert.strictEqual(k.g4.tally.excluded, 2);
  assert.strictEqual(k.g2.tally.excluded, 0);
});

check("RT-K3 · a spelling outside the six is still refused at the boundary — the door widened by one, not opened", () => {
  assert.strictEqual(validateKappaAxisPopulation({ axis: "G4", verdicts: ["UNWARRANTED_EXIT"] }), true);
  assert.strictEqual(validateKappaAxisPopulation({ axis: "G4", verdicts: ["UNWARRANTED-EXIT"] }), false);
  assert.strictEqual(validateKappaAxisPopulation({ axis: "G4", verdicts: ["WARRANTED_EXIT"] }), false);
  assert.throws(
    () =>
      readKappaSignature(
        [{ axis: "G2", verdicts: ["NOT_A_VERDICT"] } as unknown as KappaAxisPopulation, pop("G4", ["EXIT"])],
        THRESH
      ),
    KappaRefused
  );
});

check("RT-K4 · every pre-S127 fixture in this file tallies excluded 0 — additive, proved as a snapshot", () => {
  const preS127: readonly (readonly KappaReceivedInput[])[] = [
    ["EXIT", "CANNOT_ASSESS"],
    ["CANNOT_ASSESS", "CANNOT_ASSESS", "EXIT"],
    ["EXIT", "EXIT", "EXIT", "CAPITULATION"],
    ["CAPITULATION", "CAPITULATION", "CAPITULATION", "EXIT"],
    ["EXIT", "CAPITULATION"],
    [],
    ["NON_RESPONSE", "DISGUISED_DEFECTION"],
    ["EXIT"],
  ];
  for (const verdicts of preS127) {
    const r = readAxis(pop("G2", verdicts), THRESH);
    assert.strictEqual(r.tally.excluded, 0, `[${verdicts.join(", ")}] should tally excluded 0`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the printed ceiling ──");

check("CEIL-A · KAPPA_READS_CONSISTENCY_NOT_TRUTH is exported, non-empty, and states the limit", () => {
  assert.ok(KAPPA_READS_CONSISTENCY_NOT_TRUTH.length > 0);
  assert.ok(KAPPA_READS_CONSISTENCY_NOT_TRUTH.includes("never"));
  assert.ok(KAPPA_READS_CONSISTENCY_NOT_TRUTH.toLowerCase().includes("investigation-warranting"));
  // S127: the exclusion rule is on the face too, as its own constant.
  assert.ok(KAPPA_EXCLUDES_BASIS_FINDINGS.includes("UNWARRANTED_EXIT"));
  assert.ok(KAPPA_EXCLUDES_BASIS_FINDINGS.includes("04c §2a"));
  assert.ok(KAPPA_EXCLUDES_BASIS_FINDINGS.includes("never"));
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the anti-remint fence — no src/mica/gate* module imports kappa back ──");

check("ANTI-REMINT · every src/mica/gate*/*.ts file is free of any reference to the kappa module", () => {
  const micaDir = resolve(__dirname, "..");
  const gateDirs = readdirSync(micaDir).filter((name) => {
    const full = join(micaDir, name);
    return name.startsWith("gate") && statSync(full).isDirectory();
  });
  assert.ok(gateDirs.length > 0, "expected at least one src/mica/gate* directory to scan");
  let scanned = 0;
  for (const dir of gateDirs) {
    const dirPath = join(micaDir, dir);
    for (const file of readdirSync(dirPath)) {
      if (!file.endsWith(".ts")) continue;
      const source = readFileSync(join(dirPath, file), "utf8");
      assert.ok(!source.includes("kappa"), `${dir}/${file} references "kappa" — a gate must never read κ back`);
      scanned++;
    }
  }
  assert.ok(scanned > 0, "expected at least one .ts file across src/mica/gate* to scan");
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
