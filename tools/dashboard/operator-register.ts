// ── MICA · the dashboard's OPERATOR register (wire-v01 W3) ────────────────────
//
// A sibling module of generate-dashboard.ts, reached ONLY when
// MICA_REGISTER=operator. It exists as its own file so that the `dashboard` and
// `outsider` pages stay byte-identical to what they were before this register
// was added, and so that its pure functions can be tested without running the
// whole generator (which scans src/ at import time).
//
// THE GENERATOR'S TWO HARD RULES HOLD HERE UNCHANGED
//
//   1. This module never imports from src/ and never executes instrument code.
//      It opens files for READING and writes exactly ONE file, in the output
//      directory. The two books it shows are parsed RAW, as text, from paths the
//      operator DECLARES by environment variable. Nothing is discovered.
//
//   2. NO POSITIVE HEALTH ATTESTATION. The light has exactly four states:
//        RED          some raising has no reply on record
//        GREY         every raising has at least one reply on record
//        CANNOT SEE   a book that is needed is undeclared, unreadable or holds
//                     lines this page could not parse
//        NO RAISING   the notice book is readable and holds no raising
//      There is no green. GREY is deliberately NOT the opposite of RED: a reply
//      on record is not a reading, an agreement or a remedy, and the page says
//      so in the state line itself. RED is the only state that asks for anything.
//
// RULED SHAPE (audit of 2026-11-02, binding on W3)
//
//   The sound ships in THIS register only: one inline script, no network. The
//   page says the sound needs one click to arm (browsers block autoplay) and
//   that the red light works without it. The other registers carry no
//   JavaScript. The script reads one data attribute off <body> and drives the
//   Web Audio API; it opens no connection and loads nothing.
//
// WHAT THIS PAGE CANNOT DO, AND SAYS
//
//   It VERIFIES NO CHAIN. Verifying a hash chain needs the chain arithmetic,
//   which lives in src/ and is not imported here. So the page parses the books
//   and says it does not verify them. A broken or forged chain renders exactly
//   as an intact one; the evidence is L0, not this page.
//
//   A reply pairs with a raising ONLY when BOTH answersSequenceNumber and
//   answersHash match a notice record. A sequence number alone is not enough:
//   a reply that names the right slot with the wrong hash answers something
//   that is not in this book. Such a reply is listed SEPARATELY, never dropped
//   and never attached to the nearest raising.
//
//   Wall-clock time appears only from a witness arrival stamp. None is joined
//   in this build, so every raising prints "no witness arrival stamp" and no
//   time of any kind. Age is a count of records, which is what this page knows.
//
// WORDING FENCE
//
//   No string this register speaks claims a person read, knew, agreed, was told
//   or received anything. "reply recorded" is the whole reply vocabulary. The
//   operator-register test greps this file's string table for the banned words.

import * as fs from "fs";
import * as path from "path";

// ── §A · THE STRING TABLE — every word this register speaks in its own voice ──

export const OPERATOR_STRINGS = {
  pageTitle: "MICA operator register",
  subtitle:
    "A rendering of two declared books at generation time. It goes stale the " +
    "moment either book moves. Regenerate.",
  fixedLines: [
    "A rendering, not the record; the evidence is L0.",
    "Nothing on this page is approval.",
    "For the doctor this is a doorbell, never the window: the doctor reads the record directly.",
  ],
  noChainLine: "This page parses the books and does not verify their chains.",
  soundHeading: "Sound",
  soundArmLine:
    "The sound needs one click to arm: browsers block autoplay. The red light " +
    "works without it.",
  armButton: "Arm sound",
  mutedButton: "Mute sound",
  soundArmedLine: "Sound armed. It sounds only while the light is red.",
  soundMutedLine: "Sound muted.",
  lightRed:
    "RED: at least one raising has no reply on record.",
  lightGrey:
    "GREY: every raising has at least one reply on record; a reply recorded is " +
    "not a reading, an agreement or a remedy.",
  lightCannotSee:
    "CANNOT SEE: a book this light needs is undeclared, unreadable or holds " +
    "lines this page could not parse. This is not red-off and not a reassurance.",
  lightNoRaising:
    "NO RAISING ON RECORD: the notice book is readable and holds no raising. " +
    "An empty book is a statement about the book, not about the machine.",
  raisingsHeading: "Raisings, in sequence order",
  repliesHeading: "Replies that match no raising",
  orphanNote:
    "Each of these names a sequence number and a hash that do not BOTH match a " +
    "record in the notice book as declared. They are listed apart, never dropped " +
    "and never attached to a nearby raising.",
  orphanLabel: "reply names no raising in this book",
  noReply: "no reply on record",
  replyBookCannotSee:
    "no reply on record here: the reply book is undeclared or unreadable, so no " +
    "reply could be paired, and the light counts this raising as having none",
  noWitnessStamp: "no witness arrival stamp",
  ageLabel: "records after it in the notice book",
  doctorHeading: "The doctor's latest attestation",
  noAttestation: "no doctor attestation on record",
  attestationStampNote:
    "timestamp is the attestation record's own field, as recorded; it is not a " +
    "witness arrival stamp",
  holesHeading: "Books and lines this page could not use",
  undeclared: "undeclared: the environment variable is not set",
  noneParsed: "none",
} as const;

/** The three env vars this register reads. Named once so README and test agree. */
export const OPERATOR_ENV = {
  noticeBook: "MICA_NOTICE_BOOK",
  replyBook: "MICA_REPLY_BOOK",
  doctorHistory: "MICA_DOCTOR_HISTORY",
} as const;

// ── §B · BOOK READS — every failure is printed, none is empty-and-fine ────────

export type BookRead =
  | { readonly state: "undeclared"; readonly envVar: string }
  | { readonly state: "unreadable"; readonly envVar: string; readonly abs: string; readonly reason: string }
  | { readonly state: "read"; readonly envVar: string; readonly abs: string; readonly lines: string[] };

/**
 * Read a declared book as text. An absent declaration and a failed read are
 * different holes.
 *
 * `absentIsEmpty` is for the REPLY book only: a declared reply book that does
 * not exist yet is the ordinary state before the first reply (the reply book
 * itself loads it as FIRST_BOOT_OR_ERASED), so it reads as a book with no
 * records. Read as a hole instead, it would keep the light off red for the very
 * first adverse raising — an alarm that cannot alarm (seat's change, wire-v01).
 * The notice book gets no such reading: a declared notice book that is absent
 * may be a wrong path, and "no raising" over a wrong path would be a quiet lie.
 */
export function readDeclared(
  envVar: string,
  declared: string | undefined,
  absentIsEmpty = false
): BookRead {
  if (declared === undefined || declared === "") return { state: "undeclared", envVar };
  const abs = path.resolve(declared);
  if (absentIsEmpty) {
    try {
      fs.statSync(abs);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { state: "read", envVar, abs, lines: [] };
    }
  }
  try {
    const text = fs.readFileSync(abs, "utf8");
    // A trailing newline ends the last record; it does not start another.
    const lines = text.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return { state: "read", envVar, abs, lines };
  } catch (e) {
    return { state: "unreadable", envVar, abs, reason: (e as Error).message };
  }
}

export interface NoticeRecord {
  readonly sourceId: string;
  readonly kind: string;
  readonly lines: string[];
  readonly sequenceNumber: number;
  readonly hash: string;
}

export interface ReplyRecord {
  readonly role: "doctor" | "arbiter" | "operator";
  readonly answersSequenceNumber: number;
  readonly answersHash: string;
  readonly sequenceNumber: number;
  readonly hash: string;
}

export interface HistoryAttestation {
  readonly sequenceNumber: number;
  readonly timestamp: unknown;
  readonly attesterId: unknown;
  readonly note: unknown;
}

export interface BadLine {
  readonly lineNo: number;
  readonly reason: string;
}

const HEX64 = /^[0-9a-f]{64}$/;

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function exactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const got = Object.keys(o).sort();
  const want = [...keys].sort();
  return got.length === want.length && got.every((k, i) => k === want[i]);
}

/** Parse the notice book RAW: exact keys, exact types, no chain arithmetic. */
export function parseNoticeLine(line: string): NoticeRecord | string {
  let o: unknown;
  try {
    o = JSON.parse(line);
  } catch {
    return "not JSON";
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return "not an object";
  const r = o as Record<string, unknown>;
  if (
    !exactKeys(r, [
      "sourceId",
      "kind",
      "lines",
      "envelopeSequence",
      "attempts",
      "sequenceNumber",
      "previousHash",
      "hash",
    ])
  )
    return "keys are not the notice-book keys";
  if (typeof r.sourceId !== "string") return "sourceId is not a string";
  if (typeof r.kind !== "string") return "kind is not a string";
  if (!Array.isArray(r.lines) || !r.lines.every((l) => typeof l === "string"))
    return "lines is not a string array";
  if (!isInt(r.envelopeSequence)) return "envelopeSequence is not a non-negative integer";
  if (!Array.isArray(r.attempts)) return "attempts is not an array";
  if (!isInt(r.sequenceNumber)) return "sequenceNumber is not a non-negative integer";
  if (typeof r.previousHash !== "string") return "previousHash is not a string";
  if (typeof r.hash !== "string" || !HEX64.test(r.hash)) return "hash is not 64 hex";
  return {
    sourceId: r.sourceId,
    kind: r.kind,
    lines: r.lines as string[],
    sequenceNumber: r.sequenceNumber,
    hash: r.hash,
  };
}

/** Parse the reply book RAW, same discipline. */
export function parseReplyLine(line: string): ReplyRecord | string {
  let o: unknown;
  try {
    o = JSON.parse(line);
  } catch {
    return "not JSON";
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return "not an object";
  const r = o as Record<string, unknown>;
  if (
    !exactKeys(r, [
      "role",
      "answersSequenceNumber",
      "answersHash",
      "sequenceNumber",
      "previousHash",
      "hash",
    ])
  )
    return "keys are not the reply-book keys";
  if (r.role !== "doctor" && r.role !== "arbiter" && r.role !== "operator")
    return "role is not doctor, arbiter or operator";
  if (!isInt(r.answersSequenceNumber)) return "answersSequenceNumber is not a non-negative integer";
  if (typeof r.answersHash !== "string" || !HEX64.test(r.answersHash))
    return "answersHash is not 64 hex";
  if (!isInt(r.sequenceNumber)) return "sequenceNumber is not a non-negative integer";
  if (typeof r.previousHash !== "string") return "previousHash is not a string";
  if (typeof r.hash !== "string" || !HEX64.test(r.hash)) return "hash is not 64 hex";
  return {
    role: r.role,
    answersSequenceNumber: r.answersSequenceNumber,
    answersHash: r.answersHash,
    sequenceNumber: r.sequenceNumber,
    hash: r.hash,
  };
}

// ── §C · PAIRING — both halves of the key, or no pair ─────────────────────────

export interface Raising {
  readonly record: NoticeRecord;
  /** Roles of the replies on record that pair with this raising, in reply-book order. */
  readonly replies: ReplyRecord[];
  /** How many notice-book records came after this one. A count, never a time. */
  readonly recordsAfter: number;
}

export interface Paired {
  readonly raisings: Raising[];
  readonly orphans: ReplyRecord[];
}

export function pair(notices: NoticeRecord[], replies: ReplyRecord[]): Paired {
  const sorted = [...notices].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const key = (seq: number, hash: string): string => String(seq) + "\u0000" + hash;
  const byKey = new Map<string, ReplyRecord[]>();
  for (const n of sorted) byKey.set(key(n.sequenceNumber, n.hash), []);
  const orphans: ReplyRecord[] = [];
  for (const rp of replies) {
    const slot = byKey.get(key(rp.answersSequenceNumber, rp.answersHash));
    if (slot === undefined) orphans.push(rp);
    else slot.push(rp);
  }
  const raisings = sorted.map((n, i) => ({
    record: n,
    replies: byKey.get(key(n.sequenceNumber, n.hash)) ?? [],
    recordsAfter: sorted.length - 1 - i,
  }));
  return { raisings, orphans };
}

// ── §D · THE LIGHT — assigned by printed rule ─────────────────────────────────

export type Light = "red" | "grey" | "cannot-see" | "no-raising";

export interface OperatorView {
  readonly notice: BookRead;
  readonly reply: BookRead;
  readonly history: BookRead;
  readonly noticeBad: BadLine[];
  readonly replyBad: BadLine[];
  readonly paired: Paired;
  readonly attestation: HistoryAttestation | null;
  /** How many history records follow the attestation, or null when none is on record. */
  readonly attestationRecordsAfter: number | null;
  readonly historyBad: BadLine[];
  readonly light: Light;
}

/**
 * RED outranks everything: a raising that WAS read and has no reply this page
 * could pair with it turns the light red — including when the reply book is
 * undeclared or unreadable, because then no reply is on record from where this
 * page stands, and an alarm that waits for a readable reply book is an alarm a
 * missing file can silence (seat's change, wire-v01; the card says why). Beyond
 * that, anything unseen means the light cannot say "every raising has a reply",
 * because it has not seen every raising or every reply.
 */
export function lightFor(v: {
  notice: BookRead;
  reply: BookRead;
  noticeBad: BadLine[];
  replyBad: BadLine[];
  paired: Paired;
}): Light {
  if (v.paired.raisings.some((r) => r.replies.length === 0)) return "red";
  if (
    v.notice.state !== "read" ||
    v.reply.state !== "read" ||
    v.noticeBad.length > 0 ||
    v.replyBad.length > 0
  )
    return "cannot-see";
  if (v.paired.raisings.length === 0) return "no-raising";
  return "grey";
}

export function buildView(env: Record<string, string | undefined>): OperatorView {
  const notice = readDeclared(OPERATOR_ENV.noticeBook, env[OPERATOR_ENV.noticeBook]);
  const reply = readDeclared(OPERATOR_ENV.replyBook, env[OPERATOR_ENV.replyBook], true);
  const history = readDeclared(OPERATOR_ENV.doctorHistory, env[OPERATOR_ENV.doctorHistory]);

  const notices: NoticeRecord[] = [];
  const noticeBad: BadLine[] = [];
  if (notice.state === "read") {
    notice.lines.forEach((l, i) => {
      const p = parseNoticeLine(l);
      if (typeof p === "string") noticeBad.push({ lineNo: i + 1, reason: p });
      else notices.push(p);
    });
  }
  const replies: ReplyRecord[] = [];
  const replyBad: BadLine[] = [];
  if (reply.state === "read") {
    reply.lines.forEach((l, i) => {
      const p = parseReplyLine(l);
      if (typeof p === "string") replyBad.push({ lineNo: i + 1, reason: p });
      else replies.push(p);
    });
  }

  // The doctor's history: only DOCTOR_ATTESTATION records matter here. Other
  // record types are counted (they are what "age" counts) and otherwise ignored.
  let attestation: HistoryAttestation | null = null;
  let attestationRecordsAfter: number | null = null;
  const historyBad: BadLine[] = [];
  if (history.state === "read") {
    let total = 0;
    let atIndex = -1;
    history.lines.forEach((l, i) => {
      let o: unknown;
      try {
        o = JSON.parse(l);
      } catch {
        historyBad.push({ lineNo: i + 1, reason: "not JSON" });
        return;
      }
      if (typeof o !== "object" || o === null || Array.isArray(o)) {
        historyBad.push({ lineNo: i + 1, reason: "not an object" });
        return;
      }
      total++;
      const r = o as Record<string, unknown>;
      if (r.recordType === "DOCTOR_ATTESTATION" && isInt(r.sequenceNumber)) {
        if (attestation === null || r.sequenceNumber >= attestation.sequenceNumber) {
          attestation = {
            sequenceNumber: r.sequenceNumber,
            timestamp: r.timestamp,
            attesterId: r.attesterId,
            note: r.note,
          };
          atIndex = total - 1;
        }
      }
    });
    if (attestation !== null) attestationRecordsAfter = total - 1 - atIndex;
  }

  const paired = pair(notices, replies);
  const light = lightFor({ notice, reply, noticeBad, replyBad, paired });
  return {
    notice,
    reply,
    history,
    noticeBad,
    replyBad,
    paired,
    attestation,
    attestationRecordsAfter,
    historyBad,
    light,
  };
}

// ── §E · RENDER ───────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bookHole(b: BookRead): string | null {
  if (b.state === "undeclared")
    return b.envVar + " — " + OPERATOR_STRINGS.undeclared;
  if (b.state === "unreadable")
    return b.envVar + " — unreadable: " + b.abs + " — " + b.reason;
  return null;
}

/**
 * THE ONE SCRIPT. Inline, no network: it names no address, loads nothing and
 * opens no connection. It reads data-light off <body>; it sounds only while that
 * says "red"; it does nothing until the operator clicks, because browsers block
 * audio before a gesture. Without it the page is the same page with the same
 * red light. The string is built here, not templated, so the test can read it.
 */
export const OPERATOR_SCRIPT = `
(function () {
  var Ctx = window.AudioContext || window.webkitAudioContext;
  var ctx = null, armed = false, timer = null;
  var btn = document.getElementById("sound-btn");
  var state = document.getElementById("sound-state");
  function isRed() { return document.body.getAttribute("data-light") === "red"; }
  function beep() {
    if (!armed || !ctx || !isRed()) return;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "square"; o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.25);
  }
  if (!Ctx || !btn) { if (state) state.textContent = "Sound unavailable in this browser. The red light is unaffected."; return; }
  btn.addEventListener("click", function () {
    if (!armed) {
      ctx = ctx || new Ctx();
      if (ctx.resume) ctx.resume();
      armed = true;
      timer = setInterval(beep, 1500);
      btn.textContent = ${JSON.stringify(OPERATOR_STRINGS.mutedButton)};
      state.textContent = ${JSON.stringify(OPERATOR_STRINGS.soundArmedLine)};
      beep();
    } else {
      armed = false;
      if (timer) clearInterval(timer);
      timer = null;
      btn.textContent = ${JSON.stringify(OPERATOR_STRINGS.armButton)};
      state.textContent = ${JSON.stringify(OPERATOR_STRINGS.soundMutedLine)};
    }
  });
})();
`;

// No green anywhere. RED is the one alarming colour; GREY is deliberately dull;
// CANNOT SEE is hatched so it cannot be mistaken for either.
const OPERATOR_CSS = `
:root{--bg:#0b0d10;--panel:#12161b;--ink:#e8eef5;--dim:#95a3b3;--rule:#26303b;
  --red:#ff3b3b;--grey:#6b7480;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:28px 20px 80px}
h1{font-size:24px;margin:0 0 6px}
h2{font-size:17px;margin:30px 0 8px;padding-bottom:5px;border-bottom:1px solid var(--rule)}
.sub,.dim{color:var(--dim)}
code{font-family:var(--mono);font-size:12.5px}
.light{margin:18px 0;padding:16px 18px;border-radius:6px;border:2px solid var(--grey);
  background:var(--panel);font-weight:600}
.light.red{border-color:var(--red);background:#2a0d0d;color:#ffd6d6}
.light.grey{border-color:var(--grey)}
.light.no-raising{border-color:var(--grey);border-style:dashed}
.light.cannot-see{border-color:var(--grey);border-style:dotted;
  background:repeating-linear-gradient(45deg,var(--panel),var(--panel) 8px,#161b21 8px,#161b21 16px)}
.card{margin:10px 0;padding:10px 14px;background:var(--panel);border:1px solid var(--rule);border-radius:6px}
.card.unanswered{border-color:var(--red)}
.card dl{margin:6px 0 0;display:grid;grid-template-columns:max-content 1fr;gap:2px 14px}
.card dt{color:var(--dim);font-size:12px;text-transform:uppercase;letter-spacing:.07em}
.card dd{margin:0}
.fixed{margin:22px 0;padding:12px 14px;border:1px solid var(--rule);border-radius:6px}
.fixed p{margin:4px 0}
.hole{margin:10px 0;padding:10px 14px;border:1px dashed var(--grey);border-radius:6px}
button{font:inherit;padding:6px 14px;border-radius:5px;border:1px solid var(--grey);
  background:var(--panel);color:var(--ink);cursor:pointer}
`;

const LIGHT_LINE: Record<Light, string> = {
  red: OPERATOR_STRINGS.lightRed,
  grey: OPERATOR_STRINGS.lightGrey,
  "cannot-see": OPERATOR_STRINGS.lightCannotSee,
  "no-raising": OPERATOR_STRINGS.lightNoRaising,
};

function dl(rows: [string, string][]): string {
  return (
    "<dl>" +
    rows.map(([k, v]) => "<dt>" + esc(k) + "</dt><dd>" + v + "</dd>").join("") +
    "</dl>"
  );
}

export function renderOperatorPage(v: OperatorView, stamp: string): string {
  const S = OPERATOR_STRINGS;
  const o: string[] = [];

  o.push("<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">");
  o.push("<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">");
  o.push("<title>" + esc(S.pageTitle) + " — " + esc(stamp) + "</title>");
  o.push("<style>" + OPERATOR_CSS + "</style></head>\n");
  o.push("<body data-light=\"" + v.light + "\"><div class=\"wrap\">");
  o.push("<h1>" + esc(S.pageTitle) + "</h1>");
  o.push("<p class=\"sub\">" + esc(S.subtitle) + "</p>");

  // The light first: it is the one thing on the page that asks for anything.
  o.push(
    "<div class=\"light " + v.light + "\" id=\"light\">" + esc(LIGHT_LINE[v.light]) + "</div>"
  );

  // Sound controls. The button is inert without the script, and says so above.
  o.push("<h2>" + esc(S.soundHeading) + "</h2>");
  o.push("<p>" + esc(S.soundArmLine) + "</p>");
  o.push(
    "<p><button type=\"button\" id=\"sound-btn\">" + esc(S.armButton) + "</button> " +
      "<span id=\"sound-state\" class=\"dim\"></span></p>"
  );

  // Fixed lines, verbatim, and the no-chain line.
  o.push("<div class=\"fixed\">");
  for (const l of S.fixedLines) o.push("<p>" + esc(l) + "</p>");
  o.push("<p>" + esc(S.noChainLine) + "</p></div>");

  // Raisings.
  o.push("<h2>" + esc(S.raisingsHeading) + "</h2>");
  if (v.paired.raisings.length === 0) {
    o.push(
      "<p class=\"dim\">" +
        (v.notice.state === "read"
          ? esc("no raising lines parsed from the notice book")
          : esc("the notice book cannot be opened")) +
        "</p>"
    );
  }
  for (const r of v.paired.raisings) {
    const rec = r.record;
    const replyBookOpen = v.reply.state === "read";
    const replyText =
      !replyBookOpen
        ? esc(S.replyBookCannotSee)
        : r.replies.length === 0
        ? esc(S.noReply)
        : r.replies.map((x) => "reply recorded: " + esc(x.role)).join("; ");
    o.push(
      "<div class=\"card" + (r.replies.length === 0 ? " unanswered" : "") + "\">" +
        dl([
          ["sequenceNumber", esc(String(rec.sequenceNumber))],
          ["hash", "<code>" + esc(rec.hash.slice(0, 12)) + "</code>"],
          ["sourceId", esc(rec.sourceId)],
          ["kind", esc(rec.kind)],
          ["lines", rec.lines.length === 0 ? esc("none") : rec.lines.map(esc).join("<br>")],
          ["replies", replyText],
          ["age", esc(String(r.recordsAfter) + " " + S.ageLabel)],
          ["wall-clock", esc(S.noWitnessStamp)],
        ]) +
        "</div>"
    );
  }

  // Replies that pair with nothing.
  if (v.paired.orphans.length > 0) {
    o.push("<h2>" + esc(S.repliesHeading) + "</h2>");
    o.push("<p class=\"dim\">" + esc(S.orphanNote) + "</p>");
    for (const x of v.paired.orphans) {
      o.push(
        "<div class=\"card\">" +
          dl([
            ["status", esc(S.orphanLabel)],
            ["role", esc(x.role)],
            ["answersSequenceNumber", esc(String(x.answersSequenceNumber))],
            ["answersHash", "<code>" + esc(x.answersHash.slice(0, 12)) + "</code>"],
            ["reply sequenceNumber", esc(String(x.sequenceNumber))],
          ]) +
          "</div>"
      );
    }
  }

  // The doctor's attestation.
  o.push("<h2>" + esc(S.doctorHeading) + "</h2>");
  if (v.attestation === null) {
    o.push("<p>" + esc(S.noAttestation) + "</p>");
    const h = bookHole(v.history);
    if (h !== null) o.push("<p class=\"dim\">" + esc(h) + "</p>");
  } else {
    const a = v.attestation;
    o.push(
      "<div class=\"card\">" +
        dl([
          ["sequenceNumber", esc(String(a.sequenceNumber))],
          ["attesterId", esc(String(a.attesterId))],
          ["timestamp", esc(String(a.timestamp)) + " <span class=\"dim\">(" + esc(S.attestationStampNote) + ")</span>"],
          ["note", esc(String(a.note))],
          [
            "age",
            esc(String(v.attestationRecordsAfter ?? 0) + " records after it in the doctor history"),
          ],
        ]) +
        "</div>"
    );
  }

  // Holes: undeclared, unreadable, unparsable. Always printed when present.
  const holes: string[] = [];
  for (const b of [v.notice, v.reply, v.history]) {
    const h = bookHole(b);
    if (h !== null) holes.push(h);
  }
  const badOf = (label: string, bad: BadLine[]): void => {
    for (const b of bad) holes.push(label + " line " + b.lineNo + " — " + b.reason);
  };
  badOf(OPERATOR_ENV.noticeBook, v.noticeBad);
  badOf(OPERATOR_ENV.replyBook, v.replyBad);
  badOf(OPERATOR_ENV.doctorHistory, v.historyBad);
  o.push("<h2>" + esc(S.holesHeading) + "</h2>");
  if (holes.length === 0) o.push("<p class=\"dim\">" + esc(S.noneParsed) + "</p>");
  for (const h of holes) o.push("<div class=\"hole\">" + esc(h) + "</div>");

  o.push("</div>\n<script>" + OPERATOR_SCRIPT + "</script>\n</body></html>\n");
  return o.join("\n");
}

// ── §F · MAIN — the one file this register writes ─────────────────────────────

function pad(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

export function stampFor(d: Date): string {
  return (
    String(d.getFullYear()) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "-" +
    pad(d.getHours()) +
    pad(d.getMinutes())
  );
}

/**
 * Build the view from the environment, write exactly one file, print a summary.
 *
 * The page is named to the minute, so a second run in the same minute names the
 * same file. It is written exclusively (flag "wx"): a page already there is never
 * overwritten (README: "prior outputs are never overwritten"). On a collision
 * nothing is written, the refusal is printed, and null is returned.
 */
export function runOperatorRegister(
  env: Record<string, string | undefined>,
  outDir: string,
  now: Date = new Date()
): string | null {
  const v = buildView(env);
  const stamp = stampFor(now);
  const outPath = path.join(outDir, "mica-operator-" + stamp + ".html");
  try {
    fs.writeFileSync(outPath, renderOperatorPage(v, stamp), { encoding: "utf8", flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    process.stderr.write(
      "NOT WRITTEN — " + outPath + " already exists (a page from the same minute). " +
        "A prior output is never overwritten; run again in the next minute, or move " +
        "the earlier page deliberately.\n"
    );
    return null;
  }
  const lines = [
    "── MICA dashboard generator · operator register ──────────────",
    "light               : " + v.light,
    "raisings            : " + String(v.paired.raisings.length),
    "replies pairing none: " + String(v.paired.orphans.length),
    "unparsed lines      : " +
      String(v.noticeBad.length + v.replyBad.length + v.historyBad.length),
    "written             : " + outPath,
    "This generator attests nothing. It reports what it read, including what it " +
      "could not read.",
  ];
  process.stdout.write(lines.join("\n") + "\n");
  return outPath;
}
