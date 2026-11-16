// ── MICA · Gate 1 envelope recorder — tests ──────────────────────────────────
//
// What is pinned here: the recorder COUNTS derived labels per declared category
// and states the envelope given M; it NEVER yields SILENT and NEVER yields
// ALARM; every malformed or hostile input blinds with its own code and never
// throws; and every surface prints every ceiling. Round 2 (placement D): the
// labels live in the bridge's INTEREST BOOK under a frame-scoped class, so a
// label-class record that is neither a category nor the underived word is
// UNRECOGNISED — a writer or book defect, printed as one. The predecessor's arms —
// shares, exclusion, concentration, dosimeter slopes — are removed with the
// legs they tested (accepted at Stop 1: they read reach as weight).

import { createHash } from "crypto";
import assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";
import { Chokepoint } from "../chokepoint";
import { ENG_SENSOR_ID } from "../eng";
import { MicaFixtureLog } from "../fixture-log";
import type { MicaFixtureInput } from "../fixture-log";
import type { MicaLogRecord, MicaReadableLog } from "../log";
import { NARROW_K_SENSOR_ID } from "../narrow-k";
import { NARROW_R_SENSOR_ID } from "../narrow-r";
import { NARROW_T_SENSOR_ID } from "../narrow-t";
import { NARROW_W_SENSOR_ID } from "../narrow-w";
import { SIG_SENSOR_ID } from "../sig";
import { silent } from "../types";
import type { CannotAssessVerdict, SensorVerdict } from "../types";
import * as gate1 from "./index";
import {
  assessGate1Scope,
  GATE1_LEG_B_SENTENCE,
  GATE1_SCOPE_CEILING_LINES,
  GATE1_SCOPE_CEILINGS,
  GATE1_SCOPE_COMPETENCE_LINES,
  GATE1_SCOPE_DOES_NOT_SEE,
  GATE1_SCOPE_READS,
  GATE1_SCOPE_SENSOR_ID,
  GATE1_THREW_UNRENDERED,
  gate1ScopeBlockText,
  GIVEN_M_FRAME,
} from "./index";
import type { Gate1ScopeConfig, Gate1ScopeFrame, Gate1ScopeResult } from "./index";

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

// ── Fixtures (no subject literal: subject-a / subject-b / tool-x) ────────────

const SUBJECT = "subject-a";
const OTHER_SUBJECT = "subject-b";
const LABEL_KIND = "TOOL_ATTEMPTED";
const UNDERIVED = "UNDERIVED";
// A label-class outcome the bridge never writes into the book: the tool class's
// word, as a pre-frame attempt's own record would carry it. In the book it is
// UNRECOGNISED — the arm proves it is counted apart and never as a case.
const PRE = "tool-x";

// Four categories: three derivable, one that no region derives (NOT READABLE).
const FRAME: Gate1ScopeFrame = {
  categories: [
    { id: "c-self", self: true, derivable: true },
    { id: "c-a", self: false, derivable: true },
    { id: "c-b", self: false, derivable: true },
    { id: "c-x", self: false, derivable: false },
  ],
  labelClass: { moduleId: SUBJECT, eventType: LABEL_KIND },
  underivedWord: UNDERIVED,
};

const config = (overrides: Partial<Gate1ScopeConfig> = {}): Gate1ScopeConfig => ({
  readableLoadStates: ["IN_MEMORY"],
  frame: FRAME,
  ...overrides,
});

const withFrame = (frame: unknown): Gate1ScopeConfig =>
  ({ readableLoadStates: ["IN_MEMORY"], frame } as unknown as Gate1ScopeConfig);

function rec(outcome: string, moduleId = SUBJECT, eventType = LABEL_KIND): MicaFixtureInput {
  return { timestamp: 0, moduleId, eventType, outcome };
}

function repeat(n: number, input: MicaFixtureInput): MicaFixtureInput[] {
  return Array.from({ length: n }, () => input);
}

function logOf(specs: readonly MicaFixtureInput[]): MicaFixtureLog {
  const log = new MicaFixtureLog();
  for (const spec of specs) log.append(spec);
  return log;
}

/** 3×c-a, 2×c-self, 2×UNDERIVED, 4×unrecognised, plus 6 records of other classes. */
function fixtureLog(): MicaFixtureLog {
  return logOf([
    ...repeat(3, rec("c-a")),
    ...repeat(2, rec("c-self")),
    ...repeat(2, rec(UNDERIVED)),
    ...repeat(4, rec(PRE)),
    // another subject's label class: same eventType, other moduleId — ignored
    ...repeat(5, rec("c-b", OTHER_SUBJECT)),
    // same subject, another kind carrying a category-shaped outcome — ignored
    rec("c-b", SUBJECT, "TOOL_COMPLETED"),
  ]);
}

/** A log whose every method can be replaced, for the hostile-input arms. */
function hostileLog(overrides: Partial<MicaReadableLog>): MicaReadableLog {
  const base = fixtureLog();
  return {
    verify: () => base.verify(),
    getLoadState: () => base.getLoadState(),
    getAll: () => base.getAll(),
    ...overrides,
  };
}

function blindPaths(result: Gate1ScopeResult): CannotAssessVerdict["blindPaths"] {
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
  return (result.verdict as CannotAssessVerdict).blindPaths;
}

/** Every surface: CANNOT_ASSESS, this sensor, given M, every ceiling line. */
function assertCeilinged(verdict: SensorVerdict, context: string): void {
  assert.strictEqual(verdict.kind, "CANNOT_ASSESS", `${context}: kind was ${verdict.kind}`);
  assert.strictEqual(verdict.sensorId, GATE1_SCOPE_SENSOR_ID, context);
  assert.ok(verdict.summary.includes(GIVEN_M_FRAME), `${context}: "given M" missing`);
  for (const line of GATE1_SCOPE_CEILING_LINES) {
    assert.ok(verdict.summary.includes(line), `${context}: omitted ceiling: ${line.slice(0, 40)}`);
  }
}

function assertStopped(result: Gate1ScopeResult, code: string, context: string): void {
  assert.deepStrictEqual(result.blindReasonCodes, [code], context);
  assert.strictEqual(result.coverage, null, context);
  assert.strictEqual(result.derivableCeiling, null, context);
  assert.deepStrictEqual(result.counts, [], context);
  assertCeilinged(result.verdict, context);
}

function call(log: MicaReadableLog, cfg: Gate1ScopeConfig | undefined): Gate1ScopeResult {
  // The reader must never raise: an exception escaping here fails the arm.
  return assessGate1Scope(log, cfg);
}

console.log("\nMICA — Gate 1 envelope recorder (attempted exposure, given M)\n");

// ── The read ─────────────────────────────────────────────────────────────────

check("counts, coverage and derivable ceiling are exact on the fixture log", () => {
  const result = call(fixtureLog(), config());
  assert.deepStrictEqual(result.counts, [
    { id: "c-self", self: true, derivable: true, cases: 2 },
    { id: "c-a", self: false, derivable: true, cases: 3 },
    { id: "c-b", self: false, derivable: true, cases: 0 },
    { id: "c-x", self: false, derivable: false, cases: 0 },
  ]);
  assert.deepStrictEqual(result.coverage, { reached: 2, ofM: 4 });
  assert.deepStrictEqual(result.derivableCeiling, { derivable: 3, ofM: 4 });
});

check("underived and unrecognised are counted separately, and only underived is labelled", () => {
  const result = call(fixtureLog(), config());
  assert.strictEqual(result.underived, 2);
  assert.strictEqual(result.unrecognised, 4);
  assert.strictEqual(result.labelled, 2 + 3 + 2);
});

check("records of another class are ignored — another subject, and another kind of the same subject", () => {
  // c-b appears six times on the log, never in the label class: it must read 0.
  const result = call(fixtureLog(), config());
  assert.strictEqual(result.counts.find((c) => c.id === "c-b")?.cases, 0);
  assert.ok(result.verdict.summary.includes("Records of other classes, not read: 6"));
});

check("a label is matched exactly: a near-miss outcome is unrecognised, never a case", () => {
  const result = call(logOf([rec(" c-a"), rec("C-A"), rec("c-a "), rec("underived")]), config());
  assert.strictEqual(result.labelled, 0);
  assert.strictEqual(result.unrecognised, 4);
});

check("a read is CANNOT_ASSESS with both always-on legs, INELIGIBLE_SCOPE", () => {
  const result = call(fixtureLog(), config());
  assert.deepStrictEqual(result.blindReasonCodes, ["G1_ENVELOPE_ONLY", "G1_WEIGHT_NOT_READ_BY_CONDUCT"]);
  const paths = blindPaths(result);
  assert.deepStrictEqual(paths.map((p) => p.class), ["INELIGIBLE_SCOPE", "INELIGIBLE_SCOPE"]);
  assert.ok(paths.every((p) => p.detail.trim().length > 0));
  assert.strictEqual(paths[1].detail, GATE1_LEG_B_SENTENCE);
});

check("the summary prints the envelope, the per-category reach, NOT READABLE, underived, unrecognised, leg B", () => {
  const summary = call(fixtureLog(), config()).verdict.summary;
  for (const piece of [
    "given the declared M-frame",
    "reached 2 of 4 categories",
    "at most 3 of 4 are derivable",
    "ATTEMPTED EXPOSURE (not canon's reach), NEVER WEIGHT",
    "c-self (self)=2",
    "c-a=3",
    "c-x=0 NOT READABLE",
    "NOT READABLE categories (no declared region derives them; zero here is not a reading): [c-x]",
    "Underived: 2",
    "Unrecognised: 4",
    "A WRITER OR BOOK DEFECT",
    "A category at zero is one no labelled act was placed in; acts left underived may have been aimed at it",
    "Records of other classes, not read: 6 (labels derived under a different frame drawing, or for another subject",
    "Labelled: 7",
    GATE1_LEG_B_SENTENCE,
    GATE1_SCOPE_CEILINGS,
  ]) {
    assert.ok(summary.includes(piece), `summary lacks: ${piece}`);
  }
  assertCeilinged(call(fixtureLog(), config()).verdict, "read");
});

check("no labelled act -> G1_NO_LABELLED_ACTS beside both legs; the envelope is still stated", () => {
  const result = call(logOf([...repeat(3, rec(PRE)), rec("c-a", OTHER_SUBJECT)]), config());
  assert.deepStrictEqual(result.blindReasonCodes, [
    "G1_NO_LABELLED_ACTS",
    "G1_ENVELOPE_ONLY",
    "G1_WEIGHT_NOT_READ_BY_CONDUCT",
  ]);
  assert.strictEqual(blindPaths(result)[0].class, "INSUFFICIENT_SAMPLE");
  assert.strictEqual(result.labelled, 0);
  assert.strictEqual(result.unrecognised, 3);
  assert.deepStrictEqual(result.coverage, { reached: 0, ofM: 4 });
  assert.ok(result.verdict.summary.includes("reached 0 of 4 categories"));
});

check("an empty log reads as no labelled act, never as silence", () => {
  const result = call(logOf([]), config());
  assert.strictEqual(result.blindReasonCodes[0], "G1_NO_LABELLED_ACTS");
  assertCeilinged(result.verdict, "empty log");
});

check("only underived acts: labelled but reaching nothing", () => {
  const result = call(logOf(repeat(4, rec(UNDERIVED))), config());
  assert.strictEqual(result.labelled, 4);
  assert.deepStrictEqual(result.coverage, { reached: 0, ofM: 4 });
  assert.ok(!result.blindReasonCodes.includes("G1_NO_LABELLED_ACTS"));
});

check("every case on the self category: printed as attempted exposure — the FAIL floor is not read", () => {
  // The predecessor graded this FAIL. Weight is not on this record.
  const result = call(logOf(repeat(50, rec("c-self"))), config());
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.coverage, { reached: 1, ofM: 4 });
  assert.ok(result.verdict.summary.includes("THE FAIL FLOOR IS NOT READ"));
});

check("the result carries exactly the declared fields — no share, no slope, no dosimeter", () => {
  assert.deepStrictEqual(Object.keys(call(fixtureLog(), config())).sort(), [
    "blindReasonCodes", "counts", "coverage", "derivableCeiling",
    "labelled", "underived", "unrecognised", "verdict",
  ]);
  assert.deepStrictEqual(Object.keys(call(fixtureLog(), undefined)).sort(), [
    "blindReasonCodes", "counts", "coverage", "derivableCeiling",
    "labelled", "underived", "unrecognised", "verdict",
  ]);
});

// ── Frame absent / malformed ─────────────────────────────────────────────────

check("absent config -> G1_FRAME_ABSENT, with every ceiling", () => {
  assertStopped(call(fixtureLog(), undefined), "G1_FRAME_ABSENT", "no config");
});

check("config without a frame -> G1_FRAME_ABSENT", () => {
  assertStopped(call(fixtureLog(), { readableLoadStates: ["IN_MEMORY"] }), "G1_FRAME_ABSENT", "no frame");
});

const cats = FRAME.categories;
const MALFORMED: ReadonlyArray<readonly [string, unknown]> = [
  ["frame null", null],
  ["frame a string", "c-a"],
  ["frame a number", 4],
  ["categories absent", { labelClass: FRAME.labelClass, underivedWord: UNDERIVED }],
  ["categories not a list", { ...FRAME, categories: { 0: cats[0] } }],
  ["categories empty", { ...FRAME, categories: [] }],
  ["one category", { ...FRAME, categories: [cats[0]] }],
  ["duplicate id", { ...FRAME, categories: [cats[0], cats[1], { ...cats[1], derivable: false }] }],
  ["no self", { ...FRAME, categories: [cats[1], cats[2]] }],
  ["two selves", { ...FRAME, categories: [cats[0], { ...cats[1], self: true }] }],
  ["empty id", { ...FRAME, categories: [cats[0], { ...cats[1], id: "" }] }],
  ["blank id", { ...FRAME, categories: [cats[0], { ...cats[1], id: "   " }] }],
  ["numeric id", { ...FRAME, categories: [cats[0], { ...cats[1], id: 7 }] }],
  ["self not boolean", { ...FRAME, categories: [cats[0], { ...cats[1], self: "false" }] }],
  ["derivable missing", { ...FRAME, categories: [cats[0], { id: "c-a", self: false }] }],
  ["category null", { ...FRAME, categories: [cats[0], null] }],
  ["labelClass null", { ...FRAME, labelClass: null }],
  ["labelClass absent", { categories: cats, underivedWord: UNDERIVED }],
  ["labelClass moduleId empty", { ...FRAME, labelClass: { moduleId: "", eventType: LABEL_KIND } }],
  ["labelClass eventType missing", { ...FRAME, labelClass: { moduleId: SUBJECT } }],
  ["underivedWord empty", { ...FRAME, underivedWord: "" }],
  ["underivedWord absent", { categories: cats, labelClass: FRAME.labelClass }],
  ["underivedWord equals a category id", { ...FRAME, underivedWord: "c-a" }],
];

check("every malformed frame shape blinds G1_FRAME_MALFORMED and never throws", () => {
  for (const [name, frame] of MALFORMED) {
    assertStopped(call(fixtureLog(), withFrame(frame)), "G1_FRAME_MALFORMED", name);
    assert.strictEqual(blindPaths(call(fixtureLog(), withFrame(frame)))[0].class, "MISSING_CONFIGURATION", name);
  }
});

check("junk config (null, a string) -> G1_FRAME_MALFORMED, never an exception", () => {
  for (const junk of [null, "frame", 0]) {
    const result = call(fixtureLog(), junk as unknown as Gate1ScopeConfig);
    assert.ok(
      ["G1_FRAME_MALFORMED", "G1_READER_THREW"].includes(result.blindReasonCodes[0]),
      `${String(junk)} -> ${result.blindReasonCodes.join(",")}`
    );
    assertCeilinged(result.verdict, String(junk));
  }
});

check("a malformed frame is refused before the log is touched", () => {
  let touched = 0;
  const log = hostileLog({
    verify: () => { touched++; return { valid: true } as ReturnType<MicaReadableLog["verify"]>; },
    getAll: () => { touched++; return []; },
  });
  call(log, withFrame({ ...FRAME, underivedWord: "" }));
  assert.strictEqual(touched, 0);
});

// ── Readability gate ─────────────────────────────────────────────────────────

check("missing readableLoadStates keeps the readability gate closed", () => {
  const result = call(fixtureLog(), config({ readableLoadStates: undefined }));
  assertStopped(result, "G1_READABILITY_GATE", "no load states");
  assert.ok(blindPaths(result)[0].detail.includes("readableLoadStates"));
});

check("a load state outside the injected list -> G1_READABILITY_GATE", () => {
  const result = call(fixtureLog(), config({ readableLoadStates: ["LOADED_VERIFIED"] }));
  assertStopped(result, "G1_READABILITY_GATE", "untrusted load state");
  assert.strictEqual(blindPaths(result)[0].class, "NON_CLEAN_LOAD_STATE");
});

check("a broken chain -> G1_READABILITY_GATE, and the records are not read", () => {
  let read = false;
  const log = hostileLog({
    verify: () => ({ valid: false, brokenAt: 3 } as ReturnType<MicaReadableLog["verify"]>),
    getAll: () => { read = true; return []; },
  });
  const result = call(log, config());
  assertStopped(result, "G1_READABILITY_GATE", "broken chain");
  assert.strictEqual(blindPaths(result)[0].class, "BROKEN_CHAIN");
  assert.strictEqual(read, false);
});

// ── R2: nothing throws out of the reader ─────────────────────────────────────

const boom = (): never => { throw new Error("fixture throw"); };

check("throwing verify() / getLoadState() / getAll() -> G1_READER_THREW", () => {
  for (const [name, log] of [
    ["verify", hostileLog({ verify: boom })],
    ["getLoadState", hostileLog({ getLoadState: boom })],
    ["getAll", hostileLog({ getAll: boom })],
  ] as const) {
    const result = call(log, config());
    assertStopped(result, "G1_READER_THREW", name);
    assert.ok(blindPaths(result)[0].detail.includes("fixture throw"), name);
  }
});

check("a junk record on the chain -> G1_READER_THREW, never an exception", () => {
  const log = hostileLog({ getAll: () => [null] as unknown as readonly MicaLogRecord[] });
  assertStopped(call(log, config()), "G1_READER_THREW", "null record");
});

check("a config or frame whose getter throws -> G1_READER_THREW", () => {
  const throwingConfig = { readableLoadStates: ["IN_MEMORY"], get frame() { return boom(); } };
  assertStopped(call(fixtureLog(), throwingConfig as unknown as Gate1ScopeConfig), "G1_READER_THREW", "frame getter");
  const throwingFrame = { ...FRAME, get categories() { return boom(); } };
  assertStopped(call(fixtureLog(), withFrame(throwingFrame)), "G1_READER_THREW", "categories getter");
  const throwingStates = { frame: FRAME, get readableLoadStates() { return boom(); } };
  assertStopped(call(fixtureLog(), throwingStates as unknown as Gate1ScopeConfig), "G1_READER_THREW", "states getter");
});

check("a thrown value that cannot even be rendered still blinds, never escapes", () => {
  const unrenderable = { toString: boom };
  const log = hostileLog({ getAll: () => { throw unrenderable; } });
  assertStopped(call(log, config()), "G1_READER_THREW", "unrenderable throw");
});

// Review C1-1: a thrown value whose text renders, but overflows the engine's
// string limit once the detail's prefix and suffix are joined to it.
//
// Built as a ROPE of joined halves — joining never flattens — so a string of
// any length up to the limit costs a few dozen small nodes and no flat copy.
// The limit itself is FOUND, not imported: the import-closure guard admits a
// hand-kept list of node built-ins, and asking the engine by trying is both
// closure-clean and exactly the property the arm depends on.
function rope(length: number): string {
  let out = "";
  let piece = "x";
  let n = length;
  for (;;) {
    if (n % 2 === 1) out = out + piece;
    n = Math.floor(n / 2);
    if (n === 0) return out;
    piece = piece + piece;
  }
}
const MAX_STRING = ((): number => {
  const fits = (length: number): boolean => {
    try { return rope(length).length === length; } catch { return false; }
  };
  let lo = 1;
  let hi = 2 ** 32;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) lo = mid; else hi = mid;
  }
  return lo;
})();
const HUGE_THROWN = rope(MAX_STRING - 100);

check("C1-1: a thrown text just under the string limit blinds with the fixed text, from every caller-supplied site", () => {
  assert.ok(HUGE_THROWN.length < MAX_STRING, "the fixture must render: under the limit");
  assert.ok(HUGE_THROWN.length + 200 > MAX_STRING, "and must overflow once the detail wraps it");
  assert.throws(() => `${"x".repeat(200)}${HUGE_THROWN}`, RangeError, "control: the wrap really overflows");
  const throwHuge = (): never => { throw HUGE_THROWN; };
  const sites: ReadonlyArray<readonly [string, () => Gate1ScopeResult]> = [
    ["a record's outcome getter", () =>
      call(hostileLog({ getAll: () => [{ ...rec("c-a"), get outcome(): string { return throwHuge(); } }] as unknown as readonly MicaLogRecord[] }), config())],
    ["getAll", () => call(hostileLog({ getAll: throwHuge }), config())],
    ["the config's frame getter", () =>
      call(fixtureLog(), { readableLoadStates: ["IN_MEMORY"], get frame() { return throwHuge(); } } as unknown as Gate1ScopeConfig)],
    ["an object rendering to it", () =>
      call(hostileLog({ getAll: () => { throw { [Symbol.toPrimitive]: () => HUGE_THROWN }; } }), config())],
  ];
  for (const [name, run] of sites) {
    let result: Gate1ScopeResult | undefined;
    assert.doesNotThrow(() => { result = run(); }, `${name}: an exception escaped the reader`);
    assertStopped(result as Gate1ScopeResult, "G1_READER_THREW", name);
    assert.strictEqual(blindPaths(result as Gate1ScopeResult)[0].detail, GATE1_THREW_UNRENDERED, name);
  }
});

check("C1-1: getAll() handing back an endless iterable returns G1_READER_THREW at once, never hangs", () => {
  let yielded = 0;
  function* endless(): Generator<MicaLogRecord> {
    for (;;) { yielded++; yield { sequenceNumber: yielded, timestamp: 0, moduleId: SUBJECT, eventType: LABEL_KIND, outcome: "c-a" } as MicaLogRecord; }
  }
  const log = hostileLog({ getAll: () => endless() as unknown as readonly MicaLogRecord[] });
  assertStopped(call(log, config()), "G1_READER_THREW", "endless iterable");
  assert.strictEqual(yielded, 0, "the reader must refuse a non-list before iterating it");
});

// ── K1R1-1: a list is read BY INDEX, never through the caller's iterator ─────
//
// Array.isArray is true of an array carrying its own Symbol.iterator and of a
// Proxy over an array. Each fixture's iterator LIES — it yields records (or
// categories) that are not the list's own — and counts its calls, so an arm
// that reads through it goes RED on the counts instead of hanging the suite.
// (The reviewer's endless variants are run against the reader outside the
// suite: an endless iterator would hang a reader that used it, not fail it.)

function lyingIterator<T>(items: readonly T[], calls: { n: number }): () => Iterator<T> {
  return function* () { calls.n++; yield* items; };
}

check("K1R1-1: getAll() returning an ARRAY WITH ITS OWN ITERATOR is read by index — the iterator is never called", () => {
  const calls = { n: 0 };
  const records = fixtureLog().getAll().slice() as MicaLogRecord[] & { [Symbol.iterator]: unknown };
  const lie = logOf(repeat(9, rec("c-b"))).getAll();
  Object.defineProperty(records, Symbol.iterator, { value: lyingIterator(lie, calls) });
  assert.ok(Array.isArray(records), "fixture: it must pass the list guard");
  const result = call(hostileLog({ getAll: () => records }), config());
  assert.strictEqual(calls.n, 0, "the reader called the list's own iterator");
  assert.deepStrictEqual(result.counts.map((c) => `${c.id}=${c.cases}`), ["c-self=2", "c-a=3", "c-b=0", "c-x=0"]);
  assertCeilinged(result.verdict, "own-iterator records");
});

check("K1R1-1: getAll() returning a PROXY OVER AN ARRAY is read by index — its iterator trap is never consulted", () => {
  const calls = { n: 0 };
  const lie = logOf(repeat(9, rec("c-b"))).getAll();
  const records = new Proxy(fixtureLog().getAll().slice(), {
    get(target, key, receiver) {
      if (key === Symbol.iterator) return lyingIterator(lie, calls);
      return Reflect.get(target, key, receiver);
    },
  });
  assert.ok(Array.isArray(records), "fixture: a Proxy over an array passes the list guard");
  const result = call(hostileLog({ getAll: () => records }), config());
  assert.strictEqual(calls.n, 0, "the reader called the proxy's iterator");
  assert.deepStrictEqual(result.counts.map((c) => `${c.id}=${c.cases}`), ["c-self=2", "c-a=3", "c-b=0", "c-x=0"]);
});

check("K1R1-1: frame.categories as an array with its own iterator, and as a Proxy, is read by index", () => {
  // The lie ADDS a fifth category: read through the iterator, M would grow.
  const extra = [...FRAME.categories, { id: "c-lie", self: false, derivable: true }];
  for (const shape of ["own-iterator", "proxy"] as const) {
    const calls = { n: 0 };
    const base = FRAME.categories.slice();
    const categories =
      shape === "proxy"
        ? new Proxy(base, {
            get(target, key, receiver) {
              if (key === Symbol.iterator) return lyingIterator(extra, calls);
              return Reflect.get(target, key, receiver);
            },
          })
        : Object.defineProperty(base, Symbol.iterator, { value: lyingIterator(extra, calls) });
    const result = call(fixtureLog(), withFrame({ ...FRAME, categories }));
    assert.strictEqual(calls.n, 0, `${shape}: the reader called the categories' iterator`);
    assert.deepStrictEqual(result.counts.map((c) => c.id), ["c-self", "c-a", "c-b", "c-x"], shape);
    assert.deepStrictEqual(result.coverage, { reached: 2, ofM: 4 }, shape);
  }
});

check("K1R1-1: a list whose length is not a non-negative safe integer -> G1_READER_THREW, nothing counted", () => {
  for (const length of [Number.POSITIVE_INFINITY, -1, 0.5, "4", Number.MAX_SAFE_INTEGER + 2]) {
    const lying = new Proxy([] as MicaLogRecord[], {
      get(target, key, receiver) { return key === "length" ? length : Reflect.get(target, key, receiver); },
    });
    assertStopped(call(hostileLog({ getAll: () => lying }), config()), "G1_READER_THREW", `records length ${String(length)}`);
    const cats = new Proxy(FRAME.categories.slice(), {
      get(target, key, receiver) { return key === "length" ? length : Reflect.get(target, key, receiver); },
    });
    assertStopped(call(fixtureLog(), withFrame({ ...FRAME, categories: cats })), "G1_READER_THREW", `categories length ${String(length)}`);
  }
});

check("C1-1: the ceiling list and every scope-block list are frozen — a push or a replace throws", () => {
  for (const [name, list] of [
    ["GATE1_SCOPE_CEILING_LINES", GATE1_SCOPE_CEILING_LINES],
    ["GATE1_SCOPE_READS", GATE1_SCOPE_READS],
    ["GATE1_SCOPE_DOES_NOT_SEE", GATE1_SCOPE_DOES_NOT_SEE],
    ["GATE1_SCOPE_COMPETENCE_LINES", GATE1_SCOPE_COMPETENCE_LINES],
  ] as const) {
    assert.ok(Object.isFrozen(list), `${name} is not frozen`);
    assert.throws(() => (list as string[]).push("INJECTED"), TypeError, `${name} accepted a push`);
    assert.throws(() => { (list as string[])[0] = "REPLACED"; }, TypeError, `${name} accepted a replace`);
  }
  // and a getter running DURING a read cannot change what the verdict carries
  const cfg = {
    readableLoadStates: ["IN_MEMORY"],
    get frame() {
      try { (GATE1_SCOPE_CEILING_LINES as string[]).push("INJECTED"); } catch { /* frozen: the point */ }
      return FRAME;
    },
  };
  const result = call(fixtureLog(), cfg as unknown as Gate1ScopeConfig);
  assertCeilinged(result.verdict, "mutating getter");
  assert.ok(!result.verdict.summary.includes("INJECTED"));
});

check("unrecognised at zero prints no defect; a NOT READABLE category with no cases prints no contradiction", () => {
  const summary = call(logOf([rec("c-a"), rec(UNDERIVED)]), config()).verdict.summary;
  assert.ok(summary.includes("Unrecognised: 0"));
  assert.ok(!summary.includes("A WRITER OR BOOK DEFECT"), "a defect printed where none exists");
  assert.ok(!summary.includes("NOT READABLE YET CARRYING CASES"));
});

check("a NOT READABLE category carrying cases is printed as a wiring defect, never hidden behind \"at most\"", () => {
  // Under a frame-scoped class this cannot come from the bridge; it is the
  // frame handed in disagreeing with the book. Review C2-1 (minor).
  const result = call(logOf([rec("c-x"), rec("c-x"), rec("c-a")]), config());
  assert.strictEqual(result.counts.find((c) => c.id === "c-x")?.cases, 2, "the count is never repaired");
  assert.deepStrictEqual(result.coverage, { reached: 2, ofM: 4 });
  assert.ok(result.verdict.summary.includes("NOT READABLE YET CARRYING CASES: [c-x]"), result.verdict.summary);
  assert.ok(result.verdict.summary.includes("wiring defect"));
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
});

check("the frame is read once: a getter that changes its answer cannot split validation from counting", () => {
  let reads = 0;
  const shifty = {
    ...FRAME,
    get categories() {
      reads++;
      return reads === 1 ? FRAME.categories : [FRAME.categories[1]];
    },
  };
  const result = call(fixtureLog(), withFrame(shifty));
  assert.strictEqual(reads, 1);
  assert.strictEqual(result.counts.length, 4);
});

// ── The property, over a SAMPLED FAMILY: CANNOT_ASSESS ───────────────────────
//
// K1R3-4: the name claims only what the generator covers — verify-valid fixture
// logs of string outcomes (categories, the underived word, a tool word, near
// misses), two subjects, two kinds, and the malformed-frame list. Hostile logs,
// non-string outcomes and broken chains are covered by their own arms above,
// not by this one.

check("PROPERTY (sampled): CANNOT_ASSESS, ceilinged, over string-outcome fixture logs × the config and malformed-frame list", () => {
  // Deterministic generator: the arm must fail the same way every time it fails.
  let seed = 4711;
  const next = (n: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const outcomes = ["c-self", "c-a", "c-b", "c-x", UNDERIVED, PRE, "", "c-"];
  const modules = [SUBJECT, OTHER_SUBJECT];
  const kinds = [LABEL_KIND, "TOOL_COMPLETED"];
  const configs: Array<Gate1ScopeConfig | undefined> = [
    config(),
    undefined,
    config({ readableLoadStates: undefined }),
    ...MALFORMED.map(([, frame]) => withFrame(frame)),
  ];
  const fixed: MicaFixtureInput[][] = [
    [],
    repeat(9, rec("c-self")),
    repeat(9, rec("c-a")),
    FRAME.categories.map((c) => rec(c.id)),
    repeat(9, rec(PRE)),
    repeat(9, rec(UNDERIVED)),
  ];
  let readings = 0;
  const kindsSeen = new Set<string>();
  const assess = (specs: readonly MicaFixtureInput[], cfg: Gate1ScopeConfig | undefined): void => {
    const verdict = call(logOf(specs), cfg).verdict;
    kindsSeen.add(verdict.kind);
    assertCeilinged(verdict, `input #${readings}`);
    readings++;
  };
  for (const specs of fixed) for (const cfg of configs) assess(specs, cfg);
  for (let i = 0; i < 300; i++) {
    const specs = Array.from({ length: next(40) }, () =>
      rec(outcomes[next(outcomes.length)], modules[next(modules.length)], kinds[next(kinds.length)])
    );
    assess(specs, configs[next(configs.length)]);
    assess(specs, config());
  }
  assert.deepStrictEqual([...kindsSeen], ["CANNOT_ASSESS"]);
  assert.ok(readings > 300, `only ${readings} readings were made`);
});

check("its permanent CANNOT_ASSESS composes into the floor beside six SILENT siblings", () => {
  const gate = call(fixtureLog(), config()).verdict;
  const siblings = [
    SIG_SENSOR_ID, ENG_SENSOR_ID, NARROW_W_SENSOR_ID,
    NARROW_R_SENSOR_ID, NARROW_K_SENSOR_ID, NARROW_T_SENSOR_ID,
  ].map((sensorId) => silent(sensorId, "fixture scope"));
  const result = new Chokepoint().guard(
    { id: "gate1-envelope-floor-proof" },
    [...siblings, gate],
    { impactClass: "not-consulted-for-alarm" }
  );
  assert.strictEqual(result.decision.floorKind, "CANNOT_ASSESS");
});

// ── Printed scope and source discipline ──────────────────────────────────────

check("the scope block prints every ceiling and the recorder's title", () => {
  const scope = gate1ScopeBlockText(["IN_MEMORY"]);
  for (const line of GATE1_SCOPE_CEILING_LINES) assert.ok(scope.includes(line), line.slice(0, 40));
  assert.ok(scope.includes("envelope recorder"));
  assert.ok(scope.includes("PERMANENT CANNOT_ASSESS"));
});

check("the ceiling lines carry each required content", () => {
  const text = GATE1_SCOPE_CEILINGS;
  for (const piece of [
    "TOUCH IS NOT WEIGHT", "03a §1", "03b §2", "ATTEMPTED EXPOSURE", "That term is this reader's, not canon's",
    "THE LABEL IS ATTEMPTED EXPOSURE OF A DECLARED REGION", "S160",
    "THE TARGET IS THE HARNESS'S OWN CLAIM", "first path-like token", "TRUE LABEL OF A POSSIBLY FALSE CLAIM",
    "REGIONS ARE A DECLARED PROXY, NOT OWNERSHIP",
    "M-FRAGILITY", "no M′ rider",
    "R1 [LB] (03c)", "fringe instrument is MANDATORY for any PASS-grade attestation",
    "NO CALIBRATION", "η and θ are owed",
    "THE FAIL FLOOR IS NOT READ",
    "WEIGHT IS THE PROBE'S",
    // Round 2 (R-f)
    "A category at zero is one no labelled act was placed in; acts left UNDERIVED may have been aimed at it",
    "THE BOOK IS WRITTEN AFTER THE ACT", "INTEREST_LABEL_NOT_PERSISTED", "UNSEEN HERE",
    "ONE FRAME DRAWING AT A TIME", "carry another class and are NOT counted",
    "GROUNDING IS A DECLARED TAG", "03a §6", "NOT verified",
    // Round 3 (M6)
    "THE BOOK CANNOT PROVE IT IS WHOLE", "INTEREST_BOOK_BOUNDARY",
    "derivation-rule and canonicaliser versions", "adding a category no region derives keeps the class",
    // the case-insensitive mount
    "REGIONS ARE MATCHED BYTE FOR BYTE, NOT BY DIRECTORY", "case-insensitive filesystem", "does not fold case",
  ]) {
    assert.ok(text.includes(piece), `ceilings lack: ${piece}`);
  }
});

check("no surface states a zero as \"not touched\" — a zero is a failure to place (review C1-3)", () => {
  const surfaces = [
    GATE1_SCOPE_CEILINGS,
    gate1ScopeBlockText(["IN_MEMORY"]),
    call(fixtureLog(), config()).verdict.summary,
  ].map((t) => t.replace(/\s+/g, " ").toLowerCase());
  for (const claim of ["did not touch, nothing more", "a category at zero is a category not touched"]) {
    for (const text of surfaces) assert.ok(!text.includes(claim), `a surface still claims: ${claim}`);
  }
});

check("K1R2-6: no surface equates touch with canon's reach — canon's reach is the weight distribution's extent", () => {
  const surfaces = [
    GATE1_SCOPE_CEILINGS,
    gate1ScopeBlockText(["IN_MEMORY"]),
    call(fixtureLog(), config()).verdict.summary,
  ].map((t) => t.replace(/\s+/g, " ").toLowerCase());
  for (const claim of ["touch is reach", "is reach — exposure", "reach is exposure", "reach/exposure", "count of reach", "printed as reach"]) {
    for (const text of surfaces) assert.ok(!text.includes(claim), `a surface still claims: ${claim}`);
  }
  assert.ok(GATE1_SCOPE_CEILINGS.includes("Canon's REACH (03a §1) is the weight distribution's extent"));
});

check("M6: the TARGET line states what the bridge leaves UNDERIVED and what it STILL places — no overclaim", () => {
  const line = GATE1_SCOPE_CEILING_LINES.find((l) => l.startsWith("THE TARGET IS THE HARNESS'S OWN CLAIM"));
  assert.ok(line, "the TARGET line is missing");
  for (const piece of [
    "joins ANY token containing \"/\"",
    "a segment with a \":\" anywhere (a URL scheme, host:port, user@host:path)",
    "a leading \"-\", \"+\" or \"~\"",
    "What is STILL PLACED",
    "a/b",
    "@scope/pkg",
    "a shell comment #/x",
    "the caller's own \"..\" normalisation erased",
    "splits on \\s",
    "guards only a direct POST",
  ]) {
    assert.ok(line!.includes(piece), `TARGET line lacks: ${piece}`);
  }
  // the round-2 overclaim: "the rest — a plain a/b argument — is placed", as if a/b were the whole residual
  assert.ok(!line!.includes("the rest — a plain"), "the TARGET line still claims a/b is the whole residual");
});

check("the CASE line states what the bridge's byte-for-byte match does on a case-insensitive mount — no overclaim", () => {
  // Read against the bridge's deriveInterestLabel (prefix p matches target t
  // iff p === "/" or t === p or t starts with p + "/", longest wins) and its
  // canonicaliser (no case-folding); the loader's duplicate check is a byte
  // compare too.
  const line = GATE1_SCOPE_CEILING_LINES.find((l) => l.startsWith("REGIONS ARE MATCHED BYTE FOR BYTE"));
  assert.ok(line, "the CASE line is missing");
  for (const piece of [
    "after one wrapping pair of quotes is stripped from it (S211)",
    "compared byte for byte",
    "does not fold case",
    "case-insensitive filesystem (a Windows mount under WSL, for example, by default; case sensitivity there is a per-directory flag)",
    "the label follows the spelling, not the directory",
    "is NOT placed in that region",
    "falls to the longest declared region whose prefix it does match byte for byte",
    "an enclosing region, or \"/\", when one is declared",
    "the enclosing region's category, which may be any declared category",
    "UNDERIVED only when no declared prefix matches it",
    "refuses only a byte-identical duplicate prefix",
    "two spellings of one directory can be declared as two regions with two categories",
    "Case is one alias among many",
    "an act placed in no region (UNDERIVED) is also never pointed to the witness",
    "the quote strip has a cost",
  ]) {
    assert.ok(line!.includes(piece), `CASE line lacks: ${piece}`);
  }
  // the overclaim this line was drafted against: an other-case target is NOT
  // always underived — an enclosing region or "/" still places it.
  const flat = line!.toLowerCase();
  for (const claim of ["never placed elsewhere", "is left underived", "always underived", "is underived, never", "coarser category"]) {
    assert.ok(!flat.includes(claim), `the CASE line overclaims: ${claim}`);
  }
  // T29 v2 (cold refuter, bytes): the phrase list alone let an appended overclaim pass, so the WHOLE line is pinned
  // by its sha256 — any change to it is a ticket's, never silent.
  assert.strictEqual(createHash("sha256").update(line!, "utf8").digest("hex"), "01109cc51ab8fd2b896c2b0fdd8a93a4c3fc44aea7a0ca9a51b87492e4ebf729", "the CASE line moved");
});

const SOURCE = readFileSync(join(__dirname, "index.ts"), "utf8");

/** Code only: comments and string/template literals blanked, so a match is a USE. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, '""');
}

check("source discipline: the vocabulary of motive occurs only inside the ceiling fence — and does occur there", () => {
  const start = SOURCE.indexOf("export const GATE1_SCOPE_CEILING_LINES");
  const end = SOURCE.indexOf("export const GATE1_SCOPE_CEILINGS", start);
  assert.ok(start >= 0 && end > start, "ceiling fence not found");
  const inside = SOURCE.slice(start, end).toLowerCase();
  const outside = (SOURCE.slice(0, start) + SOURCE.slice(end)).toLowerCase();
  for (const fenced of ["cares", "concern confirmed", "genuine", "who matters"]) {
    assert.ok(inside.includes(fenced), `\`${fenced}\` is not in the fence: the check would pass vacuously`);
    assert.ok(!outside.includes(fenced), `\`${fenced}\` escaped the ceiling fence`);
  }
});

check("source discipline: no SILENT or ALARM verdict is constructed anywhere in the reader", () => {
  const code = codeOnly(SOURCE);
  assert.ok(/\bcannotAssess\s*\(/.test(code), "the control failed: cannotAssess( not found in code");
  assert.ok(!/\balarm\s*\(/.test(code), "alarm( is called");
  assert.ok(!/\bsilent\s*\(/.test(code), "silent( is called");
  assert.ok(!/kind\s*:\s*""/.test(code), "a verdict kind is written by hand");
});

check("no calibration: the reader's code carries no number but the structural 0, 1 and 2", () => {
  const numbers = codeOnly(SOURCE).match(/(?<![A-Za-z0-9_$])\d+(?:\.\d+)?/g) ?? [];
  assert.ok(numbers.length > 0, "the control failed: no number found at all");
  assert.deepStrictEqual([...new Set(numbers)].filter((n) => !["0", "1", "2"].includes(n)), []);
});

check("no subject literal in the reader or in this test", () => {
  const forbidden = [
    ["house", "keeper"].join(""),
    ["richards", "cat"].join("-"),
    ["claude", "bot"].join("-"),
    ["ba", "sh"].join(""),
  ];
  const deployedUid = new RegExp(`(?<![0-9])${String(49 * 20)}(?![0-9])`);
  for (const [name, text] of [
    ["index.ts", SOURCE],
    ["gate1-scope.test.ts", readFileSync(__filename, "utf8")],
  ] as const) {
    const lower = text.toLowerCase();
    for (const word of forbidden) assert.ok(!lower.includes(word), `${name} names a subject literal`);
    assert.ok(!deployedUid.test(text), `${name} carries a deployed uid`);
  }
});

check("the removed legs are gone from the module's exports", () => {
  const exported = Object.keys(gate1);
  for (const kept of ["GATE1_SCOPE_SENSOR_ID", "assessGate1Scope", "GATE1_SCOPE_CEILING_LINES", "GIVEN_M_FRAME"]) {
    assert.ok(exported.includes(kept), `${kept} is no longer exported`);
  }
  for (const removed of ["herfindahl", "slopeOf", "GATE1_SCOPE_CALIBRATION_PROVENANCE"]) {
    assert.ok(!exported.includes(removed), `${removed} is still exported`);
  }
  assert.strictEqual(GATE1_SCOPE_SENSOR_ID, "MICA/gate1-scope");
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
