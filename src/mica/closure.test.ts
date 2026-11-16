// ── MICA · the import-closure guard ───────────────────────────────────────────
//
// WHY THIS FILE EXISTS
//
// `src/clerk/` has carried an import-closure test since it was built: it asserts
// that the standalone reader's static import closure contains no `../` and no
// third-party package. `src/mica/` had no equivalent. That absence is exactly
// how MICA came to hold three undeclared threads back into the ILAS tree it was
// living inside — two of them runtime value imports, one of them the entire ILAS
// kill stack — without anything failing.
//
// THIS IS A GUARD, NOT A FEATURE. It measures no log and emits no verdict.
//
// ── WHAT CHANGED, AND WHY THE SHAPE OF THE GUARD CHANGED WITH IT ──────────────
//
// This guard used to be an ALLOWLIST. It PINNED fourteen edges out of src/mica/
// by tier, because MICA genuinely reached into the ILAS tree and a guard
// asserting zero would have failed on day one, been relaxed within the week, and
// then caught nothing.
//
// Under the ruling of 2026-08-12 that reason is gone. MICA declares its own
// readable-log shape (src/mica/log.ts), builds its own fixture log
// (src/mica/fixture-log.ts), and takes ILAS as a dependency of NO kind — not
// runtime, not dev, not type-only, not for tests. So the expectation is now the
// one the clerk's guard could always make:
//
//     ZERO EDGES OUT OF src/mica/. ZERO EDGES OUT OF THIS REPOSITORY.
//
// ── HOW THE ANTI-ROT PROPERTY SURVIVED THE CHANGE ─────────────────────────────
//
// The old list was written to fail in BOTH directions: a new reach failed, and
// so did a removed one, so the list could not rot into a wish about what should
// be true. With an empty list the second direction is VACUOUS — there is nothing
// left to remove — and pretending otherwise would be exactly the sort of dead
// guard this file exists to prevent. Stated plainly rather than papered over.
//
// The property is transposed instead. Three things now hold the line:
//
//   · a NEW edge out of src/mica/ fails, as before;
//   · KNOWN_FOREIGN_EDGES is asserted to be EMPTY, so the list cannot be quietly
//     re-populated to make a new coupling pass — widening it takes deleting an
//     assertion, which is a visible act;
//   · the file walk is pinned to a named set of files, so a coupling cannot be
//     hidden by moving a file out of the guard's reach.

import assert from "assert";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join, relative, resolve, sep } from "path";

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

// ══════════════════════════════════════════════════════════════════════════════
// The scanner. Deliberately identical in structure to the clerk's, including its
// line-structure awareness — a bare /from\s*"…"/ over whole source also matches
// the word "from" inside prose, which is a real bug the clerk's version already
// hit and documented.

function importSpecifiers(src: string): string[] {
  const out: string[] = [];
  for (const line of src.split("\n")) {
    const structural = /^\s*(?:import\b|export\b|\}\s*from\b)/.test(line);
    const requiring = line.includes("require(");
    if (!structural && !requiring) continue;
    const re = /(?:from\s*|require\()\s*["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) out.push(m[1]);
  }
  return out;
}

const NODE_BUILTINS: readonly string[] = [
  "assert",
  "child_process",
  "crypto",
  "fs",
  // S119: the pilot runner speaks HTTP to a loopback subject. `http` is a node
  // built-in and always was — this list is hand-maintained and simply had no
  // occasion to name it before. Adding it does not widen what this guard
  // CLAIMS ("node built-ins and itself only"); it closes a gap between the
  // claim and the list. The alternative — a hand-rolled client over `net` — is
  // strictly worse code written to avoid editing a list.
  "http",
  // S128: `mica-proxy` speaks HTTP to the runner on loopback and HTTPS to the
  // vendor, so it names both. Same reasoning as the line above, one rung on:
  // `https` is a node built-in, the list is hand-maintained, and nothing here
  // had occasion to name it before. The guard's CLAIM is unchanged — "node
  // built-ins and itself only" — and this closes a gap between the claim and
  // the list rather than widening either. The alternative, a hand-rolled TLS
  // client over `net` written to avoid editing a list, is not a real option.
  "https",
  "net",
  "os",
  "path",
];

const SRC_ROOT = join(__dirname, "..");
const REPO_ROOT = join(SRC_ROOT, "..");

/**
 * FILES EXCLUDED FROM THE WALK, and the reason matters.
 *
 * A closure guard's own self-test feeds it strings like `require("../l0")` to
 * prove it catches a real foreign import. Walking such a file would read those
 * fixtures as genuine couplings and report a repository that reaches places it
 * does not. A guard that reports its own test data as a violation gets its
 * assertion relaxed, and then it stops catching the real thing.
 *
 * There are exactly two such files and both are closure guards: this one, and
 * the clerk's. Both are listed, so the exclusion cannot silently grow.
 *
 * The guards measure the instruments. They are not instruments.
 */
const GUARD_FILES: readonly string[] = ["mica/closure.test.ts", "clerk/clerk.test.ts"];

/** Every .ts file under a directory, recursively. */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out.sort();
}

/** Every .ts file under src/mica/, except this guard. */
function micaFiles(): string[] {
  return tsFiles(__dirname).filter(
    (f) => relative(SRC_ROOT, f).replace(/\\/g, "/") !== "mica/closure.test.ts"
  );
}

/**
 * Does `spec`, written inside `fromFile`, resolve to something OUTSIDE `root`?
 *
 * Resolved, not pattern-matched, and this rule is the whole correctness of the
 * guard. `../types` written from `src/mica/eng/index.ts` lands on
 * `src/mica/types.ts` and never leaves; the identical string written from
 * `src/mica/types.ts` lands on `src/types.ts` and does. A guard keyed on the
 * `../` prefix cannot tell those apart, calls both foreign, and is wrong about
 * the first.
 */
function leaves(root: string, fromFile: string, spec: string): boolean {
  const target = resolve(dirname(fromFile), spec);
  return !(target + sep).startsWith(root + sep);
}

/**
 * `file → specifier`, for every specifier that actually LEAVES `root`.
 *
 * Deduplicated: two import statements naming the same module are one coupling,
 * and the question this list answers is what MICA depends on, not how many times.
 */
function foreignEdges(root: string, files: readonly string[]): string[] {
  const out = new Set<string>();
  for (const file of files) {
    const rel = relative(root, file).replace(/\\/g, "/");
    for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
      if (spec.startsWith("./") || spec.startsWith("../")) {
        if (leaves(root, file, spec)) out.add(`${rel} → ${spec}`);
      } else if (!NODE_BUILTINS.includes(spec)) {
        out.add(`${rel} → ${spec} (not a node built-in)`);
      }
    }
  }
  return [...out].sort();
}

// ══════════════════════════════════════════════════════════════════════════════
// THE PINNED LIST.
//
// Recorded 2026-08-12, at the ruling that MICA declares its own readable-log
// shape and takes ILAS as a dependency of no kind.
//
// IT IS EMPTY, AND THAT IS THE POINT. There is nothing left to tier: the two
// tiers this list used to carry — type-only instrument reaches, and runtime
// value imports in the tests — were both answered by src/mica/log.ts and
// src/mica/fixture-log.ts. Nothing in src/mica/ reaches out of src/mica/.

const KNOWN_FOREIGN_EDGES: readonly string[] = [];

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── MICA import-closure guard ─────────────────────────────────");

// The scanner is only worth having if it catches a real violation, so prove it
// does before trusting it to say there are none. Lifted from the clerk's guard
// for exactly the reason the clerk states.
check("the import scanner catches a real foreign import and ignores prose", () => {
  assert.deepStrictEqual(
    importSpecifiers('import type { LogEntry } from "../types";'),
    ["../types"]
  );
  assert.deepStrictEqual(importSpecifiers('import express from "express";'), [
    "express",
  ]);
  assert.deepStrictEqual(importSpecifiers('const x = require("../l0");'), [
    "../l0",
  ]);
  assert.deepStrictEqual(
    importSpecifiers('  detail: "the value this record came from " + b,'),
    []
  );
});

check("the file walk actually reaches src/mica/ and its subdirectories", () => {
  const files = micaFiles().map((f) => relative(__dirname, f).replace(/\\/g, "/"));
  assert.ok(files.length >= 10, `walk suspiciously small: ${files.join(", ")}`);
  for (const expected of [
    "types.ts",
    "log.ts",
    "fixture-log.ts",
    "competence.ts",
    "sig/index.ts",
    "eng/index.ts",
    "export/index.ts",
    "export/ledger.ts",
  ]) {
    assert.ok(files.includes(expected), `walk missed ${expected}`);
  }
});

// The resolution rule is not obvious, and it no longer has a live foreign edge
// to demonstrate itself on — which is the good outcome, not an excuse to stop
// asserting it. So it is asserted directly, on the resolver, over paths that
// need not exist: the SAME specifier string is internal from one file and
// foreign from another.
check("`../types` resolves as internal from eng/index.ts and foreign from types.ts", () => {
  assert.strictEqual(
    leaves(__dirname, join(__dirname, "eng", "index.ts"), "../types"),
    false,
    "eng/index.ts → ../types lands on src/mica/types.ts and does NOT leave MICA"
  );
  assert.strictEqual(
    leaves(__dirname, join(__dirname, "types.ts"), "../types"),
    true,
    "types.ts → ../types lands on src/types.ts and DOES leave MICA"
  );
  assert.strictEqual(
    leaves(__dirname, join(__dirname, "eng", "index.ts"), "../../types"),
    true,
    "eng/index.ts → ../../types lands on src/types.ts and DOES leave MICA"
  );
});

check("src/mica/ reaches outside itself along NO edge at all", () => {
  const actual = foreignEdges(__dirname, micaFiles());
  const pinned = [...KNOWN_FOREIGN_EDGES].sort();
  const added = actual.filter((e) => !pinned.includes(e));
  const gone = pinned.filter((e) => !actual.includes(e));
  assert.deepStrictEqual(
    added,
    [],
    `NEW coupling out of src/mica/: ${added.join(", ")} — ` +
      `a reach out of MICA is an architecture decision. Get it ruled, then pin it.`
  );
  assert.deepStrictEqual(
    gone,
    [],
    `pinned edges no longer present: ${gone.join(", ")} — ` +
      `if a coupling was removed, remove it from KNOWN_FOREIGN_EDGES too, so the ` +
      `list stays a record of what IS rather than a wish about what should be.`
  );
});

// The anti-rot property, transposed. With an empty list the "a removed edge
// fails" direction is vacuous, so the thing that must not rot is the EMPTINESS.
// Re-populating the list to make a new coupling pass now requires deleting this
// assertion, which is a deliberate, visible act rather than an edit to a data
// structure that already looked like a list of exceptions.
check("the pinned list is EMPTY and cannot be quietly re-populated", () => {
  assert.deepStrictEqual(
    [...KNOWN_FOREIGN_EDGES],
    [],
    "KNOWN_FOREIGN_EDGES has entries again. Under the 2026-08-12 ruling MICA " +
      "takes no dependency outside itself. An entry here is a reversal of that " +
      "ruling and needs one, not a commit."
  );
});

check("MICA imports no third-party package — node built-ins and itself only", () => {
  const packages = foreignEdges(__dirname, micaFiles()).filter((e) =>
    e.includes("not a node built-in")
  );
  assert.deepStrictEqual(
    packages,
    [],
    `MICA took a third-party dependency: ${packages.join(", ")}`
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// THE SOLO PROPERTY — the whole repository, not just src/mica/.
//
// The ruling is that MICA-machine builds, typechecks and runs on a machine where
// ILAS DOES NOT EXIST. Not "does not run" — does not exist. A guard scoped to
// src/mica/ cannot see a reach taken from src/clerk/ or from a file at src/, so
// the same scanner is run over everything.

console.log("\n── the solo property · the whole repository ───────────────────");

function repoFiles(): string[] {
  return tsFiles(SRC_ROOT).filter((f) => {
    const rel = relative(SRC_ROOT, f).replace(/\\/g, "/");
    return !GUARD_FILES.includes(rel);
  });
}

check("the guard-file exclusion is exactly the two closure guards, both present", () => {
  assert.deepStrictEqual([...GUARD_FILES].sort(), [
    "clerk/clerk.test.ts",
    "mica/closure.test.ts",
  ]);
  for (const g of GUARD_FILES) {
    assert.ok(existsSync(join(SRC_ROOT, g)), `excluded file ${g} does not exist`);
  }
});

check(
  "every QUOTED import/require specifier under src/ resolves inside src/ — " +
    "dynamic specifiers are NOT scanned by this check",
  () => {
    const escapes = foreignEdges(SRC_ROOT, repoFiles());
    assert.deepStrictEqual(
      escapes,
      [],
      `these quoted specifiers leave src/: ${escapes.join(", ")}. Every path a ` +
        `file under src/ names in a QUOTED specifier must resolve inside src/, ` +
        `which is what lets \`tsc\` compile and every shipped instrument run on a ` +
        `machine where no sibling project exists. THIS GUARD WALKS src/ AND NOTHING ` +
        `ELSE: tools/ is inside the repository and is not scanned, and a specifier ` +
        `from src/ into tools/ would be flagged here even though it never leaves ` +
        `the repo. THE TEST SUITE IS A DIFFERENT AND ` +
        `WEAKER CLAIM: it does NOT run without a sibling — ` +
        `\`src/integration/l0-clerk-f3.test.ts:96\` reaches ILAS through a DYNAMIC ` +
        `require, which this scanner cannot see. That edge is declared in ` +
        `DYNAMIC_SPECIFIERS below and is checked there, not here.`
    );
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// THE FLAG HALF OF R4 — what the scanner above CANNOT see, enumerated.
//
// R4 (The arbiter, S87): MAXIMUM TRUE STATEMENT, AND FLAG WHAT IS WRONG. A check
// prints exactly what its method establishes, and prints its own reach as part
// of the same statement.
//
// `importSpecifiers` needs a QUOTED STRING after `import` / `from` /
// `require(`. Everything else is invisible to it, and until S87 the check above
// carried a sentence — "NO file in this repository imports a path resolving
// outside it" — that was wider than that method. One real edge had been sitting
// under it: `src/integration/l0-clerk-f3.test.ts:96` reaches ILAS through
// `require(l0ModulePath)`, a variable. The COUPLING is fine — deliberate,
// documented at its site, and dynamic precisely so the compile closure stays
// free of ILAS. The SENTENCE was the defect.
//
// WHY THIS CHECK FAILS RATHER THAN PRINTS. A check that only printed would be
// counted as a pass by `run-suite.ts`, which sees exit codes and nothing else —
// the unrecorded pass, which this project has now closed twice at other
// granularities. Declaring the known set makes the blindness BOUNDED AND
// MAINTAINED instead of merely mentioned: a new dynamic site that nobody
// declared fails here, and a declared site that vanished fails here too.
//
// WHAT IT DELIBERATELY DOES NOT DO: it does not try to resolve where a dynamic
// specifier POINTS. That is beyond static scanning, and claiming it would
// repeat the original defect one layer up — a wider sentence than the method.
// It says these sites exist and are known. It says nothing about their targets.
//
// ── THE RESIDUAL, AND IT IS REAL ─────────────────────────────────────────────
//
// Even with this census, a module reached by a path this scanner never sees as
// a call site is outside reach: an `import()` or `require()` assembled by a
// helper function, a specifier built at runtime from configuration, a path read
// out of a file, `createRequire`, or an `eval`. This census walks LINES and
// recognises two call shapes. It cannot follow a value.
//
// So the honest bound is: THE SET OF SYNTACTIC CALL SITES IS BOUNDED HERE. What
// any of them loads at runtime is not, and neither is a reach that never looks
// like a call site on a line.

interface DynamicSpecifier {
  /** Repo-relative to src/, forward slashes — the same shape as GUARD_FILES. */
  readonly file: string;
  readonly line: number;
  readonly kind: "require" | "import";
  readonly reason: string;
}

/**
 * EVERY specifier in this repository that `importSpecifiers` cannot read.
 *
 * Line numbers are part of the declaration on purpose. They drift when the file
 * above them is edited, and the drift FAILS — which is the maintenance, not a
 * defect in it. A declaration that could not go stale loudly would be a comment.
 */
const DYNAMIC_SPECIFIERS: readonly DynamicSpecifier[] = [
  {
    file: "integration/l0-clerk-f3.test.ts",
    line: 96,
    kind: "require",
    reason:
      "ILAS's L0, loaded dynamically ON PURPOSE so MICA's compile/import " +
      "closure stays free of ILAS. Test-only: no shipped instrument loads it.",
  },
  {
    file: "clerk/types.ts",
    line: 290,
    kind: "import",
    reason:
      "a TYPE-POSITION import() of a sibling module in this same directory. " +
      "The specifier is quoted and internal, but the scanner skips the line " +
      "entirely — it is neither structural nor a require( — so it is unseen " +
      "either way and is declared here rather than assumed harmless.",
  },
  {
    file: "mica/scope-block-guard.test.ts",
    line: 166,
    kind: "require",
    reason:
      "the scope-block guard loads each instrument it DISCOVERED on disk, so " +
      "the specifier is a walked path and not a literal. Internal by " +
      "construction — it is `src/mica/**/index.ts` and nothing else — and " +
      "dynamic on purpose: a static import list would be the hand-maintained " +
      "enumeration that guard exists to avoid. Kept to ONE call site so this " +
      "census pays one line for it.",
  },
  {
    file: "evidence/external-chain.test.ts",
    line: 307,
    kind: "require",
    reason:
      "NOT A CALL SITE AT ALL — a REGEX LITERAL in the external-evidence " +
      "socket's own fence, which asserts that the socket module contains no " +
      "require( anywhere. The check that forbids dynamic loading is itself " +
      "unreadable to this scanner, which is the joke and also the reason it is " +
      "declared: the census bounds SYNTACTIC SITES, and a site that loads " +
      "nothing is still a site. It resolves to no module and never runs.",
  },
  {
    file: "glue/glue.test.ts",
    line: 6011,
    kind: "require",
    reason:
      "T27's t27Stub: it loads one seam reader's module by a variable path to " +
      "replace one export for the body's duration, then restores it. The path " +
      "is one of the T27_SEAMS literals beside it (all `../mica/*`, internal); " +
      "test-only, and kept to ONE call site so this census pays one line for it.",
  },
];

/** A line's code, with // comments and block-comment bodies removed. */
function codeOnly(line: string): string {
  if (/^\s*(?:\*|\/\*)/.test(line)) return "";
  const at = line.indexOf("//");
  return at < 0 ? line : line.slice(0, at);
}

/**
 * Call sites the quoted-specifier scanner cannot read.
 *
 * A `require(` whose `require` is preceded by a quote is a STRING CONTAINING
 * the word, not a call — this repository's own scanners are full of
 * `line.includes("require(")`, and a census that counted those would be the
 * prose-matching bug the header of this file already warns about.
 */
function unscannableSites(root: string, files: readonly string[]): DynamicSpecifier[] {
  const out: DynamicSpecifier[] = [];
  for (const file of files) {
    const rel = relative(root, file).replace(/\\/g, "/");
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((raw, index) => {
      const line = codeOnly(raw);
      // A require( that is a CALL: not preceded by a quote, a dot, or a word
      // character. Dynamic when what follows the paren is not a quote.
      for (const m of line.matchAll(/(^|[^\w.$"'`])require\s*\(\s*(.?)/g)) {
        if (m[2] !== '"' && m[2] !== "'" && m[2] !== "`") {
          out.push({ file: rel, line: index + 1, kind: "require", reason: "" });
        }
      }
      // EVERY import( call site, quoted or not: the scanner's line filter skips
      // these whether or not the specifier is a literal, so all of them are
      // unseen and all of them belong in the census.
      for (const _m of line.matchAll(/(^|[^\w.$"'`])import\s*\(/g)) {
        out.push({ file: rel, line: index + 1, kind: "import", reason: "" });
      }
    });
  }
  return out;
}

function siteKey(s: { file: string; line: number; kind: string }): string {
  return `${s.file}:${s.line} (${s.kind})`;
}

check("the scanner's blind spots are DECLARED, and the declaration matches disk", () => {
  // The guard files are excluded here for the same reason they are excluded
  // above: their fixture strings are not this repository's couplings.
  const found = unscannableSites(SRC_ROOT, repoFiles()).map(siteKey).sort();
  const declared = DYNAMIC_SPECIFIERS.map(siteKey).sort();

  const undeclared = found.filter((s) => !declared.includes(s));
  const vanished = declared.filter((s) => !found.includes(s));

  assert.deepStrictEqual(
    undeclared,
    [],
    `a specifier this repository's static scanner CANNOT SEE is not declared: ` +
      `${undeclared.join(", ")}. It may be perfectly fine — this check does not ` +
      `resolve where it points and makes no claim about it. What is not fine is ` +
      `its being invisible: add it to DYNAMIC_SPECIFIERS with a reason, so the ` +
      `blindness stays bounded instead of growing quietly.`
  );
  assert.deepStrictEqual(
    vanished,
    [],
    `DYNAMIC_SPECIFIERS declares a site that is no longer there: ` +
      `${vanished.join(", ")}. If the code moved, update the line; if the ` +
      `coupling is gone, delete the entry. A declaration nobody maintains ` +
      `describes a repository that no longer exists.`
  );

  // Every declaration carries its reason, so the list cannot decay into a set
  // of coordinates nobody can account for.
  for (const site of DYNAMIC_SPECIFIERS) {
    assert.ok(
      site.reason.trim().length > 20,
      `${siteKey(site)} is declared without a reason worth reading`
    );
  }
});

check("the blind-spot census can actually SEE a dynamic site — proved, not assumed", () => {
  // The same discipline the import scanner above is held to: a census that has
  // only ever been run on a tree it agrees with is indistinguishable from one
  // that returns nothing. Fed known bytes, it must find what is there and
  // ignore what only looks like it.
  const dir = mkdtempSync(join(tmpdir(), "mica-blindspot-"));
  const file = join(dir, "fixture.ts");
  writeFileSync(
    file,
    [
      'const a = require("./static");',              // 1 · seen by the scanner
      "const b = require(computed);",                 // 2 · DYNAMIC
      'const c = line.includes("require(");',         // 3 · a STRING, not a call
      "// or call require(whatever)",                 // 4 · a comment
      " * a block comment mentioning require(x)",     // 5 · a block comment
      'type T = import("./sibling").Thing;',          // 6 · import() call site
      "const d = await import(name);",                // 7 · import() call site
    ].join("\n"),
    "utf8"
  );
  const found = unscannableSites(dir, [file]).map((s) => `${s.line} ${s.kind}`);
  rmSync(dir, { recursive: true, force: true });
  assert.deepStrictEqual(found, ["2 require", "6 import", "7 import"]);
});

// The three vendored files were an explicitly-labelled stopgap pending this
// ruling. The ruling ended them. If any comes back, the shape MICA declares has
// been abandoned in favour of a copy of somebody else's, and that is a reversal.
check("the vendored ILAS files are gone and have not come back", () => {
  for (const gone of [
    "types.ts",
    "l0",
    "l0/index.ts",
    "index.ts",
    "VENDORED-FROM-ILAS.md",
  ]) {
    assert.ok(
      !existsSync(join(SRC_ROOT, gone)),
      `src/${gone} exists again. MICA declares its own log shape in ` +
        `src/mica/log.ts; a vendored copy of ILAS's is a reversal of the ruling.`
    );
  }
});

check("package.json names no ILAS dependency in ANY section", () => {
  const pkg = JSON.parse(
    readFileSync(join(REPO_ROOT, "package.json"), "utf8")
  ) as Record<string, unknown>;
  const sections = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
    "bundledDependencies",
  ];
  for (const s of sections) {
    const block = pkg[s];
    if (block === undefined) continue;
    for (const [name, spec] of Object.entries(block as Record<string, string>)) {
      assert.ok(
        !/ilas/i.test(name) && !/ilas/i.test(String(spec)),
        `${s} names ILAS: ${name}@${String(spec)}`
      );
      assert.ok(
        !/^(file:|link:|\.\.?[\\/])/.test(String(spec)),
        `${s}.${name} is a local path dependency (${String(spec)}) — ` +
          `MICA-machine must resolve nothing outside itself`
      );
    }
  }
});

check("no source file names ILAS's kill stack as an import", () => {
  const offenders: string[] = [];
  for (const file of repoFiles()) {
    const src = readFileSync(file, "utf8");
    for (const line of src.split("\n")) {
      if (/^\s*import\b/.test(line) && /ILASKillStack/.test(line)) {
        offenders.push(relative(SRC_ROOT, file).replace(/\\/g, "/"));
      }
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `ILASKillStack is imported by: ${offenders.join(", ")}`
  );
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
