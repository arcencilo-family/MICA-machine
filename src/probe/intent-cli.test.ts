// ── MICA · intent-cli — acceptance tests (S116) ──────────────────────────────
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node src/probe/intent-cli.test.ts
//
// THE DOOR IS THE REAL ONE. Every seal here is written into an intake by a
// SPAWNED `intent-cli.ts` process and appended by a real `Registrar.sweep()`.
// What is NOT exercised is the kernel setting the frame's owner uid — a test
// running as one user cannot chown its own frames — so `resolvePrincipal` is
// the injected seam, exactly as `registrar.test.ts` does it and for the same
// reason. Everything else on the path is production code.

import assert from "assert";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { PrecommitBook } from "../precommit/precommit";
import { Registrar } from "../registrar/registrar";
import { main } from "./intent-cli";
import { readIntentRecordClass } from "./intent-record";

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

const REAL_UID = typeof process.getuid === "function" ? process.getuid() : -1;
const PRINCIPAL = "mica-doctor";
const REPO = join(__dirname, "..", "..");
const SALT = "s116-intent-cli-fixture-salt-0123456789";

interface Room {
  readonly root: string;
  readonly intake: string;
  readonly roster: string;
  readonly bookPath: string;
  readonly registrar: Registrar;
}

/**
 * Root, intake, AND the committer's book directory — the last one because the
 * authored-once scan opens the book BEFORE anything has ever been deposited,
 * and `PrecommitBook` refuses a book whose directory is not there. Live, that
 * directory already exists (the registrar made it on the first S99 deposit);
 * here it is made by name so these tests exercise the scan rather than the
 * ordering fact, which IC-M covers on its own with no directory at all.
 */
function room(): Room {
  const root = mkdtempSync(join(tmpdir(), "s116-intent-cli-"));
  const intake = join(root, "intake");
  mkdirSync(intake, { mode: 0o2730 });
  mkdirSync(join(root, PRINCIPAL), { mode: 0o2750 });
  const roster = join(root, "roster.json");
  writeFileSync(roster, JSON.stringify({ [String(REAL_UID)]: PRINCIPAL }), "utf8");
  let t = 1_700_000_000_000;
  return {
    root,
    intake,
    roster,
    bookPath: join(root, PRINCIPAL, "book.jsonl"),
    registrar: new Registrar({
      root,
      witnessSetId: "s116-test-set",
      resolvePrincipal: () => PRINCIPAL,
      now: () => ++t,
    }),
  };
}

// ── THE SWEEPER · a real second process, because that is the real shape ──────
//
//   Since S116's open-seal build, a seal act WAITS for its own commitment to
//   appear in the book before it deposits the reveal — and the thing that puts
//   it there is the registrar, sweeping. Live that is `registrard`, a separate
//   process on its own tick. A single-threaded test cannot sweep while the
//   hand polls, so these tests start a real child that does nothing but sweep
//   this room, exactly as the daemon does. The hand under test then runs
//   IN-PROCESS and polls a book another process is writing — which is the
//   concurrency the design is actually about.

function startSweeper(r: Room): ChildProcess {
  const script = join(r.root, "sweeper.ts");
  // ⛔ CLEAR THE MARKERS FIRST. A room gets more than one sweeper in its life
  //    (sealRuleIntentThroughDoor starts one, and the basis act starts another),
  //    and a leftover `sweeper.stop` made the SECOND child exit before its first
  //    sweep. IC-E then failed every run with "no COMMITMENT appeared within the
  //    declared wait" — a stop signal outliving the process it was for.
  rmSync(join(r.root, "sweeper.stop"), { force: true });
  rmSync(join(r.root, "sweeper.stopped"), { force: true });
  writeFileSync(join(r.root, "package.json"), '{"type":"commonjs"}', "utf8");
  writeFileSync(
    script,
    `import { Registrar } from ${JSON.stringify(join(REPO, "src", "registrar", "registrar"))};\n` +
      `let t = 1_800_000_000_000;\n` +
      `const reg = new Registrar({ root: ${JSON.stringify(r.root)}, witnessSetId: "s116-test-set",\n` +
      `  resolvePrincipal: () => ${JSON.stringify(PRINCIPAL)}, now: () => ++t });\n` +
      `const { existsSync, writeFileSync } = require("fs");\n` +
      `const STOP = ${JSON.stringify(join(r.root, "sweeper.stop"))};\n` +
      `const STOPPED = ${JSON.stringify(join(r.root, "sweeper.stopped"))};\n` +
      `const idle = new Int32Array(new SharedArrayBuffer(4));\n` +
      // ⛔ THE STOP IS COOPERATIVE AND IT IS CHECKED BETWEEN SWEEPS, never
      //    inside one. SIGKILL could land mid-`sweep()`; this cannot, so the
      //    room is never left half-written — and the child ANSWERS, through a
      //    file the parent can read synchronously, rather than through an
      //    'exit' event the parent's own blocking wait would prevent.
      `for (;;) { if (existsSync(STOP)) { writeFileSync(STOPPED, "1"); process.exit(0); }\n` +
      `  try { reg.sweep(); } catch { /* mid-write; next tick */ }\n` +
      `  Atomics.wait(idle, 0, 0, 25); }\n`,
    "utf8"
  );
  return spawn(
    "node",
    ["-r", "ts-node/register/transpile-only", script],
    {
      cwd: REPO,
      stdio: "ignore",
      env: { ...process.env, TS_NODE_COMPILER_OPTIONS: '{"module":"commonjs","rootDir":"/"}' },
    }
  );
}

/** A synchronous bounded sleep, the same trick the sweeper child uses. */
function nap(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * ⛔ THE KILL IS ASYNCHRONOUS, AND THAT WAS THE FLAKE.
 *
 * `sweeper.kill("SIGKILL")` returns immediately. The child may be mid-`sweep()`,
 * and its last pass lands in the room AFTER `withSweeper` has returned — so a
 * test that then measures `registrar.sweep().recordedCount` is measuring its own
 * act PLUS whatever the dying child had not finished. Under load the child gets
 * less CPU and is further behind, which is why the rate tracked load: measured
 * 2026-10-02 at 10 of 20 direct runs while a sweep occupied the box, and 1 of 13
 * inside sequential sweeps where nothing competed.
 *
 * ⚠ AND IT IS NOT AN ISOLATION FAULT, which is what it looked like. `room()`
 *   already calls `mkdtempSync`, so every room has its own directory; adding more
 *   isolation would have changed nothing. The shared thing was TIME.
 *
 * ⛔ THE FIRST FIX WAITED ON `child.exitCode`, AND IT COULD NOT WORK. That field
 *    is set by the 'exit' event, and a synchronous poll BLOCKS THE EVENT LOOP
 *    that would deliver it — 7 of 17 tests then failed on a 5s timeout every
 *    single run. Polling a value only the loop you are blocking can update is the
 *    same shape as the defect it was meant to fix. So the child answers through
 *    the filesystem, which a blocked parent can still read.
 *
 * Bounded, and it THROWS rather than proceeding: a sweeper that will not stop is
 * a finding, and continuing past it would put the race back.
 */
function waitForStop(r: Room, child: ChildProcess, label: string): void {
  writeFileSync(join(r.root, "sweeper.stop"), "1", "utf8");
  const deadline = Date.now() + 5_000;
  while (!existsSync(join(r.root, "sweeper.stopped"))) {
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(
        `${label}: the sweeper child did not acknowledge the stop within 5s (pid ${String(child.pid)}). ` +
          "SIGKILL was sent so nothing is left running, but the room's state is NOT a fixed point and " +
          "any count measured after this would be about scheduling, not about the act."
      );
    }
    nap(10);
  }
}

/**
 * Sweep in-process until a sweep records nothing, so the room is at a FIXED POINT
 * when the helper returns. After this, a test's `recordedCount` is a statement
 * about that test's own act and not about who was scheduled when.
 */
function quiesce(r: Room, label: string): void {
  for (let i = 0; i < 100; i++) {
    if (r.registrar.sweep().recordedCount === 0) return;
  }
  throw new Error(`${label}: the room would not quiesce in 100 sweeps — something is producing work`);
}

/** Run `fn` with a live sweeper on this room, and stop it on every path. */
function withSweeper<T>(r: Room, fn: () => T): T {
  const sweeper = startSweeper(r);
  try {
    return fn();
  } finally {
    waitForStop(r, sweeper, "withSweeper");
    quiesce(r, "withSweeper");
  }
}

/** The wait the hand is given in these tests. Declared, never defaulted. */
const AWAIT = ["--await-attempts", "120", "--await-interval-ms", "100"];

function argsFor(r: Room, act: string, extra: readonly string[]): string[] {
  return [act, "--intake", r.intake, "--roster", r.roster, "--timestamp", "1700000000000", ...extra];
}

/**
 * SPAWNED — a real child process, the real `require.main` entry, the real exit
 * code. Two tests use this (IC-A, IC-B) because that is what proves the WIRING;
 * every other test calls `main()` in-process, because thirteen `npx ts-node`
 * cold starts cost the whole suite more than a minute and prove the same
 * function thirteen times. Same discipline `deposit-cli.test.ts` holds: unit
 * the function, spawn the wiring.
 */
function runSpawned(r: Room, act: string, extra: readonly string[]): { out: string; status: number | null } {
  const res = spawnSync(
    "npx",
    ["ts-node", join(__dirname, "intent-cli.ts"), ...argsFor(r, act, extra)],
    { encoding: "utf8", cwd: REPO }
  );
  return { out: `${res.stdout ?? ""}${res.stderr ?? ""}`, status: res.status };
}

/** IN-PROCESS — `main()` returns its exit code rather than calling process.exit. */
function run(r: Room, act: string, extra: readonly string[]): { out: string; status: number } {
  return runArgv(argsFor(r, act, extra));
}

function runArgv(argv: readonly string[]): { out: string; status: number } {
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

function contentFile(r: Room, name: string, body: unknown): string {
  const p = join(r.root, name);
  writeFileSync(p, JSON.stringify(body), "utf8");
  return p;
}

const RULE_CONTENT = {
  ruleId: "no-clerk-scope-widening",
  declaredProtectivePurpose: "the clerk's scope is the blast radius; widening it moves the radius",
  namedFailureModes: ["a widened scope outlives the reason for it"],
  scopeFrameRef: "scope-frame:clerk-1",
};

/**
 * Seal a rule intent through the door WITH A LIVE SWEEPER, so the hand's own
 * reveal-at-seal completes. Returns both sequence numbers the chain assigned.
 *
 * NOTE WHAT THIS HELPER DOES NOT DO: it runs no reveal step of its own. The
 * reveal in the resulting book was deposited by the HAND, inside the one seal
 * invocation. IC-C leans on exactly that.
 */
function sealRuleIntentThroughDoor(
  r: Room,
  envelopeName: string,
  runner: (r: Room, act: string, extra: readonly string[]) => { out: string; status: number | null } = run
): { commitmentSeq: number; revealSeq: number; envelope: string; out: string } {
  const envelope = join(r.root, envelopeName);
  const sealed = withSweeper(r, () =>
    runner(r, "seal-rule-intent", [
      "--book-path", r.bookPath,
      "--content", contentFile(r, `${envelopeName}.content.json`, RULE_CONTENT),
      "--salt", SALT,
      "--envelope-out", envelope,
      ...AWAIT,
    ])
  );
  assert.strictEqual(sealed.status, 0, sealed.out);
  const book = new PrecommitBook({ path: r.bookPath });
  const commitment = book.getAll().find((x) => x.kind === "COMMITMENT");
  const reveal = book.getAll().find((x) => x.kind === "REVEAL");
  assert.ok(commitment !== undefined, "the registrar recorded no COMMITMENT");
  assert.ok(reveal !== undefined, "the hand did not reveal at seal");
  return {
    commitmentSeq: commitment.sequenceNumber,
    revealSeq: reveal.sequenceNumber,
    envelope,
    out: sealed.out,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── reveal at seal · one act, declared and readable ──");

check("IC-A · seal-rule-intent seals AND reveals in one invocation, and prints both", () => {
  const r = room();
  const { commitmentSeq, revealSeq, envelope, out } = sealRuleIntentThroughDoor(r, "rule-envelope.json");

  const book = new PrecommitBook({ path: r.bookPath });
  assert.strictEqual(book.getLoadState(), "LOADED_VERIFIED");
  const kinds = book.getAll().map((x) => x.kind);
  assert.deepStrictEqual(kinds, ["COMMITMENT", "ANCHOR", "REVEAL", "ANCHOR"], JSON.stringify(kinds));

  const reveal = book.getAll().find((x) => x.kind === "REVEAL");
  assert.ok(reveal !== undefined);
  assert.strictEqual(reveal.sealCheck, "MATCH");
  assert.strictEqual(reveal.ref, commitmentSeq);
  assert.strictEqual(readIntentRecordClass(reveal.plaintext.predictedValue), "RULE_INTENT");

  // BOTH sequence numbers and BOTH hashes are printed.
  const commitment = book.getAll().find((x) => x.kind === "COMMITMENT");
  assert.ok(commitment !== undefined);
  assert.ok(out.includes(`COMMITMENT   : seq ${String(commitmentSeq)}  hash ${commitment.hash}`), out);
  assert.ok(out.includes(`REVEAL       : seq ${String(revealSeq)}  hash ${reveal.hash}`), out);
  assert.ok(out.includes("seal check   : MATCH"), out);

  // THE STANCE, ASSERTED: the unfinished-record banner is off the success path.
  assert.ok(!out.includes("NOT YET AN ANCHOR"), out);
  assert.ok(!out.includes("SEALED BUT NOT REVEALED"), out);
  assert.ok(out.includes("DECLARED AND READABLE"), out);

  const kept = JSON.parse(readFileSync(envelope, "utf8"));
  assert.strictEqual(kept.target, "rule-intent:no-clerk-scope-widening");
  assert.strictEqual(readIntentRecordClass(kept.predictedValue), "RULE_INTENT");
});

check("IC-B · SPAWNED — the same act through a real child process and the real exit code", () => {
  const r = room();
  const { commitmentSeq, revealSeq } = sealRuleIntentThroughDoor(r, "rule-envelope.json", runSpawned);
  assert.ok(revealSeq > commitmentSeq, "the reveal must sit after the commitment it reveals");
  const book = new PrecommitBook({ path: r.bookPath });
  assert.strictEqual(book.getAll().filter((x) => x.kind === "REVEAL").length, 1);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the refusals · each one reached through the CLI, exit code captured ──");

check("IC-C · AUTHORED-ONCE ON THE HAPPY PATH — a second seal is refused, and THIS TEST RAN NO REVEAL", () => {
  const r = room();
  sealRuleIntentThroughDoor(r, "rule-envelope.json");

  // Deliberately no reveal step here: the reveal in this book was deposited by
  // the HAND, inside the seal act. That is the whole point of the open-seal
  // ruling — authored-once now sees every intent on the happy path.
  const book = new PrecommitBook({ path: r.bookPath });
  assert.strictEqual(book.getAll().filter((x) => x.kind === "REVEAL").length, 1);

  const second = run(r, "seal-rule-intent", [
    "--book-path", r.bookPath,
    "--content", contentFile(r, "again.json", RULE_CONTENT),
    "--salt", SALT,
    "--envelope-out", join(r.root, "again-envelope.json"),
    ...AWAIT,
  ]);
  assert.strictEqual(second.status, 3, second.out);
  assert.ok(second.out.includes("IntentRecordRefused"), second.out);
  assert.ok(second.out.includes("ON THIS CHAIN"), second.out);
  assert.strictEqual(r.registrar.sweep().recordedCount, 0, "the refused seal deposited anyway");
});

check("IC-D · NO_ANCHOR_ESCALATE — an invocation against an unanchored rule deposits nothing", () => {
  const r = room();
  const out = run(r, "seal-invocation-basis", [
    "--book-path", r.bookPath,
    "--rule-id", "a-rule-nobody-authored",
    "--claimed-basis", "claiming a basis anyway",
    "--benefited-circle", "SUB_SCOPE",
    "--harmed-circle", "WIDER_CIRCLE",
    "--salt", SALT,
    "--envelope-out", join(r.root, "never-written.json"),
    ...AWAIT,
  ]);
  assert.strictEqual(out.status, 3, out.out);
  assert.ok(out.out.includes("NO_ANCHOR_ESCALATE"), out.out);
  assert.ok(out.out.includes("deployer-conformance"), out.out);
  assert.strictEqual(r.registrar.sweep().recordedCount, 0, "something was deposited anyway");
});

check("IC-E · a basis anchors to the rule intent found ON THE CHAIN, and reveals at seal too", () => {
  const r = room();
  const { commitmentSeq } = sealRuleIntentThroughDoor(r, "rule-envelope.json");

  const basis = withSweeper(r, () =>
    run(r, "seal-invocation-basis", [
      "--book-path", r.bookPath,
      "--rule-id", RULE_CONTENT.ruleId,
      "--claimed-basis", "following the rule here would strand the operator with no exit",
      "--benefited-circle", "SUB_SCOPE",
      "--harmed-circle", "WIDER_CIRCLE",
      "--salt", SALT,
      "--envelope-out", join(r.root, "basis-envelope.json"),
      ...AWAIT,
    ])
  );
  assert.strictEqual(basis.status, 0, basis.out);
  assert.ok(basis.out.includes("found in CHAIN"), basis.out);
  assert.ok(basis.out.includes(`commitment seq ${String(commitmentSeq)}`), basis.out);
  assert.ok(!basis.out.includes("SEALED BUT NOT REVEALED"), basis.out);

  const book = new PrecommitBook({ path: r.bookPath });
  const reveals = book.getAll().filter((x) => x.kind === "REVEAL");
  assert.strictEqual(reveals.length, 2, "the basis did not reveal at seal");
  assert.strictEqual(readIntentRecordClass(reveals[1].plaintext.predictedValue), "INVOCATION_BASIS");
  assert.strictEqual(reveals[1].sealCheck, "MATCH");

  const kept = JSON.parse(readFileSync(join(r.root, "basis-envelope.json"), "utf8"));
  assert.strictEqual(readIntentRecordClass(kept.predictedValue), "INVOCATION_BASIS");
});

check("IC-F · a book that loaded CANNOT_VERIFY refuses the seal — never read as 'no prior record'", () => {
  const r = room();
  writeFileSync(r.bookPath, "{not json at all\n", "utf8");
  const out = run(r, "seal-rule-intent", [
    "--book-path", r.bookPath,
    "--content", contentFile(r, "content.json", RULE_CONTENT),
    "--salt", SALT,
    "--envelope-out", join(r.root, "never-written.json"),
    ...AWAIT,
  ]);
  assert.strictEqual(out.status, 3, out.out);
  assert.ok(out.out.includes("CANNOT_VERIFY"), out.out);
  assert.ok(out.out.includes('no prior record'), out.out);
  assert.strictEqual(r.registrar.sweep().recordedCount, 0);
});

check("IC-G · a --content file carrying the WIRE's own fields is a usage refusal, not a seal", () => {
  const r = room();
  const out = run(r, "seal-rule-intent", [
    "--book-path", r.bookPath,
    "--content", contentFile(r, "claimish.json", { ...RULE_CONTENT, intentRecordClass: "RULE_INTENT" }),
    "--salt", SALT,
    "--envelope-out", join(r.root, "never-written.json"),
    ...AWAIT,
  ]);
  assert.strictEqual(out.status, 2, out.out);
  assert.ok(out.out.includes("writing a claim file by another name"), out.out);
  assert.strictEqual(r.registrar.sweep().recordedCount, 0);
});

check("IC-H · reveal REFUSES an envelope that is not one of this wire's", () => {
  const r = room();
  const foreign = join(r.root, "foreign-envelope.json");
  writeFileSync(
    foreign,
    JSON.stringify({
      type: "verdict", target: "an ordinary prediction",
      predictedValue: "the value it will hold", committerId: PRINCIPAL, salt: SALT,
    }),
    "utf8"
  );
  const out = run(r, "reveal", ["--book-path", r.bookPath, "--ref", "0", "--envelope", foreign]);
  assert.strictEqual(out.status, 2, out.out);
  assert.ok(out.out.includes("does not declare an intent-record class"), out.out);
  assert.strictEqual(r.registrar.sweep().recordedCount, 0);
});

check("IC-J · a missing --book-path is a refusal, never a seal with the scan skipped", () => {
  const r = room();
  const out = run(r, "seal-rule-intent", [
    "--content", contentFile(r, "content.json", RULE_CONTENT),
    "--salt", SALT,
    "--envelope-out", join(r.root, "never-written.json"),
    ...AWAIT,
  ]);
  assert.strictEqual(out.status, 2, out.out);
  assert.ok(out.out.includes("--book-path"), out.out);
  assert.strictEqual(r.registrar.sweep().recordedCount, 0);
});

check("IC-K · no clock: --timestamp is required, and the frame carries the declared one", () => {
  const r = room();
  const without = runArgv([
    "seal-rule-intent",
    "--intake", r.intake, "--roster", r.roster,
    "--book-path", r.bookPath,
    "--content", contentFile(r, "content.json", RULE_CONTENT),
    "--salt", SALT, "--envelope-out", join(r.root, "e.json"), ...AWAIT,
  ]);
  assert.strictEqual(without.status, 2, without.out);
  assert.ok(without.out.includes("--timestamp"), without.out);

  // With it, the DECLARED value is what reaches the chain — not a clock reading.
  sealRuleIntentThroughDoor(r, "declared.json");
  const records = new PrecommitBook({ path: r.bookPath }).getAll();
  const commitment = records.find((x) => x.kind === "COMMITMENT");
  const reveal = records.find((x) => x.kind === "REVEAL");
  assert.strictEqual(commitment?.timestamp, 1_700_000_000_000);
  assert.strictEqual(reveal?.timestamp, 1_700_000_000_000);
});

check("IC-L · FENCE — intent-cli.ts calls no clock and writes no claim file", () => {
  const source = readFileSync(join(__dirname, "intent-cli.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  assert.ok(!source.includes("Date.now"), "the hand calls a clock");
  assert.ok(!source.includes("randomSalt"), "the hand mints a salt");
  // It must reach the wire's own preparers, never build an Expectation itself.
  assert.ok(source.includes("prepareRuleIntentSeal"), "it does not call the wire");
  assert.ok(source.includes("prepareInvocationBasisSeal"), "it does not call the wire");
  assert.ok(!/predictedValue:\s*/.test(source), "it builds a wire shape by hand");
});

check("IC-M · a book DIRECTORY that is not there refuses too — the registrar makes it, not this hand", () => {
  const r = room();
  const virgin = join(r.root, "never-deployed", "book.jsonl");
  const out = run(r, "seal-rule-intent", [
    "--book-path", virgin,
    "--content", contentFile(r, "content.json", RULE_CONTENT),
    "--salt", SALT,
    "--envelope-out", join(r.root, "never-written.json"),
    ...AWAIT,
  ]);
  assert.strictEqual(out.status, 1, out.out);
  assert.ok(out.out.includes("NOTHING was deposited"), out.out);
  assert.ok(out.out.includes("not the finding that"), out.out);
  assert.strictEqual(r.registrar.sweep().recordedCount, 0);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the one outcome that leaves work owed, and the command that finishes it ──");

check("IC-N · with NOBODY sweeping, the seal exits 4 and says the record is unfinished", () => {
  const r = room();
  // No sweeper. The seal frame reaches the intake; no COMMITMENT ever appears.
  const out = run(r, "seal-rule-intent", [
    "--book-path", r.bookPath,
    "--content", contentFile(r, "content.json", RULE_CONTENT),
    "--salt", SALT,
    "--envelope-out", join(r.root, "orphan-envelope.json"),
    "--await-attempts", "2", "--await-interval-ms", "10",
  ]);
  assert.strictEqual(out.status, 4, out.out);
  assert.ok(out.out.includes("SEALED BUT NOT REVEALED"), out.out);
  // It must say the thing that is actually dangerous about this state.
  assert.ok(out.out.includes("authored-once scan CANNOT SEE IT"), out.out);
  assert.ok(out.out.includes("intent-cli.ts reveal"), out.out);
  assert.ok(out.out.includes("orphan-envelope.json"), out.out);
  // And it must NOT claim success.
  assert.ok(!out.out.includes("DECLARED AND READABLE"), out.out);
  // The frame IS in the intake — the seal was really deposited.
  assert.strictEqual(r.registrar.sweep().recordedCount, 1);
});

check("IC-P · RECOVERY — after an exit-4 seal, the standalone reveal finishes the record", () => {
  const r = room();
  const envelope = join(r.root, "orphan-envelope.json");
  const sealed = run(r, "seal-rule-intent", [
    "--book-path", r.bookPath,
    "--content", contentFile(r, "content.json", RULE_CONTENT),
    "--salt", SALT, "--envelope-out", envelope,
    "--await-attempts", "2", "--await-interval-ms", "10",
  ]);
  assert.strictEqual(sealed.status, 4, sealed.out);
  assert.strictEqual(r.registrar.sweep().recordedCount, 1);

  const book = new PrecommitBook({ path: r.bookPath });
  const commitment = book.getAll().find((x) => x.kind === "COMMITMENT");
  assert.ok(commitment !== undefined);
  assert.strictEqual(book.getAll().filter((x) => x.kind === "REVEAL").length, 0);

  const recovered = run(r, "reveal", [
    "--book-path", r.bookPath,
    "--ref", String(commitment.sequenceNumber),
    "--envelope", envelope,
  ]);
  assert.strictEqual(recovered.status, 0, recovered.out);
  assert.ok(recovered.out.includes("RECOVERY"), recovered.out);
  assert.strictEqual(r.registrar.sweep().recordedCount, 1);

  const after = new PrecommitBook({ path: r.bookPath }).getAll();
  const reveal = after.find((x) => x.kind === "REVEAL");
  assert.ok(reveal !== undefined, "the recovery did not reach the chain");
  assert.strictEqual(reveal.sealCheck, "MATCH");
  assert.strictEqual(reveal.ref, commitment.sequenceNumber);
});

check("IC-Q · the recovery REFUSES a sequence that is already revealed", () => {
  const r = room();
  const { commitmentSeq, envelope } = sealRuleIntentThroughDoor(r, "rule-envelope.json");
  // The hand already revealed this at seal. Running the recovery again would
  // put a second plaintext in the chain claiming one seal.
  const again = run(r, "reveal", [
    "--book-path", r.bookPath,
    "--ref", String(commitmentSeq),
    "--envelope", envelope,
  ]);
  assert.strictEqual(again.status, 2, again.out);
  assert.ok(again.out.includes("ALREADY revealed"), again.out);
  assert.ok(again.out.includes("Nothing was deposited"), again.out);
  assert.strictEqual(r.registrar.sweep().recordedCount, 0);
});

check("IC-R · the recovery REFUSES a ref that is not a COMMITMENT, or not THIS envelope's", () => {
  const r = room();
  const { commitmentSeq, revealSeq, envelope } = sealRuleIntentThroughDoor(r, "rule-envelope.json");

  // (a) a ref that names an ANCHOR, not a COMMITMENT.
  const anchorSeq = commitmentSeq + 1;
  const wrongKind = run(r, "reveal", [
    "--book-path", r.bookPath, "--ref", String(anchorSeq), "--envelope", envelope,
  ]);
  assert.strictEqual(wrongKind.status, 2, wrongKind.out);
  assert.ok(wrongKind.out.includes("not a COMMITMENT"), wrongKind.out);

  // (b) a ref past the end of the chain.
  const past = run(r, "reveal", [
    "--book-path", r.bookPath, "--ref", String(revealSeq + 99), "--envelope", envelope,
  ]);
  assert.strictEqual(past.status, 2, past.out);
  assert.ok(past.out.includes("not there at all"), past.out);

  // (c) a REAL commitment, but an envelope that did not seal it. This is the
  //     one that would otherwise write a permanent MISMATCH into that entry.
  const foreign = join(r.root, "foreign.json");
  writeFileSync(
    foreign,
    JSON.stringify({
      type: "verdict", target: "rule-intent:something-else",
      predictedValue: JSON.stringify({ ...RULE_CONTENT, ruleId: "x", intentRecordClass: "RULE_INTENT" }),
      committerId: PRINCIPAL, salt: SALT,
    }),
    "utf8"
  );
  const mismatched = run(r, "reveal", [
    "--book-path", r.bookPath, "--ref", String(commitmentSeq), "--envelope", foreign,
  ]);
  assert.strictEqual(mismatched.status, 2, mismatched.out);
  assert.ok(mismatched.out.includes("seal hash"), mismatched.out);
  assert.strictEqual(r.registrar.sweep().recordedCount, 0);
});

check("IC-S · FENCE — there is no hold-reveal flag, and no test of this hand asks for one", () => {
  const source = readFileSync(join(__dirname, "intent-cli.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  for (const flag of ["hold-reveal", "holdReveal", "defer-reveal", "no-reveal"]) {
    assert.ok(!code.includes(flag), `the hand grew a ${flag} flag — see the stance in its header`);
  }
  // The stance is findable in the file, not only in a vault document.
  assert.ok(source.includes("REVEAL AT SEAL, DEFAULT AND ONLY"), "the ruling is not stated in the source");
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
