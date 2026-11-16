// ── MICA · the ledger lookup — one spelling, three readers ───────────────────
//
// S133, wire B (the arbiter: PATH B). `review-cli.ts chain` deposits a pilot's chain
// review into `/var/lib/mica/mica-log.jsonl`; `evidence-read-cli.ts` (Reader A)
// prints whether the spine carries it; the report's `pilot-review-in-ledger`
// family reads the same thing nightly. THREE READERS, ONE QUESTION, and the
// answer has to be spelled the same way in all three or the family is held
// together by a string literal written three times.
//
// ── WHY A MODULE AND NOT AN IMPORT FROM `review-cli.ts` ─────────────────────
//
//   `review-cli.ts` imports every shipped family to build its selection
//   population. Reader A and the report reader need twenty lines of JSONL
//   scanning, not a scenario catalogue, and an import edge for it would drag
//   the catalogue into both. The event-type SPELLING is the load-bearing thing
//   here, and it lives here so nothing has to reach across a CLI for it.
//
// ── WHAT THIS FILE IS NOT ────────────────────────────────────────────────────
//
//   It grades nothing, it verifies nothing, and it says nothing about whether a
//   record was STAMPED. A `MicaLogRecord` is unchained and unsigned by design —
//   `mica-registrar.service`'s RANK OF BOOKS note puts this whole journal
//   "ranked strictly below" the authoritative records — so the most this can
//   honestly report is "the spine names this chain, here".

import { readFileSync } from "fs";

import { RecordBook } from "../record/record-book";
import type { RecordBookRecord } from "../record/record-book";
import { UNATTRIBUTED_STAMP_WRITER } from "../mica/sig";
import { stampFor } from "../glue/clerk-clock-stamps-file";
import type { ClerkClockSource } from "../mica/sig";

/**
 * The ledger's name for a deposited pilot chain review.
 *
 * `MicaLogRecord` has no `kind` field; its `eventType` IS the kind. And the
 * clerk-caller filters on NOTHING but its own per-writer cursor (read at bytes,
 * S133: `log.getAll().filter(r => seq > cursor.get(r.moduleId))`), so there is
 * no allow-list this name must be added to and no guard that would refuse an
 * unknown one. That makes the spelling the only thing joining the writer to its
 * readers, which is why it is a constant.
 */
export const LEDGER_EVENT_TYPE = "PILOT_CHAIN_REVIEWED";

/**
 * S134 Rb · THE TWO SPELLINGS RUNG 1 ADDS, and they are NOT event types.
 *
 * `PILOT_CHAIN_REVIEWED` above is an `eventType` in the JOURNAL — the arbiter's
 * own line about its own act, PATH B, ranked below the books. These two are
 * record KINDS in the registrar's second book, written by a custodian that is
 * not the depositor. Both are printed by the readers below; NEITHER IS SUMMED
 * WITH THE OTHER. A self-narrated line and an independently-recorded one answer
 * different questions and adding them would answer neither.
 */
export const RECORD_ESCALATION = "ESCALATION";
export const RECORD_REQUEST = "REQUEST";
export const RECORD_CHAIN_REVIEWED = "PILOT_CHAIN_REVIEWED";

/** Where a deposit sits in the ledger. `moduleId` is the writer's own name. */
export interface LedgerDeposit {
  readonly moduleId: string;
  readonly sequenceNumber: number;
  readonly timestamp: number;
  readonly outcome: string;
}

/**
 * Three answers, and the third is not the second.
 *
 * `UNREADABLE` exists because "I could not look" is not "it is not there" —
 * the same two-valued collapse `lookAtPrecommitFile` and the registrar's
 * CANNOT_SEE_FRAME refuse. A reader that returned null for a permission error
 * would print NOT IN THE LEDGER about a deployment fault.
 */
export type LedgerLookup =
  | { readonly state: "FOUND"; readonly deposit: LedgerDeposit }
  | { readonly state: "ABSENT" }
  | { readonly state: "UNREADABLE"; readonly detail: string };

/**
 * The FIRST ledger record naming this chain sha, if any.
 *
 * MATCHES ON THE SHA, NOT ON A PATH OR A runId. The outcome line carries
 * `chain=<64 hex>` verbatim precisely so this match is on the digest of the
 * bytes that were verified and never on a name somebody could re-use.
 *
 * A LINE THAT DOES NOT PARSE IS SKIPPED, NOT FATAL, and that is deliberate
 * here where it would be wrong elsewhere: this is a lookup over a journal
 * explicitly ranked below the authoritative books, run beside readers that do
 * their own verification. `mica-log-file.ts` is the module that judges this
 * file's integrity; this one asks it a question.
 */
export function findLedgerDeposit(micaLogPath: string, chainSha256: string): LedgerLookup {
  let raw: string;
  try {
    raw = readFileSync(micaLogPath, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return { state: "UNREADABLE", detail: `${micaLogPath} (${e.code ?? e.name ?? "error"})` };
  }
  const needle = `chain=${chainSha256}`;
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const o = parsed as Record<string, unknown>;
    if (o.eventType !== LEDGER_EVENT_TYPE) continue;
    if (typeof o.outcome !== "string" || !o.outcome.includes(needle)) continue;
    return {
      state: "FOUND",
      deposit: {
        moduleId: typeof o.moduleId === "string" ? o.moduleId : "(no moduleId)",
        sequenceNumber: typeof o.sequenceNumber === "number" ? o.sequenceNumber : -1,
        timestamp: typeof o.timestamp === "number" ? o.timestamp : -1,
        outcome: o.outcome,
      },
    };
  }
  return { state: "ABSENT" };
}

/**
 * S134 Rb · THE SECOND BOOK, READ. Three answers, and the third is not the
 * second — the same shape as `LedgerLookup`, for the same reason.
 */
export type RecordBookLookup =
  | { readonly state: "FOUND"; readonly records: readonly RecordBookRecord[] }
  | { readonly state: "ABSENT" }
  | { readonly state: "UNREADABLE"; readonly detail: string };

function openRecordBook(path: string): RecordBookLookup | RecordBook {
  let book: RecordBook;
  try {
    book = new RecordBook({ path });
  } catch (err) {
    return { state: "UNREADABLE", detail: `${path} (${String(err)})` };
  }
  if (book.getLoadState() === "CANNOT_VERIFY") {
    return { state: "UNREADABLE", detail: `${path} (${String(book.getLastError())})` };
  }
  return book;
}

/**
 * The ESCALATION / REQUEST records a run produced, by runId.
 *
 * THE AUTHORITATIVE LINE FOR RUNG 1. `mica-subject1` writing its own escalation
 * into its own journal is a self-report; this book holds what the REGISTRAR
 * accepted under owner-uid identity, which is the second party the design asked
 * for. A reader printing only the journal line would be printing the broadcast.
 */
export function findRunRecords(recordBookPath: string, runId: string): RecordBookLookup {
  const opened = openRecordBook(recordBookPath);
  if (!(opened instanceof RecordBook)) return opened;
  const records = opened
    .getAll()
    .filter((r) => (r.kind === "ESCALATION" || r.kind === "REQUEST") && r.runId === runId);
  return records.length === 0 ? { state: "ABSENT" } : { state: "FOUND", records };
}

/** The PILOT_CHAIN_REVIEWED record for a chain sha, in the arbiter's own book. */
export function findChainReviewRecord(
  recordBookPath: string,
  chainSha256: string
): RecordBookLookup {
  const opened = openRecordBook(recordBookPath);
  if (!(opened instanceof RecordBook)) return opened;
  const records = opened
    .getAll()
    .filter((r) => r.kind === "PILOT_CHAIN_REVIEWED" && r.chainSha256 === chainSha256);
  return records.length === 0 ? { state: "ABSENT" } : { state: "FOUND", records };
}

/** `2 ESCALATION / 3 REQUEST`, or the book's own word for nothing. */
export function formatRecordCounts(records: readonly RecordBookRecord[]): string {
  const counts = new Map<string, number>();
  for (const r of records) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  if (counts.size === 0) return "none";
  return [...counts.entries()].map(([k, n]) => `${String(n)} ${k}`).join(" / ");
}

/**
 * S134 Ra · WHETHER A READER MAY SAY `STAMPED`, AND WHAT IT SAYS OTHERWISE.
 *
 * THE OWED REPAIR BELOW WAS MADE (S134 item 1). The stamps file now carries
 * `moduleId` beside `sequenceNumber`, so a stamp joins to ONE writer's record
 * and the question is answerable for every stamp written from here forward.
 *
 * IT IS NOT ANSWERABLE BACKWARD, and no rule can make it so. The nineteen lines
 * already on disk at S134 carry no writer; three of them are `sequenceNumber: 0`
 * and therefore belong to three different principals. They read UNATTRIBUTED and
 * this function returns NOT_DETERMINABLE for them — never a guess, and never the
 * old `LEGACY_CURSOR_MODULE_ID` shortcut, which would have named nine of the
 * nineteen falsely.
 */
export type StampAnswer =
  | { readonly state: "STAMPED"; readonly clerkSeq: number }
  | { readonly state: "NOT_STAMPED" }
  | { readonly state: "NOT_DETERMINABLE"; readonly detail: string };

export function stampAnswerFor(
  stamps: ClerkClockSource,
  moduleId: string,
  sequenceNumber: number
): StampAnswer {
  if (moduleId === UNATTRIBUTED_STAMP_WRITER || moduleId.length === 0) {
    return {
      state: "NOT_DETERMINABLE",
      detail: STAMP_NOT_DETERMINABLE_BEFORE_S134,
    };
  }
  const hit = stampFor(stamps, moduleId, sequenceNumber);
  if (hit !== null) return { state: "STAMPED", clerkSeq: hit.clerk_seq };
  // A record with a real writer and no matching stamp is NOT STAMPED — a fact,
  // not an absence of knowledge. The legacy case above is the other one.
  return { state: "NOT_STAMPED" };
}

/**
 * Why a PRE-S134 stamp still cannot be joined to a writer [LB].
 *
 * A `ClerkClockStamp` carries `{sequenceNumber, clerk_seq, clerk_time,
 * separation, intake, clerk_id, clerk_boot_id}` and NO writer — `sig/index.ts`
 * says in its own words that "`sequenceNumber` joins a stamp" to a record. That
 * join was unambiguous while one principal wrote the log. It is not any more:
 * S127-6 ruled the log multi-writer ("`registrar 5` and `doctor 5` are
 * different records wearing the same number") and S127-8 followed by making the
 * clerk-caller's CURSOR a map per `moduleId` — but the STAMPS FILE was not
 * followed, and it still keys on the bare integer.
 *
 * So `seq 3` in the stamps file may be the registrar's third record or the
 * arbiter's, and nothing on disk distinguishes them. Every reader that wants
 * "was this stamped" must say THIS instead of guessing, and the sentence is
 * exported so all of them say it identically.
 *
 * `[owed → pilot 9's beat]` — the same repair S127-8 made to the cursor, made
 * to the stamp: carry the writer beside the number.
 */
export const STAMP_NOT_DETERMINABLE_BEFORE_S134 =
  "this stamp was written before S134 and carries no moduleId, so it cannot be joined to " +
  "one writer's record. The log has three writers (mica-registrar, mica-arbiter, " +
  "mica-doctor) each minting from its own counter, and the nineteen legacy lines on the box " +
  "include three separate `sequenceNumber: 0` stamps — three different principals. Stamps " +
  "written from S134 onward carry the writer and ARE joinable; these are not, and no rule " +
  "can make them so after the fact.";

/**
 * The OLD name, kept pointing at the new sentence for one beat.
 *
 * Two readers print this string. Renaming it and the readers in one commit is
 * correct; deleting it without them is a build break, and leaving it with the
 * OLD TEXT would have two readers announcing an unfixed defect that is fixed.
 */
export const STAMP_NOT_DETERMINABLE = STAMP_NOT_DETERMINABLE_BEFORE_S134;
