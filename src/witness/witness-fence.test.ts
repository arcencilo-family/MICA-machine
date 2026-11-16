// THE LITERAL FENCE, COMMITTED (audit 2026-10-11 06:13Z ④): removability was never meant to be a manual grep.
//   ts-node src/witness/witness-fence.test.ts
//
// The ruled list (Gate-1 brief, "Removability"; the audit counts the operator's home with it): no reader, tool,
// fixture default or test of the witness build may name the subject, its tool class, its uid, its harness, or the
// operator's home. The list is held here ONLY AS SHA-256 HASHES of lowercase tokens, so this file names nothing; the
// operator's own account name is added BY USE from the OS when the test runs under a /home account.
//
// Scope: every file the witness build owns must hold ZERO hits; the witness block of glue.test.ts must hold zero;
// files this build EDITED that carried hits before it are held by a RATCHET at their measured count — a new hit
// anywhere fails, an old one is named, not hidden. The arbiter's deploy scripts and their generator (deploy/, committed so
// this fence sees them: audit 2026-10-11 12:51Z) hold no ruled token but one, held by its hash (F-5), and are exactly
// what the generator makes from this tree (F-6).
import assert from "assert";
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { homedir, userInfo } from "os";
import { basename, join, resolve } from "path";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(error as Error).message}`);
    failed++;
  }
}

const ROOT = resolve(__dirname, "..", "..");
const RULED: ReadonlySet<string> = new Set([
  "414360a5214ca1a5e3e78daab9eaa98f4cda5eae68345148afc153d0f515d5f1",
  "b1607410ecc9857e9c2da29d3acb1e9af58897cb61ffafc0140cb99ccd3504be",
  "cf5bfb26b102bbfb26a07758c8153b7dbb453374eeb4ac0aa20b2b2597a963da",
  "38879b6376fbabdc8fbfb85f6b11a296aca6de14093a54881b73528b62848d8c",
  "37d2b12d5d9abc2a364ef9448767ee03938e383c0284193477dc7618f4b7c6c2",
  "c70442de124ba47f7691057dfc6be35239196b5c979d4ac5340d29e38d9fea84",
]);
const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
/** The operator, by use: only an account whose home is under /home (never root, never a service user). */
const BY_USE: ReadonlySet<string> = new Set(
  homedir().startsWith("/home/") ? [userInfo().username.toLowerCase(), basename(homedir()).toLowerCase()] : []
);

/** Each hit: the token (a word, or hyphenated words, or one hyphen-part) whose hash is ruled, or a by-use name. */
function hits(text: string): string[] {
  const out: string[] = [];
  for (const tok of text.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []) {
    const parts = tok.includes("-") ? [tok, ...tok.split("-")] : [tok];
    if (parts.some((p) => RULED.has(sha(p)) || BY_USE.has(p))) out.push(tok);
  }
  return out;
}
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

/** Files the witness build owns: ZERO hits. */
const OWNED = [
  "src/witness/seeing.ts",
  "src/witness/seeing-intake.ts",
  "src/witness/seeingd.ts",
  "src/witness/seeing.test.ts",
  "src/witness/seeingd.test.ts",
  "src/witness/witness-fence.test.ts",
  "deploy/mica-witness-sight.service",
  "src/glue/wire.ts",
];
/** The witness block of a file the build edited: ZERO hits from the marker on. */
const BLOCKS: readonly [string, string][] = [["src/glue/glue.test.ts", "TIER 1 · GATE 2 ON THE WITNESS'S BOOK OF EFFECTS"]];
/** Files the build edited that carried hits BEFORE it (outside its lines): frozen at the measured count. */
const RATCHET: Readonly<Record<string, number>> = { "src/glue/glue.test.ts": 19, "src/glue/subject-event-journal.ts": 1 };
/**
 * The arbiter's three scripts and their generator. Every measured value that would name the subject or the operator is
 * pinned there as a SHA-256 and compared with the live value, so they name nothing — save ONE ruled token that is also
 * the name of the scripts' own interpreter. It is held here BY ITS HASH, at the measured count per file: any other
 * ruled token, or one more of this one, fails.
 */
const SCRIPTS: Readonly<Record<string, number>> = {
  "deploy/witness-sight-deploy.sh": 6, // +1 (2026-10-11 17:1xZ): the --finish usage line names the interpreter
  "deploy/witness-sight-remove.sh": 3,
  "deploy/what13-ilas-devtree-hygiene.sh": 5,
  "deploy/gen-deploy.py": 14, // the same +1, in the template
};
const INTERPRETER = "37d2b12d5d9abc2a364ef9448767ee03938e383c0284193477dc7618f4b7c6c2";

check("F-1 · the scanner FINDS what it is for: every ruled token, a hyphen-part, and the operator by use", () => {
  // Built from character codes, so this file still names nothing.
  const word = (codes: number[]): string => String.fromCharCode(...codes);
  const planted = [
    word([104, 111, 117, 115, 101, 107, 101, 101, 112, 101, 114]),
    word([114, 105, 99, 104, 97, 114, 100, 115, 45, 99, 97, 116]),
    word([99, 108, 97, 117, 100, 101, 45, 98, 111, 116]),
    word([57, 56, 48]),
    word([98, 97, 115, 104]),
    word([102, 121, 108, 103, 105, 97, 110]),
  ];
  for (const p of planted) assert.ok(hits(`x ${p} y`).length === 1, `not found: token #${String(planted.indexOf(p))}`);
  assert.strictEqual(hits(`/home/${planted[5]}/x`).length, 1, "inside a path");
  assert.strictEqual(hits(`mica-${planted[0]}`).length, 1, "as a hyphen-part");
  assert.strictEqual(hits("1980 9800 basher housekeeping").length, 0, "never a mere substring");
});

check("F-2 · every file the witness build OWNS holds zero ruled literals", () => {
  const found = OWNED.flatMap((f) => hits(read(f)).map((t) => `${f}: ${t}`));
  assert.deepStrictEqual(found, []);
});

check("F-3 · the witness BLOCK of each edited file holds zero", () => {
  for (const [f, marker] of BLOCKS) {
    const text = read(f);
    const at = text.indexOf(marker);
    assert.ok(at >= 0, `${f}: the marker moved — re-scope this fence, never drop it`);
    assert.deepStrictEqual(hits(text.slice(at)), [], f);
  }
});

check("F-4 · the RATCHET: an edited file never gains a hit; its old hits are named, not hidden", () => {
  for (const [f, frozen] of Object.entries(RATCHET)) {
    const n = hits(read(f)).length;
    assert.ok(n <= frozen, `${f}: ${String(n)} hits, frozen at ${String(frozen)} — a new literal entered`);
    if (n < frozen) console.log(`    ${f}: ${String(n)} < ${String(frozen)} — lower the ratchet to ${String(n)}`);
  }
});

check("F-5 · the deploy scripts and their generator: no ruled token but the interpreter's name, at its measured count", () => {
  assert.ok(RULED.has(INTERPRETER), "the held token is one of the ruled list");
  for (const [f, frozen] of Object.entries(SCRIPTS)) {
    const found = hits(read(f));
    const other = found.filter((t) => sha(t) !== INTERPRETER);
    assert.deepStrictEqual(other.map((t) => sha(t).slice(0, 12)), [], `${f}: a ruled token other than the interpreter's name (by hash prefix)`);
    assert.ok(found.length <= frozen, `${f}: ${String(found.length)} uses of the interpreter's name, frozen at ${String(frozen)}`);
    if (found.length < frozen) console.log(`    ${f}: ${String(found.length)} < ${String(frozen)} — lower the count to ${String(found.length)}`);
  }
});

check("F-6 · the committed deploy scripts are exactly what deploy/gen-deploy.py makes from this tree (its pins are these bytes)", () => {
  const r = spawnSync("python3", [join(ROOT, "deploy", "gen-deploy.py"), "--check"], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, `gen-deploy.py --check: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /generated == committed/);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
