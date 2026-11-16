// ── MICA · the arbiter's ruling log — acceptance tests ───────────────────────
//
// The book, the anchor, and the one-shot CLI that drives both. What is asserted
// here is what the arbiter's seat actually buys: rewriting a ruling breaks the
// chain, the modality is IN the preimage on both sides of the wire, and the tool
// never claims a witness kept anything.

import assert from "assert";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { spawnSync } from "child_process";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { Witness } from "../witness/witness";
import { fileDropCommitter } from "../witness/drop-committer";
import {
  appendOneRuling,
  missingRequired,
  parseArgs,
  readRulingText,
  SUBMISSION_IS_NOT_RETENTION_LINE,
  usage,
} from "./arbiter-log";
import {
  ArbiterDeploymentActMissing,
  cannotSeeRulingLogMessage,
  lookAtRulingLogFile,
  computeRulingRecordHash,
  MODALITIES,
  RulingLog,
  SUBMISSION_IS_NOT_RETENTION,
  THE_WITNESS_TRAIL_IS_A_SAMPLE,
  validateRulingLogRecord,
} from "./ruling-log";
import type { RulingLogRecord } from "./ruling-log";

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

const root = mkdtempSync(join(tmpdir(), "mica-arbiter-"));
let counter = 0;

/**
 * The temp tree. `mkdirSync(base)` here IS recipe §5B.2 rendered in a test — the
 * book's directory, made by a deployer, before any book opens on it.
 *
 * Since S97-A the arbiter does not create it, so every body below depends on
 * this line. The S97 bodies at the end of the file deliberately DO NOT use this
 * helper: a negative test that leans on the fixture proving the positive case
 * checks nothing (S97 receipt §E.2, the witness `paths()` finding, same shape).
 */
function scratch(stem: string): { base: string; store: string; intake: string } {
  const base = join(root, `${stem}-${counter++}`);
  mkdirSync(base, { recursive: true });
  return { base, store: join(base, "rulings.jsonl"), intake: join(base, "intake") };
}

/** Source with comments removed, so a fence can be about CALLS, not words. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** A clock the CALLER owns. The module never has one; see ruling-log.ts. */
function clock(start = 1_000): () => number {
  let t = start;
  return () => t++;
}

function lines(path: string): RulingLogRecord[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as RulingLogRecord);
}

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the book · chain, shape, and the modality in the preimage ──");

check("RL-A · an appended ruling carries its text, its modality, and chains", () => {
  const s = scratch("append");
  const log = new RulingLog({ path: s.store });
  const out = log.record({
    timestamp: 1_700_000_000_000,
    rulingText: "the third modality value is ruled as proposed",
    modality: "IMPOSED",
  });

  assert.strictEqual(out.persisted, true);
  assert.strictEqual(out.record.sequenceNumber, 0);
  assert.strictEqual(out.record.previousHash, "");
  assert.strictEqual(out.record.modality, "IMPOSED");
  assert.strictEqual(
    out.record.rulingText,
    "the third modality value is ruled as proposed"
  );
  assert.deepStrictEqual(log.verify(), { valid: true, brokenAt: null });
});

check("RL-B · THE FLIP TEST — a modality edited on disk breaks verify() at that seq", () => {
  // The same trap the witness has to avoid on the other side of the wire. A
  // modality stored but not hashed could be rewritten from IMPOSED to OFFERED
  // with the chain still verifying: the exact false attestation this book
  // exists to make loud.
  const s = scratch("flip-modality");
  const log = new RulingLog({ path: s.store });
  log.record({ timestamp: 1, rulingText: "first", modality: "OFFERED" });
  log.record({ timestamp: 2, rulingText: "second", modality: "IMPOSED" });
  log.record({ timestamp: 3, rulingText: "third", modality: "OFFERED" });

  const raw = lines(s.store);
  assert.strictEqual(raw[1].modality, "IMPOSED");
  raw[1] = { ...raw[1], modality: "OFFERED" };
  writeFileSync(s.store, raw.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

  const reloaded = new RulingLog({ path: s.store });
  assert.strictEqual(reloaded.getLoadState(), "CANNOT_VERIFY");
  assert.ok((reloaded.getLastError() ?? "").includes("index 1"));
});

check("RL-C · THE TEXT IS IN THE PREIMAGE — rewriting a ruling breaks the chain", () => {
  // R2 keeps content out of the WITNESS, not out of the author's own book. This
  // is the reason the content belongs here: a chain over {sequence, hash} alone
  // would let every ruling's text be rewritten freely and still verify.
  const s = scratch("flip-text");
  const log = new RulingLog({ path: s.store });
  log.record({ timestamp: 1, rulingText: "the answer is no", modality: "IMPOSED" });

  const raw = lines(s.store);
  raw[0] = { ...raw[0], rulingText: "the answer is yes" };
  writeFileSync(s.store, JSON.stringify(raw[0]) + "\n", "utf8");

  const reloaded = new RulingLog({ path: s.store });
  assert.strictEqual(reloaded.getLoadState(), "CANNOT_VERIFY");
});

check("RL-D · the preimage is LENGTH-PREFIXED, so text cannot cross a field boundary", () => {
  // Two rulings whose texts differ only in where a boundary falls. Without the
  // length prefix a joined preimage would collide and the two would be
  // indistinguishable in the chain.
  const base = { sequenceNumber: 0, previousHash: "", timestamp: 1 } as const;
  const a = computeRulingRecordHash({ ...base, rulingText: "ab", modality: "OFFERED" });
  const b = computeRulingRecordHash({ ...base, rulingText: "a", modality: "OFFERED" });
  assert.notStrictEqual(a, b);
  // And the modality is a distinguishing field in its own right.
  const c = computeRulingRecordHash({ ...base, rulingText: "ab", modality: "IMPOSED" });
  assert.notStrictEqual(a, c);
});

check("RL-E · the closed schema rejects an unknown key, a bad modality, and a bad type", () => {
  const good = {
    timestamp: 1,
    rulingText: "x",
    modality: "OFFERED",
    sequenceNumber: 0,
    previousHash: "",
    hash: "h",
  };
  assert.notStrictEqual(validateRulingLogRecord(good), null);
  assert.strictEqual(validateRulingLogRecord({ ...good, extra: 1 }), null);
  assert.strictEqual(validateRulingLogRecord({ ...good, modality: "COERCED" }), null);
  assert.strictEqual(validateRulingLogRecord({ ...good, modality: "offered" }), null);
  assert.strictEqual(validateRulingLogRecord({ ...good, rulingText: 7 }), null);
  assert.strictEqual(validateRulingLogRecord({ ...good, sequenceNumber: -1 }), null);
});

check("RL-F · NO PATH means IN MEMORY, reported — integrity without provenance", () => {
  const log = new RulingLog();
  const out = log.record({ timestamp: 1, rulingText: "unheld", modality: "OFFERED" });
  assert.strictEqual(out.persisted, false);
  assert.ok((out.detail ?? "").includes("IN MEMORY"));
  assert.strictEqual(log.getLoadState(), "IN_MEMORY");
  assert.strictEqual(log.hasDeclaredPath, false);
  // Integrity still holds; provenance is what is absent.
  assert.deepStrictEqual(log.verify(), { valid: true, brokenAt: null });
});

check("RL-G · a SECOND process appends contiguously — the re-sync adopts the true head", () => {
  // The normal case for a ONE-SHOT CLI, not the exotic one: every invocation is
  // a fresh process whose loaded chain may already be a stale prefix.
  const s = scratch("two-shots");
  new RulingLog({ path: s.store }).record({
    timestamp: 1,
    rulingText: "first",
    modality: "OFFERED",
  });
  const second = new RulingLog({ path: s.store });
  assert.strictEqual(second.getLoadState(), "LOADED_VERIFIED");
  const out = second.record({ timestamp: 2, rulingText: "second", modality: "IMPOSED" });

  assert.strictEqual(out.record.sequenceNumber, 1);
  assert.deepStrictEqual(second.verify(), { valid: true, brokenAt: null });
  assert.deepStrictEqual(lines(s.store).map((r) => r.rulingText), ["first", "second"]);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the anchor · post-durable, try/caught, and never a gate ────");

check("RL-H · the head is committed ONLY after the append durably landed", () => {
  const s = scratch("post-durable");
  const commits: unknown[] = [];
  const log = new RulingLog({
    path: s.store,
    witnessSetId: "set-alpha",
    headCommitter: (commit) => commits.push(commit),
    appender: () => {
      throw new Error("ENOSPC");
    },
  });
  const out = log.record({ timestamp: 1, rulingText: "unheld", modality: "IMPOSED" });

  assert.strictEqual(out.persisted, false);
  assert.strictEqual(out.headCommitted, false);
  assert.deepStrictEqual(commits, [], "a head over a record that never landed names nothing");
  assert.ok((out.headCommitDetail ?? "").includes("not durably persisted"));
});

check("RL-I · a committer that THROWS leaves the book intact and the reason retained", () => {
  const s = scratch("committer-throws");
  const log = new RulingLog({
    path: s.store,
    headCommitter: () => {
      throw new Error("the intake was never deployed");
    },
  });
  const out = log.record({ timestamp: 1, rulingText: "held anyway", modality: "OFFERED" });

  assert.strictEqual(out.persisted, true, "the ruling is written; the witness is not a gate");
  assert.strictEqual(out.headCommitted, false);
  assert.ok((out.headCommitDetail ?? "").includes("never deployed"));
  assert.strictEqual(log.length, 1);
  assert.deepStrictEqual(log.verify(), { valid: true, brokenAt: null });
});

check("RL-J · the head carries the modality OF THAT ENTRY, and ts is the sequence", () => {
  // Per entry, not per committer: one ruling offered and the next imposed,
  // through ONE committer, in one process. A committer configured with a
  // modality could not express this.
  const s = scratch("per-entry");
  const commits: { seq_no: number; ts: number; modality: string }[] = [];
  const log = new RulingLog({
    path: s.store,
    witnessSetId: "set-alpha",
    headCommitter: (c) => commits.push({ seq_no: c.seq_no, ts: c.ts, modality: c.modality }),
  });
  log.record({ timestamp: 1_700_000_000_000, rulingText: "a", modality: "OFFERED" });
  log.record({ timestamp: 1_700_000_000_001, rulingText: "b", modality: "IMPOSED" });

  assert.deepStrictEqual(commits, [
    { seq_no: 0, ts: 0, modality: "OFFERED" },
    { seq_no: 1, ts: 1, modality: "IMPOSED" },
  ]);
  // `ts` is the record's own index and NOT the arbiter's wall clock: this book
  // authors no second time about itself. The wall clock lives in the record.
  assert.deepStrictEqual(lines(s.store).map((r) => r.timestamp), [
    1_700_000_000_000,
    1_700_000_000_001,
  ]);
});

check("RL-K · END TO END — an IMPOSED ruling arrives at a witness as an IMPOSED head", () => {
  const s = scratch("end-to-end");
  // The producer does NOT create the intake. The intake's permissions are a
  // deployment act (`3730`, group `mica-drops`), never guessed by a submitter.
  mkdirSync(s.intake, { recursive: true });
  const log = new RulingLog({
    path: s.store,
    witnessSetId: "set-alpha",
    headCommitter: fileDropCommitter(s.intake, "mica-arbiter"),
  });
  const out = log.record({
    timestamp: 1_700_000_000_000,
    rulingText: "the fence stands",
    modality: "IMPOSED",
  });
  assert.strictEqual(out.headCommitted, true);
  assert.deepStrictEqual(readdirSync(s.intake), ["mica-arbiter"]);

  const witness = new Witness({
    witnessSetId: "set-alpha",
    storePath: join(s.base, "witness.jsonl"),
    outboxDir: join(s.base, "outbox"),
    intakeDir: s.intake,
    declaredSubmitters: ["mica-arbiter"],
    witnessClock: () => 5_000,
  });
  const [result] = witness.pollIntake();

  assert.strictEqual(result.record.kind, "HEAD_COMMIT");
  assert.strictEqual(result.record.witnessed.modality, "IMPOSED");
  // The retained head IS this book's entry hash — that is the whole anchor.
  assert.strictEqual(result.record.witnessed.head_hash, out.record.hash);
  assert.strictEqual(result.record.witnessed.seq_no, 0);
  assert.deepStrictEqual(witness.verify(), { valid: true, brokenAt: null });

  // R2, at bytes: the ruling TEXT reached no witness record.
  const retained = readFileSync(join(s.base, "witness.jsonl"), "utf8");
  assert.ok(!retained.includes("the fence stands"));
  assert.ok(!retained.includes("rulingText"));
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the one-shot CLI · run as the role, and it claims nothing ──");

check("RL-L · every required argument is required and NONE is guessed", () => {
  assert.deepStrictEqual(missingRequired(parseArgs([])), [
    "--store",
    "--intake",
    "--witness-set-id",
    "--submitter-id",
    "--modality",
  ]);
  assert.deepStrictEqual(
    missingRequired(
      parseArgs([
        "--store", "s", "--intake", "i", "--witness-set-id", "w",
        "--submitter-id", "id", "--modality", "IMPOSED",
      ])
    ),
    []
  );
});

check("RL-M · a modality outside the enum is refused AT THE FRONT DOOR", () => {
  // Refusing here costs a retype. Letting it through costs an append whose head
  // the intake retains as MALFORMED_SUBMISSION — the arbiter's own act, in an
  // append-only book, permanently recorded as malformed bytes, over one typo.
  const args = parseArgs([
    "--store", "s", "--intake", "i", "--witness-set-id", "w",
    "--submitter-id", "id", "--modality", "offered",
  ]);
  const missing = missingRequired(args);
  assert.strictEqual(missing.length, 1);
  assert.ok(missing[0].includes("--modality"));
  assert.ok(missing[0].includes("offered"));
  for (const m of MODALITIES) assert.ok(missing[0].includes(m));
});

check("RL-N · the ruling text is the argv tail, or stdin when the tail is empty", () => {
  const withTail = parseArgs(["--store", "s", "the", "ruling", "text"]);
  assert.strictEqual(withTail.text, "the ruling text");
  assert.strictEqual(readRulingText(withTail), "the ruling text");

  const s = scratch("stdin");
  const stdin = join(s.base, "stdin.txt");
  writeFileSync(stdin, "a ruling from a pipe", "utf8");
  const noTail = parseArgs(["--store", "s"]);
  assert.strictEqual(noTail.text, null);
  assert.strictEqual(readRulingText(noTail, stdin), "a ruling from a pipe");
});

check("RL-O · the tool prints the seq, the drop path, and the standing line", () => {
  const s = scratch("cli-happy");
  mkdirSync(s.intake, { recursive: true });
  const out = appendOneRuling({
    storePath: s.store,
    intakeDir: s.intake,
    witnessSetId: "set-alpha",
    submitterId: "mica-arbiter",
    modality: "IMPOSED",
    rulingText: "the third value is ruled",
    now: clock(),
  }).join("\n");

  assert.ok(out.includes("appended seq : 0"));
  assert.ok(out.includes("modality     : IMPOSED"));
  assert.ok(out.includes(`drop written : ${join(s.intake, "mica-arbiter")}`));
  // IT NEVER CLAIMS A WITNESS KEPT ANYTHING — on the SUCCESS path especially.
  assert.ok(out.includes(SUBMISSION_IS_NOT_RETENTION_LINE));
  assert.ok(out.includes(THE_WITNESS_TRAIL_IS_A_SAMPLE));
  assert.ok(!out.toLowerCase().includes("retained by"));
});

check("RL-P · a MISSING intake is reported, and the ruling is written anyway", () => {
  // The producer does not create an intake — the digits are a deployment act. A
  // deployer who skipped it learns so HERE, and the arbiter's ruling is still in
  // the book: a witness that cannot be reached is not a reason to lose a ruling.
  const s = scratch("cli-no-intake");
  const out = appendOneRuling({
    storePath: s.store,
    intakeDir: s.intake,
    witnessSetId: "set-alpha",
    submitterId: "mica-arbiter",
    modality: "OFFERED",
    rulingText: "written regardless",
    now: clock(),
  }).join("\n");

  assert.ok(out.includes("drop NOT written"));
  assert.ok(out.includes("ENOENT"));
  assert.strictEqual(existsSync(s.intake), false, "and the intake was NOT conjured");
  assert.deepStrictEqual(lines(s.store).map((r) => r.rulingText), ["written regardless"]);
});

check("RL-Q · usage names every argument and the role it is run as", () => {
  const text = usage();
  for (const flag of [
    "--store",
    "--intake",
    "--witness-set-id",
    "--submitter-id",
    "--modality",
  ]) {
    assert.ok(text.includes(flag), `usage omits ${flag}`);
  }
  assert.ok(text.includes("mica-arbiter"), "R12: it is run AS THE ROLE");
  for (const m of MODALITIES) assert.ok(text.includes(m));
});

check("RL-R · the ceilings are exported, non-empty, and claim nothing positive", () => {
  for (const line of [
    SUBMISSION_IS_NOT_RETENTION,
    THE_WITNESS_TRAIL_IS_A_SAMPLE,
    SUBMISSION_IS_NOT_RETENTION_LINE,
  ]) {
    assert.ok(line.length > 80, "a ceiling line got trimmed to a slogan");
  }
  assert.ok(THE_WITNESS_TRAIL_IS_A_SAMPLE.includes("SAMPLE"));
  assert.ok(SUBMISSION_IS_NOT_RETENTION.includes("cannot prove"));
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── §5B.2 · the book's directory is a DEPLOYMENT ACT this book will not perform ──");

check("RL-S · an absent book directory throws, and the message is a SIGNPOST", () => {
  // Built by hand, NOT through scratch(): that helper performs §5B.2, which is
  // the act this body needs unperformed.
  const base = join(root, `s97-absent-book-${counter++}`);
  const neverMade = join(base, "arbiter");
  assert.strictEqual(existsSync(base), false, "the test's own premise moved");

  let caught: unknown = null;
  try {
    new RulingLog({ path: join(neverMade, "rulings.jsonl") });
  } catch (error) {
    caught = error;
  }

  // ASSERT ON THE OUTPUT, NEVER ON "IT THREW": each signpost element on its own
  // line, so a message that keeps the shape and loses a part fails here.
  assert.ok(caught instanceof ArbiterDeploymentActMissing, `wrong error type: ${String(caught)}`);
  const message = (caught as Error).message;
  assert.ok(message.includes("arbiter ruling-log directory absent"), message);
  assert.ok(message.includes("this is a deployment act"), message);      // the act
  assert.ok(message.includes("deploy recipe §5B.2"), message);           // the section
  assert.ok(
    message.includes(`${neverMade} at 2750 mica-arbiter:mica-readers`),
    message
  );                                                                      // the expected state
  assert.ok(message.includes("Nothing was created"), message);
  assert.strictEqual((caught as ArbiterDeploymentActMissing).path, neverMade);
});

check("RL-T · NOTHING is created and the book does not come up half-made", () => {
  const base = join(root, `s97-absent-book-${counter++}`);
  const neverMade = join(base, "arbiter");
  const store = join(neverMade, "rulings.jsonl");
  mkdirSync(base, { recursive: true });   // the PARENT exists; the book's dir does not

  assert.throws(() => new RulingLog({ path: store }), ArbiterDeploymentActMissing);

  // The throw is half the claim; the disk is the other half. `recursive: true`
  // would have made the directory AND left a book running non-persisting on it.
  assert.strictEqual(existsSync(neverMade), false, "the book directory was created after all");
  assert.strictEqual(existsSync(store), false, "a book file was created after all");
  assert.deepStrictEqual(readdirSync(base), [], "something was written beside the book");
});

check("RL-U · a book path whose parent is a FILE is refused too, and says so", () => {
  const base = join(root, `s97-book-parent-is-a-file-${counter++}`);
  mkdirSync(base, { recursive: true });
  const notADirectory = join(base, "arbiter");
  writeFileSync(notADirectory, "a file, not the deployment act\n", "utf8");

  let caught: unknown = null;
  try {
    new RulingLog({ path: join(notADirectory, "rulings.jsonl") });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ArbiterDeploymentActMissing, `wrong error type: ${String(caught)}`);
  assert.ok(
    (caught as Error).message.includes("exists and is not a directory"),
    (caught as Error).message
  );
  assert.strictEqual(
    readFileSync(notADirectory, "utf8"),
    "a file, not the deployment act\n",
    "the file standing where the directory belongs was touched"
  );
});

check("RL-V · THE BOUNDARY — a missing PRECONDITION throws; a fact ABOUT THE BOOK still limps", () => {
  // The whole of the S97-A design in one body. An absent directory is an act
  // nobody performed and there is no book to report anything about, so it
  // throws. An unreadable or unverifiable book is a fact the book EXISTS to
  // report, and reporting it is not the same as refusing to come up.
  const clean = scratch("boundary-first-boot");
  const first = new RulingLog({ path: clean.store });
  assert.strictEqual(first.getLoadState(), "FIRST_BOOT_OR_ERASED");
  assert.strictEqual(first.getLastError(), null);
  const out = first.record({ timestamp: 1, rulingText: "a real first boot", modality: "OFFERED" });
  assert.strictEqual(out.persisted, true, "a deployed-but-empty book must still persist");

  const broken = scratch("boundary-cannot-verify");
  writeFileSync(broken.store, "{not json at all\n", "utf8");
  const limping = new RulingLog({ path: broken.store });   // MUST NOT THROW
  assert.strictEqual(limping.getLoadState(), "CANNOT_VERIFY");
  assert.ok((limping.getLastError() ?? "").includes("malformed JSON"), String(limping.getLastError()));
});

check("RL-W · the CLI seam: an undeployed book stops the tool instead of printing success", () => {
  // MEASURED AT `7d9d54e` BEFORE THE CUT: this exact call conjured the directory
  // at the process umask, wrote the ruling into it, printed `persisted : true`,
  // and returned normally — the CLI then exited 0. That is the sentence this
  // test exists to keep unsayable.
  const base = join(root, `s97-cli-undeployed-${counter++}`);
  const neverMade = join(base, "arbiter");
  mkdirSync(base, { recursive: true });

  let caught: unknown = null;
  try {
    appendOneRuling({
      storePath: join(neverMade, "rulings.jsonl"),
      intakeDir: join(base, "intake"),
      witnessSetId: "set-alpha",
      submitterId: "mica-arbiter",
      modality: "OFFERED",
      rulingText: "a ruling nobody deployed a book for",
      now: () => 1_700_000_000_000,
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ArbiterDeploymentActMissing, `wrong error type: ${String(caught)}`);
  assert.ok((caught as Error).message.includes("deploy recipe §5B.2"), (caught as Error).message);
  assert.strictEqual(existsSync(neverMade), false, "the tool created the book directory after all");
  assert.deepStrictEqual(readdirSync(base), [], "the tool wrote something");
});

check("RL-X · ruling-log.ts CALLS mkdirSync nowhere — the fence, checked at bytes", () => {
  // The fence is on the CALL, not on the word (R-P3's rule, S95): the file names
  // `mkdirSync` in prose in order to forbid it, and a fence that banned the word
  // would be satisfied by deleting the argument.
  const source = readFileSync(join(__dirname, "ruling-log.ts"), "utf8");
  assert.doesNotMatch(
    codeOnly(source),
    /mkdirSync\s*\(/,
    "ruling-log.ts must not create a directory anywhere"
  );
  assert.match(source, /mkdirSync/, "the reason went out with the call");
  assert.match(source, /deployment act/, "the reason went out with the call");
});

// ══════════════════════════════════════════════════════════════════════════════
// THE REAL PROCESS. Everything above tests functions that RETURN; this one tests
// that the program actually EXITS with the code a deployment depends on, and
// that what reaches the operator's terminal is a signpost rather than an autopsy.

console.log("\n── the tool · the real process, spawned ──────────────────────");

const REPO_ROOT = resolve(__dirname, "..", "..");
const TS_NODE_BIN = join(REPO_ROOT, "node_modules", "ts-node", "dist", "bin.js");
const ARBITER_ENTRY = join(REPO_ROOT, "src", "arbiter", "arbiter-log.ts");

/** `-T` (transpile-only) for the same reason `witnessd.test.ts` gives: what this
 *  case exercises is PROCESS behaviour, and `npm run typecheck` checks the types
 *  on this same entry point once instead of once per spawn. */
function spawnArbiterLog(argv: readonly string[]): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync(process.execPath, [TS_NODE_BIN, "-T", ARBITER_ENTRY, ...argv], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (r.error) throw r.error;
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

check("RL-Y · an undeployed book exits 4 with the SIGNPOST as the first line, and no trace", () => {
  // §5B.2 deliberately NOT performed: `base` exists, the book's directory does
  // not. Built by hand rather than through scratch(), which performs the act.
  const base = join(root, `s97-cli-signpost-${counter++}`);
  const neverMade = join(base, "arbiter");
  mkdirSync(base, { recursive: true });

  const r = spawnArbiterLog([
    "--store", join(neverMade, "rulings.jsonl"),
    "--intake", join(base, "intake"),
    "--witness-set-id", "set-alpha",
    "--submitter-id", "mica-arbiter",
    "--modality", "OFFERED",
    "a ruling nobody deployed a book for",
  ]);

  // THE NAMED CODE. Not "non-zero" — the digit a deployment scripts against.
  assert.strictEqual(r.status, 4, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);

  // THE FIRST LINE OF OUTPUT, and each signpost element asserted separately so a
  // message that keeps the shape and loses a part fails here.
  const firstLine = r.stderr.split("\n")[0];
  assert.ok(firstLine.includes("arbiter ruling-log directory absent"), firstLine);
  assert.ok(firstLine.includes("this is a deployment act"), firstLine);      // the act
  assert.ok(firstLine.includes("deploy recipe §5B.2"), firstLine);           // the section
  assert.ok(
    firstLine.includes(`${neverMade} at 2750 mica-arbiter:mica-readers`),
    firstLine
  );                                                                          // expected state
  assert.ok(firstLine.includes("Nothing was created"), firstLine);
  assert.strictEqual(r.stdout, "", `the tool printed a success line too:\n${r.stdout}`);

  // NO AUTOPSY. A stack trace tells the reader where the CODE was; the operator
  // needs to know which ACT nobody performed.
  const combined = `${r.stdout}\n${r.stderr}`;
  assert.doesNotMatch(combined, /\n\s+at .*\(.*:\d+:\d+\)/, combined);
  assert.doesNotMatch(combined, /ArbiterDeploymentActMissing:/, combined);

  // And the disk, after: the tool that refused created nothing.
  assert.strictEqual(existsSync(neverMade), false, "the book directory was created after all");
  assert.deepStrictEqual(readdirSync(base), [], "the tool wrote something");
});

rmSync(root, { recursive: true, force: true });

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── S98 · a look that was REFUSED is not a book that is ABSENT ──");

check("RL-S98-1 · the look has three answers, and only ENOENT means absent", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-arbiter-look-"));
  const present = join(base, "book.jsonl");
  writeFileSync(present, "", "utf8");
  assert.deepStrictEqual(lookAtRulingLogFile(present), { state: "PRESENT" });
  assert.deepStrictEqual(lookAtRulingLogFile(join(base, "nope.jsonl")), { state: "ABSENT" });

  // A NON-ENOENT errno, produced WITHOUT touching permissions so this body is
  // deterministic for every principal including root: a path component longer
  // than NAME_MAX is ENAMETOOLONG, inside a directory that stats perfectly well.
  const tooLong = join(base, "x".repeat(300));
  const refused = lookAtRulingLogFile(tooLong);
  assert.strictEqual(
    refused.state,
    "CANNOT_SEE",
    `a stat error that is not ENOENT was classified as ${refused.state}`
  );
  assert.ok(
    refused.state === "CANNOT_SEE" && refused.detail.includes("ENAMETOOLONG"),
    "the errno the look could not get past is not carried on the finding"
  );
});

check("RL-S98-2 · a book it CANNOT SEE loads to CANNOT_VERIFY, never to first boot", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-arbiter-cannotsee-"));
  const unseeable = join(base, "x".repeat(300));

  const book = new RulingLog({ path: unseeable });

  assert.strictEqual(
    book.getLoadState(),
    "CANNOT_VERIFY",
    "a book this process cannot look at came up as a first boot"
  );
  const detail = book.getLastError() ?? "";
  assert.ok(detail.includes("NOT the finding that it is absent"), detail);
  assert.ok(detail.includes("ENAMETOOLONG"), detail);
  assert.ok(detail.includes("nothing was recorded as a first boot"), detail);
  assert.ok(detail.includes("deploy recipe §5B.2"), detail);
});

check("RL-S98-3 · and it does not persist — the write is refused, typed, over nothing", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-arbiter-cannotsee-write-"));
  const book = new RulingLog({ path: join(base, "x".repeat(300)) });
  const out = book.record({ timestamp: 1, rulingText: "unseen", modality: "IMPOSED" });
  assert.strictEqual(out.persisted, false);
  assert.ok((out.detail ?? "").includes("NOT the finding that it is absent"));
  assert.strictEqual(book.length, 0, "a book nobody could read advanced anyway");
});

check("RL-S98-4 · THE REAL SHAPE — a directory whose execute bit is stripped", () => {
  // This is the deployment fault the fix exists for: the directory stats fine
  // and refuses every path inside it. It needs a principal the mode applies to,
  // so it is attempted only as non-root; as root the condition cannot be built
  // and this body SAYS SO rather than passing quietly over a check that never
  // ran. RL-S98-1 through RL-S98-3 reach the same branch by another errno and are
  // deterministic for every principal.
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === 0 || uid === null) {
    console.log(
      "      NOT EXERCISED as this principal: a mode-based refusal cannot be " +
        "built for uid 0. The classification and the load state are covered by " +
        "RL-S98-1..3; this body covers only the mode."
    );
    return;
  }
  const base = mkdtempSync(join(tmpdir(), "mica-arbiter-noexec-"));
  const dir = join(base, "book");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "book.jsonl");
  writeFileSync(path, "", "utf8");
  chmodSync(dir, 0o600); // readable, NOT searchable
  try {
    const look = lookAtRulingLogFile(path);
    assert.strictEqual(
      look.state,
      "CANNOT_SEE",
      "a directory with no execute bit did not refuse the look"
    );
    const book = new RulingLog({ path });
    assert.strictEqual(book.getLoadState(), "CANNOT_VERIFY");
    assert.ok((book.getLastError() ?? "").includes("EACCES"));
  } finally {
    chmodSync(dir, 0o700);
  }
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
