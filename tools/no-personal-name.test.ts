// ── MICA · no personal name in what the tools print (Publication P2) ─────────
//
// House dialect: standalone ts-node script, own check() harness, own counters,
// "<n> tests: <p> passed, <f> failed", exit 1 on any failure.
//
// THE RULE (draft ticket P2, condition 1): a published MICA speaks of ROLES —
// the arbiter, the operator, the deployer, the doctor — never of a private
// person. No name held below (BY ITS SHA-256 ONLY, so this file names nobody)
// may appear in a STRING LITERAL or TEMPLATE
// LITERAL of shippable source (every *.ts under the repo except *.test.ts,
// *.d.ts and node_modules).
//
// COMMENTS ARE ALLOWED, deliberately: the history (who ruled what, when) stays
// where it is read — in comments and in the vault. This test walks TypeScript
// tokens with the compiler's own parser, so a comment is excluded exactly, not
// by a regex guess.
//
// WHAT IT DOES NOT SEE, stated: non-.ts sources (shell, python, units); a name
// assembled at runtime from pieces; a name not on the list.
import assert from "assert";
import { createHash } from "crypto";
import { readdirSync, readFileSync } from "fs";
import { join, relative, sep } from "path";
import * as ts from "typescript";

/**
 * The declared list, as SHA-256 of the lower-cased name. The names themselves are not written in this file.
 * Add to it; never shorten it without a ticket. Order: the arbiter's given name, the two spellings of his
 * family name, the family-project name, the operator's account word.
 */
export const NAME_HASHES: ReadonlySet<string> = new Set([
  "77646f5a4f3166637627abe998e7a1470fe72d8b430f067dafa86263f1f23f94",
  "086beaf46b4b0fa4519792f181e97d5408cd9cf7222c07229d48fb7f4422f8f8",
  "500936e647e5d17905fe2e97a4396abbe1109b403d67b81b37a124da44d93bd9",
  "8e8ebed4ab57f4260ca40f49cc3b5cd79ec29e052bf55fa9de2308648abecba8",
  "c70442de124ba47f7691057dfc6be35239196b5c979d4ac5340d29e38d9fea84",
]);
const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
/** A literal carries a listed name when one of its letter-runs (case-folded) hashes onto the list. */
function carriesName(literalText: string, hashes: ReadonlySet<string>): boolean {
  for (const tok of literalText.match(/[\p{L}]+/gu) ?? []) if (hashes.has(sha(tok.toLowerCase()))) return true;
  return false;
}

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(error as Error).message ?? String(error)}`);
    failed++;
  }
}

const REPO_ROOT = join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build"]);
const LITERAL_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
]);

function shippable(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) shippable(p, out);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** Every literal token in `text` that carries a listed name, as "line: literal". */
export function namedLiterals(fileName: string, text: string, hashes: ReadonlySet<string> = NAME_HASHES): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if (LITERAL_KINDS.has(node.kind)) {
      const t = node.getText(sf);
      if (carriesName(t, hashes)) {
        hits.push(`${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: ${t.slice(0, 160)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

// The planted names are built from character codes (or are synthetic words), so this file still names nobody.
const word = (codes: number[]): string => String.fromCharCode(...codes);
const PLANTED_REAL = [
  word([70, 114, 97, 110, 107]),
  word([66, 246, 104, 109]),
  word([66, 111, 101, 104, 109]),
  word([65, 114, 99, 101, 110, 99, 105, 108, 111]),
  word([102, 121, 108, 103, 105, 97, 110]),
];

check("the walker sees a name in a string, a template and a template part, and not in comments (synthetic list)", () => {
  const synthetic = new Set([sha("zzplanted")]);
  const src = [
    "// zzplanted ruled this in a line comment",
    "/** zzPlanted in a doc comment */",
    "const a = 'zzplanted';",
    "const b = `ZZPLANTED`;",
    "const c = `x ${a} zzplanted's ${b} y`;",
    "/* zzplanted */ const d = 'the arbiter';",
  ].join("\n");
  const hits = namedLiterals("positive-control.ts", src, synthetic);
  assert.strictEqual(hits.length, 3, `expected 3 literal hits, got ${hits.length}: ${hits.join(" | ")}`);
  assert.ok(hits.every((h) => !h.includes("arbiter")), "a clean literal was flagged");
});

check("the REAL list fails on every planted real name: string, template, upper case, possessive, and hyphen-joined", () => {
  for (const n of PLANTED_REAL) {
    for (const lit of [`const a = "${n}";`, `const a = \`${n.toUpperCase()}\`;`, `const a = "${n}'s hand";`, `const a = "${n}-ruled";`]) {
      assert.strictEqual(namedLiterals("plant.ts", lit).length, 1, `not caught: ${lit.replace(n, "<planted>").replace(n.toUpperCase(), "<PLANTED>")}`);
    }
    assert.strictEqual(namedLiterals("plant.ts", `// ${n} in a comment\nconst a = 1;`).length, 0, "a comment was flagged");
  }
  assert.strictEqual(namedLiterals("clean.ts", `const a = "the arbiter holds", b = "${PLANTED_REAL[0]}ly";`).length, 0, "a clean literal or a mere substring was flagged");
});

const files = shippable(REPO_ROOT);

check("the walk is not vacuous: it reads the shippable tree", () => {
  const rels = files.map((f) => relative(REPO_ROOT, f).split(sep).join("/"));
  assert.ok(files.length >= 50, `only ${files.length} shippable .ts files found`);
  for (const must of ["src/core-door/core-door.ts", "src/assembler/assembler.ts", "src/mica/doctor/latency.ts"]) {
    assert.ok(rels.includes(must), `${must} not walked`);
  }
});

check(`no listed personal name (held by hash) in a printed string of shippable source`, () => {
  const all: string[] = [];
  for (const f of files) {
    for (const h of namedLiterals(f, readFileSync(f, "utf8"))) all.push(`${relative(REPO_ROOT, f)}:${h}`);
  }
  assert.strictEqual(all.length, 0, `${all.length} literal(s) name a person — use the role:\n      ${all.join("\n      ")}`);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
