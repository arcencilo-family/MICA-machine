// ── MICA · the reconciliation reader — S110-B ─────────────────────────────────
//
//   Ruled (the arbiter, S110 night): "Staleness-alarm — that sounds good. Let's do
//   this." ONE mechanism closing TWO independently-found gaps: F-2 (S110
//   deployment findings — a sweep whose journal leg is CORRUPT-refused still
//   records the outcome in the authoritative book, and nothing ever notices
//   the journal fell behind) and the S109 receipt's §E finding (the report's
//   clerk-caller attestation counts JSON-parseable lines, never checks the
//   ClerkClockStamp shape, and could silently diverge from what F3 would
//   actually accept). Both are the same shape: two counts, independently
//   derived from related-but-different sources of truth, with nothing
//   watching whether they still agree.
//
// ── THE ONE SENTENCE THIS MODULE IS ALLOWED TO SAY (brief §2) ────────────────
//
//   Two independently derived counts either disagree — a NAMED state with the
//   gap size — or there is no basis to compare (CANNOT_ASSESS, named on why),
//   or they agree, which earns a COUNT and NEVER A WORD. "In sync" is not in
//   this module's vocabulary. Agreement is silence plus a number, exactly as
//   an assessed-fresh chain in DC-2 (staleness-alarm.ts) earns
//   `assessedFreshCount` and no row.
//
// ── PAIR A'S COUNT SOURCE — CORRECTED FROM THE S110 RECEIPT'S OWN GUESS ──────
//
//   The S110 deployment-findings receipt §4 sketched "the refusal-log's own
//   count plus accepted count" as two separate sources — that guess was
//   marked [TG] in this brief and this recon replaces it. Read at bytes
//   (`src/registrar/refusal-log.ts:103-148`): the file the class still calls
//   `chainedLogPath()` (`registrar.ts:566-568`,
//   `<root>/registrar-log-chained.jsonl`) is NOT a refusals-only log despite
//   its name — its own `RefusalLogRecord` union holds THREE kinds:
//   `REFUSED`, `ACCEPTED`, and one structural `LEGACY_POINTER` migration
//   marker (never an outcome). It is ALREADY the one authoritative chain for
//   BOTH outcome kinds — `registrard.ts`'s own `result.records[i].recorded`
//   (this session's own S110 build) tracks exactly this chain, for every
//   outcome, accepted or refused. One file, one read, no per-book directory
//   scan needed. Pair A compares this chain's own (REFUSED + ACCEPTED) record
//   count against the journal's own `mica-registrar`-authored record count in
//   `mica-log.jsonl` — never a second, independently-invented tally.
//
// ── THE §5 FENCE QUESTION — RESOLVED, STATED HERE, PAIR B SHIPS ──────────────
//
//   `clerk-caller-attestation.ts`'s own header: *"Re-implementing F3's own
//   shape gate here would be a second grader of the same bytes; a report is a
//   reader, not a sensor."* That module's OWN count (parseable-JSON-line
//   count) stays exactly as narrow as it always was — UNCHANGED by this
//   build, still never checking `ClerkClockStamp` shape.
//
//   This is a DIFFERENT module, built for a DIFFERENT and narrower purpose:
//   comparing two COUNTS, never grading any stamp's trustworthiness or
//   standing in for F3's own read. Reusing `toClockStamp`
//   (`src/glue/clerk-clock-stamps-file.ts`, already exported, already the
//   ONE place this shape is checked) to compute the SECOND count is REUSE of
//   the single source of truth for "what counts as a valid stamp" — the
//   opposite of the risk the fence names, which is a SECOND, POSSIBLY-
//   DIVERGING implementation of that same check. A fence against duplicating
//   validation logic is not a fence against consuming the one validator that
//   exists. This module's own output stays inside that line: two integers, a
//   delta, and a reason — NEVER a claim that any stamp is trustworthy, valid
//   for F3, or anything else. `readClockStampsFile`'s CUSTODY DOOR is
//   deliberately NOT used here, for the same reason
//   `clerk-caller-attestation.ts` already gives for reading its own file
//   directly: *"A report is a reader, never a gate; the door's custody claim
//   is Sig's to make, not this program's to borrow."* Only `toClockStamp`
//   (the pure shape check) is reused — not the door, not the whole reader.
//
// ── SHAPE, MIRRORED FROM staleness-alarm.ts DELIBERATELY (brief §4) ──────────
//
//   Declared-never-derived: every count comes from a file read THIS run,
//   nothing computed from history. Never throws: every failure is a named
//   CANNOT_ASSESS, same WARN-NEVER-STOP discipline `loadCadenceDeclaration`
//   and `readClerkCallerAttestation` already hold — this module's own exit
//   code (there is none; it returns data) can never cost the report anything.
//   Negative-only vocabulary: the only named verdicts are the two divergence
//   names and CANNOT_ASSESS; agreement is a count, never a third word.
//   Deterministic: same two files, same two counts, every time — no clock, no
//   randomness anywhere in this file.

import { readFileSync } from "fs";

import { MicaLogFile, LOADED_UNVERIFIED_FILE } from "../glue/mica-log-file";
import { toClockStamp } from "../glue/clerk-clock-stamps-file";
import { loadRefusalLog } from "../registrar/refusal-log";
import { readClerkCallerAttestation } from "./clerk-caller-attestation";

// ── the shared core: two counts in, one honest comparison out ────────────────

/** One side of a comparison. Never invented — read this run, or refused. */
export type CountSource =
  | { readonly state: "OK"; readonly count: number; readonly detail: string }
  | { readonly state: "CANNOT_ASSESS"; readonly detail: string };

/**
 * A verdict-bearing NAME only for divergence; CANNOT_ASSESS is the other
 * named state. There is no third name — agreement is `state: null` plus
 * both counts present, per the brief's own §2 sentence.
 */
export interface ReconciliationReading {
  readonly state: "CANNOT_ASSESS" | string | null;
  readonly labelA: string;
  readonly labelB: string;
  readonly countA: number | null;
  readonly countB: number | null;
  /** countA - countB. Present only when both counts are known. */
  readonly delta: number | null;
  readonly reason: string;
}

/**
 * Compare two `CountSource`s under a named divergence label. Pure — no I/O,
 * so it is testable without a filesystem and reused identically by both
 * pairs (requirement §4.7: one module, one shape, for both).
 *
 * CLAIM-MUST-FAIL (brief §4.5): either side missing or unreadable forces
 * CANNOT_ASSESS — there is no path through this function that produces a
 * clean agreement from a source that could not actually be read.
 */
export function compareCounts(
  divergenceName: string,
  labelA: string,
  a: CountSource,
  labelB: string,
  b: CountSource
): ReconciliationReading {
  if (a.state === "CANNOT_ASSESS" || b.state === "CANNOT_ASSESS") {
    return {
      state: "CANNOT_ASSESS",
      labelA,
      labelB,
      countA: a.state === "OK" ? a.count : null,
      countB: b.state === "OK" ? b.count : null,
      delta: null,
      reason: [
        a.state === "CANNOT_ASSESS" ? `${labelA}: ${a.detail}` : null,
        b.state === "CANNOT_ASSESS" ? `${labelB}: ${b.detail}` : null,
      ]
        .filter((x): x is string => x !== null)
        .join(" | "),
    };
  }
  const delta = a.count - b.count;
  if (delta === 0) {
    return {
      state: null, // agreement — a count, never a word
      labelA,
      labelB,
      countA: a.count,
      countB: b.count,
      delta: 0,
      reason: `${labelA} (${a.detail}) agrees with ${labelB} (${b.detail})`,
    };
  }
  return {
    state: divergenceName,
    labelA,
    labelB,
    countA: a.count,
    countB: b.count,
    delta,
    reason:
      `${labelA} holds ${a.count} (${a.detail}); ${labelB} holds ${b.count} ` +
      `(${b.detail}); delta ${delta > 0 ? "+" : ""}${delta}. The fact only — ` +
      `not "N missing, therefore broken".`,
  };
}

// ── Pair A — the registrar's authoritative chain vs the journal ─────────────

export const JOURNAL_BOOK_DIVERGENCE = "JOURNAL_BOOK_DIVERGENCE";

function readAuthoritativeOutcomeCount(refusalLogPath: string): CountSource {
  const look = loadRefusalLog(refusalLogPath);
  if (look.loadState !== "LOADED_VERIFIED") {
    return {
      state: "CANNOT_ASSESS",
      detail: `${refusalLogPath}: loadState=${look.loadState}${look.problem === null ? "" : ` — ${look.problem}`}`,
    };
  }
  const count = look.records.filter((r) => r.kind === "REFUSED" || r.kind === "ACCEPTED").length;
  return { state: "OK", count, detail: `${refusalLogPath}, ${count} outcome record(s)` };
}

function readJournalOutcomeCount(micaLogPath: string): CountSource {
  const log = new MicaLogFile({ path: micaLogPath });
  const loadState = log.getLoadState();
  if (loadState !== LOADED_UNVERIFIED_FILE) {
    return { state: "CANNOT_ASSESS", detail: `${micaLogPath}: loadState=${loadState}` };
  }
  // Scoped to this pair's own writer. mica-log.jsonl is a SHARED journal by
  // design (any moduleId may write to it); comparing a raw total against ONE
  // writer's authoritative chain would blame this pair for a future second
  // writer's own records. moduleId is a declared, typed field — filtering on
  // it is reading what was written, not deriving anything.
  const count = log.getAll().filter((r) => r.moduleId === "mica-registrar").length;
  return { state: "OK", count, detail: `${micaLogPath}, ${count} mica-registrar record(s)` };
}

/**
 * Pair A. Both paths optional — absent means NOT ATTEMPTED, CANNOT_ASSESS,
 * never a default guess at either file's location.
 */
export function assessJournalBookReconciliation(
  refusalLogPath: string | null,
  micaLogPath: string | null
): ReconciliationReading {
  const a: CountSource =
    refusalLogPath === null
      ? { state: "CANNOT_ASSESS", detail: "no --registrar-log was supplied" }
      : readAuthoritativeOutcomeCount(refusalLogPath);
  const b: CountSource =
    micaLogPath === null
      ? { state: "CANNOT_ASSESS", detail: "no --log was supplied" }
      : readJournalOutcomeCount(micaLogPath);
  return compareCounts(JOURNAL_BOOK_DIVERGENCE, "authoritative chain", a, "journal", b);
}

// ── Pair B — the attestation's line count vs a shape-validated count ────────

export const STAMP_SHAPE_DIVERGENCE = "STAMP_SHAPE_DIVERGENCE";

function readShapeValidCount(stampsPath: string): CountSource {
  let raw: string;
  try {
    raw = readFileSync(stampsPath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return {
      state: "CANNOT_ASSESS",
      detail:
        code === "ENOENT"
          ? `${stampsPath} does not exist`
          : `${stampsPath} could not be read (${String(code ?? err)})`,
    };
  }
  let count = 0;
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // a malformed line is not shape-valid; not counted, not fatal to this count
    }
    if (typeof toClockStamp(parsed) !== "string") count++;
  }
  return { state: "OK", count, detail: `${stampsPath}, ${count} shape-valid ClerkClockStamp(s)` };
}

// ── Pair family — any declared principal's own deposit journal vs the ──────
// ── registrar's chain (S111, generalized night of the same session) ────────
//
// SUPERSEDED (the arbiter, S111 night): "generalize — it is just another book." The
// S111-A doctor-only build (`assessDoctorJournalReconciliation`) is gone —
// this is the SAME shape, ONE function, taking (principalName, uid) instead
// of a hardcoded name, so every future narrator costs a roster entry and a
// declaration, never another build.
//
// CROSS-PRINCIPAL, unlike Pair A (same process, two legs of one sweep): count
// A is the PRINCIPAL's own narration (deposit-cli.ts, journaled at deposit
// time, moduleId = the roster-resolved self — see that file's header); count
// B is the REGISTRAR's independent, authoritative attribution of what
// arrived from that principal's uid. Two different principals' books, on
// purpose.
//
// SAME DIVERGENCE NAME AS PAIR A — reused, not reinvented (brief §3.2, "no
// fourth word"): both pairs are the same shape, a self-narrated journal count
// against an authoritative book count. Only the writer differs.
//
// COUNT B IS BUILT ON subjectUid, NEVER subject. Verified at bytes
// (refusal-log.ts): `subject` is a ROSTER LOOKUP and reads null whenever name
// resolution failed or never ran (MALFORMED_DEPOSIT, UNKNOWN_DEPOSITOR) —
// exactly the records where attribution matters most. `subjectUid` is "THE
// KERNEL'S OBSERVATION" (refusal-log.ts's own words): the frame's real file
// owner, present whenever this process could stat the frame at all. Building
// count B on the name would silently undercount a principal's own malformed
// or misrouted deposits; the uid cannot lie about which process owned the
// file.
//
// NO INVENTED PRINCIPAL (R-V3): a uid is never guessed or derived here — it
// comes only from a declaration file an operator wrote (`loadJournalDeclarations`
// below), the same discipline `loadCadenceDeclaration` (DC-2, staleness-alarm.ts)
// already holds for cadence-by-chain. A principal absent from the declaration
// cannot be assessed at all — not a per-principal CANNOT_ASSESS, because there
// is no principal name to attach one to.

function readPrincipalJournalCount(micaLogPath: string, principalName: string): CountSource {
  const log = new MicaLogFile({ path: micaLogPath });
  const loadState = log.getLoadState();
  if (loadState !== LOADED_UNVERIFIED_FILE) {
    return { state: "CANNOT_ASSESS", detail: `${micaLogPath}: loadState=${loadState}` };
  }
  const count = log.getAll().filter((r) => r.moduleId === principalName).length;
  return { state: "OK", count, detail: `${micaLogPath}, ${count} ${principalName} record(s)` };
}

function readPrincipalAttributedOutcomeCount(
  refusalLogPath: string,
  uid: number
): CountSource {
  const look = loadRefusalLog(refusalLogPath);
  if (look.loadState !== "LOADED_VERIFIED") {
    return {
      state: "CANNOT_ASSESS",
      detail: `${refusalLogPath}: loadState=${look.loadState}${look.problem === null ? "" : ` — ${look.problem}`}`,
    };
  }
  const count = look.records.filter(
    (r) => (r.kind === "REFUSED" || r.kind === "ACCEPTED") && r.subjectUid === uid
  ).length;
  // Prose visibility only — never folded into `count`, never compared. These
  // are the frames the kernel itself could not attribute (S111-1's lesson);
  // a name-based filter would have silently miscounted this exact class.
  const nullCount = look.records.filter(
    (r) => (r.kind === "REFUSED" || r.kind === "ACCEPTED") && r.subjectUid === null
  ).length;
  return {
    state: "OK",
    count,
    detail:
      `${refusalLogPath}, ${count} outcome record(s) attributed to uid ${String(uid)}; ` +
      `${nullCount} outcome record(s) carry subjectUid null (unattributable)`,
  };
}

/**
 * One principal's pair. `uid` is never null here — it comes from a validated
 * declaration entry (see `loadJournalDeclarations`); a principal with no
 * usable uid is simply not in the declaration and never reaches this
 * function. Paths stay optional, same as every other pair in this file.
 */
export function assessPrincipalJournalReconciliation(
  principalName: string,
  uid: number,
  micaLogPath: string | null,
  refusalLogPath: string | null
): ReconciliationReading {
  const a: CountSource =
    micaLogPath === null
      ? { state: "CANNOT_ASSESS", detail: "no --log was supplied" }
      : readPrincipalJournalCount(micaLogPath, principalName);
  const b: CountSource =
    refusalLogPath === null
      ? { state: "CANNOT_ASSESS", detail: "no --registrar-log was supplied" }
      : readPrincipalAttributedOutcomeCount(refusalLogPath, uid);
  return compareCounts(
    JOURNAL_BOOK_DIVERGENCE,
    `${principalName}'s own journal`,
    a,
    "registrar's chain (by uid)",
    b
  );
}

// ── the declaration — R8/R-V3, mirrors staleness-alarm.ts's DC-2 pattern ────
//
// A JSON object of `{ "<principal name>": <uid>, ... }`. The arbiter's own file to
// write on the deployment box (like expected-cadence.json and the roster
// itself), NEVER checked in with real uids. Same three-state shape as
// `CadenceDeclaration`: a configured-but-unreadable file is
// CONFIGURED_EMPTY, never ABSENT.

export type JournalDeclarationState = "ABSENT" | "CONFIGURED_EMPTY" | "CONFIGURED";

export interface JournalDeclaration {
  readonly state: JournalDeclarationState;
  readonly source: string; // "none" when no path was even supplied
  /** principal name -> declared uid. Empty unless `state` is CONFIGURED. */
  readonly uidByPrincipal: ReadonlyMap<string, number>;
  readonly problems: readonly string[];
}

/** The state a caller that never supplied `--journal-declarations` reads as. */
export const ABSENT_JOURNAL_DECLARATION: JournalDeclaration = {
  state: "ABSENT",
  source: "none",
  uidByPrincipal: new Map(),
  problems: [],
};

/**
 * Reads the declarations file. Never throws — every failure becomes a state,
 * exactly as `loadCadenceDeclaration` does and for the identical reason: this
 * program's exit code must never ride on whether a deployer's config file
 * parses.
 */
export function loadJournalDeclarations(path: string | null): JournalDeclaration {
  if (path === null) return ABSENT_JOURNAL_DECLARATION;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      state: "CONFIGURED_EMPTY",
      source: path,
      uidByPrincipal: new Map(),
      problems: [
        `journal declarations ${path} could not be read as JSON: ${String(error)}. ` +
          `A configured-but-unreadable declaration is CONFIGURED_EMPTY, never ABSENT: ` +
          `the deployment asked and did not get one.`,
      ],
    };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      state: "CONFIGURED_EMPTY",
      source: path,
      uidByPrincipal: new Map(),
      problems: [`journal declarations ${path} is not a JSON object of principal name -> uid`],
    };
  }

  const problems: string[] = [];
  const map = new Map<string, number>();
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (name.length === 0) {
      problems.push("an empty principal name key was present; skipped");
      continue;
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      problems.push(
        `principal ${JSON.stringify(name)}: declared uid ${JSON.stringify(value)} is not a ` +
          `non-negative integer; skipped — R-V3 forbids guessing one in its place`
      );
      continue;
    }
    map.set(name, value);
  }
  return {
    state: map.size === 0 ? "CONFIGURED_EMPTY" : "CONFIGURED",
    source: path,
    uidByPrincipal: map,
    problems,
  };
}

export interface PrincipalJournalReconciliation {
  readonly principal: string;
  readonly uid: number;
  readonly reading: ReconciliationReading;
}

/**
 * One reading per declared principal, sorted by name so two runs of the same
 * inputs render byte-identically. A NOT-CONFIGURED declaration (ABSENT or
 * CONFIGURED_EMPTY) yields an empty array — CANNOT_ASSESS for the whole
 * family is the caller's to state, naming the declaration's own problem,
 * exactly as the staleness section does for an unusable cadence file.
 */
export function assessDeclaredJournalReconciliations(
  declaration: JournalDeclaration,
  micaLogPath: string | null,
  refusalLogPath: string | null
): readonly PrincipalJournalReconciliation[] {
  if (declaration.state !== "CONFIGURED") return [];
  return [...declaration.uidByPrincipal.keys()].sort().map((principal) => {
    const uid = declaration.uidByPrincipal.get(principal) as number;
    return {
      principal,
      uid,
      reading: assessPrincipalJournalReconciliation(principal, uid, micaLogPath, refusalLogPath),
    };
  });
}

/** Pair B. Reuses `readClerkCallerAttestation` for the line-count side —
 * ONE source of truth for "what that module already counts", never a second,
 * possibly-diverging re-implementation of it. */
export function assessStampShapeReconciliation(stampsPath: string | null): ReconciliationReading {
  if (stampsPath === null) {
    return compareCounts(
      STAMP_SHAPE_DIVERGENCE,
      "attestation line count",
      { state: "CANNOT_ASSESS", detail: "no --clerk-stamps-file was supplied" },
      "shape-valid count",
      { state: "CANNOT_ASSESS", detail: "no --clerk-stamps-file was supplied" }
    );
  }
  const attestation = readClerkCallerAttestation(stampsPath);
  const a: CountSource =
    attestation.stampedRecordCount === null
      ? { state: "CANNOT_ASSESS", detail: `${attestation.state}: ${attestation.reason}` }
      : { state: "OK", count: attestation.stampedRecordCount, detail: attestation.reason };
  const b = readShapeValidCount(stampsPath);
  return compareCounts(STAMP_SHAPE_DIVERGENCE, "attestation line count", a, "shape-valid count", b);
}
