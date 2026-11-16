// ── MICA · notice sinks — the suite ──────────────────────────────────────────
//
// What this file is asked to prove, beyond the ordinary shape checks:
//
//   · the fan-out NEVER short-circuits (one sink throws, the others still run);
//   · the vocabulary fence actually catches a banned word, proven on a synthetic
//     string before it is trusted to report none in the real source;
//   · the roster type CANNOT express priority, delay, or ordering — read off its
//     own source, so the impossibility survives a later edit;
//   · MICA ships no wire: no transport import exists anywhere in this module;
//   · the R8 limit is stated as a passing test rather than as a paragraph.

import assert from "assert";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

import { lookAtNoticeLogFile, cannotSeeNoticeLogMessage } from "./notice-log";
import { join } from "path";

import { BatchedNotifier } from "../chokepoint";
import { fileDropHeadCommitter } from "../chokepoint/floor-trail";
import {
  ATTEMPT_IS_THE_CEILING,
  AN_ADDRESS_IS_NOT_A_ROUTE,
  CENSUS_HAS_NO_CONSUMER_YET,
  CENSUS_IS_NOT_A_VERDICT,
  ComposedNotifier,
  HEAD_COMMIT_SINK_ID,
  MICA_OBSERVES_A_FUNCTION_NEVER_A_WIRE,
  NOTICE_LOG_SINK_ID,
  NOTIFY_SCOPE_LINES,
  NoticeLog,
  NoticeSinks,
  PLACEHOLDER_ROSTER,
  RECIPIENT_ROLES,
  SYMMETRIC_BROADCAST,
  TOTAL_BLINDNESS_LINE,
  channelSinkId,
  composeNoticeSinks,
  computeNoticeRecordHash,
  envelopeFromBatchNotice,
  isPlaceholderAddress,
  reachedNoConfiguredSink,
  renderCensus,
  renderRaise,
} from "./index";
import type {
  DeliveryAttempt,
  NoticeEnvelope,
  Roster,
  Transport,
} from "./index";

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

const root = mkdtempSync(join(tmpdir(), "mica-notify-"));
let counter = 0;
function scratch(stem: string): string {
  const dir = join(root, `${stem}-${counter++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A roster whose addresses are NOT the shipped placeholders, yet still cannot
 *  resolve: `.invalid` per RFC 6761 and the NANP fiction range. */
const DEPLOYED_ROSTER: Roster = [
  { role: "doctor", address: "https://doctor.deployed.invalid/raise" },
  { role: "arbiter", address: "https://arbiter.deployed.invalid/raise" },
  { role: "operator", address: "tel:+1-555-0142" },
];

function envelope(sequence = 0): NoticeEnvelope {
  return {
    sourceId: "MICA/test",
    kind: "TEST_RAISING",
    lines: ["one line", "another line"],
    sequence,
  };
}

function byRole(attempts: readonly DeliveryAttempt[], role: string): DeliveryAttempt {
  const found = attempts.find((a) => a.role === role);
  assert.ok(found !== undefined, `no attempt for role ${role}`);
  return found;
}

function bySink(attempts: readonly DeliveryAttempt[], sinkId: string): DeliveryAttempt {
  const found = attempts.find((a) => a.sinkId === sinkId);
  assert.ok(found !== undefined, `no attempt for sink ${sinkId}`);
  return found;
}

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── MICA notice sinks · the envelope and the adapter ───────────");

check("the adapter carries every BatchNotice field and invents nothing", () => {
  const env = envelopeFromBatchNotice(
    { count: 4, totalSoFar: 29, message: "the shipped notice text" },
    7
  );
  assert.strictEqual(env.sequence, 7);
  assert.strictEqual(env.kind, "PASS_BLIND_BATCH");
  assert.ok(env.lines.includes("count=4"));
  assert.ok(env.lines.includes("totalSoFar=29"));
  assert.ok(env.lines.includes("the shipped notice text"));
});

check("the envelope carries no clock field of any kind", () => {
  const env = envelopeFromBatchNotice({ count: 1, totalSoFar: 1, message: "m" }, 0);
  for (const key of Object.keys(env)) {
    assert.ok(
      !/^(ts|time|timestamp|clock|date)$/i.test(key),
      `envelope grew a clock field: ${key}`
    );
  }
  // Comments are stripped first: this module's prose EXPLAINS why it does not
  // read a clock, and naming `Date.now()` in order to say "not that" must not
  // register as reading one. The check is on code, where it belongs.
  for (const file of notifyFiles()) {
    const code = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/\bDate\s*[.(]/.test(code), `${file} reads a wall clock`);
    assert.ok(!/\bprocess\.hrtime\b/.test(code), `${file} reads a wall clock`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the roster · symmetric broadcast, enforced by the type ─────");

check("the roster type has exactly two fields and cannot express timing", () => {
  const source = readFileSync(join(__dirname, "types.ts"), "utf8");
  const start = source.indexOf("export interface RecipientEntry {");
  const end = source.indexOf("}", start);
  assert.ok(start >= 0 && end > start, "RecipientEntry not found");
  const body = source.slice(start, end);
  for (const banned of [
    "priority",
    "delay",
    "order",
    "rank",
    "after",
    "timeout",
    "escalat",
    "retry",
    "weight",
  ]) {
    assert.ok(
      !new RegExp(`\\b${banned}`, "i").test(body),
      `RecipientEntry can express ${banned} — MICA would be encoding the hierarchy`
    );
  }
  const fields = body.match(/^\s{2}readonly\s+(\w+)/gm) ?? [];
  assert.strictEqual(
    fields.length,
    2,
    `RecipientEntry has ${String(fields.length)} fields; it must carry role and address only`
  );
});

check("every declared role appears on the shipped roster, exactly once", () => {
  assert.deepStrictEqual(
    PLACEHOLDER_ROSTER.map((e) => e.role).sort(),
    [...RECIPIENT_ROLES].sort()
  );
});

check("the fan-out walks the roster in its declared order and adds nothing", () => {
  // Order here is the ARRAY's, not a priority. Reversing the roster reverses the
  // attempt order and changes nothing else — which is what "no ordering
  // semantics" means operationally.
  const forward = new NoticeSinks({ roster: DEPLOYED_ROSTER }).raise(envelope());
  const backward = new NoticeSinks({
    roster: [...DEPLOYED_ROSTER].reverse(),
  }).raise(envelope());
  const outcomes = (r: { attempts: readonly DeliveryAttempt[] }) =>
    r.attempts.filter((a) => a.role !== null).map((a) => a.outcome);
  assert.deepStrictEqual([...outcomes(forward)].sort(), [...outcomes(backward)].sort());
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the addresses MICA ships cannot work, on purpose ───────────");

/** Every `.ts` in this module. */
function notifyFiles(): string[] {
  return readdirSync(__dirname)
    .filter((n) => n.endsWith(".ts"))
    .map((n) => join(__dirname, n))
    .sort();
}

check("no URL literal anywhere in this module names anything but a .invalid host", () => {
  const offenders: string[] = [];
  for (const file of notifyFiles()) {
    const source = readFileSync(file, "utf8");
    for (const url of source.match(/https?:\/\/[^\s"'`)]+/g) ?? []) {
      const host = url.replace(/^https?:\/\//, "").split(/[/:?#]/)[0];
      if (!host.endsWith(".invalid")) offenders.push(`${file}: ${url}`);
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `a resolvable-looking host appears in notify/: ${offenders.join(", ")} — ` +
      `an address the deployer must overwrite beats one that plausibly works`
  );
});

check("no live top-level domain literal appears anywhere in this module", () => {
  const offenders: string[] = [];
  for (const file of notifyFiles()) {
    const source = readFileSync(file, "utf8");
    const hits = source.match(/\b[a-z0-9-]+\.(?:com|org|net|io|ai|dev|co|app|me)\b/gi) ?? [];
    for (const hit of hits) offenders.push(`${file}: ${hit}`);
  }
  assert.deepStrictEqual(offenders, [], `live domain literal(s): ${offenders.join(", ")}`);
});

check("every telephone-shaped literal sits in the NANP fiction range 555-0100..0199", () => {
  const offenders: string[] = [];
  for (const file of notifyFiles()) {
    const source = readFileSync(file, "utf8");
    for (const hit of source.match(/\b\d{3}-\d{4}\b/g) ?? []) {
      const [exchange, line] = hit.split("-");
      const n = Number(line);
      if (exchange !== "555" || n < 100 || n > 199) offenders.push(`${file}: ${hit}`);
    }
  }
  assert.deepStrictEqual(offenders, [], `outside the fiction range: ${offenders.join(", ")}`);
});

check("a shipped placeholder is recognised as one; a deployed address is not", () => {
  for (const entry of PLACEHOLDER_ROSTER) {
    assert.strictEqual(isPlaceholderAddress(entry.address), true, entry.address);
  }
  for (const entry of DEPLOYED_ROSTER) {
    assert.strictEqual(isPlaceholderAddress(entry.address), false, entry.address);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── MICA ships NO transport ────────────────────────────────────");

check("no file in this module imports a network module of any kind", () => {
  const offenders: string[] = [];
  for (const file of notifyFiles()) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const structural = /^\s*(?:import\b|export\b|\}\s*from\b)/.test(line);
      if (!structural && !line.includes("require(")) continue;
      const re = /(?:from\s*|require\()\s*["']([^"']+)["']/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        if (/^(?:node:)?(?:http|https|net|tls|dgram|http2)$/.test(m[1])) {
          offenders.push(`${file} → ${m[1]}`);
        }
      }
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `notify/ opened a wire: ${offenders.join(", ")} — the deployer owns the wire, ` +
      `and a reference implementation belongs in tools/, outside src/`
  );
});

check("with no transport injected every human channel is NOT_CONFIGURED", () => {
  const result = new NoticeSinks({ roster: DEPLOYED_ROSTER }).raise(envelope());
  for (const role of RECIPIENT_ROLES) {
    assert.strictEqual(byRole(result.attempts, role).outcome, "NOT_CONFIGURED");
  }
});

check("a shipped placeholder address is NOT_CONFIGURED even WITH a transport", () => {
  const transport: Transport = () => ({ detail: "202" });
  const result = new NoticeSinks({ transport }).raise(envelope());
  for (const role of RECIPIENT_ROLES) {
    const attempt = byRole(result.attempts, role);
    assert.strictEqual(attempt.outcome, "NOT_CONFIGURED", role);
    assert.match(attempt.detail, /placeholder/);
  }
});

check("a transport that returns is ATTEMPTED, and its detail is transport acceptance", () => {
  const transport: Transport = (address) => ({ detail: `202 for ${address}` });
  const result = new NoticeSinks({ roster: DEPLOYED_ROSTER, transport }).raise(envelope());
  const doctor = byRole(result.attempts, "doctor");
  assert.strictEqual(doctor.outcome, "ATTEMPTED");
  assert.match(doctor.detail, /transport acceptance: 202 for https:\/\/doctor\.deployed\.invalid/);
});

check("a transport that throws is FAILED, and is called exactly once per role", () => {
  let calls = 0;
  const transport: Transport = () => {
    calls++;
    throw new Error("EAI_AGAIN");
  };
  const result = new NoticeSinks({ roster: DEPLOYED_ROSTER, transport }).raise(envelope());
  assert.strictEqual(calls, 3, "one attempt per role, no retries");
  for (const role of RECIPIENT_ROLES) {
    const attempt = byRole(result.attempts, role);
    assert.strictEqual(attempt.outcome, "FAILED", role);
    assert.match(attempt.detail, /EAI_AGAIN/);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the fan-out NEVER short-circuits ───────────────────────────");

check("one channel throwing does not prevent any other channel's attempt", () => {
  const touched: string[] = [];
  const transport: Transport = (address) => {
    touched.push(address);
    if (address.includes("doctor")) throw new Error("doctor's wire is down");
    return { detail: "202" };
  };
  const path = join(scratch("no-short-circuit"), "notices.jsonl");
  const result = new NoticeSinks({
    roster: DEPLOYED_ROSTER,
    transport,
    noticeLog: new NoticeLog({ path }),
  }).raise(envelope());

  assert.strictEqual(touched.length, 3, "every roster entry was attempted");
  assert.strictEqual(byRole(result.attempts, "doctor").outcome, "FAILED");
  assert.strictEqual(byRole(result.attempts, "arbiter").outcome, "ATTEMPTED");
  assert.strictEqual(byRole(result.attempts, "operator").outcome, "ATTEMPTED");
  assert.strictEqual(bySink(result.attempts, NOTICE_LOG_SINK_ID).outcome, "ATTEMPTED");
});

check("the book still records when EVERY channel throws", () => {
  const transport: Transport = () => {
    throw new Error("the whole network is gone");
  };
  const path = join(scratch("all-throw"), "notices.jsonl");
  const log = new NoticeLog({ path });
  const result = new NoticeSinks({ roster: DEPLOYED_ROSTER, transport, noticeLog: log }).raise(
    envelope()
  );
  assert.strictEqual(bySink(result.attempts, NOTICE_LOG_SINK_ID).outcome, "ATTEMPTED");
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log.getAll()[0].attempts.filter((a) => a.outcome === "FAILED").length, 3);
});

check("the book record carries the envelope AND every sibling channel attempt", () => {
  const transport: Transport = () => ({ detail: "202" });
  const path = join(scratch("carries"), "notices.jsonl");
  const log = new NoticeLog({ path });
  new NoticeSinks({ roster: DEPLOYED_ROSTER, transport, noticeLog: log }).raise(envelope(11));
  const record = log.getAll()[0];
  assert.strictEqual(record.sourceId, "MICA/test");
  assert.strictEqual(record.envelopeSequence, 11);
  assert.deepStrictEqual([...record.lines], ["one line", "another line"]);
  assert.deepStrictEqual(
    record.attempts.map((a) => a.sinkId).sort(),
    RECIPIENT_ROLES.map((r) => channelSinkId({ role: r, address: "" })).sort()
  );
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the notice log · chained, durable, and honest about it ─────");

check("the chain links, and verify() confirms it", () => {
  const path = join(scratch("chain"), "notices.jsonl");
  const log = new NoticeLog({ path });
  const sinks = new NoticeSinks({ noticeLog: log });
  sinks.raise(envelope(0));
  sinks.raise(envelope(1));
  sinks.raise(envelope(2));
  const all = log.getAll();
  assert.strictEqual(all.length, 3);
  assert.strictEqual(all[0].previousHash, "");
  assert.strictEqual(all[1].previousHash, all[0].hash);
  assert.strictEqual(all[2].previousHash, all[1].hash);
  assert.deepStrictEqual(log.verify(), { valid: true, brokenAt: null });
});

check("a record edited on disk is loud on reload, never quietly accepted", () => {
  const dir = scratch("tamper");
  const path = join(dir, "notices.jsonl");
  const log = new NoticeLog({ path });
  new NoticeSinks({ noticeLog: log }).raise(envelope());
  const raw = readFileSync(path, "utf8");
  writeFileSync(path, raw.replace("one line", "ONE LINE"), "utf8");
  const reloaded = new NoticeLog({ path });
  assert.strictEqual(reloaded.getLoadState(), "CANNOT_VERIFY");
  assert.match(String(reloaded.getLastError()), /chain verification failed at index 0/);
});

check("the hash covers the attempts, not only the envelope", () => {
  const base = {
    sourceId: "s",
    kind: "k",
    lines: ["l"],
    envelopeSequence: 0,
    sequenceNumber: 0,
    previousHash: "",
  };
  const attempted: readonly DeliveryAttempt[] = [
    { sinkId: "channel:doctor", role: "doctor", outcome: "ATTEMPTED", detail: "d" },
  ];
  const notConfigured: readonly DeliveryAttempt[] = [
    { sinkId: "channel:doctor", role: "doctor", outcome: "NOT_CONFIGURED", detail: "d" },
  ];
  assert.notStrictEqual(
    computeNoticeRecordHash({ ...base, attempts: attempted }),
    computeNoticeRecordHash({ ...base, attempts: notConfigured })
  );
});

check("the length-prefixed preimage cannot be forged by moving content across fields", () => {
  const a = computeNoticeRecordHash({
    sourceId: "s",
    kind: "k",
    lines: ["ab", "c"],
    envelopeSequence: 0,
    attempts: [],
    sequenceNumber: 0,
    previousHash: "",
  });
  const b = computeNoticeRecordHash({
    sourceId: "s",
    kind: "k",
    lines: ["a", "bc"],
    envelopeSequence: 0,
    attempts: [],
    sequenceNumber: 0,
    previousHash: "",
  });
  assert.notStrictEqual(a, b);
});

check("with no path the book is IN_MEMORY and says so in the attempt", () => {
  const result = new NoticeSinks().raise(envelope());
  const attempt = bySink(result.attempts, NOTICE_LOG_SINK_ID);
  assert.strictEqual(attempt.outcome, "NOT_CONFIGURED");
  assert.match(attempt.detail, /IN MEMORY only/);
});

check("a failing appender leaves the committed prefix unchanged and reports FAILED", () => {
  const path = join(scratch("append-fail"), "notices.jsonl");
  let explode = false;
  const log = new NoticeLog({
    path,
    appender: (p, line) => {
      if (explode) throw new Error("ENOSPC");
      writeFileSync(p, line, { flag: "a", encoding: "utf8" });
    },
  });
  const sinks = new NoticeSinks({ noticeLog: log });
  sinks.raise(envelope(0));
  assert.strictEqual(log.length, 1);
  explode = true;
  const failedRaise = sinks.raise(envelope(1));
  assert.strictEqual(log.length, 1, "the chain did not advance over a record that never landed");
  assert.strictEqual(bySink(failedRaise.attempts, NOTICE_LOG_SINK_ID).outcome, "FAILED");
  explode = false;
  sinks.raise(envelope(2));
  assert.strictEqual(log.length, 2, "the book recovers and appends contiguously");
  assert.deepStrictEqual(log.verify(), { valid: true, brokenAt: null });
});

check("a reopened book continues the chain rather than restarting it", () => {
  const dir = scratch("reopen");
  const path = join(dir, "notices.jsonl");
  new NoticeSinks({ noticeLog: new NoticeLog({ path }) }).raise(envelope(0));
  const second = new NoticeLog({ path });
  assert.strictEqual(second.getLoadState(), "LOADED_VERIFIED");
  new NoticeSinks({ noticeLog: second }).raise(envelope(1));
  assert.strictEqual(second.length, 2);
  assert.strictEqual(second.getAll()[1].sequenceNumber, 1);
  assert.deepStrictEqual(second.verify(), { valid: true, brokenAt: null });
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the head commit · the pattern the floor trail already uses ─");

check("no head committer injected is NOT_CONFIGURED, and says rewriting is not loud", () => {
  const result = new NoticeSinks({
    noticeLog: new NoticeLog({ path: join(scratch("no-head"), "n.jsonl") }),
  }).raise(envelope());
  const attempt = bySink(result.attempts, HEAD_COMMIT_SINK_ID);
  assert.strictEqual(attempt.outcome, "NOT_CONFIGURED");
  assert.match(attempt.detail, /rewriting it is not loud/);
});

check("a durable append commits the head, and the drop is a valid head-commit shape", () => {
  const dir = scratch("head");
  const intakeDir = join(dir, "intake");
  const submitterId = "mica-notify";
  // The producer does NOT create this. The intake's permissions are a deployment
  // act (`3730`, group `mica-drops`), never guessed by a submitter.
  mkdirSync(intakeDir, { recursive: true });
  const log = new NoticeLog({
    path: join(dir, "notices.jsonl"),
    headCommitter: fileDropHeadCommitter(intakeDir, submitterId),
    witnessSetId: "set-alpha",
    // S88: the deployer's R8 declaration, stamped onto every head this book
    // commits. A notice log is a MACHINE book, so one value serves every entry.
    modality: "NOT_AN_INSTRUCTION",
  });
  const result = new NoticeSinks({ noticeLog: log }).raise(envelope());
  assert.strictEqual(bySink(result.attempts, HEAD_COMMIT_SINK_ID).outcome, "ATTEMPTED");
  assert.deepStrictEqual(readdirSync(intakeDir), [submitterId]);
  const commit = JSON.parse(readFileSync(join(intakeDir, submitterId), "utf8")) as Record<
    string,
    unknown
  >;
  assert.deepStrictEqual(Object.keys(commit).sort(), [
    "head_hash",
    "modality",
    "seq_no",
    "ts",
    "witness_set_id",
  ]);
  assert.strictEqual(commit.head_hash, log.getAll()[0].hash);
  assert.strictEqual(commit.seq_no, 0);
  assert.strictEqual(commit.witness_set_id, "set-alpha");
  assert.strictEqual(commit.modality, "NOT_AN_INSTRUCTION");
});

check("S88 · an UNDECLARED modality on a machine book is carried, never invented", () => {
  // A `NoticeLog` built with no `modality` carries `NOT_AN_INSTRUCTION`, and the
  // census PRINTS THE VALUE rather than the fact that one exists. The
  // deployment-facing option (`WireOptions.witnessIntake.modality`) is
  // type-REQUIRED — this default serves in-process callers, not deployers.
  const dir = scratch("head-default-modality");
  const intakeDir = join(dir, "intake");
  mkdirSync(intakeDir, { recursive: true });
  const log = new NoticeLog({
    path: join(dir, "notices.jsonl"),
    headCommitter: fileDropHeadCommitter(intakeDir, "mica-notify"),
  });
  assert.strictEqual(log.declaredModality, "NOT_AN_INSTRUCTION");
  new NoticeSinks({ noticeLog: log }).raise(envelope());
  const commit = JSON.parse(readFileSync(join(intakeDir, "mica-notify"), "utf8"));
  assert.strictEqual(commit.modality, "NOT_AN_INSTRUCTION");
});

check("S88 · a DECLARED modality reaches every head this book commits", () => {
  const dir = scratch("head-imposed");
  const intakeDir = join(dir, "intake");
  mkdirSync(intakeDir, { recursive: true });
  const log = new NoticeLog({
    path: join(dir, "notices.jsonl"),
    headCommitter: fileDropHeadCommitter(intakeDir, "mica-notify"),
    modality: "IMPOSED",
  });
  const sinks = new NoticeSinks({ noticeLog: log });
  sinks.raise(envelope());
  assert.strictEqual(
    JSON.parse(readFileSync(join(intakeDir, "mica-notify"), "utf8")).modality,
    "IMPOSED"
  );
  // EVERY head, not only the first: a machine book's declaration does not drift.
  sinks.raise(envelope());
  assert.strictEqual(
    JSON.parse(readFileSync(join(intakeDir, "mica-notify"), "utf8")).modality,
    "IMPOSED"
  );
  assert.strictEqual(sinks.census().declaredModality, "IMPOSED");
});

check("last-writer-wins on the drop is the head semantics, not a loss", () => {
  const dir = scratch("head-overwrite");
  const intakeDir = join(dir, "intake");
  const submitterId = "mica-notify";
  // The producer does NOT create this. The intake's permissions are a deployment
  // act (`3730`, group `mica-drops`), never guessed by a submitter.
  mkdirSync(intakeDir, { recursive: true });
  const log = new NoticeLog({
    path: join(dir, "notices.jsonl"),
    headCommitter: fileDropHeadCommitter(intakeDir, submitterId),
  });
  const sinks = new NoticeSinks({ noticeLog: log });
  sinks.raise(envelope(0));
  sinks.raise(envelope(1));
  // One drop file, carrying the LATER head. A head at a later seq constrains a
  // LONGER prefix of the same chain, so the newer commit is the one to keep —
  // and both raisings are in the book regardless.
  assert.deepStrictEqual(readdirSync(intakeDir), [submitterId]);
  const commit = JSON.parse(readFileSync(join(intakeDir, submitterId), "utf8")) as {
    seq_no: number;
  };
  assert.strictEqual(commit.seq_no, 1);
  assert.strictEqual(log.length, 2);
});

check("no head is committed over a record that never reached disk", () => {
  const dir = scratch("head-no-durable");
  const intakeDir = join(dir, "intake");
  const log = new NoticeLog({
    path: join(dir, "notices.jsonl"),
    appender: () => {
      throw new Error("ENOSPC");
    },
    headCommitter: fileDropHeadCommitter(intakeDir, "mica-notify"),
  });
  const result = new NoticeSinks({ noticeLog: log }).raise(envelope());
  const attempt = bySink(result.attempts, HEAD_COMMIT_SINK_ID);
  assert.strictEqual(attempt.outcome, "FAILED");
  assert.match(String(attempt.detail), /not durably persisted/);
  assert.strictEqual(existsSync(intakeDir), false, "no drop was written at all");
});

check("a head committer that throws is FAILED in the RETURNED attempts and printed", () => {
  const log = new NoticeLog({
    path: join(scratch("head-throw"), "notices.jsonl"),
    headCommitter: () => {
      throw new Error("intake is read-only");
    },
  });
  const result = new NoticeSinks({ noticeLog: log }).raise(envelope());
  const attempt = bySink(result.attempts, HEAD_COMMIT_SINK_ID);
  assert.strictEqual(attempt.outcome, "FAILED");
  assert.match(attempt.detail, /intake is read-only/);
  assert.match(renderRaise(result), /witness-head-commit: FAILED/);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the maximal blindness point · silence is never an option ───");

check("an entirely empty configuration returns typed NOT_CONFIGURED for every sink", () => {
  const result = new NoticeSinks().raise(envelope());
  assert.strictEqual(reachedNoConfiguredSink(result.attempts), true);
  for (const attempt of result.attempts) {
    assert.strictEqual(attempt.outcome, "NOT_CONFIGURED", attempt.sinkId);
  }
  assert.strictEqual(result.attempts.length, 5, "three roles, the book, the head commit");
});

check("the blindness line is PRINTED, not omitted", () => {
  const rendered = renderRaise(new NoticeSinks().raise(envelope()));
  assert.ok(rendered.includes(TOTAL_BLINDNESS_LINE));
  for (const role of RECIPIENT_ROLES) {
    assert.match(rendered, new RegExp(`channel:${role}: NOT_CONFIGURED`));
  }
});

check("one configured sink is enough to clear the blindness line", () => {
  const transport: Transport = () => ({ detail: "202" });
  const rendered = renderRaise(
    new NoticeSinks({ roster: DEPLOYED_ROSTER, transport }).raise(envelope())
  );
  assert.ok(!rendered.includes(TOTAL_BLINDNESS_LINE));
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the configuration census · counts and states only ──────────");

check("the census distinguishes an unwired deployment from a quiet one", () => {
  const bare = new NoticeSinks().census();
  assert.deepStrictEqual(bare, {
    rosterRoles: 3,
    placeholderAddresses: 3,
    transportInjected: false,
    noticeLog: "IN_MEMORY",
    witnessHeadCommit: "NOT_DECLARED",
    declaredModality: "NOT_AN_INSTRUCTION",
  });

  const dir = scratch("census");
  const wired = new NoticeSinks({
    roster: DEPLOYED_ROSTER,
    transport: () => ({ detail: "202" }),
    noticeLog: new NoticeLog({
      path: join(dir, "notices.jsonl"),
      headCommitter: fileDropHeadCommitter(join(dir, "intake"), "mica-notify"),
    }),
  }).census();
  assert.deepStrictEqual(wired, {
    rosterRoles: 3,
    placeholderAddresses: 0,
    transportInjected: true,
    noticeLog: "DECLARED_PATH",
    witnessHeadCommit: "DECLARED",
    // The VALUE, not merely that a declaration exists. "A modality was
    // declared" is exactly the sentence a census exists to refuse.
    declaredModality: "NOT_AN_INSTRUCTION",
  });
});

check("the census carries only counts and states — no threshold, no verdict", () => {
  const census = new NoticeSinks().census();
  for (const value of Object.values(census)) {
    assert.ok(
      typeof value === "number" || typeof value === "boolean" || typeof value === "string",
      "a census field grew a structure"
    );
  }
  const rendered = renderCensus(census);
  assert.doesNotMatch(rendered, /\b(?:ALARM|SILENT|CANNOT_ASSESS|RELEASE|HOLD)\b/);
  // The bare word `adequate` DOES appear — inside the ceiling that denies the
  // census reads adequacy. What must not appear is an affirmative reading, so
  // the assertion is on the claim shape rather than on a word list.
  assert.doesNotMatch(rendered, /\bis (?:healthy|adequate|sufficient|fine|ok)\b/i);
  assert.doesNotMatch(rendered, /\b(?:should|must|recommend|advis)\w*\b/i);
  assert.ok(rendered.includes(CENSUS_IS_NOT_A_VERDICT));
});

check("the census states plainly that nothing reads it yet", () => {
  assert.match(CENSUS_HAS_NO_CONSUMER_YET, /NOTHING READS THIS CENSUS TODAY/);
  assert.match(CENSUS_HAS_NO_CONSUMER_YET, /3b|W5/);
  assert.ok(renderCensus(new NoticeSinks().census()).includes(CENSUS_HAS_NO_CONSUMER_YET));
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the composed path · the notifier's absent-sink hole ────────");

check("the composer's options drive a real BatchedNotifier, sink never absent", () => {
  const sinks = new NoticeSinks();
  const composed = composeNoticeSinks(sinks, { window: 2 });
  const notifier = new BatchedNotifier(composed.options);
  notifier.onPassBlindRecorded();
  notifier.onPassBlindRecorded();
  assert.strictEqual(composed.raised.length, 1, "the window closed and the sink ran");
  assert.strictEqual(composed.raised[0].envelope.kind, "PASS_BLIND_BATCH");
});

check("the composer's sequence is its own index — a count, never a clock", () => {
  const composed = composeNoticeSinks(new NoticeSinks(), { window: 1 });
  const notifier = new BatchedNotifier(composed.options);
  notifier.onPassBlindRecorded();
  notifier.onPassBlindRecorded();
  notifier.onPassBlindRecorded();
  assert.deepStrictEqual(
    composed.raised.map((r) => r.envelope.sequence),
    [0, 1, 2]
  );
});

check("SINKLESSNESS IS VISIBLE IN RENDERED OUTPUT, not merely absent", () => {
  const composed = composeNoticeSinks(new NoticeSinks(), { window: 1 });
  new BatchedNotifier(composed.options).onPassBlindRecorded();
  const rendered = composed.render();
  assert.ok(rendered.includes(TOTAL_BLINDNESS_LINE));
  assert.match(rendered, /transportInjected=false/);
  assert.match(rendered, /noticeLog=IN_MEMORY/);
  assert.match(rendered, /channel:doctor: NOT_CONFIGURED/);
});

check("a composer that raised nothing says so, and does not read as an all-clear", () => {
  const rendered = composeNoticeSinks(new NoticeSinks()).render();
  assert.match(rendered, /NO NOTICE HAS BEEN RAISED THROUGH THIS COMPOSER/);
  assert.match(rendered, /rosterRoles=3/);
  assert.doesNotMatch(rendered, /\ball[- ]clear\b/i);
});

check("THE HONEST LIMIT: a caller bypassing the composer stays invisible", () => {
  // Stated as a passing test rather than as a paragraph, so it cannot rot into a
  // claim of coverage this build does not have. Two such constructions exist
  // today, both inside the pinned chokepoint.test.ts — `new BatchedNotifier()`
  // and `new BatchedNotifier({ window: 1 })`. Closing this for them would take
  // editing a pinned file, which is the arbiter's fork and not this build's.
  const composed = composeNoticeSinks(new NoticeSinks(), { window: 1 });
  const bypassing = new BatchedNotifier({ window: 1 });
  const notice = bypassing.onPassBlindRecorded();
  assert.ok(notice !== null, "the bare notifier computed a notice");
  assert.strictEqual(composed.raised.length, 0, "and nothing on the composed path observed it");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the vocabulary fence · source-only, and it is proven to bite ─");

// NOTIFY_FENCE_REGION_START
//
// WHY THIS FENCE IS SOURCE-ONLY, AND WHY NOBODY SHOULD "FIX" IT INTO A RUNTIME
// CHECK: the word NOTIFIED lives inside CHECK_THE_LINE in the pinned
// chokepoint/notifier.ts — "'none since last' means none was NOTIFIED" — and
// that string rides into envelope.lines through the adapter at runtime. It is
// correct text in a file this build may not edit. A fence over rendered CONTENT
// would therefore fail on another module's own correct bytes while catching
// nothing this module wrote. The fence guards what THIS module says about
// itself, which is the thing this module controls.
//
// The banned list itself lives inside this fenced region, exactly as the gate2
// ceiling fence does, so the scanner does not report its own data as a breach.

const BANNED_WORDS: readonly string[] = [
  "delivered",
  "notified",
  "received",
  "seen",
  "informed",
  "acknowledged",
  "success",
];

/**
 * The positive controls. They live INSIDE the fenced region for the same reason
 * the list does: a scanner that reports its own probe data as a breach gets its
 * assertion relaxed, and then it stops catching the real thing.
 */
const FENCE_PROBES: readonly (readonly [string, readonly string[]])[] = [
  ["the notice was delivered to the doctor", ["delivered"]],
  ["the arbiter was informed and acknowledged it", ["acknowledged", "informed"]],
  ["HTTP 200: success", ["success"]],
  ["the operator has SEEN it", ["seen"]],
  ["the message was received and the doctor was notified", ["notified", "received"]],
  // near misses that must NOT fire
  ["attempted, recorded, raised, configured, unconfigured, failed, successful", []],
];

/** Word-boundary matches only: `unconfigured` must not read as `configured`'s
 *  opposite by accident, and `successful` is a different word from `success`. */
function bannedWordsIn(source: string): string[] {
  const found: string[] = [];
  for (const word of BANNED_WORDS) {
    if (new RegExp(`\\b${word}\\b`, "i").test(source)) found.push(word);
  }
  return found.sort();
}

// NOTIFY_FENCE_REGION_END

check("the fence CATCHES a banned word before it is trusted to report none", () => {
  let fired = 0;
  for (const [probe, expected] of FENCE_PROBES) {
    assert.deepStrictEqual(bannedWordsIn(probe), [...expected], probe);
    if (expected.length > 0) fired++;
  }
  assert.ok(fired >= 5, "the positive controls must actually exercise the scanner");
  // every banned word is covered by at least one probe, so no entry can rot
  const covered = new Set(FENCE_PROBES.flatMap(([, expected]) => expected));
  assert.deepStrictEqual(
    BANNED_WORDS.filter((w) => !covered.has(w)),
    [],
    "a banned word has no positive control proving the fence catches it"
  );
});

/** The fenced region carries the scanner's own data; excise it before scanning. */
function scannableSource(file: string): string {
  const source = readFileSync(file, "utf8");
  const start = source.indexOf("// NOTIFY_FENCE_REGION_START");
  if (start < 0) return source;
  const end = source.indexOf("// NOTIFY_FENCE_REGION_END", start);
  assert.ok(end > start, `${file} opens a fence region and never closes it`);
  return source.slice(0, start) + source.slice(end);
}

check("no banned word appears in the SOURCE of any file in this module", () => {
  const offenders: string[] = [];
  for (const file of notifyFiles()) {
    for (const word of bannedWordsIn(scannableSource(file))) {
      offenders.push(`${file}: ${word}`);
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `banned vocabulary in notify/: ${offenders.join(", ")} — this module says ` +
      `attempted, recorded, raised, configured, failed, and nothing above them`
  );
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the scope block · what this module does not claim ──────────");

check("the scope block carries every required limit, in substance", () => {
  const joined = NOTIFY_SCOPE_LINES.join("\n");
  assert.match(joined, /DOES NOT CLAIM ANY HUMAN READ ANYTHING/);
  assert.match(joined, /DOES NOT JUDGE RESPONSE TIME/);
  assert.match(joined, /DOES NOT ESCALATE OR ORDER RECIPIENTS/);
  assert.match(joined, /DOES NOT RETRY/);
  assert.match(joined, /ACCEPTANCE OF BYTES BY A FUNCTION/);
  assert.match(joined, /DECLARED DEPLOYMENT FACTS/);
  assert.match(joined, /SHIPS NO TRANSPORT/);
  assert.ok(joined.includes(MICA_OBSERVES_A_FUNCTION_NEVER_A_WIRE));
  assert.ok(joined.includes(AN_ADDRESS_IS_NOT_A_ROUTE));
  assert.ok(joined.includes(ATTEMPT_IS_THE_CEILING));
  assert.ok(joined.includes(SYMMETRIC_BROADCAST));
});

check("the scope block carries the arbiter's sentence about the human realm", () => {
  assert.match(
    NOTIFY_SCOPE_LINES.join("\n"),
    /MICA CANNOT BE MADE RESPONSIBLE FOR THE IRRESPONSIBILITY IN THE HUMAN REALM/
  );
});

check("nothing this module prints reads as an all-clear or a positive health claim", () => {
  const transport: Transport = () => ({ detail: "202" });
  const printed = [
    renderRaise(new NoticeSinks({ roster: DEPLOYED_ROSTER, transport }).raise(envelope())),
    renderRaise(new NoticeSinks().raise(envelope())),
    renderCensus(new NoticeSinks().census()),
    NOTIFY_SCOPE_LINES.join("\n"),
  ].join("\n");
  assert.doesNotMatch(printed, /\ball[- ]clear\b/i);
  assert.doesNotMatch(printed, /(?:system|deployment|channel) is (?:healthy|safe|fine)/i);
  assert.doesNotMatch(printed, /\bguarantee[sd]?\b/i);
  // "they know" DOES appear — as the thing this module never says. Assert the
  // negation rather than the absence, so the sentence cannot lose its "Never"
  // and still pass.
  for (const m of printed.matchAll(/(.{0,8})they know/gi)) {
    assert.match(m[1], /Never\s*'?$/, `an un-negated "they know" appears: ...${m[0]}`);
  }
});

check("the scope block is printed on every raising, configured or not", () => {
  const transport: Transport = () => ({ detail: "202" });
  for (const sinks of [
    new NoticeSinks(),
    new NoticeSinks({ roster: DEPLOYED_ROSTER, transport }),
  ]) {
    const rendered = renderRaise(sinks.raise(envelope()));
    for (const line of NOTIFY_SCOPE_LINES) {
      assert.ok(rendered.includes(line), `scope line missing: ${line.slice(0, 40)}`);
    }
  }
});

check("this module declares no SENSOR_ID and registers with no reader — it is a TOOL", () => {
  for (const file of notifyFiles()) {
    const source = readFileSync(file, "utf8");
    assert.ok(
      !/SENSOR_ID\s*=/.test(source),
      `${file} declares a SENSOR_ID; notify is a tool, never an instrument`
    );
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// A last shape check on the class itself, so the composer stays a plain object
// producer rather than growing a reference to the pinned constructor.
check("the composer never imports the notifier it composes", () => {
  const source = readFileSync(join(__dirname, "index.ts"), "utf8");
  assert.ok(
    !/from\s*["']\.\.\/chokepoint/.test(source),
    "notify/index.ts took an import edge into the chokepoint; the options object " +
      "is structural on purpose so nothing here references pinned machinery"
  );
  const composed = composeNoticeSinks(new NoticeSinks());
  assert.ok(composed instanceof ComposedNotifier);
});

rmSync(root, { recursive: true, force: true });


// ── NL-S103 · a look that was REFUSED is not a book that is ABSENT ─────────
//
// The class closed in `ruling-log.ts` at S98 and left open in five sibling books
// until S103. `existsSync` returns false both for "no such file" and for "not
// allowed to look"; this book read the second as the first, called it
// FIRST_BOOT_OR_ERASED, and — because `mkdirSync(..., { recursive: true })`
// SUCCEEDS on a directory that exists and cannot be entered — set itself
// persisting over content it never read.

check("NL-S103-1 · the look has three answers, and only ENOENT means absent", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-nl-look-"));
  const present = join(base, "present.jsonl");
  writeFileSync(present, "", "utf8");
  assert.deepStrictEqual(lookAtNoticeLogFile(present), { state: "PRESENT" });
  assert.deepStrictEqual(lookAtNoticeLogFile(join(base, "nope.jsonl")), { state: "ABSENT" });

  // ENAMETOOLONG: a refusal every principal reaches, uid 0 included.
  const refused = lookAtNoticeLogFile(join(base, "x".repeat(300)));
  assert.strictEqual(refused.state, "CANNOT_SEE", "a name too long read as merely absent");
  assert.ok(refused.state === "CANNOT_SEE" && refused.detail.includes("ENAMETOOLONG"));
  rmSync(base, { recursive: true, force: true });
});

check("NL-S103-2 · a book it CANNOT SEE loads to CANNOT_VERIFY, never to first boot", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-nl-cannotsee-"));
  const path = join(base, "x".repeat(300));
  const book = new NoticeLog({ path });
  assert.strictEqual(
    book.getLoadState(),
    "CANNOT_VERIFY",
    "a book this process cannot look at came up as a first boot"
  );
  const detail = book.getLastError() ?? "";
  assert.ok(detail.includes("NOT the finding that it is absent"), detail);
  assert.ok(detail.includes("nothing was recorded as a first boot"), detail);
  rmSync(base, { recursive: true, force: true });
});

check("NL-S103-3 · THE REAL SHAPE — a directory whose execute bit is stripped", () => {
  // The live instrument, and the one the mkdir defence dies on: the directory
  // EXISTS, holds a real book, and cannot be entered. `mkdirSync` recursive
  // returns cleanly here, so nothing downstream of the look would have caught it.
  //
  // A mode-based refusal cannot be built for uid 0, which is allowed to traverse
  // regardless. This body SAYS so rather than passing over a check that never
  // ran; NL-S103-1 and -2 reach the same branch by another errno for every
  // principal.
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === 0 || uid === null) {
    console.log(
      "      NOT EXERCISED as this principal: a mode-based refusal cannot be " +
        "built for uid 0. The classification and the load state are covered by " +
        "NL-S103-1..2; this body covers only the mode."
    );
    return;
  }
  const base = mkdtempSync(join(tmpdir(), "mica-nl-noexec-"));
  const dir = join(base, "book");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "book.jsonl");
  writeFileSync(path, "", "utf8");
  chmodSync(dir, 0o600); // readable, NOT searchable
  try {
    const look = lookAtNoticeLogFile(path);
    assert.strictEqual(look.state, "CANNOT_SEE", "a directory with no execute bit did not refuse the look");
    assert.ok(look.state === "CANNOT_SEE" && look.detail.includes("EACCES"));
    const book = new NoticeLog({ path });
    assert.strictEqual(book.getLoadState(), "CANNOT_VERIFY");
    assert.ok((book.getLastError() ?? "").includes("EACCES"));
    // The persistence half, in behaviour rather than in a string: a book that
    // could not be read must refuse the durable write.
    const out = book.record({
      sourceId: "s",
      kind: "HOLD_BLIND",
      lines: ["unseen"],
      envelopeSequence: 0,
      attempts: [],
    });
    assert.strictEqual(out.persisted, false, "a book nobody could read persisted anyway");
  } finally {
    chmodSync(dir, 0o700);
    rmSync(base, { recursive: true, force: true });
  }
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
