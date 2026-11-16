// ── GLUE · a MicaReadableLog over the WITNESS STORE ──────────────────────────
//
// THE ONE SENTENCE THIS ADAPTER IS ALLOWED TO SAY:
//
//   THIS ADAPTER ATTESTS THE WITNESS CHAIN AND ORDERING, NEVER AUTHORSHIP OF
//   MEANING AND NEVER COMPLETENESS.
//
// ── WHY IT EXISTS (S102) ─────────────────────────────────────────────────────
//
//   The witness store was pointed at `--log` and read by `MicaLogFile`, the
//   generic JSONL adapter. It failed at line 1: `sequenceNumber is not a finite
//   number`. The store does not speak in MICA log records; it speaks in WITNESS
//   FRAMES. Nothing was read, Sig went CANNOT_ASSESS, and F4 never executed.
//
//   Worse than the shape mismatch: `MicaLogFile` says, correctly for itself,
//   "a JSONL file carries no hash chain" — and then reports BROKEN_CHAIN about a
//   chain it never checked. The witness store DOES carry a chain. Reading it
//   with the generic adapter throws away real tamper evidence and then reports
//   the absence of the thing it discarded.
//
// ── WHY THIS FILE IS IN src/glue/ AND NOT IN src/mica/ `[LB]` ────────────────
//
//   RULED, AND ENFORCED: `src/mica/closure.test.ts` asserts ZERO EDGES OUT OF
//   `src/mica/`, with `KNOWN_FOREIGN_EDGES` pinned EMPTY so the list cannot be
//   quietly re-populated to let a new coupling pass. `src/mica/doctor/history.ts`
//   states it in one line: "closure ruling bars `src/mica/` from importing
//   `src/witness/` in any case."
//
//   So an adapter that reads witness frames CANNOT live inside `src/mica/`.
//   `src/glue/` is the seam that already exists for exactly this: it is the
//   composition layer, it already owns file→MicaReadableLog (`mica-log-file.ts`),
//   and it ALREADY imports the witness (`wire.ts` takes `fileDropCommitter` from
//   `../witness/drop-committer`). This adds no new coupling direction.
//
// ── WHAT IT REUSES, AND THE ONE THING IT COULD NOT `[LB]` ────────────────────
//
//   The drift-critical part — the canonical preimage every chain hash is
//   computed over — is IMPORTED: `computeWitnessRecordHash` from the witness's
//   own module. It is not copied and not re-derived here.
//
//   The chain WALK is local, and it has to be. The witness's own load-and-verify
//   path lives inside the `Witness` class, and THAT CLASS'S CONSTRUCTOR WRITES:
//   it opens the store `"a"` when absent and appends a PLACEMENT record whenever
//   the store loads EMPTY or LOADED_VERIFIED. Constructing one to READ the live
//   store would append to the very evidence a sensor is about to read. A reader
//   that mutates its subject is not a reader.
//
//   The duplication that leaves is bound rather than trusted:
//   `witness-log-file.test.ts` builds real stores with the real `Witness` class
//   in a tmpdir and asserts this adapter's verdict AGREES WITH `Witness.verify()`
//   on both a valid chain and a broken one. If the walk ever drifts, that fails.
//
// ── THE MAPPING IS A CLAIM, SO IT IS PRINTED ────────────────────────────────
//
//   Every row of WITNESS_LOG_MAPPING is an assertion about what a witness frame
//   means in MICA's grammar. It is exported so the census can print it, because
//   a reader who cannot see the mapping cannot audit the reading.

import { readFileSync, statSync } from "fs";
import type { MicaLogRecord, MicaLogVerifyResult, MicaReadableLog } from "../mica/log";
import { computeWitnessRecordHash } from "../witness/witness";
import type { WitnessRecord } from "../witness/types";

/**
 * The emitter of every record in this store.
 *
 * A FIXED LITERAL, and the choice is a claim worth stating. The frame carries no
 * field naming its author: `witnessSetId` is a runtime argument to the daemon
 * (`--witness-set-id`) and is never written into a record. `submitterId` IS on
 * the frame — and mapping it here would be wrong, because it names the party the
 * record is ABOUT, not the party that wrote it. The witness wrote every line.
 */
export const WITNESS_MODULE_ID = "MICA/Witness";

/**
 * ⚠ THE STORE HAS NO OUTCOME FIELD, AND THIS IS NOT A PLACEHOLDER FOR ONE.
 *
 * A witness frame records THAT something was witnessed and what kind of thing it
 * was. It carries no verdict on it. The honest options were this literal or a
 * fabricated `OK`, and a fabricated `OK` would be a made-up value entering an
 * instrument through the field a sensor reads for engagement — the S100-1 defect
 * with a sensor downstream of it.
 *
 * ⚠ AND IT HAS A CONSEQUENCE NOBODY SHOULD BE SURPRISED BY: `outcome` is
 * CONSTANT across every record, so MICA/Eng's engagement signature over
 * (moduleId, eventType, outcome) is DEGENERATE by construction, and Eng may well
 * ALARM that `outcome` carries no information. THAT ALARM WOULD BE TRUE — and it
 * would be true about this mapping, not about the observed system. It is printed
 * in the census for that reason. Do not silence it by inventing variety.
 */
export const WITNESS_NO_OUTCOME = "WITNESSED_NO_OUTCOME_FIELD";

/** What this adapter attests. Replaces the generic JSONL sentence entirely. */
export const WITNESS_LOG_ATTESTS =
  "THIS ADAPTER ATTESTS THE WITNESS CHAIN AND ORDERING. Every record's hash was " +
  "recomputed over the witness's own canonical preimage and checked against the " +
  "hash it carries, and each record's previousHash was checked against its " +
  "predecessor — so a rewritten, reordered or spliced middle is caught. IT " +
  "ATTESTS NOTHING ELSE. Not completeness: a truncation of the whole tail leaves " +
  "a chain that verifies perfectly. Not authorship of meaning: the witness " +
  "retains what arrived and never certifies that what arrived was true. Not " +
  "signatures: the store's records carry previousHash and hash only — the " +
  "Ed25519 signature rides on the OUTBOX RECEIPT, not on any line of this file, " +
  "so nothing here is signature-checked and no public key is read.";

/** Printed in the census. Every row is a claim about what a frame means. */
export const WITNESS_LOG_MAPPING: readonly string[] = [
  "seq          -> sequenceNumber   (the witness's own arrival counter)",
  "arrivalTs    -> timestamp        (when the witness saw it; NOT when it happened)",
  "kind         -> eventType        (one of the seven witnessed kinds, verbatim)",
  `(literal)    -> moduleId         ("${WITNESS_MODULE_ID}" — the witness wrote every`,
  "                                  line; the frame names no author of its own)",
  `(literal)    -> outcome          ("${WITNESS_NO_OUTCOME}" — the store has NO`,
  "                                  outcome field. Never a fabricated OK. This makes",
  "                                  Eng's signature degenerate BY CONSTRUCTION.)",
  "submitterId  -> DROPPED          (it is a principal, not an action id and not an",
  "                                  outcome; mapping it to either would be a claim",
  "                                  the frame does not support)",
  "previousHash -> (chain check only, never surfaced as a MICA field)",
  "hash         -> (chain check only, never surfaced as a MICA field)",
  "witnessed    -> DROPPED          (the payload varies by kind; MICA's record shape",
  "                                  has nowhere honest to put it)",
];

/**
 * Load states this adapter reports. DISTINCT NAMES ON PURPOSE: `readableLoadStates`
 * is injected with no default, so an operator who wants MICA to read a witness
 * store must name the state BY HAND. A store that verified is not the same fact
 * as a JSONL that merely parsed, and the two must not share a string.
 */
export const LOADED_WITNESS_CHAIN_VERIFIED = "LOADED_WITNESS_CHAIN_VERIFIED";

export type WitnessLogLoadState =
  | typeof LOADED_WITNESS_CHAIN_VERIFIED
  /** The chain broke: a hash or a link did not check. Tamper evidence, fired. */
  | "WITNESS_STORE_BREAK"
  /** A line was not JSON. */
  | "WITNESS_UNVERIFIED_JSON"
  /** A line was JSON and not a witness frame. */
  | "WITNESS_UNVERIFIED_SCHEMA"
  /** The file exists and holds no records. */
  | "WITNESS_STORE_EMPTY"
  /** ⚠ NOT "absent". This process could not read it, and says which. */
  | "WITNESS_STORE_UNREADABLE"
  /** The file is genuinely not there. */
  | "WITNESS_STORE_ABSENT";

export interface WitnessLogOptions {
  readonly path: string;
}

function isFrame(x: unknown): x is WitnessRecord {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return (
    Number.isInteger(o.seq) &&
    (o.seq as number) >= 0 &&
    Number.isFinite(o.arrivalTs) &&
    typeof o.submitterId === "string" &&
    typeof o.previousHash === "string" &&
    typeof o.hash === "string" &&
    typeof o.kind === "string" &&
    typeof o.witnessed === "object" &&
    o.witnessed !== null
  );
}

/**
 * A read-only MicaReadableLog over a witness store.
 *
 * ⚠ IT CREATES NOTHING AND WRITES NOTHING. `statSync` and `readFileSync`, and no
 * other filesystem call appears in this file. It never opens the store for
 * append, never makes a directory, and has no default path.
 */
export class WitnessStoreLog implements MicaReadableLog {
  private readonly frames: WitnessRecord[] = [];
  private readonly mapped: MicaLogRecord[] = [];
  private loadState: WitnessLogLoadState = "WITNESS_STORE_ABSENT";
  private brokenAt: number | null = null;
  private problem: string | null = null;
  readonly sourcePath: string;

  constructor(options: WitnessLogOptions) {
    this.sourcePath = options.path;
    this.load();
  }

  private load(): void {
    // statSync, never existsSync: a path this process may not traverse must not
    // be reported as a path that does not exist (S97-D(2)).
    let raw: string;
    try {
      const st = statSync(this.sourcePath);
      if (!st.isFile()) {
        this.loadState = "WITNESS_STORE_UNREADABLE";
        this.problem = `${this.sourcePath} exists and is not a regular file`;
        return;
      }
      raw = readFileSync(this.sourcePath, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        this.loadState = "WITNESS_STORE_ABSENT";
        this.problem = `${this.sourcePath} does not exist`;
        return;
      }
      this.loadState = "WITNESS_STORE_UNREADABLE";
      this.problem =
        `${this.sourcePath} could not be read (${String(code ?? err)}). THIS IS ` +
        `NOT an absent store: this process could not look, and a reader that ` +
        `reported blindness as absence would be inventing a fact about the store.`;
      return;
    }

    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      this.loadState = "WITNESS_STORE_EMPTY";
      return;
    }

    for (let i = 0; i < lines.length; i++) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(lines[i]);
      } catch {
        this.loadState = "WITNESS_UNVERIFIED_JSON";
        this.problem = `line ${i + 1} of ${this.sourcePath} is not valid JSON`;
        this.brokenAt = i;
        return;
      }
      if (!isFrame(parsed)) {
        this.loadState = "WITNESS_UNVERIFIED_SCHEMA";
        this.problem =
          `line ${i + 1} of ${this.sourcePath} is JSON and is not a witness frame ` +
          `(a frame carries seq, arrivalTs, submitterId, previousHash, hash, kind, witnessed)`;
        this.brokenAt = i;
        return;
      }
      this.frames.push(parsed);
    }

    // ── THE CHAIN ─────────────────────────────────────────────────────────────
    //
    // The hash is the witness's own, imported. The walk is local, and the test
    // file binds it to `Witness.verify()` on real stores so it cannot drift.
    for (let i = 0; i < this.frames.length; i++) {
      const f = this.frames[i];
      const { hash, ...rest } = f;
      if (computeWitnessRecordHash(rest as Omit<WitnessRecord, "hash">) !== hash) {
        this.loadState = "WITNESS_STORE_BREAK";
        this.problem = `record ${i} (seq ${f.seq}) does not hash to the value it carries`;
        this.brokenAt = i;
        return;
      }
      const expectedPrev = i === 0 ? "" : this.frames[i - 1].hash;
      if (f.previousHash !== expectedPrev) {
        this.loadState = "WITNESS_STORE_BREAK";
        this.problem =
          `record ${i} (seq ${f.seq}) does not link to its predecessor: ` +
          `previousHash is not the prior record's hash`;
        this.brokenAt = i;
        return;
      }
    }

    for (const f of this.frames) {
      this.mapped.push({
        sequenceNumber: f.seq,
        timestamp: f.arrivalTs,
        moduleId: WITNESS_MODULE_ID,
        eventType: f.kind,
        outcome: WITNESS_NO_OUTCOME,
      });
    }
    this.loadState = LOADED_WITNESS_CHAIN_VERIFIED;
  }

  verify(): MicaLogVerifyResult {
    if (this.loadState === LOADED_WITNESS_CHAIN_VERIFIED) {
      return { valid: true };
    }
    return {
      valid: false,
      ...(this.brokenAt === null ? {} : { brokenAt: this.brokenAt }),
    };
  }

  getLoadState(): WitnessLogLoadState {
    return this.loadState;
  }

  getAll(): readonly MicaLogRecord[] {
    return this.mapped;
  }

  /**
   * One line for the census, in the same shape `MicaLogFile.describe()` returns,
   * so every reporting site can ask the reader what it is without knowing which
   * reader it got.
   */
  describe(): string {
    return (
      `witness store ${this.sourcePath} — loadState=${this.loadState} ` +
      `frames=${this.frames.length} ` +
      `verify=${this.verify().valid ? "VALID" : "INVALID"}` +
      (this.problem === null ? "" : ` — ${this.problem}`)
    );
  }

  /** What went wrong, for the census. Null on a clean load. */
  getProblem(): string | null {
    return this.problem;
  }

  /** How many frames were read. Zero on every failure path. */
  get frameCount(): number {
    return this.frames.length;
  }
}
