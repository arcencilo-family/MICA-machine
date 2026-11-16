#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// MICA — mica-clerk-caller: the arm that carries MICA's own log to the clerk.
// A SEPARATE OS PROCESS. Ruled S109-B, arm (a): MICA's tree builds BOTH halves
// of item 2 — this is the caller; clerk-clock-stamps-file.ts is the reader.
//
//   npx ts-node src/glue/mica-clerk-caller.ts \
//     --log <path> --cursor <path> --stamps-out <path> \
//     --clerk-store <dir> [--clerk-socket <path>] --submitter-id <id> \
//     --submitter-key <path> --channel <name> \
//     [--second-log <path> --second-cursor <path> --second-stamps-out <path>] \
//     [--second-channel <name>]
//
// ── --clerk-socket, AND WHY --clerk-store ALONE WAS NOT ENOUGH ───────────────
//
//   S109 receipt §6's own draft units named a real gap: this arm's only prior
//   way to reach the clerk was `SocketClerkClient.forStore(clerkStore)`, which
//   derives the socket as `<clerkStore>/clerk.sock` (src/clerk/protocol.ts,
//   defaultSocketPath) — with no way to say otherwise. A deployment whose
//   clerk listens somewhere else (this box's own: `clerkd.ts --socket
//   /run/mica/clerk.sock`, away from that same default) could not be reached
//   at all. `--clerk-socket` is OPTIONAL and mirrors `clerkd.ts`'s own
//   resolution rule exactly — `args.socket ?? defaultSocketPath(storeDir)`
//   (src/clerk/clerkd.ts:171) — so the two ends of one connection resolve a
//   missing override the same way. ABSENT is BYTE-IDENTICAL to this arm's
//   prior behaviour: the derived path is computed the same way either side of
//   this change; see `resolveClerkSocketPath` below.
//
// ── WHAT IT IS ───────────────────────────────────────────────────────────────
//
//   A oneshot: it wakes, reads what MICA's log has that this arm has not yet
//   carried, submits each of those records to the clerk in order, appends the
//   resulting ClerkClockStamps to the file clerk-clock-stamps-file.ts reads,
//   and advances a one-integer cursor. S109 arm-recon receipt §2's own sketch,
//   scored §2.1: 4 clean NO / 2 minimal YES (a one-integer cursor; delegated,
//   not authored, crypto). This file is that arm, unchanged in shape.
//
// ── IT IS A ONESHOT, AND THE SCHEDULE IS NOT ITS BUSINESS ────────────────────
//
//   No timer lives in here — same discipline as mica-report.ts and
//   witnessd.ts's own `--once`. Unit/timer cadence is a deployment act (S108-D
//   grammar) and stays out of this file and out of the recipe.
//
// ── SIGNING: DELEGATED, NOT AUTHORED ──────────────────────────────────────────
//
//   Every cryptographic act here is `SignedSubmitter.submit()`
//   (src/clerk/client.ts), which itself delegates to `SocketClerkClient`
//   (`separation: SEPARATE_PROCESS`, S109-B's own instruction). This file does
//   not touch a key object, does not call `sign`, and does not canonicalise a
//   payload — `commit()` runs twice, once inside SignedSubmitter (for the
//   auth preimage) and once inside ClerkCore.submit (for the stored
//   commitment), and both are the clerk package's own code, imported and
//   called, never reimplemented. Precedent: mica-report.ts calling
//   engStructure() was graded "glue, not new instrument" (S108 receipt);
//   this is the same shape one level lower.
//
// ── ORDER, DEDUP, AND WHY SUBMIT-IN-ORDER (S109 arm-recon receipt §2) ────────
//
//   The clerk has NO dedup of its own: resubmitting the same payload mints a
//   brand-new clerk_seq every time. The cursor is the only thing standing
//   between a re-run and a double-stamp. Records are read from the MICA log in
//   file order, filtered against THAT WRITER'S OWN cursor entry (S127-8), and
//   submitted ONE AT A TIME in file order — never batched, never reordered.
//
// ── THREE WRITERS, ONE LOG — AND THE GATE THAT MISREAD THEM (S127-6) [LB] ────
//
//   MICA's log is not written by one principal. On the live box
//   `/var/lib/mica/mica-log.jsonl` carries `rw` for THREE: `mica-registrar`
//   (owner), `mica-arbiter` and `mica-doctor` (both by name, in the file's
//   ACL). Each mints `sequenceNumber` from its OWN counter, starting at 0.
//
//   The gate above — `log.verify()`, `mica-log-file.ts` — demanded one global
//   ascent until S127. The moment a second writer appended, record index 2 read
//   `doctor 0` after `registrar 0, 1`, and the check called it a break:
//   `brokenAt=2`. THIS ARM THEN EXITED 1 AT 00:00 ON EIGHT CONSECUTIVE NIGHTS
//   AND STAMPED NOTHING — the stamps file's last entry is 2026-09-04 22:47:52,
//   and the timer has fired every midnight since. Nothing on the box recorded
//   why: the two-line stderr this arm prints went nowhere that survived, so the
//   only visible symptom was a file that stopped growing. Ruled S127-6 (a);
//   order is now monotone PER `moduleId` and this arm's gate opens on a
//   correctly-interleaved log.
//
//   THE CURSOR FOLLOWED, RULED S127-8 — and it was not cosmetic. One integer
//   cannot address three independent sequence spaces: `registrar 5` and
//   `doctor 5` are different records wearing the same number. Worse than
//   imprecise, the single integer was PERMANENTLY EXCLUDING writers. Once the
//   registrar's own sequence had carried the cursor to 9, every record any
//   other writer minted below 9 — `doctor 0`, `arbiter 0`, and everything after
//   them up to 9 — fell out of scope for good: not deferred, not retried,
//   never stamped. Repairing the ORDER check alone would have opened this gate
//   onto exactly that silent loss. The cursor is now a map, one entry per
//   `moduleId`; see the cursor block below.
//
// ── FAIL LOUD, CURSOR STAYS PUT ───────────────────────────────────────────────
//
//   If ANY submission in a run's batch throws, the run stops immediately: no
//   stamps from THIS run are written, and the cursor does not move. The next
//   scheduled run re-attempts every record this run touched, submitted or not
//   — the same shape mica-registrar and mica-witnessd already hold. This is
//   deliberately NOT retry-with-backoff inside the process: one shot, and the
//   timer decides when the next one comes.
//
// ── THE ONE WINDOW THIS DOES NOT CLOSE, printed rather than buried ───────────
//
//   A crash between "the clerk accepted the last submission in this batch" and
//   "the stamps file was appended" leaves an ORPHAN RECEIPT at the clerk (a
//   submission with no matching local stamp) and the cursor unmoved — so the
//   next run resubmits that same record and the clerk mints it a SECOND
//   clerk_seq, because the clerk has no dedup. That second submission is
//   harmless to F3 (the sequenceNumber only ever gets ONE stamp written to the
//   stamps file — the one from whichever run actually completed its append),
//   but it is not free: it is a real, if orphaned, entry in the clerk's own
//   chain. This is the same class of gap the S109 arm-recon receipt names for
//   the design generally ("the clerk has no dedup of its own") and this build
//   does not close it further than "the append is one write, for the whole
//   batch, immediately before the one cursor write" already does.
//
// ── TWO JOURNALS, ONE RUN (Act B) ────────────────────────────────────────────
//
//   `--second-log / --second-cursor / --second-stamps-out` add a SECOND carry
//   job to the same run, so one arm under one submitter identity can carry the
//   registrar's journal AND the bridge's subject chain. Added for Act B, where
//   the subject log needs a clerk's arrival stamp and route (a) — reuse this
//   carrier — is the only one of the three routes that costs no key custody.
//
//   ABSENT IS BYTE-IDENTICAL, and that is a property of this file, not a hope:
//   with no second triple there is exactly ONE job, and a one-job run produces
//   the same `code`, the same `stampedCount` and the SAME MESSAGE STRINGS this
//   arm produced before the second triple existed. The per-job label that makes
//   a two-job run legible is prefixed ONLY when there is more than one job; a
//   test reads both shapes and pins the identity.
//
//   THE TRIPLE IS ALL-OR-NOTHING. One or two of the three flags is CANNOT_START
//   naming exactly which is missing — never a guessed sibling path. The same
//   "every path this program touches is a deployment decision" rule that gives
//   this arm no default paths at all gives the second journal none either.
//
//   `--second-channel` is OPTIONAL and its absence IS the primary `--channel`,
//   the one-exception shape `--clerk-socket` already holds here. It exists
//   because the clerk's channel is a real namespace: carrying two different
//   journals into one channel is the "stamps for the wrong log" confusion in
//   the clerk's own store rather than in ours.
//
//   ⚠ EACH JOB IS INDEPENDENT AND EVERY JOB RUNS. A failure in job 1 does NOT
//   skip job 2, and this is deliberate rather than tidy: the defect this arm
//   already carries a scar from (S127-6, eight silent nights) was ONE gate
//   closing and everything downstream of it stamping nothing. Coupling the
//   subject chain's stamps to the registrar journal's health would rebuild that
//   exact shape one layer up. Cursors and stamp files are per-job, so no job can
//   roll another back; the run's exit code is the WORST of the jobs' codes and
//   every job's messages are reported.
//
//   THE SUBMITTER IDENTITY IS THE RUN'S, NOT THE JOB'S. The key is loaded and
//   the clerk handshake performed AT MOST ONCE per run, lazily, on the first job
//   that actually has records in scope — and a failure of either is memoised, so
//   a second job does not re-attempt a handshake this run has already been
//   refused.
//
// ── EXIT CODES ───────────────────────────────────────────────────────────────
//
//   0  nothing to do, or every record in scope was submitted and stamped
//   1  could not start: a required flag was not supplied, the cursor file is
//      present and CORRUPT (refused, never guessed past), or the MICA log is
//      present and unreadable/malformed. Nothing was submitted.
//   2  the clerk refused or could not be reached partway through a batch.
//      Nothing from this run was written; the cursor is unmoved.
//
//   With two jobs the code is the WORST of the two, on the ordering
//   0 < 1 < 2 — a run that could not start one journal and was refused on the
//   other reports the refusal, which is the louder fact.
// ──────────────────────────────────────────────────────────────────────────────

import { appendFileSync, readFileSync, writeFileSync } from "fs";
import { createPrivateKey } from "crypto";
import type { KeyObject } from "crypto";

import { MicaLogFile, LOADED_UNVERIFIED_FILE } from "./mica-log-file";
// T8 · the chain-aware reader, for the ONE job whose log is chained. See
// `CarryJob.chained` for why job 2 and not job 1.
import { SubjectChainLog, LOADED_SUBJECT_CHAIN_VERIFIED } from "./subject-event-journal";
import type { MicaLogRecord } from "../mica/log";
import { SignedSubmitter, SocketClerkClient } from "../clerk/client";
import type { ClerkClient } from "../clerk/client";
import { defaultSocketPath } from "../clerk/protocol";
import type { ClerkClockStamp } from "../mica/sig";

export const EXIT = {
  OK: 0,
  CANNOT_START: 1,
  SUBMIT_FAILED: 2,
} as const;

export interface Args {
  /** No defaults for any path. Every one is a deployment decision. */
  log: string | null;
  cursor: string | null;
  stampsOut: string | null;
  clerkStore: string | null;
  /**
   * OPTIONAL — the one exception to "no defaults for any path" above, and
   * deliberately so: its absence IS the default, and the default is
   * `defaultSocketPath(clerkStore)` — the same derivation `clerkd.ts` itself
   * falls back to. See `resolveClerkSocketPath`.
   */
  clerkSocket: string | null;
  submitterId: string | null;
  submitterKey: string | null;
  channel: string | null;
  /**
   * ACT B — the second carry job. ALL THREE OR NONE; see `secondTripleProblem`.
   * No default path for any of them, for the same reason the first triple has
   * none: every path this program touches is a deployment decision.
   */
  secondLog: string | null;
  secondCursor: string | null;
  secondStampsOut: string | null;
  /**
   * OPTIONAL, and its absence IS `--channel` — the same one-exception shape
   * `--clerk-socket` holds above. Absent, a two-job run is byte-identical to
   * carrying both journals into the primary channel, which is what a
   * deployment that does not care gets; present, the two journals keep
   * separate namespaces in the clerk's own store.
   */
  secondChannel: string | null;

  /**
   * ⛔ MALFORMED INVOCATION, COLLECTED RATHER THAN THROWN. Every argument fault
   * the parser found, in the order it found them: a missing value, a
   * flag-shaped value, a repeated flag, an unrecognised token. A non-empty list
   * is CANNOT_START and NOTHING is opened, read or submitted — it is checked
   * beside `missingRequired`, before any file or clerk access.
   *
   * COLLECTED AND NOT THROWN so one run names EVERY fault on the line instead
   * of making the operator re-run to find the next one.
   */
  malformed: string[];
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    log: null,
    cursor: null,
    stampsOut: null,
    clerkStore: null,
    clerkSocket: null,
    submitterId: null,
    submitterKey: null,
    channel: null,
    secondLog: null,
    secondCursor: null,
    secondStampsOut: null,
    secondChannel: null,
    malformed: [],
  };
  // ── STRICT VALUE READING. A FLAG-SHAPED VALUE IS A MALFORMED INVOCATION ────
  //
  //   Every valued flag used to read `argv[++i] ?? null`, which accepts the NEXT
  //   FLAG as this flag's value. `--log --clerk-socket /run/x` then sets
  //   log="--clerk-socket" and drops the real path as an unrecognised token.
  //
  //   ⛔ THE FAILURES ARE NOT ALL LOUD, WHICH IS WHY THIS IS A GUARD AND NOT A
  //   TIDY-UP. Some arrangements refuse under the WRONG FLAG'S NAME; one becomes
  //   a SUCCESSFUL NO-OP — a swallowed `--log` leaves the literal relative path
  //   "--clerk-socket", and if no such file exists this arm reports "nothing to
  //   do" and exits 0. A run that stamped nothing then looks like a run with
  //   nothing to stamp. That is the S127-6 silent-night shape one layer up, and
  //   this arm exists because of it.
  //
  //   Same defect class as the relay scripts' `--allow-pilot --dry-run`, where a
  //   swallowed flag turned a rehearsal into a real act (2026-09-28).
  //
  //   FOUR REFUSALS, ALL BEFORE ANY FILE OR CLERK ACCESS: a missing value, a
  //   flag-shaped value, a repeated flag, and an unrecognised token.
  const VALUED_FLAGS = new Map<string, (v: string) => void>([
    ["--log", (v) => { args.log = v; }],
    ["--cursor", (v) => { args.cursor = v; }],
    ["--stamps-out", (v) => { args.stampsOut = v; }],
    ["--clerk-store", (v) => { args.clerkStore = v; }],
    ["--clerk-socket", (v) => { args.clerkSocket = v; }],
    ["--submitter-id", (v) => { args.submitterId = v; }],
    ["--submitter-key", (v) => { args.submitterKey = v; }],
    ["--channel", (v) => { args.channel = v; }],
    ["--second-log", (v) => { args.secondLog = v; }],
    ["--second-cursor", (v) => { args.secondCursor = v; }],
    ["--second-stamps-out", (v) => { args.secondStampsOut = v; }],
    ["--second-channel", (v) => { args.secondChannel = v; }],
  ]);

  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const assign = VALUED_FLAGS.get(a);
    if (assign === undefined) {
      args.malformed.push(
        `unrecognised argument ${JSON.stringify(a)}. This arm ignores nothing on its command line.`
      );
      continue;
    }
    if (seen.has(a)) {
      args.malformed.push(`${a} was given more than once; this arm takes each flag at most once.`);
      i++;
      continue;
    }
    seen.add(a);
    const v = argv[i + 1];
    if (v === undefined) {
      args.malformed.push(`${a} requires a value and was last on the command line.`);
      continue;
    }
    if (v.startsWith("--")) {
      args.malformed.push(
        `${a} requires a value and was followed by ${JSON.stringify(v)}, which is a flag. ` +
          `A value that looks like a flag is refused rather than consumed.`
      );
      continue;
    }
    assign(v);
    i++;
  }
  return args;
}

/**
 * The socket path this run will actually try. Mirrors `clerkd.ts`'s own
 * resolution rule EXACTLY: `args.socket ?? defaultSocketPath(storeDir)`
 * (`src/clerk/clerkd.ts:171`) — the two ends of one connection resolve a
 * missing override identically. Absent `--clerk-socket` is BYTE-IDENTICAL to
 * this arm's behaviour before this flag existed: `SocketClerkClient.forStore`
 * computed this same value internally; this just makes the value visible and
 * overridable, never changes what it was for the absent case.
 */
export function resolveClerkSocketPath(args: Args): string {
  return args.clerkSocket ?? defaultSocketPath(args.clerkStore as string);
}

export function missingRequired(args: Args): string[] {
  const missing: string[] = [];
  if (args.log === null) missing.push("--log");
  if (args.cursor === null) missing.push("--cursor");
  if (args.stampsOut === null) missing.push("--stamps-out");
  if (args.clerkStore === null) missing.push("--clerk-store");
  if (args.submitterId === null) missing.push("--submitter-id");
  if (args.submitterKey === null) missing.push("--submitter-key");
  if (args.channel === null) missing.push("--channel");
  return missing;
}

// ── ACT B · the second carry job ─────────────────────────────────────────────

/** One journal to carry: its log, its own cursor, its own stamps file. */
export interface CarryJob {
  /**
   * How this job is named in a two-job run's messages. EMPTY for a one-job
   * run, which is what makes ABSENT byte-identical: an empty label prefixes
   * nothing. See `labelled`.
   */
  readonly label: string;
  readonly log: string;
  readonly cursor: string;
  readonly stampsOut: string;
  readonly channel: string;
  /**
   * T8 · WHETHER THIS JOB'S LOG IS A HASH-CHAINED SUBJECT LOG.
   *
   * ⛔ THE TWO JOURNALS ARE NOT THE SAME KIND OF FILE, and this flag is the
   * whole of that fact. Job 1 is the REGISTRAR's log — plain JSONL, no boundary
   * record, no chain. Job 2 is the BRIDGE's subject log — chained since Act A,
   * with a `SUBJECT_LOG_BOUNDARY` at position 0 whose own hash is unique to
   * that chain. T8 requires every stamp to name its chain, and only job 2 HAS
   * one to name.
   *
   * The arbiter's ruling, 2026-09-29: the job-2 arm reads the subject log chain-aware
   * and REFUSES a log with no boundary at position 0. `false` here leaves job 1
   * byte-identical to what it was before T8 — its stamps carry no
   * `chainIdentity`, and F3 refuses them, which is correct: nothing reads job
   * 1's stamps through F3.
   */
  readonly chained: boolean;
}

/** The three second-triple flags, in the order a message should name them. */
const SECOND_TRIPLE: readonly (readonly [keyof Args, string])[] = [
  ["secondLog", "--second-log"],
  ["secondCursor", "--second-cursor"],
  ["secondStampsOut", "--second-stamps-out"],
];

/**
 * ALL THREE OR NONE. Returns null when the second triple is wholly absent
 * (one job) or wholly present (two jobs), and a refusal string when it is
 * PARTIAL — because a partial triple is a deployment that meant to carry a
 * second journal and did not say where one of its three files lives, and the
 * only honest completions are "invent a path" and "silently carry nothing".
 * `--second-channel` alone is also partial: it names a namespace for a job
 * that was not declared.
 */
export function secondTripleProblem(args: Args): string | null {
  const present = SECOND_TRIPLE.filter(([key]) => args[key] !== null);
  if (present.length === 0) {
    if (args.secondChannel === null) return null;
    return (
      `--second-channel was supplied with no second carry job. It names the ` +
      `clerk channel for a journal this run was never told to carry; supply ` +
      `${SECOND_TRIPLE.map(([, flag]) => flag).join(", ")} or drop it.`
    );
  }
  if (present.length === SECOND_TRIPLE.length) return null;
  const absent = SECOND_TRIPLE.filter(([key]) => args[key] === null).map(([, flag]) => flag);
  return (
    `THE SECOND CARRY JOB IS PARTIALLY DECLARED. Not supplied: ` +
    `${absent.join(", ")}. The second journal's log, cursor and stamps file ` +
    `are three deployment decisions and none of them is derived from the ` +
    `others: a second journal carried into the FIRST journal's cursor or ` +
    `stamps file is exactly the "stamps for the wrong log" confusion this ` +
    `triple exists to keep impossible.`
  );
}

/**
 * The jobs this run will carry, in order. ONE when the second triple is
 * absent — and that one carries an EMPTY label, so every message it produces
 * is byte-identical to what this arm produced before Act B.
 *
 * Callers must have checked `missingRequired` and `secondTripleProblem` first;
 * this function reads the args as already-validated.
 */
export function carryJobs(args: Args): readonly CarryJob[] {
  const primary: CarryJob = {
    label: "",
    log: args.log as string,
    cursor: args.cursor as string,
    stampsOut: args.stampsOut as string,
    channel: args.channel as string,
    // The registrar's log is not chained. See `CarryJob.chained`.
    chained: false,
  };
  if (args.secondLog === null) return [primary];
  return [
    { ...primary, label: "journal 1" },
    {
      label: "journal 2",
      log: args.secondLog,
      cursor: args.secondCursor as string,
      stampsOut: args.secondStampsOut as string,
      // Absent IS the primary channel — the `--clerk-socket` shape, stated in
      // one place so the two readings of "absent" cannot drift apart.
      channel: args.secondChannel ?? (args.channel as string),
      // T8 · the bridge's subject log IS chained, and this is the one job that
      // can name its chain.
      chained: true,
    },
  ];
}

/**
 * Non-blank lines in a stamps file, 0 when it is absent or empty. ONE read and
 * its errno decides — the `existsSync` split this tree has already paid for
 * twice (`mica-log-file.ts`, `witness-log-file.ts`): a file this process may
 * not READ must not be reported as a file that is not there. An unreadable
 * stamps file counts as -1 and is refused by the caller below on its own terms.
 */
export const STAMPS_FILE_UNREADABLE = -1;

function stampsFileLineCount(path: string): number {
  try {
    return readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0).length;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? 0 : STAMPS_FILE_UNREADABLE;
  }
}

/** `"journal 2: …"`, or the message verbatim when the label is empty. */
function labelled(job: CarryJob, message: string): string {
  return job.label.length === 0 ? message : `${job.label} (${job.log}): ${message}`;
}

/** The louder of two exit codes, on 0 &lt; 1 &lt; 2. */
function worse(
  a: (typeof EXIT)[keyof typeof EXIT],
  b: (typeof EXIT)[keyof typeof EXIT]
): (typeof EXIT)[keyof typeof EXIT] {
  return (b > a ? b : a) as (typeof EXIT)[keyof typeof EXIT];
}

// ── the cursor: ONE ENTRY PER WRITER, declared, never guessed past ───────────
//
// RULED S127-8. `{ "lastStamped": { "<moduleId>": <seq>, ... } }`. A writer
// with NO entry has had nothing stamped, so all of its records are in scope —
// the same meaning the old `-1` carried, expressed by absence rather than by a
// sentinel, because a per-writer map has somewhere honest to put "not seen".
//
// ── THE LEGACY SHAPE, AND THE ONE WRITER THIS FILE NAMES ────────────────────
//
//   A cursor file written before S127-8 is `{ "lastStamped": N }`. It is read
//   as `{ [LEGACY_CURSOR_MODULE_ID]: N }` — ruled, because the only cursor of
//   that shape that exists is this box's, and every record it ever advanced
//   past was the registrar's. THIS IS THE ONE PLACE IN THIS ARM WHERE A WRITER
//   IS NAMED IN CODE, and it is named as a constant rather than a literal so
//   it can be read, tested and argued with. The migration is READ-ONLY until a
//   run succeeds: the new shape reaches disk through the ordinary end-of-run
//   write and through no other path, so "the cursor is unmoved on a refused
//   run" stays literally true — a refused run leaves a legacy file BYTE-
//   IDENTICAL, and there is a test that reads the bytes to prove it.
//
// ABSENT (no file at the path) is the FIRST-RUN state: nothing has been
// stamped for anyone, so the map is empty and every record in the log is in
// scope. A file that IS there and parses to neither an integer nor a map of
// integers is CORRUPT — a different, louder fact than absence, and this arm
// refuses to guess past it (repairing it by resetting to empty could re-stamp
// everything already stamped; repairing it by refusing forward could silently
// orphan everything after). Same S108-C-family split as `loadCadenceDeclaration` and
// `loadDeclared`, but this one throws where those return a state, because a
// corrupt cursor is not a configuration the rest of this program can run
// blind on — an accidental double-stamp is the exact defect the cursor exists
// to prevent, and continuing past a value it cannot trust would be repairing
// with a coin flip.

/**
 * The writer a pre-S127-8 single-integer cursor is attributed to. Ruled
 * S127-8; see the block above for why this arm names a principal at all.
 */
export const LEGACY_CURSOR_MODULE_ID = "mica-registrar";

export type CursorReadState = "ABSENT" | "CORRUPT" | "OK";

export interface CursorRead {
  readonly state: CursorReadState;
  /** Per `moduleId`. EMPTY when ABSENT and when CORRUPT. A missing key means "nothing stamped for that writer". */
  readonly lastStamped: ReadonlyMap<string, number>;
  /** True when the file on disk carried the pre-S127-8 single-integer shape. */
  readonly legacy: boolean;
  readonly detail: string;
}

const EMPTY_CURSOR: ReadonlyMap<string, number> = new Map();

function isCursorSeq(x: unknown): x is number {
  return Number.isInteger(x) && (x as number) >= -1;
}

export function readCursor(path: string): CursorRead {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { state: "ABSENT", lastStamped: EMPTY_CURSOR, legacy: false, detail: "no cursor file — first run" };
    }
    return {
      state: "CORRUPT",
      lastStamped: EMPTY_CURSOR,
      legacy: false,
      detail: `${path} could not be read (${String(code ?? err)})`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      state: "CORRUPT",
      lastStamped: EMPTY_CURSOR,
      legacy: false,
      detail: `${path} is not valid JSON: ${String(err)}`,
    };
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !("lastStamped" in parsed)
  ) {
    return {
      state: "CORRUPT",
      lastStamped: EMPTY_CURSOR,
      legacy: false,
      detail: `${path} is not a JSON object carrying "lastStamped"`,
    };
  }
  const value = (parsed as { lastStamped: unknown }).lastStamped;

  // THE LEGACY SHAPE. Read, never rewritten here — see the block above.
  if (isCursorSeq(value)) {
    return {
      state: "OK",
      lastStamped: new Map([[LEGACY_CURSOR_MODULE_ID, value]]),
      legacy: true,
      detail: `${path} (pre-S127-8 single-integer cursor, read as ${LEGACY_CURSOR_MODULE_ID}=${String(value)})`,
    };
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      state: "CORRUPT",
      lastStamped: EMPTY_CURSOR,
      legacy: false,
      detail:
        `${path}'s "lastStamped" is neither an integer >= -1 nor a map of them: ` +
        `${JSON.stringify(value)}`,
    };
  }

  const map = new Map<string, number>();
  for (const [moduleId, seq] of Object.entries(value as Record<string, unknown>)) {
    if (moduleId.length === 0) {
      return {
        state: "CORRUPT",
        lastStamped: EMPTY_CURSOR,
        legacy: false,
        detail: `${path}'s "lastStamped" carries an empty moduleId key`,
      };
    }
    if (!isCursorSeq(seq)) {
      return {
        state: "CORRUPT",
        lastStamped: EMPTY_CURSOR,
        legacy: false,
        detail: `${path}'s "lastStamped[${moduleId}]" is not an integer >= -1: ${JSON.stringify(seq)}`,
      };
    }
    map.set(moduleId, seq);
  }
  return { state: "OK", lastStamped: map, legacy: false, detail: `${path}` };
}

/**
 * ONE write, whole map, keys sorted so the file is byte-stable across runs that
 * change nothing. Same single `writeFileSync` as before S127-8.
 */
export function writeCursor(path: string, lastStamped: ReadonlyMap<string, number>): void {
  const sorted: Record<string, number> = {};
  for (const key of [...lastStamped.keys()].sort()) sorted[key] = lastStamped.get(key) as number;
  writeFileSync(path, JSON.stringify({ lastStamped: sorted }) + "\n", "utf8");
}

/** One line for a message: `mica-doctor=3, mica-registrar=9`, or `(nothing stamped yet)`. */
function describeCursor(lastStamped: ReadonlyMap<string, number>): string {
  if (lastStamped.size === 0) return "(nothing stamped yet)";
  return [...lastStamped.keys()]
    .sort()
    .map((k) => `${k}=${String(lastStamped.get(k))}`)
    .join(", ");
}

// ── the batch ──────────────────────────────────────────────────────────────

/**
 * One run. The clock (`nowMs`-free — this arm stamps nothing itself; every
 * timestamp on the resulting ClerkClockStamp is the CLERK's, read at
 * `receipt.clerk_time`) and the client are both injected, so this body is
 * testable against a fake clerk without a socket.
 */
export interface RunResult {
  readonly code: (typeof EXIT)[keyof typeof EXIT];
  readonly messages: readonly string[];
  readonly stampedCount: number;
}

/**
 * The run's submitter identity, or the refusal that stopped it. Held as one
 * value so a second job re-uses whichever it was, rather than re-attempting a
 * handshake this run has already been refused.
 */
type SubmitterOutcome =
  | { readonly ok: true; readonly submitter: SignedSubmitter }
  | {
      readonly ok: false;
      readonly code: (typeof EXIT)[keyof typeof EXIT];
      readonly messages: readonly string[];
    };

/**
 * ONE key load and ONE clerk handshake per RUN, lazily, on the first job that
 * has records in scope. Memoised both ways: a run that could not load the key
 * does not load it twice, and a run the clerk refused does not knock twice.
 */
function submitterOnce(
  args: Args,
  client: ClerkClient
): () => Promise<SubmitterOutcome> {
  let cached: SubmitterOutcome | null = null;
  return async (): Promise<SubmitterOutcome> => {
    if (cached !== null) return cached;
    let privateKey: KeyObject;
    try {
      privateKey = createPrivateKey(readFileSync(args.submitterKey as string, "utf8"));
    } catch (err) {
      cached = {
        ok: false,
        code: EXIT.CANNOT_START,
        messages: [`THE SUBMITTER KEY COULD NOT BE LOADED: ${String(err)}`, `Nothing was submitted.`],
      };
      return cached;
    }
    try {
      cached = {
        ok: true,
        submitter: await SignedSubmitter.forClient(client, args.submitterId as string, privateKey),
      };
    } catch (err) {
      cached = {
        ok: false,
        code: EXIT.SUBMIT_FAILED,
        messages: [`COULD NOT REACH THE CLERK to establish this run's identity: ${String(err)}`],
      };
    }
    return cached;
  };
}

/**
 * ONE journal, carried. This is the body this arm has always had; Act B moved
 * it behind a `CarryJob` so a run can hold more than one of them, and changed
 * nothing else about it. With an empty label every message below is the string
 * this arm printed before the second triple existed.
 */
export async function runJob(
  job: CarryJob,
  getSubmitter: () => Promise<SubmitterOutcome>
): Promise<RunResult> {
  const cursor = readCursor(job.cursor);
  if (cursor.state === "CORRUPT") {
    return {
      code: EXIT.CANNOT_START,
      stampedCount: 0,
      messages: [
        labelled(job, `THE CURSOR IS CORRUPT: ${cursor.detail}`),
        labelled(
          job,
          `Nothing was submitted. A corrupt cursor is refused, not repaired: ` +
            `guessing it back to -1 risks re-stamping everything already stamped, ` +
            `and guessing it forward risks silently orphaning everything after.`
        ),
      ],
    };
  }

  // ── ACT B · A FIRST RUN ONTO A STAMPS FILE THAT IS ALREADY FULL ──────────
  //
  // Sequence numbers RESTART at a chain rotation. So a stamp keyed to
  // `sequenceNumber: 5` from the retired chain and a record at
  // `sequenceNumber: 5` in the new one are DIFFERENT RECORDS WEARING THE SAME
  // NUMBER — and `sig/index.ts:880-891` joins on that number ALONE. An old
  // stamp left in the file does not fail the join; it SUCCEEDS wrongly, and F3
  // then reads a real clerk receipt against the wrong record and calls the
  // result an independent axis. That is the worst failure available here: not
  // a refusal, a confident wrong answer.
  //
  // The cheap, exact catch is the pair of facts this job already holds. An
  // ABSENT cursor means THIS JOB HAS STAMPED NOTHING — that is the whole
  // meaning of absence (see the cursor block above). A stamps file that is not
  // empty therefore holds stamps some OTHER carry produced: a retired chain's,
  // or another journal's. Refused, never merged and never truncated, because
  // both repairs destroy evidence — the remedy is a path, and a path is a
  // deployment decision.
  //
  // ⚠ THIS IS THE ONE INPUT ON WHICH THIS ARM NO LONGER BEHAVES AS IT DID
  // BEFORE ACT B, and it is called out rather than folded into the
  // ABSENT-is-identical claim: previously this run would have re-stamped every
  // record in the log and appended the duplicates. [owed → the arbiter] to rule on.
  const inherited = stampsFileLineCount(job.stampsOut);
  if (inherited === STAMPS_FILE_UNREADABLE) {
    return {
      code: EXIT.CANNOT_START,
      stampedCount: 0,
      messages: [
        labelled(
          job,
          `THE STAMPS FILE IS PRESENT AND COULD NOT BE READ: ${job.stampsOut}. This ` +
            `is NOT the finding that it is absent — this process could not look, and ` +
            `it is the file this job must append to.`
        ),
        labelled(
          job,
          `Nothing was submitted. Refused HERE rather than at the append, because ` +
            `discovering it after the clerk had accepted the batch leaves orphan ` +
            `receipts at the clerk and nothing local to show for them.`
        ),
      ],
    };
  }
  if (cursor.state === "ABSENT" && inherited > 0) {
    return {
      code: EXIT.CANNOT_START,
      stampedCount: 0,
      messages: [
        labelled(
          job,
          `THE CURSOR IS ABSENT BUT ${String(inherited)} STAMP(S) ARE ALREADY IN ` +
            `${job.stampsOut}. An absent cursor means this job has stamped nothing, ` +
            `so those stamps came from another carry — a retired chain, or another ` +
            `journal. Sequence numbers restart at a rotation, so an inherited stamp ` +
            `does not fail F3's join, it SUCCEEDS on the wrong record.`
        ),
        labelled(
          job,
          `Nothing was submitted. Point --stamps-out at a NEW file for this chain ` +
            `(the retired chain's stamps stay where they are, as its own record), ` +
            `or restore the cursor that belongs to these stamps.`
        ),
      ],
    };
  }

  // ── T8 · THE CHAIN-AWARE READ, ON THE CHAINED JOB ONLY ────────────────────
  //
  // The arbiter's ruling, 2026-09-29: "the job-2 arm reads the subject log chain-aware
  // and REFUSES a log with no boundary at position 0."
  //
  // WHAT IS READ HERE AND WHAT IS NOT. This read obtains ONE value — the
  // position-0 boundary record's own `hash`, which is the chain identity every
  // stamp of this job will carry — and it VERIFIES the chain to get it. The
  // record iteration below still goes through `MicaLogFile`, unchanged, so the
  // cursor arithmetic, the submission and every message this job produces are
  // byte-identical to before T8 except for the one new field on each stamp.
  //
  // ⚠ IT IS TWO READS OF ONE FILE, AND THE WINDOW BETWEEN THEM IS NAMED RATHER
  // THAN PRETENDED SHUT. A record APPENDED between the two reads is simply not
  // stamped this run — it becomes tail, which is the same thing that happens to
  // a record appended a millisecond later, and the boundary hash does not move
  // on append. The window that would matter is a ROTATION between the two
  // reads, which would change the boundary under us; the inherited-stamps
  // refusal above already stops a run whose cursor and stamps disagree, and a
  // rotation mid-run is not survivable by any reader that takes more than one
  // syscall.
  //
  // ⛔ THE IDENTITY IS READ FROM THE CHAIN, NEVER RECOMPUTED. T8's Codex
  // acceptance asks for exactly this. Recomputing a boundary hash here would
  // mean this program deciding what the chain's identity IS, which is the
  // record's job and not the carrier's — and a recomputation that drifted from
  // the stored value would stamp every record with an identity F3 refuses,
  // while looking correct in this file.
  let chainIdentity: string | null = null;
  if (job.chained) {
    const chain = new SubjectChainLog({ path: job.log });
    const chainState = chain.getLoadState();
    // An ABSENT or EMPTY chained log is "nothing to do", exactly as the
    // unchained arm below treats an absent log — not a refusal. A job that has
    // never been written to has no boundary to refuse over.
    //
    // ⚠ THE NAMES ARE THIS READER'S OWN, NOT MicaLogFile's, and they do not
    // match: the chain reader says SUBJECT_CHAIN_ABSENT / SUBJECT_CHAIN_EMPTY
    // where the plain reader says FILE_ABSENT / FILE_EMPTY_OR_ERASED. Writing
    // the plain reader's names here compiled to a comparison that could never
    // be true (caught by tsc, not by a test), and would have made an absent
    // subject log a REFUSAL instead of a no-op.
    //
    // ⛔ SUBJECT_CHAIN_UNREADABLE IS DELIBERATELY NOT IN THIS LIST. "This
    // process could not look" is not "the file is not there", and treating it
    // as nothing-to-do would be the fail-open this whole ticket is about.
    if (chainState !== "SUBJECT_CHAIN_ABSENT" && chainState !== "SUBJECT_CHAIN_EMPTY") {
      const boundary = chain.getBoundary();
      if (chainState !== LOADED_SUBJECT_CHAIN_VERIFIED || boundary === null) {
        return {
          code: EXIT.CANNOT_START,
          stampedCount: 0,
          messages: [
            labelled(
              job,
              `THIS JOB IS DECLARED TO CARRY A HASH-CHAINED SUBJECT LOG AND THIS FILE IS NOT ` +
                `ONE IT CAN READ: ${chain.describe()}` +
                (boundary === null
                  ? ` There is no SUBJECT_LOG_BOUNDARY record at position 0, so the chain has ` +
                    `never said where it began and has no identity for a stamp to name.`
                  : ``)
            ),
            labelled(
              job,
              `Nothing was submitted and the cursor is unmoved. T8 requires every stamp to name ` +
                `its chain, and a stamp naming no chain is REFUSED by F3 — so carrying this log ` +
                `would produce stamps that cannot be read, which is worse than not carrying it. ` +
                `Point --second-log at the chained subject log, or repair the chain.`
            ),
          ],
        };
      }
      chainIdentity = boundary.hash;
    }
  }

  const log = new MicaLogFile({ path: job.log });
  const loadState = log.getLoadState();
  if (loadState === "FILE_ABSENT" || loadState === "FILE_EMPTY_OR_ERASED") {
    return {
      code: EXIT.OK,
      stampedCount: 0,
      messages: [labelled(job, `nothing to do — ${log.describe()}`)],
    };
  }
  if (loadState !== LOADED_UNVERIFIED_FILE) {
    return {
      code: EXIT.CANNOT_START,
      stampedCount: 0,
      messages: [
        labelled(job, `THE MICA LOG COULD NOT BE READ CLEANLY: ${log.describe()}`),
        labelled(job, `Nothing was submitted.`),
      ],
    };
  }
  const verify = log.verify();
  if (!verify.valid) {
    return {
      code: EXIT.CANNOT_START,
      stampedCount: 0,
      messages: [
        labelled(job, `THE MICA LOG DOES NOT VERIFY (parse+order): brokenAt=${String(verify.brokenAt)}`),
        labelled(
          job,
          `Nothing was submitted — this arm will not stamp a log it cannot trust the order of.`
        ),
      ],
    };
  }

  // PER WRITER (S127-8). A moduleId with no cursor entry has had nothing
  // stamped, so everything it wrote is in scope.
  //
  // AND NO `.sort()`. The old one sorted the batch by sequenceNumber, which
  // was identical to file order while there was one writer and is WRONG with
  // three: it would interleave writers by a number that does not compare
  // across them. File order is the only cross-writer order this log claims
  // (mica-log-file.ts, S127-6), and `verify()` has already established that
  // each writer's own sequence ascends within it — so file order IS strict
  // order, per writer, and the header's "submitted ONE AT A TIME in that
  // order" is now true of the code as well as of the sentence.
  // ── THE POSITION-0 BOUNDARY RECORD IS STAMPED, AND THAT IS A DECISION ──────
  //
  //   Act A put a `SUBJECT_LOG_BOUNDARY` at position 0 of every chain. It is a
  //   valid `MicaLogRecord` with module `MICA/SubjectLog` and a real timestamp
  //   (the rotation instant), so the filter below selects it like any other.
  //   THAT IS DELIBERATE AND IT IS NOT AN OVERSIGHT — stated here because a
  //   policy that is only the absence of an exclusion reads as one.
  //
  //   WHY IT IS STAMPED, and the reasons are in order of weight:
  //
  //     1. A clerk receipt for the rotation instant is INDEPENDENT CORROBORATION
  //        OF THE ONE EVENT ACT A EXISTS TO RECORD. The boundary says "this
  //        chain replaced that file"; a second principal's arrival stamp says
  //        when that claim reached it. Excluding it would drop custody evidence
  //        exactly where custody is the subject.
  //     2. EXCLUDING IT WOULD COUPLE THIS ARM TO THE JOURNAL'S GRAMMAR. A
  //        record-type test here means a new subject-event kind changes what the
  //        clerk carries, silently, from another file. That coupling is the
  //        defect this deployment keeps paying for (`since = 211`, route #10).
  //     3. IT CANNOT CONTAMINATE A SUBJECT PAIR. F3 joins on
  //        (moduleId, sequenceNumber); the boundary's stamp carries
  //        `MICA/SubjectLog` and can therefore only ever join the boundary
  //        record. Before that join key existed this reason did not hold, which
  //        is why the two changes belong in one commit.
  //
  //   ⚠ WHAT IT COSTS: F3 gains one pair per chain whose meaning differs from
  //   the rest — the bridge's own write, not the subject's. It is one pair in a
  //   leg that reports its own coverage, and it is named here so a reading that
  //   turns on it can be recognised rather than discovered.
  const toStamp = log.getAll().filter((r) => {
    const last = cursor.lastStamped.get(r.moduleId);
    return last === undefined || r.sequenceNumber > last;
  });

  if (toStamp.length === 0) {
    return {
      code: EXIT.OK,
      stampedCount: 0,
      messages: [
        labelled(
          job,
          `nothing to do — cursor at ${describeCursor(cursor.lastStamped)}, log holds nothing newer`
        ),
      ],
    };
  }

  // THE RUN'S identity, not this job's: loaded once, refusal memoised. The
  // messages are the ones this arm has always printed, because they are the
  // run's facts and a label on them would claim the job caused them.
  const identity = await getSubmitter();
  if (!identity.ok) {
    return { code: identity.code, stampedCount: 0, messages: identity.messages };
  }
  const submitter = identity.submitter;

  // STRICT ORDER, ONE AT A TIME. On the FIRST failure, stop: nothing from this
  // run's batch has been written yet (the append below is a single write,
  // after the loop), and the cursor has not moved — the next scheduled run
  // re-attempts every record this run touched, submitted or not.
  const stamps: ClerkClockStamp[] = [];
  for (const record of toStamp) {
    let receipt: Awaited<ReturnType<SignedSubmitter["submit"]>>;
    try {
      receipt = await submitter.submit(job.channel, record, record.timestamp);
    } catch (err) {
      return {
        code: EXIT.SUBMIT_FAILED,
        stampedCount: 0,
        messages: [
          labelled(
            job,
            `THE CLERK REFUSED OR COULD NOT BE REACHED at local seq ` +
              `${String((record as MicaLogRecord).sequenceNumber)}: ${String(err)}`
          ),
          labelled(
            job,
            `NOTHING FROM THIS RUN WAS WRITTEN. The cursor is unmoved at ` +
              `${describeCursor(cursor.lastStamped)}; the next run re-attempts from there.`
          ),
        ],
      };
    }
    stamps.push({
      // S134 Ra · THE WRITER, BESIDE THE NUMBER. S127-8 repaired the CURSOR to
      // be per-writer and stopped there, so the file it writes could not say
      // whose record it stamped: on the box the arbiter's seven sat beside the
      // registrar's with nothing to tell them apart. The record already knows.
      moduleId: record.moduleId,
      // T8 · WHICH CHAIN THIS RECORD BELONGS TO. Present only on the chained
      // job; job 1's log has no boundary and therefore no identity to name.
      // Read from the chain above, never recomputed.
      ...(chainIdentity === null ? {} : { chainIdentity }),
      sequenceNumber: record.sequenceNumber,
      clerk_seq: receipt.clerk_seq,
      clerk_time: receipt.clerk_time,
      separation: receipt.separation,
      intake: receipt.intake,
      clerk_id: receipt.clerk_id,
      clerk_boot_id: receipt.clerk_boot_id,
    });
  }

  // Append BEFORE advancing the cursor (S109 arm-recon receipt §2). One write
  // for the whole batch: the window this leaves open is named in the header
  // above and is not pretended shut.
  const lines = stamps.map((s) => JSON.stringify(s)).join("\n") + "\n";
  try {
    appendFileSync(job.stampsOut, lines, "utf8");
  } catch (err) {
    return {
      code: EXIT.SUBMIT_FAILED,
      stampedCount: 0,
      messages: [
        labelled(
          job,
          `${String(stamps.length)} record(s) were ACCEPTED BY THE CLERK but the stamps ` +
            `file could not be written: ${String(err)}`
        ),
        labelled(
          job,
          `THE CURSOR IS UNMOVED. These are now orphan receipts at the clerk — see ` +
            `the module header. Fix the write path and re-run; the same records will ` +
            `be resubmitted and re-stamped, and the clerk will hold two receipts for them.`
        ),
      ],
    };
  }

  // PER WRITER, and entries for writers this batch did not touch are CARRIED
  // FORWARD unchanged — a run that stamps nothing for a writer must not erase
  // what that writer had already had stamped. This is also the ONLY path by
  // which a legacy cursor file is rewritten in the new shape: a run that got
  // this far succeeded.
  const newCursor = new Map(cursor.lastStamped);
  for (const record of toStamp) {
    const previous = newCursor.get(record.moduleId);
    newCursor.set(
      record.moduleId,
      previous === undefined ? record.sequenceNumber : Math.max(previous, record.sequenceNumber)
    );
  }
  writeCursor(job.cursor, newCursor);

  return {
    code: EXIT.OK,
    stampedCount: stamps.length,
    messages: [
      labelled(
        job,
        `${stamps.length} record(s) stamped; cursor advanced to ${describeCursor(newCursor)}` +
          (cursor.legacy ? ` (migrated from the pre-S127-8 single-integer shape)` : ``)
      ),
    ],
  };
}

/**
 * ONE RUN: every declared job, in order, under one submitter identity.
 *
 * WITH NO SECOND TRIPLE THIS IS THE OLD FUNCTION. One job, empty label, the
 * same messages, the same code, the same `stampedCount` — and the same number
 * of clerk handshakes, because the identity is still established lazily on the
 * first job that has work. A test asserts the bytes rather than the intent.
 *
 * WITH TWO, EVERY JOB RUNS. Job 1 failing does not skip job 2; see the module
 * header for the S127-6 scar that rule is carrying.
 */
export async function runOnce(
  args: Args,
  client: ClerkClient
): Promise<RunResult> {
  // ⛔ MALFORMED FIRST. A bad command line is refused BEFORE "what is missing",
  // because a swallowed value makes the missing-flag list name the WRONG flag.
  if (args.malformed.length > 0) {
    return {
      code: EXIT.CANNOT_START,
      stampedCount: 0,
      messages: [
        `mica-clerk-caller REFUSES this command line and opened nothing: ` +
          args.malformed.join(" · "),
      ],
    };
  }
  const missing = missingRequired(args);
  if (missing.length > 0) {
    return {
      code: EXIT.CANNOT_START,
      stampedCount: 0,
      messages: [
        `mica-clerk-caller has NO DEFAULT PATHS. Not supplied: ${missing.join(", ")}. ` +
          `Every path this program touches is a deployment decision and none of ` +
          `them is guessed here.`,
      ],
    };
  }

  // ACT B. Checked BEFORE any job runs and before the clerk is touched: a
  // half-declared second journal is a wiring error, and discovering it after
  // the first journal had already been stamped would make the refusal depend
  // on how much work happened to come first.
  const partial = secondTripleProblem(args);
  if (partial !== null) {
    return { code: EXIT.CANNOT_START, stampedCount: 0, messages: [partial] };
  }

  const getSubmitter = submitterOnce(args, client);
  let code: (typeof EXIT)[keyof typeof EXIT] = EXIT.OK;
  const messages: string[] = [];
  let stampedCount = 0;
  for (const job of carryJobs(args)) {
    const result = await runJob(job, getSubmitter);
    code = worse(code, result.code);
    messages.push(...result.messages);
    stampedCount += result.stampedCount;
  }
  return { code, messages, stampedCount };
}

async function main(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  // ⛔ MALFORMED FIRST. A bad command line is refused BEFORE "what is missing",
  // because a swallowed value makes the missing-flag list name the WRONG flag.
  if (args.malformed.length > 0) {
    for (const m of args.malformed) console.error(`mica-clerk-caller: ${m}`);
    process.exit(EXIT.CANNOT_START);
    return;
  }
  const missing = missingRequired(args);
  if (missing.length > 0) {
    console.error(`mica-clerk-caller: not supplied: ${missing.join(", ")}`);
    process.exit(EXIT.CANNOT_START);
    return;
  }
  // The two ends of one connection resolve a missing override identically —
  // see resolveClerkSocketPath. `SocketClerkClient`'s own connection-failure
  // message already carries `this.socketPath` (src/clerk/client.ts:141-147),
  // so constructing it with the RESOLVED path — rather than letting
  // `forStore` re-derive it internally — is what makes a fail-loud message
  // name the actual socket this run tried, explicit override or derived.
  const client = new SocketClerkClient(resolveClerkSocketPath(args));
  try {
    const result = await runOnce(args, client);
    const stream = result.code === EXIT.OK ? console.log : console.error;
    for (const m of result.messages) stream(m);
    process.exit(result.code);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  void main(process.argv.slice(2));
}
