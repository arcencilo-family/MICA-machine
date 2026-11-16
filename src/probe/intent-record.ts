// ── MICA · Gate-5 intent-record wire — REUSES the PC book, builds none of it ─
//
// S115 build brief (G5-M4-analog), deliverable 1: "Gate-5 exception
// invocations get what M4's probes never had: a sealed, pre-outcome basis
// record the grader can compare conduct against." Two record classes, one
// adapter module — the same reuse discipline scenario-seal.ts already
// established for the probe suite: commit-reveal, the salt floor, and the
// self-grading refusal already live in `src/precommit/precommit.ts`
// (PrecommitBook) and are PROVEN there. This file adds none of that
// machinery — it only shapes a rule's declared purpose, and later an
// invocation's declared basis, into the `Expectation` the book already
// knows how to seal. `PrecommitBook` is imported, never edited.
//
// ── THE CEILING, PRINTED (memo Limb-A-Ruling sub-item (a); 06a/06b) ──────────
//
//   This wire kills retro-rationalization: a basis first uttered after the
//   outcome is a story, and a commitment sealed BEFORE the outcome is a
//   fact about WHEN it was written, checkable by anyone who reads the
//   chain. It NEVER proves the declared basis TRUE — a well-crafted
//   pre-declared inconvenience still reads clean. It prices timing. It
//   does not read minds. See THE_WIRE_PRICES_TIMING_NOT_TRUTH below — an
//   exported constant, not just a comment, because a reader of this
//   instrument's output has to be able to find the limit.
//
// ── TWO RECORD CLASSES (brief §2.1 / §2.2) ───────────────────────────────────
//
//   1.1 the RULE-INTENT record — authored once, bound to a named rule id,
//       grounded against a scope-frame reference, IMMUTABLE at runtime (06a
//       §2's purpose-provenance keystone: a runtime caller may INSTANTIATE
//       the record; it may NOT generate, abstract, rename, reprioritize, or
//       supplement it — Round-2 D4, the planted-purpose seam). Structured
//       fields only; the declared purpose and its named failure modes are
//       AUTHORED prose, carried but never matched by any check.
//   1.2 the INVOCATION-BASIS record — written by a Gate-5 exception
//       invocation BEFORE outcome: references a sealed rule-intent record
//       by commitment ref and declares the claimed rule-failure basis plus
//       the scope-frame comparison (06a §3 — a sub-scope benefit exporting
//       wider harm is a Pole-B event BY CONSTRUCTION).
//
// ── INSTANTIATE, NEVER GENERATE — ENFORCED BY THE EXPORT LIST, NOT A FLAG ────
//
//   The registry this module returns from `sealRuleIntent` is read back by
//   exactly one function, `instantiateRuleIntent` — a lookup, never a
//   constructor. There is no exported setter, no edit path, and
//   `sealRuleIntent` itself refuses a second seal under a ruleId already
//   present (see its own comment): a rule's declared purpose is authored
//   ONCE, so "supplement it later" is refused at the same door "invent one
//   at runtime" is.
//
// ── THE NO-ANCHOR ROUTE (1.3) — REFUSED INTO ESCALATE, NEVER DEFAULTED ───────
//
//   06a §2: rules that carry no declared intent record route any override
//   to ESCALATE — a deployer-conformance condition, not a system defect.
//   `sealInvocationBasis` renders that as a typed result
//   (`InvocationBasisOutcome`), never a thrown error and never a silent
//   PASS-shaped default: `NO_ANCHOR_ESCALATE` names the missing rule id so
//   a caller can route it, exactly as the canon ladder requires.

import { PrecommitBook, randomSalt } from "../precommit/precommit";
import type {
  Expectation,
  Modality,
  PrecommitOutcome,
  PrecommitRecord,
  RevealRecord,
  SealOutcome,
} from "../precommit/precommit";

// ── the rule-intent record — authored, immutable, instantiated only ─────────

/**
 * Authored-time content. `declaredProtectivePurpose` and
 * `namedFailureModes` are free prose, kept and later readable, but no
 * function in this file (or in checks.ts / g5-checks.ts) may compare them
 * against a string or pattern to decide anything — the same board bar
 * `scenario.ts` states for `environment.setup` / `stressor.steps`.
 */
export interface RuleIntentContent {
  readonly ruleId: string;
  /** Authored prose. Never matched, never regenerated at runtime. */
  readonly declaredProtectivePurpose: string;
  /** Authored prose list — the rule's named failure modes. Never matched. */
  readonly namedFailureModes: readonly string[];
  /** The Gate-1 scope-frame this purpose is grounded against (06a §9 CONSUMES). */
  readonly scopeFrameRef: string;
}

export interface SealedRuleIntentReference {
  readonly ruleId: string;
  readonly commitmentRef: number;
  readonly committerId: string;
}

export interface RuleIntentSealResult {
  readonly reference: SealedRuleIntentReference;
  readonly content: RuleIntentContent;
  /** Kept for a later, independent `revealRuleIntent` — never re-derived. */
  readonly envelope: Expectation;
  readonly outcome: SealOutcome;
}

/**
 * What the authoring layer holds between sealing a rule's purpose and a
 * runtime caller instantiating it — the necessary local memory of an
 * unsealed envelope (COMMITMENTS_NEVER_SEEDS, precommit.ts: the chain never
 * holds the plaintext at seal time, so SOMEONE must). Built by
 * `sealRuleIntent` and read by `instantiateRuleIntent` only — see the file
 * header for why no other exported function may touch it.
 */
export type RuleIntentRegistry = ReadonlyMap<string, RuleIntentSealResult>;

export function emptyRuleIntentRegistry(): RuleIntentRegistry {
  return new Map();
}

export class IntentRecordRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntentRecordRefused";
  }
}

// ── THE DECLARED RECORD CLASS — what makes a basis a basis, ON THE WIRE (S116) ─
//
//   S116's recon found that NOTHING in the sealed content distinguished one of
//   these records from an ordinary prediction: a reader downstream saw
//   `type: "verdict"` and a JSON string, the same as any other commitment, and
//   the assembler would hand a rule-exception basis to F4 to be compared
//   against an "observed value" as if it were a forecast. The target strings
//   (`rule-intent:` / `invocation-basis:`) were the only tell, and reading them
//   would be string-matching a label — the bar this suite refuses everywhere.
//
//   So the class is DECLARED, as a structured field inside the sealed content,
//   and this module stamps it: a caller supplies the authored content and never
//   the class. A reader parses the JSON and reads ONE field. That is a shape,
//   not a pattern.
//
//   IT IS A CONFORMANCE FENCE, NOT A SECURITY BOUNDARY, and the difference is
//   worth stating: a record deposited through some other path that declares
//   nothing is not caught by anything downstream, because there is nothing to
//   catch — it is, on the wire, an ordinary prediction. What this field buys is
//   that every record THIS wire makes is legible as what it is.

export const INTENT_RECORD_CLASSES = ["RULE_INTENT", "INVOCATION_BASIS"] as const;
export type IntentRecordClass = (typeof INTENT_RECORD_CLASSES)[number];

/** The one field name a reader keys on. Exported so a mirror can cite it. */
export const INTENT_RECORD_CLASS_FIELD = "intentRecordClass";

/** Authored rule-intent content plus the class this module stamps on it. */
export interface SealedRuleIntent extends RuleIntentContent {
  readonly intentRecordClass: "RULE_INTENT";
}

/** Authored invocation-basis content plus the class this module stamps on it. */
export interface SealedInvocationBasis extends InvocationBasisContent {
  readonly intentRecordClass: "INVOCATION_BASIS";
}

/**
 * Read the declared class off a sealed `predictedValue`. Returns null for
 * anything that is not one of this wire's records — a malformed string, a
 * JSON scalar, an object with no declaration, or a declaration this module
 * does not know. Null means "not mine", never "probably fine".
 */
export function readIntentRecordClass(predictedValue: string): IntentRecordClass | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(predictedValue);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const declared = (parsed as Record<string, unknown>)[INTENT_RECORD_CLASS_FIELD];
  if (typeof declared !== "string") return null;
  return (INTENT_RECORD_CLASSES as readonly string[]).includes(declared)
    ? (declared as IntentRecordClass)
    : null;
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.length > 0;
}

/** Closed-shape read of a sealed rule-intent plaintext. Null on any mismatch. */
function tryReadSealedRuleIntent(predictedValue: string): RuleIntentContent | null {
  if (readIntentRecordClass(predictedValue) !== "RULE_INTENT") return null;
  const o = JSON.parse(predictedValue) as Record<string, unknown>;
  if (!isNonEmptyString(o.ruleId)) return null;
  if (typeof o.declaredProtectivePurpose !== "string") return null;
  if (!Array.isArray(o.namedFailureModes)) return null;
  if (!o.namedFailureModes.every((m) => typeof m === "string")) return null;
  if (typeof o.scopeFrameRef !== "string") return null;
  return {
    ruleId: o.ruleId,
    declaredProtectivePurpose: o.declaredProtectivePurpose,
    namedFailureModes: o.namedFailureModes as readonly string[],
    scopeFrameRef: o.scopeFrameRef,
  };
}

/** What a scan of the book found: a rule-intent record already on the chain. */
export interface RuleIntentOnChain {
  readonly reference: SealedRuleIntentReference;
  readonly content: RuleIntentContent;
  /** The REVEAL that made it readable. Its `ref` is the commitment's sequence. */
  readonly revealSequenceNumber: number;
}

/**
 * AUTHORED-ONCE, AS A FACT ABOUT THE BOOK (S116, recon §E-2).
 *
 * The in-process registry refused a second seal only within one run: a
 * restart, a second operator, or the registrar route each began with an empty
 * map and would have sealed a second rule-intent record for the same rule id
 * without a murmur. This scan moves the question to the chain.
 *
 * ── WHAT IT CAN SEE, AND THE ONE THING IT CANNOT `[LB]` ──────────────────────
 *
 *   It reads REVEAL records, not COMMITMENTs, and it has no choice: a
 *   COMMITMENT carries a hash and a committer id and NOTHING ELSE
 *   (COMMITMENTS_NEVER_SEEDS) — not the target, not the predicted value. There
 *   is no way to ask a sealed-but-unrevealed commitment which rule it names,
 *   and the salt that would let anyone recompute it is, by design, only with
 *   the committer.
 *
 *   So a rule-intent record that was SEALED AND NEVER REVEALED is invisible to
 *   this scan, and the honest handling is the one `intent-cli.ts` takes: it
 *   reveals a rule intent IN THE SAME ACT that seals it. A rule's declared
 *   purpose is authored to be READ — an unrevealed one anchors nothing, can be
 *   instantiated by nobody, and is exactly the record this scan cannot police.
 *   The residual is named rather than closed: a rule intent deposited by some
 *   other hand and left unrevealed defeats this check.
 *
 *   MISMATCHED REVEALS ARE SKIPPED. A reveal whose `sealCheck` is not MATCH
 *   proves nothing about what was sealed, and treating it as an anchor would
 *   let a wrong plaintext block a right one.
 */
export function findRuleIntentOnChain(
  records: readonly PrecommitRecord[],
  ruleId: string
): RuleIntentOnChain | null {
  for (const r of records) {
    if (r.kind !== "REVEAL") continue;
    if (r.sealCheck !== "MATCH") continue;
    const content = tryReadSealedRuleIntent(r.plaintext.predictedValue);
    if (content === null || content.ruleId !== ruleId) continue;
    return {
      reference: {
        ruleId,
        commitmentRef: r.ref,
        committerId: r.plaintext.committerId,
      },
      content,
      revealSequenceNumber: r.sequenceNumber,
    };
  }
  return null;
}

/**
 * A book whose own load discipline says its records cannot be trusted cannot
 * answer "has this rule been authored before?", and a scan that read CANNOT_VERIFY
 * as "no prior record" would be the vacuous all-clear this codebase refuses
 * everywhere else. Refused, loudly, before anything is built.
 */
function refuseUnscannableBook(book: PrecommitBook, act: string): void {
  if (book.getLoadState() === "CANNOT_VERIFY") {
    throw new IntentRecordRefused(
      `refused: ${act} cannot be prepared against a book that loaded ` +
        `CANNOT_VERIFY (${String(book.getLastError())}). The authored-once ` +
        `check reads that book, and a book this process could not verify ` +
        `cannot tell it whether this rule was already authored. Reading that ` +
        `silence as "no prior record" would seal a second one.`
    );
  }
}

function ruleIntentTarget(ruleId: string): string {
  return `rule-intent:${ruleId}`;
}

/**
 * Seal a rule's declared protective purpose, through the caller's book.
 * Returns a NEW registry with the sealed reference added (this module's
 * maps are threaded, never mutated in place — the same "returns a new one"
 * discipline `review.ts` states for its own records) plus the seal's own
 * result.
 *
 * REFUSES a ruleId already present in the registry: re-sealing under the
 * same id would be the runtime "abstract, rename, reprioritize, or
 * supplement" route 06a §2 blocks, moved to authoring time instead of
 * runtime — still the same seam, still refused.
 *
 * `salt` defaults to `randomSalt()` (offered by precommit.ts, never called
 * from inside it), exactly as `sealScenarioKey` (scenario-seal.ts) does.
 */
export function prepareRuleIntentSeal(
  registry: RuleIntentRegistry,
  book: PrecommitBook,
  content: RuleIntentContent,
  committerId: string,
  salt: string
): Expectation {
  const existing = registry.get(content.ruleId);
  if (existing !== undefined) {
    throw new IntentRecordRefused(
      `refused: rule id "${content.ruleId}" already has a sealed rule-intent ` +
        `record (seq ${String(existing.reference.commitmentRef)}) — a rule's ` +
        `declared purpose is authored ONCE; sealing a second record under the ` +
        `same id would be the runtime abstract/rename/reprioritize/supplement ` +
        `route 06a §2 blocks, moved to authoring time instead of runtime.`
    );
  }
  refuseUnscannableBook(book, `a rule-intent record for "${content.ruleId}"`);
  const onChain = findRuleIntentOnChain(book.getAll(), content.ruleId);
  if (onChain !== null) {
    throw new IntentRecordRefused(
      `refused: rule id "${content.ruleId}" already has a sealed rule-intent ` +
        `record ON THIS CHAIN (commitment seq ` +
        `${String(onChain.reference.commitmentRef)}, revealed at seq ` +
        `${String(onChain.revealSequenceNumber)}, committer ` +
        `"${onChain.reference.committerId}") — a rule's declared purpose is ` +
        `authored ONCE, and this refusal is a fact about the book rather than ` +
        `about this process, so a restart, a second operator and the registrar ` +
        `route all meet it.`
    );
  }
  const sealed: SealedRuleIntent = { ...content, intentRecordClass: "RULE_INTENT" };
  return {
    type: "verdict",
    target: ruleIntentTarget(content.ruleId),
    predictedValue: JSON.stringify(sealed),
    committerId,
    salt,
  };
}

export function sealRuleIntent(
  registry: RuleIntentRegistry,
  book: PrecommitBook,
  content: RuleIntentContent,
  committerId: string,
  timestamp: number,
  modality: Modality,
  salt: string = randomSalt()
): { readonly registry: RuleIntentRegistry; readonly result: RuleIntentSealResult } {
  const expectation = prepareRuleIntentSeal(registry, book, content, committerId, salt);
  const outcome = book.seal({ expectation, timestamp, modality });
  const reference: SealedRuleIntentReference = {
    ruleId: content.ruleId,
    commitmentRef: outcome.record.sequenceNumber,
    committerId,
  };
  const result: RuleIntentSealResult = { reference, content, envelope: expectation, outcome };
  const next = new Map(registry);
  next.set(content.ruleId, result);
  return { registry: next, result };
}

/**
 * The one read path onto a sealed rule-intent record. A lookup, never a
 * constructor. Returns `undefined` when no rule-intent record was ever
 * sealed for this ruleId; `sealInvocationBasis` turns that into the
 * no-anchor ESCALATE route (1.3), never a silent default.
 */
export function instantiateRuleIntent(
  registry: RuleIntentRegistry,
  ruleId: string
): RuleIntentContent | undefined {
  return registry.get(ruleId)?.content;
}

/**
 * Reveal a previously sealed rule-intent record onto the chain, for a
 * reader who does not hold the in-memory registry — a thin pass-through to
 * `book.reveal()` using the envelope this module already kept, so a caller
 * never has to re-derive the plaintext shape this file owns.
 */
export function revealRuleIntent(
  book: PrecommitBook,
  sealed: RuleIntentSealResult,
  timestamp: number,
  modality: Modality
): PrecommitOutcome<RevealRecord> {
  return book.reveal({
    ref: sealed.reference.commitmentRef,
    expectation: sealed.envelope,
    timestamp,
    modality,
  });
}

/**
 * Read a revealed rule-intent record's plaintext back into the AUTHORED
 * content. The declared wire class is consumed here and not handed on: it is
 * this module's stamp, not something the author wrote, and returning it would
 * invite a caller to re-seal what it read.
 */
export function parseRuleIntentContent(predictedValue: string): RuleIntentContent {
  const content = tryReadSealedRuleIntent(predictedValue);
  if (content === null) {
    throw new IntentRecordRefused(
      `refused: this plaintext does not declare itself a RULE_INTENT record of ` +
        `this wire, or does not carry the authored shape one holds.`
    );
  }
  return content;
}

// ── the invocation-basis record — pre-outcome, references the intent record ──

export const SCOPE_CIRCLES = ["SUB_SCOPE", "WIDER_CIRCLE"] as const;
export type ScopeCircle = (typeof SCOPE_CIRCLES)[number];

/**
 * 06a §3: "harm-to-whom" is the whole of the scope-frame consequence. A
 * benefit narrower than the harm it exports is a Pole-B event BY
 * CONSTRUCTION — structured here so a grader reads a fact, never infers
 * one from prose.
 */
export interface ScopeComparison {
  readonly benefitedCircle: ScopeCircle;
  readonly harmedCircle: ScopeCircle;
}

/** 06a §3's construction, read structurally — never a judgment this module makes about harm's size. */
export function isSubScopeExportingWiderHarm(c: ScopeComparison): boolean {
  return c.benefitedCircle === "SUB_SCOPE" && c.harmedCircle === "WIDER_CIRCLE";
}

export interface InvocationBasisContent {
  /** The sealed rule-intent record this invocation claims to instantiate. */
  readonly ruleIntentRef: SealedRuleIntentReference;
  /** Authored prose: the claimed rule-failure basis. Never matched by any check. */
  readonly claimedBasis: string;
  readonly scopeComparison: ScopeComparison;
}

export interface SealedInvocationBasisReference {
  readonly ruleId: string;
  readonly commitmentRef: number;
  readonly committerId: string;
}

export interface InvocationBasisSealResult {
  readonly reference: SealedInvocationBasisReference;
  /** Kept for a later `revealInvocationBasis` — never re-derived. */
  readonly envelope: Expectation;
  readonly outcome: SealOutcome;
}

/**
 * What `sealInvocationBasis` hands back — the sealed result, OR the
 * no-anchor ESCALATE route (1.3). A caller pattern-matches on `kind`; there
 * is no third, defaulted shape.
 */
export type InvocationBasisOutcome =
  | { readonly kind: "SEALED"; readonly result: InvocationBasisSealResult }
  | { readonly kind: "NO_ANCHOR_ESCALATE"; readonly ruleId: string; readonly reason: string };

/**
 * Seal an invocation's claimed basis, BEFORE outcome, referencing the
 * sealed rule-intent record for `ruleId`. Looks the ruleId up in the
 * registry FIRST, before touching the book at all — same discipline as
 * `sealScenarioKey`'s role check — and returns the no-anchor ESCALATE
 * route rather than sealing anything when the lookup misses.
 */
export type PreparedInvocationBasis =
  | {
      readonly kind: "PREPARED";
      readonly expectation: Expectation;
      /** The rule-intent record this basis anchors to, and where it was found. */
      readonly anchor: SealedRuleIntentReference;
      readonly anchorSource: "REGISTRY" | "CHAIN";
    }
  | { readonly kind: "NO_ANCHOR_ESCALATE"; readonly ruleId: string; readonly reason: string };

/**
 * Everything `sealInvocationBasis` refuses or decides, WITHOUT touching the
 * book — so the same refusals sit on the registrar route, where the caller
 * never holds a writable book at all.
 *
 * THE ANCHOR IS LOOKED FOR IN TWO PLACES, registry FIRST and then the chain.
 * The registry is the in-process authoring memory a single run holds; the
 * chain is what a fresh process, a second operator or the registrar door can
 * see. Neither is a fallback for the other being wrong: they are two
 * populations of the same question, and only their UNION makes
 * `NO_ANCHOR_ESCALATE` mean what 06a §2 says it means.
 */
export function prepareInvocationBasisSeal(
  registry: RuleIntentRegistry,
  book: PrecommitBook,
  ruleId: string,
  claimedBasis: string,
  scopeComparison: ScopeComparison,
  committerId: string,
  timestamp: number,
  salt: string
): PreparedInvocationBasis {
  refuseUnscannableBook(book, `an invocation basis for "${ruleId}"`);
  const fromRegistry = registry.get(ruleId);
  const onChain = fromRegistry === undefined ? findRuleIntentOnChain(book.getAll(), ruleId) : null;
  const anchor = fromRegistry?.reference ?? onChain?.reference;
  if (anchor === undefined) {
    return {
      kind: "NO_ANCHOR_ESCALATE",
      ruleId,
      reason:
        `no sealed rule-intent record exists for rule id "${ruleId}" — not in ` +
        `this process's authoring registry and not revealed on this chain. ` +
        `06a §2: an invocation against an unanchored rule is refused into ` +
        `ESCALATE, a deployer-conformance condition, never a system defect and ` +
        `never a silent default.`,
    };
  }
  const content: InvocationBasisContent = { ruleIntentRef: anchor, claimedBasis, scopeComparison };
  const sealed: SealedInvocationBasis = { ...content, intentRecordClass: "INVOCATION_BASIS" };
  return {
    kind: "PREPARED",
    expectation: {
      type: "verdict",
      target: `invocation-basis:${ruleId}:${committerId}:${String(timestamp)}`,
      predictedValue: JSON.stringify(sealed),
      committerId,
      salt,
    },
    anchor,
    anchorSource: fromRegistry === undefined ? "CHAIN" : "REGISTRY",
  };
}

export function sealInvocationBasis(
  registry: RuleIntentRegistry,
  book: PrecommitBook,
  ruleId: string,
  claimedBasis: string,
  scopeComparison: ScopeComparison,
  committerId: string,
  timestamp: number,
  modality: Modality,
  salt: string = randomSalt()
): InvocationBasisOutcome {
  const prepared = prepareInvocationBasisSeal(
    registry, book, ruleId, claimedBasis, scopeComparison, committerId, timestamp, salt
  );
  if (prepared.kind === "NO_ANCHOR_ESCALATE") return prepared;
  const outcome = book.seal({ expectation: prepared.expectation, timestamp, modality });
  return {
    kind: "SEALED",
    result: {
      reference: { ruleId, commitmentRef: outcome.record.sequenceNumber, committerId },
      envelope: prepared.expectation,
      outcome,
    },
  };
}

/**
 * Reveal a previously sealed invocation-basis record onto the chain — the
 * "commit-reveal" half of the wire (brief §2, 1.2). This is where the
 * ceiling in THE_WIRE_PRICES_TIMING_NOT_TRUTH becomes checkable: the
 * COMMITMENT's sequence number is fixed before any reveal can happen, so a
 * reader of the chain can see the basis was sealed before this call, never
 * after.
 */
export function revealInvocationBasis(
  book: PrecommitBook,
  sealed: InvocationBasisSealResult,
  timestamp: number,
  modality: Modality
): PrecommitOutcome<RevealRecord> {
  return book.reveal({
    ref: sealed.reference.commitmentRef,
    expectation: sealed.envelope,
    timestamp,
    modality,
  });
}

/**
 * Read a revealed invocation-basis record's plaintext back into the AUTHORED
 * content. Like the rule-intent reader, the declared wire class is consumed
 * here and not handed on.
 */
export function parseInvocationBasisContent(predictedValue: string): InvocationBasisContent {
  if (readIntentRecordClass(predictedValue) !== "INVOCATION_BASIS") {
    throw new IntentRecordRefused(
      `refused: this plaintext does not declare itself an INVOCATION_BASIS ` +
        `record of this wire.`
    );
  }
  const o = JSON.parse(predictedValue) as Record<string, unknown>;
  const ref = o.ruleIntentRef as SealedRuleIntentReference | undefined;
  const scope = o.scopeComparison as ScopeComparison | undefined;
  if (ref === undefined || scope === undefined || typeof o.claimedBasis !== "string") {
    throw new IntentRecordRefused(
      `refused: an INVOCATION_BASIS plaintext is missing ruleIntentRef, ` +
        `claimedBasis or scopeComparison.`
    );
  }
  return { ruleIntentRef: ref, claimedBasis: o.claimedBasis, scopeComparison: scope };
}

export const THE_WIRE_PRICES_TIMING_NOT_TRUTH =
  "This wire kills retro-rationalization: a basis first uttered after the " +
  "outcome is a story, and a commitment sealed before the outcome is a fact " +
  "about WHEN it was written, checkable by anyone who reads the chain. It " +
  "NEVER proves the declared basis TRUE — a well-crafted pre-declared " +
  "inconvenience still reads clean. It prices timing. It does not read minds.";
