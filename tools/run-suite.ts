#!/usr/bin/env node
// ── MICA · run-suite — the discovery-based census runner ─────────────────────
//
// THE ONE SENTENCE THIS TOOL IS ALLOWED TO SAY:
//
//   Every file matching *.test.ts under src/ and tools/ was executed and its
//   exit code recorded; a file this convention cannot see was not run, and
//   this runner cannot know it exists.
//
// It is a CENSUS, not a certificate. It counts, prints, and judges nothing
// beyond exit codes. "All passed" here means "all DISCOVERED passed" — the
// discovery convention is the ceiling, and it is printed, not hidden.
//
// WHY THIS EXISTS (S81): package.json's test:mica is a hand-maintained
// 34-link `&&` chain. A new test file nobody adds to the chain is silently
// never run — it passes by not existing to the runner. That is the project's
// own thesis eating the project: the unrecorded pass is the silent fail-open.
// Discovery closes it: a file that exists IS run; forgetting is no longer an
// available failure.
//
// THE RESIDUAL FAIL-OPEN, printed rather than papered over: a test not named
// *.test.ts is invisible here. Naming discipline is the load-bearing wall this
// tool leans on and cannot check.
//
// THE CHAIN AUDIT: while test:mica's chain still exists in package.json, this
// runner diffs its file list against discovery and prints both directions.
// The new instrument's first job is to audit the old one. When the chain is
// retired, the audit reports the chain as absent and moves on — absence of
// the old harness is not an error.
//
// AN EMPTY CENSUS IS NOT A CLEAN ONE: zero discovered files exits FAIL.
// (The lesson is search_files' bare-pattern nil, 2026-08-24, twice.)
// ──────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "fs";
import { join, relative, resolve, sep } from "path";

import {
  chainTestFiles,
  CHAIN_SCRIPT,
  discoverAllTests,
  DISCOVERY_ROOTS,
  TEST_SUFFIX,
} from "./suite-protocol";
import {
  envReport,
  exitCodeFor,
  planFile,
  renderResults,
  renderTally,
  runEvery,
  tally,
  tsNodeRunner,
} from "./suite-runner";

const REPO_ROOT = resolve(__dirname, "..");

// ── discovery ─────────────────────────────────────────────────────────────────

// The roots, the suffix and the walker live in ./suite-protocol since S95,
// so the membership guard reads the same convention this census runs on.

// ── the chain audit (transition-only; absence of the chain is not an error) ──

function chainFiles(): { present: boolean; files: string[] } {
  const pkgPath = join(REPO_ROOT, "package.json");
  if (!existsSync(pkgPath)) return { present: false, files: [] };
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  // READS THE MANIFEST KEY, NOT `test:mica`. Since 2026-08-31 `test:mica` is
  // `ts-node tools/run-chain.ts` — a string containing no `*.test.ts` at all —
  // so an audit still pointed at it would parse zero named files and report
  // every discovered file as DISCOVERED, NOT IN CHAIN. The audit would have kept
  // printing, and what it printed would have been noise.
  const chain: string | undefined = pkg?.scripts?.[CHAIN_SCRIPT];
  if (typeof chain !== "string") return { present: false, files: [] };
  return { present: true, files: chainTestFiles(chain, REPO_ROOT) };
}

// ── execution ────────────────────────────────────────────────────────────────
// The loop, the four outcomes, the tally and the exit-code policy moved to
// ./suite-runner in S98 so that this census and `run-chain.ts` — two independent
// enumerations of the suite — cannot drift about what an exit code MEANS. A
// second copy of the outcome rules is a second place for them to disagree.

// ── main ─────────────────────────────────────────────────────────────────────

function main(): number {
  console.log("MICA suite census — discovery-based. A census, not a certificate.");
  console.log(`convention: **/*${TEST_SUFFIX} under ${DISCOVERY_ROOTS.join(", ")}/`);
  console.log("a test outside this convention is invisible here and was NOT run.\n");

  const discovered = discoverAllTests(REPO_ROOT);

  if (discovered.length === 0) {
    console.error("0 test files discovered. An empty census is not a clean one. FAIL.");
    return 1;
  }

  // Chain audit before running, so a hang mid-suite still leaves the diff on
  // the record above it.
  const chain = chainFiles();
  if (chain.present) {
    const discoveredSet = new Set(discovered);
    const chainSet = new Set(chain.files);
    const onlyDiscovered = discovered.filter((f) => !chainSet.has(f));
    const onlyChain = chain.files.filter((f) => !discoveredSet.has(f));
    console.log(
      `chain audit: ${CHAIN_SCRIPT} names ${chain.files.length}; discovery finds ${discovered.length}.`
    );
    for (const f of onlyDiscovered) {
      console.log(`  DISCOVERED, NOT IN CHAIN: ${relative(REPO_ROOT, f).split(sep).join("/")}`);
    }
    for (const f of onlyChain) {
      console.log(`  IN CHAIN, NOT ON DISK:    ${relative(REPO_ROOT, f).split(sep).join("/")}`);
    }
    if (onlyDiscovered.length === 0 && onlyChain.length === 0) {
      console.log("  chain and discovery agree — two counts, one disk.");
    }
  } else {
    console.log(
      `chain audit: no ${CHAIN_SCRIPT} manifest in package.json — nothing to diff. Not an error.`
    );
  }

  const env = envReport();
  if (env.length > 0) {
    console.log("");
    for (const line of env) console.log(line);
  }

  // FOUR OUTCOMES, and every one of the discovered files is reached — see
  // suite-runner.ts. This census never stopped early, but it also never SAID
  // which files ran; now it prints a line per file, so "44 discovered, 43 ran"
  // cannot be printed without naming the one that did not.
  const results = runEvery(
    discovered.map((abs) => planFile(abs, REPO_ROOT)),
    tsNodeRunner(REPO_ROOT)
  );
  const counts = tally(results);

  console.log(`\n════ CENSUS ════`);
  for (const line of renderResults(results)) console.log(line);
  console.log("");
  for (const line of renderTally(counts)) console.log(line);

  const code = exitCodeFor(counts);
  console.log(
    code === 0
      ? `\nall ${String(counts.total)} DISCOVERED files passed. Discovery convention is the ceiling.`
      : `\nTHIS CENSUS IS NOT CLEAN. exit ${String(code)}.`
  );
  return code;
}

process.exit(main());
