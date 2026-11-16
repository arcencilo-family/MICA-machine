// ── MICA · Gate 2 direction — a DECLARED basket, read as a bound AT GRADE ────
//
// WHAT THIS IS (Stop 2; the contract is the build seat's CONTRACT.md §1–§3).
//
//   Gate 2's core is DIRECTION: M_nonharm = V_basket − D_basket over the classes
//   the deployer declared, read as a CONSERVATIVE BOUND AT GRADE (05a §0/§1
//   amendments; the RMBA V/D basket spec). Each class carries a weight interval,
//   an evidence grade (Lane A measured > B inferred > C scenario; EG-0 … EG-3)
//   and, for value, a causal share ρ. A class may also be declared UNKNOWN —
//   named, never signed (RMBA §6).
//
//   Two ends are read, and only two:
//     LB  — the end LEAST favourable to the subject: value credited only where
//           it passes CVG (RMBA §13), every damage record at its upper weight,
//           every bounded unknown counted against.
//     B_g — the end MOST favourable, AT GRADE: every value record at its upper
//           weight, ONLY damage at or above `establishAt` at its lower weight,
//           every bounded unknown counted for.
//   ALARM ⇔ at-grade damage is ESTABLISHED on the record (Σ n·w.lo over damage
//   at ≥ establishAt is > 0) AND B_g ≤ 0: even the most favourable reading at
//   grade is non-positive, so the record establishes non-positive direction at
//   grade. EXACT BALANCE ALARMS (The arbiter's words, booked 2026-10-09 20:10Z: "equal
//   alarms"). "AT GRADE" HOLDS ON BOTH SIDES: B_g credits value only at ≥
//   creditAt, the declared grade at which value is credited at all — weak value
//   can neither buy a SILENT nor hold an ALARM off (RMBA §11: weak claims are
//   not laundered into gate arithmetic). D ALONE CANNOT ALARM (the audit,
//   20:01Z): with no value class credited at grade the margin has no upper
//   bound, and such a basket reads CANNOT_ASSESS (G2_VALUE_NOT_READABLE).
//   SILENT ⇔ LB > ε, and it is BINARY: it prints no
//   per-class count and no margin (02d DL-1). Everything between is
//   CANNOT_ASSESS, which prints the margin, because there the reader cannot
//   decide — a B_g in (0, …) still permits positive (05b:375-376).
//
//   EXACT ARITHMETIC. Every declared weight, magnitude and ε is read as the
//   SHORTEST DECIMAL that round-trips (ECMA-262 Number::toString: the declared
//   0.1 is read as 1/10, not as the binary fraction nearest it), and every
//   bound is summed in BigInt at one common decimal scale. So a decimal V = D
//   is B_g = 0 EXACTLY at any record length and in any units, the verdict
//   cannot depend on the order classes are declared in (the basketClass
//   digest ignores that order), and no sum overflows. ε is therefore not a
//   rounding allowance: it is RMBA's positivity margin, and it acts on the
//   SILENT side only, where a larger ε can only make SILENT harder to reach.
//
//   THE LATCH (08b:189-191, "never by internal quiet"). The record is scanned
//   in its own order; at EVERY record of a declared class the ALARM condition
//   is tested on the running sums — not only at damage records, because the
//   condition can first hold at the record that carries Σ n across nMin,
//   whatever its side. So EVERY ALARM IS LATCHED: whatever holds at the end
//   held at the last counted record, and latched there. Once it holds, the reading stays ALARM until a
//   record of a DECLARED latch-clearing kind follows it — value accrued after
//   the onset cannot lift it. A clearing record that CLEARS a standing latch
//   restarts the counting window there, and so does one that finds the window
//   BLOCKED by an unknown with no magnitude (a blocked window can neither alarm
//   nor be silent, so re-arming it loses no reading: "a window re-arms, never
//   recovers"). One that finds neither changes nothing — the kind may be
//   another gate's resolution too, and a window any such record could wipe is
//   one a stream of them could keep below nMin for ever.
//
// WHAT WAS REMOVED, NOT REPAIRED (the T26/T28 precedent; Stop-1 measurement §9):
//   the trail-creditability layer whole — the floor-trail lookup, its coverage
//   floor, the creditable margin and every code and ceiling line that served
//   it. It read MICA's own past verdicts through the floor, which is the
//   instrument reading the instrument, and on this deployment it made SILENT
//   unreachable by construction. Also gone: the ungraded point margin, the
//   ungraded positive weight as a class's only attribute, and the
//   `Math.min(...spread)` that threw at scale.
//
// FORK A (ruled): on this deployment's record no class measures benefit or
//   damage at grade. Declared as ruled, this reader reads
//   CANNOT_ASSESS(G2_NO_CLASS_AT_GRADE) on that record — by construction, and
//   honestly (05a:197 "basket absent or vacuous → CANNOT_ASSESS").
//
// It reads ONE book (the log it is handed) plus the injected basket. It reads
// no clock, no timestamp, no payload, no frame book and no output of MICA's,
// writes nothing, and adds no record kind. No subject, class, grade, ε, window
// or nMin is held here: every one arrives in the basket. The only numbers in
// the code are the grade ladder's own ranks and the canon's CVG rule (RMBA §13).

import type { MicaReadableLog } from "../log";
import {
  alarm,
  assessLogReadability,
  cannotAssess,
  formatScopeBlock,
  loadStateScopeLines,
  printScopeBlock,
  silent,
} from "../types";
import type { BlindPath, BlindPathClass, SensorVerdict } from "../types";
import { COMMON_COMPETENCE_LINES } from "../competence";
import { tupleKey } from "../tuple-key";

export const GATE2_DIRECTION_SENSOR_ID = "MICA/gate2-direction";

// ── The machine type (contract §1; the bridge mirrors it as WireOptions.gate2) ─

/** A measured > B inferred > C scenario. */
export type Gate2Lane = "A" | "B" | "C";

/** EG-0 anecdote … EG-3 audit. */
export interface Gate2Grade {
  readonly lane: Gate2Lane;
  readonly eg: 0 | 1 | 2 | 3;
}

/** outcome null = any outcome of that (moduleId, eventType). */
export interface Gate2ClassKey {
  readonly moduleId: string;
  readonly eventType: string;
  readonly outcome: string | null;
}

export interface Gate2SignedClass extends Gate2ClassKey {
  /** 0 ≤ lo ≤ hi, finite. */
  readonly weight: { readonly lo: number; readonly hi: number };
  readonly grade: Gate2Grade;
  /** [0, 1]. */
  readonly rhoCausal: number;
  /** Frame category ids, non-empty. */
  readonly bearsOn: readonly string[];
}

export interface Gate2UnknownClass extends Gate2ClassKey {
  readonly grade: Gate2Grade;
  readonly bearsOn: readonly string[];
  /** OPTIONAL magnitude bound (sign unknown). Absent → an unknown with records in the window is UNBOUNDED. */
  readonly magnitude?: { readonly hi: number };
}

export interface Gate2Basket {
  /** "G2_BASKET@" + 16 hex — computed by the BRIDGE, printed on every verdict. */
  readonly basketClass: string;
  /** Frame M's category ids for the subject (empty/absent → FRAME_ABSENT). */
  readonly frameCategories: readonly string[];
  readonly value: readonly Gate2SignedClass[];
  readonly damage: readonly Gate2SignedClass[];
  readonly unknown: readonly Gate2UnknownClass[];
  /** ≥ 0, finite; a TOLERANCE (RMBA default 1e-6), not a materiality knob. */
  readonly epsilonNum: number;
  /** Damage counts toward ALARM only at ≥ this. */
  readonly establishAt: Gate2Grade;
  /** Value counts toward SILENT only at ≥ this AND passing CVG. */
  readonly creditAt: Gate2Grade;
  /** The ONLY window built this stop; a trailing window is refused. */
  readonly window: { readonly kind: "sinceBoundary" };
  /** Positive integer. */
  readonly nMin: number;
  /** Operator-only kinds. */
  readonly latchClearedBy: readonly { readonly moduleId: string; readonly eventType: string }[];
}

// ── The HARM types (T31 re-based on eedfda8; Long Run A Stop 2 contract M1) ──
//
// A deployer-declared HARM-ONLY reading over the WITNESS'S BOOK: did a record show
// a change on a declared item by an origin that holds no grant for it? Built by the
// bridge from `harm[subject]`; mirrored there. Presence of `harm` in the config is
// the switch; a config without it reads exactly as before this type existed.

/** An origin: the declared subject the bridge binds an act to (O1). */
export interface Gate2HarmOrigin {
  readonly id: string;
  readonly subject: string;
}

/** A protected item: matched by the pointer's target fingerprint only (exact paths). */
export interface Gate2HarmItem {
  readonly id: string;
  /** The frame category the item's path sits in (printed; the bridge's door checks it). */
  readonly category: string;
  /** A declared control: an item the subject cannot change, so a DIFFERS on it is another writer's change or a failure of that assumption. */
  readonly control: boolean;
  /** fingerprintTarget(salt, path, version) in the bridge's current salt epoch; null = no epoch. */
  readonly fingerprint: string | null;
}

export interface Gate2Harm {
  /** "G2_HARM@" + 16 lower hex — computed by the BRIDGE, printed on every verdict. */
  readonly harmClass: string;
  readonly origins: readonly Gate2HarmOrigin[];
  readonly items: readonly Gate2HarmItem[];
  /** itemId -> originIds. EVERY item has an entry; [] is a grant list (nobody may change it). */
  readonly grants: Readonly<Record<string, readonly string[]>>;
  /**
   * S216 · itemId -> originId -> ms: the instant FROM which each grant counts. Exactly the keys of `grants` (every
   * item; its object names exactly its granted origins, so [] has {}). A record is granted only if its own
   * `timestamp` is at or after its origin's `since`; a record before it is damage whatever the grant now says.
   */
  readonly grantSince: Readonly<Record<string, Readonly<Record<string, Gate2GrantSince>>>>;
  /**
   * S216-2 · the bridge's GRANT MEMORY, as the bridge read it at this load: its tag (over the memory's boundary and its
   * written rows) and its state, printed beside the harm basket on every verdict that prints one. The reader never
   * reads the memory itself; it receives this, and the effective since in each grantSince.
   */
  readonly grantMemory: Gate2GrantMemory;
  /**
   * S208-2 · the errand grants the bridge derived from the arbiter's ERRAND_GRANTED / ERRAND_CLOSED records on the
   * subject chain: each permits its origin to change the named items from `from` until `until` (already cut at its
   * close). [] when none. A record is granted by an errand only if EXACTLY ONE errand covers its item and its time.
   */
  readonly errandGrants: readonly Gate2ErrandGrant[];
  /** 64-hex witness RECORD hashes (the record's own `hash`), the doctor's clearances (C1). */
  readonly clearances: readonly string[];
  /** ms; the start of the bridge's current target-salt epoch. null = the bridge holds none. */
  readonly saltEpochSince: number | null;
}

/**
 * relay-3 assembly (S216-2 × T35) · an errand window's edge: ms compared, UTC printed. It is NOT a grant since:
 * S216-2's effective/declared pair does not apply to it, so it carries `at` and `utc` only, as T35 built it.
 */
export type Gate2ErrandInstant = Pick<Gate2GrantSince, "at" | "utc">;

/** S208-2 · one errand grant, as the bridge derived it: ms compared, UTC spellings printed. */
export interface Gate2ErrandGrant {
  readonly errandId: string;
  readonly origin: string;
  readonly items: readonly string[];
  readonly from: Gate2ErrandInstant;
  readonly until: Gate2ErrandInstant;
  /** AA2 · the granting record's own place and hand on the subject chain: its subjectSeq and the uid that posted it. */
  readonly seq: number;
  readonly peerUid: number;
}

/**
 * S216 · one grant's since: the instant in ms (compared), and its UTC spelling (printed).
 * S216-2 · `at`/`utc` carry the EFFECTIVE since the bridge computed — the later of the declared since, the instant its
 * grant memory first carried the grant, and the highest since that memory carried for it (F-3) — and
 * `declaredAt`/`declaredUtc` the since the deployer declares now. at < declaredAt is refused whole, and each spelling
 * must be the canonical YYYY-MM-DDTHH:MM:SS.mmmZ spelling of its number (checked by integer arithmetic, no clock).
 */
export interface Gate2GrantSince {
  readonly at: number;
  readonly utc: string;
  readonly declaredAt: number;
  readonly declaredUtc: string;
}

/** S216-2 · the grant memory's states, a closed set; the reader prints each in fixed words. */
export type Gate2GrantMemoryState = "SEEDED" | "RESEEDED" | "BEGUN" | "BEGUN_AFTER_LOSS" | "RECOVERED_PREFIX" | "NOT_PERSISTED";

/** S216-2 · "G2_GRANT_MEMORY@" + 16 lower hex (computed by the BRIDGE) and the memory's state at this load. */
export interface Gate2GrantMemory {
  readonly tag: string;
  readonly state: Gate2GrantMemoryState;
}

/** One act from the interest book (the roster; never read for effects). */
export interface Gate2RosterEntry {
  readonly subjectSeq: number;
  readonly actionId: string;
  readonly label: string;
  readonly timestamp: number;
}

export interface Gate2DirectionConfig {
  /** Injected, no default (the shared readability gate). */
  readonly readableLoadStates?: readonly string[];
  readonly basket?: Gate2Basket;
  /** THE HARM BRANCH's switch. Mutually exclusive with `basket` (both → G2_HARM_MALFORMED). */
  readonly harm?: Gate2Harm;
  /**
   * The interest book's acts, IN THE BOOK'S OWN APPEND ORDER (the glue reads them in chain order). The reader never
   * re-sorts them: subjectSeq restarts at 1 on a rotated subject chain while the interest book outlives it, so only
   * the book's order says which act is newest. Absent or null → G2_ROSTER_NOT_READABLE (harm branch only).
   */
  readonly roster?: readonly Gate2RosterEntry[] | null;
  /** The act whose decision this reading serves; null = a status read (harm branch only). */
  readonly decidingActionId?: string | null;
  /** The book's retired predecessors, newest first, read for the LATCH ONLY (harm branch only). */
  readonly predecessors?: readonly MicaReadableLog[];
  /** The current book's boundary instant, ms (its first line); null = unknown (harm branch only). */
  readonly bookBoundaryAt?: number | null;
  /**
   * The frame's word for an act whose claimed target sits in no frame category (Gate 1's `underivedWord`),
   * as the bridge declares it. Absent or null → no label is told apart as underived (harm branch only).
   */
  readonly underivedWord?: string | null;
}

export type Gate2DirectionBlindReasonCode =
  | "G2_BASKET_ABSENT"
  | "G2_BASKET_MALFORMED"
  | "G2_FRAME_ABSENT"
  | "G2_READABILITY_GATE"
  // The T26 / Gate-1 precedent: an unforeseen throw, reported as blindness.
  | "G2_READER_THREW"
  | "G2_NO_CLASS_AT_GRADE"
  | "G2_VALUE_NOT_READABLE"
  | "G2_STARVED"
  | "G2_UNKNOWNS_PREVENT_BOUNDING"
  | "G2_DIRECTION_UNCERTAIN"
  // ── the harm branch only ──
  | "G2_HARM_MALFORMED"
  | "G2_MEMBERSHIP_NOT_READABLE"
  | "G2_PREDECESSOR_NOT_READABLE"
  | "G2_ORIGIN_NOT_READABLE"
  | "G2_ROSTER_NOT_READABLE"
  | "G2_NOT_READABLE"
  | "G2_UNKNOWN_ON_ITEM";

/** The one finding an ALARM carries (the second is the harm branch's). */
export type Gate2DirectionFindingCode = "G2_WRONG_DIRECTION_AT_GRADE" | "G2_UNGRANTED_CHANGE_ON_ITEM";

/**
 * One reading, as the glue needs it: the verdict, and the one code it carries
 * (a blind reason, or the ALARM's finding code; null on SILENT). Nothing else
 * is exposed — in particular no count and no margin, so a SILENT cannot be
 * re-printed with either by a caller (02d DL-1).
 */
export interface Gate2DirectionReading {
  readonly verdict: SensorVerdict;
  readonly code: Gate2DirectionBlindReasonCode | Gate2DirectionFindingCode | null;
  /** The sequence number at which a standing latch set; null when none stands. */
  readonly latchedSince: number | null;
  /**
   * HARM BRANCH ONLY (absent on every class-basket reading): the one line naming what this reading read — the
   * carried act (subjectSeq, actionId), its item, origin, grant, facet and fate; or, on an ALARM, the act whose
   * record shows the change and the act whose decision carries it; or why no carried act was read. It is printed
   * VERBATIM in the verdict's summary, so the glue may quote it where the decision object can carry it.
   */
  readonly harmLine?: string;
  /**
   * S216-2 · HARM BRANCH: the grant-memory line printed beside the harm basket on this verdict (or the fixed words
   * saying none is printed, where no validated harm basket exists), so the glue can carry it to /explain beside the
   * harmLine. Absent on every class-basket reading, as harmLine is.
   */
  readonly grantMemoryLine?: string | null;
}

// Source-discipline fence: the ceiling lines are the reader's printed limits.
// Two-bearer law (05b:319-323): no predicate of a mind occurs anywhere in this
// file, inside the fence or out of it; the fence arm of the test asserts both.
export const GATE2_DIRECTION_CEILING_LINES: readonly string[] = Object.freeze([
  "DIRECTION ONLY: persistence-under-unmonitoring is PERMANENTLY UNREADABLE from this evidence class (D-33); a SILENT here is silence about direction and never about persistence.",
  "ACTIONS, NOT CONSEQUENCES: the record shows acts, result codes and decisions; what an act did in the world is not on it (08e).",
  "UNDECLARED DAMAGE READS CLEAN: a basket counts only what it declares; damage in undeclared ways is invisible to this reader (05a:216).",
  "DEPLOYER-DECLARED BASKET: the classes, signs, weights, grades and ε are the deployer's; a self-serving basket buys the read it declares (05a:217).",
  "LEVEL: a trajectory-level read of this governed system's record, never a field-capacity read (05b §3a-v rider).",
  "PROVENANCE: the record is EG-1 (written by the subject's harness, chained and verified by the bridge; the clerk vouches for arrival only); the subject's own uid can post every caller kind (S206).",
  "IR UNDECLARED: no irreversibility class is on this record (RMBA §15); omission's counterfactual cost is unread; the horizon is this window only (RMBA §9).",
  "NON-COMPENSATORY: this reading buys back neither Gate 1's envelope nor Gate 4's form, and theirs buy back none of it (05a:489-490).",
  "BINARY SILENT: a SILENT prints no margin and no per-class count (02d DL-1); the margin is printed only where the reader cannot decide or alarms.",
  "NO PASS: MICA never says yes; the best this reader prints is SILENT with these lines (05a:185-188).",
]);

/**
 * T32 · THE HARM BRANCH'S OWN FROZEN LIST, printed on every harm-branch verdict.
 * Lines 1, 3, 5, 8 and 10 of GATE2_DIRECTION_CEILING_LINES verbatim (a test
 * asserts each equal); lines 2 and 6 replaced, because on the witness's book they
 * are false as written; lines 4, 7 and 9 varied to name the harm basket's own
 * objects, horizon and recorder (the canon refuter, M6/m1); five lines added for
 * what the book cannot say.
 * GATE2_DIRECTION_CEILING_LINES itself is unchanged.
 */
export const GATE2_HARM_CEILING_LINES: readonly string[] = Object.freeze([
  "DIRECTION ONLY: persistence-under-unmonitoring is PERMANENTLY UNREADABLE from this evidence class (D-33); a SILENT here is silence about direction and never about persistence.",
  "CONSEQUENCES OF CLAIMED TARGETS, SEEN BY ANOTHER HAND: the witness's book shows what its own uid saw of each act's claimed target between two looks; artefact effects on claimed targets are not benefit or harm in the human sense; persistence is not read.",
  "UNDECLARED DAMAGE READS CLEAN: a basket counts only what it declares; damage in undeclared ways is invisible to this reader (05a:216).",
  "DEPLOYER-DECLARED BASKET: the items, origins and grants are the deployer's and the clearances the doctor's; a self-serving basket buys the read it declares (05a:217).",
  "LEVEL: a trajectory-level read of this governed system's record, never a field-capacity read (05b §3a-v rider).",
  "PROVENANCE: the observation is the witness's (its own uid, a fixed published method; Lane A, EG-1, one look); the selection of what is looked at — the claimed target, the act's existence and its close — is the subject's word (S206).",
  "IR UNDECLARED: no irreversibility class is on this record (RMBA §15); omission's counterfactual cost is unread; the horizon is the current book, and its declared predecessors for the latch only (RMBA §9).",
  "NON-COMPENSATORY: this reading buys back neither Gate 1's envelope nor Gate 4's form, and theirs buy back none of it (05a:489-490).",
  "BINARY SILENT: a SILENT prints no margin; the recorder's counts beside it are facts of the book, not a distance to an ALARM (DL-1; F-E).",
  "NO PASS: MICA never says yes; the best this reader prints is SILENT with these lines (05a:185-188).",
  "ORIGIN IS THE BOUND PRINCIPAL: an origin names the principal the bridge binds the act to (the declared subject the witness copies into the record), never the human or errand behind it.",
  "EXACT PATHS ONLY: an item is matched by its canonical path's fingerprint; an act reaching it by another name, a link, or a claim whose target is not the item is unread.",
  "ONE DECISION LATE: a record exists only after its act closed, so it is read at a later decision; nothing on the record says the act whose decision carries a reading caused it.",
  "SINCE THE WITNESS LAST LOOKED: a DIFFERS is a difference between two looks, not a cause; the first look at an item cannot alarm; the witness forgets past its state caps and reads FIRST_SEEN again.",
  "ONE SUBJECT: a harm basket binds exactly one origin subject; the roster is not keyed by subject, so a second subject is refused until per-subject rosters exist, and another subject's record on an item reads as an origin not readable.",
  "RE-DERIVED FROM THE BOOK'S LOOKS: each successful look on an item is compared with the previous successful look of the same fingerprint in the same book (the witness's published rule), so a failed look or a forgotten target does not hide a change; still unread: a look the witness never wrote, and any change across two books; a change of the witness's digest key inside one book is not visible on the book, and looks compared across it read DIFFERS (an ALARM the doctor clears, never a SILENT).",
  "A RESTART IS A FIRST LOAD: a declaration laid by restart is never refused, so a loosened harm stanza is not refused then; the harmClass and the grant-memory tag on every verdict show which stanza and which memory read.",
  "A GRANT COUNTS FROM ITS SINCE: a record is granted only if its own timestamp (the book's, the witness's clock) is at or after the grant's effective since — the latest of the instant the deployer declares the grant to count from, the instant the bridge's grant memory first carried the grant, and the highest since that memory carried for it — AND, for a DIFFERS, the change window it covers (from this book's previous look at the item, else the witness's own prior look) starts at or after it too; a change made before the since and first seen after it reads ungranted. A grant widened with a later since never ends a latch; the latch's other exits are the ones the ALARM names.",
  "A SECOND MEMORY, THE BRIDGE'S: the effective since comes from the bridge's grant memory, a file beside the witness's book that this reader never reads (its tag and state print on every verdict with a harm basket); a first sight is the bridge's clock at the load, clamped to no earlier than the memory's last write and the newest record that load reads, so a clock stepped back beyond the clamp admits a back-dating up to the step, and a clock stepped forward holds a new grant's first sight in that future; a retirement or raised since the bridge could not write at a start (NOT PERSISTED) can be undone by a further restart; root can delete the memory (sinces only move later; the tag moves), replace it (RESEEDED, when the bridge's event book still names the earlier one) or forge it (undetectable: one principal writes, chains and verifies it), or run a bridge that does not keep it.",
  "AN ERRAND GRANT PERMITS A WINDOW, NOT AN ACT: an errand grant lets its origin change the items it names while its window is open — a DIFFERS is granted by it only if both its look (the record's timestamp) and the start of its change window (this book's previous look at the item, else the witness's prior look) lie inside [from, until); a change made before the window and first seen in it reads ungranted, and a change in the window first seen after it closes reads ungranted. Two errands covering one record grant nothing. THREE CLOCKS MEET IN ONE ERRAND: from and until are the arbiter's typed instants, admitted against the bridge's stamp on the granting record (no from before it, none more than one window after it); a close cuts the window at the bridge's stamp on the closing record; and the look tested against the window is the witness's clock — nothing here measures the skew between the bridge's clock and the witness's, and a skew moves the window's edges by exactly that much. Errand grants are records, not declaration: the same harmClass can read differently as errands are written, so a sealed case must condition on them. The grant line names the granting record by its seq and the uid that posted it. Until the identity model lands, the record that grants an errand is written by the operator's uid, which is not one person (S217).",
]);

export const GATE2_DIRECTION_CEILING_FENCE_END = true;

export const GATE2_HARM_CEILINGS = GATE2_HARM_CEILING_LINES.join(" ");

// ⛔ Computed ONCE at load from a FROZEN list (Gate 1's review C1-1): a list a
//    caller could push to would let a verdict stop carrying every line while
//    the export still claimed it did.
export const GATE2_DIRECTION_CEILINGS = GATE2_DIRECTION_CEILING_LINES.join(" ");

// ── The canon's fixed rules — the only numbers in this file ─────────────────

/** Grade order: A=3 > B=2 > C=1 (contract §1). */
const LANE_RANK: Readonly<Record<Gate2Lane, number>> = Object.freeze({ A: 3, B: 2, C: 1 });

/** EG is one of these, and nothing else. */
const EG_LADDER: readonly number[] = Object.freeze([0, 1, 2, 3]);

/**
 * CVG (RMBA §13): a VALUE class supports SILENT only at ≥ creditAt AND EG ≥ 2
 * AND ρ_causal ≥ 0.5. A canon rule, not a calibration: it is stated here once,
 * frozen, and printed wherever it decides a reading.
 */
export const GATE2_CVG_RULE = Object.freeze({
  minEg: 2,
  minRhoCausal: 0.5,
  source: "RMBA §13",
});

export const GATE2_BASKET_CLASS_PREFIX = "G2_BASKET@";
const BASKET_CLASS_HEX_LENGTH = 16;
const LOWER_HEX = "0123456789abcdef";

/** atLeast(g, req) ⇔ laneRank(g) ≥ laneRank(req) AND g.eg ≥ req.eg. */
export function gate2AtLeast(grade: Gate2Grade, required: Gate2Grade): boolean {
  return LANE_RANK[grade.lane] >= LANE_RANK[required.lane] && grade.eg >= required.eg;
}

/** CVG for a value class against the basket's creditAt. */
export function gate2PassesCvg(
  grade: Gate2Grade,
  rhoCausal: number,
  creditAt: Gate2Grade
): boolean {
  return (
    gate2AtLeast(grade, creditAt) &&
    grade.eg >= GATE2_CVG_RULE.minEg &&
    rhoCausal >= GATE2_CVG_RULE.minRhoCausal
  );
}

const CVG_TEXT =
  "CVG (RMBA §13): a value class counts toward SILENT only at or above creditAt, at EG ≥ 2 and with ρ_causal ≥ 0.5";

// ── The basket, validated ONCE from a snapshot ───────────────────────────────

type Side = "value" | "damage" | "unknown";

interface ClassSnap {
  readonly side: Side;
  readonly index: number;
  readonly moduleId: string;
  readonly eventType: string;
  readonly outcome: string | null;
  /** Weight interval; 0 for an unknown (named, never weighted). */
  readonly lo: number;
  readonly hi: number;
  readonly grade: Gate2Grade;
  readonly rhoCausal: number | null;
  readonly bearsOn: readonly string[];
  /** Unknown only: the declared magnitude bound, or null = UNBOUNDED. */
  readonly magnitudeHi: number | null;
  /** Value only: passes CVG against creditAt (counts toward LB, so toward SILENT). */
  readonly cvg: boolean;
  /** Value only: at or above creditAt — credited in B_g at all (cvg ⇒ credited, so LB ≤ B_g). */
  readonly credited: boolean;
  /** Damage only: at or above establishAt. */
  readonly atGrade: boolean;
}

interface Clearer {
  readonly moduleId: string;
  readonly eventType: string;
}

interface BasketSnap {
  readonly basketClass: string;
  readonly frame: readonly string[];
  readonly classes: readonly ClassSnap[];
  readonly epsilonNum: number;
  readonly establishAt: Gate2Grade;
  readonly creditAt: Gate2Grade;
  readonly nMin: number;
  readonly clearers: readonly Clearer[];
  /** A value class is declared at ≥ creditAt with w.hi > 0: the margin's V side is readable (audit 20:01Z). */
  readonly valueReadable: boolean;
  /** EXACT ARITHMETIC: the common decimal scale, ε at it, and each class's per-record steps (indexed like classes). */
  readonly scale: number;
  readonly epsExact: bigint;
  readonly steps: readonly Step[];
}

/** One record's contribution to the bounds, exact at the basket's scale. */
interface Step {
  readonly lb: bigint;
  readonly bg: bigint;
  /** Established at-grade damage: w.lo of a damage class at ≥ establishAt, else 0. */
  readonly d: bigint;
  /** An unknown with no magnitude: no bound is formed while it has records in the window. */
  readonly unbounded: boolean;
}

/** An exact decimal: n / 10^s. */
interface Dec {
  readonly n: bigint;
  readonly s: number;
}

/**
 * The SHORTEST DECIMAL that round-trips a finite, non-negative number
 * (ECMA-262 Number::toString), as an exact decimal. The declared 0.1 is 1/10.
 */
function decOf(x: number): Dec {
  const text = x.toString();
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(text);
  if (m === null) throw new BasketMalformed(`${text} is not a finite non-negative decimal.`);
  const frac = m[2] ?? "";
  const exp = m[3] === undefined ? 0 : Number(m[3]);
  const s = frac.length - exp;
  const n = BigInt(m[1] + frac);
  return s >= 0 ? { n, s } : { n: n * 10n ** BigInt(-s), s: 0 };
}

function atScale(d: Dec, scale: number): bigint {
  return d.n * 10n ** BigInt(scale - d.s);
}

/** An exact value at `scale` as a plain decimal string: no exponent, no trailing zeros. */
function decText(v: bigint, scale: number): string {
  const neg = v < 0n;
  let digits = (neg ? -v : v).toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, "0");
    const whole = digits.slice(0, digits.length - scale);
    const frac = digits.slice(digits.length - scale).replace(/0+$/, "");
    digits = frac.length > 0 ? `${whole}.${frac}` : whole;
  }
  return neg ? `-${digits}` : digits;
}

interface Fault {
  readonly code: Gate2DirectionBlindReasonCode;
  readonly detail: string;
}

/** Thrown inside the check and caught there: one malformed basket, one code. */
class BasketMalformed extends Error {}

function usableName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * A caller's list, read BY INDEX into a fresh array — never through its
 * iterator (Gate 1's review K1R1-1: an array with its own endless iterator, or
 * a Proxy over one, would hold a `for...of` forever). The length is refused
 * unless it is a non-negative safe integer; the refusal is a throw, caught by
 * the one try round the whole reader (G2_READER_THREW).
 */
function listOf(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new BasketMalformed(`${name} is not a list.`);
  const length: unknown = (value as unknown[]).length;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    throw new TypeError(`${name} does not carry a usable length; a list is read by index or not at all.`);
  }
  const out: unknown[] = [];
  for (let i = 0; i < length; i++) out.push((value as unknown[])[i]);
  return out;
}

function objectOf(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BasketMalformed(`${name} is not an object.`);
  }
  return value as Record<string, unknown>;
}

function gradeOf(value: unknown, name: string): Gate2Grade {
  const raw = objectOf(value, name);
  const lane: unknown = raw.lane;
  const eg: unknown = raw.eg;
  if (lane !== "A" && lane !== "B" && lane !== "C") {
    throw new BasketMalformed(`${name}.lane must be one of A, B, C.`);
  }
  if (typeof eg !== "number" || !EG_LADDER.includes(eg)) {
    throw new BasketMalformed(`${name}.eg must be one of 0, 1, 2, 3.`);
  }
  return Object.freeze({ lane, eg: eg as Gate2Grade["eg"] });
}

function namesOf(value: unknown, name: string, emptyAllowed: boolean): string[] {
  const list = listOf(value, name);
  if (!emptyAllowed && list.length === 0) throw new BasketMalformed(`${name} is empty.`);
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (!usableName(entry)) throw new BasketMalformed(`${name}[${i}] is not a non-empty string.`);
    if (out.includes(entry)) throw new BasketMalformed(`${name} repeats ${JSON.stringify(entry)}.`);
    out.push(entry);
  }
  return out;
}

function finiteIn(value: unknown, min: number, max: number | null): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    (max === null || value <= max)
  );
}

function classOf(
  side: Side,
  index: number,
  value: unknown,
  establishAt: Gate2Grade,
  creditAt: Gate2Grade
): ClassSnap {
  const name = `${side}[${index}]`;
  const raw = objectOf(value, name);
  const moduleId: unknown = raw.moduleId;
  const eventType: unknown = raw.eventType;
  const outcome: unknown = raw.outcome;
  if (!usableName(moduleId) || !usableName(eventType)) {
    throw new BasketMalformed(`${name} must carry non-empty moduleId and eventType strings.`);
  }
  if (outcome !== null && typeof outcome !== "string") {
    throw new BasketMalformed(`${name}.outcome must be a string or null (null = any outcome).`);
  }
  const grade = gradeOf(raw.grade, `${name}.grade`);
  const bearsOn = namesOf(raw.bearsOn, `${name}.bearsOn`, false);
  if (side === "unknown") {
    // NAMED, NEVER WEIGHTED (RMBA §6): an unknown carrying a weight or a ρ is
    // one declaration putting one class in two roles.
    if (raw.weight !== undefined || raw.rhoCausal !== undefined) {
      throw new BasketMalformed(`${name} is an UNKNOWN and carries a weight or ρ_causal; an unknown is named, never weighted.`);
    }
    const magnitude: unknown = raw.magnitude;
    let magnitudeHi: number | null = null;
    if (magnitude !== undefined) {
      const hi: unknown = objectOf(magnitude, `${name}.magnitude`).hi;
      if (!finiteIn(hi, 0, null) || hi === 0) {
        throw new BasketMalformed(
          `${name}.magnitude.hi must be finite and > 0: a magnitude of 0 is UNKNOWN = zero (RMBA V/D §6, §18.10).`
        );
      }
      magnitudeHi = hi;
    }
    return {
      side, index, moduleId, eventType, outcome, lo: 0, hi: 0, grade,
      rhoCausal: null, bearsOn, magnitudeHi, cvg: false, credited: false, atGrade: false,
    };
  }
  const weight = objectOf(raw.weight, `${name}.weight`);
  const lo: unknown = weight.lo;
  const hi: unknown = weight.hi;
  if (!finiteIn(lo, 0, null) || !finiteIn(hi, 0, null) || lo > hi) {
    throw new BasketMalformed(`${name}.weight must be finite with 0 ≤ lo ≤ hi.`);
  }
  const rhoCausal: unknown = raw.rhoCausal;
  if (!finiteIn(rhoCausal, 0, 1)) throw new BasketMalformed(`${name}.rhoCausal must be finite in [0, 1].`);
  return {
    side, index, moduleId, eventType, outcome, lo, hi, grade, rhoCausal, bearsOn,
    magnitudeHi: null,
    cvg: side === "value" && gate2PassesCvg(grade, rhoCausal, creditAt),
    credited: side === "value" && gate2AtLeast(grade, creditAt),
    atGrade: side === "damage" && gate2AtLeast(grade, establishAt),
  };
}

function classLabel(c: ClassSnap): string {
  return (
    `${c.side}[${c.index}] (moduleId=${JSON.stringify(c.moduleId)}, eventType=${JSON.stringify(c.eventType)}, ` +
    `outcome=${c.outcome === null ? "any" : JSON.stringify(c.outcome)})`
  );
}

function gradeText(g: Gate2Grade): string {
  return `Lane ${g.lane}/EG-${g.eg}`;
}

/** Two keys of one (moduleId, eventType) collide unless both name different outcomes. */
function overlaps(a: ClassSnap, b: ClassSnap): boolean {
  return a.outcome === null || b.outcome === null || a.outcome === b.outcome;
}

/**
 * Contract §2.1 — config/basket absent → G2_BASKET_ABSENT; any §1 invariant
 * broken → G2_BASKET_MALFORMED. No default, no clamp, no repair. The caller's
 * object is read ONCE and every later step works from the snapshot (a getter
 * that answered differently the second time would otherwise be validated as
 * one basket and counted as another).
 */
function basketCheck(
  config: Gate2DirectionConfig | undefined
): { readonly fault: Fault; readonly basket: null } | { readonly fault: null; readonly basket: BasketSnap } {
  if (config === undefined) {
    return {
      fault: {
        code: "G2_BASKET_ABSENT",
        detail:
          "Gate2DirectionConfig was absent. The basket is the deployer's declaration and is injected; " +
          "with none there is nothing whose direction could be read.",
      },
      basket: null,
    };
  }
  const malformed = (detail: string) => ({
    fault: { code: "G2_BASKET_MALFORMED" as const, detail },
    basket: null,
  });
  if (config === null || typeof config !== "object") {
    return malformed(`Gate2DirectionConfig was ${config === null ? "null" : typeof config}, not an object.`);
  }
  const rawBasket: unknown = config.basket;
  if (rawBasket === undefined) {
    return {
      fault: {
        code: "G2_BASKET_ABSENT",
        detail:
          "No basket was declared. Direction is read over DEPLOYER-DECLARED classes; with no basket " +
          "there is no class to count and no bound to form (05a:197).",
      },
      basket: null,
    };
  }
  try {
    const b = objectOf(rawBasket, "basket");
    const basketClass: unknown = b.basketClass;
    if (!usableBasketClass(basketClass)) {
      throw new BasketMalformed(
        `basketClass must be "${GATE2_BASKET_CLASS_PREFIX}" followed by ${BASKET_CLASS_HEX_LENGTH} lower-case hex digits.`
      );
    }
    const rawFrame: unknown = b.frameCategories;
    const frame = rawFrame === undefined ? [] : namesOf(rawFrame, "frameCategories", true);
    const establishAt = gradeOf(b.establishAt, "establishAt");
    const creditAt = gradeOf(b.creditAt, "creditAt");
    const epsilonNum: unknown = b.epsilonNum;
    if (!finiteIn(epsilonNum, 0, null)) {
      throw new BasketMalformed("epsilonNum must be finite and ≥ 0; no default, clamp or repair is applied.");
    }
    const nMin: unknown = b.nMin;
    if (typeof nMin !== "number" || !Number.isSafeInteger(nMin) || nMin < 1) {
      throw new BasketMalformed("nMin must be a positive integer.");
    }
    const window = objectOf(b.window, "window");
    const windowKeys = Object.keys(window);
    if (window.kind !== "sinceBoundary" || windowKeys.length !== 1) {
      throw new BasketMalformed(
        "window must be exactly { kind: \"sinceBoundary\" }: it is the only window this reader reads, and a " +
          "trailing window is refused (its interaction with the latch is not designed)."
      );
    }
    const classes: ClassSnap[] = [];
    const sides: readonly Side[] = ["value", "damage", "unknown"];
    for (let s = 0; s < sides.length; s++) {
      const side = sides[s];
      const list = listOf(b[side], side);
      for (let i = 0; i < list.length; i++) classes.push(classOf(side, i, list[i], establishAt, creditAt));
    }
    let damageNamed = false;
    for (let i = 0; i < classes.length; i++) {
      if (classes[i].side !== "value") damageNamed = true;
    }
    if (!damageNamed) {
      throw new BasketMalformed(
        "damage[] and unknown[] are both empty: no damage term is NAMED. A missing damage term is not a free " +
          "lunch; it is an audit problem (RMBA:208)."
      );
    }
    // A record may match AT MOST ONE class across the three lists: a repeated
    // key, or a null-outcome class beside an outcome class of the same kind,
    // is refused here as at the front door — no precedence is applied.
    const byKind = new Map<string, ClassSnap[]>();
    for (let i = 0; i < classes.length; i++) {
      const c = classes[i];
      const key = tupleKey([c.moduleId, c.eventType]);
      const same = byKind.get(key) ?? [];
      for (let j = 0; j < same.length; j++) {
        if (overlaps(same[j], c)) {
          throw new BasketMalformed(
            `${classLabel(same[j])} and ${classLabel(c)} can match the same record (duplicate or overlap); ` +
              "a record may belong to at most one declared class."
          );
        }
      }
      same.push(c);
      byKind.set(key, same);
    }
    // EXACT ARITHMETIC: one common decimal scale for ε and every declared bound.
    const epsDec = decOf(epsilonNum);
    const decs: { lo: Dec; hi: Dec; mag: Dec | null }[] = [];
    let scale = epsDec.s;
    for (let i = 0; i < classes.length; i++) {
      const c = classes[i];
      const e = { lo: decOf(c.lo), hi: decOf(c.hi), mag: c.magnitudeHi === null ? null : decOf(c.magnitudeHi) };
      if (e.lo.s > scale) scale = e.lo.s;
      if (e.hi.s > scale) scale = e.hi.s;
      if (e.mag !== null && e.mag.s > scale) scale = e.mag.s;
      decs.push(e);
    }
    const steps: Step[] = [];
    for (let i = 0; i < classes.length; i++) {
      const c = classes[i];
      const lo = atScale(decs[i].lo, scale);
      const hi = atScale(decs[i].hi, scale);
      if (c.side === "value") {
        steps.push({ lb: c.cvg ? lo : 0n, bg: c.credited ? hi : 0n, d: 0n, unbounded: false });
      } else if (c.side === "damage") {
        steps.push({ lb: -hi, bg: c.atGrade ? -lo : 0n, d: c.atGrade ? lo : 0n, unbounded: false });
      } else {
        const mag = decs[i].mag;
        steps.push(
          mag === null
            ? { lb: 0n, bg: 0n, d: 0n, unbounded: true }
            : { lb: -atScale(mag, scale), bg: atScale(mag, scale), d: 0n, unbounded: false }
        );
      }
    }
    const rawClearers = listOf(b.latchClearedBy, "latchClearedBy");
    if (rawClearers.length === 0) {
      throw new BasketMalformed("latchClearedBy is empty: a latch nothing can clear is not a declared latch.");
    }
    const clearers: Clearer[] = [];
    const clearerKeys = new Set<string>();
    for (let i = 0; i < rawClearers.length; i++) {
      const raw = objectOf(rawClearers[i], `latchClearedBy[${i}]`);
      const moduleId: unknown = raw.moduleId;
      const eventType: unknown = raw.eventType;
      if (!usableName(moduleId) || !usableName(eventType)) {
        throw new BasketMalformed(`latchClearedBy[${i}] must carry non-empty moduleId and eventType strings.`);
      }
      const key = tupleKey([moduleId, eventType]);
      if (clearerKeys.has(key)) throw new BasketMalformed(`latchClearedBy[${i}] repeats a clearing kind.`);
      if (byKind.has(key)) {
        throw new BasketMalformed(
          `latchClearedBy[${i}] (moduleId=${JSON.stringify(moduleId)}, eventType=${JSON.stringify(eventType)}) ` +
            "is also a declared class: a record cannot both count and clear."
        );
      }
      clearerKeys.add(key);
      clearers.push({ moduleId, eventType });
    }
    return {
      fault: null,
      basket: {
        basketClass: basketClass as string,
        frame,
        classes,
        epsilonNum,
        establishAt,
        creditAt,
        nMin,
        clearers,
        // A value class weighted [0, 0] can never register value: declared, but not readable (the mirror
        // of "a count is not presence" on the damage side).
        valueReadable: classes.some((c) => c.side === "value" && c.credited && c.hi > 0),
        scale,
        epsExact: atScale(epsDec, scale),
        steps,
      },
    };
  } catch (error) {
    if (error instanceof BasketMalformed) return malformed(`The basket is malformed: ${error.message}`);
    throw error;
  }
}

function usableBasketClass(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith(GATE2_BASKET_CLASS_PREFIX)) return false;
  const hex = value.slice(GATE2_BASKET_CLASS_PREFIX.length);
  if (hex.length !== BASKET_CLASS_HEX_LENGTH) return false;
  for (let i = 0; i < hex.length; i++) if (!LOWER_HEX.includes(hex[i])) return false;
  return true;
}

/** Contract §2.2 — frame absent escalates; a bearsOn outside M is malformed. */
function frameFault(basket: BasketSnap): Fault | null {
  if (basket.frame.length === 0) {
    return {
      code: "G2_FRAME_ABSENT",
      detail:
        "No frame fixed for this subject — escalated (05a:170). Direction is " +
        "frame-dependent: this reader cannot originate the frame, and reads no direction without one.",
    };
  }
  for (let i = 0; i < basket.classes.length; i++) {
    const c = basket.classes[i];
    for (let j = 0; j < c.bearsOn.length; j++) {
      if (!basket.frame.includes(c.bearsOn[j])) {
        return {
          code: "G2_BASKET_MALFORMED",
          detail:
            `The basket is malformed: ${classLabel(c)} bears on ${JSON.stringify(c.bearsOn[j])}, which is not ` +
            "a category of the declared frame.",
        };
      }
    }
  }
  return null;
}

// ── Verdict assembly: every path carries the ceilings ────────────────────────

function basketLine(basketClass: string | null): string {
  return basketClass === null
    ? "Basket: not printed (no validated basket on this path)."
    : `Basket: ${basketClass}.`;
}

/**
 * The OBJECT of each CANNOT_ASSESS, for its message class (contract §2): "I
 * cannot read this — <object>". Fixed text: no caller value is in it.
 */
const CANNOT_READ_OBJECT: Readonly<Record<Gate2DirectionBlindReasonCode, string>> = Object.freeze({
  G2_BASKET_ABSENT: "no basket was declared",
  G2_BASKET_MALFORMED: "the declared basket is malformed",
  G2_FRAME_ABSENT: "no frame fixed for this subject — escalated (05a:170)",
  G2_READABILITY_GATE: "the log did not pass the readability gate",
  G2_READER_THREW: "this reader threw while reading",
  G2_NO_CLASS_AT_GRADE: "no declared class is at the grade a basket claim needs — direction NOT READABLE on this record",
  G2_VALUE_NOT_READABLE: "no value class is credited at grade, so the margin has no upper bound — damage alone cannot alarm",
  G2_STARVED: "the counting window holds fewer declared-class records than nMin",
  G2_UNKNOWNS_PREVENT_BOUNDING: "an unknown with no declared magnitude has records, so no bound is formed",
  G2_DIRECTION_UNCERTAIN: "the interval [LB, B_g] does not settle direction",
  G2_HARM_MALFORMED: "the declared harm basket is malformed",
  G2_MEMBERSHIP_NOT_READABLE: "item membership is not readable on this book (the bridge's target-salt epoch)",
  G2_PREDECESSOR_NOT_READABLE: "a retired predecessor book could not be read, and a latch could stand there",
  G2_ORIGIN_NOT_READABLE: "a record on an item names no declared origin",
  G2_ROSTER_NOT_READABLE: "the act roster (the interest book) is not readable",
  G2_NOT_READABLE: "the carried act has no record on the witness's book",
  G2_UNKNOWN_ON_ITEM: "the carried act's record on an item does not show whether the item changed",
});

function blind(
  code: Gate2DirectionBlindReasonCode,
  paths: readonly BlindPath[],
  basketClass: string | null,
  body: string
): Gate2DirectionReading {
  const base = cannotAssess(GATE2_DIRECTION_SENSOR_ID, paths);
  return {
    verdict: {
      kind: base.kind,
      sensorId: base.sensorId,
      blindPaths: base.blindPaths,
      summary:
        `${base.summary} I cannot read this — ${CANNOT_READ_OBJECT[code]}. Blind reason code: ${code}. ` +
        `${basketLine(basketClass)} ${body} ${GATE2_DIRECTION_CEILINGS}`,
    },
    code,
    latchedSince: null,
  };
}

function stopped(
  code: Gate2DirectionBlindReasonCode,
  blindClass: BlindPathClass,
  detail: string,
  basketClass: string | null
): Gate2DirectionReading {
  return blind(code, [{ class: blindClass, detail }], basketClass, "The record was not read.");
}

// ── The scan (contract §2.4 recorder, §2.5 latch) ────────────────────────────

/**
 * Counts over one counting window: since the boundary, or since the last
 * clearing record that cleared a standing latch or re-armed a blocked window.
 * The exact sums run with the counts, so the ALARM test is O(1) per record.
 */
interface Segment {
  /** Per class, indexed like BasketSnap.classes. */
  readonly n: number[];
  sumN: number;
  afterClearingSeq: number | null;
  lb: bigint;
  bg: bigint;
  d: bigint;
  /** Records in the window of unknowns with no magnitude. */
  unboundedN: number;
}

interface Scan {
  readonly records: number;
  readonly firstSeq: number | null;
  readonly lastSeq: number | null;
  /** Per class over the WHOLE window (the recorder). */
  readonly whole: readonly number[];
  readonly inNoClass: number;
  readonly clearingSeqs: readonly number[];
  /** Latches that set and were cleared, in order. */
  readonly cleared: readonly { readonly onsetSeq: number; readonly clearedSeq: number }[];
  /** Clearing records that re-armed a window an unbounded unknown had blocked. */
  readonly rearmed: readonly number[];
  /** The counting window at the end of the scan. */
  readonly segment: Segment;
  /** A latch standing at the end of the scan. */
  readonly onset: { readonly seq: number; readonly bounds: Bounds } | null;
}

interface Term {
  readonly label: string;
  readonly lbPart: bigint;
  readonly bgPart: bigint;
}

/** Exact, at the basket's scale; printed through decText. */
interface Bounds {
  readonly LB: bigint;
  readonly B_g: bigint;
  readonly nDamageAtGrade: number;
  /** Σ n·w.lo over damage at ≥ establishAt: the at-grade damage the record ESTABLISHES. */
  readonly dEstablished: bigint;
  /** Unknowns WITH records in the window and WITHOUT a magnitude: bounds are not formed. */
  readonly unbounded: readonly ClassSnap[];
  readonly terms: readonly Term[];
}

function emptySegment(classCount: number): Segment {
  const n: number[] = [];
  for (let i = 0; i < classCount; i++) n.push(0);
  return { n, sumN: 0, afterClearingSeq: null, lb: 0n, bg: 0n, d: 0n, unboundedN: 0 };
}

/**
 * Contract §2.8, over one counting window:
 *   LB  = Σ_{V passing CVG} n·w.lo − Σ_{D all} n·w.hi − Σ_{U with magnitude} n·m.hi
 *   B_g = Σ_{V all} n·w.hi − Σ_{D at ≥ establishAt} n·w.lo + Σ_{U with magnitude} n·m.hi
 */
function boundsOf(basket: BasketSnap, n: readonly number[]): Bounds {
  const terms: Term[] = [];
  const unbounded: ClassSnap[] = [];
  let nDamageAtGrade = 0;
  let dEstablished = 0n;
  let LB = 0n;
  let B_g = 0n;
  for (let i = 0; i < basket.classes.length; i++) {
    const c = basket.classes[i];
    const step = basket.steps[i];
    const count = n[i];
    if (count === 0) continue;
    if (step.unbounded) {
      unbounded.push(c);
      continue;
    }
    if (c.side === "damage" && c.atGrade) nDamageAtGrade += count;
    const k = BigInt(count);
    dEstablished += k * step.d;
    LB += k * step.lb;
    B_g += k * step.bg;
    terms.push({ label: classLabel(c), lbPart: k * step.lb, bgPart: k * step.bg });
  }
  return { LB, B_g, nDamageAtGrade, dEstablished, unbounded, terms };
}

/**
 * THE ALARM CONDITION (contract §2.8; the arbiter's "equal alarms" in the audit's F1 gloss, 20:10Z, read with
 * the audit's 20:01Z: "equal alarms" stands "once both sides are readable"): a
 * value class is CREDITED AT GRADE (step 6b), at-grade damage is ESTABLISHED (Σ n·w.lo > 0 — a
 * damage class weighted [0, …] establishes none, so a count alone is not
 * presence) AND the bound at grade is NON-POSITIVE, exact balance included
 * (B_g ≤ 0, exact). It is tested only where §2.7 and §2.8 let bounds be formed
 * at all: Σ n ≥ nMin, and no unknown without a magnitude has a record in the
 * window (such an unknown is unbounded, so B_g is not finite and nothing is alarmed).
 */
function alarmHolds(basket: BasketSnap, segment: Segment): boolean {
  // The value side's readability is not tested here: step 6b reads a basket with
  // no value class at ≥ creditAt as G2_VALUE_NOT_READABLE before any latch is emitted.
  if (segment.sumN < basket.nMin || segment.unboundedN > 0) return false;
  return segment.d > 0n && segment.bg <= 0n;
}

function scan(log: MicaReadableLog, basket: BasketSnap): Scan {
  const records: unknown = log.getAll();
  // ⛔ A LIST, OR NOT A READING; read by index (see listOf).
  if (!Array.isArray(records)) {
    throw new TypeError("getAll() did not return a list; an unbounded iterable would never finish reading.");
  }
  const total: unknown = (records as unknown[]).length;
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) {
    throw new TypeError("getAll()'s result does not carry a usable length; a list is read by index or not at all.");
  }
  const classCount = basket.classes.length;
  const byKind = new Map<string, number[]>();
  for (let i = 0; i < classCount; i++) {
    const c = basket.classes[i];
    const key = tupleKey([c.moduleId, c.eventType]);
    const same = byKind.get(key) ?? [];
    same.push(i);
    byKind.set(key, same);
  }
  const clearing = new Set<string>();
  for (let i = 0; i < basket.clearers.length; i++) {
    clearing.add(tupleKey([basket.clearers[i].moduleId, basket.clearers[i].eventType]));
  }

  const whole: number[] = [];
  for (let i = 0; i < classCount; i++) whole.push(0);
  let inNoClass = 0;
  let firstSeq: number | null = null;
  let lastSeq: number | null = null;
  const clearingSeqs: number[] = [];
  const cleared: { onsetSeq: number; clearedSeq: number }[] = [];
  const rearmed: number[] = [];
  let segment = emptySegment(classCount);
  let onset: { seq: number; bounds: Bounds } | null = null;

  // IN SEQUENCE ORDER: the order the log hands its records over, which a
  // verified chain guarantees is its append order. No timestamp is read.
  for (let r = 0; r < (total as number); r++) {
    const record = (records as unknown[])[r] as Record<string, unknown>;
    const sequenceNumber: unknown = record.sequenceNumber;
    const moduleId: unknown = record.moduleId;
    const eventType: unknown = record.eventType;
    const outcome: unknown = record.outcome;
    if (typeof sequenceNumber !== "number" || !Number.isFinite(sequenceNumber)) {
      throw new TypeError(`record ${r} carries no finite sequenceNumber.`);
    }
    if (typeof moduleId !== "string" || typeof eventType !== "string") {
      throw new TypeError(`record ${r} carries no string moduleId and eventType.`);
    }
    if (firstSeq === null) firstSeq = sequenceNumber;
    lastSeq = sequenceNumber;
    const key = tupleKey([moduleId, eventType]);

    if (clearing.has(key)) {
      // A DECLARED latch-clearing record. If a latch stands, it clears here
      // and counting RESTARTS after this record (contract §2.5). If the window
      // is BLOCKED by an unknown with no magnitude, it re-arms here too: a
      // blocked window can neither alarm nor be silent, so nothing is lost. If
      // neither, nothing restarts: the kind may also be another gate's
      // resolution, and a window any such record could wipe is one a stream
      // of them could keep below nMin for ever.
      inNoClass++;
      clearingSeqs.push(sequenceNumber);
      if (onset !== null || segment.unboundedN > 0) {
        if (onset !== null) cleared.push({ onsetSeq: onset.seq, clearedSeq: sequenceNumber });
        else rearmed.push(sequenceNumber);
        onset = null;
        segment = emptySegment(classCount);
        segment.afterClearingSeq = sequenceNumber;
      }
      continue;
    }

    const candidates = byKind.get(key);
    let matched = -1;
    if (candidates !== undefined) {
      for (let k = 0; k < candidates.length; k++) {
        const c = basket.classes[candidates[k]];
        if (c.outcome === null || c.outcome === outcome) {
          matched = candidates[k];
          break;
        }
      }
    }
    if (matched < 0) {
      inNoClass++;
      continue;
    }
    whole[matched]++;
    segment.n[matched]++;
    segment.sumN++;
    const step = basket.steps[matched];
    segment.lb += step.lb;
    segment.bg += step.bg;
    segment.d += step.d;
    if (step.unbounded) segment.unboundedN++;
    // EVERY counted record, whatever its side: the condition can first hold at
    // the record that carries Σ n across nMin.
    if (onset === null && alarmHolds(basket, segment)) {
      onset = { seq: sequenceNumber, bounds: boundsOf(basket, segment.n) };
    }
  }

  return {
    records: total as number,
    firstSeq,
    lastSeq,
    whole,
    inNoClass,
    clearingSeqs,
    cleared,
    rearmed,
    segment,
    onset,
  };
}

// ── What a reading prints ────────────────────────────────────────────────────

function windowText(s: Scan): string {
  return s.firstSeq === null
    ? "Window: sinceBoundary, the record is EMPTY (0 records)."
    : `Window: sinceBoundary, seq ${s.firstSeq}..${s.lastSeq} (${s.records} records, in the log's own order).`;
}

function noClassText(s: Scan): string {
  const declared = s.records - s.inNoClass;
  const fraction = s.records === 0 ? "undefined" : String(s.inNoClass / s.records);
  return (
    `Records in a declared class: ${declared}. Records in no declared class: ${s.inNoClass} of ${s.records} ` +
    `(fraction ${fraction}).`
  );
}

function countingWindowText(s: Scan): string {
  const latches =
    s.cleared.length === 0
      ? ""
      : ` Latches set and cleared: ${s.cleared.map((l) => `onset seq ${l.onsetSeq} cleared at seq ${l.clearedSeq}`).join("; ")}.`;
  const rearms =
    s.rearmed.length === 0
      ? ""
      : ` Windows blocked by an unknown with no magnitude, re-armed at seq ${s.rearmed.join(", ")}.`;
  if (s.segment.afterClearingSeq !== null) {
    return (
      `Counting window: the records AFTER the latch-clearing record at seq ${s.segment.afterClearingSeq}, the last ` +
      `that cleared a standing latch or re-armed a blocked window (clearing records at seq ` +
      `${s.clearingSeqs.join(", ")}); counts and bounds below restart there.${latches}${rearms}`
    );
  }
  return s.clearingSeqs.length === 0
    ? `Counting window: the whole window (no latch-clearing record on it).${latches}`
    : `Counting window: the whole window (clearing records at seq ${s.clearingSeqs.join(", ")} found no latch ` +
        `standing and no blocked window, so counting did not restart).${latches}`;
}

/** The RECORDER LEG (contract §2.4), printed on every NON-SILENT reading of the record. */
function recorderText(basket: BasketSnap, s: Scan): string {
  const restarted = s.segment.afterClearingSeq !== null;
  const perClass: string[] = [];
  for (let i = 0; i < basket.classes.length; i++) {
    const c = basket.classes[i];
    const grade =
      c.side === "value"
        ? `${gradeText(c.grade)}, ρ_causal ${c.rhoCausal}, weight [${c.lo}, ${c.hi}], CVG ${c.cvg ? "PASSES" : "FAILS"}, ` +
          `${c.credited ? "CREDITED (≥ creditAt)" : "BELOW creditAt (not credited)"}`
        : c.side === "damage"
          ? `${gradeText(c.grade)}, ρ_causal ${c.rhoCausal}, weight [${c.lo}, ${c.hi}], ${c.atGrade ? "AT GRADE" : "BELOW establishAt"}`
          : `${gradeText(c.grade)}, ${c.magnitudeHi === null ? "UNBOUNDED (no magnitude)" : `magnitude ≤ ${c.magnitudeHi}`}`;
    perClass.push(
      `${classLabel(c)} ${grade}: n=${s.whole[i]}${restarted ? ` (counting window n=${s.segment.n[i]})` : ""}`
    );
  }
  const perCategory: string[] = [];
  for (let f = 0; f < basket.frame.length; f++) {
    let sum = 0;
    for (let i = 0; i < basket.classes.length; i++) {
      if (basket.classes[i].bearsOn.includes(basket.frame[f])) sum += s.whole[i];
    }
    perCategory.push(`${basket.frame[f]}=${sum}`);
  }
  const unknowns: string[] = [];
  for (let i = 0; i < basket.classes.length; i++) {
    const c = basket.classes[i];
    if (c.side !== "unknown") continue;
    unknowns.push(
      `${classLabel(c)} n=${s.whole[i]} ${c.magnitudeHi === null ? "UNBOUNDED" : `bounded by ${c.magnitudeHi}`}`
    );
  }
  return (
    `RECORDER: ${windowText(s)} ${noClassText(s)} Per declared class (whole window): [${perClass.join("; ")}]. ` +
    `Per frame category (Σ n of the classes bearing on it): [${perCategory.join(", ")}]. ` +
    `UNKNOWN LIST (named, never signed; UNKNOWN ≠ zero, RMBA §6): [${unknowns.join("; ")}]. ` +
    `${countingWindowText(s)} Σ n in the counting window: ${s.segment.sumN}; nMin ${basket.nMin}. ` +
    `Grades: establishAt ${gradeText(basket.establishAt)}, creditAt ${gradeText(basket.creditAt)}; ${CVG_TEXT}.`
  );
}

function boundsText(basket: BasketSnap, b: Bounds): string {
  const straddling: string[] = [];
  const terms: string[] = [];
  for (let i = 0; i < b.terms.length; i++) {
    const t = b.terms[i];
    terms.push(`${t.label} [${decText(t.lbPart, basket.scale)}, ${decText(t.bgPart, basket.scale)}]`);
    // A term STRADDLES when its own interval holds zero with width: it is the
    // part of the record whose sign the declaration does not settle.
    if (t.lbPart <= 0n && t.bgPart >= 0n && t.lbPart < t.bgPart) straddling.push(t.label);
  }
  return (
    `BOUNDS over the counting window (exact decimals): LB=${decText(b.LB, basket.scale)}, ` +
    `B_g=${decText(b.B_g, basket.scale)}, epsilonNum=${basket.epsilonNum}; at-grade damage records ` +
    `${b.nDamageAtGrade}, established at-grade damage ${decText(b.dEstablished, basket.scale)}. Terms [LB part, B_g part]: [${terms.join("; ")}]. ` +
    `Straddling zero: [${straddling.join("; ")}].`
  );
}

/**
 * THE SILENT FACE, BINARY (02d DL-1; contract §2.4): the basket's identity,
 * the window, the declared-class total and the fraction in no class — and
 * NOTHING per class and NO margin.
 */
function silentFace(basket: BasketSnap, s: Scan): string {
  const parts = [
    `the declared basket ${basket.basketClass} as a bound at grade (LB is above epsilonNum, and no latch stands)`,
    windowText(s),
    noClassText(s),
  ];
  if (s.segment.afterClearingSeq !== null) {
    parts.push(`Counting window: after the latch-clearing record at seq ${s.segment.afterClearingSeq}.`);
  }
  return parts.join(" ");
}

// ── The reading, in the contract's order (§2; the order is load-bearing) ─────

function read(log: MicaReadableLog, config: Gate2DirectionConfig | undefined): Gate2DirectionReading {
  // 1 · the basket
  const checked = basketCheck(config);
  if (checked.fault !== null) {
    return stopped(checked.fault.code, "MISSING_CONFIGURATION", checked.fault.detail, null);
  }
  const basket = checked.basket;

  // 2 · the frame
  const frame = frameFault(basket);
  if (frame !== null) {
    return stopped(frame.code, "MISSING_CONFIGURATION", frame.detail, basket.basketClass);
  }

  // 3 · the readability gate, with the injected list (read once)
  const states = (config as Gate2DirectionConfig).readableLoadStates;
  const unreadable = assessLogReadability(log, GATE2_DIRECTION_SENSOR_ID, states);
  if (unreadable !== null) {
    return blind("G2_READABILITY_GATE", unreadable.blindPaths, basket.basketClass, "The record was not read.");
  }

  // 4 · 5 · the recorder and the latch, in one scan
  const s = scan(log, basket);
  const recorder = recorderText(basket, s);

  // 6 · no class at grade is DECLARED
  let classAtGrade = false;
  for (let i = 0; i < basket.classes.length; i++) {
    const c = basket.classes[i];
    if ((c.side === "value" && c.cvg) || (c.side === "damage" && c.atGrade)) classAtGrade = true;
  }
  if (!classAtGrade) {
    return blind(
      "G2_NO_CLASS_AT_GRADE",
      [{
        class: "INELIGIBLE_SCOPE",
        detail:
          "No declared class is at the grade a basket claim needs — vacuous at grade (05a:197, \"basket absent or vacuous → CANNOT_ASSESS\"): no " +
          "value class passes CVG (RMBA §13) and no damage class is at or above establishAt " +
          `${gradeText(basket.establishAt)} (RMBA §11), so no reading can either alarm or be silent. Direction NOT ` +
          "READABLE on this record.",
      }],
      basket.basketClass,
      recorder
    );
  }

  // 6b · no value class is credited at grade: D alone cannot alarm (the audit, 20:01Z)
  if (!basket.valueReadable) {
    return blind(
      "G2_VALUE_NOT_READABLE",
      [{
        class: "INELIGIBLE_SCOPE",
        detail:
          `No value class is declared at or above creditAt ${gradeText(basket.creditAt)}, so the margin V − D has ` +
          "no upper bound at grade: an alarm from damage counted and benefit unreadable would read an instrument " +
          "gap as conduct (the audit, 2026-10-09 20:01Z). Damage is counted and printed; direction is NOT READABLE " +
          "until a value class is declared at the grade value is credited at.",
      }],
      basket.basketClass,
      recorder
    );
  }

  // 7 · starved
  if (s.segment.sumN < basket.nMin) {
    return blind(
      "G2_STARVED",
      [{
        class: "INSUFFICIENT_SAMPLE",
        detail:
          `The counting window holds ${s.segment.sumN} declared-class record(s), ` +
          `fewer than nMin ${basket.nMin}; no bound is formed below it.`,
      }],
      basket.basketClass,
      recorder
    );
  }

  // 5 (emitted) · a latch that set and was never cleared wins over every later step
  if (s.onset !== null) {
    const atEnd = boundsOf(basket, s.segment.n);
    const detail =
      "I read this and it is wrong-direction at grade. LATCHED: the ALARM condition (a value class credited at grade, " +
      `at-grade damage established and B_g ≤ 0) first held at seq ${s.onset.seq} ` +
      `(LB=${decText(s.onset.bounds.LB, basket.scale)}, B_g=${decText(s.onset.bounds.B_g, basket.scale)}, ` +
      `at-grade damage records ${s.onset.bounds.nDamageAtGrade}), and no declared latch-clearing record follows it; ` +
      "a latch never clears by internal quiet. At the end of the counting window: " +
      `${atEnd.unbounded.length > 0 ? "an unbounded unknown has records, so no end bound is formed" : boundsText(basket, atEnd)}`;
    const v = alarm(GATE2_DIRECTION_SENSOR_ID, `${detail} ${recorder}`, [
      { code: "G2_WRONG_DIRECTION_AT_GRADE", detail },
    ]);
    return {
      verdict: {
        kind: v.kind,
        sensorId: v.sensorId,
        findings: v.findings,
        summary: `${v.summary} Basket: ${basket.basketClass}. ${GATE2_DIRECTION_CEILINGS}`,
      },
      code: "G2_WRONG_DIRECTION_AT_GRADE",
      latchedSince: s.onset.seq,
    };
  }

  // 8 · the bounds over the counting window. NO ALARM IS DECIDED HERE: the
  //     ALARM condition is tested at every declared-class record during the
  //     scan, so if it held over this window it held at the window's last
  //     counted record and latched there (step 5). An unlatched ALARM cannot exist.
  const bounds = boundsOf(basket, s.segment.n);

  // 9 · unknowns without a magnitude, with records: no bound is formed
  if (bounds.unbounded.length > 0) {
    return blind(
      "G2_UNKNOWNS_PREVENT_BOUNDING",
      [{
        class: "INSUFFICIENT_SAMPLE",
        detail:
          "UNKNOWN ≠ zero (RMBA §6): " +
          `${bounds.unbounded.map(classLabel).join("; ")} ha${bounds.unbounded.length === 1 ? "s" : "ve"} records in ` +
          "the counting window and no declared magnitude, so the interval is unbounded at both ends.",
      }],
      basket.basketClass,
      recorder
    );
  }

  // 10 · SILENT, binary
  if (bounds.LB > basket.epsExact) {
    const v = silent(GATE2_DIRECTION_SENSOR_ID, silentFace(basket, s));
    return {
      verdict: { kind: v.kind, sensorId: v.sensorId, summary: `${v.summary} ${GATE2_DIRECTION_CEILINGS}` },
      code: null,
      latchedSince: null,
    };
  }

  // 11 · the interval holds ε: the reader cannot decide, and prints why — on
  //      the summary's face as well as in the blind path
  const printed = boundsText(basket, bounds);
  return blind(
    "G2_DIRECTION_UNCERTAIN",
    [{
      class: "INSUFFICIENT_SAMPLE",
      detail:
        "The interval [LB, B_g] does not settle direction: LB is not above epsilonNum and " +
        (bounds.B_g <= 0n
          ? "the bound at grade is non-positive, but no at-grade damage is established on the record, so it is " +
            `not an alarm. ${printed}`
          : `the bound at grade is positive, so the interval still permits positive (05b:375-376). ${printed}`),
    }],
    basket.basketClass,
    `${printed} ${recorder}`
  );
}

/**
 * The fixed text a throw is reported with when its own text cannot be built.
 * No caller value is in it, so it cannot fail to exist.
 */
export const GATE2_THREW_UNRENDERED =
  "This reader THREW while reading, which is not a reading; the thrown value could not be " +
  "rendered into this detail. A floor instrument that raises an exception has not looked, and " +
  "its caller cannot tell that from a crash of its own — so the throw is reported as blindness.";

/**
 * Gate 1's `threw()`, followed exactly (contract §2: the precedent attaches
 * the thrown text, so this does too). ⛔ THE WHOLE DETAIL IS BUILT INSIDE ITS
 * OWN TRY: rendering a caller-shaped value can throw, and so can joining a
 * rendered text just under the engine's string limit to its prefix. Any
 * failure falls back to GATE2_THREW_UNRENDERED. The detail goes into the blind
 * path only; the summary is fixed text, so nothing caller-shaped is joined
 * again outside this try.
 */
function threw(error: unknown): Gate2DirectionReading {
  let detail: string;
  try {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    detail =
      `This reader THREW while reading, which is not a reading: ${text}. A floor instrument that ` +
      "raises an exception has not looked, and its caller cannot tell that from a crash of its own — " +
      "so the throw is reported as blindness with the error text attached.";
  } catch {
    detail = GATE2_THREW_UNRENDERED;
  }
  return stopped("G2_READER_THREW", "MISSING_CONFIGURATION", detail, null);
}

/**
 * T27 · THE SAME BLINDNESS, FOR A CALLER WHOSE OWN STEP AROUND THIS READER THREW
 * (the class basket's path) — the glue's book adapter, built before this reader
 * runs. Exported exactly as Gate 1 exports gate1ScopeThrew, so the caller
 * composes the reader's OWN G2_READER_THREW reading (same kind, code, class,
 * every ceiling) and never calls the reader again from a catch, and never
 * hand-builds a lookalike. Returns what `threw` returns, byte for byte.
 * Throw-free like the reader. ⚠ The caller decides what it hands in; the glue
 * hands a FIXED value naming the error class only.
 */
export function gate2DirectionThrew(error: unknown): Gate2DirectionReading {
  return threw(error);
}

/**
 * T27 · as gate2DirectionThrew, for the HARM branch: returns what the reader's
 * own harm net (`harmThrew`) returns, byte for byte.
 */
export function gate2HarmThrew(error: unknown): Gate2DirectionReading {
  return harmThrew(error);
}

/**
 * The reading with its one code (for the glue's census row). ⛔ NOTHING MAY
 * THROW OUT OF A FLOOR READER — THE WHOLE FUNCTION is one try (T26's R2;
 * Gate 1's precedent): the basket check, the readability gate and the scan all
 * touch caller-supplied objects.
 */
export function readGate2Direction(
  log: MicaReadableLog,
  config?: Gate2DirectionConfig
): Gate2DirectionReading {
  // The harm switch is read INSIDE the one try: a `harm` getter that throws is
  // a throw like any other. A config without `harm` takes `read`, unchanged.
  let harmMode = false;
  try {
    harmMode = harmDeclared(config);
    return harmMode ? readHarm(log, config as Gate2DirectionConfig) : read(log, config);
  } catch (error) {
    return harmMode ? harmThrew(error) : threw(error);
  }
}

// ⟦HARM BRANCH BEGIN⟧ ─────────────────────────────────────────────────────────
//
// THE HARM BRANCH (T31 re-based on eedfda8; T32 for its ceilings; Long Run A
// Stop 2 contract M2; the Stop-1 direction note §7). Did a record on the
// witness's book show a change on a declared ITEM by an ORIGIN that holds no
// GRANT for it? Read in the contract's order:
//   1 the harm basket, validated once from a snapshot (G2_HARM_MALFORMED);
//   2 the shared readability gate on the book (G2_READABILITY_GATE);
//   3 membership: item fingerprints are bound to the bridge's target-salt
//     epoch, so a book begun before that epoch cannot be matched against items
//     (G2_MEMBERSHIP_NOT_READABLE, A-5);
//   4 the records: CONSEQUENCE@ entries carrying a `witnessed` object, from the
//     current book and — FOR THE LATCH ONLY — every readable predecessor;
//   5 ALARM ⇔ some record shows an ungranted DIFFERS on an item that no
//     clearance names — whatever the act's fate (W-H, F-11). Re-derived at
//     every read; nothing is persisted here; the book is the durable record;
//   6 otherwise the CARRIED act (A-1): the newest roster act older than the
//     deciding act, read from its own record.
// The RECORDER and the harm ceilings print on every verdict of this branch.
//
// ⚠ TIME IN THIS BRANCH, STATED: it reads no clock. It compares INJECTED
//    instants only — the book's boundary against the salt epoch, a predecessor
//    book's own first line against the same epoch, and each roster act against
//    the book's boundary — so a roster or boundary instant that lies moves
//    which act is carried or whether membership is read, never a record's facet.
//    S216 adds ONE more: each witness record's own `timestamp` against its origin's
//    grant `since` (declared ms, printed by its declared UTC spelling — no Date), so
//    a record's timestamp that lies moves whether it is granted: the ceiling says so.
//    The class-basket path above reads no timestamp at all, as before.
//    S216-2 adds NO instant read: the effective and declared sinces arrive injected, are compared with each other,
//    and their UTC spellings are checked against their numbers by integer arithmetic (civilUtc) — no clock, no
//    calendar object — so the print is the number the verdict was computed from.

const HARM_CLASS_PREFIX = "G2_HARM@";
/** S216-2 · the grant memory's tag prefix; its hex part is as long as a harmClass's. */
const GRANT_MEMORY_TAG_PREFIX = "G2_GRANT_MEMORY@";
const RECORD_HASH_HEX_LENGTH = 64;
/** A harmClass carries as many hex digits as a basketClass. */
const HARM_CLASS_HEX_LENGTH = BASKET_CLASS_HEX_LENGTH;
/** How much of a record hash is PRINTED to name it (a display prefix, never a match). */
const PRINTED_HASH_PREFIX_LENGTH = 16;
const CONSEQUENCE_PREFIX = "CONSEQUENCE@";
const BOUNDARY_RECORD_TYPE = "SUBJECT_LOG_BOUNDARY";
/** The facets of a look that show a change since the witness last looked (seeing.ts). */
const DIFFERS_FACETS: readonly string[] = Object.freeze([
  "EXISTENCE_DIFFERS",
  "TYPE_DIFFERS",
  "CONTENT_DIFFERS",
  "META_DIFFERS",
]);
const QUIET_FACETS: readonly string[] = Object.freeze(["SAME", "FIRST_SEEN"]);
const RAN_FATE = "RAN";
const HELD_FATE = "HELD";
const LATE_FATE_PREFIX = "LATE";

/** The config keys the harm branch reads; any other is refused, never ignored. */
const HARM_CONFIG_KEYS: readonly string[] = Object.freeze([
  "readableLoadStates", "harm", "roster", "decidingActionId", "predecessors", "bookBoundaryAt", "underivedWord",
]);
const HARM_KEYS: readonly string[] = Object.freeze([
  "harmClass", "origins", "items", "grants", "grantSince", "grantMemory", "errandGrants", "clearances", "saltEpochSince",
]);
const ORIGIN_KEYS: readonly string[] = Object.freeze(["id", "subject"]);
const SINCE_KEYS: readonly string[] = Object.freeze(["at", "utc", "declaredAt", "declaredUtc"]);
const GRANT_MEMORY_KEYS: readonly string[] = Object.freeze(["tag", "state"]);
const ERRAND_KEYS: readonly string[] = Object.freeze(["errandId", "origin", "items", "from", "until", "seq", "peerUid"]);
/** relay-3 assembly · an errand window's edge carries `at` and `utc` only (Gate2ErrandInstant), not SINCE_KEYS. */
const ERRAND_INSTANT_KEYS: readonly string[] = Object.freeze(["at", "utc"]);

/**
 * S216-2 · THE FIXED WORDS PER GRANT-MEMORY STATE (GM5). The bridge sends the state; the words are the reader's, so a
 * bridge cannot print prose here.
 */
const GRANT_MEMORY_STATE_WORDS: Readonly<Record<Gate2GrantMemoryState, string>> = Object.freeze({
  SEEDED:
    "SEEDED — seeded by the arbiter's hand at a relay: a seeded grant counts from the since the arbiter attested; every later grant from the bridge's first sight of it",
  RESEEDED:
    "RESEEDED — replaced by root after an earlier memory the bridge's event book names: its first sights are root's word, not the bridge's",
  BEGUN:
    "BEGUN — begun by the bridge with no earlier memory on its event book: every grant counts from the bridge's first sight of it at the latest",
  BEGUN_AFTER_LOSS:
    "BEGUN AFTER LOSS — an earlier memory was missing, unreadable or corrupt and is set aside, never edited (the bridge's event book names it): every grant counts from its first sight in the new memory, so the loss only moves sinces later",
  RECOVERED_PREFIX:
    "RECOVERED PREFIX — the memory's torn last line was set aside with the file and its verified prefix carried forward with its first sights; the torn row never landed",
  NOT_PERSISTED:
    "NOT PERSISTED — a row of this load could not be written: this process holds it; across a further restart a first sight is re-stamped later, but an unwritten retirement or raised since can be undone; the tag covers written rows only",
});
const GRANT_MEMORY_STATES: readonly string[] = Object.freeze(Object.keys(GRANT_MEMORY_STATE_WORDS));
/** S216-2 · where no validated harm basket exists, the memory is not printed either — in these fixed words. */
const GRANT_MEMORY_NOT_PRINTED = "Grant memory: not printed (no validated harm basket on this path).";

// ⟦CIVIL CALENDAR BEGIN⟧ — the only numbers here beyond the fence's own are the proleptic Gregorian calendar's.
/**
 * S216-2 · THE CANONICAL UTC SPELLING OF AN INSTANT, by integer arithmetic only (days-from-civil, inverted; no clock and
 * no calendar object): "YYYY-MM-DDTHH:MM:SS.mmmZ" for a non-negative safe-integer ms up to the end of year 9999; null
 * for anything else. A since whose spelling is not this is refused, so what prints is the number that was compared.
 */
function civilUtc(ms: number): string | null {
  if (!Number.isSafeInteger(ms) || ms < 0) return null;
  const days = Math.floor(ms / 86400000);
  const inDay = ms - days * 86400000;
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  if (year > 9999) return null;
  const hour = Math.floor(inDay / 3600000);
  const minute = Math.floor((inDay - hour * 3600000) / 60000);
  const second = Math.floor((inDay - hour * 3600000 - minute * 60000) / 1000);
  const milli = inDay - hour * 3600000 - minute * 60000 - second * 1000;
  const pad = (n: number, w: number): string => String(n).padStart(w, "0");
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}.${pad(milli, 3)}Z`;
}
// ⟦CIVIL CALENDAR END⟧
const ITEM_KEYS: readonly string[] = Object.freeze(["id", "category", "control", "fingerprint"]);

/** Thrown inside the harm check and caught there: one malformed harm basket, one code. */
class HarmMalformed extends Error {}

function harmDeclared(config: Gate2DirectionConfig | undefined): boolean {
  if (config === undefined || config === null || typeof config !== "object") return false;
  return (config as { harm?: unknown }).harm !== undefined;
}

interface OriginSnap {
  readonly id: string;
  readonly subject: string;
}

interface ItemSnap {
  readonly id: string;
  readonly category: string;
  readonly control: boolean;
  readonly fingerprint: string | null;
}

interface HarmSnap {
  readonly harmClass: string;
  readonly origins: readonly OriginSnap[];
  readonly items: readonly ItemSnap[];
  readonly grants: ReadonlyMap<string, readonly string[]>;
  /** S216 · itemId -> originId -> ms from which the grant counts. */
  readonly grantSince: ReadonlyMap<string, ReadonlyMap<string, Gate2GrantSince>>;
  /** S216-2 · the line printed beside the harm basket: "GRANT MEMORY <tag> (<the state's fixed words>)." */
  readonly grantMemoryLine: string;
  /** S208-2 · the errand grants, validated. */
  readonly errandGrants: readonly Gate2ErrandGrant[];
  readonly clearances: readonly string[];
  readonly saltEpochSince: number | null;
  readonly states: readonly string[] | undefined;
  readonly rawRoster: unknown;
  readonly decidingActionId: string | null;
  readonly predecessors: readonly MicaReadableLog[];
  readonly bookBoundaryAt: number | null;
  /** The declared underived word; null = none declared, so no label is read as underived. */
  readonly underivedWord: string | null;
}

function ownKeys(o: Record<string, unknown>): string[] {
  return Object.keys(o);
}

function exactKeysOf(o: Record<string, unknown>, keys: readonly string[], name: string): void {
  const have = ownKeys(o);
  for (let i = 0; i < have.length; i++) {
    if (!keys.includes(have[i])) {
      throw new HarmMalformed(`${name} carries the key ${JSON.stringify(have[i])}, which this reader does not read; an unknown key is refused, never ignored.`);
    }
  }
  for (let i = 0; i < keys.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(o, keys[i])) throw new HarmMalformed(`${name} lacks ${JSON.stringify(keys[i])}.`);
  }
}

function lowerHexOf(value: unknown, length: number): boolean {
  if (typeof value !== "string" || value.length !== length) return false;
  for (let i = 0; i < value.length; i++) if (!LOWER_HEX.includes(value[i])) return false;
  return true;
}

function instantOrNull(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new HarmMalformed(`${name} must be a finite number of ms, or null.`);
  return value;
}

function isLog(value: unknown): value is MicaReadableLog {
  if (value === null || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return typeof o.verify === "function" && typeof o.getLoadState === "function" && typeof o.getAll === "function";
}

/** Step 1 — read the caller's config ONCE into a snapshot; every refusal is G2_HARM_MALFORMED. */
function harmCheck(
  config: Gate2DirectionConfig
): { readonly fault: Fault; readonly snap: null } | { readonly fault: null; readonly snap: HarmSnap } {
  try {
    const c = config as unknown as Record<string, unknown>;
    if (c.basket !== undefined) {
      throw new HarmMalformed("basket and harm are both declared: harm REPLACES the class basket, never sits beside it.");
    }
    // `basket: undefined` is no basket; every other key must be one this branch reads.
    const configKeys = ownKeys(c);
    for (let i = 0; i < configKeys.length; i++) {
      if (configKeys[i] !== "basket" && !HARM_CONFIG_KEYS.includes(configKeys[i])) {
        throw new HarmMalformed(`the config carries the key ${JSON.stringify(configKeys[i])}, which this reader does not read; an unknown key is refused, never ignored.`);
      }
    }
    const h = objectOf(c.harm, "harm");
    exactKeysOf(h, HARM_KEYS, "harm");
    const harmClass: unknown = h.harmClass;
    if (
      typeof harmClass !== "string" ||
      !harmClass.startsWith(HARM_CLASS_PREFIX) ||
      !lowerHexOf(harmClass.slice(HARM_CLASS_PREFIX.length), HARM_CLASS_HEX_LENGTH)
    ) {
      throw new HarmMalformed(`harmClass must be "${HARM_CLASS_PREFIX}" followed by ${HARM_CLASS_HEX_LENGTH} lower-case hex digits.`);
    }
    const rawOrigins = listOf(h.origins, "harm.origins");
    if (rawOrigins.length === 0) throw new HarmMalformed("harm.origins is empty: a grant needs an origin to name.");
    const origins: OriginSnap[] = [];
    for (let i = 0; i < rawOrigins.length; i++) {
      const o = objectOf(rawOrigins[i], `harm.origins[${i}]`);
      exactKeysOf(o, ORIGIN_KEYS, `harm.origins[${i}]`);
      const id: unknown = o.id;
      const subject: unknown = o.subject;
      if (!usableName(id) || !usableName(subject)) throw new HarmMalformed(`harm.origins[${i}] must carry non-empty id and subject strings.`);
      for (let j = 0; j < origins.length; j++) {
        if (origins[j].id === id) throw new HarmMalformed(`harm.origins repeats the id ${JSON.stringify(id)}.`);
        if (origins[j].subject === subject) {
          throw new HarmMalformed(`harm.origins binds the subject ${JSON.stringify(subject)} twice: a record's origin would be ambiguous.`);
        }
      }
      origins.push(Object.freeze({ id, subject }));
    }
    if (origins.length > 1) {
      throw new HarmMalformed(
        `harm.origins binds ${origins.length} subjects: a harm basket binds exactly one origin subject until per-subject rosters exist (the roster is not keyed by subject).`
      );
    }
    const rawItems = listOf(h.items, "harm.items");
    if (rawItems.length === 0) throw new HarmMalformed("harm.items is empty: a harm basket protects at least one item.");
    const items: ItemSnap[] = [];
    for (let i = 0; i < rawItems.length; i++) {
      const o = objectOf(rawItems[i], `harm.items[${i}]`);
      exactKeysOf(o, ITEM_KEYS, `harm.items[${i}]`);
      const id: unknown = o.id;
      const category: unknown = o.category;
      const control: unknown = o.control;
      const fingerprint: unknown = o.fingerprint;
      if (!usableName(id) || !usableName(category)) throw new HarmMalformed(`harm.items[${i}] must carry non-empty id and category strings.`);
      if (typeof control !== "boolean") throw new HarmMalformed(`harm.items[${i}].control must be true or false.`);
      if (fingerprint !== null && !usableName(fingerprint)) throw new HarmMalformed(`harm.items[${i}].fingerprint must be a non-empty string or null.`);
      for (let j = 0; j < items.length; j++) {
        if (items[j].id === id) throw new HarmMalformed(`harm.items repeats the id ${JSON.stringify(id)}.`);
        if (fingerprint !== null && items[j].fingerprint === fingerprint) {
          throw new HarmMalformed(`harm.items[${i}] and the item ${JSON.stringify(items[j].id)} carry one fingerprint: one path, two items.`);
        }
      }
      items.push(Object.freeze({ id, category, control, fingerprint: fingerprint as string | null }));
    }
    const rawGrants = objectOf(h.grants, "harm.grants");
    const grantKeys = ownKeys(rawGrants);
    const grants = new Map<string, readonly string[]>();
    for (let i = 0; i < grantKeys.length; i++) {
      if (!items.some((it) => it.id === grantKeys[i])) {
        throw new HarmMalformed(`harm.grants names ${JSON.stringify(grantKeys[i])}, which is not a declared item.`);
      }
    }
    for (let i = 0; i < items.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(rawGrants, items[i].id)) {
        throw new HarmMalformed(`the item ${JSON.stringify(items[i].id)} has no grants entry: every item has one, and [] is a grant list.`);
      }
      const list = namesOf(rawGrants[items[i].id], `harm.grants[${JSON.stringify(items[i].id)}]`, true);
      for (let j = 0; j < list.length; j++) {
        if (!origins.some((o) => o.id === list[j])) {
          throw new HarmMalformed(`harm.grants[${JSON.stringify(items[i].id)}] names ${JSON.stringify(list[j])}, which is not a declared origin.`);
        }
      }
      grants.set(items[i].id, Object.freeze(list));
    }
    // S216 · every grant counts FROM a declared instant: one entry per item, naming exactly its granted origins.
    const rawSince = objectOf(h.grantSince, "harm.grantSince");
    const sinceKeys = ownKeys(rawSince);
    for (let i = 0; i < sinceKeys.length; i++) {
      if (!grants.has(sinceKeys[i])) throw new HarmMalformed(`harm.grantSince names ${JSON.stringify(sinceKeys[i])}, which is not a declared item.`);
    }
    const grantSince = new Map<string, ReadonlyMap<string, Gate2GrantSince>>();
    for (let i = 0; i < items.length; i++) {
      const id = items[i].id;
      if (!Object.prototype.hasOwnProperty.call(rawSince, id)) {
        throw new HarmMalformed(`the item ${JSON.stringify(id)} has no grantSince entry: every grant counts from a declared instant, and [] has {}.`);
      }
      const per = objectOf(rawSince[id], `harm.grantSince[${JSON.stringify(id)}]`);
      const listed = grants.get(id) ?? [];
      const perKeys = ownKeys(per);
      const m = new Map<string, Gate2GrantSince>();
      for (let j = 0; j < perKeys.length; j++) {
        if (!listed.includes(perKeys[j])) {
          throw new HarmMalformed(`harm.grantSince[${JSON.stringify(id)}] names ${JSON.stringify(perKeys[j])}, which holds no grant for that item.`);
        }
        const one = objectOf(per[perKeys[j]], `harm.grantSince[${JSON.stringify(id)}][${JSON.stringify(perKeys[j])}]`);
        exactKeysOf(one, SINCE_KEYS, `harm.grantSince[${JSON.stringify(id)}][${JSON.stringify(perKeys[j])}]`);
        const at: unknown = one.at;
        const utc: unknown = one.utc;
        const declaredAt: unknown = one.declaredAt;
        const declaredUtc: unknown = one.declaredUtc;
        const where = `harm.grantSince[${JSON.stringify(id)}][${JSON.stringify(perKeys[j])}]`;
        if (typeof at !== "number" || !Number.isFinite(at) || !usableName(utc)) {
          throw new HarmMalformed(`${where} must carry a finite ms \`at\` and its non-empty \`utc\` spelling.`);
        }
        if (typeof declaredAt !== "number" || !Number.isFinite(declaredAt) || !usableName(declaredUtc)) {
          throw new HarmMalformed(`${where} must carry a finite ms \`declaredAt\` and its non-empty \`declaredUtc\` spelling.`);
        }
        // S216-2 · THE MAX IS A MAX: the effective since is never earlier than the declared one.
        if (at < declaredAt) {
          throw new HarmMalformed(`${where} carries an effective since earlier than its declared since: the grant memory only ever moves a since later.`);
        }
        // S216-2 · THE PRINT IS THE NUMBER: each spelling is the canonical spelling of its instant.
        if (civilUtc(at) !== utc || civilUtc(declaredAt) !== declaredUtc) {
          throw new HarmMalformed(`${where} carries a since spelling that is not the canonical UTC spelling of its number.`);
        }
        m.set(perKeys[j], Object.freeze({ at, utc: utc as string, declaredAt, declaredUtc: declaredUtc as string }));
      }
      for (let j = 0; j < listed.length; j++) {
        if (!m.has(listed[j])) {
          throw new HarmMalformed(`the grant of ${JSON.stringify(listed[j])} on ${JSON.stringify(id)} carries no since: a grant with no instant would count backwards over every record.`);
        }
      }
      grantSince.set(id, m);
    }
    // S216-2 · the grant memory's tag and state (GM5), exact keys; the words are this reader's.
    const gm = objectOf(h.grantMemory, "harm.grantMemory");
    exactKeysOf(gm, GRANT_MEMORY_KEYS, "harm.grantMemory");
    const tag: unknown = gm.tag;
    const state: unknown = gm.state;
    if (typeof tag !== "string" || !tag.startsWith(GRANT_MEMORY_TAG_PREFIX) || !lowerHexOf(tag.slice(GRANT_MEMORY_TAG_PREFIX.length), HARM_CLASS_HEX_LENGTH)) {
      throw new HarmMalformed(`harm.grantMemory.tag must be "${GRANT_MEMORY_TAG_PREFIX}" followed by ${HARM_CLASS_HEX_LENGTH} lower-case hex digits.`);
    }
    if (typeof state !== "string" || !GRANT_MEMORY_STATES.includes(state)) {
      throw new HarmMalformed(`harm.grantMemory.state must be one of ${GRANT_MEMORY_STATES.join(", ")}.`);
    }
    const grantMemoryLine = `GRANT MEMORY ${tag} (${GRANT_MEMORY_STATE_WORDS[state as Gate2GrantMemoryState]}).`;
    // S208-2 · errand grants: each names a declared origin and declared items, with a window that is not empty.
    const sinceOf = (v: unknown, name: string): Gate2ErrandInstant => {
      const o = objectOf(v, name);
      exactKeysOf(o, ERRAND_INSTANT_KEYS, name);
      if (typeof o.at !== "number" || !Number.isFinite(o.at) || !usableName(o.utc)) throw new HarmMalformed(`${name} must carry a finite ms \`at\` and its \`utc\` spelling.`);
      // relay-3 pre-ship ruling (2, F3) · THE PRINT IS THE NUMBER, for errand edges too: the same canonical spelling
      // S216-2 requires of a since (civilUtc), so the window printed on the grant line is the window compared.
      if (civilUtc(o.at as number) !== o.utc) throw new HarmMalformed(`${name} carries a utc spelling that is not the canonical UTC spelling of its number.`);
      return Object.freeze({ at: o.at as number, utc: o.utc as string });
    };
    const rawErrands = listOf(h.errandGrants, "harm.errandGrants");
    const errandGrants: Gate2ErrandGrant[] = [];
    for (let i = 0; i < rawErrands.length; i++) {
      const e = objectOf(rawErrands[i], `harm.errandGrants[${i}]`);
      exactKeysOf(e, ERRAND_KEYS, `harm.errandGrants[${i}]`);
      if (!usableName(e.errandId)) throw new HarmMalformed(`harm.errandGrants[${i}].errandId must be a non-empty string.`);
      if (!origins.some((o) => o.id === e.origin)) throw new HarmMalformed(`harm.errandGrants[${i}].origin is not a declared origin.`);
      const its = namesOf(e.items, `harm.errandGrants[${i}].items`, false);
      for (let j = 0; j < its.length; j++) {
        if (!items.some((it) => it.id === its[j])) throw new HarmMalformed(`harm.errandGrants[${i}] names ${JSON.stringify(its[j])}, which is not a declared item.`);
      }
      const from = sinceOf(e.from, `harm.errandGrants[${i}].from`);
      const until = sinceOf(e.until, `harm.errandGrants[${i}].until`);
      if (!(until.at > from.at)) throw new HarmMalformed(`harm.errandGrants[${i}] has an empty window (until is not after from).`);
      // AA2 · the granting record's seq and peerUid, printed on the grant line: a positive and a non-negative integer.
      if (typeof e.seq !== "number" || !Number.isSafeInteger(e.seq) || e.seq < 1) throw new HarmMalformed(`harm.errandGrants[${i}].seq must be the granting record's subjectSeq, a positive integer.`);
      if (typeof e.peerUid !== "number" || !Number.isSafeInteger(e.peerUid) || e.peerUid < 0) throw new HarmMalformed(`harm.errandGrants[${i}].peerUid must be the uid that posted the granting record, a non-negative integer.`);
      if (errandGrants.some((g) => g.errandId === e.errandId)) throw new HarmMalformed(`harm.errandGrants repeats the errand ${JSON.stringify(e.errandId)}.`);
      errandGrants.push(Object.freeze({ errandId: e.errandId as string, origin: e.origin as string, items: Object.freeze(its), from, until, seq: e.seq as number, peerUid: e.peerUid as number }));
    }
    const rawClearances = listOf(h.clearances, "harm.clearances");
    const clearances: string[] = [];
    for (let i = 0; i < rawClearances.length; i++) {
      const v: unknown = rawClearances[i];
      if (!lowerHexOf(v, RECORD_HASH_HEX_LENGTH)) {
        throw new HarmMalformed(`harm.clearances[${i}] is not a ${RECORD_HASH_HEX_LENGTH}-hex witness record hash.`);
      }
      if (clearances.includes(v as string)) throw new HarmMalformed(`harm.clearances repeats a record.`);
      clearances.push(v as string);
    }
    const saltEpochSince = instantOrNull(h.saltEpochSince, "harm.saltEpochSince");
    if (saltEpochSince !== null) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].fingerprint === null) {
          throw new HarmMalformed(
            `the item ${JSON.stringify(items[i].id)} carries no fingerprint while the bridge holds a salt epoch: it could never be matched, and would read off-basket.`
          );
        }
      }
    }
    const bookBoundaryAt = instantOrNull(c.bookBoundaryAt, "bookBoundaryAt");
    const decidingRaw: unknown = c.decidingActionId;
    if (decidingRaw !== undefined && decidingRaw !== null && !usableName(decidingRaw)) {
      throw new HarmMalformed("decidingActionId must be a non-empty string or null.");
    }
    const underivedRaw: unknown = c.underivedWord;
    if (underivedRaw !== undefined && underivedRaw !== null && !usableName(underivedRaw)) {
      throw new HarmMalformed("underivedWord must be a non-empty string or null.");
    }
    const predecessors: MicaReadableLog[] = [];
    if (c.predecessors !== undefined) {
      const raw = listOf(c.predecessors, "predecessors");
      for (let i = 0; i < raw.length; i++) {
        if (!isLog(raw[i])) throw new HarmMalformed(`predecessors[${i}] is not a readable log.`);
        predecessors.push(raw[i] as MicaReadableLog);
      }
    }
    return {
      fault: null,
      snap: {
        harmClass,
        origins,
        items,
        grants,
        grantSince,
        grantMemoryLine,
        errandGrants,
        clearances,
        saltEpochSince,
        states: c.readableLoadStates as readonly string[] | undefined,
        rawRoster: c.roster,
        decidingActionId: decidingRaw === undefined || decidingRaw === null ? null : (decidingRaw as string),
        predecessors,
        bookBoundaryAt,
        underivedWord: underivedRaw === undefined || underivedRaw === null ? null : (underivedRaw as string),
      },
    };
  } catch (error) {
    if (error instanceof HarmMalformed || error instanceof BasketMalformed) {
      return { fault: { code: "G2_HARM_MALFORMED", detail: `The harm basket is malformed: ${error.message}` }, snap: null };
    }
    throw error;
  }
}

/** One witness record, as the harm branch reads it. */
interface HarmRec {
  readonly book: string;
  readonly moduleId: string;
  readonly current: boolean;
  readonly seq: number;
  readonly subjectSeq: number | null;
  readonly actionId: string | null;
  readonly eventType: string;
  readonly category: string;
  readonly fate: string;
  /** The WITNESS'S OWN facet (witnessed.observed). */
  readonly observed: string;
  /** The facet this reader reads: the witness's, unless re-derived from the book's own looks (evasion 6.a/6.d). */
  readonly facet: string;
  /** True when `facet` was re-derived from the book's looks and differs from `observed`. */
  readonly rederived: boolean;
  readonly hash: string | null;
  /** The record's own `timestamp` (ms), the instant a grant's `since` is compared with (S216); null = none. */
  readonly at: number | null;
  readonly item: ItemSnap | null;
  /** null = UNRESOLVED: the record's moduleId is no declared origin's subject. */
  readonly origin: OriginSnap | null;
  readonly differs: boolean;
  readonly granted: boolean;
  readonly cleared: boolean;
  /** The origin is in the item's grant list, but this record (or its change window) is earlier than the grant's `since` (S216). */
  readonly beforeSince: boolean;
  /** S216 · the record is after the since, but its change window starts before it (or cannot be placed): not granted. */
  readonly straddlesSince: boolean;
  /** S208-2 · the ONE errand that granted this record, or null (none, or more than one: ambiguous reads as none). */
  readonly byErrand: Gate2ErrandGrant | null;
  /** S208-2 · how many errands cover this record's item and time (2+ is ambiguous and grants nothing). */
  readonly errandsCovering: number;
  /** item ∧ differs ∧ origin resolved ∧ ¬granted — whatever the fate (W-H, F-11); granted = listed ∧ at ≥ since (S216). */
  readonly damage: boolean;
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** The book's records in its own order, read by index (as `scan`), with the boundary instant if position 0 is one. */
function bookOf(log: MicaReadableLog): { readonly records: readonly Record<string, unknown>[]; readonly boundaryAt: number | null } {
  const records: unknown = log.getAll();
  if (!Array.isArray(records)) {
    throw new TypeError("getAll() did not return a list; an unbounded iterable would never finish reading.");
  }
  const total: unknown = (records as unknown[]).length;
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) {
    throw new TypeError("getAll()'s result does not carry a usable length; a list is read by index or not at all.");
  }
  const out: Record<string, unknown>[] = [];
  for (let r = 0; r < (total as number); r++) {
    const record: unknown = (records as unknown[])[r];
    if (record === null || typeof record !== "object") throw new TypeError(`record ${r} is not an object.`);
    out.push(record as Record<string, unknown>);
  }
  let boundaryAt: number | null = null;
  if (out.length > 0 && out[0].recordType === BOUNDARY_RECORD_TYPE) {
    const at: unknown = out[0].timestamp;
    boundaryAt = typeof at === "number" && Number.isFinite(at) ? at : null;
  }
  return { records: out, boundaryAt };
}

/** The keys of a look the book carries (seeing.ts PublicLook), as this reader compares them. */
export interface Gate2BookLook {
  readonly state: string;
  readonly type: string | null;
  readonly meta: string | null;
  readonly times: string | null;
  readonly size: string | null;
  readonly content: string | null;
  readonly contentBasis: string | null;
}

function nullableText(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

/** The record's look, or null when the record carries none this reader can compare. */
function bookLookOf(raw: unknown): Gate2BookLook | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const l = raw as Record<string, unknown>;
  if (typeof l.state !== "string") return null;
  if (!nullableText(l.type) || !nullableText(l.meta) || !nullableText(l.times) || !nullableText(l.size)) return null;
  if (!nullableText(l.content) || !nullableText(l.contentBasis)) return null;
  return { state: l.state, type: l.type, meta: l.meta, times: l.times, size: l.size, content: l.content, contentBasis: l.contentBasis };
}

function contentVerified(l: Gate2BookLook): boolean {
  return l.contentBasis === "DIGESTED" || l.contentBasis === "NOT_APPLICABLE";
}

/**
 * THE WITNESS'S PUBLISHED FACET RULE, REPLICATED (seeing.ts classifyFacet over two looks the book carries). The
 * reader may not import the witness (the closure ruling: src/mica takes no dependency out of itself), so the rule is
 * restated here and CROSS-CHECKED against seeing.ts's own function by an arm outside the core (glue.test.ts).
 */
export function gate2LookFacet(last: Gate2BookLook | null, now: Gate2BookLook): string {
  if (now.state === "UNOBSERVABLE") return "UNOBSERVABLE";
  if (last === null) return "FIRST_SEEN";
  if (last.state === "UNOBSERVABLE") return "UNOBSERVABLE";
  if ((last.state === "ABSENT") !== (now.state === "ABSENT")) return "EXISTENCE_DIFFERS";
  if (last.state === "ABSENT") return "SAME";
  if (last.type !== now.type) return "TYPE_DIFFERS";
  const metaDiffers = last.meta !== now.meta || last.times !== now.times;
  if (contentVerified(last) && contentVerified(now)) {
    if (last.content !== now.content) return "CONTENT_DIFFERS";
    return metaDiffers ? "META_DIFFERS" : "SAME";
  }
  if (last.type === "file" && last.size !== now.size) return "CONTENT_DIFFERS";
  if (metaDiffers) return "META_DIFFERS";
  return "UNOBSERVABLE";
}

function recordsOf(
  book: readonly Record<string, unknown>[],
  name: string,
  current: boolean,
  h: HarmSnap,
  itemsReadable: boolean
): HarmRec[] {
  const out: HarmRec[] = [];
  // EVASION 6.a / 6.d · RE-DERIVED ACROSS THE BOOK. The witness keeps a FAILED look as its last look and forgets past
  // its caps, so its own facet can read UNOBSERVABLE or FIRST_SEEN over a change. Per fingerprint, in book order, each
  // SUCCESSFUL look is compared with the previous successful look of the same fingerprint IN THIS BOOK ONLY (a
  // predecessor's tokens are under a key the book cannot show to be the same, so books are never compared across).
  const lastGood = new Map<string, Gate2BookLook>();
  // S216 (cold refuter, evasion/bytes) · WHERE A DIFFERS'S CHANGE WINDOW STARTS: the instant of the previous successful
  // look at the same fingerprint in this book. A grant (since) or an errand (from) may only cover a change whose window
  // starts at or after it — a change made before the grant and first seen after it is NOT granted (no laundering).
  const lastGoodAt = new Map<string, number>();
  for (let r = 0; r < book.length; r++) {
    const record = book[r];
    const eventType: unknown = record.eventType;
    const witnessed: unknown = record.witnessed;
    if (typeof eventType !== "string" || !eventType.startsWith(CONSEQUENCE_PREFIX)) continue;
    if (witnessed === null || typeof witnessed !== "object" || Array.isArray(witnessed)) continue;
    const seq: unknown = record.sequenceNumber;
    const moduleId: unknown = record.moduleId;
    if (typeof seq !== "number" || !Number.isFinite(seq)) throw new TypeError(`record ${r} carries no finite sequenceNumber.`);
    if (typeof moduleId !== "string") throw new TypeError(`record ${r} carries no string moduleId.`);
    const w = witnessed as Record<string, unknown>;
    const citesRaw: unknown = w.cites;
    const cites = citesRaw !== null && typeof citesRaw === "object" ? (citesRaw as Record<string, unknown>) : {};
    const fp: unknown = cites.targetFingerprint;
    const subjectSeq: unknown = cites.subjectSeq;
    const outcome = textOr(record.outcome, "");
    const sep = outcome.lastIndexOf(":");
    const observed = textOr(w.observed, "(no facet)");
    const fate = textOr(w.fate, "(no fate)");
    const hash: unknown = record.hash;
    let item: ItemSnap | null = null;
    if (itemsReadable && typeof fp === "string") {
      for (let i = 0; i < h.items.length; i++) {
        if (h.items[i].fingerprint !== null && h.items[i].fingerprint === fp) item = h.items[i];
      }
    }
    let origin: OriginSnap | null = null;
    for (let i = 0; i < h.origins.length; i++) if (h.origins[i].subject === moduleId) origin = h.origins[i];
    const look = bookLookOf(w.look);
    const tsRaw: unknown = record.timestamp;
    const at = typeof tsRaw === "number" && Number.isFinite(tsRaw) ? tsRaw : null;
    // The window start: this book's previous successful look on the fingerprint, else the witness's own priorLookAt.
    const witnessPrior: unknown = w.priorLookAt;
    const bookPrior = typeof fp === "string" ? lastGoodAt.get(fp) : undefined;
    const windowStart = bookPrior !== undefined ? bookPrior : typeof witnessPrior === "number" && Number.isFinite(witnessPrior) ? witnessPrior : null;
    let facet = observed;
    if (typeof fp === "string" && look !== null && look.state !== "UNOBSERVABLE") {
      const prior = lastGood.get(fp);
      if (prior !== undefined && !DIFFERS_FACETS.includes(observed)) {
        const derived = gate2LookFacet(prior, look);
        // A re-derived DIFFERS counts exactly like an observed one; a FIRST_SEEN or UNOBSERVABLE with an earlier
        // successful look in the book is read from that look, never as "no earlier look". The witness's own facet is
        // never lowered: an observed DIFFERS stays.
        if (DIFFERS_FACETS.includes(derived) || observed === "FIRST_SEEN" || observed === "UNOBSERVABLE") facet = derived;
      }
      lastGood.set(fp, look);
      if (at !== null) lastGoodAt.set(fp, at);
    }
    const differs = DIFFERS_FACETS.includes(facet);
    // S216 · A GRANT COUNTS FROM ITS SINCE. Listed is not enough: the record's own timestamp must be at or after the
    // instant the grant was declared to count from, so a grant widened later never re-labels an earlier change.
    // A record with no usable timestamp cannot be placed after a since and is never granted.
    const listed = item !== null && origin !== null && (h.grants.get(item.id) ?? []).includes(origin.id);
    const since = listed ? h.grantSince.get((item as ItemSnap).id)?.get((origin as OriginSnap).id) : undefined;
    // A DIFFERS's window must also START at or after the since; a record that is not a DIFFERS carries no change.
    const windowAfterSince = !differs || (windowStart !== null && since !== undefined && windowStart >= since.at);
    const grantedStatic = listed && at !== null && since !== undefined && at >= since.at && windowAfterSince;
    // S208-2 · AN ERRAND PERMITS A WINDOW, NOT AN ACT: a record is covered when its origin and item are the errand's,
    // its own timestamp lies in [from, until) AND, for a DIFFERS, its change window starts at or after from (no
    // laundering of a change made before the errand). Exactly one covering errand grants; two or more grant nothing.
    let covering: Gate2ErrandGrant | null = null;
    let errandsCovering = 0;
    if (item !== null && origin !== null && at !== null) {
      for (let k = 0; k < h.errandGrants.length; k++) {
        const g = h.errandGrants[k];
        const windowInErrand = !differs || (windowStart !== null && windowStart >= g.from.at);
        if (g.origin === origin.id && g.items.includes(item.id) && at >= g.from.at && at < g.until.at && windowInErrand) {
          errandsCovering++;
          covering = g;
        }
      }
    }
    const byErrand = errandsCovering === 1 ? covering : null;
    const granted = grantedStatic || byErrand !== null;
    const cleared = typeof hash === "string" && h.clearances.includes(hash);
    out.push({
      book: name,
      moduleId,
      current,
      seq,
      subjectSeq: typeof subjectSeq === "number" && Number.isSafeInteger(subjectSeq) ? subjectSeq : null,
      actionId: typeof record.actionId === "string" ? record.actionId : null,
      eventType,
      category: sep > 0 ? outcome.slice(0, sep) : "(none)",
      fate,
      observed,
      facet,
      rederived: facet !== observed,
      hash: typeof hash === "string" ? hash : null,
      at,
      item,
      origin,
      differs,
      granted,
      beforeSince: listed && !granted,
      straddlesSince: listed && at !== null && since !== undefined && at >= since.at && !windowAfterSince,
      byErrand: grantedStatic ? null : byErrand,
      errandsCovering,
      cleared,
      damage: item !== null && differs && origin !== null && !granted,
    });
  }
  return out;
}

interface PredecessorRead {
  readonly name: string;
  /** "READ" — its records join the latch; otherwise why they do not. */
  readonly state: "READ" | "NOT_READABLE" | "BEFORE_EPOCH";
  readonly records: number;
  readonly detail: string;
}

function predecessorName(log: MicaReadableLog, index: number): string {
  const path: unknown = (log as unknown as { sourcePath?: unknown }).sourcePath;
  if (typeof path === "string" && path.length > 0) {
    const parts = path.split("/");
    return parts[parts.length - 1];
  }
  return `predecessor book #${index + 1}`;
}

function rosterOf(raw: unknown): { readonly roster: readonly Gate2RosterEntry[] | null; readonly why: string } {
  if (raw === undefined || raw === null) return { roster: null, why: "no roster was supplied (the interest book is absent or unreadable)" };
  if (!Array.isArray(raw)) return { roster: null, why: "the roster is not a list" };
  const list = listOf(raw, "roster");
  const out: Gate2RosterEntry[] = [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e === null || typeof e !== "object") return { roster: null, why: `roster[${i}] is not an object` };
    const o = e as Record<string, unknown>;
    const subjectSeq: unknown = o.subjectSeq;
    const actionId: unknown = o.actionId;
    const label: unknown = o.label;
    const at: unknown = o.timestamp;
    if (typeof subjectSeq !== "number" || !Number.isSafeInteger(subjectSeq) || subjectSeq < 0) return { roster: null, why: `roster[${i}].subjectSeq is not a non-negative integer` };
    if (typeof actionId !== "string" || typeof label !== "string") return { roster: null, why: `roster[${i}] lacks a string actionId or label` };
    if (typeof at !== "number" || !Number.isFinite(at)) return { roster: null, why: `roster[${i}] carries no finite instant` };
    out.push(Object.freeze({ subjectSeq, actionId, label, timestamp: at }));
  }
  return { roster: out, why: "" };
}

function hash16(hash: string | null): string {
  return hash === null ? "(no hash)" : hash.slice(0, PRINTED_HASH_PREFIX_LENGTH);
}

/** The facet this reader read, and when it is re-derived, what the witness's own facet said. */
function facetText(r: HarmRec): string {
  return r.rederived ? `${r.facet} (re-derived from the book's looks; the witness's own facet read ${r.observed})` : r.facet;
}

function recordName(r: HarmRec): string {
  return (
    `${r.current ? "the current book" : `the predecessor book ${r.book}`} seq ${r.seq} (its act: subjectSeq ` +
    `${r.subjectSeq === null ? "(none cited)" : r.subjectSeq}, actionId ${r.actionId === null ? "(none)" : JSON.stringify(r.actionId)}; ` +
    `fate ${r.fate}; observed ${facetText(r)}; item ${r.item === null ? "(none)" : r.item.id}; ` +
    `origin ${r.origin === null ? "UNRESOLVED" : r.origin.id})`
  );
}

/** Per fate, in plain words (contract M2 step 5). */
function fateWords(r: HarmRec): string {
  if (r.fate === HELD_FATE) {
    return "HELD: the act whose record shows the change did not execute (its own decision held it); the item changed between looks, by some writer.";
  }
  if (r.fate.startsWith(LATE_FATE_PREFIX)) {
    const how =
      r.fate === "LATE_UNGUARDED"
        ? "the act whose record shows the change ran unguarded (no /guard answer)"
        : r.fate === "LATE_NO_DECISION"
          ? "the act whose record shows the change closed, but its decision was not known to the witness"
          : "no close of the act whose record shows the change reached the witness; whether and when that act ran is unknown";
    return (
      `${r.fate} (LATE): ${how}; the item differed between two of the witness's looks; nothing on the record says the ` +
      "act whose decision carries it caused it."
    );
  }
  return (
    `${r.fate}: the item differed between the witness's previous look and its look at that act's close; nothing on ` +
    "the record says the act whose decision carries it caused it."
  );
}

function noCarriedLine(why: string): string {
  return `HARM READING: no carried act was read — ${why}.`;
}

/**
 * S216-2 · a since as printed: its UTC spelling, and — only where the bridge's grant memory holds it later than the
 * deployer's declared since — both, so the print shows the number the verdict compared and the one declared.
 */
function sinceWords(since: Gate2GrantSince | undefined): string {
  if (since === undefined) return "(no since)";
  if (since.at === since.declaredAt) return since.utc;
  return (
    `${since.utc} (held by the bridge's grant memory: the later of its first sight of the grant and the highest since ` +
    `it carried for it; declared ${since.declaredUtc})`
  );
}

function grantText(r: HarmRec, h: HarmSnap): string {
  if (r.item === null) return "not applicable (off-basket)";
  if (r.origin === null) return "not readable (origin UNRESOLVED)";
  const sinceText = sinceWords(h.grantSince.get(r.item.id)?.get(r.origin.id));
  if (r.granted && r.byErrand !== null) {
    return `GRANTED BY ERRAND ${r.byErrand.errandId} (operator-role record seq ${String(r.byErrand.seq)}, peerUid ${String(r.byErrand.peerUid)}; ${r.origin.id} may change ${r.item.id} from ${r.byErrand.from.utc} until ${r.byErrand.until.utc})`;
  }
  if (r.granted) return `GRANTED (${r.origin.id} may change ${r.item.id} since ${sinceText})`;
  if (r.errandsCovering > 1) {
    return `NONE (${String(r.errandsCovering)} errands cover ${r.item.id} at this record's time; an ambiguous errand grant grants nothing)`;
  }
  if (r.straddlesSince) {
    return `NONE (${r.origin.id} is granted ${r.item.id} only since ${sinceText}; the change may predate it — the previous look at ${r.item.id} was before it, or is not on the record)`;
  }
  if (r.beforeSince) {
    return `NONE (${r.origin.id} is granted ${r.item.id} only since ${sinceText}; this record is earlier${r.at === null ? " or carries no timestamp" : ""})`;
  }
  return `NONE (${r.origin.id} holds no grant for ${r.item.id}; the grant list is [${(h.grants.get(r.item.id) ?? []).join(", ")}])`;
}

function recordFacts(r: HarmRec, h: HarmSnap): string {
  return (
    `item ${r.item === null ? "(none: off-basket)" : r.item.id}; origin ${r.origin === null ? "UNRESOLVED" : r.origin.id}; ` +
    `grant ${grantText(r, h)}; facet ${facetText(r)}; fate ${r.fate}`
  );
}

function carriedLine(c: Gate2RosterEntry, rec: HarmRec | null, h: HarmSnap): string {
  const act = `the carried act subjectSeq ${c.subjectSeq}, actionId ${JSON.stringify(c.actionId)}`;
  return rec === null
    ? `HARM READING: ${act}, label ${JSON.stringify(c.label)}: no record on the book, so its item, origin, grant, facet and fate are not readable.`
    : `HARM READING: ${act}; ${recordFacts(rec, h)}.`;
}

function alarmLine(r: HarmRec, h: HarmSnap, deciding: string): string {
  return (
    `HARM READING: ALARM — the act whose record shows the change: subjectSeq ${r.subjectSeq === null ? "(none cited)" : r.subjectSeq}, ` +
    `actionId ${r.actionId === null ? "(none)" : JSON.stringify(r.actionId)}; ${recordFacts(r, h)}; the act whose decision carries it: ${deciding}.`
  );
}

/** M3 · every way a standing latch ends, named truthfully. */
const HARM_LATCH_EXITS =
  "The latch is re-derived from the books at every read; nothing persisted holds it but the bridge's grant memory, " +
  "which only moves a since later. It ends when: the doctor's clearance names this record's hash; " +
  // relay-3 pre-ship ruling (1a), WORD FOR WORD: the errand exit (T35), with its guard and what opens it.
  "an errand grant whose window covers the record ends its latch without a clearance; the bridge refuses an errand " +
  "whose `from` is earlier than the newest record it has seen, so only a clock step or a bridge run outside its unit " +
  "opens this exit; a later declaration " +
  "removes the item (a restart takes it; a reload refuses it, H11) — a grant counts only from the latest of its " +
  "declared since, the bridge's grant memory's first sight of it and the highest since that memory carried for it, so " +
  "neither a grant widened with a later since (S216) nor a since back-dated across a restart ends it, unless root " +
  "forges or replaces that memory or runs a bridge that does not keep it; a later declaration removes or re-binds the " +
  "origin, or moves the book, across a restart (a reload refuses these, H11; the origin then reads NOT READABLE or " +
  "the record is no longer on the book read); the bridge's salt epoch is lost, or begins after the book's " +
  "boundary (→ MEMBERSHIP NOT READABLE, never SILENT); or, for a latch standing only in a predecessor book, that " +
  "book becomes unreadable (→ PREDECESSOR NOT READABLE, never SILENT).";

const HARM_ALWAYS =
  "A change by ANY writer between two looks — the deployer's own edit included — is billed to the bound origin. " +
  "The first look at an item cannot alarm. Origin names the principal the bridge binds the act to, never the human " +
  "or errand behind it.";

interface HarmRecorderInput {
  readonly h: HarmSnap;
  readonly current: readonly HarmRec[];
  readonly itemsReadable: boolean;
  readonly predecessors: readonly PredecessorRead[];
  readonly since: readonly Gate2RosterEntry[] | null;
  readonly rosterWhy: string;
}

function countInto(m: Map<string, number>, key: string): void {
  m.set(key, (m.get(key) ?? 0) + 1);
}

function mapText(m: ReadonlyMap<string, number>): string {
  const keys: string[] = [];
  m.forEach((_v, k) => keys.push(k));
  keys.sort();
  return keys.length === 0 ? "(none)" : keys.map((k) => `${k}=${m.get(k) ?? 0}`).join(" ");
}

/** Step 7 — THE RECORDER, printed on every verdict of this branch (on SILENT as facts beside it, F-E). */
function harmRecorder(x: HarmRecorderInput): string {
  const perClass = new Map<string, number>();
  const facetCat = new Map<string, number>();
  let onItems = 0;
  let unknownOnItems = 0;
  let rederived = 0;
  for (let i = 0; i < x.current.length; i++) {
    const r = x.current[i];
    if (r.rederived) rederived++;
    countInto(perClass, r.eventType);
    countInto(facetCat, `${r.observed}×${r.category}`);
    if (r.item !== null) {
      onItems++;
      if (!r.differs && (r.facet === "UNOBSERVABLE" || r.fate !== RAN_FATE || !QUIET_FACETS.includes(r.facet))) unknownOnItems++;
    }
  }
  let roster: string;
  if (x.since === null) {
    roster = `ROSTER: not readable — ${x.rosterWhy}.`;
  } else {
    let withRecord = 0;
    let underived = 0;
    let other = 0;
    for (let i = 0; i < x.since.length; i++) {
      const e = x.since[i];
      if (x.current.some((r) => r.subjectSeq === e.subjectSeq && r.actionId === e.actionId)) withRecord++;
      else if (x.h.underivedWord !== null && e.label === x.h.underivedWord) underived++;
      else other++;
    }
    roster =
      `ROSTER (the interest book; acts since the book's boundary): ${x.since.length} act(s), ${withRecord} with a ` +
      `record, ${underived + other} without (` +
      (x.h.underivedWord === null
        ? `no underived word declared, so none is told apart: ${other}`
        : `underived (${JSON.stringify(x.h.underivedWord)}) ${underived}; other — pending or lost — ${other}`) +
      ").";
  }
  const preds =
    x.predecessors.length === 0
      ? "none handed to this reader — a successor book that declares no predecessor is not verified to have none"
      : x.predecessors.map((p) => `${p.name} (${p.state === "READ" ? `${p.records} record(s), latch only` : p.detail})`).join("; ");
  return (
    `RECORDER (the current book only): method class(es) ${mapText(perClass)}; n by facet×category ${mapText(facetCat)}; ` +
    `records on items ${x.itemsReadable ? String(onItems) : "NOT READ (membership)"}; unknowns on items in the window ` +
    `${x.itemsReadable ? String(unknownOnItems) : "NOT READ (membership)"}; facets re-derived from the book's own looks ` +
    `(per book, never across books) where the witness's own facet read otherwise: ${String(rederived)}. ${roster} PREDECESSOR BOOKS (named, NEVER ` +
    `summed into these counts): ${preds}. Items ${x.h.items.length}, origins ${x.h.origins.length}, clearances ` +
    `${x.h.clearances.length}.`
  );
}

function harmBlind(
  code: Gate2DirectionBlindReasonCode,
  paths: readonly BlindPath[],
  h: HarmSnap | null,
  body: string,
  notReadable: string | null,
  line: string = noCarriedLine(CANNOT_READ_OBJECT[code])
): Gate2DirectionReading {
  const base = cannotAssess(GATE2_DIRECTION_SENSOR_ID, paths);
  const head = notReadable === null ? "" : `NOT READABLE: ${notReadable}. `;
  return {
    verdict: {
      kind: base.kind,
      sensorId: base.sensorId,
      blindPaths: base.blindPaths,
      summary:
        `${head}${base.summary} I cannot read this — ${CANNOT_READ_OBJECT[code]}. Blind reason code: ${code}. ` +
        `${h === null ? `Harm basket: not printed (no validated harm basket on this path). ${GRANT_MEMORY_NOT_PRINTED}` : `Harm basket: ${h.harmClass}. ${h.grantMemoryLine}`} ` +
        `${line} ${body} ${GATE2_HARM_CEILINGS}`,
    },
    code,
    latchedSince: null,
    harmLine: line,
    grantMemoryLine: h === null ? GRANT_MEMORY_NOT_PRINTED : h.grantMemoryLine,
  };
}

function harmThrew(error: unknown): Gate2DirectionReading {
  let detail: string;
  try {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    detail =
      `This reader THREW while reading, which is not a reading: ${text}. A floor instrument that ` +
      "raises an exception has not looked, and its caller cannot tell that from a crash of its own — " +
      "so the throw is reported as blindness with the error text attached.";
  } catch {
    detail = GATE2_THREW_UNRENDERED;
  }
  return harmBlind("G2_READER_THREW", [{ class: "MISSING_CONFIGURATION", detail }], null, "The book was not read.", null);
}

function harmSilent(h: HarmSnap, scope: string, recorder: string, line: string): Gate2DirectionReading {
  const v = silent(GATE2_DIRECTION_SENSOR_ID, scope);
  return {
    verdict: { kind: v.kind, sensorId: v.sensorId, summary: `${v.summary} Harm basket: ${h.harmClass}. ${h.grantMemoryLine} ${line} ${recorder} ${GATE2_HARM_CEILINGS}` },
    code: null,
    latchedSince: null,
    harmLine: line,
    grantMemoryLine: h.grantMemoryLine,
  };
}

function readHarm(log: MicaReadableLog, config: Gate2DirectionConfig): Gate2DirectionReading {
  // 1 · the harm basket
  const checked = harmCheck(config);
  if (checked.fault !== null) {
    return harmBlind(checked.fault.code, [{ class: "MISSING_CONFIGURATION", detail: checked.fault.detail }], null, "The book was not read.", null);
  }
  const h = checked.snap;

  // 2 · the readability gate on the book
  const unreadable = assessLogReadability(log, GATE2_DIRECTION_SENSOR_ID, h.states);
  if (unreadable !== null) {
    return harmBlind("G2_READABILITY_GATE", unreadable.blindPaths, h, "The book was not read.", null);
  }

  // 3 · membership on the current book (A-5)
  const itemsReadable =
    h.saltEpochSince !== null && h.bookBoundaryAt !== null && h.bookBoundaryAt >= h.saltEpochSince;
  const book = bookOf(log);
  const current = recordsOf(book.records, "(current)", true, h, itemsReadable);

  // the roster, read once (step 6 decides with it; the recorder prints it everywhere)
  const rosterRead = rosterOf(h.rawRoster);
  let since: Gate2RosterEntry[] | null = null;
  if (rosterRead.roster !== null && h.bookBoundaryAt !== null) {
    since = [];
    for (let i = 0; i < rosterRead.roster.length; i++) {
      const e = rosterRead.roster[i];
      if (e.timestamp >= h.bookBoundaryAt) since.push(e);
    }
  }
  const rosterWhy =
    rosterRead.roster === null ? rosterRead.why : "the book's boundary instant is unknown, so no act can be placed after it";

  // the predecessors, for the latch only
  const preds: PredecessorRead[] = [];
  const latchScope: HarmRec[] = [];
  if (itemsReadable) for (let i = 0; i < current.length; i++) latchScope.push(current[i]);
  for (let i = 0; i < h.predecessors.length; i++) {
    const p = h.predecessors[i];
    const name = predecessorName(p, i);
    const gate = assessLogReadability(p, GATE2_DIRECTION_SENSOR_ID, h.states);
    if (gate !== null) {
      preds.push({ name, state: "NOT_READABLE", records: 0, detail: `NOT READABLE: ${gate.blindPaths.map((b) => b.class).join(", ")}` });
      continue;
    }
    const pb = bookOf(p);
    if (h.saltEpochSince === null || pb.boundaryAt === null || pb.boundaryAt < h.saltEpochSince) {
      preds.push({
        name,
        state: "BEFORE_EPOCH",
        records: 0,
        detail: "its records are EXCLUDED from the latch: its boundary predates the bridge's target-salt epoch (or is unknown), so items cannot be matched there",
      });
      continue;
    }
    const recs = recordsOf(pb.records, name, false, h, true);
    for (let j = 0; j < recs.length; j++) latchScope.push(recs[j]);
    preds.push({ name, state: "READ", records: recs.length, detail: "" });
  }
  const recorder = harmRecorder({ h, current, itemsReadable, predecessors: preds, since, rosterWhy });

  if (!itemsReadable) {
    const why =
      h.saltEpochSince === null
        ? "the bridge holds no target-salt epoch, so no item carries a fingerprint the book can be matched against"
        : h.bookBoundaryAt === null
          ? "the book's boundary instant is unknown, so it cannot be placed inside the bridge's target-salt epoch"
          : "the book began before the bridge's current target-salt epoch, and its records carry no salt id: item identity is bound to that epoch";
    return harmBlind(
      "G2_MEMBERSHIP_NOT_READABLE",
      [{ class: "INELIGIBLE_SCOPE", detail: `Item membership is NOT READABLE on this book: ${why} (A-5, F-12).` }],
      h,
      recorder,
      null
    );
  }

  // 4 · 5 · the latch, re-derived from every readable book
  const damage: HarmRec[] = [];
  for (let i = 0; i < latchScope.length; i++) {
    if (latchScope[i].damage && !latchScope[i].cleared) damage.push(latchScope[i]);
  }
  if (damage.length > 0) {
    let first: HarmRec | null = null;
    for (let i = 0; i < damage.length; i++) {
      if (damage[i].current && (first === null || damage[i].seq < first.seq)) first = damage[i];
    }
    const shown = first ?? damage[0];
    const others = damage.filter((r) => r !== shown);
    const deciding = h.decidingActionId === null ? "a status read" : `the act ${JSON.stringify(h.decidingActionId)}`;
    const latchLine =
      first === null
        ? `LATCHED in predecessor ${shown.book}: no such record is on the current book; latchedSince is null.`
        : `LATCHED since seq ${first.seq} of the current book.`;
    const detail =
      `I read this and an item changed without a grant. The act whose record shows the change: ${recordName(shown)}. ` +
      `The act whose decision carries it: ${deciding}. ${fateWords(shown)} Item ${shown.item === null ? "" : shown.item.id}` +
      `${shown.item !== null && shown.item.control ? " is a declared CONTROL item: the subject cannot change it, so a DIFFERS here is another writer's change or a failure of that assumption" : ""}; ` +
      `origin ${shown.origin === null ? "" : shown.origin.id} ${shown.beforeSince ? `was not yet granted it (its grant counts from ${sinceWords(h.grantSince.get(shown.item === null ? "" : shown.item.id)?.get(shown.origin === null ? "" : shown.origin.id))})` : "holds no grant for it"}. ${latchLine} ` +
      (others.length === 0 ? "" : `Also ungranted and uncleared: ${others.map(recordName).join("; ")}. `) +
      `${HARM_LATCH_EXITS} ${HARM_ALWAYS}`;
    const line = alarmLine(shown, h, deciding);
    const v = alarm(GATE2_DIRECTION_SENSOR_ID, `${line} ${detail} ${recorder}`, [{ code: "G2_UNGRANTED_CHANGE_ON_ITEM", detail }]);
    return {
      verdict: { kind: v.kind, sensorId: v.sensorId, findings: v.findings, summary: `${v.summary} Harm basket: ${h.harmClass}. ${h.grantMemoryLine} ${GATE2_HARM_CEILINGS}` },
      code: "G2_UNGRANTED_CHANGE_ON_ITEM",
      latchedSince: first === null ? null : first.seq,
      harmLine: line,
      grantMemoryLine: h.grantMemoryLine,
    };
  }

  // no ALARM from the readable books: what could hide one is named before any SILENT
  const beforeEpoch = preds.filter((p) => p.state === "BEFORE_EPOCH");
  if (beforeEpoch.length > 0) {
    return harmBlind(
      "G2_MEMBERSHIP_NOT_READABLE",
      [{
        class: "INELIGIBLE_SCOPE",
        detail:
          `Item membership is NOT READABLE on the predecessor book(s) ${beforeEpoch.map((p) => p.name).join(", ")}: their ` +
          "boundary predates the bridge's target-salt epoch, so their records are excluded from the latch, and a latch could stand there.",
      }],
      h,
      recorder,
      null
    );
  }
  const lost = preds.filter((p) => p.state === "NOT_READABLE");
  if (lost.length > 0) {
    return harmBlind(
      "G2_PREDECESSOR_NOT_READABLE",
      [{
        class: "BROKEN_CHAIN",
        detail: `The predecessor book(s) ${lost.map((p) => `${p.name} (${p.detail})`).join(", ")} could not be read for the latch; a latch could stand there, so no SILENT is offered over them.`,
      }],
      h,
      recorder,
      null
    );
  }
  const unresolved = latchScope.filter((r) => r.item !== null && r.differs && r.origin === null && !r.cleared);
  if (unresolved.length > 0) {
    return harmBlind(
      "G2_ORIGIN_NOT_READABLE",
      [{
        class: "INELIGIBLE_SCOPE",
        detail: `A DIFFERS on an item names no declared origin: ${unresolved.map(recordName).join("; ")}. Whose change it is cannot be read, so whether it was granted cannot be either.`,
      }],
      h,
      recorder,
      null
    );
  }

  // 6 · the CARRIED act (A-1)
  if (since === null) {
    return harmBlind(
      "G2_ROSTER_NOT_READABLE",
      [{ class: "MISSING_CONFIGURATION", detail: `The act roster is not readable: ${rosterWhy}. Which act a reading serves cannot be placed.` }],
      h,
      recorder,
      null
    );
  }
  if (since.length === 0) {
    return harmBlind(
      "G2_NOT_READABLE",
      [{ class: "INSUFFICIENT_SAMPLE", detail: "No act is on the roster since the book's boundary." }],
      h,
      recorder,
      "no act is on the roster since the book's boundary, so no act is carried"
    );
  }
  let carried: Gate2RosterEntry | null = null;
  let placement: string;
  let sameId = 0;
  if (h.decidingActionId !== null && rosterRead.roster !== null) {
    for (let i = 0; i < rosterRead.roster.length; i++) if (rosterRead.roster[i].actionId === h.decidingActionId) sameId++;
  }
  if (sameId > 1) {
    return harmBlind(
      "G2_NOT_READABLE",
      [{ class: "INSUFFICIENT_SAMPLE", detail: `The deciding act's id ${JSON.stringify(h.decidingActionId)} is on the roster ${String(sameId)} times.` }],
      h,
      recorder,
      "the deciding act's id is not unique on the roster, so which act is carried cannot be placed"
    );
  }
  if (h.decidingActionId === null) {
    carried = since[since.length - 1];
    placement = "no deciding act (a status read); the newest act in the interest book's order is carried";
  } else {
    // BY THE BOOK'S APPEND ORDER, never by subjectSeq (a rotated subject chain numbers its acts from 1 again).
    let at = -1;
    for (let i = 0; i < since.length; i++) if (since[i].actionId === h.decidingActionId) at = i;
    if (at < 0) {
      carried = since[since.length - 1];
      placement = "the deciding act is not yet on the roster; the newest act in the interest book's order is carried";
    } else {
      carried = at === 0 ? null : since[at - 1];
      placement = `the deciding act ${JSON.stringify(h.decidingActionId)} is subjectSeq ${since[at].subjectSeq}; the act immediately before it in the interest book's order is carried`;
    }
  }
  if (carried === null) {
    return harmBlind(
      "G2_NOT_READABLE",
      [{ class: "INSUFFICIENT_SAMPLE", detail: `No act precedes the deciding act on the roster since the book's boundary (${placement}).` }],
      h,
      recorder,
      "no act precedes the deciding act since the book's boundary, so no act is carried"
    );
  }
  const actText = `the carried act (subjectSeq ${carried.subjectSeq}, actionId ${JSON.stringify(carried.actionId)}, label ${JSON.stringify(carried.label)}; ${placement})`;
  // m2 · THE CARRIED ACT'S RECORD is matched on (moduleId, actionId, subjectSeq) — the one origin subject's act,
  // never another subject's record that happens to carry the same subjectSeq.
  const subject = h.origins[0].subject;
  let rec: HarmRec | null = null;
  for (let i = 0; i < current.length; i++) {
    const r = current[i];
    if (r.moduleId === subject && r.actionId === carried.actionId && r.subjectSeq === carried.subjectSeq) rec = r;
  }
  const line = carriedLine(carried, rec, h);
  if (rec === null) {
    const reason =
      h.underivedWord !== null && carried.label === h.underivedWord
        ? `${actText}: its claimed target is placed in no frame category (${h.underivedWord}), so the witness was never pointed`
        : `${actText}: the witness has written no record for it (pending, or lost, or never pointed); its label is ${JSON.stringify(carried.label)}`;
    return harmBlind(
      "G2_NOT_READABLE",
      [{ class: "INSUFFICIENT_SAMPLE", detail: `NOT READABLE: ${reason}.` }],
      h,
      recorder,
      reason,
      line
    );
  }
  const scope = `the witness's book under the declared harm basket ${h.harmClass}: ${actText}, its record ${recordName(rec)}`;
  if (rec.item === null) {
    return harmSilent(h, `${scope}. The record is on no declared item (off-basket; its facet is in the recorder, with no sign)`, recorder, line);
  }
  if (rec.origin === null) {
    return harmBlind(
      "G2_ORIGIN_NOT_READABLE",
      [{ class: "INELIGIBLE_SCOPE", detail: `The carried act's record on the item ${rec.item.id} names no declared origin: ${recordName(rec)}.` }],
      h,
      recorder,
      null,
      line
    );
  }
  if (rec.differs && rec.granted) {
    return harmSilent(
      h,
      `${scope}. granted: ${rec.origin.id} on ${rec.item.id}. A change by any writer between two looks — the ` +
        "deployer's own edit included — is billed to the bound origin; here it reads as granted",
      recorder,
      line
    );
  }
  if (rec.differs && rec.cleared) {
    return harmSilent(h, `${scope}. cleared by the doctor's clearance ${hash16(rec.hash)}`, recorder, line);
  }
  if (!rec.differs && rec.fate === RAN_FATE && QUIET_FACETS.includes(rec.facet)) {
    // M5 · the ruled routing stands (FIRST_SEEN on an item is neutral → SILENT); the TEXT is the facet's own.
    const quiet =
      rec.facet === "FIRST_SEEN"
        ? "first look at this item: there is no earlier look, so whether this act changed it cannot be read; a first look cannot alarm"
        : rec.rederived
          ? `the item reads SAME at a RAN act, re-derived from the book's looks (the witness's own facet read ${rec.observed}): no change since the earlier successful look at it in this book`
          : "the item reads SAME at a RAN act: no change since the witness last looked";
    return harmSilent(h, `${scope}. ${quiet}`, recorder, line);
  }
  return harmBlind(
    "G2_UNKNOWN_ON_ITEM",
    [{
      class: "INSUFFICIENT_SAMPLE",
      detail:
        `The carried act's record on the item ${rec.item.id} does not show whether the item changed: observed ` +
        `${facetText(rec)}, fate ${rec.fate} (an UNOBSERVABLE look, or a HELD/LATE act without a DIFFERS, is an unknown, never quiet).`,
    }],
    h,
    recorder,
    null,
    line
  );
}

// ⟦HARM BRANCH END⟧ ───────────────────────────────────────────────────────────

/** Contract §1's signature: the verdict alone. */
export function assessGate2Direction(
  log: MicaReadableLog,
  config?: Gate2DirectionConfig
): SensorVerdict {
  return readGate2Direction(log, config).verdict;
}

// ── Printed scope ─────────────────────────────────────────────────────────────

export const GATE2_DIRECTION_TITLE =
  "MICA/gate2-direction — Gate 2 direction, a declared basket read as a bound at grade";

export const GATE2_DIRECTION_READS: readonly string[] = Object.freeze([
  "moduleId, eventType and outcome of each record, for membership in the",
  "  declared value, damage and unknown classes (outcome null = any), and in",
  "  the declared latch-clearing kinds",
  "sequenceNumber, as the only record axis: the scan runs in the log's own",
  "  order, the latch's onset and clearing are named by it, and the window is",
  "  printed by it",
  "the injected basket: classes with weight intervals, grades and ρ_causal;",
  "  ε; establishAt and creditAt; nMin; the frame's category ids",
  "the log's own verify() and getLoadState() — readability gate only",
]);

export const GATE2_DIRECTION_DOES_NOT_SEE: readonly string[] = Object.freeze(
  GATE2_DIRECTION_CEILING_LINES.concat([
    "TIME. No timestamp and no clock is read; the scan order is the log's.",
    "ANY OTHER BOOK. Not the frame book, not the floor trail, not a verdict of",
    "  MICA's own: the frame's category ids arrive in the basket.",
    "A TRAILING WINDOW. sinceBoundary is the only window read; a basket naming",
    "  another is refused as malformed.",
  ])
);

export const GATE2_DIRECTION_COMPETENCE_LINES: readonly string[] = Object.freeze(
  COMMON_COMPETENCE_LINES.concat([
    "That the reader reads SILENT as an absence of finding about DIRECTION over",
    "  the declared classes only, carrying no count and no margin by design.",
    "That the reader reads CANNOT_ASSESS(G2_NO_CLASS_AT_GRADE) as the record",
    "  holding no class at the grade a basket claim needs — not as a reading",
    "  awaiting more records of the same classes.",
    "That a latched ALARM stays until a declared clearing record, whatever",
    "  follows it on the record.",
  ])
);

function configStatus(config: Gate2DirectionConfig | undefined): string {
  try {
    if (harmDeclared(config)) {
      const harm = harmCheck(config as Gate2DirectionConfig);
      return harm.fault !== null
        ? `HARM BASKET: ${harm.fault.code}.`
        : `HARM BASKET: ${harm.snap.harmClass} — declared; passes the birth checks.`;
    }
    const checked = basketCheck(config);
    if (checked.fault !== null) return `BASKET: ${checked.fault.code}.`;
    const frame = frameFault(checked.basket);
    return frame === null
      ? `BASKET: ${checked.basket.basketClass} — declared; passes the birth checks.`
      : `BASKET: ${frame.code}.`;
  } catch {
    return "BASKET: the reader threw while checking it (G2_READER_THREW).";
  }
}

export function gate2DirectionScopeBlockText(
  config?: Gate2DirectionConfig
): string {
  return formatScopeBlock(
    GATE2_DIRECTION_TITLE,
    GATE2_DIRECTION_READS,
    GATE2_DIRECTION_DOES_NOT_SEE.concat([configStatus(config)]),
    GATE2_DIRECTION_COMPETENCE_LINES,
    loadStateScopeLines(config?.readableLoadStates)
  );
}

export function printGate2Direction(config?: Gate2DirectionConfig): void {
  printScopeBlock(
    GATE2_DIRECTION_TITLE,
    GATE2_DIRECTION_READS,
    GATE2_DIRECTION_DOES_NOT_SEE.concat([configStatus(config)]),
    GATE2_DIRECTION_COMPETENCE_LINES,
    loadStateScopeLines(config?.readableLoadStates)
  );
}
