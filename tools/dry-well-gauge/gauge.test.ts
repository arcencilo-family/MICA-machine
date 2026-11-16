// ── MICA · the DRY WELL GAUGE · TEST RUNNER ──────────────────────────────────
//
// A ts-node script with its own pass/fail counter, house dialect
// ("<n> tests: <p> passed, <f> failed"), exit 1 on any failure. It lives OUTSIDE
// src/ and is NOT part of test:mica — it is run directly:
//
//   npx ts-node tools/dry-well-gauge/gauge.test.ts
//
// The pure core is tested against HAND-COMPUTED vectors. Band edges, equilibria
// and event counts are COMPUTED from the calibration, never pinned: three of the
// last four Corrections Ledger entries are pinned-number defects, and one of them
// was this file's own (an exact event count asserted against an append-only book).

import assert from "assert";
import * as fs from "fs";
import * as path from "path";

import { INCOMPLETE_EXIT_CODE } from "../suite-protocol";
import {
  DWG_PROXY_CALIBRATION,
  classifyCaughtBy,
  parseLedger,
  fold,
  equilibriumFor,
  type CatchEvent,
  type Tier,
  type Calibration,
  type Band,
} from "./gauge";

let passed = 0;
let failed = 0;
let incomplete = 0;

/**
 * A CHECK THAT COULD NOT BE PERFORMED, which is neither a pass nor a failure.
 *
 * THE DEFECT THIS EXISTS TO END (S87): T6 used to `return` when the real
 * Corrections Ledger was not where it looked. `check()` saw a function that did
 * not throw, printed a tick, and counted a PASS — and `run-suite.ts`, which only
 * ever sees an exit code, counted the whole file as passed too. A check nobody
 * performed was reported as a check that succeeded, at BOTH levels.
 *
 * That is this repository's own thesis eating the project, one level down from
 * where discovery already caught it: the unrecorded pass is the silent
 * fail-open. Empty floor must read CANNOT_ASSESS, never release.
 */
class Incomplete extends Error {}

/** Raise from inside a check when a dependency it needs was never stated. */
function incompleteBecause(message: string): never {
  throw new Incomplete(message);
}

function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    if (err instanceof Incomplete) {
      console.log(`  ⊘ ${name}`);
      console.log(`    INCOMPLETE — ${err.message}`);
      incomplete++;
      return;
    }
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    failed++;
  }
}

const C = DWG_PROXY_CALIBRATION;
const W = C.weights;

/** Minimal event; the fold consumes only tier, weight and order. */
function ev(tier: Tier, weight: number, index: number): CatchEvent {
  return {
    ordinal: index + 1,
    index,
    tier,
    weight,
    caughtBy: `(${tier})`,
    madeBy: "(test)",
    matchedTiers: [tier],
    signals: [`${tier}:test`],
  };
}

function extEvents(n: number): CatchEvent[] {
  return Array.from({ length: n }, (_v, i) => ev("EXTERNAL", W.EXTERNAL, i));
}

/** A stream of n SELF events at the RULED tier weight (zero). */
function selfEvents(n: number, from = 0): CatchEvent[] {
  return Array.from({ length: n }, (_v, i) => ev("SELF", W.SELF, from + i));
}

const APPROX = 1e-9;

/**
 * The pre-rename vocabulary, built by CONCATENATION so that no line of this file
 * contains any of these words as a literal. That is what lets T8 scan this file
 * too, instead of excluding it the way the house's closure guard has to exclude
 * its own fixtures. Every check that needs to name the old vocabulary reads it
 * from here — writing one out literally would trip T8, correctly.
 */
const LEGACY_TERMS: readonly string[] = [
  "vigi" + "lance",
  "fly" + "wheel",
  "red" + "line",
  "tacho" + "meter",
];

console.log("\n── Dry Well Gauge · pure core ────────────────────────────────");

// ── the fold arithmetic on a hand-computed 3-event vector ─────────────────────
check("fold: hand-computed 3-event vector (literal weights 1.0 / 0.6 / 0.05)", () => {
  // The weights here are LITERAL TEST INPUTS exercising the arithmetic, not tier
  // weights — the fold consumes each event's own weight. (0.05 is deliberately a
  // value no tier carries any more; it keeps this a pure arithmetic vector.)
  // dryLevel .15 asymptote .95 alpha .30 d .90:
  // E1 w=1.0, first → NO evaporation: .15 + .30·1·(.95−.15) = .39
  // E2 w=0.6: evap .15+(.39−.15)·.9=.366 ; inflow .366+.18·(.95−.366)=.47112
  // E3 w=.05: evap .15+(.47112−.15)·.9=.439008 ; +.015·(.95−.439008)=.44667288
  const r = fold(
    [ev("EXTERNAL", 1, 0), ev("CROSS_INSTANCE", 0.6, 1), ev("SELF", 0.05, 2)],
    { ...C, minEvents: 3 }
  );
  assert.strictEqual(r.status, "READING");
  assert.ok(
    Math.abs((r.score as number) - 0.44667288) < 1e-6,
    `expected ≈0.44667288, got ${r.score}`
  );
});

// ── each weight tier moves the level by its tier amount ───────────────────────
check("fold: first-event inflow is dryLevel + α·w·span per tier; EXTERNAL » SELF", () => {
  const span = C.asymptote - C.dryLevel;
  const one = (tier: Tier): number =>
    fold([ev(tier, W[tier], 0)], { ...C, minEvents: 1 }).score as number;
  for (const tier of ["EXTERNAL", "CROSS_INSTANCE", "RITUAL", "SELF"] as const) {
    const expected = C.dryLevel + C.alpha * W[tier] * span; // computed, not pinned
    assert.ok(
      Math.abs(one(tier) - expected) < APPROX,
      `${tier}: expected ${expected}, got ${one(tier)}`
    );
  }
  assert.ok(one("EXTERNAL") > one("CROSS_INSTANCE"), "EXTERNAL » CROSS");
  assert.ok(one("CROSS_INSTANCE") > one("RITUAL"), "CROSS » RITUAL");
  assert.ok(one("RITUAL") > one("SELF"), "RITUAL » SELF");
  // And at the ruled weight, a lone SELF catch moves the level not at all.
  assert.ok(
    Math.abs(one("SELF") - C.dryLevel) < APPROX,
    `a SELF catch must contribute no inflow: got ${one("SELF")}`
  );
});

// ── evaporation over index lowers the reading — the core property ─────────────
check("fold: appending 4 SELF events lowers the reading (index-evaporation liveness)", () => {
  const book = extEvents(8);
  const before = fold(book, C).score as number;
  const after = fold([...book, ...selfEvents(4, 8)], C).score as number;
  assert.ok(
    after < before,
    `the same book with 4 SELF entries appended must read lower: ` +
      `before ${before}, after ${after}`
  );
});

// ── T3 · A SELF-ONLY RUN DECAYS RATHER THAN FREEZING `[LB]` ───────────────────
//
// This is the guard on zero-weight-versus-exclusion, and it is the whole reason
// zero beat exclusion. Under EXCLUSION these rows would never enter `events`:
// no evaporation, no inflow, nothing moving — a frozen reading presented as
// current, indefinitely. That is silence rendered as safety. Under ZERO WEIGHT
// the rows are events, evaporation runs, and the level falls to DRY.
check("T3: a SELF-only run strictly FALLS and reaches DRY (zero weight, not exclusion)", () => {
  const primed = extEvents(6); // put water in the well first
  const levels: number[] = [];
  for (let n = 0; n <= 20; n++) {
    const r = fold([...primed, ...selfEvents(n, 6)], { ...C, minEvents: 1 });
    levels.push(r.score as number);
  }
  // Strictly monotone decreasing across the whole self-catch run.
  for (let i = 1; i < levels.length; i++) {
    assert.ok(
      levels[i] < levels[i - 1],
      `level must fall at every self-catch step: step ${i} went ` +
        `${levels[i - 1]} → ${levels[i]}`
    );
  }
  // And the run ends dry, with the one finding raised.
  const end = fold([...primed, ...selfEvents(20, 6)], C);
  assert.strictEqual(end.band, "DRY", `expected DRY, got ${end.band} at S=${end.score}`);
  assert.ok(end.finding !== null, "the dry case raises the one finding");
  // It never passes the lower bound.
  assert.ok(
    (end.score as number) >= C.dryLevel - APPROX,
    `must not pass below dryLevel: ${end.score}`
  );
});

// ── T4 · zero weight, NOT zero presence ──────────────────────────────────────
check("T4: SELF events still appear in events, perTier and qualifyingCount", () => {
  const md = [
    "| # | error | class | made by | caught by | direction |",
    "|---|---|---|---|---|---|",
    "| 1 | a | INFLATION | house, S1 | Ari (external seat) | bigger |",
    "| 2 | b | IMPRECISION | house, S2 | house, S2 | — |",
    "| 3 | c | IMPRECISION | house, S3 | house, same session | — |",
  ].join("\n");
  const p = parseLedger(md, W);
  assert.strictEqual(p.events.length, 3, "a zero-weight row is still an event");
  assert.strictEqual(p.blindRows.length, 0, "SELF is classified, never a blind row");
  const selfEvts = p.events.filter((e) => e.tier === "SELF");
  assert.strictEqual(selfEvts.length, 2, "both SELF rows present");
  for (const e of selfEvts) assert.strictEqual(e.weight, 0, "SELF weight is zero");
  const r = fold(p.events, { ...C, minEvents: 1 });
  assert.strictEqual(r.perTier.SELF, 2, "SELF counts in the census");
  assert.strictEqual(r.qualifyingCount, 3, "SELF counts in qualifyingCount");
});

// ── blindness A · young book → CANNOT_ASSESS, and T5's full shape ─────────────
check("T5: young book → CANNOT_ASSESS + INSUFFICIENT_HISTORY, ambiguity stated, finding null", () => {
  const r = fold(extEvents(3), C); // minEvents = 8
  assert.strictEqual(r.status, "CANNOT_ASSESS");
  assert.strictEqual(r.blindness, "INSUFFICIENT_HISTORY");
  assert.strictEqual(r.score, null, "a young book offers no level");
  assert.strictEqual(r.band, null);
  // The twin honesty: it states the ambiguity it cannot resolve.
  assert.ok(r.cannotDistinguish !== null, "must carry typed indistinguishability");
  assert.ok(/YOUNG/.test(r.cannotDistinguish as string), "must name YOUNG");
  assert.ok(/QUIET/.test(r.cannotDistinguish as string), "must name QUIET");
  assert.ok(r.probeRecommendation !== null, "must raise a probe recommendation");
  assert.ok(/decorrelated/.test(r.probeRecommendation as string), "probe fence kept");
  // And `finding` stays null — deliberate. Typed blindness is already a speech act.
  assert.strictEqual(r.finding, null, "the finding slot belongs to the dry case");
  // The unsupported clause is gone.
  assert.ok(
    !/never spun/i.test(r.blindnessDetail ?? ""),
    "the unsupported 'never spun' clause must be gone"
  );
});

// ── blindness B · dry book → CANNOT_DISTINGUISH + probe ──────────────────────
check("blindness B: mature-and-dry → CANNOT_DISTINGUISH + probe (not a health claim)", () => {
  const book = [...extEvents(4), ...selfEvents(C.dryWindow, 4)];
  const r = fold(book, C);
  assert.strictEqual(r.status, "READING");
  assert.strictEqual(r.band, "DRY");
  assert.ok(r.cannotDistinguish !== null, "must carry typed indistinguishability");
  assert.ok(r.probeRecommendation !== null, "must raise a probe recommendation");
  assert.ok(/RELIABLE/.test(r.cannotDistinguish as string));
  assert.ok(/salience/i.test(r.probeRecommendation as string));
});

// ── the two blindness shapes stay distinct ───────────────────────────────────
check("the young case and the dry case remain distinct types, not one return", () => {
  const young = fold(extEvents(3), C);
  const dry = fold([...extEvents(4), ...selfEvents(6, 4)], C);
  assert.strictEqual(young.status, "CANNOT_ASSESS");
  assert.strictEqual(dry.status, "READING");
  assert.strictEqual(young.band, null);
  assert.strictEqual(dry.band, "DRY");
  // Both state an ambiguity; only the dry one is a finding.
  assert.ok(young.cannotDistinguish !== null && dry.cannotDistinguish !== null);
  assert.strictEqual(young.finding, null);
  assert.ok(dry.finding !== null);
});

// ── precedence: SELF+RITUAL collision resolves to RITUAL (max-weight) ─────────
check("precedence: a row matching SELF+RITUAL resolves to RITUAL (max-weight)", () => {
  const cls = classifyCaughtBy("house, same session, at dryRun inspection", "house, S56", W);
  assert.ok(cls !== null);
  assert.strictEqual((cls as { tier: Tier }).tier, "RITUAL");
  assert.strictEqual((cls as { weight: number }).weight, W.RITUAL);
  const tiers = (cls as { matchedTiers: readonly Tier[] }).matchedTiers;
  assert.ok(tiers.includes("SELF") && tiers.includes("RITUAL"), "both tiers must match");
});

// ── Entry 12, REAL form: "house, S56, at dryRun inspection" ───────────────────
check("Entry 12 real bytes: structural-SELF + RITUAL → RITUAL (brief's REASON corrected)", () => {
  const cls = classifyCaughtBy("house, S56, at `dryRun` inspection", "house, S56", W);
  assert.ok(cls !== null);
  assert.strictEqual((cls as { tier: Tier }).tier, "RITUAL");
  const tiers = (cls as { matchedTiers: readonly Tier[] }).matchedTiers;
  assert.ok(tiers.includes("SELF"), "structural SELF must be detected");
  assert.ok(tiers.includes("RITUAL"));
});

// ── CROSS via session-number ≠ making session ─────────────────────────────────
check("CROSS: a session number ≠ the making session is cross-instance; == is not", () => {
  const cross = classifyCaughtBy("house, S56", "S55, inside the correcting move", W);
  assert.strictEqual((cross as { tier: Tier }).tier, "CROSS_INSTANCE");
  const notCross = classifyCaughtBy("house, S56 reread", "house, S56", W);
  assert.strictEqual((notCross as { tier: Tier }).tier, "SELF");
});

// ── un-parseable caught by → blind row, excluded, surfaced ────────────────────
check("blind row: unclassifiable `caught by` is surfaced and EXCLUDED, never defaulted", () => {
  const md = [
    "| # | error | class | made by | caught by | direction |",
    "|---|---|---|---|---|---|",
    "| 1 | x | INFLATION | house, S1 | Ari (external seat) | bigger |",
    "| 2 | y | IMPRECISION | house, S1 | the weather turned | — |",
  ].join("\n");
  const p = parseLedger(md, W);
  assert.strictEqual(p.events.length, 1, "only the classifiable row folds");
  assert.strictEqual(p.blindRows.length, 1, "the blind row is surfaced");
  assert.strictEqual(p.blindRows[0].ordinalRaw, "2");
  const r = fold(p.events, { ...C, minEvents: 1 });
  assert.strictEqual(r.qualifyingCount, 1);
});

// ── malformed row (wrong column count) → surfaced, not guessed ────────────────
check("malformed row: wrong pipe-column count is surfaced, never mis-assigned", () => {
  const md = [
    "| # | error | class | made by | caught by | direction |",
    "|---|---|---|---|---|---|",
    "| 1 | ok | INFLATION | house, S1 | Ari (external seat) | bigger |",
    "| 2 | broken row missing cells | house, S1 |",
  ].join("\n");
  const p = parseLedger(md, W);
  assert.strictEqual(p.events.length, 1);
  assert.strictEqual(p.malformedRows.length, 1);
});

// ── T9 · AN ESCAPED PIPE IS A LITERAL PIPE, NOT A COLUMN BOUNDARY `[LB]` ─────
//
// The row above is malformed because cells are MISSING. This one has all six and
// must not be confused with it. Ledger entry 50 quotes the `||` guard it is about,
// escaped as `\|\|` exactly as CommonMark requires; `line.split("|")` counted those
// two as separators, six cells arrived as eight, and the row was dropped from the
// fold. T6 then failed at its FIRST assertion and its remaining four never ran —
// one un-taught escape cost a red suite and four checks that did not happen.
//
// The book was correct markdown throughout. The reader is what changed.
check("T9: an escaped pipe is a literal pipe in the cell, not a column boundary", () => {
  const md = [
    "| # | error | class | made by | caught by | direction |",
    "|---|---|---|---|---|---|",
    "| 1 | the `\\|\\|` guard swallowed the failure | INFLATION | house, S1 | " +
      "Ari (external seat), who read the `\\|\\|` first | bigger |",
  ].join("\n");
  const p = parseLedger(md, W);
  assert.strictEqual(
    p.malformedRows.length,
    0,
    "an escaped pipe is not a wrong column count"
  );
  assert.strictEqual(p.events.length, 1, "the row folds like any other");
  assert.strictEqual(p.events[0].ordinal, 1);
  assert.strictEqual(p.events[0].tier, "EXTERNAL");
  // What reaches the classifier is the PROSE, not the escape sequence.
  assert.ok(
    p.events[0].caughtBy.includes("||"),
    `the cell must carry a literal pipe pair, got: ${p.events[0].caughtBy}`
  );
  assert.ok(
    !p.events[0].caughtBy.includes("\\|"),
    "no backslash-escape may survive into the cell text"
  );
});

// ── the upper bound is never reached ─────────────────────────────────────────
check("bound: a long run of EXTERNAL catches asymptotes BELOW the upper bound", () => {
  const r = fold(extEvents(60), C).score as number;
  assert.ok(r < C.asymptote, `S=${r} must stay under the asymptote ${C.asymptote}`);
  const eq = equilibriumFor(W.EXTERNAL, C);
  assert.ok(Math.abs(r - eq) < 1e-4, `S=${r} should approach the EXTERNAL eq ${eq}`);
  assert.ok(eq < C.asymptote, "even the all-EXTERNAL equilibrium sits below the bound");
});

// ── the lower bound is never breached ────────────────────────────────────────
check("bound: a long inflow-less run approaches dryLevel from ABOVE, never past", () => {
  const book = [...extEvents(5), ...selfEvents(60, 5)];
  const r = fold(book, C).score as number;
  assert.ok(r >= C.dryLevel - APPROX, `S=${r} must not pass below dryLevel`);
  assert.ok(r < C.dryLevel + 0.01, `S=${r} must have evaporated close to dryLevel`);
});

// ── the WET band emits NO finding (census-only) ──────────────────────────────
check("WET band: a real-shaped tier vector reads WET and raises NO finding", () => {
  const tiers: Tier[] = [
    "EXTERNAL", "SELF", "CROSS_INSTANCE", "CROSS_INSTANCE", "CROSS_INSTANCE",
    "CROSS_INSTANCE", "RITUAL", "EXTERNAL", "EXTERNAL", "EXTERNAL",
    "EXTERNAL", "EXTERNAL", "CROSS_INSTANCE",
  ];
  const r = fold(tiers.map((t, i) => ev(t, W[t], i)), C);
  assert.strictEqual(r.status, "READING");
  assert.strictEqual(r.band, "WET", `expected WET, got ${r.band} at S=${r.score}`);
  assert.strictEqual(r.finding, null, "WET judges nothing");
  assert.strictEqual(r.cannotDistinguish, null);
});

// ── the top-end bell stays cut ───────────────────────────────────────────────
check("the old top-end alarm zone now reads WET and silent", () => {
  // Computed from the calibration, never pinned: the old edge was the
  // all-EXTERNAL equilibrium less a small epsilon.
  const oldTopEdge = equilibriumFor(W.EXTERNAL, C) - 0.02;
  const r = fold(extEvents(60), C);
  const s = r.score as number;
  assert.ok(s >= oldTopEdge, `vector must reach the old alarm zone: S=${s} < ${oldTopEdge}`);
  assert.strictEqual(r.band, "WET", `expected WET, got ${r.band}`);
  assert.strictEqual(r.finding, null, "the top-end bell was cut; nothing may ring");
  assert.strictEqual(r.probeRecommendation, null);
});

// ── T7 · the Band union took the rename ──────────────────────────────────────
check("T7: Band admits only DRY and WET — the old labels are gone", () => {
  // Type-level: fails to COMPILE if the union still carries an old label.
  type BandIsDryWet = Band extends "DRY" | "WET" ? true : false;
  const bandUnionRenamed: BandIsDryWet = true;
  assert.strictEqual(bandUnionRenamed, true);

  // Runtime: sweep stream shapes across the whole range and collect every band.
  const seen = new Set<string>();
  const shapes: CatchEvent[][] = [
    extEvents(60),
    extEvents(20),
    [...extEvents(10), ...selfEvents(30, 10)],
    Array.from({ length: 40 }, (_v, i) => ev("RITUAL", W.RITUAL, i)),
    Array.from({ length: 40 }, (_v, i) => ev("CROSS_INSTANCE", W.CROSS_INSTANCE, i)),
    selfEvents(40),
  ];
  for (const shape of shapes) {
    const b = fold(shape, C).band;
    if (b !== null) seen.add(b);
  }
  for (const b of seen) {
    assert.ok(b === "DRY" || b === "WET", `unexpected band ${b}`);
  }
  assert.ok(seen.has("DRY") && seen.has("WET"), `both bands must be reachable: ${[...seen]}`);
});

// ── MISSING_CONFIGURATION: no silent default, and NOT given the twin ─────────
check("config: a broken calibration → CANNOT_ASSESS / MISSING_CONFIGURATION, no ambiguity text", () => {
  const r = fold(extEvents(10), { ...C, dryLevel: 0 } as Calibration);
  assert.strictEqual(r.status, "CANNOT_ASSESS");
  assert.strictEqual(r.blindness, "MISSING_CONFIGURATION");
  assert.strictEqual(r.score, null);
  // Y5: absent config is a genuine third thing and carries no young/quiet ambiguity.
  assert.strictEqual(r.cannotDistinguish, null, "config blindness carries no ambiguity");
  assert.strictEqual(r.probeRecommendation, null, "and recommends no probe");
});

// ── equilibria — computed, and the SELF one moved with the ruling ────────────
check("equilibria: at SELF=0 the SELF equilibrium IS dryLevel; EXTERNAL sits below the bound", () => {
  const self = equilibriumFor(W.SELF, C);
  const ext = equilibriumFor(W.EXTERNAL, C);
  // EXPECTED DRIFT: at the old SELF=0.05 this was ≈0.2557. At the ruled SELF=0 a
  // stream bringing no credited inflow settles exactly at the lower bound.
  assert.ok(
    Math.abs(self - C.dryLevel) < APPROX,
    `SELF-eq must equal dryLevel exactly at zero weight: ${self} vs ${C.dryLevel}`
  );
  assert.ok(ext < C.asymptote, "the EXTERNAL equilibrium sits strictly inside the bounds");
  assert.ok(ext > C.dryLevel, "and strictly above the lower bound");
});

// ── T8 · the rename took, across all four files ──────────────────────────────
//
// The search terms are built by CONCATENATION so this file does not match its own
// pattern — the self-reference trap the house's closure guard solves by excluding
// its own fixtures. Building the terms instead lets the scan cover this file too.
//
// Deliberate HISTORY mentions are allowed but must be in COMMENT or MARKDOWN
// prose, never in code, and every survivor is PRINTED for the house to check.
check("T8: no legacy name survives in code; historical mentions are prose-only and reported", () => {
  const dir = __dirname;
  const files = ["gauge.ts", "read-gauge.ts", "gauge.test.ts", "README.md"];
  const terms = LEGACY_TERMS;
  const survivors: string[] = [];
  const inCode: string[] = [];

  for (const f of files) {
    const abs = path.join(dir, f);
    assert.ok(fs.existsSync(abs), `${f} must exist under the renamed directory`);
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
    const isMarkdown = f.endsWith(".md");
    lines.forEach((line, i) => {
      const lc = line.toLowerCase();
      if (!terms.some((t) => lc.includes(t))) return;
      const trimmed = line.trim();
      const isProse =
        isMarkdown || trimmed.startsWith("//") || trimmed.startsWith("*");
      survivors.push(`${f}:${i + 1}`);
      if (!isProse) inCode.push(`${f}:${i + 1}  ${trimmed.slice(0, 70)}`);
    });
  }

  assert.deepStrictEqual(
    inCode,
    [],
    `a legacy name survives in CODE (not prose): ${inCode.join(" | ")}`
  );
  console.log(
    `      (surviving historical mentions, prose only — house please confirm intended: ` +
      `${survivors.length === 0 ? "none" : survivors.join(", ")})`
  );
});

// ── the old directory is gone ────────────────────────────────────────────────
//
// Asserted by SCANNING tools/ for any directory still named in the pre-rename
// vocabulary, rather than by naming the old directory literally — which would
// itself trip T8, correctly. A rename that leaves the old directory behind is a
// copy, not a move.
check("no directory under tools/ still carries the pre-rename vocabulary", () => {
  const toolsDir = path.resolve(__dirname, "..");
  const stale = fs
    .readdirSync(toolsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => LEGACY_TERMS.some((t) => n.toLowerCase().includes(t)));
  assert.deepStrictEqual(
    stale,
    [],
    `a pre-rename directory survives under tools/: ${stale.join(", ")}`
  );
});

// ── T6 · INTEGRATION over the real Ledger ────────────────────────────────────
//
// SEAT DEFECT, CAUGHT BY THIS RUNNER AND RECORDED (S80). This check first shipped
// asserting an EXACT event count against an APPEND-ONLY book whose whole purpose
// is to grow. It went red on its own between sessions with nothing in the tool
// changed — the same error class as a pinned band edge. The count is now asserted
// as MONOTONE from a founding floor, and the observed values are PRINTED, not
// pinned.
const FOUNDING_EVENTS = 13; // the count at first build, 2026-08-24

check("T6: the real Corrections Ledger parses clean, reads no finding, values printed not pinned", () => {
  // ── WHERE THE LEDGER IS, IS A DEPLOYMENT FACT (S87) ──────────────────────
  //
  // This used to resolve three levels up from __dirname to
  // <operator home>/MICA-4-gates/work-now/... — a sibling-path assumption that
  // was true before the S84 relocation and has been false, and silent, ever
  // since. The Ledger now lives in the Windows vault; where any given machine
  // mounts it is a property of that machine, not of this test.
  //
  // It is NOT replaced with a Windows-mount path. RULED S95 (the arbiter): KEEP IT
  // STATED. A drvfs path baked in here is a claim about ONE machine, and the
  // last such assumption was silently false from the S84 relocation onward —
  // the test went on printing a tick for a check it was no longer performing.
  // The env var keeps the decision in the deployment, visibly, and an unset var
  // reports DEPENDENCY NOT STATED rather than passing.
  //
  // (This comment previously called that coupling "owed item A5". It is not:
  // sweep row A5 is factor T's mu-anchor, blocked on a content-manifest
  // primitive, and has nothing to do with mount paths. A borrowed label, now
  // returned — S95.)
  const stated = process.env.MICA_LEDGER_PATH;
  if (stated === undefined || stated.length === 0) {
    incompleteBecause(
      "MICA_LEDGER_PATH is not set, so the real Corrections Ledger was never " +
        "read and this check was never performed. Set it to the absolute path " +
        "of ARC_MICA-NOTE_Corrections-Ledger_20260805.md. DEPENDENCY NOT STATED " +
        "is not a pass and is not a failure — it is a check that did not happen."
    );
  }
  const ledger = path.resolve(stated);
  // A STATED location that is empty is a FINDING, not a skip. Somebody said
  // where the Ledger is; it is not there. That is worth failing over, and it is
  // the difference between "nobody told me" and "what I was told is wrong".
  assert.ok(
    fs.existsSync(ledger),
    `MICA_LEDGER_PATH is set to ${ledger} and nothing is there. A stated ` +
      `location that is empty is a finding, not a skip.`
  );
  const md = fs.readFileSync(ledger, "utf8");
  const p = parseLedger(md, W);
  assert.strictEqual(p.tableFound, true, "the entries table must be found");
  console.log(
    `(observed: ${p.blindRows.length} blind rows: ${p.blindRows.length === 0 ? "none" : p.blindRows.map((b) => b.ordinalRaw).join(", ")} — surfaced, not pinned)`
  );
  assert.strictEqual(p.malformedRows.length, 0, "no malformed rows expected");
  assert.ok(
    p.events.length >= FOUNDING_EVENTS,
    `append-only: the count may rise, never fall. founding ${FOUNDING_EVENTS}, ` +
      `now ${p.events.length}`
  );
  const r = fold(p.events, C);
  assert.strictEqual(r.status, "READING");
  assert.strictEqual(r.finding, null, "the real Ledger must raise no finding");

  // The score MOVES with the SELF ruling (SELF rows now bring no inflow). Both
  // numbers are printed; neither is pinned. The comparison is computed by folding
  // the same events under the pre-ruling weight.
  const preRuling: Calibration = { ...C, weights: { ...W, SELF: 0.05 } };
  const before = fold(
    p.events.map((e) => (e.tier === "SELF" ? { ...e, weight: 0.05 } : e)),
    preRuling
  ).score as number;
  const after = r.score as number;
  console.log(
    `      (observed: ${p.events.length} events, SELF ${r.perTier.SELF}; ` +
      `S at SELF=0.05 was ${before.toFixed(4)}, at ruled SELF=0 is ${after.toFixed(4)}; ` +
      `band ${r.band} — counted, not pinned)`
  );
  if (r.perTier.SELF > 0) {
    assert.ok(
      after < before,
      `with SELF rows present, zeroing their weight must lower the level: ` +
        `${before} → ${after}`
    );
  }
});

console.log(
  `\n${passed + failed + incomplete} tests: ${passed} passed, ` +
    `${incomplete} incomplete, ${failed} failed`
);
if (incomplete > 0) {
  console.log(
    "AN INCOMPLETE RUN IS NOT A CLEAN ONE. The checks above marked ⊘ were not " +
      "performed; nothing here says whether they would have passed."
  );
}
// The ladder is ordered, and the order is the point: a real failure outranks an
// incomplete census, and an incomplete census outranks silence.
if (failed > 0) process.exit(1);
if (incomplete > 0) process.exit(INCOMPLETE_EXIT_CODE);
