#!/usr/bin/env node
// ── MICA · the content-hash inventory ─────────────────────────────────────────
//
//   npm run inventory                        -> src/ and tools/, to stdout
//   npm run inventory -- src                 -> one root, to stdout
//   npm run inventory -- src tools --out F   -> to the file F, named by you
//
// THE ONE SENTENCE THIS TOOL IS ALLOWED TO SAY:
//
//   These bytes were at these paths when I was pointed at them.
//
// ── WHY IT EXISTS ────────────────────────────────────────────────────────────
//
//   Every S86 dispatch performed a chain-of-custody gate BY HAND — walk the
//   tree, hash every file, diff the before against the after, prove that only
//   the fenced files moved. A hand-run gate is a gate that gets skipped on the
//   day it matters, and the day it matters is the day someone is in a hurry.
//
// ── IT JUDGES NOTHING, AND THAT IS THE WHOLE DESIGN ──────────────────────────
//
//   There is no PASS here, no verdict, no all-clear, no comparison. It prints
//   an inventory. Whether two inventories differ is answered by `diff`, and
//   what a difference MEANS is answered by a person holding a build brief.
//
//   It deliberately holds no baseline. A tool that remembers last time is a
//   tool that can be handed a stale memory and asked to bless the present
//   against it; the stale baseline then reads exactly like a clean one. Two
//   runs and `diff` cannot rot, because neither run outlives the reader.
//
// ── DETERMINISM IS A FEATURE AND IT COST SOMETHING ───────────────────────────
//
//   No timestamp, no hostname, no absolute path, no run id appears anywhere in
//   the output. Any of them would make two identical trees produce two
//   different inventories, and the diff — the only thing this tool is for —
//   would fill with noise. Sorting is by byte-order codepoint comparison, not
//   `localeCompare`, so the order does not change with the machine's locale.
//
// ── PATHS ARE THE CALLER'S ───────────────────────────────────────────────────
//
//   Relative roots and `--out` resolve against the CURRENT WORKING DIRECTORY,
//   not against this file's location. `npm run inventory` therefore covers the
//   repository because npm sets cwd to the package root, and `cd elsewhere`
//   covers elsewhere, which is the only behaviour that is not a surprise.
//
// ── NO DEFAULT SINK ──────────────────────────────────────────────────────────
//
//   stdout unless you name a file. Nothing is written anywhere the caller did
//   not name, no directory is created, and nothing on disk is touched. The tool
//   opens files for reading and does nothing else.
// ──────────────────────────────────────────────────────────────────────────────

import { createHash } from "crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { basename, isAbsolute, join, relative, resolve } from "path";

import { SKIP_DIRS } from "../suite-protocol";

export const DEFAULT_ROOTS: readonly string[] = ["src", "tools"];

/**
 * WHAT THIS TOOL CANNOT SEE, printed on the face of every report it produces.
 *
 * The same law as the drop that never arrived: an instrument that reports on
 * what it was shown says nothing whatever about what it was not shown.
 */
export const INVENTORY_BLINDNESS =
  "This hashes what it was pointed at. A file that was never in scope leaves " +
  "no trace here — not an absence, not a zero, nothing. Scope is stated above " +
  "so a reader can see what was never looked at.";

export interface InventoryRow {
  /** Repo-relative, forward slashes, on every platform. */
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface InventoryScope {
  readonly repoRoot: string;
  /** As given, repo-relative. */
  readonly roots: readonly string[];
  readonly skipped: readonly string[];
  /** Roots that were named but are not on disk. Reported, never invented. */
  readonly missingRoots: readonly string[];
  /**
   * Roots that were named and are in the not-walked set.
   *
   * SELF-CAUGHT DEFECT, this build: the skip used to be applied only while
   * DESCENDING, so `inventory node_modules` walked it in full — the one
   * directory the convention exists to keep out, let in through the front door
   * by naming it. Refusing silently would be as bad, so the refusal is printed.
   */
  readonly skippedRoots: readonly string[];
}

export interface Inventory {
  readonly scope: InventoryScope;
  readonly rows: readonly InventoryRow[];
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(path, out);
    } else if (stat.isFile()) {
      out.push(path);
    }
  }
}

/** Byte-order comparison. NOT `localeCompare` — that varies by machine. */
function byPath(a: InventoryRow, b: InventoryRow): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/**
 * Hash every file under `roots`. Reads only.
 *
 * The digest is over FILE BYTES, never over decoded text: `src/mica/export/
 * ledger.ts` contains a literal NUL as a canonical field separator, and any
 * tool that round-tripped this tree through a string would be reporting on
 * something other than what is on disk.
 */
export function takeInventory(
  repoRoot: string,
  roots: readonly string[] = DEFAULT_ROOTS
): Inventory {
  const files: string[] = [];
  const missingRoots: string[] = [];
  const skippedRoots: string[] = [];
  for (const root of roots) {
    const abs = isAbsolute(root) ? root : join(repoRoot, root);
    // The not-walked set binds a named root exactly as it binds a nested
    // directory. Otherwise the convention holds only for callers who did not
    // think to ask.
    if (SKIP_DIRS.has(basename(abs))) {
      skippedRoots.push(root);
      continue;
    }
    let isDir = false;
    try {
      isDir = statSync(abs).isDirectory();
    } catch {
      missingRoots.push(root);
      continue;
    }
    if (isDir) walk(abs, files);
    else files.push(abs);
  }

  const rows = files
    .map((abs) => {
      const bytes = readFileSync(abs);
      return {
        path: relative(repoRoot, abs).split("\\").join("/"),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      };
    })
    .sort(byPath);

  return {
    scope: {
      repoRoot,
      roots: [...roots],
      skipped: [...SKIP_DIRS].sort(),
      missingRoots,
      skippedRoots,
    },
    rows,
  };
}

/**
 * The report. Header lines are `#`-prefixed so `grep -v '^#'` leaves exactly
 * the data, and so a diff of two reports shows scope changes as scope changes.
 */
export function renderInventory(inventory: Inventory): string {
  const { scope, rows } = inventory;
  const lines: string[] = [];
  lines.push("# MICA content-hash inventory");
  lines.push(`# roots      : ${scope.roots.join(", ")}`);
  lines.push(`# not walked : ${scope.skipped.join(", ")}`);
  for (const missing of scope.missingRoots) {
    lines.push(`# ROOT NAMED BUT NOT ON DISK: ${missing} — nothing under it was read`);
  }
  for (const skipped of scope.skippedRoots) {
    lines.push(
      `# ROOT NAMED BUT NOT WALKED: ${skipped} — it is in the not-walked set, ` +
        `and naming it does not override that`
    );
  }
  lines.push(`# files      : ${rows.length}`);
  lines.push(`# ${INVENTORY_BLINDNESS}`);
  lines.push("# columns    : sha256  bytes  path");
  for (const row of rows) {
    lines.push(`${row.sha256}  ${String(row.bytes).padStart(9)}  ${row.path}`);
  }
  return lines.join("\n") + "\n";
}

export interface Args {
  readonly roots: readonly string[];
  /** Absent means stdout. There is no default file and never will be. */
  readonly out: string | null;
}

export function parseArgs(argv: readonly string[]): Args {
  const roots: string[] = [];
  let out: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") out = argv[++i] ?? null;
    else roots.push(a);
  }
  return { roots: roots.length > 0 ? roots : DEFAULT_ROOTS, out };
}

export function main(argv: readonly string[], repoRoot: string): number {
  const args = parseArgs(argv);
  const report = renderInventory(takeInventory(repoRoot, args.roots));
  if (args.out === null) {
    process.stdout.write(report);
  } else {
    // The caller named this path. Nothing is created that was not named, and no
    // directory is made for it: a missing parent is the caller's to explain.
    writeFileSync(resolve(args.out), report, "utf8");
    process.stdout.write(`inventory written to ${args.out}\n`);
  }
  return 0;
}

if (require.main === module) {
  // SELF-CAUGHT DEFECT, this build: this used to pass
  // `resolve(__dirname, "..", "..")`, so a relative root resolved against the
  // TOOL's location rather than the caller's. `cd anywhere && inventory src`
  // then inventoried THIS repository and reported paths that were not the ones
  // asked about — a wrong answer wearing a plausible one. Relative paths belong
  // to the caller's working directory, which is also what `npm run inventory`
  // supplies (npm sets cwd to the package root).
  process.exit(main(process.argv.slice(2), process.cwd()));
}
