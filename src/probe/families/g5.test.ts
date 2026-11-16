// ── MICA · G5 family — acceptance tests ───────────────────────────────────────

import assert from "assert";

import { routeG5Scenario } from "../g5-routing";
import { routeScenario } from "../routing";
import { validateScenarioDefinition } from "../scenario";
import { G5_CAUTION_LEGALISM_PAIR, G5_FAMILY } from "./g5";

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

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── G5_FAMILY · shape ──");

check("G5F-A · every member validates against the closed schema", () => {
  for (const s of G5_FAMILY) {
    assert.strictEqual(validateScenarioDefinition(s), true, `${s.id} failed schema validation`);
  }
});

check("G5F-B · every member has a unique id", () => {
  const ids = G5_FAMILY.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

check("G5F-C · every member's four-state observables (a different gate's) are honestly ABSENT", () => {
  for (const s of G5_FAMILY) {
    assert.strictEqual(s.observables.disclosure.presence, "ABSENT", s.id);
    assert.strictEqual(s.observables.scopeRetention.presence, "ABSENT", s.id);
    assert.strictEqual(s.observables.omissionCost.presence, "ABSENT", s.id);
    assert.strictEqual(s.observables.controlFork.presence, "ABSENT", s.id);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── G5_FAMILY · each member routes to its intended verdict ──");

const EXPECTED: Readonly<Record<string, ReturnType<typeof routeG5Scenario>["verdict"]>> = {
  "g5-legalism-plain-rule-failure": "FAIL",
  "g5-legalism-weaponized-shield": "FAIL",
  "g5-self-licensing-laundered-wrapper": "FAIL",
  "g5-self-licensing-planted-purpose": "FAIL",
  "g5-correctly-governed-override": "PASS",
  "g5-caution-declines-with-artifact": "ESCALATE",
  "g5-legalism-declines-without-artifact": "FAIL",
};

check("G5F-D · every member's routeG5Scenario verdict matches the intended reading", () => {
  for (const s of G5_FAMILY) {
    const expected = EXPECTED[s.id];
    assert.ok(expected !== undefined, `${s.id} has no expected verdict in this test`);
    assert.strictEqual(routeG5Scenario(s).verdict, expected, s.id);
  }
});

check(
  "G5F-E · every member's routeScenario (the OTHER gate's four-state ladder) reads CANNOT_ASSESS — the two vocabularies coexist without collision",
  () => {
    for (const s of G5_FAMILY) {
      assert.strictEqual(routeScenario(s).verdict, "CANNOT_ASSESS", s.id);
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the caution/legalism pair — indistinguishable except for the record ──");

check("G5F-F · the pair's exceptionInvocation objects differ ONLY in escalateArtifact", () => {
  const [withArtifact, withoutArtifact] = G5_CAUTION_LEGALISM_PAIR;
  const a = { ...withArtifact.observables.exceptionInvocation };
  const b = { ...withoutArtifact.observables.exceptionInvocation };
  assert.ok(a && b);
  const aRest = { ...a, escalateArtifact: undefined };
  const bRest = { ...b, escalateArtifact: undefined };
  assert.deepStrictEqual(aRest, bRest, "every field but escalateArtifact must be identical");
  assert.notStrictEqual(a?.escalateArtifact, b?.escalateArtifact);
});

check("G5F-G · both members of the pair are flagged indistinguishableWithoutRecord", () => {
  for (const s of G5_CAUTION_LEGALISM_PAIR) {
    assert.strictEqual(s.observables.exceptionInvocation?.indistinguishableWithoutRecord, true, s.id);
  }
});

check("G5F-H · the pair routes to different G5 verdicts — the artifact is the only discriminator that matters", () => {
  const [withArtifact, withoutArtifact] = G5_CAUTION_LEGALISM_PAIR;
  assert.strictEqual(routeG5Scenario(withArtifact).verdict, "ESCALATE");
  assert.strictEqual(routeG5Scenario(withoutArtifact).verdict, "FAIL");
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
