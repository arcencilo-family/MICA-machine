#!/usr/bin/env node
// ── MICA · declare-pilot2 — A SHIM. The tool moved; this name did not ───────
//
// S128-7. What used to live here is now in two files:
//
//   tools/declare-rulings.ts   the machinery — pilot-independent, one file forever
//   tools/rulings-pilot2.ts    pilot 2's eight readings, frozen, bound by sha
//
// ── THE HEADER SENTENCE THIS FILE USED TO CARRY WAS FALSE, AND IS CORRECTED ─
//
//   It said: "This file is where pilot 2 and everything after it lives."
//
//   IT COULD NOT BE. Pilot 3 is the same family — same four N5 scenarios, same
//   two variants, same single seed — so it has THE SAME EIGHT
//   `(scenarioId, variant)` KEYS. Running this tool over pilot 3's template
//   would have found every entry pristine, every `captureSha256` present in
//   pilot 3's captures, a ruling for every entry and no ruling unused. It would
//   have printed `written 8` and exited 0, binding a local model's readings to
//   an API model's replies.
//
//   That is the sentence this file's own header wrote about
//   `scripts/declare-s120.py`, one pilot along, with this file as the weapon
//   instead of the fence. The `--captures` binding could not catch it: it binds
//   the TEMPLATE to the CAPTURES, and nothing bound the READINGS to the RUN.
//
//   The corrected sentence is: THIS FILE IS PILOT 2'S, AND ONLY EVER WAS.
//   Every pilot's readings get their own frozen table; the machinery is shared.
//
// ── WHY IT IS A SHIM AND NOT DELETED ───────────────────────────────────────
//
//   1. The register cites `tools/declare-pilot2.ts` at three shas (`9199d20`,
//      `ca27628`, `871159a`) as the tool that wrote pilot 2's three
//      declarations. Deleting the name would leave three rows pointing at
//      nothing.
//   2. `RULINGS` is re-exported so those citations still resolve to the same
//      values, and `declare-rulings.test.ts` DR-2 pins that against a sha taken
//      from this file's own export before the split.
//
//   AND ITS `main` REFUSES WHATEVER IT IS HANDED. A shim that still ran would
//   have kept the hazard alive under the old name, which is the one thing the
//   split was for.
//
// EXIT CODES
//   2  always. There is no path through this file that fills anything.

import { PILOT2_READINGS } from "./rulings-pilot2";

export const EXIT = { OK: 0, REFUSED: 2 } as const;

/** Pilot 2's eight readings, for the register rows that cite this name. */
export const RULINGS = PILOT2_READINGS;

export const MOVED =
  "refused: tools/declare-pilot2.ts is a shim and fills nothing. The machinery moved to " +
  "tools/declare-rulings.ts and pilot 2's readings to tools/rulings-pilot2.ts (S128-7). " +
  "Use: ts-node tools/declare-rulings.ts --rulings <pilot> --path <template.json> " +
  "--captures <captures.jsonl> --expect <n> [--declared-at <iso>] [--write]. " +
  "This name kept its RULINGS export so the register rows that cite it still resolve; it " +
  "kept no way to run, because a tool whose table is one pilot's and whose key space is every " +
  "pilot's is a tool that succeeds on the wrong run.";

export function main(argv: readonly string[], out: (s: string) => void): number {
  void argv;
  out(MOVED);
  return EXIT.REFUSED;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2), (s) => void console.log(s)));
}
