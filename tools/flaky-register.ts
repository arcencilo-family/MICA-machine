// ── MICA · the FLAKY REGISTER — a suite that has ever varied, named out loud ──
//
// WHY THIS FILE EXISTS (board ruling, 2026-10-02 20:38Z). The 3×-per-arm sweep
// was adopted to tell a REAL verdict move from a flake. It cannot: measured on
// 2026-10-02, `src/probe/intent-cli.test.ts` fails 1 of 13 runs inside a
// sequential sweep and 10 of 20 run concurrently with one, and three clean runs
// detect a 7.7% flake only 21.3% of the time. So three runs of a sweep is not a
// test for flakiness, and a sweep arm that reads "0 of 105 varied" is not
// evidence of stability — it is evidence about three samples.
//
// ⛔ AND A DIFFERENTIAL CANNOT SEE A CONSTANT. On 2026-10-02 all three landed
//    sweep runs carried `tools/suite-membership.test.ts  exit=1` IDENTICALLY, so
//    the within-arm comparison reported zero variance while the suite was red in
//    every run. "0 of n varied" was true and useless. The register does not fix
//    that; it is named here because the two defects were found together and a
//    reader of this file is the reader who needs to know both.
//
// THE RULE THIS ENCODES. A suite that has EVER varied is registered. The sweep
// EXCLUDES registered suites and PRINTS them, so a comparison never scores a
// known flake as a verdict move — and never hides it either. A candidate flake
// is confirmed by at least MIN_DIRECT_RUNS DIRECT runs, never by the sweep.
//
// WHERE 14 COMES FROM, so it is not a remembered number: n = ln(0.05)/ln(1−p)
// is the runs needed to see a p-rate flake at least once with 95% confidence;
// at p = 0.20 that is 13.4, so 14. It is a FLOOR on the evidence, not a
// calibration of the flake — a register entry must earn its place.

import { readFileSync } from "fs";
import { resolve } from "path";

export const REGISTER_REL = "tools/flaky-suites.json";
export const REGISTER_SCHEMA = "mica-flaky-register/1";

/** Runs needed to see a 20% flake at least once with 95% confidence: ⌈ln .05 / ln .8⌉. */
export const MIN_DIRECT_RUNS = 14;

/** The marker a registered suite's row carries instead of a count line. */
export const EXCLUDED_MARKER = "FLAKY-REGISTERED";

export interface FlakyEntry {
  /** Repo-relative path, exactly as `discoverAllTests` reports it. */
  readonly suite: string;
  readonly registeredOn: string;
  /** DIRECT runs behind this entry — not sweep arms. */
  readonly runs: number;
  readonly failures: number;
  readonly basis: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(what: string): never {
  throw new Error(`${REGISTER_REL}: ${what}`);
}

/**
 * Read the register, refusing an entry that has not earned its place.
 *
 * The ≥14-runs rule is enforced HERE rather than remembered by whoever edits the
 * file. An entry claiming a flake on fewer runs is refused — a register that
 * accepted "it failed once for me" would become the place suites go to stop
 * being checked, which is the opposite of what it is for.
 */
export function loadFlakyRegister(repoRoot: string): readonly FlakyEntry[] {
  let raw: string;
  try {
    raw = readFileSync(resolve(repoRoot, REGISTER_REL), "utf8");
  } catch {
    // ⛔ ABSENT IS NOT EMPTY, and saying so is the whole point of this branch.
    //    A missing register means the sweep excludes nothing, which is the SAFE
    //    direction: every suite is swept and every row is comparable.
    return [];
  }
  return parseFlakyRegister(raw);
}

/** The parser, separate so a test can hand it bytes without a repo. */
export function parseFlakyRegister(raw: string): readonly FlakyEntry[] {
  const o: unknown = JSON.parse(raw);
  if (typeof o !== "object" || o === null || Array.isArray(o)) fail("must be a JSON object");
  const rec = o as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  if (keys.join(",") !== "entries,schema") fail(`has keys [${keys.join(", ")}], expected exactly [entries, schema]`);
  if (rec.schema !== REGISTER_SCHEMA) fail(`schema must be "${REGISTER_SCHEMA}"`);
  if (!Array.isArray(rec.entries)) fail("entries must be a list (it may be empty)");

  const seen = new Set<string>();
  return rec.entries.map((e, i) => {
    if (typeof e !== "object" || e === null || Array.isArray(e)) fail(`entries[${i}] must be an object`);
    const r = e as Record<string, unknown>;
    const k = Object.keys(r).sort().join(",");
    if (k !== "basis,failures,registeredOn,runs,suite") {
      fail(`entries[${i}] has keys [${Object.keys(r).sort().join(", ")}], expected exactly [basis, failures, registeredOn, runs, suite]`);
    }
    const suite = r.suite;
    if (typeof suite !== "string" || suite.trim() === "") fail(`entries[${i}].suite must be a non-empty string`);
    if (suite.startsWith("/") || suite.includes("..")) fail(`entries[${i}].suite "${suite}" must be a plain repo-relative path`);
    if (seen.has(suite)) fail(`entries[${i}].suite "${suite}" is registered twice`);
    seen.add(suite);
    const registeredOn = r.registeredOn;
    if (typeof registeredOn !== "string" || !DATE.test(registeredOn)) fail(`entries[${i}].registeredOn must be YYYY-MM-DD`);
    const runs = r.runs;
    const failures = r.failures;
    if (typeof runs !== "number" || !Number.isInteger(runs)) fail(`entries[${i}].runs must be an integer`);
    if (typeof failures !== "number" || !Number.isInteger(failures)) fail(`entries[${i}].failures must be an integer`);
    if (runs < MIN_DIRECT_RUNS) {
      fail(
        `entries[${i}] ("${suite}") claims a flake on ${runs} run(s); the rule is at least ` +
          `${MIN_DIRECT_RUNS} DIRECT runs. A register that accepted "it failed once for me" ` +
          "would become the place suites go to stop being checked."
      );
    }
    if (failures < 1) fail(`entries[${i}] ("${suite}") records ${failures} failure(s) — a suite that never varied is not flaky`);
    if (failures > runs) fail(`entries[${i}] ("${suite}") records ${failures} failure(s) in ${runs} run(s)`);
    const basis = r.basis;
    if (typeof basis !== "string" || basis.trim() === "") fail(`entries[${i}].basis must say what was measured`);
    return { suite, registeredOn, runs, failures, basis };
  });
}

/** The measured rate, computed from the entry rather than restated in its prose. */
export function observedRate(e: FlakyEntry): number {
  return e.failures / e.runs;
}

/** P(at least one failure in `runs` draws) at the entry's own observed rate. */
export function detectionProbability(e: FlakyEntry, runs: number): number {
  return 1 - Math.pow(1 - observedRate(e), runs);
}
