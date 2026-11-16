// ── MICA · C6/W5 — the daily witness report. A READER, and only a reader ─────
//
//   npx ts-node src/report/mica-report.ts \
//     --store <file> --outbox <dir> --report-dir <dir> [--day YYYY-MM-DD]
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
//
//   The witness records correctly into the dark. An UNREADABLE_DROP is retained
//   with the OS error, the size and the mode — and told to NOBODY. S86 ruled
//   that it surfaces THROUGH this report and nowhere else, because S85 had
//   already ruled the harder thing: the witness has NO READER, EVER, no socket,
//   no read op, no mouth. The four entitled roles read the raw store FILE, out
//   of band. This program is one of those readers, given a schedule instead of a
//   mood.
//
// ── THE TWO THINGS IT IS NOT, AND BOTH ARE STRUCTURAL ────────────────────────
//
//   IT IS NOT A WITNESS FEATURE. It opens no socket to `witnessd`, sends it no
//   signal, and constructs no `Witness` — constructing one APPENDS a PLACEMENT
//   record (`witness.ts`, the constructor), so a reader that instantiated the
//   class to read with would WRITE TO THE BOOK IT CAME TO READ, once a day,
//   forever. It reads the store as bytes, like any other entitled role.
//
//   IT IS NOT A MONITOR. No polling, no /health, no liveness claim, no verdict.
//   `~/citadel/watchman/watchman.py` asks its agents how they are; this asks
//   nobody anything. Whether the witness is RUNNING is not this program's claim
//   to make: it reports the age of the last record and stops there. A reader
//   that inferred "up" from a recent record would be inventing the one sentence
//   a witness must never say by accident.
//
// ── WHAT IT IMPORTS FROM THE WITNESS, AND WHAT IT DELIBERATELY DOES NOT ──────
//
//   It imports `WITNESSED_KINDS` from `../witness/types` — NINE names as of
//   S105 (2026-09-03), seven when this paragraph was written, as a value, from
//   the one place they are declared. That is the strawberry: a reader carrying
//   its own copy of the kind list would silently stop mentioning an eighth kind
//   the day one is added, and the two files would then disagree about what the
//   book can contain while both kept compiling.
//
//   AND THE DAY CAME, AND THE STRAWBERRY ONLY HALF HELD. The counts table did
//   grow both new kinds by itself, because it iterates the import. `ARRIVAL_KINDS`
//   and the two `=== "HEAD_COMMIT"` tests below did NOT — they are this file's
//   OWN copies of a subset, and a subset cannot be derived from the full list
//   because the split is a judgement (what ARRIVED versus what the witness
//   observed about itself) that only this file makes. They were edited by hand
//   in the same commit that added the kinds, and the S105 receipt records that
//   an import is not a fence around every list a file keeps. The import is
//   type-position and constant only; `types.ts` takes no runtime import of its
//   own, so nothing of the witness's machinery is pulled in behind it.
//
//   IT DOES NOT RE-VALIDATE THE CLOSED SCHEMA, and that is a decision, not an
//   omission. `validateRecord` is private to `witness.ts` and must stay there:
//   the witness owns what a well-formed record is, at append time and at load
//   time. A second validator written here would be a SECOND OPINION about the
//   same bytes — two graders of one strawberry — and the day they disagreed the
//   argument would be about the bookkeeping instead of about the day. So this
//   fold reads the record FRAME (seq, arrivalTs, submitterId, kind, witnessed)
//   and says so in the report, in those words.
//
// ── WHAT IT DOES WITH A LINE IT CANNOT READ ──────────────────────────────────
//
//   IT REPORTS IT AND KEEPS GOING. It never skips one silently, and it never
//   stops at one. The witness's own loader DOES stop at the first bad line —
//   and that is worth a reader's loudest paragraph rather than its imitation:
//   a store with an unreadable line is NOT APPENDABLE (`witness.ts`, the
//   appendRecord guard: `witness store is not appendable: <state>`), so every
//   later append throws and `witnessd` exits 3. A fold that stopped where the
//   loader stops would report a day it never read, and would report it as quiet.

import { readdirSync, readFileSync } from "fs";

import { WITNESSED_KINDS } from "../witness/types";
import {
  ABSENT_CADENCE_DECLARATION,
  assessStaleness,
  type StalenessReading,
} from "./staleness-alarm";
import { CLERK_CALLER_NOT_WIRED, type ClerkCallerReading } from "./clerk-caller-attestation";
import {
  ABSENT_JOURNAL_DECLARATION,
  assessJournalBookReconciliation,
  assessStampShapeReconciliation,
  type JournalDeclaration,
  type PrincipalJournalReconciliation,
  type ReconciliationReading,
} from "./reconciliation";
import {
  ABSENT_DEPLOYMENT_FACTS_DECLARATION,
  assessDeploymentFacts,
  DEPLOYMENT_FACTS_CEILING,
  type DeploymentFactsReading,
} from "./deployment-facts";

export const REPORT_TITLE =
  "MICA C6/W5 — a reader's daily fold of the S-4 witness store. It reads two " +
  "paths and writes one file; it asks nobody anything.";

export const REPORT_MAKES_NO_VERDICT =
  "This report contains counts, ages and the records that refuse to be quiet. " +
  "It certifies nothing, recommends nothing, and pronounces on nobody's health. " +
  "Interpretation belongs to the roles entitled to read the book.";

export const REPORT_IS_NOT_A_LIVENESS_CLAIM =
  "The age of the last record is an age. It is not a statement that the witness " +
  "is running, was running, or stopped. Nothing here polls, pings or asks.";

/**
 * Item-4's honest-limit text (Tier-1 card), nodded by the arbiter verbatim,
 * S108 rider 1. Fixed — never assembled from parts, never rephrased per run —
 * so the words a reader sees are always exactly the words that were ruled.
 */
export const HONEST_LIMIT_TEXT =
  "This record catches the careless fraud loudly: backdating, reordering, " +
  "renumbering, silent deletion. It does not catch the careful one - an " +
  "adversary who lies in real time, inside the rules, is invisible to this " +
  "instrument, and payload truth is never attested here: the stamp says when, " +
  "never whether true. Root can stop the clerk; no local fix exists for the " +
  "operator. Smoke alarm, not vault door. That is the whole promise, and it is " +
  "stated so no reader can inherit more than was built.";

/**
 * The one sentence this instrument exists to make impossible to miss (VF,
 * inherited): a day with nothing in it must never read as a day that went well.
 */
export function quietDaySentence(ageText: string): string {
  return (
    "no arrivals recorded — cannot distinguish a quiet day from a stopped " +
    "witness; last record age: " + ageText
  );
}

/** Words a fold of a book is not allowed to use about the book. */
export const BARRED_VOCABULARY: readonly string[] = [
  "healthy",
  "unhealthy",
  "all clear",
  "all-clear",
  "nominal",
  "everything is fine",
  "no problems",
  "looks good",
  "verified",
  "certified",
];

// ── the window ───────────────────────────────────────────────────────────────

export interface ReportWindow {
  /** `YYYY-MM-DD`, in the LOCAL civil calendar of the host that ran the fold. */
  readonly day: string;
  /** Inclusive start, epoch ms. */
  readonly startMs: number;
  /** EXCLUSIVE end, epoch ms. */
  readonly endMs: number;
  /** Minutes east of UTC at the start of the day. Printed, never assumed. */
  readonly offsetMinutes: number;
}

/**
 * WHERE THE WINDOW CAME FROM. Printed everywhere the day is printed.
 *
 * `DECLARED` — an operator named the day with `--day`.
 * `COMPUTED` — no day was named, and the program took the most recent COMPLETE
 *              local day from this host's clock.
 *
 * The arbiter ruled (S104) that the window must never be defaulted SILENTLY. The
 * default itself is the timer's contract — `deploy/mica-report.service` passes
 * no `--day` on purpose, and a nightly fold of "yesterday" is what that unit
 * means — so the default stays and the SILENCE goes: a report whose day nobody
 * named now says so, on its own face and in its own record. A reader who wants
 * to know whether the fold covered the day the operator intended can now tell,
 * which is the whole of what a provenance field buys.
 *
 * WHETHER IT SHOULD REFUSE OUTRIGHT is a live fork and NOT settled here — it
 * would break `deploy/mica-report.service` and R-U2, and unit wiring is the
 * arbiter's hand. Named in the S104 receipt, parked.
 */
export type DayProvenance = "DECLARED" | "COMPUTED";

export function dayProvenanceText(p: DayProvenance): string {
  return p === "DECLARED"
    ? "DECLARED — an operator named this day with --day"
    : "COMPUTED — no --day was given; this is the most recent COMPLETE local " +
        "day by this host's clock, not a day anybody named";
}

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` for the local civil day containing `ms`. */
export function localDayOf(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The window for one local civil day.
 *
 * IT IS BUILT FROM LOCAL CALENDAR ARITHMETIC, not from `day * 86_400_000`. On a
 * DST boundary a civil day is 23 or 25 hours long, and a fold that assumed 24
 * would report an hour of records under the wrong date twice a year — quietly,
 * and only ever in the two weeks nobody is looking. The offset is carried out to
 * the report so a reader can see which calendar was used.
 */
export function windowForDay(day: string): ReportWindow | null {
  const match = DAY_PATTERN.exec(day);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const dayOfMonth = Number(match[3]);
  if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31) return null;
  const start = new Date(year, month - 1, dayOfMonth, 0, 0, 0, 0);
  // A round-trip catches 2026-02-30 and friends: `Date` rolls them forward
  // silently, and a rolled-forward day would fold the wrong calendar date.
  if (localDayOf(start.getTime()) !== day) return null;
  const end = new Date(year, month - 1, dayOfMonth + 1, 0, 0, 0, 0);
  return {
    day,
    startMs: start.getTime(),
    endMs: end.getTime(),
    offsetMinutes: -start.getTimezoneOffset(),
  };
}

/**
 * The default day: the most recent COMPLETE local day.
 *
 * A timer firing at 00:00 that folded "today" would report a day zero seconds
 * old and print seven zeros every morning. Yesterday is the last day that has
 * finished happening.
 */
export function previousLocalDay(nowMs: number): string {
  const now = new Date(nowMs);
  const yesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
    0,
    0,
    0,
    0
  );
  return localDayOf(yesterday.getTime());
}

// ── reading the store ────────────────────────────────────────────────────────

/**
 * The record FRAME this fold reads. Deliberately weaker than the witness's own
 * `validateRecord`: see the header. `witnessed` is carried as `unknown` and
 * narrowed only where a specific kind's fields are actually printed.
 */
export interface RecordFrame {
  readonly seq: number;
  readonly arrivalTs: number;
  readonly submitterId: string;
  readonly kind: string;
  readonly witnessed: unknown;
}

export type StoreLine =
  | { readonly state: "FRAME"; readonly lineNo: number; readonly frame: RecordFrame }
  | {
      readonly state: "UNPARSEABLE" | "NO_FRAME";
      readonly lineNo: number;
      readonly bytes: number;
      readonly detail: string;
    };

export interface StoreRead {
  readonly lines: readonly StoreLine[];
  readonly frames: readonly RecordFrame[];
  readonly unreadable: readonly StoreLine[];
  /** Lines that were empty. Counted, because a store full of them is a fact. */
  readonly blankLines: number;
}

function frameOf(value: unknown): RecordFrame | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.seq !== "number" || !Number.isFinite(v.seq)) return null;
  if (typeof v.arrivalTs !== "number" || !Number.isFinite(v.arrivalTs)) return null;
  if (typeof v.submitterId !== "string") return null;
  if (typeof v.kind !== "string" || v.kind.length === 0) return null;
  if (!("witnessed" in v)) return null;
  return {
    seq: v.seq,
    arrivalTs: v.arrivalTs,
    submitterId: v.submitterId,
    kind: v.kind,
    witnessed: v.witnessed,
  };
}

/** Split the raw store text into lines and read each one. Nothing is dropped. */
export function readStoreText(raw: string): StoreRead {
  const lines: StoreLine[] = [];
  const frames: RecordFrame[] = [];
  const unreadable: StoreLine[] = [];
  let blankLines = 0;
  const split = raw.split(/\r?\n/);
  if (split.length > 0 && split[split.length - 1] === "") split.pop();
  for (let i = 0; i < split.length; i++) {
    const lineNo = i + 1;
    const text = split[i];
    if (text.trim().length === 0) {
      blankLines++;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      const line: StoreLine = {
        state: "UNPARSEABLE",
        lineNo,
        bytes: Buffer.byteLength(text, "utf8"),
        detail: String(error),
      };
      lines.push(line);
      unreadable.push(line);
      continue;
    }
    const frame = frameOf(parsed);
    if (frame === null) {
      const line: StoreLine = {
        state: "NO_FRAME",
        lineNo,
        bytes: Buffer.byteLength(text, "utf8"),
        detail:
          "parsed as JSON but carries no record frame (seq, arrivalTs, " +
          "submitterId, kind, witnessed)",
      };
      lines.push(line);
      unreadable.push(line);
      continue;
    }
    const line: StoreLine = { state: "FRAME", lineNo, frame };
    lines.push(line);
    frames.push(frame);
  }
  return { lines, frames, unreadable, blankLines };
}

// ── the outbox ───────────────────────────────────────────────────────────────

const RECEIPT_PATTERN = /^receipt-(\d{12})\.json$/;

export type OutboxReading =
  | {
      readonly state: "OBSERVED";
      readonly receiptSeqs: ReadonlySet<number>;
      readonly fileCount: number;
      readonly unrecognisedNames: readonly string[];
    }
  | { readonly state: "READ_FAILED"; readonly reason: string };

/**
 * List the outbox. NAMES ONLY — nothing here opens a receipt.
 *
 * `witness.ts` writes `receipt-<record.seq padded to 12>.json`, where the seq is
 * the WITNESS RECORD's own sequence number, not the submitted commit's
 * `seq_no`. That makes symmetry an exact per-record question rather than a
 * count comparison, which is the whole reason this reading is worth taking.
 *
 * A REFUSAL IS RETAINED AS A REFUSAL. `READ_FAILED` never reads as "no
 * receipts": the difference between an empty outbox and an outbox this reader
 * cannot enter is the entire difference between a finding and a blind spot.
 */
export function readOutbox(dir: string): OutboxReading {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    return { state: "READ_FAILED", reason: String(error) };
  }
  const receiptSeqs = new Set<number>();
  const unrecognisedNames: string[] = [];
  for (const name of names.sort()) {
    const match = RECEIPT_PATTERN.exec(name);
    if (match === null) {
      unrecognisedNames.push(name);
      continue;
    }
    receiptSeqs.add(Number(match[1]));
  }
  return {
    state: "OBSERVED",
    receiptSeqs,
    fileCount: names.length,
    unrecognisedNames,
  };
}

// ── the fold ─────────────────────────────────────────────────────────────────

/**
 * The SEVEN kinds that record something that ARRIVED at the intake (five until
 * S105 added the two named shapes).
 *
 * PLACEMENT and KEY_UNAVAILABLE are the witness observing ITSELF — a start, and
 * a key it could not use. Counting them as arrivals would let a witness that
 * restarts hourly print a busy day on an intake nobody submitted to.
 *
 * A NEW WITNESSED KIND MUST BE JUDGED AGAINST THAT SENTENCE AND ADDED HERE OR
 * DELIBERATELY LEFT OUT. This list is not derivable from `WITNESSED_KINDS`: the
 * split is arrival-versus-self-observation, and nothing but a reading of the
 * kind can make it.
 */
export const ARRIVAL_KINDS: readonly string[] = [
  "HEAD_COMMIT",
  "MALFORMED_SUBMISSION",
  "UNDECLARED_SUBMITTER",
  "UNREADABLE_DROP",
  "UNDECLARED_MODALITY",
  "NAMED_HEAD_COMMIT",
  "NAMED_UNDECLARED_SUBMITTER",
];

/**
 * The kinds a RECEIPT is written for — the two shapes a declared submitter's
 * head commit can take (S105).
 *
 * Receipt symmetry is computed against exactly these. Leaving `NAMED_HEAD_COMMIT`
 * out would have made every receipt the named path writes an ORPHAN — "a receipt
 * file names a seq that is no HEAD_COMMIT" — and the daily report would have
 * shouted a fault at the operator on the first working day of the new shape.
 */
const RECEIPTED_KINDS: readonly string[] = ["HEAD_COMMIT", "NAMED_HEAD_COMMIT"];

export interface SeqBreak {
  readonly lineNo: number;
  readonly expected: number;
  readonly found: number;
  /**
   * Unreadable lines lying strictly between this frame and the previous one.
   *
   * A GAP THIS ACCOUNTS FOR IS NOT A MISSING RECORD. The first sample run
   * reported "1 BREAK IN THE NUMBERING" for a store whose only fault was one
   * corrupt line — the record was right there, unreadable, and the report
   * invited the reader to conclude something had been removed. Counting the
   * unreadable lines in the gap is the difference between "a line will not
   * parse" and "a record is gone", and those are not the same finding.
   */
  readonly unreadableBetween: number;
}

export interface UnreadableDropRow {
  readonly seq: number;
  readonly arrivalTs: number;
  readonly submitterId: string;
  readonly error: string;
  readonly size: string;
  readonly mode: string;
}

export interface KeyUnavailableRow {
  readonly seq: number;
  readonly arrivalTs: number;
  readonly submitterId: string;
  readonly keyPath: string;
  readonly detail: string;
}

export interface HeadCommitRow {
  readonly seq: number;
  readonly arrivalTs: number;
  readonly submitterId: string;
}

/**
 * The NEWEST head retained for one chain, ACROSS THE WHOLE STORE.
 *
 * ── WHY WHOLE-STORE AND NOT THE WINDOW `[LB]` ────────────────────────────────
 *
 *   The line exists because of S106 receipt §E.4: nothing in this tree holds an
 *   expectation that a chain's head SHOULD have arrived, so a chain that stops
 *   presenting is invisible. A window-scoped version would be worse than
 *   nothing — a chain silent since Tuesday has no record inside today's window,
 *   so it would vanish from today's report entirely, which is the exact silence
 *   the line is here to end. So it sits in §3, "the store as a whole", beside
 *   the other facts that are deliberately not about the day.
 *
 * ── AND IT IS A FACT, NOT A VERDICT ──────────────────────────────────────────
 *
 *   No threshold, no age judgment, no "late" or "stale". The reader compares it
 *   against an expectation this report does not hold and must not invent. The
 *   comparing instrument is DC-2, parked, and this is not it.
 */
export interface ChainLastSeenRow {
  readonly chainId: string;
  readonly seq: number;
  readonly arrivalTs: number;
  readonly kind: string;
  readonly submitterId: string;
}

export interface DayFold {
  readonly window: ReportWindow;
  /** Frames read across the WHOLE store, not the window. */
  readonly storeHeight: number;
  readonly blankLines: number;
  readonly unreadable: readonly StoreLine[];
  readonly seqBreaks: readonly SeqBreak[];
  readonly firstSeq: number | null;
  readonly lastFrame: RecordFrame | null;
  /** Counts for the window, by kind, as the kind was SPELLED in the store. */
  readonly countsByKind: ReadonlyMap<string, number>;
  /** Kinds seen anywhere in the store that `WITNESSED_KINDS` does not name. */
  readonly unknownKinds: readonly string[];
  readonly arrivalsInWindow: number;
  readonly unreadableDrops: readonly UnreadableDropRow[];
  readonly keyUnavailable: readonly KeyUnavailableRow[];
  readonly headCommits: readonly HeadCommitRow[];
  /**
   * Newest head per `chain_id`, whole store, sorted by chain id so two folds of
   * the same store render byte-identically.
   */
  readonly chainsLastSeen: readonly ChainLastSeenRow[];
  /**
   * The newest head, whole store, carried by a kind that names NO chain —
   * `HEAD_COMMIT`, `UNDECLARED_SUBMITTER`, `UNDECLARED_MODALITY`. Null when the
   * store holds none.
   *
   * These are not one chain and this row must never be read as one: they are
   * every nameless head there is, which before S105 was all of them. The row
   * says when the newest of them arrived and nothing about whose it was.
   */
  readonly unnamedHeadNewest: HeadCommitRow | null;
}

/** Kinds whose payload carries a `chain_id` (S105). */
const NAMED_HEAD_KINDS: readonly string[] = [
  "NAMED_HEAD_COMMIT",
  "NAMED_UNDECLARED_SUBMITTER",
];

/**
 * Kinds that carry a head and DO NOT name its chain. Not derivable from
 * `WITNESSED_KINDS` minus the named ones: `PLACEMENT`, `KEY_UNAVAILABLE` and
 * `MALFORMED_SUBMISSION` carry no head at all. The split is a reading of each
 * kind, which is why it is written out.
 */
const UNNAMED_HEAD_KINDS: readonly string[] = [
  "HEAD_COMMIT",
  "UNDECLARED_SUBMITTER",
  "UNDECLARED_MODALITY",
];

function readingText(value: unknown): string {
  if (typeof value !== "object" || value === null) return "NOT_PRESENT";
  const v = value as Record<string, unknown>;
  if (v.state === "OBSERVED") return `OBSERVED ${String(v.value)}`;
  if (typeof v.state === "string") return `${v.state} (${String(v.reason)})`;
  return "NOT_PRESENT";
}

function modeText(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    const v = value as Record<string, unknown>;
    if (v.state === "OBSERVED" && typeof v.value === "number") {
      return `OBSERVED 0${v.value.toString(8)}`;
    }
  }
  return readingText(value);
}

function field(witnessed: unknown, key: string): unknown {
  if (typeof witnessed !== "object" || witnessed === null) return undefined;
  return (witnessed as Record<string, unknown>)[key];
}

export function foldDay(read: StoreRead, window: ReportWindow): DayFold {
  const known = new Set<string>(WITNESSED_KINDS);
  const countsByKind = new Map<string, number>();
  const unknownKinds = new Set<string>();
  const seqBreaks: SeqBreak[] = [];
  const unreadableDrops: UnreadableDropRow[] = [];
  const keyUnavailable: KeyUnavailableRow[] = [];
  const headCommits: HeadCommitRow[] = [];
  // WHOLE-STORE, so they are accumulated ABOVE the window guard below. Same
  // single traversal: this adds two map writes per frame and no second pass.
  const chainsLastSeen = new Map<string, ChainLastSeenRow>();
  let unnamedHeadNewest: HeadCommitRow | null = null;
  let arrivalsInWindow = 0;
  let previous: RecordFrame | null = null;
  let previousLineNo = 0;

  for (const line of read.lines) {
    if (line.state !== "FRAME") continue;
    const frame = line.frame;
    if (!known.has(frame.kind)) unknownKinds.add(frame.kind);
    if (previous !== null && frame.seq !== previous.seq + 1) {
      let unreadableBetween = 0;
      for (const other of read.unreadable) {
        if (other.lineNo > previousLineNo && other.lineNo < line.lineNo) unreadableBetween++;
      }
      seqBreaks.push({
        lineNo: line.lineNo,
        expected: previous.seq + 1,
        found: frame.seq,
        unreadableBetween,
      });
    }
    previous = frame;
    previousLineNo = line.lineNo;

    // ── WHOLE-STORE FACTS. ABOVE THE WINDOW GUARD ON PURPOSE (S106b). ───────
    //
    //   "Newest" is LAST IN THE FILE, not largest arrivalTs. The store is
    //   append-only and its order is the order of arrival; taking a max over a
    //   clock would let one bad stamp on one frame pin a chain's last-seen line
    //   forever. Order is a fact this file already trusts everywhere else.
    if (NAMED_HEAD_KINDS.includes(frame.kind)) {
      const chainId = field(frame.witnessed, "chain_id");
      // A named kind whose payload has no readable chain_id cannot happen at a
      // v0.3 intake — `validateRecord` refuses it. But this fold reads FILES,
      // not an intake, so it reads what is there and says what it found.
      const named =
        typeof chainId === "string" && chainId.length > 0
          ? chainId
          : "(NAMED KIND WITH NO READABLE chain_id)";
      chainsLastSeen.set(named, {
        chainId: named,
        seq: frame.seq,
        arrivalTs: frame.arrivalTs,
        kind: frame.kind,
        submitterId: frame.submitterId,
      });
    }
    if (UNNAMED_HEAD_KINDS.includes(frame.kind)) {
      unnamedHeadNewest = {
        seq: frame.seq,
        arrivalTs: frame.arrivalTs,
        submitterId: frame.submitterId,
      };
    }

    if (frame.arrivalTs < window.startMs || frame.arrivalTs >= window.endMs) continue;
    countsByKind.set(frame.kind, (countsByKind.get(frame.kind) ?? 0) + 1);
    if (ARRIVAL_KINDS.includes(frame.kind)) arrivalsInWindow++;
    if (frame.kind === "UNREADABLE_DROP") {
      unreadableDrops.push({
        seq: frame.seq,
        arrivalTs: frame.arrivalTs,
        submitterId: frame.submitterId,
        error: String(field(frame.witnessed, "error") ?? "NOT_PRESENT"),
        size: readingText(field(frame.witnessed, "size")),
        mode: modeText(field(frame.witnessed, "mode")),
      });
    }
    if (frame.kind === "KEY_UNAVAILABLE") {
      const keyPath = field(frame.witnessed, "keyPath");
      keyUnavailable.push({
        seq: frame.seq,
        arrivalTs: frame.arrivalTs,
        submitterId: frame.submitterId,
        keyPath: keyPath === null || keyPath === undefined ? "none supplied" : String(keyPath),
        detail: String(field(frame.witnessed, "detail") ?? "NOT_PRESENT"),
      });
    }
    if (RECEIPTED_KINDS.includes(frame.kind)) {
      headCommits.push({
        seq: frame.seq,
        arrivalTs: frame.arrivalTs,
        submitterId: frame.submitterId,
      });
    }
  }
  return {
    window,
    storeHeight: read.frames.length,
    blankLines: read.blankLines,
    unreadable: read.unreadable,
    seqBreaks,
    firstSeq: read.frames.length === 0 ? null : read.frames[0].seq,
    lastFrame: read.frames.length === 0 ? null : read.frames[read.frames.length - 1],
    countsByKind,
    unknownKinds: [...unknownKinds].sort(),
    arrivalsInWindow,
    unreadableDrops,
    keyUnavailable,
    headCommits,
    chainsLastSeen: [...chainsLastSeen.values()].sort((a, b) =>
      a.chainId < b.chainId ? -1 : a.chainId > b.chainId ? 1 : 0
    ),
    unnamedHeadNewest,
  };
}

// ── receipt symmetry ─────────────────────────────────────────────────────────

export interface Symmetry {
  readonly matched: readonly number[];
  /** Missing, and a KEY_UNAVAILABLE record sits at seq+1 to say why. */
  readonly explained: readonly number[];
  /** Missing, and nothing in the store explains it. */
  readonly unexplained: readonly number[];
  /** Receipt files whose seq is no receipted head commit anywhere in the store. */
  readonly orphans: readonly number[];
}

/**
 * HEAD_COMMITs in the window against receipt FILENAMES in the outbox.
 *
 * S96 receipt §E.2: an absent signing key means arrivals are retained and
 * receipts are SILENTLY ABSENT — the daemon runs on, nothing fails, and the
 * only trace is a KEY_UNAVAILABLE record appended immediately after the
 * HEAD_COMMIT it belongs to. This is the surfacing point for that, so the
 * explanation is looked for at exactly that seq and nowhere else: a
 * KEY_UNAVAILABLE somewhere else in the day explains a different commit.
 */
export function checkSymmetry(
  fold: DayFold,
  read: StoreRead,
  outbox: OutboxReading
): Symmetry | null {
  if (outbox.state !== "OBSERVED") return null;
  const keyUnavailableSeqs = new Set<number>();
  for (const frame of read.frames) {
    if (frame.kind === "KEY_UNAVAILABLE") keyUnavailableSeqs.add(frame.seq);
  }
  const headSeqs = new Set<number>();
  for (const frame of read.frames) {
    if (RECEIPTED_KINDS.includes(frame.kind)) headSeqs.add(frame.seq);
  }
  const matched: number[] = [];
  const explained: number[] = [];
  const unexplained: number[] = [];
  for (const row of fold.headCommits) {
    if (outbox.receiptSeqs.has(row.seq)) {
      matched.push(row.seq);
    } else if (keyUnavailableSeqs.has(row.seq + 1)) {
      explained.push(row.seq);
    } else {
      unexplained.push(row.seq);
    }
  }
  const orphans: number[] = [];
  for (const seq of outbox.receiptSeqs) {
    if (!headSeqs.has(seq)) orphans.push(seq);
  }
  orphans.sort((a, b) => a - b);
  return { matched, explained, unexplained, orphans };
}

// ── Eng baseline observable (S107 Eng-baseline-capture brief) ────────────────
//
//   RECORD-ONLY. This module does not compute the statistic — computing it
//   means reading the MICA log, a file distinct from the witness store this
//   module is scoped to, and that read lives in `mica-report.ts` (the caller),
//   same as `storePath`/`outboxDir` are already just data here. This is a
//   plain shape to print what the caller found.
//
//   NO THRESHOLD IS CARRIED. DL-1 holds: nothing is graded in the clear. The
//   raw numbers exist for the doctor/arbiter to read at ratification; this
//   line emits no health signal, warn-never-stop, same register as §3.2's
//   per-chain last-seen line.
export interface EngObservableReading {
  /** Whether a `--log` path was even injected this run. */
  readonly attempted: boolean;
  readonly logPath: string | null;
  /** The log adapter's own load state, when one was constructed. */
  readonly loadState: string | null;
  readonly recordCount: number | null;
  /** Null exactly when the statistic was not computed (never for a degenerate
   *  table alone — `ami` itself may legitimately be null on a computed read). */
  readonly mutualInformation: number | null;
  readonly ami: number | null;
  readonly expectedMutualInformation: number | null;
  readonly entropyClass: number | null;
  readonly entropyOutcome: number | null;
  readonly distinctClasses: number | null;
  readonly distinctOutcomes: number | null;
  /** Always populated: why not computed, or the fact that it was. */
  readonly note: string;
}

/** The default when a caller supplies no reading at all — never a silent gap. */
export const ENG_NOT_ATTEMPTED: EngObservableReading = {
  attempted: false,
  logPath: null,
  loadState: null,
  recordCount: null,
  mutualInformation: null,
  ami: null,
  expectedMutualInformation: null,
  entropyClass: null,
  entropyOutcome: null,
  distinctClasses: null,
  distinctOutcomes: null,
  note: "NOT ATTEMPTED — no --log was supplied to this run.",
};

// ── rendering ────────────────────────────────────────────────────────────────

export interface RenderInput {
  readonly fold: DayFold;
  readonly read: StoreRead;
  readonly outbox: OutboxReading;
  readonly symmetry: Symmetry | null;
  readonly storePath: string;
  readonly outboxDir: string;
  /**
   * Optional so every existing caller (all of `witness-report.test.ts`,
   * `mica-report.ts` before this build) keeps compiling unchanged. Absent
   * reads as `ENG_NOT_ATTEMPTED` — "never self-attested" applies to the gap
   * itself: an omitted field must still print as a stated fact, not vanish.
   */
  readonly engObservable?: EngObservableReading;
  /**
   * DC-2, S108. Optional for the same reason `engObservable` is: every
   * existing caller keeps compiling. Absent reads as an ABSENT declaration —
   * CANNOT_ASSESS for the whole section, computed fresh against THIS input's
   * own `fold.chainsLastSeen` rather than carrying a stale one from elsewhere.
   */
  readonly staleness?: StalenessReading;
  /**
   * S109-B item 3. Optional for the same reason `staleness` is: every
   * existing caller keeps compiling. Absent reads as CLERK_CALLER_NOT_WIRED
   * (state CALLER_ABSENT) — negative-only vocabulary, never a default that
   * fills the gap in code.
   */
  readonly callerReading?: ClerkCallerReading;
  /**
   * S110-B. Optional, same reason as `callerReading`: every existing caller
   * keeps compiling. Absent reads as CANNOT_ASSESS on both sides ("no
   * --registrar-log/--log was supplied") — never a default guess at either
   * file's location.
   */
  readonly journalBookReconciliation?: ReconciliationReading;
  /** S110-B, Pair B. Same optionality; absent reads as CANNOT_ASSESS both sides. */
  readonly stampShapeReconciliation?: ReconciliationReading;
  /**
   * S111, generalized — the pair family: any declared principal's own
   * deposit journal against the registrar's chain, by uid. Same optionality
   * as `staleness`/`journalDeclaration`'s cadence counterpart; absent reads
   * as an ABSENT declaration, CANNOT_ASSESS for the whole family, never a
   * default that invents a principal (R-V3).
   */
  readonly journalDeclaration?: JournalDeclaration;
  /** One reading per declared principal, computed by the caller from
   * `journalDeclaration`. Absent (or the declaration not CONFIGURED) means
   * no principal to render — the CANNOT_ASSESS is on the declaration itself. */
  readonly principalJournalReconciliations?: readonly PrincipalJournalReconciliation[];
  /**
   * S112, DF (§3.7). Optional, same reason as `staleness`: every existing
   * caller keeps compiling. Absent reads as an ABSENT declaration —
   * CANNOT_ASSESS for the whole section, R8: never a default that invents a
   * fact.
   */
  readonly deploymentFacts?: DeploymentFactsReading;
  /** The clock read once, at the start of the run, and printed as read. */
  readonly nowMs: number;
  /** Whether an operator named the day, or this host's clock supplied it. */
  readonly dayProvenance: DayProvenance;
}

/** The staleness reading a caller gets when it supplies none. */
function defaultStaleness(fold: DayFold, nowMs: number): StalenessReading {
  return assessStaleness(ABSENT_CADENCE_DECLARATION, fold.chainsLastSeen, nowMs);
}

/** The deployment-facts reading a caller gets when it supplies none (S112, DF). */
function defaultDeploymentFacts(): DeploymentFactsReading {
  return assessDeploymentFacts(ABSENT_DEPLOYMENT_FACTS_DECLARATION);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function offsetText(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Hours, one decimal, with the sign of a clock that has gone backwards kept. */
export function ageText(nowMs: number, thenMs: number): string {
  const hours = (nowMs - thenMs) / 3_600_000;
  return `${hours.toFixed(1)} h`;
}

const RULE = "─".repeat(78);


// ── the machine-readable fold — one source with the prose, never a second ────
//
// S103-C's news-list is W5 WITH A FACE: a future read-only UI consumes THIS,
// never the stores. So the record is built from the SAME `RenderInput` the
// markdown is rendered from. A second traversal of the fold would be a second
// opinion about the same day, and the morning they disagreed the argument would
// be about which artifact to believe.
//
// EVERY LINE IS A FACT WITH A CATEGORY AND A COUNT. There is no summary line,
// no status field, no severity, and nothing derived by comparison against a
// threshold — there are no thresholds. A consumer that wants a headline must
// compose one itself and own it.
//
// A ZERO IS WRITTEN. All seven witnessed kinds emit a COUNT line every day,
// including the days they are zero, because a category that disappears when it
// is empty cannot be distinguished by a reader from a category nobody counted.

export type ReportRecord = Readonly<Record<string, unknown>>;

export function reportRecords(input: RenderInput): readonly ReportRecord[] {
  const { fold, read, outbox, symmetry, nowMs } = input;
  const w = fold.window;
  const out: ReportRecord[] = [];

  out.push({
    category: "WINDOW",
    day: w.day,
    startMs: w.startMs,
    endMs: w.endMs,
    offsetMinutes: w.offsetMinutes,
    dayProvenance: input.dayProvenance,
    foldedAtMs: nowMs,
  });

  out.push({
    category: "SOURCE",
    storePath: input.storePath,
    outboxDir: input.outboxDir,
    storeLines: read.lines.length,
    framesRead: read.frames.length,
    blankLines: read.blankLines,
    unreadableLines: read.unreadable.length,
    storeHeight: fold.storeHeight,
    firstSeq: fold.firstSeq,
    lastRecordArrivalTs: fold.lastFrame === null ? null : fold.lastFrame.arrivalTs,
  });

  // ── PER-CHAIN LAST-SEEN (S106b). Whole store, one row per chain. ──────────
  //
  //   A COUNT OF ZERO IS WRITTEN as its own row, the same way the kind counts
  //   write their zeros: a category that disappears when it is empty cannot be
  //   told by a reader from a category nobody counted. So a store with no named
  //   heads emits `namedChains: 0` rather than an absence of rows.
  out.push({
    category: "CHAIN_SUMMARY",
    namedChains: fold.chainsLastSeen.length,
    unnamedHeadRetained: fold.unnamedHeadNewest !== null,
  });
  for (const row of fold.chainsLastSeen) {
    out.push({
      category: "CHAIN_LAST_SEEN",
      chainId: row.chainId,
      newestSeq: row.seq,
      newestArrivalTs: row.arrivalTs,
      kind: row.kind,
      submitterId: row.submitterId,
    });
  }
  if (fold.unnamedHeadNewest !== null) {
    out.push({
      category: "UNNAMED_CHAIN_HEADS",
      newestSeq: fold.unnamedHeadNewest.seq,
      newestArrivalTs: fold.unnamedHeadNewest.arrivalTs,
      submitterId: fold.unnamedHeadNewest.submitterId,
    });
  }

  // ── ENG BASELINE OBSERVABLE (S107). RECORD-ONLY — see EngObservableReading. ─
  {
    const eng = input.engObservable ?? ENG_NOT_ATTEMPTED;
    out.push(
      eng.mutualInformation === null
        ? {
            category: "ENG_OBSERVABLE",
            state: eng.attempted ? "NOT_COMPUTED" : "NOT_ATTEMPTED",
            logPath: eng.logPath,
            loadState: eng.loadState,
            note: eng.note,
          }
        : {
            category: "ENG_OBSERVABLE",
            state: "COMPUTED",
            logPath: eng.logPath,
            loadState: eng.loadState,
            recordCount: eng.recordCount,
            mutualInformation: eng.mutualInformation,
            ami: eng.ami,
            expectedMutualInformation: eng.expectedMutualInformation,
            entropyClass: eng.entropyClass,
            entropyOutcome: eng.entropyOutcome,
            distinctClasses: eng.distinctClasses,
            distinctOutcomes: eng.distinctOutcomes,
          }
    );
  }

  // ── STALENESS ALARM (DC-2, S108). Negative-only — see staleness-alarm.ts. ──
  {
    const st = input.staleness ?? defaultStaleness(fold, nowMs);
    out.push({
      category: "STALENESS_DECLARATION",
      state: st.declaration.state,
      source: st.declaration.source,
      declaredChainCount: st.declaration.cadenceDaysByChain.size,
      problems: st.declaration.problems,
    });
    // A ZERO IS WRITTEN, same discipline as the rest of this record — a
    // count that vanishes when it is zero cannot be told from a count
    // nobody took. NONE of these four numbers is a per-chain claim.
    out.push({
      category: "STALENESS_SUMMARY",
      staleCount: st.staleCount,
      cannotAssessCount: st.cannotAssessCount,
      undeclaredCount: st.undeclaredCount,
      assessedFreshCount: st.assessedFreshCount,
    });
    // STALE and CANNOT_ASSESS rows ONLY. A fresh declared chain earns no row
    // here, ever — it is folded into STALENESS_SUMMARY.assessedFreshCount
    // above and nowhere else.
    for (const v of st.verdicts) {
      out.push({
        category: "STALENESS_ALARM",
        chainId: v.chainId,
        state: v.state,
        reason: v.reason,
        declaredMaxAgeDays: v.declaredMaxAgeDays,
        newestSeq: v.newestSeq,
        newestArrivalTs: v.newestArrivalTs,
        ageHours: v.ageHours,
      });
    }
    // Visible, never graded — the declaration's membership is the arbiter's.
    for (const chainId of st.undeclaredChains) {
      out.push({ category: "STALENESS_UNDECLARED", chainId });
    }
  }

  // ── CLERK-CALLER ATTESTATION (item 3, S109-B). Negative-only — see
  //    clerk-caller-attestation.ts. A ZERO/STAMPS_PRESENT count is written
  //    always; only CALLER_ABSENT / NO_STAMPED_RECORDS are named states.
  {
    const cr = input.callerReading ?? CLERK_CALLER_NOT_WIRED;
    out.push({
      category: "CLERK_CALLER_ATTESTATION",
      state: cr.state,
      source: cr.source,
      reason: cr.reason,
      stampedRecordCount: cr.stampedRecordCount,
    });
  }

  // ── RECONCILIATION (S110-B). Negative-only — see reconciliation.ts. A
  //    named row (a divergence name, or CANNOT_ASSESS) ONLY when there is
  //    something to name; agreement is the two counts and nothing else —
  //    never a positive word, never omitted (a count that vanishes when it
  //    agrees cannot be told from a count nobody took).
  for (const [category, reading] of [
    ["JOURNAL_BOOK_RECONCILIATION", input.journalBookReconciliation ?? assessJournalBookReconciliation(null, null)],
    ["STAMP_SHAPE_RECONCILIATION", input.stampShapeReconciliation ?? assessStampShapeReconciliation(null)],
  ] as const) {
    out.push({
      category,
      state: reading.state,
      labelA: reading.labelA,
      labelB: reading.labelB,
      countA: reading.countA,
      countB: reading.countB,
      delta: reading.delta,
      reason: reading.reason,
    });
  }

  // ── PRINCIPAL JOURNAL RECONCILIATION FAMILY (S111, generalized). One row ──
  //    naming the declaration's own state (mirrors STALENESS_DECLARATION),
  //    then one row per declared principal — ALWAYS emitted, agreement
  //    included, same discipline as the two pairs above (a count that
  //    vanishes when it agrees cannot be told from a count nobody took).
  {
    const decl = input.journalDeclaration ?? ABSENT_JOURNAL_DECLARATION;
    out.push({
      category: "PRINCIPAL_JOURNAL_DECLARATION",
      state: decl.state,
      source: decl.source,
      declaredPrincipalCount: decl.uidByPrincipal.size,
      problems: decl.problems,
    });
    for (const { principal, uid, reading } of input.principalJournalReconciliations ?? []) {
      out.push({
        category: "PRINCIPAL_JOURNAL_RECONCILIATION",
        principal,
        uid,
        state: reading.state,
        labelA: reading.labelA,
        labelB: reading.labelB,
        countA: reading.countA,
        countB: reading.countB,
        delta: reading.delta,
        reason: reading.reason,
      });
    }
  }

  // ── DEPLOYMENT FACTS (S112, DF, §3.7). Negative-only — see
  //    deployment-facts.ts. Record and prose from the same fold (the S111-B
  //    paragraph-E lesson): the declaration's own state, then a bare header
  //    count, then FACT_ABSENT/CANNOT_ASSESS rows ONLY — a HELD fact is
  //    folded into the count above and never gets its own row here either.
  {
    const df = input.deploymentFacts ?? defaultDeploymentFacts();
    out.push({
      category: "DEPLOYMENT_FACTS_DECLARATION",
      state: df.declaration.state,
      source: df.declaration.source,
      declaredFactCount: df.declaration.facts.length,
      problems: df.declaration.problems,
    });
    out.push({
      category: "DEPLOYMENT_FACTS_SUMMARY",
      heldCount: df.heldCount,
      factAbsentCount: df.factAbsentCount,
      cannotAssessCount: df.cannotAssessCount,
      undeclaredFamilies: df.undeclaredFamilies,
    });
    for (const f of df.findings) {
      out.push({ category: "DEPLOYMENT_FACTS_FINDING", id: f.id, family: f.family, state: f.state, reason: f.reason });
    }
  }

  // ── ITEM-4 HONEST LIMIT (Tier-1 card), S108 rider 1. Fixed text, always. ──
  out.push({ category: "HONEST_LIMIT", text: HONEST_LIMIT_TEXT });

  // The seven, always, zeros included — then anything the seven do not name.
  for (const kind of WITNESSED_KINDS) {
    out.push({ category: "COUNT", kind, inWindow: fold.countsByKind.get(kind) ?? 0 });
  }
  for (const kind of fold.unknownKinds) {
    out.push({
      category: "COUNT",
      kind,
      inWindow: fold.countsByKind.get(kind) ?? 0,
      namedByWitnessedKinds: false,
    });
  }
  out.push({ category: "COUNT", kind: "ARRIVALS_IN_WINDOW", inWindow: fold.arrivalsInWindow });

  // The drop the witness recorded and could not read. S86 ruled it surfaces
  // here and nowhere else; it is a category of its own, counted even at zero.
  out.push({ category: "COUNT", kind: "UNREADABLE_DROP_ROWS", inWindow: fold.unreadableDrops.length });
  for (const d of fold.unreadableDrops) {
    out.push({
      category: "UNREADABLE_DROP",
      seq: d.seq,
      arrivalTs: d.arrivalTs,
      submitterId: d.submitterId,
      error: d.error,
      size: d.size,
      mode: d.mode,
    });
  }

  for (const k of fold.keyUnavailable) {
    out.push({
      category: "KEY_UNAVAILABLE",
      seq: k.seq,
      arrivalTs: k.arrivalTs,
      submitterId: k.submitterId,
      keyPath: k.keyPath,
      detail: k.detail,
    });
  }

  for (const line of read.unreadable) {
    out.push({
      category: "UNREADABLE_LINE",
      lineNo: line.lineNo,
      state: line.state,
      bytes: line.state === "FRAME" ? null : line.bytes,
      detail: line.state === "FRAME" ? null : line.detail,
    });
  }

  for (const b of fold.seqBreaks) {
    out.push({
      category: "SEQ_BREAK",
      lineNo: b.lineNo,
      expected: b.expected,
      found: b.found,
      unreadableBetween: b.unreadableBetween,
    });
  }

  // OBSERVED vs READ_FAILED, never a zero standing in for "could not look".
  out.push(
    outbox.state === "OBSERVED"
      ? {
          category: "OUTBOX",
          state: "OBSERVED",
          receiptCount: outbox.receiptSeqs.size,
          fileCount: outbox.fileCount,
          unrecognisedNames: outbox.unrecognisedNames.length,
        }
      : { category: "OUTBOX", state: "READ_FAILED", reason: outbox.reason }
  );

  // Withheld is a state, not a zero: a symmetry nobody could compute must not
  // arrive as a computed one.
  // WITHHELD is a state, not a zero: a symmetry nobody could compute must not
  // arrive looking like one that came out even.
  out.push(
    symmetry === null
      ? { category: "SYMMETRY", state: "WITHHELD" }
      : {
          category: "SYMMETRY",
          state: "COMPUTED",
          matched: symmetry.matched.length,
          explained: symmetry.explained.length,
          unexplained: symmetry.unexplained.length,
          orphans: symmetry.orphans.length,
        }
  );

  return out;
}

/** The record as a file: one JSON object per line, newline-terminated. */
export function renderRecordsJsonl(records: readonly ReportRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

export function renderReport(input: RenderInput): string {
  const { fold, read, outbox, symmetry, nowMs } = input;
  const w = fold.window;
  const out: string[] = [];
  const say = (line = ""): void => {
    out.push(line);
  };

  say(`# MICA witness — daily report · ${w.day}`);
  say();
  say(`WINDOW PROVENANCE: ${dayProvenanceText(input.dayProvenance)}.`);
  say();
  say(REPORT_TITLE);
  say();
  say(`- generated : ${iso(nowMs)} (epoch ms ${nowMs})`);
  say(`- produced by: src/report/mica-report.ts — C6/W5`);
  say(`- store     : ${input.storePath}`);
  say(`- outbox    : ${input.outboxDir}`);
  say(
    `- window    : ${w.day} 00:00 → next day 00:00, local calendar (${offsetText(
      w.offsetMinutes
    )})`
  );
  say(`- epoch ms  : [${w.startMs}, ${w.endMs})  = ${iso(w.startMs)} → ${iso(w.endMs)}`);
  say(
    `- window length: ${((w.endMs - w.startMs) / 3_600_000).toFixed(0)} h ` +
      `(a civil day is 23 or 25 hours across a DST change; this is the local calendar's answer)`
  );
  say();
  say(RULE);

  // ── THE LOUD SECTION, FIRST. It is first because it is the reason C6 exists.
  say();
  say("## 1 · THE LOUD SECTION — what this day's records refuse to leave quiet");
  say();
  say("### 1.1 · UNREADABLE_DROP — a drop the witness was not permitted to read");
  say();
  if (fold.unreadableDrops.length === 0) {
    say(
      "None recorded inside this window. That is a statement about RECORDS: a drop " +
        "that never reached the intake at all leaves no trace here, and this fold " +
        "cannot see the intake (readers may not list it)."
    );
  } else {
    say(
      `${fold.unreadableDrops.length} recorded. Each one is a submission that arrived ` +
        "and could not be read. The mode is printed as the octal the witness observed — " +
        "a 0600 drop is reported AS a 0600 drop, and no hash is claimed for any of them, " +
        "because no bytes were read."
    );
    say();
    say("| seq | arrival (UTC) | presented submitter | size | mode | OS error |");
    say("|---|---|---|---|---|---|");
    for (const row of fold.unreadableDrops) {
      say(
        `| ${row.seq} | ${iso(row.arrivalTs)} | \`${row.submitterId}\` | ${row.size} | ` +
          `${row.mode} | ${row.error.replace(/\|/g, "\\|")} |`
      );
    }
  }
  say();
  say("### 1.2 · KEY_UNAVAILABLE — arrivals retained, receipts silently absent");
  say();
  if (fold.keyUnavailable.length === 0) {
    say("None recorded inside this window.");
  } else {
    say(
      `${fold.keyUnavailable.length} recorded. The arrival WAS retained in every case. ` +
        "What is missing is the receipt: the witness could not sign, wrote no receipt " +
        "file, and returned nothing to the submitter. From outside, that is silence."
    );
    say();
    say("| seq | arrival (UTC) | submitter | key path | detail |");
    say("|---|---|---|---|---|");
    for (const row of fold.keyUnavailable) {
      say(
        `| ${row.seq} | ${iso(row.arrivalTs)} | \`${row.submitterId}\` | ` +
          `${row.keyPath} | ${row.detail.replace(/\|/g, "\\|")} |`
      );
    }
  }
  say();
  say("### 1.3 · Lines this fold could not read");
  say();
  if (fold.unreadable.length === 0) {
    say("None. Every non-blank line in the store carried a record frame.");
  } else {
    say(
      `${fold.unreadable.length} line(s). THEY ARE NOT SKIPPED AND THEY ARE NOT FATAL HERE — ` +
        "this fold reports each one and reads on, because a fold that stopped at the " +
        "first bad line would report a day it never read, and would report it as quiet."
    );
    say();
    say("| line | bytes | what happened |");
    say("|---|---|---|");
    for (const line of fold.unreadable) {
      if (line.state === "FRAME") continue;
      say(`| ${line.lineNo} | ${line.bytes} | ${line.detail.replace(/\|/g, "\\|")} |`);
    }
    say();
    say(
      "**AND THE CONSEQUENCE IS LARGER THAN THIS REPORT.** The witness's own loader " +
        "stops at the FIRST such line and marks the store non-appendable; every later " +
        "append then throws `witness store is not appendable`, and `witnessd` exits 3. " +
        "A store with an unreadable line at line " +
        String(fold.unreadable[0].lineNo) +
        " is a store nothing can be added to."
    );
  }
  say();
  say(RULE);

  // ── counts for the day
  say();
  say("## 2 · Counts for the day");
  say();
  const kindRows = [...WITNESSED_KINDS].map((kind) => [kind, fold.countsByKind.get(kind) ?? 0] as const);
  const extraRows = fold.unknownKinds.map(
    (kind) => [`${kind}  ← NOT ONE OF THE DECLARED KINDS`, fold.countsByKind.get(kind) ?? 0] as const
  );
  say("| kind | records in window |");
  say("|---|---|");
  for (const [kind, n] of [...kindRows, ...extraRows]) say(`| ${kind} | ${n} |`);
  say();
  say(
    `**Arrivals in the window: ${fold.arrivalsInWindow}.** An arrival is one of the five ` +
      "kinds that record something presented at the intake (" +
      ARRIVAL_KINDS.join(", ") +
      "). PLACEMENT and KEY_UNAVAILABLE are the witness observing itself and are counted " +
      "separately above — a witness that restarted twenty times would otherwise print a busy day."
  );
  if (fold.unknownKinds.length > 0) {
    say();
    say(
      "**KINDS THIS FOLD DOES NOT KNOW: " +
        fold.unknownKinds.map((k) => `\`${k}\``).join(", ") +
        ".** They are counted and named rather than dropped. The seven names come from " +
        "`src/witness/types.ts` (`WITNESSED_KINDS`), imported, not copied; a kind outside " +
        "that list means the store holds something this reader was not built to describe."
    );
  }
  if (fold.arrivalsInWindow === 0) {
    say();
    const age =
      fold.lastFrame === null
        ? "no record in the store at all"
        : ageText(nowMs, fold.lastFrame.arrivalTs);
    say(`**${quietDaySentence(age)}**`);
    say();
    say(
      "This sentence is printed whenever the count is zero and it is not softened. " +
        "Quiet is the reading a stopped witness and an idle one produce in common, and " +
        "this report cannot tell them apart — nothing here asks the witness anything."
    );
  }
  say();
  say(RULE);

  // ── the store as a whole
  say();
  say("## 3 · The store as a whole (not the window)");
  say();
  say(`- record frames read : ${fold.storeHeight}`);
  say(`- blank lines        : ${fold.blankLines}`);
  say(`- unreadable lines   : ${fold.unreadable.length}`);
  if (fold.lastFrame === null) {
    say("- last record        : NONE. The store holds no readable record.");
  } else {
    say(
      `- last record        : seq ${fold.lastFrame.seq}, kind ${fold.lastFrame.kind}, ` +
        `arrival ${iso(fold.lastFrame.arrivalTs)}`
    );
    say(`- last-record age    : ${ageText(nowMs, fold.lastFrame.arrivalTs)}`);
  }
  say();
  say(`**${REPORT_IS_NOT_A_LIVENESS_CLAIM}**`);
  say();
  say("### 3.1 · Sequence continuity — arithmetic, not cryptography");
  say();
  if (fold.storeHeight === 0) {
    say("No frames to number.");
  } else if (fold.firstSeq !== 0) {
    say(
      `**THE FIRST READABLE RECORD IS seq ${String(fold.firstSeq)}, NOT 0.** The store's ` +
        "head is not in this file."
    );
  } else if (fold.seqBreaks.length === 0) {
    say(
      `Frames run 0 … ${fold.storeHeight - 1} with no gap and no repeat. This is counting, ` +
        "and it is stated so the height above is not an unchecked number. It is NOT a hash " +
        "check: this fold computes no digests and makes no claim about whether the chain links."
    );
  } else {
    say(
      `**${fold.seqBreaks.length} BREAK(S) IN THE NUMBERING.** The height above is therefore ` +
        "not a count of an unbroken book."
    );
    say();
    say("| at line | expected seq | found seq | unreadable lines in the gap |");
    say("|---|---|---|---|");
    for (const b of fold.seqBreaks) {
      const accounted =
        b.unreadableBetween > 0 && b.unreadableBetween === b.found - b.expected
          ? `${b.unreadableBetween} — the gap is exactly this; no record is missing, ` +
            "one will not parse"
          : b.unreadableBetween === 0
            ? "0 — NOTHING IN THIS FILE ACCOUNTS FOR THE GAP"
            : `${b.unreadableBetween} — fewer than the gap; ` +
              `${b.found - b.expected - b.unreadableBetween} record(s) are unaccounted for`;
      say(`| ${b.lineNo} | ${b.expected} | ${b.found} | ${accounted} |`);
    }
  }
  say();
  say(RULE);

  // ── receipt symmetry
  say();
  say("### 3.2 · The newest head retained for each chain");
  say();
  say(
    "Facts, not verdicts. No threshold is applied and no age is judged: this fold " +
      "holds no expectation about how often any chain should present a head, and a " +
      "reader who has one owns the comparison. **A chain that stopped presenting " +
      "looks exactly like a chain nobody appended to, and nothing in this report " +
      "can tell them apart.**"
  );
  say();
  if (fold.chainsLastSeen.length === 0) {
    // A ZERO IS A STATEMENT. Printing nothing here would let a reader take the
    // absence of the table for the absence of the question.
    say("- no named-chain heads retained");
  } else {
    say("| chain_id | newest head at seq | arrival | kind | submitter |");
    say("|---|---|---|---|---|");
    for (const row of fold.chainsLastSeen) {
      say(
        `| ${row.chainId} | ${String(row.seq)} | ${iso(row.arrivalTs)} | ` +
          `${row.kind} | ${row.submitterId} |`
      );
    }
  }
  say();
  if (fold.unnamedHeadNewest === null) {
    say(
      "- unnamed-chain heads (HEAD_COMMIT / UNDECLARED_SUBMITTER / " +
        "UNDECLARED_MODALITY): none retained"
    );
  } else {
    say(
      "- unnamed-chain heads (HEAD_COMMIT / UNDECLARED_SUBMITTER / " +
        `UNDECLARED_MODALITY): newest at seq ${String(fold.unnamedHeadNewest.seq)}, ` +
        `arrival ${iso(fold.unnamedHeadNewest.arrivalTs)}, submitter ` +
        `${fold.unnamedHeadNewest.submitterId}`
    );
    say(
      "  **These are not one chain.** They are every head that names none, so " +
        "this row says when the newest of them arrived and nothing about whose " +
        "chain it was."
    );
  }
  say();
  say(RULE);

  // ── ENG BASELINE OBSERVABLE (S107) ────────────────────────────────────────
  say();
  say("### 3.3 · Eng baseline observable (record-only)");
  say();
  say(
    "**RECORD-ONLY.** No threshold is compared here and none is carried by this " +
      "line — DL-1 holds, nothing is graded in the clear. The raw statistic is " +
      "folded into the record for the doctor/arbiter to read at ratification; " +
      "this report emits no health signal from it. Same register as §3.2: " +
      "warn-never-stop, best-effort, failure locally visible, never self-attested."
  );
  say();
  {
    const eng = input.engObservable ?? ENG_NOT_ATTEMPTED;
    if (eng.mutualInformation === null) {
      say(`- ${eng.note}`);
    } else {
      say(`- log path                     : ${String(eng.logPath)}`);
      say(`- log load state               : ${String(eng.loadState)}`);
      say(`- records read                 : ${String(eng.recordCount)}`);
      say(`- mutual information (plug-in) : ${eng.mutualInformation.toFixed(6)}`);
      say(
        `- adjusted mutual information  : ${eng.ami === null ? "null (degenerate table)" : eng.ami.toFixed(6)}`
      );
      say(
        `- expected mutual information  : ${(eng.expectedMutualInformation ?? NaN).toFixed(6)}`
      );
      say(`- entropy (event class)        : ${(eng.entropyClass ?? NaN).toFixed(6)}`);
      say(`- entropy (outcome)            : ${(eng.entropyOutcome ?? NaN).toFixed(6)}`);
      say(`- distinct event classes       : ${String(eng.distinctClasses)}`);
      say(`- distinct outcomes            : ${String(eng.distinctOutcomes)}`);
      say(`- ${eng.note}`);
    }
  }
  say();

  // ── STALENESS ALARM (DC-2, S108) ──────────────────────────────────────────
  say("### 3.4 · Staleness alarm — DC-2 (comparison, not a fact)");
  say();
  say(
    "Unlike §3.2, this line HOLDS AN EXPECTATION — a declared cadence, per " +
      "chain, that someone wrote down. The observed system never self-attests " +
      "its own connectivity (ruling-B boundary, S106): the witness side holds " +
      "the expectation and this section is where it is compared. **Negative-" +
      "only: the only words this section prints are STALE and CANNOT_ASSESS. " +
      "It prints only STALE or CANNOT_ASSESS about any one chain — no third " +
      "word exists here.**"
  );
  say();
  {
    const st = input.staleness ?? defaultStaleness(fold, nowMs);
    if (st.declaration.state !== "CONFIGURED") {
      const why =
        st.declaration.state === "ABSENT"
          ? "no cadence declaration file was supplied to this run (`--cadence-file`)"
          : `the declared cadence file (${st.declaration.source}) did not yield a usable ` +
            "declaration" +
            (st.declaration.problems.length === 0
              ? ""
              : `: ${st.declaration.problems.join("; ")}`);
      say(
        `**CANNOT_ASSESS — the whole section.** ${why}. **This is stated plainly, ` +
          "never defaulted in code:** R8 forbids this program from inventing a " +
          "cadence, so an undeclared expectation is a gap this report NAMES, not " +
          "one it fills."
      );
    } else {
      say(
        `- declared chains: ${st.declaration.cadenceDaysByChain.size} · stale: ` +
          `${st.staleCount} · cannot-assess: ${st.cannotAssessCount} · assessed and ` +
          `not stale: ${st.assessedFreshCount} (a count, not a verdict on any one chain) ` +
          `· undeclared (visible, not graded): ${st.undeclaredCount}`
      );
      say();
      if (st.verdicts.length === 0) {
        say("- no STALE or CANNOT_ASSESS chain this run");
      } else {
        say("| chain_id | state | declared max age | newest head | age | reason |");
        say("|---|---|---|---|---|---|");
        for (const v of st.verdicts) {
          const newest =
            v.newestSeq === null
              ? "—"
              : `seq ${v.newestSeq}, ${iso(v.newestArrivalTs as number)}`;
          const age = v.ageHours === null ? "—" : `${v.ageHours.toFixed(1)} h`;
          say(
            `| ${v.chainId} | **${v.state}** | ${v.declaredMaxAgeDays} d | ${newest} | ` +
              `${age} | ${v.reason.replace(/\|/g, "\\|")} |`
          );
        }
      }
      say();
      if (st.undeclaredChains.length === 0) {
        say("- no UNDECLARED chains (every named chain the store holds is in the declaration)");
      } else {
        say(
          "- **UNDECLARED** (in the store, not in the declaration — visible, not graded; " +
            "membership is the arbiter's, not inferred): " +
            st.undeclaredChains.map((id) => `\`${id}\``).join(", ")
        );
      }
    }
  }
  say();

  // ── CLERK-CALLER ATTESTATION (item 3, S109-B) ─────────────────────────────
  say("### 3.5 · Clerk-caller attestation — item 3 (S109-B)");
  say();
  say(
    "`mica-clerk-caller.ts` (the item-2 arm) can fail silently in every way a " +
      "scheduled program can: never installed, never scheduled, wedged behind a " +
      "dead clerk socket. This line reads FOR that absence instead of trusting " +
      "the last good word. **Negative-only, same fence as §3.4: the only named " +
      "states are CALLER_ABSENT and NO_STAMPED_RECORDS.** A stamps file holding " +
      "records earns a COUNT here, never a claim that the caller is running, in " +
      "good order, or current — \"records flowing therefore fine\" is not a " +
      "sentence this section is allowed to write."
  );
  say();
  {
    const cr = input.callerReading ?? CLERK_CALLER_NOT_WIRED;
    if (cr.state === "CALLER_ABSENT") {
      say(`**CALLER_ABSENT.** ${cr.reason}`);
    } else if (cr.state === "CANNOT_ASSESS") {
      say(`**CANNOT_ASSESS.** ${cr.reason}`);
    } else if (cr.state === "NO_STAMPED_RECORDS") {
      say(`**NO_STAMPED_RECORDS.** ${cr.reason}`);
    } else {
      say(`- stamped record count: ${String(cr.stampedRecordCount)} (a count, not a health claim)`);
      say(`- source: ${cr.source}`);
    }
  }
  say();

  // ── RECONCILIATION — S110-B / S111 generalized ────────────────────────────
  say("### 3.6 · Reconciliation — S110-B, pair family generalized S111");
  say();
  say(
    "One mechanism, two independently-found gaps: an outcome the registrar " +
      "recorded while its journal leg was failing is recorded forever and " +
      "journaled never unless something compares the two books (S110 " +
      "deployment findings, F-2); the daily attestation above counts " +
      "parseable JSON lines and never checks whether they are a valid " +
      "`ClerkClockStamp` (S109 receipt §E). **Negative-only, same fence as " +
      "every section above: the only named outcomes are a divergence (with " +
      "both counts and the delta) or CANNOT_ASSESS. Two counts that agree " +
      "earn exactly that — a count — and never the word \"in sync\"; that " +
      "word is not in this section's vocabulary. **The pair family (S111, " +
      "generalized from the S111-A doctor-only build) is the same shape " +
      "across ANY DECLARED principal**: that principal's own account of what " +
      "it deposited (deposit-cli.ts, journaled at deposit time under its " +
      "roster-resolved name) against the registrar's independent attribution " +
      "of what arrived from its uid — a cross-principal check, not a second " +
      "look at one process's own two legs. Membership is a deployment " +
      "declaration (`--journal-declarations`), never a name this report " +
      "invents (R-V3)."
  );
  say();
  const renderReconciliation = (title: string, r: ReconciliationReading): void => {
    say(`**${title}** — ${r.labelA}: ${r.countA === null ? "—" : String(r.countA)} · ${r.labelB}: ${r.countB === null ? "—" : String(r.countB)}`);
    if (r.state === "CANNOT_ASSESS") {
      say(`- CANNOT_ASSESS. ${r.reason}`);
    } else if (r.state !== null) {
      say(`- **${r.state}** (delta ${r.delta !== null && r.delta > 0 ? "+" : ""}${String(r.delta)}). ${r.reason}`);
    } else {
      say(`- agree — a count, nothing named. ${r.reason}`);
    }
    say();
  };
  renderReconciliation(
    "Pair A — journal vs authoritative chain",
    input.journalBookReconciliation ?? assessJournalBookReconciliation(null, null)
  );
  renderReconciliation(
    "Pair B — attestation line count vs shape-valid count",
    input.stampShapeReconciliation ?? assessStampShapeReconciliation(null)
  );
  {
    const decl = input.journalDeclaration ?? ABSENT_JOURNAL_DECLARATION;
    if (decl.state !== "CONFIGURED") {
      const why =
        decl.state === "ABSENT"
          ? "no journal declarations file was supplied to this run (`--journal-declarations`)"
          : `the declared journals file (${decl.source}) did not yield a usable ` +
            "declaration" +
            (decl.problems.length === 0 ? "" : `: ${decl.problems.join("; ")}`);
      say(
        `**Pair family — CANNOT_ASSESS, the whole family.** ${why}. R-V3 forbids ` +
          "this program from guessing a principal's identity, so an undeclared " +
          "principal is a gap this report NAMES, not one it fills."
      );
      say();
    } else {
      for (const { principal, reading } of input.principalJournalReconciliations ?? []) {
        renderReconciliation(
          `Pair ${principal} — ${principal}'s own journal vs registrar's chain (by uid)`,
          reading
        );
      }
    }
  }

  // ── DEPLOYMENT FACTS — DF (S112, §3.7) ────────────────────────────────────
  say("### 3.7 · Deployment facts — DF (S112)");
  say();
  say(
    "Every CONDITIONAL* in the T2 census reads \"hard to game only while a root-owned " +
      "deployment fact holds\" — and until this section existed, nothing anywhere read FOR " +
      "that fact silently stopping. **Negative-only, same fence as every section above: the " +
      "only named findings are FACT_ABSENT and CANNOT_ASSESS.** A holding fact earns NO row " +
      "and NO word like OK/SECURE/HARD — it is folded into a bare count in the line below, " +
      "the same way an assessed-fresh chain in §3.4 earns a count and never a name. " +
      "UNDECLARED is a census of fact families this reader COULD check that nothing declared " +
      "— visible, never an alarm."
  );
  say();
  say(`**${DEPLOYMENT_FACTS_CEILING}**`);
  say();
  {
    const df = input.deploymentFacts ?? defaultDeploymentFacts();
    if (df.declaration.state !== "CONFIGURED") {
      const why =
        df.declaration.state === "ABSENT"
          ? "no deployment-facts declaration was supplied to this run (`--deployment-facts`)"
          : `the declared facts file (${df.declaration.source}) did not yield a usable ` +
            "declaration" +
            (df.declaration.problems.length === 0 ? "" : `: ${df.declaration.problems.join("; ")}`);
      say(
        `**CANNOT_ASSESS — the whole section.** ${why}. R8 forbids this program from ` +
          "deriving a fact from the deployed tree, so an undeclared expectation is a gap " +
          "this report NAMES, not one it fills."
      );
    } else {
      say(
        `- declared: ${df.declaration.facts.length} · held: ${df.heldCount} (a count, not a ` +
          `verdict on any one fact) · FACT_ABSENT: ${df.factAbsentCount} · CANNOT_ASSESS: ` +
          `${df.cannotAssessCount}`
      );
      say();
      if (df.findings.length === 0) {
        say("- no FACT_ABSENT or CANNOT_ASSESS finding this run");
      } else {
        say("| id | family | state | reason |");
        say("|---|---|---|---|");
        for (const f of df.findings) {
          say(`| ${f.id} | ${f.family} | **${f.state}** | ${f.reason.replace(/\|/g, "\\|")} |`);
        }
      }
      say();
      if (df.undeclaredFamilies.length === 0) {
        say("- no UNDECLARED fact families (every family this reader can check was declared)");
      } else {
        say(
          "- **UNDECLARED** (checkable, nothing was declared for it — census, not an alarm): " +
            df.undeclaredFamilies.map((f) => `\`${f}\``).join(", ")
        );
      }
    }
  }
  say();

  say("## 4 · Receipt symmetry — HEAD_COMMITs in the store vs receipt files in the outbox");
  say();
  if (outbox.state === "READ_FAILED") {
    say(
      "**THE OUTBOX COULD NOT BE LISTED, SO NO SYMMETRY WAS CHECKED.** This is NOT the " +
        "same finding as an empty outbox and must never be read as one."
    );
    say();
    say(`    ${outbox.reason}`);
    say();
    say(
      "Recipe §5.2 makes the outbox `mica-witness:mica-readers` at 0750. A reader that " +
        "cannot list it is either not in `mica-readers` or is looking at a directory " +
        "the deployment act never made."
    );
  } else if (symmetry === null) {
    say("No symmetry was computed.");
  } else {
    say(`- receipt files in the outbox    : ${outbox.receiptSeqs.size}`);
    say(`- entries in the outbox directory: ${outbox.fileCount}`);
    say(`- HEAD_COMMITs in this window    : ${fold.headCommits.length}`);
    say(`- of those, receipted            : ${symmetry.matched.length}`);
    say(
      `- missing, explained by KEY_UNAVAILABLE at seq+1 : ${symmetry.explained.length}` +
        (symmetry.explained.length === 0 ? "" : ` (${symmetry.explained.join(", ")})`)
    );
    say();
    if (symmetry.unexplained.length > 0) {
      say(
        `**${symmetry.unexplained.length} HEAD_COMMIT(S) IN THIS WINDOW HAVE NO RECEIPT FILE ` +
          "AND NOTHING IN THE STORE EXPLAINS IT:** seq " +
          symmetry.unexplained.join(", ") +
          ". Expected `receipt-<seq padded to 12>.json` in the outbox for each."
      );
      say();
    }
    if (symmetry.orphans.length > 0) {
      say(
        `**${symmetry.orphans.length} RECEIPT FILE(S) NAME A SEQ THAT IS NO HEAD_COMMIT ` +
          "ANYWHERE IN THIS STORE:** seq " +
          symmetry.orphans.join(", ") +
          ". A receipt outlives the record it attests only if the record left."
      );
      say();
    }
    if (outbox.unrecognisedNames.length > 0) {
      say(
        `**${outbox.unrecognisedNames.length} entry(ies) in the outbox are not named like a ` +
          "receipt** and were counted as nothing: " +
          outbox.unrecognisedNames.map((n) => `\`${n}\``).join(", ") +
          "."
      );
      say();
    }
    if (
      symmetry.unexplained.length === 0 &&
      symmetry.orphans.length === 0 &&
      outbox.unrecognisedNames.length === 0
    ) {
      // AN EXPLAINED ABSENCE IS STILL AN ABSENCE. The first sample run printed
      // "every HEAD_COMMIT has a receipt file named for it" over a day in which
      // one demonstrably did not — the KEY_UNAVAILABLE record said why, and the
      // summary sentence rounded that down to symmetry. A line in an audit whose
      // whole job is to be true about receipts must not be false about one.
      // AND A CHECK WITH NOTHING TO CHECK IS NOT A CLEAN CHECK (S96-B, S97).
      // Over a window holding no HEAD_COMMIT and an outbox holding no receipt,
      // the affirmative sentence below is true the way "every unicorn in this
      // room is green" is true, and it printed exactly that way on the
      // 2026-08-30 report — an all-clear over a denominator of zero, in the one
      // section whose job is to be true about receipts. The symmetry statement
      // is now WITHHELD when there is nothing to compare, and says so.
      if (fold.headCommits.length === 0 && outbox.receiptSeqs.size === 0) {
        say(
          "0 HEAD_COMMITs in the window and 0 receipt files: the symmetry statement " +
            "has nothing to compare and is therefore not made."
        );
      } else if (symmetry.explained.length === 0) {
        say(
          "Every HEAD_COMMIT in the window has a receipt file named for it, and every " +
            "receipt file names a HEAD_COMMIT this store holds."
        );
      } else {
        say(
          `**${symmetry.explained.length} HEAD_COMMIT(S) IN THE WINDOW HAVE NO RECEIPT FILE.** ` +
            "The store says why — a KEY_UNAVAILABLE record sits at seq+1 in each case — and " +
            "that is an explanation, not a receipt. The submitter got nothing back. Every " +
            "OTHER HEAD_COMMIT here has a receipt file named for it, and every receipt file " +
            "names a HEAD_COMMIT this store holds."
        );
      }
      say();
      say(
        "**All of that is a statement about FILENAMES.** Nothing here opened a receipt, " +
          "checked a signature, or asked whether the bytes inside it say what the record says."
      );
      say();
    }
  }
  say(RULE);

  // ── the bounds
  say();
  say("## 5 · What this report does not say");
  say();
  say(`- ${REPORT_MAKES_NO_VERDICT}`);
  say(
    "- It does not say the witness is running, was running, or stopped. It read a file."
  );
  say(
    "- It does not check the hash chain. Digests, signatures and chain linkage are not " +
      "computed here; the store's own loader and the entitled roles own that question."
  );
  say(
    "- It does not re-validate the closed record schema. It reads the record FRAME " +
      "(seq, arrivalTs, submitterId, kind, witnessed) and leaves what a well-formed record " +
      "is to `src/witness/witness.ts`, which owns it at append time. A second validator " +
      "here would be a second opinion about the same bytes."
  );
  say(
    "- It cannot see the intake. Entitled readers may not list it (recipe §5.3: `3730`), " +
      "so a drop's story reaches this report only through a record the witness retained. " +
      "A submission that never arrived leaves nothing here, and that is the design working."
  );
  say(
    "- It does not open receipts. Symmetry above is a comparison of NAMES."
  );
  say();
  say(RULE);

  // ── ITEM-4 HONEST LIMIT (Tier-1 card), S108 rider 1. Fixed, verbatim, always. ─
  say();
  say("### 5.1 · The honest limit");
  say();
  say(HONEST_LIMIT_TEXT);
  say();
  say(RULE);
  say();
  say(`${read.lines.length} line(s) read from the store. End of report for ${w.day}.`);
  say();
  return out.join("\n");
}
