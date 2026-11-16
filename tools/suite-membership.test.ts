// ── MICA · suite membership — the chain must not be able to look away ────────
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node tools/suite-membership.test.ts
//
// THE DEFECT THIS EXISTS TO END (S94→S95). The suite is enumerated twice: by a
// hand-maintained `&&` manifest and by a disk walk. On 2026-08-30 the suite was
// RED at T6 in `tools/dry-well-gauge/gauge.test.ts` while the manifest — which
// had never been told that file exists — would have exited 0.
//
// S98-D(5) MOVED THE MANIFEST'S KEY to `CHAIN_SCRIPT` and made `test:mica` the
// runner that reaches every file the manifest names. This guard is unchanged in
// what it asserts: it holds the NAMED half, and `run-chain.ts` holds the REACHED
// half that this one implies. A green
// that is not looking is this project's own thesis eating the project: the
// unrecorded pass is the silent fail-open, and here the pass was unrecorded
// because the check was never enumerated.
//
// `run-suite.ts` already PRINTED the drift ("DISCOVERED, NOT IN CHAIN"). It
// printed it and exited 0, because a census counts and judges nothing. Printing
// is not guarding. This file is the guard: the same two counts, one disk, and a
// non-zero exit when they disagree.
//
// WHAT IT DOES NOT BUY, stated rather than assumed: it cannot see a test that
// is not named `*.test.ts`, because it reads the convention rather than the
// intent. That residual is `run-suite.ts`'s printed one, inherited whole.

import assert from "assert";
import { readFileSync } from "fs";
import { relative, resolve, sep } from "path";

import {
  chainTestFiles,
  CHAIN_SCRIPT,
  discoverAllTests,
  DISCOVERY_ROOTS,
  TEST_SUFFIX,
} from "./suite-protocol";

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
const rel = (p: string): string => relative(REPO_ROOT, p).split(sep).join("/");

/** The chain as package.json states it. Its absence is a failure, not a skip. */
function readChain(): string {
  const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"));
  // The KEY moved on 2026-08-31 (S98-D(5)): `test:mica` now invokes the runner
  // and the hand-maintained manifest lives under `CHAIN_SCRIPT`. The name is
  // imported rather than written, so this guard and `run-chain.ts` cannot come
  // to disagree about which string they are reading.
  const chain: unknown = pkg?.scripts?.[CHAIN_SCRIPT];
  assert.strictEqual(
    typeof chain,
    "string",
    `package.json has no \`${CHAIN_SCRIPT}\` script. If the manifest was ` +
      "deliberately retired, retire this guard in the same commit — a guard " +
      "over nothing that passes is the shape it was built to catch."
  );
  return chain as string;
}

console.log("\n── suite membership · the chain against the disk ─────────────");

check("SM-A · EVERY discovered test file is named in the manifest", () => {
  const discovered = discoverAllTests(REPO_ROOT);
  assert.ok(discovered.length > 0, "0 discovered is not a clean census");
  const named = new Set(chainTestFiles(readChain(), REPO_ROOT));
  const missing = discovered.filter((f) => !named.has(f)).map(rel);
  assert.deepStrictEqual(
    missing,
    [],
    `${missing.length} discovered test file(s) the chain never runs:\n` +
      missing.map((m) => `      ${m}`).join("\n") +
      `\n    Add each to package.json scripts["${CHAIN_SCRIPT}"]. Until then ` +
      `\`npm run test:mica\` cannot run them at all.`
  );
});

check("SM-B · every file the chain names is actually on disk", () => {
  const discovered = new Set(discoverAllTests(REPO_ROOT));
  const stale = chainTestFiles(readChain(), REPO_ROOT)
    .filter((f) => !discovered.has(f))
    .map(rel);
  assert.deepStrictEqual(
    stale,
    [],
    `the chain names ${stale.length} file(s) discovery cannot find: ${stale.join(", ")}`
  );
});

check("SM-C · the chain is read across EVERY discovery root, not just the first", () => {
  // The regression this pins: the audit's pattern was written `src/…` while the
  // census walked src AND tools, so a `tools/` entry in the chain was invisible
  // to the very check that was supposed to notice it missing. A synthetic chain
  // naming one file per root must come back with one file per root.
  const synthetic = DISCOVERY_ROOTS.map(
    (r) => `ts-node ${r}/zz-synthetic${TEST_SUFFIX}`
  ).join(" && ");
  const seen = chainTestFiles(synthetic, REPO_ROOT).map(rel);
  assert.deepStrictEqual(
    seen,
    DISCOVERY_ROOTS.map((r) => `${r}/zz-synthetic${TEST_SUFFIX}`),
    "a discovery root the chain parser cannot see is a root the audit cannot audit"
  );
});

check("SM-D · this guard can see itself — a walk that stopped walking", () => {
  const discovered = discoverAllTests(REPO_ROOT).map(rel);
  assert.ok(
    discovered.includes("tools/suite-membership.test.ts"),
    "the walk did not find this file, so nothing it reports about other files " +
      "can be trusted either"
  );
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
