// ── MICA · the SCORER'S BRIEF — what a cold scorer may read, and nothing else (Long Run B) ──
//
//   scorer-brief.ts --register R --case-dir D --capture-dir X --rubric P --score-out F --out B [--addendum A]
//
// Writes the brief B: the rubric verbatim, then the ONLY files the scorer may read (case, prediction, window,
// delivered-at, the capture's MANIFEST and every file it lists, the manifest's commitment), each with its sha256,
// the register lines that commit the case and the window, and the one path it writes (score-out). It names no build
// note, no receipt, no tree and no other case. The scorer re-hashes everything itself.
//
// --addendum A (MP32): the audit's addendum file (ceilings to record; data, not rubric). A section "## Audit addendum"
// is inserted before "## The rubric" naming A's absolute path and sha256; it counts in "N files listed". The scorer-side
// register line (register.ts scored --addendum A) must name the same A. Without the flag the brief is byte-identical to before.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join, resolve } from "path";

import { readAddendum, args, CASE_FILE, caseLines, MANIFEST_COMMIT_SUFFIX, need, PREDICTION_FILE, sha256File, STAMP_FILE, WINDOW_FILE } from "./probe-lib";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function main(): void {
  const { opt } = args(process.argv.slice(2));
  // Every path the scorer is handed is absolute: it does not share the caller's working directory.
  const caseDir = resolve(need(opt, "case-dir"));
  const cap = resolve(need(opt, "capture-dir"));
  const rubric = resolve(need(opt, "rubric"));
  const scoreOut = resolve(need(opt, "score-out"));
  const out = need(opt, "out");
  const caseId = caseDir.split("/").pop()!;
  const lines = caseLines(readFileSync(need(opt, "register"), "utf8"), caseId).filter((l) => l.kind !== "SCORED");
  const files = [rubric, join(caseDir, CASE_FILE), join(caseDir, PREDICTION_FILE), join(caseDir, WINDOW_FILE), join(caseDir, STAMP_FILE), cap + MANIFEST_COMMIT_SUFFIX, ...walk(cap)]
    .filter((p) => existsSync(p));
  const ad = opt.has("addendum") ? readAddendum(need(opt, "addendum")) : null;
  const brief =
    `# Scorer brief — case ${caseId}\n\n` +
    "You are a cold scorer. You did not build this harness, this case or this prediction, and you have seen no note about them. " +
    "Score by the rubric below, alone. Read ONLY the files listed under 'Files you may read' (re-hash each one yourself with " +
    "`sha256sum`); read nothing else on this machine — no repository, no notes, no other case, no network. Write exactly one file: " +
    `\`${scoreOut}\` (it does not exist yet; create it). Do not modify any other file. When done, reply with the score line only.\n\n` +
    "## The register lines that commit this case (copied from the register)\n\n" +
    lines.map((l) => "```\n" + l.raw + "\n```").join("\n") +
    "\n\n## Files you may read (path · sha256 at brief time)\n\n" +
    files.map((p) => `- \`${p}\` · ${sha256File(p)}`).join("\n") +
    (ad === null
      ? ""
      : "\n\n## Audit addendum (one more file you may read; the audit's, appended after the brief was generated)\n\n" +
        `- \`${ad.path}\` · ${ad.sha}\n\n` +
        "Re-hash it yourself. It is data, not a rubric: it states limits to record in `ceilings`; it changes no score rule. Add it to `readFiles`.") +
    `\n\n## The rubric (sha256 ${sha256File(rubric)})\n\n` +
    readFileSync(rubric, "utf8");
  writeFileSync(out, brief, { flag: "wx" });
  console.log(`BRIEF ${out} sha256 ${sha256File(out)} (${files.length + (ad === null ? 0 : 1)} files listed)`);
}

try {
  main();
} catch (e) {
  console.error(`scorer-brief: ${(e as Error).message}`);
  process.exit(1);
}
