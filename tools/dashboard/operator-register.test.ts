// ── MICA · the operator register of the dashboard generator (wire-v01 W3) ────
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   node node_modules/ts-node/dist/bin.js tools/dashboard/operator-register.test.ts
//
// WHAT THIS HOLDS
//
//   The light is red on an unanswered raising, GREY (never green, never "all
//   clear") when every raising has a reply, and "cannot see" when a book is
//   undeclared, unreadable or unparsable. A reply pairs only on BOTH halves of
//   its key. The three fixed lines and the arming line are on the page. The
//   operator page carries exactly one <script>, with no network in it, and the
//   other two registers carry none. No string this register speaks uses a word
//   that claims a person read, knew, agreed or was told anything.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
//   It does not name a deployment path: every book here is a fixture written
//   under a fresh temp directory, and the books carry made-up hashes because
//   the page verifies no chain (it says so, and a check below holds that line).
//   It does not read any case text, and it does not execute the page's script;
//   it reads the script as TEXT, which is what the no-network claim is about.
//
//   The dashboard and outsider pages are produced by running the real
//   generator as a child process into a temp directory, so "zero scripts" is a
//   statement about the bytes that generator actually writes.

import assert from "assert";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  OPERATOR_ENV,
  OPERATOR_SCRIPT,
  OPERATOR_STRINGS,
  buildView,
  pair,
  renderOperatorPage,
  runOperatorRegister,
} from "./operator-register";

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

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mica-operator-register-"));

// ── fixtures ─────────────────────────────────────────────────────────────────

const h = (c: string): string => c.repeat(64);

function notice(seq: number, hash: string, sourceId: string, kind: string, lines: string[]): string {
  return JSON.stringify({
    sourceId,
    kind,
    lines,
    envelopeSequence: seq,
    attempts: [{ sinkId: "s1", role: null, outcome: "ATTEMPTED", detail: "" }],
    sequenceNumber: seq,
    previousHash: seq === 0 ? "" : h("0"),
    hash,
  });
}

function reply(role: string, aSeq: number, aHash: string, seq: number): string {
  return JSON.stringify({
    role,
    answersSequenceNumber: aSeq,
    answersHash: aHash,
    sequenceNumber: seq,
    previousHash: seq === 0 ? "" : h("0"),
    hash: h("e"),
  });
}

function writeBook(name: string, lines: string[]): string {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
  return p;
}

const N0 = notice(0, h("a"), "MICA/doctor-finding", "CANNOT-READ", ["window: w", "scope: s"]);
const N1 = notice(1, h("b"), "MICA/chokepoint/pass-blind-notifier", "BLIND", ["one line"]);
const N2 = notice(2, h("c"), "MICA/doctor-finding", "DEGRADATION-ATTESTED", []);

const noticeBook = writeBook("notice.jsonl", [N0, N1, N2]);

function page(env: Record<string, string | undefined>): string {
  return renderOperatorPage(buildView(env), "TEST");
}

// ── the light ────────────────────────────────────────────────────────────────

console.log("light");

check("red when a raising has no reply on record", () => {
  const rb = writeBook("reply-partial.jsonl", [
    reply("doctor", 0, h("a"), 0),
    reply("arbiter", 1, h("b"), 1),
  ]);
  const v = buildView({ [OPERATOR_ENV.noticeBook]: noticeBook, [OPERATOR_ENV.replyBook]: rb });
  assert.strictEqual(v.light, "red");
  const html = renderOperatorPage(v, "T");
  assert.ok(html.includes('data-light="red"'));
  assert.ok(html.includes(OPERATOR_STRINGS.lightRed));
  assert.ok(html.includes(OPERATOR_STRINGS.noReply));
  assert.ok(html.includes("reply recorded: doctor"));
  assert.ok(html.includes("reply recorded: arbiter"));
});

check("grey, not green and not all clear, when every raising has a reply", () => {
  const rb = writeBook("reply-all.jsonl", [
    reply("doctor", 0, h("a"), 0),
    reply("arbiter", 1, h("b"), 1),
    reply("operator", 2, h("c"), 2),
  ]);
  const v = buildView({ [OPERATOR_ENV.noticeBook]: noticeBook, [OPERATOR_ENV.replyBook]: rb });
  assert.strictEqual(v.light, "grey");
  const html = renderOperatorPage(v, "T");
  assert.ok(html.includes('data-light="grey"'));
  assert.ok(
    html.includes(
      "every raising has at least one reply on record; a reply recorded is not a reading, an agreement or a remedy"
    )
  );
  assert.ok(!/green/i.test(html), "the word green appears");
  assert.ok(!/all clear/i.test(html), "'all clear' appears");
  assert.ok(!/healthy/i.test(html), "'healthy' appears");
  assert.ok(!html.includes("no reply on record"), "no raising should read as unanswered");
});

check("a reply with a hash mismatch does not pair, and is listed apart", () => {
  const rb = writeBook("reply-mismatch.jsonl", [
    reply("doctor", 0, h("a"), 0),
    reply("arbiter", 1, h("b"), 1),
    reply("operator", 2, h("d"), 2), // right slot, wrong hash
  ]);
  const v = buildView({ [OPERATOR_ENV.noticeBook]: noticeBook, [OPERATOR_ENV.replyBook]: rb });
  assert.strictEqual(v.paired.orphans.length, 1);
  assert.strictEqual(v.paired.orphans[0].answersSequenceNumber, 2);
  assert.strictEqual(v.paired.raisings[2].replies.length, 0);
  assert.strictEqual(v.light, "red");
  const html = renderOperatorPage(v, "T");
  assert.ok(html.includes(OPERATOR_STRINGS.orphanLabel));
  assert.ok(html.includes(OPERATOR_STRINGS.repliesHeading));
});

check("a reply naming a sequence nobody holds is listed apart, not dropped", () => {
  const p = pair(
    [],
    [{ role: "doctor", answersSequenceNumber: 9, answersHash: h("f"), sequenceNumber: 0, hash: h("e") }]
  );
  assert.strictEqual(p.orphans.length, 1);
  assert.strictEqual(p.raisings.length, 0);
});

check("age is a count of records after the raising", () => {
  const v = buildView({ [OPERATOR_ENV.noticeBook]: noticeBook });
  assert.deepStrictEqual(
    v.paired.raisings.map((r) => r.recordsAfter),
    [2, 1, 0]
  );
});

check("no wall-clock: every raising prints the no-stamp line and no time", () => {
  const html = page({ [OPERATOR_ENV.noticeBook]: noticeBook });
  const n = html.split(OPERATOR_STRINGS.noWitnessStamp).length - 1;
  assert.strictEqual(n, 3);
  assert.ok(!/\d{2}:\d{2}:\d{2}/.test(html), "a clock time appears");
});

check("undeclared books read 'cannot see', not red-off and not grey", () => {
  const v = buildView({});
  assert.strictEqual(v.light, "cannot-see");
  const html = renderOperatorPage(v, "T");
  assert.ok(html.includes('data-light="cannot-see"'));
  assert.ok(html.includes(OPERATOR_STRINGS.lightCannotSee));
  assert.ok(html.includes(OPERATOR_STRINGS.undeclared));
  assert.ok(html.includes(OPERATOR_ENV.noticeBook));
});

check("an unreadable notice book reads 'cannot see' and prints the path and reason", () => {
  const missing = path.join(TMP, "does-not-exist.jsonl");
  const v = buildView({ [OPERATOR_ENV.noticeBook]: missing, [OPERATOR_ENV.replyBook]: noticeBook });
  assert.strictEqual(v.light, "cannot-see");
  const html = renderOperatorPage(v, "T");
  assert.ok(html.includes("unreadable"));
  assert.ok(html.includes("does-not-exist.jsonl"));
});

check("a declared reply book that does not exist yet reads as no reply on record, and the light is red", () => {
  const v = buildView({
    [OPERATOR_ENV.noticeBook]: noticeBook,
    [OPERATOR_ENV.replyBook]: path.join(TMP, "no-such-reply.jsonl"),
  });
  assert.strictEqual(v.reply.state, "read");
  assert.strictEqual(v.light, "red");
  const html = renderOperatorPage(v, "T");
  assert.ok(html.includes(OPERATOR_STRINGS.noReply));
  assert.ok(html.includes('class="card unanswered"'));
});

check("an undeclared or unreadable reply book cannot silence the light: red, and the card says why", () => {
  const dir = path.join(TMP, "reply-is-a-directory");
  fs.mkdirSync(dir);
  for (const replyBook of [undefined, dir]) {
    const v = buildView({ [OPERATOR_ENV.noticeBook]: noticeBook, [OPERATOR_ENV.replyBook]: replyBook });
    assert.notStrictEqual(v.reply.state, "read");
    assert.strictEqual(v.light, "red");
    const html = renderOperatorPage(v, "T");
    assert.ok(html.includes(OPERATOR_STRINGS.replyBookCannotSee));
    assert.ok(html.includes('data-light="red"'));
  }
});

check("an unparsable line is printed as a hole and the light cannot be grey", () => {
  const nb = writeBook("notice-bad.jsonl", [N0, "{not json", N1]);
  const rb = writeBook("reply-two.jsonl", [reply("doctor", 0, h("a"), 0), reply("doctor", 1, h("b"), 1)]);
  const v = buildView({ [OPERATOR_ENV.noticeBook]: nb, [OPERATOR_ENV.replyBook]: rb });
  assert.strictEqual(v.noticeBad.length, 1);
  assert.strictEqual(v.light, "cannot-see");
  assert.ok(renderOperatorPage(v, "T").includes("line 2"));
});

check("a readable empty notice book is 'no raising', neither red nor grey-as-answered", () => {
  const nb = writeBook("notice-empty.jsonl", []);
  const rb = writeBook("reply-empty.jsonl", []);
  const v = buildView({ [OPERATOR_ENV.noticeBook]: nb, [OPERATOR_ENV.replyBook]: rb });
  assert.strictEqual(v.light, "no-raising");
});

// ── the doctor's attestation ─────────────────────────────────────────────────

console.log("doctor attestation");

check("'no doctor attestation on record' when the history is undeclared", () => {
  const html = page({ [OPERATOR_ENV.noticeBook]: noticeBook });
  assert.ok(html.includes("no doctor attestation on record"));
  assert.ok(html.includes(OPERATOR_ENV.doctorHistory));
});

check("'no doctor attestation on record' when the history holds none", () => {
  const hist = writeBook("history-none.jsonl", [
    JSON.stringify({ recordType: "SUBSTRATE_READ", sequenceNumber: 0 }),
  ]);
  const html = page({ [OPERATOR_ENV.doctorHistory]: hist });
  assert.ok(html.includes("no doctor attestation on record"));
});

check("the latest attestation and its age (records after it) are shown", () => {
  const hist = writeBook("history-att.jsonl", [
    JSON.stringify({ recordType: "DOCTOR_ATTESTATION", sequenceNumber: 0, timestamp: 100, attesterId: "d-old", note: "n0", modality: "OFFERED" }),
    JSON.stringify({ recordType: "DOCTOR_ATTESTATION", sequenceNumber: 1, timestamp: 200, attesterId: "d-new", note: "n1", modality: "OFFERED" }),
    JSON.stringify({ recordType: "SUBSTRATE_READ", sequenceNumber: 2 }),
  ]);
  const v = buildView({ [OPERATOR_ENV.doctorHistory]: hist });
  assert.ok(v.attestation !== null);
  assert.strictEqual(v.attestation!.attesterId, "d-new");
  assert.strictEqual(v.attestationRecordsAfter, 1);
  const html = renderOperatorPage(v, "T");
  assert.ok(html.includes("d-new"));
  assert.ok(!html.includes("d-old"));
  assert.ok(!html.includes("no doctor attestation on record"));
});

// ── fixed lines, arming line, no-chain line ──────────────────────────────────

console.log("fixed lines");

check("the three fixed lines are present, verbatim, in every light state", () => {
  const want = [
    "A rendering, not the record; the evidence is L0.",
    "Nothing on this page is approval.",
    "For the doctor this is a doorbell, never the window: the doctor reads the record directly.",
  ];
  for (const env of [{}, { [OPERATOR_ENV.noticeBook]: noticeBook }]) {
    const html = page(env);
    for (const l of want) assert.ok(html.includes(l), l);
  }
});

check("the page says it verifies no chain", () => {
  assert.ok(page({}).includes("This page parses the books and does not verify their chains."));
});

check("the arming line is present: one click, and the red light works without it", () => {
  const html = page({});
  assert.ok(html.includes("The sound needs one click to arm: browsers block autoplay."));
  assert.ok(html.includes("The red light works without it."));
});

// ── the script ───────────────────────────────────────────────────────────────

console.log("script");

function scriptCount(html: string): number {
  return (html.match(/<script\b/gi) ?? []).length;
}

check("the operator page has exactly one <script>", () => {
  for (const env of [{}, { [OPERATOR_ENV.noticeBook]: noticeBook }]) {
    assert.strictEqual(scriptCount(page(env)), 1);
  }
});

check("no network inside the script", () => {
  const html = page({});
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m !== null);
  const body = m![1];
  assert.strictEqual(body.trim(), OPERATOR_SCRIPT.trim());
  for (const bad of ["http", "fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "import(", "src="]) {
    assert.ok(!body.includes(bad), "script contains " + bad);
  }
});

check("the page loads nothing: no src=, no href=, no url(", () => {
  const html = page({ [OPERATOR_ENV.noticeBook]: noticeBook });
  assert.ok(!/\bsrc\s*=/i.test(html));
  assert.ok(!/\bhref\s*=/i.test(html));
  assert.ok(!/url\(/i.test(html));
  assert.ok(!/https?:/i.test(html));
});

// ── wording fence ────────────────────────────────────────────────────────────

console.log("wording");

const BANNED = [
  "delivered",
  "notified",
  "received",
  "seen",
  "informed",
  "acknowledged",
  "success",
  "read by",
  "knows",
];

function flatten(v: unknown, out: string[]): void {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) flatten(x, out);
  else if (typeof v === "object" && v !== null) for (const x of Object.values(v)) flatten(x, out);
}

check("no banned word in any operator string, nor in the script", () => {
  const strings: string[] = [];
  flatten(OPERATOR_STRINGS, strings);
  strings.push(OPERATOR_SCRIPT);
  for (const s of strings) {
    for (const w of BANNED) {
      assert.ok(!new RegExp("\\b" + w + "\\b", "i").test(s), `"${w}" in: ${s}`);
    }
  }
});

check("the operator strings never say green, all clear, healthy or ok", () => {
  const strings: string[] = [];
  flatten(OPERATOR_STRINGS, strings);
  for (const s of strings) {
    assert.ok(!/\b(green|all clear|healthy|ok|passed)\b/i.test(s), s);
  }
});

// ── the other registers carry no script, and are what they were ──────────────

console.log("other registers");

function generate(register: string, outDir: string): string {
  fs.mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "node_modules", "ts-node", "dist", "bin.js"), path.join(__dirname, "generate-dashboard.ts")],
    {
      env: { ...process.env, MICA_REGISTER: register, MICA_OUT_DIR: outDir },
      encoding: "utf8",
      timeout: 240000,
    }
  );
  assert.strictEqual(r.status, 0, `generator ${register} exited ${r.status}: ${r.stderr}`);
  const files = fs.readdirSync(outDir).filter((f) => f.endsWith(".html"));
  assert.strictEqual(files.length, 1, "exactly one file written");
  return fs.readFileSync(path.join(outDir, files[0]), "utf8");
}

check("the dashboard page carries zero <script>", () => {
  assert.strictEqual(scriptCount(generate("dashboard", path.join(TMP, "out-dashboard"))), 0);
});

check("the outsider page carries zero <script>", () => {
  assert.strictEqual(scriptCount(generate("outsider", path.join(TMP, "out-outsider"))), 0);
});

check("the generator in operator mode writes exactly one file, named for the register", () => {
  const out = path.join(TMP, "out-operator");
  fs.mkdirSync(out);
  const r = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "node_modules", "ts-node", "dist", "bin.js"), path.join(__dirname, "generate-dashboard.ts")],
    {
      env: { ...process.env, MICA_REGISTER: "operator", MICA_OUT_DIR: out, [OPERATOR_ENV.noticeBook]: noticeBook },
      encoding: "utf8",
      timeout: 240000,
    }
  );
  assert.strictEqual(r.status, 0, String(r.stderr));
  const files = fs.readdirSync(out);
  assert.strictEqual(files.length, 1);
  assert.ok(/^mica-operator-\d{8}-\d{4}\.html$/.test(files[0]), files[0]);
  const html = fs.readFileSync(path.join(out, files[0]), "utf8");
  assert.strictEqual(scriptCount(html), 1);
  assert.ok(html.includes('data-light="red"'), "raisings read, reply book undeclared: no reply on record, so red");
});

check("a second page in the same minute is refused, and the first is not overwritten", () => {
  // Audit ruling 5, 2026-11-02: the page is named to the minute; it is written
  // exclusively, so a collision refuses rather than overwrites.
  const out = path.join(TMP, "out-collision");
  fs.mkdirSync(out);
  const at = new Date(2026, 10, 2, 12, 0, 30);
  const env = { [OPERATOR_ENV.noticeBook]: noticeBook };
  const write = process.stdout.write.bind(process.stdout);
  const writeErr = process.stderr.write.bind(process.stderr);
  let errText = "";
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = ((s: string) => {
    errText += s;
    return true;
  }) as typeof process.stderr.write;
  let first: string | null;
  let second: string | null;
  try {
    first = runOperatorRegister(env, out, at);
    assert.ok(first !== null);
    fs.appendFileSync(first, "<!-- the first page's own bytes -->");
    second = runOperatorRegister(env, out, new Date(2026, 10, 2, 12, 0, 59));
  } finally {
    process.stdout.write = write;
    process.stderr.write = writeErr;
  }
  assert.strictEqual(second, null);
  assert.ok(errText.includes("NOT WRITTEN") && errText.includes("never overwritten"), errText);
  assert.strictEqual(fs.readdirSync(out).length, 1);
  assert.ok(fs.readFileSync(first as string, "utf8").endsWith("<!-- the first page's own bytes -->"));
});

// ── close ────────────────────────────────────────────────────────────────────

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
