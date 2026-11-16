// ── MICA · the code-vintage label — tests ────────────────────────────────────
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node src/deploy/vintage.test.ts
//
// WHAT THIS FENCES. `vintage.ts` sits on the STARTUP PATH of every daemon in
// this tree in order to print one label. The load-bearing property is therefore
// not what it says when it works — it is that it cannot stop a daemon, for any
// filesystem state, for any file content. Most of what follows is that.

import assert from "assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  defaultTreeRoot,
  readVintage,
  VINTAGE_FILENAME,
  VINTAGE_MAX,
  vintageBannerText,
  vintageText,
} from "./vintage";

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

const root = mkdtempSync(join(tmpdir(), "mica-vintage-"));
let n = 0;
function treeWith(content: string | null): string {
  const dir = join(root, `case-${String(n++)}`);
  mkdirSync(dir, { recursive: true });
  if (content !== null) writeFileSync(join(dir, VINTAGE_FILENAME), content, "utf8");
  return dir;
}

console.log("\n── the vintage label ────────────────────────────────────────");

check("V-A · READ — the claim is copied verbatim and the line says whose claim it is", () => {
  const dir = treeWith("9244ded\n");
  const reading = readVintage(dir);
  assert.strictEqual(reading.state, "READ");
  assert.strictEqual(reading.commit, "9244ded");
  assert.strictEqual(reading.detail, null);
  assert.strictEqual(reading.path, join(dir, "VINTAGE"));

  const text = vintageText(reading);
  assert.match(text, /^9244ded /);
  // THE LABELLING IS THE POINT, not the hash. A vintage line that read like a
  // measurement would be a worse lie than no line: it would make the four-day
  // stale run of S105 §2.1 look like it had been checked.
  assert.match(text, /a CLAIM written by the relay/);
  assert.match(text, /not a measurement of this process/);
  assert.match(text, /read at THIS process's startup/);
});

check("V-B · ABSENT — no file, and the line refuses to guess", () => {
  const dir = treeWith(null);
  const reading = readVintage(dir);
  assert.strictEqual(reading.state, "ABSENT");
  assert.strictEqual(reading.commit, null);
  const text = vintageText(reading);
  assert.match(text, /^UNKNOWN — no VINTAGE file at /);
  assert.match(text, /Nothing here guesses/);
  assert.match(text, /a dev tree's HEAD is not this tree's vintage/);
});

check("V-C · UNREADABLE — an errno that is not ENOENT is a DIFFERENT finding", () => {
  // S104's rule, one surface further out: "gone" is not "I could not look". A
  // permission fault means something may be sitting there unread.
  const dir = treeWith(null);
  const reading = readVintage(dir, () => {
    throw new Error("EACCES: permission denied, open 'VINTAGE'");
  });
  assert.strictEqual(reading.state, "UNREADABLE");
  assert.match(String(reading.detail), /EACCES/);
  const text = vintageText(reading);
  assert.match(text, /could not be READ/);
  assert.match(text, /not the same finding as absent/);
  assert.match(text, /something may be sitting there/);
});

check("V-D · PRESENT_UNUSABLE — the FOURTH state the brief did not ask for", () => {
  // S106b §1 ruled three states. A truncated relay write produces a file that
  // exists, opens, reads, and says nothing — which is neither ABSENT (the relay
  // never ran) nor UNREADABLE (go look at permissions). Both would send an
  // operator the wrong way, and the file is right there to be looked at.
  for (const [content, expect] of [
    ["", /first line is empty/],
    ["\n", /first line is empty/],
    ["   \n", /first line is empty/],
    ["9244ded and some prose\n", /one bare token/],
    ["9244ded\tdirty\n", /one bare token/],
    [`${"a".repeat(VINTAGE_MAX + 1)}\n`, /past the 200 allowed/],
  ] as const) {
    const dir = treeWith(content);
    const reading = readVintage(dir);
    assert.strictEqual(
      reading.state,
      "PRESENT_UNUSABLE",
      `content ${JSON.stringify(content)} should be unusable`
    );
    assert.strictEqual(reading.commit, null);
    assert.match(String(reading.detail), expect);
    assert.match(vintageText(reading), /Present, not missing, and not unreadable/);
  }
});

check("V-E · the content is FRAMED and never judged — a tag, a long hash, a -dirty suffix", () => {
  // Same discipline the intake applies to `chain_id`: the shape is channel
  // framing; what the value MEANS is the relay's business. A reader that
  // demanded 7 hex characters would refuse an honest `v0.1-3-g9244ded`.
  for (const claim of [
    "9244ded",
    "9244ded1f0a4c2e5b7d9083a1c6e4f28b0d5a917",
    "9244ded-dirty",
    "v0.1-3-g9244ded",
    "not-a-hash-at-all",
  ]) {
    const dir = treeWith(`${claim}\n`);
    const reading = readVintage(dir);
    assert.strictEqual(reading.state, "READ", claim);
    assert.strictEqual(reading.commit, claim, "the claim must be copied verbatim");
  }
});

check("V-F · only the FIRST line is taken, and a trailing newline is not content", () => {
  const dir = treeWith("9244ded\nand a second line nobody asked for\n");
  const reading = readVintage(dir);
  assert.strictEqual(reading.state, "READ");
  assert.strictEqual(reading.commit, "9244ded");
});

check("V-G · IT CANNOT THROW — that is the load-bearing property, not the label", () => {
  // A label on the startup path of three daemons must never be able to stop
  // one. Every hostile shape a reader could hand back, including things that
  // are not Errors at all.
  const dir = treeWith(null);
  const hostile: readonly (() => string)[] = [
    () => {
      throw new Error("ENOENT: no such file or directory");
    },
    () => {
      throw new Error("EACCES");
    },
    () => {
      // eslint-disable-next-line no-throw-literal
      throw "a bare string, not an Error";
    },
    () => {
      throw { weird: "object with no message" } as unknown as Error;
    },
    () => {
      throw null as unknown as Error;
    },
  ];
  for (const read of hostile) {
    assert.doesNotThrow(() => readVintage(dir, read));
    const reading = readVintage(dir, read);
    assert.ok(
      reading.state === "ABSENT" || reading.state === "UNREADABLE",
      `a throwing reader must land in ABSENT or UNREADABLE, got ${reading.state}`
    );
    assert.doesNotThrow(() => vintageText(reading));
  }
  // And the outermost guarantee, over a root that cannot exist.
  assert.doesNotThrow(() => vintageBannerText("/this/path/does/not/exist/anywhere"));
  assert.match(vintageBannerText("/this/path/does/not/exist/anywhere"), /^UNKNOWN — /);
});

check("V-H · EVERY not-READ branch starts with the same word", () => {
  // A reader scanning three journals must not have to tell four kinds of
  // silence apart by their punctuation.
  const dirs = [
    readVintage(treeWith(null)),
    readVintage(treeWith("")),
    readVintage(treeWith(null), () => {
      throw new Error("EACCES");
    }),
  ];
  for (const reading of dirs) {
    assert.notStrictEqual(reading.state, "READ");
    assert.match(vintageText(reading), /^UNKNOWN — /);
  }
  // …and the READ branch does NOT, so a grep for UNKNOWN finds exactly the
  // states where the vintage is not known.
  assert.doesNotMatch(vintageText(readVintage(treeWith("abc\n"))), /^UNKNOWN/);
});

check("V-I · the root is THIS MODULE'S tree, not the caller's cwd", () => {
  // Derived from `__dirname`, so a caller cannot point it at another tree by
  // mistake and it is right by construction: the process is executing the tree
  // this module came out of.
  const derived = defaultTreeRoot();
  assert.ok(
    existsSync(join(derived, "package.json")),
    `defaultTreeRoot() must land on the tree root, got ${derived}`
  );
  const pkg = JSON.parse(readFileSync(join(derived, "package.json"), "utf8")) as {
    name: string;
  };
  assert.strictEqual(pkg.name, "mica-machine");
  // And the file it would read is at the root, not beside this module.
  assert.strictEqual(readVintage().path, join(derived, VINTAGE_FILENAME));
});

check("V-J · a stray VINTAGE in the dev tree can never be committed", () => {
  // A committed VINTAGE would be rsynced with the code and would then claim,
  // from inside /opt, a hash that is not what was laid. A stale claim is worse
  // than no claim, and the ABSENT branch is the honest default.
  const ignore = readFileSync(join(defaultTreeRoot(), ".gitignore"), "utf8");
  assert.match(ignore, /^\/VINTAGE$/m);
});

rmSync(root, { recursive: true, force: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
