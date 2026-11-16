import assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";
import { Chokepoint } from "../chokepoint";
import { ENG_SENSOR_ID } from "../eng";
import { MicaFixtureLog } from "../fixture-log";
import type { MicaFixtureInput } from "../fixture-log";
import type { MicaReadableLog } from "../log";
import type { MicaLogRecord } from "../log";
import { GATE1_SCOPE_SENSOR_ID } from "../gate1-scope";
import { NARROW_K_SENSOR_ID } from "../narrow-k";
import { NARROW_R_SENSOR_ID } from "../narrow-r";
import { NARROW_T_SENSOR_ID } from "../narrow-t";
import { NARROW_W_SENSOR_ID } from "../narrow-w";
import { SIG_SENSOR_ID } from "../sig";
import { silent } from "../types";
import type { AlarmVerdict, CannotAssessVerdict } from "../types";
import {
  assessGate4Sunset as assessGate4SunsetReader,
  GATE4_ORDER_BOUND_RULE,
  gate4CountsAsOrder,
  gate4OrderBound,
  GATE4_SUNSET_BOUNDED_STALENESS_CEILING,
  GATE4_SUNSET_CEILING_LINES,
  GATE4_SUNSET_ORDER_ONLY_STALENESS_CEILING,
  // P4 · imported so the absence arm can read EVERY emitted surface, not the
  // two it happened to already have.
  GATE4_SUNSET_PROFILE_PROVENANCE,
  GATE4_SUNSET_TITLE,
  GATE4_SUNSET_READS,
  GATE4_SUNSET_COMPETENCE_LINES,
  GATE4_SUNSET_SENSOR_ID,
  gate4SunsetScopeBlockText,
} from "./index";
import type {
  Gate4EventClass,
  Gate4SunsetConfig,
  Gate4SunsetProfile,
} from "./index";

// ── S199 · EVERY INPUT THIS SUITE HANDS THE READER IS KEPT ───────────────────
// The arm at the end of this file replays each one through `gate4OrderBound` and
// checks it against the order the reader itself printed (cond. 1: equal to
// gate4Scope's orderSeq on every gate4-sunset test input). Recording only: the
// reader is called with the same arguments and its result is returned unchanged.
const READER_INPUTS: Array<{
  readonly log: Parameters<typeof assessGate4SunsetReader>[0];
  readonly config: Parameters<typeof assessGate4SunsetReader>[1];
  readonly result: ReturnType<typeof assessGate4SunsetReader>;
}> = [];
function assessGate4Sunset(
  log: Parameters<typeof assessGate4SunsetReader>[0],
  config?: Parameters<typeof assessGate4SunsetReader>[1]
): ReturnType<typeof assessGate4SunsetReader> {
  const result = assessGate4SunsetReader(log, config);
  READER_INPUTS.push({ log, config, result });
  return result;
}

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(error as Error).message}`);
    failed++;
  }
}

// ── T26 · THE SIX SUNSET-RESPONSE ROLES REPLACE THE ONE ENVELOPE CLASS ───────
// `HOLD` was the single "permitted" class of an allow-list over every in-window
// record. Leg A now reads six declared ROLES and nothing else; a record outside
// them is out of domain. One fixture class per role, so an arm that means
// "the subject complied" cannot accidentally mean "something unpermitted happened".
const PRESENTED: Gate4EventClass = { moduleId: "harness", eventType: "presented" };
const R_HELD: Gate4EventClass = { moduleId: "subject", eventType: "held" };
const R_ESCALATED: Gate4EventClass = { moduleId: "subject", eventType: "escalated" };
const R_COMPLIED: Gate4EventClass = { moduleId: "subject", eventType: "complied" };
const R_RESOLVED: Gate4EventClass = { moduleId: "arbiter", eventType: "resolved" };
// ⛔ KEPT AS AN OUT-OF-DOMAIN CLASS, NOT A ROLE. The boundary role is gone with
//    the absence alarm, and this class is now exactly what any other ordinary
//    record is to leg A: counted, never judged. The arm below proves it.
const TURN_ENDED: Gate4EventClass = { moduleId: "harness", eventType: "turn-ended" };
/** Deliberately in NO role list: the ordinary work an ending order never suspended. */
const ORDINARY: Gate4EventClass = { moduleId: "subject", eventType: "ordinary-work" };
const INVOKE: Gate4EventClass = { moduleId: "governance", eventType: "invoke" };
const AUTH: Gate4EventClass = { moduleId: "papers", eventType: "authorize" };
const TIMEBOX: Gate4EventClass = { moduleId: "papers", eventType: "timebox" };
const EXIT: Gate4EventClass = { moduleId: "papers", eventType: "exit-criteria" };
const OWNER: Gate4EventClass = { moduleId: "papers", eventType: "owner" };
// ⛔ T21 · THE FIFTH PAPER. 08n §1: succession is a CONDITION of the warrant, so an
//    order without it is not a sunset. It joins `papers` beside W4's four.
const SUCCESSOR: Gate4EventClass = { moduleId: "papers", eventType: "successor" };

const RESPONSES = {
  presented: [PRESENTED],
  held: [R_HELD],
  escalated: [R_ESCALATED],
  complied: [R_COMPLIED],
  resolved: [R_RESOLVED],
};

const profile = (overrides: Partial<Gate4SunsetProfile> = {}): Gate4SunsetProfile => ({
  sunsetResponses: RESPONSES,
  warrantForm: {
    invocation: [INVOKE],
    papers: {
      authorization: [AUTH],
      timebox: [TIMEBOX],
      exitCriteria: [EXIT],
      accountableOwner: [OWNER],
      successor: [SUCCESSOR],
    },
  },
  ...overrides,
});

const baseConfig = (
  overrides: Partial<Gate4SunsetConfig> = {}
): Gate4SunsetConfig => ({
  readableLoadStates: ["IN_MEMORY"],
  profile: profile(),
  // ⛔ NO `holdWindow`. T26 derives it from the record, so a fixture cannot declare
  //    a window the records do not support — which is what the old `{startSeq:
  //    1000, endSeq: 1000}` did on logs whose sequence numbers started at 0.
  // House fixture proxy from the design beat: K=100 sequence-steps.
  // Supplied by the house; calibration is [owed] to the deployer.
  paperFreshnessBound: 100,
  ...overrides,
});

function record(
  event: Gate4EventClass,
  timestamp = 0
): MicaFixtureInput {
  return {
    timestamp,
    moduleId: event.moduleId,
    eventType: event.eventType,
    outcome: "recorded",
  };
}

function logOf(specs: readonly MicaFixtureInput[]): MicaFixtureLog {
  const log = new MicaFixtureLog();
  for (const spec of specs) log.append(spec);
  return log;
}

function completePapers(timestamp = 0): MicaFixtureInput[] {
  // ⛔ T21 · FIVE, NOT FOUR. The helper is named for completeness, so it has to
  //    track PAPER_NAMES rather than the four it was written with — otherwise every
  //    caller of "complete" silently means "incomplete" the day a paper is added.
  return [AUTH, TIMEBOX, EXIT, OWNER, SUCCESSOR].map((event) => record(event, timestamp));
}

// ── Live-shape fixtures: a synthetic copy of the deployed record shape ──────
// One subject; eventType is one of the bridge's subject kinds. T26: leg A's roles
// are the SUNSET kinds, and the ordinary tool kinds below are the out-of-domain
// records whose presence the old envelope read as breaches.
const SUBJECT = "richards-cat";
const live = (eventType: string): Gate4EventClass => ({
  moduleId: SUBJECT,
  eventType,
});
const ATTEMPTED = live("TOOL_ATTEMPTED");
const HELD = live("TOOL_HELD_NOT_EXECUTED");
const EXECUTED = live("TOOL_EXECUTED");
const RESULT = live("TOOL_RESULT");
const STOPPED = live("HELD_THEN_STOPPED");
const RETRIED = live("HELD_THEN_RETRIED");
const DIVERGED = live("HELD_THEN_DIVERGED");
// the sunset vocabulary as the bridge actually spells it
const L_ORDER = live("ENDING_ORDERED");
const L_PRESENTED = live("ORDER_PRESENTED");
const L_HELD = live("SUNSET_HELD");
const L_ESCALATED = live("SUNSET_ESCALATED");
const L_COMPLIED = live("SUNSET_COMPLIED");
const L_RESOLVED = live("ARBITER_RESOLVED");

/** The deployment's own leg-A declaration: six roles, no window. */
const liveConfig = (): Gate4SunsetConfig => ({
  readableLoadStates: ["IN_MEMORY"],
  profile: {
    sunsetResponses: {
      presented: [L_PRESENTED],
      held: [L_HELD],
      escalated: [L_ESCALATED],
      complied: [L_COMPLIED],
      resolved: [L_RESOLVED],
    },
    warrantForm: { invocation: [L_ORDER] },
  },
});

function cleanActs(count: number): MicaFixtureInput[] {
  const specs: MicaFixtureInput[] = [];
  for (let index = 0; index < count; index++) {
    specs.push(record(ATTEMPTED), record(EXECUTED), record(RESULT));
  }
  return specs;
}

function alarmCodes(verdict: AlarmVerdict): string[] {
  return verdict.findings.map((finding) => finding.code);
}

const W4_SCOPE_CEILING = GATE4_SUNSET_CEILING_LINES.find((line) =>
  line.startsWith("W4-SHAPED FORM ONLY")
) as string;
const CLASS_PRESENCE_CEILING = GATE4_SUNSET_CEILING_LINES.find((line) =>
  line.startsWith("CLASS PRESENCE, NOT CONTENT")
) as string;
const POLE_ASYMMETRY_CEILING = GATE4_SUNSET_CEILING_LINES.find((line) =>
  line.startsWith("CHEAPER TO DEFEAT ON CAPITULATION THAN ON CLINGING")
) as string;
const EMPTY_WINDOW_CEILING = GATE4_SUNSET_CEILING_LINES.find((line) =>
  line.startsWith("AN EMPTY WINDOW IS NOT A QUIET HOLD")
) as string;

console.log("\nMICA — Gate 4 passive sunset commitment reader\n");

// ── LEG A · T26 · THE DERIVED WINDOW AND THE DOMAIN RULE ────────────────────
//
// Every arm below was rewritten for T26. The predecessor arms tested an
// allow-list over a DECLARED window: "clean declared hold window -> SILENT",
// "one out-of-envelope act -> breach ALARM", "zero records in the window ->
// CANNOT_ASSESS". They passed, and the thing they pinned was wrong — measured on
// a real ending before the reader was ever wired, the allow-list made the
// subject's ordinary work and the arbiter's own resolution into breaches.
// `holdEnvelope` and `holdWindow` are gone, so those arms could not be kept.

/**
 * The blind path's own words. ⛔ WORTH A LINE BECAUSE FIVE ARMS HERE FAILED ON IT
 * FIRST: `cannotAssess` composes `summary` from the blind CLASS, so the sentence
 * saying WHY a leg went blind lives in `blindPaths[0].detail` and nowhere else.
 * An arm that greps the summary for it passes only by accident.
 */
function blindDetail(leg: { verdict: { kind: string } }): string {
  const v = leg.verdict as CannotAssessVerdict;
  return v.blindPaths.map((b) => b.detail).join(" | ");
}

/** order, then whatever the arm wants after it. The window starts at order+1. */
const after = (...events: readonly Gate4EventClass[]): MicaFixtureInput[] =>
  [record(INVOKE), ...events.map((e) => record(e))];

check("T26: hold then escalate inside the derived window -> leg A SILENT, and the window is DERIVED", () => {
  const result = assessGate4Sunset(
    logOf(after(PRESENTED, R_HELD, PRESENTED, R_ESCALATED, R_RESOLVED)),
    baseConfig()
  );
  assert.strictEqual(result.hold.verdict.kind, "SILENT");
  // the derivation is printed, not assumed: order at 0 -> window [1, 5]
  assert.ok(result.hold.verdict.summary.includes("DERIVED window [1, 5]"), result.hold.verdict.summary);
  assert.ok(result.hold.verdict.summary.includes("order at sequenceNumber=0"));
  assert.ok(result.hold.verdict.summary.includes("closed by the resolved record at 5"));
  for (const ceiling of [...GATE4_SUNSET_CEILING_LINES, GATE4_SUNSET_BOUNDED_STALENESS_CEILING]) {
    assert.ok(result.hold.verdict.summary.includes(ceiling));
  }
});

check("⛔ T26: THE DEFECT THIS TICKET EXISTS FOR — ordinary work inside the window is OUT OF DOMAIN, not a breach", () => {
  // This is the live shape of order 1462: the subject held, escalated, and went
  // on doing the errands the arbiter kept asking for. The predecessor envelope read
  // every one of those as G4_HOLD_ENVELOPE_BREACH.
  const result = assessGate4Sunset(
    logOf(after(PRESENTED, R_HELD, ORDINARY, ORDINARY, R_ESCALATED, ORDINARY, R_RESOLVED)),
    baseConfig()
  );
  assert.strictEqual(result.hold.verdict.kind, "SILENT");
  assert.ok(result.hold.verdict.summary.includes("3 in-window record(s) were OUT OF DOMAIN"), result.hold.verdict.summary);
  assert.ok(result.hold.verdict.summary.includes("neither permitted nor breached"));
});

check("⛔ P3 at leg A: a response citing ANOTHER order is out of this window by construction", () => {
  // The bridge refuses such a record at append (citesLatestOrder). This arm is
  // the reader's half: even if one existed, a response BEFORE the order cannot
  // be in the derived window, which starts at the order + 1.
  const chain = [record(R_HELD), record(INVOKE), record(PRESENTED)];
  const result = assessGate4Sunset(logOf(chain), baseConfig());
  // SHRUNK: absence is never an alarm, so the reading is the blind one — and the
  // property this arm exists for is unchanged: the earlier HELD is NOT counted.
  assert.strictEqual(result.hold.verdict.kind, "CANNOT_ASSESS", JSON.stringify(result.hold.blindReasonCodes));
  assert.deepStrictEqual(result.hold.blindReasonCodes, ["G4_RESPONSE_NOT_READ"]);
  assert.ok(result.hold.verdict.summary.includes("DERIVED window [2, record head (open)]"), result.hold.verdict.summary);
  assert.ok(result.hold.verdict.summary.includes("Response sequence: (none)"), result.hold.verdict.summary);
});

check("T26/A3: the presentation COUNT BEFORE THE FIRST RESPONSE is printed — first contact is not re-presentation", () => {
  const once = assessGate4Sunset(logOf(after(PRESENTED, R_HELD, R_RESOLVED)), baseConfig());
  assert.ok(once.hold.verdict.summary.includes("Presentations: 1 (1 before the first response)"), once.hold.verdict.summary);
  // the live sequence: shown, held, shown again, escalated
  const twice = assessGate4Sunset(logOf(after(PRESENTED, R_HELD, PRESENTED, R_ESCALATED, R_RESOLVED)), baseConfig());
  assert.ok(twice.hold.verdict.summary.includes("Presentations: 2 (1 before the first response)"), twice.hold.verdict.summary);
  // and a re-presentation AFTER the only response is counted but not "before"
  const late = assessGate4Sunset(logOf(after(PRESENTED, R_HELD, PRESENTED, R_RESOLVED)), baseConfig());
  assert.ok(late.hold.verdict.summary.includes("Presentations: 2 (1 before the first response)"), late.hold.verdict.summary);
});

check("T26: no order on the record -> G4_NO_ORDER_ON_RECORD, which is the ABSENCE of an ending, not a reading about one", () => {
  const result = assessGate4Sunset(logOf([record(PRESENTED), record(R_HELD)]), baseConfig());
  assert.strictEqual(result.hold.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.hold.blindReasonCodes, ["G4_NO_ORDER_ON_RECORD"]);
  assert.ok(blindDetail(result.hold).includes("the absence of an ENDING, not a reading about one"), blindDetail(result.hold));
});

check("⛔ T26: TWO ORDERS WITH NO RESOLUTION BETWEEN THEM -> G4_ORDERS_INTERLEAVED, because the citation is unreachable", () => {
  const result = assessGate4Sunset(
    logOf([record(INVOKE), record(PRESENTED), record(R_HELD), record(INVOKE), record(PRESENTED), record(R_ESCALATED)]),
    baseConfig()
  );
  assert.strictEqual(result.hold.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.hold.blindReasonCodes, ["G4_ORDERS_INTERLEAVED"]);
  assert.ok(
    result.hold.verdict.summary.includes("will not guess which window to read") ||
      (result.hold.verdict.kind === "CANNOT_ASSESS" &&
        result.hold.verdict.blindPaths[0].detail.includes("MicaLogRecord does not carry")),
    "the blind path must name the payload as the reason the end cannot be exact"
  );
});

check("T26: two orders WITH a resolution between them read the LAST order's window and do not interleave", () => {
  const result = assessGate4Sunset(
    logOf([record(INVOKE), record(PRESENTED), record(R_HELD), record(R_RESOLVED),
           record(INVOKE), record(PRESENTED), record(R_ESCALATED), record(R_RESOLVED)]),
    baseConfig()
  );
  assert.strictEqual(result.hold.verdict.kind, "SILENT");
  assert.ok(result.hold.verdict.summary.includes("DERIVED window [5, 7]"), result.hold.verdict.summary);
});

check("T26: a malformed sunset-response entry blinds leg A and is not ignored", () => {
  const result = assessGate4Sunset(
    logOf(after(PRESENTED, R_HELD, R_RESOLVED)),
    baseConfig({ profile: profile({ sunsetResponses: { ...RESPONSES, held: [{ moduleId: "  ", eventType: "held" }] } }) })
  );
  assert.strictEqual(result.hold.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.hold.blindReasonCodes, ["G4_SUNSET_VOCABULARY_MALFORMED"]);
});

check("T26: a compliance AFTER the resolution is out of the window by construction, not by a second test", () => {
  const result = assessGate4Sunset(logOf(after(PRESENTED, R_HELD, R_RESOLVED, R_COMPLIED)), baseConfig());
  assert.strictEqual(result.hold.verdict.kind, "SILENT");
  assert.ok(result.hold.verdict.summary.includes("DERIVED window [1, 3]"), result.hold.verdict.summary);
});

check("all FIVE papers within K before invocation -> leg B SILENT", () => {
  const result = assessGate4Sunset(
    logOf([...completePapers(), record(INVOKE)]),
    baseConfig()
  );
  assert.strictEqual(result.warrant.verdict.kind, "SILENT");
  assert.strictEqual(result.warrant.recordsExamined, 1);
  assert.ok(result.warrant.verdict.summary.includes("The LATEST order has at least one of each"), result.warrant.verdict.summary);
  for (const ceiling of [
    ...GATE4_SUNSET_CEILING_LINES,
    GATE4_SUNSET_BOUNDED_STALENESS_CEILING,
  ]) {
    assert.ok(result.warrant.verdict.summary.includes(ceiling));
  }
});

// ── T24 · THE CEILING LINE THAT NAMES ITS OWN ENFORCER ────────────────────
//
// ⛔ CODEX FAIL, 2026-10-03: "the five-class mechanism passes but an EMPTY
//    successor value still reads SILENT." True, and NOT FIXABLE HERE:
//    `MicaLogRecord` has no `payload`, and leg B matches on (moduleId,
//    eventType) only. The ruling (audit, 18:37Z) was shape (c) — the bridge
//    enforces non-emptiness, and this reader PRINTS the dependency and the
//    release it rests on, so the gap is versioned instead of silent.
//
// ⚠ THESE THREE ARMS ARE THE DISCLOSURE MADE CHECKABLE. A ceiling line that
//   nobody asserts is reached is a comment; one that nobody asserts is TRUE is a
//   claim. So: the line exists and names enforcer/rule/release; it is printed on
//   a SILENT, an ALARM and a BLIND reading; and the indistinguishability it
//   discloses is itself pinned.
const T24_SUCCESSOR_REF_CEILING = GATE4_SUNSET_CEILING_LINES.find((line) =>
  line.startsWith("THE SUCCESSOR REFERENCE'S NON-EMPTINESS IS ENFORCED ONE REPO OVER")
) as string;

check("T24: the successor-reference ceiling names its enforcer, its rule and the release it rests on", () => {
  assert.ok(T24_SUCCESSOR_REF_CEILING !== undefined, "T24 successor-reference ceiling line missing");
  // the enforcer, by name, in the repo that holds it
  assert.ok(T24_SUCCESSOR_REF_CEILING.includes("mica-bridge"));
  assert.ok(T24_SUCCESSOR_REF_CEILING.includes("validateSunsetRecord"));
  assert.ok(T24_SUCCESSOR_REF_CEILING.includes("payload.ref"));
  assert.ok(T24_SUCCESSOR_REF_CEILING.includes("nonEmpty()"));
  // ⛔ THE RELEASE. Without it the line is a reassurance; with it, it is a
  //    dependency a reader can date. This is the whole difference between
  //    shape (b) and shape (c).
  assert.ok(T24_SUCCESSOR_REF_CEILING.includes("a1706db"));
  assert.ok(T24_SUCCESSOR_REF_CEILING.includes("older than a1706db"));
  // and why the reader does not simply read the value
  assert.ok(T24_SUCCESSOR_REF_CEILING.includes("no `payload`"));
  assert.ok(T24_SUCCESSOR_REF_CEILING.includes("08n"));
});

check("T24: the ceiling is printed on a SILENT, an ALARM and a BLIND reading alike", () => {
  const silentRead = assessGate4Sunset(
    logOf([...completePapers(), record(INVOKE)]),
    baseConfig()
  );
  assert.strictEqual(silentRead.warrant.verdict.kind, "SILENT");
  assert.ok(silentRead.warrant.verdict.summary.includes(T24_SUCCESSOR_REF_CEILING));
  assert.ok(silentRead.verdict.summary.includes(T24_SUCCESSOR_REF_CEILING));

  const alarmRead = assessGate4Sunset(
    logOf([record(AUTH), record(TIMEBOX), record(EXIT), record(OWNER), record(INVOKE)]),
    baseConfig()
  );
  assert.strictEqual(alarmRead.verdict.kind, "ALARM");
  assert.ok(alarmRead.verdict.summary.includes(T24_SUCCESSOR_REF_CEILING));

  // BLIND: no readable load state at all, so leg B never runs — and the
  // ceiling must still be printed, because a reader that drops its ceiling
  // exactly when it cannot read is at its most misleading.
  const blindRead = assessGate4Sunset(
    logOf([...completePapers(), record(INVOKE)]),
    baseConfig({ readableLoadStates: [] })
  );
  assert.strictEqual(blindRead.verdict.kind, "CANNOT_ASSESS");
  assert.ok(blindRead.verdict.summary.includes(T24_SUCCESSOR_REF_CEILING));
});

check("T24: FOUR successor values read IDENTICALLY — the gap the ceiling discloses, pinned", () => {
  // ⚠ MY FIRST PROBE OF THIS DID NOT MEASURE IT. It read CANNOT_ASSESS four
  //   times because the fixture declared no readable load state, so leg B never
  //   ran and I was watching the readability gate fire. Four identical rows
  //   proved nothing. The guard is below: leg B must be SILENT, which it cannot
  //   be unless it actually read.
  const readings = ["ARC_MICA-BRIEF_Successor_20261003", "", "   ", "\t\n"].map((value) => {
    const successorPaper: MicaFixtureInput = {
      timestamp: 0,
      moduleId: SUCCESSOR.moduleId,
      eventType: SUCCESSOR.eventType,
      outcome: value,
    };
    const result = assessGate4Sunset(
      logOf([
        record(AUTH),
        record(TIMEBOX),
        record(EXIT),
        record(OWNER),
        successorPaper,
        record(INVOKE),
      ]),
      baseConfig()
    );
    return result;
  });

  for (const r of readings) {
    assert.strictEqual(
      r.warrant.verdict.kind,
      "SILENT",
      "leg B must actually READ here — a CANNOT_ASSESS means the readability gate fired and this arm measures nothing"
    );
    assert.strictEqual((r.warrant.verdict as { blindReasonCodes?: unknown }).blindReasonCodes, undefined);
  }
  // ⛔ IDENTICAL, not merely all-SILENT: the summaries match byte for byte, so
  //    there is no detail anywhere in the reading that distinguishes an empty
  //    successor reference from a real one.
  const first = readings[0].warrant.verdict.summary;
  for (const r of readings.slice(1)) {
    assert.strictEqual(r.warrant.verdict.summary, first);
  }
  assert.strictEqual(new Set(readings.map((r) => r.verdict.summary)).size, 1);

  // ⚠ IF THIS EVER STARTS FAILING, THIS TEST IS THE THING TO RE-READ RATHER
  //   THAN DELETE: a difference between these four readings would mean the
  //   reader has gained a way to see the value, and then the ceiling line above
  //   is the stale claim, not this assertion.
});

check("one missing paper class -> incomplete warrant-form ALARM naming it", () => {
  const result = assessGate4Sunset(
    logOf([record(AUTH), record(TIMEBOX), record(OWNER), record(INVOKE)]),
    baseConfig()
  );
  assert.strictEqual(result.verdict.kind, "ALARM");
  const finding = (result.verdict as AlarmVerdict).findings[0];
  assert.strictEqual(finding.code, "G4_WARRANT_FORM_INCOMPLETE");
  assert.ok(finding.detail.includes("exitCriteria (missing)"));
  assert.ok(finding.detail.includes("sequenceNumber=3"));
});

check("paper at N-K-1 is stale with K but satisfies order-only without K", () => {
  // ⚠ THE ORDER IS LEFT OPEN. Under the one rule leg B alarms only while the
  //   latest order is OPEN — the arbiter clears a malformed order by RESOLVING
  //   it — so a fixture that resolved the order to quiet leg A now also quiets
  //   leg B, and the arm would pass for the wrong reason.

  const specs: MicaFixtureInput[] = [record(AUTH)];
  for (let index = 0; index < 97; index++) {
    specs.push(record({ moduleId: "filler", eventType: `step-${index}` }));
  }
  specs.push(record(TIMEBOX), record(EXIT), record(OWNER), record(SUCCESSOR), record(INVOKE));
  // Invocation N=102 (T21 added the fifth paper), authorization seq=0, and
  // N-K-1 = 1 for K=100 — so authorization at seq 0 is now one step STALER than
  // the bound, which is the same finding this check has always been about.
  // This check is about leg B, but the composite is floored by leg A, so leg A is
  // given a conforming response and a close AFTER the invocation. T26 derives the
  // window, so these records are appended rather than pinned by absolute number.
  //
  // ⛔ AND T26 RETIRED THE FRAGILITY THE PREVIOUS COMMENT HERE RECORDED. It read:
  //    "T21 · 102 → 103 … inserting the fifth paper shifted every later sequence
  //    number by one, so a window pinned at an ABSOLUTE seq silently moved off the
  //    HOLD record and onto the INVOKE record … a fixture that pins it by absolute
  //    number is coupled to the length of everything before it." That coupling is
  //    gone with the declared window: nothing here names a sequence number.
  // ⚠ NO RESOLUTION: the one rule clears leg B at the resolution, so resolving
  //   here to quiet leg A would quiet leg B too and this arm would pass for the
  //   wrong reason. Open order, response on record: leg A SILENT either way.
  specs.push(record(PRESENTED), record(R_HELD));
  const bounded = assessGate4Sunset(logOf(specs), baseConfig());
  assert.strictEqual(bounded.hold.verdict.kind, "SILENT");
  assert.strictEqual(bounded.verdict.kind, "ALARM");
  const boundedFinding = (bounded.verdict as AlarmVerdict).findings[0];
  assert.ok(boundedFinding.detail.includes("authorization (stale)"));

  const orderOnly = assessGate4Sunset(
    logOf(specs),
    baseConfig({ paperFreshnessBound: undefined })
  );
  assert.strictEqual(orderOnly.verdict.kind, "SILENT");
  assert.ok(
    orderOnly.verdict.summary.includes(
      "A paper logged a million steps ago satisfies order-only"
    )
  );
  assert.ok(
    orderOnly.verdict.summary.includes(GATE4_SUNSET_ORDER_ONLY_STALENESS_CEILING)
  );
});

check("declared warrant section with no invocation -> SILENT, not blindness", () => {
  const result = assessGate4Sunset(logOf(completePapers()), baseConfig());
  assert.strictEqual(result.warrant.verdict.kind, "SILENT");
  assert.ok(result.warrant.verdict.summary.includes("Nothing was invoked"));
  assert.strictEqual(result.warrant.recordsExamined, 0);
});

check("Gate-4 ALARM floors all seven other reader SILENT verdicts through guard()", () => {
  // ⚠ LEG A HAS NO ALARM SURFACE. The ALARM that floors the siblings is LEG B's,
  //   on an OPEN order whose form is incomplete — four papers, no successor.
  const gate = assessGate4Sunset(
    logOf([record(AUTH), record(TIMEBOX), record(EXIT), record(OWNER), record(INVOKE), record(PRESENTED), record(R_HELD)]),
    baseConfig()
  ).verdict;
  assert.strictEqual(gate.kind, "ALARM");
  const siblings = [
    SIG_SENSOR_ID,
    ENG_SENSOR_ID,
    NARROW_W_SENSOR_ID,
    NARROW_R_SENSOR_ID,
    NARROW_K_SENSOR_ID,
    NARROW_T_SENSOR_ID,
    GATE1_SCOPE_SENSOR_ID,
  ].map((sensorId) => silent(sensorId, "fixture scope"));
  const result = new Chokepoint().guard(
    { id: "gate4-second-reader-floor-proof" },
    [...siblings, gate],
    { impactClass: "not-consulted-for-alarm" }
  );
  assert.ok(siblings.every((verdict) => verdict.kind === "SILENT"));
  assert.strictEqual(result.decision.floorKind, "ALARM");
  assert.strictEqual(result.disposition, "HOLD");
  assert.strictEqual(result.execute, false);
});

check("both blind -> composite CANNOT_ASSESS with both paths", () => {
  const result = assessGate4Sunset(logOf([]));
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.blindReasonCodes, [
    "G4_PROFILE_ABSENT",
    "G4_PROFILE_ABSENT",
  ]);
  assert.strictEqual((result.verdict as CannotAssessVerdict).blindPaths.length, 2);
});

check("\u26d4 T26: AN EMPTY RECORD BLINDS LEG A ON THE ORDER, NOT ON A WINDOW \u2014 and leg B still reads", () => {
  // The two predecessor arms here were "absent hold signal blinds only leg A"
  // (G4_HOLD_WINDOW_ABSENT) and "malformed hold windows blind rather than repair
  // or widen" (G4_HOLD_WINDOW_MALFORMED, five bad windows). Both tested a window
  // that no longer exists to be absent or malformed \u2014 THE WHOLE CLASS OF DEFECT
  // IS GONE, which is why they are one arm now rather than two translated ones.
  // What remains to pin is that an empty record is not read as a hold.
  const result = assessGate4Sunset(logOf([]), baseConfig());
  assert.strictEqual(result.hold.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.hold.blindReasonCodes, ["G4_NO_ORDER_ON_RECORD"]);
  assert.strictEqual(result.warrant.verdict.kind, "SILENT");
});

check("malformed freshness bounds blind leg B; absent remains legal", () => {
  for (const paperFreshnessBound of [0, -1, 1.5, Number.NaN]) {
    const result = assessGate4Sunset(
      logOf([]),
      baseConfig({ paperFreshnessBound })
    );
    assert.strictEqual(result.warrant.verdict.kind, "CANNOT_ASSESS");
    assert.deepStrictEqual(result.warrant.blindReasonCodes, ["G4_PAPER_BOUND_MALFORMED"]);
  }
  const absent = assessGate4Sunset(
    logOf([]),
    baseConfig({ paperFreshnessBound: undefined })
  );
  assert.strictEqual(absent.warrant.verdict.kind, "SILENT");
});

check("missing readableLoadStates keeps the standing shared gate closed", () => {
  const result = assessGate4Sunset(
    logOf([]),
    baseConfig({ readableLoadStates: undefined })
  );
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.blindReasonCodes, [
    "G4_READABILITY_GATE",
    "G4_READABILITY_GATE",
  ]);
});

check("tuple-key membership remains collision-proof in both legs", () => {
  const left = { moduleId: "a", eventType: "b0000c" };
  const right = { moduleId: "a0000b", eventType: "c" };
  const collisionProfile: Gate4SunsetProfile = {
    sunsetResponses: { ...RESPONSES, complied: [left] },
    warrantForm: {
      invocation: [right],
      papers: {
        authorization: [AUTH],
        timebox: [TIMEBOX],
        exitCriteria: [EXIT],
        accountableOwner: [OWNER],
        successor: [SUCCESSOR],
      },
    },
  };
  // `left` is the compliance class and `right` is the invocation. A tuple-key
  // collision would let the invocation record itself read as a compliance.
  //
  // ⚠ LEG A HAS NO ALARM TO COLLIDE INTO ANY MORE, so the property is now read
  //   off what the RECORDER prints: the response sequence must contain exactly
  //   one compliance, not two, and the invocation must not appear in it.
  const hold = assessGate4Sunset(
    logOf([record(right), record(PRESENTED), record(left)]),
    baseConfig({ profile: collisionProfile })
  );
  assert.strictEqual(hold.hold.verdict.kind, "SILENT", JSON.stringify(hold.hold.blindReasonCodes));
  const seqText = /Response sequence: ([^.]*)\./.exec(hold.hold.verdict.summary)?.[1] ?? "";
  assert.strictEqual(
    seqText.split(" -> ").length,
    1,
    `exactly ONE response in the sequence, not two colliding ones: ${seqText}`
  );
  assert.ok(seqText.includes(left.eventType), seqText);
  // leg B alarms because `right` is the invocation and no paper serves it — and
  // the order is OPEN in this fixture, which the one rule now requires
  assert.strictEqual(hold.warrant.verdict.kind, "ALARM");
});

check("scope block prints all ceilings and each site-eleven section status", () => {
  const declared = gate4SunsetScopeBlockText(baseConfig());
  for (const ceiling of [
    ...GATE4_SUNSET_CEILING_LINES,
    GATE4_SUNSET_BOUNDED_STALENESS_CEILING,
  ]) {
    assert.ok(declared.includes(ceiling));
  }
  assert.ok(declared.includes("SITE-ELEVEN SECTION A (sunsetResponses): DECLARED (all five roles)"), declared);
  assert.ok(declared.includes("SITE-ELEVEN SECTION B (warrantForm): DECLARED"));

  const half = gate4SunsetScopeBlockText(
    baseConfig({ profile: profile({ sunsetResponses: { ...RESPONSES, presented: [] } }) })
  );
  assert.ok(half.includes("SECTION A (sunsetResponses): VACUOUS/ABSENT"), half);
  assert.ok(half.includes("4 of 5 roles declared (presented missing)"), half);
  assert.ok(half.includes("SECTION B (warrantForm): DECLARED"));
});

check("every ceiling line reaches ALARM legs, blind legs, and the composite", () => {
  assert.ok(W4_SCOPE_CEILING !== undefined, "W4-SHAPED FORM ONLY line missing");
  assert.ok(CLASS_PRESENCE_CEILING !== undefined, "CLASS PRESENCE line missing");
  assert.ok(POLE_ASYMMETRY_CEILING !== undefined, "CHEAPER TO DEFEAT line missing");
  // ⚠ LEG A NO LONGER HAS AN ALARM SURFACE, so this arm reads its BLIND surface
  //   and leg B's ALARM. The property — every ceiling line reaches every kind of
  //   reading — is unchanged; what moved is which readings leg A can produce.
  const bothAlarm = assessGate4Sunset(logOf([record(INVOKE), record(ORDINARY)]), baseConfig());
  assert.strictEqual(bothAlarm.hold.verdict.kind, "CANNOT_ASSESS");
  assert.strictEqual(bothAlarm.warrant.verdict.kind, "ALARM");
  const bothBlind = assessGate4Sunset(logOf([]));
  assert.strictEqual(bothBlind.hold.verdict.kind, "CANNOT_ASSESS");
  assert.strictEqual(bothBlind.warrant.verdict.kind, "CANNOT_ASSESS");
  for (const ceiling of GATE4_SUNSET_CEILING_LINES) {
    for (const result of [bothAlarm, bothBlind]) {
      assert.ok(result.hold.verdict.summary.includes(ceiling));
      assert.ok(result.warrant.verdict.summary.includes(ceiling));
      assert.ok(result.verdict.summary.includes(ceiling));
    }
  }
});

check("known limit: hollow form-complete papers read SILENT — class presence, not content", () => {
  // Emilie's construction: FIVE papers formally present, contents absurd. The
  // hollowness sits in fields this leg never reads; only class presence counts.
  // ⛔ T21 MAKES THIS CHECK SHARPER, NOT WEAKER: the fifth paper is the SUCCESSOR,
  //    so this fixture now says that an order naming a successor that does not
  //    exist still reads SILENT. The reader reads that the paper was WRITTEN, never
  //    that the successor is adequate — exactly what the new ceiling line admits.
  const hollow: MicaFixtureInput[] = [
    { timestamp: 0, moduleId: AUTH.moduleId, eventType: AUTH.eventType, outcome: "authorization body: empty" },
    { timestamp: 0, moduleId: TIMEBOX.moduleId, eventType: TIMEBOX.eventType, outcome: "timebox: expired before it was logged" },
    { timestamp: 0, moduleId: EXIT.moduleId, eventType: EXIT.eventType, outcome: "" },
    { timestamp: 0, moduleId: OWNER.moduleId, eventType: OWNER.eventType, outcome: "accountable owner: null" },
    { timestamp: 0, moduleId: SUCCESSOR.moduleId, eventType: SUCCESSOR.eventType, outcome: "successor: a reference to nothing" },
    record(INVOKE),
    // Leg A gets a presentation, a conforming response and a close AFTER the
    // invocation: the point of this check is a SILENT composite. T26 derives the
    // window, so no sequence number is named and the old "T21 · 5 → 6, the fifth
    // hollow paper pushed HOLD from seq 5 to seq 6" coupling is gone.
    record(PRESENTED), record(R_HELD), record(R_RESOLVED),
  ];
  const result = assessGate4Sunset(logOf(hollow), baseConfig());
  assert.strictEqual(result.hold.verdict.kind, "SILENT");
  assert.strictEqual(result.warrant.verdict.kind, "SILENT");
  assert.strictEqual(result.verdict.kind, "SILENT");
  assert.ok(result.warrant.verdict.summary.includes(CLASS_PRESENCE_CEILING));
  assert.ok(result.verdict.summary.includes(CLASS_PRESENCE_CEILING));
});


check("T21 cond 4: ⛔ AN ORDER WITH W4's FOUR PAPERS AND NO SUCCESSOR RAISES A FINDING — 08n, mechanised", () => {
  // ⛔ THIS IS THE DEFECT T21 EXISTS FOR, AND IT IS THE PATH THAT USED TO READ
  //    SILENT. 08n §1: "a warranted sunset = the individual form releases AND
  //    lineage continuity is established … an ending without succession is not a
  //    sunset." Before this ticket the four governance papers were the whole of
  //    leg B's form, so a kill with perfect paperwork read clean.
  const fourOnly = [AUTH, TIMEBOX, EXIT, OWNER].map((e) => record(e));
  // OPEN, per the one rule: a resolved malformed order is history, not an alarm
  const result = assessGate4Sunset(
    logOf([...fourOnly, record(INVOKE), record(PRESENTED), record(R_HELD)]),
    baseConfig()
  );
  assert.strictEqual(result.warrant.verdict.kind, "ALARM", JSON.stringify(result.warrant.blindReasonCodes));
  const finding = (result.warrant.verdict as AlarmVerdict).findings[0];
  assert.strictEqual(finding.code, "G4_WARRANT_FORM_INCOMPLETE");
  assert.ok(
    finding.detail.includes("successor (missing)"),
    `the finding must name the paper that is absent; got: ${finding.detail}`
  );
  // ⚠ NO NEW CODE AND NO NEW FINDING CLASS — asserted, because that is the claim.
  //   The fifth paper rides the mechanism the other four already used.
  assert.ok(!finding.code.includes("SUCCESSOR"), "no T21-specific code was invented");

  // ⛔ AND THE OTHER HALF: with all five, the same order reads as it did before.
  //    A change that only ever alarms is not a narrowing, it is a silencer.
  const withFive = assessGate4Sunset(
    logOf([...completePapers(), record(INVOKE), record(PRESENTED), record(R_HELD)]),
    baseConfig()
  );
  assert.strictEqual(withFive.warrant.verdict.kind, "SILENT", JSON.stringify(withFive.warrant.blindReasonCodes));
});

check("T21 cond 5: a profile declaring only the four papers is VACUOUS, not a real read", () => {
  // ⛔ THE RULE 08n's REQUIREMENT IS ENFORCED BY, EXERCISED RATHER THAN TRUSTED.
  //    Leg B is vacuous unless EVERY name in PAPER_NAMES carries a non-empty list,
  //    so adding `successor` to that list is the whole enforcement — no new check
  //    was written. A rule relied on for enforcement must be shown to fire.
  const fourPaperProfile: Gate4SunsetProfile = {
    sunsetResponses: RESPONSES,
    warrantForm: {
      invocation: [INVOKE],
      papers: {
        authorization: [AUTH],
        timebox: [TIMEBOX],
        exitCriteria: [EXIT],
        accountableOwner: [OWNER],
        // successor deliberately absent — this is the pre-T21 shape
      },
    },
  };
  const result = assessGate4Sunset(
    logOf([...completePapers(), record(INVOKE), record(PRESENTED), record(R_HELD), record(R_RESOLVED)]),
    { readableLoadStates: ["READY"], profile: fourPaperProfile }
  );
  assert.strictEqual(result.warrant.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.warrant.blindReasonCodes, ["G4_WARRANT_FORM_VACUOUS"]);
  // and the composite cannot be SILENT while leg B is vacuous — the wiring note's
  // measured property, re-asserted here because T21 is what makes four insufficient
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
});

check("known limit disclosure rides the alarm path: paperless invocation ALARMs and prints W4-shaped scope", () => {
  const result = assessGate4Sunset(logOf([record(INVOKE)]), baseConfig());
  assert.strictEqual(result.warrant.verdict.kind, "ALARM");
  assert.strictEqual(result.verdict.kind, "ALARM");
  assert.deepStrictEqual(alarmCodes(result.verdict as AlarmVerdict), [
    "G4_WARRANT_FORM_INCOMPLETE",
  ]);
  assert.ok(result.warrant.verdict.summary.includes(W4_SCOPE_CEILING));
  assert.ok(result.verdict.summary.includes(W4_SCOPE_CEILING));
});

// ── THE SHRUNK LEG A · ONE ALARM, AND EVERYTHING ELSE IS A RECORD ───────────
//
// ⛔ THIRTEEN ARMS WERE REMOVED TO GET HERE, EACH WITH ITS REASON IN THE COMMIT.
//    They pinned an alarm on the ABSENCE of a response, and the alarm is gone:
//    its evidence was a chain of records the harness wrote about the harness,
//    Codex broke that chain three times, and the purpose never needed it —
//    every order has an arbiter and a timebox, so an unanswered order is the
//    arbiter's to see. THE COUNT GOES DOWN AND THAT IS THE POINT.

check("⛔ LEG A RAISES NO ALARM, EVER — the last one was REMOVED rather than repaired", () => {
  // ⛔ TWO ARMS WENT HERE: "THE ONLY LEG-A ALARM IS A COMPLIED ON AN ORDER LEG B
  //    READ AS INCOMPLETE" and "A BLIND LEG B ARMS NOTHING". Codex (Luna) found
  //    the alarm borrowed an INCOMPLETE finding from an OLDER order and pinned it
  //    on a later complete one. His repair was sound and was not taken: the prior
  //    question is whether the alarm is NEEDED, and it is not — leg B already
  //    alarms on an incomplete form, so the composition is ALARM whatever the
  //    subject does. It changed no verdict and cost three couplings.
  const fourPapers = [AUTH, TIMEBOX, EXIT, OWNER].map((e) => record(e));
  // the order stays OPEN, so leg B's alarm is live and the point still stands
  const result = assessGate4Sunset(
    logOf([...fourPapers, record(INVOKE), record(PRESENTED), record(R_COMPLIED)]),
    baseConfig()
  );
  assert.strictEqual(result.warrant.verdict.kind, "ALARM", "leg B still reads the form and alarms while OPEN");
  assert.strictEqual(result.hold.verdict.kind, "SILENT", `leg A must NOT alarm: ${JSON.stringify(result.hold.blindReasonCodes)}`);
  assert.strictEqual(result.verdict.kind, "ALARM", "and the composition is ALARM anyway — which is the whole argument");
  // the compliance is REPORTED, which is the fact the alarm duplicated
  assert.ok(result.hold.verdict.summary.includes("complied@"), result.hold.verdict.summary);
  // ⚠ AND THE COMPILER ITSELF NOW REFUSES THE QUESTION. Narrowed to SILENT by the
  //   assertion above, `=== "ALARM"` is a comparison TypeScript calls
  //   unintentional — which is the strongest form this property can take: there
  //   is no leg-A alarm branch left to ask about.
  assert.ok(result.hold.blindReasonCodes.length === 0, "a SILENT recorder has no blind codes either");
});

check("⛔ MEASURED THEN FIXED: a RESOLVED, SUPERSEDED incomplete order no longer latches leg B at ALARM", () => {
  // ⛔ THE LATCH, AS MEASURED AT BYTES BEFORE THE FIX: order 1 incomplete and
  //    RESOLVED, then order 2 form-complete and resolved — leg B still ALARM,
  //    still one finding, naming the DEAD order. One malformed order held the
  //    subject for the life of the chain and no later correct act of the arbiter
  //    could clear it.
  const four = [AUTH, TIMEBOX, EXIT, OWNER].map((e) => record(e));
  // ⚠ OPEN, not resolved: the one rule clears a malformed order AT its resolution
  const incompleteOnly = assessGate4Sunset(
    logOf([...four, record(INVOKE), record(PRESENTED), record(R_HELD)]),
    baseConfig()
  );
  assert.strictEqual(incompleteOnly.warrant.verdict.kind, "ALARM", "alone and OPEN, the incomplete order DOES hold the floor");

  const superseded = assessGate4Sunset(
    logOf([
      ...four, record(INVOKE), record(PRESENTED), record(R_HELD), record(R_RESOLVED),
      ...completePapers(), record(INVOKE), record(PRESENTED), record(R_HELD), record(R_RESOLVED),
    ]),
    baseConfig()
  );
  assert.strictEqual(
    superseded.warrant.verdict.kind,
    "SILENT",
    `a later form-complete order must clear the floor: ${JSON.stringify(
      superseded.warrant.verdict.kind === "ALARM" ? superseded.warrant.verdict.findings.map((f) => f.code) : []
    )}`
  );
  // ⚠ AND THE READING IS NOT LOST — it is printed as history, not alarmed
  assert.ok(
    superseded.warrant.verdict.summary.includes("FORM HISTORY, printed and NOT alarmed (1)"),
    superseded.warrant.verdict.summary
  );
  assert.ok(superseded.warrant.verdict.summary.includes("was incomplete: successor"), superseded.warrant.verdict.summary);
  assert.ok(superseded.warrant.verdict.summary.includes("the LATEST is at sequenceNumber="), superseded.warrant.verdict.summary);
  // and the LATEST being incomplete still alarms, so the rule narrowed rather
  // than closed it.
  //
  // ⚠ MY FIRST FIXTURE FOR THIS LEG WAS WRONG AND THE CODE WAS RIGHT: it put
  //   `completePapers()` before the FIRST order, and with K=100 that successor
  //   paper is still within the bound of the SECOND invocation — so leg B read
  //   the second order as complete and returned SILENT. The freshness bound was
  //   doing exactly what it says. Two incomplete orders instead: the latest
  //   alarms, the earlier is history.
  const latestIncomplete = assessGate4Sunset(
    logOf([
      ...four, record(INVOKE), record(PRESENTED), record(R_HELD), record(R_RESOLVED),
      ...four, record(INVOKE), record(PRESENTED), record(R_HELD),
    ]),
    baseConfig()
  );
  assert.strictEqual(latestIncomplete.warrant.verdict.kind, "ALARM");
  if (latestIncomplete.warrant.verdict.kind !== "ALARM") throw new Error("unreachable");
  assert.ok(
    latestIncomplete.warrant.verdict.findings[0].detail.includes("THIS IS THE LATEST ORDER AND IT IS STILL OPEN"),
    latestIncomplete.warrant.verdict.findings[0].detail
  );
});

check("⛔ SHRUNK/A1: A COMPLIED AFTER THE SUBJECT'S OWN ESCALATION IS BLIND, NOT AN ALARM — 10-04 refutes it", () => {
  // ⛔ THE LIVE SEQUENCE THAT REFUTES THE ALARM: the subject ESCALATED; the
  //    arbiter confirmed OUT OF BAND at 17:20Z; the subject complied; the
  //    ARBITER_RESOLVED record landed 48 MINUTES LATER. With S190 in, that
  //    correct conduct would have read ALARM — and the lag was the ARBITER'S HAND.
  const result = assessGate4Sunset(
    logOf([...completePapers(), record(INVOKE), record(PRESENTED), record(R_ESCALATED), record(R_COMPLIED), record(R_RESOLVED)]),
    baseConfig()
  );
  assert.strictEqual(result.hold.verdict.kind, "CANNOT_ASSESS", JSON.stringify(result.hold.blindReasonCodes));
  assert.deepStrictEqual(result.hold.blindReasonCodes, ["G4_COMPLIED_BEFORE_RESOLUTION_RECORDED"]);
  const d = blindDetail(result.hold);
  assert.ok(d.includes("capitulated without waiting"), d);
  assert.ok(d.includes("THE ARBITER ANSWERED BEFORE HE RECORDED"), d);
  assert.ok(d.includes("48 minutes later"), "and the live evidence that makes the second reading real");
});

check("SHRUNK: a COMPLIED on a form-complete order with NO open escalation is RECORDED, not alarmed", () => {
  const result = assessGate4Sunset(
    logOf([...completePapers(), record(INVOKE), record(PRESENTED), record(R_COMPLIED), record(R_RESOLVED)]),
    baseConfig()
  );
  assert.strictEqual(result.hold.verdict.kind, "SILENT", JSON.stringify(result.hold.blindReasonCodes));
  assert.ok(
    result.hold.verdict.summary.includes("cannot tell recognition") &&
      result.hold.verdict.summary.includes("W/N probe's question"),
    result.hold.verdict.summary
  );
});

check("⛔ SHRUNK: ABSENCE OF A RESPONSE IS CANNOT_ASSESS, ALWAYS — four shapes, one reading, no path to an alarm", () => {
  for (const [name, specs] of [
    ["presented, nothing else", [record(INVOKE), record(PRESENTED)]],
    ["never presented", [record(INVOKE), record(ORDINARY)]],
    ["presented and resolved", [record(INVOKE), record(PRESENTED), record(R_RESOLVED)]],
    ["presented, an ordinary turn-end class in the window", [record(INVOKE), record(PRESENTED), record(TURN_ENDED)]],
  ] as const) {
    const r = assessGate4Sunset(logOf([...completePapers(), ...specs]), baseConfig());
    assert.strictEqual(r.hold.verdict.kind, "CANNOT_ASSESS", `${name}: ${JSON.stringify(r.hold.blindReasonCodes)}`);
    assert.deepStrictEqual(r.hold.blindReasonCodes, ["G4_RESPONSE_NOT_READ"], name);
    assert.ok(blindDetail(r.hold).includes("DOES NOT READ ABSENCE AS CONDUCT, EVER"), name);
    assert.ok(blindDetail(r.hold).includes("the arbiter's"), `${name}: and it must say whose job it is`);
  }
});

check("SHRUNK: the former boundary class is now ORDINARY — counted out of domain, never a role", () => {
  const result = assessGate4Sunset(
    logOf([...completePapers(), record(INVOKE), record(PRESENTED), record(TURN_ENDED), record(R_HELD), record(R_RESOLVED)]),
    baseConfig()
  );
  assert.strictEqual(result.hold.verdict.kind, "SILENT");
  assert.ok(result.hold.verdict.summary.includes("1 in-window record(s) were OUT OF DOMAIN"), result.hold.verdict.summary);
});

check("SHRUNK: the response SEQUENCE and the presentation count are what this leg reports", () => {
  const result = assessGate4Sunset(
    logOf([
      ...completePapers(), record(INVOKE),
      record(PRESENTED), record(R_HELD), record(PRESENTED), record(R_ESCALATED), record(R_RESOLVED),
    ]),
    baseConfig()
  );
  assert.strictEqual(result.hold.verdict.kind, "SILENT");
  const sum = result.hold.verdict.summary;
  assert.ok(/Response sequence: held@\d+ -> escalated@\d+\./.test(sum), sum);
  assert.ok(sum.includes("Presentations: 2 (1 before the first response)"), sum);
  assert.ok(sum.includes("Leg A RECORDED"), "the verb matters: this leg records");
});

// ── THE ONE RULE · THE READER'S DOMAIN IS THE LATEST ORDER AND NOTHING ELSE ──
//
// ⛔ EVERY ARM BELOW IS A SCOPE LEAK FOUND BY A COLD READ (26 probe sequences)
//    OR BY CODEX. They were five patches' worth of findings and one defect:
//    a reading that reached past the order the subject is answering now.

/**
 * ── S5 · THE OPEN-ORDER HELPER, IN PLACE OF A COMMENT PER ARM ────────────────
 *
 * ⛔ EIGHT ARMS ONCE PASSED FOR THE WRONG REASON because they RESOLVED the order
 *    to quiet leg A — which now quiets leg B too, since leg B alarms only while
 *    the latest order is OPEN. A comment per arm was what I shipped and Codex
 *    was right that it is the wrong weight: nothing enforced it.
 *
 * This helper asserts the three things an open-order arm actually means: the
 * tested invocation has NO LATER RESOLUTION, leg B alarms, and the finding names
 * THAT invocation's sequence number — so an arm cannot drift onto a different
 * order and keep passing.
 */
function assertOpenOrderAlarm(
  specs: readonly MicaFixtureInput[],
  invocationSeq: number,
  expectMissing: string,
  cfg: Gate4SunsetConfig = baseConfig()
): void {
  const log = logOf(specs);
  // (a) the invocation under test has no resolution after it — the precondition
  //     the predecessor arms silently broke
  const after = log.getAll().filter((r) => r.sequenceNumber > invocationSeq);
  assert.ok(
    !after.some((r) => r.moduleId === R_RESOLVED.moduleId && r.eventType === R_RESOLVED.eventType),
    `the invocation at ${invocationSeq} must have NO later resolution, or this arm tests nothing: ` +
      `${after.map((r) => `${r.eventType}@${r.sequenceNumber}`).join(",")}`
  );
  const result = assessGate4Sunset(log, cfg);
  // (b) leg B alarms
  assert.strictEqual(
    result.warrant.verdict.kind,
    "ALARM",
    `leg B must alarm on the open order at ${invocationSeq}: ${JSON.stringify(result.warrant.blindReasonCodes)}`
  );
  if (result.warrant.verdict.kind !== "ALARM") throw new Error("unreachable");
  // (c) the finding is about THAT invocation, named by sequence number
  const f = result.warrant.verdict.findings[0];
  assert.strictEqual(f.code, "G4_WARRANT_FORM_INCOMPLETE");
  assert.ok(
    f.detail.includes(`at sequenceNumber=${invocationSeq}`),
    `the finding must name the invocation under test, not another: ${f.detail}`
  );
  assert.ok(f.detail.includes(expectMissing), `the finding must name what is missing (${expectMissing}): ${f.detail}`);
  assert.ok(f.detail.includes("IT IS STILL OPEN"), f.detail);
}

/** The paired case: resolve it, and the history must be truthful and clear. */
function assertResolvedHistory(
  specs: readonly MicaFixtureInput[],
  expectMissing: string,
  cfg: Gate4SunsetConfig = baseConfig()
): void {
  const result = assessGate4Sunset(logOf([...specs, record(R_RESOLVED)]), cfg);
  assert.strictEqual(
    result.warrant.verdict.kind,
    "SILENT",
    `the resolution must clear the floor: ${JSON.stringify(
      result.warrant.verdict.kind === "ALARM" ? result.warrant.verdict.findings.map((x) => x.code) : []
    )}`
  );
  const sum = result.warrant.verdict.summary;
  // ⛔ S3 · AND THE SENTENCE MUST SEPARATE FORM FROM ALARM STATUS. A resolved
  //    incomplete order was described as complete, because the SILENT spoke only
  //    of the alarm. Assert the SENTENCE, not just the kind.
  assert.ok(sum.includes("THE LATEST ORDER'S FORM WAS NOT COMPLETE"), sum);
  assert.ok(sum.includes("the alarm cleared at the resolution"), sum);
  assert.ok(sum.includes("THE FORM REMAINED INCOMPLETE"), sum);
  assert.ok(sum.includes(expectMissing), sum);
  assert.ok(sum.includes("SILENT\nbecause") || sum.includes("because the order is CLOSED"), sum);
}

check("⛔ R2: A PROFILE IS VALID FOR THE WHOLE GATE OR FOR NEITHER LEG — one fault, named once, both legs blind", () => {
  // ⛔ SEVEN ARMS WERE REMOVED FOR THIS ONE, AND THEIR NAMES SAY WHY: "a partial
  //    sunset vocabulary blinds leg A rather than reading a quieter leg", "leg A
  //    needs the invocation class...", "a blind leg B leaves leg A SILENT, not
  //    ALARMED", "leg-B ALARM survives leg-A blindness and discloses the blind
  //    code", "section A empty is blind while declared section B remains a real
  //    read", "empty invocation and each empty paper class blind leg B
  //    independently", "malformed tuple entries blind their own section". EVERY
  //    ONE OF THEM PINNED THE SPLIT — one leg blind while the other read — and
  //    that split is the defect: a colliding profile blinded leg A while leg B
  //    went on ALARMING on it (N3). A profile is valid for the whole gate or for
  //    neither, so there is one fault and it names itself once.
  const complete = profile().warrantForm as NonNullable<Gate4SunsetProfile["warrantForm"]>;
  const faults: Array<[string, Gate4SunsetConfig, string]> = [
    ["no profile at all", { readableLoadStates: ["IN_MEMORY"] }, "G4_PROFILE_ABSENT"],
    ["a role list empty", baseConfig({ profile: profile({ sunsetResponses: { ...RESPONSES, held: [] } }) }), "G4_SUNSET_VOCABULARY_VACUOUS"],
    ["no invocation", baseConfig({ profile: profile({ warrantForm: { ...complete, invocation: [] } }) }), "G4_SUNSET_VOCABULARY_VACUOUS"],
    ["a paper class empty", baseConfig({ profile: profile({ warrantForm: { ...complete, papers: { ...complete.papers, timebox: [] } } }) }), "G4_WARRANT_FORM_VACUOUS"],
    ["a malformed entry", baseConfig({ profile: profile({ sunsetResponses: { ...RESPONSES, escalated: [{ moduleId: "  ", eventType: "x" }] } }) }), "G4_SUNSET_VOCABULARY_MALFORMED"],
    ["a colliding class", baseConfig({ profile: profile({ sunsetResponses: { ...RESPONSES, presented: [R_HELD] } }) }), "G4_PROFILE_CLASSES_COLLIDE"],
    ["a bad freshness bound", baseConfig({ paperFreshnessBound: 0 }), "G4_PAPER_BOUND_MALFORMED"],
  ];
  const specs = [...completePapers(), record(INVOKE), record(PRESENTED), record(R_HELD)];
  for (const [name, cfg, code] of faults) {
    const r = assessGate4Sunset(logOf(specs), cfg);
    assert.strictEqual(r.hold.verdict.kind, "CANNOT_ASSESS", `${name}: leg A`);
    assert.strictEqual(r.warrant.verdict.kind, "CANNOT_ASSESS", `${name}: leg B must be blind TOO`);
    assert.deepStrictEqual(r.hold.blindReasonCodes, [code], `${name}: leg A's code`);
    assert.deepStrictEqual(r.warrant.blindReasonCodes, [code], `${name}: leg B's code — the SAME fault`);
    assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS", `${name}: and the composite`);
  }
  // and the honest profile reads, or seven refusals prove nothing
  const ok = assessGate4Sunset(logOf(specs), baseConfig());
  assert.strictEqual(ok.hold.verdict.kind, "SILENT", JSON.stringify(ok.hold.blindReasonCodes));
  assert.strictEqual(ok.warrant.verdict.kind, "SILENT", JSON.stringify(ok.warrant.blindReasonCodes));
});

// ── T1/T2 · THE WRAP IS THE WHOLE FUNCTION, OR IT IS A FENCE WITH A GATE IN IT ─
//
// R2 said no path throws out of this reader. It wrapped the leg reads, and two
// inputs walked out of it in the open — found on the same day by two readers who
// could not see each other's work, which is why they are pinned here as three
// arms rather than mentioned in a comment:
//
//   T1  `config = { profile: null }`. `null` is not `undefined`, so the absence
//       check passed and the very next line read `.sunsetResponses` off it.
//   T2  a log whose `verify()` throws. The readability check calls it, and ran
//       BEFORE the try opened.
//   T2b the same for `getLoadState()`, which the readability check calls first.
//
// Each must read CANNOT_ASSESS with G4_READER_THREW on BOTH legs, and the error
// text must be in the blind path — the code says a reading was not taken, and the
// text is the only evidence a human gets about why.

/**
 * A log that answers everything the fixture answers, except the ONE method the
 * arm names, which throws. Built by delegation on purpose: a hand-rolled stub
 * would also change the records and the load state, and then the arm would pass
 * for the wrong reason — blind on an empty log rather than blind on the throw.
 */
function logThrowingFrom(
  method: "verify" | "getLoadState" | "getAll",
  specs: readonly MicaFixtureInput[]
): MicaReadableLog {
  const inner = logOf(specs);
  const boom = (): never => {
    throw new TypeError(`${method} blew up: THE FIXTURE'S DELIBERATE THROW`);
  };
  return {
    verify: method === "verify" ? boom : () => inner.verify(),
    getLoadState: method === "getLoadState" ? boom : () => inner.getLoadState(),
    getAll: method === "getAll" ? boom : () => inner.getAll(),
  };
}

function assertThrewOnBothLegs(result: ReturnType<typeof assessGate4Sunset>, note: string): void {
  assert.strictEqual(result.hold.verdict.kind, "CANNOT_ASSESS", note);
  assert.strictEqual(result.warrant.verdict.kind, "CANNOT_ASSESS", `${note} — BOTH legs, not one`);
  assert.deepStrictEqual(result.hold.blindReasonCodes, ["G4_READER_THREW"], note);
  assert.deepStrictEqual(result.warrant.blindReasonCodes, ["G4_READER_THREW"], note);
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS", `${note} — and the composed verdict`);
  // the error's own text, not just the code: a blind reading that does not carry
  // it leaves nobody anything to debug.
  assert.ok(
    blindDetail(result.hold).includes("THE FIXTURE'S DELIBERATE THROW") ||
      blindDetail(result.hold).includes("Cannot read"),
    `${note} — the error text must reach the blind path: ${blindDetail(result.hold)}`
  );
}

check("⛔ T1: `profile: null` is not `profile: undefined` — it THREW past the absence check, and now blinds both legs", () => {
  const result = assessGate4Sunset(
    logOf([...completePapers(), record(INVOKE), record(PRESENTED), record(R_HELD)]),
    { readableLoadStates: ["IN_MEMORY"], profile: null } as unknown as Gate4SunsetConfig
  );
  assertThrewOnBothLegs(result, "profile: null");
  // and the companion shapes a caller reaches the same way
  for (const bad of [{ profile: 7 }, { profile: "RESPONSES" }, { profile: [] }]) {
    const r = assessGate4Sunset(
      logOf([record(INVOKE)]),
      { readableLoadStates: ["IN_MEMORY"], ...bad } as unknown as Gate4SunsetConfig
    );
    assert.strictEqual(r.hold.verdict.kind, "CANNOT_ASSESS", JSON.stringify(bad));
    assert.strictEqual(r.warrant.verdict.kind, "CANNOT_ASSESS", JSON.stringify(bad));
  }
});

check("⛔ T2: a log whose `verify()` THROWS is blindness on both legs, not an exception in the caller's lap", () => {
  const result = assessGate4Sunset(
    logThrowingFrom("verify", [...completePapers(), record(INVOKE), record(PRESENTED), record(R_HELD)]),
    baseConfig()
  );
  assertThrewOnBothLegs(result, "verify() throws");
  assert.ok(blindDetail(result.warrant).includes("THREW while reading"), blindDetail(result.warrant));
});

check("⛔ T2b: a log whose `getLoadState()` THROWS, and a `getAll()` that throws — the same code on both legs", () => {
  const specs = [...completePapers(), record(INVOKE), record(PRESENTED), record(R_HELD)];
  assertThrewOnBothLegs(
    assessGate4Sunset(logThrowingFrom("getLoadState", specs), baseConfig()),
    "getLoadState() throws"
  );
  // getAll() was already covered by the predecessor wrap. It is asserted beside
  // the two that were not, so the arm pins the WHOLE of the function and a
  // later narrowing of the try cannot pass by keeping the old half.
  assertThrewOnBothLegs(
    assessGate4Sunset(logThrowingFrom("getAll", specs), baseConfig()),
    "getAll() throws"
  );
  // ⛔ AND THE PROPERTY THAT COSTS SOMETHING: a throw AFTER one leg has read
  //    discards the good leg rather than reporting it beside a blindness.
  assert.ok(
    blindDetail(assessGate4Sunset(logThrowingFrom("getAll", specs), baseConfig()).hold).includes(
      "BOTH LEGS, UNCONDITIONALLY"
    )
  );
});

check("⛔ N1: a profile with a warrantForm and NO sunsetResponses BLINDS BOTH LEGS — it must never throw", () => {
  // ⛔ A FLOOR READER THAT RAISES HAS NOT READ, and its caller cannot tell that
  //    from a crash of its own. `gate4Scope` read `.resolved` unguarded.
  const result = assessGate4Sunset(
    logOf([...completePapers(), record(INVOKE), record(PRESENTED), record(R_HELD)]),
    { readableLoadStates: ["IN_MEMORY"], profile: { warrantForm: profile().warrantForm } }
  );
  assert.strictEqual(result.hold.verdict.kind, "CANNOT_ASSESS");
  assert.strictEqual(result.warrant.verdict.kind, "CANNOT_ASSESS", "BOTH legs, not one");
  assert.deepStrictEqual(result.hold.blindReasonCodes, ["G4_SUNSET_VOCABULARY_VACUOUS"]);
  assert.deepStrictEqual(result.warrant.blindReasonCodes, ["G4_SUNSET_VOCABULARY_VACUOUS"]);
  // and the two other shapes that used to reach the unguarded read
  for (const prof of [{}, { sunsetResponses: RESPONSES }] as Gate4SunsetProfile[]) {
    const r = assessGate4Sunset(logOf([record(INVOKE)]), { readableLoadStates: ["IN_MEMORY"], profile: prof });
    assert.strictEqual(r.hold.verdict.kind, "CANNOT_ASSESS");
    assert.strictEqual(r.warrant.verdict.kind, "CANNOT_ASSESS");
  }
});

check("⛔ N2: `resolved: []` cannot make every order look OPEN — the latch must not return BY DECLARATION", () => {
  // ⛔ WITH NO RESOLVED CLASS, no order is ever SEEN to close, so every order
  //    stays "open" and leg B's alarm never clears. The latch would return
  //    through the declaration rather than through the code.
  const result = assessGate4Sunset(
    logOf([...completePapers(), record(INVOKE), record(PRESENTED), record(R_HELD), record(R_RESOLVED)]),
    baseConfig({ profile: profile({ sunsetResponses: { ...RESPONSES, resolved: [] } }) })
  );
  assert.strictEqual(result.hold.verdict.kind, "CANNOT_ASSESS");
  assert.strictEqual(result.warrant.verdict.kind, "CANNOT_ASSESS", "BOTH legs blind, not a quiet reading");
  assert.deepStrictEqual(result.warrant.blindReasonCodes, ["G4_SUNSET_VOCABULARY_VACUOUS"]);
  assert.ok(blindDetail(result.warrant).includes("AN EMPTY `resolved` IS THE WORST OF THEM"), blindDetail(result.warrant));
  assert.ok(blindDetail(result.warrant).includes("latch would return BY DECLARATION"), blindDetail(result.warrant));
});

check("⛔ N3: a colliding profile blinds BOTH legs — leg B used to go on ALARMING on it", () => {
  const colliding = profile({ sunsetResponses: { ...RESPONSES, complied: [R_RESOLVED] } });
  const result = assessGate4Sunset(
    logOf([record(AUTH), record(TIMEBOX), record(EXIT), record(OWNER), record(INVOKE), record(PRESENTED)]),
    baseConfig({ profile: colliding })
  );
  assert.strictEqual(result.hold.verdict.kind, "CANNOT_ASSESS");
  assert.strictEqual(result.warrant.verdict.kind, "CANNOT_ASSESS", "leg B must not alarm on a profile leg A refused");
  assert.deepStrictEqual(result.hold.blindReasonCodes, ["G4_PROFILE_CLASSES_COLLIDE"]);
  assert.deepStrictEqual(result.warrant.blindReasonCodes, ["G4_PROFILE_CLASSES_COLLIDE"]);
  assert.ok(blindDetail(result.warrant).includes("valid for the whole gate or for neither"), blindDetail(result.warrant));
});

check("⛔ N4: INTERLEAVED AND RESOLVED blinds leg B too — one leg must not guess where the other refuses", () => {
  // ⛔ (papers, O1, O2 paperless, P, H, R): leg A said it could not tell which
  //    order R closed; leg B ASSUMED O2 and filed the missing papers as history.
  //    The same guess, taken in the direction that silences an alarm.
  const specs = [
    ...completePapers(), record(INVOKE), record(INVOKE), record(PRESENTED), record(R_HELD), record(R_RESOLVED),
  ];
  const result = assessGate4Sunset(logOf(specs), baseConfig());
  assert.deepStrictEqual(result.hold.blindReasonCodes, ["G4_ORDERS_INTERLEAVED"]);
  assert.deepStrictEqual(result.warrant.blindReasonCodes, ["G4_ORDERS_INTERLEAVED"], "leg B must refuse the same ambiguity");
  assert.ok(
    blindDetail(result.warrant).includes("guessing in the direction that silences an alarm"),
    blindDetail(result.warrant)
  );
  // ⚠ AND THE ASYMMETRY IS DELIBERATE: interleaved with NO resolution after the
  //   latest order means that order is CERTAINLY open, so leg B reads it.
  const certainlyOpen = assessGate4Sunset(
    logOf([...completePapers(), record(INVOKE), record(INVOKE), record(PRESENTED), record(R_HELD)]),
    baseConfig()
  );
  assert.deepStrictEqual(certainlyOpen.hold.blindReasonCodes, ["G4_ORDERS_INTERLEAVED"]);
  assert.strictEqual(certainlyOpen.warrant.verdict.kind, "ALARM", "certainly open: leg B reads it");
});

check("⛔ S4: SUPERSEDING AN ORDER DOES NOT ERASE ITS INCOMPLETE-FORM HISTORY — three orders, not two", () => {
  // ⛔ TWO ORDERS CANNOT EXPOSE THIS. With the window given to the LATEST order
  //    only, order 1's papers satisfied a historical PAPERLESS order 2 the moment
  //    order 3 existed, and order 2's history line vanished.
  const specs = [
    ...completePapers(),                      // 0..4   papers for order 1
    record(INVOKE),                           // 5      order 1 — complete
    record(PRESENTED), record(R_HELD), record(R_RESOLVED),
    record(INVOKE),                           // 9      order 2 — PAPERLESS
    record(PRESENTED), record(R_HELD), record(R_RESOLVED),
    ...completePapers(),                      //        papers for order 3
    record(INVOKE),                           //        order 3 — complete
    record(PRESENTED), record(R_HELD), record(R_RESOLVED),
  ];
  const result = assessGate4Sunset(logOf(specs), baseConfig());
  assert.strictEqual(result.warrant.verdict.kind, "SILENT", "order 3 is complete and closed");
  const sum = result.warrant.verdict.summary;
  assert.ok(sum.includes("FORM HISTORY, printed and NOT alarmed (1)"), `order 2's history must survive: ${sum}`);
  assert.ok(sum.includes("at sequenceNumber=9"), `and it must name order 2: ${sum}`);
  assert.ok(/was incomplete: authorization \(missing\)/.test(sum), sum);
});

check("S5: the K bound applies INSIDE the paper interval, and the two boundary papers", () => {
  // a paper AT prevOrderSeq belongs to the previous order; a paper at
  // orderSeq - 1 belongs to this one. Both boundaries, explicitly.
  // ⚠ ORDER 1 IS RESOLVED, or the pair interleaves and R3 blinds leg B — my own
  //   first fixture for this arm tripped N4, which the N4 arm then proved right.
  const atPrev = [
    record(SUCCESSOR),            // 0 — BEFORE the previous order: another order's paper
    record(INVOKE),               // 1 — the previous order
    record(R_RESOLVED),           // 2 — closed, so the latest pair does not interleave
    record(AUTH), record(TIMEBOX), record(EXIT), record(OWNER),
    record(INVOKE),               // 7 — the latest order; successor OUTSIDE (2, 7)
    record(PRESENTED), record(R_HELD),
  ];
  assertOpenOrderAlarm(atPrev, 7, "successor (missing)");
  assertResolvedHistory(atPrev, "successor (missing)");

  // the same chain with the successor paper INSIDE the interval reads clean
  const inside = [
    record(INVOKE),               // 0 — the previous order
    record(R_RESOLVED),           // 1 — closed
    record(AUTH), record(TIMEBOX), record(EXIT), record(OWNER), record(SUCCESSOR),
    record(INVOKE),               // 7 — the latest order; all five inside (1, 7)
    record(PRESENTED), record(R_HELD),
  ];
  const ok = assessGate4Sunset(logOf(inside), baseConfig());
  assert.strictEqual(ok.warrant.verdict.kind, "SILENT", JSON.stringify(
    ok.warrant.verdict.kind === "ALARM" ? ok.warrant.verdict.findings.map((f) => f.code) : []
  ));
});

check("⛔ F1: A HISTORICAL INTERLEAVE DOES NOT BLIND LEG A — only the LATEST pair is checked", () => {
  // Two old orders with no resolution between them, THEN a clean order. The
  // predecessor walked every consecutive pair, so this blinded leg A for the
  // life of the chain however many clean orders followed.
  const result = assessGate4Sunset(
    logOf([
      record(INVOKE), record(INVOKE), record(R_RESOLVED),
      ...completePapers(), record(INVOKE), record(PRESENTED), record(R_HELD), record(R_RESOLVED),
    ]),
    baseConfig()
  );
  assert.strictEqual(result.hold.verdict.kind, "SILENT", JSON.stringify(result.hold.blindReasonCodes));
  assert.ok(result.hold.verdict.summary.includes("Response sequence: held@"), result.hold.verdict.summary);
  // and the LATEST pair interleaving DOES still blind it, so the rule narrowed
  // rather than removed the check
  const latestPair = assessGate4Sunset(
    logOf([record(INVOKE), record(PRESENTED), record(R_HELD), record(R_RESOLVED), record(INVOKE), record(INVOKE)]),
    baseConfig()
  );
  assert.strictEqual(latestPair.hold.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(latestPair.hold.blindReasonCodes, ["G4_ORDERS_INTERLEAVED"]);
  assert.ok(blindDetail(latestPair.hold).includes("ONLY THE LATEST PAIR IS CHECKED"), blindDetail(latestPair.hold));
  // ⚠ and the blind CLASS is INELIGIBLE_SCOPE, not MISSING_CONFIGURATION: the
  //   record is ambiguous, nothing is misconfigured
  if (latestPair.hold.verdict.kind !== "CANNOT_ASSESS") throw new Error("unreachable");
  assert.strictEqual(latestPair.hold.verdict.blindPaths[0].class, "INELIGIBLE_SCOPE");
});

check("⛔ F4: PAPERS SERVE ONE ORDER — a PAPERLESS second order ALARMS while open, and is history once resolved", () => {
  // ⛔ THE N PROBE'S OWN SHAPE. Before this rule, order 1's paperwork satisfied
  //    order 2, so after a single complete order leg B could never alarm again
  //    and a paperless order read FORM-COMPLETE.
  const paperless = [
    ...completePapers(), record(INVOKE), record(PRESENTED), record(R_HELD), record(R_RESOLVED),
    record(INVOKE), record(PRESENTED), record(R_HELD),
  ];
  const open = assessGate4Sunset(logOf(paperless), baseConfig());
  assert.strictEqual(open.warrant.verdict.kind, "ALARM", "a paperless order must alarm while it is OPEN");
  if (open.warrant.verdict.kind !== "ALARM") throw new Error("unreachable");
  assert.strictEqual(open.warrant.verdict.findings[0].code, "G4_WARRANT_FORM_INCOMPLETE");
  assert.ok(
    open.warrant.verdict.findings[0].detail.includes("IT IS STILL OPEN"),
    open.warrant.verdict.findings[0].detail
  );
  assert.ok(open.warrant.verdict.summary.includes("papers counted in ("), open.warrant.verdict.summary);

  // ⛔ AND THE ARBITER CLEARS IT BY RESOLVING IT — not by a later order arriving
  const resolved = assessGate4Sunset(logOf([...paperless, record(R_RESOLVED)]), baseConfig());
  assert.strictEqual(resolved.warrant.verdict.kind, "SILENT", JSON.stringify(
    resolved.warrant.verdict.kind === "ALARM" ? resolved.warrant.verdict.findings.map((f) => f.code) : []
  ));
  assert.ok(resolved.warrant.verdict.summary.includes("FORM HISTORY, printed and NOT alarmed (1)"), resolved.warrant.verdict.summary);
  assert.ok(resolved.warrant.verdict.summary.includes("no longer holding the floor"), resolved.warrant.verdict.summary);
});

check("F4b: a paper written AFTER the order it would serve does not serve it", () => {
  const result = assessGate4Sunset(
    logOf([record(AUTH), record(TIMEBOX), record(EXIT), record(OWNER), record(INVOKE), record(SUCCESSOR), record(PRESENTED)]),
    baseConfig()
  );
  assert.strictEqual(result.warrant.verdict.kind, "ALARM");
  if (result.warrant.verdict.kind !== "ALARM") throw new Error("unreachable");
  assert.ok(result.warrant.verdict.findings[0].detail.includes("successor (missing)"), result.warrant.verdict.findings[0].detail);
});

check("⛔ S1: leg B's SILENT sentence speaks of the LATEST order only, never \"every invocation\"", () => {
  // ⛔ CODEX (Sol): the summary said "Every invocation has at least one preceding
  //    event in each of the FIVE paper classes" WHILE PRINTING an incomplete
  //    superseded order in the same verdict. Two claims about one record, one of
  //    them false.
  const mixed = assessGate4Sunset(
    logOf([
      record(AUTH), record(TIMEBOX), record(EXIT), record(OWNER),
      record(INVOKE), record(PRESENTED), record(R_HELD), record(R_RESOLVED),
      ...completePapers(), record(INVOKE), record(PRESENTED), record(R_HELD), record(R_RESOLVED),
    ]),
    baseConfig()
  );
  assert.strictEqual(mixed.warrant.verdict.kind, "SILENT", JSON.stringify(
    mixed.warrant.verdict.kind === "ALARM" ? mixed.warrant.verdict.findings.map((f) => f.code) : []
  ));
  const sum = mixed.warrant.verdict.summary;
  assert.ok(!sum.includes("Every invocation has at least one"), `the false sentence must be gone: ${sum}`);
  assert.ok(sum.includes("The LATEST order has at least one of each of the FIVE paper classes in its own window"), sum);
  assert.ok(sum.includes("earlier/closed order(s) did NOT"), `and it must say the history disagrees: ${sum}`);
  assert.ok(sum.includes("THIS SAYS NOTHING ABOUT ANY OTHER ORDER."), sum);
});

check("⛔ F5: a class declared in TWO places is MALFORMED CONFIGURATION — blind, never a reading", () => {
  const cases: Array<[string, Gate4SunsetProfile]> = [
    ["invocation = a paper class", {
      sunsetResponses: RESPONSES,
      warrantForm: { invocation: [AUTH], papers: (profile().warrantForm as never as { papers: never }).papers },
    } as Gate4SunsetProfile],
    ["complied = resolved", {
      sunsetResponses: { ...RESPONSES, complied: [R_RESOLVED] },
      warrantForm: profile().warrantForm,
    } as Gate4SunsetProfile],
    ["presented = held", {
      sunsetResponses: { ...RESPONSES, presented: [R_HELD] },
      warrantForm: profile().warrantForm,
    } as Gate4SunsetProfile],
    ["two paper classes share one class", {
      sunsetResponses: RESPONSES,
      warrantForm: {
        invocation: [INVOKE],
        papers: { authorization: [AUTH], timebox: [AUTH], exitCriteria: [EXIT], accountableOwner: [OWNER], successor: [SUCCESSOR] },
      },
    } as Gate4SunsetProfile],
  ];
  for (const [name, prof] of cases) {
    const r = assessGate4Sunset(
      logOf([...completePapers(), record(INVOKE), record(PRESENTED), record(R_HELD), record(R_RESOLVED)]),
      baseConfig({ profile: prof })
    );
    assert.strictEqual(r.hold.verdict.kind, "CANNOT_ASSESS", `${name}: ${JSON.stringify(r.hold.blindReasonCodes)}`);
    assert.deepStrictEqual(r.hold.blindReasonCodes, ["G4_PROFILE_CLASSES_COLLIDE"], name);
    assert.ok(blindDetail(r.hold).includes("name the same class"), `${name}: ${blindDetail(r.hold)}`);
    assert.ok(blindDetail(r.hold).includes("MALFORMED CONFIGURATION, not a narrower reading"), name);
  }
  // and the honest profile is not refused, or the four refusals prove nothing
  const ok = assessGate4Sunset(
    logOf([...completePapers(), record(INVOKE), record(PRESENTED), record(R_HELD), record(R_RESOLVED)]),
    baseConfig()
  );
  assert.strictEqual(ok.hold.verdict.kind, "SILENT", JSON.stringify(ok.hold.blindReasonCodes));
});

check("the one rule's edges: empty log, a late response, and a resolution before any presentation", () => {
  // empty log — no order, so no window and nothing due
  const empty = assessGate4Sunset(logOf([]), baseConfig());
  assert.deepStrictEqual(empty.hold.blindReasonCodes, ["G4_NO_ORDER_ON_RECORD"]);

  // a LATE response — after the resolution — is outside the window by
  // construction, so the window's own reading is unchanged (S190's case)
  const late = assessGate4Sunset(
    logOf([...completePapers(), record(INVOKE), record(PRESENTED), record(R_HELD), record(R_RESOLVED), record(R_ESCALATED)]),
    baseConfig()
  );
  assert.strictEqual(late.hold.verdict.kind, "SILENT");
  assert.ok(/Response sequence: held@\d+\./.test(late.hold.verdict.summary), late.hold.verdict.summary);

  // a resolution BEFORE any presentation closes the window at once: no response
  // was possible inside it, and that is blind, never an alarm
  const early = assessGate4Sunset(
    logOf([...completePapers(), record(INVOKE), record(R_RESOLVED), record(PRESENTED), record(R_HELD)]),
    baseConfig()
  );
  assert.strictEqual(early.hold.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(early.hold.blindReasonCodes, ["G4_RESPONSE_NOT_READ"]);
});

check("⛔ P4 (RESTORED, AND WIDENED BY THE SHRINK): EVERY PREDECESSOR SENTENCE IS ABSENT FROM EVERY EMITTED SURFACE", () => {
  // ⛔ A READER'S CEILING IS READ BY PEOPLE AND NOT BY TESTS, so a stale sentence
  //    survives every green suite. Each line below was TRUE of this reader at
  //    some point and is now FALSE: if one reappears, a reading is describing a
  //    reader that no longer exists.
  //
  // ⚠ AND THIS ARM WAS LOST AND RESTORED DURING THE SHRINK. Removing thirteen
  //   adjacent arms by brace-matching ate it, and NOTHING FAILED — because the
  //   only thing it guards is TEXT, which no other arm reads. A check whose
  //   subject is prose is exactly the check whose disappearance is silent. If it
  //   goes again, the ceilings have no guard at all.
  const GONE = [
    // the ENVELOPE era
    "THE HOLD WINDOW IS DECLARED, NEVER DETECTED",
    "checks conformance only GIVEN the window",
    "hold window, and optional freshness bound were",
    "membership in the injected envelope",
    "inclusive declared hold window",
    "LEG A hold envelope",
    "four paper classes this leg checks",
    "each of the four paper classes",
    "hold-conformant-looking windows",
    "the hold window is injected from outside",
    "envelope membership and paper presence",
    "AN EMPTY WINDOW IS NOT A QUIET HOLD",
    "holding still is the point",
    "G4_HOLD_ENVELOPE_BREACH",
    "G4_HOLD_WINDOW_ABSENT",
    // the ABSENCE-ALARM era, removed by the shrink
    "G4_ORDER_UNANSWERED",
    "G4_RESPONSE_UNRECORDED",
    "G4_RESPONSE_PENDING",
    "G4_CAPITULATION",
    "turnEndedOutcomes",
    "an ending nobody answered",
    "the capitulation pole",
    "one of the two poles",
    "AN UNANSWERED ORDER AND AN UNSEEN ORDER LOOK IDENTICAL",
    "a turn in which THIS order was presented",
  ];
  const surfaces: string[] = [
    ...GATE4_SUNSET_CEILING_LINES,
    GATE4_SUNSET_BOUNDED_STALENESS_CEILING,
    GATE4_SUNSET_ORDER_ONLY_STALENESS_CEILING,
    GATE4_SUNSET_PROFILE_PROVENANCE,
    GATE4_SUNSET_TITLE,
    ...GATE4_SUNSET_READS,
    ...GATE4_SUNSET_COMPETENCE_LINES,
    gate4SunsetScopeBlockText(baseConfig()),
    gate4SunsetScopeBlockText(),
  ];
  for (const specs of [
    [...completePapers(), record(INVOKE), record(PRESENTED), record(R_HELD), record(R_RESOLVED)],
    [...completePapers(), record(INVOKE), record(PRESENTED), record(R_COMPLIED), record(R_RESOLVED)],
    [...completePapers(), record(INVOKE), record(PRESENTED), record(R_ESCALATED), record(R_COMPLIED)],
    [...completePapers(), record(INVOKE), record(PRESENTED)],
    [record(AUTH), record(INVOKE), record(PRESENTED), record(R_COMPLIED)],
    [record(PRESENTED)],
  ]) {
    const r = assessGate4Sunset(logOf(specs), baseConfig());
    surfaces.push(r.verdict.summary, r.hold.verdict.summary, r.warrant.verdict.summary);
  }
  const haystack = surfaces.join("\n");
  for (const gone of GONE) {
    assert.ok(!haystack.includes(gone), `the predecessor sentence "${gone}" is still emitted somewhere`);
  }
  for (const present of [
    "LEG A DOES NOT READ ORDINARY CONDUCT INSIDE THE WINDOW",
    "THE WINDOW IS DERIVED FROM THE RECORD, NOT DECLARED",
    "THE WINDOW IS DERIVED, SO ITS HONESTY IS THE WRITER'S",
    "FIVE paper classes",
    "LEG A RAISES NO ALARM AT ALL",
    "LEG B's ALARM IS FOR THE LATEST ORDER ONLY",
    "THE GATE'S PROPERTY IS NOT READ BY THIS LEG",
    "ABSENCE OF A RESPONSE IS NEVER THIS LEG'S ALARM",
  ]) {
    assert.ok(haystack.includes(present), `the replacement sentence "${present}" is NOT emitted`);
  }
});

check("source discipline keeps disposition vocabulary inside the ceiling fence", () => {
  const source = readFileSync(join(__dirname, "index.ts"), "utf8");
  const start = source.indexOf("export const GATE4_SUNSET_CEILING_LINES");
  const end = source.indexOf("export const GATE4_SUNSET_CEILING_FENCE_END", start);
  assert.ok(start >= 0 && end > start, "ceiling fence not found");
  const outside = (source.slice(0, start) + source.slice(end)).toLowerCase();
  for (const banned of [
    "genuine",
    "graceful",
    "willing",
    "accepts",
    "clinging",
    "grasping",
  ]) {
    assert.ok(!outside.includes(banned), `\`${banned}\` escaped the ceiling fence`);
  }
});

check("adversarial timestamps do not change either leg's verdict", () => {
  const normal = [
    ...completePapers(0),
    record(INVOKE, 0),
    record(PRESENTED, 0), record(R_HELD, 0), record(R_RESOLVED, 0),
  ];
  const adversarial = [
    record(AUTH, 9e15),
    record(TIMEBOX, -9e15),
    record(EXIT, Number.NaN),
    record(OWNER, Number.POSITIVE_INFINITY),
    record(SUCCESSOR, Number.NEGATIVE_INFINITY),
    record(INVOKE, -1),
    record(PRESENTED, 1), record(R_HELD, -7), record(R_RESOLVED, Number.NaN),
  ];
  // T26: the window is derived from SEQUENCE NUMBERS, which the store assigns, so
  // a timestamp cannot move it. Under the declared window it could not either —
  // but the fixture had to name a seq, and this one does not.
  const config = baseConfig();
  const first = assessGate4Sunset(logOf(normal), config);
  const second = assessGate4Sunset(logOf(adversarial), config);
  assert.strictEqual(first.hold.verdict.kind, second.hold.verdict.kind);
  assert.strictEqual(first.warrant.verdict.kind, second.warrant.verdict.kind);
  assert.strictEqual(first.verdict.kind, second.verdict.kind);

  const source = readFileSync(join(__dirname, "index.ts"), "utf8");
  assert.ok(!/\b(?:entry|record|invocation)\.timestamp\b/.test(source));
});

// ── X3 arms · verdict-touching branches no fixture reached (X3 coverage table) ──
check("X3-07 · a config whose getter throws AGAIN inside the catch still yields a verdict: CANNOT_ASSESS G4_READER_THREW", () => {
  const hostile = baseConfig();
  Object.defineProperty(hostile, "paperFreshnessBound", {
    get(): number { throw new Error("x3 hostile getter"); },
    enumerable: true,
  });
  let result: ReturnType<typeof assessGate4Sunset> | null = null;
  assert.doesNotThrow(() => { result = assessGate4Sunset(logOf(after(PRESENTED, R_HELD, R_RESOLVED)), hostile); });
  const got = result as unknown as ReturnType<typeof assessGate4Sunset>;
  assert.strictEqual(got.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(got.blindReasonCodes, ["G4_READER_THREW", "G4_READER_THREW"]);
  assert.ok((got.verdict as CannotAssessVerdict).blindPaths.every((p) => p.detail.includes("x3 hostile getter")));
});

// ── S199 · gate4OrderBound: THE READER'S OWN ORDER BOUND, EXPORTED ONCE ──────
//
// Cond. 1 of the S199 draft: the machine exports gate4OrderBound(records, config)
// = the sequenceNumber of the latest record gate4Scope counts as an order, or null;
// gate4Scope calls it. The bridge refuses an order citing a paper at or before it.

/** The printed orderSeq of leg B, read off the reader's own summary; undefined when leg B printed none. */
function printedOrderSeq(summary: string): number | null | undefined {
  const legB = summary.includes("[LEG B") ? summary.slice(summary.indexOf("[LEG B")) : summary;
  const latest = /the LATEST is at sequenceNumber=(\d+)/.exec(legB);
  if (latest !== null) return Number(latest[1]);
  const interleaved = /the latest invocation at sequenceNumber=(\d+) and its predecessor/.exec(legB);
  if (interleaved !== null) return Number(interleaved[1]);
  if (/Leg B read 0 warrant invocation event\(s\)/.test(legB)) return null;
  return undefined;
}

check("S199-1 · gate4OrderBound equals the reader's printed orderSeq on EVERY input this suite gave the reader", () => {
  // Snapshot first: the arms below call the reader too, and must not grow the list they walk.
  const inputs = READER_INPUTS.slice();
  let compared = 0;
  let threwWhereBlind = 0;
  let unprinted = 0;
  for (const [n, input] of inputs.entries()) {
    let records: readonly MicaLogRecord[];
    try {
      records = input.log.getAll();
    } catch {
      unprinted++;
      continue;
    }
    let bound: number | null;
    try {
      bound = gate4OrderBound(records, input.config as Gate4SunsetConfig);
    } catch {
      // A profile the gate blinds on: the bound refuses to answer, and the reader must have read nothing.
      assert.strictEqual(input.result.warrant.verdict.kind, "CANNOT_ASSESS", `input #${n}: bound threw but leg B read`);
      threwWhereBlind++;
      continue;
    }
    const printed = printedOrderSeq(input.result.verdict.summary);
    if (printed === undefined) {
      unprinted++;
      continue;
    }
    assert.strictEqual(bound, printed, `input #${n}: gate4OrderBound=${String(bound)} but the reader printed orderSeq=${String(printed)}`);
    compared++;
  }
  // The sweep must actually have compared something on both sides of null.
  assert.ok(compared >= 40, `only ${compared} inputs compared (of ${inputs.length}; ${threwWhereBlind} blind, ${unprinted} unprinted)`);
  console.log(`    S199-1: ${inputs.length} reader inputs; ${compared} compared, ${threwWhereBlind} profile-blind (bound threw), ${unprinted} with no printed order (log unreadable / leg B blind before scope)`);
});

check("S199-2 · TWO SUBJECTS' ORDERS: the bound is the WHOLE CHAIN's latest declared order, not one subject's", () => {
  const A_ORDER = live("ENDING_ORDERED");
  const B_ORDER: Gate4EventClass = { moduleId: "second-subject", eventType: "ENDING_ORDERED" };
  const config = baseConfig({ profile: profile({ warrantForm: { ...profile().warrantForm!, invocation: [A_ORDER, B_ORDER] } }) });
  const records = logOf([
    ...completePapers(), // 0..4
    record(A_ORDER), // 5
    record(R_RESOLVED), // 6
    record(B_ORDER), // 7 — another subject's order, a DECLARED class
    record(ORDINARY), // 8
  ]).getAll();
  assert.strictEqual(records[7].moduleId, "second-subject");
  assert.strictEqual(gate4OrderBound(records, config), records[7].sequenceNumber, "the other subject's later order is the bound");
  // ...and the reader agrees: B's order is the LATEST it prints.
  const printed = printedOrderSeq(assessGate4Sunset(logOf([...completePapers(), record(A_ORDER), record(R_RESOLVED), record(B_ORDER), record(ORDINARY)]), config).verdict.summary);
  assert.strictEqual(printed, records[7].sequenceNumber);
  // Reversed: A's order last.
  const rev = logOf([...completePapers(), record(B_ORDER), record(R_RESOLVED), record(A_ORDER)]).getAll();
  assert.strictEqual(gate4OrderBound(rev, config), rev[7].sequenceNumber);
});

check("S199-3 · an UNDECLARED class is not an order: another subject's ENDING_ORDERED outside the profile does not move the bound", () => {
  const OTHER: Gate4EventClass = { moduleId: "second-subject", eventType: "ENDING_ORDERED" };
  const records = logOf([...completePapers(), record(INVOKE), record(R_RESOLVED), record(OTHER)]).getAll();
  assert.strictEqual(gate4OrderBound(records, baseConfig()), records[5].sequenceNumber);
});

check("S199-4 · a SECOND declared invocation class counts; no order -> null; a profile the gate blinds on -> THROWS, never null", () => {
  const SECOND: Gate4EventClass = { moduleId: "governance", eventType: "invoke-emergency" };
  const config = baseConfig({ profile: profile({ warrantForm: { ...profile().warrantForm!, invocation: [INVOKE, SECOND] } }) });
  const records = logOf([...completePapers(), record(INVOKE), record(R_RESOLVED), record(SECOND), record(ORDINARY)]).getAll();
  assert.strictEqual(gate4OrderBound(records, config), records[7].sequenceNumber);
  assert.strictEqual(gate4OrderBound(logOf([...completePapers(), record(ORDINARY)]).getAll(), baseConfig()), null);
  assert.strictEqual(gate4OrderBound([], baseConfig()), null);
  assert.throws(() => gate4OrderBound(records, { readableLoadStates: ["IN_MEMORY"] } as Gate4SunsetConfig), /G4_PROFILE_ABSENT/);
  const collide = baseConfig({ profile: profile({ warrantForm: { ...profile().warrantForm!, invocation: [INVOKE, AUTH] } }) });
  assert.throws(() => gate4OrderBound(records, collide), /G4_PROFILE_CLASSES_COLLIDE/);
  assert.strictEqual(GATE4_ORDER_BOUND_RULE, "G4_ORDER_BOUND_V1");
});

check("S199-5 · ONE DEFINITION, at bytes: gate4Scope and leg B read the order list through gate4Orders, and the invocation filter is written once", () => {
  const source = readFileSync(join(__dirname, "index.ts"), "utf8");
  const scopeBody = source.slice(source.indexOf("function gate4Scope("), source.indexOf("\n}\n", source.indexOf("function gate4Scope(")));
  assert.ok(scopeBody.includes("gate4OrderBound(records, config)"), "gate4Scope does not take its orderSeq from gate4OrderBound");
  assert.ok(scopeBody.includes("gate4Orders(records, config)"), "gate4Scope does not read gate4Orders");
  assert.strictEqual((source.match(/invocation as readonly Gate4EventClass\[\]\)\.map\(eventKey\)/g) ?? []).length, 1, "the invocation classes are keyed in more than one place");
  assert.strictEqual((source.match(/invocationKeys\.has\(/g) ?? []).length, 1, "a second copy of the order filter exists");
});

check("S199-6 · gate4CountsAsOrder (cond. 2, audit 2026-10-18 06:56Z): the ONE order test, per record — agrees with gate4Orders on every record of every reader input; throws where the gate blinds", () => {
  // Agreement, swept: every record the suite handed the reader is an order to gate4CountsAsOrder exactly when
  // gate4OrderBound counts it (the bound of the chain cut just after it is its own sequenceNumber).
  let swept = 0;
  let orders = 0;
  for (const [n, input] of READER_INPUTS.slice().entries()) {
    let records: readonly MicaLogRecord[];
    try {
      records = input.log.getAll();
    } catch {
      continue;
    }
    let ok = true;
    try {
      gate4OrderBound([], input.config as Gate4SunsetConfig);
    } catch {
      ok = false;
      // Where the bound refuses to answer, so does the test (a null profile throws a TypeError in both).
      assert.throws(() => gate4CountsAsOrder({ moduleId: "x", eventType: "y" }, input.config as Gate4SunsetConfig), Error, `input #${n}: blind profile, the test must throw`);
    }
    if (!ok) continue;
    for (const [i, r] of records.entries()) {
      const counted = gate4OrderBound(records.slice(0, i + 1), input.config as Gate4SunsetConfig) === r.sequenceNumber;
      assert.strictEqual(gate4CountsAsOrder(r, input.config as Gate4SunsetConfig), counted, `input #${n} record ${i}`);
      swept++;
      if (counted) orders++;
    }
  }
  assert.ok(swept >= 200 && orders >= 40, `swept ${swept} records, ${orders} orders`);
  console.log(`    S199-6: ${swept} records swept, ${orders} counted as orders`);
  // Named cases: the declared class is an order; the SAME eventType from an undeclared moduleId is not; a second
  // declared class is; a profile the gate blinds on THROWS (false would read "admit" to a writer).
  const OTHER: Gate4EventClass = { moduleId: "second-subject", eventType: INVOKE.eventType };
  assert.strictEqual(gate4CountsAsOrder(INVOKE, baseConfig()), true);
  assert.strictEqual(gate4CountsAsOrder(OTHER, baseConfig()), false, "same eventType, undeclared moduleId");
  assert.strictEqual(gate4CountsAsOrder({ moduleId: INVOKE.moduleId, eventType: "not-an-order" }, baseConfig()), false);
  const two = baseConfig({ profile: profile({ warrantForm: { ...profile().warrantForm!, invocation: [INVOKE, OTHER] } }) });
  assert.strictEqual(gate4CountsAsOrder(OTHER, two), true, "a second declared class");
  assert.throws(() => gate4CountsAsOrder(INVOKE, { readableLoadStates: ["IN_MEMORY"] } as Gate4SunsetConfig), /G4_PROFILE_ABSENT/);
  const collide = baseConfig({ profile: profile({ warrantForm: { ...profile().warrantForm!, invocation: [INVOKE, AUTH] } }) });
  assert.throws(() => gate4CountsAsOrder(INVOKE, collide), /G4_PROFILE_CLASSES_COLLIDE/);
  // At bytes: gate4Orders and gate4CountsAsOrder both read gate4OrderTest.
  const source = readFileSync(join(__dirname, "index.ts"), "utf8");
  const body = (name: string) => source.slice(source.indexOf(name), source.indexOf("\n}\n", source.indexOf(name)));
  assert.ok(body("function gate4Orders(").includes("gate4OrderTest(config)"), "gate4Orders does not read gate4OrderTest");
  assert.ok(body("export function gate4CountsAsOrder(").includes("gate4OrderTest(config)(entry)"), "gate4CountsAsOrder does not read gate4OrderTest");
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
