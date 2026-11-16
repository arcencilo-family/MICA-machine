// ── REGISTRAR · registrard's journal (S110) — tests ──────────────────────────
//
// House style: standalone ts-node script, custom check() harness, no framework.
//   npx ts-node src/registrar/registrard.test.ts
//
// WHAT THIS FILE PROVES
//
//   registrard.ts had ZERO tests before this build (its CLI-level behaviour is
//   proven by spawning it as a real process, from refusal-log.test.ts and
//   registrar.test.ts). This file proves the S110 JOURNAL LOGIC specifically:
//   the cursor (absent/corrupt/ok), the append (shape, failure-is-loud-and-
//   non-blocking), and the sequenceNumber discipline the brief named —
//   directly, as pure functions, which only became importable this build (the
//   `require.main === module` guard registrard.ts gained is a prerequisite,
//   not incidental).
//
// RANK OF BOOKS, RESTATED FOR THE TEST READER: nothing here asserts anything
// about the authoritative refusal log or witness drop — those are
// registrar.ts's own province, proven in registrar.test.ts /
// refusal-log.test.ts. This file is about the diary, and only the diary.

import * as assert from "assert";
import { spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  journalOutcomes,
  readJournalCursor,
  writeJournalCursor,
} from "./registrard";
import type { DepositOutcome, RefusalReason } from "./registrar";
import { MicaLogFile, LOADED_UNVERIFIED_FILE } from "../glue/mica-log-file";

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

const root = mkdtempSync(join(tmpdir(), "registrard-journal-"));
let n = 0;
function scratch(): string {
  const d = join(root, String(++n));
  mkdirSync(d, { recursive: true });
  return d;
}

const ACCEPTED = (frame: string, seq: number): DepositOutcome => ({
  outcome: "ACCEPTED",
  frame,
  depositor: "mica-doctor",
  book: "mica-doctor",
  act: "COMMITMENT",
  sequenceNumber: seq,
  headHash: `hash-${seq}`,
  anchor: "DROPPED",
  anchorSequenceNumber: seq + 1,
  detail: null,
});

const REFUSED = (frame: string, reason: RefusalReason): DepositOutcome => ({
  outcome: "REFUSED",
  reason,
  detail: "no such depositor in the roster",
  frame,
  depositor: null,
});

console.log("\n── the cursor: 'next to assign', ABSENT = 0 ──");

check("readJournalCursor — ABSENT (no file) reads next=0", () => {
  const dir = scratch();
  const r = readJournalCursor(join(dir, "nope.json"));
  assert.strictEqual(r.state, "ABSENT");
  assert.strictEqual(r.next, 0);
});

check("readJournalCursor — CORRUPT (bad JSON) is refused, not guessed", () => {
  const dir = scratch();
  const p = join(dir, "cursor.json");
  writeFileSync(p, "{not json", "utf8");
  assert.strictEqual(readJournalCursor(p).state, "CORRUPT");
});

check("readJournalCursor — CORRUPT (wrong key / wrong shape)", () => {
  const dir = scratch();
  const p = join(dir, "cursor.json");
  writeFileSync(p, JSON.stringify({ lastStamped: 3 }), "utf8"); // the CALLER's field name, not this one's
  assert.strictEqual(readJournalCursor(p).state, "CORRUPT");
});

check("readJournalCursor — CORRUPT (negative / non-integer)", () => {
  const dir = scratch();
  const p = join(dir, "cursor.json");
  writeFileSync(p, JSON.stringify({ nextSequenceNumber: -1 }), "utf8");
  assert.strictEqual(readJournalCursor(p).state, "CORRUPT");
  writeFileSync(p, JSON.stringify({ nextSequenceNumber: 2.5 }), "utf8");
  assert.strictEqual(readJournalCursor(p).state, "CORRUPT");
});

check("readJournalCursor / writeJournalCursor round-trip", () => {
  const dir = scratch();
  const p = join(dir, "cursor.json");
  writeJournalCursor(p, 7);
  const r = readJournalCursor(p);
  assert.strictEqual(r.state, "OK");
  assert.strictEqual(r.next, 7);
});

console.log("\n── journalOutcomes: shape, ordering, sequenceNumber ──");

check("nothing to journal — an empty sweep touches neither file", () => {
  const dir = scratch();
  const logPath = join(dir, "mica-log.jsonl");
  const cursorPath = join(dir, "cursor.json");
  const r = journalOutcomes(logPath, cursorPath, [], Date.now());
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.written, 0);
  assert.throws(() => readFileSync(logPath, "utf8"), /ENOENT/);
  assert.throws(() => readFileSync(cursorPath, "utf8"), /ENOENT/);
});

check("first sweep: sequenceNumber starts at 0, one line per outcome, DEPOSIT_* eventType", () => {
  const dir = scratch();
  const logPath = join(dir, "mica-log.jsonl");
  const cursorPath = join(dir, "cursor.json");
  const now = 1_000_000;
  const outcomes: DepositOutcome[] = [
    ACCEPTED("a.json", 0),
    REFUSED("b.json", "UNKNOWN_DEPOSITOR"),
  ];
  const r = journalOutcomes(logPath, cursorPath, outcomes, now);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.written, 2);

  const lines = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0].sequenceNumber, 0);
  assert.strictEqual(lines[1].sequenceNumber, 1);
  assert.strictEqual(lines[0].moduleId, "mica-registrar");
  assert.strictEqual(lines[0].eventType, "DEPOSIT_ACCEPTED");
  assert.strictEqual(lines[0].outcome, "COMMITMENT"); // the accepted deposit's own act
  assert.strictEqual(lines[1].eventType, "DEPOSIT_REFUSED");
  assert.strictEqual(lines[1].outcome, "UNKNOWN_DEPOSITOR"); // the refused deposit's own reason

  // EQUAL TIMESTAMPS WITHIN A SWEEP ARE ACCEPTABLE — F1 (sig/index.ts:499-502)
  // treats equal timestamps as NOT a violation ("Only a STRICT inversion,
  // beyond the injected tolerance, contradicts anything"); this journal stamps
  // every record in one sweep with the SAME `nowMs`, which is exactly that
  // case, never a clock-order finding.
  assert.strictEqual(lines[0].timestamp, now);
  assert.strictEqual(lines[1].timestamp, now);

  const cursor = readJournalCursor(cursorPath);
  assert.strictEqual(cursor.state, "OK");
  assert.strictEqual(cursor.next, 2);
});

check("sequenceNumber strictly increasing ACROSS sweeps — the cursor is what makes it so", () => {
  const dir = scratch();
  const logPath = join(dir, "mica-log.jsonl");
  const cursorPath = join(dir, "cursor.json");
  journalOutcomes(logPath, cursorPath, [ACCEPTED("a.json", 0), ACCEPTED("b.json", 1)], 1000);
  journalOutcomes(logPath, cursorPath, [REFUSED("c.json", "FRAME_VANISHED")], 2000);
  journalOutcomes(logPath, cursorPath, [ACCEPTED("d.json", 2)], 3000);

  const lines = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const seqs = lines.map((l) => l.sequenceNumber);
  assert.deepStrictEqual(seqs, [0, 1, 2, 3]);
  for (let i = 1; i < seqs.length; i++) {
    assert.ok(seqs[i] > seqs[i - 1], "sequenceNumber must strictly increase across sweeps");
  }
});

check("append shape is valid under MicaLogFile's own load (exercises toRecord())", () => {
  const dir = scratch();
  const logPath = join(dir, "mica-log.jsonl");
  const cursorPath = join(dir, "cursor.json");
  journalOutcomes(
    logPath,
    cursorPath,
    [ACCEPTED("a.json", 0), REFUSED("b.json", "MALFORMED_DEPOSIT"), ACCEPTED("c.json", 1)],
    5000
  );
  // MicaLogFile.load() calls the SAME private toRecord() mica-log-file.ts uses
  // for every other producer; reading the journal's own output back through
  // the real public reader is the honest way to prove the shape is valid
  // WITHOUT exporting a function that has no reason to be public otherwise.
  const log = new MicaLogFile({ path: logPath });
  assert.strictEqual(log.getLoadState(), LOADED_UNVERIFIED_FILE);
  assert.strictEqual(log.verify().valid, true);
  assert.strictEqual(log.getAll().length, 3);
  assert.deepStrictEqual(
    log.getAll().map((r) => r.sequenceNumber),
    [0, 1, 2]
  );
});

console.log("\n── failure paths: loud, named, and NEVER blocking ──");

check("CORRUPT cursor — journal leg refused and named; nothing appended, cursor untouched", () => {
  const dir = scratch();
  const logPath = join(dir, "mica-log.jsonl");
  const cursorPath = join(dir, "cursor.json");
  writeFileSync(cursorPath, "not json at all", "utf8");
  const r = journalOutcomes(logPath, cursorPath, [ACCEPTED("a.json", 0)], 1000);
  assert.strictEqual(r.ok, false);
  assert.ok(r.detail.includes("JOURNAL_CURSOR_CORRUPT"));
  assert.ok(r.detail.includes("deposits proceed through the authoritative books"));
  assert.throws(() => readFileSync(logPath, "utf8"), /ENOENT/, "nothing must be appended on a corrupt cursor");
  assert.strictEqual(readFileSync(cursorPath, "utf8"), "not json at all", "the corrupt cursor is left exactly as found");
});

check("APPEND fails (unwritable path) — named, cursor unmoved, no partial write", () => {
  const dir = scratch();
  const logPath = join(dir, "no-such-directory", "mica-log.jsonl"); // parent does not exist
  const cursorPath = join(dir, "cursor.json");
  const r = journalOutcomes(logPath, cursorPath, [ACCEPTED("a.json", 0)], 1000);
  assert.strictEqual(r.ok, false);
  assert.ok(r.detail.includes("JOURNAL_APPEND_FAILED"));
  assert.ok(r.detail.includes(logPath));
  assert.throws(() => readFileSync(cursorPath, "utf8"), /ENOENT/, "the cursor must not advance on a failed append");
});

check("a corrupt-cursor sweep re-attempts next sweep, once fixed, from the SAME start", () => {
  const dir = scratch();
  const logPath = join(dir, "mica-log.jsonl");
  const cursorPath = join(dir, "cursor.json");
  writeFileSync(cursorPath, "garbage", "utf8");
  const bad = journalOutcomes(logPath, cursorPath, [ACCEPTED("a.json", 0)], 1000);
  assert.strictEqual(bad.ok, false);
  // "Fixed" by hand — the same recovery an operator performs.
  writeJournalCursor(cursorPath, 0);
  const good = journalOutcomes(logPath, cursorPath, [ACCEPTED("a.json", 0)], 2000);
  assert.strictEqual(good.ok, true);
  const lines = readFileSync(logPath, "utf8").trim().split("\n");
  assert.strictEqual(lines.length, 1, "only the recovered sweep wrote a line — the corrupt one wrote nothing");
  assert.strictEqual(JSON.parse(lines[0]).sequenceNumber, 0);
});

// ── the real process, spawned — journaling wired end to end ─────────────────
//
// Everything above proves the journal FUNCTIONS. This proves the WIRING: a
// real `registrard.ts` invocation, with a real sweep, actually calls them and
// prints what the brief asked for ("loud") without moving the exit code
// ("non-blocking") — the three-line integration in main() that the pure-
// function tests above cannot see.

console.log("\n── the real process, spawned: journaling wired end to end ──");

function daemonRoom(): { dir: string; frame: string } {
  const dir = scratch();
  mkdirSync(join(dir, "intake"), { recursive: true });
  mkdirSync(join(dir, "witness-intake"), { recursive: true });
  writeFileSync(join(dir, "roster.json"), JSON.stringify({ "992": "mica-doctor" }));
  const frame = "not-a-real-deposit";
  writeFileSync(join(dir, "intake", frame), "{}"); // malformed on purpose — one REFUSED outcome, honest cargo
  return { dir, frame };
}

function runDaemon(dir: string, extra: readonly string[]): { out: string; status: number | null } {
  const r = spawnSync(
    "npx",
    [
      "ts-node", join(__dirname, "registrard.ts"),
      "--root", dir,
      "--witness-intake", join(dir, "witness-intake"),
      "--witness-set-id", "set-test",
      "--roster", join(dir, "roster.json"),
      ...extra,
    ],
    { encoding: "utf8", cwd: join(__dirname, "..", "..") }
  );
  return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, status: r.status };
}

check("SPAWNED — a real sweep journals a real outcome, prints it, exit unaffected", () => {
  const { dir } = daemonRoom();
  const logPath = join(dir, "mica-log.jsonl");
  const cursorPath = join(dir, "mica-log-cursor.json");
  const noJournal = runDaemon(dir, []);
  const withJournal = runDaemon(daemonRoom().dir, ["--mica-log", logPath, "--mica-log-cursor", cursorPath]);
  assert.strictEqual(withJournal.status, noJournal.status, "journaling must not change this sweep's exit code");
  assert.ok(withJournal.out.includes("| journal        :"), "the journal line must print");
  assert.ok(withJournal.out.includes("record(s) journaled"), withJournal.out);
  const lines = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].sequenceNumber, 0);
  assert.strictEqual(lines[0].moduleId, "mica-registrar");
});

check("SPAWNED — a CORRUPT journal cursor is loud on stderr and does NOT move the sweep's exit code", () => {
  const { dir } = daemonRoom();
  const cursorPath = join(dir, "corrupt-cursor.json");
  writeFileSync(cursorPath, "not json", "utf8");
  const clean = runDaemon(daemonRoom().dir, []);
  const withBadJournal = runDaemon(dir, [
    "--mica-log", join(dir, "mica-log.jsonl"),
    "--mica-log-cursor", cursorPath,
  ]);
  assert.strictEqual(withBadJournal.status, clean.status, "a diary miss must never change the sweep's exit code");
  assert.ok(withBadJournal.out.includes("JOURNAL_CURSOR_CORRUPT"), withBadJournal.out);
  assert.throws(
    () => readFileSync(join(dir, "mica-log.jsonl"), "utf8"),
    /ENOENT/,
    "nothing is appended when the cursor is refused"
  );
});

rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed.\n`);
