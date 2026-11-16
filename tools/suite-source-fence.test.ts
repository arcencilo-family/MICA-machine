// ── MICA · suite source fence — the suite does not name the box ──────────────
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node tools/suite-source-fence.test.ts
//
// ── THE DEFECT THIS EXISTS TO END (S116) ─────────────────────────────────────
//
//   `assembler.test.ts` carried a check called "the live A9 book, as this
//   principal actually sees it". It named the deployed book's real path and
//   READ IT, on every suite run, on the arbiter's box. Two things were wrong, and the
//   second is the one that took a session to notice:
//
//     1. A test suite reached out and touched the live deployment. What the
//        suite did depended on which principal ran it and on whether a
//        deployment act had been performed.
//     2. IT ASSERTED ALMOST NOTHING. Both branches — read, or refused — passed,
//        and the final assertion was `outcome.length > 0`, true of every string.
//        On every box where the book is unreadable, half the test had never run
//        at all. A green tick over a check that cannot fail is this project's
//        own thesis eating the project, which is the same sentence
//        `suite-membership.test.ts` was written under.
//
//   So this file is the fence, and it sits beside the membership guard on
//   purpose: that one holds "every test on disk is named", this one holds
//   "no test names the box". Two mechanical properties of the suite itself.
//
// ── WHAT IT FORBIDS, AND THE THREE THINGS IT DELIBERATELY DOES NOT ──────────
//
//   Forbidden: a deployment-path prefix appearing in a `*.test.ts` file's CODE.
//   Comments are exempt — a comment explaining why a path is not named is the
//   opposite of the defect.
//
//   NOT forbidden, and each of these is a real check that would be WEAKER if it
//   were: a test that asserts a module does NOT name a deployment path; a test
//   that asserts a shipped unit file's arguments ARE the deployed paths; a test
//   that builds a fixture around the state root. All three name the CONCEPT by
//   importing `DEPLOYMENT_PATH_PREFIXES` from `../src/deploy/deployment-paths`,
//   rather than the BOX by typing the literal. That module is not a `*.test.ts`
//   and is not policed here, which is the whole mechanism: one definition, and
//   the fence catches every copy of it.
//
// ── THE EXEMPTION, NAMED RATHER THAN HIDDEN `[owed]` ────────────────────────
//
//   Two files under `src/registrar/` still type the literals — in a fabricated
//   error message and in an argument to a pure string-formatting function.
//   NEITHER TOUCHES THE FILESYSTEM. They are exempt here because the S116 brief
//   that built this fence also fenced `src/registrar/` byte-untouched, and a
//   seat that edited them to make its own fence pass would be routing around a
//   fence with a fence. The list is asserted to be EXACTLY these two, so it
//   cannot grow quietly, and clearing it is owed to whichever beat next has
//   that directory open.

import assert from "assert";
import { readFileSync } from "fs";
import { relative, resolve, sep } from "path";

import { DEPLOYMENT_PATH_PREFIXES } from "../src/deploy/deployment-paths";
import { discoverAllTests, DISCOVERY_ROOTS } from "./suite-protocol";

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

/**
 * Files that still type a literal, with no filesystem call anywhere near it,
 * held out ONLY because this build was fenced out of their directory. Every
 * entry is a debt, not a category.
 */
const EXEMPT: readonly string[] = [
  "src/registrar/registrar.test.ts",
  "src/registrar/refusal-log.test.ts",
];

/**
 * Code with COMMENT LINES removed — deliberately line-based, not the usual
 * regex strip this repo's other fences use.
 *
 * ⚠ WHY NOT THE REGEX. A trailing-comment strip — replace everything from a
 * `//` to end of line — truncates at the FIRST such pair on the line,
 * INCLUDING one inside a string literal. A path written
 * as `"…//witness/store.jsonl"` would have its tail deleted and the fence would
 * report the file clean. That is a false NEGATIVE, which for a fence is the
 * only kind of error that matters — this one was found by SF-B, the positive
 * control, on the very first run of this file. So: a line is a comment when it
 * BEGINS as one, and a block comment runs until its close. Code with a trailing
 * comment keeps both halves, which can only over-report.
 */
export function codeOnly(source: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of source.split("\n")) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes("*/")) inBlock = false;
      continue;
    }
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) inBlock = true;
      continue;
    }
    if (t.startsWith("//") || t.startsWith("*")) continue;
    out.push(line);
  }
  return out.join("\n");
}

/** Every prefix this line of code names, if any. */
export function deploymentPathsNamedIn(code: string): readonly string[] {
  return DEPLOYMENT_PATH_PREFIXES.filter((prefix) => code.includes(prefix));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── suite source fence · no test names the box ─────────────────");

check("SF-A · the fence can see something — discovery found test files at all", () => {
  const files = discoverAllTests(REPO_ROOT);
  assert.ok(files.length > 50, `discovery found only ${String(files.length)} test files`);
  assert.ok(DISCOVERY_ROOTS.length > 0, "no discovery roots");
});

check("SF-B · POSITIVE CONTROL — the checker actually catches a planted path", () => {
  // A fence that has never been shown to fail is a fence nobody has tested.
  for (const prefix of DEPLOYMENT_PATH_PREFIXES) {
    const tail = prefix.endsWith("/") ? "witness/store.jsonl" : "/witness/store.jsonl";
    const planted = `const p = "${prefix}${tail}";`;
    assert.deepStrictEqual(deploymentPathsNamedIn(codeOnly(planted)), [prefix]);
  }
  // THE REGRESSION SF-B CAUGHT ON ITS FIRST RUN: a path whose text contains a
  // `//` must still be seen. A trailing-comment regex strip loses it.
  const doubled = `const p = "${DEPLOYMENT_PATH_PREFIXES[0]}//witness/store.jsonl";`;
  assert.deepStrictEqual(deploymentPathsNamedIn(codeOnly(doubled)), [DEPLOYMENT_PATH_PREFIXES[0]]);
});

check("SF-C · CONTROL — the same path inside a COMMENT is not a finding", () => {
  const prefix = DEPLOYMENT_PATH_PREFIXES[0];
  assert.deepStrictEqual(deploymentPathsNamedIn(codeOnly(`// it never reads ${prefix}/x`)), []);
  assert.deepStrictEqual(deploymentPathsNamedIn(codeOnly(`/* ${prefix}/x */`)), []);
  assert.deepStrictEqual(
    deploymentPathsNamedIn(codeOnly(` * a banner line naming ${prefix}/x`)),
    []
  );
});

check("SF-D · NO *.test.ts NAMES A DEPLOYMENT PATH IN CODE", () => {
  const offenders: string[] = [];
  for (const file of discoverAllTests(REPO_ROOT)) {
    const name = rel(file);
    if (EXEMPT.includes(name)) continue;
    const named = deploymentPathsNamedIn(codeOnly(readFileSync(file, "utf8")));
    if (named.length > 0) offenders.push(`${name} → ${named.join(", ")}`);
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `these test files name the live box in code:\n    ${offenders.join("\n    ")}\n` +
      `  Import DEPLOYMENT_PATH_PREFIXES from src/deploy/deployment-paths instead, or\n` +
      `  use a path under the test's own mkdtemp root.`
  );
});

check("SF-E · the exemption list is EXACTLY the two it was declared with, and cannot grow quietly", () => {
  assert.deepStrictEqual([...EXEMPT].sort(), [
    "src/registrar/refusal-log.test.ts",
    "src/registrar/registrar.test.ts",
  ]);
});

check("SF-F · every exempt file is still on disk, and still actually needs its exemption", () => {
  // An exemption that outlives its reason is a hole. If one of these stops
  // naming a path, this fails and the entry comes out of the list.
  for (const name of EXEMPT) {
    const source = readFileSync(resolve(REPO_ROOT, name), "utf8");
    assert.ok(
      deploymentPathsNamedIn(codeOnly(source)).length > 0,
      `${name} no longer names a deployment path — remove it from EXEMPT`
    );
  }
});

check("SF-G · and NEITHER exempt file hands one of those paths to the filesystem", () => {
  // The exemption is for LITERALS, never for touching the box. If one of these
  // ever opens what it names, the exemption stops being harmless.
  const fsCalls = /\b(readFileSync|writeFileSync|appendFileSync|statSync|existsSync|openSync|mkdirSync|readdirSync|rmSync|unlinkSync|chmodSync|renameSync)\s*\(\s*["'`][^"'`]*(?:VAR_LIB|OPT|ETC)/;
  for (const name of EXEMPT) {
    const code = codeOnly(readFileSync(resolve(REPO_ROOT, name), "utf8"));
    for (const prefix of DEPLOYMENT_PATH_PREFIXES) {
      const direct = new RegExp(
        `\\b(readFileSync|writeFileSync|appendFileSync|statSync|existsSync|openSync|mkdirSync|readdirSync|rmSync|unlinkSync|chmodSync|renameSync)\\s*\\(\\s*["'\`]${prefix.replace(/[/]/g, "\\/")}`
      );
      assert.ok(!direct.test(code), `${name} opens ${prefix} — the exemption does not cover that`);
    }
    assert.ok(!fsCalls.test(code), `${name} appears to open a deployment path`);
  }
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
