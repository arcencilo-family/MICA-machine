// ── MICA · the suite protocol — what the runner and the files it runs agree on ─
//
// WHY THIS FILE EXISTS, and it is a small file with one job.
//
//   Two facts were about to be written down twice: the walk convention (which
//   directories a tree-walking tool does not descend into) and the exit code a
//   test file uses to say "I could not complete". `tools/run-suite.ts` owned
//   both implicitly; `tools/inventory/` and `tools/dry-well-gauge/` now need
//   them too.
//
//   A constant copied into three files is three constants that can drift, and
//   the drift is silent — the copies keep compiling and the tools quietly stop
//   agreeing about what the suite is. So it is declared ONCE, here, and the
//   three import it. This is the same reasoning the S86 witness builds applied
//   to a duplicated producer body, arriving at the opposite answer only because
//   there the closure ruling forbade the import and here nothing does.
//
// It holds no policy and runs nothing. It is a vocabulary.

import { existsSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

/**
 * Directories no tree walk in this repository descends into.
 *
 * `node_modules` is not ours and `dist` is generated from what is. Neither is
 * evidence of anything, and hashing or running either would drown the thing
 * being looked at.
 */
export const SKIP_DIRS: ReadonlySet<string> = new Set(["node_modules", "dist"]);

/**
 * THE INCOMPLETE EXIT CODE — the one machine-readable thing a test file can say
 * that neither "passed" nor "failed" covers.
 *
 * A file exits with this when it ran, did not fail, and COULD NOT COMPLETE: a
 * dependency it needs to check something was not stated, so a check it contains
 * was never actually performed. It is CANNOT_ASSESS, and the whole point is
 * that it must not read as a pass.
 *
 * WHY THIS AND NOT A MARKER LINE ON STDOUT: `run-suite.ts` runs children with
 * `stdio: "inherit"`, so it never sees their output — scanning for a marker
 * would mean capturing output and giving up live streaming for every file in
 * the suite. The exit code is already crossing that boundary and costs nothing.
 *
 * WHY 77: outside 0–2 (success, error, CLI misuse), outside 126–165 (shell and
 * signal encodings), and not otherwise used in this repository. There is no
 * meaning in the number itself; it only has to be unmistakable.
 */
export const INCOMPLETE_EXIT_CODE = 77;

/** What an incomplete census means, in the runner's own voice. */
export const INCOMPLETE_IS_NOT_A_PASS =
  "An INCOMPLETE file ran without failing and could not complete a check it " +
  "contains, because something it depends on was not stated. It is not a pass. " +
  "A census that could not be taken completely says so; it does not round down " +
  "to clean.";

// ── THE DISCOVERY CONVENTION — moved here S95, for the reason this file exists ─
//
//   `run-suite.ts` owned the roots, the suffix and the walker privately, and it
//   audited `test:mica`'s chain with a regex that only ever matched `src/`. So
//   the census walked TWO roots while the audit read ONE, and the two files
//   under `tools/` were reported as missing from the chain no matter what the
//   chain said — the audit could not have been satisfied. A membership guard
//   that re-implemented the walk would have been a THIRD copy of the same
//   convention, which is precisely what this file's header objects to. So it is
//   declared once, here, and the runner and the guard both import it.

/**
 * THE PACKAGE.JSON KEY THAT HOLDS THE HAND-MAINTAINED MANIFEST.
 *
 * It was `test:mica` until 2026-08-31, when `test:mica` became the RUNNER
 * (`tools/run-chain.ts`) and the `&&` chain moved here under its own name. The
 * rename is the whole medicine: the name people actually type had to stop being
 * the amputating one, and a runner cannot read the script that invokes it.
 *
 * Three readers agree on this key — `run-chain.ts`, `suite-membership.test.ts`
 * and `src/mica/registration.test.ts`. The last of those CANNOT import it: the
 * closure guard rules zero edges out of `src/mica/`, so it carries the literal.
 * That is a drift risk and it FAILS CLOSED — a key nobody writes to leaves both
 * guards reading an absent or empty chain, and both then fail loudly rather than
 * passing over nothing.
 */
export const CHAIN_SCRIPT = "test:mica:chain";

/**
 * Environment the SUITE depends on, declared so a runner can say so at the start
 * instead of leaving it to be discovered at file forty.
 *
 * This is a declaration, not a gate. Nothing here is enforced: an unset variable
 * is the depending file's own finding to report — `gauge.test.ts` exits
 * INCOMPLETE and says exactly what was not checked — and a runner that refused
 * to start would be converting a CANNOT_ASSESS into a failure.
 */
export interface SuiteEnvDependency {
  readonly name: string;
  readonly why: string;
  readonly neededBy: string;
}

export const SUITE_ENV: readonly SuiteEnvDependency[] = [
  {
    name: "MICA_LEDGER_PATH",
    why: "the absolute path of ARC_MICA-NOTE_Corrections-Ledger_20260805.md, so the real ledger can be parsed",
    neededBy: "tools/dry-well-gauge/gauge.test.ts",
  },
];

/** The roots a suite walk descends from. Half of the discovery convention. */
export const DISCOVERY_ROOTS: readonly string[] = ["src", "tools"];

/** What makes a file a test. The other half. A file named otherwise is invisible. */
export const TEST_SUFFIX = ".test.ts";

/** Append every test file under `dir` to `out`, depth-first, name-sorted. */
export function discoverTests(dir: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name)) discoverTests(path, out);
    } else if (stat.isFile() && name.endsWith(TEST_SUFFIX)) {
      out.push(path);
    }
  }
}

/** Every test file in the repository, absolute, in walk order. */
export function discoverAllTests(repoRoot: string): string[] {
  const found: string[] = [];
  for (const root of DISCOVERY_ROOTS) {
    const abs = join(repoRoot, root);
    if (existsSync(abs)) discoverTests(abs, found);
  }
  return found;
}

/**
 * The test files a `&&` chain names, absolute.
 *
 * THE PATTERN IS BUILT FROM `DISCOVERY_ROOTS`, not written out. A root that the
 * census walks and the audit cannot see is the defect this replaces; deriving
 * the pattern makes that particular drift unavailable rather than unlikely.
 */
export function chainTestFiles(chain: string, repoRoot: string): string[] {
  const roots = DISCOVERY_ROOTS.join("|");
  const suffix = TEST_SUFFIX.replace(/\./g, "\\.");
  const re = new RegExp(`\\b(?:${roots})/[^\\s&]+${suffix}\\b`, "g");
  return Array.from(chain.matchAll(re)).map((m) => resolve(repoRoot, m[0]));
}
