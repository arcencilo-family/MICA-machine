// ── MICA · doctor wire — the three commands, as functions ────────────────────
//
//   submitFinding  one doctor finding in; an adverse one raises ONE notice
//   recordReply    one reply in; recorded against the raising it names
//   printPairing   each raising, and the replies on record for it
//
// The thin entry points are under tools/doctor-wire/. Everything they do is here,
// with the caller's uid and stdin passed in, so the suite runs every branch
// without a second principal.
//
// THE COMMAND HAS NO TRANSPORT (audit ruling F2, 2026-11-02). MICA ships no wire,
// and this command is handed none, so every channel attempt in its raising reads
// NOT_CONFIGURED. That is the honest result and the output says so. The record in
// the notice book is the same record the bridge would write; the bridge's own
// transport, where a deployment declares one, is the bridge's.
//
// THE ROSTER IS notify's DEFAULT, AS THE BRIDGE'S IS. `buildNotifier` in
// src/glue/wire.ts passes no roster; neither does this. Same broadcast by
// construction: the whole roster, no order, no priority, no timer.
//
// THE HEAD IS NOT COMMITTED BY THIS COMMAND. The bridge commits the notice book's
// head through the witness intake when its deployment declares one; this command
// declares none, and its own attempt line says the head was committed nowhere.
// The bridge's next committed head covers the prefix this record is part of.

import { NoticeLog, NoticeSinks, lookAtNoticeLogFile, renderRaise } from "../mica/notify";
import type { NoticeLogRecord } from "../mica/notify";
import { declaredUidLine, loadDeclaration, noticeBookPath } from "./declaration";
import type { DoctorWireDeclaration } from "./declaration";
import { DOCTOR_FINDING_SOURCE_ID, findingEnvelope, findingRaises, parseFinding } from "./finding";
import { pairReplies, renderPairing } from "./pairing";
import { ReplyBook } from "./reply-book";
import type { ReplyRecord } from "./reply-book";
import { hasExactKeys, isNonNegInteger, isObject, isString } from "../mica/store/validate";
import type { Parsed } from "../mica/store/validate";

/** What the caller is, as this process can observe it, plus what it sent. */
export interface CommandInput {
  readonly declarationPath: string;
  readonly uid: number;
  readonly stdin: string;
}

/** 0 done · 1 refused or not written · 2 the input or declaration is unusable. */
export interface CommandResult {
  readonly exitCode: 0 | 1 | 2;
  readonly lines: readonly string[];
}

export const NO_TRANSPORT_LINE =
  "This command is handed no transport, so every channel attempt above reads " +
  "NOT_CONFIGURED: that is the honest result. Nothing was sent to any address by " +
  "this command; the raising is in the notice book, where the bridge and the " +
  "operator dashboard read it.";

function usage(lines: string[]): CommandResult {
  return { exitCode: 2, lines };
}

function refused(lines: string[]): CommandResult {
  return { exitCode: 1, lines };
}

function parseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Open the notice book for a command that must not create it. A missing book is
 * reported as missing — constructing a NoticeLog over an absent path would make
 * its directory, which a reader has no business doing.
 */
function openExistingNoticeBook(path: string): NoticeLog | string {
  const look = lookAtNoticeLogFile(path);
  if (look.state === "ABSENT") return `there is no notice book at ${path}: no raising is on record`;
  if (look.state === "CANNOT_SEE") return `the notice book ${path} cannot be looked at (${look.detail})`;
  const log = new NoticeLog({ path });
  if (log.getLoadState() === "CANNOT_VERIFY") {
    return `the notice book ${path} cannot be verified: ${log.getLastError() ?? "no detail"}`;
  }
  return log;
}

function withDeclaration(
  input: CommandInput,
  then: (d: DoctorWireDeclaration) => CommandResult
): CommandResult {
  const declaration = loadDeclaration(input.declarationPath);
  if (typeof declaration === "string") return usage([`NOT RUN — ${declaration}`]);
  return then(declaration);
}

// ── W1 ───────────────────────────────────────────────────────────────────────

export function submitFinding(input: CommandInput): CommandResult {
  return withDeclaration(input, (d) => {
    if (!d.findingSubmitterUids.includes(input.uid)) {
      return refused([
        `REFUSED — uid ${String(input.uid)} is not declared as a doctor-finding submitter. ` +
          "Nothing was raised and nothing was written.",
      ]);
    }
    const parsed = parseJson(input.stdin);
    if (parsed === undefined) return usage(["NOT RUN — the finding on stdin is not JSON"]);
    const finding = parseFinding(parsed);
    if (typeof finding === "string") return usage([`NOT RUN — ${finding}`]);

    if (!findingRaises(finding.kind)) {
      // Before the book is opened: opening it would create its directory, and a
      // finding that raises nothing must leave nothing behind.
      return {
        exitCode: 0,
        lines: [`${finding.kind} raises nothing (07a). No notice was raised and nothing was written.`],
      };
    }

    const submitter = declaredUidLine(input.uid, "a doctor-finding submitter", "submitted");
    const bookPath = noticeBookPath(d.noticeDir);
    const look = lookAtNoticeLogFile(bookPath);
    if (look.state === "CANNOT_SEE") {
      return refused([`REFUSED — the notice book ${bookPath} cannot be looked at (${look.detail}). Nothing was raised.`]);
    }
    const log = new NoticeLog({ path: bookPath });
    if (log.getLoadState() === "CANNOT_VERIFY") {
      return refused([
        `REFUSED — the notice book ${bookPath} cannot be verified: ${log.getLastError() ?? "no detail"}. ` +
          "Nothing was raised: a raising appended to a book that does not verify could not be named by a reply.",
      ]);
    }

    // notify's caller-supplied index: this source's own count so far. NOT the
    // raising's identity — see findingEnvelope.
    const sequence = log.getAll().filter((r) => r.sourceId === DOCTOR_FINDING_SOURCE_ID).length;
    const envelope = findingEnvelope(finding, submitter, sequence);
    if (envelope === null) return usage(["NOT RUN — this finding raises nothing"]);

    const sinks = new NoticeSinks({ noticeLog: log });
    const result = sinks.raise(envelope);
    const book = result.attempts.find((a) => a.sinkId === "notice-log");
    const persisted = book !== undefined && book.outcome === "ATTEMPTED";
    const lines = [renderRaise(result), "", NO_TRANSPORT_LINE];
    if (persisted && result.record !== null) {
      lines.push(
        `In the notice book at sequenceNumber ${String(result.record.sequenceNumber)}, ` +
          `hash ${result.record.hash}. A reply names this raising by those two.`
      );
      return { exitCode: 0, lines };
    }
    lines.push("The notice book record was NOT written durably; see the notice-log attempt above.");
    return { exitCode: 1, lines };
  });
}

// ── W2 ───────────────────────────────────────────────────────────────────────

const REPLY_KEYS = ["answersSequenceNumber", "answersHash"] as const;

export function recordReply(input: CommandInput): CommandResult {
  return withDeclaration(input, (d) => {
    const role = d.replyRoles[String(input.uid)];
    if (role === undefined) {
      return refused([
        `REFUSED — uid ${String(input.uid)} is not declared to record replies. Nothing was written.`,
      ]);
    }
    const parsed = parseJson(input.stdin);
    if (parsed === undefined) return usage(["NOT RUN — the reply on stdin is not JSON"]);
    if (!isObject(parsed) || !hasExactKeys(parsed as Parsed, REPLY_KEYS)) {
      return usage([`NOT RUN — a reply is exactly {${REPLY_KEYS.join(", ")}}`]);
    }
    const o = parsed as Parsed;
    if (!isNonNegInteger(o.answersSequenceNumber) || !isString(o.answersHash)) {
      return usage(["NOT RUN — answersSequenceNumber is a non-negative integer and answersHash a string"]);
    }

    const book = openExistingNoticeBook(noticeBookPath(d.noticeDir));
    if (typeof book === "string") return refused([`REFUSED — ${book}. Nothing was written.`]);
    const raising: NoticeLogRecord | undefined = book
      .getAll()
      .find((r) => r.sequenceNumber === o.answersSequenceNumber && r.hash === o.answersHash);
    if (raising === undefined) {
      return refused([
        `REFUSED — no raising in the notice book has sequenceNumber ` +
          `${String(o.answersSequenceNumber)} with hash ${String(o.answersHash)}. Nothing was written.`,
      ]);
    }

    const replies = new ReplyBook({ path: d.replyBook });
    if (replies.getLoadState() === "CANNOT_VERIFY") {
      return refused([
        `REFUSED — the reply book ${d.replyBook} cannot be verified: ${replies.getLastError() ?? "no detail"}. Nothing was written.`,
      ]);
    }
    const outcome = replies.record({
      role,
      answersSequenceNumber: raising.sequenceNumber,
      answersHash: raising.hash,
    });
    if (!outcome.persisted) {
      return refused([`NOT WRITTEN — ${outcome.detail ?? "the reply book did not persist the record"}`]);
    }
    return {
      exitCode: 0,
      lines: [
        `reply recorded: ${role} answers raising seq ${String(raising.sequenceNumber)} ` +
          `(${raising.sourceId} ${raising.kind}), reply book sequenceNumber ${String(outcome.record.sequenceNumber)}.`,
        declaredUidLine(input.uid, `the ${role}`, "recorded"),
        "A reply recorded is not a statement that anyone read, knew or agreed.",
      ],
    };
  });
}

// ── the pairing reader ───────────────────────────────────────────────────────

export function printPairing(input: CommandInput): CommandResult {
  return withDeclaration(input, (d) => {
    const book = openExistingNoticeBook(noticeBookPath(d.noticeDir));
    if (typeof book === "string") return refused([book]);
    const replyLines: string[] = [];
    const replies = new ReplyBook({ path: d.replyBook });
    if (replies.getLoadState() === "CANNOT_VERIFY") {
      return refused([`the reply book ${d.replyBook} cannot be verified: ${replies.getLastError() ?? "no detail"}`]);
    }
    if (replies.getLoadState() === "FIRST_BOOT_OR_ERASED") {
      replyLines.push(`the reply book ${d.replyBook} holds no record (absent or empty)`);
    }
    const replyRecords: readonly ReplyRecord[] = replies.getAll();
    return {
      exitCode: 0,
      lines: [...replyLines, ...renderPairing(pairReplies(book.getAll(), replyRecords))],
    };
  });
}
