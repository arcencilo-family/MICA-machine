#!/usr/bin/env node
// -- MICA · registrard — one sweep of the registrar intake, then exit ----------
//
//   ts-node src/registrar/registrard.ts \
//     --root /var/lib/mica/precommit \
//     [--record-root /var/lib/mica/record] \
//     --witness-intake /var/lib/mica/witness/intake \
//     --witness-set-id <id> \
//     --roster /etc/mica/registrar-roster.json \
//     [--refusal-submitter-id mica-registrar-refusal] \
//     [--no-witness]
//
// ONE SWEEP AND EXIT, driven by a systemd TIMER rather than a loop. That is
// F4's proven shape taken from `mica-report`, and it is the honest one here: a
// crash is a unit failure the journal records, not a daemon that is up and
// quietly doing nothing. There is no retry and no queue in this process.
//
// EXIT CODES
//   0  the sweep ran AND every outcome reached the chained log. Refusals are
//      outcomes, not failures — a refused deposit is this custodian working,
//      and the log holds it.
//   1  the sweep could not run: a missing deployment act, an unreadable intake,
//      an unreadable roster. A DEPLOYMENT FACT, and it must be loud.
//   2  the arguments are wrong.
//   3  THE SWEEP RAN AND AT LEAST ONE OUTCOME WAS NOT RECORDED (S102).
//
//      A SEPARATE CODE FROM 1 ON PURPOSE. Exit 1 says the sweep could not run;
//      this says it ran and its record did not. Collapsing them would tell an
//      operator to go looking for a missing deployment act when the intake was
//      swept perfectly and the BOOK OF REFUSALS is the thing that is broken.
//
//      It exists because of what happened at 16:11:58 on 2026-09-02: a sweep
//      printed "1 refused ... Refusals are outcomes, not failures" while the
//      chained log was broken and nothing was appended. Exit 0, journal
//      "Finished", and a refusal that existed only in that line. The shout is
//      not the book.
//
// A REFUSAL IS NOT A FAILURE AND A FAILURE IS NOT A REFUSAL. Collapsing the two
// would make a permission problem look like a bad depositor, and this whole
// module exists to keep those apart.

import { appendFileSync, readFileSync, writeFileSync } from "fs";

import { vintageBannerText } from "../deploy/vintage";
import { fileDropNamedCommitter } from "../witness/drop-committer";
import {
  Registrar,
  REFUSAL_CHAIN_ID,
  rosterResolver,
  type DepositOutcome,
} from "./registrar";
import type { MicaLogRecord } from "../mica/log";

interface Args {
  root: string | null;
  /**
   * S134 Rb · the SECOND book's root. OPTIONAL, and its absence is honest: this
   * daemon then behaves exactly as it did before S134, and a record-kind deposit
   * is refused RECORD_BOOK_NOT_WIRED with the frame left in the intake for the
   * sweep that follows the deployment act.
   */
  recordRoot: string | null;
  witnessIntake: string | null;
  witnessSetId: string | null;
  roster: string | null;
  submitterId: string;
  /**
   * The submitter id under which the REFUSAL CHAIN's head is presented (S106).
   *
   * NULL MEANS THE REFUSAL CHAIN IS NOT PRESENTED, and null is the default. It
   * is a second id and not a second use of `--submitter-id` because THE DROP
   * TARGET FILENAME IS THE SUBMITTER ID: two chains presented under one id are
   * two drops renaming over one file, and within a single sweep the book head
   * always loses to the refusal head that follows it. See `refusalHeadCommitter`
   * in ./registrar for the measurement.
   *
   * A DEPLOYER SUPPLIES IT OR THE CHAIN IS NOT PRESENTED. Deriving one from
   * `--submitter-id` would be this process inventing an identity the deployment
   * never declared — and the witness's declared-submitter list is keyed on
   * exactly that identity, so the invention would decide, silently, whether
   * these heads are receipted.
   */
  refusalSubmitterId: string | null;
  noWitness: boolean;
  /**
   * S110 — the journal (self-narration, NOT the authoritative record; see the
   * §JOURNAL block below). OPTIONAL, paired with `micaLogCursor`: absent means
   * exactly today's behaviour, no journal attempted, nothing written. Both or
   * neither — a half-supplied pair is a usage error, same rule mica-guard.ts
   * already holds for --line-classes/--hold-at-or-above.
   */
  micaLog: string | null;
  micaLogCursor: string | null;
}

function parse(argv: readonly string[]): Args {
  const args: Args = {
    root: null,
    recordRoot: null,
    witnessIntake: null,
    witnessSetId: null,
    roster: null,
    submitterId: "mica-registrar",
    refusalSubmitterId: null,
    noWitness: false,
    micaLog: null,
    micaLogCursor: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") args.root = argv[++i] ?? null;
    else if (a === "--record-root") args.recordRoot = argv[++i] ?? null;
    else if (a === "--witness-intake") args.witnessIntake = argv[++i] ?? null;
    else if (a === "--witness-set-id") args.witnessSetId = argv[++i] ?? null;
    else if (a === "--roster") args.roster = argv[++i] ?? null;
    else if (a === "--submitter-id") args.submitterId = argv[++i] ?? "mica-registrar";
    else if (a === "--refusal-submitter-id") {
      args.refusalSubmitterId = argv[++i] ?? null;
    }
    else if (a === "--no-witness") args.noWitness = true;
    else if (a === "--mica-log") args.micaLog = argv[++i] ?? null;
    else if (a === "--mica-log-cursor") args.micaLogCursor = argv[++i] ?? null;
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  // ── THE TWO IDS MUST DIFFER, AND THIS IS THE CHEAPEST PLACE TO SAY SO ──────
  //
  //   The drop target filename IS the submitter id. Given the same id twice,
  //   the registrar presents the BOOK head and then the REFUSAL head over one
  //   filename inside a single sweep iteration, and the book head is gone before
  //   the witness's next tick — silently, on every accepted deposit, with both
  //   flags looking perfectly reasonable in the unit file.
  //
  //   Exit 2 (arguments are wrong), not a warning: a warning here is a line in
  //   a journal nobody reads until the heads have been missing for a week.
  if (
    args.refusalSubmitterId !== null &&
    args.refusalSubmitterId === args.submitterId
  ) {
    console.error(
      `--refusal-submitter-id must differ from --submitter-id (both are ` +
        `${JSON.stringify(args.submitterId)}). The drop target filename IS the ` +
        `submitter id: two chains presented under one id are two drops renaming ` +
        `over one file, and within a single sweep the book head always loses to ` +
        `the refusal head that follows it.`
    );
    process.exit(2);
  }
  // ── S110: --mica-log and --mica-log-cursor are all-or-nothing ─────────────
  //
  //   Same rule mica-guard.ts already holds for --line-classes/
  //   --hold-at-or-above: a half-injected pair is a USAGE error, not a quiet
  //   slide into "journal not attempted". The cautious default (neither flag,
  //   no journal) exists for a deployment that never asked for one — not for
  //   one that asked wrongly.
  if ((args.micaLog === null) !== (args.micaLogCursor === null)) {
    console.error(
      `--mica-log and --mica-log-cursor must be supplied together, or not at ` +
        `all (got --mica-log=${JSON.stringify(args.micaLog)} ` +
        `--mica-log-cursor=${JSON.stringify(args.micaLogCursor)}). The journal ` +
        `is optional; a half-declared journal is a usage error.`
    );
    process.exit(2);
  }
  return args;
}

/**
 * uid -> principal, as JSON: `{"987": "mica-arbiter", ...}`.
 *
 * A ROSTER IS DEPLOYMENT CONFIGURATION AND IS NOT INVENTED HERE. An absent or
 * malformed roster is exit 1, never an empty map: a registrar with an empty
 * roster refuses every deposit as UNKNOWN_DEPOSITOR, which looks exactly like a
 * quiet day and is in fact a broken deployment.
 */
function readRoster(path: string): ReadonlyMap<number, string> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("the roster is not a JSON object of uid -> principal");
  }
  const out = new Map<number, string>();
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const uid = Number(key);
    if (!Number.isSafeInteger(uid) || uid < 0) {
      throw new Error(`roster key ${JSON.stringify(key)} is not a uid`);
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`roster entry for uid ${key} is not a principal name`);
    }
    out.set(uid, value);
  }
  if (out.size === 0) {
    throw new Error(
      "the roster is empty. Every deposit would be refused UNKNOWN_DEPOSITOR, " +
        "which reads like a quiet day and is a broken deployment."
    );
  }
  return out;
}

function describe(o: DepositOutcome): string {
  if (o.outcome === "REFUSED") {
    return `REFUSED  ${o.reason.padEnd(18)} ${o.frame}  ${o.detail}`;
  }
  return (
    `ACCEPTED ${o.act.padEnd(18)} ${o.frame}  book=${o.book} ` +
    `seq=${String(o.sequenceNumber)} anchor=${o.anchor}` +
    (o.detail === null ? "" : `  (${o.detail})`)
  );
}

// ── S110 · the journal — self-narration, NEVER the authoritative record ──────
//
//   RANK OF BOOKS (house design point, [LB]): the refusal log and the witness
//   drop above are what a reader trusts — chained, signed, the thing S102 (the
//   16:11:58 finding) exists to protect. This journal is MICA's own account of
//   its own registrar to ITSELF, in the shape `mica-log-file.ts` can read
//   (`MicaLogRecord`, `../mica/log.ts:101-117`) — unchained, unsigned, and
//   ranked strictly below. A journal-append failure is loud (a NAMED state,
//   printed) and NEVER blocking: it must never cost a deposit its place in the
//   authoritative books, and it must never exit 3 — that code is reserved for
//   an AUTHORITATIVE record miss (S102), and collapsing a diary miss into it
//   would be exactly the two-valued blur this whole module exists to refuse.
//
// ── THE CURSOR: "next sequenceNumber to assign", not "last one used" ─────────
//
//   Unlike mica-clerk-caller.ts's cursor (which tracks the last EXTERNAL
//   sequenceNumber it had already carried), this journal MINTS its own
//   sequenceNumbers — a DepositOutcome carries no sequenceNumber of the kind
//   MicaLogRecord wants (AcceptedDeposit.sequenceNumber is the BOOK's own,
//   book-local counter; REFUSED outcomes carry none at all). So the cursor
//   here is a next-to-assign counter, ABSENT means 0 (nothing journaled yet),
//   and it advances by exactly the count of records this sweep actually wrote.
//
//   CORRUPT is refused FOR THE JOURNAL LEG ONLY — deposits still proceed
//   through the authoritative books untouched; this sweep's journal attempt
//   reports its named failure and tries again next sweep. Unlike the caller's
//   cursor, a corrupt journal cursor does NOT stop anything else in this
//   process, because the journal was never load-bearing to begin with.

export type JournalCursorState = "ABSENT" | "CORRUPT" | "OK";

export interface JournalCursorRead {
  readonly state: JournalCursorState;
  /** The next sequenceNumber to assign. 0 when ABSENT; meaningless when CORRUPT. */
  readonly next: number;
  readonly detail: string;
}

export function readJournalCursor(path: string): JournalCursorRead {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { state: "ABSENT", next: 0, detail: "no journal cursor file — nothing journaled yet" };
    }
    return { state: "CORRUPT", next: NaN, detail: `${path} could not be read (${String(code ?? err)})` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { state: "CORRUPT", next: NaN, detail: `${path} is not valid JSON: ${String(err)}` };
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !("nextSequenceNumber" in parsed)
  ) {
    return { state: "CORRUPT", next: NaN, detail: `${path} is not a JSON object carrying "nextSequenceNumber"` };
  }
  const value = (parsed as { nextSequenceNumber: unknown }).nextSequenceNumber;
  if (!Number.isInteger(value) || (value as number) < 0) {
    return {
      state: "CORRUPT",
      next: NaN,
      detail: `${path}'s "nextSequenceNumber" is not an integer >= 0: ${JSON.stringify(value)}`,
    };
  }
  return { state: "OK", next: value as number, detail: `${path}` };
}

export function writeJournalCursor(path: string, next: number): void {
  writeFileSync(path, JSON.stringify({ nextSequenceNumber: next }) + "\n", "utf8");
}

/** One line, the deposit outcome's OWN reason string — never invented here. */
function journalOutcomeReason(o: DepositOutcome): string {
  return o.outcome === "REFUSED" ? o.reason : o.act;
}

export interface JournalResult {
  /** false on ANY named failure. NEVER read as "the sweep failed". */
  readonly ok: boolean;
  readonly detail: string;
  readonly written: number;
}

/**
 * Journal every outcome from ONE sweep, in order, sequenceNumber minted from
 * the persisted cursor. Never throws — every failure becomes a named,
 * non-ok result, exactly the discipline `loadCadenceDeclaration` and this
 * file's own `readRoster`-adjacent callers already hold, so this program's
 * exit code never rides on the journal.
 */
export function journalOutcomes(
  micaLogPath: string,
  cursorPath: string,
  outcomes: readonly DepositOutcome[],
  nowMs: number
): JournalResult {
  if (outcomes.length === 0) {
    return { ok: true, detail: "nothing to journal this sweep", written: 0 };
  }
  const cursor = readJournalCursor(cursorPath);
  if (cursor.state === "CORRUPT") {
    return {
      ok: false,
      detail: `JOURNAL_CURSOR_CORRUPT: ${cursor.detail}. The journal leg is refused this ` +
        `sweep; deposits proceed through the authoritative books unaffected.`,
      written: 0,
    };
  }
  const start = cursor.next;
  const records: MicaLogRecord[] = outcomes.map((o, i) => ({
    sequenceNumber: start + i,
    timestamp: nowMs,
    moduleId: "mica-registrar",
    eventType: o.outcome === "REFUSED" ? "DEPOSIT_REFUSED" : "DEPOSIT_ACCEPTED",
    outcome: journalOutcomeReason(o),
  }));
  const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  try {
    appendFileSync(micaLogPath, lines, "utf8");
  } catch (err) {
    return {
      ok: false,
      detail: `JOURNAL_APPEND_FAILED: ${micaLogPath} could not be written (${String(err)}). ` +
        `The cursor is UNMOVED; the authoritative books already have every outcome ` +
        `this sweep judged, unaffected by this.`,
      written: 0,
    };
  }
  try {
    writeJournalCursor(cursorPath, start + records.length);
  } catch (err) {
    // The records ARE on disk; only the cursor failed. Named as its own state
    // because it is its own fact: the next sweep will re-read `start` from the
    // stale cursor and re-mint sequenceNumber(s) already used — a duplicate,
    // not a loss, and named so an operator can tell the two apart.
    return {
      ok: false,
      detail: `JOURNAL_CURSOR_WRITE_FAILED: ${records.length} record(s) WERE appended to ` +
        `${micaLogPath}, but the cursor at ${cursorPath} could not be persisted ` +
        `(${String(err)}) — the next sweep will re-mint sequenceNumber ${start} and duplicate it.`,
      written: records.length,
    };
  }
  return {
    ok: true,
    detail: `${records.length} record(s) journaled, sequenceNumber ${start}..${start + records.length - 1}`,
    written: records.length,
  };
}

function main(): void {
  const args = parse(process.argv.slice(2));
  const missing: string[] = [];
  if (args.root === null) missing.push("--root");
  if (args.witnessSetId === null) missing.push("--witness-set-id");
  if (args.roster === null) missing.push("--roster");
  if (!args.noWitness && args.witnessIntake === null) {
    missing.push("--witness-intake (or --no-witness, said out loud)");
  }
  if (missing.length > 0) {
    console.error(`missing required argument(s): ${missing.join(", ")}`);
    process.exit(2);
  }

  let roster: ReadonlyMap<number, string>;
  try {
    roster = readRoster(args.roster as string);
  } catch (err) {
    console.error(`the roster at ${String(args.roster)} is unusable: ${String(err)}`);
    process.exit(1);
    return;
  }

  // --no-witness IS A DECLARATION, NOT A DEFAULT. Running without it wired means
  // every entry is anchored NOT_DROPPED, which is honest and is also a much
  // weaker record; a deployment that wants that has to say so on the command
  // line, where the unit file shows it.
  // NAMED AS OF S105. The registrar's heads carry `chain_id: precommit:<book>`,
  // so a reader holding N books can tell which one a retained head belongs to.
  // The nameless committer still exists for the producers that have not been
  // ruled onto the named path; it is no longer reachable from here.
  const committer = args.noWitness
    ? undefined
    : fileDropNamedCommitter(args.witnessIntake as string, args.submitterId);

  // THE REFUSAL CHAIN'S OWN COMMITTER (S106). Absent unless a deployer named a
  // second submitter id, and absent whenever the witness is not wired at all —
  // `--no-witness` is one declaration and it covers both chains.
  const refusalCommitter =
    args.noWitness || args.refusalSubmitterId === null
      ? undefined
      : fileDropNamedCommitter(
          args.witnessIntake as string,
          args.refusalSubmitterId
        );

  let registrar: Registrar;
  try {
    registrar = new Registrar({
      root: args.root as string,
      recordRoot: args.recordRoot ?? undefined,
      witnessSetId: args.witnessSetId as string,
      resolvePrincipal: rosterResolver(roster),
      headCommitter: committer,
      refusalHeadCommitter: refusalCommitter,
    });
  } catch (err) {
    console.error(String(err));
    process.exit(1);
    return;
  }

  console.log(`| mica-registrar`);
  // THE LAY IS NOT THE RUN (S105 §2.1). See ../deploy/vintage.
  console.log(`| code vintage   : ${vintageBannerText()}`);
  console.log(`| root           : ${String(args.root)}`);
  // PRINTED EITHER WAY. "NOT WIRED" is a deployment state an operator should see
  // in the banner, not infer from a refusal three sweeps later.
  console.log(
    `| record root    : ${args.recordRoot ?? "NOT WIRED — ESCALATION / REQUEST / PILOT_CHAIN_REVIEWED will be refused, frames kept"}`
  );
  console.log(
    `| witness intake : ${args.noWitness ? "NOT WIRED (--no-witness)" : String(args.witnessIntake)}`
  );
  console.log(`| roster entries : ${String(roster.size)}`);
  // SAID EVERY RUN, in both states. An operator must be able to learn from the
  // journal alone whether the refusal chain is being presented — an absence
  // that is never printed is an absence nobody discovers.
  console.log(
    `| refusal head   : ${
      registrar.hasRefusalHeadCommitter
        ? `presented as ${String(args.refusalSubmitterId)} (chain ${REFUSAL_CHAIN_ID})`
        : args.noWitness
          ? "NOT PRESENTED (--no-witness covers both chains)"
          : "NOT PRESENTED — no --refusal-submitter-id. The refusal chain is " +
            "written and chained; its head reaches no witness."
    }`
  );

  let result;
  try {
    result = registrar.sweep();
  } catch (err) {
    console.error(String(err));
    process.exit(1);
    return;
  }

  // THE RECORD LINE RIDES WITH THE OUTCOME LINE, in the same register and
  // immediately beneath it. An operator reading the journal must not have to
  // know that a second field exists in order to learn that the record does not.
  result.outcomes.forEach((outcome, i) => {
    console.log(`  ${describe(outcome)}`);
    const rec = result.records[i];
    if (rec !== undefined && !rec.recorded) {
      console.log(
        `  NOT RECORDED  ${rec.frame}  this outcome exists only in this line: ` +
          `${rec.reason ?? "the chained log was not written"}`
      );
      console.log(
        `  THE FRAME WAS LEFT IN THE INTAKE. It is not consumed when its record ` +
          `could not be written, so a healthy sweep can still book it.`
      );
    }
  });

  // S110: the journal. Runs regardless of whether the authoritative books
  // recorded cleanly — it is about what the registrar DECIDED, not about the
  // book's own success — and NEVER affects the exit code below. Optional:
  // parse() already refused a half-declared pair, so both-null here means
  // "not asked for", not a partial failure.
  if (args.micaLog !== null && args.micaLogCursor !== null) {
    const journal = journalOutcomes(args.micaLog, args.micaLogCursor, result.outcomes, Date.now());
    console[journal.ok ? "log" : "error"](`| journal        : ${journal.detail}`);
  }

  const refused = result.outcomes.filter((o) => o.outcome === "REFUSED").length;
  const unrecorded = result.outcomes.length - result.recordedCount;
  console.log(
    `| chain on open  : ${result.chainState}`
  );
  console.log(
    `| swept ${String(result.seen)} frame(s): ` +
      `${String(result.seen - refused)} accepted, ${String(refused)} refused ` +
      // NEVER "n refused" alone again. A count of announcements is not a count
      // of records, and the summary said so for the last time at 16:11:58.
      `(${String(result.recordedCount)} recorded). ` +
      `Refusals are outcomes, not failures.`
  );
  if (unrecorded > 0) {
    console.error(
      `| ${String(unrecorded)} OUTCOME(S) WERE NOT RECORDED. This sweep is NOT ` +
        `clean: the deposits were judged and the book of refusals did not take ` +
        `them. Exit 3.`
    );
    process.exit(3);
  }
}

// S110: guarded, matching every other CLI entrypoint in this tree
// (witnessd.ts, mica-report.ts, mica-guard.ts, mica-clerk-caller.ts). Was a
// bare `main();` before this build — the only file in the tree without the
// guard, and the reason nothing could import from this file at all: an
// unguarded `main()` reads `process.argv` and calls `process.exit()` the
// moment anything requires it. Needed here as a PREREQUISITE for
// registrard.test.ts to import the journal functions above without running
// the CLI. No prior test relied on the unguarded form — registrard.ts had
// none before this build.
if (require.main === module) {
  main();
}
