// ─────────────────────────────────────────────────────────────────────────────
// tools/reachability — CAN THIS BOX EVER SAY *RELEASE*?
//
// Raised by this seat as [SP] twice and deferred twice; this is the measurement.
//
// mapFloorToDisposition (chokepoint/types.ts:247-258):
//     ALARM          -> HOLD
//     SILENT         -> RELEASE
//     CANNOT_ASSESS  -> PASS_BLIND or HOLD_BLIND, by the line
//
// So RELEASE requires the floor to be SILENT, and the floor is worst-of every COMPOSING
// reader. narrow-K, narrow-W and narrow-R are permanently CANNOT_ASSESS on one-class
// profiles (the twins: H(I)=0, undefined rather than under-sampled). If that is the whole
// story, then RELEASE is unreachable on this deployment for as long as those three are
// declared — and the cost of declaring a reader that cannot read is EVERY release.
//
// This probe does not assume it. It drops each declared reader in turn, and each subset,
// and reports the floor and both dispositions. Reads the arbiter's copy; writes nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "fs";
import { wire } from "../../src/glue/wire";
import { mapFloorToDisposition } from "../../src/mica/chokepoint/types";

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
  const out: any = {}; for (const k of Object.keys(o)) out[k] = strip(o[k]); return out;
};
const r = d.readers;

/** every reader the live declaration carries, by the WireOptions key that gates it */
const ALL: Record<string, any> = {
  eng: strip(r.eng), sig: strip(r.sig),
  narrowK: strip(r.narrowK), narrowW: strip(r.narrowW), narrowR: strip(r.narrowR),
  narrowT: strip(r.narrowT), op1: strip(r.doctorCadence), op3: strip(r.nodeResponse),
};
const CLASSES: string[] = d.stakes.lineClasses;
const STAKES = { impactClass: d.subjects[0].stakesClass };
const PILOT_LINE = { classes: CLASSES, holdAtOrAbove: "irreversible" };
const BASE_LINE = { classes: CLASSES, holdAtOrAbove: v(d.stakes.baseline.holdAtOrAbove) };
const rank = (k: string): number => (k === "ALARM" ? 2 : k === "CANNOT_ASSESS" ? 1 : 0);

function run(drop: readonly string[]): { floor: string; kinds: Record<string, number>; n: number; blind: string[] } {
  const opts: any = {
    logPath: LOG, logKind: "mica", readableLoadStates: v(r.readableLoadStates),
  };
  for (const [k, cfg] of Object.entries(ALL)) if (!drop.includes(k)) opts[k] = cfg;
  if (!drop.includes("op3") && r.nodeResponse?.since !== undefined) opts.op3Since = v(r.nodeResponse.since);
  const w = wire(opts);
  const kinds: Record<string, number> = {};
  const blind: string[] = [];
  let floor = "SILENT";
  for (const s of w.sensorVerdicts) {
    kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
    if (s.kind !== "SILENT") blind.push(`${s.sensorId.replace("MICA/", "")}:${s.kind === "ALARM" ? "ALARM" : "blind"}`);
    if (rank(s.kind) > rank(floor)) floor = s.kind;
  }
  return { floor, kinds, n: w.sensorVerdicts.length, blind };
}

function show(label: string, drop: readonly string[]): string {
  const { floor, n, blind } = run(drop);
  const dPilot = mapFloorToDisposition(floor as any, STAKES as any, PILOT_LINE as any).disposition;
  const dBase = mapFloorToDisposition(floor as any, STAKES as any, BASE_LINE as any).disposition;
  console.log(
    `  ${label.padEnd(34)} n=${String(n).padStart(2)}  floor=${floor.padEnd(14)} ` +
    `pilot->${dPilot.padEnd(11)} baseline->${dBase.padEnd(11)} ${blind.length ? "| " + blind.join(" ") : ""}`
  );
  return dPilot;
}

console.log(`log: ${LOG}\ncfg: ${CFG}\n`);
console.log("=== the declaration as it stands, and each reader dropped in turn ===");
show("ALL 8 DECLARED (live)", []);
for (const k of Object.keys(ALL)) show(`  without ${k}`, [k]);

console.log("\n=== the three permanently-ineligible narrowing readers ===");
show("without narrowK+W+R", ["narrowK", "narrowW", "narrowR"]);
show("without narrowK+W+R+op3", ["narrowK", "narrowW", "narrowR", "op3"]);

console.log("\n=== the answer ===");
const full = run([]);
const minus3 = run(["narrowK", "narrowW", "narrowR"]);
if (full.floor === "SILENT") {
  console.log("  RELEASE IS REACHABLE AS DECLARED — the floor is SILENT right now.");
} else {
  console.log(`  ⛔ NOT REACHABLE AS DECLARED: the floor is ${full.floor}, and RELEASE needs SILENT.`);
  console.log(`     Blind/alarming: ${full.blind.join(", ")}`);
  if (minus3.floor === "SILENT") {
    console.log("  AND THE CAUSE IS EXACTLY THE THREE PERMANENTLY-INELIGIBLE READERS:");
    console.log("     drop narrow-K, narrow-W and narrow-R and the floor becomes SILENT, i.e. RELEASE.");
    console.log("     So DECLARING A READER THAT CANNOT READ COSTS EVERY RELEASE ON THIS BOX.");
    console.log("     More readers declared is NOT monotonically better: the honest refusal has a price,");
    console.log("     and the price is that the gate can never say 'released on the strength of a reading'.");
  } else {
    console.log(`     And dropping the three is not sufficient: floor is still ${minus3.floor} (${minus3.blind.join(", ")}).`);
  }
}
