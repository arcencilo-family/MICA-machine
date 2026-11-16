// ── MICA · the machinery dashboard GENERATOR ──────────────────────────────────
//
// THIS FILE IS THE DELIVERABLE. The HTML it emits is a by-product that goes
// stale the moment anything on disk moves.
//
// Everything the dashboard shows is READ FROM DISK at generation time. Nothing
// is transcribed from the dispatch brief. Where the brief and the disk disagree,
// the disk wins and the disagreement is RENDERED, never reconciled.
//
// TWO HARD RULES, both enforced by construction:
//
//   1. READ-ONLY OUTSIDE tools/dashboard/. This generator opens files for
//      reading and writes exactly one file, next to itself. It never imports
//      from src/, never executes instrument code, and never requires the repo
//      to compile. Instrument self-descriptions are lifted as TEXT by a small
//      brace-aware scanner, so a module that does not compile still renders —
//      as itself, with its failure printed.
//
//   2. NO POSITIVE HEALTH ATTESTATION ANYWHERE, INCLUDING ABOUT THIS FILE.
//      There is no green, no checkmark, no "ok". The five states in §0 are the
//      whole vocabulary. Absence renders LOUD; silence never renders as health.
//
// Run:  npx ts-node tools/dashboard/generate-dashboard.ts
//
// Optional environment overrides (all default to siblings of the repo):
//   MICA_WORK_NOW   the MICA-4-gates work-now directory
//   MICA_ILAS_ROOT  the ILAS checkout root
//   MICA_OUT_DIR    where to write the HTML (default: this directory)
//   MICA_REGISTER   "dashboard" (default) | "outsider" (stubbed, later pass)
//                   | "operator" (wire-v01 W3; see operator-register.ts)

import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

import { runOperatorRegister } from "./operator-register";

// ── §0 · THE REGISTER LAYER (build now, fill later) ───────────────────────────
//
// Every explanatory string the dashboard speaks in its OWN voice lives here,
// separated from layout, keyed by register. The `outsider` register is WIRED
// and STUBBED: no outsider content is written in this pass, by ruling.

type Register = "dashboard" | "outsider" | "operator";

const REGISTER: Register =
  process.env.MICA_REGISTER === "outsider"
    ? "outsider"
    : process.env.MICA_REGISTER === "operator"
    ? "operator"
    : "dashboard";

// THE OPERATOR REGISTER IS A SIBLING MODULE, DISPATCHED BEFORE ANYTHING ELSE
// RUNS (wire-v01 W3). It reads two or three declared books, not src/, so none of
// the repository scan below is its business, and the two registers above keep
// producing exactly the bytes they produced before it existed. It is the only
// register whose page carries a script (one, inline, no network, for the sound);
// that ruling lives in operator-register.ts. The two hard rules above bind it
// unchanged: it imports nothing from src/ and writes exactly one file.
if (REGISTER === "operator") {
  const written = runOperatorRegister(
    process.env,
    process.env.MICA_OUT_DIR ?? __dirname
  );
  process.exit(written === null ? 1 : 0);
}

const OUTSIDER_STUB = "[outsider register: later pass]";

interface RegisterStrings {
  readonly pageTitle: string;
  readonly subtitle: string;
  readonly lawHeading: string;
  readonly lawBody: string;
  readonly certifiedMeaning: string;
  readonly releaseLegend: string;
  readonly flowHeading: string;
  readonly flowNote: string;
  readonly inventoryHeading: string;
  readonly inventoryNote: string;
  readonly holesHeading: string;
  readonly holesNote: string;
  readonly seamHeading: string;
  readonly seamNote: string;
  readonly ceilingHeading: string;
  readonly ceilingSentence: string;
  readonly joinGapHeading: string;
  readonly readsHeading: string;
}

const DASHBOARD_STRINGS: RegisterStrings = {
  pageTitle: "MICA machinery — dashboard register",
  subtitle:
    "A read of the repository at generation time, produced by " +
    "tools/dashboard/generate-dashboard.ts. It attests nothing.",
  lawHeading: "The one design law",
  lawBody:
    "No positive health attestation, anywhere, including about this dashboard. " +
    "The status vocabulary below is negative-attestation-native and has exactly " +
    "five states. None of them says a thing is good, safe, healthy, or working. " +
    "Holes render LOUD. Silence and absence never render as green.",
  certifiedMeaning:
    "CERTIFIED-AT-BYTES IS A STATEMENT ABOUT TESTS PASSING, NEVER ABOUT SAFETY. " +
    "It means: the named suite transcript, at the named SHA-256, on the named " +
    "date, carried a per-file block for this instrument reporting zero failures — " +
    "and this generator re-summed that transcript itself rather than trusting a " +
    "summary of it.",
  releaseLegend:
    "RELEASE is an absence of detected un-health over read scopes, not a safety " +
    "claim.",
  flowHeading: "A · The flow — the machinery acting",
  flowNote:
    "Every box below is lifted from source text at generation time. The " +
    "composition rule and the §6 delivery invariant are quoted from the files " +
    "that implement them, never restated.",
  inventoryHeading: "B · The inventory — the 34 named, and what is on disk",
  inventoryNote:
    "Two columns that do not join automatically, shown as two columns. The disk " +
    "carries the 34 as SWEEP ROWS and carries the built machine as SOURCE FILES, " +
    "and almost nothing on disk connects the two. See the 34-list finding.",
  holesHeading: "C · The holes",
  holesNote:
    "First-class, loud, and rendered from the same reads as everything else. A " +
    "hole that could not be read at all renders as CANNOT_ASSESS with its reason " +
    "printed — never as an omitted section.",
  seamHeading: "D · The seam — MICA × ILAS × the human seats",
  seamNote:
    "MICA judges. ILAS witnesses. The doctor reads from outside. The seats sit " +
    "OUTSIDE the machine boundary because the machine cannot read them.",
  ceilingHeading: "E · This dashboard's own ceiling",
  ceilingSentence:
    "This dashboard is a read of the repository at generation time. It attests " +
    "nothing. It goes stale the moment anything moves. Regenerate; do not trust.",
  joinGapHeading: "THE 34-LIST FINDING",
  readsHeading: "Files read at generation time",
};

const OUTSIDER_STRINGS: RegisterStrings = (() => {
  const out: Record<string, string> = {};
  for (const k of Object.keys(DASHBOARD_STRINGS)) out[k] = OUTSIDER_STUB;
  return out as unknown as RegisterStrings;
})();

const S: RegisterStrings =
  REGISTER === "outsider" ? OUTSIDER_STRINGS : DASHBOARD_STRINGS;

// ── §1 · THE READ LAYER — every read fails VISIBLY ────────────────────────────

const REPO = path.resolve(__dirname, "..", "..");
const PROJECTS = path.resolve(REPO, "..");
const WORK_NOW =
  process.env.MICA_WORK_NOW ?? path.join(PROJECTS, "MICA-4-gates", "work-now");
const ILAS_ROOT = process.env.MICA_ILAS_ROOT ?? path.join(PROJECTS, "ILAS");
const OUT_DIR = process.env.MICA_OUT_DIR ?? __dirname;

interface SourceOk {
  readonly ok: true;
  readonly label: string;
  readonly abs: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly text: string;
}
interface SourceFail {
  readonly ok: false;
  readonly label: string;
  readonly abs: string;
  readonly reason: string;
}
type Source = SourceOk | SourceFail;

const READ_LOG: Source[] = [];

function readSource(label: string, abs: string, hash = true): Source {
  try {
    const buf = fs.readFileSync(abs);
    const src: SourceOk = {
      ok: true,
      label,
      abs,
      bytes: buf.length,
      sha256: hash
        ? createHash("sha256").update(buf).digest("hex")
        : "(not hashed)",
      text: buf.toString("utf8"),
    };
    READ_LOG.push(src);
    return src;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    const src: SourceFail = {
      ok: false,
      label,
      abs,
      reason:
        e.message !== undefined && e.message.length > 0
          ? e.message
          : (e.code ?? "READ_FAILED") + " (no message)",
    };
    READ_LOG.push(src);
    return src;
  }
}

function walkTs(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist") continue;
        stack.push(p);
      } else if (e.isFile() && e.name.endsWith(".ts")) {
        out.push(p);
      }
    }
  }
  return out.sort();
}

function rel(abs: string): string {
  return path.relative(PROJECTS, abs).split(path.sep).join("/");
}

// ── §2 · TEXT EXTRACTION — regex and a brace scanner, never execution ─────────

/** Walk forward from `start` to the top-level `;`, respecting strings/comments. */
function sliceExpression(text: string, start: number): string {
  let i = start;
  let depth = 0;
  let quote: string | null = null;
  while (i < text.length) {
    const c = text[i];
    if (quote !== null) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? text.length : nl;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth++;
      i++;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      depth--;
      i++;
      continue;
    }
    if (c === ";" && depth === 0) return text.slice(start, i);
    i++;
  }
  return text.slice(start);
}

/** Split an expression on top-level occurrences of a single-char separator. */
function splitTopLevel(expr: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (quote !== null) {
      cur += c;
      if (c === "\\") {
        cur += expr[i + 1] ?? "";
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "/" && expr[i + 1] === "/") {
      const nl = expr.indexOf("\n", i);
      i = nl < 0 ? expr.length : nl;
      continue;
    }
    if (c === "/" && expr[i + 1] === "*") {
      const end = expr.indexOf("*/", i);
      i = end < 0 ? expr.length : end + 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    if (c === ")" || c === "]" || c === "}") depth--;
    if (c === sep && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim().length > 0) out.push(cur);
  return out;
}

/** All outermost `[ ... ]` groups inside an expression, in source order. */
function arrayGroups(expr: string): string[] {
  const out: string[] = [];
  let start = -1;
  let bd = 0;
  let quote: string | null = null;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (quote !== null) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "[") {
      if (start < 0) {
        start = i;
        bd = 1;
      } else bd++;
      continue;
    }
    if (c === "]" && start >= 0) {
      bd--;
      if (bd === 0) {
        out.push(expr.slice(start + 1, i));
        start = -1;
      }
    }
  }
  return out;
}

function decodeLiteral(lit: string): string {
  const body = lit.slice(1, -1);
  return body
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_m, h: string) =>
      String.fromCodePoint(parseInt(h, 16))
    )
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, h: string) =>
      String.fromCharCode(parseInt(h, 16))
    )
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "")
    .replace(/\\(["'`\\])/g, "$1");
}

interface ConstEntry {
  readonly name: string;
  readonly file: string;
  readonly expr: string;
}

const CONSTS = new Map<string, ConstEntry>();
const CONSTS_BY_FILE = new Map<string, ConstEntry[]>();

function scanConsts(fileAbs: string, text: string): void {
  // Module-private consts are scanned too: an instrument that composes its
  // printed limits out of file-local strings is still printing them, and the
  // dashboard must be able to quote what it prints, not only what it exports.
  const re = /^(?:export )?const ([A-Za-z0-9_$]+)\s*(?::[^=]*?)?=/gm;
  let m: RegExpExecArray | null;
  const bucket: ConstEntry[] = [];
  while ((m = re.exec(text)) !== null) {
    const entry: ConstEntry = {
      name: m[1],
      file: fileAbs,
      expr: sliceExpression(text, m.index + m[0].length),
    };
    if (!CONSTS.has(entry.name)) CONSTS.set(entry.name, entry);
    bucket.push(entry);
  }
  CONSTS_BY_FILE.set(fileAbs, bucket);
}

function unresolved(name: string): string {
  return "«UNRESOLVED SOURCE REFERENCE: " + name + "»";
}

function resolveStringExpr(expr: string, depth = 0): string | null {
  if (depth > 6) return unresolved("recursion limit");
  const pieces: string[] = [];
  for (const raw of splitTopLevel(expr, "+")) {
    const p = raw.trim();
    if (p.length === 0) continue;
    if (/^"(?:[^"\\]|\\[\s\S])*"$/.test(p) || /^'(?:[^'\\]|\\[\s\S])*'$/.test(p)) {
      pieces.push(decodeLiteral(p));
      continue;
    }
    if (/^[A-Za-z0-9_$]+$/.test(p)) {
      const ref = CONSTS.get(p);
      if (ref === undefined) {
        pieces.push(unresolved(p));
        continue;
      }
      pieces.push(resolveStringExpr(ref.expr, depth + 1) ?? unresolved(p));
      continue;
    }
    return null;
  }
  return pieces.length > 0 ? pieces.join("") : null;
}

function resolveArrayBody(body: string, depth: number): string[] {
  const out: string[] = [];
  for (const raw of splitTopLevel(body, ",")) {
    const el = raw.trim();
    if (el.length === 0) continue;
    if (el.startsWith("...")) {
      const refName = el.slice(3).trim();
      const ref = CONSTS.get(refName);
      if (ref === undefined) {
        out.push(unresolved(refName));
        continue;
      }
      const sub = resolveStringArray(ref.expr, depth + 1);
      if (sub === null) out.push(unresolved(refName));
      else out.push(...sub);
      continue;
    }
    const resolved = resolveStringExpr(el, depth + 1);
    if (resolved !== null) {
      out.push(resolved);
      continue;
    }
    // A call expression here is a line the instrument composes AT READ TIME
    // from the configuration it was handed. It has no static text, and saying
    // so is more honest than printing the expression as though it were one.
    out.push(
      /^[A-Za-z0-9_$.]+\s*\(/.test(el)
        ? "«COMPOSED AT READ TIME FROM THE INJECTED CONFIGURATION: " +
          el.replace(/\s+/g, " ").slice(0, 90) +
          "»"
        : unresolved(el.replace(/\s+/g, " ").slice(0, 90))
    );
  }
  return out;
}

function resolveStringArray(expr: string, depth = 0): string[] | null {
  if (depth > 6) return null;
  const groups = arrayGroups(expr.trim());
  if (groups.length === 0) return null;
  return resolveArrayBody(groups[0], depth);
}

/** Resolve an entry to lines, whether it is a string or a string[]. */
function entryLines(e: ConstEntry): string[] | null {
  const asArray = resolveStringArray(e.expr);
  if (asArray !== null && asArray.length > 0) return asArray;
  const asString = resolveStringExpr(e.expr);
  return asString === null ? null : [asString];
}

function constLines(name: string): string[] | null {
  const e = CONSTS.get(name);
  return e === undefined ? null : entryLines(e);
}

/** Pull unions of string literals, e.g. blind reason codes. */
function extractStringUnions(
  text: string,
  namePattern: RegExp
): { name: string; members: string[] }[] {
  const out: { name: string; members: string[] }[] = [];
  const re = /^export type ([A-Za-z0-9_$]+)\s*=([\s\S]*?);/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!namePattern.test(m[1])) continue;
    const members = (m[2].match(/"(?:[^"\\]|\\.)*"/g) ?? []).map(decodeLiteral);
    if (members.length > 0) out.push({ name: m[1], members });
  }
  return out;
}

/**
 * The argument list of the first call to `fnName(` in a file, split at top
 * level. Instruments that pass their title and READS as INLINE LITERALS to
 * formatScopeBlock print a self-description that is nowhere exported; this is
 * how the dashboard reaches it without executing anything.
 */
function callArgs(text: string, fnName: string): string[] | null {
  const key = fnName + "(";
  const at = text.indexOf(key);
  if (at < 0) return null;
  let i = at + key.length - 1;
  const start = i + 1;
  let depth = 0;
  let quote: string | null = null;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth++;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return splitTopLevel(text.slice(start, i), ",");
    }
  }
  return null;
}

/** Lift a function body verbatim, for the composition rule and its comment. */
function extractFunctionText(
  text: string,
  fnName: string,
  commentLines = 24
): string | null {
  const idx = text.indexOf("export function " + fnName);
  if (idx < 0) return null;
  // walk back over the preceding block comment, if any
  let start = idx;
  const before = text.slice(0, idx);
  const cEnd = before.lastIndexOf("*/");
  if (cEnd >= 0 && before.slice(cEnd + 2).trim().length === 0) {
    const cStart = before.lastIndexOf("/**", cEnd);
    if (cStart >= 0) start = cStart;
  }
  // walk forward to the closing brace of the body
  let i = text.indexOf("{", idx);
  if (i < 0) return null;
  let depth = 0;
  for (; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        const out = text.slice(start, i + 1);
        const lines = out.split("\n");
        return lines.length > commentLines + 40
          ? lines.slice(0, commentLines + 40).join("\n") + "\n  …"
          : out;
      }
    }
  }
  return null;
}

// ── §3 · TRUTH SOURCE 1 — src/**: the instruments describe themselves ─────────

const SRC_ROOT = path.join(REPO, "src");
const FILE_TEXT = new Map<string, string>();
const SRC_FILES = walkTs(SRC_ROOT);
const SRC_READ_FAILURES: { abs: string; reason: string }[] = [];

for (const f of SRC_FILES) {
  try {
    const text = fs.readFileSync(f, "utf8");
    FILE_TEXT.set(f, text);
    scanConsts(f, text);
  } catch (err) {
    SRC_READ_FAILURES.push({ abs: f, reason: (err as Error).message });
  }
}

interface Block {
  readonly label: string;
  readonly file: string;
  readonly lines: string[];
}

interface Instrument {
  readonly key: string;
  readonly id: string;
  readonly idConst: string;
  readonly prefix: string;
  readonly fileAbs: string;
  readonly fileRel: string;
  readonly layer: string;
  readonly countsInThe34: boolean;
  title: string | null;
  reads: Block | null;
  ceilings: Block[];
  competence: Block[];
  notes: Block[];
  blindUnions: { name: string; members: string[] }[];
  shapeNote: string | null;
  testFileRel: string | null;
  suiteSlot: number | null;
  suiteTotal: number | null;
  suiteFailed: number | null;
  states: string[];
  stateReasons: string[];
}

const ID_SUFFIXES = ["_SENSOR_ID", "_OVERLAY_ID", "_INSTRUMENT_ID"];

/** Path-derived, and labelled as path-derived wherever it is printed. */
function layerFromPath(fileAbs: string): { layer: string; in34: boolean } {
  const r = rel(fileAbs);
  if (r.includes("/doctor/overlays/"))
    return { layer: "Substrate — doctor overlays", in34: true };
  if (r.includes("/doctor/latency"))
    return {
      layer:
        "Doctor latency bound (B3/E6) — RULED OUT of the 34, park-audit §5.2",
      in34: false,
    };
  if (r.includes("/gate1-scope/")) return { layer: "Gate 1 — Scope", in34: true };
  if (r.includes("/gate2-direction/"))
    return { layer: "Gate 2 — Motivation / Direction", in34: true };
  if (r.includes("/gate4-sunset/")) return { layer: "Gate 4 — Sunset", in34: true };
  if (r.includes("/gate5-adaptive/"))
    return { layer: "Gate 5 — Adaptive", in34: true };
  if (/\/op[0-9]-/.test(r)) return { layer: "Operator layer", in34: true };
  if (r.includes("/chokepoint/"))
    return {
      layer: "The chokepoint — its own line, NOT one of the 34 (board §2e)",
      in34: false,
    };
  if (r.includes("/clerk/")) return { layer: "Clerk layer", in34: true };
  return { layer: "Substrate — six factors", in34: true };
}

function fileConsts(fileAbs: string): ConstEntry[] {
  return CONSTS_BY_FILE.get(fileAbs) ?? [];
}

const CEILING_NAME = /(CEILING|DOES_NOT_SEE|SCOPE_LINES|CAVEAT|DEFEAT|CORRESPONDENCE_ONLY|_BAR$|IS_NOT_HEALTH$|IS_NOT_SAFE$|FAILS_CLOSED$|_PRECONDITION$)/;
const NOTE_NAME = /(_NOTE$|_PROVENANCE$|_CALIBRATION$|POLARITY|_STATEMENT$|SHAPE_STATEMENT)/;
const SKIP_NAME = /(_FENCE_END$|_ID$|_STEPS$|_SAMPLE$|_FLOOR$|_MARGIN$|_FRACTION$|_BUDGET$)/;

function buildInstrument(idEntry: ConstEntry, suffix: string): Instrument | null {
  const idValue = resolveStringExpr(idEntry.expr);
  if (idValue === null) return null;
  const prefix = idEntry.name.slice(0, idEntry.name.length - suffix.length);
  const { layer, in34 } = layerFromPath(idEntry.file);
  const own = fileConsts(idEntry.file);

  const inst: Instrument = {
    key: path
      .relative(SRC_ROOT, idEntry.file)
      .split(path.sep)
      .join("/")
      .replace(/\/index\.ts$|\.ts$/, ""),
    id: idValue,
    idConst: idEntry.name,
    prefix,
    fileAbs: idEntry.file,
    fileRel: rel(idEntry.file),
    layer,
    countsInThe34: in34,
    title: null,
    reads: null,
    ceilings: [],
    competence: [],
    notes: [],
    blindUnions: [],
    shapeNote: null,
    testFileRel: null,
    suiteSlot: null,
    suiteTotal: null,
    suiteFailed: null,
    states: [],
    stateReasons: [],
  };

  // Title
  for (const n of [prefix + "_TITLE", prefix + "_SCOPE_TITLE"]) {
    const v = constLines(n);
    if (v !== null) {
      inst.title = v.join(" ");
      break;
    }
  }

  // The overlay form: NAME_SCOPE = formatOverlayScope(id, [reads], [does not see])
  const overlayScope = CONSTS.get(prefix + "_SCOPE");
  if (overlayScope !== undefined) {
    const groups = arrayGroups(overlayScope.expr);
    if (groups.length >= 1) {
      inst.reads = {
        label: prefix + "_SCOPE (reads)",
        file: rel(overlayScope.file),
        lines: resolveArrayBody(groups[0], 0),
      };
    }
    if (groups.length >= 2) {
      inst.ceilings.push({
        label: prefix + "_SCOPE (does not see / does not do)",
        file: rel(overlayScope.file),
        lines: resolveArrayBody(groups[1], 0),
      });
    }
  }

  // The sensor form
  if (inst.reads === null) {
    for (const n of [prefix + "_READS", prefix + "_SCOPE_READS"]) {
      const e = CONSTS.get(n);
      if (e === undefined) continue;
      const v = entryLines(e);
      if (v === null) continue;
      inst.reads = { label: n, file: rel(e.file), lines: v };
      break;
    }
  }

  // Ceilings and notes: every self-description const declared in the module's
  // OWN file, plus prefix-matched competence lines from the shared file.
  for (const e of own) {
    if (e.name === prefix + "_SCOPE") continue;
    if (SKIP_NAME.test(e.name)) continue;
    if (inst.reads !== null && e.name === inst.reads.label) continue;
    const isCeiling = CEILING_NAME.test(e.name);
    const isNote = NOTE_NAME.test(e.name);
    if (!isCeiling && !isNote) continue;
    const v = entryLines(e);
    if (v === null || v.length === 0) continue;
    const block: Block = { label: e.name, file: rel(e.file), lines: v };
    if (isCeiling) inst.ceilings.push(block);
    else inst.notes.push(block);
  }

  for (const n of [prefix + "_COMPETENCE_LINES"]) {
    const e = CONSTS.get(n);
    if (e === undefined) continue;
    const v = entryLines(e);
    if (v !== null) inst.competence.push({ label: n, file: rel(e.file), lines: v });
  }

  const text = FILE_TEXT.get(idEntry.file) ?? "";

  // FALLBACK 1 — the inline shape. Some instruments (the operator layer) pass
  // their title and READS to formatScopeBlock as literals rather than exporting
  // them. That is still the text the instrument prints about itself.
  if (inst.title === null || inst.reads === null || inst.competence.length === 0) {
    const args =
      callArgs(text, "formatScopeBlock") ?? callArgs(text, "printScopeBlock");
    if (args !== null && args.length >= 2) {
      inst.shapeNote =
        "SELF-DESCRIPTION SHAPE: INLINE. This module does not export " +
        prefix +
        "_TITLE / " +
        prefix +
        "_READS; it passes them as literals to formatScopeBlock(). The " +
        "dashboard reads the call site.";
      if (inst.title === null) {
        const t = resolveStringExpr(args[0]);
        if (t !== null) inst.title = t;
      }
      if (inst.reads === null) {
        const r = resolveStringArray(args[1]);
        if (r !== null && r.length > 0)
          inst.reads = {
            label: "formatScopeBlock(…) argument 2 — READS, inline at the call site",
            file: rel(idEntry.file),
            lines: r,
          };
      }
      if (inst.ceilings.length === 0 && args.length >= 3) {
        const c = resolveStringArray(args[2]);
        if (c !== null && c.length > 0)
          inst.ceilings.push({
            label: "formatScopeBlock(…) argument 3 — ceilings as printed",
            file: rel(idEntry.file),
            lines: c,
          });
      }
      if (inst.competence.length === 0 && args.length >= 4) {
        const c = resolveStringArray(args[3]);
        if (c !== null && c.length > 0)
          inst.competence.push({
            label: "formatScopeBlock(…) argument 4 — reader competence as printed",
            file: rel(idEntry.file),
            lines: c,
          });
      }
      if (args.length >= 5) {
        const c = resolveStringArray(args[4]);
        if (c !== null && c.length > 0)
          inst.notes.push({
            label: "formatScopeBlock(…) argument 5 — run-conditional lines",
            file: rel(idEntry.file),
            lines: c,
          });
      }
    }
  }

  // FALLBACK 2 — the overlay shape.
  if (overlayScope !== undefined && inst.title === null) {
    inst.shapeNote =
      "SELF-DESCRIPTION SHAPE: OVERLAY. This module carries no *_TITLE " +
      "constant; it names itself through formatOverlayScope(" +
      prefix +
      "_OVERLAY_ID, …) and is REPORT-ONLY — never composed into the floor.";
  }

  // FALLBACK 3 — the file-header shape. The clerk's gap detector describes
  // itself in a leading comment block and in no exported constant at all.
  if (inst.title === null && inst.reads === null) {
    const header = leadingComment(idEntry.file, 30);
    if (header !== null) {
      inst.shapeNote =
        "SELF-DESCRIPTION SHAPE: FILE-HEADER COMMENT ONLY. This instrument " +
        "carries none of the exported self-description constants the MICA " +
        "sensors carry. What it says about itself, it says in a comment — " +
        "unreachable to any consumer at runtime. That is a finding, not a note.";
      inst.notes.push({
        label: "file header comment (the only self-description found)",
        file: rel(idEntry.file),
        lines: header.split("\n"),
      });
    }
  }

  inst.blindUnions = extractStringUnions(text, /(Blind|BLIND)/);

  return inst;
}

const INSTRUMENTS: Instrument[] = [];
for (const [, e] of CONSTS) {
  const suffix = ID_SUFFIXES.find((s) => e.name.endsWith(s));
  if (suffix === undefined) continue;
  const built = buildInstrument(e, suffix);
  if (built !== null) INSTRUMENTS.push(built);
}
INSTRUMENTS.sort((a, b) => (a.id < b.id ? -1 : 1));

// The chokepoint is not an instrument and does not carry a *_SENSOR_ID; it is
// rendered separately in the flow. It is named here so its absence from the
// inventory is a decision on the page, not an oversight.
const CHOKEPOINT_ID_VALUE = resolveStringExpr(
  CONSTS.get("CHOKEPOINT_ID")?.expr ?? ""
);
const DOCTOR_LATENCY_ID_VALUE = resolveStringExpr(
  CONSTS.get("DOCTOR_LATENCY_ID")?.expr ?? ""
);

// ── §4 · TRUTH SOURCE 2 — package.json: the suite's own ordered file list ─────

const PKG = readSource("MICA-machine/package.json", path.join(REPO, "package.json"));
let TEST_MICA_FILES: string[] = [];
let TEST_MICA_RAW: string | null = null;
if (PKG.ok) {
  const m = PKG.text.match(/"test:mica"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m !== null) {
    TEST_MICA_RAW = m[1];
    TEST_MICA_FILES = TEST_MICA_RAW.split("&&")
      .map((s) => s.trim())
      .filter((s) => s.startsWith("ts-node "))
      .map((s) => s.replace(/^ts-node\s+/, "").trim());
  }
}

// ── §5 · TRUTH SOURCE 3 — ARC_MICA-BOARD.md: the topmost last-pass block ──────

const BOARD = readSource(
  "MICA-4-gates/work-now/ARC_MICA-BOARD.md",
  path.join(WORK_NOW, "ARC_MICA-BOARD.md")
);

interface BoardAnchor {
  readonly available: boolean;
  readonly reason: string;
  readonly raw: string;
  readonly date: string | null;
  readonly passName: string | null;
  readonly tally: string | null;
  readonly suiteName: string | null;
  readonly suiteSha: string | null;
  readonly suiteBytes: number | null;
  readonly suitePerFile: number | null;
  readonly suiteSummed: string | null;
  readonly watch: string | null;
  readonly owed: string[];
}

function parseBoard(src: Source): BoardAnchor {
  const none = (reason: string): BoardAnchor => ({
    available: false,
    reason,
    raw: "",
    date: null,
    passName: null,
    tally: null,
    suiteName: null,
    suiteSha: null,
    suiteBytes: null,
    suitePerFile: null,
    suiteSummed: null,
    watch: null,
    owed: [],
  });
  if (!src.ok) return none(src.reason);
  const fmMatch = src.text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch === null) return none("NO YAML FRONTMATTER FOUND IN THE BOARD");
  const fm = fmMatch[1];
  const first = fm.indexOf("last-pass:");
  if (first < 0) return none("NO `last-pass:` BLOCK FOUND IN THE BOARD FRONTMATTER");
  const second = fm.indexOf("last-pass:", first + 1);
  let raw = second < 0 ? fm.slice(first) : fm.slice(first, second);
  raw = raw.replace(/\r?\n\s*Prior:\s*$/, "").trim();

  const flat = raw.replace(/\r?\n\s*/g, " ");
  const passName =
    flat.match(/\*\*([A-Z-]+(?:-[A-Z]+)?\s+PASS)\b/)?.[1] ??
    flat.match(/\b([A-Z][A-Z-]+\s+PASS)\b/)?.[1] ??
    null;
  const tally = flat.match(/\b(\d{2}\/\d{1,2}\/\d{1,2})\b/)?.[1] ?? null;
  const suiteName =
    flat.match(/`?([A-Za-z0-9_\\/-]*mica-suite-[A-Za-z0-9.-]+\.txt)`?/)?.[1] ?? null;
  const suiteSha = flat.match(/\b([0-9A-Fa-f]{64})\b/)?.[1] ?? null;
  const suiteBytesRaw = flat.match(/([\d,]+)\s*bytes/)?.[1] ?? null;
  // The board states these in PROSE, and the prose has changed wording between
  // passes: the 33rd pass wrote "31 per-file lines house-awk-summed to 816/816",
  // the 34th wrote "32 blocks, 888/888, 0 failed". A single pattern silently
  // stopped parsing when the wording moved. Both shapes are matched here, and a
  // shape not matched leaves the value null — which the comparison below now
  // renders as NOT COMPARED, never as agreement.
  const suitePerFileRaw =
    flat.match(/(\d+)\s+per-file (?:lines|blocks)/)?.[1] ??
    flat.match(/\*\*(\d+)\s+blocks\b/)?.[1] ??
    flat.match(/\b(\d+)\s+blocks,\s*[\d,]+\/[\d,]+/)?.[1] ??
    null;
  const suiteSummed =
    flat.match(/summed to\s+\*{0,2}([\d,]+\/[\d,]+[^*.,;]*)/)?.[1] ??
    flat.match(/\b\d+\s+blocks,\s*(\d+(?:,\d{3})*\/\d+(?:,\d{3})*(?:,\s*\d+\s+failed)?)/)?.[1] ??
    null;
  const date = flat.match(/last-pass:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  const watchAll = fm.replace(/\r?\n\s*/g, " ").match(/WATCH:?\s*\*{0,2}([^*.]+)/);

  const owed: string[] = [];
  const owedRe = /`\[owed\]`([^`]{0,220})/g;
  let om: RegExpExecArray | null;
  while ((om = owedRe.exec(flat)) !== null) {
    owed.push(("[owed]" + om[1]).replace(/\s+/g, " ").trim());
  }
  if (/Remaining `\[owed\]`/.test(flat)) {
    const r = flat.match(/Remaining `\[owed\]`([^*]{0,240})/);
    if (r !== null) owed.unshift(("Remaining [owed]" + r[1]).replace(/\s+/g, " ").trim());
  }
  // Drop entries that are contained in a longer entry: the same owed item is
  // often matched twice, once by its marker and once by its heading.
  const byKey = new Map<string, string>();
  for (const o of owed) {
    const key = o
      .replace(/^Remaining\s*/i, "")
      .replace(/[^A-Za-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const prior = byKey.get(key);
    if (prior === undefined || o.length > prior.length) byKey.set(key, o);
  }
  const deduped = Array.from(byKey.values());

  return {
    available: true,
    reason: "",
    raw,
    date,
    passName,
    tally,
    suiteName: suiteName === null ? null : suiteName.split(/[\\/]/).pop() ?? suiteName,
    suiteSha,
    suiteBytes: suiteBytesRaw === null ? null : Number(suiteBytesRaw.replace(/,/g, "")),
    suitePerFile: suitePerFileRaw === null ? null : Number(suitePerFileRaw),
    suiteSummed,
    watch: watchAll === null ? null : watchAll[1].trim(),
    owed: deduped,
  };
}

const BOARD_ANCHOR = parseBoard(BOARD);

// ── §6 · TRUTH SOURCE 4 — the suite transcript the board names ────────────────

/** Which summary shape a per-file block ended with. See parseSuite. */
type SuiteDialect = "house" | "bare";

interface SuiteBlock {
  readonly slot: number;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly dialect: SuiteDialect;
  readonly heading: string;
  readonly file: string | null;
}

interface SuiteRead {
  readonly available: boolean;
  readonly reason: string;
  readonly name: string | null;
  readonly abs: string | null;
  readonly bytes: number | null;
  readonly sha256: string | null;
  readonly crlfPairs: number;
  readonly loneLf: number;
  readonly loneCr: number;
  readonly blocks: SuiteBlock[];
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
}

function parseSuite(name: string | null): SuiteRead {
  const none = (reason: string): SuiteRead => ({
    available: false,
    reason,
    name,
    abs: null,
    bytes: null,
    sha256: null,
    crlfPairs: 0,
    loneLf: 0,
    loneCr: 0,
    blocks: [],
    total: 0,
    passed: 0,
    failed: 0,
  });
  if (name === null)
    return none("THE BOARD NAMED NO SUITE OF RECORD THIS GENERATOR COULD PARSE");
  const abs = path.join(REPO, name);
  const src = readSource("MICA-machine/" + name + " (suite of record)", abs);
  if (!src.ok) return none(src.reason);

  const crlf = (src.text.match(/\r\n/g) ?? []).length;
  const lf = (src.text.match(/\n/g) ?? []).length;
  const cr = (src.text.match(/\r/g) ?? []).length;

  const lines = src.text.split(/\r?\n/);
  const blocks: SuiteBlock[] = [];
  let total = 0;
  let passed = 0;
  let failed = 0;
  for (let i = 0; i < lines.length; i++) {
    // TWO DIALECTS EXIST ON DISK. Thirty-one test files end their run with
    // "<n> tests: <p> passed, <f> failed"; src/clerk/clerk.test.ts ends with
    // "<p> passed, <f> failed" and no total. Both are counted; the split is
    // reported on the page rather than normalised away, because a suite whose
    // members do not report in one shape is a finding about the suite.
    const house = lines[i].match(/^(\d+) tests: (\d+) passed, (\d+) failed$/);
    const bare = house === null ? lines[i].match(/^(\d+) passed, (\d+) failed$/) : null;
    if (house === null && bare === null) continue;
    const dialect: SuiteDialect = house !== null ? "house" : "bare";
    const nPassed = Number(house !== null ? house[2] : (bare as RegExpMatchArray)[1]);
    const nFailed = Number(house !== null ? house[3] : (bare as RegExpMatchArray)[2]);
    const nTotal = house !== null ? Number(house[1]) : nPassed + nFailed;
    let heading = "";
    for (let j = i - 1; j >= 0 && j > i - 600; j--) {
      const L = lines[j].trim();
      if (L.length === 0) continue;
      if (/^[✓✗⚠·]/.test(L)) continue;
      if (/^[─═┌└│]/.test(L) || /^[A-Za-z]/.test(L)) {
        heading = L.replace(/[─═]+/g, "").trim();
        break;
      }
    }
    const slot = blocks.length;
    blocks.push({
      slot,
      total: nTotal,
      passed: nPassed,
      failed: nFailed,
      dialect,
      heading,
      file: TEST_MICA_FILES[slot] ?? null,
    });
    total += nTotal;
    passed += nPassed;
    failed += nFailed;
  }

  return {
    available: true,
    reason: "",
    name,
    abs,
    bytes: src.bytes,
    sha256: src.sha256,
    crlfPairs: crlf,
    loneLf: lf - crlf,
    loneCr: cr - crlf,
    blocks,
    total,
    passed,
    failed,
  };
}

const SUITE = parseSuite(BOARD_ANCHOR.suiteName);

// ── §6a · IS THE BOARD'S SUITE OF RECORD THE NEWEST ONE ON DISK? ─────────────
//
// The dashboard reads the transcript the BOARD names — that anchoring is the
// point, and this generator will not quietly prefer a newer file. But a newer
// transcript sitting in the repo, unnamed by the board, is a fact about the
// disk, and a page that showed only the board's choice without saying so would
// be silent about something it can see. So it is read, and it renders as a hole.

interface TranscriptOnDisk {
  readonly name: string;
  readonly bytes: number;
  readonly mtimeMs: number;
  readonly isBoardNamed: boolean;
}

function listTranscripts(): TranscriptOnDisk[] {
  let names: string[];
  try {
    names = fs.readdirSync(REPO).filter((n) => /^mica-suite-.*\.txt$/.test(n));
  } catch {
    return [];
  }
  const out: TranscriptOnDisk[] = [];
  for (const n of names) {
    try {
      const st = fs.statSync(path.join(REPO, n));
      out.push({
        name: n,
        bytes: st.size,
        mtimeMs: st.mtimeMs,
        isBoardNamed: n === BOARD_ANCHOR.suiteName,
      });
    } catch {
      /* a transcript that cannot be stat'd is not a transcript this run saw */
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

const TRANSCRIPTS = listTranscripts();
const BOARD_NAMED = TRANSCRIPTS.find((t) => t.isBoardNamed) ?? null;
const NEWER_THAN_BOARD =
  BOARD_NAMED === null
    ? []
    : TRANSCRIPTS.filter((t) => t.mtimeMs > BOARD_NAMED.mtimeMs);

// Attach the suite slot to each instrument by its own test file, positionally.
function testFileFor(inst: Instrument): string | null {
  const dir = path.dirname(inst.fileAbs);
  const base = path.basename(dir);
  const candidates = [
    path.join(dir, base + ".test.ts"),
    path.join(path.dirname(dir), base + ".test.ts"),
    path.join(dir, path.basename(inst.fileAbs, ".ts") + ".test.ts"),
  ];
  for (const c of candidates) {
    if (FILE_TEXT.has(c)) return path.relative(REPO, c).split(path.sep).join("/");
  }
  return null;
}

for (const inst of INSTRUMENTS) {
  inst.testFileRel = testFileFor(inst);
  if (inst.testFileRel !== null) {
    const slot = TEST_MICA_FILES.indexOf(inst.testFileRel);
    if (slot >= 0) {
      inst.suiteSlot = slot;
      const b = SUITE.blocks[slot];
      if (b !== undefined) {
        inst.suiteTotal = b.total;
        inst.suiteFailed = b.failed;
      }
    }
  }
}

// ── §7 · TRUTH SOURCE 5 — the sweep inventory: the 57 rows, by name ───────────

const SWEEP = readSource(
  "MICA-4-gates/work-now/BUILD/ARC_MICA-INVENTORY_Full-Function-Sweep_20260806.md",
  path.join(WORK_NOW, "BUILD", "ARC_MICA-INVENTORY_Full-Function-Sweep_20260806.md")
);

interface SweepRow {
  readonly id: string;
  readonly section: string;
  readonly fn: string;
  readonly instrument: string;
  readonly reads: string;
  readonly note: string;
}

function stripMd(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/~~/g, "")
    .trim();
}

function parseSweep(src: Source): { rows: SweepRow[]; reason: string } {
  if (!src.ok) return { rows: [], reason: src.reason };
  const rows: SweepRow[] = [];
  let section = "(before any heading)";
  for (const raw of src.text.split(/\r?\n/)) {
    const h = raw.match(/^##\s+(.*)$/);
    if (h !== null) {
      section = stripMd(h[1]);
      continue;
    }
    if (!raw.startsWith("|")) continue;
    const cells = raw.split("|").map((c) => c.trim());
    if (cells.length < 6) continue;
    const id = stripMd(cells[1]);
    if (!/^[A-H]\d{1,2}$/.test(id)) continue;
    rows.push({
      id,
      section,
      fn: stripMd(cells[2]),
      instrument: stripMd(cells[3]),
      reads: stripMd(cells[4]),
      note: stripMd(cells[5]),
    });
  }
  return { rows, reason: rows.length === 0 ? "NO SWEEP ROWS PARSED" : "" };
}

const SWEEP_PARSE = parseSweep(SWEEP);

// ── §8 · TRUTH SOURCE 6 — the park audit §5.1: which rows the 34 retains ──────

const PARK_AUDIT = readSource(
  "MICA-4-gates/work-now/ARC_MICA-AUDIT_Park-Inventory_20260821-74.md",
  path.join(WORK_NOW, "ARC_MICA-AUDIT_Park-Inventory_20260821-74.md")
);

interface RetainedLayer {
  readonly layer: string;
  readonly rowIds: string[];
  readonly declaredCount: number | null;
  readonly cellText: string;
}

function parseRetained(src: Source): { layers: RetainedLayer[]; reason: string } {
  if (!src.ok) return { layers: [], reason: src.reason };
  const idx = src.text.indexOf("| board layer | sweep rows retained | count |");
  if (idx < 0)
    return {
      layers: [],
      reason:
        "THE §5.1 RETAINED-ROWS TABLE HEADER WAS NOT FOUND — the 34 could not be " +
        "assembled from this file",
    };
  const layers: RetainedLayer[] = [];
  const lines = src.text.slice(idx).split(/\r?\n/);
  for (const raw of lines.slice(2)) {
    if (!raw.startsWith("|")) break;
    const cells = raw.split("|").map((c) => c.trim());
    if (cells.length < 4) continue;
    const layer = stripMd(cells[1]);
    // The table's own TOTAL row carries an empty layer cell. It is a sum, not a
    // layer, and counting it would double the denominator.
    if (layer.length === 0) continue;
    const cell = cells[2];
    const ids = cell.match(/\b[A-H]\d{1,2}\b/g) ?? [];
    // rows named inside parentheses are the EXCLUSIONS the cell states
    const excluded = new Set<string>();
    for (const paren of cell.match(/\(([^)]*)\)/g) ?? []) {
      for (const id of paren.match(/\b[A-H]\d{1,2}\b/g) ?? []) excluded.add(id);
    }
    const kept = ids.filter((id) => !excluded.has(id));
    const countRaw = stripMd(cells[3]).replace(/[^\d]/g, "");
    layers.push({
      layer,
      rowIds: kept,
      declaredCount: countRaw.length > 0 ? Number(countRaw) : null,
      cellText: stripMd(cell),
    });
  }
  return { layers, reason: layers.length === 0 ? "NO RETAINED ROWS PARSED" : "" };
}

const RETAINED = parseRetained(PARK_AUDIT);

// ── §9 · TRUTH SOURCE 7 — the deferrals ledger ───────────────────────────────

function findLedger(): { abs: string | null; name: string | null } {
  try {
    const names = fs
      .readdirSync(WORK_NOW)
      .filter((n) => /^ARC_MICA-LEDGER_Deferrals.*\.md$/.test(n))
      .sort();
    const pick = names[names.length - 1];
    return pick === undefined
      ? { abs: null, name: null }
      : { abs: path.join(WORK_NOW, pick), name: pick };
  } catch {
    return { abs: null, name: null };
  }
}

const LEDGER_FILE = findLedger();
const LEDGER =
  LEDGER_FILE.abs === null
    ? ({
        ok: false,
        label: "MICA-4-gates/work-now/ARC_MICA-LEDGER_Deferrals*.md",
        abs: WORK_NOW,
        reason: "NO ARC_MICA-LEDGER_Deferrals*.md FOUND IN work-now",
      } as Source)
    : readSource(
        "MICA-4-gates/work-now/" + LEDGER_FILE.name,
        LEDGER_FILE.abs
      );

if (!LEDGER.ok && LEDGER_FILE.abs === null) READ_LOG.push(LEDGER);

interface LedgerRow {
  readonly id: string;
  readonly subject: string;
  readonly status: string;
  readonly reason: string;
  readonly unblock: string;
  readonly closed: boolean;
}

function parseLedger(src: Source): { rows: LedgerRow[]; reason: string } {
  if (!src.ok) return { rows: [], reason: src.reason };
  const rows: LedgerRow[] = [];
  for (const raw of src.text.split(/\r?\n/)) {
    if (!raw.startsWith("|")) continue;
    const cells = raw.split("|").map((c) => c.trim());
    if (cells.length < 5) continue;
    const id = stripMd(cells[1]);
    if (!/^[A-Z]{1,3}-?\d{1,3}$/.test(id)) continue;
    const status = stripMd(cells[3]);
    rows.push({
      id,
      subject: stripMd(cells[2]),
      status,
      reason: stripMd(cells[4] ?? ""),
      unblock: stripMd(cells[5] ?? ""),
      closed: /BUILT|CLOSED/i.test(status) || /~~/.test(cells[2] ?? ""),
    });
  }
  return { rows, reason: rows.length === 0 ? "NO LEDGER ROWS PARSED" : "" };
}

const LEDGER_PARSE = parseLedger(LEDGER);

// ── §10 · TRUTH SOURCE 8 — ILAS, read from its own files ─────────────────────

interface IlasRead {
  readonly available: boolean;
  readonly reason: string;
  readonly root: string;
  readonly checkout: string | null;
  readonly modules: { name: string; files: string[] }[];
  readonly readmeSections: string[];
  readonly statedBounds: { heading: string; body: string }[];
  readonly loadStates: { state: string; meaning: string; clean: string }[];
}

function findIlasCheckout(): string | null {
  const direct = path.join(ILAS_ROOT, "src");
  if (fs.existsSync(direct)) return ILAS_ROOT;
  let entries: string[];
  try {
    entries = fs.readdirSync(ILAS_ROOT);
  } catch {
    return null;
  }
  for (const e of entries.sort()) {
    const p = path.join(ILAS_ROOT, e);
    try {
      if (fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, "src")))
        return p;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function readIlas(): IlasRead {
  const none = (reason: string): IlasRead => ({
    available: false,
    reason,
    root: ILAS_ROOT,
    checkout: null,
    modules: [],
    readmeSections: [],
    statedBounds: [],
    loadStates: [],
  });
  const checkout = findIlasCheckout();
  if (checkout === null)
    return none(
      "NO ILAS CHECKOUT WITH A src/ DIRECTORY FOUND UNDER " + ILAS_ROOT
    );

  const srcDir = path.join(checkout, "src");
  const modules: { name: string; files: string[] }[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(srcDir, { withFileTypes: true });
  } catch (err) {
    return none("ILAS src/ UNREADABLE: " + (err as Error).message);
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!e.isDirectory()) continue;
    let files: string[] = [];
    try {
      files = fs.readdirSync(path.join(srcDir, e.name)).sort();
    } catch {
      files = ["«DIRECTORY UNREADABLE»"];
    }
    modules.push({ name: e.name, files });
  }

  const readme = readSource(
    "ILAS/" + path.basename(checkout) + "/README.md",
    path.join(checkout, "README.md")
  );
  const readmeSections: string[] = [];
  const statedBounds: { heading: string; body: string }[] = [];
  const loadStates: { state: string; meaning: string; clean: string }[] = [];

  if (readme.ok) {
    const lines = readme.text.split(/\r?\n/);
    for (const L of lines) {
      const h = L.match(/^(#{2,3})\s+(.*)$/);
      if (h !== null) readmeSections.push(h[1].length === 2 ? h[2] : "  · " + h[2]);
    }
    const wanted = [
      "Threat model",
      "Named external dependencies (not solvable inside the process)",
      "L0 durability & S-4 anchor readiness",
      "What it is NOT",
    ];
    for (const w of wanted) {
      const idx = readme.text.indexOf("\n#" + "#".repeat(0) + "# " + w);
      const alt = readme.text.indexOf("## " + w);
      const alt2 = readme.text.indexOf("### " + w);
      const at = [idx, alt, alt2].filter((n) => n >= 0).sort((a, b) => a - b)[0];
      if (at === undefined) continue;
      const rest = readme.text.slice(at);
      const nextH = rest.slice(3).search(/\r?\n#{2,3}\s/);
      const body = (nextH < 0 ? rest : rest.slice(0, nextH + 3)).trim();
      statedBounds.push({ heading: w, body });
    }
    const tbl = readme.text.indexOf("| loadState | meaning | clean start? |");
    if (tbl >= 0) {
      for (const raw of readme.text.slice(tbl).split(/\r?\n/).slice(2)) {
        if (!raw.startsWith("|")) break;
        const c = raw.split("|").map((x) => x.trim());
        if (c.length < 4) continue;
        loadStates.push({
          state: stripMd(c[1]),
          meaning: stripMd(c[2]),
          clean: stripMd(c[3]),
        });
      }
    }
  } else {
    statedBounds.push({
      heading: "README",
      body: "CANNOT_ASSESS — " + readme.reason,
    });
  }

  return {
    available: true,
    reason: "",
    root: ILAS_ROOT,
    checkout,
    modules,
    readmeSections,
    statedBounds,
    loadStates,
  };
}

const ILAS = readIlas();

// ── §11 · TRUTH SOURCE 9 — vacuity sites, declared in MICA source ────────────

interface SiteHit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function findSites(): SiteHit[] {
  const hits: SiteHit[] = [];
  const re =
    /(VACUITY )?SITE (\d{1,2}|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE|THIRTEEN|FOURTEEN|FIFTEEN)\b/i;
  for (const [abs, text] of FILE_TEXT) {
    if (abs.endsWith(".test.ts")) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      hits.push({
        file: rel(abs),
        line: i + 1,
        text: lines[i].trim().slice(0, 400),
      });
    }
  }
  return hits.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1
  );
}

const SITE_HITS = findSites();

// ── §12 · TRUTH SOURCE 10 — the chokepoint's own composition and fences ──────

const CHOKEPOINT_TYPES_ABS = path.join(
  REPO,
  "src",
  "mica",
  "chokepoint",
  "types.ts"
);
const CHOKEPOINT_TYPES_TEXT = FILE_TEXT.get(CHOKEPOINT_TYPES_ABS) ?? "";
const COMPOSE_FLOOR_TEXT = extractFunctionText(
  CHOKEPOINT_TYPES_TEXT,
  "composeFloorKind"
);
const NARROW_DISPOSITION_TEXT = extractFunctionText(
  CHOKEPOINT_TYPES_TEXT,
  "narrowForDisposition"
);
const MAP_FLOOR_TEXT = extractFunctionText(
  CHOKEPOINT_TYPES_TEXT,
  "mapFloorToDisposition"
);
const DISPOSITION_UNION = extractStringUnions(
  CHOKEPOINT_TYPES_TEXT,
  /^ChokepointDisposition$/
);
const BLIND_PATH_UNION = extractStringUnions(
  FILE_TEXT.get(path.join(REPO, "src", "mica", "types.ts")) ?? "",
  /^BlindPathClass$/
);

// ── §13 · TRUTH SOURCE 11 — the only row↔module joins the disk carries ────────
//
// The board's §2a table names built modules. A FEW of its first cells also name
// a sweep row id or a ledger id. Those are the ONLY machine-readable joins
// between the 34-as-sweep-rows and the built machine on disk. Everything else
// is house-held knowledge that exists in nobody's file.

interface BoardJoin {
  readonly moduleName: string;
  readonly sweepRows: string[];
  readonly ledgerIds: string[];
  readonly cell: string;
}

function parseBoardJoins(src: Source): BoardJoin[] {
  if (!src.ok) return [];
  const out: BoardJoin[] = [];
  const idx = src.text.indexOf("### 2a · The built");
  if (idx < 0) return [];
  const after = src.text.slice(idx + 10);
  const nextHeading = after.search(/\r?\n###\s/);
  const region = nextHeading < 0 ? after : after.slice(0, nextHeading);
  for (const raw of region.split(/\r?\n/)) {
    if (!raw.startsWith("|")) continue;
    const cells = raw.split("|").map((c) => c.trim());
    if (cells.length < 4) continue;
    const cell = cells[1];
    if (/^-+$/.test(cell) || /^instrument$/i.test(stripMd(cell))) continue;
    const nameMatch = cell.match(/\*\*`?([A-Za-z0-9._-]+)`?\*\*/);
    if (nameMatch === null) continue;
    out.push({
      moduleName: nameMatch[1],
      sweepRows: Array.from(
        new Set(
          (cell.match(/(?:sweep\s+)?\b([A-H]\d{1,2})\b/g) ?? [])
            .map((s) => s.replace(/sweep\s+/i, "").trim())
            .filter((s) => /^[A-H]\d{1,2}$/.test(s))
        )
      ),
      ledgerIds: Array.from(new Set(cell.match(/\bD-\d{2}\b/g) ?? [])),
      cell: stripMd(cell),
    });
  }
  return out;
}

const BOARD_JOINS = parseBoardJoins(BOARD);

// ── §14 · THE FIVE STATES — assigned by printed rule, never by judgement ──────

const STATE_RULES: { state: string; rule: string }[] = [
  {
    state: "CERTIFIED-AT-BYTES",
    rule:
      "the module's own *.test.ts is listed in package.json test:mica, AND the " +
      "positionally-corresponding per-file block of the suite transcript the " +
      "board names reports 0 failed, AND this generator re-summed that " +
      "transcript itself. A statement about TESTS PASSING, never about safety.",
  },
  {
    state: "CEILING-LIMITED",
    rule:
      "the module's own file exports at least one ceiling / does-not-see / " +
      "scope-lines constant. Every built instrument is shown WITH its ceilings, " +
      "verbatim, one click away. There is no instrument without ceilings — a " +
      "module with none renders that absence as a hole.",
  },
  {
    state: "BLIND-CONFIGURABLE",
    rule:
      "the module declares a blind-reason union containing at least one code " +
      "that fires on an absent, vacuous or malformed INJECTED declaration " +
      "(config, basket, profile, roster, stakes line). The codes below are what " +
      "un-configures it.",
  },
  {
    state: "PARKED",
    rule:
      "named in the deferrals ledger with a status that is not BUILT/CLOSED. " +
      "The ledger id and the stated reason ride the node, verbatim.",
  },
  {
    state: "UNBUILT",
    rule:
      "a sweep row inside the 34 whose own reads-verdict is NO. The sweep " +
      "defines NO as “canon names the gap and states no instrument exists”. " +
      "The blocker is the sweep's own note, quoted.",
  },
];

const BLIND_CONFIG_CODE =
  /(CONFIG|MISSING_CONFIGURATION|VACUOUS|MALFORMED|ABSENT|PROFILE|ROSTER|BASKET|DECLARED|INELIGIBLE_SCOPE|OVERLAP)/;

for (const inst of INSTRUMENTS) {
  if (SUITE.available && inst.suiteSlot !== null && inst.suiteFailed === 0) {
    inst.states.push("CERTIFIED-AT-BYTES");
    inst.stateReasons.push(
      "suite slot " +
        (inst.suiteSlot + 1) +
        " of " +
        SUITE.blocks.length +
        " · " +
        String(inst.suiteTotal) +
        " tests, 0 failed · " +
        String(SUITE.name) +
        " · SHA-256 " +
        String(SUITE.sha256)
    );
  } else if (inst.suiteSlot === null) {
    inst.stateReasons.push(
      "NOT CERTIFIED-AT-BYTES: no test file of this module appears in " +
        "package.json test:mica" +
        (inst.testFileRel === null
          ? " (and no sibling *.test.ts was found on disk)"
          : " (found on disk as " + inst.testFileRel + ", but not registered)")
    );
  } else if (inst.suiteTotal === null) {
    inst.stateReasons.push(
      "NOT CERTIFIED-AT-BYTES: this module's test file IS registered in " +
        "package.json test:mica, at slot " +
        String(inst.suiteSlot + 1) +
        ", but the transcript the board names carries no block at that slot — " +
        "it has only " +
        String(SUITE.blocks.length) +
        ". The registration is newer than the suite of record. Until a board " +
        "pass names a transcript that covers this slot, this instrument is " +
        "IN the suite and OUTSIDE the certification."
    );
  } else {
    inst.stateReasons.push(
      "NOT CERTIFIED-AT-BYTES: the block at slot " +
        String(inst.suiteSlot + 1) +
        " of the named transcript reports " +
        String(inst.suiteFailed) +
        " failure(s)"
    );
  }

  if (inst.ceilings.length > 0) {
    inst.states.push("CEILING-LIMITED");
  } else {
    inst.stateReasons.push(
      "HOLE: NO CEILING CONSTANT FOUND IN THIS MODULE'S OWN FILE. Either the " +
        "module prints its limits somewhere this generator does not look, or it " +
        "prints none. Both are findings."
    );
  }

  const blindCodes = inst.blindUnions.flatMap((u) => u.members);
  if (blindCodes.some((c) => BLIND_CONFIG_CODE.test(c))) {
    inst.states.push("BLIND-CONFIGURABLE");
  }
}

// PARKED / UNBUILT live on the 34-rows, not on the built modules.

interface Row34 {
  readonly id: string;
  readonly layer: string;
  readonly sweep: SweepRow | null;
  readonly states: string[];
  readonly blocker: string;
  readonly joins: BoardJoin[];
}

const RETAINED_IDS: { id: string; layer: string }[] = [];
for (const L of RETAINED.layers) {
  for (const id of L.rowIds) RETAINED_IDS.push({ id, layer: L.layer });
}

const SWEEP_BY_ID = new Map(SWEEP_PARSE.rows.map((r) => [r.id, r]));

const ROWS34: Row34[] = RETAINED_IDS.map(({ id, layer }) => {
  const sweep = SWEEP_BY_ID.get(id) ?? null;
  const states: string[] = [];
  let blocker = "";
  if (sweep === null) {
    blocker =
      "CANNOT_ASSESS — the park audit retains this row id, and the sweep " +
      "document carries no row with that id that this generator could parse.";
    states.push("UNBUILT");
  } else if (/^NO\b/i.test(sweep.reads)) {
    // The sweep's own verdict vocabulary: NO = "canon names the gap and states
    // no instrument exists". That is the disk's word, not this generator's.
    states.push("UNBUILT");
    blocker = sweep.note;
  } else {
    blocker = sweep.note;
  }
  const joins = BOARD_JOINS.filter((j) => j.sweepRows.includes(id));
  return { id, layer, sweep, states, blocker, joins };
});

const PARKED_ROWS = LEDGER_PARSE.rows.filter((r) => !r.closed);
const CLOSED_ROWS = LEDGER_PARSE.rows.filter((r) => r.closed);

// ── §15 · RENDER ─────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pad(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

const NOW = new Date();
const STAMP =
  String(NOW.getFullYear()) +
  pad(NOW.getMonth() + 1) +
  pad(NOW.getDate()) +
  "-" +
  pad(NOW.getHours()) +
  pad(NOW.getMinutes());
const NOW_HUMAN =
  NOW.getFullYear() +
  "-" +
  pad(NOW.getMonth() + 1) +
  "-" +
  pad(NOW.getDate()) +
  " " +
  pad(NOW.getHours()) +
  ":" +
  pad(NOW.getMinutes()) +
  ":" +
  pad(NOW.getSeconds()) +
  " (local clock of the generating machine; mtime is authoritative)";

function stateBadge(s: string): string {
  const cls = "st-" + s.toLowerCase().replace(/[^a-z]+/g, "-");
  return '<span class="badge ' + cls + '">' + esc(s) + "</span>";
}

function hole(title: string, body: string): string {
  return (
    '<div class="hole"><div class="hole-t">' +
    esc(title) +
    '</div><div class="hole-b">' +
    esc(body) +
    "</div></div>"
  );
}

function pre(lines: string[]): string {
  return '<pre class="verbatim">' + esc(lines.join("\n")) + "</pre>";
}

function blockHtml(b: Block): string {
  return (
    '<div class="blk"><div class="blk-h"><code>' +
    esc(b.label) +
    '</code> <span class="src">' +
    esc(b.file) +
    "</span></div>" +
    pre(b.lines) +
    "</div>"
  );
}

function sourceRow(s: Source): string {
  if (s.ok) {
    return (
      "<tr><td>" +
      esc(s.label) +
      "</td><td>" +
      s.bytes.toLocaleString("en-US") +
      "</td><td><code>" +
      esc(s.sha256) +
      "</code></td></tr>"
    );
  }
  return (
    '<tr class="fail"><td>' +
    esc(s.label) +
    '</td><td colspan="2">COULD NOT READ — ' +
    esc(s.reason) +
    "</td></tr>"
  );
}

function instrumentCard(inst: Instrument): string {
  const parts: string[] = [];
  parts.push('<article class="node">');
  parts.push(
    '<header class="node-h"><h4><code>' +
      esc(inst.id) +
      "</code></h4><div class=\"badges\">" +
      inst.states.map(stateBadge).join(" ") +
      "</div></header>"
  );
  parts.push(
    '<div class="node-meta">' +
      esc(inst.layer) +
      ' <span class="sep">·</span> <span class="src">' +
      esc(inst.fileRel) +
      "</span>" +
      (inst.countsInThe34
        ? ""
        : ' <span class="sep">·</span> <b class="warn">NOT ONE OF THE 34</b>') +
      "</div>"
  );
  if (inst.title !== null)
    parts.push('<div class="node-title">' + esc(inst.title) + "</div>");
  else
    parts.push(
      hole(
        "NO TITLE FOUND — THIS INSTRUMENT DOES NOT NAME ITSELF",
        "Neither " +
          inst.prefix +
          "_TITLE, nor " +
          inst.prefix +
          "_SCOPE_TITLE, nor a formatScopeBlock() call site names this module. " +
          "A consumer holding the verdict has nothing to read but the id" +
          (inst.notes.some((n) => n.label.startsWith("file header"))
            ? " — what this module says about itself, it says in a source " +
              "comment no consumer can reach at runtime."
            : ".")
      )
    );
  if (inst.shapeNote !== null)
    parts.push('<div class="shape">' + esc(inst.shapeNote) + "</div>");

  parts.push(
    '<div class="tests">' +
      (inst.suiteSlot === null || inst.suiteTotal === null
        ? '<b class="warn">NO CERTIFYING BLOCK</b> — ' +
          esc(inst.stateReasons[0] ?? "")
        : "suite slot " +
          String(inst.suiteSlot + 1) +
          " · <b>" +
          String(inst.suiteTotal) +
          " tests</b>, " +
          String(inst.suiteFailed) +
          " failed · <span class=\"src\">" +
          esc(inst.testFileRel ?? "") +
          "</span>") +
      "</div>"
  );

  if (inst.reads !== null) {
    parts.push(
      "<details><summary>READS — what it actually looks at</summary>" +
        blockHtml(inst.reads) +
        "</details>"
    );
  } else {
    parts.push(
      hole(
        "NO READS STATEMENT FOUND — THE SCOPE IS NOT PRINTED",
        "This module carries no machine-readable statement of what it looks at: " +
          "no " +
          inst.prefix +
          "_READS, no " +
          inst.prefix +
          "_SCOPE_READS, and no formatScopeBlock() call site. A consumer cannot " +
          "learn this instrument's read scope from the instrument."
      )
    );
  }

  if (inst.ceilings.length > 0) {
    const total = inst.ceilings.reduce((n, b) => n + b.lines.length, 0);
    parts.push(
      "<details><summary>CEILINGS — the instrument's own printed limits (" +
        String(total) +
        (total === 1 ? " line" : " lines") +
        ", verbatim)</summary>" +
        inst.ceilings.map(blockHtml).join("") +
        "</details>"
    );
  } else {
    parts.push(
      hole(
        "NO CEILINGS FOUND IN SOURCE",
        "There is no instrument without ceilings. This one prints none that " +
          "this generator can find, and that absence is the reading."
      )
    );
  }

  if (inst.blindUnions.length > 0) {
    parts.push(
      "<details><summary>BLIND REASON CODES — what un-configures it</summary>" +
        inst.blindUnions
          .map(
            (u) =>
              '<div class="blk"><div class="blk-h"><code>' +
              esc(u.name) +
              "</code></div>" +
              pre(u.members.map((m) => "· " + m)) +
              "</div>"
          )
          .join("") +
        "</details>"
    );
  }

  if (inst.competence.length > 0) {
    parts.push(
      "<details><summary>READER COMPETENCE — what it presumes of whoever reads it</summary>" +
        inst.competence.map(blockHtml).join("") +
        "</details>"
    );
  }
  if (inst.notes.length > 0) {
    parts.push(
      "<details><summary>CALIBRATION / PROVENANCE NOTES</summary>" +
        inst.notes.map(blockHtml).join("") +
        "</details>"
    );
  }
  parts.push("</article>");
  return parts.join("\n");
}

function row34Card(r: Row34): string {
  const joinLine =
    r.joins.length > 0
      ? '<div class="join">JOINED ON DISK to <b>' +
        r.joins.map((j) => esc(j.moduleName)).join(", ") +
        "</b> — the board's §2a cell names this sweep row.</div>"
      : '<div class="nojoin">NO ON-DISK JOIN. Nothing in any file read here ' +
        "connects this row to a built module. Any such mapping is house-held.</div>";
  return (
    '<article class="row34">' +
    '<header><code class="rid">' +
    esc(r.id) +
    "</code> " +
    r.states.map(stateBadge).join(" ") +
    "</header>" +
    '<div class="fn">' +
    esc(r.sweep === null ? "«ROW NOT FOUND IN THE SWEEP»" : r.sweep.fn) +
    "</div>" +
    '<div class="inst">instrument (sweep): ' +
    esc(r.sweep === null ? "—" : r.sweep.instrument) +
    ' <span class="sep">·</span> reads: <b>' +
    esc(r.sweep === null ? "—" : r.sweep.reads) +
    "</b></div>" +
    joinLine +
    (r.blocker.length > 0
      ? "<details><summary>the sweep's own note (the stated blocker)</summary>" +
        pre([r.blocker]) +
        "</details>"
      : "") +
    "</article>"
  );
}

/** Render a named exported constant verbatim, or a loud hole if it is gone. */
function constBlock(name: string, why: string): string {
  const e = CONSTS.get(name);
  if (e === undefined)
    return hole(
      "CONSTANT NOT FOUND ON DISK: " + name,
      why +
        " This dashboard expected to quote it from source and could not find " +
        "it. Either it was renamed or removed; either way the page below is " +
        "reading something that is no longer there."
    );
  const lines = entryLines(e);
  if (lines === null)
    return hole(
      "CONSTANT FOUND BUT NOT RESOLVABLE AS TEXT: " + name,
      "The expression is not a string or an array of strings this generator " +
        "can resolve without executing it, and this generator does not execute " +
        "instrument code."
    );
  return blockHtml({ label: name, file: rel(e.file), lines });
}

function fnBlock(label: string, file: string, text: string | null): string {
  if (text === null)
    return hole(
      "FUNCTION NOT FOUND: " + label,
      "The composition rule this dashboard quotes lives in " +
        file +
        " and was not found there."
    );
  return (
    '<div class="blk"><div class="blk-h"><code>' +
    esc(label) +
    '</code> <span class="src">' +
    esc(file) +
    "</span></div>" +
    '<pre class="verbatim code">' +
    esc(text) +
    "</pre></div>"
  );
}

function leadingComment(abs: string, maxLines: number): string | null {
  const text = FILE_TEXT.get(abs);
  if (text === undefined) return null;
  const out: string[] = [];
  for (const L of text.split(/\r?\n/)) {
    if (!L.startsWith("//")) break;
    out.push(L);
    if (out.length >= maxLines) break;
  }
  return out.length > 0 ? out.join("\n") : null;
}

// ── §16 · THE PAGE ───────────────────────────────────────────────────────────

const CSS = `
:root{
  --bg:#0b0d10; --panel:#12161b; --panel2:#171c23; --ink:#e8eef5; --dim:#95a3b3;
  --rule:#26303b; --loud:#ff8b3d; --loudbg:#2a1608; --alarm:#ff5b5b;
  --cert:#7fd1ff; --ceil:#d7b3ff; --blind:#ffd166; --park:#9fb0c2; --unbuilt:#ff8b3d;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:28px 20px 80px}
h1{font-size:26px;margin:0 0 6px;letter-spacing:.2px}
h2{font-size:19px;margin:38px 0 6px;padding-bottom:6px;border-bottom:1px solid var(--rule)}
h3{font-size:15px;margin:24px 0 8px;color:var(--dim);text-transform:uppercase;letter-spacing:.09em}
h4{font-size:14px;margin:0}
p{margin:8px 0}
code{font-family:var(--mono);font-size:12.5px}
a{color:var(--cert)}
.sub{color:var(--dim);max-width:82ch}
.anchor{display:flex;flex-wrap:wrap;gap:10px 26px;margin:14px 0 0;padding:12px 14px;
  background:var(--panel);border:1px solid var(--rule);border-radius:6px}
.anchor div{font-size:13px}
.anchor b{display:block;color:var(--dim);font-weight:600;font-size:11px;
  text-transform:uppercase;letter-spacing:.08em}
.law{margin:22px 0;padding:16px 18px;border:2px solid var(--loud);border-radius:6px;
  background:var(--loudbg)}
.law h2{border:0;margin:0 0 6px;font-size:17px;color:var(--loud)}
.legend{display:grid;gap:10px;margin:14px 0}
.legend .l{display:grid;grid-template-columns:190px 1fr;gap:14px;align-items:start;
  padding:10px 12px;background:var(--panel);border:1px solid var(--rule);border-radius:6px}
.badge{display:inline-block;padding:2px 8px;border-radius:3px;font:600 11px/1.5 var(--mono);
  letter-spacing:.06em;white-space:nowrap;border:1px solid}
.st-certified-at-bytes{color:var(--cert);border-color:var(--cert);background:#0d1c26}
.st-ceiling-limited{color:var(--ceil);border-color:var(--ceil);background:#1a1226}
.st-blind-configurable{color:var(--blind);border-color:var(--blind);background:#241d08}
.st-parked{color:var(--park);border-color:var(--park);background:#161b21}
.st-unbuilt{color:#000;border-color:var(--unbuilt);background:var(--unbuilt)}
.hole{margin:10px 0;padding:11px 13px;border-left:5px solid var(--loud);
  background:var(--loudbg);border-radius:0 5px 5px 0}
.hole-t{font:700 12px/1.5 var(--mono);letter-spacing:.05em;color:var(--loud)}
.hole-b{font-size:13px;color:#ffd9bd;margin-top:4px}
.warn{color:var(--loud)}
.grid{display:grid;gap:12px}
@media(min-width:860px){.grid.two{grid-template-columns:1fr 1fr}}
.node,.row34,.card{background:var(--panel);border:1px solid var(--rule);border-radius:7px;
  padding:13px 15px;margin:12px 0}
.node-h{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
.badges{display:flex;gap:6px;flex-wrap:wrap}
.node-meta,.node-title,.tests,.fn,.inst{font-size:13px;margin-top:6px}
.node-title{color:var(--ink)}
.node-meta,.src{color:var(--dim)}
.shape{margin-top:7px;font-size:12px;color:var(--blind);border-left:3px solid var(--blind);
  padding-left:9px}
.src{font-family:var(--mono);font-size:11.5px}
.sep{color:var(--rule)}
.tests{color:var(--dim);font-family:var(--mono);font-size:12px}
details{margin-top:9px;border-top:1px solid var(--rule);padding-top:8px}
summary{cursor:pointer;font:600 12px/1.6 var(--mono);letter-spacing:.04em;color:var(--dim)}
summary:hover{color:var(--ink)}
.blk{margin:9px 0}
.blk-h{font-size:11.5px;color:var(--dim);margin-bottom:4px}
pre.verbatim{margin:0;padding:11px 13px;background:#080a0d;border:1px solid var(--rule);
  border-radius:5px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;
  font-family:var(--mono);font-size:12px;line-height:1.6;color:#cfe0ef}
pre.verbatim.code{white-space:pre;word-break:normal}
table{width:100%;border-collapse:collapse;font-size:12.5px;margin:10px 0;display:block;
  overflow-x:auto}
th,td{text-align:left;padding:6px 9px;border-bottom:1px solid var(--rule);vertical-align:top}
th{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.08em}
tr.fail td{color:var(--loud);background:var(--loudbg)}
.rid{font-weight:700;color:var(--ink);font-size:13px}
.join{margin-top:6px;font-size:12.5px;color:var(--cert)}
.nojoin{margin-top:6px;font-size:12.5px;color:var(--loud);font-weight:600}
.flow{display:grid;gap:0}
.step{background:var(--panel);border:1px solid var(--rule);border-radius:7px;padding:13px 15px}
.arrow{justify-self:center;color:var(--dim);font-family:var(--mono);font-size:18px;
  line-height:1;padding:6px 0}
.step h4{font:700 13px/1.5 var(--mono);letter-spacing:.05em;color:var(--ink)}
.step .k{font-size:12.5px;color:var(--dim);margin-top:2px}
footer{margin-top:46px;padding-top:18px;border-top:2px solid var(--loud)}
.ceilingline{font:700 14px/1.6 ui-sans-serif,system-ui,sans-serif;color:var(--loud);
  margin:12px 0;padding:14px;border:2px solid var(--loud);border-radius:6px;
  background:var(--loudbg)}
.small{font-size:12px;color:var(--dim)}
ul{margin:6px 0 6px 20px;padding:0}
li{margin:3px 0;font-size:13px}
`;

function renderFlow(): string {
  const chokeIdxAbs = path.join(REPO, "src", "mica", "chokepoint", "index.ts");
  const sensors = INSTRUMENTS.filter((i) => i.idConst.endsWith("_SENSOR_ID"));
  const overlays = INSTRUMENTS.filter((i) => i.idConst.endsWith("_OVERLAY_ID"));
  const clerkGap = INSTRUMENTS.filter((i) => i.idConst.endsWith("_INSTRUMENT_ID"));
  const arrow = '<div class="arrow">▼</div>';
  const out: string[] = ['<div class="flow">'];

  out.push(
    '<div class="step"><h4>1 · PROPOSED ACTION</h4><div class="k">' +
      "A caller routes an action through the chokepoint. Whether the deployment " +
      "routes EVERY consequential action through it is the routing precondition " +
      "below — stamped, never verified.</div></div>"
  );
  out.push(arrow);

  out.push(
    '<div class="step"><h4>2 · SENSOR VERDICTS</h4><div class="k">' +
      String(sensors.length) +
      " modules exporting a <code>*_SENSOR_ID</code> were found on disk: " +
      sensors.map((s) => "<code>" + esc(s.id) + "</code>").join(", ") +
      ". " +
      String(clerkGap.length) +
      " exporting <code>*_INSTRUMENT_ID</code>: " +
      (clerkGap.length > 0
        ? clerkGap.map((s) => "<code>" + esc(s.id) + "</code>").join(", ")
        : "«none»") +
      ". Verdict kinds are frozen at three.</div>" +
      constBlock(
        "VERDICT_KINDS",
        "The frozen three-kind verdict grammar the floor composes over."
      ) +
      "<details><summary>THE OVERLAYS ARE QUARANTINED — report-only, never in the floor (" +
      String(overlays.length) +
      " found)</summary>" +
      constBlock(
        "OVERLAY_REPORT_ONLY_BAR",
        "The bar every doctor overlay carries."
      ) +
      constBlock(
        "OVERLAY_ORDINAL_HEURISTIC_CAVEAT",
        "The ordinal-not-interval downgrade every overlay carries."
      ) +
      "</details>" +
      "</div>"
  );
  out.push(arrow);

  out.push(
    '<div class="step"><h4>3 · THE NON-COMPENSATORY FLOOR — min()</h4><div class="k">' +
      "ALARM &lt; CANNOT_ASSESS &lt; SILENT. No number of SILENT verdicts raises " +
      "the floor above its worst member. Quoted from source, comment included:</div>" +
      fnBlock(
        "composeFloorKind",
        "MICA-machine/src/mica/chokepoint/types.ts",
        COMPOSE_FLOOR_TEXT
      ) +
      (BLIND_PATH_UNION.length > 0
        ? "<details><summary>the blind-path classes the floor composes over</summary>" +
          pre(BLIND_PATH_UNION[0].members.map((m) => "· " + m)) +
          "</details>"
        : hole(
            "BlindPathClass UNION NOT FOUND",
            "src/mica/types.ts no longer carries the union this dashboard quotes."
          )) +
      "</div>"
  );
  out.push(arrow);

  out.push(
    '<div class="step"><h4>4 · CHOKEPOINT DISPOSITION</h4><div class="k">' +
      (DISPOSITION_UNION.length > 0
        ? "Frozen at " +
          String(DISPOSITION_UNION[0].members.length) +
          ": " +
          DISPOSITION_UNION[0].members
            .map((m) => "<code>" + esc(m) + "</code>")
            .join(" · ")
        : "«ChokepointDisposition union not found on disk»") +
      ". The stakes line governs the CANNOT_ASSESS split ONLY.</div>" +
      fnBlock(
        "mapFloorToDisposition",
        "MICA-machine/src/mica/chokepoint/types.ts",
        MAP_FLOOR_TEXT
      ) +
      constBlock(
        "RELEASE_IS_NOT_SAFE",
        "The single most dangerous misreading, stated in the code's own words."
      ) +
      "<details><summary>WHAT A DISPOSITION ATTESTS, AND WHAT IT REFUSES TO</summary>" +
      constBlock("DISPOSITION_ATTESTS", "The in-scope claims.") +
      constBlock("DISPOSITION_DOES_NOT_ATTEST", "The refused claims.") +
      "</details>" +
      "</div>"
  );
  out.push(arrow);

  out.push(
    '<div class="step"><h4>5 · THE FLOOR TRAIL — every decision, or no permit</h4>' +
      '<div class="k">The corrective cut, quoted from the chokepoint\'s own header ' +
      "comment:</div>" +
      fnBlock(
        "chokepoint/index.ts — file header",
        "MICA-machine/src/mica/chokepoint/index.ts",
        leadingComment(chokeIdxAbs, 20)
      ) +
      constBlock(
        "CHOKEPOINT_SCOPE_LINES",
        "The lines the chokepoint prints about what it does NOT claim."
      ) +
      "</div>"
  );
  out.push(arrow);

  out.push(
    '<div class="step"><h4>6 · PASS-BLIND LEDGER · §6 DELIVERY NARROWING (fails closed)</h4>' +
      '<div class="k">Degradation runs TOWARD the alarm, never away from it. The ' +
      "narrowing has no inverse.</div>" +
      constBlock(
        "DELIVERY_FAILS_CLOSED",
        "The §6 invariant in the code's own words."
      ) +
      fnBlock(
        "narrowForDisposition",
        "MICA-machine/src/mica/chokepoint/types.ts",
        NARROW_DISPOSITION_TEXT
      ) +
      "</div>"
  );
  out.push("</div>");
  return out.join("\n");
}

function renderInventory(): string {
  const out: string[] = [];
  const declaredTotal = RETAINED.layers.reduce(
    (n, l) => n + (l.declaredCount ?? 0),
    0
  );
  const parsedTotal = RETAINED_IDS.length;

  out.push('<div class="card">');
  out.push("<h3>" + esc(S.joinGapHeading) + "</h3>");
  if (!PARK_AUDIT.ok || RETAINED.layers.length === 0) {
    out.push(
      hole(
        "THE 34 COULD NOT BE ASSEMBLED",
        RETAINED.reason.length > 0 ? RETAINED.reason : "park audit unreadable"
      )
    );
  } else {
    out.push(
      "<p><b>There is no single machine-readable list of the 34 anywhere on " +
        "disk.</b> The denominator is assembled here, at generation time, from " +
        "TWO documents that must be read against each other:</p>"
    );
    out.push(
      "<ul><li><code>ARC_MICA-INVENTORY_Full-Function-Sweep_20260806.md</code> — " +
        String(SWEEP_PARSE.rows.length) +
        " sweep rows, each with its own name, instrument and reads-verdict.</li>" +
        "<li><code>ARC_MICA-AUDIT_Park-Inventory_20260821-74.md</code> §5.1 — the " +
        "per-layer table of WHICH sweep rows the 34 retains. This table, written " +
        "for the first time on 2026-08-21, is the closest thing to an " +
        "authoritative list that exists.</li></ul>"
    );
    out.push(
      "<p>Assembled here: <b>" +
        String(parsedTotal) +
        "</b> row ids across " +
        String(RETAINED.layers.length) +
        " layers; the §5.1 table's own declared counts sum to <b>" +
        String(declaredTotal) +
        "</b>." +
        (parsedTotal === declaredTotal
          ? " The two agree."
          : " <b class=\"warn\">THEY DISAGREE BY " +
            String(declaredTotal - parsedTotal) +
            " — rendered, not reconciled.</b>") +
        "</p>"
    );
    const idless = RETAINED.layers.filter(
      (l) => l.rowIds.length === 0 && (l.declaredCount ?? 0) > 0
    );
    if (idless.length > 0) {
      out.push(
        hole(
          "MEMBERS OF THE 34 THAT HAVE NO ROW ID AT ALL",
          idless
            .map(
              (l) =>
                l.layer +
                " — declared " +
                String(l.declaredCount) +
                ", named by the §5.1 cell as “" +
                l.cellText +
                "” and by no row id."
            )
            .join("  ·  ") +
            "  These members are inside the denominator and outside the sweep, " +
            "so nothing in the sweep document describes them. They cannot be " +
            "rendered as rows below; they exist here only as this hole."
        )
      );
    }
    out.push(
      hole(
        "THE JOIN IS THE GAP",
        "Nothing on disk maps a sweep row to a built module. This generator " +
          "searched src/** for sweep row ids and found none, and searched the " +
          "board's §2a table, which carries a sweep-row id in only " +
          String(BOARD_JOINS.filter((j) => j.sweepRows.length > 0).length) +
          " of its " +
          String(BOARD_JOINS.length) +
          " module cells. The correspondence between 'the 34 named' and 'the " +
          "modules on disk' is house-held knowledge that exists in no file. " +
          "Everything below is therefore shown as TWO inventories, not one."
      )
    );
    out.push("<table><thead><tr><th>layer</th><th>sweep rows retained (§5.1)</th>" +
      "<th>declared</th><th>parsed</th></tr></thead><tbody>");
    for (const L of RETAINED.layers) {
      const mismatch =
        L.declaredCount !== null && L.declaredCount !== L.rowIds.length;
      out.push(
        (mismatch ? '<tr class="fail">' : "<tr>") +
          "<td>" +
          esc(L.layer) +
          "</td><td><code>" +
          esc(L.rowIds.join(" ")) +
          "</code><div class=\"small\">source cell, verbatim: " +
          esc(L.cellText) +
          "</div></td><td>" +
          String(L.declaredCount ?? "—") +
          "</td><td>" +
          String(L.rowIds.length) +
          "</td></tr>"
      );
    }
    out.push("</tbody></table>");
  }
  out.push("</div>");

  // Column 1 — the 34 as named on disk
  out.push("<h3>Column 1 — the 34, as the disk names them (sweep rows)</h3>");
  if (ROWS34.length === 0) {
    out.push(hole("NO ROWS", "the 34 could not be assembled — see above"));
  } else {
    let lastLayer = "";
    for (const r of ROWS34) {
      if (r.layer !== lastLayer) {
        out.push("<h4 style=\"margin-top:18px;color:#95a3b3\">" + esc(r.layer) + "</h4>");
        lastLayer = r.layer;
      }
      out.push(row34Card(r));
    }
  }

  // Column 2 — what is actually on disk
  out.push(
    "<h3>Column 2 — the machine on disk (" +
      String(INSTRUMENTS.length) +
      " modules exporting a self-description id)</h3>"
  );
  const byLayer = new Map<string, Instrument[]>();
  for (const i of INSTRUMENTS) {
    const arr = byLayer.get(i.layer) ?? [];
    arr.push(i);
    byLayer.set(i.layer, arr);
  }
  for (const [layer, insts] of Array.from(byLayer).sort()) {
    out.push("<h4 style=\"margin-top:18px;color:#95a3b3\">" + esc(layer) + "</h4>");
    for (const i of insts) out.push(instrumentCard(i));
  }
  return out.join("\n");
}

function renderSuitePanel(): string {
  const out: string[] = ['<div class="card">'];
  out.push("<h3>The suite of record, re-summed here</h3>");

  if (NEWER_THAN_BOARD.length > 0) {
    out.push(
      hole(
        "THE BOARD'S SUITE OF RECORD IS NOT THE NEWEST TRANSCRIPT ON DISK",
        "The board names " +
          String(BOARD_ANCHOR.suiteName) +
          ". " +
          String(NEWER_THAN_BOARD.length) +
          " newer transcript(s) sit in the repository, unnamed by any board " +
          "pass this generator read: " +
          NEWER_THAN_BOARD.map(
            (t) => t.name + " (" + t.bytes.toLocaleString("en-US") + " bytes)"
          ).join(", ") +
          ". This page reads the transcript the BOARD names and will not " +
          "quietly prefer a newer file — the anchoring is the point. Every " +
          "CERTIFIED-AT-BYTES badge below is therefore against the OLDER " +
          "transcript, and any instrument whose coverage changed since is " +
          "shown as it stood then. Until a board pass names the newer file, " +
          "this page is behind the disk and says so here."
      )
    );
  }

  if (!SUITE.available) {
    out.push(
      hole(
        "THE SUITE OF RECORD COULD NOT BE READ",
        SUITE.reason +
          " — every CERTIFIED-AT-BYTES badge on this page is therefore absent, " +
          "not withheld. No test count below is trustworthy."
      )
    );
    out.push("</div>");
    return out.join("\n");
  }

  const boardSum = BOARD_ANCHOR.suiteSummed;
  const mine = String(SUITE.passed) + "/" + String(SUITE.total);
  // THREE STATES, NOT TWO. A board value this generator could not parse is not
  // a match — it is a comparison that DID NOT HAPPEN. The prior form was
  // `X === null || X === mine`, which rendered an unparsed board value as
  // "agree": concordance asserted between a number and nothing. That is the
  // silent fail-open this page exists to refuse, found in the page itself.
  // Absence is CANNOT_ASSESS. It is never assent.
  type CmpState = "agree" | "disagree" | "not-compared";
  const cmpState = (boardValue: unknown, matches: boolean): CmpState =>
    boardValue === null || boardValue === undefined
      ? "not-compared"
      : matches
        ? "agree"
        : "disagree";

  const stateName = cmpState(
    BOARD_ANCHOR.suiteName,
    BOARD_ANCHOR.suiteName === SUITE.name
  );
  const stateBytes = cmpState(
    BOARD_ANCHOR.suiteBytes,
    BOARD_ANCHOR.suiteBytes === SUITE.bytes
  );
  const stateSha = cmpState(
    BOARD_ANCHOR.suiteSha,
    (BOARD_ANCHOR.suiteSha ?? "").toLowerCase() ===
      (SUITE.sha256 ?? "").toLowerCase()
  );
  const stateBlocks = cmpState(
    BOARD_ANCHOR.suitePerFile,
    BOARD_ANCHOR.suitePerFile === SUITE.blocks.length
  );
  const stateSum = cmpState(
    boardSum,
    (boardSum ?? "").replace(/[^\d/]/g, "").startsWith(mine)
  );
  // The board states line endings in prose only, never in a shape this
  // generator parses into a comparable value. There is nothing to compare
  // against, and the row says so rather than passing a literal `true`.
  const stateEol: CmpState = "not-compared";

  out.push(
    "<table><thead><tr><th>quantity</th><th>the board says</th>" +
      "<th>this generator re-read</th><th></th></tr></thead><tbody>"
  );
  const cmp = (
    label: string,
    board: string,
    mineV: string,
    state: CmpState
  ): string =>
    (state === "disagree" ? '<tr class="fail">' : "<tr>") +
    "<td>" +
    esc(label) +
    "</td><td><code>" +
    esc(board) +
    "</code></td><td><code>" +
    esc(mineV) +
    "</code></td><td>" +
    (state === "agree"
      ? "agree"
      : state === "disagree"
        ? "<b>DISAGREE</b>"
        : "<b>NOT COMPARED</b> — the board does not state this in a shape this " +
          "generator parsed; nothing was checked here") +
    "</td></tr>";
  out.push(
    cmp(
      "transcript",
      BOARD_ANCHOR.suiteName ?? "—",
      SUITE.name ?? "—",
      stateName
    )
  );
  out.push(
    cmp(
      "bytes",
      BOARD_ANCHOR.suiteBytes === null
        ? "—"
        : BOARD_ANCHOR.suiteBytes.toLocaleString("en-US"),
      (SUITE.bytes ?? 0).toLocaleString("en-US"),
      stateBytes
    )
  );
  out.push(
    cmp(
      "SHA-256",
      BOARD_ANCHOR.suiteSha ?? "—",
      SUITE.sha256 ?? "—",
      stateSha
    )
  );
  out.push(
    cmp(
      "per-file blocks",
      BOARD_ANCHOR.suitePerFile === null ? "—" : String(BOARD_ANCHOR.suitePerFile),
      String(SUITE.blocks.length),
      stateBlocks
    )
  );
  out.push(cmp("summed", boardSum ?? "—", mine + ", " + String(SUITE.failed) + " failed", stateSum));
  out.push(
    cmp(
      "line endings",
      "(board states CRLF in prose only — no parsed value)",
      String(SUITE.crlfPairs) +
        " CRLF pairs, " +
        String(SUITE.loneLf) +
        " lone LF, " +
        String(SUITE.loneCr) +
        " lone CR",
      stateEol
    )
  );
  out.push("</tbody></table>");

  const cmpRows: ReadonlyArray<readonly [string, CmpState]> = [
    ["transcript", stateName],
    ["bytes", stateBytes],
    ["SHA-256", stateSha],
    ["per-file blocks", stateBlocks],
    ["summed", stateSum],
    ["line endings", stateEol],
  ];
  const disagreed = cmpRows.filter((r) => r[1] === "disagree").map((r) => r[0]);
  const uncompared = cmpRows.filter((r) => r[1] === "not-compared").map((r) => r[0]);

  if (disagreed.length > 0) {
    out.push(
      hole(
        "THE BOARD AND THIS RE-SUM DISAGREE",
        "Rows: " +
          disagreed.join(", ") +
          ". The disagreement is rendered above, not reconciled. Whichever is " +
          "wrong, a human decides — this generator only reports what the bytes said."
      )
    );
  }
  if (uncompared.length > 0) {
    out.push(
      hole(
        "THE BOARD ANCHOR IS PARTLY UNREAD — THESE ROWS WERE NOT COMPARED",
        "Rows: " +
          uncompared.join(", ") +
          ". This generator could not extract a comparable value from the " +
          "board's topmost pass for these quantities, so no check was " +
          "performed against them. The board may well state them; the " +
          "statement is PROSE and the parser did not match its wording. " +
          "An unchecked row is a BLINDNESS POINT, not an approval, and it is " +
          "counted here as one. Read it as: the re-sum stands on its own " +
          "bytes and is anchored to nothing."
      )
    );
  }

  const slotCount = TEST_MICA_FILES.length;
  if (slotCount !== SUITE.blocks.length) {
    out.push(
      hole(
        "SLOT COUNT MISMATCH",
        "package.json test:mica names " +
          String(slotCount) +
          " test files; the transcript carries " +
          String(SUITE.blocks.length) +
          " per-file blocks. The positional mapping below is therefore NOT " +
          "reliable, and every test count attributed to an instrument inherits " +
          "that unreliability."
      )
    );
  }

  const bareBlocks = SUITE.blocks.filter((b) => b.dialect === "bare");
  if (bareBlocks.length > 0) {
    out.push(
      hole(
        "THE SUITE DOES NOT REPORT IN ONE SHAPE",
        String(SUITE.blocks.length - bareBlocks.length) +
          " per-file block(s) end with “<n> tests: <p> passed, <f> failed”. " +
          String(bareBlocks.length) +
          " end with “<p> passed, <f> failed” and no total: " +
          bareBlocks
            .map((b) => (b.file ?? "«unmapped slot " + String(b.slot + 1) + "»"))
            .join(", ") +
          ". Both dialects are counted here. A house awk-sum written against " +
          "the first shape alone will silently omit " +
          String(bareBlocks.reduce((n, b) => n + b.total, 0)) +
          " tests. Stated, not normalised — a suite whose members do not " +
          "report in one shape is a finding about the suite."
      )
    );
  }

  out.push(
    "<details><summary>per-file blocks, positionally zipped to test:mica</summary>" +
      "<table><thead><tr><th>#</th><th>test file (package.json order)</th>" +
      "<th>tests</th><th>failed</th><th>dialect</th>" +
      "<th>transcript heading</th></tr></thead><tbody>"
  );
  for (const b of SUITE.blocks) {
    out.push(
      (b.failed > 0 ? '<tr class="fail">' : "<tr>") +
        "<td>" +
        String(b.slot + 1) +
        "</td><td><code>" +
        esc(b.file ?? "«NO FILE AT THIS POSITION IN test:mica»") +
        "</code></td><td>" +
        String(b.total) +
        "</td><td>" +
        String(b.failed) +
        "</td><td>" +
        (b.dialect === "bare"
          ? '<b class="warn">bare</b>'
          : '<span class="small">house</span>') +
        "</td><td class=\"small\">" +
        esc(b.heading) +
        "</td></tr>"
    );
  }
  out.push("</tbody></table></details>");
  out.push("</div>");
  return out.join("\n");
}

function renderHoles(): string {
  const out: string[] = [];

  // C1 — unbuilt with blockers
  const unbuilt = ROWS34.filter((r) => r.states.includes("UNBUILT"));
  out.push("<h3>C1 · Unbuilt, with the blocker the disk states</h3>");
  if (unbuilt.length === 0) {
    out.push(
      hole(
        "NO UNBUILT ROWS DETECTED — AND THAT IS ITSELF SUSPECT",
        "This generator marks a row UNBUILT only when the sweep's own instrument " +
          "cell reads (none). If the 34 could not be assembled, or the sweep " +
          "could not be parsed, this section is EMPTY BECAUSE NOTHING WAS READ, " +
          "not because nothing is unbuilt."
      )
    );
  } else {
    out.push(
      "<p class=\"small\">" +
        String(unbuilt.length) +
        " of the " +
        String(ROWS34.length) +
        " assembled rows carry a NO reads-verdict in the sweep — the sweep's " +
        "own word for “canon names the gap and states no instrument exists”. " +
        "The blockers below are the sweep's own words, not a gloss.</p>"
    );
    for (const r of unbuilt) out.push(row34Card(r));
  }

  // C2 — parked, from the ledger
  out.push("<h3>C2 · Parked — the deferrals ledger, verbatim status and reason</h3>");
  if (LEDGER_PARSE.rows.length === 0) {
    out.push(
      hole(
        "THE DEFERRALS LEDGER COULD NOT BE READ OR PARSED",
        LEDGER_PARSE.reason +
          " — every PARKED badge on this page is absent, not withheld."
      )
    );
  } else {
    out.push(
      "<p class=\"small\">" +
        String(PARKED_ROWS.length) +
        " open · " +
        String(CLOSED_ROWS.length) +
        " marked BUILT/CLOSED in the ledger's own text · source: <code>" +
        esc(LEDGER_FILE.name ?? "—") +
        "</code></p>"
    );
    out.push(
      "<table><thead><tr><th>id</th><th>status</th><th>subject</th>" +
        "<th>reason given, verbatim</th><th>what would unblock it</th></tr></thead><tbody>"
    );
    for (const r of PARKED_ROWS) {
      out.push(
        "<tr><td><code>" +
          esc(r.id) +
          '</code> ' +
          stateBadge("PARKED") +
          "</td><td>" +
          esc(r.status) +
          "</td><td>" +
          esc(r.subject) +
          "</td><td class=\"small\">" +
          esc(r.reason) +
          "</td><td class=\"small\">" +
          esc(r.unblock) +
          "</td></tr>"
      );
    }
    out.push("</tbody></table>");
    out.push(
      "<details><summary>ledger entries the ledger itself marks BUILT / CLOSED (" +
        String(CLOSED_ROWS.length) +
        ") — kept visible, never deleted</summary><table><tbody>" +
        CLOSED_ROWS.map(
          (r) =>
            "<tr><td><code>" +
            esc(r.id) +
            "</code></td><td>" +
            esc(r.status) +
            "</td><td>" +
            esc(r.subject) +
            "</td></tr>"
        ).join("") +
        "</tbody></table></details>"
    );
  }

  // C3 — vacuity sites & the dual accounting
  out.push("<h3>C3 · Vacuity sites — declared in source, and the board's dual accounting</h3>");
  const numbered = SITE_HITS.filter((h) => /SITE/i.test(h.text));
  out.push(
    '<div class="card"><p class="small">Every line under <code>src/</code> ' +
      "(non-test) that NAMES a vacuity site, quoted with file and line. " +
      "Found: <b>" +
      String(numbered.length) +
      "</b>.</p>"
  );
  if (numbered.length === 0) {
    out.push(
      hole(
        "NO VACUITY SITE DECLARED IN SOURCE",
        "The board counts sites; src/ declares none this generator can find."
      )
    );
  } else {
    out.push(
      pre(numbered.map((h) => h.file + ":" + String(h.line) + "  " + h.text))
    );
  }
  out.push(
    hole(
      "THE TWO ACCOUNTINGS DO NOT RECONCILE FROM DISK",
      "The board's WATCH prints " +
        (BOARD_ANCHOR.watch ?? "«no WATCH figure parsed from the board»") +
        " under the ruled dual accounting (sites = approvals, sections = " +
        "blindness points). Source declares site numbers only from TEN upward " +
        "(gate1 · gate4 · gate5 · the operator profile · gate2). Sites one " +
        "through nine are counted on the board and numbered nowhere in src/. " +
        "The difference is not derivable from this repository."
    )
  );
  out.push("</div>");

  // C4 — owed
  out.push("<h3>C4 · <code>[owed]</code> in the topmost pass</h3>");
  if (!BOARD_ANCHOR.available) {
    out.push(hole("THE BOARD COULD NOT BE READ", BOARD_ANCHOR.reason));
  } else if (BOARD_ANCHOR.owed.length === 0) {
    out.push(
      hole(
        "NO [owed] MARKER PARSED FROM THE TOPMOST PASS",
        "Either the pass carries none, or the marker is written in a shape this " +
          "generator does not match. The raw block is below; read it."
      )
    );
  } else {
    out.push("<ul>" + BOARD_ANCHOR.owed.map((o) => "<li>" + esc(o) + "</li>").join("") + "</ul>");
  }
  out.push(
    '<details><summary>the topmost <code>last-pass</code> block, verbatim</summary>' +
      pre([BOARD_ANCHOR.raw]) +
      "</details>"
  );

  // C5 — the routing precondition
  out.push("<h3>C5 · The routing precondition — stamped, never verified</h3>");
  out.push(
    '<div class="card">' +
      constBlock(
        "ROUTING_PRECONDITION",
        "The chokepoint's own statement that it cannot verify its own coverage."
      ) +
      "</div>"
  );

  // C6 — fenced, not mechanised
  out.push("<h3>C6 · Fenced, not mechanised — the registered-but-unhanded reader</h3>");
  const rosterHits = Array.from(FILE_TEXT.entries()).filter(
    ([abs, t]) =>
      abs.includes(path.join("src", "mica")) &&
      !abs.endsWith(".test.ts") &&
      /\broster\b/i.test(t)
  );
  const rosterLines: string[] = [];
  for (const [abs, t] of rosterHits) {
    const ls = t.split(/\r?\n/);
    for (let i = 0; i < ls.length; i++) {
      if (/\broster\b/i.test(ls[i]))
        rosterLines.push(rel(abs) + ":" + String(i + 1) + "  " + ls[i].trim());
    }
  }
  out.push(
    '<div class="card">' +
      "<p class=\"small\">The floor composes over whatever verdicts the caller " +
      "hands <code>guard()</code>. A reader that exists but is never handed in " +
      "contributes nothing and is invisible by construction — there is no " +
      "reader roster to check it against.</p>" +
      hole(
        "NO READER ROSTER IS DECLARED ANYWHERE UNDER src/mica/",
        "This generator searched every non-test file under src/mica/ for a " +
          "declared reader roster and found " +
          (rosterLines.length === 0
            ? "no mention of one at all"
            : "only " +
              String(rosterLines.length) +
              " PROSE mention(s), quoted below, and no roster object") +
          ". The fence is honest and it is printed; it is a FENCE, not a " +
          "MECHANISM. Nothing on disk detects a reader that was built and " +
          "never handed to guard()."
      ) +
      (rosterLines.length > 0 ? pre(rosterLines) : "") +
      "<p class=\"small\">The empty-floor case is the one place this is caught, " +
      "and it is caught as blindness, never as cleanliness:</p>" +
      fnBlock(
        "composeFloorKind — the empty case",
        "MICA-machine/src/mica/chokepoint/types.ts",
        COMPOSE_FLOOR_TEXT
      ) +
      "</div>"
  );

  // C7 — ILAS's own stated weaknesses
  out.push("<h3>C7 · ILAS — its own stated bounds, imported from nowhere else</h3>");
  if (!ILAS.available) {
    out.push(
      hole(
        "ILAS LAYER: CANNOT_ASSESS",
        ILAS.reason +
          " — this section is a visible hole, not a skipped section. No claim " +
          "about ILAS from the dispatch brief is substituted for the read."
      )
    );
  } else {
    out.push(
      '<div class="card"><p class="small">checkout: <code>' +
        esc(rel(ILAS.checkout ?? "")) +
        "</code> · modules found: " +
        ILAS.modules.map((m) => "<code>" + esc(m.name) + "</code>").join(" ") +
        "</p>"
    );
    out.push(
      "<details open><summary>module structure, as the directory tree gives it</summary>" +
        pre(
          ILAS.modules.map(
            (m) => m.name.padEnd(6) + " " + m.files.join("  ")
          )
        ) +
        "</details>"
    );
    if (ILAS.loadStates.length > 0) {
      out.push(
        "<details><summary>L0 load states — ILAS's own fail-closed table</summary>" +
          "<table><thead><tr><th>loadState</th><th>meaning</th><th>clean start?</th>" +
          "</tr></thead><tbody>" +
          ILAS.loadStates
            .map(
              (l) =>
                (/^no$/i.test(l.clean) ? '<tr class="fail">' : "<tr>") +
                "<td><code>" +
                esc(l.state) +
                "</code></td><td>" +
                esc(l.meaning) +
                "</td><td>" +
                esc(l.clean) +
                "</td></tr>"
            )
            .join("") +
          "</tbody></table></details>"
      );
    }
    for (const b of ILAS.statedBounds) {
      out.push(
        "<details><summary>README — " +
          esc(b.heading) +
          " (verbatim)</summary>" +
          pre([b.body]) +
          "</details>"
      );
    }
    out.push("</div>");
  }

  // C8 — reads that failed
  const failures = READ_LOG.filter((s) => !s.ok);
  out.push("<h3>C8 · Reads that failed</h3>");
  if (failures.length === 0) {
    out.push(
      '<p class="small">Every file this generator went looking for was found and ' +
        "read. That is a statement about file handles, and nothing else.</p>"
    );
  } else {
    for (const f of failures)
      out.push(hole("COULD NOT READ: " + f.label, f.abs + " — " + (f as SourceFail).reason));
  }
  if (SRC_READ_FAILURES.length > 0) {
    for (const f of SRC_READ_FAILURES)
      out.push(hole("SOURCE FILE UNREADABLE: " + rel(f.abs), f.reason));
  }
  return out.join("\n");
}

/** One sentence from the board, verbatim, or null. Never paraphrased. */
function boardSentence(pattern: RegExp): string | null {
  if (!BOARD.ok) return null;
  const flat = BOARD.text.replace(/\s+/g, " ");
  for (const sentence of flat.split(/(?<=[.]) /)) {
    if (pattern.test(sentence)) return sentence.trim();
  }
  return null;
}

function renderSeam(): string {
  const out: string[] = [];
  out.push('<div class="grid two">');
  out.push(
    '<div class="card"><h4>MICA JUDGES</h4><p class="small">' +
      "It composes sensor verdicts into a floor and turns the floor into a " +
      "disposition. It reads the record, never the world, and it emits no " +
      "positive health statement anywhere.</p>" +
      (CHOKEPOINT_ID_VALUE === null
        ? hole("CHOKEPOINT_ID NOT FOUND", "the judging object does not name itself")
        : '<p class="small">judging object: <code>' +
          esc(CHOKEPOINT_ID_VALUE) +
          "</code></p>") +
      "</div>"
  );
  out.push(
    '<div class="card"><h4>ILAS WITNESSES</h4><p class="small">' +
      "The witness ILAS needs is named in ILAS's own README as an EXTERNAL " +
      "dependency it does not ship. With the bundled NullWitness, continuity can " +
      "only report CANNOT_VERIFY_CONTINUITY.</p>" +
      (ILAS.available
        ? '<p class="small">read from <code>' + esc(rel(ILAS.checkout ?? "")) + "</code></p>"
        : hole("CANNOT_ASSESS", ILAS.reason)) +
      "</div>"
  );
  out.push("</div>");

  out.push(
    '<div class="card"><h4>THE DOCTOR READS FROM OUTSIDE — and the overlays are ' +
      "quarantined</h4>" +
      constBlock(
        "OVERLAY_REPORT_ONLY_BAR",
        "Why the doctor stream can never manufacture a false all-clear."
      ) +
      constBlock(
        "OVERLAY_SELF_AUTHORED_CEILING",
        "And why it is not an independent measurement either."
      ) +
      "</div>"
  );

  const authorshipQuote = boardSentence(/decorrelated sensor authorship/);
  out.push(
    '<div class="card"><h4 class="warn">SHARED-AUTHOR CORRELATION — AN OPEN ' +
      "INDEPENDENCE PROBLEM, NAMED ON THE SEAM</h4>" +
      hole(
        "SENSORS THAT SHARE AN AUTHOR DO NOT COMPOSE INTO INDEPENDENCE",
        "A floor composed of readers written by one author, against one fixture, " +
          "under one set of assumptions is not the hardness a floor of " +
          "independent readers would be. This is not this dashboard's claim; it " +
          "is the board's, quoted below, and it is OPEN."
      ) +
      (authorshipQuote === null
        ? hole(
            "THE BOARD SENTENCE THIS SECTION QUOTES WAS NOT FOUND",
            "The dashboard looked in the board for the sentence naming " +
              "decorrelated sensor authorship as a promotion precondition and " +
              "did not find it. The claim above therefore stands unsourced on " +
              "this page — treat it as unsupported until re-grounded."
          )
        : blockHtml({
            label: "ARC_MICA-BOARD.md — the board's own sentence",
            file: "MICA-4-gates/work-now/ARC_MICA-BOARD.md",
            lines: [authorshipQuote],
          })) +
      constBlock("B8_D15_CAVEAT", "Factor independence is pilot-unverified.") +
      constBlock(
        "B8_NO_METHOD_VARIANCE_CAVEAT",
        "The correction the canon specifies is not performed."
      ) +
      "</div>"
  );

  const rmbaHits = Array.from(FILE_TEXT.entries())
    .filter(([abs, t]) => !abs.endsWith(".test.ts") && /RMBA/.test(t))
    .map(([abs, t]) => {
      const lines = t.split(/\r?\n/);
      const idx = lines.findIndex((L) => /RMBA/.test(L));
      return rel(abs) + ":" + String(idx + 1) + "  " + (lines[idx] ?? "").trim();
    });
  const rmbaImports = Array.from(FILE_TEXT.entries()).filter(([, t]) =>
    /(from\s+["'][^"']*rmba|require\(\s*["'][^"']*rmba)/i.test(t)
  );
  out.push(
    '<div class="card"><h4>RMBA — EXAMPLE-IN-PROVENANCE ONLY, NEVER A WIRED ' +
      "INTERFACE</h4><p class=\"small\">Occurrences of the string RMBA in non-test " +
      "source: <b>" +
      String(rmbaHits.length) +
      "</b>. Import edges to anything named rmba: <b>" +
      String(rmbaImports.length) +
      "</b>." +
      (rmbaImports.length === 0
        ? " There is no interface. It is cited in provenance comments and " +
          "nowhere else."
        : " <b class=\"warn\">AN IMPORT EDGE EXISTS — the brief's claim that RMBA " +
          "is example-only is FALSE against this disk.</b>") +
      "</p>" +
      (rmbaHits.length > 0 ? pre(rmbaHits) : "") +
      "</div>"
  );

  const opInstruments = INSTRUMENTS.filter((i) => /\/op[0-9]-/.test(i.fileRel));
  out.push(
    '<div class="card"><h4>THE HUMAN SEATS — OUTSIDE THE MACHINE BOUNDARY</h4>' +
      "<p class=\"small\">doctor · arbiter · co-operator. The operator layer reads " +
      "their PAPERWORK from inside the record. It never reads engagement, and it " +
      "says so on every verdict. " +
      String(opInstruments.length) +
      " operator instruments found on disk.</p>" +
      hole(
        "THE MACHINE CANNOT READ THE SEATS, ONLY THEIR TRACES",
        "A gap in the record is identical whether its cause is fatigue, capture, " +
          "abandonment, death, or a suppressed append pipeline. Presence is not " +
          "quality; class presence is not content; a hollow attestation of the " +
          "right class reads as kept cadence. These are the operator layer's own " +
          "printed ceilings, not a gloss on them — open any operator node above."
      ) +
      "</div>"
  );

  return out.join("\n");
}

function renderFooter(): string {
  const rows = READ_LOG.map(sourceRow).join("");
  const anchorBits: string[] = [];
  anchorBits.push(
    "<div><b>generated at</b>" + esc(NOW_HUMAN) + "</div>"
  );
  anchorBits.push(
    "<div><b>board anchor</b>" +
      esc(
        (BOARD_ANCHOR.passName ?? "«no pass name parsed»") +
          " · " +
          (BOARD_ANCHOR.date ?? "«no date parsed»")
      ) +
      "</div>"
  );
  anchorBits.push(
    "<div><b>tally on the board</b>" +
      esc(BOARD_ANCHOR.tally ?? "«not parsed»") +
      "</div>"
  );
  anchorBits.push(
    "<div><b>register</b>" + esc(REGISTER) + "</div>"
  );
  return (
    "<footer>" +
    "<h2>" +
    esc(S.ceilingHeading) +
    "</h2>" +
    '<div class="anchor">' +
    anchorBits.join("") +
    "</div>" +
    '<div class="ceilingline">' +
    esc(S.ceilingSentence) +
    "</div>" +
    "<h3>" +
    esc(S.readsHeading) +
    "</h3>" +
    '<p class="small">Paths are relative to <code>' +
    esc(PROJECTS.split(path.sep).join("/")) +
    "</code>. Every file below was opened at generation time; the hash is of the " +
    "bytes read.</p>" +
    "<table><thead><tr><th>file</th><th>bytes</th><th>sha-256</th></tr></thead>" +
    "<tbody>" +
    rows +
    "</tbody></table>" +
    '<p class="small">Source files scanned for self-descriptions under <code>' +
    esc(rel(SRC_ROOT)) +
    "</code>: <b>" +
    String(SRC_FILES.length) +
    "</b> (not individually hashed — the cheap-hash rule). Top-level constants " +
    "lifted as text (exported and module-private): <b>" +
    String(CONSTS.size) +
    "</b>. No file under <code>src/</code> was imported, executed, or written.</p>" +
    '<p class="small">Regenerate with <code>npx ts-node ' +
    "tools/dashboard/generate-dashboard.ts</code>.</p>" +
    "</footer>"
  );
}

function renderLegend(): string {
  const out: string[] = ['<div class="legend">'];
  for (const r of STATE_RULES) {
    out.push(
      '<div class="l"><div>' +
        stateBadge(r.state) +
        "</div><div>" +
        esc(r.rule) +
        "</div></div>"
    );
  }
  out.push("</div>");
  out.push('<div class="ceilingline">' + esc(S.certifiedMeaning) + "</div>");
  out.push('<div class="ceilingline">' + esc(S.releaseLegend) + "</div>");
  return out.join("\n");
}

function renderPage(): string {
  const head =
    "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n" +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    "<title>" +
    esc(S.pageTitle) +
    " — " +
    STAMP +
    "</title>\n<style>" +
    CSS +
    "</style>\n</head>\n<body><div class=\"wrap\">";

  const header =
    "<h1>" +
    esc(S.pageTitle) +
    "</h1>" +
    '<p class="sub">' +
    esc(S.subtitle) +
    "</p>" +
    '<div class="anchor">' +
    "<div><b>generated at</b>" +
    esc(NOW_HUMAN) +
    "</div>" +
    "<div><b>board pass anchor</b>" +
    esc(
      (BOARD_ANCHOR.passName ?? "«no pass name parsed»") +
        " · " +
        (BOARD_ANCHOR.date ?? "«no date parsed»")
    ) +
    "</div>" +
    "<div><b>tally (board)</b>" +
    esc(BOARD_ANCHOR.tally ?? "«not parsed»") +
    "</div>" +
    "<div><b>WATCH (board)</b>" +
    esc(BOARD_ANCHOR.watch ?? "«not parsed»") +
    "</div>" +
    "<div><b>register</b>" +
    esc(REGISTER) +
    (REGISTER === "outsider" ? " — " + esc(OUTSIDER_STUB) : "") +
    "</div>" +
    "</div>" +
    (BOARD_ANCHOR.available
      ? ""
      : hole("THE BOARD COULD NOT BE READ", BOARD_ANCHOR.reason));

  const law =
    '<div class="law"><h2>' +
    esc(S.lawHeading) +
    "</h2><p>" +
    esc(S.lawBody) +
    "</p></div>" +
    renderLegend();

  return (
    head +
    header +
    law +
    "<h2>" +
    esc(S.flowHeading) +
    "</h2><p class=\"sub\">" +
    esc(S.flowNote) +
    "</p>" +
    renderFlow() +
    "<h2>" +
    esc(S.inventoryHeading) +
    "</h2><p class=\"sub\">" +
    esc(S.inventoryNote) +
    "</p>" +
    renderSuitePanel() +
    renderInventory() +
    "<h2>" +
    esc(S.holesHeading) +
    "</h2><p class=\"sub\">" +
    esc(S.holesNote) +
    "</p>" +
    renderHoles() +
    "<h2>" +
    esc(S.seamHeading) +
    "</h2><p class=\"sub\">" +
    esc(S.seamNote) +
    "</p>" +
    renderSeam() +
    renderFooter() +
    "</div></body></html>\n"
  );
}

// ── §17 · MAIN ───────────────────────────────────────────────────────────────

function main(): void {
  const html = renderPage();
  const outName = "mica-dashboard-" + STAMP + ".html";
  const outPath = path.join(OUT_DIR, outName);
  fs.writeFileSync(outPath, html, "utf8");

  const failures = READ_LOG.filter((s) => !s.ok).length;
  const lines: string[] = [];
  lines.push("── MICA dashboard generator ──────────────────────────────────");
  lines.push("register            : " + REGISTER);
  lines.push("repo                : " + REPO);
  lines.push("work-now            : " + WORK_NOW);
  lines.push("ILAS root           : " + ILAS_ROOT);
  lines.push("source files scanned: " + String(SRC_FILES.length));
  lines.push("top-level consts    : " + String(CONSTS.size));
  lines.push("instruments found   : " + String(INSTRUMENTS.length));
  lines.push(
    "the 34 assembled    : " +
      String(ROWS34.length) +
      " row ids across " +
      String(RETAINED.layers.length) +
      " layers"
  );
  lines.push(
    "suite of record     : " +
      String(BOARD_ANCHOR.suiteName ?? "«none named»") +
      (SUITE.available
        ? " — re-summed " +
          String(SUITE.passed) +
          "/" +
          String(SUITE.total) +
          ", " +
          String(SUITE.failed) +
          " failed, across " +
          String(SUITE.blocks.length) +
          " blocks"
        : " — UNREADABLE: " + SUITE.reason)
  );
  lines.push("ledger entries      : " + String(LEDGER_PARSE.rows.length));
  lines.push(
    "ILAS                : " +
      (ILAS.available ? String(ILAS.modules.length) + " modules" : "CANNOT_ASSESS — " + ILAS.reason)
  );
  lines.push("reads that FAILED   : " + String(failures));
  lines.push("written             : " + outPath);
  lines.push(
    "This generator attests nothing. It reports what it read, including what it " +
      "could not read."
  );
  process.stdout.write(lines.join("\n") + "\n");
}

main();
