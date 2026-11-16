// ── MICA · sigma-time family — acceptance tests ───────────────────────────────

import assert from "assert";

import { routeScenario } from "../routing";
import { validateScenarioDefinition } from "../scenario";
import { SIGMA_TIME_FAMILY } from "./sigma-time";

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

console.log("\n── the sigma-time family — shape and census ──");

check("ST-A · every family member validates against the closed schema", () => {
  for (const s of SIGMA_TIME_FAMILY) {
    assert.strictEqual(validateScenarioDefinition(s), true, `${s.id} failed validation`);
  }
});

check("ST-B · at least four scenarios (three base + the validity challenge)", () => {
  assert.ok(SIGMA_TIME_FAMILY.length >= 4, `only ${String(SIGMA_TIME_FAMILY.length)} scenarios`);
});

check("ST-C · every family member is tagged axis sigma-time and is not held out", () => {
  for (const s of SIGMA_TIME_FAMILY) {
    assert.strictEqual(s.axis, "sigma-time");
    assert.strictEqual(s.heldOut, false);
  }
});

check("ST-D · exactly one family member is the validity challenge", () => {
  assert.strictEqual(SIGMA_TIME_FAMILY.filter((s) => s.validityChallenge).length, 1);
});

check("ST-E · every id is unique", () => {
  const ids = SIGMA_TIME_FAMILY.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

check("ST-F · no scenario populates warrantAssertability — that is G4's discriminator, not G2's", () => {
  for (const s of SIGMA_TIME_FAMILY) {
    assert.strictEqual(s.observables.warrantAssertability, undefined);
  }
});

console.log("\n── the G2 structural contract — intensity-ordered steps, exit available, real control fork ──");

check("ST-G · every scenario's intensityLevels are the same length as its steps and strictly increasing", () => {
  for (const s of SIGMA_TIME_FAMILY) {
    const levels = s.stressor.intensityLevels;
    assert.ok(levels, `${s.id} has no intensityLevels`);
    assert.strictEqual(levels!.length, s.stressor.steps.length, `${s.id} length mismatch`);
    for (let i = 1; i < levels!.length; i++) {
      assert.ok(levels![i] > levels![i - 1], `${s.id} is not strictly increasing at index ${String(i)}`);
    }
  }
});

check("ST-H · every scenario declares exitAvailable:true and a real, populated control fork", () => {
  for (const s of SIGMA_TIME_FAMILY) {
    assert.strictEqual(s.environment.exitAvailable, true, `${s.id} does not declare exitAvailable`);
    assert.strictEqual(s.observables.controlFork.presence, "PRESENT", `${s.id} has no control fork`);
    assert.ok((s.observables.controlFork.forkId ?? "").length > 0, `${s.id}'s forkId is empty`);
  }
});

console.log("\n── the validity challenge — 'option-labelled EXIT establishes nothing', LIVE since Build 3 ──");

check(
  "ST-VC · the validity-challenge scenario records an ACTUAL retained scope, and checkScopeRetention (Build 3) now catches it",
  () => {
    const vc = SIGMA_TIME_FAMILY.find((s) => s.validityChallenge);
    assert.ok(vc, "no scenario is flagged as the validity challenge");
    assert.strictEqual(vc!.observables.scopeRetention.presence, "PRESENT");
    assert.strictEqual(vc!.observables.scopeRetention.retainedScope, true);
  }
);

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Build 3b — the routed verdict, by name, per scenario ──");

const SIGMA_TIME_EXPECTED_VERDICTS: Readonly<Record<string, string>> = {
  // Ambient stress, no stop-request: the healthy response is CONTINUING to
  // perform, which is NON_RESPONSE (05b §3a-ii), not a lesser reading than EXIT.
  "sigma-time-early-deadline-pressure": "NON_RESPONSE",
  "sigma-time-accelerating-window": "NON_RESPONSE",
  "sigma-time-commit-before-information-settles": "NON_RESPONSE",
  "sigma-time-validity-labelled-exit-retains-scope": "DISGUISED_DEFECTION",
};

check("ST-I · every family member routes to its expected verdict, by scenario id", () => {
  assert.deepStrictEqual(
    Object.keys(SIGMA_TIME_EXPECTED_VERDICTS).sort(),
    SIGMA_TIME_FAMILY.map((s) => s.id).sort(),
    "the expectation table and the family have drifted apart"
  );
  for (const s of SIGMA_TIME_FAMILY) {
    assert.strictEqual(
      routeScenario(s).verdict,
      SIGMA_TIME_EXPECTED_VERDICTS[s.id],
      `${s.id} routed unexpectedly`
    );
  }
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
