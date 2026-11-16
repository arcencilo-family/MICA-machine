// ── MICA · the inter-process append contract, graded (S83) ───────────────────
//   npx ts-node src/mica/store/append-store.test.ts
//
// WHAT THIS FILE PROVES
//
//   Two `mica-guard` invocations used to be able to fork any hash-chained append
//   store: each derived a record's sequence number from a chain loaded at
//   construction, and each appended with a bare `appendFileSync`. Both wrote
//   sequence N. `verify()` is positional, so the NEXT load failed, the store went
//   CANNOT_VERIFY, and the chokepoint narrowed every executing disposition to
//   HOLD-BLIND — permanently. It failed closed and it failed for good.
//
//   The lettered checks below are the S83 acceptance set. T-A is split in two,
//   for a reason worth stating: two instances calling record() one after the
//   other never hold the lock AT THE SAME TIME, so "exactly one succeeds" is not
//   what a correct fix produces there — both records land, contiguously, which is
//   strictly better. Genuine contention needs the second writer to attempt while
//   the first is INSIDE the lock, and T-A2 does exactly that through the appender
//   seam. Both properties are load-bearing and neither implies the other.
//
// WHY THE TWO-INSTANCE SETUP IS THE RIGHT PROBE FOR A CROSS-PROCESS DEFECT
//
//   The lock and the append are fs-level, not memory-level: two FloorTrail
//   objects on one path share exactly what two processes share, and share
//   nothing a second process would not. What the setup does NOT exercise is the
//   OS's atomicity for O_CREAT|O_EXCL under true parallelism — that is a kernel
//   guarantee, not this repository's, and a flaky race-the-scheduler test would
//   assert it no more strongly.

import assert from "assert";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  appendLockPath,
  exclusiveFileLock,
  RESYNC_NULL_IS_A_DECLARATION,
  resyncAppendStore,
  storeLines,
} from "./append-store";
import type { ChainedRecord, LockAcquirer } from "./append-store";
import { FloorTrail } from "../chokepoint/floor-trail";
import type { FloorTrailRecordInput } from "../chokepoint/floor-trail";
import { ChokepointLedger } from "../chokepoint/ledger";
import type { ChokepointLedgerRecordInput } from "../chokepoint/ledger";
import { NoticeLog } from "../notify/notice-log";
import type { NoticeLogRecordInput } from "../notify/notice-log";

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

const root = mkdtempSync(join(tmpdir(), "mica-append-lock-"));
let counter = 0;
const fresh = (stem: string): string => join(root, `${stem}-${counter++}.jsonl`);

const input = (actionId: string, timestamp: number): FloorTrailRecordInput => ({
  timestamp,
  actionId,
  disposition: "HOLD",
  floorKind: "ALARM",
  blindSplit: "NOT_APPLICABLE",
  impactClass: "high",
  sensorIds: "sensor-a",
  sensorKinds: "ALARM",
});

const ledgerInput = (actionId: string): ChokepointLedgerRecordInput => ({
  actionId,
  disposition: "PASS_BLIND",
  floorKind: "CANNOT_ASSESS",
  impactClass: "high",
  sensorIds: "sensor-a|sensor-b",
});

const noticeInput = (
  sourceId: string,
  envelopeSequence: number
): NoticeLogRecordInput => ({
  sourceId,
  kind: "RAISING",
  lines: ["a line of the raising"],
  envelopeSequence,
  attempts: [
    { sinkId: "notice-log", role: null, outcome: "ATTEMPTED", detail: "" },
  ],
});

/** The sequence numbers actually on disk, in file order. */
function diskSequence(path: string): number[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => (JSON.parse(line) as { sequenceNumber: number }).sequenceNumber);
}

/** An acquirer that counts, so "took no lock" is provable and not merely likely. */
function countingLock(): { acquirer: LockAcquirer; count: () => number } {
  let calls = 0;
  return {
    acquirer: (lockPath) => {
      calls++;
      return exclusiveFileLock(lockPath);
    },
    count: () => calls,
  };
}

console.log("\n── MICA inter-process append contract (S83) ──────────────────");

// ── the lock primitive ────────────────────────────────────────────────────────

check("the lock file is the store's own name plus .lock, in its own directory", () => {
  assert.strictEqual(appendLockPath("/a/b/trail.jsonl"), "/a/b/trail.jsonl.lock");
});

check("exclusiveFileLock is exclusive, and release removes the file", () => {
  const lockPath = join(root, `primitive-${counter++}.lock`);
  const first = exclusiveFileLock(lockPath);
  assert.strictEqual(first.acquired, true);
  assert.strictEqual(existsSync(lockPath), true, "acquiring did not create the file");

  const second = exclusiveFileLock(lockPath);
  assert.strictEqual(second.acquired, false, "a held lock was handed out twice");
  if (second.acquired) throw new Error("unreachable");
  assert.match(second.reason, /already exists/);

  if (!first.acquired) throw new Error("unreachable");
  first.release();
  assert.strictEqual(existsSync(lockPath), false, "release left the lock file behind");

  const third = exclusiveFileLock(lockPath);
  assert.strictEqual(third.acquired, true, "the lock did not become available again");
  if (third.acquired) third.release();
});

// ── T-A1 · the race, resolved ─────────────────────────────────────────────────

check("T-A1 two instances at the same head produce ONE total order, not a fork", () => {
  const path = fresh("race");
  const a = new FloorTrail({ path });
  const b = new FloorTrail({ path });
  assert.strictEqual(a.getLoadState(), "FIRST_BOOT_OR_ERASED");
  assert.strictEqual(b.getLoadState(), "FIRST_BOOT_OR_ERASED");

  const ra = a.record(input("action-a", 1));
  const rb = b.record(input("action-b", 2));

  assert.strictEqual(ra.persisted, true, `A did not persist: ${String(ra.detail)}`);
  assert.strictEqual(rb.persisted, true, `B did not persist: ${String(rb.detail)}`);
  assert.strictEqual(ra.record.sequenceNumber, 0);
  assert.strictEqual(
    rb.record.sequenceNumber,
    1,
    "B derived its sequence number from its own stale head — this is the defect"
  );
  assert.strictEqual(rb.record.previousHash, ra.record.hash, "B did not link onto A");
  assert.deepStrictEqual(diskSequence(path), [0, 1]);

  const reloaded = new FloorTrail({ path });
  assert.strictEqual(
    reloaded.getLoadState(),
    "LOADED_VERIFIED",
    `reload did not verify: ${String(reloaded.getLastError())}`
  );
  assert.strictEqual(reloaded.length, 2);
  assert.strictEqual(reloaded.verify().valid, true);
  assert.strictEqual(existsSync(appendLockPath(path)), false, "a lock was left behind");
});

// ── T-A2 · genuine contention, while the lock is actually held ────────────────

check("T-A2 a writer that arrives WHILE the lock is held fails typed, writes nothing", () => {
  const path = fresh("contended");
  const a = new FloorTrail({ path });
  const b = new FloorTrail({ path });

  let contended: ReturnType<FloorTrail["record"]> | null = null;
  // The appender runs INSIDE A's critical section. B attempts from there, which
  // is the only same-process way to have two writers hold the same instant.
  const reentrant = new FloorTrail({
    path,
    appender: (p, line) => {
      contended = b.record(input("action-b", 2));
      appendFileSync(p, line, "utf8");
    },
  });
  void a;

  const ra = reentrant.record(input("action-a", 1));
  assert.strictEqual(ra.persisted, true, `A did not persist: ${String(ra.detail)}`);

  const outcome = contended as unknown as ReturnType<FloorTrail["record"]> | null;
  assert.notStrictEqual(outcome, null, "B never attempted");
  const rb = outcome as ReturnType<FloorTrail["record"]>;
  assert.strictEqual(rb.persisted, false, "B wrote through a held lock");
  assert.match(String(rb.detail), /append lock could not be taken/);
  assert.ok(
    String(rb.detail).includes(appendLockPath(path)),
    `the detail does not name the lock path: ${String(rb.detail)}`
  );
  assert.strictEqual(b.length, 0, "B advanced its chain over a record that never landed");
  assert.deepStrictEqual(diskSequence(path), [0], "B's record reached disk anyway");
  assert.strictEqual(existsSync(appendLockPath(path)), false);
});

// ── T-B · catch-up ────────────────────────────────────────────────────────────

check("T-B a stale instance catches up to the true head and links onto it", () => {
  const path = fresh("catchup");
  const a = new FloorTrail({ path });
  const b = new FloorTrail({ path }); // constructed BEFORE A's appends

  const first = a.record(input("a-1", 1));
  const second = a.record(input("a-2", 2));
  assert.strictEqual(first.persisted, true);
  assert.strictEqual(second.persisted, true);
  assert.strictEqual(b.length, 0, "B saw A's appends without asking the disk");

  const rb = b.record(input("b-1", 3));
  assert.strictEqual(rb.persisted, true, `B did not persist: ${String(rb.detail)}`);
  assert.strictEqual(rb.record.sequenceNumber, 2, "B did not catch up");
  assert.strictEqual(rb.record.previousHash, second.record.hash, "B linked onto a stale head");
  assert.strictEqual(b.length, 3, "B adopted the extension but did not keep it");
  assert.deepStrictEqual(diskSequence(path), [0, 1, 2]);

  const reloaded = new FloorTrail({ path });
  assert.strictEqual(reloaded.getLoadState(), "LOADED_VERIFIED");
  assert.strictEqual(reloaded.length, 3);
});

// ── T-C · stale lock ──────────────────────────────────────────────────────────

check("T-C a pre-existing lock fails typed, names the lock, and touches nothing", () => {
  const path = fresh("stale-lock");
  const trail = new FloorTrail({ path });
  const landed = trail.record(input("before", 1));
  assert.strictEqual(landed.persisted, true);

  const lockPath = appendLockPath(path);
  const bytesBefore = statSync(path).size;
  writeFileSync(lockPath, "", "utf8"); // a crash left this behind

  const blocked = trail.record(input("during", 2));
  assert.strictEqual(blocked.persisted, false, "a stale lock did not block the append");
  assert.ok(
    String(blocked.detail).includes(lockPath),
    `the detail does not name the lock path: ${String(blocked.detail)}`
  );
  assert.match(String(blocked.detail), /no expiry and no timer will ever clear it/);
  assert.match(String(blocked.detail), /Do not delete the floor trail itself/);
  assert.strictEqual(trail.length, 1, "the memory prefix advanced over a blocked record");
  assert.strictEqual(statSync(path).size, bytesBefore, "the file changed under a stale lock");
  assert.strictEqual(existsSync(lockPath), true, "the store cleared a lock it did not take");

  // No timer clears it; an external act does. Then appends land contiguously.
  rmSync(lockPath);
  const after = trail.record(input("after", 3));
  assert.strictEqual(after.persisted, true, `did not recover: ${String(after.detail)}`);
  assert.strictEqual(after.record.sequenceNumber, 1);
  assert.deepStrictEqual(diskSequence(path), [0, 1]);
  assert.strictEqual(new FloorTrail({ path }).getLoadState(), "LOADED_VERIFIED");
});

// ── T-D · fail-then-recover, with the lock ────────────────────────────────────

check("T-D a throwing appender releases the lock and leaves the prefix unchanged", () => {
  const path = fresh("fail-recover");
  let throwNext = true;
  const trail = new FloorTrail({
    path,
    appender: (p, line) => {
      if (throwNext) {
        throwNext = false;
        throw new Error("simulated transient write failure");
      }
      appendFileSync(p, line, "utf8");
    },
  });

  const failedAppend = trail.record(input("throws", 1));
  assert.strictEqual(failedAppend.persisted, false);
  assert.match(String(failedAppend.detail), /simulated transient write failure/);
  assert.strictEqual(trail.length, 0, "the chain advanced over a record that never landed");
  assert.strictEqual(existsSync(path), false, "a failing append created the file");
  assert.strictEqual(
    existsSync(appendLockPath(path)),
    false,
    "the lock survived a thrown appender — the store is now bricked by its own fault path"
  );

  const recovered = trail.record(input("lands", 2));
  assert.strictEqual(recovered.persisted, true, `did not recover: ${String(recovered.detail)}`);
  assert.strictEqual(recovered.record.sequenceNumber, 0, "the failed record consumed a sequence number");
  assert.deepStrictEqual(diskSequence(path), [0]);
  assert.strictEqual(new FloorTrail({ path }).getLoadState(), "LOADED_VERIFIED");
});

// ── T-E · a fork already on disk ──────────────────────────────────────────────

check("T-E an append onto an already-forked file is refused, not deepened", () => {
  const path = fresh("already-forked");
  const writer = new FloorTrail({ path });
  const only = writer.record(input("first", 1));
  assert.strictEqual(only.persisted, true);

  const stale = new FloorTrail({ path }); // loaded the one good record
  // Another writer forks the file: a schema-valid record carrying sequence 0 at
  // line 1. This is exactly the shape the S82 defect produced.
  appendFileSync(path, JSON.stringify(only.record) + "\n", "utf8");
  const bytesBefore = statSync(path).size;

  const refused = stale.record(input("onto-the-fork", 2));
  assert.strictEqual(refused.persisted, false, "the store appended onto a fork");
  assert.match(String(refused.detail), /no longer links onto the chain loaded from it/);
  assert.match(String(refused.detail), /appending onto a fork deepens it/);
  assert.match(String(refused.detail), /carries sequence number 0/);
  assert.strictEqual(statSync(path).size, bytesBefore, "bytes were written anyway");
  assert.strictEqual(stale.length, 1, "the forked record was adopted into the chain");
  assert.strictEqual(existsSync(appendLockPath(path)), false, "the lock was not released");
});

// ── T-F · nothing else moved ──────────────────────────────────────────────────

check("T-F in-memory mode takes NO lock and is unchanged", () => {
  const lock = countingLock();
  const trail = new FloorTrail({ acquire: lock.acquirer });
  const outcome = trail.record(input("in-memory", 1));
  assert.strictEqual(outcome.persisted, false);
  assert.match(String(outcome.detail), /IN MEMORY only/);
  assert.match(String(outcome.detail), /integrity but not provenance/);
  assert.strictEqual(trail.length, 1, "an in-memory store must still commit for integrity");
  assert.strictEqual(trail.getLoadState(), "IN_MEMORY");
  assert.strictEqual(lock.count(), 0, "an in-memory store reached for a lock it cannot need");
});

check("T-F not-persisting mode takes NO lock and is unchanged", () => {
  const path = fresh("cannot-verify");
  writeFileSync(path, "this is not JSON\n", "utf8");
  const lock = countingLock();
  const trail = new FloorTrail({ path, acquire: lock.acquirer });
  assert.strictEqual(trail.getLoadState(), "CANNOT_VERIFY");

  const outcome = trail.record(input("refused", 1));
  assert.strictEqual(outcome.persisted, false);
  assert.match(String(outcome.detail), /malformed JSON/);
  assert.strictEqual(trail.length, 0);
  assert.strictEqual(lock.count(), 0, "a non-persisting store reached for a lock");
  assert.strictEqual(existsSync(appendLockPath(path)), false);
  assert.strictEqual(readFileSync(path, "utf8"), "this is not JSON\n", "the file was touched");
});

check("T-F the ordinary single-writer path still appends contiguously", () => {
  const path = fresh("ordinary");
  const trail = new FloorTrail({ path });
  for (let i = 0; i < 5; i++) {
    const outcome = trail.record(input(`a-${String(i)}`, i));
    assert.strictEqual(outcome.persisted, true, `append ${String(i)} did not persist`);
    assert.strictEqual(outcome.record.sequenceNumber, i);
  }
  assert.deepStrictEqual(diskSequence(path), [0, 1, 2, 3, 4]);
  assert.strictEqual(trail.verify().valid, true);
  assert.strictEqual(existsSync(appendLockPath(path)), false);
});

// ── the re-sync, exercised directly ───────────────────────────────────────────

interface Toy extends ChainedRecord {
  readonly value: string;
}
const toyHash = (r: Toy): string =>
  `h:${String(r.sequenceNumber)}:${r.previousHash}:${r.value}`;
const toy = (sequenceNumber: number, previousHash: string, value: string): Toy => {
  const base = { sequenceNumber, previousHash, value, hash: "" };
  return { ...base, hash: toyHash(base as Toy) };
};
const validateToy = (x: unknown): Toy | null => {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.sequenceNumber !== "number") return null;
  if (typeof o.previousHash !== "string") return null;
  if (typeof o.hash !== "string") return null;
  if (typeof o.value !== "string") return null;
  return o as unknown as Toy;
};
function toyFile(records: readonly Toy[]): string {
  const path = fresh("toy");
  writeFileSync(path, records.map((r) => JSON.stringify(r) + "\n").join(""), "utf8");
  return path;
}
function toySpec(path: string, known: readonly Toy[]) {
  return { path, known, validate: validateToy, recomputeHash: toyHash };
}

const t0 = toy(0, "", "zero");
const t1 = toy(1, t0.hash, "one");
const t2 = toy(2, t1.hash, "two");

check("re-sync returns the linking extension and nothing else", () => {
  const result = resyncAppendStore(toySpec(toyFile([t0, t1, t2]), [t0]));
  assert.strictEqual(result.linked, true);
  if (!result.linked) throw new Error("unreachable");
  assert.deepStrictEqual([...result.extension], [t1, t2]);
});

check("re-sync on an unchanged file returns an empty extension", () => {
  const result = resyncAppendStore(toySpec(toyFile([t0, t1]), [t0, t1]));
  assert.strictEqual(result.linked, true);
  if (!result.linked) throw new Error("unreachable");
  assert.deepStrictEqual([...result.extension], []);
});

check("re-sync treats a missing file as first boot ONLY when nothing was loaded", () => {
  const absent = join(root, `never-written-${counter++}.jsonl`);
  const empty = resyncAppendStore(toySpec(absent, []));
  assert.strictEqual(empty.linked, true);

  const erased = resyncAppendStore(toySpec(absent, [t0]));
  assert.strictEqual(erased.linked, false, "an erased file under a loaded chain linked");
  if (erased.linked) throw new Error("unreachable");
  assert.match(erased.detail, /the file is gone/);
});

check("re-sync refuses a file SHORTER than the chain loaded from it", () => {
  const result = resyncAppendStore(toySpec(toyFile([t0]), [t0, t1]));
  assert.strictEqual(result.linked, false);
  if (result.linked) throw new Error("unreachable");
  assert.match(result.detail, /truncated or replaced/);
});

check("re-sync refuses each of the three link failures, and adopts nothing", () => {
  const wrongSequence = resyncAppendStore(
    toySpec(toyFile([t0, toy(7, t0.hash, "misnumbered")]), [t0])
  );
  assert.strictEqual(wrongSequence.linked, false);
  if (wrongSequence.linked) throw new Error("unreachable");
  assert.match(wrongSequence.detail, /carries sequence number 7/);

  const wrongPrevious = resyncAppendStore(
    toySpec(toyFile([t0, toy(1, "not-the-head", "unlinked")]), [t0])
  );
  assert.strictEqual(wrongPrevious.linked, false);
  if (wrongPrevious.linked) throw new Error("unreachable");
  assert.match(wrongPrevious.detail, /does not link onto the record before it/);

  const tampered = { ...t1, value: "rewritten after hashing" };
  const wrongHash = resyncAppendStore(toySpec(toyFile([t0, tampered]), [t0]));
  assert.strictEqual(wrongHash.linked, false);
  if (wrongHash.linked) throw new Error("unreachable");
  assert.match(wrongHash.detail, /does not match its own hash/);
});

check("re-sync refuses a malformed or off-schema line", () => {
  const badJson = fresh("bad-json");
  writeFileSync(badJson, JSON.stringify(t0) + "\n{not json\n", "utf8");
  const malformed = resyncAppendStore(toySpec(badJson, [t0]));
  assert.strictEqual(malformed.linked, false);
  if (malformed.linked) throw new Error("unreachable");
  assert.match(malformed.detail, /line 1 is malformed JSON/);

  const offSchema = fresh("off-schema");
  writeFileSync(offSchema, JSON.stringify(t0) + '\n{"sequenceNumber":1}\n', "utf8");
  const wrongShape = resyncAppendStore(toySpec(offSchema, [t0]));
  assert.strictEqual(wrongShape.linked, false);
  if (wrongShape.linked) throw new Error("unreachable");
  assert.match(wrongShape.detail, /does not match the store's closed schema/);
});

// ── STAGE 2 · the same three properties, per adopting store ───────────────────
//
// The floor trail was the proving ground. The seam is shared, so these ports do
// not re-prove the seam — they prove that each store WIRED it: that its own
// validator and its own hash function reach the re-sync, and that its own record
// derivation moved inside the lock. A store that imported the seam but kept
// deriving its sequence number at construction time would fail A here and only
// here.

check("T-A ledger · two instances at the same head produce ONE total order", () => {
  const path = fresh("ledger-race");
  const a = new ChokepointLedger({ path });
  const b = new ChokepointLedger({ path });
  const ra = a.record(ledgerInput("action-a"));
  const rb = b.record(ledgerInput("action-b"));
  assert.strictEqual(ra.persisted, true, `A did not persist: ${String(ra.detail)}`);
  assert.strictEqual(rb.persisted, true, `B did not persist: ${String(rb.detail)}`);
  assert.strictEqual(rb.record.sequenceNumber, 1, "B derived from its own stale head");
  assert.strictEqual(rb.record.previousHash, ra.record.hash);
  assert.deepStrictEqual(diskSequence(path), [0, 1]);
  const reloaded = new ChokepointLedger({ path });
  assert.strictEqual(
    reloaded.getLoadState(),
    "LOADED_VERIFIED",
    `reload did not verify: ${String(reloaded.getLastError())}`
  );
  assert.strictEqual(existsSync(appendLockPath(path)), false);
});

check("T-C ledger · a pre-existing lock fails typed and names the lock", () => {
  const path = fresh("ledger-stale-lock");
  const ledger = new ChokepointLedger({ path });
  assert.strictEqual(ledger.record(ledgerInput("before")).persisted, true);
  const lockPath = appendLockPath(path);
  const bytesBefore = statSync(path).size;
  writeFileSync(lockPath, "", "utf8");

  const blocked = ledger.record(ledgerInput("during"));
  assert.strictEqual(blocked.persisted, false);
  assert.ok(String(blocked.detail).includes(lockPath), String(blocked.detail));
  assert.match(String(blocked.detail), /Do not delete the chokepoint ledger itself/);
  assert.strictEqual(ledger.length, 1);
  assert.strictEqual(statSync(path).size, bytesBefore);
  rmSync(lockPath);
  assert.strictEqual(ledger.record(ledgerInput("after")).persisted, true);
  assert.deepStrictEqual(diskSequence(path), [0, 1]);
});

check("T-E ledger · an append onto an already-forked file is refused", () => {
  const path = fresh("ledger-forked");
  const writer = new ChokepointLedger({ path });
  const only = writer.record(ledgerInput("first"));
  const stale = new ChokepointLedger({ path });
  appendFileSync(path, JSON.stringify(only.record) + "\n", "utf8");
  const bytesBefore = statSync(path).size;

  const refused = stale.record(ledgerInput("onto-the-fork"));
  assert.strictEqual(refused.persisted, false, "the ledger appended onto a fork");
  assert.match(String(refused.detail), /no longer links onto the chain loaded from it/);
  assert.strictEqual(statSync(path).size, bytesBefore);
  assert.strictEqual(stale.length, 1);
  assert.strictEqual(existsSync(appendLockPath(path)), false);
});

check("T-A notice log · two instances at the same head produce ONE total order", () => {
  const path = fresh("notice-race");
  const a = new NoticeLog({ path });
  const b = new NoticeLog({ path });
  const ra = a.record(noticeInput("source-a", 0));
  const rb = b.record(noticeInput("source-b", 1));
  assert.strictEqual(ra.persisted, true, `A did not persist: ${String(ra.detail)}`);
  assert.strictEqual(rb.persisted, true, `B did not persist: ${String(rb.detail)}`);
  assert.strictEqual(rb.record.sequenceNumber, 1, "B derived from its own stale head");
  assert.strictEqual(rb.record.previousHash, ra.record.hash);
  assert.deepStrictEqual(diskSequence(path), [0, 1]);
  const reloaded = new NoticeLog({ path });
  assert.strictEqual(
    reloaded.getLoadState(),
    "LOADED_VERIFIED",
    `reload did not verify: ${String(reloaded.getLastError())}`
  );
  assert.strictEqual(existsSync(appendLockPath(path)), false);
});

check("T-C notice log · a pre-existing lock fails typed and names the lock", () => {
  const path = fresh("notice-stale-lock");
  const log = new NoticeLog({ path });
  assert.strictEqual(log.record(noticeInput("before", 0)).persisted, true);
  const lockPath = appendLockPath(path);
  const bytesBefore = statSync(path).size;
  writeFileSync(lockPath, "", "utf8");

  const blocked = log.record(noticeInput("during", 1));
  assert.strictEqual(blocked.persisted, false);
  assert.ok(String(blocked.detail).includes(lockPath), String(blocked.detail));
  assert.match(String(blocked.detail), /Do not delete the notice log itself/);
  assert.strictEqual(log.length, 1);
  assert.strictEqual(statSync(path).size, bytesBefore);
  rmSync(lockPath);
  assert.strictEqual(log.record(noticeInput("after", 2)).persisted, true);
  assert.deepStrictEqual(diskSequence(path), [0, 1]);
});

check("T-E notice log · an append onto an already-forked file is refused", () => {
  const path = fresh("notice-forked");
  const writer = new NoticeLog({ path });
  const only = writer.record(noticeInput("first", 0));
  const stale = new NoticeLog({ path });
  appendFileSync(path, JSON.stringify(only.record) + "\n", "utf8");
  const bytesBefore = statSync(path).size;

  const refused = stale.record(noticeInput("onto-the-fork", 1));
  assert.strictEqual(refused.persisted, false, "the notice log appended onto a fork");
  assert.match(String(refused.detail), /no longer links onto the chain loaded from it/);
  assert.strictEqual(statSync(path).size, bytesBefore);
  assert.strictEqual(stale.length, 1);
  assert.strictEqual(existsSync(appendLockPath(path)), false);
});

check("a blocked append commits no head to a witness, in either adopting book", () => {
  const path = fresh("notice-blocked-head");
  const commits: unknown[] = [];
  const log = new NoticeLog({ path, headCommitter: (commit) => commits.push(commit) });
  assert.strictEqual(log.record(noticeInput("landed", 0)).persisted, true);
  assert.strictEqual(commits.length, 1);

  writeFileSync(appendLockPath(path), "", "utf8");
  const blocked = log.record(noticeInput("blocked", 1));
  assert.strictEqual(blocked.persisted, false);
  assert.strictEqual(blocked.headCommitted, false);
  assert.match(String(blocked.headCommitDetail), /not durably persisted/);
  assert.strictEqual(commits.length, 1, "a head was committed over a record that never landed");
  rmSync(appendLockPath(path));
});

check("a non-adoption is a DECLARATION the seam states in full", () => {
  assert.match(RESYNC_NULL_IS_A_DECLARATION, /has NOT adopted/);
  assert.match(RESYNC_NULL_IS_A_DECLARATION, /two concurrent writers will fork its chain/i);
  assert.match(RESYNC_NULL_IS_A_DECLARATION, /not a default/);
});

check("the seam's header states the inter-process contract next to the intra one", () => {
  const source = readFileSync(join(__dirname, "append-store.ts"), "utf8");
  const header = source.slice(0, source.indexOf('import {'));
  assert.match(header, /THE INTER-PROCESS CONTRACT/);
  assert.match(header, /THE LOCK ALONE WOULD NOT FIX IT/);
  assert.match(header, /THE LOCK HAS NO EXPIRY, AND NEVER WILL/);
  assert.match(header, /IN-MEMORY STORES TAKE NO LOCK/);
});

// ── Act A: fsync bite test ───────────────────────────────────────────────────

check("durableLineAppender calls fsyncSync (tripwire against silent deletion)", () => {
  // This is a source-code tripwire, not proof of durability — page-cache flush
  // is not observable in-process and the device is out of reach of any in-process
  // test. This check breaks if fsyncSync is deleted from the appender, alerting
  // to the change. Silent deletion would make all 40 tests still pass.
  const source = readFileSync(join(__dirname, "append-store.ts"), "utf8");
  const appender = source.match(/export const durableLineAppender[^}]+}/s)?.[0] || "";
  const lines = appender.split("\n");
  const hasFsync = lines.some((line) => !line.trim().startsWith("//") && /fsyncSync\s*\(\s*fd\s*\)/.test(line));
  assert.ok(hasFsync, "durableLineAppender must call fsyncSync(fd) on an uncommented line");
});

// ── Act B: CRLF regression test ──────────────────────────────────────────────

check("resync handles CRLF line endings without a false fork", () => {
  // WHAT THIS CHECK DEFENDS: that a CRLF store does not FALSE-FORK because the
  // loader and the re-sync disagreed about where a line ends. That is a claim
  // about the TERMINATOR. It was never a claim about tolerating junk lines, and
  // reading it as one is how the blank-line defect survived — which is why the
  // title no longer says "(consistent with loader)".
  //
  // THE COMMENT THAT USED TO BE HERE WAS FALSE AT BYTES, and the drift is the
  // whole story of T4. It cited "the loader (witness.ts:602) and readback
  // (witness.ts:716)" and claimed resync had been unified with them. At bytes,
  // witness.ts:602 is a closing brace and witness.ts:716 is a call to
  // prepareAndLoadStore. The real sites are:
  //
  //   witness.ts:770-771  the loader   — split(/\r?\n/) then pop ONE trailing ""
  //   witness.ts:884      the readback — split(/\r?\n/).filter(trim) — STILL lax
  //
  // So the witness loader used the POP rule, never a filter, since before this
  // defect existed. The comment broadcast a unification the disk never held, and
  // the bug lived in exactly that gap. BR != TR.
  //
  // THE RULE IS NOW ONE RULE, in the seam and in all three MICA loaders, and it
  // lives in ONE function (`storeLines`, store/append-store.ts): split on
  // /\r?\n/, pop EXACTLY ONE trailing empty element, and every element that
  // remains is a record or the store is refused. The fixture below never contains
  // a blank line, so this check's assertions are unchanged by T4.
  const path = fresh("crlf-store");
  const trail = new FloorTrail({ path });

  const rec1 = trail.record(input("first", 1));
  assert.strictEqual(rec1.persisted, true);

  // Replace the file with CRLF-terminated records, preserving content
  const loaded = readFileSync(path, "utf8");
  writeFileSync(path, loaded.replace(/\n/g, "\r\n"), "utf8");

  // Reload: should read successfully without false fork
  const reloaded = new FloorTrail({ path });
  assert.strictEqual(reloaded.length, 1, "CRLF store should load cleanly");

  // Append: resync should work with CRLF present
  const rec2 = reloaded.record(input("second", 1));
  assert.strictEqual(rec2.persisted, true,
    `resync failed on CRLF store: ${String(rec2.detail)}`);

  // Verify the chain is contiguous (not forked)
  assert.deepStrictEqual(diskSequence(path), [0, 1], "CRLF did not cause fork");
});

// ── T4 · the store line rule: nothing is skipped ─────────────────────────────
//
// The defect: every loader and the re-sync filtered out whitespace-only lines, so
// a file with an inserted blank line still VERIFIED and a writer still extended
// it. For a store whose whole claim is tamper-evidence, ignored bytes ARE the
// defect. These checks pin the rule, its edge, and the refusal.

check("T4-rule · the terminator/interior boundary, stated exactly", () => {
  // ONE trailing newline is the file's terminator and is popped. Every JSONL
  // fixture in this tree ends with one, so a rule that refused it would refuse
  // the repo. A SECOND one leaves an interior empty element and is refused.
  const ok = storeLines('{"a":0}\n{"a":1}\n');
  assert.deepStrictEqual(ok.ok ? [...ok.lines] : null, ['{"a":0}', '{"a":1}']);

  const noTerminator = storeLines('{"a":0}\n{"a":1}');
  assert.deepStrictEqual(
    noTerminator.ok ? [...noTerminator.lines] : null,
    ['{"a":0}', '{"a":1}'],
    "a file with no terminator must read the same as one with exactly one"
  );

  const zero = storeLines("");
  assert.deepStrictEqual(
    zero.ok ? [...zero.lines] : null,
    [],
    "a zero-byte file is zero records — the pop rule IS the empty-file guard"
  );

  const doubled = storeLines('{"a":0}\n{"a":1}\n\n');
  assert.strictEqual(doubled.ok, false, "a second trailing newline is not a terminator");
  assert.strictEqual(doubled.ok === false ? doubled.index : -1, 2);

  const crlf = storeLines('{"a":0}\r\n{"a":1}\r\n');
  assert.deepStrictEqual(crlf.ok ? [...crlf.lines] : null, ['{"a":0}', '{"a":1}']);
});

check("T4-rule · every code point ES .trim() hides is refused — and ZWSP never was", () => {
  // THE HOLE IS NOT THE ZERO-WIDTH SPACE. "​".trim().length === 1, so a ZWSP
  // line always reached JSON.parse and was ALWAYS refused. The hole is the
  // opposite shape: the code points that trim to NOTHING and so vanished from the
  // count. The BOM is the operationally interesting one, because a Windows editor
  // writes it without being asked.
  const invisible = [" ", "\t", "\u000b", "\u000c", "\r", " ", " ",
    " ", " ", " ", " ", " ", " ", " ",
    "　", "﻿"];
  for (const ch of invisible) {
    assert.strictEqual(ch.trim().length, 0, `${JSON.stringify(ch)} is not in the trim set`);
    const scan = storeLines(`{"a":0}\n${ch}\n{"a":1}\n`);
    assert.strictEqual(scan.ok, false, `${JSON.stringify(ch)} was skipped, not refused`);
    assert.strictEqual(scan.ok === false ? scan.index : -1, 1);
  }
  // A REGRESSION GUARD, NOT A PROOF OF THIS REPAIR: this one passed before T4 too.
  assert.strictEqual("​".trim().length, 1, "ZWSP is not whitespace to .trim()");
  const zwsp = storeLines('{"a":0}\n​\n{"a":1}\n');
  assert.strictEqual(zwsp.ok, true, "ZWSP is a line the rule KEEPS — JSON.parse refuses it");
});

check("T4-seam · resyncAppendStore refuses a blank line and names it, with known=[]", () => {
  // record-book.ts has NO loader of its own: its load IS this call with known=[].
  // So this is the shape that store sees, and the reason T4 fixes it for free.
  const line = (i: number): string =>
    JSON.stringify({ sequenceNumber: i, previousHash: i === 0 ? "" : `h${String(i - 1)}`, hash: `h${String(i)}` });
  const validate = (u: unknown): ChainedRecord | null =>
    typeof u === "object" && u !== null && typeof (u as ChainedRecord).hash === "string"
      ? (u as ChainedRecord)
      : null;
  const spec = (path: string): Parameters<typeof resyncAppendStore<ChainedRecord>>[0] => ({
    path,
    known: [],
    validate,
    recomputeHash: (r) => r.hash,
  });

  const cleanPath = fresh("seam-clean");
  writeFileSync(cleanPath, `${line(0)}\n${line(1)}\n`, "utf8");
  const clean = resyncAppendStore<ChainedRecord>(spec(cleanPath));
  assert.strictEqual(clean.linked, true, "the clean twin must be unchanged");
  assert.strictEqual(clean.linked === true ? clean.extension.length : -1, 2);

  const blankPath = fresh("seam-blank");
  writeFileSync(blankPath, `${line(0)}\n\n${line(1)}\n`, "utf8");
  const blank = resyncAppendStore<ChainedRecord>(spec(blankPath));
  assert.strictEqual(blank.linked, false, "a blank line was skipped at the seam");
  assert.strictEqual(blank.linked === false ? blank.torn : undefined, true,
    "the refusal must be marked TORN so it is not reported as a fork");
  assert.match(String(blank.linked === false ? blank.detail : ""), /line 1 of 3 holds no record/);
});

/**
 * The per-store body, run against all three loaders, so a divergence between them
 * is itself a failure. Each store gets: the clean twin unchanged, the blank twin
 * refused by name, the truncated prefix pinned, the writer refused afterwards,
 * and the zero-byte load — the last of which NOTHING pinned before T4.
 */
function gradeStore(
  label: string,
  seed: (path: string) => void,
  load: (path: string) => { state: string; count: number; err: string; append: () => boolean }
): void {
  check(`T4-${label} · the CLEAN twin is unchanged: loads, verifies, still appends`, () => {
    const path = fresh(`${label}-clean`);
    seed(path);
    const s = load(path);
    assert.strictEqual(s.state, "LOADED_VERIFIED", `${label} clean twin did not verify`);
    assert.strictEqual(s.count, 2);
    assert.strictEqual(s.append(), true, `${label} clean twin refused an honest append`);
  });

  check(`T4-${label} · one inserted blank line: VERIFIED before, refused after`, () => {
    const path = fresh(`${label}-blank`);
    seed(path);
    const raw = readFileSync(path, "utf8");
    const cut = raw.indexOf("\n");
    writeFileSync(path, `${raw.slice(0, cut + 1)}\n${raw.slice(cut + 1)}`, "utf8");

    const s = load(path);
    assert.strictEqual(s.state, "CANNOT_VERIFY",
      `${label} loaded a blank-lined file as verified — the defect is back`);
    assert.match(s.err, /line 1 of 3 holds no record/,
      `${label} refused for the wrong reason: ${s.err}`);
    // PINNED, and BETTER than it had to be. These loaders push each record onto
    // the chain INSIDE the parse loop, so a mid-file refusal leaves the prefix
    // behind and getAll() hands out a silently truncated book to any consumer that
    // did not read the load state first. Scanning the WHOLE file for the rule
    // BEFORE the parse loop means a torn store yields NOTHING instead — the empty
    // book is the honest answer, and this assertion is what keeps a later
    // "optimisation" from moving the scan into the loop and reintroducing it.
    // The truncated-prefix hazard survives on other refusal shapes (a malformed
    // record mid-file) and is not T4's to close. [owed -> board]
    assert.strictEqual(s.count, 0, `${label} handed out a truncated book`);
    assert.strictEqual(s.append(), false,
      `${label} appended onto a file it could not verify`);
  });

  check(`T4-${label} · a zero-byte store still loads empty and still appends`, () => {
    // THE CHECK THAT DID NOT EXIST. Before T4 nothing in the five opened test
    // files loaded a zero-byte store: the "empty-file pins" either stop at a
    // stat-only classifier or refuse at EACCES before readFileSync. A builder who
    // removed the filter and got the empty case wrong would have shipped GREEN.
    const path = fresh(`${label}-empty`);
    writeFileSync(path, "", "utf8");
    const s = load(path);
    assert.strictEqual(s.state, "FIRST_BOOT_OR_ERASED",
      `${label} read a zero-byte store as something other than a first boot`);
    assert.strictEqual(s.count, 0);
    assert.strictEqual(s.append(), true, `${label} refused to start an empty book`);
  });

  check(`T4-${label} · a torn tail (the newline landed, the record did not) is refused`, () => {
    // WORSE THAN TODAY, DELIBERATELY, AND PRICED: this file loads clean today and
    // is refused after. Correct under F2 — never continue from an uncommitted
    // tail — but for the floor trail it closes the gate on every RELEASE until an
    // operator looks. See the receipt.
    const path = fresh(`${label}-torn`);
    seed(path);
    appendFileSync(path, "\n", "utf8");
    const s = load(path);
    assert.strictEqual(s.state, "CANNOT_VERIFY", `${label} accepted a torn tail`);
    assert.strictEqual(s.append(), false);
  });
}

gradeStore(
  "ledger",
  (path) => {
    const b = new ChokepointLedger({ path });
    b.record(ledgerInput("seed-0"));
    b.record(ledgerInput("seed-1"));
  },
  (path) => {
    const b = new ChokepointLedger({ path });
    const state = b.getLoadState();
    const count = b.getAll().length;
    const err = b.getLastError() ?? "";
    return { state, count, err, append: () => b.record(ledgerInput("after")).persisted };
  }
);

gradeStore(
  "floor-trail",
  (path) => {
    const b = new FloorTrail({ path });
    b.record(input("seed-0", 1));
    b.record(input("seed-1", 2));
  },
  (path) => {
    const b = new FloorTrail({ path });
    const state = b.getLoadState();
    const count = b.getAll().length;
    const err = b.getLastError() ?? "";
    return { state, count, err, append: () => b.record(input("after", 3)).persisted };
  }
);

gradeStore(
  "notice-log",
  (path) => {
    const b = new NoticeLog({ path });
    b.record(noticeInput("seed", 0));
    b.record(noticeInput("seed", 1));
  },
  (path) => {
    const b = new NoticeLog({ path });
    const state = b.getLoadState();
    const count = b.getAll().length;
    const err = b.getLastError() ?? "";
    return { state, count, err, append: () => b.record(noticeInput("after", 2)).persisted };
  }
);

check("T4-message · a torn file is NOT reported as a fork, and the fork message is untouched", () => {
  // The arbiter's ruling, made mechanical. A blank line arriving with "Another writer
  // has already forked this file" sends the operator to hunt a process that does
  // not exist. The blank-line refusal is therefore a NEW branch with a NEW string;
  // forkedOnDiskDetail is unchanged, and the checks at :333-335, :545 and :600
  // that pin its wording are untouched.
  //
  // The path exercised here is the one where a store LOADED cleanly and the file
  // gained a blank line before the next append — so the re-sync, not the loader,
  // is what meets it.
  const path = fresh("torn-message");
  const trail = new FloorTrail({ path });
  assert.strictEqual(trail.record(input("before", 1)).persisted, true);

  appendFileSync(path, "\n", "utf8"); // a newline with no record behind it
  const outcome = trail.record(input("after", 2));

  assert.strictEqual(outcome.persisted, false, "appended onto a torn file");
  const detail = String(outcome.detail);
  assert.match(detail, /is TORN and was not extended/);
  assert.match(detail, /nothing about this implies a second writer/);
  assert.ok(
    !detail.includes("Another writer has already forked this file"),
    `the operator was told about a fork over a blank line: ${detail}`
  );
});

rmSync(root, { recursive: true, force: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
