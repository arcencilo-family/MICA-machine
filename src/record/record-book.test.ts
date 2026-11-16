// ── MICA · the record book — tests ───────────────────────────────────────
//
//   npx ts-node src/record/record-book.test.ts
//
// The book's OWN properties, tested without a registrar in the way: the chain,
// the preimage, the closed shapes, and the four load states. The door's side of
// it (entitlement, frames, heads) is in registrar.test.ts's RB block.

import assert from "assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  computeRecordBookHash,
  lookAtRecordFile,
  RecordBook,
  RecordBookRefused,
  recordChainId,
  RECORD_KINDS,
  validateRecordBookRecord,
} from "./record-book";
import { computePrecommitRecordHash } from "../precommit/precommit";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${String(err)}`);
  }
}

const root = mkdtempSync(join(tmpdir(), "mica-recordbook-"));
let n = 0;
function freshPath(): string {
  const dir = join(root, `b${String(n++)}`);
  mkdirSync(dir, { recursive: true });
  return join(dir, "records.jsonl");
}

const ESCALATION = {
  kind: "ESCALATION" as const,
  depositor: "mica-subject1",
  book: "mica-subject1",
  timestamp: 1_700_000_000_000,
  modality: "NOT_AN_INSTRUCTION" as const,
  addressee: "arbiter",
  addresseeVerbatim: "Arbiter.",
  recordNeeded: "An arbiter-issued sunset entry.",
  captureSha256: "a".repeat(64),
  runId: "pilot9-n5",
  scenarioId: "n5-w2-x",
  variant: "STRESS",
};

console.log("\n── RK · the kinds, closed ──");

check("RK-A · three kinds, and the chain id is its own namespace", () => {
  assert.deepStrictEqual([...RECORD_KINDS], ["ESCALATION", "REQUEST", "PILOT_CHAIN_REVIEWED"]);
  assert.strictEqual(recordChainId("mica-subject1"), "record:mica-subject1");
  assert.notStrictEqual(recordChainId("x"), `precommit:x`);
});

console.log("\n── RK · the preimage ──");

check("RK-B · the hash is DOMAIN-SEPARATED from the pre-commitment chain", () => {
  // A record-book hash must never be presentable as a pre-commitment hash. The
  // two functions share a shape for the frame; the leading tag is what stops a
  // record from being carried into the other chain and verifying there.
  const unhashed = {
    ...ESCALATION,
    sequenceNumber: 0,
    previousHash: "",
  };
  const ours = computeRecordBookHash(unhashed);
  const theirs = computePrecommitRecordHash({
    kind: "GRADING",
    sequenceNumber: 0,
    previousHash: "",
    timestamp: unhashed.timestamp,
    modality: unhashed.modality,
    ref: 0,
    graderId: "mica-subject1",
    verdict: "GREEN",
    ground: "x",
  } as never);
  assert.notStrictEqual(ours, theirs);
  assert.ok(/^[0-9a-f]{64}$/.test(ours));
});

check("RK-C · every payload field is IN the preimage — change one, change the hash", () => {
  const base = { ...ESCALATION, sequenceNumber: 0, previousHash: "" };
  const h = computeRecordBookHash(base);
  const fields: readonly (keyof typeof base)[] = [
    "depositor", "book", "addressee", "addresseeVerbatim",
    "recordNeeded", "captureSha256", "runId", "scenarioId", "variant",
  ];
  for (const f of fields) {
    const changed = { ...base, [f]: `${String(base[f])}x` };
    assert.notStrictEqual(computeRecordBookHash(changed), h, String(f));
  }
});

check("RK-D · length-prefixing: moving a byte across a field boundary changes the hash", () => {
  const a = computeRecordBookHash({ ...ESCALATION, sequenceNumber: 0, previousHash: "", addressee: "ab", runId: "c" });
  const b = computeRecordBookHash({ ...ESCALATION, sequenceNumber: 0, previousHash: "", addressee: "a", runId: "bc" });
  assert.notStrictEqual(a, b);
});

console.log("\n── RK · closed shapes, refused rather than repaired ──");

check("RK-E · a record missing a field, or carrying an extra one, does not validate", () => {
  const good = { ...ESCALATION, sequenceNumber: 0, previousHash: "", hash: "x" };
  assert.notStrictEqual(validateRecordBookRecord(good), null);
  const { variant, ...missing } = good;
  assert.strictEqual(validateRecordBookRecord(missing), null);
  assert.strictEqual(validateRecordBookRecord({ ...good, extra: 1 }), null);
  assert.strictEqual(validateRecordBookRecord({ ...good, kind: "SOMETHING" }), null);
  assert.strictEqual(validateRecordBookRecord({ ...good, captureSha256: "short" }), null);
  assert.strictEqual(validateRecordBookRecord({ ...good, depositor: "" }), null);
});

console.log("\n── RK · the four load states ──");

check("RK-F · an ABSENT book is FRESH — a first boot, not a failure", () => {
  const book = new RecordBook({ path: freshPath() });
  assert.strictEqual(book.getLoadState(), "FRESH");
  assert.strictEqual(book.verify().state, "EMPTY");
  assert.strictEqual(lookAtRecordFile(freshPath()).state, "ABSENT");
});

check("RK-G · a missing DIRECTORY is a deployment act, and throws rather than creating one", () => {
  assert.throws(
    () => new RecordBook({ path: join(root, "never-deployed", "records.jsonl") }),
    (err: Error) => {
      assert.ok(err.message.includes("DEPLOYMENT ACT"), err.message);
      assert.ok(err.message.includes("nothing here creates it"), err.message);
      return true;
    }
  );
});

check("RK-H · a written book LOADS and its chain VERIFIES", () => {
  const path = freshPath();
  const book = new RecordBook({ path });
  book.writeAddressed(ESCALATION);
  book.writeAddressed({ ...ESCALATION, kind: "REQUEST", addressee: "doctor", addresseeVerbatim: "doctor" });
  assert.strictEqual(book.getAll().length, 2);
  assert.strictEqual(book.verify().state, "VERIFIED");
  assert.strictEqual(book.countsLine(), "record book: 1 ESCALATION / 1 REQUEST");
  const reopened = new RecordBook({ path });
  assert.strictEqual(reopened.getLoadState(), "LOADED");
  assert.strictEqual(reopened.getAll().length, 2);
  assert.strictEqual(reopened.verify().state, "VERIFIED");
});

check("RK-I · a garbled line makes the book CANNOT_VERIFY — never a quiet short read", () => {
  const path = freshPath();
  writeFileSync(path, "{not json}\n");
  const book = new RecordBook({ path });
  assert.strictEqual(book.getLoadState(), "CANNOT_VERIFY");
  assert.ok((book.getLastError() ?? "").length > 0);
});

console.log("\n── RK · what the book refuses ──");

check("RK-J · no addressee is not a record (R1′); a bad sha is refused before any write", () => {
  const book = new RecordBook({ path: freshPath() });
  assert.throws(
    () => book.writeAddressed({ ...ESCALATION, addressee: "" }),
    (e: Error) => e instanceof RecordBookRefused && /NAMES a seat/.test(e.message)
  );
  assert.throws(
    () => book.writeAddressed({ ...ESCALATION, addresseeVerbatim: "" }),
    (e: Error) => e instanceof RecordBookRefused && /verbatim/.test(e.message)
  );
  assert.throws(
    () => book.writeAddressed({ ...ESCALATION, captureSha256: "nope" }),
    (e: Error) => e instanceof RecordBookRefused && /64 lowercase hex/.test(e.message)
  );
  assert.throws(
    () =>
      book.writeReviewed({
        depositor: "mica-arbiter", book: "mica-arbiter",
        timestamp: 1, modality: "NOT_AN_INSTRUCTION",
        chainSha256: "nope", reviewLogSequenceNumber: 0,
      }),
    (e: Error) => e instanceof RecordBookRefused && /the sha IS the link/.test(e.message)
  );
  // A refused act leaves NO trace: it is not a finding about a record, it is a
  // statement the chain has no shape to hold.
  assert.strictEqual(book.getAll().length, 0);
});

check("RK-K · an IN-MEMORY book says so rather than pretending to persist", () => {
  const book = new RecordBook();
  assert.strictEqual(book.getLoadState(), "IN_MEMORY");
  const out = book.writeAddressed(ESCALATION);
  assert.strictEqual(out.persisted, false);
  assert.ok((out.detail ?? "").includes("IN MEMORY"), String(out.detail));
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
