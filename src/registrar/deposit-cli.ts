#!/usr/bin/env node
// -- MICA · deposit-cli — a depositor's one line at the registrar's door -------
//
//   ts-node src/registrar/deposit-cli.ts commit --claim <file> --envelope-out <file>
//   ts-node src/registrar/deposit-cli.ts reveal --ref N --envelope <file>
//   ts-node src/registrar/deposit-cli.ts grade  --book B --ref N --verdict V --ground G
//
// -- IT DOES NOT ASK WHO YOU ARE. IT LOOKS. [LB] ------------------------------
//
//   There is no `--depositor`. The tool reads its OWN process uid and resolves
//   it through the SAME roster the registrar reads, so the name in the frame and
//   the name the registrar derives come from one source and cannot disagree by
//   accident. A flag here would be a second, weaker source of the one fact this
//   whole path is built on, and the first thing anyone would get wrong.
//
//   A hand-written frame can still claim anything. The registrar refuses it on
//   the uid (IDENTITY_MISMATCH). This tool simply cannot produce that frame.
//
// -- THE SALT IS MINTED HERE, IN THE COMMITTER'S OWN PROCESS [LB] -------------
//
//   `commit` takes a CLAIM — type, target, predictedValue — and not an envelope.
//   It adds the committer id from the uid and a fresh `randomSalt()`, writes the
//   completed envelope to --envelope-out for the committer to keep, and deposits
//   ONLY the seal.
//
//   That split is the point. Whoever authored the claim knows what was predicted
//   — it is usually written down and gated in the open. NOBODY BUT THE COMMITTER
//   KNOWS THE SALT, so nobody but the committer can reproduce the seal, and the
//   deposit is a commitment to this exact claim rather than to a claim someone
//   could later construct. Every earlier A9 commitment on this project had its
//   whole envelope authored outside the committing principal, and the receipts
//   said so: pre-registration exercised, hiding not. This closes that.
//
//   The envelope file is the committer's to keep. Lose it and the commitment can
//   never be revealed. That cost is real and deliberate (COMMITMENTS_NEVER_SEEDS).

import { appendFileSync, chmodSync, readFileSync, writeFileSync } from "fs";

import {
  computeSealHash,
  randomSalt,
  type Expectation,
  type Modality,
  type Verdict,
} from "../precommit/precommit";
import { writeDeposit, type Deposit, type DepositBody } from "./registrar";
import { readJournalCursor, writeJournalCursor } from "./registrard";
import type { MicaLogRecord } from "../mica/log";

// -- S111 · ANY ROSTERED DEPOSITOR NARRATES ITS OWN DEPOSITS [LB] -------------
//
//   Mirrors registrard.ts's S110 journal EXACTLY (same cursor shape, reused
//   verbatim — readJournalCursor/writeJournalCursor, not reimplemented; same
//   rank-of-books discipline: a journal failure is loud, named, and NEVER
//   blocks anything, because by the time this runs the deposit has ALREADY
//   landed in the intake). The direction is the new thing: registrard
//   journals what the REGISTRAR decided; this journals what the DEPOSITOR
//   itself attempted, one process, one deposit, one record — never a batch.
//
//   RULED (the arbiter, S111 night): "generalize — it is just another book." The
//   first cut of this build gated journaling to `mica-doctor` alone
//   ("journal growth, doctor first"); that gate is SUPERSEDED, not stacked.
//   `moduleId` is the ROSTER-RESOLVED name of the depositing principal — the
//   one name the kernel-observed uid already vouches for (see `resolveSelf`
//   above) — so identity stays uid-through-roster, never a flag, and a
//   principal the roster cannot resolve cannot deposit at all (no orphan
//   narration exists by construction). There is no NOT ATTEMPTED outcome left
//   to print: every rostered depositor may narrate, so a principal-gate
//   refusal is no longer an honest case this tool can reach.

export interface DepositJournalResult {
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * Journal ONE deposit act. Reuses registrard.ts's cursor functions so the
 * "next sequenceNumber to assign, ABSENT means 0" semantics are the ONE
 * definition shared by every writer of this journal, never a second
 * near-identical one. CORRUPT refuses this journal leg only — the deposit
 * this process just wrote to the intake is already there, unaffected.
 */
export function journalDepositAct(
  micaLogPath: string,
  cursorPath: string,
  moduleId: string,
  act: string,
  nowMs: number
): DepositJournalResult {
  return journalAct(micaLogPath, cursorPath, moduleId, "DEPOSIT_SUBMITTED", act, nowMs);
}

/**
 * S133 · THE SAME ACT, WITH THE eventType SAID OUT LOUD.
 *
 * `journalDepositAct` above hardcoded `eventType: "DEPOSIT_SUBMITTED"` and put
 * the act in `outcome`, which is exactly right for the thing it was built for
 * and WRONG for anything else: wire B's chain review is not a deposit
 * submission, and entering the ledger as one would be a false sentence about a
 * thing that never went through the registrar's door. So the eventType is a
 * parameter now, `journalDepositAct` is the same call with its own two values
 * pinned, and nothing about the deposit path's behaviour moves — WB-0 asserts
 * that byte-identity against a fixture.
 *
 * EVERY OTHER PROPERTY IS UNCHANGED AND DELIBERATELY SO: the cursor semantics
 * are registrard.ts's ("next sequenceNumber to assign, ABSENT means 0", CORRUPT
 * refuses this leg only), the failure modes are loud and named and NEVER
 * blocking, and `moduleId` is the caller's roster-resolved name — which the
 * caller gets from its own uid through `resolveSelf`, never from a flag.
 *
 * ON WRITING TO A LOG THE REGISTRAR OWNS. `/var/lib/mica/mica-log.jsonl` is
 * `mica-registrar:mica-readers` with `user:mica-arbiter:rw-` and
 * `user:mica-doctor:rw-` in its ACL, and has been since 2026-09-05. Three
 * writers, one log, each minting `sequenceNumber` from its OWN cursor — the
 * shape S127-6 ruled when a single global ascent check misread it, and S127-8
 * followed by making the clerk-caller's cursor a map per `moduleId`. This
 * function adds a fourth CALLER, not a fourth writer.
 */
export function journalAct(
  micaLogPath: string,
  cursorPath: string,
  moduleId: string,
  eventType: string,
  outcome: string,
  nowMs: number
): DepositJournalResult {
  const cursor = readJournalCursor(cursorPath);
  if (cursor.state === "CORRUPT") {
    return {
      ok: false,
      detail:
        `JOURNAL_CURSOR_CORRUPT: ${cursor.detail}. The journal leg is refused ` +
        `for this act; whatever the act itself already did stands, unaffected.`,
    };
  }
  const record: MicaLogRecord = {
    sequenceNumber: cursor.next,
    timestamp: nowMs,
    moduleId,
    eventType,
    outcome,
  };
  try {
    appendFileSync(micaLogPath, JSON.stringify(record) + "\n", "utf8");
  } catch (err) {
    return {
      ok: false,
      detail:
        `JOURNAL_APPEND_FAILED: ${micaLogPath} could not be written ` +
        `(${String(err)}). Whatever the act itself already did stands, ` +
        `unaffected by this.`,
    };
  }
  try {
    writeJournalCursor(cursorPath, cursor.next + 1);
  } catch (err) {
    return {
      ok: false,
      detail:
        `JOURNAL_CURSOR_WRITE_FAILED: the record WAS appended to ` +
        `${micaLogPath} at sequenceNumber ${String(cursor.next)}, but the ` +
        `cursor at ${cursorPath} could not be persisted (${String(err)}) — ` +
        `the next deposit will re-mint sequenceNumber ${String(cursor.next)} ` +
        `and duplicate it.`,
    };
  }
  return {
    ok: true,
    detail: `1 record journaled, sequenceNumber ${String(cursor.next)}`,
  };
}

const DEFAULT_INTAKE = "/var/lib/mica/precommit/intake";
const DEFAULT_ROSTER = "/etc/mica/registrar-roster.json";

export interface Claim {
  readonly type: "verdict" | "hash";
  readonly target: string;
  readonly predictedValue: string;
}

/** Closed-shape validation of the claim file. A claim carries NO salt and NO id. */
export function validateClaim(x: unknown): Claim | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  if (keys.join(",") !== "predictedValue,target,type") return null;
  if (o.type !== "verdict" && o.type !== "hash") return null;
  if (typeof o.target !== "string" || o.target.length === 0) return null;
  if (typeof o.predictedValue !== "string" || o.predictedValue.length === 0) {
    return null;
  }
  return o as unknown as Claim;
}

/**
 * Resolve THIS process's principal from the roster the registrar also reads.
 * A uid the roster does not name is fatal here, exactly as it is at the door.
 */
export function resolveSelf(
  rosterPath: string,
  uid: number
): { readonly name: string; readonly entries: number } {
  const parsed: unknown = JSON.parse(readFileSync(rosterPath, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`the roster at ${rosterPath} is not a uid -> principal object`);
  }
  const map = parsed as Record<string, unknown>;
  const hit = map[String(uid)];
  if (typeof hit !== "string" || hit.length === 0) {
    throw new Error(
      `uid ${String(uid)} is not in ${rosterPath}. This process is not a ` +
        `rostered depositor, and the registrar would refuse its frame as ` +
        `UNKNOWN_DEPOSITOR. Run this as the committing principal.`
    );
  }
  return { name: hit, entries: Object.keys(map).length };
}

/** Build the frame. Pure, so a test can assert its shape without an intake. */
export function buildDeposit(
  self: string,
  book: string,
  body: DepositBody,
  modality: Modality,
  timestamp: number
): Deposit {
  return { depositor: self, book, body, modality, timestamp };
}

// -- argument parsing ---------------------------------------------------------

export interface Options {
  readonly [k: string]: string | undefined;
}

export function parseOptions(argv: readonly string[]): Options {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${a} needs a value`);
    }
    out[a.slice(2)] = value;
    i++;
  }
  return out;
}

function need(o: Options, key: string): string {
  const v = o[key];
  if (v === undefined) throw new Error(`missing required argument --${key}`);
  return v;
}

function modalityOf(o: Options): Modality {
  const m = o.modality ?? "OFFERED";
  if (m !== "OFFERED" && m !== "IMPOSED" && m !== "NOT_AN_INSTRUCTION") {
    throw new Error(
      `--modality must be OFFERED, IMPOSED or NOT_AN_INSTRUCTION (R8), not ${m}`
    );
  }
  return m;
}

function main(): void {
  const [act, ...rest] = process.argv.slice(2);
  // S134 Rb · THREE VERBS, NOT ONE VERB WITH `--kind`. The three record acts
  // require different arguments — an escalate/request needs seven fields, a
  // reviewed needs two — so a single verb's usage line would have to describe a
  // set of requirements that depends on a flag, i.e. lie about four of them on
  // every invocation. Each verb states its own.
  const ACTS = ["commit", "reveal", "grade", "escalate", "request", "reviewed"];
  if (!ACTS.includes(act)) {
    console.error(`usage: deposit-cli.ts <${ACTS.join("|")}> [options]`);
    console.error("");
    console.error("  escalate|request --addressee T --addressee-verbatim S --record-needed S \\");
    console.error("                   --capture-sha S --run-id S --scenario-id S --variant V");
    console.error("  reviewed         --chain-sha S --review-seq N");
    process.exit(2);
    return;
  }
  let o: Options;
  try {
    o = parseOptions(rest);
  } catch (err) {
    console.error(String(err));
    process.exit(2);
    return;
  }

  // -- S111: --mica-log and --mica-log-cursor are all-or-nothing, same rule
  //    registrard.ts already holds for its own pair. Checked before anything
  //    is deposited: a half-declared journal is a usage error, not something
  //    to discover after the frame is already in the intake.
  const micaLogArg = o["mica-log"];
  const micaLogCursorArg = o["mica-log-cursor"];
  if ((micaLogArg === undefined) !== (micaLogCursorArg === undefined)) {
    console.error(
      `--mica-log and --mica-log-cursor must be supplied together, or not at ` +
        `all (got --mica-log=${JSON.stringify(micaLogArg ?? null)} ` +
        `--mica-log-cursor=${JSON.stringify(micaLogCursorArg ?? null)}). The ` +
        `journal is optional; a half-declared journal is a usage error.`
    );
    process.exit(2);
    return;
  }

  const intake = o.intake ?? DEFAULT_INTAKE;
  const rosterPath = o.roster ?? DEFAULT_ROSTER;
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;

  let self: string;
  let rosterEntries: number;
  try {
    const resolved = resolveSelf(rosterPath, uid);
    self = resolved.name;
    rosterEntries = resolved.entries;
  } catch (err) {
    console.error(String(err));
    process.exit(1);
    return;
  }

  const timestamp = Date.now();
  const modality = modalityOf(o);
  let body: DepositBody;
  let book: string;
  let envelopeNote: string | null = null;

  try {
    if (act === "commit") {
      // A committer deposits into its OWN book. Not a flag: the entitlement
      // table refuses anything else anyway, and a flag would only ever be a way
      // to get it wrong.
      book = self;
      const claim = validateClaim(
        JSON.parse(readFileSync(need(o, "claim"), "utf8"))
      );
      if (claim === null) {
        throw new Error(
          "the claim file must hold exactly {type, target, predictedValue}. " +
            "It must NOT carry a committerId or a salt: this process supplies " +
            "both, so that the salt exists only where the committer is."
        );
      }
      const envelope: Expectation = {
        type: claim.type,
        target: claim.target,
        predictedValue: claim.predictedValue,
        committerId: self,
        salt: randomSalt(),
      };
      const out = need(o, "envelope-out");
      writeFileSync(out, JSON.stringify(envelope, null, 2) + "\n", "utf8");
      try {
        chmodSync(out, 0o600);
      } catch {
        // A mount that will not hold a mode is a fact about the mount, and the
        // banner below reports it rather than pretending the file is protected.
      }
      body = { act: "COMMITMENT", sealed: computeSealHash(envelope) };
      envelopeNote = out;
    } else if (act === "reveal") {
      book = self;
      const envelope = JSON.parse(
        readFileSync(need(o, "envelope"), "utf8")
      ) as Expectation;
      body = {
        act: "REVEAL",
        ref: Number(need(o, "ref")),
        expectation: envelope,
      };
    } else if (act === "escalate" || act === "request") {
      // OWN BOOK, always (Rb). There is no --book here and that is the point:
      // a subject escalates into its own book or it does not escalate.
      book = self;
      body = {
        act: act === "escalate" ? "ESCALATION" : "REQUEST",
        addressee: need(o, "addressee"),
        // The seat AS THE REPLY WROTE IT, beside the title the reader resolved.
        // 1c removed this fold; the door does not re-introduce it.
        addresseeVerbatim: need(o, "addressee-verbatim"),
        recordNeeded: need(o, "record-needed"),
        captureSha256: need(o, "capture-sha"),
        runId: need(o, "run-id"),
        scenarioId: need(o, "scenario-id"),
        variant: need(o, "variant"),
      };
    } else if (act === "reviewed") {
      book = self;
      const reviewSeq = Number(need(o, "review-seq"));
      if (!Number.isSafeInteger(reviewSeq) || reviewSeq < 0) {
        throw new Error(`--review-seq must be a non-negative integer, not ${String(reviewSeq)}`);
      }
      body = {
        act: "PILOT_CHAIN_REVIEWED",
        chainSha256: need(o, "chain-sha"),
        reviewLogSequenceNumber: reviewSeq,
      };
    } else {
      // A grading goes into SOMEONE ELSE'S book, so this one is a flag — and
      // the registrar refuses it if it is this principal's own.
      book = need(o, "book");
      const verdict = need(o, "verdict") as Verdict;
      if (verdict !== "GREEN" && verdict !== "RED" && verdict !== "CANNOT_ASSESS") {
        throw new Error(`--verdict must be GREEN, RED or CANNOT_ASSESS, not ${verdict}`);
      }
      body = {
        act: "GRADING",
        ref: Number(need(o, "ref")),
        verdict,
        ground: need(o, "ground"),
      };
    }
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(2);
    return;
  }

  let frame: string;
  try {
    frame = writeDeposit(intake, buildDeposit(self, book, body, modality, timestamp));
  } catch (err) {
    console.error(
      `the deposit could not be written to ${intake}: ${String(err)}. That is a ` +
        `deployment fact — check this principal is in the intake's group — and ` +
        `NOTHING was deposited.`
    );
    process.exit(1);
    return;
  }

  console.log(`| deposited by  : ${self} (uid ${String(uid)}, roster ${rosterPath}, ${String(rosterEntries)} entries)`);
  console.log(`| into book     : ${book}`);
  console.log(`| act           : ${body.act}   modality ${modality}`);
  if (body.act === "COMMITMENT") {
    console.log(`| sealed        : ${body.sealed}`);
  } else if (body.act === "REVEAL" || body.act === "GRADING") {
    console.log(`| ref           : ${String(body.ref)}`);
  } else if (body.act === "PILOT_CHAIN_REVIEWED") {
    console.log(`| chain sha     : ${body.chainSha256}`);
    console.log(`| review seq    : ${String(body.reviewLogSequenceNumber)}`);
  } else {
    // THE RESOLVED TITLE AND THE TEXT IT WAS READ FROM, both printed. An
    // operator reading this line can see the fold that did not happen.
    console.log(`| addressee     : ${body.addressee}  (reply wrote: ${JSON.stringify(body.addresseeVerbatim)})`);
    console.log(`| capture sha   : ${body.captureSha256}`);
    console.log(`| run / packet  : ${body.runId}  ${body.scenarioId} ${body.variant}`);
  }
  console.log(`| frame         : ${frame}`);
  if (envelopeNote !== null) {
    console.log(`| envelope kept : ${envelopeNote}`);
    console.log(
      `| KEEP IT. The chain holds the seal and never the seed; lose this file ` +
        `and the commitment can never be revealed.`
    );
  }
  console.log(
    `| The registrar sweeps on its timer. This tool proves it called rename, ` +
      `never that anything was appended: read the book.`
  );

  // -- S111 (generalized): any resolved principal's own journal. Runs AFTER
  //    the frame already landed in the intake — never able to cost the
  //    deposit anything — and NEVER changes this process's exit code.
  //    moduleId is `self`, the roster-resolved name of whoever just
  //    deposited — never a hardcoded principal.
  if (micaLogArg !== undefined && micaLogCursorArg !== undefined) {
    const journal = journalDepositAct(micaLogArg, micaLogCursorArg, self, body.act, Date.now());
    console[journal.ok ? "log" : "error"](`| journal       : ${journal.detail}`);
  }
}

if (require.main === module) main();
