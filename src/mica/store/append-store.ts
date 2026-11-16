// ── MICA · the ONE append-store transaction contract (F2 + F7) ────────────────
//
// WHAT THIS IS, AND WHY THERE IS EXACTLY ONE OF IT
//
//   Three stores in this substrate are append-only, hash-chained, and load-state
//   disciplined: the chokepoint PASS-BLIND ledger (chokepoint/ledger.ts), the
//   export REACH ledger (export/ledger.ts), and the doctor SUBSTRATE_READ history
//   (doctor/history.ts). Each was written independently, and each made the SAME
//   partial-commit mistake the Codex substrate review named:
//
//     it advanced its in-memory chain (and, for the doctor, its latch state)
//     BEFORE the durable append, and on an append failure left the advanced
//     state in place. A later record then linked to a predecessor that never
//     reached disk; if that later append succeeded it reported `persisted:true`
//     over a disk chain with a missing predecessor — a false durable pass.
//
//   The fix is one contract, stated once here and reused by all three, so the
//   ordering guarantee cannot drift between them again:
//
//     VALIDATE the candidate  ->  APPEND it durably  ->  only THEN COMMIT it to
//     live state (chain push, and any derived state the store keeps).
//
//   On an append failure the committed prefix is UNCHANGED: commit() never runs,
//   so nothing in memory advances over a record that never landed. The caller
//   receives a typed persistence outcome and fails closed on `persisted:false`.
//
// ── THE INTER-PROCESS CONTRACT (S83) ──────────────────────────────────────────
//
//   The ordering above is sound WITHIN one process and was silent about others.
//   Every store derived a record's sequence number from a chain loaded at
//   construction and appended with a bare `appendFileSync`. Two `mica-guard`
//   invocations construct at the same head, both compute sequence N, and both
//   append. No byte is torn — a single-line O_APPEND write is atomic — but the
//   file now holds two siblings numbered N and the chain is SEMANTICALLY FORKED.
//   `verify()` is positional in all three stores, so the next load fails, sets
//   CANNOT_VERIFY, and the chokepoint narrows every executing disposition to
//   HOLD-BLIND. It fails closed, and it fails permanently.
//
//   So the second half of the contract, stated here for the same reason as the
//   first — so it cannot drift between the three stores:
//
//     TAKE the sibling lock  ->  RE-SYNC the chain from DISK under it  ->
//     DERIVE the record from the disk-true head  ->  APPEND  ->  COMMIT  ->
//     RELEASE, always.
//
//   THE LOCK ALONE WOULD NOT FIX IT. Serializing two writers that each derived a
//   sequence number at construction time produces the same two siblings, one
//   after the other. The re-sync is the load-bearing half: a store must ask the
//   disk where the head is while it holds the exclusive right to extend it.
//
//   THE LOCK HAS NO EXPIRY, AND NEVER WILL. A crash that leaves a lock file
//   behind makes every subsequent append fail TYPED and LEGIBLE, naming the lock
//   path so the operator's remedy is aimed at the lock file and not at the
//   evidence log. A self-clearing lock is a timeout policy this project does not
//   tune, and a hold that lapses on its own is the shape S82 ruled against.
//
//   CONTENTION IS OBSERVABLE, NOT SILENTLY SERIALIZED. A single acquire attempt;
//   on failure a typed `persisted:false`. The chokepoint's existing narrowing
//   already reports a non-durable floor reading honestly, so a contended write
//   degrades a permit rather than queueing behind an unbounded wait. If a
//   deployment needs a bounded retry, it is injected through the `acquire` seam
//   by its caller; there is no tuned literal in this file.
//
//   IN-MEMORY STORES TAKE NO LOCK. There is no cross-process problem without a
//   file, and no file to lock.
//
// ── THE INJECTED SEAMS ────────────────────────────────────────────────────────
//
//   The durable write is an injected function, defaulting to a real fs append.
//   This is the fault-injection seam the review's "fail-then-recover" test needs:
//   a test can hand a store an appender that throws once and then succeeds, and
//   assert that the transient failure neither poisoned the chain nor produced a
//   later false durable pass — and, since S83, that the lock was released on the
//   way out. The lock acquirer is the same kind of seam, for simulating
//   contention, stale locks and acquire-then-crash. Neither is a policy default:
//   the production path is `durableLineAppender` + `exclusiveFileLock`, and
//   nothing is tuned.
//
//   This module imports only `fs` (a node built-in) and nothing else: it lives
//   inside src/mica and adds no edge out of it (closure.test.ts).

import {
  appendFileSync,
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  unlinkSync,
} from "fs";

/** The typed outcome of one append-store transaction. */
export interface PersistOutcome {
  /** True only when the record was durably appended to a persisting file. */
  readonly persisted: boolean;
  /**
   * True when commit() actually ran — i.e. live state advanced. That is EITHER a
   * durable-append success OR memory-only mode (integrity without provenance). It
   * is false only when the store could not persist (not-persisting), the lock
   * could not be taken, the chain on disk no longer links, or the durable append
   * threw. A store whose derived state (e.g. a latch clear) must move in lockstep
   * with the chain reads this, not `persisted`: an in-memory store legitimately
   * commits without persisting.
   */
  readonly committed: boolean;
  /** Why not, when persisted is false. Null on success. */
  readonly detail: string | null;
}

/** A transaction outcome carrying the candidate record the store prepared. */
export interface AppendOutcome<R> extends PersistOutcome {
  /**
   * The candidate this transaction prepared. Present on EVERY path: on a failure
   * it is the record that did NOT land, which is what the store reports to its
   * caller so a narrowing decision can name what it could not record.
   */
  readonly record: R;
}

/** Appends one already-serialized line to a path. Injected for fault injection. */
export type LineAppender = (path: string, line: string) => void;

/**
 * The production appender: an fs append that is durable in the sense this name
 * has always claimed. `appendFileSync(path, ...)` alone returns once the bytes
 * are in the page cache; a machine that loses power before the kernel flushes
 * loses a record whose writer was told it had landed. That is the one lie a
 * store like this cannot afford, because every reader downstream — and the F2
 * ordering above — treats a returned append as a fact on disk.
 *
 * So the descriptor is held across the write and `fsyncSync`d before it closes:
 * this call does not return until the file system says the bytes reached the
 * device. The fd is closed on EVERY path, including a throwing write and a
 * throwing fsync, and ONLY the close is swallowed — for the same reason the
 * lock's release swallows its own: housekeeping must not replace a truthful
 * report of what did or did not land. A write or fsync failure propagates. This
 * is a `LineAppender`, and the transaction above reads a throw as "the record
 * did not land" and leaves the committed prefix exactly as it was.
 *
 * Nothing here is tuned. There is no buffer size, no retry, no timer, and no
 * fsync policy to choose between: the write is durable or it throws.
 */
export const durableLineAppender: LineAppender = (path, line) => {
  const fd = openSync(path, "a");
  try {
    appendFileSync(fd, line, "utf8");
    fsyncSync(fd);
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* the descriptor goes away with the process regardless */
    }
  }
};

// ── the sibling lock ──────────────────────────────────────────────────────────

/** The lock file for a store path: the same name in the same directory, + .lock */
export function appendLockPath(storePath: string): string {
  return `${storePath}.lock`;
}

/** The result of one acquire attempt. Failure is a value here, never a throw. */
export type LockOutcome =
  | {
      readonly acquired: true;
      /** Releases the lock. Never throws: a release failure must not mask an outcome. */
      readonly release: () => void;
    }
  | { readonly acquired: false; readonly reason: string };

/** Takes the exclusive right to extend one store file. Injected in lock tests. */
export type LockAcquirer = (lockPath: string) => LockOutcome;

/**
 * The production acquirer: `O_CREAT|O_EXCL` on a sibling lock file, which is one
 * atomic operation on POSIX and on NTFS. There is no retry, no wait and no
 * expiry — see the file header. It uses `fs` and nothing else, because
 * package.json carries zero runtime dependencies and this file is inside the
 * src/mica closure.
 */
export const exclusiveFileLock: LockAcquirer = (lockPath) => {
  let fd: number;
  try {
    fd = openSync(lockPath, "wx");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      return { acquired: false, reason: "the lock file already exists" };
    }
    return { acquired: false, reason: String(err) };
  }
  return {
    acquired: true,
    release: () => {
      // Both steps are swallowed deliberately. This runs in a `finally` over an
      // already-decided outcome; throwing here would replace a truthful report of
      // what did or did not land with an error about housekeeping. A lock file
      // that survives its process becomes the NEXT append's typed, legible
      // failure, which is the loud path this design already commits to.
      try {
        closeSync(fd);
      } catch {
        /* the descriptor goes away with the process regardless */
      }
      try {
        unlinkSync(lockPath);
      } catch {
        /* left behind: the next append fails typed and names this path */
      }
    },
  };
};

// ── the re-sync ───────────────────────────────────────────────────────────────

/** The three chain fields every store's record carries, whatever else it holds. */
export interface ChainedRecord {
  readonly sequenceNumber: number;
  readonly previousHash: string;
  readonly hash: string;
}

/** What the disk said when a store asked, under the lock, where the head is. */
export type ResyncResult<R> =
  | { readonly linked: true; readonly extension: readonly R[] }
  | { readonly linked: false; readonly detail: string; readonly torn?: true };

// ── THE LINE RULE. One rule, one count, for the seam and for every loader ─────
//
// THE RULE, stated exactly, because its edge is the whole defect:
//
//   split on /\r?\n/; if the LAST element is exactly "", pop EXACTLY ONE;
//   every element that REMAINS is a record, or the store is refused.
//
// So a file's ONE trailing terminator is the terminator and is accepted — every
// JSONL fixture in this tree is written `lines.join("\n") + "\n"`, and a rule
// that refused it would refuse the repo. A SECOND trailing newline is not a
// terminator: it leaves an interior empty element, and it is refused. A zero-byte
// file is `[""]` -> pop -> `[]` -> zero records, with no special case: the pop
// rule IS the empty-file guard, which is why no separate one is written here.
//
// WHAT THIS REPLACES, AND WHY "BLANK LINE" UNDERSTATES IT. The old rule was
// `.filter(l => l.trim().length > 0)`. It did not skip "blank lines"; it skipped
// every line ECMAScript `.trim()` calls whitespace: SP TAB LF VT FF CR, NBSP,
// U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, and U+FEFF —
// the BOM a Windows editor writes without being asked. Those are the ~15 code
// points this closes. U+200B ZERO WIDTH SPACE is NOT among them:
// `"​".trim().length` is 1, so a ZWSP line already reached JSON.parse and
// was already refused before this change. A test for it is a regression guard,
// not a proof of this repair.
//
// ONE RULE, ONE COUNT — LOAD-BEARING. `resyncAppendStore` compares its own line
// count against the count its caller loaded. Tighten this seam while a loader
// stays lax and that store comes up CLEAN, reports CLEAN, and then refuses every
// append it is asked for: a box that is silently no longer recording, which is
// strictly WORSE than the defect, because the defect at least keeps writing. That
// is why chokepoint/ledger.ts, chokepoint/floor-trail.ts and notify/notice-log.ts
// import `storeLines` instead of restating it, and why all four move together.

/** The outcome of applying the line rule to a store's bytes. */
export type StoreLineScan =
  | { readonly ok: true; readonly lines: readonly string[] }
  | { readonly ok: false; readonly index: number; readonly count: number };

/**
 * THE line rule. See the block above. Returns the record lines, or the index of
 * the first line the ES whitespace set makes invisible — which is never a line an
 * honest writer produced, so the file is TORN and not merely short.
 */
export function storeLines(raw: string): StoreLineScan {
  const lines = raw.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length === 0) {
      return { ok: false, index: i, count: lines.length };
    }
  }
  return { ok: true, lines };
}

/**
 * The operator-facing reason a store refused a whitespace-only line. Deliberately
 * NOT the fork message: nothing in this machine writes such a line, so it is a
 * hand edit or a torn write, and sending the operator to hunt a second writer over
 * it would be the wrong instruction. See `tornOnDiskDetail`.
 */
export function blankLineDetail(index: number, count: number): string {
  return (
    `line ${String(index)} of ${String(count)} holds no record: it is empty, or ` +
    `only characters that count as whitespace. A chain that skipped it would be ` +
    `verifying around bytes it declined to read, so the chain is reported TORN at ` +
    `that line. Nothing in this machine writes such a line: it is a hand edit, or ` +
    `a write that landed a newline and not the record that belonged with it. Do ` +
    `NOT delete the line to make this go away — that hides which of the two it was.`
  );
}

export interface ResyncSpec<R extends ChainedRecord> {
  /** The store's path. Read whole; see the note below. */
  readonly path: string;
  /** The records already loaded and verified in memory. NOT re-verified here. */
  readonly known: readonly R[];
  /** The store's own closed-shape validator. Null means "not one of my records". */
  readonly validate: (parsed: unknown) => R | null;
  /** The store's own chained-hash function, recomputed over a parsed record. */
  readonly recomputeHash: (record: R) => string;
}

/**
 * Read the store's file under the lock and return the records that landed after
 * the ones already in memory, PROVIDED they link on. The three checks are the
 * same three every store's `verify()` makes — positional sequence, previousHash,
 * and the record's own hash — stated once here so a store cannot catch up under a
 * weaker rule than it verifies under.
 *
 * FULL-FILE RE-READ, DELIBERATELY. A catch-up read of only the bytes past the
 * loaded prefix would need a retained byte offset, and JSONL line boundaries are
 * not derivable from a record count without one. That offset would be new store
 * state to keep coherent across every failure path, including the ones this build
 * adds. Re-reading whole also makes a TRUNCATED or REPLACED file visible for
 * free, which an offset-based catch-up would read straight past.
 *
 * A NON-LINKING EXTENSION EXTENDS NOTHING. If any line past the loaded prefix
 * fails to link, no part of the extension is returned: the file is already forked
 * by another writer, and appending onto a fork deepens it.
 */
export function resyncAppendStore<R extends ChainedRecord>(
  spec: ResyncSpec<R>
): ResyncResult<R> {
  let raw: string;
  try {
    raw = readFileSync(spec.path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      if (spec.known.length === 0) return { linked: true, extension: [] };
      return {
        linked: false,
        detail:
          `the file is gone, but ${String(spec.known.length)} record(s) were ` +
          `loaded from it`,
      };
    }
    return { linked: false, detail: `it could not be re-read: ${String(err)}` };
  }

  // THE line rule, shared with every loader that calls this seam. See `storeLines`.
  // The scan covers the WHOLE file, not just the extension past `known`: a store
  // whose loader is lax can hand a `known` count that already spans a torn line,
  // and the loop below starts at `known.length` and would read straight past it.
  const scan = storeLines(raw);
  if (!scan.ok) {
    return { linked: false, torn: true, detail: blankLineDetail(scan.index, scan.count) };
  }
  const lines = scan.lines;
  if (lines.length < spec.known.length) {
    return {
      linked: false,
      detail:
        `it holds ${String(lines.length)} record(s) but ${String(spec.known.length)} ` +
        `were loaded from it: it was truncated or replaced`,
    };
  }

  const extension: R[] = [];
  for (let i = spec.known.length; i < lines.length; i++) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]);
    } catch (err) {
      return {
        linked: false,
        detail: `line ${String(i)} is malformed JSON: ${String(err)}`,
      };
    }
    const record = spec.validate(parsed);
    if (record === null) {
      return {
        linked: false,
        detail: `the record at line ${String(i)} does not match the store's closed schema`,
      };
    }
    if (record.sequenceNumber !== i) {
      return {
        linked: false,
        detail:
          `the record at line ${String(i)} carries sequence number ` +
          `${String(record.sequenceNumber)}`,
      };
    }
    const predecessor =
      i === 0
        ? null
        : extension.length === 0
        ? spec.known[i - 1]
        : extension[extension.length - 1];
    const expectedPreviousHash = predecessor === null ? "" : predecessor.hash;
    if (record.previousHash !== expectedPreviousHash) {
      return {
        linked: false,
        detail: `the record at line ${String(i)} does not link onto the record before it`,
      };
    }
    if (spec.recomputeHash(record) !== record.hash) {
      return {
        linked: false,
        detail: `the record at line ${String(i)} does not match its own hash`,
      };
    }
    extension.push(record);
  }
  return { linked: true, extension };
}

// ── the transaction ───────────────────────────────────────────────────────────

/** What a store prepares once the head is known to be disk-true. */
export interface PreparedAppend<R> {
  /** The candidate record, derived from the head as it stands when this runs. */
  readonly record: R;
  /** That record serialized: JSON + trailing newline. */
  readonly line: string;
  /**
   * Advance live in-memory state: push the record onto the chain and apply any
   * derived-state mutation the store keeps (e.g. the doctor's latch). Runs ONLY
   * after a durable append succeeds — or, in memory-only mode, as the sole commit
   * (integrity without provenance). It NEVER runs on a failure of any kind.
   */
  readonly commit: () => void;
}

/**
 * Derive the candidate from the store's CURRENT head and serialize it. Called
 * EXACTLY ONCE per transaction, on every path — after the re-sync where there is
 * one, so the head it reads is the disk-true head; and before returning on a
 * failure path, so the store always has the candidate that did NOT land. It must
 * be free of side effects other than deriving: the seam decides whether the
 * commit it returns ever runs.
 */
export type AppendPreparer<R> = () => PreparedAppend<R>;

/**
 * A refusal that is NOT a fork. The disk holds a line that carries no record, so
 * the chain is torn at that line; no second writer is implied and the operator
 * must not be sent to look for one. A store returns this shape from its re-sync
 * to choose `tornOnDiskDetail` over `forkedOnDiskDetail`.
 */
export interface AppendResyncTorn {
  readonly torn: true;
  readonly detail: string;
}

/**
 * Bring the in-memory chain up to the disk head while the lock is held. Returns
 * null when the chain is in sync (having extended it if the disk had more), or a
 * detail when the disk no longer links onto what is in memory.
 *
 * A plain string still means "the chain forked" and is wrapped as it always was,
 * so a store that has not been taught the distinction keeps compiling and keeps
 * its present behaviour. An `AppendResyncTorn` is the newer, narrower answer.
 */
export type AppendResync = () => string | AppendResyncTorn | null;

/**
 * What `resync: null` means at a call site, spelled out so that it is a statement
 * and not an omission.
 *
 * A store that passes null has NOT adopted the inter-process contract: it takes
 * no lock, does not re-sync, and behaves exactly as this seam did before S83.
 * That is correct only for a store with a single writer, and it is written at the
 * call site rather than inferred here so a later census reads it off the source
 * instead of re-deriving it. Passing null is a deliberate act that shows in a
 * diff; passing nothing does not compile.
 */
export const RESYNC_NULL_IS_A_DECLARATION =
  "resync: null declares that this store has NOT adopted the inter-process " +
  "append contract. It takes no lock and derives its sequence number from a " +
  "process-local head, so two concurrent writers will fork its chain. It is a " +
  "statement about this store, not a default.";

/** What every transaction needs, whichever contract the store has adopted. */
export interface AppendTransactionBase<R> {
  /** The store's path, or null when it is in memory only. */
  readonly path: string | null;
  /** Whether the store is in a state that can persist (from its load discipline). */
  readonly persisting: boolean;
  /** The store's last recorded error, surfaced when it cannot persist. */
  readonly lastError: string | null;
  /** How this store names itself in an operator-facing detail. Lower case, no article. */
  readonly storeLabel: string;
  /** Derive + serialize the candidate. See AppendPreparer. */
  readonly prepare: AppendPreparer<R>;
  /** The durable write. Defaults to durableLineAppender; injected in fault tests. */
  readonly appender?: LineAppender;
  /** Detail returned in memory-only mode (path === null). */
  readonly memoryDetail: string;
  /** Detail returned when the store is not in a persisting state. */
  readonly notPersistingDetail: string;
  /**
   * Record the append error on the store (set its lastError) and RETURN the detail
   * string to report. The committed prefix is left unchanged regardless — this
   * callback must not advance chain/derived state. The store deliberately does NOT
   * move irreversibly to non-persisting here: the contract permits fail-then-
   * recover, and a later append over the unchanged prefix lands contiguously.
   */
  readonly onAppendError: (raw: string) => string;
}

/** A store that HAS adopted the inter-process contract: it locks and re-syncs. */
export interface InterProcessAppendParams<R> extends AppendTransactionBase<R> {
  /** The disk-truth catch-up, run under the lock. See AppendResync. */
  readonly resync: AppendResync;
  /** The lock. Defaults to exclusiveFileLock; injected in lock tests. */
  readonly acquire?: LockAcquirer;
  /**
   * Record on the store (set its lastError) that an append was BLOCKED before it
   * was attempted — the lock was not available, or the chain on disk no longer
   * links — and RETURN the detail to report. Nothing was written and nothing
   * advanced. Like onAppendError, this must NOT move the store to non-persisting:
   * both conditions are external, and both clear when their external cause does.
   */
  readonly onAppendBlocked: (detail: string) => string;
}

/**
 * A store that has NOT adopted it. See RESYNC_NULL_IS_A_DECLARATION.
 *
 * The declaration is STRUCTURAL, not conventional: this shape cannot carry
 * `acquire` or `onAppendBlocked`, because a store that takes no lock has no use
 * for either, and a half-adopted call site should not typecheck.
 */
export interface SingleWriterAppendParams<R> extends AppendTransactionBase<R> {
  readonly resync: null;
}

export type AppendTransactionParams<R> =
  | InterProcessAppendParams<R>
  | SingleWriterAppendParams<R>;

/** The operator-facing detail for an append that could not take the lock. */
function lockUnavailableDetail(
  storeLabel: string,
  lockPath: string,
  reason: string
): string {
  return (
    `the ${storeLabel} append lock could not be taken (${reason}), so this record ` +
    `was NOT written. The lock is ${lockPath}. It has no expiry and no timer will ` +
    `ever clear it: if another process is writing, this is contention and the ` +
    `record is simply not durable; if nothing is writing, the lock file was left ` +
    `behind by a crash and an operator removes THAT FILE by hand. Do not delete ` +
    `the ${storeLabel} itself — the record of what happened is the thing being ` +
    `protected here.`
  );
}

/** The operator-facing detail for an append onto a chain that already forked. */
function forkedOnDiskDetail(storeLabel: string, drift: string): string {
  return (
    `the ${storeLabel} on disk no longer links onto the chain loaded from it: ` +
    `${drift}. Nothing was appended. Another writer has already forked this file, ` +
    `and appending onto a fork deepens it.`
  );
}

/**
 * The operator-facing detail for an append onto a chain that is TORN — the disk
 * holds a line that carries no record.
 *
 * This is a SEPARATE message from `forkedOnDiskDetail` on purpose, and the
 * separation is the point rather than an implementation detail: the fork message
 * ends "Another writer has already forked this file", and over a blank line that
 * sentence is false and sends the operator to hunt a process that does not exist.
 * `forkedOnDiskDetail` is therefore left exactly as it was — this is a new branch
 * with a new string, not a reworded old one.
 */
function tornOnDiskDetail(storeLabel: string, drift: string): string {
  return (
    `the ${storeLabel} on disk is TORN and was not extended: ${drift} Nothing was ` +
    `appended, and nothing about this implies a second writer — do not go looking ` +
    `for one. Keep the file as it is and read it: it is evidence of either a hand ` +
    `edit or an interrupted write, and which one it was is the question worth ` +
    `answering before anything writes to this store again.`
  );
}

/**
 * THE append-store transaction. See the file header for both invariants — the
 * intra-process ordering and the inter-process lock/re-sync. Pure with respect to
 * everything except the injected callbacks: it decides the ordering, and the
 * store owns what prepare/commit/resync/onAppend* actually mutate.
 */
export function appendStoreTransaction<R>(
  p: AppendTransactionParams<R>
): AppendOutcome<R> {
  if (p.path === null) {
    // In memory only: no durable store exists to append to, and no other process
    // can be holding one. No lock is taken. Commit for INTEGRITY and report the
    // absence of PROVENANCE honestly. This is not a partial commit — there is no
    // disk tail to diverge from, and getLoadState() says IN_MEMORY.
    const prepared = p.prepare();
    prepared.commit();
    return {
      record: prepared.record,
      persisted: false,
      committed: true,
      detail: p.memoryDetail,
    };
  }
  if (!p.persisting) {
    // A prior load/append failure left the store unable to persist. Do NOT
    // advance: continuing from an uncommitted tail is exactly the poison F2 names.
    const prepared = p.prepare();
    return {
      record: prepared.record,
      persisted: false,
      committed: false,
      detail: p.lastError ?? p.notPersistingDetail,
    };
  }
  const path = p.path;
  if (p.resync === null) {
    // Declared single-writer. See RESYNC_NULL_IS_A_DECLARATION: no lock, no
    // catch-up, byte-identical to this seam's behaviour before S83.
    return appendAndCommit(p, path);
  }
  const resync = p.resync;
  const onAppendBlocked = p.onAppendBlocked;

  const lockPath = appendLockPath(path);
  const lock = (p.acquire ?? exclusiveFileLock)(lockPath);
  if (!lock.acquired) {
    const prepared = p.prepare();
    return {
      record: prepared.record,
      persisted: false,
      committed: false,
      detail: onAppendBlocked(
        lockUnavailableDetail(p.storeLabel, lockPath, lock.reason)
      ),
    };
  }
  try {
    const drift = resync();
    if (drift !== null) {
      const prepared = p.prepare();
      // A torn file and a forked file are different findings and get different
      // messages. See tornOnDiskDetail for why this is a new branch rather than a
      // rewording of the old one.
      const detail =
        typeof drift === "string"
          ? forkedOnDiskDetail(p.storeLabel, drift)
          : tornOnDiskDetail(p.storeLabel, drift.detail);
      return {
        record: prepared.record,
        persisted: false,
        committed: false,
        detail: onAppendBlocked(detail),
      };
    }
    // The head is now disk-true and this process holds the exclusive right to
    // extend it. Only now is a sequence number worth deriving.
    return appendAndCommit(p, path);
  } finally {
    // Always. Including over a thrown appender, and over every early return.
    lock.release();
  }
}

/**
 * The durable half: derive, append, and commit ONLY on success. Shared by the
 * locked path and the declared-single-writer path, so the F2 ordering has exactly
 * one implementation, as it always has.
 */
function appendAndCommit<R>(
  p: AppendTransactionBase<R>,
  path: string
): AppendOutcome<R> {
  const prepared = p.prepare();
  try {
    (p.appender ?? durableLineAppender)(path, prepared.line);
  } catch (err) {
    // Committed prefix unchanged: commit() is NOT called. The store records the
    // error and stays able to retry; nothing in memory advanced over this record.
    const detail = p.onAppendError(String(err));
    return { record: prepared.record, persisted: false, committed: false, detail };
  }
  prepared.commit();
  return { record: prepared.record, persisted: true, committed: true, detail: null };
}
