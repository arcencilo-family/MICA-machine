// ── MICA · doctor wire — the suite ───────────────────────────────────────────
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   node node_modules/ts-node/dist/bin.js src/doctor-wire/doctor-wire.test.ts
//
// Every book here lives in a fresh mkdtemp directory; no test names a
// deployment path. The caller's uid is passed in, so no second principal is
// needed for any branch.

import assert from "assert";
import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { NoticeLog, NoticeSinks, PLACEHOLDER_ROSTER, RECIPIENT_ROLES } from "../mica/notify";
import { parseDeclaration, REPLY_BOOK_IS_NOTICE_BOOK } from "./declaration";
import { DOCTOR_FINDING_SOURCE_ID, DOCTOR_FINDINGS, RAISING_FINDINGS } from "./finding";
import { printPairing, recordReply, submitFinding, NO_TRANSPORT_LINE } from "./cli";
import type { CommandResult } from "./cli";
import { pairReplies, renderPairing } from "./pairing";
import { ReplyBook } from "./reply-book";

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

const DOCTOR_UID = 4101;
const OPERATOR_UID = 4102;
const ARBITER_UID = 4103;
const STRANGER_UID = 4199;

interface Deployment {
  readonly dir: string;
  readonly declarationPath: string;
  readonly noticeBook: string;
  readonly replyBook: string;
}

function deployment(): Deployment {
  const dir = mkdtempSync(join(tmpdir(), "mica-doctor-wire-"));
  const noticeDir = join(dir, "notices");
  const replyBook = join(dir, "replies.jsonl");
  const declarationPath = join(dir, "doctor-wire.json");
  writeFileSync(
    declarationPath,
    JSON.stringify({
      noticeDir,
      replyBook,
      findingSubmitterUids: [DOCTOR_UID],
      replyRoles: {
        [String(DOCTOR_UID)]: "doctor",
        [String(OPERATOR_UID)]: "operator",
        [String(ARBITER_UID)]: "arbiter",
      },
    })
  );
  return { dir, declarationPath, noticeBook: join(noticeDir, "notices.jsonl"), replyBook };
}

function finding(kind: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ kind, window: "window W-7, as given", scope: "scope: factor 3 of the read", ...extra });
}

function submit(d: Deployment, stdin: string, uid = DOCTOR_UID): CommandResult {
  return submitFinding({ declarationPath: d.declarationPath, uid, stdin });
}

function reply(d: Deployment, uid: number, seq: number, hash: string): CommandResult {
  return recordReply({
    declarationPath: d.declarationPath,
    uid,
    stdin: JSON.stringify({ answersSequenceNumber: seq, answersHash: hash }),
  });
}

function pairing(d: Deployment): CommandResult {
  return printPairing({ declarationPath: d.declarationPath, uid: OPERATOR_UID, stdin: "" });
}

function notices(d: Deployment): NoticeLog {
  return new NoticeLog({ path: d.noticeBook });
}

/** notify's fence words, plus the claims this wire must never make. */
const NEVER_SAID = [
  "delivered",
  "notified",
  "received",
  "seen",
  "informed",
  "acknowledged",
  "success",
  "they know",
  "has read",
  "was read",
];

function assertNeverSays(text: string): void {
  for (const word of NEVER_SAID) {
    assert.ok(!new RegExp(`\\b${word}\\b`, "i").test(text), `output says "${word}"`);
  }
}

console.log("doctor wire — W1, a doctor finding raises a notice");

for (const kind of RAISING_FINDINGS) {
  check(`${kind} raises exactly one notice, sourceId the doctor-finding path, kind the finding`, () => {
    const d = deployment();
    const result = submit(d, finding(kind));
    assert.strictEqual(result.exitCode, 0, result.lines.join("\n"));
    const log = notices(d);
    assert.strictEqual(log.getLoadState(), "LOADED_VERIFIED");
    assert.strictEqual(log.getAll().length, 1);
    const record = log.getAll()[0];
    assert.strictEqual(record.sourceId, DOCTOR_FINDING_SOURCE_ID);
    assert.strictEqual(record.kind, kind);
    assert.ok(record.lines.includes("window: window W-7, as given"), "window carried as given");
    assert.ok(record.lines.includes("scope: scope: factor 3 of the read"), "scope carried as given");
  });
}

check("the broadcast is the whole default roster, every role attempted once, as the bridge's is", () => {
  const d = deployment();
  submit(d, finding("CORRUPTION-ATTESTED"));
  const record = notices(d).getAll()[0];
  const roles = record.attempts.filter((a) => a.role !== null).map((a) => a.role);
  assert.deepStrictEqual(roles, PLACEHOLDER_ROSTER.map((e) => e.role));
  assert.deepStrictEqual([...roles].sort(), [...RECIPIENT_ROLES].sort());
});

check("with no transport every channel attempt is NOT_CONFIGURED, and the output says that is the honest result", () => {
  const d = deployment();
  const result = submit(d, finding("CANNOT-READ"));
  const record = notices(d).getAll()[0];
  for (const a of record.attempts.filter((x) => x.role !== null)) assert.strictEqual(a.outcome, "NOT_CONFIGURED");
  assert.ok(result.lines.includes(NO_TRANSPORT_LINE));
});

check("NO-CORRUPTION-DETECTED raises nothing and writes nothing, not even the book's directory", () => {
  const d = deployment();
  const result = submit(d, finding("NO-CORRUPTION-DETECTED"));
  assert.strictEqual(result.exitCode, 0);
  assert.ok(!existsSync(d.noticeBook), "no notice book");
  assert.ok(!existsSync(join(d.dir, "notices")), "no notice directory");
});

check("an undeclared uid is refused before anything is read or written", () => {
  const d = deployment();
  const result = submit(d, finding("CORRUPTION-ATTESTED"), STRANGER_UID);
  assert.strictEqual(result.exitCode, 1);
  assert.ok(!existsSync(d.noticeBook));
});

check("an unknown kind, an extra key, a missing key or a line break in window/scope is refused, nothing written", () => {
  const d = deployment();
  for (const bad of [
    finding("ALL-WELL"),
    finding("CORRUPTION-ATTESTED", { note: "x" }),
    JSON.stringify({ kind: "CORRUPTION-ATTESTED", window: "w" }),
    finding("CORRUPTION-ATTESTED", { window: "two\nlines" }),
    "not json",
  ]) {
    assert.strictEqual(submit(d, bad).exitCode, 2, bad);
  }
  assert.ok(!existsSync(d.noticeBook));
});

check("the record is notify's own closed shape: no new record kind, no escalation record", () => {
  const d = deployment();
  submit(d, finding("DEGRADATION-ATTESTED"));
  const raw = JSON.parse(readFileSync(d.noticeBook, "utf8").trim()) as Record<string, unknown>;
  assert.deepStrictEqual(Object.keys(raw).sort(), [
    "attempts",
    "envelopeSequence",
    "hash",
    "kind",
    "lines",
    "previousHash",
    "sequenceNumber",
    "sourceId",
  ]);
  for (const file of readdirSync(__dirname).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
    const src = readFileSync(join(__dirname, file), "utf8");
    assert.ok(!/from "\.\.\/record/.test(src), `${file} imports the record book`);
    assert.ok(!/EscalationRecord/.test(src.replace(/^\s*\/\/.*$/gm, "")), `${file} names EscalationRecord in code`);
  }
});

check("a doctor raising joins a book another writer already holds, and the chain still verifies", () => {
  const d = deployment();
  // The bridge's own writer, standing in: a separate NoticeLog on the same file.
  const bridge = new NoticeSinks({ noticeLog: new NoticeLog({ path: d.noticeBook }) });
  bridge.raise({ sourceId: "MICA/chokepoint/pass-blind-notifier", kind: "PASS_BLIND", lines: ["x"], sequence: 0 });
  submit(d, finding("CORRUPTION-ATTESTED"));
  bridge.raise({ sourceId: "MICA/chokepoint/pass-blind-notifier", kind: "PASS_BLIND", lines: ["y"], sequence: 1 });
  const log = notices(d);
  assert.strictEqual(log.getLoadState(), "LOADED_VERIFIED");
  assert.deepStrictEqual(log.getAll().map((r) => r.sequenceNumber), [0, 1, 2]);
});

check("a notice book that does not verify is refused, nothing appended to it", () => {
  const d = deployment();
  submit(d, finding("CORRUPTION-ATTESTED"));
  const tampered = readFileSync(d.noticeBook, "utf8").replace("window W-7", "window W-8");
  writeFileSync(d.noticeBook, tampered);
  const result = submit(d, finding("CANNOT-READ"));
  assert.strictEqual(result.exitCode, 1);
  assert.strictEqual(readFileSync(d.noticeBook, "utf8"), tampered);
});

console.log("doctor wire — W2, the reply book and the pairing reader");

check("a reply names its raising by record sequenceNumber and hash, and pairs", () => {
  const d = deployment();
  submit(d, finding("CORRUPTION-ATTESTED"));
  const raising = notices(d).getAll()[0];
  const result = reply(d, OPERATOR_UID, raising.sequenceNumber, raising.hash);
  assert.strictEqual(result.exitCode, 0, result.lines.join("\n"));
  assert.ok(result.lines[0].startsWith("reply recorded: operator answers raising seq 0"));
  // The replier is "recorded by", never "submitted by" (audit ruling 3, 2026-11-02).
  assert.ok(result.lines.some((l) => l.startsWith(`recorded by uid ${String(OPERATOR_UID)}, declared as the operator`)), result.lines.join("\n"));
  assert.ok(!result.lines.some((l) => l.includes("submitted by")), result.lines.join("\n"));
  const book = new ReplyBook({ path: d.replyBook });
  assert.strictEqual(book.getLoadState(), "LOADED_VERIFIED");
  assert.deepStrictEqual(Object.keys(book.getAll()[0]).sort(), [
    "answersHash",
    "answersSequenceNumber",
    "hash",
    "previousHash",
    "role",
    "sequenceNumber",
  ]);
  const lines = pairing(d).lines;
  assert.ok(lines.some((l) => /raising seq 0 .*reply recorded — operator \(reply seq 0\)/.test(l)), lines.join("\n"));
});

check("two raisings that repeat the envelope sequence stay apart: each reply pairs with its own record", () => {
  const d = deployment();
  // Two writers that each start their own count, as two fresh processes would.
  for (const lines of [["first"], ["second"]]) {
    new NoticeSinks({ noticeLog: new NoticeLog({ path: d.noticeBook }) }).raise({
      sourceId: DOCTOR_FINDING_SOURCE_ID,
      kind: "CORRUPTION-ATTESTED",
      lines,
      sequence: 0,
    });
  }
  const [a, b] = notices(d).getAll();
  assert.strictEqual(a.envelopeSequence, b.envelopeSequence, "the envelope sequence collides");
  reply(d, ARBITER_UID, b.sequenceNumber, b.hash);
  const p = pairReplies(notices(d).getAll(), new ReplyBook({ path: d.replyBook }).getAll());
  assert.strictEqual(p.raisings[0].replies.length, 0);
  assert.strictEqual(p.raisings[1].replies.length, 1);
});

check("a reply whose hash or sequence matches no raising is refused, nothing written", () => {
  const d = deployment();
  submit(d, finding("CORRUPTION-ATTESTED"));
  const raising = notices(d).getAll()[0];
  assert.strictEqual(reply(d, OPERATOR_UID, 0, "0".repeat(64)).exitCode, 1);
  assert.strictEqual(reply(d, OPERATOR_UID, 5, raising.hash).exitCode, 1);
  assert.ok(!existsSync(d.replyBook));
});

check("an undeclared uid cannot record a reply; with no notice book there is nothing to answer", () => {
  const d = deployment();
  assert.strictEqual(reply(d, STRANGER_UID, 0, "0".repeat(64)).exitCode, 1);
  const none = reply(d, OPERATOR_UID, 0, "0".repeat(64));
  assert.strictEqual(none.exitCode, 1);
  assert.ok(/no notice book/.test(none.lines[0]));
  assert.ok(!existsSync(join(d.dir, "notices")), "a reply never creates the notice directory");
});

check("the pairing reader prints 'no reply on record', orders by sequence, and lists an unpaired reply apart", () => {
  const d = deployment();
  submit(d, finding("CORRUPTION-ATTESTED"));
  submit(d, finding("CANNOT-READ"));
  const [, second] = notices(d).getAll();
  reply(d, DOCTOR_UID, second.sequenceNumber, second.hash);
  new ReplyBook({ path: d.replyBook }).record({ role: "arbiter", answersSequenceNumber: 9, answersHash: "a".repeat(64) });
  const lines = pairing(d).lines;
  const i0 = lines.findIndex((l) => l.startsWith("raising seq 0 "));
  const i1 = lines.findIndex((l) => l.startsWith("raising seq 1 "));
  assert.ok(i0 >= 0 && i1 > i0, "sequence order");
  assert.ok(lines[i0].endsWith("no reply on record"));
  assert.ok(lines[i1].includes("reply recorded — doctor"));
  assert.ok(lines.some((l) => /names raising seq 9 .*not in this notice book/.test(l)));
});

check("a tampered reply book reads CANNOT_VERIFY and refuses the next reply", () => {
  const d = deployment();
  submit(d, finding("CORRUPTION-ATTESTED"));
  const raising = notices(d).getAll()[0];
  reply(d, OPERATOR_UID, raising.sequenceNumber, raising.hash);
  writeFileSync(d.replyBook, readFileSync(d.replyBook, "utf8").replace('"operator"', '"arbiter"'));
  assert.strictEqual(new ReplyBook({ path: d.replyBook }).getLoadState(), "CANNOT_VERIFY");
  assert.strictEqual(reply(d, OPERATOR_UID, raising.sequenceNumber, raising.hash).exitCode, 1);
  assert.strictEqual(pairing(d).exitCode, 1);
});

check("nothing in the wire's source reads a clock or schedules anything", () => {
  for (const file of readdirSync(__dirname).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
    const code = readFileSync(join(__dirname, file), "utf8").replace(/^\s*\/\/.*$/gm, "");
    for (const pattern of [/setTimeout/, /setInterval/, /setImmediate/, /Date\.now/, /new Date/, /performance\.now/]) {
      assert.ok(!pattern.test(code), `${file} matches ${String(pattern)}`);
    }
  }
});

check("no output of the wire claims that anyone read, knew, agreed or was reached", () => {
  const d = deployment();
  const all: string[] = [];
  // The first line is notify's own renderRaise, whose pinned ceiling lines deny
  // these words ("Never 'they know.'") and are checked by notify's suite.
  all.push(...submit(d, finding("CORRUPTION-ATTESTED")).lines.slice(1));
  const raising = notices(d).getAll()[0];
  all.push(...reply(d, OPERATOR_UID, raising.sequenceNumber, raising.hash).lines);
  all.push(...pairing(d).lines);
  assertNeverSays(all.join("\n"));
  assertNeverSays(renderPairing(pairReplies([], [])).join("\n"));
});

check("the declaration refuses a reply book that is the notice book, a relative path, and a bad role", () => {
  const base = { noticeDir: "/srv/n", replyBook: "/srv/n/notices.jsonl", findingSubmitterUids: [1], replyRoles: {} };
  assert.strictEqual(parseDeclaration(base), REPLY_BOOK_IS_NOTICE_BOOK);
  assert.strictEqual(typeof parseDeclaration({ ...base, replyBook: "replies.jsonl" }), "string");
  assert.strictEqual(typeof parseDeclaration({ ...base, replyBook: "/srv/r.jsonl", replyRoles: { "1": "owner" } }), "string");
  assert.strictEqual(typeof parseDeclaration({ ...base, replyBook: "/srv/r.jsonl" }), "object");
});

check("the doctor's four findings are the four 07a names, and three of them raise", () => {
  assert.deepStrictEqual([...DOCTOR_FINDINGS].sort(), [
    "CANNOT-READ",
    "CORRUPTION-ATTESTED",
    "DEGRADATION-ATTESTED",
    "NO-CORRUPTION-DETECTED",
  ]);
  assert.strictEqual(RAISING_FINDINGS.length, 3);
  assert.ok(!RAISING_FINDINGS.includes("NO-CORRUPTION-DETECTED"));
});

check("the entry point runs end to end as this process's uid", () => {
  const d = deployment();
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  const decl = JSON.parse(readFileSync(d.declarationPath, "utf8")) as Record<string, unknown>;
  writeFileSync(d.declarationPath, JSON.stringify({ ...decl, findingSubmitterUids: [uid] }));
  const root = resolve(__dirname, "..", "..");
  const out = execFileSync(
    process.execPath,
    [join(root, "node_modules/ts-node/dist/bin.js"), join(root, "tools/doctor-wire/submit-finding.ts"), d.declarationPath],
    { input: finding("CANNOT-READ"), encoding: "utf8" }
  );
  assert.ok(out.includes("In the notice book at sequenceNumber 0"), out);
  assert.strictEqual(notices(d).getAll().length, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
