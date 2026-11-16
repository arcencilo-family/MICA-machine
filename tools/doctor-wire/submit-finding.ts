#!/usr/bin/env node
// ── MICA · doctor wire — submit-finding ──────────
//
//   node node_modules/ts-node/dist/bin.js tools/doctor-wire/submit-finding.ts <declaration.json>
//
// One doctor finding on stdin, {kind, window, scope}; an adverse one raises one notice.
// The caller is the uid this process runs as, checked against the declaration;
// everything else is in src/doctor-wire/cli.ts. Exit: 0 done, 1 refused or not
// written, 2 the input or declaration is unusable.

import { readFileSync } from "fs";

import { submitFinding } from "../../src/doctor-wire/cli";

const declarationPath = process.argv[2];
if (declarationPath === undefined || process.argv.length !== 3) {
  console.error("usage: submit-finding.ts <declaration.json>");
  process.exit(2);
}
const uid = typeof process.getuid === "function" ? process.getuid() : -1;
const stdin = readFileSync(0, "utf8");
const result = submitFinding({ declarationPath, uid, stdin });
for (const line of result.lines) (result.exitCode === 0 ? console.log : console.error)(line);
process.exit(result.exitCode);
