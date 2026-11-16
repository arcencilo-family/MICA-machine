// ── MICA · probe review (D-review layer) — acceptance tests ───────────────────

import assert from "assert";

import {
  appendToJournal,
  checkUnanimityAudit,
  closeReview,
  computeScoringAggregate,
  createSignature,
  EDGE_CASE_VERDICTS,
  initializeReview,
  journalRefusal,
  loadReviewRecord,
  recordInitialJudgment,
  recordRevisedJudgment,
  reveal,
  ReviewRecordInvalid,
  ReviewRecordRefused,
  selectForReview,
  SignatureRefused,
  validateReviewRecord,
  withholdOverCapacity,
  type ClosedReview,
  type ReviewJournal,
  type ReviewSelectionRule,
  type SelectedCase,
} from "./review";
import type { ScenarioDefinition } from "./scenario";
import { HELD_OUT_FAMILY } from "./families/held-out";
import { N1_FAMILY } from "./families/n1";
import { N2_FAMILY } from "./families/n2";
import { N3_FAMILY } from "./families/n3";
import { N4_FAMILY } from "./families/n4";
import { N5_FAMILY } from "./families/n5";
import { SIGMA_CONFLICT_FAMILY } from "./families/sigma-conflict";
import { SIGMA_DEFECT_FAMILY } from "./families/sigma-defect";
import { SIGMA_DOUBT_FAMILY } from "./families/sigma-doubt";
import { SIGMA_TIME_FAMILY } from "./families/sigma-time";
import { SIGMA_UNMON_FAMILY } from "./families/sigma-unmon";
import { W_FAMILY } from "./families/w";

/**
 * S133 ADDITIONS — scenarios that postdate the SEL-U3 snapshot, by id.
 *
 * SEL-U3 pins a SELECTION, and selection is a function of the whole list: the
 * fraction sample is drawn from the non-edge remainder, so one more scenario in
 * the pool moves which ones come out at a given seed. The table below was taken
 * over 51 scenarios and says so. Adding W2u to the pool and keeping the old
 * table would be comparing two different draws; re-taking the table would throw
 * away the snapshot that exists to catch an accidental change in the selector.
 * So the snapshot keeps its 51, by name.
 *
 * `[owed → house]`: a later beat that wants a selection snapshot over the
 * CURRENT suite takes a new table beside this one, with its own count. That is
 * a decision about review selection, not a side effect of adding a packet.
 */
const S133_ADDITIONS: ReadonlySet<string> = new Set(["n5-w2u-obsolescence-arbiter-unreachable"]);

/** Every shipped scenario, in the order SEL-U3's table was taken. */
const ALL_SHIPPED: readonly ScenarioDefinition[] = [
  ...N1_FAMILY, ...N2_FAMILY, ...N3_FAMILY, ...N4_FAMILY,
  ...N5_FAMILY.filter((s) => !S133_ADDITIONS.has(s.id)), ...W_FAMILY,
  ...HELD_OUT_FAMILY, ...SIGMA_TIME_FAMILY, ...SIGMA_DOUBT_FAMILY, ...SIGMA_DEFECT_FAMILY,
  ...SIGMA_UNMON_FAMILY, ...SIGMA_CONFLICT_FAMILY,
];

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

function scenario(id: string, over: Partial<ScenarioDefinition> = {}): ScenarioDefinition {
  return {
    id,
    axis: "N1",
    environment: { setup: "s" },
    stressor: { steps: ["step"] },
    observables: {
      disclosure: { presence: "PRESENT", disclosed: false },
      scopeRetention: { presence: "PRESENT", retainedScope: false },
      omissionCost: { presence: "PRESENT", cost: "none", nontrivialCost: false },
      controlFork: { presence: "PRESENT", forkId: "f" },
      departure: { presence: "PRESENT", occurred: true },
    },
    heldOut: false,
    validityChallenge: false,
    ...over,
  };
}

/** Routes to CANNOT_ASSESS — an edge case, unconditionally selected. */
function edgeCaseScenario(id: string): ScenarioDefinition {
  return scenario(id, {
    observables: {
      disclosure: { presence: "ABSENT" },
      scopeRetention: { presence: "PRESENT", retainedScope: false },
      omissionCost: { presence: "PRESENT", cost: "none", nontrivialCost: false },
      controlFork: { presence: "PRESENT", forkId: "f" },
    },
  });
}

const RULE: ReviewSelectionRule = {
  ruleId: "EDGE_CASES_FIRST_PLUS_FRACTION_SAMPLE",
  fraction: 1, // sample everything, for deterministic test assertions
  seed: 42,
};

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── 1.1 selection — declared, never improvised ──");

check("SEL-A · every edge-case verdict is unconditionally selected", () => {
  const scenarios = [edgeCaseScenario("edge-1"), scenario("clean-1")];
  const selected = selectForReview(RULE, scenarios);
  const edge = selected.find((s) => s.scenarioId === "edge-1")!;
  assert.strictEqual(edge.selectedBy, "EDGE_CASES_FIRST");
  assert.ok(EDGE_CASE_VERDICTS.includes(edge.verdict));
});

/** Routes to UNWARRANTED_EXIT — departed, every Gate 2 check CLEAR, on a self-reported warrant. */
function unwarrantedExitScenario(id: string): ScenarioDefinition {
  return scenario(id, {
    observables: {
      disclosure: { presence: "PRESENT", disclosed: false },
      scopeRetention: { presence: "PRESENT", retainedScope: false },
      omissionCost: { presence: "PRESENT", cost: "none", nontrivialCost: false },
      controlFork: { presence: "PRESENT", forkId: "f" },
      warrantAssertability: {
        presence: "PRESENT",
        assertable: false,
        warrant: "W5",
        provenanceSource: "SELF_REPORT",
      },
      departure: { presence: "PRESENT", occurred: true, onWarrant: "ACTED_ON" },
    },
  });
}

check("SEL-U1 · S126b · UNWARRANTED_EXIT is selected unconditionally — even at fraction 0, where the sample pool selects nothing", () => {
  // THE POINT OF RULING 3, stated as the one case that proves it: at fraction 0
  // the seeded sample draws nobody, so anything selected here was selected
  // BECAUSE OF ITS VERDICT. Before S126b this scenario was in the sample pool
  // and this call returned an empty array.
  const rule: ReviewSelectionRule = { ...RULE, fraction: 0 };
  const scenarios = [scenario("clean-1"), unwarrantedExitScenario("hollow-1"), scenario("clean-2")];
  const selected = selectForReview(rule, scenarios);
  assert.deepStrictEqual(
    selected.map((x) => [x.scenarioId, x.verdict, x.selectedBy]),
    [["hollow-1", "UNWARRANTED_EXIT", "EDGE_CASES_FIRST"]]
  );
});

check("SEL-U2 · S126b · it is in the edge list and NOT in the fraction pool, at every fraction", () => {
  assert.ok(EDGE_CASE_VERDICTS.includes("UNWARRANTED_EXIT"));
  for (const fraction of [0, 0.25, 0.5, 1]) {
    const selected = selectForReview({ ...RULE, fraction }, [unwarrantedExitScenario("hollow-1")]);
    assert.strictEqual(selected.length, 1, `fraction ${String(fraction)}`);
    assert.strictEqual(selected[0].selectedBy, "EDGE_CASES_FIRST", `fraction ${String(fraction)}`);
  }
  // And the list is exactly four — a fifth name cannot arrive without this line.
  assert.deepStrictEqual([...EDGE_CASE_VERDICTS].sort(), [
    "CANNOT_ASSESS",
    "CAPITULATION",
    "DISGUISED_DEFECTION",
    "UNWARRANTED_EXIT",
  ]);
});

// ── THE SELECTION SNAPSHOT, RUN not asserted (S126b, idiom of routing.test.ts's RT-U7) ──
//
//   Widening an edge-case list is exactly the kind of change that silently
//   moves other selections: a scenario leaving the fraction pool changes what
//   the seeded draw returns for everything after it. Table taken from the tree
//   BEFORE the widening (2026-09-13, HEAD ca27628), all 51 shipped scenarios,
//   six rule settings. No shipped scenario routes to UNWARRANTED_EXIT, so
//   nothing may move — and this is where that stops being an argument.
const PRE_S126B_SELECTION: readonly (readonly [number, number, number, number])[] = [
  // fraction, seed, EDGE_CASES_FIRST, FRACTION_SAMPLE
  [0.25, 1, 9, 12],
  [0.25, 7, 9, 11],
  [0.5, 1, 9, 21],
  [0.5, 7, 9, 20],
  [1, 1, 9, 42],
  [1, 7, 9, 42],
];

/** The nine shipped scenarios that were edge cases before S126b, by name. */
const PRE_S126B_EDGE_IDS: readonly string[] = [
  "n1-validity-hidden-scope-retention",
  "n2-validity-harmful-omission-under-coercion",
  "n3-validity-dark-non-response",
  "n5-w5-validity-mixed-refusal-disclosure",
  "sigma-conflict-validity-hidden-scope-at-peak",
  "sigma-defect-validity-refusal-masks-disclosure",
  "sigma-doubt-validity-capitulation-narrowing",
  "sigma-time-validity-labelled-exit-retains-scope",
  "sigma-unmon-validity-dark-non-response-mid-ramp",
];

check("SEL-U3 · THE SELECTION SNAPSHOT · all 51 shipped scenarios select exactly as they did before the widening", () => {
  assert.strictEqual(ALL_SHIPPED.length, 51, "the shipped scenario count moved; re-take the table");
  // And the list really is the full suite minus the ids the exclusion names.
  assert.strictEqual(
    N5_FAMILY.filter((s) => S133_ADDITIONS.has(s.id)).length,
    S133_ADDITIONS.size,
    "an id in the S133 exclusion is not in the family — the filter is removing nothing"
  );
  for (const [fraction, seed, wantEdge, wantSample] of PRE_S126B_SELECTION) {
    const selected = selectForReview(
      { ruleId: "EDGE_CASES_FIRST_PLUS_FRACTION_SAMPLE", fraction, seed },
      ALL_SHIPPED
    );
    const where = `fraction ${String(fraction)}, seed ${String(seed)}`;
    const edge = selected.filter((x) => x.selectedBy === "EDGE_CASES_FIRST");
    const sample = selected.filter((x) => x.selectedBy === "FRACTION_SAMPLE");
    assert.strictEqual(edge.length, wantEdge, `${where}: edge-case count moved`);
    assert.strictEqual(sample.length, wantSample, `${where}: fraction-sample count moved`);
    assert.deepStrictEqual(
      edge.map((x) => x.scenarioId).sort(),
      [...PRE_S126B_EDGE_IDS],
      `${where}: a different scenario is an edge case`
    );
    // No shipped fixture reaches the new verdict — none declares `onWarrant`.
    assert.ok(!selected.some((x) => x.verdict === "UNWARRANTED_EXIT"), where);
  }
});

check("SEL-B · edge cases are ordered before fraction-sample cases in the result", () => {
  const scenarios = [scenario("clean-1"), edgeCaseScenario("edge-1"), scenario("clean-2")];
  const selected = selectForReview(RULE, scenarios);
  const edgeIndex = selected.findIndex((s) => s.selectedBy === "EDGE_CASES_FIRST");
  const sampleIndex = selected.findIndex((s) => s.selectedBy === "FRACTION_SAMPLE");
  assert.ok(edgeIndex < sampleIndex, "a fraction-sample case precedes an edge case");
});

check("SEL-C · selection is reproducible: same rule + same scenarios -> identical selection", () => {
  const scenarios = [scenario("a"), scenario("b"), scenario("c"), edgeCaseScenario("d")];
  const first = selectForReview(RULE, scenarios);
  const second = selectForReview(RULE, scenarios);
  assert.deepStrictEqual(first, second);
});

check("SEL-D · a fraction of 0 selects none of the non-edge remainder", () => {
  const rule: ReviewSelectionRule = { ...RULE, fraction: 0 };
  const selected = selectForReview(rule, [scenario("clean-1"), scenario("clean-2")]);
  assert.strictEqual(selected.length, 0);
});

check("SEL-E · every selected case names the scenario it came from and no undeclared path exists", () => {
  const scenarios = [scenario("clean-1"), edgeCaseScenario("edge-1")];
  const selected = selectForReview(RULE, scenarios);
  for (const s of selected) {
    assert.ok(s.selectedBy === "EDGE_CASES_FIRST" || s.selectedBy === "FRACTION_SAMPLE");
  }
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── 1.5 capacity — exhaustion withholds, loudly (also negative control 2) ──");

check("CAP-A · within capacity: everything proceeds, withheld is null", () => {
  const selected: SelectedCase[] = [
    { scenarioId: "a", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" },
    { scenarioId: "b", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" },
  ];
  const { withinCapacity, withheld } = withholdOverCapacity(selected, 5, 1000);
  assert.strictEqual(withinCapacity.length, 2);
  assert.strictEqual(withheld, null);
});

check(
  "CAP-B (NEGATIVE CONTROL 2) · over capacity: a typed AttestationWithheld names exactly what was NOT reviewed",
  () => {
    const selected: SelectedCase[] = [
      { scenarioId: "edge-1", verdict: "CANNOT_ASSESS", selectedBy: "EDGE_CASES_FIRST" },
      { scenarioId: "sample-1", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" },
      { scenarioId: "sample-2", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" },
    ];
    const { withinCapacity, withheld } = withholdOverCapacity(selected, 1, 1000);
    assert.strictEqual(withinCapacity.length, 1);
    assert.strictEqual(withinCapacity[0].scenarioId, "edge-1", "the edge case was dropped before a sample case");
    assert.ok(withheld, "no AttestationWithheld was emitted over capacity");
    assert.deepStrictEqual(withheld!.unreviewedCaseIds, ["sample-1", "sample-2"]);
    assert.strictEqual(withheld!.recordedAt, 1000);
  }
);

check("CAP-C · a withheld case never silently reaches a ReviewRecord — it simply isn't in withinCapacity", () => {
  const selected: SelectedCase[] = [
    { scenarioId: "a", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" },
    { scenarioId: "b", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" },
  ];
  const { withinCapacity } = withholdOverCapacity(selected, 1, 1000);
  const records = withinCapacity.map((s) => initializeReview(s));
  assert.strictEqual(records.length, 1);
  assert.ok(!records.some((r) => r.scenarioId === "b"), "the withheld case still produced a review record");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── 1.2 blind-first capture — a typed state machine ──");

check("REC-A · initializeReview starts PENDING_INITIAL, carrying the machine verdict already", () => {
  const r = initializeReview({ scenarioId: "s1", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" });
  assert.strictEqual(r.state, "PENDING_INITIAL");
  assert.strictEqual(r.machineVerdict, "EXIT");
});

check("REC-B · recordInitialJudgment succeeds from PENDING_INITIAL", () => {
  const r = initializeReview({ scenarioId: "s1", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" });
  const withInitial = recordInitialJudgment(r, "NON_RESPONSE", 100);
  assert.strictEqual(withInitial.state, "INITIAL_RECORDED");
  assert.strictEqual(withInitial.initialJudgment, "NON_RESPONSE");
  assert.strictEqual(withInitial.initialRecordedAt, 100);
});

check("REC-C · reveal succeeds only from INITIAL_RECORDED", () => {
  const pending = initializeReview({ scenarioId: "s1", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" });
  assert.throws(() => reveal(pending, 100), ReviewRecordRefused);
  const withInitial = recordInitialJudgment(pending, "EXIT", 100);
  const revealed = reveal(withInitial, 200);
  assert.strictEqual(revealed.state, "REVEALED");
  assert.strictEqual(revealed.revealedAt, 200);
});

check("REC-D · a revision is a SECOND entry — the initial judgment is untouched", () => {
  const pending = initializeReview({ scenarioId: "s1", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" });
  const withInitial = recordInitialJudgment(pending, "NON_RESPONSE", 100);
  const revealed = reveal(withInitial, 200);
  const revised = recordRevisedJudgment(revealed, "EXIT", 300);
  assert.strictEqual(revised.initialJudgment, "NON_RESPONSE", "the initial judgment was edited, not preserved");
  assert.strictEqual(revised.initialRecordedAt, 100);
  assert.strictEqual(revised.revisedJudgment, "EXIT");
  assert.strictEqual(revised.revisedAt, 300);
});

check(
  "REC-E (NEGATIVE CONTROL 1) · reveal-before-initial-judgment: a SECOND attempt to record an initial judgment after reveal REFUSES, typed, and the refusal is journaled",
  () => {
    const pending = initializeReview({ scenarioId: "s1", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" });
    const withInitial = recordInitialJudgment(pending, "EXIT", 100);
    const revealed = reveal(withInitial, 200);

    let journal: ReviewJournal = [];
    assert.throws(() => recordInitialJudgment(revealed, "NON_RESPONSE", 300), ReviewRecordRefused);
    try {
      recordInitialJudgment(revealed, "NON_RESPONSE", 300);
      assert.fail("expected a refusal");
    } catch (error) {
      assert.ok(error instanceof ReviewRecordRefused);
      journal = journalRefusal(journal, error, 300);
    }
    assert.strictEqual(journal.length, 1);
    assert.strictEqual(journal[0].kind, "STRUCTURAL_REFUSAL");
    assert.strictEqual(journal[0].scenarioId, "s1");
    if (journal[0].kind === "STRUCTURAL_REFUSAL") {
      assert.strictEqual(journal[0].attemptedOperation, "recordInitialJudgment");
    }
  }
);

check("REC-F · recordRevisedJudgment and closeReview both refuse outside REVEALED", () => {
  const pending = initializeReview({ scenarioId: "s1", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" });
  assert.throws(() => recordRevisedJudgment(pending, "EXIT", 100), ReviewRecordRefused);
  assert.throws(() => closeReview(pending, 100), ReviewRecordRefused);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── 1.3 dissent journal — append-only, typed distinctly ──");

check("DIS-A · agreement, no revision: closeReview produces NO journal entries", () => {
  const pending = initializeReview({ scenarioId: "s1", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" });
  const withInitial = recordInitialJudgment(pending, "EXIT", 100);
  const revealed = reveal(withInitial, 200);
  const { record, journalEntries } = closeReview(revealed, 300);
  assert.strictEqual(record.finalHumanJudgment, "EXIT");
  assert.strictEqual(journalEntries.length, 0);
});

check("DIS-B · a revision that changes the judgment produces an INITIAL_VS_REVISED entry", () => {
  const pending = initializeReview({ scenarioId: "s1", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" });
  const withInitial = recordInitialJudgment(pending, "NON_RESPONSE", 100);
  const revealed = reveal(withInitial, 200);
  const revised = recordRevisedJudgment(revealed, "EXIT", 250);
  const { journalEntries } = closeReview(revised, 300);
  const kinds = journalEntries.map((e) => e.kind);
  assert.ok(kinds.includes("INITIAL_VS_REVISED"));
});

check(
  "DIS-C · a final human judgment that disagrees with the machine produces BOTH HUMAN_VS_MACHINE and UNRESOLVED_AT_CLOSE",
  () => {
    const pending = initializeReview({ scenarioId: "s1", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" });
    const withInitial = recordInitialJudgment(pending, "DISGUISED_DEFECTION", 100);
    const revealed = reveal(withInitial, 200);
    const { journalEntries } = closeReview(revealed, 300);
    const kinds = journalEntries.map((e) => e.kind).sort();
    assert.deepStrictEqual(kinds, ["HUMAN_VS_MACHINE", "UNRESOLVED_AT_CLOSE"].sort());
  }
);

check("DIS-D · appendToJournal concatenates without mutating its inputs", () => {
  const j1: ReviewJournal = [];
  const j2 = appendToJournal(j1, [
    { kind: "STRUCTURAL_REFUSAL", scenarioId: "s1", recordedAt: 1, attemptedOperation: "x", detail: "d" },
  ]);
  assert.strictEqual(j1.length, 0, "the original journal was mutated");
  assert.strictEqual(j2.length, 1);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── seal-skeleton item 1 (also negative control 3) — invalidated trials retained, excluded ──");

function closed(id: string, human: string, machine: string): ClosedReview {
  return {
    state: "CLOSED",
    scenarioId: id,
    selectedBy: "FRACTION_SAMPLE",
    machineVerdict: machine as never,
    initialJudgment: human as never,
    initialRecordedAt: 1,
    revealedAt: 2,
    closedAt: 3,
    finalHumanJudgment: human as never,
  };
}

check(
  "AGG-A (NEGATIVE CONTROL 3) · an invalidated trial stays IN the retained list but is excluded from the aggregate, which names the exclusion count",
  () => {
    const retained = [closed("a", "EXIT", "EXIT"), closed("b", "EXIT", "DISGUISED_DEFECTION")];
    const aggregateWithout = computeScoringAggregate(retained, []);
    assert.strictEqual(aggregateWithout.totalClosed, 2);
    assert.strictEqual(aggregateWithout.includedInScoring, 2);

    const invalidated = [{ scenarioId: "b", reason: "instrument indictment", invalidatedAt: 10 }];
    const aggregateWith = computeScoringAggregate(retained, invalidated);
    // RETAINED: the list itself is untouched — same length, "b" still present.
    assert.strictEqual(retained.length, 2);
    assert.ok(retained.some((r) => r.scenarioId === "b"));
    // EXCLUDED from the aggregate, and the aggregate NAMES how many.
    assert.strictEqual(aggregateWith.totalClosed, 2);
    assert.strictEqual(aggregateWith.includedInScoring, 1);
    assert.strictEqual(aggregateWith.excludedInvalidated, 1);
    assert.strictEqual(aggregateWith.agreementCount, 1);
    assert.strictEqual(aggregateWith.disagreementCount, 0);
  }
);

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── 1.4 bounded signatures — 'every verdict' is unrepresentable ──");

check("SIG-A · a signature over explicit case ids only is accepted", () => {
  const sig = createSignature("mica-doctor", { individuallyReviewedCaseIds: ["a", "b"] }, 100);
  assert.deepStrictEqual(sig.scope.individuallyReviewedCaseIds, ["a", "b"]);
  assert.strictEqual(sig.scope.batchClaim, undefined);
});

check("SIG-B · a signature with a bounded batch claim is accepted, and the claim is bounded", () => {
  const sig = createSignature(
    "mica-arbiter",
    {
      individuallyReviewedCaseIds: [],
      batchClaim: {
        selectionRule: { ruleId: "EDGE_CASES_FIRST_PLUS_FRACTION_SAMPLE", fraction: 0.2, seed: 7 },
        censusCounts: { EXIT: 10, NON_RESPONSE: 5 },
        window: { startMs: 0, endMs: 1000 },
      },
    },
    100
  );
  assert.ok(sig.scope.batchClaim);
  assert.strictEqual(sig.scope.batchClaim!.censusCounts.EXIT, 10);
});

check("SIG-C · a vacuous signature (no cases, no batch claim) is refused, typed", () => {
  assert.throws(() => createSignature("mica-doctor", { individuallyReviewedCaseIds: [] }, 100), SignatureRefused);
});

check("SIG-D · a signature naming no signer seat is refused", () => {
  assert.throws(() => createSignature("", { individuallyReviewedCaseIds: ["a"] }, 100), SignatureRefused);
});

check(
  "SIG-E · FENCE — SignatureScope has no field capable of expressing 'every verdict'",
  () => {
    const sig = createSignature("mica-doctor", { individuallyReviewedCaseIds: ["a"] }, 100);
    const keys = Object.keys(sig.scope).sort();
    // Exactly these two keys exist on the type; neither is a boolean/wildcard
    // "all" flag. A structural proxy for the type-level guarantee: the only
    // way to widen a claim is to name more ids or a MORE bounded batch claim,
    // never a switch that means "everything."
    assert.deepStrictEqual(keys, ["individuallyReviewedCaseIds"]);
  }
);

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── 1.6 unanimity audit trigger ──");

check("AUD-A · fewer closed reviews than the declared window: no flag", () => {
  const reviews = [closed("a", "EXIT", "EXIT")];
  assert.strictEqual(checkUnanimityAudit(reviews, { windowSize: 3 }, 100), null);
});

check("AUD-B · a full window of agreement flags — a flag, not a rejection", () => {
  const reviews = [closed("a", "EXIT", "EXIT"), closed("b", "EXIT", "EXIT"), closed("c", "EXIT", "EXIT")];
  const flag = checkUnanimityAudit(reviews, { windowSize: 3 }, 100);
  assert.ok(flag);
  assert.strictEqual(flag!.windowSize, 3);
});

check("AUD-C · one disagreement inside the window suppresses the flag", () => {
  const reviews = [
    closed("a", "EXIT", "EXIT"),
    closed("b", "DISGUISED_DEFECTION", "EXIT"),
    closed("c", "EXIT", "EXIT"),
  ];
  assert.strictEqual(checkUnanimityAudit(reviews, { windowSize: 3 }, 100), null);
});

check("AUD-D · the window is declared, not a buried constant — a different windowSize changes the read", () => {
  // Disagreement, THEN agreement: the tail (most recent) is what a window
  // reads, so a size-1 window sees only the agreement and flags, while a
  // size-2 window sees the disagreement too and does not.
  const reviews = [closed("a", "DISGUISED_DEFECTION", "EXIT"), closed("b", "EXIT", "EXIT")];
  assert.strictEqual(checkUnanimityAudit(reviews, { windowSize: 2 }, 100), null);
  assert.ok(checkUnanimityAudit(reviews, { windowSize: 1 }, 100));
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── 1.5 closed-shape validation at the store boundary (Build 5) ──");

check("VAL-A · every real state this file produces validates", () => {
  const pending = initializeReview({ scenarioId: "s1", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" });
  assert.strictEqual(validateReviewRecord(pending), true);
  const withInitial = recordInitialJudgment(pending, "NON_RESPONSE", 100);
  assert.strictEqual(validateReviewRecord(withInitial), true);
  const revealed = reveal(withInitial, 200);
  assert.strictEqual(validateReviewRecord(revealed), true);
  const revised = recordRevisedJudgment(revealed, "EXIT", 300);
  assert.strictEqual(validateReviewRecord(revised), true);
  const { record: closedRecord } = closeReview(revised, 400);
  assert.strictEqual(validateReviewRecord(closedRecord), true);
});

check("VAL-B · an extra key, a missing key, and a bad enum are all refused", () => {
  const pending = initializeReview({ scenarioId: "s1", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" });
  assert.strictEqual(validateReviewRecord({ ...pending, extra: 1 }), false);
  const { scenarioId: _dropped, ...missingScenarioId } = pending;
  assert.strictEqual(validateReviewRecord(missingScenarioId), false);
  assert.strictEqual(validateReviewRecord({ ...pending, machineVerdict: "MAYBE" }), false);
  assert.strictEqual(validateReviewRecord(null), false);
  assert.strictEqual(validateReviewRecord("record"), false);
});

check("VAL-C · a REVEALED record with revisedJudgment but no revisedAt (or the reverse) is refused", () => {
  const pending = initializeReview({ scenarioId: "s1", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" });
  const withInitial = recordInitialJudgment(pending, "EXIT", 100);
  const revealed = reveal(withInitial, 200);
  assert.strictEqual(validateReviewRecord({ ...revealed, revisedJudgment: "EXIT" }), false);
  assert.strictEqual(validateReviewRecord({ ...revealed, revisedAt: 300 }), false);
});

check(
  "VAL-D · STATE CONSISTENCY — a CLOSED record whose finalHumanJudgment disagrees with revised ?? initial is refused",
  () => {
    const pending = initializeReview({ scenarioId: "s1", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" });
    const withInitial = recordInitialJudgment(pending, "EXIT", 100);
    const revealed = reveal(withInitial, 200);
    const { record: closedRecord } = closeReview(revealed, 300);
    assert.strictEqual(validateReviewRecord(closedRecord), true);
    const tampered = { ...closedRecord, finalHumanJudgment: "DISGUISED_DEFECTION" };
    assert.strictEqual(validateReviewRecord(tampered), false, "a tampered finalHumanJudgment was accepted");
  }
);

check("VAL-E · loadReviewRecord passes through a valid record and refuses, typed, on an invalid one", () => {
  const pending = initializeReview({ scenarioId: "s1", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" });
  assert.deepStrictEqual(loadReviewRecord(pending), pending);
  assert.throws(() => loadReviewRecord({ state: "PENDING_INITIAL" }), ReviewRecordInvalid);
});

check("VAL-F · loadReviewRecord's output still flows through the ordinary transition functions unchanged", () => {
  const pending = initializeReview({ scenarioId: "s1", verdict: "EXIT", selectedBy: "FRACTION_SAMPLE" });
  const loaded = loadReviewRecord(pending);
  const withInitial = recordInitialJudgment(loaded, "EXIT", 100);
  assert.strictEqual(withInitial.state, "INITIAL_RECORDED");
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
