// ──────────────────────────────────────────────────────────────────────────────
// MICA — Sig F2 NEGATIVE PRECONDITION (re-entry / mutual exclusion), end to end
//   npx ts-node src/mica/sig-f2-reentry.test.ts
//
// House style: standalone ts-node script, custom check() harness, no framework.
//
// WHAT THIS PROVES
//
//   The negative element that closes D-24's duplicate-entry class (see
//   sig-f2-d24-coverage.test.ts). F2 now ALARMs — code SIG_F2_STATE_ALREADY_
//   ACTIVE — when a declared enter event re-enters a state already active: a
//   prior enter of the same eventType with no intervening clear, in
//   sequenceNumber order.
//
//   THE FENCE IT WAS BUILT BEHIND. The element is OPTION-B injected (no default,
//   no fallback), carried on SigResult and printed in the export artifact, and
//   kept OUT of the frozen verdict: an absent or clean re-entry scope leaves the
//   verdict byte-identical (verdict-logic.test.ts stays 22/22), and ONLY a
//   re-entry VIOLATION lowers the bound. That is what let it ship without a
//   ruled re-freeze.
//
//   THE LIMIT. Declared transitions only; state->record fidelity, not world
//   truth. A system emitting a clean enter/clear/enter alternation reads SILENT
//   whether or not it truly left the state — F2 catches the careless re-entrant,
//   not the careful faker.
// ──────────────────────────────────────────────────────────────────────────────

import assert from "assert";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { MicaFixtureLog } from "./fixture-log";
import { assessSig } from "./sig";
import { deliverSigReading } from "./export";
import type { PreconditionMap, SigConfig } from "./sig";
import { assessEng } from "./eng";
import type { EngConfig } from "./eng";
import { assessNarrowW, NARROW_W_LEG2_PROXY_CALIBRATION } from "./narrow-w";
import type { NarrowWConfig } from "./narrow-w";
import { Chokepoint, FloorTrail } from "./chokepoint";
import type { ProposedAction, StakesLine } from "./chokepoint";
import type { AlarmVerdict, SensorVerdict } from "./types";

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

const root = mkdtempSync(join(tmpdir(), "mica-f2-reentry-"));
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

function mono(events: readonly { eventType: string; outcome: string }[]): Spec[] {
  return events.map((e, i) => ({ timestamp: T0 + i * 10, ...e }));
}

// state `session` is entered by `session_open`, cleared by `session_close`.
const POS: PreconditionMap = { session_open: ["boot"] };
const REENTRY: PreconditionMap = { session_open: ["session_close"] };
const CFG = (reentry?: PreconditionMap): SigConfig => ({
  readableLoadStates: GATE,
  clockToleranceMs: 0,
  preconditionMap: POS,
  ...(reentry !== undefined ? { reentryMap: reentry } : {}),
});

function guard(v: SensorVerdict, verdicts: SensorVerdict[] = [v]) {
  return new Chokepoint({ line: LINE, floorTrail: freshFloorTrail() }).guard(A("g"), verdicts, {
    impactClass: "trivial",
  });
}

console.log("\nMICA — Sig F2 negative precondition (re-entry), end to end\n");

// ══ re-entry violation -> ALARM -> HOLD ══════════════════════════════════════

console.log("══ enter-while-active -> F2 ALARM (SIG_F2_STATE_ALREADY_ACTIVE) -> HOLD ══");

withDurable(
  mono([
    { eventType: "boot", outcome: "ok" },
    { eventType: "session_open", outcome: "opened" },
    { eventType: "session_open", outcome: "opened_again" },
  ]),
  (log) => {
    const r = assessSig(log, CFG(REENTRY));
    check("re-entry -> F2 ALARM with the new code, not the positive one", () => {
      assert.strictEqual(r.verdict.kind, "ALARM");
      const codes = (r.verdict as AlarmVerdict).findings.map((f) => f.code);
      assert.ok(codes.includes("SIG_F2_STATE_ALREADY_ACTIVE"));
      assert.ok(!codes.includes("SIG_F2_PRECONDITION_UNREACHED"));
    });
    check("the finding names the re-entered event and its clears", () => {
      const d = (r.verdict as AlarmVerdict).findings.find(
        (f) => f.code === "SIG_F2_STATE_ALREADY_ACTIVE"
      )?.detail;
      assert.ok(d !== undefined);
      assert.ok(d.includes("session_open"));
      assert.ok(d.includes("[session_close]"));
    });
    check("re-entry ALARM floors the gate to HOLD", () => {
      const d = guard(r.verdict);
      assert.strictEqual(d.disposition, "HOLD");
      assert.strictEqual(d.execute, false);
    });
  }
);

// ══ clean alternation -> SILENT -> RELEASE  (and the world-truth limit) ══════

console.log("══ enter/clear/enter -> SILENT -> RELEASE (the limit: fidelity, not truth) ══");

withDurable(
  mono([
    { eventType: "boot", outcome: "ok" },
    { eventType: "session_open", outcome: "opened" },
    { eventType: "session_close", outcome: "closed" },
    { eventType: "session_open", outcome: "reopened" },
  ]),
  (log) => {
    const r = assessSig(log, CFG(REENTRY));
    check("clean enter/clear/enter -> SILENT -> RELEASE", () => {
      assert.strictEqual(r.verdict.kind, "SILENT");
      const d = guard(r.verdict);
      assert.strictEqual(d.disposition, "RELEASE");
      assert.strictEqual(d.execute, true);
    });
    check("THE LIMIT: a clean alternation reads SILENT even if the state was never truly left", () => {
      // The `session_close` is a string the observed party writes. Its presence
      // is not proof the session actually ended. F2 reads state->record
      // fidelity, not world truth: a faker emitting proper alternation passes.
      assert.strictEqual(r.verdict.kind, "SILENT");
    });
  }
);

// ══ non-compensatory composition with F1 + positive-F2 + Eng + narrow-W ══════

console.log("══ a re-entry ALARM floors a composite [Sig, Eng, narrow-W] ══");

const ENG_CLASSES = [
  { moduleId: "m3", eventType: "canary_check" },
  { moduleId: "m5", eventType: "drift_sample" },
  { moduleId: "m7", eventType: "permission_check" },
];
function engSpecs(n: number, outcomeOf: (i: number) => string): Spec[] {
  const out: Spec[] = [];
  for (let i = 0; i < n; i++) {
    const c = ENG_CLASSES[i % ENG_CLASSES.length];
    out.push({ moduleId: c.moduleId, eventType: c.eventType, outcome: outcomeOf(i), timestamp: T0 + i });
  }
  return out;
}
const HEALTHY = engSpecs(90, (i) =>
  i % 4 === 0 ? "deferred" : `verdict_class_${i % ENG_CLASSES.length}`
);
const ENG_CFG: EngConfig = {
  readableLoadStates: GATE,
  structureThreshold: 0.2,
  minimumSampleSize: 30,
  // T11 · the observed-coverage floor, declared and with no default. This
  // suite declares its OWN Eng config, which is why it is in T11's `opens`:
  // without this line Eng returns MISSING_CONFIGURATION and every reading
  // through it becomes CANNOT_ASSESS.
  minimumClassCoverage: 3,
  ceilingMargin: 0.02,
  permutationSamples: 400,
  permutationSeed: 20260806,
};
// A real narrow-W SILENT now needs BOTH legs SILENT. Leg 2's required config is
// injected from NARROW_W_LEG2_PROXY_CALIBRATION (PRE-PILOT PROXY, subject to
// calibration), and narrow-W reads a DEDICATED healthy inquiry-context log (as
// the Eng co-sensor already reads its own); the SIG fixture drives Sig only.
const NW_Q = ["nw_q1", "nw_q2", "nw_q3"];
const NARROW_L2_HEALTHY: Spec[] = (() => {
  const out: Spec[] = [];
  let t = 0;
  const push = (eventType: string, moduleId: string): void => {
    out.push({ timestamp: T0 + t++, eventType, outcome: "o", moduleId });
  };
  for (let k = 0; k < 3; k++) {
    for (let d = 0; d < 8; d++) { push(`nw_c${k}`, "cx"); push(NW_Q[k], "m6"); }
    for (let o = 0; o < 2; o++) {
      push(`nw_c${k}`, "cx"); push(NW_Q[(k + 1) % 3], "m6");
      push(`nw_c${k}`, "cx"); push(NW_Q[(k + 2) % 3], "m6");
    }
  }
  return out;
})();
const NARROW_CFG: NarrowWConfig = {
  readableLoadStates: GATE,
  declaredProfile: NW_Q,
  correlationThreshold: NARROW_W_LEG2_PROXY_CALIBRATION.correlationThreshold,
  correlationMinimumInquiryEvents:
    NARROW_W_LEG2_PROXY_CALIBRATION.correlationMinimumInquiryEvents,
  correlationCeilingMargin: NARROW_W_LEG2_PROXY_CALIBRATION.correlationCeilingMargin,
};

withDurable(
  mono([
    { eventType: "boot", outcome: "ok" },
    { eventType: "session_open", outcome: "opened" },
    { eventType: "session_open", outcome: "opened_again" },
  ]),
  (sigLog) => {
    const sig = assessSig(sigLog, CFG(REENTRY)).verdict; // re-entry ALARM
    const narrowW = withDurable(NARROW_L2_HEALTHY, (wl) =>
      assessNarrowW(wl, NARROW_CFG).verdict
    ); // leg 1 + leg 2 both SILENT
    const eng = withDurable(HEALTHY, (l) => assessEng(l, ENG_CFG).verdict); // SILENT

    check("the three legs are ALARM (Sig re-entry), SILENT (Eng), SILENT (narrow-W)", () => {
      assert.strictEqual(sig.kind, "ALARM");
      assert.strictEqual(eng.kind, "SILENT");
      assert.strictEqual(narrowW.kind, "SILENT");
    });
    check("the re-entry ALARM floors the composite to HOLD — SILENT co-sensors cannot buy it back", () => {
      const d = guard(sig, [eng, sig, narrowW]);
      assert.strictEqual(d.disposition, "HOLD");
      assert.strictEqual(d.execute, false);
      const codes = d.decision.findings.map((f) => f.code);
      assert.ok(codes.includes("SIG_F2_STATE_ALREADY_ACTIVE"));
    });
  }
);

// F1 (clock) + re-entry ride together: the re-entry ALARM composes with a
// non-monotone clock inside the same Sig verdict, both findings present.
withDurable(
  [
    { timestamp: T0 + 100, eventType: "boot", outcome: "ok" },
    { timestamp: T0 + 200, eventType: "session_open", outcome: "opened" },
    { timestamp: T0 + 50, eventType: "session_open", outcome: "opened_again" }, // clock inversion
  ],
  (log) => {
    const r = assessSig(log, CFG(REENTRY));
    check("F1 clock inversion AND re-entry both ride on one Sig ALARM -> HOLD", () => {
      assert.strictEqual(r.verdict.kind, "ALARM");
      const codes = (r.verdict as AlarmVerdict).findings.map((f) => f.code);
      assert.ok(codes.includes("SIG_F1_CLOCK_ORDER_CONTRADICTION"));
      assert.ok(codes.includes("SIG_F2_STATE_ALREADY_ACTIVE"));
      const d = guard(r.verdict);
      assert.strictEqual(d.disposition, "HOLD");
    });
  }
);

// ══ visible, not free — carried on the result, printed in the artifact ═══════

console.log("══ visible, not free · re-entry map carried on the result and printed ══");

withDurable(
  mono([
    { eventType: "boot", outcome: "ok" },
    { eventType: "session_open", outcome: "opened" },
  ]),
  (log) => {
    const injected = assessSig(log, CFG(REENTRY));
    const absent = assessSig(log, CFG());
    const empty = assessSig(log, CFG({}));

    check("the injected re-entry map is carried on the result", () => {
      assert.strictEqual(injected.reentryMap, REENTRY);
    });
    check("absent OR empty re-entry map -> null on the result (the 'not checked' disclosure)", () => {
      assert.strictEqual(absent.reentryMap, null);
      assert.strictEqual(empty.reentryMap, null);
    });
    check("empty re-entry map is a no-op on the verdict — byte-identical to absent", () => {
      // {} is normalised to null and never lowers the bound: mirrors the empty
      // preconditionMap discipline at the RESULT level, but disclosed there, not
      // in the verdict (which stays SILENT, unmoved).
      assert.strictEqual(empty.verdict.kind, "SILENT");
      assert.strictEqual(absent.verdict.summary, empty.verdict.summary);
    });
    check("NOT IN THE VERDICT — the summary names no re-entry map (frozen surface untouched)", () => {
      assert.ok(!injected.verdict.summary.includes("session_close"));
    });
    check("the exported artifact PRINTS the injected re-entry map (what F2 was told to exclude)", () => {
      const art = deliverSigReading(injected).artifact;
      assert.ok(art.includes("WHAT F2 WAS TOLD TO EXCLUDE"));
      assert.ok(art.includes("session_open"));
      assert.ok(art.includes("session_close"));
    });
    check("the artifact discloses when re-entry was NOT checked, rather than implying a clean pass", () => {
      const art = deliverSigReading(absent).artifact;
      assert.ok(art.includes("WHAT F2 WAS TOLD TO EXCLUDE"));
      assert.ok(art.includes("NOT CHECKED"));
    });
  }
);

// ── Summary ──────────────────────────────────────────────────────────────────

rmSync(root, { recursive: true, force: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
