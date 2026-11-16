#!/usr/bin/env node
// ── MICA · the DOOR — an addressed header becomes a record ────────────────
//
// S134 item 3, pilot 9 rung 1. Run as `mica-subject1`, immediately after the
// runner, over the captures the runner wrote.
//
//   ts-node src/probe/subject/door-cli.ts \
//     --captures <path> --run-id <id> --intake /var/lib/mica/precommit/intake \
//     --roster /etc/mica/registrar-roster.json [--record-book <path>] [--dry-run]
//
// ── ONE SENTENCE THIS TOOL IS ALLOWED TO SAY ─────────────────────────
//
//   Each capture line's FIVE-LINE HEADER was read by `header.ts`, and where the
//   DECISION named a seat from the 08r §3 roster, one deposit frame was written
//   to the registrar's intake naming that seat, the RECORD NEEDED line verbatim,
//   and the capture it was read from. It grades nothing, answers nothing, and
//   reads no part of a reply except the header.
//
// ── WHY THIS IS A SIBLING AND NOT A CLAUSE INSIDE THE RUNNER ─────────
//
//   The fork was proposed in the S134 beat-2 receipt before being wired. The
//   runner's one sentence is "it does not read the reply for meaning; nothing
//   inspects `content` except two structural notices, NEITHER OF WHICH CHANGES
//   WHAT IS RECORDED." Putting the door inside it breaks both halves, not one
//   clause — and three things follow that are worse than the sentence:
//
//     1. The runner resumes by SKIPPING captured keys. A capture written just
//        before a crash would be skipped on the next run and its record would
//        never be written — silently, on exactly the path the runner's
//        append-only design exists to survive.
//     2. A registrar refusal would become a failure inside the capture loop, in
//        the one tool that must not lose a reply it has already paid a vendor
//        call for.
//     3. The door could not be DRY-RUN. It would only exist inside a live run,
//        so the census the S134 brief §2 asks for — the door over pilot 8's
//        captures, depositing nothing — would be unobtainable.
//
//   Same principal, same evidence, and the captures file is already the evidence
//   by the runner's own design: it refuses to append past a line it cannot read,
//   so a captures file that exists is a file that parses.
//
// ── NOTHING ANSWERS (rung 1) ────────────────────────────────
//
//   This writes a record or it writes nothing. No reply is sent, no seat is
//   notified, no state is changed for the subject. Rung 2 is not this beat.
//
// EXIT CODES
//   0  every capture was read and every frame this run owed was written
//   2  usage
//   3  the captures file could not be read
//   4  a line is not a capture — refused WHOLE, never censused in part

import { createHash } from "crypto";
import { readFileSync } from "fs";

import { writeDeposit } from "../../registrar/registrar";
import type { DepositBody } from "../../registrar/registrar";
import { buildDeposit, resolveSelf } from "../../registrar/deposit-cli";
import { RecordBook } from "../../record/record-book";
import { readHeader } from "../header";
import type { AddresseeReading } from "../header";

class UsageRefused extends Error {}
class CapturesRefused extends Error {
  constructor(message: string, readonly code: number) {
    super(message);
  }
}

export interface DoorOptions {
  readonly captures: string;
  readonly runId: string;
  readonly intake: string;
  readonly roster: string;
  readonly recordBook: string | null;
  readonly dryRun: boolean;
}

export function parseDoorOptions(argv: readonly string[]): DoorOptions {
  const o = new Map<string, string>();
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (!flag.startsWith("--")) throw new UsageRefused(`unexpected argument: ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new UsageRefused(`${flag} needs a value`);
    }
    o.set(flag.slice(2), value);
    i++;
  }
  for (const required of ["captures", "run-id", "intake", "roster"]) {
    if (!o.has(required)) throw new UsageRefused(`missing required argument --${required}`);
  }
  return {
    captures: o.get("captures") as string,
    runId: o.get("run-id") as string,
    intake: o.get("intake") as string,
    roster: o.get("roster") as string,
    recordBook: o.get("record-book") ?? null,
    dryRun,
  };
}

/** One capture, and the sha of the LINE it was read from. */
export interface DoorCapture {
  readonly scenarioId: string;
  readonly variant: string;
  readonly reply: string;
  readonly captureSha256: string;
}

export function readDoorCaptures(path: string): readonly DoorCapture[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new CapturesRefused(`${path} could not be read: ${String(err)}`, 3);
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const out: DoorCapture[] = [];
  for (let i = 0; i < lines.length; i++) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      // REFUSED WHOLE, the same rule the header reader and the runner hold: a
      // census over a file nobody could read entirely would silently omit an
      // entry and still print a total.
      throw new CapturesRefused(
        `${path} line ${String(i + 1)} is not valid JSON. This tool refuses the FILE ` +
          `rather than depositing for the lines that happened to parse.`,
        4
      );
    }
    const o = parsed as Record<string, unknown>;
    if (typeof o.scenarioId !== "string" || typeof o.variant !== "string") {
      throw new CapturesRefused(
        `${path} line ${String(i + 1)} does not identify a call — no scenarioId/variant.`,
        4
      );
    }
    const response = o.response;
    let reply = "";
    if (typeof response === "object" && response !== null) {
      const message = (response as { message?: unknown }).message;
      if (typeof message === "object" && message !== null) {
        const content = (message as { content?: unknown }).content;
        if (typeof content === "string") reply = content;
      }
    }
    out.push({
      scenarioId: o.scenarioId,
      variant: o.variant,
      reply,
      captureSha256: createHash("sha256").update(lines[i], "utf8").digest("hex"),
    });
  }
  return out;
}

export type DoorAct = "ESCALATION" | "REQUEST" | "NONE";

export interface DoorReading {
  readonly capture: DoorCapture;
  readonly act: DoorAct;
  readonly addressee: AddresseeReading | null;
  readonly recordNeeded: string;
  /** Why no record, when there is none. Null when a record is owed. */
  readonly noRecordBecause: string | null;
}

/**
 * R1′ · A RECORD EXISTS ONLY WHERE THE HEADER NAMES A SEAT.
 *
 *   ESCALATE → <title>  becomes an ESCALATION
 *   HOLD     → <title>  becomes a REQUEST
 *   PROCEED  → <title>  becomes NOTHING, and is counted separately from a
 *                       decision that named nobody — they are different facts
 *                       and collapsing them is the fold 1c removed.
 *   bare HOLD / PROCEED becomes nothing, counted UNADDRESSED.
 *
 * A bare ESCALATE does not parse at all (08r §3, Rc) and never reaches here as a
 * decision; it arrives as an unparsed header and is counted as one.
 */
export function readDoor(capture: DoorCapture): DoorReading {
  const reading = readHeader(capture.reply);
  const recordNeeded = labelValue(capture.reply, "RECORD NEEDED");
  if (reading.decision === null) {
    return {
      capture,
      act: "NONE",
      addressee: null,
      recordNeeded,
      noRecordBecause: `the header did not parse (${reading.state}) — no decision, no seat, no record`,
    };
  }
  const addressee = reading.decision.addressee;
  if (addressee === null) {
    return {
      capture,
      act: "NONE",
      addressee: null,
      recordNeeded,
      noRecordBecause: `${reading.decision.kind} named no seat — UNADDRESSED`,
    };
  }
  if (reading.decision.kind === "PROCEED") {
    return {
      capture,
      act: "NONE",
      addressee,
      recordNeeded,
      noRecordBecause: `PROCEED named ${addressee.title}, and a PROCEED waits for nothing — no record`,
    };
  }
  return {
    capture,
    act: reading.decision.kind === "ESCALATE" ? "ESCALATION" : "REQUEST",
    addressee,
    recordNeeded,
    noRecordBecause: null,
  };
}

/** The RECORD NEEDED line's value, verbatim. Empty when the label is absent. */
function labelValue(reply: string, label: string): string {
  for (const line of reply.split(/\r?\n/)) {
    if (!line.startsWith(label)) continue;
    const rest = line.slice(label.length);
    const sep = /^(?:$|\s*[—–:-]\s*|\s{2,})/.exec(rest);
    if (sep === null) continue;
    return rest.slice(sep[0].length).trim();
  }
  return "";
}

const RULE = "──────────────────────────────────────────────────────────────";

function pad(value: string, width: number): string {
  return value.length >= width ? `${value} ` : value + " ".repeat(width - value.length);
}

export function main(argv: readonly string[]): number {
  let options: DoorOptions;
  try {
    options = parseDoorOptions(argv);
  } catch (err) {
    if (!(err instanceof UsageRefused)) throw err;
    console.log("── REFUSED · THE ARGUMENTS DO NOT NAME A RUN ───────────────");
    console.log("");
    console.log(`  ${err.message}`);
    console.log("");
    console.log("  usage: door-cli.ts --captures <path> --run-id <id> --intake <dir>");
    console.log("                     --roster <path> [--record-book <path>] [--dry-run]");
    console.log("");
    console.log("  Nothing was read and nothing was deposited.");
    return 2;
  }

  let captures: readonly DoorCapture[];
  try {
    captures = readDoorCaptures(options.captures);
  } catch (err) {
    if (!(err instanceof CapturesRefused)) throw err;
    console.log("── READ REFUSED ────────────────────────────────────────────");
    console.log("");
    console.log(`  ${err.message}`);
    console.log("");
    return err.code;
  }

  // WHO THIS PROCESS IS, FROM THE KERNEL THROUGH THE ROSTER. There is no
  // --depositor, for the reason deposit-cli.ts gives at length: a flag would be
  // a second, weaker source of the one fact the registrar checks against the
  // frame's owner uid.
  const uid = process.getuid === undefined ? -1 : process.getuid();
  let self: string;
  try {
    self = resolveSelf(options.roster, uid).name;
  } catch (err) {
    console.log("── REFUSED · THIS PROCESS IS NOT A ROSTERED DEPOSITOR ──────");
    console.log("");
    console.log(`  ${String(err instanceof Error ? err.message : err)}`);
    console.log("");
    return 2;
  }

  // IDEMPOTENT BY captureSha256, AGAINST THE BOOK ITSELF — not against a marker
  // file this tool would have to keep coherent. A frame already swept is gone
  // from the intake, so the intake cannot answer "did I deposit this"; the
  // record book can, and it is the authoritative store either way.
  const already = new Set<string>();
  if (options.recordBook !== null) {
    const book = new RecordBook({ path: options.recordBook });
    for (const record of book.getAll()) {
      if (record.kind === "ESCALATION" || record.kind === "REQUEST") {
        already.add(record.captureSha256);
      }
    }
  }

  console.log("── THE DOOR, BEFORE ANYTHING IS WRITTEN ────────────────────");
  console.log("");
  console.log(`  captures:      ${options.captures}`);
  console.log(`  lines read:    ${String(captures.length)}`);
  console.log(`  depositor:     ${self} (uid ${String(uid)})`);
  console.log(`  run id:        ${options.runId}`);
  console.log(`  record book:   ${options.recordBook ?? "NOT GIVEN — idempotence is not established this run"}`);
  console.log(`  already held:  ${String(already.size)} capture sha(s)`);
  console.log(`  mode:          ${options.dryRun ? "DRY RUN — nothing is deposited" : "DEPOSITING"}`);
  console.log("");

  const readings = captures.map(readDoor);

  console.log("── ONE LINE PER CAPTURE ────────────────────────────────────");
  console.log("");
  console.log(`  ${pad("scenario", 46)}${pad("variant", 9)}${pad("act", 12)}seat / why not`);
  console.log(`  ${RULE}`);
  for (const r of readings) {
    const tail =
      r.noRecordBecause === null
        ? `${(r.addressee as AddresseeReading).title} (reply wrote ${JSON.stringify((r.addressee as AddresseeReading).verbatim)})`
        : r.noRecordBecause;
    console.log(
      `  ${pad(r.capture.scenarioId, 46)}${pad(r.capture.variant, 9)}${pad(r.act, 12)}${tail}`
    );
  }
  console.log(`  ${RULE}`);

  const escalations = readings.filter((r) => r.act === "ESCALATION");
  const requests = readings.filter((r) => r.act === "REQUEST");
  const none = readings.filter((r) => r.act === "NONE");
  const unaddressed = none.filter((r) => r.addressee === null);
  const proceedWithSeat = none.filter((r) => r.addressee !== null);

  console.log("");
  console.log("── THE CENSUS ──────────────────────────────────────────────");
  console.log("");
  console.log(`  ESCALATION:            ${String(escalations.length)}`);
  console.log(`  REQUEST:               ${String(requests.length)}`);
  console.log(`  no record:             ${String(none.length)}`);
  console.log(`    ├─ named no seat:    ${String(unaddressed.length)}`);
  console.log(`    └─ PROCEED w/ seat:  ${String(proceedWithSeat.length)}`);
  console.log(`  counted:               ${String(readings.length)}`);
  console.log("");
  console.log("  A DECISION THAT NAMED NOBODY AND A PROCEED THAT NAMED A SEAT ARE NOT");
  console.log("  THE SAME FACT, so they are not one number. Both write nothing; only");
  console.log("  one of them was addressed to anyone.");
  console.log("");

  const owed = [...escalations, ...requests].filter(
    (r) => !already.has(r.capture.captureSha256)
  );
  const skipped = [...escalations, ...requests].length - owed.length;

  if (options.dryRun) {
    console.log(`  DRY RUN. ${String(owed.length)} frame(s) would be written, ${String(skipped)} already in the book.`);
    console.log("  Nothing was deposited, nothing was written, no clock was called.");
    return 0;
  }

  let written = 0;
  for (const r of owed) {
    const addressee = r.addressee as AddresseeReading;
    const body: DepositBody = {
      act: r.act === "ESCALATION" ? "ESCALATION" : "REQUEST",
      addressee: addressee.title,
      // THE SEAT AS THE REPLY WROTE IT, beside the title this reader resolved.
      addresseeVerbatim: addressee.verbatim,
      recordNeeded: r.recordNeeded,
      captureSha256: r.capture.captureSha256,
      runId: options.runId,
      scenarioId: r.capture.scenarioId,
      variant: r.capture.variant,
    };
    const frame = writeDeposit(
      options.intake,
      // OWN BOOK (Rb). The subject deposits into its own book or not at all.
      buildDeposit(self, self, body, "NOT_AN_INSTRUCTION", Date.now())
    );
    written++;
    console.log(`  ${pad(r.act, 12)}${pad(r.capture.scenarioId, 46)}${frame}`);
  }
  console.log("");
  console.log(`  ${String(written)} frame(s) written to ${options.intake}; ${String(skipped)} already in the book.`);
  console.log("");
  console.log("  NOTHING ANSWERS. Rung 1 makes the difference between an addressed");
  console.log("  decision and an unaddressed one a RECORD or the absence of one. No");
  console.log("  seat was notified and no reply was sent.");
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
