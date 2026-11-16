// ── GLUE · a real MicaReadableLog over a JSONL file ──────────────────────────
//
// THE ONE SENTENCE THIS ADAPTER IS ALLOWED TO SAY:
//
//   THIS ADAPTER ATTESTS PARSE AND ORDERING, NEVER AUTHORSHIP OR COMPLETENESS.
//
// WHY IT EXISTS
//
//   Until now the only thing on disk implementing `MicaReadableLog` was
//   `src/mica/fixture-log.ts`, and its own header says what it is: a fixture,
//   written by us to be read by us. The observed system's log arrives as a FILE.
//   This is the adapter that lets a MICA reader read one.
//
// ── THE HONESTY-CRITICAL DECISION, AND IT IS THE WHOLE FILE ───────────────────
//
//   A plain JSONL has NO HASH CHAIN. Nothing in it links line n to line n-1, so
//   nothing here can tell an untouched file from one that was rewritten between
//   two reads. `MicaFixtureLog` and `FloorTrail` both return the load state
//   `LOADED_VERIFIED`, and they have earned it: they chain each record to its
//   predecessor and recompute every hash at load. THIS ADAPTER HAS NOT EARNED
//   IT AND NEVER WILL, so it never says it.
//
//   The load state it reports on a good read is `LOADED_UNVERIFIED_FILE`, and
//   the name is doing work: it says, in the one string a MICA reader actually
//   gates on, that the file parsed and nothing more. A `LOADED_VERIFIED` here
//   would be an unchained file wearing a chained store's label, and every
//   sensor downstream would read it as provenance it does not have. That is the
//   silent fail-open this architecture refuses, one string wide.
//
//   `verify()` is held to the same line. It returns valid ONLY for the two
//   things this adapter actually checked:
//
//     · PARSE INTEGRITY — every non-blank line parsed, and every parsed record
//       carried MICA's five required declared fields at the right types;
//     · ORDERING — `sequenceNumber` runs strictly upward WITHIN EACH WRITER
//       (`moduleId`). Across writers the only order claimed is file order.
//       See the block below: this was a single global sequence until S127.
//
//   It does NOT check, claim, or imply: that the file is complete, that no
//   record was removed (a removal that keeps the sequence strictly increasing
//   is INVISIBLE here — deletion of a whole prefix or suffix is invisible too),
//   that the timestamps are true, or that the party who wrote it is the party
//   the deployment thinks wrote it. A log that lies in real time, written in
//   order, parses perfectly and reads clean. That is preserved exactly.
//
// ── ORDER IS PER-WRITER, AND THE SINGLE-SPACE READING COST EIGHT NIGHTS [LB] ──
//
//   RULED S127-6 (a), the arbiter, 2026-09-13.
//
//   `sequenceNumber` is minted by the WRITER, and MICA's log has more than one.
//   On the live box `/var/lib/mica/mica-log.jsonl` is written by THREE
//   principals — `mica-registrar` (the owner) plus `mica-arbiter` and
//   `mica-doctor`, each carrying its own `rw` ACL entry — and each mints from
//   its OWN counter starting at 0. So the file legitimately reads
//   `registrar 0, registrar 1, doctor 0, …`, and a check demanding one global
//   ascent calls that third record a break.
//
//   IT DID. `brokenAt=2` from the moment the second writer first appended, and
//   `mica-clerk-caller` — whose gate is this very `verify()` — exited 1 at
//   00:00 on EIGHT consecutive nights without stamping anything. The failure
//   was invisible: the unit's stderr went nowhere the box kept (see the caller's
//   own header), so the only surviving trace was a stamps file that stopped
//   growing. A verifier that refuses a correct log is not a strict verifier; it
//   is a broken one, and this one failed CLOSED and silent, which is the
//   expensive way to be wrong.
//
//   WHAT IS CHECKED NOW: for each `moduleId`, that writer's `sequenceNumber`
//   strictly increases in the order its records appear in the file. The FIRST
//   record seen for a writer is unconstrained — 0 is normal, and a log opened
//   mid-life may legitimately start at any value.
//
//   WHAT IS DELIBERATELY NOT CHECKED, so a successor does not read it as an
//   oversight:
//
//     · Any relation BETWEEN writers. Interleaving is the normal state and
//       file order is the only cross-writer order this adapter claims.
//     · TIMESTAMP order, across writers or within one. This adapter has NEVER
//       checked `timestamp` and does not begin now — three principals on one
//       box still have three clocks, and `MICA_LOG_FILE_ATTESTS` has said
//       since Build 1 that the timestamps are not attested. Adding a clock
//       requirement here would be a NEW claim smuggled in under a repair.
//     · That a writer's records are CONTIGUOUS. A gap (0, 1, 4) still passes,
//       exactly as a gap in the old global check did: removal stays invisible
//       here, as the honesty block above says.
//
// ── AND THE GATE IS STILL THE OPERATOR'S, NOT THIS FILE'S ─────────────────────
//
//   `readableLoadStates` is INJECTED WITH NO DEFAULT (2026-08-12 ruling; see
//   `assessLogReadability` in ../mica/types.ts). This adapter therefore does not
//   and cannot decide that its own load state is readable. An operator who wants
//   MICA to read an unverified file must inject `LOADED_UNVERIFIED_FILE` by
//   name, by hand, deliberately — and it is then printed in the run's scope
//   block and in every blind path the gate produces. Offer, not impose, in one
//   flag.
//
// ── WHAT AN ABSENT OR EMPTY FILE DOES, SAID RATHER THAN DISCOVERED ────────────
//
//   Nothing loads, so `verify()` is VACUOUSLY valid — there is no record to be
//   out of order. The LOAD STATE is the only thing standing between an empty
//   file and a reading, exactly as it is in `fixture-log.ts`, and that is
//   deliberate: `FILE_ABSENT` and `FILE_EMPTY_OR_ERASED` are their own states,
//   neither of them the good one, and a file that never existed is
//   indistinguishable from here from one that was erased.

import { readFileSync } from "fs";
import type {
  MicaLogRecord,
  MicaLogVerifyResult,
  MicaReadableLog,
} from "../mica/log";

/** The one sentence, carried in the code so it prints where the adapter is used. */
export const MICA_LOG_FILE_ATTESTS =
  "THIS ADAPTER ATTESTS PARSE AND ORDERING, NEVER AUTHORSHIP OR COMPLETENESS. " +
  "A JSONL file carries no hash chain: nothing here can distinguish an " +
  "untouched file from one rewritten between two reads, a complete file from " +
  "one with records removed, or an honest writer from a lying one. It reports " +
  "that every line parsed into MICA's declared record shape and that each " +
  "writer's own sequenceNumber runs strictly upward within that writer's " +
  "records (moduleId; S127-6). Across writers it claims file order and " +
  "nothing more, and it has never attested timestamps. Nothing else.";

/**
 * The load state a GOOD read of a JSONL file reports.
 *
 * Named, exported, and deliberately NOT `LOADED_VERIFIED`: an operator has to
 * type this string to let a reader through, and typing it is an admission of
 * what they are accepting.
 */
export const LOADED_UNVERIFIED_FILE = "LOADED_UNVERIFIED_FILE";

/**
 * The states this adapter can report. A closed union so the set can be attacked
 * for completeness rather than inferred from the code.
 *
 * Only ONE of them is the good one, and none of them is `LOADED_VERIFIED`.
 */
export type MicaLogFileLoadState =
  /** Parsed, ordered, and unchained. The only state a clean read produces. */
  | "LOADED_UNVERIFIED_FILE"
  /** No file at the injected path. Never existed and erased are the same here. */
  | "FILE_ABSENT"
  /** Present and could not be read (permissions, IO). */
  | "FILE_UNREADABLE"
  /** A line did not parse, or parsed outside MICA's declared record shape. */
  | "FILE_MALFORMED"
  /** Present, readable, and carrying no records at all. Not a clean start. */
  | "FILE_EMPTY_OR_ERASED";

/**
 * The label a chained store earns and this one does not. Held as a constant so
 * the prohibition is a thing the test can point at rather than a habit.
 */
export const FORBIDDEN_LOAD_STATE = "LOADED_VERIFIED";

/** Where the load stopped, when it stopped badly. */
export interface MicaLogFileProblem {
  /** 0-indexed position among the non-blank lines — what verify() reports. */
  readonly index: number;
  /** 1-indexed line number in the file, for a human opening it in an editor. */
  readonly line: number;
  readonly detail: string;
}

export interface MicaLogFileOptions {
  /** The observed system's log. INJECTED; this adapter invents no path. */
  readonly path: string;
}

// ── record validation ────────────────────────────────────────────────────────
//
// MICA declares FIVE required fields plus optional `actionId` (../mica/log.ts).
// A record carrying MORE is fine and is not an error — log.ts says so
// explicitly. So extra keys are ACCEPTED and then DROPPED: the record handed to
// a sensor carries the declared fields only, because there is no typed path to
// anything else and building one would be the untyped bag arriving by the side
// door.

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function isString(x: unknown): x is string {
  return typeof x === "string";
}

/**
 * Normalise one parsed line into a MicaLogRecord, or say why it is not one.
 * Returns the record, or a string naming the first field that failed.
 */
function toRecord(x: unknown): MicaLogRecord | string {
  if (!isObject(x)) return "line is not a JSON object";
  if (!isFiniteNumber(x.sequenceNumber)) return "sequenceNumber is not a finite number";
  if (!isFiniteNumber(x.timestamp)) return "timestamp is not a finite number";
  if (!isString(x.moduleId)) return "moduleId is not a string";
  if (!isString(x.eventType)) return "eventType is not a string";
  if (!isString(x.outcome)) return "outcome is not a string";
  if (x.actionId !== undefined && !isString(x.actionId)) {
    return "actionId is present and is not a string";
  }
  const record: MicaLogRecord =
    x.actionId === undefined
      ? {
          sequenceNumber: x.sequenceNumber,
          timestamp: x.timestamp,
          moduleId: x.moduleId,
          eventType: x.eventType,
          outcome: x.outcome,
        }
      : {
          sequenceNumber: x.sequenceNumber,
          timestamp: x.timestamp,
          moduleId: x.moduleId,
          eventType: x.eventType,
          outcome: x.outcome,
          actionId: x.actionId,
        };
  return record;
}

/**
 * A `MicaReadableLog` over a JSONL file. Read-only: it opens nothing for
 * writing, and it cannot repair, compact or reorder the file it reads.
 */
export class MicaLogFile implements MicaReadableLog {
  private readonly records: MicaLogRecord[] = [];
  private readonly sourcePath: string;
  private loadState: MicaLogFileLoadState = "FILE_ABSENT";
  private problem: MicaLogFileProblem | null = null;

  constructor(options: MicaLogFileOptions) {
    this.sourcePath = options.path;
    this.load();
  }

  private load(): void {
    // ONE READ, AND ITS ERRNO DECIDES — never `existsSync` (S103).
    //
    //   This began `if (!existsSync(this.sourcePath)) { FILE_ABSENT }`, and
    //   `existsSync` returns false both for "there is no such file" and for "I
    //   was not allowed to look". A log this process could not traverse to was
    //   reported as a log that is not there — and FILE_ABSENT is a state a
    //   caller reasonably treats as "nothing to read yet", so the reader said
    //   the quiet thing about a file that may have been full.
    //
    //   The sibling reader in this directory, `witness-log-file.ts`, took the
    //   three-valued shape at S97-D(2) and says so at its own load. This one
    //   kept the two-valued call until `load-site-guard.test.ts` named it.
    //
    //   No separate `statSync` is needed here: `readFileSync` reports the same
    //   errno, so ONE syscall answers both questions. ENOENT is the only errno
    //   that means absent; every other one means the question was not answered.
    let raw: string;
    try {
      raw = readFileSync(this.sourcePath, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        this.loadState = "FILE_ABSENT";
        return;
      }
      this.loadState = "FILE_UNREADABLE";
      this.problem = {
        index: -1,
        line: -1,
        detail:
          `${this.sourcePath} could not be read (${String(code ?? err)}). THIS ` +
          `IS NOT the finding that the file is absent: this process could not ` +
          `look, and a directory whose execute bit is stripped produces exactly ` +
          `this with no second principal involved.`,
      };
      return;
    }

    // Blank lines are skipped and COUNTED OUT: `line` stays a real file line
    // number so a human can open the file at the offending line, while `index`
    // is the position among records, which is what verify() reports.
    const fileLines = raw.split("\n");
    let index = 0;
    for (let i = 0; i < fileLines.length; i++) {
      const text = fileLines[i];
      if (text.trim().length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        this.loadState = "FILE_MALFORMED";
        this.problem = {
          index,
          line: i + 1,
          detail: `line ${i + 1} is not valid JSON: ${String(err)}`,
        };
        return;
      }
      const record = toRecord(parsed);
      if (typeof record === "string") {
        this.loadState = "FILE_MALFORMED";
        this.problem = {
          index,
          line: i + 1,
          detail:
            `line ${i + 1} is not a MICA log record: ${record}. MICA declares ` +
            `five required fields (sequenceNumber, timestamp, moduleId, ` +
            `eventType, outcome) plus optional actionId; a record carrying MORE ` +
            `is accepted and the extra fields are not read.`,
        };
        return;
      }
      // Records before the break are kept in memory so getAll() shows what is
      // actually there; the LOAD STATE and verify() are what refuse the reading.
      this.records.push(record);
      index++;
    }

    if (this.records.length === 0) {
      this.loadState = "FILE_EMPTY_OR_ERASED";
      return;
    }

    this.loadState = LOADED_UNVERIFIED_FILE;
  }

  // ── the three methods MicaReadableLog asks for ─────────────────────────────

  /**
   * Parse integrity and PER-WRITER ordering. NOT a chain verification, and
   * never described as one: see MICA_LOG_FILE_ATTESTS.
   *
   * `brokenAt` is the 0-indexed position among records, matching what a MICA
   * reader prints. On a malformed file that is the position the load stopped at.
   */
  verify(): MicaLogVerifyResult {
    if (this.problem !== null) {
      return { valid: false, brokenAt: this.problem.index };
    }
    // PER WRITER, not across the file (S127-6 (a) — see the header block).
    // The comparison is against this moduleId's OWN previous record, wherever
    // it sits in the file; a writer's first record is unconstrained.
    const lastSeqByModule = new Map<string, number>();
    for (let i = 0; i < this.records.length; i++) {
      const record = this.records[i];
      const previous = lastSeqByModule.get(record.moduleId);
      if (previous !== undefined && record.sequenceNumber <= previous) {
        return { valid: false, brokenAt: i };
      }
      lastSeqByModule.set(record.moduleId, record.sequenceNumber);
    }
    return { valid: true };
  }

  getLoadState(): MicaLogFileLoadState {
    return this.loadState;
  }

  getAll(): readonly MicaLogRecord[] {
    return this.records;
  }

  // ── adapter reporting, not part of MicaReadableLog ─────────────────────────

  /** The injected path, so a census can print WHAT was read. */
  getSourcePath(): string {
    return this.sourcePath;
  }

  /** Where the load stopped, or null when it did not. */
  getProblem(): MicaLogFileProblem | null {
    return this.problem;
  }

  get length(): number {
    return this.records.length;
  }

  /** One line for a census: what was opened, what came back, how much. */
  describe(): string {
    const where = `${this.sourcePath}`;
    const problem = this.problem === null ? "" : ` — ${this.problem.detail}`;
    return (
      `${where}: loadState=${this.loadState} records=${this.records.length} ` +
      `verify=${this.verify().valid ? "parse+order OK" : "INVALID"}${problem}`
    );
  }
}

/**
 * A MicaLogFile is a MicaReadableLog. Asserted at compile time so the adapter
 * cannot drift off the interface it exists to satisfy — the same statement
 * fixture-log.ts makes about itself, for the same reason.
 */
export type MicaLogFileIsReadable = MicaLogFile extends MicaReadableLog
  ? MicaLogRecord
  : never;
