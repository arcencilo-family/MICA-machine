// ── MICA · the sweep's own guard — the derivation must not be quietly short ──
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node tools/opens-sweep/opens-sweep.test.ts
//
// THE DEFECT THIS EXISTS TO END (measured on T16, 2026-10-02). `opens` was
// derived from `git status --porcelain` plus the suites whose COUNT moved. Once
// a branch is committed `git status` is empty — and an empty `git status` means
// EITHER "nothing was edited" OR "it is already committed". The tool picked the
// first and said nothing, so T16's thirteen edited core files derived as FOUR.
// A short `opens` is not a small inaccuracy: it is a door REFUSAL on every file
// it omitted, discovered at install time, after the signature.
//
// WHAT IT DOES NOT BUY: it does not run a sweep. These checks drive --compare
// over fixture rows and read the tool's own source for the contracts a fixture
// cannot reach. Running 104 suites to test the comparator would make this guard
// the slowest file in the chain for no extra evidence.

import assert from "assert";
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { EXCLUDED_MARKER } from "../flaky-register";
// ⚠ The tool is driven through its CLI everywhere else in this file, on purpose.
//   These two are the exception and the reason is in OS-M: the WRITE path has no
//   CLI surface short of a 107-suite run, so it is imported and tested directly.
import { countsLineIn, doorDriftIn, provenanceNow, tsvBody } from "./opens-sweep";

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

const REPO = resolve(__dirname, "..", "..");
const TOOL = join("tools", "opens-sweep", "opens-sweep.ts");
const HEADER =
  '#population\troots=["src","tools"]\tsuffix=.test.ts\tskip=["node_modules","dist"]\tn=3';

function tsv(dir: string, name: string, rows: ReadonlyArray<readonly [string, number, string]>): string {
  const p = join(dir, name);
  writeFileSync(p, [HEADER, ...rows.map((r) => r.join("\t"))].join("\n") + "\n", "utf8");
  return p;
}

/**
 * The same, plus a PROVENANCE line. Separate from `tsv` on purpose: the arms every
 * other check in this file builds have NO provenance, which is the state of every
 * arm captured before that header existed — so those checks go on exercising the
 * backward-compatible path while these exercise the gate.
 */
function tsvWithProvenance(
  dir: string,
  name: string,
  prov: { commit?: string; tree?: string; dirty?: string; tool?: string },
  rows: ReadonlyArray<readonly [string, number, string]>
): string {
  const line =
    "#provenance" +
    `\tcommit=${prov.commit ?? "a".repeat(40)}` +
    `\ttree=${prov.tree ?? "worktree"}` +
    `\tdirty=${prov.dirty ?? "no"}` +
    `\ttool=${prov.tool ?? "aaaaaaaaaaaa"}`;
  const p = join(dir, name);
  writeFileSync(p, [HEADER, line, ...rows.map((r) => r.join("\t"))].join("\n") + "\n", "utf8");
  return p;
}

/**
 * An arm WITH the cause column — four fields per row.
 *
 * ⛔ WHY IT IS A SEPARATE BUILDER. Every other check in this file writes THREE
 *    fields, which is the shape of every arm taken before 2026-10-04 — so those
 *    checks go on exercising the backward-compatible fallback while these exercise
 *    the derivation. Two builders, two worlds, both measured.
 */
function tsv4(
  dir: string,
  name: string,
  prov: { commit?: string; tree?: string; dirty?: string; tool?: string },
  rows: ReadonlyArray<readonly [string, number, string, string]>
): string {
  const line =
    "#provenance" +
    `\tcommit=${prov.commit ?? "a".repeat(40)}` +
    `\ttree=${prov.tree ?? "worktree"}` +
    `\tdirty=${prov.dirty ?? "no"}` +
    `\ttool=${prov.tool ?? "aaaaaaaaaaaa"}`;
  const p = join(dir, name);
  writeFileSync(p, [HEADER, line, ...rows.map((r) => r.join("\t"))].join("\n") + "\n", "utf8");
  return p;
}

/** Drive the real CLI; a comparator tested through its own entry point. */
function compare(args: readonly string[]): string {
  try {
    return execFileSync("npx", ["ts-node", "-T", TOOL, "--compare", ...args], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
}

console.log("\n── opens-sweep · the derivation against its own silences ─────────");

const ROOM = mkdtempSync(join(tmpdir(), "opens-sweep-guard-"));

check("OS-A · a count that moved is reported MOVED, and one that held is not", () => {
  const a = tsv(ROOM, "a.tsv", [
    ["src/mica/x.test.ts", 0, "4 tests: 4 passed, 0 failed"],
    ["src/mica/y.test.ts", 0, "9 tests: 9 passed, 0 failed"],
    ["tools/z.test.ts", 0, "2 tests: 2 passed, 0 failed"],
  ]);
  const b = tsv(ROOM, "b.tsv", [
    ["src/mica/x.test.ts", 0, "6 tests: 6 passed, 0 failed"],
    ["src/mica/y.test.ts", 0, "9 tests: 9 passed, 0 failed"],
    ["tools/z.test.ts", 0, "2 tests: 2 passed, 0 failed"],
  ]);
  const out = compare([a, b]);
  assert.ok(out.includes("MOVED  src/mica/x.test.ts"), out);
  assert.ok(!out.includes("MOVED  src/mica/y.test.ts"), out);
  assert.ok(out.includes("2 of 3 comparable identical"), out);
});

check("OS-B · ⛔ AN EMPTY `git status` WITH NO --base IS CALLED OUT, NOT ASSUMED CLEAN", () => {
  // The T16 defect, as a check: with no --base and a clean tree, the tool must
  // say the list may be short rather than print a confident short list.
  const a = tsv(ROOM, "c.tsv", [["src/mica/x.test.ts", 0, "1 tests: 1 passed, 0 failed"]]);
  const b = tsv(ROOM, "d.tsv", [["src/mica/x.test.ts", 0, "1 tests: 1 passed, 0 failed"]]);
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .map((l) => l.slice(3).trim())
    .filter((p) => p.startsWith("src/mica/"));
  const out = compare([a, b]);
  if (dirty.length === 0) {
    assert.ok(
      out.includes("NO UNCOMMITTED CHANGE UNDER src/mica/** AND NO --base GIVEN"),
      "a clean tree with no --base must say the derivation may be short:\n" + out
    );
    assert.ok(out.includes("--base <rev>"), "and must say how to fix it:\n" + out);
  } else {
    // The tree has real core edits, so the silent case cannot be exercised now.
    // Stated rather than skipped quietly: a skipped check that prints ✓ is the
    // shape this whole directory exists to refuse.
    assert.ok(out.includes("DERIVED opens"), out);
    console.log(`      (tree has ${dirty.length} uncommitted core file(s) — silent case not exercisable this run)`);
  }
});

check("OS-C · --base widens the derivation to a COMMITTED branch", () => {
  const src = readFileSync(resolve(REPO, TOOL), "utf8");
  assert.ok(src.includes("gitCommittedUnderCore"), "the committed half must be read, not inferred");
  assert.ok(src.includes('"diff", "--name-only"'), "and read from git diff against the base rev");
  assert.ok(src.includes("[...new Set([...uncommitted, ...committed])]"), "the two halves must UNION, not replace");
  assert.ok(
    src.includes("(edited, committed since ") && src.includes("(edited, uncommitted)"),
    "each derived path must say WHICH evidence put it there"
  );
});

check("OS-D · an excluded suite is never folded into `identical`", () => {
  const a = tsv(ROOM, "e.tsv", [
    ["src/mica/x.test.ts", 0, "1 tests: 1 passed, 0 failed"],
    ["src/probe/flaky.test.ts", -1, EXCLUDED_MARKER],
  ]);
  const b = tsv(ROOM, "f.tsv", [
    ["src/mica/x.test.ts", 0, "1 tests: 1 passed, 0 failed"],
    ["src/probe/flaky.test.ts", -1, EXCLUDED_MARKER],
  ]);
  const out = compare([a, b]);
  assert.ok(out.includes("NOT COMPARABLE  src/probe/flaky.test.ts"), out);
  assert.ok(out.includes("1 of 1 comparable identical"), "the excluded row must leave the comparable count:\n" + out);
  // the headline carries one term PER CAUSE now, so this pins the two separately
  // rather than pinning the sentence they happened to form when there was one cause.
  assert.ok(out.includes("1 register-excluded"), out);
  assert.ok(out.includes("0 printed no count line"), `a zero is a reading too:\n${out}`);
  assert.ok(out.includes("(of 2 in the population)"), out);
  assert.ok(
    out.includes("NOT covered by this derivation"),
    "and the pasted derivation must admit what it does not cover:\n" + out
  );
});

check("OS-F · a suite that prints NO COUNT LINE is not comparable, and the headline says so", () => {
  // ⛔ `--run` has warned about these since it was written; `--compare` folded them
  //    into "identical", because NO-COUNT-LINE equals NO-COUNT-LINE. Four of them
  //    sit in the declared population, so "105 of 107 identical" was really "105 of
  //    103 comparable, plus 4 nobody can compare". A warning no comparison consumes
  //    is what this directory exists to refuse.
  const a = tsv(ROOM, "nc-a.tsv", [
    ["src/mica/x.test.ts", 0, "1 tests: 1 passed, 0 failed"],
    ["src/quiet/q.test.ts", 0, "NO-COUNT-LINE"],
  ]);
  const b = tsv(ROOM, "nc-b.tsv", [
    ["src/mica/x.test.ts", 0, "1 tests: 1 passed, 0 failed"],
    ["src/quiet/q.test.ts", 0, "NO-COUNT-LINE"],
  ]);
  const out = compare([a, b]);
  assert.ok(out.includes("printed NO COUNT LINE"), out);
  assert.ok(out.includes("a suite that says nothing cannot be said to agree"), out);
  assert.ok(out.includes("1 of 1 comparable identical"), `the countless row must leave the comparable count:\n${out}`);
  assert.ok(out.includes("1 printed no count line (of 2 in the population)"), out);
  // and it must NOT be described as register-excluded — a caption naming the wrong cause
  assert.ok(!/1 register-excluded/.test(out), `countless is not register-excluded:\n${out}`);
});

check("OS-G · ⛔ a --base that resolves to HEAD is REFUSED, because HEAD..HEAD is silently empty", () => {
  // Measured on T19, 2026-10-03: --base <tip> derived ONE file, --base <the tip the
  // work started from> derived TWO, and the grant was two. The edited half of the
  // derivation is `git diff <base>..HEAD`, which is empty when base IS HEAD — so the
  // list comes back short with nothing to say it was.
  const a = tsv(ROOM, "hb-a.tsv", [["src/mica/x.test.ts", 0, "1 tests: 1 passed, 0 failed"]]);
  const b = tsv(ROOM, "hb-b.tsv", [["src/mica/x.test.ts", 0, "2 tests: 2 passed, 0 failed"]]);
  const out = compare([a, b, "--base", "HEAD"]);
  assert.ok(out.includes("resolves to HEAD"), out);
  assert.ok(out.includes("the tip the WORK") || out.includes("STARTED FROM"), out);
  assert.ok(!out.includes("DERIVED opens"), `it must refuse BEFORE printing a short list:\n${out}`);
});


const ROW: readonly [string, number, string] = ["src/mica/x.test.ts", 0, "1 tests: 1 passed, 0 failed"];

check("OS-H · ⛔ TWO ARMS FROM DIFFERENT KINDS OF TREE ARE REFUSED", () => {
  // ⛔ MEASURED 2026-10-03 AND IT WAS A NEAR MISS. T22's arms were both `git
  //    archive` trees and read FIVE count-less suites where every worktree arm that
  //    day read four. The fifth is src/registrar/refusal-log.test.ts, which asserts
  //    a git sha — an archive has no `.git`, so it fails there and reads 37/37 in a
  //    worktree AT THE SAME COMMIT. T21's derivation was about to mix one of each,
  //    and that suite would have shown as a MOVER for no reason but the directory.
  const a = tsvWithProvenance(ROOM, "h-a.tsv", { tree: "worktree" }, [ROW]);
  const b = tsvWithProvenance(ROOM, "h-b.tsv", { tree: "archive" }, [ROW]);
  const out = compare([a, b]);
  assert.ok(out.includes("DIFFERENT KINDS OF TREE"), out);
  assert.ok(out.includes("refusal-log"), "the refusal must name the suite that proved it");
  assert.ok(!out.includes("comparable identical"), `it must refuse BEFORE comparing:\n${out}`);
});

check("OS-I · ⛔ TWO ARMS FROM DIFFERENT TOOL VERSIONS ARE REFUSED", () => {
  // 56 worktrees exist under ~/mica-wt and any of them can run a sweep. An arm from
  // a stale copy is a measurement by a different instrument, and nothing in the file
  // said so until the tool began hashing itself.
  const a = tsvWithProvenance(ROOM, "i-a.tsv", { tool: "aaaaaaaaaaaa" }, [ROW]);
  const b = tsvWithProvenance(ROOM, "i-b.tsv", { tool: "bbbbbbbbbbbb" }, [ROW]);
  const out = compare([a, b]);
  assert.ok(out.includes("DIFFERENT VERSIONS OF THIS TOOL"), out);
  assert.ok(!out.includes("comparable identical"), out);
});

check("OS-J · a KNOWN, MATCHING provenance is accepted and says nothing", () => {
  // ⛔ THE OTHER HALF. A gate that refused every recorded pair would satisfy OS-H
  //    and OS-I and make the header useless.
  const a = tsvWithProvenance(ROOM, "j-a.tsv", {}, [ROW]);
  const b = tsvWithProvenance(ROOM, "j-b.tsv", {}, [ROW]);
  const out = compare([a, b]);
  assert.ok(!out.includes("REFUSED"), out);
  assert.ok(out.includes("1 of 1 comparable identical"), out);
});

check("OS-K · an UNRECORDED provenance is WARNED about, never refused", () => {
  // Every arm captured before this header existed lacks it. Refusing them would
  // make yesterday's measurements unable to settle a question they can still
  // settle — the population header's own precedent takes the same line.
  const a = tsv(ROOM, "k-a.tsv", [ROW]);
  const b = tsv(ROOM, "k-b.tsv", [ROW]);
  const out = compare([a, b]);
  assert.ok(out.includes("#provenance UNRECORDED"), out);
  assert.ok(!out.includes("REFUSED"), `an unrecorded arm must still compare:\n${out}`);
  assert.ok(out.includes("1 of 1 comparable identical"), out);
});

check("OS-L · a DIRTY base arm is called out, because it does not describe its own commit", () => {
  const a = tsvWithProvenance(ROOM, "l-a.tsv", { dirty: "yes" }, [ROW]);
  const b = tsvWithProvenance(ROOM, "l-b.tsv", { dirty: "no" }, [ROW]);
  const out = compare([a, b]);
  assert.ok(out.includes("taken in a DIRTY tree"), out);
  assert.ok(out.includes("1 of 1 comparable identical"), "a warning, not a refusal");
});


check("OS-M · ⛔ `--run` ACTUALLY WRITES THE PROVENANCE, and it is the SECOND line", () => {
  // ⛔ THIS TEST EXISTS BECAUSE ITS ABSENCE WAS MEASURED. A mutation that stopped
  //    doRun writing the provenance line left this suite 12/12 GREEN — every other
  //    check builds its arms by hand, so all of them pinned the READER and none the
  //    WRITER. Found by the mutation differential, not by reading, and it is the
  //    third time in one day a check has failed to cover what it was written for.
  const body = tsvBody("#population\tn=1", provenanceNow(), [
    { path: "src/mica/x.test.ts", exit: 0, counts: "1 tests: 1 passed, 0 failed" },
  ]);
  const lines = body.trimEnd().split("\n");
  assert.ok(lines[0].startsWith("#population"), lines[0]);
  assert.ok(lines[1].startsWith("#provenance"), `the provenance must be line 2, got: ${lines[1]}`);
  assert.strictEqual(lines.length, 3, `one header, one provenance, one row; got ${String(lines.length)}`);
  // ⚠ and no comment line may appear BELOW a row: `load` counts the `#` lines to
  //   know how many to skip, so a stray one among the rows eats a measurement.
  assert.ok(!lines.slice(2).some((l) => l.startsWith("#")), body);
});

check("OS-N · provenanceNow reports this tree HONESTLY — a worktree, a real sha, a self-hash", () => {
  // ⚠ The point is not that the values are well-formed; it is that each one is the
  //   fact it claims to be. `tree=worktree` is checkable here: this suite runs in one.
  const f = new Map(
    provenanceNow().split("\t").slice(1).map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i), kv.slice(i + 1)] as const;
    })
  );
  assert.strictEqual(f.get("tree"), "worktree", "this suite runs in a git worktree, not an archive");
  assert.match(f.get("commit") ?? "", /^[0-9a-f]{40}$/, `commit: ${String(f.get("commit"))}`);
  assert.match(f.get("tool") ?? "", /^[0-9a-f]{12}$/, `tool: ${String(f.get("tool"))}`);
  assert.ok(["yes", "no"].includes(f.get("dirty") ?? ""), `dirty: ${String(f.get("dirty"))}`);
  console.log(`      (this tree: ${(f.get("commit") ?? "").slice(0, 7)} · ${String(f.get("tree"))} · dirty=${String(f.get("dirty"))} · tool ${String(f.get("tool"))})`);
});

check("OS-E · an UNRECORDED population is not a matching one", () => {
  const p = join(ROOM, "g.tsv");
  writeFileSync(p, "src/mica/x.test.ts\t0\t1 tests: 1 passed, 0 failed\n", "utf8");
  const b = tsv(ROOM, "h.tsv", [["src/mica/x.test.ts", 0, "1 tests: 1 passed, 0 failed"]]);
  const out = compare([p, b]);
  assert.ok(out.includes("DID NOT RECORD ITS POPULATION"), out);
  assert.ok(out.includes("DO NOT PASTE THIS AS A DERIVATION"), out);
});

check("OS-S · the tally is read in EVERY dialect the house speaks, and silence is told from unparsed", () => {
  // ⛔ MEASURED 2026-10-04: three suites were filed NO-COUNT-LINE for a week while
  //    printing a perfectly good tally, because the old pattern read two dialects
  //    and the house speaks at least four. 189 passing tests sat outside every
  //    derivation — not because they were silent but because they were
  //    multilingual, and the caption said they "said nothing".
  const cases: ReadonlyArray<readonly [string, string]> = [
    // the two the old pattern already read
    ["  ✓ a\n\n39 tests: 39 passed, 0 failed", "39 tests: 39 passed, 0 failed"],
    ["ok\n9 passed.", "9 passed."],
    // src/clerk/clerk.test.ts — a bare tally, no `tests:` prefix
    ["  ✓ x\n\n78 passed, 0 failed", "78 passed, 0 failed"],
    // src/probe/review-cli.test.ts — the suite names itself first
    ["...\nreview-cli: 87 passed, 0 failed", "review-cli: 87 passed, 0 failed"],
    // tools/dry-well-gauge/gauge.test.ts — a third number between the two
    ["24 tests: 24 passed, 0 incomplete, 0 failed", "24 tests: 24 passed, 0 incomplete, 0 failed"],
  ];
  for (const [out, want] of cases) {
    assert.strictEqual(countsLineIn(out), want, JSON.stringify(out));
  }
  // ⛔ THE LAST tally wins, so a suite that prints a per-section tally and then a
  //    total is recorded by its total.
  assert.strictEqual(countsLineIn("3 passed, 0 failed\n\n12 tests: 12 passed, 0 failed"), "12 tests: 12 passed, 0 failed");
  // ⚠ AND THE TWO SILENCES ARE DIFFERENT FACTS. Collapsing them into one marker
  //   is how three readable suites hid behind one broken one for a week.
  assert.strictEqual(countsLineIn(""), "NO-OUTPUT");
  assert.strictEqual(countsLineIn("   \n\n  "), "NO-OUTPUT");
  assert.strictEqual(countsLineIn("AssertionError: expected ALARM\n  at main (...)"), "NO-TALLY-IN-OUTPUT");
  // a line that merely mentions a number is not a tally
  assert.strictEqual(countsLineIn("read 42 records from the store"), "NO-TALLY-IN-OUTPUT");
});

check("OS-O · the door-objection class is DERIVED from what the suite said, not from its path", () => {
  // ⛔ THE EXACT MISLABEL, AS A TEST. On 2026-10-04 `core-door.test.ts` moved
  //    31 -> 36 because five arms were ADDED to it, and the comparison captioned it
  //    "the door objecting to no-live-ticket". Here it moves and records NO door
  //    refusal, so it must NOT be captioned that way — while `glue.test.ts`, which
  //    recorded one, must be.
  const base = tsv4(ROOM, "o-base.tsv", {}, [
    ["src/core-door/core-door.test.ts", 0, "31 tests: 31 passed, 0 failed", "-"],
    ["src/glue/glue.test.ts", 0, "136 tests: 136 passed, 0 failed", "-"],
    ["src/mica/eng.test.ts", 0, "9 tests: 9 passed, 0 failed", "-"],
  ]);
  const cand = tsv4(ROOM, "o-cand.tsv", {}, [
    ["src/core-door/core-door.test.ts", 0, "36 tests: 36 passed, 0 failed", "-"],
    ["src/glue/glue.test.ts", 1, "136 tests: 135 passed, 1 failed", "DOOR-DRIFT:src/mica/eng.ts"],
    ["src/mica/eng.test.ts", 0, "9 tests: 9 passed, 0 failed", "-"],
  ]);
  const out = compare([base, cand]);
  assert.ok(out.includes("the door objecting to no-live-ticket"), out);
  // the one that OBJECTED is in the class, and its recorded cause is printed
  assert.ok(/src\/glue\/glue\.test\.ts\s+\(DOOR-DRIFT:src\/mica\/eng\.ts\)/.test(out), out);
  // ⛔ AND THE ONE THAT MERELY GREW IS NOT IN THE CLASS — this is the whole fix,
  //    and it is asserted on MEMBERSHIP, not on the caption's wording.
  //
  // ⚠ THE FIRST VERSION OF THIS ASSERTION TESTED THE WRONG THING AND A MUTATION
  //   SHOWED IT. It matched `core-door.test.ts   (DOOR-…` and so passed happily
  //   when the classifier was mutated back to the NAME list — under that mutation
  //   the path IS in the class, printed with the cause `(-)`, and the regex missed
  //   it. The caption is not the class; the list of paths under the heading is.
  const lines = out.split("\n");
  const head = lines.findIndex((l) => l.includes("the door objecting to no-live-ticket"));
  assert.ok(head >= 0, out);
  const members: string[] = [];
  for (const l of lines.slice(head + 1)) {
    const m = /^ {4}(\S+)/.exec(l);
    if (m === null) break;
    members.push(m[1]);
  }
  assert.deepStrictEqual(
    members,
    ["src/glue/glue.test.ts"],
    `the door-objection class must hold EXACTLY the suite that objected: ${out}`
  );
  assert.ok(out.includes("MOVED WITHOUT OBJECTING"), `and the difference from the named set must be said: ${out}`);
  assert.ok(out.includes("src/core-door/core-door.test.ts"), out);
});

check("OS-P · a consumer of the pin the named set never knew about is reported, not refused", () => {
  const base = tsv4(ROOM, "p-base.tsv", {}, [
    ["src/probe/review-cli.test.ts", 0, "4 tests: 4 passed, 0 failed", "-"],
    ["src/mica/eng.test.ts", 0, "9 tests: 9 passed, 0 failed", "-"],
  ]);
  const cand = tsv4(ROOM, "p-cand.tsv", {}, [
    ["src/probe/review-cli.test.ts", 1, "4 tests: 3 passed, 1 failed", "DOOR-DRIFT:src/mica/eng.ts"],
    ["src/mica/eng.test.ts", 0, "9 tests: 9 passed, 0 failed", "-"],
  ]);
  const out = compare([base, cand]);
  assert.ok(out.includes("a consumer of the pin that the named set did not know about"), out);
  assert.ok(out.includes("src/probe/review-cli.test.ts"), out);
  // and it is NOT reported as moving outside src/mica on its own commit, which is
  // what the name-based classifier did with any third consumer
  const outside = out.slice(out.indexOf("MOVED OUTSIDE") >= 0 ? out.indexOf("MOVED OUTSIDE") : 0);
  assert.ok(
    out.indexOf("MOVED OUTSIDE") < 0 || !outside.includes("review-cli"),
    `a door objector is not an outside mover: ${out}`
  );
});

check("OS-Q · an arm with NO cause column cannot answer, and the fallback says so out loud", () => {
  // ⚠ UNRECORDED IS NOT "NO". Every arm taken before 2026-10-04 has three fields,
  //   and reading the absent column as "the door said nothing" would turn an old
  //   arm into a witness it never was.
  const base = tsv(ROOM, "q-base.tsv", [
    ["src/core-door/core-door.test.ts", 0, "31 tests: 31 passed, 0 failed"],
    ["src/mica/eng.test.ts", 0, "9 tests: 9 passed, 0 failed"],
  ]);
  const cand = tsv(ROOM, "q-cand.tsv", [
    ["src/core-door/core-door.test.ts", 1, "31 tests: 30 passed, 1 failed"],
    ["src/mica/eng.test.ts", 0, "9 tests: 9 passed, 0 failed"],
  ]);
  const out = compare([base, cand]);
  assert.ok(out.includes("RECORDS NO CAUSE COLUMN"), out);
  assert.ok(out.includes("falls back to a NAMED set"), out);
  assert.ok(out.includes("(by NAME — cause unrecorded)"), `the caption must admit how it was reached: ${out}`);
  // and the old behaviour is preserved for an old arm, rather than silently changed
  assert.ok(out.includes("the door objecting to no-live-ticket"), out);
});

check("OS-R · doorDriftIn reads the door's own words: the files it NAMED, sorted and deduped", () => {
  const refusal = [
    "CORE DOOR REFUSED — 2 reason(s); src/mica/ is not what the pinned inventory and its tickets allow",
    "  REFUSED: DRIFT src/mica/zeta.ts content: pinned aaaa, on disk bbbb — no ticket covers it: there are no tickets",
    "  REFUSED: DRIFT src/mica/alpha.ts content: pinned cccc, on disk dddd — no ticket covers it: there are no tickets",
    "  REFUSED: DRIFT src/mica/alpha.ts content: pinned cccc, on disk dddd — no ticket covers it: there are no tickets",
  ].join("\n");
  assert.strictEqual(doorDriftIn(refusal), "DOOR-DRIFT:src/mica/alpha.ts,src/mica/zeta.ts");
  // a refusal that names no file is still the door speaking — a different fact
  // from silence, and recorded as one
  assert.strictEqual(doorDriftIn("CORE DOOR REFUSED — 1 reason(s); something else"), "DOOR-REFUSED");
  // ⛔ AND IT MUST NOT FIRE ON A SUITE THAT MERELY TALKS ABOUT THE DOOR. This file's
  //    own prose, and core-door.test.ts's output, are full of the word.
  assert.strictEqual(doorDriftIn("  ✓ CD-16 · malformed tickets fail closed\n36 tests: 36 passed, 0 failed"), "-");
  assert.strictEqual(doorDriftIn("the core door REFUSED nothing today"), "-");
});


console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
