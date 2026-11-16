// ── MICA · Sig — signal-clarity sensor ────────────────────────────────────────
//
// WHAT SIG READS
//
//   Fidelity between what the system DID and what the record SAYS it did.
//
//     Sig reads state -> record fidelity, NOT world -> state accuracy.
//
//   A system honestly recording that it received garbage has GOOD Sig. A system
//   quietly cleaning up the garbage in its record has BAD Sig. Sig does not care
//   whether the input was true.
//
//   Sig produces FLAGS, NEVER GRADES. This is not a shortfall. A failing Sig
//   cannot produce a corrected number, because the instrument producing the
//   number is the thing in question. The deliverable is a catalogue of ways the
//   record can be caught contradicting ITSELF — one part of the system's own
//   account failing to line up with another part of it.
//
// ⚠ SIG IS NOT CHAIN VERIFICATION.
//
//   L0 already has verify() and recomputeHeadHashAt(). Hash integrity is solved,
//   shipped, and not this sensor's job. A Sig that wrapped verify() would pass
//   every done-condition and be worthless.
//
//   Sig reads records that are VALIDLY CHAINED AND INTERNALLY CONTRADICTORY — a
//   chain that verifies perfectly, containing a system telling on itself. The
//   hash catches tampering. Sig catches the record disagreeing with the
//   structure it is embedded in.
//
//   verify() appears in this file exactly once, as a precondition gate: a broken
//   chain means Sig CANNOT ASSESS. It is never the finding.

import type { MicaLogRecord, MicaReadableLog } from "../log";
import {
  alarm,
  assessLogReadability,
  cannotAssess,
  formatScopeBlock,
  isUsableLoadStateList,
  loadStateScopeLines,
  printScopeBlock,
  silent,
  SILENCE_IS_NOT_HEALTH,
} from "../types";
import { SIG_COMPETENCE_LINES } from "../competence";
import type {
  BlindPath,
  Finding,
  SensorVerdict,
  VerdictKind,
} from "../types";

export const SIG_SENSOR_ID = "MICA/Sig";

// ── Configuration — injected, never defaulted ─────────────────────────────────

/**
 * Map from an eventType that records a transition INTO some state, to the
 * eventTypes any one of which can have made that state reachable.
 *
 * Semantics: AT LEAST ONE of the listed prior eventTypes must appear earlier in
 * the chain. Not all of them. A state reachable by more than one route is
 * ordinary, and requiring every listed event would encode an ordering the map
 * does not express.
 *
 * Which eventType requires which prior event is DEPLOYMENT-SPECIFIC. Hardcoding
 * the existing v0 state machine here would be a calibration constant AND would
 * couple a MICA sensor to one ILAS module's internals. So F2 ships with the
 * mechanism built and the map empty.
 */
export type PreconditionMap = Readonly<Record<string, readonly string[]>>;

/**
 * NEGATIVE / MUTUAL-EXCLUSION precondition map. Maps an ENTER eventType — one
 * that transitions INTO a state — to the CLEAR/EXIT eventType(s) that LEAVE that
 * state. Where PreconditionMap asks "did a required prior HAPPEN", this asks
 * "was the state ALREADY ACTIVE when it was entered again".
 *
 * Semantics: F2 ALARMs on an enter event when, walking the chain in
 * sequenceNumber order, the state is already active at that point — a prior
 * enter of the SAME eventType with NO intervening clear. Order-sensitive, like
 * the positive check. Enter/clear/enter alternation is clean; enter/enter (or
 * enter without a clear before the next enter) is a re-entry.
 *
 * ── WHY ITS ABSENCE DOES NOT MOVE THE VERDICT (the freeze fence) ──────────────
 *
 * This element is OPTION-B injected exactly as PreconditionMap is — no default,
 * no fallback. But its absence is disclosed on SigResult and in the export
 * artifact, NEVER folded into the verdict: an absent or clean re-entry scope
 * leaves F2's verdict byte-identical, and ONLY a re-entry VIOLATION lowers the
 * bound (new finding code SIG_F2_STATE_ALREADY_ACTIVE). A run that does not
 * inject this map reads exactly the verdict it read before this element existed,
 * which is what keeps verdict-logic.frozen.json byte-identical. The "this scope
 * was not checked" disclosure lives where widening always lives here — visible,
 * on the result and in the artifact, not silent and not in the frozen verdict.
 */
export type ReentryMap = Readonly<Record<string, readonly string[]>>;

/**
 * A parallel clerk-clock read, injected by deployment glue. It is structural so
 * MICA keeps no import edge to src/clerk or ILAS. `sequenceNumber` joins a stamp
 * to the five-field record; clerk_seq supplies the independent receipt order.
 */
/**
 * S134 Ra (The arbiter) · THE WRITER A LEGACY STAMP CANNOT NAME.
 *
 * Stamps written before S134 carry no `moduleId`. The stamps file has been
 * MULTI-WRITER since 2026-09-13 — three principals hold the ACL on
 * `mica-log.jsonl` and three distinct `sequenceNumber: 0` lines sit in the file
 * — so an absent `moduleId` is not evidence of one writer, only of a writer
 * that was never recorded. `LEGACY_CURSOR_MODULE_ID` answers a DIFFERENT
 * question correctly (a single-integer CURSOR could only have meant one writer)
 * and stays cursor-only; borrowing it here would name nine of nineteen lines
 * falsely.
 *
 * So the reader says UNATTRIBUTED and means it. It carries no `mica-` prefix,
 * so it can never collide with a roster principal, and `toClockStamp` REFUSES a
 * line that writes this string itself — a writer claiming the sentinel is a
 * malformed line, not an unattributed one.
 */
export const UNATTRIBUTED_STAMP_WRITER = "UNATTRIBUTED";

export interface ClerkClockStamp {
  /**
   * WHO wrote the record this stamp is for — S127-8 followed into the file it
   * stamps. `UNATTRIBUTED_STAMP_WRITER` exactly when the line on disk carried
   * none; every other value is a principal the caller read off the record.
   */
  readonly moduleId: string;
  /**
   * WHICH CHAIN the stamped record belongs to — T3 item (3), MADE MANDATORY BY
   * T8 (The arbiter's ruling, board §1b 2026-09-29 06:4xZ).
   *
   * ⛔ THE `?` ON THIS FIELD IS THE WIRE SHAPE, NOT THE RULE. It stays optional
   * in the type because a stamp file written by an older carrier is a thing
   * that EXISTS and must be readable in order to be REFUSED — a required field
   * here would turn a refusable stamp into an unparseable one, and F3 would
   * lose the ability to say WHY it refused. The rule lives in `runF3`, which
   * refuses every stamp this field does not positively attribute to this chain.
   *
   * `sequenceNumber` RESTARTS AT ROTATION (`subject-event-journal.ts`:
   * `sequenceNumber = this.chain.length`), so a stamp for a retired chain's
   * seq 5 joins the new chain's seq 5 and F3 reports a real clerk receipt
   * against the wrong record — a CONFIDENT WRONG ANSWER, which is the only
   * failure class worse than a refusal. This field is how a stamp says which
   * chain it was taken from.
   *
   * THE THREE CASES UNDER T8. Exactly ONE of them joins.
   *   absent           -> ⛔ REFUSED. Was: "joins as before, disclosed as
   *                       unattributed". `unattributed` WAS THE PERMISSION THIS
   *                       TICKET REMOVES, in the arbiter's own words: a stamp
   *                       that does not name its chain is a claim about a
   *                       NUMBER, not about a RECORD.
   *   present, matching SigConfig.expectedChainIdentity -> JOINS. The only arm.
   *   present, DIFFERING -> REFUSED, exactly as before T8.
   *   present, NOTHING TO CHECK IT AGAINST -> ⛔ ALSO REFUSED under T8. Was:
   *                       "joined and disclosed as UNVERIFIED". T8 condition 2
   *                       names BOTH counters — `unattributedStampCount` and
   *                       `unverifiedAttributionCount` — as becoming "counts of
   *                       REFUSED stamps rather than joined ones", and this is
   *                       that arm. ⚠ AND IT IS THE ARM THAT DECIDES WHETHER
   *                       THIS TICKET WORKS AT ALL: with no
   *                       `expectedChainIdentity` injected, EVERY stamp lands
   *                       here. A deployment that forgets to inject it gets a
   *                       blind F3 and a named reason, NOT a full set of joins
   *                       on unchecked claims. Fail-closed is the only reading
   *                       of "every clerk stamp F3 uses must name the chain it
   *                       belongs to" that a forgetful deployer cannot undo.
   *
   * ⚠ WHAT THIS COSTS ON THE DAY IT LANDS, stated because the ticket states it:
   * ALL 678 STAMPS NOW ON DISK CARRY NONE OF THESE AND ARE ALL REFUSED. F3 goes
   * from SILENT over 677 pairs to a typed refusal over zero until the re-stamp.
   * That is the act, not a side effect of it.
   */
  readonly chainIdentity?: string;
  readonly sequenceNumber: number;
  readonly clerk_seq: number;
  readonly clerk_time: {
    readonly wall_ms: number;
    readonly monotonic_ns: string;
  };
  readonly separation: "SEPARATE_PROCESS" | "IN_PROCESS_NO_SEPARATION";
  readonly intake: "SOCKET" | "LOCAL_CALL" | "CLERK_INTERNAL";
  readonly clerk_id: string;
  readonly clerk_boot_id: string;
}

export type ClerkClockSource = readonly ClerkClockStamp[];

// ── F3's disclosure — T3, and WHY IT IS NOT ON FlagReport ────────────────────
//
// Ticket T3-sig-f3-watermark, condition 1, in the arbiter's own constraint:
// `verdict-logic.frozen.json` is NOT opened and its 20 scenarios stay
// byte-identical. Two of those scenarios ARE WHOLE FlagReports for F3
// (`sig/f3-consistent-report`, `sig/f3-absent-report`, compared with
// deepStrictEqual), and a third is a whole SensorVerdict whose summary prints
// F3's line. So:
//
//   a field on FlagReport      -> moves two frozen entries.        FORBIDDEN.
//   a word in a verdict summary -> moves at least three.           FORBIDDEN.
//   a field on SigResult        -> moves NOTHING.                  THIS ONE.
//
// That is not a workaround. It is the same seam `readableLoadStates`,
// `preconditionMap`, `reentryMap`, `clerkClockSource` and `probeSource`
// already ride on, for the same stated reason: the injected element is made
// VISIBLE, NOT FREE, without entering the frozen verdict grammar.
//
// A TAIL AND A HOLE ARE DIFFERENT THINGS AND THE DIFFERENCE IS THE WHOLE
// REPAIR. See `computeStampCoverage` below for the shape argument; here is the
// consequence, because a reader of this type must not have to find it there:
//
//   TAIL  — a record ABOVE its own writer's high-water mark with no stamp.
//           The carrier has not reached it yet. DISCLOSED, counted, aged.
//           It does NOT blind the leg by itself. This is what T3 buys.
//   HOLE  — a record BELOW its own writer's high-water mark with no stamp.
//           The carrier passed this writer and did not stamp this record.
//           That is a SKIP, it is evidence, and it composes CANNOT_ASSESS.
//
// Collapsing them is the fail-open this repair exists to prevent: it files a
// genuinely skipped record into the "tail" and calls it fresh.

/**
 * How much of the log F3's clerk axis actually covered, and what it did not.
 *
 * Carried on `SigResult`, never on `FlagReport`. Every count here is a count of
 * RECORDS or STAMPS, never a judgement: the judgement is the flag's kind.
 */
export interface F3StampCoverage {
  /** Records that joined a stamp and were read. */
  readonly stampedCount: number;
  /**
   * Records ABOVE their own writer's high-water mark with no stamp — the
   * carrier has not reached them. Disclosed, not charged to the verdict.
   */
  readonly tailCount: number;
  /**
   * Records BELOW their own writer's high-water mark with no stamp — the
   * carrier SKIPPED them. Non-zero means the leg is CANNOT_ASSESS.
   */
  readonly holeCount: number;
  /** The local sequence numbers of the holes, so the skip can be named. */
  readonly holeSequenceNumbers: readonly number[];
  /**
   * Writers for which NOT ONE record is stamped, so no high-water mark exists
   * for them and their records cannot be classed by comparison. They are
   * counted in `tailCount` and named here, because "the carrier has never
   * visited this writer" and "the carrier has not caught up with this writer"
   * are not the same sentence and F3 cannot tell them apart. See the ceiling.
   */
  readonly unreachedWriters: readonly string[];
  /**
   * `clerk_time.wall_ms` of the NEWEST stamp that joined, or null when none
   * did. THE ONLY HONEST CLOCK FOR STALENESS: the tail's records carry only a
   * DECLARED timestamp, supplied by the party F3 exists to doubt, and a tail
   * measured against its own declared times lets a subject backdate its way
   * out of the check meant to catch it.
   */
  readonly newestStampedWallMs: number | null;
  /** Injected read-time, or null when none was injected. */
  readonly readAtMs: number | null;
  /** The declared lag bound in ms, or null when none was declared. */
  readonly lagBoundMs: number | null;
  /**
   * `readAtMs - newestStampedWallMs`, or null when either is absent. How long
   * since THE AXIS last spoke — not how old the tail says it is.
   */
  readonly axisSilentForMs: number | null;
  /**
   * Whether the bound was actually evaluated this run. FALSE is a finding, not
   * a blank: an absent bound or an absent read-time means the tail is
   * disclosed and NOT judged stale. A bound that cannot be read must not
   * manufacture a hold.
   */
  readonly lagBoundEvaluated: boolean;
  /** True only when the bound was evaluated AND exceeded. */
  readonly axisStale: boolean;
  /** Stamps for sequence numbers this log does not hold. Disclosed only. */
  readonly unjoinableStampCount: number;
  /** Stamps carrying no `chainIdentity` at all — today's behaviour, disclosed. */
  readonly unattributedStampCount: number;
  /**
   * Stamps carrying a `chainIdentity` while nothing was injected to check it
   * against. Joined, and NOT counted as attributed: an unchecked claim is not
   * a checked one.
   */
  readonly unverifiedAttributionCount: number;
  /** Stamps refused because their `chainIdentity` names another chain. */
  readonly refusedChainStampCount: number;
  /** The distinct foreign chain identities seen, so the refusal can be named. */
  readonly refusedChainIdentities: readonly string[];
  /**
   * T6 · Stamps DISCARDED because the writer they claim disagrees with the
   * writer of the record at their sequence. Never joined, always counted. The
   * record is left unstamped and falls to the per-writer watermark, so a
   * mismatch beneath a writer's mark reads as a HOLE and composes
   * CANNOT_ASSESS — a mislabelled stamp costs a reading rather than buying one.
   */
  readonly mismatchedWriterStampCount: number;
  /** The distinct writers those discarded stamps CLAIMED, so it can be named. */
  readonly mismatchedWriterIdentities: readonly string[];
  /**
   * T6 · Sequences where MORE THAN ONE stamp agreed with the record — one
   * writer stamping its own sequence twice, which is a real ambiguity. Before
   * T6 this refused the whole leg; now the affected record is left unstamped
   * and every other record still reads.
   */
  readonly ambiguousStampSequences: readonly number[];
  /**
   * T6 remedy · sequences whose stamps were ALL rejected for writer identity.
   * Never tail, never hole, typed CANNOT_ASSESS at any placement.
   */
  readonly rejectedMismatchSequenceNumbers: readonly number[];
}

/**
 * T9 · F1's ORDER DEVIATION, as a number instead of nothing at all.
 *
 * ⛔ WHAT WAS WRONG, AND IT IS T3(4)'s OWN SENTENCE UNAPPLIED. `runF1` computed
 * the gap for every adjacent pair and RETAINED IT ONLY WHEN IT ALREADY EXCEEDED
 * THE TOLERANCE. So on a run that produced no finding there was no number
 * anywhere — not on the result, not in the decision, not on any surface — and
 * NOBODY, no operator and no seat, could state F1's distance to the line it is
 * measured against. T3 item (4) wrote, four lines above F3's accumulator: *"the
 * largest deviation, kept as a NUMBER. It was always computed here and then
 * survived only inside the finding's prose; recovering it meant parsing a
 * reader's English for a number the reader already had."* That sentence
 * described `runF1` exactly, and `runF1` was left as it was.
 *
 * ⛔ AND IT MATTERED BECAUSE ONE FIELD GOVERNS TWO LEGS. `clockToleranceMs` is a
 * single declared value read by F1 and by F3. Until this, only one of the two
 * axes it governs could report its headroom — so a tolerance declared from
 * measurement was declared from half the evidence.
 *
 * SAME SHAPE AS `F3Deviation`, FIELD FOR FIELD, AND THE SIGN CONVENTION IS
 * IDENTICAL BY INTENT: `distanceMs = maxDeclaredInversionMs - clockToleranceMs`,
 * so POSITIVE IS THE ADVERSE SIDE and negative is headroom. Two fields that mean
 * the same thing and differ in sign are worse than one field.
 */
export interface F1Deviation {
  /**
   * The largest `prev.timestamp - curr.timestamp` over F1's scope. NEGATIVE when
   * the declared clock never ran backwards at all — which is the ordinary
   * reading on a writer that stamps non-decreasing, and is exactly the headroom
   * that could not be stated before.
   */
  readonly maxDeclaredInversionMs: number;
  /** The injected tolerance this was measured against. */
  readonly clockToleranceMs: number;
  /** `maxDeclaredInversionMs - clockToleranceMs`. Positive is the adverse side. */
  readonly distanceMs: number;
  /** Adjacent pairs compared — the SAME pairs the findings walk, not a re-derived scope. */
  readonly pairsCompared: number;
}

/**
 * F3's ORDER DEVIATION, as a number instead of a sentence — T3 item (4).
 *
 * The quantity already existed: `runF3` computes `prev.timestamp -
 * curr.timestamp` and compares it to `clockToleranceMs`. Until this field it
 * survived only inside the finding's PROSE, and recovering it meant parsing a
 * reader's English to get back a number that reader had already computed —
 * which is precisely the move this codebase refuses everywhere else.
 *
 * Present whenever F3 got as far as comparing pairs, INCLUDING when the
 * largest deviation is at or below tolerance (a SILENT reading with headroom is
 * a reading, and `/explain` is entitled to it). Null when F3 never compared.
 */
export interface F3Deviation {
  /**
   * The LARGEST `prev.timestamp - curr.timestamp` over adjacent pairs in clerk
   * receipt order. SIGNED: negative means declared time ran forward with the
   * clerk, which is the clean direction.
   */
  readonly maxDeclaredInversionMs: number;
  /** The injected tolerance it was measured against. Never defaulted. */
  readonly clockToleranceMs: number;
  /** `maxDeclaredInversionMs - clockToleranceMs`. Positive is the adverse side. */
  readonly distanceMs: number;
  /** How many adjacent pairs were compared to get it. */
  readonly pairsCompared: number;
}

// ── F4 · probe divergence — the injected shape ────────────────────────────────
//
// THE NAME MAPPING, written here because three namespaces meet at this leg and
// no two of them agree (checked at bytes 2026-09-01, before a line was added):
//
//   A9  = the inventory's id for this build
//       = "Sig leg 3" (the third LEG to be built)
//       = FLAG F4 (the fourth FLAG in this file)
//
//   "leg 3" and "F3" are NOT the same counter and never were: F2 carries two
//   independent checks (positive precondition + re-entry), so the leg count and
//   the flag count diverged before this build existed.
//
//   ⚠ "F5" IS NOT AVAILABLE IN THIS NAMESPACE AND NEVER WILL BE. It already
//   names a PRINCIPLE in this file — the F5 honest split, arbiter-ruled (a):
//   unconfigured is NOT_CONFIGURED, not a blind CANNOT_ASSESS — and it is used
//   that way eight times below. A future fifth flag takes F6 or a new
//   namespace. It does not take F5. Anyone who numbers the next leg by counting
//   the last one will land exactly on the collision this note exists to stop.
//
//   Collision check performed over the whole source tree, not this file alone:
//   no `"F4"` string literal and no `F4[` print token existed anywhere under
//   `src/` before this build. F4 and F6–F10 DO occur under `src/`, but only as
//   REVIEW-FINDING section ids inside test files — a per-file, human-facing
//   namespace that never reaches a `FlagReport.flag` value.
//
// ── WHY THIS LEG EXISTS (D-01, board ruling S77, option c) ───────────────────
//
//   The witness holds fingerprints of what ALREADY HAPPENED. Every other leg in
//   this file reads the record against itself or against a receipt taken as the
//   record arrived. None of them can catch a system that is wrong about what it
//   WILL do, because none of them holds anything that was committed BEFORE the
//   event.
//
//   F4 is the first leg that does. It reads an expectation that was SEALED
//   BEFORE the probe ran against the result the probe actually produced.
//
// ── WHAT IT IS NOT COUPLED TO ────────────────────────────────────────────────
//
//   Sig imports NOTHING from `src/precommit`, opens no book, and never touches
//   the registrar. The shapes below are STRUCTURAL, declared here, exactly as
//   ClerkClockStamp is for F3: whoever assembles the injection owns custody of
//   the book and the reveal; Sig owns only the comparison. If these shapes drift
//   from the precommit module's, the assembler is the one that must notice —
//   that is the cost of having no import edge, and it is the cost we are buying.

/**
 * What the probe ACTUALLY produced, as observed and reported by whoever ran it.
 *
 * `observedValue` is compared verbatim against the revealed prediction. It is
 * never parsed, normalised, trimmed, or coerced: a comparison that repairs its
 * own inputs is a comparison that can be talked into a match.
 */
export interface ProbeResult {
  /** The observed result, verbatim. Compared by exact string equality. */
  readonly observedValue: string;
  /** Who observed it. Carried into findings so a divergence names its source. */
  readonly observedBy: string;
  /** Wall time of the observation, presented by the caller. Cross-check only. */
  readonly observedAt: number;
}

/** Mirrors the precommit module's ExpectationType. Structural, not imported. */
export type ProbeExpectationType = "verdict" | "hash" | "claim+rule";

/**
 * The seal's own verdict on itself, decided by the book at reveal — NOT by Sig.
 *
 * MATCH    the revealed plaintext hashes to the committed digest.
 * MISMATCH it does not. There is then no trustworthy sealed prediction to
 *          compare, so F4 reads that record as BLIND, never as a divergence.
 * UNSEALED no expectation was ever sealed for this probe. Out of F4's scope
 *          entirely — readable, not punishable.
 */
export type ProbeSealCheck = "MATCH" | "MISMATCH" | "UNSEALED";

/**
 * Whether the assembler can establish that the SEAL PREDATES THE OBSERVATION.
 *
 * F4 never infers this. The whole warrant of the leg is that the expectation
 * was held outside and committed BEFORE the probe; a comparison that cannot
 * establish that order is comparing a prediction to an event that may have
 * produced it. Board S100-B(3) is the standing case: within-sweep chain order
 * is decided by a random frame-name suffix and is finer than the evidence
 * supports. Where the order is not established, F4 says so and reads nothing.
 */
export type ProbeOrderEvidence = "SEALED_BEFORE_OBSERVED" | "ORDER_NOT_ESTABLISHED";

/**
 * One sealed expectation joined to one observed result, assembled OUTSIDE this
 * sensor by whoever holds the book.
 */
/**
 * Fields EVERY probe record carries, sealed or not.
 *
 * An observation always names what it observed, who observed it, and where it
 * came from — those do not depend on anything having been sealed.
 */
interface ProbeRecordBase {
  /**
   * The commitment sequence this record is about. For a SEALED record it is the
   * commitment the book actually holds; for an UNSEALED one it is the sequence
   * the OBSERVER NAMED and the book does not have. Either way it is real data
   * somebody supplied, and it is the key F4 de-duplicates on.
   */
  readonly commitmentSeq: number;
  /** What was observed. Quoted in findings, never parsed. */
  readonly target: string;
  /** The observed side. */
  readonly observed: ProbeResult;
  /** Where this record came from, for a reader who must go check. */
  readonly provenance: string;
}

/** A probe for which an expectation WAS sealed. F4's actual scope. */
export interface SealedProbeRecord extends ProbeRecordBase {
  /**
   * The book's own seal verdict — MATCH or MISMATCH. Never UNSEALED: a record
   * with no seal is a different shape, below, because it has different facts.
   */
  readonly sealCheck: "MATCH" | "MISMATCH";
  /** The committed digest, carried so a finding can name the seal it read. */
  readonly sealedDigest: string;
  /** What kind of expectation this is. Only `verdict` and `hash` are comparable. */
  readonly expectationType: ProbeExpectationType;
  /** The REVEALED prediction. Compared verbatim against `observed.observedValue`. */
  readonly predictedValue: string;
  /** Who committed the expectation. Named in findings; never judged. */
  readonly committerId: string;
  /** See ProbeOrderEvidence. Never inferred. */
  readonly orderEvidence: ProbeOrderEvidence;
}

/**
 * An observation for which NOTHING WAS EVER SEALED. `[LB]`
 *
 * ── WHY THIS IS ITS OWN SHAPE, and why the missing fields are ABSENT rather
 *    than empty (ruled S101, option (a); the shaping is this build's) ────────
 *
 * There is no seal, so there is no digest, no revealed prediction, no committer,
 * and no expectation type — NONE of the three `ProbeExpectationType` values
 * means "there was no expectation", and inventing a fourth would drift this
 * enum from the book's own `ExpectationType` for a case the book cannot have.
 *
 * The first shape of this record required all of those NON-EMPTY regardless of
 * `sealCheck`, which made "UNSEALED" unreachable by any producer that did not
 * MANUFACTURE values to get past the validator — the exact defect of ledger
 * S100-1, where a placeholder shipped as a finished value reached a permanent
 * chain record. So the fields are not empty strings here. THEY ARE ABSENT.
 * An empty string is a value that happens to be blank and reads, in an
 * artifact, like a digest nobody filled in. An absent field says there is no
 * such thing to fill.
 *
 * `orderEvidence` is absent for the same reason and it is worth naming
 * separately: order evidence answers "did the seal PREDATE the observation",
 * and with no seal that question has no answer to give. A record claiming
 * SEALED_BEFORE_OBSERVED while claiming to have no seal would be incoherent,
 * and the type below makes it unwriteable rather than merely discouraged.
 */
export interface UnsealedProbeRecord extends ProbeRecordBase {
  readonly sealCheck: "UNSEALED";
  /**
   * ⚠ These are declared `?: undefined`, NOT omitted, on purpose: it makes a
   * seal-carrying UNSEALED record a COMPILE ERROR rather than a convention.
   * A letter claiming it never had an envelope, while holding one, is a lie —
   * and `malformedProbeRecord` refuses the same thing at runtime, for records
   * that arrive as JSON and never met the type at all.
   */
  readonly sealedDigest?: undefined;
  readonly expectationType?: undefined;
  readonly predictedValue?: undefined;
  readonly committerId?: undefined;
  readonly orderEvidence?: undefined;
}

export type ProbeRecord = SealedProbeRecord | UnsealedProbeRecord;

/** True when this record carries a seal, narrowing the union for a reader. */
export function isSealedProbe(r: ProbeRecord): r is SealedProbeRecord {
  return r.sealCheck !== "UNSEALED";
}

export type ProbeSource = readonly ProbeRecord[];

export interface SigConfig {
  /**
   * The load states this deployment considers readable. INJECTED — there is no
   * default and no fallback. Which states a log reports, and which of them are
   * trustworthy, are deployment facts this sensor has no access to.
   *
   * See assessLogReadability in ../types for what this project RECOMMENDS and
   * for the widening exposure a permissive list buys. The list is printed in
   * this sensor's scope block and in any load-state blind path, so a reader can
   * see what this run was told to trust.
   *
   * REQUIRED. Absent, empty, or not a list of non-empty strings ->
   * CANNOT_ASSESS (MISSING_CONFIGURATION), and no flag runs at all.
   */
  readableLoadStates?: readonly string[];
  /**
   * Tolerance window, in the same unit as LogEntry.timestamp, within which a
   * backwards step is not treated as a contradiction. REQUIRED — there is no
   * default. Zero is a legitimate injected value (meaning: no tolerance), and
   * zero is the identity of a window rather than a calibration choice, so it is
   * the only bound this code imposes. Absent means CANNOT_ASSESS for F1.
   */
  clockToleranceMs?: number;
  /**
   * WHERE THE TOLERANCE CAME FROM, in the declarer's own words, printed
   * verbatim wherever F1 states a verdict that used the number.
   *
   * A tolerance is a number and a number cannot say whether it was MEASURED on
   * this deployment's clocks or ASSERTED about them. The difference is the
   * whole weight of an F1 finding: a measured window is a fact about two
   * clocks, an asserted one is a claim that they are the same clock. Sig cannot
   * tell them apart by looking at `0`, and it will not guess — so the basis
   * rides on the value or it does not exist.
   *
   * OPTIONAL, AND ABSENT IS NOT A DEFAULT: with no basis, F1 prints exactly
   * what it printed before this field existed, and says nothing about
   * provenance rather than assuming any. Same discipline as the assembler's
   * DeclaredSweepPeriod (S103-G).
   */
  clockToleranceBasis?: string;
  /**
   * See PreconditionMap. Absent OR EMPTY means CANNOT_ASSESS for F2's scope —
   * an empty map does not buy a clean reading.
   */
  preconditionMap?: PreconditionMap;
  /**
   * See ReentryMap. Option-B injected, no fallback. Absent OR EMPTY -> the
   * re-entry scope is UNREAD, disclosed on SigResult and in the export artifact
   * (never in the frozen verdict). Only a re-entry VIOLATION lowers the bound.
   */
  reentryMap?: ReentryMap;
  /** Option-B injected. No source and no fallback means F3 did not read. */
  clerkClockSource?: ClerkClockSource;
  /**
   * THE DECLARED LAG BOUND, in ms — T3 item (2). How long the axis may be
   * silent before an unstamped tail stops being "the carrier has not run yet"
   * and becomes "the carrier is gone".
   *
   * OPTIONAL, AND ABSENT IS NOT A DEFAULT. Absent means the tail is DISCLOSED
   * and NOT judged stale, and the leg says so in `F3StampCoverage`. This is a
   * fork and it was taken deliberately: absent-means-stale would let a missing
   * declaration manufacture a hold, and a bound that cannot be read must not
   * stop the box. Same discipline as `clockToleranceBasis`.
   *
   * ⚠ IT MUST BE DECLARED GENEROUSLY RELATIVE TO THE CARRIER'S CADENCE. From
   * the day this is wired, THE CARRIER'S UPTIME CAN HOLD THE BOX — nothing
   * else in the reader stack has that property. A bound equal to the cadence
   * converts every jittered timer into an outage.
   */
  clerkStampLagBoundMs?: number;
  /**
   * INJECTED NOW, in the same unit as `clerk_time.wall_ms` — T3 item (2).
   *
   * `assessSig` IS PURE. Nothing in this file reads `Date.now()`, and nothing
   * in it may: a reader that reaches for the wall clock stops being
   * deterministic and every frozen fixture breaks on the next run. So the
   * staleness clock is injected or it does not exist.
   *
   * OPTIONAL. Absent has the same effect as an absent bound: disclose, do not
   * judge.
   */
  readAtMs?: number;
  /**
   * WHICH CHAIN this run's stamps must belong to — T3 item (3). See
   * `ClerkClockStamp.chainIdentity` for the three cases.
   *
   * OPTIONAL BY DEFAULT (ticket condition 2). Absent means no stamp is
   * refused for its chain, exactly as before this field existed.
   *
   * ⚠ WHAT THIS CHECKS, AND NOTHING WIDER. It checks that the stamps agree
   * with WHAT THE ASSEMBLER SAID THIS CHAIN IS. It does NOT check that the
   * stamps were taken from the log F3 is reading — F3 cannot, because
   * `MicaLogRecord` carries no chain field and F3 never sees one. The
   * assembler holds that custody, exactly as it holds custody of F4's probe
   * book. This is on the printed ceiling too.
   */
  expectedChainIdentity?: string;
  /**
   * See ProbeSource. Option-B injected, no fallback, no default. Absent OR
   * EMPTY -> F4 is NOT_CONFIGURED (dormant, disclosed, does not lower the
   * bound). Injected but malformed -> CANNOT_ASSESS, which DOES lower it.
   */
  probeSource?: ProbeSource;
}

// ── Per-flag reporting ────────────────────────────────────────────────────────
//
// Each flag reports its own verdict over its own scope. The sensor's overall
// verdict is composed from them, and the composition is visible in the result
// so a consumer can see WHICH scope was unread rather than inferring it.

/**
 * A flag's status. Three of these are the verdict grammar (ALARM/CANNOT_ASSESS/
 * SILENT); the fourth, NOT_CONFIGURED, is the honest split F5 (arbiter-ruled a)
 * requires. A leg that is genuinely OPTIONAL AND UNCONFIGURED — no source was
 * injected for it at all — is NOT the same as a leg that was configured and could
 * not read. The former is NOT_CONFIGURED: a distinct NON-VERDICT status that is
 * disclosed but does NOT compose into the floor. The latter is CANNOT_ASSESS: a
 * verdict-bearing blind leg whose unreadability lowers the bound. Naming the
 * unconfigured case CANNOT_ASSESS (the old "Option-B" shape) and then dropping it
 * before composition is exactly the fail-open F5 names — so it is not named that.
 */
export type FlagStatus = VerdictKind | "NOT_CONFIGURED";

/**
 * A count of records a flag was HANDED and did not read, because they fall
 * outside what the flag is about — as distinct from records it could not read.
 *
 * ⚠ THIS IS NOT A BLIND PATH, and the difference is the whole point. A
 * `BlindPath` on a verdict-bearing leg composes into the floor and drives the
 * composite to CANNOT_ASSESS. An out-of-scope note MUST NOT: the records are
 * not unread evidence, they are not evidence of this flag's subject at all.
 * Putting the unsealed count in `blindPaths` would have punished a committer
 * for not sealing, which is precisely what offer-not-impose forbids.
 *
 * It is disclosed on the report and printed in the export artifact, so it is
 * countable by a reader without being chargeable to the verdict.
 */
export interface OutOfScopeNote {
  readonly class: "UNSEALED_NO_EXPECTATION";
  readonly count: number;
  readonly detail: string;
}

export interface FlagReport {
  flag: "F1" | "F2" | "F3" | "F4";
  name: string;
  kind: FlagStatus;
  findings: readonly Finding[];
  blindPaths: readonly BlindPath[];
  /** Number of records that fell inside this flag's scope. */
  scopeSize: number;
  /**
   * Records handed to this flag that fell OUTSIDE its scope — disclosed, never
   * charged to the verdict. OPTIONAL, and only F4 sets it: an absent key keeps
   * every other leg's report byte-identical, which is what keeps
   * verdict-logic.frozen.json from moving (its F3 entries are whole
   * FlagReports, compared with deepStrictEqual).
   */
  outOfScope?: readonly OutOfScopeNote[];
}

export interface SigResult {
  verdict: SensorVerdict;
  flags: readonly FlagReport[];
  /**
   * The readable load states THIS RUN was told to trust, or null when nothing
   * usable was injected. Carried on the result so the exported artifact can
   * print it without re-deriving it from a config it never sees.
   */
  readableLoadStates: readonly string[] | null;
  /**
   * The precondition map THIS RUN was told to check, or null when nothing usable
   * (absent or empty) was injected. Carried on the result for the SAME reason
   * readableLoadStates is, and following narrow-W's declaredProfile precedent:
   * the injected element is made VISIBLE, NOT FREE.
   *
   * ⚠ NOT IN THE VERDICT. The verdict summary is frozen byte-for-byte by
   * verdict-logic.frozen.json and must not move without a ruled re-freeze, so
   * the map cannot be printed there. It is carried here and printed in the
   * exported artifact instead — a clean F2 SILENT that did not say WHICH
   * preconditions it checked would be a reading hiding its own scope, exactly
   * the trivially-satisfied silence the empty-map rule already forbids.
   */
  preconditionMap: PreconditionMap | null;
  /**
   * The re-entry (mutual-exclusion) map THIS RUN was told to check, or null when
   * nothing usable (absent or empty) was injected. Carried for the SAME reason
   * preconditionMap is — and this is WHERE the "the re-entry scope was not
   * checked" fact is disclosed when the map is null, since it is deliberately
   * kept OUT of the frozen verdict. A reader who wants to know whether re-entry
   * was assessed reads this and the export artifact, not the verdict kind.
   */
  reentryMap: ReentryMap | null;
  /** The injected clerk axis, or null when F3 was not configured. */
  clerkClockSource: ClerkClockSource | null;
  /**
   * The injected probe axis, or null when F4 was not configured. Carried for
   * the same reason every other injected element is: the element is made
   * VISIBLE, NOT FREE. It is also where a reader recovers how many injected
   * records were UNSEALED and therefore out of F4's scope — F4's scopeSize
   * counts only the sealed ones, and the difference is legible only here and in
   * the export artifact, never in the frozen verdict.
   */
  probeSource: ProbeSource | null;
  /**
   * F3's coverage of the log — what the clerk axis read, what it has not
   * reached, and what it SKIPPED. Null when F3 never got as far as joining
   * (no source injected, or the source was refused outright).
   *
   * ⚠ HERE AND NOT ON `FlagReport`, by ticket condition 1. See the comment on
   * `F3StampCoverage`. Whoever is tempted to move it up into the flag report
   * so the verdict prints it should read that comment first: two frozen
   * scenarios ARE F3's whole FlagReport, compared byte-for-byte.
   */
  clerkStampCoverage: F3StampCoverage | null;
  /**
   * F3's order deviation as a NUMBER — T3 item (4). Null when F3 never
   * compared a pair. Feeds `/explain`'s recorded margin, which is why it is
   * structured here instead of living inside a finding's prose.
   */
  /**
   * T9 · F1's largest measured inversion on THIS reading, or null when F1 took no
   * measurement — an unreadable log, or a scope with no adjacent pair. ⛔ NOT null
   * merely because F1 found nothing: that case is the whole point of the ticket
   * and it carries a number.
   */
  f1Deviation: F1Deviation | null;
  f3Deviation: F3Deviation | null;
}

// ── F1 · declared clock vs append order ───────────────────────────────────────
//
// `timestamp` is supplied by the CALLER of append(). `sequenceNumber` is
// ASSIGNED BY L0 at append time, as chain.length. But append() is the only
// mutator of that chain, so the value is a running count of the appending
// party's own calls: L0 ASSIGNS IT, THE APPENDING PARTY DETERMINES IT.
//
// These are therefore NOT two independent axes. Both are under the control of
// the party Sig observes. F1 is not one party's word checked against another's;
// it is one account checked against a second account by the SAME party.
//
//   F1 fires when `timestamp` order contradicts `sequenceNumber` order.
//
// Entry n+1 carrying a timestamp earlier than entry n is the declared account of
// time contradicting the order the declarant's own call sequence produced —
// inside a chain that verifies cleanly. This is the system's word against its
// own word, and F1 claims nothing wider than that.
//
// CORRECTION OF RECORD (2026-08-07). This block, and the printed scope block
// below, previously described the two fields as being written by two separate
// parties, and described F1 as reading the system's word against a structure
// outside its control. Both facts those statements rested on were right; the
// inference drawn from them was false. The field-authorship census classifies
// `sequenceNumber` as ASSIGNED_BUT_CALLER_INFLUENCEABLE and confirms it
// empirically (l0/index.ts:238 — `= this.chain.length`). F1's reading logic is
// UNCHANGED by that correction; only this account of its warrant is.
//
// The old wording is deliberately NOT quoted verbatim here, so that a grep for
// the false claim over src/mica/ returns nothing rather than returning the
// notice that retracts it.
//
// DECISIONS TAKEN HERE, stated so they can be attacked:
//
//   Equal timestamps are NOT a violation. `timestamp` is caller-supplied and in
//   practice millisecond-resolution; two appends inside the same millisecond are
//   physically ordinary, and equality is consistent with either order. Only a
//   STRICT inversion, beyond the injected tolerance, contradicts anything.
//
//   Adjacent pairs, not a running maximum. A sequence is non-decreasing if and
//   only if every adjacent pair is non-decreasing, so adjacent-pair testing is
//   COMPLETE for detecting non-monotonicity. The two approaches differ only in
//   how many violations they attribute to one disordered entry, and attributing
//   one violation per contradicting pair is the reading that names the two
//   records actually in conflict.
//
//   Every violation is reported, not the first. Sig produces a catalogue. It
//   does not aggregate a count into a grade, because it produces no grades.

function runF1(
  entries: readonly MicaLogRecord[],
  config: SigConfig | undefined
): F1Outcome {
  const name = "declared clock vs append order";
  const tolerance = config?.clockToleranceMs;
  // Printed verbatim beside the number, or not printed at all. Never inferred.
  const basis = config?.clockToleranceBasis;
  const basisNote =
    typeof basis === "string" && basis.trim() !== "" ? ` [${basis.trim()}]` : "";

  if (
    typeof tolerance !== "number" ||
    !Number.isFinite(tolerance) ||
    tolerance < 0
  ) {
    return {
      // No tolerance injected: nothing to measure a deviation AGAINST, so the
      // deviation is null rather than a number against an imagined line.
      deviation: null,
      report: {
      flag: "F1",
      name,
      kind: "CANNOT_ASSESS",
      findings: [],
      blindPaths: [
        {
          class: "MISSING_CONFIGURATION",
          detail:
            "clockToleranceMs was not injected as a finite, non-negative number. " +
            "There is no default: whether a backwards step is tolerable is a " +
            "deployment fact this sensor has no access to.",
        },
      ],
      scopeSize: 0,
      },
    };
  }

  // Scope is the set of ADJACENT PAIRS. Fewer than two entries means the scope
  // is empty, and silence over an empty scope is a claim about nothing.
  const pairCount = Math.max(0, entries.length - 1);
  if (pairCount === 0) {
    return {
      // No adjacent pair: nothing to be a maximum OF.
      deviation: null,
      report: {
      flag: "F1",
      name,
      kind: "CANNOT_ASSESS",
      findings: [],
      blindPaths: [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `chain holds ${entries.length} entr${entries.length === 1 ? "y" : "ies"}, ` +
            `so there is no adjacent pair whose order could contradict anything. ` +
            `F1's scope is empty; it is not clean.`,
        },
      ],
      scopeSize: 0,
      },
    };
  }

  const findings: Finding[] = [];
  // T9 · THE ACCUMULATOR, IN T3(4)'s SHAPE AND IN THE SAME LOOP AS THE FINDINGS.
  //   It is here rather than in a second pass on purpose: a second pass could
  //   disagree with the first if the scope were ever filtered differently, and a
  //   number that can disagree with the finding beside it is worse than no number.
  let maxDeclaredInversionMs = Number.NEGATIVE_INFINITY;
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const curr = entries[i];
    const delta = prev.timestamp - curr.timestamp;
    if (delta > maxDeclaredInversionMs) maxDeclaredInversionMs = delta;
    if (delta > tolerance) {
      findings.push({
        code: "SIG_F1_CLOCK_ORDER_CONTRADICTION",
        detail:
          `seq ${prev.sequenceNumber} (timestamp ${prev.timestamp}, ` +
          `${prev.moduleId}/${prev.eventType}) is followed by seq ` +
          `${curr.sequenceNumber} (timestamp ${curr.timestamp}, ` +
          `${curr.moduleId}/${curr.eventType}), which is ${delta} earlier — ` +
          `beyond the injected clockToleranceMs of ${tolerance}` +
          `${basisNote}. The declared ` +
          `clock contradicts the append order, inside a chain that verifies. ` +
          `Both are determined by the appending party: this is the record ` +
          `disagreeing with itself, not with an independent axis.`,
      });
    }
  }

  return {
    report: {
      flag: "F1",
      name,
      kind: findings.length > 0 ? "ALARM" : "SILENT",
      findings,
      blindPaths: [],
      scopeSize: pairCount,
    },
    deviation: {
      maxDeclaredInversionMs,
      clockToleranceMs: tolerance,
      distanceMs: maxDeclaredInversionMs - tolerance,
      pairsCompared: pairCount,
    },
  };
}


// ── F2 · declared precondition violated ───────────────────────────────────────
//
// An `outcome` asserting a state the chain shows was unreachable: an entry whose
// eventType records a transition into some state, with no prior entry in the
// chain of the kind that state requires.
//
// F2 NOW CHECKS TWO INDEPENDENT THINGS, both option-B injected:
//
//   POSITIVE (runF2Positive) — a required prior is ABSENT: precondition unreached.
//   NEGATIVE (detectReentry) — a state is entered while ALREADY ACTIVE: re-entry.
//
// The negative element only ever ADDS an alarm; its absence and its clean runs
// leave the verdict byte-identical, so verdict-logic.frozen.json does not move.
// See ReentryMap for why that is the fence and not a shortcut.

function runF2Positive(
  entries: readonly MicaLogRecord[],
  config: SigConfig | undefined
): FlagReport {
  const name = "declared precondition violated";
  const map = config?.preconditionMap;

  if (map === undefined || Object.keys(map).length === 0) {
    return {
      flag: "F2",
      name,
      kind: "CANNOT_ASSESS",
      findings: [],
      blindPaths: [
        {
          class: "MISSING_CONFIGURATION",
          detail:
            map === undefined
              ? "no preconditionMap was injected. Which eventType requires which " +
                "prior event is deployment-specific; this sensor holds no map of " +
                "its own and does not infer one. F2 SHIPS DORMANT BY DESIGN."
              : "an EMPTY preconditionMap was injected. An empty map does not buy " +
                "a clean reading — it describes zero preconditions, which is not " +
                "the same as zero violations.",
        },
      ],
      scopeSize: 0,
    };
  }

  const governed = entries.filter((e) =>
    Object.prototype.hasOwnProperty.call(map, e.eventType)
  );

  if (governed.length === 0) {
    return {
      flag: "F2",
      name,
      kind: "CANNOT_ASSESS",
      findings: [],
      blindPaths: [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `the injected map governs ${Object.keys(map).length} eventType(s), none of ` +
            `which occurs in this chain's ${entries.length} entries. No record falls ` +
            `inside F2's scope, so F2 has read nothing.`,
        },
      ],
      scopeSize: 0,
    };
  }

  const findings: Finding[] = [];
  for (const entry of governed) {
    const required = map[entry.eventType];
    const satisfied = entries.some(
      (prior) =>
        prior.sequenceNumber < entry.sequenceNumber &&
        required.includes(prior.eventType)
    );
    if (!satisfied) {
      findings.push({
        code: "SIG_F2_PRECONDITION_UNREACHED",
        detail:
          `seq ${entry.sequenceNumber} (${entry.moduleId}/${entry.eventType}, ` +
          `outcome "${entry.outcome}") records a transition whose injected ` +
          `precondition is any of [${required.join(", ")}]. No entry of any of those ` +
          `kinds appears at a lower sequenceNumber. The record asserts a state the ` +
          `chain shows was unreachable.`,
      });
    }
  }

  return {
    flag: "F2",
    name,
    kind: findings.length > 0 ? "ALARM" : "SILENT",
    findings,
    blindPaths: [],
    scopeSize: governed.length,
  };
}

/**
 * The negative check: a governed enter event that appears while its state is
 * ALREADY ACTIVE — a prior enter of the same eventType with no intervening
 * clear, in sequenceNumber order. Returns one finding per re-entry; nothing when
 * the map governs no present event or every entry alternates cleanly.
 *
 * This reads only existing typed fields (eventType, sequenceNumber, moduleId,
 * outcome) plus the injected map — no new record shape, no uniqueness field.
 */
function detectReentry(
  entries: readonly MicaLogRecord[],
  reentry: ReentryMap
): Finding[] {
  const inOrder = [...entries].sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber
  );
  const findings: Finding[] = [];
  for (const entry of inOrder) {
    if (!Object.prototype.hasOwnProperty.call(reentry, entry.eventType)) continue;
    const clears = reentry[entry.eventType];
    // Fold the priors in order: the state turns active on a same-kind enter and
    // inactive on any declared clear. If it is active when we reach THIS enter,
    // the record enters a state it never left.
    let active = false;
    for (const prior of inOrder) {
      if (prior.sequenceNumber >= entry.sequenceNumber) break;
      if (prior.eventType === entry.eventType) active = true;
      else if (clears.includes(prior.eventType)) active = false;
    }
    if (active) {
      findings.push({
        code: "SIG_F2_STATE_ALREADY_ACTIVE",
        detail:
          `seq ${entry.sequenceNumber} (${entry.moduleId}/${entry.eventType}, ` +
          `outcome "${entry.outcome}") enters a state that is ALREADY ACTIVE: an ` +
          `earlier ${entry.eventType} appears at a lower sequenceNumber with no ` +
          `intervening clear from [${clears.join(", ")}]. The record re-enters a ` +
          `state it never left — a duplicate/re-entry the positive precondition ` +
          `check cannot see, because a required prior IS present.`,
      });
    }
  }
  return findings;
}

/**
 * F2, composed. The positive check runs exactly as it always has (byte-identical
 * when no reentryMap is injected). The negative check layers ON TOP: a re-entry
 * violation turns F2 to ALARM and rides its finding alongside whatever the
 * positive check said. An absent or clean re-entry map returns the positive
 * report untouched — the fence that keeps the frozen verdict from moving.
 */
function runF2(
  entries: readonly MicaLogRecord[],
  config: SigConfig | undefined
): FlagReport {
  const base = runF2Positive(entries, config);

  const reentry = config?.reentryMap;
  if (reentry === undefined || Object.keys(reentry).length === 0) {
    return base; // no negative element injected -> verdict byte-identical
  }

  const reentryFindings = detectReentry(entries, reentry);
  if (reentryFindings.length === 0) {
    return base; // clean or ineligible re-entry scope -> verdict byte-identical
  }

  // A re-entry violation lowers the bound. It composes non-compensatorily with
  // the positive check: the alarm stands whatever the positive check read, and
  // any positive blind path is carried alongside rather than dropped.
  return {
    flag: "F2",
    name: base.name,
    kind: "ALARM",
    findings: [...base.findings, ...reentryFindings],
    blindPaths: base.blindPaths,
    scopeSize: base.scopeSize,
  };
}

// ── F3 · declared clock vs clerk receipt order ───────────────────────────────
//
// F1 remains the self-consistency leg. F3 is the independent-axis leg: it joins
// each declared record to the receipt L0 obtained, orders the records by the
// clerk's counter, and asks whether declared time runs backwards in that order.
// The clerk attests arrival/order/integrity-since-arrival only. It does not make
// the payload true, and this axis is independent of the observed party only
// when deployment actually supplies principal separation.

/**
 * F3's whole output: the report that COMPOSES, and the disclosure that DOES NOT.
 *
 * Split because they have different destinations and the difference is ruled.
 * `report` is a `FlagReport` and two of them are frozen byte-for-byte;
 * `coverage`/`deviation` ride on `SigResult`, outside the frozen grammar. See
 * the comment on `F3StampCoverage`.
 */
/**
 * T9 · `runF1`'s report AND its deviation, in T3's shape.
 *
 * ⛔ WHY AN OUTCOME OBJECT AND NOT A WIDER `FlagReport`. `FlagReport` is the
 * shape ALL FOUR legs share and that `flags[]` is built from; an F1-only field
 * on it would be `undefined` forever on F2, F3 and F4 and would read as "this
 * leg has no deviation" rather than "this field is not that leg's". T3 made
 * exactly this call for F3, and the arbiter's ruling of 2026-09-29 17:4xZ is
 * that F1 follows it rather than inventing a second mechanism.
 *
 * ⚠ AND IT REPLACES A MODULE-LOCAL CARRIER THAT WORKED. The first build of T9
 * handed the deviation out through a file-scoped `let`, cleared before each
 * call, with the staleness hazard pinned by its own test. It passed. THE
 * OUTCOME OBJECT IS BETTER FOR A REASON NO TEST WOULD HAVE SHOWN: a value
 * returned cannot be read out of order, so the hazard does not need a test at
 * all. A design whose failure mode has to be tested for is weaker than one
 * where it cannot arise.
 */
interface F1Outcome {
  readonly report: FlagReport;
  readonly deviation: F1Deviation | null;
}

interface F3Outcome {
  readonly report: FlagReport;
  readonly coverage: F3StampCoverage | null;
  readonly deviation: F3Deviation | null;
}

/** The token that opens a stale-axis blind path's detail. See AXIS_STALE below. */
export const F3_AXIS_STALE_TOKEN = "AXIS_STALE";
/** The token that opens a carrier-skipped (HOLE) blind path's detail. */
export const F3_CARRIER_SKIPPED_TOKEN = "CARRIER_SKIPPED";
/** The token that opens a foreign-chain refusal's detail. */
export const F3_CHAIN_IDENTITY_MISMATCH_TOKEN = "CHAIN_IDENTITY_MISMATCH";
/**
 * T8 · the token that opens an UNATTRIBUTED-stamp refusal's detail.
 *
 * ⛔ IT IS A SEPARATE TOKEN FROM `CHAIN_IDENTITY_MISMATCH` ON PURPOSE, and the
 * distinction is the one an operator needs at 3am. MISMATCH means a stamp from
 * ANOTHER chain arrived here — the axis is CONTAMINATED, someone pointed the
 * carrier at the wrong file or a rotation was half-done. MISSING means the
 * stamps carry no chain claim at all — the axis is OLD, written by a carrier
 * from before T8, and the remedy is a re-stamp rather than an investigation.
 * One token for both would make the file that needs re-stamping look like the
 * file that needs a human.
 */
export const F3_CHAIN_IDENTITY_MISSING_TOKEN = "CHAIN_IDENTITY_MISSING";
/**
 * T6 remedy · the token that opens a WRITER-IDENTITY mismatch blind path.
 *
 * A sequence that carries stamps of which NONE agrees with the record's own
 * writer is NOT an unstamped record. The carrier visited it and produced
 * something F3 refuses to use, so "not reached yet" is a false description of it.
 */
export const F3_WRITER_IDENTITY_MISMATCH_TOKEN = "WRITER_IDENTITY_MISMATCH";

// ── WHY AXIS_STALE IS A DETAIL PREFIX AND NOT A BlindPathClass MEMBER ────────
//
// `BlindPathClass` lives in `../types` and is a CLOSED UNION SHARED BY EVERY
// SENSOR. Widening it to buy ONE leg a finer word would reach W, R, K, T, Eng,
// the gate suite and the export filter, and `src/mica/types.ts` is not opened
// by ticket T3-sig-f3-watermark — correctly, because the ticket opens the core
// for one defect and a shared union is not that defect.
//
// The house already has the route: `chokepoint/index.ts:105` — "The gap
// detector's finer blind vocabulary has no member on BlindPathClass, so ..."
// — and maps instead. F3 takes the same route. The class is INELIGIBLE_SCOPE
// (the scope F3 was asked to read is not one it can honestly read this run)
// and the finer word rides at the FRONT of the detail, where a reader and a
// grep both find it.
//
// This costs nothing legible: the substrate snapshot projects `blindClasses`
// and NOT prose, and no consumer switches on the class (`export/index.ts`
// prints it and filters only NOT_DELIVERED). It buys the ticket staying inside
// its own five files.

function runF3(
  entries: readonly MicaLogRecord[],
  config: SigConfig | undefined
): F3Outcome {
  const name = "declared clock vs clerk clock";
  const source = config?.clerkClockSource;
  // A leg that was CONFIGURED but could not read is a verdict-bearing blind leg:
  // CANNOT_ASSESS, and it composes into the floor (F5). This is used for every
  // "we had a source and it did not hold up" path below.
  const missing = (detail: string): FlagReport => ({
    flag: "F3",
    name,
    kind: "CANNOT_ASSESS",
    findings: [],
    blindPaths: [{ class: "MISSING_CONFIGURATION", detail }],
    scopeSize: 0,
  });
  /** A blind leg whose finer vocabulary rides in the detail. See the block above. */
  const ineligible = (token: string, detail: string): FlagReport => ({
    flag: "F3",
    name,
    kind: "CANNOT_ASSESS",
    findings: [],
    blindPaths: [{ class: "INELIGIBLE_SCOPE", detail: `${token}: ${detail}` }],
    scopeSize: 0,
  });

  // A leg with NO source injected at all is genuinely OPTIONAL-UNCONFIGURED. Per
  // the F5 honest split (arbiter-ruled a), this is NOT_CONFIGURED — a distinct
  // NON-VERDICT status, disclosed but excluded from the floor — NOT an Option-B
  // CANNOT_ASSESS that is silently dropped. It preserves the ruled dormancy of an
  // unconfigured F3 without the fail-open of a named-but-dropped blind leg.
  if (source === undefined || source.length === 0) {
    return {
      report: {
        flag: "F3",
        name,
        kind: "NOT_CONFIGURED",
        findings: [],
        blindPaths: [
          {
            class: "MISSING_CONFIGURATION",
            detail:
              source === undefined
                ? "no clerkClockSource was injected. F3 holds no clerk-time source of its own and does not infer one; the independent clock scope was NOT CONFIGURED this run. This is a dormant, unconfigured leg — disclosed here, and it does NOT lower the verdict bound (F5 honest split: unconfigured is NOT_CONFIGURED, not a blind CANNOT_ASSESS)."
                : "an EMPTY clerkClockSource was injected. An empty source is nothing to read; the independent clock scope was NOT CONFIGURED this run. Disclosed here; it does NOT lower the verdict bound (F5 honest split).",
          },
        ],
        scopeSize: 0,
      },
      coverage: null,
      deviation: null,
    };
  }

  for (const stamp of source) {
    if (
      !Number.isInteger(stamp.sequenceNumber) ||
      !Number.isInteger(stamp.clerk_seq) ||
      stamp.clerk_seq < 0 ||
      !Number.isFinite(stamp.clerk_time?.wall_ms) ||
      typeof stamp.clerk_time?.monotonic_ns !== "string" ||
      stamp.clerk_time.monotonic_ns.length === 0 ||
      // T3(3): a chainIdentity key that is present but not a usable string is a
      // MALFORMED stamp, not an absent identity. F3 refuses it rather than
      // silently demoting it to "unattributed", which would let a writer buy
      // today's behaviour by emitting `chainIdentity: ""`.
      (stamp.chainIdentity !== undefined &&
        (typeof stamp.chainIdentity !== "string" ||
          stamp.chainIdentity.length === 0))
    ) {
      return {
        report: missing(
          "clerkClockSource contains a malformed stamp; F3 refuses to substitute or repair it."
        ),
        coverage: null,
        deviation: null,
      };
    }
  }

  // ── T3(3) · chain identity, BEFORE the join and before the duplicate check ──
  //
  // Order matters and is not arbitrary. A stamp that names ANOTHER chain is not
  // a competing stamp for this chain's seq N — it is not this chain's stamp at
  // all. Filtering it first means the duplicate refusal below keeps meaning
  // what it has always meant (two stamps for one record of THIS chain), and it
  // means the reason a reader is given names the CAUSE (a foreign chain) rather
  // than the symptom (a collision the foreign stamp created).
  const expected = config?.expectedChainIdentity;
  const expectedUsable = typeof expected === "string" && expected.length > 0;
  const kept: ClerkClockStamp[] = [];
  const refusedIdentities = new Set<string>();
  let refusedChainStampCount = 0;
  let unattributedStampCount = 0;
  let unverifiedAttributionCount = 0;
  //
  // ── T8 · THE ONLY ARM THAT JOINS IS THE ONE THAT MATCHES ───────────────────
  //
  // T3 shipped this filter with three joining arms and one refusing arm. T8
  // leaves ONE joining arm. The arbiter's word: "every clerk stamp F3 uses must
  // name the chain it belongs to, and a stamp with no chain identity or
  // another chain's is refused, not joined and not excused as unattributed".
  //
  // THE COUNTERS DO NOT DISAPPEAR AND DELIBERATELY KEEP THEIR NAMES — T8
  // condition 2: "they become counts of REFUSED stamps rather than joined ones,
  // so the number stays readable across the change". An operator comparing a
  // reading from before this ticket with one from after sees the same field
  // names and a changed meaning that the disclosure below states in words,
  // rather than a field that vanished and a number they cannot line up.
  for (const stamp of source) {
    const ci = stamp.chainIdentity;
    if (ci === undefined) {
      // ⛔ REFUSED under T8. `unattributed` was the permission this ticket
      // removes; the count survives as a count of refusals.
      unattributedStampCount++;
    } else if (!expectedUsable) {
      // ⛔ REFUSED under T8. A claim with nothing to check it against is not a
      // checked claim, and F3 will not join one. THIS IS THE ARM A DEPLOYMENT
      // LANDS IN WHEN IT FORGETS TO INJECT `expectedChainIdentity` — refusing
      // here is what stops that omission from buying a full set of joins.
      unverifiedAttributionCount++;
    } else if (ci === expected) {
      kept.push(stamp);
    } else {
      // REFUSED, NEVER JOINED — unchanged from T3, in the arbiter's words.
      refusedChainStampCount++;
      refusedIdentities.add(ci);
    }
  }

  // ── T6 · SEQUENCE STAYS THE KEY; THE STAMP'S WRITER IS A CLAIM TO CHECK ─────
  //
  //   T3(1) above states why the stamp's `moduleId` is NOT a key: it is the
  //   carrier's reading of a record it visited, and keying on it would let a
  //   mislabelled stamp move another writer's watermark — the fail-open. That
  //   holds. This block does not touch it: NOTHING here indexes by the stamp's
  //   moduleId and no watermark is computed from it.
  //
  //   What changes is that the claim is now CHECKED instead of ignored. The
  //   RECORD's identity is authoritative. A stamp landing on sequence N whose
  //   moduleId disagrees with the record at sequence N is DISCLOSED and NEVER
  //   USED; the record is simply left unstamped and falls to the per-writer
  //   watermark below — tail if above its writer's mark, hole if beneath it.
  //
  //   ⛔ AND THE BLANKET REFUSAL GOES. Until T6 two stamps at one sequence
  //   returned `missing(...)` for the WHOLE LEG. The live
  //   `/var/lib/mica/clerk-clock-stamps.jsonl` holds 27 stamps with TEN
  //   duplicated sequence numbers (S7 in the test file), so the real file blinded
  //   F3 outright and every item of T3 was unreachable on the box it was built
  //   for. Duplicates are now resolved by the same authority as everything else:
  //   the ones that disagree with the record are discarded and disclosed. Only
  //   when MORE THAN ONE stamp still AGREES with the record is there a genuine
  //   ambiguity — one writer stamping its own sequence twice — and that is
  //   disclosed per sequence and leaves the record unstamped, rather than
  //   blinding a leg that can still read every other record.
  const stampsAtSequence = new Map<number, ClerkClockStamp[]>();
  for (const stamp of kept) {
    const at = stampsAtSequence.get(stamp.sequenceNumber);
    if (at === undefined) stampsAtSequence.set(stamp.sequenceNumber, [stamp]);
    else at.push(stamp);
  }

  let mismatchedWriterStampCount = 0;
  const mismatchedWriterIdentities = new Set<string>();
  const ambiguousSequences: number[] = [];
  const rejectedMismatchSequences: number[] = [];

  const joined = entries.map((entry) => {
    const at = stampsAtSequence.get(entry.sequenceNumber) ?? [];
    const agreeing: ClerkClockStamp[] = [];
    for (const stamp of at) {
      if (stamp.moduleId === entry.moduleId) agreeing.push(stamp);
      else {
        mismatchedWriterStampCount++;
        mismatchedWriterIdentities.add(stamp.moduleId);
      }
    }
    if (agreeing.length > 1) {
      ambiguousSequences.push(entry.sequenceNumber);
      return { entry, stamp: undefined };
    }
    // ⛔ T6 REMEDY · STAMPS EXISTED HERE AND NONE OF THEM AGREED. That is not an
    // unstamped record and it must never be filed as one — see the interception
    // in the tail/hole split below.
    if (agreeing.length === 0 && at.length > 0) {
      rejectedMismatchSequences.push(entry.sequenceNumber);
    }
    return { entry, stamp: agreeing[0] };
  });
  const stamped = joined.filter(
    (j): j is { entry: MicaLogRecord; stamp: ClerkClockStamp } =>
      j.stamp !== undefined
  );

  // ── T3(1) · THE PER-WRITER HIGH-WATER MARK. Not a prefix. ───────────────────
  //
  // THE SHAPE, and getting it wrong here is a FAIL-OPEN, not a rough edge:
  //
  //   The carrier's cursor is PER-moduleId — it filters
  //   `last === undefined || r.sequenceNumber > last` per writer and advances
  //   per writer, because sequence numbers "do not compare across" writers.
  //   But the subject chain's `sequenceNumber` is GLOBAL
  //   (`sequenceNumber = this.chain.length`) while its `moduleId` is MANY
  //   writers: seq 0 is the boundary record's writer, seq 1 an agent, and so on.
  //
  //   So THE STAMPED SET IS DOWNWARD-CLOSED PER WRITER, NOT A PREFIX OF THE LOG.
  //   A single global watermark cannot express that and is wrong in BOTH
  //   directions: with writer A stamped to seq 10 and writer B unstamped at
  //   seq 5, a global mark of 10 either DEMANDS a stamp for B's 5 that no run
  //   will produce (which is the daily CANNOT_ASSESS this repair exists to
  //   remove), or FILES B's genuinely skipped record into the "tail" and calls
  //   it fresh — a silent fail-open on the one record that was actually missed.
  //
  // KEYED ON THE RECORD'S OWN moduleId, NOT THE STAMP'S. The watermark answers
  // "how far did the carrier get through THIS WRITER'S records", which is a fact
  // about the records. `ClerkClockStamp.moduleId` is the carrier's reading of
  // the record it stamped and is a separate claim; the fixtures in this repo
  // already show the two differing. Keying on the stamp would let a mislabelled
  // stamp move another writer's watermark, which is the fail-open again.
  const markByWriter = new Map<string, number>();
  for (const { entry } of stamped) {
    const prev = markByWriter.get(entry.moduleId);
    if (prev === undefined || entry.sequenceNumber > prev) {
      markByWriter.set(entry.moduleId, entry.sequenceNumber);
    }
  }

  const holeSequenceNumbers: number[] = [];
  const unreachedWriters = new Set<string>();
  let tailCount = 0;
  const rejectedSet = new Set(rejectedMismatchSequences);
  for (const { entry, stamp } of joined) {
    if (stamp !== undefined) continue;
    // ⛔ T6 REMEDY, AND IT CLOSES A FAIL-OPEN THE FIRST T6 LEFT STANDING.
    //
    //   A record whose stamps were all REJECTED is not "unstamped". Before this
    //   interception it fell through to the split below, and ABOVE its writer's
    //   mark it was filed as an ordinary TAIL — disclosed, not charged. So a
    //   stamp carrying the WRONG WRITER could take a record that would otherwise
    //   have ALARMED and turn the leg SILENT, which is the fail-open one step
    //   over from the one T6 was written to close.
    //
    //   PLACEMENT IS IRRELEVANT BY RULING (The arbiter, 2026-09-28): a rejected stamp
    //   is never tail and never merely a hole, at ANY position. The carrier
    //   VISITED this record and produced something F3 refuses to use; "not
    //   reached yet" is a false description of it.
    if (rejectedSet.has(entry.sequenceNumber)) continue;
    const mark = markByWriter.get(entry.moduleId);
    if (mark !== undefined && entry.sequenceNumber < mark) {
      // A HOLE. The carrier went PAST this record for this writer and did not
      // stamp it. That is a skip, and a skip is evidence.
      holeSequenceNumbers.push(entry.sequenceNumber);
    } else {
      // A TAIL. The carrier has not reached it yet. Disclosed, not charged.
      tailCount++;
      if (mark === undefined) unreachedWriters.add(entry.moduleId);
    }
  }

  // Stamps this log has no record for. Nothing today looks at them at all —
  // every existing check runs over the JOINED subset — so they were invisible.
  // Disclosed, never charged: a stamp for a record F3 was not handed is not
  // evidence about this log.
  const unjoinableStampCount = kept.length - stamped.length;

  const newestStampedWallMs =
    stamped.length === 0
      ? null
      : stamped.reduce(
          (max, { stamp }) => Math.max(max, stamp.clerk_time.wall_ms),
          Number.NEGATIVE_INFINITY
        );

  // ── T3(2) · THE STALENESS CLOCK IS THE AXIS UNDER SUSPICION ─────────────────
  //
  // `assessSig` is PURE — no `Date.now()` anywhere in this file — so `now` is
  // INJECTED or the bound is not evaluated. And the measurement is taken from
  // the NEWEST STAMPED RECORD'S `clerk_time.wall_ms`: "how long since the axis
  // last spoke".
  //
  // NOT from the tail's own timestamps. The tail's records carry only a
  // DECLARED timestamp, supplied by the party F3 exists to doubt, and by
  // construction they have no clerk time at all — that is what makes them tail.
  // Built the obvious way, A SUBJECT THAT BACKDATES ITS TAIL HIDES STALENESS
  // FROM THE CHECK MEANT TO CATCH IT.
  const lagBoundRaw = config?.clerkStampLagBoundMs;
  const lagBoundMs =
    typeof lagBoundRaw === "number" &&
    Number.isFinite(lagBoundRaw) &&
    lagBoundRaw >= 0
      ? lagBoundRaw
      : null;
  const readAtRaw = config?.readAtMs;
  const readAtMs =
    typeof readAtRaw === "number" && Number.isFinite(readAtRaw)
      ? readAtRaw
      : null;
  const axisSilentForMs =
    readAtMs !== null && newestStampedWallMs !== null
      ? readAtMs - newestStampedWallMs
      : null;
  // An empty tail is not a staleness question: nothing is unread, so there is
  // nothing for the bound to be about. And ABSENT BOUND OR ABSENT NOW MEANS
  // DISCLOSE, NOT HOLD — a bound that cannot be read must not manufacture a
  // hold. `[owed → the arbiter]` records that this fork was taken by the builder.
  const lagBoundEvaluated =
    tailCount > 0 && lagBoundMs !== null && axisSilentForMs !== null;
  const axisStale =
    lagBoundEvaluated && (axisSilentForMs as number) > (lagBoundMs as number);

  const coverage: F3StampCoverage = {
    stampedCount: stamped.length,
    tailCount,
    holeCount: holeSequenceNumbers.length,
    holeSequenceNumbers,
    unreachedWriters: [...unreachedWriters].sort(),
    newestStampedWallMs,
    readAtMs,
    lagBoundMs,
    axisSilentForMs,
    lagBoundEvaluated,
    axisStale,
    unjoinableStampCount,
    mismatchedWriterStampCount,
    mismatchedWriterIdentities: [...mismatchedWriterIdentities].sort(),
    ambiguousStampSequences: [...ambiguousSequences].sort((a, b) => a - b),
    rejectedMismatchSequenceNumbers: [...rejectedMismatchSequences].sort((a, b) => a - b),
    unattributedStampCount,
    unverifiedAttributionCount,
    refusedChainStampCount,
    refusedChainIdentities: [...refusedIdentities].sort(),
  };
  const out = (report: FlagReport, deviation: F3Deviation | null = null): F3Outcome => ({
    report,
    coverage,
    deviation,
  });

  // A foreign chain's stamp arrived in this source. Named before the hole it may
  // have created, so the reader is given the cause and not the symptom.
  if (refusedChainStampCount > 0) {
    return out(
      ineligible(
        F3_CHAIN_IDENTITY_MISMATCH_TOKEN,
        `${refusedChainStampCount} stamp(s) in clerkClockSource name chain identity ` +
          `[${[...refusedIdentities].sort().join(", ")}] while this run was told to expect ` +
          `${expected}. They are REFUSED, never joined: sequence numbers restart at chain ` +
          `rotation, so joining them would report a real clerk receipt against the wrong ` +
          `record — a confident wrong answer, which is worse than a refusal. F3 cannot ` +
          `establish a clean scope over a source that carries another chain's receipts.`
      )
    );
  }

  // ── T8 · A STAMP THAT DOES NOT NAME THIS CHAIN IS REFUSED, AND SAYS SO ─────
  //
  // Ticket fail condition (d): "F3 returns SILENT over a set that includes any
  // refused stamp — a leg that refuses evidence and then reports a clean read
  // is worse than one that never checked." This block is what makes (d)
  // unreachable. Without it the refused stamps would simply vanish from `kept`
  // and the leg would report an ordinary empty-or-short scope: a refusal
  // NOBODY COULD SEE, which is the exact shape this deployment has found five
  // times this week.
  //
  // Placed AFTER the foreign-chain arm so the more specific cause wins: a
  // source carrying another chain's receipts is contaminated, and that is worth
  // saying before "and also some stamps were unattributed".
  if (unattributedStampCount > 0 || unverifiedAttributionCount > 0) {
    const why = !expectedUsable
      ? `NO expectedChainIdentity WAS INJECTED INTO THIS RUN, so no stamp could be ` +
        `attributed to this chain even if it carried a claim. That is a WIRING fault in ` +
        `the caller, not a fault in the stamps: F3 refuses rather than joining unchecked ` +
        `claims, because a deployment that forgets to inject the expected identity must ` +
        `not thereby buy a full set of joins.`
      : `They were written by a carrier from before chain identity was mandatory. THE ` +
        `REMEDY IS A RE-STAMP, not an investigation: archive the stamps file and its ` +
        `cursor and let the carrier run once more against the current chain.`;
    return out(
      ineligible(
        F3_CHAIN_IDENTITY_MISSING_TOKEN,
        `${unattributedStampCount} stamp(s) carry NO chainIdentity and ` +
          `${unverifiedAttributionCount} carry one this run could not check. ALL OF THEM ARE ` +
          `REFUSED and none is joined. A stamp that does not name its chain is a claim about ` +
          `a NUMBER, not about a RECORD: sequence numbers restart at rotation, so joining it ` +
          `would report a real clerk receipt against a record it has never seen. ${why}`
      )
    );
  }

  // A HOLE: the carrier passed this writer and skipped this record.
  if (rejectedMismatchSequences.length > 0) {
    return out(
      ineligible(
        F3_WRITER_IDENTITY_MISMATCH_TOKEN,
        `local sequenceNumber(s) [${rejectedMismatchSequences.join(", ")}] carry clerk stamp(s) ` +
          `of which NONE names the writer that wrote the record. The carrier reached these ` +
          `records and produced a claim F3 refuses to use, so they are neither an unstamped ` +
          `tail nor a carrier skip — they are READ BY SOMETHING THAT DISAGREES WITH THE RECORD. ` +
          `F3 will not call the scope clean over them at any placement, above or below any ` +
          `writer's mark. Claimed writer(s): [${[...mismatchedWriterIdentities].sort().join(", ")}]. ` +
          `(${mismatchedWriterStampCount} stamp(s) discarded in total.)`
      )
    );
  }

  if (holeSequenceNumbers.length > 0) {
    return out(
      ineligible(
        F3_CARRIER_SKIPPED_TOKEN,
        `local sequenceNumber(s) [${holeSequenceNumbers.join(", ")}] carry no stamp and sit ` +
          `BELOW their own writer's stamped high-water mark, so the carrier reached past them ` +
          `and did not stamp them. That is a SKIP, not a lag: a skipped record is unread ` +
          `evidence inside the range F3 claims to have read, and F3 will not call the scope ` +
          `clean over it. (${tailCount} further record(s) sit ABOVE the mark and are the ` +
          `ordinary unstamped tail — those are disclosed on SigResult and do not blind this leg.)`
      )
    );
  }

  const unsupported = stamped.filter(
    ({ stamp }) =>
      stamp.separation !== "SEPARATE_PROCESS" || stamp.intake !== "SOCKET"
  );
  if (unsupported.length > 0) {
    return out(
      missing(
        "the injected receipts do not demonstrate the required boundary (separation=SEPARATE_PROCESS and intake=SOCKET). An in-process/local-call clock is disclosed, never promoted to F3's independent axis."
      )
    );
  }

  const clerkIds = new Set(stamped.map(({ stamp }) => stamp.clerk_id));
  if (clerkIds.size !== 1) {
    return out(
      missing(
        "clerkClockSource spans multiple clerk_id values; F3 cannot treat separate counters as one receipt order."
      )
    );
  }

  const inClerkOrder = [...stamped].sort(
    (a, b) => a.stamp.clerk_seq - b.stamp.clerk_seq
  );
  for (let i = 1; i < inClerkOrder.length; i++) {
    if (inClerkOrder[i - 1].stamp.clerk_seq === inClerkOrder[i].stamp.clerk_seq) {
      return out(
        missing(
          `clerkClockSource repeats clerk_seq ${inClerkOrder[i].stamp.clerk_seq}; F3 cannot establish a unique receipt order.`
        )
      );
    }
  }

  const pairCount = Math.max(0, inClerkOrder.length - 1);
  if (pairCount === 0) {
    return out({
      flag: "F3",
      name,
      kind: "CANNOT_ASSESS",
      findings: [],
      blindPaths: [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `clerkClockSource joins ${inClerkOrder.length} record(s), so no adjacent ` +
            "pair exists in clerk receipt order. F3's scope is empty; it is not clean.",
        },
      ],
      scopeSize: 0,
    });
  }

  const tolerance = config?.clockToleranceMs;
  if (
    typeof tolerance !== "number" ||
    !Number.isFinite(tolerance) ||
    tolerance < 0
  ) {
    return out(
      missing(
        "clockToleranceMs was not injected as a finite, non-negative number, so F3 cannot calibrate a declared-time inversion."
      )
    );
  }

  const findings: Finding[] = [];
  // T3(4): the largest deviation, kept as a NUMBER. It was always computed here
  // and then survived only inside the finding's prose; recovering it meant
  // parsing a reader's English for a number the reader already had.
  let maxDeclaredInversionMs = Number.NEGATIVE_INFINITY;
  for (let i = 1; i < inClerkOrder.length; i++) {
    const prev = inClerkOrder[i - 1];
    const curr = inClerkOrder[i];
    const delta = prev.entry.timestamp - curr.entry.timestamp;
    if (delta > maxDeclaredInversionMs) maxDeclaredInversionMs = delta;
    if (delta > tolerance) {
      findings.push({
        code: "SIG_F3_DECLARED_VS_CLERK_CLOCK_CONTRADICTION",
        detail:
          `clerk_seq ${prev.stamp.clerk_seq} (clerk_time.wall_ms ` +
          `${prev.stamp.clerk_time.wall_ms}) carries local seq ` +
          `${prev.entry.sequenceNumber} with declared timestamp ${prev.entry.timestamp}; ` +
          `the next receipt, clerk_seq ${curr.stamp.clerk_seq} ` +
          `(clerk_time.wall_ms ${curr.stamp.clerk_time.wall_ms}), carries local seq ` +
          `${curr.entry.sequenceNumber} with declared timestamp ${curr.entry.timestamp}, ` +
          `which is ${delta} earlier — beyond clockToleranceMs ${tolerance}. The ` +
          "declared clock contradicts the clerk's independently stamped arrival order. " +
          "This binds arrival/order only, never payload truth, and the independent-axis " +
          "claim requires deployment under a genuinely separate OS principal.",
      });
    }
  }
  const deviation: F3Deviation = {
    maxDeclaredInversionMs,
    clockToleranceMs: tolerance,
    distanceMs: maxDeclaredInversionMs - tolerance,
    pairsCompared: pairCount,
  };

  // ── T3(2) · AXIS_STALE, and WHY IT DOES NOT OUTRANK AN ALARM ────────────────
  //
  // If the stamped part of the log CONTRADICTS ITSELF, that is a positive
  // reading over records the clerk actually receipted, and a stale tail does not
  // unmake it. Returning CANNOT_ASSESS here would SUPPRESS A REAL ALARM and
  // raise the composite floor from ALARM to CANNOT_ASSESS — a fail-open dressed
  // as caution. So the alarm is reported and the stale path rides alongside it,
  // where `assessSig` already turns a blind path on an alarming leg into a
  // SIG_SCOPE_UNREAD finding beside the contradiction.
  const stalePath: BlindPath | null = axisStale
    ? {
        class: "INELIGIBLE_SCOPE",
        detail:
          `${F3_AXIS_STALE_TOKEN}: the clerk axis has been silent for ` +
          `${axisSilentForMs} ms, beyond the declared clerkStampLagBoundMs ` +
          `${lagBoundMs}, while ${tailCount} record(s) wait unstamped. Measured from ` +
          `the NEWEST STAMPED record's clerk_time.wall_ms ${newestStampedWallMs} ` +
          `against the injected readAtMs ${readAtMs} — never from the tail's own ` +
          `declared timestamps, which are the axis under suspicion. The carrier ` +
          `has stopped speaking for longer than this deployment declared it may, ` +
          `so the unstamped tail is no longer a lag F3 can wait out and this leg ` +
          `does not claim a clean scope over it.`,
      }
    : null;

  if (findings.length > 0) {
    return out(
      {
        flag: "F3",
        name,
        kind: "ALARM",
        findings,
        blindPaths: stalePath === null ? [] : [stalePath],
        scopeSize: pairCount,
      },
      deviation
    );
  }

  if (stalePath !== null) {
    return out(
      {
        flag: "F3",
        name,
        kind: "CANNOT_ASSESS",
        findings: [],
        blindPaths: [stalePath],
        scopeSize: pairCount,
      },
      deviation
    );
  }

  return out(
    {
      flag: "F3",
      name,
      kind: "SILENT",
      findings,
      blindPaths: [],
      scopeSize: pairCount,
    },
    deviation
  );
}

// ── F4 · sealed expectation vs observed result ────────────────────────────────
//
// WHAT THIS LEG CLAIMS, AND NOTHING WIDER:
//
//   A sealed prediction and an observed result DIVERGED.
//
// WHAT IT NEVER CLAIMS — printed on every verdict this leg produces:
//
//   Motive. Honesty. Disposition. Competence. A divergence is a divergence: a
//   system that predicted wrong and recorded the miss faithfully has a CLEAN
//   record and a wrong prediction, and F4 cannot tell that apart from a lie. It
//   does not try. It names the two values and stops.
//
//   AND A MATCH CERTIFIES NOTHING. This is a negative attestation, like every
//   instrument in MICA: it reads un-health. A prediction that came true is
//   consistent with a well-oriented system, with luck, and with a prediction
//   chosen because it was safe. F4 SILENT is the absence of a caught
//   divergence, never evidence that the committer is reliable.
//
// WHY IT DOES NOT JOIN TO THE LOG — a real difference from F3 `[LB]`:
//
//   F3 joins each clerk stamp to a MicaLogRecord by sequenceNumber; its scope is
//   pairs of log records. F4 HAS NOTHING TO JOIN TO. A probe's subject is an
//   entry in the assembler's precommit book, not a record in the log Sig was
//   pointed at, and the two carry unrelated sequence numbers. So this function
//   takes no `entries` parameter, and its `scopeSize` counts PROBE RECORDS, not
//   log records — the only leg here of which that is true. The F3 template fits
//   F4's CONFIG posture exactly (option-B injected, no fallback, refuse to
//   repair) and does NOT fit its JOIN. Stated rather than papered over.
//
// THE SEAL IS NOT THE PREDICTION'S TRUTH, AND THE TWO ARE EASY TO CONFLATE:
//
//   `sealCheck` answers "was the revealed plaintext the one that was committed" —
//   seal integrity. It says NOTHING about whether the prediction came true. F4
//   answers the second question and only the second, and it requires the first
//   to have been answered MATCH before it will ask.

function runF4(config: SigConfig | undefined): FlagReport {
  const name = "sealed expectation vs observed result";
  const source = config?.probeSource;

  // A leg that WAS configured but could not read is verdict-bearing: it lowers
  // the bound (F5 honest split). Used for every refuse-to-repair path below.
  const blind = (detail: string): FlagReport => ({
    flag: "F4",
    name,
    kind: "CANNOT_ASSESS",
    findings: [],
    blindPaths: [{ class: "MISSING_CONFIGURATION", detail }],
    scopeSize: 0,
  });

  if (source === undefined || source.length === 0) {
    return {
      flag: "F4",
      name,
      kind: "NOT_CONFIGURED",
      findings: [],
      blindPaths: [
        {
          class: "MISSING_CONFIGURATION",
          detail:
            source === undefined
              ? "no probeSource was injected. F4 holds no expectation of its own, mints none, and reads no book; an expectation held outside is a deployment fact this sensor has no access to. The probe-divergence scope was NOT CONFIGURED this run — a dormant, unconfigured leg, disclosed here, and it does NOT lower the verdict bound (F5 honest split: unconfigured is NOT_CONFIGURED, not a blind CANNOT_ASSESS)."
              : "an EMPTY probeSource was injected. An empty source is nothing to read; the probe-divergence scope was NOT CONFIGURED this run. Disclosed here; it does NOT lower the verdict bound (F5 honest split).",
        },
      ],
      scopeSize: 0,
    };
  }

  // ── Refuse to repair ──────────────────────────────────────────────────────
  //
  // A malformed record is a CONFIGURED leg that could not read: CANNOT_ASSESS,
  // and it lowers the bound. F4 never substitutes, defaults, trims or coerces.
  const seen = new Set<number>();
  for (const r of source) {
    const bad = malformedProbeRecord(r);
    if (bad !== null) {
      return blind(
        `probeSource contains a malformed record (${bad}); F4 refuses to substitute or repair it.`
      );
    }
    if (seen.has(r.commitmentSeq)) {
      return blind(
        `probeSource contains more than one record for commitment sequence ${r.commitmentSeq}; F4 cannot choose between them.`
      );
    }
    seen.add(r.commitmentSeq);
  }

  // ── Scope ─────────────────────────────────────────────────────────────────
  //
  // F4's scope is the SEALED records. An UNSEALED probe result is not a failed
  // read of something in scope; it is out of scope, the way an eventType the
  // precondition map does not govern is out of F2's scope. Offer-not-impose:
  // absence of a seal is READABLE, NOT PUNISHABLE, and it is never an ALARM.
  const inScope = source.filter(isSealedProbe);
  const unsealedCount = source.length - inScope.length;

  // Counted, disclosed, and NOT charged to the verdict. An unsealed observation
  // is not unread evidence of this flag's subject — it is not evidence of this
  // flag's subject at all — so it rides in `outOfScope`, never in `blindPaths`.
  // Ruled S101: visibility = transparency. These belong countable inside the
  // sensor's own report, not in a side pile nothing consumes.
  const outOfScope: readonly OutOfScopeNote[] | undefined =
    unsealedCount === 0
      ? undefined
      : [
          {
            class: "UNSEALED_NO_EXPECTATION",
            count: unsealedCount,
            detail:
              `${unsealedCount} record(s) carry sealCheck UNSEALED: an observation ` +
              `was presented and NOTHING WAS EVER SEALED for it, so no expectation ` +
              `was held outside and there is no prediction to diverge from. They are ` +
              `counted here and read by nothing: absence of a seal is READABLE, NOT ` +
              `PUNISHABLE, and this count does not lower the verdict bound.`,
          },
        ];

  if (inScope.length === 0) {
    // Every record handed over is unsealed: no expectation was EVER held
    // outside, for any of them. That is the same epistemic position as no
    // source at all, so it takes the same status.
    //
    // THE FAIL-OPEN CHECK, because NOT_CONFIGURED is excluded from the floor and
    // that is exactly where a fail-open would hide: can a configured party HIDE
    // something by injecting only unsealed records? No. Injecting zero sealed
    // probes withholds precisely what injecting no source at all withholds, and
    // buys no silence that was not already available. Nothing is concealed by
    // the status, so the status is honest. (Contrast a MISMATCHed seal, which
    // IS a sealed expectation that could not be read — that lowers the bound.)
    return {
      flag: "F4",
      name,
      kind: "NOT_CONFIGURED",
      findings: [],
      blindPaths: [
        {
          class: "MISSING_CONFIGURATION",
          detail:
            `probeSource carries ${source.length} record(s) and NOT ONE of them is sealed ` +
            `(every sealCheck is UNSEALED). F4's subject is an expectation committed ` +
            `BEFORE the probe; with no seal anywhere in the source, no expectation was ` +
            `held outside for any probe here, which is the same position as no source at ` +
            `all. The probe-divergence scope was NOT CONFIGURED this run. Absence of a ` +
            `seal is readable, not punishable: it is disclosed here and it does NOT lower ` +
            `the verdict bound.`,
        },
      ],
      scopeSize: 0,
      outOfScope,
    };
  }

  const findings: Finding[] = [];
  const blindPaths: BlindPath[] = [];

  for (const r of inScope) {
    const who =
      `commitment seq ${r.commitmentSeq} (sealed ${r.sealedDigest}, ` +
      `committer "${r.committerId}", target "${r.target}", provenance "${r.provenance}")`;

    // A broken seal is the BOOK's finding, not Sig's — and it leaves F4 without
    // a prediction it can trust was the committed one. Blind, never an alarm.
    if (r.sealCheck === "MISMATCH") {
      blindPaths.push({
        class: "MISSING_CONFIGURATION",
        detail:
          `${who} carries sealCheck MISMATCH: the revealed plaintext does not hash to ` +
          `the committed digest, as decided by the book at reveal. There is therefore no ` +
          `trustworthy sealed prediction to compare against the observed result, and F4 ` +
          `reads this record as BLIND rather than as a divergence. Seal integrity is the ` +
          `book's finding and is not restated here as one of Sig's.`,
      });
      continue;
    }

    // Bar: within-sweep order is not evidence (board S100-B(3)). Without
    // established order, a "divergence" may be a prediction written after the
    // event. F4 says CANNOT_ASSESS on the record; it does not assert an order.
    if (r.orderEvidence !== "SEALED_BEFORE_OBSERVED") {
      blindPaths.push({
        class: "INELIGIBLE_SCOPE",
        detail:
          `${who} does not establish that the seal PREDATES the observation ` +
          `(orderEvidence ORDER_NOT_ESTABLISHED). F4's entire warrant is an expectation ` +
          `committed BEFORE the probe; where the order is not established the comparison ` +
          `could be reading a prediction written after the event it predicts. F4 asserts ` +
          `no order of its own and reads nothing here — CANNOT_ASSESS on this record, ` +
          `never an alarm on it.`,
      });
      continue;
    }

    // `claim+rule` is not mechanically comparable — adjudicating a claim against
    // a rule is a GRADER's act, and a sensor that performed it would be inventing
    // the judgement it claims to be reading.
    if (r.expectationType === "claim+rule") {
      blindPaths.push({
        class: "INELIGIBLE_SCOPE",
        detail:
          `${who} is of expectationType "claim+rule", which is not mechanically ` +
          `comparable: deciding whether a claim satisfies a rule is a GRADER's judgement, ` +
          `not a string comparison, and a sensor performing it would be inventing the ` +
          `verdict it claims to read. F4 compares "verdict" and "hash" expectations by ` +
          `exact equality and refuses to approximate the third.`,
      });
      continue;
    }

    if (r.predictedValue !== r.observed.observedValue) {
      findings.push({
        code: "SIG_F4_PROBE_DIVERGENCE",
        detail:
          `${who} sealed the prediction "${r.predictedValue}" for expectationType ` +
          `"${r.expectationType}" BEFORE the probe ran. The observed result, reported by ` +
          `"${r.observed.observedBy}" at ${r.observed.observedAt}, was ` +
          `"${r.observed.observedValue}". These diverge. This states ONLY that a ` +
          `pre-committed expectation and an observed result differ: it is not a claim ` +
          `about motive, honesty, or disposition, and a system that predicted wrong and ` +
          `recorded the miss faithfully produces this same finding. The seal binds WHEN ` +
          `the prediction was fixed, never whether the observation is true.`,
      });
    }
  }

  return {
    flag: "F4",
    name,
    kind:
      findings.length > 0
        ? "ALARM"
        : blindPaths.length > 0
          ? "CANNOT_ASSESS"
          : "SILENT",
    findings,
    // Blind records inside a scope that also produced findings ride alongside as
    // SIG_SCOPE_UNREAD, exactly as F1/F2/F3's unread scopes do. `unsealed` is not
    // among them: those records are out of scope, and the count is recoverable
    // from `probeSource` on the result, which the artifact prints.
    blindPaths,
    scopeSize: inScope.length,
    // Only set when there is something to count, so a report with no unsealed
    // records has no key at all and stays byte-identical to what it was.
    ...(outOfScope === undefined ? {} : { outOfScope }),
  };
}

/**
 * Structural validation for one injected probe record, KIND-AWARE.
 *
 * Returns null when the record is well-formed, or a short reason when it is not.
 * It repairs nothing, and it is strict in BOTH directions: a sealed record must
 * carry its seal, and an UNSEALED record must not carry one.
 *
 * ── WHAT CHANGED, AND WHY (ruled S101, option (a)) ──────────────────────────
 *
 * This function used to demand `sealedDigest`, `expectationType`,
 * `predictedValue`, `committerId` and `orderEvidence` on EVERY record, whatever
 * its `sealCheck`. That made the UNSEALED branch of this leg unreachable: a
 * record with no seal has none of those facts, so the only way past the
 * validator was to invent them. The leg therefore had a documented status no
 * honest producer could produce — found when it got its first producer.
 *
 * Now the seal-derived fields are required exactly when there IS a seal, and
 * FORBIDDEN when there is not. The second half is the new strictness: a record
 * claiming UNSEALED while carrying a digest is not a lenient case to wave
 * through, it is a contradiction inside one record — the shape of thing this
 * whole sensor exists to catch — and F4 throws it out loudly.
 */
function malformedProbeRecord(r: ProbeRecord): string | null {
  const str = (v: unknown): boolean => typeof v === "string" && v.length > 0;
  if (r === null || typeof r !== "object") return "not an object";

  // ── Facts every observation has, sealed or not ────────────────────────────
  if (!Number.isInteger(r.commitmentSeq) || r.commitmentSeq < 0)
    return "commitmentSeq is not a non-negative integer";
  if (!str(r.target)) return "target is not a non-empty string";
  if (!str(r.provenance)) return "provenance is not a non-empty string";
  const o = r.observed;
  if (o === null || typeof o !== "object") return "observed is not an object";
  if (typeof o.observedValue !== "string")
    return "observed.observedValue is not a string";
  if (!str(o.observedBy)) return "observed.observedBy is not a non-empty string";
  if (!Number.isFinite(o.observedAt))
    return "observed.observedAt is not a finite number";

  if (
    r.sealCheck !== "MATCH" &&
    r.sealCheck !== "MISMATCH" &&
    r.sealCheck !== "UNSEALED"
  )
    return "sealCheck is not one of MATCH/MISMATCH/UNSEALED";

  // ── No seal: the seal-derived facts must be ABSENT, not empty ─────────────
  //
  // Checked at runtime as well as in the type, because a record that arrived as
  // JSON never met the type at all — and JSON is how a ProbeSource crosses the
  // boundary from whoever assembled it.
  if (r.sealCheck === "UNSEALED") {
    const carried = (
      [
        ["sealedDigest", r.sealedDigest],
        ["expectationType", r.expectationType],
        ["predictedValue", r.predictedValue],
        ["committerId", r.committerId],
        ["orderEvidence", r.orderEvidence],
      ] as const
    ).filter(([, v]) => v !== undefined);
    if (carried.length > 0)
      return (
        `sealCheck is UNSEALED but the record carries ` +
        `${carried.map(([k]) => k).join(", ")}. A record claiming nothing was ` +
        `ever sealed for it cannot also carry the seal's own facts; an empty ` +
        `string here would be a manufactured value, and a populated one is a ` +
        `contradiction inside a single record`
      );
    return null;
  }

  // ── Sealed: the seal-derived facts must all be there ──────────────────────
  if (!str(r.sealedDigest)) return "sealedDigest is not a non-empty string";
  if (
    r.expectationType !== "verdict" &&
    r.expectationType !== "hash" &&
    r.expectationType !== "claim+rule"
  )
    return "expectationType is not one of verdict/hash/claim+rule";
  // ⚠ MAY BE EMPTY — corrected 2026-09-01 (S101) by the assembler build. The
  // precommit module documents `predictedValue` as "May be empty: a prediction
  // that a field will be empty is a prediction", refuses an empty `committerId`
  // and an empty `target` at deposit, and DELIBERATELY permits an empty
  // predicted value into the chain. `typeof` only, exactly as the book does it.
  if (typeof r.predictedValue !== "string")
    return "predictedValue is not a string";
  if (!str(r.committerId)) return "committerId is not a non-empty string";
  if (
    r.orderEvidence !== "SEALED_BEFORE_OBSERVED" &&
    r.orderEvidence !== "ORDER_NOT_ESTABLISHED"
  )
    return "orderEvidence is not one of SEALED_BEFORE_OBSERVED/ORDER_NOT_ESTABLISHED";
  return null;
}

// ── The sensor ────────────────────────────────────────────────────────────────

export function assessSig(
  log: MicaReadableLog,
  config?: SigConfig
): SigResult {
  // The injected gate list, normalised once. `null` means nothing usable was
  // injected — NEVER a substituted default.
  const injectedStates = config?.readableLoadStates;
  const readableLoadStates: readonly string[] | null = isUsableLoadStateList(
    injectedStates
  )
    ? injectedStates
    : null;

  // The injected precondition map, normalised once. `null` means nothing usable
  // was injected (absent OR empty) — the same usability test runF2 applies, and
  // NEVER a substituted default. Carried on the result so F2's scope is visible
  // even on a clean SILENT.
  const injectedMap = config?.preconditionMap;
  const preconditionMap: PreconditionMap | null =
    injectedMap !== undefined && Object.keys(injectedMap).length > 0
      ? injectedMap
      : null;

  // The injected re-entry map, normalised the same way. `null` = absent/empty =
  // re-entry scope not checked, disclosed here and in the export artifact.
  const injectedReentry = config?.reentryMap;
  const reentryMap: ReentryMap | null =
    injectedReentry !== undefined && Object.keys(injectedReentry).length > 0
      ? injectedReentry
      : null;

  const injectedClerkClock = config?.clerkClockSource;
  const clerkClockSource: ClerkClockSource | null =
    injectedClerkClock !== undefined && injectedClerkClock.length > 0
      ? injectedClerkClock
      : null;

  // The injected probe axis, normalised the same way. `null` = absent/empty =
  // the probe-divergence scope was not configured, disclosed here and in the
  // export artifact. NEVER a substituted default: this sensor mints no
  // expectations of its own, and one it minted would not be held outside.
  const injectedProbes = config?.probeSource;
  const probeSource: ProbeSource | null =
    injectedProbes !== undefined && injectedProbes.length > 0
      ? injectedProbes
      : null;

  // ── D8 anchor: the named dependency, checked before anything is read ──────
  const unreadable = assessLogReadability(log, SIG_SENSOR_ID, injectedStates);
  if (unreadable !== null) {
    return {
      verdict: unreadable,
      flags: [],
      readableLoadStates,
      preconditionMap,
      reentryMap,
      clerkClockSource,
      probeSource,
      // The log itself could not be read, so F3 never joined anything. Null is
      // the honest value: a zeroed coverage object would read as "nothing was
      // missing", which is a claim about a scope nobody looked at.
      clerkStampCoverage: null,
      f1Deviation: null,
      f3Deviation: null,
    };
  }

  const entries = log.getAll();
  // T9 · CLEARED BEFORE THE CALL, so a stale deviation from a previous assessment
  //   can never be read as this one's. Every early return above this line leaves
  //   `f1Deviation: null` on the result, which is the honest value: those paths
  //   took no F1 reading at all.
  // T9 · the outcome, in T3's shape: the report joins `flags[]`, the deviation
  //   rides on SigResult. A value RETURNED cannot be read out of order.
  const f1Outcome = runF1(entries, config);
  const f1Deviation = f1Outcome.deviation;
  const baseFlags: FlagReport[] = [f1Outcome.report, runF2(entries, config)];
  const f3Outcome = runF3(entries, config);
  const f3 = f3Outcome.report;
  // T3: F3's coverage and deviation ride on SigResult, NEVER on the FlagReport
  // and NEVER in a verdict summary. See F3StampCoverage for why, at bytes.
  const clerkStampCoverage = f3Outcome.coverage;
  const f3Deviation = f3Outcome.deviation;
  // F4 takes no `entries`: its scope is the injected probe source alone. See the
  // block above runF4 — a probe's subject is an entry in the assembler's book,
  // not a record in the log Sig was pointed at, and there is nothing to join.
  const f4 = runF4(config);
  const flags: FlagReport[] = [...baseFlags, f3, f4];

  // ── F5 composition (arbiter-ruled a) ─────────────────────────────────────────
  //
  // F3 and the F2 re-entry leg are VERDICT-BEARING legs: their blindness composes
  // upward, the same non-compensatory grammar W/R/K use. The ONLY status excluded
  // from the floor is NOT_CONFIGURED — a leg for which no source was injected at
  // all, which is disclosed but not a verdict term (the ruled dormancy of an
  // unconfigured leg). Every configured status composes: an F3 that was CONFIGURED
  // and could not read is now a CANNOT_ASSESS that lowers the bound, where before
  // it was named CANNOT_ASSESS yet silently dropped — the fail-open F5 names, by
  // which Sig could read SILENT (and the chokepoint RELEASE) over an unread leg.
  const verdictFlags = flags.filter((f) => f.kind !== "NOT_CONFIGURED");

  // ── Composition ──────────────────────────────────────────────────────────
  //
  //   Any flag ALARMs                     -> ALARM. The bound is lowered, and
  //                                          that stays true regardless of what
  //                                          the other flags could or could not
  //                                          read. The unread scopes are still
  //                                          reported alongside.
  //   No alarm, any flag CANNOT_ASSESS    -> CANNOT_ASSESS. SILENT here would
  //                                          be a claim of "found nothing" over
  //                                          a scope that was never read. That
  //                                          is exactly the move an empty map is
  //                                          forbidden from buying.
  //   Every flag SILENT                   -> SILENT.

  const findings = verdictFlags.flatMap((f) => f.findings);
  const blindPaths = verdictFlags.flatMap((f) => f.blindPaths);

  const scopeNote = verdictFlags
    .map((f) => `${f.flag}[${f.name}]=${f.kind} over ${f.scopeSize} record(s)`)
    .join("; ");

  if (findings.length > 0) {
    const withScope: Finding[] = [...findings];
    for (const b of blindPaths) {
      withScope.push({
        code: "SIG_SCOPE_UNREAD",
        detail: `${b.class}: ${b.detail}`,
      });
    }
    return {
      verdict: alarm(
        SIG_SENSOR_ID,
        `Record contradicts the structure it is embedded in, inside a chain that ` +
          `verifies cleanly. This is state->record fidelity, not world->state ` +
          `accuracy, and not chain integrity. Flag status: ${scopeNote}.`,
        withScope
      ),
      flags,
      readableLoadStates,
      preconditionMap,
      reentryMap,
      clerkClockSource,
      probeSource,
      clerkStampCoverage,
      f1Deviation,
      f3Deviation,
    };
  }

  if (blindPaths.length > 0) {
    const v = cannotAssess(SIG_SENSOR_ID, blindPaths);
    return {
      verdict: {
        ...v,
        summary: `${v.summary} Flag status: ${scopeNote}. No flag that DID read ` +
          `found a contradiction, but at least one scope was unread, so this is ` +
          `not silence. ${SILENCE_IS_NOT_HEALTH}`,
      },
      flags,
      readableLoadStates,
      preconditionMap,
      reentryMap,
      clerkClockSource,
      probeSource,
      clerkStampCoverage,
      f1Deviation,
      f3Deviation,
    };
  }

  return {
    verdict: silent(SIG_SENSOR_ID, `${entries.length} entries — ${scopeNote}`),
    flags,
    readableLoadStates,
    preconditionMap,
    reentryMap,
    clerkClockSource,
    probeSource,
    clerkStampCoverage,
    f1Deviation,
    f3Deviation,
  };
}

// ── D7: printed scope, in the code's own output ───────────────────────────────

/**
 * The scope block's content, as data.
 *
 * Extracted from printSigScope so the exported artifact carries the SAME text
 * the console prints (T1 REACH — the outside reader has no console). One
 * source, so the printed scope and the written scope cannot drift apart.
 */
export const SIG_SCOPE_TITLE = "MICA/Sig — signal clarity";

export const SIG_SCOPE_READS: readonly string[] = [
      "the declared record's timestamp       (supplied by the appending party)",
      "the declared record's sequenceNumber  (ASSIGNED BY THE LOG at append time,",
      "                          as a count of the appends it has taken — but",
      "                          append is the only mutator, so the value is a",
      "                          running count of the appending party's own calls.",
      "                          THE LOG ASSIGNS IT; THE APPENDING PARTY DETERMINES",
      "                          IT. These two fields are NOT independent axes:",
      "                          both are controlled by the party Sig observes.)",
      "the declared record's eventType       (F2 scope selection and matching)",
      "the declared record's outcome         (quoted verbatim in an F2 finding,",
      "                                       never parsed)",
      "the declared record's moduleId        (finding identification only)",
      "the log's own verify()        — readability gate ONLY, never the finding",
      "the log's own getLoadState()  — readability gate only",
      "an injected Clerk 1 receipt-order source (F3 only; no fallback)",
      "an injected sealed-expectation/observed-result source (F4 only; no",
      "                          fallback). Sig mints no expectation, seals",
      "                          none, opens no book, and imports nothing",
      "                          from the pre-commitment module: it receives",
      "                          the join already assembled and owns only",
      "                          the comparison.",
];

export const SIG_SCOPE_DOES_NOT_SEE: readonly string[] = [
      "WHETHER THE INPUT WAS TRUE. Sig reads state->record fidelity, NOT",
      "  world->state accuracy. A system honestly recording that it received",
      "  garbage has GOOD Sig. Sig does not check the garbage.",
      "CHAIN INTEGRITY AS A FINDING. The log's own verification owns that and is",
      "  not wrapped here. Sig reads chains that verify PERFECTLY and contradict",
      "  themselves anyway.",
      "GRADES. Sig produces flags. A failing Sig cannot produce a corrected",
      "  number, because the instrument producing the number is the thing in",
      "  question.",
      "",
      "TWO FURTHER SIG LEGS EXIST IN THE DESIGN AND ARE DELIBERATELY UNBUILT:",
      "  · CROSS-ENTITY CORRELATION — requires a second entity's records. Not",
      "    available.",
      "  · THE `unknowns` DISCIPLINE — `unknowns` exists in a design schema but is",
      "    NOT a field on the record shape this instrument declares, and no log",
      "    it has been pointed at offers one. There is nothing to read.",
      "  No substitute for any of the legs above is implemented or approximated.",
      "",
      "  (PROBE DIVERGENCE was the third of these and IS NOW BUILT — flag F4,",
      "   2026-09-01. It was blocked on an expectation held outside the system;",
      "   that expectation now exists as a sealed pre-commitment, and F4 reads it.",
      "   Its ceiling is below. This block previously said the leg was blocked on",
      "   an independent witness that does not exist. That sentence was true when",
      "   written and is now false, so it is gone rather than annotated: a printed",
      "   scope that describes the instrument as it WAS is the same defect this",
      "   sensor exists to catch.)",
      "",
      "F2 IS SHIPPED DORMANT. The mechanism is built and tested; the map is",
      "  deployment-specific and is not supplied. With no map, F2 contributes",
      "  CANNOT_ASSESS for its scope — never SILENT.",
      "F2's RE-ENTRY (mutual-exclusion) CHECK IS DECLARED-TRANSITIONS ONLY. It",
      "  ALARMs when a declared enter event re-enters a state already active (a",
      "  prior enter with no intervening clear). An UNDECLARED state's re-entry is",
      "  invisible: this instrument holds no re-entry map of its own and infers",
      "  none. Absent map -> that scope is NOT CHECKED, disclosed on the result",
      "  and in the exported artifact, never as a clean SILENT in the verdict.",
      "AND IT IS STILL state->record FIDELITY, NOT WORLD TRUTH. A system emitting",
      "  a proper enter/clear/enter alternation reads SILENT whether or not it",
      "  ever truly left the state. F2 catches the CARELESS re-entrant who did not",
      "  emit a clear, not the careful one who emitted one without meaning it.",
      "A DISORDERED CLOCK'S CAUSE. F1 names the contradicting pair. It does not",
      "  distinguish clock skew, deliberate backdating, or a queued append.",
      "F1 IS A SELF-CONSISTENCY CHECK, NOT A TRUTHFULNESS CHECK. It compares a",
      "  declared timestamp against append order, and BOTH are determined by the",
      "  party being observed. A declarant emitting monotonically increasing",
      "  timestamps — true or false — never trips F1. F1 DETECTS CARELESS CLOCKS,",
      "  NOT DELIBERATE ONES. Silence from F1 is not evidence that a clock is",
      "  honest; it is evidence only that the declared order did not contradict",
      "  itself.",
      "F3'S CEILING. F3 compares declared timestamps with Clerk 1 receipt order.",
      "  It binds when submissions ARRIVED and in what ORDER; it never makes a",
      "  payload true. Its independent-axis warrant exists only when the clerk",
      "  is deployed under a genuinely separate OS principal. This build reads",
      "  and discloses that precondition; it does not perform principal separation.",
      "AND THE TAIL IS NOT READ. F3 judges the records the clerk has STAMPED.",
      "  Records written since the last carry are counted and their age is named,",
      "  and NOTHING IS CLAIMED ABOUT THEM. A contradiction in the tail is not",
      "  caught here and is not missed for ever: it is caught at the next carry,",
      "  at most one declared lag later. THAT BOUND IS THE CARRIER'S CADENCE, NOT",
      "  THIS READER'S GUARANTEE, and this reader cannot verify that the carrier",
      "  ran. A record BELOW its own writer's stamped high-water mark with no",
      "  stamp is a DIFFERENT thing — a SKIP — and it does blind this leg.",
      "  F3 CANNOT VERIFY THE CARRIER VISITED EVERY WRITER either: a writer with",
      "  no stamp at all has no high-water mark to compare against, so its records",
      "  are counted as tail and the writer is NAMED on SigResult. Only the",
      "  declared lag bound stands behind that, and only when one is declared —",
      "  with no bound, or no injected read-time, the tail is disclosed and NOT",
      "  judged stale, because a bound that cannot be read must not manufacture",
      "  a hold.",
      "AND THE CHAIN-IDENTITY CHECK IS NARROWER THAN IT LOOKS. F3 checks that the",
      "  stamps agree with WHAT THE ASSEMBLER SAID THIS CHAIN IS. It does NOT",
      "  check that the stamps were taken from the log F3 is reading — F3 cannot,",
      "  because the records it is handed carry no chain field at all. The",
      "  assembler holds that custody, exactly as it holds custody of F4's book.",
      "  A stamp carrying NO chain identity is joined as before and disclosed as",
      "  unattributed; a stamp naming ANOTHER chain is refused and never joined.",
      "F4'S CEILING. F4 compares an expectation SEALED BEFORE the probe against the",
      "  result the probe produced, and claims DIVERGENCE — nothing else. It never",
      "  claims motive, honesty, or disposition: a system that predicted wrong and",
      "  recorded the miss faithfully produces the same finding as one that lied,",
      "  and F4 cannot tell them apart and does not try. A MATCH CERTIFIES",
      "  NOTHING — it is consistent with a well-oriented system, with luck, and",
      "  with a prediction chosen because it was safe. F4 SILENT is the absence of",
      "  a caught divergence, never evidence that the committer is reliable.",
      "  It reads `verdict` and `hash` expectations by EXACT equality and refuses",
      "  `claim+rule`, because deciding whether a claim satisfies a rule is a",
      "  grader's judgement and a sensor performing it would invent the verdict it",
      "  claims to read. A record whose seal MISMATCHES is read as BLIND, not as a",
      "  divergence: seal integrity is the book's finding, not Sig's. A record",
      "  that cannot establish the seal PREDATES the observation is read as blind",
      "  too — F4 asserts no order of its own. AN UNSEALED PROBE IS OUT OF SCOPE,",
      "  never an alarm: absence of a seal is readable, not punishable.",
      "  AND SIG NEVER VERIFIES THE JOIN. Whoever assembles the injection holds",
      "  custody of the book, the reveal and the observation; if that assembler is",
      "  the observed party itself, F4's expectation is not held outside and the",
      "  leg reads whatever it was handed. The independence is a DEPLOYMENT fact",
      "  this sensor discloses and does not perform.",
];

/** The whole scope block as text, so the artifact can carry it verbatim. */
export function sigScopeBlockText(
  readableLoadStates?: readonly string[]
): string {
  return formatScopeBlock(
    SIG_SCOPE_TITLE,
    SIG_SCOPE_READS,
    SIG_SCOPE_DOES_NOT_SEE,
    SIG_COMPETENCE_LINES,
    loadStateScopeLines(readableLoadStates)
  );
}

export function printSigScope(readableLoadStates?: readonly string[]): void {
  printScopeBlock(
    SIG_SCOPE_TITLE,
    SIG_SCOPE_READS,
    SIG_SCOPE_DOES_NOT_SEE,
    SIG_COMPETENCE_LINES,
    loadStateScopeLines(readableLoadStates)
  );
}
