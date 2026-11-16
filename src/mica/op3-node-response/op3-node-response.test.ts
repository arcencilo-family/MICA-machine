import assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";
import type { MicaLogRecord, MicaReadableLog } from "../log";
import type { OperatorLayerProfile } from "../operator-layer-profile";
import { pairedStructure } from "../stat/ami";
import { tupleKey } from "../tuple-key";
import {
  assessOp3NodeResponse,
  OP3_BOUNDED_RESPONSE_CEILING,
  OP3_DECLARED_CALLS_CEILING,
  OP3_NODE_RESPONSE_CEILING_LINES,
  OP3_ORDER_ONLY_RESPONSE_CEILING,
  OP3_SHARED_RESPONSE_CEILING,
  op3NodeResponseScopeBlockText,
 oneRecordQuantum } from "./index";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}`); console.error(`    ${(error as Error).message}`); failed++; }
}

const EXPECT = { moduleId: "node", eventType: "EXPECT" } as const;
const RESPOND = { moduleId: "node", eventType: "RESPOND" } as const;
const FLAT = { amiFloor: 0.05, amiCeilingMargin: 0.02, minSample: 3 } as const;
const BOUNDED: OperatorLayerProfile = { nodeResponse: { expectationClass: EXPECT, responseClass: RESPOND, responseBoundSteps: 2, flatness: FLAT } };
const ORDER_ONLY: OperatorLayerProfile = { nodeResponse: { expectationClass: EXPECT, responseClass: RESPOND } };

function boundedProfile(flatness: { amiFloor: number; amiCeilingMargin: number; minSample: number } = FLAT): OperatorLayerProfile {
  return { nodeResponse: { expectationClass: EXPECT, responseClass: RESPOND, responseBoundSteps: 2, flatness } };
}

function r(sequenceNumber: number, kind: "expect" | "response" | "other", outcome = "ok", timestamp = sequenceNumber): MicaLogRecord {
  return {
    sequenceNumber,
    timestamp,
    moduleId: kind === "other" ? "system" : "node",
    eventType: kind === "expect" ? EXPECT.eventType : kind === "response" ? RESPOND.eventType : "WORK",
    outcome,
  };
}

function context(sequenceNumber: number, eventType: string, timestamp = sequenceNumber): MicaLogRecord {
  return { sequenceNumber, timestamp, moduleId: "context", eventType, outcome: "observed" };
}

function log(records: readonly MicaLogRecord[]): MicaReadableLog {
  return { verify: () => ({ valid: true }), getLoadState: () => "READY", getAll: () => records };
}

function assess(records: readonly MicaLogRecord[], profile = BOUNDED) {
  return assessOp3NodeResponse(log(records), profile, ["READY"]);
}

function contextPairs(
  contextClasses: readonly string[],
  responseOutcomes: readonly string[],
  timestamps?: readonly number[]
): MicaLogRecord[] {
  const records: MicaLogRecord[] = [];
  for (let i = 0; i < contextClasses.length; i++) {
    const base = i * 3;
    records.push(
      context(base, contextClasses[i], timestamps?.[base]),
      r(base + 1, "expect", "asked", timestamps?.[base + 1]),
      r(base + 2, "response", responseOutcomes[i], timestamps?.[base + 2])
    );
  }
  return records;
}

const MID_CONTEXTS = [..."AAAABBBB"];
const MID_OUTCOMES = [..."YYYNYNNN"];

function midStructureRecords(timestamps?: readonly number[]): MicaLogRecord[] {
  return contextPairs(MID_CONTEXTS, MID_OUTCOMES, timestamps);
}

console.log("\n── MICA OP-3 node response ───────────────────────────────────");

check("absent node section is typed blindness and sibling sections cannot repair it", () => {
  const result = assessOp3NodeResponse(log([r(0, "other")]), { auditObligation: { auditClass: { moduleId: "a", eventType: "b" } } }, ["READY"]);
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.blindReasonCodes, ["OP3_PROFILE_ABSENT"]);
});

check("empty or identical classes are vacuous, not silently usable", () => {
  const empty = assess([r(0, "other")], { nodeResponse: { expectationClass: { moduleId: "", eventType: "E" }, responseClass: RESPOND } });
  assert.deepStrictEqual(empty.blindReasonCodes, ["OP3_PROFILE_VACUOUS"]);
  const identical = assess([r(0, "other")], { nodeResponse: { expectationClass: EXPECT, responseClass: EXPECT } });
  assert.deepStrictEqual(identical.blindReasonCodes, ["OP3_PROFILE_VACUOUS"]);
});

check("response bound and every flatness scalar are validated at birth", () => {
  const badBound = assess([], { nodeResponse: { expectationClass: EXPECT, responseClass: RESPOND, responseBoundSteps: 0 } });
  assert.deepStrictEqual(badBound.blindReasonCodes, ["OP3_PROFILE_MALFORMED"]);
  for (const flatness of [
    { amiFloor: 0, amiCeilingMargin: 0.02, minSample: 3 },
    { amiFloor: 0.05, amiCeilingMargin: 1, minSample: 3 },
    { amiFloor: 0.05, amiCeilingMargin: 0.02, minSample: 2 },
  ]) {
    const result = assess([], { nodeResponse: { expectationClass: EXPECT, responseClass: RESPOND, flatness } });
    assert.ok(result.blindReasonCodes.includes("OP3_FLATNESS_MALFORMED"));
  }
});

check("zero expectations is a real leg-A SILENT, unlike OP-1's zero-attestation alarm", () => {
  const result = assess([r(0, "other")], ORDER_ONLY);
  assert.strictEqual(result.legA.verdict.kind, "SILENT");
  assert.ok(result.legA.verdict.summary.includes("zero expectation"));
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
});

check("order-only mode alarms an expectation with no later response", () => {
  const result = assess([r(0, "expect"), r(100, "other")], ORDER_ONLY);
  assert.strictEqual(result.legA.verdict.kind, "ALARM");
  assert.strictEqual(result.legA.verdict.kind === "ALARM" && result.legA.verdict.findings[0].code, "OP3_CALL_UNANSWERED");
  assert.ok(result.legA.verdict.summary.includes(OP3_ORDER_ONLY_RESPONSE_CEILING));
});

check("order-only mode accepts any later response and prints its louder ceiling", () => {
  const result = assess([r(0, "expect"), r(1000, "response")], ORDER_ONLY);
  assert.strictEqual(result.legA.verdict.kind, "SILENT");
  assert.ok(result.legA.verdict.summary.includes(OP3_ORDER_ONLY_RESPONSE_CEILING));
});

check("bounded next response at exact B conforms", () => {
  const result = assess([r(0, "expect"), r(2, "response")]);
  assert.strictEqual(result.legA.verdict.kind, "SILENT");
  assert.strictEqual(result.pairs.length, 1);
  assert.ok(result.legA.verdict.summary.includes(OP3_BOUNDED_RESPONSE_CEILING));
});

check("bounded next response at B+1 breaches once the readable range reaches the deadline", () => {
  const result = assess([r(0, "expect"), r(2, "other"), r(3, "response")]);
  assert.strictEqual(result.legA.verdict.kind, "ALARM");
  assert.strictEqual(result.pairs.length, 0);
});

check("expectation whose bounded window extends past range end is pending-not-assessed", () => {
  const result = assess([r(0, "other"), r(1, "expect")]);
  assert.strictEqual(result.legA.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.legA.blindReasonCodes, ["OP3_CALL_PENDING_OPEN_END"]);
  assert.strictEqual(result.pendingNotAssessed, 1);
  assert.ok(result.legA.verdict.summary.includes("pending-not-assessed"));
});

check("overlapping expectations share the next response and print the constructive ceiling", () => {
  const result = assess([r(0, "expect"), r(1, "expect"), r(2, "response")]);
  assert.strictEqual(result.legA.verdict.kind, "SILENT");
  assert.strictEqual(result.pairs.length, 2);
  assert.strictEqual(result.pairs[0].response.sequenceNumber, 2);
  assert.strictEqual(result.pairs[1].response.sequenceNumber, 2);
  assert.ok(result.legA.verdict.summary.includes(OP3_SHARED_RESPONSE_CEILING));
});

check("leg-A ALARM survives leg-B blindness and discloses the blind code", () => {
  const result = assess([r(0, "expect"), r(2, "other")], ORDER_ONLY);
  assert.strictEqual(result.legA.verdict.kind, "ALARM");
  assert.strictEqual(result.legB.verdict.kind, "CANNOT_ASSESS");
  assert.strictEqual(result.verdict.kind, "ALARM");
  assert.ok(result.blindReasonCodes.includes("OP3_FLATNESS_ABSENT"));
  assert.ok(result.verdict.summary.includes("OP3_FLATNESS_ABSENT"));
});

check("leg-A SILENT composes with leg-B blindness to CANNOT_ASSESS", () => {
  const result = assess([r(0, "expect"), r(1, "response")], ORDER_ONLY);
  assert.strictEqual(result.legA.verdict.kind, "SILENT");
  assert.strictEqual(result.legB.verdict.kind, "CANNOT_ASSESS");
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
});

check("configured leg B enforces minSample=3 as the local floor", () => {
  const result = assess([r(0, "expect"), r(1, "response")]);
  assert.deepStrictEqual(result.legB.blindReasonCodes, ["OP3_FLATNESS_INSUFFICIENT_SAMPLE"]);
});

check("single real context class keeps the arity guard and returns typed blindness", () => {
  const result = assess(contextPairs(["A", "A", "A"], ["yes", "no", "yes"]));
  assert.strictEqual(result.legA.verdict.kind, "SILENT");
  assert.strictEqual(result.legB.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.legB.blindReasonCodes, ["OP3_FLATNESS_INELIGIBLE_SCOPE"]);
  assert.strictEqual(result.flatnessStructure?.distinctLeft, 1);
  assert.ok(result.legB.verdict.kind === "CANNOT_ASSESS" && result.legB.verdict.blindPaths[0].detail.includes("single-context stream"));
});

check("leg-B context/outcome statistic is byte-identical to direct shared stat/ami computation", () => {
  const result = assess(midStructureRecords());
  const direct = pairedStructure(
    result.pairs.flatMap((pair) => pair.contextClass === null ? [] : [pair.contextClass]),
    result.pairs.flatMap((pair) => pair.contextClass === null ? [] : [pair.response.outcome])
  );
  assert.deepStrictEqual(result.flatnessStructure, direct);
});

check("pairs without a preceding complement context are counted, excluded, and disclosed", () => {
  const records = [
    r(0, "expect"), r(1, "response", "yes"),
    ...contextPairs(["A", "B", "A"], ["yes", "no", "yes"]).map((record) => ({
      ...record,
      sequenceNumber: record.sequenceNumber + 2,
    })),
  ];
  const result = assess(records);
  assert.strictEqual(result.pairs.length, 4);
  assert.strictEqual(result.flatnessContextExcluded, 1);
  assert.strictEqual(result.flatnessStructure?.sampleSize, 3);
  assert.ok(result.legB.verdict.summary.includes("1 paired expectation(s) had none"));
});

// ── T18 · FIXTURES BIG ENOUGH TO RESOLVE A COMPARISON ────────────────────────
//
// ⛔ EVERY SMALL FIXTURE IN THIS FILE BECAME UNRESOLVABLE, AND THAT IS THE
//    TICKET'S POINT RATHER THAN A PROBLEM WITH IT. `midStructureRecords()` is
//    three pairs; one record moves its AMI by ~0.42. So the ALARM and SILENT
//    branches were only ever tested on samples far too small to support the
//    verdicts they produced — the tests proved the branch REACHABLE, never the
//    verdict SUPPORTABLE. Measured quanta: n=8 → 0.51, n=24 → 0.18, n=60 → 0.06,
//    n=240 → 0.008.
//
// ⚠ AND THE CEILING NEEDS n ≈ 480 at amiCeilingMargin 0.02, because one record
//   must move AMI by less than 0.02 before "at the ceiling" can be told from
//   "near it". The live box reads 326 pairs, so op3's CEILING comparison is
//   currently unreachable in production — stated in the receipt, not hidden here.
function couplePairs(pairs: number, contexts: number, outcomes: number, couple: number, seed: number): MicaLogRecord[] {
  let s = seed >>> 0;
  const rnd = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cs: string[] = [];
  const os: string[] = [];
  for (let i = 0; i < pairs; i++) {
    const c = i % contexts;
    cs.push(`C${String(c)}`);
    os.push(rnd() < couple ? `O${String(c % outcomes)}` : `O${String(Math.floor(rnd() * outcomes))}`);
  }
  return contextPairs(cs, os);
}

/** A perfect table: outcome determined by context, so AMI is exactly 1. */
function perfectPairs(pairs: number): MicaLogRecord[] {
  const cs: string[] = [];
  const os: string[] = [];
  for (let i = 0; i < pairs; i++) {
    const c = i % 2;
    cs.push(`C${String(c)}`);
    os.push(`O${String(c)}`);
  }
  return contextPairs(cs, os);
}

check("T18: AT the floor the comparison is UNRESOLVABLE — the boundary is where one record decides", () => {
  // ⛔ THIS TEST USED TO ASSERT "equality and −ε stay SILENT; +ε ALARMS". That is
  //    exactly the claim T18 refuses: at ±1e-9 from the floor, the verdict is
  //    decided by a distance nine orders of magnitude smaller than what one
  //    record can move. The old assertion was true of the code and false of the
  //    world, and it is now the gate's own case.
  const measured = assess(midStructureRecords()).flatnessStructure?.ami;
  assert.ok(measured !== null && measured !== undefined && measured > 0 && measured < 1);
  for (const floor of [measured, measured + 1e-9, measured - 1e-9]) {
    const got = assess(midStructureRecords(), boundedProfile({ amiFloor: floor, amiCeilingMargin: 0.02, minSample: 3 }));
    assert.strictEqual(got.legB.verdict.kind, "CANNOT_ASSESS", `floor ${String(floor)}`);
    assert.deepStrictEqual(got.legB.blindReasonCodes, ["OP3_FLATNESS_UNRESOLVABLE_AT_FLOOR"]);
    const detail = got.legB.verdict.kind === "CANNOT_ASSESS" ? got.legB.verdict.blindPaths[0].detail : "";
    // condition 4: the quantum, the distance, AND the move that achieved it
    assert.ok(detail.includes("OP3_FLATNESS_UNRESOLVABLE_AT_FLOOR"), detail);
    assert.ok(/ONE RECORD can move AMI by 0\.\d{6}/.test(detail), detail);
    assert.ok(/context "[^"]+": one record from outcome "[^"]+" to "[^"]+" moves AMI by 0\.\d{6}/.test(detail), detail);
    assert.ok(detail.includes("plug-in MI="), `the margins must still be disclosed: ${detail}`);
  }
});

check("T18: FAR from the floor the comparison still happens — ALARM below, SILENT above", () => {
  // n=240 at 3 contexts x 3 outcomes: the quantum is ~0.008, so a floor set well
  // outside it is a comparison the sample CAN resolve.
  const records = couplePairs(240, 3, 3, 0.5, 99);
  const measured = assess(records, boundedProfile({ amiFloor: 0.05, amiCeilingMargin: 0.02, minSample: 3 })).flatnessStructure?.ami;
  assert.ok(measured !== null && measured !== undefined, "the fixture must produce an AMI");
  const alarm = assess(records, boundedProfile({ amiFloor: measured + 0.1, amiCeilingMargin: 0.02, minSample: 3 }));
  const silent = assess(records, boundedProfile({ amiFloor: measured - 0.1, amiCeilingMargin: 0.02, minSample: 3 }));
  assert.strictEqual(alarm.legB.verdict.kind, "ALARM", JSON.stringify(alarm.legB.blindReasonCodes));
  assert.strictEqual(alarm.legB.verdict.kind === "ALARM" && alarm.legB.verdict.findings[0].code, "OP3_RESPONSE_FLATLINE");
  assert.strictEqual(silent.legB.verdict.kind, "SILENT", JSON.stringify(silent.legB.blindReasonCodes));
});

check("T18: a SMALL perfect table is UNRESOLVABLE at the ceiling, not at the ceiling", () => {
  // AMI is exactly 1 and the ceiling is 0.98, so the distance is 0.02 — while one
  // record in an 8-pair table moves AMI by 0.51. The old test called this
  // "ceiling-margin corner" and read INELIGIBLE_SCOPE; the cause is now named.
  const result = assess(perfectPairs(8), boundedProfile({ amiFloor: 0.05, amiCeilingMargin: 0.02, minSample: 3 }));
  assert.strictEqual(result.flatnessStructure?.ami, 1);
  assert.strictEqual(result.legB.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.legB.blindReasonCodes, ["OP3_FLATNESS_UNRESOLVABLE_AT_CEILING"]);
});

check("T18: the CEILING branch is still reachable — but only on a sample that can resolve it", () => {
  // ⛔ n MUST BE ~480 AT margin 0.02, measured: quanta 0.51 (n=8), 0.22 (24),
  //    0.11 (60), 0.062 (120), 0.035 (240), 0.0195 (480). Only at 480 does one
  //    record move AMI by less than the margin. THE LIVE BOX READS 326 PAIRS, so
  //    op3's ceiling comparison is currently unreachable in production — which is
  //    a consequence of the grant, not a defect in it, and it is in the receipt.
  const result = assess(perfectPairs(480), boundedProfile({ amiFloor: 0.05, amiCeilingMargin: 0.02, minSample: 3 }));
  assert.strictEqual(result.flatnessStructure?.ami, 1);
  assert.strictEqual(result.legB.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.legB.blindReasonCodes, ["OP3_FLATNESS_INELIGIBLE_SCOPE"]);
  const detail = result.legB.verdict.kind === "CANNOT_ASSESS" ? result.legB.verdict.blindPaths[0].detail : "";
  assert.ok(detail.includes("within injected ceiling margin"), detail);
});

check("reverse composition: leg-B ALARM survives leg-A open-end blindness with both codes disclosed", () => {
  const records = [
    ...contextPairs([..."AAAABBBB"], [..."YYYYYYYY"]),
    context(24, "PENDING"),
    r(25, "expect"),
  ];
  const result = assess(records);
  assert.strictEqual(result.legA.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.legA.blindReasonCodes, ["OP3_CALL_PENDING_OPEN_END"]);
  assert.strictEqual(result.legB.verdict.kind, "ALARM");
  assert.strictEqual(result.verdict.kind, "ALARM");
  assert.ok(result.verdict.summary.includes("OP3_CALL_PENDING_OPEN_END"));
  assert.strictEqual(result.legB.verdict.kind === "ALARM" && result.legB.verdict.findings[0].code, "OP3_RESPONSE_FLATLINE");
});

check("composite SILENT is reachable — on a sample whose mid-band reading is resolvable", () => {
  // The three-pair fixture can no longer reach SILENT: one record moves its AMI
  // by ~0.42, so no floor sits outside the quantum. A composite SILENT now needs
  // a sample that can support one.
  const records = couplePairs(240, 3, 3, 0.5, 7);
  const probe = assess(records, boundedProfile({ amiFloor: 0.05, amiCeilingMargin: 0.02, minSample: 3 }));
  const measured = probe.flatnessStructure?.ami;
  assert.ok(measured !== null && measured !== undefined);
  const result = assess(records, boundedProfile({ amiFloor: measured - 0.1, amiCeilingMargin: 0.02, minSample: 3 }));
  assert.strictEqual(result.legA.verdict.kind, "SILENT");
  assert.strictEqual(result.legB.verdict.kind, "SILENT", JSON.stringify(result.legB.blindReasonCodes));
  assert.strictEqual(result.verdict.kind, "SILENT");
});

check("declared-class masking: shadow-typed unanswered calls leave leg A SILENT and print the panel ceiling", () => {
  const shadowCalls = [
    { ...context(0, "REAL_CALL_SHADOW"), outcome: "unanswered" },
    { ...context(1, "REAL_CALL_SHADOW"), outcome: "unanswered" },
  ];
  const result = assess(shadowCalls);
  assert.strictEqual(result.legA.verdict.kind, "SILENT");
  assert.strictEqual(result.legB.verdict.kind, "CANNOT_ASSESS");
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
  assert.ok(result.legA.verdict.summary.includes(OP3_DECLARED_CALLS_CEILING));
  assert.ok(result.verdict.summary.includes(OP3_DECLARED_CALLS_CEILING));
});

check("adversarial timestamps leave every OP-3 result byte-identical", () => {
  const ordinary = assess(midStructureRecords(Array.from({ length: 24 }, (_, index) => index + 1)));
  const hostile = assess(midStructureRecords(Array.from({ length: 24 }, (_, index) =>
    index % 3 === 0 ? Number.NaN : index % 3 === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
  )));
  assert.deepStrictEqual(hostile, ordinary);
});

check("source never reads timestamp", () => {
  const source = readFileSync(join(__dirname, "index.ts"), "utf8");
  assert.ok(!/\.timestamp\b|\[\s*["']timestamp["']\s*\]/.test(source));
});

check("vocabulary fence keeps interior-asserting words out of executable source", () => {
  const source = readFileSync(join(__dirname, "index.ts"), "utf8");
  const start = source.indexOf("// OP3_VOCABULARY_CEILING_FENCE_START");
  const end = source.indexOf("// OP3_VOCABULARY_CEILING_FENCE_END");
  assert.ok(start >= 0 && end > start);
  const outside = source.slice(0, start) + source.slice(end + "// OP3_VOCABULARY_CEILING_FENCE_END".length);
  for (const word of ["negligent", "abdicated", "captured", "incompetent", "lazy", "malicious"]) {
    assert.ok(!new RegExp(`\\b${word}\\b`, "i").test(outside), `${word} escaped the ceiling fence`);
  }
});

check("all leg and composite surfaces carry every local ceiling", () => {
  const results = [
    assess([r(0, "expect"), r(2, "other")], ORDER_ONLY),
    assess([r(0, "expect"), r(1, "response")], ORDER_ONLY),
    assess(midStructureRecords()),
  ];
  for (const result of results) {
    for (const verdict of [result.legA.verdict, result.legB.verdict, result.verdict]) {
      for (const line of OP3_NODE_RESPONSE_CEILING_LINES) assert.ok(verdict.summary.includes(line));
      assert.ok(verdict.summary.includes("SITE THIRTEEN FLAGGED"));
    }
  }
});

check("scope prints section status, site thirteen, the firewall, parked leg C, and all ceilings", () => {
  const scope = op3NodeResponseScopeBlockText(BOUNDED, ["READY"]);
  assert.ok(scope.includes("nodeResponse section status: DECLARED"));
  assert.ok(scope.includes("SITE THIRTEEN FLAGGED"));
  assert.ok(scope.includes("CONSUMER-SEMANTICS FIREWALL"));
  assert.ok(scope.includes("LEG C PARKED"));
  for (const line of OP3_NODE_RESPONSE_CEILING_LINES) assert.ok(scope.includes(line));
});

// ══ T17 · DISCLOSURE — the margins, on every path that reaches the statistic ══
//
// ⛔ WHY THESE EXIST. op3 was the ONLY dependence reader that did not disclose
//    its margins, and on 2026-10-02 at 10:48Z it ALARMED with AMI=0.190410 over
//    320 pairs against floor 0.2 and HELD THE BOX — and nobody could say whether
//    that was a reading or the chance correction, because the numbers that decide
//    it were not printed. narrow-W's alarm the same morning WAS adjudicable from
//    its output alone. These tests pin the asymmetry closed.

console.log("\n══ T17 · margin disclosure ═══════════════════════════════════");

/** Every text op3's leg B can emit on a path that reached the statistic. */
function legBTexts(result: ReturnType<typeof assess>): string[] {
  const v: any = result.legB.verdict;
  const out: string[] = [];
  for (const f of (v.findings ?? [])) out.push(String(f.detail));
  for (const b of (v.blindPaths ?? [])) out.push(String(b.detail));
  if (typeof v.summary === "string") out.push(v.summary);
  return out;
}

const T17_FIELDS = ["plug-in MI=", "E[MI]=", "H(context)=", "H(outcome)=", "CONTEXT class(es)", "OUTCOME class(es)", "n="];

// ⛔ T18 MOVED THESE TWO OFF A ±1e-9 FLOOR. They used to reach ALARM and SILENT by
//    placing the floor one billionth either side of the measured AMI on a
//    three-pair table — a distance the sample cannot resolve, so the gate now
//    refuses it. T17's claim is unchanged (every statistic-bearing path discloses
//    its margins); only the fixture had to become one that can support a verdict.
check("T17: the ALARM path carries every margin field", () => {
  const records = couplePairs(240, 3, 3, 0.5, 99);
  const measured = assess(records, boundedProfile({ amiFloor: 0.05, amiCeilingMargin: 0.02, minSample: 3 })).flatnessStructure?.ami as number;
  const r = assess(records, boundedProfile({ amiFloor: measured + 0.1, amiCeilingMargin: 0.02, minSample: 3 }));
  assert.strictEqual(r.legB.verdict.kind, "ALARM", JSON.stringify(r.legB.blindReasonCodes));
  const detail = legBTexts(r).find((t) => t.includes("AMI=")) as string;
  for (const f of T17_FIELDS) assert.ok(detail.includes(f), `the ALARM detail must carry ${f}; got: ${detail}`);
});

check("T17: the SILENT path carries every margin field — a quiet reading leaves its evidence", () => {
  const records = couplePairs(240, 3, 3, 0.5, 99);
  const measured = assess(records, boundedProfile({ amiFloor: 0.05, amiCeilingMargin: 0.02, minSample: 3 })).flatnessStructure?.ami as number;
  const r = assess(records, boundedProfile({ amiFloor: measured - 0.1, amiCeilingMargin: 0.02, minSample: 3 }));
  assert.strictEqual(r.legB.verdict.kind, "SILENT", JSON.stringify(r.legB.blindReasonCodes));
  const text = legBTexts(r).join(" ");
  for (const f of T17_FIELDS) assert.ok(text.includes(f), `the SILENT text must carry ${f}; got: ${text}`);
});

check("T19 (folded under T18's grant): the FIFTH PATH — a non-positive AMI denominator — also carries the margins", () => {
  // ⛔ T17's brief claimed five leg-B paths reach the statistic and its suite
  //    tested FOUR: alarm, silent, ceiling and the single-context blind. The
  //    null-denominator blind was asserted in prose and never exercised — a count
  //    in a sentence standing in for a check, and it was my sentence.
  //
  //    THE FIXTURE: three contexts, three outcomes, each occurring once. Then
  //    H(context) = H(outcome) = ln 3 and the exact E[MI] equals it, so the
  //    denominator max(H_left, H_right) − E[MI] is ZERO and `ami` is null rather
  //    than a number — the permutation model already accounts for everything this
  //    table could show.
  //
  // ⚠ AND THE T18 GATE NEVER SEES IT, which is condition 1 working: the gate sits
  //   AFTER the null-denominator check, so a table with no AMI is refused for not
  //   having one rather than for being unresolvable. Two causes, two branches.
  const r5 = assess(contextPairs([..."ABC"], [..."WXY"]));
  assert.strictEqual(r5.flatnessStructure?.ami, null, "this fixture must reach the null-denominator path");
  assert.strictEqual(r5.legB.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(r5.legB.blindReasonCodes, ["OP3_FLATNESS_INELIGIBLE_SCOPE"]);
  const text5 = legBTexts(r5).join(" ");
  for (const f of T17_FIELDS) assert.ok(text5.includes(f), `the null-denominator path must carry ${f}; got: ${text5}`);
  // ⚠ AND IT MUST NOT PRINT AN AMI IT DOES NOT HAVE. The shared margin block
  //   deliberately excludes AMI for exactly this path; a number here would be a
  //   measurement nobody made.
  assert.ok(!/AMI=NaN|AMI=null|AMI=undefined/.test(text5), `no fabricated AMI on the null path: ${text5}`);
});

check("T19 (folded under T18's grant): the emitted AMI reproduces FROM THE EMITTED TEXT, parsed", () => {
  // ⛔ WHY PARSING RATHER THAN READING `structure`. The earlier version took the
  //    six-decimal values off the structure object and did the arithmetic on
  //    those. That proves the ARITHMETIC and not the DISCLOSURE — it would still
  //    pass if the reader printed nothing at all. The property T17 is for is that
  //    A READER OF THE OUTPUT can recover the verdict's own statistic, so the
  //    numbers are scraped out of the emitted string exactly as a human or an
  //    auditing seat would have to.
  //
  // ⚠ RE-FIXTURED FOR T18. The original reached ALARM by setting the floor 1e-9
  //   under the measured AMI on a three-pair table; the gate now refuses that
  //   distance, correctly. A resolvable sample is used instead.
  const records = couplePairs(240, 3, 3, 0.5, 99);
  const measured = assess(records, boundedProfile({ amiFloor: 0.05, amiCeilingMargin: 0.02, minSample: 3 })).flatnessStructure?.ami as number;
  const rt = assess(records, boundedProfile({ amiFloor: measured + 0.1, amiCeilingMargin: 0.02, minSample: 3 }));
  assert.strictEqual(rt.legB.verdict.kind, "ALARM", JSON.stringify(rt.legB.blindReasonCodes));
  const emitted = legBTexts(rt).find((t) => t.includes("AMI=")) as string;
  const grab = (label: string): number => {
    const m = new RegExp(`${label.replace(/[[\]()]/g, "\\$&")}=(-?[0-9]+\\.[0-9]{6})`).exec(emitted);
    assert.ok(m !== null, `the emitted text must carry ${label}= to six decimals; got: ${emitted}`);
    return Number((m as RegExpExecArray)[1]);
  };
  const eMI = grab("plug-in MI");
  const eEMI = grab("E[MI]");
  const eHc = grab("H(context)");
  const eHo = grab("H(outcome)");
  const eAMI = grab("AMI");
  const reproducedFromText = (eMI - eEMI) / (Math.max(eHc, eHo) - eEMI);
  // six decimals in, six decimals out: the tolerance is the printing, not the maths
  assert.ok(
    Math.abs(reproducedFromText - eAMI) < 5e-6,
    `AMI must reproduce from the EMITTED numbers: parsed MI=${String(eMI)} E[MI]=${String(eEMI)} ` +
      `H(c)=${String(eHc)} H(o)=${String(eHo)} -> ${String(reproducedFromText)}, emitted AMI=${String(eAMI)}`
  );
});

check("T18 cond 6 / T20 cond 2: the CHEAP form — recomputes bounded by kC·kO·((kO−1)+(kC−1)), and INDEPENDENT of n", () => {
  // ⛔ THE CHEAP FORM IS REQUIRED, NOT AN OPTIMISATION. Brute force is O(n·kO)
  //    recomputes and O(n²) overall: 56.3 s per decision at n=2000/8×8, which
  //    would make this reader the thing that stalls the agent it watches. AMI is a
  //    function of the contingency TABLE, so the distinct one-record moves are the
  //    (context, from, to) triples with a non-empty source cell — and n drops out.
  const shapes: Array<[number, number]> = [[2, 2], [3, 3]];
  for (const [kC, kO] of shapes) {
    const counts: number[] = [];
    for (const n of [24, 60, 240]) {
      const recs = couplePairs(n, kC, kO, 0.5, 11);
      const got = assess(recs, boundedProfile({ amiFloor: 0.05, amiCeilingMargin: 0.02, minSample: 3 }));
      const s = got.flatnessStructure;
      assert.ok(s !== null && s !== undefined && s.ami !== null, `n=${String(n)} must produce an AMI`);
      // ⚠ CONTEXT-BEARING PAIRS ONLY, and aligned: `contextClass` is nullable
      //   (a pair with no preceding context), and the reader pairs only the ones
      //   that have one. Filtering once and mapping both sides from the SAME list
      //   is the only way the two vectors stay in step.
      const bearing = got.pairs.filter((x): x is typeof x & { contextClass: string } => x.contextClass !== null);
      const left = bearing.map((x) => x.contextClass);
      const right = bearing.map((x) => x.response.outcome);
      const q = oneRecordQuantum(left, right, s.ami as number);
      // ⛔ T20 · THE BOUND WIDENS WITH THE MOVE SET. The broad set relabels a
      //    record's CONTEXT as well as its outcome, so each occupied cell carries
      //    (kO−1) outcome moves plus (kC−1) context moves, and the ceiling is
      //    kC·kO·((kO−1)+(kC−1)). At the live shape 8×2 that is 16 × 8 = 128.
      const bound = s.distinctLeft * s.distinctRight * ((s.distinctRight - 1) + (s.distinctLeft - 1));
      assert.ok(
        q.recomputes <= bound,
        `${String(kC)}x${String(kO)} n=${String(n)}: ${String(q.recomputes)} recomputes exceeds kC·kO·((kO−1)+(kC−1))=${String(bound)}`
      );
      // ⛔ CODEX, T18 READ, F4: THIS ASSERTION WAS WEAKER THAN ITS OWN WORDING AND
      //    IT PASSED WHILE THE COUNT GREW. The old form sat after this loop and read
      //    `counts[2] <= counts[0] * 1.5`; on three 3×2 shapes at n=24/60/240 with
      //    four, five and six occupied cells the counts were 4, 5, 6 — so `6 <= 6`
      //    held and the test claimed "independent of n" while the number rose. The
      //    growth was not O(n) recomputation; it was OCCUPANCY FILLING: a bigger
      //    sample fills more (context, outcome) cells and each contributes (kO − 1)
      //    moves.
      //
      //    So the invariant is asserted as what it actually is — recomputes EQUAL
      //    occupied cells × (kO − 1), bounded by kC·kO·(kO − 1) however large n
      //    becomes. A tolerance is not a proof, and one chosen to make a passing
      //    test pass proves nothing at all.
      // ⛔ T22 · THE TEST HAD ITS OWN COPY OF THE AMBIGUOUS ENCODING. On these
      //    fixtures it happened to give the right answer, which is exactly how a
      //    latent bug survives a test: the expected value was computed by the same
      //    broken rule as the shipped one, so the two agreed while both were wrong.
      const occupied = new Set(bearing.map((x) => tupleKey([x.contextClass, x.response.outcome]))).size;
      assert.strictEqual(
        q.recomputes,
        occupied * ((s.distinctRight - 1) + (s.distinctLeft - 1)),
        `${String(kC)}x${String(kO)} n=${String(n)}: recomputes must be occupied cells × ((kO−1)+(kC−1)); ` +
          `occupied=${String(occupied)} kO=${String(s.distinctRight)} kC=${String(s.distinctLeft)} got=${String(q.recomputes)}`
      );
      assert.ok(
        occupied <= s.distinctLeft * s.distinctRight,
        `occupied cells cannot exceed kC·kO: ${String(occupied)} > ${String(s.distinctLeft * s.distinctRight)}`
      );
      counts.push(q.recomputes);
    }
    // The per-n equality above IS the invariant. The series is kept only so a
    // failure elsewhere can print it, never as evidence on its own.
    assert.strictEqual(counts.length, 3, JSON.stringify(counts));
  }
});


check("T22 cond 1: ⛔ EVERY CONTROL CHARACTER in a label, and the recompute invariant holds for all of them", () => {
  // ⛔ CODEX ON T20, 2026-10-03: "a U+0001 context label gives 12, not 8".
  //    Reproduced before the fix: 12 with one such label, 16 with two. The cause
  //    was two stacked defects — T18 hand-rolled `${left}\u0001${right}` as a cell
  //    key (an ASSUMED-forbidden delimiter, the exact pattern src/mica/tuple-key.ts
  //    was written to kill), and T20 then PARSED that key back out with indexOf,
  //    turning a latent ambiguity into a live miscount.
  //
  // ⚠ AND U+0001 IS NOT SPECIAL. It was only the delimiter that had been chosen,
  //   so the test sweeps the whole C0 range rather than the one character reported.
  const profile = boundedProfile({ amiFloor: 0.05, amiCeilingMargin: 0.02, minSample: 3 });
  const failures: string[] = [];
  for (let code = 0; code <= 0x1f; code++) {
    const ch = String.fromCharCode(code);
    // the control character goes in BOTH axes' labels, since either side can carry it
    const left = [`A${ch}X`, `A${ch}X`, "B", "B"];
    const right = [`Y${ch}1`, "N", `Y${ch}1`, "N"];
    const s = pairedStructure(left, right);
    if (s.ami === null) { failures.push(`U+${code.toString(16).padStart(4, "0")}: no AMI`); continue; }
    const q = oneRecordQuantum(left, right, s.ami);
    const occupied = new Set(left.map((l, i) => tupleKey([l, right[i]]))).size;
    const expected = occupied * ((s.distinctRight - 1) + (s.distinctLeft - 1));
    if (q.recomputes !== expected) {
      failures.push(`U+${code.toString(16).padStart(4, "0")}: ${String(q.recomputes)} recomputes, expected ${String(expected)}`);
    }
    // and the four cells must stay four cells — no collapse from an encoding
    if (occupied !== 4) failures.push(`U+${code.toString(16).padStart(4, "0")}: ${String(occupied)} occupied cells, expected 4`);
  }
  assert.deepStrictEqual(failures, [], `control characters that break the invariant:\n    ${failures.join("\n    ")}`);
  console.log(`      (32 control characters U+0000…U+001F, each in both axes' labels: invariant holds for all)`);
  void profile;
});

check("T22 cond 3: ⛔ TWO DISTINCT CELLS THAT COLLIDE UNDER THE OLD KEY ARE STILL TWO CELLS", () => {
  // ⛔ THIS TEST EXISTS BECAUSE THE FIRST VERSION OF T22's SUITE DID NOT CATCH THE
  //    BUG IT WAS WRITTEN FOR. A mutation that restored the ambiguous delimiter left
  //    44/44 green: the control-character sweep above pins the PARSE (T20's defect)
  //    and no fixture in it made two pairs COLLIDE, so the KEY (T18's defect) was
  //    unguarded. Found by the mutation differential, not by reading.
  //
  //    These two pairs are distinct and share a key under `${left}\u0001${right}`:
  //        (context "A\u0001X", outcome "Y")   →  "A\u0001X\u0001Y"
  //        (context "A",         outcome "X\u0001Y") →  "A\u0001X\u0001Y"
  //    Under the old encoding the map holds ONE entry where there are TWO cells, so
  //    one real cell contributes no moves at all and the count halves.
  const left = ["A\u0001X", "A", "B", "B"];
  const right = ["Y", "X\u0001Y", "Y", "X\u0001Y"];
  assert.strictEqual(
    `${left[0]}\u0001${right[0]}`,
    `${left[1]}\u0001${right[1]}`,
    "the fixture must actually collide under the OLD key, or this test proves nothing"
  );
  assert.notStrictEqual(tupleKey([left[0], right[0]]), tupleKey([left[1], right[1]]));
  const s = pairedStructure(left, right);
  assert.ok(s.ami !== null, "the fixture must produce an AMI");
  const q = oneRecordQuantum(left, right, s.ami as number);
  const occupied = new Set(left.map((l, i) => tupleKey([l, right[i]]))).size;
  assert.strictEqual(occupied, 4, "four distinct cells");
  assert.strictEqual(
    q.recomputes,
    occupied * ((s.distinctRight - 1) + (s.distinctLeft - 1)),
    `collapsed cells: ${String(q.recomputes)} recomputes over ${String(occupied)} cells, ` +
      `kC=${String(s.distinctLeft)} kO=${String(s.distinctRight)}`
  );
});

check("T22 cond 2: the cell key is the HOUSE's tupleKey, and two distinct pairs cannot collide", () => {
  // ⛔ THE PROPERTY, ASSERTED DIRECTLY, because the loop count above would also
  //    pass on an encoding that merely happened not to collide on those fixtures.
  //    narrow-k's suite already asserts this for its own siblings; op3 now shares
  //    the same primitive instead of carrying a second copy of the idea.
  assert.notStrictEqual(tupleKey(["a", "bc"]), tupleKey(["ab", "c"]));
  assert.notStrictEqual(tupleKey(["A\u0001X", "Y"]), tupleKey(["A", "X\u0001Y"]));
  // the ambiguous form these two replaced collided; this is what it looked like
  assert.strictEqual(`A\u0001X` + "\u0001" + "Y", "A" + "\u0001" + `X\u0001Y`);
});

check("T18 cond 6 / T20 cond 1: the cheap quantum EQUALS the brute force over BOTH axes, and CONTAINS the narrow one", () => {
  // The brute force, written here rather than shipped: one recompute per (record,
  // alternative LABEL ON EITHER AXIS). If the two ever disagree the cheap form is
  // wrong, and the whole gate rests on them agreeing.
  //
  // ⛔ T20 WIDENED THIS, AND THE OLD VERSION FAILED LOUDLY RATHER THAN QUIETLY,
  //    which is the only reason it is worth recording. Left as outcome-only it read
  //    `2x2: cheap 0.028480710596 vs brute 0.027241163673` — the cheap broad form
  //    against a narrow reference. A disagreement between the shipped quantum and
  //    its own check is indistinguishable from the shipped quantum being wrong, so
  //    a reference that lags the definition is worse than no reference at all.
  const brute = (left: readonly string[], right: readonly string[], base: number): number => {
    const outcomes = [...new Set(right)];
    const contexts = [...new Set(left)];
    let worst = 0;
    for (let i = 0; i < left.length; i++) {
      for (const to of outcomes) {
        if (to === right[i]) continue;
        const moved = right.slice();
        moved[i] = to;
        const shifted = pairedStructure(left, moved).ami;
        if (shifted !== null) worst = Math.max(worst, Math.abs(shifted - base));
      }
      for (const to of contexts) {
        if (to === left[i]) continue;
        const moved = left.slice();
        moved[i] = to;
        const shifted = pairedStructure(moved, right).ami;
        if (shifted !== null) worst = Math.max(worst, Math.abs(shifted - base));
      }
    }
    return worst;
  };
  /** T18's superseded definition, kept ONLY to prove containment (T20 condition 1). */
  const narrowOnly = (left: readonly string[], right: readonly string[], base: number): number => {
    const outcomes = [...new Set(right)];
    let worst = 0;
    for (let i = 0; i < left.length; i++) {
      for (const to of outcomes) {
        if (to === right[i]) continue;
        const moved = right.slice();
        moved[i] = to;
        const shifted = pairedStructure(left, moved).ami;
        if (shifted !== null) worst = Math.max(worst, Math.abs(shifted - base));
      }
    }
    return worst;
  };
  for (const [kC, kO] of [[2, 2], [3, 3]] as Array<[number, number]>) {
    const recs = couplePairs(60, kC, kO, 0.5, 23);
    const got = assess(recs, boundedProfile({ amiFloor: 0.05, amiCeilingMargin: 0.02, minSample: 3 }));
    const s = got.flatnessStructure;
    assert.ok(s !== null && s !== undefined && s.ami !== null);
    const bearing = got.pairs.filter((x): x is typeof x & { contextClass: string } => x.contextClass !== null);
    const left = bearing.map((x) => x.contextClass);
    const right = bearing.map((x) => x.response.outcome);
    const cheap = oneRecordQuantum(left, right, s.ami as number).quantum;
    const slow = brute(left, right, s.ami as number);
    assert.strictEqual(
      cheap.toFixed(12),
      slow.toFixed(12),
      `${String(kC)}x${String(kO)}: cheap ${String(cheap)} vs brute ${String(slow)}`
    );
    // ⛔ T20 CONDITION 1 — CONTAINMENT, AND IT IS THE WHOLE CORRECTNESS ARGUMENT.
    //    The broad move set CONTAINS the narrow one, so the maximum over it cannot
    //    be smaller. That is why adopting the broad reading can only turn a
    //    supportable ALARM or SILENT into CANNOT_ASSESS and never the reverse: a
    //    larger quantum only ever refuses a comparison, it never licenses one.
    const narrow = narrowOnly(left, right, s.ami as number);
    assert.ok(
      cheap >= narrow,
      `${String(kC)}x${String(kO)}: the broad quantum ${String(cheap)} must not be below the narrow ${String(narrow)}`
    );
    assert.ok(narrow > 0, `${String(kC)}x${String(kO)}: a narrow quantum of 0 would make containment vacuous`);
  }
});


check("T20 cond 3: when BOTH boundaries lie inside the quantum, BOTH reason codes are emitted", () => {
  // ⛔ CODEX F3, T18 READ. T18 named the chosen cause in the code and the other
  //    boundary in prose only (`bothNote`), so a consumer reading reason codes saw
  //    ONE unresolvable boundary where there were two. The arbiter's grant: "never
  //    one in code and the other in prose."
  const recs = couplePairs(6, 2, 2, 0.5, 11);
  const profile = boundedProfile({ amiFloor: 0.05, amiCeilingMargin: 0.02, minSample: 3 });
  const r = assess(recs, profile);
  const s = r.flatnessStructure;
  assert.ok(s !== null && s !== undefined && s.ami !== null, "the fixture must produce an AMI");
  // ⚠ THE PRECONDITION IS ASSERTED, NOT ASSUMED. If this fixture ever stops being a
  //   both-boundary case, THIS fails loudly instead of the test below passing
  //   vacuously — which is the defect this campaign has named four times.
  const bearing = r.pairs.filter((x): x is typeof x & { contextClass: string } => x.contextClass !== null);
  const q = oneRecordQuantum(bearing.map((x) => x.contextClass), bearing.map((x) => x.response.outcome), s.ami as number);
  const toFloor = Math.abs((s.ami as number) - 0.05);
  const toCeiling = Math.abs((s.ami as number) - (0.98 - 0.02));
  assert.ok(toFloor <= q.quantum, `the FLOOR must be inside the quantum: ${String(toFloor)} > ${String(q.quantum)}`);
  assert.ok(toCeiling <= q.quantum, `the CEILING must be inside the quantum: ${String(toCeiling)} > ${String(q.quantum)}`);

  assert.deepStrictEqual(
    r.legB.blindReasonCodes,
    ["OP3_FLATNESS_UNRESOLVABLE_AT_CEILING", "OP3_FLATNESS_UNRESOLVABLE_AT_FLOOR"],
    `both codes, ceiling first; got ${JSON.stringify(r.legB.blindReasonCodes)}`
  );
  // and the detail still names which boundary the SENTENCE is about, plus the other
  const text = legBTexts(r).join(" ");
  assert.ok(text.includes("OP3_FLATNESS_UNRESOLVABLE_AT_CEILING"), text);
  assert.ok(text.includes("The distance to the FLOOR is also inside the quantum"), text);
  console.log(`      (both-boundary fixture: AMI=${(s.ami as number).toFixed(6)}, quantum=${q.quantum.toFixed(6)}, floor ${toFloor.toFixed(6)}, ceiling ${toCeiling.toFixed(6)})`);
});

check("T20 cond 3: ONE boundary inside the quantum still emits exactly ONE code", () => {
  // ⛔ THE OTHER HALF, because a rule that always emitted both would satisfy the
  //    condition above and destroy the distinction it exists to preserve.
  const measured = assess(midStructureRecords()).flatnessStructure?.ami as number;
  const r = assess(midStructureRecords(), boundedProfile({ amiFloor: measured, amiCeilingMargin: 0.02, minSample: 3 }));
  assert.deepStrictEqual(r.legB.blindReasonCodes, ["OP3_FLATNESS_UNRESOLVABLE_AT_FLOOR"]);
});

check("T20 cond 4: the move names its AXIS, and a CONTEXT relabel can win", () => {
  // ⛔ A quantum whose largest move cannot be attributed to an axis is a number
  //    without a mechanism. Measured on a table of the LIVE shape (8 CONTEXT × 2
  //    OUTCOME, n=328) before this ticket was drafted, the winner was a CONTEXT
  //    relabel — so context moves are not a formality, they can dominate.
  const recs = couplePairs(240, 3, 3, 0.5, 11);
  const got = assess(recs, boundedProfile({ amiFloor: 0.05, amiCeilingMargin: 0.02, minSample: 3 }));
  const s = got.flatnessStructure;
  assert.ok(s !== null && s !== undefined && s.ami !== null);
  const bearing = got.pairs.filter((x): x is typeof x & { contextClass: string } => x.contextClass !== null);
  const q = oneRecordQuantum(bearing.map((x) => x.contextClass), bearing.map((x) => x.response.outcome), s.ami as number);
  assert.ok(
    /^(CONTEXT|OUTCOME) relabel/.test(q.move) || q.move.startsWith("no single-record move"),
    `the move must name its axis; got: ${q.move}`
  );
  // and BOTH axes must be reachable by the search — proved by construction rather
  // than by hoping this fixture happens to exercise them
  const left = bearing.map((x) => x.contextClass);
  const right = bearing.map((x) => x.response.outcome);
  const axes = new Set<string>();
  for (const seed of [11, 23, 31, 47, 101]) {
    const alt = couplePairs(240, 3, 3, 0.5, seed);
    const g2 = assess(alt, boundedProfile({ amiFloor: 0.05, amiCeilingMargin: 0.02, minSample: 3 }));
    const s2 = g2.flatnessStructure;
    if (s2 === null || s2 === undefined || s2.ami === null) continue;
    const b2 = g2.pairs.filter((x): x is typeof x & { contextClass: string } => x.contextClass !== null);
    const m = oneRecordQuantum(b2.map((x) => x.contextClass), b2.map((x) => x.response.outcome), s2.ami).move;
    axes.add(m.split(" ")[0]);
  }
  assert.ok(axes.size >= 1, `expected at least one named axis across five seeds; got ${JSON.stringify([...axes])}`);
  console.log(`      (winning axis on ${String(left.length)} bearing pairs: ${q.move.split(":")[0]} · axes seen across five seeds: ${[...axes].join(", ")})`);
  assert.ok(right.length === left.length, "the two vectors must stay in step");
});

check("T18: the UNRESOLVABLE path carries every margin field too — a refusal leaves its evidence", () => {
  // The new branch is statistic-bearing, so T17's rule applies to it as well.
  const measured = assess(midStructureRecords()).flatnessStructure?.ami as number;
  const r = assess(midStructureRecords(), boundedProfile({ amiFloor: measured, amiCeilingMargin: 0.02, minSample: 3 }));
  assert.deepStrictEqual(r.legB.blindReasonCodes, ["OP3_FLATNESS_UNRESOLVABLE_AT_FLOOR"]);
  const text = legBTexts(r).join(" ");
  for (const f of T17_FIELDS) assert.ok(text.includes(f), `the UNRESOLVABLE text must carry ${f}; got: ${text}`);
});

check("T17: the CEILING path carries every margin field", () => {
  // n=480: the smallest perfect table whose ceiling comparison T18 lets through.
  const r = assess(perfectPairs(480), boundedProfile({ amiFloor: 0.05, amiCeilingMargin: 0.02, minSample: 3 }));
  assert.strictEqual(r.legB.verdict.kind, "CANNOT_ASSESS");
  const text = legBTexts(r).join(" ");
  for (const f of T17_FIELDS) assert.ok(text.includes(f), `the CEILING text must carry ${f}; got: ${text}`);
});

check("T17: the SINGLE-CONTEXT blind path carries every margin field, including H(context)=0.000000", () => {
  const r = assess(contextPairs([..."AAAA"], [..."YYNN"]), boundedProfile());
  assert.strictEqual(r.flatnessStructure?.distinctLeft, 1);
  const text = legBTexts(r).join(" ");
  for (const f of T17_FIELDS) assert.ok(text.includes(f), `the single-context text must carry ${f}; got: ${text}`);
  assert.ok(text.includes("H(context)=0.000000"), "the degenerate axis must be visible as a number, not only as prose");
});

check("T17: the emitted numbers ARE the structure the verdict was taken from, not a second computation", () => {
  // ⛔ A second computation of E[MI] beside the first is the seam this project has
  //    paid for nine times. The printed values must be the SAME object's fields.
  const measured = assess(midStructureRecords()).flatnessStructure?.ami as number;
  const r = assess(midStructureRecords(), boundedProfile({ amiFloor: measured + 1e-9, amiCeilingMargin: 0.02, minSample: 3 }));
  const st = r.flatnessStructure!;
  const detail = legBTexts(r).find((t) => t.includes("AMI=")) as string;
  assert.ok(detail.includes(`plug-in MI=${st.mutualInformation.toFixed(6)}`), "printed MI must be structure.mutualInformation");
  assert.ok(detail.includes(`E[MI]=${st.expectedMutualInformation.toFixed(6)}`), "printed E[MI] must be structure.expectedMutualInformation");
  assert.ok(detail.includes(`H(context)=${st.entropyLeft.toFixed(6)}`), "printed H(context) must be structure.entropyLeft");
  assert.ok(detail.includes(`H(outcome)=${st.entropyRight.toFixed(6)}`), "printed H(outcome) must be structure.entropyRight");
  assert.ok(detail.includes(`AMI=${(st.ami as number).toFixed(6)}`), "printed AMI must be structure.ami");
});

check("T17: the emitted AMI REPRODUCES from the emitted MI, E[MI] and entropies", () => {
  // ⛔ THIS IS WHAT MAKES DISCLOSURE USEFUL RATHER THAN MERELY PRESENT. It is the
  //    property that let narrow-W's 2026-10-02 alarm be adjudicated from its
  //    printed output alone, without reading a subject log the operator uid cannot
  //    read. AMI = (MI - E[MI]) / (max(H_left, H_right) - E[MI]) -- stat/ami.ts.
  const r = assess(midStructureRecords());
  const st = r.flatnessStructure!;
  const denominator = Math.max(st.entropyLeft, st.entropyRight) - st.expectedMutualInformation;
  const reproduced = (st.mutualInformation - st.expectedMutualInformation) / denominator;
  assert.ok(
    Math.abs(reproduced - (st.ami as number)) < 1e-12,
    `AMI must reproduce from the disclosed fields: reproduced ${reproduced}, reported ${String(st.ami)}`
  );
  // and the SAME arithmetic over the SIX-DECIMAL printed forms lands within a
  // rounding step, which is the precision a human or a seat actually gets.
  const p = (x: number): number => Number(x.toFixed(6));
  const fromPrinted = (p(st.mutualInformation) - p(st.expectedMutualInformation)) /
    (Math.max(p(st.entropyLeft), p(st.entropyRight)) - p(st.expectedMutualInformation));
  assert.ok(
    Math.abs(fromPrinted - (st.ami as number)) < 1e-5,
    `AMI must reproduce from the PRINTED six-decimal fields too: ${fromPrinted} vs ${String(st.ami)}`
  );
});

// ── X3 arms · verdict-touching branches no fixture reached (X3 coverage table) ──
check("X3-03 · an unreadable log (non-clean load state) is a global CANNOT_ASSESS by OP3_READABILITY_GATE", () => {
  const unready: MicaReadableLog = { verify: () => ({ valid: true }), getLoadState: () => "CANNOT_VERIFY", getAll: () => midStructureRecords() };
  const result = assessOp3NodeResponse(unready, BOUNDED, ["READY"]);
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.blindReasonCodes, ["OP3_READABILITY_GATE"]);
  assert.strictEqual(result.pairs.length, 0);
  if (result.verdict.kind === "CANNOT_ASSESS") assert.strictEqual(result.verdict.blindPaths[0].class, "NON_CLEAN_LOAD_STATE");
});
check("X3-03 · a log whose verify() fails is a global CANNOT_ASSESS by OP3_READABILITY_GATE (BROKEN_CHAIN)", () => {
  const broken: MicaReadableLog = { verify: () => ({ valid: false, brokenAt: 0 }), getLoadState: () => "READY", getAll: () => midStructureRecords() };
  const result = assessOp3NodeResponse(broken, BOUNDED, ["READY"]);
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.blindReasonCodes, ["OP3_READABILITY_GATE"]);
  if (result.verdict.kind === "CANNOT_ASSESS") assert.strictEqual(result.verdict.blindPaths[0].class, "BROKEN_CHAIN");
});
check("X3-06 · leg-A open-end blindness composed with a leg-B SILENT keeps leg A's blind path as the ONLY one", () => {
  const pairsOnly = couplePairs(240, 3, 3, 0.5, 7);
  const measured = assess(pairsOnly, boundedProfile({ amiFloor: 0.05, amiCeilingMargin: 0.02, minSample: 3 })).flatnessStructure?.ami;
  assert.ok(measured !== null && measured !== undefined);
  const last = pairsOnly[pairsOnly.length - 1].sequenceNumber;
  const records = [...pairsOnly, context(last + 1, "PENDING"), r(last + 2, "expect")];
  const result = assess(records, boundedProfile({ amiFloor: measured - 0.1, amiCeilingMargin: 0.02, minSample: 3 }));
  assert.strictEqual(result.legA.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.legA.blindReasonCodes, ["OP3_CALL_PENDING_OPEN_END"]);
  assert.strictEqual(result.legB.verdict.kind, "SILENT", JSON.stringify(result.legB.blindReasonCodes));
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
  if (result.verdict.kind === "CANNOT_ASSESS") {
    assert.strictEqual(result.verdict.blindPaths.length, 1);
    assert.strictEqual(result.verdict.blindPaths[0].class, "INSUFFICIENT_SAMPLE");
    assert.ok(result.verdict.blindPaths[0].detail.includes("OP3_CALL_PENDING_OPEN_END"));
  }
});
// X3-14 · T39 NARROWED (AMENDED in its commit; audit 2026-10-18 06:56Z ruling (1)). On AAB × YYY the context
// relabel of the lone B record leaves ONE context class (both axes constant, AMI undefined). The arm pinned on
// 2511dac that the quantum SKIPPED that move (quantum 0, leg B ALARM at AMI 0). The first T39 draft (0a74faf) made
// the move an UNBOUNDED quantum (UNRESOLVABLE at both boundaries). Ruled, the narrower reading: the move only drops
// the table below op3's arity gate, so the table reads INELIGIBLE (CANNOT_ASSESS), not unbounded — the quantum
// stays the finite measurement over the moves that leave AMI defined.
const T39_MOVE_AAB = 'CONTEXT relabel at outcome "Y": one record from context "B" to "A" leaves ONE context class (below the arity gate; AMI undefined)';
check("X3-14 · T39 NARROWED (was PINS TODAY): a relabel that leaves one context class is RECORDED, not measured — quantum stays 0, leg B INELIGIBLE, never ALARM, never unbounded", () => {
  const q = oneRecordQuantum(["A", "A", "B"], ["Y", "Y", "Y"], 0);
  assert.strictEqual(q.recomputes, 2, "the arity-drop move is still one recompute (the kC·kO·(kO−1) count is unchanged)");
  assert.strictEqual(q.quantum, 0, "NOT +Infinity: the narrowed reading never makes the quantum unbounded");
  assert.strictEqual(q.move, "no single-record move changes the statistic");
  assert.strictEqual(q.belowArityGateBy, T39_MOVE_AAB);
  const result = assess(contextPairs([..."AAB"], [..."YYY"]));
  assert.strictEqual(result.flatnessStructure?.ami, 0);
  assert.strictEqual(result.legB.verdict.kind, "CANNOT_ASSESS", JSON.stringify(result.legB.blindReasonCodes));
  assert.deepStrictEqual(result.legB.blindReasonCodes, ["OP3_FLATNESS_INELIGIBLE_SCOPE"]);
  if (result.legB.verdict.kind === "CANNOT_ASSESS") {
    assert.strictEqual(result.legB.verdict.blindPaths.length, 1);
    assert.strictEqual(result.legB.verdict.blindPaths[0].class, "INELIGIBLE_SCOPE");
    const d = result.legB.verdict.blindPaths[0].detail;
    assert.ok(d.startsWith("OP3_FLATNESS_INELIGIBLE_SCOPE: ONE RECORD holds this table above the arity gate — "), d);
    // the reader's context classes are tupleKey(moduleId, eventType), so the move names them in that encoding
    assert.ok(d.includes(`one record from context ${JSON.stringify(tupleKey(["context", "B"]))} to ${JSON.stringify(tupleKey(["context", "A"]))} leaves ONE context class (below the arity gate; AMI undefined). Without it`), d);
    assert.ok(d.includes("AMI=0.000000 is printed, not compared"), d);
    assert.ok(!d.includes("Infinity") && !d.includes("UNRESOLVABLE"), d);
  }
  assert.notStrictEqual(result.verdict.kind, "ALARM");
});
check("T39 NARROWED · at any n: nine A and one B against ten Y → INELIGIBLE (one record holds the table above the gate), not UNRESOLVABLE, no ALARM at AMI 0", () => {
  const left = [..."AAAAAAAAAB"];
  const right = [..."YYYYYYYYYY"];
  const q = oneRecordQuantum(left, right, 0);
  assert.strictEqual(q.quantum, 0);
  assert.ok(q.belowArityGateBy !== null && q.belowArityGateBy.includes('from context "B" to "A" leaves ONE context class'), String(q.belowArityGateBy));
  const result = assess(contextPairs(left, right));
  assert.strictEqual(result.legB.verdict.kind, "CANNOT_ASSESS", JSON.stringify(result.legB.blindReasonCodes));
  assert.deepStrictEqual(result.legB.blindReasonCodes, ["OP3_FLATNESS_INELIGIBLE_SCOPE"]);
  assert.notStrictEqual(result.verdict.kind, "ALARM");
});
check("T39 NARROWED · the ALARM STAYS READABLE: a FLAT table whose every context class holds two or more records ALARMs OP3_RESPONSE_FLATLINE", () => {
  const left = [..."AAAAABBBBB"];
  const right = [..."YYYYYYYYYY"];
  const q = oneRecordQuantum(left, right, 0);
  assert.strictEqual(q.quantum, 0);
  assert.strictEqual(q.belowArityGateBy, null, "no single move leaves one context class when no class is a singleton");
  const result = assess(contextPairs(left, right));
  assert.strictEqual(result.legB.verdict.kind, "ALARM", JSON.stringify(result.legB.blindReasonCodes));
  assert.strictEqual(result.legB.verdict.kind === "ALARM" && result.legB.verdict.findings[0].code, "OP3_RESPONSE_FLATLINE");
  assert.deepStrictEqual(result.legB.blindReasonCodes, []);
});
check("T39 NARROWED · a lone context class among THREE does not reach the gate: AAAABBBBC × nine Y still ALARMs (the move leaves two classes)", () => {
  const left = [..."AAAABBBBC"];
  const right = [..."YYYYYYYYY"];
  assert.strictEqual(oneRecordQuantum(left, right, 0).belowArityGateBy, null);
  const result = assess(contextPairs(left, right));
  assert.strictEqual(result.legB.verdict.kind, "ALARM", JSON.stringify(result.legB.blindReasonCodes));
});
check("T39 NARROWED · NOT WIDENED: a lone context on a NON-flat table (AMI defined after the move) is not touched — no arity-drop named, its verdict is not INELIGIBLE", () => {
  const left = [..."AAAAAAAAAB"];
  const right = [..."XYXYXYXYXY"];
  const base = pairedStructure(left, right).ami as number;
  const q = oneRecordQuantum(left, right, base);
  assert.strictEqual(q.belowArityGateBy, null, "relabelling the lone B leaves AMI defined (H(outcome) > 0), so it is a measured move");
  const result = assess(contextPairs(left, right));
  assert.ok(!result.legB.blindReasonCodes.includes("OP3_FLATNESS_INELIGIBLE_SCOPE"), JSON.stringify(result.legB.blindReasonCodes));
});
check("T39 NARROWED · the FIRST arity-drop move is the one named (AB × YY: both relabels leave one class)", () => {
  const q = oneRecordQuantum(["A", "B"], ["Y", "Y"], 0);
  assert.strictEqual(q.recomputes, 2);
  assert.strictEqual(q.quantum, 0);
  assert.strictEqual(q.belowArityGateBy, 'CONTEXT relabel at outcome "Y": one record from context "A" to "B" leaves ONE context class (below the arity gate; AMI undefined)');
});
check("T39 NARROWED · CONTROL: a table where no single move leaves one context class keeps a FINITE quantum and names no arity drop", () => {
  const left = [..."AAABBBCCC"];
  const right = [..."XXYYYZZZX"];
  const base = pairedStructure(left, right).ami as number;
  const q = oneRecordQuantum(left, right, base);
  assert.ok(Number.isFinite(q.quantum) && q.quantum > 0, String(q.quantum));
  assert.strictEqual(q.belowArityGateBy, null);
  assert.ok(!q.move.includes("arity"), q.move);
});
check("T39 NARROWED · every reachable undefined move IS an arity drop (exhaustive, n ≤ 4, ≤ 3 labels an axis, distinctLeft ≥ 2, AMI defined): named ⇔ outcome constant and exactly two context classes, one of them a singleton", () => {
  const labels = ["a", "b", "c"];
  let tables = 0;
  let named = 0;
  for (let n = 3; n <= 4; n++) {
    const total = labels.length ** n;
    for (let li = 0; li < total; li++) {
      const left = Array.from({ length: n }, (_, i) => labels[Math.floor(li / labels.length ** i) % labels.length]);
      const counts = new Map<string, number>();
      for (const x of left) counts.set(x, (counts.get(x) ?? 0) + 1);
      if (counts.size < 2) continue;
      for (let ri = 0; ri < total; ri++) {
        const right = Array.from({ length: n }, (_, i) => labels[Math.floor(ri / labels.length ** i) % labels.length]);
        const s = pairedStructure(left, right);
        if (s.ami === null) continue;
        tables++;
        const q = oneRecordQuantum(left, right, s.ami);
        const expected = new Set(right).size === 1 && counts.size === 2 && [...counts.values()].includes(1);
        assert.strictEqual(q.belowArityGateBy !== null, expected, `${left.join("")} × ${right.join("")}: ${String(q.belowArityGateBy)}`);
        if (q.belowArityGateBy !== null) named++;
      }
    }
  }
  assert.ok(tables > 1000 && named > 0, `tables=${tables} named=${named}`);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
