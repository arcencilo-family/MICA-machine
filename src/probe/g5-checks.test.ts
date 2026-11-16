// ── MICA · G5 checks — acceptance tests, incl. the board-bar source fence ────

import assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";

import {
  checkBasisRecordAnchor,
  checkEscalateArtifact,
  checkGovernedPath,
  checkIndistinguishableWithoutRecord,
  checkInvocationOccurred,
  checkPurposeProvenance,
  checkPurposeProvenanceConfirmation,
  checkScopeComparison,
} from "./g5-checks";
import type { ExceptionInvocationObservable } from "./scenario";

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

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── checkInvocationOccurred · the null-action fact ──");

check("G5-A · presence ABSENT reads UNRECORDED regardless of anything else", () => {
  assert.strictEqual(checkInvocationOccurred({ presence: "ABSENT" }), "UNRECORDED");
});

check("G5-B · presence PRESENT with occurred unset reads UNRECORDED, never a default", () => {
  assert.strictEqual(checkInvocationOccurred({ presence: "PRESENT" }), "UNRECORDED");
});

check("G5-C · occurred:true reads OCCURRED; occurred:false reads DID_NOT_OCCUR", () => {
  assert.strictEqual(checkInvocationOccurred({ presence: "PRESENT", occurred: true }), "OCCURRED");
  assert.strictEqual(checkInvocationOccurred({ presence: "PRESENT", occurred: false }), "DID_NOT_OCCUR");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── checkBasisRecordAnchor · the no-anchor route ──");

check("G5-D · unset reads UNRECORDED", () => {
  assert.strictEqual(checkBasisRecordAnchor({ presence: "PRESENT" }), "UNRECORDED");
});

check("G5-E · PRESENT reads ANCHORED, ABSENT reads NO_ANCHOR", () => {
  assert.strictEqual(
    checkBasisRecordAnchor({ presence: "PRESENT", basisRecordReference: "PRESENT" }),
    "ANCHORED"
  );
  assert.strictEqual(
    checkBasisRecordAnchor({ presence: "PRESENT", basisRecordReference: "ABSENT" }),
    "NO_ANCHOR"
  );
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── checkPurposeProvenance / checkPurposeProvenanceConfirmation ──");

check("G5-F · checkPurposeProvenance is a straight pass-through, UNRECORDED when unset", () => {
  assert.strictEqual(checkPurposeProvenance({ presence: "PRESENT" }), "UNRECORDED");
  assert.strictEqual(
    checkPurposeProvenance({ presence: "PRESENT", purposeProvenance: "SYNTHESIZED" }),
    "SYNTHESIZED"
  );
  assert.strictEqual(
    checkPurposeProvenance({ presence: "PRESENT", purposeProvenance: "INSTANTIATED_FROM_RECORD" }),
    "INSTANTIATED_FROM_RECORD"
  );
});

check("G5-G · INSTANTIATED_FROM_RECORD never confirms, whatever manifestDisproportion says", () => {
  assert.strictEqual(
    checkPurposeProvenanceConfirmation({
      presence: "PRESENT",
      purposeProvenance: "INSTANTIATED_FROM_RECORD",
      manifestDisproportion: true,
    }),
    "NOT_SIGNALED"
  );
});

check("G5-H · SYNTHESIZED without manifestDisproportion is SIGNATURE_ONLY — a signature, never a conviction", () => {
  assert.strictEqual(
    checkPurposeProvenanceConfirmation({ presence: "PRESENT", purposeProvenance: "SYNTHESIZED" }),
    "SIGNATURE_ONLY"
  );
});

check("G5-I · SYNTHESIZED with manifestDisproportion:true is CONFIRMED — the but-déterminant standard", () => {
  assert.strictEqual(
    checkPurposeProvenanceConfirmation({
      presence: "PRESENT",
      purposeProvenance: "SYNTHESIZED",
      manifestDisproportion: true,
    }),
    "CONFIRMED"
  );
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── checkScopeComparison · Pole-B BY CONSTRUCTION (06a §3) ──");

check("G5-J · unset (either circle) reads UNRECORDED", () => {
  assert.strictEqual(checkScopeComparison({ presence: "PRESENT" }), "UNRECORDED");
  assert.strictEqual(
    checkScopeComparison({ presence: "PRESENT", benefitedCircle: "SUB_SCOPE" }),
    "UNRECORDED"
  );
});

check("G5-K · SUB_SCOPE benefit exporting WIDER_CIRCLE harm reads POLE_B_BY_CONSTRUCTION", () => {
  assert.strictEqual(
    checkScopeComparison({
      presence: "PRESENT",
      benefitedCircle: "SUB_SCOPE",
      harmedCircle: "WIDER_CIRCLE",
    }),
    "POLE_B_BY_CONSTRUCTION"
  );
});

check("G5-L · every other combination reads NOT_POLE_B", () => {
  assert.strictEqual(
    checkScopeComparison({
      presence: "PRESENT",
      benefitedCircle: "WIDER_CIRCLE",
      harmedCircle: "SUB_SCOPE",
    }),
    "NOT_POLE_B"
  );
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── checkGovernedPath · the three components, each on its own ──");

check("G5-M · all three unset read UNRECORDED", () => {
  const r = checkGovernedPath({ presence: "PRESENT" });
  assert.deepStrictEqual(r, { epistemic: "UNRECORDED", dynamical: "UNRECORDED", authority: "UNRECORDED" });
});

check("G5-N · each component reads its own boolean independently", () => {
  const r = checkGovernedPath({
    presence: "PRESENT",
    epistemicComponent: true,
    dynamicalComponent: false,
  });
  assert.deepStrictEqual(r, { epistemic: "PRESENT", dynamical: "ABSENT", authority: "UNRECORDED" });
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── checkEscalateArtifact ──");

check("G5-O · unset reads UNRECORDED; PRESENT/ABSENT read VALID_ARTIFACT/NO_ARTIFACT", () => {
  assert.strictEqual(checkEscalateArtifact({ presence: "PRESENT" }), "UNRECORDED");
  assert.strictEqual(
    checkEscalateArtifact({ presence: "PRESENT", escalateArtifact: "PRESENT" }),
    "VALID_ARTIFACT"
  );
  assert.strictEqual(
    checkEscalateArtifact({ presence: "PRESENT", escalateArtifact: "ABSENT" }),
    "NO_ARTIFACT"
  );
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── checkIndistinguishableWithoutRecord · M4 vocabulary, carried never routed on ──");

check("G5-P · pass-through, UNRECORDED when unset", () => {
  assert.strictEqual(checkIndistinguishableWithoutRecord({ presence: "PRESENT" }), "UNRECORDED");
  assert.strictEqual(
    checkIndistinguishableWithoutRecord({ presence: "PRESENT", indistinguishableWithoutRecord: true }),
    true
  );
  assert.strictEqual(
    checkIndistinguishableWithoutRecord({ presence: "PRESENT", indistinguishableWithoutRecord: false }),
    false
  );
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the board bar, enforced in code (no phrase matching in g5-checks.ts) ──");

function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, " ")
    .replace(/`(?:[^`\\]|\\.)*`/g, " ");
}

check("G5-Q · FENCE — g5-checks.ts contains no .includes(, .match(, or RegExp use", () => {
  const source = readFileSync(join(__dirname, "g5-checks.ts"), "utf8");
  const stripped = codeOnly(source);
  assert.ok(!stripped.includes(".includes("), "g5-checks.ts calls .includes() outside comments/strings");
  assert.ok(!stripped.includes(".match("), "g5-checks.ts calls .match() outside comments/strings");
  assert.ok(!/RegExp/.test(stripped), "g5-checks.ts references RegExp outside comments/strings");
});

function fieldReadsOf(source: string, fnName: string): string[] {
  const start = source.indexOf(`export function ${fnName}`);
  assert.ok(start >= 0, `${fnName} is no longer declared`);
  const body = source.slice(start, source.indexOf("\n}", start) + 2);
  return [...new Set([...body.matchAll(/\bo\.(\w+)/g)].map((m) => m[1]))].sort();
}

check("G5-R · FENCE — checkInvocationOccurred reads only presence and occurred", () => {
  const source = readFileSync(join(__dirname, "g5-checks.ts"), "utf8");
  assert.deepStrictEqual(fieldReadsOf(source, "checkInvocationOccurred"), ["occurred", "presence"]);
});

check("G5-S · FENCE — checkBasisRecordAnchor reads only basisRecordReference", () => {
  const source = readFileSync(join(__dirname, "g5-checks.ts"), "utf8");
  assert.deepStrictEqual(fieldReadsOf(source, "checkBasisRecordAnchor"), ["basisRecordReference"]);
});

check("G5-T · FENCE — checkPurposeProvenance reads only purposeProvenance", () => {
  const source = readFileSync(join(__dirname, "g5-checks.ts"), "utf8");
  assert.deepStrictEqual(fieldReadsOf(source, "checkPurposeProvenance"), ["purposeProvenance"]);
});

check(
  "G5-U · FENCE — checkPurposeProvenanceConfirmation reads only purposeProvenance and manifestDisproportion",
  () => {
    const source = readFileSync(join(__dirname, "g5-checks.ts"), "utf8");
    assert.deepStrictEqual(fieldReadsOf(source, "checkPurposeProvenanceConfirmation"), [
      "manifestDisproportion",
      "purposeProvenance",
    ]);
  }
);

check("G5-V · FENCE — checkScopeComparison reads only benefitedCircle and harmedCircle", () => {
  const source = readFileSync(join(__dirname, "g5-checks.ts"), "utf8");
  assert.deepStrictEqual(fieldReadsOf(source, "checkScopeComparison"), ["benefitedCircle", "harmedCircle"]);
});

check("G5-W · FENCE — checkGovernedPath reads only the three component fields", () => {
  const source = readFileSync(join(__dirname, "g5-checks.ts"), "utf8");
  assert.deepStrictEqual(fieldReadsOf(source, "checkGovernedPath"), [
    "authorityComponent",
    "dynamicalComponent",
    "epistemicComponent",
  ]);
});

check("G5-X · FENCE — checkEscalateArtifact reads only escalateArtifact", () => {
  const source = readFileSync(join(__dirname, "g5-checks.ts"), "utf8");
  assert.deepStrictEqual(fieldReadsOf(source, "checkEscalateArtifact"), ["escalateArtifact"]);
});

check("G5-Y · FENCE — checkIndistinguishableWithoutRecord reads only indistinguishableWithoutRecord", () => {
  const source = readFileSync(join(__dirname, "g5-checks.ts"), "utf8");
  assert.deepStrictEqual(fieldReadsOf(source, "checkIndistinguishableWithoutRecord"), [
    "indistinguishableWithoutRecord",
  ]);
});

check("G5-Z · FENCE — no NEW function in this file skips its own field-read fence (a coverage guard)", () => {
  const source = readFileSync(join(__dirname, "g5-checks.ts"), "utf8");
  const exported = [...source.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1]);
  const fenced = [
    "checkInvocationOccurred",
    "checkBasisRecordAnchor",
    "checkPurposeProvenance",
    "checkPurposeProvenanceConfirmation",
    "checkScopeComparison",
    "checkGovernedPath",
    "checkEscalateArtifact",
    "checkIndistinguishableWithoutRecord",
  ];
  assert.deepStrictEqual([...exported].sort(), [...fenced].sort());
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
