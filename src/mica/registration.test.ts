// ── MICA · the test-registration guard (F10) ──────────────────────────────────
//
// WHY THIS FILE EXISTS
//
//   `test:mica` chains its test files BY HAND. A hand-maintained list silently
//   omits what nobody remembers to add: the Codex substrate review found exactly
//   that — `src/mica/log.test.ts` was reachable only through a SEPARATE script,
//   so a normal "full MICA suite" run never exercised the foundational log/load-
//   state checks, and any future `*.test.ts` could go the same way unnoticed.
//
//   This is the deterministic discovery guard that closes the accounting gap: it
//   walks `src/**/*.test.ts` — THE WHOLE REPOSITORY SOURCE TREE, not `src/mica/`
//   alone — parses the registered set out of the actual `test:mica` script in
//   package.json, and FAILS when a discovered test file is not registered (or a
//   registered one has vanished). Adding a test file now forces its
//   registration; it can no longer be quietly dropped.
//
//   SCOPE — WIDENED W1, 2026-08-23. This guard was itself scoped to `src/mica/`
//   on BOTH sides, and so was blind to the two chained entries that do not live
//   there: `src/clerk/clerk.test.ts` and `src/integration/l0-clerk-f3.test.ts`.
//   Either could have been deleted from the `test:mica` chain and this file
//   would still have passed green — the instrument built to stop a test file
//   silently dropping out of the suite could not see two of the files in it.
//   The walk root is now the repository's `src/`, and the script parser matches
//   any `src/…/*.test.ts` entry, not only `src/mica/` ones.
//
//   THERE IS NO EXCEPTION LIST, and none is to be added. Ruled 2026-08-23. A
//   pinned list of files-allowed-outside-the-suite would today be EMPTY, and an
//   empty structure that already looks like a list of exceptions is the quiet
//   path: dropping a test out of the suite would then cost one appended line.
//   Without it, the same act costs DELETING AN ASSERTION — a deliberate edit
//   that shows in a diff and that a human reading it can see. If a `*.test.ts`
//   under `src/**` ever genuinely must sit outside the suite, that is an
//   architecture decision and it should cost exactly that much.
//
//   It measures the wiring. It is not itself an instrument — like the closure
//   guards, it emits no verdict and reads no evidence log.

import assert from "assert";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    failed++;
  }
}

const MICA_DIR = __dirname;
const REPO_ROOT = join(MICA_DIR, "..", "..");
const SRC_ROOT = join(REPO_ROOT, "src");

/** Every `*.test.ts` under `dir`, repo-relative with forward slashes. */
function discoveredTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...discoveredTestFiles(full));
    else if (name.endsWith(".test.ts")) {
      out.push(relative(REPO_ROOT, full).replace(/\\/g, "/"));
    }
  }
  return out.sort();
}

/**
 * The `src/…/*.test.ts` files a `test:mica`-shaped SCRIPT STRING runs.
 *
 * Kept separate from the package.json read on purpose: a parser that has only
 * ever been handed the live script has only ever been observed AGREEING, and is
 * indistinguishable from a broken one. Split out, it can be fed a synthetic
 * string with a known hole and proven to catch it — see the parser check below.
 */
function parseRegisteredTestFiles(script: string): string[] {
  const found = new Set<string>();
  // Anchored at a token boundary: a path that merely CONTAINS "src/" — say
  // `tools/src/clerk/clerk.test.ts` — is not a repo-relative suite entry.
  const re = /(?:^|[\s&|])(src\/[^\s&|]+\.test\.ts)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(script)) !== null) found.add(m[1]);
  return [...found].sort();
}

/** The `src/…/*.test.ts` files the real `test:mica` script actually runs. */
function registeredSuiteTestFiles(): string[] {
  const pkg = JSON.parse(
    readFileSync(join(REPO_ROOT, "package.json"), "utf8")
  ) as { scripts?: Record<string, string> };
  // ── THE KEY, CARRIED AS A LITERAL, AND WHY IT CANNOT BE IMPORTED ──────────
  //
  //   `tools/suite-protocol.ts` declares this name once as `CHAIN_SCRIPT`, and
  //   `run-chain.ts` and `tools/suite-membership.test.ts` both import it. THIS
  //   FILE MAY NOT: `closure.test.ts` rules ZERO EDGES OUT OF `src/mica/`, and
  //   reaching into `tools/` for a string would be the first one. Duplicating a
  //   constant is the lesser fault, and it FAILS CLOSED — if the key is ever
  //   renamed without this line following, the chain read here is empty, and the
  //   check below fails naming every test file in the repository. Loud, not
  //   silent.
  //
  //   It was `test:mica` until 2026-08-31 (S98-D(5)), when `test:mica` became
  //   the RUNNER and the hand-maintained manifest moved under its own key.
  return parseRegisteredTestFiles(pkg.scripts?.["test:mica:chain"] ?? "");
}

console.log("\n── MICA test-registration guard (F10) ────────────────────────");

check("the discovery walk actually leaves src/mica/ and reaches the whole of src/", () => {
  const discovered = discoveredTestFiles(SRC_ROOT);
  assert.ok(discovered.length >= 10, `walk suspiciously small: ${discovered.join(", ")}`);
  // Sanity anchors: the file the review caught, and this guard itself.
  assert.ok(discovered.includes("src/mica/log.test.ts"), "log.test.ts not discovered");
  assert.ok(discovered.includes("src/mica/registration.test.ts"), "this guard not discovered");
  // Anchors OUTSIDE src/mica/. Both anchors above sit inside it, so a widened
  // walk that silently failed to descend into the other src/ subtrees would
  // pass them — the exact blindness this widening closes, recreated inside the
  // fix. These three make that failure loud.
  for (const outside of [
    "src/witness/witness.test.ts",
    "src/clerk/clerk.test.ts",
    "src/integration/l0-clerk-f3.test.ts",
  ]) {
    assert.ok(
      discovered.includes(outside),
      `the walk did not leave src/mica/: ${outside} was not discovered`
    );
  }
});

check("EVERY discovered src/**/*.test.ts is registered in test:mica", () => {
  const discovered = discoveredTestFiles(SRC_ROOT);
  const registered = new Set(registeredSuiteTestFiles());
  const unregistered = discovered.filter((f) => !registered.has(f));
  assert.deepStrictEqual(
    unregistered,
    [],
    `these test files exist but test:mica does not run them: ${unregistered.join(", ")} — ` +
      `add them to the test:mica chain in package.json, or the "full MICA suite" is a lie. ` +
      `There is no exception list; there is not meant to be one.`
  );
});

check("every test file test:mica registers still exists on disk", () => {
  const discovered = new Set(discoveredTestFiles(SRC_ROOT));
  const registered = registeredSuiteTestFiles();
  const missing = registered.filter((f) => !discovered.has(f));
  assert.deepStrictEqual(
    missing,
    [],
    `test:mica registers files that do not exist: ${missing.join(", ")}`
  );
});

check("the script parser CATCHES a real omission — it does not merely agree", () => {
  // Every string below is CONSTRUCTED HERE. The real package.json is never
  // read, mutated or restored by this check: the guard must not be able to
  // damage the thing it guards.
  const files = [
    "src/mica/log.test.ts",
    "src/clerk/clerk.test.ts",
    "src/witness/witness.test.ts",
  ];
  const chain = (list: readonly string[]): string =>
    list.map((f) => `ts-node ${f}`).join(" && ");
  const dropped = "src/clerk/clerk.test.ts";

  // Positive control — nothing missing, nothing invented.
  assert.deepStrictEqual(
    parseRegisteredTestFiles(chain(files)),
    [...files].sort(),
    "the parser failed to recover a complete synthetic chain"
  );

  // The real test — one entry deleted, and the omission is detected, and it is
  // exactly the entry that was deleted.
  const registered = new Set(
    parseRegisteredTestFiles(chain(files.filter((f) => f !== dropped)))
  );
  const unregistered = files.filter((f) => !registered.has(f));
  assert.deepStrictEqual(
    unregistered,
    [dropped],
    `the parser did NOT catch a deleted chain entry: expected [${dropped}], ` +
      `got [${unregistered.join(", ")}]`
  );

  // And a path that merely CONTAINS "src/" is not a registration.
  assert.deepStrictEqual(
    parseRegisteredTestFiles("echo see tools/src/clerk/clerk.test.ts for the vendored copy"),
    [],
    "the parser matched a path that is not a repo-relative src/ suite entry"
  );
});

// ── D-32 · gate-reader enumeration ───────────────────────────────────────────
//
// The general discovery guard above proves every test is wired. This second,
// narrower assertion names the architectural class whose second member made a
// silent omission materially easier to miss: GATE readers. It derives the live
// set from each directory's sensor id, then pins the two registered test paths.

const D32_GATE_READER_TESTS: readonly string[] = [
  "src/mica/gate1-scope/gate1-scope.test.ts",
  "src/mica/gate2-direction/gate2-direction.test.ts",
  "src/mica/gate4-sunset/gate4-sunset.test.ts",
  "src/mica/gate5-adaptive/gate5-adaptive.test.ts",
];

function discoveredGateReaderTests(): string[] {
  const out: string[] = [];
  for (const name of readdirSync(MICA_DIR)) {
    const dir = join(MICA_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    const names = readdirSync(dir);
    if (!names.includes("index.ts")) continue;
    const source = readFileSync(join(dir, "index.ts"), "utf8");
    if (!/SENSOR_ID\s*=\s*["']MICA\/gate/.test(source)) continue;
    for (const file of names.filter((entry) => entry.endsWith(".test.ts"))) {
      out.push(`src/mica/${name}/${file}`);
    }
  }
  return out.sort();
}

check("D-32 enumerates every gate reader and keeps each in test:mica", () => {
  const discovered = discoveredGateReaderTests();
  const expected = [...D32_GATE_READER_TESTS].sort();
  assert.deepStrictEqual(
    discovered,
    expected,
    `gate-reader enumeration changed: discovered ${discovered.join(", ")}; ` +
      `D32 pins ${expected.join(", ")}. Update the architectural enumeration deliberately.`
  );
  const registered = new Set(registeredSuiteTestFiles());
  const omitted = expected.filter((file) => !registered.has(file));
  assert.deepStrictEqual(
    omitted,
    [],
    `gate reader(s) silently dropped out of test:mica: ${omitted.join(", ")}`
  );
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
