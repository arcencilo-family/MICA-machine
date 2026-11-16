// ── MICA · A FIXTURE LOG. IT IS A FIXTURE. ────────────────────────────────────
//
// THE FIRST THING TO SAY ABOUT THIS FILE IS WHAT IT IS NOT.
//
//   It is NOT ILAS's LockedEvidenceLog.
//   It is NOT a port, a mirror, a stand-in, or a faithful model of it.
//   It is NOT equivalent to a chain any real system wrote.
//   A test that reads this is NOT evidence that MICA reads a real ILAS chain.
//
// It is a small append-only log that MICA-machine writes and MICA-machine
// reads, built so that the MICA test suites can exercise the sensors without
// any other project being present on the machine. Its only claim on the world
// is that it satisfies `MicaReadableLog` — the shape MICA declares in log.ts.
//
// ── WHY IT HAS A HASH CHAIN AND A LOAD-STATE LADDER ───────────────────────────
//
// Because the sensors GATE on those two things and nothing else. `verify()`
// failing and `getLoadState()` returning something other than LOADED_VERIFIED
// are the two doors to CANNOT_ASSESS, and a fixture that could not produce
// either would leave the whole readability gate untested. So the fixture can
// be broken and can come up dirty, on purpose.
//
// ── WHAT THIS COSTS, SAID PLAINLY ─────────────────────────────────────────────
//
// This is a SECOND implementation of a chained log living in the same
// repository as the sensors that read one. It was written here, by us, to be
// read by us. When ILAS changes its own log — its hashing, its load ladder, its
// append discipline — NOTHING IN THIS REPOSITORY WILL NOTICE. Under the
// vendored copy that preceded it, `diff` would have caught exactly that. That
// check is gone. This file is where the loss lands.
//
// House precedent, not invention: `export/ledger.ts` already builds MICA's own
// append-only, hash-chained, load-state-aware store on the same discipline.
//
// ── HOW IT DIFFERS FROM THE THING IT REPLACED, WHICH MATTERS ──────────────────
//
// Its record has five required declared fields and one optional `actionId`. No `provenanceTag`, no
// `parameters`. There is no untyped bag on a MICA record to stay out of,
// because MICA's shape never declared one.
//
// `undeclared` exists for exactly one purpose: to put arbitrary content in a
// record OUTSIDE MICA's declared shape, so the D2 tests can prove a sensor's
// verdict does not move when it changes. It is written to disk, it is covered
// by the hash, and no MICA sensor can see it — `MicaLogRecord` does not declare
// it, so there is no typed path to it at all.

import { createHash } from "crypto";
import { appendFileSync, mkdirSync, readFileSync, statSync } from "fs";
import { dirname } from "path";
import type {
  MicaLogRecord,
  MicaLogVerifyResult,
  MicaReadableLog,
} from "./log";

const GENESIS_PREV_HASH = "0".repeat(64);

/**
 * A record as this fixture stores it: MICA's five required declared fields and
 * optional actionId, plus the
 * chain fields the fixture needs for its own integrity, plus the deliberately
 * undeclared bag.
 *
 * Fields are MUTABLE here although `MicaLogRecord` declares them readonly. That
 * is not an oversight: the severance tests reach in and rewrite an `outcome` on
 * a returned record to sever the chain, and the type has to permit them to.
 * MICA's own interface still says readonly, so no sensor can.
 */
export interface MicaFixtureRecord {
  sequenceNumber: number;
  timestamp: number;
  moduleId: string;
  eventType: string;
  outcome: string;
  actionId?: string;
  /** The fixture's own integrity, not part of MICA's declared shape. */
  hash: string;
  previousHash: string;
  /** Outside MICA's declared shape by construction. See the header. */
  undeclared?: Record<string, unknown>;
}

/** What a caller supplies. The chain fields are the fixture's to assign. */
export type MicaFixtureInput = Omit<
  MicaFixtureRecord,
  "sequenceNumber" | "hash" | "previousHash"
>;

/**
 * The fixture's load ladder.
 *
 * These four strings are the vocabulary MICA's readability gate was written
 * against, and READABLE_LOAD_STATES admits exactly one of them. They are
 * reproduced here because the gate's behaviour on each is what the suites
 * test — not because MICA requires any log to speak them. `MicaReadableLog`
 * asks only for `getLoadState(): string`.
 */
export type MicaFixtureLoadState =
  | "IN_MEMORY"
  | "LOADED_VERIFIED"
  | "FIRST_BOOT_OR_ERASED"
  | "CANNOT_VERIFY";

export interface MicaFixtureLogOptions {
  /** Point at a JSONL file to make the fixture durable. Omit for in-memory. */
  path?: string;
}

/** Thrown when a durable append cannot be written. Propagated, never swallowed. */
export class MicaFixtureWriteError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "MicaFixtureWriteError";
  }
}

function hashRecord(
  sequenceNumber: number,
  previousHash: string,
  input: MicaFixtureInput
): string {
  const payload = JSON.stringify({
    sequenceNumber,
    previousHash,
    timestamp: input.timestamp,
    moduleId: input.moduleId,
    eventType: input.eventType,
    outcome: input.outcome,
    actionId: input.actionId ?? null,
    undeclared: input.undeclared ?? null,
  });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * WHAT A LOOK AT THE BOOK FILE FOUND — three answers, not two.
 *
 * `existsSync` answers a two-valued question over a three-valued world: it
 * returns FALSE both for "there is no such file" and for "I was not allowed to
 * look", because it swallows every errno alike. Under `!existsSync(path)` this
 * book declared FIRST_BOOT_OR_ERASED over a book it merely could not read.
 *
 * THE MKDIR DID NOT SAVE IT, and that was the assumption worth killing. The
 * absent branch below calls `mkdirSync(dirname(path), { recursive: true })`
 * and sets `persisting` only if that succeeds, so it looks as though a
 * permission fault is caught one line later. Recursive mkdir is IDEMPOTENT: on
 * a directory that already exists and cannot be entered it SUCCEEDS. Measured
 * at uid 1000 with no second principal (S103, ruling-log receipt §E): strip a
 * directory's execute bit and `existsSync` goes false, `statSync` gives EACCES,
 * `mkdirSync` returns cleanly, and the book comes up FIRST_BOOT_OR_ERASED with
 * `persisting = true` over content it never read.
 *
 * S96-D's annotation on that mkdir — "no other principal is entitled" — is a
 * true statement about WHO MAY READ and never was a claim that this state
 * cannot occur. The probe above involved no second principal at all.
 *
 * CANNOT_SEE loads to CANNOT_VERIFY and limps on; it does not throw. That is
 * the line this file already draws for an unreadable file, malformed JSON and a
 * broken chain — facts ABOUT THE BOOK, discovered at runtime, which reporting is
 * this book's job.
 *
 * Duplicated rather than imported, per this project's standing bar on coupling
 * one book's arithmetic to another's (see the header). `ruling-log.ts` and
 * `precommit.ts` each carry their own copy for the same reason.
 */
export type FixtureFileLook =
  | { readonly state: "PRESENT" }
  | { readonly state: "ABSENT" }
  | { readonly state: "CANNOT_SEE"; readonly detail: string };

export function lookAtFixtureLogFile(path: string): FixtureFileLook {
  try {
    statSync(path);
    return { state: "PRESENT" };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOENT is the ONLY errno that means the book is not there. Every other one
    // means the question was not answered.
    if (code === "ENOENT") return { state: "ABSENT" };
    return { state: "CANNOT_SEE", detail: `${code ?? "no errno"}: ${String(err)}` };
  }
}

/*
 * NO `lastError` COMPANION HERE, AND THE ASYMMETRY IS DELIBERATE (S103).
 *
 * The four sibling books repaired alongside this one hand the caller a signpost
 * string. THIS FIXTURE CARRIES NO ERROR DETAIL FOR ANY FAILURE — an unreadable
 * file, malformed JSON and a broken chain all set CANNOT_VERIFY and say nothing
 * more, by its own long-standing shape. Adding a detail field for this one
 * branch would make the fixture inconsistent with itself and would widen a test
 * double's surface to say something no sensor reads: MICA sees this class
 * through `MicaReadableLog`, which asks for `getLoadState(): string` and offers
 * no channel for a reason. The LOAD STATE is the correction; the detail has
 * nowhere honest to go and is therefore not invented.
 */

export class MicaFixtureLog implements MicaReadableLog {
  private readonly chain: MicaFixtureRecord[] = [];
  private readonly path: string | null;
  private loadState: MicaFixtureLoadState = "IN_MEMORY";
  private persisting = false;

  constructor(options?: MicaFixtureLogOptions) {
    this.path = options?.path ?? null;
    if (this.path === null) {
      this.loadState = "IN_MEMORY";
      return;
    }
    this.loadFromDisk();
  }

  // ── load ───────────────────────────────────────────────────────────────────
  //
  // Four outcomes, and only one of them is clean. A missing, unreadable or
  // unverifiable file MUST NOT come up looking like a fresh, healthy start —
  // that is the whole reason the gate exists.

  private loadFromDisk(): void {
    const path = this.path as string;

    const look = lookAtFixtureLogFile(path);
    if (look.state === "CANNOT_SEE") {
      // NOT FIRST BOOT. This was `!existsSync(path)` until S103, and a look that
      // was refused arrived here wearing the absent branch's clothes — with
      // `persisting` set, because the mkdir below succeeds on a directory that
      // exists and cannot be entered.
      this.loadState = "CANNOT_VERIFY";
      this.persisting = false;
      return;
    }
    if (look.state === "ABSENT") {
      // Absent: genuine first run OR an erased history, undecidable from here.
      this.loadState = "FIRST_BOOT_OR_ERASED";
      try {
        // mkdirSync RULED in-bounds (S96-D): only this log's own file, and no
        // deployment site constructs a MicaFixtureLog with a path at all
        // (verified at bytes S97). No other principal is entitled. Annotated
        // S97.
        mkdirSync(dirname(path), { recursive: true });
        this.persisting = true;
      } catch {
        this.persisting = false;
      }
      return;
    }

    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      // Present but unreadable. Fail closed: do not persist, do not fabricate a
      // clean chain, do not overwrite a file we could not read.
      this.loadState = "CANNOT_VERIFY";
      this.persisting = false;
      return;
    }

    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const loaded: MicaFixtureRecord[] = [];
    for (const line of lines) {
      try {
        loaded.push(JSON.parse(line) as MicaFixtureRecord);
      } catch {
        // Unparseable. Nothing is accepted into the chain, so verify() below
        // will be trivially valid — the LOAD STATE is the only thing standing
        // between this file and a reading, and that is deliberate.
        this.loadState = "CANNOT_VERIFY";
        this.persisting = false;
        return;
      }
    }

    for (const r of loaded) this.chain.push(r);

    if (!this.verify().valid) {
      // Present, parseable, and broken. Keep the records in memory so they can
      // be inspected through getAll(), but report non-clean and never persist
      // onto a chain we could not verify.
      this.loadState = "CANNOT_VERIFY";
      this.persisting = false;
      return;
    }

    if (loaded.length === 0) {
      // Empty-but-present reads like an absent history: not clean, but writable
      // onward. An empty file is NOT evidence that nothing was ever written.
      this.loadState = "FIRST_BOOT_OR_ERASED";
      this.persisting = true;
      return;
    }

    this.loadState = "LOADED_VERIFIED";
    this.persisting = true;
  }

  // ── append ─────────────────────────────────────────────────────────────────

  append(input: MicaFixtureInput): MicaFixtureRecord {
    const sequenceNumber = this.chain.length;
    const previousHash =
      sequenceNumber === 0
        ? GENESIS_PREV_HASH
        : this.chain[sequenceNumber - 1].hash;

    const record: MicaFixtureRecord = {
      sequenceNumber,
      timestamp: input.timestamp,
      moduleId: input.moduleId,
      eventType: input.eventType,
      outcome: input.outcome,
      hash: hashRecord(sequenceNumber, previousHash, input),
      previousHash,
    };
    if (input.actionId !== undefined) record.actionId = input.actionId;
    if (input.undeclared !== undefined) record.undeclared = input.undeclared;

    // Persist BEFORE committing to memory, so a failed write cannot leave disk
    // and memory quietly disagreeing.
    if (this.persisting) {
      try {
        appendFileSync(this.path as string, JSON.stringify(record) + "\n");
      } catch (err) {
        throw new MicaFixtureWriteError(
          `fixture append write failed at seq ${sequenceNumber}: ${String(err)}`,
          err
        );
      }
    }

    this.chain.push(record);
    return record;
  }

  // ── the three methods MicaReadableLog asks for ─────────────────────────────

  verify(): MicaLogVerifyResult {
    for (let i = 0; i < this.chain.length; i++) {
      const record = this.chain[i];
      const expectedPrev =
        i === 0 ? GENESIS_PREV_HASH : this.chain[i - 1].hash;
      if (record.previousHash !== expectedPrev) return { valid: false, brokenAt: i };
      if (record.hash !== hashRecord(i, record.previousHash, record)) {
        return { valid: false, brokenAt: i };
      }
    }
    return { valid: true };
  }

  getLoadState(): MicaFixtureLoadState {
    return this.loadState;
  }

  getAll(): readonly MicaFixtureRecord[] {
    return this.chain;
  }

  // ── fixture convenience, not part of MicaReadableLog ───────────────────────

  get length(): number {
    return this.chain.length;
  }
}

/**
 * A fixture log is a MicaReadableLog. Asserted at compile time so the fixture
 * cannot drift off the interface it exists to satisfy.
 *
 * (`implements` on the class already enforces this; the alias states it in a
 * form a reader can find by searching for the interface name.)
 */
export type MicaFixtureLogIsReadable = MicaFixtureLog extends MicaReadableLog
  ? MicaLogRecord
  : never;
