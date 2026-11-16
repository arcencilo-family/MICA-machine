// ── REGISTRAR · deposit-cli's own journal (S111, generalized) — tests ───────
//
// House style: standalone ts-node script, custom check() harness, no framework.
//   npx ts-node src/registrar/deposit-cli.test.ts
//
// WHAT THIS FILE PROVES
//
//   deposit-cli.ts had ZERO tests of its own before the S111-A build (its
//   pure functions were exercised indirectly, imported into
//   registrar.test.ts). This file proves the JOURNAL LOGIC: the cursor
//   (absent/corrupt/ok, reused verbatim from registrard.ts — not
//   reimplemented), the append, and — the part unique to this side of the
//   pipeline — that journaling fires for WHOEVER the roster resolves,
//   moduleId = that resolved name, never a hardcoded principal. S111-A's own
//   doctor-only gate is SUPERSEDED (the arbiter, S111 night: "generalize"); the
//   tests that proved that gate are replaced below with tests proving its
//   removal — a non-doctor principal now journals exactly like the doctor
//   does, under its own name.
//
// RANK OF BOOKS, RESTATED FOR THE TEST READER: nothing here asserts anything
// about the authoritative registrar chain — that is registrar.test.ts's own
// province. This file is about a depositor's own diary, and only the diary.

import * as assert from "assert";
import { spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { journalDepositAct } from "./deposit-cli";
import { readJournalCursor, writeJournalCursor } from "./registrard";

let passed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const root = mkdtempSync(join(tmpdir(), "deposit-cli-journal-"));
let n = 0;
function scratch(): string {
  const d = join(root, String(++n));
  mkdirSync(d, { recursive: true });
  return d;
}

console.log("\n── journalDepositAct — the pure function ──────────────────────");

// journalDepositAct takes moduleId as a plain parameter — it was always
// principal-agnostic; naming it "some-principal" here (rather than
// "mica-doctor") makes plain that this function proves nothing about which
// principal may journal, that decision lives in main()'s wiring, tested below.
const A_PRINCIPAL = "some-principal";

check("ABSENT cursor journals at sequenceNumber 0 and advances the cursor to 1", () => {
  const dir = scratch();
  const logPath = join(dir, "mica-log.jsonl");
  const cursorPath = join(dir, "cursor.json");
  const result = journalDepositAct(logPath, cursorPath, A_PRINCIPAL, "COMMITMENT", 1000);
  assert.strictEqual(result.ok, true);
  const lines = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.strictEqual(lines.length, 1);
  assert.deepStrictEqual(lines[0], {
    sequenceNumber: 0,
    timestamp: 1000,
    moduleId: A_PRINCIPAL,
    eventType: "DEPOSIT_SUBMITTED",
    outcome: "COMMITMENT",
  });
  const cursor = readJournalCursor(cursorPath);
  assert.strictEqual(cursor.state, "OK");
  assert.strictEqual(cursor.next, 1);
});

check("two successive deposits mint 0 then 1 — never a duplicate, never a gap", () => {
  const dir = scratch();
  const logPath = join(dir, "mica-log.jsonl");
  const cursorPath = join(dir, "cursor.json");
  journalDepositAct(logPath, cursorPath, A_PRINCIPAL, "COMMITMENT", 1000);
  journalDepositAct(logPath, cursorPath, A_PRINCIPAL, "REVEAL", 2000);
  const lines = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0].sequenceNumber, 0);
  assert.strictEqual(lines[1].sequenceNumber, 1);
  assert.strictEqual(lines[1].outcome, "REVEAL");
});

check("CLAIM-MUST-FAIL — a CORRUPT cursor refuses the journal leg and appends nothing", () => {
  const dir = scratch();
  const logPath = join(dir, "mica-log.jsonl");
  const cursorPath = join(dir, "cursor.json");
  writeFileSync(cursorPath, "not json", "utf8");
  const result = journalDepositAct(logPath, cursorPath, A_PRINCIPAL, "COMMITMENT", 1000);
  assert.strictEqual(result.ok, false);
  assert.ok(result.detail.includes("JOURNAL_CURSOR_CORRUPT"), result.detail);
  assert.throws(() => readFileSync(logPath, "utf8"), /ENOENT/, "nothing must be appended when the cursor is refused");
});

check("a corrupt cursor, fixed by hand, re-attempts from the SAME start next time", () => {
  const dir = scratch();
  const logPath = join(dir, "mica-log.jsonl");
  const cursorPath = join(dir, "cursor.json");
  writeFileSync(cursorPath, "garbage", "utf8");
  const bad = journalDepositAct(logPath, cursorPath, A_PRINCIPAL, "COMMITMENT", 1000);
  assert.strictEqual(bad.ok, false);
  writeJournalCursor(cursorPath, 0); // the same recovery an operator performs
  const good = journalDepositAct(logPath, cursorPath, A_PRINCIPAL, "COMMITMENT", 2000);
  assert.strictEqual(good.ok, true);
  const lines = readFileSync(logPath, "utf8").trim().split("\n");
  assert.strictEqual(lines.length, 1, "only the recovered attempt wrote a line");
  assert.strictEqual(JSON.parse(lines[0]).sequenceNumber, 0);
});

check("JOURNAL_APPEND_FAILED is named and the cursor stays unmoved", () => {
  const dir = scratch();
  const logPath = join(dir, "does-not-exist-dir", "mica-log.jsonl"); // no such directory
  const cursorPath = join(dir, "cursor.json");
  const result = journalDepositAct(logPath, cursorPath, A_PRINCIPAL, "COMMITMENT", 1000);
  assert.strictEqual(result.ok, false);
  assert.ok(result.detail.includes("JOURNAL_APPEND_FAILED"), result.detail);
  assert.throws(() => readFileSync(cursorPath, "utf8"), /ENOENT/, "the cursor must not advance on a failed append");
});

// ── the real process, spawned — the WIRING, doctor-only gate REMOVED ────────
//
// Everything above proves journalDepositAct as a function. This proves the
// WIRING in main(): a real `deposit-cli.ts commit`, run as the SAME uid the
// test process itself has, resolved through a roster THIS test controls —
// journaling fires for WHATEVER name the roster resolves, moduleId = that
// name, never a hardcoded principal. S111-A's doctor-only gate is gone: a
// non-doctor principal now journals exactly like the doctor does, under its
// own name, and there is no NOT ATTEMPTED outcome left for this tool to print.

console.log("\n── the real process, spawned: any resolved principal journals ──");

const REAL_UID = typeof process.getuid === "function" ? process.getuid() : -1;

function depositRoom(principalName: string): {
  dir: string;
  intake: string;
  rosterPath: string;
  claimPath: string;
  envelopeOut: string;
} {
  const dir = scratch();
  const intake = join(dir, "intake");
  mkdirSync(intake, { recursive: true });
  const rosterPath = join(dir, "roster.json");
  writeFileSync(rosterPath, JSON.stringify({ [String(REAL_UID)]: principalName }), "utf8");
  const claimPath = join(dir, "claim.json");
  writeFileSync(
    claimPath,
    JSON.stringify({ type: "hash", target: "x", predictedValue: "y" }),
    "utf8"
  );
  return { dir, intake, rosterPath, claimPath, envelopeOut: join(dir, "envelope.json") };
}

function runDeposit(
  room: ReturnType<typeof depositRoom>,
  extra: readonly string[]
): { out: string; status: number | null } {
  const r = spawnSync(
    "npx",
    [
      "ts-node", join(__dirname, "deposit-cli.ts"), "commit",
      "--intake", room.intake,
      "--roster", room.rosterPath,
      "--claim", room.claimPath,
      "--envelope-out", room.envelopeOut,
      ...extra,
    ],
    { encoding: "utf8", cwd: join(__dirname, "..", "..") }
  );
  return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, status: r.status };
}

check("SPAWNED — mica-doctor journals a real deposit, prints it, exit unaffected", () => {
  const room = depositRoom("mica-doctor");
  const logPath = join(room.dir, "mica-log.jsonl");
  const cursorPath = join(room.dir, "cursor.json");
  const noJournal = runDeposit(depositRoom("mica-doctor"), []);
  const withJournal = runDeposit(room, ["--mica-log", logPath, "--mica-log-cursor", cursorPath]);
  assert.strictEqual(withJournal.status, 0, withJournal.out);
  assert.strictEqual(withJournal.status, noJournal.status, "journaling must not change this deposit's exit code");
  assert.ok(withJournal.out.includes("| journal       :"), withJournal.out);
  assert.ok(withJournal.out.includes("1 record journaled"), withJournal.out);
  const lines = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].moduleId, "mica-doctor");
  assert.strictEqual(lines[0].eventType, "DEPOSIT_SUBMITTED");
  assert.strictEqual(lines[0].outcome, "COMMITMENT");
});

check("SPAWNED — a principal that is NOT mica-doctor journals too, under its OWN name", () => {
  const room = depositRoom("mica-arbiter");
  const logPath = join(room.dir, "mica-log.jsonl");
  const cursorPath = join(room.dir, "cursor.json");
  const result = runDeposit(room, ["--mica-log", logPath, "--mica-log-cursor", cursorPath]);
  assert.strictEqual(result.status, 0, result.out);
  assert.ok(result.out.includes("| journal       :"), result.out);
  assert.ok(result.out.includes("1 record journaled"), result.out);
  assert.doesNotMatch(result.out, /NOT ATTEMPTED/, "the S111-A principal gate is superseded — no such outcome remains");
  const lines = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].moduleId, "mica-arbiter", "moduleId is the resolved self, never a hardcoded principal");
});

check("SPAWNED — a half-supplied pair is a usage error (exit 2) and NOTHING is deposited", () => {
  const room = depositRoom("mica-doctor");
  const result = runDeposit(room, ["--mica-log", join(room.dir, "mica-log.jsonl")]); // no --mica-log-cursor
  assert.strictEqual(result.status, 2, result.out);
  assert.ok(result.out.includes("--mica-log-cursor"), result.out);
  assert.deepStrictEqual(readdirSync(room.intake), [], "the usage error must be caught before anything reaches the intake");
});

check("SPAWNED — a CORRUPT journal cursor is loud and does NOT stop the deposit or change its exit code", () => {
  const room = depositRoom("mica-doctor");
  const cursorPath = join(room.dir, "corrupt-cursor.json");
  writeFileSync(cursorPath, "not json", "utf8");
  const clean = runDeposit(depositRoom("mica-doctor"), []);
  const withBadJournal = runDeposit(room, [
    "--mica-log", join(room.dir, "mica-log.jsonl"),
    "--mica-log-cursor", cursorPath,
  ]);
  assert.strictEqual(withBadJournal.status, clean.status, "a diary miss must never change the deposit's exit code");
  assert.ok(withBadJournal.out.includes("JOURNAL_CURSOR_CORRUPT"), withBadJournal.out);
  assert.strictEqual(readdirSync(room.intake).length, 1, "the deposit itself must still land in the intake");
  assert.throws(
    () => readFileSync(join(room.dir, "mica-log.jsonl"), "utf8"),
    /ENOENT/,
    "nothing is appended when the cursor is refused"
  );
});

rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed.\n`);
