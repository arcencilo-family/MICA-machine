// ── MICA · the reconciliation reader — tests (S110-B) ────────────────────────
//
// House style: standalone ts-node script, custom check() harness, no framework.
//   npx ts-node src/report/reconciliation.test.ts
//
// Real files throughout — a real, validly-chained refusal-log (built with the
// module's own `sealRefusalRecord`, exactly what `registrard.ts` produces),
// real `mica-log.jsonl` fixtures, real stamps files. No fixture-only
// ratification claim is made here — T1 is the arbiter's, on the first live
// report print (S109-A's own rule, cited by the brief).

import * as assert from "assert";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  ABSENT_JOURNAL_DECLARATION,
  assessDeclaredJournalReconciliations,
  assessJournalBookReconciliation,
  assessPrincipalJournalReconciliation,
  assessStampShapeReconciliation,
  compareCounts,
  JOURNAL_BOOK_DIVERGENCE,
  loadJournalDeclarations,
  STAMP_SHAPE_DIVERGENCE,
} from "./reconciliation";
import type { CountSource } from "./reconciliation";
import { sealRefusalRecord } from "../registrar/refusal-log";
import type { RefusalLogRecord, RefusalRecordBody } from "../registrar/refusal-log";

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

const root = mkdtempSync(join(tmpdir(), "reconciliation-"));
let n = 0;
function scratch(): string {
  const d = join(root, String(++n));
  mkdirSync(d, { recursive: true });
  return d;
}

// ── a real, validly-chained refusal-log fixture ──────────────────────────────

function refusedBody(frame: string): RefusalRecordBody {
  return {
    ts: 1000,
    kind: "REFUSED",
    reason: "UNKNOWN_DEPOSITOR",
    subject: null,
    subjectUid: null,
    frame,
    detail: "not in the roster",
  };
}
function acceptedBody(frame: string, seq: number): RefusalRecordBody {
  return {
    ts: 1000,
    kind: "ACCEPTED",
    subject: "mica-doctor",
    subjectUid: 992,
    frame,
    book: "mica-doctor",
    bookSeq: seq,
    headHash: `book-head-${seq}`,
    detail: "",
  };
}

/** Writes a REAL, validly-chained refusal-log — exactly what `registrard.ts`
 * produces — with `refused` REFUSED records then `accepted` ACCEPTED records. */
function writeRefusalLog(path: string, refused: number, accepted: number): void {
  const records: RefusalLogRecord[] = [];
  for (let i = 0; i < refused; i++) {
    records.push(sealRefusalRecord(records, refusedBody(`r${String(i)}.json`)));
  }
  for (let i = 0; i < accepted; i++) {
    records.push(sealRefusalRecord(records, acceptedBody(`a${String(i)}.json`, i)));
  }
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

function writeMicaLog(path: string, count: number, moduleId = "mica-registrar"): void {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    lines.push(
      JSON.stringify({
        sequenceNumber: i,
        timestamp: 1000,
        moduleId,
        eventType: "DEPOSIT_ACCEPTED",
        outcome: "COMMITMENT",
      })
    );
  }
  writeFileSync(path, lines.length === 0 ? "" : lines.join("\n") + "\n", "utf8");
}

const GOOD_STAMP = {
  sequenceNumber: 0,
  clerk_seq: 1,
  clerk_time: { wall_ms: 1, monotonic_ns: "1" },
  separation: "SEPARATE_PROCESS",
  intake: "SOCKET",
  clerk_id: "clerk-1",
  clerk_boot_id: "boot-1",
};

function writeStamps(path: string, valid: number, malformed: number): void {
  const lines: string[] = [];
  for (let i = 0; i < valid; i++) lines.push(JSON.stringify({ ...GOOD_STAMP, sequenceNumber: i }));
  for (let i = 0; i < malformed; i++) lines.push(JSON.stringify({ sequenceNumber: i })); // parseable JSON, wrong shape
  writeFileSync(path, lines.length === 0 ? "" : lines.join("\n") + "\n", "utf8");
}

console.log("\n── compareCounts (the shared core) ──");

check("agreement — state null, both counts present, no third word anywhere", () => {
  const a: CountSource = { state: "OK", count: 3, detail: "a" };
  const b: CountSource = { state: "OK", count: 3, detail: "b" };
  const r = compareCounts("X_DIVERGENCE", "A", a, "B", b);
  assert.strictEqual(r.state, null);
  assert.strictEqual(r.countA, 3);
  assert.strictEqual(r.countB, 3);
  assert.strictEqual(r.delta, 0);
});

check("CLAIM-MUST-FAIL — either side CANNOT_ASSESS forces the whole result CANNOT_ASSESS", () => {
  const ok: CountSource = { state: "OK", count: 5, detail: "ok" };
  const bad: CountSource = { state: "CANNOT_ASSESS", detail: "gone" };
  assert.strictEqual(compareCounts("X", "A", bad, "B", ok).state, "CANNOT_ASSESS");
  assert.strictEqual(compareCounts("X", "A", ok, "B", bad).state, "CANNOT_ASSESS");
  // and it never leaks a count from the OK side as if it were a clean read
  const r = compareCounts("X", "A", bad, "B", ok);
  assert.strictEqual(r.countA, null);
  assert.strictEqual(r.countB, 5);
});

console.log("\n── Pair A — journal vs authoritative chain ──");

check("Pair A agreement: equal counts, no divergence, a count on both sides", () => {
  const dir = scratch();
  const chain = join(dir, "chain.jsonl");
  const log = join(dir, "mica-log.jsonl");
  writeRefusalLog(chain, 2, 3); // 5 outcomes
  writeMicaLog(log, 5);
  const r = assessJournalBookReconciliation(chain, log);
  assert.strictEqual(r.state, null);
  assert.strictEqual(r.countA, 5);
  assert.strictEqual(r.countB, 5);
});

check("Pair A divergence — book AHEAD of journal (the F-2 shape exactly)", () => {
  const dir = scratch();
  const chain = join(dir, "chain.jsonl");
  const log = join(dir, "mica-log.jsonl");
  writeRefusalLog(chain, 1, 2); // 3 outcomes recorded
  writeMicaLog(log, 2); // only 2 journaled — the F-2 gap
  const r = assessJournalBookReconciliation(chain, log);
  assert.strictEqual(r.state, JOURNAL_BOOK_DIVERGENCE);
  assert.strictEqual(r.countA, 3);
  assert.strictEqual(r.countB, 2);
  assert.strictEqual(r.delta, 1);
});

check("Pair A divergence — journal AHEAD of book (the other direction, named the same way)", () => {
  const dir = scratch();
  const chain = join(dir, "chain.jsonl");
  const log = join(dir, "mica-log.jsonl");
  writeRefusalLog(chain, 1, 1); // 2 outcomes
  writeMicaLog(log, 4); // journal claims more than the book ever recorded
  const r = assessJournalBookReconciliation(chain, log);
  assert.strictEqual(r.state, JOURNAL_BOOK_DIVERGENCE);
  assert.strictEqual(r.delta, -2);
});

check("Pair A CANNOT_ASSESS — chain absent (never a clean zero)", () => {
  const dir = scratch();
  const log = join(dir, "mica-log.jsonl");
  writeMicaLog(log, 0);
  const r = assessJournalBookReconciliation(join(dir, "nope.jsonl"), log);
  assert.strictEqual(r.state, "CANNOT_ASSESS");
  assert.strictEqual(r.countA, null);
});

check("Pair A CANNOT_ASSESS — chain present but BROKEN (edited), not a clean zero", () => {
  const dir = scratch();
  const chain = join(dir, "chain.jsonl");
  const log = join(dir, "mica-log.jsonl");
  writeRefusalLog(chain, 1, 1);
  writeMicaLog(log, 2);
  appendFileSync(chain, "not json at all\n");
  const r = assessJournalBookReconciliation(chain, log);
  assert.strictEqual(r.state, "CANNOT_ASSESS");
  assert.ok(r.reason.includes("authoritative chain"));
});

check("Pair A CANNOT_ASSESS — journal malformed, not a clean zero", () => {
  const dir = scratch();
  const chain = join(dir, "chain.jsonl");
  const log = join(dir, "mica-log.jsonl");
  writeRefusalLog(chain, 0, 1);
  writeFileSync(log, "{not json\n", "utf8");
  const r = assessJournalBookReconciliation(chain, log);
  assert.strictEqual(r.state, "CANNOT_ASSESS");
});

check("Pair A — LEGACY_POINTER never counts as an outcome", () => {
  const dir = scratch();
  const chain = join(dir, "chain.jsonl");
  const log = join(dir, "mica-log.jsonl");
  const records: RefusalLogRecord[] = [];
  records.push(
    sealRefusalRecord(records, {
      ts: 1,
      kind: "LEGACY_POINTER",
      legacyPath: "old.jsonl",
      legacyHash: "",
      legacyBytes: 0,
      detail: "no unchained log",
    })
  );
  records.push(sealRefusalRecord(records, refusedBody("r0.json")));
  writeFileSync(chain, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  writeMicaLog(log, 1);
  const r = assessJournalBookReconciliation(chain, log);
  assert.strictEqual(r.state, null, "one real outcome vs one journaled — must agree, pointer excluded");
  assert.strictEqual(r.countA, 1);
});

check("Pair A — journal count scoped to mica-registrar's own moduleId only", () => {
  const dir = scratch();
  const chain = join(dir, "chain.jsonl");
  const log = join(dir, "mica-log.jsonl");
  writeRefusalLog(chain, 0, 2);
  writeMicaLog(log, 2);
  appendFileSync(
    log,
    JSON.stringify({ sequenceNumber: 2, timestamp: 1, moduleId: "someone-else", eventType: "X", outcome: "Y" }) + "\n"
  );
  const r = assessJournalBookReconciliation(chain, log);
  assert.strictEqual(r.state, null, "a foreign writer's record must not count against this pair");
  assert.strictEqual(r.countB, 2);
});

console.log("\n── Pair B — attestation line count vs shape-valid count ──");

check("Pair B agreement: all lines shape-valid, no divergence", () => {
  const dir = scratch();
  const stamps = join(dir, "stamps.jsonl");
  writeStamps(stamps, 3, 0);
  const r = assessStampShapeReconciliation(stamps);
  assert.strictEqual(r.state, null);
  assert.strictEqual(r.countA, 3);
  assert.strictEqual(r.countB, 3);
});

check("Pair B divergence — the S109 §E shape exactly: parseable but wrong-shape lines", () => {
  const dir = scratch();
  const stamps = join(dir, "stamps.jsonl");
  writeStamps(stamps, 2, 3); // 2 real stamps + 3 JSON-parseable, shape-invalid lines
  const r = assessStampShapeReconciliation(stamps);
  assert.strictEqual(r.state, STAMP_SHAPE_DIVERGENCE);
  assert.strictEqual(r.countA, 5, "the attestation counts every parseable line");
  assert.strictEqual(r.countB, 2, "the shape check accepts only the real stamps");
  assert.strictEqual(r.delta, 3);
});

check("Pair B CANNOT_ASSESS — no --clerk-stamps-file supplied", () => {
  const r = assessStampShapeReconciliation(null);
  assert.strictEqual(r.state, "CANNOT_ASSESS");
  assert.strictEqual(r.countA, null);
  assert.strictEqual(r.countB, null);
});

check("Pair B CANNOT_ASSESS — file does not exist, never a clean zero", () => {
  const dir = scratch();
  const r = assessStampShapeReconciliation(join(dir, "nope.jsonl"));
  assert.strictEqual(r.state, "CANNOT_ASSESS");
});

console.log("\n── the pair family — any declared principal's journal vs registrar's chain, by uid (S111 generalized) ──");

const DOCTOR_UID = 992; // matches acceptedBody()'s own hardcoded fixture above

/** An ACCEPTED record attributed to an arbitrary subject/uid — the pair
 * family needs fixtures beyond the file's own acceptedBody(), which is
 * pinned to the doctor. */
function acceptedBodyForUid(
  frame: string,
  seq: number,
  subject: string | null,
  subjectUid: number | null
): RefusalRecordBody {
  return {
    ts: 1000,
    kind: "ACCEPTED",
    subject,
    subjectUid,
    frame,
    book: subject ?? "unknown",
    bookSeq: seq,
    headHash: `book-head-${seq}`,
    detail: "",
  };
}

/** A REFUSED record with a KNOWN uid but NO resolved name — the
 * MALFORMED_DEPOSIT / UNKNOWN_DEPOSITOR shape: the kernel saw who owned the
 * frame: subject is null, subjectUid is not. */
function refusedBodyWithUid(frame: string, subjectUid: number | null): RefusalRecordBody {
  return {
    ts: 1000,
    kind: "REFUSED",
    reason: "MALFORMED_DEPOSIT",
    subject: null,
    subjectUid,
    frame,
    detail: "malformed on purpose; the frame's owner uid was still observed",
  };
}

check("agreement — a declared principal's journal matches the registrar's uid-attributed outcomes", () => {
  const dir = scratch();
  const chain = join(dir, "chain.jsonl");
  const log = join(dir, "mica-log.jsonl");
  writeRefusalLog(chain, 0, 3); // 3 ACCEPTED, all subject/uid = the doctor (acceptedBody's own fixture)
  writeMicaLog(log, 3, "mica-doctor");
  const r = assessPrincipalJournalReconciliation("mica-doctor", DOCTOR_UID, log, chain);
  assert.strictEqual(r.state, null);
  assert.strictEqual(r.countA, 3);
  assert.strictEqual(r.countB, 3);
  assert.ok(r.labelA.includes("mica-doctor"), r.labelA);
});

check("divergence — the principal journaled more than the registrar has attributed to it yet", () => {
  const dir = scratch();
  const chain = join(dir, "chain.jsonl");
  const log = join(dir, "mica-log.jsonl");
  writeRefusalLog(chain, 0, 3);
  writeMicaLog(log, 5, "mica-doctor");
  const r = assessPrincipalJournalReconciliation("mica-doctor", DOCTOR_UID, log, chain);
  assert.strictEqual(r.state, JOURNAL_BOOK_DIVERGENCE);
  assert.strictEqual(r.countA, 5);
  assert.strictEqual(r.countB, 3);
  assert.strictEqual(r.delta, 2);
});

check("counts by subjectUid, NEVER by subject — a null-subject record still counts", () => {
  const dir = scratch();
  const chain = join(dir, "chain.jsonl");
  const log = join(dir, "mica-log.jsonl");
  const records: RefusalLogRecord[] = [];
  // one clean ACCEPTED, name resolved
  records.push(sealRefusalRecord(records, acceptedBodyForUid("a0.json", 0, "mica-doctor", DOCTOR_UID)));
  // one REFUSED, name NOT resolved (subject null) but the SAME kernel uid —
  // this is the record the [TG] flag was about. If the code filtered on
  // `subject === "mica-doctor"` instead of subjectUid, this test fails: the
  // count would read 1, not 2.
  records.push(sealRefusalRecord(records, refusedBodyWithUid("r0.json", DOCTOR_UID)));
  writeFileSync(chain, records.map((rec) => JSON.stringify(rec)).join("\n") + "\n", "utf8");
  writeMicaLog(log, 2, "mica-doctor");
  const r = assessPrincipalJournalReconciliation("mica-doctor", DOCTOR_UID, log, chain);
  assert.strictEqual(r.state, null);
  assert.strictEqual(r.countB, 2, "subjectUid must be counted even when subject (the name) is null");
});

check("detail states the subjectUid:null tally — present, prose only, count untouched", () => {
  const dir = scratch();
  const chain = join(dir, "chain.jsonl");
  const log = join(dir, "mica-log.jsonl");
  writeRefusalLog(chain, 2, 3); // 2 REFUSED (subjectUid null, refusedBody's own fixture) + 3 ACCEPTED (uid 992)
  writeMicaLog(log, 3, "mica-doctor");
  const r = assessPrincipalJournalReconciliation("mica-doctor", DOCTOR_UID, log, chain);
  assert.strictEqual(r.state, null);
  assert.strictEqual(r.countB, 3, "the null-subjectUid records must not inflate the attributed count");
  assert.ok(
    r.reason.includes("2 outcome record(s) carry subjectUid null (unattributable)"),
    r.reason
  );
});

check("detail states 0 when no subjectUid:null outcome records are present", () => {
  const dir = scratch();
  const chain = join(dir, "chain.jsonl");
  const log = join(dir, "mica-log.jsonl");
  writeRefusalLog(chain, 0, 3); // no REFUSED records at all — no subjectUid:null source
  writeMicaLog(log, 3, "mica-doctor");
  const r = assessPrincipalJournalReconciliation("mica-doctor", DOCTOR_UID, log, chain);
  assert.strictEqual(r.state, null);
  assert.ok(
    r.reason.includes("0 outcome record(s) carry subjectUid null (unattributable)"),
    r.reason
  );
});

check("ignores outcomes attributed to a DIFFERENT uid", () => {
  const dir = scratch();
  const chain = join(dir, "chain.jsonl");
  const log = join(dir, "mica-log.jsonl");
  const records: RefusalLogRecord[] = [];
  records.push(sealRefusalRecord(records, acceptedBodyForUid("a0.json", 0, "mica-doctor", DOCTOR_UID)));
  records.push(sealRefusalRecord(records, acceptedBodyForUid("a1.json", 1, "mica-doctor", DOCTOR_UID)));
  records.push(sealRefusalRecord(records, acceptedBodyForUid("g0.json", 0, "mica-arbiter", 993)));
  records.push(sealRefusalRecord(records, acceptedBodyForUid("g1.json", 1, "mica-arbiter", 993)));
  records.push(sealRefusalRecord(records, acceptedBodyForUid("g2.json", 2, "mica-arbiter", 993)));
  writeFileSync(chain, records.map((rec) => JSON.stringify(rec)).join("\n") + "\n", "utf8");
  writeMicaLog(log, 2, "mica-doctor");
  const r = assessPrincipalJournalReconciliation("mica-doctor", DOCTOR_UID, log, chain);
  assert.strictEqual(r.state, null);
  assert.strictEqual(r.countB, 2, "a different principal's outcomes must not inflate this one's count");
});

check("a second declared principal (different name, different uid) reads its OWN pair, not the first's", () => {
  const dir = scratch();
  const chain = join(dir, "chain.jsonl");
  const log = join(dir, "mica-log.jsonl");
  const records: RefusalLogRecord[] = [];
  records.push(sealRefusalRecord(records, acceptedBodyForUid("a0.json", 0, "mica-doctor", DOCTOR_UID)));
  records.push(sealRefusalRecord(records, acceptedBodyForUid("g0.json", 0, "mica-arbiter", 993)));
  records.push(sealRefusalRecord(records, acceptedBodyForUid("g1.json", 1, "mica-arbiter", 993)));
  writeFileSync(chain, records.map((rec) => JSON.stringify(rec)).join("\n") + "\n", "utf8");
  writeMicaLog(log, 1, "mica-doctor");
  appendFileSync(
    log,
    [0, 1].map((i) =>
      JSON.stringify({ sequenceNumber: i, timestamp: 1, moduleId: "mica-arbiter", eventType: "DEPOSIT_SUBMITTED", outcome: "COMMITMENT" })
    ).join("\n") + "\n"
  );
  const doctor = assessPrincipalJournalReconciliation("mica-doctor", DOCTOR_UID, log, chain);
  const arbiter = assessPrincipalJournalReconciliation("mica-arbiter", 993, log, chain);
  assert.strictEqual(doctor.state, null);
  assert.strictEqual(doctor.countA, 1);
  assert.strictEqual(doctor.countB, 1);
  assert.strictEqual(arbiter.state, null);
  assert.strictEqual(arbiter.countA, 2);
  assert.strictEqual(arbiter.countB, 2);
});

check("CANNOT_ASSESS — no --log supplied", () => {
  const dir = scratch();
  const chain = join(dir, "chain.jsonl");
  writeRefusalLog(chain, 0, 1);
  const r = assessPrincipalJournalReconciliation("mica-doctor", DOCTOR_UID, null, chain);
  assert.strictEqual(r.state, "CANNOT_ASSESS");
  assert.strictEqual(r.countA, null);
});

check("CANNOT_ASSESS — no --registrar-log supplied", () => {
  const dir = scratch();
  const log = join(dir, "mica-log.jsonl");
  writeMicaLog(log, 1, "mica-doctor");
  const r = assessPrincipalJournalReconciliation("mica-doctor", DOCTOR_UID, log, null);
  assert.strictEqual(r.state, "CANNOT_ASSESS");
  assert.strictEqual(r.countB, null);
});

console.log("\n── the declarations file — loadJournalDeclarations (R-V3, DC-2 precedent) ──");

function declFile(dir: string, obj: unknown): string {
  const p = join(dir, "declared-journals.json");
  writeFileSync(p, JSON.stringify(obj), "utf8");
  return p;
}

check("ABSENT — no path supplied", () => {
  const d = loadJournalDeclarations(null);
  assert.strictEqual(d.state, "ABSENT");
  assert.strictEqual(d.uidByPrincipal.size, 0);
  assert.deepStrictEqual(d, ABSENT_JOURNAL_DECLARATION);
});

check("CONFIGURED_EMPTY — file does not exist, never a clean ABSENT", () => {
  const dir = scratch();
  const d = loadJournalDeclarations(join(dir, "nope.json"));
  assert.strictEqual(d.state, "CONFIGURED_EMPTY");
  assert.ok(d.problems.length > 0);
});

check("CONFIGURED_EMPTY — not a JSON object", () => {
  const dir = scratch();
  const d = loadJournalDeclarations(declFile(dir, ["mica-doctor", 992]));
  assert.strictEqual(d.state, "CONFIGURED_EMPTY");
});

check("CONFIGURED — valid name -> uid pairs", () => {
  const dir = scratch();
  const d = loadJournalDeclarations(declFile(dir, { "mica-doctor": 992, "mica-arbiter": 993 }));
  assert.strictEqual(d.state, "CONFIGURED");
  assert.strictEqual(d.uidByPrincipal.get("mica-doctor"), 992);
  assert.strictEqual(d.uidByPrincipal.get("mica-arbiter"), 993);
});

check("R-V3 — a non-integer or negative uid is skipped, never guessed in its place", () => {
  const dir = scratch();
  const d = loadJournalDeclarations(
    declFile(dir, { "mica-doctor": 992, "mica-bad-float": 1.5, "mica-negative": -1, "mica-string": "992" })
  );
  assert.strictEqual(d.state, "CONFIGURED");
  assert.strictEqual(d.uidByPrincipal.size, 1);
  assert.ok(d.uidByPrincipal.has("mica-doctor"));
  assert.strictEqual(d.problems.length, 3);
});

check("CONFIGURED_EMPTY — every entry invalid leaves zero usable principals", () => {
  const dir = scratch();
  const d = loadJournalDeclarations(declFile(dir, { bad: -1 }));
  assert.strictEqual(d.state, "CONFIGURED_EMPTY");
  assert.strictEqual(d.uidByPrincipal.size, 0);
});

console.log("\n── assessDeclaredJournalReconciliations — the family, driven by the declaration ──");

check("an ABSENT or CONFIGURED_EMPTY declaration yields no readings at all", () => {
  const dir = scratch();
  const log = join(dir, "mica-log.jsonl");
  const chain = join(dir, "chain.jsonl");
  assert.deepStrictEqual(assessDeclaredJournalReconciliations(ABSENT_JOURNAL_DECLARATION, log, chain), []);
  const empty = loadJournalDeclarations(declFile(dir, { bad: -1 }));
  assert.deepStrictEqual(assessDeclaredJournalReconciliations(empty, log, chain), []);
});

check("one reading per declared principal, sorted by name, an undeclared narrator never leaks in", () => {
  const dir = scratch();
  const chain = join(dir, "chain.jsonl");
  const log = join(dir, "mica-log.jsonl");
  const records: RefusalLogRecord[] = [];
  records.push(sealRefusalRecord(records, acceptedBodyForUid("a0.json", 0, "mica-doctor", DOCTOR_UID)));
  records.push(sealRefusalRecord(records, acceptedBodyForUid("g0.json", 0, "mica-arbiter", 993)));
  writeFileSync(chain, records.map((rec) => JSON.stringify(rec)).join("\n") + "\n", "utf8");
  writeMicaLog(log, 1, "mica-doctor");
  appendFileSync(
    log,
    JSON.stringify({ sequenceNumber: 0, timestamp: 1, moduleId: "mica-arbiter", eventType: "DEPOSIT_SUBMITTED", outcome: "COMMITMENT" }) +
      "\n" +
      // an undeclared principal narrating must never inflate a declared pair
      JSON.stringify({ sequenceNumber: 0, timestamp: 1, moduleId: "mica-undeclared", eventType: "DEPOSIT_SUBMITTED", outcome: "COMMITMENT" }) +
      "\n"
  );
  const declaration = loadJournalDeclarations(declFile(dir, { "mica-doctor": DOCTOR_UID, "mica-arbiter": 993 }));
  const readings = assessDeclaredJournalReconciliations(declaration, log, chain);
  assert.strictEqual(readings.length, 2);
  assert.deepStrictEqual(readings.map((r) => r.principal), ["mica-arbiter", "mica-doctor"]);
  const doctorReading = readings.find((r) => r.principal === "mica-doctor");
  const arbiterReading = readings.find((r) => r.principal === "mica-arbiter");
  assert.strictEqual(doctorReading?.uid, DOCTOR_UID);
  assert.strictEqual(doctorReading?.reading.state, null);
  assert.strictEqual(doctorReading?.reading.countA, 1);
  assert.strictEqual(arbiterReading?.uid, 993);
  assert.strictEqual(arbiterReading?.reading.state, null);
  assert.strictEqual(arbiterReading?.reading.countA, 1);
});

console.log("\n── determinism ──");

check("byte-identical on a second render of the same inputs, both pairs", () => {
  const dir = scratch();
  const chain = join(dir, "chain.jsonl");
  const log = join(dir, "mica-log.jsonl");
  const stamps = join(dir, "stamps.jsonl");
  writeRefusalLog(chain, 1, 2);
  writeMicaLog(log, 2);
  writeStamps(stamps, 2, 1);
  const a1 = assessJournalBookReconciliation(chain, log);
  const a2 = assessJournalBookReconciliation(chain, log);
  assert.deepStrictEqual(a1, a2);
  const b1 = assessStampShapeReconciliation(stamps);
  const b2 = assessStampShapeReconciliation(stamps);
  assert.deepStrictEqual(b1, b2);
  const c1 = assessPrincipalJournalReconciliation("mica-doctor", DOCTOR_UID, log, chain);
  const c2 = assessPrincipalJournalReconciliation("mica-doctor", DOCTOR_UID, log, chain);
  assert.deepStrictEqual(c1, c2);
});

rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed.\n`);
