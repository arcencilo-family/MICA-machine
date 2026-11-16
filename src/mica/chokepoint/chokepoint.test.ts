// ──────────────────────────────────────────────────────────────────────────────
// MICA — the loop chokepoint, graded against T1
//   npx ts-node src/mica/chokepoint/chokepoint.test.ts
//
// House style: standalone ts-node script, custom check() harness, no framework.
//
// Grades against ARC_MICA-CANON_Two-Tier-Read-Test_20260807 (T1). T1 is cited,
// never restated. The done-conditions are §9's:
//
//   1 · four dispositions by the §3 mapping over the §2 floor
//   2 · HOLD / HOLD-BLIND actually PREVENT execution (shown, not asserted)
//   3 · RELEASE executes; PASS-BLIND executes AND records
//   4 · the §4 stakes line splits the blind case; absent line -> HOLD-BLIND
//   5 · the §6 NOT_DELIVERED rule fails closed
//   6 · the §7 scope violations throw AND fail to compile
//
// Plus the three corrections this build makes against the brief (see types.ts):
//   · the third reader returns a GapRead, not a SensorVerdict (the adapter)
//   · an EMPTY floor is CANNOT_ASSESS, not SILENT (no fail-open on no readers)
//   · a clear ALARM HOLDs regardless of stakes
// ──────────────────────────────────────────────────────────────────────────────

import assert from "assert";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

import { lookAtLedgerFile, cannotSeeLedgerMessage } from "./ledger";
import { join } from "path";

import { MicaFixtureLog } from "../fixture-log";
import { assessSig } from "../sig";
import { assessEng } from "../eng";
import type { PreconditionMap, SigConfig } from "../sig";
import type { EngConfig } from "../eng";
import { alarm, cannotAssess, silent } from "../types";
import type { SensorVerdict } from "../types";
import { appendLockPath } from "../store/append-store";

import {
  Chokepoint,
  ChokepointLedger,
  FloorTrail,
  BatchedNotifier,
  ChokepointScopeViolation,
  DEFAULT_NOTIFY_WINDOW,
  claimFromDisposition,
  composeFloorKind,
  decideChokepoint,
  gapReadToVerdict,
  mapFloorToDisposition,
  narrowForDisposition,
  renderDisposition,
  stakesSplit,
  executes,
  ROUTING_PRECONDITION,
  DISPOSITION_LABEL,
  READER_THREW_HOLDS,
  holdForReaderThrows,
} from "./index";
import type {
  ChokepointDisposition,
  DispositionInScopeClaim,
  GapReadShape,
  ProposedAction,
  ReaderThrow,
  Stakes,
  StakesLine,
} from "./index";

// clerk1.gap's real read is bridged through a MICA-declared shape (see index.ts:
// the closure ruling forbids src/mica importing clerk even for a type). These
// literals are structurally what src/clerk/gap.ts's readGaps returns; the real
// binding lives in deployment glue outside src/mica and is not exercised here.
const cannotAssessCadenceRead = (): GapReadShape => ({
  kind: "CANNOT_ASSESS_CADENCE",
  instrumentId: "clerk1.gap",
  summary: "No records. There is nothing to read a cadence against.",
  blind: [{ class: "NO_RECORDS", channel: null, detail: "the store holds no clerk records" }],
});

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

const root = mkdtempSync(join(tmpdir(), "mica-choke-"));
let counter = 0;
const freshLedger = (): string => join(root, `cpledger-${counter++}.jsonl`);
const freshFloorTrail = (): FloorTrail =>
  new FloorTrail({ path: join(root, `floor-trail-${counter++}.jsonl`) });
const A = (id: string): ProposedAction => ({ id });

// The injected stakes line used across the file. Five ordered rungs; blind
// actions are HELD at or above "medium".
const LINE: StakesLine = {
  classes: ["trivial", "low", "medium", "high", "critical"],
  holdAtOrAbove: "medium",
};

// Handy verdict builders over the frozen grammar (never mutated here).
const SIG_SILENT = silent("MICA/Sig", "clean scope");
const ENG_SILENT = silent("MICA/Eng", "clean scope");
const SIG_ALARM = alarm("MICA/Sig", "contradiction", [
  { code: "SIG_F1_CLOCK_ORDER_CONTRADICTION", detail: "seq 0 before seq 1" },
]);
const ENG_BLIND = cannotAssess("MICA/Eng", [
  { class: "MISSING_CONFIGURATION", detail: "no structureThreshold injected" },
]);

console.log("\nMICA — the loop chokepoint (T1)\n");

// ══ §2 · THE FLOOR — the non-compensatory min(), and the empty-floor trap ═════

console.log("\n══ §2 · the floor composes non-compensatorily ══");

check("any ALARM caps the floor to ALARM — a clean scope cannot buy it back", () => {
  assert.strictEqual(composeFloorKind(["SILENT", "ALARM", "SILENT"]), "ALARM");
  assert.strictEqual(composeFloorKind(["ALARM", "CANNOT_ASSESS"]), "ALARM");
});
check("no alarm, any CANNOT_ASSESS -> CANNOT_ASSESS (unread is not silence)", () => {
  assert.strictEqual(composeFloorKind(["SILENT", "CANNOT_ASSESS"]), "CANNOT_ASSESS");
});
check("every reader SILENT -> SILENT", () => {
  assert.strictEqual(composeFloorKind(["SILENT", "SILENT"]), "SILENT");
});
check("CORRECTION: an EMPTY floor is CANNOT_ASSESS, never SILENT", () => {
  // The fail-open a naive min() would open: no reader wired -> "all silent" ->
  // RELEASE. Blind is not clean.
  assert.strictEqual(composeFloorKind([]), "CANNOT_ASSESS");
  const d = decideChokepoint(A("a1"), [], { impactClass: "high" }, LINE);
  assert.strictEqual(d.floorKind, "CANNOT_ASSESS");
  assert.strictEqual(d.disposition, "HOLD_BLIND");
  assert.strictEqual(d.executeRaw, false);
});

// ══ §3 · THE MAPPING — exactly one of four dispositions ══════════════════════

console.log("\n══ §3 · floor -> one of four dispositions ══");

check("SILENT floor -> RELEASE", () => {
  const d = decideChokepoint(A("r"), [SIG_SILENT, ENG_SILENT], null, LINE);
  assert.strictEqual(d.floorKind, "SILENT");
  assert.strictEqual(d.disposition, "RELEASE");
  assert.strictEqual(d.executeRaw, true);
});
check("ALARM floor -> HOLD, and the adverse findings ride on it", () => {
  const d = decideChokepoint(A("h"), [SIG_ALARM, ENG_SILENT], null, LINE);
  assert.strictEqual(d.floorKind, "ALARM");
  assert.strictEqual(d.disposition, "HOLD");
  assert.strictEqual(d.executeRaw, false);
  assert.strictEqual(d.findings.length, 1);
  assert.strictEqual(d.findings[0].code, "SIG_F1_CLOCK_ORDER_CONTRADICTION");
});
check("CANNOT_ASSESS floor, stakes >= line -> HOLD-BLIND", () => {
  const d = decideChokepoint(A("hb"), [SIG_SILENT, ENG_BLIND], { impactClass: "high" }, LINE);
  assert.strictEqual(d.floorKind, "CANNOT_ASSESS");
  assert.strictEqual(d.disposition, "HOLD_BLIND");
  assert.strictEqual(d.blindSplit, "ABOVE_LINE");
  assert.strictEqual(d.executeRaw, false);
  assert.strictEqual(d.blindPaths.length, 1);
});
check("CANNOT_ASSESS floor, stakes < line -> PASS-BLIND", () => {
  const d = decideChokepoint(A("pb"), [SIG_SILENT, ENG_BLIND], { impactClass: "low" }, LINE);
  assert.strictEqual(d.disposition, "PASS_BLIND");
  assert.strictEqual(d.blindSplit, "BELOW_LINE");
  assert.strictEqual(d.executeRaw, true);
});
check("exactly one disposition, and it is always one of the four", () => {
  const all: ChokepointDisposition[] = ["RELEASE", "HOLD", "HOLD_BLIND", "PASS_BLIND"];
  for (const kinds of [["SILENT"], ["ALARM"], ["CANNOT_ASSESS"], []] as const) {
    const vs = kinds.map((k) =>
      k === "ALARM" ? SIG_ALARM : k === "CANNOT_ASSESS" ? ENG_BLIND : SIG_SILENT
    );
    const d = decideChokepoint(A("x"), vs as SensorVerdict[], { impactClass: "low" }, LINE);
    assert.ok(all.includes(d.disposition));
  }
});

// ══ correction 3 · a clear ALARM HOLDs regardless of stakes ══════════════════

console.log("\n══ §3 ruled · no stakes value releases an alarm ══");

check("ALARM stays HOLD at the lowest stakes and with no line at all", () => {
  for (const stakes of [{ impactClass: "trivial" }, null] as (Stakes | null)[]) {
    for (const line of [LINE, null] as (StakesLine | null)[]) {
      const m = mapFloorToDisposition("ALARM", stakes, line);
      assert.strictEqual(m.disposition, "HOLD");
      assert.strictEqual(m.blindSplit, "NOT_APPLICABLE");
    }
  }
});

// ══ §4 · THE STAKES LINE — splits the blind case; absent -> cautious ═════════

console.log("\n══ §4 · the stakes line, injected and cautious-by-default ══");

check("the line splits ONLY the CANNOT_ASSESS case", () => {
  assert.strictEqual(stakesSplit({ impactClass: "high" }, LINE), "ABOVE_LINE");
  assert.strictEqual(stakesSplit({ impactClass: "low" }, LINE), "BELOW_LINE");
  assert.strictEqual(stakesSplit({ impactClass: "medium" }, LINE), "ABOVE_LINE"); // at-or-above
});
check("absent line -> cautious default -> HOLD-BLIND, never PASS-BLIND", () => {
  const d = decideChokepoint(A("nl"), [ENG_BLIND], { impactClass: "trivial" }, null);
  assert.strictEqual(d.blindSplit, "NO_USABLE_LINE_CAUTIOUS_DEFAULT");
  assert.strictEqual(d.disposition, "HOLD_BLIND");
});
check("absent stakes with a line present -> cautious default -> HOLD-BLIND", () => {
  const d = decideChokepoint(A("ns"), [ENG_BLIND], null, LINE);
  assert.strictEqual(d.disposition, "HOLD_BLIND");
});
check("an impact class not in the line's vocabulary -> cautious default", () => {
  assert.strictEqual(stakesSplit({ impactClass: "not-a-rung" }, LINE), "NO_USABLE_LINE_CAUTIOUS_DEFAULT");
});
check("an unconfigured chokepoint (no line, no ledger) HOLDs a blind action", () => {
  const cp = new Chokepoint();
  const r = cp.guard(A("u"), [ENG_BLIND], { impactClass: "low" });
  assert.strictEqual(r.disposition, "HOLD_BLIND");
  assert.strictEqual(r.execute, false);
});

// ══ §9.2 / §9.3 · EXECUTION IS GATED — HOLD does not run; RELEASE/PASS do ════

console.log("\n══ execution is gated — shown by an executor that only runs on execute ══");

/** A stand-in executor. It runs ONLY when the disposition permits, and records
 *  that it ran, so "did not execute" is demonstrated, not asserted. */
function attemptExecution(
  cp: Chokepoint,
  action: ProposedAction,
  verdicts: SensorVerdict[],
  stakes: Stakes | null
): { ran: boolean; disposition: ChokepointDisposition } {
  const r = cp.guard(action, verdicts, stakes);
  let ran = false;
  if (r.execute) ran = true; // the only place the action would run
  return { ran, disposition: r.disposition };
}

check("HOLD does not execute", () => {
  const cp = new Chokepoint({ line: LINE });
  const e = attemptExecution(cp, A("e1"), [SIG_ALARM], null);
  assert.strictEqual(e.disposition, "HOLD");
  assert.strictEqual(e.ran, false);
});
check("HOLD-BLIND does not execute", () => {
  const cp = new Chokepoint({ line: LINE });
  const e = attemptExecution(cp, A("e2"), [ENG_BLIND], { impactClass: "critical" });
  assert.strictEqual(e.disposition, "HOLD_BLIND");
  assert.strictEqual(e.ran, false);
});
check("RELEASE executes", () => {
  const cp = new Chokepoint({ line: LINE, floorTrail: freshFloorTrail() });
  const e = attemptExecution(cp, A("e3"), [SIG_SILENT, ENG_SILENT], null);
  assert.strictEqual(e.disposition, "RELEASE");
  assert.strictEqual(e.ran, true);
});

// ══ §5 · PASS-BLIND — executes AND is recorded, always ═══════════════════════

console.log("\n══ §5 · PASS-BLIND records unconditionally, and fails closed if it cannot ══");

check("PASS-BLIND executes AND a durable record exists", () => {
  const ledger = new ChokepointLedger({ path: freshLedger() });
  const cp = new Chokepoint({ line: LINE, ledger, floorTrail: freshFloorTrail() });
  const r = cp.guard(A("pb1"), [SIG_SILENT, ENG_BLIND], { impactClass: "low" });
  assert.strictEqual(r.disposition, "PASS_BLIND");
  assert.strictEqual(r.execute, true);
  assert.strictEqual(r.recorded, true);
  assert.ok(r.record !== null);
  assert.strictEqual(r.record?.actionId, "pb1");
  assert.strictEqual(r.record?.disposition, "PASS_BLIND");
  assert.strictEqual(ledger.length, 1);
});
check("the record survives a reload and the chain verifies (append-only)", () => {
  const path = freshLedger();
  const w = new ChokepointLedger({ path });
  const cp = new Chokepoint({ line: LINE, ledger: w, floorTrail: freshFloorTrail() });
  cp.guard(A("pb2"), [ENG_BLIND], { impactClass: "low" });
  cp.guard(A("pb3"), [ENG_BLIND], { impactClass: "trivial" });
  const reloaded = new ChokepointLedger({ path });
  assert.strictEqual(reloaded.getLoadState(), "LOADED_VERIFIED");
  assert.strictEqual(reloaded.length, 2);
  assert.strictEqual(reloaded.verify().valid, true);
  assert.strictEqual(reloaded.getAll()[1].previousHash, reloaded.getAll()[0].hash);
});
check("PASS-BLIND with NO ledger fails closed to HOLD-BLIND — an unrecorded pass never runs", () => {
  const cp = new Chokepoint({ line: LINE, floorTrail: freshFloorTrail() }); // no ledger
  const r = cp.guard(A("pb4"), [SIG_SILENT, ENG_BLIND], { impactClass: "low" });
  assert.strictEqual(r.decision.disposition, "PASS_BLIND", "raw decision was pass-blind");
  assert.strictEqual(r.disposition, "HOLD_BLIND", "but it failed closed");
  assert.strictEqual(r.execute, false);
  assert.strictEqual(r.narrowed, true);
  assert.ok(r.deliveryNote.includes("silent fail-open") || r.deliveryNote.includes("unrecorded pass"));
});
check("PASS-BLIND whose write FAILS also fails closed", () => {
  const blocker = join(root, `blocker-${counter++}`);
  writeFileSync(blocker, "not a directory", "utf8");
  const ledger = new ChokepointLedger({ path: join(blocker, "child.jsonl") });
  const cp = new Chokepoint({ line: LINE, ledger, floorTrail: freshFloorTrail() });
  const r = cp.guard(A("pb5"), [ENG_BLIND], { impactClass: "low" });
  assert.strictEqual(r.disposition, "HOLD_BLIND");
  assert.strictEqual(r.execute, false);
  assert.strictEqual(r.recorded, false);
});

// ══ §5 · the notice is BATCHED, records are not ═══════════════════════════════

console.log("\n══ §5 · notify sparingly, record everything, carry the suppressed count ══");

check("with window N, N pass-blinds produce ONE notice carrying the count; all N are recorded", () => {
  const ledger = new ChokepointLedger({ path: freshLedger() });
  const notices: number[] = [];
  const notifier = new BatchedNotifier({ window: 5, sink: (n) => notices.push(n.count) });
  const cp = new Chokepoint({ line: LINE, ledger, notifier, floorTrail: freshFloorTrail() });
  for (let i = 0; i < 5; i++) cp.guard(A(`b${i}`), [ENG_BLIND], { impactClass: "low" });
  assert.strictEqual(ledger.length, 5, "every pass-blind recorded");
  assert.deepStrictEqual(notices, [5], "exactly one notice, carrying the suppressed count");
});
check("the tail is not dropped — flush() emits the pending count", () => {
  const notices: number[] = [];
  const notifier = new BatchedNotifier({ window: 10, sink: (n) => notices.push(n.count) });
  const ledger = new ChokepointLedger({ path: freshLedger() });
  const cp = new Chokepoint({ line: LINE, ledger, notifier, floorTrail: freshFloorTrail() });
  for (let i = 0; i < 3; i++) cp.guard(A(`t${i}`), [ENG_BLIND], { impactClass: "low" });
  assert.deepStrictEqual(notices, [], "below the window, no notice yet");
  const tail = notifier.flush();
  assert.strictEqual(tail?.count, 3, "flush carries the tail");
  assert.ok(tail?.message.includes("CHECK THE LINE"));
});
check("the default window is a stated calibration default, not a hidden constant", () => {
  assert.strictEqual(DEFAULT_NOTIFY_WINDOW, 25);
  const n = new BatchedNotifier(); // no window injected -> default
  for (let i = 0; i < DEFAULT_NOTIFY_WINDOW - 1; i++) assert.strictEqual(n.onPassBlindRecorded(), null);
  assert.strictEqual(n.onPassBlindRecorded()?.count, DEFAULT_NOTIFY_WINDOW);
});

// ══ §6 · NOT_DELIVERED FAILS CLOSED ══════════════════════════════════════════

console.log("\n══ §6 · a dropped disposition fails closed, never toward execution ══");

const DROPPED = { kind: "NOT_DELIVERED", detail: "seat unreachable" } as const;
const OK = { kind: "DELIVERED" } as const;

check("RELEASE + dropped -> HOLD-BLIND, non-executing", () => {
  const n = narrowForDisposition("RELEASE", DROPPED);
  assert.strictEqual(n.disposition, "HOLD_BLIND");
  assert.strictEqual(n.execute, false);
  assert.strictEqual(n.narrowed, true);
});
check("PASS-BLIND + dropped -> HOLD-BLIND, non-executing", () => {
  const n = narrowForDisposition("PASS_BLIND", DROPPED);
  assert.strictEqual(n.disposition, "HOLD_BLIND");
  assert.strictEqual(n.execute, false);
});
check("HOLD + dropped -> STILL HOLD, still non-executing (already closed)", () => {
  const n = narrowForDisposition("HOLD", DROPPED);
  assert.strictEqual(n.disposition, "HOLD");
  assert.strictEqual(n.execute, false);
});
check("delivered never changes a disposition", () => {
  for (const d of ["RELEASE", "HOLD", "HOLD_BLIND", "PASS_BLIND"] as ChokepointDisposition[]) {
    const n = narrowForDisposition(d, OK);
    assert.strictEqual(n.disposition, d);
    assert.strictEqual(n.execute, executes(d));
  }
});
check("INVARIANT: no delivery failure ever yields execution", () => {
  for (const d of ["RELEASE", "HOLD", "HOLD_BLIND", "PASS_BLIND"] as ChokepointDisposition[]) {
    assert.strictEqual(narrowForDisposition(d, DROPPED).execute, false);
  }
});
check("a RELEASE whose permit is dropped does not run — shown end to end", () => {
  const cp = new Chokepoint({ line: LINE, deliver: () => DROPPED, floorTrail: freshFloorTrail() });
  const r = cp.guard(A("rd"), [SIG_SILENT, ENG_SILENT], null);
  assert.strictEqual(r.decision.disposition, "RELEASE");
  assert.strictEqual(r.disposition, "HOLD_BLIND");
  assert.strictEqual(r.execute, false);
});
check("a HOLD whose escalation is dropped stays held (fail-closed, not fail-open)", () => {
  const cp = new Chokepoint({ line: LINE, deliver: () => DROPPED });
  const r = cp.guard(A("hd"), [SIG_ALARM], null);
  assert.strictEqual(r.disposition, "HOLD");
  assert.strictEqual(r.execute, false);
  assert.ok(r.deliveryNote.includes("stays held") || r.deliveryNote.includes("no less closed"));
});

// ══ SUBSTRATE CORRECTIONS · F1 + F2 — persistence and delivery are INDEPENDENT ═
//
// The Codex substrate review's two chokepoint BLOCKERs. F1: a durable PASS-BLIND
// record is not proof the permit was delivered — a dropping boundary must still
// fail it closed. F2: a transient ledger write failure must not poison the chain
// into a later false durable pass. Both drive the real orchestration end to end.

console.log("\n══ substrate corrections · F1 (pass-blind delivery) + F2 (append transaction) ══");

check("F1 · a durable PASS-BLIND whose delivery is DROPPED fails closed — record persists, permit does not", () => {
  const ledger = new ChokepointLedger({ path: freshLedger() });
  const cp = new Chokepoint({ line: LINE, ledger, deliver: () => DROPPED, floorTrail: freshFloorTrail() });
  const r = cp.guard(A("f1"), [SIG_SILENT, ENG_BLIND], { impactClass: "low" });
  // The mandatory §5 record DID persist — persistence succeeded on its own.
  assert.strictEqual(r.decision.disposition, "PASS_BLIND", "raw decision was pass-blind");
  assert.strictEqual(r.recorded, true, "the mandatory PASS-BLIND record durably persisted");
  assert.ok(r.record !== null, "and the record object is present");
  assert.strictEqual(ledger.length, 1, "and it is on the durable chain");
  // But delivery through the injected boundary was DROPPED, so the pass fails
  // closed anyway: a permit that reached no consumer must not execute.
  assert.strictEqual(r.disposition, "HOLD_BLIND", "the dropped delivery narrows it closed");
  assert.strictEqual(r.execute, false, "execute === false — the permit reached no one");
  assert.strictEqual(r.narrowed, true, "the §6 delivery rule changed the disposition");
});

check("F1 · a durable PASS-BLIND with a DELIVERING boundary still executes (the fix does not over-narrow)", () => {
  const ledger = new ChokepointLedger({ path: freshLedger() });
  const cp = new Chokepoint({ line: LINE, ledger, deliver: () => OK, floorTrail: freshFloorTrail() });
  const r = cp.guard(A("f1-ok"), [ENG_BLIND], { impactClass: "low" });
  assert.strictEqual(r.disposition, "PASS_BLIND");
  assert.strictEqual(r.execute, true);
  assert.strictEqual(r.recorded, true);
});

check("F2 · a transient ledger write failure poisons nothing and yields no false durable pass", () => {
  const path = freshLedger();
  let failNext = true;
  const flaky = (p: string, line: string): void => {
    if (failNext) {
      failNext = false;
      throw new Error("transient ENOSPC");
    }
    appendFileSync(p, line, "utf8");
  };
  const ledger = new ChokepointLedger({ path, appender: flaky });
  const cp = new Chokepoint({ line: LINE, ledger, floorTrail: freshFloorTrail() });

  // First PASS-BLIND: the durable append FAILS. It must fail closed AND leave the
  // in-memory chain unchanged — no uncommitted tail to link the next record to.
  const r1 = cp.guard(A("f2-a"), [ENG_BLIND], { impactClass: "low" });
  assert.strictEqual(r1.recorded, false, "the failed write did not persist");
  assert.strictEqual(r1.disposition, "HOLD_BLIND", "an unrecorded pass fails closed");
  assert.strictEqual(r1.execute, false);
  assert.strictEqual(ledger.length, 0, "the poisoned node was NOT left in the chain");

  // Second PASS-BLIND: the write now SUCCEEDS and lands contiguously as seq 0.
  const r2 = cp.guard(A("f2-b"), [ENG_BLIND], { impactClass: "low" });
  assert.strictEqual(r2.recorded, true, "the recovered write persisted");
  assert.strictEqual(r2.disposition, "PASS_BLIND");
  assert.strictEqual(r2.execute, true);
  assert.strictEqual(ledger.length, 1);

  // The DISK chain is unbroken and verifies from a cold reload: no missing
  // predecessor, and the recovered record took seq 0 (the failed node took none).
  const reloaded = new ChokepointLedger({ path });
  assert.strictEqual(reloaded.getLoadState(), "LOADED_VERIFIED", "no broken disk chain after fail-then-recover");
  assert.strictEqual(reloaded.length, 1);
  assert.strictEqual(reloaded.verify().valid, true);
  assert.strictEqual(reloaded.getAll()[0].actionId, "f2-b", "only the recovered record is on disk");
  assert.strictEqual(reloaded.getAll()[0].sequenceNumber, 0, "it is seq 0 — the failed node never took a slot");
});

// ══ F8 · closed-shape loading — hostile valid JSON fails to CANNOT_VERIFY ═════

console.log("\n══ F8 · hostile valid JSON is rejected by the closed schema, not cast ══");

check("F8 · a record with an unknown floorKind enum loads to CANNOT_VERIFY", () => {
  const path = freshLedger();
  writeFileSync(
    path,
    JSON.stringify({ actionId: "x", disposition: "PASS_BLIND", floorKind: "NOT_A_KIND", impactClass: "", sensorIds: "", sequenceNumber: 0, previousHash: "", hash: "h" }) + "\n",
    "utf8"
  );
  const led = new ChokepointLedger({ path });
  assert.strictEqual(led.getLoadState(), "CANNOT_VERIFY");
  assert.strictEqual(led.length, 0);
  assert.ok((led.getLastError() ?? "").includes("schema"));
});

check("F8 · an EXTRA field is rejected (closed shape), and a missing field too", () => {
  const extra = freshLedger();
  writeFileSync(
    extra,
    JSON.stringify({ actionId: "x", disposition: "PASS_BLIND", floorKind: "SILENT", impactClass: "", sensorIds: "", sequenceNumber: 0, previousHash: "", hash: "h", EXTRA: 1 }) + "\n",
    "utf8"
  );
  assert.strictEqual(new ChokepointLedger({ path: extra }).getLoadState(), "CANNOT_VERIFY");

  const missing = freshLedger();
  writeFileSync(
    missing,
    JSON.stringify({ actionId: "x", disposition: "PASS_BLIND", floorKind: "SILENT", impactClass: "", sensorIds: "", previousHash: "", hash: "h" }) + "\n",
    "utf8"
  );
  assert.strictEqual(new ChokepointLedger({ path: missing }).getLoadState(), "CANNOT_VERIFY");
});

check("F8 · a wrong-typed sequenceNumber (string) is rejected, not coerced", () => {
  const path = freshLedger();
  writeFileSync(
    path,
    JSON.stringify({ actionId: "x", disposition: "PASS_BLIND", floorKind: "SILENT", impactClass: "", sensorIds: "", sequenceNumber: "0", previousHash: "", hash: "h" }) + "\n",
    "utf8"
  );
  assert.strictEqual(new ChokepointLedger({ path }).getLoadState(), "CANNOT_VERIFY");
});

// ══ §7 · WHAT IT MUST NEVER CLAIM — throws AND fails to compile ═══════════════

console.log("\n══ §7 · scope violations throw at runtime and fail at compile time ══");

check("every out-of-scope claim throws ChokepointScopeViolation", () => {
  const outOfScope = [
    "RELEASE_MEANS_SAFE",
    "SESSION_WAS_SAFE",
    "PAYLOAD_TRUTH",
    "JUDGED_EVERY_ACTION",
    "POSITIVE_HEALTH_FROM_RELEASES",
  ];
  for (const subject of outOfScope) {
    assert.throws(
      // routed through a string so the runtime guard, not the type, is exercised
      () => claimFromDisposition("RELEASE", subject as never),
      (err: unknown) =>
        err instanceof ChokepointScopeViolation && err.message.includes("OUT OF SCOPE"),
      `claimFromDisposition(..., "${subject}") should have thrown`
    );
  }
});
check("an in-scope claim is supported and branded", () => {
  const c = claimFromDisposition("RELEASE", "ACTION_WAS_ROUTED_AND_READ");
  assert.strictEqual(c.subject, "ACTION_WAS_ROUTED_AND_READ");
  assert.ok(c.statement.includes("routed"));
});
check("the compile-time fence is real (tsc --noEmit checks the @ts-expect-error below)", () => {
  // The forbidden §7 subjects are a distinct union, NOT assignable to the
  // in-scope claim type. So consumer code parameterised on an in-scope claim
  // cannot be handed a forbidden one — it is a type error, which tsc --noEmit
  // over src/** enforces. If this ever stopped erroring, TS2578 would fail the
  // build on the unused directive.
  // @ts-expect-error — PAYLOAD_TRUTH is not a DispositionInScopeClaim
  const forbidden: DispositionInScopeClaim = "PAYLOAD_TRUTH";
  void forbidden;
});

// ══ §8 · the routing precondition is STAMPED, not verified ════════════════════

console.log("\n══ §8 · routing precondition stamped, never verified ══");

check("the render carries the routing precondition and does not pretend to check it", () => {
  const cp = new Chokepoint({ line: LINE, floorTrail: freshFloorTrail() });
  const r = cp.guard(A("rt"), [SIG_SILENT, ENG_SILENT], null);
  const text = renderDisposition(r);
  assert.ok(text.includes("DOES NOT JUDGE ACTIONS NOT ROUTED TO IT"));
  assert.ok(ROUTING_PRECONDITION.includes("CANNOT verify about"));
  assert.ok(text.includes("RELEASE means NO UN-HEALTH WAS DETECTED"));
});

// ══ the floor reading's own rendered line (S83 · C5) ══════════════════════════
//
// `floorTrailDetail` is null on a durable append and null when no trail is
// wired, so a non-null value is always a real failure — and since S83 it names
// the append lock path, which is the operator's remedy.
//
// It used to reach a reader only through `⚠ NARROWED BY DELIVERY`, and only when
// the raw disposition was an EXECUTING one. A raw HOLD or HOLD-BLIND whose floor
// reading failed got `narrowed: false` from narrowForDisposition — the action was
// already held — so the note was computed and thrown away unprinted. That was the
// silent case, and a hold is exactly what a failed floor reading forces.

console.log("\n══ S83 · the floor reading is printed for EVERY disposition ══");

const LOCKED_LABEL = "FLOOR READING NOT DURABLE:";

/** A trail whose append is blocked by a lock file stranded before construction. */
function lockedFloorTrail(stem: string): { trail: FloorTrail; lockPath: string } {
  const path = join(root, `${stem}-${counter++}.jsonl`);
  const lockPath = appendLockPath(path);
  writeFileSync(lockPath, "", "utf8");
  return { trail: new FloorTrail({ path }), lockPath };
}

check("a blocked append names the lock path on a HELD disposition — the silent case", () => {
  const { trail, lockPath } = lockedFloorTrail("held-blocked");
  const cp = new Chokepoint({ line: LINE, floorTrail: trail });
  const r = cp.guard(A("held-blocked"), [SIG_SILENT, ENG_BLIND], { impactClass: "high" });

  // Raw HOLD-BLIND: already held, so narrowForDisposition does NOT narrow, and
  // the ⚠ line does not print. This is the case that printed nothing before S83.
  assert.strictEqual(r.disposition, "HOLD_BLIND");
  assert.strictEqual(r.narrowed, false, "a held disposition should not report narrowing");
  assert.strictEqual(r.floorTrailRecorded, false);
  assert.notStrictEqual(r.floorTrailDetail, null);

  const text = renderDisposition(r);
  assert.ok(text.includes(LOCKED_LABEL), "the floor-reading line did not print");
  assert.ok(text.includes(lockPath), `the rendered block does not name the lock path:\n${text}`);
  assert.ok(
    text.includes("no expiry and no timer will ever clear it"),
    "the operator's remedy did not reach the rendered block"
  );
  assert.ok(
    !text.includes("⚠ NARROWED BY DELIVERY"),
    "this case must not narrow — if it does, the test no longer covers the silent path"
  );
});

check("a blocked append names the lock path on an EXECUTING raw disposition too", () => {
  const { trail, lockPath } = lockedFloorTrail("release-blocked");
  const cp = new Chokepoint({ line: LINE, floorTrail: trail });
  const r = cp.guard(A("release-blocked"), [SIG_SILENT, ENG_SILENT], { impactClass: "low" });

  // Raw RELEASE -> narrowed to HOLD-BLIND. Here the ⚠ line DOES print and already
  // carried the detail before S83. The labelled line prints anyway, deliberately:
  // suppressing it would couple this renderer to narrowForDisposition's flag.
  assert.strictEqual(r.disposition, "HOLD_BLIND");
  assert.strictEqual(r.narrowed, true);
  assert.strictEqual(r.execute, false);

  const text = renderDisposition(r);
  assert.ok(text.includes("⚠ NARROWED BY DELIVERY"));
  assert.ok(text.includes(LOCKED_LABEL), "the floor-reading line did not print");
  assert.ok(text.includes(lockPath));
});

check("a DURABLE floor reading prints no such line — absence stays quiet", () => {
  const cp = new Chokepoint({ line: LINE, floorTrail: freshFloorTrail() });
  const r = cp.guard(A("durable"), [SIG_SILENT, ENG_SILENT], { impactClass: "low" });
  assert.strictEqual(r.floorTrailRecorded, true);
  assert.strictEqual(r.floorTrailDetail, null);

  const text = renderDisposition(r);
  assert.ok(
    !text.includes(LOCKED_LABEL),
    `a durable reading printed a failure label:\n${text}`
  );
  assert.ok(!text.includes("FLOOR READING"), "an empty label leaked into the block");
});

check("an UNWIRED trail prints no such line either — null is not a failure string", () => {
  const cp = new Chokepoint({ line: LINE });
  const r = cp.guard(A("unwired"), [SIG_SILENT, ENG_BLIND], { impactClass: "high" });
  assert.strictEqual(r.floorTrailRecord, null);
  assert.strictEqual(r.floorTrailRecorded, false);
  assert.strictEqual(r.floorTrailDetail, null, "an unwired trail must not fabricate a detail");

  const text = renderDisposition(r);
  assert.ok(
    !text.includes(LOCKED_LABEL),
    `an unwired run printed a failure label:\n${text}`
  );
  assert.ok(!text.includes("FLOOR READING"), "an empty label leaked into the block");
});

check("the floor-reading line is NOT the RECORDED: line — two books, two failures", () => {
  const { trail, lockPath } = lockedFloorTrail("passblind-blocked");
  const ledger = new ChokepointLedger({ path: freshLedger() });
  const cp = new Chokepoint({ line: LINE, ledger, floorTrail: trail });
  const r = cp.guard(A("passblind-blocked"), [SIG_SILENT, ENG_BLIND], {
    impactClass: "low",
  });

  const text = renderDisposition(r);
  const floorLine = text.split("\n").find((l) => l.includes(LOCKED_LABEL));
  const recordedLine = text.split("\n").find((l) => l.trim().startsWith("RECORDED:"));
  assert.notStrictEqual(floorLine, undefined, "the floor-reading line did not print");
  assert.ok((floorLine as string).includes(lockPath));
  if (recordedLine !== undefined) {
    assert.ok(
      !recordedLine.includes(lockPath),
      "the ledger's RECORDED: line absorbed the trail's lock path"
    );
    assert.notStrictEqual(floorLine, recordedLine);
  }
});

// ══ correction 1 · the third reader is BRIDGED, not assumed a SensorVerdict ══

console.log("\n══ correction 1 · the clerk1.gap adapter (brief §2 was wrong) ══");

check("GAP_OBSERVED -> ALARM, stops become findings", () => {
  const g: GapReadShape = {
    kind: "GAP_OBSERVED",
    instrumentId: "clerk1.gap",
    summary: "1 silence episode",
    stops: [{ object: "SUBMITTER_SILENT", question: "WHICH CHANNEL: probe-a. HOW LONG: 5000 ms." }],
    blind: [],
  };
  const v = gapReadToVerdict(g);
  assert.strictEqual(v.kind, "ALARM");
  assert.strictEqual(v.sensorId, "clerk1.gap");
  if (v.kind === "ALARM") assert.strictEqual(v.findings[0].code, "GAP_SUBMITTER_SILENT");
});
check("NO_GAP_OBSERVED -> SILENT, preserving its own not-health words", () => {
  const g: GapReadShape = {
    kind: "NO_GAP_OBSERVED",
    instrumentId: "clerk1.gap",
    summary: "no silence episode exceeded its cadence. NO_GAP_OBSERVED is an ABSENCE OF FINDING",
  };
  const v = gapReadToVerdict(g);
  assert.strictEqual(v.kind, "SILENT");
  assert.ok(v.summary.includes("ABSENCE OF FINDING"));
});
check("CANNOT_ASSESS_CADENCE -> CANNOT_ASSESS, gap class preserved in detail", () => {
  const g = cannotAssessCadenceRead(); // structurally readGaps([], {now}) -> NO_RECORDS
  assert.strictEqual(g.kind, "CANNOT_ASSESS_CADENCE");
  const v = gapReadToVerdict(g);
  assert.strictEqual(v.kind, "CANNOT_ASSESS");
  if (v.kind === "CANNOT_ASSESS") {
    assert.strictEqual(v.blindPaths[0].class, "INELIGIBLE_SCOPE");
    assert.ok(v.blindPaths[0].detail.includes("[gap:NO_RECORDS]"));
  }
});
// X3-01 · every named gap-blind class maps to its own MICA class (index.ts mapGapBlindClass)
for (const [gapClass, micaClass] of [
  ["STORE_BREAK", "BROKEN_CHAIN"],
  ["CHAIN_UNVERIFIED", "BROKEN_CHAIN"],
  ["NO_CADENCE_DECLARED", "MISSING_CONFIGURATION"],
  ["SUBMITTER_UNAUTHENTICATED", "MISSING_CONFIGURATION"],
] as const) {
  check(`X3-01 · CANNOT_ASSESS_CADENCE blind ${gapClass} -> blindPath class ${micaClass}`, () => {
    const v = gapReadToVerdict({
      kind: "CANNOT_ASSESS_CADENCE",
      instrumentId: "clerk1.gap",
      summary: "cannot read the cadence",
      blind: [{ class: gapClass, channel: "probe-a", detail: "x3 arm" }],
    });
    assert.strictEqual(v.kind, "CANNOT_ASSESS");
    if (v.kind === "CANNOT_ASSESS") {
      assert.strictEqual(v.blindPaths.length, 1);
      assert.strictEqual(v.blindPaths[0].class, micaClass);
      assert.ok(v.blindPaths[0].detail.includes(`[gap:${gapClass}]`));
    }
  });
}
check("X3-02 · GAP_OBSERVED with blind entries -> ALARM carrying GAP_SCOPE_UNREAD findings", () => {
  const v = gapReadToVerdict({
    kind: "GAP_OBSERVED",
    instrumentId: "clerk1.gap",
    summary: "1 silence episode, 1 channel unread",
    stops: [{ object: "SUBMITTER_SILENT", question: "WHICH CHANNEL: probe-a." }],
    blind: [{ class: "STORE_BREAK", channel: "probe-b", detail: "the chain broke" }],
  });
  assert.strictEqual(v.kind, "ALARM");
  if (v.kind === "ALARM") {
    assert.deepStrictEqual(v.findings.map((f) => f.code), ["GAP_SUBMITTER_SILENT", "GAP_SCOPE_UNREAD"]);
    assert.ok(v.findings[1].detail.includes("[gap:STORE_BREAK]"));
    assert.ok(v.findings[1].detail.includes("[channel probe-b]"));
  }
});
check("X3-02 · CANNOT_ASSESS_CADENCE with an empty blind list -> CANNOT_ASSESS, summary as the sole blind path", () => {
  const v = gapReadToVerdict({
    kind: "CANNOT_ASSESS_CADENCE",
    instrumentId: "clerk1.gap",
    summary: "x3 empty-blind summary",
    blind: [],
  });
  assert.strictEqual(v.kind, "CANNOT_ASSESS");
  if (v.kind === "CANNOT_ASSESS") {
    assert.strictEqual(v.blindPaths.length, 1);
    assert.strictEqual(v.blindPaths[0].class, "INELIGIBLE_SCOPE");
    assert.strictEqual(v.blindPaths[0].detail, "x3 empty-blind summary");
  }
});

// ══ integration · the three built readers, wired through the floor ════════════

console.log("\n══ integration · Sig + Eng + clerk1.gap, composed ══");

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
  const path = join(root, `log-${counter++}.jsonl`);
  try {
    appendAll(new MicaFixtureLog({ path }), specs);
    const loaded = new MicaFixtureLog({ path });
    if (loaded.getLoadState() !== "LOADED_VERIFIED") {
      throw new Error(`FIXTURE BROKEN: ${loaded.getLoadState()}`);
    }
    return fn(loaded);
  } finally {
    rmSync(path, { force: true });
  }
}
const T0 = 1_700_000_000_000;
const GATE: readonly string[] = ["LOADED_VERIFIED"];
const TEST_MAP: PreconditionMap = { escalation_active: ["escalation_granted"] };
const SIG_CFG: SigConfig = { readableLoadStates: GATE, clockToleranceMs: 0, preconditionMap: TEST_MAP };
const CLASSES = [
  { moduleId: "m3", eventType: "canary_check" },
  { moduleId: "m5", eventType: "drift_sample" },
  { moduleId: "m7", eventType: "permission_check" },
];
function specs(n: number, outcomeOf: (i: number) => string): Spec[] {
  const out: Spec[] = [];
  for (let i = 0; i < n; i++) {
    const c = CLASSES[i % CLASSES.length];
    out.push({ moduleId: c.moduleId, eventType: c.eventType, outcome: outcomeOf(i), timestamp: T0 + i });
  }
  return out;
}
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
};
const CLEAN_SPECS: readonly Spec[] = [
  { timestamp: T0 + 0, eventType: "boot", outcome: "ok" },
  { timestamp: T0 + 10, eventType: "escalation_granted", outcome: "granted" },
  { timestamp: T0 + 20, eventType: "escalation_active", outcome: "active" },
  { timestamp: T0 + 30, eventType: "canary_check", outcome: "clean" },
];
const INVERTED: readonly Spec[] = [
  { timestamp: T0 + 500, eventType: "a", outcome: "ok" },
  { timestamp: T0 + 100, eventType: "b", outcome: "ok" },
];
const HEALTHY = specs(90, (i) => (i % 4 === 0 ? "deferred" : `verdict_class_${i % CLASSES.length}`));
// One outcome value regardless of event class -> AMI at the floor -> Eng ALARM
// (the collapse arm; matches the frozen eng/flattened-collapse fixture).
const FLATTENED = specs(60, () => "approved");

check("real Sig SILENT + real Eng SILENT + gap NO_GAP -> RELEASE (executes)", () => {
  withDurable(CLEAN_SPECS, (sigLog) =>
    withDurable(HEALTHY, (engLog) => {
      const sig = assessSig(sigLog, SIG_CFG).verdict;
      const eng = assessEng(engLog, ENG_CFG).verdict;
      const gap = gapReadToVerdict({
        kind: "NO_GAP_OBSERVED",
        instrumentId: "clerk1.gap",
        summary: "no gap. NO_GAP_OBSERVED is an ABSENCE OF FINDING",
      });
      assert.strictEqual(sig.kind, "SILENT");
      assert.strictEqual(eng.kind, "SILENT");
      const cp = new Chokepoint({ line: LINE, floorTrail: freshFloorTrail() });
      const r = cp.guard(A("int-release"), [sig, eng, gap], { impactClass: "high" });
      assert.strictEqual(r.disposition, "RELEASE");
      assert.strictEqual(r.execute, true);
    })
  );
});
check("real Sig ALARM anywhere -> HOLD regardless of the other two and of stakes", () => {
  withDurable(INVERTED, (sigLog) => {
    const sig = assessSig(sigLog, SIG_CFG).verdict;
    assert.strictEqual(sig.kind, "ALARM");
    const cp = new Chokepoint({ line: LINE });
    const r = cp.guard(A("int-hold"), [sig, ENG_SILENT], { impactClass: "trivial" });
    assert.strictEqual(r.disposition, "HOLD");
    assert.strictEqual(r.execute, false);
  });
});
check("real Sig SILENT + real gap CANNOT_ASSESS, high stakes -> HOLD-BLIND", () => {
  withDurable(CLEAN_SPECS, (sigLog) => {
    const sig = assessSig(sigLog, SIG_CFG).verdict;
    const gap = gapReadToVerdict(cannotAssessCadenceRead()); // CANNOT_ASSESS
    const cp = new Chokepoint({
      line: LINE,
      ledger: new ChokepointLedger({ path: freshLedger() }),
    });
    const r = cp.guard(A("int-hb"), [sig, gap], { impactClass: "critical" });
    assert.strictEqual(r.decision.floorKind, "CANNOT_ASSESS");
    assert.strictEqual(r.disposition, "HOLD_BLIND");
    assert.strictEqual(r.execute, false);
  });
});

// Brief case 3 — Eng collapse (AMI at the floor) drives HOLD, end to end through
// a REAL assessEng read, not a synthetic verdict.
check("real Eng COLLAPSE (AMI at the floor) -> HOLD, end to end", () => {
  withDurable(FLATTENED, (engLog) => {
    const eng = assessEng(engLog, ENG_CFG).verdict;
    assert.strictEqual(eng.kind, "ALARM", "collapsed signature must ALARM");
    const cp = new Chokepoint({ line: LINE });
    const r = cp.guard(A("int-eng-hold"), [SIG_SILENT, eng], { impactClass: "trivial" });
    assert.strictEqual(r.decision.floorKind, "ALARM");
    assert.strictEqual(r.disposition, "HOLD");
    assert.strictEqual(r.execute, false);
  });
});

// Brief case 5 — non-compensatory floor, both directions, with REAL co-readers:
// one ALARM floors the composite even when the OTHER sensor genuinely reads clean.
check("non-compensatory: real Eng ALARM floors it even when real Sig is SILENT", () => {
  withDurable(CLEAN_SPECS, (sigLog) =>
    withDurable(FLATTENED, (engLog) => {
      const sig = assessSig(sigLog, SIG_CFG).verdict; // SILENT
      const eng = assessEng(engLog, ENG_CFG).verdict; // ALARM
      assert.strictEqual(sig.kind, "SILENT");
      assert.strictEqual(eng.kind, "ALARM");
      const cp = new Chokepoint({ line: LINE });
      const r = cp.guard(A("int-noncomp-eng"), [sig, eng], { impactClass: "trivial" });
      assert.strictEqual(r.decision.floorKind, "ALARM");
      assert.strictEqual(r.disposition, "HOLD");
    })
  );
});
check("non-compensatory: real Sig ALARM floors it even when real Eng is SILENT (high stakes)", () => {
  withDurable(INVERTED, (sigLog) =>
    withDurable(HEALTHY, (engLog) => {
      const sig = assessSig(sigLog, SIG_CFG).verdict; // ALARM
      const eng = assessEng(engLog, ENG_CFG).verdict; // SILENT
      assert.strictEqual(sig.kind, "ALARM");
      assert.strictEqual(eng.kind, "SILENT");
      const cp = new Chokepoint({ line: LINE });
      // critical stakes cannot buy the alarm back — HOLD, not any blind pass.
      const r = cp.guard(A("int-noncomp-sig"), [sig, eng], { impactClass: "critical" });
      assert.strictEqual(r.decision.floorKind, "ALARM");
      assert.strictEqual(r.disposition, "HOLD");
    })
  );
});

// Brief case 4 — a REAL sensor CANNOT_ASSESS (Eng, missing threshold) yields a
// blind disposition, NEVER RELEASE, on both sides of the stakes line.
check("real Eng CANNOT_ASSESS (missing config) -> blind, never RELEASE", () => {
  withDurable(HEALTHY, (engLog) => {
    const eng = assessEng(engLog, { readableLoadStates: GATE }).verdict; // no threshold
    assert.strictEqual(eng.kind, "CANNOT_ASSESS");
    const cp = new Chokepoint({
      line: LINE,
      ledger: new ChokepointLedger({ path: freshLedger() }),
      floorTrail: freshFloorTrail(),
    });
    const hi = cp.guard(A("int-eng-blind-hi"), [SIG_SILENT, eng], { impactClass: "critical" });
    assert.strictEqual(hi.decision.floorKind, "CANNOT_ASSESS");
    assert.notStrictEqual(hi.disposition, "RELEASE");
    assert.strictEqual(hi.disposition, "HOLD_BLIND");
    const lo = cp.guard(A("int-eng-blind-lo"), [SIG_SILENT, eng], { impactClass: "trivial" });
    assert.notStrictEqual(lo.disposition, "RELEASE");
    assert.strictEqual(lo.disposition, "PASS_BLIND");
  });
});

// ── sample render, so a reviewer sees what a reader sees ──────────────────────

console.log("\n══ sample: a PASS-BLIND disposition, rendered ══\n");
{
  const ledger = new ChokepointLedger({ path: freshLedger() });
  const notifier = new BatchedNotifier({ window: 1 });
  const cp = new Chokepoint({ line: LINE, ledger, notifier, floorTrail: freshFloorTrail() });
  const r = cp.guard(A("sample-action"), [SIG_SILENT, ENG_BLIND], { impactClass: "low" });
  console.log(renderDisposition(r));
}

rmSync(root, { recursive: true, force: true });


// ── CL-S103 · a look that was REFUSED is not a book that is ABSENT ─────────
//
// The class closed in `ruling-log.ts` at S98 and left open in five sibling books
// until S103. `existsSync` returns false both for "no such file" and for "not
// allowed to look"; this book read the second as the first, called it
// FIRST_BOOT_OR_ERASED, and — because `mkdirSync(..., { recursive: true })`
// SUCCEEDS on a directory that exists and cannot be entered — set itself
// persisting over content it never read.

check("CL-S103-1 · the look has three answers, and only ENOENT means absent", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-cl-look-"));
  const present = join(base, "present.jsonl");
  writeFileSync(present, "", "utf8");
  assert.deepStrictEqual(lookAtLedgerFile(present), { state: "PRESENT" });
  assert.deepStrictEqual(lookAtLedgerFile(join(base, "nope.jsonl")), { state: "ABSENT" });

  // ENAMETOOLONG: a refusal every principal reaches, uid 0 included.
  const refused = lookAtLedgerFile(join(base, "x".repeat(300)));
  assert.strictEqual(refused.state, "CANNOT_SEE", "a name too long read as merely absent");
  assert.ok(refused.state === "CANNOT_SEE" && refused.detail.includes("ENAMETOOLONG"));
  rmSync(base, { recursive: true, force: true });
});

check("CL-S103-2 · a book it CANNOT SEE loads to CANNOT_VERIFY, never to first boot", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-cl-cannotsee-"));
  const path = join(base, "x".repeat(300));
  const book = new ChokepointLedger({ path });
  assert.strictEqual(
    book.getLoadState(),
    "CANNOT_VERIFY",
    "a book this process cannot look at came up as a first boot"
  );
  const detail = book.getLastError() ?? "";
  assert.ok(detail.includes("NOT the finding that it is absent"), detail);
  assert.ok(detail.includes("nothing was recorded as a first boot"), detail);
  rmSync(base, { recursive: true, force: true });
});

check("CL-S103-3 · THE REAL SHAPE — a directory whose execute bit is stripped", () => {
  // The live instrument, and the one the mkdir defence dies on: the directory
  // EXISTS, holds a real book, and cannot be entered. `mkdirSync` recursive
  // returns cleanly here, so nothing downstream of the look would have caught it.
  //
  // A mode-based refusal cannot be built for uid 0, which is allowed to traverse
  // regardless. This body SAYS so rather than passing over a check that never
  // ran; CL-S103-1 and -2 reach the same branch by another errno for every
  // principal.
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === 0 || uid === null) {
    console.log(
      "      NOT EXERCISED as this principal: a mode-based refusal cannot be " +
        "built for uid 0. The classification and the load state are covered by " +
        "CL-S103-1..2; this body covers only the mode."
    );
    return;
  }
  const base = mkdtempSync(join(tmpdir(), "mica-cl-noexec-"));
  const dir = join(base, "book");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "book.jsonl");
  writeFileSync(path, "", "utf8");
  chmodSync(dir, 0o600); // readable, NOT searchable
  try {
    const look = lookAtLedgerFile(path);
    assert.strictEqual(look.state, "CANNOT_SEE", "a directory with no execute bit did not refuse the look");
    assert.ok(look.state === "CANNOT_SEE" && look.detail.includes("EACCES"));
    const book = new ChokepointLedger({ path });
    assert.strictEqual(book.getLoadState(), "CANNOT_VERIFY");
    assert.ok((book.getLastError() ?? "").includes("EACCES"));
  } finally {
    chmodSync(dir, 0o700);
    rmSync(base, { recursive: true, force: true });
  }
});

// ── T27 · F6 IN THE FLOOR: an act whose reader THREW is held, whatever the line ──
//
// FORK-2 is the arbiter's and unruled at this build; built as (a): HOLD_BLIND with holdReason READER_THREW, the
// grammar frozen at four. The trigger is the readerThrows list the wiring hands in — never the blind class, never a
// CANNOT_ASSESS floor as such.

const T27_THROW: ReaderThrow = { reader: "MICA/fixture-reader", code: "FIXTURE_THREW", errorClass: "RangeError" };
const T27_OWN_NET: ReaderThrow = { reader: "MICA/fixture-gate", code: "G4_READER_THREW", errorClass: null };

check("T27-C1 · CONTROL — a blind floor below the line with NO throw is PASS_BLIND, holdReason null, readerThrows []", () => {
  const d = decideChokepoint(A("t27-control"), [SIG_SILENT, ENG_BLIND], { impactClass: "low" }, LINE);
  assert.strictEqual(d.disposition, "PASS_BLIND");
  assert.strictEqual(d.executeRaw, true);
  assert.strictEqual(d.blindSplit, "BELOW_LINE");
  assert.strictEqual(d.holdReason, null);
  assert.deepStrictEqual(d.readerThrows, []);
  assert.ok(!d.rationale.includes("READER_THREW"), d.rationale);
});

check("T27-C2 · a throw below the line -> HOLD_BLIND, executeRaw false, blindSplit BELOW_LINE as computed, holdReason READER_THREW, named", () => {
  const d = decideChokepoint(A("t27-below"), [SIG_SILENT, ENG_BLIND], { impactClass: "low" }, LINE, [T27_THROW]);
  assert.strictEqual(d.disposition, "HOLD_BLIND");
  assert.strictEqual(d.executeRaw, false);
  assert.strictEqual(d.blindSplit, "BELOW_LINE");
  assert.strictEqual(d.holdReason, "READER_THREW");
  assert.deepStrictEqual(d.readerThrows, [T27_THROW]);
  assert.ok(d.rationale.includes(READER_THREW_HOLDS), d.rationale);
  assert.ok(d.rationale.includes("MICA/fixture-reader · FIXTURE_THREW (RangeError)"), d.rationale);
  assert.ok(d.rationale.includes("would have PASSED this act blind"), d.rationale);
});

check("T27-C3 · a reader's OWN net counts like a seam catch (class null printed as the reader's own)", () => {
  const d = decideChokepoint(A("t27-own"), [ENG_BLIND], { impactClass: "trivial" }, LINE, [T27_OWN_NET]);
  assert.strictEqual(d.disposition, "HOLD_BLIND");
  assert.strictEqual(d.holdReason, "READER_THREW");
  assert.ok(d.rationale.includes("G4_READER_THREW (class in the reader's own detail)"), d.rationale);
});

check("T27-C4 · above the line -> HOLD_BLIND either way; with a throw the 'already held' wording and the reason", () => {
  const d = decideChokepoint(A("t27-above"), [ENG_BLIND], { impactClass: "high" }, LINE, [T27_THROW]);
  assert.strictEqual(d.disposition, "HOLD_BLIND");
  assert.strictEqual(d.blindSplit, "ABOVE_LINE");
  assert.strictEqual(d.holdReason, "READER_THREW");
  assert.ok(d.rationale.includes("already held by the stakes split"), d.rationale);
});

check("T27-C5 · A THROW NEVER LOWERS: ALARM + a throw -> HOLD, every ALARM finding kept, the throw named beside it", () => {
  const d = decideChokepoint(A("t27-alarm"), [SIG_ALARM, ENG_BLIND], { impactClass: "trivial" }, LINE, [T27_THROW]);
  assert.strictEqual(d.disposition, "HOLD");
  assert.strictEqual(d.floorKind, "ALARM");
  assert.deepStrictEqual(d.findings, SIG_ALARM.kind === "ALARM" ? SIG_ALARM.findings : []);
  assert.strictEqual(d.holdReason, null);
  assert.ok(d.rationale.includes("named beside the ALARM") && d.rationale.includes("FIXTURE_THREW"), d.rationale);
});

check("T27-C6 · a throw on a SILENT floor (a caller that names a throw it composed nothing for) still never executes", () => {
  const d = decideChokepoint(A("t27-silent"), [SIG_SILENT, ENG_SILENT], null, LINE, [T27_THROW]);
  assert.strictEqual(d.disposition, "HOLD_BLIND");
  assert.strictEqual(d.executeRaw, false);
  assert.strictEqual(d.blindSplit, "NOT_APPLICABLE");
  assert.strictEqual(d.holdReason, "READER_THREW");
});

check("T27-C7 · holdForReaderThrows is the identity with no throws, and the grammar is still FOUR", () => {
  for (const m of [
    mapFloorToDisposition("SILENT", null, LINE),
    mapFloorToDisposition("ALARM", null, LINE),
    mapFloorToDisposition("CANNOT_ASSESS", { impactClass: "low" }, LINE),
    mapFloorToDisposition("CANNOT_ASSESS", { impactClass: "high" }, LINE),
  ]) {
    assert.deepStrictEqual(holdForReaderThrows(m, []), { ...m, holdReason: null });
  }
  assert.deepStrictEqual(Object.keys(DISPOSITION_LABEL).sort(), ["HOLD", "HOLD_BLIND", "PASS_BLIND", "RELEASE"]);
});

check("T27-C8 · the decision COPIES the list: a caller's later push cannot move a decision already taken", () => {
  const list: ReaderThrow[] = [];
  const d = decideChokepoint(A("t27-copy"), [ENG_BLIND], { impactClass: "low" }, LINE, list);
  list.push(T27_THROW);
  assert.strictEqual(d.disposition, "PASS_BLIND");
  assert.deepStrictEqual(d.readerThrows, []);
});

check("T27-C9 · Chokepoint.guard with readerThrows below the line: non-executing, NO PASS-BLIND record, the trail reads HOLD_BLIND", () => {
  const ledgerPath = freshLedger();
  const trail = freshFloorTrail();
  const cp = new Chokepoint({ line: LINE, ledger: new ChokepointLedger({ path: ledgerPath }), floorTrail: trail, readerThrows: [T27_THROW] });
  const r = cp.guard(A("t27-guard"), [SIG_SILENT, ENG_BLIND], { impactClass: "low" });
  assert.strictEqual(r.disposition, "HOLD_BLIND");
  assert.strictEqual(r.execute, false);
  assert.strictEqual(r.narrowed, false);
  assert.strictEqual(r.record, null);
  assert.strictEqual(r.recorded, false);
  assert.strictEqual(r.notice, null);
  assert.ok(r.floorTrailRecord !== null && r.floorTrailRecord.disposition === "HOLD_BLIND");
  assert.strictEqual(new ChokepointLedger({ path: ledgerPath }).getAll().length, 0, "a PASS-BLIND record was written for a held act");
  const text = renderDisposition(r);
  assert.ok(text.includes("HOLD REASON: READER_THREW"), text);
  assert.ok(text.includes("READER THREW: MICA/fixture-reader · FIXTURE_THREW (RangeError)"), text);
});

check("T27-C10 · CONTROL through guard: the same act with readerThrows absent is PASS_BLIND, recorded", () => {
  const cp = new Chokepoint({ line: LINE, ledger: new ChokepointLedger({ path: freshLedger() }), floorTrail: freshFloorTrail() });
  const r = cp.guard(A("t27-guard-control"), [SIG_SILENT, ENG_BLIND], { impactClass: "low" });
  assert.strictEqual(r.disposition, "PASS_BLIND");
  assert.strictEqual(r.execute, true);
  assert.strictEqual(r.recorded, true);
  assert.strictEqual(r.decision.holdReason, null);
  assert.ok(!renderDisposition(r).includes("HOLD REASON"));
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
