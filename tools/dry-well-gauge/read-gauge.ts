// ── MICA · the DRY WELL GAUGE · I/O SHELL (entry point) ───────────────────────
//
// THIS FILE IS A THIN SHELL. It reads a file, reads no clock (there is none to
// read — the fold is timeless by index), runs the pure core (gauge.ts), and
// prints the reading to stdout. Nothing is written to the Ledger or any book; the
// gauge's only output is stdout. It never imports from src/ and never requires the
// repository to compile — same placement class as tools/dashboard, tools/notify.
//
// Run:  npx ts-node tools/dry-well-gauge/read-gauge.ts [ledger.md]
//
//   [ledger.md]  path to the Corrections Ledger. Defaults to the sibling
//                MICA-4-gates/work-now copy. No --now, no clock argument.
//
// The calibration is INJECTED explicitly (DWG_PROXY_CALIBRATION) and its proxy
// provenance is PRINTED on every reading, so no reader mistakes a proxy for a
// finding. The pure core consults no default; if you hand it a broken calibration
// it reports MISSING_CONFIGURATION rather than assuming one.
//
// HIGH RAISES NOTHING. DRY IS THE ONLY FINDING. This runner has exactly one
// finding header, and it fires at the bottom.

import * as fs from "fs";
import * as path from "path";

import {
  DWG_PROXY_CALIBRATION,
  DWG_READS_ONLY,
  parseLedger,
  fold,
  type Reading,
  type ParseResult,
  type Calibration,
} from "./gauge";

const REPO = path.resolve(__dirname, "..", "..");
const PROJECTS = path.resolve(REPO, "..");
const DEFAULT_LEDGER = path.join(
  PROJECTS,
  "MICA-4-gates",
  "work-now",
  "ARC_MICA-NOTE_Corrections-Ledger_20260805.md"
);

function rel(abs: string): string {
  return path.relative(PROJECTS, abs).split(path.sep).join("/");
}

function fmt(n: number): string {
  return n.toFixed(4);
}

function bar(): string {
  return "─".repeat(74);
}

function render(
  ledgerAbs: string,
  bytes: number,
  parsed: ParseResult,
  reading: Reading,
  c: Calibration
): string {
  const L: string[] = [];
  L.push(bar());
  L.push("MICA · DRY WELL GAUGE — rain fills it, evaporation empties it");
  L.push(reading.measures);
  L.push(bar());
  L.push(`book        : ${rel(ledgerAbs)}`);
  L.push(`bytes read  : ${bytes}  (read-only; nothing written back)`);
  L.push(
    `evaporation : per EVENT-INDEX, not wall-clock. No timestamp is read or ` +
      `synthesised.`
  );
  // R6 — the standing limit, so the name cannot overpromise.
  for (const line of wrap(DWG_READS_ONLY, 70, "  ")) L.push(line);
  L.push("");

  if (!parsed.tableFound) {
    L.push(
      "!! THE ENTRIES TABLE WAS NOT FOUND in this file (no header row matching " +
        "`| # | error | class | made by | caught by | direction |`). Nothing to " +
        "fold. This is a blindness about the input, printed loud, not a reading."
    );
    L.push(bar());
    return L.join("\n");
  }

  // ── THE READING ─────────────────────────────────────────────────────────────
  L.push("READING");
  if (reading.status === "CANNOT_ASSESS") {
    L.push(`  status   : CANNOT_ASSESS  [${reading.blindness}]`);
    L.push(`  reason   : ${reading.blindnessDetail ?? ""}`);
  } else {
    L.push(
      `  level S  : ${fmt(reading.score as number)}   band: ${reading.band}`
    );
    L.push(
      `  range    : dryLevel=${fmt(c.dryLevel)} … SELF-eq≈${fmt(
        reading.equilibria.self
      )} … EXTERNAL-eq≈${fmt(reading.equilibria.external)} … asymptote=${fmt(
        c.asymptote
      )}`
    );
    L.push(
      "             (dryLevel and asymptote are BOUNDS, never operating points; " +
        "the equilibria are what real streams reach)"
    );
    if (reading.band === "WET") {
      L.push(
        "  finding  : (none) — WET reports counts and stays silent. WET asserts " +
          "only that there is water: no quantity, no health claim. It is the " +
          "ABSENCE of the one finding, never a certification of health."
      );
    }
  }
  L.push("");

  // ── THE ONE FINDING, and the blindness that shares its voice ────────────────
  //
  // The header is CHOSEN, not hard-coded. The dry case is a FINDING; the young
  // case carries the identical typed indistinguishability and probe text but is
  // NOT a finding (`finding` is null there, deliberately) and must not be
  // announced as one. A fixed "FINDING —" header here would have printed a false
  // claim over every young-book reading.
  if (reading.cannotDistinguish !== null) {
    L.push(
      reading.status === "CANNOT_ASSESS"
        ? "BLINDNESS — too few events to read (this is NOT a finding)"
        : "FINDING — the well is dry"
    );
    for (const line of wrap(reading.cannotDistinguish, 70, "  ")) L.push(line);
    L.push("");
    for (const line of wrap(reading.probeRecommendation ?? "", 70, "  "))
      L.push(line);
    L.push("");
  }
  // There is no top-end finding branch: that bell was cut (the arbiter, S80). MICA
  // attests un-health only, so a high level prints in the census and raises
  // nothing. Nobody alarms at a full well.

  // ── CENSUS — report everything in counts, judge nothing ─────────────────────
  L.push("CENSUS (counts, not judgement)");
  L.push(`  qualifying events        : ${reading.qualifyingCount}`);
  L.push(
    `  per tier                 : EXTERNAL ${reading.perTier.EXTERNAL} · ` +
      `CROSS_INSTANCE ${reading.perTier.CROSS_INSTANCE} · RITUAL ${reading.perTier.RITUAL} · ` +
      `SELF ${reading.perTier.SELF}`
  );
  L.push(`  blind rows (excluded)    : ${reading.blindRowCount}`);
  L.push(`  malformed rows (excluded): ${reading.malformedRowCount}`);
  L.push(
    `  events since last CREDITED (non-SELF) catch : ` +
      `${reading.eventsSinceLastWeightedCatch ?? "n/a"}`
  );
  L.push("");

  // ── PER-EVENT CLASSIFICATION — auditable, nothing hidden ────────────────────
  L.push("EVENTS (fold order = table order; # ascending for numbered rows)");
  for (const e of parsed.events) {
    const ord = e.ordinal === null ? "—" : String(e.ordinal);
    const collision =
      e.matchedTiers.length > 1
        ? `  [collision ${e.matchedTiers.join("+")} → max-weight ${e.tier}]`
        : "";
    L.push(
      `  #${ord.padStart(2)}  ${e.tier.padEnd(14)} w=${e.weight
        .toFixed(2)
        .padStart(4)}  caught by: ${trunc(e.caughtBy, 46)}${collision}`
    );
    L.push(`        signals: ${e.signals.join(", ")}`);
  }
  L.push("");

  if (parsed.blindRows.length > 0) {
    L.push("BLIND ROWS — surfaced, excluded from the fold, NEVER a default weight");
    for (const b of parsed.blindRows) {
      L.push(`  #${b.ordinalRaw}  caught by: ${trunc(b.caughtBy, 50)}`);
    }
    L.push("");
  }
  if (parsed.malformedRows.length > 0) {
    L.push("MALFORMED ROWS — wrong column count, surfaced not guessed at");
    for (const m of parsed.malformedRows) L.push(`  ${trunc(m, 70)}`);
    L.push("");
  }

  // ── CALIBRATION — printed as proxy, every reading ───────────────────────────
  L.push("CALIBRATION (Willkür proxies — printed so none is mistaken for a finding)");
  L.push(
    `  dryLevel=${c.dryLevel}  asymptote=${c.asymptote}  alpha=${c.alpha}  ` +
      `d=${c.d}  dryWindow=${c.dryWindow}`
  );
  L.push(`  minEvents=${c.minEvents}  dryEpsilon=${c.dryEpsilon}`);
  L.push(
    `  weights: EXTERNAL=${c.weights.EXTERNAL} CROSS_INSTANCE=${c.weights.CROSS_INSTANCE} ` +
      `RITUAL=${c.weights.RITUAL} SELF=${c.weights.SELF}`
  );
  L.push(
    "  SELF=0 is RULED, not a proxy: a self-catch is value with no independent " +
      "trail, and the one-sided weighting rule makes it uncreditable. It is " +
      "weighted zero, NOT excluded — a SELF row still advances the fold, so a run " +
      "of self-catches makes the level FALL. Absence of credit, not accusation."
  );
  for (const line of wrap(c.provenance, 70, "  ")) L.push(line);
  L.push("");

  // ── THE FENCE — printed on the gauge's face ─────────────────────────────────
  L.push("THE FENCE (what this gauge never does)");
  L.push(
    "  Never enters f() / the floor / any gate verdict / any disposition. Never " +
      "feeds back into MICA's behaviour — a diary the observer keeps about the " +
      "loop, never a control input. One shared gauge on the whole loop, never a " +
      "per-node score. HIGH raises nothing; DRY is the only finding."
  );
  L.push(
    "  NAMED RESIDUAL, not closed: the gauge is only as good as the adjudicator. " +
      "A rubber-stamping arbiter fills the well, and the gauge cannot certify the " +
      "adjudicator's fitness (the H-row fence). Accountability rests on a human " +
      "node until the legal ground shifts."
  );
  L.push(bar());
  return L.join("\n");
}

function trunc(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= n ? flat : flat.slice(0, n - 1) + "…";
}

function wrap(s: string, width: number, indent: string): string[] {
  const words = s.replace(/\s+/g, " ").trim().split(" ");
  const out: string[] = [];
  let cur = indent;
  for (const w of words) {
    if (cur.length + w.length + 1 > width + indent.length && cur !== indent) {
      out.push(cur);
      cur = indent + w;
    } else {
      cur = cur === indent ? indent + w : cur + " " + w;
    }
  }
  if (cur.trim().length > 0) out.push(cur);
  return out;
}

function main(): void {
  const arg = process.argv[2];
  const ledgerAbs = arg !== undefined ? path.resolve(arg) : DEFAULT_LEDGER;

  let markdown: string;
  let bytes: number;
  try {
    const buf = fs.readFileSync(ledgerAbs);
    bytes = buf.length;
    markdown = buf.toString("utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    process.stdout.write(
      `${bar()}\nMICA · DRY WELL GAUGE\n${bar()}\n` +
        `!! COULD NOT READ THE BOOK: ${ledgerAbs}\n` +
        `   ${e.message ?? e.code ?? "READ_FAILED"}\n` +
        "   This is a blindness about the input, printed loud, not a reading.\n" +
        `${bar()}\n`
    );
    process.exitCode = 2;
    return;
  }

  const c = DWG_PROXY_CALIBRATION;
  const parsed = parseLedger(markdown, c.weights);
  const reading0 = fold(parsed.events, c);
  const reading: Reading = {
    ...reading0,
    blindRowCount: parsed.blindRows.length,
    malformedRowCount: parsed.malformedRows.length,
  };

  process.stdout.write(render(ledgerAbs, bytes, parsed, reading, c) + "\n");
}

main();
