// ── MICA · the floor trail — one thermometer reading per decision ───────────
//
// WHAT THIS IS
//
//   An append-only, hash-chained trail of the composed floor at every
//   chokepoint decision — RELEASE, HOLD, HOLD-BLIND, and PASS-BLIND. It records
//   the per-sensor kinds in the same order as their ids, so a later reader can
//   tell which factor was unread or adverse rather than seeing only the floor.
//
// WHAT DOES NOT READ IT TODAY
//
//   No sensor reads this file. In particular, it is NOT written into the
//   evidence log MICA's sensors read: doing so would make the instrument measure
//   its own telemetry. This trail exists so FUTURE accumulation readers, if one
//   is ruled, declared, and built, can discount exculpatory evidence from
//   windows whose floor could not be read. No such reader exists here.
//
//   The trail is nevertheless load-bearing at the gate today: the chokepoint
//   issues no RELEASE or PASS-BLIND permit it cannot account for. If no durable
//   floor reading lands, the permit narrows to HOLD-BLIND. A permit without its
//   thermometer reading is the silent fail-open, and the gate refuses it.
//
//   This duplicates the ExportLedger / chokepoint-ledger chain pattern rather
//   than importing either implementation. Their record shapes and purposes are
//   different, and coupling their chain arithmetic would let one ledger's
//   evolution silently change another's evidence format.
//
// TIMESTAMP DISCIPLINE
//
//   On disk, MicaFixtureLog takes timestamp from its append caller and assigns
//   only sequenceNumber itself. The chokepoint wiring therefore accepts an
//   injected decision clock. Where none is injected it uses Date.now(), because
//   the existing guard interface has no per-decision timestamp parameter.

import { createHash, randomBytes } from "crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import type { VerdictKind } from "../types";
import {
  appendStoreTransaction,
  blankLineDetail,
  resyncAppendStore,
  storeLines,
} from "../store/append-store";
import type { AppendResyncTorn, LineAppender, LockAcquirer } from "../store/append-store";
import {
  hasExactKeys,
  isEnum,
  isFiniteNumber,
  isNonNegInteger,
  isObject,
  isString,
  VERDICT_KINDS,
} from "../store/validate";
import type { Parsed } from "../store/validate";
import type { BlindSplit, ChokepointDisposition } from "./types";

export interface FloorTrailRecordInput {
  readonly timestamp: number;
  /** The routed action's opaque id; never its payload. */
  readonly actionId: string;
  readonly disposition: ChokepointDisposition;
  readonly floorKind: VerdictKind;
  readonly blindSplit: BlindSplit;
  /** The action's injected impact class, or "" when none was supplied. */
  readonly impactClass: string;
  /** Sensor ids joined by "|", in decision order. */
  readonly sensorIds: string;
  /** Per-sensor verdict kinds joined by "|", in the same order as sensorIds. */
  readonly sensorKinds: string;
}

export interface FloorTrailRecord extends FloorTrailRecordInput {
  readonly sequenceNumber: number;
  readonly previousHash: string;
  readonly hash: string;
}

/**
 * The chained hash. Field order is fixed and explicit, not taken from
 * JSON.stringify of an object literal, so a future field reordering cannot
 * silently rewrite every hash in an existing trail.
 */
function computeHash(
  r: FloorTrailRecordInput & {
    sequenceNumber: number;
    previousHash: string;
  }
): string {
  const canonical = [
    String(r.sequenceNumber),
    r.previousHash,
    String(r.timestamp),
    r.actionId,
    r.disposition,
    r.floorKind,
    r.blindSplit,
    r.impactClass,
    r.sensorIds,
    r.sensorKinds,
  ].join(" ");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Identical vocabulary to the sibling ledger's load state. */
export type FloorTrailLoadState =
  | "IN_MEMORY"
  | "LOADED_VERIFIED"
  | "FIRST_BOOT_OR_ERASED"
  | "CANNOT_VERIFY";

const DISPOSITIONS: readonly ChokepointDisposition[] = [
  "RELEASE",
  "HOLD",
  "HOLD_BLIND",
  "PASS_BLIND",
];

const BLIND_SPLITS: readonly BlindSplit[] = [
  "NOT_APPLICABLE",
  "ABOVE_LINE",
  "BELOW_LINE",
  "NO_USABLE_LINE_CAUTIOUS_DEFAULT",
];

const FLOOR_TRAIL_RECORD_KEYS: readonly string[] = [
  "timestamp",
  "actionId",
  "disposition",
  "floorKind",
  "blindSplit",
  "impactClass",
  "sensorIds",
  "sensorKinds",
  "sequenceNumber",
  "previousHash",
  "hash",
];

function hasValidSensorKinds(sensorKinds: string): boolean {
  if (sensorKinds === "") return true;
  return sensorKinds
    .split("|")
    .every((kind) => (VERDICT_KINDS as readonly string[]).includes(kind));
}

/** Closed-shape validation before any parsed record reaches the chain. */
function validateFloorTrailRecord(x: unknown): FloorTrailRecord | null {
  if (!isObject(x)) return null;
  const o = x as Parsed;
  if (!hasExactKeys(o, FLOOR_TRAIL_RECORD_KEYS)) return null;
  if (!isFiniteNumber(o.timestamp)) return null;
  if (!isString(o.actionId)) return null;
  if (!isEnum(o.disposition, DISPOSITIONS)) return null;
  if (!isEnum(o.floorKind, VERDICT_KINDS)) return null;
  if (!isEnum(o.blindSplit, BLIND_SPLITS)) return null;
  if (!isString(o.impactClass)) return null;
  if (!isString(o.sensorIds)) return null;
  if (!isString(o.sensorKinds) || !hasValidSensorKinds(o.sensorKinds)) return null;
  if (!isNonNegInteger(o.sequenceNumber)) return null;
  if (!isString(o.previousHash)) return null;
  if (!isString(o.hash)) return null;
  return o as unknown as FloorTrailRecord;
}

export interface FloorTrailVerifyResult {
  readonly valid: boolean;
  readonly brokenAt: number | null;
}

// R8's declared modality, repeated verbatim like everything else in this block.
// The three spellings must equal the retainer's or a drop from here would land
// as MALFORMED_SUBMISSION; `witnessd.test.ts` holds both lists and asserts it.
export type Modality = "OFFERED" | "IMPOSED" | "NOT_AN_INSTRUCTION";

export const MODALITIES: readonly Modality[] = [
  "OFFERED",
  "IMPOSED",
  "NOT_AN_INSTRUCTION",
];

// Field names are repeated verbatim from MICA S-4 v0.3 §4 — FOUR fields until
// 2026-08-26, when `modality` joined the freeze (The arbiter, S88). This declaration
// is local on purpose: the trail is a submitter and imports neither the witness
// nor ILAS. A retainer's evolution must not reshape the chain that submits to it.
//
// THIS BOOK'S COMMITTER IS STILL NOT WIRED ANYWHERE (P1-e stays fenced; see the
// note at `src/glue/wire.ts`). The type and the producer body move here for one
// reason only: the ASSERTED byte-identity with `src/witness/drop-committer.ts`,
// which is a property of the two BODIES and not of anyone's wiring. Leaving this
// one at four fields would break that assertion and leave the trail's producer
// silently emitting drops the v0.3 intake would retain as UNDECLARED_MODALITY.
export interface HeadCommit {
  readonly seq_no: number;
  readonly head_hash: string;
  readonly ts: number;
  readonly witness_set_id: string;
  readonly modality: Modality;
}

export type HeadCommitter = (commit: HeadCommit) => void;

export const HEAD_COMMIT_IS_NOT_A_GATE =
  "Committing a head to a witness makes REWRITING this trail loud. It does not " +
  "make this decision safer, does not gate any permit, and is never a precondition " +
  "of one. An absent or failing witness narrows nothing here — a deployment without " +
  "a witness simply has no continuity claim, which its reader reports as unverifiable, " +
  "never as clear.";

export const COMMIT_IS_NOT_RETENTION =
  "This module can prove it CALLED a committer. It cannot prove anything was " +
  "retained, by whom, or where. Submission is not proof of retention; the evidential " +
  "object is the witness's own store, which this module cannot see and does not attest.";

/**
 * Deliberately dumb file transport. `submitterId` is the drop filename exactly,
 * and deployment configuration must carry that same id in the witness's
 * `declaredSubmitters`; this code invents no identity.
 *
 * A commit dropped before the poller consumed the previous one REPLACES it. The
 * newer commit is the one kept — a receipt at a later seq constrains a longer
 * prefix of the chain. This client cannot detect the overwrite: a write-only
 * intake is the permission shape that buys the independence this code cannot
 * assert.
 */
/** The mode an in-flight frame is chmod'ed to before it becomes a submission. */
export const HEAD_DROP_FILE_MODE = 0o640;

/**
 * The bytes a drop file holds: exactly the five frozen keys, in this order.
 *
 * The commit is REBUILT field by field rather than re-serialised, so whatever
 * else a caller's object carries never reaches the intake. The far end's
 * validator is `hasExactKeys(HEAD_KEYS)`, and a SIXTH key that got through would
 * land as a MALFORMED_SUBMISSION against a submitter that did nothing wrong.
 *
 * Mirrors `canonicalDropBytes` in the sibling exactly, INCLUDING the absence of
 * a trailing newline: a drop is a whole-file JSON document, not a line. (The
 * pre-S86 body here appended one. Nothing read it — the far end parses whole
 * bytes — but the two producers must not differ by so much as a byte.)
 */
export function canonicalHeadDropBytes(commit: HeadCommit): string {
  return JSON.stringify({
    seq_no: commit.seq_no,
    head_hash: commit.head_hash,
    ts: commit.ts,
    witness_set_id: commit.witness_set_id,
    modality: commit.modality,
  });
}

/**
 * Narrow test seam, mirroring the sibling's. Production leaves both absent.
 *
 * `rename` exists so a test can stand INSIDE the instant of replacement — the
 * property being claimed is that the destination name holds the OLD drop or the
 * NEW one and never a half of either, and there is nowhere else to watch it from.
 */
export interface HeadDropSeam {
  readonly rename?: (from: string, to: string) => void;
  readonly suffix?: () => string;
}

/**
 * ── THIS BODY IS A DELIBERATE DUPLICATE ──────────────────────────────────────
 *
 * Its ASSERTING SIBLING is `fileDropCommitter` in
 * `src/witness/drop-committer.ts`. The two are equivalent producers on purpose,
 * not by accident, and this one may not simply import the other: the closure
 * ruling of 2026-08-12 is that `src/mica/` reaches outside itself along NO edge
 * at all, and `src/witness/` is outside. That ruling stands (S86, C1 — ruled to
 * fix in place rather than erode it); the duplication is the accepted price, the
 * same price this file already pays for `HeadCommit` itself.
 *
 * **ANY FUTURE DIVERGENCE BETWEEN THE TWO BODIES IS A DEFECT IN THIS ONE.**
 *
 * The equality is not a hope. It is asserted byte-for-byte — and the assertion
 * had to be written OUTSIDE this book, because the same closure ruling that
 * forces the duplication also bars a test under `src/mica/` from importing the
 * sibling to compare against. It lives in `src/witness/witnessd.test.ts`.
 *
 * THE TWO BODIES NOW DIVERGE IN NOTHING. Checked at source, S86 and again at
 * S88 when the fifth field landed: the same bare-filename guard, the same dotted
 * frame from the same random suffix, the same `wx` write of the same five
 * rebuilt fields (`modality` joined the S-4 freeze 2026-08-26), the same explicit
 * `chmod 0o640`, the same rename, the same best-effort frame cleanup rethrowing
 * the ORIGINAL error. What differs is names and nothing else — `dir` for
 * `intakeDir`, `HeadDropSeam` for `DropCommitterSeam`,
 * `HEAD_DROP_FILE_MODE` for `DROP_FILE_MODE`, `canonicalHeadDropBytes` for
 * `canonicalDropBytes` — each local because this book declares its own names
 * for everything it will not import.
 *
 * ── NEITHER OF THEM CREATES THE INTAKE, AND THAT IS THE POINT ────────────────
 *
 * This body called `mkdirSync(dir, { recursive: true })` until S86. An intake's
 * permissions are a DEPLOYMENT act — `3730`, group `mica-drops`, submitter
 * `umask 0027`, ruled 2026-08-26 and written into the Linux recipe §5.3 — and a
 * producer that creates a missing intake creates it at the PROCESS UMASK
 * instead: no setgid, wrong group, wrong mode. The tests still passed. The
 * deployer never learned the act had been skipped.
 *
 * So it now throws, and the caller records that it threw: both `notice-log.ts`
 * and this file's own `record()` wrap the committer call in a try/catch and
 * retain the failure. A missing intake surfaces as a RECORDED COMMITTER FAILURE
 * rather than as a directory quietly conjured at the wrong mode. **Do not add a
 * create-if-missing flag, option, or fallback.** An escape hatch is the silence
 * coming back with a name.
 *
 * ── WHAT CHANGED, AND WHY (S86 follow-up) ────────────────────────────────────
 *
 * This function used to write STRAIGHT ONTO the bare submitter-id name, with no
 * mode set. Both halves were live hazards at the far end:
 *
 *   · a witness sweeping mid-write read the torn half and retained a
 *     MALFORMED_SUBMISSION THAT WAS NEVER SENT — an accusation against a
 *     submitter that did nothing wrong, in an append-only book, permanently;
 *   · with no mode the drop landed at `0666 & ~umask`, so a submitter running
 *     under `umask 0077` produced a 0600 file the witness could not read at
 *     all — which, before S86, wedged its sweep permanently and silently.
 *
 * The write is now temp-frame-then-rename inside the SAME directory. That needs
 * exactly one framing rule and has it (RULING A, S86): NAMES BEGINNING WITH
 * `.` ARE IN-FLIGHT FRAMES, NOT SUBMISSIONS, and `pollIntake` does not consume
 * them. `writeFileSync`'s `mode` option would not do — it is umask-masked;
 * `chmodSync` is not.
 */
export function fileDropHeadCommitter(
  dir: string,
  submitterId: string,
  seam: HeadDropSeam = {}
): HeadCommitter {
  if (
    submitterId.length === 0 ||
    submitterId.includes("/") ||
    submitterId.includes("\\") ||
    submitterId.includes("..")
  ) {
    throw new Error("submitterId must be a bare filename");
  }
  const rename = seam.rename ?? renameSync;
  const suffix = seam.suffix ?? (() => randomBytes(8).toString("hex"));

  return (commit) => {
    const target = join(dir, submitterId);
    const frame = join(dir, `.${submitterId}.${suffix()}`);

    // `wx` — a frame name that already exists is not overwritten. Nothing is
    // ever written to `target` directly; it only ever appears by rename.
    writeFileSync(frame, canonicalHeadDropBytes(commit), {
      encoding: "utf8",
      flag: "wx",
    });
    try {
      chmodSync(frame, HEAD_DROP_FILE_MODE);
      rename(frame, target);
    } catch (error) {
      // The frame was never a submission and must not be left behind as one —
      // a dotted name is invisible to the sweep, so it would sit there forever.
      // Removal is best-effort: the ORIGINAL failure is the one worth throwing.
      try {
        rmSync(frame, { force: true });
      } catch {
        /* the reason the rename failed is very likely the reason this did */
      }
      throw error;
    }
  };
}

export interface FloorTrailOptions {
  /** Injected deployment path. Absent means IN_MEMORY, never durable. */
  readonly path?: string;
  /** Fault-injection seam. Production leaves this absent. */
  readonly appender?: LineAppender;
  /**
   * The inter-process append lock. Production leaves this absent and gets
   * `exclusiveFileLock`. A deployment that needs a bounded retry injects it
   * HERE — the store holds no timing policy of its own.
   */
  readonly acquire?: LockAcquirer;
  /** Post-durable transport boundary. It never participates in permit gating. */
  readonly headCommitter?: HeadCommitter;
  /** First durable append, then every N durable appends. Absent means every append. */
  readonly headCommitEvery?: number;
  /** Declared witness-set id copied into the commit; absent is carried as "". */
  readonly witnessSetId?: string;
  /**
   * R8's declaration, stamped onto every head this trail commits (S88). On
   * notify's idiom exactly — construction-time, because this is a MACHINE book
   * and every entry it writes is a permit decision the machine took. Absent is
   * carried as `NOT_AN_INSTRUCTION`.
   *
   * NOTHING SETS THIS TODAY, because nothing wires this trail's committer: P1-e
   * is fenced and stays fenced. The seam exists so the fifth field has a
   * DEPLOYER-facing home when the wiring question is finally taken up, rather
   * than a value hardcoded in a book about itself.
   */
  readonly modality?: Modality;
}

export interface FloorTrailRecordOutcome {
  readonly record: FloorTrailRecord;
  readonly persisted: boolean;
  readonly detail: string | null;
  /** True only when the post-durable committer call returned normally. */
  readonly headCommitted: boolean;
  /** Null when unwired or successful; otherwise why no wired commit landed. */
  readonly headCommitDetail: string | null;
}

/** Append-only floor readings, read by no sensor today. */
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
 * at the operator's uid with no second principal (S103, ruling-log receipt §E): strip a
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
export type FloorTrailFileLook =
  | { readonly state: "PRESENT" }
  | { readonly state: "ABSENT" }
  | { readonly state: "CANNOT_SEE"; readonly detail: string };

export function lookAtFloorTrailFile(path: string): FloorTrailFileLook {
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

/** The signpost handed to a caller that could not look at the floor trail. */
export function cannotSeeFloorTrailMessage(path: string, detail: string): string {
  return (
    `the floor trail could not be looked at, which is NOT the finding that it is ` +
    `absent — this process cannot see ${path} (${detail}). A directory whose ` +
    `execute bit is stripped produces exactly this, and no second principal is ` +
    `needed to reach it. Nothing was created, nothing was recorded as a first ` +
    `boot, and this book is NOT in a persisting state.`
  );
}

export class FloorTrail {
  private readonly chain: FloorTrailRecord[] = [];
  private readonly path: string | null;
  private readonly appender?: LineAppender;
  private readonly acquire?: LockAcquirer;
  private readonly headCommitter?: HeadCommitter;
  private readonly headCommitEvery?: number;
  private readonly witnessSetId: string;
  private readonly modality: Modality;
  private loadState: FloorTrailLoadState = "IN_MEMORY";
  private persisting = false;
  private lastError: string | null = null;
  private durableAppendsThisRun = 0;

  constructor(options?: FloorTrailOptions) {
    this.path = options?.path ?? null;
    this.appender = options?.appender;
    this.acquire = options?.acquire;
    this.headCommitter = options?.headCommitter;
    this.headCommitEvery = options?.headCommitEvery;
    this.witnessSetId = options?.witnessSetId ?? "";
    this.modality = options?.modality ?? "NOT_AN_INSTRUCTION";
    if (
      this.headCommitEvery !== undefined &&
      (!Number.isSafeInteger(this.headCommitEvery) || this.headCommitEvery <= 0)
    ) {
      throw new Error("headCommitEvery must be a positive safe integer");
    }
    if (this.path !== null) this.loadFromDisk();
  }

  private loadFromDisk(): void {
    const path = this.path as string;
    const look = lookAtFloorTrailFile(path);
    if (look.state === "CANNOT_SEE") {
      // NOT FIRST BOOT. See `lookAtFloorTrailFile`: this was `!existsSync(path)`
      // until S103, and a look that was refused arrived here wearing the absent
      // branch's clothes — with `persisting` set, because the mkdir below
      // succeeds on a directory that exists and cannot be entered.
      this.loadState = "CANNOT_VERIFY";
      this.lastError = cannotSeeFloorTrailMessage(path, look.detail);
      return;
    }
    if (look.state === "ABSENT") {
      this.loadState = "FIRST_BOOT_OR_ERASED";
      try {
        // mkdirSync RULED in-bounds (S96-D): only the observed node's own floor
        // trail, written and read back by the same principal; no deployment act
        // names this directory and no other principal is entitled to it.
        // Annotated S97. If a recipe section ever gives it a reader group, this
        // line moves to the wrong side of the rule that day.
        mkdirSync(dirname(path), { recursive: true });
        this.persisting = true;
      } catch (err) {
        this.lastError = `cannot create floor-trail directory: ${String(err)}`;
      }
      return;
    }

    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError = `cannot read floor trail: ${String(err)}`;
      return;
    }

    // THE line rule, imported rather than restated: this loader's count and
    // resyncAppendStore's count must be the same count. See `storeLines`.
    const scan = storeLines(raw);
    if (!scan.ok) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError = blankLineDetail(scan.index, scan.count);
      return;
    }
    const lines = scan.lines;
    for (let i = 0; i < lines.length; i++) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(lines[i]);
      } catch (err) {
        this.loadState = "CANNOT_VERIFY";
        this.lastError = `malformed JSON at line ${i}: ${String(err)}`;
        return;
      }
      const record = validateFloorTrailRecord(parsed);
      if (record === null) {
        this.loadState = "CANNOT_VERIFY";
        this.lastError =
          `record at line ${i} does not match the closed floor-trail schema`;
        return;
      }
      this.chain.push(record);
    }

    const verification = this.verify();
    if (!verification.valid) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError =
        `floor-trail chain verification failed at index ${String(verification.brokenAt)}`;
      return;
    }
    this.loadState =
      this.chain.length === 0 ? "FIRST_BOOT_OR_ERASED" : "LOADED_VERIFIED";
    this.persisting = true;
  }

  /**
   * The disk-truth catch-up, run by the seam while it holds the append lock. The
   * chain loaded at construction may be a stale prefix: another invocation can
   * have appended since. Records that link on are ADOPTED into this chain, so the
   * sequence number derived next is the true one; an extension that does not link
   * adopts nothing and fails the append typed.
   */
  private resyncUnderLock(): string | AppendResyncTorn | null {
    const result = resyncAppendStore<FloorTrailRecord>({
      path: this.path as string,
      known: this.chain,
      validate: validateFloorTrailRecord,
      recomputeHash: (record) => computeHash(record),
    });
    // A torn file is carried as a torn file, so the seam does not tell the
    // operator another writer forked this trail over a line that holds no record.
    if (!result.linked) {
      return result.torn === true
        ? { torn: true, detail: result.detail }
        : result.detail;
    }
    for (const record of result.extension) this.chain.push(record);
    return null;
  }

  record(input: FloorTrailRecordInput): FloorTrailRecordOutcome {
    const outcome = appendStoreTransaction<FloorTrailRecord>({
      path: this.path,
      persisting: this.persisting,
      lastError: this.lastError,
      storeLabel: "floor trail",
      // Derived INSIDE the lock, after the catch-up above: a sequence number
      // computed from the chain as it stood at construction is the fork.
      prepare: () => {
        const sequenceNumber = this.chain.length;
        const previousHash =
          sequenceNumber === 0 ? "" : this.chain[sequenceNumber - 1].hash;
        const hash = computeHash({ ...input, sequenceNumber, previousHash });
        const record: FloorTrailRecord = {
          ...input,
          sequenceNumber,
          previousHash,
          hash,
        };
        return {
          record,
          line: JSON.stringify(record) + "\n",
          commit: () => this.chain.push(record),
        };
      },
      resync: () => this.resyncUnderLock(),
      appender: this.appender,
      acquire: this.acquire,
      memoryDetail:
        "no floor-trail path was injected: this reading is IN MEMORY only and " +
        "does not survive the process. It carries integrity but not provenance.",
      notPersistingDetail:
        "the floor trail is not in a persisting state; the reading was not written to disk.",
      onAppendBlocked: (detail) => {
        this.lastError = detail;
        return detail;
      },
      onAppendError: (raw) => {
        this.lastError = `cannot append to floor trail: ${raw}`;
        return this.lastError;
      },
    });
    const record = outcome.record;
    let headCommitted = false;
    let headCommitDetail: string | null = null;
    if (this.headCommitter !== undefined) {
      if (!outcome.persisted) {
        headCommitDetail =
          "floor-trail append was not durably persisted; no head was committed";
      } else {
        this.durableAppendsThisRun++;
        const due =
          this.headCommitEvery === undefined ||
          (this.durableAppendsThisRun - 1) % this.headCommitEvery === 0;
        if (!due) {
          headCommitDetail =
            `head commit not due at cadence ${this.headCommitEvery}; ` +
            `durable append ${this.durableAppendsThisRun} of this run`;
        } else {
          try {
            this.headCommitter({
              seq_no: record.sequenceNumber,
              head_hash: record.hash,
              ts: record.timestamp,
              witness_set_id: this.witnessSetId,
              modality: this.modality,
            });
            headCommitted = true;
          } catch (err) {
            headCommitDetail = `head committer threw: ${String(err)}`;
          }
        }
      }
    }
    return {
      record,
      persisted: outcome.persisted,
      detail: outcome.detail,
      headCommitted,
      headCommitDetail,
    };
  }

  verify(): FloorTrailVerifyResult {
    for (let i = 0; i < this.chain.length; i++) {
      const record = this.chain[i];
      if (record.sequenceNumber !== i) return { valid: false, brokenAt: i };
      const expectedPrevious = i === 0 ? "" : this.chain[i - 1].hash;
      if (record.previousHash !== expectedPrevious) {
        return { valid: false, brokenAt: i };
      }
      if (computeHash(record) !== record.hash) return { valid: false, brokenAt: i };
    }
    return { valid: true, brokenAt: null };
  }

  getAll(): readonly FloorTrailRecord[] {
    return this.chain;
  }

  getLoadState(): FloorTrailLoadState {
    return this.loadState;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  get length(): number {
    return this.chain.length;
  }
}
