// ── MICA · S-4 witness contract and retained record types ────────────────────
//
// HeadCommit and WitnessReceipt independently repeat the field names frozen by
// MICA S-4 v0.3 §4 and ILAS src/s4/types.ts. This module deliberately imports
// nothing from ILAS: the witness and the observed node are separate deployments.
//
// S-4 WAS v0.2 UNTIL 2026-08-26. The four-field head-commit freeze became a
// FIVE-field freeze on that date — `modality` joined it — ruled by the arbiter in
// session 88. This is a version bump written down, not a silent edit: every
// place in this repository that cited the v0.2 four-field freeze now cites v0.3
// and carries this date, so a reader who remembers four fields can find out
// when and by whom it became five.
//
// The TWO imports it does take (S85) are the append lock's ACQUIRER TYPE and the
// durable write's APPENDER TYPE, both from the substrate's single append seam.
// The witness vendors neither: a deployment that needs a bounded retry injects an
// acquirer here, a test that needs the pen to fail injects an appender, and there
// is nowhere else in this repository for either type to come from.

import type { LineAppender, LockAcquirer } from "../mica/store/append-store";

/**
 * THE DECLARED MODALITY (R8; the third value ruled by the arbiter, 2026-08-26, S88).
 *
 * A submitter's own statement about the act the committed entry records — not
 * an assessment, not a finding, and never something the witness derives. The
 * witness copies what arrived and certifies nothing about it, exactly as it
 * does with `witness_set_id`.
 *
 * OFFERED             the act was offered and could have been declined.
 * IMPOSED             the act was imposed; declining was not on the table.
 * NOT_AN_INSTRUCTION  no human instruction rode this entry at all. This is what
 *                     a MACHINE BOOK'S DEPLOYER declares: notify's per-notice
 *                     heads, the doctor's SUBSTRATE_READ glue. The spelling is
 *                     `NOT_AN_INSTRUCTION` and not `NONE` because "none"
 *                     invites the question *none of what* and answers nothing;
 *                     this states the claim as wide as the method (R4).
 *
 * THE REJECTED ALTERNATIVE, recorded so it stays contestable: no third value,
 * machine books keeping the four-key legacy shape. That makes every machine
 * commit an UNDECLARED_MODALITY forever, and a refusal kind that fires on every
 * ordinary append is a refusal kind nobody can read.
 */
export type Modality = "OFFERED" | "IMPOSED" | "NOT_AN_INSTRUCTION";

export const MODALITIES: readonly Modality[] = [
  "OFFERED",
  "IMPOSED",
  "NOT_AN_INSTRUCTION",
];

export interface HeadCommit {
  readonly seq_no: number;
  readonly head_hash: string;
  readonly ts: number;
  readonly witness_set_id: string;
  /** R8. Declared by the submitter, copied verbatim, never derived here. */
  readonly modality: Modality;
}

/**
 * A four-key drop: what a v0.2 submitter presents at a v0.3 intake.
 *
 * IT IS NOT MALFORMED. It parses, it carries a complete legacy commit, and the
 * only thing wrong with it is that it declares nothing about modality — which
 * is a fact about the submitter, not about the bytes. So it is retained under
 * its own kind carrying EXACTLY the four fields presented.
 *
 * THE WITNESS FABRICATES NO MODALITY VALUE, EVER. There is deliberately no
 * `modality` field on this type: a default here would be the witness authoring
 * a declaration on a submitter's behalf, which is the one thing an instrument
 * built to make false attestation loud must never do.
 */
export interface UnmodalizedHeadCommit {
  readonly seq_no: number;
  readonly head_hash: string;
  readonly ts: number;
  readonly witness_set_id: string;
}

/**
 * THE CHAIN NAME (R8; ruled by the arbiter, 2026-09-03, S105 — option (b), "which book
 * is this is a question that wants an answer").
 *
 * ── THE DEBT THIS PAYS (board S102-E) ────────────────────────────────────────
 *
 *   `HeadCommit` names no chain. The registrar drops N BOOK heads through ONE
 *   committer under ONE `witness_set_id`, and the refusal log shipped
 *   CHAINED-BUT-TRUNCATABLE for the same reason: a nameless head can be
 *   presented as any chain's head, and a chain that goes silent is invisible
 *   among the others because nothing says which chain stopped speaking.
 *
 * ── WHAT IT IS AND WHAT IT IS NOT ────────────────────────────────────────────
 *
 *   `chain_id` is DECLARED BY THE SUBMITTER, copied verbatim, and NEVER derived
 *   or defaulted by the witness — the same sentence `modality` carries, for the
 *   same reason. A witness that names a submitter's chain on its behalf has
 *   authored the one field a reader would use to decide which book he is
 *   looking at.
 *
 *   It is not `witness_set_id`. That names the WITNESS SET a submitter presents
 *   to; this names the CHAIN the head belongs to. One witness set holds many
 *   chains, which is exactly the situation that made the head unreadable.
 *
 * ── THE GRAMMAR, PRINTED HERE BECAUSE IT IS CHANNEL FRAMING ──────────────────
 *
 *   See `CHAIN_ID_GRAMMAR`. A drop whose `chain_id` is outside it is a
 *   MALFORMED_SUBMISSION at the intake — the identical treatment a five-key
 *   drop with an out-of-enum `modality` already gets, and for the identical
 *   reason: the shape rule is CHANNEL FRAMING, not adjudication of what the
 *   submitter meant. The witness still judges nothing about which chain this is.
 */
export interface NamedHeadCommit {
  readonly seq_no: number;
  readonly head_hash: string;
  readonly ts: number;
  readonly witness_set_id: string;
  /** R8. Declared by the submitter, copied verbatim, never derived here. */
  readonly modality: Modality;
  /** R8. Declared by the submitter, copied verbatim, never derived here. */
  readonly chain_id: string;
}

/**
 * ── THE CHAIN_ID GRAMMAR (S105). Framing, and the reason for every clause. ───
 *
 *   non-empty                 a chain named "" is a chain not named.
 *   at most 128 characters    a bound, so a retained record cannot be grown
 *                             without limit by a submitter.
 *   NO WHITESPACE OF ANY KIND **LOAD-BEARING, not tidiness.** The witness
 *                             preimage is SPACE-JOINED (`canonicalWitnessRecord`).
 *                             A `chain_id` carrying a space could let a retained
 *                             record be edited on disk into a DIFFERENT record
 *                             with the SAME preimage — content moved across a
 *                             field boundary, `verify()` still VALID, and the
 *                             head now claiming another chain. That is the exact
 *                             false attestation this instrument exists to make
 *                             loud. The refusal log names the same hazard and
 *                             answers it with a unit separator; this chain
 *                             answers it by barring the separator from the field
 *                             AND by placing `chain_id` in the preimage between
 *                             two fields that cannot hold a space either
 *                             (`modality`, an enum, and `previousHash`, a hex
 *                             digest this witness computes).
 *   no control characters     same family: a record whose bytes are unprintable
 *                             is a record nobody reads correctly.
 *   no "/", no "\\", no ".."    a bare identifier is not a path. `chain_id` is
 *                             precisely the string a later reader will want to
 *                             put in a per-chain filename, and the cheap place
 *                             to stop that is the intake, not the reader. Same
 *                             bar `fileDropCommitter` already puts on a
 *                             submitter id.
 *
 *   SUGGESTED, NOT ENFORCED: `<domain>:<owner>` — `precommit:mica-doctor`,
 *   `refusal:registrar`. The witness does not check it and must not: a
 *   convention the instrument enforces is a convention the instrument authored.
 */
export const CHAIN_ID_GRAMMAR =
  "chain_id: non-empty, at most 128 characters, NO whitespace, NO control " +
  "characters, and none of \"/\", \"\\\\\" or \"..\". Suggested form " +
  "<domain>:<owner>, e.g. precommit:mica-doctor — suggested, never enforced. " +
  "The no-whitespace clause is load-bearing: the witness preimage is " +
  "space-joined, and a space inside a field is a field boundary a disk edit " +
  "could move.";

export interface WitnessReceipt {
  readonly seq_no: number;
  readonly head_hash: string;
  readonly witness_ts: number;
  readonly witness_sig: string;
}

export const WITNESSED_KINDS = [
  "HEAD_COMMIT",
  "MALFORMED_SUBMISSION",
  "UNDECLARED_SUBMITTER",
  "PLACEMENT",
  "KEY_UNAVAILABLE",
  "UNREADABLE_DROP",
  "UNDECLARED_MODALITY",
  // ── THE EIGHTH AND NINTH KINDS (S105, 2026-09-03) ──────────────────────────
  //
  // APPENDED, NEVER INSERTED. These strings are the KIND LABELS ON RETAINED
  // RECORDS. Reordering this list is free; renaming an existing entry is a
  // rewrite of history, which is why `HEAD_COMMIT` keeps its name below even
  // though it now denotes the SHAPE THAT DOES NOT NAME ITS CHAIN.
  "NAMED_HEAD_COMMIT",
  "NAMED_UNDECLARED_SUBMITTER",
] as const;

export type WitnessedKind = (typeof WITNESSED_KINDS)[number];

export interface MalformedSubmission {
  readonly byteLength: number;
  readonly sha256: string;
}

export type PlacementReading<T> =
  | { readonly state: "OBSERVED"; readonly value: T }
  | { readonly state: "NOT_OBSERVABLE"; readonly reason: string }
  | { readonly state: "READ_FAILED"; readonly reason: string };

export interface PlacementObservation {
  readonly platform: string;
  readonly effectiveUid: PlacementReading<number>;
  readonly effectiveGid: PlacementReading<number>;
  readonly hostname: string;
  readonly storePath: string;
  readonly storeMode: PlacementReading<number>;
  readonly keyAvailable: boolean;
}

/** Narrow test seam for host placement facts; production uses the native APIs. */
export interface PlacementRuntime {
  readonly platform: string;
  readonly getuid: (() => number) | undefined;
  readonly getgid: (() => number) | undefined;
  readonly storeMode: (storePath: string) => number;
}

export interface KeyUnavailableObservation {
  readonly keyPath: string | null;
  readonly detail: string;
}

/**
 * THE SIXTH WITNESSED KIND (S86, 2026-08-26 — house decision under the arbiter's
 * explicit delegation; the negative he ruled directly is NO transport and NO
 * mouth on the witness, so this record surfaces through the daily witness
 * report and nowhere else).
 *
 * S78 fork B recorded "NO sixth witnessed kind". That bar was about
 * EVIDENCE-CONTENT kinds — notice envelopes riding through the intake, whose
 * content the intake destroys. This carries no content at all: it is the
 * witness recording its OWN DENIED READ, the same self-observation family as
 * PLACEMENT and KEY_UNAVAILABLE.
 *
 * THERE IS NO HASH FIELD AND THERE MUST NEVER BE ONE. No bytes were read. A
 * `sha256` here would be a hash of something the witness never saw, and a
 * record that implies a read that did not happen is a false attestation.
 *
 * `size` and `mode` are PlacementReadings because `stat` MAY REFUSE TOO, and
 * that refusal is itself the observation worth retaining.
 */
export interface UnreadableDropObservation {
  /** Why the read failed, as the OS said it. */
  readonly error: string;
  readonly size: PlacementReading<number>;
  readonly mode: PlacementReading<number>;
}

interface WitnessRecordFrame {
  readonly seq: number;
  readonly arrivalTs: number;
  readonly submitterId: string;
  readonly previousHash: string;
  readonly hash: string;
}

/**
 * A head commit that DOES NOT NAME ITS CHAIN.
 *
 * ── WHY THIS KIND KEEPS THE PLAIN NAME, AND THE PRECEDENT IT DOES NOT FOLLOW ─
 *
 *   S88 widened `HeadCommit` from four keys to five and gave the OLDER, poorer
 *   shape a new deficit-name (`UNDECLARED_MODALITY`). Read as a rule, S105
 *   would do the same: `HEAD_COMMIT` becomes six keys, and the five-key shape
 *   gets the new name.
 *
 *   THAT IS EXACTLY WHAT S105 DOES NOT DO, and the reason is on disk. The
 *   intake's schema is CLOSED — `hasExactKeys` — so redefining `HEAD_COMMIT` to
 *   mean six keys makes every five-key `HEAD_COMMIT` ALREADY RETAINED fail
 *   `validateRecord`, and a store that verified yesterday stops verifying today
 *   with nothing on disk having changed. The live witness store held 8 frames,
 *   VALID, at S103 close. S88 could afford its direction; S105 cannot, and a
 *   precedent is a reason, not an instruction.
 *
 *   So the deficit takes the NEW name (`NAMED_HEAD_COMMIT` is the complete one)
 *   and `HEAD_COMMIT` keeps its label and its exact five-key meaning. Old
 *   records are retained, never reinterpreted, never backfilled — the same
 *   sentence `UnmodalizedHeadCommit` already carries, applied one shape up.
 */
export interface HeadCommitRecord extends WitnessRecordFrame {
  readonly kind: "HEAD_COMMIT";
  readonly witnessed: HeadCommit;
}

export interface MalformedSubmissionRecord extends WitnessRecordFrame {
  readonly kind: "MALFORMED_SUBMISSION";
  readonly witnessed: MalformedSubmission;
}

export interface UndeclaredSubmitterRecord extends WitnessRecordFrame {
  readonly kind: "UNDECLARED_SUBMITTER";
  readonly witnessed: HeadCommit;
}

export interface PlacementRecord extends WitnessRecordFrame {
  readonly kind: "PLACEMENT";
  readonly witnessed: PlacementObservation;
}

export interface KeyUnavailableRecord extends WitnessRecordFrame {
  readonly kind: "KEY_UNAVAILABLE";
  readonly witnessed: KeyUnavailableObservation;
}

export interface UnreadableDropRecord extends WitnessRecordFrame {
  readonly kind: "UNREADABLE_DROP";
  readonly witnessed: UnreadableDropObservation;
}

/**
 * THE SEVENTH WITNESSED KIND (S88, 2026-08-26).
 *
 * A declared submitter presented a well-formed FOUR-KEY commit at a five-key
 * intake. The bytes are fine; the DECLARATION is missing. Retained carrying
 * exactly the four fields that arrived and not one more.
 *
 * ── THE S78 FORK B BAR, CHECKED THE SAME WAY UNREADABLE_DROP'S WAS (S86) ─────
 *
 *   The bar was on EVIDENCE-CONTENT kinds — notice envelopes riding through an
 *   intake that destroys their content. This carries no content beyond the
 *   four-field commit a HEAD_COMMIT already carries, and it is the same REFUSAL
 *   FAMILY as UNDECLARED_SUBMITTER: a submission that arrived and could not be
 *   completed as one, retained as what it actually was.
 *
 *   IF THIS BUILD IS CONTESTED, THIS IS THE LINE TO CONTEST. It is the house's
 *   reading of a ruled bar, not a ruling.
 *
 * ── NO RECEIPT, AND THAT IS NOT AN OVERSIGHT ─────────────────────────────────
 *
 *   Receipts attest HEAD_COMMITs. This is not one, so no receipt is written and
 *   the submitter learns nothing back — the same silence UNDECLARED_SUBMITTER
 *   already returns. A submitter that wants a receipt declares a modality.
 */
export interface UndeclaredModalityRecord extends WitnessRecordFrame {
  readonly kind: "UNDECLARED_MODALITY";
  readonly witnessed: UnmodalizedHeadCommit;
}

/**
 * THE EIGHTH WITNESSED KIND (S105, 2026-09-03).
 *
 * A declared submitter presented a well-formed SIX-KEY commit that names its
 * chain. This is the complete shape; `HEAD_COMMIT` is the one that is missing a
 * field. A receipt IS written for it, exactly as for `HEAD_COMMIT` — the
 * receipt path is gated on the DECLARED SUBMITTER check, not on the kind label.
 *
 * ── THE S78 FORK B BAR, CHECKED A THIRD TIME (after S86 and S88) ─────────────
 *
 *   The bar was on EVIDENCE-CONTENT kinds — notice envelopes riding through an
 *   intake that destroys their content. This carries no content: it is the same
 *   head commit `HEAD_COMMIT` already carries plus a NAME FOR THE CHAIN, which
 *   is the one thing a reader needed and could not get.
 */
export interface NamedHeadCommitRecord extends WitnessRecordFrame {
  readonly kind: "NAMED_HEAD_COMMIT";
  readonly witnessed: NamedHeadCommit;
}

/**
 * THE NINTH WITNESSED KIND (S105, 2026-09-03).
 *
 * An UNDECLARED submitter presented a well-formed SIX-KEY commit.
 *
 * ── WHY THIS IS NOT `UNDECLARED_SUBMITTER` WITH A WIDER PAYLOAD ──────────────
 *
 *   `UNDECLARED_SUBMITTER`'s payload IS a five-key `HeadCommit`, and the
 *   canonicaliser lists a payload's fields BY NAME under its kind. A kind whose
 *   payload could be either shape would force the canonicaliser to sniff the
 *   VALUE to decide what to hash — and a preimage that depends on a shape the
 *   kind does not declare is the seam a disk edit works in. So the shape gets
 *   its own kind, and the KIND alone still decides what is hashed.
 *
 *   THE COST, STATED: a new frozen field costs TWO kinds, one declared and one
 *   undeclared, not one. Nine kinds now. The alternative — S88's cell-absorption
 *   trick, retaining this as `NAMED_HEAD_COMMIT` and letting `submitterId` on
 *   the frame carry the finding — was rejected because it runs the wrong way:
 *   S88 absorbed a case into the MORE specific finding, and this would absorb a
 *   REFUSAL into an ACCEPTANCE, labelling an unrostered submitter's drop with
 *   the same kind a good one gets.
 *
 * ── NO RECEIPT, for the reason `UNDECLARED_SUBMITTER` gives ──────────────────
 *
 *   Naming your chain is not being on the roster. An undeclared submitter that
 *   names its chain has told the witness one more true thing about a submission
 *   the witness still cannot attest, and is answered with the same silence.
 */
export interface NamedUndeclaredSubmitterRecord extends WitnessRecordFrame {
  readonly kind: "NAMED_UNDECLARED_SUBMITTER";
  readonly witnessed: NamedHeadCommit;
}

export type WitnessRecord =
  | HeadCommitRecord
  | NamedHeadCommitRecord
  | NamedUndeclaredSubmitterRecord
  | MalformedSubmissionRecord
  | UndeclaredSubmitterRecord
  | PlacementRecord
  | KeyUnavailableRecord
  | UnreadableDropRecord
  | UndeclaredModalityRecord;

export type WitnessLoadState =
  | "LOADED_VERIFIED"
  | "LOADED_UNVERIFIED_JSON"
  | "LOADED_UNVERIFIED_SCHEMA"
  | "STORE_BREAK"
  | "EMPTY";

export interface WitnessVerifyResult {
  readonly valid: boolean;
  readonly brokenAt: number | null;
}

export interface WitnessOptions {
  readonly witnessSetId: string;
  readonly storePath: string;
  readonly outboxDir: string;
  readonly keyPath?: string;
  readonly declaredSubmitters: readonly string[];
  readonly witnessClock?: () => number;
  /** Optional file-drop directory. Each filename is its presented submitter id. */
  readonly intakeDir?: string;
  /** Optional placement source, for exercising platform and read-failure boundaries. */
  readonly placementRuntime?: PlacementRuntime;
  /**
   * The inter-process append lock. Production leaves this absent and gets
   * `exclusiveFileLock`. A deployment that needs a bounded retry injects it HERE
   * — the witness holds no timing policy of its own, and never will.
   */
  readonly lockAcquirer?: LockAcquirer;
  /**
   * The durable write. Production leaves this absent and gets `durableLineAppender`.
   * It exists so a FAULT can be injected: a pen that throws is the only way to
   * reach the append-failure path, because the re-sync reads the same file first
   * and a broken path now fails there instead.
   */
  readonly appender?: LineAppender;
}

export interface WitnessSubmissionResult {
  readonly record: WitnessRecord;
  readonly receipt: WitnessReceipt | null;
  readonly receiptPath: string | null;
}
