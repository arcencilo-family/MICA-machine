#!/usr/bin/env node
// ── MICA · assemble-cli — run the assembler against a live book ───────────────
//
// ONE SENTENCE THIS TOOL IS ALLOWED TO SAY:
//
//   The book at the named path was read (or the read was refused and the acts
//   that would fix it are printed), the presented observations were joined to
//   it, and what came out is printed with its provenance and its ceiling.
//
// It creates nothing, grants nothing, and writes nowhere. Output goes to stdout.
//
// EXIT CODES
//   0  assembled — a ProbeSource was emitted (possibly empty, which is stated)
//   3  the read was REFUSED: a deployment act is missing. Not a code defect, and
//      not a failure of this tool — the signpost and the acts are printed.
//   4  the book or the observations were malformed and assembly refused to
//      repair them.

import { readFileSync, writeFileSync } from "fs";
import {
  declareSweepPeriod,
  isSweepPeriodRefusal,
  ASSEMBLER_ID,
  AssemblerDeploymentActMissingError,
  AssemblerRefused,
  MIRRORED_INTENT_RECORD_CLASSES,
  assemble,
  deploymentActProposal,
  parseBook,
} from "./assembler";
import type { DeclaredSweepPeriod, IntentRecordCensus, ObservationInput } from "./assembler";

export const DEFAULT_BOOK = "/var/lib/mica/precommit/mica-doctor/book.jsonl";

function whoAmI(): string {
  // The principal this process ACTUALLY ran as, not the one a document says it
  // should be. If the platform cannot tell us, we say that rather than guess.
  const g = process.getuid;
  if (typeof g !== "function") return "unknown-principal (no getuid on this platform)";
  return `uid ${String(g.call(process))}`;
}

function loadObservations(path: string | undefined): readonly ObservationInput[] {
  if (path === undefined) return [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT")
      throw new AssemblerRefused(
        `the observation file ${path} does not exist.`,
        "Observations are presented, never fetched — this reader looked at the " +
          "path given and found nothing there. Nothing was assembled."
      );
    throw new AssemblerRefused(
      `the observation file ${path} could not be read: ${String(err)}`,
      "Something is at that path but this reader could not open it — a different " +
        "failure from 'not there', and printed as one. Nothing was assembled."
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new AssemblerRefused(
      `the observation file ${path} is present but is not valid JSON: ${String(err)}`,
      "A file that exists but does not parse is not the same failure as one that " +
        "is not there, and this reader does not repair it by guessing. Nothing " +
        "was assembled."
    );
  }
  if (!Array.isArray(parsed))
    throw new AssemblerRefused(
      `the observation file ${path} does not hold a JSON array.`,
      "Observations are presented as a list. A single object is not one, and " +
        "this reader does not wrap it into one on the caller's behalf."
    );
  return parsed as readonly ObservationInput[];
}

/** Soft-wraps one long sentence under a hanging indent, so the tail is readable. */
function wrapUnder(label: string, text: string, width = 60): readonly string[] {
  const indent = " ".repeat(label.length);
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line.length > 0 && line.length + 1 + word.length > width) {
      out.push(line);
      line = "";
    }
    line = line.length === 0 ? word : `${line} ${word}`;
  }
  if (line.length > 0) out.push(line);
  return out.map((l, i) => (i === 0 ? `${label}${l}` : `${indent}${l}`));
}

/**
 * THE GATE-5 INTENT RECORDS, and who grades them.
 *
 * Printed for EVERY run, including one where the count is zero — an absent
 * grader over zero records is still the state, and a block that appeared only
 * when records existed would let a reader of a quiet book conclude nothing was
 * missing. `graded by: NOBODY YET` is a state, not a refusal: the exit code is
 * untouched by anything in here.
 */
function printIntentRecords(census: IntentRecordCensus): void {
  console.log("── THE GATE-5 INTENT RECORDS ───────────────────────────────");
  console.log("");
  for (const cls of MIRRORED_INTENT_RECORD_CLASSES) {
    console.log(`  ${cls.padEnd(26)}${String(census.revealedByClass[cls] ?? 0)}  revealed`);
  }
  console.log(`  ${"revealed total".padEnd(26)}${String(census.revealedTotal)}`);
  console.log(`  ${"unrevealed commitments".padEnd(26)}${String(census.unrevealedCommitments)}`);
  for (const line of wrapUnder("    of those, IR records:  ", census.unrevealedResidual)) {
    console.log(line);
  }
  console.log("");
  console.log(`  ${"grader state:".padEnd(26)}${census.graderState}`);
  for (const line of wrapUnder("  graded by:   ", census.graderStatement)) {
    console.log(line);
  }
  console.log("");
}

export function main(argv: readonly string[]): number {
  // `--out <path>` writes ONLY the ProbeSource JSON to a file, so the file is
  // created BY THIS PROCESS and therefore owned by the principal this process
  // runs as.
  //
  // WHY THAT MATTERS, and why a shell redirect will not do `[LB]`:
  //   `sudo -u mica-assembler … > /tmp/probe.json` opens the file as THE CALLER,
  //   not as mica-assembler — the same trap CLAUDE.md §4 already names for
  //   `sudo cmd < path`. The redirect would leave a root-owned file, the probe
  //   door would refuse it WRONG_OWNER, and the operator would be left believing
  //   the assembler wrote it. Writing from inside the process closes that.
  const rest: string[] = [];
  let outPath: string | undefined;
  let sweepRaw: string | undefined;
  let declaredBy = "";
  let basis = "";
  const takesValue: Record<string, (v: string) => void> = {
    "--out": (v) => { outPath = v; },
    "--sweep-period-ms": (v) => { sweepRaw = v; },
    "--declared-by": (v) => { declaredBy = v; },
    "--basis": (v) => { basis = v; },
  };
  for (let i = 0; i < argv.length; i++) {
    const take = takesValue[argv[i]];
    if (take !== undefined) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) {
        console.log(`${argv[i]} needs a value`);
        return 4;
      }
      take(v);
      i++;
      continue;
    }
    rest.push(argv[i]);
  }
  argv = rest;
  const bookPath = argv[0] ?? DEFAULT_BOOK;
  const obsPath = argv[1];

  // ── THE OLD POSITIONAL SWEEP ARGUMENT IS REFUSED, NOT IGNORED (S103) ───────
  //
  //   It used to be `argv[2]`, read as `Number(argv[2])` and kept if
  //   `Number.isFinite` liked it. Silently ignoring a third positional now
  //   would turn every old invocation into one that declares NOTHING while
  //   looking exactly as it always did — the operator would read
  //   ORDER_NOT_ESTABLISHED as a finding about the book. So it refuses.
  if (argv[2] !== undefined) {
    console.log("── REFUSED · the sweep period is no longer positional ──────");
    console.log("");
    console.log(`  got a third positional argument: ${JSON.stringify(argv[2])}`);
    console.log("");
    console.log("  A sweep period is DECLARED, not passed. Use:");
    console.log("    --sweep-period-ms <n> --declared-by <who> [--basis <text>]");
    console.log("");
    console.log("  This is refused rather than ignored: ignoring it would make an");
    console.log("  old command declare nothing while looking unchanged, and");
    console.log("  ORDER_NOT_ESTABLISHED would then read as a finding about the book.");
    return 4;
  }

  let sweepPeriod: DeclaredSweepPeriod | undefined;
  if (sweepRaw !== undefined || declaredBy !== "" || basis !== "") {
    const declared = declareSweepPeriod(
      sweepRaw === undefined ? undefined : Number(sweepRaw),
      declaredBy,
      basis
    );
    if (isSweepPeriodRefusal(declared)) {
      console.log("── REFUSED · the sweep period was not declared honestly ────");
      console.log("");
      console.log(`  ${declared.reason}`);
      console.log("");
      console.log("  Nothing was assembled. Declaring NO period is a supported and");
      console.log("  honest run: every record then reads ORDER_NOT_ESTABLISHED.");
      return 4;
    }
    sweepPeriod = declared;
  }

  console.log(`${ASSEMBLER_ID} — running as ${whoAmI()}`);
  console.log(`book:         ${bookPath}`);
  console.log(`observations: ${obsPath ?? "(none presented)"}`);
  console.log(
    sweepPeriod === undefined
      ? "sweep period:  (none declared — every record will read ORDER_NOT_ESTABLISHED)"
      : `sweep period:  ${sweepPeriod.ms} ms DECLARED BY ${sweepPeriod.declaredBy}` +
        `${sweepPeriod.basis === "" ? "" : ` (${sweepPeriod.basis})`}` +
        "\n               a COMMITMENT, not a measurement of this box"
  );
  console.log("");

  let raw: string;
  try {
    // Imported lazily so the signpost path is exercised even when the module
    // graph is loaded on a box that has no book at all.
    const { readBookOrSignpost } = require("./assembler");
    raw = readBookOrSignpost(bookPath) as string;
  } catch (err) {
    if (err instanceof AssemblerDeploymentActMissingError) {
      console.log("── READ REFUSED · A DEPLOYMENT ACT IS MISSING ──────────────");
      console.log("");
      console.log(err.message);
      console.log("");
      console.log("This is not a defect in this tool and not a failure of the run.");
      console.log("The acts below are the ARBITER'S, and this tool performed none:");
      console.log("");
      for (const line of deploymentActProposal(bookPath.replace(/\/[^/]*$/, ""))) {
        console.log(`  ${line}`);
      }
      console.log("");
      return 3;
    }
    throw err;
  }

  try {
    const book = parseBook(raw);
    const result = assemble({
      bookPath,
      book,
      observations: loadObservations(obsPath),
      sweepPeriod,
      ranAs: whoAmI(),
    });

    console.log(`book records read:      ${result.bookRecordCount}`);
    console.log(`probe records emitted:  ${result.probeSource.length}`);
    console.log(`observations withheld:  ${result.withheld.length}`);
    console.log("");
    for (const w of result.withheld) {
      console.log(`  WITHHELD ${w.reason} · commitment ${w.observation.commitmentSeq}`);
      console.log(`    ${w.detail}`);
    }
    if (result.withheld.length > 0) console.log("");
    // AFTER the counts and the withheld detail, BEFORE the ProbeSource. Placed
    // after the withheld list rather than between it and its own count line,
    // so a withheld entry stays attached to the number that announced it.
    printIntentRecords(result.intentRecords);
    console.log("── ProbeSource (inject verbatim into SigConfig.probeSource) ──");
    const json = JSON.stringify(result.probeSource, null, 2);
    console.log(json);
    console.log("");
    if (outPath !== undefined) {
      writeFileSync(outPath, json + "\n", { mode: 0o644 });
      console.log(
        `  WROTE ${outPath} (mode 0644, owned by the principal this process ran as: ${whoAmI()}).`
      );
      console.log(
        "  That ownership is the whole point: mica-guard's probe door admits a"
      );
      console.log(
        `  ProbeSource only when it is owned by mica-assembler and the invoker`
      );
      console.log("  cannot write it.");
      console.log("");
    }
    for (const line of result.ceiling) console.log(`  · ${line}`);
    return 0;
  } catch (err) {
    if (err instanceof AssemblerRefused) {
      console.log("── ASSEMBLY REFUSED · nothing was repaired ─────────────────");
      console.log("");
      console.log(`  ${err.message}`);
      console.log(`  ground: ${err.ground}`);
      console.log("");
      return 4;
    }
    throw err;
  }
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
