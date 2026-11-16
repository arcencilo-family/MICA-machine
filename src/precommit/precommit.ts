// ── MICA · A9 — the pre-commitment path. A book of sealed expectations ───────
//
// ONE SENTENCE, AND THE INSTRUMENT MAY SAY NOTHING STRONGER (design note §1):
//
//   "This claim was sealed at sequence N, before the events it predicts; here is
//    how the outcome graded against it, and who graded."
//
//   It does not certify the claim true, the actor honest, or the grading wise.
//
// ── THE FRAME: A VOLUNTARY ACT ON AN INVOLUNTARY RECORD ──────────────────────
//
//   The witness is passive and universal: it records everyone involved, willing
//   or not. A9 changes none of that. It adds a VOLUNTARY act on top — any
//   principal MAY deposit a sealed expectation before acting, and nobody must.
//   But absence is readable: a claim sealed BEFORE the outcome has standing; a
//   claim first uttered after is a story. This module does not force
//   pre-commitment. It makes the difference between the two kinds of claim
//   visible. Offer-not-impose, applied to claims about the future.
//
// ── WHY IT IS A BOOK AND NOT A WITNESS KIND (the brief's §2, contradicted) ────
//
//   The A9 brief asks for records that are "WITNESS ENTRIES, not a second
//   store", with the WITNESS assigning the sequence number that is the
//   commitment's "before". Built literally that would mean three new members of
//   `WITNESSED_KINDS`, and a REVEAL — which carries plaintext — landing inside
//   the witness store. That is the one thing R2 forbids: content stays out of
//   the retainer. `ruling-log.ts` states the same bar for the arbiter's rulings,
//   and states it as the reason the arbiter keeps its OWN book.
//
//   So A9 is a book, like the ruling log, the notice log and the floor trail:
//   an append-only hash-chained chain that keeps its own content and commits its
//   HEAD to the witness after every entry. That IS "the way existing witness
//   clients do it" — the phrase the same paragraph of the brief uses — and it is
//   what makes the anchoring worth anything: the plaintext is in the preimage,
//   so rewriting a revealed prediction breaks the chain, and the committed head
//   makes that break loud.
//
// ── THE ARROW OF TIME, AND EXACTLY HOW FAR IT REACHES (design ruling 3) ──────
//
//   "Before" is decided by an append-only sequence, never by a clock. Inside
//   this book that is absolute and it is BY CONSTRUCTION: a REVEAL or a GRADING
//   does not carry a number the caller asserts about the future, it carries a
//   LOOKUP into the already-appended prefix. There is no forward reference to
//   refuse because there is nothing forward to find. `timestamp` rides along as
//   the committer's own presented wall time — a second arrow that should agree,
//   whose divergence is a finding — and it is never the ruling one.
//
//   ACROSS the book and the world, the arrow is the WITNESS's sequence, and this
//   module cannot see it. See `THE_ANCHOR_IS_THE_ARROW` below: that limit is
//   stated in an exported constant rather than a comment because a reader of
//   this instrument's output has to be able to find it.
//
// ── WHAT THIS BOOK CANNOT PROVE ──────────────────────────────────────────────
//
//   It can prove it CALLED a committer. It cannot prove anything was retained,
//   by whom, or where. SUBMISSION IS NOT RETENTION.
//
// ── THIS MODULE CALLS NO CLOCK AND MAKES NO SALT ─────────────────────────────
//
//   `timestamp` is INJECTED, always — a `Date.now()` in here would be the module
//   quietly testifying about when a principal acted. The salt is injected for
//   the same reason plus a second one: the committer, not this module, must be
//   able to reproduce its own seal. `randomSalt()` is OFFERED for callers that
//   want one; nothing here calls it.
//
// ── CHAIN ARITHMETIC IS LOCAL, LIKE EVERY SIBLING'S ──────────────────────────
//
//   This duplicates the ruling-log / notice-log / floor-trail chain pattern
//   rather than importing any of it, and the coupling bar holds here verbatim:
//   one book's evolution must not rewrite a sibling's evidence format. The ONE
//   thing imported is `appendStoreTransaction` — the single append seam —
//   because the ordering it encodes (validate -> append durably -> only THEN
//   commit live state -> only THEN commit the head) must not drift between
//   stores.
//
// ── IT CREATES NO DIRECTORY, AND IT NAMES NO PATH (S96-D) ────────────────────
//
//   There is no default store path in this file and there must never be one.
//   Where an A9 book lives, and which principals may read it, is a DEPLOYMENT
//   decision that has not been made: the design note lists "store location
//   within the witness tree" among the things it deliberately does not design,
//   and the deploy recipe has no section for it. So the signpost below names the
//   undesignated act instead of citing a section that does not exist. A book
//   with no injected path is IN MEMORY and says so.

import { createHash, randomBytes } from "crypto";
import { readFileSync, statSync } from "fs";
import type { Stats } from "fs";
import { dirname } from "path";

import {
  appendStoreTransaction,
  resyncAppendStore,
} from "../mica/store/append-store";
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

// ── the sentences this instrument is allowed to say ──────────────────────────

/**
 * Design note §1, VERBATIM. It is here so the sentence this build is allowed to
 * say can be read against the sentence the design ruled, without either being
 * edited to fit the other.
 */
export const PRECOMMIT_TITLE_AS_DESIGNED =
  "This claim was sealed at witness sequence N, before the events it predicts; " +
  "here is how the outcome graded against it, and who graded.";

/**
 * THE SENTENCE THIS BUILD MAY ACTUALLY PRINT, and the one word of difference is
 * the whole of the contradiction this module raises against its brief.
 *
 * The design's sentence says WITNESS sequence. This book is a witness CLIENT: it
 * commits its head and gets `void` back, so it never learns a witness sequence
 * and could not print one truthfully. Printing the designed sentence anyway
 * would be printing a stronger claim than the evidence supports, which §1 of the
 * design note forbids in the same breath as it fixes the wording.
 *
 * So the word "witness" is dropped, and `THE_ANCHOR_IS_THE_ARROW` carries what
 * went with it. The arbiter may rule that the designed sentence should be
 * restored and a witness sequence plumbed back to the committer; until then this
 * is the true one, and the stronger one is not printed for looking better.
 */
export const PRECOMMIT_TITLE =
  "This claim was sealed at sequence N, before the events it predicts; here is " +
  "how the outcome graded against it, and who graded.";

export const PRECOMMIT_CERTIFIES_NOTHING =
  "A sealed commitment certifies nothing about the claim, the committer, or " +
  "the grading. It fixes ONE fact and only one: that this expectation existed, " +
  "in this exact wording, at this point in an append-only sequence — and " +
  "therefore before everything the sequence records after it.";

export const OFFER_NOT_IMPOSE =
  "No principal is required to pre-commit. A9 adds a voluntary act on top of " +
  "an involuntary record and forces nothing. What it makes readable is the " +
  "difference between a claim sealed before the outcome and a claim first " +
  "uttered after it — the first has standing, the second is a story.";

/**
 * WHERE THE ARROW STOPS, and this is the load-bearing limit of the whole build.
 *
 * Ruling 3 grounds "before" in the WITNESS's append-only sequence. This book
 * cannot see that sequence. A head committer returns `void` — submission is not
 * retention — and the witness's intake is LAST-WRITER-WINS on a filename that is
 * the submitter id, so a head committed between two sweeps is replaced and never
 * retained. The witness-side trail of this book is therefore a SAMPLE, not a
 * census of its entries.
 *
 * WHAT SURVIVES THAT, and it is more than it first looks: a head at book
 * sequence k is a hash over the whole prefix 0..k, so a RETAINED head anchors
 * every record beneath it, including the ones whose own heads were replaced.
 * Losing intermediate heads coarsens WHEN the anchor was taken; it does not lose
 * the anchoring.
 *
 * WHAT DOES NOT SURVIVE: if a commitment and the event it predicts both fall
 * between two witness sweeps, the retained anchor cannot separate them. Ordering
 * INSIDE the book is by construction; ordering between the book and the world is
 * only as fine as the anchor. Nothing here may be read as claiming otherwise.
 */
export const THE_ANCHOR_IS_THE_ARROW =
  "Inside this book, order is by construction and cannot be argued with. " +
  "Between this book and the world, the arrow is the WITNESS's own sequence, " +
  "which this module cannot see: it can prove it called a committer, never that " +
  "a head was retained. A retained head anchors the entire prefix beneath it, so " +
  "a replaced intermediate head loses granularity and not anchoring — but a " +
  "commitment and its outcome that both fall between two witness sweeps are not " +
  "separated by anything this instrument holds. Read the seal that far and no " +
  "further.";

export const SUBMISSION_IS_NOT_RETENTION =
  "This book can prove it CALLED a committer. It cannot prove anything was " +
  "retained, by whom, or where. Submission is not retention; the evidential " +
  "object is the witness's own store, which this module cannot read and does " +
  "not attest.";

/** Design ruling 2 (binding from the S98-B custody ruling). */
export const COMMITMENTS_NEVER_SEEDS =
  "The chain holds the COMMITMENT and never the seed. A COMMITMENT record " +
  "carries a hash and a committer id and nothing else: not the target, not the " +
  "type, not the predicted value, not the salt. A book holding the plaintext " +
  "early would hold a secret worth stealing and could shape behaviour around " +
  "known predictions. A book holding the commitment has nothing to leak. The " +
  "plaintext stays with the committer until the REVEAL puts it in the chain, " +
  "where anyone may recompute the hash against the sealed deposit.";

/** Design ruling 4. */
export const A_COMMITTER_NEVER_GRADES_ITSELF =
  "The doctor and/or the arbiter grade; the committer never grades its own " +
  "commitment. Both verdicts are recorded when both grade, and recorded means " +
  "chained. Disagreement between graders is PRESERVED, never resolved: a " +
  "verdict is a claim and gets a claim's treatment.";

/** Design ruling 1's door clause, quoted in the refusal a caller actually sees. */
export const THE_FREE_TEXT_DOOR =
  "FREE-TEXT CLAIM + GRADING RULE is a DOOR, not a room. v1 reserves the type " +
  "tag `claim+rule` and the `grading_rule` field in the record format and " +
  "REFUSES to seal one. What belongs in the room is an expressive claim plus an " +
  "explicit rule for how a grader decides pass/fail. You who implement MICA " +
  "must fill this room yourself and learn its details against live (pilot) " +
  "experience: here is what we suggest, not what we ship. The door exists so a " +
  "later implementer extends a designed seam instead of bolting on a shed. " +
  "(ARC_MICA-NOTE_A9-Precommit-Design_20260831-98.md, ruling 1.)";

/**
 * A NON-CHANGE, stated so it is not tidied away later. The reserved
 * `grading_rule` field already occupies a slot in the SEAL preimage, carrying
 * the empty string for every v1 expectation. A v2 that fills the room therefore
 * does not rewrite a single v1 seal — the slot was always there. Removing the
 * slot to "clean up" would silently invalidate every seal ever taken.
 */
export const THE_RESERVED_SLOT_IS_IN_THE_PREIMAGE =
  "`grading_rule` occupies a slot in the seal preimage from v1 onward, empty " +
  "until the free-text room is built. Do not remove it: the empty slot is what " +
  "lets a later version add the field without rewriting the seals taken before " +
  "it.";

// ── the head committer (locally declared, deliberately) ──────────────────────
//
// Declared here rather than imported from `src/witness/` for the reason
// `notify/types.ts`, `floor-trail.ts` and `ruling-log.ts` each declare their
// own: this module is a SUBMITTER, and a retainer's evolution must not reshape
// the chain that submits to it. The function `fileDropCommitter` returns is
// structurally assignable to this type, which is how a caller wires the two
// without either side importing the other's shape.

/** R8's declared modality. Three spellings, matching the retainer's exactly. */
export type Modality = "OFFERED" | "IMPOSED" | "NOT_AN_INSTRUCTION";

export const MODALITIES: readonly Modality[] = [
  "OFFERED",
  "IMPOSED",
  "NOT_AN_INSTRUCTION",
];

/** The five fields MICA S-4 v0.3 §4 freezes (ruled 2026-08-26, the arbiter, S88). */
export interface HeadCommit {
  readonly seq_no: number;
  readonly head_hash: string;
  readonly ts: number;
  readonly witness_set_id: string;
  readonly modality: Modality;
}

export type HeadCommitter = (commit: HeadCommit) => void;

// ── the expectation ──────────────────────────────────────────────────────────

/**
 * The two types v1 implements, and the one it reserves.
 *
 * `verdict`     a prediction about a named, checkable field of a future outcome.
 *               Machine-gradable; failure = the named field, read at bytes, does
 *               not match.
 * `hash`        "artifact X will hash to H." Smallest footprint, zero
 *               interpretation, absolute failure. HONEST LIMIT, stated because
 *               the committer chooses it knowing this: it is brittle against
 *               meaningless byte churn — a timestamp inside the artifact breaks
 *               the prediction without the prediction being wrong about anything
 *               anyone cares about.
 * `claim+rule`  RESERVED. See THE_FREE_TEXT_DOOR. Refused in v1.
 */
export type ExpectationType = "verdict" | "hash" | "claim+rule";

export const EXPECTATION_TYPES: readonly ExpectationType[] = [
  "verdict",
  "hash",
  "claim+rule",
];

/** The types v1 will actually seal. `claim+rule` is deliberately not here. */
export const IMPLEMENTED_TYPES: readonly ExpectationType[] = ["verdict", "hash"];

/**
 * The PLAINTEXT expectation. It is what the committer keeps and what a REVEAL
 * later puts into the chain. IT NEVER ENTERS THE CHAIN AT SEAL TIME.
 *
 * `gradingRule` is the reserved field of ruling 1's door. Supplying it in v1 is
 * refused, whatever the type says — the field belongs to the room behind the
 * door, and a field accepted into a shape that cannot grade it is a promise the
 * instrument does not keep.
 */
export interface Expectation {
  readonly type: ExpectationType;
  /** Free-form pointer to the predicted event or artifact. */
  readonly target: string;
  /**
   * What the committer says the named field will read. May be empty: a
   * prediction that a field will be empty is a prediction.
   */
  readonly predictedValue: string;
  readonly committerId: string;
  /** Injected. See MINIMUM_SALT_LENGTH for why the length is checked. */
  readonly salt: string;
  /** RESERVED (ruling 1). Refused in v1. */
  readonly gradingRule?: string;
}

/** Exactly the five keys a REVEAL puts in the chain. */
export interface SealedPlaintext {
  readonly type: ExpectationType;
  readonly target: string;
  readonly predictedValue: string;
  readonly committerId: string;
  readonly salt: string;
}

const PLAINTEXT_KEYS = [
  "type",
  "target",
  "predictedValue",
  "committerId",
  "salt",
] as const;

/**
 * RULED the arbiter S98-D(4), 2026-08-31. Blessed, not smuggled.
 *
 * It was written as a house bar with an invitation to contest it, and the
 * invitation was taken up the same night and answered. The reasoning below is
 * the reasoning that was ruled on and is left standing rather than replaced by
 * the ruling — a bar whose ground has been deleted is a bar the next reader can
 * only obey.
 *
 * ── the ground, as it was offered ──
 *
 * The design note rules that the deposit is a hash of the expectation record
 * plus a salt. It does not rule how much salt. With `type` drawn from two
 * values and a short `target`, a committer who salts with "x" has sealed
 * something a grader can brute-force in a second: the seal then hides nothing
 * and the white vest is decoration. Thirty-two characters is not an entropy
 * measurement — this module cannot measure entropy and does not pretend to —
 * it is a floor cheap enough to enforce and high enough that a careless salt
 * fails loudly at the door instead of quietly at the reveal.
 */
export const MINIMUM_SALT_LENGTH = 32;

/** OFFERED, never called from inside this module. See the file header. */
export function randomSalt(): string {
  return randomBytes(24).toString("hex");
}

// ── the records ──────────────────────────────────────────────────────────────

export type PrecommitKind = "COMMITMENT" | "REVEAL" | "GRADING" | "ANCHOR";

export const PRECOMMIT_KINDS: readonly PrecommitKind[] = [
  "COMMITMENT",
  "REVEAL",
  "GRADING",
  "ANCHOR",
];

/**
 * What became of the head this book handed to a witness intake.
 *
 * THREE VALUES BECAUSE THERE ARE THREE CASES, and the pre-S99 shape collapsed
 * two of them: `headCommitDetail` was `null` both when no committer was wired
 * and when the call returned fine, so "nobody ever tried" read exactly like
 * "it worked" to anything scanning details. That is the E.2 double meaning, and
 * these three sentinels are what kills it.
 *
 * `DROPPED`      a committer was wired and its call returned normally.
 * `NOT_DROPPED`  no committer was wired. NOTHING WAS ATTEMPTED — this is an
 *                absence of an act, not a failed one.
 * `CANNOT_SEE`   a committer was wired and the call threw. Something was
 *                attempted and could not be done, and `detail` says what the
 *                errno was. Same three-valued discipline as
 *                `lookAtPrecommitFile`: "I was not allowed to look" is never
 *                reported as "it is not there".
 */
export type AnchorStatus = "DROPPED" | "NOT_DROPPED" | "CANNOT_SEE";

export const ANCHOR_STATUSES: readonly AnchorStatus[] = [
  "DROPPED",
  "NOT_DROPPED",
  "CANNOT_SEE",
];

/**
 * WHY THE ANCHOR IS A RECORD AND NOT A FIELD — contradiction 1 of the S99
 * registrar brief, carried here with its reason beside it.
 *
 * The E.1 design note asks for `anchor: {status, droppedAt, headHash}` ON every
 * entry: "the registrar writes the entry, computes the new head, drops the head
 * to the witness intake, THEN writes the anchor evidence into the record
 * itself." Three things stop that, and the third is the one that matters.
 *
 *   1. YOU CANNOT WRITE INTO A RECORD YOU HAVE ALREADY APPENDED. The book is
 *      append-only; the line is serialised once. The literal sequence in the
 *      note has no implementation.
 *
 *   2. REORDERING IT — drop first, then write the entry carrying the result —
 *      does compile, and it deletes a guard this module already holds: the
 *      post-durable block refuses to present a head when the append did not
 *      persist, so that no head is ever committed for a record that does not
 *      exist. Dropping first trades that for an orphan head on every crash
 *      between the two.
 *
 *   3. AND THE FIELD WOULD BE UNHASHED, WHICH IS THE DEFECT THIS FILE ALREADY
 *      NAMES. The anchor cannot enter its own record's preimage — the head IS
 *      that record's hash, so the hash would have to exist before the drop that
 *      decides the field. An unhashed field can be flipped on disk with the
 *      chain still verifying. Two hundred lines above, this file says exactly
 *      that about `modality`: "a modality stored but not hashed can be flipped
 *      from IMPOSED to OFFERED on disk with the chain still verifying, which is
 *      the exact false attestation this instrument exists to make loud." An
 *      `anchor.status` flipped from NOT_DROPPED to DROPPED is the same
 *      sentence, on the one field whose entire job is to attest honestly about
 *      anchoring — and the principal able to flip it is the registrar, the
 *      custodian whose self-certification the field exists to prevent.
 *
 * So the evidence is its own CHAINED, HASHED record, appended after the entry it
 * anchors. Forging it breaks the chain. The entry is durable before any head is
 * presented. Legacy entries keep their preimages untouched, so the S98/S99 book
 * still verifies and the golden vector still holds.
 *
 * AN ANCHOR RECORD IS NOT ITSELF ANCHORED, and that is not an oversight: it IS
 * the anchor evidence, and anchoring it would recurse without end. Its integrity
 * comes from the chain — the next entry's `previousHash` covers it.
 */
export const THE_ANCHOR_IS_A_RECORD_NOT_A_FIELD =
  "Anchor evidence is a chained record, not a field on the entry it describes. " +
  "A field could not be hashed into its own record's preimage (the head is that " +
  "hash), so it could be flipped on disk with the chain still verifying — the " +
  "same false attestation this module refuses for `modality` and `kind`, on the " +
  "one field whose whole job is honest attestation, editable by the very " +
  "custodian it is meant to hold to account. An ANCHOR record is covered by the " +
  "chain; forging it breaks the chain.";

/**
 * The reach limit, encoded in the type rather than left to a reader's charity.
 */
export const DROPPED_IS_DEPOSIT_NOT_SWEEP =
  "DROPPED means the head was DEPOSITED at the witness intake and the call " +
  "returned. It does NOT claim the witness swept it, retained it, or ever saw " +
  "it: the intake is last-writer-wins on a filename that is the submitter id, " +
  "and a committer gets `void` back. Submission is not retention. Read DROPPED " +
  "that far and no further.";

export type Verdict = "GREEN" | "RED" | "CANNOT_ASSESS";

export const VERDICTS: readonly Verdict[] = ["GREEN", "RED", "CANNOT_ASSESS"];

/** MATCH or MISMATCH, decided by this book at reveal and written into the entry. */
export type SealCheck = "MATCH" | "MISMATCH";

export const SEAL_CHECKS: readonly SealCheck[] = ["MATCH", "MISMATCH"];

interface PrecommitFrame {
  readonly sequenceNumber: number;
  readonly previousHash: string;
  readonly hash: string;
  /**
   * INJECTED wall time, presented by the caller. The CROSS-CHECK arrow, never
   * the ruling one (design ruling 3). This module never calls a clock.
   */
  readonly timestamp: number;
  /** R8. Per ENTRY: one commitment is offered and the next imposed. */
  readonly modality: Modality;
}

/**
 * THE SEALED DEPOSIT. Three payload fields and not one more — see
 * COMMITMENTS_NEVER_SEEDS. `committerId` is in the clear on purpose and it is
 * the only thing that is: ruling 4's `graderId != committerId` has to be
 * enforceable at GRADING time, which is BEFORE the reveal, and a deposit whose
 * depositor is unknowable is an accusation waiting to be misfiled.
 */
export interface CommitmentRecord extends PrecommitFrame {
  readonly kind: "COMMITMENT";
  readonly committerId: string;
  /** SHA-256 over the plaintext expectation and its salt. */
  readonly sealed: string;
}

export interface RevealRecord extends PrecommitFrame {
  readonly kind: "REVEAL";
  /** The sequence number of the COMMITMENT this reveals. Always < this record's. */
  readonly ref: number;
  readonly plaintext: SealedPlaintext;
  /** Decided here, at append, and written into the entry. Never a rejection. */
  readonly sealCheck: SealCheck;
  /**
   * What this book computed from the revealed plaintext, so a reader can compare
   * it against the commitment's `sealed` without rerunning any code.
   */
  readonly recomputed: string;
}

export interface GradingRecord extends PrecommitFrame {
  readonly kind: "GRADING";
  readonly ref: number;
  readonly graderId: string;
  readonly verdict: Verdict;
  /** One line. See the `ground` check in `refuseUngradeable`. */
  readonly ground: string;
}

/**
 * The anchor evidence for ONE earlier entry. See
 * THE_ANCHOR_IS_A_RECORD_NOT_A_FIELD for why this is a record.
 */
export interface AnchorRecord extends PrecommitFrame {
  readonly kind: "ANCHOR";
  /** The entry this anchors. Always < this record's own sequence number. */
  readonly ref: number;
  readonly status: AnchorStatus;
  /**
   * Wall time PRESENTED by the caller when the drop returned; 0 when no drop
   * happened. The cross-check arrow, never the ruling one — as everywhere in
   * this module, the chain is the arrow and this book never calls a clock.
   */
  readonly droppedAt: number;
  /**
   * The head that was presented: the anchored record's own `hash`. Checked
   * against the referenced record at append, so an anchor cannot be
   * transplanted from one entry onto another.
   */
  readonly headHash: string;
  /** Why, for CANNOT_SEE. Empty string for the other two statuses. */
  readonly detail: string;
}

export type PrecommitRecord =
  | CommitmentRecord
  | RevealRecord
  | GradingRecord
  | AnchorRecord;

const FRAME_KEYS = [
  "sequenceNumber",
  "previousHash",
  "hash",
  "timestamp",
  "modality",
];
const COMMITMENT_KEYS = [...FRAME_KEYS, "kind", "committerId", "sealed"];
const REVEAL_KEYS = [
  ...FRAME_KEYS,
  "kind",
  "ref",
  "plaintext",
  "sealCheck",
  "recomputed",
];
const GRADING_KEYS = [
  ...FRAME_KEYS,
  "kind",
  "ref",
  "graderId",
  "verdict",
  "ground",
];
const ANCHOR_KEYS = [
  ...FRAME_KEYS,
  "kind",
  "ref",
  "status",
  "droppedAt",
  "headHash",
  "detail",
];

// ── hashing ──────────────────────────────────────────────────────────────────
//
// Two properties taken from the ruling log's preimage, both load-bearing here
// and for the same reasons: the separator is the ASCII unit separator rather
// than a space, and every variable-length run is LENGTH-PREFIXED. `target`,
// `predictedValue`, `salt` and `ground` are free prose of unbounded length; with
// a space-joined preimage one of them could be edited so that content moved
// across a field boundary without changing the digest.
//
// `modality` and `kind` ARE IN THE PREIMAGE. A modality stored but not hashed
// can be flipped from IMPOSED to OFFERED on disk with the chain still verifying,
// which is the exact false attestation this instrument exists to make loud; a
// kind stored but not hashed lets a GRADING be relabelled a REVEAL.

const US = "\u001f";

function lengthPrefixed(value: string): string {
  return `${String(value.length)}:${value}`;
}

/**
 * The seal. DOMAIN-SEPARATED from the chain hash by its own leading tag, so a
 * chain hash can never be presented as a seal or the reverse.
 *
 * The salt goes LAST — ruling 2's "record ‖ salt", written down. `gradingRule`
 * holds its reserved slot with the empty string; see
 * THE_RESERVED_SLOT_IS_IN_THE_PREIMAGE.
 */
export function computeSealHash(e: Expectation): string {
  const canonical = [
    "MICA-A9-SEAL-v1",
    lengthPrefixed(e.type),
    lengthPrefixed(e.target),
    lengthPrefixed(e.predictedValue),
    lengthPrefixed(e.committerId),
    lengthPrefixed(e.gradingRule ?? ""),
    lengthPrefixed(e.salt),
  ].join(US);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * The chained hash. Field order is fixed and explicit — never taken from
 * `JSON.stringify` of an object literal — so a future field reordering cannot
 * silently rewrite every hash in an existing book.
 */
/**
 * A record before its own hash exists. Written out as a union of three Omits
 * rather than `Omit<PrecommitRecord, "hash">`, because Omit over a union
 * collapses to the keys the three have in COMMON — which would silently drop
 * every payload field out of the preimage and leave a chain that verified over
 * nothing but the frame. TypeScript caught that on the first compile of this
 * file; nothing else would have.
 */
export type UnhashedPrecommitRecord =
  | Omit<CommitmentRecord, "hash">
  | Omit<RevealRecord, "hash">
  | Omit<GradingRecord, "hash">
  | Omit<AnchorRecord, "hash">;

export function computePrecommitRecordHash(
  r: UnhashedPrecommitRecord
): string {
  const head = [
    "MICA-A9-CHAIN-v1",
    String(r.sequenceNumber),
    r.previousHash,
    String(r.timestamp),
    r.modality,
    r.kind,
  ];
  const tail = ((): string[] => {
    switch (r.kind) {
      case "COMMITMENT":
        return [lengthPrefixed(r.committerId), r.sealed];
      case "REVEAL":
        return [
          String(r.ref),
          lengthPrefixed(r.plaintext.type),
          lengthPrefixed(r.plaintext.target),
          lengthPrefixed(r.plaintext.predictedValue),
          lengthPrefixed(r.plaintext.committerId),
          lengthPrefixed(r.plaintext.salt),
          r.sealCheck,
          r.recomputed,
        ];
      case "GRADING":
        return [
          String(r.ref),
          lengthPrefixed(r.graderId),
          r.verdict,
          lengthPrefixed(r.ground),
        ];
      // THE ANCHOR IS IN THE PREIMAGE, which is the whole reason it is a record.
      // Flip `status` on disk and this hash no longer reproduces; the chain
      // breaks at that index and `verify()` says where.
      case "ANCHOR":
        return [
          String(r.ref),
          r.status,
          String(r.droppedAt),
          r.headHash,
          lengthPrefixed(r.detail),
        ];
    }
  })();
  return createHash("sha256")
    .update([...head, ...tail].join(US), "utf8")
    .digest("hex");
}

// ── validation ───────────────────────────────────────────────────────────────

function validateFrame(o: Parsed): boolean {
  return (
    isNonNegInteger(o.sequenceNumber) &&
    isString(o.previousHash) &&
    isString(o.hash) &&
    isFiniteNumber(o.timestamp) &&
    isEnum(o.modality, MODALITIES)
  );
}

function validatePlaintext(x: unknown): SealedPlaintext | null {
  if (!isObject(x)) return null;
  const o = x as Parsed;
  if (!hasExactKeys(o, PLAINTEXT_KEYS)) return null;
  if (!isEnum(o.type, EXPECTATION_TYPES)) return null;
  if (!isString(o.target)) return null;
  if (!isString(o.predictedValue)) return null;
  if (!isString(o.committerId)) return null;
  if (!isString(o.salt)) return null;
  return o as unknown as SealedPlaintext;
}

/** Closed-shape validation before any parsed record joins the chain. */
export function validatePrecommitRecord(x: unknown): PrecommitRecord | null {
  if (!isObject(x)) return null;
  const o = x as Parsed;
  if (!isEnum(o.kind, PRECOMMIT_KINDS)) return null;
  if (o.kind === "COMMITMENT") {
    if (!hasExactKeys(o, COMMITMENT_KEYS)) return null;
    if (!validateFrame(o)) return null;
    if (!isString(o.committerId)) return null;
    if (!isString(o.sealed)) return null;
    return o as unknown as CommitmentRecord;
  }
  if (o.kind === "REVEAL") {
    if (!hasExactKeys(o, REVEAL_KEYS)) return null;
    if (!validateFrame(o)) return null;
    if (!isNonNegInteger(o.ref)) return null;
    if (validatePlaintext(o.plaintext) === null) return null;
    if (!isEnum(o.sealCheck, SEAL_CHECKS)) return null;
    if (!isString(o.recomputed)) return null;
    return o as unknown as RevealRecord;
  }
  if (o.kind === "ANCHOR") {
    if (!hasExactKeys(o, ANCHOR_KEYS)) return null;
    if (!validateFrame(o)) return null;
    if (!isNonNegInteger(o.ref)) return null;
    if (!isEnum(o.status, ANCHOR_STATUSES)) return null;
    if (!isNonNegInteger(o.droppedAt)) return null;
    if (!isString(o.headHash)) return null;
    if (!isString(o.detail)) return null;
    return o as unknown as AnchorRecord;
  }
  if (!hasExactKeys(o, GRADING_KEYS)) return null;
  if (!validateFrame(o)) return null;
  if (!isNonNegInteger(o.ref)) return null;
  if (!isString(o.graderId)) return null;
  if (!isEnum(o.verdict, VERDICTS)) return null;
  if (!isString(o.ground)) return null;
  return o as unknown as GradingRecord;
}

// ── refusals ─────────────────────────────────────────────────────────────────

/**
 * A refusal BY DESIGN, typed so a caller can tell it from "the disk broke".
 *
 * Every refusal in this module throws this and writes NOTHING. That is the
 * distinction the design note draws and it is worth stating: a REVEAL whose hash
 * does not match its commitment is a SUBSTANTIVE FINDING about a real deposit
 * and is RECORDED, loudly, in the entry itself — silence is never safety. A
 * self-grading, a reference to a record that does not exist, a `claim+rule`:
 * those are not findings about anything, they are statements the chain has no
 * shape to hold, and refusing them is the only honest handling.
 */
export class PrecommitRefused extends Error {
  constructor(
    message: string,
    readonly signpost: string
  ) {
    super(`${message} ${signpost}`);
    this.name = "PrecommitRefused";
  }
}

/**
 * A deployment act that was never performed. Its own class, not the arbiter's or
 * the witness's — one signpost per seam (S97). The three sibling seams cite a
 * recipe section; THIS ONE CANNOT, because no section exists for an A9 book. The
 * signpost says so rather than inventing a number: an undesignated deployment
 * act is a finding for the arbiter, and a fabricated citation would hide it.
 */
export class PrecommitDeploymentActMissing extends Error {
  constructor(
    message: string,
    readonly path: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "PrecommitDeploymentActMissing";
  }
}

export const THE_STORE_LOCATION_IS_UNDESIGNATED =
  "The deploy recipe has NO section for a pre-commitment book. Its location, " +
  "its owning principal and which roles may read it are an undesignated " +
  "deployment act — the design note lists store location among the things it " +
  "deliberately does not design. This module therefore names no path, creates " +
  "nothing, and refuses to open a book whose directory is not already there. " +
  "Wiring one is the arbiter's call, and it is owed.";

function requirePrecommitStoreDir(dir: string): void {
  const signpost =
    `pre-commitment book directory absent — this is a deployment act and it has ` +
    `no recipe section yet. Expected: ${dir}, owned and permissioned by whoever ` +
    `the arbiter rules owns an A9 book. Nothing was created. ` +
    THE_STORE_LOCATION_IS_UNDESIGNATED;
  let stats: Stats;
  try {
    stats = statSync(dir);
  } catch (err) {
    throw new PrecommitDeploymentActMissing(
      `${signpost} (${String(err)})`,
      dir,
      err
    );
  }
  if (!stats.isDirectory()) {
    throw new PrecommitDeploymentActMissing(
      `${signpost} That path exists and is not a directory.`,
      dir
    );
  }
}

/**
 * Everything that can be refused about an expectation WITHOUT looking at the
 * chain. Runs before any lock is taken: a refusal should not cost a lock
 * acquisition, and a caller should learn its expectation is malformed whether or
 * not the store happens to be writable right now.
 */
function refuseUnsealable(e: Expectation): void {
  if (!isEnum(e.type, EXPECTATION_TYPES)) {
    throw new PrecommitRefused(
      `unknown expectation type ${JSON.stringify(e.type)}.`,
      `Implemented in v1: ${IMPLEMENTED_TYPES.join(", ")}.`
    );
  }
  if (e.type === "claim+rule") {
    throw new PrecommitRefused(
      "v1 will not seal a free-text claim.",
      THE_FREE_TEXT_DOOR
    );
  }
  if (e.gradingRule !== undefined) {
    throw new PrecommitRefused(
      "a `gradingRule` was supplied and v1 has nowhere to grade it.",
      THE_FREE_TEXT_DOOR
    );
  }
  if (e.committerId.length === 0) {
    throw new PrecommitRefused(
      "a commitment with no committer id cannot be graded by anyone.",
      A_COMMITTER_NEVER_GRADES_ITSELF
    );
  }
  if (e.target.length === 0) {
    throw new PrecommitRefused(
      "a commitment with no target names no event and can never be settled.",
      "A `verdict` target names a checkable field of a future outcome; a `hash` " +
        "target names the artifact. Both must name something."
    );
  }
  if (e.salt.length < MINIMUM_SALT_LENGTH) {
    throw new PrecommitRefused(
      `the salt is ${String(e.salt.length)} characters and the floor is ` +
        `${String(MINIMUM_SALT_LENGTH)}.`,
      "A seal over a small plaintext space with a guessable salt hides nothing. " +
        "`randomSalt()` is offered; this module will not make one for you, " +
        "because the committer has to be able to reproduce its own seal."
    );
  }
}

function refuseUngradeable(graderId: string, ground: string): void {
  if (graderId.length === 0) {
    throw new PrecommitRefused(
      "a grading with no grader id records a verdict nobody said.",
      A_COMMITTER_NEVER_GRADES_ITSELF
    );
  }
  if (ground.length === 0) {
    throw new PrecommitRefused(
      "a grading with no ground is a verdict without a reason.",
      "Ruling 4 requires a ground: one line saying what the grader read."
    );
  }
  if (ground.includes("\n")) {
    // RULED the arbiter S98-D(4), 2026-08-31. Offered as a house reading of ruling 4's
    // "ground: one line" and flagged as contestable in the A9 receipt; contested
    // and blessed the same night.
    //
    // The ground it was blessed on, kept: a ground allowed to grow into an essay
    // stops being the thing a reader of the chain can take in at a glance, which
    // is the only reason it is required at all.
    throw new PrecommitRefused(
      "a ground is one line and this one has a newline in it.",
      "Ruling 4 says `ground: one line`. If a grading needs an essay, the essay " +
        "belongs where essays belong and the ground names it."
    );
  }
}

/**
 * The three statuses each mean one thing, and the other two fields have to
 * agree with the one that was chosen. A `CANNOT_SEE` with no detail is a
 * refusal that will not say what stopped it — the pose the brief forbids — and
 * a `NOT_DROPPED` carrying a timestamp is claiming a moment for an act that
 * never happened.
 */
function refuseIncoherentAnchor(input: AnchorInput): void {
  if (!isEnum(input.status, ANCHOR_STATUSES)) {
    throw new PrecommitRefused(
      `unknown anchor status ${JSON.stringify(input.status)}.`,
      `The three: ${ANCHOR_STATUSES.join(", ")}. ` + DROPPED_IS_DEPOSIT_NOT_SWEEP
    );
  }
  if (input.headHash.length === 0) {
    throw new PrecommitRefused(
      "an anchor with no head hash names no head.",
      THE_ANCHOR_IS_A_RECORD_NOT_A_FIELD
    );
  }
  if (input.status === "CANNOT_SEE" && input.detail.length === 0) {
    throw new PrecommitRefused(
      "a CANNOT_SEE anchor with no detail will not say what stopped it.",
      "CANNOT_SEE is the one status that reports a failed attempt, and a " +
        "failed attempt that names no reason is a pose. Carry the errno."
    );
  }
  if (input.status !== "CANNOT_SEE" && input.detail.length > 0) {
    throw new PrecommitRefused(
      `a ${input.status} anchor carries a detail, and only CANNOT_SEE has ` +
        "anything to explain.",
      "DROPPED means the call returned and NOT_DROPPED means nothing was " +
        "attempted. Neither has a failure to describe."
    );
  }
  if (input.status === "DROPPED" && input.droppedAt <= 0) {
    throw new PrecommitRefused(
      "a DROPPED anchor names no moment at which the drop returned.",
      DROPPED_IS_DEPOSIT_NOT_SWEEP
    );
  }
  if (input.status !== "DROPPED" && input.droppedAt !== 0) {
    throw new PrecommitRefused(
      `a ${input.status} anchor carries droppedAt ` +
        `${String(input.droppedAt)}, claiming a moment for a drop that did ` +
        "not return.",
      "Only DROPPED happened. The other two are an absence and a failure, and " +
        "neither has a timestamp to offer."
    );
  }
  if (input.detail.includes("\n")) {
    throw new PrecommitRefused(
      "an anchor detail is one line and this one has a newline in it.",
      "Same bar as a grading's ground, for the same reason: a reader of the " +
        "chain has to be able to take it in at a glance."
    );
  }
}

// ── the store ────────────────────────────────────────────────────────────────

export type PrecommitLoadState =
  | "IN_MEMORY"
  | "LOADED_VERIFIED"
  | "FIRST_BOOT_OR_ERASED"
  | "CANNOT_VERIFY";

export interface PrecommitBookOptions {
  /** Injected deployment path. Absent means IN_MEMORY, never durable. */
  readonly path?: string;
  /** Fault-injection seam. Production leaves this absent. */
  readonly appender?: LineAppender;
  /**
   * The inter-process append lock. Production leaves this absent and gets
   * `exclusiveFileLock`. A deployment that needs a bounded retry injects it
   * HERE — the book holds no timing policy of its own.
   */
  readonly acquire?: LockAcquirer;
  /** Post-durable transport boundary. It gates nothing. */
  readonly headCommitter?: HeadCommitter;
  /** Declared witness-set id copied into the commit; absent is carried as "". */
  readonly witnessSetId?: string;
}

export interface PrecommitOutcome<R extends PrecommitRecord> {
  readonly record: R;
  readonly persisted: boolean;
  readonly detail: string | null;
  /** True only when the post-durable committer call returned normally. */
  readonly headCommitted: boolean;
  /** Null when unwired or when the commit call returned; otherwise why not. */
  readonly headCommitDetail: string | null;
}

/** What `seal` hands back: the entry, and the envelope the committer must keep. */
export interface SealOutcome extends PrecommitOutcome<CommitmentRecord> {
  /**
   * THE PLAINTEXT, RETURNED AND NOT STORED. This is the seed the chain refuses
   * to hold. Lose it and the commitment can never be revealed — which is a real
   * cost, deliberately borne: see COMMITMENTS_NEVER_SEEDS.
   */
  readonly envelope: Expectation;
}

export interface PrecommitVerifyResult {
  readonly valid: boolean;
  readonly brokenAt: number | null;
}

export interface SealInput {
  readonly expectation: Expectation;
  readonly timestamp: number;
  readonly modality: Modality;
}

/**
 * A COMMITMENT appended from a seal the COMMITTER computed, for a book the
 * committer does not hold. See `sealDeposited`.
 */
export interface SealDepositInput {
  /** SHA-256 hex, computed by the committer from a plaintext it keeps. */
  readonly sealed: string;
  readonly committerId: string;
  readonly timestamp: number;
  readonly modality: Modality;
}

export interface RevealInput {
  /** The sequence number of the COMMITMENT being revealed. */
  readonly ref: number;
  readonly expectation: Expectation;
  readonly timestamp: number;
  readonly modality: Modality;
}

export interface GradeInput {
  readonly ref: number;
  readonly graderId: string;
  readonly verdict: Verdict;
  readonly ground: string;
  readonly timestamp: number;
  readonly modality: Modality;
}

export interface AnchorInput {
  /** The entry being anchored. */
  readonly ref: number;
  readonly status: AnchorStatus;
  /** 0 unless the drop returned. */
  readonly droppedAt: number;
  /** Must equal the referenced record's own hash. */
  readonly headHash: string;
  /** Required for CANNOT_SEE, forbidden otherwise. */
  readonly detail: string;
  readonly timestamp: number;
  readonly modality: Modality;
}

/** What the book can say about one entry's anchoring, read back off the chain. */
export type AnchorReading =
  /** This book holds no ANCHOR records at all. */
  | { readonly state: "PRE_ANCHOR_SCHEMA" }
  /** This book anchors, and this entry has none. A finding, not a default. */
  | { readonly state: "NOT_ANCHORED" }
  | { readonly state: "RECORDED"; readonly anchor: AnchorRecord };

/** One open promise, as the chain can see it. */
export interface OpenCommitment {
  readonly sequenceNumber: number;
  readonly committerId: string;
  /** How many entries this book has taken since. The book's own age unit. */
  readonly entriesSince: number;
  /**
   * Gradings already recorded against it. A grading with no reveal is legal and
   * readable; see `grade`.
   */
  readonly gradings: number;
}

/**
 * WHAT A LOOK AT THE BOOK FILE FOUND — three answers, not two (S98, item 3).
 *
 * `existsSync` answers a two-valued question over a three-valued world: it
 * returns FALSE both for "there is no such file" and for "I was not allowed to
 * look". This book carried the ruling log's shape verbatim, defect included —
 * under `!existsSync(path)` it declared FIRST_BOOT_OR_ERASED and set
 * `persisting = true`, which for a PRE-COMMITMENT book is worse than for most:
 * a fresh book has no commitments, so `openCommitmentsLine()` would print its
 * nothing-to-count sentence over a book full of unrevealed promises this process
 * merely could not see.
 *
 * CANNOT_SEE loads to CANNOT_VERIFY and does not throw, for the reason the
 * deployment-act check does throw: an absent DIRECTORY is a missing precondition
 * with no book to report on; an unreadable FILE is a fact about the book, and
 * reporting it is this book's job.
 */
export type BookFileLook =
  | { readonly state: "PRESENT" }
  | { readonly state: "ABSENT" }
  | { readonly state: "CANNOT_SEE"; readonly detail: string };

export function lookAtPrecommitFile(path: string): BookFileLook {
  try {
    statSync(path);
    return { state: "PRESENT" };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOENT is the ONLY errno that means the book is not there.
    if (code === "ENOENT") return { state: "ABSENT" };
    return { state: "CANNOT_SEE", detail: `${code ?? "no errno"}: ${String(err)}` };
  }
}

/** The signpost a principal who cannot see the book is handed. */
export function cannotSeePrecommitMessage(path: string, detail: string): string {
  return (
    `the pre-commitment book could not be looked at, which is NOT the finding ` +
    `that it is absent — this process cannot see ${path} (${detail}). Nothing ` +
    `was created, nothing was recorded as a first boot, and this book is NOT in ` +
    `a persisting state. An empty open-commitment count from a book nobody could ` +
    `read would be the vacuous all-clear wearing a seal. ` +
    THE_STORE_LOCATION_IS_UNDESIGNATED
  );
}

/**
 * Append-only sealed expectations, their reveals, and their gradings.
 *
 * Read by no sensor and by no gate. It answers one question and refuses every
 * other: was this claim in the book before the events it predicts.
 */
export class PrecommitBook {
  private readonly chain: PrecommitRecord[] = [];
  private readonly path: string | null;
  private readonly appender?: LineAppender;
  private readonly acquire?: LockAcquirer;
  private readonly headCommitter?: HeadCommitter;
  private readonly witnessSetId: string;
  private loadState: PrecommitLoadState = "IN_MEMORY";
  private persisting = false;
  private lastError: string | null = null;

  constructor(options?: PrecommitBookOptions) {
    this.path = options?.path ?? null;
    this.appender = options?.appender;
    this.acquire = options?.acquire;
    this.headCommitter = options?.headCommitter;
    this.witnessSetId = options?.witnessSetId ?? "";
    if (this.path !== null) this.loadFromDisk();
  }

  private loadFromDisk(): void {
    const path = this.path as string;
    // THE PRECONDITION BEFORE THE BOOK. A regular file standing where the book's
    // directory belongs makes `statSync(dir/file)` fail ENOTDIR, which the look
    // would classify CANNOT_SEE — trading a typed "somebody put a file where the
    // deployment act goes" for a vague "I could not look". PC-AN caught it on the
    // first run of this change. The act is verified first and throws; everything
    // after this line is a fact about the book and is reported.
    requirePrecommitStoreDir(dirname(path));
    const look = lookAtPrecommitFile(path);
    if (look.state === "CANNOT_SEE") {
      // NOT FIRST BOOT. See `lookAtPrecommitFile`.
      this.loadState = "CANNOT_VERIFY";
      this.lastError = cannotSeePrecommitMessage(path, look.detail);
      return;
    }
    if (look.state === "ABSENT") {
      // THE BOOK DOES NOT CREATE ITS OWN DIRECTORY (S96-D, ratified S97). It
      // checks, with `statSync` so that "I cannot see it" is not reported as "it
      // is not there", and it throws out of the constructor: a book whose
      // deployment act was never performed does not come up at all, because a
      // half-made book is worse than none — somebody reads it.
      //
      // **Do not add a create-if-missing flag here**, and do not add one under a
      // test-only branch: a fence with a bypass is not a fence. A caller that
      // wants a book without a deployment act wants an IN-MEMORY one, and gets
      // it by injecting no path.
      // The directory act was verified above, before the look.
      this.loadState = "FIRST_BOOT_OR_ERASED";
      this.persisting = true;
      return;
    }

    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError = `cannot read pre-commitment book: ${String(err)}`;
      return;
    }

    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    for (let i = 0; i < lines.length; i++) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(lines[i]);
      } catch (err) {
        this.loadState = "CANNOT_VERIFY";
        this.lastError = `malformed JSON at line ${String(i)}: ${String(err)}`;
        return;
      }
      const record = validatePrecommitRecord(parsed);
      if (record === null) {
        this.loadState = "CANNOT_VERIFY";
        this.lastError =
          `record at line ${String(i)} does not match the closed ` +
          "pre-commitment schema";
        return;
      }
      this.chain.push(record);
    }

    const verification = this.verify();
    if (!verification.valid) {
      this.loadState = "CANNOT_VERIFY";
      this.lastError =
        `pre-commitment chain verification failed at index ` +
        `${String(verification.brokenAt)}`;
      return;
    }
    this.loadState =
      this.chain.length === 0 ? "FIRST_BOOT_OR_ERASED" : "LOADED_VERIFIED";
    this.persisting = true;
  }

  private resyncUnderLock(): string | null {
    const result = resyncAppendStore<PrecommitRecord>({
      path: this.path as string,
      known: this.chain,
      validate: validatePrecommitRecord,
      recomputeHash: (record) => computePrecommitRecordHash(record),
    });
    if (!result.linked) return result.detail;
    for (const record of result.extension) this.chain.push(record);
    return null;
  }

  /**
   * THE ORDERING PROPERTY, RENDERED AS A LOOKUP RATHER THAN A CHECK.
   *
   * A REVEAL and a GRADING do not carry a sequence number the caller asserts;
   * they carry a reference that must RESOLVE against the prefix this book has
   * already appended. Every record in that prefix has a sequence number strictly
   * below the one the next record will take, because the chain only grows and
   * `sequenceNumber = chain.length` is derived after the re-sync. So a reference
   * to a not-yet-existing entry, or to a later one, has nothing to resolve TO —
   * there is no forward-reference branch to delete because there is no forward
   * reference to find. That is what "impossible by construction" means here, and
   * it is why this is a resolver and not a comparison.
   *
   * It runs INSIDE `prepare()`, i.e. under the append lock and after the
   * re-sync, so the prefix it searches is disk-true. A stale prefix could only
   * ever refuse a reference that a fresher one would accept — never accept one a
   * fresher one would refuse — and refusing while the store cannot be extended
   * anyway costs nothing and writes nothing.
   */
  private resolveCommitment(ref: number, act: string): CommitmentRecord {
    if (!Number.isSafeInteger(ref) || ref < 0) {
      throw new PrecommitRefused(
        `${act} names ref ${String(ref)}, which is not a sequence number.`,
        THE_ANCHOR_IS_THE_ARROW
      );
    }
    if (ref >= this.chain.length) {
      throw new PrecommitRefused(
        `${act} names ref ${String(ref)} and this book holds ` +
          `${String(this.chain.length)} record(s), so there is nothing there yet.`,
        "A commitment can only be revealed or graded against entries that " +
          "POST-DATE it. A reference forward in an append-only chain names a " +
          "record that does not exist, and inventing one is the whole of the " +
          "cheat this instrument exists to make impossible. " +
          THE_ANCHOR_IS_THE_ARROW
      );
    }
    const found = this.chain[ref];
    if (found.kind !== "COMMITMENT") {
      throw new PrecommitRefused(
        `${act} names ref ${String(ref)}, which is a ${found.kind}, not a ` +
          "COMMITMENT.",
        "A reveal reveals a deposit and a grading grades one. Neither has " +
          "anything to say about another reveal or another grading."
      );
    }
    return found;
  }

  private transact<R extends PrecommitRecord>(
    label: string,
    build: () => Omit<R, "hash">
  ): PrecommitOutcome<R> {
    const outcome = appendStoreTransaction<R>({
      path: this.path,
      persisting: this.persisting,
      lastError: this.lastError,
      storeLabel: "pre-commitment book",
      prepare: () => {
        // Every refusal this book makes is raised HERE or before, and a throw
        // from `prepare` propagates out of the transaction with the lock
        // released and nothing appended. A refused act leaves no trace, which
        // is correct: it is not a finding about a record, it is a statement the
        // chain has no shape to hold.
        // The union member is decided by the CALLER'S literal, and TypeScript
        // cannot carry that through `R`. Same shape, and for the same reason, as
        // `appendRecord` in witness.ts. The closed-shape validator is what
        // actually holds the schema; this cast only re-states what the literal
        // in the calling method already is.
        const unhashed = build() as unknown as UnhashedPrecommitRecord;
        const record = {
          ...unhashed,
          hash: computePrecommitRecordHash(unhashed),
        } as unknown as R;
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
        `no pre-commitment book path was injected: this ${label} is IN MEMORY ` +
        "only and does not survive the process. It carries integrity but not " +
        "provenance, and a seal with no provenance seals nothing anyone else " +
        "can check.",
      notPersistingDetail:
        `the pre-commitment book is not in a persisting state; the ${label} ` +
        "was not written to disk.",
      onAppendBlocked: (detail) => {
        this.lastError = detail;
        return detail;
      },
      onAppendError: (raw) => {
        this.lastError = `cannot append to pre-commitment book: ${raw}`;
        return this.lastError;
      },
    });

    const record = outcome.record;
    let headCommitted = false;
    let headCommitDetail: string | null = null;
    if (this.headCommitter !== undefined) {
      if (!outcome.persisted) {
        headCommitDetail =
          "pre-commitment append was not durably persisted; no head was committed";
      } else {
        try {
          this.headCommitter({
            seq_no: record.sequenceNumber,
            head_hash: record.hash,
            // The record's own index, not a clock. `timestamp` is the
            // COMMITTER'S presented wall time and belongs in the record; `ts` is
            // a frozen S-4 field, and it carries the sequence so the shape is
            // satisfied without this book authoring a second time about itself.
            ts: record.sequenceNumber,
            witness_set_id: this.witnessSetId,
            modality: record.modality,
          });
          headCommitted = true;
        } catch (err) {
          headCommitDetail = `head committer threw: ${String(err)}`;
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

  /**
   * Seal an expectation. The plaintext is hashed and RETURNED; only the hash and
   * the committer id are written.
   *
   * The sequence the design note calls "before" is this record's
   * `sequenceNumber` in this book, anchored by the head committed immediately
   * after. See THE_ANCHOR_IS_THE_ARROW for exactly how far that reaches.
   */
  seal(input: SealInput): SealOutcome {
    // Before any lock: an unsealable expectation is unsealable whether or not
    // the store is writable, and the caller should learn that at the door.
    refuseUnsealable(input.expectation);
    const sealed = computeSealHash(input.expectation);
    const outcome = this.transact<CommitmentRecord>("commitment", () => {
      const sequenceNumber = this.chain.length;
      return {
        kind: "COMMITMENT",
        committerId: input.expectation.committerId,
        sealed,
        sequenceNumber,
        previousHash:
          sequenceNumber === 0 ? "" : this.chain[sequenceNumber - 1].hash,
        timestamp: input.timestamp,
        modality: input.modality,
      };
    });
    return { ...outcome, envelope: input.expectation };
  }

  /**
   * Seal a commitment from a PRECOMPUTED hash, for a custodian that must never
   * see the plaintext — contradiction 2 of the S99 registrar brief.
   *
   * ── WHY `seal()` CANNOT BE THE REGISTRAR'S PATH ───────────────────────────
   *
   *   `seal()` takes an `Expectation` and hashes it here. That is right for a
   *   committer running its own in-process book: the plaintext never leaves the
   *   principal that owns it. The registrar is a different topology — the book
   *   belongs to a custodian and the committer deposits into it — and routing a
   *   COMMITMENT through `seal()` would put the plaintext in the custodian's
   *   hands at seal time. That is exactly the state ruling 2 forbids: "A book
   *   holding the plaintext early would hold a secret worth stealing and could
   *   shape behaviour around known predictions." A registrar that saw every
   *   expectation before its event would be the single most valuable thing to
   *   compromise in the system.
   *
   *   So the committer computes `computeSealHash(envelope)` in its OWN process,
   *   keeps the envelope, and deposits sixty-four hex characters. The custodian
   *   appends a hash and a name, and learns the claim only at REVEAL, where the
   *   design puts it.
   *
   * ── WHAT THIS BOOK THEREFORE CANNOT CHECK, STATED RATHER THAN IMPLIED ─────
   *
   *   `refuseUnsealable` enforces the salt floor, the free-text door and a
   *   non-empty target. NONE of those are checkable here, because all of them
   *   are properties of a plaintext this path must not receive. They are the
   *   COMMITTER'S bars to keep, enforced in the committer's own process by
   *   `seal()` or by hand, and a deposit path cannot inherit them. What is
   *   checkable is checked: the seal is a SHA-256's worth of hex and the
   *   committer is named.
   *
   *   That is a real reduction in what the door refuses, and it is the price of
   *   the vest. It is written down here so nobody later reads the shorter check
   *   list as an oversight.
   */
  sealDeposited(input: SealDepositInput): PrecommitOutcome<CommitmentRecord> {
    if (!/^[0-9a-f]{64}$/.test(input.sealed)) {
      throw new PrecommitRefused(
        `a deposited seal must be 64 lowercase hex characters and this one is ` +
          `${JSON.stringify(input.sealed.slice(0, 80))}.`,
        "The custodian cannot check a seal against a plaintext it must never " +
          "hold, so the one thing it can check about the shape, it checks. " +
          COMMITMENTS_NEVER_SEEDS
      );
    }
    if (input.committerId.length === 0) {
      throw new PrecommitRefused(
        "a commitment with no committer id cannot be graded by anyone.",
        A_COMMITTER_NEVER_GRADES_ITSELF
      );
    }
    return this.transact<CommitmentRecord>("deposited commitment", () => {
      const sequenceNumber = this.chain.length;
      return {
        kind: "COMMITMENT",
        committerId: input.committerId,
        sealed: input.sealed,
        sequenceNumber,
        previousHash:
          sequenceNumber === 0 ? "" : this.chain[sequenceNumber - 1].hash,
        timestamp: input.timestamp,
        modality: input.modality,
      };
    });
  }

  /**
   * Reveal a sealed commitment. The plaintext enters the chain here, and this
   * book recomputes the hash against the deposit and writes MATCH or MISMATCH
   * INTO THE ENTRY.
   *
   * A MISMATCH IS RECORDED, NEVER REJECTED. A reveal that does not match its
   * commitment is the single most interesting thing that can happen to this
   * instrument — somebody changed their story — and an instrument that answered
   * it with silence would be protecting the story. Silence is never safety.
   */
  reveal(input: RevealInput): PrecommitOutcome<RevealRecord> {
    if (!isEnum(input.expectation.type, EXPECTATION_TYPES)) {
      throw new PrecommitRefused(
        `unknown expectation type ${JSON.stringify(input.expectation.type)}.`,
        `Implemented in v1: ${IMPLEMENTED_TYPES.join(", ")}.`
      );
    }
    return this.transact<RevealRecord>("reveal", () => {
      const commitment = this.resolveCommitment(input.ref, "a reveal");
      const recomputed = computeSealHash(input.expectation);
      const sequenceNumber = this.chain.length;
      if (input.ref >= sequenceNumber) {
        throw new Error(
          "unreachable: a resolved commitment sits at or after the record " +
            "revealing it. The chain grew backwards."
        );
      }
      return {
        kind: "REVEAL",
        ref: input.ref,
        plaintext: {
          type: input.expectation.type,
          target: input.expectation.target,
          predictedValue: input.expectation.predictedValue,
          committerId: input.expectation.committerId,
          salt: input.expectation.salt,
        },
        sealCheck: recomputed === commitment.sealed ? "MATCH" : "MISMATCH",
        recomputed,
        sequenceNumber,
        previousHash:
          sequenceNumber === 0 ? "" : this.chain[sequenceNumber - 1].hash,
        timestamp: input.timestamp,
        modality: input.modality,
      };
    });
  }

  /**
   * Grade a commitment. `graderId != committerId` is enforced here (ruling 4).
   *
   * MULTIPLE GRADINGS ARE LEGAL and all of them are recorded. Disagreement
   * between the doctor and the arbiter is preserved in the chain and never
   * resolved: a verdict is a claim and gets a claim's treatment.
   *
   * A GRADING BEFORE A REVEAL IS ALSO LEGAL, and that is a decision, not an
   * oversight. A grader who has not seen the plaintext is grading something they
   * cannot have read — which is a finding a READER of this book should be able
   * to make, and `CANNOT_ASSESS` exists for exactly that grader. Show, do not
   * enforce: the state is visible in the chain, so the instrument does not have
   * to guess whether the grader had a good reason.
   */
  grade(input: GradeInput): PrecommitOutcome<GradingRecord> {
    refuseUngradeable(input.graderId, input.ground);
    if (!isEnum(input.verdict, VERDICTS)) {
      throw new PrecommitRefused(
        `unknown verdict ${JSON.stringify(input.verdict)}.`,
        `The three verdicts are ${VERDICTS.join(", ")}.`
      );
    }
    return this.transact<GradingRecord>("grading", () => {
      const commitment = this.resolveCommitment(input.ref, "a grading");
      if (input.graderId === commitment.committerId) {
        throw new PrecommitRefused(
          `${JSON.stringify(input.graderId)} may not grade its own commitment ` +
            `at seq ${String(input.ref)}.`,
          A_COMMITTER_NEVER_GRADES_ITSELF +
            " (ARC_MICA-NOTE_A9-Precommit-Design_20260831-98.md, ruling 4.)"
        );
      }
      const sequenceNumber = this.chain.length;
      if (input.ref >= sequenceNumber) {
        throw new Error(
          "unreachable: a resolved commitment sits at or after the record " +
            "grading it. The chain grew backwards."
        );
      }
      return {
        kind: "GRADING",
        ref: input.ref,
        graderId: input.graderId,
        verdict: input.verdict,
        ground: input.ground,
        sequenceNumber,
        previousHash:
          sequenceNumber === 0 ? "" : this.chain[sequenceNumber - 1].hash,
        timestamp: input.timestamp,
        modality: input.modality,
      };
    });
  }

  /**
   * Anchor an earlier entry: record what became of the head this book handed to
   * a witness intake. See THE_ANCHOR_IS_A_RECORD_NOT_A_FIELD.
   *
   * THE CALLER DOES THE DROP, NOT THIS BOOK. That is deliberate and it is the
   * same seam `headCommitter` already uses: this module holds no transport, no
   * retry and no timing policy, and a book that reached for an intake itself
   * would be a book with a network posture. The registrar drops, observes, and
   * reports here. What this book enforces is that the report is COHERENT and
   * that it is about a record that actually exists with the hash claimed.
   *
   * ONE ANCHOR PER ENTRY, and a second is refused. `[house bar — contest it]`
   * Neither design note rules this. The ground it is offered on: an entry that
   * could be anchored twice could have a `CANNOT_SEE` buried under a later
   * `DROPPED` by the custodian who failed the first drop, which is precisely
   * the self-certification the anchor exists to prevent. A genuine retry is a
   * different act at a different moment; if the arbiter wants those recorded,
   * they want a RE-ANCHOR kind that says so, not a silent overwrite.
   */
  anchor(input: AnchorInput): PrecommitOutcome<AnchorRecord> {
    refuseIncoherentAnchor(input);
    return this.transact<AnchorRecord>("anchor", () => {
      const target = this.resolveAnchorable(input.ref, input.headHash);
      const sequenceNumber = this.chain.length;
      return {
        kind: "ANCHOR",
        ref: target.sequenceNumber,
        status: input.status,
        droppedAt: input.droppedAt,
        headHash: input.headHash,
        detail: input.detail,
        sequenceNumber,
        previousHash:
          sequenceNumber === 0 ? "" : this.chain[sequenceNumber - 1].hash,
        timestamp: input.timestamp,
        modality: input.modality,
      };
    });
  }

  /**
   * Resolve the entry an anchor refers to. Runs inside `prepare()`, under the
   * lock and after the re-sync, exactly as `resolveCommitment` does.
   */
  private resolveAnchorable(ref: number, headHash: string): PrecommitRecord {
    if (!Number.isSafeInteger(ref) || ref < 0) {
      throw new PrecommitRefused(
        `an anchor names ref ${String(ref)}, which is not a sequence number.`,
        THE_ANCHOR_IS_THE_ARROW
      );
    }
    if (ref >= this.chain.length) {
      throw new PrecommitRefused(
        `an anchor names ref ${String(ref)} and this book holds ` +
          `${String(this.chain.length)} record(s), so there is nothing there ` +
          "to anchor.",
        THE_ANCHOR_IS_THE_ARROW
      );
    }
    const found = this.chain[ref];
    if (found.kind === "ANCHOR") {
      throw new PrecommitRefused(
        `an anchor names ref ${String(ref)}, which is itself an ANCHOR.`,
        "An ANCHOR record IS the anchor evidence. Anchoring one would recurse " +
          "without end; its integrity comes from the chain that covers it. " +
          THE_ANCHOR_IS_A_RECORD_NOT_A_FIELD
      );
    }
    if (found.hash !== headHash) {
      throw new PrecommitRefused(
        `an anchor claims head ${headHash.slice(0, 16)}… for ref ` +
          `${String(ref)}, whose hash is ${found.hash.slice(0, 16)}….`,
        "An anchor transplanted from one entry onto another would attest the " +
          "wrong head. The head IS the referenced record's hash, and this " +
          "book checks it rather than taking the caller's word."
      );
    }
    for (const record of this.chain) {
      if (record.kind === "ANCHOR" && record.ref === ref) {
        throw new PrecommitRefused(
          `ref ${String(ref)} is already anchored at sequence ` +
            `${String(record.sequenceNumber)}, status ${record.status}.`,
          "One anchor per entry. A second would let a failed drop be buried " +
            "under a later successful-looking one by the custodian who failed " +
            "it. A genuine retry is a different act and wants its own kind."
        );
      }
    }
    return found;
  }

  /**
   * What this book can say about one entry's anchoring.
   *
   * A BOOK WITH NO ANCHOR RECORDS AT ALL reads PRE_ANCHOR_SCHEMA for every
   * entry, and never NOT_DROPPED. The S98/S99 book is exactly that: three
   * entries written before anchoring existed. Reporting them as NOT_DROPPED
   * would be this schema putting words in the mouth of a book that predates it —
   * the silent default the S99 brief forbids. The honest statement is "this
   * book does not anchor", and it is a statement about the book.
   *
   * RESIDUAL, stated rather than hidden: an anchoring book's first entry reads
   * PRE_ANCHOR_SCHEMA in the window between its own append and its anchor's.
   * That window is one append inside one caller's sequence, and a reader who
   * catches it sees a book with no anchors yet, which is what it is.
   */
  anchorFor(ref: number): AnchorReading {
    let anchors = 0;
    let found: AnchorRecord | null = null;
    for (const record of this.chain) {
      if (record.kind !== "ANCHOR") continue;
      anchors++;
      if (record.ref === ref) found = record;
    }
    if (found !== null) return { state: "RECORDED", anchor: found };
    if (anchors === 0) return { state: "PRE_ANCHOR_SCHEMA" };
    return { state: "NOT_ANCHORED" };
  }

  verify(): PrecommitVerifyResult {
    for (let i = 0; i < this.chain.length; i++) {
      const record = this.chain[i];
      if (record.sequenceNumber !== i) return { valid: false, brokenAt: i };
      const expectedPrevious = i === 0 ? "" : this.chain[i - 1].hash;
      if (record.previousHash !== expectedPrevious) {
        return { valid: false, brokenAt: i };
      }
      if (computePrecommitRecordHash(record) !== record.hash) {
        return { valid: false, brokenAt: i };
      }
      // The ordering property, re-checked on a book loaded from DISK. Inside
      // this process it is unreachable by construction; a chain handed to us by
      // the filesystem has made no such promise, and a forward reference there
      // is a forged book, not a bug.
      if (record.kind !== "COMMITMENT" && record.ref >= i) {
        return { valid: false, brokenAt: i };
      }
    }
    return { valid: true, brokenAt: null };
  }

  /** Commitments with no REVEAL against them, oldest first. */
  openCommitments(): readonly OpenCommitment[] {
    const revealed = new Set<number>();
    const gradings = new Map<number, number>();
    for (const record of this.chain) {
      if (record.kind === "REVEAL") revealed.add(record.ref);
      else if (record.kind === "GRADING") {
        gradings.set(record.ref, (gradings.get(record.ref) ?? 0) + 1);
      }
    }
    const open: OpenCommitment[] = [];
    for (const record of this.chain) {
      if (record.kind !== "COMMITMENT") continue;
      if (revealed.has(record.sequenceNumber)) continue;
      open.push({
        sequenceNumber: record.sequenceNumber,
        committerId: record.committerId,
        entriesSince: this.chain.length - 1 - record.sequenceNumber,
        gradings: gradings.get(record.sequenceNumber) ?? 0,
      });
    }
    return open;
  }

  /**
   * The daily-report §-line: silence-is-not-health, applied to promises.
   *
   * ── WHAT THE BRIEF ASKED FOR, AND WHY IT CANNOT BE COMPUTED ────────────────
   *
   *   The brief's §4 asks for "commitments past their TARGET with no REVEAL".
   *   A COMMITMENT record holds no target — that is ruling 2 working exactly as
   *   designed — so nothing that reads this chain can know whether a target has
   *   passed. The two are the same decision seen from two sides: a book that
   *   could tell you which promises are overdue is a book that is holding the
   *   promises, which is the seed custody S98-B(3) forbids.
   *
   *   So the line counts what the chain actually holds: commitments with no
   *   reveal, and their age in the book's OWN unit — entries appended since.
   *   That needs no clock, no target and no plaintext. A caller who does hold
   *   the envelopes can say more; this book cannot, and says the smaller thing.
   *
   * ── AND A COUNT WITH NOTHING TO COUNT IS NOT A CLEAN COUNT (S96-B, S97) ────
   *
   *   "0 open commitments" over a book holding no commitments at all is true the
   *   way "every unicorn in this room is green" is true, and it is exactly the
   *   vacuous all-clear the daily report had to have cut out of its §4. It is
   *   withheld here for the same reason, and says so.
   */
  openCommitmentsLine(): string {
    const commitments = this.chain.filter(
      (r) => r.kind === "COMMITMENT"
    ).length;
    if (commitments === 0) {
      return (
        "- open commitments: this book holds no commitments at all, so the " +
        "open-commitment count has nothing to count and is therefore not made."
      );
    }
    const open = this.openCommitments();
    if (open.length === 0) {
      return (
        `- open commitments: 0 of ${String(commitments)} — every commitment in ` +
        "this book has been revealed."
      );
    }
    const listed = open
      .map(
        (o) =>
          `seq ${String(o.sequenceNumber)} (${o.committerId}, ` +
          `${String(o.entriesSince)} entr${o.entriesSince === 1 ? "y" : "ies"} ` +
          `since${o.gradings === 0 ? "" : `, ${String(o.gradings)} grading(s)`})`
      )
      .join("; ");
    return (
      `- open commitments: ${String(open.length)} of ${String(commitments)} ` +
      `sealed and not revealed — ${listed}. An unrevealed commitment is not a ` +
      "finding; it is a promise nobody has come back to."
    );
  }

  getAll(): readonly PrecommitRecord[] {
    return this.chain;
  }

  getLoadState(): PrecommitLoadState {
    return this.loadState;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  get length(): number {
    return this.chain.length;
  }

  /** True when a path was injected at all. */
  get hasDeclaredPath(): boolean {
    return this.path !== null;
  }

  /** True when a head committer was injected at all. */
  get hasHeadCommitter(): boolean {
    return this.headCommitter !== undefined;
  }
}
