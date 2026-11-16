// ── MICA · probe review — the D-review layer (Build 4, design doc stage 4) ───
//
// "The duo seat sits OVER the grading path." This file is machinery for
// RECORDS: selection, blind-first capture, dissent, bounded signatures,
// capacity withholding, unanimity audit. It makes no judgment of its own —
// the first real judgments are the arbiter's, later, over records this file only
// shapes and refuses to let drift out of order.
//
// ── CONSUMPTION BOUNDARY, EXACTLY AS THE BRIEF DRAWS IT [LB] ─────────────────
//
//   This file CONSUMES `routeScenario` (routing.ts) and maps over scenarios
//   ITSELF — routing.ts gains no batch helper (Build 3 §E's constraint,
//   restated as a fence in this brief). `checks.ts`, every `families/*.ts`,
//   and `scenario.ts` are untouched. Review verdicts NEVER feed back into
//   grading: nothing in this file writes to a `ScenarioDefinition` or a
//   `ScenarioVerdict`, and `routeScenario` is never called with anything
//   this layer produced. The reviewer judges the grader; the grader never
//   reads the reviewer.
//
// ── EVERYTHING HERE IS A PLAIN, IMMUTABLE RECORD [LB] ─────────────────────────
//
//   Every exported type is flat and JSON-safe (no class instances, no
//   functions, no cyclic references). Every exported function is PURE: it
//   takes a record (or a list) and returns a NEW one, never mutating its
//   argument. "Append-only" and "immutable once committed" are therefore
//   properties of the API SURFACE, not of runtime enforcement on a mutable
//   object — there is no exported function anywhere in this file that edits
//   or removes an existing entry from a journal or a case.
//
// ── WHAT "BLIND" MEANS HERE, AND WHAT IT DOES NOT [LB] ────────────────────────
//
//   A `PendingInitialReview` record carries `machineVerdict` from the moment
//   it is created — the grader already ran, and the fact exists. "Blind"
//   is enforced at the level of ORDER (this file's state machine refuses an
//   initial judgment once a record has moved past `PENDING_INITIAL`), not at
//   the level of information hiding a human could not defeat by reading the
//   raw JSON. This file builds no UI (the brief's own fence: "the human
//   reading surface is a ruled, deferred design beat — records only") — a
//   human reading surface that wants a genuine blind presentation must
//   withhold `machineVerdict` from its own rendering until reveal; this file
//   cannot enforce that at the data layer and does not pretend to.

import { hasExactKeys, isEnum, isNonNegInteger, isObject, isString, type Parsed } from "../mica/store/validate";
import { routeScenario } from "./routing";
import { GRADING_VERDICTS, type GradingVerdict, type ScenarioDefinition } from "./scenario";

// ── 1.1 selection — declared, never improvised ───────────────────────────────

/**
 * Fixed, canon-sourced (05b §3a/§4) — not a declarable parameter. Any
 * scenario routing to one of these FOUR is always selected; the design
 * doc's own vocabulary, not this file's invention.
 *
 * S126b ruling 3 adds `UNWARRANTED_EXIT` (05b §3a-vi, and §4's new bullet:
 * NOT_ASSERTABLE -> FAIL, CANNOT_ASSESS -> CONDITIONAL). It belongs here for
 * the reason the other three do and not by analogy: it is a FINDING. The
 * record says a departure stood on a basis it could not assert, which under
 * §4 is a system fault — and a finding that reaches human review only when a
 * seeded fraction happens to draw it is a finding the review layer does not
 * actually hold. The S126 receipt §E.4 named this gap and left it, because
 * §4 carried no mapping for the new state yet and an edge-case list built on
 * §4 could not take a state §4 did not name. §4 names it now.
 *
 * THE OTHER THREE ARE UNMOVED. Nothing already selected stops being selected;
 * `review.test.ts`'s snapshot over all 51 shipped scenarios holds that at six
 * rule settings, the same idiom as routing.test.ts's RT-U7.
 */
export const EDGE_CASE_VERDICTS: readonly GradingVerdict[] = [
  "DISGUISED_DEFECTION",
  "CAPITULATION",
  "CANNOT_ASSESS",
  "UNWARRANTED_EXIT",
];

/**
 * The one declared selection rule this build ships: edge-cases-first (every
 * `EDGE_CASE_VERDICTS` member, unconditionally) PLUS a declared-fraction,
 * seeded sample of everything else. `[LB]` "two rule shapes minimum" is read
 * here as two SELECTION MECHANISMS combined in one declared rule, not two
 * mutually exclusive rule types — flagged in the receipt as a judgment call.
 */
export interface ReviewSelectionRule {
  readonly ruleId: "EDGE_CASES_FIRST_PLUS_FRACTION_SAMPLE";
  /** (0, 1]. Fraction of the NON-edge-case remainder additionally sampled. */
  readonly fraction: number;
  /** Declared, not `Date.now()` or `Math.random()` — reproducibility depends on it. */
  readonly seed: number;
}

export type SelectedByRule = "EDGE_CASES_FIRST" | "FRACTION_SAMPLE";

/** Names, for every selected case, EXACTLY which mechanism selected it. */
export interface SelectedCase {
  readonly scenarioId: string;
  readonly verdict: GradingVerdict;
  readonly selectedBy: SelectedByRule;
}

/**
 * Deterministic, seeded pseudo-randomness over `(seed, key)` — FNV-1a-shaped
 * mixing, normalized to `[0, 1)`. NOT `Math.random()`: the same rule and the
 * same key must produce the same result on every re-derivation, by any
 * reader, forever — that is what "reproducible from the declared rule +
 * seed" requires. EXPORTED as of Build 5: `delivery.ts`'s M1 jitter needs
 * the identical deterministic-hash property this file already proved for
 * selection (deliverable 1.1); reused rather than re-implemented a second
 * time in a sibling module.
 */
export function deterministicUnitInterval(seed: number, key: string): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Consumes `routeScenario` and maps over `scenarios` ITSELF — see this
 * file's header. Edge cases are listed BEFORE fraction-sample cases in the
 * returned array, on purpose: `withholdOverCapacity` slices from the end,
 * so a tight capacity drops fraction-sample cases before edge cases.
 */
export function selectForReview(
  rule: ReviewSelectionRule,
  scenarios: readonly ScenarioDefinition[]
): readonly SelectedCase[] {
  const edgeCases: SelectedCase[] = [];
  const sampled: SelectedCase[] = [];
  for (const scenario of scenarios) {
    const verdict = routeScenario(scenario).verdict;
    if (EDGE_CASE_VERDICTS.includes(verdict)) {
      edgeCases.push({ scenarioId: scenario.id, verdict, selectedBy: "EDGE_CASES_FIRST" });
      continue;
    }
    const u = deterministicUnitInterval(rule.seed, scenario.id);
    if (u < rule.fraction) {
      sampled.push({ scenarioId: scenario.id, verdict, selectedBy: "FRACTION_SAMPLE" });
    }
  }
  return [...edgeCases, ...sampled];
}

// ── 1.5 capacity — exhaustion withholds, loudly ──────────────────────────────

export interface AttestationWithheld {
  readonly reason: string;
  readonly unreviewedCaseIds: readonly string[];
  readonly recordedAt: number;
}

/**
 * `capacity` is DECLARED data (deliverable 1.5), never inferred. Edge cases
 * come first in `selected` (see `selectForReview`), so a shortfall drops
 * fraction-sample cases before it ever drops an edge case.
 */
export function withholdOverCapacity(
  selected: readonly SelectedCase[],
  capacity: number,
  atMs: number
): { readonly withinCapacity: readonly SelectedCase[]; readonly withheld: AttestationWithheld | null } {
  if (selected.length <= capacity) {
    return { withinCapacity: selected, withheld: null };
  }
  const withinCapacity = selected.slice(0, capacity);
  const unreviewed = selected.slice(capacity);
  return {
    withinCapacity,
    withheld: {
      reason:
        `selection produced ${String(selected.length)} case(s); declared review ` +
        `capacity is ${String(capacity)}`,
      unreviewedCaseIds: unreviewed.map((s) => s.scenarioId),
      recordedAt: atMs,
    },
  };
}

// ── 1.2 blind-first capture — a typed state machine, refusals included ───────

export class ReviewRecordRefused extends Error {
  constructor(
    message: string,
    readonly scenarioId: string,
    readonly attemptedOperation: string
  ) {
    super(message);
    this.name = "ReviewRecordRefused";
  }
}

interface ReviewCaseIdentity {
  readonly scenarioId: string;
  readonly selectedBy: SelectedByRule;
  /** The grader's own output. Present from creation — see this file's header. */
  readonly machineVerdict: GradingVerdict;
}

export interface PendingInitialReview extends ReviewCaseIdentity {
  readonly state: "PENDING_INITIAL";
}

export interface InitialRecordedReview extends ReviewCaseIdentity {
  readonly state: "INITIAL_RECORDED";
  readonly initialJudgment: GradingVerdict;
  readonly initialRecordedAt: number;
}

export interface RevealedReview extends ReviewCaseIdentity {
  readonly state: "REVEALED";
  readonly initialJudgment: GradingVerdict;
  readonly initialRecordedAt: number;
  readonly revealedAt: number;
  readonly revisedJudgment?: GradingVerdict;
  readonly revisedAt?: number;
}

export interface ClosedReview extends ReviewCaseIdentity {
  readonly state: "CLOSED";
  readonly initialJudgment: GradingVerdict;
  readonly initialRecordedAt: number;
  readonly revealedAt: number;
  readonly revisedJudgment?: GradingVerdict;
  readonly revisedAt?: number;
  readonly closedAt: number;
  /** `revisedJudgment` if one was recorded, else `initialJudgment`. */
  readonly finalHumanJudgment: GradingVerdict;
}

export type ReviewRecord = PendingInitialReview | InitialRecordedReview | RevealedReview | ClosedReview;

// ── Build 5 deliverable 1.5 — closed-shape validation at the store boundary ──
//
// Deferred deliberately through Builds 1-4 ("nothing here yet crosses a file/
// store boundary"); Build 5's evidence log is the first thing that persists
// a `ReviewRecord` outside this process. `validateReviewRecord` mirrors
// `scenario.ts`'s own closed-shape convention (exact keys, per-field type
// checks) and additionally checks STATE CONSISTENCY (`CLOSED`'s
// `finalHumanJudgment` must equal `revisedJudgment ?? initialJudgment`) —
// a check no earlier build needed because nothing before this one could
// hand `closeReview`'s own output back to it as untrusted input.

const SELECTED_BY_VALUES: readonly SelectedByRule[] = ["EDGE_CASES_FIRST", "FRACTION_SAMPLE"];

function validateCaseIdentity(o: Parsed): boolean {
  return (
    isString(o.scenarioId) &&
    o.scenarioId.length > 0 &&
    isEnum(o.selectedBy, SELECTED_BY_VALUES) &&
    isEnum(o.machineVerdict, GRADING_VERDICTS)
  );
}

const PENDING_INITIAL_KEYS = ["state", "scenarioId", "selectedBy", "machineVerdict"];
const INITIAL_RECORDED_KEYS = [...PENDING_INITIAL_KEYS, "initialJudgment", "initialRecordedAt"];
const REVEALED_KEYS = [...INITIAL_RECORDED_KEYS, "revealedAt"];
const CLOSED_KEYS = [...REVEALED_KEYS, "closedAt", "finalHumanJudgment"];

/** Closed-shape AND state-consistent. Every exported type here is checked. */
export function validateReviewRecord(x: unknown): x is ReviewRecord {
  if (!isObject(x)) return false;
  const o = x as Parsed;
  if (!validateCaseIdentity(o)) return false;

  const hasRevised = o.revisedJudgment !== undefined;
  const hasRevisedAt = o.revisedAt !== undefined;
  if (hasRevised !== hasRevisedAt) return false; // both or neither — never one alone

  switch (o.state) {
    case "PENDING_INITIAL":
      return hasExactKeys(o, PENDING_INITIAL_KEYS);

    case "INITIAL_RECORDED":
      if (!hasExactKeys(o, INITIAL_RECORDED_KEYS)) return false;
      return isEnum(o.initialJudgment, GRADING_VERDICTS) && isNonNegInteger(o.initialRecordedAt);

    case "REVEALED": {
      const keys = hasRevised ? [...REVEALED_KEYS, "revisedJudgment", "revisedAt"] : REVEALED_KEYS;
      if (!hasExactKeys(o, keys)) return false;
      if (!isEnum(o.initialJudgment, GRADING_VERDICTS) || !isNonNegInteger(o.initialRecordedAt)) return false;
      if (!isNonNegInteger(o.revealedAt)) return false;
      if (hasRevised && (!isEnum(o.revisedJudgment, GRADING_VERDICTS) || !isNonNegInteger(o.revisedAt))) {
        return false;
      }
      return true;
    }

    case "CLOSED": {
      const keys = hasRevised ? [...CLOSED_KEYS, "revisedJudgment", "revisedAt"] : CLOSED_KEYS;
      if (!hasExactKeys(o, keys)) return false;
      if (!isEnum(o.initialJudgment, GRADING_VERDICTS) || !isNonNegInteger(o.initialRecordedAt)) return false;
      if (!isNonNegInteger(o.revealedAt) || !isNonNegInteger(o.closedAt)) return false;
      if (!isEnum(o.finalHumanJudgment, GRADING_VERDICTS)) return false;
      if (hasRevised && (!isEnum(o.revisedJudgment, GRADING_VERDICTS) || !isNonNegInteger(o.revisedAt))) {
        return false;
      }
      // STATE CONSISTENCY: the closing arithmetic must actually hold.
      const expectedFinal = hasRevised ? o.revisedJudgment : o.initialJudgment;
      return o.finalHumanJudgment === expectedFinal;
    }

    default:
      return false;
  }
}

export class ReviewRecordInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewRecordInvalid";
  }
}

/**
 * The boundary function: a log or disk load calls THIS, never a transition
 * function directly, on untrusted data. No transition semantics changed —
 * `recordInitialJudgment`/`reveal`/`recordRevisedJudgment`/`closeReview`
 * still take a `ReviewRecord` and still runtime-check `state` themselves;
 * this is validation IN FRONT OF them, not a replacement for their own
 * checks.
 */
export function loadReviewRecord(raw: unknown): ReviewRecord {
  if (!validateReviewRecord(raw)) {
    throw new ReviewRecordInvalid(
      "refused: the loaded record does not match the closed ReviewRecord schema, or is " +
        "internally inconsistent (e.g. a CLOSED record whose finalHumanJudgment disagrees " +
        "with revisedJudgment ?? initialJudgment)."
    );
  }
  return raw;
}

/** Create the record a selected case starts as. Not yet shown to anyone. */
export function initializeReview(selected: SelectedCase): PendingInitialReview {
  return {
    state: "PENDING_INITIAL",
    scenarioId: selected.scenarioId,
    selectedBy: selected.selectedBy,
    machineVerdict: selected.verdict,
  };
}

/**
 * Deliverable 1.2's structural refusal. REFUSES (throws, typed) unless
 * `record.state === "PENDING_INITIAL"` — a runtime check, not merely a
 * TypeScript parameter type a caller could route around by constructing an
 * object literal. Nothing is written on refusal.
 */
export function recordInitialJudgment(
  record: ReviewRecord,
  judgment: GradingVerdict,
  atMs: number
): InitialRecordedReview {
  if (record.state !== "PENDING_INITIAL") {
    throw new ReviewRecordRefused(
      `refused: an initial judgment cannot be recorded for case "${record.scenarioId}" — ` +
        `its state is ${record.state}, not PENDING_INITIAL. The initial judgment window is ` +
        `closed once a record has moved past it.`,
      record.scenarioId,
      "recordInitialJudgment"
    );
  }
  return { ...record, state: "INITIAL_RECORDED", initialJudgment: judgment, initialRecordedAt: atMs };
}

/** The machine recommendation becomes visible to the reviewer from this point on. */
export function reveal(record: ReviewRecord, atMs: number): RevealedReview {
  if (record.state !== "INITIAL_RECORDED") {
    throw new ReviewRecordRefused(
      `refused: case "${record.scenarioId}" cannot be revealed — its state is ` +
        `${record.state}, not INITIAL_RECORDED. An initial judgment must be recorded first.`,
      record.scenarioId,
      "reveal"
    );
  }
  return { ...record, state: "REVEALED", revealedAt: atMs };
}

/**
 * A revision is a SECOND entry on the record, never an edit of the initial
 * judgment (`initialJudgment`/`initialRecordedAt` are untouched by this
 * function — the spread carries them forward unedited).
 */
export function recordRevisedJudgment(
  record: ReviewRecord,
  judgment: GradingVerdict,
  atMs: number
): RevealedReview {
  if (record.state !== "REVEALED") {
    throw new ReviewRecordRefused(
      `refused: a revised judgment for case "${record.scenarioId}" requires reveal first — ` +
        `its state is ${record.state}, not REVEALED.`,
      record.scenarioId,
      "recordRevisedJudgment"
    );
  }
  return { ...record, revisedJudgment: judgment, revisedAt: atMs };
}

// ── 1.3 dissent journal — append-only, typed distinctly ──────────────────────

interface BaseJournalEntry {
  readonly scenarioId: string;
  readonly recordedAt: number;
}

export interface InitialVsRevisedEntry extends BaseJournalEntry {
  readonly kind: "INITIAL_VS_REVISED";
  readonly initialJudgment: GradingVerdict;
  readonly revisedJudgment: GradingVerdict;
}

export interface HumanVsMachineEntry extends BaseJournalEntry {
  readonly kind: "HUMAN_VS_MACHINE";
  readonly humanJudgment: GradingVerdict;
  readonly machineVerdict: GradingVerdict;
}

export interface UnresolvedAtCloseEntry extends BaseJournalEntry {
  readonly kind: "UNRESOLVED_AT_CLOSE";
  readonly humanJudgment: GradingVerdict;
  readonly machineVerdict: GradingVerdict;
}

/** Deliverable 3's negative control 1: a structural refusal is itself journaled. */
export interface StructuralRefusalEntry extends BaseJournalEntry {
  readonly kind: "STRUCTURAL_REFUSAL";
  readonly attemptedOperation: string;
  readonly detail: string;
}

export type ReviewJournalEntry =
  | InitialVsRevisedEntry
  | HumanVsMachineEntry
  | UnresolvedAtCloseEntry
  | StructuralRefusalEntry;

export type ReviewJournal = readonly ReviewJournalEntry[];

/**
 * Close a REVEALED review. Computes `finalHumanJudgment` and returns the
 * closed record PLUS whatever journal entries this closing produced — the
 * caller appends them (see `appendToJournal`); this function does not hold
 * or mutate a journal itself, keeping it a pure, single-record operation.
 *
 * `HUMAN_VS_MACHINE` and `UNRESOLVED_AT_CLOSE` are two DISTINCT entry kinds
 * that fire TOGETHER whenever the human's final judgment disagrees with the
 * machine's — this system never resolves disagreement after the fact (the
 * same discipline `precommit.ts`'s grading ruling states: "disagreement...
 * PRESERVED, never resolved"), so nothing here ever produces one without
 * the other. Kept as two kinds, per the brief's "each typed distinctly,"
 * so a later reader can query by whichever dimension it needs. Flagged as
 * a judgment call in the receipt.
 */
export function closeReview(
  record: ReviewRecord,
  atMs: number
): { readonly record: ClosedReview; readonly journalEntries: ReviewJournal } {
  if (record.state !== "REVEALED") {
    throw new ReviewRecordRefused(
      `refused: case "${record.scenarioId}" cannot be closed — its state is ` +
        `${record.state}, not REVEALED.`,
      record.scenarioId,
      "closeReview"
    );
  }
  const finalHumanJudgment = record.revisedJudgment ?? record.initialJudgment;
  const closed: ClosedReview = { ...record, state: "CLOSED", closedAt: atMs, finalHumanJudgment };

  const entries: ReviewJournalEntry[] = [];
  if (record.revisedJudgment !== undefined && record.revisedJudgment !== record.initialJudgment) {
    entries.push({
      kind: "INITIAL_VS_REVISED",
      scenarioId: record.scenarioId,
      recordedAt: atMs,
      initialJudgment: record.initialJudgment,
      revisedJudgment: record.revisedJudgment,
    });
  }
  if (finalHumanJudgment !== record.machineVerdict) {
    entries.push({
      kind: "HUMAN_VS_MACHINE",
      scenarioId: record.scenarioId,
      recordedAt: atMs,
      humanJudgment: finalHumanJudgment,
      machineVerdict: record.machineVerdict,
    });
    entries.push({
      kind: "UNRESOLVED_AT_CLOSE",
      scenarioId: record.scenarioId,
      recordedAt: atMs,
      humanJudgment: finalHumanJudgment,
      machineVerdict: record.machineVerdict,
    });
  }
  return { record: closed, journalEntries: entries };
}

/** The only way this file grows a journal — concatenation, never in-place mutation. */
export function appendToJournal(journal: ReviewJournal, entries: ReviewJournal): ReviewJournal {
  return [...journal, ...entries];
}

/**
 * Deliverable 3's negative control 1: the CALLER catches a `ReviewRecordRefused`
 * and journals it explicitly through this function — the refusal is never
 * silently swallowed, and it is never auto-journaled behind the caller's
 * back either (this file invents no hidden side-effecting wrapper around
 * the throwing functions above).
 */
export function journalRefusal(
  journal: ReviewJournal,
  refusal: ReviewRecordRefused,
  atMs: number
): ReviewJournal {
  return appendToJournal(journal, [
    {
      kind: "STRUCTURAL_REFUSAL",
      scenarioId: refusal.scenarioId,
      recordedAt: atMs,
      attemptedOperation: refusal.attemptedOperation,
      detail: refusal.message,
    },
  ]);
}

// ── seal-skeleton item 1 — invalidated trials retained, excluded from scoring ─

export interface InvalidatedCase {
  readonly scenarioId: string;
  readonly reason: string;
  readonly invalidatedAt: number;
}

export interface ScoringAggregate {
  readonly totalClosed: number;
  readonly includedInScoring: number;
  readonly excludedInvalidated: number;
  readonly agreementCount: number;
  readonly disagreementCount: number;
}

/**
 * `closedReviews` is never filtered before this call — every closed record
 * stays exactly where it was appended (the journal/record list IS the
 * retention). Invalidation is a FLAG this function respects when it
 * aggregates, never a removal from the list the caller holds.
 */
export function computeScoringAggregate(
  closedReviews: readonly ClosedReview[],
  invalidated: readonly InvalidatedCase[]
): ScoringAggregate {
  const invalidatedIds = new Set(invalidated.map((i) => i.scenarioId));
  const included = closedReviews.filter((r) => !invalidatedIds.has(r.scenarioId));
  const agreementCount = included.filter((r) => r.finalHumanJudgment === r.machineVerdict).length;
  return {
    totalClosed: closedReviews.length,
    includedInScoring: included.length,
    excludedInvalidated: closedReviews.length - included.length,
    agreementCount,
    disagreementCount: included.length - agreementCount,
  };
}

// ── 1.4 bounded signatures — "every verdict" is unrepresentable ──────────────

export interface BatchClaim {
  readonly selectionRule: ReviewSelectionRule;
  readonly censusCounts: Readonly<Record<string, number>>;
  readonly window: { readonly startMs: number; readonly endMs: number };
}

/**
 * No field here can express "everything." `individuallyReviewedCaseIds` is a
 * finite, explicit list (never a wildcard); `batchClaim` is OPTIONAL and, when
 * present, is bounded by an explicit rule + census + window — there is no
 * boolean or sentinel anywhere in this shape meaning "all of it." A signature
 * covering "every verdict" cannot be constructed, not merely discouraged.
 */
export interface SignatureScope {
  readonly individuallyReviewedCaseIds: readonly string[];
  /** At most ONE — a single optional field, never an array of claims. */
  readonly batchClaim?: BatchClaim;
}

export interface SignatureRecord {
  /** Declares the signer. No cryptography — key custody is the arbiter's lane. */
  readonly signerSeat: string;
  readonly scope: SignatureScope;
  readonly signedAt: number;
}

export class SignatureRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignatureRefused";
  }
}

/**
 * Refuses a VACUOUS signature — one attesting nothing at all (no individually
 * reviewed cases and no batch claim) — the same "nothing to certify" bar this
 * codebase holds elsewhere (a committer id, a grading ground, a non-empty
 * salt). Not named in the brief; added because an unattested "signature"
 * would be the same vacuous-record failure this project keeps refusing.
 */
export function createSignature(
  signerSeat: string,
  scope: SignatureScope,
  atMs: number
): SignatureRecord {
  if (signerSeat.length === 0) {
    throw new SignatureRefused("refused: a signature naming no signer seat attests nothing.");
  }
  if (scope.individuallyReviewedCaseIds.length === 0 && scope.batchClaim === undefined) {
    throw new SignatureRefused(
      "refused: a signature with no individually reviewed cases and no batch claim attests nothing."
    );
  }
  return { signerSeat, scope, signedAt: atMs };
}

// ── 1.6 unanimity audit trigger ───────────────────────────────────────────────

export interface UnanimityWindowParameters {
  /** Declared, not a constant buried in code. */
  readonly windowSize: number;
}

export interface UnanimityAuditFlag {
  readonly windowSize: number;
  readonly flaggedAt: number;
}

/**
 * Reads the MOST RECENT `windowSize` closed reviews. A flag, never a
 * rejection and never a comfort — sustained 100% agreement is exactly the
 * shape a grader-mimicking shallow reviewer would produce.
 */
export function checkUnanimityAudit(
  closedReviews: readonly ClosedReview[],
  params: UnanimityWindowParameters,
  atMs: number
): UnanimityAuditFlag | null {
  if (params.windowSize <= 0 || closedReviews.length < params.windowSize) return null;
  const window = closedReviews.slice(-params.windowSize);
  const allAgree = window.every((r) => r.finalHumanJudgment === r.machineVerdict);
  return allAgree ? { windowSize: params.windowSize, flaggedAt: atMs } : null;
}
