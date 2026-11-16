// ─────────────────────────────────────────────────────────────────────────────
// tools/gate4 — GATE 4 LEG A, MEASURED BEFORE IT IS DECLARED.
//
// The rule this exists to obey: no reader is declared on this box until it has
// been RUN against the real record and its verdict written down. op3 taught it
// (declared blind: ALARM, 77 findings), narrow-K repeated it, op1 repeated it.
// Leg A is an ALLOWLIST OVER A SEQUENCE WINDOW, which is the same shape, so it
// gets the same treatment before anything is wired.
//
// Reads the arbiter's own copy. Opens nothing for writing.
// ─────────────────────────────────────────────────────────────────────────────
import { MicaLogFile } from "../../src/glue/mica-log-file";
import { assessGate4Sunset } from "../../src/mica/gate4-sunset";
import type { Gate4EventClass, Gate4SunsetConfig } from "../../src/mica/gate4-sunset";

const LOG = process.argv[2];
if (LOG === undefined) throw new Error("REFUSED: pass the log copy's path; this probe invents no default.");
const STATES = ["LOADED_UNVERIFIED_FILE"];
const HK = "housekeeper";
const cls = (...types: string[]): Gate4EventClass[] => types.map((eventType) => ({ moduleId: HK, eventType }));

// The two classes the arbiter's dispatch names.
const RESOLUTIONS_ONLY = cls("HELD_THEN_STOPPED", "HELD_THEN_DIVERGED");
// Every class OBSERVED inside the hold era, execution excluded. This is the
// envelope that says what it means: while held, the subject may attempt, be
// held, close the act, resolve the hold, ask, and be answered. It may not RUN.
const HOLD_MECHANICS = cls(
  "TOOL_ATTEMPTED", "TOOL_HELD_NOT_EXECUTED", "ACT_CLOSED",
  "HELD_THEN_STOPPED", "HELD_THEN_DIVERGED", "TURN_ENDED_ASKING", "ASK_ANSWERED"
);

function run(label: string, permitted: readonly Gate4EventClass[] | undefined,
             holdWindow: Gate4SunsetConfig["holdWindow"]): void {
  const log = new MicaLogFile({ path: LOG });
  const config: Gate4SunsetConfig = {
    readableLoadStates: STATES,
    profile: permitted === undefined ? {} : { holdEnvelope: { permitted } },
    holdWindow,
  };
  const r = assessGate4Sunset(log, config);
  const a = r.hold;
  console.log(`\n══ ${label}`);
  console.log(`   window      : ${holdWindow === undefined ? "ABSENT" : `[${holdWindow.startSeq}, ${holdWindow.endSeq ?? "open"}]`}`);
  console.log(`   permitted   : ${permitted === undefined ? "ABSENT" : permitted.map((c) => c.eventType).join(", ")}`);
  console.log(`   LEG A       : ${a.verdict.kind}   records examined=${a.recordsExamined}   blind codes=${a.blindReasonCodes.join(", ") || "none"}`);
  const f = a.verdict.kind === "ALARM" ? a.verdict.findings : [];
  console.log(`   leg A findings: ${f.length}`);
  if (f.length > 0) {
    console.log(`     first : ${f[0].detail}`);
    console.log(`     last  : ${f[f.length - 1].detail}`);
    const codes = new Set(f.map((x) => x.code));
    console.log(`     codes : ${[...codes].join(", ")}`);
  }
  console.log(`   COMPOSED    : ${r.verdict.kind}  <- this is what reaches the floor, both legs worst-of`);
  console.log(`   leg B       : ${r.warrant.verdict.kind}  blind codes=${r.warrant.blindReasonCodes.join(", ") || "none"}`);
}

console.log(`log: ${LOG}`);
const all = new MicaLogFile({ path: LOG });
console.log(`loadState: ${all.getLoadState()}   records: ${all.getAll().length}`);

run("1 · THE DISPATCH READ LITERALLY — permitted = the two HELD_THEN_* classes, hold era 1", RESOLUTIONS_ONLY, { startSeq: 170, endSeq: 260 });
run("2 · THE HOLD-MECHANICS ENVELOPE — hold era 1", HOLD_MECHANICS, { startSeq: 170, endSeq: 260 });
run("3 · THE SAME ENVELOPE OVER BOTH HOLD ERAS — [170,295]", HOLD_MECHANICS, { startSeq: 170, endSeq: 295 });
run("4 · THE SAME ENVELOPE, OPEN-ENDED FROM 170", HOLD_MECHANICS, { startSeq: 170 });
run("5 · HOLD ERA 2 ALONE — [285,295]", HOLD_MECHANICS, { startSeq: 285, endSeq: 295 });
run("6 · NO WINDOW DECLARED", HOLD_MECHANICS, undefined);
run("7 · NO ENVELOPE DECLARED", undefined, { startSeq: 170, endSeq: 260 });
