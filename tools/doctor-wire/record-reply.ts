#!/usr/bin/env node
// ── MICA · doctor wire — record-reply ──────────
//
//   node node_modules/ts-node/dist/bin.js tools/doctor-wire/record-reply.ts <declaration.json>
//
// One reply on stdin, {answersSequenceNumber, answersHash}: the notice book record it answers.
// The caller is the uid this process runs as, checked against the declaration;
// everything else is in src/doctor-wire/cli.ts. Exit: 0 done, 1 refused or not
// written, 2 the input or declaration is unusable.

import { readFileSync } from "fs";

import { recordReply } from "../../src/doctor-wire/cli";

const declarationPath = process.argv[2];
if (declarationPath === undefined || process.argv.length !== 3) {
  console.error("usage: record-reply.ts <declaration.json>");
  process.exit(2);
}
const uid = typeof process.getuid === "function" ? process.getuid() : -1;
const stdin = readFileSync(0, "utf8");
const result = recordReply({ declarationPath, uid, stdin });
for (const line of result.lines) (result.exitCode === 0 ? console.log : console.error)(line);
process.exit(result.exitCode);
