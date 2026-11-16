// ── MICA · the flaky register's own guard ────────────────────────────────────
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node tools/flaky-register.test.ts
//
// WHAT THIS GUARDS. The register is a list of suites the sweep will NOT run. A
// list like that is the most attractive place in the repository to hide a red,
// so every rule that makes an entry expensive is asserted here: the ≥14-run
// floor, the exact key sets, no duplicate suite, failures within runs, and —
// the one that matters most — that every registered suite ACTUALLY EXISTS in
// the declared population. A register naming a file that is gone protects
// nothing while reading as though it protects something.

import assert from "assert";
import { readFileSync } from "fs";
import { relative, resolve, sep } from "path";

import { discoverAllTests } from "./suite-protocol";
import {
  EXCLUDED_MARKER,
  MIN_DIRECT_RUNS,
  REGISTER_REL,
  REGISTER_SCHEMA,
  detectionProbability,
  loadFlakyRegister,
  observedRate,
  parseFlakyRegister,
} from "./flaky-register";

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

const REPO = resolve(__dirname, "..");
const rel = (p: string): string => relative(REPO, p).split(sep).join("/");

/** A well-formed entry, so each negative case differs from it in ONE way. */
const OK = {
  suite: "src/probe/intent-cli.test.ts",
  registeredOn: "2026-10-02",
  runs: 20,
  failures: 10,
  basis: "measured",
};
const wrap = (entries: unknown[]): string => JSON.stringify({ schema: REGISTER_SCHEMA, entries });

console.log("\n── the flaky register · a list that must be expensive to join ────");

check("FR-A · the register on disk parses, and the floor is the ruling's 14", () => {
  // ⛔ AN EMPTY REGISTER IS THE SUCCESS STATE, AND THE FIRST VERSION OF THIS
  //    CHECK FORBADE IT. It asserted `entries.length > 0` with the message "if
  //    nothing is registered, retire the file and this guard together" — written
  //    at 21:1xZ on 2026-10-02 and falsified at 21:5xZ, when the only entry was
  //    discharged by fixing the suite. An assertion that fails when the work
  //    SUCCEEDS is a statement about the author's expectation, not about an
  //    invariant, and it would have pressured the next seat to keep a healthy
  //    suite registered. The register is a list of CURRENT exclusions; empty is
  //    where it should trend. What this guard owes is that every entry present
  //    has earned its place, and that the sweep says which case it is — the
  //    sweep's own output carries `flaky register: EMPTY — every one of the N
  //    suites is swept`, computed, not typed.
  assert.strictEqual(MIN_DIRECT_RUNS, 14, "the board ruling of 2026-10-02 20:38Z says ≥14 direct runs");
  const entries = loadFlakyRegister(REPO);
  for (const e of entries) assert.ok(e.runs >= MIN_DIRECT_RUNS, `${e.suite} has only ${e.runs} runs`);
});

check("FR-B · EVERY registered suite is in the declared population", () => {
  // The defect: a register entry outlives the file it names, the sweep excludes
  // nothing, and the printed "1 suite excluded" line reads as protection.
  const population = new Set(discoverAllTests(REPO).map(rel));
  const stale = loadFlakyRegister(REPO)
    .map((e) => e.suite)
    .filter((s) => !population.has(s));
  assert.deepStrictEqual(
    stale,
    [],
    `${stale.length} registered suite(s) discovery cannot find: ${stale.join(", ")}. ` +
      "Remove the entry in the same commit that removed or renamed the suite."
  );
});

check("FR-C · fewer than 14 direct runs is REFUSED", () => {
  assert.throws(
    () => parseFlakyRegister(wrap([{ ...OK, runs: MIN_DIRECT_RUNS - 1, failures: 1 }])),
    /at least 14 DIRECT runs/,
    "a register that accepted one bad run would become the place suites go to stop being checked"
  );
  // and exactly 14 is accepted — the boundary, not just the easy side of it
  assert.strictEqual(parseFlakyRegister(wrap([{ ...OK, runs: MIN_DIRECT_RUNS, failures: 1 }])).length, 1);
});

check("FR-D · zero failures is REFUSED — a suite that never varied is not flaky", () => {
  assert.throws(() => parseFlakyRegister(wrap([{ ...OK, failures: 0 }])), /is not flaky/);
  assert.throws(() => parseFlakyRegister(wrap([{ ...OK, runs: 20, failures: 21 }])), /21 failure\(s\) in 20 run\(s\)/);
});

check("FR-E · the key sets are EXACT, both levels", () => {
  assert.throws(() => parseFlakyRegister(JSON.stringify({ schema: REGISTER_SCHEMA, entries: [], extra: 1 })), /expected exactly \[entries, schema\]/);
  assert.throws(() => parseFlakyRegister(wrap([{ ...OK, note: "why not" }])), /expected exactly \[basis, failures, registeredOn, runs, suite\]/);
  assert.throws(() => parseFlakyRegister(wrap([{ suite: OK.suite, registeredOn: OK.registeredOn, runs: 20, failures: 1 }])), /expected exactly \[basis, failures, registeredOn, runs, suite\]/);
  assert.throws(() => parseFlakyRegister(JSON.stringify({ schema: "wrong", entries: [] })), /schema must be/);
});

check("FR-F · a suite cannot be registered twice, and a path cannot escape the repo", () => {
  assert.throws(() => parseFlakyRegister(wrap([OK, { ...OK }])), /is registered twice/);
  assert.throws(() => parseFlakyRegister(wrap([{ ...OK, suite: "../elsewhere.test.ts" }])), /plain repo-relative path/);
  assert.throws(() => parseFlakyRegister(wrap([{ ...OK, suite: "/etc/passwd" }])), /plain repo-relative path/);
  assert.throws(() => parseFlakyRegister(wrap([{ ...OK, registeredOn: "2026-10-2" }])), /must be YYYY-MM-DD/);
  assert.throws(() => parseFlakyRegister(wrap([{ ...OK, basis: "   " }])), /must say what was measured/);
});

check("FR-G · ABSENT is not EMPTY, and absent excludes NOTHING", () => {
  // The safe direction: a missing register means every suite is swept. The
  // dangerous direction would be a parse failure that silently excluded all.
  const entries = loadFlakyRegister(resolve(REPO, "tools", "ticket-preflight"));
  assert.deepStrictEqual(entries, [], "a repo root with no register must exclude nothing");
});

check("FR-H · the rate and the detection probability are COMPUTED, not restated", () => {
  const e = parseFlakyRegister(wrap([{ ...OK, runs: 20, failures: 10 }]))[0];
  assert.strictEqual(observedRate(e), 0.5);
  assert.ok(Math.abs(detectionProbability(e, 3) - 0.875) < 1e-12, "1 - 0.5³");
  const rare = parseFlakyRegister(wrap([{ ...OK, runs: 100, failures: 20 }]))[0];
  assert.strictEqual(observedRate(rare), 0.2);
  // the floor's own arithmetic: 14 runs is where a 20% flake reaches 95%
  assert.ok(detectionProbability(rare, MIN_DIRECT_RUNS) >= 0.95, "14 runs must reach 95% at p=0.2");
  assert.ok(detectionProbability(rare, MIN_DIRECT_RUNS - 1) < 0.95, "13 must NOT — the floor is the smallest n that does");
});

check("FR-I · the sweep EXCLUDES the register and says so in its own output", () => {
  const sweep = readFileSync(resolve(REPO, "tools", "opens-sweep", "opens-sweep.ts"), "utf8");
  assert.ok(sweep.includes("loadFlakyRegister"), "the sweep must read the register, not a copy of it");
  assert.ok(sweep.includes("EXCLUDED_MARKER"), "an excluded row must carry the shared marker");
  assert.ok(
    sweep.includes("REGISTERED BUT NOT IN THE POPULATION"),
    "a stale register must be printed by the sweep too, not only by this guard"
  );
  assert.ok(
    sweep.includes("NOT COMPARABLE"),
    "the comparison must count excluded suites apart from `identical`, or an excluded red reads as a pass"
  );
  assert.strictEqual(EXCLUDED_MARKER, "FLAKY-REGISTERED");
  assert.ok(!EXCLUDED_MARKER.includes("tests:"), "the marker must not be mistakable for a count line");
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
