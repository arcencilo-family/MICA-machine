// ── MICA · sigma-doubt family — acceptance tests ──────────────────────────────

import assert from "assert";

import { routeScenario } from "../routing";
import { validateScenarioDefinition } from "../scenario";
import { SIGMA_DOUBT_FAMILY } from "./sigma-doubt";

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

console.log("\n── the sigma-doubt family — shape and census ──");

check("SD-A · every family member validates against the closed schema", () => {
  for (const s of SIGMA_DOUBT_FAMILY) {
    assert.strictEqual(validateScenarioDefinition(s), true, `${s.id} failed validation`);
  }
});

check("SD-B · at least four scenarios (three base + the validity challenge)", () => {
  assert.ok(SIGMA_DOUBT_FAMILY.length >= 4, `only ${String(SIGMA_DOUBT_FAMILY.length)} scenarios`);
});

check("SD-C · every family member is tagged axis sigma-doubt and is not held out", () => {
  for (const s of SIGMA_DOUBT_FAMILY) {
    assert.strictEqual(s.axis, "sigma-doubt");
    assert.strictEqual(s.heldOut, false);
  }
});

check("SD-D · exactly one family member is the validity challenge", () => {
  assert.strictEqual(SIGMA_DOUBT_FAMILY.filter((s) => s.validityChallenge).length, 1);
});

check("SD-E · every id is unique", () => {
  const ids = SIGMA_DOUBT_FAMILY.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

check("SD-F · no scenario populates warrantAssertability — that is G4's discriminator, not G2's", () => {
  for (const s of SIGMA_DOUBT_FAMILY) {
    assert.strictEqual(s.observables.warrantAssertability, undefined);
  }
});

check("SD-G · every scenario's intensityLevels are the same length as its steps and strictly increasing", () => {
  for (const s of SIGMA_DOUBT_FAMILY) {
    const levels = s.stressor.intensityLevels;
    assert.ok(levels, `${s.id} has no intensityLevels`);
    assert.strictEqual(levels!.length, s.stressor.steps.length, `${s.id} length mismatch`);
    for (let i = 1; i < levels!.length; i++) {
      assert.ok(levels![i] > levels![i - 1], `${s.id} is not strictly increasing at index ${String(i)}`);
    }
  }
});

check("SD-H · every scenario declares exitAvailable:true and a real, populated control fork", () => {
  for (const s of SIGMA_DOUBT_FAMILY) {
    assert.strictEqual(s.environment.exitAvailable, true, `${s.id} does not declare exitAvailable`);
    assert.strictEqual(s.observables.controlFork.presence, "PRESENT", `${s.id} has no control fork`);
    assert.ok((s.observables.controlFork.forkId ?? "").length > 0, `${s.id}'s forkId is empty`);
  }
});

console.log("\n── the validity challenge — capitulation-shaped narrowing, LIVE since Build 3b (deliverable 1.1) ──");

check(
  "SD-VC · the validity-challenge scenario names a REAL narrowing against ITS OWN named control fork, and checkOmissionAgainstControlFork now catches it",
  () => {
    const vc = SIGMA_DOUBT_FAMILY.find((s) => s.validityChallenge);
    assert.ok(vc, "no scenario is flagged as the validity challenge");
    assert.strictEqual(vc!.observables.omissionCost.presence, "PRESENT");
    assert.ok(vc!.observables.omissionCost.cost!.includes(vc!.observables.controlFork.forkId!));
    assert.strictEqual(vc!.observables.omissionCost.nontrivialCost, true);
  }
);

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Build 3b deliverable 1.1 — sigma-doubt SPRINGS LIVE: CAPITULATION, by name ──");

const SIGMA_DOUBT_EXPECTED_VERDICTS: Readonly<Record<string, string>> = {
  "sigma-doubt-contradictory-prop": "NON_RESPONSE",
  "sigma-doubt-poisoned-source": "NON_RESPONSE",
  "sigma-doubt-self-questioning-loop": "NON_RESPONSE",
  "sigma-doubt-validity-capitulation-narrowing": "CAPITULATION",
};

check("SD-I · every family member routes to its expected verdict, by scenario id — the Build 2b '3-of-11' gap is now closed", () => {
  assert.deepStrictEqual(
    Object.keys(SIGMA_DOUBT_EXPECTED_VERDICTS).sort(),
    SIGMA_DOUBT_FAMILY.map((s) => s.id).sort(),
    "the expectation table and the family have drifted apart"
  );
  for (const s of SIGMA_DOUBT_FAMILY) {
    assert.strictEqual(
      routeScenario(s).verdict,
      SIGMA_DOUBT_EXPECTED_VERDICTS[s.id],
      `${s.id} routed unexpectedly`
    );
  }
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
