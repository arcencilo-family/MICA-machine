// ── MICA · seal a probe case (Long Run B) ────────────────────────────────────
//
//   seal.ts --case-dir D --rubric P --register R --by WHO [--rehearsal] [--write]
//
// D holds the case as it will reach the subject (case.md) and the table the
// gate must read (prediction.json, with a `gate` field). Sealing:
//   1. refuses a case already sealed (a NONCE line, a read-only file, or a register line for this case id);
//   2. gives each file its OWN fresh 256-bit nonce (T2-2: a short prediction's hash could otherwise be found by guessing);
//   3. chmods both files 0400 and the directory 0500;
//   4. appends the SEALED line (case, prediction and rubric sha256) through register.ts.
// DRY-RUN unless --write. The case directory must not be readable by anyone but its owner (checked).

import { chmodSync, readFileSync, statSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";

import { args, CASE_FILE, caseLines, freshNonce, need, PREDICTION_FILE, sha256File } from "./probe-lib";
import { appendChecked, sealedLine } from "./register";

function main(): void {
  const { opt, flag } = args(process.argv.slice(2));
  const caseDir = need(opt, "case-dir").replace(/\/+$/, "");
  const rubric = need(opt, "rubric");
  const register = need(opt, "register");
  const by = need(opt, "by");
  const write = flag.has("write");
  const caseId = basename(caseDir);
  const casePath = join(caseDir, CASE_FILE);
  const predPath = join(caseDir, PREDICTION_FILE);

  for (const d of [caseDir, dirname(caseDir)]) {
    const mode = statSync(d).mode & 0o777;
    if ((mode & 0o077) !== 0) throw new Error(`${d} is mode ${mode.toString(8)}: a sealing place is the owner's alone (no group or other bits)`);
  }
  if (caseLines(readFileSync(register, "utf8"), caseId).length > 0) throw new Error(`case ${caseId} already has a register line: sealed once`);
  const caseText = readFileSync(casePath, "utf8");
  if (/^NONCE /.test(caseText)) throw new Error(`${casePath} already begins with a NONCE line: sealed once`);
  const pred = JSON.parse(readFileSync(predPath, "utf8"));
  if ("nonce" in pred) throw new Error(`${predPath} already carries a nonce: sealed once`);
  if (typeof pred.gate !== "string" || pred.gate === "") throw new Error("prediction.json must name its gate");
  for (const p of [casePath, predPath]) {
    if ((statSync(p).mode & 0o222) === 0) throw new Error(`${p} is already read-only: sealed once`);
  }
  if (!write) {
    console.log(`DRY-RUN: would seal ${caseId}: case ${Buffer.byteLength(caseText)} B, prediction (gate ${pred.gate}); rubric ${sha256File(rubric)}. Re-run with --write.`);
    return;
  }
  writeFileSync(casePath, `NONCE ${freshNonce()}\n${caseText}`);
  writeFileSync(predPath, JSON.stringify({ nonce: freshNonce(), ...pred }, null, 1) + "\n");
  chmodSync(casePath, 0o400);
  chmodSync(predPath, 0o400);
  chmodSync(caseDir, 0o500);
  const line = sealedLine(caseDir, rubric, by, flag.has("rehearsal") ? "REHEARSAL" : "LIVE", new Date().toISOString());
  console.log(`SEALED ${caseId}: case ${sha256File(casePath)} prediction ${sha256File(predPath)} (files 0400, dir 0500)`);
  // The register line goes through register.ts's own checked append (prefix unchanged, delta printed).
  appendChecked(register, line, true);
}

try {
  main();
} catch (e) {
  console.error(`seal: ${(e as Error).message}`);
  process.exit(1);
}
