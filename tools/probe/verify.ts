// ── MICA · VERIFY — mechanical, before any scorer; it does NOT score (Long Run B) ──
//
//   verify.ts --register R --case-dir D --capture-dir X --rubric P [--out F]
//
// In order, the first failure wins:
//   SEAL BROKEN              case / prediction / rubric ≠ the SEALED commitments, or window ≠ the WINDOW commitment
//   CAPTURE ALTERED          MANIFEST ≠ its committed sha, a listed file ≠ its line, or a file not listed
//   NOT DELIVERED IN WINDOW  no stamp; the stamp outside [START, END]; the window committed after the stamp; the stamp names another case
//   INCOMPLETE               the capture says so (T2-10), or its events are not contiguous: events-all.json's seqs
//                            must run 1 (or earlier), 2, … with no gap or repeat, and end at the last page's lastSeq (MP6)
//   CONDITION <n>            a mechanical condition the prediction declares, read from the capture, is unmet
// Prints `SCORABLE` or `VOID · <reason>`. The scorer re-checks all of it; this file is a convenience, never the score.
// Exit: 0 SCORABLE · 3 any `VOID · <reason>` (the verdict line and --out are written first) · 1 a usage error or an
// --out that cannot be written. A row that gates on the exit code therefore never passes a VOID (MP10 §E-3; MP12).

import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, relative } from "path";

import {
  args, CASE_FILE, caseLines, field, sha256, MANIFEST_COMMIT_SUFFIX, MANIFEST_FILE, ms, need, parseStamp, parseWindow, PREDICTION_FILE, sha256File,
  STAMP_FILE, WINDOW_FILE,
} from "./probe-lib";

export interface Condition {
  readonly n: number;
  readonly what: string;
  readonly source: "status" | "instrument" | "operator-word";
  readonly id?: string;
  readonly path: string;
  readonly op: "eq" | "contains" | "gte-window-end" | "lte-window-start" | "lte-delivered";
  readonly value?: unknown;
}
export interface Check { readonly name: string; readonly ok: boolean; readonly detail: string }

function at(obj: unknown, path: string): unknown {
  let cur: any = obj;
  for (const k of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** Every entry under dir, never following a link: a symlink or any non-regular file is reported, not read through. */
function walk(dir: string, odd: string[]): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const st = lstatSync(p);
    if (st.isDirectory()) out.push(...walk(p, odd));
    else if (st.isFile()) out.push(p);
    else odd.push(p);
  }
  return out;
}

/**
 * The gaps in a captured events book, empty when it is contiguous: every seq an integer, the first ≤ 1 (the book starts
 * at 1; a book may carry a 0), each next exactly the previous + 1, and the last equal to the book's lastSeq as the final
 * page reported it (an empty book: lastSeq 0). A capture that paged on the wrong cursor shows here (MP6).
 */
export function eventSeqGaps(events: unknown, lastSeq: unknown): string[] {
  const gaps: string[] = [];
  if (!Array.isArray(events)) return ["events-all.json is not a list"];
  let due: number | null = null;
  for (const e of events) {
    const raw = (e as any)?.seq;
    const n = typeof raw === "number" ? raw : typeof raw === "string" && /^-?\d+$/.test(raw.trim()) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(n)) {
      gaps.push(`an event with no integer seq (${JSON.stringify(raw)})`);
      continue;
    }
    if (due === null) {
      if (n > 1) gaps.push(`seqs 1..${n - 1} missing before the first captured seq ${n}`);
    } else if (n !== due) gaps.push(n > due ? `seqs ${due}..${n - 1} missing` : `seq ${n} where ${due} was due (repeated or out of order)`);
    due = n + 1;
  }
  const last = due === null ? 0 : due - 1;
  if (typeof lastSeq !== "number" || !Number.isSafeInteger(lastSeq)) gaps.push(`the last page carries no integer lastSeq (${JSON.stringify(lastSeq)})`);
  else if (last !== lastSeq) gaps.push(last < lastSeq ? `the capture ends at seq ${last} but the book's lastSeq is ${lastSeq} (${last + 1}..${lastSeq} missing)` : `the capture ends at seq ${last}, past the book's lastSeq ${lastSeq}`);
  return gaps;
}

/** events-all.json and the lastSeq of the highest-numbered events page, or the reason they cannot be read. */
function capturedEvents(cap: string): { events: unknown; lastSeq: unknown } | string {
  const pages = readdirSync(cap).filter((n) => /^events-page-\d+\.json$/.test(n)).sort((a, b) => Number(a.slice(12, -5)) - Number(b.slice(12, -5)));
  if (!existsSync(join(cap, "events-all.json")) || pages.length === 0) return "the capture carries no events-all.json or no events page";
  try {
    return { events: JSON.parse(readFileSync(join(cap, "events-all.json"), "utf8")), lastSeq: JSON.parse(readFileSync(join(cap, pages[pages.length - 1]), "utf8")).lastSeq };
  } catch (e) {
    return `the captured events cannot be read: ${(e as Error).message}`;
  }
}

export function verify(register: string, caseDir: string, captureDir: string, rubric: string): { result: string; checks: Check[] } {
  const checks: Check[] = [];
  const caseId = caseDir.replace(/\/+$/, "").split("/").pop()!;
  const lines = caseLines(readFileSync(register, "utf8"), caseId);
  const sealed = lines.find((l) => l.kind === "SEALED");
  const windowL = lines.find((l) => l.kind === "WINDOW");
  const result = (r: string) => ({ result: r, checks });
  if (sealed === undefined || windowL === undefined) {
    checks.push({ name: "register", ok: false, detail: `case ${caseId}: SEALED ${sealed !== undefined}, WINDOW ${windowL !== undefined}` });
    return result("VOID · SEAL BROKEN");
  }
  // 0 · the case's register lines chain (each cites the sha of the one before) — a rewrite that forgets prev shows here
  const chainOk = windowL.named.get("prev") === sealed.sha;
  checks.push({ name: "register chain", ok: chainOk, detail: `WINDOW prev ${chainOk ? "=" : "≠"} sha of SEALED` });
  if (!chainOk) return result("VOID · SEAL BROKEN");
  // 1 · the seal
  const seal: [string, string, string][] = [
    ["case", join(caseDir, CASE_FILE), field(sealed, "case")],
    ["prediction", join(caseDir, PREDICTION_FILE), field(sealed, "prediction")],
    ["rubric", rubric, field(sealed, "rubric")],
    ["window", join(caseDir, WINDOW_FILE), field(windowL, "window-commit")],
  ];
  let sealOk = true;
  for (const [name, p, want] of seal) {
    const got = existsSync(p) ? sha256File(p) : "(missing)";
    const ok = got === want;
    sealOk = sealOk && ok;
    checks.push({ name: `seal ${name}`, ok, detail: `${got} ${ok ? "=" : "≠"} committed ${want}` });
  }
  if (!sealOk) return result("VOID · SEAL BROKEN");
  // 2 · the capture against its manifest and the manifest against its commitment
  const cap = captureDir.replace(/\/+$/, "");
  const manifestPath = join(cap, MANIFEST_FILE);
  const commitPath = cap + MANIFEST_COMMIT_SUFFIX;
  let capOk = existsSync(manifestPath) && existsSync(commitPath);
  if (capOk) {
    const committed = readFileSync(commitPath, "utf8").trim();
    const msha = sha256File(manifestPath);
    capOk = committed === msha;
    checks.push({ name: "manifest commitment", ok: capOk, detail: `${msha} ${capOk ? "=" : "≠"} committed ${committed}` });
    const listed = new Map<string, string>();
    for (const l of readFileSync(manifestPath, "utf8").split("\n")) {
      if (l === "" || l.startsWith("#")) continue;
      const [sha, , , ...name] = l.split(" ");
      listed.set(name.join(" "), sha);
    }
    const odd: string[] = [];
    const regular = walk(cap, odd);
    for (const p of odd) {
      capOk = false;
      checks.push({ name: `capture entry ${relative(cap, p)}`, ok: false, detail: "not a regular file (a symlink or special file is never read through)" });
    }
    for (const p of regular) {
      const rel = relative(cap, p);
      if (rel === MANIFEST_FILE) continue;
      const want = listed.get(rel);
      const got = sha256File(p);
      if (want !== got) {
        capOk = false;
        checks.push({ name: `capture file ${rel}`, ok: false, detail: want === undefined ? "not listed in MANIFEST" : `${got} ≠ listed ${want}` });
      }
      listed.delete(rel);
    }
    for (const rel of listed.keys()) {
      capOk = false;
      checks.push({ name: `capture file ${rel}`, ok: false, detail: "listed in MANIFEST, missing on disk" });
    }
  } else checks.push({ name: "manifest", ok: false, detail: "MANIFEST or its commitment is missing" });
  if (!capOk) return result("VOID · CAPTURE ALTERED");
  checks.push({ name: "capture", ok: true, detail: "every file equals its MANIFEST line; MANIFEST equals its commitment" });
  // 3 · delivery inside the window, the window committed before it
  const w = parseWindow(readFileSync(join(caseDir, WINDOW_FILE), "utf8"));
  const stampPath = join(caseDir, STAMP_FILE);
  if (!existsSync(stampPath)) {
    checks.push({ name: "stamp", ok: false, detail: "no delivery stamp" });
    return result("VOID · NOT DELIVERED IN WINDOW");
  }
  const st = parseStamp(readFileSync(stampPath, "utf8"));
  const d = ms(st.deliveredAt);
  const inWin = ms(w.start) <= d && d <= ms(w.end);
  const before = ms(w.committedAt) <= d;
  const sameCase = st.caseSha === field(sealed, "case");
  const sealedFirst = ms(field(sealed, "sealed-at")) < d;
  let capturedSame = true;
  try {
    capturedSame = JSON.parse(readFileSync(join(cap, "decisions.json"), "utf8")).deliveredAt === st.deliveredAt;
  } catch {
    capturedSame = false;
  }
  checks.push({ name: "stamp vs seal and capture", ok: sealedFirst && capturedSame, detail: `sealed-at ${field(sealed, "sealed-at")} ${sealedFirst ? "before" : "NOT before"} the stamp; the capture's deliveredAt ${capturedSame ? "equals" : "DIFFERS FROM"} the stamp` });
  if (!(sealedFirst && capturedSame)) return result("VOID · NOT DELIVERED IN WINDOW");
  checks.push({ name: "stamp", ok: inWin && before && sameCase, detail: `delivered ${st.deliveredAt}; window ${inWin ? "contains it" : "does NOT contain it"}; committed ${w.committedAt} ${before ? "before" : "AFTER"} it; stamp names ${sameCase ? "this" : "ANOTHER"} case` });
  if (!(inWin && before && sameCase)) return result("VOID · NOT DELIVERED IN WINDOW");
  // 4 · completeness
  if (existsSync(join(cap, "INCOMPLETE"))) {
    checks.push({ name: "complete", ok: false, detail: readFileSync(join(cap, "INCOMPLETE"), "utf8").trim() });
    return result("VOID · INCOMPLETE");
  }
  const ce = capturedEvents(cap);
  const gaps = typeof ce === "string" ? [ce] : eventSeqGaps(ce.events, ce.lastSeq);
  if (gaps.length > 0) {
    checks.push({ name: "events contiguous", ok: false, detail: gaps.slice(0, 5).join("; ") + (gaps.length > 5 ? `; and ${gaps.length - 5} more` : "") });
    return result("VOID · INCOMPLETE");
  }
  checks.push({ name: "events contiguous", ok: true, detail: `${(ce as { events: unknown[] }).events.length} events, seqs contiguous to the book's lastSeq ${(ce as { lastSeq: unknown }).lastSeq}` });
  // 5 · the mechanical conditions the prediction declares
  const pred = JSON.parse(readFileSync(join(caseDir, PREDICTION_FILE), "utf8"));
  const status = JSON.parse(readFileSync(join(cap, "status.json"), "utf8"));
  const word = JSON.parse(readFileSync(join(cap, "operator-word.json"), "utf8"));
  for (const c of (pred.conditions ?? []) as Condition[]) {
    let v: unknown;
    if (c.source === "status") v = at(status, c.path);
    else if (c.source === "operator-word") v = at(word, c.path);
    else v = at((status.instruments ?? []).find((r: any) => r.id === c.id), c.path);
    let ok = false;
    if (c.op === "eq") ok = JSON.stringify(v) === JSON.stringify(c.value);
    else if (c.op === "contains") ok = typeof v === "string" && v.includes(String(c.value));
    else if (typeof v === "string") {
      const t = Date.parse(v);
      ok = c.op === "gte-window-end" ? t >= ms(w.end) : c.op === "lte-window-start" ? t <= ms(w.start) : t <= d;
    }
    checks.push({ name: `condition ${c.n}`, ok, detail: `${c.what}: ${c.source}${c.id ? `[${c.id}]` : ""}.${c.path} = ${JSON.stringify(v)?.slice(0, 160)} (${c.op}${c.value !== undefined ? ` ${JSON.stringify(c.value)}` : ""})` });
    if (!ok) return result(`VOID · CONDITION ${c.n}`);
  }
  return result("SCORABLE");
}

/** The exit code of every VOID verdict (0 is SCORABLE only; 1 stays a usage error). */
export const VOID_EXIT = 3;

/** verify(), with a case or capture it cannot even read taken as VOID · CAPTURE ALTERED — the one verdict the CLI and register.ts both use. */
export function verdict(register: string, caseDir: string, captureDir: string, rubric: string): { result: string; checks: Check[] } {
  try {
    return verify(register, caseDir, captureDir, rubric);
  } catch (e) {
    // A capture or case verify cannot even read is not scorable: it is VOID, never a crash someone retries past.
    return { result: "VOID · CAPTURE ALTERED", checks: [{ name: "readable", ok: false, detail: `verify could not read the case or capture: ${(e as Error).message}` }] };
  }
}

if (require.main === module) {
  try {
    const { opt } = args(process.argv.slice(2));
    const r = verdict(need(opt, "register"), need(opt, "case-dir"), need(opt, "capture-dir"), need(opt, "rubric"));
    for (const c of r.checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`);
    console.log(r.result);
    const out = opt.get("out");
    if (out !== undefined) writeFileSync(out, JSON.stringify(r, null, 1) + "\n", { flag: "wx" });
    // exitCode, not exit(): a piped stdout is flushed before the process ends.
    if (r.result !== "SCORABLE") process.exitCode = VOID_EXIT;
  } catch (e) {
    console.error(`verify: ${(e as Error).message}`);
    process.exit(1);
  }
}
