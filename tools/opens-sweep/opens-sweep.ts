// ── MICA · opens-sweep — a core ticket's `opens`, derived rather than listed ──
//
// WHY THIS EXISTS. The arbiter accepted the rule on 2026-10-01 15:15Z, after T11's
// `opens` was found short by TEN files: "`opens` is derived by a FULL SWEEP over
// all suites, run by a script, with the population and the numbers printed into
// the ticket's receipt — never a list someone thought of carefully. The careful
// list was wrong by eight."
//
// ⛔ AND THE FIRST THING IT FIXES IS THE SWEEPS I RAN BY HAND THAT DAY. Every
//    "population: 43 suites" line I wrote on 2026-10-01 — for T11, T13, T14 and
//    the glue commit — came from a glob I typed:
//        src/mica/*.test.ts src/mica/*/*.test.ts src/glue/*.test.ts src/core-door/*.test.ts
//    The repository DECLARES its population in `tools/suite-protocol.ts`, which
//    exists precisely because "a constant copied into three files is three
//    constants that can drift". Its `discoverAllTests` finds 104 suites under
//    DISCOVERY_ROOTS = ["src", "tools"]. MY GLOB COVERED 43 OF THEM. 61 suites
//    — including src/clerk/clerk.test.ts and src/integration/l0-clerk-f3.test.ts,
//    both squarely in T10's path — were never run by any sweep that called itself
//    full. The number was honest about what it covered and wrong about what it
//    was called.
//
//    So this tool takes the population from the protocol and NEVER from its own
//    idea of where tests live. If the walk convention changes, this changes with
//    it, because there is one walk convention and this is not a second one.
//
// ⚠ IT NEVER TOUCHES THE WORKING TREE. No stash, no checkout, no branch switch.
//   A tool that stashes uncommitted core work to measure a baseline is a tool
//   that can lose a day, and the measurement is not worth that. Two runs, two
//   TSVs, and a compare step the operator drives:
//
//     npx ts-node tools/opens-sweep/opens-sweep.ts --run  out/base.tsv
//     (check out / stash by hand, deliberately)
//     npx ts-node tools/opens-sweep/opens-sweep.ts --run  out/cand.tsv
//     npx ts-node tools/opens-sweep/opens-sweep.ts --compare out/base.tsv out/cand.tsv
//
// EXIT: 0 the run or the comparison completed · 2 usage · 1 a suite could not be
//       started at all (which is a finding, not a failed test).

import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, relative, resolve } from "path";
import {
  DISCOVERY_ROOTS,
  SKIP_DIRS,
  TEST_SUFFIX,
  discoverAllTests,
} from "../suite-protocol";
import {
  EXCLUDED_MARKER,
  MIN_DIRECT_RUNS,
  detectionProbability,
  loadFlakyRegister,
  observedRate,
} from "../flaky-register";

const REPO = resolve(__dirname, "..", "..");
/** The one line of output that lets a later reader tell WHAT was swept. */
const POPULATION_HEADER = "#population";
const PROVENANCE_HEADER = "#provenance";

/** `-` when the door said nothing; otherwise the drifting core paths it NAMED. */
const NO_DOOR_DRIFT = "-";

/**
 * ⛔ WHAT MADE THIS NECESSARY, TWICE IN ONE DAY, AND THE SECOND TIME WAS A NEAR MISS.
 *
 *   2026-10-03 12:16Z — a `--compare` was run whose BASE ARM had been captured one
 *   commit before the tip named in `--base`. The extra mover was `preflight.test.ts`
 *   and it was explainable; had the stray mover been inside `src/mica/**` it would
 *   have entered an `opens` list.
 *
 *   2026-10-03 15:17Z — T22's two arms were taken in `git archive` trees and read
 *   FIVE count-less suites where every worktree arm that day read four. The fifth
 *   is `src/registrar/refusal-log.test.ts`, which asserts a git sha; an archive has
 *   no `.git`, so the suite fails there and passes 37/37 in a worktree at the same
 *   commit. T21's derivation was about to mix one archive arm with one worktree arm,
 *   and `refusal-log` would have shown as a MOVER purely because of where each arm
 *   was taken. The only reason it was caught is that a count went from 4 to 5 under
 *   the eye of someone who had read that figure four times already.
 *
 * ⚠ SO A TSV RECORDED ITS POPULATION AND NOTHING ELSE. Three more facts decide
 *   whether two arms can be compared at all, and none of them was in the file:
 *   the COMMIT, the KIND OF TREE, and the VERSION OF THE TOOL that made it.
 *
 * ⛔ AND THE RULE THIS FILE ALREADY STATES APPLIES TO ITSELF: "a value that cannot
 *    tell two cases apart, followed by a verdict that picks one." An absent
 *    provenance is such a value, and `--compare` was the verdict.
 */
/**
 * ⛔ THE FILE BODY, EXTRACTED SO THE WRITE PATH CAN BE TESTED AT ALL. A mutation
 *    that stopped `doRun` writing the provenance line left this tool's suite
 *    12/12 GREEN: every check built its arms by hand, so all of them pinned the
 *    READER and none the WRITER. That is the third time in one day a check has
 *    failed to cover what it was written for, and the first two were found the
 *    same way — by changing the code and watching what did not fail.
 *
 * ⚠ The provenance line is SECOND, after the population and before the rows, and
 *   the test asserts the position rather than the presence: a header that lands
 *   in the middle of the rows is read as a row by anything that counts them.
 */
export function tsvBody(
  header: string,
  provenance: string,
  rows: ReadonlyArray<{
    readonly path: string;
    readonly exit: number;
    readonly counts: string;
    readonly doorDrift?: string;
  }>
): string {
  return (
    [
      header,
      provenance,
      ...rows.map((r) => `${r.path}\t${r.exit}\t${r.counts}\t${r.doorDrift ?? NO_DOOR_DRIFT}`),
    ].join("\n") + "\n"
  );
}

export function provenanceNow(): string {
  const git = (args: readonly string[]): string | null => {
    try {
      return execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch { return null; }
  };
  // `rev-parse --git-dir` is the discriminator: it succeeds in a worktree and fails
  // in a `git archive`, which is exactly the difference that bit on 2026-10-03.
  const tree = git(["rev-parse", "--git-dir"]) === null ? "archive" : "worktree";
  const commit = git(["rev-parse", "HEAD"]) ?? "NONE";
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  const dirty = status === null ? "UNKNOWN" : status === "" ? "no" : "yes";
  // The tool hashes ITSELF, so an arm taken by an older copy of this file is
  // visible as such. 56 worktrees exist under ~/mica-wt and any of them can run a
  // sweep; a derivation made by a stale tool had nothing in its output to say so.
  let tool = "UNKNOWN";
  try { tool = createHash("sha256").update(readFileSync(__filename)).digest("hex").slice(0, 12); } catch { /* reported as UNKNOWN */ }
  return `${PROVENANCE_HEADER}\tcommit=${commit}\ttree=${tree}\tdirty=${dirty}\ttool=${tool}`;
}

interface Provenance {
  readonly recorded: boolean;
  readonly commit: string;
  readonly tree: string;
  readonly dirty: string;
  readonly tool: string;
  readonly line: string;
}

function parseProvenance(line: string | undefined): Provenance {
  if (line === undefined || !line.startsWith(PROVENANCE_HEADER)) {
    return { recorded: false, commit: "UNRECORDED", tree: "UNRECORDED", dirty: "UNRECORDED", tool: "UNRECORDED", line: `${PROVENANCE_HEADER} UNRECORDED` };
  }
  const f = new Map(line.split("\t").slice(1).map((kv) => {
    const i = kv.indexOf("=");
    return [kv.slice(0, i), kv.slice(i + 1)] as const;
  }));
  return {
    recorded: true,
    commit: f.get("commit") ?? "UNRECORDED",
    tree: f.get("tree") ?? "UNRECORDED",
    dirty: f.get("dirty") ?? "UNRECORDED",
    tool: f.get("tool") ?? "UNRECORDED",
    line,
  };
}

interface Row {
  readonly path: string;
  readonly exit: number;
  readonly counts: string;
  /**
   * `-`, or the core files the DOOR named as drifting when this suite ran.
   *
   * ⛔ WHY THIS COLUMN EXISTS, AND IT IS A DEFECT THIS TOOL COMMITTED AGAINST ITS
   *    OWN AUTHOR. The comparison classified a mover as "the door objecting to
   *    no-live-ticket" from a HARD-CODED SET OF TWO NAMES. On 2026-10-04 that
   *    caption went on a change it did not describe: `core-door.test.ts` moved
   *    31 -> 36 because five arms were ADDED to it, and the comparison reported it
   *    as the door objecting. A caption naming the wrong cause — in the tool whose
   *    provenance header exists to stop a caption naming the wrong cause.
   *
   * ⚠ AND THE CAUSE CANNOT BE RECOVERED BY COMPARING TWO COUNT LINES. "31" and
   *   "36" do not say why. So it is CAPTURED when the arm is taken, from the
   *   suite's own output, or it is not knowable later — the same shape as a census
   *   that prints what passed and never what it cost.
   */
  readonly doorDrift: string;
}

/**
 * The door's refusal, read from a suite's own words rather than from its name.
 *
 * `evaluateDoor` prints `CORE DOOR REFUSED — N reason(s); …` and one
 * `DRIFT <path> …: pinned …, on disk … — no ticket covers it: …` per file. A suite
 * that fails because the pin does not cover an uncommitted edit carries both; a
 * suite that merely grew does not carry either. That is the discriminator, and it
 * NAMES THE FILES, so the classification can be checked against the edited set
 * instead of trusted.
 */
export function doorDriftIn(out: string): string {
  if (!out.includes("CORE DOOR REFUSED")) return NO_DOOR_DRIFT;
  const named = new Set<string>();
  for (const m of out.matchAll(/^\s*REFUSED: DRIFT (\S+) /gm)) named.add(m[1]);
  // A refusal with no DRIFT line is still the door refusing — recorded as such
  // rather than as silence, because "the door spoke and named nothing" and "the
  // door said nothing" are different facts.
  return named.size === 0 ? "DOOR-REFUSED" : `DOOR-DRIFT:${[...named].sort().join(",")}`;
}

/**
 * ── THE SUITE'S OWN TALLY, IN WHATEVER DIALECT IT SPEAKS ────────────────────
 *
 * ⛔ THE OLD PATTERN READ TWO DIALECTS AND THE HOUSE SPEAKS AT LEAST FOUR, so
 *    three suites were recorded as "NO-COUNT-LINE" for a week while printing a
 *    perfectly good tally. Measured 2026-10-04:
 *
 *      src/clerk/clerk.test.ts            "78 passed, 0 failed"
 *      src/probe/review-cli.test.ts       "review-cli: 87 passed, 0 failed"
 *      tools/dry-well-gauge/gauge.test.ts "24 tests: 24 passed, 0 incomplete, 0 failed"
 *
 *    All three exit 0 and all three pass. The old regex wanted
 *    `N tests: N passed, N failed` or `N passed.` — a bare `N passed, N failed`
 *    does not match, a prefix does not match, and `0 incomplete,` between the
 *    two numbers does not match.
 *
 * ⛔ AND THE CAPTION WAS WRONG ABOUT THEM, IN EVERY SWEEP RECEIPT THIS WEEK.
 *    "⊘ printed NO COUNT LINE — a suite that says nothing cannot be said to
 *    agree" was true of `l0-clerk-f3` (which died on an uncaught assertion) and
 *    FALSE of these three: they said something and the READER could not parse it.
 *    189 tests sat outside every derivation, not because they were silent but
 *    because they were multilingual.
 *
 * ⚠ SO THE LAST LINE CARRYING A TALLY IS RECORDED WHOLE, VERBATIM, rather than a
 *   sub-match of a shape this file expects. The suite's own words were always the
 *   intent — "a re-derived count is a second opinion about what the suite said" —
 *   and a narrow pattern was quietly re-deriving which words counted.
 *
 * ⚠ AND "SILENT" IS NOW DISTINGUISHABLE FROM "UNPARSED", because the two were
 *   collapsed and that is how this lasted: a suite with output but no tally reads
 *   NO-TALLY-IN-OUTPUT, one with no output at all reads NO-OUTPUT.
 */
export function countsLineIn(out: string): string {
  const lines = out.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return "NO-OUTPUT";
  // a tally names a number and the word `passed`, in that order, on one line
  const tally = /\b[0-9]+ (?:tests: *[0-9]+ passed|passed)\b/;
  for (let i = lines.length - 1; i >= 0; i--) if (tally.test(lines[i])) return lines[i];
  return "NO-TALLY-IN-OUTPUT";
}

function runOne(rel: string): Row {
  let out = "";
  let exit = 0;
  try {
    out = execFileSync("npx", ["ts-node", "-T", rel], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    exit = typeof e.status === "number" ? e.status : 1;
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  return {
    path: rel,
    exit,
    counts: countsLineIn(out),
    doorDrift: doorDriftIn(out),
  };
}

function doRun(outPath: string): number {
  const abs = discoverAllTests(REPO);
  const rels = abs.map((p) => relative(REPO, p)).sort();
  const header =
    `${POPULATION_HEADER}\troots=${JSON.stringify(DISCOVERY_ROOTS)}` +
    `\tsuffix=${TEST_SUFFIX}\tskip=${JSON.stringify([...SKIP_DIRS])}\tn=${rels.length}`;
  const provenance = provenanceNow();
  console.log(header.replace(/\t/g, "  "));
  console.log(provenance.replace(/\t/g, "  "));
  // ── the FLAKY REGISTER (board ruling 2026-10-02 20:38Z) ──────────────────
  //
  // A registered suite is NOT run and its row carries EXCLUDED_MARKER, so a
  // later comparison can neither score it as a verdict move nor mistake the
  // exclusion for a pass. The row count still equals the declared population:
  // a file whose `n=` and row count disagree is a file a reader must reconcile,
  // and this tool's whole job is to not need reconciling.
  const register = loadFlakyRegister(REPO);
  const excluded = new Map(register.map((e) => [e.suite, e]));
  const unknown = register.filter((e) => !rels.includes(e.suite));
  if (register.length === 0) {
    console.log(`  flaky register: EMPTY — every one of the ${rels.length} suites is swept.`);
  } else {
    console.log(`  flaky register: ${register.length} suite(s) EXCLUDED from this run, confirmed by ≥${MIN_DIRECT_RUNS} direct runs:`);
    for (const e of register) {
      console.log(
        `    ⊘ ${e.suite}  ${e.failures}/${e.runs} direct runs failed ` +
          `(${(observedRate(e) * 100).toFixed(1)}%; 3 runs would detect it ${(detectionProbability(e, 3) * 100).toFixed(1)}% of the time)`
      );
    }
  }
  // ⛔ A register naming a suite the population does not contain is a finding,
  //    not a no-op: it means the register is stale and is silently protecting
  //    nothing while reading as though it protects something.
  for (const e of unknown) {
    console.log(`    ⛔ ${e.suite} is REGISTERED BUT NOT IN THE POPULATION — the register is stale.`);
  }

  const rows: Row[] = [];
  for (const [i, rel] of rels.entries()) {
    const reg = excluded.get(rel);
    if (reg !== undefined) {
      // ⚠ UNRECORDED, not `-`: a register-excluded suite was never RUN, so the door
      //   said nothing AND nothing looked. `-` would claim a measurement here.
      rows.push({ path: rel, exit: -1, counts: EXCLUDED_MARKER, doorDrift: "UNRECORDED" });
      console.log(`  [${i + 1}/${rels.length}] ${rel}  ⊘ ${EXCLUDED_MARKER} (${reg.failures}/${reg.runs} direct)`);
      continue;
    }
    const r = runOne(rel);
    rows.push(r);
    console.log(`  [${i + 1}/${rels.length}] ${rel}  exit=${r.exit}  ${r.counts}`);
  }
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(resolve(outPath), tsvBody(header, provenance, rows), "utf8");
  const unstarted = rows.filter((r) => r.counts.startsWith("NO-"));
  const skipped = rows.filter((r) => r.counts === EXCLUDED_MARKER);
  console.log(
    `\n  wrote ${outPath} · ${rows.length} rows · ` +
      `swept ${rows.length - skipped.length} · register-excluded ${skipped.length} · ` +
      `no-count-line: ${unstarted.length}`
  );
  for (const u of unstarted) console.log(`    ⚠ ${u.path} printed no count line (exit ${u.exit})`);
  return unstarted.length > 0 ? 1 : 0;
}

function load(p: string): {
  header: string;
  provenance: Provenance;
  rows: Map<string, Row>;
  causeRecorded: boolean;
} {
  const lines = readFileSync(resolve(p), "utf8").trimEnd().split("\n");
  const header = lines[0].startsWith(POPULATION_HEADER) ? lines[0] : "#population UNRECORDED";
  // ⚠ COUNT THE COMMENT LINES, never assume one. An arm written before the
  //   provenance header existed has a single `#` line; one written after has two.
  //   Hard-coding the skip is how an old arm's first data row becomes a header.
  const comments = lines.filter((l) => l.startsWith("#")).length;
  const provenance = parseProvenance(lines.find((l) => l.startsWith(PROVENANCE_HEADER)));
  const rows = new Map<string, Row>();
  let widths = new Set<number>();
  for (const l of lines.slice(comments)) {
    const f = l.split("\t");
    widths.add(f.length);
    const [path, exit, counts] = f;
    // ⚠ AN ARM TAKEN BEFORE THE CAUSE COLUMN EXISTED HAS THREE FIELDS, and the
    //   absent column must read UNRECORDED rather than `-`. `-` is a measurement
    //   ("the door said nothing"); absence is the lack of one, and collapsing them
    //   would let an old arm assert a cause it never looked for.
    rows.set(path, {
      path,
      exit: Number(exit),
      counts,
      doorDrift: f.length >= 4 ? f[3] : "UNRECORDED",
    });
  }
  const causeRecorded = widths.size > 0 && [...widths].every((w) => w >= 4);
  return { header, provenance, rows, causeRecorded };
}

function gitModifiedUnderCore(): string[] {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], { cwd: REPO, encoding: "utf8" });
    return out
      .split("\n")
      .map((l) => l.slice(3).trim())
      .filter((p) => p.startsWith("src/mica/"))
      .sort();
  } catch {
    return [];
  }
}

/**
 * The files under src/mica/** a COMMITTED branch changed against `baseRev`.
 *
 * ⛔ WHY THIS EXISTS. `gitModifiedUnderCore` reads `git status`, which is empty
 *    once the branch is committed — and an empty `git status` means EITHER
 *    "nothing was edited" OR "it is already committed". The derivation picked
 *    the first and said nothing. Measured on T16 (2026-10-02): the branch edits
 *    13 files under src/mica/ and only 4 of their suites change COUNT, so the
 *    silent derivation printed 4 and omitted 9 — a short `opens` list is a door
 *    REFUSAL on the files it left out, discovered at install time.
 */
function gitCommittedUnderCore(baseRev: string): string[] {
  const out = execFileSync("git", ["diff", "--name-only", `${baseRev}..HEAD`], {
    cwd: REPO,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((p) => p.startsWith("src/mica/"))
    .sort();
}

function doCompare(basePath: string, candPath: string, baseRev?: string): number {
  const base = load(basePath);
  const cand = load(candPath);
  console.log(`  BASE      ${base.header.replace(/\t/g, "  ")}`);
  console.log(`            ${base.provenance.line.replace(/\t/g, "  ")}`);
  console.log(`  CANDIDATE ${cand.header.replace(/\t/g, "  ")}`);
  console.log(`            ${cand.provenance.line.replace(/\t/g, "  ")}`);

  // ── THE PROVENANCE GATE ──────────────────────────────────────────────────
  //
  // ⛔ TWO ARMS ARE COMPARABLE ONLY IF THEY WERE TAKEN THE SAME WAY, and until
  //    this gate existed nothing in either file said how it was taken. Both of
  //    the near-misses are in `provenanceNow`'s docblock; the second one — one
  //    archive arm against one worktree arm — would have put a suite in a moved
  //    list for no reason but the shape of the directory it ran in.
  //
  // ⚠ AN UNRECORDED ARM IS WARNED ABOUT AND NOT REFUSED. Every arm captured
  //   before this commit lacks the header, and refusing them would make today's
  //   measurements unusable to settle a question they can still settle — the
  //   population header's own precedent, one block down, takes the same line.
  //   A KNOWN MISMATCH is a different thing and is refused.
  const bp = base.provenance;
  const cp = cand.provenance;
  if (bp.recorded && cp.recorded) {
    if (bp.tree !== cp.tree) {
      console.log(`  ⛔ REFUSED: the two arms were taken in DIFFERENT KINDS OF TREE — base=${bp.tree}, candidate=${cp.tree}.`);
      console.log("     A `git archive` has no `.git`, so a suite that reads git state behaves");
      console.log("     differently there: src/registrar/refusal-log.test.ts asserts a sha and");
      console.log("     fails in an archive while reading 37/37 in a worktree at the SAME commit.");
      console.log("     Any suite like it appears as a MOVER for no reason but the directory.");
      console.log("     Re-take both arms the same way — worktrees, for a comparison.");
      return 2;
    }
    if (bp.tool !== cp.tool) {
      console.log(`  ⛔ REFUSED: the two arms were taken by DIFFERENT VERSIONS OF THIS TOOL — base=${bp.tool}, candidate=${cp.tool}.`);
      console.log("     56 worktrees exist under ~/mica-wt and any of them can run a sweep; an");
      console.log("     arm from a stale copy is a measurement by a different instrument.");
      return 2;
    }
    if (bp.dirty === "yes") {
      console.log("  ⚠ the BASE arm was taken in a DIRTY tree, so it does not describe its own commit.");
    }
  }
  if (baseRev !== undefined && bp.recorded && bp.commit !== "NONE") {
    let resolved: string | null = null;
    try {
      resolved = execFileSync("git", ["-C", REPO, "rev-parse", baseRev], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch { resolved = null; }
    if (resolved !== null && resolved !== bp.commit) {
      console.log(`  ⛔ REFUSED: --base ${baseRev} resolves to ${resolved.slice(0, 7)} but the BASE ARM was taken at ${bp.commit.slice(0, 7)}.`);
      console.log("     The edited half would be measured from one commit and the count half from");
      console.log("     another, so a suite moved by a commit BETWEEN them reads as this act's.");
      console.log("     Measured 2026-10-03: exactly that put preflight.test.ts in a comparison it");
      console.log("     had no part in. Re-take the base arm at the revision you are naming.");
      return 2;
    }
  }
  // ⛔ AN UNRECORDED POPULATION IS NOT A MATCHING ONE, and the first version of
  //    this check said it was: two runs both lacking a header compared EQUAL and
  //    the warning stayed silent. That is the defect this repository keeps
  //    finding — a value that cannot tell two cases apart, followed by a verdict
  //    that picks one. Caught by running the compare over two hand-made sweeps
  //    from 2026-10-01, which is exactly the case it will meet most often.
  const unrecorded = [base.header, cand.header].filter((h) => h.includes("UNRECORDED")).length;
  if (unrecorded > 0) {
    console.log(`  ⛔ ${unrecorded} of the 2 runs DID NOT RECORD ITS POPULATION. The comparison below`);
    console.log("     says what the two files agree about and NOTHING about what either covered.");
    console.log("     A sweep whose population is unknown cannot support a `opens` derivation —");
    console.log("     re-run it with this tool, which writes the header from the protocol.");
  } else if (base.header !== cand.header) {
    console.log("  ⛔ THE TWO RUNS SWEPT DIFFERENT POPULATIONS. The comparison below is not");
    console.log("     base-vs-candidate; it is one population against another, and a suite that");
    console.log("     exists on one side only will read as 'moved'. Re-run both, or say so.");
  }
  const all = [...new Set([...base.rows.keys(), ...cand.rows.keys()])].sort();
  const moved: string[] = [];
  // ⛔ A register-excluded suite was NEVER RUN, so it cannot have moved and it
  //    cannot have held. It is counted apart on both lines rather than folded
  //    into "identical", because folding it in would let an excluded red read as
  //    a pass — the exact substitution the register exists to prevent.
  // ⛔ A SUITE THAT PRINTS NO COUNT IS NOT COMPARABLE EITHER, AND UNTIL NOW IT WAS
  //    COUNTED AS IF IT WERE. `--run` has always WARNED about these — four of them
  //    in the declared population all day (clerk, l0-clerk-f3, review-cli,
  //    dry-well-gauge) — and `--compare` then folded them into "identical" because
  //    NO-COUNT-LINE equals NO-COUNT-LINE. So "105 of 107 identical" was really
  //    "105 of 103 comparable, plus 4 nobody can compare", and a WARNING THAT NO
  //    COMPARISON CONSUMES is the shape this whole directory exists to refuse.
  //
  //    They are now counted apart, exactly as the register-excluded rows are: two
  //    sentences, because "it agreed" and "it said nothing" are different facts.
  const excluded = all.filter(
    (p) => base.rows.get(p)?.counts === EXCLUDED_MARKER || cand.rows.get(p)?.counts === EXCLUDED_MARKER
  );
  const countless = all.filter(
    (p) =>
      !excluded.includes(p) &&
      ((base.rows.get(p)?.counts ?? "").startsWith("NO-") || (cand.rows.get(p)?.counts ?? "").startsWith("NO-"))
  );
  const notComparable = [...excluded, ...countless];
  const comparable = all.filter((p) => !notComparable.includes(p));
  for (const p of comparable) {
    const b = base.rows.get(p);
    const c = cand.rows.get(p);
    if (!b || !c || b.counts !== c.counts) {
      moved.push(p);
      console.log(`  MOVED  ${p}\n           base: ${b?.counts ?? "ABSENT"}\n           cand: ${c?.counts ?? "ABSENT"}`);
    }
  }
  for (const p of excluded) {
    console.log(`  ⊘ NOT COMPARABLE  ${p}  (flaky register — never run on at least one side)`);
  }
  for (const p of countless) {
    const b = base.rows.get(p);
    const c = cand.rows.get(p);
    console.log(
      `  ⊘ NOT COMPARABLE  ${p}  (printed NO COUNT LINE — base exit=${b?.exit ?? "?"}, ` +
        `cand exit=${c?.exit ?? "?"}; a suite that says nothing cannot be said to agree)`
    );
  }
  console.log(
    `\n  ${comparable.length - moved.length} of ${comparable.length} comparable identical · ` +
      `${moved.length} moved · ${excluded.length} register-excluded · ` +
      `${countless.length} printed no count line (of ${all.length} in the population)`
  );

  // ── the derivation ────────────────────────────────────────────────────────
  //
  // `opens` is not "the suites that moved". It is the files under src/mica/**
  // that this change must be allowed to edit: the ones already edited, plus the
  // ones whose suites moved and will therefore need editing.
  //
  // ⚠ core-door.test.ts and glue.test.ts move for a THIRD reason and are named
  //   here rather than filtered silently: they contain the door's own check, so
  //   they move whenever src/mica/** has drifted without a live ticket. That is
  //   the door objecting to the absence of the very ticket being drafted, and it
  //   is cleared by the repin — not by opening them.
  // ⚠ NO LONGER THE CLASSIFIER — now an ASSERTION ABOUT THE DERIVATION. The set
  //   used to decide which movers were the door objecting; it is kept only so a
  //   difference between the named set and the DERIVED one is reported. A new
  //   consumer of the pin appearing here is legitimate and gets a notice, not a
  //   refusal; a named suite that moved WITHOUT objecting is the case that put a
  //   wrong caption on a real change, and it gets a notice too.
  const NAMED_DOOR_MOVERS = new Set([
    "src/core-door/core-door.test.ts",
    "src/glue/glue.test.ts",
  ]);
  const uncommitted = gitModifiedUnderCore();
  // ⛔ A --base EQUAL TO HEAD IS NEVER THE RIGHT ANSWER, AND IT FAILS SILENTLY.
  //    `gitCommittedUnderCore(HEAD)` diffs HEAD..HEAD and returns nothing, so the
  //    EDITED half of the derivation is empty and the list comes back short with no
  //    sign that anything was missed. Measured 2026-10-03 on T19: `--base <tip>`
  //    derived ONE file, `--base <the tip the work started from>` derived TWO, and
  //    the grant was two. T18's blocker was the same rule in the other direction —
  //    a base too OLD attributes the previous ticket's edits to the next one.
  //
  //    THE BASE IS THE TIP THE WORK STARTED FROM. A ruling, 2026-10-03 11:23Z, and
  //    this is it made mechanical rather than remembered.
  if (baseRev !== undefined) {
    let head = "";
    try {
      head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
    } catch {
      head = "";
    }
    let resolved = "";
    try {
      resolved = execFileSync("git", ["rev-parse", `${baseRev}^{commit}`], { cwd: REPO, encoding: "utf8" }).trim();
    } catch {
      resolved = "";
    }
    if (head !== "" && resolved === head) {
      console.log(`  ⛔ REFUSED: --base ${baseRev} resolves to HEAD (${head.slice(0, 7)}).`);
      console.log("     HEAD..HEAD is empty, so the EDITED half of the derivation would be");
      console.log("     silently empty and the `opens` list short. The base is the tip the WORK");
      console.log("     STARTED FROM — for a landed act, its ticket's base, not its tip.");
      return 2;
    }
  }
  const committed = baseRev === undefined ? [] : gitCommittedUnderCore(baseRev);
  const edited = [...new Set([...uncommitted, ...committed])].sort();
  // ⛔ AN EMPTY `git status` IS NOT "NOTHING WAS EDITED". Say which case it is,
  //    because the two produce the same silence and only one of them is safe.
  if (uncommitted.length === 0 && baseRev === undefined) {
    console.log("  ⛔ NO UNCOMMITTED CHANGE UNDER src/mica/** AND NO --base GIVEN.");
    console.log("     If this branch is COMMITTED, the list below carries only the suites whose");
    console.log("     COUNT moved and silently omits every file edited without a count change.");
    console.log("     Re-run as: --compare <base.tsv> <cand.tsv> --base <rev>   (the branch point)");
  }
  const movedCore = moved.filter((p) => p.startsWith("src/mica/"));
  // ── THE DOOR-OBJECTION CLASS, DERIVED FROM WHAT THE SUITE SAID ─────────────
  //
  // A mover is the door objecting iff ITS OWN RUN recorded the door's refusal. The
  // cause comes from the candidate arm (where the uncommitted edit exists), never
  // from the path, and an arm taken before the column existed cannot answer — so it
  // falls back to the named set and SAYS SO, rather than reading UNRECORDED as "no".
  const causeFrom = (p: string): string => cand.rows.get(p)?.doorDrift ?? "UNRECORDED";
  const derivedDoorMovers = moved.filter((p) => causeFrom(p).startsWith("DOOR-"));
  const doorMovers = cand.causeRecorded ? derivedDoorMovers : moved.filter((p) => NAMED_DOOR_MOVERS.has(p));
  const doorMoverSet = new Set(doorMovers);
  const outside = moved.filter((p) => !p.startsWith("src/mica/") && !doorMoverSet.has(p));
  const opens = [...new Set([...edited, ...movedCore])].sort();

  console.log("\n  ── paste into the ticket's receipt ──────────────────────────────");
  if (unrecorded > 0) {
    console.log("  ⛔ DO NOT PASTE THIS AS A DERIVATION — the population is unrecorded (see above).");
  }
  console.log(`  POPULATION  ${cand.header.replace(/#population\t/, "").replace(/\t/g, " · ")}`);
  console.log(
    `  identical   ${comparable.length - moved.length} of ${comparable.length} comparable` +
      // ⚠ AND THE TWO CAUSES ARE NAMED SEPARATELY HERE TOO. The first version of
      //   this line called all of them "register-excluded" — including the four that
      //   are merely count-less — which is a caption naming the wrong cause, in the
      //   commit that exists to stop a caption naming the wrong cause.
      (excluded.length ? `  ⊘ ${excluded.length} register-excluded` : "") +
      (countless.length ? `  ⊘ ${countless.length} printed no count line` : "") +
      (notComparable.length ? `, NOT covered by this derivation` : "")
  );
  console.log(`  DERIVED opens (${opens.length}):`);
  for (const p of opens) {
    const how = uncommitted.includes(p)
      ? "   (edited, uncommitted)"
      : committed.includes(p)
        ? `   (edited, committed since ${baseRev ?? "?"})`
        : "   (its suite moved)";
    console.log(`    ${p}${how}`);
  }
  if (!cand.causeRecorded) {
    console.log(
      "  ⚠ THE CANDIDATE ARM RECORDS NO CAUSE COLUMN (taken before it existed), so the"
    );
    console.log(
      "    door-objection class below falls back to a NAMED set of two paths. That set put"
    );
    console.log(
      "    a wrong caption on a real change once; re-take the arm to derive it instead."
    );
  }
  if (doorMovers.length) {
    console.log(`  the door objecting to no-live-ticket, cleared by the repin, NOT opened:`);
    for (const p of doorMovers) {
      const why = cand.causeRecorded ? `   (${causeFrom(p)})` : "   (by NAME — cause unrecorded)";
      console.log(`    ${p}${why}`);
    }
  }
  // ⛔ THE NAMED SET AS A CHECK ON THE DERIVATION, which is the only job it has
  //    left. Both differences are worth a line and neither is a refusal.
  if (cand.causeRecorded) {
    const derived = new Set(derivedDoorMovers);
    const appeared = [...derived].filter((p) => !NAMED_DOOR_MOVERS.has(p));
    const silent = moved.filter((p) => NAMED_DOOR_MOVERS.has(p) && !derived.has(p));
    if (appeared.length) {
      console.log(`  ⓘ a consumer of the pin that the named set did not know about: ${appeared.join(", ")}`);
    }
    if (silent.length) {
      console.log(
        `  ⚠ MOVED WITHOUT OBJECTING, so the old NAME-based caption would have mislabelled it: ${silent.join(", ")}`
      );
      console.log("    its count moved for its own reasons; the door said nothing about it.");
    }
  }
  if (outside.length) {
    console.log(`  ⚠ MOVED OUTSIDE src/mica/** — its own commit, NOT this ticket's:`);
    for (const p of outside) console.log(`    ${p}`);
  }
  return 0;
}

// ⛔ THE CLI BODY RUNS ONLY AS A CLI, AND THIS GUARD WAS MISSING UNTIL AN IMPORT
//    FOUND IT. `tools/ticket-preflight/preflight.ts` carries the same guard with the
//    same reasoning in its header — "Imported — by its own test, or by anything else
//    — this module must not read argv, print a census or call process.exit." This
//    file had no such guard, so the first `import { tsvBody } from "./opens-sweep"`
//    ran the CLI, fell through to the usage branch and exited 2: a test suite that
//    could not import its own subject, failing in a way that looked like the suite.
//
// ⚠ TWO TOOLS IN ONE DIRECTORY, ONE WITH THE GUARD AND ONE WITHOUT, AND THE ONE
//   WITHOUT IS THE OLDER. The sibling solved it, documented it, and nothing carried
//   the solution across — which is the same seam as the hand-rolled cell key T22
//   repaired: a shared lesson living in one file only.
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === "--run" && argv[1]) process.exit(doRun(argv[1]));
  if (argv[0] === "--compare" && argv[1] && argv[2]) {
    const i = argv.indexOf("--base");
    process.exit(doCompare(argv[1], argv[2], i >= 0 ? argv[i + 1] : undefined));
  }
  console.error(
    "usage: opens-sweep.ts --run <out.tsv> | --compare <base.tsv> <cand.tsv> [--base <rev>]"
  );
  process.exit(2);
}
