// ── GLUE · evaluateAndRecord — PREPARED / FINAL, two-phase (Amendment 1) ─────
//
// Implements the amended Stage 1 transaction model exactly:
//
//   1. DECISION_PREPARED — written INSIDE guard() by a journal-backed
//      FloorTrail (JournalBackedFloorTrail below), appended to the SAME
//      canonical decision journal `guard()`'s caller already owns. If the
//      append fails, guard() narrows exactly as it always has (HOLD-BLIND,
//      "floor reading not durable") — nothing new here, just a new writer
//      for the mandatory boundary that already existed.
//   2. PASSBLIND_PREPARED — same discipline, via a journal-backed
//      ChokepointLedger, only when the raw disposition is PASS_BLIND.
//   3. DECISION_FINAL — written by THIS function after guard() returns. This
//      is the one mandatory boundary: nothing executable is returned before
//      it is durable. A failure returns an evaluated HOLD, recordNotPersisted.
//   4. Repairable projections — the REAL floor-trail file, the REAL PASS-BLIND
//      ledger file (same classes, same on-disk format), history, and the
//      event book — are wrapper-owned and written STRICTLY AFTER FINAL, from
//      the PREPARED/PASSBLIND_PREPARED readings the journal already holds.
//      Each ends PROJECTION_DONE/FAILED.
//   5. Replay: identity with FINAL -> replay (same hash) or CONFLICT
//      (different hash). Identity with PREPARED but no FINAL -> quarantined,
//      not a decision; a fresh evaluation runs and the orphan(s) are reported.
//
// `src/mica/**` is imported, never edited.
//
// ── AMENDMENT 2 (verifier F1) — the event book holds two different things ────
//
// `EventBook` is shared between (a) the "events" projection's own TARGET
// write — one `kind:"DECISION_FINAL"` record per identity, `projection:
// null` — and (b) PROJECTION_DONE/FAILED STATUS notifications the other
// three projections' own `mark()` calls also write here, one per projection
// they cover, now uniquely keyed by an explicit `projection` field. The
// FIRST Amendment-1 cut used an identity-only `hasEventFor(identity)` to
// decide whether the "events" projection was already done — which matched
// ANY of the three status notifications and let repair mark "events" DONE
// with no target event ever written; both event failpoints were then
// unreachable, because the branch that would fire them returned before
// them, having already been fooled into thinking there was nothing left to
// do. `EventBook.hasEvent(identity, kind)` now checks the ONE kind that is
// ever the target, and no status notification is ever written under that
// kind — so its presence is proof the target event exists, and its absence
// is never papered over by an unrelated event under the same identity.

import { readFileSync } from "fs";
import type { ReaderFootingReading, WireOptions } from "./wire";
import { bindingMinimumOf, footingsFromWiring, readingsFromWiring, wire } from "./wire";
import type { SigF3Reading } from "./wire";
import type { BindingMinimum, DecisionReading } from "./wire";
import type { DispositionResult } from "../mica/chokepoint";
import {
  ChokepointLedger,
  FloorTrail,
} from "../mica/chokepoint";
import type {
  ChokepointDisposition,
  ChokepointLedgerRecord,
  FloorTrailRecord,
  FloorTrailRecordInput,
  FloorTrailRecordOutcome,
} from "../mica/chokepoint";
import type {
  ChokepointLedgerRecordInput,
  RecordOutcome as LedgerRecordOutcome,
} from "../mica/chokepoint/ledger";
import type { VerdictKind } from "../mica/types";
import { recordGuardResult } from "../mica/doctor/recorder";
import { SubstrateHistory } from "../mica/doctor/history";
import { appendStoreTransaction } from "../mica/store/append-store";
import type { LineAppender, LockAcquirer } from "../mica/store/append-store";
import {
  hasExactKeys,
  isEnum,
  isFiniteNumber,
  isNonNegInteger,
  isObject,
  isString,
} from "../mica/store/validate";
import type { Parsed } from "../mica/store/validate";
import { maybeFailpoint } from "./failpoint";
import {
  canonicalHash,
  DecisionJournal,
  identityKey,
  isDeclarationBinding,
  PROJECTION_KINDS,
} from "./decision-journal";
import type {
  DecisionFinalRecord,
  DecisionIdentity,
  DecisionPreparedRecord,
  DeclarationBinding,
  PassBlindPreparedRecord,
  PreparedFloorReading,
  PreparedPassBlindReading,
  ProjectionKind,
  ProjectionState,
} from "./decision-journal";

/** Thrown by evaluateAndRecord itself for a malformed request — a library-level
 *  usage error, distinct from the CLI's own GuardInvocationError. */
export class EvaluateAndRecordUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluateAndRecordUsageError";
  }
}

function requireNonEmpty(label: string, value: string): void {
  if (value.trim().length === 0) {
    throw new EvaluateAndRecordUsageError(
      `${label} must be a non-empty string. Identity is (subject, sessionId, ` +
        `actionId) and the request also carries toolName; all four are ` +
        `required, non-empty, and validated here — belt and braces alongside ` +
        `whatever Stage 2 validates on its own inbound requests.`
    );
  }
}

function validateRequest(request: EvaluateAndRecordRequest): void {
  requireNonEmpty("identity.subject", request.identity.subject);
  requireNonEmpty("identity.sessionId", request.identity.sessionId);
  requireNonEmpty("identity.actionId", request.identity.actionId);
  requireNonEmpty("toolName", request.toolName);
  requireNonEmpty("subject", request.subject);
  requireNonEmpty("requestHash", request.requestHash);
}

// ── journal-backed FloorTrail / ChokepointLedger (Amendment 1 item 1–2) ─────
//
// Real subclasses, not duck-typed objects: `Chokepoint`'s options type names
// the concrete `FloorTrail`/`ChokepointLedger` classes (both carry private
// fields), so only an actual instance — or a subclass — satisfies it. Each
// subclass calls `super()` with NO options (in-memory, harmless, never
// touches disk) and OVERRIDES `record()` entirely: the override never calls
// into the base class's own disk-writing logic, so the base instance's own
// file-backed state is simply unused machinery riding along for the type.

export class JournalBackedFloorTrail extends FloorTrail {
  /** The last append this override made, so the wrapper can replay it after FINAL. */
  lastPrepared: DecisionPreparedRecord | null = null;

  constructor(
    private readonly journal: DecisionJournal,
    private readonly identity: DecisionIdentity,
    private readonly requestHash: string,
    private readonly declarationBinding: DeclarationBinding,
    private readonly now: () => number
  ) {
    super();
  }

  record(input: FloorTrailRecordInput): FloorTrailRecordOutcome {
    const floorReading: PreparedFloorReading = {
      timestamp: input.timestamp,
      actionId: input.actionId,
      disposition: input.disposition,
      floorKind: input.floorKind,
      blindSplit: input.blindSplit,
      impactClass: input.impactClass,
      sensorIds: input.sensorIds,
      sensorKinds: input.sensorKinds,
    };
    const outcome = this.journal.appendPrepared(
      this.identity,
      this.requestHash,
      this.declarationBinding,
      floorReading,
      this.now()
    );
    this.lastPrepared = outcome.persisted ? outcome.record : outcome.record;
    // A stand-in FloorTrailRecord: NEVER written to any file and NEVER
    // verified by FloorTrail's own chain arithmetic. Its sequenceNumber/hash
    // are the JOURNAL's, carried through only so the DispositionResult has
    // something to report; the authoritative record is the journal's own.
    const record: FloorTrailRecord = {
      ...input,
      sequenceNumber: outcome.record.sequenceNumber,
      previousHash: outcome.record.previousHash,
      hash: outcome.record.hash,
    };
    return {
      record,
      persisted: outcome.persisted,
      detail: outcome.detail,
      headCommitted: false,
      headCommitDetail: null,
    };
  }
}

export class JournalBackedLedger extends ChokepointLedger {
  lastPrepared: PassBlindPreparedRecord | null = null;

  constructor(
    private readonly journal: DecisionJournal,
    private readonly identity: DecisionIdentity,
    private readonly requestHash: string,
    private readonly declarationBinding: DeclarationBinding,
    private readonly now: () => number
  ) {
    super();
  }

  record(input: ChokepointLedgerRecordInput): LedgerRecordOutcome {
    const passBlindReading: PreparedPassBlindReading = {
      actionId: input.actionId,
      disposition: "PASS_BLIND",
      floorKind: input.floorKind,
      impactClass: input.impactClass,
      sensorIds: input.sensorIds,
    };
    const outcome = this.journal.appendPassBlindPrepared(
      this.identity,
      this.requestHash,
      this.declarationBinding,
      passBlindReading,
      this.now()
    );
    this.lastPrepared = outcome.record;
    const record: ChokepointLedgerRecord = {
      ...input,
      sequenceNumber: outcome.record.sequenceNumber,
      previousHash: outcome.record.previousHash,
      hash: outcome.record.hash,
    };
    return { record, persisted: outcome.persisted, detail: outcome.detail };
  }
}

// ── the event book — {seq, kind, identity, disposition, at} ─────────────────

export type EventKind = "DECISION_FINAL" | "PROJECTION_DONE" | "PROJECTION_FAILED";

export interface EventRecord {
  readonly seq: number;
  readonly kind: EventKind;
  readonly identity: DecisionIdentity;
  /**
   * F1 item 5: this book holds TWO different things under one identity — the
   * single TARGET event the "events" projection exists to record
   * (`kind:"DECISION_FINAL"`, `projection: null`) and the PROJECTION_DONE/
   * FAILED STATUS notifications the other three projections' own `mark()`
   * calls ALSO write here, one per projection they cover. `projection` is
   * what makes those status notifications uniquely keyed — the trail's
   * status event and the ledger's status event no longer look alike — and
   * it is what stops a caller mistaking ANY of them for proof that the
   * TARGET event exists: only `kind==="DECISION_FINAL" && projection===null`
   * is that proof, which `EventBook.hasEvent` on `kind` alone still gets
   * right because no status notification is ever written with that kind.
   */
  readonly projection: ProjectionKind | null;
  readonly disposition: string;
  readonly at: number;
}

const EVENT_KEYS: readonly string[] = ["seq", "kind", "identity", "projection", "disposition", "at"];

function isEventIdentity(x: unknown): x is DecisionIdentity {
  return (
    isObject(x) &&
    hasExactKeys(x, ["subject", "sessionId", "actionId"]) &&
    isString(x.subject) &&
    isString(x.sessionId) &&
    isString(x.actionId)
  );
}

function validateEventRecord(x: unknown): EventRecord | null {
  if (!isObject(x)) return null;
  const o = x as Parsed;
  if (!hasExactKeys(o, EVENT_KEYS)) return null;
  if (!isNonNegInteger(o.seq)) return null;
  if (o.kind !== "DECISION_FINAL" && o.kind !== "PROJECTION_DONE" && o.kind !== "PROJECTION_FAILED") {
    return null;
  }
  if (!isEventIdentity(o.identity)) return null;
  if (!(o.projection === null || isEnum(o.projection, PROJECTION_KINDS))) return null;
  if (!isString(o.disposition)) return null;
  if (!isFiniteNumber(o.at)) return null;
  return o as unknown as EventRecord;
}

export class EventBook {
  private readonly records: EventRecord[] = [];
  private readonly path: string | null;
  private readonly appender?: LineAppender;
  private persisting = false;
  private lastError: string | null = null;

  constructor(options?: { path?: string; appender?: LineAppender }) {
    this.path = options?.path ?? null;
    this.appender = options?.appender;
    if (this.path === null) return;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    const path = this.path as string;
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        this.persisting = true;
        return;
      }
      this.lastError = `cannot read event book: ${String(err)}`;
      return;
    }
    const lines = raw.split("\n").filter((l: string) => l.trim().length > 0);
    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        this.lastError = `malformed JSON in event book: ${String(err)}`;
        return;
      }
      const record = validateEventRecord(parsed);
      if (record === null) {
        this.lastError = "record in event book does not match the closed schema";
        return;
      }
      this.records.push(record);
    }
    this.persisting = true;
  }

  getAll(): readonly EventRecord[] {
    return this.records;
  }

  /**
   * TARGET-SPECIFIC. Verifier F1: the previous `hasEventFor(identity)`
   * matched ANY kind carrying the identity — including the three
   * `PROJECTION_DONE` status notifications the repair of trail/ledger/
   * history writes into this SAME book — so it read as "the DECISION_FINAL
   * event exists" when only an unrelated status event did. This checks the
   * one kind that actually matters for the "events" projection: does the
   * event this projection exists to record actually exist.
   */
  hasEvent(identity: DecisionIdentity, kind: EventKind): boolean {
    const key = identityKey(identity);
    return this.records.some((r) => identityKey(r.identity) === key && r.kind === kind);
  }

  append(
    kind: EventKind,
    identity: DecisionIdentity,
    projection: ProjectionKind | null,
    disposition: string,
    at: number
  ) {
    return appendStoreTransaction<EventRecord>({
      path: this.path,
      persisting: this.persisting,
      lastError: this.lastError,
      storeLabel: "event book",
      prepare: () => {
        const seq = this.records.length;
        const record: EventRecord = { seq, kind, identity, projection, disposition, at };
        return {
          record,
          line: JSON.stringify(record) + "\n",
          commit: () => this.records.push(record),
        };
      },
      resync: null,
      appender: this.appender,
      memoryDetail:
        "no event-book path was injected: this event is IN MEMORY only and " +
        "does not survive the process.",
      notPersistingDetail:
        "the event book is not in a persisting state; the event was not written to disk.",
      onAppendError: (raw) => {
        this.lastError = `cannot append to event book: ${raw}`;
        return this.lastError;
      },
    });
  }
}

// ── request/response shapes ───────────────────────────────────────────────────

export interface EvaluateAndRecordRequest {
  readonly identity: DecisionIdentity;
  readonly subject: string;
  readonly toolName: string;
  readonly stakesClass?: string;
  readonly requestHash: string;
}

export interface EvaluateAndRecordPaths {
  readonly journal: string;
  /** The REAL floor-trail file. Opened by THIS function, AFTER FINAL, never by guard(). */
  readonly floorTrail?: string;
  /** The REAL PASS-BLIND ledger file. Same discipline as `floorTrail`. */
  readonly ledger?: string;
  readonly history?: string;
  readonly events?: string;
}

export interface EvaluateAndRecordOptions {
  /** Blocker 3: never a fabricated digest. Required — no hash-of-empty-object fallback exists. */
  readonly declarationBinding: DeclarationBinding;
  readonly now?: () => number;
  readonly journalAppender?: LineAppender;
  readonly journalAcquire?: LockAcquirer;
  readonly eventAppender?: LineAppender;
}

export interface DeliveryStatus {
  readonly trail: ProjectionState;
  readonly ledger: ProjectionState;
  readonly history: ProjectionState;
  readonly events: ProjectionState;
}

/**
 * P6. WHAT THIS CALL'S READERS STOOD ON — or, when this call took no reading at
 * all, that fact as a value rather than as an empty array.
 *
 * THE DEFECT THIS SHAPE EXISTS TO END (mica-bridge register E1, and the
 * stage1-guard-adapter.ts comment that dispatched this beat): a field that
 * reads identically whether or not the thing it describes happened. A bare
 * `readerFootings: []` is exactly that — it says "no reader was wired" and "two
 * readers were wired and nobody asked them" in the same four characters.
 *
 * So the two cases are DIFFERENT VALUES:
 *
 *   THIS_CALL        — `wire()` ran in this call; `readers` is what IT read.
 *                      An empty `readers` here is a real finding: this wiring
 *                      built no log reader.
 *   NO_READING_TAKEN — this call returned a decision WITHOUT calling `wire()`.
 *                      There is exactly one such path (replay from an existing
 *                      DECISION_FINAL) and the honest answer for it is not an
 *                      empty array: the footing that decision was taken under
 *                      belonged to the ORIGINAL call, the journal does not
 *                      record it, and reporting anything else here would be a
 *                      different call's reading wearing this one's identity.
 */
export type ReaderFootingsReport =
  | { readonly kind: "THIS_CALL"; readonly readers: readonly ReaderFootingReading[] }
  | { readonly kind: "NO_READING_TAKEN"; readonly reason: string };

/** The one reason string a NO_READING_TAKEN report can carry today. */
export const REPLAY_TOOK_NO_READING =
  "REPLAYED from an existing DECISION_FINAL: this call constructed no reader and " +
  "took no reading. The footing this decision was originally evaluated under " +
  "belonged to the call that wrote the FINAL record; it is not stored in the " +
  "journal and is not reconstructable here. Nothing is reported rather than " +
  "another call's reading reported as this one's.";

export type EvaluateAndRecordResult =
  | {
      readonly kind: "OK";
      readonly decision: Record<string, unknown>;
      readonly delivery: DeliveryStatus;
      readonly replayed: boolean;
      /**
       * P6. REQUIRED, never optional: a caller that forgets it cannot compile,
       * which is the only version of this field that closes the gap it was
       * added for. See `ReaderFootingsReport`.
       */
      readonly readerFootings: ReaderFootingsReport;
      readonly recordNotPersisted?: true;
      /** Orphan PREPARED/PASSBLIND_PREPARED lines found for this identity with no FINAL. */
      readonly quarantined: readonly (DecisionPreparedRecord | PassBlindPreparedRecord)[];
    }
  | {
      readonly kind: "CONFLICT";
      readonly identity: DecisionIdentity;
    };

/**
 * R1. `readings` and `bindingMinimum` JOIN THE HASHED OBJECT, and that choice is
 * the whole of the safe route — so it is recorded here rather than left to be
 * re-derived by whoever reads this next.
 *
 * The obvious place to put a margin is on the verdict, beside the kind it
 * qualifies. THAT IS THE EXPENSIVE ROUTE AND IT IS ALSO THE DANGEROUS ONE.
 * `verdict-logic.frozen.json` pins twenty readings and
 * `verdict-logic.test.ts` compares the live ones to it with
 * `deepStrictEqual` — a new field on `SensorVerdict` moves every scenario
 * where it is populated and requires a ruled re-freeze, and
 * `verdict-logic.test.ts` itself records that a prior ratified swap was
 * REVERTED. The frozen verdict grammar is not ground to experiment on.
 *
 * Here is additive instead, and it is also where the numbers are actually
 * WANTED: this is the object `decisionHash` covers and the object
 * `DecisionFinalRecord` persists verbatim into the hash-chained journal. A
 * margin recorded here is a margin `/explain` can hand back a week later,
 * bound to the decision that took it, with the chain saying it has not moved.
 *
 * It DOES change `decisionHash` for decisions taken after this lands — the hash
 * is over the whole object minus itself, so a new field is a new hash. Nothing
 * pins a literal decision hash; what is pinned is that a hash does not change
 * ACROSS A REPAIR for one decision, which is a property of the builder being
 * deterministic and is untouched.
 */

/**
 * SHAPE 3′ · WHY F3's READING JOINS THE DECISION OBJECT, said once here.
 *
 * `/explain` answers out of the hash-chained journal and never out of a live
 * wiring — deliberately, because a cached or re-probed answer says what the log
 * looks like NOW rather than what the reader that took this decision stood on.
 * The consequence is the reason this field exists: A COUNTER THAT DOES NOT JOIN
 * THE DECISION OBJECT IS A COUNTER `/explain` CANNOT REPORT, however faithfully
 * the reader computed it. Sig's F3 counts — stamped, tail, hole, unattributed,
 * refused-chain, mismatched-writer — lived only on the `GuardWiring` until now
 * and died with the call that built it.
 *
 * It joins the HASHED object for the same reason `readings` did (see
 * `buildDecisionObject` above): this is the object the chain covers, so a
 * counter recorded here is a counter that can be handed back a week later bound
 * to the decision that took it, with the chain saying it has not moved. It
 * changes `decisionHash` for decisions taken after this lands — the hash is
 * over the whole object minus itself — and nothing pins a literal decision hash.
 *
 * NULL MEANS SIG WAS NOT WIRED, AND THAT IS NOT THE SAME AS "F3 FOUND NOTHING".
 * `sigF3Of` returns null only when the reading carries no F3 report at all;
 * a wired F3 that joined no stamps returns a reading whose own fields say so.
 * Readers of this field must not collapse the two.
 */
function buildDecisionObject(
  identity: DecisionIdentity,
  declarationBinding: DeclarationBinding,
  result: DispositionResult,
  seq: number | null,
  readings: readonly DecisionReading[],
  bindingMinimum: BindingMinimum,
  sigF3: SigF3Reading | null
): Record<string, unknown> {
  const d = result.decision;
  const withoutHash = {
    identity,
    disposition: result.disposition,
    execute: result.execute,
    floorKind: d.floorKind,
    blindSplit: d.blindSplit,
    narrowed: result.narrowed,
    rationale: d.rationale,
    findings: d.findings,
    blindPaths: d.blindPaths,
    readings,
    bindingMinimum,
    sigF3,
    seq,
    declarationBinding,
  };
  return { ...withoutHash, decisionHash: canonicalHash(withoutHash) };
}

function buildRecordNotPersistedHold(
  identity: DecisionIdentity,
  declarationBinding: DeclarationBinding,
  result: DispositionResult,
  commitDetail: string,
  readings: readonly DecisionReading[],
  bindingMinimum: BindingMinimum,
  sigF3: SigF3Reading | null
): Record<string, unknown> {
  const d = result.decision;
  const withoutHash = {
    identity,
    disposition: "HOLD",
    execute: false,
    floorKind: d.floorKind,
    blindSplit: d.blindSplit,
    narrowed: true,
    rationale:
      `evaluation completed (raw disposition ${d.disposition}) but the ` +
      `canonical DECISION_FINAL record could not be persisted: ${commitDetail}. ` +
      `RECORD_NOT_PERSISTED narrows to HOLD rather than returning a fail-open ` +
      `200 for an evaluated action (ruling J: fail-open applies only when NO ` +
      `evaluation was obtained). The earlier DECISION_PREPARED line, if any ` +
      `landed, stands as evidence an evaluation happened and was not finalised ` +
      `— it is quarantined on replay, never treated as a decision.`,
    findings: d.findings,
    blindPaths: d.blindPaths,
    // R1. The READERS STILL READ on this path — only the FINAL append failed.
    // Carrying the readings here, exactly as the success path does, is the same
    // distinction `readerFootings: THIS_CALL` makes four returns below: this is
    // a decision whose evaluation happened, narrowed to HOLD because it could
    // not be persisted. Dropping them would make a real reading look like an
    // absent one.
    readings,
    bindingMinimum,
    // The same distinction the comment above makes: F3 READ on this path too.
    // Dropping its counts here would make a real reading look like an absent one.
    sigF3,
    seq: null,
    declarationBinding,
  };
  return { ...withoutHash, decisionHash: canonicalHash(withoutHash) };
}

const PENDING_DELIVERY: DeliveryStatus = {
  trail: "PENDING",
  ledger: "PENDING",
  history: "PENDING",
  events: "PENDING",
};

// ── build the SubstrateHistory input straight from a PREPARED floor reading ──
//
// Equivalent to what `recordGuardResult` zips out of a live `DispositionResult`
// (`sensorIds`/`sensorKinds` joined by "|", in wired order) — used at REPAIR
// time, when no live `DispositionResult` exists any more (the process that
// took it is gone) and the journal's own PREPARED line is the only record of
// what was read. The normal (non-repair) path still calls `recordGuardResult`
// directly off the live result; this is the reconstruction the amendment's
// repair story requires when that live result no longer exists.

function historyInputFromFloorReading(
  floorReading: PreparedFloorReading,
  execute: boolean,
  timestamp: number
) {
  const ids = floorReading.sensorIds.length === 0 ? [] : floorReading.sensorIds.split("|");
  const kinds = floorReading.sensorKinds.length === 0 ? [] : floorReading.sensorKinds.split("|");
  const n = Math.min(ids.length, kinds.length);
  const factors: { factor: string; verdictKind: VerdictKind }[] = [];
  for (let i = 0; i < n; i++) factors.push({ factor: ids[i], verdictKind: kinds[i] as VerdictKind });
  return {
    timestamp,
    factors,
    floorKind: floorReading.floorKind as VerdictKind,
    disposition: floorReading.disposition,
    execute,
    actionId: floorReading.actionId,
  };
}

/**
 * ONE mechanism, used both right after a fresh FINAL and by start-time
 * repair: DETECT an existing target-book record for this identity FIRST
 * (never re-appending onto one that already landed — this is the
 * "detect-then-mark" the amendment names); when none exists, ACTUALLY
 * PERFORM the write now (there is no duplicate risk — nothing is there
 * yet), then mark DONE/FAILED from that real outcome. A projection already
 * marked DONE is never revisited by either call site.
 */
function ensureProjection(
  journal: DecisionJournal,
  paths: EvaluateAndRecordPaths,
  history: SubstrateHistory | null,
  events: EventBook | null,
  identity: DecisionIdentity,
  projection: ProjectionKind,
  preparedFloor: PreparedFloorReading | null,
  preparedPassBlind: PreparedPassBlindReading | null,
  execute: boolean,
  now: () => number,
  /**
   * The live DispositionResult, when this call is made right after guard()
   * returned in THIS SAME process — used ONLY for the "history" projection,
   * so the primary path still goes through `recordGuardResult` exactly as
   * named in the dispatch brief. Absent at repair time (the process that
   * took the reading is gone); history is then reconstructed from the
   * PREPARED floor reading, which carries the same sensorIds/sensorKinds.
   */
  liveResult: DispositionResult | null = null
): void {
  if (journal.projectionStatus(identity)[projection] === "DONE") return;

  const mark = (kind: "DONE" | "FAILED", detail: string | null): void => {
    journal.recordProjection(identity, projection, kind, detail, now());
    if (events !== null && projection !== "events") {
      // A STATUS notification about THIS projection, uniquely keyed by
      // `projection` — never the "events" projection's own target event,
      // and never mistakable for it (see EventRecord.projection).
      events.append(
        kind === "DONE" ? "PROJECTION_DONE" : "PROJECTION_FAILED",
        identity,
        projection,
        preparedFloor?.disposition ?? "",
        now()
      );
    }
  };

  if (projection === "trail") {
    if (paths.floorTrail === undefined) {
      mark("FAILED", "no --floor-trail path was supplied; the wrapper has nowhere to write the real floor-trail file");
      return;
    }
    const t = new FloorTrail({ path: paths.floorTrail });
    if (t.getAll().some((r) => r.actionId === identity.actionId)) {
      mark("DONE", "detected: an existing floor-trail record for this identity was found before any append was attempted");
      return;
    }
    if (preparedFloor === null) {
      mark("FAILED", "no DECISION_PREPARED floor reading was captured for this evaluation");
      return;
    }
    const trailInput: FloorTrailRecordInput = {
      timestamp: preparedFloor.timestamp,
      actionId: preparedFloor.actionId,
      disposition: preparedFloor.disposition as ChokepointDisposition,
      floorKind: preparedFloor.floorKind as VerdictKind,
      blindSplit: preparedFloor.blindSplit as FloorTrailRecordInput["blindSplit"],
      impactClass: preparedFloor.impactClass,
      sensorIds: preparedFloor.sensorIds,
      sensorKinds: preparedFloor.sensorKinds,
    };
    const outcome = t.record(trailInput);
    maybeFailpoint("after-projection-append-before-marker:trail");
    mark(outcome.persisted ? "DONE" : "FAILED", outcome.persisted ? null : `the real floor-trail append did not persist: ${outcome.detail}`);
    maybeFailpoint("after-projection:trail");
    return;
  }

  if (projection === "ledger") {
    const ledgerDue = preparedFloor !== null && preparedFloor.disposition === "PASS_BLIND";
    if (!ledgerDue) {
      mark("DONE", null); // nothing was due; DONE by definition
      return;
    }
    if (paths.ledger === undefined) {
      mark("FAILED", "no --ledger path was supplied; the wrapper has nowhere to write the real PASS-BLIND ledger file");
      return;
    }
    const l = new ChokepointLedger({ path: paths.ledger });
    if (l.getAll().some((r) => r.actionId === identity.actionId)) {
      mark("DONE", "detected: an existing ledger record for this identity was found before any append was attempted");
      return;
    }
    if (preparedPassBlind === null) {
      mark("FAILED", "no PASSBLIND_PREPARED record was captured for a PASS_BLIND disposition");
      return;
    }
    const ledgerInput: ChokepointLedgerRecordInput = {
      actionId: preparedPassBlind.actionId,
      disposition: "PASS_BLIND",
      floorKind: preparedPassBlind.floorKind as VerdictKind,
      impactClass: preparedPassBlind.impactClass,
      sensorIds: preparedPassBlind.sensorIds,
    };
    const outcome = l.record(ledgerInput);
    maybeFailpoint("after-projection-append-before-marker:ledger");
    mark(outcome.persisted ? "DONE" : "FAILED", outcome.persisted ? null : `the real ledger append did not persist: ${outcome.detail}`);
    maybeFailpoint("after-projection:ledger");
    return;
  }

  if (projection === "history") {
    if (history === null) {
      mark("FAILED", "no --history path was supplied; the doctor history was not wired for this run");
      return;
    }
    if (history.getAll().some((r) => r.recordType === "SUBSTRATE_READ" && r.actionId === identity.actionId)) {
      mark("DONE", "detected: an existing SUBSTRATE_READ for this identity was found before any append was attempted");
      return;
    }
    if (liveResult !== null) {
      // The primary path: history via recordGuardResult, off the SAME live
      // DispositionResult guard() just returned.
      const outcome = recordGuardResult(history, liveResult, now());
      maybeFailpoint("after-projection-append-before-marker:history");
      mark(outcome.persisted ? "DONE" : "FAILED", outcome.persisted ? null : outcome.detail);
      maybeFailpoint("after-projection:history");
      return;
    }
    if (preparedFloor === null) {
      mark("FAILED", "no DECISION_PREPARED floor reading was captured for this evaluation");
      return;
    }
    // Repair path: no live DispositionResult exists any more; reconstruct
    // the equivalent input from the journal's own PREPARED floor reading.
    const outcome = history.record(historyInputFromFloorReading(preparedFloor, execute, now()));
    maybeFailpoint("after-projection-append-before-marker:history");
    mark(outcome.persisted ? "DONE" : "FAILED", outcome.persisted ? null : outcome.detail);
    maybeFailpoint("after-projection:history");
    return;
  }

  // events (F1: the TARGET event for this projection is the identity's own
  // DECISION_FINAL event — not any of the PROJECTION_DONE/FAILED status
  // notifications `mark()` also writes into this same book for the other
  // three projections. See the file-header note on that sharing decision.
  // Ordering is now IDENTICAL to the other three: detect the target event
  // first (never re-appending onto one that already landed); when absent,
  // PERFORM the append, THEN fire the before-marker failpoint, THEN record
  // the journal marker, THEN fire the after failpoint.)
  if (events === null) {
    journal.recordProjection(identity, "events", "FAILED", "no --events path was supplied, or the event book could not persist", now());
    return;
  }
  if (events.hasEvent(identity, "DECISION_FINAL")) {
    journal.recordProjection(identity, "events", "DONE", "detected: an existing DECISION_FINAL event for this identity was found before any append was attempted", now());
    return;
  }
  const eventOutcome = events.append(
    "DECISION_FINAL",
    identity,
    null, // the TARGET event itself, not a status notification about any projection
    preparedFloor?.disposition ?? "",
    now()
  );
  maybeFailpoint("after-projection-append-before-marker:events");
  journal.recordProjection(
    identity,
    "events",
    eventOutcome.persisted ? "DONE" : "FAILED",
    eventOutcome.persisted ? null : "the event-book append did not persist",
    now()
  );
  maybeFailpoint("after-projection:events");
}

// ── start-time repair: run ensureProjection for every FINAL'd identity ───────

function repairProjections(
  journal: DecisionJournal,
  paths: EvaluateAndRecordPaths,
  history: SubstrateHistory | null,
  events: EventBook | null,
  now: () => number
): void {
  for (const identity of journal.allFinalIdentities()) {
    const status = journal.projectionStatus(identity);
    if (status.trail === "DONE" && status.ledger === "DONE" && status.history === "DONE" && status.events === "DONE") {
      continue;
    }
    const prepared = journal.preparedRecordsFor(identity);
    const preparedFloor =
      (prepared.find((r) => r.recordType === "DECISION_PREPARED") as DecisionPreparedRecord | undefined)
        ?.floorReading ?? null;
    const preparedPassBlind =
      (prepared.find((r) => r.recordType === "PASSBLIND_PREPARED") as PassBlindPreparedRecord | undefined)
        ?.passBlindReading ?? null;
    const final = journal.findFinal(identity);
    const execute = final !== null && final.decision.execute === true;
    for (const projection of ["trail", "ledger", "history", "events"] as const) {
      ensureProjection(journal, paths, history, events, identity, projection, preparedFloor, preparedPassBlind, execute, now);
    }
  }
}

// ── the main entry point ──────────────────────────────────────────────────────

export function evaluateAndRecord(
  request: EvaluateAndRecordRequest,
  paths: EvaluateAndRecordPaths,
  wireOptions: WireOptions,
  options: EvaluateAndRecordOptions
): EvaluateAndRecordResult {
  validateRequest(request);
  const now = options.now ?? Date.now;
  const declarationBinding = options.declarationBinding;
  if (!isDeclarationBinding(declarationBinding)) {
    throw new EvaluateAndRecordUsageError(
      `options.declarationBinding must be {kind:"HASH", sha256} or ` +
        `{kind:"UNBOUND_STAGE_1"} — never omitted, and never a fabricated ` +
        `digest standing in for a real one.`
    );
  }

  const journal = new DecisionJournal({
    path: paths.journal,
    appender: options.journalAppender,
    acquire: options.journalAcquire,
  });

  const history =
    paths.history === undefined ? null : new SubstrateHistory({ path: paths.history });
  const events =
    paths.events === undefined
      ? null
      : new EventBook({ path: paths.events, appender: options.eventAppender });

  // Start-time repair, before any lookup or new evaluation.
  repairProjections(journal, paths, history, events, now);

  // ── identity lookup — ONLY a DECISION_FINAL is authoritative ────────────
  const existingFinal = journal.findFinal(request.identity);
  if (existingFinal !== null) {
    if (existingFinal.requestHash === request.requestHash) {
      return {
        kind: "OK",
        decision: existingFinal.decision,
        delivery: journal.projectionStatus(request.identity),
        replayed: true,
        // P6. This return is ABOVE the `wire()` call below — no reader exists
        // in this call's scope to ask, and the one that produced this decision
        // is gone. Said as a value, not as `[]`.
        readerFootings: { kind: "NO_READING_TAKEN", reason: REPLAY_TOOK_NO_READING },
        quarantined: [],
      };
    }
    return { kind: "CONFLICT", identity: request.identity };
  }

  // Orphan PREPARED lines from a prior evaluation that never reached FINAL —
  // never authoritative, reported for the record, never conflict-checked.
  const quarantined = journal.orphanPreparedFor(request.identity);

  // ── phase 1: guard() writes DECISION_PREPARED (and PASSBLIND_PREPARED, if
  //    due) INSIDE the call, via the journal-backed overrides ──────────────
  const floorTrailOverride = new JournalBackedFloorTrail(
    journal,
    request.identity,
    request.requestHash,
    declarationBinding,
    now
  );
  const ledgerOverride = new JournalBackedLedger(
    journal,
    request.identity,
    request.requestHash,
    declarationBinding,
    now
  );

  const wiring = wire({ ...wireOptions, floorTrailOverride, ledgerOverride });
  const provisional = wiring.chokepoint.guard(
    { id: request.identity.actionId },
    wiring.sensorVerdicts,
    request.stakesClass === undefined ? null : { impactClass: request.stakesClass }
  );

  // Boundary: guard() has returned. Both mandatory phase-1 writes (whichever
  // were due) have already been attempted and their outcomes already folded
  // into `provisional` by guard()'s own narrowing — nothing special to do
  // with a failure here beyond letting that narrowing speak for itself.
  maybeFailpoint("after-prepared");

  // ── phase 2: the ONE mandatory boundary ─────────────────────────────────
  const seq = journal.allFinalIdentities().length;
  // R1. Derived from THIS call's `wiring` and THIS decision's floor kind — the
  // two values the readings must belong to, and the only two that cannot be
  // sourced from somewhere else without reporting a different call's reading.
  const readings = readingsFromWiring(wiring, provisional.decision.floorKind);
  // The VERDICTS, not the readings: six of the eight readers on the live box
  // produce no margin, so a binding set filtered from `readings` could never
  // name them. See bindingMinimumOf.
  const bindingMinimum = bindingMinimumOf(
    wiring.sensorVerdicts,
    readings,
    provisional.decision.floorKind
  );
  const decision = buildDecisionObject(
    request.identity,
    declarationBinding,
    provisional,
    seq,
    readings,
    bindingMinimum,
    // THIS call's wiring, the same one `readings` came from.
    wiring.sigF3
  );
  const decisionHash = decision.decisionHash as string;

  const finalAt = now();
  const finalOutcome = journal.appendFinal(
    request.identity,
    request.requestHash,
    declarationBinding,
    decision,
    decisionHash,
    finalAt
  );

  if (!finalOutcome.persisted) {
    const holdDecision = buildRecordNotPersistedHold(
      request.identity,
      declarationBinding,
      provisional,
      finalOutcome.detail ?? "unknown reason",
      readings,
      bindingMinimum,
      wiring.sigF3
    );
    return {
      kind: "OK",
      decision: holdDecision,
      delivery: PENDING_DELIVERY,
      replayed: false,
      // P6. The readers DID read on this path — only the FINAL append failed.
      // `wiring` is this call's own, four statements up.
      readerFootings: { kind: "THIS_CALL", readers: footingsFromWiring(wiring) },
      recordNotPersisted: true,
      quarantined,
    };
  }
  maybeFailpoint("after-final");

  // F1: the DECISION_FINAL event is NOT appended here. It is the "events"
  // projection's OWN target write, performed by `ensureProjection` below —
  // appending it here, before that call, was exactly the bug the verifier
  // found: it made the events projection detectable as "already done"
  // (via the old identity-only `hasEventFor`) before `ensureProjection` for
  // "events" ever ran, so its failpoints were never reached and its own
  // append/marker ordering was never exercised.

  // ── phase 3: repairable projections, wrapper-owned, strictly AFTER FINAL ─
  //
  // Uses the SAME ensureProjection mechanism start-time repair uses (detect
  // an existing target-book record first, perform the write only when none
  // exists, mark DONE/FAILED from the real outcome) — so a crash between any
  // two of these four calls repairs identically on retry, whichever process
  // performs the repair.
  const preparedFloor = floorTrailOverride.lastPrepared?.floorReading ?? null;
  const preparedPassBlind = ledgerOverride.lastPrepared?.passBlindReading ?? null;
  for (const projection of ["trail", "ledger", "history", "events"] as const) {
    ensureProjection(
      journal,
      paths,
      history,
      events,
      request.identity,
      projection,
      preparedFloor,
      preparedPassBlind,
      provisional.execute,
      now,
      provisional
    );
  }

  return {
    kind: "OK",
    decision,
    delivery: journal.projectionStatus(request.identity),
    replayed: false,
    // P6. `wiring` is the local built by THIS call's `wire()` — the same object
    // whose `chokepoint.guard()` produced `provisional`, which produced
    // `decision`. `footingsFromWiring` takes that value and nothing else, so
    // the footing cannot be a different call's reading. See its header.
    readerFootings: { kind: "THIS_CALL", readers: footingsFromWiring(wiring) },
    quarantined,
  };
}
