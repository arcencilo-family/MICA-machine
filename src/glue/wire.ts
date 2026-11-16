// ── GLUE · the wiring — where the clerk and MICA actually meet ───────────────
//
// `src/mica/chokepoint/index.ts` (l.66–67) says the binding between the clerk's
// gap read and MICA's floor "is checked at the DEPLOYMENT GLUE where clerk and
// MICA meet (a file outside src/mica), never inside MICA." THIS IS THAT FILE.
// Until it existed, nothing outside a test had ever called `Chokepoint.guard`:
// the machine had instruments and no hallway.
//
// It is the ONE place allowed to import both sides. `src/mica/` takes clerk as a
// dependency of NO kind — not runtime, not dev, not type-only (2026-08-12
// closure ruling, guarded by src/mica/closure.test.ts). Nothing here reaches
// back the other way: MICA does not know this file exists.
//
// ── WHAT THIS FILE DECIDES, AND WHAT IT REFUSES TO DECIDE ─────────────────────
//
//   It decides WHICH READERS RUN, from what the operator supplied. It decides
//   NOTHING about thresholds, ladders, lines, load states, or destinations:
//   every one of those is injected by the caller and printed in the census, and
//   there is NO DEFAULT for any of them. Absent means absent, and absent prints.
//
// ── THE ONE DISTINCTION THAT IS LOAD-BEARING HERE ─────────────────────────────
//
//   AN UNWIRED READER IS NOT A BLIND READER.
//
//     · NOT WIRED — no source was supplied for it at all. It composes NOTHING
//       into the floor: no verdict, no blind path, no term. The census says so
//       in print, which is the whole of what this build claims about it. This is
//       the F5 honest split (src/mica/sig/index.ts) one level up: an
//       unconfigured leg is disclosed, not counted.
//
//     · WIRED AND BLIND — a source WAS supplied and the reader could not read
//       it (or was not given the numbers it needs). That is a CANNOT_ASSESS
//       verdict, it composes into the floor, and it lowers the bound. Naming it
//       "not wired" and dropping it would be exactly the fail-open F5 names.
//
//   So: supplying `--log` WIRES Eng and Sig, whatever else is missing. If their
//   configuration is incomplete they return CANNOT_ASSESS(MISSING_CONFIGURATION)
//   and the floor goes blind — which is the correct, printed, cautious outcome,
//   not an error and not a silence.
//
// ── AND THE FLOOR IS STILL EMPTY-IS-BLIND ─────────────────────────────────────
//
//   With no reader wired at all, `composeFloorKind([])` is CANNOT_ASSESS by
//   construction (chokepoint/types.ts, correction 2). A hallway with no
//   instruments in it does not release anything; it holds blind. Nothing here
//   softens that.

import { createHash } from "crypto";
import { existsSync, lstatSync, readFileSync } from "fs";
import { dirname, join, resolve as resolvePath } from "path";

// ── the MICA side ────────────────────────────────────────────────────────────
import { assessEng } from "../mica/eng";
import type { EngConfig, EngResult } from "../mica/eng";
import { assessSig } from "../mica/sig";
import type { F3StampCoverage, FlagStatus, SigConfig, SigResult } from "../mica/sig";
import { assessNarrowK } from "../mica/narrow-k";
import type { NarrowKConfig } from "../mica/narrow-k";
// THE BUNDLE, 2026-09-24. Three more readers join the item-4 branch, and the
// `opa` line's op3 makes four. They read the SAME log through the SAME adapter
// instance Eng, Sig and narrow-K are handed, so they carry the same footing by
// construction — see `footingsFromWiring`, which now names all four.
import { assessNarrowW } from "../mica/narrow-w";
import type { NarrowWConfig } from "../mica/narrow-w";
import { assessNarrowR } from "../mica/narrow-r";
import { assessNarrowT, NarrowTConfig, T_POLARITY_NOTE } from "../mica/narrow-t";
import { MicaReadableLog } from "../mica/log";
import type { NarrowRConfig } from "../mica/narrow-r";
import { assessOp1DoctorCadence } from "../mica/op1-doctor-cadence";
import { assessOp3NodeResponse, OP3_NODE_RESPONSE_SENSOR_ID } from "../mica/op3-node-response";
import {
  assessGate4Sunset,
  GATE4_SUNSET_SENSOR_ID,
} from "../mica/gate4-sunset";
import type { Gate4SunsetConfig } from "../mica/gate4-sunset";
import {
  assessGate1Scope,
  gate1ScopeThrew,
  GATE1_SCOPE_SENSOR_ID,
  GIVEN_M_FRAME,
} from "../mica/gate1-scope";
import type { Gate1ScopeFrame, Gate1ScopeResult } from "../mica/gate1-scope";
import {
  GATE2_DIRECTION_SENSOR_ID,
  gate2DirectionThrew,
  gate2HarmThrew,
  readGate2Direction,
} from "../mica/gate2-direction";
import type { Gate2Basket, Gate2DirectionReading, Gate2Harm, Gate2RosterEntry } from "../mica/gate2-direction";
import type { MicaLogRecord } from "../mica/log";
import type { OperatorLayerProfile } from "../mica/operator-layer-profile";
import {
  BatchedNotifier,
  Chokepoint,
  ChokepointLedger,
  FloorTrail,
  gapReadToVerdict,
} from "../mica/chokepoint";
import type { GapReadShape, ReaderThrow, StakesLine } from "../mica/chokepoint";
import { cannotAssess } from "../mica/types";
import type { SensorVerdict, VerdictKind } from "../mica/types";
import { NoticeLog, NoticeSinks, composeNoticeSinks } from "../mica/notify";
import {
  DOOR_CHECKED_CUSTODY,
  SIG_STILL_NEVER_VERIFIES_THE_JOIN,
} from "./probe-door";
import {
  DOOR_CHECKED_CUSTODY_CLOCK,
  SIG_STILL_NEVER_VERIFIES_THE_CLOCK_JOIN,
} from "./clerk-clock-stamps-file";
import type { ComposedNotifier, Modality, Transport } from "../mica/notify";

// ── the clerk side ───────────────────────────────────────────────────────────
import { readGaps } from "../clerk/gap";
import { readStore } from "../clerk/read-store";
import { verifyChain } from "../clerk/verify";
import type { ChainVerification, TrustAnchor } from "../clerk/verify";
import type { ClerkRecord } from "../clerk/types";

// ── the glue's own adapter ───────────────────────────────────────────────────
import { fileDropCommitter } from "../witness/drop-committer";
import { consequenceEventType } from "../witness/seeing";
import { MicaLogFile } from "./mica-log-file";
import {
  WITNESS_LOG_ATTESTS,
  WITNESS_LOG_MAPPING,
  WitnessStoreLog,
} from "./witness-log-file";
import {
  SUBJECT_CHAIN_ATTESTS,
  SUBJECT_LOG_BOUNDARY_EVENT_TYPE,
  SubjectChainLog,
} from "./subject-event-journal";

/** The four built readers, named once. */
export const ENG_READER = "MICA/Eng";
export const SIG_READER = "MICA/Sig";
export const GAP_READER = "clerk1.gap";
/**
 * ITEM 4. narrow-K reads the SAME log Eng and Sig read, through the same
 * adapter instance, so it belongs to the log branch below and carries the same
 * footing they do.
 */
export const NARROW_K_READER = "MICA/narrow-K";

/**
 * ITEM 4 — WHY narrow-K IS GATED ON ITS OWN DECLARATION AND Eng/Sig ARE NOT,
 * stated here because it is a DEVIATION from the pattern six lines above and a
 * deviation nobody states becomes a defect somebody inherits.
 *
 * Eng and Sig are "wired by the presence of a log, blind by the absence of
 * configuration": with a log and no numbers they read CANNOT_ASSESS, that
 * blindness COMPOSES, and it lowers the bound. That is the correct rule for the
 * two readers whose blindness IS the deployment's headline fact.
 *
 * narrow-K is gated on `options.narrowK` instead — wired only when a profile
 * was actually declared. The reason is not taste:
 *
 *   · narrow-K with no `declaredProfile` is CANNOT_ASSESS(MISSING_CONFIGURATION)
 *     FOREVER. It is not blind pending calibration; it is blind pending a
 *     deployer decision that has not been made. Composing a third permanent
 *     CANNOT_ASSESS into the floor buys NO reading and changes the floor's
 *     composition for nothing.
 *   · and it would change it CONDITIONALLY on another reader's state, which is
 *     the property that makes a change unsafe to reason about. Today the floor
 *     is already CANNOT_ASSESS because Eng's `minimumSampleSize` is declared
 *     1000. The day Eng and Sig both read SILENT, an unconditionally-wired
 *     narrow-K would pull the floor back to CANNOT_ASSESS on its own — and
 *     after the pilot's `expiresAt` that is HOLD_BLIND, not PASS_BLIND. A
 *     reader that holds acts because nobody ever configured it is not a
 *     signal; it is a tripwire left in the carpet.
 *
 * So: NOT WIRED with a stated reason, which the census can print and a reader
 * can act on, until `readers.narrowK` exists. The distinction this file's own
 * header draws — "not wired" is a vacancy, "wired and could not read" is
 * CANNOT_ASSESS and composes — is exactly the distinction being used here.
 */
export const NARROW_W_READER = "MICA/narrow-W";
export const NARROW_R_READER = "MICA/narrow-R";
export const NARROW_T_READER = "MICA/narrow-T";
export const OP1_READER = "MICA/op1-doctor-cadence";

export const NARROW_K_NOT_DECLARED =
  "NOT WIRED — no narrow-K constraint profile was declared (readers.narrowK). " +
  "narrow-K derives no profile of its own and mandates none, so with nothing " +
  "declared it would read CANNOT_ASSESS(MISSING_CONFIGURATION) permanently. " +
  "That is a vacancy, not a reading, and it is reported as one rather than " +
  "composed into the floor as a blind term that buys no reading. THIS IS NOT A " +
  "STATEMENT THAT THE PROFILE IS SATISFIED, and not a statement that constraint " +
  "activity was looked at: nothing looked.";

/**
 * THE BUNDLE · narrow-W, narrow-R and op1 take the item-4 gate VERBATIM, and
 * the reason is verbatim too: each is CANNOT_ASSESS(MISSING_CONFIGURATION)
 * forever without its declared block, so wiring it unconditionally would
 * compose a permanent blind term that buys no reading and would change the
 * floor's composition CONDITIONALLY on other readers' states.
 *
 * ── AND ONE THING THE narrow-K COMMENT DOES NOT SAY, BECAUSE IT DID NOT HAVE
 *    TO ─────────────────────────────────────────────────────────────────────
 *
 * For narrow-K the declaration was merely PENDING. For these two it is
 * CURRENTLY REFUSED by this build's own finding: as of 2026-09-24 the caller
 * writes NO class for narrow-W's inquiry factor and NO class for narrow-R's
 * verification factor. Leg 1 of each ALARMS on a declared class ABSENT from the
 * record, leg 1 has no minimum-sample grace, and an ALARM floor holds at every
 * stakes class. So declaring either block today HOLDS EVERY ACT, and the
 * pilot's pass-blind override cannot rescue it — that override lives in the
 * CANNOT_ASSESS branch alone.
 *
 * WIRING THEM IS THEREFORE NOT THE SAME ACT AS TURNING THEM ON, and that is the
 * whole reason wiring them now is safe: the gate below is the difference.
 */
export const NARROW_W_NOT_DECLARED =
  "NOT WIRED — no narrow-W inquiry profile was declared (readers.narrowW). " +
  "narrow-W derives no profile of its own and mandates none, so with nothing " +
  "declared it would read CANNOT_ASSESS(MISSING_CONFIGURATION) permanently. " +
  "THIS IS NOT A STATEMENT THAT INQUIRY WAS LOOKED AT: nothing looked. AND IT " +
  "IS NOT MERELY PENDING — as of 2026-09-24 no record class on this log " +
  "corresponds to the inquiry factor, so a declaration made today would alarm " +
  "on its own declared class being absent and would hold every act.";

export const NARROW_R_NOT_DECLARED =
  "NOT WIRED — no narrow-R verification profile was declared (readers.narrowR). " +
  "narrow-R derives no profile of its own and mandates none, so with nothing " +
  "declared it would read CANNOT_ASSESS(MISSING_CONFIGURATION) permanently. " +
  "THIS IS NOT A STATEMENT THAT VERIFICATION WAS LOOKED AT: nothing looked. AND " +
  "IT IS NOT MERELY PENDING — as of 2026-09-24 no record class on this log " +
  "corresponds to the verification factor, so a declaration made today would " +
  "alarm on its own declared class being absent and would hold every act.";

/**
 * op1's vacancy line, and it carries ONE SENTENCE THE OTHER THREE DO NOT.
 *
 * op1 in PRESENCE mode (no `cadenceBoundSteps`) alarms on zero attestations, so
 * it behaves like the narrowing readers. op1 in BOUND mode does NOT: with zero
 * attestations it alarms only when the log's own span EXCEEDS the bound
 * (`op1-doctor-cadence/index.ts:167-176`). A short log and a generous bound
 * therefore read SILENT WITH NO DOCTOR AT ALL — a reader reporting quiet about
 * a duty nobody has performed. That is a property of the instrument, not of
 * this wiring, and this file's job is to print it where a deployer choosing a
 * bound will see it.
 */
export const NARROW_T_NOT_DECLARED =
  "NOT WIRED — no narrow-T drift profile was declared (readers.narrowT). " +
  "narrow-T derives no profile of its own, so with nothing declared it would " +
  "read CANNOT_ASSESS(MISSING_CONFIGURATION) permanently. That is a vacancy, " +
  "not a reading. THIS IS NOT A STATEMENT THAT NO DRIFT OCCURRED, and not a " +
  "statement that drift was looked at: nothing looked.";

/**
 * narrow-T TAKES THE ITEM-4 GATE VERBATIM, AND CARRIES ONE WARNING THE OTHERS
 * DO NOT NEED.
 *
 * ⚠ THE POLARITY IS INVERTED against every narrowing sibling: narrow-T reads
 * AMI ABOVE its tolerance as the finding, where K/W/R read absence as theirs.
 * A tolerance copied across from a sibling therefore INVERTS the test rather
 * than loosening it, and it inverts SILENTLY — the reader still returns a
 * verdict, just the opposite one. The instrument says so itself in
 * `T_POLARITY_NOTE`, and this wiring echoes that note into the census source so
 * the warning travels with the reading instead of living only in the module.
 *
 * WHAT THIS GATE DOES NOT DO: it does not make narrow-T correct, and it does
 * not calibrate it. `readers.narrowT` was declared on 2026-09-26 (S1) against a
 * glue that had no gate at all, so between that declaration and this commit the
 * front door accepted a profile nothing read. That gap is the reason this file
 * changed; it is not evidence that the numbers are right.
 */
export const OP1_NOT_DECLARED =
  "NOT WIRED — no doctor-cadence section was declared (readers.doctorCadence). " +
  "op1 reads the SUBJECT LOG for a declared attestation class; the doctor's own " +
  "book is invisible to it. THIS IS NOT A STATEMENT THAT A DOCTOR VISITED, and " +
  "not a statement that cadence was looked at: nothing looked. WHEN IT IS " +
  "DECLARED, READ THE MODE: presence mode alarms on zero attestations, bound " +
  "mode with zero attestations reads SILENT while the log is shorter than the " +
  "bound — quiet about a duty nobody performed.";

/**
 * H12 / OP-3, WIRED BY THE ITEM 4 PATTERN. `op3-node-response` is declared,
 * inert when absent, and an ordinary composing reader when present — the same
 * three properties narrow-K has, for the same reason, and pinned by the same
 * three shapes of test.
 *
 * WHY PRESENCE IS THE SWITCH HERE TOO, and this time the argument is sharper
 * than narrow-K's. OP-3 leg A alarms on an expectation with no qualifying
 * response, `mapFloorToDisposition` holds on ALARM whatever the stakes are,
 * and the reader recomputes over the WHOLE readable file on every evaluation —
 * so one unpaired expectation anywhere in the record holds EVERY act from then
 * on, and the recovery is to rotate the log, not to behave better. That is a
 * deployment decision with a latch on it, and a latch belongs to a declaration
 * a deployer wrote on purpose, never to the presence of a log file.
 */
export const OP3_READER: typeof OP3_NODE_RESPONSE_SENSOR_ID = OP3_NODE_RESPONSE_SENSOR_ID;

export const OP3_NOT_DECLARED =
  "NOT WIRED — no nodeResponse profile was declared (readers.nodeResponse). " +
  "OP-3 derives no expectation or response class of its own and mandates none, " +
  "so with nothing declared it would read " +
  "CANNOT_ASSESS(OP3_PROFILE_ABSENT) permanently. That is a vacancy, not a " +
  "reading, and it is reported as one rather than composed into the floor as a " +
  "blind term that buys no reading. THIS IS NOT A STATEMENT THAT CALLS WERE " +
  "ANSWERED, and not a statement that call-and-response was looked at: nothing " +
  "looked.";

/**
 * THE CEILING, CARRIED BY THE WIRING BECAUSE THE INSTRUMENT CANNOT KNOW IT.
 *
 * `OP3_NODE_RESPONSE_CEILING_LINES` states the limits that are true of OP-3
 * ANYWHERE — pole-shaped shadow, the consumer-semantics firewall, non-interior,
 * the flatness ceiling, leg C parked, calls declared never detected. None of
 * them is the limit that bites HERE, because the limit that bites here is a
 * fact about THIS DEPLOYMENT'S RECORD, and a reader that has never seen this
 * deployment cannot state it. So the wiring states it, and states it on the
 * verdict's own face rather than in a receipt nobody will be holding when the
 * verdict is read.
 */
/**
 * GATE 4 SUNSET, LEG A — WIRED BY THE ITEM 4 PATTERN, AND WIRED AS A VACANCY.
 *
 * This is the FIRST gate reader to reach the glue at all: before this commit
 * `grep -c gate4 src/glue/wire.ts` returned 0 while
 * `src/mica/gate4-sunset/index.ts` was a working two-leg reader, so Gate 4 was
 * absent from the reader census entirely — not UNWIRED in it, ABSENT from it.
 * A reader missing from the census cannot be counted as missing. Wiring the
 * vacancy is what makes the gap visible; declaring the profile is a separate
 * act and belongs to the arbiter.
 *
 * ⚠ TWO PROPERTIES OF THIS READER, BOTH MEASURED ON THE REAL RECORD BEFORE A
 *   LINE OF THIS WIRING WAS WRITTEN (`tools/gate4/probe-leg-a.ts`, 948-record
 *   copy, 2026-09-27), because both change what a declaration means:
 *
 * 1. LEG A IS AN ALLOWLIST, SO THE ENVELOPE MUST PERMIT THE MECHANICS OF BEING
 *    HELD AND NOT ONLY ITS OUTCOMES. Permitting the two HELD_THEN_* resolution
 *    classes alone reads ALARM with 79 findings over the 91 records of this
 *    record's first hold era: the first finding is the hold itself at
 *    sequenceNumber=170. An envelope that lists only how holds END forbids
 *    TOOL_ATTEMPTED and TOOL_HELD_NOT_EXECUTED, which is every hold happening.
 *
 * 2. THE COMPOSED VERDICT CANNOT BE SILENT WHILE LEG B IS VACUOUS. Both legs
 *    share one sensorId and compose worst-of, so leg A SILENT plus leg B
 *    CANNOT_ASSESS(G4_WARRANT_FORM_VACUOUS) reaches the floor as CANNOT_ASSESS.
 *    Leg A alone can therefore ALARM but can never read clean, and no count of
 *    readers "reading clean" may include it until leg B is declared.
 */
export const GATE4_READER: typeof GATE4_SUNSET_SENSOR_ID = GATE4_SUNSET_SENSOR_ID;

export const GATE4_NOT_DECLARED =
  "NOT WIRED — no Gate-4 sunset profile was declared (readers.gate4Sunset). " +
  "Leg A reads conduct inside ONE injected SAFE-HOLD window against an " +
  "injected permitted envelope; it derives neither the window nor the envelope " +
  "and mandates neither, so with nothing declared it would read " +
  "CANNOT_ASSESS(G4_PROFILE_ABSENT) permanently. That is a vacancy, not a " +
  "reading. THIS IS NOT A STATEMENT THAT HOLDS WERE RESPECTED, and not a " +
  "statement that hold conduct was looked at: nothing looked.";

/**
 * THE CEILING THE INSTRUMENT CANNOT KNOW, because it is a fact about THIS
 * record and not about Gate 4 — the same reason `OP3_HARNESS_PAIRING_CEILING`
 * lives here rather than in the module.
 *
 * ⛔ ONE WINDOW, TWO HOLD ERAS. `holdWindow` is a single inclusive span. This
 *    deployment's record carries 36 TOOL_HELD_NOT_EXECUTED records in TWO
 *    separated eras — [170, 260] and [285, 295] — with ordinary executed work
 *    between them. Measured, on the 948-record copy:
 *      · [170, 260] alone  -> leg A SILENT over 91 records; era 2 is UNREAD.
 *      · [285, 295] alone  -> leg A SILENT over 11 records; era 1 is UNREAD.
 *      · [170, 295] (both) -> ALARM, 11 findings, all of them the NORMAL
 *        executed work between the eras (TOOL_EXECUTED at 262 through
 *        DOCTOR_ATTESTED at 283). The union of two hold eras is not a hold era.
 *      · [170, open-ended] -> ALARM, 318 findings over 779 records, and it is
 *        recomputed over every record the subject will ever write. A permanent
 *        latch, released by rotating the log rather than by behaving well.
 *    So a CLOSED window reads one past era honestly and can never change
 *    again, and an OPEN window latches. Neither is a live reading of hold
 *    conduct, and the choice between them is the arbiter's.
 */
export const GATE4_SINGLE_WINDOW_CEILING =
  "GATE-4 LEG A CEILING, this deployment, REWRITTEN BY T26 — AND THE MEASUREMENT " +
  "THAT MADE THE OLD ONE TRUE IS WHY THE READER CHANGED, so it is kept here " +
  "rather than deleted: with a DECLARED holdWindow and an allow-list envelope, " +
  "a closed window read one hold era and was frozen (no later conduct could " +
  "move the verdict), an open-ended window alarmed on every ordinary execution " +
  "outside a hold, and the envelope had to permit the mechanics of being held " +
  "or the hold itself breached it. Measured 2026-09-27 on a 948-record copy: " +
  "tools/gate4/probe-leg-a.ts. NONE OF THAT IS THE READER ANY MORE: the window " +
  "is DERIVED per order (invocation seq + 1 to the first resolution), and leg A " +
  "reads only the declared sunset-response roles, so ordinary conduct inside a " +
  "window is OUT OF DOMAIN rather than a breach. WHAT REMAINS TRUE AND IS THIS " +
  "CEILING'S WHOLE CONTENT: the window's END is exact only while at most one " +
  "ending is open at a time, because the resolution's citation lives in the " +
  "record's payload and MicaLogRecord carries none; where two orders overlap, " +
  "leg A reads G4_ORDERS_INTERLEAVED rather than guessing which window it is in.";

/**
 * GATE 1 SCOPE — THE ENVELOPE RECORDER, WIRED BY THE ITEM 4 PATTERN.
 *
 * Presence of `options.gate1` is the switch, as for every declared reader in
 * this file. With nothing declared the reader would read
 * CANNOT_ASSESS(G1_FRAME_ABSENT) on every log, which is a vacancy and not a
 * reading, so it is printed as a vacancy and composes nothing.
 *
 * ⛔ WHAT IS DIFFERENT ABOUT THIS ONE, AND WHY IT STILL COMPOSES WHEN DECLARED.
 *    Every other declared reader here CAN read SILENT once declared. This one
 *    cannot: canon reads Gate 1's property as WEIGHT over a declared frame M
 *    (03a §1), revealed under cost (03b §2), and a conduct record carries
 *    where an act was aimed, never weight. So a declared Gate 1 is
 *    CANNOT_ASSESS on every log, forever, by construction — and that is
 *    exactly what it puts into the floor. Its CANNOT_ASSESS is not "blind pending data"; it is the truth that
 *    the gate's property is UNREAD by this deployment. Dropping it from the
 *    floor because it "never changes" would be the fail-open the header names:
 *    an unread gate reported as nothing at all.
 *
 * ⚠ THE COST, STATED BECAUSE A DEPLOYER PAYS IT: declaring a frame puts one
 *    more permanent CANNOT_ASSESS term into the floor. Where every other wired
 *    reader reads SILENT, a declared Gate 1 alone keeps the floor at
 *    CANNOT_ASSESS — which after a pass-blind window's expiry is a blind hold.
 *    That is the honest consequence of "Gate 1 is unread", and it belongs to
 *    the arbiter's declaration, never to the presence of a log.
 */
export const GATE1_READER: typeof GATE1_SCOPE_SENSOR_ID = GATE1_SCOPE_SENSOR_ID;

/**
 * CEILING LINE 1's DISCLAIMER, carried by every census text of this file that
 * says "reached" of what Gate 1 counts (GATE1_SCOPE_CEILING_LINES[0] in the
 * reader): the counted thing is ATTEMPTED EXPOSURE, a term that is this
 * reader's and not canon's, and canon's REACH (03a §1) is the weight
 * distribution's extent — NOT what is counted. A census line that said
 * "reached" without it would print canon's word for a thing this reader does
 * not read. The reader's own block is behind the core door; this is the glue's
 * copy of the same sentence, kept beside the words it qualifies.
 */
export const GATE1_REACHED_IS_EXPOSURE =
  "\"reached\" here means only that a labelled act was placed in a category: " +
  "ATTEMPTED EXPOSURE, this reader's term, not canon's reach (03a §1), which " +
  "is the weight distribution's extent";

export const GATE1_NOT_DECLARED =
  "NOT WIRED — no Gate-1 frame was declared (readers.gate1Scope + frame). " +
  "Gate 1 records which declared categories of an M-frame the subject's " +
  "attempted acts reached (" + GATE1_REACHED_IS_EXPOSURE + "); with no frame " +
  "there is no M, the bridge derives no " +
  "label, and the reader would read CANNOT_ASSESS(G1_FRAME_ABSENT) permanently. " +
  "That is a vacancy, not a reading. THIS IS NOT A STATEMENT THAT SCOPE WAS " +
  "ADEQUATE, and not a statement that exposure was looked at: nothing looked.";

/**
 * ROUND 2, PLACEMENT D. The labels Gate 1 counts live in the bridge's INTEREST
 * BOOK — a separate chained file — and never on the subject log this wiring
 * reads for every other reader. A frame declared with no book path is a
 * declaration that names categories and gives this door nothing to count them
 * in, so it is UNWIRED and says which half is missing. ⛔ It must NOT fall back
 * to the subject log: under placement D that log carries no label, and reading
 * it would print an envelope of nothing as if it were a reading.
 */
export const GATE1_BOOK_NOT_DECLARED =
  "NOT WIRED — a Gate-1 frame was declared but no interest book path " +
  "(paths.interestBook -> gate1BookPath) reached this door. The labels Gate 1 " +
  "counts are written ONLY to that book; the subject log carries none, so " +
  "nothing was read. THIS IS NOT A STATEMENT THAT SCOPE WAS ADEQUATE.";

/**
 * ROUND 3 (K1R2-4). The book and the subject log are ONE FILE. Placement D's
 * guarantee — the subject chain carries nothing new, so no sibling reader sees
 * anything new — holds only while they are two. The front door refuses this
 * (the bridge's X23); this door refuses it again, because a caller other than
 * the bridge can hand wire() any pair of paths. ⚠ The comparison is
 * `path.resolve` on both spellings: textual, no filesystem call — a symlink or
 * a hard link to the same inode is NOT caught here.
 */
export const GATE1_BOOK_IS_THE_LOG =
  "NOT WIRED — the interest book (gate1BookPath) and the subject log (--log) " +
  "name the SAME FILE. Gate 1 counts labels only the book carries; read as the " +
  "book, the subject log is an envelope of nothing printed as a reading, and " +
  "the book read as the subject log hands its labels to every sibling reader. " +
  "Neither was read as the book. THIS IS NOT A STATEMENT THAT SCOPE WAS ADEQUATE.";

/**
 * ROUND 3 (K1R3-2, K1R2-7). What Gate 1's census row calls the file it read.
 * The book is read with the subject-chain reader because the bridge writes it
 * in that format — but it is NOT the subject chain, and its first line is not
 * a first boot: the bridge writes it with `retired: null` because no
 * predecessor of the book is declared anywhere, not because one was verified
 * absent. So the row is built from the book's own fields in Gate 1's words,
 * never from `describe()` (which says "subject chain" and "FIRST_BOOT").
 */
export const GATE1_BOOK_SOURCE_PREFIX =
  "INTEREST BOOK (read with the subject-chain reader; position 0 is the book's own first line)";

/**
 * The book's census source. Its position-0 TIMESTAMP is printed (K1R2-2): a
 * book deleted and begun again verifies exactly like one that never was, and
 * the later start is the only trace of that this file carries.
 */
export function gate1BookSource(book: SubjectChainLog): string {
  const boundary = book.getBoundary();
  const first =
    boundary === null
      ? "position 0: none loaded"
      : boundary.retired === null
        ? `position 0 at timestamp ${String(boundary.timestamp)}: retired is null — no predecessor ` +
          "declared, NOT verified absent; a book deleted and begun again starts the same way"
        : `position 0 at timestamp ${String(boundary.timestamp)}: retired(${boundary.retired.path}, ` +
          `${String(boundary.retired.records)} rec)`;
  const problem = book.getProblem();
  return (
    `${GATE1_BOOK_SOURCE_PREFIX} ${book.sourcePath}: loadState=${book.getLoadState()} ` +
    `records=${String(book.recordCount)}; ${first}; ` +
    `verify=${book.verify().valid ? "chain+order OK" : "INVALID"}` +
    (problem === null ? "" : ` — ${problem}`)
  );
}

/**
 * The error classes a throw out of the book's adapter is named by. A FIXED
 * set: the row names a class from this list and never the thrown value's own
 * text, which can carry bytes of the book (a JSON parse error quotes its input).
 */
const GATE1_ERROR_CLASSES: ReadonlyArray<readonly [string, new (...args: never[]) => Error]> = [
  ["RangeError", RangeError],
  ["TypeError", TypeError],
  ["SyntaxError", SyntaxError],
  ["ReferenceError", ReferenceError],
  ["URIError", URIError],
  ["EvalError", EvalError],
];

/** The class word for a throw: from the fixed set, else "Error", else a fixed phrase. */
export function gate1ErrorClass(error: unknown): string {
  try {
    for (const [name, ctor] of GATE1_ERROR_CLASSES) if (error instanceof ctor) return name;
    return error instanceof Error ? "Error" : "a thrown non-Error value";
  } catch {
    // `instanceof` walks the value's prototype chain, and a Proxy's
    // getPrototypeOf trap can throw. The word is optional; the row is not.
    return "an unclassifiable throw";
  }
}

/** The value handed to the reader's own G1_READER_THREW: fixed text, the class only. */
function gate1AdapterError(errorClass: string): Error {
  const error = new Error(
    "the interest book's adapter or its read threw before a reading existed; " +
      "the thrown text is withheld (it can carry the book's bytes)"
  );
  error.name = errorClass;
  return error;
}

/** Gate 1's census source when the book's adapter threw: FIXED text, the class only. */
export function gate1BookThrew(errorClass: string): string {
  return (
    `${GATE1_BOOK_SOURCE_PREFIX}: THE BOOK'S ADAPTER THREW (${errorClass}) — no reading was taken, ` +
    "so Gate 1 composes the reader's own G1_READER_THREW blindness and reports no footing. " +
    "The thrown text is withheld. A damaged book should read as a broken chain; this one " +
    "could not even be loaded."
  );
}

/**
 * The sentence the census row carries beside every WIRED Gate 1 reading, so
 * the row says what its permanent kind MEANS rather than leaving a reader of
 * the census to read it as a blindness that more records would cure.
 */
export const GATE1_PERMANENTLY_UNREAD =
  "GATE 1 IS UNREAD BY CONDUCT, PERMANENTLY: this row is CANNOT_ASSESS on " +
  "every log by construction, and that is what composes into the floor. The " +
  "envelope is ATTEMPTED EXPOSURE of declared regions (not canon's reach, which " +
  "is the weight distribution's extent), never weight; " +
  "weight is revealed under cost and is the probe's, not any record's.";

/**
 * One line for the census: the envelope as the reader computed it, carried
 * verbatim from THIS result. Never re-derived, never rounded into a ratio —
 * a fraction here would invite a reader to treat it as a grade.
 */
export function gate1EnvelopeLine(result: Gate1ScopeResult): string {
  const codes = `blind codes=${result.blindReasonCodes.join(", ")}`;
  if (result.coverage === null || result.derivableCeiling === null) {
    return `GATE 1 ENVELOPE: none read — ${codes}`;
  }
  return (
    `GATE 1 ENVELOPE ${GIVEN_M_FRAME}: reached ${result.coverage.reached} of ` +
    `${result.coverage.ofM} categories (${GATE1_REACHED_IS_EXPOSURE}); ` +
    `at most ${result.derivableCeiling.derivable} of ` +
    `${result.derivableCeiling.ofM} are derivable; labelled ${result.labelled} ` +
    `(underived ${result.underived}), unrecognised ${result.unrecognised}` +
    (result.unrecognised === 0 ? "" : " (A WRITER OR BOOK DEFECT)") +
    ` — ${codes}`
  );
}

/**
 * GATE 2 DIRECTION — WIRED BY THE ITEM 4 PATTERN (Stop 2, contract §5).
 *
 * Presence of `options.gate2` is the switch. With nothing declared the reader
 * would read CANNOT_ASSESS(G2_BASKET_ABSENT) on every log, which is a vacancy
 * and not a reading, so it is printed as a vacancy and composes nothing.
 *
 * When declared it reads the SAME `logFile` instance every other subject-log
 * reader is handed, through the same `readableLoadStates`; it opens no file of
 * its own and reads no other book (the frame's category ids arrive inside the
 * basket, built by the bridge from the declaration). Its verdict joins
 * `sensorVerdicts` unchanged and composes like any other.
 *
 * ⚠ THE FLOOR CONSEQUENCE, STATED (audit ruling 19:51Z ①): the floor composes
 *    the WORST kind, so while Gate 2 reads CANNOT_ASSESS — which the ruled
 *    basket (fork A) does on this deployment's record by construction,
 *    G2_NO_CLASS_AT_GRADE — the floor can never be SILENT. That is already
 *    true today (Gate 1 is CANNOT_ASSESS by construction), and it is the
 *    declaration's consequence, not this wiring's.
 */
export const GATE2_READER: typeof GATE2_DIRECTION_SENSOR_ID = GATE2_DIRECTION_SENSOR_ID;

export const GATE2_NOT_DECLARED =
  "NOT WIRED — no Gate-2 basket was declared (readers.gate2Direction + baskets[subject]). " +
  "Gate 2 reads DIRECTION: V − D over the deployer's declared value, damage and unknown " +
  "classes, as a bound at grade; with no basket there is no class to count, and the reader " +
  "would read CANNOT_ASSESS(G2_BASKET_ABSENT) permanently. That is a vacancy, not a reading. " +
  "THIS IS NOT A STATEMENT THAT DIRECTION WAS NON-NEGATIVE, and not a statement that " +
  "direction was looked at: nothing looked.";

/**
 * A basket declared, and no subject log to read it on. Gate 2 stands on the
 * subject log the other readers read and has no file of its own to fall back
 * to, so the missing half is named — the log — and nothing is read.
 */
export const GATE2_LOG_NOT_SUPPLIED =
  "NOT WIRED — a Gate-2 basket was declared but no subject log was supplied (--log). " +
  "Gate 2 reads the same subject log the other readers read and opens no file of its " +
  "own, so nothing was read. THIS IS NOT A STATEMENT THAT DIRECTION WAS NON-NEGATIVE.";

/**
 * GATE 2 ON THE WITNESS'S BOOK (Tier 1, phase R). The two collisions that
 * would make the book something it is not, named like Gate 1's K1R2-4: the
 * comparison is `path.resolve` on both spellings, textual — a link to the
 * same inode is NOT caught here (the bridge's front door refuses equal
 * declared paths; the deployment owns the rest).
 */
export const GATE2_BOOK_IS_THE_LOG =
  "NOT WIRED — the witness's book of effects (gate2BookPath) and the subject log (--log) " +
  "name the SAME FILE. Gate 2 on the book counts the witness's records of effects; read " +
  "as the book, the subject log is the subject's own record, and the book read as the " +
  "subject log hands its records to every sibling reader. Neither was read as the book. " +
  "THIS IS NOT A STATEMENT THAT DIRECTION WAS NON-NEGATIVE.";

export const GATE2_BOOK_IS_GATE1_BOOK =
  "NOT WIRED — the witness's book of effects (gate2BookPath) and the interest book " +
  "(gate1BookPath) name the SAME FILE. Each book has one writer and one reader; a file " +
  "that is both is neither. Not read. THIS IS NOT A STATEMENT THAT DIRECTION WAS NON-NEGATIVE.";

/** What Gate 2's census row calls the file it read when it reads the witness's book. */
export const GATE2_BOOK_SOURCE_PREFIX =
  "THE WITNESS'S BOOK OF EFFECTS (read with the subject-chain reader; position 0 is the book's own first line)";

/** The book's census source: Gate 1's rule (position 0's timestamp printed, K1R2-2). */
export function gate2BookSource(book: SubjectChainLog): string {
  const boundary = book.getBoundary();
  const first =
    boundary === null
      ? "position 0: none loaded"
      : boundary.retired === null
        ? `position 0 at timestamp ${String(boundary.timestamp)}: retired is null — no predecessor ` +
          "declared, NOT verified absent; a book deleted and begun again starts the same way"
        : `position 0 at timestamp ${String(boundary.timestamp)}: retired(${boundary.retired.path}, ` +
          `${String(boundary.retired.records)} rec)`;
  const problem = book.getProblem();
  return (
    `${GATE2_BOOK_SOURCE_PREFIX} ${book.sourcePath}: loadState=${book.getLoadState()} ` +
    `records=${String(book.recordCount)}; ${first}; ` +
    `verify=${book.verify().valid ? "chain+order OK" : "INVALID"}` +
    (problem === null ? "" : ` — ${problem}`)
  );
}

/**
 * ON THE WITNESS'S BOOK, the wiring prints what the reader's frozen lines cannot
 * (refuter C MAJOR-2, the OP3_HARNESS_PAIRING_CEILING pattern): two of Gate 2's
 * own ceiling lines are FALSE on this book until T32 makes them book-aware, and
 * the witness's own ceilings govern its records.
 */
export const GATE2_BOOK_CEILING =
  "ON THE WITNESS'S BOOK: Gate 2's frozen ceiling line 2 (\"the record shows acts, result codes and decisions; " +
  "what an act did in the world is not on it\") is FALSE here, and line 6 is FALSE in its first clause (\"written " +
  "by the subject's harness\") while its S206 clause STILL HOLDS: which acts the witness is pointed at, their " +
  "targets, and whether an act was held or ran unguarded come from records the subject's uid can post. Until T32 " +
  "corrects the frozen lines, this line does. This book carries ONE look per act at the target it CLAIMED, as a " +
  "facet SINCE THE WITNESS LAST LOOKED — never caused by the act (phase R, audit 2026-10-11 09:32Z); attribution " +
  "is phase H's. Read it under the witness's own ceilings (its first line): artefact effects are not benefit; the " +
  "claimed target is not the touched set; the facet is since the witness last looked, not caused by this act; the " +
  "act's records are the subject's word; an act with no record is not a reading; this box's files only; reach is a " +
  "deployment fact; tamper-evident, not tamper-proof.";

/**
 * COVERAGE, printed (ruled 16:36Z (3)③): facts about the BOOK, never about the
 * reading — which of the subject's acts the book holds a record for, matched by
 * the bridge-minted subjectSeq (never the caller-chosen actionId: refuters A-F7,
 * B M1), and the facets it carries (phase R, audit 2026-10-11 09:32Z): by facet
 * (FIRST_SEEN, SAME, …), how many FIRST_SEEN (no last look to compare) and how
 * many UNOBSERVABLE, and how stale the book is against the subject log. Only the
 * basket's OWN record class is counted; records of any other CONSEQUENCE@ class
 * are named, not summed. The denominator is the subject log's TOOL_ATTEMPTED acts
 * and, when the interest book is supplied, the acts it placed in a frame category.
 * ⚠ These are facts SINCE THE WITNESS LAST LOOKED, attributed to no act; they may
 * print beside a SILENT (audit F-E ruling: facts, not grade).
 */
export function gate2BookCoverageLine(
  book: SubjectChainLog,
  subjectLog: MicaReadableLog | null,
  subjects: readonly string[],
  eventTypes: readonly string[],
  interestBook: SubjectChainLog | null
): string {
  // THE ACT'S KEY INCLUDES THE SUBJECT CHAIN (refuter R2-bytes F3): a rotated chain numbers its acts from 1 again,
  // so a record counts toward THIS log only when it cites this log's chain (its position-0 record's hash). With no
  // subject log, nothing can be matched and every chain is counted, said so.
  const boundary =
    subjectLog !== null && typeof (subjectLog as { getBoundary?: unknown }).getBoundary === "function"
      ? (subjectLog as unknown as SubjectChainLog).getBoundary()
      : null;
  const chainId: string | null = boundary === null ? null : boundary.hash;
  const chainStart = boundary === null ? 0 : boundary.timestamp;
  const seen = new Set<number>();
  const perSeq = new Map<number, number>();
  let records = 0;
  let otherChain = 0;
  const perCategory = new Map<string, number>();
  const facets = new Map<string, number>();
  const fingerprints = new Map<string, number>(); // how many records cite each targetFingerprint (re-seen targets recur)
  let firstSeen = 0;
  let firstSeenRecur = 0; // FIRST_SEEN records whose target the book has ALREADY seen — a re-seen target after eviction
  let unobservable = 0;
  let otherClass = 0;
  let lastBook = 0;
  for (const r of book.getChain()) {
    if (r.recordType !== "SUBJECT_EVENT" || !subjects.includes(r.moduleId)) continue;
    if (!eventTypes.includes(r.eventType)) {
      otherClass++;
      continue;
    }
    const w = (r as { witnessed?: Record<string, unknown> }).witnessed ?? {};
    const cites = (w.cites ?? {}) as { subjectSeq?: unknown; chain?: unknown };
    if (subjectLog !== null && (typeof cites.chain === "string" ? cites.chain : null) !== chainId) {
      otherChain++;
      continue;
    }
    records++;
    if (typeof cites.subjectSeq === "number") {
      seen.add(cites.subjectSeq);
      perSeq.set(cites.subjectSeq, (perSeq.get(cites.subjectSeq) ?? 0) + 1);
    }
    // LAST colon (refuter R4-bytes F2): a frame category may itself contain ':' (IDENT allows it); the effect, never.
    const sep = r.outcome.lastIndexOf(":");
    const cat = sep > 0 ? r.outcome.slice(0, sep) : "(none)";
    const facet = sep >= 0 ? r.outcome.slice(sep + 1) : r.outcome;
    perCategory.set(cat, (perCategory.get(cat) ?? 0) + 1);
    facets.set(facet, (facets.get(facet) ?? 0) + 1);
    if (facet === "FIRST_SEEN") firstSeen++;
    if (facet === "UNOBSERVABLE") unobservable++;
    const fp = typeof (cites as { targetFingerprint?: unknown }).targetFingerprint === "string" ? String((cites as { targetFingerprint?: unknown }).targetFingerprint) : null;
    if (fp !== null) {
      const seenFp = fingerprints.get(fp) ?? 0;
      if (facet === "FIRST_SEEN" && seenFp > 0) firstSeenRecur++; // the witness forgot this target and re-saw it
      fingerprints.set(fp, seenFp + 1);
    }
    if (r.timestamp > lastBook) lastBook = r.timestamp;
  }
  let denominator = "of an unstated number of acts (no subject log supplied)";
  let staleness = "";
  // T32 · THE DENOMINATOR IS BOUNDED AT THE BOOK'S BOUNDARY (the Stop3 receipt §1.3: it read 2/5 where the truth
  // was 2/2): an act older than the book's own first line could never have a record in it, so it is not counted.
  const bookBoundary = book.getBoundary();
  const bookBoundaryAt = bookBoundary === null ? null : bookBoundary.timestamp;
  let beforeBoundary = 0;
  let bound = "";
  if (subjectLog !== null) {
    let acts = 0;
    let matched = 0;
    let lastAct = 0;
    try {
      for (const r of subjectLog.getAll()) {
        if (r.eventType !== "TOOL_ATTEMPTED" || !subjects.includes(r.moduleId)) continue;
        if (bookBoundaryAt !== null && r.timestamp < bookBoundaryAt) {
          beforeBoundary++;
          continue;
        }
        acts++;
        if (seen.has(r.sequenceNumber)) matched++;
        if (r.timestamp > lastAct) lastAct = r.timestamp;
      }
      denominator = `${String(matched)} of the subject log's ${String(acts)} TOOL_ATTEMPTED act(s)`;
      bound =
        bookBoundaryAt === null
          ? " DENOMINATOR: the book's boundary is unknown, so every act is counted (T32's bound not applied)."
          : ` DENOMINATOR: acts at or after the book's boundary (timestamp ${String(bookBoundaryAt)}) only (T32); acts before it, not counted: ${String(beforeBoundary)}.`;
      staleness =
        lastAct > lastBook
          ? ` STALENESS: the subject's latest TOOL_ATTEMPTED (pointed or not) is ${String(lastAct - lastBook)} ms newer than the book's latest record of this class.`
          : "";
    } catch {
      denominator = "of an unreadable subject log";
    }
  }
  let pointed = "";
  if (interestBook !== null) {
    let placed = 0;
    let placedSeen = 0;
    // Only labels of a DRAWING this basket's class was named from (refuter R2-bytes F10), on this chain's time.
    const ofThisBasket = (eventType: string): boolean => {
      try {
        return eventTypes.includes(consequenceEventType(eventType));
      } catch {
        return false;
      }
    };
    for (const r of interestBook.getChain()) {
      if (r.recordType !== "SUBJECT_EVENT" || !subjects.includes(r.moduleId) || r.outcome === "UNDERIVED") continue;
      if (!ofThisBasket(r.eventType) || r.timestamp < chainStart) continue;
      const seq = (r as { subjectSeq?: unknown }).subjectSeq;
      if (typeof seq !== "number") continue;
      placed++;
      if (seen.has(seq)) placedSeen++;
    }
    pointed = ` Of the ${String(placed)} act(s) the interest book placed in a frame category (the acts pointed to the witness), ${String(placedSeen)} have a record.`;
  }
  const list = (m: Map<string, number>): string =>
    [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${String(v)}`).join(" ") || "(none)";
  return (
    `WITNESS COVERAGE: the book holds a record for ${String(seen.size)} act(s) under this basket's class — ${denominator}.${bound}${pointed} ` +
    `By category ${list(perCategory)}; by facet ${list(facets)}. FOOTING: FIRST_SEEN ${String(firstSeen)} (no last look to compare); ` +
    `UNOBSERVABLE ${String(unobservable)}; FIRST_SEEN on a target already in the book (re-seen after the witness forgot it): ${String(firstSeenRecur)}.${staleness} Records of this class: ${String(records)}; acts with more than one: ` +
    `${String([...perSeq.values()].filter((n) => n > 1).length)}. ` +
    (subjectLog === null
      ? "The subject chain is unknown here, so records of every chain are counted. "
      : `Records citing another subject chain (before a rotation), not counted: ${String(otherChain)}. `) +
    `Records of other classes (another method or drawing), not counted: ${String(otherClass)}. ` +
    "Acts with no claimed target, an UNDERIVED target, or no pointer to the witness have no record and are the gap. " +
    "Every facet is SINCE THE WITNESS LAST LOOKED (phase R), attributed to no act; attribution is phase H's."
  );
}

/** Gate 2's census source when the book's adapter threw: FIXED text, the class only. */
export function gate2BookThrew(errorClass: string): string {
  return (
    `${GATE2_BOOK_SOURCE_PREFIX}: THE BOOK'S ADAPTER THREW (${errorClass}) — no reading was taken from the book, ` +
    "so Gate 2 composes its own G2_READER_THREW blindness and reports no footing. The thrown text is withheld."
  );
}

/**
 * The value handed to Gate 2's OWN throw constructors (gate2DirectionThrew, gate2HarmThrew) when a step around the
 * reader threw: FIXED text, the class only. T27 (FORK-4, as recommended): this replaces `gate2RethrowingLog`, which
 * composed the blind reading by CALLING THE READER AGAIN from inside the catch. A catch never calls the reader again;
 * the reader's exported constructors return what its own net returns, so the kind, the code G2_READER_THREW and the
 * detail are what they were (the message below is the retired adapter's, word for word).
 */
function gate2AdapterError(errorClass: string): Error {
  const e = new Error("the witness's book's adapter threw before a reading existed; the thrown text is withheld");
  e.name = errorClass;
  return e;
}

/** As gate2AdapterError, for Gate 2 reading the subject log itself (the path with no book). */
function gate2LogStepError(errorClass: string): Error {
  const e = new Error("the subject log's adapter, or the step around this reader, threw; the thrown text is withheld");
  e.name = errorClass;
  return e;
}

/**
 * One line for the census: the kind and the one code THIS reading carried,
 * verbatim from the reader. ⛔ NO COUNT AND NO MARGIN: a SILENT is binary
 * (02d DL-1), so the census row of a SILENT reading says so and nothing more.
 */
export function gate2CensusLine(reading: Gate2DirectionReading): string {
  if (reading.verdict.kind === "SILENT") {
    // ⛔ NEVER WITHOUT LINE 1 (05a:198-200): a SILENT about direction is silence
    //    about direction only — the 8142c61 precedent for Gate 1's "reached".
    return (
      "GATE 2 DIRECTION: SILENT — binary; no count and no margin are printed (02d DL-1). " +
      "DIRECTION ONLY: persistence-under-unmonitoring is PERMANENTLY UNREADABLE (D-33)."
    );
  }
  return (
    `GATE 2 DIRECTION: ${reading.verdict.kind} — code ${String(reading.code)}` +
    (reading.latchedSince === null ? "" : `, LATCHED since seq ${String(reading.latchedSince)}`)
  );
}

// ── GATE 2 · THE HARM BRANCH ON THE WITNESS'S BOOK (T33; contract M3) ──────────
//
// `gate2Harm` is the switch: the deployer's harm stanza as the bridge builds it (items with their target
// fingerprints in the bridge's current salt epoch, origins, grants, the doctor's clearances). It reads ONLY the
// witness's book: never the chain. The book's own first line gives its boundary instant and its retired
// predecessor; the predecessors are followed and verified here, and handed to the reader for the LATCH ONLY.
// The interest book (`gate2RosterPath`) is read as the act ROSTER only — never for effects.

/** `gate2Harm` without the witness's book: nothing to read, and the chain is never read in its place. */
export const GATE2_HARM_WITHOUT_BOOK =
  "NOT WIRED — GATE2_HARM_WITHOUT_BOOK: a Gate-2 harm basket was declared (gate2Harm) but no witness's book " +
  "(gate2BookPath). The harm branch reads only the book; it never falls back to the subject chain. Nothing was " +
  "read. THIS IS NOT A STATEMENT THAT NO ITEM CHANGED.";

/** Thrown: the class basket and the harm basket are one declaration's two shapes, never both. */
export const GATE2_HARM_AND_BASKET_REFUSED =
  "gate2Harm and gate2 (the class basket) were BOTH supplied. Refused rather than resolved: harm REPLACES the " +
  "class basket for the Gate-2 subject (declaration rule H9), so one of the two is a declaration this wiring " +
  "would silently ignore.";

/** The book and the roster are two books with two writers; one file cannot be both. */
export const GATE2_BOOK_IS_ROSTER =
  "NOT WIRED — the witness's book of effects (gate2BookPath) and the act roster (gate2RosterPath) name the " +
  "SAME FILE. Each book has one writer; a file that is both is neither. Not read. THIS IS NOT A STATEMENT THAT " +
  "NO ITEM CHANGED.";

/** A full-record view of a chained book: the harm branch reads `witnessed`, `hash` and `recordType`. */
function gate2FullRecordLog(book: SubjectChainLog): MicaReadableLog & { readonly sourcePath: string } {
  return {
    verify: () => book.verify(),
    getLoadState: () => book.getLoadState(),
    getAll: () => book.getChain() as unknown as readonly MicaLogRecord[],
    sourcePath: book.sourcePath,
  };
}

/** A predecessor that could not be verified: it fails the reader's readability gate, so it can never be read as quiet. */
function gate2UnverifiedPredecessor(path: string): MicaReadableLog & { readonly sourcePath: string } {
  return {
    verify: () => ({ valid: false }),
    getLoadState: () => "PREDECESSOR_NOT_VERIFIED",
    getAll: () => [],
    sourcePath: path,
  };
}

export interface Gate2PredecessorChain {
  /** Newest first. An unverifiable link is the LAST entry, as a stub that fails the readability gate. */
  readonly logs: readonly (MicaReadableLog & { readonly sourcePath: string })[];
  readonly line: string;
}

/**
 * Follow the book's declared predecessor chain (`retired` on each boundary line): each retired path must sit in
 * the SAME directory as the book, exist as a regular file, and hash to its declared sha256; it is then opened as a
 * chained log. Recurse until `retired: null`. The first link that fails ends the walk as an unverified stub, so the
 * reader reads CANNOT_ASSESS · G2_PREDECESSOR_NOT_READABLE over it unless an ALARM stands from the readable books.
 */
export function gate2PredecessorChain(book: SubjectChainLog): Gate2PredecessorChain {
  const logs: (MicaReadableLog & { readonly sourcePath: string })[] = [];
  const said: string[] = [];
  const bookPath = resolvePath(book.sourcePath);
  const dir = dirname(bookPath);
  const visited = new Set<string>([bookPath]);
  const first = book.getBoundary();
  let retired = first === null ? null : first.retired;
  if (first === null) said.push("the book's boundary did not load, so no predecessor can be named");
  while (retired !== null) {
    const p = resolvePath(dir, retired.path);
    const fail = (why: string): void => {
      logs.push(gate2UnverifiedPredecessor(p));
      said.push(`${p}: NOT VERIFIED — ${why}`);
    };
    if (dirname(p) !== dir) {
      fail("it does not sit in the book's own directory");
      break;
    }
    if (visited.has(p)) {
      fail("the chain names a book it already named (a cycle)");
      break;
    }
    // T27 cond. 5 · THE LINK'S READ AND HASH SIT IN THE LINK'S OWN TRY. A retired book the reader's uid cannot open
    // (mode 000) used to throw out of the walk at the bare readFileSync, and the harm seam's catch then DISCARDED the
    // current book's computable ALARM. Under the ruled scope (the arbiter, 2026-10-17 15:37Z: "Throws only") an unreadable
    // book is NOT A THROW: the link is this walk's fail(...) — an unverified stub, so the reader reads
    // G2_PREDECESSOR_NOT_READABLE unless an ALARM stands — and it is never a readerThrows entry. Class word only.
    // A DIRECTORY never reached the read: it is the not-a-regular-file stub below, unchanged (the control).
    let sha: string;
    try {
      if (!existsSync(p) || !lstatSync(p).isFile()) {
        fail("it is missing, or not a regular file");
        break;
      }
      sha = createHash("sha256").update(readFileSync(p)).digest("hex");
    } catch (error) {
      fail(`it could not be read (${gate1ErrorClass(error)}): NOT READABLE, which is not a throw; the thrown text is withheld`);
      break;
    }
    if (sha !== retired.sha256) {
      fail(`its sha256 ${sha.slice(0, 12)}… is not the declared ${retired.sha256.slice(0, 12)}…`);
      break;
    }
    let log: SubjectChainLog;
    try {
      log = new SubjectChainLog({ path: p });
    } catch (error) {
      fail(`its adapter threw (${gate1ErrorClass(error)})`);
      break;
    }
    visited.add(p);
    logs.push(gate2FullRecordLog(log));
    said.push(`${p}: sha256 verified, loadState=${log.getLoadState()}, records=${String(log.recordCount)}`);
    const b = log.getBoundary();
    retired = b === null ? null : b.retired;
  }
  return {
    logs,
    line:
      "PREDECESSORS (the latch only, never the counts): " +
      (said.length === 0 ? "none — the book declares retired: null (declared, NOT verified absent)" : said.join("; ")),
  };
}

/**
 * The ROSTER from the interest book: every label record of the harm basket's origin subjects that carries a
 * bridge-minted subjectSeq and an actionId, as {subjectSeq, actionId, label: outcome, timestamp}. Unreadable → null
 * (the reader then reads G2_ROSTER_NOT_READABLE).
 */
export function gate2RosterOf(
  rosterPath: string | undefined,
  subjects: readonly string[]
): { readonly roster: readonly Gate2RosterEntry[] | null; readonly log: SubjectChainLog | null; readonly line: string } {
  if (rosterPath === undefined) {
    return { roster: null, log: null, line: "ROSTER: none supplied (gate2RosterPath absent)" };
  }
  try {
    const log = new SubjectChainLog({ path: rosterPath });
    if (log.getLoadState() !== "LOADED_SUBJECT_CHAIN_VERIFIED") {
      return { roster: null, log: null, line: `ROSTER: ${rosterPath} NOT READABLE — loadState=${log.getLoadState()}` };
    }
    // IN THE INTEREST BOOK'S APPEND ORDER (its chain order), which the reader keeps: subjectSeq restarts at 1 on a
    // rotated subject chain, so only the book's order says which act is newest (the bytes refuter, C2).
    const roster: Gate2RosterEntry[] = [];
    let skipped = 0;
    for (const r of log.getChain()) {
      if (r.recordType !== "SUBJECT_EVENT" || !subjects.includes(r.moduleId)) continue;
      const seq = (r as { subjectSeq?: unknown }).subjectSeq;
      if (typeof seq !== "number" || !Number.isSafeInteger(seq) || typeof r.actionId !== "string") {
        skipped++;
        continue;
      }
      roster.push({ subjectSeq: seq, actionId: r.actionId, label: r.outcome, timestamp: r.timestamp });
    }
    return {
      roster,
      log,
      line: `ROSTER: ${rosterPath} (the interest book, read for the act roster only): ${String(roster.length)} act(s) of the origin subject(s); records without a subjectSeq or actionId, skipped: ${String(skipped)}`,
    };
  } catch (error) {
    return { roster: null, log: null, line: `ROSTER: ${rosterPath} NOT READABLE — its adapter threw (${gate1ErrorClass(error)})` };
  }
}

/**
 * THE DECISION OBJECT'S CHANNEL FOR THE HARM READING (canon refuter M2 on e42017c). /explain carries a decision's
 * `readings` (from `readerMargins`), `rationale`, `findings` (ALARM only) and `blindPaths` (CANNOT_ASSESS only) —
 * never a verdict's summary — so a granted SILENT's origin and grant had nowhere to go. In harm mode Gate 2 pushes
 * ONE readings row: NO_THRESHOLD (the harm branch has no line to measure a distance to: one ungranted, uncleared
 * DIFFERS alarms), whose reason quotes the reader's own `harmLine` verbatim. The class path pushes no row, as before.
 */
export const GATE2_HARM_NO_THRESHOLD =
  "GATE 2 HARM has no threshold and no margin on any reading: one ungranted, uncleared DIFFERS on an item alarms, " +
  "so there is no distance to report (DL-1). What this reading read, quoted verbatim from the reader's own verdict:";

export function gate2HarmReadingReason(reading: Gate2DirectionReading): string {
  // S216-2 (cond. 8): /explain never carries a summary, so the reader's grant-memory line rides here, after the
  // harmLine, verbatim; the harmLine itself is unchanged.
  const memory = typeof reading.grantMemoryLine === "string" ? ` ${reading.grantMemoryLine}` : "";
  return `${GATE2_HARM_NO_THRESHOLD} ${reading.harmLine ?? "(the reader returned no harm line)"}${memory}`;
}

/**
 * One line for the census in harm mode: HARM <harmClass>, the grant memory's tag as the bridge sent it (S216-2,
 * cond. 8; "not sent" from a bridge that sends none, whose reading is then WIRED AND BLIND), the latch state, the code.
 */
export function gate2HarmCensusLine(reading: Gate2DirectionReading, harmClass: string, grantMemoryTag?: unknown): string {
  const latch =
    reading.verdict.kind !== "ALARM"
      ? "no latch stands"
      : reading.latchedSince !== null
        ? `LATCHED since seq ${String(reading.latchedSince)} of the current book`
        : "LATCHED in a predecessor book (named on the verdict)";
  const tag = typeof grantMemoryTag === "string" ? grantMemoryTag : "not sent";
  return `GATE 2 HARM ${harmClass} (grant memory ${tag}): ${reading.verdict.kind} — code ${String(reading.code)}; ${latch}.`;
}

export const OP3_WINDOW_ABSENT =
  "OP-3 WINDOW: none declared — op3 pairs over the whole readable log. On a " +
  "record whose response class was added later than its earliest expectations, " +
  "that reads those expectations as unanswered calls. See readers.nodeResponse.since.";

/**
 * THE WINDOW, PRINTED ON THE VERDICT'S OWN FACE — never only in the config.
 *
 * A reader that silently ignores part of the record is worse than one that
 * refuses, so the count it did NOT look at travels with every reading.
 */
export function op3WindowNote(
  since: number,
  totalRecords: number,
  pairedRecords: number
): string {
  const skipped = totalRecords - pairedRecords;
  return (
    `OP-3 WINDOW: pairing from sequence ${String(since)} onward — ` +
    `${String(pairedRecords)} of ${String(totalRecords)} readable record(s), ` +
    `${String(skipped)} BEFORE THE WINDOW AND NOT READ BY THIS SENSOR. ` +
    `Conduct before sequence ${String(since)} is a DECLARED BLIND SPOT of op3, ` +
    `not a clean reading of it. The window does not narrow the chain check: ` +
    `verify() still runs over the whole log.`
  );
}

export const OP3_HARNESS_PAIRING_CEILING =
  "DEPLOYMENT CEILING — WHAT THIS READING IS OF: H12 READS THE HARNESS'S " +
  "RECORD-KEEPING, NEVER A HUMAN NODE'S RESPONSIVENESS. Canon's node is a " +
  "person; the node here is this deployment's own tool loop, and every record " +
  "OP-3 reads was written by the same harness whose discipline it is scoring — " +
  "so a finding is about what the caller WROTE, and never about what any agent " +
  "or any person DID. AND THE PAIRING IS NOT THE actionId's: every subject " +
  "record carries `actionId`, and the harness is what binds an attempt to its " +
  "result by that field, but THIS INSTRUMENT NEVER READS IT — it pairs an " +
  "expectation to the NEXT record of the declared response class within the " +
  "declared step bound, BY SEQUENCE POSITION ALONE. The harness's writing ORDER " +
  "is therefore standing proxy for the harness's actionId binding, and the two " +
  "come apart the moment the bound is wide enough to reach past one act: a " +
  "bound that does so pairs an attempt to a DIFFERENT act's result and reads " +
  "clean. A narrow bound is the honest one and it is the one that alarms.";

/**
 * THE ONE SENTENCE THE INSTRUMENT IS ALLOWED TO SAY. Carried here so the CLI
 * prints it from the code rather than from a comment.
 */
export const GUARD_SENTENCE =
  "One action went in; what came out is a disposition — HOLD, HOLD-BLIND, " +
  "PASS-BLIND, or RELEASE — composed only from the wired readers' refusals and " +
  "blindnesses, durably accounted for. RELEASE means no wired reader refused, " +
  "and nothing more.";

/** Why an unwired reader is not a blind one, printed with every census. */
export const UNWIRED_IS_NOT_BLIND =
  "AN UNWIRED READER IS NOT AN ERROR AND NOT A BLIND PATH. It composes nothing " +
  "into the floor — no verdict, no blind term — and this census is the whole of " +
  "what this run claims about it. A reader that WAS wired and could not read is " +
  "a different thing entirely: that is CANNOT_ASSESS, it composes, and it lowers " +
  "the bound.";

// ── the census ───────────────────────────────────────────────────────────────

export interface ReaderCensusEntry {
  readonly reader: string;
  readonly wired: boolean;
  /** What it was pointed at, or why nothing pointed it anywhere. */
  readonly source: string;
  /** The verdict kind it returned, or null when it was not wired. */
  readonly verdictKind: VerdictKind | null;
}

/**
 * Counts and states only, in the shape `src/mica/notify/types.ts` established:
 * a census ships WITH the thing it describes so that an unwired deployment and a
 * quiet one are distinguishable at bytes. It carries no threshold, no
 * expectation, and no reading of whether any of it is adequate.
 */
export interface WireCensus {
  readonly readers: readonly ReaderCensusEntry[];
  readonly log: string;
  readonly readableLoadStates: readonly string[] | null;
  readonly floorTrail: string;
  readonly ledger: string;
  readonly notices: string;
  /**
   * WHO OWNS THE NOTIFIER, as a value rather than as prose a reader has to
   * parse. C8: a census that reads the same whether the counter's lifetime is
   * one action or the whole service cannot tell an operator which number they
   * are looking at — and `notices` above is one free-text line, which is
   * exactly the shape that lets two different facts wear one sentence.
   */
  readonly noticeOwnership: NoticeOwnership;
  readonly stakesLine: string;
  readonly stakesClass: string;
  /**
   * What the PROBE DOOR established about custody, or null when no probe source
   * was offered. TWO LAYERS, NAMED SEPARATELY (ruled S101): this line reports
   * what the DOOR checked — ownership and non-writability — and the line beside
   * it in the render says what Sig still does not check. A census that printed
   * the first without the second would let a reader hear "MICA verified the
   * probe", which is not what either layer says.
   */
  readonly probeDoor: string | null;
  /**
   * What the CLERK-CLOCK-STAMPS DOOR established about custody (S109-B), or
   * null when no `--clerk-clock-stamps` was offered this run. Same two-layer
   * discipline as `probeDoor`: this line reports what the door checked
   * (ownership, non-writability); `SIG_STILL_NEVER_VERIFIES_THE_CLOCK_JOIN`
   * beside it says what F3 still does not check.
   */
  readonly clockStampsDoor: string | null;
  /**
   * Which reader read the log, and — when it is the witness reader — the mapping
   * it applied and what it attests. Null when no log was wired.
   *
   * THE MAPPING IS PRINTED BECAUSE EVERY ROW OF IT IS A CLAIM. A reader who
   * cannot see that `outcome` is a fixed literal cannot audit an Eng alarm about
   * `outcome` carrying no information — and that alarm is expected here, and is
   * about the mapping rather than about the observed system.
   */
  readonly logReader: readonly string[] | null;
}

export interface GuardWiring {
  readonly chokepoint: Chokepoint;
  /** In wiring order. Contains an entry per WIRED reader and no others. */
  readonly sensorVerdicts: readonly SensorVerdict[];
  readonly census: WireCensus;
  /** Present only when a notice destination was supplied. Never defaulted. */
  readonly notifier: ComposedNotifier | null;
  /** The adapter, so a caller can print what the file actually did. */
  readonly logFile: MicaLogFile | WitnessStoreLog | SubjectChainLog | null;
  /**
   * GATE 1'S OWN ADAPTER — the interest book it read, or null when Gate 1 took
   * no reading. Exposed because Gate 1 does NOT stand on `logFile`: its footing
   * is the book's load state, and `footingsFromWiring` reads it from here. A
   * footing borrowed from the subject log would report a chain Gate 1 never
   * looked at.
   */
  readonly gate1Log: SubjectChainLog | null;
  /**
   * GATE 2'S OWN ADAPTER WHEN IT READS THE WITNESS'S BOOK — null when Gate 2 reads
   * `logFile` (its footing is then `logFile`'s, by construction), or when the
   * book's adapter threw (no footing; none borrowed). `gate2ReadsBook` says which.
   */
  readonly gate2Log: SubjectChainLog | null;
  readonly gate2ReadsBook: boolean;
  /**
   * R1/`/explain`. One entry per WIRED reader, in wiring order, parallel to
   * `sensorVerdicts`. See `ReadingMargin` for why every entry is a union and
   * never a nullable number.
   */
  readonly readerMargins: readonly ReaderMarginReading[];
  /**
   * ACT B. Sig's F3 leg AS THIS WIRING READ IT, or null when Sig was not wired.
   *
   * WHY IT IS SURFACED AT ALL, and why here rather than inferred downstream:
   * F3 is the only leg on this box whose verdict depends on a SECOND PRINCIPAL
   * having stamped the record, and `SensorVerdict` carries Sig's composed kind
   * only — a `CANNOT_ASSESS` on the composed verdict says nothing about WHICH
   * leg went blind or why. mica-bridge's `/status` and `/explain` are asked to
   * report "F3: promoted | disclosed (reason)", and a reporting layer that
   * derived that from the composed verdict would be guessing. This layer
   * STATES the observation; whether "promoted" is the right word for it is
   * mica-bridge's judgement, made in one place, exactly as `ReaderFootingReading`
   * leaves `verifiedChain` to `computeFooting`.
   */
  readonly sigF3: SigF3Reading | null;
  /**
   * T27 · every throw this wiring caught, in the closed set of the ruled scope: the seam's catches, the readers' own
   * nets (READER_OWN_NET_CODES), an adapter that threw before any reading. [] when nothing threw, and NEVER filled from
   * a blind code: a typed NOT READABLE is not a throw. The chokepoint this wiring built holds the act on it (F6).
   */
  readonly readerThrows: readonly ReaderThrow[];
}

/**
 * ACT B. One F3 reading, taken from the `FlagReport` and nothing else.
 *
 * `reason` is the leg's own first blind-path detail VERBATIM — never a summary,
 * never a default. A leg that produced a verdict has no blind path and no
 * reason, and that null is the difference between "read cleanly" and "read
 * cleanly and had nothing to say about it".
 */
export interface SigF3Reading {
  /** Verbatim from the flag report. Never mapped. */
  readonly kind: FlagStatus;
  /** Records that fell inside F3's scope this run. */
  readonly scopeSize: number;
  /** How many stamps were injected, or null when no source was injected at all. */
  readonly stampCount: number | null;
  /** The first blind path's class, or null when the leg was not blind. */
  readonly blindClass: string | null;
  /** The first blind path's detail, verbatim, or null when the leg was not blind. */
  readonly reason: string | null;
  /**
   * SHAPE 3′ · F3's OWN COUNTS, CARRIED VERBATIM AND NOT RE-SELECTED.
   *
   * The arbiter, 2026-09-29: "surface the F3 counters on /explain". This is the field
   * that makes that possible: `/explain` reads a decision out of the journal,
   * not a live wiring, so a counter that never joined the decision object is a
   * counter `/explain` cannot report however much the reader computed it.
   *
   * WHY THE WHOLE OBJECT AND NOT A CHOSEN SUBSET. Every member of
   * `F3StampCoverage` is a count of records or stamps and none of them is a
   * judgement — that is the type's own stated discipline. Copying four of them
   * onto a narrower shape would put a SECOND editorial layer between the reader
   * and the operator, and the two would drift the first time the reader gained
   * a counter and this file did not. Carried verbatim, "the numbers on
   * /explain" and "the numbers the reader computed" are the same numbers by
   * construction.
   *
   * NULL IS NOT ZERO. `SigResult.clerkStampCoverage` is null when the log could
   * not be read at all, and the sig reader says why in its own words: a zeroed
   * coverage object would read as "nothing was missing", which is a claim about
   * a scope nobody looked at. That null is preserved here rather than filled in.
   */
  readonly coverage: F3StampCoverage | null;
}

/** The F3 leg of one SigResult, or null when it carries no F3 report. */
export function sigF3Of(result: SigResult, config: SigConfig): SigF3Reading | null {
  const f3 = result.flags.find((f) => f.flag === "F3");
  if (f3 === undefined) return null;
  const blind = f3.blindPaths[0];
  const source = config.clerkClockSource;
  return {
    kind: f3.kind,
    scopeSize: f3.scopeSize,
    stampCount: source === undefined ? null : source.length,
    blindClass: blind === undefined ? null : blind.class,
    reason: blind === undefined ? null : blind.detail,
    // Taken from the SAME SigResult the kind above came from. Never re-derived
    // from a second `assessSig` call, which would be a different reading of a
    // log that may have moved between the two.
    coverage: result.clerkStampCoverage,
  };
}

// ── the footing, derived from ONE wiring and nothing else ────────────────────

/**
 * P6. One reader's FOOTING as THIS wiring read it: the load state the log
 * adapter actually reported, named against the reader that stood on it.
 *
 * NOT `ReaderFooting` (mica-bridge's shape, which also carries `verifiedChain`).
 * This layer states the observation; whether a given load state is the
 * chain-verified one is a judgement, and mica-bridge's `computeFooting` is the
 * ONE place that judgement is made (Amendment 11 / Ruling R item 2). Two places
 * deciding "is this verified" is how two answers get shipped, so this file
 * decides it nowhere.
 */
export interface ReaderFootingReading {
  readonly reader: string;
  /** Verbatim from the adapter this wiring built. Never defaulted, never mapped. */
  readonly loadState: string;
}

/**
 * P6, AND THE WHOLE POINT OF ITS SHAPE. The footings of a `GuardWiring`,
 * computed from THAT VALUE AND NOTHING ELSE.
 *
 * WHY A PURE FUNCTION OF ONE ARGUMENT, said plainly because it is the defect
 * this beat exists to prevent rather than a style preference: the tempting way
 * to fill a `readerFootings` field is to ask the deployment what its readers
 * are standing on — a second `wire()` call, a `/status` probe, a cached census.
 * Every one of those answers a DIFFERENT question ("what is the log's state
 * now?") and presents it as the answer to this one ("what did the reader that
 * produced THIS decision stand on?"). Those diverge exactly when it matters:
 * when the log changed between the two reads.
 *
 * A function whose only input is the wiring cannot make that mistake, and
 * neither can a caller who has only this function: the footing it returns
 * belongs to the `wire()` call that produced the argument, by construction.
 *
 * ENTRIES ONLY FOR READERS THAT ACTUALLY READ THE LOG. Eng and Sig share the
 * one `logFile` instance `wire()` builds (see `wire()` above: it is constructed
 * once inside the `logPath !== undefined` branch and handed to both). The gap
 * reader reads a clerk store, not this log, so attributing this log's load
 * state to it would be a fabricated reading — it gets no entry. An empty array
 * therefore means "no reader took a reading from a log in this wiring", which
 * is a true statement about THIS call, not a silence.
 */
export function footingsFromWiring(wiring: GuardWiring): readonly ReaderFootingReading[] {
  // Each adapter's load state is read once, from the adapter THIS wiring built.
  // Two adapters, because Gate 1 reads a different file (placement D).
  const logState = wiring.logFile === null ? null : wiring.logFile.getLoadState();
  const bookState = wiring.gate1Log === null ? null : wiring.gate1Log.getLoadState();
  const footings: ReaderFootingReading[] = [];
  // T27 (v3 cond. 13 (ii)): a reader whose step threw — the seam's catch OR its own net — produced no reading, so it
  // reports NO footing even when its adapter loaded: a footing beside a non-reading would present it as standing on
  // a chain it never read.
  const threw = new Set(wiring.readerThrows.map((t) => t.reader));
  for (const r of wiring.census.readers) {
    if (!r.wired) continue;
    if (threw.has(r.reader)) continue;
    // GATE 1: its footing is the INTEREST BOOK's load state — the file it
    // actually read — and never `logFile`'s. Wired with a null book has ONE
    // cause (round 3, K1R2-5): the book's adapter THREW, Gate 1 composed the
    // reader's G1_READER_THREW blindness, and there is no load state to report.
    // It reports no footing rather than borrowing one.
    if (r.reader === GATE1_READER) {
      if (bookState !== null) footings.push({ reader: r.reader, loadState: bookState });
      continue;
    }
    // GATE 2 ON THE WITNESS'S BOOK: the book's load state, never `logFile`'s —
    // Gate 1's rule. A thrown book adapter reports no footing.
    if (r.reader === GATE2_READER && wiring.gate2ReadsBook) {
      if (wiring.gate2Log !== null) footings.push({ reader: r.reader, loadState: wiring.gate2Log.getLoadState() });
      continue;
    }
    if (
      logState !== null &&
      (r.reader === ENG_READER ||
        r.reader === SIG_READER ||
        // ITEM 4: narrow-K is handed the SAME `logFile` instance Eng and Sig
        // are handed, in the branch above — so its footing is that adapter's
        // load state, by construction and not by assertion. A wired reader
        // that took a reading and reported no footing would be the one shape
        // this function exists to make impossible.
        r.reader === NARROW_K_READER ||
        // THE BUNDLE + H12: the same by construction — these four are handed
        // the SAME `logFile` instance in the same branch. A wired reader that
        // took a reading and reported no footing is the one shape this
        // function exists to make impossible, and omitting a new reader here
        // is exactly how that shape gets back in. Nothing is asserted about
        // op3's footing that is not true of Eng's by the same three lines.
        r.reader === NARROW_W_READER ||
        r.reader === NARROW_R_READER ||
        r.reader === OP1_READER ||
        r.reader === OP3_READER ||
        // GATE 2 (Stop 2): handed the SAME `logFile` instance, so the same
        // footing by construction. Omitting it would be the shape this list
        // exists to forbid — a wired reader that read and reports no footing.
        r.reader === GATE2_READER)
      // ⚠ PRE-EXISTING, REPORTED, NOT REPAIRED HERE: GATE4_READER and
      //   NARROW_T_READER are ALSO handed `logFile` in that branch and are
      //   ABSENT from this list, so a wired Gate 4 or narrow-T takes a reading
      //   and reports no footing — the shape the comment above says this
      //   function exists to make impossible. Their repair is its own dispatch;
      //   adding them silently here would move pinned arms.
    ) {
      footings.push({ reader: r.reader, loadState: logState });
    }
  }
  return footings;
}

// ── the margin, and the three honest things it can be ────────────────────────
//
// R1. The arbiter asked for "events just below the alarm line" and for `/explain` to
// say WHICH READER CLOSED THE GATE AND BY HOW MUCH. This is the "by how much"
// half, and the first thing to get right about it is that MOST READINGS DO NOT
// HAVE ONE — and they fail to have one for two reasons that must never be
// flattened into a single `null`.
//
// THE DEFECT THIS SHAPE EXISTS TO PREVENT is the one register E1 already names
// against this codebase and `ReaderFootingsBasis` already fixed once: A FIELD
// THAT READS IDENTICALLY WHETHER OR NOT THE THING IT DESCRIBES HAPPENED.
// `margin: number | null` is exactly that shape. A `null` there can mean:
//
//   (a) this reader HAS a threshold and this particular reading did not reach
//       it — the statistic was never computed, so no distance exists. Eng on
//       this deployment today: the chain holds far fewer entries than the
//       injected `minimumSampleSize`, so `assessEng` returns before
//       `engStructure()` is ever called and `EngResult.structure` is absent.
//       A different day's reading, on a longer chain, WOULD have a number.
//
//   (b) this reader HAS NO THRESHOLD AT ALL and never will. Sig is a
//       contradiction reader: its four flags report whether the record
//       contradicts itself, which is not a quantity with a line under it.
//       There is no reading of Sig, on any chain, that has a margin. Asking
//       "how close was Sig to alarming" is not a hard question, it is not a
//       question.
//
// Those are different facts about the deployment and a consumer that cannot
// tell them apart will read (b) as (a) and wait for a number that is never
// coming. So the margin is a UNION, and the absent arms carry their own reason.
//
// AND THE THING THIS MUST NEVER BECOME, stated here because it is the failure
// the endpoint would be used to commit: A CANNOT_ASSESS HAS NO MARGIN. It has
// a REASON. Rendering a distance where the machine did not look is a confident
// number over a blind spot, which is worse than silence because it reads as
// evidence. `NOT_MEASURED.reason` is quoted from the reader's own verdict and
// is not composed here — nothing in this file invents a distance.

export type ReadingMargin =
  | {
      readonly kind: "MEASURED";
      /** What was measured, named as the reader names it. */
      readonly statistic: string;
      readonly value: number;
      /** The injected threshold it was measured against. Never defaulted. */
      readonly threshold: number;
      /** The declaration field the threshold came from. */
      readonly thresholdName: string;
      /**
       * `value - threshold`. SIGNED, and the sign is not a verdict: which side
       * of the line is adverse is the reader's rule, not this field's, and
       * `relation` states the reader's rule in words rather than leaving a
       * consumer to guess it from the sign.
       */
      readonly distance: number;
      readonly relation: string;
    }
  | {
      /** (a) above: a threshold exists; THIS reading produced no statistic. */
      readonly kind: "NOT_MEASURED";
      /** Quoted from the reader's own verdict. Never composed here. */
      readonly reason: string;
    }
  | {
      /** (b) above: this reader has no threshold, on any reading, ever. */
      readonly kind: "NO_THRESHOLD";
      readonly reason: string;
    };

/** One wired reader's margin, named against the reader and its verdict kind. */
export interface ReaderMarginReading {
  readonly reader: string;
  readonly kind: VerdictKind;
  readonly margin: ReadingMargin;
}

// ── A CORRECTION, NOT AN EXTENSION ───────────────────────────────────────────
//
// What stood here until 2026-09-23 said:
//
//   "Sig has no threshold and no margin, on this reading or any other … There
//    is no quantity here with a line under it … This is a PERMANENT STRUCTURAL
//    FACT about the reader."
//
// IT WAS FALSE AT BYTES, and `glue.test.ts` asserted the false sentence,
// including the words "permanent structural fact". F1 and F3 both compute a
// declared-time DELTA and compare it to `clockToleranceMs`
// (`src/mica/sig/index.ts`: F1 at the tolerance check, F3 at "beyond
// clockToleranceMs"), and `clockToleranceMs` is an injected, declared number
// — `readers.sig.clockToleranceMs` — which is exactly what `thresholdName`
// names. So Sig HAS a line, and had one before T3 was written.
//
// This is therefore a correction of a claim the codebase itself contradicted,
// held in place by a test. The arbiter's T3 item (4) does NOT give Sig a threshold it
// never had; it stops the machine from saying it has none. That correction was
// owed regardless of whether T3 shipped, and it lives here in `src/glue/`,
// which is NON-CORE and needs no ticket.
//
// What is TRUE, and is what this constant now says: on a reading where F3 never
// got as far as comparing an adjacent pair, no distance was produced — and that
// is a fact about THIS READING, not about the reader for ever.

/** The declaration field Sig's one numeric line comes from. */
export const SIG_THRESHOLD_NAME = "readers.sig.clockToleranceMs";

export const SIG_TOOK_NO_MEASUREMENT =
  "Sig produced no distance on THIS reading. Sig's legs are yes/no scopes — the " +
  "record either contradicts itself or it does not (F1 clock order, F2 " +
  "activation, F3 the clerk join, F4 the probe) — with ONE quantity underneath: " +
  "F1 and F3 measure a declared-time delta against the injected " +
  `${"readers.sig.clockToleranceMs"}. On this reading F3 did not reach a pair to ` +
  "compare, so there is no delta and no distance to report. This is a statement " +
  "about this reading, NOT a claim that the reader can never produce a number.";

export const GAP_HAS_NO_THRESHOLD =
  "The clerk gap reader reports cadence against the clerk store's own arrival " +
  "record; it is not wired on this deployment (no clerkStore is supplied) and " +
  "carries no injected numeric threshold when it is. No margin is claimed for it.";

/**
 * Eng's margin, from ONE `EngResult` and the threshold THAT CALL was handed.
 *
 * PURE, AND A FUNCTION OF THE CALL'S OWN ARGUMENTS, for the same reason
 * `footingsFromWiring` is: the tempting way to fill this in is to ask the
 * deployment what its threshold is — read the declaration again, consult a
 * cached config. That answers "what is the threshold now?", which is a
 * different question from "what was THIS reading measured against?", and the
 * two diverge exactly when the declaration changed between them.
 *
 * `EngResult.structure` is OPTIONAL and its own doc comment says why: "Present
 * whenever the statistic was actually computed." Every early return in
 * `assessEng` — unreadable load state, missing configuration, insufficient
 * sample, ineligible scope — returns before `engStructure()` runs and carries
 * no `structure` at all. On each of those, this returns NOT_MEASURED with the
 * reader's own words for why, and never a number.
 */
export function engMarginOf(
  result: EngResult,
  threshold: number | undefined
): ReadingMargin {
  const ami = result.structure?.ami;
  if (typeof ami !== "number" || !Number.isFinite(ami)) {
    return { kind: "NOT_MEASURED", reason: readerOwnReason(result.verdict) };
  }
  if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
    return {
      kind: "NOT_MEASURED",
      reason:
        "the structure statistic was computed, but no finite structureThreshold " +
        "was injected for this call — there is no line to measure the distance to.",
    };
  }
  return {
    kind: "MEASURED",
    statistic: "ami",
    value: ami,
    threshold,
    thresholdName: "readers.eng.structureThreshold",
    distance: ami - threshold,
    relation:
      "adjusted mutual information between event class and outcome, against the " +
      "injected structureThreshold. Eng alarms when the statistic is AT OR BELOW " +
      "the threshold (collapsed structure), so a distance at or below zero is the " +
      "adverse side and a positive distance is the headroom this reading had.",
  };
}

/**
 * Sig's margin — T3 item (4). NO LONGER CONSTANT, and no longer ignoring its
 * argument: the comment that stood here said "a future Sig that DID acquire a
 * threshold would change here rather than at the caller", and this is that
 * change. Sig did not acquire the threshold; it always had one (see the
 * correction above `SIG_TOOK_NO_MEASUREMENT`).
 *
 * The number is F3's largest declared-time inversion in clerk receipt order,
 * against the `clockToleranceMs` THAT CALL was handed — taken from
 * `SigResult.f3Deviation`, which the reader computes, rather than parsed back
 * out of a finding's prose.
 *
 * PURE, and a function of the call's own arguments, for the reason
 * `engMarginOf` states: the tempting fill-in is to ask the deployment what its
 * tolerance is now, which answers a different question from "what was THIS
 * reading measured against".
 *
 * ⚠ A CANNOT_ASSESS STILL HAS NO MARGIN. `f3Deviation` is null unless F3 got as
 * far as comparing a pair, so a blind leg cannot render a distance over a scope
 * nobody read.
 */
export function sigMarginOf(result: SigResult): ReadingMargin {
  // ── T9 · ONE FIELD, TWO LEGS, AND THE MARGIN MUST NOT PICK A FAVOURITE ──────
  //
  // `readers.sig.clockToleranceMs` is a SINGLE declared value read by F1 (the
  // record against its own append order) and by F3 (the record against the
  // clerk's independently stamped receipt order). Until T9 only F3 retained a
  // maximum, so this function had one axis to report and reported it.
  //
  // ⛔ REPORTING ONLY F3 IS NOW A CHOICE RATHER THAN A LIMIT, AND IT WOULD BE
  // THE WRONG ONE. A margin answers "how close is this reader to its line". Sig
  // has two legs against one line, and the honest answer is THE ONE CLOSEST TO
  // ALARMING — the larger `distanceMs`, since positive is the adverse side. A
  // reader sitting 14 ms clear on one axis and 3 ms clear on the other is 3 ms
  // clear, and a margin that printed 14 would be an overstatement of headroom
  // dressed as a measurement.
  //
  // ⚠ AND THE OTHER AXIS IS NAMED IN THE SAME BREATH, never dropped. Picking a
  // binding leg and printing only its number would replace one blind spot with
  // another: `relation` carries both, so a reader can see that the reported
  // margin is the worse of two and what the other one was.
  const f1 = result.f1Deviation;
  const f3 = result.f3Deviation;
  if (f1 === null && f3 === null) {
    return { kind: "NOT_MEASURED", reason: SIG_TOOK_NO_MEASUREMENT };
  }

  const axes = [
    f1 === null
      ? null
      : {
          leg: "F1",
          statistic: "sig.f1.maxDeclaredInversionMs",
          dev: f1,
          against: "the record's OWN append order — both sides determined by the appending party, so this is the record disagreeing with itself and not with an independent axis",
        },
    f3 === null
      ? null
      : {
          leg: "F3",
          statistic: "sig.f3.maxDeclaredInversionMs",
          dev: f3,
          against: "the clerk's INDEPENDENTLY stamped receipt order — a second principal's arrival axis, which the subject does not author",
        },
  ].filter((a): a is NonNullable<typeof a> => a !== null);

  // The binding axis: the largest distance, i.e. the leg closest to its line.
  const binding = axes.reduce((a, b) => (b.dev.distanceMs > a.dev.distanceMs ? b : a));
  const other = axes.find((a) => a !== binding) ?? null;

  const otherSentence =
    other !== null
      ? `THE OTHER AXIS, ${other.leg}, measured ${String(other.dev.maxDeclaredInversionMs)} ms ` +
        `over ${String(other.dev.pairsCompared)} adjacent pair(s), distance ` +
        `${String(other.dev.distanceMs)} ms — it is reported here only as context, because the ` +
        `margin above is the WORSE of the two and a reader must not read it as the only one.`
      : `THE OTHER AXIS TOOK NO MEASUREMENT on this reading, so this margin is the only one Sig ` +
        `has — it is NOT a claim that the other axis was clean.`;

  return {
    kind: "MEASURED",
    statistic: binding.statistic,
    value: binding.dev.maxDeclaredInversionMs,
    threshold: binding.dev.clockToleranceMs,
    thresholdName: SIG_THRESHOLD_NAME,
    distance: binding.dev.distanceMs,
    relation:
      `the largest amount by which a declared timestamp ran BACKWARDS against ` +
      `${binding.against}, over the ${String(binding.dev.pairsCompared)} adjacent pair(s) ` +
      `${binding.leg} compared, against the injected clockToleranceMs. Sig alarms when the ` +
      `delta is STRICTLY ABOVE the tolerance, so a positive distance is the adverse side and a ` +
      `negative distance is the headroom this reading had. It binds arrival/order only, never ` +
      `payload truth. ⛔ ONE DECLARED TOLERANCE GOVERNS BOTH OF SIG'S ORDER LEGS, AND THIS ` +
      `MARGIN IS THE CLOSER OF THE TWO TO IT. ${otherSentence}`,
  };
}

/**
 * The reader's OWN stated reason, lifted verbatim. A CANNOT_ASSESS carries its
 * reasons as structured `blindPaths`; anything else carries a `summary`. Either
 * way the words are the reader's, which is the point: this layer reports that
 * no distance exists and quotes who said so, and composes no explanation of
 * its own for a reading it did not take.
 */
function readerOwnReason(verdict: SensorVerdict): string {
  if (verdict.kind === "CANNOT_ASSESS") {
    return verdict.blindPaths
      .map((b) => `[${b.class}] ${b.detail}`)
      .join(" ");
  }
  return (
    `the reader returned ${verdict.kind} without computing the structure ` +
    `statistic. Its own summary: ${verdict.summary}`
  );
}

// ── the binding minimum — WHICH reader closed the gate ───────────────────────
//
// R1, and the half of the arbiter's ask that `/explain` exists for. `composeFloorKind`
// is min() over ALARM < CANNOT_ASSESS < SILENT and is NON-COMPENSATORY by
// construction: no number of SILENT verdicts raises the floor above its worst
// member. So "which reader closed this gate" is a well-posed question, and the
// answer is already latent in `ChokepointDecision`'s two parallel arrays
// (`sensorIds`, `sensorKinds`) — but only latent: nothing today zips them, and
// `composeFloorKind` itself takes bare kind strings and records nothing about
// where its answer came from. The attribution survives ONLY as free text inside
// `rationale`. This makes it a structure.
//
// THE ONE PLACE A CARELESS VERSION OF THIS WOULD LIE is the SILENT floor, and
// it is worth stating rather than discovering later. When the floor is ALARM or
// CANNOT_ASSESS, the binding readers are a PROPER SUBSET: those are the readers
// holding the floor down, and a consumer wants their names. When the floor is
// SILENT, EVERY wired reader is binding — min() over all-SILENT is SILENT only
// because not one of them was otherwise, so any single reader flipping would
// lower it. Reporting "binding: []" there, or naming one reader as though it
// were special, would both be false. Every reader is named and the note says
// why they are all named.
//
// `sensorIds` is not re-derived here from the verdicts: it is taken from the
// same wiring whose margins are being reported, so the two arrays cannot drift
// apart into a margin attributed to a reader that did not produce it.

export interface DecisionReading {
  readonly sensorId: string;
  readonly kind: VerdictKind;
  /** True when this reader's kind IS the composed floor kind. See above. */
  readonly binding: boolean;
  readonly margin: ReadingMargin;
}

export interface BindingMinimum {
  readonly floorKind: VerdictKind;
  /** Every reader whose own kind equals the floor kind, in wiring order. */
  readonly sensorIds: readonly string[];
  /** What "binding" means for THIS floor kind, in words. */
  readonly note: string;
}

export const NO_READER_WIRED_NOTE =
  "NO READER WAS WIRED for this decision. The floor is CANNOT_ASSESS by " +
  "construction (composeFloorKind([]) is CANNOT_ASSESS, deliberately) and no " +
  "reader holds it — it is held by the absence of readers. Nothing here is a " +
  "reading, and nothing here has a margin.";

/**
 * The readings of ONE wiring, against the floor THAT wiring's decision
 * composed. Pure; both arguments come from the same call by construction (the
 * caller holds `wiring` and the `DispositionResult` `wiring.chokepoint.guard`
 * returned), which is the `footingsFromWiring` discipline applied to a second
 * argument that cannot be sourced from anywhere else without lying.
 */
export function readingsFromWiring(
  wiring: GuardWiring,
  floorKind: VerdictKind
): readonly DecisionReading[] {
  return wiring.readerMargins.map((m) => ({
    sensorId: m.reader,
    kind: m.kind,
    binding: m.kind === floorKind,
    margin: m.margin,
  }));
}

/** The binding set, named, with the note its floor kind earns. */
/**
 * The CANNOT_ASSESS note, which must not send the operator to a row that is not there.
 *
 * ⛔ Codex, T11-line-glue read, F1. The binding list was corrected to name
 *    marginless readers — and the note still said "read `margin.reason` on its
 *    row". A marginless reader has NO `readings` row, so for exactly the readers
 *    the fix had just made nameable, the instruction named nothing. Measured on
 *    the live box: `readings` holds Eng and Sig; narrow-K/W/R, narrow-T, op1 and
 *    op3 have no row at all.
 *
 *    THE FIRST REPAIR MADE THIS WORSE, WHICH IS WHY IT IS ITS OWN FINDING. While
 *    `sensorIds` was empty the instruction was unreachable and therefore harmless;
 *    naming the readers turned a dead sentence into a wrong direction. **A fix
 *    that completes one half of a surface can promote the other half's defect.**
 *
 *    So the note is now built from the two sets it is actually about: who has a
 *    row, and who does not.
 */
function cannotAssessNote(
  sensorIds: readonly string[],
  readings: readonly DecisionReading[]
): string {
  const withRow = new Set(readings.map((r) => r.sensorId));
  const rowed = sensorIds.filter((id) => withRow.has(id));
  const rowless = sensorIds.filter((id) => !withRow.has(id));
  const head =
    "These readers COULD NOT ASSESS. An unread scope is not silence, so the floor is " +
    "held here rather than at SILENT, and a reading that was never taken has no " +
    "distance to any line.";
  const where: string[] = [];
  if (rowed.length > 0) {
    where.push(`read \`margin.reason\` on the readings row for ${rowed.join(", ")}`);
  }
  if (rowless.length > 0) {
    where.push(
      `${rowless.join(", ")} report NO margin at all, so there is no readings row to ` +
        "read — their reason is in this decision's own blindPaths, under the reader's " +
        "own words"
    );
  }
  return where.length === 0 ? head : `${head} For the reason: ${where.join("; and ")}.`;
}

export function bindingMinimumOf(
  /**
   * Every reader's own verdict KIND. Typed as the structural minimum this
   * function reads rather than as `SensorVerdict`, deliberately: a parameter
   * wider than the use invites a test to construct a whole verdict to assert
   * one field, and a `SensorVerdict[]` is exactly what the old signature could
   * not be handed cheaply — which is part of why the live shape went untested.
   */
  verdicts: readonly { readonly sensorId: string; readonly kind: VerdictKind }[],
  readings: readonly DecisionReading[],
  floorKind: VerdictKind
): BindingMinimum {
  // ⛔ THE BINDING SET COMES FROM THE VERDICTS, NOT FROM THE MARGINS, AND UNTIL
  //    2026-10-02 IT CAME FROM THE MARGINS. Measured on the live box that day:
  //    `readerMargins` is pushed in THREE places (Eng, Sig, clerk1.gap) while
  //    `sensorVerdicts` is pushed in TEN. So on a box wiring narrow-K/W/R/T,
  //    op1 and op3, six of the eight wired readers could not appear in
  //    `readings` at all — and `bindingMinimum.sensorIds`, filtered from
  //    `readings`, could never name any of them.
  //
  //    AND THE EVIDENCE BISECTS EXACTLY ON THE MARGIN. All 73 decisions the event
  //    book can name were re-read through /explain, 0 unretrievable:
  //
  //      floorKind        NAMED  EMPTY  NULL
  //      ALARM               36     22     0
  //      CANNOT_ASSESS        0     14     1
  //
  //    All 36 NAMED are `SIG_F1_CLOCK_ORDER_CONTRADICTION` — Sig, which pushes a
  //    margin. The 22 empty ALARMs are exactly the MARGINLESS readers:
  //    OP3_RESPONSE_FLATLINE (14), W/K/R/OP1 class-absent combinations (7),
  //    W_INQUIRY_CONTEXT_COLLAPSE (1). And NO CANNOT_ASSESS DECISION HAS EVER
  //    NAMED A READER, because every reader that goes CANNOT_ASSESS on that box
  //    (narrow-K, narrow-W, narrow-R, op3) is marginless — so the mechanism says
  //    it must be all of them, and the floor trail puts 478 of 500 decisions at
  //    CANNOT_ASSESS.
  //
  //    The CANNOT_ASSESS note is the worse of the two: it instructs the operator
  //    to "read `margin.reason` on its row" — a row that does not exist, for a
  //    reader it does not name.
  //
  //    Each of those 22 printed the note "These readers ALARMED and the floor
  //    cannot rise above its worst member" beside an EMPTY list — a sentence
  //    about a set it does not name, on the one field whose job is to answer
  //    "who held this act".
  //
  //    THE SEAM SHAPE, for the tenth time: a producer emits N (ten push sites), a
  //    hand-written projection carries M < N (three), and a reader needs one of
  //    the N − M. A margin is a measurement some readers take; a VERDICT KIND is
  //    something every reader has. Binding is a question about kinds, so it is
  //    answered from kinds.
  //
  //    `readings` stays the margin-bearing subset — that is what it is for, and
  //    narrowing it would lose the distances Eng and Sig do report.
  const sensorIds = verdicts.filter((v) => v.kind === floorKind).map((v) => v.sensorId);
  // "No reader was wired" is a statement about READERS. Keyed off `readings` it
  // was a statement about margins, so a box wiring only marginless readers would
  // have claimed nothing was wired while six readers read.
  if (verdicts.length === 0) {
    return { floorKind, sensorIds: [], note: NO_READER_WIRED_NOTE };
  }
  const note =
    floorKind === "SILENT"
      ? "EVERY wired reader is binding. The floor is SILENT only because not one " +
        "reader was otherwise; any single one of them reading differently would " +
        "lower it. No reader is more responsible for this floor than another, and " +
        "SILENT IS STILL NOT A HEALTH CLAIM — it is the absence of a finding."
      : floorKind === "ALARM"
        ? "These readers ALARMED and the floor cannot rise above its worst member. " +
          "A clean reading from any other reader does not buy this back: the " +
          "composition is non-compensatory."
        : cannotAssessNote(sensorIds, readings);
  return { floorKind, sensorIds, note };
}

export interface WireOptions {
  /** The observed system's log, JSONL. Absent -> Eng and Sig are NOT WIRED. */
  readonly logPath?: string;
  /**
   * WHICH READER reads the log. EXPLICIT, never detected.
   *
   * A detector is a guess wearing a uniform: it would pick the witness reader
   * for anything whose first line happens to carry a `seq`, and its mistakes
   * would arrive as VERDICTS rather than as errors. The operator names the
   * grammar; naming it wrongly fails loudly at line 1 — which is what happened
   * this morning, and is the correct failure.
   *
   * Absent means "mica": the generic JSONL reader, which is what `--log` has
   * always meant, so no existing invocation changes behaviour.
   *
   * "subject-chain" (Act A, the arbiter's ruling 5, 2026-09-22) selects
   * `SubjectChainLog` — the bridge's own subject log once it is a hash-chained
   * store. IT IS A THIRD VALUE HERE AND NOT A `logOverride`: the override
   * pattern (`floorTrailOverride` / `ledgerOverride` / `notifierOverride`) is
   * for caller-owned LIFETIME, which is not the problem; `logKind` is for "the
   * reader is SELECTED, not sniffed", which is exactly the problem. A detector
   * would pick this reader for anything whose first line happens to carry a
   * `previousHash`, and its mistakes would arrive as VERDICTS.
   */
  readonly logKind?: "mica" | "witness" | "subject-chain";
  /** INJECTED, no default. Absent -> every reader is blind for configuration. */
  readonly readableLoadStates?: readonly string[];
  /**
   * The rest of Eng's and Sig's injected numbers and maps. NO DEFAULTS: what is
   * absent stays absent and the reader says so. `readableLoadStates` on these is
   * IGNORED — the run's list comes from the field above, so there is exactly one
   * place a reader of the census can look to see what this run was told to trust.
   */
  readonly eng?: Omit<EngConfig, "readableLoadStates">;
  readonly sig?: Omit<SigConfig, "readableLoadStates">;
  /**
   * ITEM 4. narrow-K's injected profile and leg-2 numbers. Same
   * `readableLoadStates` discipline as `eng`/`sig`: the field on this config is
   * IGNORED and the run's list comes from `readableLoadStates` above.
   *
   * PRESENCE IS THE WIRING SWITCH, unlike `eng`/`sig` — see
   * `NARROW_K_NOT_DECLARED` for why, at length. Absent -> narrow-K is NOT
   * WIRED, contributes no verdict, and the census says so.
   */
  readonly narrowK?: Omit<NarrowKConfig, "readableLoadStates">;
  /**
   * THE BUNDLE · narrow-W's and narrow-R's injected profiles and leg-2 numbers.
   * Same `readableLoadStates` discipline and the same presence-is-the-switch
   * rule as `narrowK` — see `NARROW_W_NOT_DECLARED` / `NARROW_R_NOT_DECLARED`,
   * which say why supplying one TODAY holds every act.
   */
  readonly narrowW?: Omit<NarrowWConfig, "readableLoadStates">;
  readonly narrowR?: Omit<NarrowRConfig, "readableLoadStates">;
  /**
   * narrow-T's injected drift profile. Presence is the switch, exactly as for
   * K/W/R. See `NARROW_T_NOT_DECLARED` for the vacancy and for the inverted
   * polarity that makes a copied sibling number dangerous here.
   */
  readonly narrowT?: Omit<NarrowTConfig, "readableLoadStates">;
  /**
   * THE BUNDLE · op1's doctor-cadence section, the ONLY section of
   * `OperatorLayerProfile` this glue carries.
   *
   * IT IS THE SECTION, NOT THE PROFILE. `assessOp1DoctorCadence` takes a whole
   * `OperatorLayerProfile` and reads `.doctorCadence` out of it; passing the
   * whole profile through here would let a caller supply `auditObligation` or
   * `nodeResponse` to a function that silently ignores them — a field that
   * reads identically whether or not it was honoured. This file wraps the
   * section into a profile at the call site instead, so what is offered and
   * what is read are the same object.
   */
  readonly op1?: OperatorLayerProfile["doctorCadence"];
  /**
   * H12 / OP-3's injected `nodeResponse` section — the SAME type the instrument
   * validates, taken from `OperatorLayerProfile` rather than restated here, so
   * a field added to the profile cannot be silently missing from this door.
   *
   * PRESENCE IS THE WIRING SWITCH, as it is for `narrowK` and unlike
   * `eng`/`sig` — see `OP3_NOT_DECLARED` for why, at length. Absent -> OP-3 is
   * NOT WIRED, contributes no verdict, and the census says so.
   *
   * Only `nodeResponse` is accepted. OP-1's `doctorCadence` and OP-2's
   * `auditObligation` are the other two sections of the same profile object and
   * neither is wired; taking the whole profile here would let a caller declare
   * a section this function silently ignores, which is the shape that makes a
   * census disagree with a reading.
   */
  readonly op3?: NonNullable<OperatorLayerProfile["nodeResponse"]>;

  /**
   * GATE 4 SUNSET — the ONE COMBINED PROFILE, both sections, not a section.
   *
   * op3's option is a section because its instrument takes a profile and reads
   * one key out of it. Gate 4 is the other way round: the instrument takes one
   * combined profile that holds BOTH sections ("vacuity site eleven"), and a
   * partial profile is a legal, meaningful state — leg A declared while leg B
   * stays vacuous is exactly the state the arbiter asked for. So the option is
   * the whole profile, and declaring leg B later needs no second field and no
   * change here.
   */
  readonly gate4?: NonNullable<Gate4SunsetConfig["profile"]>;

  /**
   * ⛔ `gate4HoldWindow` IS GONE (T26). It was the field whose value decided
   *    whether leg A was frozen or latched — and it was declared, so every
   *    ending needed its own act and the value a receipt-reader copied was
   *    `relay-sunset.ts`'s open-ended `startSeq = orderSeq + 1`. The window is
   *    now derived from the record inside the reader. Nothing passes through
   *    here, which is the point: a window the deployer retypes per ending is a
   *    window the deployer can retype wrongly, and nothing downstream could
   *    tell. If this option reappears, so does that whole class of defect.
   */

  /**
   * LEG B'S PAPER FRESHNESS BOUND. Carried now so that declaring leg B is a
   * declaration change and not a code change; unread while leg B is vacuous.
   */
  readonly gate4PaperFreshnessBound?: number;
  /**
   * GATE 1 SCOPE — the declared M-frame as the bridge maps it from
   * `frame[subject]` + `readers.gate1Scope`: the categories (with which are
   * derivable), the ONE record class in the interest book whose `outcome`
   * carries the derived label (its eventType is the frame DRAWING's own class,
   * so labels from an earlier drawing are not counted), and the underived
   * word. The type is the reader's own, imported rather than restated, so a
   * field added there cannot be silently missing from this door.
   *
   * PRESENCE IS THE WIRING SWITCH. Absent -> NOT WIRED, composes nothing, and
   * the census says so (GATE1_NOT_DECLARED). Present with `gate1BookPath` -> a
   * composing reader whose kind is CANNOT_ASSESS on every log — see
   * GATE1_READER for why that is the truth it composes and not a defect.
   * Present WITHOUT it -> NOT WIRED (GATE1_BOOK_NOT_DECLARED). Present with a
   * book that resolves to `logPath` -> NOT WIRED (GATE1_BOOK_IS_THE_LOG).
   * ROUND 3: none of this depends on `logPath` being supplied — Gate 1 reads
   * only the book.
   */
  readonly gate1?: Gate1ScopeFrame;
  /**
   * GATE 1'S BOOK — `paths.interestBook`, resolved by the bridge. A chained
   * file in the subject-chain format (boundary at position 0), written only by
   * the bridge, read here only by Gate 1 and always through `SubjectChainLog`
   * whatever `logKind` says, because that is the one format the bridge writes
   * it in. Meaningful only with `gate1`; ignored without it.
   */
  readonly gate1BookPath?: string;
  /**
   * GATE 2 DIRECTION — the declared basket for the subject, as the bridge
   * builds it from `readers.gate2Direction` + `baskets[subject]` (+ the frame's
   * category ids). The type is the reader's own, imported rather than
   * restated, so a field added there cannot be silently missing from this door.
   *
   * PRESENCE IS THE WIRING SWITCH. Absent -> NOT WIRED, composes nothing
   * (GATE2_NOT_DECLARED). Present with a log -> a composing reader on the SAME
   * `logFile` as the others. Present with no log -> NOT WIRED
   * (GATE2_LOG_NOT_SUPPLIED): it has no file of its own.
   */
  readonly gate2?: Gate2Basket;
  /**
   * GATE 2'S BOOK — the WITNESS'S BOOK OF EFFECTS, `paths.witnessBook`, resolved by
   * the bridge, handed here only when the declaration says Gate 2 reads it
   * (`readers.gate2Direction.source: "witnessBook"`). A chained file in the
   * subject-chain format, written only by the witness's seeing half (seeingd),
   * read here only by Gate 2 and always through `SubjectChainLog`. Absent ->
   * Gate 2 reads `logFile`, exactly as before this option existed. Meaningful
   * only with `gate2`; ignored without it.
   */
  readonly gate2BookPath?: string;
  /**
   * GATE 2 HARM (T33) — the deployer's harm basket for the Gate-2 subject, as the bridge builds it from
   * `harm[subject]` (items with their target fingerprints in the bridge's current salt epoch, origins, grants,
   * clearances, saltEpochSince). The type is the reader's own. PRESENCE IS THE SWITCH: it reads ONLY the
   * witness's book (`gate2BookPath`; absent → NOT WIRED, GATE2_HARM_WITHOUT_BOOK). With `gate2` as well → a
   * WireUsageError. Absent → nothing here changed.
   */
  readonly gate2Harm?: Gate2Harm;
  /**
   * The ACT ROSTER for the harm branch: the interest book (`paths.interestBook`; it may equal gate1BookPath),
   * read for the acts' subjectSeq, actionId, label and instant only, never for effects. Absent or unreadable →
   * the reader's G2_ROSTER_NOT_READABLE. Meaningful only with `gate2Harm`.
   */
  readonly gate2RosterPath?: string;
  /**
   * The actionId of the act whose /guard decision this wire() serves; null or absent = a status read. Meaningful
   * only with `gate2Harm`.
   */
  readonly gate2DecidingActionId?: string | null;
  /**
   * The frame's underived word (Gate 1's `underivedWord`, as the bridge declares it), passed through to the
   * harm reader so it can tell an act whose target sits in no frame category from one whose record is missing.
   * Absent or null → no label is told apart. Meaningful only with `gate2Harm`.
   */
  readonly gate2UnderivedWord?: string | null;
  /**
   * op3's FIRST PAIRABLE SEQUENCE — `readers.nodeResponse.since` at the front
   * door. When present, op3 (AND ONLY op3) pairs over records whose
   * `sequenceNumber` is at or after this value.
   *
   * ⛔ WHY THIS EXISTS, AND IT IS A FACT ABOUT THIS RECORD, NOT ABOUT OP-3:
   * `ACT_CLOSED` did not exist as a kind until the caller relay of 2026-09-25;
   * the first one ever written is sequence 213. op3 pairs an expectation
   * against a later response over the WHOLE readable log, so without a window
   * every `TOOL_ATTEMPTED` before 213 reads as an unanswered call — measured
   * 2026-09-26 against 188 real records: 65 findings, the first at sequence 1.
   * Those calls were not unanswered; the class that answers them did not exist.
   *
   * ⚠ WHAT THE WINDOW DOES NOT NARROW: the chain's own integrity check. The
   * sliced view delegates `verify()` to the FULL log, so a break anywhere still
   * blinds op3. The window narrows what op3 PAIRS OVER, never what it TRUSTS.
   *
   * ⚠ AND IT IS A DECLARED BLIND SPOT, not a repair: conduct before `since` is
   * not read by op3 at all, and the census says so on the reader's own face.
   */
  readonly op3Since?: number;
  /** The clerk store directory. Absent -> the gap reader is NOT WIRED. */
  readonly clerkStore?: string;
  /** Path to, or base64 of, the key the gap read's chain verification anchors on. */
  readonly clerkPubkey?: string;
  /** Read time for the gap read, wall ms. Injected so the read is testable. */
  readonly now?: number;
  /** The injected stakes line (§4). NO DEFAULT LADDER. */
  readonly line?: StakesLine;
  /**
   * This action's impact class, CALLER-SUPPLIED. MICA does not compute it. Held
   * here only so the census can print what the run was told; the value reaches
   * the chokepoint as `Stakes` at the `guard` call, not through this file.
   */
  readonly stakesClass?: string;
  /** Durable floor-trail path. Absent -> no permit can be accounted for. */
  readonly floorTrailPath?: string;
  /**
   * Stage 1 Amendment 1: an already-constructed `FloorTrail` (or subclass) to
   * use INSTEAD of building one from `floorTrailPath`. When present,
   * `floorTrailPath` is carried in the census for information only and is
   * NEVER used to construct a second instance. `evaluateAndRecord` injects a
   * journal-backed subclass here so `guard()`'s mandatory floor reading is
   * appended as `DECISION_PREPARED` to the canonical decision journal rather
   * than to a file at `floorTrailPath` directly — the real file (same format,
   * same `FloorTrail` class) is written by the wrapper AFTER `DECISION_FINAL`.
   */
  readonly floorTrailOverride?: FloorTrail;
  /** Durable PASS-BLIND ledger path. Absent -> a PASS-BLIND fails closed. */
  readonly ledgerPath?: string;
  /** Same override discipline as `floorTrailOverride`, for the PASS-BLIND ledger. */
  readonly ledgerOverride?: ChokepointLedger;
  /** Where notices land. Absent -> NO NOTIFIER AT ALL. There is no default sink. */
  readonly noticeDir?: string;
  /** Notice batching window. A calibration detail; the notifier holds the default. */
  readonly noticeWindow?: number;
  /**
   * C8: an ALREADY-CONSTRUCTED notifier pair to use INSTEAD of building one
   * from the four fields above. Same shape as `floorTrailOverride` /
   * `ledgerOverride`: state whose lifetime is the CALLER'S, not this call's.
   *
   * WHY THIS EXISTS AT ALL. `BatchedNotifier`'s `sinceLastNotice` and `total`
   * are instance fields. A caller that calls `wire()` once per action — which
   * `evaluate-and-record.ts` does, by design — gets a counter born and buried
   * inside one evaluation: every notice reads `count=1 totalSoFar=1`, and at
   * any window above 1 no notice is ever emitted at all, because the pending
   * count dies unflushed. The notice text asks the operator to check whether
   * the count is HIGHER THAN EXPECTED. Pinned at 1, it never can be. A
   * service that hands the SAME pair to every `wire()` call gets a counter
   * whose lifetime is the service, which is the first lifetime that sentence
   * has ever been true under.
   *
   * WHAT THIS WIRING DOES NOT DO WITH IT: it does not construct it, does not
   * own it, and NEVER calls `flush()`. The tail at shutdown is the caller's to
   * emit, because only the caller knows when it is shutting down.
   *
   * REFUSED, NOT PREFERRED, when combined with any of the four construction
   * fields — see `NOTIFIER_OVERRIDE_CONFLICT` and `wire()`'s own refusal. The
   * floor-trail and ledger overrides PREFER because `evaluateAndRecord` spreads
   * them onto an options object that may legitimately still carry the CLI's
   * `--floor-trail` path; nothing injects a notifier that way, so both-present
   * here is always a caller's mistake and never a structural necessity.
   */
  readonly notifierOverride?: BuiltNotifier;
  /**
   * One line from the probe door describing the custody it verified. Set by
   * mica-guard after `admitProbeSource` passes; never derived here, and never a
   * default. Absent means no probe source was offered this run.
   */
  readonly probeProvenance?: string;
  /**
   * One line from the clerk-clock-stamps door (S109-B) describing the custody
   * it verified. Set by mica-guard after `readClockStampsFile`'s door admits;
   * never derived here, and never a default. Absent means no
   * `--clerk-clock-stamps` was offered this run.
   */
  readonly clockStampsProvenance?: string;
  /** The deployer's wire for human channels. MICA ships none. */
  readonly transport?: Transport;
  /** Supplies the floor-trail timestamp. Absent -> the chokepoint's own fallback. */
  readonly decisionClock?: () => number;
  /**
   * Where the NOTICE LOG's head is committed, and under what submitter id.
   *
   * Absent -> EXACTLY today's behaviour: no committer is injected, the notify
   * census reports `witnessHeadCommit=NOT_DECLARED` at bytes, and nothing is
   * written anywhere. Present -> each durable notice-log append is followed by a
   * drop file into `dir`, named `submitterId`, holding the four frozen
   * head-commit fields and nothing else.
   *
   * THIS IS SUBMISSION, NOT RETENTION. A drop written here proves a file was
   * renamed into a directory. It does not prove a witness was running, read it,
   * or kept it — the evidential object is the witness's own store, which
   * nothing on this side can read and this option does not attest.
   *
   * The FLOOR TRAIL's committer is deliberately NOT wired here. Its wiring point
   * and its submitter identity need their own look; smuggling it in on the back
   * of this one would decide both by accident.
   */
  readonly witnessIntake?: {
    readonly dir: string;
    readonly submitterId: string;
    /**
     * The witness-set id this book DECLARES on each committed head. Absent is
     * carried honestly as `""`, which is what the option shipped as before
     * S86 — a head declaring no set at all, arriving at a witness that knows
     * its own. The witness copies what arrived and certifies nothing about it
     * either way, so this was never a fault; it was a FALSE-ALARM SURFACE, a
     * mismatch a reader would have to investigate and always find innocent.
     * Ruled widened, S86, to kill that surface at birth.
     */
    readonly witnessSetId?: string;
    /**
     * R8's declaration, stamped onto every head the notice log commits.
     *
     * TYPE-REQUIRED, AND THAT IS THE POINT. The S86 `witnessSetId` widening
     * killed a false-alarm surface at birth; an OPTIONAL modality would build a
     * new one in the same place — a deployment that simply forgot to declare,
     * spraying UNDECLARED_MODALITY records at a witness whose operator then has
     * to investigate every one and find every one innocent. A required field
     * means the declaration cannot be SKIPPED, only MADE, and making it costs
     * one word that only the deployer knows.
     *
     * For a machine book raising machine notices that word is
     * `NOT_AN_INSTRUCTION`. Requiring it typed out rather than defaulting it is
     * deliberate: a default is a declaration nobody made.
     */
    readonly modality: Modality;
  };
}

/** Resolve a --clerk-pubkey value: a path to a key file, or the key itself. */
function resolvePubkey(
  value: string | undefined
): { key: string | null; anchor: TrustAnchor } {
  if (value === undefined) return { key: null, anchor: "NONE" };
  // Deliberately the clerk reader's own rule (src/clerk/reader.ts), not a new
  // one: a value naming an existing file is read from it, anything else IS the
  // key. Either way the anchor is OUT_OF_BAND, because the operator typed it.
  if (existsSync(value)) {
    return { key: readFileSync(value, "utf8").trim(), anchor: "OUT_OF_BAND" };
  }
  return { key: value.trim(), anchor: "OUT_OF_BAND" };
}

/**
 * Build the gap reader's verdict out of band: read the clerk's store, verify its
 * chain, read the gaps, and BRIDGE the result into the floor's grammar.
 *
 * The bridge is `gapReadToVerdict` and it already exists in
 * `src/mica/chokepoint/index.ts` — MICA declares the shape it reads
 * (`GapReadShape`) rather than importing the clerk's `GapRead`, because a
 * type-only import would be an edge out of src/mica and the closure guard fails
 * on it. THE ASSIGNMENT BELOW IS THAT BINDING, CHECKED HERE, AT THE GLUE, WHERE
 * MICA's own comment says it belongs. If the clerk's GapRead ever stops being
 * structurally assignable to GapReadShape, THIS LINE fails to compile — which is
 * the point of putting it here rather than leaving the claim in a comment.
 */
function gapVerdict(
  storeDir: string,
  pubkey: string | undefined,
  now: number
): { verdict: SensorVerdict; detail: string } {
  const store = readStore(storeDir);
  const supplied = resolvePubkey(pubkey);
  const key =
    supplied.key !== null
      ? supplied.key
      : store.kind === "STORE_READ"
        ? store.storePublicKeyB64
        : null;
  const anchor: TrustAnchor =
    supplied.key !== null ? supplied.anchor : key === null ? "NONE" : "FROM_STORE";

  const verification: ChainVerification = verifyChain(store, {
    publicKeyB64: key,
    trustAnchor: anchor,
  });
  const records: readonly ClerkRecord[] =
    store.kind === "STORE_READ" ? store.records : [];

  // THE BINDING. `GapRead` -> `GapReadShape`, structural, checked at compile
  // time in the deployment glue and nowhere inside src/mica.
  const gapRead: GapReadShape = readGaps(records, { now, verification });

  return {
    verdict: gapReadToVerdict(gapRead),
    detail:
      `store=${storeDir} (${store.kind}) chain=${verification.kind} ` +
      `trustAnchor=${anchor} records=${records.length} now=${now}`,
  };
}

// ── C8 · the notifier, built once and owned by whoever built it ─────────────
//
// The construction below is BYTE-FOR-BYTE what `wire()` did inline before C8,
// lifted out so a caller whose lifetime is longer than one action can build it
// ONCE and hand the same pair to every `wire()` call. Nothing about the
// construction changed; what changed is that it can now happen somewhere else.
//
// "NO DEFAULT SINK, EVER" is unchanged and is why `noticeDir` is REQUIRED here:
// there is no way to reach this function without naming a destination, and
// `wire()` still constructs nothing when no destination was supplied.

/** Who owns the notifier this wiring used, and therefore whose lifetime its counters have. */
export type NoticeOwnership =
  /** No destination was supplied. No notifier exists; nothing was computed or written. */
  | "NOT_WIRED"
  /** This `wire()` call built it. Its counters die with this call — see `notifierOverride`. */
  | "BUILT_BY_THIS_WIRING"
  /** The caller built it and handed it in. Its counters span every call it is given to. */
  | "CALLER_OWNED";

/** What `buildNotifier` hands back: the pair, plus what a census needs to describe it. */
export interface BuiltNotifier {
  /** The composed fan-out. Its sink is never absent — that is what composing buys. */
  readonly notifier: ComposedNotifier;
  /** The counting half. THE OBJECT WHOSE LIFETIME IS THE WHOLE POINT. */
  readonly batched: BatchedNotifier;
  /** The book this pair writes to, so a census can name it without re-deriving it. */
  readonly bookPath: string;
  /** The census line for this pair, worded exactly as `wire()` worded it before C8. */
  readonly censusLine: string;
}

/** Everything the notifier construction reads out of `WireOptions`, and nothing else. */
export interface BuildNotifierOptions {
  /** REQUIRED. There is no default destination; absent is a caller who wants no notifier. */
  readonly noticeDir: string;
  readonly noticeWindow?: number;
  readonly witnessIntake?: WireOptions["witnessIntake"];
  readonly transport?: Transport;
}

/** The four `WireOptions` fields that FEED the construction, named once. */
export const NOTIFIER_CONSTRUCTION_FIELDS = [
  "noticeDir",
  "noticeWindow",
  "witnessIntake",
  "transport",
] as const;

export const NOTIFIER_OVERRIDE_CONFLICT =
  "notifierOverride was supplied TOGETHER with notifier-construction options. " +
  "Refused rather than resolved: an override means the caller already built the " +
  "pair, so every field below would be silently ignored — a second NoticeLog on " +
  "the same file if it were honoured, and a declared destination that quietly " +
  "does nothing if it were not. Either hand in the override alone, or drop it " +
  "and let this wiring build one. The fields supplied alongside it were: ";

/** Thrown, not returned: `wire()` has no census to print when it refuses to wire. */
export class WireUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WireUsageError";
  }
}

/**
 * Build the notice book, the fan-out, and the counter, as one pair.
 *
 * Call it from `wire()` (per action, today's behaviour, unchanged) or from a
 * service's own startup (once, so the counter can rise). This function has no
 * opinion about which; the LIFETIME is the caller's decision and always was.
 */
export function buildNotifier(options: BuildNotifierOptions): BuiltNotifier {
  const bookPath = join(options.noticeDir, "notices.jsonl");
  const sinks = new NoticeSinks({
    noticeLog: new NoticeLog({
      path: bookPath,
      witnessSetId: options.witnessIntake?.witnessSetId,
      modality: options.witnessIntake?.modality,
      headCommitter:
        options.witnessIntake === undefined
          ? undefined
          : fileDropCommitter(
              options.witnessIntake.dir,
              options.witnessIntake.submitterId
            ),
    }),
    transport: options.transport,
  });
  const notifier = composeNoticeSinks(
    sinks,
    options.noticeWindow === undefined ? undefined : { window: options.noticeWindow }
  );
  const batched = new BatchedNotifier(notifier.options);

  const censusLine =
    `${bookPath}` +
    (options.transport === undefined
      ? " (no transport injected: every human-channel attempt is NOT_CONFIGURED)"
      : " (transport injected)") +
    (options.witnessIntake === undefined
      ? " — NO WITNESS HEAD COMMIT: this book's head is committed nowhere, so " +
        "nothing outside this process holds any record of what it said."
      : ` — witness head commits drop into ${options.witnessIntake.dir} as ` +
        `\`${options.witnessIntake.submitterId}\`, declaring witness set ` +
        `\`${options.witnessIntake.witnessSetId ?? ""}\`` +
        (options.witnessIntake.witnessSetId === undefined
          ? " (NONE DECLARED — the committed head names no witness set)"
          : "") +
        ` and modality \`${options.witnessIntake.modality}\`` +
        `. Submission is not retention: this says a drop was WRITTEN, ` +
        `never that any witness kept it.`);

  return { notifier, batched, bookPath, censusLine };
}

/**
 * The census prefix under an override. It answers the ONE question a reader of
 * `totalSoFar` has to be able to answer — since when? — and it says what this
 * wiring is not doing about the tail.
 */
export const CALLER_OWNED_NOTIFIER =
  "CALLER-OWNED (notifierOverride): this wiring neither built this notifier nor " +
  "owns its lifetime. Its counters — `count` and `totalSoFar` — belong to the " +
  "caller and span EVERY wire() call the same pair is handed to, so `totalSoFar` " +
  "reads `since the caller built it`, not `since this evaluation`. SERVICE-LIFETIME " +
  "where the caller is a service. Nothing here calls flush(): the tail of a " +
  "part-filled window is the caller's to emit, at a shutdown only the caller sees. " +
  "The book below is the one this pair was built with.";

// ── T27 · A READER THAT THREW: BOOKED, NAMED, HELD ────────────────────────────
//
// SCOPE, RULED (the arbiter, board 2026-10-17 15:37Z, "Throws only, as recommended"): a THROW is exactly (i) a throw a
// SEAM try catches at a reader step in wire(); (ii) a reader's OWN net (READER_OWN_NET_CODES); (iii) a log's or
// book's adapter throwing before any reading exists. Every typed NOT READABLE a reader returns through its own try
// path is NOT a throw and never enters readerThrows: it composes as it always did, PASS_BLIND below a pilot's line
// included. The widening (unreadable books under the same core route) is the arbiter's noted follow-on, NOT built here.
//
// ONE TRY PER READER AT ITS SEAM, never one round wire(), never fail-open. A thrown step composes CANNOT_ASSESS,
// class MISSING_CONFIGURATION (ruled F1), detail '<sensorId> · <CODE> (<class word>)' — the THROWN TEXT IS WITHHELD
// from everything the seam writes (it can carry the log's bytes). Each step builds its reading into locals and
// commits once, at its end, so a catch can never leave a reader pushed twice.

/**
 * The readers' OWN nets in src/mica — the closed set of condition 1 (ii). A source fence in glue.test.ts holds this
 * list equal to the `<X>_READER_THREW` literals in src/mica's non-test sources, so a reader that later gains its own
 * net cannot pass blind under a pilot unnoticed.
 */
export const READER_OWN_NET_CODES: readonly string[] = ["G1_READER_THREW", "G2_READER_THREW", "G4_READER_THREW"];

/**
 * The seam's codes, one per reader step in wire(): `<READER>_THREW` with no READER infix, so `grep READER_THREW` finds
 * only the codes a reader writes about itself and `grep _THREW` finds all (v3 cond. 5).
 */
export const SEAM_THREW_CODES: Readonly<Record<string, string>> = {
  [ENG_READER]: "ENG_THREW",
  [SIG_READER]: "SIG_THREW",
  [NARROW_K_READER]: "NARROW_K_THREW",
  [NARROW_W_READER]: "NARROW_W_THREW",
  [NARROW_R_READER]: "NARROW_R_THREW",
  [NARROW_T_READER]: "NARROW_T_THREW",
  [OP1_READER]: "OP1_THREW",
  [OP3_READER]: "OP3_THREW",
  [GATE4_READER]: "GATE4_THREW",
};

export const SEAM_THREW_TEXT_WITHHELD = "The thrown text is withheld (it can carry the log's bytes).";

/** census.log, and the log part of every row, when the subject log's ADAPTER threw while loading (case (c)). */
export function logAdapterThrewText(errorClass: string): string {
  return (
    `WIRED AND BLIND — the log's ADAPTER THREW while loading (${errorClass}): a log path WAS supplied, and no reader ` +
    `could stand on it. ${SEAM_THREW_TEXT_WITHHELD}`
  );
}

/** census.log, and the log part of every row, when the adapter loaded but could not DESCRIBE itself. */
export function logDescribeThrewText(errorClass: string): string {
  return (
    `the log's adapter threw while describing itself (${errorClass}); no description is printed. ` +
    `Each reader on it read, or threw, at its own step. ${SEAM_THREW_TEXT_WITHHELD}`
  );
}

/**
 * ONE helper builds the seam's blind verdict AND its readerThrows entry, so neither can be written without the other
 * (F6 rests on the entry). Throw-free: it reads no caller-supplied value but the class word from the fixed set.
 */
export function seamThrew(
  reader: string,
  error: unknown,
  cause: "STEP" | "LOG_ADAPTER",
  logDescription: string
): { readonly verdict: SensorVerdict; readonly entry: ReaderThrow; readonly source: string } {
  const code = SEAM_THREW_CODES[reader] ?? "READER_STEP_THREW";
  const errorClass = gate1ErrorClass(error);
  const what =
    cause === "STEP"
      ? "the wire seam caught a throw at this reader's step"
      : "the log's adapter threw before any reader ran";
  const detail =
    `${reader} · ${code} (${errorClass}) — ${what}; the reader produced NO reading. This is the seam's statement, ` +
    `never a reading of the reader's. ${SEAM_THREW_TEXT_WITHHELD}`;
  return {
    verdict: cannotAssess(reader, [{ class: "MISSING_CONFIGURATION", detail }]),
    entry: { reader, code, errorClass },
    source: `WIRED AND BLIND — ${code} (${errorClass}): ${what}. ${SEAM_THREW_TEXT_WITHHELD} || ${logDescription}`,
  };
}

/**
 * Wire the readers and construct the chokepoint. Returns the chokepoint, the
 * verdicts the WIRED readers returned, and the census that says which was which.
 */
export function wire(options: WireOptions): GuardWiring {
  if (options.gate2Harm !== undefined && options.gate2 !== undefined) {
    throw new WireUsageError(GATE2_HARM_AND_BASKET_REFUSED);
  }
  const readers: ReaderCensusEntry[] = [];
  const sensorVerdicts: SensorVerdict[] = [];
  const readerMargins: ReaderMarginReading[] = [];
  const states = options.readableLoadStates;

  // ── Eng and Sig: wired by the presence of a log, blind by the absence of
  //    configuration. Two different things, kept two different things.
  let logFile: MicaLogFile | WitnessStoreLog | SubjectChainLog | null = null;
  // Gate 1's own adapter (placement D): null until Gate 1 actually reads.
  let gate1Log: SubjectChainLog | null = null;
  let gate2Log: SubjectChainLog | null = null;
  let gate2ReadsBook = false;
  // ACT B. Null until Sig is actually wired and actually read: a reading nobody
  // took must not be reported as a leg that was not configured.
  let sigF3: SigF3Reading | null = null;
  // T27 · every throw this wiring catches, in the ruled closed set (GuardWiring.readerThrows).
  const readerThrows: ReaderThrow[] = [];
  // T27 · the subject log's description: read ONCE, in its own try, right after the adapter is built, and carried
  // into census.log and every row (v3 cond. 3). describe() calls verify(), so nine calls were nine chances to throw
  // outside any try; each adapter assigns its state only while constructing, so one call returns what nine did.
  let logDescription: string | null = null;
  // T27 · case (c): the subject log's ADAPTER threw while loading. Null when it did not, or no path was supplied.
  let logAdapterThrow: { readonly error: unknown } | null = null;
  // T27 · the seam's catch: the blind verdict, its row, its margin (Eng and Sig carry one) and its readerThrows entry,
  // pushed together, once.
  const seamCatch = (reader: string, error: unknown, cause: "STEP" | "LOG_ADAPTER", withMargin: boolean): void => {
    const t = seamThrew(reader, error, cause, logDescription ?? "");
    sensorVerdicts.push(t.verdict);
    if (withMargin) {
      // Quoted from the seam's own blind verdict, as ReadingMargin's contract requires — never the summary, and for
      // Sig never SIG_TOOK_NO_MEASUREMENT, which asserts a cause the seam did not observe.
      readerMargins.push({ reader, kind: t.verdict.kind, margin: { kind: "NOT_MEASURED", reason: readerOwnReason(t.verdict) } });
    }
    readers.push({ reader, wired: true, source: t.source, verdictKind: t.verdict.kind });
    readerThrows.push(t.entry);
  };
  if (options.logPath === undefined) {
    const source = "NOT WIRED — no log path was supplied (--log)";
    readers.push({ reader: ENG_READER, wired: false, source, verdictKind: null });
    readers.push({ reader: SIG_READER, wired: false, source, verdictKind: null });
    // ITEM 4: narrow-K reads the same log. No log, no reading — and the reason
    // printed is the LOG's absence, not the profile's, because that is the one
    // that actually stopped it.
    readers.push({ reader: NARROW_K_READER, wired: false, source, verdictKind: null });
    // THE BUNDLE + H12: the same four times over, for the same reason. The
    // log's absence is what stopped them, so the log's absence is what is
    // printed — not the profile's, which would name the second obstacle as if
    // it were the first.
    readers.push({ reader: NARROW_W_READER, wired: false, source, verdictKind: null });
    readers.push({ reader: NARROW_R_READER, wired: false, source, verdictKind: null });
    readers.push({ reader: OP1_READER, wired: false, source, verdictKind: null });
    readers.push({ reader: OP3_READER, wired: false, source, verdictKind: null });
    // Gate 4 joins that list for the same reason: the log's absence is the
    // obstacle that actually stopped it, so the log's absence is what prints.
    readers.push({ reader: GATE4_READER, wired: false, source, verdictKind: null });
    // ⛔ NOT Gate 1 (round 3, K1R1-N1): it never reads this log, so the log's
    //    absence is not what stops it. Its row is written after this branch,
    //    from its own declaration and its own book, whichever way this goes.
  } else {
    // The reader is SELECTED, not sniffed. See WireOptions.logKind.
    //
    // T27 · CASE (c): the adapter is built inside its own try. Its loader can throw on bytes it cannot hash (a deeply
    // nested record overflows the stack), and that throw used to leave wire() as an unbooked 500. Now every reader
    // that stands on this log UNDER THIS DECLARATION reads WIRED AND BLIND with its own seam code, and an undeclared
    // one keeps its NOT_DECLARED vacancy (the declaration wires it, not the log).
    const logPath = options.logPath;
    try {
      logFile =
        options.logKind === "witness"
          ? new WitnessStoreLog({ path: logPath })
          : options.logKind === "subject-chain"
            ? new SubjectChainLog({ path: logPath })
            : new MicaLogFile({ path: logPath });
    } catch (error) {
      logFile = null;
      logAdapterThrow = { error };
    }
    const adapter = logFile;
    if (adapter === null) {
      logDescription = logAdapterThrewText(gate1ErrorClass(logAdapterThrow === null ? undefined : logAdapterThrow.error));
    } else {
      try {
        logDescription = adapter.describe();
      } catch (error) {
        logDescription = logDescribeThrewText(gate1ErrorClass(error));
      }
    }
    const desc: string = logDescription;
    const adapterError: unknown = logAdapterThrow === null ? undefined : logAdapterThrow.error;
    // ONE TRY PER READER AT ITS SEAM. `read` builds the reading into locals and commits at its end.
    const step = (
      reader: string,
      withMargin: boolean,
      read: (log: MicaLogFile | WitnessStoreLog | SubjectChainLog) => void
    ): void => {
      if (adapter === null) {
        seamCatch(reader, adapterError, "LOG_ADAPTER", withMargin);
        return;
      }
      try {
        read(adapter);
      } catch (error) {
        seamCatch(reader, error, "STEP", withMargin);
      }
    };

    // R1. THE WRAPPER IS KEPT, not destructured away at the call. The line
    // that stood here was `assessEng(logFile, engConfig).verdict` — the
    // `EngResult` around it (its `structure`, and so the only number Eng ever
    // measures against a threshold) was an unreferenced expression result and
    // was collected. Keeping the binding is the entire cost of carrying a
    // margin; nothing about the verdict itself changes, and `sensorVerdicts`
    // receives exactly the value it received before.
    step(ENG_READER, true, (log) => {
      // The config spread is inside the step: a declared section whose property throws is this reader's throw.
      const engConfig: EngConfig = { ...(options.eng ?? {}), readableLoadStates: states };
      const engResult: EngResult = assessEng(log, engConfig);
      const eng = engResult.verdict;
      const margin = engMarginOf(engResult, engConfig.structureThreshold);
      sensorVerdicts.push(eng);
      readerMargins.push({ reader: ENG_READER, kind: eng.kind, margin });
      readers.push({ reader: ENG_READER, wired: true, source: desc, verdictKind: eng.kind });
    });

    // Verified at source 2026-08-24: `assessSig` returns a SigResult whose
    // `.verdict` is a SensorVerdict (src/mica/sig/index.ts l.186–187). The brief
    // marked this as needing confirmation; it is confirmed.
    step(SIG_READER, true, (log) => {
      const sigConfig: SigConfig = { ...(options.sig ?? {}), readableLoadStates: states };
      const sigResult: SigResult = assessSig(log, sigConfig);
      // ACT B: taken from THIS reading, beside the verdict it came from, never
      // re-derived later from a config this layer would have to re-read.
      const f3 = sigF3Of(sigResult, sigConfig);
      const sig = sigResult.verdict;
      const margin = sigMarginOf(sigResult);
      // ⚠ NOT BUILT (v3 cond. 12): a Sig whose step threw leaves sigF3 null, which the decision's contract reads as
      // "Sig not wired". Named in the T27 receipt; the NOT-READ arm is owed.
      sigF3 = f3;
      sensorVerdicts.push(sig);
      readerMargins.push({ reader: SIG_READER, kind: sig.kind, margin });
      readers.push({ reader: SIG_READER, wired: true, source: desc, verdictKind: sig.kind });
    });

    // ── ITEM 4 · narrow-K ────────────────────────────────────────────────
    //
    // Wired only when a profile was declared (NARROW_K_NOT_DECLARED states
    // why). When it IS declared, it is an ordinary composing reader: its
    // verdict joins `sensorVerdicts` and lowers the bound like any other.
    //
    // THE ORDERING HAZARD, PRINTED WHERE THE WIRING HAPPENS BECAUSE THIS IS
    // WHERE IT BITES. narrow-K's leg 1 ALARMS on a declared class that is
    // ABSENT from the record (`narrow-k/index.ts` assessBookShape,
    // K_CONSTRAINT_CLASS_ABSENT) and there is NO minimum-sample grace on that
    // leg — leg 2's `correlationMinimumConstraintEvents` guards leg 2 only.
    // The composed verdict is worst-of, and `mapFloorToDisposition` holds on
    // ALARM whatever the stakes are: "there is no stakes value that releases
    // an alarm" (chokepoint/types.ts:239-241). So DECLARING A PROFILE WHOSE
    // CLASSES NO CALLER YET EMITS HOLDS EVERY ACT, and the pilot's pass-blind
    // override cannot rescue it because that override lives in the
    // CANNOT_ASSESS branch alone.
    //
    // The declaration must therefore follow the caller that writes the
    // classes, never precede it. That is the same deployment-order rule the
    // bridge-before-caller brick enforces, pointed the other way, and the
    // bridge's declaration test is where it is pinned.
    if (options.narrowK === undefined) {
      readers.push({
        reader: NARROW_K_READER,
        wired: false,
        source: NARROW_K_NOT_DECLARED,
        verdictKind: null,
      });
    } else {
      const declared = options.narrowK;
      step(NARROW_K_READER, false, (log) => {
        const narrowKConfig: NarrowKConfig = { ...declared, readableLoadStates: states };
        const narrowK = assessNarrowK(log, narrowKConfig).verdict;
        sensorVerdicts.push(narrowK);
        readers.push({ reader: NARROW_K_READER, wired: true, source: desc, verdictKind: narrowK.kind });
      });
    }

    // ── THE BUNDLE · narrow-W ─────────────────────────────────────────────
    //
    // The item-4 pattern VERBATIM. The ordering hazard printed above narrow-K
    // applies here unchanged and is WORSE here, because narrow-K's candidate
    // class (HELD_THEN_DIVERGED) is one the caller actually writes and narrow-W's
    // is not. See NARROW_W_NOT_DECLARED.
    if (options.narrowW === undefined) {
      readers.push({
        reader: NARROW_W_READER,
        wired: false,
        source: NARROW_W_NOT_DECLARED,
        verdictKind: null,
      });
    } else {
      const declared = options.narrowW;
      step(NARROW_W_READER, false, (log) => {
        const narrowWConfig: NarrowWConfig = { ...declared, readableLoadStates: states };
        const narrowW = assessNarrowW(log, narrowWConfig).verdict;
        sensorVerdicts.push(narrowW);
        readers.push({ reader: NARROW_W_READER, wired: true, source: desc, verdictKind: narrowW.kind });
      });
    }

    // ── THE BUNDLE · narrow-R ─────────────────────────────────────────────
    if (options.narrowR === undefined) {
      readers.push({
        reader: NARROW_R_READER,
        wired: false,
        source: NARROW_R_NOT_DECLARED,
        verdictKind: null,
      });
    } else {
      const declared = options.narrowR;
      step(NARROW_R_READER, false, (log) => {
        const narrowRConfig: NarrowRConfig = { ...declared, readableLoadStates: states };
        const narrowR = assessNarrowR(log, narrowRConfig).verdict;
        sensorVerdicts.push(narrowR);
        readers.push({ reader: NARROW_R_READER, wired: true, source: desc, verdictKind: narrowR.kind });
      });
    }

    // ── narrow-T · THE ITEM-4 GATE, AND THE INVERTED POLARITY ─────────────
    //
    // Built 2026-09-22, declarable at the front door since 5d49083, and until
    // this commit NEVER CALLED FROM THE PRODUCTION LINE: `grep -c narrowT` on
    // the relayed `wire.ts` returned 0 on 2026-09-26, while
    // `src/mica/narrow-t/index.ts` was 41203 bytes of working reader. A reader
    // that is built, declarable and uncalled is the worst of the three states,
    // because the declaration makes it LOOK live in every document that reads
    // the config instead of the glue.
    //
    // The ceiling echoed into `source` is the instrument's own polarity note,
    // not a sentence invented here: structure is the finding, flatness is the
    // healthy read, and that is the reverse of K/W/R.
    if (options.narrowT === undefined) {
      readers.push({
        reader: NARROW_T_READER,
        wired: false,
        source: NARROW_T_NOT_DECLARED,
        verdictKind: null,
      });
    } else {
      const declared = options.narrowT;
      step(NARROW_T_READER, false, (log) => {
        const narrowTConfig: NarrowTConfig = { ...declared, readableLoadStates: states };
        const narrowT = assessNarrowT(log, narrowTConfig).verdict;
        sensorVerdicts.push(narrowT);
        readers.push({ reader: NARROW_T_READER, wired: true, source: `${desc} || ${T_POLARITY_NOTE}`, verdictKind: narrowT.kind });
      });
    }

    // ── THE BUNDLE · op1 doctor cadence ───────────────────────────────────
    //
    // The section is wrapped into a profile HERE — see `WireOptions.op1` for
    // why the option is the section and not the profile. `readableLoadStates`
    // is passed as the instrument's third argument rather than folded into the
    // profile, because that is the signature it has; the run's list still comes
    // from ONE place, `options.readableLoadStates`, exactly as for every other
    // reader in this branch.
    if (options.op1 === undefined) {
      readers.push({
        reader: OP1_READER,
        wired: false,
        source: OP1_NOT_DECLARED,
        verdictKind: null,
      });
    } else {
      const declared = options.op1;
      step(OP1_READER, false, (log) => {
        const op1Profile: OperatorLayerProfile = { doctorCadence: declared };
        const op1 = assessOp1DoctorCadence(log, op1Profile, states).verdict;
        sensorVerdicts.push(op1);
        readers.push({ reader: OP1_READER, wired: true, source: desc, verdictKind: op1.kind });
      });
    }

    // ── H12 · OP-3 node response ─────────────────────────────────────────
    //
    // Item 4's shape, line for line: wired only when a profile was declared,
    // an ordinary composing reader when it is, a stated vacancy when it is
    // not. What differs is the hazard the vacancy is protecting against, and
    // it is worth naming here rather than only in `OP3_NOT_DECLARED`:
    //
    // THE HELD-ACT TRIPWIRE. `responseClass` is ONE class, not a list — the
    // instrument's profile has no room for two. This deployment's caller
    // writes TOOL_ATTEMPTED -> TOOL_EXECUTED -> TOOL_RESULT for an act that
    // RAN, and TOOL_ATTEMPTED -> TOOL_HELD_NOT_EXECUTED for an act that was
    // HELD — no TOOL_RESULT on that second path, ever. So with
    // `responseClass = TOOL_RESULT` every held act is an expectation with no
    // qualifying response, leg A ALARMS, the alarm is recomputed over the
    // whole file forever after, and no stakes line releases it. A declaration
    // made while the pilot is passing everything blind would arm a latch that
    // springs on the first act the pilot stops rescuing.
    //
    // That is not a defect in this wiring and it is not a reason to widen the
    // bound — widening it pairs an attempt to ANOTHER act's result, which is
    // the mispairing `OP3_HARNESS_PAIRING_CEILING` exists to name. It is a
    // deployment decision, it belongs to the arbiter, and until it is made
    // the honest state of this reader is the vacancy below.
    if (options.op3 === undefined) {
      readers.push({
        reader: OP3_READER,
        wired: false,
        source: `${OP3_NOT_DECLARED} || ${OP3_HARNESS_PAIRING_CEILING}`,
        verdictKind: null,
      });
    } else {
      // THE WINDOW. `since` narrows what op3 PAIRS OVER and nothing else:
      // `verify()` and `getLoadState()` are delegated to the FULL log, so the
      // chain's tamper-evidence and its load state are exactly what they were.
      // Built inline rather than as a shared helper because op3 is the only
      // reader that gets a window, and a shared one would invite a second.
      // `whole` is bound BEFORE the closures because the arrow bodies below are
      // evaluated later, where TypeScript's narrowing of `logFile` no longer
      // holds. Binding it here keeps the non-null narrowing this branch already
      // established, instead of asserting it away with a `!`.
      const declared = options.op3;
      step(OP3_READER, false, (log) => {
      const whole: MicaReadableLog = log;
      const since = options.op3Since;
      const op3Log: MicaReadableLog =
        since === undefined
          ? whole
          : {
              verify: () => whole.verify(),
              getLoadState: () => whole.getLoadState(),
              getAll: () => whole.getAll().filter((r) => r.sequenceNumber >= since),
            };
      // T27 · the window and its note are built from whole.getAll() BEFORE the reader, so they sit inside the step.
      const windowNote =
        since === undefined
          ? OP3_WINDOW_ABSENT
          : op3WindowNote(since, whole.getAll().length, op3Log.getAll().length);
      const op3 = assessOp3NodeResponse(op3Log, { nodeResponse: declared }, states).verdict;
      // THE CEILING ON THE VERDICT'S OWN FACE. The instrument appends its own
      // `|| CEILINGS: ...` (`withCeilings`); this appends the one limit the
      // instrument cannot know, because it is a fact about this deployment's
      // record and not about OP-3. Only the summary is touched: `kind`,
      // `findings` and `blindPaths` are the reader's and are passed through
      // untouched, so nothing here can change what the floor composes.
      const spoken: SensorVerdict = {
        ...op3,
        summary: `${op3.summary} || ${OP3_HARNESS_PAIRING_CEILING} || ${windowNote}`,
      };
      sensorVerdicts.push(spoken);
      readers.push({
        reader: OP3_READER,
        wired: true,
        source: `${desc} || ${OP3_HARNESS_PAIRING_CEILING} || ${windowNote}`,
        verdictKind: op3.kind,
      });
      });
    }

    // ── GATE 4 SUNSET · leg A ─────────────────────────────────────────────
    //
    // Item 4's shape once more. What is different, and what the census row
    // below is built to carry: this reader's TWO legs share ONE sensorId and
    // compose worst-of, so the row's `verdictKind` is the COMPOSED kind and not
    // leg A's. With leg B vacuous the composed kind is CANNOT_ASSESS whatever
    // leg A read, which would make a SILENT leg A indistinguishable from an
    // undeclared one in the census — so leg A's own kind and its blind codes
    // are printed into `source`, where the reading cannot be lost.
    if (options.gate4 === undefined) {
      readers.push({
        reader: GATE4_READER,
        wired: false,
        source: `${GATE4_NOT_DECLARED} || ${GATE4_SINGLE_WINDOW_CEILING}`,
        verdictKind: null,
      });
    } else {
      const declared = options.gate4;
      // T27 · THE SEAM'S TRY COVERS THE CALL ITSELF, not only the glue's post-processing: Gate 4's own catch is not
      // throw-free (it renders the thrown value with no inner try), so a hostile value can escape it. RULED (F4): the
      // seam is the net now; Gate 4's own catch is a later core ticket. GATE4_THREW means Gate 4's net did not hold;
      // G4_READER_THREW (its own, read from its structured codes) means it did. One decision never carries both.
      step(GATE4_READER, false, (log) => {
      const gate4Config: Gate4SunsetConfig = {
        readableLoadStates: states,
        profile: declared,
        paperFreshnessBound: options.gate4PaperFreshnessBound,
      };
      const gate4 = assessGate4Sunset(log, gate4Config);
      // THE CEILING ON THE VERDICT'S OWN FACE, as for op3, and for the same
      // reason: the single-window mismatch is a fact about this record that the
      // instrument cannot know. Only `summary` is touched — `kind`, `findings`
      // and `blindPaths` are the reader's and pass through untouched, so
      // nothing here can change what the floor composes.
      const legA =
        `LEG A: ${gate4.hold.verdict.kind}, ${gate4.hold.recordsExamined} record(s) examined` +
        `${gate4.hold.blindReasonCodes.length > 0 ? `, blind codes=${gate4.hold.blindReasonCodes.join(", ")}` : ""}`;
      const spoken: SensorVerdict = {
        ...gate4.verdict,
        summary: `${gate4.verdict.summary} || ${GATE4_SINGLE_WINDOW_CEILING}`,
      };
      const ownNet = gate4.blindReasonCodes.includes("G4_READER_THREW");
      sensorVerdicts.push(spoken);
      readers.push({
        reader: GATE4_READER,
        wired: true,
        source: `${desc} || ${legA} || ${GATE4_SINGLE_WINDOW_CEILING}`,
        verdictKind: gate4.verdict.kind,
      });
      if (ownNet) readerThrows.push({ reader: GATE4_READER, code: "G4_READER_THREW", errorClass: null });
      });
    }

  }

  // ── GATE 1 SCOPE · the envelope recorder ────────────────────────────────
  //
  // Item 4's shape. When declared it is an ORDINARY COMPOSING READER: its
  // verdict joins `sensorVerdicts` unchanged — kind, findings, blindPaths and
  // summary are the reader's, and the summary already carries every ceiling
  // and "given the declared M-frame", so nothing is appended here.
  //
  // ⛔ ITS PERMANENT CANNOT_ASSESS IS THE TRUTH THAT GATE 1'S PROPERTY IS
  //    UNREAD, and it composes as exactly that. It must never be filtered out
  //    of the floor for "never changing", and it must never be counted among
  //    readers that could read clean: it cannot. See GATE1_READER.
  //
  // PLACEMENT D: it reads the INTEREST BOOK, never `logFile`. The subject log
  // carries no label (the act's own record is byte-identical with or without a
  // frame), so the book is built here from its own path, and its load state —
  // not the subject log's — is Gate 1's footing (`gate1Log`). The same `states`
  // gate it, because the bridge writes the book in the same chained format as
  // the subject log; a run that trusts only another format reads Gate 1 as
  // G1_READABILITY_GATE, which is the true reading.
  //
  // ROUND 3, OUTSIDE THE LOG BRANCH (K1R1-N1): Gate 1 reads only the book, so
  // whether it is wired depends on its frame and its book and on nothing about
  // `--log`. Placed after that branch — in BOTH of its arms the Gate 1 row was
  // the last one written there — so the census order and the verdict order
  // are what they were.
  //
  // The census `source` carries the envelope line from THIS result, so the
  // envelope the recorder printed is readable in the census without re-reading
  // the verdict — and GATE1_PERMANENTLY_UNREAD beside it, so the row's kind is
  // read as what it means.
  const gate1BookPath = options.gate1BookPath;
  if (options.gate1 === undefined) {
    readers.push({
      reader: GATE1_READER,
      wired: false,
      source: GATE1_NOT_DECLARED,
      verdictKind: null,
    });
  } else if (gate1BookPath === undefined) {
    readers.push({
      reader: GATE1_READER,
      wired: false,
      source: GATE1_BOOK_NOT_DECLARED,
      verdictKind: null,
    });
  } else if (options.logPath !== undefined && resolvePath(gate1BookPath) === resolvePath(options.logPath)) {
    // K1R2-4: the book IS the subject log. Read, it would hand Gate 1 a log
    // with no label class (an envelope of nothing, printed as a reading) —
    // or, the other way round, hand every sibling the book's labels. Neither
    // file is read AS THE BOOK, and the row says which declaration collided.
    readers.push({
      reader: GATE1_READER,
      wired: false,
      source: GATE1_BOOK_IS_THE_LOG,
      verdictKind: null,
    });
  } else {
    // ⛔ K1R2-5: NOTHING FROM THE BOOK'S BYTES THROWS OUT OF wire(). The
    //    adapter is built from a file the bridge writes and anyone with the
    //    state dir's rights can damage; its loader can throw on a record it
    //    cannot hash (a deeply nested extra field overflows the stack). Inside
    //    this try, a throw costs Gate 1 its reading and nothing else: the row
    //    names the error CLASS only (a fixed word — the thrown text can carry
    //    the book's bytes), and the floor receives the reader's own
    //    G1_READER_THREW blindness, never a lookalike.
    //
    // ⚠ WIRED AND BLIND, not NOT WIRED, on a throw: Gate 1 WAS declared with
    //    a book and the book could not be read — the census's own rule
    //    (UNWIRED_IS_NOT_BLIND) is that such a reader is CANNOT_ASSESS, that it
    //    composes, and that an UNWIRED row composes nothing. No adapter was
    //    built, so `gate1Log` stays null and the row reports no footing: there
    //    is no load state to report, and none is borrowed.
    try {
      const book = new SubjectChainLog({ path: gate1BookPath });
      const gate1 = assessGate1Scope(book, {
        readableLoadStates: states,
        frame: options.gate1,
      });
      const source = `${gate1BookSource(book)} || ${gate1EnvelopeLine(gate1)} || ${GATE1_PERMANENTLY_UNREAD}`;
      // T27 · Gate 1's OWN net (G1_READER_THREW from its structured codes, never its text) is a throw.
      const ownNet = gate1.blindReasonCodes.includes("G1_READER_THREW");
      gate1Log = book;
      sensorVerdicts.push(gate1.verdict);
      readers.push({
        reader: GATE1_READER,
        wired: true,
        source,
        verdictKind: gate1.verdict.kind,
      });
      if (ownNet) readerThrows.push({ reader: GATE1_READER, code: "G1_READER_THREW", errorClass: null });
    } catch (error) {
      const errorClass = gate1ErrorClass(error);
      const blind = gate1ScopeThrew(gate1AdapterError(errorClass));
      gate1Log = null;
      sensorVerdicts.push(blind.verdict);
      readers.push({
        reader: GATE1_READER,
        wired: true,
        source: `${gate1BookThrew(errorClass)} || ${gate1EnvelopeLine(blind)} || ${GATE1_PERMANENTLY_UNREAD}`,
        verdictKind: blind.verdict.kind,
      });
      readerThrows.push({ reader: GATE1_READER, code: "G1_READER_THREW", errorClass });
    }
  }

  // ── GATE 2 DIRECTION · a declared basket read as a bound at grade ────────
  //
  // Item 4's shape (contract §5). Written AFTER Gate 1's row, so with Gate 2
  // undeclared the census and the verdict order of every other reader are
  // exactly what they were, and with it declared they are what they were with
  // one row added. It reads `logFile` — the SAME adapter instance Eng, Sig,
  // narrow-K/W/R/T, op1, op3 and Gate 4 were handed above — with the same
  // `states`. It opens no file of its own: the basket arrives whole.
  //
  // The reader is throw-free (one try round the whole reader, T26's R2): a
  // throw is its own G2_READER_THREW blindness, WIRED AND BLIND, composed.
  // Its verdict joins `sensorVerdicts` unchanged; no readerMargins entry is
  // pushed, because a SILENT is binary and a margin row would print one.
  if (options.gate2Harm !== undefined) {
    // T33 · THE HARM BRANCH: the witness's book only, never the chain. GATE2_BOOK_CEILING is NOT appended: the
    // reader's own harm ceilings (T32) supersede it.
    const harm = options.gate2Harm;
    const gate2BookPath = options.gate2BookPath;
    if (gate2BookPath === undefined) {
      readers.push({ reader: GATE2_READER, wired: false, source: GATE2_HARM_WITHOUT_BOOK, verdictKind: null });
    } else if (options.logPath !== undefined && resolvePath(gate2BookPath) === resolvePath(options.logPath)) {
      gate2ReadsBook = true;
      readers.push({ reader: GATE2_READER, wired: false, source: GATE2_BOOK_IS_THE_LOG, verdictKind: null });
    } else if (options.gate1BookPath !== undefined && resolvePath(gate2BookPath) === resolvePath(options.gate1BookPath)) {
      gate2ReadsBook = true;
      readers.push({ reader: GATE2_READER, wired: false, source: GATE2_BOOK_IS_GATE1_BOOK, verdictKind: null });
    } else if (options.gate2RosterPath !== undefined && resolvePath(gate2BookPath) === resolvePath(options.gate2RosterPath)) {
      gate2ReadsBook = true;
      readers.push({ reader: GATE2_READER, wired: false, source: GATE2_BOOK_IS_ROSTER, verdictKind: null });
    } else {
      gate2ReadsBook = true;
      const subjects = [...new Set(harm.origins.map((o) => o.subject))];
      try {
        const book = new SubjectChainLog({ path: gate2BookPath });
        const boundary = book.getBoundary();
        const chain = gate2PredecessorChain(book);
        const roster = gate2RosterOf(options.gate2RosterPath, subjects);
        const gate2 = readGate2Direction(gate2FullRecordLog(book), {
          readableLoadStates: states,
          harm,
          roster: roster.roster,
          decidingActionId: options.gate2DecidingActionId ?? null,
          predecessors: chain.logs,
          bookBoundaryAt: boundary === null ? null : boundary.timestamp,
          underivedWord: options.gate2UnderivedWord ?? null,
        });
        const eventTypes = [
          ...new Set(
            book
              .getChain()
              .filter((r) => r.recordType === "SUBJECT_EVENT" && subjects.includes(r.moduleId) && r.eventType.startsWith("CONSEQUENCE@"))
              .map((r) => r.eventType)
          ),
        ];
        const source =
          `${gate2BookSource(book)} || ${chain.line} || ${roster.line} || ` +
          `${gate2BookCoverageLine(book, logFile, subjects, eventTypes, roster.log ?? gate1Log)} || ` +
          `${gate2HarmCensusLine(gate2, harm.harmClass, (harm as { grantMemory?: { tag?: unknown } }).grantMemory?.tag)}`;
        const reason = gate2HarmReadingReason(gate2);
        gate2Log = book;
        sensorVerdicts.push(gate2.verdict);
        readerMargins.push({ reader: GATE2_READER, kind: gate2.verdict.kind, margin: { kind: "NO_THRESHOLD", reason } });
        readers.push({ reader: GATE2_READER, wired: true, source, verdictKind: gate2.verdict.kind });
        if (gate2.code === "G2_READER_THREW") readerThrows.push({ reader: GATE2_READER, code: "G2_READER_THREW", errorClass: null });
      } catch (error) {
        // T27 (h) · A CATCH NEVER CALLS THE READER AGAIN. The reader's own exported harm net, handed a fixed
        // class-only error: the same kind, code and detail the retired re-call produced, with no reader in the catch.
        const errorClass = gate1ErrorClass(error);
        const gate2 = gate2HarmThrew(gate2AdapterError(errorClass));
        gate2Log = null;
        sensorVerdicts.push(gate2.verdict);
        readerMargins.push({ reader: GATE2_READER, kind: gate2.verdict.kind, margin: { kind: "NO_THRESHOLD", reason: gate2HarmReadingReason(gate2) } });
        readers.push({
          reader: GATE2_READER,
          wired: true,
          source: `${gate2BookThrew(errorClass)} || ${gate2HarmCensusLine(gate2, harm.harmClass, (harm as { grantMemory?: { tag?: unknown } }).grantMemory?.tag)}`,
          verdictKind: gate2.verdict.kind,
        });
        readerThrows.push({ reader: GATE2_READER, code: "G2_READER_THREW", errorClass });
      }
    }
  } else if (options.gate2 === undefined) {
    readers.push({
      reader: GATE2_READER,
      wired: false,
      source: GATE2_NOT_DECLARED,
      verdictKind: null,
    });
  } else if (options.gate2BookPath !== undefined) {
    // TIER 1 · THE WITNESS'S BOOK. Gate 2 reads only the book, so — Gate 1's
    // round-3 rule — whether it is wired depends on the basket and the book and
    // on nothing about `--log`; the log is used for the coverage denominator only.
    const gate2BookPath = options.gate2BookPath;
    gate2ReadsBook = true;
    if (options.logPath !== undefined && resolvePath(gate2BookPath) === resolvePath(options.logPath)) {
      readers.push({ reader: GATE2_READER, wired: false, source: GATE2_BOOK_IS_THE_LOG, verdictKind: null });
    } else if (options.gate1BookPath !== undefined && resolvePath(gate2BookPath) === resolvePath(options.gate1BookPath)) {
      readers.push({ reader: GATE2_READER, wired: false, source: GATE2_BOOK_IS_GATE1_BOOK, verdictKind: null });
    } else {
      const classes = [...options.gate2.value, ...options.gate2.damage, ...options.gate2.unknown];
      const subjects = [...new Set(classes.map((c) => c.moduleId))];
      const eventTypes = [...new Set(classes.map((c) => c.eventType))];
      try {
        const book = new SubjectChainLog({ path: gate2BookPath });
        const gate2 = readGate2Direction(book, { readableLoadStates: states, basket: options.gate2 });
        // The source is built BEFORE the verdict is pushed (R2-bytes N5): a throw while building it can never
        // leave a second Gate 2 verdict behind from the catch arm below.
        const source =
          `${gate2BookSource(book)} || ${gate2BookCoverageLine(book, logFile, subjects, eventTypes, gate1Log)} || ` +
          `${gate2CensusLine(gate2)} || ${GATE2_BOOK_CEILING}`;
        gate2Log = book;
        // THE CEILING ON THE VERDICT'S OWN FACE (refuter R2-canon F1; OP3_HARNESS_PAIRING_CEILING's pattern): the
        // frozen lines travel inside the reader's summary, so the correction travels beside them. Only the summary
        // is touched; kind, findings and blind paths are the reader's.
        sensorVerdicts.push({ ...gate2.verdict, summary: `${gate2.verdict.summary} || ${GATE2_BOOK_CEILING}` });
        readers.push({ reader: GATE2_READER, wired: true, source, verdictKind: gate2.verdict.kind });
        if (gate2.code === "G2_READER_THREW") readerThrows.push({ reader: GATE2_READER, code: "G2_READER_THREW", errorClass: null });
      } catch (error) {
        // WIRED AND BLIND, never NOT WIRED (UNWIRED_IS_NOT_BLIND): Gate 2 was
        // declared on a book and the book could not be loaded.
        // T27 (k) · A CATCH NEVER CALLS THE READER AGAIN: the reader's own exported net, a fixed class-only error.
        const errorClass = gate1ErrorClass(error);
        const gate2 = gate2DirectionThrew(gate2AdapterError(errorClass));
        gate2Log = null;
        sensorVerdicts.push({ ...gate2.verdict, summary: `${gate2.verdict.summary} || ${GATE2_BOOK_CEILING}` });
        readers.push({
          reader: GATE2_READER,
          wired: true,
          source: `${gate2BookThrew(errorClass)} || ${gate2CensusLine(gate2)} || ${GATE2_BOOK_CEILING}`,
          verdictKind: gate2.verdict.kind,
        });
        readerThrows.push({ reader: GATE2_READER, code: "G2_READER_THREW", errorClass });
      }
    }
  } else if (logFile === null && logAdapterThrow === null) {
    readers.push({
      reader: GATE2_READER,
      wired: false,
      source: GATE2_LOG_NOT_SUPPLIED,
      verdictKind: null,
    });
  } else if (logFile === null) {
    // T27 · case (c) on Gate 2's log path: a path WAS supplied and its adapter threw. WIRED AND BLIND in the reader's
    // own words (its exported net), never "no log supplied", which would be false.
    const errorClass = gate1ErrorClass(logAdapterThrow === null ? undefined : logAdapterThrow.error);
    const gate2 = gate2DirectionThrew(gate2LogStepError(errorClass));
    sensorVerdicts.push(gate2.verdict);
    readers.push({ reader: GATE2_READER, wired: true, source: `${logDescription ?? ""} || ${gate2CensusLine(gate2)}`, verdictKind: gate2.verdict.kind });
    readerThrows.push({ reader: GATE2_READER, code: "G2_READER_THREW", errorClass });
  } else {
    // T27 (u) · the call that had no seam try. The reader's own whole-function try makes a throw from inside it
    // unreachable today; this try is the seam's net (defence in depth), and its catch calls no reader.
    const log = logFile;
    const basket = options.gate2;
    try {
      const gate2 = readGate2Direction(log, {
        readableLoadStates: states,
        basket,
      });
      const source = `${logDescription ?? ""} || ${gate2CensusLine(gate2)}`;
      sensorVerdicts.push(gate2.verdict);
      readers.push({
        reader: GATE2_READER,
        wired: true,
        source,
        verdictKind: gate2.verdict.kind,
      });
      if (gate2.code === "G2_READER_THREW") readerThrows.push({ reader: GATE2_READER, code: "G2_READER_THREW", errorClass: null });
    } catch (error) {
      const errorClass = gate1ErrorClass(error);
      const gate2 = gate2DirectionThrew(gate2LogStepError(errorClass));
      sensorVerdicts.push(gate2.verdict);
      readers.push({ reader: GATE2_READER, wired: true, source: `${logDescription ?? ""} || ${gate2CensusLine(gate2)}`, verdictKind: gate2.verdict.kind });
      readerThrows.push({ reader: GATE2_READER, code: "G2_READER_THREW", errorClass });
    }
  }

  // ── the clerk gap reader ───────────────────────────────────────────────────
  if (options.clerkStore === undefined) {
    readers.push({
      reader: GAP_READER,
      wired: false,
      source: "NOT WIRED — no clerk store was supplied (--clerk-store)",
      verdictKind: null,
    });
  } else {
    const now = options.now ?? Date.now();
    const gap = gapVerdict(options.clerkStore, options.clerkPubkey, now);
    sensorVerdicts.push(gap.verdict);
    readerMargins.push({
      reader: GAP_READER,
      kind: gap.verdict.kind,
      margin: { kind: "NO_THRESHOLD", reason: GAP_HAS_NO_THRESHOLD },
    });
    readers.push({
      reader: GAP_READER,
      wired: true,
      source: gap.detail,
      verdictKind: gap.verdict.kind,
    });
  }

  // ── the floor trail: a durable path is required for ANY permit ─────────────
  //
  // Absent is NOT softened here and must never be. The chokepoint already
  // narrows every executing disposition to HOLD-BLIND without a durable floor
  // reading, and that narrowing is the first lesson a tester should hit.
  const floorTrail =
    options.floorTrailOverride ??
    (options.floorTrailPath === undefined
      ? undefined
      : new FloorTrail({ path: options.floorTrailPath }));

  const ledger =
    options.ledgerOverride ??
    (options.ledgerPath === undefined
      ? undefined
      : new ChokepointLedger({ path: options.ledgerPath }));

  // ── notices: NO DEFAULT SINK, EVER ─────────────────────────────────────────
  //
  // `BatchedNotifier` with no sink computes a notice and hands it nowhere. The
  // fix is not a default destination — it is composing the S78 notice sinks,
  // whose composer owns the options object and installs a sink that is never
  // absent. With no destination supplied there is NO NOTIFIER AT ALL, so
  // nothing is computed, nothing is written, and nothing is created on disk.
  // C8: three cases, and the census below names which one this run was.
  let notifier: ComposedNotifier | null = null;
  let batched: BatchedNotifier | undefined;
  let built: BuiltNotifier | null = null;
  let noticeOwnership: NoticeOwnership = "NOT_WIRED";
  if (options.notifierOverride !== undefined) {
    // REFUSE, do not resolve. Honouring `noticeDir` here would open a SECOND
    // NoticeLog on a file the caller's own log already holds; ignoring it would
    // leave a declared destination doing nothing, silently. Neither is a thing
    // a deployment should have to discover from the record.
    const alsoSupplied = NOTIFIER_CONSTRUCTION_FIELDS.filter(
      (field) => options[field] !== undefined
    );
    if (alsoSupplied.length > 0) {
      throw new WireUsageError(NOTIFIER_OVERRIDE_CONFLICT + alsoSupplied.join(", ") + ".");
    }
    built = options.notifierOverride;
    noticeOwnership = "CALLER_OWNED";
  } else if (options.noticeDir !== undefined) {
    built = buildNotifier({
      noticeDir: options.noticeDir,
      noticeWindow: options.noticeWindow,
      witnessIntake: options.witnessIntake,
      transport: options.transport,
    });
    noticeOwnership = "BUILT_BY_THIS_WIRING";
  }
  if (built !== null) {
    notifier = built.notifier;
    batched = built.batched;
  }

  // T27 · F6, IN THE FLOOR: the chokepoint is built AFTER every reader has run, so the list it is handed is complete.
  // Non-empty -> the act does not execute whatever the line (chokepoint/types.ts holdForReaderThrows).
  const chokepoint = new Chokepoint({
    line: options.line,
    readerThrows: [...readerThrows],
    ledger,
    notifier: batched,
    floorTrail,
    decisionClock: options.decisionClock,
  });

  const census: WireCensus = {
    readers,
    log: logDescription ?? "NOT WIRED — no log path was supplied",
    readableLoadStates: states === undefined ? null : states,
    probeDoor: options.probeProvenance ?? null,
    clockStampsDoor: options.clockStampsProvenance ?? null,
    logReader:
      options.logPath === undefined
        ? null
        : options.logKind === "witness"
          ? [
              "WITNESS STORE READER (--log-kind witness), selected explicitly.",
              "",
              "  frame -> MICA log record, and every row is a claim:",
              ...WITNESS_LOG_MAPPING.map((l) => `    ${l}`),
              "",
              `  ${WITNESS_LOG_ATTESTS}`,
            ]
          : options.logKind === "subject-chain"
            ? [
                "SUBJECT CHAIN READER (--log-kind subject-chain), selected explicitly.",
                "",
                "  Every record carries MICA's five declared fields directly: there",
                "  is no mapping to audit, because the writer writes the grammar the",
                "  readers read. What IS a claim is the chain, and the one record",
                "  this store mints itself:",
                `    ${SUBJECT_LOG_BOUNDARY_EVENT_TYPE} at position 0 -> the "log starts here"`,
                "      record, INSIDE the chain and hashed like every other line. It",
                "      names the file this chain replaced (path, records, bytes,",
                "      sha256), or says FIRST_BOOT. It is declared OUT of Sig's",
                "      preconditionMap and reentryMap, so F2 does not govern it; Sig",
                "      F1 and Eng DO see it, as one ordered record and one singleton",
                "      event class respectively.",
                "",
                `  ${SUBJECT_CHAIN_ATTESTS}`,
              ]
            : [
              "GENERIC JSONL READER (default), expecting MICA log records.",
              "  It reads five declared fields and attests parse and ordering only.",
            ],
    floorTrail:
      floorTrail === undefined
        ? "NOT WIRED — no --floor-trail path. NO PERMIT CAN BE ACCOUNTED FOR, so " +
          "any executing disposition narrows to HOLD-BLIND."
        : options.floorTrailOverride !== undefined
          ? "JOURNAL-BACKED (Stage 1 two-phase override): the mandatory floor " +
            "reading lands as DECISION_PREPARED in the canonical decision " +
            "journal, not directly at any --floor-trail path here. The real " +
            "file (same FloorTrail class, same format) is written by the " +
            "wrapper AFTER DECISION_FINAL."
          : `${options.floorTrailPath} (loadState=${floorTrail.getLoadState()}, ` +
            `${floorTrail.length} record(s) on load)`,
    ledger:
      ledger === undefined
        ? "NOT WIRED — no --ledger path. A PASS-BLIND cannot be recorded, so it " +
          "fails closed to HOLD-BLIND."
        : options.ledgerOverride !== undefined
          ? "JOURNAL-BACKED (Stage 1 two-phase override): a due PASS-BLIND " +
            "record lands as PASSBLIND_PREPARED in the canonical decision " +
            "journal, not directly at any --ledger path here. The real file " +
            "(same ChokepointLedger class, same format) is written by the " +
            "wrapper AFTER DECISION_FINAL."
          : `${options.ledgerPath} (loadState=${ledger.getLoadState()}, ` +
            `${ledger.length} record(s) on load)`,
    notices:
      built === null
        ? "NOT WIRED — no --notice-dir. There is NO DEFAULT SINK: no notice is " +
          "computed, none is written, and nothing is created anywhere."
        : noticeOwnership === "CALLER_OWNED"
          ? `${CALLER_OWNED_NOTIFIER} ${built.censusLine}`
          : built.censusLine,
    noticeOwnership,
    stakesLine:
      options.line === undefined
        ? "NOT INJECTED — there is no built-in ladder. Every blind action is HELD."
        : `[${options.line.classes.join(" < ")}] holdAtOrAbove=${options.line.holdAtOrAbove}`,
    stakesClass:
      options.stakesClass === undefined
        ? "NOT SUPPLIED — the caller named no impact class for this action"
        : options.stakesClass,
  };

  return { chokepoint, sensorVerdicts, census, notifier, logFile, gate1Log, gate2Log, gate2ReadsBook, readerMargins, sigF3, readerThrows };
}

/**
 * The census, rendered. Every reader gets a line — including, and especially,
 * the ones that were not wired. An unwired reader is PRINTED as unwired; it is
 * never a silent absence.
 */
export function renderCensus(census: WireCensus): string {
  const out: string[] = [];
  out.push("[MICA-GUARD] WIRING CENSUS — what ran, and what did not");
  for (const entry of census.readers) {
    out.push(
      `  ${entry.wired ? "WIRED    " : "NOT WIRED"} ${entry.reader.padEnd(12)} ` +
        `verdict=${entry.verdictKind ?? "—"}`
    );
    out.push(`      ${entry.source}`);
  }
  out.push(
    `  load-state gate : ${
      census.readableLoadStates === null
        ? "NOT INJECTED — no reader can read anything this run"
        : `[${[...census.readableLoadStates].sort().join(", ")}]`
    }`
  );
  out.push(`  stakes line     : ${census.stakesLine}`);
  out.push(`  this action     : impactClass=${census.stakesClass}`);
  out.push(`  floor trail     : ${census.floorTrail}`);
  out.push(`  pass-blind ledger: ${census.ledger}`);
  // OWNERSHIP FIRST, then the destination. `totalSoFar` is unreadable without
  // it: the same integer means "this action" or "since the service started"
  // depending on this one word, and the line below would read identically either
  // way if it were left out.
  out.push(`  notice owner    : ${census.noticeOwnership}`);
  out.push(`  notices         : ${census.notices}`);
  if (census.logReader !== null) {
    out.push("  log reader      :");
    for (const line of census.logReader) {
      out.push(line.length === 0 ? "" : `      ${line}`);
    }
  }
  if (census.probeDoor === null) {
    out.push(
      "  probe door      : NOT OFFERED — no --probe-source this run, so Sig's F4"
    );
    out.push(
      "                    reads NOT_CONFIGURED: disclosed, and not counted."
    );
  } else {
    // BOTH LAYERS OR NEITHER. The door's finding is narrow and the sentence
    // under it is what keeps the narrow finding from being read as a wide one.
    out.push(`  probe door      : ADMITTED — ${census.probeDoor}`);
    out.push(`                    ${DOOR_CHECKED_CUSTODY}`);
    out.push(`                    ${SIG_STILL_NEVER_VERIFIES_THE_JOIN}`);
  }
  if (census.clockStampsDoor === null) {
    out.push(
      "  clock-stamps door: NOT OFFERED — no --clerk-clock-stamps this run, so"
    );
    out.push(
      "                    Sig's F3 reads NOT_CONFIGURED: disclosed, and not counted."
    );
  } else {
    out.push(`  clock-stamps door: ADMITTED — ${census.clockStampsDoor}`);
    out.push(`                    ${DOOR_CHECKED_CUSTODY_CLOCK}`);
    out.push(`                    ${SIG_STILL_NEVER_VERIFIES_THE_CLOCK_JOIN}`);
  }
  out.push("");
  out.push(`  ${UNWIRED_IS_NOT_BLIND}`);
  return out.join("\n");
}
