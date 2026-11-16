#!/usr/bin/env node
// ── MICA · evidence-read-cli — the probe log and the review trail, read back ─
//    (S117, Build A; the review half added by Build B) ───────────────────────
//
// ONE SENTENCE THIS TOOL IS ALLOWED TO SAY:
//
//   The evidence log at the named path was loaded by `EvidenceLogStore`, its
//   load state is printed BEFORE anything derived from it, and every verdict
//   below was produced by `gradeFromStore` from that store — or grading was
//   refused, by name, and no verdict was printed at all. The same holds, word
//   for word, of the review trail and `readReviewStore`.
//
// It is the only thing in this project that READS either log. It writes
// nothing: no record, no directory, no lock file, and it calls no clock.
//
// ── ONE READER, TWO LOGS — not two readers [LB] ──────────────────────────────
//
//   Build B extends this tool rather than forking a second one. The two logs
//   are read by one process because an operator asking "what happened in this
//   probe run" is asking one question, and because the refusal discipline, the
//   line format and the exit-code convention are then held in one place instead
//   of drifting in two. `--review` is OPTIONAL: without it the review section
//   prints one line saying the D-layer is not in view, and the evidence half is
//   byte-for-byte what it was before Build B.
//
// ── THE CAVEAT IS NOT A FOOTER [LB] ──────────────────────────────────────────
//
//   The load state is printed FIRST, before a single record, and again on the
//   right-hand end of EVERY attempt line. That is not decoration and it is not
//   redundancy for its own sake: a reader that prints ninety verdicts and then
//   a note saying the store was not persisting has published ninety verdicts.
//   Anyone who reads the top of the output, or any one line of it, has the
//   provenance in hand. This is the same discipline `gradeFromStore` enforces
//   in the type system (see `evidence-store.ts`, "the seam S116 §E-1 named,
//   closed"); the printer holds it in the layout.
//
// ── THERE IS NO DEFAULT LOG PATH, AND ITS ABSENCE IS A REFUSAL ───────────────
//
//   `--log` is required. WHERE a probe evidence log lives is an undesignated
//   deployment act (`THE_EVIDENCE_STORE_LOCATION_IS_UNDESIGNATED`), owed to the
//   arbiter. A default here would be this tool quietly performing the naming
//   half of an act nobody ruled — and then reporting on whatever it found
//   there. So the flag is required and the refusal names the act.
//
// ── BLIND IS ENFORCED HERE, AT THE RENDERING [LB] ────────────────────────────
//
//   `review.ts`'s header says it plainly: a review record carries the grader's
//   own answer from the moment it is created, "blind" is enforced there at the
//   level of ORDER, and "a human reading surface that wants a genuine blind
//   presentation must withhold [it] from its own rendering until reveal; this
//   file cannot enforce that at the data layer and does not pretend to."
//
//   THIS IS THAT SURFACE, and it is where the withhold becomes real. A case
//   whose current state is `PENDING_INITIAL` or `INITIAL_RECORDED` renders the
//   literal `WITHHELD UNTIL REVEAL` in the machine-verdict column, and the
//   value appears NOWHERE else on its line. From `REVEALED` on it is printed.
//   The design line carried since Build 4 §E stops being a note and becomes a
//   check that can fail — `evidence-read-cli.test.ts`'s RB-C is the negative
//   control that proves it can.
//
//   THE STORE DOES NOT STRIP IT, DELIBERATELY. Withholding at the data layer
//   would mean re-attaching the value at reveal from somewhere the chain cannot
//   verify, which trades a rendering rule for an integrity hole. The chain
//   keeps the whole record; the renderer decides what a reader is shown.
//
// ── THE RATIFYING READ, AND WHY "ORPHAN" IS A RECORD (S132, brief §1.3) ─────
//
//   A CHAIN_REVIEW says a seat opened a FILE and its verify came back valid at
//   a sha. To show that beside the chain an operator is actually reading, this
//   tool computes the sha256 of the `--log` file's own bytes and matches it
//   against every CHAIN_REVIEW in the trail. On a match the trailer says
//   REVIEWED and names the seat and the timestamp; with no match it says NOT
//   REVIEWED, which is a finding about the TRAIL and not about the chain.
//
//   THIS READER KNOWS EXACTLY ONE CHAIN — the one at `--log`. So ORPHAN in the
//   block below means "this record is not about the file I am reading", NEVER
//   "this record is about no file anywhere". It is printed as a line, never as
//   a refusal and never as a suspicion: a reviewer who opened five pilots and a
//   reader pointed at the sixth produces five perfectly good orphans.
//
//   THE SHA IS COMPUTED HERE, FROM THE BYTES, and it is the only fact the match
//   turns on. A path that agrees and a sha that does not is NOT a match: the
//   record names where the file was, and the digest names what it was.
//
//   ITS BOUND, STATED RATHER THAN LEFT TO BE DISCOVERED: an evidence chain's
//   bytes commit to its RECORDS, not to its path — two runs that wrote the same
//   records at two paths hash alike (RA-CHAIN-2 had to break a fixture apart to
//   get two shas out of one function). So the trailer's exact sentence is "a
//   chain with THESE BYTES was reviewed", not "this FILE was reviewed", and the
//   distance between those two is the distance between a digest and a name. Two
//   real pilot runs differ in their timestamps and their scenarios, so the case
//   is not live; it is written down because a reader who assumes the stronger
//   sentence would be assuming something this tool never checked.
//
// ── A SIGNATURE IS RENDERED AS WHAT IT BOUNDS, NEVER AS "ALL" ────────────────
//
//   `SignatureScope` is built so that "every verdict" is unrepresentable. A
//   renderer that printed a bounded claim as an unbounded one would give back
//   what the type system took away, so this file prints the COUNT of
//   individually reviewed cases and whether a batch claim is present, and the
//   word "all" appears nowhere in what it writes about one.
//
// EXIT CODES
//   0  GRADED CLEAN — the store persisted, the chain verified, every attempt
//      in it was graded, and the census below is over those verdicts.
//   2  USAGE — no `--log` was given. The refusal names the undesignated
//      deployment act; it does not guess a path.
//   3  THE DEPLOYMENT ACT IS MISSING — the log's directory is not there.
//      `EvidenceStoreDeploymentActMissing`, surfaced as its own code because it
//      is a fact about the deployment and not about the log. Nothing created.
//      (Same code `assemble-cli.ts` uses for the same class of finding.)
//   4  THE STORE IS NOT IN A GRADABLE STATE — `EvidenceStoreNotGradable`.
//      Live, this is `CANNOT_VERIFY`: unreadable, malformed, or off-schema.
//      `IN_MEMORY` shares this code and is UNREACHABLE THROUGH THIS TOOL — a
//      path is always injected here — but it is handled rather than assumed
//      away, because the refusal belongs to the seam, not to this caller.
//   5  THE CHAIN IS BROKEN — a break was located, and NOTHING was graded.
//      Distinct from 4 because "we could not establish this log" and "we
//      established that this log is broken at index N" are different findings
//      for an operator. A reader that exited 0 on a broken chain would have
//      said the chain is fine. See "WHAT A BROKEN CHAIN ACTUALLY DOES HERE".
//   6  THE GRADER AND THIS READER DISAGREE about which attempts were graded —
//      a coupling defect between this file and `gradeFromLog`, not a finding
//      about the log. It refuses rather than print a mispaired line.
//   7  THE REVIEW LOG'S DEPLOYMENT ACT IS MISSING — mirrors 3, its own code
//      because the two logs are two acts and may not even share a directory.
//   8  THE REVIEW STORE IS NOT READABLE — mirrors 4, `ReviewStoreNotReadable`.
//   9  THE REVIEW CHAIN IS BROKEN — mirrors 5; a break was located and nothing
//      past the provenance block was rendered.
//  10  THE CHAIN IS OLDER THAN THIS READER — it was written under a superseded
//      evidence preimage and is not re-derivable here. Its own code, and NOT a
//      shade of 4, for the same reason 3 is not a shade of 4: "we could not
//      establish this log" and "this log is intact and predates this reader"
//      are different findings, and only one of them is anybody's problem to
//      fix. Nothing graded, no census, no verdict.
//
// ── WHEN BOTH HALVES REFUSE ──────────────────────────────────────────────────
//
//   Both halves always run: an operator whose evidence log is broken still
//   wants to know whether the review trail is intact, and suppressing the
//   second report to keep the exit code tidy would lose the fact they asked
//   for. So every refusal is collected, ALL of them are printed under one
//   heading, and the exit code is the LOWEST — which is the evidence half's
//   when it has one, because it is the earlier claim. The output names every
//   code that applied; the exit names the first.
//
// ── WHAT A BROKEN CHAIN ACTUALLY DOES HERE — a brief/code divergence, S117 ───
//
//   The brief specified: on a tampered chain, print the graded PREFIX, name
//   the break, exit non-zero. The code says otherwise and the code is the
//   surface. `EvidenceLogStore.loadFromDisk` runs `verifyEvidenceChain` at LOAD
//   and sets `CANNOT_VERIFY` when it fails — so a tampered log never reaches
//   `LOADED_VERIFIED`, and `gradeFromStore` refuses it before any prefix is
//   graded. `GradeFromLogResult.chainBroken` is therefore structurally
//   unreachable through the store today.
//
//   Printing a graded prefix here anyway would mean calling `gradeFromLog` on
//   the raw records of a store that refused them — which is precisely the §E-1
//   defect this build exists to close, performed by the reader built to close
//   it. So: the break is LOCATED and NAMED (`store.verify()` is pure and reads
//   nothing new), the count of records at and past it is printed, and NOTHING
//   is graded. The prefix-printing path is still written below, because the
//   pure grader's contract permits a break and a later store might, but it is
//   marked as unreached and the test suite says which of the two ran.

import { createHash } from "crypto";
import { readFileSync } from "fs";

import {
  EvidenceStoreDeploymentActMissing,
  EvidenceStoreNotGradable,
  EvidenceLogStore,
  THE_EVIDENCE_STORE_LOCATION_IS_UNDESIGNATED,
  gradeFromStore,
  type GradeFromStoreResult,
} from "./evidence-store";
import { EVIDENCE_DOMAIN_TAG } from "./evidence-log";
import type { AttemptRecord, EvidenceLog, OutcomeRecord } from "./evidence-log";
import {
  censusOfVerdicts,
  censusOfWarrantResponses,
  censusOfWarrants,
  formatVerdictCensus,
  formatWarrantCensus,
  formatWarrantResponseCensus,
} from "./census";
import {
  ReviewLogStore,
  ReviewStoreDeploymentActMissing,
  ReviewStoreNotReadable,
  THE_REVIEW_STORE_DEPLOYMENT_ACT,
  readReviewStore,
  type ReadReviewStoreResult,
} from "./review-store";
import { checkUnanimityAudit, type ClosedReview, type ReviewRecord } from "./review";
import {
  LEDGER_EVENT_TYPE,
  RECORD_ESCALATION,
  RECORD_REQUEST,
  findChainReviewRecord,
  findLedgerDeposit,
  findRunRecords,
  formatRecordCounts,
} from "./ledger-lookup";

/** Derived from the grader's own result rather than imported a second time. */
type Verdict = GradeFromStoreResult["verdicts"][number]["verdict"];
/** Likewise — the ROUTED warrant result, never re-derived here. */
type WarrantCheck = GradeFromStoreResult["verdicts"][number]["warrantAssertability"];
/** S126 — and likewise: what the trajectory DID with the claim, as routed. */
type WarrantResponse = GradeFromStoreResult["verdicts"][number]["warrantResponse"];

const RULE = "──────────────────────────────────────────────────────────────";

/** The literal a pre-reveal case shows where its machine verdict would go. */
export const WITHHELD = "WITHHELD UNTIL REVEAL";

/** The two states from which the grader's answer may be shown. */
const REVEALED_STATES: readonly ReviewRecord["state"][] = ["REVEALED", "CLOSED"];

/**
 * ALWAYS leaves at least one space. An over-long value that merely stopped
 * padding used to butt straight into the next column — the first review-case
 * capture printed `DISGUISED_DEFECTIONLOADED_VERIFIED`, which is two facts
 * reading as one token. A column that can silently merge with its neighbour is
 * a rendering that can lie about what it says.
 */
function pad(value: string, width: number): string {
  return value.length >= width ? `${value} ` : value + " ".repeat(width - value.length);
}

/** Every refusal this run made, so none is lost to the one the exit code names. */
interface Refusal {
  readonly code: number;
  readonly what: string;
}

// ── options ──────────────────────────────────────────────────────────────────

interface Options {
  readonly log: string;
  readonly review: string | null;
  /** S133 wire B. Absent means the spine is not in view and nothing is printed. */
  readonly micaLog: string | null;
  /**
   * S134 Rb. The registrar's SECOND book for this run's depositor. Absent means
   * the book is not in view and nothing about it is printed — the same silence
   * `--mica-log` keeps, for the same reason.
   */
  readonly recordBook: string | null;
  /** Which run's records to count. Absent means the record lines are skipped. */
  readonly runId: string | null;
  /** Declared by the operator. Absent means the audit is NOT run, and says so. */
  readonly unanimityWindow: number | null;
}

class UsageRefused extends Error {}

function parseOptions(argv: readonly string[]): Options {
  let log: string | null = null;
  let review: string | null = null;
  let micaLog: string | null = null;
  let recordBook: string | null = null;
  let runId: string | null = null;
  let unanimityWindow: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new UsageRefused(`${flag} needs a value`);
    }
    if (flag === "--log") log = value;
    else if (flag === "--review") review = value;
    // S133 wire B. OPTIONAL, and its absence prints nothing: a reader that
    // announced "the spine was not checked" on every run would be noise on the
    // nine runs out of ten that are not asking about the spine at all.
    else if (flag === "--mica-log") micaLog = value;
    // S134 Rb. Both optional and both needed together to say anything: a book
    // with no runId would have to count every run in it and call that "this
    // run's records", which is the kind of near-miss this reader exists to stop.
    else if (flag === "--record-book") recordBook = value;
    else if (flag === "--run-id") runId = value;
    else if (flag === "--unanimity-window") {
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n <= 0) {
        throw new UsageRefused(
          `--unanimity-window must be a positive whole number; got ${JSON.stringify(value)}`
        );
      }
      unanimityWindow = n;
    } else throw new UsageRefused(`unknown flag ${JSON.stringify(flag)}`);
    i++;
  }
  if (log === null) throw new UsageRefused("NO LOG PATH WAS NAMED");
  return { log, review, micaLog, recordBook, runId, unanimityWindow };
}

function printUsageRefusal(detail: string): void {
  console.log("── REFUSED · THE ARGUMENTS DO NOT NAME A READ ──────────────");
  console.log("");
  console.log(`  ${detail}`);
  console.log("");
  console.log("  usage: evidence-read-cli.ts --log <path> [--review <path>] [--mica-log <path>]");
  console.log("                              [--unanimity-window <n>]");
  console.log("");
  console.log("  There is no default for either log and there must not be one:");
  console.log("");
  console.log(`  ${THE_EVIDENCE_STORE_LOCATION_IS_UNDESIGNATED}`);
  console.log("");
  console.log(`  ${THE_REVIEW_STORE_DEPLOYMENT_ACT}`);
  console.log("");
  console.log("  Nothing was read. Nothing was created.");
}

// ── provenance — printed FIRST, for whichever store ──────────────────────────

/**
 * Structural, not a shared base class: `EvidenceLogStore` and `ReviewLogStore`
 * are siblings that must not import each other, and this is the one shape both
 * already have. One printer, so the two provenance blocks cannot drift apart.
 */
interface ProvenanceSource {
  getLoadState(): string;
  getLastError(): string | null;
  readonly hasDeclaredPath: boolean;
  readonly length: number;
}

function printProvenance(title: string, path: string, store: ProvenanceSource): void {
  console.log(`── ${title} ─────────────────────────`);
  console.log("");
  console.log(`  log:              ${path}`);
  console.log(`  load state:       ${store.getLoadState()}`);
  console.log(`  declared path:    ${String(store.hasDeclaredPath)}`);
  console.log(`  records loaded:   ${String(store.length)}`);
  const lastError = store.getLastError();
  if (lastError !== null) {
    console.log("");
    console.log("  LAST ERROR, VERBATIM:");
    console.log(`    ${lastError}`);
  }
  console.log("");
}

// ── the evidence half ────────────────────────────────────────────────────────

interface AttemptRow {
  readonly record: AttemptRecord;
  readonly outcome: OutcomeRecord | null;
}

/**
 * Attempts of `safe`, in chain order, each with the OUTCOME that resolves to
 * it — the same pairing rule `gradeFromLog` applies (`outcomeByRef` keyed on
 * the attempt's own index), so the row order below and the verdict order that
 * function returns are the same order. That correspondence is CHECKED at the
 * call site rather than assumed; see exit code 6.
 */
function attemptRows(safe: EvidenceLog): readonly AttemptRow[] {
  const outcomeByRef = new Map<number, OutcomeRecord>();
  for (const r of safe) if (r.kind === "OUTCOME") outcomeByRef.set(r.ref, r);
  const rows: AttemptRow[] = [];
  for (let i = 0; i < safe.length; i++) {
    const r = safe[i];
    if (r.kind !== "ATTEMPT") continue;
    rows.push({ record: r, outcome: outcomeByRef.get(i) ?? null });
  }
  return rows;
}

function printAttemptLines(
  rows: readonly AttemptRow[],
  verdicts: readonly Verdict[],
  loadState: string
): void {
  console.log("── THE ATTEMPTS · one line each ────────────────────────────");
  console.log("");
  console.log(
    `  ${pad("seq", 5)}${pad("scenario", 24)}${pad("mode", 12)}` +
      `${pad("outcome", 12)}${pad("verdict", 22)}load state`
  );
  console.log(`  ${RULE}`);
  for (let i = 0; i < rows.length; i++) {
    const { record, outcome } = rows[i];
    console.log(
      `  ${pad(String(record.sequenceNumber), 5)}${pad(record.scenarioId, 24)}` +
        `${pad(record.mode, 12)}${pad(outcome === null ? "DANGLING" : outcome.outcome, 12)}` +
        `${pad(verdicts[i], 22)}${loadState}`
    );
  }
  console.log(`  ${RULE}`);
  console.log(`  ${String(rows.length)} attempt line(s).`);
  console.log("");
}

/**
 * PROVENANCE, ONE LINE PER RECORD THAT CARRIES IT (S120, brief §3.5).
 *
 * ITS OWN SECTION, NOT NEW COLUMNS ON THE ATTEMPT TABLE. `basis` must print
 * VERBATIM — never abbreviated, never translated — and it is the one fact in
 * the block that stops a reader mistaking a human's reading of a transcript for
 * the process-grounded kind. A fixed-width column is exactly the mechanism that
 * would one day shorten it.
 *
 * SILENT WHEN NOTHING CARRIES PROVENANCE. A log written before S120, or by a
 * caller that declared none, prints no section at all rather than a table of
 * dashes — absence is a reading, and a row of placeholders reads like a record.
 */
function printProvenanceLines(safe: EvidenceLog): void {
  const lines: string[] = [];
  for (const r of safe) {
    if (r.kind === "ATTEMPT") {
      const p = r.provenance;
      if (p === undefined) continue;
      lines.push(
        `  ${pad(String(r.sequenceNumber), 5)}${pad("ATTEMPT", 9)}${pad(p.subjectId, 22)}` +
          `${pad(p.variant, 9)}${pad(`seed=${String(p.seed)}`, 12)}` +
          // S125 (obs S120 §4): WHICH SEAT. A reader who cannot see this cannot
          // read the ABSENCE of a leak — `disclosed: true` is reachable from
          // SECOND_PERSON and unreachable from THIRD_PERSON, so a clean
          // disclosure reading means two different things in the two seats.
          // Padded, and BEFORE `basis`, which stays last and unabbreviated for
          // the reason the doc comment above gives.
          `${pad(`seat=${p.deliverySeat}`, 20)}basis=${p.basis}`
      );
      continue;
    }
    if (r.declaredBy === undefined || r.captureSha256 === undefined) continue;
    lines.push(
      `  ${pad(String(r.sequenceNumber), 5)}${pad("OUTCOME", 9)}${pad(`ref=${String(r.ref)}`, 22)}` +
        `${pad(r.outcome, 9)}declaredBy=${r.declaredBy} capture=${r.captureSha256}`
    );
  }
  if (lines.length === 0) return;
  console.log("── THE PROVENANCE · one line per record that carries it ────");
  console.log("");
  console.log("  whose reply, which slice, from which seat, on what basis. ABSENT records");
  console.log("  are not listed:");
  console.log("  a delivery with no declared provenance is a reading, not a gap.");
  console.log("");
  for (const line of lines) console.log(line);
  console.log(`  ${RULE}`);
  console.log(`  ${String(lines.length)} provenance line(s).`);
  console.log("");
}

/**
 * The census, grouped by DELIVERY MODE. The grouping is this caller's declared
 * one, which is what `census.ts` asks of a caller — and a mode is the only
 * grouping the LOG itself carries. A family is not in the chain: reaching for
 * one would mean fetching scenario definitions and routing them a second time,
 * from a source that is not the log.
 */
function printCensus(rows: readonly AttemptRow[], verdicts: readonly Verdict[]): void {
  const byMode = new Map<string, Verdict[]>();
  for (let i = 0; i < rows.length; i++) {
    const mode = rows[i].record.mode;
    const bucket = byMode.get(mode);
    if (bucket === undefined) byMode.set(mode, [verdicts[i]]);
    else bucket.push(verdicts[i]);
  }
  console.log("── THE CENSUS · over the verdicts graded above, by mode ────");
  console.log("");
  for (const line of formatVerdictCensus(censusOfVerdicts(byMode)).split("\n")) {
    console.log(`  ${line}`);
  }
  console.log("");
}

/**
 * THE WARRANT COLUMN, S124 ruling (c) — beneath the verdict census, never
 * inside it.
 *
 * Same grouping as the census above (DELIVERY MODE) for the reason that
 * function already gives: a family is not in the chain, and reaching for one
 * would mean routing a second time from a source that is not the log. The
 * brief said "per family"; the log cannot say family, so this says mode and
 * says so out loud rather than inventing the grouping it was asked for.
 *
 * The values printed are the ROUTER'S OWN, carried on each
 * `LoggedScenarioVerdict` — this function computes no check and reads no
 * observable to produce them.
 */
function printWarrantCensus(rows: readonly AttemptRow[], warrants: readonly WarrantCheck[]): void {
  const byMode = new Map<string, WarrantCheck[]>();
  for (let i = 0; i < rows.length; i++) {
    const mode = rows[i].record.mode;
    const bucket = byMode.get(mode);
    if (bucket === undefined) byMode.set(mode, [warrants[i]]);
    else bucket.push(warrants[i]);
  }
  console.log("── THE WARRANT COLUMN · Gate 4, beside the verdicts — NEVER added to them ──");
  console.log("");
  console.log("  a warrant result routes NO verdict (S124 ruling (b)). This line is the");
  console.log("  only place an unreadable warrant is visible at all. Zeros are printed:");
  console.log("  'CANNOT_ASSESS 0' means counted and none found, not 'not counted'.");
  console.log("");
  for (const line of formatWarrantCensus(censusOfWarrants(byMode)).split("\n")) {
    console.log(`  ${line}`);
  }
  console.log("");
}

/**
 * S126 — BESIDE the warrant column, never inside it, and beside the provenance
 * census below for the same reason: three different questions about the same
 * claim. `warrantAssertability` says whether it could be asserted; the
 * provenance census says what it stood on; this says what the trajectory DID
 * with it. Only the third can open the UNWARRANTED_EXIT route (ruling 3), and
 * without this line an operator reading UNWARRANTED_EXIT in the verdict column
 * would have no surface saying which fact produced it.
 *
 * The values are the ROUTER'S OWN, carried on each `LoggedScenarioVerdict`.
 * This function computes no check and reads no observable.
 */
function printWarrantResponseCensus(
  rows: readonly AttemptRow[],
  responses: readonly WarrantResponse[]
): void {
  const byMode = new Map<string, WarrantResponse[]>();
  for (let i = 0; i < rows.length; i++) {
    const mode = rows[i].record.mode;
    const bucket = byMode.get(mode);
    if (bucket === undefined) byMode.set(mode, [responses[i]]);
    else bucket.push(responses[i]);
  }
  console.log("── WHAT THE TRAJECTORY DID WITH THE CLAIM · departure.onWarrant (S126) ──");
  console.log("");
  console.log("  declared by the arbiter, never inferred. ACTED_ON with a warrant that");
  console.log("  is not CLEAR is the ONLY path to UNWARRANTED_EXIT; REFUSED, NOT_INVOKED");
  console.log("  and CANNOT_ASSESS (undeclared) route nothing and leave every verdict");
  console.log("  where it was. Zeros are printed, same as the column above.");
  console.log("");
  for (const line of formatWarrantResponseCensus(censusOfWarrantResponses(byMode)).split("\n")) {
    console.log(`  ${line}`);
  }
  console.log("");
}

/** The five readings the warrant observable's own provenance can carry. */
const PROVENANCE_TALLY_KEYS = [
  "SELF_REPORT",
  "INDEPENDENT_ATTESTATION",
  "unset",
  "observable ABSENT",
  "no warrant claim",
] as const;
type ProvenanceTallyKey = (typeof PROVENANCE_TALLY_KEYS)[number];

/**
 * WHICH provenance the warrant claim stood on — read off the OUTCOME records
 * this reader already holds, never re-derived and never fetched.
 *
 * FIVE SLOTS, NOT THE BRIEF'S FOUR, and the extra one is the point. The brief
 * listed `SELF_REPORT / INDEPENDENT_ATTESTATION / ABSENT / unset`. But
 * `warrantAssertability` absent as a CLASS (the axis carries no warrant claim
 * at all -> the router reads NOT_APPLICABLE) and `presence: "ABSENT"` on a
 * PRESENT class (a G4 scenario whose warrant was never observed) are different
 * facts, and `routing.ts` keeps them distinct on purpose. Folding them into one
 * "ABSENT" is precisely the confusion the parent brief's §3 parked item 1 is
 * about. They are counted apart here.
 *
 * NOT the `AttemptProvenance` block printed above: that is subjectId / variant
 * / seed / basis — WHOSE reply this is. This is `warrantAssertability
 * .provenanceSource` — what the WARRANT stood on. Two different objects that
 * share a word.
 */
function printProvenanceSourceCensus(rows: readonly AttemptRow[]): void {
  const byMode = new Map<string, Record<ProvenanceTallyKey, number>>();
  const zero = (): Record<ProvenanceTallyKey, number> => {
    const c = {} as Record<ProvenanceTallyKey, number>;
    for (const k of PROVENANCE_TALLY_KEYS) c[k] = 0;
    return c;
  };
  for (const row of rows) {
    const mode = row.record.mode;
    let bucket = byMode.get(mode);
    if (bucket === undefined) {
      bucket = zero();
      byMode.set(mode, bucket);
    }
    const observables = row.outcome !== null && row.outcome.outcome === "CAPTURED"
      ? row.outcome.observables
      : undefined;
    const warrant = observables?.warrantAssertability;
    if (warrant === undefined) bucket["no warrant claim"]++;
    else if (warrant.presence === "ABSENT") bucket["observable ABSENT"]++;
    else if (warrant.provenanceSource === undefined) bucket["unset"]++;
    else bucket[warrant.provenanceSource]++;
  }
  console.log("── THE WARRANT'S PROVENANCE · what the claim stood on, by mode ──");
  console.log("");
  console.log("  read off each CAPTURED outcome's own warrantAssertability. This is NOT");
  console.log("  the provenance block above (subject / variant / seed / basis — whose");
  console.log("  reply): it is what the WARRANT stood on. 'observable ABSENT' (a warrant");
  console.log("  claim nobody recorded) and 'no warrant claim' (an axis that makes none)");
  console.log("  are counted apart — they are different readings, not one.");
  console.log("");
  for (const [mode, counts] of byMode) {
    const parts = PROVENANCE_TALLY_KEYS.map((k) => `${k} ${String(counts[k])}`);
    console.log(`  ${mode} (${String(Object.values(counts).reduce((a, c) => a + c, 0))}): provenance ${parts.join(" / ")}`);
  }
  console.log("");
}

function printCounts(title: string, counts: Readonly<Record<string, number>>): void {
  console.log(`── ${title} ──────────────────────────────────────────────`);
  console.log("");
  for (const [name, value] of Object.entries(counts)) {
    console.log(`  ${pad(name + ":", 28)}${String(value)}`);
  }
  console.log("");
}

/** `MICA-PROBE-EVIDENCE-v3` -> `v3`. The tag said the way an operator says it. */
function tagVersion(tag: string): string {
  const dash = tag.lastIndexOf("-");
  return dash === -1 ? tag : tag.slice(dash + 1);
}

/**
 * A CHAIN OLDER THAN THIS READER — named as that, never as "malformed" (S125).
 *
 * THE FAILURE THIS REPLACES IS OPAQUE, NOT WRONG. A v3 chain already exits
 * non-zero here and already mints nothing; what it could not do was SAY which
 * of the three things it was. An operator holding a ratified pilot read and a
 * reader calling that same file off-schema has been handed a reason to doubt a
 * result that is not in doubt.
 *
 * NO CANNOT_ASSESS IS MINTED, AND THAT IS THE POINT, NOT A SIDE EFFECT. A
 * CANNOT_ASSESS is a reading OF a subject — it says the mirror looked and could
 * not tell. This reader met no subject: it met a file whose hashes it cannot
 * re-derive. If the two ever arrived looking alike, a census would carry a
 * bookkeeping fact in a column that means something about an agent.
 *
 * PRINTS BOTH TAGS, AND POINTS AT THE OBSERVATION RATHER THAN REPEATING IT.
 * The version is inferred from the provenance block's SHAPE — a record carries
 * no tag — so the reader owes the operator the keys it actually saw. It does
 * not print them a second time here: `printProvenance` has already put the
 * store's `lastError` on the page verbatim, ABOVE this, which is this file's
 * standing rule that the caveat is not a footer. Quoting it again would be the
 * same sentence three deep, since the refusal's own message quotes it once.
 */
function printSupersededPreimage(
  chainTag: string,
  err: EvidenceStoreNotGradable
): void {
  const chain = tagVersion(chainTag);
  const reader = tagVersion(EVIDENCE_DOMAIN_TAG);
  console.log("── READ REFUSED · THIS CHAIN IS OLDER THAN THIS READER ─────");
  console.log("");
  console.log(`  load state:    ${err.loadState}`);
  console.log(`  chain tag:     ${chainTag}`);
  console.log(`  reader tag:    ${EVIDENCE_DOMAIN_TAG}`);
  console.log("");
  console.log(`  chain tag ${chain}, reader ${reader}: not re-derivable under this reader;`);
  console.log("  the ratified read of this chain stands on the record.");
  console.log("");
  console.log("  Nothing was graded. No census was printed, no verdict and no");
  console.log("  CANNOT_ASSESS was minted: this reader met a file it cannot");
  console.log("  re-derive, not a subject it could not read, and those two must");
  console.log("  never arrive looking alike.");
  console.log("");
  console.log("  This is not the finding that the log is malformed or tampered");
  console.log("  with. It is intact and predates this reader. Nothing here");
  console.log("  rebuilds it: re-deriving an older chain under a newer preimage");
  console.log("  is not verifying it, and the read it already has stands.");
  console.log("");
  console.log("  WHAT THIS TAG WAS ESTABLISHED FROM: in LAST ERROR, VERBATIM, above.");
  console.log("  It is printed before this conclusion and not after it, because a");
  console.log("  tag this reader DERIVED is not a tag it READ — a record carries");
  console.log("  none. S132: the two routes are not equally strong and the error");
  console.log("  above says which one ran. A v3 chain is recognized from its key");
  console.log("  SHAPE, an inference. A v4 chain is recognized by re-deriving every");
  console.log("  hash under the older preimage, which is a proof. Neither admits a");
  console.log("  record: nothing was loaded under either tag.");
  console.log("");
}

/** Locates and names a break. Renders nothing derived — see the header. */
function printBreak(label: string, verb: string, length: number, brokenAt: number): void {
  console.log(`── THE CHAIN IS BROKEN · ${label} ──────────────────────────`);
  console.log("");
  console.log(`  break at index:              ${String(brokenAt)}`);
  console.log(`  records at and past it:      ${String(length - brokenAt)}`);
  console.log(`  records NOT ${verb} ${String(length)} (all of them)`);
  console.log("");
  console.log("  The safe prefix was NOT used either. The store refused this");
  console.log("  chain at load, and using its records anyway — behind the");
  console.log("  store's back — is the exact defect this reader was built to");
  console.log("  close. The break is named instead.");
  console.log("");
}

/** Returns a refusal if the evidence half could not report; renders either way. */
function readEvidence(path: string): Refusal | null {
  let store: EvidenceLogStore;
  try {
    store = new EvidenceLogStore({ path });
  } catch (err) {
    if (err instanceof EvidenceStoreDeploymentActMissing) {
      console.log("── READ REFUSED · A DEPLOYMENT ACT IS MISSING · EVIDENCE ───");
      console.log("");
      console.log(`  ${err.message}`);
      console.log("");
      console.log("  Nothing was created and nothing was read.");
      console.log("");
      return { code: 3, what: "the evidence log's deployment act is missing" };
    }
    throw err;
  }

  // FIRST, ALWAYS, BEFORE ANY RECORD.
  printProvenance("THE EVIDENCE STORE, BEFORE ANY RECORD", path, store);

  let graded: GradeFromStoreResult;
  try {
    graded = gradeFromStore(store);
  } catch (err) {
    if (err instanceof EvidenceStoreNotGradable) {
      // BEFORE the generic refusal, because it is a NARROWER reading of the
      // same CANNOT_VERIFY and the narrower one is the true one when it holds.
      const superseded = store.getSupersededChainTag();
      if (superseded !== null) {
        printSupersededPreimage(superseded, err);
        return { code: 10, what: "this chain is older than this reader" };
      }
      console.log("── GRADING REFUSED · THE STORE IS NOT GRADABLE ─────────────");
      console.log("");
      console.log(`  load state: ${err.loadState}`);
      console.log(`  ${err.message}`);
      console.log("");
      // `verify()` re-derives hashes over records already in memory. It opens
      // nothing, takes no lock, and grades nothing.
      const verification = store.verify();
      if (verification.brokenAt !== null) {
        printBreak("EVIDENCE", "graded:         ", store.length, verification.brokenAt);
        return { code: 5, what: "the evidence chain is broken" };
      }
      console.log("  No chain break was located: this store's records verify as far");
      console.log("  as they were read. What failed is upstream of the chain.");
      console.log("");
      return { code: 4, what: "the evidence store is not gradable" };
    }
    throw err;
  }

  const records = store.records();
  const brokenAt = graded.chainBroken === null ? null : graded.chainBroken.brokenAt;
  const safe = brokenAt === null ? records : records.slice(0, brokenAt);
  const rows = attemptRows(safe);

  if (rows.length !== graded.verdicts.length) {
    console.log("── REFUSED · THE READER AND THE GRADER DISAGREE ────────────");
    console.log("");
    console.log(`  this reader paired ${String(rows.length)} attempt(s) over the safe prefix;`);
    console.log(`  the grader returned ${String(graded.verdicts.length)} verdict(s).`);
    console.log("");
    console.log("  That is a coupling defect between this file's pairing and");
    console.log("  `gradeFromLog`'s, not a finding about the log. Printing a");
    console.log("  mispaired line would attach a verdict to the wrong attempt.");
    console.log("");
    return { code: 6, what: "the reader and the grader disagree" };
  }
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].record.scenarioId !== graded.verdicts[i].scenarioId) {
      console.log("── REFUSED · THE READER AND THE GRADER DISAGREE ────────────");
      console.log("");
      console.log(`  row ${String(i)} is scenario ${rows[i].record.scenarioId};`);
      console.log(`  verdict ${String(i)} is for ${graded.verdicts[i].scenarioId}.`);
      console.log("");
      return { code: 6, what: "the reader and the grader disagree" };
    }
  }

  const verdicts = graded.verdicts.map((v) => v.verdict);
  printAttemptLines(rows, verdicts, graded.loadState);
  printProvenanceLines(safe);

  // UNREACHED through `EvidenceLogStore` today — the store refuses a broken
  // chain at load and `gradeFromStore` never returns one. Written because the
  // pure grader's contract permits it. See the header.
  if (brokenAt !== null) printBreak("EVIDENCE", "graded:         ", records.length, brokenAt);

  printCensus(rows, verdicts);
  printWarrantCensus(rows, graded.verdicts.map((v) => v.warrantAssertability));
  printWarrantResponseCensus(rows, graded.verdicts.map((v) => v.warrantResponse));
  printProvenanceSourceCensus(rows);

  const attempts = records.filter((r) => r.kind === "ATTEMPT").length;
  printCounts("THE EVIDENCE COUNTS", {
    "records read": records.length,
    attempts,
    outcomes: records.filter((r) => r.kind === "OUTCOME").length,
    dangling: rows.filter((r) => r.outcome === null).length,
    graded: verdicts.length,
    ungraded: attempts - verdicts.length,
  });

  return brokenAt === null ? null : { code: 5, what: "the evidence chain is broken" };
}

// ── the review half ──────────────────────────────────────────────────────────

/** The grader's answer, or the literal withhold. THE blind rule, in one place. */
function machineVerdictColumn(record: ReviewRecord): string {
  return REVEALED_STATES.includes(record.state) ? record.machineVerdict : WITHHELD;
}

/** Whatever human judgments the record actually carries, in the order made. */
function humanJudgmentsOf(record: ReviewRecord): string {
  if (record.state === "PENDING_INITIAL") return "(none recorded)";
  const initial = `initial ${record.initialJudgment}`;
  const revised = record.state === "INITIAL_RECORDED" ? undefined : record.revisedJudgment;
  const final = record.state === "CLOSED" ? `final ${record.finalHumanJudgment}` : undefined;
  return [initial, revised === undefined ? undefined : `revised ${revised}`, final]
    .filter((part): part is string => part !== undefined)
    .join(", ");
}

function printReviewCases(states: readonly ReviewRecord[], loadState: string): void {
  console.log("── THE REVIEW CASES · one line each, blind until reveal ────");
  console.log("");
  console.log(
    `  ${pad("scenario", 24)}${pad("selected by", 20)}${pad("state", 18)}` +
      `${pad("machine verdict", 24)}${pad("human judgments", 52)}load state`
  );
  console.log(`  ${RULE}`);
  for (const record of states) {
    console.log(
      `  ${pad(record.scenarioId, 24)}${pad(record.selectedBy, 20)}${pad(record.state, 18)}` +
        `${pad(machineVerdictColumn(record), 24)}${pad(humanJudgmentsOf(record), 52)}${loadState}`
    );
  }
  console.log(`  ${RULE}`);
  console.log(`  ${String(states.length)} case line(s).`);
  console.log("");
}

function printJournal(journal: ReadReviewStoreResult["journal"]): void {
  console.log("── THE DISSENT JOURNAL · by kind, delimited and counted ────");
  console.log("");
  const byKind = new Map<string, number>();
  for (const entry of journal) byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1);
  if (journal.length === 0) {
    console.log("  (no journal entries — which is a finding, not a blank)");
  } else {
    for (const entry of journal) {
      console.log(`  ${pad(entry.kind, 22)}${pad(entry.scenarioId, 24)}${detailOf(entry)}`);
    }
    console.log(`  ${RULE}`);
    for (const [kind, count] of byKind) console.log(`  ${pad(kind + ":", 24)}${String(count)}`);
  }
  console.log(`  ${String(journal.length)} journal entr(y/ies).`);
  console.log("");
}

function detailOf(entry: ReadReviewStoreResult["journal"][number]): string {
  switch (entry.kind) {
    case "INITIAL_VS_REVISED":
      return `${entry.initialJudgment} -> ${entry.revisedJudgment}`;
    case "HUMAN_VS_MACHINE":
    case "UNRESOLVED_AT_CLOSE":
      return `human ${entry.humanJudgment} vs machine ${entry.machineVerdict}`;
    case "STRUCTURAL_REFUSAL":
      return `${entry.attemptedOperation} refused`;
  }
}

/**
 * A signature is rendered as what it BOUNDS. The count is printed, never the
 * scope's contents as a claim about coverage, and no word here says or implies
 * that a signature covers everything — `SignatureScope` was built so that
 * cannot be said, and a renderer is the last place it could be said anyway.
 */
function printSignatures(signatures: ReadReviewStoreResult["signatures"]): void {
  console.log("── THE SIGNATURES · bounded, and rendered as bounded ───────");
  console.log("");
  if (signatures.length === 0) {
    console.log("  (no signatures — nothing has been attested)");
  } else {
    console.log(
      `  ${pad("signer seat", 24)}${pad("cases reviewed individually", 30)}batch claim`
    );
    console.log(`  ${RULE}`);
    for (const s of signatures) {
      console.log(
        `  ${pad(s.signerSeat, 24)}` +
          `${pad(String(s.scope.individuallyReviewedCaseIds.length), 30)}` +
          `${s.scope.batchClaim === undefined ? "absent" : "present, bounded by rule + census + window"}`
      );
    }
    console.log(`  ${RULE}`);
  }
  console.log(`  ${String(signatures.length)} signature(s).`);
  console.log("");
}

/**
 * The sha256 of the chain this reader was pointed at, or null when its bytes
 * could not be taken. NULL IS NOT ZERO AND NOT "no match": it is the reason the
 * match could not be attempted, and `printChainReviews` says so rather than
 * printing every line as an orphan and letting a reader draw the wrong one.
 */
function shaOfChainFile(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

/** First 8 of the digest, the way the register and the handoffs write it. */
function shortSha(sha: string): string {
  return sha.slice(0, 8);
}

/**
 * THE CHAIN REVIEWS, AND THE TRAILER THAT TURNS ON THEM.
 *
 * The match is on the SHA ALONE (see the header). The trailer names the FIRST
 * matching record, because the ratifying read is the one that happened first —
 * a second seat opening the same file later is a re-read, and it is counted and
 * shown in the block rather than allowed to overwrite who ratified.
 */
function printChainReviews(
  reviews: ReadReviewStoreResult["chainReviews"],
  chainPath: string,
  chainSha: string | null,
  timestamps: readonly number[],
  loadState: string,
  micaLog: string | null,
  recordBook: string | null,
  runId: string | null
): void {
  console.log("── THE CHAIN REVIEWS · who opened this file, and at which sha ──");
  console.log("");
  console.log(`  the chain read here:  ${chainPath}`);
  console.log(
    `  its sha256:           ${chainSha ?? "NOT TAKEN — its bytes could not be read here"}`
  );
  console.log("");
  if (reviews.length === 0) {
    console.log("  (no chain reviews — no seat has recorded opening any chain file)");
  } else {
    console.log(
      `  ${pad("run", 20)}${pad("sha", 10)}${pad("verify", 12)}${pad("reviewer", 20)}` +
        `${pad("timestamp", 16)}${pad("match", 12)}load state`
    );
    console.log(`  ${RULE}`);
    for (let i = 0; i < reviews.length; i++) {
      const r = reviews[i];
      const match =
        chainSha === null ? "NOT TAKEN" : r.chainSha256 === chainSha ? "THIS CHAIN" : "ORPHAN";
      console.log(
        `  ${pad(r.runId, 20)}${pad(shortSha(r.chainSha256), 10)}${pad(r.verifyResult, 12)}` +
          `${pad(r.reviewerSeat, 20)}${pad(String(timestamps[i]), 16)}${pad(match, 12)}${loadState}`
      );
    }
    console.log(`  ${RULE}`);
  }
  console.log(`  ${String(reviews.length)} chain review line(s).`);
  console.log("");
  console.log("  This reader knows exactly ONE chain: the one at --log. ORPHAN means");
  console.log("  'not this chain', never 'not any chain' — it is a record, not a");
  console.log("  refusal and not a suspicion. The match is on the sha alone: a path");
  console.log("  that agrees and a digest that does not is not a match.");
  console.log("");

  console.log("── THE RATIFYING READ · the trailer ────────────────────────");
  console.log("");
  if (chainSha === null) {
    console.log("  NOT ESTABLISHED — this reader could not take the bytes of the chain");
    console.log("  it was pointed at, so no match was attempted. That is not the");
    console.log("  finding that the chain is unreviewed.");
    console.log("");
    return;
  }
  const matched: number[] = [];
  for (let i = 0; i < reviews.length; i++) {
    if (reviews[i].chainSha256 === chainSha) matched.push(i);
  }
  if (matched.length === 0) {
    console.log("  NOT REVIEWED — no CHAIN_REVIEW in this trail names this chain's sha.");
    console.log("  That is a finding about the TRAIL, not about the chain: the chain");
    console.log("  loaded and verified above under its own reading.");
    console.log("");
    return;
  }
  const first = matched[0];
  console.log(
    `  REVIEWED by ${reviews[first].reviewerSeat} at ${String(timestamps[first])}`
  );
  printSpineLine(micaLog, chainSha);
  printRecordBookLines(recordBook, runId, chainSha);
  console.log("");
  console.log(`  verify recorded:  ${reviews[first].verifyResult} at ${reviews[first].chainSha256}`);
  console.log(`  reader vintage:   ${reviews[first].readerVersion} (the relay's claim, not a measurement)`);
  if (matched.length > 1) {
    console.log(
      `  ${String(matched.length)} records name this sha; the FIRST is the ratifying read and ` +
        "the rest are re-reads."
    );
  }
  console.log("");
  console.log("  The seat is a DECLARATION, not an authentication, and this record");
  console.log("  certifies no reading, no verdict and no judgment — only that the");
  console.log("  file was opened and its verify came back valid at that sha.");
  console.log("");
}

/**
 * The audit is run only against a window the OPERATOR declared. There is no
 * default: a window size is a judgment about how much sustained agreement is
 * suspicious, and a tool that picked one would be making that judgment.
 *
 * `checkUnanimityAudit` takes an `atMs` and stamps it into the flag it returns.
 * This tool calls no clock, so it passes 0 and never prints `flaggedAt` — the
 * flag's own timestamp would be this reader testifying about when it looked.
 */
function printUnanimity(states: readonly ReviewRecord[], windowSize: number | null): void {
  console.log("── THE UNANIMITY AUDIT ─────────────────────────────────────");
  console.log("");
  const closed = states.filter((r): r is ClosedReview => r.state === "CLOSED");
  if (windowSize === null) {
    console.log("  NOT CHECKED — no --unanimity-window was declared.");
    console.log("  This is not a pass. Nothing was examined.");
    console.log("");
    return;
  }
  console.log(`  declared window:  ${String(windowSize)}`);
  console.log(`  closed cases:     ${String(closed.length)}`);
  const flag = checkUnanimityAudit(closed, { windowSize }, 0);
  if (flag === null) {
    console.log(
      closed.length < windowSize
        ? "  no flag: fewer closed cases than the declared window."
        : "  no flag: the window contains at least one disagreement."
    );
  } else {
    console.log(`  FLAGGED — the last ${String(flag.windowSize)} closed cases agree with the`);
    console.log("  grader without exception. A flag, never a rejection and never a");
    console.log("  comfort: sustained agreement is the shape a grader-mimicking");
    console.log("  shallow reviewer would produce.");
  }
  console.log("");
}

/** Returns a refusal if the review half could not report; renders either way. */
/**
 * S133 · WIRE B — WHETHER THE MACHINE'S OWN LEDGER NAMES THIS CHAIN.
 *
 * FOUR STATES AND THEY ARE NOT THREE. "Not asked" is not "not there", and "I
 * could not read the spine" is neither of them — the same distinction the
 * registrar draws with CANNOT_SEE_FRAME and this reader already draws with
 * ORPHAN vs NOT REVIEWED. Silence on the un-asked case is deliberate:
 * `--mica-log` absent prints nothing at all, because a line saying "the spine
 * was not checked" on every ordinary run is noise that trains a reader to skip
 * the section.
 *
 * AND IT NEVER SAYS "STAMPED". See `STAMP_NOT_DETERMINABLE` in
 * `ledger-lookup.ts`: a clerk stamp carries `sequenceNumber` and no writer, the
 * log has three writers each counting from zero, and S127-8 repaired exactly
 * this in the clerk-caller's CURSOR without following it into the stamps file.
 * A trailer that printed STAMPED here would be joining on an integer that does
 * not identify a record. It says so instead, in the one sentence every reader
 * imports so that all of them say it identically.
 */
function printSpineLine(micaLog: string | null, chainSha: string | null): void {
  if (micaLog === null || chainSha === null) return;
  const found = findLedgerDeposit(micaLog, chainSha);
  if (found.state === "UNREADABLE") {
    console.log(`  SPINE NOT IN VIEW — ${found.detail}. An absence, not a finding.`);
    return;
  }
  if (found.state === "ABSENT") {
    console.log(`  NOT IN THE LEDGER — ${micaLog} carries no ${LEDGER_EVENT_TYPE} for this sha.`);
    return;
  }
  const d = found.deposit;
  console.log(
    `  IN THE LEDGER — ${LEDGER_EVENT_TYPE} by ${d.moduleId}, seq ${String(d.sequenceNumber)}, ` +
      `in ${micaLog}`
  );
}

/**
 * S134 Rb · THE SECOND BOOK'S LINES, BESIDE THE JOURNAL'S AND NEVER SUMMED.
 *
 * The journal line above is the arbiter's own narration of its own act (PATH B,
 * ranked below the books). The line below is what the REGISTRAR accepted under
 * owner-uid identity. They answer different questions — "what did the writer say
 * it did" and "what did a second party record" — and a reader that added them
 * would answer neither. Both are printed; the register decides which it counts.
 *
 * ONE STATE PER KIND, and "none" is a state. A run whose ten headers named no
 * seat produces NO records, and that is a finding about the run rather than a
 * gap in the reading — so it is printed rather than left blank.
 */
function printRecordBookLines(
  recordBook: string | null,
  runId: string | null,
  chainSha: string | null
): void {
  if (recordBook === null || runId === null) return;
  const run = findRunRecords(recordBook, runId);
  if (run.state === "UNREADABLE") {
    console.log(`  RECORD BOOK NOT IN VIEW — ${run.detail}. An absence, not a finding.`);
    return;
  }
  if (run.state === "ABSENT") {
    console.log(
      `  NO RECORDS IN THE BOOK — ${recordBook} holds no ${RECORD_ESCALATION} and no ` +
        `${RECORD_REQUEST} for ${runId}. Under rung 1 that means no header in this run ` +
        `named a seat, which is a reading of the run and not a gap in this one.`
    );
  } else {
    console.log(`  IN THE BOOK — ${formatRecordCounts(run.records)} for ${runId}, in ${recordBook}`);
    for (const r of run.records) {
      if (r.kind !== RECORD_ESCALATION && r.kind !== RECORD_REQUEST) continue;
      console.log(
        `    ${r.kind} -> ${r.addressee} (reply wrote ${JSON.stringify(r.addresseeVerbatim)}) ` +
          `· ${r.scenarioId} ${r.variant} · deposited by ${r.depositor}`
      );
    }
  }
  if (chainSha === null) return;
  const review = findChainReviewRecord(recordBook, chainSha);
  if (review.state === "FOUND") {
    console.log(
      `  CHAIN REVIEW IN THE BOOK — ${LEDGER_EVENT_TYPE} for this sha, deposited by ` +
        `${review.records[0].depositor}. This is the authoritative line; the ledger line ` +
        `above is the arbiter's own narration of the same act. NEITHER IS SUMMED WITH THE OTHER.`
    );
  }
}

function readReview(
  path: string,
  unanimityWindow: number | null,
  chainPath: string,
  chainSha: string | null,
  micaLog: string | null,
  recordBook: string | null,
  runId: string | null
): Refusal | null {
  let store: ReviewLogStore;
  try {
    store = new ReviewLogStore({ path });
  } catch (err) {
    if (err instanceof ReviewStoreDeploymentActMissing) {
      console.log("── READ REFUSED · A DEPLOYMENT ACT IS MISSING · REVIEW ─────");
      console.log("");
      console.log(`  ${err.message}`);
      console.log("");
      console.log("  Nothing was created and nothing was read.");
      console.log("");
      return { code: 7, what: "the review log's deployment act is missing" };
    }
    throw err;
  }

  printProvenance("THE REVIEW STORE, BEFORE ANY RECORD", path, store);

  let read: ReadReviewStoreResult;
  try {
    read = readReviewStore(store);
  } catch (err) {
    if (err instanceof ReviewStoreNotReadable) {
      console.log("── READ REFUSED · THE REVIEW STORE IS NOT READABLE ─────────");
      console.log("");
      console.log(`  load state: ${err.loadState}`);
      console.log(`  ${err.message}`);
      console.log("");
      const verification = store.verify();
      if (verification.brokenAt !== null) {
        printBreak("REVIEW", "rendered:       ", store.length, verification.brokenAt);
        return { code: 9, what: "the review chain is broken" };
      }
      console.log("  No chain break was located: this store's records verify as far");
      console.log("  as they were read. What failed is upstream of the chain.");
      console.log("");
      return { code: 8, what: "the review store is not readable" };
    }
    throw err;
  }

  printReviewCases(read.states, read.loadState);
  printJournal(read.journal);
  printSignatures(read.signatures);
  // The frame's timestamp, read off the chain rather than copied into the
  // payload — see `ChainReview`'s doc comment for why there is only one.
  const chainReviewTimestamps = store
    .records()
    .filter((r) => r.kind === "CHAIN_REVIEW")
    .map((r) => r.timestamp);
  printChainReviews(
    read.chainReviews,
    chainPath,
    chainSha,
    chainReviewTimestamps,
    read.loadState,
    micaLog,
    recordBook,
    runId
  );
  printUnanimity(read.states, unanimityWindow);

  const withheld = read.states.filter((r) => !REVEALED_STATES.includes(r.state)).length;
  printCounts("THE REVIEW COUNTS", {
    "chain records": store.length,
    cases: read.states.length,
    "machine verdict withheld": withheld,
    "machine verdict shown": read.states.length - withheld,
    closed: read.states.filter((r) => r.state === "CLOSED").length,
    "journal entries": read.journal.length,
    signatures: read.signatures.length,
    "chain reviews": read.chainReviews.length,
  });
  return null;
}

// ── main ─────────────────────────────────────────────────────────────────────

export function main(argv: readonly string[]): number {
  let options: Options;
  try {
    options = parseOptions(argv);
  } catch (err) {
    if (err instanceof UsageRefused) {
      printUsageRefusal(err.message);
      return 2;
    }
    throw err;
  }

  const refusals: Refusal[] = [];

  const evidenceRefusal = readEvidence(options.log);
  if (evidenceRefusal !== null) refusals.push(evidenceRefusal);

  if (options.review === null) {
    console.log("── THE REVIEW TRAIL ────────────────────────────────────────");
    console.log("");
    console.log("  NO REVIEW LOG GIVEN — the D-layer is not in view.");
    console.log("  Pass --review <path> to read it. The exit code below is");
    console.log("  unaffected: not looking is not a finding about the trail.");
    console.log("");
  } else {
    const reviewRefusal = readReview(
      options.review,
      options.unanimityWindow,
      options.log,
      shaOfChainFile(options.log),
      options.micaLog,
      options.recordBook,
      options.runId
    );
    if (reviewRefusal !== null) refusals.push(reviewRefusal);
  }

  if (refusals.length === 0) {
    console.log("GRADED CLEAN.");
    return 0;
  }
  console.log("── REFUSALS · every one, not only the one the exit names ───");
  console.log("");
  for (const r of refusals) console.log(`  exit ${String(r.code)}: ${r.what}`);
  console.log("");
  console.log(`  exiting ${String(refusals[0].code)} — the first refusal.`);
  return refusals[0].code;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
