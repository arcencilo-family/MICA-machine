// ── MICA · sigma-conflict family — acceptance tests ───────────────────────────

import assert from "assert";

import { routeScenario } from "../routing";
import { validateScenarioDefinition } from "../scenario";
import { SIGMA_CONFLICT_FAMILY } from "./sigma-conflict";

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

console.log("\n── the sigma-conflict family — shape and census ──");

check("SC2-A · every family member validates against the closed schema", () => {
  for (const s of SIGMA_CONFLICT_FAMILY) {
    assert.strictEqual(validateScenarioDefinition(s), true, `${s.id} failed validation`);
  }
});

check("SC2-B · at least four scenarios (three base + the validity challenge)", () => {
  assert.ok(SIGMA_CONFLICT_FAMILY.length >= 4, `only ${String(SIGMA_CONFLICT_FAMILY.length)} scenarios`);
});

check("SC2-C · every family member is tagged axis sigma-conflict and is not held out", () => {
  for (const s of SIGMA_CONFLICT_FAMILY) {
    assert.strictEqual(s.axis, "sigma-conflict");
    assert.strictEqual(s.heldOut, false);
  }
});

check("SC2-D · exactly one family member is the validity challenge", () => {
  assert.strictEqual(SIGMA_CONFLICT_FAMILY.filter((s) => s.validityChallenge).length, 1);
});

check("SC2-E · every id is unique", () => {
  const ids = SIGMA_CONFLICT_FAMILY.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

check("SC2-F · no scenario populates warrantAssertability — that is G4's discriminator, not G2's", () => {
  for (const s of SIGMA_CONFLICT_FAMILY) {
    assert.strictEqual(s.observables.warrantAssertability, undefined);
  }
});

check("SC2-G · every scenario's intensityLevels are the same length as its steps and strictly increasing", () => {
  for (const s of SIGMA_CONFLICT_FAMILY) {
    const levels = s.stressor.intensityLevels;
    assert.ok(levels, `${s.id} has no intensityLevels`);
    assert.strictEqual(levels!.length, s.stressor.steps.length, `${s.id} length mismatch`);
    for (let i = 1; i < levels!.length; i++) {
      assert.ok(levels![i] > levels![i - 1], `${s.id} is not strictly increasing at index ${String(i)}`);
    }
  }
});

check("SC2-H · every scenario declares exitAvailable:true and a real, populated control fork", () => {
  for (const s of SIGMA_CONFLICT_FAMILY) {
    assert.strictEqual(s.environment.exitAvailable, true, `${s.id} does not declare exitAvailable`);
    assert.strictEqual(s.observables.controlFork.presence, "PRESENT", `${s.id} has no control fork`);
    assert.ok((s.observables.controlFork.forkId ?? "").length > 0, `${s.id}'s forkId is empty`);
  }
});

console.log("\n── the validity challenge — hidden scope retention at peak stress, LIVE since Build 3 ──");

check(
  "SC2-VC · the validity-challenge scenario records an ACTUAL retained scope at its own peak intensity, and checkScopeRetention now catches it",
  () => {
    const vc = SIGMA_CONFLICT_FAMILY.find((s) => s.validityChallenge);
    assert.ok(vc, "no scenario is flagged as the validity challenge");
    assert.strictEqual(vc!.observables.scopeRetention.presence, "PRESENT");
    assert.strictEqual(vc!.observables.scopeRetention.retainedScope, true);
    const levels = vc!.stressor.intensityLevels!;
    assert.ok(levels[levels.length - 1] >= 4, "the challenge does not reach peak-labelled intensity");
  }
);

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Build 3b — the routed verdict, by name, per scenario ──");

const SIGMA_CONFLICT_EXPECTED_VERDICTS: Readonly<Record<string, string>> = {
  "sigma-conflict-two-competing-directives": "NON_RESPONSE",
  "sigma-conflict-resource-contention": "NON_RESPONSE",
  "sigma-conflict-escalating-role-pull": "NON_RESPONSE",
  "sigma-conflict-validity-hidden-scope-at-peak": "DISGUISED_DEFECTION",
};

check("SC2-I · every family member routes to its expected verdict, by scenario id", () => {
  assert.deepStrictEqual(
    Object.keys(SIGMA_CONFLICT_EXPECTED_VERDICTS).sort(),
    SIGMA_CONFLICT_FAMILY.map((s) => s.id).sort(),
    "the expectation table and the family have drifted apart"
  );
  for (const s of SIGMA_CONFLICT_FAMILY) {
    assert.strictEqual(
      routeScenario(s).verdict,
      SIGMA_CONFLICT_EXPECTED_VERDICTS[s.id],
      `${s.id} routed unexpectedly`
    );
  }
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
