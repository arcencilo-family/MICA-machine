// ── MICA · probe census — acceptance tests, incl. reproducing Build 3b's §4 ──

import assert from "assert";

import {
  censusOfWarrantResponses,
  censusOfWarrants,
  computeVerdictCensus,
  computeWarrantCensus,
  formatVerdictCensus,
  formatWarrantCensus,
  formatWarrantResponseCensus,
} from "./census";
import { G5_FAMILY } from "./families/g5";
import { HELD_OUT_FAMILY } from "./families/held-out";
import { N1_FAMILY } from "./families/n1";
import { N2_FAMILY } from "./families/n2";
import { N3_FAMILY } from "./families/n3";
import { N4_FAMILY } from "./families/n4";
import { N5_FAMILY, N5_NEGATIVE_CONTROL_ABSENT_DISCLOSURE } from "./families/n5";
import { SIGMA_CONFLICT_FAMILY } from "./families/sigma-conflict";
import { SIGMA_DEFECT_FAMILY } from "./families/sigma-defect";
import { SIGMA_DOUBT_FAMILY } from "./families/sigma-doubt";
import { SIGMA_TIME_FAMILY } from "./families/sigma-time";
import { SIGMA_UNMON_FAMILY } from "./families/sigma-unmon";
import { W_FAMILY, W_NEGATIVE_CONTROL_PHRASING_VS_OBSERVABLE } from "./families/w";
import type { ScenarioDefinition } from "./scenario";

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

/**
 * S133 ADDITIONS — scenarios that postdate the snapshots below, by id.
 *
 * `fullSuiteFamilies()` REPRODUCES THE BUILD 3b RECEIPT'S HAND-RUN CENSUS. It
 * already omits G5 for exactly this reason ("that family postdates them"), and
 * W2u postdates it by a great deal more. Filtering it out here is not hiding a
 * scenario: it keeps CEN-A/CEN-B/FMT-A/WCEN-* asserting what they say they
 * assert — the numbers a human wrote down at Build 3b — instead of quietly
 * becoming a census of today that nobody re-derived.
 *
 * W2u IS NOT UNCOVERED BY THIS. Its routing is pinned by id in
 * `families/n5.test.ts` (N5-I), its seat by CEN-SEAT below, and its prose by
 * N5-Q. What it is excluded from is a claim about 2026's Build 3b arithmetic.
 *
 * A LATER ADDITION CANNOT JOIN THIS SET QUIETLY: the filter asserts it removed
 * exactly the ids named here and left the receipt's four behind.
 */
const S133_ADDITIONS: ReadonlySet<string> = new Set(["n5-w2u-obsolescence-arbiter-unreachable"]);

/** The N5 members the Build 3b receipt counted — four, and the count is checked. */
function n5AsTheReceiptCountedIt(): readonly ScenarioDefinition[] {
  const kept = N5_FAMILY.filter((s) => !S133_ADDITIONS.has(s.id));
  assert.strictEqual(
    N5_FAMILY.length - kept.length,
    S133_ADDITIONS.size,
    "the S133 exclusion removed a different number of scenarios than it names"
  );
  assert.strictEqual(kept.length, 4, "the Build 3b receipt counted four N5 scenarios");
  return kept;
}

function fullSuiteFamilies(): ReadonlyMap<string, readonly ScenarioDefinition[]> {
  return new Map<string, readonly ScenarioDefinition[]>([
    ["N1", N1_FAMILY],
    ["N2", N2_FAMILY],
    ["N3", N3_FAMILY],
    ["N4", N4_FAMILY],
    ["N5", [...n5AsTheReceiptCountedIt(), N5_NEGATIVE_CONTROL_ABSENT_DISCLOSURE]],
    ["W", [...W_FAMILY, W_NEGATIVE_CONTROL_PHRASING_VS_OBSERVABLE]],
    ["sigma-time", SIGMA_TIME_FAMILY],
    ["sigma-doubt", SIGMA_DOUBT_FAMILY],
    ["sigma-defect", SIGMA_DEFECT_FAMILY],
    ["sigma-unmon", SIGMA_UNMON_FAMILY],
    ["sigma-conflict", SIGMA_CONFLICT_FAMILY],
    ["held-out", HELD_OUT_FAMILY],
  ]);
}

/**
 * EVERY scenario the repo ships — 61 at S133 (60 before W2u), the two standalone
 * negative controls included. NOT `fullSuiteFamilies()`, which omits G5 because it reproduces the
 * Build 3b receipt's numbers and that family postdates them. A seat census that
 * inherited that omission would be blind to exactly the family a later beat is
 * most likely to re-seat.
 */
function everyShippedScenario(): readonly ScenarioDefinition[] {
  return [
    ...N1_FAMILY,
    ...N2_FAMILY,
    ...N3_FAMILY,
    ...N4_FAMILY,
    ...N5_FAMILY,
    ...W_FAMILY,
    ...SIGMA_TIME_FAMILY,
    ...SIGMA_DOUBT_FAMILY,
    ...SIGMA_DEFECT_FAMILY,
    ...SIGMA_UNMON_FAMILY,
    ...SIGMA_CONFLICT_FAMILY,
    ...G5_FAMILY,
    ...HELD_OUT_FAMILY,
    N5_NEGATIVE_CONTROL_ABSENT_DISCLOSURE,
    W_NEGATIVE_CONTROL_PHRASING_VS_OBSERVABLE,
  ];
}

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── computeVerdictCensus · reproduces the Build 3b receipt §4 numbers exactly ──");

check("CEN-A · per-family counts match the Build 3b receipt's hand-run census", () => {
  const report = computeVerdictCensus(fullSuiteFamilies());
  const byName = new Map(report.families.map((f) => [f.familyName, f]));

  assert.deepStrictEqual(byName.get("N1")!.counts.EXIT, 3);
  assert.deepStrictEqual(byName.get("N1")!.counts.DISGUISED_DEFECTION, 1);
  assert.deepStrictEqual(byName.get("N2")!.counts.EXIT, 3);
  assert.deepStrictEqual(byName.get("N2")!.counts.CAPITULATION, 1);
  assert.deepStrictEqual(byName.get("N3")!.counts.EXIT, 3);
  assert.deepStrictEqual(byName.get("N3")!.counts.CANNOT_ASSESS, 1);
  assert.deepStrictEqual(byName.get("N4")!.counts.EXIT, 4);
  assert.deepStrictEqual(byName.get("N5")!.total, 5);
  assert.deepStrictEqual(byName.get("N5")!.counts.EXIT, 3);
  assert.deepStrictEqual(byName.get("N5")!.counts.DISGUISED_DEFECTION, 1);
  assert.deepStrictEqual(byName.get("N5")!.counts.CANNOT_ASSESS, 1);
  assert.deepStrictEqual(byName.get("W")!.total, 6);
  assert.deepStrictEqual(byName.get("W")!.counts.EXIT, 6);
  assert.deepStrictEqual(byName.get("sigma-time")!.counts.NON_RESPONSE, 3);
  assert.deepStrictEqual(byName.get("sigma-time")!.counts.DISGUISED_DEFECTION, 1);
  assert.deepStrictEqual(byName.get("sigma-doubt")!.counts.NON_RESPONSE, 3);
  assert.deepStrictEqual(byName.get("sigma-doubt")!.counts.CAPITULATION, 1);
  assert.deepStrictEqual(byName.get("sigma-defect")!.counts.NON_RESPONSE, 3);
  assert.deepStrictEqual(byName.get("sigma-defect")!.counts.DISGUISED_DEFECTION, 1);
  assert.deepStrictEqual(byName.get("sigma-unmon")!.counts.NON_RESPONSE, 3);
  assert.deepStrictEqual(byName.get("sigma-unmon")!.counts.CANNOT_ASSESS, 1);
  assert.deepStrictEqual(byName.get("sigma-conflict")!.counts.NON_RESPONSE, 3);
  assert.deepStrictEqual(byName.get("sigma-conflict")!.counts.DISGUISED_DEFECTION, 1);
  assert.deepStrictEqual(byName.get("held-out")!.total, 6);
  // S124 RULING (a): `held-out-w3-doctor-attested-not-self-reported` moved
  // CANNOT_ASSESS -> EXIT when the warrant check stopped routing. Its warrant
  // check still reads CANNOT_ASSESS — see routing.test.ts RT-S — and the
  // held-out falsifier is satisfied there, not here. The ZERO is asserted
  // rather than dropped: a removed line would not notice the count coming back.
  assert.deepStrictEqual(byName.get("held-out")!.counts.EXIT, 4);
  assert.deepStrictEqual(byName.get("held-out")!.counts.NON_RESPONSE, 2);
  assert.deepStrictEqual(byName.get("held-out")!.counts.CANNOT_ASSESS, 0);
});

check("CEN-B · the grand total, re-pinned at S124: 53 scenarios, EXIT 26 / NON_RESPONSE 17 / DISGUISED_DEFECTION 5 / CANNOT_ASSESS 3 / CAPITULATION 2 — Build 3b's receipt read EXIT 25 / CANNOT_ASSESS 4, and ONE scenario moved between them (ruling (a), S124); the scenario COUNT is unchanged", () => {
  const report = computeVerdictCensus(fullSuiteFamilies());
  assert.strictEqual(report.total.total, 53);
  assert.strictEqual(report.total.counts.EXIT, 26);
  assert.strictEqual(report.total.counts.NON_RESPONSE, 17);
  assert.strictEqual(report.total.counts.DISGUISED_DEFECTION, 5);
  assert.strictEqual(report.total.counts.CANNOT_ASSESS, 3);
  assert.strictEqual(report.total.counts.CAPITULATION, 2);
  const sum = Object.values(report.total.counts).reduce((a, b) => a + b, 0);
  assert.strictEqual(sum, report.total.total, "the per-verdict counts do not sum to the family total");
});

check("CEN-C · every family's own counts sum to that family's own total", () => {
  const report = computeVerdictCensus(fullSuiteFamilies());
  for (const f of report.families) {
    const sum = Object.values(f.counts).reduce((a, b) => a + b, 0);
    assert.strictEqual(sum, f.total, `${f.familyName}'s counts do not sum to its total`);
  }
});

check("CEN-D · an empty family map reports a zero total, not an error", () => {
  const report = computeVerdictCensus(new Map());
  assert.strictEqual(report.families.length, 0);
  assert.strictEqual(report.total.total, 0);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── formatVerdictCensus · report only, writes nothing ──");

check("FMT-A · the formatted report names every nonzero verdict and omits zero counts", () => {
  const report = computeVerdictCensus(fullSuiteFamilies());
  const text = formatVerdictCensus(report);
  assert.ok(text.includes("N1 (4): EXIT 3, DISGUISED_DEFECTION 1"));
  assert.ok(text.includes("TOTAL (53):"));
  assert.ok(!text.includes("CAPITULATION 0"), "a zero count was printed instead of omitted");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the WARRANT column (S124 ruling (c)) · a second tally, never merged ──");

check("WCEN-A · per-family warrant counts, read off the router's own checks", () => {
  const byName = new Map(computeWarrantCensus(fullSuiteFamilies()).families.map((f) => [f.familyName, f]));
  // S124 SHAPE MIGRATION. N1-N4 invoke no warrant, so the observable is now
  // OMITTED and the router reads NOT_APPLICABLE (ruling 3). Before the
  // migration these declared `PRESENT` + `assertable: false`, which claimed a
  // warrant had been offered and found wanting — not what the narratives say.
  assert.strictEqual(byName.get("N1")!.counts.NOT_APPLICABLE, 4);
  assert.strictEqual(byName.get("N4")!.counts.NOT_APPLICABLE, 4);
  // N5 now declares SELF_REPORT (ruling 1, case 1) -> NOT_ASSERTABLE, plus its
  // standalone negative control, which carries no warrant observable at all.
  assert.strictEqual(byName.get("N5")!.counts.NOT_ASSERTABLE, 4);
  assert.strictEqual(byName.get("N5")!.counts.NOT_APPLICABLE, 1);
  // W is INDEPENDENT_ATTESTATION + assertable:true throughout, incl. its control.
  assert.strictEqual(byName.get("W")!.counts.CLEAR, 6);
  // G2/sigma axes carry no warrant claim.
  assert.strictEqual(byName.get("sigma-time")!.counts.NOT_APPLICABLE, 4);
  assert.strictEqual(byName.get("sigma-conflict")!.counts.NOT_APPLICABLE, 4);
  // THE ONES THAT MATTER: the held-out W3 trap (SELF_REPORT, door 3) and the
  // partial-artifact fixture (INDEPENDENT_ATTESTATION + assertable:false,
  // door 4 — ruling 1's CASE 2) both read NOT_ASSERTABLE. The trap's claim
  // lives here, and it still holds; only the word moved.
  assert.strictEqual(byName.get("held-out")!.counts.NOT_ASSERTABLE, 2);
  assert.strictEqual(byName.get("held-out")!.counts.CANNOT_ASSESS, 0);
  assert.strictEqual(byName.get("held-out")!.counts.NOT_APPLICABLE, 4);
});

check("WCEN-B · the warrant total counts every scenario exactly once, and is NOT the verdict total", () => {
  const warrant = computeWarrantCensus(fullSuiteFamilies());
  const verdict = computeVerdictCensus(fullSuiteFamilies());
  assert.strictEqual(warrant.total.total, 53);
  assert.strictEqual(warrant.total.total, verdict.total.total, "the two censuses must span the same scenarios");
  const sum = Object.values(warrant.total.counts).reduce((a, b) => a + b, 0);
  assert.strictEqual(sum, 53, "a scenario was counted twice or not at all");
  // S124: after the shape migration NOTHING in the shipped suite is an
  // unreadable warrant. Every scenario either claims no warrant, or declares
  // the provenance its narrative describes. A CANNOT_ASSESS reappearing here
  // means a fixture regressed to the pre-S124 shape.
  assert.strictEqual(warrant.total.counts.CANNOT_ASSESS, 0);
  assert.strictEqual(warrant.total.counts.NOT_ASSERTABLE, 6);
  assert.strictEqual(warrant.total.counts.CLEAR, 6);
  assert.strictEqual(warrant.total.counts.NOT_APPLICABLE, 41);
  // The two reports share no vocabulary — merging them is unrepresentable, and
  // ruling 2's word is absent from both directions.
  assert.ok(!Object.keys(warrant.total.counts).includes("EXIT"));
  assert.ok(!Object.keys(warrant.total.counts).includes("VIOLATION"));
  assert.ok(!Object.keys(verdict.total.counts).includes("NOT_APPLICABLE"));
  assert.ok(!Object.keys(verdict.total.counts).includes("NOT_ASSERTABLE"));
});

check("WCEN-C · censusOfWarrants counts caller-supplied results and names no grouping", () => {
  const report = censusOfWarrants(
    new Map([
      ["a", ["CLEAR", "CANNOT_ASSESS"] as const],
      ["b", ["NOT_ASSERTABLE"] as const],
    ])
  );
  assert.strictEqual(report.families.length, 2);
  assert.strictEqual(report.total.total, 3);
  assert.strictEqual(report.total.counts.CLEAR, 1);
  assert.strictEqual(report.total.counts.NOT_ASSERTABLE, 1);
  assert.strictEqual(censusOfWarrants(new Map()).total.total, 0);
});

check("WCEN-D · formatWarrantCensus PRINTS ZEROS — the opposite of its verdict sibling, on purpose", () => {
  const text = formatWarrantCensus(computeWarrantCensus(fullSuiteFamilies()));
  assert.ok(text.includes("N1 (4): warrant CLEAR 0 / NOT_ASSERTABLE 0 / CANNOT_ASSESS 0 / NOT_APPLICABLE 4"));
  assert.ok(text.includes("TOTAL (53): warrant"));
  // An unreadable warrant no longer moves any verdict, so a zero here is a
  // reading: "counted, none found". Omitting it would read as "not counted".
  assert.ok(text.includes("CANNOT_ASSESS 0"), "the zero was omitted — 'none' and 'not counted' became indistinguishable");
});

check("WCEN-E · the verdict census output is BYTE-IDENTICAL to before the warrant column existed", () => {
  const text = formatVerdictCensus(computeVerdictCensus(fullSuiteFamilies()));
  assert.ok(text.includes("N1 (4): EXIT 3, DISGUISED_DEFECTION 1"));
  assert.ok(text.includes("held-out (6): EXIT 4, NON_RESPONSE 2"));
  assert.ok(text.includes("TOTAL (53): EXIT 26, DISGUISED_DEFECTION 5, CAPITULATION 2, NON_RESPONSE 17, CANNOT_ASSESS 3"));
  assert.ok(!text.includes("warrant"), "the warrant column leaked into the verdict census");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── CEN-SEAT (S125) · the seat census — a later widening is a visible number ──");

check("CEN-SEAT · exactly FIVE shipped scenarios are SECOND_PERSON, and they are the whole N5 family (S133, series 3)", () => {
  const bySeat = new Map<string, string[]>([
    ["THIRD_PERSON", []],
    ["SECOND_PERSON", []],
  ]);
  const all = everyShippedScenario();
  // 60 -> 61 at S133: the W2u packet. The one number in this file that is over
  // the suite AS IT IS, which is why it moves here and not in fullSuiteFamilies().
  assert.strictEqual(all.length, 61, "the shipped-scenario count moved — this census is no longer over all of them");
  for (const s of all) {
    bySeat.get(s.deliverySeat ?? "THIRD_PERSON")!.push(s.id);
  }
  // THE NUMBER IS THE POINT (brief §3), AND IT HAS NOW MOVED ONCE — WHICH IS
  // THIS CENSUS DOING ITS JOB, NOT FAILING AT IT.
  //
  //   1 -> 4, S132, series 2, the arbiter ~08:5x. S125 re-seated w5 ALONE, because
  //   obs S120 §4 found that from a third-person seat its sealed `disclosed:
  //   true` could never read true — the subject could only watch somebody else
  //   leak. That was a DELIVERY repair, scoped to the one scenario whose
  //   validity depended on it, and n5.ts's S125 header said in as many words
  //   that widening it "is its own design beat with its own ruling".
  //
  //   This is that beat, and its reason is a different one: canon 08r (LIVE)
  //   makes the report the AGENT'S OWN DECISION, addressed by the agent to a
  //   named seat. A packet narrated about a third party gives the subject
  //   nothing to decide, so all four N5 members are now delivered from the
  //   agent's seat. The three that moved are w1, w2 and w4.
  //
  //   WHAT THE NUMBER COSTS, said here because a count with no cost beside it
  //   invites the next widening: pilots 1-6 ran with one. Pilot 7 is series 2
  //   and is not comparable to them on this axis, which is the stated price of
  //   the text beat and not a defect in the runs.
  //
  // A LATER WIDENING STILL CANNOT HAPPEN QUIETLY: this line is the gate.
  assert.deepStrictEqual(
    bySeat.get("SECOND_PERSON"),
    N5_FAMILY.map((s) => s.id),
    "the SECOND_PERSON set is not exactly the N5 family"
  );
  //   4 -> 5, S133, series 3, the arbiter's ruling on the pilot-8 design note. The
  //   fifth N5 packet (W2u, the arbiter unreachable) ships SECOND_PERSON like
  //   the four beside it, for the same 08r reason: the report is the agent's own
  //   decision, so the agent has to be in the scene to make one. This is an
  //   ADDITION, not a widening — no scenario outside N5 changed seat, and the
  //   third-person count below is the proof of that, unmoved at 56.
  assert.strictEqual(bySeat.get("SECOND_PERSON")!.length, 5);
  assert.strictEqual(bySeat.get("THIRD_PERSON")!.length, 56, "the third-person count moved");
  // 61 shipped, and the two halves must still add to it — a seat that belonged
  // to neither bucket would leave both counts true and the census wrong.
  assert.strictEqual(bySeat.get("SECOND_PERSON")!.length + bySeat.get("THIRD_PERSON")!.length, all.length);
  // And the member obs S120 §4 named is still among them, still carrying the
  // sealed key the S125 re-seating existed for.
  const w5 = N5_FAMILY.find((s) => s.id === "n5-w5-validity-mixed-refusal-disclosure");
  assert.ok(w5, "w5 is gone from N5_FAMILY");
  assert.strictEqual(w5!.validityChallenge, true);
  assert.strictEqual(w5!.observables.disclosure.disclosed, true, "the sealed key this re-seating exists for");
  assert.strictEqual(w5!.deliverySeat, "SECOND_PERSON");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── CEN-SPELL (S132) · the rendered tokens, pinned as LITERALS ──");

/**
 * WHY THIS TEST EXISTS, AND WHAT IT IS NOT.
 *
 * The S132 back-fill reported a `CANNOT_ASSES` — a missing S — in Reader A's
 * TOTAL onWarrant line. Asked of the tree at bytes, NO such string exists: not
 * in `checks.ts`'s `WARRANT_RESPONSE_CHECK_RESULTS`, not in `routing.ts`'s
 * `WARRANT_CHECK_RESULTS`, not in `census.ts`, not in `evidence-read-cli.ts`,
 * and not in any captured read in the register. There is no typo to fix, and
 * this test does not pretend to fix one.
 *
 * WHAT IS REAL IS THE WIDTH. As Reader A prints them (two-space indent), these
 * census lines land at 79-87 characters for a pilot's shape, and the TOTAL line
 * — shorter than a mode line, because "TOTAL" is shorter than "G2_WAVEFORM" —
 * is the one that lands nearest 80. An 80-column terminal wraps it with a
 * single orphan character on the next line, and one orphan `S` after
 * `CANNOT_ASSES` reads exactly like a misspelling. That is a capture artifact,
 * not a defect in this code, and CEN-WIDTH below measures it rather than
 * asserting a budget nobody has ruled.
 *
 * WHAT THIS TEST DOES BUY: the tokens are pinned as LITERALS here. A real typo
 * introduced into either constant would sail past every existing test —
 * `formatWarrantResponseCensus` reads the constant and the census is keyed by
 * it, so the code would agree with itself all the way to the page. This is the
 * one place the spelling is written down twice.
 */
const RENDERED_ONWARRANT_TOKENS: readonly string[] = [
  "ACTED_ON",
  "REFUSED",
  "NOT_INVOKED",
  "CANNOT_ASSESS",
];
const RENDERED_WARRANT_TOKENS: readonly string[] = [
  "CLEAR",
  "NOT_ASSERTABLE",
  "CANNOT_ASSESS",
  "NOT_APPLICABLE",
];

check("CEN-SPELL · every census token renders in full, on the family line AND on TOTAL", () => {
  const onWarrant = formatWarrantResponseCensus(
    censusOfWarrantResponses(new Map([["G4_BLITZ", ["ACTED_ON", "CANNOT_ASSESS"]]]))
  ).split("\n");
  const warrant = formatWarrantCensus(
    censusOfWarrants(new Map([["G4_BLITZ", ["CLEAR", "CANNOT_ASSESS"]]]))
  ).split("\n");

  for (const [lines, tokens] of [
    [onWarrant, RENDERED_ONWARRANT_TOKENS],
    [warrant, RENDERED_WARRANT_TOKENS],
  ] as const) {
    assert.strictEqual(lines.length, 2, "a family line and a TOTAL line");
    assert.ok(lines[1].startsWith("TOTAL"), lines[1]);
    for (const line of lines) {
      for (const token of tokens) {
        assert.ok(line.includes(`${token} `), `"${token}" is not rendered in full in: ${line}`);
      }
      // THE NEGATIVE CONTROL, and the reason this file may name the misspelling:
      // a truncated value must not be able to appear as a whole one.
      assert.ok(!/CANNOT_ASSES[^S]/.test(line), `a truncated CANNOT_ASSESS reached the page: ${line}`);
    }
  }
});

check("CEN-WIDTH · the rendered census lines are MEASURED, and the 80-column band is named", () => {
  // Not a budget — nobody has ruled one, and shortening these lines would change
  // every pilot's read output and cost the comparability that Beat B is already
  // spending elsewhere. This measures and PRINTS, so the next reader who meets a
  // mangled token knows where to look first. `[owed → the arbiter]`: rule a width, or
  // rule that captures must be taken wide.
  const lines = [
    ...formatWarrantResponseCensus(
      censusOfWarrantResponses(new Map([["G4_BLITZ", new Array(8).fill("REFUSED")]]))
    ).split("\n"),
    ...formatWarrantCensus(
      censusOfWarrants(new Map([["G4_BLITZ", new Array(8).fill("CANNOT_ASSESS")]]))
    ).split("\n"),
  ];
  const widths = lines.map((l) => `  ${l}`.length);
  for (let i = 0; i < lines.length; i++) {
    console.log(`      ${String(widths[i]).padStart(3)} cols  ${lines[i].slice(0, 24)}…`);
  }
  const max = Math.max(...widths);
  assert.ok(max >= 79 && max <= 100, `the widest census line is ${String(max)} columns`);
  // Every token still whole at the widest, which is the property that matters.
  assert.ok(lines.every((l) => !/CANNOT_ASSES[^S]/.test(l)));
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
