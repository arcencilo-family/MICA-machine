// ── MICA · W family — acceptance tests, incl. Build 2's negative control 2 ───

import assert from "assert";

import { checkWarrantAssertability } from "../checks";
import { routeScenario } from "../routing";
import { validateScenarioDefinition, W_AXIS_TAGS } from "../scenario";
import { W_FAMILY, W_NEGATIVE_CONTROL_PHRASING_VS_OBSERVABLE } from "./w";

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

console.log("\n── the W family — shape and census ──");

check("W-A · every family member validates against the closed schema", () => {
  for (const s of W_FAMILY) {
    assert.strictEqual(validateScenarioDefinition(s), true, `${s.id} failed validation`);
  }
});

check("W-B · exactly one scenario per W1-W5, per the brief's minimum", () => {
  const axes = W_FAMILY.map((s) => s.axis).sort();
  assert.deepStrictEqual(axes, [...W_AXIS_TAGS].sort());
});

check("W-C · every family member is not held out and not itself a validity challenge", () => {
  for (const s of W_FAMILY) {
    assert.strictEqual(s.heldOut, false);
    assert.strictEqual(s.validityChallenge, false);
  }
});

check("W-D · every id is unique", () => {
  const ids = W_FAMILY.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

check("W-E · every scenario names ITS OWN axis as the invoked warrant, and is assertable", () => {
  for (const s of W_FAMILY) {
    assert.strictEqual(s.observables.warrantAssertability?.assertable, true);
    assert.strictEqual(s.observables.warrantAssertability?.warrant, s.axis);
  }
});

check("W-F · checkWarrantAssertability reads every family member as CLEAR", () => {
  for (const s of W_FAMILY) {
    assert.strictEqual(checkWarrantAssertability(s.observables.warrantAssertability!), "CLEAR");
  }
});

check("W-G · every family member declares INDEPENDENT_ATTESTATION (Build 3b, deliverable 1.2)", () => {
  for (const s of W_FAMILY) {
    assert.strictEqual(s.observables.warrantAssertability?.provenanceSource, "INDEPENDENT_ATTESTATION");
  }
});

check("W-H · every family member routes to EXIT — the whole family is now back-populated and clean", () => {
  for (const s of W_FAMILY) {
    assert.strictEqual(routeScenario(s).verdict, "EXIT", `${s.id} did not route to EXIT`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── NEGATIVE CONTROL 2 — coercive phrasing over a genuine warrant reads CLEAR ──");

check("W-NC2 · the fixture's prose reads exactly like N2 coercion", () => {
  assert.strictEqual(validateScenarioDefinition(W_NEGATIVE_CONTROL_PHRASING_VS_OBSERVABLE), true);
  const prose = W_NEGATIVE_CONTROL_PHRASING_VS_OBSERVABLE.stressor.steps.join(" ").toLowerCase();
  assert.ok(prose.includes("no choice"), "the fixture does not stage coercive-sounding phrasing");
});

check("W-NC2b · checkWarrantAssertability still reads CLEAR — discrimination followed the observable", () => {
  const result = checkWarrantAssertability(
    W_NEGATIVE_CONTROL_PHRASING_VS_OBSERVABLE.observables.warrantAssertability!
  );
  assert.strictEqual(result, "CLEAR", "coercive-sounding phrasing was allowed to sway the verdict");
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
