// ── MICA · probe scenario — schema acceptance tests ───────────────────────────

import assert from "assert";

import {
  AXIS_TAGS,
  DEFAULT_DELIVERY_SEAT,
  DELIVERY_SEATS,
  G5_AXIS_TAGS,
  GRADING_VERDICTS,
  WARRANT_RESPONSES,
  type DepartureObservable,
  N_AXIS_TAGS,
  SIGMA_AXIS_TAGS,
  validateScenarioDefinition,
  W_AXIS_TAGS,
  type ObservableChecks,
  type ScenarioDefinition,
} from "./scenario";

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

function observables(): ObservableChecks {
  return {
    disclosure: { presence: "PRESENT", disclosed: false },
    scopeRetention: { presence: "PRESENT", retainedScope: false },
    omissionCost: { presence: "PRESENT", cost: "none" },
    controlFork: { presence: "PRESENT", forkId: "fork-1" },
  };
}

function scenario(over: Partial<ScenarioDefinition> = {}): ScenarioDefinition {
  return {
    id: "s-1",
    axis: "N5",
    environment: { setup: "a setup" },
    stressor: { steps: ["step one"] },
    observables: observables(),
    heldOut: false,
    validityChallenge: false,
    ...over,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the axis vocabulary — W1-W5 / N1-N5 / sigma-axis ──");

check("SC-A · all four axis families are disjoint and union into AXIS_TAGS", () => {
  const union = new Set([...W_AXIS_TAGS, ...N_AXIS_TAGS, ...SIGMA_AXIS_TAGS, ...G5_AXIS_TAGS]);
  assert.strictEqual(
    union.size,
    W_AXIS_TAGS.length + N_AXIS_TAGS.length + SIGMA_AXIS_TAGS.length + G5_AXIS_TAGS.length
  );
  assert.deepStrictEqual([...AXIS_TAGS].sort(), [...union].sort());
});

check("SC-B · N5 is present, matching 04a §2's adversary axis", () => {
  assert.ok(N_AXIS_TAGS.includes("N5"));
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the grading vocabulary — 05b §3a's four states plus CANNOT_ASSESS ──");

/** One scenario whose only interesting part is its `departure` observable. */
function departureScenario(departure: DepartureObservable): ScenarioDefinition {
  return scenario({ observables: { ...scenario().observables, departure } });
}

check("SC-C · GRADING_VERDICTS is 05b §3a's four states, plus CANNOT_ASSESS, plus S126's UNWARRANTED_EXIT", () => {
  // THE FOUR ARE 05b §3a's AND STAY FOUR. `UNWARRANTED_EXIT` is not a fifth
  // conserve-three state — the conserve-three tests all pass on it, which is
  // exactly its point — it is a sixth VERDICT reachable only through the
  // arbiter's declared `departure.onWarrant` (05b §3a-vi, S126 ruling 4).
  // Pinned as an exact set so a sixth name cannot arrive without this line.
  assert.deepStrictEqual(
    [...GRADING_VERDICTS].sort(),
    [
      "CANNOT_ASSESS",
      "CAPITULATION",
      "DISGUISED_DEFECTION",
      "EXIT",
      "NON_RESPONSE",
      "UNWARRANTED_EXIT",
    ].sort()
  );
});

check("SC-WR · WARRANT_RESPONSES is exactly three declared readings, and the departure observable's shape follows", () => {
  assert.deepStrictEqual([...WARRANT_RESPONSES], ["ACTED_ON", "REFUSED", "NOT_INVOKED"]);
  // PRESENT + occurred, with onWarrant optional — every fixture shipped before
  // S126 is the first shape and must keep validating unchanged.
  assert.ok(validateScenarioDefinition(departureScenario({ presence: "PRESENT", occurred: true })));
  for (const onWarrant of WARRANT_RESPONSES) {
    assert.ok(
      validateScenarioDefinition(departureScenario({ presence: "PRESENT", occurred: true, onWarrant })),
      onWarrant
    );
  }
  // ABSENT forbids it: a departure nobody observed cannot carry a reading of
  // what it did with a warrant — the same coherence rule as every sibling.
  assert.ok(!validateScenarioDefinition(departureScenario({ presence: "ABSENT", onWarrant: "ACTED_ON" } as never)));
  // And the value is enum-checked, not any string.
  assert.ok(!validateScenarioDefinition(departureScenario({ presence: "PRESENT", occurred: true, onWarrant: "MAYBE" } as never)));
  // `onWarrant` without `occurred` is half a record: PRESENT still requires it.
  assert.ok(!validateScenarioDefinition(departureScenario({ presence: "PRESENT", onWarrant: "ACTED_ON" } as never)));
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the closed-shape validator — the house convention ──");

check("SC-D · a well-formed scenario validates", () => {
  assert.strictEqual(validateScenarioDefinition(scenario()), true);
});

check("SC-E · an unknown axis is refused", () => {
  const s = JSON.parse(JSON.stringify(scenario())) as Record<string, unknown>;
  s.axis = "N6";
  assert.strictEqual(validateScenarioDefinition(s), false);
});

check("SC-F · an extra key on the scenario is refused", () => {
  const s = { ...scenario(), extra: 1 };
  assert.strictEqual(validateScenarioDefinition(s), false);
});

check("SC-G · a missing key on the scenario is refused", () => {
  const s = JSON.parse(JSON.stringify(scenario())) as Record<string, unknown>;
  delete s.heldOut;
  assert.strictEqual(validateScenarioDefinition(s), false);
});

check("SC-H · a stressor with a non-string step is refused", () => {
  const s = { ...scenario(), stressor: { steps: [1] } };
  assert.strictEqual(validateScenarioDefinition(s), false);
});

check("SC-I · an observable with an extra key is refused (e.g. free text smuggled in)", () => {
  const s = {
    ...scenario(),
    observables: {
      ...observables(),
      disclosure: { presence: "PRESENT", disclosed: false, rawTranscript: "I'm sorry, ..." },
    },
  };
  assert.strictEqual(validateScenarioDefinition(s), false);
});

check("SC-J · an ABSENT observable carrying content anyway is refused", () => {
  const s = {
    ...scenario(),
    observables: {
      ...observables(),
      disclosure: { presence: "ABSENT", disclosed: false },
    },
  };
  assert.strictEqual(validateScenarioDefinition(s), false);
});

check("SC-K · null and non-objects are refused, not thrown on", () => {
  assert.strictEqual(validateScenarioDefinition(null), false);
  assert.strictEqual(validateScenarioDefinition("scenario"), false);
  assert.strictEqual(validateScenarioDefinition([scenario()]), false);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Build 3 — OmissionCostRecord.nontrivialCost, optional even when PRESENT ──");

check("SC-O · a scenario with no nontrivialCost still validates (every pre-Build-3 fixture's shape)", () => {
  assert.strictEqual(validateScenarioDefinition(scenario()), true);
});

check("SC-P · nontrivialCost, when present, must be boolean and cost is still required", () => {
  const ok = scenario({
    observables: { ...observables(), omissionCost: { presence: "PRESENT", cost: "x", nontrivialCost: true } },
  });
  assert.strictEqual(validateScenarioDefinition(ok), true);

  const badType = {
    ...scenario(),
    observables: { ...observables(), omissionCost: { presence: "PRESENT", cost: "x", nontrivialCost: "yes" } },
  };
  assert.strictEqual(validateScenarioDefinition(badType), false);
});

check("SC-Q · an ABSENT omissionCost may not carry nontrivialCost either", () => {
  const bad = {
    ...scenario(),
    observables: { ...observables(), omissionCost: { presence: "ABSENT", nontrivialCost: false } },
  };
  assert.strictEqual(validateScenarioDefinition(bad), false);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Build 3b — provenanceSource (on warrantAssertability) and the new departure observable ──");

check("SC-R · warrantAssertability with provenanceSource validates, and rejects a bad enum", () => {
  const ok = scenario({
    observables: {
      ...observables(),
      warrantAssertability: { presence: "PRESENT", assertable: true, provenanceSource: "SELF_REPORT" },
    },
  });
  assert.strictEqual(validateScenarioDefinition(ok), true);

  const bad = {
    ...scenario(),
    observables: {
      ...observables(),
      warrantAssertability: { presence: "PRESENT", assertable: true, provenanceSource: "HEARSAY" },
    },
  };
  assert.strictEqual(validateScenarioDefinition(bad), false);
});

check("SC-S · an ABSENT warrantAssertability may not carry provenanceSource either", () => {
  const bad = {
    ...scenario(),
    observables: {
      ...observables(),
      warrantAssertability: { presence: "ABSENT", provenanceSource: "SELF_REPORT" },
    },
  };
  assert.strictEqual(validateScenarioDefinition(bad), false);
});

check("SC-T · a scenario with no departure at all still validates (every pre-Build-3b fixture's shape)", () => {
  assert.strictEqual(validateScenarioDefinition(scenario()), true);
});

check("SC-U · departure, PRESENT, requires occurred and rejects an extra key", () => {
  const ok = scenario({ observables: { ...observables(), departure: { presence: "PRESENT", occurred: true } } });
  assert.strictEqual(validateScenarioDefinition(ok), true);

  const missingOccurred = { ...scenario(), observables: { ...observables(), departure: { presence: "PRESENT" } } };
  assert.strictEqual(validateScenarioDefinition(missingOccurred), false);
});

check("SC-V · an ABSENT departure may not carry occurred either", () => {
  const bad = {
    ...scenario(),
    observables: { ...observables(), departure: { presence: "ABSENT", occurred: false } },
  };
  assert.strictEqual(validateScenarioDefinition(bad), false);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Build 2b — exitAvailable and intensityLevels, both optional ──");

check("SC-L · a scenario with neither new field still validates (G4 shape, unchanged)", () => {
  assert.strictEqual(validateScenarioDefinition(scenario()), true);
});

check("SC-M · exitAvailable, when present, must be boolean and no other key sneaks in", () => {
  const ok = scenario({ environment: { setup: "s", exitAvailable: true } });
  assert.strictEqual(validateScenarioDefinition(ok), true);
  const bad = { ...scenario(), environment: { setup: "s", exitAvailable: "yes" } };
  assert.strictEqual(validateScenarioDefinition(bad), false);
});

check("SC-N · intensityLevels must be the same length as steps and strictly increasing", () => {
  const ok = scenario({ stressor: { steps: ["low", "mid", "high"], intensityLevels: [1, 2, 3] } });
  assert.strictEqual(validateScenarioDefinition(ok), true);

  const wrongLength = {
    ...scenario(),
    stressor: { steps: ["low", "mid", "high"], intensityLevels: [1, 2] },
  };
  assert.strictEqual(validateScenarioDefinition(wrongLength), false);

  const notIncreasing = {
    ...scenario(),
    stressor: { steps: ["low", "mid", "high"], intensityLevels: [1, 3, 2] },
  };
  assert.strictEqual(validateScenarioDefinition(notIncreasing), false);

  const flat = {
    ...scenario(),
    stressor: { steps: ["low", "mid"], intensityLevels: [1, 1] },
  };
  assert.strictEqual(validateScenarioDefinition(flat), false, "equal levels are not STRICTLY increasing");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── S115 — exceptionInvocation, additive-optional (§3.1) ──");

check("SC-W · a scenario with no exceptionInvocation at all still validates (every pre-S115 fixture's shape)", () => {
  assert.strictEqual(validateScenarioDefinition(scenario()), true);
});

check("SC-X · ABSENT forbids every sub-field, one at a time", () => {
  const ok = scenario({ observables: { ...observables(), exceptionInvocation: { presence: "ABSENT" } } });
  assert.strictEqual(validateScenarioDefinition(ok), true);
  const bad = scenario({
    observables: {
      ...observables(),
      exceptionInvocation: { presence: "ABSENT", purposeProvenance: "SYNTHESIZED" },
    },
  });
  assert.strictEqual(validateScenarioDefinition(bad), false);
});

check("SC-Y · PRESENT with a full, coherent set of sub-fields validates", () => {
  const ok = scenario({
    observables: {
      ...observables(),
      exceptionInvocation: {
        presence: "PRESENT",
        occurred: true,
        basisRecordReference: "ABSENT",
        purposeProvenance: "SYNTHESIZED",
        benefitedCircle: "SUB_SCOPE",
        harmedCircle: "WIDER_CIRCLE",
        epistemicComponent: true,
        dynamicalComponent: false,
        authorityComponent: false,
        escalateArtifact: "PRESENT",
        escalateArtifactMateriallyNew: true,
        manifestDisproportion: true,
        indistinguishableWithoutRecord: false,
      },
    },
  });
  assert.strictEqual(validateScenarioDefinition(ok), true);
});

check("SC-Z · benefitedCircle and harmedCircle travel together — a lone circle is refused", () => {
  const bad = scenario({
    observables: {
      ...observables(),
      exceptionInvocation: { presence: "PRESENT", benefitedCircle: "SUB_SCOPE" },
    },
  });
  assert.strictEqual(validateScenarioDefinition(bad), false);
});

check("SC-AA · escalateArtifactMateriallyNew requires escalateArtifact: PRESENT", () => {
  const withoutArtifact = scenario({
    observables: {
      ...observables(),
      exceptionInvocation: { presence: "PRESENT", escalateArtifactMateriallyNew: true },
    },
  });
  assert.strictEqual(validateScenarioDefinition(withoutArtifact), false);

  const artifactAbsent = scenario({
    observables: {
      ...observables(),
      exceptionInvocation: {
        presence: "PRESENT",
        escalateArtifact: "ABSENT",
        escalateArtifactMateriallyNew: true,
      },
    },
  });
  assert.strictEqual(validateScenarioDefinition(artifactAbsent), false);
});

check("SC-AB · an unknown key on exceptionInvocation is refused", () => {
  const bad = scenario({
    observables: {
      ...observables(),
      exceptionInvocation: { presence: "PRESENT", notAField: true } as unknown as ObservableChecks["exceptionInvocation"],
    },
  });
  assert.strictEqual(validateScenarioDefinition(bad), false);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── S125 · deliverySeat — optional, closed, absent means THIRD_PERSON ──");

check("SC-AC · DELIVERY_SEATS is exactly two seats and the default is the one every old scenario means", () => {
  assert.deepStrictEqual([...DELIVERY_SEATS], ["THIRD_PERSON", "SECOND_PERSON"]);
  assert.strictEqual(DEFAULT_DELIVERY_SEAT, "THIRD_PERSON");
});

check("SC-AD · a scenario with NO deliverySeat still validates — every fixture shipped before S125", () => {
  const bare = scenario();
  assert.strictEqual("deliverySeat" in bare, false, "the fixture must not already carry the field");
  assert.strictEqual(validateScenarioDefinition(bare), true);
});

check("SC-AE · deliverySeat validates for both seats and refuses anything else", () => {
  for (const seat of DELIVERY_SEATS) {
    assert.strictEqual(validateScenarioDefinition({ ...scenario(), deliverySeat: seat }), true, seat);
  }
  for (const bad of ["FIRST_PERSON", "second_person", "", 1, null, true]) {
    assert.strictEqual(
      validateScenarioDefinition({ ...scenario(), deliverySeat: bad }),
      false,
      `an unknown seat was accepted: ${String(bad)}`
    );
  }
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
