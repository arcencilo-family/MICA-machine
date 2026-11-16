// The witness's seeing method: every look state, every row of the class map, the BEFORE rule.
//   ts-node src/witness/seeing.test.ts
import assert from "assert";
import { createHash, createHmac } from "crypto";
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";

import {
  boundMac,
  classifyFacet,
  publicLook,
  consequenceEventType,
  consequenceOutcome,
  CONTENT_CAP_BYTES,
  EFFECT_CLASSES,
  EVIDENCE_FREE_CLASSES,
  OUTCOME_ONLY_CLASSES,
  LISTING_CAP_ENTRIES,
  look,
  SEEING_METHOD,
  SEEING_METHOD_DIGEST,
  type EffectClass,
  type Look,
  type LookContext,
} from "./seeing";

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

const root = mkdtempSync(join(tmpdir(), "mica-seeing-"));
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const KEY = Buffer.alloc(32, 7);
const tick = { wall: 1000, mono: 1000n };
const ctx = (selfRoots: string[] = [], between?: LookContext["between"]): LookContext => ({
  key: KEY,
  clock: { wall: () => ++tick.wall, mono: () => ++tick.mono, boot: "boot-A" },
  selfRoots,
  ...(between === undefined ? {} : { between }),
});
/** A hook that acts ONCE at one stage — a concurrent writer at the exact window. */
const once = (stage: string, act: () => void): LookContext["between"] => {
  let done = false;
  return (s) => {
    if (s === stage && !done) {
      done = true;
      act();
    }
  };
};
/** The bound MAC, spelt out independently of the module: length-prefixed path, NUL, tag, NUL, data. */
const hmac = (path: string, tag: string, data: string | Buffer): string =>
  createHmac("sha256", KEY).update(`${String(Buffer.byteLength(path, "utf8"))}:${path}\u0000${tag}\u0000`, "utf8").update(data).digest("hex");

/** The method's digest, pinned: a rule or a ceiling edited without this line moving is caught here. */
// W-1 (audit 2026-10-11 18:43Z: a failed look reads UNOBSERVABLE whatever the history) moved the method; it was
// bd91dc37fa7e5d0653c795c4878266a4482c1405d932ce0b073d50b5bce41b72 (phase R v1, the method of the first live book).
const PINNED_METHOD_DIGEST = "2a4c1dad0956d152318c96037fc324306e35ad76f0dfd041b87608e7dcc3a6b8";

check("SM-1 · the method digest is sha256 over the method's canonical JSON (rules AND ceilings), and it is pinned", () => {
  assert.match(SEEING_METHOD_DIGEST, /^[0-9a-f]{64}$/);
  console.log(`    method ${SEEING_METHOD_DIGEST} v${SEEING_METHOD.version}`);
  assert.ok(SEEING_METHOD.ceilings.length >= 8, "the ceilings ride the method");
  for (const word of ["NOT BENEFIT", "CLAIMED TARGET", "SINCE THE WITNESS LAST LOOKED", "THIS BOX", "REACH", "TAMPER-EVIDENT"]) {
    assert.ok(SEEING_METHOD.ceilings.some((c) => c.includes(word)), `ceiling missing: ${word}`);
  }
  assert.strictEqual(SEEING_METHOD_DIGEST, PINNED_METHOD_DIGEST);
});

check("SM-2 · the record class is CONSEQUENCE@<16 hex> = sha256(JSON [method digest, derivation class]) — the bridge's computation, byte for byte", () => {
  const dc = "INTEREST_LABEL@2b7df2aba755e90c";
  const expect = "CONSEQUENCE@" + createHash("sha256").update(JSON.stringify([SEEING_METHOD_DIGEST, dc]), "utf8").digest("hex").slice(0, 16);
  assert.strictEqual(consequenceEventType(dc), expect);
  assert.notStrictEqual(consequenceEventType("INTEREST_LABEL@427aa81882b0a205"), expect, "another drawing is another class");
  assert.throws(() => consequenceEventType("INTEREST_LABEL@XYZ"), /INTEREST_LABEL/);
  assert.throws(() => consequenceEventType("CONSEQUENCE@0123456789abcdef"), /INTEREST_LABEL/);
  assert.strictEqual(consequenceOutcome("x2", "CONTENT_DIFFERS"), "x2:CONTENT_DIFFERS");
  // THE CROSS-REPO PIN, on a FIXED input: the bridge's witnessRecordClass (mica-bridge/witness-pointer.ts) is pinned,
  // for the method literal bd91dc37… (phase R v1), to CONSEQUENCE@dd31bb90bb21909a; this formula on that same input
  // gives the same — a drift in either side's formula breaks one of the two suites. (The method moving does not.)
  const BRIDGE_PINNED_METHOD = "bd91dc37fa7e5d0653c795c4878266a4482c1405d932ce0b073d50b5bce41b72";
  assert.strictEqual("CONSEQUENCE@" + createHash("sha256").update(JSON.stringify([BRIDGE_PINNED_METHOD, dc]), "utf8").digest("hex").slice(0, 16), "CONSEQUENCE@dd31bb90bb21909a");
  // and THIS method's own class for that drawing, pinned:
  assert.strictEqual(consequenceEventType(dc), "CONSEQUENCE@532f745fe99909eb");
});

check("SM-3 · ABSENT is ENOENT or ENOTDIR only; a look is stamped when it ENDS, with its boot", () => {
  const before = tick.mono;
  const a = look(join(root, "no-such"), ctx());
  assert.strictEqual(a.state, "ABSENT");
  assert.strictEqual(a.error, "ENOENT");
  assert.ok(BigInt(a.mono) > before && a.boot === "boot-A");
  const f = join(root, "plainfile");
  writeFileSync(f, "x");
  const b = look(join(f, "under-a-file"), ctx());
  assert.strictEqual(b.state, "ABSENT");
  assert.strictEqual(b.error, "ENOTDIR");
});

check("SM-4 · EACCES is UNOBSERVABLE, never ABSENT (a closed directory hides whether the target exists)", () => {
  if (isRoot) return console.log("    (root: permissions do not bind — skipped)");
  const d = join(root, "closed");
  mkdirSync(d);
  writeFileSync(join(d, "inside"), "secret");
  chmodSync(d, 0o000);
  try {
    const l = look(join(d, "inside"), ctx());
    assert.strictEqual(l.state, "UNOBSERVABLE");
    assert.strictEqual(l.error, "EACCES");
    assert.strictEqual(look(join(d, "not-there"), ctx()).state, "UNOBSERVABLE", "absence inside a closed directory is not observable either");
  } finally {
    chmodSync(d, 0o755);
  }
});

check("SM-5 · a regular file up to the cap is digested by HMAC under the witness's key; one byte over is OVER_CAP and is not read", () => {
  const f = join(root, "small");
  writeFileSync(f, "hello");
  const l = look(f, ctx());
  assert.strictEqual(l.state, "PRESENT");
  assert.strictEqual(l.type, "file");
  assert.strictEqual(l.contentBasis, "DIGESTED");
  assert.strictEqual(l.content, hmac(f, "file", "hello"));
  assert.notStrictEqual(l.content, createHash("sha256").update("hello").digest("hex"), "never the bare sha256 — no oracle on content");
  const big = join(root, "big");
  writeFileSync(big, Buffer.alloc(CONTENT_CAP_BYTES + 1, 7));
  const g = look(big, ctx());
  assert.strictEqual(g.contentBasis, "OVER_CAP");
  assert.strictEqual(g.content, null);
  const exact = join(root, "exact");
  writeFileSync(exact, Buffer.alloc(CONTENT_CAP_BYTES, 7));
  assert.strictEqual(look(exact, ctx()).contentBasis, "DIGESTED");
});

check("SM-6 · a file whose CONTENT is unreadable keeps its lstat facts and reads UNREADABLE", () => {
  if (isRoot) return console.log("    (root — skipped)");
  const f = join(root, "noread");
  writeFileSync(f, "x");
  chmodSync(f, 0o000);
  try {
    const l = look(f, ctx());
    assert.strictEqual(l.state, "PRESENT");
    assert.strictEqual(l.contentBasis, "UNREADABLE");
    assert.strictEqual(l.error, "EACCES");
    assert.strictEqual(l.size, 1);
  } finally {
    chmodSync(f, 0o644);
  }
});

check("SM-7 · a directory digests its sorted entry names, its own state only; over the cap it is not listed", () => {
  const d = join(root, "dir");
  mkdirSync(d);
  writeFileSync(join(d, "b"), "1");
  writeFileSync(join(d, "a"), "1");
  const one = look(d, ctx());
  assert.strictEqual(one.type, "dir");
  assert.strictEqual(one.contentBasis, "DIGESTED");
  writeFileSync(join(d, "a"), "changed inside");
  assert.strictEqual(look(d, ctx()).content, one.content, "an entry's content is not the directory's");
  writeFileSync(join(d, "c"), "1");
  assert.notStrictEqual(look(d, ctx()).content, one.content, "a new entry is");
  const many = join(root, "many");
  mkdirSync(many);
  for (let i = 0; i <= LISTING_CAP_ENTRIES; i++) writeFileSync(join(many, `e${i}`), "");
  assert.strictEqual(look(many, ctx()).contentBasis, "OVER_CAP");
});

check("SM-8 · a symlink as the LAST component is not followed: its own target string is its content", () => {
  const t1 = join(root, "t1");
  writeFileSync(t1, "one");
  const ln = join(root, "ln");
  symlinkSync(t1, ln);
  const l = look(ln, ctx());
  assert.strictEqual(l.type, "symlink");
  assert.strictEqual(l.content, hmac(ln, "symlink", t1));
  writeFileSync(t1, "two");
  assert.strictEqual(look(ln, ctx()).content, l.content, "the link's target changed, the link did not");
  const dangling = join(root, "dangling");
  symlinkSync(join(root, "nowhere"), dangling);
  assert.strictEqual(look(dangling, ctx()).state, "PRESENT");
});

check("SM-9 · a symlink in a DIRECTORY component is refused: INDIRECT_PATH, never the object behind it", () => {
  const real = join(root, "realdir");
  mkdirSync(real);
  writeFileSync(join(real, "f"), "behind a link");
  const via = join(root, "via");
  symlinkSync(real, via);
  const l = look(join(via, "f"), ctx());
  assert.strictEqual(l.state, "UNOBSERVABLE");
  assert.strictEqual(l.error, "INDIRECT_PATH");
  assert.strictEqual(look(join(real, "f"), ctx()).state, "PRESENT", "the same file by its own path is seen");
});

check("SM-10 · a symlink LOOP in a directory component is UNOBSERVABLE (ELOOP), never ABSENT", () => {
  const a = join(root, "loopA");
  const b = join(root, "loopB");
  symlinkSync(b, a);
  symlinkSync(a, b);
  const l = look(join(a, "x"), ctx());
  assert.strictEqual(l.state, "UNOBSERVABLE");
  assert.strictEqual(l.error, "ELOOP");
});

check("SM-11 · the witness's own directories are never targets: SELF", () => {
  const self = join(root, "self");
  mkdirSync(self);
  writeFileSync(join(self, "state.json"), "{}");
  assert.strictEqual(look(join(self, "state.json"), ctx([self])).error, "SELF");
  assert.strictEqual(look(self, ctx([self])).error, "SELF");
  assert.strictEqual(look(join(root, "selfish"), ctx([self])).error, "ENOENT", "a sibling that merely shares the prefix is not SELF");
});

check("SM-12 · a FIFO is 'other': no content is read, and the look does not block", () => {
  const p = join(root, "fifo");
  execFileSync("mkfifo", [p]);
  const l = look(p, ctx());
  assert.strictEqual(l.type, "other");
  assert.strictEqual(l.contentBasis, "NOT_APPLICABLE");
});

// ── the facet map, SINCE THE WITNESS LAST LOOKED, row by row ─────────────────
const P = (o: Partial<Look> = {}): Look => ({
  at: 1, mono: "1", boot: "boot-A", state: "PRESENT", type: "file", mode: 0o100644, uid: 1, gid: 1, size: 5, mtimeMs: 10, ctimeMs: 10,
  content: "c1", contentBasis: "DIGESTED", error: null, ...o,
});
const A: Look = { at: 1, mono: "1", boot: "boot-A", state: "ABSENT", type: null, mode: null, uid: null, gid: null, size: null, mtimeMs: null, ctimeMs: null, content: null, contentBasis: null, error: "ENOENT" };
const U: Look = { ...A, state: "UNOBSERVABLE", error: "EACCES" };

// [name, last look (null = none), now, expected facet]
const rows: [string, Look | null, Look, EffectClass][] = [
  ["no last look", null, P(), "FIRST_SEEN"],
  ["no last look, absent now", null, A, "FIRST_SEEN"],
  ["no last look, the look FAILED (W-1)", null, U, "UNOBSERVABLE"],
  ["last unobservable, now unobservable", U, U, "UNOBSERVABLE"],
  ["last unobservable", U, P(), "UNOBSERVABLE"],
  ["now unobservable", P(), U, "UNOBSERVABLE"],
  ["absent, still absent", A, A, "SAME"],
  ["absent → present", A, P(), "EXISTENCE_DIFFERS"],
  ["present → absent", P(), A, "EXISTENCE_DIFFERS"],
  ["file → dir", P(), P({ type: "dir" }), "TYPE_DIFFERS"],
  ["content differs", P(), P({ content: "c2", size: 6 }), "CONTENT_DIFFERS"],
  ["same content, mode differs", P(), P({ mode: 0o100600 }), "META_DIFFERS"],
  ["same content, owner differs", P(), P({ uid: 2 }), "META_DIFFERS"],
  ["same content, only times", P(), P({ mtimeMs: 11 }), "META_DIFFERS"],
  ["same content, only ctime", P(), P({ ctimeMs: 11 }), "META_DIFFERS"],
  ["all equal", P(), P(), "SAME"],
  ["dir, size differs only", P({ type: "dir", size: 4096 }), P({ type: "dir", size: 8192 }), "SAME"],
  ["over cap both, same size, times moved", P({ contentBasis: "OVER_CAP", content: null }), P({ contentBasis: "OVER_CAP", content: null, mtimeMs: 12 }), "META_DIFFERS"],
  ["over cap both, size differs", P({ contentBasis: "OVER_CAP", content: null }), P({ contentBasis: "OVER_CAP", content: null, size: 9 }), "CONTENT_DIFFERS"],
  ["over cap both, nothing differs", P({ contentBasis: "OVER_CAP", content: null }), P({ contentBasis: "OVER_CAP", content: null }), "UNOBSERVABLE"],
  ["digested → over cap (grew)", P(), P({ contentBasis: "OVER_CAP", content: null, size: CONTENT_CAP_BYTES + 1 }), "CONTENT_DIFFERS"],
  ["unreadable, meta differs", P({ contentBasis: "UNREADABLE", content: null }), P({ contentBasis: "UNREADABLE", content: null, mode: 0 }), "META_DIFFERS"],
  ["unreadable, nothing differs", P({ contentBasis: "UNREADABLE", content: null }), P({ contentBasis: "UNREADABLE", content: null }), "UNOBSERVABLE"],
  ["other, nothing differs", P({ type: "other", contentBasis: "NOT_APPLICABLE", content: null }), P({ type: "other", contentBasis: "NOT_APPLICABLE", content: null }), "SAME"],
];
check(`SM-13 · the facet map, all ${rows.length} rows`, () => {
  for (const [name, last, now, want] of rows) assert.strictEqual(classifyFacet(last, now), want, name);
});

check("SM-14 · the map is TOTAL and never an OUTCOME facet: every combination lands in the vocabulary, never HELD or LATE", () => {
  const states: Look[] = [A, U];
  for (const type of ["file", "dir", "symlink", "other"] as const) {
    for (const contentBasis of ["DIGESTED", "OVER_CAP", "UNREADABLE", "NOT_APPLICABLE"] as const) {
      for (const content of ["c1", "c2", null]) {
        for (const mode of [1, 2]) for (const mtimeMs of [1, 2]) for (const size of [1, 2]) {
          states.push(P({ type, contentBasis, content, mode, mtimeMs, size }));
        }
      }
    }
  }
  let n = 0;
  for (const b of [null, ...states]) for (const a of states) {
    const c = classifyFacet(b, a);
    assert.ok(EFFECT_CLASSES.includes(c));
    assert.ok(!OUTCOME_ONLY_CLASSES.includes(c), "HELD and LATE are the bridge's decision word, never what the look says");
    n++;
  }
  console.log(`    ${n} combinations, all inside the ${EFFECT_CLASSES.length}-facet vocabulary`);
});

check("SM-15 · W-1 (audit 2026-10-11 18:43Z): a look that FAILED reads UNOBSERVABLE whatever the history — never FIRST_SEEN; a look TAKEN with no last look reads FIRST_SEEN", () => {
  for (const a of [A, P()]) assert.strictEqual(classifyFacet(null, a), "FIRST_SEEN", "a look taken, no last look");
  for (const last of [null, A, P(), U]) assert.strictEqual(classifyFacet(last, U), "UNOBSERVABLE", `a failed look after ${last === null ? "no look" : last.state}`);
});

check("SM-16 · a change the witness could not confirm is UNOBSERVABLE, never SAME: present, same type and metadata, content uncomparable", () => {
  // both unreadable, identical lstat: the witness cannot say the content held → UNOBSERVABLE (not SAME)
  assert.strictEqual(classifyFacet(P({ contentBasis: "UNREADABLE", content: null }), P({ contentBasis: "UNREADABLE", content: null })), "UNOBSERVABLE");
  // a digested look vs an unreadable one, same meta: content cannot be confirmed → UNOBSERVABLE
  assert.strictEqual(classifyFacet(P(), P({ contentBasis: "UNREADABLE", content: null })), "UNOBSERVABLE");
});

check("SM-17 · the evidence-free facets are three (FIRST_SEEN, UNOBSERVABLE, LATE); the outcome-only facets are HELD and LATE", () => {
  assert.deepStrictEqual([...EVIDENCE_FREE_CLASSES].sort(), ["FIRST_SEEN", "LATE", "UNOBSERVABLE"]);
  assert.deepStrictEqual([...OUTCOME_ONLY_CLASSES].sort(), ["HELD", "LATE"]);
});

check("SM-18 · a look carries no path: the target never rides in what is written", () => {
  const f = join(root, "a-distinctive-target-name");
  writeFileSync(f, "x");
  assert.ok(!JSON.stringify(look(f, ctx())).includes("a-distinctive-target-name"));
});

check("SM-19 · the BOOK's form re-derives every facet: over every combination, the facet of the public tokens equals the facet of the raw looks", () => {
  const states: Look[] = [A, U];
  for (const type of ["file", "dir", "symlink", "other"] as const) {
    for (const contentBasis of ["DIGESTED", "OVER_CAP", "UNREADABLE", "NOT_APPLICABLE"] as const) {
      for (const content of ["c1", "c2", null]) {
        for (const mode of [1, 2]) for (const mtimeMs of [1, 2]) for (const size of [1, 2]) {
          states.push(P({ type, contentBasis, content, mode, mtimeMs, size }));
        }
      }
    }
  }
  const pub = (l: Look) => publicLook(l, KEY, "/some/target");
  let n = 0;
  for (const b of [null, ...states]) for (const a of states) {
    assert.strictEqual(classifyFacet(b === null ? null : pub(b), pub(a)), classifyFacet(b, a));
    n++;
  }
  console.log(`    ${n} combinations, the public form agrees with the raw form on every one`);
});

check("SM-20 · NO ORACLE ACROSS TARGETS (refuter R2 F2): equal content at two paths gives two unrelated digests; at one path, one", () => {
  const p1 = join(root, "guess-1");
  const p2 = join(root, "guess-2");
  writeFileSync(p1, "same bytes");
  writeFileSync(p2, "same bytes");
  const a = look(p1, ctx());
  const b = look(p2, ctx());
  assert.notStrictEqual(a.content, b.content, "the same content at another path is not comparable");
  assert.strictEqual(look(p1, ctx()).content, a.content, "the same path compares");
  assert.notStrictEqual(boundMac(KEY, p1, "file", "x"), boundMac(KEY, p1, "dir", "x"), "the tag binds too");
});

check("SM-21 · the book's form carries NO raw metadata (refuter R2 F3): mode, owner, times and size only as path-bound tokens", () => {
  const f = join(root, "meta-target");
  writeFileSync(f, "12345");
  const l = look(f, ctx());
  const p = publicLook(l, KEY, f);
  const text = JSON.stringify(p);
  for (const k of ["mode", "uid", "gid", "mtimeMs", "ctimeMs"]) assert.ok(!(k in p), `${k} is in the public form`);
  for (const t of [p.meta, p.times, p.size]) assert.match(String(t), /^[0-9a-f]{64}$/);
  assert.ok(!text.includes(String(l.mtimeMs)) && !text.includes(`"size":5`), "no raw value rides along");
  assert.strictEqual(p.size, hmac(f, "size", "5"));
  assert.notStrictEqual(publicLook(l, KEY, f + "-other").meta, p.meta, "tokens bind to the path");
});

check("SM-22 · a DIRECTORY COMPONENT swapped for a link mid-look cannot hand the witness another object: the held parent is read (refuter R2-bytes F1)", () => {
  const real = join(root, "pin-real");
  const decoy = join(root, "pin-decoy");
  mkdirSync(real);
  mkdirSync(decoy);
  writeFileSync(join(real, "t"), "the real one");
  writeFileSync(join(decoy, "t"), "a decoy copy");
  const honest = look(join(real, "t"), ctx()).content;
  const moved = join(root, "pin-real-moved");
  const l = look(join(real, "t"), ctx([], once("after-parent", () => {
    renameSync(real, moved);
    symlinkSync(decoy, real);
  })));
  assert.strictEqual(l.state, "PRESENT");
  assert.strictEqual(l.content, honest, "the object the path named when the look began, never the decoy");
  assert.strictEqual(look(join(real, "t"), ctx()).error, "INDIRECT_PATH", "and the next look sees the link");
});

check("SM-23 · the TARGET directory swapped for a link while listed: SWAPPED, never the other directory's listing", () => {
  const d = join(root, "list-real");
  const other = join(root, "list-other");
  mkdirSync(d);
  mkdirSync(other);
  writeFileSync(join(other, "x"), "");
  const l = look(d, ctx([], once("after-open", () => {
    renameSync(d, join(root, "list-real-moved"));
    symlinkSync(other, d);
  })));
  assert.strictEqual(l.state, "UNOBSERVABLE");
  assert.strictEqual(l.error, "SWAPPED");
});

check("SM-24 · a same-size rewrite between the two reads is MOVING, even inside one timestamp tick (refuter R2-bytes F8)", () => {
  const f = join(root, "rewritten");
  writeFileSync(f, "AAAA");
  const l = look(f, ctx([], once("after-first-read", () => writeFileSync(f, "BBBB"))));
  assert.strictEqual(l.state, "UNOBSERVABLE");
  assert.strictEqual(l.error, "MOVING");
});

check("SM-25 · a file gone between lstat and open is SWAPPED (UNOBSERVABLE), never PRESENT-and-unreadable (refuter R2-bytes F7)", () => {
  const f = join(root, "gone-mid-look");
  writeFileSync(f, "x");
  const l = look(f, ctx([], once("after-lstat", () => unlinkSync(f))));
  assert.strictEqual(l.state, "UNOBSERVABLE");
  assert.strictEqual(l.error, "SWAPPED");
});

check("SM-26 · a file replaced by another between lstat and open is SWAPPED (another inode)", () => {
  const f = join(root, "replaced-mid-look");
  writeFileSync(f, "first");
  const l = look(f, ctx([], once("after-lstat", () => {
    renameSync(f, f + ".old");
    writeFileSync(f, "second");
  })));
  assert.strictEqual(l.error, "SWAPPED");
});

check("SM-27 · a DANGLING link in a directory component is INDIRECT_PATH, never ABSENT (refuter R2-bytes F6)", () => {
  const dangling = join(root, "dangling-dir");
  symlinkSync(join(root, "no-such-dir"), dangling);
  const l = look(join(dangling, "x"), ctx());
  assert.strictEqual(l.state, "UNOBSERVABLE");
  assert.strictEqual(l.error, "INDIRECT_PATH");
  assert.strictEqual(look(join(root, "no-such-dir", "x"), ctx()).state, "ABSENT", "a plainly missing directory is ABSENT");
});

rmSync(root, { recursive: true, force: true });
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
