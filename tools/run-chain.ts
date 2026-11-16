#!/usr/bin/env node
// ── MICA · run-chain — run every file the manifest NAMES, and reach all of them ─
//
// THE ONE SENTENCE THIS TOOL IS ALLOWED TO SAY:
//
//   Every file named by the `test:mica:chain` manifest was either run and its
//   exit code recorded, or reported UNREACHABLE; a file the manifest does not
//   name was not run, and this tool cannot know it exists.
//
// ── WHAT IT REPLACES, AND THE DEFECT THAT PAID FOR IT (S98-D(5)) ─────────────
//
//   `npm run test:mica` was the `&&` chain itself. `&&` stops at the first
//   non-zero exit. `tools/dry-well-gauge/gauge.test.ts` sits second-to-last and
//   exits 77 (INCOMPLETE) whenever `MICA_LEDGER_PATH` is unset — which is the
//   default state — so `tools/inventory/inventory.test.ts`, TWELVE TESTS, was
//   never run at all. Not skipped, not counted, not mentioned. The A9 receipt's
//   §E.4 measured it at HEAD 80f346e: exit 77, and the last link absent from
//   the output entirely.
//
//   `suite-membership.test.ts` already guarded that every discovered file is
//   NAMED in the manifest. Nothing guarded that every named file was REACHED.
//   This tool is that second guard, and the pair is the point: naming without
//   reaching is a list, and reaching without naming is a walk that cannot be
//   audited.
//
// ── WHY THE MANIFEST STAYS, RATHER THAN EVERYTHING MOVING TO DISCOVERY ───────
//
//   `run-suite.ts` already runs what discovery FINDS. Retiring the hand list
//   would leave ONE enumeration of the suite, and a bug in the walk — a
//   `SKIP_DIRS` that grew, a suffix that changed — would then remove files from
//   the suite with nothing to notice. Two independent lists, cross-checked by
//   `suite-membership.test.ts`, is the property. Two counts, one disk.
//
//   So the manifest keeps its `&&` form and stays runnable on its own for a
//   quick one-shot (`npm run test:mica:chain`). What changed is which of the two
//   the DEFAULT NAME invokes.
//
// ── EXIT CODES, shared with run-suite via suite-runner ───────────────────────
//
//   0  every named file ran and passed
//   1  something FAILED, or a named file was UNREACHABLE
//   2  nothing failed and something was INCOMPLETE — a different finding, not a
//      softer one: nothing is wrong and something was never checked
//   3  the manifest itself is missing or names no test files at all
// ──────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";

import {
  chainTestFiles,
  CHAIN_SCRIPT,
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

export const NO_MANIFEST_EXIT = 3;

/**
 * The manifest string, or null.
 *
 * ITS ABSENCE IS AN ERROR HERE, unlike in `run-suite.ts` where the chain audit
 * is transitional and a missing chain is merely nothing to diff. This tool has
 * no other source of files: with no manifest it would run zero files and exit
 * clean, which is the empty census that is not a clean one.
 */
export function readManifest(repoRoot: string): string | null {
  const pkgPath = join(repoRoot, "package.json");
  if (!existsSync(pkgPath)) return null;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const chain: unknown = pkg?.scripts?.[CHAIN_SCRIPT];
  return typeof chain === "string" ? chain : null;
}

function main(): number {
  console.log("MICA suite — the NAMED manifest, every file reached.");
  console.log(`manifest: package.json scripts["${CHAIN_SCRIPT}"]`);
  console.log(
    `a file the manifest does not name was NOT run here; ` +
      `\`npm run test:all\` walks **/*${TEST_SUFFIX} under ${DISCOVERY_ROOTS.join(", ")}/ instead.`
  );

  const manifest = readManifest(REPO_ROOT);
  if (manifest === null) {
    console.error(
      `\nno \`${CHAIN_SCRIPT}\` script in package.json. This tool has no other ` +
        `source of files, and running zero files cleanly is the empty census ` +
        `that is not a clean one. If the manifest was deliberately retired, ` +
        `retire this runner and \`suite-membership.test.ts\` in the same commit.`
    );
    return NO_MANIFEST_EXIT;
  }

  const named = chainTestFiles(manifest, REPO_ROOT);
  if (named.length === 0) {
    console.error(
      `\nthe \`${CHAIN_SCRIPT}\` manifest names 0 test files. An empty census is ` +
        `not a clean one.`
    );
    return NO_MANIFEST_EXIT;
  }

  const env = envReport();
  if (env.length > 0) {
    console.log("");
    for (const line of env) console.log(line);
  }

  const planned = named.map((abs) => planFile(abs, REPO_ROOT));
  console.log(`\n${String(planned.length)} file(s) named. Running every one of them.`);

  const results = runEvery(planned, tsNodeRunner(REPO_ROOT));
  const counts = tally(results);

  console.log(`\n════ SUITE ════`);
  for (const line of renderResults(results)) console.log(line);
  console.log("");
  for (const line of renderTally(counts)) console.log(line);

  const code = exitCodeFor(counts);
  console.log(
    code === 0
      ? `\nall ${String(counts.total)} NAMED files ran and passed. The manifest is the ceiling.`
      : `\nNOT CLEAN. exit ${String(code)}.`
  );
  return code;
}

if (require.main === module) process.exit(main());
