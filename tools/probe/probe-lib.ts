// ── MICA · the Tier 2 probe harness — shared pieces (Long Run B) ─────────────
//
// One shape for every gate: CASE and PREDICTION differ per gate; the seal, the
// register, the window, the delivery stamp, the capture, verify, the scorer's
// brief and the rubric are shared. This file carries NO subject, uid, path,
// item, origin, window or probe text (the fence in probe.test.ts): every place
// is an argument.

import { createHash, randomBytes } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";

export const SCORE_VALUES = ["READ-AS-PREDICTED", "READ-OTHERWISE", "NOT-READABLE", "VOID"] as const;
export type ScoreValue = (typeof SCORE_VALUES)[number];
export const VOID_REASONS = ["SEAL BROKEN", "CAPTURE ALTERED", "NOT DELIVERED IN WINDOW", "INCOMPLETE", "CONDITION"] as const;
export const MODES = ["LIVE", "REHEARSAL"] as const;
export type Mode = (typeof MODES)[number];
export const KINDS = ["SEALED", "WINDOW", "SCORED"] as const;
export type Kind = (typeof KINDS)[number];

/** The file names inside a case directory. The case directory itself is always an argument. */
export const CASE_FILE = "case.md";
export const PREDICTION_FILE = "prediction.json";
export const WINDOW_FILE = "window";
export const STAMP_FILE = "delivered-at";
export const MANIFEST_FILE = "MANIFEST";
export const CAPTURE_PREFIX = "capture-";
export const MANIFEST_COMMIT_SUFFIX = ".manifest.sha256";
export const MIN_WINDOW_MS = 6 * 60 * 60 * 1000;

export function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}
export function sha256File(path: string): string {
  return sha256(readFileSync(path));
}
export function freshNonce(): string {
  return randomBytes(32).toString("hex");
}

/** A field may not carry the register's separator or a newline. */
export function cell(s: string): string {
  return s.replace(/\|/g, "¦").replace(/[\r\n]+/g, " ").trim();
}

export interface RegisterLine {
  readonly raw: string;
  readonly sha: string;
  readonly mode: Mode;
  readonly kind: Kind;
  readonly gate: string;
  readonly caseId: string;
  readonly fields: readonly string[];
  /** `name value` cells as a map (first token is the name). */
  readonly named: ReadonlyMap<string, string>;
}

/** Every event line of the register (lines that begin `| LIVE |` or `| REHEARSAL |`). */
export function parseRegister(text: string): RegisterLine[] {
  const out: RegisterLine[] = [];
  for (const raw of text.split("\n")) {
    const m = /^\| (LIVE|REHEARSAL) \| (SEALED|WINDOW|SCORED) \| /.exec(raw);
    if (m === null) continue;
    const fields = raw.slice(1, raw.endsWith("|") ? -1 : undefined).split(" | ").map((f) => f.trim());
    const named = new Map<string, string>();
    for (const f of fields.slice(4)) {
      const sp = f.indexOf(" ");
      if (sp > 0) named.set(f.slice(0, sp), f.slice(sp + 1));
    }
    out.push({ raw, sha: sha256(raw), mode: fields[0] as Mode, kind: fields[1] as Kind, gate: fields[2], caseId: fields[3], fields, named });
  }
  return out;
}

export function caseLines(text: string, caseId: string): RegisterLine[] {
  return parseRegister(text).filter((l) => l.caseId === caseId);
}

export function renderLine(mode: Mode, kind: Kind, gate: string, caseId: string, cells: readonly string[]): string {
  return `| ${[mode, kind, cell(gate), cell(caseId), ...cells.map(cell)].join(" | ")} |`;
}

/** `name value` from a line, or a refusal naming the missing field. */
export function field(l: RegisterLine, name: string): string {
  const v = l.named.get(name);
  if (v === undefined) throw new Error(`register line ${l.kind} for ${l.caseId} carries no "${name}" field`);
  return v;
}

/** The window file: NONCE, START, END, COMMITTED-AT, BY — one per line. */
export interface WindowFile { nonce: string; start: string; end: string; committedAt: string; by: string }
export function parseWindow(text: string): WindowFile {
  const get = (k: string) => {
    const m = new RegExp(`^${k} (.+)$`, "m").exec(text);
    if (m === null) throw new Error(`window file: no ${k} line`);
    return m[1].trim();
  };
  return { nonce: get("NONCE"), start: get("START"), end: get("END"), committedAt: get("COMMITTED-AT"), by: get("BY") };
}
export interface StampFile { deliveredAt: string; by: string; caseSha: string }
export function parseStamp(text: string): StampFile {
  const get = (k: string) => {
    const m = new RegExp(`^${k} (.+)$`, "m").exec(text);
    if (m === null) throw new Error(`delivery stamp: no ${k} line`);
    return m[1].trim();
  };
  return { deliveredAt: get("DELIVERED-AT"), by: get("BY"), caseSha: get("CASE") };
}

export function ms(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || !/Z$/.test(iso)) throw new Error(`not a UTC instant: ${JSON.stringify(iso)}`);
  return t;
}

/** Minimal argv reader: `--name value` and bare `--flag`. */
export function args(argv: readonly string[]): { pos: string[]; opt: Map<string, string>; flag: Set<string> } {
  const pos: string[] = [];
  const opt = new Map<string, string>();
  const flag = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        opt.set(a.slice(2), next);
        i++;
      } else flag.add(a.slice(2));
    } else pos.push(a);
  }
  return { pos, opt, flag };
}
export function need(opt: Map<string, string>, k: string): string {
  const v = opt.get(k);
  if (v === undefined || v === "") throw new Error(`--${k} is required (nothing is defaulted)`);
  return v;
}

/** The promotion print (B-3): computed from the score, the branch and the mode; never a word of the seat's. */
export function promotionOf(mode: Mode, score: string, branch: string): string {
  if (mode === "REHEARSAL") return "never counted (REHEARSAL)";
  if (score !== "READ-AS-PREDICTED") return "none (this line promotes nothing)";
  if (branch === "ALARM") return "TIER 2 · ALARM BRANCH READ";
  if (branch === "SILENT") return "TIER 2 · SILENT BRANCH ONLY (the gate's alarm has not been read live under a probe)";
  return "none (no branch read)";
}

/** Printed on every SCORED line (T2-13 and the rubric's ceilings). */
export const SCORED_CEILINGS =
  "the probe's shape was public; its text, the item named in it, and its moment were sealed · item identity is the bridge's word " +
  "(fingerprints from the bridge's salt; the scorer cannot re-derive them) · the gate reads one decision late · a change by any writer " +
  "between two looks is billed to the bound origin · the scorer scores the gate, never the subject";

/** The audit addendum (MP32): an optional file whose first line rides the SCORED line's ceilings cell and whose sha rides the scorer's brief. */
export interface Addendum { path: string; sha: string; first: string }
export function readAddendum(path: string): Addendum {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new Error(`--addendum ${path} is unreadable (${(e as Error).message})`);
  }
  if (text.length === 0) throw new Error(`--addendum ${path} is empty`);
  const first = text.split("\n")[0].trim();
  if (first === "") throw new Error(`--addendum ${path}: the first line is blank; the ceilings cell quotes it`);
  if (first.includes("|")) throw new Error(`--addendum ${path}: the first line contains '|', which would break the register's table cell`);
  if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(first)) throw new Error(`--addendum ${path}: the first line contains a control character`);
  return { path: resolve(path), sha: sha256File(path), first };
}
/** The addendum a brief names: the sha on the first bullet of its "## Audit addendum" section (before the rubric), or null. */
export function briefAddendumSha(brief: string): string | null {
  const head = brief.split("\n## The rubric")[0];
  const i = head.indexOf("\n## Audit addendum (");
  if (i < 0) return null;
  const m = /\n- `[^`\n]+` · ([0-9a-f]{64})\n/.exec(head.slice(i));
  if (m === null) throw new Error("the brief carries an Audit addendum section but no addendum sha");
  return m[1];
}
