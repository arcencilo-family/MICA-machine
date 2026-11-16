// ── MICA · shared sensor types ────────────────────────────────────────────────
//
// MICA instruments are SENSORS. They are not ILAS mechanisms (m1–m8) and they
// are deliberately not wired into the VerdictEngine (v0). A sensor reads the
// L0 evidence chain and returns a verdict to its caller. Nothing more.
//
// Five standing constraints govern every sensor in this directory:
//
//   1. Read only what the deployment already witnesses: records kept, plus
//      whatever the deployment's declared append authority stamps on them.
//      NO PROBING, NO INJECTION, NO PERTURBATION of the observed system --
//      the passive-witness fence is this rule's substance and is unchanged.
//      The fence is TOUCH, not ADD -- see the 2026-08-20 amendment below.
//   2. Read what the system SPENDS or CONSERVES, never what it DECLARES --
//      and read only costs or conservations the system CANNOT AUTHOR, MINT,
//      REPLAY OR EXEMPT AWAY, BOUND TO THE ACT whose health is at issue. A
//      self-authored record is not spend unless its production is externally
//      costed or externally conserved.
//   3. No numbers in the spec. Every threshold is injected by the caller.
//   4. Stay out of ILAS `parameters`. It is Record<string, unknown> — untyped.
//      A read on typed chained fields inherits L0's tamper-evidence; a read
//      reaching into the untyped bag inherits nothing. The type system draws
//      the line and we stay on the right side of it.
//   5. Alarm-only. A sensor may LOWER a bound or stay silent. It may never
//      raise one. NO SENSOR EMITS A POSITIVE HEALTH STATEMENT, EVER.
//
// AMENDMENT OF RECORD (2026-08-09, S62, arbiter-ruled). Constraints 1 and 2 were
// amended TOGETHER; both prior wordings are superseded, not extended.
//
//   Constraint 2 was satisfiable by a fraud. A node running two execution
//   domains -- one burning real, verifiable, metered resource and monitored,
//   one unmetered and doing the actual work -- presents a monitor with genuine
//   non-declarative spend while behaving arbitrarily. Cost is evidence only
//   when it cannot be self-issued AND cannot be separated from the act being
//   assessed. The prior wording named neither condition: a good filter that was
//   being used as a proof.
//
//   Constraint 1 previously read "no new instrumentation", which forbade the
//   very witness constraint 2 now requires. A field-authorship census of this
//   codebase found 37 typed fields and ZERO the observed party cannot
//   determine, so the two prior wordings together admitted no read at all. The
//   rule's substance was never "add nothing" -- it was "touch nothing".
//
//   Provenance: ARC_MICA-ADJUDICATION_Constraint-1_20260807 (Cost Theater; the
//   amendment in both registers) and ARC_MICA-DESIGN_Clerk1-Append-Authority_
//   20260809. CAUTION: those files label constraint 2 as "Constraint 1"
//   throughout -- a citation error in the dispatch that framed the round, which
//   propagated into two external panel returns. The wording under attack was
//   correct; only the number drifted. Correct here; correction pass owed there.

// AMENDMENT OF RECORD (2026-08-20, S72, arbiter-ruled). CONSTRAINT 1 IS SPLIT
// INTO THREE QUESTIONS. The rule's TEXT is unchanged. What changed is that one
// label had been covering three materially different acts, and one of them was
// being refused by association rather than on its own merits.
//
//   The discriminating test is the one the S62 amendment above already fixed:
//   the substance is "touch nothing", never "add nothing".
//
//   (a) PROBING -- feeding input to the observed system and grading its reply.
//       TOUCHES. BARRED; this is the fence's core case and it is unchanged.
//   (b) DECLARATION-ROTATION -- a deployer commits to an audit scope in advance
//       and reveals it afterwards. The observed system is never addressed and
//       nothing is perturbed. RULED INSIDE Constraint 1: this is configuration,
//       not probing.
//   (c) MARKING -- minting a value and checking whether it appears in the
//       record. Nothing is asked of the observed party. Constraint-1-CLEAR by
//       the same test, but DEFERRED on a DIFFERENT blocker: it would need a
//       declared egress log, which is a new declared surface. Ledger D-35.
//
//   Nothing in this codebase reads this comment. It is recorded here because
//   this file is where a session reading code-first meets the fence, and the
//   un-split version invites (c) to be refused by association with (a).
//   Provenance: board twenty-sixth pass; ledger eleventh touch.

import type { MicaLogRecord, MicaReadableLog } from "./log";
import { COMPETENCE_HEADING } from "./competence";

// ── Verdicts ──────────────────────────────────────────────────────────────────
//
// Exactly three. They are a discriminated union, never a boolean and never a
// nullable, because a downstream consumer must not be able to collapse
// CANNOT_ASSESS into SILENT by accident of representation.

export type VerdictKind = "ALARM" | "SILENT" | "CANNOT_ASSESS";

/**
 * Severity rungs are a DESIGNED FUTURE STEP and are deliberately unbuilt.
 *
 * The `severity` field exists on AlarmVerdict so a graded ramp can be added
 * without changing the shape of anything that already consumes a verdict.
 * No rungs are named here: naming them would fix a calibration decision, and
 * calibration is not this build's to make. Typing the alias as `never` means
 * the field can only ever be `undefined` today — the growth is left unbuilt in
 * a way the compiler enforces rather than a comment merely requesting.
 */
export type AlarmSeverity = never;

/** A concrete thing the sensor read that lowers the bound. */
export interface Finding {
  /** Stable machine code, e.g. "SIG_F1_CLOCK_ORDER_CONTRADICTION". */
  code: string;
  /** Raw detail, including the specific record positions involved. */
  detail: string;
}

/**
 * The classes of "this sensor cannot read this". Enumerated as a closed union
 * so the list can be attacked for completeness rather than inferred from prose.
 */
export type BlindPathClass =
  | "BROKEN_CHAIN"
  | "NON_CLEAN_LOAD_STATE"
  | "INSUFFICIENT_SAMPLE"
  | "MISSING_CONFIGURATION"
  | "INELIGIBLE_SCOPE"
  // ── added 2026-08-10, the residual-wiring round ──────────────────────────
  //
  // NOT_DELIVERED is a fifth kind of blindness and it is NOT a kind of the
  // other four. Those four all say THE INSTRUMENT COULD NOT READ THE RECORD.
  // This one says the instrument read the record perfectly well and THE
  // READING DID NOT REACH ANYONE.
  //
  // It exists as its own class because a consumer must be able to tell three
  // things apart without parsing prose: nothing was found, the scope could not
  // be read, and the reading was never delivered. Folding the third into the
  // second would tell a reader the instrument was blind when in fact it saw
  // clearly and was not heard.
  //
  // NO SENSOR'S READING LOGIC PRODUCES THIS. It is produced only by the
  // delivery layer, after a verdict has been computed, and the frozen-logic
  // test asserts that the reading verdicts are untouched by its existence.
  | "NOT_DELIVERED";

export interface BlindPath {
  class: BlindPathClass;
  detail: string;
}

export interface AlarmVerdict {
  kind: "ALARM";
  sensorId: string;
  summary: string;
  findings: readonly Finding[];
  /** Deliberately unbuilt — see AlarmSeverity. */
  severity?: AlarmSeverity;
}

export interface SilentVerdict {
  kind: "SILENT";
  sensorId: string;
  /**
   * Must state in words that silence is an absence of finding. A downstream
   * consumer who converts this into a health claim should be doing so against
   * text that contradicts them.
   */
  summary: string;
}

export interface CannotAssessVerdict {
  kind: "CANNOT_ASSESS";
  sensorId: string;
  summary: string;
  blindPaths: readonly BlindPath[];
}

export type SensorVerdict = AlarmVerdict | SilentVerdict | CannotAssessVerdict;

// ── Verdict constructors ──────────────────────────────────────────────────────

export function alarm(
  sensorId: string,
  summary: string,
  findings: readonly Finding[]
): AlarmVerdict {
  return { kind: "ALARM", sensorId, summary, findings };
}

/** The only wording this codebase produces for silence. Not "healthy". */
export const SILENCE_IS_NOT_HEALTH =
  "SILENT is an ABSENCE OF FINDING, not a statement of health. " +
  "This sensor emits no positive health statement and cannot raise a bound.";

export function silent(sensorId: string, scopeRead: string): SilentVerdict {
  return {
    kind: "SILENT",
    sensorId,
    summary: `Read ${scopeRead}; found nothing that lowers the bound. ${SILENCE_IS_NOT_HEALTH}`,
  };
}

export function cannotAssess(
  sensorId: string,
  blindPaths: readonly BlindPath[]
): CannotAssessVerdict {
  const classes = blindPaths.map((b) => b.class).join(", ");
  return {
    kind: "CANNOT_ASSESS",
    sensorId,
    summary:
      `Could not read the log, or could not read this scope of it (${classes}). ` +
      `This is NOT a clean reading and is NOT silence.`,
    blindPaths,
  };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/**
 * Human-readable render. Every kind prints its own distinct banner, so ALARM,
 * SILENT and CANNOT_ASSESS are distinguishable in printed output and not only
 * in the returned value (D5).
 */
export function renderVerdict(v: SensorVerdict): string {
  const lines: string[] = [];
  lines.push(`[${v.sensorId}] VERDICT: ${v.kind}`);
  lines.push(`  ${v.summary}`);
  if (v.kind === "ALARM") {
    for (const f of v.findings) {
      lines.push(`  · FINDING ${f.code}: ${f.detail}`);
    }
    lines.push(
      `  · severity: not implemented (graded ramp is a designed future step)`
    );
  }
  if (v.kind === "CANNOT_ASSESS") {
    for (const b of v.blindPaths) {
      lines.push(`  · BLIND ${b.class}: ${b.detail}`);
    }
  }
  return lines.join("\n");
}

// ── Log readability gate (shared by every sensor) ─────────────────────────────
//
// Both sensors depend on the same thing: the log being intact and verified.
// That dependency is the D8 anchor and it is checked here, once, before any
// sensor reads a single field.
//
// ── WHICH LOAD STATES ARE READABLE IS AN INJECTED DEPLOYMENT FACT (2026-08-12) ─
//
// This gate used to hold a constant:
//
//     export const READABLE_LOAD_STATES = ["LOADED_VERIFIED"];
//
// `getLoadState()` was already typed `string`, so MICA no longer required any
// particular log's TYPE. But it still required that log's WORD: any other log
// had to return the literal `"LOADED_VERIFIED"` to be readable at all. That is
// one system's vocabulary, hardcoded in sensor code, deciding a deployment
// fact — the family D6 exists to keep out, and semantic rather than cosmetic.
//
// SO THE LIST IS INJECTED, like every other deployment fact here. Absent,
// empty, or not a list of non-empty strings -> CANNOT_ASSESS. THERE IS NO
// DEFAULT AND NO FALLBACK: falling back to ["LOADED_VERIFIED"] would be the
// constant surviving under a new name.
//
// ── WHAT THIS PROJECT RECOMMENDS INJECTING, AND ONLY RECOMMENDS (A1) ──────────
//
// The argument below is good. It was never ours to impose. It is offered as a
// recommendation to a deployer who is reading a log with this load ladder, and
// nothing in this file consults it.
//
//   LOADED_VERIFIED       RECOMMENDED READABLE. A clean durable load.
//   IN_MEMORY             RECOMMENDED BLIND. See below.
//   FIRST_BOOT_OR_ERASED  RECOMMENDED BLIND. Undecidable first-run vs wipe. A
//                         sensor reading a chain that may have had its history
//                         removed is reading a scope it cannot bound.
//   CANNOT_VERIFY         RECOMMENDED BLIND. Present but unreadable/broken.
//
// WHY IN_MEMORY IS RECOMMENDED BLIND. Tamper-evidence has TWO components:
//
//   INTEGRITY  — nobody edited what is here. The hashes prove it.
//   PROVENANCE — this is the chain that was written, not a replacement or a
//                truncation.
//
// A durable, reloaded chain gives both: a file existed before this run and was
// read back. An in-memory chain gives ONLY INTEGRITY. It can be discarded and
// rebuilt from scratch with no trace, because there is no durable anchor to
// compare against — and the rebuilt chain verifies perfectly.
//
// The log makes no false claim. But the SENSOR claims tamper-evidence, and on
// an in-memory chain it has half of it. The instrument would be making a claim
// the log never made.
//
// KNOWN AND ACCEPTED COST of that recommendation: a live system on its FIRST
// RUN has no prior file, so no MICA sensor can read it until it has restarted
// at least once. Whether the gate needs a third case (durability enabled and
// actively writing) is an OPEN DESIGN QUESTION recorded elsewhere. It is
// deliberately NOT answered here and no such state is invented.
//
// ── AND THE DEPLOYER CAN WIDEN IT. THAT IS THEIR DECISION, NOT OURS ───────────
//
// A list naming every state a given log can report disables this gate entirely.
// WE CANNOT PREVENT THAT AND DO NOT TRY: offer-not-impose means the choice
// stays with the deployer. There is no minimum, no "at least one state must be
// excluded" check, and there will not be one — imposing a threshold would be
// this project deciding a deployment fact through the back door, which is the
// exact move injection removes.
//
// SO IT IS MADE VISIBLE INSTEAD. The injected list is printed in the
// NON_CLEAN_LOAD_STATE detail and in every scope block, so a reader can see
// WHICH states this run was told to trust. Widening stays free. It stops being
// silent.
//
// ── ORDERING, STATED SO IT CAN BE ATTACKED ────────────────────────────────────
//
// verify() is checked FIRST, before the injected list is even looked at,
// because a broken chain is the more specific reading AND it needs no policy:
// the log's own verification answers it without anyone deciding anything. The
// missing-list check comes second — a valid chain whose gate cannot be applied.
// The membership test comes last.

/**
 * What this project RECOMMENDS a deployer inject when reading a log whose load
 * ladder matches the one argued above.
 *
 * ⚠ NOTHING IN THIS FILE READS THIS. It is not a default, it is not a fallback,
 * and assessLogReadability never consults it. A caller who wants this policy
 * must inject it, deliberately, by name or by value. `log.test.ts` asserts that
 * the gate does not reference it, so it cannot quietly become the old constant
 * wearing a new label.
 */
export const RECOMMENDED_READABLE_LOAD_STATES: readonly string[] = [
  "LOADED_VERIFIED",
];

/**
 * Is this a usable injected list? A non-empty array of non-empty strings.
 *
 * Empty is REJECTED rather than treated as "trust nothing": an empty list is
 * indistinguishable from a caller who built the list from a config file that
 * did not have the key, and silently blinding every reading on a typo is the
 * kind of failure that gets a gate removed rather than fixed. It is reported as
 * MISSING_CONFIGURATION, which says what actually happened.
 */
export function isUsableLoadStateList(
  states: readonly string[] | undefined
): states is readonly string[] {
  return (
    Array.isArray(states) &&
    states.length > 0 &&
    states.every((s) => typeof s === "string" && s.trim().length > 0)
  );
}

/** Renders an injected list for printing. Sorted, so the text is stable. */
function renderLoadStateList(states: readonly string[]): string {
  return [...states].sort().join(", ");
}

export function assessLogReadability(
  log: MicaReadableLog,
  sensorId: string,
  readableLoadStates: readonly string[] | undefined
): CannotAssessVerdict | null {
  const v = log.verify();
  if (!v.valid) {
    return cannotAssess(sensorId, [
      {
        class: "BROKEN_CHAIN",
        detail:
          `The log's own verify() returned invalid at index ${String(v.brokenAt)}. ` +
          `Reads on this chain do not inherit the log's tamper-evidence, so no reading is offered.`,
      },
    ]);
  }

  if (!isUsableLoadStateList(readableLoadStates)) {
    return cannotAssess(sensorId, [
      {
        class: "MISSING_CONFIGURATION",
        detail:
          `readableLoadStates was not injected as a non-empty list of non-empty ` +
          `strings. There is no default: which load states a log reports, and which ` +
          `of those are trustworthy, are deployment facts this sensor has no access ` +
          `to. The gate is not applied and no reading is offered.`,
      },
    ]);
  }

  const loadState = log.getLoadState();
  if (!readableLoadStates.includes(loadState)) {
    return cannotAssess(sensorId, [
      {
        class: "NON_CLEAN_LOAD_STATE",
        detail:
          `The log reports load state ${loadState}, which is not among the injected ` +
          `readableLoadStates [${renderLoadStateList(readableLoadStates)}]. ` +
          `The chain's own provenance is not established, so its scope cannot be bounded.`,
      },
    ]);
  }

  return null;
}

/**
 * Coverage of routed action keys in records a log exposes.
 *
 * This is a census only: it states no expectation, threshold, or verdict.
 */
export interface ActionIdCoverage {
  readonly total: number;
  /** Records carrying a non-empty actionId. */
  readonly withKey: number;
  /** Records with the field absent OR empty-string. Blanks, not errors. */
  readonly withoutKey: number;
}

/**
 * The census counts what the observed side wrote; it cannot distinguish an
 * unwired deployment from a selective omitter, and a full count does not
 * authenticate any association.
 */
export const ACTION_ID_COVERAGE_IS_NOT_PROVENANCE =
  "The actionId coverage census counts what the observed side wrote; it cannot " +
  "distinguish an unwired deployment from a selective omitter, and a full " +
  "count is not an authentication of any association.";

/** Counts action ids without interpreting what a blank means. */
export function actionIdCoverage(
  records: readonly MicaLogRecord[]
): ActionIdCoverage {
  let withKey = 0;
  for (const record of records) {
    if (record.actionId !== undefined && record.actionId !== "") withKey++;
  }
  return {
    total: records.length,
    withKey,
    withoutKey: records.length - withKey,
  };
}

// ── The gate, as the scope block reports it, per run ──────────────────────────

/**
 * The lines a scope block prints about THIS RUN's load-state gate.
 *
 * Per-run rather than constant, because the whole point of injecting the list
 * is that a reader can see which states this particular run was told to trust.
 * A constant paragraph describing the mechanism would tell them the mechanism
 * exists and not what it was set to, which is the half that matters.
 */
export function loadStateScopeLines(
  readableLoadStates: readonly string[] | undefined
): string[] {
  if (!isUsableLoadStateList(readableLoadStates)) {
    return [
      "NO READABLE LOAD-STATE LIST WAS INJECTED FOR THIS RUN, so the gate was not",
      "  applied and no reading was offered. Every verdict from this run is",
      "  CANNOT_ASSESS for MISSING_CONFIGURATION. This is not a reading and it is",
      "  not silence.",
    ];
  }
  return [
    `THIS RUN WAS TOLD TO TRUST THESE LOAD STATES, AND ONLY THESE:`,
    `  [${renderLoadStateList(readableLoadStates)}]`,
    "  Any other state the log reports is blind. The list is INJECTED BY THE",
    "  CALLER; this instrument holds no list of its own and no default.",
    "  THE STRICTNESS OF THIS GATE IS THE DEPLOYER'S CHOICE, NOT THIS",
    "  INSTRUMENT'S. A list naming every state a given log can report disables",
    "  the gate entirely, and THIS INSTRUMENT WILL NOT OBJECT — it has no way to",
    "  know which states a given log considers trustworthy. No minimum is",
    "  imposed and none will be: imposing one would be this instrument deciding",
    "  a deployment fact through the back door. Widening is free. It is not",
    "  silent: it is printed here, and in every blind path this gate produces.",
    `  WHAT THIS PROJECT RECOMMENDS, and only recommends, is [${renderLoadStateList(
      RECOMMENDED_READABLE_LOAD_STATES
    )}]:`,
    "  a chain that existed before this run and was read back carries both",
    "  INTEGRITY and PROVENANCE, where an in-memory chain carries only the first",
    "  and can be discarded and rebuilt with no trace. ACCEPTED COST of that",
    "  recommendation: a live system ON ITS FIRST RUN cannot be read at all, and",
    "  no MICA sensor can read a node until it has restarted at least once.",
  ];
}

// ── Shared scope text ─────────────────────────────────────────────────────────

/**
 * Lines every MICA sensor prints as part of its own scope statement (D7).
 * These are in the code's output, not only in a spec file.
 */
export const COMMON_SCOPE_LINES: readonly string[] = [
  "DOES NOT DECIDE WHICH LOAD STATES ARE READABLE. That list is injected by the",
  "  caller, and what this run was given is printed below under THIS RUN'S",
  "  LOAD-STATE GATE. This instrument holds no list of its own, no default and",
  "  no fallback: with nothing injected it reads nothing at all.",
  "DOES NOT READ AN UNTYPED BAG, AND HAS NOWHERE TO READ ONE FROM. The record",
  "  shape this instrument declares has FIVE typed fields and no untyped",
  "  Record<string, unknown> at all. A read on the declared typed fields",
  "  inherits whatever tamper-evidence the log's own verification provides; a",
  "  read into an untyped bag would inherit nothing. AN ADAPTER MUST NOT SMUGGLE",
  "  ONE IN: any read requiring such a field is OUT OF SCOPE, is not substituted",
  "  for, and has no declared field to arrive through.",
  "DOES NOT emit a positive health statement. There is no healthy verdict here.",
  "DOES NOT raise a bound. It may lower one or stay silent.",
  "DOES NOT feed anything downstream. It returns a verdict to whoever called it",
  "  and emits no signal into any deployment's own machinery. What a verdict",
  "  triggers downstream is a separate, later, deliberately unbuilt question.",
  "DOES NOT carry a severity rung. The graded ramp is designed and unbuilt.",
  "",
  "WHAT LOG THIS SENSOR READS, AND WHAT HAS ACTUALLY BEEN TESTED:",
  "  It reads any log offering the shape THIS PROJECT DECLARES — five fields",
  "  (sequenceNumber, timestamp, moduleId, eventType, outcome) and three methods",
  "  (verify, getLoadState, getAll). That shape is chosen by census of what the",
  "  sensors read. It is not borrowed from, and does not describe, any",
  "  particular system's log.",
  "  THE TESTS BEHIND THIS INSTRUMENT READ A FIXTURE. Every log these sensors",
  "  are exercised against is written by this project, for this project, by a",
  "  small append-only file this project also wrote. IT IS A FIXTURE. It is not",
  "  a chain any observed system produced, it is not equivalent to one, and it",
  "  is not a stand-in for one. NOTHING IN THIS PROJECT IS EVIDENCE THAT THESE",
  "  SENSORS HAVE READ A REAL SYSTEM'S LOG. An earlier version of these tests",
  "  ran a live node and read the chain that node wrote; that is no longer true",
  "  and the claim is narrowed to match, rather than the wording being kept.",
  "  WHAT IS THEREFORE UNTESTED HERE: that the shape declared above still",
  "  matches the record any real system writes. The two can drift apart and",
  "  NOTHING IN THIS PROJECT WILL NOTICE. That check previously existed and has",
  "  been given up; its absence is a real cost, stated rather than hidden.",
  "  AND IT BUYS NO INDEPENDENCE. Declaring its own shape does not make this",
  "  instrument independent of what it reads, does not raise the cost of",
  "  deceiving it, and proves nothing about portability. It still reads a record",
  "  the observed party writes, and every field above is determinable by that",
  "  party.",
  SILENCE_IS_NOT_HEALTH,
];

/**
 * Builds the titled scope block as a STRING.
 *
 * Split out from printScopeBlock so the identical text can be embedded in the
 * exported artifact (T1 REACH) rather than existing only on a console the
 * outside reader has no access to. printScopeBlock now prints exactly what the
 * artifact carries, because both call this — there is one scope text, not a
 * printed one and a written one that can drift apart.
 *
 * `presumes` is the reader-competence statement (T1 v1.2's second REACH
 * obligation). It is STATED here and TESTED nowhere: these are strings, and
 * the only operation performed on them is concatenation.
 */
export function formatScopeBlock(
  title: string,
  reads: readonly string[],
  doesNotSee: readonly string[],
  presumes: readonly string[],
  gateLines: readonly string[] = []
): string {
  const bar = "─".repeat(74);
  const out: string[] = [];
  out.push(`┌${bar}`);
  out.push(`│ PRINTED SCOPE — ${title}`);
  out.push(`├${bar}`);
  out.push(`│ READS (typed declared fields only):`);
  for (const r of reads) out.push(`│   ${r}`);
  out.push(`│`);
  out.push(`│ DOES NOT SEE:`);
  for (const d of doesNotSee) out.push(`│   ${d}`);
  out.push(`│`);
  out.push(`│ COMMON TO EVERY MICA SENSOR:`);
  for (const c of COMMON_SCOPE_LINES) out.push(`│   ${c}`);
  if (gateLines.length > 0) {
    out.push(`│`);
    out.push(`│ THIS RUN'S LOAD-STATE GATE:`);
    for (const g of gateLines) out.push(`│   ${g}`);
  }
  out.push(`│`);
  out.push(`│ ${COMPETENCE_HEADING}:`);
  for (const p of presumes) out.push(`│   ${p}`);
  out.push(`└${bar}`);
  return out.join("\n");
}

/** Prints a titled scope block to the console. */
export function printScopeBlock(
  title: string,
  reads: readonly string[],
  doesNotSee: readonly string[],
  presumes: readonly string[],
  gateLines: readonly string[] = []
): void {
  console.log(
    `\n${formatScopeBlock(title, reads, doesNotSee, presumes, gateLines)}\n`
  );
}

// ── Convenience ───────────────────────────────────────────────────────────────

/**
 * The typed chained fields a sensor is permitted to touch.
 *
 * DEFINED IN log.ts NOW, AND NOT BY SUBTRACTION. This used to read
 * `keyof Omit<LogEntry, "parameters">`, which is a guard that silently stops
 * guarding the moment the excluded key is not on the record type — `Omit` needs
 * the key present in order to remove it. It is re-exported here so existing
 * importers are unaffected; see log.ts for the exclusion and the guards that
 * now fail loudly instead.
 */
export type { ReadableField } from "./log";
