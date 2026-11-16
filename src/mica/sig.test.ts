// ──────────────────────────────────────────────────────────────────────────────
// MICA — Sig (signal clarity) sensor tests
// House style: standalone ts-node script, custom check() harness. No framework.
//   npx ts-node src/mica/sig.test.ts
//
// FIX ROUND A1: the readability gate now admits LOADED_VERIFIED only. Every
// fixture that asserts ALARM, SILENT, or a blindness OTHER than load state is
// therefore persisted to its own file and reloaded through a fresh
// MicaFixtureLog before the sensor sees it. See withDurable().
// ──────────────────────────────────────────────────────────────────────────────

import assert from "assert";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MicaFixtureLog } from "./fixture-log";
import { assessSig, printSigScope } from "./sig";
import type { PreconditionMap, SigConfig, SigResult } from "./sig";
import { renderVerdict } from "./types";
import type { AlarmVerdict, CannotAssessVerdict, SensorVerdict } from "./types";

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

const root = mkdtempSync(join(tmpdir(), "mica-sig-"));
let counter = 0;
const freshPath = (): string => join(root, `log-${counter++}.jsonl`);

// ── Fixture helpers ───────────────────────────────────────────────────────────
//
// NOTE ON `parameters`: there is no longer any such field to supply. MICA's own
// declared record (src/mica/log.ts) never had one. The D2 test below exercises
// the fixture's `undeclared` bag instead — written to disk, covered by the
// fixture's hash, and invisible to MICA's declared shape.

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

/** In-memory build. After A1 this state is BLIND — used only to prove that. */
function buildInMemory(specs: readonly Spec[]): MicaFixtureLog {
  const log = new MicaFixtureLog();
  appendAll(log, specs);
  return log;
}

/**
 * A1 fixture path. Persist to a private file, reload through a FRESH
 * MicaFixtureLog so the sensor sees LOADED_VERIFIED — the only readable
 * state, and the state a live node is in after a restart.
 *
 * The load-state check throws rather than failing softly: a fixture that
 * silently failed to persist would come back as a first-boot chain, the sensor
 * would return CANNOT_ASSESS for a LOAD-STATE reason, and a test asserting
 * CANNOT_ASSESS for some OTHER reason would pass for the wrong reason. That is
 * precisely the failure A1 exists to prevent.
 *
 * The file is removed in `finally`, so a thrown assertion leaves nothing behind.
 * Each call gets its own path: no shared fixture files, no order dependence.
 */
function withDurable<T>(
  specs: readonly Spec[],
  fn: (log: MicaFixtureLog) => T
): T {
  const path = freshPath();
  try {
    const writer = new MicaFixtureLog({ path });
    appendAll(writer, specs);

    const loaded = new MicaFixtureLog({ path });
    if (loaded.getLoadState() !== "LOADED_VERIFIED") {
      throw new Error(
        `FIXTURE BROKEN: expected LOADED_VERIFIED, got ${loaded.getLoadState()} ` +
          `at ${path}. The test below would have passed for the wrong reason.`
      );
    }
    if (loaded.length !== specs.length) {
      throw new Error(
        `FIXTURE BROKEN: persisted ${specs.length} records, reloaded ${loaded.length}.`
      );
    }
    return fn(loaded);
  } finally {
    rmSync(path, { force: true });
  }
}

const T0 = 1_700_000_000_000;

function report(label: string, r: SigResult): void {
  console.log(`\n--- ${label} ---`);
  console.log(renderVerdict(r.verdict));
  for (const f of r.flags) {
    console.log(`  flag ${f.flag} (${f.name}): ${f.kind}, scope=${f.scopeSize}`);
  }
}

function blindClasses(v: SensorVerdict): string[] {
  assert.strictEqual(v.kind, "CANNOT_ASSESS", `expected CANNOT_ASSESS, got ${v.kind}`);
  return (v as CannotAssessVerdict).blindPaths.map((b) => b.class);
}

function codes(v: SensorVerdict): string[] {
  assert.strictEqual(v.kind, "ALARM", `expected ALARM, got ${v.kind}`);
  return (v as AlarmVerdict).findings.map((f) => f.code);
}

// ── Injected configuration ────────────────────────────────────────────────────
//
// These live in the TEST, not in the sensor. The sensor holds no numbers and no
// map. The precondition map below is a TEST MAP — it is not shipped, and it is
// not a model of the v0 state machine.

const TEST_MAP: PreconditionMap = {
  escalation_active: ["escalation_granted"],
  quarantine_lifted: ["quarantine_entered", "operator_override"],
};

/**
 * THE READABLE LOAD-STATE LIST, INJECTED INTO EVERY FIXTURE IN THIS FILE.
 *
 * The gate holds no list of its own and no default: which load states are
 * trustworthy is a deployment fact, so every caller must say. Injecting exactly
 * ["LOADED_VERIFIED"] here keeps every assertion below reading what it read
 * before the list was injected rather than hardcoded.
 *
 * Written as a literal rather than imported from RECOMMENDED_READABLE_LOAD_STATES
 * ON PURPOSE: a fixture that tracked the recommendation would stop being able to
 * detect the recommendation changing underneath it.
 */
const GATE: readonly string[] = ["LOADED_VERIFIED"];

const CFG: SigConfig = {
  readableLoadStates: GATE,
  clockToleranceMs: 0,
  preconditionMap: TEST_MAP,
};


/** A chain in which both flags can read and neither finds anything. */
const CLEAN_SPECS: readonly Spec[] = [
  { timestamp: T0 + 0, eventType: "boot", outcome: "ok" },
  { timestamp: T0 + 10, eventType: "escalation_granted", outcome: "granted" },
  { timestamp: T0 + 20, eventType: "escalation_active", outcome: "active" },
  { timestamp: T0 + 20, eventType: "canary_check", outcome: "clean" },
  { timestamp: T0 + 30, eventType: "quarantine_entered", outcome: "entered" },
  { timestamp: T0 + 40, eventType: "quarantine_lifted", outcome: "lifted" },
];

console.log("\nMICA Sig sensor tests\n");
printSigScope(GATE);

// ══ A1 — IN_MEMORY IS NOW BLIND ══════════════════════════════════════════════

console.log("\n══ A1 · IN_MEMORY is blind ═══════════════════════════════════");

{
  const inMem = buildInMemory(CLEAN_SPECS);
  const r = assessSig(inMem, CFG);
  report("A1 / in-memory chain that previously read SILENT", r);
  check("A1: an IN_MEMORY chain is now CANNOT_ASSESS, whatever it contains", () => {
    assert.strictEqual(inMem.getLoadState(), "IN_MEMORY");
    assert.strictEqual(inMem.verify().valid, true); // integrity holds...
    assert.deepStrictEqual(blindClasses(r.verdict), ["NON_CLEAN_LOAD_STATE"]); // ...provenance does not
  });
  check("A1: no flag runs at all on an unreadable load state", () => {
    assert.strictEqual(r.flags.length, 0);
  });
  check("A1: the same records, persisted and reloaded, ARE readable", () => {
    withDurable(CLEAN_SPECS, (log) => {
      assert.strictEqual(log.getLoadState(), "LOADED_VERIFIED");
      assert.strictEqual(assessSig(log, CFG).verdict.kind, "SILENT");
    });
  });
}

// ══ D4 — degradation ABSENT, sensor must stay SILENT ═════════════════════════

console.log("\n══ D4 · degradation absent ═══════════════════════════════════");

withDurable(CLEAN_SPECS, (log) => {
  const r = assessSig(log, CFG);
  report("CLEAN / monotone clock, preconditions met", r);
  check("consistent record with both flags reading -> SILENT", () => {
    assert.strictEqual(r.verdict.kind, "SILENT");
    // F5 honest split: with no clerkClockSource injected, F3 is NOT_CONFIGURED
    // (a dormant, unconfigured leg) — NOT a blind CANNOT_ASSESS. It is disclosed
    // but excluded from the floor, so the verdict stays SILENT. F4 (probe
    // divergence, added 2026-09-01) is unconfigured here for the same reason and
    // takes the same status: the ARRAY GREW BY ONE ELEMENT, and the meaning of
    // the first three did not move.
    assert.deepStrictEqual(r.flags.map((f) => f.kind), [
      "SILENT",
      "SILENT",
      "NOT_CONFIGURED",
      "NOT_CONFIGURED",
    ]);
  });
  check("SILENT summary states it is an absence of finding, not health", () => {
    assert.ok(r.verdict.summary.includes("ABSENCE OF FINDING"));
    assert.ok(!/\bhealthy\b/i.test(r.verdict.summary));
  });
});

// Equal timestamps are NOT a violation.
withDurable(
  [
    { timestamp: T0, eventType: "a", outcome: "ok" },
    { timestamp: T0, eventType: "b", outcome: "ok" },
    { timestamp: T0, eventType: "c", outcome: "ok" },
  ],
  (log) => {
    const r = assessSig(log, { readableLoadStates: GATE, clockToleranceMs: 0 });
    report("CLEAN / three entries sharing one timestamp", r);
    check("equal timestamps are not a clock contradiction (F1 SILENT)", () => {
      assert.strictEqual(r.flags[0].kind, "SILENT");
    });
  }
);

// An inversion inside the injected tolerance is not a contradiction.
withDurable(
  [
    { timestamp: T0 + 100, eventType: "a", outcome: "ok" },
    { timestamp: T0 + 60, eventType: "b", outcome: "ok" }, // 40 earlier
    { timestamp: T0 + 200, eventType: "c", outcome: "ok" },
  ],
  (log) => {
    const r = assessSig(log, { readableLoadStates: GATE, clockToleranceMs: 40 });
    report("CLEAN / inversion exactly at the injected tolerance", r);
    check("a backwards step equal to the tolerance is not a violation (F1 SILENT)", () => {
      assert.strictEqual(r.flags[0].kind, "SILENT");
    });
    check("A2 tolerance: one unit tighter and the same log DOES alarm", () => {
      const tighter = assessSig(log, { readableLoadStates: GATE, clockToleranceMs: 39 });
      assert.strictEqual(tighter.flags[0].kind, "ALARM");
    });
    check("A2 tolerance: one unit looser is still silent", () => {
      const looser = assessSig(log, { readableLoadStates: GATE, clockToleranceMs: 41 });
      assert.strictEqual(looser.flags[0].kind, "SILENT");
    });
  }
);

// F2's map lists alternatives; ANY ONE of them satisfies the precondition.
withDurable(
  [
    { timestamp: T0 + 0, eventType: "operator_override", outcome: "override" },
    { timestamp: T0 + 10, eventType: "quarantine_lifted", outcome: "lifted" },
  ],
  (log) => {
    const r = assessSig(log, {
          readableLoadStates: GATE,
      clockToleranceMs: 0,
      preconditionMap: { quarantine_lifted: ["quarantine_entered", "operator_override"] },
    });
    report("CLEAN / precondition satisfied by an alternative route", r);
    check("any one listed prior event satisfies the precondition (F2 SILENT)", () => {
      assert.strictEqual(r.flags[1].kind, "SILENT");
      assert.strictEqual(r.verdict.kind, "SILENT");
    });
  }
);

// ══ A2 — SIG SCOPE BOUNDARY AT N=2 ═══════════════════════════════════════════
//
// The suite previously jumped from N=1 (F1 scope empty -> CANNOT_ASSESS) to
// full-length logs. N=2 is the smallest chain with any F1 scope at all: exactly
// one adjacent pair. Both outcomes are exercised on that single pair.

console.log("\n══ A2 · Sig scope boundary at N=2 ════════════════════════════");

withDurable(
  [
    { timestamp: T0 + 0, eventType: "a", outcome: "ok" },
    { timestamp: T0 + 10, eventType: "b", outcome: "ok" },
  ],
  (log) => {
    const r = assessSig(log, { readableLoadStates: GATE, clockToleranceMs: 0 });
    report("A2 / N=2, the one pair is ordered", r);
    check("A2 N=2: exactly one adjacent pair falls inside F1's scope", () => {
      assert.strictEqual(log.length, 2);
      assert.strictEqual(r.flags[0].scopeSize, 1);
    });
    check("A2 N=2: an ordered pair -> F1 SILENT (the smallest readable scope)", () => {
      assert.strictEqual(r.flags[0].kind, "SILENT");
    });
  }
);

withDurable(
  [
    { timestamp: T0 + 10, eventType: "a", outcome: "ok" },
    { timestamp: T0 + 0, eventType: "b", outcome: "ok" },
  ],
  (log) => {
    const r = assessSig(log, { readableLoadStates: GATE, clockToleranceMs: 0 });
    report("A2 / N=2, the one pair is inverted", r);
    check("A2 N=2: an inverted pair -> F1 ALARM on a scope of exactly one", () => {
      assert.strictEqual(r.flags[0].scopeSize, 1);
      assert.strictEqual(r.flags[0].kind, "ALARM");
      assert.strictEqual(r.flags[0].findings.length, 1);
    });
    check("A2 N=2: one record fewer, and the same comparison is unavailable", () => {
      withDurable([{ timestamp: T0 + 10, eventType: "a", outcome: "ok" }], (one) => {
        const r1 = assessSig(one, { readableLoadStates: GATE, clockToleranceMs: 0 });
        assert.strictEqual(r1.flags[0].kind, "CANNOT_ASSESS");
        assert.strictEqual(r1.flags[0].scopeSize, 0);
      });
    });
  }
);

// ══ D3 — degradation PRESENT ═════════════════════════════════════════════════

console.log("\n══ D3 · degradation present — F1 clock vs order ══════════════");

withDurable(
  [
    { timestamp: T0 + 0, eventType: "boot", outcome: "ok" },
    { timestamp: T0 + 5000, eventType: "escalation_granted", outcome: "granted" },
    { timestamp: T0 + 1000, eventType: "escalation_active", outcome: "active" },
    { timestamp: T0 + 6000, eventType: "canary_check", outcome: "clean" },
  ],
  (log) => {
    const r = assessSig(log, { readableLoadStates: GATE, clockToleranceMs: 0, preconditionMap: TEST_MAP });
    report("F1 / one backdated entry", r);
    check("SIG IS NOT CHAIN VERIFICATION: the chain verifies PERFECTLY", () => {
      assert.strictEqual(log.verify().valid, true);
      assert.strictEqual(log.getLoadState(), "LOADED_VERIFIED");
    });
    check("declarant clock contradicting the log's assigned append order -> ALARM", () => {
      assert.strictEqual(r.verdict.kind, "ALARM");
      assert.deepStrictEqual(codes(r.verdict), ["SIG_F1_CLOCK_ORDER_CONTRADICTION"]);
    });
    check("the finding names both records actually in conflict", () => {
      const d = (r.verdict as AlarmVerdict).findings[0].detail;
      assert.ok(d.includes("seq 1"));
      assert.ok(d.includes("seq 2"));
      assert.ok(d.includes("4000 earlier"));
    });
  }
);

withDurable(
  [
    { timestamp: T0 + 500, eventType: "a", outcome: "ok" },
    { timestamp: T0 + 100, eventType: "b", outcome: "ok" },
    { timestamp: T0 + 900, eventType: "c", outcome: "ok" },
    { timestamp: T0 + 300, eventType: "d", outcome: "ok" },
  ],
  (log) => {
    const r = assessSig(log, { readableLoadStates: GATE, clockToleranceMs: 0, preconditionMap: TEST_MAP });
    report("F1 / two independent inversions", r);
    check("every violating pair is reported, not just the first", () => {
      assert.strictEqual(r.verdict.kind, "ALARM");
      const f1 = (r.verdict as AlarmVerdict).findings.filter(
        (f) => f.code === "SIG_F1_CLOCK_ORDER_CONTRADICTION"
      );
      assert.strictEqual(f1.length, 2);
    });
    check("no grade is emitted — two findings, no aggregate score, no severity", () => {
      assert.strictEqual((r.verdict as AlarmVerdict).severity, undefined);
    });
  }
);

console.log("\n══ D3 · degradation present — F2 precondition ════════════════");

// The enabling event EXISTS in the chain — but at a HIGHER sequenceNumber.
withDurable(
  [
    { timestamp: T0 + 0, eventType: "boot", outcome: "ok" },
    { timestamp: T0 + 10, eventType: "escalation_active", outcome: "escalation_in_force" },
    { timestamp: T0 + 20, eventType: "escalation_granted", outcome: "granted" },
  ],
  (log) => {
    const r = assessSig(log, { readableLoadStates: GATE, clockToleranceMs: 0, preconditionMap: TEST_MAP });
    report("F2 / enabling event present but AFTER the state it enables", r);
    check("SIG IS NOT CHAIN VERIFICATION: the chain verifies PERFECTLY", () => {
      assert.strictEqual(log.verify().valid, true);
      assert.strictEqual(log.getLoadState(), "LOADED_VERIFIED");
    });
    check("state asserted before the chain shows it reachable -> ALARM", () => {
      assert.strictEqual(r.verdict.kind, "ALARM");
      assert.ok(codes(r.verdict).includes("SIG_F2_PRECONDITION_UNREACHED"));
    });
    check("the finding quotes the outcome verbatim and never parses it", () => {
      const d = (r.verdict as AlarmVerdict).findings.find(
        (f) => f.code === "SIG_F2_PRECONDITION_UNREACHED"
      )?.detail;
      assert.ok(d !== undefined && d.includes('outcome "escalation_in_force"'));
    });
  }
);

// ALARM dominates an unread scope, but the unread scope is still reported.
withDurable(
  [
    { timestamp: T0 + 500, eventType: "a", outcome: "ok" },
    { timestamp: T0 + 100, eventType: "b", outcome: "ok" },
  ],
  (log) => {
    const r = assessSig(log, { readableLoadStates: GATE, clockToleranceMs: 0 }); // no map -> F2 blind
    report("F1 ALARM while F2 is unread", r);
    check("an alarm from a readable flag survives another flag being blind", () => {
      assert.strictEqual(r.verdict.kind, "ALARM");
    });
    check("the unread scope is carried INSIDE the alarm, not dropped", () => {
      assert.ok(codes(r.verdict).includes("SIG_SCOPE_UNREAD"));
      assert.strictEqual(r.flags[1].kind, "CANNOT_ASSESS");
    });
  }
);

// ══ D5 — blind paths, one test per class ═════════════════════════════════════

console.log("\n══ D5 · blind paths ══════════════════════════════════════════");

// class: BROKEN_CHAIN — on a DURABLE chain, so LOADED_VERIFIED still holds and
// BROKEN_CHAIN is unambiguously the reason.
withDurable(CLEAN_SPECS, (log) => {
  assert.strictEqual(log.getLoadState(), "LOADED_VERIFIED");
  log.getAll()[2].timestamp = T0 + 1;
  const r = assessSig(log, CFG);
  report("BLIND / broken chain (load state still LOADED_VERIFIED)", r);
  check("[BROKEN_CHAIN] tampered entry -> CANNOT_ASSESS, not a load-state artefact", () => {
    assert.strictEqual(log.getLoadState(), "LOADED_VERIFIED");
    assert.deepStrictEqual(blindClasses(r.verdict), ["BROKEN_CHAIN"]);
  });
  check("a tampered timestamp is NOT reported as an F1 finding", () => {
    assert.strictEqual(r.flags.length, 0);
  });
});

// class: NON_CLEAN_LOAD_STATE (absent file)
{
  const p = freshPath();
  try {
    const log = new MicaFixtureLog({ path: p });
    const r = assessSig(log, CFG);
    report("BLIND / load state FIRST_BOOT_OR_ERASED", r);
    check("[NON_CLEAN_LOAD_STATE] FIRST_BOOT_OR_ERASED -> CANNOT_ASSESS", () => {
      assert.strictEqual(log.getLoadState(), "FIRST_BOOT_OR_ERASED");
      assert.deepStrictEqual(blindClasses(r.verdict), ["NON_CLEAN_LOAD_STATE"]);
    });
  } finally {
    rmSync(p, { force: true });
  }
}

// class: NON_CLEAN_LOAD_STATE (unparseable file)
{
  const p = freshPath();
  try {
    writeFileSync(p, "{not json at all\n", "utf8");
    const log = new MicaFixtureLog({ path: p });
    const r = assessSig(log, CFG);
    report("BLIND / load state CANNOT_VERIFY", r);
    check("[NON_CLEAN_LOAD_STATE] CANNOT_VERIFY with a VALID verify() -> CANNOT_ASSESS", () => {
      assert.strictEqual(log.getLoadState(), "CANNOT_VERIFY");
      assert.strictEqual(log.verify().valid, true);
      assert.deepStrictEqual(blindClasses(r.verdict), ["NON_CLEAN_LOAD_STATE"]);
    });
  } finally {
    rmSync(p, { force: true });
  }
}

// class: MISSING_CONFIGURATION
withDurable(CLEAN_SPECS, (log) => {
  const noTolerance = assessSig(log, { readableLoadStates: GATE, preconditionMap: TEST_MAP });
  report("BLIND / no clockToleranceMs", noTolerance);
  check("[MISSING_CONFIGURATION] absent tolerance -> F1 blind, verdict CANNOT_ASSESS", () => {
    assert.deepStrictEqual(blindClasses(noTolerance.verdict), ["MISSING_CONFIGURATION"]);
    assert.strictEqual(noTolerance.flags[0].kind, "CANNOT_ASSESS");
  });

  const noMap = assessSig(log, { readableLoadStates: GATE, clockToleranceMs: 0 });
  report("BLIND / no preconditionMap (F2 SHIPPED DORMANT)", noMap);
  check("[MISSING_CONFIGURATION] no map -> F2 CANNOT_ASSESS, never SILENT", () => {
    assert.strictEqual(noMap.flags[1].kind, "CANNOT_ASSESS");
  });
  check("F1 silent + F2 unread does NOT become an overall SILENT", () => {
    assert.strictEqual(noMap.flags[0].kind, "SILENT");
    assert.strictEqual(noMap.verdict.kind, "CANNOT_ASSESS");
  });

  const emptyMap = assessSig(log, { readableLoadStates: GATE, clockToleranceMs: 0, preconditionMap: {} });
  report("BLIND / EMPTY preconditionMap", emptyMap);
  check("an EMPTY map does not buy a clean reading", () => {
    assert.strictEqual(emptyMap.flags[1].kind, "CANNOT_ASSESS");
    assert.strictEqual(emptyMap.verdict.kind, "CANNOT_ASSESS");
  });

  const nothing = assessSig(log, { readableLoadStates: GATE });
  report("BLIND / no configuration at all", nothing);
  check("[MISSING_CONFIGURATION] no config -> CANNOT_ASSESS naming both flags", () => {
    assert.deepStrictEqual(blindClasses(nothing.verdict), [
      "MISSING_CONFIGURATION",
      "MISSING_CONFIGURATION",
    ]);
  });
  check("a negative tolerance is not accepted as an injected window", () => {
    const r = assessSig(log, { readableLoadStates: GATE, clockToleranceMs: -1, preconditionMap: TEST_MAP });
    assert.strictEqual(r.flags[0].kind, "CANNOT_ASSESS");
  });
});

// class: INELIGIBLE_SCOPE (F1 — no adjacent pair)
withDurable([{ timestamp: T0, eventType: "boot", outcome: "ok" }], (one) => {
  const r = assessSig(one, CFG);
  report("BLIND / single-entry chain (F1 scope empty)", r);
  check("[INELIGIBLE_SCOPE] one entry -> F1 CANNOT_ASSESS, not SILENT", () => {
    assert.strictEqual(r.flags[0].kind, "CANNOT_ASSESS");
    assert.deepStrictEqual(r.flags[0].blindPaths.map((b) => b.class), ["INELIGIBLE_SCOPE"]);
  });
});

// An EMPTY chain cannot be a LOADED_VERIFIED fixture — L0 reports an
// empty-but-present file as FIRST_BOOT_OR_ERASED. So after A1 the empty chain
// is unreachable through the readable gate, and the only empty-chain reading
// available is a load-state one. Recorded rather than worked around.
{
  const p = freshPath();
  try {
    writeFileSync(p, "", "utf8");
    const log = new MicaFixtureLog({ path: p });
    const r = assessSig(log, CFG);
    report("BLIND / empty chain (unreachable as LOADED_VERIFIED after A1)", r);
    check("empty durable chain loads as FIRST_BOOT_OR_ERASED, not LOADED_VERIFIED", () => {
      assert.strictEqual(log.length, 0);
      assert.strictEqual(log.getLoadState(), "FIRST_BOOT_OR_ERASED");
      assert.deepStrictEqual(blindClasses(r.verdict), ["NON_CLEAN_LOAD_STATE"]);
    });
  } finally {
    rmSync(p, { force: true });
  }
}

// class: INELIGIBLE_SCOPE (F2 — map governs nothing present)
withDurable(
  [
    { timestamp: T0 + 0, eventType: "boot", outcome: "ok" },
    { timestamp: T0 + 10, eventType: "canary_check", outcome: "clean" },
  ],
  (log) => {
    const r = assessSig(log, {
          readableLoadStates: GATE,
      clockToleranceMs: 0,
      preconditionMap: { some_event_never_logged: ["its_prerequisite"] },
    });
    report("BLIND / map governs no eventType present in the chain", r);
    check("[INELIGIBLE_SCOPE] no record inside F2's scope -> CANNOT_ASSESS", () => {
      assert.strictEqual(r.flags[1].kind, "CANNOT_ASSESS");
      assert.deepStrictEqual(r.flags[1].blindPaths.map((b) => b.class), ["INELIGIBLE_SCOPE"]);
      assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
    });
  }
);

// ── the three verdicts must be distinguishable in PRINTED output ─────────────
withDurable(
  [
    { timestamp: T0 + 500, eventType: "a", outcome: "ok" },
    { timestamp: T0 + 100, eventType: "b", outcome: "ok" },
  ],
  (alarmLog) => {
    withDurable(CLEAN_SPECS, (cleanLog) => {
      const a = assessSig(alarmLog, CFG).verdict;
      const s = assessSig(cleanLog, CFG).verdict;
      const c = assessSig(cleanLog, { readableLoadStates: GATE }).verdict;
      check("ALARM / SILENT / CANNOT_ASSESS are distinct in rendered output", () => {
        assert.ok(renderVerdict(a).includes("VERDICT: ALARM"));
        assert.ok(renderVerdict(s).includes("VERDICT: SILENT"));
        assert.ok(renderVerdict(c).includes("VERDICT: CANNOT_ASSESS"));
        assert.notStrictEqual(renderVerdict(a), renderVerdict(s));
        assert.notStrictEqual(renderVerdict(s), renderVerdict(c));
      });
    });
  }
);

// ══ D8 — claim-must-fail: SEVERANCE ══════════════════════════════════════════

console.log("\n══ D8 · severance ════════════════════════════════════════════");

withDurable(
  [
    { timestamp: T0 + 0, eventType: "boot", outcome: "ok" },
    { timestamp: T0 + 5000, eventType: "escalation_granted", outcome: "granted" },
    { timestamp: T0 + 1000, eventType: "escalation_active", outcome: "active" },
  ],
  (log) => {
    const before = assessSig(log, CFG);
    report("SEVERANCE step 1 / intact chain", before);
    check("severance step 1: intact chain yields a real reading (ALARM)", () => {
      assert.strictEqual(before.verdict.kind, "ALARM");
      assert.strictEqual(log.verify().valid, true);
    });

    log.getAll()[0].outcome = "rewritten_after_the_fact";
    check("severance step 2: the dependency is actually severed", () => {
      assert.strictEqual(log.verify().valid, false);
    });

    const after = assessSig(log, CFG);
    report("SEVERANCE step 3 / severed chain", after);
    check("severance step 4: verdict FALLS from ALARM to CANNOT_ASSESS", () => {
      assert.strictEqual(after.verdict.kind, "CANNOT_ASSESS");
      assert.deepStrictEqual(blindClasses(after.verdict), ["BROKEN_CHAIN"]);
    });
    check("severance: no flag runs at all on a severed chain", () => {
      assert.strictEqual(after.flags.length, 0);
    });
  }
);

withDurable(CLEAN_SPECS, (log) => {
  const before = assessSig(log, CFG);
  check("severance-2 step 1: configured sensor yields a real reading (SILENT)", () => {
    assert.strictEqual(before.verdict.kind, "SILENT");
  });
  const after = assessSig(log, { readableLoadStates: GATE, });
  report("SEVERANCE-2 / configuration removed", after);
  check("severance-2 step 4: verdict FALLS from SILENT to CANNOT_ASSESS", () => {
    assert.strictEqual(after.verdict.kind, "CANNOT_ASSESS");
  });
});

// ══ D2 — the forbidden read ══════════════════════════════════════════════════
//
// CHANGED IN KIND — see the same block in eng.test.ts. MICA's declared record
// has no `parameters` bag, so what is varied here is the fixture's `undeclared`
// content: on disk, inside the fixture's hash, and outside MICA's shape.

{
  const pathA = freshPath();
  const pathB = freshPath();
  try {
    const a = new MicaFixtureLog({ path: pathA });
    const b = new MicaFixtureLog({ path: pathB });
    for (const s of CLEAN_SPECS) {
      const common = {
        timestamp: s.timestamp,
        moduleId: "m6",
        eventType: s.eventType,
        outcome: s.outcome,
      };
      a.append({ ...common });
      b.append({
        ...common,
        undeclared: { realTimestamp: 1, precondition: "granted", nested: { z: 9 } },
      });
    }
    const la = new MicaFixtureLog({ path: pathA });
    const lb = new MicaFixtureLog({ path: pathB });
    check("D2: identical declared fields + wildly different UNDECLARED content -> identical verdict", () => {
      const va = assessSig(la, CFG).verdict;
      const vb = assessSig(lb, CFG).verdict;
      assert.strictEqual(va.kind, vb.kind);
      assert.strictEqual(va.summary, vb.summary);
    });
  } finally {
    rmSync(pathA, { force: true });
    rmSync(pathB, { force: true });
  }
}

// ══ D1 — A LOG OF THE DECLARED SHAPE, ACROSS A RESTART ═══════════════════════
//
// ⚠ THIS TEST'S CLAIM HAS BEEN NARROWED, AND THE OLD WORDING IS NOT KEPT.
//
// It used to run a live ILAS node and read the chain that node wrote. Its
// evidential value WAS that dependency. MICA no longer takes ILAS as a
// dependency of any kind, so there is no live node to run, and what is read
// below is A FIXTURE — an append-only file this repository writes through its
// own log (src/mica/fixture-log.ts), in its own record format.
//
// WHAT THIS NOW SHOWS:      the sensor reads a log of MICA's declared shape,
//                           across a real write / teardown / reload cycle, and
//                           returns a typed verdict.
// WHAT IT NO LONGER SHOWS:  that the sensor reads a chain a real system wrote.
//                           NOTHING IN THIS REPOSITORY SHOWS THAT ANY MORE.
//
// It is a fixture. Not equivalent to a real chain, not as good as one, not a
// stand-in for one. The A1 first-run cost is still demonstrated rather than
// described: that is the readability gate's behaviour and the gate is unchanged.

console.log("\n══ D1 · a log of the declared shape, across a restart ════════");

/**
 * An invented trace. The module and event names are plausible-looking and mean
 * nothing: no system produced them, and they are not a model of one.
 */
const D1_FIXTURE_SPECS: readonly Spec[] = [
  { moduleId: "mA", eventType: "resource_registered", outcome: "registered", timestamp: T0 + 0 },
  { moduleId: "mA", eventType: "resource_registered", outcome: "registered", timestamp: T0 + 5 },
  { moduleId: "mA", eventType: "resource_registered", outcome: "registered", timestamp: T0 + 9 },
  { moduleId: "mB", eventType: "threshold_declared", outcome: "declared", timestamp: T0 + 14 },
  { moduleId: "mB", eventType: "threshold_declared", outcome: "declared", timestamp: T0 + 20 },
  { moduleId: "mC", eventType: "outbound_checked", outcome: "match_found", timestamp: T0 + 27 },
  { moduleId: "mB", eventType: "threshold_declared", outcome: "change_recorded", timestamp: T0 + 33 },
];

{
  const p = freshPath();
  try {
    const first = new MicaFixtureLog({ path: p });
    appendAll(first, D1_FIXTURE_SPECS);

    const firstRead = assessSig(first, { readableLoadStates: GATE, clockToleranceMs: 0 });
    report("FIXTURE log, FIRST RUN (no prior file)", firstRead);
    check("D1/A1: a node on its FIRST RUN cannot be read — the accepted cost, shown", () => {
      assert.strictEqual(first.getLoadState(), "FIRST_BOOT_OR_ERASED");
      assert.deepStrictEqual(blindClasses(firstRead.verdict), ["NON_CLEAN_LOAD_STATE"]);
    });

    const second = new MicaFixtureLog({ path: p });
    const r = assessSig(second, { readableLoadStates: GATE, clockToleranceMs: 0 });
    report("FIXTURE log, AFTER RESTART (F1 configured, F2 deliberately unmapped)", r);
    console.log(
      `  chain length: ${second.length}, loadState=${second.getLoadState()}, ` +
        `verify().valid=${second.verify().valid}`
    );

    check("D1: reads a FIXTURE log of the declared shape and returns a typed verdict — NOT evidence of reading a real chain", () => {
      assert.strictEqual(second.getLoadState(), "LOADED_VERIFIED");
      assert.ok(second.length > 0);
      assert.strictEqual(second.verify().valid, true);
      assert.ok(["ALARM", "SILENT", "CANNOT_ASSESS"].includes(r.verdict.kind));
    });
    check("D1: F2 stays dormant on the fixture chain — no map, so no clean reading", () => {
      assert.strictEqual(r.flags[1].kind, "CANNOT_ASSESS");
    });
  } finally {
    rmSync(p, { force: true });
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

rmSync(root, { recursive: true, force: true });


// -- F1-S104 · the tolerance's basis is printed beside the number ------------
//
// The arbiter's ruling (S104): clockToleranceMs 0 ships as a PRINTED PROXY — asserted
// one-box-one-clock, NOT measured. A number cannot say which of those it is, so
// the basis rides on the value and F1 prints it verbatim where it prints the
// number. Absent basis prints exactly what it always printed: no provenance is
// better than an assumed one, and this is the same discipline as the
// assembler's DeclaredSweepPeriod (S103-G).

check("F1-S104-1 · the basis is printed VERBATIM beside the tolerance it explains", () => {
  const log = new MicaFixtureLog();
  log.append({ timestamp: 1_000, moduleId: "m", eventType: "a", outcome: "ok" });
  log.append({ timestamp: 500, moduleId: "m", eventType: "b", outcome: "ok" });
  const r = assessSig(log, {
    readableLoadStates: ["IN_MEMORY"],
    clockToleranceMs: 0,
    clockToleranceBasis: "PROXY: asserted one box one clock, NOT measured",
  });
  assert.strictEqual(r.flags[0].kind, "ALARM");
  const detail = r.flags[0].findings[0].detail;
  assert.ok(
    detail.includes("clockToleranceMs of 0 [PROXY: asserted one box one clock, NOT measured]"),
    `the basis did not reach the finding: ${detail}`
  );
});

check("F1-S104-2 · NO basis prints no provenance — never an assumed one", () => {
  const log = new MicaFixtureLog();
  log.append({ timestamp: 1_000, moduleId: "m", eventType: "a", outcome: "ok" });
  log.append({ timestamp: 500, moduleId: "m", eventType: "b", outcome: "ok" });
  const r = assessSig(log, { readableLoadStates: ["IN_MEMORY"], clockToleranceMs: 0 });
  const detail = r.flags[0].findings[0].detail;
  assert.ok(detail.includes("clockToleranceMs of 0."), `unexpected shape: ${detail}`);
  assert.ok(!detail.includes("["), "a provenance nobody declared appeared in the finding");
  assert.ok(
    !/proxy|asserted|measured/i.test(detail),
    "F1 guessed at where the number came from"
  );
});

check("F1-S104-3 · a blank basis is treated as no basis, not as an empty claim", () => {
  const log = new MicaFixtureLog();
  log.append({ timestamp: 1_000, moduleId: "m", eventType: "a", outcome: "ok" });
  log.append({ timestamp: 500, moduleId: "m", eventType: "b", outcome: "ok" });
  const r = assessSig(log, {
    readableLoadStates: ["IN_MEMORY"],
    clockToleranceMs: 0,
    clockToleranceBasis: "   ",
  });
  assert.ok(!r.flags[0].findings[0].detail.includes("[]"), "an empty bracket reached the reader");
});

// ══════════════════════════════════════════════════════════════════════════════
// T3 · COMPOSITION — which F3 disclosures compose into the floor, and which do
//      not. Ticket T3-sig-f3-watermark.
//
//   a disclosed TAIL          -> does NOT lower the bound. That is the repair.
//   a HOLE (carrier skipped)  -> DOES.
//   a STALE axis              -> DOES.
//   a foreign chain's stamp   -> DOES, and is refused rather than joined.
//
// Read as one block, these four rows are the claim T3 makes: it converts a
// blindness that fired every day into one that fires when the axis is actually
// broken. If a later change makes the tail blind again, or makes a hole clean,
// it fails here.
// ══════════════════════════════════════════════════════════════════════════════

const T3_SPECS: readonly Spec[] = [
  { timestamp: 1_000, eventType: "a", outcome: "ok", moduleId: "w1" },
  { timestamp: 2_000, eventType: "b", outcome: "ok", moduleId: "w2" },
  { timestamp: 3_000, eventType: "a", outcome: "ok", moduleId: "w1" },
  { timestamp: 4_000, eventType: "b", outcome: "ok", moduleId: "w2" },
];
const T3_BASE: SigConfig = {
  readableLoadStates: ["LOADED_VERIFIED"],
  clockToleranceMs: 0,
  preconditionMap: { b: ["a"] } as PreconditionMap,
  // T8 · AN ORDINARY CARRY NOW NAMES ITS CHAIN, AND AN ORDINARY CONFIG EXPECTS
  // IT. Under T8 a stamp joins only when it matches the identity this run was
  // told to expect, so a base config injecting none would turn every T3
  // scenario below into a refusal scenario — and they would all read alike,
  // which is precisely what these five tests exist to tell apart.
  expectedChainIdentity: "chain-LIVE",
};
// ══ T9 · F1 REPORTS ITS HEADROOM, NOT ONLY ITS BREACHES ═════════════════════
//
// The arbiter's word: "Sig's F1 leg reports its largest measured inversion on every
// reading, silent or not, so that the record's agreement with itself shows its
// headroom and not only its breaches."
//
// ⛔ WHAT IT COST BEFORE. `clockToleranceMs` is ONE declared field read by F1 AND
// F3. F3 carried its deviation since T3(4); F1 computed the gap for every pair
// and kept it only when it already exceeded the tolerance — so on a clean run
// there was NO NUMBER ANYWHERE, and a tolerance declared from measurement was
// declared from half the evidence it governs.

check("T9 · a SILENT F1 over a real scope reports a FINITE deviation — the case the ticket exists for", () => {
  const r = withDurable(
    [
      { timestamp: 1_000, eventType: "a", outcome: "ok" },
      { timestamp: 2_000, eventType: "b", outcome: "ok" },
      { timestamp: 3_500, eventType: "a", outcome: "ok" },
    ],
    (l) => assessSig(l, { ...T3_BASE, clockToleranceMs: 1100 })
  );
  assert.strictEqual(r.flags[0].kind, "SILENT", "control: F1 found nothing");
  const d = r.f1Deviation;
  assert.ok(d !== null, "⛔ a SILENT F1 must still report its headroom — this is the whole ticket");
  assert.ok(Number.isFinite(d.maxDeclaredInversionMs), "the maximum must be a real number");
  // The clock never ran backwards, so the largest `prev - curr` is the SMALLEST
  // forward step negated: 1000-2000 = -1000 beats 2000-3500 = -1500.
  assert.strictEqual(d.maxDeclaredInversionMs, -1000, "the largest prev-minus-curr over the scope");
  assert.strictEqual(d.clockToleranceMs, 1100);
  assert.strictEqual(d.distanceMs, -2100, "negative is headroom, identical in sign to F3");
  assert.strictEqual(d.pairsCompared, 2, "adjacent pairs, the same ones the findings walk");
});

check("T9 · the sign convention matches f3Deviation field for field", () => {
  const r = withDurable(
    [
      { timestamp: 1_000, eventType: "a", outcome: "ok" },
      { timestamp: 2_000, eventType: "b", outcome: "ok" },
    ],
    (l) => assessSig(l, { ...T3_BASE, clockToleranceMs: 7 })
  );
  const d = r.f1Deviation;
  assert.ok(d !== null);
  assert.strictEqual(
    d.distanceMs,
    d.maxDeclaredInversionMs - d.clockToleranceMs,
    "distance is max minus tolerance — positive is the adverse side, as on F3"
  );
  assert.deepStrictEqual(
    Object.keys(d).sort(),
    ["clockToleranceMs", "distanceMs", "maxDeclaredInversionMs", "pairsCompared"],
    "the same four fields F3Deviation carries, and no others"
  );
});

check("T9 · an ALARMING F1 reports the SAME maximum the finding names", () => {
  // ⛔ The accumulator and the findings must walk the same pairs. If they could
  // differ, the number beside a finding would be about a different scope.
  const r = withDurable(
    [
      { timestamp: 5_000, eventType: "a", outcome: "ok" },
      { timestamp: 1_000, eventType: "b", outcome: "ok" },
    ],
    (l) => assessSig(l, { ...T3_BASE, clockToleranceMs: 100 })
  );
  assert.strictEqual(r.flags[0].kind, "ALARM");
  const d = r.f1Deviation;
  assert.ok(d !== null);
  assert.strictEqual(d.maxDeclaredInversionMs, 4000);
  assert.strictEqual(d.distanceMs, 3900, "positive: the adverse side");
  assert.ok(r.flags[0].findings[0].detail.includes("4000"), "the finding names the same number");
});

check("T9 · NULL where F1 took no measurement, and NOT merely because it found nothing", () => {
  // A scope with no adjacent pair has nothing to be a maximum OF.
  const one = withDurable(
    [{ timestamp: 1_000, eventType: "a", outcome: "ok" }],
    (l) => assessSig(l, { ...T3_BASE, clockToleranceMs: 0 })
  );
  assert.strictEqual(one.f1Deviation, null, "one entry, no pair, no maximum");
});

check("T9 · a second assessment that takes no F1 reading reports NO deviation", () => {
  // ⛔ THIS TEST OUTLIVED THE MECHANISM IT WAS WRITTEN FOR, AND THAT IS WORTH
  //   SAYING RATHER THAN QUIETLY RENAMING. The first build of T9 handed F1's
  //   deviation out through a MODULE-LOCAL CARRIER cleared before each call, and
  //   this check pinned the one hazard that introduces: a stale value from a
  //   previous assessment read as this one's. It passed.
  //
  //   The arbiter ruled the outcome object instead (T3's shape), and the hazard
  //   IS NOW UNREACHABLE: a value RETURNED cannot be read out of order. So this
  //   check can no longer fail for the reason it was written for.
  //
  //   IT STAYS ANYWAY, and the reason is the general one: it asserts a PROPERTY
  //   — "a reading that measured nothing reports nothing" — not a mechanism, and
  //   the property is what the next mechanism will also have to satisfy. A test
  //   that only made sense against one implementation would have been deleted
  //   here; this one is cheaper to keep than to re-derive.
  const first = withDurable(
    [
      { timestamp: 1_000, eventType: "a", outcome: "ok" },
      { timestamp: 2_000, eventType: "b", outcome: "ok" },
    ],
    (l) => assessSig(l, { ...T3_BASE, clockToleranceMs: 0 })
  );
  assert.ok(first.f1Deviation !== null, "control: the first reading has a number");
  const second = withDurable(
    [{ timestamp: 9_000, eventType: "a", outcome: "ok" }],
    (l) => assessSig(l, { ...T3_BASE, clockToleranceMs: 0 })
  );
  assert.strictEqual(second.f1Deviation, null, "a reading with no adjacent pair reports no deviation, whatever the first reading found");
});

function t3Stamp(seq: number, clerkSeq: number, wall: number, chain: string = "chain-LIVE", mod?: string) {
  return {
    // T6 · THE STAMP CARRIES THE RECORD'S OWN WRITER, because that is what the
    // carrier writes (`moduleId: record.moduleId`, mica-clerk-caller.ts:914). Until
    // T6 the join ignored this field, so these fixtures could name any writer and
    // still join. Under T6 a disagreeing stamp is DISCARDED and DISCLOSED, so a
    // fixture modelling an ORDINARY carry must agree. The DELIBERATE mismatch now
    // has its own scenario rather than being every fixture's incidental state.
    moduleId: mod ?? (seq % 2 === 0 ? "w1" : "w2"),
    // T8 · defaulted to the live chain; the retired-chain scenario passes its own.
    chainIdentity: chain,
    sequenceNumber: seq,
    clerk_seq: clerkSeq,
    clerk_time: { wall_ms: wall, monotonic_ns: String(wall) },
    separation: "SEPARATE_PROCESS" as const,
    intake: "SOCKET" as const,
    clerk_id: "c",
    clerk_boot_id: "b",
  };
}
const T3_HEAD = [t3Stamp(0, 1, 10_000), t3Stamp(1, 2, 10_001)];

check("T3 · a DISCLOSED TAIL does not lower the bound — Sig composes SILENT", () => {
  const r = withDurable(T3_SPECS, (l) =>
    assessSig(l, { ...T3_BASE, clerkClockSource: T3_HEAD, clerkStampLagBoundMs: 30_000, readAtMs: 20_001 })
  );
  assert.strictEqual(r.flags[2].kind, "SILENT");
  assert.strictEqual(r.verdict.kind, "SILENT");
  assert.strictEqual(r.clerkStampCoverage?.tailCount, 2);
  // And the tail is NOT in the verdict summary. Ticket condition 1.
  assert.ok(!/tail/i.test(r.verdict.summary), `the tail reached the verdict summary: ${r.verdict.summary}`);
});

check("T3 · a STALE axis DOES lower the bound — Sig composes CANNOT_ASSESS", () => {
  const r = withDurable(T3_SPECS, (l) =>
    assessSig(l, { ...T3_BASE, clerkClockSource: T3_HEAD, clerkStampLagBoundMs: 30_000, readAtMs: 70_001 })
  );
  assert.strictEqual(r.flags[2].kind, "CANNOT_ASSESS");
  assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
  const v = r.verdict as CannotAssessVerdict;
  assert.ok(v.blindPaths.some((b) => b.detail.startsWith("AXIS_STALE: ")));
  assert.ok(
    v.blindPaths.every((b) => b.class !== ("AXIS_STALE" as never)),
    "AXIS_STALE must ride in the detail, not as a BlindPathClass member"
  );
});

check("T3 · a HOLE DOES lower the bound, and is a different finding from a tail", () => {
  const r = withDurable(T3_SPECS, (l) =>
    assessSig(l, { ...T3_BASE, clerkClockSource: [t3Stamp(1, 1, 10_000), t3Stamp(2, 2, 10_001), t3Stamp(3, 3, 10_002)] })
  );
  assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
  const v = r.verdict as CannotAssessVerdict;
  assert.ok(v.blindPaths.some((b) => b.detail.startsWith("CARRIER_SKIPPED: ")));
  assert.strictEqual(r.clerkStampCoverage?.holeCount, 1);
  assert.strictEqual(r.clerkStampCoverage?.tailCount, 0);
});

check("T3 · a FOREIGN CHAIN's stamp is refused and lowers the bound", () => {
  const r = withDurable(T3_SPECS, (l) =>
    assessSig(l, {
      ...T3_BASE,
      clerkClockSource: [t3Stamp(0, 1, 10_000, "chain-RETIRED"), t3Stamp(1, 2, 10_001, "chain-RETIRED")],
      expectedChainIdentity: "chain-LIVE",
    })
  );
  assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
  const v = r.verdict as CannotAssessVerdict;
  assert.ok(v.blindPaths.some((b) => b.detail.startsWith("CHAIN_IDENTITY_MISMATCH: ")));
  assert.strictEqual(r.clerkStampCoverage?.stampedCount, 0);
});

check("T3 · an ALARM over the STAMPED part is NOT suppressed by a stale tail", () => {
  // THE FAIL-OPEN A CAREFUL VERSION OF ITEM (2) WOULD COMMIT. A contradiction
  // found among records the clerk actually receipted is a positive reading; a
  // stale tail does not unmake it. Returning CANNOT_ASSESS here would RAISE the
  // composite floor from ALARM to CANNOT_ASSESS, which under the pilot line is
  // the difference between HOLD and PASS_BLIND — i.e. it would let the act run.
  const r = withDurable(T3_SPECS, (l) =>
    assessSig(l, {
      ...T3_BASE,
      // clerk order 2,1 over local seq 0,1 inverts declared time against receipts.
      clerkClockSource: [t3Stamp(0, 2, 10_000), t3Stamp(1, 1, 10_001)],
      clerkStampLagBoundMs: 30_000,
      readAtMs: 70_001,
    })
  );
  assert.strictEqual(r.flags[2].kind, "ALARM");
  assert.strictEqual(r.verdict.kind, "ALARM");
  const v = r.verdict as AlarmVerdict;
  assert.ok(v.findings.some((f) => f.code === "SIG_F3_DECLARED_VS_CLERK_CLOCK_CONTRADICTION"));
  // and the stale scope is still disclosed beside it, not swallowed.
  assert.ok(v.findings.some((f) => f.code === "SIG_SCOPE_UNREAD" && f.detail.includes("AXIS_STALE")));
  assert.strictEqual(r.clerkStampCoverage?.axisStale, true);
});

check("T3 · the deviation is a NUMBER on SigResult, and is NOT on the verdict", () => {
  const r = withDurable(T3_SPECS, (l) =>
    assessSig(l, { ...T3_BASE, clerkClockSource: [t3Stamp(0, 2, 10_000), t3Stamp(1, 1, 10_001)] })
  );
  assert.deepStrictEqual(r.f3Deviation, {
    maxDeclaredInversionMs: 1_000,
    clockToleranceMs: 0,
    distanceMs: 1_000,
    pairsCompared: 1,
  });
  for (const forbidden of ["margin", "distance", "threshold", "deviation"]) {
    assert.ok(!(forbidden in r.verdict), `SensorVerdict grew a "${forbidden}" field`);
  }
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
