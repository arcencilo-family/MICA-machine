// ── OPERATOR CEILING REGISTRY ────────────────────────────────────────────────
// PRESENCE, NEVER CORRECTNESS.

import assert from "assert";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import type { MicaLogRecord, MicaReadableLog } from "./log";
import type { OperatorLayerProfile } from "./operator-layer-profile";
import {
  assessOp1DoctorCadence,
  OP1_DOCTOR_CADENCE_CEILING_LINES,
  op1DoctorCadenceScopeBlockText,
} from "./op1-doctor-cadence";
import {
  assessOp2AuditPresence,
  OP2_AUDIT_PRESENCE_CEILING_LINES,
  op2AuditPresenceScopeBlockText,
} from "./op2-audit-presence";
import {
  assessOp3NodeResponse,
  OP3_NODE_RESPONSE_CEILING_LINES,
  op3NodeResponseScopeBlockText,
} from "./op3-node-response";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}`); console.error(`    ${(error as Error).message}`); failed++; }
}

const OP_SURFACE_REGISTRY = [
  { sensorId: "MICA/op1-doctor-cadence", testPath: "src/mica/op1-doctor-cadence/op1-doctor-cadence.test.ts", surfaces: ["SILENT", "ALARM", "CANNOT_ASSESS", "SCOPE"] },
  { sensorId: "MICA/op2-audit-presence", testPath: "src/mica/op2-audit-presence/op2-audit-presence.test.ts", surfaces: ["SILENT", "ALARM", "CANNOT_ASSESS", "SCOPE"] },
  { sensorId: "MICA/op3-node-response", testPath: "src/mica/op3-node-response/op3-node-response.test.ts", surfaces: ["SILENT", "ALARM", "CANNOT_ASSESS", "COMPOSITE"] },
] as const;

const MICA_DIR = __dirname;
function discoveredOperatorSensors(): Array<{ sensorId: string; testPath: string }> {
  const out: Array<{ sensorId: string; testPath: string }> = [];
  for (const name of readdirSync(MICA_DIR)) {
    const dir = join(MICA_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    const files = readdirSync(dir);
    if (!files.includes("index.ts")) continue;
    const source = readFileSync(join(dir, "index.ts"), "utf8");
    const id = source.match(/SENSOR_ID\s*=\s*["'](MICA\/op[^"']+)["']/)?.[1];
    if (id === undefined) continue;
    const tests = files.filter((file) => file.endsWith(".test.ts"));
    for (const test of tests) out.push({ sensorId: id, testPath: `src/mica/${name}/${test}` });
  }
  return out.sort((a, b) => a.sensorId.localeCompare(b.sensorId));
}

function r(sequenceNumber: number, moduleId: string, eventType: string, outcome = "ok"): MicaLogRecord {
  return { sequenceNumber, timestamp: sequenceNumber, moduleId, eventType, outcome };
}

function log(records: readonly MicaLogRecord[]): MicaReadableLog {
  return { verify: () => ({ valid: true }), getLoadState: () => "READY", getAll: () => records };
}

function assertAggregate(text: string, lines: readonly string[]): void {
  for (const line of lines) assert.ok(text.includes(line), `missing ceiling: ${line}`);
}

/**
 * ⛔ T19 · SAMPLES LARGE ENOUGH TO RESOLVE WHAT THEY ASSERT. The eight-pair
 *    builder below cannot support a floor comparison: one record moves AMI by
 *    ~0.40 at n=8 and ~0.04 at n=24, so T18's gate refuses both. Measured at
 *    floor 0.05 on this file's own two-context/two-outcome shape:
 *      n=8   AMI 0.083463  quantum 0.403674  distance 0.033463  -> unresolvable
 *      n=24  AMI 0.014243  quantum 0.039590  distance 0.035757  -> unresolvable
 *      n=60  AMI 0.269058  quantum 0.035590  distance 0.219058  -> RESOLVABLE
 *      n=240 AMI 0.492955  quantum 0.013586  distance 0.442955  -> RESOLVABLE
 *    The check that asserted SILENT on eight pairs was asserting a verdict its
 *    sample could not support — the arbiter's words: "a test proves a verdict
 *    supportable and not merely a branch reachable."
 */
function op3CoupledRecords(pairs: number, couple: number, seed: number): MicaLogRecord[] {
  let x = seed >>> 0;
  const rnd = (): number => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
  const records: MicaLogRecord[] = [];
  for (let i = 0; i < pairs; i++) {
    const c = i % 2;
    const base = i * 3;
    records.push(
      r(base, "context", c === 0 ? "A" : "B"),
      r(base + 1, "node", "EXPECT", "asked"),
      r(base + 2, "node", "RESPOND", rnd() < couple ? (c === 0 ? "Y" : "N") : (rnd() < 0.5 ? "Y" : "N"))
    );
  }
  return records;
}

/** A perfect table over `contexts` classes: outcome determined by context, AMI = 1. */
function op3PerfectRecords(pairs: number, contexts: number): MicaLogRecord[] {
  const records: MicaLogRecord[] = [];
  for (let i = 0; i < pairs; i++) {
    const c = i % contexts;
    const base = i * 3;
    records.push(
      r(base, "context", String.fromCharCode(65 + c)),
      r(base + 1, "node", "EXPECT", "asked"),
      r(base + 2, "node", "RESPOND", String.fromCharCode(88 + c))
    );
  }
  return records;
}

function op3ContextRecords(outcomes: readonly string[]): MicaLogRecord[] {
  const contexts = [..."AAAABBBB"];
  const records: MicaLogRecord[] = [];
  for (let i = 0; i < contexts.length; i++) {
    const base = i * 3;
    records.push(
      r(base, "context", contexts[i]),
      r(base + 1, "node", "EXPECT", "asked"),
      r(base + 2, "node", "RESPOND", outcomes[i])
    );
  }
  return records;
}

console.log("\n── MICA operator ceilings — PRESENCE, NEVER CORRECTNESS ──────");

check("discovery equals the loud in-file operator registry", () => {
  const discovered = discoveredOperatorSensors();
  const registered = OP_SURFACE_REGISTRY.map(({ sensorId, testPath }) => ({ sensorId, testPath }))
    .sort((a, b) => a.sensorId.localeCompare(b.sensorId));
  assert.deepStrictEqual(discovered, registered,
    "operator reader discovery changed; a fourth instrument must be added to the four-surface registry deliberately");
});

check("every operator registry row names exactly four surfaces", () => {
  for (const row of OP_SURFACE_REGISTRY) assert.strictEqual(row.surfaces.length, 4);
});

check("every local operator ceiling aggregate clears the non-vacuity floor", () => {
  assert.ok(OP1_DOCTOR_CADENCE_CEILING_LINES.length >= 4);
  assert.ok(OP2_AUDIT_PRESENCE_CEILING_LINES.length >= 4);
  assert.ok(OP3_NODE_RESPONSE_CEILING_LINES.length >= 4);
  for (const line of [...OP1_DOCTOR_CADENCE_CEILING_LINES, ...OP2_AUDIT_PRESENCE_CEILING_LINES, ...OP3_NODE_RESPONSE_CEILING_LINES]) {
    assert.ok(line.trim().length >= 40, "ceiling line is vacuous padding");
  }
});

check("OP-1 aggregate is present on SILENT, ALARM, blind, and scope surfaces", () => {
  const profile: OperatorLayerProfile = { doctorCadence: { attestationClass: { moduleId: "doctor", eventType: "ATT" } } };
  const silent = assessOp1DoctorCadence(log([r(0, "doctor", "ATT")]), profile, ["READY"]).verdict;
  const alarm = assessOp1DoctorCadence(log([r(0, "system", "WORK")]), profile, ["READY"]).verdict;
  const blind = assessOp1DoctorCadence(log([]), profile, ["READY"]).verdict;
  for (const surface of [silent.summary, alarm.summary, blind.summary, op1DoctorCadenceScopeBlockText(profile, ["READY"])]) {
    assertAggregate(surface, OP1_DOCTOR_CADENCE_CEILING_LINES);
  }
});

check("OP-2 aggregate is present on SILENT, ALARM, blind, and scope surfaces", () => {
  const profile: OperatorLayerProfile = { auditObligation: { auditClass: { moduleId: "arbiter", eventType: "AUDIT" } } };
  const silent = assessOp2AuditPresence(log([r(0, "arbiter", "AUDIT")]), profile, ["READY"]).verdict;
  const alarm = assessOp2AuditPresence(log([r(0, "system", "WORK")]), profile, ["READY"]).verdict;
  const blind = assessOp2AuditPresence(log([]), profile, ["READY"]).verdict;
  for (const surface of [silent.summary, alarm.summary, blind.summary, op2AuditPresenceScopeBlockText(profile, ["READY"])]) {
    assertAggregate(surface, OP2_AUDIT_PRESENCE_CEILING_LINES);
  }
});

check("OP-3 aggregate reaches now-constructible SILENT, ALARM, blind, composite, and scope surfaces", () => {
  const profile: OperatorLayerProfile = { nodeResponse: {
    expectationClass: { moduleId: "node", eventType: "EXPECT" },
    responseClass: { moduleId: "node", eventType: "RESPOND" },
    responseBoundSteps: 2,
    flatness: { amiFloor: 0.05, amiCeilingMargin: 0.02, minSample: 3 },
  } };
  // ⛔ SILENT NEEDS A SAMPLE THAT CAN SUPPORT IT (T19). 60 pairs at 0.75 coupling:
  //    AMI 0.269058, quantum 0.035590, distance to the 0.05 floor 0.219058.
  const silent = assessOp3NodeResponse(log(op3CoupledRecords(60, 0.75, 31)), profile, ["READY"]);

  // ⚠ ALARM NEEDS NO RESIZING, AND THE REASON IS WORTH ASSERTING RATHER THAN
  //   ASSUMING: a one-outcome-class table has NO single-record move inside T18's
  //   definition (the move space is other outcome labels within the same context
  //   row, and there are none), so its quantum is EXACTLY 0 and the comparison is
  //   always resolvable. A flat record can therefore never be masked by the gate,
  //   which is the one place where "nothing to move" is the right answer.
  //   ⚠ AMENDED (T39 NARROWED, audit 2026-10-18 06:56Z ruling (1)): still true of T18's gate (the quantum of a
  //   flat table stays 0). But a flat table with exactly TWO context classes, one of them a singleton, is one
  //   record above op3's arity gate (relabel the singleton: one context class, AMI undefined), and reads
  //   INELIGIBLE (OP3_FLATNESS_INELIGIBLE_SCOPE), not ALARM. Here (AAAABBBB) every context class holds two or more
  //   records, so the flat-signature ALARM stays readable (op3 test "T39 NARROWED · the ALARM STAYS READABLE").
  const alarm = assessOp3NodeResponse(log(op3ContextRecords([..."YYYYYYYY"])), profile, ["READY"]);

  // ⛔ AND THE BLIND SAMPLE'S CAUSE IS NAMED, because T18 gave it a second way to
  //    read CANNOT_ASSESS. Eight perfect pairs are UNRESOLVABLE at the ceiling
  //    (quantum 0.40 against a 0.02 margin); a three-context perfect table at 326
  //    pairs reaches the ceiling comparison itself (quantum 0.015994 < 0.02). Both
  //    are asserted, each by its own code, so a cause cannot be silently replaced.
  const blindByGate = assessOp3NodeResponse(log(op3ContextRecords([..."YYYYNNNN"])), profile, ["READY"]);
  const blindByCeiling = assessOp3NodeResponse(log(op3PerfectRecords(326, 3)), profile, ["READY"]);

  assert.strictEqual(silent.verdict.kind, "SILENT", JSON.stringify(silent.blindReasonCodes));
  assert.strictEqual(alarm.verdict.kind, "ALARM", JSON.stringify(alarm.blindReasonCodes));
  assert.deepStrictEqual(alarm.legB.blindReasonCodes, [], "a flat table has quantum 0 and must not be gated");
  assert.strictEqual(blindByGate.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(blindByGate.legB.blindReasonCodes, ["OP3_FLATNESS_UNRESOLVABLE_AT_CEILING"]);
  assert.strictEqual(blindByCeiling.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(blindByCeiling.legB.blindReasonCodes, ["OP3_FLATNESS_INELIGIBLE_SCOPE"]);
  const blind = blindByGate;
  for (const surface of [
    silent.verdict.summary,
    alarm.verdict.summary,
    blind.verdict.summary,
    silent.legA.verdict.summary,
    silent.legB.verdict.summary,
    op3NodeResponseScopeBlockText(profile, ["READY"]),
  ]) {
    assertAggregate(surface, OP3_NODE_RESPONSE_CEILING_LINES);
  }
});

check("one shared profile preserves all three per-section vacuity boundaries", () => {
  const doctorOnly: OperatorLayerProfile = { doctorCadence: { attestationClass: { moduleId: "doctor", eventType: "ATT" } } };
  const doctorLog = log([r(0, "doctor", "ATT")]);
  assert.strictEqual(assessOp1DoctorCadence(doctorLog, doctorOnly, ["READY"]).verdict.kind, "SILENT");
  assert.deepStrictEqual(assessOp2AuditPresence(doctorLog, doctorOnly, ["READY"]).blindReasonCodes, ["OP2_PROFILE_ABSENT"]);
  assert.deepStrictEqual(assessOp3NodeResponse(doctorLog, doctorOnly, ["READY"]).blindReasonCodes, ["OP3_PROFILE_ABSENT"]);

  const auditOnly: OperatorLayerProfile = { auditObligation: { auditClass: { moduleId: "arbiter", eventType: "AUDIT" } } };
  const auditLog = log([r(0, "arbiter", "AUDIT")]);
  assert.deepStrictEqual(assessOp1DoctorCadence(auditLog, auditOnly, ["READY"]).blindReasonCodes, ["OP1_PROFILE_ABSENT"]);
  assert.strictEqual(assessOp2AuditPresence(auditLog, auditOnly, ["READY"]).verdict.kind, "SILENT");
  assert.deepStrictEqual(assessOp3NodeResponse(auditLog, auditOnly, ["READY"]).blindReasonCodes, ["OP3_PROFILE_ABSENT"]);

  const nodeOnly: OperatorLayerProfile = { nodeResponse: {
    expectationClass: { moduleId: "node", eventType: "EXPECT" },
    responseClass: { moduleId: "node", eventType: "RESPOND" },
  } };
  const nodeLog = log([r(0, "node", "EXPECT"), r(1, "node", "RESPOND")]);
  assert.deepStrictEqual(assessOp1DoctorCadence(nodeLog, nodeOnly, ["READY"]).blindReasonCodes, ["OP1_PROFILE_ABSENT"]);
  assert.deepStrictEqual(assessOp2AuditPresence(nodeLog, nodeOnly, ["READY"]).blindReasonCodes, ["OP2_PROFILE_ABSENT"]);
  assert.strictEqual(assessOp3NodeResponse(nodeLog, nodeOnly, ["READY"]).legA.verdict.kind, "SILENT");
});

check("the meta-test states its own limit verbatim", () => {
  const source = readFileSync(__filename, "utf8");
  assert.ok(source.includes("PRESENCE, NEVER CORRECTNESS."));
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
