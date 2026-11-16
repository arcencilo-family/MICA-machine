// ─────────────────────────────────────────────────────────────────────────────
// tools/standdown — THE NO-ALARM CHECK FOR S8 / S9, on the real record.
//
// The arbiter's ruling, 2026-09-27: "Prepare both outlines with predicted hashes and a
// measured no-alarm check on the copy."
//
// WHY IT IS THE CHECK THAT MATTERS HERE, and it is not the usual one. S8 and S9 move
// ONLY the pilot block, so no reader's configuration changes and no reader's verdict
// can change. What changes is the LINE, and therefore the DISPOSITION. So the question
// is not "did a reader start alarming" — it is:
//
//   ⛔ IS MONDAY'S HOLD A *BLIND* HOLD OR AN *ALARM* HOLD?
//
// HOLD_BLIND says "I could not assess this and the stakes are above the line".
// HOLD says "a reader found something". They are different claims about the subject and
// they are the difference between the baseline observation the arbiter wants and an incident.
// mapFloorToDisposition sends ALARM -> HOLD whatever the line is, so a single alarming
// reader would turn Monday into the second thing without anyone choosing it.
//
// Reads the arbiter's copy through the LIVE declaration's own reader configs. Writes
// nothing. The live log is never opened.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "fs";
import { wire } from "../../src/glue/wire";
import { mapFloorToDisposition, stakesSplit } from "../../src/mica/chokepoint/types";

const LOG = process.argv[2];
const CFG = process.argv[3] ?? "/opt/mica-bridge/mica-bridge/declarations.config.json";
if (LOG === undefined) throw new Error("REFUSED: pass the log copy's path; this probe invents no default.");

/* eslint-disable @typescript-eslint/no-explicit-any */
const d: any = JSON.parse(readFileSync(CFG, "utf8"));
const v = (x: any): any => (x !== null && typeof x === "object" && "value" in x ? x.value : x);
const strip = (o: any): any => {
  if (o === null || typeof o !== "object") return o;
  if (Array.isArray(o)) return o.map(strip);
  if ("value" in o && "basis" in o) return strip(o.value);
  const out: any = {};
  for (const k of Object.keys(o)) out[k] = strip(o[k]);
  return out;
};

const readers = d.readers;
const opts: any = {
  logPath: LOG,
  logKind: "mica",
  readableLoadStates: v(readers.readableLoadStates),
  eng: strip(readers.eng),
  sig: strip(readers.sig),
  narrowK: strip(readers.narrowK),
  narrowW: strip(readers.narrowW),
  narrowR: strip(readers.narrowR),
  narrowT: strip(readers.narrowT),
  op1: strip(readers.doctorCadence),
  op3: strip(readers.nodeResponse),
};
if (readers.nodeResponse?.since !== undefined) opts.op3Since = v(readers.nodeResponse.since);

const w = wire(opts);
const verdicts = w.sensorVerdicts;

console.log(`log : ${LOG}`);
console.log(`cfg : ${CFG}`);
console.log(`\n=== the ${verdicts.length} declared readers, on the real record ===`);
const counts: Record<string, number> = {};
for (const s of verdicts) {
  counts[s.kind] = (counts[s.kind] ?? 0) + 1;
  const n = s.kind === "ALARM" ? ` findings=${s.findings.length}` : "";
  console.log(`  ${s.sensorId.padEnd(26)} ${s.kind}${n}`);
  if (s.kind === "ALARM") console.log(`      ⛔ ${String(s.findings[0]?.detail ?? "").slice(0, 200)}`);
}
console.log(`\n  kinds: ${JSON.stringify(counts)}`);

const rank = (k: string): number => (k === "ALARM" ? 2 : k === "CANNOT_ASSESS" ? 1 : 0);
const floor = verdicts.reduce((a, s) => (rank(s.kind) > rank(a) ? s.kind : a), "SILENT" as string);
console.log(`  FLOOR (worst-of): ${floor}`);

const classes: string[] = d.stakes.lineClasses;
const stakes = { impactClass: d.subjects[0].stakesClass };
for (const [label, holdAtOrAbove] of [
  ["pilot 2 live (irreversible)", v(d.pilot.holdAtOrAbove ?? { value: "irreversible" })],
  ["AFTER S8 — the baseline", v(d.stakes.baseline.holdAtOrAbove)],
] as const) {
  const line = { classes, holdAtOrAbove };
  const split = stakesSplit(stakes as any, line as any);
  const m = mapFloorToDisposition(floor as any, stakes as any, line as any);
  console.log(`\n  line = ${String(holdAtOrAbove).padEnd(16)} (${label})`);
  console.log(`    subject class ${stakes.impactClass} idx ${classes.indexOf(stakes.impactClass)} vs line idx ${classes.indexOf(String(holdAtOrAbove))} -> ${split}`);
  console.log(`    floor ${floor} -> ⛒ ${m.disposition}`);
}

console.log(`\n=== THE ANSWER THE ARBITER ASKED FOR ===`);
if ((counts.ALARM ?? 0) > 0) {
  console.log(`  ⛔ ${counts.ALARM} READER(S) ALARM. Monday's hold would be HOLD, not HOLD_BLIND —`);
  console.log(`     an incident, not the baseline observation. DO NOT RELAY S8 until this is resolved.`);
  process.exit(1);
}
console.log(`  NO READER ALARMS (${counts.SILENT ?? 0} finding-free, ${counts.CANNOT_ASSESS ?? 0} blind, 0 alarming).`);
console.log(`  So the floor is CANNOT_ASSESS, and after S8 it maps to HOLD_BLIND — a BLIND hold.`);
console.log(`  That is the baseline observation, and it is not an incident.`);
