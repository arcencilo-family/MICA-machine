// ── MICA · the suite runner — reach every file, then judge ───────────────────
//
// WHAT THIS IS, AND WHY IT IS A THIRD FILE RATHER THAN A COPY
//
//   Two runners now exist: `run-chain.ts` runs the files a hand-maintained
//   manifest NAMES, and `run-suite.ts` runs the files discovery FINDS. Two
//   enumerations, one disk — that pair is the whole point, and it only buys
//   anything if the two are independent lists run by the SAME machinery. A
//   second copy of the execution loop would be a second place for the outcome
//   rules to drift, which is the objection `suite-protocol.ts`'s own header
//   raises about a constant copied three times.
//
//   So the loop, the four outcomes, the tally, the rendering and the exit-code
//   policy live here once. `suite-protocol.ts` stays a vocabulary that runs
//   nothing; this file is the thing that runs.
//
// ── THE PROPERTY IT EXISTS TO HOLD (S98-D(5), from the A9 receipt §E.4) ──────
//
//   `test:mica` was a 44-link `&&` chain. `&&` stops at the first non-zero exit,
//   so on any run where `MICA_LEDGER_PATH` was unset the gauge exited 77 and
//   `tools/inventory/inventory.test.ts` — twelve tests — WAS NEVER RUN AT ALL.
//   Not reported as skipped. Not counted. Simply absent, on every run by anyone
//   who had not set that variable, which was everyone.
//
//   `suite-membership.test.ts` guards that every discovered file is NAMED.
//   Nothing guarded that every named file was REACHED. This is that guard:
//
//     RUN EVERY FILE. COLLECT EVERY CODE. JUDGE AT THE END.
//
//   No early exit exists in `runEvery` and none may be added. A runner that
//   stops early cannot tell you what it did not look at, and a suite that
//   cannot say what it skipped is the unrecorded pass wearing a green coat.
//
// ── FOUR OUTCOMES, NOT TWO ───────────────────────────────────────────────────
//
//   PASSED · FAILED · INCOMPLETE · UNREACHABLE.
//
//   INCOMPLETE (exit 77) is the protocol's own: the file ran, did not fail, and
//   could not complete a check it contains. It is CANNOT_ASSESS and it must not
//   round down to a pass — see INCOMPLETE_IS_NOT_A_PASS.
//
//   UNREACHABLE is new here and it is the amputation's own shape, turned into a
//   reportable state: a file the manifest names that is not on disk. NOTHING RAN,
//   so there is no exit code to record and `exitCode` is null rather than a
//   number that would imply one. A named file nobody can run is a hole in the
//   suite, and a hole is a failure, not a skip.
//
// ── A FAIL-OPEN IN THE CHILD INVOCATION, MEASURED AND WRITTEN DOWN ───────────
//
//   `ts-node <file>` for a file OUTSIDE the project root prints nothing and
//   EXITS 0. Measured 2026-08-31 at this repo's HEAD: a `process.exit(3)` in
//   `/tmp` came back 0; the same file under `tools/` came back 3. So a runner
//   handed an out-of-tree path would record a pass for a file that never ran.
//
//   It is not reachable today — both enumerations produce paths under the repo
//   — and it is not silently relied upon: `runEvery` marks a file it cannot
//   stat UNREACHABLE before any child is spawned, which closes the reachable
//   half. The residual is stated rather than papered over, and it is why the
//   fixtures in `suite-runner.test.ts` live under the repository.

import { spawnSync } from "child_process";
import { existsSync, statSync } from "fs";
import { join, relative, sep } from "path";

import { INCOMPLETE_EXIT_CODE, INCOMPLETE_IS_NOT_A_PASS, SUITE_ENV } from "./suite-protocol";

export type Outcome = "PASSED" | "FAILED" | "INCOMPLETE" | "UNREACHABLE";

/** One file the runner was asked to run, resolved before anything is spawned. */
export interface PlannedFile {
  readonly abs: string;
  readonly rel: string;
}

export interface FileResult {
  readonly rel: string;
  readonly outcome: Outcome;
  /** Null when nothing ran. A number here always means a child actually exited. */
  readonly exitCode: number | null;
}

export interface Tally {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly incomplete: number;
  readonly unreachable: number;
}

/** Runs one file and returns its exit code. Injected so the loop is testable. */
export type FileRunner = (file: PlannedFile) => number;

export function classifyExit(code: number): Outcome {
  if (code === INCOMPLETE_EXIT_CODE) return "INCOMPLETE";
  return code === 0 ? "PASSED" : "FAILED";
}

/** The production child: node + ts-node's bin, no shell, output inherited. */
export function tsNodeRunner(repoRoot: string): FileRunner {
  const tsNodeBin = join(repoRoot, "node_modules", "ts-node", "dist", "bin.js");
  return (file: PlannedFile): number => {
    console.log(`\n──── ${file.rel} ────`);
    const r = spawnSync(process.execPath, [tsNodeBin, file.abs], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    if (r.error) {
      console.error(`spawn failed: ${String(r.error)}`);
      return 1;
    }
    return r.status ?? 1;
  };
}

export function planFile(abs: string, repoRoot: string): PlannedFile {
  return { abs, rel: relative(repoRoot, abs).split(sep).join("/") };
}

/**
 * Run every planned file. THERE IS NO EARLY EXIT AND THERE MUST NEVER BE ONE.
 *
 * A file that is not a readable file on disk is marked UNREACHABLE and no child
 * is spawned for it — checked with `statSync` rather than `existsSync` so that a
 * path this process may not look at is not reported as "not there" (S96-D's
 * semantics, applied to a runner instead of a store).
 */
export function runEvery(
  files: readonly PlannedFile[],
  run: FileRunner
): FileResult[] {
  const results: FileResult[] = [];
  for (const file of files) {
    let reachable = false;
    try {
      reachable = statSync(file.abs).isFile();
    } catch {
      reachable = false;
    }
    if (!reachable) {
      console.log(`\n──── ${file.rel} ────`);
      console.log("UNREACHABLE — nothing was run for this file.");
      results.push({ rel: file.rel, outcome: "UNREACHABLE", exitCode: null });
      continue;
    }
    const code = run(file);
    results.push({ rel: file.rel, outcome: classifyExit(code), exitCode: code });
  }
  return results;
}

export function tally(results: readonly FileResult[]): Tally {
  const count = (o: Outcome): number =>
    results.filter((r) => r.outcome === o).length;
  return {
    total: results.length,
    passed: count("PASSED"),
    failed: count("FAILED"),
    incomplete: count("INCOMPLETE"),
    unreachable: count("UNREACHABLE"),
  };
}

/**
 * 1 when anything FAILED or was UNREACHABLE · 2 when the worst thing that
 * happened was INCOMPLETE · 0 only when every file ran and passed.
 *
 * Two is not a softer one. It is a DIFFERENT finding — nothing is wrong, and
 * something was never checked — and collapsing the two would delete exactly the
 * distinction `INCOMPLETE_EXIT_CODE` was minted to carry.
 */
export function exitCodeFor(t: Tally): number {
  if (t.failed > 0 || t.unreachable > 0) return 1;
  if (t.incomplete > 0) return 2;
  return 0;
}

/**
 * WHICH FILES RAN, not which files were named. Every file gets a line, in run
 * order, with its outcome — so "44 named, 43 ran" is impossible to print without
 * also printing which one did not.
 */
export function renderResults(results: readonly FileResult[]): string[] {
  const width = results.reduce((w, r) => Math.max(w, r.rel.length), 0);
  return results.map(
    (r) =>
      `  ${r.rel.padEnd(width)}  ${r.outcome.padEnd(11)}` +
      (r.exitCode === null ? "(nothing ran)" : `exit ${String(r.exitCode)}`)
  );
}

export function renderTally(t: Tally): string[] {
  const lines = [
    `named/planned: ${String(t.total)}`,
    `ran:           ${String(t.total - t.unreachable)}`,
    `passed:        ${String(t.passed)}`,
    `incomplete:    ${String(t.incomplete)}`,
    `failed:        ${String(t.failed)}`,
    `unreachable:   ${String(t.unreachable)}`,
  ];
  if (t.unreachable > 0) {
    lines.push(
      "",
      "A NAMED FILE THAT COULD NOT BE RUN IS A HOLE IN THE SUITE, not a skip. " +
        "Nothing here says whether it would have passed."
    );
  }
  if (t.incomplete > 0) lines.push("", INCOMPLETE_IS_NOT_A_PASS);
  return lines;
}

/**
 * The suite's declared environment dependencies, stated AT THE START.
 *
 * The A9 receipt's §E.4 found `inventory.test.ts` never running because the
 * gauge exited 77 forty files in. The amputation is fixed above; this closes the
 * other half of the same complaint — a dependency the suite needs was discovered
 * at file 40 by the person reading the tail, when it could have been said in the
 * first three lines. It is announced, never enforced: an unset variable is the
 * gauge's finding to report, not this runner's to pre-empt.
 */
export function envReport(env: NodeJS.ProcessEnv = process.env): string[] {
  if (SUITE_ENV.length === 0) return [];
  const lines = ["declared environment dependencies:"];
  for (const dep of SUITE_ENV) {
    const value = env[dep.name];
    const state = value === undefined || value === "" ? "NOT SET" : "set";
    lines.push(`  ${dep.name}: ${state} — ${dep.why} (needed by ${dep.neededBy})`);
    if (state === "NOT SET") {
      lines.push(
        `    that file will report INCOMPLETE, which is not a pass and not a failure.`
      );
    }
  }
  return lines;
}

/** True when the path is a file this process can stat. Exported for the guards. */
export function isRunnableFile(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
