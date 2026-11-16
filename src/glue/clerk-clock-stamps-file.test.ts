// ── GLUE · the clerk-clock-stamps reader — tests ─────────────────────────────
//
// House style: standalone ts-node script, custom check() harness, no framework.
//   npx ts-node src/glue/clerk-clock-stamps-file.test.ts
//
// The custody door here is structurally identical to probe-door.ts's, already
// proven case-by-case in probe-door.test.ts (including why most of that file
// runs without root, and what is and is not simulated). This file does NOT
// re-walk all nine door refusals — it proves the door is WIRED (one refusal
// case each for FILE_ABSENT / CUSTODY_REFUSED / FILE_UNREADABLE-class) and
// spends its real weight on what is NEW here: the content parse, which
// probe-door.ts's own suite does not have (a probeSource file is left
// unvalidated at this layer; a clerk-clock-stamps file is not).

import * as assert from "assert";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  admitClockStampsSource,
  censusOfStampWriters,
  CLOCK_STAMPS_OWNER,
  describeClockStampsRead,
  formatStampWriters,
  readClockStampsFile,
  stampFor,
  toClockStamp,
} from "./clerk-clock-stamps-file";
import { UNATTRIBUTED_STAMP_WRITER, assessSig } from "../mica/sig";
import type { SigConfig } from "../mica/sig";
import { MicaFixtureLog } from "../mica/fixture-log";
import type { ClockDoorRefused, ClockDoorResult } from "./clerk-clock-stamps-file";

let passed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const root = mkdtempSync(join(tmpdir(), "mica-clock-door-"));
const ME = process.getuid ? process.getuid() : 1000;
const OWNER = 5151; // stand-in for the "mica" uid
const resolveOwner = (name: string): number | null =>
  name === CLOCK_STAMPS_OWNER ? OWNER : null;

function refused(r: ClockDoorResult): ClockDoorRefused {
  assert.strictEqual(r.admitted, false, "expected a refusal");
  return r as ClockDoorRefused;
}

function fileIn(dirName: string, content: string, mode: number, dirMode = 0o755): string {
  const dir = join(root, dirName);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "stamps.jsonl");
  writeFileSync(p, content);
  chmodSync(p, mode);
  chmodSync(dir, dirMode);
  return p;
}

const GOOD_STAMP = {
  sequenceNumber: 7,
  clerk_seq: 3,
  clerk_time: { wall_ms: 1000, monotonic_ns: "12345" },
  separation: "SEPARATE_PROCESS",
  intake: "SOCKET",
  clerk_id: "clerk-abc",
  clerk_boot_id: "boot-1",
};

console.log("\n── the door: wired (not re-proving every case; see probe-door.test.ts) ──");

check("FILE_ABSENT — S108-C grammar: no writer has produced a stamp yet", () => {
  const r = refused(
    admitClockStampsSource(join(root, "nope", "stamps.jsonl"), { uid: ME, resolveOwner })
  );
  assert.strictEqual(r.refusal, "NOT_FOUND");
  const read = readClockStampsFile(join(root, "nope", "stamps.jsonl"), { uid: ME, resolveOwner });
  assert.strictEqual(read.loadState, "FILE_ABSENT");
  assert.strictEqual(read.stamps.length, 0);
});

check("CUSTODY_REFUSED — wrong owner maps to a named, non-content refusal", () => {
  const p = fileIn("wrongowner", "[]", 0o644);
  const read = readClockStampsFile(p, { uid: ME, resolveOwner });
  assert.strictEqual(read.loadState, "CUSTODY_REFUSED");
  assert.strictEqual(read.doorRefusal?.refusal, "WRONG_OWNER");
});

check("FILE_UNREADABLE — root is refused rather than waved through", () => {
  const p = fileIn("asroot", "[]", 0o644);
  const read = readClockStampsFile(p, { uid: 0, resolveOwner });
  assert.strictEqual(read.loadState, "CUSTODY_REFUSED");
  assert.strictEqual(read.doorRefusal?.refusal, "INVOKER_IS_ROOT");
});

console.log("\n── content: refused, not repaired ──");

check("LOADED — one well-shaped stamp per line, admitted through the door", () => {
  const p = fileIn("good", JSON.stringify(GOOD_STAMP) + "\n", 0o444, 0o555);
  const read = readClockStampsFile(p, { uid: ME, resolveOwner: () => ME });
  assert.strictEqual(read.loadState, "LOADED");
  assert.strictEqual(read.stamps.length, 1);
  // S134 Ra: the fixture carries no moduleId, so the parse fills the sentinel.
  assert.deepStrictEqual(read.stamps[0], { moduleId: UNATTRIBUTED_STAMP_WRITER, ...GOOD_STAMP });
  assert.ok(read.provenance?.includes(CLOCK_STAMPS_OWNER));
});

check("blank lines are skipped, not counted as stamps or as malformed", () => {
  const content = JSON.stringify(GOOD_STAMP) + "\n\n" + JSON.stringify(GOOD_STAMP) + "\n";
  const p = fileIn("blanklines", content, 0o444, 0o555);
  const read = readClockStampsFile(p, { uid: ME, resolveOwner: () => ME });
  assert.strictEqual(read.loadState, "LOADED");
  assert.strictEqual(read.stamps.length, 2);
});

check("FILE_MALFORMED — a line that is not valid JSON is refused, not skipped", () => {
  const p = fileIn("badjson", JSON.stringify(GOOD_STAMP) + "\n{not json\n", 0o444, 0o555);
  const read = readClockStampsFile(p, { uid: ME, resolveOwner: () => ME });
  assert.strictEqual(read.loadState, "FILE_MALFORMED");
  assert.strictEqual(read.stamps.length, 0, "refuse to repair: NOTHING is returned, not the good line alone");
  assert.strictEqual(read.problem?.line, 2);
});

check("FILE_MALFORMED — wrong-shape input (a real object missing declared fields)", () => {
  const wrongShape = { sequenceNumber: 1, clerk_seq: 1 }; // missing clerk_time etc.
  const p = fileIn("wrongshape", JSON.stringify(wrongShape) + "\n", 0o444, 0o555);
  const read = readClockStampsFile(p, { uid: ME, resolveOwner: () => ME });
  assert.strictEqual(read.loadState, "FILE_MALFORMED");
  assert.ok(read.problem?.detail.includes("clerk_time"));
});

check("FILE_MALFORMED — separation outside the two declared values is refused", () => {
  const bad = { ...GOOD_STAMP, separation: "MAYBE_SEPARATE" };
  const p = fileIn("badseparation", JSON.stringify(bad) + "\n", 0o444, 0o555);
  const read = readClockStampsFile(p, { uid: ME, resolveOwner: () => ME });
  assert.strictEqual(read.loadState, "FILE_MALFORMED");
});

check("FILE_EMPTY_OR_ERASED — admitted, readable, zero stamps", () => {
  const p = fileIn("empty", "", 0o444, 0o555);
  const read = readClockStampsFile(p, { uid: ME, resolveOwner: () => ME });
  assert.strictEqual(read.loadState, "FILE_EMPTY_OR_ERASED");
  assert.strictEqual(read.stamps.length, 0);
});

check("toClockStamp — direct unit check, first failing field named", () => {
  assert.strictEqual(toClockStamp(null), "line is not a JSON object");
  assert.strictEqual(toClockStamp({}), "sequenceNumber is not a finite number");
  assert.strictEqual(
    toClockStamp({ ...GOOD_STAMP, clerk_boot_id: "" }),
    "clerk_boot_id is not a non-empty string"
  );
  assert.deepStrictEqual(toClockStamp(GOOD_STAMP), { moduleId: UNATTRIBUTED_STAMP_WRITER, ...GOOD_STAMP });
});

// Teardown: several fixtures deliberately left their directory unwritable
// (0o555, so PARENT_REPLACEABLE-adjacent cases stay real); modes come back
// before the tree can be removed.
for (const d of readdirSync(root)) {
  try {
    chmodSync(join(root, d), 0o755);
  } catch {
    // Already writable, or gone. Neither is a finding.
  }
}
rmSync(root, { recursive: true, force: true });

// ── S134 Ra · THE WRITER, OR THE ADMISSION THAT THIS FILE CANNOT SAY ─────────
console.log("\n── Ra: the writer a stamp names, and the one a legacy line cannot ──");

check("a legacy line (no moduleId) reads UNATTRIBUTED — never a principal's name", () => {
  // THE DEFECT THIS CLOSES, at bytes on the box 2026-09-17: nineteen stamps,
  // none carrying a writer, THREE of them `sequenceNumber: 0` — so three
  // distinct writers, matching the three principals on mica-log.jsonl's ACL.
  // The S134 brief's first draft would have read all nineteen as
  // `mica-registrar` via LEGACY_CURSOR_MODULE_ID: nine misnamed, including the
  // arbiter's seven. Ra: say UNATTRIBUTED and mean it.
  const stamp = toClockStamp(GOOD_STAMP);
  assert.ok(typeof stamp !== "string", String(stamp));
  assert.strictEqual((stamp as { moduleId: string }).moduleId, UNATTRIBUTED_STAMP_WRITER);
});

check("a line that WRITES the sentinel is malformed, not unattributed", () => {
  // An absent moduleId is an honest gap. A moduleId that says "UNATTRIBUTED" is
  // a writer claiming the one value reserved for "no writer was recorded".
  const r = toClockStamp({ ...GOOD_STAMP, moduleId: UNATTRIBUTED_STAMP_WRITER });
  assert.strictEqual(typeof r, "string");
  assert.ok((r as string).includes("reserved sentinel"), r as string);
});

check("moduleId present and not a non-empty string is refused, not defaulted", () => {
  for (const bad of ["", 7, null, {}]) {
    const r = toClockStamp({ ...GOOD_STAMP, moduleId: bad });
    assert.strictEqual(typeof r, "string", JSON.stringify(bad));
  }
});

check("2 legacy + 1 new-shape prints `2 UNATTRIBUTED / 1 mica-arbiter` (brief §1.1)", () => {
  const p = fileIn("ra-census", [
    JSON.stringify(GOOD_STAMP),
    JSON.stringify({ ...GOOD_STAMP, sequenceNumber: 8 }),
    JSON.stringify({ ...GOOD_STAMP, moduleId: "mica-arbiter", sequenceNumber: 1 }),
  ].join("\n") + "\n", 0o444, 0o555);
  const r = readClockStampsFile(p, { uid: ME, resolveOwner: () => ME });
  assert.strictEqual(r.loadState, "LOADED");
  assert.strictEqual(r.stamps.length, 3);
  assert.strictEqual(formatStampWriters(r.stamps), `2 ${UNATTRIBUTED_STAMP_WRITER} / 1 mica-arbiter`);
  assert.deepStrictEqual([...censusOfStampWriters(r.stamps)], [
    { moduleId: UNATTRIBUTED_STAMP_WRITER, count: 2 },
    { moduleId: "mica-arbiter", count: 1 },
  ]);
  // The boundary is PRINTED by the reader, not remembered by the operator (Ra).
  assert.ok(describeClockStampsRead(r).includes(`writers=2 ${UNATTRIBUTED_STAMP_WRITER} / 1 mica-arbiter`));
});

check("STAMPED needs BOTH the writer and the number — a legacy line joins to nobody", () => {
  // The false positive Ra exists to stop. `sequenceNumber: 1` appears on an
  // UNATTRIBUTED line and on the arbiter's; before Ra a reader matching on the
  // number alone would have called the first one the arbiter's stamp.
  const p = fileIn("ra-join", [
    JSON.stringify({ ...GOOD_STAMP, sequenceNumber: 1 }),
    JSON.stringify({ ...GOOD_STAMP, moduleId: "mica-arbiter", sequenceNumber: 1, clerk_seq: 70 }),
  ].join("\n") + "\n", 0o444, 0o555);
  const r = readClockStampsFile(p, { uid: ME, resolveOwner: () => ME });
  const hit = stampFor(r.stamps, "mica-arbiter", 1);
  assert.ok(hit !== null);
  assert.strictEqual((hit as { clerk_seq: number }).clerk_seq, 70);
  // The legacy line is reachable by NO writer name, including the sentinel.
  assert.strictEqual(stampFor(r.stamps, UNATTRIBUTED_STAMP_WRITER, 1), null);
  assert.strictEqual(stampFor(r.stamps, "mica-registrar", 1), null);
});


// ══ THE PRODUCTION-LOADER PATH · a REAL stamps line, through this loader, into F3
//
// ⛔ THE DEFECT THIS SECTION EXISTS FOR, MEASURED LIVE 2026-09-29T23:26Z.
//    `toClockStamp` built a ClerkClockStamp field by field and DID NOT CARRY
//    `chainIdentity`. The carrier had written 1244 stamps and every one of them
//    named its chain; F3 refused ALL 1244, because under T8 a stamp that does
//    not name its chain is refused — and by the time F3 saw them, none of them
//    did. Sig read CANNOT_ASSESS on a record whose stamps were correct on disk.
//
//    NOTHING CAUGHT IT AND THE REASON IS WORTH KNOWING. Every existing F3 test
//    hand-builds its stamps as object literals and hands them straight to
//    `assessSig`. Every existing loader test asserts the loader's own output
//    shape. Both suites were green. THE SEAM BETWEEN THEM WAS TESTED BY NOBODY,
//    and the field that fell through is the one T8 made mandatory.
//
//    `ClerkClockStamp.chainIdentity` is OPTIONAL by deliberate design — its own
//    comment says "the `?` on this field is the wire shape, not the rule",
//    because a stamp from an older carrier must be READABLE in order to be
//    REFUSED with a reason. That is right, and it is also why `tsc` said
//    nothing: an object literal that omits an optional property typechecks.
//    A compiler cannot defend a rule the type does not state.
//
// THE STANDING RULE THIS ESTABLISHES (the arbiter, board §1b 2026-09-30 01:3xZ):
//    EVERY READER TEST INCLUDES ONE PRODUCTION-LOADER PATH. A reader suite that
//    only ever sees hand-built inputs is testing the reader against a fixture
//    the box cannot produce.
//
// THE FIXTURE IS REAL BYTES. The two lines below were copied verbatim out of
// /var/lib/mica/clerk-subject/stamps.jsonl on 2026-09-29, written by the live
// carrier (clerk-0d819e1149aeda39) for the live chain
// f0ee1315f8abf440f0fee7e0ceb4e6f1df8df1123d32fc9075da974bc9471342. They are
// not modelled on the carrier's output; they ARE the carrier's output.

// ⛔ DERIVED FROM THE FIXTURE, NOT PINNED BESIDE IT. Ruled by the audit
//    2026-10-04 12:39Z after EV-FIX-H3 named this file: the chain identity is a
//    FACT ABOUT THE BYTES below, so it is read out of them. Pinning it as a
//    second literal meant two places could disagree about one chain, and the one
//    that would have been believed is the constant.
//
// ⚠ THE FOUR REMAINING 64-HEX RUNS IN THIS FILE ARE FIXTURE DATA, NOT PINS: three
//   are inside the verbatim carrier lines (which ARE the carrier's output and
//   cannot be edited without ceasing to be) and one is in the comment naming the
//   chain. EV-FIX-H3's regex is repo-wide while its caption is about probe and
//   evidence tests, so it still reports this file. Measured, and put to §1.
// THE FIRST THREE STAMPS OF THE LIVE CHAIN, in order, positions 0-1-2. Position
// 0's writer is MICA/SubjectLog because position 0 IS the chain's own boundary
// record and the chain speaks in its own voice there; 1 and 2 are the subject's.
// TAKING THE CHAIN FROM ITS START IS NOT DECORATION: F3 refuses a scope whose
// lower positions are unstamped (CARRIER_SKIPPED), so a fixture beginning at
// seq 1 tests a SKIP, not a JOIN. The first draft of this test did exactly that
// and F3 was right to refuse it.
const REAL_LINES: readonly string[] = [
  '{"moduleId":"MICA/SubjectLog","chainIdentity":"f0ee1315f8abf440f0fee7e0ceb4e6f1df8df1123d32fc9075da974bc9471342","sequenceNumber":0,"clerk_seq":2693,"clerk_time":{"wall_ms":1790723850918,"monotonic_ns":"358783943609722"},"separation":"SEPARATE_PROCESS","intake":"SOCKET","clerk_id":"clerk-0d819e1149aeda39","clerk_boot_id":"59ec8dff-f8e1-41d0-af3d-bfd96e981cf1"}',
  '{"moduleId":"housekeeper","chainIdentity":"f0ee1315f8abf440f0fee7e0ceb4e6f1df8df1123d32fc9075da974bc9471342","sequenceNumber":1,"clerk_seq":2694,"clerk_time":{"wall_ms":1790723850941,"monotonic_ns":"358783967070006"},"separation":"SEPARATE_PROCESS","intake":"SOCKET","clerk_id":"clerk-0d819e1149aeda39","clerk_boot_id":"59ec8dff-f8e1-41d0-af3d-bfd96e981cf1"}',
  '{"moduleId":"housekeeper","chainIdentity":"f0ee1315f8abf440f0fee7e0ceb4e6f1df8df1123d32fc9075da974bc9471342","sequenceNumber":2,"clerk_seq":2695,"clerk_time":{"wall_ms":1790723850949,"monotonic_ns":"358783974444582"},"separation":"SEPARATE_PROCESS","intake":"SOCKET","clerk_id":"clerk-0d819e1149aeda39","clerk_boot_id":"59ec8dff-f8e1-41d0-af3d-bfd96e981cf1"}',
];

/** The chain those bytes name, read out of them. One chain, one source. */
const REAL_CHAIN: string = (() => {
  const first = JSON.parse(REAL_LINES[0]) as { chainIdentity?: unknown };
  const id = first.chainIdentity;
  if (typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id)) {
    throw new Error(`the fixture's first line carries no chain identity: ${String(id)}`);
  }
  // ⚠ AND EVERY LINE MUST NAME THE SAME CHAIN, or the fixture is two chains
  //   pretending to be one and F3 would be right to refuse the scope.
  for (const line of REAL_LINES) {
    const got = (JSON.parse(line) as { chainIdentity?: unknown }).chainIdentity;
    if (got !== id) throw new Error(`fixture lines name two chains: ${String(got)} vs ${id}`);
  }
  return id;
})();

/** A log whose records carry the sequence numbers those real stamps name. */
function logForRealStamps(name: string): MicaFixtureLog {
  const lp = join(root, `${name}-log.jsonl`);
  const w = new MicaFixtureLog({ path: lp });
  // sequenceNumber is assigned by the store in append order FROM 0, and each
  // record's moduleId must be the writer the matching real stamp names — F3
  // checks writer identity per position (T6/T7), so a fixture that put the
  // subject at position 0 would test a mismatch rather than a join.
  w.append({ timestamp: 1_000, moduleId: "MICA/SubjectLog", eventType: "a", outcome: "ok" });
  w.append({ timestamp: 2_000, moduleId: "housekeeper", eventType: "a", outcome: "ok" });
  w.append({ timestamp: 3_000, moduleId: "housekeeper", eventType: "b", outcome: "ok" });
  return new MicaFixtureLog({ path: lp });
}

const realSigBase: SigConfig = {
  readableLoadStates: ["LOADED_VERIFIED"],
  clockToleranceMs: 0,
  preconditionMap: { b: ["a"] },
  expectedChainIdentity: REAL_CHAIN,
};

check("SEAM · the loader carries chainIdentity out of a REAL line — verbatim, not normalised", () => {
  const p = fileIn("real-chain", REAL_LINES.join("\n") + "\n", 0o444, 0o555);
  const read = readClockStampsFile(p, { uid: ME, resolveOwner: () => ME });
  assert.strictEqual(read.loadState, "LOADED");
  assert.strictEqual(read.stamps.length, 3);
  for (const st of read.stamps) {
    assert.strictEqual(
      (st as { chainIdentity?: unknown }).chainIdentity,
      REAL_CHAIN,
      "the loader dropped chainIdentity — this is the live defect of 2026-09-29"
    );
  }
});

check("⛔ SEAM · THE ONE THAT MATTERS: a REAL line through the loader JOINS in F3", () => {
  // Loader -> reader, with nothing hand-built in between. This is the assertion
  // whose absence cost 1244 refused stamps on a live box.
  const p = fileIn("real-join", REAL_LINES.join("\n") + "\n", 0o444, 0o555);
  const read = readClockStampsFile(p, { uid: ME, resolveOwner: () => ME });
  assert.strictEqual(read.loadState, "LOADED");

  const sig = assessSig(logForRealStamps("real-join"), {
    ...realSigBase,
    clerkClockSource: read.stamps,
  });
  const f3 = sig.flags[2];
  assert.notStrictEqual(f3.kind, "NOT_CONFIGURED", "the source was injected");
  assert.notStrictEqual(
    f3.kind,
    "CANNOT_ASSESS",
    `F3 must JOIN a real carrier stamp, not refuse it: ${JSON.stringify(f3.blindPaths ?? f3).slice(0, 400)}`
  );
  const used = (sig as { f3Deviation?: { pairsCompared?: number } }).f3Deviation;
  assert.ok(
    used !== undefined && used !== null,
    "a joined F3 must report its deviation object, not null"
  );
});

check("SEAM · NEGATIVE CONTROL — the SAME real line with chainIdentity removed is REFUSED", () => {
  // The positive control above is only worth something beside this one: if F3
  // accepted both, the join would be proving nothing about T8.
  const stripped = REAL_LINES.map((l) => {
    const o = JSON.parse(l) as Record<string, unknown>;
    delete o.chainIdentity;
    return JSON.stringify(o);
  });
  const p = fileIn("real-stripped", stripped.join("\n") + "\n", 0o444, 0o555);
  const read = readClockStampsFile(p, { uid: ME, resolveOwner: () => ME });
  assert.strictEqual(read.loadState, "LOADED");
  for (const st of read.stamps) {
    assert.strictEqual(
      "chainIdentity" in (st as object),
      false,
      "an older carrier's stamp must arrive with NO such key, so F3's 'absent' arm is the one that fires"
    );
  }
  const sig = assessSig(logForRealStamps("real-stripped"), {
    ...realSigBase,
    clerkClockSource: read.stamps,
  });
  assert.strictEqual(
    sig.flags[2].kind,
    "CANNOT_ASSESS",
    "a stamp that does not name its chain must be REFUSED under T8"
  );
});

check("SEAM · a chainIdentity that is present and not a non-empty string is a MALFORMED LINE", () => {
  // Refused HERE, at the byte offset, rather than surfacing later as an
  // unexplained F3 refusal — the same arm `moduleId` already has.
  for (const bad of [123, "", null, {}, []]) {
    const o = JSON.parse(REAL_LINES[0]) as Record<string, unknown>;
    o.chainIdentity = bad;
    const r = toClockStamp(o);
    assert.strictEqual(
      typeof r,
      "string",
      `chainIdentity ${JSON.stringify(bad)} must be refused by the shaper`
    );
    assert.ok(
      (r as string).includes("chainIdentity"),
      `the refusal must name the field: ${String(r)}`
    );
  }
});

console.log(`\n${passed} passed.\n`);
