// ── MICA · Gate 2 direction — tests (Stop 2) ────────────────────────────────
//
// What is pinned here, one arm per rule of the build contract (§1–§3): every
// refusal of the basket; the frame escalation; the readability gate; each
// verdict route in the contract's ORDER (no class at grade → starved → latch →
// bound-at-grade ALARM → unbounded unknowns → binary SILENT → uncertain); the
// CLAIM-MUST-FAIL fixtures — damage at grade accumulating ALARMS, EXACT
// BALANCE ALARMS (The arbiter's "equal alarms", the audit's F1 gloss), Lane-C damage alone does not, value
// that fails CVG never buys a SILENT, and a latch holds against value accrued
// after it until a DECLARED clearing record; the one try round the reader;
// the ceilings on every surface; and the source fences.
//
// ⛔ DECOUPLED FROM GATES 4 AND 5. The predecessor file imported both readers
//    for two arms (an empty-scope "autoimmunity" arm and a floor proof), and
//    three Gate-4 tickets had to open this file for that reason alone.
//    Registration (registration.test.ts D-32) needs only this file's PATH and
//    the reader's SENSOR_ID literal, so both arms are kept with Gate 2's own
//    half: the floor proof composes beside `silent()` siblings, as Gate 1's
//    suite does; Gate 4's empty-record arm lives in Gate 4's own suite.
//
// Fixture names only: subject-a, operator-x, KIND_* — no served literal.

import assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";
import { Chokepoint } from "../chokepoint";
import { MicaFixtureLog } from "../fixture-log";
import type { MicaFixtureInput } from "../fixture-log";
import type { MicaLogRecord, MicaReadableLog } from "../log";
import { silent } from "../types";
import type { AlarmVerdict, CannotAssessVerdict, SensorVerdict } from "../types";
import * as gate2 from "./index";
import {
  assessGate2Direction,
  GATE2_CVG_RULE,
  GATE2_DIRECTION_CEILING_LINES,
  GATE2_DIRECTION_CEILINGS,
  GATE2_DIRECTION_COMPETENCE_LINES,
  GATE2_DIRECTION_DOES_NOT_SEE,
  GATE2_DIRECTION_READS,
  GATE2_DIRECTION_SENSOR_ID,
  GATE2_THREW_UNRENDERED,
  gate2AtLeast,
  gate2DirectionScopeBlockText,
  gate2PassesCvg,
  readGate2Direction,
} from "./index";
import type {
  Gate2Basket,
  Gate2DirectionConfig,
  Gate2DirectionReading,
  Gate2Grade,
  Gate2SignedClass,
  Gate2UnknownClass,
} from "./index";

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

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SUBJECT = "subject-a";
const KV = "KIND_VALUE";
const KD = "KIND_DAMAGE";
const KDC = "KIND_DAMAGE_LANE_C";
const KU = "KIND_UNKNOWN";
const KX = "KIND_OTHER";
const CLEAR = { moduleId: "operator-x", eventType: "OP_RESOLVED" };
const BASKET_CLASS = "G2_BASKET@0123456789abcdef";

const A1: Gate2Grade = { lane: "A", eg: 1 };
const A2: Gate2Grade = { lane: "A", eg: 2 };
const B1: Gate2Grade = { lane: "B", eg: 1 };
const B2: Gate2Grade = { lane: "B", eg: 2 };
const C1: Gate2Grade = { lane: "C", eg: 1 };
const C3: Gate2Grade = { lane: "C", eg: 3 };

/** Value at A/EG-2, ρ 0.8: passes CVG against creditAt B/2. A TEST grade, not a proposal. */
const V: Gate2SignedClass = {
  moduleId: SUBJECT, eventType: KV, outcome: null,
  weight: { lo: 1, hi: 1 }, grade: A2, rhoCausal: 0.8, bearsOn: ["c1"],
};
/** Damage at A/EG-2: at or above establishAt A/1. */
const D: Gate2SignedClass = {
  moduleId: SUBJECT, eventType: KD, outcome: null,
  weight: { lo: 1, hi: 1 }, grade: A2, rhoCausal: 0.8, bearsOn: ["c1"],
};
/** Damage at Lane C: below establishAt — it can never alarm alone. */
const DC: Gate2SignedClass = { ...D, eventType: KDC, grade: C3 };
const U: Gate2UnknownClass = { moduleId: SUBJECT, eventType: KU, outcome: null, grade: A1, bearsOn: ["c2"] };

function basket(overrides: Partial<Gate2Basket> = {}): Gate2Basket {
  return {
    basketClass: BASKET_CLASS,
    frameCategories: ["c1", "c2"],
    value: [V],
    damage: [D],
    unknown: [],
    epsilonNum: 1e-6,
    establishAt: A1,
    creditAt: B2,
    window: { kind: "sinceBoundary" },
    nMin: 5,
    latchClearedBy: [CLEAR],
    ...overrides,
  };
}

function config(overrides: Partial<Gate2Basket> = {}): Gate2DirectionConfig {
  return { readableLoadStates: ["IN_MEMORY"], basket: basket(overrides) };
}

const withBasket = (raw: unknown): Gate2DirectionConfig =>
  ({ readableLoadStates: ["IN_MEMORY"], basket: raw } as unknown as Gate2DirectionConfig);

function rec(eventType: string, outcome = "ok", moduleId = SUBJECT, timestamp = 0): MicaFixtureInput {
  return { timestamp, moduleId, eventType, outcome };
}

function repeat(n: number, input: MicaFixtureInput): MicaFixtureInput[] {
  return Array.from({ length: n }, () => input);
}

function alternate(n: number, first: MicaFixtureInput, second: MicaFixtureInput): MicaFixtureInput[] {
  const out: MicaFixtureInput[] = [];
  for (let i = 0; i < n; i++) out.push(first, second);
  return out;
}

function logOf(specs: readonly MicaFixtureInput[]): MicaFixtureLog {
  const log = new MicaFixtureLog();
  for (const spec of specs) log.append(spec);
  return log;
}

function hostileLog(overrides: Partial<MicaReadableLog>, specs: readonly MicaFixtureInput[] = repeat(6, rec(KV))): MicaReadableLog {
  const base = logOf(specs);
  return {
    verify: () => base.verify(),
    getLoadState: () => base.getLoadState(),
    getAll: () => base.getAll(),
    ...overrides,
  };
}

/** A log that must not be touched: every method throws if called. */
function untouchable(touched: { n: number }): MicaReadableLog {
  return {
    verify: () => { touched.n++; throw new Error("verify must not run"); },
    getLoadState: () => { touched.n++; throw new Error("load state must not be read"); },
    getAll: () => { touched.n++; throw new Error("the record must not be read"); },
  };
}

function call(log: MicaReadableLog, cfg: Gate2DirectionConfig | undefined): Gate2DirectionReading {
  // The reader must never raise: an exception escaping here fails the arm.
  return readGate2Direction(log, cfg);
}

function readOf(specs: readonly MicaFixtureInput[], overrides: Partial<Gate2Basket> = {}): Gate2DirectionReading {
  return call(logOf(specs), config(overrides));
}

function blindPaths(reading: Gate2DirectionReading): CannotAssessVerdict["blindPaths"] {
  assert.strictEqual(reading.verdict.kind, "CANNOT_ASSESS", `kind was ${reading.verdict.kind}`);
  return (reading.verdict as CannotAssessVerdict).blindPaths;
}

/** Every surface: this sensor, and every ceiling line, in the summary. */
function assertCeilinged(verdict: SensorVerdict, context: string): void {
  assert.strictEqual(verdict.sensorId, GATE2_DIRECTION_SENSOR_ID, context);
  for (const line of GATE2_DIRECTION_CEILING_LINES) {
    assert.ok(verdict.summary.includes(line), `${context}: omitted ceiling: ${line.slice(0, 50)}`);
  }
}

function assertBlind(reading: Gate2DirectionReading, code: string, blindClass: string, context: string): void {
  assert.strictEqual(reading.verdict.kind, "CANNOT_ASSESS", `${context}: kind was ${reading.verdict.kind} (${reading.code})`);
  assert.strictEqual(reading.code, code, `${context}: code was ${String(reading.code)}`);
  assert.strictEqual(blindPaths(reading)[0].class, blindClass, context);
  assert.ok(reading.verdict.summary.includes(`Blind reason code: ${code}.`), `${context}: code not printed`);
  assert.ok(reading.verdict.summary.includes("I cannot read this — "), `${context}: message class missing`);
  assert.strictEqual(reading.latchedSince, null, context);
  assertCeilinged(reading.verdict, context);
}

function assertAlarm(reading: Gate2DirectionReading, context: string): AlarmVerdict {
  assert.strictEqual(reading.verdict.kind, "ALARM", `${context}: kind was ${reading.verdict.kind} (${String(reading.code)})`);
  assert.strictEqual(reading.code, "G2_WRONG_DIRECTION_AT_GRADE", context);
  const v = reading.verdict as AlarmVerdict;
  assert.deepStrictEqual(v.findings.map((f) => f.code), ["G2_WRONG_DIRECTION_AT_GRADE"], context);
  assert.ok(v.findings[0].detail.includes("I read this and it is wrong-direction at grade"), `${context}: message class missing`);
  assertCeilinged(v, context);
  return v;
}

/** The binary SILENT face: identity, window, Σ declared, fraction — and nothing per class, no margin. */
function assertBinarySilent(reading: Gate2DirectionReading, context: string): void {
  assert.strictEqual(reading.verdict.kind, "SILENT", `${context}: kind was ${reading.verdict.kind} (${String(reading.code)})`);
  assert.strictEqual(reading.code, null, context);
  assert.strictEqual(reading.latchedSince, null, context);
  const s = reading.verdict.summary;
  assert.ok(s.includes(BASKET_CLASS), `${context}: basketClass missing`);
  assert.ok(s.includes("Window: sinceBoundary"), `${context}: window missing`);
  assert.ok(s.includes("Records in a declared class:"), `${context}: Σ declared missing`);
  assert.ok(/Records in no declared class: [0-9]+ of [0-9]+ \(fraction /.test(s), `${context}: fraction missing`);
  for (const forbidden of ["LB=", "B_g=", "n=", "RECORDER", "BOUNDS", "Per declared class", "Per frame category", "UNKNOWN LIST", KV, KD, KU, "margin=", "Terms ["]) {
    assert.ok(!s.includes(forbidden), `${context}: a SILENT printed ${JSON.stringify(forbidden)}`);
  }
  assertCeilinged(reading.verdict, context);
}

console.log("\nMICA — Gate 2 direction: a declared basket read as a bound at grade\n");

// ── §2.1 · the basket: absent, malformed ─────────────────────────────────────

check("§2.1 config absent → G2_BASKET_ABSENT, MISSING_CONFIGURATION, before the log is touched", () => {
  const touched = { n: 0 };
  const reading = call(untouchable(touched), undefined);
  assertBlind(reading, "G2_BASKET_ABSENT", "MISSING_CONFIGURATION", "no config");
  assert.strictEqual(touched.n, 0);
  assert.ok(reading.verdict.summary.includes("Basket: not printed"));
});

check("§2.1 a config with no basket → G2_BASKET_ABSENT (no default basket)", () => {
  const touched = { n: 0 };
  assertBlind(call(untouchable(touched), { readableLoadStates: ["IN_MEMORY"] }), "G2_BASKET_ABSENT", "MISSING_CONFIGURATION", "no basket");
  assert.strictEqual(touched.n, 0);
});

check("§2.1 junk config (null, a string, a number) → G2_BASKET_MALFORMED, never an exception", () => {
  for (const junk of [null, "basket", 0]) {
    assertBlind(call(logOf([]), junk as unknown as Gate2DirectionConfig), "G2_BASKET_MALFORMED", "MISSING_CONFIGURATION", String(junk));
  }
});

type Mutator = (b: Record<string, unknown>) => void;
const entry = (list: "value" | "damage" | "unknown", patch: Record<string, unknown>, drop: readonly string[] = []): Mutator =>
  (b) => {
    const e: Record<string, unknown> = { ...(b[list] as Record<string, unknown>[])[0], ...patch };
    for (const key of drop) delete e[key];
    b[list] = [e];
  };
const field = (key: string, value: unknown): Mutator => (b) => { b[key] = value; };
const drop = (key: string): Mutator => (b) => { delete b[key]; };

const MALFORMED: ReadonlyArray<readonly [string, Mutator]> = [
  ["basketClass absent", drop("basketClass")],
  ["basketClass wrong prefix", field("basketClass", "INTEREST_LABEL@0123456789abcdef")],
  ["basketClass 15 hex", field("basketClass", "G2_BASKET@0123456789abcde")],
  ["basketClass 17 hex", field("basketClass", "G2_BASKET@0123456789abcdef0")],
  ["basketClass upper-case hex", field("basketClass", "G2_BASKET@0123456789ABCDEF")],
  ["basketClass trailing newline", field("basketClass", "G2_BASKET@0123456789abcdef\n")],
  ["frameCategories not a list", field("frameCategories", "c1")],
  ["frameCategories blank id", field("frameCategories", ["c1", " "])],
  ["frameCategories repeated id", field("frameCategories", ["c1", "c1"])],
  ["value absent", drop("value")],
  ["damage absent", drop("damage")],
  ["unknown absent", drop("unknown")],
  ["value not a list", field("value", { 0: V })],
  ["value entry null", field("value", [null])],
  ["moduleId empty", entry("value", { moduleId: "" })],
  ["eventType absent", entry("damage", {}, ["eventType"])],
  ["outcome a number", entry("value", { outcome: 7 })],
  ["outcome absent (neither string nor null)", entry("value", {}, ["outcome"])],
  ["weight absent", entry("value", {}, ["weight"])],
  ["weight lo > hi", entry("damage", { weight: { lo: 2, hi: 1 } })],
  ["weight negative", entry("value", { weight: { lo: -1, hi: 1 } })],
  ["weight hi infinite", entry("damage", { weight: { lo: 1, hi: Number.POSITIVE_INFINITY } })],
  ["weight lo NaN", entry("value", { weight: { lo: Number.NaN, hi: 1 } })],
  ["rhoCausal below 0", entry("value", { rhoCausal: -0.1 })],
  ["rhoCausal above 1", entry("damage", { rhoCausal: 1.1 })],
  ["rhoCausal absent", entry("value", {}, ["rhoCausal"])],
  ["grade absent", entry("damage", {}, ["grade"])],
  ["lane D", entry("value", { grade: { lane: "D", eg: 2 } })],
  ["eg 4", entry("damage", { grade: { lane: "A", eg: 4 } })],
  ["eg 1.5", entry("damage", { grade: { lane: "A", eg: 1.5 } })],
  ["eg a string", entry("value", { grade: { lane: "A", eg: "2" } })],
  ["bearsOn empty", entry("value", { bearsOn: [] })],
  ["bearsOn not a list", entry("damage", { bearsOn: "c1" })],
  ["bearsOn repeated", entry("damage", { bearsOn: ["c1", "c1"] })],
  ["unknown with a weight", (b) => { b.unknown = [{ ...U, weight: { lo: 1, hi: 1 } }]; }],
  ["unknown with a rhoCausal", (b) => { b.unknown = [{ ...U, rhoCausal: 0.5 }]; }],
  ["unknown magnitude negative", (b) => { b.unknown = [{ ...U, magnitude: { hi: -1 } }]; }],
  ["unknown magnitude infinite", (b) => { b.unknown = [{ ...U, magnitude: { hi: Number.POSITIVE_INFINITY } }]; }],
  ["unknown magnitude null", (b) => { b.unknown = [{ ...U, magnitude: null }]; }],
  ["epsilonNum negative", field("epsilonNum", -1)],
  ["epsilonNum NaN", field("epsilonNum", Number.NaN)],
  ["epsilonNum infinite", field("epsilonNum", Number.POSITIVE_INFINITY)],
  ["epsilonNum absent", drop("epsilonNum")],
  ["epsilonNum a string", field("epsilonNum", "0")],
  ["establishAt absent", drop("establishAt")],
  ["creditAt malformed", field("creditAt", { lane: "B" })],
  ["window trailing", field("window", { kind: "trailing", value: 50 })],
  ["window with an extra key", field("window", { kind: "sinceBoundary", value: 50 })],
  ["window absent", drop("window")],
  ["nMin 0", field("nMin", 0)],
  ["nMin 1.5", field("nMin", 1.5)],
  ["nMin negative", field("nMin", -1)],
  ["nMin a string", field("nMin", "10")],
  ["nMin absent", drop("nMin")],
  ["latchClearedBy empty", field("latchClearedBy", [])],
  ["latchClearedBy absent", drop("latchClearedBy")],
  ["latchClearedBy blank kind", field("latchClearedBy", [{ moduleId: "operator-x", eventType: "" }])],
  ["latchClearedBy repeated", field("latchClearedBy", [CLEAR, CLEAR])],
  ["latchClearedBy names a declared class", field("latchClearedBy", [CLEAR, { moduleId: SUBJECT, eventType: KD }])],
  ["duplicate key within a list", field("value", [V, { ...V }])],
  ["one key in two lists", field("damage", [{ ...V }])],
  ["a null-outcome class beside an outcome class of one kind", field("damage", [D, { ...D, outcome: "error" }])],
  ["no damage term NAMED (damage and unknown both empty)", (b) => { b.damage = []; b.unknown = []; }],
];

check(`§2.1 every malformed basket shape (${MALFORMED.length}) → G2_BASKET_MALFORMED, before the log is touched, never an exception`, () => {
  for (const [name, mutate] of MALFORMED) {
    const raw = basket() as unknown as Record<string, unknown>;
    const b: Record<string, unknown> = { ...raw };
    mutate(b);
    const touched = { n: 0 };
    const reading = call(untouchable(touched), withBasket(b));
    assertBlind(reading, "G2_BASKET_MALFORMED", "MISSING_CONFIGURATION", name);
    assert.strictEqual(touched.n, 0, `${name}: the log was touched`);
    assert.ok(reading.verdict.summary.includes("Basket: not printed"), `${name}: a malformed basket's class was printed`);
  }
});

check("§2.1 the missing-damage-term refusal names its rule (RMBA:208)", () => {
  const reading = call(logOf([]), config({ damage: [], unknown: [] }));
  const detail = blindPaths(reading)[0].detail;
  assert.ok(detail.includes("A missing damage term is not a free lunch; it is an audit problem (RMBA:208)"), detail);
});

check("§2.1 CONTROLS that must NOT be malformed: distinct outcomes of one kind; a damage list of unknowns only; a positive magnitude — and a ZERO magnitude IS malformed (UNKNOWN = zero, RMBA §6)", () => {
  const twoOutcomes = readOf(repeat(6, rec(KV)), { value: [{ ...V, outcome: "ok" }], damage: [{ ...D, eventType: KV, outcome: "error" }] });
  assert.notStrictEqual(twoOutcomes.code, "G2_BASKET_MALFORMED", "two outcomes of one kind are two classes");
  const unknownsOnly = readOf([], { value: [], damage: [], unknown: [U] });
  assert.notStrictEqual(unknownsOnly.code, "G2_BASKET_MALFORMED", "a damage term NAMED as unknown is accepted (named, not measured)");
  const tiny = readOf([], { unknown: [{ ...U, magnitude: { hi: 1e-9 } }] });
  assert.notStrictEqual(tiny.code, "G2_BASKET_MALFORMED", "a positive magnitude is a bound");
  const zero = readOf([], { unknown: [{ ...U, magnitude: { hi: 0 } }] });
  assert.strictEqual(zero.code, "G2_BASKET_MALFORMED", "a zero magnitude erases the unknown");
  assert.ok(blindPaths(zero)[0].detail.includes("UNKNOWN = zero"), blindPaths(zero)[0].detail);
  const sameEventOtherModule = readOf([], { latchClearedBy: [{ moduleId: "operator-x", eventType: KD }] });
  assert.notStrictEqual(sameEventOtherModule.code, "G2_BASKET_MALFORMED", "a clearer of another moduleId is another kind");
});

// ── §2.2 · the frame ─────────────────────────────────────────────────────────

check("§2.2 frameCategories empty → G2_FRAME_ABSENT, escalated (05a:170), before the log is touched", () => {
  const touched = { n: 0 };
  const reading = call(untouchable(touched), config({ frameCategories: [] }));
  assertBlind(reading, "G2_FRAME_ABSENT", "MISSING_CONFIGURATION", "empty frame");
  assert.ok(blindPaths(reading)[0].detail.includes("No frame fixed for this subject — escalated (05a:170)"));
  assert.ok(reading.verdict.summary.includes("I cannot read this — no frame fixed for this subject — escalated (05a:170)"));
  assert.ok(reading.verdict.summary.includes(`Basket: ${BASKET_CLASS}.`), "the basket's identity is printed");
  assert.strictEqual(touched.n, 0);
});

check("§2.2 frameCategories absent → G2_FRAME_ABSENT, not malformed", () => {
  const b = { ...basket() } as Record<string, unknown>;
  delete b.frameCategories;
  assertBlind(call(logOf([]), withBasket(b)), "G2_FRAME_ABSENT", "MISSING_CONFIGURATION", "absent frame");
});

check("§2.2 a bearsOn naming a category outside the frame → G2_BASKET_MALFORMED; with NO frame it is FRAME_ABSENT first", () => {
  const outside = readOf([], { value: [{ ...V, bearsOn: ["c9"] }] });
  assertBlind(outside, "G2_BASKET_MALFORMED", "MISSING_CONFIGURATION", "bearsOn outside M");
  assert.ok(blindPaths(outside)[0].detail.includes("\"c9\""));
  const noFrame = readOf([], { frameCategories: [], value: [{ ...V, bearsOn: ["c9"] }] });
  assert.strictEqual(noFrame.code, "G2_FRAME_ABSENT", "the order is load-bearing: frame before membership");
});

check("§2 ORDER: a malformed grade beside an empty frame is MALFORMED — step 1 before step 2", () => {
  const reading = readOf([], { frameCategories: [], damage: [{ ...D, grade: { lane: "Z", eg: 1 } as unknown as Gate2Grade }] });
  assert.strictEqual(reading.code, "G2_BASKET_MALFORMED");
});

// ── §2.3 · the readability gate ──────────────────────────────────────────────

check("§2.3 the shared readability gate: no list / untrusted state / broken chain → G2_READABILITY_GATE, record unread", () => {
  const noStates = call(logOf(repeat(6, rec(KV))), { basket: basket() });
  assertBlind(noStates, "G2_READABILITY_GATE", "MISSING_CONFIGURATION", "no readableLoadStates");
  const untrusted = call(logOf(repeat(6, rec(KV))), { readableLoadStates: ["LOADED_VERIFIED"], basket: basket() });
  assertBlind(untrusted, "G2_READABILITY_GATE", "NON_CLEAN_LOAD_STATE", "untrusted state");
  let read = false;
  const broken = call(hostileLog({ verify: () => ({ valid: false, brokenAt: 3 }), getAll: () => { read = true; return []; } }), config());
  assertBlind(broken, "G2_READABILITY_GATE", "BROKEN_CHAIN", "broken chain");
  assert.strictEqual(read, false, "a broken chain's records were read");
  assert.ok(broken.verdict.summary.includes(`Basket: ${BASKET_CLASS}.`));
});

// ── §2.6 · no class at grade — THE LIVE CASE ─────────────────────────────────

/** The live candidate's SHAPE (contract §6), in fixture names: five unknowns, no V, no D. */
const LIVE_SHAPE_UNKNOWNS: readonly Gate2UnknownClass[] = [
  { moduleId: SUBJECT, eventType: "KIND_U_STOP", outcome: null, grade: B1, bearsOn: ["c1"] },
  { moduleId: SUBJECT, eventType: "KIND_U_ASK", outcome: null, grade: C1, bearsOn: ["c1"] },
  { moduleId: SUBJECT, eventType: "KIND_U_DIVERGE", outcome: null, grade: C1, bearsOn: ["c1"] },
  { moduleId: SUBJECT, eventType: "KIND_U_RETRY", outcome: null, grade: A1, bearsOn: ["c1"] },
  { moduleId: SUBJECT, eventType: "KIND_U_REVISIT", outcome: null, grade: C1, bearsOn: ["c1"] },
];
const LIVE_SHAPE: Partial<Gate2Basket> = {
  frameCategories: ["c1"],
  value: [],
  damage: [],
  unknown: LIVE_SHAPE_UNKNOWNS,
  epsilonNum: 1e-6,
  establishAt: A1,
  creditAt: B2,
  nMin: 10,
  latchClearedBy: [{ moduleId: "operator-x", eventType: "OPERATOR_KIND_X" }],
};
const NO_CLASS_AT_GRADE_TEXT =
  "No declared class is at the grade a basket claim needs — vacuous at grade (05a:197, \"basket absent or vacuous → CANNOT_ASSESS\")";

check("§2.6 LIVE-BASKET SHAPE (value [], damage [], five unknowns, ε 1e-6, A/1, B/2, nMin 10) → CANNOT_ASSESS · INELIGIBLE_SCOPE · G2_NO_CLASS_AT_GRADE", () => {
  const specs = [
    ...repeat(3, rec("KIND_U_STOP")), ...repeat(4, rec("KIND_U_ASK")), ...repeat(2, rec("KIND_U_DIVERGE")),
    ...repeat(5, rec("KIND_U_REVISIT")), ...repeat(6, rec(KX)),
  ];
  const reading = readOf(specs, LIVE_SHAPE);
  assertBlind(reading, "G2_NO_CLASS_AT_GRADE", "INELIGIBLE_SCOPE", "live shape");
  const detail = blindPaths(reading)[0].detail;
  assert.ok(detail.includes(NO_CLASS_AT_GRADE_TEXT), detail);
  assert.ok(detail.includes("Direction NOT READABLE on this record."), detail);
  // and ON THE FACE, not only in the blind path (K1-canon refuter): the summary's message class names it
  assert.ok(reading.verdict.summary.includes("I cannot read this — no declared class is at the grade a basket claim needs — direction NOT READABLE on this record"), reading.verdict.summary.slice(0, 300));
  // the recorder leg is printed on every non-SILENT reading of the record
  const s = reading.verdict.summary;
  for (const piece of [
    "RECORDER:", "Window: sinceBoundary, seq 0..19 (20 records",
    "Records in a declared class: 14.", "Records in no declared class: 6 of 20 (fraction 0.3)",
    "eventType=\"KIND_U_STOP\", outcome=any) Lane B/EG-1, UNBOUNDED (no magnitude): n=3",
    "eventType=\"KIND_U_RETRY\", outcome=any) Lane A/EG-1, UNBOUNDED (no magnitude): n=0",
    "Per frame category (Σ n of the classes bearing on it): [c1=14]",
    "UNKNOWN LIST (named, never signed; UNKNOWN ≠ zero, RMBA §6): [",
    `Basket: ${BASKET_CLASS}.`,
  ]) {
    assert.ok(s.includes(piece), `summary lacks: ${piece}`);
  }
});

check("§2.6 ORDER: the live shape on an EMPTY record is still NO_CLASS_AT_GRADE — never STARVED, never silence", () => {
  assert.strictEqual(readOf([], LIVE_SHAPE).code, "G2_NO_CLASS_AT_GRADE");
});

check("§2.6 grades are the DECLARED ones: value failing CVG and damage below establishAt only → NO_CLASS_AT_GRADE", () => {
  const reading = readOf(repeat(20, rec(KDC)), { value: [{ ...V, grade: A1 }], damage: [DC] });
  assert.strictEqual(reading.code, "G2_NO_CLASS_AT_GRADE");
});

// ── §2.7 · starved ───────────────────────────────────────────────────────────

check("§2.7 Σ n in the counting window below nMin → INSUFFICIENT_SAMPLE · G2_STARVED; records in no class do not count", () => {
  const reading = readOf([...repeat(4, rec(KV)), ...repeat(30, rec(KX))]);
  assertBlind(reading, "G2_STARVED", "INSUFFICIENT_SAMPLE", "starved");
  assert.ok(blindPaths(reading)[0].detail.includes("holds 4 declared-class record(s), fewer than nMin 5"));
  assert.notStrictEqual(readOf(repeat(5, rec(KV))).code, "G2_STARVED", "Σ n = nMin is not starved");
});

// ── §2.8 · the bound at grade, and the CLAIM-MUST-FAIL fixtures ─────────────

check("CLAIM-MUST-FAIL · damage at grade accumulating (6 D, 1 V) → ALARM, wrong-direction at grade", () => {
  const reading = readOf([rec(KV), ...repeat(6, rec(KD))]);
  const v = assertAlarm(reading, "6 D 1 V");
  assert.ok(v.findings[0].detail.includes("B_g=-5"), v.findings[0].detail);
});

check("CLAIM-MUST-FAIL · EXACT BALANCE (5 D, 5 V at grade) → ALARM — the arbiter's \"equal alarms\" (the audit's F1 gloss: a non-positive bound at grade, V = D included)", () => {
  // Alternating, so no prefix ever has B_g < 0: only B_g = 0 can alarm here.
  const reading = readOf(alternate(5, rec(KV), rec(KD)), { nMin: 10 });
  const v = assertAlarm(reading, "exact balance");
  assert.ok(v.findings[0].detail.includes("B_g=0"), v.findings[0].detail);
  // and the same counts one record short of balance are not an alarm
  const short = readOf([...alternate(5, rec(KV), rec(KD))].slice(0, 9).concat([rec(KV)]), { nMin: 10 });
  assert.notStrictEqual(short.verdict.kind, "ALARM", "6 V 4 D must not alarm");
});

check("CLAIM-MUST-FAIL · EXACT BALANCE IN DECIMALS: 3 V at 0.1 against 1 D at 0.3 is B_g = 0 EXACTLY → ALARM, at ε 1e-6 and at ε 0", () => {
  // Read as the declared decimals (0.1 is 1/10), summed exactly: no rounding residue to fall either side of ε.
  const decimal: Partial<Gate2Basket> = {
    value: [{ ...V, weight: { lo: 0.1, hi: 0.1 } }],
    damage: [{ ...D, weight: { lo: 0.3, hi: 0.3 } }],
    nMin: 4,
  };
  for (const epsilonNum of [1e-6, 0]) {
    const v = assertAlarm(readOf([...repeat(3, rec(KV)), rec(KD)], { ...decimal, epsilonNum }), `ε ${epsilonNum}`);
    assert.ok(v.findings[0].detail.includes("B_g=0,"), v.findings[0].detail);
  }
});

check("CLAIM-MUST-FAIL · SCALE: a decimal balance at 3e10 (3 V at 10000000000.1, 1 D at 30000000000.3) is still B_g = 0 → ALARM — never SILENT on rounding", () => {
  const big: Partial<Gate2Basket> = {
    value: [{ ...V, weight: { lo: 10000000000.1, hi: 10000000000.1 } }],
    damage: [{ ...D, weight: { lo: 30000000000.3, hi: 30000000000.3 } }],
    nMin: 4,
  };
  const v = assertAlarm(readOf([...repeat(3, rec(KV)), rec(KD)], big), "scale");
  assert.ok(v.findings[0].detail.includes("LB=0, B_g=0,"), v.findings[0].detail);
});

check("CLAIM-MUST-FAIL · ORDER: the verdict does not depend on the order classes are declared in (0.1 + 0.2 + 0.3 against 0.6, at ε 0)", () => {
  const vs = [0.1, 0.2, 0.3].map((w, i) => ({ ...V, eventType: `KIND_VALUE_${i}`, weight: { lo: w, hi: w } }));
  const specs = [rec("KIND_VALUE_0"), rec("KIND_VALUE_1"), rec("KIND_VALUE_2"), rec(KD)];
  const base: Partial<Gate2Basket> = { damage: [{ ...D, weight: { lo: 0.6, hi: 0.6 } }], epsilonNum: 0, nMin: 4 };
  const forward = readOf(specs, { ...base, value: vs });
  const backward = readOf(specs, { ...base, value: [...vs].reverse() });
  assertAlarm(forward, "forward");
  assertAlarm(backward, "backward");
  assert.strictEqual(forward.latchedSince, backward.latchedSince);
});

check("CLAIM-MUST-FAIL · OVERFLOW: weights at 1e308 are summed exactly — a record whose V − D is −1e308 ALARMs, never SILENT", () => {
  const huge: Partial<Gate2Basket> = {
    value: [{ ...V, weight: { lo: 1e308, hi: 1e308 } }, { ...V, eventType: "KIND_VALUE_B", weight: { lo: 1e308, hi: 1e308 } }],
    damage: [{ ...D, weight: { lo: 1e308, hi: 1e308 } }],
    nMin: 5,
  };
  const reading = readOf([rec(KV), rec("KIND_VALUE_B"), ...repeat(3, rec(KD))], huge);
  const v = assertAlarm(reading, "overflow");
  assert.ok(v.findings[0].detail.includes(`B_g=-1${"0".repeat(308)},`), v.findings[0].detail.slice(0, 400));
});

check("§1 one kind, two outcomes: a value class and a damage class on the same eventType route by outcome", () => {
  const split: Partial<Gate2Basket> = {
    value: [{ ...V, eventType: KX, outcome: "good" }],
    damage: [{ ...D, eventType: KX, outcome: "bad" }],
  };
  const reading = readOf([rec(KX, "good"), ...repeat(5, rec(KX, "bad"))], split);
  assertAlarm(reading, "routed by outcome");
  assert.ok((reading.verdict as AlarmVerdict).findings[0].detail.includes("B_g=-4,"));
});

check("§2.8 the ALARM boundary is B_g ≤ 0, EXACT, and ε takes no part in it: B_g = 0 alarms; any positive B_g — inside ε or not — permits positive and reads UNCERTAIN (05b:375-376)", () => {
  const even: Partial<Gate2Basket> = { value: [{ ...V, weight: { lo: 1, hi: 1 } }], damage: [{ ...D, weight: { lo: 1, hi: 1 } }], epsilonNum: 0.5, nMin: 2 };
  const v = assertAlarm(readOf([rec(KV), rec(KD)], even), "B_g = 0");
  assert.ok(v.findings[0].detail.includes("B_g=0,"), v.findings[0].detail);
  const above = readOf([rec(KV), rec(KD)], { ...even, value: [{ ...V, weight: { lo: 1, hi: 1.5 } }] });
  assertBlind(above, "G2_DIRECTION_UNCERTAIN", "INSUFFICIENT_SAMPLE", "B_g = ε");
  assert.ok(above.verdict.summary.includes("LB=0, B_g=0.5,"), above.verdict.summary.slice(0, 600));
  assert.ok(blindPaths(above)[0].detail.includes("still permits positive (05b:375-376)"), "UNCERTAIN says why");
  const inside = readOf([rec(KV), rec(KD)], { ...even, epsilonNum: 1e-6, value: [{ ...V, weight: { lo: 1, hi: 1.0000001 } }] });
  assertBlind(inside, "G2_DIRECTION_UNCERTAIN", "INSUFFICIENT_SAMPLE", "B_g inside ε");
  assert.ok(inside.verdict.summary.includes("B_g=0.0000001,"), inside.verdict.summary.slice(0, 600));
});

check("CLAIM-MUST-FAIL · D ALONE CANNOT ALARM (the audit, 20:01Z): no value class declared → CANNOT_ASSESS · G2_VALUE_NOT_READABLE, however much at-grade damage", () => {
  const reading = readOf(repeat(30, rec(KD)), { value: [] });
  assertBlind(reading, "G2_VALUE_NOT_READABLE", "INELIGIBLE_SCOPE", "D alone");
  assert.ok(blindPaths(reading)[0].detail.includes("20:01Z"), "the ruling is cited");
  assert.ok(reading.verdict.summary.includes("n=30"), "the damage is counted and printed on the recorder");
  // CONTROL: a value class DECLARED with no records is a measured zero, and the same damage alarms
  assertAlarm(readOf(repeat(30, rec(KD))), "value declared, zero records");
});

check("CLAIM-MUST-FAIL · AT GRADE ON BOTH SIDES: value below creditAt is not credited — it cannot hold off an ALARM, and alone it leaves V not readable", () => {
  const weak = { ...V, eventType: "KIND_VALUE_WEAK", grade: C3, rhoCausal: 0, weight: { lo: 0, hi: 100 } };
  // one credited value record (1) and one weak (100) against 5 at-grade damage: B_g = 1 − 5, the weak 100 not counted
  const reading = readOf([rec(KV), rec("KIND_VALUE_WEAK"), ...repeat(5, rec(KD))], { value: [V, weak], nMin: 7 });
  const v = assertAlarm(reading, "weak value");
  assert.ok(v.findings[0].detail.includes("B_g=-4,"), v.findings[0].detail.slice(0, 400));
  assert.ok(reading.verdict.summary.includes("BELOW creditAt (not credited)"), "the recorder says the weak class is not credited");
  // weak value ALONE: the V side is not readable at grade
  assertBlind(readOf([rec("KIND_VALUE_WEAK"), ...repeat(5, rec(KD))], { value: [weak] }), "G2_VALUE_NOT_READABLE", "INELIGIBLE_SCOPE", "weak alone");
});

check("CLAIM-MUST-FAIL · VALUE THAT CANNOT CARRY VALUE IS NOT READABLE: a value class weighted [0, 0] passes no step 6b — D alone still cannot alarm", () => {
  const zeroV = { ...V, weight: { lo: 0, hi: 0 } };
  assertBlind(readOf(repeat(30, rec(KD)), { value: [zeroV] }), "G2_VALUE_NOT_READABLE", "INELIGIBLE_SCOPE", "value [0,0]");
  // CONTROL: the smallest positive upper weight makes the V side readable, and the same damage alarms
  assertAlarm(readOf(repeat(30, rec(KD)), { value: [{ ...V, weight: { lo: 0, hi: 1e-9 } }] }), "value [0, 1e-9]");
});

check("CLAIM-MUST-FAIL · a count is not presence: at-grade damage weighted [0, 1] establishes none, so B_g = 0 does not alarm", () => {
  const zeroLo: Partial<Gate2Basket> = { damage: [{ ...D, weight: { lo: 0, hi: 1 } }] };
  const reading = readOf(repeat(10, rec(KD)), zeroLo);
  assertBlind(reading, "G2_DIRECTION_UNCERTAIN", "INSUFFICIENT_SAMPLE", "w.lo 0");
  assert.ok(blindPaths(reading)[0].detail.includes("no at-grade damage is established"), blindPaths(reading)[0].detail.slice(0, 400));
  // CONTROL: the smallest positive lower weight establishes it
  assertAlarm(readOf(repeat(10, rec(KD)), { damage: [{ ...D, weight: { lo: 1e-3, hi: 1 } }] }), "w.lo 1e-3");
});

check("CLAIM-MUST-FAIL · Lane-C damage only, 0 V → NOT ALARM (a Lane-C class cannot alarm alone)", () => {
  const reading = readOf(repeat(8, rec(KDC)), { damage: [D, DC] });
  assert.notStrictEqual(reading.verdict.kind, "ALARM");
  assertBlind(reading, "G2_DIRECTION_UNCERTAIN", "INSUFFICIENT_SAMPLE", "lane C only");
  assert.ok(reading.verdict.summary.includes("B_g=0"), "B_g is 0 and still no alarm: no at-grade damage is on the record");
  assert.ok(blindPaths(reading)[0].detail.includes("no at-grade damage is established"), "UNCERTAIN says why it is not an alarm");
});

check("CLAIM-MUST-FAIL · V passing CVG dominant → SILENT, binary", () => {
  assertBinarySilent(readOf([...repeat(10, rec(KV)), rec(KD), rec(KX)]), "V dominant at grade");
});

check("CLAIM-MUST-FAIL · V that fails CVG dominant → NEVER SILENT (EG-1; ρ below 0.5; below creditAt's lane)", () => {
  for (const [name, value] of [
    ["EG-1", { ...V, grade: A1 }],
    ["ρ 0.4", { ...V, rhoCausal: 0.4 }],
    ["Lane C at EG-3 (below creditAt B/2)", { ...V, grade: C3 }],
  ] as const) {
    const reading = readOf([...repeat(10, rec(KV)), rec(KD)], { value: [value] });
    assert.notStrictEqual(reading.verdict.kind, "SILENT", `${name}: a value class failing CVG bought a SILENT`);
    if (name === "ρ 0.4") {
      // at creditAt but below CVG: credited at the favourable end only
      assertBlind(reading, "G2_DIRECTION_UNCERTAIN", "INSUFFICIENT_SAMPLE", name);
      assert.ok(reading.verdict.summary.includes("LB=-1, B_g=9"), `${name}: ${reading.verdict.summary.slice(0, 300)}`);
    } else {
      // below creditAt: not credited at all, so the V side is not readable
      assertBlind(reading, "G2_VALUE_NOT_READABLE", "INELIGIBLE_SCOPE", name);
    }
  }
});

check("§1 CVG and the grade order are the contract's: atLeast is lane AND eg; CVG is ≥ creditAt, EG ≥ 2, ρ ≥ 0.5", () => {
  assert.ok(gate2AtLeast(A1, A1) && gate2AtLeast(A2, B1) && gate2AtLeast(B2, C1));
  assert.ok(!gate2AtLeast(B2, A1), "lane B is below lane A whatever its EG");
  assert.ok(!gate2AtLeast(A1, B2), "EG-1 is below EG-2 whatever its lane");
  assert.ok(gate2PassesCvg(A2, 0.5, B2));
  assert.ok(!gate2PassesCvg(A2, 0.49, B2));
  assert.ok(!gate2PassesCvg(B1, 0.9, B1), "EG-1 never passes CVG, even at ≥ creditAt");
  assert.deepStrictEqual({ ...GATE2_CVG_RULE }, { minEg: 2, minRhoCausal: 0.5, source: "RMBA §13" });
  assert.ok(Object.isFrozen(GATE2_CVG_RULE));
});

check("§2.8 LB reads V.lo (CVG only) and D.hi; B_g reads V.hi and at-grade D.lo — intervals, not points", () => {
  const wide: Partial<Gate2Basket> = {
    value: [{ ...V, weight: { lo: 1, hi: 3 } }],
    damage: [{ ...D, weight: { lo: 2, hi: 4 } }],
  };
  const uncertain = readOf([...repeat(4, rec(KV)), rec(KD)], wide);
  assertBlind(uncertain, "G2_DIRECTION_UNCERTAIN", "INSUFFICIENT_SAMPLE", "wide");
  assert.ok(uncertain.verdict.summary.includes("LB=0, B_g=10"), uncertain.verdict.summary);
  const alarmed = readOf([...repeat(2, rec(KV)), ...repeat(3, rec(KD))], wide);
  const v = assertAlarm(alarmed, "wide alarm");
  assert.ok(v.findings[0].detail.includes("B_g=0"), "2·3 − 3·2 = 0: exact balance at the favourable end alarms");
});

check("§2.8 a BOUNDED unknown enters both ends — against at LB, for at B_g", () => {
  const reading = readOf([...repeat(5, rec(KV)), rec(KD), rec(KU)], { unknown: [{ ...U, magnitude: { hi: 2 } }] });
  // LB = 5 − 1 − 2 = 2 > ε → SILENT; B_g = 5 − 1 + 2 = 6
  assertBinarySilent(reading, "bounded unknown");
  const tighter = readOf([...repeat(3, rec(KV)), rec(KD), rec(KU)], { unknown: [{ ...U, magnitude: { hi: 2 } }] });
  // LB = 3 − 1 − 2 = 0 → uncertain; B_g = 3 − 1 + 2 = 4
  assert.ok(tighter.verdict.summary.includes("LB=0, B_g=4"), tighter.verdict.summary);
});

check("§2.11 LB inside (0, ε] is UNCERTAIN, never SILENT — ε is a tolerance the bound must clear", () => {
  // every declared weight is above ε (the basket rule); LB = 1.0000005 − 1 lands inside (0, ε], B_g = 2 − 1 does not
  const tiny: Partial<Gate2Basket> = { value: [{ ...V, weight: { lo: 1.0000005, hi: 2 } }], epsilonNum: 1e-6, nMin: 2 };
  const reading = readOf([rec(KV), rec(KD)], tiny);
  const lb = Number(/LB=([^,]+),/.exec(reading.verdict.summary)![1]);
  assert.ok(lb > 0 && lb <= 1e-6, `the arm must put LB inside (0, ε], read ${lb}`);
  assertBlind(reading, "G2_DIRECTION_UNCERTAIN", "INSUFFICIENT_SAMPLE", "LB in (0, ε]");
  for (const piece of ["LB=", "B_g=", "epsilonNum=0.000001", "Straddling zero: ["]) {
    assert.ok(reading.verdict.summary.includes(piece), piece);
  }
});

check("§2.11 DIRECTION_UNCERTAIN prints LB, B_g, ε and names the terms that straddle zero", () => {
  const reading = readOf([...repeat(10, rec(KV)), rec(KD)], { value: [{ ...V, rhoCausal: 0.4 }] });
  const s = reading.verdict.summary;
  assert.ok(s.includes("LB=-1, B_g=9, epsilonNum=0.000001"), s);
  assert.ok(/Straddling zero: \[value\[0\] \(moduleId="subject-a", eventType="KIND_VALUE"/.test(s), "the value term [0, 10] straddles");
  assert.ok(!/Straddling zero: \[[^\]]*damage\[0\]/.test(s), "an at-grade damage term [−1, −1] does not straddle");
});

// ── §2.9 · unknowns that prevent bounding ────────────────────────────────────

check("§2.9 an unknown with records and NO magnitude → G2_UNKNOWNS_PREVENT_BOUNDING (UNKNOWN ≠ zero), even beside dominant value", () => {
  const reading = readOf([...repeat(10, rec(KV)), rec(KU)], { unknown: [U] });
  assertBlind(reading, "G2_UNKNOWNS_PREVENT_BOUNDING", "INSUFFICIENT_SAMPLE", "unbounded unknown");
  assert.ok(blindPaths(reading)[0].detail.includes("UNKNOWN ≠ zero (RMBA §6)"));
  // the same unknown with NO records in the window does not block
  assertBinarySilent(readOf(repeat(10, rec(KV)), { unknown: [U] }), "unknown declared, no records");
});

check("§2.9 an unbounded unknown also blocks a NON-latched alarm: no bound, no alarm", () => {
  const reading = readOf([rec(KU), ...repeat(6, rec(KD))], { unknown: [U] });
  assert.strictEqual(reading.code, "G2_UNKNOWNS_PREVENT_BOUNDING");
});

check("§2.9 a latched ALARM wins over unknowns — a latch never clears by internal state", () => {
  const reading = readOf([...repeat(6, rec(KD)), rec(KU), ...repeat(5, rec(KV))], { unknown: [U] });
  assertAlarm(reading, "latch beats unknowns");
  assert.strictEqual(reading.latchedSince, 4, "onset at the 5th damage record (seq 4), when Σ n first reaches nMin");
  assert.ok((reading.verdict as AlarmVerdict).findings[0].detail.includes("an unbounded unknown has records, so no end bound is formed"));
});

// ── §2.5 · THE LATCH ─────────────────────────────────────────────────────────

check("LATCH · ALARM at k, then 20 value records → STILL ALARM, latched since k", () => {
  const specs = [...repeat(5, rec(KD)), ...repeat(20, rec(KV))];
  const reading = readOf(specs);
  const v = assertAlarm(reading, "latched");
  assert.strictEqual(reading.latchedSince, 4);
  assert.ok(v.findings[0].detail.includes("LATCHED: the ALARM condition (a value class credited at grade, at-grade damage established and B_g ≤ 0) first held at seq 4"));
  assert.ok(v.findings[0].detail.includes("LB=15, B_g=15"), "the end totals are printed — and no longer satisfy §2.8");
  // CONTROL: the same records in the other order never set a latch, and read clean
  assertBinarySilent(readOf([...repeat(20, rec(KV)), ...repeat(5, rec(KD))]), "same multiset, value first");
});

check("LATCH · a DECLARED clearing record after k clears it, and counting RESTARTS after that record", () => {
  const clear = rec(CLEAR.eventType, "resolved", CLEAR.moduleId);
  // restart proven by starvation: 3 value records after the clearing record
  const starved = readOf([...repeat(5, rec(KD)), clear, ...repeat(3, rec(KV))]);
  assertBlind(starved, "G2_STARVED", "INSUFFICIENT_SAMPLE", "restarted, starved");
  assert.ok(starved.verdict.summary.includes("Latches set and cleared: onset seq 4 cleared at seq 5"), starved.verdict.summary);
  assert.ok(starved.verdict.summary.includes("Counting window: the records AFTER the latch-clearing record at seq 5"));
  // restart proven by a clean read of the window after it
  const clean = readOf([...repeat(5, rec(KD)), clear, ...repeat(10, rec(KV)), rec(KD)]);
  assertBinarySilent(clean, "restarted, value dominant");
  assert.ok(clean.verdict.summary.includes("Counting window: after the latch-clearing record at seq 5."));
  // and a NEW onset is searched from there
  const again = readOf([...repeat(5, rec(KD)), clear, ...repeat(2, rec(KV)), ...repeat(6, rec(KD))]);
  assertAlarm(again, "a second latch");
  assert.strictEqual(again.latchedSince, 10, "onset searched again after the clearing record (2 V then the 3rd D, at Σ n = 5)");
});

check("LATCH · a clearing record RE-ARMS a window an unknown with no magnitude has BLOCKED: a blocked window can neither alarm nor be silent, so the arbiter's record restarts it", () => {
  const clear = rec(CLEAR.eventType, "resolved", CLEAR.moduleId);
  // CONTROL: blocked for the life of the window without the clearing record
  assertBlind(readOf([rec(KU), ...repeat(5, rec(KD))], { unknown: [U] }), "G2_UNKNOWNS_PREVENT_BOUNDING", "INSUFFICIENT_SAMPLE", "blocked");
  // re-armed at seq 1: the 5 damage records after it read on their own, and latch at the 5th (seq 6)
  const rearmed = readOf([rec(KU), clear, ...repeat(5, rec(KD))], { unknown: [U] });
  assertAlarm(rearmed, "re-armed");
  assert.strictEqual(rearmed.latchedSince, 6);
  assert.ok(rearmed.verdict.summary.includes("re-armed at seq 1"), rearmed.verdict.summary.slice(0, 800));
});

check("LATCH · only latchClearedBy keys clear — not the same eventType of another moduleId, not another operator kind, not a subject kind", () => {
  const specs = [
    ...repeat(5, rec(KD)),
    rec(CLEAR.eventType, "resolved", SUBJECT),
    rec("OP_OTHER", "resolved", CLEAR.moduleId),
    rec(KX, "resolved", SUBJECT),
    ...repeat(20, rec(KV)),
  ];
  const reading = readOf(specs);
  assertAlarm(reading, "non-clearers");
  assert.strictEqual(reading.latchedSince, 4);
  assert.ok(!reading.verdict.summary.includes("Latches set and cleared"));
});

check("LATCH · a clearing record with NO latch standing restarts nothing — a resolution of another gate cannot wipe the window", () => {
  const clear = rec(CLEAR.eventType, "resolved", CLEAR.moduleId);
  // 4 D, a clearing record (seq 4), 4 D: one window of 8, so the 5th D (seq 5) reaches nMin 5 and latches
  const reading = readOf([...repeat(4, rec(KD)), clear, ...repeat(4, rec(KD))]);
  assertAlarm(reading, "clearing record before any onset");
  assert.strictEqual(reading.latchedSince, 5, "the counts ran on across the clearing record");
  const s = reading.verdict.summary;
  assert.ok(s.includes("Counting window: the whole window (clearing records at seq 4 found no latch standing and no blocked window, so counting did not restart)."), s);
  assert.ok(!s.includes("Latches set and cleared"), "no latch stood, so none was cleared");
  // a STREAM of such records cannot keep the window below nMin: one after each of the first 4 D, then the 5th D
  const stream: MicaFixtureInput[] = [];
  for (let i = 0; i < 4; i++) stream.push(rec(KD), clear);
  stream.push(rec(KD));
  const streamed = readOf(stream);
  assertAlarm(streamed, "a clearing record after every damage record");
  assert.strictEqual(streamed.latchedSince, 8, "the 5th D, seq 8, latches: the four clearing records found no latch");
  // nor wipe a value window: 10 V, a clearing record, 1 D reads the whole window
  assertBinarySilent(readOf([...repeat(10, rec(KV)), clear, rec(KD)]), "value window not wiped");
});

check("LATCH · onset is tested at EVERY declared-class record: the record that carries Σ n across nMin latches, whatever its side", () => {
  // 4 D then 1 V: the V record (seq 4) brings Σ n to nMin 5 with B_g = 1 − 4 ≤ ε — the condition first holds there
  const crossed = readOf([...repeat(4, rec(KD)), rec(KV)]);
  assertAlarm(crossed, "onset at a value record");
  assert.strictEqual(crossed.latchedSince, 4, "the onset is the record that crossed nMin");
  // and value AFTER it cannot lift it: no clearing record, so the latch stands (08b:189-191)
  const diluted = readOf([...repeat(4, rec(KD)), ...repeat(21, rec(KV))]);
  assertAlarm(diluted, "value after a value-record onset");
  assert.strictEqual(diluted.latchedSince, 4);
  // below nMin no bound is formed, so nothing latches
  assertBlind(readOf(repeat(4, rec(KD))), "G2_STARVED", "INSUFFICIENT_SAMPLE", "below nMin");
});

check("LATCH · EVERY ALARM IS LATCHED: no reading returns ALARM with latchedSince null", () => {
  const alarms = [
    readOf([rec(KV), ...repeat(6, rec(KD))]),
    readOf(alternate(5, rec(KV), rec(KD)), { nMin: 10 }),
    readOf([...repeat(4, rec(KD)), rec(KV)]),
    readOf([...repeat(5, rec(KD)), ...repeat(20, rec(KV))]),
    readOf([...repeat(2, rec(KV)), ...repeat(3, rec(KD))], { value: [{ ...V, weight: { lo: 1, hi: 3 } }], damage: [{ ...D, weight: { lo: 2, hi: 4 } }] }),
  ];
  for (const [i, r] of alarms.entries()) {
    assertAlarm(r, `alarm ${i}`);
    assert.ok(r.latchedSince !== null, `alarm ${i} carries no onset`);
    assert.ok((r.verdict as AlarmVerdict).findings[0].detail.includes("LATCHED"), `alarm ${i} is not printed as latched`);
  }
});

// ── sequence order, never time ───────────────────────────────────────────────

check("the scan is in SEQUENCE ORDER: adversarial timestamps (NaN, ±∞, reversed) leave every reading byte-identical", () => {
  const shapes: ReadonlyArray<readonly MicaFixtureInput[]> = [
    [...repeat(5, rec(KD)), ...repeat(20, rec(KV))],
    [...repeat(10, rec(KV)), rec(KD)],
    [...repeat(10, rec(KV)), rec(KD), rec(KU)],
    [...repeat(5, rec(KD)), rec(CLEAR.eventType, "resolved", CLEAR.moduleId), ...repeat(3, rec(KV))],
  ];
  const hostile = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const shape of shapes) {
    const plain = readOf(shape, { unknown: [U] });
    const adversarial = readOf(
      shape.map((r, i) => ({ ...r, timestamp: i % 4 === 3 ? 1e15 - i : hostile[i % hostile.length] })),
      { unknown: [U] }
    );
    assert.strictEqual(adversarial.verdict.summary, plain.verdict.summary);
    assert.strictEqual(adversarial.latchedSince, plain.latchedSince);
    assert.strictEqual(adversarial.code, plain.code);
  }
});

// ── outcomes and class identity ──────────────────────────────────────────────

check("a class is matched exactly: outcome null = any; an outcome class matches that outcome only, never a near miss", () => {
  const okOnly: Partial<Gate2Basket> = { value: [{ ...V, outcome: "ok" }] };
  assertBinarySilent(readOf([...repeat(10, rec(KV, "ok")), rec(KD)], okOnly), "outcome ok");
  const near = readOf([...repeat(10, rec(KV, "ok ")), ...repeat(10, rec(KV, "OK")), rec(KD)], okOnly);
  assert.ok(near.verdict.summary.includes("Records in a declared class: 1."), "near-miss outcomes are in no class");
});

check("length-prefixed tuple keys keep concatenation-shaped classes distinct", () => {
  const left: Gate2SignedClass = { ...V, moduleId: "a", eventType: "bc" };
  const right: Gate2SignedClass = { ...D, moduleId: "ab", eventType: "c" };
  const reading = readOf(repeat(6, rec("bc", "ok", "a")), { value: [left], damage: [right] });
  assertBinarySilent(reading, "a|bc is not ab|c");
});

// ── the one try: nothing throws out of the reader ────────────────────────────

const boom = (): never => { throw new Error("fixture throw"); };

check("THREW · verify() / getLoadState() / getAll() throwing → G2_READER_THREW, MISSING_CONFIGURATION, text attached", () => {
  for (const [name, log] of [
    ["verify", hostileLog({ verify: boom })],
    ["getLoadState", hostileLog({ getLoadState: boom })],
    ["getAll", hostileLog({ getAll: boom })],
  ] as const) {
    const reading = call(log, config());
    assertBlind(reading, "G2_READER_THREW", "MISSING_CONFIGURATION", name);
    assert.ok(blindPaths(reading)[0].detail.includes("fixture throw"), name);
  }
});

check("THREW · a junk record on the chain (null; no sequenceNumber) → G2_READER_THREW, never an exception", () => {
  assertBlind(call(hostileLog({ getAll: () => [null] as unknown as readonly MicaLogRecord[] }), config()), "G2_READER_THREW", "MISSING_CONFIGURATION", "null record");
  const noSeq = [{ timestamp: 0, moduleId: SUBJECT, eventType: KV, outcome: "ok" }] as unknown as readonly MicaLogRecord[];
  assertBlind(call(hostileLog({ getAll: () => noSeq }), config()), "G2_READER_THREW", "MISSING_CONFIGURATION", "no sequenceNumber");
});

check("THREW · a config, basket or list whose getter throws → G2_READER_THREW", () => {
  const throwingConfig = { readableLoadStates: ["IN_MEMORY"], get basket() { return boom(); } };
  assertBlind(call(logOf([]), throwingConfig as unknown as Gate2DirectionConfig), "G2_READER_THREW", "MISSING_CONFIGURATION", "basket getter");
  const throwingBasket = { ...basket(), get damage() { return boom(); } };
  assertBlind(call(logOf([]), withBasket(throwingBasket)), "G2_READER_THREW", "MISSING_CONFIGURATION", "damage getter");
  const throwingStates = { basket: basket(), get readableLoadStates() { return boom(); } };
  assertBlind(call(logOf([]), throwingStates as unknown as Gate2DirectionConfig), "G2_READER_THREW", "MISSING_CONFIGURATION", "states getter");
});

check("THREW · a thrown value whose toString throws still blinds with the fixed text, and never escapes", () => {
  const unrenderable = { toString: boom };
  let reading: Gate2DirectionReading | undefined;
  assert.doesNotThrow(() => { reading = call(hostileLog({ getAll: () => { throw unrenderable; } }), config()); });
  assertBlind(reading as Gate2DirectionReading, "G2_READER_THREW", "MISSING_CONFIGURATION", "unrenderable");
  assert.strictEqual(blindPaths(reading as Gate2DirectionReading)[0].detail, GATE2_THREW_UNRENDERED);
});

// Gate 1's review C1-1, carried over: a thrown text that renders but overflows
// the engine's string limit once the detail's prefix is joined to it. Built as
// a ROPE of joined halves; the limit is FOUND by trying, not imported.
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

check("THREW · C1-1: a thrown text just under the string limit blinds with the fixed text, from every caller-supplied site", () => {
  assert.ok(HUGE_THROWN.length < MAX_STRING && HUGE_THROWN.length + 200 > MAX_STRING, "fixture: renders, and overflows once wrapped");
  const throwHuge = (): never => { throw HUGE_THROWN; };
  const sites: ReadonlyArray<readonly [string, () => Gate2DirectionReading]> = [
    ["a record's outcome getter", () =>
      call(hostileLog({ getAll: () => [{ sequenceNumber: 0, timestamp: 0, moduleId: SUBJECT, eventType: KV, get outcome(): string { return throwHuge(); } }] as unknown as readonly MicaLogRecord[] }), config())],
    ["getAll", () => call(hostileLog({ getAll: throwHuge }), config())],
    ["the config's basket getter", () =>
      call(logOf([]), { readableLoadStates: ["IN_MEMORY"], get basket() { return throwHuge(); } } as unknown as Gate2DirectionConfig)],
    ["an object rendering to it", () =>
      call(hostileLog({ getAll: () => { throw { [Symbol.toPrimitive]: () => HUGE_THROWN }; } }), config())],
  ];
  for (const [name, run] of sites) {
    let reading: Gate2DirectionReading | undefined;
    assert.doesNotThrow(() => { reading = run(); }, `${name}: an exception escaped the reader`);
    assertBlind(reading as Gate2DirectionReading, "G2_READER_THREW", "MISSING_CONFIGURATION", name);
    assert.strictEqual(blindPaths(reading as Gate2DirectionReading)[0].detail, GATE2_THREW_UNRENDERED, name);
  }
});

check("THREW · getAll() handing back an endless iterable → G2_READER_THREW at once, never iterated", () => {
  let yielded = 0;
  function* endless(): Generator<MicaLogRecord> {
    for (;;) { yielded++; yield { sequenceNumber: yielded, timestamp: 0, moduleId: SUBJECT, eventType: KV, outcome: "ok" }; }
  }
  assertBlind(call(hostileLog({ getAll: () => endless() as unknown as readonly MicaLogRecord[] }), config()), "G2_READER_THREW", "MISSING_CONFIGURATION", "endless");
  assert.strictEqual(yielded, 0);
});

function lyingIterator<T>(items: readonly T[], calls: { n: number }): () => Iterator<T> {
  return function* () { calls.n++; yield* items; };
}

check("BY INDEX · the record list and a basket list carrying their own (lying) iterators are read by index — the iterators are never called", () => {
  const calls = { n: 0 };
  const records = logOf([...repeat(10, rec(KV)), rec(KD)]).getAll().slice() as MicaLogRecord[];
  Object.defineProperty(records, Symbol.iterator, { value: lyingIterator(logOf(repeat(30, rec(KD))).getAll(), calls) });
  assertBinarySilent(call(hostileLog({ getAll: () => records }), config()), "own-iterator records");
  const value = [V];
  Object.defineProperty(value, Symbol.iterator, { value: lyingIterator([{ ...V, grade: A1 }], calls) });
  const proxied = new Proxy([D], {
    get(target, key, receiver) {
      if (key === Symbol.iterator) return lyingIterator([DC], calls);
      return Reflect.get(target, key, receiver);
    },
  });
  assertBinarySilent(readOf([...repeat(10, rec(KV)), rec(KD)], { value, damage: proxied }), "own-iterator basket lists");
  assert.strictEqual(calls.n, 0, "an iterator was called");
});

check("BY INDEX · a list whose length is not a non-negative safe integer → G2_READER_THREW, nothing counted", () => {
  for (const length of [Number.POSITIVE_INFINITY, -1, 0.5, "4", Number.MAX_SAFE_INTEGER + 2]) {
    const lying = new Proxy([] as MicaLogRecord[], {
      get(target, key, receiver) { return key === "length" ? length : Reflect.get(target, key, receiver); },
    });
    assertBlind(call(hostileLog({ getAll: () => lying }), config()), "G2_READER_THREW", "MISSING_CONFIGURATION", `records length ${String(length)}`);
    const lyingValue = new Proxy([V], {
      get(target, key, receiver) { return key === "length" ? length : Reflect.get(target, key, receiver); },
    });
    assertBlind(call(logOf([]), config({ value: lyingValue })), "G2_READER_THREW", "MISSING_CONFIGURATION", `value length ${String(length)}`);
  }
});

check("SCALE · 300 000 matched records read without a throw (the predecessor's Math.min(...spread) overflowed here)", () => {
  const big: MicaLogRecord[] = [];
  for (let i = 0; i < 300000; i++) {
    big.push({ sequenceNumber: i, timestamp: 0, moduleId: SUBJECT, eventType: i % 3 === 0 ? KD : KV, outcome: "ok" });
  }
  const reading = call({ verify: () => ({ valid: true }), getLoadState: () => "IN_MEMORY", getAll: () => big }, config());
  assertBinarySilent(reading, "300k");
});

// ── the ceilings ─────────────────────────────────────────────────────────────

const DIRECTION_ONLY =
  "DIRECTION ONLY: persistence-under-unmonitoring is PERMANENTLY UNREADABLE from this evidence class (D-33); a SILENT here is silence about direction and never about persistence.";

/** One reading per route: every blind code, ALARM (latched and not), SILENT. */
function everySurface(): ReadonlyArray<readonly [string, Gate2DirectionReading]> {
  return [
    ["G2_BASKET_ABSENT", call(logOf([]), undefined)],
    ["G2_BASKET_MALFORMED", readOf([], { nMin: 0 })],
    ["G2_FRAME_ABSENT", readOf([], { frameCategories: [] })],
    ["G2_READABILITY_GATE", call(logOf([]), { basket: basket() })],
    ["G2_READER_THREW", call(hostileLog({ getAll: boom }), config())],
    ["G2_NO_CLASS_AT_GRADE", readOf([], LIVE_SHAPE)],
    ["G2_VALUE_NOT_READABLE", readOf(repeat(10, rec(KD)), { value: [] })],
    ["G2_STARVED", readOf([])],
    ["G2_UNKNOWNS_PREVENT_BOUNDING", readOf([...repeat(10, rec(KV)), rec(KU)], { unknown: [U] })],
    ["G2_DIRECTION_UNCERTAIN", readOf([...repeat(10, rec(KV)), rec(KD)], { value: [{ ...V, rhoCausal: 0.4 }] })],
    ["ALARM (latched at the record crossing nMin)", readOf([...repeat(4, rec(KD)), rec(KV)])],
    ["ALARM (latched)", readOf([...repeat(5, rec(KD)), ...repeat(20, rec(KV))])],
    ["SILENT", readOf([...repeat(10, rec(KV)), rec(KD)])],
  ];
}

check("CEILINGS · ten frozen lines, line 1 the D-33 line verbatim, every line on EVERY surface — each blind code, both ALARMs, SILENT", () => {
  assert.strictEqual(GATE2_DIRECTION_CEILING_LINES.length, 10);
  assert.strictEqual(GATE2_DIRECTION_CEILING_LINES[0], DIRECTION_ONLY);
  assert.strictEqual(GATE2_DIRECTION_CEILINGS, GATE2_DIRECTION_CEILING_LINES.join(" "));
  const seen = new Set<string>();
  for (const [name, reading] of everySurface()) {
    assertCeilinged(reading.verdict, name);
    seen.add(reading.code ?? "SILENT");
  }
  // ten blind codes, the ALARM finding code, and SILENT
  assert.strictEqual(seen.size, 12, `every route reached: ${[...seen].join(", ")}`);
});

check("CEILINGS · each line carries its contract claim (§3)", () => {
  const pieces: ReadonlyArray<readonly [number, readonly string[]]> = [
    [0, ["DIRECTION ONLY", "PERMANENTLY UNREADABLE", "(D-33)", "never about persistence"]],
    [1, ["ACTIONS, NOT CONSEQUENCES", "what an act did in the world is not on it (08e)"]],
    [2, ["UNDECLARED DAMAGE READS CLEAN", "(05a:216)"]],
    [3, ["DEPLOYER-DECLARED BASKET", "buys the read it declares (05a:217)"]],
    [4, ["LEVEL", "trajectory-level", "never a field-capacity read (05b §3a-v rider)"]],
    [5, ["PROVENANCE", "EG-1", "the clerk vouches for arrival only", "can post every caller kind (S206)"]],
    [6, ["IR UNDECLARED", "(RMBA §15)", "omission's counterfactual cost is unread", "(RMBA §9)"]],
    [7, ["NON-COMPENSATORY", "Gate 1's envelope", "Gate 4's form", "(05a:489-490)"]],
    [8, ["BINARY SILENT", "no margin and no per-class count (02d DL-1)"]],
    [9, ["NO PASS", "MICA never says yes", "(05a:185-188)"]],
  ];
  for (const [i, needed] of pieces) {
    for (const piece of needed) assert.ok(GATE2_DIRECTION_CEILING_LINES[i].includes(piece), `line ${i + 1} lacks: ${piece}`);
  }
});

check("CEILINGS · the ceiling list and every scope-block list are frozen — a push or a replace throws", () => {
  for (const [name, list] of [
    ["GATE2_DIRECTION_CEILING_LINES", GATE2_DIRECTION_CEILING_LINES],
    ["GATE2_DIRECTION_READS", GATE2_DIRECTION_READS],
    ["GATE2_DIRECTION_DOES_NOT_SEE", GATE2_DIRECTION_DOES_NOT_SEE],
    ["GATE2_DIRECTION_COMPETENCE_LINES", GATE2_DIRECTION_COMPETENCE_LINES],
  ] as const) {
    assert.ok(Object.isFrozen(list), `${name} is not frozen`);
    assert.throws(() => (list as string[]).push("INJECTED"), TypeError, `${name} accepted a push`);
    assert.throws(() => { (list as string[])[0] = "REPLACED"; }, TypeError, `${name} accepted a replace`);
  }
});

check("SCOPE · the printed scope carries every ceiling, the title and the basket's status, and is callable with no argument", () => {
  const scope = gate2DirectionScopeBlockText(config());
  assert.ok(scope.includes("PRINTED SCOPE — MICA/gate2-direction"));
  for (const line of GATE2_DIRECTION_CEILING_LINES) assert.ok(scope.includes(line), line.slice(0, 40));
  assert.ok(scope.includes(`BASKET: ${BASKET_CLASS} — declared; passes the birth checks.`));
  assert.ok(gate2DirectionScopeBlockText().includes("BASKET: G2_BASKET_ABSENT."));
});

check("§1 assessGate2Direction(log, config?) returns the SensorVerdict of the same reading", () => {
  const specs = [...repeat(5, rec(KD)), ...repeat(20, rec(KV))];
  assert.deepStrictEqual(assessGate2Direction(logOf(specs), config()), readOf(specs).verdict);
  assert.deepStrictEqual(assessGate2Direction(logOf([]), undefined), call(logOf([]), undefined).verdict);
});

// ── the floor ────────────────────────────────────────────────────────────────

const SIBLINGS = ["MICA/sibling-a", "MICA/sibling-b", "MICA/sibling-c"].map((id) => silent(id, "fixture scope"));

check("FLOOR · a Gate-2 ALARM holds the floor beside SILENT siblings: floor ALARM, HOLD, not executed", () => {
  const gate = readOf([...repeat(6, rec(KD)), rec(KV)]).verdict;
  assert.strictEqual(gate.kind, "ALARM");
  const guarded = new Chokepoint().guard({ id: "gate2-direction-floor-proof" }, [...SIBLINGS, gate], { impactClass: "not-consulted-for-alarm" });
  assert.strictEqual(guarded.decision.floorKind, "ALARM");
  assert.strictEqual(guarded.disposition, "HOLD");
  assert.strictEqual(guarded.execute, false);
});

check("FLOOR · STATED (audit ruling ①): a Gate-2 CANNOT_ASSESS keeps the floor from SILENT beside SILENT siblings", () => {
  const gate = readOf([], LIVE_SHAPE).verdict;
  const guarded = new Chokepoint().guard({ id: "gate2-no-class-floor" }, [...SIBLINGS, gate], { impactClass: "not-consulted-for-alarm" });
  assert.strictEqual(guarded.decision.floorKind, "CANNOT_ASSESS");
});

check("AUTOIMMUNITY (kept, Gate 2's half): an empty scope is NOT SILENT — an empty log, and a log of undeclared records only", () => {
  for (const [name, specs] of [["empty", []], ["undeclared only", repeat(40, rec(KX))]] as const) {
    const reading = readOf(specs);
    assert.notStrictEqual(reading.verdict.kind, "SILENT", name);
    assert.strictEqual(reading.verdict.kind, "CANNOT_ASSESS", name);
  }
});

// ── source discipline ────────────────────────────────────────────────────────

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

/** The harm branch, between its two markers; the rest of the reader is the class-basket path and its shared parts. */
const HARM_BEGIN = SOURCE.indexOf("// ⟦HARM BRANCH BEGIN⟧");
const HARM_END = SOURCE.indexOf("// ⟦HARM BRANCH END⟧");
const HARM_SECTION = SOURCE.slice(HARM_BEGIN, HARM_END);
const OUTSIDE_HARM = SOURCE.slice(0, HARM_BEGIN) + SOURCE.slice(HARM_END);

check("FENCE · the reader reads no clock, no date, no timestamp", () => {
  // AMENDED (Long Run A Stop 2, T31): the class-basket path keeps the original fence word for word; the harm
  // branch (between its markers) reads no clock either, and reads exactly TWO kinds of injected instant — a book's first
  // line, and a roster entry's (snapshotted once, then compared) — which the contract's step 3 and step 6 compare (stated in the reader).
  // AMENDED (S216): a THIRD, the witness record's own `timestamp`, compared with its origin's grant `since` (a grant
  // counts from its since). Still no clock and no Date: the since arrives as injected ms with its declared UTC spelling.
  assert.ok(HARM_BEGIN > 0 && HARM_END > HARM_BEGIN, "control: the harm markers are found");
  assert.ok(!/\.(?:timestamp|clock|date)\b/i.test(OUTSIDE_HARM));
  assert.ok(!/\bDate\s*[.(]/.test(SOURCE));
  assert.ok(!/\.(?:clock|date)\b/i.test(HARM_SECTION));
  assert.deepStrictEqual(HARM_SECTION.match(/[A-Za-z0-9_\]\[]+\.timestamp\b/g), ["out[0].timestamp", "record.timestamp", "o.timestamp", "e.timestamp"]);
});

check("FENCE (kept; two-bearer law): no predicate of a mind anywhere in the reader — outside the ceiling fence AND inside it", () => {
  const start = SOURCE.indexOf("export const GATE2_DIRECTION_CEILING_LINES");
  const end = SOURCE.indexOf("export const GATE2_DIRECTION_CEILING_FENCE_END", start);
  assert.ok(start >= 0 && end > start, "ceiling fence not found");
  const inside = SOURCE.slice(start, end).toLowerCase();
  const outside = (SOURCE.slice(0, start) + SOURCE.slice(end)).toLowerCase();
  assert.ok(inside.includes("direction only"), "control: the fence holds the ceiling lines");
  const barred = [
    "motivation", "genuine", "authentic", "sincere", "disposition", "intent", "intention", "adopted",
    "respect", "deference", "pushing", "wants", "cares", "concern", "who matters",
  ];
  for (const word of barred) {
    const pattern = new RegExp(`\\b${word}\\b`, "g");
    assert.strictEqual(outside.match(pattern)?.length ?? 0, 0, `\`${word}\` occurs outside the fence`);
    assert.strictEqual(inside.match(pattern)?.length ?? 0, 0, `\`${word}\` occurs inside the fence`);
  }
  assert.ok(!SOURCE.toLowerCase().includes("internally held"));
});

check("FENCE · the underived word is DECLARED (config.underivedWord), never a literal in the reader", () => {
  assert.ok(!SOURCE.includes(["UNDER", "IVED"].join("")), "the served underived word is spelled in the reader");
  assert.ok(HARM_SECTION.includes("h.underivedWord"), "control: the reader reads the declared word");
});

check("FENCE · no subject literal in the reader or in this test (removability)", () => {
  const forbidden = [["house", "keeper"].join(""), ["richards", "cat"].join("-"), ["claude", "bot"].join("-"), ["claude", "bot"].join("_"), ["ba", "sh"].join("")];
  const deployedUid = new RegExp(`(?<![0-9])${String(49 * 20)}(?![0-9])`);
  for (const [name, text] of [["index.ts", SOURCE], ["gate2-direction.test.ts", readFileSync(__filename, "utf8")]] as const) {
    const lower = text.toLowerCase();
    for (const word of forbidden) assert.ok(!lower.includes(word), `${name} names a subject literal`);
    assert.ok(!deployedUid.test(text), `${name} carries a deployed uid`);
  }
});

/** S216-2 · the civil-calendar block (the canonical UTC spelling by integer arithmetic), between its two markers. */
const CIVIL_BEGIN = SOURCE.indexOf("// ⟦CIVIL CALENDAR BEGIN⟧");
const CIVIL_END = SOURCE.indexOf("// ⟦CIVIL CALENDAR END⟧");
const OUTSIDE_CIVIL = SOURCE.slice(0, CIVIL_BEGIN) + SOURCE.slice(CIVIL_END);

check("FENCE · no calibration: the code's only numbers are the grade ladder (0–3), CVG's 2 and 0.5, the class id's 16 and the decimal base 10 of the exact arithmetic", () => {
  // AMENDED (S216-2): the civil-calendar block is fenced on its own below; its numbers are the calendar's, not calibration.
  assert.ok(CIVIL_BEGIN > 0 && CIVIL_END > CIVIL_BEGIN, "control: the civil-calendar markers are found");
  const numbers = codeOnly(OUTSIDE_CIVIL).match(/(?<![A-Za-z0-9_$.])\d+(?:\.\d+)?/g) ?? [];
  assert.ok(numbers.length > 0, "control: no number found at all");
  // AMENDED (T31 harm branch): 64 — the witness record hash's hex length (a clearance names one) — once, as its constant.
  assert.deepStrictEqual([...new Set(numbers)].filter((n) => !["0", "1", "2", "3", "0.5", "10", "16", "64"].includes(n)), []);
  assert.strictEqual(numbers.filter((n) => n === "64").length, 1, "64 occurs once");
  assert.ok(codeOnly(SOURCE).includes("RECORD_HASH_HEX_LENGTH = 64"), "and only as the record hash's length");
});

check("FENCE (S216-2) · the civil-calendar block holds only the proleptic Gregorian calendar's numbers, and one function", () => {
  const block = SOURCE.slice(CIVIL_BEGIN, CIVIL_END);
  const numbers = [...new Set(codeOnly(block).match(/(?<![A-Za-z0-9_$.])\d+(?:\.\d+)?/g) ?? [])].sort((a, b) => Number(a) - Number(b));
  assert.deepStrictEqual(numbers, ["0", "1", "2", "3", "4", "5", "9", "10", "60000", "100", "153", "365", "400", "1000", "1460", "3600000", "9999", "36524", "146096", "146097", "719468", "86400000"].sort((a, b) => Number(a) - Number(b)));
  assert.strictEqual((codeOnly(block).match(/\bfunction\b/g) ?? []).length, 1, "one function in the block");
  assert.ok(!/\bDate\b/.test(codeOnly(block)), "no calendar object in the block");
});

check("FENCE · no spread anywhere in the reader's code, and no Math.min / Math.max", () => {
  const code = codeOnly(SOURCE);
  assert.ok(code.includes("for (let"), "control: code survived the stripper");
  assert.ok(!code.includes("..."), "a spread is in the reader's code");
  assert.ok(!/Math\.(?:min|max)\s*\(/.test(code), "Math.min / Math.max is called");
});

check("REMOVED · the trail layer and the point margin are gone from source and exports; the kept names remain", () => {
  const exported = Object.keys(gate2);
  for (const kept of ["GATE2_DIRECTION_SENSOR_ID", "assessGate2Direction", "GATE2_DIRECTION_CEILING_LINES", "gate2DirectionScopeBlockText"]) {
    assert.ok(exported.includes(kept), `${kept} is no longer exported`);
  }
  for (const gone of ["trailLookup", "coverageFloorNum", "Gate2TrailFloorState", "marginCreditable", "G2D_", "POINT MARGIN", "valueClasses", "damageClasses"]) {
    assert.ok(!SOURCE.includes(gone), `${gone} is still in the reader`);
  }
  assert.strictEqual(GATE2_DIRECTION_SENSOR_ID, "MICA/gate2-direction");
});

// ── THE HARM BRANCH (T31 re-based on eedfda8, T32; Long Run A Stop 2 contract M1–M4) ──
//
// The Stop-1 note's §9 claim-must-fail cases, on a FIXTURE subject, frame, book, items and origins (none of
// them the served ones): subject-h / subject-o, categories h1/h2, items i-prot / i-grant / i-ctrl, origins
// o-h (one origin subject; subject-o writes records that resolve to no origin). The book is hand-built in the witness's record shape (seeingd.ts: moduleId = subject, eventType
// CONSEQUENCE@…, outcome <cat>:<effect>, witnessed{cites{subjectSeq, targetFingerprint}, fate, observed}, hash).

import { GATE2_HARM_CEILING_LINES, GATE2_HARM_CEILINGS } from "./index";
import type { Gate2ErrandGrant, Gate2GrantMemory, Gate2GrantSince, Gate2Harm, Gate2RosterEntry } from "./index";

const H_SUBJECT = "subject-h";
const H_OTHER = "subject-o";
const H_CLASS = "G2_HARM@00000000000000a1";
const H_EVENT = "CONSEQUENCE@INTEREST_LABEL@00000000000000f1";
const H_BOUNDARY_AT = 5_000_000;
const FP_PROT = "fp-prot";
const FP_GRANT = "fp-grant";
const FP_CTRL = "fp-ctrl";
const FP_ELSEWHERE = "fp-elsewhere";

/** The grant instant the fixtures default to: before every fixture record, so a listed origin is granted (S216). */
const H_SINCE = H_BOUNDARY_AT - 1000;
/** S216-2 · the canonical UTC spelling (the TEST may use the clock's calendar; the reader may not). */
function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}
/** S216-2 · one since: effective `at` (default: the declared one) and the declared one, each with its canonical spelling. */
function gs(at: number, declaredAt = at): Gate2GrantSince {
  return { at, utc: isoOf(at), declaredAt, declaredUtc: isoOf(declaredAt) };
}
/** S216-2 · the fixture grant memory (a fixture tag; the state the seeded live arc reads). */
const H_MEMORY: Gate2GrantMemory = Object.freeze({ tag: "G2_GRANT_MEMORY@00000000000000c1", state: "SEEDED" });
/** grantSince for a grant table: every listed origin counts from `since` (S216), declared at `declaredAt` (S216-2). */
function hSince(grants: Readonly<Record<string, readonly string[]>>, since = H_SINCE, declaredAt = since): Record<string, Record<string, Gate2GrantSince>> {
  const out: Record<string, Record<string, Gate2GrantSince>> = {};
  for (const id of Object.keys(grants)) {
    out[id] = {};
    for (const o of grants[id]) out[id][o] = gs(since, declaredAt);
  }
  return out;
}

function hharm(overrides: Partial<Gate2Harm> = {}): Gate2Harm {
  const base: Gate2Harm = {
    harmClass: H_CLASS,
    origins: [{ id: "o-h", subject: H_SUBJECT }],
    items: [
      { id: "i-prot", category: "h1", control: false, fingerprint: FP_PROT },
      { id: "i-grant", category: "h1", control: false, fingerprint: FP_GRANT },
      { id: "i-ctrl", category: "h2", control: true, fingerprint: FP_CTRL },
    ],
    grants: { "i-prot": [], "i-grant": ["o-h"], "i-ctrl": [] },
    grantSince: {},
    grantMemory: H_MEMORY,
    errandGrants: [],
    clearances: [],
    saltEpochSince: H_BOUNDARY_AT - 1000,
    ...overrides,
  };
  // An override that moves `grants` without naming `grantSince` gets every listed origin from H_SINCE.
  return overrides.grantSince === undefined ? { ...base, grantSince: hSince(base.grants) } : base;
}

type HLook = { state: string; type: string | null; meta: string | null; times: string | null; size: string | null; content: string | null; contentBasis: string | null };
type HAct = { seq: number; fp: string | null; observed: string; fate?: string; subject?: string; hash?: string; look?: HLook; actionId?: string; priorLookAt?: number | null };

function hHash(tag: string): string {
  let hex = "";
  for (let i = 0; i < tag.length; i++) hex += tag.charCodeAt(i).toString(16).padStart(2, "0");
  return hex.padEnd(64, "0").slice(0, 64);
}

/** One witness record for the act with subjectSeq `a.seq`, at book position `pos`. */
function hRecord(a: HAct, pos: number, bookTag: string): Record<string, unknown> {
  const fate = a.fate ?? "RAN";
  const effect = fate.startsWith("LATE") ? "LATE" : fate === "HELD" ? "HELD" : a.observed;
  return {
    recordType: "SUBJECT_EVENT", sequenceNumber: pos, timestamp: H_BOUNDARY_AT + pos, moduleId: a.subject ?? H_SUBJECT,
    eventType: H_EVENT, outcome: `h1:${effect}`, actionId: a.actionId ?? `act-${a.seq}`, hash: a.hash ?? hHash(`${bookTag}-${pos}`),
    witnessed: { cites: { chain: null, subjectSeq: a.seq, targetFingerprint: a.fp }, fate, observed: a.observed, ...(a.look === undefined ? {} : { look: a.look }), ...(a.priorLookAt === null ? {} : { priorLookAt: a.priorLookAt ?? H_BOUNDARY_AT + pos - 1 }) },
  };
}

/** A book: its boundary line at position 0, then one record per act, in order. */
function hBook(acts: readonly HAct[], boundaryAt = H_BOUNDARY_AT, bookTag = "cur", sourcePath?: string): MicaReadableLog {
  const records: Record<string, unknown>[] = [
    { recordType: "SUBJECT_LOG_BOUNDARY", sequenceNumber: 0, timestamp: boundaryAt, moduleId: "witness-fixture", eventType: "SUBJECT_LOG_BOUNDARY", outcome: "boundary", hash: hHash(`${bookTag}-b`) },
  ];
  acts.forEach((a, i) => records.push(hRecord(a, i + 1, bookTag)));
  const log: MicaReadableLog & { sourcePath?: string } = {
    verify: () => ({ valid: true }),
    getLoadState: () => "IN_MEMORY",
    getAll: () => records as unknown as readonly MicaLogRecord[],
  };
  if (sourcePath !== undefined) log.sourcePath = sourcePath;
  return log;
}

function hRoster(seqs: readonly number[], labels: Readonly<Record<number, string>> = {}): Gate2RosterEntry[] {
  return seqs.map((seq) => ({ subjectSeq: seq, actionId: `act-${seq}`, label: labels[seq] ?? "h1", timestamp: H_BOUNDARY_AT + seq }));
}

function hConfig(over: Partial<Gate2DirectionConfig> = {}, harmOver: Partial<Gate2Harm> = {}): Gate2DirectionConfig {
  return {
    readableLoadStates: ["IN_MEMORY"],
    harm: hharm(harmOver),
    roster: hRoster([11, 12, 13, 14, 15]),
    decidingActionId: null,
    predecessors: [],
    bookBoundaryAt: H_BOUNDARY_AT,
    ...over,
  };
}

function hRead(acts: readonly HAct[], over: Partial<Gate2DirectionConfig> = {}, harmOver: Partial<Gate2Harm> = {}): Gate2DirectionReading {
  return call(hBook(acts), hConfig(over, harmOver));
}

function assertHarmCeilinged(verdict: SensorVerdict, context: string): void {
  assert.strictEqual(verdict.sensorId, GATE2_DIRECTION_SENSOR_ID, context);
  for (const line of GATE2_HARM_CEILING_LINES) {
    assert.ok(verdict.summary.includes(line), `${context}: omitted harm ceiling: ${line.slice(0, 50)}`);
  }
  assert.ok(!verdict.summary.includes(GATE2_DIRECTION_CEILING_LINES[1]), `${context}: the class line 2 (false on the book) is printed`);
}

function assertHarmBlind(reading: Gate2DirectionReading, code: string, context: string): void {
  assert.strictEqual(reading.verdict.kind, "CANNOT_ASSESS", `${context}: kind was ${reading.verdict.kind} (${String(reading.code)})`);
  assert.strictEqual(reading.code, code, `${context}: code was ${String(reading.code)}`);
  assert.ok(reading.verdict.summary.includes(`Blind reason code: ${code}.`), `${context}: code not printed`);
  assert.strictEqual(reading.latchedSince, null, context);
  assertHarmCeilinged(reading.verdict, context);
}

function assertHarmAlarm(reading: Gate2DirectionReading, context: string): AlarmVerdict {
  assert.strictEqual(reading.verdict.kind, "ALARM", `${context}: kind was ${reading.verdict.kind} (${String(reading.code)}) ${reading.verdict.summary.slice(0, 300)}`);
  assert.strictEqual(reading.code, "G2_UNGRANTED_CHANGE_ON_ITEM", context);
  const v = reading.verdict as AlarmVerdict;
  assert.deepStrictEqual(v.findings.map((f) => f.code), ["G2_UNGRANTED_CHANGE_ON_ITEM"], context);
  for (const always of [
    "A change by ANY writer between two looks — the deployer's own edit included — is billed to the bound origin.",
    "The first look at an item cannot alarm.",
    "Origin names the principal the bridge binds the act to, never the human or errand behind it.",
  ]) assert.ok(v.findings[0].detail.includes(always), `${context}: lacks ${always}`);
  assert.ok(v.summary.includes("RECORDER (the current book only)"), `${context}: no recorder`);
  assertHarmCeilinged(v, context);
  return v;
}

function assertHarmSilent(reading: Gate2DirectionReading, context: string): string {
  assert.strictEqual(reading.verdict.kind, "SILENT", `${context}: kind was ${reading.verdict.kind} (${String(reading.code)}) ${reading.verdict.summary.slice(0, 400)}`);
  assert.strictEqual(reading.code, null, context);
  assert.ok(reading.verdict.summary.includes(H_CLASS), `${context}: harmClass missing`);
  assert.ok(reading.verdict.summary.includes("RECORDER (the current book only)"), `${context}: the recorder's facts are printed beside a SILENT (F-E)`);
  for (const forbidden of ["LB=", "B_g=", "margin=", "BOUNDS"]) assert.ok(!reading.verdict.summary.includes(forbidden), `${context}: a SILENT printed ${forbidden}`);
  assertHarmCeilinged(reading.verdict, context);
  return reading.verdict.summary;
}

/** The look before the change: a FIRST_SEEN on i-prot by act 11. */
const LOOK_PROT: HAct = { seq: 11, fp: FP_PROT, observed: "FIRST_SEEN" };

check("HARM §9.1 · an UNGRANTED DIFFERS on an item → ALARM, LATCHED, naming the act whose record shows it and the act whose decision carries it", () => {
  const acts: HAct[] = [LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS" }];
  // before the change is on the book, the carried act's FIRST_SEEN is quiet
  assertHarmSilent(hRead([LOOK_PROT], { decidingActionId: "act-12" }), "before");
  const r = hRead(acts, { decidingActionId: "act-13" });
  const v = assertHarmAlarm(r, "ungranted");
  assert.strictEqual(r.latchedSince, 2, "latched at the record's own seq in the current book");
  const d = v.findings[0].detail;
  assert.ok(d.includes("The act whose record shows the change: the current book seq 2 (its act: subjectSeq 12, actionId \"act-12\"; fate RAN; observed CONTENT_DIFFERS; item i-prot; origin o-h)"), d);
  assert.ok(d.includes("The act whose decision carries it: the act \"act-13\"."), d);
  assert.ok(d.includes("nothing on the record says the act whose decision carries it caused it"), d);
  assert.ok(d.includes("LATCHED since seq 2 of the current book."), d);
  // LATCHED: later acts reading SAME on the item, decided later, do not lift it
  const later = hRead([...acts, { seq: 13, fp: FP_PROT, observed: "SAME" }, { seq: 14, fp: FP_GRANT, observed: "FIRST_SEEN" }], { decidingActionId: "act-15" });
  assertHarmAlarm(later, "latched");
  assert.strictEqual(later.latchedSince, 2);
  // a status read carries it too
  assert.ok(assertHarmAlarm(hRead(acts), "status").findings[0].detail.includes("The act whose decision carries it: a status read."));
});

check("HARM §9.1 · each DIFFERS facet alarms on an ungranted item, a CONTROL item says so, and another origin without a grant alarms on a granted item", () => {
  for (const facet of ["EXISTENCE_DIFFERS", "TYPE_DIFFERS", "CONTENT_DIFFERS", "META_DIFFERS"]) {
    assertHarmAlarm(hRead([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: facet }]), facet);
  }
  const ctrl = assertHarmAlarm(hRead([{ seq: 11, fp: FP_CTRL, observed: "FIRST_SEEN" }, { seq: 12, fp: FP_CTRL, observed: "META_DIFFERS" }]), "control");
  assert.ok(ctrl.findings[0].detail.includes("is a declared CONTROL item: the subject cannot change it, so a DIFFERS here is another writer's change or a failure of that assumption"));
  // another subject's change on a GRANTED item is never read as the granted origin's: its origin is not readable
  assertHarmBlind(hRead([{ seq: 11, fp: FP_GRANT, observed: "FIRST_SEEN", subject: H_OTHER }, { seq: 12, fp: FP_GRANT, observed: "CONTENT_DIFFERS", subject: H_OTHER }]), "G2_ORIGIN_NOT_READABLE", "other subject on a granted item");
});

check("HARM §9.2 · a GRANTED DIFFERS → SILENT with \"granted: <origin> on <item>\" and the harm ceilings, never ALARM", () => {
  const acts: HAct[] = [{ seq: 11, fp: FP_GRANT, observed: "FIRST_SEEN" }, { seq: 12, fp: FP_GRANT, observed: "CONTENT_DIFFERS" }];
  const s = assertHarmSilent(hRead(acts, { decidingActionId: "act-13" }), "granted");
  assert.ok(s.includes("granted: o-h on i-grant"), s);
  for (const fate of ["HELD", "LATE_UNGUARDED"]) {
    const g = hRead([{ seq: 11, fp: FP_GRANT, observed: "FIRST_SEEN" }, { seq: 12, fp: FP_GRANT, observed: "EXISTENCE_DIFFERS", fate }], { decidingActionId: "act-13" });
    assert.notStrictEqual(g.verdict.kind, "ALARM", fate);
  }
});

check("HARM §9.3 · NO RECORD for the carried act → CANNOT_ASSESS · G2_NOT_READABLE, the summary BEGINNING \"NOT READABLE:\" with its reason; never SILENT, never ALARM", () => {
  // THE UNDERIVED WORD IS DECLARED, never a literal in the reader: a fixture word here, not the served one
  const underived = hRead([LOOK_PROT], { roster: hRoster([11, 12, 13], { 12: "NO-CATEGORY-H" }), decidingActionId: "act-13", underivedWord: "NO-CATEGORY-H" });
  assertHarmBlind(underived, "G2_NOT_READABLE", "underived");
  assert.ok(underived.verdict.summary.startsWith("NOT READABLE: the carried act (subjectSeq 12"), underived.verdict.summary.slice(0, 200));
  assert.ok(underived.verdict.summary.includes("its claimed target is placed in no frame category (NO-CATEGORY-H), so the witness was never pointed"));
  assert.ok(underived.verdict.summary.includes("without (underived (\"NO-CATEGORY-H\") 1; other — pending or lost — 1)"), underived.verdict.summary);
  // the same label with NO word declared (absent, and null): the generic reason, the label quoted, nothing told apart
  for (const word of [undefined, null] as const) {
    const generic = hRead([LOOK_PROT], { roster: hRoster([11, 12, 13], { 12: "NO-CATEGORY-H" }), decidingActionId: "act-13", underivedWord: word });
    assertHarmBlind(generic, "G2_NOT_READABLE", `no word (${String(word)})`);
    assert.ok(generic.verdict.summary.startsWith("NOT READABLE: "), generic.verdict.summary.slice(0, 120));
    assert.ok(generic.verdict.summary.includes("the witness has written no record for it (pending, or lost, or never pointed); its label is \"NO-CATEGORY-H\""), generic.verdict.summary.slice(0, 400));
    assert.ok(!generic.verdict.summary.includes("so the witness was never pointed"), `no word (${String(word)}): the underived reason without a declared word`);
    assert.ok(generic.verdict.summary.includes("no underived word declared, so none is told apart: 2"), generic.verdict.summary);
  }
  // a word declared that is NOT the label: generic too
  const otherWord = hRead([LOOK_PROT], { roster: hRoster([11, 12, 13], { 12: "NO-CATEGORY-H" }), decidingActionId: "act-13", underivedWord: "SOMETHING-ELSE" });
  assert.ok(otherWord.verdict.summary.includes("its label is \"NO-CATEGORY-H\""));
  const pending = hRead([LOOK_PROT], { roster: hRoster([11, 12, 13]), decidingActionId: "act-13" });
  assertHarmBlind(pending, "G2_NOT_READABLE", "pending");
  assert.ok(pending.verdict.summary.startsWith("NOT READABLE: "), pending.verdict.summary.slice(0, 120));
  assert.ok(pending.verdict.summary.includes("the witness has written no record for it (pending, or lost, or never pointed)"));
  // the newest act carried on a status read; the deciding act not yet on the roster
  const status = hRead([LOOK_PROT], { roster: hRoster([11, 12]) });
  assert.ok(status.verdict.summary.includes("no deciding act (a status read); the newest act in the interest book's order is carried"), status.verdict.summary.slice(0, 300));
  const unknownDeciding = hRead([LOOK_PROT], { roster: hRoster([11, 12]), decidingActionId: "act-99" });
  assert.ok(unknownDeciding.verdict.summary.includes("the deciding act is not yet on the roster; the newest act in the interest book's order is carried"));
  // an empty roster since the boundary is NOT READABLE too; a missing roster is ROSTER_NOT_READABLE
  const empty = hRead([LOOK_PROT], { roster: [] });
  assertHarmBlind(empty, "G2_NOT_READABLE", "empty roster");
  assert.ok(empty.verdict.summary.startsWith("NOT READABLE: "));
  const before = hRead([LOOK_PROT], { roster: [{ subjectSeq: 11, actionId: "act-11", label: "h1", timestamp: H_BOUNDARY_AT - 1 }] });
  assertHarmBlind(before, "G2_NOT_READABLE", "roster before the boundary");
  for (const roster of [undefined, null] as const) {
    assertHarmBlind(hRead([LOOK_PROT], { roster }), "G2_ROSTER_NOT_READABLE", `roster ${String(roster)}`);
  }
  assertHarmBlind(hRead([LOOK_PROT], { roster: [{ subjectSeq: -1, actionId: "x", label: "h1", timestamp: H_BOUNDARY_AT }] }), "G2_ROSTER_NOT_READABLE", "junk roster");
  // the deciding act is the first act since the boundary: nothing is carried
  assertHarmBlind(hRead([LOOK_PROT], { roster: hRoster([11, 12]), decidingActionId: "act-11" }), "G2_NOT_READABLE", "nothing before the deciding act");
});

check("HARM §9.4 · a LATE or HELD ungranted DIFFERS → ALARM on the next decision, naming both acts, with \"did not cause it\" (LATE) and \"did not execute\" (HELD)", () => {
  // evasion 6.w · each LATE fate in its own words
  const lateWords: Readonly<Record<string, string>> = {
    LATE_UNGUARDED: "LATE_UNGUARDED (LATE): the act whose record shows the change ran unguarded (no /guard answer)",
    LATE_NO_DECISION: "LATE_NO_DECISION (LATE): the act whose record shows the change closed, but its decision was not known to the witness",
    LATE_TIMEOUT: "LATE_TIMEOUT (LATE): no close of the act whose record shows the change reached the witness; whether and when that act ran is unknown",
    LATE_PENDING_CAP: "LATE_PENDING_CAP (LATE): no close of the act whose record shows the change reached the witness; whether and when that act ran is unknown",
  };
  for (const fate of ["LATE_UNGUARDED", "LATE_NO_DECISION", "LATE_TIMEOUT", "LATE_PENDING_CAP"]) {
    const v = assertHarmAlarm(hRead([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS", fate }], { decidingActionId: "act-13" }), fate);
    const d = v.findings[0].detail;
    assert.ok(d.includes(lateWords[fate]), d);
    assert.ok(d.includes("nothing on the record says the act whose decision carries it caused it"), d);
    assert.ok(d.includes("The act whose decision carries it: the act \"act-13\"."), d);
  }
  const held = assertHarmAlarm(hRead([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "EXISTENCE_DIFFERS", fate: "HELD" }], { decidingActionId: "act-13" }), "HELD");
  // M4 · "carrying act" is the DECIDING act everywhere; the HELD act is the one whose record shows the change
  assert.ok(held.findings[0].detail.includes("HELD: the act whose record shows the change did not execute (its own decision held it); the item changed between looks, by some writer."), held.findings[0].detail);
  assert.ok(!held.findings[0].detail.includes("the carrying act did not execute"));
  for (const r of [held]) assert.ok(!/carrying act (?:did|was)/.test(r.summary), "no line makes the carrying act the one that ran or was held");
});

check("HARM §9.5 · RESTART: the latch is re-derived from the book (a fresh read of the same bytes is the same ALARM); RETIREMENT: a latch in a predecessor book holds", () => {
  const acts: HAct[] = [LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS" }];
  const first = hRead(acts, { decidingActionId: "act-13" });
  const again = hRead(acts, { decidingActionId: "act-13" });
  assert.deepStrictEqual(again, first, "a restart re-reads the same latch");
  // retirement: the change is on the RETIRED book; the current book (newer, inside the epoch) is quiet
  const retired = hBook(acts, H_BOUNDARY_AT - 500, "old", "/fixture/dir/book-of-effects.retired-1.jsonl");
  const cur = hBook([{ seq: 13, fp: FP_PROT, observed: "SAME" }], H_BOUNDARY_AT + 100, "new");
  const r = call(cur, hConfig({ predecessors: [retired], bookBoundaryAt: H_BOUNDARY_AT + 100, decidingActionId: "act-14" }));
  const v = assertHarmAlarm(r, "retired");
  assert.strictEqual(r.latchedSince, null, "not on the current book");
  assert.ok(v.findings[0].detail.includes("LATCHED in predecessor book-of-effects.retired-1.jsonl"), v.findings[0].detail);
  assert.ok(v.summary.includes("PREDECESSOR BOOKS (named, NEVER summed into these counts): book-of-effects.retired-1.jsonl (2 record(s), latch only)"), v.summary);
  // the predecessor's records are NEVER summed into the recorder's counts
  assert.ok(v.summary.includes("n by facet×category SAME×h1=1;"), v.summary);
});

check("HARM §9.6 · a C1 CLEARANCE naming the record's hash clears the latch; one naming another record does not", () => {
  const changed: HAct = { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS", hash: hHash("the-change") };
  const acts: HAct[] = [LOOK_PROT, changed];
  assertHarmAlarm(hRead(acts, { decidingActionId: "act-13" }, { clearances: [hHash("another-record")] }), "another record");
  const cleared = hRead(acts, { decidingActionId: "act-13" }, { clearances: [hHash("the-change")] });
  const s = assertHarmSilent(cleared, "cleared");
  assert.ok(s.includes(`cleared by the doctor's clearance ${hHash("the-change").slice(0, 16)}`), s);
  // cleared in a predecessor too
  const retired = hBook(acts, H_BOUNDARY_AT - 500, "old", "/fixture/dir/retired.jsonl");
  const cur = hBook([{ seq: 13, fp: FP_PROT, observed: "SAME" }], H_BOUNDARY_AT + 100, "new");
  const lateRoster = [{ subjectSeq: 13, actionId: "act-13", label: "h1", timestamp: H_BOUNDARY_AT + 200 }, { subjectSeq: 14, actionId: "act-14", label: "h1", timestamp: H_BOUNDARY_AT + 300 }];
  const cfg = (clearances: string[]) => hConfig({ predecessors: [retired], bookBoundaryAt: H_BOUNDARY_AT + 100, decidingActionId: "act-14", roster: lateRoster }, { clearances });
  assertHarmAlarm(call(cur, cfg([])), "predecessor uncleared");
  assertHarmSilent(call(cur, cfg([hHash("the-change")])), "predecessor cleared");
});

check("HARM §9.7 · TWO SPELLINGS: after B-1 both spellings carry the item's fingerprint and match once; the pre-B-1 claim fingerprint of a quoted spelling MISSES (the documented ceiling)", () => {
  // after B-1: the quoted spelling's pointer fingerprint is the looked-at path's → matched → its DIFFERS alarms
  assertHarmAlarm(hRead([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS" }]), "after B-1");
  // before B-1: the quoted spelling's fingerprint is the CLAIM's, not the item's → off-basket, unread
  const miss = hRead([LOOK_PROT, { seq: 12, fp: "fp-prot-as-quoted-claim", observed: "CONTENT_DIFFERS" }], { decidingActionId: "act-13" });
  const s = assertHarmSilent(miss, "pre-B-1 miss");
  assert.ok(s.includes("The record is on no declared item (off-basket"), s);
  assert.ok(GATE2_HARM_CEILING_LINES.some((l) => l.startsWith("EXACT PATHS ONLY:")), "the ceiling says so");
});

check("HARM §9.8 · an OFF-BASKET DIFFERS is noted in the recorder, carries no sign, and never alarms", () => {
  const acts: HAct[] = [{ seq: 11, fp: FP_ELSEWHERE, observed: "FIRST_SEEN" }, { seq: 12, fp: FP_ELSEWHERE, observed: "CONTENT_DIFFERS" }, { seq: 13, fp: null, observed: "EXISTENCE_DIFFERS" }];
  for (const deciding of [null, "act-13", "act-14"]) {
    const r = hRead(acts, { decidingActionId: deciding, roster: hRoster(deciding === null ? [11, 12, 13] : [11, 12, 13, 14]) });
    const s = assertHarmSilent(r, `off-basket at ${String(deciding)}`);
    assert.ok(s.includes("CONTENT_DIFFERS×h1=1"), s);
    assert.ok(s.includes("records on items 0;"), s);
  }
});

check("HARM §9.9 · FIRST_SEEN on an item → NEVER ALARM (the baseline rule): the first look is quiet whatever follows off the item", () => {
  for (const fp of [FP_PROT, FP_CTRL, FP_GRANT]) {
    const r = hRead([{ seq: 11, fp, observed: "FIRST_SEEN" }], { decidingActionId: "act-12" });
    assertHarmSilent(r, `first look ${fp}`);
  }
  // the witness forgot the item and reads FIRST_SEEN again: still quiet (the ceiling says so)
  assertHarmSilent(hRead([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "FIRST_SEEN" }], { decidingActionId: "act-13" }), "re-seen");
});

check("HARM §9.10 · a config WITHOUT harm reads byte-identically on every class-basket surface: the same reading with the harm-only keys present as undefined", () => {
  for (const [name, reading] of everySurface()) {
    assert.ok(reading.verdict.summary.includes(GATE2_DIRECTION_CEILINGS), name);
    assert.ok(!reading.verdict.summary.includes(GATE2_HARM_CEILING_LINES[1]), `${name}: a harm line on the class path`);
  }
  const specs = [...repeat(5, rec(KD)), ...repeat(20, rec(KV))];
  const plain = readOf(specs);
  const withUndefined = call(logOf(specs), { ...config(), harm: undefined } as Gate2DirectionConfig);
  assert.deepStrictEqual(withUndefined, plain);
});

check("HARM · UNOBSERVABLE on the carried act's item, or a HELD/LATE act without a DIFFERS → CANNOT_ASSESS · G2_UNKNOWN_ON_ITEM, never quiet", () => {
  assertHarmBlind(hRead([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "UNOBSERVABLE" }], { decidingActionId: "act-13" }), "G2_UNKNOWN_ON_ITEM", "unobservable");
  for (const fate of ["HELD", "LATE_TIMEOUT"]) {
    for (const observed of ["SAME", "FIRST_SEEN"]) {
      assertHarmBlind(hRead([LOOK_PROT, { seq: 12, fp: FP_PROT, observed, fate }], { decidingActionId: "act-13" }), "G2_UNKNOWN_ON_ITEM", `${fate}/${observed}`);
    }
  }
  assertHarmSilent(hRead([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "SAME" }], { decidingActionId: "act-13" }), "SAME at a RAN act");
});

check("HARM · an ORIGIN that is not declared: a DIFFERS on an item → G2_ORIGIN_NOT_READABLE (unless an ALARM is established elsewhere); the carried act's subjectSeq under another subject is NOT READABLE", () => {
  const stranger: HAct = { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS", subject: "subject-z" };
  assertHarmBlind(hRead([LOOK_PROT, stranger], { decidingActionId: "act-14" }), "G2_ORIGIN_NOT_READABLE", "unresolved differs");
  assertHarmAlarm(hRead([LOOK_PROT, stranger, { seq: 13, fp: FP_CTRL, observed: "FIRST_SEEN" }, { seq: 14, fp: FP_CTRL, observed: "TYPE_DIFFERS" }]), "an ALARM elsewhere wins");
  // m2 · a record of another subject is never the carried act's (one origin subject, matched by moduleId): NOT READABLE
  assertHarmBlind(hRead([{ seq: 11, fp: FP_PROT, observed: "SAME", subject: "subject-z" }], { decidingActionId: "act-12" }), "G2_NOT_READABLE", "carried act's subjectSeq written by another subject");
});

check("HARM · MEMBERSHIP (A-5): no salt epoch, no boundary, or a book begun before the epoch → G2_MEMBERSHIP_NOT_READABLE, items unread — even over a DIFFERS on an item", () => {
  const acts: HAct[] = [LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS" }];
  const cases: ReadonlyArray<readonly [string, Gate2DirectionReading]> = [
    ["no epoch", hRead(acts, {}, { saltEpochSince: null })],
    ["no boundary", hRead(acts, { bookBoundaryAt: null })],
    ["boundary absent", hRead(acts, { bookBoundaryAt: undefined })],
    ["before the epoch", hRead(acts, {}, { saltEpochSince: H_BOUNDARY_AT + 1 })],
  ];
  for (const [name, r] of cases) {
    assertHarmBlind(r, "G2_MEMBERSHIP_NOT_READABLE", name);
    assert.ok(r.verdict.summary.includes("records on items NOT READ (membership)"), name);
  }
  assertHarmAlarm(hRead(acts, {}, { saltEpochSince: H_BOUNDARY_AT }), "the boundary AT the epoch is inside it");
});

check("HARM · a PREDECESSOR before the epoch or unreadable: its records are excluded and the verdict says so — CANNOT_ASSESS unless an ALARM stands from the readable books", () => {
  const old = hBook([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS" }], H_BOUNDARY_AT - 2000, "old", "/fixture/dir/old.jsonl");
  const quiet = hBook([{ seq: 13, fp: FP_PROT, observed: "SAME" }], H_BOUNDARY_AT, "new");
  const r = call(quiet, hConfig({ predecessors: [old], decidingActionId: "act-14" }));
  assertHarmBlind(r, "G2_MEMBERSHIP_NOT_READABLE", "predecessor before the epoch");
  assert.ok(r.verdict.summary.includes("old.jsonl (its records are EXCLUDED from the latch"), r.verdict.summary);
  const broken: MicaReadableLog & { sourcePath: string } = { verify: () => ({ valid: false, brokenAt: 1 }), getLoadState: () => "IN_MEMORY", getAll: () => [], sourcePath: "/fixture/dir/missing.jsonl" };
  const lost = call(quiet, hConfig({ predecessors: [broken], decidingActionId: "act-14" }));
  assertHarmBlind(lost, "G2_PREDECESSOR_NOT_READABLE", "predecessor unreadable");
  assert.ok(lost.verdict.summary.includes("missing.jsonl"), lost.verdict.summary);
  // an ALARM from the readable books is never hidden by an unreadable predecessor
  const alarming = hBook([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS" }], H_BOUNDARY_AT, "new2");
  assertHarmAlarm(call(alarming, hConfig({ predecessors: [broken, old] })), "alarm over unreadable predecessors");
});

check("HARM · the harm basket is checked ONCE and refused on every malformation (G2_HARM_MALFORMED), unknown keys included — never ignored", () => {
  const malformed: ReadonlyArray<readonly [string, Gate2DirectionConfig]> = [
    ["basket AND harm", { ...hConfig(), basket: basket() } as Gate2DirectionConfig],
    ["unknown config key", { ...hConfig(), extra: 1 } as unknown as Gate2DirectionConfig],
    ["unknown harm key", hConfig({}, { extra: 1 } as unknown as Partial<Gate2Harm>)],
    ["unknown origin key", hConfig({}, { origins: [{ id: "o-h", subject: H_SUBJECT, extra: 1 } as never] })],
    ["unknown item key", hConfig({}, { items: [{ id: "i-prot", category: "h1", control: false, fingerprint: FP_PROT, extra: 1 } as never], grants: { "i-prot": [] } })],
    ["harmClass shape", hConfig({}, { harmClass: "G2_HARM@XYZ" })],
    ["harmClass upper hex", hConfig({}, { harmClass: "G2_HARM@00000000000000A1" })],
    ["no origin", hConfig({}, { origins: [], grants: { "i-prot": [], "i-grant": [], "i-ctrl": [] } })],
    ["no item", hConfig({}, { items: [], grants: {} })],
    ["origin id twice", hConfig({}, { origins: [{ id: "o-h", subject: H_SUBJECT }, { id: "o-h", subject: H_OTHER }] })],
    ["two origin subjects (m2: one subject until per-subject rosters)", hConfig({}, { origins: [{ id: "o-h", subject: H_SUBJECT }, { id: "o-o", subject: H_OTHER }] })],
    ["a null fingerprint while the bridge holds a salt epoch (m3)", hConfig({}, { items: [{ id: "i-prot", category: "h1", control: false, fingerprint: null }], grants: { "i-prot": [] } })],
    ["subject bound twice", hConfig({}, { origins: [{ id: "o-h", subject: H_SUBJECT }, { id: "o-o", subject: H_SUBJECT }] })],
    ["item id twice", hConfig({}, { items: [{ id: "i-prot", category: "h1", control: false, fingerprint: FP_PROT }, { id: "i-prot", category: "h1", control: false, fingerprint: FP_GRANT }], grants: { "i-prot": [] } })],
    ["one fingerprint, two items", hConfig({}, { items: [{ id: "i-prot", category: "h1", control: false, fingerprint: FP_PROT }, { id: "i-two", category: "h1", control: false, fingerprint: FP_PROT }], grants: { "i-prot": [], "i-two": [] } })],
    ["item without grants", hConfig({}, { grants: { "i-prot": [], "i-grant": ["o-h"] } })],
    ["grant for an undeclared item", hConfig({}, { grants: { "i-prot": [], "i-grant": ["o-h"], "i-ctrl": [], "i-none": [] } })],
    ["grant naming an undeclared origin", hConfig({}, { grants: { "i-prot": ["o-none"], "i-grant": ["o-h"], "i-ctrl": [] } })],
    ["grant repeats an origin", hConfig({}, { grants: { "i-prot": [], "i-grant": ["o-h", "o-h"], "i-ctrl": [] } })],
    ["clearance not 64 hex", hConfig({}, { clearances: ["abc"] })],
    ["clearance upper hex", hConfig({}, { clearances: ["A".repeat(64)] })],
    ["clearance twice", hConfig({}, { clearances: ["a".repeat(64), "a".repeat(64)] })],
    ["control not boolean", hConfig({}, { items: [{ id: "i-prot", category: "h1", control: "no" as never, fingerprint: FP_PROT }], grants: { "i-prot": [] } })],
    ["epoch not a number", hConfig({}, { saltEpochSince: "now" as never })],
    ["boundary not a number", hConfig({ bookBoundaryAt: Number.NaN })],
    ["deciding act empty", hConfig({ decidingActionId: "" })],
    ["predecessor not a log", hConfig({ predecessors: [{} as never] })],
    ["underived word empty", hConfig({ underivedWord: "" })],
    ["underived word not a string", hConfig({ underivedWord: 1 as never })],
  ];
  for (const [name, cfg] of malformed) {
    const r = call(hBook([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS" }]), cfg);
    assertHarmBlind(r, "G2_HARM_MALFORMED", name);
  }
  assert.ok(gate2DirectionScopeBlockText(hConfig()).includes(`HARM BASKET: ${H_CLASS} — declared; passes the birth checks.`));
  assert.ok(gate2DirectionScopeBlockText(hConfig({}, { harmClass: "x" })).includes("HARM BASKET: G2_HARM_MALFORMED."));
});

check("HARM · readability gate and THREW: an unreadable book or a throw inside the harm branch is blind with the HARM ceilings", () => {
  assertHarmBlind(call(hBook([]), hConfig({ readableLoadStates: ["SOMETHING_ELSE"] })), "G2_READABILITY_GATE", "untrusted state");
  const broken: MicaReadableLog = { verify: () => ({ valid: false, brokenAt: 3 }), getLoadState: () => "IN_MEMORY", getAll: () => [] };
  assertHarmBlind(call(broken, hConfig()), "G2_READABILITY_GATE", "broken chain");
  assertHarmBlind(call(hostileLog({ getAll: boom }), hConfig()), "G2_READER_THREW", "getAll throws");
  const junk: MicaReadableLog = { verify: () => ({ valid: true }), getLoadState: () => "IN_MEMORY", getAll: () => [null] as unknown as readonly MicaLogRecord[] };
  assertHarmBlind(call(junk, hConfig()), "G2_READER_THREW", "junk record");
  const throwingHarm = { ...hConfig(), get roster() { return boom(); } };
  assertHarmBlind(call(hBook([]), throwingHarm as unknown as Gate2DirectionConfig), "G2_READER_THREW", "roster getter");
});

check("HARM CEILINGS (T32) · fifteen frozen lines: 1,3,5,8,10 of the class list VERBATIM, 2 and 6 replaced, 4, 7 and 9 varied for the harm basket, five added; the class list unchanged", () => {
  // AMENDED (S216): an eighteenth line, the since's.
  // AMENDED (S216-2, cond. 6): 18 -> 19, the bridge's grant memory as a second memory.
  // AMENDED (S208-2): a nineteenth, the errand's. AMENDED (relay-3 assembly, S216-2 × T35): both land, 19 -> 20;
  // the second memory stays line 19 (index 18) and the errand's becomes line 20 (index 19).
  assert.strictEqual(GATE2_HARM_CEILING_LINES.length, 20);
  assert.ok(GATE2_HARM_CEILING_LINES[17].startsWith("A GRANT COUNTS FROM ITS SINCE: "), GATE2_HARM_CEILING_LINES[17]);
  assert.ok(GATE2_HARM_CEILING_LINES[19].startsWith("AN ERRAND GRANT PERMITS A WINDOW, NOT AN ACT: ") && GATE2_HARM_CEILING_LINES[19].includes("S217"), GATE2_HARM_CEILING_LINES[19]);
  // AA2 · the three clocks in ONE sentence: the arbiter's typed instants against the bridge's stamp, the close at the
  // bridge's stamp, the look on the witness's clock, and the unmeasured skew between the two machines' clocks.
  const clocks = GATE2_HARM_CEILING_LINES[19].split(/(?<=\.) /).filter((x) => x.startsWith("THREE CLOCKS MEET IN ONE ERRAND: "));
  assert.strictEqual(clocks.length, 1, "line 20 carries the three-clocks sentence exactly once");
  for (const w of ["the arbiter's typed instants", "the bridge's stamp on the granting record", "the bridge's stamp on the closing record", "the witness's clock", "skew"]) assert.ok(clocks[0].includes(w), `the three-clocks sentence names ${w}: ${clocks[0]}`);
  for (const i of [0, 2, 4, 7, 9]) assert.strictEqual(GATE2_HARM_CEILING_LINES[i], GATE2_DIRECTION_CEILING_LINES[i], `line ${i + 1}`);
  // M6 + m1 · the varied lines name the harm basket's own objects, horizon and recorder
  assert.strictEqual(GATE2_HARM_CEILING_LINES[3], "DEPLOYER-DECLARED BASKET: the items, origins and grants are the deployer's and the clearances the doctor's; a self-serving basket buys the read it declares (05a:217).");
  assert.strictEqual(GATE2_HARM_CEILING_LINES[6], "IR UNDECLARED: no irreversibility class is on this record (RMBA §15); omission's counterfactual cost is unread; the horizon is the current book, and its declared predecessors for the latch only (RMBA §9).");
  assert.strictEqual(GATE2_HARM_CEILING_LINES[8], "BINARY SILENT: a SILENT prints no margin; the recorder's counts beside it are facts of the book, not a distance to an ALARM (DL-1; F-E).");
  for (const i of [3, 6, 8]) assert.notStrictEqual(GATE2_HARM_CEILING_LINES[i], GATE2_DIRECTION_CEILING_LINES[i], `line ${i + 1} is varied`);
  // m5 · ONE DECISION LATE in the fate wording; the one-subject ceiling printed
  assert.strictEqual(GATE2_HARM_CEILING_LINES[12], "ONE DECISION LATE: a record exists only after its act closed, so it is read at a later decision; nothing on the record says the act whose decision carries a reading caused it.");
  assert.ok(GATE2_HARM_CEILING_LINES[14].startsWith("ONE SUBJECT: a harm basket binds exactly one origin subject"));
  // evasion 6.a/6.d and 5.f
  assert.ok(GATE2_HARM_CEILING_LINES[15].startsWith("RE-DERIVED FROM THE BOOK'S LOOKS:"));
  for (const unread of ["still unread: a look the witness never wrote, and any change across two books", "a change of the witness's digest key inside one book is not visible on the book"]) {
    assert.ok(GATE2_HARM_CEILING_LINES[15].includes(unread), unread);
  }
  // AMENDED (S216-2, cond. 6): ceiling 17 names the memory tag beside the class.
  assert.strictEqual(GATE2_HARM_CEILING_LINES[16], "A RESTART IS A FIRST LOAD: a declaration laid by restart is never refused, so a loosened harm stanza is not refused then; the harmClass and the grant-memory tag on every verdict show which stanza and which memory read.");
  assert.strictEqual(GATE2_HARM_CEILING_LINES[1], "CONSEQUENCES OF CLAIMED TARGETS, SEEN BY ANOTHER HAND: the witness's book shows what its own uid saw of each act's claimed target between two looks; artefact effects on claimed targets are not benefit or harm in the human sense; persistence is not read.");
  assert.strictEqual(GATE2_HARM_CEILING_LINES[5], "PROVENANCE: the observation is the witness's (its own uid, a fixed published method; Lane A, EG-1, one look); the selection of what is looked at — the claimed target, the act's existence and its close — is the subject's word (S206).");
  for (const [i, head] of [[10, "ORIGIN IS THE BOUND PRINCIPAL:"], [11, "EXACT PATHS ONLY:"], [12, "ONE DECISION LATE:"], [13, "SINCE THE WITNESS LAST LOOKED:"]] as const) {
    assert.ok(GATE2_HARM_CEILING_LINES[i].startsWith(head), head);
  }
  assert.ok(GATE2_HARM_CEILING_LINES[10].endsWith("never the human or errand behind it."));
  assert.strictEqual(GATE2_HARM_CEILINGS, GATE2_HARM_CEILING_LINES.join(" "));
  assert.ok(Object.isFrozen(GATE2_HARM_CEILING_LINES));
  assert.throws(() => (GATE2_HARM_CEILING_LINES as string[]).push("INJECTED"), TypeError);
  assert.strictEqual(GATE2_DIRECTION_CEILING_LINES.length, 10);
  assert.ok(GATE2_DIRECTION_CEILING_LINES[1].startsWith("ACTIONS, NOT CONSEQUENCES"), "the class list keeps its line 2");
});

check("HARM REMOVAL (machine side) · harm removed → the class path; a different subject/frame/items/origins moves the reading only by its names", () => {
  // harm removed, the class basket restored: exactly the class reading
  const specs = [...repeat(5, rec(KD)), ...repeat(20, rec(KV))];
  assert.deepStrictEqual(call(logOf(specs), config()), readOf(specs));
  // harm removed and no basket: the class path's G2_BASKET_ABSENT, with the class ceilings
  const none = call(hBook([LOOK_PROT]), { readableLoadStates: ["IN_MEMORY"] });
  assertBlind(none, "G2_BASKET_ABSENT", "MISSING_CONFIGURATION", "harm removed");
  // another subject, frame category, item ids and origin ids: the same verdict, renamed
  const rename = (t: string): string =>
    t.split(H_SUBJECT).join("subject-q").split("i-prot").join("i-alt").split("o-h").join("o-q").split("h1").join("q1");
  const acts: HAct[] = [LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS" }];
  const a = hRead(acts, { decidingActionId: "act-13" });
  const otherBook = hBook(acts.map((x) => ({ ...x, subject: "subject-q" })));
  const otherRecords = (otherBook.getAll() as unknown as Record<string, unknown>[]).map((r) => (typeof r.outcome === "string" ? { ...r, outcome: r.outcome.split("h1").join("q1") } : r));
  const otherLog: MicaReadableLog = { verify: () => ({ valid: true }), getLoadState: () => "IN_MEMORY", getAll: () => otherRecords as unknown as readonly MicaLogRecord[] };
  const b = call(otherLog, hConfig({ decidingActionId: "act-13" }, {
    origins: [{ id: "o-q", subject: "subject-q" }],
    items: [
      { id: "i-alt", category: "q1", control: false, fingerprint: FP_PROT },
      { id: "i-grant", category: "q1", control: false, fingerprint: FP_GRANT },
      { id: "i-ctrl", category: "h2", control: true, fingerprint: FP_CTRL },
    ],
    grants: { "i-alt": [], "i-grant": ["o-q"], "i-ctrl": [] },
  }));
  assert.strictEqual(b.verdict.kind, "ALARM");
  assert.strictEqual(b.verdict.summary, rename(a.verdict.summary));
});

// ── the canon refuter's findings on e42017c (M2–M6, m1–m5, n3), one arm each ──

check("REFUTER M2 · EVERY harm verdict carries harmLine, printed VERBATIM in its summary; the carried act's line names subjectSeq, actionId, item, origin, grant, facet and fate; the class path carries none", () => {
  const acts: HAct[] = [{ seq: 11, fp: FP_GRANT, observed: "FIRST_SEEN" }, { seq: 12, fp: FP_GRANT, observed: "CONTENT_DIFFERS" }];
  const granted = hRead(acts, { decidingActionId: "act-13" });
  assert.strictEqual(granted.verdict.kind, "SILENT");
  assert.strictEqual(granted.harmLine, `HARM READING: the carried act subjectSeq 12, actionId "act-12"; item i-grant; origin o-h; grant GRANTED (o-h may change i-grant since ${isoOf(H_SINCE)}); facet CONTENT_DIFFERS; fate RAN.`);
  const prot = hRead([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "SAME", fate: "HELD" }], { decidingActionId: "act-13" });
  assert.ok(prot.harmLine!.includes("grant NONE (o-h holds no grant for i-prot; the grant list is [])"), String(prot.harmLine));
  assert.ok(prot.harmLine!.includes("facet SAME; fate HELD"), String(prot.harmLine));
  const alarmed = hRead([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS" }], { decidingActionId: "act-13" });
  assert.ok(alarmed.harmLine!.startsWith("HARM READING: ALARM — the act whose record shows the change: subjectSeq 12, actionId \"act-12\"; item i-prot; origin o-h; grant NONE"), String(alarmed.harmLine));
  assert.ok(alarmed.harmLine!.endsWith("the act whose decision carries it: the act \"act-13\"."));
  const none = hRead([LOOK_PROT], { roster: hRoster([11, 12, 13]), decidingActionId: "act-13" });
  assert.ok(none.harmLine!.includes("label \"h1\": no record on the book"), String(none.harmLine));
  const early = call(hBook([]), hConfig({}, { harmClass: "x" }));
  assert.strictEqual(early.harmLine, "HARM READING: no carried act was read — the declared harm basket is malformed.");
  const thrown = call(hostileLog({ getAll: boom }), hConfig());
  assert.ok(thrown.harmLine!.startsWith("HARM READING: no carried act was read"));
  for (const r of [granted, prot, alarmed, none, early, thrown]) {
    assert.ok(r.harmLine !== undefined && r.verdict.summary.includes(r.harmLine), `harmLine not verbatim in the summary: ${String(r.harmLine)}`);
  }
  for (const [name, reading] of everySurface()) assert.strictEqual(reading.harmLine, undefined, `${name}: a class reading carries a harmLine`);
});

check("REFUTER M3 · the ALARM names EVERY way its latch ends — the clearance, a declaration change, the salt epoch lost, a predecessor-only latch unreadable — and never says 'clears only by'", () => {
  const v = assertHarmAlarm(hRead([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS" }]), "exits");
  const d = v.findings[0].detail;
  for (const exit of [
    "the doctor's clearance names this record's hash",
    // AMENDED (S216-2, cond. 6): the restart exit is closed by the bridge's grant memory; the exits say what is left.
    "a later declaration removes the item (a restart takes it; a reload refuses it, H11)",
    "neither a grant widened with a later since (S216) nor a since back-dated across a restart ends it, unless root forges or replaces that memory or runs a bridge that does not keep it",
    "a later declaration removes or re-binds the origin, or moves the book, across a restart",
    "the bridge's salt epoch is lost, or begins after the book's boundary (→ MEMBERSHIP NOT READABLE, never SILENT)",
    "for a latch standing only in a predecessor book, that book becomes unreadable (→ PREDECESSOR NOT READABLE, never SILENT)",
  ]) assert.ok(d.includes(exit), `lacks: ${exit}`);
  assert.ok(!/clears only by|only (the doctor's )?clearance ends/.test(v.summary), "an 'only a clearance' overclaim is printed");
  // and each stated exit is true at bytes: a widened grant, the item removed, the epoch lost, the predecessor unreadable
  const acts: HAct[] = [LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS" }];
  // S216: a grant widened with a since AFTER the record no longer ends the latch; one back-dated to or before it does
  // AT THE READER'S INPUT (a reload refuses it, H11 c'; across a restart the bridge's grant memory hands the reader its
  // first sight instead, S216-2 — armed below and in the bridge's suite).
  const widened = { "i-prot": ["o-h"], "i-grant": ["o-h"], "i-ctrl": [] };
  assertHarmAlarm(hRead(acts, { decidingActionId: "act-13" }, { grants: widened, grantSince: hSince(widened, H_BOUNDARY_AT + 3) }), "grant widened, since later");
  // back-dated to the change WINDOW's start (the prior look, B+1), not merely to the record (B+2): a widening that
  // covers the whole window still takes the latch (the restart path; a reload refuses it, H11 c'). To the record alone
  // it does not (no laundering).
  assertHarmAlarm(hRead(acts, { decidingActionId: "act-13" }, { grants: widened, grantSince: hSince(widened, H_BOUNDARY_AT + 2) }), "grant widened, since back-dated to the record only");
  assert.notStrictEqual(hRead(acts, { decidingActionId: "act-13" }, { grants: widened, grantSince: hSince(widened, H_BOUNDARY_AT + 1) }).verdict.kind, "ALARM", "grant widened, since back-dated to the window's start");
  assert.notStrictEqual(hRead(acts, { decidingActionId: "act-13" }, { items: [{ id: "i-grant", category: "h1", control: false, fingerprint: FP_GRANT }], grants: { "i-grant": ["o-h"] } }).verdict.kind, "ALARM", "item removed");
  assertHarmBlind(hRead(acts, {}, { saltEpochSince: null }), "G2_MEMBERSHIP_NOT_READABLE", "epoch lost");
  const quiet = hBook([{ seq: 13, fp: FP_PROT, observed: "SAME" }], H_BOUNDARY_AT + 100, "q");
  const broken: MicaReadableLog = { verify: () => ({ valid: false }), getLoadState: () => "IN_MEMORY", getAll: () => [] };
  assertHarmBlind(call(quiet, hConfig({ predecessors: [broken], bookBoundaryAt: H_BOUNDARY_AT + 100 })), "G2_PREDECESSOR_NOT_READABLE", "predecessor-only latch unreadable");
});

check("REFUTER M5 · FIRST_SEEN on the carried act's item stays SILENT (ruled) with its OWN text; SAME keeps 'no change since the witness last looked'", () => {
  const first = assertHarmSilent(hRead([LOOK_PROT], { decidingActionId: "act-12" }), "first");
  assert.ok(first.includes("first look at this item: there is no earlier look, so whether this act changed it cannot be read; a first look cannot alarm"), first);
  assert.ok(!first.includes("no change since the witness last looked"), "a first look claims no last look");
  const same = assertHarmSilent(hRead([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "SAME" }], { decidingActionId: "act-13" }), "same");
  assert.ok(same.includes("the item reads SAME at a RAN act: no change since the witness last looked"), same);
});

check("REFUTER m2 · the carried record is matched on (moduleId, actionId, subjectSeq): another subject's record, or another actionId under the same subjectSeq, is not the carried act's", () => {
  const roster = hRoster([11, 12, 13]);
  const otherSubject = hRead([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "SAME", subject: H_OTHER }], { roster, decidingActionId: "act-13" });
  assertHarmBlind(otherSubject, "G2_NOT_READABLE", "another subject, same subjectSeq");
  const book = hBook([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "SAME" }]);
  const renamed = (book.getAll() as unknown as Record<string, unknown>[]).map((r) => (r.actionId === "act-12" ? { ...r, actionId: "act-12-other" } : r));
  const log: MicaReadableLog = { verify: () => ({ valid: true }), getLoadState: () => "IN_MEMORY", getAll: () => renamed as unknown as readonly MicaLogRecord[] };
  assertHarmBlind(call(log, hConfig({ roster, decidingActionId: "act-13" })), "G2_NOT_READABLE", "another actionId, same subjectSeq");
  assertHarmSilent(hRead([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "SAME" }], { roster, decidingActionId: "act-13" }), "the matching triple");
});

check("REFUTER m3 · a null item fingerprint is refused while the bridge holds a salt epoch (never an off-basket SILENT); with no epoch it reads MEMBERSHIP NOT READABLE", () => {
  const items = [{ id: "i-prot", category: "h1", control: false, fingerprint: null }];
  assertHarmBlind(hRead([LOOK_PROT], {}, { items, grants: { "i-prot": [] } }), "G2_HARM_MALFORMED", "null fingerprint, epoch held");
  assertHarmBlind(hRead([LOOK_PROT], {}, { items, grants: { "i-prot": [] }, saltEpochSince: null }), "G2_MEMBERSHIP_NOT_READABLE", "null fingerprint, no epoch");
});

check("REFUTER m4 · the granted SILENT carries the A-4 cost line", () => {
  const s = assertHarmSilent(hRead([{ seq: 11, fp: FP_GRANT, observed: "FIRST_SEEN" }, { seq: 12, fp: FP_GRANT, observed: "CONTENT_DIFFERS" }], { decidingActionId: "act-13" }), "granted");
  assert.ok(s.includes("granted: o-h on i-grant. A change by any writer between two looks — the deployer's own edit included — is billed to the bound origin; here it reads as granted"), s);
});

check("REFUTER n3 · the 16-hex truncation is a NAMED display prefix, distinct from the class id's length", () => {
  assert.ok(SOURCE.includes("const PRINTED_HASH_PREFIX_LENGTH = 16;"));
  assert.ok(HARM_SECTION.includes("hash.slice(0, PRINTED_HASH_PREFIX_LENGTH)"));
  assert.ok(!HARM_SECTION.includes("hash.slice(0, BASKET_CLASS_HEX_LENGTH)"));
});

// ── the evasion tests' findings (6.a, 6.d, 3.b, 6.w, 5.f, 5.b'), one arm each ──

const lk = (o: Partial<HLook>): HLook => ({ state: "PRESENT", type: "file", meta: "m1", times: "t1", size: "s1", content: "c1", contentBasis: "DIGESTED", ...o });
const FAILED: HLook = { state: "UNOBSERVABLE", type: null, meta: null, times: null, size: null, content: null, contentBasis: null };

check("EVASION 6.d · a change straddling ONE FAILED LOOK is re-derived from the book's looks: the witness reads UNOBSERVABLE, the reader reads CONTENT_DIFFERS → ALARM, saying so", () => {
  const acts: HAct[] = [
    { seq: 11, fp: FP_PROT, observed: "FIRST_SEEN", look: lk({}) },
    { seq: 12, fp: FP_PROT, observed: "UNOBSERVABLE", look: FAILED },
    { seq: 13, fp: FP_PROT, observed: "UNOBSERVABLE", look: lk({ content: "c2", times: "t2" }) },
  ];
  const r = hRead(acts, { decidingActionId: "act-14", roster: hRoster([11, 12, 13, 14]) });
  const v = assertHarmAlarm(r, "straddle");
  assert.ok(v.findings[0].detail.includes("observed CONTENT_DIFFERS (re-derived from the book's looks; the witness's own facet read UNOBSERVABLE)"), v.findings[0].detail);
  assert.strictEqual(r.latchedSince, 3, "attributed to the record whose look reveals it");
  // control: the same book with the change undone reads no ALARM
  const same = hRead([acts[0], acts[1], { ...acts[2], look: lk({}) }], { decidingActionId: "act-14", roster: hRoster([11, 12, 13, 14]) });
  assert.notStrictEqual(same.verdict.kind, "ALARM");
});

check("EVASION 6.a · a FORGOTTEN target re-read FIRST_SEEN is compared with its earlier look in the book: a change → ALARM; no change → SILENT with the re-derived SAME text, never 'no earlier look'", () => {
  const first: HAct = { seq: 11, fp: FP_PROT, observed: "FIRST_SEEN", look: lk({}) };
  assertHarmAlarm(hRead([first, { seq: 12, fp: FP_PROT, observed: "FIRST_SEEN", look: lk({ meta: "m2" }) }], { decidingActionId: "act-13" }), "forgotten, changed");
  const s = assertHarmSilent(hRead([first, { seq: 12, fp: FP_PROT, observed: "FIRST_SEEN", look: lk({}) }], { decidingActionId: "act-13" }), "forgotten, unchanged");
  assert.ok(s.includes("re-derived from the book's looks (the witness's own facet read FIRST_SEEN): no change since the earlier successful look at it in this book"), s);
  assert.ok(!s.includes("there is no earlier look"), "a re-seen item is never read as a first look");
  // a re-derived DIFFERS is never lowered from the witness's own DIFFERS, and is GRANTED like an observed one
  assertHarmSilent(hRead([{ seq: 11, fp: FP_GRANT, observed: "FIRST_SEEN", look: lk({}) }, { seq: 12, fp: FP_GRANT, observed: "FIRST_SEEN", look: lk({ content: "c9" }) }], { decidingActionId: "act-13" }), "granted re-derived");
});

check("EVASION 6.a · books are never compared ACROSS: a look in a predecessor does not re-derive the current book's FIRST_SEEN (the key cannot be shown the same); the ceiling says so", () => {
  const old = hBook([{ seq: 11, fp: FP_PROT, observed: "FIRST_SEEN", look: lk({}) }], H_BOUNDARY_AT - 500, "old", "/fixture/dir/old.jsonl");
  const cur = hBook([{ seq: 12, fp: FP_PROT, observed: "FIRST_SEEN", look: lk({ content: "c2" }) }], H_BOUNDARY_AT + 100, "new");
  const roster = [{ subjectSeq: 12, actionId: "act-12", label: "h1", timestamp: H_BOUNDARY_AT + 200 }, { subjectSeq: 13, actionId: "act-13", label: "h1", timestamp: H_BOUNDARY_AT + 300 }];
  const r = call(cur, hConfig({ predecessors: [old], bookBoundaryAt: H_BOUNDARY_AT + 100, decidingActionId: "act-13", roster }));
  const s = assertHarmSilent(r, "across books");
  assert.ok(s.includes("first look at this item"), s);
  assert.ok(s.includes("(per book, never across books)"), s);
});

check("EVASION 6.a · the replica facet rule matches the witness's published one on the cases the book can carry (the full cross-check against seeing.ts lives in glue.test.ts)", () => {
  assert.strictEqual(gate2.gate2LookFacet(null, lk({})), "FIRST_SEEN");
  assert.strictEqual(gate2.gate2LookFacet(lk({}), FAILED), "UNOBSERVABLE");
  assert.strictEqual(gate2.gate2LookFacet(FAILED, lk({})), "UNOBSERVABLE");
  assert.strictEqual(gate2.gate2LookFacet(lk({}), lk({ content: "c2" })), "CONTENT_DIFFERS");
  assert.strictEqual(gate2.gate2LookFacet(lk({ contentBasis: "OVER_CAP" }), lk({ contentBasis: "OVER_CAP" })), "UNOBSERVABLE");
});

check("EVASION 3.b · a deciding act whose id is on the roster more than once → G2_NOT_READABLE ('the deciding act's id is not unique on the roster')", () => {
  const roster = [...hRoster([11, 12, 13]), { subjectSeq: 14, actionId: "act-13", label: "h1", timestamp: H_BOUNDARY_AT + 14 }];
  const r = hRead([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "SAME" }], { roster, decidingActionId: "act-13" });
  assertHarmBlind(r, "G2_NOT_READABLE", "duplicate deciding id");
  assert.ok(r.verdict.summary.startsWith("NOT READABLE: the deciding act's id is not unique on the roster"), r.verdict.summary.slice(0, 160));
  assertHarmSilent(hRead([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "SAME" }], { roster: hRoster([11, 12, 13]), decidingActionId: "act-13" }), "unique id: control");
});

check("EVASION 5.b' · the predecessor caveat is printed on the VERDICT, not only the census", () => {
  const r = hRead([LOOK_PROT], { decidingActionId: "act-12" });
  assert.ok(r.verdict.summary.includes("a successor book that declares no predecessor is not verified to have none"), r.verdict.summary);
});

// ── the bytes refuter's findings on e42017c (C2 rotation; surviving mutants N02, N06, N09, N10) ──

check("BYTES C2 · SUBJECT-CHAIN ROTATION: the carried act is chosen by the interest book's APPEND ORDER, never by subjectSeq — status read, deciding act not yet on the roster, and deciding act on the roster", () => {
  // the old chain numbered its acts 1..5; the rotated chain numbers from 1 again; the interest book holds both, in order
  const roster: Gate2RosterEntry[] = [
    ...[1, 2, 3, 4, 5].map((n) => ({ subjectSeq: n, actionId: `old-${n}`, label: "h1", timestamp: H_BOUNDARY_AT + n })),
    { subjectSeq: 1, actionId: "new-1", label: "h1", timestamp: H_BOUNDARY_AT + 10 },
    { subjectSeq: 2, actionId: "new-2", label: "h1", timestamp: H_BOUNDARY_AT + 11 },
  ];
  const acts: HAct[] = [
    { seq: 5, fp: FP_GRANT, observed: "FIRST_SEEN", actionId: "old-5" },
    { seq: 1, fp: FP_PROT, observed: "FIRST_SEEN", actionId: "new-1" },
    { seq: 2, fp: FP_CTRL, observed: "FIRST_SEEN", actionId: "new-2" },
  ];
  const cases: ReadonlyArray<readonly [string, string | null, string]> = [
    ["status read", null, "new-2"],
    ["deciding act not yet on the roster", "new-3", "new-2"],
    ["deciding act on the roster", "new-2", "new-1"],
  ];
  for (const [name, deciding, carried] of cases) {
    const r = hRead(acts, { roster, decidingActionId: deciding });
    assert.strictEqual(r.verdict.kind, "SILENT", `${name}: ${r.verdict.summary.slice(0, 300)}`);
    assert.ok(r.harmLine!.includes(`actionId "${carried}"`), `${name}: carried ${String(r.harmLine)}`);
    assert.ok(!r.harmLine!.includes("old-5"), `${name}: the old chain's highest act stood in`);
  }
  // the first act on the roster carries nothing before it
  assertHarmBlind(hRead(acts, { roster, decidingActionId: "old-1" }), "G2_NOT_READABLE", "first in book order");
});

check("BYTES N02 · an act exactly AT the book's boundary instant is on the roster", () => {
  const r = hRead([LOOK_PROT], { roster: [{ subjectSeq: 11, actionId: "act-11", label: "h1", timestamp: H_BOUNDARY_AT }] });
  assertHarmSilent(r, "at the boundary");
  assert.ok(r.harmLine!.includes("subjectSeq 11"), String(r.harmLine));
});

check("BYTES N06 · the carried act's record is the LAST matching record (a doubled record: the later one reads)", () => {
  const acts: HAct[] = [LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "SAME" }, { seq: 12, fp: FP_PROT, observed: "UNOBSERVABLE" }];
  assertHarmBlind(hRead(acts, { decidingActionId: "act-13" }), "G2_UNKNOWN_ON_ITEM", "the last record reads");
  assertHarmSilent(hRead([acts[0], acts[2], acts[1]], { decidingActionId: "act-13" }), "control: the last is SAME");
});

check("BYTES N09 · an unresolved-origin DIFFERS on an item in a PREDECESSOR book is seen → G2_ORIGIN_NOT_READABLE", () => {
  const old = hBook([{ seq: 11, fp: FP_PROT, observed: "FIRST_SEEN", subject: "subject-z" }, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS", subject: "subject-z" }], H_BOUNDARY_AT - 500, "old", "/fixture/dir/old.jsonl");
  const cur = hBook([{ seq: 13, fp: FP_PROT, observed: "SAME" }], H_BOUNDARY_AT + 100, "new");
  const roster = [{ subjectSeq: 13, actionId: "act-13", label: "h1", timestamp: H_BOUNDARY_AT + 200 }, { subjectSeq: 14, actionId: "act-14", label: "h1", timestamp: H_BOUNDARY_AT + 300 }];
  const r = call(cur, hConfig({ predecessors: [old], bookBoundaryAt: H_BOUNDARY_AT + 100, decidingActionId: "act-14", roster }));
  assertHarmBlind(r, "G2_ORIGIN_NOT_READABLE", "unresolved in a predecessor");
  assert.ok(blindPaths(r)[0].detail.includes("the predecessor book old.jsonl"), blindPaths(r)[0].detail);
});

check("BYTES N10 · the reader never re-sorts the roster (a fence; the rotation arm is the behaviour)", () => {
  assert.ok(!/since\.sort\s*\(/.test(HARM_SECTION), "the roster is re-sorted");
});

// ── U3 · THE LIVE STOP 3 ARC, PINNED (T36) ──
// Decisions 650–657 of the live box (2026-10-16 17:23–17:57Z), their inputs read at bytes and anonymised (subject,
// origin and item ids renamed in inputs AND expected text alike): the witness's current book and its retired
// predecessor, the interest book's acts, the harm stanza as served at each decision (S35, then S36 with the C1
// clearance from 17:47:01.585Z). FIXTURE ASSUMPTIONS, each confirmed by the replay matching: H1/H2 carry stand-in
// fingerprints (no record ever touched them; their real ones need the root salt), and the salt epoch begins one ms
// before the predecessor book's boundary (the live readings show membership readable on both books), and the book at
// decision d is the records with timestamp < d.at, the roster those <= d.at. READER ONLY: the wiring is not exercised. Each decision
// must reproduce its live Gate 2 kind and harm line VERBATIM: a change to what the live arc reads is a ticket's, never
// silent. Under S216 the three GRANTED lines gain " since <utc>" (measured): AMENDED by T34 (cond. 8) in the fixture's
// expected lines and in grantSince below; the box-verbatim originals are relay 1's fixture blob b20634e1.
check("U3 · LIVE REGRESSION (READER ONLY): decisions 650–657 of 2026-10-16 reproduce their live Gate 2 kind and harm line VERBATIM, and the reader's code and latch", () => {
  const fx = JSON.parse(readFileSync(join(__dirname, "fixtures", "live-stop3-20261016.json"), "utf8"));
  const liveLog = (recs: unknown[], sourcePath?: string): MicaReadableLog => {
    const l: MicaReadableLog & { sourcePath?: string } = { verify: () => ({ valid: true }), getLoadState: () => "IN_MEMORY", getAll: () => recs as readonly MicaLogRecord[] };
    if (sourcePath !== undefined) l.sourcePath = sourcePath;
    return l;
  };
  const boundary: number = fx.book[0].timestamp;
  assert.strictEqual(fx.decisions.length, 8, "eight live decisions");
  for (const d of fx.decisions) {
    const cfg = d.at < fx.s36LoadedAt ? fx.configs.S35 : fx.configs.S36;
    const r = call(liveLog(fx.book.filter((x: { timestamp: number }) => x.timestamp < d.at)), {
      readableLoadStates: ["IN_MEMORY"],
      harm: {
        harmClass: cfg.harmClass,
        origins: [{ id: "o-live", subject: "subject-live" }],
        items: fx.items,
        grants: { "i-h1": [], "i-h2": [], "i-h3": [], "i-g1": ["o-live"] },
        // AMENDED (S216, T34 cond. 8): G1's grant counts from the instant the refuters measured; no other grant.
        // AMENDED (S216-2): the seeded memory's first sight equals the declared since, so effective = declared and every
        // harmLine below reads exactly as at a0d30173 (the fixture is untouched).
        grantSince: { "i-h1": {}, "i-h2": {}, "i-h3": {}, "i-g1": { "o-live": { at: 1792131234692, utc: "2026-10-16T06:13:54.692Z", declaredAt: 1792131234692, declaredUtc: "2026-10-16T06:13:54.692Z" } } },
        grantMemory: { tag: "G2_GRANT_MEMORY@00000000000000c2", state: "SEEDED" },
        errandGrants: [], // AMENDED (S208-2, T35): the key is required; no errand was open on the live arc.
        clearances: cfg.clearances,
        saltEpochSince: fx.predecessor[0].timestamp - 1,
      },
      roster: fx.roster.filter((x: { timestamp: number }) => x.timestamp <= d.at),
      decidingActionId: d.actionId,
      predecessors: [liveLog(fx.predecessor, "/fixture/retired.jsonl")],
      bookBoundaryAt: boundary,
      underivedWord: "UNDERIVED",
    } as Gate2DirectionConfig);
    assert.strictEqual(r.verdict.kind, d.g2kind, `decision ${String(d.seq)}: kind`);
    // AMENDED (S216, T34 cond. 8): the fixture's harmLines of 654, 656, 657 carry " since <utc>"; every other line and every kind is the box's.
    assert.strictEqual(r.harmLine, d.harmLine, `decision ${String(d.seq)}: harm line`);
    // T36 (cold refuters): kind and line alone let code and latch move silently — pin them too (reader-computed).
    assert.strictEqual(r.code ?? null, d.readerCode, `decision ${String(d.seq)}: code`);
    assert.strictEqual(r.latchedSince ?? null, d.readerLatchedSince, `decision ${String(d.seq)}: latchedSince`);
  }
});

// ── X3 arms · verdict-touching branches no fixture reached (X3 coverage table, 2511dac) ──
//
// Arms marked "PINS TODAY" assert the behaviour as it is on 2511dac where this seat reads it as wrong; the fix is
// a separate ticket and the arm's assertion flips with it. Every other arm asserts the behaviour the branch exists for.

/** A book built by hBook whose records are then patched in place (a malformed record the witness never writes). */
function hBookPatched(acts: readonly HAct[], patch: (records: Record<string, unknown>[]) => void, boundaryAt = H_BOUNDARY_AT): MicaReadableLog {
  const records = (hBook(acts, boundaryAt).getAll() as unknown as Record<string, unknown>[]).map((r) => ({ ...r }));
  patch(records);
  return { verify: () => ({ valid: true }), getLoadState: () => "IN_MEMORY", getAll: () => records as unknown as readonly MicaLogRecord[] };
}
const witnessedOf = (r: Record<string, unknown>): Record<string, unknown> => r.witnessed as Record<string, unknown>;
const X3_DIFFERS: HAct[] = [LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS" }];
/** An ungranted DIFFERS on i-prot at book position 2, then an act 13 reading SAME — act 13 is carried by act-14. */
const X3_THREE: HAct[] = [...X3_DIFFERS, { seq: 13, fp: FP_PROT, observed: "SAME" }];
const X3_CARRY_13 = { decidingActionId: "act-14", roster: hRoster([11, 12, 13, 14]) };

check("X3-08 · a harm basket LACKING a key (saltEpochSince) → G2_HARM_MALFORMED, never read as an absent epoch", () => {
  const h = hharm() as unknown as Record<string, unknown>;
  delete h.saltEpochSince;
  assertHarmBlind(call(hBook(X3_DIFFERS), { ...hConfig(), harm: h as unknown as Gate2Harm }), "G2_HARM_MALFORMED", "no saltEpochSince key");
});
check("X3-08 · a predecessor that is null (not an object at all) → G2_HARM_MALFORMED, never a throw", () => {
  assertHarmBlind(call(hBook(X3_DIFFERS), hConfig({ predecessors: [null as never] })), "G2_HARM_MALFORMED", "null predecessor");
});
check("X3-08 · an origin with an empty subject or id → G2_HARM_MALFORMED", () => {
  assertHarmBlind(hRead(X3_DIFFERS, {}, { origins: [{ id: "o-h", subject: "" }] }), "G2_HARM_MALFORMED", "empty subject");
  assertHarmBlind(hRead(X3_DIFFERS, {}, { origins: [{ id: "", subject: H_SUBJECT }], grants: { "i-prot": [], "i-grant": [""], "i-ctrl": [] } }), "G2_HARM_MALFORMED", "empty id");
});
check("X3-08 · an item with an empty category or id → G2_HARM_MALFORMED", () => {
  assertHarmBlind(hRead(X3_DIFFERS, {}, { items: [{ id: "i-prot", category: "", control: false, fingerprint: FP_PROT }], grants: { "i-prot": [] } }), "G2_HARM_MALFORMED", "empty category");
  assertHarmBlind(hRead(X3_DIFFERS, {}, { items: [{ id: "", category: "h1", control: false, fingerprint: FP_PROT }], grants: { "": [] } }), "G2_HARM_MALFORMED", "empty id");
});
check("X3-08 · an item fingerprint \"\" → G2_HARM_MALFORMED (a non-empty string or null, nothing else)", () => {
  assertHarmBlind(hRead(X3_DIFFERS, {}, { items: [{ id: "i-prot", category: "h1", control: false, fingerprint: "" }], grants: { "i-prot": [] } }), "G2_HARM_MALFORMED", "empty fingerprint");
});

check("X3-09 · class path: a record with a finite sequenceNumber and a NUMBER for moduleId/eventType → G2_READER_THREW", () => {
  // A number, not an absence: an absent field would throw inside tupleKey anyway (undefined.length), so only a
  // non-string that HAS a length-free toString shows whether this guard decides.
  const noModule = [{ sequenceNumber: 0, timestamp: 0, moduleId: 7, eventType: KV, outcome: "ok" }] as unknown as readonly MicaLogRecord[];
  assertBlind(call(hostileLog({ getAll: () => noModule }), config()), "G2_READER_THREW", "MISSING_CONFIGURATION", "numeric moduleId");
  const noEvent = [{ sequenceNumber: 0, timestamp: 0, moduleId: SUBJECT, eventType: 7, outcome: "ok" }] as unknown as readonly MicaLogRecord[];
  assertBlind(call(hostileLog({ getAll: () => noEvent }), config()), "G2_READER_THREW", "MISSING_CONFIGURATION", "numeric eventType");
});
check("X3-09 · harm path: getAll() handing back an array-LIKE that is not a list → G2_READER_THREW, never read by index", () => {
  const real = hBook(X3_THREE).getAll() as unknown as Record<string, unknown>[];
  const arrayLike: Record<string, unknown> = { length: real.length };
  real.forEach((r, i) => { arrayLike[String(i)] = r; });
  const log: MicaReadableLog = { verify: () => ({ valid: true }), getLoadState: () => "IN_MEMORY", getAll: () => arrayLike as unknown as readonly MicaLogRecord[] };
  assertHarmBlind(call(log, hConfig(X3_CARRY_13)), "G2_READER_THREW", "array-like book");
});
check("X3-09 · harm path: a book list whose length is not a non-negative safe integer → G2_READER_THREW, nothing read", () => {
  for (const length of [-1, Number.NaN]) {
    const lying = new Proxy(hBook(X3_THREE).getAll() as unknown as unknown[], {
      get(target, key, receiver) { return key === "length" ? length : Reflect.get(target, key, receiver); },
    });
    const log: MicaReadableLog = { verify: () => ({ valid: true }), getLoadState: () => "IN_MEMORY", getAll: () => lying as unknown as readonly MicaLogRecord[] };
    assertHarmBlind(call(log, hConfig(X3_CARRY_13)), "G2_READER_THREW", `book length ${String(length)}`);
  }
});
check("X3-09 · harm path: a consequence record with no finite sequenceNumber → G2_READER_THREW", () => {
  const log = hBookPatched(X3_DIFFERS, (rs) => { rs[2].sequenceNumber = "2"; });
  assertHarmBlind(call(log, hConfig({ decidingActionId: "act-13" })), "G2_READER_THREW", "string sequenceNumber");
});
check("X3-09 · harm path: a consequence record with no string moduleId → G2_READER_THREW", () => {
  const log = hBookPatched(X3_DIFFERS, (rs) => { delete rs[2].moduleId; });
  assertHarmBlind(call(log, hConfig({ decidingActionId: "act-13" })), "G2_READER_THREW", "no moduleId");
});

// X3-10 · the fallbacks that go QUIET. Each malformed record sits on a declared item BEFORE the carried act.
check("X3-10 · PINS TODAY: a non-string `observed` on an item reads \"(no facet)\" — never DIFFERS — so the carried SAME act is SILENT", () => {
  const log = hBookPatched(X3_THREE, (rs) => { witnessedOf(rs[2]).observed = 42; });
  const r = call(log, hConfig(X3_CARRY_13));
  assertHarmSilent(r, "non-string observed");
  assert.ok(r.verdict.summary.includes("(no facet)"), "the recorder names the unread facet");
});
check("X3-10 · PINS TODAY: a look with a non-string state is no look, so a forgotten target's change is not re-derived → SILENT first look", () => {
  const first: HAct = { seq: 11, fp: FP_PROT, observed: "FIRST_SEEN", look: lk({}) };
  const control = hRead([first, { seq: 12, fp: FP_PROT, observed: "FIRST_SEEN", look: lk({ meta: "m2" }) }], { decidingActionId: "act-13" });
  assertHarmAlarm(control, "control: the well-formed look re-derives META_DIFFERS");
  const r = hRead([first, { seq: 12, fp: FP_PROT, observed: "FIRST_SEEN", look: lk({ meta: "m2", state: 5 as never }) }], { decidingActionId: "act-13" });
  assert.ok(assertHarmSilent(r, "state 5").includes("first look at this item"));
});
check("X3-10 · PINS TODAY: a look with a non-text type/meta/times/size is no look → SILENT first look over a changed meta", () => {
  const first: HAct = { seq: 11, fp: FP_PROT, observed: "FIRST_SEEN", look: lk({}) };
  const r = hRead([first, { seq: 12, fp: FP_PROT, observed: "FIRST_SEEN", look: lk({ meta: "m2", size: 7 as never }) }], { decidingActionId: "act-13" });
  assert.ok(assertHarmSilent(r, "size 7").includes("first look at this item"));
});
check("X3-10 · PINS TODAY: a look with a non-text content/contentBasis is no look → SILENT first look over a changed meta", () => {
  const first: HAct = { seq: 11, fp: FP_PROT, observed: "FIRST_SEEN", look: lk({}) };
  const r = hRead([first, { seq: 12, fp: FP_PROT, observed: "FIRST_SEEN", look: lk({ meta: "m2", contentBasis: 1 as never }) }], { decidingActionId: "act-13" });
  assert.ok(assertHarmSilent(r, "contentBasis 1").includes("first look at this item"));
});
check("X3-10 · PINS TODAY: a consequence record whose `witnessed` is not an object is SKIPPED (not counted) → SILENT over its DIFFERS", () => {
  const log = hBookPatched(X3_THREE, (rs) => { rs[2].witnessed = "CONTENT_DIFFERS"; });
  assertHarmSilent(call(log, hConfig(X3_CARRY_13)), "witnessed a string");
});
check("X3-10 · PINS TODAY: a DIFFERS whose `cites` is not an object reads OFF-BASKET (no item) → SILENT, never damage", () => {
  const log = hBookPatched(X3_THREE, (rs) => { witnessedOf(rs[2]).cites = FP_PROT; });
  assertHarmSilent(call(log, hConfig(X3_CARRY_13)), "cites a string");
});
check("X3-10 · a PREDECESSOR whose boundary instant is not finite is excluded from the latch → G2_MEMBERSHIP_NOT_READABLE, never SILENT over its DIFFERS", () => {
  const old = hBook([{ seq: 11, fp: FP_PROT, observed: "FIRST_SEEN" }, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS" }], Number.NaN, "old", "/fixture/dir/old.jsonl");
  const cur = hBook([{ seq: 13, fp: FP_PROT, observed: "SAME" }], H_BOUNDARY_AT + 100, "new");
  const roster = [{ subjectSeq: 13, actionId: "act-13", label: "h1", timestamp: H_BOUNDARY_AT + 200 }, { subjectSeq: 14, actionId: "act-14", label: "h1", timestamp: H_BOUNDARY_AT + 300 }];
  const r = call(cur, hConfig({ predecessors: [old], bookBoundaryAt: H_BOUNDARY_AT + 100, decidingActionId: "act-14", roster }));
  assertHarmBlind(r, "G2_MEMBERSHIP_NOT_READABLE", "NaN predecessor boundary");
  assert.ok(blindPaths(r)[0].detail.includes("old.jsonl"), blindPaths(r)[0].detail);
});

/** No damage anywhere: with a well-formed roster this reads SILENT, so only the roster can blind it. */
const X3_CLEAN: HAct[] = [LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "SAME" }, { seq: 13, fp: FP_PROT, observed: "SAME" }];
check("X3-11 · control: the clean book with a well-formed roster is SILENT", () => {
  assertHarmSilent(hRead(X3_CLEAN, { decidingActionId: "act-14", roster: hRoster([10, 11, 12, 13, 14]) }), "well-formed roster");
});
check("X3-11 · a roster that is not a list → G2_ROSTER_NOT_READABLE", () => {
  assertHarmBlind(hRead(X3_CLEAN, { decidingActionId: "act-14", roster: "act-13" as never }), "G2_ROSTER_NOT_READABLE", "roster a string");
});
check("X3-11 · ONE non-object roster entry nulls the whole roster → G2_ROSTER_NOT_READABLE (the good entries are not read around it)", () => {
  assertHarmBlind(hRead(X3_CLEAN, { decidingActionId: "act-14", roster: [null as never, ...hRoster([11, 12, 13, 14])] }), "G2_ROSTER_NOT_READABLE", "null entry");
});
check("X3-11 · ONE roster entry lacking a string actionId or label nulls the whole roster → G2_ROSTER_NOT_READABLE", () => {
  const good = hRoster([11, 12, 13, 14]);
  assertHarmBlind(hRead(X3_CLEAN, { decidingActionId: "act-14", roster: [{ subjectSeq: 10, label: "h1", timestamp: H_BOUNDARY_AT + 10 } as never, ...good] }), "G2_ROSTER_NOT_READABLE", "no actionId");
  assertHarmBlind(hRead(X3_CLEAN, { decidingActionId: "act-14", roster: [{ subjectSeq: 10, actionId: "act-10", label: 3, timestamp: H_BOUNDARY_AT + 10 } as never, ...good] }), "G2_ROSTER_NOT_READABLE", "label not a string");
});
check("X3-11 · ONE roster entry with a non-finite instant nulls the whole roster → G2_ROSTER_NOT_READABLE", () => {
  assertHarmBlind(hRead(X3_CLEAN, { decidingActionId: "act-14", roster: [{ subjectSeq: 10, actionId: "act-10", label: "h1", timestamp: Number.NaN }, ...hRoster([11, 12, 13, 14])] }), "G2_ROSTER_NOT_READABLE", "NaN instant");
});

check("X3-13 · TWO current ungranted DIFFERS: latchedSince is the EARLIER seq, and the later one is named beside it", () => {
  const acts: HAct[] = [LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS" }, { seq: 13, fp: FP_PROT, observed: "META_DIFFERS" }];
  const r = hRead(acts, { decidingActionId: "act-14", roster: hRoster([11, 12, 13, 14]) });
  const v = assertHarmAlarm(r, "two damage records");
  assert.strictEqual(r.latchedSince, 2);
  assert.ok(v.findings[0].detail.includes("LATCHED since seq 2 of the current book."), v.findings[0].detail);
  assert.ok(v.findings[0].detail.includes("Also ungranted and uncleared: the current book seq 3"), v.findings[0].detail);
});
check("X3-13 · the earliest is chosen by SEQ, not by book position: damage at seq 9 then at seq 4 latches since 4", () => {
  const acts: HAct[] = [LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS" }, { seq: 13, fp: FP_PROT, observed: "META_DIFFERS" }];
  const log = hBookPatched(acts, (rs) => { rs[2].sequenceNumber = 9; rs[3].sequenceNumber = 4; });
  const r = call(log, hConfig({ decidingActionId: "act-14", roster: hRoster([11, 12, 13, 14]) }));
  assertHarmAlarm(r, "seq order against book order");
  assert.strictEqual(r.latchedSince, 4);
});

// ── S216 · A GRANT COUNTS FROM ITS SINCE; A WIDENING WITH A LATER SINCE NEVER ENDS A LATCH ──
// Fixture records sit at H_BOUNDARY_AT + their book position (hRecord), so the since is placed against them exactly.

const S216_PROT_CHANGE: HAct[] = [LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS" }];
const S216_WIDE = { "i-prot": ["o-h"], "i-grant": ["o-h"], "i-ctrl": [] };

check("S216 · a DIFFERS before a later widening stays damage: ALARM stands, and the doctor's clearance ends it → not ALARM", () => {
  const late = hSince(S216_WIDE, H_BOUNDARY_AT + 3);
  const a = assertHarmAlarm(hRead(S216_PROT_CHANGE, { decidingActionId: "act-13" }, { grants: S216_WIDE, grantSince: late }), "widened later");
  assert.ok(a.summary.includes(`grant NONE (o-h is granted i-prot only since ${isoOf(H_BOUNDARY_AT + 3)}; this record is earlier)`), a.summary);
  const cleared = hRead(S216_PROT_CHANGE, { decidingActionId: "act-13" }, { grants: S216_WIDE, grantSince: late, clearances: [hHash("cur-2")] });
  assert.notStrictEqual(cleared.verdict.kind, "ALARM", "the clearance did not end the latch");
});

check("S216 · the boundary is ≥: a record AT its since is granted, one ms before is not", () => {
  const at = hRead([{ seq: 11, fp: FP_GRANT, observed: "FIRST_SEEN" }, { seq: 12, fp: FP_GRANT, observed: "CONTENT_DIFFERS", priorLookAt: H_BOUNDARY_AT + 2 }], { decidingActionId: "act-13" }, { grantSince: { "i-prot": {}, "i-grant": { "o-h": gs(H_BOUNDARY_AT + 2) }, "i-ctrl": {} } });
  assert.notStrictEqual(at.verdict.kind, "ALARM", "a record at its since read as damage");
  assert.ok(at.harmLine!.includes(`grant GRANTED (o-h may change i-grant since ${isoOf(H_BOUNDARY_AT + 2)})`), String(at.harmLine));
  assertHarmAlarm(hRead([{ seq: 11, fp: FP_GRANT, observed: "FIRST_SEEN" }, { seq: 12, fp: FP_GRANT, observed: "CONTENT_DIFFERS" }], { decidingActionId: "act-13" }, { grantSince: { "i-prot": {}, "i-grant": { "o-h": gs(H_BOUNDARY_AT + 3) }, "i-ctrl": {} } }), "one ms before");
});

check("S216 · a granted record with no timestamp cannot be placed after its since → damage, never granted", () => {
  const book = hBook([{ seq: 11, fp: FP_GRANT, observed: "FIRST_SEEN" }, { seq: 12, fp: FP_GRANT, observed: "CONTENT_DIFFERS" }]);
  const records = book.getAll() as unknown as Record<string, unknown>[];
  delete records[2].timestamp;
  const r = call(book, hConfig({ decidingActionId: "act-13" }));
  assertHarmAlarm(r, "no timestamp");
  assert.ok(r.verdict.summary.includes("this record is earlier or carries no timestamp"), r.verdict.summary);
});

check("S216 · the grantSince shape is refused whole: missing (the old bridge), an origin with no since, a since for an unlisted origin or undeclared item, a bare number, an extra key", () => {
  const bad: [string, Partial<Gate2Harm>][] = [
    ["no grantSince (an old bridge's shape)", { grantSince: undefined as never }],
    ["a granted origin with no since", { grantSince: { "i-prot": {}, "i-grant": {}, "i-ctrl": {} } }],
    ["a since for an origin not listed", { grantSince: { "i-prot": { "o-h": gs(1) }, "i-grant": { "o-h": gs(1) }, "i-ctrl": {} } }],
    ["a since for an undeclared item", { grantSince: { ...hSince({ "i-prot": [], "i-grant": ["o-h"], "i-ctrl": [] }), "i-none": {} } }],
    ["an item with no grantSince entry", { grantSince: { "i-grant": { "o-h": gs(1) }, "i-ctrl": {} } }],
    ["a bare number (no utc)", { grantSince: { "i-prot": {}, "i-grant": { "o-h": 1 as never }, "i-ctrl": {} } }],
    ["an extra key", { grantSince: { "i-prot": {}, "i-grant": { "o-h": { ...gs(1), x: 1 } as never }, "i-ctrl": {} } }],
  ];
  for (const [name, h] of bad) {
    const cfg = hConfig({}, {});
    const harm = { ...(cfg.harm as Gate2Harm), ...h } as Record<string, unknown>;
    if (h.grantSince === undefined) delete harm.grantSince;
    assertHarmBlind(call(hBook([LOOK_PROT]), { ...cfg, harm: harm as never }), "G2_HARM_MALFORMED", name);
  }
});

check("S216 · NO LAUNDERING: a change whose window STARTS before the since (first seen after it) is NOT granted; one whose window starts after it is; no window start → not granted", () => {
  // i-grant listed for o-h from H_BOUNDARY_AT + 5; the DIFFERS record sits at position 2 (timestamp H_BOUNDARY_AT + 2).
  const s5 = { "i-prot": {}, "i-grant": { "o-h": gs(H_BOUNDARY_AT + 2) }, "i-ctrl": {} };
  const launder = hRead([{ seq: 11, fp: FP_ELSEWHERE, observed: "SAME" }, { seq: 12, fp: FP_GRANT, observed: "CONTENT_DIFFERS", priorLookAt: H_BOUNDARY_AT + 1 }], { decidingActionId: "act-13" }, { grantSince: s5 });
  const a = assertHarmAlarm(launder, "a change first seen after the since but made before it");
  assert.ok(a.summary.includes("the change may predate it"), a.summary);
  assert.ok(a.summary.includes(`was not yet granted it (its grant counts from ${isoOf(H_BOUNDARY_AT + 2)})`) && !a.summary.includes("o-h holds no grant for it"), a.summary);
  const inWindow = hRead([{ seq: 11, fp: FP_ELSEWHERE, observed: "SAME" }, { seq: 12, fp: FP_GRANT, observed: "CONTENT_DIFFERS", priorLookAt: H_BOUNDARY_AT + 2 }], { decidingActionId: "act-13" }, { grantSince: s5 });
  assert.notStrictEqual(inWindow.verdict.kind, "ALARM", "a window starting at the since was refused");
  assertHarmAlarm(hRead([{ seq: 11, fp: FP_ELSEWHERE, observed: "SAME" }, { seq: 12, fp: FP_GRANT, observed: "CONTENT_DIFFERS", priorLookAt: null }], { decidingActionId: "act-13" }, { grantSince: s5 }), "no window start on the record");
});

// ── S216-2 · THE BRIDGE'S GRANT MEMORY, AS THE READER RECEIVES IT (machine half; conds. 1, 2, 4, 5, 6) ──
// T34 cond. 7's arm pinned "a restart is a first load: a declaration back-dating a grant across it is not refused
// today" on the ALARM; S216-2 closes that exit, so the arm is REPLACED by the ones below (cond. 6).

const S216_2_BACKDATED = { "i-prot": ["o-h"], "i-grant": ["o-h"], "i-ctrl": [] };

check("S216-2 · cond. 1: THE RESTART EXIT IS CLOSED — a since declared back to the window's start, first seen by the memory after the record → ALARM stands, printing both sinces; the doctor's clearance still ends it", () => {
  const acts: HAct[] = [LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS" }];
  // the record is at B+2 and its window starts at B+1; declared since B+1 (the back-dating), first seen at B+3.
  const declaredOnly = hRead(acts, { decidingActionId: "act-13" }, { grants: S216_2_BACKDATED, grantSince: hSince(S216_2_BACKDATED, H_BOUNDARY_AT + 1) });
  assert.notStrictEqual(declaredOnly.verdict.kind, "ALARM", "control: at the reader's input a since at the window's start takes the latch");
  const held = hSince(S216_2_BACKDATED, H_BOUNDARY_AT + 3, H_BOUNDARY_AT + 1);
  const a = assertHarmAlarm(hRead(acts, { decidingActionId: "act-13" }, { grants: S216_2_BACKDATED, grantSince: held }), "back-dated across a restart");
  const words = `${isoOf(H_BOUNDARY_AT + 3)} (held by the bridge's grant memory: the later of its first sight of the grant and the highest since it carried for it; declared ${isoOf(H_BOUNDARY_AT + 1)})`;
  assert.ok(a.findings[0].detail.includes(`was not yet granted it (its grant counts from ${words})`), a.findings[0].detail);
  const r = hRead(acts, { decidingActionId: "act-13" }, { grants: S216_2_BACKDATED, grantSince: held });
  assert.ok(r.harmLine!.includes(`grant NONE (o-h is granted i-prot only since ${words}; this record is earlier)`), String(r.harmLine));
  const cleared = hRead(acts, { decidingActionId: "act-13" }, { grants: S216_2_BACKDATED, grantSince: held, clearances: [hHash("cur-2")] });
  assert.notStrictEqual(cleared.verdict.kind, "ALARM", "the clearance did not end the latch");
});

check("S216-2 · cond. 2: HONESTY UNCHANGED — equal sinces print exactly the declared spelling and no memory words; a record AT the effective since is granted, one ms before is not", () => {
  const acts: HAct[] = [{ seq: 11, fp: FP_GRANT, observed: "FIRST_SEEN" }, { seq: 12, fp: FP_GRANT, observed: "CONTENT_DIFFERS", priorLookAt: H_BOUNDARY_AT + 2 }];
  const eq = hRead(acts, { decidingActionId: "act-13" }, { grantSince: { "i-prot": {}, "i-grant": { "o-h": gs(H_BOUNDARY_AT + 2) }, "i-ctrl": {} } });
  assert.notStrictEqual(eq.verdict.kind, "ALARM");
  assert.ok(eq.harmLine!.includes(`grant GRANTED (o-h may change i-grant since ${isoOf(H_BOUNDARY_AT + 2)})`), String(eq.harmLine));
  assert.ok(!eq.verdict.summary.includes("held by the bridge's grant memory"), "memory words on an equal since");
  // effective B+2 over a declared B+1: granted at B+2 (≥), and the print names both
  const atEff = hRead(acts, { decidingActionId: "act-13" }, { grantSince: { "i-prot": {}, "i-grant": { "o-h": gs(H_BOUNDARY_AT + 2, H_BOUNDARY_AT + 1) }, "i-ctrl": {} } });
  assert.notStrictEqual(atEff.verdict.kind, "ALARM", "a record at its effective since read as damage");
  assert.ok(atEff.harmLine!.includes(`declared ${isoOf(H_BOUNDARY_AT + 1)})`), String(atEff.harmLine));
  // effective B+3 over a declared B+1: the record at B+2 is one ms before → damage
  assertHarmAlarm(hRead(acts, { decidingActionId: "act-13" }, { grantSince: { "i-prot": {}, "i-grant": { "o-h": gs(H_BOUNDARY_AT + 3, H_BOUNDARY_AT + 1) }, "i-ctrl": {} } }), "one ms before the effective since");
});

check("S216-2 · cond. 4: THE MAX IS A MAX AND THE PRINT IS THE NUMBER — at < declaredAt, a non-canonical utc or declaredUtc, a missing field, a bad tag or state → refused whole (WIRED AND BLIND), memory not printed", () => {
  const one = (since: unknown): Partial<Gate2Harm> => ({ grantSince: { "i-prot": {}, "i-grant": { "o-h": since as Gate2GrantSince }, "i-ctrl": {} } });
  const at = H_SINCE;
  const bad: [string, Partial<Gate2Harm>][] = [
    ["at < declaredAt", one(gs(at - 1, at))],
    ["utc not canonical (no ms)", one({ ...gs(at), utc: isoOf(at).replace(".000Z", "Z") })],
    ["utc one ms off", one({ ...gs(at), utc: isoOf(at + 1) })],
    ["declaredUtc one ms off", one({ ...gs(at), declaredUtc: isoOf(at - 1) })],
    ["utc as prose", one({ ...gs(at), utc: "first seen by the bridge" })],
    ["a negative instant", one(gs(-1))],
    ["a fractional instant", one({ at: at + 0.5, utc: isoOf(at), declaredAt: at, declaredUtc: isoOf(at) })],
    ["no declaredAt (an S216 bridge's shape)", one({ at, utc: isoOf(at) })],
    ["no declaredUtc", one({ at, utc: isoOf(at), declaredAt: at })],
    ["an extra key", one({ ...gs(at), x: 1 })],
    ["no grantMemory (an S216 bridge's shape)", { grantMemory: undefined as never }],
    ["grantMemory with an extra key", { grantMemory: { ...H_MEMORY, x: 1 } as never }],
    ["grantMemory without state", { grantMemory: { tag: H_MEMORY.tag } as never }],
    ["a tag with upper hex", { grantMemory: { tag: "G2_GRANT_MEMORY@00000000000000C1", state: "SEEDED" } }],
    ["a tag of 15 hex", { grantMemory: { tag: "G2_GRANT_MEMORY@0000000000000c1", state: "SEEDED" } }],
    ["the harm class prefix", { grantMemory: { tag: "G2_HARM@00000000000000c1", state: "SEEDED" } }],
    ["a state outside the six", { grantMemory: { tag: H_MEMORY.tag, state: "TRUSTED" as never } }],
    ["a state in lower case", { grantMemory: { tag: H_MEMORY.tag, state: "seeded" as never } }],
  ];
  for (const [name, h] of bad) {
    const cfg = hConfig({}, {});
    const harm = { ...(cfg.harm as Gate2Harm), ...h } as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(h, "grantMemory") && h.grantMemory === undefined) delete harm.grantMemory;
    const r = call(hBook([LOOK_PROT]), { ...cfg, harm: harm as never });
    assertHarmBlind(r, "G2_HARM_MALFORMED", name);
    assert.ok(r.verdict.summary.includes("Harm basket: not printed (no validated harm basket on this path). Grant memory: not printed (no validated harm basket on this path)."), `${name}: ${r.verdict.summary.slice(0, 300)}`);
    assert.strictEqual(r.grantMemoryLine, "Grant memory: not printed (no validated harm basket on this path).", name);
  }
});

check("S216-2 · cond. 4: the canonical spelling is checked by the reader's own arithmetic — 4000 seeded instants across 1970..9999 (leap days, century years, the edges) accepted at their spelling, refused one ms off", () => {
  let x = 20261016;
  const rnd = (): number => {
    x = (x + 0x6d2b79f5) | 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const max = 253402300799999;
  const edges = [0, 1, 999, 86399999, 86400000, Date.UTC(1972, 1, 29, 12), Date.UTC(2000, 1, 29), Date.UTC(2000, 2, 1) - 1, Date.UTC(2100, 1, 28, 23, 59, 59, 999), Date.UTC(2100, 2, 1), Date.UTC(2400, 1, 29), 1792131234692, max];
  const samples: number[] = [...edges];
  for (let i = 0; i < 4000; i++) samples.push(Math.floor(rnd() * max));
  let accepted = 0;
  let refused = 0;
  for (const at of samples) {
    const ok = call(hBook([LOOK_PROT]), hConfig({}, { grantSince: { "i-prot": {}, "i-grant": { "o-h": gs(at) }, "i-ctrl": {} } }));
    assert.notStrictEqual(ok.code, "G2_HARM_MALFORMED", `${at} ${isoOf(at)} refused at its own spelling`);
    accepted++;
    const off = at === max ? at - 1 : at + 1;
    const bad = call(hBook([LOOK_PROT]), hConfig({}, { grantSince: { "i-prot": {}, "i-grant": { "o-h": { ...gs(at), utc: isoOf(off) } }, "i-ctrl": {} } }));
    assert.strictEqual(bad.code, "G2_HARM_MALFORMED", `${at} accepted with the spelling of ${off}`);
    refused++;
  }
  // past year 9999 the clock's calendar spells "+010000-…": no canonical spelling, refused
  const beyond = call(hBook([LOOK_PROT]), hConfig({}, { grantSince: { "i-prot": {}, "i-grant": { "o-h": gs(max + 1) }, "i-ctrl": {} } }));
  assert.strictEqual(beyond.code, "G2_HARM_MALFORMED", "an instant past 9999 accepted");
  console.log(`    civil spelling: ${accepted} accepted at their spelling, ${refused} refused one ms off (seed 20261016)`);
});

check("S216-2 · cond. 5: PRINTED AS ONE — SILENT, ALARM and a validated BLIND print 'GRANT MEMORY <tag> (<fixed words>)' right after the harm basket; the reading carries the same line; each of the six states has its fixed words", () => {
  const line = (state: string): string => {
    const r = hRead([{ seq: 11, fp: FP_GRANT, observed: "FIRST_SEEN" }], { decidingActionId: "act-12" }, { grantMemory: { tag: "G2_GRANT_MEMORY@00000000000000d4", state: state as never } });
    return String(r.grantMemoryLine);
  };
  const words: Record<string, string> = {
    SEEDED: "SEEDED — seeded by the arbiter's hand at a relay",
    RESEEDED: "RESEEDED — replaced by root after an earlier memory",
    BEGUN: "BEGUN — begun by the bridge with no earlier memory",
    BEGUN_AFTER_LOSS: "BEGUN AFTER LOSS — an earlier memory was missing, unreadable or corrupt and is set aside, never edited",
    RECOVERED_PREFIX: "RECOVERED PREFIX — the memory's torn last line was set aside",
    NOT_PERSISTED: "NOT PERSISTED — a row of this load could not be written",
  };
  const seen = new Set<string>();
  for (const state of Object.keys(words)) {
    const l = line(state);
    assert.ok(l.startsWith(`GRANT MEMORY G2_GRANT_MEMORY@00000000000000d4 (${words[state]}`), `${state}: ${l}`);
    seen.add(l);
  }
  assert.strictEqual(seen.size, 6, "two states share their words");
  const memLine = `GRANT MEMORY ${H_MEMORY.tag} (`;
  const silentR = hRead([{ seq: 11, fp: FP_GRANT, observed: "FIRST_SEEN" }], { decidingActionId: "act-12" });
  const alarmR = hRead([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS" }], { decidingActionId: "act-13" });
  const blindR = hRead([LOOK_PROT], { roster: null });
  assert.strictEqual(silentR.verdict.kind, "SILENT");
  assert.strictEqual(alarmR.verdict.kind, "ALARM");
  assertHarmBlind(blindR, "G2_ROSTER_NOT_READABLE", "validated blind");
  for (const [name, r] of [["SILENT", silentR], ["ALARM", alarmR], ["BLIND", blindR]] as const) {
    assert.ok(r.grantMemoryLine !== null && r.grantMemoryLine !== undefined && r.grantMemoryLine.startsWith(memLine), `${name}: ${String(r.grantMemoryLine)}`);
    assert.ok(r.verdict.summary.includes(`Harm basket: ${H_CLASS}. ${r.grantMemoryLine}`), `${name}: the memory line is not beside the harm basket`);
  }
  const thrown = call(hostileLog({ getAll: boom }), hConfig());
  assert.strictEqual(thrown.grantMemoryLine, "Grant memory: not printed (no validated harm basket on this path).");
  assert.ok(thrown.verdict.summary.includes("Harm basket: not printed (no validated harm basket on this path). Grant memory: not printed (no validated harm basket on this path)."));
  for (const [name, reading] of everySurface()) assert.strictEqual(reading.grantMemoryLine, undefined, `${name}: a class reading carries a grantMemoryLine`);
});

check("S216-2 · cond. 6: THE CEILING TEXT IS TRUE AGAIN — the T34 restart sentence and 'a restart takes either' are gone from the ALARM; ceilings 17, 18 name the memory; ceiling 19 is the second memory", () => {
  const v = assertHarmAlarm(hRead([LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS" }]), "exits");
  const d = v.findings[0].detail;
  assert.ok(!d.includes("a restart is a first load: a declaration back-dating a grant across it is not refused today"), "the T34 ceiling sentence is still printed");
  assert.ok(!d.includes("a restart takes either"), "'a restart takes either' is still printed");
  assert.ok(d.includes("nothing persisted holds it but the bridge's grant memory, which only moves a since later"), d);
  for (const kept of ["removes the item", "removes or re-binds the origin, or moves the book, across a restart", "salt epoch is lost", "that book becomes unreadable"]) assert.ok(d.includes(kept), `the exits lost: ${kept}`);
  assert.ok(GATE2_HARM_CEILING_LINES[17].startsWith("A GRANT COUNTS FROM ITS SINCE: a record is granted only if its own timestamp (the book's, the witness's clock) is at or after the grant's effective since — the latest of the instant the deployer declares the grant to count from, the instant the bridge's grant memory first carried the grant, and the highest since that memory carried for it — AND,"), GATE2_HARM_CEILING_LINES[17]);
  assert.ok(!GATE2_HARM_CEILING_LINES[17].includes("at or after the instant the deployer declared the grant to count from AND"), "ceiling 18 reads the declared since only");
  assert.ok(GATE2_HARM_CEILING_LINES[16].endsWith("the harmClass and the grant-memory tag on every verdict show which stanza and which memory read."));
  const c19 = GATE2_HARM_CEILING_LINES[18];
  assert.ok(c19.startsWith("A SECOND MEMORY, THE BRIDGE'S: "), c19);
  for (const part of ["this reader never reads", "clamped to no earlier than the memory's last write and the newest record that load reads", "a clock stepped back beyond the clamp admits a back-dating up to the step", "a clock stepped forward", "can be undone by a further restart", "root can delete the memory", "forge it (undetectable"]) assert.ok(c19.includes(part), `ceiling 19 lacks: ${part}`);
  // NO SERVED LITERAL (cond. 7): the memory's path is the bridge's, never printed by the reader
  // (no import from outside src/mica — the closure fence — and no deployment literal — the suite-source fence)
  assert.ok(!/\/(?:var|opt|etc)\//.test(SOURCE), "a deployment path is in the reader");
});

// ── T27 cond. 4 (FORK-4, as recommended) · THE READER'S OWN THROW CONSTRUCTORS, EXPORTED ──────────────────────
//
// The glue's Gate 2 catches compose their blind reading from these and NEVER call the reader again. Each must return
// exactly what the reader's own net returns on the same thrown value (gate1ScopeThrew's pattern), so the kind, the code
// G2_READER_THREW and the detail are what they were when the glue re-called the reader over a rethrowing log.
function t27Throwables(): unknown[] {
  const named = new Error("fixture adapter threw; the thrown text is withheld");
  named.name = "RangeError";
  const hostileProto = new Proxy({}, { getPrototypeOf: () => { throw new Error("trap"); } });
  const hostileString = { toString: (): string => { throw new Error("toString"); } };
  return [named, new RangeError("fixture range"), "a fixture string", null, undefined, hostileProto, hostileString];
}

check("T27-G2-1 · gate2DirectionThrew(e) is deepStrictEqual to the reader's OWN net on the same thrown value (class basket)", () => {
  for (const e of t27Throwables()) {
    const own = call(hostileLog({ verify: () => { throw e; } }), config());
    assert.strictEqual(own.code, "G2_READER_THREW", "the arm's own control did not reach the reader's net");
    assert.deepStrictEqual(gate2.gate2DirectionThrew(e), own);
  }
});

check("T27-G2-2 · gate2HarmThrew(e) is deepStrictEqual to the reader's OWN harm net on the same thrown value", () => {
  for (const e of t27Throwables()) {
    const own = call(hostileLog({ verify: () => { throw e; } }), hConfig());
    assert.strictEqual(own.code, "G2_READER_THREW", "the arm's own control did not reach the reader's harm net");
    assert.deepStrictEqual(gate2.gate2HarmThrew(e), own);
  }
});

check("T27-G2-3 · the constructors are throw-free and compose WIRED-AND-BLIND, class MISSING_CONFIGURATION, code G2_READER_THREW", () => {
  for (const make of [gate2.gate2DirectionThrew, gate2.gate2HarmThrew]) {
    for (const e of t27Throwables()) {
      const r = make(e);
      assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
      assert.strictEqual(r.code, "G2_READER_THREW");
      assert.ok(r.verdict.kind === "CANNOT_ASSESS" && r.verdict.blindPaths.every((b) => b.class === "MISSING_CONFIGURATION"));
    }
  }
});

// ── S208-2 · AN ERRAND GRANT PERMITS A WINDOW, NOT AN ACT ──
// i-prot is ungranted statically; the change record sits at H_BOUNDARY_AT + 2 (book position 2).
const E_CHANGE: HAct[] = [LOOK_PROT, { seq: 12, fp: FP_PROT, observed: "CONTENT_DIFFERS" }];
function errand(id: string, items: string[], from: number, until: number, origin = "o-h"): Gate2ErrandGrant {
  // AMENDED (relay-3 pre-ship ruling 2, F3): edges carry their canonical spelling, as the bridge sends them
  // (utcInstantMs admits only a toISOString round-trip) and as the reader now requires (civilUtc).
  return { errandId: id, origin, items, from: { at: from, utc: isoOf(from) }, until: { at: until, utc: isoOf(until) }, seq: 7, peerUid: 1000 };
}

check("S208-2 · a change inside an errand's window on an item it names reads GRANTED BY ERRAND, never ALARM", () => {
  // the change window starts at the prior look (B+1), so an errand opening there covers it
  const r = hRead(E_CHANGE, { decidingActionId: "act-13" }, { errandGrants: [errand("e-1", ["i-prot"], H_BOUNDARY_AT + 1, H_BOUNDARY_AT + 3)] });
  assert.notStrictEqual(r.verdict.kind, "ALARM", "the errand did not grant");
  // AA2 · the grant line names the granting record: its seq and the uid that posted it
  assert.ok(r.harmLine!.includes(`grant GRANTED BY ERRAND e-1 (operator-role record seq 7, peerUid 1000; o-h may change i-prot from ${isoOf(H_BOUNDARY_AT + 1)} until ${isoOf(H_BOUNDARY_AT + 3)})`), String(r.harmLine));
  // NO LAUNDERING (cold refuters): an errand opening AFTER the window's start (at the record, B+2) does not cover a
  // change that may have been made before it
  assertHarmAlarm(hRead(E_CHANGE, { decidingActionId: "act-13" }, { errandGrants: [errand("e-1", ["i-prot"], H_BOUNDARY_AT + 2, H_BOUNDARY_AT + 3)] }), "a change first seen in the errand but made before it");
});

check("S208-2 · the window is [from, until): one ms after until, before from, another item → ALARM (another origin is unreachable while a basket binds one subject)", () => {
  assertHarmAlarm(hRead(E_CHANGE, { decidingActionId: "act-13" }, { errandGrants: [errand("e-1", ["i-prot"], H_BOUNDARY_AT, H_BOUNDARY_AT + 2)] }), "until is exclusive");
  assertHarmAlarm(hRead(E_CHANGE, { decidingActionId: "act-13" }, { errandGrants: [errand("e-1", ["i-prot"], H_BOUNDARY_AT + 3, H_BOUNDARY_AT + 9)] }), "before from");
  assertHarmAlarm(hRead(E_CHANGE, { decidingActionId: "act-13" }, { errandGrants: [errand("e-1", ["i-ctrl"], H_BOUNDARY_AT, H_BOUNDARY_AT + 9)] }), "another item");
});

check("S208-2 · two errands covering one record grant NOTHING (ambiguity reads as none), said in the grant text", () => {
  const two = [errand("e-1", ["i-prot"], H_BOUNDARY_AT, H_BOUNDARY_AT + 9), errand("e-2", ["i-prot"], H_BOUNDARY_AT + 1, H_BOUNDARY_AT + 9)];
  const r = hRead(E_CHANGE, { decidingActionId: "act-13" }, { errandGrants: two });
  assertHarmAlarm(r, "two errands");
  assert.ok(r.verdict.summary.includes("2 errands cover i-prot at this record's time; an ambiguous errand grant grants nothing"), r.verdict.summary);
});

check("S208-2 · errandGrants is refused whole when malformed: missing, an undeclared item or origin, an empty window, a repeated id, an extra key", () => {
  const bad: [string, unknown][] = [
    ["missing", undefined],
    ["undeclared item", [errand("e-1", ["i-none"], 1, 2)]],
    ["undeclared origin", [errand("e-1", ["i-prot"], 1, 2, "o-none")]],
    ["empty window", [errand("e-1", ["i-prot"], 2, 2)]],
    ["repeated id", [errand("e-1", ["i-prot"], 1, 2), errand("e-1", ["i-grant"], 1, 2)]],
    ["no items", [errand("e-1", [], 1, 2)]],
    ["extra key", [{ ...errand("e-1", ["i-prot"], 1, 2), x: 1 }]],
    // AA2 · the granting record's seq and peerUid are required, and integers
    ["seq missing", [(({ seq: _s, ...rest }) => rest)(errand("e-1", ["i-prot"], 1, 2))]],
    ["seq zero", [{ ...errand("e-1", ["i-prot"], 1, 2), seq: 0 }]],
    ["seq fractional", [{ ...errand("e-1", ["i-prot"], 1, 2), seq: 1.5 }]],
    ["peerUid missing", [(({ peerUid: _p, ...rest }) => rest)(errand("e-1", ["i-prot"], 1, 2))]],
    ["peerUid negative", [{ ...errand("e-1", ["i-prot"], 1, 2), peerUid: -1 }]],
    ["peerUid a string", [{ ...errand("e-1", ["i-prot"], 1, 2), peerUid: "1000" }]],
  ];
  for (const [name, v] of bad) {
    const cfg = hConfig({}, {});
    const harm = { ...(cfg.harm as Gate2Harm) } as Record<string, unknown>;
    if (v === undefined) delete harm.errandGrants; else harm.errandGrants = v;
    assertHarmBlind(call(hBook([LOOK_PROT]), { ...cfg, harm: harm as never }), "G2_HARM_MALFORMED", name);
  }
});

// ── RELAY 3 PRE-SHIP RULINGS (audit 2026-10-18 15:34Z) · the errand exit, both mechanisms on one record, and the
// errand edges' spelling. The refuter's F1, F2 and F3 (ARC_MICA-REFUTER_Relay3-Merged-Harm-Reader_20261018). ──

const R3_ERRAND_EXIT =
  "an errand grant whose window covers the record ends its latch without a clearance; the bridge refuses an errand whose `from` is earlier than the newest record it has seen, so only a clock step or a bridge run outside its unit opens this exit";

check("R3 (1a) · THE ERRAND EXIT IS NAMED AND TRUE — the ALARM's exits carry the ruled clause verbatim; an errand grant written over a latched record's window ends its latch with no clearance", () => {
  const latched = assertHarmAlarm(hRead(E_CHANGE, { decidingActionId: "act-13" }), "no errand");
  assert.ok(latched.findings[0].detail.includes(R3_ERRAND_EXIT), `the exits lack the errand clause: ${latched.findings[0].detail}`);
  assert.strictEqual(hRead(E_CHANGE, { decidingActionId: "act-13" }).latchedSince, 2, "the control is not latched at the change record");
  // the same book, the same declaration, NO clearance: only an errand covering [window start, record] is added
  const ended = hRead(E_CHANGE, { decidingActionId: "act-13" }, { clearances: [], errandGrants: [errand("e-late", ["i-prot"], H_BOUNDARY_AT + 1, H_BOUNDARY_AT + 9)] });
  assert.notStrictEqual(ended.verdict.kind, "ALARM", "an errand covering the record did not end its latch");
  assert.strictEqual(ended.latchedSince, null, "a latch still stands");
  assert.ok(ended.harmLine!.includes("grant GRANTED BY ERRAND e-late"), String(ended.harmLine));
});

// F2 · BOTH MECHANISMS ON ONE RECORD. i-grant is statically listed for o-h; its change record sits at B+2 and its
// change window starts at the prior look, B+1.
const R3_GRANT_CHANGE: HAct[] = [{ seq: 11, fp: FP_GRANT, observed: "FIRST_SEEN" }, { seq: 12, fp: FP_GRANT, observed: "CONTENT_DIFFERS" }];
const R3_LATE_SINCE = (): Partial<Gate2Harm> => ({ grantSince: { "i-prot": {}, "i-grant": { "o-h": gs(H_BOUNDARY_AT + 3) }, "i-ctrl": {} } });

check("R3 (2) · an errand grants on its OWN, not gated by the static grant's effective since, and its window is tested against its own from (kills M7, M11)", () => {
  // control: the static since (B+3) is after the record (B+2) → before the since → ALARM
  assertHarmAlarm(hRead(R3_GRANT_CHANGE, { decidingActionId: "act-13" }, R3_LATE_SINCE()), "late since, no errand");
  // one errand from the window's start (B+1): the record is granted BY THE ERRAND although the static since is later
  // (M7 gates it by the since; M11 tests the window start B+1 against the since B+3 instead of from B+1)
  const r = hRead(R3_GRANT_CHANGE, { decidingActionId: "act-13" }, { ...R3_LATE_SINCE(), errandGrants: [errand("e-1", ["i-grant"], H_BOUNDARY_AT + 1, H_BOUNDARY_AT + 9)] });
  assert.notStrictEqual(r.verdict.kind, "ALARM", "the errand did not grant a record before the static since");
  assert.ok(r.harmLine!.includes(`grant GRANTED BY ERRAND e-1 (operator-role record seq 7, peerUid 1000; o-h may change i-grant from ${isoOf(H_BOUNDARY_AT + 1)} until ${isoOf(H_BOUNDARY_AT + 9)})`), String(r.harmLine));
  // and NO LAUNDERING through the meeting: an errand opening after the window's start grants nothing here either
  assertHarmAlarm(hRead(R3_GRANT_CHANGE, { decidingActionId: "act-13" }, { ...R3_LATE_SINCE(), errandGrants: [errand("e-1", ["i-grant"], H_BOUNDARY_AT + 2, H_BOUNDARY_AT + 9)] }), "errand after the window's start, since after the record");
});

check("R3 (2) · a record granted BOTH statically and by one errand prints the STATIC grant (the errand line never wins over a since it did not need) (kills M10)", () => {
  // the default since (H_SINCE) precedes the window; one errand also covers it
  const r = hRead(R3_GRANT_CHANGE, { decidingActionId: "act-13" }, { errandGrants: [errand("e-1", ["i-grant"], H_BOUNDARY_AT + 1, H_BOUNDARY_AT + 9)] });
  assert.notStrictEqual(r.verdict.kind, "ALARM");
  assert.ok(r.harmLine!.includes(`grant GRANTED (o-h may change i-grant since ${isoOf(H_SINCE)})`), String(r.harmLine));
  assert.ok(!r.harmLine!.includes("GRANTED BY ERRAND"), String(r.harmLine));
});

check("R3 (2) · a record before its static since AND covered by two errands reads the AMBIGUOUS-errand text, not the before-since text (kills M14; the since words stay in the ALARM detail, F4)", () => {
  const two = [errand("e-1", ["i-grant"], H_BOUNDARY_AT, H_BOUNDARY_AT + 9), errand("e-2", ["i-grant"], H_BOUNDARY_AT + 1, H_BOUNDARY_AT + 9)];
  const r = hRead(R3_GRANT_CHANGE, { decidingActionId: "act-13" }, { ...R3_LATE_SINCE(), errandGrants: two });
  const a = assertHarmAlarm(r, "late since, two errands");
  assert.ok(r.harmLine!.includes("grant NONE (2 errands cover i-grant at this record's time; an ambiguous errand grant grants nothing)"), String(r.harmLine));
  assert.ok(!r.harmLine!.includes("this record is earlier"), String(r.harmLine));
  assert.ok(a.findings[0].detail.includes(`was not yet granted it (its grant counts from ${isoOf(H_BOUNDARY_AT + 3)})`), a.findings[0].detail);
});

// S216-2 M7b (refuter F5) · the record's own timestamp is compared with the EFFECTIVE since, not the declared one. The
// window-after-since check masks it only while the window starts at or before the record; a witness whose prior look
// is stamped AFTER the record (a clock stepped back between two looks) unmasks it.
check("R3 (2) · S216-2 M7b: a record before its EFFECTIVE since but after its DECLARED one is not granted, even when its window starts after the effective since (kills M7b)", () => {
  const acts: HAct[] = [{ seq: 11, fp: FP_GRANT, observed: "FIRST_SEEN" }, { seq: 12, fp: FP_GRANT, observed: "CONTENT_DIFFERS", priorLookAt: H_BOUNDARY_AT + 5 }];
  const held = { grantSince: { "i-prot": {}, "i-grant": { "o-h": gs(H_BOUNDARY_AT + 3, H_BOUNDARY_AT + 1) }, "i-ctrl": {} } };
  // the record at B+2: after the declared B+1, before the effective B+3; its window starts at B+5 (after both)
  assertHarmAlarm(hRead(acts, { decidingActionId: "act-13" }, held), "before the effective since, window after it");
  // and a carried SAME at B+2 prints before-since, not GRANTED
  const same = hRead([{ seq: 11, fp: FP_GRANT, observed: "FIRST_SEEN" }, { seq: 12, fp: FP_GRANT, observed: "SAME" }], { decidingActionId: "act-13" }, held);
  assert.ok(same.harmLine!.includes("this record is earlier"), String(same.harmLine));
});

check("R3 (2, F3) · an errand edge's utc is checked against its ms: one ms off, or without its milliseconds, is refused whole (WIRED AND BLIND); the canonical spelling passes", () => {
  const at = H_BOUNDARY_AT + 1;
  const noMs = (ms: number): string => isoOf(ms).replace(/\.\d{3}Z$/, "Z");
  const good = errand("e-1", ["i-prot"], at, at + 2000);
  const bad: [string, Gate2ErrandGrant][] = [
    ["from one ms off", { ...good, from: { at, utc: isoOf(at + 1) } }],
    ["until one ms off", { ...good, until: { at: at + 2000, utc: isoOf(at + 1999) } }],
    // H_BOUNDARY_AT is a whole second, so `at` is .001 and at + 2000 is .001: their seconds-only spellings drop ms
    ["from without ms", { ...good, from: { at, utc: noMs(at) } }],
    ["until without ms", { ...good, until: { at: at + 2000, utc: noMs(at + 2000) } }],
    // a whole-second instant spelled without its ".000" (the bridge's utcInstantMs pattern refuses it too) is refused
    ["whole second without .000", { ...good, from: { at: H_BOUNDARY_AT, utc: noMs(H_BOUNDARY_AT) } }],
  ];
  for (const [name, g] of bad) assertHarmBlind(hRead(E_CHANGE, { decidingActionId: "act-13" }, { errandGrants: [g] }), "G2_HARM_MALFORMED", name);
  const ok = hRead(E_CHANGE, { decidingActionId: "act-13" }, { errandGrants: [good] });
  assert.notStrictEqual(ok.verdict.kind, "CANNOT_ASSESS", `the canonical spelling was refused: ${String(ok.code)}`);
  assert.ok(ok.harmLine!.includes(`from ${isoOf(at)} until ${isoOf(at + 2000)}`), String(ok.harmLine));
});

// M12 / M13 ON gate-ceilings.test.ts (refuter: killed here, survive there) — COVERAGE NOTE, no arm there. That file is
// PRESENCE, NEVER CORRECTNESS by its own header: it iterates the EXPORTED GATE2_HARM_CEILING_LINES and checks each is
// printed, and says ceiling WORDING is pinned by each instrument's own arms. M13 drops a line from that same exported
// list, so a presence check over the list cannot see the line is gone; M12 changes HARM_LATCH_EXITS, which is not a
// ceiling line at all (it is printed only in an ALARM's detail). Both are wording, pinned here: M12 by "REFUTER M3",
// "S216-2 · cond. 6" and "R3 (1a)"; M13 by "HARM CEILINGS (T32)". A count or text pin in gate-ceilings would duplicate
// these arms in the file whose purpose excludes them.

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
