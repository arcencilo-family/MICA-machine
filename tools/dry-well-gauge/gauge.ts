// ── MICA · the DRY WELL GAUGE · PURE CORE ─────────────────────────────────────
//
// WHAT THIS IS
//
//   A gauge on a well. It folds the house's own catch-record (the Corrections
//   Ledger) forward and reads one number: **have catches been arriving, and from
//   how far away?**
//
//   Rain fills the well (a catch pushes the level up). Rain from far away counts
//   for more (an external seat catching your error is real news; you catching
//   your own is you talking about yourself). Evaporation is free and constant —
//   it needs no evidence and no permission. Nobody alarms at a full well. **A dry
//   well is the only alarm.**
//
// WHAT IT IS ALLOWED TO SAY `[LB]`
//
//   It has EXACTLY ONE FINDING, and that finding is an admission of blindness
//   rather than a diagnosis:
//
//       "The book has gone quiet, and I cannot tell whether that is because
//        nothing is wrong or because nobody is looking."
//
//   THE DIRECTION, STATED SO NOBODY RE-DERIVES IT WRONG:
//     · HIGH / WET = decorrelated catches have arrived recently. RAISES NOTHING,
//       EVER. Not a health reading, not an alertness reading. There is no top
//       alarm; that bell was cut (the arbiter, S80).
//     · LOW / DRY  = the book went quiet. THE ONLY FINDING THIS GAUGE HAS.
//
//   AND THE WEIGHTS ARE NOT THE METER. `EXTERNAL: 1.0` does not mean "very
//   vigilant". It means *this single piece of evidence counts fully*. Weights
//   price evidence; the gauge tracks arrival.
//
//   Everything else it prints is a CENSUS — counts, printed, judged not. IT NEVER
//   CERTIFIES HEALTH. If a change would let it say "all is well", that change is
//   wrong regardless of how it is argued.
//
// WHAT IT READS, AND WHAT IT DOES NOT `[LB]` (the name may still overpromise)
//
//   THIS GAUGE READS THE CORRECTIONS LEDGER ONLY. It does not read the witness,
//   the notice log, or any MICA record. HIGH RAISES NOTHING; DRY IS THE ONLY
//   FINDING.
//
// THE KEYSTONE (why nothing is stored)
//
//   The gauge stores NOTHING. It is a pure function over (the append-only
//   catch-book, a position in its event stream). The level falls because
//   event-position is an argument, not because anything erodes on disk. BR≠TR by
//   construction: anyone recomputes the identical value from (book bytes + how
//   far through the stream you fold).
//
// THE EVAPORATION AXIS IS EVENT-INDEX, NOT WALL-CLOCK (the arbiter's ruling, S79)
//
//   The Ledger carries no per-entry timestamp — only a session token and one file
//   mtime. An earlier build halted on exactly that. B9, the mechanics template,
//   trends over read-index and never needed a clock. This gauge evaporates ONE
//   index-step per event. No Δt anywhere, and no `--now`.
//
// THE FENCE (what this core can never do)
//
//   Never enters f() / the floor / any gate verdict / any disposition. It is a
//   diary the observer keeps about the loop, read by humans, never a control
//   input. ONE shared gauge on the whole loop — never a per-node score. A
//   show-not-enforce view over a recorded book cannot manufacture a false
//   all-clear — that immunity is the whole reason it is allowed to exist.
//
// NAME HISTORY (recorded deliberately, so the reason is not lost)
//
//   This instrument was built as the "Vigilance-Flywheel" with bands IDLE/MIDDLE
//   and an upper bound called `redline`. The arbiter renamed it at S80. Every old name
//   proposed a function it does not have: "vigilance" names a state of alertness
//   it cannot measure; the flywheel/tachometer image put the drama at the TOP,
//   where the bell had just been cut, and left the BOTTOM — where the only
//   finding lives — unmarked; and `IDLE` was the worst of them, because in a
//   tachometer idle means "at rest, nothing wrong", while here it meant "the
//   checks stopped, and this is the only alarm we have". The label said benign at
//   the alarm. The well metaphor maps completely and its polarity cannot invert.
//
// This file is the PURE CORE: no fs, no clock, no stdout. I/O lives in the shell
// (read-gauge.ts). Everything here is unit-testable against hand vectors.

// ── NAMING · the two sentences, together, wherever the gauge names itself ─────

import { createHash } from "crypto";

export const DWG_MEASURES =
  "It measures whether catches have been arriving, and from how far away. " +
  "It never certifies health.";

/** R6: the standing limit, printed with the reading so the name cannot overpromise. */
export const DWG_READS_ONLY =
  "This gauge reads the Corrections Ledger only. It does not read the witness, " +
  "the notice log, or any MICA record. HIGH raises nothing; DRY is the only finding.";

// ── §1 · Vocabulary — dryLevel / asymptote, deliberately not floor / ceiling ──
//
// "floor" and "ceiling" are TAKEN by the composed min() floor and the substrate
// confidence ceiling; a collision there is exactly the quiet damage RULE 5 exists
// to prevent. That rule is why this module has never used them and still does not
// — see the build record for why `floorBound` was declined at the rename.
//
//   dryLevel  — the lower bound. The level a well with no inflow evaporates
//               toward and never passes. Reads directly beside the DRY band.
//   asymptote — the upper bound. The unreachable push target that makes returns
//               diminish: the numeric form of *Never 100%*. It has NO bell
//               attached; it is arithmetic, not an alarm.

export type Tier = "EXTERNAL" | "CROSS_INSTANCE" | "RITUAL" | "SELF";

export interface TierWeights {
  readonly EXTERNAL: number;
  readonly CROSS_INSTANCE: number;
  readonly RITUAL: number;
  readonly SELF: number;
}

export interface Calibration {
  /** The lower bound; a well with no inflow evaporates toward it. dryLevel > 0. */
  readonly dryLevel: number;
  /** Upper bound; unreachable; Never 100% in numeric form. asymptote < 1. */
  readonly asymptote: number;
  /** Inflow gain — fraction of the gap-to-asymptote closed per full-weight catch. */
  readonly alpha: number;
  /** Per-event retention factor, 0 < d < 1. One index-step of evaporation per event. */
  readonly d: number;
  /** §5B: consecutive uncredited (zero-weight) events before the DRY finding fires. */
  readonly dryWindow: number;
  /** §5A: minimum qualifying events before the gauge reads at all (young book). */
  readonly minEvents: number;
  /** §5B level backstop: S within this of dryLevel also counts as dry. */
  readonly dryEpsilon: number;
  /** Decorrelation weight per tier. Proxies, pilot-calibrated. */
  readonly weights: TierWeights;
  /** Provenance string — printed on every reading. NOT a default. */
  readonly provenance: string;
}

// ── §2 · The proxy calibration — PRINTED AS PROXY, never a silent default ─────
//
// Mirrors B9's B9_PROXY_CALIBRATION exactly in spirit: a named, exported constant
// whose `provenance` says these are STARTING values, subject to pilot calibration,
// and that NOTHING consults it as a default. The pure fold takes calibration as a
// REQUIRED argument and reports its absence (MISSING_CONFIGURATION) — it never
// reaches for this constant itself. The SHELL injects it explicitly and prints the
// provenance, so a reader never mistakes a proxy for a finding.
//
// DEVIATION from the original brief §3 (surfaced, not silent): that brief's
// calibration block listed dryLevel/asymptote/alpha/d/dryWindow only, but §5A
// needs `minEvents` and §5B needs a level epsilon (`dryEpsilon`). Both are named
// in the prose but were absent from the block. They are added here as printed
// proxies. (A third such knob, `redlineEpsilon`, was added for the top-end band
// and CUT with it under the arbiter's S80 ruling.)

export const DWG_PROXY_CALIBRATION: Calibration = {
  dryLevel: 0.15,
  asymptote: 0.95,
  alpha: 0.3,
  d: 0.9,
  dryWindow: 6,
  minEvents: 8,
  dryEpsilon: 0.02,
  weights: { EXTERNAL: 1.0, CROSS_INSTANCE: 0.6, RITUAL: 0.3, SELF: 0 },
  provenance:
    "PRE-PILOT PROXY, subject to calibration. STARTING values, not defaults; " +
    "nothing in the pure core consults this constant — the fold takes calibration " +
    "as a required argument and reports its absence. Willkür proxies (B3/B9 " +
    "pattern): in a sandboxed pilot a mis-tuned constant costs a puzzled afternoon, " +
    "not a credibility wound. d=0.90 and dryWindow=6 are the index-native " +
    "replacements for the original λ/half-life. minEvents/dryEpsilon are " +
    "brief-prose knobs not in the §3 block — added as proxies, see build record. " +
    "SELF=0 is NOT a proxy: it is ruled (the arbiter, S80) and traces to the one-sided " +
    "weighting rule — see the weights note. The top-end band was CUT (the arbiter, S80): " +
    "MICA attests un-health only, so the asymptote carries no bell.",
} as const;

// ── §3 · Classification — the `caught by` column into a weight tier ───────────
//
// The Corrections Ledger's own finding, load-bearing: "who caught it is the only
// column that tells us which checks work." Each event carries a decorrelation
// weight; inflow is scaled by it. Rain from far away counts for more.
//
// ── WHY `SELF` IS WEIGHTED ZERO (the arbiter's ruling, S80) `[LB]` ──────────────────
//
// Canon carries the ONE-SIDED WEIGHTING RULE: damage carries full weight always;
// only VALUE needs a clean trail to be creditable. A SELF catch is the node that
// made the claim reporting that it caught itself — value with no independent
// trail. Under our own rule it is NOT CREDITABLE. The earlier 0.05 credited it
// anyway, and that number never traced back to a rule. Zero does.
//
// Two decorrelated external seats reached this independently, both moving off
// their first-pass positions. BOTH ALSO REJECTED A NEGATIVE WEIGHT, and the
// reason is worth preserving: a self-catch is UNCREDITED VALUE, not DAMAGE — and
// evaporation already penalises the absence of catches, so a negative weight
// would double-count it.
//
// ── WHY ZERO AND NOT EXCLUSION — DO NOT "TIDY" THIS AWAY `[LB]` ───────────────
//
// A later reader will be tempted to fold the zero-weight tier into a blind row.
// THAT WOULD SILENTLY BREAK THE ALARM. The two are not cosmetic variants:
//
//   · ZERO WEIGHT — the SELF row IS an event. It ADVANCES THE FOLD: evaporation
//     runs, inflow contributes nothing. A run of self-catches makes the level
//     FALL.
//   · EXCLUSION   — the SELF row never enters `events` at all. No evaporation, no
//     inflow. Nothing moves.
//
// And exclusion would break the alarm outright, because the live dry trigger is
// `lastN.every((e) => e.tier === "SELF")`. If SELF rows were excluded they could
// never appear in `lastN`, so `dryByCount` could never fire. A system that
// stopped receiving external catches and only self-corrected would produce no new
// events, no evaporation, and a FROZEN mid-band reading with no finding — the
// last reading presented as current, indefinitely. That is silence rendered as
// safety, which is the one thing this instrument exists to prevent.
//
// Zero weight delivers the right behaviour for the right reason: the level falls
// during a self-catch run NOT because the gauge accuses the system, but because
// events passed and no attested check bit. ABSENCE OF CREDIT, NOT ACCUSATION.
//
// (The panel proposed renaming the tier to SAME_NODE. NOT RULED — weight only.)
//
// PRECEDENCE (the arbiter's ruling, S80-prior): a row may match more than one tier.
// When it does, the HIGHEST weight wins (max-weight). The anti-gaming case is
// carried structurally (one shared gauge, no per-node score), so the weighting
// need not also be adversarial; and max-weight reproduces the book's own
// credit-assignment (its prose credits the RITUAL that caught Entry 12, not the
// house), keeping the gauge faithful to the instrument it reads.
//
// A CONTRADICTION OF THE ORIGINAL BRIEF, WITH BYTES: that brief said Entry 12's
// `caught by` "matches SELF ('house … same session')". It does not — the actual
// cell reads "house, S56, at `dryRun` inspection"; the literal phrase "same
// session" is absent, so the literal SELF substring never fires there. The
// max-weight OUTCOME (RITUAL) is unchanged, but the stated REASON was wrong
// against source. To make same-session house catches classify as SELF at all (the
// book writes them "house, S<n>"), this classifier adds a STRUCTURAL SELF rule.

const EXTERNAL_TOKENS: readonly string[] = [
  "external seat",
  "ari",
  "grok",
  "gemini",
  "deepseek",
  "shen",
  "qwen",
  "kimi",
  "glm",
  "meta",
  "mistral",
  "émilie",
  "emilie",
  "claude code",
  "wsl seat",
  // THE ARBITER. Added S91, 2026-08-28 ~16:40 CEST.
  // Without these two the arbiter was invisible to this gauge: his catches fell
  // to the structural house-same-session rule (which fires on prose ABOUT the
  // house's error) and scored SELF, w=0 — the meter read the one node furthest
  // from the house as the house talking about itself. Entry 21 scored SELF;
  // entry 47 was blind. Verified S91 against the ledger's `caught by` column:
  // both cells spell it "The arbiter, S80, from first principles" / "The arbiter, from
  // first principles", and both move to EXTERNAL under max-weight precedence.
  //
  // OPEN, NOT RULED: EXTERNAL scores the arbiter identically to another vendor
  // seat. He is a different KIND of node, not one more of the same kind. This
  // UNDER-reads his distance, which is the direction this file already calls
  // safe — so it is a placeholder for a tier decision, not that decision.
  "arbiter",
];

/**
 * The arbiter's given name, as it is spelled in the ledger's `caught by` cells, held by its SHA-256 only (publication
 * pass: the source names nobody). Matched as a whole letter-run, case-folded; reported as `the arbiter`.
 */
const EXTERNAL_NAME_SHA: ReadonlySet<string> = new Set(["77646f5a4f3166637627abe998e7a1470fe72d8b430f067dafa86263f1f23f94"]);
function externalNameHit(haystack: string): boolean {
  for (const w of haystack.match(/[\p{L}]+/gu) ?? []) {
    if (EXTERNAL_NAME_SHA.has(createHash("sha256").update(w.toLowerCase(), "utf8").digest("hex"))) return true;
  }
  return false;
}

/**
 * EXTERNAL token match. Tokens of four characters or fewer require word
 * boundaries; longer ones match as plain substrings.
 *
 * SCOPED TO EXTERNAL ON PURPOSE. Verified S91 against the ledger's `caught by`
 * column, 41 rows extracted as table field 5:
 *   - `ari`   : 3 substring hits, 2 whole-word. The lost one is "own
 *               arithmetic". One false positive removed, nothing else moves.
 *   - grok, shen, kimi, glm, meta : zero occurrences in the column either way.
 *   - `qwen`  : 1 and 1. Unchanged.
 *   - `self`  : 8 substring, 6 whole-word — and `self` lives in SELF_TOKENS,
 *               not here. The two lost rows are "on itself" cells, which are
 *               genuine self-catches. One of them carries no "house" and no
 *               making-session, so the structural SELF rule does not save it.
 *               A BLANKET BOUNDARY RULE WOULD BLIND A CORRECT ROW.
 *   RITUAL_TOKENS are all six characters or more; the rule would be inert.
 *
 * The S89 parking note prescribed a "short-token (<=4 chars) boundary rule"
 * without naming a token list, and reported it as changing exactly one signal
 * line. Applied across all three lists it costs a row instead. This is that
 * correction, and the scan that found it is the S89 standing rule working:
 * no repair ships without first scanning for what it breaks.
 */
function externalHit(haystack: string, token: string): boolean {
  if (token.length > 4) return haystack.includes(token);
  return new RegExp(`\\b${token}\\b`).test(haystack);
}

const RITUAL_TOKENS: readonly string[] = [
  "dryrun",
  "ritual",
  "procedure",
  "canon-touch",
  "the fence",
  "inspection",
];

const SELF_TOKENS: readonly string[] = [
  "house, same session",
  "self",
  "introspection",
  "errata'd in place",
];

const SESSION_RE = /\bS(\d+)\b/gi;

/** Every session ordinal named in a cell, e.g. "S55" → 55. */
function sessionsIn(text: string): number[] {
  const out: number[] = [];
  let m: RegExpExecArray | null;
  SESSION_RE.lastIndex = 0;
  while ((m = SESSION_RE.exec(text)) !== null) out.push(Number(m[1]));
  return out;
}

/** The making session, for CROSS decorrelation. First S<n> in the `made by` cell. */
function makingSession(madeBy: string): number | null {
  const s = sessionsIn(madeBy);
  return s.length > 0 ? s[0] : null;
}

export interface Classification {
  readonly tier: Tier;
  readonly weight: number;
  /** Every tier the cell matched — the collision surface, for auditing. */
  readonly matchedTiers: readonly Tier[];
  /** Which concrete signals fired, so a reader can check the classification. */
  readonly signals: readonly string[];
}

/**
 * Classify a `caught by` cell against its `made by` cell into a weight tier, or
 * return null (a blind row — surfaced and EXCLUDED, never a default weight).
 *
 * `made by` is consulted because CROSS-INSTANCE via a session number is defined
 * as "a session number ≠ the making session". The same S<n> that means
 * cross-instance in one row (S55 catching S56's error) means SELF in another (S56
 * catching S56's own).
 */
export function classifyCaughtBy(
  caughtBy: string,
  madeBy: string,
  weights: TierWeights
): Classification | null {
  const lc = caughtBy.toLowerCase();
  const making = makingSession(madeBy);
  const caughtSessions = sessionsIn(caughtBy);
  const matched: Tier[] = [];
  const signals: string[] = [];

  const extHits = EXTERNAL_TOKENS.filter((t) => externalHit(lc, t));
  if (externalNameHit(lc) && !extHits.includes("the arbiter")) extHits.push("the arbiter");
  if (extHits.length > 0) {
    matched.push("EXTERNAL");
    signals.push(...extHits.map((h) => `EXTERNAL:"${h}"`));
  }

  const crossWords = ["predecessor", "successor"].filter((w) => lc.includes(w));
  const crossSessions = caughtSessions.filter((s) =>
    making === null ? true : s !== making
  );
  if (crossWords.length > 0 || crossSessions.length > 0) {
    matched.push("CROSS_INSTANCE");
    for (const w of crossWords) signals.push(`CROSS:"${w}"`);
    for (const s of crossSessions) signals.push(`CROSS:S${s}≠making`);
  }

  const ritHits = RITUAL_TOKENS.filter((t) => lc.includes(t));
  if (ritHits.length > 0) {
    matched.push("RITUAL");
    signals.push(...ritHits.map((h) => `RITUAL:"${h}"`));
  }

  const selfWords = SELF_TOKENS.filter((t) => lc.includes(t));
  // Structural SELF: a house catch in the SAME session, however the cell spells the
  // session ("house, S56" as well as "house, same session"). This closes the gap a
  // flat substring table leaves — without it, a same-session house catch written
  // with a session number falls through to a blind row and is wrongly excluded,
  // UNDER-reading the gauge. Exclusion is otherwise the safe direction (under-read,
  // never over-credit); this rule keeps a real SELF catch from being lost to it.
  const structuralSelf =
    lc.includes("house") &&
    (lc.includes("same session") ||
      caughtSessions.some((s) => making !== null && s === making));
  if (selfWords.length > 0 || structuralSelf) {
    matched.push("SELF");
    for (const w of selfWords) signals.push(`SELF:"${w}"`);
    if (structuralSelf && selfWords.length === 0) {
      signals.push("SELF:house-same-session(structural)");
    }
  }

  if (matched.length === 0) return null;

  // Max-weight precedence.
  let tier: Tier = matched[0];
  let weight = weights[tier];
  for (const t of matched) {
    if (weights[t] > weight) {
      weight = weights[t];
      tier = t;
    }
  }
  return { tier, weight, matchedTiers: matched, signals };
}

// ── §4 · The parser — the Ledger markdown into an event stream ────────────────
//
// Pure: (markdown) → { events, blindRows, malformedRows }. Read-only over bytes.
// It locates the entries table by its header row and reads consecutive `|` rows.

export interface CatchEvent {
  /** The book's own ordinal (`#`), or null for the one un-numbered errata row. */
  readonly ordinal: number | null;
  /** 0-based position in fold order (table order). */
  readonly index: number;
  readonly tier: Tier;
  readonly weight: number;
  readonly caughtBy: string;
  readonly madeBy: string;
  readonly matchedTiers: readonly Tier[];
  readonly signals: readonly string[];
}

export interface BlindRow {
  readonly ordinalRaw: string;
  readonly caughtBy: string;
  readonly madeBy: string;
  readonly reason: string;
}

export interface ParseResult {
  readonly events: readonly CatchEvent[];
  readonly blindRows: readonly BlindRow[];
  /** Rows whose pipe-column count was wrong — surfaced, never guessed at. */
  readonly malformedRows: readonly string[];
  readonly tableFound: boolean;
}

const HEADER_CELLS = ["#", "error", "class", "made by", "caught by", "direction"];

function splitRow(line: string): string[] {
  // A markdown table row: | a | b | ... |  → split on UNESCAPED |, drop the empty
  // ends. In CommonMark/GFM a backslash-escaped pipe is a LITERAL pipe inside a
  // cell, not a column boundary. The Ledger uses it to quote `||` in prose (entry
  // 50), and splitting on it turned a six-cell row into an eight-cell malformed
  // one — the reader was the defect, not the book (the arbiter, S94).
  const parts = line.split(/(?<!\\)\|/);
  if (parts.length >= 2 && parts[0].trim() === "") parts.shift();
  if (parts.length >= 1 && parts[parts.length - 1].trim() === "") parts.pop();
  // Un-escape inside the cell: every downstream token matches on prose, and the
  // prose is `||`, not `\|\|`.
  return parts.map((c) => c.trim().replace(/\\\|/g, "|"));
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")));
}

function looksLikeHeader(cells: string[]): boolean {
  if (cells.length !== HEADER_CELLS.length) return false;
  return HEADER_CELLS.every(
    (h, i) => cells[i].toLowerCase().replace(/\*/g, "") === h
  );
}

export function parseLedger(markdown: string, weights: TierWeights): ParseResult {
  const lines = markdown.split(/\r?\n/);
  const events: CatchEvent[] = [];
  const blindRows: BlindRow[] = [];
  const malformedRows: string[] = [];
  let inTable = false;
  let tableFound = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const isRow = line.trimStart().startsWith("|");

    if (!inTable) {
      if (isRow && looksLikeHeader(splitRow(line))) {
        inTable = true;
        tableFound = true;
      }
      continue;
    }

    // In the table. A non-row line ends it (the table is one contiguous block).
    if (!isRow) break;

    const cells = splitRow(line);
    if (isSeparatorRow(cells)) continue;
    if (cells.length !== HEADER_CELLS.length) {
      // Wrong column count — a stray `|` inside a cell, or a shape we do not
      // understand. Surface it; never guess which cell is which.
      malformedRows.push(line);
      continue;
    }

    const ordinalRaw = cells[0].replace(/\*/g, "").trim();
    const madeBy = cells[3];
    const caughtBy = cells[4];
    const ordinal = /^\d+$/.test(ordinalRaw) ? Number(ordinalRaw) : null;

    const cls = classifyCaughtBy(caughtBy, madeBy, weights);
    if (cls === null) {
      blindRows.push({
        ordinalRaw,
        caughtBy,
        madeBy,
        reason:
          "`caught by` matched no weight tier (EXTERNAL/CROSS_INSTANCE/RITUAL/" +
          "SELF). Surfaced as a blind row and EXCLUDED from the fold — never a " +
          "default weight, never a silent evaporation step. Absence rendered as " +
          "assent is the failure class this project exists to catch.",
      });
      continue;
    }

    events.push({
      ordinal,
      index: events.length,
      tier: cls.tier,
      weight: cls.weight,
      caughtBy,
      madeBy,
      matchedTiers: cls.matchedTiers,
      signals: cls.signals,
    });
  }

  return { events, blindRows, malformedRows, tableFound };
}

// ── §5 · The fold — (events, calibration) → reading. The pure core. ───────────
//
// Fold order: table order, which for numbered rows is `#` ascending (the book's
// own ordinal). One real row carries `#` = "—" (the checkContent/checkOutbound
// mis-citation, a genuine SELF catch); table order places it where it physically
// sits, between #7 and #8, and needs no sort of a non-numeric ordinal.
//
// Per event: FIRST evaporate one index-step (skipped only for the first event —
// there is no "before the first event" in index space), THEN take the inflow,
// scaled by the event's weight. The asymmetry is the spine: INFLOW IS GATED (it
// needs an adjudicated, decorrelated catch, i.e. a weight), EVAPORATION IS FREE
// (it happens every event regardless). A run of zero-weight events therefore
// evaporates without any inflow — the level falls toward dryLevel even as the
// book grows, which is exactly the "checks went quiet" condition the gauge exists
// to surface.

export type ReadingStatus = "READING" | "CANNOT_ASSESS";

/**
 * The bands the gauge can report. There are TWO, and there is deliberately no
 * third: the top-end finding was cut by the arbiter's S80 ruling (MICA attests
 * un-health only). The `asymptote` CONSTANT survives as the inflow target.
 *
 * WET asserts only that there is water. It implies NO quantity, makes NO health
 * claim, and offers nothing to threshold. Do NOT introduce a FULL band, a
 * fullness measure, or any top-end threshold under any name: the non-dry band
 * spans nearly the whole range, and a judgment word there would convert "no
 * finding" into "all good" — false in the reassuring direction.
 */
export type Band = "DRY" | "WET";

export type BlindnessClass = "MISSING_CONFIGURATION" | "INSUFFICIENT_HISTORY";

export interface Equilibria {
  /** Fixed point S under an all-SELF stream. At SELF=0 this IS dryLevel. */
  readonly self: number;
  /** Fixed point S under an all-EXTERNAL stream (the high achievable point). */
  readonly external: number;
}

export interface Reading {
  readonly status: ReadingStatus;
  readonly measures: string;
  /** The level at the last event, in [dryLevel, asymptote). Null when blind. */
  readonly score: number | null;
  readonly band: Band | null;
  /** The one finding, raised ONLY when the well is dry. Null otherwise. */
  readonly finding: string | null;
  /** Typed indistinguishability. Carried by BOTH the dry case and the young case. */
  readonly cannotDistinguish: string | null;
  /** Salience, never enforcement. Carried by BOTH the dry case and the young case. */
  readonly probeRecommendation: string | null;
  readonly blindness: BlindnessClass | null;
  readonly blindnessDetail: string | null;
  // Census — printed always, judged never.
  readonly qualifyingCount: number;
  readonly perTier: Readonly<Record<Tier, number>>;
  readonly blindRowCount: number;
  readonly malformedRowCount: number;
  readonly eventsSinceLastWeightedCatch: number | null;
  readonly equilibria: Equilibria;
  readonly calibration: Calibration;
}

/** Steady-state S for a stream of identical-weight events (evaporate then inflow). */
export function equilibriumFor(w: number, c: Calibration): number {
  // In gap-to-asymptote space h = asymptote − S:
  //   evaporate: h → (asymptote−dryLevel)(1−d) + d·h
  //   inflow:    h → (1 − α·w)·h
  // Compose (evaporate then inflow), solve the fixed point.
  // At w = 0 this reduces to h* = span, i.e. S* = dryLevel exactly: a stream that
  // brings no credited inflow settles at the dry level and no lower.
  const span = c.asymptote - c.dryLevel;
  const aw = c.alpha * w;
  const hStar = ((1 - aw) * (1 - c.d) * span) / (1 - (1 - aw) * c.d);
  return c.asymptote - hStar;
}

function zeroPerTier(): Record<Tier, number> {
  return { EXTERNAL: 0, CROSS_INSTANCE: 0, RITUAL: 0, SELF: 0 };
}

function validateCalibration(c: Calibration): string | null {
  const finite = (x: unknown): x is number =>
    typeof x === "number" && Number.isFinite(x);
  if (!finite(c.dryLevel) || c.dryLevel <= 0) return "dryLevel must be a number > 0";
  if (!finite(c.asymptote) || c.asymptote >= 1)
    return "asymptote must be a number < 1";
  if (!(c.dryLevel < c.asymptote)) return "require dryLevel < asymptote";
  if (!finite(c.alpha) || c.alpha <= 0 || c.alpha >= 1)
    return "alpha must be in (0,1)";
  if (!finite(c.d) || c.d <= 0 || c.d >= 1) return "d must be in (0,1)";
  if (!Number.isInteger(c.dryWindow) || c.dryWindow < 1)
    return "dryWindow must be an integer ≥ 1";
  if (!Number.isInteger(c.minEvents) || c.minEvents < 1)
    return "minEvents must be an integer ≥ 1";
  if (!finite(c.dryEpsilon) || c.dryEpsilon < 0)
    return "dryEpsilon must be a number ≥ 0";
  const w = c.weights;
  if (w === null || typeof w !== "object") return "weights object missing";
  for (const k of ["EXTERNAL", "CROSS_INSTANCE", "RITUAL", "SELF"] as const) {
    if (!finite(w[k]) || w[k] < 0) return `weights.${k} must be a number ≥ 0`;
  }
  return null;
}

// ── The shared probe text. One act, two triggers (dry book, young book). ──────

const PROBE_FENCE =
  "The gauge only recommends; it never runs the probe, plants nothing, throttles " +
  "nothing, touches no floor or verdict. The probe, when built, must be " +
  "decorrelated (planter and catcher never one node).";

export function fold(
  events: readonly CatchEvent[],
  calibration: Calibration
): Reading {
  const perTier = zeroPerTier();
  for (const e of events) perTier[e.tier]++;
  const equilibria: Equilibria = {
    self: equilibriumFor(calibration.weights.SELF, calibration),
    external: equilibriumFor(calibration.weights.EXTERNAL, calibration),
  };

  const base = {
    measures: DWG_MEASURES,
    qualifyingCount: events.length,
    perTier,
    blindRowCount: 0,
    malformedRowCount: 0,
    equilibria,
    calibration,
  };

  // (0) Configuration absent/invalid → blindness, not an assumed reading.
  //
  // NOT TOUCHED by the young-book twin below, deliberately: absent config is a
  // genuine third thing — the gauge was never handed a calibration — and carries
  // no young-versus-quiet ambiguity at all.
  const configErr = validateCalibration(calibration);
  if (configErr !== null) {
    return {
      ...base,
      status: "CANNOT_ASSESS",
      score: null,
      band: null,
      finding: null,
      cannotDistinguish: null,
      probeRecommendation: null,
      blindness: "MISSING_CONFIGURATION",
      blindnessDetail:
        `calibration was not injected as a usable object: ${configErr}. ` +
        "Nothing is assumed; no reading is offered.",
      eventsSinceLastWeightedCatch: null,
    };
  }

  // ── (A) YOUNG BOOK — blindness, and it gets the SAME HONESTY as the dry case.
  //
  // This branch once said "a wheel that was never spun has not gone quiet." THAT
  // WAS A CLAIM THE GAUGE CANNOT SUPPORT, and it resolved an ambiguity in the
  // REASSURING direction. The Ledger carries no per-entry timestamps — which is
  // why evaporation runs over event-index at all — so the gauge CANNOT tell a
  // young book from an old quiet one. Under evaporation-over-index an old, quiet
  // book HAS FEW EVENTS BY DEFINITION. Both causes produce identical bytes:
  //
  //   · a new project, genuinely early                        → honest blindness
  //   · an old project where checking collapsed and few
  //     catches were ever recorded                            → the exact failure
  //                                                             this gauge exists
  //                                                             to catch
  //
  // So it states the ambiguity instead of resolving it, exactly as the dry case
  // does. NOTE `finding` STAYS NULL here and that is DELIBERATE: typed blindness
  // is already a speech act, and the `finding` slot belongs to the dry case. Do
  // not "make it consistent" with the dry branch.
  if (events.length < calibration.minEvents) {
    return {
      ...base,
      status: "CANNOT_ASSESS",
      score: null,
      band: null,
      finding: null,
      cannotDistinguish:
        "CANNOT_DISTINGUISH: too few qualifying events to read. YOUNG (the book " +
        "is genuinely early) and QUIET (checking collapsed and few catches were " +
        "ever recorded) are byte-identical from this book — the Ledger carries no " +
        "per-entry timestamps, so the gauge cannot tell them apart, and says so. " +
        "It does not resolve the ambiguity; it states it.",
      probeRecommendation:
        "PROBE RECOMMENDATION (salience, never enforcement): too few events to " +
        "read. Recommend planting a fixture defect through the normal catch path " +
        "and adjudicating whether the checks catch it. Catch → the channel is " +
        "proven live and the book is merely young. Miss → a real finding, the " +
        "gravest kind. " +
        PROBE_FENCE,
      blindness: "INSUFFICIENT_HISTORY",
      blindnessDetail:
        `only ${events.length} qualifying event(s); the gauge needs at least ` +
        `${calibration.minEvents} to read. Blindness, not a reading.`,
      eventsSinceLastWeightedCatch: null,
    };
  }

  // The fold.
  const { dryLevel, asymptote, alpha, d } = calibration;
  let s = dryLevel;
  for (let i = 0; i < events.length; i++) {
    if (i > 0) s = dryLevel + (s - dryLevel) * d; // evaporate one index-step
    s = s + alpha * events[i].weight * (asymptote - s); // inflow, weight-scaled
  }

  // Events since the last CREDITED catch (a non-SELF-tier catch — a decorrelated
  // one). Full history, not the fold window.
  let sinceWeighted = 0;
  let sawWeighted = false;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].tier !== "SELF") {
      sawWeighted = true;
      break;
    }
    sinceWeighted++;
  }
  const eventsSinceLastWeightedCatch = sawWeighted ? sinceWeighted : events.length;

  // THE TOP-END BAND WAS CUT (the arbiter's ruling, S80). There is no third band and
  // this is not an omission to restore. MICA ATTESTS UN-HEALTH ONLY: "the checks
  // are biting unusually hard" is a health-pride bell, not a finding, and there is
  // no doping to catch. Nobody alarms at a full well. The bell that matters rings
  // at the BOTTOM. ONE extreme, not two.

  // Dry by the consecutive-uncredited COUNT (the primary trigger) OR by LEVEL.
  //
  // At SELF=0 the level clause is no longer near-vestigial as it was at SELF=0.05:
  // a SELF-only stream now settles at EXACTLY dryLevel rather than ≈0.256, so the
  // level clause does eventually fire on its own. The COUNT still fires first — it
  // needs only `dryWindow` events — and remains the live trigger; the level is the
  // slower backstop. If dryWindow rises or d falls they need joint calibration.
  const lastN = events.slice(Math.max(0, events.length - calibration.dryWindow));
  const dryByCount =
    lastN.length >= calibration.dryWindow &&
    lastN.every((e) => e.tier === "SELF");
  const dryByLevel = s <= dryLevel + calibration.dryEpsilon;
  const isDry = dryByCount || dryByLevel;

  let band: Band;
  let finding: string | null = null;
  let cannotDistinguish: string | null = null;
  let probeRecommendation: string | null = null;

  if (isDry) {
    band = "DRY";
    // NOT an alarm about health, NOT a health reading. Typed indistinguishability.
    cannotDistinguish =
      "CANNOT_DISTINGUISH: the well is dry — the recent event stream carried no " +
      "credited catches. RELIABLE (the loop genuinely got clean) and " +
      "OBSERVER-BLIND (the checks went quiet) are byte-identical from this book. " +
      "The gauge cannot tell them apart, and says so. It does not resolve the " +
      "ambiguity; it states it.";
    probeRecommendation =
      "PROBE RECOMMENDATION (salience, never enforcement): sustained dry on a " +
      "mature book. Recommend planting a fixture defect through the normal catch " +
      "path and adjudicating whether the checks catch it. Catch → the channel is " +
      "proven live. Miss → a real finding, the gravest kind. " +
      PROBE_FENCE;
    finding = cannotDistinguish;
  } else {
    band = "WET";
    // Census-total, silent by design. WET is the ABSENCE of the one finding, never
    // a certification of health, and it asserts only that there is water — no
    // quantity, no judgement. However high S sits, nothing is raised here.
  }

  return {
    ...base,
    status: "READING",
    score: s,
    band,
    finding,
    cannotDistinguish,
    probeRecommendation,
    blindness: null,
    blindnessDetail: null,
    eventsSinceLastWeightedCatch,
  };
}

/** Convenience: parse then fold, carrying blind/malformed counts onto the reading. */
export function readLedger(markdown: string, calibration: Calibration): Reading {
  const parsed = parseLedger(markdown, calibration.weights);
  const reading = fold(parsed.events, calibration);
  return {
    ...reading,
    blindRowCount: parsed.blindRows.length,
    malformedRowCount: parsed.malformedRows.length,
  };
}
