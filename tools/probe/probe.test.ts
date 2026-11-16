// ── MICA · the Tier 2 probe harness — tests and fences (Long Run B) ──────────
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node tools/probe/probe.test.ts
//
// What it holds: (1) the LITERAL FENCE — no subject, uid, path, item, origin,
// window or probe text in tools/probe; (2) the GET-ONLY FENCE (T2-9) — no
// request-writing curl flag anywhere, and a TEST ARM that runs capture.sh
// against a fake socket and asserts every request it made was a GET; (3) seal
// refusals; (4) the register's append-only and verbatim-score refusals; (5)
// tamper detection through verify; (6) the arbiter's two lines refuse without a tty,
// and the window refuses under 6 h (through a pty).
//
// WHAT IT DOES NOT BUY: it does not run a probe or a gate. The rehearsal
// (g2b-notes/rehearsal, not shipped) drives the real bridge and machine.

import assert from "assert";
import { spawnSync } from "child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import * as http from "http";
import { tmpdir } from "os";
import { join } from "path";

import { caseLines, parseRegister, sha256, sha256File } from "./probe-lib";
import { REGISTER_HEADER } from "./register";
import { eventSeqGaps, verify } from "./verify";

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(e as Error).message}`);
  }
}

const HERE = __dirname;
const TSNODE = join(HERE, "..", "..", "node_modules", "ts-node", "dist", "bin.js");
const RUBRIC = join(HERE, "RUBRIC.md");
const temps: string[] = [];
function temp(p: string): string {
  const d = mkdtempSync(join(tmpdir(), p));
  temps.push(d);
  return d;
}
function ts(script: string, argv: string[]) {
  return spawnSync(process.execPath, [TSNODE, "-T", join(HERE, script), ...argv], { encoding: "utf8" });
}
function sh(script: string, argv: string[]) {
  return spawnSync("bash", [join(HERE, script), ...argv], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
/** A pty, so the arbiter's tty check passes: the line is still refused for what it says. */
function shTty(script: string, argv: string[], input = "") {
  const cmd = ["bash", join(HERE, script), ...argv].map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  return spawnSync("script", ["-qec", cmd, "/dev/null"], { encoding: "utf8", input });
}

function newCase(root: string, id: string): string {
  chmodSync(root, 0o700);
  const d = join(root, id);
  mkdirSync(d, { mode: 0o700 });
  writeFileSync(join(d, "case.md"), "a fixture case\n");
  writeFileSync(join(d, "prediction.json"), JSON.stringify({ gate: "gate-x", caseId: id, conditions: [{ n: 1, what: "w", source: "status", path: "pilot.state", op: "eq", value: "ACTIVE" }] }));
  return d;
}
function newRegister(root: string): string {
  const r = join(root, "register.md");
  writeFileSync(r, REGISTER_HEADER);
  return r;
}
function sealCase(dir: string, reg: string) {
  return ts("seal.ts", ["--case-dir", dir, "--rubric", RUBRIC, "--register", reg, "--by", "test", "--rehearsal", "--write"]);
}
/** A window and a stamp written the way window.sh / stamp-delivery.sh write them (without their tty). */
function windowAndStamp(dir: string, reg: string, start: string, end: string, deliveredAt: string, committedAt = new Date(Date.parse(deliveredAt) - 1000).toISOString()) {
  chmodSync(dir, 0o700);
  writeFileSync(join(dir, "window"), `NONCE ${"ab".repeat(32)}\nSTART ${start}\nEND ${end}\nCOMMITTED-AT ${committedAt}\nBY test\n`);
  writeFileSync(join(dir, "delivered-at"), `DELIVERED-AT ${deliveredAt}\nBY test\nCASE ${sha256File(join(dir, "case.md"))}\n`);
  chmodSync(join(dir, "window"), 0o400);
  chmodSync(join(dir, "delivered-at"), 0o400);
  chmodSync(dir, 0o500);
  const r = ts("register.ts", ["window", "--register", reg, "--case-dir", dir, "--by", "test", "--write"]);
  assert(r.status === 0, r.stderr + r.stdout);
}

/** A fake bridge on a unix socket: answers the four GETs and records every method it saw. */
function fakeBridge(sockPath: string, t0: number, book?: FakeBook): Promise<{ server: http.Server; methods: string[] }> {
  const methods: string[] = [];
  const server = http.createServer((req, res) => {
    methods.push(`${req.method} ${req.url}`);
    const u = new URL(req.url ?? "/", "http://localhost");
    let body: unknown = {};
    if (u.pathname === "/status") body = { pilot: { state: "ACTIVE", expiresAt: "2099-01-01T00:00:00Z" }, instruments: [] };
    else if (u.pathname === "/log") body = { lines: [{ sequenceNumber: 0, actionId: "a-1", timestamp: t0 + 1000 }], total: 1 };
    else if (u.pathname === "/events" && book !== undefined) body = book.page(Number(u.searchParams.get("after") ?? 0), Number(u.searchParams.get("limit") ?? 100));
    else if (u.pathname === "/events") body = { events: [{ seq: 0, at: new Date(t0 - 5).toISOString(), kind: "SUBJECT_CHAIN_BOUNDARY" }, { seq: 1, ts: new Date(t0 + 1001).toISOString(), kind: "HELD", identity: { actionId: "a-1" }, decisionHash: "c".repeat(64) }], lastSeq: 1, more: false };
    else if (u.pathname === "/explain") body = { decisionHash: u.searchParams.get("decisionHash") };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });
  return new Promise((resolve) => server.listen(sockPath, () => resolve({ server, methods })));
}

/**
 * An events book served the way the bridge serves it (mica-service.ts /events at f9126e4): `after` exclusive, `limit`
 * capped at 1000, lastSeq = the WHOLE book's last seq, more = something eligible was left off this page. `missing`
 * drops seqs from the book (a gap); `emptyAfter` answers an empty page with more:true for any cursor at or past it.
 */
interface FakeBook { page(after: number, limit: number): unknown }
function fakeBook(n: number, t0: number, opts: { missing?: number[]; emptyAfter?: number } = {}): FakeBook {
  const all: Record<string, unknown>[] = [];
  for (let seq = 1; seq <= n; seq++) {
    if (opts.missing?.includes(seq)) continue;
    all.push(seq === 1 ? { seq, ts: new Date(t0 + 1001).toISOString(), kind: "HELD", identity: { actionId: "a-1" }, decisionHash: "c".repeat(64) } : { seq, ts: new Date(t0 - 10_000).toISOString(), kind: "FILLER" });
  }
  const lastSeq = all.length > 0 ? Number(all[all.length - 1].seq) : 0;
  return {
    page(after: number, limit: number) {
      if (opts.emptyAfter !== undefined && after >= opts.emptyAfter) return { events: [], lastSeq, more: true };
      const eligible = all.filter((e) => Number(e.seq) > after);
      const events = eligible.slice(0, Math.min(1000, limit));
      return { events, lastSeq, more: events.length < eligible.length };
    },
  };
}

/** A sealed, windowed, stamped case and a capture.sh run against a fake bridge; the capture directory and the run. */
async function captureRun(book?: FakeBook | ((t0: number) => FakeBook)) {
  const root = temp("probe-cap-");
  const reg = newRegister(root);
  const dir = newCase(join(root), "case-cap");
  assert(sealCase(dir, reg).status === 0, "seal");
  // sealed just now; the window opened 7 h ago and closes in the past; delivered after the seal, decided after that.
  // The order is read and asserted, not assumed (audit ruling 1, 2026-11-02; verify.ts and
  // capture.sh unchanged). The wall clock of the box this ran on was measured stepping back
  // about 2.5 s every 30 s, so a fixed sleep and a 100 ms margin are not enough: the delivery
  // is placed strictly after the seal's OWN sealed-at, read from the register, and the window's
  // end is placed CLOCK_STEP_MS in the past, so capture.sh still finds it closed after a step.
  const CLOCK_STEP_MS = 4000;
  const sealedLine = parseRegister(readFileSync(reg, "utf8")).find((l) => l.kind === "SEALED");
  const sealedAt = Date.parse(sealedLine?.named.get("sealed-at") ?? "");
  assert(Number.isFinite(sealedAt), "the register's SEALED line carries a sealed-at");
  while (Date.now() < sealedAt + CLOCK_STEP_MS + 2000) await new Promise((r) => setTimeout(r, 50));
  const now = Date.now();
  const end = now - CLOCK_STEP_MS;
  const tDel = end - 1500;
  assert(tDel > sealedAt, `the stamp ${new Date(tDel).toISOString()} is strictly after sealed-at ${new Date(sealedAt).toISOString()}`);
  windowAndStamp(dir, reg, new Date(now - 7 * 3600e3).toISOString(), new Date(end).toISOString(), new Date(tDel).toISOString(), new Date(tDel - 200).toISOString());
  const t0 = tDel - 500; // the fake log's decision lands at t0 + 1000, after the stamp and before the window's end
  const sock = join(temp("probe-sock-"), "s.sock");
  const bookFile = join(root, "book.jsonl");
  const roster = join(root, "roster.jsonl");
  writeFileSync(bookFile, "{}\n");
  writeFileSync(roster, "{}\n");
  const { server, methods } = await fakeBridge(sock, t0, typeof book === "function" ? book(t0) : book);
  try {
    const r = await new Promise<{ status: number | null; out: string }>((resolve) => {
      const { spawn } = require("child_process");
      const p = spawn("bash", [join(HERE, "capture.sh"), "--case-dir", dir, "--socket", sock, "--book", bookFile, "--roster", roster, "--other-errands", "0"], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      p.stdout.on("data", (c: Buffer) => (out += c));
      p.stderr.on("data", (c: Buffer) => (out += c));
      p.on("close", (status: number | null) => resolve({ status, out }));
    });
    const capName = readdirSync(dir).find((n) => n.startsWith("capture-") && !n.endsWith(".sha256") && !n.endsWith(".FAILED"));
    return { ...r, methods, reg, dir, cap: capName === undefined ? "" : join(dir, capName) };
  } finally {
    server.close();
  }
}

const OPERATOR_ACCOUNT_SHA = "c70442de124ba47f7691057dfc6be35239196b5c979d4ac5340d29e38d9fea84";

async function main(): Promise<void> {
  const files = readdirSync(HERE).filter((n) => n !== "probe.test.ts");

  await check("FENCE · no subject, uid, path, item, origin, window or probe literal in tools/probe", () => {
    const banned: [RegExp, string][] = [
      [/(?<![\w.])\/(home|var|opt|run|srv|mnt|etc|tmp|root)\//, "an absolute path"],
      [/housekeeper|claude-bot|canary|CANARY/i, "a subject, unit, user or item name"],
      [/(peers\/|uid[ :=]*)\d+\b|\b98[01]\b/i, "a uid"],
      [/\b20\d\d-\d\d-\d\dT\d\d:\d\d/, "a window instant"],
      [/G2_HARM@[0-9a-f]/, "a served harm class"],
    ];
    for (const f of files) {
      const text = readFileSync(join(HERE, f), "utf8");
      for (const [re, what] of banned) {
        const m = re.exec(text);
        assert(m === null, `${f} carries ${what}: ${JSON.stringify(m?.[0])}`);
      }
      // The operator's account word is held here by its SHA-256 only, so this file names nothing.
      for (const tok of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        assert(sha256(tok) !== OPERATOR_ACCOUNT_SHA, `${f} carries a user name (token hash ${OPERATOR_ACCOUNT_SHA.slice(0, 8)})`);
      }
    }
  });

  await check("GET-ONLY FENCE (T2-9) · no curl in tools/probe carries a request-writing flag, and no file names a write method", () => {
    for (const f of files) {
      const lines = readFileSync(join(HERE, f), "utf8").split("\n");
      lines.forEach((l, i) => {
        if (/\bcurl\b/.test(l)) assert(!/\s(-X|--request|-d|--data\S*|-F|--form|-T|--upload-file|--json)\b/.test(l), `${f}:${i + 1} ${l.trim()}`);
        assert(!/\b(POST|PUT|PATCH|DELETE)\b/.test(l), `${f}:${i + 1} names a write method: ${l.trim()}`);
      });
    }
  });

  await check("GET-ONLY TEST ARM · capture.sh against a fake socket: every request it made was a GET, and the capture verifies", async () => {
    const r = await captureRun();
    assert(r.status === 0, r.out);
    const methods = r.methods;
    assert(methods.length >= 4, `only ${methods.length} requests: ${methods.join(", ")}`);
    assert(methods.every((m) => m.startsWith("GET ")), `a non-GET request: ${methods.join(", ")}`);
    assert(methods.some((m) => m.startsWith("GET /explain?decisionHash=")), "no /explain request");
    const v = verify(r.reg, r.dir, r.cap, RUBRIC);
    assert(v.result === "SCORABLE", `${v.result}: ${JSON.stringify(v.checks.filter((c) => !c.ok))}`);
    assert((statSync(join(r.cap, "MANIFEST")).mode & 0o777) === 0o400, "MANIFEST not 0400");
  });

  await check("PAGING (MP6) · 1200 events at limit 500: capture.sh pages on the last RETURNED seq and collects 1..1200; verify SCORABLE", async () => {
    const r = await captureRun((t0) => fakeBook(1200, t0));
    assert(r.status === 0, r.out);
    const ev = r.methods.filter((m) => m.startsWith("GET /events"));
    assert(ev.join(",") === "GET /events?after=0&limit=500,GET /events?after=500&limit=500,GET /events?after=1000&limit=500", ev.join(","));
    const all = JSON.parse(readFileSync(join(r.cap, "events-all.json"), "utf8")) as { seq: number }[];
    assert(all.length === 1200 && all.every((e, i) => e.seq === i + 1), `captured ${all.length}`);
    assert(!readdirSync(r.cap).includes("INCOMPLETE"), "INCOMPLETE on a whole book");
    const v = verify(r.reg, r.dir, r.cap, RUBRIC);
    assert(v.result === "SCORABLE", `${v.result}: ${JSON.stringify(v.checks.filter((c) => !c.ok))}`);
    assert(v.checks.some((c) => c.name === "events contiguous" && c.ok && /1200 events/.test(c.detail)), "no contiguity check");
  });

  await check("PAGING (MP6) · a book with a hole (seq 700 missing): INCOMPLETE names it, exit 4, the capture is still sealed, verify VOID · INCOMPLETE", async () => {
    const r = await captureRun((t0) => fakeBook(1200, t0, { missing: [700] }));
    assert(r.status === 4, `exit ${r.status}: ${r.out}`);
    const inc = readFileSync(join(r.cap, "INCOMPLETE"), "utf8");
    assert(/seq 701 where 700 was due \(700\.\.700 missing\)/.test(inc), inc);
    assert(existsSync(r.cap + ".manifest.sha256") && !existsSync(r.cap + ".FAILED"), "an incomplete capture was not sealed");
    const v = verify(r.reg, r.dir, r.cap, RUBRIC);
    assert(v.result === "VOID · INCOMPLETE", v.result);
  });

  await check("PAGING (MP6) · more:true with an empty page: INCOMPLETE names it, exit 4, verify VOID · INCOMPLETE", async () => {
    const r = await captureRun((t0) => fakeBook(1200, t0, { emptyAfter: 500 }));
    assert(r.status === 4, `exit ${r.status}: ${r.out}`);
    const inc = readFileSync(join(r.cap, "INCOMPLETE"), "utf8");
    assert(/page after=500: more:true with an empty page \(lastSeq 1200\)/.test(inc), inc);
    assert(verify(r.reg, r.dir, r.cap, RUBRIC).result === "VOID · INCOMPLETE", "verify passed it");
  });

  await check("VERIFY (MP6) · eventSeqGaps: contiguous books pass; a hole, a repeat, a late start, a short tail and a missing lastSeq are each named", () => {
    const b = (...s: unknown[]) => s.map((seq) => ({ seq }));
    assert(eventSeqGaps(b(1, 2, 3), 3).length === 0, "1..3");
    assert(eventSeqGaps(b(0, 1), 1).length === 0, "0..1");
    assert(eventSeqGaps(b("1", "2"), 2).length === 0, "string seqs");
    assert(eventSeqGaps([], 0).length === 0, "the empty book");
    assert(/seqs 3\.\.4 missing/.test(eventSeqGaps(b(1, 2, 5), 5).join()), "a hole");
    assert(/repeated or out of order/.test(eventSeqGaps(b(1, 2, 2, 3), 3).join()), "a repeat");
    assert(/seqs 1\.\.500 missing before/.test(eventSeqGaps(b(501, 502), 502).join()), "a late start");
    assert(/501\.\.1200 missing/.test(eventSeqGaps(b(...Array.from({ length: 500 }, (_, i) => i + 1)), 1200).join()), "the old capture's short tail");
    assert(/no integer lastSeq/.test(eventSeqGaps(b(1), undefined).join()), "no lastSeq");
    assert(/no integer seq/.test(eventSeqGaps([{ seq: 1 }, { at: "x" }], 2).join()), "an event with no seq");
  });

  await check("capture.sh refuses before the window's end", () => {
    const root = temp("probe-early-");
    const reg = newRegister(root);
    const dir = newCase(root, "case-early");
    assert(sealCase(dir, reg).status === 0);
    windowAndStamp(dir, reg, new Date(Date.now() - 3600e3).toISOString(), new Date(Date.now() + 6 * 3600e3).toISOString(), new Date().toISOString());
    const r = sh("capture.sh", ["--case-dir", dir, "--socket", "x", "--book", "x", "--roster", "x", "--other-errands", "0"]);
    assert(r.status === 3 && /REFUSED — the window ends/.test(r.stderr), r.stderr);
  });

  await check("SEAL · nonces, 0400 files, 0500 dir, one SEALED line; a second seal is refused; a group-readable place is refused", () => {
    const root = temp("probe-seal-");
    const reg = newRegister(root);
    const dir = newCase(root, "case-a");
    const r = sealCase(dir, reg);
    assert(r.status === 0, r.stderr + r.stdout);
    assert(/^NONCE [0-9a-f]{64}\n/.test(readFileSync(join(dir, "case.md"), "utf8")), "case nonce");
    assert(/^[0-9a-f]{64}$/.test(JSON.parse(readFileSync(join(dir, "prediction.json"), "utf8")).nonce), "prediction nonce");
    assert((statSync(join(dir, "case.md")).mode & 0o777) === 0o400 && (statSync(dir).mode & 0o777) === 0o500, "modes");
    const lines = caseLines(readFileSync(reg, "utf8"), "case-a");
    assert(lines.length === 1 && lines[0].kind === "SEALED" && lines[0].mode === "REHEARSAL", JSON.stringify(lines));
    assert(lines[0].named.get("case") === sha256File(join(dir, "case.md")), "case sha");
    assert(sealCase(dir, reg).status !== 0, "second seal accepted");
    const open = newCase(temp("probe-open-"), "case-b");
    chmodSync(open, 0o750);
    const r2 = sealCase(open, reg);
    assert(r2.status !== 0 && /owner's alone/.test(r2.stderr), r2.stderr);
  });

  await check("REGISTER · append-only (prefix byte-checked), order SEALED → WINDOW → SCORED, dry-run writes nothing", () => {
    const root = temp("probe-reg-");
    const reg = newRegister(root);
    const dir = newCase(root, "case-r");
    const before = readFileSync(reg);
    const dry = ts("register.ts", ["sealed", "--register", reg, "--case-dir", dir, "--rubric", RUBRIC, "--by", "t"]);
    assert(dry.status === 0 && /DRY-RUN/.test(dry.stdout) && readFileSync(reg).equals(before), "dry-run wrote");
    const early = ts("register.ts", ["window", "--register", reg, "--case-dir", dir, "--by", "t", "--write"]);
    assert(early.status !== 0, "a WINDOW line before SEALED was accepted");
    assert(sealCase(dir, reg).status === 0);
    const after = readFileSync(reg);
    assert(after.subarray(0, before.length).equals(before), "prefix moved");
    const l = parseRegister(after.toString("utf8"));
    assert(l.length === 1 && l[0].named.get("prev") === "—", "prev of SEALED");
  });

  await check("REGISTER · SCORED quotes the scorer's file; refuses a non-score; refuses any score but VOID · SEAL BROKEN on a broken seal", () => {
    const root = temp("probe-sc-");
    const reg = newRegister(root);
    const dir = newCase(root, "case-s");
    assert(sealCase(dir, reg).status === 0);
    windowAndStamp(dir, reg, "2000-01-01T00:00:00Z", "2000-01-01T07:00:00Z", "2000-01-01T01:00:00Z", "2000-01-01T00:30:00Z");
    const cap = join(root, "cap");
    mkdirSync(cap);
    writeFileSync(join(cap, "MANIFEST"), "x\n");
    const vf = join(root, "verify.json");
    writeFileSync(vf, JSON.stringify({ result: "SCORABLE" }));
    const sf = join(root, "score.json");
    writeFileSync(sf, JSON.stringify({ score: "LOOKS FINE", branch: "SILENT" }));
    const bf = join(root, "brief.md");
    writeFileSync(bf, "a brief\n");
    const a = ["scored", "--register", reg, "--case-dir", dir, "--capture-dir", cap, "--rubric", RUBRIC, "--verify-file", vf, "--score-file", sf, "--brief-file", bf, "--scorer", "t", "--write"];
    let r = ts("register.ts", a);
    assert(r.status !== 0 && /no score value/.test(r.stderr), r.stderr);
    writeFileSync(sf, JSON.stringify({ score: "READ-AS-PREDICTED", branch: "SILENT" }));
    chmodSync(dir, 0o700);
    chmodSync(join(dir, "prediction.json"), 0o600);
    writeFileSync(join(dir, "prediction.json"), readFileSync(join(dir, "prediction.json"), "utf8").replace('"gate-x"', '"gate-y"'));
    r = ts("register.ts", a);
    assert(r.status !== 0 && /REFUSED: the seal of prediction/.test(r.stderr), r.stderr);
    writeFileSync(sf, JSON.stringify({ score: "VOID · SEAL BROKEN", branch: "NONE" }));
    const size = readFileSync(reg).length;
    r = ts("register.ts", a); // the verify file still says SCORABLE: not this capture's verdict (MP12)
    assert(r.status !== 0 && /re-derived/.test(r.stderr) && readFileSync(reg).length === size, r.stderr);
    writeFileSync(vf, JSON.stringify({ result: "VOID · SEAL BROKEN" }));
    r = ts("register.ts", a);
    assert(r.status === 0, r.stderr);
    const last = caseLines(readFileSync(reg, "utf8"), "case-s").pop()!;
    assert(last.kind === "SCORED" && last.named.get("score") === "VOID · SEAL BROKEN" && /never counted/.test(last.named.get("promotion") ?? ""), last.raw);
    assert(last.named.get("agreement") === "verify and scorer agree" && last.named.get("verify") === "VOID · SEAL BROKEN", `agreement: ${last.named.get("agreement")}`);
    assert(last.named.get("scorer")?.includes(`brief ${sha256File(bf)}`), "the brief's sha is cited");
    assert(last.named.get("prev") === caseLines(readFileSync(reg, "utf8"), "case-s")[1].sha, "prev chain");
  });

  await check("ADDENDUM (MP32) · scorer-brief and register scored: --addendum is optional, byte-identical without it, cited in the ceilings cell, and refused when empty, '|'-bearing, or not the brief's", () => {
    const root = temp("probe-mp32-");
    const reg = newRegister(root);
    const dir = newCase(root, "case-ad");
    assert(sealCase(dir, reg).status === 0);
    windowAndStamp(dir, reg, "2000-01-01T00:00:00Z", "2000-01-01T07:00:00Z", "2000-01-01T01:00:00Z", "2000-01-01T00:30:00Z");
    const cap = join(root, "cap");
    mkdirSync(cap);
    writeFileSync(join(cap, "MANIFEST"), "x\n");
    const ad = join(root, "ad.md");
    writeFileSync(ad, "  the delivery instant was public before the window closed  \nsecond line, not quoted\n");
    const adSha = sha256File(ad);
    const mk = (name: string, extra: string[]) => {
      const out = join(root, name);
      const r = ts("scorer-brief.ts", ["--register", reg, "--case-dir", dir, "--capture-dir", cap, "--rubric", RUBRIC, "--score-out", join(root, "score-out.json"), "--out", out, ...extra]);
      return { r, out };
    };
    // (a) brief: without the flag no section; with it the section, the path, the sha, and the count one higher
    const plain = mk("plain.md", []);
    assert(plain.r.status === 0 && !readFileSync(plain.out, "utf8").includes("Audit addendum"), plain.r.stderr);
    const withAd = mk("with.md", ["--addendum", ad]);
    assert(withAd.r.status === 0, withAd.r.stderr);
    const nPlain = Number(/\((\d+) files listed\)/.exec(plain.r.stdout)![1]);
    assert(/\((\d+) files listed\)/.exec(withAd.r.stdout)![1] === String(nPlain + 1), `${plain.r.stdout} / ${withAd.r.stdout}`);
    const wb = readFileSync(withAd.out, "utf8");
    assert(wb.includes(`## Audit addendum (one more file you may read; the audit's, appended after the brief was generated)\n\n- \`${ad}\` · ${adSha}\n\nRe-hash it yourself.`), "section");
    assert(wb.indexOf("## Audit addendum") < wb.indexOf("## The rubric") && wb.indexOf("## Audit addendum") > wb.indexOf("## Files you may read"), "section order");
    assert(wb.replace(/\n\n## Audit addendum[^]*?\n\n## The rubric/, "\n\n## The rubric")=== readFileSync(plain.out, "utf8"), "the section is the only difference");
    const empty = join(root, "empty.md");
    writeFileSync(empty, "");
    const bar = join(root, "bar.md");
    writeFileSync(bar, "a | b\n");
    for (const [f, why] of [[empty, /is empty/], [bar, /contains '\|'/], [join(root, "nope.md"), /unreadable/]] as const) {
      const r = mk("bad-" + sha256(f).slice(0, 6) + ".md", ["--addendum", f]);
      assert(r.r.status === 1 && why.test(r.r.stderr) && !existsSync(r.out), `${f}: ${r.r.stderr}`);
    }
    // (b) register scored, from the same state: break the seal so a VOID needs no live capture
    const vf = join(root, "verify.json");
    writeFileSync(vf, JSON.stringify({ result: "VOID · SEAL BROKEN" }));
    const sf = join(root, "score.json");
    writeFileSync(sf, JSON.stringify({ score: "VOID · SEAL BROKEN", branch: "NONE" }));
    chmodSync(dir, 0o700);
    chmodSync(join(dir, "prediction.json"), 0o600);
    writeFileSync(join(dir, "prediction.json"), readFileSync(join(dir, "prediction.json"), "utf8").replace('"gate-x"', '"gate-y"'));
    const run = (bf: string, extra: string[]) => {
      const copy = join(root, `reg-${sha256(bf + extra.join()).slice(0, 8)}.md`);
      writeFileSync(copy, readFileSync(reg));
      const r = ts("register.ts", ["scored", "--register", copy, "--case-dir", dir, "--capture-dir", cap, "--rubric", RUBRIC, "--verify-file", vf, "--score-file", sf, "--brief-file", bf, "--scorer", "t", "--write", ...extra]);
      return { r, copy, line: r.status === 0 ? caseLines(readFileSync(copy, "utf8"), "case-ad").pop()! : undefined };
    };
    const { SCORED_CEILINGS } = require("./probe-lib");
    const base = run(plain.out, []);
    assert(base.r.status === 0 && base.line!.named.get("ceilings") === SCORED_CEILINGS, `no flag: ${base.r.stderr}`);
    const cell = run(withAd.out, ["--addendum", ad]);
    assert(cell.r.status === 0, cell.r.stderr);
    assert(cell.line!.named.get("ceilings") === `${SCORED_CEILINGS} · addendum ${adSha} · the delivery instant was public before the window closed`, cell.line!.named.get("ceilings") ?? "");
    // the flagged line differs from the unflagged one only in the ceilings cell and the brief sha
    const strip = (l: string) => l.replace(/brief [0-9a-f]{64}/, "brief X").replace(/ceilings [^|]*\|/, "ceilings C |");
    assert(strip(cell.line!.raw) === strip(base.line!.raw), "other cells moved");
    // refusals append nothing
    const size = readFileSync(reg).length;
    for (const [bf, extra, why] of [
      [withAd.out, ["--addendum", empty], /is empty/],
      [withAd.out, ["--addendum", bar], /contains '\|'/],
      [withAd.out, ["--addendum", join(root, "nope.md")], /unreadable/],
      [plain.out, ["--addendum", ad], /names no audit addendum/],
      [withAd.out, [], /no --addendum was given/],
    ] as const) {
      const r = run(bf, [...extra]);
      assert(r.r.status === 1 && why.test(r.r.stderr) && readFileSync(r.copy).length === size, `${extra.join(" ")}: ${r.r.status} ${r.r.stderr}`);
    }
    const other = join(root, "other.md");
    writeFileSync(other, "another ceiling\n");
    const mm = run(withAd.out, ["--addendum", other]);
    assert(mm.r.status === 1 && /names addendum [0-9a-f]{64} but --addendum is/.test(mm.r.stderr) && readFileSync(mm.copy).length === size, mm.r.stderr);
  });

  await check("VOID EXIT + SCORED REFUSAL (MP12) · verify exits 0 only on SCORABLE, 3 on each VOID; scored refuses a SCORED value on each VOID and appends nothing", () => {
    const root = temp("probe-mp12-");
    const reg = newRegister(root);
    const bf = join(root, "brief.md");
    writeFileSync(bf, "a brief\n");
    let k = 0;
    /** A hand capture that verifies SCORABLE when delivered in the window (instants far ahead of the seal: no clock margin). */
    function handCase(id: string, deliveredAt: string) {
      const dir = newCase(root, id);
      assert(sealCase(dir, reg).status === 0, "seal");
      windowAndStamp(dir, reg, "2099-01-01T00:00:00Z", "2099-01-01T07:00:00Z", deliveredAt, "2099-01-01T00:30:00Z");
      const cap = join(root, `cap-${id}`);
      mkdirSync(cap);
      const put = (n: string, v: unknown) => writeFileSync(join(cap, n), JSON.stringify(v));
      put("status.json", { pilot: { state: "ACTIVE" }, instruments: [] });
      put("operator-word.json", { otherErrands: 0 });
      put("decisions.json", { deliveredAt });
      put("events-all.json", [{ seq: 1 }, { seq: 2 }]);
      put("events-page-1.json", { events: [{ seq: 1 }, { seq: 2 }], lastSeq: 2 });
      const seal = () => {
        const names = readdirSync(cap).filter((n) => n !== "MANIFEST").sort();
        if (existsSync(join(cap, "MANIFEST"))) chmodSync(join(cap, "MANIFEST"), 0o600);
        writeFileSync(join(cap, "MANIFEST"), names.map((n) => `${sha256File(join(cap, n))} 0 0 ${n}`).join("\n") + "\n");
        writeFileSync(cap + ".manifest.sha256", sha256File(join(cap, "MANIFEST")) + "\n");
      };
      seal();
      return { dir, cap, put, seal };
    }
    /** verify through its CLI (exit code, last line, --out), then scored offered READ-AS-PREDICTED with --write, then the verdict's own VOID dry. */
    function both(c: { dir: string; cap: string }, want: string) {
      const out = join(root, `verify-${++k}.json`);
      const v = ts("verify.ts", ["--register", reg, "--case-dir", c.dir, "--capture-dir", c.cap, "--rubric", RUBRIC, "--out", out]);
      const lastLine = v.stdout.trim().split("\n").pop();
      assert(lastLine === want, `verify printed ${lastLine}, wanted ${want}`);
      assert(v.status === (want === "SCORABLE" ? 0 : 3), `verify exit ${v.status} on ${want}`);
      assert(JSON.parse(readFileSync(out, "utf8")).result === want, "--out differs from the printed verdict");
      const sf = join(root, `score-${k}.json`);
      writeFileSync(sf, JSON.stringify({ score: "READ-AS-PREDICTED", branch: "SILENT" }));
      const a = ["scored", "--register", reg, "--case-dir", c.dir, "--capture-dir", c.cap, "--rubric", RUBRIC, "--verify-file", out, "--score-file", sf, "--brief-file", bf, "--scorer", "t"];
      const before = readFileSync(reg);
      const r = ts("register.ts", want === "SCORABLE" ? a : [...a, "--write"]);
      if (want === "SCORABLE") assert(r.status === 0 && /DRY-RUN/.test(r.stdout), `a SCORABLE capture was refused: ${r.stderr}`);
      else {
        const why = want === "VOID · SEAL BROKEN" ? "REFUSED: the seal of prediction" : `REFUSED: verify reads this capture as "${want}"`; // a broken seal: refused by the seal check first, as before MP12
        assert(r.status === 1 && r.stderr.includes(why), `scored on ${want}: exit ${r.status} ${r.stderr}`);
        assert(readFileSync(reg).equals(before), `scored appended on ${want}`);
        writeFileSync(sf, JSON.stringify({ score: want, branch: "NONE" }));
        const own = ts("register.ts", a);
        assert(own.status === 0 && /DRY-RUN/.test(own.stdout) && own.stdout.includes(`verify ${want}`), `its own VOID was refused on ${want}: ${own.stderr}`);
      }
      return { out, a, sf };
    }
    const c = handCase("case-m", "2099-01-01T01:00:00Z");
    both(c, "SCORABLE");
    c.put("status.json", { pilot: { state: "PAUSED" }, instruments: [] });
    c.seal();
    const cond = both(c, "VOID · CONDITION 1");
    const stale = join(root, "verify-stale.json");
    writeFileSync(stale, JSON.stringify({ result: "SCORABLE" }));
    writeFileSync(cond.sf, JSON.stringify({ score: "READ-AS-PREDICTED", branch: "SILENT" }));
    const sizeBefore = readFileSync(reg).length;
    const st = ts("register.ts", cond.a.map((x) => (x === cond.out ? stale : x)).concat("--write"));
    assert(st.status === 1 && /re-derived/.test(st.stderr) && readFileSync(reg).length === sizeBefore, `a stale SCORABLE verify file: ${st.stderr}`);
    writeFileSync(join(c.cap, "INCOMPLETE"), "a gap\n");
    c.seal();
    both(c, "VOID · INCOMPLETE");
    writeFileSync(join(c.cap, "status.json"), "{}");
    both(c, "VOID · CAPTURE ALTERED");
    chmodSync(c.dir, 0o700);
    chmodSync(join(c.dir, "prediction.json"), 0o600);
    writeFileSync(join(c.dir, "prediction.json"), readFileSync(join(c.dir, "prediction.json"), "utf8").replace('"gate-x"', '"gate-y"'));
    both(c, "VOID · SEAL BROKEN");
    const late = handCase("case-late", "2099-01-01T08:00:00Z");
    const lt = both(late, "VOID · NOT DELIVERED IN WINDOW");
    // the register still books a VOID's own line (the score file now carries that VOID)
    const w = ts("register.ts", [...lt.a, "--write"]);
    assert(w.status === 0 && /APPENDED/.test(w.stdout), w.stderr);
    const booked = caseLines(readFileSync(reg, "utf8"), "case-late").pop()!;
    assert(booked.kind === "SCORED" && booked.named.get("score") === "VOID · NOT DELIVERED IN WINDOW" && booked.named.get("agreement") === "verify and scorer agree", booked.raw);
    const gone = ts("verify.ts", ["--register", reg, "--case-dir", late.dir, "--capture-dir", join(root, "no-such-capture"), "--rubric", RUBRIC]);
    assert(gone.status === 3 && /VOID · CAPTURE ALTERED$/.test(gone.stdout.trim()), `a missing capture: exit ${gone.status} ${gone.stdout}`);
    const unread = ts("verify.ts", ["--register", join(root, "no-such-register.md"), "--case-dir", late.dir, "--capture-dir", late.cap, "--rubric", RUBRIC]);
    assert(unread.status === 3 && /FAIL readable/.test(unread.stdout) && /VOID · CAPTURE ALTERED$/.test(unread.stdout.trim()), `an unreadable case: exit ${unread.status} ${unread.stdout}`);
    const usage = ts("verify.ts", ["--register", reg, "--case-dir", c.dir, "--capture-dir", c.cap]);
    assert(usage.status === 1, `a usage error exits ${usage.status}`);
  });

  await check("REGISTER · void books VOID · SEAL CONDITION FAILED after SEALED only; refuses once a window exists, and a second time", () => {
    const root = temp("probe-void-");
    const reg = newRegister(root);
    const dir = newCase(root, "case-u");
    assert(sealCase(dir, reg).status === 0);
    const a = ["void", "--register", reg, "--case-dir", dir, "--reason", "class moved", "--ruling", "board x", "--write"];
    const before = readFileSync(reg);
    let r = ts("register.ts", a);
    assert(r.status === 0, r.stderr + r.stdout);
    assert(readFileSync(reg).subarray(0, before.length).equals(before), "prefix moved");
    const l = caseLines(readFileSync(reg, "utf8"), "case-u");
    assert(l.length === 2 && l[1].kind === "SCORED" && l[1].named.get("score") === "VOID · SEAL CONDITION FAILED", l[1].raw);
    assert(/^intact/.test(l[1].named.get("seal") ?? "") && l[1].named.get("prev") === l[0].sha && /^none/.test(l[1].named.get("promotion") ?? ""), l[1].raw);
    r = ts("register.ts", a);
    assert(r.status !== 0 && /exactly one SEALED/.test(r.stderr), "a second void was accepted");
    const dir2 = newCase(root, "case-w");
    assert(sealCase(dir2, reg).status === 0);
    windowAndStamp(dir2, reg, "2000-01-01T00:00:00Z", "2000-01-01T07:00:00Z", "2000-01-01T01:00:00Z", "2000-01-01T00:30:00Z");
    r = ts("register.ts", ["void", "--register", reg, "--case-dir", dir2, "--reason", "x", "--ruling", "y", "--write"]);
    assert(r.status !== 0, "an armed case was voided");
  });

  await check("VERIFY · an edited capture file, an unlisted file, a symlink, and a stamp outside the window are each VOID", async () => {
    const root = temp("probe-v-");
    const reg = newRegister(root);
    const dir = newCase(root, "case-v");
    assert(sealCase(dir, reg).status === 0);
    windowAndStamp(dir, reg, "2000-01-01T00:00:00Z", "2000-01-01T07:00:00Z", "2000-01-01T08:00:00Z", "2000-01-01T00:30:00Z");
    chmodSync(dir, 0o700);
    const cap = join(dir, "capture-x");
    mkdirSync(cap);
    writeFileSync(join(cap, "status.json"), JSON.stringify({ pilot: { state: "ACTIVE" } }));
    writeFileSync(join(cap, "operator-word.json"), JSON.stringify({ otherErrands: 0 }));
    const manifest = (names: string[]) => names.map((n) => `${sha256File(join(cap, n))} 0 0 ${n}`).join("\n") + "\n";
    writeFileSync(join(cap, "MANIFEST"), manifest(["operator-word.json", "status.json"]));
    writeFileSync(cap + ".manifest.sha256", sha256File(join(cap, "MANIFEST")) + "\n");
    assert(verify(reg, dir, cap, RUBRIC).result === "VOID · NOT DELIVERED IN WINDOW", "stamp outside the window");
    writeFileSync(join(cap, "status.json"), JSON.stringify({ pilot: { state: "ACTIV" } }));
    assert(verify(reg, dir, cap, RUBRIC).result === "VOID · CAPTURE ALTERED", "edited file");
    writeFileSync(join(cap, "status.json"), JSON.stringify({ pilot: { state: "ACTIVE" } }));
    writeFileSync(join(cap, "extra.json"), "{}");
    assert(verify(reg, dir, cap, RUBRIC).result === "VOID · CAPTURE ALTERED", "unlisted file");
    rmSync(join(cap, "extra.json"));
    const { symlinkSync } = require("fs");
    symlinkSync(join(cap, "status.json"), join(cap, "link.json"));
    assert(verify(reg, dir, cap, RUBRIC).result === "VOID · CAPTURE ALTERED", "a symlink in the capture");
    rmSync(join(cap, "link.json"));
    writeFileSync(join(cap, "MANIFEST"), manifest(["operator-word.json", "status.json"]) + "\n");
    assert(verify(reg, dir, cap, RUBRIC).result === "VOID · CAPTURE ALTERED", "MANIFEST ≠ its commitment");
  });

  await check("THE ARBITER'S LINES · window.sh and stamp-delivery.sh refuse without a tty and write nothing", () => {
    const root = temp("probe-tty-");
    const reg = newRegister(root);
    const dir = newCase(root, "case-t");
    assert(sealCase(dir, reg).status === 0);
    const w = sh("window.sh", ["--case-dir", dir, "--register", reg, "--socket", "x", "--go"]);
    assert(w.status === 3 && /no tty/.test(w.stderr), w.stderr);
    const s = sh("stamp-delivery.sh", ["--case-dir", dir, "--go"]);
    assert(s.status === 3 && /no tty/.test(s.stderr), s.stderr);
    assert(readdirSync(dir).sort().join(",") === "case.md,prediction.json", readdirSync(dir).join(","));
  });

  await check("THE ARBITER'S LINES · through a pty: the window (asked on the tty, never on argv) refuses under 6 h; the stamp refuses before a window exists", () => {
    const root = temp("probe-pty-");
    const reg = newRegister(root);
    const dir = newCase(root, "case-p");
    assert(sealCase(dir, reg).status === 0);
    const w = shTty("window.sh", ["--case-dir", dir, "--register", reg, "--socket", "x", "--go"], `${new Date(Date.now() + 3600e3).toISOString().slice(0, 19)}Z\n${new Date(Date.now() + 3600e3 + 359 * 60e3).toISOString().slice(0, 19)}Z\n`);
    assert(/under 6 h/.test(w.stdout), w.stdout);
    const past = shTty("window.sh", ["--case-dir", dir, "--register", reg, "--socket", "x", "--go"], "2000-01-01T00:00:00Z\n2000-01-01T07:00:00Z\n");
    assert(/START lies in the past/.test(past.stdout), past.stdout);
    const s = shTty("stamp-delivery.sh", ["--case-dir", dir, "--go"]);
    assert(/no committed window/.test(s.stdout), s.stdout);
    assert(readdirSync(dir).sort().join(",") === "case.md,prediction.json", readdirSync(dir).join(","));
  });

  for (const d of temps) {
    try {
      spawnSync("chmod", ["-R", "u+rwx", d]);
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  void sha256;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
