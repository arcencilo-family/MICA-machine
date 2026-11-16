// -- MICA · the registrar — the custodial principal that holds the A9 books ---
//
// THE ONE SENTENCE THIS MODULE IS ALLOWED TO SAY:
//
//   An entitled principal deposited this entry, I appended it to that
//   principal's book, and here is what became of the head I handed the witness.
//
// It does not certify the claim, the depositor, or the grading. It never
// grades, never rules, and never reads meaning. Ruled S99 (E.1 design note §0):
// role class CUSTODIAL, witness-class, NOT a seat — so it collides with nothing
// in no-node-self-certifies.
//
// -- WHY A CUSTODIAN AT ALL --------------------------------------------------
//
//   Separation as armour. A committer that CANNOT touch its own book can never
//   be accused of doctoring it. Before this module the S98/S99 book sat in a
//   build seat's checkout, writable by the same principal that wrote its
//   entries — the exact shape whose absence the instrument exists to show.
//
// -- IDENTITY IS THE FILE'S OWNER, NOT THE FILE'S CONTENTS [LB] ---------------
//
//   A deposit names its depositor. That name is UNTRUSTED: anyone who can write
//   the intake can type any name into a JSON field. The trusted identity is the
//   OWNER UID of the deposit file, which the kernel sets and the depositor
//   cannot forge. This module resolves that uid through an injected roster and
//   REFUSES any deposit whose claimed depositor disagrees with it.
//
//   Refused, not silently corrected: a frame claiming to be someone else is the
//   most interesting thing that can arrive at this intake, and normalising it
//   into a valid record would erase the only evidence that it happened.
//
// -- WHAT IT DOES NOT DO -----------------------------------------------------
//
//   It does not create the intake or the store root. Those are deployment acts
//   at stated modes (E.1 §1), and a custodian that conjured them would create
//   them wrong and hide a missing step behind a working test. It DOES create a
//   per-committer book directory inside its own room, because that is custody:
//   no other principal reaches into it, readers come through group-read on the
//   parent.
//
//   It does not retry, does not queue, holds no timing policy, and decides
//   nothing about what a verdict means.

import { createHash, randomBytes } from "crypto";
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";

import {
  RecordBook,
  RecordBookRefused,
  recordChainId,
  RECORD_KINDS,
  type RecordKind,
} from "../record/record-book";
import {
  computeSealHash,
  PrecommitBook,
  PrecommitRefused,
  type AnchorStatus,
  type Expectation,
  type Modality,
  type PrecommitRecord,
  type Verdict,
} from "../precommit/precommit";
import type { NamedHeadCommit } from "../witness/types";
import {
  hashFileOrEmpty,
  legacyPointerDetail,
  loadRefusalLog,
  sealRefusalRecord,
} from "./refusal-log";
import type {
  RefusalLogLoadState,
  RefusalLogRecord,
  RefusalRecordBody,
} from "./refusal-log";

// -- the deposit -------------------------------------------------------------

/**
 * The acts a depositor may ask for. Closed.
 *
 * S134 Rb · THE LAST THREE GO TO A DIFFERENT BOOK, and that is the whole shape
 * of this change. The first three are pre-commitments and land in
 * `PrecommitBook`. `ESCALATION`, `REQUEST` and `PILOT_CHAIN_REVIEWED` have no
 * `ref`, no seal and no verdict — there is nothing for the pre-commitment
 * discipline to do with them — so they land in `RecordBook`. The DOOR is the
 * same door: owner-uid identity, the E.1 §2 table, the refusal log and frame
 * consumption are act-agnostic and carry these three unchanged. Only `append()`
 * forks.
 */
export type DepositAct =
  | "COMMITMENT"
  | "REVEAL"
  | "GRADING"
  | "ESCALATION"
  | "REQUEST"
  | "PILOT_CHAIN_REVIEWED";

export const DEPOSIT_ACTS: readonly DepositAct[] = [
  "COMMITMENT",
  "REVEAL",
  "GRADING",
  "ESCALATION",
  "REQUEST",
  "PILOT_CHAIN_REVIEWED",
];

/** True for the three acts the record book holds. */
export function isRecordAct(act: string): act is RecordKind {
  return (RECORD_KINDS as readonly string[]).includes(act);
}

/**
 * A COMMITMENT deposit carries the SEAL AND NOT THE PLAINTEXT.
 *
 * The committer computes the seal in its own process and keeps the envelope.
 * Ruling 2 (S98-B): a custodian holding plaintexts early would hold a secret
 * worth stealing and could shape behaviour around known predictions. See
 * `PrecommitBook.sealDeposited` for what this costs at the door — the salt
 * floor and the free-text refusal are the COMMITTER'S to keep, because they are
 * properties of a plaintext this path must never see.
 */
export interface CommitmentDeposit {
  readonly act: "COMMITMENT";
  readonly sealed: string;
}

/** A REVEAL carries the plaintext, because that is where the design puts it. */
export interface RevealDeposit {
  readonly act: "REVEAL";
  readonly ref: number;
  readonly expectation: Expectation;
}

export interface GradingDeposit {
  readonly act: "GRADING";
  readonly ref: number;
  readonly verdict: Verdict;
  readonly ground: string;
}

/**
 * An addressed header, on its way to the record book. R1′: a record exists only
 * when the header NAMES a seat. `addresseeVerbatim` rides beside the resolved
 * title because 1c removed that fold and the door does not re-introduce it.
 */
export interface AddressedDeposit {
  readonly act: "ESCALATION" | "REQUEST";
  readonly addressee: string;
  readonly addresseeVerbatim: string;
  readonly recordNeeded: string;
  readonly captureSha256: string;
  readonly runId: string;
  readonly scenarioId: string;
  readonly variant: string;
}

/** The arbiter's review of a pilot chain. The sha IS the link (Rb). */
export interface PilotChainReviewedDeposit {
  readonly act: "PILOT_CHAIN_REVIEWED";
  readonly chainSha256: string;
  readonly reviewLogSequenceNumber: number;
}

export type DepositBody =
  | CommitmentDeposit
  | RevealDeposit
  | GradingDeposit
  | AddressedDeposit
  | PilotChainReviewedDeposit;

/** What a depositor writes into the intake. */
export interface Deposit {
  /** Claimed. UNTRUSTED — checked against the file's owner uid. */
  readonly depositor: string;
  /** Whose book this is for. A bare principal name, never a path. */
  readonly book: string;
  readonly body: DepositBody;
  /** The depositor's declared modality for this entry (R8). */
  readonly modality: Modality;
  /** The depositor's wall clock. Cross-check arrow, never the ruling one. */
  readonly timestamp: number;
}

// -- refusal reasons — mechanical, never judgmental ---------------------------

export type RefusalReason =
  /**
   * THE FRAME COULD NOT BE READ, AND THAT IS NOT THE DEPOSITOR'S FAULT.
   *
   * Found live 2026-09-01, on the first real deposit: the registrar was not in
   * `mica-precommit-drops`, its own intake's carry-group, so frames landed
   * `<depositor>:mica-precommit-drops` 0640 and it could not open them. The
   * first version of this module called that MALFORMED_DEPOSIT and CONSUMED the
   * frame — blaming the depositor for a permission fact and then destroying a
   * perfectly good deposit.
   *
   * That is the same two-valued collapse this codebase already refuses in
   * `lookAtPrecommitFile`: "I was not allowed to look" is not "it is not there",
   * and here it is also not "you sent me rubbish". A frame under this reason is
   * NEVER consumed, because the deposit is fine and the deployment is not.
   */
  | "CANNOT_SEE_FRAME"
  /** It was gone before it could be opened. A race, not a finding. */
  | "FRAME_VANISHED"
  | "MALFORMED_DEPOSIT"
  | "UNKNOWN_DEPOSITOR"
  | "IDENTITY_MISMATCH"
  | "NOT_ENTITLED"
  | "WRONG_BOOK"
  | "SELF_GRADING"
  | "BOOK_REFUSED"
  | "BOOK_UNREADABLE"
  /**
   * THE DEPOSIT IS FINE AND THE DEPLOYMENT IS NOT — same species as
   * CANNOT_SEE_FRAME, and consumed for the same reason: never.
   *
   * A record-kind deposit arrived, correctly formed and correctly entitled, and
   * this registrar has no record-book root wired. Blaming the depositor for a
   * deployment fact and then destroying a good deposit is the two-valued
   * collapse this module refuses everywhere else.
   */
  | "RECORD_BOOK_NOT_WIRED";

export const REFUSAL_REASONS: readonly RefusalReason[] = [
  "CANNOT_SEE_FRAME",
  "FRAME_VANISHED",
  "MALFORMED_DEPOSIT",
  "UNKNOWN_DEPOSITOR",
  "IDENTITY_MISMATCH",
  "NOT_ENTITLED",
  "WRONG_BOOK",
  "SELF_GRADING",
  "BOOK_REFUSED",
  "BOOK_UNREADABLE",
  "RECORD_BOOK_NOT_WIRED",
];

/**
 * THE ENTITLEMENT TABLE, E.1 §2, held as data.
 *
 * A committer principal may deposit COMMITMENT and REVEAL into ITS OWN book and
 * nowhere else — authorship. The rostered graders may deposit GRADING — A9
 * ruling 4. Everything else is refused and logged.
 *
 * GRADERS ARE CONFIGURATION, NOT A LITERAL. The two names below are this
 * deployment's today; a roster that grows is a deployment act, and hard-coding
 * the list would put a governance decision in a source file.
 */
export interface Entitlements {
  readonly graders: readonly string[];
}

export const DEFAULT_GRADERS: readonly string[] = [
  "mica-doctor",
  "mica-arbiter",
];

export const THE_REGISTRAR_CERTIFIES_NOTHING =
  "The registrar records who deposited what, into which book, and what became " +
  "of the head. It does not certify that the claim is true, that the depositor " +
  "is honest, or that the grading is wise. It is a custodian, not a judge, and " +
  "the separation is the only thing it is actually for.";

export const IDENTITY_IS_THE_OWNER_UID =
  "A deposit's `depositor` field is a claim by whoever wrote the file. The " +
  "trusted identity is the file's OWNER UID, which the kernel sets. A deposit " +
  "whose claim disagrees with its uid is REFUSED, never normalised: a frame " +
  "claiming to be someone else is the most interesting thing that can arrive " +
  "here, and quietly correcting it would erase the evidence that it did.";

// -- outcomes ----------------------------------------------------------------

export interface RefusedDeposit {
  readonly outcome: "REFUSED";
  readonly reason: RefusalReason;
  readonly detail: string;
  /** The frame's filename. Never its contents: a refused deposit is not quoted. */
  readonly frame: string;
  readonly depositor: string | null;
}

export interface AcceptedDeposit {
  readonly outcome: "ACCEPTED";
  readonly frame: string;
  readonly depositor: string;
  readonly book: string;
  readonly act: DepositAct;
  /** The appended entry's sequence number in that book. */
  readonly sequenceNumber: number;
  readonly headHash: string;
  readonly anchor: AnchorStatus;
  /** The ANCHOR record's sequence number, or null when it could not be written. */
  readonly anchorSequenceNumber: number | null;
  readonly detail: string | null;
}

export type DepositOutcome = RefusedDeposit | AcceptedDeposit;

/**
 * Reasons that are facts about THIS BOX rather than about the deposit.
 *
 * A frame refused for one of these is LEFT ON THE INTAKE. The deposit is not at
 * fault and destroying it would lose a good record to a fixable misconfiguration
 * — which is exactly what happened on the first live deposit.
 *
 * THE COST, STATED: while the deployment stays broken, every sweep re-refuses
 * the frame and writes another log line. That is the right way round. A
 * registrar that cannot read its own intake SHOULD be noisy every minute until
 * somebody fixes it; tidying the log by deleting the evidence is the vacuous
 * all-clear wearing a broom.
 */
export const DEPLOYMENT_FACT_REASONS: readonly RefusalReason[] = [
  "CANNOT_SEE_FRAME",
  // S134 Rb. Same species, same treatment: the record book's root is a
  // deployment act, and a deposit refused because it has not been performed is
  // a fact about the box. Consuming the frame would destroy a good deposit over
  // a fixable misconfiguration — and the refusal detail promises it is left in
  // the intake, which is only true because this line is here.
  "RECORD_BOOK_NOT_WIRED",
];

/**
 * Whether one outcome reached the chained log.
 *
 * WHY THIS EXISTS (S102, the 16:11:58 finding): a sweep printed
 * "1 refused ... Refusals are outcomes, not failures" while the chained log was
 * broken and NOTHING was appended. The refusal was announced as booked and never
 * booked. The fact was retrievable from a getter and reached nobody.
 */
export interface FrameRecordResult {
  readonly frame: string;
  readonly recorded: boolean;
  /** Why the chained record was not written. Null when it was. */
  readonly reason: string | null;
}

export interface SweepResult {
  readonly seen: number;
  readonly outcomes: readonly DepositOutcome[];
  /**
   * Index-aligned with `outcomes`: did each one reach the chain?
   *
   * A CALLER THAT READS `outcomes` AND NOT THIS IS READING ANNOUNCEMENTS, NOT
   * RECORDS. That is the whole point of the field.
   */
  readonly records: readonly FrameRecordResult[];
  /** What the registrar found when it opened the chained log for this sweep. */
  readonly chainState: RefusalLogLoadState;
  /** How many outcomes reached the chain. Never assumed equal to `seen`. */
  readonly recordedCount: number;
}

// -- construction ------------------------------------------------------------

/** Resolve a deposit file's owner uid to a principal name, or null if unknown. */
export type PrincipalResolver = (uid: number) => string | null;

export interface RegistrarOptions {
  /** `/var/lib/mica/precommit` in the deployment. A deployment act; never made here. */
  readonly root: string;
  /**
   * `/var/lib/mica/record` in the deployment — the SECOND book's root (Rb), its
   * own deployment act, verified here and never made here.
   *
   * ABSENT MEANS NOT WIRED, and a record-kind deposit is then refused
   * `RECORD_BOOK_NOT_WIRED` with the frame LEFT IN THE INTAKE. That is the
   * honest default: this registrar behaves exactly as it did before S134 for the
   * three pre-commitment acts, and it does not eat a good deposit because a
   * deployer has not made a directory yet.
   */
  readonly recordRoot?: string;
  /** Written into every head this registrar drops. */
  readonly witnessSetId: string;
  readonly resolvePrincipal: PrincipalResolver;
  readonly entitlements?: Entitlements;
  /**
   * The witness drop. ABSENT MEANS NOT WIRED, and every entry is anchored
   * `NOT_DROPPED` — an absence of an act, recorded as one, never confused with
   * a drop that was attempted and failed.
   *
   * IT TAKES A `NamedHeadCommit` AS OF S105 (2026-09-03). This registrar is the
   * FIRST consumer of `chain_id` and the reason it exists: N books, one witness
   * set, one committer, and until now nothing on a dropped head said WHICH BOOK
   * it was the head of. The type is the enforcement — a five-key committer no
   * longer fits here, so the nameless path cannot be wired back in by accident.
   */
  readonly headCommitter?: (commit: NamedHeadCommit) => void;
  /**
   * The witness drop for THE REGISTRAR'S OWN REFUSAL CHAIN (S106). ABSENT MEANS
   * NOT WIRED, and no head for that chain is ever presented — an absence of an
   * act, and this one is not even recorded, for the reason ruling 2 gives below.
   *
   * ── WHY IT IS A SECOND COMMITTER AND NOT `headCommitter` REUSED `[LB]` ──────
   *
   *   THE DROP TARGET FILENAME IS THE SUBMITTER ID, and the intake is
   *   last-writer-wins. `sweep()` calls `consume()` — which presents the BOOK
   *   head — and then `log()` — which would present the REFUSAL head — inside
   *   the same loop iteration, microseconds apart. Through one committer both
   *   drops rename over one filename, and the book head is destroyed before the
   *   witness's next tick. Not a race: the book head goes first and therefore
   *   always loses, on every accepted deposit. Measured, S106 receipt §1.
   *
   *   So the two chains take two drop targets, which means two SUBMITTER IDS,
   *   which is a deployment decision (`registrard.ts --refusal-submitter-id`)
   *   and not one this code may make on a deployer's behalf. Absent here is the
   *   honest default: the registrar behaves exactly as it did before S106.
   *
   *   THE UNDERLYING LIMIT IS NOT FIXED BY THIS AND IS NOT MINE TO FIX: two
   *   chains cannot share one drop filename. This makes that fact configurable
   *   instead of silent. `[owed → board, S105 receipt §E.1]`
   */
  readonly refusalHeadCommitter?: (commit: NamedHeadCommit) => void;
  /** Injected clock. Production passes `Date.now`; a test passes a counter. */
  readonly now?: () => number;
}

/**
 * ── THE NAME THIS REGISTRAR GIVES ITS OWN CHAINS (S105) ──────────────────────
 *
 *   `<domain>:<owner>` — the suggested form, taken. The domain is `precommit`
 *   because that is what these chains ARE; the owner is the BOOK, because the
 *   book is the chain. One book, one chain, one name.
 *
 * ── THIS IS A SUBMITTER NAMING ITS OWN CHAIN, NOT A WITNESS DERIVING ONE ─────
 *
 *   R8 bars the WITNESS from deriving or defaulting `chain_id`. It does not bar
 *   a submitter from computing its own declaration — a submitter that could not
 *   would have nothing to declare. The registrar owns these books; naming them
 *   is the one party entitled to do it doing so, in the same breath as the drop.
 *
 * ── WHY IT CANNOT PRODUCE AN UNFRAMED NAME ───────────────────────────────────
 *
 *   `deposit.book` has already passed `isBarePrincipal` in `validateDeposit`
 *   before any deposit reaches the drop: at most 64 characters from
 *   `[A-Za-z0-9._-]`, no leading dot, no "..". Prefixed, that is at most 74
 *   characters, with no whitespace, no control character and no path separator
 *   — inside the intake's grammar with room to spare. The producer still
 *   asserts the grammar at the drop; this note is why that assertion is a
 *   backstop here and not the primary defence.
 */
export function precommitChainId(book: string): string {
  return `precommit:${book}`;
}

/**
 * ── THE REGISTRAR'S OWN CHAIN (S106, 2026-09-03) ─────────────────────────────
 *
 *   The refusal log is the registrar's second chain: it holds every outcome,
 *   accepted and refused, in one sequence. It has been chained since S102 and
 *   its head was witnessed for the first time on 2026-09-03 -- BY HAND, because
 *   until S105 no head could say which chain it belonged to and until this file
 *   nothing presented it.
 *
 *   `refusal` is the domain and `registrar` the owner: the same
 *   `<domain>:<owner>` grammar `precommitChainId` takes, and there is exactly
 *   one refusal chain per registrar, so the owner is the role and not a book.
 */
export const REFUSAL_CHAIN_ID = "refusal:registrar";

/**
 * ── THE MODALITY OF A REFUSAL-CHAIN HEAD. DECLARED, NOT DERIVED. ─────────────
 *
 *   **RULED BY THE ARBITER (arbiter), 2026-09-03, session 106.** `NOT_AN_INSTRUCTION`.
 *   The author is named here because that is the whole point of R8: a modality
 *   is somebody's DECLARATION, and a constant in a source file with no author
 *   beside it is a declaration nobody made.
 *
 *   The registrar cannot copy a modality here the way the deposit path does.
 *   That path carries `record.modality` -- the DEPOSITOR's own declaration about
 *   the act its entry records. A refusal-chain record has no depositor to speak
 *   for: it is the custodian writing down what it did with somebody's frame. No
 *   human instruction rides it, which is precisely what `NOT_AN_INSTRUCTION`
 *   says, and precisely what the machine-book deployers already declare (see
 *   `Modality` in ../witness/types).
 *
 *   IT IS A CONSTANT AND NOT A PARAMETER on purpose. A per-call modality here
 *   would be a value nobody is in a position to vary honestly: the refusal chain
 *   records one kind of act, and a knob would only make it possible to declare
 *   something false about it.
 */
export const REFUSAL_HEAD_MODALITY: Modality = "NOT_AN_INSTRUCTION";

/** Names that may become a directory or a filename inside the registrar's room. */
function isBarePrincipal(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 64 &&
    !name.startsWith(".") &&
    /^[A-Za-z0-9._-]+$/.test(name) &&
    !name.includes("..")
  );
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function hasExactKeys(
  o: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const own = Object.keys(o);
  if (own.length !== keys.length) return false;
  return keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

const MODALITIES: readonly Modality[] = [
  "OFFERED",
  "IMPOSED",
  "NOT_AN_INSTRUCTION",
];
const VERDICTS: readonly Verdict[] = ["GREEN", "RED", "CANNOT_ASSESS"];

/** Closed-shape validation of a deposit frame. Returns null, never throws. */
export function validateDeposit(x: unknown): Deposit | null {
  if (!isObject(x)) return null;
  if (!hasExactKeys(x, ["depositor", "book", "body", "modality", "timestamp"])) {
    return null;
  }
  if (typeof x.depositor !== "string" || !isBarePrincipal(x.depositor)) {
    return null;
  }
  if (typeof x.book !== "string" || !isBarePrincipal(x.book)) return null;
  if (typeof x.modality !== "string") return null;
  if (!MODALITIES.includes(x.modality as Modality)) return null;
  if (typeof x.timestamp !== "number" || !Number.isSafeInteger(x.timestamp)) {
    return null;
  }
  if (!isObject(x.body)) return null;
  const b = x.body;
  if (typeof b.act !== "string") return null;
  if (b.act === "COMMITMENT") {
    if (!hasExactKeys(b, ["act", "sealed"])) return null;
    if (typeof b.sealed !== "string") return null;
  } else if (b.act === "REVEAL") {
    if (!hasExactKeys(b, ["act", "ref", "expectation"])) return null;
    if (typeof b.ref !== "number" || !Number.isSafeInteger(b.ref) || b.ref < 0) {
      return null;
    }
    if (!isObject(b.expectation)) return null;
  } else if (b.act === "GRADING") {
    if (!hasExactKeys(b, ["act", "ref", "verdict", "ground"])) return null;
    if (typeof b.ref !== "number" || !Number.isSafeInteger(b.ref) || b.ref < 0) {
      return null;
    }
    if (typeof b.verdict !== "string") return null;
    if (!VERDICTS.includes(b.verdict as Verdict)) return null;
    if (typeof b.ground !== "string") return null;
  } else if (b.act === "ESCALATION" || b.act === "REQUEST") {
    // S134 Rb. Closed shape, refused rather than repaired — the same rule the
    // three pre-commitment acts above are held to.
    if (!hasExactKeys(b, [
      "act", "addressee", "addresseeVerbatim", "recordNeeded",
      "captureSha256", "runId", "scenarioId", "variant",
    ])) {
      return null;
    }
    for (const k of ["addressee", "addresseeVerbatim", "recordNeeded", "runId", "scenarioId", "variant"]) {
      if (typeof b[k] !== "string" || (b[k] as string).length === 0) return null;
    }
    if (typeof b.captureSha256 !== "string" || !/^[0-9a-f]{64}$/.test(b.captureSha256)) {
      return null;
    }
  } else if (b.act === "PILOT_CHAIN_REVIEWED") {
    if (!hasExactKeys(b, ["act", "chainSha256", "reviewLogSequenceNumber"])) return null;
    if (typeof b.chainSha256 !== "string" || !/^[0-9a-f]{64}$/.test(b.chainSha256)) {
      return null;
    }
    if (
      typeof b.reviewLogSequenceNumber !== "number" ||
      !Number.isSafeInteger(b.reviewLogSequenceNumber) ||
      b.reviewLogSequenceNumber < 0
    ) {
      return null;
    }
  } else {
    return null;
  }
  return x as unknown as Deposit;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 400);
}

function requireDir(dir: string, what: string): void {
  let stats;
  try {
    stats = statSync(dir);
  } catch (err) {
    throw new Error(
      `${what} is absent at ${dir}. This is a DEPLOYMENT ACT at stated modes ` +
        `(deploy recipe, registrar section) and nothing here creates it: a ` +
        `custodian that made its own room would make it with the wrong ` +
        `permissions and hide a missing step behind a working test. ` +
        `(${String(err)})`
    );
  }
  if (!stats.isDirectory()) {
    throw new Error(`${what} at ${dir} exists and is not a directory.`);
  }
}

// -- the registrar -----------------------------------------------------------

export class Registrar {
  private readonly root: string;
  private readonly recordRoot: string | null;
  private readonly intakeDir: string;
  private readonly witnessSetId: string;
  private readonly resolvePrincipal: PrincipalResolver;
  private readonly graders: readonly string[];
  private readonly headCommitter?: (commit: NamedHeadCommit) => void;
  private readonly refusalHeadCommitter?: (commit: NamedHeadCommit) => void;
  private readonly now: () => number;
  /**
   * The uid the KERNEL reported for the frame currently being consumed, or null
   * when no frame could be stat'd. Reset at the top of every consume() and set
   * only from statSync -- it is an observation, never a claim, and it exists so
   * the chained record can carry the uid as a FIELD instead of losing it inside
   * a prose detail string.
   */
  private observedUid: number | null = null;
  private logProblem: string | null = null;

  constructor(options: RegistrarOptions) {
    this.root = options.root;
    this.recordRoot = options.recordRoot ?? null;
    this.intakeDir = join(options.root, "intake");
    this.witnessSetId = options.witnessSetId;
    this.resolvePrincipal = options.resolvePrincipal;
    this.graders = options.entitlements?.graders ?? DEFAULT_GRADERS;
    this.headCommitter = options.headCommitter;
    this.refusalHeadCommitter = options.refusalHeadCommitter;
    this.now = options.now ?? Date.now;
    // THE DEPLOYMENT ACTS ARE VERIFIED, NEVER PERFORMED. Same discipline as
    // the book's own `requirePrecommitStoreDir`.
    requireDir(this.root, "the registrar store root");
    requireDir(this.intakeDir, "the registrar intake");
    if (this.recordRoot !== null) {
      requireDir(this.recordRoot, "the record book root");
    }
  }

  /** Where a principal's RECORD book lives (Rb). Bare names only, as above. */
  recordBookPath(book: string): string {
    if (this.recordRoot === null) {
      throw new Error(
        "no record book root was wired; this registrar cannot name a record book path."
      );
    }
    if (!isBarePrincipal(book)) {
      throw new Error(`not a bare principal name: ${JSON.stringify(book)}`);
    }
    return join(this.recordRoot, book, "records.jsonl");
  }

  /** True when the second book is wired at all. */
  get hasRecordBook(): boolean {
    return this.recordRoot !== null;
  }

  /** Where a committer's book lives. Bare names only, checked before use. */
  bookPath(committerId: string): string {
    if (!isBarePrincipal(committerId)) {
      throw new Error(
        `not a bare principal name: ${JSON.stringify(committerId)}`
      );
    }
    return join(this.root, committerId, "book.jsonl");
  }

  /** True when this registrar has a witness drop wired at all. */
  get hasHeadCommitter(): boolean {
    return this.headCommitter !== undefined;
  }

  /** True when the REFUSAL chain's head is presented at all (S106). */
  get hasRefusalHeadCommitter(): boolean {
    return this.refusalHeadCommitter !== undefined;
  }

  logPath(): string {
    return join(this.root, "registrar-log.jsonl");
  }

  /**
   * The CHAINED log. A separate file from the legacy one on purpose: the old
   * file is retained in place and pinned by hash in seq 0, never rewritten and
   * never renamed (see LegacyPointerRecord).
   */
  chainedLogPath(): string {
    return join(this.root, "registrar-log-chained.jsonl");
  }

  /**
   * ── PRESENT THE REFUSAL CHAIN'S HEAD. BEST-EFFORT, NEVER BLOCKING (S106) ────
   *
   *   **RULED BY THE ARBITER (arbiter), 2026-09-03, session 106, ruling 2.** A drop
   *   failure MUST NOT change `log()`'s return, MUST NOT throw into the sweep,
   *   and MUST NOT add a failure mode to the log itself.
   *
   *   THE DEPOSIT PATH DOES THE OPPOSITE, and the difference is the point. There
   *   a failed drop becomes a `CANNOT_SEE` anchor — a RECORD, inside the book,
   *   saying the attempt was made and did not land. Here there is no such
   *   record and there must not be: the only book this could be written into is
   *   the refusal log itself, and a chain that appends a record about its own
   *   head-drop failing is a chain whose length depends on the witness being
   *   reachable. One unreachable intake would then grow the log every minute,
   *   and each of those records would itself trigger a drop, and fail, and
   *   append. The refusal log's own posture — "a log that cannot be written must
   *   not swallow the sweep" — read one layer out.
   *
   *   SO THE FAILURE IS LOCALLY VISIBLE AND NOT SELF-ATTESTED. One line on
   *   stderr, which under the unit is one line in the journal, naming the chain
   *   and the error. It is not evidence and does not pretend to be: nothing
   *   signs it, nothing chains it, and a reader who does not have the journal
   *   will not know it happened.
   *
   *   THAT LEAVES A REAL HOLE, NAMED RATHER THAN PAPERED OVER: a refusal chain
   *   whose head silently stops arriving looks exactly like a refusal chain
   *   nobody has appended to. Detecting the difference is the WITNESS side's
   *   job — an expected-cadence check on the reader, parked as DC-2 — and it is
   *   deliberately not attempted here, because a producer that certifies its own
   *   liveness is the thing this whole instrument exists to disbelieve.
   */
  private presentRefusalHead(record: RefusalLogRecord): void {
    if (this.refusalHeadCommitter === undefined) return;
    try {
      this.refusalHeadCommitter({
        seq_no: record.seq,
        head_hash: record.hash,
        // The registrar's other drop site passes its record's sequence number
        // here too (see the deposit path). Kept identical on purpose: one
        // producer, two chains, one reading of this field. That both sites put
        // a SEQUENCE NUMBER in a field named `ts` is a pre-existing oddity of
        // this producer, not something introduced here — S106 receipt §E.
        // RULED (the arbiter, S107): "ts carries the chain sequence number at these
        // sites." Comment only — no behavior change.
        ts: record.seq,
        witness_set_id: this.witnessSetId,
        modality: REFUSAL_HEAD_MODALITY,
        chain_id: REFUSAL_CHAIN_ID,
      });
    } catch (err) {
      // SWALLOWED ON PURPOSE, and this is the only place in this file where
      // that sentence is true. Ruling 2: the refusal record is already durable
      // and its outcome is already decided; nothing about presenting a head may
      // reach back and change either.
      process.stderr.write(
        `mica-registrar: the head of ${REFUSAL_CHAIN_ID} at seq ${String(record.seq)} ` +
          `could not be presented: ${oneLine(String(err))}. The refusal record ` +
          `IS on disk and the sweep is unaffected. This line is not evidence: ` +
          `nothing signs or chains it.\n`
      );
    }
  }

  /**
   * Why the last append to the chained log did not happen, or null.
   *
   * The old `log()` swallowed every failure silently. It still must not throw --
   * a log that cannot be written must not swallow the sweep -- but a REFUSAL TO
   * EXTEND A BROKEN CHAIN is a finding, and a finding that reaches nobody is
   * the thing this whole module is about. [owed] threading it into SweepResult
   * so the daemon prints it; a getter is where this build stops.
   */
  lastRefusalLogProblem(): string | null {
    return this.logProblem;
  }

  /**
   * One sweep of the intake, in lexical order. A name beginning with `.` is an
   * in-flight frame and is not consumed — the same channel framing the witness
   * intake uses, and for the same reason.
   */
  sweep(): SweepResult {
    let names: string[];
    try {
      names = readdirSync(this.intakeDir).sort();
    } catch (err) {
      throw new Error(
        `the registrar cannot read its intake at ${this.intakeDir}: ` +
          `${String(err)}. That is a deployment fact, not a deposit, and it ` +
          `must not be reported as an empty intake.`
      );
    }
    // ONE READING OF THE CHAIN, TAKEN BEFORE ANYTHING IS SWEPT, so the sweep can
    // report the state it actually opened rather than a state inferred from
    // whether writes happened to succeed.
    const chainState = loadRefusalLog(this.chainedLogPath()).loadState;

    const outcomes: DepositOutcome[] = [];
    const records: FrameRecordResult[] = [];
    let seen = 0;
    for (const name of names) {
      if (name.startsWith(".")) continue;
      seen++;
      const outcome = this.consume(name);
      outcomes.push(outcome);
      const logged = this.log(outcome);
      records.push({ frame: name, recorded: logged.recorded, reason: logged.reason });
      // CONSUMED FOR ANYTHING THAT IS ABOUT THE DEPOSIT — a malformed frame, an
      // unentitled one, one the book refused. Left on the intake would mean
      // re-refusing it every sweep forever, and one bad deposit growing the log
      // without bound. The refusal is recorded; the frame goes.
      //
      // NOT CONSUMED when the refusal was a fact about this box. See
      // DEPLOYMENT_FACT_REASONS: the deposit is fine, and deleting it would
      // destroy a good record over a fixable misconfiguration. Fix the box and
      // the next sweep takes it.
      if (
        outcome.outcome === "REFUSED" &&
        DEPLOYMENT_FACT_REASONS.includes(outcome.reason)
      ) {
        continue;
      }
      // AND NOT CONSUMED WHEN THE RECORD DID NOT REACH THE CHAIN (S102).
      //
      // The registrar's own rule, applied to a case it did not yet cover: a
      // frame refused for a fact about the BOX is never consumed. A refusal log
      // that cannot be extended is a fact about the box. Consuming here would
      // destroy the frame AND leave no record of it — the deposit gone and its
      // refusal unwritten, which is the one combination that loses evidence in
      // both directions at once. It stays; the next healthy sweep records it.
      if (!records[records.length - 1].recorded) {
        continue;
      }
      try {
        rmSync(join(this.intakeDir, name), { force: true });
      } catch {
        // A frame that cannot be removed is itself a deployment fact. It stays,
        // and the next sweep refuses it again — visibly, in the log.
      }
    }
    return {
      seen,
      outcomes,
      records,
      chainState,
      recordedCount: records.filter((r) => r.recorded).length,
    };
  }

  private consume(frame: string): DepositOutcome {
    // An observation from the previous frame must never be attributed to this
    // one. Cleared here so a stat failure below leaves it null rather than stale.
    this.observedUid = null;
    const path = join(this.intakeDir, frame);

    let uid: number;
    let raw: string;
    try {
      uid = statSync(path).uid;
      this.observedUid = uid;
      raw = readFileSync(path, "utf8");
    } catch (err) {
      // THREE-VALUED, like every other look in this codebase. ENOENT is the one
      // errno that means the frame is not there; everything else means this
      // process could not get at a frame that IS there, which is a fact about
      // the deployment and never a fact about the deposit.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return {
          outcome: "REFUSED",
          reason: "FRAME_VANISHED",
          detail: "the frame was gone before it could be opened",
          frame,
          depositor: null,
        };
      }
      return {
        outcome: "REFUSED",
        reason: "CANNOT_SEE_FRAME",
        detail:
          `the registrar could not READ the frame (${code ?? "no errno"}): ` +
          `${oneLine(String(err))}. This is a fact about this box, not about ` +
          `the deposit — check that the registrar is in the intake's carry ` +
          `group, the way the witness is in mica-drops. The frame is LEFT ` +
          `where it is.`,
        frame,
        depositor: null,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return {
        outcome: "REFUSED",
        reason: "MALFORMED_DEPOSIT",
        detail: `not JSON: ${oneLine(String(err))}`,
        frame,
        depositor: null,
      };
    }

    const deposit = validateDeposit(parsed);
    if (deposit === null) {
      return {
        outcome: "REFUSED",
        reason: "MALFORMED_DEPOSIT",
        detail: "the frame does not match the closed deposit schema",
        frame,
        depositor: null,
      };
    }

    // -- IDENTITY. The uid is the fact; the field is the claim. --------------
    const owner = this.resolvePrincipal(uid);
    if (owner === null) {
      return {
        outcome: "REFUSED",
        reason: "UNKNOWN_DEPOSITOR",
        detail: `uid ${String(uid)} is not in the registrar's roster`,
        frame,
        depositor: null,
      };
    }
    if (owner !== deposit.depositor) {
      return {
        outcome: "REFUSED",
        reason: "IDENTITY_MISMATCH",
        detail:
          `the frame claims depositor ${JSON.stringify(deposit.depositor)} ` +
          `and is owned by ${JSON.stringify(owner)}. ` +
          IDENTITY_IS_THE_OWNER_UID,
        frame,
        depositor: owner,
      };
    }

    // -- ENTITLEMENT (E.1 §2). -----------------------------------------------
    const act = deposit.body.act;
    if (act === "GRADING") {
      if (!this.graders.includes(owner)) {
        return {
          outcome: "REFUSED",
          reason: "NOT_ENTITLED",
          detail:
            `${owner} is not a grader. A9 ruling 4: the doctor and/or the ` +
            `arbiter grade. Rostered: ${this.graders.join(", ")}.`,
          frame,
          depositor: owner,
        };
      }
      // Ruling 4 at the door, in front of the same check the book makes in
      // code. Belt and braces: the code check is the one already proven at
      // bytes, and this one refuses before any book is opened.
      if (owner === deposit.book) {
        return {
          outcome: "REFUSED",
          reason: "SELF_GRADING",
          detail:
            `${owner} may not grade in its own book. The committer never ` +
            `grades its own commitment.`,
          frame,
          depositor: owner,
        };
      }
    } else if (owner !== deposit.book) {
      // S134 Rb: OWN-BOOK ONLY for every depositor and every one of these acts.
      // `mica-subject1` escalates into its own book; `mica-arbiter` records its
      // review into its own. There is NO cross-book arm — the chain sha in a
      // PILOT_CHAIN_REVIEWED body is the link to what was reviewed, so writing
      // into somebody else's book would buy nothing and cost the one property
      // this door has: the book a record is in names who was entitled to put it
      // there.
      return {
        outcome: "REFUSED",
        reason: "WRONG_BOOK",
        detail:
          `${owner} deposited a ${act} into ${deposit.book}'s book. ` +
          `COMMITMENT, REVEAL, ESCALATION, REQUEST and PILOT_CHAIN_REVIEWED go ` +
          `into the depositor's OWN book and nowhere else; only a GRADING names ` +
          `another principal's book.`,
        frame,
        depositor: owner,
      };
    }

    return this.append(frame, owner, deposit);
  }

  private append(
    frame: string,
    owner: string,
    deposit: Deposit
  ): DepositOutcome {
    // S134 Rb · THE FORK, AND IT IS THE ONLY ONE. Everything above this line ran
    // identically for all six acts: the frame was read, the identity came from
    // the owner uid, the entitlement table spoke. What differs below is which
    // book has a shape to hold the record.
    if (isRecordAct(deposit.body.act)) {
      return this.appendToRecordBook(frame, owner, deposit);
    }
    const path = this.bookPath(deposit.book);
    // THE BOOK DIRECTORY IS CUSTODY, NOT A DEPLOYMENT ACT. No other principal
    // must enter it — readers come through group-read on the parent, which IS a
    // deployment act and was verified in the constructor. That is the S96-D
    // discriminator applied, not waived.
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o2750 });
      appendFileSync(path, "", { mode: 0o640 });
    } catch (err) {
      return {
        outcome: "REFUSED",
        reason: "BOOK_UNREADABLE",
        detail: `cannot open the book: ${oneLine(String(err))}`,
        frame,
        depositor: owner,
      };
    }

    let book: PrecommitBook;
    try {
      book = new PrecommitBook({ path, witnessSetId: this.witnessSetId });
    } catch (err) {
      return {
        outcome: "REFUSED",
        reason: "BOOK_UNREADABLE",
        detail: `the book would not open: ${oneLine(String(err))}`,
        frame,
        depositor: owner,
      };
    }
    if (book.getLoadState() === "CANNOT_VERIFY") {
      return {
        outcome: "REFUSED",
        reason: "BOOK_UNREADABLE",
        detail: `the book does not verify: ${oneLine(
          String(book.getLastError())
        )}`,
        frame,
        depositor: owner,
      };
    }

    let record: PrecommitRecord;
    let detail: string | null;
    try {
      const body = deposit.body;
      if (body.act === "COMMITMENT") {
        const out = book.sealDeposited({
          sealed: body.sealed,
          committerId: deposit.book,
          timestamp: deposit.timestamp,
          modality: deposit.modality,
        });
        record = out.record;
        detail = out.detail;
      } else if (body.act === "REVEAL") {
        const out = book.reveal({
          ref: body.ref,
          expectation: body.expectation,
          timestamp: deposit.timestamp,
          modality: deposit.modality,
        });
        record = out.record;
        detail = out.detail;
      } else if (body.act === "GRADING") {
        const out = book.grade({
          ref: body.ref,
          // THE GRADER IS THE OWNER UID'S PRINCIPAL, never a field of the
          // deposit. A grading is the one record that names someone other than
          // the book's owner, so it is the one place a forged name would do the
          // most damage.
          graderId: owner,
          verdict: body.verdict,
          ground: body.ground,
          timestamp: deposit.timestamp,
          modality: deposit.modality,
        });
        record = out.record;
        detail = out.detail;
      } else {
        // UNREACHABLE BY CONSTRUCTION, and it says so rather than falling
        // through: `append()` routed every record act away before this line, so
        // the only way here is a SEVENTH act added to the enum and to neither
        // branch. A silent fall-through would drop such a deposit on the floor
        // after accepting it at the door.
        throw new Error(
          `the pre-commitment branch was handed ${JSON.stringify(deposit.body.act)}, ` +
            `which is neither a pre-commitment act nor a record act. A new act was ` +
            `added to DepositAct and to no book.`
        );
      }
    } catch (err) {
      return {
        outcome: "REFUSED",
        reason:
          err instanceof PrecommitRefused ? "BOOK_REFUSED" : "BOOK_UNREADABLE",
        detail: oneLine(String(err instanceof Error ? err.message : err)),
        frame,
        depositor: owner,
      };
    }

    // -- THE HEAD, THEN THE ANCHOR. The order is argued in
    //    THE_ANCHOR_IS_A_RECORD_NOT_A_FIELD: the entry is durable BEFORE any
    //    head is presented, so no head is committed for a record that does not
    //    exist. The anchor then says what happened, inside the chain.
    let status: AnchorStatus = "NOT_DROPPED";
    let droppedAt = 0;
    let anchorDetail = "";
    if (this.headCommitter !== undefined) {
      try {
        this.headCommitter({
          seq_no: record.sequenceNumber,
          head_hash: record.hash,
          // RULED (the arbiter, S107): "ts carries the chain sequence number at
          // these sites." (The other of the two — see presentRefusalHead
          // above, where the same reading is recorded.) Comment only.
          ts: record.sequenceNumber,
          witness_set_id: this.witnessSetId,
          modality: record.modality,
          chain_id: precommitChainId(deposit.book),
        });
        status = "DROPPED";
        droppedAt = this.now();
      } catch (err) {
        status = "CANNOT_SEE";
        anchorDetail = oneLine(String(err));
      }
    }

    let anchorSequenceNumber: number | null = null;
    try {
      const anchored = book.anchor({
        ref: record.sequenceNumber,
        status,
        droppedAt,
        headHash: record.hash,
        detail: anchorDetail,
        timestamp: this.now(),
        modality: record.modality,
      });
      anchorSequenceNumber = anchored.record.sequenceNumber;
    } catch (err) {
      // The entry is already durable. An anchor that cannot be written leaves
      // that entry readable as NOT_ANCHORED — a finding a reader can make, and
      // not the same as an entry claiming a drop that never happened.
      detail =
        `${detail === null ? "" : detail + " "}the anchor could not be ` +
        `written: ${oneLine(String(err))}`;
    }

    return {
      outcome: "ACCEPTED",
      frame,
      depositor: owner,
      book: deposit.book,
      act: deposit.body.act,
      sequenceNumber: record.sequenceNumber,
      headHash: record.hash,
      anchor: status,
      anchorSequenceNumber,
      detail,
    };
  }

  /**
   * S134 Rb · the second book's append.
   *
   * SHORTER THAN ITS SIBLING BY EXACTLY WHAT IT DOES NOT DO. There is no `ref`
   * to resolve — these records point at a capture sha or a chain sha, never at
   * an earlier entry of their own book. There is no seal to check. And there is
   * NO ANCHOR RECORD, because Rb closed this book's kinds at three: the head's
   * outcome is REPORTED in the outcome below and is not written into the chain.
   * That gap is named-head-owed and argued in the S134 beat-2 receipt rather
   * than decided quietly here.
   */
  private appendToRecordBook(
    frame: string,
    owner: string,
    deposit: Deposit
  ): DepositOutcome {
    if (this.recordRoot === null) {
      // NOT CONSUMED. The deposit is fine; the deployment is not.
      return {
        outcome: "REFUSED",
        reason: "RECORD_BOOK_NOT_WIRED",
        detail:
          `a ${deposit.body.act} arrived and this registrar has no record book ` +
          `root wired, so there is nowhere to put it. The frame is LEFT IN THE ` +
          `INTAKE: a deployment act that has not happened is not a fault of the ` +
          `depositor, and consuming a good deposit over it would destroy the ` +
          `evidence of both.`,
        frame,
        depositor: owner,
      };
    }
    const path = this.recordBookPath(deposit.book);
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o2750 });
      appendFileSync(path, "", { mode: 0o640 });
    } catch (err) {
      return {
        outcome: "REFUSED",
        reason: "BOOK_UNREADABLE",
        detail: `cannot open the record book: ${oneLine(String(err))}`,
        frame,
        depositor: owner,
      };
    }

    let book: RecordBook;
    try {
      book = new RecordBook({ path });
    } catch (err) {
      return {
        outcome: "REFUSED",
        reason: "BOOK_UNREADABLE",
        detail: `the record book would not open: ${oneLine(String(err))}`,
        frame,
        depositor: owner,
      };
    }
    if (book.getLoadState() === "CANNOT_VERIFY") {
      return {
        outcome: "REFUSED",
        reason: "BOOK_UNREADABLE",
        detail: `the record book does not verify: ${oneLine(String(book.getLastError()))}`,
        frame,
        depositor: owner,
      };
    }

    let record: { readonly sequenceNumber: number; readonly hash: string };
    let detail: string | null;
    try {
      const body = deposit.body;
      if (body.act === "PILOT_CHAIN_REVIEWED") {
        const out = book.writeReviewed({
          // THE DEPOSITOR IS THE OWNER UID'S PRINCIPAL, never a field of the
          // deposit — the same rule `grade` is held to, and for the same reason:
          // the depositor's name is the one thing a forged frame would most want
          // to choose.
          depositor: owner,
          book: deposit.book,
          timestamp: deposit.timestamp,
          modality: deposit.modality,
          chainSha256: body.chainSha256,
          reviewLogSequenceNumber: body.reviewLogSequenceNumber,
        });
        record = out.record;
        detail = out.detail;
      } else if (body.act === "ESCALATION" || body.act === "REQUEST") {
        const out = book.writeAddressed({
          kind: body.act,
          depositor: owner,
          book: deposit.book,
          timestamp: deposit.timestamp,
          modality: deposit.modality,
          addressee: body.addressee,
          addresseeVerbatim: body.addresseeVerbatim,
          recordNeeded: body.recordNeeded,
          captureSha256: body.captureSha256,
          runId: body.runId,
          scenarioId: body.scenarioId,
          variant: body.variant,
        });
        record = out.record;
        detail = out.detail;
      } else {
        throw new Error(
          `the record branch was handed ${JSON.stringify(deposit.body.act)}, which ` +
            `isRecordAct admitted and this switch does not build. RECORD_KINDS and ` +
            `this branch have drifted apart.`
        );
      }
    } catch (err) {
      return {
        outcome: "REFUSED",
        reason: err instanceof RecordBookRefused ? "BOOK_REFUSED" : "BOOK_UNREADABLE",
        detail: oneLine(String(err instanceof Error ? err.message : err)),
        frame,
        depositor: owner,
      };
    }

    // THE HEAD, UNDER THIS BOOK'S OWN CHAIN ID. `record:<book>`, never
    // `precommit:<book>`: the two chains carry independent sequence numbers, and
    // one namespace over both would present two different records as seq N of
    // one chain at the witness.
    let status: AnchorStatus = "NOT_DROPPED";
    let headDetail = "";
    if (this.headCommitter !== undefined) {
      try {
        this.headCommitter({
          seq_no: record.sequenceNumber,
          head_hash: record.hash,
          ts: record.sequenceNumber,
          witness_set_id: this.witnessSetId,
          modality: deposit.modality,
          chain_id: recordChainId(deposit.book),
        });
        status = "DROPPED";
      } catch (err) {
        status = "CANNOT_SEE";
        headDetail = oneLine(String(err));
      }
    }

    return {
      outcome: "ACCEPTED",
      frame,
      depositor: owner,
      book: deposit.book,
      act: deposit.body.act,
      sequenceNumber: record.sequenceNumber,
      headHash: record.hash,
      anchor: status,
      // NULL MEANS "THIS BOOK WRITES NO ANCHOR RECORD" — not "the anchor failed".
      // A reader comparing the two books must not read this absence as the
      // pre-commitment book's could-not-write-the-anchor.
      anchorSequenceNumber: null,
      detail:
        headDetail === ""
          ? detail
          : `${detail === null ? "" : detail + " "}the head could not be presented: ${headDetail}`,
    };
  }

  /**
   * The registrar log: APPEND-ONLY AND HASH-CHAINED, one record per outcome,
   * accepts and refusals in ONE sequence (never two chains).
   *
   * Until S102 this wrote `{at, ...outcome}` as a plain line. The S99 receipt
   * named the defect in its own section E.6: a log, not a chain, in the
   * custodian's own pocket. Any middle edit, reorder or deletion now breaks
   * verify(). A tail truncation still does not, and REFUSAL_LOG_ATTESTS says so.
   */
  private log(outcome: DepositOutcome): { recorded: boolean; reason: string | null } {
    this.logProblem = null;
    const uid = this.observedUid;
    try {
      const path = this.chainedLogPath();
      const look = loadRefusalLog(path);
      let prior: readonly RefusalLogRecord[] = look.records;

      if (look.loadState === "ABSENT" || look.loadState === "EMPTY") {
        // OPEN THE CHAIN with the legacy pointer. The old file is read for its
        // hash and otherwise left exactly where it is.
        const legacy = hashFileOrEmpty(this.logPath());
        const seed = sealRefusalRecord([], {
          kind: "LEGACY_POINTER",
          ts: this.now(),
          legacyPath: this.logPath(),
          legacyHash: legacy.hash,
          legacyBytes: legacy.bytes,
          detail: legacyPointerDetail(
            this.logPath(),
            legacy.hash,
            legacy.bytes
          ),
        });
        appendFileSync(path, JSON.stringify(seed) + "\n", { mode: 0o640 });
        prior = [seed];
      } else if (look.loadState !== "LOADED_VERIFIED") {
        // DO NOT EXTEND A CHAIN THAT DOES NOT VERIFY.
        //
        // Appending here would seal a new record onto a prefix this code could
        // not read, giving a broken chain a fresh, well-formed tail and making
        // the break look older than the records after it. The refusal is
        // recorded on the instance and the sweep still returns its outcome: a
        // log that cannot be written must not swallow the sweep.
        this.logProblem =
          `the chained refusal log at ${path} reads ${look.loadState}` +
          `${look.problem === null ? "" : ` (${look.problem})`}. NOTHING WAS ` +
          `APPENDED: extending a chain that does not verify would give it a ` +
          `clean tail and move the apparent break later.`;
        return { recorded: false, reason: this.logProblem };
      }

      const body: RefusalRecordBody =
        outcome.outcome === "REFUSED"
          ? {
              kind: "REFUSED",
              ts: this.now(),
              reason: outcome.reason,
              subject: outcome.depositor,
              subjectUid: uid,
              frame: outcome.frame,
              detail: outcome.detail,
            }
          : {
              kind: "ACCEPTED",
              ts: this.now(),
              subject: outcome.depositor,
              subjectUid: uid,
              frame: outcome.frame,
              book: outcome.book,
              bookSeq: outcome.sequenceNumber,
              headHash: outcome.headHash,
              detail: outcome.detail ?? "",
            };

      const record = sealRefusalRecord(prior, body);
      appendFileSync(path, JSON.stringify(record) + "\n", { mode: 0o640 });
      // DURABLE FIRST, THEN PRESENT. The same order the deposit path argues at
      // THE_ANCHOR_IS_A_RECORD_NOT_A_FIELD: no head is presented for a record
      // that does not exist. `presentRefusalHead` cannot throw — see its body —
      // so this line cannot reach the catch below and turn a written record into
      // a `recorded: false`.
      this.presentRefusalHead(record);
      return { recorded: true, reason: null };
    } catch (err) {
      // Unchanged posture: the outcome is still returned to the caller, which is
      // what the daemon prints. What changed is that the reason is now readable
      // instead of discarded.
      this.logProblem = `the chained refusal log could not be written: ${String(err)}`;
      return { recorded: false, reason: this.logProblem };
    }
  }
}

// -- B3 · the depositor's writer ---------------------------------------------

/**
 * Write one deposit into a registrar intake, atomically.
 *
 * Write-temp-then-rename INSIDE THE SAME DIRECTORY, and names beginning with
 * `.` are in-flight frames the sweep does not consume — taken verbatim in
 * intent from `drop-committer.ts`, which had it first and was right to. A
 * sweeper reading a torn half-write would refuse a MALFORMED_DEPOSIT the
 * depositor never produced, and that refusal is not correctable: it lands in an
 * append-only log.
 *
 * `chmod` rather than the `mode` option, for drop-committer's reason:
 * `writeFileSync`'s mode is masked by the caller's umask and `chmodSync` is
 * not, so a depositor under `umask 0077` cannot silently produce a frame the
 * registrar may not read.
 */
export function writeDeposit(
  intakeDir: string,
  deposit: Deposit,
  seam: {
    readonly rename?: typeof renameSync;
    readonly suffix?: () => string;
  } = {}
): string {
  if (!isBarePrincipal(deposit.depositor)) {
    throw new Error("depositor must be a bare principal name");
  }
  const rename = seam.rename ?? renameSync;
  const suffix = seam.suffix ?? (() => randomBytes(8).toString("hex"));
  const stamp = suffix();
  const target = join(intakeDir, `${deposit.depositor}.${stamp}.json`);
  const frame = join(intakeDir, `.${deposit.depositor}.${stamp}.json`);
  writeFileSync(frame, JSON.stringify(deposit), "utf8");
  try {
    chmodSync(frame, 0o640);
    rename(frame, target);
  } catch (err) {
    try {
      rmSync(frame, { force: true });
    } catch {
      // Best effort. An in-flight name is never consumed by a sweep.
    }
    throw err;
  }
  return target;
}

/**
 * The committer's half of the vest: hash the envelope HERE, keep the envelope,
 * deposit sixty-four hex characters. Offered so that nobody writes their own
 * and gets the domain tag wrong.
 */
export function sealForDeposit(expectation: Expectation): string {
  return computeSealHash(expectation);
}

/** A roster-backed principal resolver, for the daemon. */
export function rosterResolver(
  roster: ReadonlyMap<number, string>
): PrincipalResolver {
  return (uid: number) => roster.get(uid) ?? null;
}

/** Short digest of the entitlement configuration, for a receipt to quote. */
export function entitlementFingerprint(graders: readonly string[]): string {
  return createHash("sha256")
    .update(graders.join(""), "utf8")
    .digest("hex")
    .slice(0, 16);
}
