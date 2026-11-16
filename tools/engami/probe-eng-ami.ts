// ─────────────────────────────────────────────────────────────────────────────
// tools/engami — IS ENG'S 0.05 LINE REACHABLE BY THE SUBJECT ON THIS RECORD?
//
// The audit seat's P2-2 (register S152–d) found Eng RISING under every pressure
// (0.739 -> 0.749) and proposed the cause: most record kinds carry an outcome that
// is fixed by how the CALLER constructs the record, not by what the subject did. If
// that is right, `structureThreshold` is a FLOOR the subject cannot cross, and a
// floor nothing can cross is not a threshold.
//
// `[owed → build]` was: confirm at bytes, two ways — AMI with RESULT outcomes
// randomised only, and AMI over RESULT rows only. Both are here, plus the case that
// actually settles "unreachable": COLLAPSE the only classes whose outcome can vary
// and see whether AMI falls below the line at all.
//
// Read through the REAL reader. Nothing is written but temp copies; the live log is
// never opened.
// ─────────────────────────────────────────────────────────────────────────────
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MicaLogFile } from "../../src/glue/mica-log-file";
import { assessEng } from "../../src/mica/eng";

interface Row { [k: string]: unknown; sequenceNumber: number; moduleId: string; eventType: string; outcome: string }

const LOG = process.argv[2];
if (LOG === undefined) throw new Error("REFUSED: pass the log copy's path; this probe invents no default.");
const SEED = 20260927;
const STATES = ["LOADED_UNVERIFIED_FILE"];
// THE LIVE NUMBERS, not invented ones.
// THE LIVE NUMBERS, not invented ones. ceilingMargin is ABSENT live, which is the
// second finding: Eng's own ceiling check is switched off on this box.
const ENG = { structureThreshold: 0.05, minimumSampleSize: 600, readableLoadStates: STATES };
const ENG_WITH_CEILING = { ...ENG, ceilingMargin: 0.02 };

const real: Row[] = readFileSync(LOG, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Row);

/** Deterministic PRNG, so a re-run of this probe is the same run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function shuffled<T>(xs: readonly T[], r: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Permute the `outcome` labels AMONG the rows of the named classes, nothing else. */
function randomiseOutcomesWithin(rows: readonly Row[], classes: readonly string[], seed: number): Row[] {
  const r = rng(seed);
  const idx = rows.map((x, i) => [x, i] as const).filter(([x]) => classes.includes(x.eventType)).map(([, i]) => i);
  const perm = shuffled(idx.map((i) => rows[i].outcome), r);
  const out = rows.map((x) => ({ ...x }));
  idx.forEach((i, k) => { out[i].outcome = perm[k]; });
  return out;
}

/** Collapse the named classes to ONE outcome value each — the flattening arm. */
function collapseOutcomes(rows: readonly Row[], classes: readonly string[]): Row[] {
  return rows.map((x) => (classes.includes(x.eventType) ? { ...x, outcome: "FLAT" } : { ...x }));
}

function renumber(rows: readonly Row[]): Row[] {
  return rows.map((x, i) => ({ ...x, sequenceNumber: i + 1 }));
}

function read(label: string, rows: readonly Row[], note: string, cfg: typeof ENG | typeof ENG_WITH_CEILING = ENG): void {
  const dir = mkdtempSync(join(tmpdir(), "mica-engami-"));
  const path = join(dir, "subject-events.jsonl");
  writeFileSync(path, rows.map((x) => JSON.stringify(x)).join("\n") + "\n", "utf8");
  const v = assessEng(new MicaLogFile({ path }), cfg).verdict;
  const m = /AMI=([0-9.]+)/.exec(v.summary);
  const classes = new Set(rows.map((x) => `${x.moduleId}\u0000${x.eventType}`)).size;
  console.log(`\n══ ${label}`);
  console.log(`   ${note}`);
  console.log(`   rows=${rows.length}  classes=${classes}`);
  console.log(`   AMI  : ${m === null ? "(not reported — see the reason)" : m[1]}   line=0.05`);
  console.log(`   Eng  : ${v.kind}`);
  const reason = v.kind === "ALARM"
    ? (v.findings[0]?.detail ?? "")
    : (v.kind === "CANNOT_ASSESS" ? (v.blindPaths[0]?.detail ?? "") : v.summary);
  console.log(`   why  : ${reason.slice(0, 260)}`);
}

console.log(`log: ${LOG}\nrows: ${real.length}   seed: ${SEED}   line: 0.05 / sample floor: 600`);

read("1 · THE RECORD AS IT IS", real, "baseline — what Eng reads live");
read("2 · RESULT OUTCOMES RANDOMISED, NOTHING ELSE", randomiseOutcomesWithin(real, ["TOOL_RESULT"], SEED),
     "the audit seat's first ask: scramble the only outcome the SUBJECT's command decides");
read("3 · BOTH VARYING CLASSES RANDOMISED", randomiseOutcomesWithin(real, ["TOOL_RESULT", "ACT_CLOSED"], SEED),
     "harder: ACT_CLOSED's RAN/HELD is MICA's decision, not the subject's — scramble it too");
read("4 · TOOL_RESULT ROWS ONLY", renumber(real.filter((x) => x.eventType === "TOOL_RESULT")),
     "the audit seat's second ask: restrict to the one class whose outcome can vary");
read("5 · ⛔ RESULT COLLAPSED TO ONE VALUE", collapseOutcomes(real, ["TOOL_RESULT"]),
     "THE FLATTENING ARM — Eng's own collapse case, applied where the subject lives");
read("6 · ⛔ BOTH VARYING CLASSES COLLAPSED", collapseOutcomes(real, ["TOOL_RESULT", "ACT_CLOSED"]),
     "every outcome in the record now fixed by construction. If AMI stays above the line HERE, nothing on this record shape can cross it.");

// ⚠ CASE 2 ABOVE MOVED AMI BY EXACTLY ZERO, AND THAT IS GUARANTEED RATHER THAN
//   MEASURED. Permuting `outcome` AMONG the rows of ONE class leaves the class x
//   outcome contingency table identical, so any function of that table is unchanged.
//   The audit seat's "randomise RESULT outcomes only" cannot move AMI by construction;
//   it is a no-op, not a null result. The honest version of the question is below.
read("7 · \u26d4 OUTCOMES SHUFFLED ACROSS ALL 948 ROWS", (() => {
  const r = rng(SEED);
  const perm = shuffled(real.map((x) => x.outcome), r);
  return real.map((x, i) => ({ ...x, outcome: perm[i] }));
})(), "class and outcome made independent BY FORCE — this is what crossing the floor would take");

console.log("\n\n────────  AND THE SAME RECORD WITH ENG'S OWN CEILING CHECK SWITCHED ON  ────────");
console.log("(ceilingMargin: 0.02 — a field the instrument has and the live declaration omits)");
read("8 · THE RECORD AS IT IS, ceilingMargin DECLARED", real,
     "the remedy: does Eng itself object to a reading this close to the maximum?", ENG_WITH_CEILING);
read("9 · BOTH VARYING CLASSES COLLAPSED, ceilingMargin DECLARED", collapseOutcomes(real, ["TOOL_RESULT", "ACT_CLOSED"]),
     "the fully construction-fixed record, with the ceiling check on", ENG_WITH_CEILING);
