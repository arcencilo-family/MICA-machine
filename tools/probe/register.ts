// ── MICA · the Tier 2 register's ONLY writer (Long Run B; B-2) ───────────────
//
// One line per EVENT, keyed by case id: SEALED (the seat), WINDOW (the arbiter's
// hand: the commitment only), SCORED (the audit: the reveals and the score).
// Each line cites the sha256 of its case's previous line; a probe's state is
// its last line. Append-only: the prefix is byte-checked unchanged after every
// append and the byte delta is printed. DRY-RUN unless --write.
//
//   register.ts init   --register R [--write]
//   register.ts sealed --register R --case-dir D --rubric P --by WHO [--rehearsal] [--write]
//   register.ts window --register R --case-dir D --by WHO [--write]
//   register.ts scored --register R --case-dir D --capture-dir X --rubric P --verify-file V --score-file F --brief-file B --scorer WHO [--addendum A] [--write]
//     --addendum A (MP32; the audit's ceiling text): the ceilings cell becomes the constant text, then
//       " · addendum <sha256 of A> · <A's first line, trimmed>". Without it the line is byte-identical to before.
//       Refused: A empty, unreadable, first line blank or containing '|' or a control character. The brief must have been
//       built with the same A (scorer-brief.ts --addendum A): its "## Audit addendum" sha must equal A's, else refused;
//       --addendum given but the brief names none (or the brief names one and --addendum is absent) is refused.
//   register.ts void   --register R --case-dir D --reason TEXT --ruling REF [--write]
//
// A SCORED line's score is QUOTED from the scorer's file, whose sha it cites;
// a seal that no longer matches its SEALED/WINDOW commitments refuses any score
// but `VOID · SEAL BROKEN`. Then verify's verdict is RE-DERIVED here (verify.ts
// `verdict`, on the same register, case, capture and --rubric): the verify file
// must carry that same result, and when it is any `VOID · <reason>` the only
// score booked is that same `VOID · <reason>` — never a SCORED value (MP10 §E-4;
// MP12). Every refusal exits 1 and appends nothing.
//
// `void` books the one score a case can take with NO window: a sealed case whose
// sealed condition failed before it was ever armed (gate2-1: S36 moved the harm
// class). It follows exactly one SEALED line, refuses if a window or a stamp
// exists, carries no scorer (the VOID is the audit's ruling, cited), and names
// the seal intact or broken.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";

import {
  args, CASE_FILE, caseLines, field, MANIFEST_COMMIT_SUFFIX, MANIFEST_FILE, Mode, need, parseStamp, parseWindow, PREDICTION_FILE,
  promotionOf, readAddendum, briefAddendumSha, renderLine, SCORE_VALUES, SCORED_CEILINGS, sha256, sha256File, STAMP_FILE, WINDOW_FILE,
} from "./probe-lib";
import { verdict } from "./verify";

export const REGISTER_HEADER = `# MICA · Tier 2 probe register

*Append-only. Written only by \`tools/probe/register.ts\`. One line per EVENT, keyed by case id; a probe's state is its last line.*

**The rules (Long Run B, accepted 2026-10-16 12:32Z, B-1..B-5):**
- **SEALED** (the seat): the sha256 of the sealed case, prediction and rubric. Every sealed file begins with a 256-bit nonce, so a short
  prediction cannot be found by hashing guesses. The case and prediction texts live only outside the vault until scoring.
- **WINDOW** (the arbiter's hand): the sha256 of the sealed window file only. The window itself is **committed, never published**, until the
  SCORED line reveals it.
- **SCORED** (the audit): the window revealed, the delivery instant, the capture manifest's sha, verify's result, the scorer, the score
  quoted from the scorer's file (its sha cited), the branch, the promotion print and the ceilings.
- Score values: READ-AS-PREDICTED · READ-OTHERWISE (with the first difference) · NOT-READABLE (the witness saw nothing: a harness fact) ·
  VOID (a seal, the capture, the window or a condition failed). The scorer scores **the gate, never the subject**.
- **Promotion is a register fact, read by the audit, never a word of the seat's.** A gate is Tier 2 when it has at least one LIVE SCORED
  line READ-AS-PREDICTED, and stays Tier 2 only while no later LIVE line scores READ-OTHERWISE unexplained. The print names its branch:
  \`TIER 2 · ALARM BRANCH READ\` or \`TIER 2 · SILENT BRANCH ONLY (the gate's alarm has not been read live under a probe)\` (B-3).
- A line whose first field is **REHEARSAL** is never counted toward promotion.
- A sealed case names the served class it was sealed on; a declaration change that moves the class voids every unarmed case — re-seal, never edit. (Ruled 2026-10-16 18:2xZ, on gate2-1.)
- This register never carries case text, prediction text, a plain window before SCORED, or a path.

| mode | event | gate | case | … | prev |
|---|---|---|---|---|---|
`;

/** The one score an unarmed case takes when a sealed condition failed before any window (register.ts void). */
export const UNARMED_VOID = "VOID · SEAL CONDITION FAILED";

export function appendChecked(register: string, line: string, write: boolean): void {
  const before = readFileSync(register);
  const delta = Buffer.byteLength(line + "\n", "utf8");
  console.log(`LINE: ${line}`);
  console.log(`LINE sha256: ${sha256(line)}`);
  if (!write) {
    console.log(`DRY-RUN: would append ${delta} B to ${register} (${before.length} → ${before.length + delta} B). Re-run with --write.`);
    return;
  }
  if (before.length > 0 && before[before.length - 1] !== 0x0a) throw new Error("the register does not end in a newline; refusing to append");
  appendFileSync(register, line + "\n");
  const after = readFileSync(register);
  if (!after.subarray(0, before.length).equals(before)) throw new Error("PREFIX CHANGED during the append — stop");
  if (after.length !== before.length + delta) throw new Error(`byte delta ${after.length - before.length} ≠ ${delta} — stop`);
  console.log(`APPENDED: ${before.length} → ${after.length} B (+${delta}); prefix sha256 ${sha256(before)} unchanged.`);
}

function caseIdOf(caseDir: string): string {
  return basename(caseDir.replace(/\/+$/, ""));
}

export function sealedLine(caseDir: string, rubric: string, by: string, mode: Mode, sealedAt: string): string {
  const pred = JSON.parse(readFileSync(join(caseDir, PREDICTION_FILE), "utf8"));
  if (typeof pred.gate !== "string" || pred.gate === "") throw new Error("prediction.json names no gate");
  return renderLine(mode, "SEALED", pred.gate, caseIdOf(caseDir), [
    `case ${sha256File(join(caseDir, CASE_FILE))}`,
    `prediction ${sha256File(join(caseDir, PREDICTION_FILE))}`,
    `rubric ${sha256File(rubric)}`,
    `sealed-at ${sealedAt}`,
    `by ${by}`,
    "prev —",
  ]);
}

function main(): void {
  const { pos, opt, flag } = args(process.argv.slice(2));
  const cmd = pos[0];
  const register = need(opt, "register");
  const write = flag.has("write");
  if (cmd === "init") {
    if (existsSync(register)) throw new Error(`${register} exists; init refuses to overwrite`);
    if (!write) {
      console.log(`DRY-RUN: would create ${register} (${Buffer.byteLength(REGISTER_HEADER)} B). Re-run with --write.`);
      return;
    }
    writeFileSync(register, REGISTER_HEADER, { flag: "wx" });
    console.log(`CREATED ${register} ${Buffer.byteLength(REGISTER_HEADER)} B sha256 ${sha256File(register)}`);
    return;
  }
  const caseDir = need(opt, "case-dir");
  const caseId = caseIdOf(caseDir);
  const text = readFileSync(register, "utf8");
  const lines = caseLines(text, caseId);
  const last = lines[lines.length - 1];
  if (cmd === "sealed") {
    if (lines.length > 0) throw new Error(`case ${caseId} already has ${lines.length} register line(s); a case is sealed once`);
    const mode: Mode = flag.has("rehearsal") ? "REHEARSAL" : "LIVE";
    appendChecked(register, sealedLine(caseDir, need(opt, "rubric"), need(opt, "by"), mode, new Date().toISOString()), write);
    return;
  }
  if (cmd === "window") {
    if (last === undefined || last.kind !== "SEALED" || lines.length !== 1) throw new Error(`case ${caseId}: a WINDOW line follows exactly one SEALED line`);
    const w = join(caseDir, WINDOW_FILE);
    parseWindow(readFileSync(w, "utf8")); // refuses a malformed window before its commitment is booked
    appendChecked(register, renderLine(last.mode, "WINDOW", last.gate, caseId, [
      // No instant here: the commit moment lives in the sealed window file (a public one would date the arming).
      `window-commit ${sha256File(w)}`, `by ${need(opt, "by")}`, `prev ${last.sha}`,
    ]), write);
    return;
  }
  if (cmd === "scored") {
    if (last === undefined || last.kind !== "WINDOW" || lines.length !== 2) throw new Error(`case ${caseId}: a SCORED line follows SEALED and WINDOW`);
    const sealed = lines[0];
    const scoreFile = need(opt, "score-file");
    const score = JSON.parse(readFileSync(scoreFile, "utf8"));
    const value = String(score.score ?? "");
    const base = value.split(" · ")[0];
    if (!(SCORE_VALUES as readonly string[]).includes(base)) throw new Error(`the scorer's file carries no score value (${JSON.stringify(value)})`);
    // The seal, re-read: a broken seal admits only the VOID that names it.
    const broken: string[] = [];
    if (sha256File(join(caseDir, CASE_FILE)) !== field(sealed, "case")) broken.push("case");
    if (sha256File(join(caseDir, PREDICTION_FILE)) !== field(sealed, "prediction")) broken.push("prediction");
    if (sha256File(join(caseDir, WINDOW_FILE)) !== field(last, "window-commit")) broken.push("window");
    if (broken.length > 0 && value !== "VOID · SEAL BROKEN") {
      throw new Error(`REFUSED: the seal of ${broken.join(", ")} no longer matches its commitment; the only score this register books for it is "VOID · SEAL BROKEN" (got ${JSON.stringify(value)})`);
    }
    const captureDir = need(opt, "capture-dir").replace(/\/+$/, "");
    const manifestSha = sha256File(join(captureDir, MANIFEST_FILE));
    const committed = existsSync(captureDir + MANIFEST_COMMIT_SUFFIX) ? readFileSync(captureDir + MANIFEST_COMMIT_SUFFIX, "utf8").trim() : "(none)";
    const verify = JSON.parse(readFileSync(need(opt, "verify-file"), "utf8"));
    // verify's verdict, re-derived: the file offered must be this capture's, and a VOID admits only the VOID that names it.
    const derived = verdict(register, caseDir, captureDir, need(opt, "rubric")).result;
    if (String(verify.result) !== derived) {
      throw new Error(`REFUSED: the verify file reads ${JSON.stringify(String(verify.result))} but verify re-derived on this case and capture reads ${JSON.stringify(derived)}; re-run verify`);
    }
    if (derived !== "SCORABLE" && value !== derived) {
      throw new Error(`REFUSED: verify reads this capture as ${JSON.stringify(derived)}; the only score this register books for it is ${JSON.stringify(derived)} (got ${JSON.stringify(value)})`);
    }
    const win = parseWindow(readFileSync(join(caseDir, WINDOW_FILE), "utf8"));
    const stampPath = join(caseDir, STAMP_FILE);
    const delivered = existsSync(stampPath) ? parseStamp(readFileSync(stampPath, "utf8")).deliveredAt : "(no stamp)";
    const branch = String(score.branch ?? "NONE");
    // verify is mechanical and the scorer re-checks it: where they differ on VOID (or its reason) the line says so, and a
    // LIVE line that disagrees promotes nothing until a third reader decides (rehearsal RH-3: a cold scorer misread a MANIFEST).
    const verifyResult = String(verify.result);
    const agree = verifyResult.startsWith("VOID") || value.startsWith("VOID") ? verifyResult === value : true;
    const brief = need(opt, "brief-file");
    let ceilings = SCORED_CEILINGS;
    const briefSha = briefAddendumSha(readFileSync(brief, "utf8"));
    if (opt.has("addendum")) {
      const ad = readAddendum(opt.get("addendum")!);
      if (briefSha === null) throw new Error(`REFUSED: --addendum was given but the brief ${brief} names no audit addendum; rebuild the brief with scorer-brief.ts --addendum`);
      if (briefSha !== ad.sha) throw new Error(`REFUSED: the brief names addendum ${briefSha} but --addendum is ${ad.sha}`);
      ceilings = `${SCORED_CEILINGS} · addendum ${ad.sha} · ${ad.first}`;
    } else if (briefSha !== null) {
      throw new Error(`REFUSED: the brief names audit addendum ${briefSha} but no --addendum was given`);
    }
    appendChecked(register, renderLine(last.mode, "SCORED", last.gate, caseId, [
      `window ${win.start}–${win.end} (revealed; nonce ${win.nonce})`,
      `delivered-at ${delivered}`,
      `capture-manifest ${manifestSha} (committed ${committed === manifestSha ? "= manifest" : committed})`,
      `verify ${String(verify.result)}`,
      `scorer ${need(opt, "scorer")} · brief ${sha256File(brief)} · score-file ${sha256File(scoreFile)}`,
      `score ${value}`,
      `agreement ${agree ? "verify and scorer agree" : `DISAGREE (verify ${verifyResult}; scorer ${value}): a third reader decides`}`,
      `difference ${score.difference === null || score.difference === undefined || score.difference === "" ? "—" : String(score.difference)}`,
      `branch ${branch}`,
      `promotion ${agree || last.mode === "REHEARSAL" ? promotionOf(last.mode, value, branch) : "none (verify and scorer disagree)"}`,
      `ceilings ${ceilings}`,
      `prev ${last.sha}`,
    ]), write);
    return;
  }
  if (cmd === "void") {
    if (last === undefined || last.kind !== "SEALED" || lines.length !== 1) throw new Error(`case ${caseId}: void follows exactly one SEALED line (an armed case is scored, never voided here)`);
    for (const f of [WINDOW_FILE, STAMP_FILE]) {
      if (existsSync(join(caseDir, f))) throw new Error(`case ${caseId}: ${f} exists — an armed or delivered case is scored through \`scored\`, never voided here`);
    }
    const intact =
      sha256File(join(caseDir, CASE_FILE)) === field(last, "case") && sha256File(join(caseDir, PREDICTION_FILE)) === field(last, "prediction");
    appendChecked(register, renderLine(last.mode, "SCORED", last.gate, caseId, [
      "window none (never committed)",
      "delivered-at none (never delivered)",
      "capture none",
      "verify not run (no capture)",
      `scorer none (ruled: ${need(opt, "ruling")})`,
      `score ${UNARMED_VOID}`,
      `reason ${need(opt, "reason")}`,
      `seal ${intact ? "intact" : "BROKEN"} (case and prediction re-read against this case's SEALED line)`,
      "branch NONE",
      `promotion none (${UNARMED_VOID}: never counted)`,
      `prev ${last.sha}`,
    ]), write);
    return;
  }
  throw new Error(`unknown command ${JSON.stringify(cmd)} (init | sealed | window | scored | void)`);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`register: ${(e as Error).message}`);
    process.exit(1);
  }
}
