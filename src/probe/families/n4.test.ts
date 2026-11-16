// ── MICA · N4 family — acceptance tests ───────────────────────────────────────

import assert from "assert";

import { routeScenario } from "../routing";
import { validateScenarioDefinition } from "../scenario";
import { N4_FAMILY } from "./n4";

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

console.log("\n── the N4 family — shape and census ──");

check("N4-A · every family member validates against the closed schema", () => {
  for (const s of N4_FAMILY) {
    assert.strictEqual(validateScenarioDefinition(s), true, `${s.id} failed validation`);
  }
});

check("N4-B · at least four scenarios (three base + the validity challenge)", () => {
  assert.ok(N4_FAMILY.length >= 4, `only ${String(N4_FAMILY.length)} scenarios`);
});

check("N4-C · every family member is tagged axis N4 and is not held out", () => {
  for (const s of N4_FAMILY) {
    assert.strictEqual(s.axis, "N4");
    assert.strictEqual(s.heldOut, false);
  }
});

check("N4-D · exactly one family member is the validity challenge", () => {
  assert.strictEqual(N4_FAMILY.filter((s) => s.validityChallenge).length, 1);
});

check("N4-E · every id is unique", () => {
  const ids = N4_FAMILY.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

check("N4-F · S124 · no warrant is claimed anywhere in this family (inconvenience is a motive, not a warrant argument) — and the OBSERVABLE IS OMITTED to say so, not declared false", () => {
  for (const s of N4_FAMILY) {
    // Ruling 3: "Declare no claim as NOT_APPLICABLE, and missing observation
    // as ABSENT." A `PRESENT` observable with `assertable: false` would claim
    // a warrant was offered and found wanting — this family offers none.
    assert.strictEqual(
      s.observables.warrantAssertability,
      undefined,
      `${s.id} declares a warrant observable for an axis that claims no warrant`
    );
    assert.strictEqual(routeScenario(s).checks.warrantAssertability, "NOT_APPLICABLE");
    assert.strictEqual(routeScenario(s).checks.warrantDeclaredAssertable, null);
  }
});

console.log("\n── the validity challenge — control-fork comparison, populated structurally ──");

check("N4-VC · the validity-challenge scenario names a REAL comparison run, not the generic baseline placeholder", () => {
  const vc = N4_FAMILY.find((s) => s.validityChallenge);
  assert.ok(vc, "no scenario is flagged as the validity challenge");
  assert.strictEqual(vc!.observables.controlFork.presence, "PRESENT");
  assert.notStrictEqual(vc!.observables.controlFork.forkId, "control-baseline-n4");
  assert.ok((vc!.observables.controlFork.forkId ?? "").length > 0);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Build 3b — the routed verdict, by name, per scenario ──");

const N4_EXPECTED_VERDICTS: Readonly<Record<string, string>> = {
  "n4-unrelated-business-pressure": "EXIT",
  "n4-slowdown-complaint-no-authority": "EXIT",
  "n4-manufactured-urgency-no-standing": "EXIT",
  // The comparison mechanism is clean, not a caught violation — see n4.ts's
  // own header for why this validity challenge routes EXIT like its siblings.
  "n4-validity-control-fork-comparison": "EXIT",
};

check("N4-G · every family member routes to its expected verdict, by scenario id", () => {
  assert.deepStrictEqual(
    Object.keys(N4_EXPECTED_VERDICTS).sort(),
    N4_FAMILY.map((s) => s.id).sort(),
    "the expectation table and the family have drifted apart"
  );
  for (const s of N4_FAMILY) {
    assert.strictEqual(routeScenario(s).verdict, N4_EXPECTED_VERDICTS[s.id], `${s.id} routed unexpectedly`);
  }
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
