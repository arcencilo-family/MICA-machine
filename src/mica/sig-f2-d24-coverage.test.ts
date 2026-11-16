// ──────────────────────────────────────────────────────────────────────────────
// MICA — Sig F2 COVERAGE OF D-24's STATE-MACHINE CLASSES
//   npx ts-node src/mica/sig-f2-d24-coverage.test.ts
//
// House style: standalone ts-node script, custom check() harness, no framework.
//
// LEDGER CROSS-REFERENCE — D-24
//
//   D-24 parked a set of untested input classes on F2 and recorded: "state-
//   machine validity (duplicate entry, lift without entry) and multi-hop
//   precondition chains are F2 scope, and F2 is dormant." F2 is no longer
//   dormant (Sig is two-legged; see sig-f2-activation.test.ts). This file
//   discharges D-24's F2-scope classes end to end through guard(), and puts the
//   ONE class F2 structurally cannot read on the record rather than forcing it
//   green.
//
//   WHAT F2 ACTUALLY CHECKS (sig/index.ts runF2): per governed `eventType`, that
//   AT LEAST ONE listed prior `eventType` appears at a LOWER sequenceNumber.
//   That is a POSITIVE existence-of-a-prior test, order-sensitive. Everything
//   below follows from exactly that, and nothing assumes more.
//
//   D-24 CLASS-BY-CLASS DISPOSITION:
//
//     · lift without entry ............ COVERED. A governed event with none of
//         its required priors at a lower seq is F2's exact failure condition —
//         including the temporal variant where the prior exists but AFTER.
//     · multi-hop precondition chains . COVERED, with a stated limit. Each hop is
//         its own map key, checked independently. A chain missing an intermediate
//         fires F2 on the governed event whose DECLARED DIRECT prior is absent.
//         LIMIT: F2 verifies each declared direct link, NOT full transitive
//         reachability. A missing deep ancestor is invisible unless the
//         intermediate hop is ALSO declared. Encoded as an explicit test below.
//     · duplicate entry ............... COVERED (closed 2026-08-14). Was on the
//         record as [owed → the arbiter]: F2's positive check sees only ABSENCE of a
//         required prior, so a duplicate (a PRESENCE/cardinality fact) was
//         invisible and flowed to RELEASE. Closed by F2's NEGATIVE / mutual-
//         exclusion element (reentryMap): a declared enter event that re-enters a
//         state already active ALARMs with code SIG_F2_STATE_ALREADY_ACTIVE. The
//         checks below flip from "gap on the record -> RELEASE" to "closed ->
//         ALARM -> HOLD". See sig/index.ts detectReentry and ReentryMap.
// ──────────────────────────────────────────────────────────────────────────────

import assert from "assert";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { MicaFixtureLog } from "./fixture-log";
import { assessSig } from "./sig";
import type { PreconditionMap, SigConfig } from "./sig";
import { Chokepoint, FloorTrail } from "./chokepoint";
import type { DispositionResult, ProposedAction, StakesLine } from "./chokepoint";
import type { AlarmVerdict } from "./types";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    failed++;
  }
}

const root = mkdtempSync(join(tmpdir(), "mica-f2-d24-"));
let counter = 0;
const freshFloorTrail = (): FloorTrail =>
  new FloorTrail({ path: join(root, `floor-trail-${counter++}.jsonl`) });
const freshPath = (): string => join(root, `log-${counter++}.jsonl`);

interface Spec {
  timestamp: number;
  eventType: string;
  outcome: string;
  moduleId?: string;
}

function appendAll(log: MicaFixtureLog, specs: readonly Spec[]): void {
  for (const s of specs) {
    log.append({
      timestamp: s.timestamp,
      moduleId: s.moduleId ?? "m6",
      eventType: s.eventType,
      outcome: s.outcome,
    });
  }
}

/** Persist and reload so the sensor sees LOADED_VERIFIED — the only readable
 *  state after A1, and the state a live node is in after a restart. */
function withDurable<T>(specs: readonly Spec[], fn: (log: MicaFixtureLog) => T): T {
  const path = freshPath();
  try {
    appendAll(new MicaFixtureLog({ path }), specs);
    const loaded = new MicaFixtureLog({ path });
    if (loaded.getLoadState() !== "LOADED_VERIFIED") {
      throw new Error(`FIXTURE BROKEN: ${loaded.getLoadState()} at ${path}`);
    }
    return fn(loaded);
  } finally {
    rmSync(path, { force: true });
  }
}

const T0 = 1_700_000_000_000;
const GATE: readonly string[] = ["LOADED_VERIFIED"];
const A = (id: string): ProposedAction => ({ id });
const LINE: StakesLine = {
  classes: ["trivial", "low", "medium", "high", "critical"],
  holdAtOrAbove: "medium",
};

/** Monotone timestamps so F1 never fires — these fixtures isolate F2. Each spec
 *  is stamped in append order. */
function mono(events: readonly { eventType: string; outcome: string }[]): Spec[] {
  return events.map((e, i) => ({ timestamp: T0 + i * 10, ...e }));
}

/** assessSig then compose the single Sig verdict through the gate, as a
 *  deployment would. Returns both so a test can read the flag AND the gate.
 *  `reentry` is optional — the negative / mutual-exclusion element. */
function assess(
  log: MicaFixtureLog,
  map: PreconditionMap,
  reentry?: PreconditionMap
) {
  const cfg: SigConfig = {
    readableLoadStates: GATE,
    clockToleranceMs: 0,
    preconditionMap: map,
    ...(reentry !== undefined ? { reentryMap: reentry } : {}),
  };
  const result = assessSig(log, cfg);
  const gate: DispositionResult = new Chokepoint({
    line: LINE,
    floorTrail: freshFloorTrail(),
  }).guard(
    A("g"),
    [result.verdict],
    { impactClass: "trivial" }
  );
  return { result, gate };
}

function f2Codes(v: AlarmVerdict): string[] {
  return v.findings.filter((f) => f.code === "SIG_F2_PRECONDITION_UNREACHED").map((f) => f.detail);
}

console.log("\nMICA — Sig F2 coverage of D-24's state-machine classes\n");

// ══ CLASS · lift without entry — COVERED ═════════════════════════════════════

console.log("══ lift without entry -> F2 ALARM -> HOLD (covered) ══");

const LIFT_MAP: PreconditionMap = { quarantine_lifted: ["quarantine_entered"] };

// Violation: lift with no entry anywhere in the chain.
withDurable(
  mono([
    { eventType: "boot", outcome: "ok" },
    { eventType: "quarantine_lifted", outcome: "lifted" },
  ]),
  (log) => {
    const { result, gate } = assess(log, LIFT_MAP);
    check("lift with NO prior entry -> F2 ALARM", () => {
      assert.strictEqual(result.flags[1].kind, "ALARM");
      assert.strictEqual(result.verdict.kind, "ALARM");
      const details = f2Codes(result.verdict as AlarmVerdict);
      assert.strictEqual(details.length, 1);
      assert.ok(details[0].includes("quarantine_lifted"));
      assert.ok(details[0].includes("[quarantine_entered]"));
    });
    check("lift-without-entry ALARM floors the gate to HOLD, action does not execute", () => {
      assert.strictEqual(gate.disposition, "HOLD");
      assert.strictEqual(gate.execute, false);
    });
  }
);

// Temporal variant: the entry EXISTS but at a higher seq than the lift. "Lift
// without a PRIOR entry" — F2 is order-sensitive, so this still fires.
withDurable(
  mono([
    { eventType: "quarantine_lifted", outcome: "lifted" },
    { eventType: "quarantine_entered", outcome: "entered" },
  ]),
  (log) => {
    const { result, gate } = assess(log, LIFT_MAP);
    check("lift BEFORE entry (prior exists but not earlier) -> F2 ALARM -> HOLD", () => {
      assert.strictEqual(result.flags[1].kind, "ALARM");
      assert.strictEqual(gate.disposition, "HOLD");
      assert.strictEqual(gate.execute, false);
    });
  }
);

// Clean counterpart: entry then lift. Precondition satisfied -> SILENT -> RELEASE.
withDurable(
  mono([
    { eventType: "quarantine_entered", outcome: "entered" },
    { eventType: "quarantine_lifted", outcome: "lifted" },
  ]),
  (log) => {
    const { result, gate } = assess(log, LIFT_MAP);
    check("entry then lift -> F2 SILENT -> RELEASE (the clean counterpart)", () => {
      assert.strictEqual(result.flags[1].kind, "SILENT");
      assert.strictEqual(result.verdict.kind, "SILENT");
      assert.strictEqual(gate.disposition, "RELEASE");
      assert.strictEqual(gate.execute, true);
    });
  }
);

// ══ CLASS · multi-hop precondition chain — COVERED (with a stated limit) ══════

console.log("══ multi-hop chain -> F2 ALARM on the broken hop -> HOLD (covered) ══");

// C requires B, B requires A. Each hop is its own declared map key.
const CHAIN_MAP: PreconditionMap = {
  stage_c: ["stage_b"],
  stage_b: ["stage_a"],
};

// Full chain present -> every hop satisfied -> SILENT -> RELEASE.
withDurable(
  mono([
    { eventType: "stage_a", outcome: "a" },
    { eventType: "stage_b", outcome: "b" },
    { eventType: "stage_c", outcome: "c" },
  ]),
  (log) => {
    const { result, gate } = assess(log, CHAIN_MAP);
    check("full chain A->B->C present -> F2 SILENT -> RELEASE", () => {
      assert.strictEqual(result.flags[1].kind, "SILENT");
      assert.strictEqual(gate.disposition, "RELEASE");
      assert.strictEqual(gate.execute, true);
    });
  }
);

// Missing INTERMEDIATE (B absent). C's direct prior B is gone -> F2 fires on C.
withDurable(
  mono([
    { eventType: "stage_a", outcome: "a" },
    { eventType: "stage_c", outcome: "c" },
  ]),
  (log) => {
    const { result, gate } = assess(log, CHAIN_MAP);
    check("chain missing intermediate B -> F2 ALARM on C (its direct prior absent) -> HOLD", () => {
      assert.strictEqual(result.verdict.kind, "ALARM");
      const details = f2Codes(result.verdict as AlarmVerdict);
      assert.strictEqual(details.length, 1);
      assert.ok(details[0].includes("stage_c"));
      assert.ok(details[0].includes("[stage_b]"));
      assert.strictEqual(gate.disposition, "HOLD");
      assert.strictEqual(gate.execute, false);
    });
  }
);

// Missing ROOT (A absent), intermediate present. C is satisfied by B, but B's
// own declared prior A is gone -> F2 fires on B. The broken chain is caught via
// the hop whose direct prior is missing.
withDurable(
  mono([
    { eventType: "stage_b", outcome: "b" },
    { eventType: "stage_c", outcome: "c" },
  ]),
  (log) => {
    const { result, gate } = assess(log, CHAIN_MAP);
    check("chain missing root A -> C SILENT (B present) but B ALARM (A absent) -> HOLD", () => {
      assert.strictEqual(result.verdict.kind, "ALARM");
      const details = f2Codes(result.verdict as AlarmVerdict);
      assert.strictEqual(details.length, 1);
      assert.ok(details[0].includes("stage_b"), "the finding is on B, whose direct prior A is missing");
      assert.ok(details[0].includes("[stage_a]"));
      assert.strictEqual(gate.disposition, "HOLD");
    });
  }
);

// THE LIMIT, ON THE RECORD. Declare ONLY the top hop (C requires B); do NOT
// declare that B itself requires A. Log has B and C but NOT A. C is satisfied
// (B present), B is not governed, so F2 reads SILENT — even though the chain is
// broken at the root. F2 verifies DECLARED DIRECT links, not transitive
// reachability. This is a scope boundary, not a bug: state it, do not hide it.
withDurable(
  mono([
    { eventType: "stage_b", outcome: "b" },
    { eventType: "stage_c", outcome: "c" },
  ]),
  (log) => {
    const topOnly: PreconditionMap = { stage_c: ["stage_b"] };
    const { result, gate } = assess(log, topOnly);
    check("LIMIT: undeclared deep prerequisite is invisible — F2 SILENT, gate RELEASEs", () => {
      assert.strictEqual(result.flags[1].kind, "SILENT");
      assert.strictEqual(result.verdict.kind, "SILENT");
      assert.strictEqual(gate.disposition, "RELEASE");
      // F2 checks only the links the map declares. It did not infer that stage_b
      // needed stage_a, because the map never said so. Transitive integrity is
      // out of F2's scope; only per-declared-link presence is in it.
    });
  }
);

// ══ CLASS · duplicate entry — CLOSED via the negative / re-entry element ══════

console.log("══ duplicate entry -> F2 re-entry ALARM -> HOLD (CLOSED) ══");

// `boot` enables `quarantine_entered` (positive precondition). The re-entry map
// says the quarantine state is CLEARED by `quarantine_lifted`. The positive map
// alone reads SILENT on a duplicate (boot IS present for both entries); the
// negative element is what sees the second entry re-entering a state never left.
const DUP_POS: PreconditionMap = { quarantine_entered: ["boot"] };
const DUP_REENTRY: PreconditionMap = { quarantine_entered: ["quarantine_lifted"] };

// Enter TWICE with no clear between — the second entry re-enters an active state.
withDurable(
  mono([
    { eventType: "boot", outcome: "ok" },
    { eventType: "quarantine_entered", outcome: "entered" },
    { eventType: "quarantine_entered", outcome: "entered_again" },
  ]),
  (log) => {
    const { result, gate } = assess(log, DUP_POS, DUP_REENTRY);
    check("duplicate entry -> F2 ALARM via the re-entry element (positive stays clean)", () => {
      assert.strictEqual(result.verdict.kind, "ALARM");
      const codes = (result.verdict as AlarmVerdict).findings.map((f) => f.code);
      assert.ok(codes.includes("SIG_F2_STATE_ALREADY_ACTIVE"));
      // The positive check did NOT fire — boot is present for both entries. The
      // finding is the re-entry one, not precondition-unreached.
      assert.ok(!codes.includes("SIG_F2_PRECONDITION_UNREACHED"));
    });
    check("CLOSED: the duplicate-entry ALARM floors the gate to HOLD, action does not execute", () => {
      assert.strictEqual(gate.disposition, "HOLD");
      assert.strictEqual(gate.execute, false);
    });
  }
);

// Clean alternation: enter, clear, enter. The state WAS left before re-entry.
withDurable(
  mono([
    { eventType: "boot", outcome: "ok" },
    { eventType: "quarantine_entered", outcome: "entered" },
    { eventType: "quarantine_lifted", outcome: "lifted" },
    { eventType: "quarantine_entered", outcome: "re_entered_cleanly" },
  ]),
  (log) => {
    const { result, gate } = assess(log, DUP_POS, DUP_REENTRY);
    check("enter/clear/enter alternation -> F2 SILENT -> RELEASE (the clean counterpart)", () => {
      assert.strictEqual(result.verdict.kind, "SILENT");
      assert.strictEqual(gate.disposition, "RELEASE");
      assert.strictEqual(gate.execute, true);
    });
  }
);

// No re-entry map: the scope is NOT CHECKED. The duplicate is not flagged — but
// this is NOT a false SILENT: result.reentryMap is null (the "not checked"
// disclosure), kept out of the frozen verdict on purpose. Without the map the
// deployment did not ask for re-entry checking; F2 does not invent it.
withDurable(
  mono([
    { eventType: "boot", outcome: "ok" },
    { eventType: "quarantine_entered", outcome: "entered" },
    { eventType: "quarantine_entered", outcome: "entered_again" },
  ]),
  (log) => {
    const { result } = assess(log, DUP_POS); // no re-entry map
    check("no re-entry map -> duplicate not flagged, but disclosed as UNCHECKED (reentryMap=null), not a false SILENT", () => {
      assert.strictEqual(result.verdict.kind, "SILENT");
      assert.strictEqual(result.reentryMap, null);
      assert.strictEqual(result.preconditionMap, DUP_POS); // positive WAS checked
    });
  }
);

// ── Summary ──────────────────────────────────────────────────────────────────

rmSync(root, { recursive: true, force: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
