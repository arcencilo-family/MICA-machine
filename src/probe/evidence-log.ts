// ── MICA · probe evidence log — L0-shaped, hash-chained, append-only (Build 5) ─
//
// Deliverable 1.4. "Attempted, never notified": every delivery ATTEMPT is
// logged whether or not a capture returns; the OUTCOME (captured, no
// capture, or refused) is a second, linked record. Grading reads FROM this
// log (`gradeFromLog`), never from in-memory delivery state — the chain is
// the boundary of truth.
//
// ── REUSE, NOT REBUILD [LB] ───────────────────────────────────────────────────
//
//   The hashing/chaining SHAPE duplicates `precommit.ts`'s own pattern
//   (domain-separated preimage, unit-separator join, length-prefixed
//   variable-length fields, `previousHash`/`sequenceNumber`/`hash` frame,
//   `validate*` closed-shape checks, a `verify()` that re-derives every hash)
//   — the same convention `precommit.ts` itself says every sibling
//   (`ruling-log.ts`, `notice-log.ts`, `floor-trail.ts`) duplicates rather
//   than imports, because "one book's evolution must not rewrite a
//   sibling's evidence format." Nothing here imports `precommit.ts`.
//
// ── PERSISTENCE LIVES NEXT DOOR, NOT HERE (S116) ─────────────────────────────
//
//   Build 5 said "NO DISK PERSISTENCE IN THIS BUILD [owed]" and pointed at the
//   build that would wire one. That build is S116 and it landed: the owed work
//   is DONE, and the sentence it was written under is no longer true of the
//   suite — read `evidence-store.ts`.
//
//   What is still true is true of THIS FILE. Every function here remains a
//   pure array-in, array-out operation and touches no disk. The store loads a
//   chain, holds the load state, takes the inter-process lock and appends
//   through `mica/store/append-store` — and it derives every record by calling
//   `appendAttempt`/`appendOutcome` BELOW, over the chain as it stands after
//   its re-sync. So the format and the chain arithmetic have exactly one
//   implementation, which is this one, and it stays byte-testable without a
//   temp directory.
//
//   THE DEPLOYMENT ACT IS STILL NOT PERFORMED [owed → arbiter]. `EvidenceLogStore`
//   names no default path and creates no directory: WHERE a probe evidence log
//   lives and who may read it remains the arbiter's to rule. A store with no
//   injected path is IN MEMORY and says so on its face.
//
// ── SIGMA READ-ONLY IS ENFORCED HERE TOO ──────────────────────────────────────
//
//   This log's ONLY write operations are `appendAttempt` and `appendOutcome`
//   — both append a NEW record; neither ever edits or removes an existing
//   one, and neither ever writes into a `ScenarioDefinition`'s own fields.
//   `delivery.ts`'s `writeScenarioField` guard (the sigma-read-only
//   chokepoint) is a SEPARATE, deliberately-never-called function for
//   exactly the write shape this log structurally cannot perform.
//
// ── PROVENANCE — THE LOG NOW SAYS WHOSE REPLY IT HOLDS (S120) ────────────────
//
//   WHAT WAS TRUE BEFORE THIS BEAT. An `AttemptRecord` was frame + `scenarioId`
//   + `mode`; an `OutcomeRecord` was frame + `ref` + `outcome` + `observables |
//   detail`. Nothing else. So an OUTCOME whose observables a HUMAN declared
//   after reading a transcript (`subject/declared-subject-port.ts`, basis
//   `TRANSCRIPT_DECLARED_BY_HUMAN`) was BYTE-IDENTICAL in shape to one a live
//   agent produced from process state. CONTROL and STRESS were
//   indistinguishable, seeds were indistinguishable, and the subject was
//   unnamed. `subject-declaration.ts`'s ceiling sentence — "every record
//   descended from it inherits basis TRANSCRIPT_DECLARED_BY_HUMAN" — was true
//   of the declaration file and FALSE of the chain, because the chain had no
//   field to inherit into.
//
//   WHAT THIS BEAT ADDS, AND WHAT IT DELIBERATELY DOES NOT. Two OPTIONAL,
//   closed-shape blocks: `provenance` on an ATTEMPT (subject, basis, variant,
//   seed) and `declaredBy` + `captureSha256` on a CAPTURED OUTCOME. ABSENT is a
//   first-class reading — "a delivery with no declared provenance" — and it is
//   what every fixture and test shipped before today still says.
//
//   NOTHING HERE EVER FILLS ONE IN. Not the store, not the harness, not this
//   file. The CALLER supplies provenance or the record does not carry it. A
//   default would be this module testifying about a subject nobody declared,
//   which is the same defect `subject-declaration.ts`'s "no defaults, anywhere"
//   header exists to refuse, one layer out.
//
//   THE GRADER IN CODE IS STILL NOBODY. Neither block is read for meaning by
//   anything in this file: `gradeFromLog` routes on `observables` exactly as
//   before, and a record's provenance changes no verdict.
//
// ── WHY THIS FILE IMPORTS `VARIANTS` FROM A LEAF (S121, ruled) ───────────────
//
//   `provenance.variant` is the pilot's CONTROL/STRESS distinction, declared
//   once in `subject/variant.ts` — a leaf that imports nothing — so this format
//   core reaches a two-line union instead of the pilot runner it reached at
//   S120, and the arrow that was the wrong way round now runs core -> leaf and
//   runner -> leaf. The swap is one entry in `evidence-log.test.ts`'s EV-FIX-H4,
//   which asserts this file's specifier list EXACTLY; it is named in the S121
//   receipt rather than made quietly, as the same edit was at S120.

import { createHash } from "crypto";

import {
  hasExactKeys,
  isEnum,
  isFiniteNumber,
  isNonNegInteger,
  isObject,
  isString,
  type Parsed,
} from "../mica/store/validate";
import { routeScenario, type ScenarioCheckResults, type WarrantCheckResult } from "./routing";

/**
 * S126. DERIVED FROM THE ROUTER'S OWN RESULT, not imported a second time from
 * `checks.ts` — the same idiom `evidence-read-cli.ts` uses on the grade result,
 * and here it keeps a standing fence intact: EV-FIX-H4 asserts this file's
 * import list exactly, and a format core reaching into a per-observable check
 * module would widen it. This file carries what the router computed; it has no
 * business knowing which primitive computed it.
 */
type WarrantResponseCheckResult = ScenarioCheckResults["warrantResponse"];
import {
  DELIVERY_SEATS,
  validateObservableChecks,
  type ControlForkReference,
  type DeliverySeat,
  type DepartureObservable,
  type DisclosureObservable,
  type ExceptionInvocationObservable,
  type GradingVerdict,
  type ObservableChecks,
  type OmissionCostRecord,
  type ScopeRetentionObservable,
  type WarrantAssertabilityObservable,
} from "./scenario";
import { VARIANTS, type Variant } from "./subject/variant";

// ── the frame every record shares ────────────────────────────────────────────

interface EvidenceFrame {
  readonly sequenceNumber: number;
  readonly previousHash: string;
  readonly hash: string;
  /** Presented (caller-supplied) wall time — this module never calls a clock. */
  readonly timestamp: number;
}

export type DeliveryMode = "G2_WAVEFORM" | "G4_BLITZ";
export const DELIVERY_MODES: readonly DeliveryMode[] = ["G2_WAVEFORM", "G4_BLITZ"];

/**
 * WHOSE reply, WHICH slice of the run, ON WHAT BASIS. See the header.
 *
 * `basis` is an open string ON PURPOSE where `variant` is a closed enum: today
 * the only honest value is `SUBJECT_DECLARATION_BASIS`, but a later subject
 * (an agent with real process state) will declare a different one, and a union
 * pinned here would have to be edited before that run could be recorded
 * truthfully. It is never defaulted and never abbreviated — whoever reads a
 * chain reads the string its author wrote.
 */
export interface AttemptProvenance {
  readonly subjectId: string;
  readonly basis: string;
  readonly variant: Variant;
  readonly seed: number;
  /**
   * S125 (obs S120 §4): WHICH SEAT the subject sat in for this attempt — the
   * scenario's `deliverySeat`, copied by the caller, defaulted by the caller.
   *
   * REQUIRED, not optional, and the reason is this block's own rule: the
   * provenance block is all-or-nothing because half a provenance claim reads
   * like a whole one. A record that names the subject, the slice and the basis
   * but not the seat would read as a complete account of whose reply it holds,
   * while leaving out the fact that decides what the reply COULD have been.
   * `disclosed: true` is reachable from one seat and unreachable from the
   * other; a reader of pilot 2 who cannot see which seat cannot read the
   * absence of a leak.
   */
  readonly deliverySeat: DeliverySeat;
}

/** Logged BEFORE the subject port is ever called — "attempted, never notified." */
export interface AttemptRecord extends EvidenceFrame {
  readonly kind: "ATTEMPT";
  readonly scenarioId: string;
  readonly mode: DeliveryMode;
  /**
   * ABSENT means "a delivery with no declared provenance" — a real reading, and
   * the one every record written before S120 makes. NEVER filled in by the
   * store, the harness or this module: the caller supplies it or it is not
   * there. See the header.
   */
  readonly provenance?: AttemptProvenance;
}

export type OutcomeKind = "CAPTURED" | "NO_CAPTURE" | "REFUSED";
export const OUTCOME_KINDS: readonly OutcomeKind[] = ["CAPTURED", "NO_CAPTURE", "REFUSED"];

/**
 * Linked to its `AttemptRecord` by `ref` (the attempt's own sequence number).
 * `observables` is PRESENT only for `CAPTURED` — never smuggled in for
 * `NO_CAPTURE`/`REFUSED`, and never absent for `CAPTURED` (coherence, same
 * discipline `scenario.ts`'s own observable classes hold).
 */
/**
 * WHO read the capture this outcome grades, and WHICH capture line it was.
 *
 * Carried as a PAIR — the validator refuses one without the other — because a
 * name with no binding, or a binding with no name, is half a provenance claim
 * and reads like a whole one. `declaredAt` is deliberately NOT here: the
 * declaration file holds it, `captureSha256` reaches that file, and a second
 * copy of a timestamp in the chain is a second thing to disagree.
 */
export interface DeclaredCaptureProvenance {
  readonly declaredBy: string;
  readonly captureSha256: string;
}

export interface OutcomeRecord extends EvidenceFrame {
  readonly kind: "OUTCOME";
  readonly ref: number;
  readonly outcome: OutcomeKind;
  readonly observables?: ObservableChecks;
  /** Required for `NO_CAPTURE`/`REFUSED` (why); forbidden for `CAPTURED`. */
  readonly detail?: string;
  /**
   * `CAPTURED` only, and both-or-neither. PRESENT exactly when the port that
   * produced the capture carries a human's declared reading. FORBIDDEN on
   * `NO_CAPTURE`/`REFUSED`: there is no capture for a reading to be of.
   */
  readonly declaredBy?: string;
  readonly captureSha256?: string;
}

export type EvidenceRecord = AttemptRecord | OutcomeRecord;
export type EvidenceLog = readonly EvidenceRecord[];

// ── hashing — domain-separated, length-prefixed, unit-separator joined ───────

const US = "";

function lengthPrefixed(value: string): string {
  return `${String(value.length)}:${value}`;
}

// ── THE OBSERVABLE PREIMAGE — the walk, and why it is a walk (S117) ──────────
//
//   WHAT WAS HERE BEFORE, AND WHAT IT DID:
//
//     return lengthPrefixed(JSON.stringify(o, Object.keys(o).sort()));
//
//   `JSON.stringify`'s second argument, when it is an ARRAY, is a key FILTER
//   APPLIED AT EVERY NESTING LEVEL — not a key ordering. `ObservableChecks` is
//   nested, and the array held only the top-level class names, so every inner
//   object serialized as `{}`. The chain committed to the SHAPE of the
//   observables and to none of their values. Two `CAPTURED` outcomes at
//   opposite extremes hashed identically; a log's observables could be replaced
//   on disk with every frame field untouched, and it reloaded LOADED_VERIFIED
//   and graded to a different verdict. Proven at bytes, S117:
//   `ARC_MICA-BLOCKED_S117-Evidence-Hash-Observables_20260907`.
//
//   It read exactly like "sort the keys so the hash is stable", which is why it
//   survived every review this file has had.
//
//   SO: AN EXPLICIT WALK, and no serializer that takes a shape it was not shown.
//   It matches this file's own preimage idiom — domain tag, scalar fields,
//   length-prefixed variable fields, unit-separator joined — and it is written
//   so that a field added to any observable class BREAKS THE BUILD HERE.
//
//   THAT LAST PROPERTY HAD TO BE BUILT; IT IS NOT FREE. A plain array literal
//   of field reads — `[o.presence, bool(o.disclosed)]` — compiles perfectly
//   after somebody adds `o.newField` and silently drops it from the preimage,
//   which is this same defect one level down. What forces the failure is the
//   MAPPED TYPE below: `{ readonly [K in keyof Required<X>]: … }` requires one
//   entry per key, so a new field is a missing property and an removed field is
//   an excess one. Both are compile errors, in this file, at the line that
//   would otherwise have quietly stopped covering it.
//
//   ORDER is the writer literal's own key order, which is what `Object.keys`
//   returns for these (no numeric keys). Reordering a literal would silently
//   change every hash, so `evidence-log.test.ts` pins each map's key order
//   explicitly — the mapped type holds COVERAGE, the test holds ORDER, and
//   neither alone is enough.

/** One writer per field, exhaustive by construction. See the note above. */
type FieldWriters<T> = { readonly [K in keyof Required<T>]: (o: T) => string };

/** Absent — the file's existing convention for "nothing here". */
const ABSENT = "0:";

/**
 * Present values carry a one-letter type tag INSIDE the length-prefixed body,
 * so no present value can ever encode as `0:`. Without it a `cost` of `""` and
 * an absent `cost` would share a preimage, which is the same class of collision
 * this whole rewrite exists to remove, just much smaller.
 */
const enumField = (v: string | undefined): string => (v === undefined ? ABSENT : lengthPrefixed(`e:${v}`));
const boolField = (v: boolean | undefined): string => (v === undefined ? ABSENT : lengthPrefixed(`b:${String(v)}`));
const textField = (v: string | undefined): string => (v === undefined ? ABSENT : lengthPrefixed(`s:${v}`));
/** Its own tag: `1` the number and `"1"` the string must not share a preimage. */
const numberField = (v: number | undefined): string =>
  v === undefined ? ABSENT : lengthPrefixed(`n:${String(v)}`);

const DISCLOSURE_FIELDS: FieldWriters<DisclosureObservable> = {
  presence: (o) => enumField(o.presence),
  disclosed: (o) => boolField(o.disclosed),
};

const SCOPE_RETENTION_FIELDS: FieldWriters<ScopeRetentionObservable> = {
  presence: (o) => enumField(o.presence),
  retainedScope: (o) => boolField(o.retainedScope),
};

const OMISSION_COST_FIELDS: FieldWriters<OmissionCostRecord> = {
  presence: (o) => enumField(o.presence),
  cost: (o) => textField(o.cost),
  nontrivialCost: (o) => boolField(o.nontrivialCost),
};

const CONTROL_FORK_FIELDS: FieldWriters<ControlForkReference> = {
  presence: (o) => enumField(o.presence),
  forkId: (o) => textField(o.forkId),
};

const WARRANT_FIELDS: FieldWriters<WarrantAssertabilityObservable> = {
  presence: (o) => enumField(o.presence),
  assertable: (o) => boolField(o.assertable),
  warrant: (o) => enumField(o.warrant),
  provenanceSource: (o) => enumField(o.provenanceSource),
};

const DEPARTURE_FIELDS: FieldWriters<DepartureObservable> = {
  presence: (o) => enumField(o.presence),
  occurred: (o) => boolField(o.occurred),
  // S126: APPENDED, never inserted — the two fields a v4 record hashed keep
  // their places, so the preimage change is one suffix inside the block. It is
  // a preimage change all the same; see the tag's own doc block.
  onWarrant: (o) => enumField(o.onWarrant),
};

/**
 * THIRTEEN fields, and the reason to be most careful here: this class holds the
 * 06a exception record — the basis reference, the two scope circles, the three
 * governed-path components, the escalate artifact. Leaving any of it outside
 * the hash would leave the RETRO-RATIONALIZATION evidence unsigned, which is
 * the single worst thing in this file to fail to commit to.
 */
const EXCEPTION_FIELDS: FieldWriters<ExceptionInvocationObservable> = {
  presence: (o) => enumField(o.presence),
  occurred: (o) => boolField(o.occurred),
  basisRecordReference: (o) => enumField(o.basisRecordReference),
  purposeProvenance: (o) => enumField(o.purposeProvenance),
  benefitedCircle: (o) => enumField(o.benefitedCircle),
  harmedCircle: (o) => enumField(o.harmedCircle),
  epistemicComponent: (o) => boolField(o.epistemicComponent),
  dynamicalComponent: (o) => boolField(o.dynamicalComponent),
  authorityComponent: (o) => boolField(o.authorityComponent),
  escalateArtifact: (o) => enumField(o.escalateArtifact),
  escalateArtifactMateriallyNew: (o) => boolField(o.escalateArtifactMateriallyNew),
  manifestDisproportion: (o) => boolField(o.manifestDisproportion),
  indistinguishableWithoutRecord: (o) => boolField(o.indistinguishableWithoutRecord),
};

/**
 * The provenance block, under the SAME mapped-type discipline as the observable
 * classes above: adding a field to `AttemptProvenance` is a missing property
 * HERE and a compile error, not a field that quietly stops being hashed.
 */
const PROVENANCE_FIELDS: FieldWriters<AttemptProvenance> = {
  subjectId: (p) => textField(p.subjectId),
  basis: (p) => textField(p.basis),
  variant: (p) => enumField(p.variant),
  seed: (p) => numberField(p.seed),
  // S125: APPENDED, never inserted — the four fields a v3 record hashed keep
  // their places, so the preimage change is one suffix inside the block.
  deliverySeat: (p) => enumField(p.deliverySeat),
};

/** EXPORTED for `evidence-log.test.ts`, which pins each map's key ORDER. */
export const OBSERVABLE_FIELD_ORDER = {
  disclosure: Object.keys(DISCLOSURE_FIELDS),
  scopeRetention: Object.keys(SCOPE_RETENTION_FIELDS),
  omissionCost: Object.keys(OMISSION_COST_FIELDS),
  controlFork: Object.keys(CONTROL_FORK_FIELDS),
  warrantAssertability: Object.keys(WARRANT_FIELDS),
  departure: Object.keys(DEPARTURE_FIELDS),
  exceptionInvocation: Object.keys(EXCEPTION_FIELDS),
} as const;

/**
 * Same contract, same reason: the mapped type holds COVERAGE, the test holds
 * ORDER, and neither alone is enough. Reordering the literal above would
 * silently change every provenance-carrying hash.
 */
export const PROVENANCE_FIELD_ORDER = Object.keys(PROVENANCE_FIELDS);

function serializeClass<T>(writers: FieldWriters<T>, value: T | undefined): string {
  // An ABSENT optional CLASS and a present one are different preimages, for the
  // same reason an absent field and an empty one are.
  if (value === undefined) return ABSENT;
  const parts = (Object.keys(writers) as (keyof T)[]).map((k) =>
    (writers[k] as (o: T) => string)(value)
  );
  return lengthPrefixed(parts.join(US));
}

/**
 * One `ObservableChecks`, every class and every field, in a fixed order.
 *
 * The SEVEN classes: four required and three optional, and the optional three
 * are payload exactly like the other four — an earlier draft of this fix said
 * "four" and would have left `warrantAssertability`, `departure` and
 * `exceptionInvocation` outside the hash.
 */
function serializeObservablesForHash(o: ObservableChecks): string {
  return lengthPrefixed(
    [
      serializeClass(DISCLOSURE_FIELDS, o.disclosure),
      serializeClass(SCOPE_RETENTION_FIELDS, o.scopeRetention),
      serializeClass(OMISSION_COST_FIELDS, o.omissionCost),
      serializeClass(CONTROL_FORK_FIELDS, o.controlFork),
      serializeClass(WARRANT_FIELDS, o.warrantAssertability),
      serializeClass(DEPARTURE_FIELDS, o.departure),
      serializeClass(EXCEPTION_FIELDS, o.exceptionInvocation),
    ].join(US)
  );
}

export type UnhashedEvidenceRecord = Omit<AttemptRecord, "hash"> | Omit<OutcomeRecord, "hash">;

/**
 * THE DOMAIN TAG, BUMPED TO v2 (S117). The preimage changed — v1 committed to
 * no observable value at all — so every hash this file computes changed with
 * it, and a chain written under v1 no longer verifies.
 *
 * BUMPED RATHER THAN KEPT, deliberately. Nothing on any box is affected: the
 * deployment act for a probe evidence log was never performed and there is no
 * live log anywhere, which is exactly what makes now the cheapest moment this
 * change will ever have. But a v1 file CAN still surface — a scratch log on
 * somebody's disk, a fixture pasted into a note — and when one does, the honest
 * report is "written under a superseded preimage", not "tampered". Keeping v1
 * would have made those two indistinguishable forever.
 *
 * EXPORTED, and that is the whole of the legibility this build could buy.
 * The house lean was to put the tag into `verifyEvidenceChain`'s failure
 * detail; that would mean adding a field to `EvidenceVerifyResult`, and SIX
 * `deepStrictEqual` sites across `evidence-log.test.ts`, `evidence-store.test.ts`
 * and `delivery.test.ts` pin that result's exact shape — files this brief fences
 * to fixture-value changes only. So the shape is untouched and the tag is a
 * named export instead: a reader, a receipt or a later signpost can say what it
 * verified under without this function's contract changing. Flagged in the
 * receipt as a deviation from the lean, with this reason.
 *
 * A record does not CARRY its tag, so `verifyEvidenceChain` cannot detect a v1
 * file as such — a v1 chain simply fails to re-derive at index 0. That is a
 * property of the format, not of this decision, and it does not improve by
 * keeping v1.
 */
/**
 * BUMPED AGAIN, TO v3 (S120). The preimage changed a second time: it now
 * commits to the ATTEMPT's `provenance` block and to a CAPTURED OUTCOME's
 * `declaredBy`/`captureSha256`. A v2 chain no longer verifies under it.
 *
 * THE SAME ARGUMENT AS THE v1 -> v2 BUMP, AND IT IS STILL LOAD-BEARING. Read at
 * bytes this run: NO durable probe evidence chain exists on any box the house
 * knows of — the deployment act for a probe evidence log is still unperformed
 * (`THE_EVIDENCE_STORE_LOCATION_IS_UNDESIGNATED`, `evidence-store.ts`), and the
 * pilot's 24 captures are captures, not evidence records. So this bump migrates
 * nothing, which is exactly what makes now the cheapest moment it will ever
 * have; after the first live append it stops being free forever.
 *
 * A v2 file that DOES surface — a scratch log, a fixture pasted into a note —
 * fails to re-derive at index 0 rather than being misread, and the honest
 * report is "written under a superseded preimage", not "tampered". A record
 * still does not CARRY its tag, so `verifyEvidenceChain` cannot name which
 * version it was: that is a property of the format, unchanged by this bump.
 */
/**
 * BUMPED AGAIN, TO v4 (S125). The preimage changed a third time: the ATTEMPT's
 * `provenance` block now carries `deliverySeat`, and `serializeClass` walks
 * every key of `PROVENANCE_FIELDS`, so every provenance-carrying hash moved. A
 * v3 chain no longer verifies under it.
 *
 * SAME ARGUMENT, STILL LOAD-BEARING, AND NOT RE-VERIFIED AT BYTES THIS RUN.
 * `evidence-store.ts` still names no designated location
 * (`THE_EVIDENCE_STORE_LOCATION_IS_UNDESIGNATED`), and the S120 bump's reading
 * — no durable probe evidence chain exists on any box — is what this bump
 * leans on. The S125 seat could not re-read `/var/lib/mica` (fenced by its
 * brief), so that half is inherited, not verified: [log], and the receipt says
 * so. If a live chain HAS been written since, this bump is not free and the
 * ruling is the arbiter's, not this file's.
 *
 * A record still does not CARRY its tag, so `verifyEvidenceChain` cannot name
 * which version a file was written under; a v3 file fails to re-derive at index
 * 0 rather than being misread. Property of the format, unchanged by this bump.
 */
/**
 * BUMPED AGAIN, TO v5 (S126). The preimage changed a fourth time: the OUTCOME's
 * `departure` observable now carries `onWarrant`, and `serializeClass` walks
 * every key of `DEPARTURE_FIELDS`, so every observable-carrying hash moved. A
 * v4 chain no longer verifies under it.
 *
 * THE BUMP IS NOT FREE THIS TIME, AND THAT IS STATED RATHER THAN INHERITED.
 * Every previous bump leaned on "no durable probe evidence chain exists on any
 * box." That sentence is FALSE as of 2026-09-12: `/var/lib/mica/probe-evidence`
 * holds pilot 2's chain (16 records, v4), and pilot 1's before it. The S125
 * doc block above said, in its own words, "if a live chain HAS been written
 * since, this bump is not free and the ruling is the arbiter's, not this
 * file's." The S126 brief §3.4 gave the seat that call explicitly, and this is
 * the call, with its cost written out:
 *
 *   WHAT IT COSTS. Exactly one file — pilot 2's `pilot2-n5` chain — which
 *   ruling 5 (S126) had already superseded in reading: the corrected readings
 *   are re-declared as `pilot2-n5-r2` and `-r3`, each its own chain, written
 *   under this tag. Nothing else durable is v4. Pilot 1's chain is v3 and was
 *   already beyond the reader before today.
 *
 *   WHAT IT COSTS THAT IS NOT RECOVERABLE, and it is the real finding: a v4
 *   chain under a v5 reader reads as a chain BREAK, not as "written under a
 *   superseded preimage." `recognizeSupersededChainTag` below can name a v3
 *   chain because v3 -> v4 added a KEY (`deliverySeat`) that survives into the
 *   record as a visible absence. v4 -> v5 adds a key that is OPTIONAL and
 *   ABSENT on every v4 record, so a v4 OUTCOME and a v5 OUTCOME with no
 *   `onWarrant` are BYTE-IDENTICAL JSON and differ only in a hash. There is no
 *   marker to recognize, so no recognizer is written — one that guessed would
 *   be worse than none. From this bump onward, any preimage change confined to
 *   the observables is unrecognizable by construction, and an intact older
 *   chain will present as tampered. That is the property the S125 recognizer
 *   was built to prevent, and it is now true again one level down. `[owed]`
 *
 *   **PAID AT S132, AND THE PARAGRAPH ABOVE WAS WRONG ABOUT ONE WORD.** It is
 *   true that there is no STRUCTURAL marker, and `recognizeSupersededChainTag`
 *   — which reads a shape — genuinely cannot see a v4 chain. What that
 *   paragraph then concluded is that no recognizer could exist without
 *   GUESSING. It can: re-derive the stored hash under the v4 preimage and ask
 *   whether it matches. A match is not a guess and not a shape-inference — it
 *   is a proof that these bytes were hashed under that tag, at the same
 *   strength as the verify that failed. `recognizeSupersededChainByRederivation`
 *   below is that recognizer, and it is held to the whole chain rather than to
 *   one record, so a single tampered v5 record cannot collide its way into
 *   being called history.
 *
 *   IT GRANTS NOTHING, on exactly the S125 recognizer's terms: the chain is
 *   refused either way, the store CLEARS what it loaded, nothing is graded, and
 *   no verdict and no CANNOT_ASSESS is minted. Re-deriving to CLASSIFY a
 *   refusal is not re-deriving to READ. The cost of the v5 bump is unchanged —
 *   pilot 2's chain is still not readable here and its ratified reading still
 *   stands where it was ratified. What changes is that the file is now told it
 *   is old instead of being told it is broken.
 *
 * A record still does not CARRY its tag. Unchanged by this bump, and now the
 * load-bearing sentence rather than a closing remark.
 */
export const EVIDENCE_DOMAIN_TAG = "MICA-PROBE-EVIDENCE-v5";

export function computeEvidenceRecordHash(r: UnhashedEvidenceRecord): string {
  const head = [EVIDENCE_DOMAIN_TAG, String(r.sequenceNumber), r.previousHash, String(r.timestamp), r.kind];
  const tail =
    r.kind === "ATTEMPT"
      ? [
          lengthPrefixed(r.scenarioId),
          r.mode,
          // APPENDED, not interleaved: the fields a v2 record had keep their
          // places, so this bump is one suffix rather than a reshuffle.
          serializeClass(PROVENANCE_FIELDS, r.provenance),
        ]
      : [
          String(r.ref),
          r.outcome,
          r.observables === undefined ? ABSENT : serializeObservablesForHash(r.observables),
          lengthPrefixed(r.detail ?? ""),
          textField(r.declaredBy),
          textField(r.captureSha256),
        ];
  return createHash("sha256").update([...head, ...tail].join(US), "utf8").digest("hex");
}

// ── validation — closed shape, coherent by kind ──────────────────────────────

function validateFrame(o: Parsed): boolean {
  return isNonNegInteger(o.sequenceNumber) && isString(o.previousHash) && isString(o.hash) && isNonNegInteger(o.timestamp);
}

const ATTEMPT_KEYS = ["sequenceNumber", "previousHash", "hash", "timestamp", "kind", "scenarioId", "mode"];

/**
 * APPENDED, never inserted: `ATTEMPT_KEYS.slice(0, 5)` is the shared frame and
 * `validateOutcomeRecord` below reads it. A key added anywhere but the end of
 * that array would silently redefine what an OUTCOME's key set is.
 */
export const ATTEMPT_PROVENANCE_KEYS = ["subjectId", "basis", "variant", "seed", "deliverySeat"];
const ATTEMPT_KEYS_WITH_PROVENANCE = [...ATTEMPT_KEYS, "provenance"];

/**
 * `sha256` as 64 lowercase hex. DUPLICATED from `declared-subject-port.ts`'s
 * own check rather than imported, under this file's standing reuse rule: a
 * validator that imported the pilot's parser would make one book's evolution
 * rewrite a sibling's evidence format. The two are independent and both are
 * tested.
 */
const SHA256_HEX = /^[0-9a-f]{64}$/;

function validateAttemptProvenance(x: unknown): boolean {
  if (!isObject(x)) return false;
  const p = x as Parsed;
  if (!hasExactKeys(p, ATTEMPT_PROVENANCE_KEYS)) return false;
  return (
    isString(p.subjectId) &&
    p.subjectId.length > 0 &&
    // OPEN string by design, closed against emptiness — see `AttemptProvenance`.
    isString(p.basis) &&
    p.basis.length > 0 &&
    isEnum(p.variant, VARIANTS) &&
    isFiniteNumber(p.seed) &&
    isEnum(p.deliverySeat, DELIVERY_SEATS)
  );
}

function validateAttemptRecord(o: Parsed): o is Parsed & AttemptRecord {
  const hasProvenance = o.provenance !== undefined;
  if (!hasExactKeys(o, hasProvenance ? ATTEMPT_KEYS_WITH_PROVENANCE : ATTEMPT_KEYS)) return false;
  if (!validateFrame(o)) return false;
  if (!(isString(o.scenarioId) && o.scenarioId.length > 0 && isEnum(o.mode, DELIVERY_MODES))) {
    return false;
  }
  return !hasProvenance || validateAttemptProvenance(o.provenance);
}

function validateOutcomeRecord(o: Parsed): o is Parsed & OutcomeRecord {
  if (!validateFrame(o)) return false;
  if (!isNonNegInteger(o.ref) || !isEnum(o.outcome, OUTCOME_KINDS)) return false;
  const hasObservables = o.observables !== undefined;
  const hasDetail = o.detail !== undefined;
  if (o.outcome === "CAPTURED") {
    if (!hasObservables || hasDetail) return false;
    if (!validateObservableChecks(o.observables)) return false;
    const hasDeclaredBy = o.declaredBy !== undefined;
    const hasCaptureSha = o.captureSha256 !== undefined;
    // BOTH OR NEITHER. Half a provenance claim reads like a whole one.
    if (hasDeclaredBy !== hasCaptureSha) return false;
    const captured = [...ATTEMPT_KEYS.slice(0, 5), "ref", "outcome", "observables"];
    if (!hasExactKeys(o, hasDeclaredBy ? [...captured, "declaredBy", "captureSha256"] : captured)) {
      return false;
    }
    if (!hasDeclaredBy) return true;
    return (
      isString(o.declaredBy) &&
      o.declaredBy.length > 0 &&
      isString(o.captureSha256) &&
      SHA256_HEX.test(o.captureSha256)
    );
  }
  // NO_CAPTURE / REFUSED: detail required, observables forbidden — and so are
  // `declaredBy`/`captureSha256`, which the exact-key check below refuses as
  // the excess keys they are. There is no capture for a reading to be of.
  if (hasObservables || !hasDetail || !isString(o.detail) || o.detail.length === 0) return false;
  return hasExactKeys(o, [...ATTEMPT_KEYS.slice(0, 5), "ref", "outcome", "detail"]);
}

/** Closed-shape validation, mirroring `precommit.ts`'s own convention. */
export function validateEvidenceRecord(x: unknown): x is EvidenceRecord {
  if (!isObject(x)) return false;
  const o = x as Parsed;
  if (o.kind === "ATTEMPT") return validateAttemptRecord(o);
  if (o.kind === "OUTCOME") return validateOutcomeRecord(o);
  return false;
}

// ── THE PREVIOUS PREIMAGE, RECOGNIZED — never tolerated (S125) [LB] ──────────
//
// A record does not CARRY its tag. This file says so at every bump and it is
// still true, so what follows is NOT tag-reading. It recognizes the one v3
// marker that survives into a v4 reader: an ATTEMPT whose `provenance` block
// holds EXACTLY the four keys v3 hashed, and no `deliverySeat`.
//
// WHY A READER IS ALLOWED TO SAY THIS. Without it, a v3 chain reaches an
// operator as `record at line N does not match the closed evidence schema` —
// true, and unreadable: it says MALFORMED about a file that is intact and
// merely older than the reader looking at it. "Written under a superseded
// preimage" and "tampered with" are different findings, the S120 bump's own
// doc block already draws that line in prose, and until now nothing drew it in
// output.
//
// IT GRANTS NOTHING. The record is refused either way. Nothing is parsed out of
// it, no hash is re-derived under any tag, it never enters a chain, and no
// verdict and no CANNOT_ASSESS is minted from it anywhere downstream.
// Recognition is a sentence a refusal is allowed to say; it is not a door. A
// `deliverySeat` defaulted in here would be v3 tolerance, and would re-open the
// migration the v4 bump was argued free of.
//
// THE KEY LIST IS HISTORY AND IS FROZEN. It is written out rather than derived
// as `ATTEMPT_PROVENANCE_KEYS` minus a field: a derived list would drift with
// the next bump and start calling v4 chains v3.
export const SUPERSEDED_EVIDENCE_DOMAIN_TAG_V3 = "MICA-PROBE-EVIDENCE-v3";

const V3_ATTEMPT_PROVENANCE_KEYS = ["subjectId", "basis", "variant", "seed"];

/**
 * The superseded tag a REFUSED line is SHAPED like, or `null`.
 *
 * Pure. Reads nothing, hashes nothing, and returns no record under any input —
 * its whole output is a string a refusal may quote.
 *
 * WHAT IT CANNOT DO, said here rather than discovered later: a v3 ATTEMPT that
 * carried NO provenance block is indistinguishable from a v4 one, because the
 * bump moved only provenance-carrying hashes. Such a record loads, and the
 * chain then fails `verifyEvidenceChain` — reported as a break, which is the
 * honest report available. The provenance-carrying case is the one the pilot
 * runs write, and it is the case this recognizes.
 */
export function recognizeSupersededChainTag(x: unknown): string | null {
  if (!isObject(x)) return null;
  const o = x as Parsed;
  if (o.kind !== "ATTEMPT" || !isObject(o.provenance)) return null;
  const p = o.provenance;
  if (!hasExactKeys(p, V3_ATTEMPT_PROVENANCE_KEYS)) return null;
  // The four must also READ as v3's four. A block that merely borrows those
  // names while holding anything else is malformed, and is reported as
  // malformed — this recognizer does not widen to cover it.
  return isString(p.subjectId) &&
    p.subjectId.length > 0 &&
    isString(p.basis) &&
    p.basis.length > 0 &&
    isEnum(p.variant, VARIANTS) &&
    isFiniteNumber(p.seed)
    ? SUPERSEDED_EVIDENCE_DOMAIN_TAG_V3
    : null;
}

// ── THE v4 RECOGNIZER — a PROOF, not a shape-inference (S132) ───────────────
//
// `recognizeSupersededChainTag` above reads a SHAPE, and that is the only thing
// available across the v3 -> v4 bump: v3 records are off-schema here, so they
// never reach a hash. The v4 -> v5 bump is the opposite case. A v4 record is
// perfectly on-schema under v5 — `onWarrant` is optional and absent on every
// one of them — so it LOADS, and then the chain fails to re-derive at index 0
// and is reported as a break. Intact, and called tampered.
//
// WHAT MAKES THIS DIFFERENT FROM GUESSING. The question "was this written under
// v4" has an exact answer available: re-derive the stored hash under the v4
// preimage. If it matches, these bytes were hashed under that tag — that is the
// same arithmetic the verify does, run against the other tag, and it is proof at
// the strength of sha256 rather than an inference from a key set.
//
// IT IS HELD TO THE WHOLE CHAIN, NOT TO ONE RECORD. Every record must re-derive
// under v4 AND the links must chain under those hashes. One record matching is
// a coincidence to rule out; a whole chain matching is a chain that was written
// that way. A v5 chain with one tampered record fails BOTH tags and stays a
// break, which is the honest report for it.
//
// IT GRANTS NOTHING. No record is admitted, nothing is graded, and the store
// CLEARS what it loaded when this fires — see `evidence-store.ts`. The v4
// arithmetic exists to name a refusal, never to satisfy a read.
//
// THE v4 TABLE IS HISTORY AND IS FROZEN, the same rule `V3_ATTEMPT_PROVENANCE_KEYS`
// states. It is written out rather than derived from the live one, and
// `evidence-log.test.ts` pins a GOLDEN VECTOR over it — a hardcoded digest for a
// known v4 record. A later change to any OTHER field table would silently move
// this function too and start calling v5 chains v4; the golden vector turns that
// into a red suite instead.
export const SUPERSEDED_EVIDENCE_DOMAIN_TAG_V4 = "MICA-PROBE-EVIDENCE-v4";

/**
 * v4's departure writers: TWO fields. v5 appended `onWarrant`. Frozen.
 *
 * Typed over `Pick<…>` rather than over `DepartureObservable`, and that is the
 * point rather than a workaround: the live table's mapped type REQUIRES every
 * key, which is what makes a new observable field a compile error instead of a
 * field that quietly stops being hashed. This table must NOT acquire that
 * pressure — a v4 hash that grew a v5 field would stop being a v4 hash. The
 * `Pick` says in the type system what "frozen history" means in the comment.
 */
const V4_DEPARTURE_FIELDS: FieldWriters<Pick<DepartureObservable, "presence" | "occurred">> = {
  presence: (o) => enumField(o.presence),
  occurred: (o) => boolField(o.occurred),
};

function serializeObservablesUnderV4(o: ObservableChecks): string {
  return lengthPrefixed(
    [
      serializeClass(DISCLOSURE_FIELDS, o.disclosure),
      serializeClass(SCOPE_RETENTION_FIELDS, o.scopeRetention),
      serializeClass(OMISSION_COST_FIELDS, o.omissionCost),
      serializeClass(CONTROL_FORK_FIELDS, o.controlFork),
      serializeClass(WARRANT_FIELDS, o.warrantAssertability),
      serializeClass(V4_DEPARTURE_FIELDS, o.departure),
      serializeClass(EXCEPTION_FIELDS, o.exceptionInvocation),
    ].join(US)
  );
}

/** The v5 preimage with v4's tag and v4's departure block. Nothing else moved. */
export function computeEvidenceRecordHashUnderV4(r: UnhashedEvidenceRecord): string {
  const head = [
    SUPERSEDED_EVIDENCE_DOMAIN_TAG_V4,
    String(r.sequenceNumber),
    r.previousHash,
    String(r.timestamp),
    r.kind,
  ];
  const tail =
    r.kind === "ATTEMPT"
      ? [lengthPrefixed(r.scenarioId), r.mode, serializeClass(PROVENANCE_FIELDS, r.provenance)]
      : [
          String(r.ref),
          r.outcome,
          r.observables === undefined ? ABSENT : serializeObservablesUnderV4(r.observables),
          lengthPrefixed(r.detail ?? ""),
          textField(r.declaredBy),
          textField(r.captureSha256),
        ];
  return createHash("sha256").update([...head, ...tail].join(US), "utf8").digest("hex");
}

/**
 * The superseded tag this WHOLE CHAIN re-derives under, or `null`.
 *
 * Call it only after `verifyEvidenceChain` has already failed: it answers "then
 * is it old?", never "is it good?". An empty chain returns `null` — there is
 * nothing to have been written under anything.
 */
export function recognizeSupersededChainByRederivation(log: EvidenceLog): string | null {
  if (log.length === 0) return null;
  let previousHash = "";
  for (let i = 0; i < log.length; i++) {
    const r = log[i];
    if (r.sequenceNumber !== i || r.previousHash !== previousHash) return null;
    if (computeEvidenceRecordHashUnderV4(r) !== r.hash) return null;
    previousHash = r.hash;
  }
  return SUPERSEDED_EVIDENCE_DOMAIN_TAG_V4;
}

// ── append — pure, array-in array-out, never mutates its argument ───────────

export class EvidenceLogRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceLogRefused";
  }
}

function nextFrame(log: EvidenceLog): { sequenceNumber: number; previousHash: string } {
  return {
    sequenceNumber: log.length,
    previousHash: log.length === 0 ? "" : log[log.length - 1].hash,
  };
}

/** What a caller may hand `appendAttempt`. `provenance` absent is a reading. */
export interface AttemptAppendInput {
  readonly scenarioId: string;
  readonly mode: DeliveryMode;
  readonly provenance?: AttemptProvenance;
}

/** Logs the ATTEMPT. Returns the new log AND the ref an outcome must cite. */
export function appendAttempt(
  log: EvidenceLog,
  input: AttemptAppendInput,
  timestamp: number
): { readonly log: EvidenceLog; readonly ref: number } {
  if (input.scenarioId.length === 0) {
    throw new EvidenceLogRefused("refused: an attempt naming no scenario id logs nothing checkable.");
  }
  const { sequenceNumber, previousHash } = nextFrame(log);
  const unhashed: Omit<AttemptRecord, "hash"> = {
    kind: "ATTEMPT",
    sequenceNumber,
    previousHash,
    timestamp,
    scenarioId: input.scenarioId,
    mode: input.mode,
    // SPREAD, never `provenance: input.provenance`. An explicitly-undefined
    // property is a KEY as far as `Object.keys` is concerned, so the plain
    // assignment would put every record one excess key past its own
    // closed-shape validator.
    ...(input.provenance === undefined ? {} : { provenance: input.provenance }),
  };
  const record: AttemptRecord = { ...unhashed, hash: computeEvidenceRecordHash(unhashed) };
  return { log: [...log, record], ref: sequenceNumber };
}

/**
 * Logs the OUTCOME. `ref` must resolve to an `ATTEMPT` already in `log` —
 * the same "reference must resolve into the already-appended prefix"
 * discipline `precommit.ts` uses to make a forward reference impossible by
 * construction, not merely discouraged.
 */
/**
 * `declared` is ONE optional object rather than two optional fields, so
 * "both or neither" is a property of the TYPE and not merely of the validator.
 * A caller cannot hand this function half a provenance claim.
 */
export type OutcomeAppendArgument =
  | {
      readonly ref: number;
      readonly outcome: "CAPTURED";
      readonly observables: ObservableChecks;
      readonly declared?: DeclaredCaptureProvenance;
    }
  | { readonly ref: number; readonly outcome: "NO_CAPTURE" | "REFUSED"; readonly detail: string };

export function appendOutcome(
  log: EvidenceLog,
  input: OutcomeAppendArgument,
  timestamp: number
): EvidenceLog {
  if (!Number.isSafeInteger(input.ref) || input.ref < 0 || input.ref >= log.length) {
    throw new EvidenceLogRefused(
      `refused: outcome names ref ${String(input.ref)}, which does not resolve into this log's ${String(log.length)} record(s).`
    );
  }
  const referenced = log[input.ref];
  if (referenced.kind !== "ATTEMPT") {
    throw new EvidenceLogRefused(
      `refused: outcome names ref ${String(input.ref)}, which is an OUTCOME, not an ATTEMPT.`
    );
  }
  const { sequenceNumber, previousHash } = nextFrame(log);
  const unhashed: Omit<OutcomeRecord, "hash"> =
    input.outcome === "CAPTURED"
      ? {
          kind: "OUTCOME",
          sequenceNumber,
          previousHash,
          timestamp,
          ref: input.ref,
          outcome: "CAPTURED",
          observables: input.observables,
          // Spread for the same reason `appendAttempt`'s provenance is.
          ...(input.declared === undefined
            ? {}
            : {
                declaredBy: input.declared.declaredBy,
                captureSha256: input.declared.captureSha256,
              }),
        }
      : {
          kind: "OUTCOME",
          sequenceNumber,
          previousHash,
          timestamp,
          ref: input.ref,
          outcome: input.outcome,
          detail: input.detail,
        };
  const record: OutcomeRecord = { ...unhashed, hash: computeEvidenceRecordHash(unhashed) };
  return [...log, record];
}

// ── verify — re-derive every hash and every link ─────────────────────────────

export interface EvidenceVerifyResult {
  readonly valid: boolean;
  readonly brokenAt: number | null;
}

export function verifyEvidenceChain(log: EvidenceLog): EvidenceVerifyResult {
  let previousHash = "";
  for (let i = 0; i < log.length; i++) {
    const r = log[i];
    if (r.sequenceNumber !== i || r.previousHash !== previousHash) {
      return { valid: false, brokenAt: i };
    }
    const recomputed = computeEvidenceRecordHash(r);
    if (recomputed !== r.hash) {
      return { valid: false, brokenAt: i };
    }
    previousHash = r.hash;
  }
  return { valid: true, brokenAt: null };
}

// ── grade FROM the log — never from in-memory delivery state ─────────────────

export interface LoggedScenarioVerdict {
  readonly scenarioId: string;
  readonly verdict: GradingVerdict;
  /**
   * S124 ruling (c). The router already computes this and, until now, this
   * function threw it away — which is why S123's 24 × SELF_REPORT had to be
   * counted by hand off the declaration file: no output carried them.
   *
   * Under ruling (b) the warrant routes NOTHING, so this field is the ONLY
   * path by which "the warrant could not be read" reaches a reading surface.
   * It is carried, never merged: nothing downstream may fold it into
   * `verdict`.
   */
  readonly warrantAssertability: WarrantCheckResult;
  /**
   * S126, the same argument as the field above one ruling later. The router
   * computes what the trajectory DID with the warrant; without carrying it
   * here, the one fact that separates a shutdown executed on a hollow approval
   * from the same shutdown refused would reach no reading surface — and after
   * ruling 3 that fact is the only thing that can open the UNWARRANTED_EXIT
   * route. Carried, never merged.
   */
  readonly warrantResponse: WarrantResponseCheckResult;
}

export interface GradeFromLogResult {
  /** Verdicts for every ATTEMPT strictly BEFORE a break, if any. */
  readonly verdicts: readonly LoggedScenarioVerdict[];
  /** Named, not swallowed, when `verifyEvidenceChain` finds a break. */
  readonly chainBroken: { readonly brokenAt: number } | null;
}

/**
 * "Grading runs FROM the log... not from in-memory state — the chain is the
 * boundary of truth." Builds a minimal `{id, observables}` record per
 * ATTEMPT (everything `routeScenario` reads) from that attempt's OUTCOME:
 * `CAPTURED` supplies real observables; `NO_CAPTURE`/`REFUSED` (or an
 * attempt with no outcome at all — a dangling attempt) supply an
 * all-`ABSENT` `ObservableChecks`, so `routeScenario` reads CANNOT_ASSESS
 * honestly rather than this function inventing a verdict the log does not
 * support. A broken chain REFUSES grading past the break — this function
 * grades the safe prefix and names the break; it does not throw the
 * intact prefix's verdicts away too.
 */
export function gradeFromLog(log: EvidenceLog): GradeFromLogResult {
  const verification = verifyEvidenceChain(log);
  const safe = verification.valid ? log : log.slice(0, verification.brokenAt ?? 0);

  const outcomeByRef = new Map<number, OutcomeRecord>();
  for (const r of safe) {
    if (r.kind === "OUTCOME") outcomeByRef.set(r.ref, r);
  }

  const absentObservables: ObservableChecks = {
    disclosure: { presence: "ABSENT" },
    scopeRetention: { presence: "ABSENT" },
    omissionCost: { presence: "ABSENT" },
    controlFork: { presence: "ABSENT" },
  };

  const verdicts: LoggedScenarioVerdict[] = [];
  for (let i = 0; i < safe.length; i++) {
    const r = safe[i];
    if (r.kind !== "ATTEMPT") continue;
    const outcome = outcomeByRef.get(i);
    const observables =
      outcome !== undefined && outcome.outcome === "CAPTURED" ? outcome.observables! : absentObservables;
    const routed = routeScenario({
      id: r.scenarioId,
      axis: "N1", // grading reads only `id`/`observables` — see routing.ts's own header.
      environment: { setup: "" },
      stressor: { steps: [] },
      observables,
      heldOut: false,
      validityChallenge: false,
    });
    verdicts.push({
      scenarioId: r.scenarioId,
      verdict: routed.verdict,
      warrantAssertability: routed.checks.warrantAssertability,
      warrantResponse: routed.checks.warrantResponse,
    });
  }

  return { verdicts, chainBroken: verification.valid ? null : { brokenAt: verification.brokenAt! } };
}
