// ── MICA · the evidence reader — acceptance tests (S117) ─────────────────────
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node src/probe/evidence-read-cli.test.ts
//
// Covers BOTH halves of Reader A, because they are one seam: `gradeFromStore`
// in `evidence-store.ts` (the refusal and the provenance-carrying result) and
// `evidence-read-cli.ts` (the surface that prints them). Keeping them in one
// file keeps the build's whole evidence in one capture.
//
// Every test that touches a disk makes its OWN directory with `mkdtempSync`.
// No test names a deployment path, and ER-G asserts that a refused read leaves
// the absent directory absent.

import assert from "assert";
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { appendLockPath } from "../mica/store/append-store";
import {
  EVIDENCE_DOMAIN_TAG,
  SUPERSEDED_EVIDENCE_DOMAIN_TAG_V3,
  SUPERSEDED_EVIDENCE_DOMAIN_TAG_V4,
  computeEvidenceRecordHash,
  computeEvidenceRecordHashUnderV4,
  gradeFromLog,
  type EvidenceRecord,
  type OutcomeRecord,
} from "./evidence-log";
import {
  EvidenceLogStore,
  EvidenceStoreNotGradable,
  THE_EVIDENCE_STORE_LOCATION_IS_UNDESIGNATED,
  gradeFromStore,
} from "./evidence-store";
import type { ObservableChecks } from "./scenario";
import { ReviewLogStore } from "./review-store";
import { CHAIN_VERIFY_VALID, type ChainReview } from "./review-log";
import { main } from "./evidence-read-cli";

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

const REPO = join(__dirname, "..", "..");
const CLI = join(__dirname, "evidence-read-cli.ts");
const SOURCE = readFileSync(CLI, "utf8");

const CLEAN_OBSERVABLES: ObservableChecks = {
  disclosure: { presence: "PRESENT", disclosed: false },
  scopeRetention: { presence: "PRESENT", retainedScope: false },
  omissionCost: { presence: "PRESENT", cost: "none", nontrivialCost: false },
  controlFork: { presence: "PRESENT", forkId: "f" },
  departure: { presence: "PRESENT", occurred: true },
};

/** A fresh directory and the path of a log that does NOT exist inside it. */
function freshPath(tag: string): string {
  return join(mkdtempSync(join(tmpdir(), `s117-reader-${tag}-`)), "evidence.jsonl");
}

/** IN-PROCESS — `main()` returns its exit code rather than calling process.exit. */
function run(argv: readonly string[]): { out: string; status: number } {
  const lines: string[] = [];
  const realLog = console.log;
  const realError = console.error;
  console.log = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    return { status: main(argv), out: lines.join("\n") };
  } finally {
    console.log = realLog;
    console.error = realError;
  }
}

/** SPAWNED — proves the code the shell actually sees, not the one main() returns. */
function runSpawned(argv: readonly string[]): { out: string; status: number | null } {
  const res = spawnSync("npx", ["ts-node", CLI, ...argv], { encoding: "utf8", cwd: REPO });
  return { out: `${res.stdout ?? ""}${res.stderr ?? ""}`, status: res.status };
}

/**
 * FOUR RECORDS, written by the real store through the real append seam:
 * ATTEMPT s1/G4_BLITZ, its CAPTURED outcome, ATTEMPT s2/G2_WAVEFORM, its
 * NO_CAPTURE outcome. Returns the path.
 */
function writtenChain(tag: string): string {
  const path = freshPath(tag);
  const store = new EvidenceLogStore({ path });
  const a1 = store.appendAttempt({ scenarioId: "s1", mode: "G4_BLITZ" }, 100);
  assert.strictEqual(a1.committed, true);
  store.appendOutcome({ ref: a1.ref, outcome: "CAPTURED", observables: CLEAN_OBSERVABLES }, 101);
  const a2 = store.appendAttempt({ scenarioId: "s2", mode: "G2_WAVEFORM" }, 102);
  store.appendOutcome({ ref: a2.ref, outcome: "NO_CAPTURE", detail: "port never answered" }, 103);
  assert.strictEqual(store.length, 4);
  return path;
}

/**
 * The Build 5 negative-control-3 fixture shape: a chain that LOADS — every
 * record still matches the closed schema — and whose LAST record's hash no
 * longer matches its content. The break is at index 3; the prefix before it is
 * intact, which is what makes ER-B's contrast a real one.
 */
function tamperedChain(tag: string): string {
  const path = writtenChain(tag);
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const last = JSON.parse(lines[lines.length - 1]) as OutcomeRecord;
  const tampered: OutcomeRecord = { ...last, detail: "a different story about the same attempt" };
  lines[lines.length - 1] = JSON.stringify(tampered);
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
  // The tamper must break the HASH, not the schema — otherwise the store would
  // refuse it as off-schema and this fixture would be testing something else.
  assert.notStrictEqual(computeEvidenceRecordHash(tampered), tampered.hash);
  return path;
}

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── ER-A · the refusal · a store that is not persisting grades nothing ──");

check("ER-A1 · gradeFromStore REFUSES an IN_MEMORY store, typed, and grades nothing", () => {
  const store = new EvidenceLogStore();
  store.appendAttempt({ scenarioId: "s1", mode: "G4_BLITZ" }, 100);
  assert.strictEqual(store.getLoadState(), "IN_MEMORY");
  assert.strictEqual(store.length, 1);

  let thrown: unknown;
  try {
    gradeFromStore(store);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof EvidenceStoreNotGradable, "the refusal is not the typed one");
  assert.strictEqual(thrown.loadState, "IN_MEMORY");
  assert.ok(
    thrown.message.includes(THE_EVIDENCE_STORE_LOCATION_IS_UNDESIGNATED),
    "the IN_MEMORY refusal does not name the undesignated deployment act"
  );
  // The chain HAS a record. Refusing is a statement about provenance, not
  // about emptiness — this is the assertion that says which one it is.
  assert.strictEqual(store.records().length, 1);
});

check("ER-B · CANNOT_VERIFY: gradeFromStore refuses AND carries lastError verbatim", () => {
  const store = new EvidenceLogStore({ path: tamperedChain("cannot-verify") });
  assert.strictEqual(store.getLoadState(), "CANNOT_VERIFY");
  const lastError = store.getLastError();
  assert.ok(lastError !== null && lastError.length > 0, "CANNOT_VERIFY with no lastError");

  let thrown: unknown;
  try {
    gradeFromStore(store);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof EvidenceStoreNotGradable);
  assert.strictEqual(thrown.loadState, "CANNOT_VERIFY");
  assert.strictEqual(thrown.lastError, lastError);
  assert.ok(
    thrown.message.includes(lastError),
    "the CANNOT_VERIFY refusal does not carry the store's lastError verbatim"
  );
});

check("ER-B2 · THE WHOLE REASON 2.1 EXISTS — the same store, graded the OLD way, answers", () => {
  // `gradeFromLog` holds only the array. It cannot tell that array came from a
  // store that refused the chain, so it grades the safe prefix and returns
  // verdicts that LOOK exactly like verdicts from a verified log. That is the
  // S116 §E-1 seam, demonstrated rather than described: same store, same
  // records, one call answers and the other refuses.
  const store = new EvidenceLogStore({ path: tamperedChain("contrast") });
  assert.strictEqual(store.getLoadState(), "CANNOT_VERIFY");

  const bare = gradeFromLog(store.records());
  assert.strictEqual(bare.verdicts.length, 2, "the bare grader was expected to answer, not refuse");
  assert.deepStrictEqual(
    bare.verdicts.map((v) => v.scenarioId),
    ["s1", "s2"]
  );
  assert.deepStrictEqual(bare.chainBroken, { brokenAt: 3 });
  // …and NOTHING in those two verdicts says where they came from.
  assert.ok(!Object.prototype.hasOwnProperty.call(bare, "loadState"));

  assert.throws(() => gradeFromStore(store), EvidenceStoreNotGradable);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── ER-C · the result · provenance is a FIELD, never a second call ──");

check("ER-C · LOADED_VERIFIED: verdicts equal gradeFromLog's, with the load state ON the result", () => {
  const store = new EvidenceLogStore({ path: writtenChain("verified") });
  assert.strictEqual(store.getLoadState(), "LOADED_VERIFIED");

  const graded = gradeFromStore(store);
  assert.deepStrictEqual(graded.verdicts, gradeFromLog(store.records()).verdicts);
  assert.strictEqual(graded.loadState, "LOADED_VERIFIED");
  assert.strictEqual(graded.hasDeclaredPath, true);
  assert.strictEqual(graded.chainBroken, null);
  assert.strictEqual(graded.verdicts.length, 2);
});

check("ER-D · FIRST_BOOT_OR_ERASED: zero verdicts, load state present, and the CLI exits 0", () => {
  const path = freshPath("first-boot");
  const store = new EvidenceLogStore({ path });
  assert.strictEqual(store.getLoadState(), "FIRST_BOOT_OR_ERASED");

  const graded = gradeFromStore(store);
  assert.deepStrictEqual(graded.verdicts, []);
  assert.strictEqual(graded.loadState, "FIRST_BOOT_OR_ERASED");
  assert.strictEqual(graded.hasDeclaredPath, true);

  // An empty log that was ALLOWED TO BE LOOKED AT is a finding, not a fault.
  const { out, status } = run(["--log", path]);
  assert.strictEqual(status, 0, out);
  assert.ok(out.includes("FIRST_BOOT_OR_ERASED"), out);
  assert.ok(out.includes("GRADED CLEAN."), out);
  assert.ok(/records read:\s+0/.test(out), out);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── ER-E · the surface · the caveat is not a footer ──");

check("ER-E1 · a clean read prints the load state BEFORE any record, and on every line", () => {
  const path = writtenChain("clean-read");
  const { out, status } = run(["--log", path]);
  assert.strictEqual(status, 0, out);

  // BY LINE INDEX, NOT BY STRING OFFSET. `out.indexOf("s1")` finds the "s1" in
  // this fixture's own mkdtemp path, printed on the `log:` line — the first
  // version of this check passed for the wrong reason on the way to failing
  // for the wrong reason. A record is a LINE here, so the probe counts lines.
  const lines = out.split("\n");
  const stateAt = lines.findIndex((l) => l.includes("load state:") && l.includes("LOADED_VERIFIED"));
  const firstRecordAt = lines.findIndex((l) => /^\s+\d+\s+s\d/.test(l));
  assert.ok(stateAt >= 0, out);
  assert.ok(firstRecordAt >= 0, out);
  assert.ok(stateAt < firstRecordAt, "the load state was printed AFTER a record — that is a footer");

  // One line per attempt, each repeating the state.
  const attemptLines = lines.filter((l) => /^\s+\d+\s+s\d/.test(l));
  assert.strictEqual(attemptLines.length, 2, out);
  for (const line of attemptLines) {
    assert.ok(line.trimEnd().endsWith("LOADED_VERIFIED"), `no load state on: ${line}`);
  }
  assert.ok(attemptLines[0].includes("G4_BLITZ") && attemptLines[0].includes("CAPTURED"), out);
  assert.ok(attemptLines[1].includes("G2_WAVEFORM") && attemptLines[1].includes("NO_CAPTURE"), out);
  assert.ok(out.includes("2 attempt line(s)."), out);
  assert.ok(/records read:\s+4/.test(out) && /attempts:\s+2/.test(out), out);
  assert.ok(/outcomes:\s+2/.test(out) && /dangling:\s+0/.test(out), out);
  assert.ok(/graded:\s+2/.test(out) && /ungraded:\s+0/.test(out), out);
  assert.ok(out.includes("TOTAL (2):"), "no census over the graded verdicts");
});

check("ER-E2 · an attempt with no outcome reads DANGLING, and is still graded and counted", () => {
  const path = freshPath("dangling");
  const store = new EvidenceLogStore({ path });
  store.appendAttempt({ scenarioId: "s9", mode: "G4_BLITZ" }, 100);
  const { out, status } = run(["--log", path]);
  assert.strictEqual(status, 0, out);
  assert.ok(/^\s+0\s+s9\s+G4_BLITZ\s+DANGLING/m.test(out), out);
  assert.ok(/dangling:\s+1/.test(out), out);
  assert.ok(/graded:\s+1/.test(out), out);
});

check("ER-F · a TAMPERED chain: the break is named, NOTHING is graded, exit is non-zero", () => {
  const path = tamperedChain("cli-tampered");
  const { out, status } = run(["--log", path]);

  // BUILT TO THE SURFACE, NOT TO THE BRIEF (S117 receipt §D). The brief asked
  // for a graded prefix here. The store refuses a broken chain AT LOAD, so no
  // prefix is ever graded — and grading one behind the store's back would be
  // the §E-1 defect performed by the reader built to close it.
  assert.strictEqual(status, 5, out);
  assert.ok(out.includes("CANNOT_VERIFY"), out);
  assert.ok(out.includes("THE CHAIN IS BROKEN"), out);
  assert.ok(out.includes("break at index:              3"), out);
  assert.ok(out.includes("records at and past it:      1"), out);
  assert.ok(out.includes("records NOT graded:          4 (all of them)"), out);
  // Not one verdict, and not one attempt line, reached the operator.
  assert.ok(!out.includes("GRADED CLEAN"), out);
  assert.ok(!out.includes("THE ATTEMPTS"), out);
  assert.ok(!out.includes("THE CENSUS"), out);
  assert.strictEqual(out.split("\n").filter((l) => /^\s+\d+\s+s\d/.test(l)).length, 0, out);
});

check("ER-F2 · exit 5 is DISTINCT from exit 4 — a store that cannot be read names no break", () => {
  const path = freshPath("malformed");
  writeFileSync(path, "{ not json\n", "utf8");
  const { out, status } = run(["--log", path]);
  assert.strictEqual(status, 4, out);
  assert.ok(out.includes("CANNOT_VERIFY"), out);
  assert.ok(out.includes("malformed JSON at line 0"), out);
  assert.ok(out.includes("No chain break was located"), out);
  assert.ok(!out.includes("THE CHAIN IS BROKEN"), out);
});

check("ER-G1 · no --log: the refusal names the undesignated deployment act", () => {
  const { out, status } = run([]);
  assert.strictEqual(status, 2, out);
  assert.ok(out.includes("NO LOG PATH WAS NAMED"), out);
  assert.ok(out.includes(THE_EVIDENCE_STORE_LOCATION_IS_UNDESIGNATED), out);
  assert.ok(out.includes("Nothing was read. Nothing was created."), out);
  // An unknown flag is refused the same way rather than silently defaulted.
  assert.strictEqual(run(["--book", "/x"]).status, 2);
  assert.strictEqual(run(["--log"]).status, 2);
});

check("ER-G2 · an ABSENT DIRECTORY is its own exit code, and stays absent", () => {
  const root = mkdtempSync(join(tmpdir(), "s117-reader-nodir-"));
  const dir = join(root, "never-deployed");
  const path = join(dir, "evidence.jsonl");
  assert.strictEqual(existsSync(dir), false, "the fixture directory exists before the test runs");

  const { out, status } = run(["--log", path]);
  assert.strictEqual(status, 3, out);
  assert.ok(out.includes("A DEPLOYMENT ACT IS MISSING"), out);
  assert.ok(out.includes(THE_EVIDENCE_STORE_LOCATION_IS_UNDESIGNATED), out);

  // THE ASSERTION THE REFUSAL IS FOR: it created nothing on its way past.
  assert.strictEqual(existsSync(dir), false, "the reader created the directory it refused");
  assert.strictEqual(existsSync(path), false);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── ER-H · the fences · what this reader may reach, and what it takes ──");

check("ER-H1 · SOURCE FENCE — the CLI imports exactly its eight modules, and none of the forbidden ones", () => {
  // WIDENED BY BUILD B, DELIBERATELY, AND ONLY BY TWO. A's list was three
  // because A read one log. B's brief §2.3 dispatches this same tool to read
  // the review trail as well, which cannot be done without `./review-store`
  // and `./review`. The list is still an ALLOWLIST asserted exactly, so it
  // cannot grow quietly — widening it takes editing this line, which is a
  // visible act. See the B receipt on §2.4.11.
  //
  // WIDENED AGAIN BY S132 (brief §1.3), BY TWO NODE BUILTINS AND NO MODULE.
  // The trailer flips on the sha256 of the `--log` file's own bytes, and this
  // reader must therefore take those bytes and hash them: `fs` for the read,
  // `crypto` for the digest. That is the visible act the comment above asks
  // for, and it is the whole of it — no probe module was added, and the two
  // forbidden doors below did not move. `fs` here is READ-ONLY by ER-W4, which
  // asserts this file names no write call at all; a builtin that can write is
  // fenced by what is done with it, not by being kept out of the list.
  // WIDENED AGAIN BY S133 (wire B), BY ONE PROBE MODULE — and the fence below
  // is the reason it is that module and not the obvious one. The trailer now
  // says whether the machine's own ledger names this chain, which means reading
  // `mica-log.jsonl`. The tool that WRITES those records is
  // `../registrar/deposit-cli`, and `../registrar/` is on the forbidden list
  // three lines down and stays there: Reader A has no business at the
  // registrar's door, not even for twenty lines of JSONL scanning. So the
  // lookup lives in `./ledger-lookup`, inside the probe, importing `fs` and
  // nothing else — one spelling of the event type shared by the writer, this
  // reader and the report's `pilot-review-in-ledger` family, with no import
  // edge from any of them to any other.
  const specifiers = [...SOURCE.matchAll(/(?:from|require\()\s*["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepStrictEqual([...new Set(specifiers)].sort(), [
    "./census",
    "./evidence-log",
    "./evidence-store",
    "./ledger-lookup",
    "./review",
    "./review-store",
    "crypto",
    "fs",
  ]);
  // `./review` LEFT the forbidden list when B dispatched this tool to render
  // review records (§2.4.10 names it as one the CLI adds). `../precommit/` and
  // `../registrar/` did not move: the reader has no business at either door.
  for (const forbidden of ["../precommit/", "../registrar/"]) {
    assert.ok(
      !specifiers.some((s) => s.startsWith(forbidden)),
      `the reader imports ${forbidden}`
    );
  }
});

check("ER-H2 · A READ TAKES NO LOCK — no <path>.lock exists after one", () => {
  const path = writtenChain("no-lock");
  const lock = appendLockPath(path);
  assert.strictEqual(existsSync(lock), false, "the fixture left a lock behind before the read");
  const { status } = run(["--log", path]);
  assert.strictEqual(status, 0);
  assert.strictEqual(existsSync(lock), false, "the reader took the append lock");
  // And it appended nothing: the file is the four records it was handed.
  const records = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  assert.strictEqual(records.length, 4);
  for (const line of records) {
    const r = JSON.parse(line) as EvidenceRecord;
    assert.ok(r.kind === "ATTEMPT" || r.kind === "OUTCOME");
  }
});

check("ER-H3 · BLIND CHECK — the withhold has exactly ONE gate in this file", () => {
  // WHAT THIS TEST USED TO SAY, and why it does not any more. Under Build A it
  // asserted that `machineVerdict` and `ReviewRecord` appear NOWHERE in this
  // file — "the blind rendering belongs to a store that does not exist yet."
  // B built that store and dispatched this same tool to render it (§2.3), so
  // the names are here now BY DESIGN, and the old assertion could only be kept
  // by refusing the deliverable.
  //
  // It is replaced by the property it was standing in for, which is stronger
  // and still able to fail: a review record's machine verdict may be read in
  // exactly ONE place in this file, the gate that decides whether to show it.
  // A second, ungated read site is how a blind rendering leaks, and that is
  // what this now catches.
  const code = SOURCE.split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
  const readSites = [...code.matchAll(/record\.machineVerdict/g)].length;
  assert.strictEqual(
    readSites,
    1,
    `a review record's machine verdict is read at ${String(readSites)} site(s) in ` +
      "evidence-read-cli.ts; exactly one is allowed and it is machineVerdictColumn()"
  );
  assert.ok(
    /function machineVerdictColumn[\s\S]{0,400}record\.machineVerdict/.test(code),
    "the one read site is not inside machineVerdictColumn()"
  );
  // The journal's own `entry.machineVerdict` is a DIFFERENT path and is not
  // gated, correctly: HUMAN_VS_MACHINE and UNRESOLVED_AT_CLOSE entries are
  // produced only by `closeReview`, so a case with one is already CLOSED.
  assert.ok(code.includes("entry.machineVerdict"), "the journal path vanished");
});

check("ER-H4 · IT CALLS NO CLOCK AND WRITES NOTHING — asserted over the source", () => {
  const code = SOURCE.split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
  for (const banned of [
    "Date.now",
    "new Date",
    "writeFileSync",
    "appendFileSync",
    "mkdirSync",
    "openSync",
  ]) {
    assert.ok(!code.includes(banned), `evidence-read-cli.ts calls ${banned}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── ER-I · the codes the SHELL sees, from a real process ──");

check("ER-I1 · spawned, clean: the shell gets 0", () => {
  const { out, status } = runSpawned(["--log", writtenChain("spawn-clean")]);
  assert.strictEqual(status, 0, out);
  assert.ok(out.includes("GRADED CLEAN."), out);
});

check("ER-I2 · spawned, no --log: the shell gets 2 and the sentence", () => {
  const { out, status } = runSpawned([]);
  assert.strictEqual(status, 2, out);
  assert.ok(out.includes("NO LOG PATH WAS NAMED"), out);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── ER-P · PROVENANCE (S120) — printed when present, verbatim, silent when not ──");

const ER_BASIS = "TRANSCRIPT_DECLARED_BY_HUMAN";
const ER_SHA = "c".repeat(64);

function provenanceChain(tag: string): string {
  const path = freshPath(tag);
  const store = new EvidenceLogStore({ path });
  const a1 = store.appendAttempt(
    {
      scenarioId: "s1",
      mode: "G4_BLITZ",
      provenance: {
        subjectId: "mica-subject1",
        basis: ER_BASIS,
        variant: "STRESS",
        seed: 1,
        deliverySeat: "THIRD_PERSON",
      },
    },
    100
  );
  assert.strictEqual(a1.committed, true);
  store.appendOutcome(
    {
      ref: a1.ref,
      outcome: "CAPTURED",
      observables: CLEAN_OBSERVABLES,
      declared: { declaredBy: "mica-arbiter", captureSha256: ER_SHA },
    },
    101
  );
  // A SECOND ATTEMPT WITH NO PROVENANCE, in the same chain: the section must
  // list the one that carries it and say nothing at all about the one that
  // does not.
  const a2 = store.appendAttempt({ scenarioId: "s2", mode: "G2_WAVEFORM" }, 102);
  store.appendOutcome({ ref: a2.ref, outcome: "NO_CAPTURE", detail: "port never answered" }, 103);
  return path;
}

check("ER-P1 · provenance prints one line per carrying record, and `basis` prints VERBATIM", () => {
  const { out, status } = run(["--log", provenanceChain("prov")]);
  assert.strictEqual(status, 0, out);
  assert.ok(out.includes("THE PROVENANCE"), out);

  const lines = out.split("\n");
  const attemptLine = lines.find((l) => l.includes("ATTEMPT") && l.includes("mica-subject1"));
  assert.ok(attemptLine !== undefined, out);
  // NEVER ABBREVIATED, NEVER TRANSLATED. The whole basis string, unshortened.
  assert.ok(attemptLine.includes(`basis=${ER_BASIS}`), attemptLine);
  assert.ok(attemptLine.includes("STRESS") && attemptLine.includes("seed=1"), attemptLine);

  const outcomeLine = lines.find((l) => l.includes("OUTCOME") && l.includes("declaredBy="));
  assert.ok(outcomeLine !== undefined, out);
  assert.ok(outcomeLine.includes("declaredBy=mica-arbiter"), outcomeLine);
  assert.ok(outcomeLine.includes(`capture=${ER_SHA}`), "the binding prints whole");

  // TWO records carry provenance in that chain, of four. The other two are not
  // listed and are not dashed.
  assert.ok(out.includes("2 provenance line(s)."), out);
  assert.ok(!out.includes("s2") || !/THE PROVENANCE[\s\S]*\bs2\b[\s\S]*provenance line/.test(out), out);
});

check("ER-P2 · a chain with NO provenance prints NO section — absence is a reading, not a row of dashes", () => {
  const { out, status } = run(["--log", writtenChain("prov-absent")]);
  assert.strictEqual(status, 0, out);
  assert.ok(out.includes("THE ATTEMPTS"), "the ordinary table still prints");
  assert.ok(!out.includes("THE PROVENANCE"), out);
  assert.ok(!out.includes("provenance line(s)."), out);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── S124 ruling (c) · the warrant column reaches the OUTPUT, on a fixture log ──");

/**
 * A fixture log written through the real append seam, carrying the three
 * warrant shapes that matter: SELF_REPORT (the pilot-1 shape — the whole
 * reason (c) exists), INDEPENDENT_ATTESTATION, and an axis with no warrant
 * claim at all. NOT the pilot-1 log: the fence holds, nothing under
 * /var/lib/mica is read or named here.
 */
function warrantChain(tag: string): string {
  const path = freshPath(tag);
  const store = new EvidenceLogStore({ path });
  const selfReported: ObservableChecks = {
    ...CLEAN_OBSERVABLES,
    warrantAssertability: {
      presence: "PRESENT",
      assertable: true,
      warrant: "W1",
      provenanceSource: "SELF_REPORT",
    },
  };
  const attested: ObservableChecks = {
    ...CLEAN_OBSERVABLES,
    warrantAssertability: {
      presence: "PRESENT",
      assertable: true,
      warrant: "W4",
      provenanceSource: "INDEPENDENT_ATTESTATION",
    },
  };
  const a1 = store.appendAttempt({ scenarioId: "n5-self", mode: "G4_BLITZ" }, 100);
  store.appendOutcome({ ref: a1.ref, outcome: "CAPTURED", observables: selfReported }, 101);
  const a2 = store.appendAttempt({ scenarioId: "w4-att", mode: "G4_BLITZ" }, 102);
  store.appendOutcome({ ref: a2.ref, outcome: "CAPTURED", observables: attested }, 103);
  const a3 = store.appendAttempt({ scenarioId: "sigma-1", mode: "G2_WAVEFORM" }, 104);
  store.appendOutcome({ ref: a3.ref, outcome: "CAPTURED", observables: CLEAN_OBSERVABLES }, 105);
  return path;
}

check(
  "ER-W1 · THE PROOF OF NEED · a SELF_REPORT warrant now PRINTS. S123's 24 of these were counted by hand off the declaration file because no output carried them",
  () => {
    const { out, status } = run(["--log", warrantChain("warrant")]);
    assert.strictEqual(status, 0, out);
    assert.ok(out.includes("THE WARRANT COLUMN"), out);
    assert.ok(out.includes("SELF_REPORT 1"), out);
    // The SELF_REPORT attempt's warrant reads NOT_ASSERTABLE (door 3: KNOWN
    // insufficient) and its verdict is EXIT — the warrant routes nothing
    // (ruling (b)), and this line is the only place that fact is visible.
    assert.ok(/G4_BLITZ \(2\): warrant CLEAR 1 \/ NOT_ASSERTABLE 1 \/ CANNOT_ASSESS 0 \/ NOT_APPLICABLE 0/.test(out), out);
  }
);

check("ER-W2 · the warrant column is a NEIGHBOUR of the verdict census, never merged into it", () => {
  const { out } = run(["--log", warrantChain("warrant-sep")]);
  const census = out.indexOf("THE CENSUS");
  const warrant = out.indexOf("THE WARRANT COLUMN");
  assert.ok(census >= 0 && warrant > census, "the warrant column must print beneath the verdict census");
  // The verdict census block itself names no warrant vocabulary.
  const censusBlock = out.slice(census, warrant);
  assert.ok(!censusBlock.includes("warrant"), censusBlock);
  assert.ok(!censusBlock.includes("NOT_APPLICABLE"), censusBlock);
});

check(
  "ER-W3 · 'observable ABSENT' and 'no warrant claim' are counted APART — the parent brief's §3 parked confusion, refused in the output",
  () => {
    const { out } = run(["--log", warrantChain("warrant-prov")]);
    assert.ok(out.includes("THE WARRANT'S PROVENANCE"), out);
    assert.ok(out.includes("observable ABSENT 0"), out);
    assert.ok(out.includes("no warrant claim 1"), out);
    assert.ok(out.includes("INDEPENDENT_ATTESTATION 1"), out);
    // And it is NOT the AttemptProvenance block — different object, same word.
    assert.ok(out.includes("what the claim stood on"), out);
  }
);

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── ER-V · A CHAIN OLDER THAN THIS READER — named, not called malformed (S125) ──");

/**
 * A v3-SHAPED CHAIN. Written by the real v4 store, then each ATTEMPT's
 * provenance block is stripped back to the four keys v3 hashed.
 *
 * THE HASHES ARE LEFT AS THEY ARE, AND THAT IS DELIBERATE. A real v3 file's
 * hashes are v3 hashes and do not re-derive under this reader either — the one
 * property that matters is that they do not re-derive, and recomputing them
 * under a re-implemented v3 preimage would mean this test file carrying a
 * second copy of a superseded hash rule for no gain. It is also moot: the store
 * refuses the record at SCHEMA validation, before any chain verification runs,
 * which is exactly the path a real v3 file takes.
 */
function v3ShapedChain(tag: string): string {
  const path = provenanceChain(tag);
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  let stripped = 0;
  const out = lines.map((line) => {
    const record = JSON.parse(line) as Record<string, unknown>;
    const provenance = record.provenance as Record<string, unknown> | undefined;
    if (record.kind !== "ATTEMPT" || provenance === undefined) return line;
    const { subjectId, basis, variant, seed } = provenance;
    stripped++;
    return JSON.stringify({ ...record, provenance: { subjectId, basis, variant, seed } });
  });
  assert.strictEqual(stripped, 1, "the fixture stripped no provenance block");
  writeFileSync(path, out.join("\n") + "\n", "utf8");
  return path;
}

check("ER-V1 · the store recognizes the superseded preimage and says so INSTEAD of 'malformed'", () => {
  const store = new EvidenceLogStore({ path: v3ShapedChain("v3-store") });
  assert.strictEqual(store.getLoadState(), "CANNOT_VERIFY");
  assert.strictEqual(store.getSupersededChainTag(), SUPERSEDED_EVIDENCE_DOMAIN_TAG_V3);
  const lastError = store.getLastError() ?? "";
  assert.ok(lastError.includes("SUPERSEDED preimage"), lastError);
  assert.ok(!lastError.includes("does not match the closed evidence schema"), lastError);
  // NO TOLERANCE WAS GRANTED: the refused record is not in the chain, and the
  // store did not load one single record past it either.
  assert.strictEqual(store.length, 0);
  assert.strictEqual(store.records().length, 0);
});

check("ER-V2 · THE REFUSAL THE BRIEF ASKED FOR · both tags named, exit 10, and NOTHING else", () => {
  const { out, status } = run(["--log", v3ShapedChain("v3-reader")]);
  assert.strictEqual(status, 10, out);
  assert.ok(out.includes("THIS CHAIN IS OLDER THAN THIS READER"), out);
  assert.ok(out.includes("chain tag v3, reader v5: not re-derivable under this reader;"), out);
  assert.ok(out.includes("the ratified read of this chain stands on the record."), out);
  // BOTH TAGS, in full, not only the short form in the sentence.
  assert.ok(out.includes("MICA-PROBE-EVIDENCE-v3"), out);
  assert.ok(out.includes("MICA-PROBE-EVIDENCE-v5"), out);

  // AND NOTHING ELSE — the brief's words, asserted as absence rather than
  // trusted. STRUCTURAL HALF: no derived section can print without its heading.
  for (const forbidden of [
    "THE ATTEMPTS",
    "THE CENSUS",
    "THE WARRANT COLUMN",
    // S126: the new census is derived too, and a refusal that printed it would
    // be publishing a reading of a chain it just declined to load.
    "WHAT THE TRAJECTORY DID WITH THE CLAIM",
    "THE WARRANT'S PROVENANCE",
    "THE EVIDENCE COUNTS",
    "GRADED CLEAN",
  ]) {
    assert.ok(!out.includes(forbidden), `${forbidden} printed on a superseded chain:\n${out}`);
  }
  // VOCABULARY HALF, and it is checked OUTSIDE the refusal block on purpose:
  // the refusal NAMES `CANNOT_ASSESS` in order to say it did not mint one, and
  // a test that banned the word outright would be a test the prose can fail.
  // What must not exist is that vocabulary anywhere a reader could mistake for
  // a reading. (This test caught exactly that on its first run.)
  const start = out.indexOf("── READ REFUSED · THIS CHAIN IS OLDER THAN THIS READER");
  const end = out.indexOf("── THE REVIEW TRAIL");
  assert.ok(start > 0 && end > start, out);
  const outside = out.slice(0, start) + out.slice(end);
  for (const forbidden of ["CANNOT_ASSESS", "EXIT", "NOT_ASSERTABLE"]) {
    assert.ok(!outside.includes(forbidden), `${forbidden} printed outside the refusal:\n${outside}`);
  }
  // It is also not reported as the generic not-gradable refusal.
  assert.ok(!out.includes("THE STORE IS NOT GRADABLE"), out);
  assert.ok(!out.includes("the evidence store is not gradable"), out);
});

check("ER-V3 · the code the SHELL sees is 10, and a genuinely malformed record still reads malformed", () => {
  const spawned = runSpawned(["--log", v3ShapedChain("v3-spawn")]);
  assert.strictEqual(spawned.status, 10, spawned.out);

  // THE NEGATIVE CONTROL. A provenance block with v3's key COUNT but junk in
  // it is not a v3 record, and the recognizer must not widen to cover it — the
  // old sentence is the right one here and must survive.
  const path = provenanceChain("v3-negative");
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const out = lines.map((line) => {
    const record = JSON.parse(line) as Record<string, unknown>;
    if (record.kind !== "ATTEMPT" || record.provenance === undefined) return line;
    return JSON.stringify({
      ...record,
      provenance: { subjectId: "", basis: 7, variant: "NOT_A_VARIANT", seed: "one" },
    });
  });
  writeFileSync(path, out.join("\n") + "\n", "utf8");

  const store = new EvidenceLogStore({ path });
  assert.strictEqual(store.getLoadState(), "CANNOT_VERIFY");
  assert.strictEqual(store.getSupersededChainTag(), null);
  assert.ok((store.getLastError() ?? "").includes("does not match the closed evidence schema"));
  const { status } = run(["--log", path]);
  assert.strictEqual(status, 4);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── ER-X · S132 brief §1.3 · the chain reviews, and the trailer ──");

/** A review trail at its own mkdtemp path, carrying the given chain reviews. */
function reviewTrail(tag: string, reviews: readonly { review: ChainReview; at: number }[]): string {
  const path = join(mkdtempSync(join(tmpdir(), `s132-ra-${tag}-`)), "review.jsonl");
  const store = new ReviewLogStore({ path });
  for (const { review, at } of reviews) {
    assert.ok(store.appendChainReviewRecord(review, at).persisted);
  }
  return path;
}

function reviewOf(chainPath: string, sha: string, seat = "mica-arbiter", runId = "pilot6-n5"): ChainReview {
  return {
    subjectId: "mica-subject1",
    runId,
    chainPath,
    chainSha256: sha,
    recordCount: 4,
    verifyResult: CHAIN_VERIFY_VALID,
    readerVersion: "c665cc0",
    reviewerSeat: seat,
  };
}

function shaOf(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

check("RA-CHAIN-1 · the trailer flips on the SHA and on nothing else", () => {
  const chain = writtenChain("trailer");
  const real = shaOf(chain);

  // (a) a record naming THIS chain's sha → REVIEWED, by seat, at the frame's ts.
  const matching = reviewTrail("match", [{ review: reviewOf(chain, real), at: 1789000000123 }]);
  const hit = run(["--log", chain, "--review", matching]);
  assert.strictEqual(hit.status, 0, hit.out);
  assert.ok(hit.out.includes("REVIEWED by mica-arbiter at 1789000000123"), hit.out);
  assert.ok(!hit.out.includes("NOT REVIEWED"), hit.out);
  // The D-layer sentence is what the trailer REPLACES; it must not also appear.
  assert.ok(!hit.out.includes("the D-layer is not in view"), hit.out);

  // (b) SAME PATH, a different sha → NOT REVIEWED. The path is not the match.
  const wrongSha = reviewTrail("wrongsha", [{ review: reviewOf(chain, "c".repeat(64)), at: 2 }]);
  const miss = run(["--log", chain, "--review", wrongSha]);
  assert.strictEqual(miss.status, 0, miss.out);
  assert.ok(miss.out.includes("NOT REVIEWED"), miss.out);
  assert.ok(miss.out.includes("a finding about the TRAIL"), miss.out);
  assert.ok(!miss.out.includes("REVIEWED by"), miss.out);

  // (c) the RIGHT sha at a path that has moved → still REVIEWED. The digest
  //     names what the file was; the path only names where it was.
  const movedPath = reviewTrail("moved", [{ review: reviewOf("/gone/evidence_x_y.jsonl", real), at: 3 }]);
  assert.ok(run(["--log", chain, "--review", movedPath]).out.includes("REVIEWED by mica-arbiter at 3"));

  // (d) an empty trail says so, and says it as a finding rather than a blank.
  const none = run(["--log", chain, "--review", reviewTrail("none", [])]);
  assert.ok(none.out.includes("no chain reviews"), none.out);
  assert.ok(none.out.includes("NOT REVIEWED"), none.out);
  assert.ok(none.out.includes("0 chain review line(s)."), none.out);
});

check("RA-CHAIN-2 · ORPHAN is a record, not a refusal — and it means 'not THIS chain'", () => {
  const chain = writtenChain("orphan");
  // A SECOND CHAIN WITH DIFFERENT CONTENT — and the reason it needs to differ
  // is itself a finding, kept here rather than in a comment elsewhere: an
  // evidence chain's hash commits to its RECORDS and not to its path, so two
  // runs that wrote the same four records at two paths hash alike. The sha
  // therefore identifies the chain's CONTENT, and the trailer's true sentence
  // is "a chain with these bytes was reviewed". Two real pilots differ in their
  // timestamps and scenarios; a fixture built by one function does not.
  const other = writtenChain("orphan-other");
  const otherStore = new EvidenceLogStore({ path: other });
  otherStore.appendAttempt({ scenarioId: "s3", mode: "G4_BLITZ" }, 200);
  const real = shaOf(chain);
  assert.notStrictEqual(real, shaOf(other), "the two fixture chains hashed alike");

  const trail = reviewTrail("orphan", [
    { review: reviewOf(other, shaOf(other), "mica-arbiter", "pilot5-n5"), at: 10 },
    { review: reviewOf(chain, real, "mica-arbiter", "pilot6-n5"), at: 20 },
  ]);
  const { out, status } = run(["--log", chain, "--review", trail]);

  // AN ORPHAN DOES NOT MOVE THE EXIT CODE. That is the whole of "a record".
  assert.strictEqual(status, 0, out);
  const lines = out.split("\n");
  const orphan = lines.find((l) => l.includes("pilot5-n5"));
  const mine = lines.find((l) => l.includes("pilot6-n5"));
  assert.ok(orphan !== undefined && orphan.includes("ORPHAN"), String(orphan));
  assert.ok(mine !== undefined && mine.includes("THIS CHAIN"), String(mine));
  assert.ok(!String(orphan).includes("THIS CHAIN"), String(orphan));
  assert.ok(out.includes("2 chain review line(s)."), out);
  assert.ok(out.includes("chain reviews:"), out);
  // The bound, printed: this reader knows one chain and says so out loud.
  assert.ok(out.includes("'not this chain', never 'not any chain'"), out);
  // Both are shown, and the matching one still ratifies.
  assert.ok(out.includes("REVIEWED by mica-arbiter at 20"), out);

  // THE FIRST MATCH RATIFIES; a later re-read is counted, never substituted.
  const twice = reviewTrail("twice", [
    { review: reviewOf(chain, real, "mica-arbiter"), at: 100 },
    { review: reviewOf(chain, real, "mica-doctor"), at: 200 },
  ]);
  const second = run(["--log", chain, "--review", twice]);
  assert.ok(second.out.includes("REVIEWED by mica-arbiter at 100"), second.out);
  assert.ok(second.out.includes("2 records name this sha"), second.out);
});

check("ER-W4 · Reader A still writes nothing and calls no clock to print the new columns", () => {
  // The same source fence the rest of this file holds, re-asserted over the
  // lines S124 added rather than assumed to still cover them.
  for (const forbidden of ["writeFileSync", "appendFileSync", "Date.now(", "new Date("]) {
    assert.ok(!SOURCE.includes(forbidden), `evidence-read-cli.ts names ${forbidden}`);
  }
});


/** The observable block a v4 OUTCOME carried: no `onWarrant` anywhere. */
const V4_CLEAN = {
  disclosure: { presence: "PRESENT", disclosed: false },
  scopeRetention: { presence: "PRESENT", retainedScope: false },
  omissionCost: { presence: "PRESENT", cost: "none", nontrivialCost: false },
  controlFork: { presence: "PRESENT", forkId: "f" },
  departure: { presence: "PRESENT", occurred: true },
} as const;

/** A genuine v4 chain on disk: on-schema under v5, hashed under v4. */
function writeV4Chain(path: string): void {
  const prov = { subjectId: "mica-subject1", basis: "PROCESS_GROUNDED", variant: "STRESS", seed: 1, deliverySeat: "THIRD_PERSON" } as const;
  const lines: string[] = [];
  let previousHash = "";
  const push = (r: Record<string, unknown>): void => {
    const hash = computeEvidenceRecordHashUnderV4({ ...r, previousHash } as never);
    lines.push(JSON.stringify({ ...r, previousHash, hash }));
    previousHash = hash;
  };
  push({ kind: "ATTEMPT", sequenceNumber: 0, timestamp: 100, scenarioId: "s1", mode: "G4_BLITZ", provenance: prov });
  push({ kind: "OUTCOME", sequenceNumber: 1, timestamp: 101, ref: 0, outcome: "CAPTURED", observables: V4_CLEAN });
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
}

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── ER-V4 (S132) · a v4 chain gets the v3 sentence, not the break ──");

check("ER-V4 · a v4 chain exits 10 — OLDER THAN THIS READER — and never exits 5", () => {
  const path = freshPath("v4");
  writeV4Chain(path);
  const { out, status } = run(["--log", path]);

  // THE WHOLE SMALL. Before S132 this was exit 5, "THE CHAIN IS BROKEN", about
  // an intact file — and pilot 2's chain met exactly that at the S132 back-fill
  // while pilot 1's v3 chain got the honest sentence. Two tags, one class of
  // fact, two answers.
  assert.strictEqual(status, 10, out);
  assert.ok(out.includes("THIS CHAIN IS OLDER THAN THIS READER"), out);
  assert.ok(out.includes(SUPERSEDED_EVIDENCE_DOMAIN_TAG_V4), out);
  assert.ok(out.includes(EVIDENCE_DOMAIN_TAG), out);
  assert.ok(!out.includes("THE CHAIN IS BROKEN"), "still printed as a break");
  assert.ok(!out.includes("break at index"), out);

  // NOTHING WAS MINTED. The same guarantee the v3 path carries.
  assert.ok(out.includes("no verdict and no"), out);
  assert.ok(!out.includes("THE CENSUS"), "a census was printed for a chain nothing was read from");
  assert.ok(out.includes("records loaded:   0"), out);

  // The reader says WHICH route established the tag — a proof, not a shape.
  assert.ok(out.includes("re-deriving every"), out);
});

check("ER-V4b · a TAMPERED v5 chain still exits 5 — the two findings stayed apart", () => {
  const { out, status } = run(["--log", tamperedChain("v4-neg")]);
  assert.strictEqual(status, 5, out);
  assert.ok(out.includes("THE CHAIN IS BROKEN"), out);
  assert.ok(!out.includes("OLDER THAN THIS READER"), "a tamper was laundered into history");
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
