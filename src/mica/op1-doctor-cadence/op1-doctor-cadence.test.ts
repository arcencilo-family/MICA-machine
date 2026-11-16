import assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";
import type { MicaLogRecord, MicaReadableLog } from "../log";
import type { OperatorLayerProfile } from "../operator-layer-profile";
import { Chokepoint } from "../chokepoint";
import type { SensorVerdict } from "../types";
import {
  assessOp1DoctorCadence,
  OP1_BOUND_MODE_CEILING,
  OP1_DOCTOR_CADENCE_CEILING_LINES,
  OP1_DOCTOR_CADENCE_SENSOR_ID,
  OP1_PRESENCE_MODE_CEILING,
  op1DoctorCadenceScopeBlockText,
} from "./index";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}`); console.error(`    ${(error as Error).message}`); failed++; }
}

const DOC = { moduleId: "doctor", eventType: "ATTEST" } as const;
const BOUND: OperatorLayerProfile = { doctorCadence: { attestationClass: DOC, cadenceBoundSteps: 3 } };
const PRESENCE: OperatorLayerProfile = { doctorCadence: { attestationClass: DOC } };

function r(sequenceNumber: number, kind: "doc" | "other" = "other", timestamp = sequenceNumber): MicaLogRecord {
  return {
    sequenceNumber,
    timestamp,
    moduleId: kind === "doc" ? DOC.moduleId : "system",
    eventType: kind === "doc" ? DOC.eventType : "WORK",
    outcome: "ok",
  };
}

function log(records: readonly MicaLogRecord[], state = "READY"): MicaReadableLog {
  return { verify: () => ({ valid: true }), getLoadState: () => state, getAll: () => records };
}

function assess(records: readonly MicaLogRecord[], profile = BOUND) {
  return assessOp1DoctorCadence(log(records), profile, ["READY"]);
}

function assertCeilings(verdict: SensorVerdict): void {
  for (const line of OP1_DOCTOR_CADENCE_CEILING_LINES) assert.ok(verdict.summary.includes(line));
  assert.ok(verdict.summary.includes("SITE THIRTEEN FLAGGED"));
}

console.log("\n── MICA OP-1 doctor cadence ──────────────────────────────────");

check("absent section is typed blindness and other sections do not repair it", () => {
  const result = assessOp1DoctorCadence(log([r(0)]), { auditObligation: { auditClass: { moduleId: "a", eventType: "b" } } }, ["READY"]);
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.blindReasonCodes, ["OP1_PROFILE_ABSENT"]);
  assertCeilings(result.verdict);
});

check("vacuous and malformed doctor sections fail closed independently", () => {
  const vacuous = assess([r(0)], { doctorCadence: { attestationClass: { moduleId: "", eventType: "ATTEST" } } });
  assert.deepStrictEqual(vacuous.blindReasonCodes, ["OP1_PROFILE_VACUOUS"]);
  const malformed = assess([r(0)], { doctorCadence: { attestationClass: DOC, cadenceBoundSteps: 0 } });
  assert.deepStrictEqual(malformed.blindReasonCodes, ["OP1_PROFILE_MALFORMED"]);
});

check("empty readable range is insufficient evidence, never silence", () => {
  const result = assess([]);
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.blindReasonCodes, ["OP1_INSUFFICIENT_EVIDENCE"]);
});

check("presence-only mode alarms when the unconditional attestation class is absent", () => {
  const result = assess([r(0), r(10)], PRESENCE);
  assert.strictEqual(result.verdict.kind, "ALARM");
  assert.strictEqual(result.verdict.kind === "ALARM" && result.verdict.findings[0].code, "OP1_ATTESTATION_GAP");
  assert.ok(result.verdict.summary.includes(OP1_PRESENCE_MODE_CEILING));
});

check("presence-only mode accepts one attestation of any sequence age and prints the louder ceiling", () => {
  const result = assess([r(0, "doc"), r(1000)], PRESENCE);
  assert.strictEqual(result.verdict.kind, "SILENT");
  assert.ok(result.verdict.summary.includes(OP1_PRESENCE_MODE_CEILING));
});

check("inclusive cadence boundary K conforms", () => {
  const result = assess([r(0, "doc"), r(3, "doc")]);
  assert.strictEqual(result.verdict.kind, "SILENT");
  assert.ok(result.verdict.summary.includes(OP1_BOUND_MODE_CEILING));
});

check("cadence boundary K+1 breaches", () => {
  const result = assess([r(0, "doc"), r(4, "doc")]);
  assert.strictEqual(result.verdict.kind, "ALARM");
  assert.ok(result.verdict.kind === "ALARM" && result.verdict.findings[0].detail.includes("4 sequence-step"));
});

check("head and tail gaps are both included in the bounded read", () => {
  const head = assess([r(0), r(4, "doc")]);
  const tail = assess([r(0, "doc"), r(4)]);
  assert.strictEqual(head.verdict.kind, "ALARM");
  assert.strictEqual(tail.verdict.kind, "ALARM");
});

check("zero attestations across a range longer than K is the maximal-gap alarm", () => {
  const result = assess([r(0), r(4)]);
  assert.strictEqual(result.verdict.kind, "ALARM");
  assert.strictEqual(result.attestationCount, 0);
});

check("adversarial timestamps leave the OP-1 verdict byte-identical", () => {
  const ordinary = assess([r(0, "doc", 1), r(3, "doc", 2)]).verdict;
  const hostile = assess([r(0, "doc", Number.NaN), r(3, "doc", Number.POSITIVE_INFINITY)]).verdict;
  assert.deepStrictEqual(hostile, ordinary);
});

check("source never reads timestamp", () => {
  const source = readFileSync(join(__dirname, "index.ts"), "utf8");
  assert.ok(!/\.timestamp\b|\[\s*["']timestamp["']\s*\]/.test(source));
});

check("scope names site thirteen, the three-object distinction, status, and all ceilings", () => {
  const scope = op1DoctorCadenceScopeBlockText(BOUND, ["READY"]);
  assert.ok(scope.includes("SITE THIRTEEN FLAGGED"));
  assert.ok(scope.includes("doctorCadence section status: DECLARED"));
  assert.ok(scope.includes("Clerk-1 delivery gap"));
  for (const line of OP1_DOCTOR_CADENCE_CEILING_LINES) assert.ok(scope.includes(line));
});

check("one OP-1 ALARM floors SILENT siblings through guard() to HOLD", () => {
  const alarmVerdict = assess([r(0), r(4)]).verdict;
  const sibling: SensorVerdict = { kind: "SILENT", sensorId: "MICA/test-sibling", summary: "SILENT is an absence of finding, not health." };
  const result = new Chokepoint().guard({ id: "op1-floor" }, [sibling, alarmVerdict, sibling], { impactClass: "trivial" });
  assert.strictEqual(result.disposition, "HOLD");
});

// ── X3 arms · verdict-touching branches no fixture reached (X3 coverage table) ──
check("X3-03 · an unreadable log (non-clean load state) is CANNOT_ASSESS by OP1_READABILITY_GATE, records unread", () => {
  const result = assessOp1DoctorCadence(log([r(0)], "CANNOT_VERIFY"), BOUND, ["READY"]);
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.blindReasonCodes, ["OP1_READABILITY_GATE"]);
  assert.strictEqual(result.recordsExamined, 0);
  if (result.verdict.kind === "CANNOT_ASSESS") assert.strictEqual(result.verdict.blindPaths[0].class, "NON_CLEAN_LOAD_STATE");
  assertCeilings(result.verdict);
});
check("X3-03 · a log whose verify() fails is CANNOT_ASSESS by OP1_READABILITY_GATE (BROKEN_CHAIN)", () => {
  const broken: MicaReadableLog = { verify: () => ({ valid: false, brokenAt: 0 }), getLoadState: () => "READY", getAll: () => [r(0)] };
  const result = assessOp1DoctorCadence(broken, BOUND, ["READY"]);
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.blindReasonCodes, ["OP1_READABILITY_GATE"]);
  if (result.verdict.kind === "CANNOT_ASSESS") assert.strictEqual(result.verdict.blindPaths[0].class, "BROKEN_CHAIN");
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
