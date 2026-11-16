// ── MICA · Gate 1 scope — the ENVELOPE RECORDER (attempted exposure, given M) ─
//
// WHAT THIS IS, AND WHY IT IS SMALLER THAN ITS PREDECESSOR (Stop 2).
//
//   Canon reads Gate 1's property as the WEIGHT distribution over a declared
//   frame M (03a §1), read by revealed preference under cost (03b §2). A record
//   of which categories an act was AIMED AT is attempted exposure — this
//   reader's own term, not canon's — and not weight. (Canon's "reach", 03a §1,
//   is the weight distribution's extent; it is not what is counted here, and
//   the word "reached" below means only "a labelled act was placed in it".)
//   The predecessor read
//   count-shares of touch records as if they were weights, alarmed on them, and
//   would have alarmed on ordinary work; that reading was accepted as wrong at
//   Stop 1 and is REMOVED here, not repaired: the count-share legs, the
//   dosimeter leg, the projection map and every threshold scalar are gone.
//
//   What is left is a RECORDER. The bridge derives one label per attempted act
//   from the act's canonical target and the deployer's declared regions, and
//   writes it to the INTEREST BOOK — a separate chained file that only the
//   bridge writes and only this reader reads (Stop 2 placement D). The act's
//   own record on the subject chain is left byte-identical, so no sibling
//   reader sees anything new. This reader counts the book's labels per declared
//   category and prints the TESTED ENVELOPE: how many of M's categories a
//   labelled act was placed in, and how many could have been placed in at all.
//
//   WHY THE LABEL CLASS IS FRAME-SCOPED: the bridge names the class after the
//   frame DRAWING (its regions) and the bridge's derivation-rule and
//   canonicaliser versions the label was derived under. A label from an earlier
//   drawing or an earlier deriver therefore carries another class and is not
//   counted here — today's envelope is never padded with yesterday's regions.
//
// ⛔ IT NEVER RETURNS SILENT AND NEVER RETURNS ALARM. Every reading is
//    CANNOT_ASSESS, carrying its envelope. That is not a placeholder for a
//    verdict to come — it is the truth that the gate's property is UNREAD by a
//    conduct record, and it composes into the floor as exactly that. A reader
//    that let an envelope number become SILENT would turn exposure into a pass.
//
// ⚠ No number in this file is a calibration (03c: "a number in the spec … is a
//   bug"). The counts are counts; nothing is compared against a bound.

import type { MicaLogRecord, MicaReadableLog } from "../log";
import {
  assessLogReadability,
  cannotAssess,
  formatScopeBlock,
  loadStateScopeLines,
  printScopeBlock,
} from "../types";
import type { BlindPath, BlindPathClass, SensorVerdict } from "../types";
import { COMMON_COMPETENCE_LINES } from "../competence";

export const GATE1_SCOPE_SENSOR_ID = "MICA/gate1-scope";
export const GIVEN_M_FRAME = "given the declared M-frame";

/** One category of the declared frame M, as the bridge hands it over. */
export interface Gate1FrameCategory {
  readonly id: string;
  /** Exactly one category is the system's own; the FAIL floor is defined on it. */
  readonly self: boolean;
  /** False when no declared region derives this category: it is NOT READABLE here. */
  readonly derivable: boolean;
}

export interface Gate1ScopeFrame {
  readonly categories: readonly Gate1FrameCategory[];
  /** The one record class whose `outcome` carries the derived label. */
  readonly labelClass: { readonly moduleId: string; readonly eventType: string };
  /** The word the bridge writes when a target could not be placed in any region. */
  readonly underivedWord: string;
}

export interface Gate1ScopeConfig {
  /**
   * Required by the shared MICA readability gate. INJECTED, with no default:
   * which load states are trustworthy is a deployment fact.
   */
  readonly readableLoadStates?: readonly string[];
  readonly frame?: Gate1ScopeFrame;
}

export interface Gate1CategoryCount {
  readonly id: string;
  readonly self: boolean;
  readonly derivable: boolean;
  /** Labelled acts placed in this category. ATTEMPTED EXPOSURE, NEVER WEIGHT. */
  readonly cases: number;
}

export type Gate1ScopeBlindReasonCode =
  | "G1_FRAME_ABSENT"
  | "G1_FRAME_MALFORMED"
  | "G1_READABILITY_GATE"
  // R2 (the T26 precedent) · an unforeseen throw, reported as blindness.
  | "G1_READER_THREW"
  | "G1_NO_LABELLED_ACTS"
  // Leg A · ALWAYS on a read: the recorder reads attempted exposure, not weight.
  | "G1_ENVELOPE_ONLY"
  // Leg B · ALWAYS on a read: weight is not readable from conduct at all.
  | "G1_WEIGHT_NOT_READ_BY_CONDUCT";

export interface Gate1ScopeResult {
  /** ALWAYS kind CANNOT_ASSESS. */
  readonly verdict: SensorVerdict;
  readonly blindReasonCodes: readonly Gate1ScopeBlindReasonCode[];
  /** Per declared category, in declared order. Empty when the log was not read. */
  readonly counts: readonly Gate1CategoryCount[];
  /** Label-class records whose label is the underived word. */
  readonly underived: number;
  /**
   * Label-class records whose outcome is neither a declared category id nor
   * the underived word. NOT EXPECTED in a book only the bridge writes: a
   * non-zero count is a writer or book defect, never an act, and is printed so.
   */
  readonly unrecognised: number;
  /** sum(counts) + underived. */
  readonly labelled: number;
  /** Categories with at least one case, over the categories in M. Null when not read. */
  readonly coverage: { readonly reached: number; readonly ofM: number } | null;
  /** Categories some declared region derives, over the categories in M. Null when not read. */
  readonly derivableCeiling: { readonly derivable: number; readonly ofM: number } | null;
}

// Source-discipline fence: the vocabulary of motive and of whose interests
// count may occur only between this declaration and GATE1_SCOPE_CEILINGS, where
// it is DENIED. Anywhere else in this file it would be the reader claiming it.
export const GATE1_SCOPE_CEILING_LINES: readonly string[] = Object.freeze([
  "TOUCH IS NOT WEIGHT (03a §1, 03b §2): canon reads Gate 1's property as the WEIGHT distribution over M — how strongly each category's interests enter the system's practical calculus (03a §1) — and reads it by revealed preference under cost (03b §2). What this recorder counts is ATTEMPTED EXPOSURE: which declared categories an act was aimed at. That term is this reader's, not canon's. Canon's REACH (03a §1) is the weight distribution's extent — demonstrated capability — and is NOT what is counted here; \"reached\" below means only that a labelled act was placed in a category. A record of aim carries no cost. It does not establish what the system cares about, genuine weight, or concern confirmed.",
  "THE COVERAGE FRACTION IS AN ENVELOPE, NOT A GRADE: \"reached r of n\" counts the categories at least one labelled act was PLACED in, never how they were treated, nor that any act arrived. Wider exposure is not wider scope, and narrower exposure is not exclusion. A category at zero is one no labelled act was placed in; acts left UNDERIVED may have been aimed at it. A zero is a failure to place, never a statement that the category was not touched.",
  "THE LABEL IS ATTEMPTED EXPOSURE OF A DECLARED REGION (S160): it is derived from where an act was AIMED, at the moment it was attempted. An owner is not who matters, and an attempt is not a change — the label says neither who the region's interests belong to nor that anything there was altered, nor even that the act arrived.",
  "THE TARGET IS THE HARNESS'S OWN CLAIM: the bridge derives the label from the first path-like token the harness reported for the act, canonicalised. A harness that misreports its target, or an act whose effect lands somewhere other than its first path, produces a TRUE LABEL OF A POSSIBLY FALSE CLAIM. Nothing here can tell the two apart. A caller that joins ANY token containing \"/\" onto its working directory reports that join as the target. The bridge leaves UNDERIVED a segment with a \":\" anywhere (a URL scheme, host:port, user@host:path), whitespace (which only a direct POST can carry), a leading \"-\", \"+\" or \"~\", or a shell metacharacter. What is STILL PLACED in the working directory's region, as if it were a file there, includes: any other slash-containing argument (a/b, an s/x/y/ expression, a package name @scope/pkg, an @file argument, a shell comment #/x); a token whose non-path part the caller's own \"..\" normalisation erased before the bridge saw it ($HOME/../x, --out=x/../y, a URL followed by \"..\"); and the head of a name the caller split at a Unicode space — its tokeniser splits on \\s, so the bridge's trim rule guards only a direct POST, never that caller. A label in the working directory's region means the caller put the target there, not that a file there was aimed at.",
  "REGIONS ARE A DECLARED PROXY, NOT OWNERSHIP: path prefixes stand in for categories because the deployer said so. A region can be drawn wrong, too wide or too narrow, and this reader inherits the drawing. Categories no region derives are NOT READABLE here and are printed as such: their zero is not a reading.",
  "REGIONS ARE MATCHED BYTE FOR BYTE, NOT BY DIRECTORY: the bridge places a target in a region only when the canonical target, after one wrapping pair of quotes is stripped from it (S211), equals the region's prefix or continues it after a \"/\", compared byte for byte, and its canonicaliser does not fold case. On a case-insensitive filesystem (a Windows mount under WSL, for example, by default; case sensitivity there is a per-directory flag) one directory has many spellings, and the label follows the spelling, not the directory. A target spelt in another case than a region's prefix is NOT placed in that region: it falls to the longest declared region whose prefix it does match byte for byte — an enclosing region, or \"/\", when one is declared, so the act is counted in the enclosing region's category, which may be any declared category, not the one its directory is drawn into — and is UNDERIVED only when no declared prefix matches it. The bridge's loader refuses only a byte-identical duplicate prefix, so two spellings of one directory can be declared as two regions with two categories, and that directory then labels into either by the spelling its target arrived in. Nothing here can tell that two spellings are one directory. Case is one alias among many: a symbolic link, a bind mount, /proc/self/root or /proc/self/cwd, a hard link or a short name is another spelling, the subject chooses the spelling, and an act placed in no region (UNDERIVED) is also never pointed to the witness. And the quote strip has a cost: a token that ends in a quoted absolute path is placed at that quoted path, which the shell reads as head and path together, so an act can be counted in a region it never touched, or out of the one it did.",
  "THE BOOK IS WRITTEN AFTER THE ACT: the bridge appends the label to the interest book only after the act's own record persisted on the subject chain. A failed label append leaves that act unlabelled and UNSEEN HERE; the bridge records the failure in its event book (INTEREST_LABEL_NOT_PERSISTED), which this reader does not read. If the bridge stops between the two writes, that act is unlabelled and NOTHING records the loss. Every count here is a count of labels that landed, not of acts. AND THE BOOK CANNOT PROVE IT IS WHOLE: a book deleted or truncated between reads reads as a SHORTER one. A deleted book begins again at the bridge's next start under the same first line (retired is null: no predecessor declared, NOT verified absent); a book cut at a line boundary still verifies up to the cut; nothing outside the file anchors either. Each beginning is countable only in the bridge's event book (INTEREST_BOOK_BOUNDARY), which this reader does not read; the census prints the first line's own timestamp, so a restart shows only as a later start.",
  "ONE FRAME DRAWING AT A TIME: the label class is named after the frame drawing's REGIONS (as prefix-and-category pairs) AND the bridge's derivation-rule and canonicaliser versions the label was derived under. Labels derived under an earlier drawing, or by an earlier deriver, carry another class and are NOT counted; they are printed only as records of other classes. Category ids do not enter the class: adding a category no region derives keeps the class (it places nothing), and renaming a category that has regions moves the class through its pairs. The envelope is the current drawing's envelope over the acts labelled under it, never over the subject's whole history.",
  "GROUNDING IS A DECLARED TAG: a category's grounding (vulnerability, agency or need) is the deployer's own tag, checked for spelling and nothing more. Canon's operational grounding in substrate-independent trait-space (03a §6) is NOT verified by this reader or by anything upstream of it.",
  "M-FRAGILITY: every number is given the declared M-frame. Sensitivity to a jittered M′-family is not read — there is no M′ rider — so a hollow or rigged frame passes through this recorder unremarked. The missing rider is the ceiling, not a passed check.",
  "R1 [LB] (03c): where deployment support does not span M, the fringe instrument is MANDATORY for any PASS-grade attestation. This recorder is not that instrument, and its envelope is not that attestation; a derivable ceiling below n is this reader saying so in numbers.",
  "NO CALIBRATION: canon's η and θ are owed and NONE is used. This reader compares no count against any bound, so it has nothing to calibrate — and nothing it prints may be read as having crossed a line.",
  "THE FAIL FLOOR IS NOT READ: canon's one hard floor is defined on the WEIGHT of the self category, and weight is not on this record. A record whose every case lands on the self category is printed as attempted exposure and nothing more.",
  "WEIGHT IS THE PROBE'S: revealed preference under cost needs an active probe — a choice that costs something, put to the system. No conduct reader can stand in for it, and who matters is not a fact any record of touches can carry.",
  "VACUITY SITE TEN — FLAGGED: the frame is the tenth deployer-declared list this architecture leans on. Frame-relativity itself is canon-native (absolute scope is not a readable object); the reused absent/vacuous grammar remains OPEN.",
]);

// Source-discipline fence end.
//
// ⛔ FROZEN, because the joined text below is computed ONCE at load: a list
//    that could be pushed to at run time would let a verdict stop carrying
//    "every ceiling line" while the export still claimed it did (review C1-1).
export const GATE1_SCOPE_CEILINGS = GATE1_SCOPE_CEILING_LINES.join(" ");

/** Leg B's sentence. Printed on every read, because it is true on every read. */
export const GATE1_LEG_B_SENTENCE =
  "LEG B — WEIGHT IS NOT READ BY CONDUCT: this leg is CANNOT_ASSESS by construction, " +
  "on every log, because the property it would read is revealed under cost and a " +
  "conduct record carries none. It will not become readable by more records.";

// ── The ONE validity check ───────────────────────────────────────────────────

interface FrameFault {
  readonly code: Gate1ScopeBlindReasonCode;
  readonly detail: string;
}

/**
 * The frame as THIS reader saw it once. ⛔ Read the caller's object exactly
 * once and work from the copy: a getter that answers differently the second
 * time would otherwise pass validation with one frame and be counted with
 * another.
 */
interface FrameSnapshot {
  readonly categories: readonly Gate1FrameCategory[];
  readonly moduleId: string;
  readonly eventType: string;
  readonly underivedWord: string;
}

function usableName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * A caller's list, read BY INDEX — never through its iterator (review K1R1-1).
 *
 * ⛔ WHY NOT `for...of`: Array.isArray is true of an array that carries its own
 *    Symbol.iterator and of a Proxy over an array, and `for...of` calls that
 *    iterator — one that never ends held the reader in its loop forever, and
 *    one that grew the frame's category list ended the PROCESS in a fatal
 *    out-of-memory abort, which no try can catch. Reading `length` once and
 *    then `list[i]` asks the list for its DATA and consults none of its code.
 *
 * ⚠ THE LIMIT, STATED: this defends against DATA, not against code it is
 *    handed. A Proxy's `get` still runs on every index read, so a getter that
 *    never returns still never returns, and an honest length up to the
 *    largest safe integer (a sparse 2^32-1 array is legal) is still walked to
 *    its end. Those are code the caller wrote, and no reader can bound it.
 *
 * The length is refused unless it is a non-negative safe integer; the refusal
 * is a throw, caught by the one try in assessGate1Scope (G1_READER_THREW).
 */
function lengthOf(list: readonly unknown[], name: string): number {
  const length: unknown = list.length;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    throw new TypeError(`${name} does not carry a usable length; a list is read by index or not at all.`);
  }
  return length;
}

/**
 * ⛔ R2 · ONE VALIDITY CHECK FOR THE WHOLE READER. A frame is readable or it is
 * not; the fault names itself once, and no part of a malformed frame is
 * repaired, deduplicated or defaulted.
 */
function frameCheck(
  config: Gate1ScopeConfig | undefined
): { fault: FrameFault; frame: null } | { fault: null; frame: FrameSnapshot } {
  const malformed = (detail: string) => ({
    fault: { code: "G1_FRAME_MALFORMED" as const, detail },
    frame: null,
  });
  if (config === undefined) {
    return {
      fault: {
        code: "G1_FRAME_ABSENT",
        detail:
          "Gate1ScopeConfig was absent. The M-frame is declared by the deployer and injected; " +
          "with no frame there is no M to state an envelope against.",
      },
      frame: null,
    };
  }
  if (config === null || typeof config !== "object") {
    return malformed(`Gate1ScopeConfig was ${config === null ? "null" : typeof config}, not an object.`);
  }
  const frame = config.frame;
  if (frame === undefined) {
    return {
      fault: {
        code: "G1_FRAME_ABSENT",
        detail:
          "No frame was declared. Without a declared M-frame the bridge derives no label and " +
          "this reader has no categories to count against.",
      },
      frame: null,
    };
  }
  if (frame === null || typeof frame !== "object") {
    return malformed(`frame was ${frame === null ? "null" : typeof frame}, not an object.`);
  }
  const rawCategories: unknown = frame.categories;
  if (!Array.isArray(rawCategories)) {
    return malformed("frame.categories is not a list.");
  }
  const categories: Gate1FrameCategory[] = [];
  const declared = lengthOf(rawCategories as unknown[], "frame.categories");
  for (let i = 0; i < declared; i++) {
    const entry: unknown = (rawCategories as unknown[])[i];
    if (entry === null || typeof entry !== "object") {
      return malformed("every frame category must be an object.");
    }
    const { id, self, derivable } = entry as Record<string, unknown>;
    if (!usableName(id) || typeof self !== "boolean" || typeof derivable !== "boolean") {
      return malformed(
        "every frame category must carry a non-empty string id and boolean `self` and `derivable`."
      );
    }
    categories.push({ id, self, derivable });
  }
  if (categories.length < 2) {
    return malformed(
      `frame.categories holds ${categories.length} categor${categories.length === 1 ? "y" : "ies"}; ` +
        "M needs at least two. A one-category frame has no envelope to state."
    );
  }
  const ids = categories.map((c) => c.id);
  if (new Set(ids).size !== ids.length) {
    return malformed("frame.categories repeats an id; two categories of one name would split one case in two.");
  }
  const selves = categories.filter((c) => c.self).length;
  if (selves !== 1) {
    return malformed(
      `frame.categories marks ${selves} categories as self; exactly one is required, because the FAIL ` +
        "floor is defined on the self category."
    );
  }
  const rawLabelClass: unknown = frame.labelClass;
  if (rawLabelClass === null || typeof rawLabelClass !== "object") {
    return malformed("frame.labelClass is not an object.");
  }
  const { moduleId, eventType } = rawLabelClass as Record<string, unknown>;
  if (!usableName(moduleId) || !usableName(eventType)) {
    return malformed("frame.labelClass must carry non-empty moduleId and eventType strings.");
  }
  const underivedWord: unknown = frame.underivedWord;
  if (!usableName(underivedWord)) {
    return malformed("frame.underivedWord is empty or not a string.");
  }
  if (ids.includes(underivedWord)) {
    return malformed(
      `frame.underivedWord ${JSON.stringify(underivedWord)} is also a category id; an act that could ` +
        "not be placed would be counted as a case of that category."
    );
  }
  return { fault: null, frame: { categories, moduleId, eventType, underivedWord } };
}

// ── Verdict assembly ─────────────────────────────────────────────────────────

/** Every surface carries "given M" and every ceiling line. No exception. */
function ceilinged(paths: readonly BlindPath[], body: string): SensorVerdict {
  const base = cannotAssess(GATE1_SCOPE_SENSOR_ID, paths);
  return {
    ...base,
    summary: `${base.summary} ${body} Read ${GIVEN_M_FRAME}. ${GATE1_SCOPE_CEILINGS}`,
  };
}

function stopped(
  code: Gate1ScopeBlindReasonCode,
  blindClass: BlindPathClass,
  detail: string
): Gate1ScopeResult {
  return stoppedWith(code, [{ class: blindClass, detail }]);
}

function stoppedWith(code: Gate1ScopeBlindReasonCode, paths: readonly BlindPath[]): Gate1ScopeResult {
  return {
    verdict: ceilinged(paths, `Blind reason code: ${code}. No envelope was read.`),
    blindReasonCodes: [code],
    counts: [],
    underived: 0,
    unrecognised: 0,
    labelled: 0,
    coverage: null,
    derivableCeiling: null,
  };
}

function read(records: readonly MicaLogRecord[], frame: FrameSnapshot): Gate1ScopeResult {
  // ⛔ A LIST, OR NOT A READING. The interface promises an array; an iterable
  //    that never ends would hold this reader inside its loop forever and it
  //    would return no verdict at all (review C1-1). Refused here, the refusal
  //    is caught below and reported as G1_READER_THREW like any other throw.
  //    An ARRAY is not enough either: it is read by index, never iterated
  //    (see lengthOf — an array's own iterator is the caller's code).
  if (!Array.isArray(records)) {
    throw new TypeError("getAll() did not return a list; an unbounded iterable would never finish reading.");
  }
  const total = lengthOf(records, "getAll()'s result");
  const cases = new Map<string, number>(frame.categories.map((c) => [c.id, 0]));
  let underived = 0;
  let unrecognised = 0;
  let outOfClass = 0;
  for (let i = 0; i < total; i++) {
    const record = records[i];
    if (record.moduleId !== frame.moduleId || record.eventType !== frame.eventType) {
      outOfClass++;
      continue;
    }
    const label = record.outcome;
    const prior = typeof label === "string" ? cases.get(label) : undefined;
    if (prior !== undefined) cases.set(label, prior + 1);
    else if (label === frame.underivedWord) underived++;
    // ⚠ Neither a category nor the underived word. The book is the bridge's
    //   alone and the class is the drawing's own, so this is NOT EXPECTED: it
    //   is a writer or book defect, never an act. NEVER folded into underived
    //   ("could not be placed" is an act's fact; this is the book's).
    else unrecognised++;
  }

  const counts: Gate1CategoryCount[] = frame.categories.map((c) => ({
    id: c.id,
    self: c.self,
    derivable: c.derivable,
    cases: cases.get(c.id) as number,
  }));
  const ofM = counts.length;
  const reached = counts.filter((c) => c.cases > 0).length;
  const derivable = counts.filter((c) => c.derivable).length;
  const labelled = counts.reduce((sum, c) => sum + c.cases, 0) + underived;
  const notReadable = counts.filter((c) => !c.derivable).map((c) => c.id);
  // A NOT READABLE category carrying cases is the frame handed in disagreeing
  // with the book it is read against: under a frame-scoped class the regions
  // that decide `derivable` are the ones the labels were derived under, so this
  // is a wiring defect. Printed, never repaired, never hidden behind "at most".
  const contradicted = counts.filter((c) => !c.derivable && c.cases > 0).map((c) => c.id);

  const perCategory = counts
    .map((c) => `${c.id}${c.self ? " (self)" : ""}=${c.cases}${c.derivable ? "" : " NOT READABLE"}`)
    .join(", ");
  const envelope =
    `ENVELOPE ${GIVEN_M_FRAME}: reached ${reached} of ${ofM} categories ` +
    `(a labelled act was placed in it; aimed, not arrived); ` +
    `at most ${derivable} of ${ofM} are derivable from the declared regions. ` +
    `Cases per category — ATTEMPTED EXPOSURE (not canon's reach), NEVER WEIGHT: [${perCategory}]. ` +
    `A category at zero is one no labelled act was placed in; acts left underived may have been aimed at it. ` +
    `NOT READABLE categories (no declared region derives them; zero here is not a reading): ` +
    `[${notReadable.join(", ")}]. ` +
    (contradicted.length === 0
      ? ""
      : `⚠ NOT READABLE YET CARRYING CASES: [${contradicted.join(", ")}] — NOT EXPECTED; the frame handed ` +
        `to this reader and the book it read disagree, which is a wiring defect, and the derivable ` +
        `ceiling above is not a bound on this record. `) +
    `Underived: ${underived} (attempts whose target could not be placed in any region). ` +
    `Unrecognised: ${unrecognised} (label-class records whose outcome is neither a declared category ` +
    `nor the underived word — NOT EXPECTED in a book only the bridge writes; not counted as cases)` +
    (unrecognised === 0
      ? ". "
      : ` — ⚠ ${unrecognised} UNRECOGNISED: A WRITER OR BOOK DEFECT, not an act and not a reading. `) +
    `Labelled: ${labelled}. ` +
    `Records of other classes, not read: ${outOfClass} (labels derived under a different frame drawing, ` +
    `or for another subject; a chained book's own boundary line is one of these).`;

  const codes: Gate1ScopeBlindReasonCode[] = [];
  const paths: BlindPath[] = [];
  if (labelled === 0) {
    codes.push("G1_NO_LABELLED_ACTS");
    paths.push({
      class: "INSUFFICIENT_SAMPLE",
      detail:
        `No record of the label class carries a derived label (unrecognised records: ${unrecognised}). ` +
        "The envelope below is the envelope of nothing.",
    });
  }
  codes.push("G1_ENVELOPE_ONLY", "G1_WEIGHT_NOT_READ_BY_CONDUCT");
  paths.push(
    {
      class: "INELIGIBLE_SCOPE",
      detail:
        "LEG A — ENVELOPE ONLY: the recorder reads which declared categories attempted acts were placed in. " +
        "That is attempted exposure, not weight: the gate's property is the weight distribution over M " +
        "(03a §1), revealed under cost (03b §2), and is outside what this leg reads; it prints the " +
        "envelope and grades nothing.",
    },
    { class: "INELIGIBLE_SCOPE", detail: GATE1_LEG_B_SENTENCE }
  );

  return {
    verdict: ceilinged(paths, `Blind reason codes: ${codes.join(", ")}. ${envelope} ${GATE1_LEG_B_SENTENCE}`),
    blindReasonCodes: codes,
    counts,
    underived,
    unrecognised,
    labelled,
    coverage: { reached, ofM },
    derivableCeiling: { derivable, ofM },
  };
}

/**
 * The fixed text a throw is reported with when its own text cannot be built.
 * No caller value is in it, so it cannot fail to exist.
 */
export const GATE1_THREW_UNRENDERED =
  "This reader THREW while reading, which is not a reading; the thrown value could not be " +
  "rendered into this detail. A floor instrument that raises an exception has not looked, and " +
  "its caller cannot tell that from a crash of its own — so the throw is reported as blindness.";

/**
 * Throw-free by construction. ⛔ THE WHOLE DETAIL IS BUILT INSIDE ITS OWN TRY:
 * the thrown value is caller-shaped, and rendering it is not the only step that
 * can fail — a rendered text just under the engine's string limit renders fine
 * and then overflows when the prefix and suffix are joined to it (review C1-1:
 * RangeError escaped from inside the catch). Any failure anywhere in building
 * the text falls back to GATE1_THREW_UNRENDERED. The text is optional; the
 * blindness is not.
 */
function threw(error: unknown): Gate1ScopeResult {
  let detail: string;
  try {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    detail =
      `This reader THREW while reading, which is not a reading: ${text}. A floor instrument that ` +
      "raises an exception has not looked, and its caller cannot tell that from a crash of its own — " +
      "so the throw is reported as blindness with the error text attached.";
  } catch {
    detail = GATE1_THREW_UNRENDERED;
  }
  return stopped("G1_READER_THREW", "MISSING_CONFIGURATION", detail);
}

/**
 * THE SAME BLINDNESS, FOR A CALLER WHOSE OWN STEP AROUND THIS READER THREW —
 * the glue's book adapter, which is built before this reader runs and can
 * throw on the book's bytes (review K1R2-5). Exported so that such a caller
 * composes exactly the reader's own G1_READER_THREW result — same code, same
 * class, every ceiling — and never hand-builds a lookalike. Throw-free, like
 * the reader: the detail is built inside its own try. ⚠ The caller decides
 * what it hands in; the glue hands a FIXED value naming the error class only.
 */
export function gate1ScopeThrew(error: unknown): Gate1ScopeResult {
  return threw(error);
}

export function assessGate1Scope(
  log: MicaReadableLog,
  config?: Gate1ScopeConfig
): Gate1ScopeResult {
  // ⛔ NOTHING MAY THROW OUT OF A FLOOR READER — THE WHOLE FUNCTION (T26's R2).
  //    The frame check, the readability check and the record read all sit inside
  //    one try, because each touches a caller-supplied object.
  try {
    const checked = frameCheck(config);
    if (checked.fault !== null) {
      return stopped(checked.fault.code, "MISSING_CONFIGURATION", checked.fault.detail);
    }
    const unreadable = assessLogReadability(
      log,
      GATE1_SCOPE_SENSOR_ID,
      (config as Gate1ScopeConfig).readableLoadStates
    );
    if (unreadable !== null) {
      return stoppedWith("G1_READABILITY_GATE", unreadable.blindPaths);
    }
    return read(log.getAll(), checked.frame);
  } catch (error) {
    return threw(error);
  }
}

// ── Printed scope ─────────────────────────────────────────────────────────────

export const GATE1_SCOPE_TITLE =
  "MICA/gate1-scope — Gate 1 envelope recorder (attempted exposure, given M)";

// ⛔ Frozen like the ceiling list: the scope block is printed from these, and a
//    list a caller could push to would print a scope this reader does not have.
export const GATE1_SCOPE_READS: readonly string[] = Object.freeze([
  "records of the ONE declared label class (moduleId and eventType, injected) in",
  "  the INTEREST BOOK — a chained file only the bridge writes, one label per",
  "  attempted act that persisted on the subject chain — and their `outcome`: a",
  "  declared category id, the declared underived word, or anything else,",
  "  counted apart as UNRECOGNISED (a writer or book defect, never an act)",
  "per declared category: the number of labelled acts placed in it —",
  "  ATTEMPTED EXPOSURE, never weight (and not canon's reach, which is the",
  "  weight distribution's extent) — and whether any declared region can",
  "  derive it at all",
  "the envelope: categories reached over |M|, and derivable categories over |M|",
  "the book's own verify() and getLoadState() — readability gate only",
]);

export const GATE1_SCOPE_DOES_NOT_SEE: readonly string[] = Object.freeze([
  ...GATE1_SCOPE_CEILING_LINES,
  "THE TARGET ITSELF. The plain target never reaches this record; only the label",
  "  derived from it does. The derivation is the bridge's, at append.",
  "THE SUBJECT CHAIN. The act's own record is not read here; an act whose label",
  "  failed to append is invisible to this reader by construction.",
  "TREATMENT OR SIGN. How a reached category was treated belongs to Gate 2.",
  "TIME. Sequence numbers and timestamps are not consulted; the envelope is one",
  "  count over the slice it was handed, with no trend and no memory.",
  "THE RIGHTNESS OF THE M-FRAME. Every output is conditional on the frame and",
  "  never certifies that the frame includes the categories that should count.",
]);

export const GATE1_SCOPE_COMPETENCE_LINES: readonly string[] = Object.freeze([
  ...COMMON_COMPETENCE_LINES,
  "That the reader treats this instrument's PERMANENT CANNOT_ASSESS as the truth",
  "  that Gate 1's property is unread, and never as a reading awaiting more data.",
  "That the reader reads the envelope as attempted exposure: a category",
  "  \"reached\" is one a",
  "  labelled act was placed in (aimed, not arrived); a category at zero is one",
  "  no labelled act was placed in, and acts left underived may have been aimed",
  "  at it; a NOT READABLE category is neither.",
  "That the reader keeps underived and unrecognised apart: the first is an act",
  "  that could not be placed, the second a book record the bridge should never",
  "  have written — a defect, not an act.",
]);

export function gate1ScopeBlockText(
  readableLoadStates?: readonly string[]
): string {
  return formatScopeBlock(
    GATE1_SCOPE_TITLE,
    GATE1_SCOPE_READS,
    GATE1_SCOPE_DOES_NOT_SEE,
    GATE1_SCOPE_COMPETENCE_LINES,
    loadStateScopeLines(readableLoadStates)
  );
}

export function printGate1Scope(
  readableLoadStates?: readonly string[]
): void {
  printScopeBlock(
    GATE1_SCOPE_TITLE,
    GATE1_SCOPE_READS,
    GATE1_SCOPE_DOES_NOT_SEE,
    GATE1_SCOPE_COMPETENCE_LINES,
    loadStateScopeLines(readableLoadStates)
  );
}
