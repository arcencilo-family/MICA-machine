#!/usr/bin/env node
// ── MICA · seeingd — the witness's SEEING half, as a process ─────────────────
//
//   ts-node src/witness/seeingd.ts \
//     --intake <dir> --book <file> --state <dir> \
//     --witness-intake <dir> --submitter-id <id> --witness-set-id <id> | --no-witness \
//     [--close-timeout-ms 600000] [--tick-ms 1000] [--once]
//
// RULED (the arbiter, board 2026-10-10 18:20Z): the witness sees AND writes; everyone
// reads its record. One seat, two halves — built as TWO PRINCIPALS: `witnessd`
// RETAINS (heads at an intake, no reads answered — S85, unchanged); THIS process
// SEES and is a declared SUBMITTER to witnessd. It looks at the one target each
// act claimed, after the act, and writes what changed into ITS OWN BOOK OF
// EFFECTS, of which it is the sole writer. It answers no reads: the book is a
// file, and every role reads the file.
//
// ⚠ TAMPER-EVIDENT, NOT TAMPER-PROOF (S210, 18:26Z (c)): the book is chained and
//   its heads reach witnessd while they reach it (a failed submission is not
//   fatal); root on this box can rewrite both. Heads published off the box are
//   S210's step, not this file's.
//
// ── WHAT ARRIVES, AND FROM WHOM ──────────────────────────────────────────────
//
//   Pointers, from the bridge only (see `seeing-intake.ts`). An ATTEMPT names the
//   act's claimed target; the witness only REMEMBERS it (no look yet). A CLOSE
//   says the act ended and carries its fate (the /guard decision, or that it ran
//   unguarded); the witness takes its ONE look and writes one record, the facet
//   against its own last look at that target (phase R, audit 2026-10-11 09:32Z).
//
// ── ONE SWEEP ────────────────────────────────────────────────────────────────
//
//   Every ATTEMPT in the intake is looked at FIRST (so a look lands as early as
//   it can), then every CLOSE is written, then every pending act past the close
//   timeout is written (each with its own clock read). The private state is
//   persisted ONCE, and the drops are removed only after that. A crash anywhere
//   in a sweep replays it: an act already in the book is never written twice
//   (refuter A-F3).
//
// ── THE BOOK IS THE TRUTH; THE STATE IS A CACHE (audit 2026-10-11 12:51Z ①) ──
//
//   The state names the last book record it reflects. On start, every record
//   past that one — written before a crash took the persist — re-baselines its
//   target from the look the BOOK recorded, so the next act's facet is read
//   against the book's own previous record for that path, never a stale look.
//
// ── ONE METHOD PER BOOK (W-1, audit 2026-10-11 18:43Z) ───────────────────────
//
//   A book's first line names the method it is kept under. Started under a new
//   method beside a book begun under another, the witness RETIRES that book
//   unaltered and begins a new one whose first line declares it as predecessor.
//
// ── EXIT CODES ───────────────────────────────────────────────────────────────
//   0  a --once sweep completed, or a signal stopped the daemon
//   1  it could not start: a path missing, the book not loadable appendably
//   2  the arguments are wrong
//   3  a book append did not land; the drop and the pending act are kept
//   4  an unexpected fault in a sweep (restartable: the unit restarts on 4 only)

import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, watch, writeSync } from "fs";
import { createHash, randomBytes } from "crypto";
import { dirname, join, resolve } from "path";

import { SubjectEventJournal } from "../glue/subject-event-journal";
import { fileDropNamedCommitter } from "./drop-committer";
import type { NamedHeadCommit } from "./types";
import {
  classifyFacet,
  consequenceEventType,
  consequenceOutcome,
  look,
  publicLook,
  SEEING_METHOD,
  SEEING_METHOD_DIGEST,
  SYSTEM_CLOCK,
  type EffectClass,
  type Look,
  type LookContext,
  type PublicLook,
  type SeeingClock,
} from "./seeing";
import { actKey, parsePointer, type AttemptPointer, type ClosePointer, type Pointer } from "./seeing-intake";

// (phase R shrink, audit 2026-10-11 09:32Z: one look per act; the witness keeps only its LAST look per target.)
/** How many targets the witness remembers; the least recently looked-at is forgotten first (a forgotten target
 *  reads FIRST_SEEN again — its targetFingerprint still recurs in the book, so the coverage line counts that). */
export const TARGETS_REMEMBERED = 2000;
/** The private state's size bound, bytes: the oldest targets are forgotten past it (refuter B M3). */
export const STATE_BYTE_CAP = 4 * 1024 * 1024;
/** The chain id this book's heads carry at witnessd's intake. */
export const EFFECTS_CHAIN_ID = "witness-effects";
export const DEFAULT_CLOSE_TIMEOUT_MS = 600000;
/**
 * At most this many acts wait for their CLOSE (refuter R2 F4). Past it the OLDEST is closed at once (fate
 * LATE_PENDING_CAP), so the private state is bounded by construction: 512 pending acts of a 4096-byte target fit
 * well inside STATE_BYTE_CAP, and the last looks take the rest.
 */
export const PENDING_CAP = 512;

/**
 * THE BOOK'S FIRST LINE: the method it is kept under, its ceilings, and its predecessor. A book names ONE method; a
 * book begun under another is retired, not continued (`retireIfAnotherMethod`), and its successor's first line says so.
 */
export function effectsBookBoundaryBasis(predecessorMethod: string | null): string {
  return (
    "THE WITNESS'S BOOK OF EFFECTS · FIRST LINE. Written only by the witness's seeing half (seeingd), one record " +
    "per act it was pointed at: ONE look at the ONE target the act claimed, as a facet against the witness's own " +
    "last look at that target — since the witness last looked, never caused by the act — in the closed vocabulary " +
    `of the published method named by each record's class (method ${SEEING_METHOD_DIGEST}). One look by one internal ` +
    "process: Lane A, EG-1. READ UNDER THESE CEILINGS: " +
    SEEING_METHOD.ceilings.join(" ") +
    (predecessorMethod === null
      ? " retired is null because no predecessor of this book is declared."
      : ` retired names this book's predecessor: the book this witness kept under method ${predecessorMethod}, retired ` +
        `unaltered (renamed, never edited) when the witness started under method ${SEEING_METHOD_DIGEST}. The last look ` +
        "the predecessor records for a target remains the witness's last look at it; acts recorded there stay recorded.")
  );
}
export const EFFECTS_BOOK_BOUNDARY_BASIS = effectsBookBoundaryBasis(null);

/**
 * THE ACT'S FATE, from its own records (never the witness's sight): RAN — a /guard decision to execute; HELD — a
 * decision not to; LATE_UNGUARDED — the caller's record says it ran with no /guard answer; LATE_NO_DECISION — a
 * CLOSE with no decision the witness can read; LATE_TIMEOUT / LATE_PENDING_CAP — no CLOSE reached the witness.
 * Each of RAN, HELD and the LATE_* maps to the outcome facet HELD / LATE (RAN takes the facet from the look).
 */
export type Fate = "RAN" | "HELD" | "LATE_UNGUARDED" | "LATE_NO_DECISION" | "LATE_TIMEOUT" | "LATE_PENDING_CAP";
/** How the witness came to look: at the act's close, or because the wait ran out. */
type LookBasis = "CLOSE" | "CLOSE_TIMEOUT" | "PENDING_CAP";

interface PendingAct {
  readonly attempt: AttemptPointer;
  /** When the witness took the ATTEMPT: wall (for reading), monotonic ns and boot (for the close timeout). */
  readonly receivedAt: number;
  readonly receivedMono: string;
  readonly receivedBoot: string;
  /** The intake name of the ATTEMPT drop: it STAYS in the intake until the act is written (R2-bytes F4). */
  readonly drop: string | null;
}

interface SeeingState {
  readonly v: 6;
  /**
   * The witness's OWN last look at each target: the one a facet is read against. A look this process took is held
   * raw; one re-baselined from the book (`rebuildFromBook`) is the book's public form — the facet map reads both alike.
   */
  last: Record<string, Look | PublicLook>;
  /** Targets in last-looked order, most recent last — the forgetting order. */
  order: string[];
  pending: Record<string, PendingAct>;
  /** The last book record this state reflects (its position and hash), or null before the first persist. */
  book: { readonly seq: number; readonly hash: string } | null;
}

const HEX64 = /^[0-9a-f]{64}$/;
/** A look in the book's public form (path-bound tokens), as against a raw look. */
const isPublic = (l: Look | PublicLook): l is PublicLook => "meta" in l;

export interface SeeingWitnessOptions {
  readonly intakeDir: string;
  readonly bookPath: string;
  readonly stateDir: string;
  readonly committer?: (commit: NamedHeadCommit) => void;
  readonly witnessSetId?: string;
  readonly closeTimeoutMs?: number;
  /** Injected for tests; the box's clocks otherwise. */
  readonly clock?: SeeingClock;
  /** Injected for tests; `look` otherwise. */
  readonly lookAt?: (path: string, ctx: LookContext) => Look;
  /** Tests only: a smaller pending cap / state byte cap than the deployment's. */
  readonly pendingCap?: number;
  readonly stateByteCap?: number;
  readonly log?: (line: string) => void;
}

export interface SweepReport {
  readonly attempts: number;
  readonly closes: number;
  readonly written: number;
  readonly timedOut: number;
  readonly quarantined: number;
  readonly orphanCloses: number;
  readonly replays: number;
  /** Set when a book append did not land: the sweep stopped there, its drops and acts kept. */
  readonly appendFailure: string | null;
}

/** The witness's private digest key: 32 random bytes, 0600, made once. */
export function loadOrMakeDigestKey(stateDir: string): Buffer {
  const p = join(stateDir, "digest.key");
  if (existsSync(p)) {
    // The key is the witness's alone (R2-bytes N6): a key any other uid could read or write is refused.
    const st = statSync(p);
    if ((st.mode & 0o077) !== 0 || (typeof process.getuid === "function" && st.uid !== process.getuid())) {
      throw new Error(`digest key ${p} is not 0600 and owned by this uid`);
    }
    const k = readFileSync(p);
    if (k.length !== 32) throw new Error(`digest key ${p} is ${k.length} bytes, not 32`);
    return k;
  }
  const k = randomBytes(32);
  const fd = openSync(p, "wx", 0o600);
  try {
    writeSync(fd, k);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(p, 0o600);
  return k;
}

export class SeeingWitness {
  private readonly o: Required<Omit<SeeingWitnessOptions, "committer" | "witnessSetId">> & Pick<SeeingWitnessOptions, "committer" | "witnessSetId">;
  private journal: SubjectEventJournal;
  private readonly statePath: string;
  private readonly quarantineDir: string;
  private readonly ctx: LookContext;
  private state: SeeingState;
  /** Acts already in the book, with the identity they were written under: a replay writes nothing. */
  private readonly recorded = new Map<string, { readonly sessionId: string; readonly actionId: string }>();
  private lastTimestamp = 0;

  constructor(options: SeeingWitnessOptions) {
    this.o = {
      intakeDir: resolve(options.intakeDir),
      bookPath: resolve(options.bookPath),
      stateDir: resolve(options.stateDir),
      committer: options.committer,
      witnessSetId: options.witnessSetId,
      closeTimeoutMs: options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS,
      clock: options.clock ?? SYSTEM_CLOCK,
      lookAt: options.lookAt ?? look,
      pendingCap: options.pendingCap ?? PENDING_CAP,
      stateByteCap: options.stateByteCap ?? STATE_BYTE_CAP,
      log: options.log ?? ((line: string) => console.error(line)),
    };
    if (!existsSync(this.o.intakeDir)) throw new Error(`intake ${this.o.intakeDir} does not exist (a deployment act)`);
    if (!existsSync(this.o.stateDir)) throw new Error(`state dir ${this.o.stateDir} does not exist (a deployment act)`);
    this.statePath = join(this.o.stateDir, "state.json");
    this.quarantineDir = join(this.o.stateDir, "quarantine");
    if (!existsSync(this.quarantineDir)) mkdirSync(this.quarantineDir, { mode: 0o700 });
    const keyIsNew = !existsSync(join(this.o.stateDir, "digest.key"));
    this.ctx = {
      key: loadOrMakeDigestKey(this.o.stateDir),
      clock: this.o.clock,
      // The witness's own directories are never targets (SELF): its state holds plain targets and its key.
      // RESOLVED, so a target named through another spelling of them is still SELF (R2-bytes N6).
      selfRoots: [this.o.intakeDir, this.o.stateDir, dirname(this.o.bookPath)].map((d) => realpathSync(d)),
    };
    this.journal = new SubjectEventJournal({ path: this.o.bookPath });
    if (!this.journal.isPersisting()) {
      throw new Error(`the book ${this.o.bookPath} did not load appendably: ${this.journal.getLoadState()} — ${this.journal.getLastError() ?? ""}`);
    }
    if (this.journal.getAll().length === 0) {
      const b = this.journal.appendBoundary(null, EFFECTS_BOOK_BOUNDARY_BASIS, this.o.clock.wall());
      if (!b.persisted) throw new Error(`the book's boundary did not land: ${b.detail ?? ""}`);
    }
    this.noteRecorded(this.journal.getAll());
    // Acts recorded in a DECLARED predecessor stay recorded, so a replayed drop is never written twice across books.
    const pred = (this.journal.getAll()[0] as { retired?: { path?: unknown } | null } | undefined)?.retired?.path;
    if (typeof pred === "string" && existsSync(pred)) {
      const lines: Record<string, unknown>[] = [];
      for (const l of readFileSync(pred, "utf8").split("\n")) {
        if (l.trim() === "") continue;
        try {
          lines.push(JSON.parse(l) as Record<string, unknown>);
        } catch {
          this.o.log(`[seeingd] a line of the predecessor book ${pred} does not parse; its acts are not counted as recorded`);
          break;
        }
      }
      this.noteRecorded(lines);
    }
    this.state = this.loadState();
    this.rebuildFromBook(keyIsNew);
    this.retireIfAnotherMethod();
  }

  /** Acts a book holds, with the identity they were written under (a replay writes nothing); and the latest time. */
  private noteRecorded(records: readonly Record<string, unknown>[] | readonly { timestamp?: unknown }[]): void {
    for (const r0 of records) {
      const r = r0 as Record<string, unknown> & { witnessed?: { cites?: { subjectSeq?: unknown; chain?: unknown; sessionId?: unknown } } };
      if (typeof r.timestamp === "number" && r.timestamp > this.lastTimestamp) this.lastTimestamp = r.timestamp;
      const cites = r.witnessed?.cites;
      if (r.recordType === "SUBJECT_EVENT" && typeof cites?.subjectSeq === "number") {
        const chain = typeof cites.chain === "string" ? cites.chain : null;
        this.recorded.set(actKey(String(r.moduleId), chain, cites.subjectSeq), { sessionId: String(cites.sessionId), actionId: String(r.actionId) });
      }
    }
  }

  /**
   * A BOOK NAMES ONE METHOD (W-1, audit 2026-10-11 18:43Z, moved the method under a live book). When the book's first
   * line names another method than this code's, the witness RETIRES it — renamed beside itself, never edited, never
   * deleted — and begins a new book whose first line names this method and declares the old one as its predecessor
   * (path, records, bytes and sha256, read before the rename). The private state stays: the last look the predecessor
   * records for a target remains the witness's last look at it (the key is the same, so the digests still compare).
   */
  private retireIfAnotherMethod(): void {
    const all = this.journal.getAll();
    const first = all[0] as { basis?: unknown } | undefined;
    const named = typeof first?.basis === "string" ? /\(method ([0-9a-f]{64})\)/.exec(first.basis) : null;
    const bookMethod = named === null ? "unnamed" : named[1];
    if (bookMethod === SEEING_METHOD_DIGEST) return;
    const raw = readFileSync(this.o.bookPath);
    const retired = {
      path: `${this.o.bookPath}.retired-method-${bookMethod.slice(0, 16)}-${String(this.o.clock.wall())}`,
      records: all.length,
      bytes: raw.length,
      sha256: createHash("sha256").update(raw).digest("hex"),
    };
    renameSync(this.o.bookPath, retired.path);
    const dfd = openSync(dirname(this.o.bookPath), "r");
    try {
      fsyncSync(dfd);
    } finally {
      closeSync(dfd);
    }
    this.journal = new SubjectEventJournal({ path: this.o.bookPath });
    if (!this.journal.isPersisting() || this.journal.getAll().length !== 0) {
      throw new Error(`after retiring the book as ${retired.path}, a new book did not open empty and appendable at ${this.o.bookPath}`);
    }
    const b = this.journal.appendBoundary(retired, effectsBookBoundaryBasis(bookMethod), Math.max(this.o.clock.wall(), this.lastTimestamp));
    if (!b.persisted) throw new Error(`the book was retired as ${retired.path} but the new book's first line did not land: ${b.detail ?? ""}`);
    this.persistState(); // the state now reflects the new book's first line
    this.o.log(
      `[seeingd] the book's first line names method ${bookMethod}; this witness runs method ${SEEING_METHOD_DIGEST}: the book is ` +
        `RETIRED unaltered as ${retired.path} (${String(retired.records)} records, ${String(retired.bytes)} B, sha256 ${retired.sha256}); ` +
        "a new book begins, its first line naming this method and that predecessor"
    );
  }

  private loadState(): SeeingState {
    const empty = (): SeeingState => ({ v: 6, last: {}, order: [], pending: {}, book: null });
    if (!existsSync(this.statePath)) return empty();
    try {
      const s = JSON.parse(readFileSync(this.statePath, "utf8")) as SeeingState;
      if (s.v !== 6 || typeof s.last !== "object" || !Array.isArray(s.order) || typeof s.pending !== "object") throw new Error("shape");
      const b = s.book as unknown;
      if (!(b === null || (typeof b === "object" && b !== null && Number.isSafeInteger((b as { seq?: unknown }).seq) && HEX64.test(String((b as { hash?: unknown }).hash))))) {
        throw new Error("shape");
      }
      return s;
    } catch {
      // An unreadable state is SET ASIDE, never parsed around: the witness starts
      // empty — the book re-baselines what it can match (`rebuildFromBook`); any
      // other target reads FIRST_SEEN until it has looked again — and says so. The
      // plain targets it held stay in the set-aside file (0600).
      const aside = join(this.o.stateDir, `state.json.unreadable-${this.o.clock.wall()}`);
      renameSync(this.statePath, aside);
      this.o.log(`[seeingd] the private state could not be read; set aside as ${aside}; starting with no last looks (the book re-baselines what it can match; any other target reads FIRST_SEEN until the witness has looked again)`);
      return empty();
    }
  }

  /** Sets the state aside (0600 kept, never deleted) and starts empty: every pending act is re-read from its drop. */
  private setAside(word: string, why: string): void {
    const aside = join(this.o.stateDir, `state.json.${word}-${String(this.o.clock.wall())}`);
    if (existsSync(this.statePath)) renameSync(this.statePath, aside);
    this.state = { v: 6, last: {}, order: [], pending: {}, book: null };
    this.o.log(`[seeingd] ${why}; the private state is set aside as ${aside}; starting with no last looks (every pending act is re-read from its drop)`);
  }

  /**
   * THE BOOK IS THE TRUTH; THE STATE IS A CACHE (audit 2026-10-11 12:51Z ①). The state names the book record it was
   * persisted at; every record PAST it (a crash between the append and the persist) re-baselines its target from the
   * look the BOOK recorded, in book order — so the next act's facet is read against the book's own previous record for
   * that path. The book holds no plain target: a record is matched to its target through its act's ATTEMPT, which
   * stays in the private state or the intake until the act is written AND the state persisted, and the match must
   * agree on the act's identity and the bridge's target fingerprint. A record that cannot be matched may be the one
   * that superseded a cached look, so it FORGETS (audit 2026-10-11 15:27Z): the look of the target its ATTEMPT names, or
   * — when no ATTEMPT names one — every look cached before it (records matched after it re-baseline as usual). A
   * forgotten target reads FIRST_SEEN until looked at again (Gate 2's coverage line counts that recurrence); it never
   * reads a facet against a look the book has already moved past.
   */
  private rebuildFromBook(keyIsNew: boolean): void {
    const all = this.journal.getAll() as readonly (Record<string, unknown> & { sequenceNumber: number; hash: string })[];
    const head = all[all.length - 1];
    let from = 1; // position 0 is the book's first line
    if (keyIsNew && this.state.order.length > 0) {
      // Every token and digest in the state and the book was made under a key the witness no longer holds.
      this.setAside("key-lost", "the digest key is new but the state holds looks made under the old one");
    } else if (this.state.book !== null) {
      const at = all[this.state.book.seq] as { hash?: string } | undefined;
      if (at === undefined || at.hash !== this.state.book.hash) {
        this.setAside("not-this-book", `the state reflects book record ${String(this.state.book.seq)}, which this book does not hold`);
      } else from = this.state.book.seq + 1;
    }
    if (from > head.sequenceNumber) return; // the state reflects the whole book
    if (keyIsNew) {
      // The book's tokens are under the lost key: nothing in it compares to a look taken now.
      this.o.log(`[seeingd] the digest key is new: the book's ${String(head.sequenceNumber - from + 1)} record(s) were made under another key and re-baseline nothing`);
      this.state.book = { seq: head.sequenceNumber, hash: head.hash };
      this.persistState();
      return;
    }
    // Each act's target, from the ATTEMPTs the witness still holds: pending in the state, then waiting in the intake.
    const targets = new Map<string, AttemptPointer>();
    for (const p of Object.values(this.state.pending)) targets.set(actKey(p.attempt.subject, p.attempt.chain, p.attempt.subjectSeq), p.attempt);
    for (const name of readdirSync(this.o.intakeDir).filter((n) => !n.startsWith("."))) {
      try {
        const path = join(this.o.intakeDir, name);
        if (!lstatSync(path).isFile()) continue;
        const r = parsePointer(readFileSync(path, "utf8"));
        if (r.ok && r.pointer.kind === "ATTEMPT") {
          const a = r.pointer;
          const k = actKey(a.subject, a.chain, a.subjectSeq);
          if (!targets.has(k)) targets.set(k, a);
        }
      } catch {
        // an unreadable drop maps nothing here; the sweep says what it cannot read
      }
    }
    let rebuilt = 0, unmatched = 0, forgotten = 0;
    const forget = (t: string): void => {
      if (this.state.last[t] === undefined) return;
      delete this.state.last[t];
      const i = this.state.order.lastIndexOf(t);
      if (i >= 0) this.state.order.splice(i, 1);
      forgotten++;
    };
    for (const r of all.slice(from)) {
      const w = r.witnessed as { cites?: { chain?: unknown; subjectSeq?: unknown; sessionId?: unknown; targetFingerprint?: unknown }; look?: unknown } | undefined;
      const c = w?.cites;
      const l = w?.look as PublicLook | undefined;
      if (r.recordType !== "SUBJECT_EVENT" || c === undefined || typeof c.subjectSeq !== "number") continue;
      const a = targets.get(actKey(String(r.moduleId), typeof c.chain === "string" ? c.chain : null, c.subjectSeq));
      const lookOk = typeof l === "object" && l !== null && "meta" in l && typeof l.at === "number" && typeof l.state === "string";
      if (a === undefined || !lookOk || a.sessionId !== c.sessionId || a.actionId !== r.actionId || a.targetFingerprint !== c.targetFingerprint) {
        unmatched++;
        if (a !== undefined) forget(a.target);
        else for (const t of [...this.state.order]) forget(t); // the record names no target: no cached look is safe
        continue;
      }
      this.setLast(a.target, l as PublicLook);
      rebuilt++;
    }
    if (rebuilt + unmatched > 0) {
      this.o.log(
        `[seeingd] the book holds ${String(rebuilt + unmatched)} act record(s) past the state's last persist: ${String(rebuilt)} re-baselined from the book, ` +
          `${String(unmatched)} not matched to a target — ${String(forgotten)} cached look(s) forgotten for it (those targets read FIRST_SEEN until looked at again)`
      );
    }
    this.state.book = { seq: head.sequenceNumber, hash: head.hash };
    this.persistState();
  }

  /** Atomic, durable replace, 0600: the state holds plain targets, and only this uid reads it. */
  private persistState(): void {
    // ONE PASS (refuter R2 F4): each target's share of the serialised state is measured once; the least recently
    // looked-at targets go until the rest fits; the state is serialised once. Pending acts are bounded by
    // pendingCap, so the looks can always make room — a state over the cap is said, never written silently.
    const cap = this.o.stateByteCap;
    const share = (t: string): number => {
      const k = Buffer.byteLength(JSON.stringify(t)); // the quoted target string
      // the target costs ONE key in `last` (k:value,) and ONE entry in `order` (k,): about 2k.
      return 2 * k + Buffer.byteLength(JSON.stringify(this.state.last[t] ?? null)) + 3;
    };
    const all = this.journal.getAll();
    const head = all[all.length - 1];
    this.state.book = head === undefined ? null : { seq: head.sequenceNumber, hash: head.hash };
    let total = Buffer.byteLength(JSON.stringify({ v: 6, last: {}, order: [], pending: this.state.pending, book: this.state.book }));
    for (const t of this.state.order) total += share(t);
    while (total > cap && this.state.order.length > 0) {
      const gone = this.state.order.shift() as string;
      total -= share(gone);
      delete this.state.last[gone];
    }
    const text = JSON.stringify(this.state);
    if (Buffer.byteLength(text) > cap) this.o.log(`[seeingd] the private state is ${String(Buffer.byteLength(text))} bytes, over its cap ${String(cap)} — written anyway, said here`);
    // ONE fixed temp name: a crash leaves at most one, and the next persist overwrites it (R2-bytes N4).
    const tmp = join(this.o.stateDir, ".state.json.tmp");
    const fd = openSync(tmp, "w", 0o600);
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.statePath);
    const dfd = openSync(this.o.stateDir, "r");
    try {
      fsyncSync(dfd);
    } finally {
      closeSync(dfd);
    }
  }

  /** Record this look as the witness's last look at the target — the one the NEXT act's facet is read against. */
  private setLast(target: string, l: Look | PublicLook): void {
    this.state.last[target] = l;
    const i = this.state.order.lastIndexOf(target);
    if (i >= 0) this.state.order.splice(i, 1);
    this.state.order.push(target);
    while (this.state.order.length > TARGETS_REMEMBERED) {
      const gone = this.state.order.shift() as string;
      delete this.state.last[gone];
    }
  }

  private quarantine(name: string, reason: string): void {
    const dest = join(this.quarantineDir, `${this.o.clock.wall()}-${reason}-${name}`);
    renameSync(join(this.o.intakeDir, name), dest);
    this.o.log(`[seeingd] quarantined a drop: ${reason}`);
  }

  private commitHead(): void {
    if (this.o.committer === undefined || this.o.witnessSetId === undefined) return;
    const all = this.journal.getAll();
    const last = all[all.length - 1];
    if (last === undefined) return;
    try {
      this.o.committer({
        seq_no: last.sequenceNumber,
        head_hash: last.hash,
        ts: this.o.clock.wall(),
        witness_set_id: this.o.witnessSetId,
        modality: "NOT_AN_INSTRUCTION",
        chain_id: EFFECTS_CHAIN_ID,
      });
    } catch (e) {
      this.o.log(`[seeingd] head not submitted to the witness intake (not fatal; the book is the record): ${(e as Error).message}`);
    }
  }

  /** The act's fate, from its own records: RAN, HELD, or one of the LATE_* words. The look's facet is separate. */
  private fateOf(basis: LookBasis, close: ClosePointer | null): Fate {
    if (basis === "CLOSE_TIMEOUT") return "LATE_TIMEOUT";
    if (basis === "PENDING_CAP") return "LATE_PENDING_CAP";
    if (close === null) return "LATE_TIMEOUT";
    if (close.unguarded) return "LATE_UNGUARDED"; // the caller's own record: it ran with no /guard answer
    if (close.guard === null) return "LATE_NO_DECISION";
    return close.guard.execute === false ? "HELD" : "RAN";
  }

  /**
   * Writes the act's ONE record, from ONE look at the target (`now`). The facet is `now` against the witness's own
   * last look at that target; the outcome is LATE / HELD / the facet, by the act's fate. Returns "written",
   * "replay" (already in the book — never written twice), or the book's refusal as a string.
   */
  private write(p: PendingAct, now: Look, basis: LookBasis, close: ClosePointer | null): "written" | "replay" | string {
    const a = p.attempt;
    const key = actKey(a.subject, a.chain, a.subjectSeq);
    if (this.recorded.has(key)) return "replay";
    const prior = this.state.last[a.target] ?? null; // the witness's OWN last look, whenever it was (or none)
    // THE BOOK GETS THE PUBLIC FORM (refuter R2 F3): metadata as path-bound tokens; the facet is read off those
    // same tokens, so what the book says is exactly what the facet was derived from.
    const pubPrior = prior === null ? null : isPublic(prior) ? prior : publicLook(prior, this.ctx.key, a.target);
    const pubNow = publicLook(now, this.ctx.key, a.target);
    const facet: EffectClass = classifyFacet(pubPrior, pubNow);
    const fate = this.fateOf(basis, close);
    const g = close?.guard ?? null;
    // THE OUTCOME, IN ORDER (audit 2026-10-11 09:32Z): LATE (no usable decision), else HELD (the bridge's own
    // execute:false), else the facet from the look. The facet always rides beside the outcome (`observed`), so a
    // held act whose target moved since the witness last looked is visible, attributed to nothing.
    const effect: EffectClass = fate.startsWith("LATE") ? "LATE" : fate === "HELD" ? "HELD" : facet;
    const timestamp = Math.max(now.at, this.lastTimestamp);
    const out = this.journal.appendEvent(() => ({
      timestamp,
      moduleId: a.subject,
      eventType: consequenceEventType(a.derivationClass),
      outcome: consequenceOutcome(a.label, effect),
      actionId: a.actionId,
      witnessed: {
        method: SEEING_METHOD_DIGEST,
        methodVersion: SEEING_METHOD.version,
        cites: {
          chain: a.chain,
          subjectSeq: a.subjectSeq,
          sessionId: a.sessionId,
          targetFingerprint: a.targetFingerprint,
          closedSeq: close === null ? null : close.closedSeq,
          decisionHash: g === null ? null : g.decisionHash,
        },
        fate,
        observed: facet,
        priorLookAt: prior === null ? null : prior.at,
        look: pubNow,
        lookBasis: basis,
        clockAt: now.at,
      },
    }));
    if (!out.persisted) return out.detail ?? "the book did not persist the record";
    this.recorded.set(key, { sessionId: a.sessionId, actionId: a.actionId });
    this.lastTimestamp = timestamp;
    return "written";
  }

  /** One pass over the intake: ATTEMPT looks first, then CLOSEs, then timeouts and the cap; persist once; then remove drops. */
  sweep(): SweepReport {
    let attempts = 0, closes = 0, written = 0, timedOut = 0, quarantined = 0, orphanCloses = 0, replays = 0;
    const done: string[] = [];
    let changed = false;
    let unreadable = 0;
    const finish = (appendFailure: string | null): SweepReport => {
      if (changed) this.persistState();
      for (const n of done) rmSync(join(this.o.intakeDir, n), { force: true });
      return { attempts, closes, written, timedOut, quarantined, orphanCloses, replays, appendFailure };
    };
    const parsed: { name: string; ptr: Pointer }[] = [];
    for (const name of readdirSync(this.o.intakeDir).filter((n) => !n.startsWith(".")).sort()) {
      const path = join(this.o.intakeDir, name);
      let bytes: string;
      try {
        if (!lstatSync(path).isFile()) {
          this.quarantine(name, "NOT_A_FILE");
          quarantined++;
          continue;
        }
        bytes = readFileSync(path, "utf8");
      } catch (e) {
        unreadable++;
        this.o.log(`[seeingd] could not read a drop this sweep: ${(e as { code?: string }).code ?? "ERR"}`);
        continue;
      }
      const r = parsePointer(bytes);
      if (!r.ok) {
        this.quarantine(name, r.reason);
        quarantined++;
        continue;
      }
      parsed.push({ name, ptr: r.pointer });
    }
    /** Writes a pending act now, with no CLOSE; returns the book's refusal or null. */
    const closeWithout = (key: string, basis: "CLOSE_TIMEOUT" | "PENDING_CAP"): string | null => {
      const p = this.state.pending[key];
      const now = this.o.lookAt(p.attempt.target, this.ctx);
      const res = this.write(p, now, basis, null);
      if (res !== "written" && res !== "replay") return res;
      if (res === "written") {
        timedOut++;
        written++;
        this.commitHead();
      } else replays++;
      // Only a WRITTEN look becomes the baseline (refuter R4-bytes F1): a replay (the act is already in the book —
      // reachable after a crash between the append and the persist) must not adopt a re-look taken after the target
      // changed, which would mask that change as SAME for the next act. A replay's baseline is the look its BOOK
      // record holds, set at start by `rebuildFromBook` (audit 2026-10-11 12:51Z ①).
      if (res === "written") this.setLast(p.attempt.target, now);
      delete this.state.pending[key];
      if (p.drop !== null) done.push(p.drop);
      changed = true;
      return null;
    };
    // 1 · every ATTEMPT is only REMEMBERED — no look is taken now (phase R shrink: one look per act, at the close).
    //     Its drop STAYS in the intake until the act is written, so a lost or torn state re-reads it (R2-bytes F4).
    for (const { name, ptr } of parsed) {
      if (ptr.kind !== "ATTEMPT") continue;
      const key = actKey(ptr.subject, ptr.chain, ptr.subjectSeq);
      const rec = this.recorded.get(key);
      const known = this.state.pending[key];
      if (known !== undefined && known.drop === name) continue; // still waiting for its CLOSE
      attempts++;
      if (rec !== undefined) {
        if (rec.sessionId !== ptr.sessionId || rec.actionId !== ptr.actionId) {
          // A key already in the book, under another identity: never a replay, never silent (R2-bytes F3).
          this.quarantine(name, "RECORDED_KEY_IDENTITY_MISMATCH");
          this.o.log(`[seeingd] an ATTEMPT reuses an act key already in the book under another identity — quarantined, not written`);
          quarantined++;
        } else {
          replays++;
          done.push(name);
        }
        continue;
      }
      if (known !== undefined) {
        if (known.attempt.target !== ptr.target || known.attempt.sessionId !== ptr.sessionId || known.attempt.actionId !== ptr.actionId) {
          this.quarantine(name, "SECOND_ATTEMPT_FOR_ACT");
          quarantined++;
        } else {
          replays++;
          done.push(name);
        }
        continue;
      }
      this.state.pending[key] = {
        attempt: ptr,
        receivedAt: this.o.clock.wall(),
        receivedMono: this.o.clock.mono().toString(),
        receivedBoot: this.o.clock.boot,
        drop: name,
      };
      changed = true;
    }
    // 2 · every CLOSE is written.
    for (const { name, ptr } of parsed) {
      if (ptr.kind !== "CLOSE") continue;
      closes++;
      const key = actKey(ptr.subject, ptr.chain, ptr.attemptSeq);
      const p = this.state.pending[key];
      if (p === undefined) {
        if (this.recorded.has(key)) {
          replays++;
          done.push(name);
        } else if (unreadable > 0) {
          // Its ATTEMPT may be the drop this sweep could not read: kept for the next sweep (R2-bytes N7).
        } else {
          orphanCloses++;
          this.o.log(`[seeingd] a CLOSE for an act with no ATTEMPT here (no target, or dropped before this book)`);
          done.push(name);
        }
        continue;
      }
      if (p.attempt.sessionId !== ptr.sessionId || p.attempt.actionId !== ptr.actionId) {
        this.quarantine(name, "CLOSE_IDENTITY_MISMATCH");
        quarantined++;
        continue;
      }
      const now = this.o.lookAt(p.attempt.target, this.ctx);
      const res = this.write(p, now, "CLOSE", ptr);
      // The book refused: the CLOSE drop stays (it is not in `done`), the pending act is
      // persisted by `finish`, and a restarted witness writes the record then.
      if (res !== "written" && res !== "replay") return finish(res);
      if (res === "written") written++;
      else replays++;
      if (res === "written") this.setLast(p.attempt.target, now); // a replay's baseline came from the book at start (F1, ①)
      delete this.state.pending[key];
      changed = true;
      done.push(name);
      if (p.drop !== null) done.push(p.drop);
      if (res === "written") this.commitHead();
    }
    // 3 · every pending act past the close timeout — on the MONOTONIC clock (a wall step closes nothing early;
    //     R2-bytes N2); an act taken in another boot is overdue at once. Each its own look (refuter A-F2).
    const timeoutNs = BigInt(this.o.closeTimeoutMs) * 1000000n;
    for (const key of Object.keys(this.state.pending)) {
      const p = this.state.pending[key];
      const overdue = p.receivedBoot !== this.o.clock.boot || this.o.clock.mono() - BigInt(p.receivedMono) > timeoutNs;
      if (!overdue) continue;
      const failure = closeWithout(key, "CLOSE_TIMEOUT");
      if (failure !== null) return finish(failure);
    }
    // 4 · the pending cap (refuter R2 F4): past it, the OLDEST waiting acts are closed now, each its own look.
    const order = (k: string): bigint => BigInt(this.state.pending[k].receivedMono);
    const waiting = Object.keys(this.state.pending).sort((x, y) => (order(x) < order(y) ? -1 : order(x) > order(y) ? 1 : x < y ? -1 : 1));
    while (waiting.length > this.o.pendingCap) {
      const failure = closeWithout(waiting.shift() as string, "PENDING_CAP");
      if (failure !== null) return finish(failure);
    }
    return finish(null);
  }
}

// ── the CLI ──────────────────────────────────────────────────────────────────

interface Args {
  intake: string | null;
  book: string | null;
  state: string | null;
  witnessIntake: string | null;
  submitterId: string | null;
  witnessSetId: string | null;
  noWitness: boolean;
  closeTimeoutMs: number;
  tickMs: number;
  once: boolean;
}

export function parseArgs(argv: readonly string[]): Args | string {
  const a: Args = {
    intake: null, book: null, state: null, witnessIntake: null, submitterId: null, witnessSetId: null,
    noWitness: false, closeTimeoutMs: DEFAULT_CLOSE_TIMEOUT_MS, tickMs: 1000, once: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    const need = (): string => {
      if (v === undefined || v.startsWith("--")) throw new Error(`${k} needs a value`);
      i++;
      return v;
    };
    try {
      if (k === "--intake") a.intake = need();
      else if (k === "--book") a.book = need();
      else if (k === "--state") a.state = need();
      else if (k === "--witness-intake") a.witnessIntake = need();
      else if (k === "--submitter-id") a.submitterId = need();
      else if (k === "--witness-set-id") a.witnessSetId = need();
      else if (k === "--no-witness") a.noWitness = true;
      else if (k === "--close-timeout-ms") a.closeTimeoutMs = Number(need());
      else if (k === "--tick-ms") a.tickMs = Number(need());
      else if (k === "--once") a.once = true;
      else return `unknown argument ${k}`;
    } catch (e) {
      return (e as Error).message;
    }
  }
  if (a.intake === null || a.book === null || a.state === null) return "--intake, --book and --state are required";
  if (!a.noWitness && (a.witnessIntake === null || a.submitterId === null || a.witnessSetId === null)) {
    return "--witness-intake, --submitter-id and --witness-set-id are required unless --no-witness is declared";
  }
  if (a.witnessSetId !== null && a.witnessSetId.startsWith("REPLACE-WITH")) return "--witness-set-id is still the repository's placeholder";
  if (!Number.isSafeInteger(a.closeTimeoutMs) || a.closeTimeoutMs <= 0) return "--close-timeout-ms must be a positive integer";
  if (!Number.isSafeInteger(a.tickMs) || a.tickMs <= 0) return "--tick-ms must be a positive integer";
  return a;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") {
    console.error(`[seeingd] ${args}`);
    process.exit(2);
  }
  let w: SeeingWitness;
  try {
    w = new SeeingWitness({
      intakeDir: args.intake as string,
      bookPath: args.book as string,
      stateDir: args.state as string,
      committer: args.noWitness ? undefined : fileDropNamedCommitter(args.witnessIntake as string, args.submitterId as string),
      witnessSetId: args.noWitness ? undefined : (args.witnessSetId as string),
      closeTimeoutMs: args.closeTimeoutMs,
    });
  } catch (e) {
    console.error(`[seeingd] could not start: ${(e as Error).message}`);
    process.exit(1);
  }
  console.error(`[seeingd] method ${SEEING_METHOD_DIGEST} v${SEEING_METHOD.version}; boot ${SYSTEM_CLOCK.boot}; book ${args.book}; intake ${args.intake}`);
  const run = (): void => {
    let r: SweepReport;
    try {
      r = w.sweep();
    } catch (e) {
      console.error(`[seeingd] an unexpected fault in a sweep — stopping (exit 4, restartable): ${(e as Error).message}`);
      process.exit(4);
    }
    if (r.appendFailure !== null) {
      console.error(`[seeingd] a book append did not land — stopping (exit 3), the drop and the act kept: ${r.appendFailure}`);
      process.exit(3);
    }
  };
  if (args.once) {
    run();
    process.exit(0);
  }
  let scheduled = false;
  const soon = (): void => {
    if (scheduled) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      run();
    });
  };
  // inotify, so a look can land before the act's /guard request; the tick is the floor.
  // A watcher that fails is a fault inside the running witness: exit 4, which the unit restarts (R2-bytes N4).
  watch(args.intake as string, soon).on("error", (e) => {
    console.error(`[seeingd] the intake watcher failed — stopping (exit 4, restartable): ${(e as Error).message}`);
    process.exit(4);
  });
  setInterval(soon, args.tickMs);
  const stop = (): void => process.exit(0);
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  soon();
}

if (require.main === module) main();
