#!/usr/bin/env node
// ── MICA · doctor wire — pairing ──────────
//
//   node node_modules/ts-node/dist/bin.js tools/doctor-wire/pairing.ts <declaration.json>
//
// Each raising in the notice book, and the replies on record for it (stdin unused).
// Reading is open: no uid is checked, and the uid passed in is unused. Everything
// else is in src/doctor-wire/cli.ts. Exit: 0 done, 1 refused or not
// written, 2 the input or declaration is unusable.

import { printPairing } from "../../src/doctor-wire/cli";

const declarationPath = process.argv[2];
if (declarationPath === undefined || process.argv.length !== 3) {
  console.error("usage: pairing.ts <declaration.json>");
  process.exit(2);
}
const uid = typeof process.getuid === "function" ? process.getuid() : -1;
const stdin = "";
const result = printPairing({ declarationPath, uid, stdin });
for (const line of result.lines) (result.exitCode === 0 ? console.log : console.error)(line);
process.exit(result.exitCode);
