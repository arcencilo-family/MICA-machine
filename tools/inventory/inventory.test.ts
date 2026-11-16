// ── MICA · the content-hash inventory, tested ────────────────────────────────
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node tools/inventory/inventory.test.ts
//
// What is worth testing about an inventory tool is narrow and unusual: not that
// it computes the right answer once, but that it computes the SAME answer twice
// and on another machine — because the only thing anyone does with its output
// is diff two of them, and a tool with any nondeterminism in it makes that diff
// unreadable exactly when it matters.

import assert from "assert";
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { SKIP_DIRS } from "../suite-protocol";
import {
  DEFAULT_ROOTS,
  INVENTORY_BLINDNESS,
  parseArgs,
  renderInventory,
  takeInventory,
} from "./hash-inventory";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(error as Error).stack ?? String(error)}`);
    failed++;
  }
}

const root = mkdtempSync(join(tmpdir(), "mica-inventory-"));
let counter = 0;

/** A tree with known bytes, a skipped dir, and a nested file. */
function fixture(stem: string): string {
  const base = join(root, `${stem}-${counter++}`);
  mkdirSync(join(base, "src", "deep"), { recursive: true });
  mkdirSync(join(base, "node_modules", "evil"), { recursive: true });
  mkdirSync(join(base, "dist"), { recursive: true });
  writeFileSync(join(base, "src", "b.ts"), "bbb", "utf8");
  writeFileSync(join(base, "src", "a.ts"), "aaa", "utf8");
  writeFileSync(join(base, "src", "deep", "c.ts"), "ccc", "utf8");
  writeFileSync(join(base, "node_modules", "evil", "x.ts"), "should not appear", "utf8");
  writeFileSync(join(base, "dist", "x.js"), "should not appear", "utf8");
  return base;
}

console.log("\n── the content-hash inventory ────────────────────────────────");

check("IV-A · a known-bytes fixture hashes to the known digest, with the byte count", () => {
  const base = fixture("known");
  const rows = takeInventory(base, ["src"]).rows;
  const a = rows.find((r) => r.path === "src/a.ts");
  assert.notStrictEqual(a, undefined);
  // Computed independently of the tool, from the bytes the fixture wrote.
  assert.strictEqual(
    (a as { sha256: string }).sha256,
    createHash("sha256").update(Buffer.from("aaa", "utf8")).digest("hex")
  );
  assert.strictEqual((a as { bytes: number }).bytes, 3);
});

check("IV-B · the digest is over BYTES, not decoded text", () => {
  const base = fixture("bytes");
  // `src/mica/export/ledger.ts` in this very repository carries a literal NUL as
  // its canonical field separator. A tool that round-tripped the tree through a
  // string would be reporting on something other than what is on disk.
  const raw = Buffer.from([0x61, 0x00, 0xff, 0xfe, 0x62]);
  writeFileSync(join(base, "src", "nul.bin"), raw);
  const row = takeInventory(base, ["src"]).rows.find((r) => r.path === "src/nul.bin");
  assert.notStrictEqual(row, undefined);
  assert.strictEqual(
    (row as { sha256: string }).sha256,
    createHash("sha256").update(raw).digest("hex")
  );
  assert.strictEqual((row as { bytes: number }).bytes, 5);
});

check("IV-C · two runs over identical input are byte-identical reports", () => {
  const base = fixture("determinism");
  const first = renderInventory(takeInventory(base, ["src"]));
  const second = renderInventory(takeInventory(base, ["src"]));
  assert.strictEqual(first, second);
  // The reason this can hold at all: no timestamp, no hostname, no run id, no
  // absolute path anywhere in the output. Asserted, not assumed.
  assert.ok(!first.includes(base), "an absolute path leaked into the report");
  assert.doesNotMatch(first, /\b20\d\d-\d\d-\d\d\b/, "a date leaked into the report");
  assert.doesNotMatch(first, /\b\d{13}\b/, "an epoch-ms stamp leaked into the report");
});

check("IV-D · rows are sorted by path, byte order, stable and locale-independent", () => {
  const base = fixture("sorting");
  // Names chosen so a locale-aware collation would order them differently from
  // codepoint order: uppercase, underscore, and dot all sort before lowercase
  // by byte, and after it under many locales.
  for (const name of ["Zeta.ts", "_under.ts", "alpha.ts", "Beta.ts", ".dotted.ts"]) {
    writeFileSync(join(base, "src", name), name, "utf8");
  }
  const paths = takeInventory(base, ["src"]).rows.map((r) => r.path);
  const expected = [...paths].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  assert.deepStrictEqual(paths, expected);
  assert.deepStrictEqual(paths, [...new Set(paths)], "a path appeared twice");
});

check("IV-E · the skipped directories are actually skipped, and they are the shared set", () => {
  const base = fixture("scope");
  const report = renderInventory(takeInventory(base, ["src", "node_modules", "dist"]));
  assert.ok(!report.includes("should not appear"), "a skipped file's CONTENT leaked");
  assert.ok(!report.includes("node_modules/evil"), "node_modules was walked");
  assert.ok(!report.includes("dist/x.js"), "dist was walked");
  // Named as a root, a skipped directory still yields nothing: the skip is on
  // the walk, and naming it does not smuggle it in.
  const rows = takeInventory(base, ["node_modules"]).rows;
  assert.deepStrictEqual(rows, []);
  // One walk convention, not two. If run-suite's set ever changes, this changes.
  assert.deepStrictEqual([...SKIP_DIRS].sort(), ["dist", "node_modules"]);
});

check("IV-F · the report states its own scope and its own blindness", () => {
  const base = fixture("selfreport");
  const report = renderInventory(takeInventory(base, ["src"]));
  assert.ok(report.includes("# roots      : src"));
  assert.ok(report.includes("# not walked : dist, node_modules"));
  assert.ok(report.includes(INVENTORY_BLINDNESS));
  assert.ok(INVENTORY_BLINDNESS.includes("leaves"));
  // A root that was named and is not there is REPORTED, never silently zero.
  const missing = renderInventory(takeInventory(base, ["src", "not-a-real-root"]));
  assert.ok(missing.includes("ROOT NAMED BUT NOT ON DISK: not-a-real-root"));
});

check("IV-G · the report carries NO verdict vocabulary — it counts and judges nothing", () => {
  const base = fixture("no-verdict");
  const report = renderInventory(takeInventory(base, ["src"]));
  // The easiest line in the brief to cross without noticing, so it is asserted
  // on the OUTPUT rather than trusted to review.
  for (const banned of [
    /\bPASS(?:ED|ES)?\b/,
    /\bFAIL(?:ED|S|URE)?\b/,
    /\bOK\b/,
    /\bCLEAN\b/,
    /\bALARM\b/,
    /\bSILENT\b/,
    /\bverdict\b/i,
    /\battest\w*/i,
    /\ball[- ]clear\b/i,
    /\bhealthy\b/i,
    /\bintact\b/i,
    /\bunchanged\b/i,
    /\bmatch(?:es|ed)?\b/i,
  ]) {
    assert.doesNotMatch(report, banned, `the report used verdict vocabulary: ${banned}`);
  }
});

check("IV-H · parseArgs: default roots, explicit roots, and --out", () => {
  assert.deepStrictEqual(parseArgs([]), { roots: DEFAULT_ROOTS, out: null });
  assert.deepStrictEqual(parseArgs(["src"]), { roots: ["src"], out: null });
  assert.deepStrictEqual(parseArgs(["src", "tools"]).roots, ["src", "tools"]);
  assert.strictEqual(parseArgs(["--out", "x.txt"]).out, "x.txt");
  assert.deepStrictEqual(parseArgs(["--out", "x.txt"]).roots, DEFAULT_ROOTS);
  // `--out` with nothing after it is absence, not the empty string: stdout.
  assert.strictEqual(parseArgs(["--out"]).out, null);
});

// ── the real process ─────────────────────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, "..", "..");
const TS_NODE_BIN = join(REPO_ROOT, "node_modules", "ts-node", "dist", "bin.js");
const ENTRY = join(REPO_ROOT, "tools", "inventory", "hash-inventory.ts");

function run(argv: readonly string[], cwd: string): { status: number; stdout: string } {
  const r = spawnSync(process.execPath, [TS_NODE_BIN, "-T", ENTRY, ...argv], {
    cwd,
    encoding: "utf8",
  });
  if (r.error) throw r.error;
  return { status: r.status ?? -1, stdout: r.stdout };
}

check("IV-I · stdout is the default, and NO file is created anywhere", () => {
  const base = fixture("stdout-default");
  const before = readdirSync(base).sort();
  const r = run(["src"], base);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.ok(r.stdout.includes("# MICA content-hash inventory"));
  assert.ok(r.stdout.includes("src/a.ts"));
  // NO DEFAULT SINK. Nothing appeared in the working directory, and nothing
  // appeared beside the tool either.
  assert.deepStrictEqual(readdirSync(base).sort(), before);
  assert.deepStrictEqual(
    readdirSync(join(REPO_ROOT, "tools", "inventory")).sort(),
    ["hash-inventory.ts", "inventory.test.ts"]
  );
});

check("IV-J · a named output path is written, and only a named one", () => {
  const base = fixture("named-out");
  const out = join(base, "inventory.txt");
  assert.strictEqual(existsSync(out), false);
  const r = run(["src", "--out", out], base);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.ok(existsSync(out), "the named file was not written");
  const written = readFileSync(out, "utf8");
  assert.ok(written.includes("# MICA content-hash inventory"));
  assert.ok(written.includes("src/a.ts"));
  // The artifact carries its own scope, so a report found later still says what
  // it was pointed at rather than leaving a reader to guess.
  assert.ok(written.includes("# roots      : src"));
  assert.ok(written.includes(INVENTORY_BLINDNESS));
  // stdout says where it went and nothing else pretends to be the report.
  assert.ok(r.stdout.startsWith("inventory written to "));
});

check("IV-K · the spawned tool reads only: the tree it walked is untouched", () => {
  const base = fixture("read-only");
  const digestOf = (p: string): string =>
    createHash("sha256").update(readFileSync(p)).digest("hex");
  const before = ["src/a.ts", "src/b.ts", "src/deep/c.ts"].map((p) =>
    digestOf(join(base, p))
  );
  run(["src"], base);
  const after = ["src/a.ts", "src/b.ts", "src/deep/c.ts"].map((p) =>
    digestOf(join(base, p))
  );
  assert.deepStrictEqual(after, before);
});

check("IV-L · run over THIS repository it finds its own two files and the runner", () => {
  // Not pinned to a count — the tree grows. Pinned to the property that the
  // tool can see itself, which is the cheapest guard against a walk that
  // silently stopped walking.
  const rows = takeInventory(REPO_ROOT, ["tools"]).rows.map((r) => r.path);
  for (const expected of [
    "tools/inventory/hash-inventory.ts",
    "tools/inventory/inventory.test.ts",
    "tools/run-suite.ts",
    "tools/suite-protocol.ts",
  ]) {
    assert.ok(rows.includes(expected), `the walk missed ${expected}`);
  }
});

rmSync(root, { recursive: true, force: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
