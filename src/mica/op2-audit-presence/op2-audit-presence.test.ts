import assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";
import type { MicaLogRecord, MicaReadableLog } from "../log";
import type { OperatorLayerProfile } from "../operator-layer-profile";
import {
  assessOp2AuditPresence,
  OP2_AUDIT_PRESENCE_CEILING_LINES,
  OP2_PRESENCE_MODE_CEILING,
  OP2_RATE_MODE_CEILING,
  op2AuditPresenceScopeBlockText,
} from "./index";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}`); console.error(`    ${(error as Error).message}`); failed++; }
}

const AUDIT = { moduleId: "arbiter", eventType: "AUDIT" } as const;
const RATE: OperatorLayerProfile = { auditObligation: { auditClass: AUDIT, windowSteps: 5, minAuditsPerWindow: 2 } };
const PRESENCE: OperatorLayerProfile = { auditObligation: { auditClass: AUDIT } };

function r(sequenceNumber: number, kind: "audit" | "other" = "other", timestamp = sequenceNumber): MicaLogRecord {
  return {
    sequenceNumber,
    timestamp,
    moduleId: kind === "audit" ? AUDIT.moduleId : "system",
    eventType: kind === "audit" ? AUDIT.eventType : "WORK",
    outcome: "ok",
  };
}

function log(records: readonly MicaLogRecord[]): MicaReadableLog {
  return { verify: () => ({ valid: true }), getLoadState: () => "READY", getAll: () => records };
}

function assess(records: readonly MicaLogRecord[], profile = RATE) {
  return assessOp2AuditPresence(log(records), profile, ["READY"]);
}

console.log("\n── MICA OP-2 audit presence ──────────────────────────────────");

check("absent section remains blind when a sibling section is declared", () => {
  const result = assessOp2AuditPresence(log([r(0)]), { doctorCadence: { attestationClass: { moduleId: "d", eventType: "a" } } }, ["READY"]);
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.blindReasonCodes, ["OP2_PROFILE_ABSENT"]);
});

check("vacuous audit class is distinguished from absent", () => {
  const result = assess([r(0)], { auditObligation: { auditClass: { moduleId: "arbiter", eventType: " " } } });
  assert.deepStrictEqual(result.blindReasonCodes, ["OP2_PROFILE_VACUOUS"]);
});

check("every injected scalar is range-validated at birth", () => {
  for (const section of [
    { auditClass: AUDIT, windowSteps: 0, minAuditsPerWindow: 1 },
    { auditClass: AUDIT, windowSteps: 5, minAuditsPerWindow: 1.5 },
  ]) {
    const result = assess([r(0)], { auditObligation: section });
    assert.deepStrictEqual(result.blindReasonCodes, ["OP2_PROFILE_MALFORMED"]);
  }
});

check("empty readable range is insufficient evidence", () => {
  const result = assess([]);
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.blindReasonCodes, ["OP2_INSUFFICIENT_EVIDENCE"]);
});

check("presence-only mode alarms at zero audits", () => {
  const result = assess([r(0), r(10)], PRESENCE);
  assert.strictEqual(result.verdict.kind, "ALARM");
  assert.ok(result.verdict.summary.includes(OP2_PRESENCE_MODE_CEILING));
});

check("either missing rate scalar selects presence-only mode", () => {
  const onlyWindow: OperatorLayerProfile = { auditObligation: { auditClass: AUDIT, windowSteps: 5 } };
  const onlyMinimum: OperatorLayerProfile = { auditObligation: { auditClass: AUDIT, minAuditsPerWindow: 2 } };
  assert.strictEqual(assess([r(0, "audit")], onlyWindow).verdict.kind, "SILENT");
  assert.strictEqual(assess([r(0, "audit")], onlyMinimum).verdict.kind, "SILENT");
});

check("presence-only mode accepts one audit and prints the louder ceiling", () => {
  const result = assess([r(0, "audit"), r(1000)], PRESENCE);
  assert.strictEqual(result.verdict.kind, "SILENT");
  assert.ok(result.verdict.summary.includes(OP2_PRESENCE_MODE_CEILING));
});

check("rate boundary count=M conforms", () => {
  const result = assess([r(5, "audit"), r(9, "audit"), r(10)]);
  assert.strictEqual(result.verdict.kind, "SILENT");
  assert.strictEqual(result.auditsInScope, 2);
  assert.ok(result.verdict.summary.includes(OP2_RATE_MODE_CEILING));
});

check("rate boundary count=M−1 breaches", () => {
  const result = assess([r(4), r(5, "audit"), r(10)]);
  assert.strictEqual(result.verdict.kind, "ALARM");
  assert.strictEqual(result.auditsInScope, 1);
  assert.strictEqual(result.verdict.kind === "ALARM" && result.verdict.findings[0].code, "OP2_AUDIT_OBLIGATION_BREACH");
});

check("trailing window includes the exact end−W endpoint and excludes one step earlier", () => {
  const endpoint = assess([r(5, "audit"), r(9, "audit"), r(10)]);
  assert.strictEqual(endpoint.verdict.kind, "SILENT");
  const outside = assess([r(4, "audit"), r(9, "audit"), r(10)]);
  assert.strictEqual(outside.verdict.kind, "ALARM");
});

check("adversarial timestamps leave the OP-2 verdict byte-identical", () => {
  const ordinary = assess([r(5, "audit", 1), r(9, "audit", 2), r(10, "other", 3)]).verdict;
  const hostile = assess([r(5, "audit", Number.NaN), r(9, "audit", Number.NEGATIVE_INFINITY), r(10, "other", Number.POSITIVE_INFINITY)]).verdict;
  assert.deepStrictEqual(hostile, ordinary);
});

check("source never reads timestamp", () => {
  const source = readFileSync(join(__dirname, "index.ts"), "utf8");
  assert.ok(!/\.timestamp\b|\[\s*["']timestamp["']\s*\]/.test(source));
});

check("every verdict surface and scope carry all local ceilings and site thirteen", () => {
  const verdicts = [
    assess([r(0, "audit")], PRESENCE).verdict,
    assess([r(0)], PRESENCE).verdict,
    assess([], RATE).verdict,
  ];
  for (const verdict of verdicts) {
    for (const line of OP2_AUDIT_PRESENCE_CEILING_LINES) assert.ok(verdict.summary.includes(line));
    assert.ok(verdict.summary.includes("SITE THIRTEEN FLAGGED"));
  }
  const scope = op2AuditPresenceScopeBlockText(RATE, ["READY"]);
  assert.ok(scope.includes("auditObligation section status: DECLARED"));
  for (const line of OP2_AUDIT_PRESENCE_CEILING_LINES) assert.ok(scope.includes(line));
});

// ── X3 arms · verdict-touching branches no fixture reached (X3 coverage table) ──
check("X3-03 · an unreadable log (non-clean load state) is CANNOT_ASSESS by OP2_READABILITY_GATE, records unread", () => {
  const unready: MicaReadableLog = { verify: () => ({ valid: true }), getLoadState: () => "CANNOT_VERIFY", getAll: () => [r(0)] };
  const result = assessOp2AuditPresence(unready, RATE, ["READY"]);
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.blindReasonCodes, ["OP2_READABILITY_GATE"]);
  assert.strictEqual(result.recordsExamined, 0);
  if (result.verdict.kind === "CANNOT_ASSESS") assert.strictEqual(result.verdict.blindPaths[0].class, "NON_CLEAN_LOAD_STATE");
});
check("X3-03 · a log whose verify() fails is CANNOT_ASSESS by OP2_READABILITY_GATE (BROKEN_CHAIN)", () => {
  const broken: MicaReadableLog = { verify: () => ({ valid: false, brokenAt: 0 }), getLoadState: () => "READY", getAll: () => [r(0)] };
  const result = assessOp2AuditPresence(broken, RATE, ["READY"]);
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.blindReasonCodes, ["OP2_READABILITY_GATE"]);
  if (result.verdict.kind === "CANNOT_ASSESS") assert.strictEqual(result.verdict.blindPaths[0].class, "BROKEN_CHAIN");
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
