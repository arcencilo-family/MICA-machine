// ── MICA · review log — the D-layer's trail, hash-chained, append-only (S117) ─
//
// Build B, deliverable 2.1. `review.ts` is a pure state machine over records
// that live exactly as long as the process holding them: A's receipt §8 found
// that nothing anywhere persists a review record, and this is the format half
// of the answer. `review-store.ts` is the disk half.
//
// The split is `evidence-log.ts` / `evidence-store.ts`'s, adopted deliberately:
// format and pure array-in/array-out operations here, load discipline and the
// one append seam next door.
//
// ── ONE CHAIN, FOUR KINDS — because order ACROSS kinds is itself evidence ────
//
//   A `SIGNATURE` means something only relative to the closes that precede it:
//   "I individually reviewed these twelve" is a different claim depending on
//   which twelve were closed when it was written. A journal entry recording a
//   structural refusal is evidence about the state the case was in at that
//   moment. Separate chains would preserve each kind's internal order and
//   lose every relation between them, which is most of what a reviewer's trail
//   is for. So: one chain, four record kinds, one sequence.
//
// ── THE FOURTH KIND · CHAIN_REVIEW — a case is not a file (S132, brief §1.1) ─
//
//   The three kinds above are all keyed by a CASE — a scenario id. A pilot run
//   is not a case: it is a FILE with a sha, holding many cases' attempts. So
//   nothing in this trail could say "chain `f896677a…` was opened and its
//   verify came back valid", and S123's ratifying-read rule (a read by someone
//   other than the chain's writer) had no record to land in. This kind is that
//   record, and it is in THIS chain for the same reason the other three are:
//   a chain review that arrives AFTER a seat signed a batch is a different
//   fact from one that arrives before it, and only one sequence can say which.
//
//   WHAT IT MAY SAY, AND THE 08a BOUND ON IT. It certifies nothing about any
//   reading, any verdict or any judgment. Its whole claim is: this seat opened
//   this file, ran the chain verify that already existed, and the sha it saw
//   was this one. That is a bounded negative attestation (canon 08a) and the
//   strongest sentence available to it — "verify valid at this sha" — is
//   already at the bound. It is not a grade and it cannot become one.
//
//   IT HOLDS NO CLOCK AND COMPUTES NO DIGEST. `chainSha256`, `recordCount`,
//   `verifyResult` and `readerVersion` all arrive from the caller, as the
//   `timestamp` does. This module hashes the record it is handed; it does not
//   go and look at the file the record names, and it must never learn how.
//
// ── IT DERIVES LEGALITY; IT DOES NOT RESTATE IT [LB] ─────────────────────────
//
//   There is NO successor table in this file. `appendReviewState` decides
//   whether a transition is legal by REPLAYING `review.ts`'s own transition
//   function against the case's current record and requiring the result to
//   equal the candidate. If `recordInitialJudgment` would have refused it, this
//   refuses it; if `closeReview` would have produced a different record, this
//   refuses that too.
//
//   That is strictly stronger than a state-successor map, and the extra
//   strength is the point: a hand-forged entry whose `state` is a legal
//   successor but whose `machineVerdict` has been quietly changed mid-case is
//   NOT something `review.ts` could have produced, so it is refused. The
//   grader's own answer cannot be edited after the fact by appending a
//   plausible next state on top of it.
//
//   Cost, stated: this file is coupled to those functions' exact outputs, so a
//   change to what `closeReview` returns breaks appends until this is re-read.
//   That is the coupling we want — the alternative is a table that drifts from
//   them silently, which is the failure this project keeps refusing.
//
// ── THE HASH COMMITS TO THE WHOLE PAYLOAD, AND THAT IS NOT AUTOMATIC ─────────
//
//   `canonicalJson` below is a RECURSIVE key-sorted serializer, written out
//   rather than borrowed. The sibling format's helper uses
//   `JSON.stringify(o, Object.keys(o).sort())`, and an ARRAY second argument to
//   `JSON.stringify` is a key FILTER applied at every nesting level, not a key
//   ordering — so nested objects serialize as `{}` and the hash does not commit
//   to them. That is a live, proven defect in the probe evidence log
//   (`ARC_MICA-BLOCKED_S117-Evidence-Hash-Observables_20260907`), fenced out of
//   this build and NOT inherited here. `RL-H` is the negative control that
//   would have caught it: two records differing only inside a nested payload
//   must not hash equal.
//
// ── THIS MODULE CALLS NO CLOCK ───────────────────────────────────────────────
//
//   `timestamp` is injected on every append, as in both siblings. A reviewer's
//   trail must not have this file testifying about when a judgment was made.

import {
  hasExactKeys,
  isEnum,
  isNonNegInteger,
  isObject,
  isString,
  type Parsed,
} from "../mica/store/validate";
import { createHash } from "crypto";
import {
  ReviewRecordRefused,
  closeReview,
  initializeReview,
  recordInitialJudgment,
  recordRevisedJudgment,
  reveal,
  validateReviewRecord,
  type ReviewJournalEntry,
  type ReviewRecord,
  type SignatureRecord,
} from "./review";
import { GRADING_VERDICTS } from "./scenario";

// ── the frame every record shares ────────────────────────────────────────────

interface ReviewFrame {
  readonly sequenceNumber: number;
  readonly previousHash: string;
  readonly hash: string;
  /** Presented (caller-supplied) wall time — this module never calls a clock. */
  readonly timestamp: number;
}

/** One transition. The CURRENT state of a case is its latest such entry. */
export interface ReviewStateRecord extends ReviewFrame {
  readonly kind: "REVIEW_STATE";
  readonly record: ReviewRecord;
}

export interface JournalLogRecord extends ReviewFrame {
  readonly kind: "JOURNAL";
  readonly entry: ReviewJournalEntry;
}

export interface SignatureLogRecord extends ReviewFrame {
  readonly kind: "SIGNATURE";
  readonly signature: SignatureRecord;
}

/** `valid`, or `broken@<index>` — the two things a chain verify can come back. */
export const CHAIN_VERIFY_VALID = "valid";

/** The ONE spelling of a located break, so no caller invents a second one. */
export function chainVerifyBroken(brokenAt: number): string {
  return `broken@${String(brokenAt)}`;
}

const CHAIN_VERIFY_BROKEN = /^broken@(0|[1-9][0-9]*)$/;

/** A 64-character lowercase hex digest, and nothing that merely looks like one. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * ONE SEAT'S OPENING OF ONE CHAIN FILE. Every field is the caller's; see the
 * header for why this module looks at nothing.
 *
 * `timestamp` is NOT here. It is on the frame, where every other kind keeps it,
 * and a second copy inside the payload would be a second thing to disagree —
 * the same reasoning `evidence-log.ts` gives for leaving `declaredAt` out of an
 * OUTCOME. The brief listed it among the fields; the frame already carries it.
 */
export interface ChainReview {
  /** Whose run this chain holds, as the chain's own provenance names it. */
  readonly subjectId: string;
  /** The run's id. A FILENAME fact — see `review-cli.ts`'s `chain` act. */
  readonly runId: string;
  readonly chainPath: string;
  readonly chainSha256: string;
  readonly recordCount: number;
  /** `valid` or `broken@<n>` — `CHAIN_VERIFY_VALID` / `chainVerifyBroken`. */
  readonly verifyResult: string;
  /** The reading tree's VINTAGE claim, or `UNKNOWN:<state>`. A claim, not a measurement. */
  readonly readerVersion: string;
  /** Declared, never authenticated — the same bound every seat name here carries. */
  readonly reviewerSeat: string;
}

export interface ChainReviewRecord extends ReviewFrame {
  readonly kind: "CHAIN_REVIEW";
  readonly review: ChainReview;
}

export type ReviewLogRecord =
  | ReviewStateRecord
  | JournalLogRecord
  | SignatureLogRecord
  | ChainReviewRecord;
export type ReviewLog = readonly ReviewLogRecord[];

export const REVIEW_LOG_KINDS: readonly ReviewLogRecord["kind"][] = [
  "REVIEW_STATE",
  "JOURNAL",
  "SIGNATURE",
  "CHAIN_REVIEW",
];

// ── hashing — domain-separated, length-prefixed, unit-separator joined ───────

const US = String.fromCharCode(31);

function lengthPrefixed(value: string): string {
  return `${String(value.length)}:${value}`;
}

/**
 * Key-sorted, RECURSIVELY, and total over the JSON values these payloads hold.
 * `undefined`-valued keys are dropped, exactly as `JSON.stringify` drops them,
 * so an absent optional field and a field explicitly set to `undefined` hash
 * alike — which is what the closed-shape validators already treat as one state.
 *
 * See this file's header for why it is not the sibling's one-liner.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) as string;
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

export type UnhashedReviewLogRecord =
  | Omit<ReviewStateRecord, "hash">
  | Omit<JournalLogRecord, "hash">
  | Omit<SignatureLogRecord, "hash">
  | Omit<ChainReviewRecord, "hash">;

/** The payload this record commits to — one field per kind, whole. */
function payloadOf(r: UnhashedReviewLogRecord): unknown {
  if (r.kind === "REVIEW_STATE") return r.record;
  if (r.kind === "JOURNAL") return r.entry;
  if (r.kind === "SIGNATURE") return r.signature;
  return r.review;
}

export function computeReviewLogRecordHash(r: UnhashedReviewLogRecord): string {
  const parts = [
    "MICA-REVIEW-LOG-v1",
    String(r.sequenceNumber),
    r.previousHash,
    String(r.timestamp),
    r.kind,
    lengthPrefixed(canonicalJson(payloadOf(r))),
  ];
  return createHash("sha256").update(parts.join(US), "utf8").digest("hex");
}

// ── validation — closed shape, per kind ──────────────────────────────────────

function validateFrame(o: Parsed): boolean {
  return (
    isNonNegInteger(o.sequenceNumber) &&
    isString(o.previousHash) &&
    isString(o.hash) &&
    isNonNegInteger(o.timestamp)
  );
}

const FRAME_KEYS = ["sequenceNumber", "previousHash", "hash", "timestamp", "kind"];

const JOURNAL_KINDS = [
  "INITIAL_VS_REVISED",
  "HUMAN_VS_MACHINE",
  "UNRESOLVED_AT_CLOSE",
  "STRUCTURAL_REFUSAL",
] as const;

/**
 * `review.ts` defines `ReviewJournalEntry` and never validates one — it had no
 * store boundary to validate at until now. So the closed-shape check lives
 * HERE, in the format file, which is where both siblings keep theirs. Nothing
 * in `review.ts` is edited to add it (§3 fence), and nothing about the type is
 * restated: the key lists below are read off that file's own interfaces.
 */
export function validateReviewJournalEntry(x: unknown): x is ReviewJournalEntry {
  if (!isObject(x)) return false;
  const o = x as Parsed;
  if (!isString(o.scenarioId) || o.scenarioId.length === 0) return false;
  if (!isNonNegInteger(o.recordedAt)) return false;
  const base = ["kind", "scenarioId", "recordedAt"];
  switch (o.kind) {
    case "INITIAL_VS_REVISED":
      return (
        hasExactKeys(o, [...base, "initialJudgment", "revisedJudgment"]) &&
        isEnum(o.initialJudgment, GRADING_VERDICTS) &&
        isEnum(o.revisedJudgment, GRADING_VERDICTS)
      );
    case "HUMAN_VS_MACHINE":
    case "UNRESOLVED_AT_CLOSE":
      return (
        hasExactKeys(o, [...base, "humanJudgment", "machineVerdict"]) &&
        isEnum(o.humanJudgment, GRADING_VERDICTS) &&
        isEnum(o.machineVerdict, GRADING_VERDICTS)
      );
    case "STRUCTURAL_REFUSAL":
      return (
        hasExactKeys(o, [...base, "attemptedOperation", "detail"]) &&
        isString(o.attemptedOperation) &&
        o.attemptedOperation.length > 0 &&
        isString(o.detail)
      );
    default:
      return false;
  }
}

function validateBatchClaim(x: unknown): boolean {
  if (!isObject(x)) return false;
  const o = x as Parsed;
  if (!hasExactKeys(o, ["selectionRule", "censusCounts", "window"])) return false;
  if (!isObject(o.selectionRule)) return false;
  const rule = o.selectionRule as Parsed;
  if (!hasExactKeys(rule, ["ruleId", "fraction", "seed"])) return false;
  if (rule.ruleId !== "EDGE_CASES_FIRST_PLUS_FRACTION_SAMPLE") return false;
  if (typeof rule.fraction !== "number" || !Number.isFinite(rule.fraction)) return false;
  if (!Number.isSafeInteger(rule.seed)) return false;
  if (!isObject(o.censusCounts)) return false;
  for (const v of Object.values(o.censusCounts as Parsed)) {
    if (!isNonNegInteger(v)) return false;
  }
  if (!isObject(o.window)) return false;
  const w = o.window as Parsed;
  return (
    hasExactKeys(w, ["startMs", "endMs"]) && isNonNegInteger(w.startMs) && isNonNegInteger(w.endMs)
  );
}

/**
 * Closed-shape, and it preserves the ONE property `SignatureScope` exists to
 * hold: `individuallyReviewedCaseIds` is a finite list of strings and there is
 * no field anywhere in the shape that could mean "all of them". A wildcard
 * string is still just a case id here; nothing reads it as a pattern.
 */
export function validateSignatureRecord(x: unknown): x is SignatureRecord {
  if (!isObject(x)) return false;
  const o = x as Parsed;
  if (!hasExactKeys(o, ["signerSeat", "scope", "signedAt"])) return false;
  if (!isString(o.signerSeat) || o.signerSeat.length === 0) return false;
  if (!isNonNegInteger(o.signedAt)) return false;
  if (!isObject(o.scope)) return false;
  const scope = o.scope as Parsed;
  const hasBatch = scope.batchClaim !== undefined;
  const keys = hasBatch
    ? ["individuallyReviewedCaseIds", "batchClaim"]
    : ["individuallyReviewedCaseIds"];
  if (!hasExactKeys(scope, keys)) return false;
  if (!Array.isArray(scope.individuallyReviewedCaseIds)) return false;
  if (!scope.individuallyReviewedCaseIds.every((id: unknown) => isString(id) && id.length > 0)) {
    return false;
  }
  return !hasBatch || validateBatchClaim(scope.batchClaim);
}

/**
 * Closed shape. The two fields that are NOT merely "a nonempty string" are the
 * two a reader will act on: `chainSha256` must be a 64-char lowercase hex
 * digest, and `verifyResult` must be one of the two spellings this file owns.
 * A sha field that accepted "valid" — or a verify field that accepted a digest
 * — would let a hand-written line put the wrong fact in the column a trailer
 * flips on, which is the one thing this record is read for.
 */
export function validateChainReview(x: unknown): x is ChainReview {
  if (!isObject(x)) return false;
  const o = x as Parsed;
  if (
    !hasExactKeys(o, [
      "subjectId",
      "runId",
      "chainPath",
      "chainSha256",
      "recordCount",
      "verifyResult",
      "readerVersion",
      "reviewerSeat",
    ])
  ) {
    return false;
  }
  for (const key of ["subjectId", "runId", "chainPath", "readerVersion", "reviewerSeat"]) {
    if (!isString(o[key]) || (o[key] as string).length === 0) return false;
  }
  if (!isString(o.chainSha256) || !SHA256_HEX.test(o.chainSha256)) return false;
  if (!isNonNegInteger(o.recordCount)) return false;
  if (!isString(o.verifyResult)) return false;
  return o.verifyResult === CHAIN_VERIFY_VALID || CHAIN_VERIFY_BROKEN.test(o.verifyResult);
}

export function validateReviewLogRecord(x: unknown): x is ReviewLogRecord {
  if (!isObject(x)) return false;
  const o = x as Parsed;
  if (!validateFrame(o)) return false;
  switch (o.kind) {
    case "REVIEW_STATE":
      // `review.ts`'s OWN validator, called rather than copied — it is the only
      // thing that knows a CLOSED record's finalHumanJudgment arithmetic.
      return hasExactKeys(o, [...FRAME_KEYS, "record"]) && validateReviewRecord(o.record);
    case "JOURNAL":
      return hasExactKeys(o, [...FRAME_KEYS, "entry"]) && validateReviewJournalEntry(o.entry);
    case "SIGNATURE":
      return hasExactKeys(o, [...FRAME_KEYS, "signature"]) && validateSignatureRecord(o.signature);
    case "CHAIN_REVIEW":
      return hasExactKeys(o, [...FRAME_KEYS, "review"]) && validateChainReview(o.review);
    default:
      return false;
  }
}

// ── reading the chain ────────────────────────────────────────────────────────

/** Every `REVIEW_STATE` payload in order. */
export function reviewStatesIn(log: ReviewLog): readonly ReviewRecord[] {
  return log.filter((r): r is ReviewStateRecord => r.kind === "REVIEW_STATE").map((r) => r.record);
}

export function journalIn(log: ReviewLog): readonly ReviewJournalEntry[] {
  return log.filter((r): r is JournalLogRecord => r.kind === "JOURNAL").map((r) => r.entry);
}

export function signaturesIn(log: ReviewLog): readonly SignatureRecord[] {
  return log
    .filter((r): r is SignatureLogRecord => r.kind === "SIGNATURE")
    .map((r) => r.signature);
}

/** Every chain review in the order it was appended. */
export function chainReviewsIn(log: ReviewLog): readonly ChainReview[] {
  return log
    .filter((r): r is ChainReviewRecord => r.kind === "CHAIN_REVIEW")
    .map((r) => r.review);
}

/** The LATEST `REVIEW_STATE` for a case — its current state. Null if it has none. */
export function currentStateOf(log: ReviewLog, scenarioId: string): ReviewRecord | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const r = log[i];
    if (r.kind === "REVIEW_STATE" && r.record.scenarioId === scenarioId) return r.record;
  }
  return null;
}

/** Every case's current state, in the order the cases first appear in the chain. */
export function currentStates(log: ReviewLog): readonly ReviewRecord[] {
  const latest = new Map<string, ReviewRecord>();
  for (const r of log) {
    if (r.kind === "REVIEW_STATE") latest.set(r.record.scenarioId, r.record);
  }
  return [...latest.values()];
}

// ── append — pure, array-in array-out, never mutates its argument ───────────

export class ReviewLogRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewLogRefused";
  }
}

function nextFrame(log: ReviewLog): { sequenceNumber: number; previousHash: string } {
  return {
    sequenceNumber: log.length,
    previousHash: log.length === 0 ? "" : log[log.length - 1].hash,
  };
}

/** Structural equality over two validated records — key sets are closed. */
function sameReviewRecord(a: ReviewRecord, b: ReviewRecord): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * THE LEGALITY DERIVATION. Every branch either calls a `review.ts` transition
 * function and compares its output, or refuses because no such function exists
 * for that shape. Nothing here encodes the successor relation itself.
 */
function replayWouldProduce(prior: ReviewRecord | null, next: ReviewRecord): string | null {
  if (prior === null) {
    if (next.state !== "PENDING_INITIAL") {
      return (
        `a case's FIRST entry must be the record \`initializeReview\` produces ` +
        `(PENDING_INITIAL); this one is ${next.state}.`
      );
    }
    const produced = initializeReview({
      scenarioId: next.scenarioId,
      selectedBy: next.selectedBy,
      verdict: next.machineVerdict,
    });
    return sameReviewRecord(produced, next)
      ? null
      : "the first entry is not what `initializeReview` produces for its own identity fields.";
  }

  const attempts: { readonly via: string; readonly run: () => ReviewRecord }[] = [];
  switch (next.state) {
    case "PENDING_INITIAL":
      return (
        `no \`review.ts\` function produces a PENDING_INITIAL record from an ` +
        `existing one — case "${next.scenarioId}" is already at ${prior.state}.`
      );
    case "INITIAL_RECORDED":
      attempts.push({
        via: "recordInitialJudgment",
        run: () => recordInitialJudgment(prior, next.initialJudgment, next.initialRecordedAt),
      });
      break;
    case "REVEALED":
      attempts.push({ via: "reveal", run: () => reveal(prior, next.revealedAt) });
      if (next.revisedJudgment !== undefined && next.revisedAt !== undefined) {
        attempts.push({
          via: "recordRevisedJudgment",
          run: () => recordRevisedJudgment(prior, next.revisedJudgment!, next.revisedAt!),
        });
      }
      break;
    case "CLOSED":
      attempts.push({ via: "closeReview", run: () => closeReview(prior, next.closedAt).record });
      break;
  }

  const refusals: string[] = [];
  for (const attempt of attempts) {
    let produced: ReviewRecord;
    try {
      produced = attempt.run();
    } catch (err) {
      if (err instanceof ReviewRecordRefused) {
        refusals.push(`${attempt.via}: ${err.message}`);
        continue;
      }
      throw err;
    }
    if (sameReviewRecord(produced, next)) return null;
    refusals.push(
      `${attempt.via} would have produced a DIFFERENT record from the same prior ` +
        `state — the entry is not a transition of the case as the chain holds it.`
    );
  }
  return refusals.join(" | ");
}

/**
 * Appends one transition. REFUSES, typed, unless `review.ts` itself would have
 * produced this exact record from the case's current one.
 */
export function appendReviewState(
  log: ReviewLog,
  record: ReviewRecord,
  timestamp: number
): ReviewLog {
  if (!validateReviewRecord(record)) {
    throw new ReviewLogRefused(
      "refused: the record does not match the closed ReviewRecord schema, or is " +
        "internally inconsistent."
    );
  }
  const detail = replayWouldProduce(currentStateOf(log, record.scenarioId), record);
  if (detail !== null) {
    throw new ReviewLogRefused(
      `refused: illegal transition for case "${record.scenarioId}" — ${detail}`
    );
  }
  const { sequenceNumber, previousHash } = nextFrame(log);
  const unhashed: Omit<ReviewStateRecord, "hash"> = {
    kind: "REVIEW_STATE",
    sequenceNumber,
    previousHash,
    timestamp,
    record,
  };
  return [...log, { ...unhashed, hash: computeReviewLogRecordHash(unhashed) }];
}

/**
 * A journal is append-only BY CONSTRUCTION — there is no ordering rule to
 * enforce and no entry that is illegal in context, so this refuses on shape
 * alone. That is not a gap: an entry recording a refusal is precisely the
 * entry a stricter rule would have thrown away.
 */
export function appendJournalEntry(
  log: ReviewLog,
  entry: ReviewJournalEntry,
  timestamp: number
): ReviewLog {
  if (!validateReviewJournalEntry(entry)) {
    throw new ReviewLogRefused("refused: the journal entry does not match the closed schema.");
  }
  const { sequenceNumber, previousHash } = nextFrame(log);
  const unhashed: Omit<JournalLogRecord, "hash"> = {
    kind: "JOURNAL",
    sequenceNumber,
    previousHash,
    timestamp,
    entry,
  };
  return [...log, { ...unhashed, hash: computeReviewLogRecordHash(unhashed) }];
}

/**
 * Shape only: the vacuity refusal already lives in `review.ts`'s
 * `createSignature`, and restating it here would be a second place for it to
 * drift. A signature that reaches this function came through that one.
 */
export function appendSignature(
  log: ReviewLog,
  signature: SignatureRecord,
  timestamp: number
): ReviewLog {
  if (!validateSignatureRecord(signature)) {
    throw new ReviewLogRefused("refused: the signature does not match the closed schema.");
  }
  const { sequenceNumber, previousHash } = nextFrame(log);
  const unhashed: Omit<SignatureLogRecord, "hash"> = {
    kind: "SIGNATURE",
    sequenceNumber,
    previousHash,
    timestamp,
    signature,
  };
  return [...log, { ...unhashed, hash: computeReviewLogRecordHash(unhashed) }];
}

/**
 * Shape only, and — unlike `appendReviewState` — there is deliberately NO
 * uniqueness rule here. A second seat opening the same file is a second fact; a
 * second opening by the SAME seat after a relay is also a second fact, and the
 * one that would be thrown away by a de-duplicating rule is precisely the one a
 * reader chasing a drift wants (same sha, two vintages; or same vintage, two
 * shas). The journal's reasoning, applied to files instead of cases.
 *
 * It refuses nothing about the WORLD, either: whether the file at `chainPath`
 * still hashes to `chainSha256` is not a question this module can ask, and a
 * check it cannot perform must not be implied by a refusal it does perform.
 */
export function appendChainReview(
  log: ReviewLog,
  review: ChainReview,
  timestamp: number
): ReviewLog {
  if (!validateChainReview(review)) {
    throw new ReviewLogRefused("refused: the chain review does not match the closed schema.");
  }
  const { sequenceNumber, previousHash } = nextFrame(log);
  const unhashed: Omit<ChainReviewRecord, "hash"> = {
    kind: "CHAIN_REVIEW",
    sequenceNumber,
    previousHash,
    timestamp,
    review,
  };
  return [...log, { ...unhashed, hash: computeReviewLogRecordHash(unhashed) }];
}

// ── verify — re-derive every hash and every link ─────────────────────────────

export interface ReviewVerifyResult {
  readonly valid: boolean;
  readonly brokenAt: number | null;
}

export function verifyReviewChain(log: ReviewLog): ReviewVerifyResult {
  let previousHash = "";
  for (let i = 0; i < log.length; i++) {
    const r = log[i];
    if (r.sequenceNumber !== i || r.previousHash !== previousHash) return { valid: false, brokenAt: i };
    if (computeReviewLogRecordHash(r) !== r.hash) return { valid: false, brokenAt: i };
    previousHash = r.hash;
  }
  return { valid: true, brokenAt: null };
}
