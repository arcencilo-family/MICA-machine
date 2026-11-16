// ── MICA · the suite runner — acceptance tests ───────────────────────────────
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node tools/suite-runner.test.ts
//
// ── THE ONE PROPERTY THIS FILE EXISTS FOR ────────────────────────────────────
//
//   A failure in the middle must not stop the tail. That was the defect: with a
//   `&&` chain, `tools/dry-well-gauge/gauge.test.ts` exiting 77 meant
//   `tools/inventory/inventory.test.ts` — twelve tests — never ran, and nothing
//   said so. The proof below is RED-FIRST in the honest sense: SR-A plants a
//   failure mid-list and asserts the tail RAN, which is exactly the assertion a
//   `&&` chain cannot satisfy. Deleting `runEvery`'s loop-through behaviour, or
//   putting an early `break` back in, fails it.
//
// ── WHERE THE FIXTURES LIVE, AND WHY IT IS NOT tmpdir ────────────────────────
//
//   Measured 2026-08-31: `ts-node <file>` for a file OUTSIDE the project root
//   prints nothing and EXITS 0. A `process.exit(3)` in `/tmp` came back 0; the
//   same file under `tools/` came back 3. So an end-to-end body whose fixtures
//   sat in tmpdir would assert that a failing file "passed" and would pass while
//   asserting the opposite of the truth. The fixtures therefore live in a
//   throwaway directory INSIDE the repository, removed in a `finally`, and named
//   without the test suffix so discovery cannot pick them up.

import assert from "assert";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";

import { CHAIN_SCRIPT, INCOMPLETE_EXIT_CODE, SUITE_ENV } from "./suite-protocol";
import { readManifest } from "./run-chain";
import {
  classifyExit,
  envReport,
  exitCodeFor,
  isRunnableFile,
  planFile,
  renderResults,
  renderTally,
  runEvery,
  tally,
  tsNodeRunner,
} from "./suite-runner";
import type { FileResult, PlannedFile } from "./suite-runner";

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

const REPO_ROOT = resolve(__dirname, "..");

/** A planned file that exists, so `runEvery` reaches the injected runner. */
function planned(rel: string): PlannedFile {
  return { abs: join(REPO_ROOT, rel), rel };
}

/** Records the order files were handed to it, and returns planted exit codes. */
function scriptedRunner(codes: Record<string, number>, order: string[]) {
  return (file: PlannedFile): number => {
    order.push(file.rel);
    return codes[file.rel] ?? 0;
  };
}

console.log("\n── the loop · a failure in the middle does not stop the tail ──");

check("SR-A · RED-FIRST — a mid-list failure, and the tail still runs", () => {
  // Three real files, so nothing is UNREACHABLE and the runner is the only thing
  // under test. The middle one "fails". A `&&` chain would stop here; this must
  // not, and the summary must name the failure.
  const files = [
    planned("tools/suite-protocol.ts"),
    planned("tools/suite-runner.ts"),
    planned("tools/run-chain.ts"),
  ];
  const order: string[] = [];
  const results = runEvery(
    files,
    scriptedRunner({ "tools/suite-runner.ts": 1 }, order)
  );

  assert.deepStrictEqual(
    order,
    files.map((f) => f.rel),
    "the runner stopped early: the tail after the failure was never handed over"
  );
  assert.deepStrictEqual(
    results.map((r) => r.outcome),
    ["PASSED", "FAILED", "PASSED"]
  );
  const counts = tally(results);
  assert.deepStrictEqual(counts, {
    total: 3,
    passed: 2,
    failed: 1,
    incomplete: 0,
    unreachable: 0,
  });
  assert.strictEqual(exitCodeFor(counts), 1);
  // The summary NAMES it — a count alone would not tell you which.
  const rendered = renderResults(results).join("\n");
  assert.ok(rendered.includes("tools/suite-runner.ts"));
  assert.ok(/tools\/suite-runner\.ts\s+FAILED\s+exit 1/.test(rendered));
});

check("SR-B · an INCOMPLETE in the middle also does not stop the tail", () => {
  // The exact shape of the real defect: 77 mid-list, and the last file is the
  // one that never ran. `tools/inventory/inventory.test.ts` was that file.
  const files = [
    planned("tools/suite-protocol.ts"),
    planned("tools/suite-runner.ts"),
    planned("tools/run-chain.ts"),
  ];
  const order: string[] = [];
  const results = runEvery(
    files,
    scriptedRunner({ "tools/suite-runner.ts": INCOMPLETE_EXIT_CODE }, order)
  );

  assert.strictEqual(order.length, 3, "the tail after an INCOMPLETE was skipped");
  assert.deepStrictEqual(
    results.map((r) => r.outcome),
    ["PASSED", "INCOMPLETE", "PASSED"]
  );
  const counts = tally(results);
  assert.strictEqual(counts.incomplete, 1);
  assert.strictEqual(counts.failed, 0);
  // 2, not 1 and not 0. Nothing is wrong AND something was never checked.
  assert.strictEqual(exitCodeFor(counts), 2);
  assert.ok(
    renderTally(counts).join("\n").includes("It is not a pass"),
    "an incomplete run did not say that it is not a pass"
  );
});

check("SR-C · a NAMED file that is not on disk is UNREACHABLE, and nothing ran for it", () => {
  const order: string[] = [];
  const results = runEvery(
    [planned("tools/suite-protocol.ts"), planned("tools/zz-was-deleted.ts")],
    scriptedRunner({}, order)
  );

  assert.deepStrictEqual(order, ["tools/suite-protocol.ts"], "a missing file was spawned");
  const missing = results[1];
  assert.strictEqual(missing.outcome, "UNREACHABLE");
  assert.strictEqual(
    missing.exitCode,
    null,
    "an exit code was recorded for a file that never ran"
  );
  const counts = tally(results);
  assert.strictEqual(counts.unreachable, 1);
  assert.strictEqual(exitCodeFor(counts), 1, "a hole in the suite exited clean");
  assert.ok(renderTally(counts).join("\n").includes("HOLE IN THE SUITE"));
});

check("SR-D · every outcome is reachable and the exit-code policy is total", () => {
  assert.strictEqual(classifyExit(0), "PASSED");
  assert.strictEqual(classifyExit(1), "FAILED");
  assert.strictEqual(classifyExit(2), "FAILED");
  assert.strictEqual(classifyExit(INCOMPLETE_EXIT_CODE), "INCOMPLETE");

  const t = (o: Partial<ReturnType<typeof tally>>) =>
    exitCodeFor({ total: 1, passed: 0, failed: 0, incomplete: 0, unreachable: 0, ...o });
  assert.strictEqual(t({ passed: 1 }), 0);
  assert.strictEqual(t({ failed: 1 }), 1);
  assert.strictEqual(t({ unreachable: 1 }), 1);
  assert.strictEqual(t({ incomplete: 1 }), 2);
  // A failure outranks an incomplete: the worse finding is the one reported.
  assert.strictEqual(t({ failed: 1, incomplete: 1 }), 1);
});

check("SR-E · the per-file lines say which files RAN, not just how many", () => {
  const results: FileResult[] = [
    { rel: "a.ts", outcome: "PASSED", exitCode: 0 },
    { rel: "bbbb.ts", outcome: "UNREACHABLE", exitCode: null },
  ];
  const lines = renderResults(results);
  assert.strictEqual(lines.length, 2);
  assert.ok(lines[0].includes("a.ts") && lines[0].includes("exit 0"));
  assert.ok(lines[1].includes("bbbb.ts") && lines[1].includes("(nothing ran)"));
  // The counts and the lines have to agree, or one of them is decoration.
  const counts = tally(results);
  assert.strictEqual(counts.total - counts.unreachable, 1);
  assert.ok(renderTally(counts).join("\n").includes("ran:           1"));
});

console.log("\n── the environment · stated at the start, never enforced ──");

check("SR-F · an unset declared variable is announced, and is not a gate", () => {
  assert.ok(SUITE_ENV.length > 0, "nothing declares the suite's environment");
  const dep = SUITE_ENV[0];
  const unset = envReport({}).join("\n");
  assert.ok(unset.includes(dep.name));
  assert.ok(unset.includes("NOT SET"));
  assert.ok(unset.includes(dep.neededBy), "the report does not say who needs it");
  assert.ok(
    unset.includes("not a pass and not a failure"),
    "an unset dependency was reported as a verdict"
  );

  const set = envReport({ [dep.name]: "/some/path" }).join("\n");
  assert.ok(set.includes(`${dep.name}: set`));
  assert.ok(!set.includes("NOT SET"));
});

check("SR-G · MICA_LEDGER_PATH is the declared dependency, by name", () => {
  // Pinned because this is the variable whose absence amputated the suite. If
  // it is ever renamed, this line is where a reader finds out why it mattered.
  assert.ok(
    SUITE_ENV.some((d) => d.name === "MICA_LEDGER_PATH"),
    "the variable that cost twelve unrun tests is no longer declared"
  );
});

console.log("\n── the manifest · the runner's only source of files ──");

check("SR-H · the manifest key is read from the constant, and the manifest is real", () => {
  assert.strictEqual(CHAIN_SCRIPT, "test:mica:chain");
  const manifest = readManifest(REPO_ROOT);
  assert.notStrictEqual(manifest, null, "no manifest under the declared key");
  assert.ok((manifest as string).includes(".test.ts"), "the manifest names no test files");
  // And `test:mica` must NOT be the chain any more — that is the whole medicine.
  const pkg = JSON.parse(
    require("fs").readFileSync(join(REPO_ROOT, "package.json"), "utf8")
  );
  assert.strictEqual(
    pkg.scripts["test:mica"],
    "ts-node tools/run-chain.ts",
    "`test:mica` is a raw chain again — the name people type amputates once more"
  );
  assert.ok(
    !String(pkg.scripts["test:mica"]).includes("&&"),
    "`test:mica` contains an && chain"
  );
});

check("SR-I · this file is itself in the manifest — a guard that can see itself", () => {
  const manifest = readManifest(REPO_ROOT) ?? "";
  assert.ok(
    manifest.includes("tools/suite-runner.test.ts"),
    "the runner's own guard is not in the suite it guards"
  );
});

console.log("\n── end to end · real children, real exit codes ──");

check("SR-J · REAL SPAWN — a real failing file mid-list, and the tail really runs", () => {
  // Fixtures live inside the repository: ts-node exits 0 without running
  // anything for a file outside the project root, so a tmpdir fixture would
  // make this body assert the opposite of the truth and pass. Named without the
  // test suffix so discovery cannot adopt them.
  const dir = join(REPO_ROOT, "tools", "zz-runner-fixture");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a-ok.ts"), 'console.log("A ran");\n', "utf8");
    writeFileSync(
      join(dir, "b-fails.ts"),
      'console.log("B ran"); process.exit(1);\n',
      "utf8"
    );
    writeFileSync(
      join(dir, "c-incomplete.ts"),
      `console.log("C ran"); process.exit(${String(INCOMPLETE_EXIT_CODE)});\n`,
      "utf8"
    );
    writeFileSync(join(dir, "d-ok.ts"), 'console.log("D ran");\n', "utf8");

    const files = ["a-ok", "b-fails", "c-incomplete", "d-ok"].map((n) =>
      planFile(join(dir, `${n}.ts`), REPO_ROOT)
    );
    const results = runEvery(files, tsNodeRunner(REPO_ROOT));

    assert.deepStrictEqual(
      results.map((r) => r.outcome),
      ["PASSED", "FAILED", "INCOMPLETE", "PASSED"]
    );
    // D is the point. Under `&&` it would never have been reached.
    assert.strictEqual(results[3].exitCode, 0);
    assert.strictEqual(results[1].exitCode, 1);
    assert.strictEqual(results[2].exitCode, INCOMPLETE_EXIT_CODE);
    const counts = tally(results);
    assert.strictEqual(exitCodeFor(counts), 1);
    assert.strictEqual(counts.total - counts.unreachable, 4, "not every file ran");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

check("SR-K · the fixture directory left nothing behind", () => {
  assert.strictEqual(
    isRunnableFile(join(REPO_ROOT, "tools", "zz-runner-fixture", "a-ok.ts")),
    false,
    "a fixture survived the run and is now sitting in the repository"
  );
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
