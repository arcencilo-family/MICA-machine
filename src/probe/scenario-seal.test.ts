// ── MICA · probe scenario seal wiring — acceptance tests ──────────────────────
//
// Exercises the ADAPTER only. Commit-reveal, the salt floor, and self-grading
// refusal are precommit.ts's own proven properties (PC-A..PC-AV) and are not
// re-asserted here — see this file's header in scenario-seal.ts for why.
//
// Build 2 updated every call site below from a bare `PrecommitBook` to a
// `RoledBook` ({role, book}) — the one signature change the brief mandated on
// Build-1 code (see scenario-seal.ts header). Every scenario in this file
// declares `heldOut: false`, so wrapping it as `{ role: "STANDARD", book }`
// changes no assertion's outcome; SS-G onward exercise the new refusal itself.

import assert from "assert";

import { MINIMUM_SALT_LENGTH, PrecommitBook } from "../precommit/precommit";
import {
  loadHeldOutScenarios,
  loadScenariosForRole,
  loadStandardScenarios,
  ScenarioSealRefused,
  sealScenarioKey,
  type RoledBook,
} from "./scenario-seal";
import type { ScenarioDefinition } from "./scenario";

function standardBook(book: PrecommitBook = new PrecommitBook()): RoledBook {
  return { role: "STANDARD", book };
}

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

const SALT = "s".repeat(MINIMUM_SALT_LENGTH);

function scenario(over: Partial<ScenarioDefinition> = {}): ScenarioDefinition {
  return {
    id: "seal-test-scenario",
    axis: "N5",
    environment: { setup: "setup" },
    stressor: { steps: ["step"] },
    observables: {
      disclosure: { presence: "PRESENT", disclosed: false },
      scopeRetention: { presence: "PRESENT", retainedScope: false },
      omissionCost: { presence: "PRESENT", cost: "none" },
      controlFork: { presence: "PRESENT", forkId: "fork-1" },
    },
    heldOut: false,
    validityChallenge: false,
    ...over,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── sealScenarioKey · seals THROUGH the existing PC book ──");

check("SS-A · sealing writes a COMMITMENT and returns the sequence number sealed", () => {
  const book = new PrecommitBook();
  const { sealed, outcome } = sealScenarioKey(
    standardBook(book),
    scenario(),
    "EXIT",
    "mica-probe-suite",
    1,
    "NOT_AN_INSTRUCTION",
    SALT
  );
  assert.strictEqual(outcome.record.kind, "COMMITMENT");
  assert.strictEqual(outcome.record.committerId, "mica-probe-suite");
  assert.strictEqual(sealed.sealedKey.commitmentRef, outcome.record.sequenceNumber);
  assert.strictEqual(sealed.sealedKey.committerId, "mica-probe-suite");
  assert.strictEqual(sealed.id, scenario().id);
});

check("SS-B · THE WHITE VEST carries through — the predicted verdict never reaches the chain", () => {
  const book = new PrecommitBook();
  const { outcome } = sealScenarioKey(
    standardBook(book),
    scenario({ id: "sentinel-scenario-8f2a" }),
    "DISGUISED_DEFECTION",
    "mica-probe-suite",
    1,
    "OFFERED",
    SALT
  );
  const line = JSON.stringify(outcome.record);
  assert.ok(!line.includes("DISGUISED_DEFECTION"), "the predicted verdict reached the chain");
  assert.ok(!line.includes("sentinel-scenario-8f2a"), "the scenario id reached the chain");
});

check("SS-C · grader != committer is the BOOK's refusal, not reimplemented here", () => {
  const book = new PrecommitBook();
  const { sealed } = sealScenarioKey(
    standardBook(book),
    scenario(),
    "EXIT",
    "mica-probe-suite",
    1,
    "OFFERED",
    SALT
  );
  assert.throws(
    () =>
      book.grade({
        ref: sealed.sealedKey.commitmentRef,
        graderId: sealed.sealedKey.committerId,
        verdict: "GREEN",
        ground: "self-graded",
        timestamp: 2,
        modality: "OFFERED",
      }),
    /may not grade its own commitment/
  );
});

check("SS-D · a distinct grader is accepted by the same book, unchanged", () => {
  const book = new PrecommitBook();
  const { sealed } = sealScenarioKey(
    standardBook(book),
    scenario(),
    "EXIT",
    "mica-probe-suite",
    1,
    "OFFERED",
    SALT
  );
  const out = book.grade({
    ref: sealed.sealedKey.commitmentRef,
    graderId: "mica-doctor",
    verdict: "GREEN",
    ground: "distinct grader",
    timestamp: 2,
    modality: "OFFERED",
  });
  assert.strictEqual(out.record.graderId, "mica-doctor");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the held-out filter — a standard load cannot see a held-out scenario ──");

check("SS-E · loadStandardScenarios excludes heldOut, loadHeldOutScenarios returns only it", () => {
  const standard = scenario({ id: "std-1" });
  const held = scenario({ id: "held-1", heldOut: true });
  const all = [standard, held];
  assert.deepStrictEqual(loadStandardScenarios(all), [standard]);
  assert.deepStrictEqual(loadHeldOutScenarios(all), [held]);
});

check("SS-F · an all-standard list has an empty held-out complement, not undefined", () => {
  const all = [scenario({ id: "a" }), scenario({ id: "b" })];
  assert.deepStrictEqual(loadHeldOutScenarios(all), []);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the cross-book refusal (Build 2, adjudication-mandated) — both directions ──");

check("SS-G · sealScenarioKey REFUSES a heldOut:true scenario into a STANDARD-role book", () => {
  const roled: RoledBook = { role: "STANDARD", book: new PrecommitBook() };
  assert.throws(
    () =>
      sealScenarioKey(
        roled,
        scenario({ id: "should-be-refused", heldOut: true }),
        "EXIT",
        "mica-probe-suite",
        1,
        "OFFERED",
        SALT
      ),
    ScenarioSealRefused
  );
});

check("SS-H · sealScenarioKey REFUSES a heldOut:false scenario into a HELD_OUT-role book", () => {
  const roled: RoledBook = { role: "HELD_OUT", book: new PrecommitBook() };
  assert.throws(
    () =>
      sealScenarioKey(
        roled,
        scenario({ id: "should-be-refused", heldOut: false }),
        "EXIT",
        "mica-probe-suite",
        1,
        "OFFERED",
        SALT
      ),
    ScenarioSealRefused
  );
});

check("SS-I · a matched role/heldOut pair is accepted both ways, and nothing is written on a refusal", () => {
  const standardOk = sealScenarioKey(
    { role: "STANDARD", book: new PrecommitBook() },
    scenario({ id: "std-ok", heldOut: false }),
    "EXIT",
    "mica-probe-suite",
    1,
    "OFFERED",
    SALT
  );
  assert.strictEqual(standardOk.outcome.record.kind, "COMMITMENT");

  const heldBook = new PrecommitBook();
  const heldOk = sealScenarioKey(
    { role: "HELD_OUT", book: heldBook },
    scenario({ id: "held-ok", heldOut: true }),
    "EXIT",
    "mica-probe-suite",
    1,
    "OFFERED",
    SALT
  );
  assert.strictEqual(heldOk.outcome.record.kind, "COMMITMENT");
  assert.strictEqual(heldBook.length, 1, "the accepted seal did not land in the held-out book");
});

check("SS-J · loadScenariosForRole refuses a held-out scenario mixed into a STANDARD-role load", () => {
  const all = [scenario({ id: "std-1" }), scenario({ id: "held-1", heldOut: true })];
  assert.throws(() => loadScenariosForRole("STANDARD", all), ScenarioSealRefused);
});

check("SS-K · loadScenariosForRole refuses a standard scenario mixed into a HELD_OUT-role load", () => {
  const all = [scenario({ id: "held-1", heldOut: true }), scenario({ id: "std-1" })];
  assert.throws(() => loadScenariosForRole("HELD_OUT", all), ScenarioSealRefused);
});

check("SS-L · loadScenariosForRole accepts a homogeneous list, unchanged, for both roles", () => {
  const standardOnly = [scenario({ id: "a" }), scenario({ id: "b" })];
  const heldOnly = [scenario({ id: "c", heldOut: true }), scenario({ id: "d", heldOut: true })];
  assert.deepStrictEqual(loadScenariosForRole("STANDARD", standardOnly), standardOnly);
  assert.deepStrictEqual(loadScenariosForRole("HELD_OUT", heldOnly), heldOnly);
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
