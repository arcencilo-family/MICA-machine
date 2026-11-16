// ──────────────────────────────────────────────────────────────────────────────
// MICA — the SUBSTRATE-ERA SEMANTIC SNAPSHOT (F9)
//   npx ts-node src/mica/substrate-snapshot.test.ts
//
// WHY THIS FILE EXISTS
//
//   verdict-logic.frozen.json freezes assessSig/assessEng verdicts BYTE-FOR-BYTE,
//   including their full prose summaries. That is the right freeze for those two
//   readers, but the review (F9) named its limits: it does NOT freeze the W/R/K
//   composite verdicts, the chokepoint disposition matrix, the stakes-line split,
//   the delivery/ledger-failure narrowing, or the clerk-gap adapter — so "frozen
//   verdict logic" reads more broadly than that one artifact guarantees.
//
//   This is the ADDITIVE second snapshot F9 asks for. It freezes the ACTUAL GATE
//   SURFACE over STABLE PROJECTIONS ONLY — verdict kind, finding codes, blind-path
//   classes, floor kind, disposition, execute — and deliberately NOT prose. A
//   summary reword does not break it; a semantic change to the gate does. It is a
//   separate file from the historical baseline, which stays byte-identical and
//   hash-pinned (asserted in verdict-logic.test.ts).
//
//   FIRST RUN captures the baseline (an additive baseline has to start somewhere,
//   and this is the legitimate capture, not a re-freeze-to-green). Every run after
//   compares and fails on any semantic drift.
// ──────────────────────────────────────────────────────────────────────────────

import assert from "assert";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { MicaFixtureLog } from "./fixture-log";
import { assessSig } from "./sig";
import { assessEng } from "./eng";
import { assessNarrowW, NARROW_W_LEG2_PROXY_CALIBRATION } from "./narrow-w";
import { assessNarrowR, NARROW_R_PROXY_CALIBRATION } from "./narrow-r";
import { assessNarrowK, NARROW_K_PROXY_CALIBRATION } from "./narrow-k";
import { assessNarrowT, NARROW_T_PROXY_CALIBRATION } from "./narrow-t";
import type { ClerkClockStamp, SigConfig, PreconditionMap } from "./sig";
import type { EngConfig } from "./eng";
import type { NarrowWConfig } from "./narrow-w";
import type { NarrowRConfig } from "./narrow-r";
import type { NarrowKConfig } from "./narrow-k";
import type { NarrowTConfig } from "./narrow-t";
import type { AlarmVerdict, CannotAssessVerdict, SensorVerdict } from "./types";
import {
  Chokepoint,
  ChokepointLedger,
  FloorTrail,
  decideChokepoint,
  gapReadToVerdict,
  narrowForDisposition,
} from "./chokepoint";
import type { GapReadShape, StakesLine } from "./chokepoint";
import { narrowForDelivery } from "./export";
import type { ExportOutcome } from "./export";

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

// ── stable projections (NO prose) ─────────────────────────────────────────────

function projVerdict(v: SensorVerdict): Record<string, unknown> {
  const out: Record<string, unknown> = { kind: v.kind };
  if (v.kind === "ALARM") {
    out.findingCodes = (v as AlarmVerdict).findings.map((f) => f.code).sort();
  }
  if (v.kind === "CANNOT_ASSESS") {
    out.blindClasses = (v as CannotAssessVerdict).blindPaths.map((b) => b.class).sort();
  }
  return out;
}

function projDisposition(floorKind: string, disposition: string, execute: boolean, blindSplit: string): Record<string, unknown> {
  return { floorKind, disposition, execute, blindSplit };
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const root = mkdtempSync(join(tmpdir(), "mica-snap-"));
let counter = 0;
const T0 = 1_700_000_000_000;
const GATE: readonly string[] = ["LOADED_VERIFIED"];
const LINE: StakesLine = { classes: ["trivial", "low", "medium", "high", "critical"], holdAtOrAbove: "medium" };

interface Spec { eventType: string; outcome: string; moduleId?: string; timestamp?: number }
function appendAll(log: MicaFixtureLog, specs: readonly Spec[]): void {
  let i = 0;
  for (const s of specs) {
    log.append({ timestamp: s.timestamp ?? T0 + i++, moduleId: s.moduleId ?? "m6", eventType: s.eventType, outcome: s.outcome });
  }
}
function withDurable<T>(specs: readonly Spec[], fn: (log: MicaFixtureLog) => T): T {
  const path = join(root, `log-${counter++}.jsonl`);
  try {
    appendAll(new MicaFixtureLog({ path }), specs);
    const loaded = new MicaFixtureLog({ path });
    if (loaded.getLoadState() !== "LOADED_VERIFIED") throw new Error(`FIXTURE BROKEN: ${loaded.getLoadState()}`);
    return fn(loaded);
  } finally {
    rmSync(path, { force: true });
  }
}

// Sig / Eng fixtures (kinds are what we freeze, not prose).
const SIG_CFG: SigConfig = { readableLoadStates: GATE, clockToleranceMs: 0, preconditionMap: { escalation_active: ["escalation_granted"] } as PreconditionMap };
const SIG_CLEAN: readonly Spec[] = [
  { eventType: "boot", outcome: "ok" },
  { eventType: "escalation_granted", outcome: "granted" },
  { eventType: "escalation_active", outcome: "active" },
];
const SIG_INVERTED: readonly Spec[] = [
  { eventType: "a", outcome: "ok", timestamp: T0 + 500 },
  { eventType: "b", outcome: "ok", timestamp: T0 + 100 },
];
const ENG_CLASSES = [
  { moduleId: "m3", eventType: "e_a" },
  { moduleId: "m5", eventType: "e_b" },
  { moduleId: "m7", eventType: "e_c" },
];
function engSpecs(n: number, outcomeOf: (i: number) => string): Spec[] {
  const out: Spec[] = [];
  for (let i = 0; i < n; i++) {
    const c = ENG_CLASSES[i % ENG_CLASSES.length];
    out.push({ moduleId: c.moduleId, eventType: c.eventType, outcome: outcomeOf(i), timestamp: T0 + i });
  }
  return out;
}
// T11. Injected so the frozen semantic projections keep describing the same
// readings. Omit it and every eng scenario becomes MISSING_CONFIGURATION — the
// snapshot would then be faithfully recording a sensor that never ran.
const ENG_CFG: EngConfig = { readableLoadStates: GATE, structureThreshold: 0.2, minimumSampleSize: 30, minimumClassCoverage: 3, ceilingMargin: 0.02 };
const ENG_HEALTHY = engSpecs(90, (i) => (i % 4 === 0 ? "deferred" : `verdict_class_${i % ENG_CLASSES.length}`));
const ENG_FLATTENED = engSpecs(60, () => "approved");
const ENG_PERFECT = engSpecs(60, (i) => `verdict_class_${i % ENG_CLASSES.length}`);

// W/R/K sibling fixtures — the shared diag/theatre leg-2 tables.
const CONS: readonly string[] = ["con_refuse", "con_limit", "con_boundary"];
const ctx = (k: string): Spec => ({ eventType: `ctx_${k}`, outcome: "o", moduleId: "cx" });
const con = (c: string): Spec => ({ eventType: c, outcome: "o" });
function diag(nDiag: number, nOff: number): Spec[] {
  const specs: Spec[] = [];
  const C = ["1", "2", "3"];
  for (let k = 0; k < 3; k++) {
    for (let d = 0; d < nDiag; d++) { specs.push(ctx(C[k])); specs.push(con(CONS[k])); }
    for (let o = 0; o < nOff; o++) {
      specs.push(ctx(C[k])); specs.push(con(CONS[(k + 1) % 3]));
      specs.push(ctx(C[k])); specs.push(con(CONS[(k + 2) % 3]));
    }
  }
  return specs;
}
function theatre(): Spec[] {
  const specs: Spec[] = [];
  for (const cc of ["1", "2", "3"]) for (let r = 0; r < 6; r++) for (const c of CONS) { specs.push(ctx(cc)); specs.push(con(c)); }
  return specs;
}
const WRK_HEALTHY = diag(8, 2);
const WRK_THEATRE = theatre();
const W_CFG = (p: readonly string[]): NarrowWConfig => ({ readableLoadStates: GATE, declaredProfile: p, correlationThreshold: NARROW_W_LEG2_PROXY_CALIBRATION.correlationThreshold, correlationMinimumInquiryEvents: NARROW_W_LEG2_PROXY_CALIBRATION.correlationMinimumInquiryEvents, correlationCeilingMargin: NARROW_W_LEG2_PROXY_CALIBRATION.correlationCeilingMargin });
const R_CFG = (p: readonly string[]): NarrowRConfig => ({ readableLoadStates: GATE, declaredProfile: p, correlationThreshold: NARROW_R_PROXY_CALIBRATION.correlationThreshold, correlationMinimumVerificationEvents: NARROW_R_PROXY_CALIBRATION.correlationMinimumVerificationEvents, correlationCeilingMargin: NARROW_R_PROXY_CALIBRATION.correlationCeilingMargin });
const KP = NARROW_K_PROXY_CALIBRATION;
const K_CFG = (p?: readonly string[]): NarrowKConfig => ({ readableLoadStates: GATE, declaredProfile: p, correlationThreshold: KP.correlationThreshold, correlationMinimumConstraintEvents: KP.correlationMinimumConstraintEvents, correlationCeilingMargin: KP.correlationCeilingMargin });

// ── build the live snapshot ───────────────────────────────────────────────────

const live: Record<string, unknown> = {};

// A · chokepoint disposition matrix + stakes-line split.
const S = (): SensorVerdict => ({ kind: "SILENT", sensorId: "s", summary: "x" });
const CA = (): SensorVerdict => ({ kind: "CANNOT_ASSESS", sensorId: "s", summary: "x", blindPaths: [{ class: "MISSING_CONFIGURATION", detail: "x" }] });
const AL = (): SensorVerdict => ({ kind: "ALARM", sensorId: "s", summary: "x", findings: [{ code: "X", detail: "y" }] });
function dm(name: string, verdicts: SensorVerdict[], stakes: { impactClass: string } | null, line: StakesLine | null): void {
  const d = decideChokepoint({ id: name }, verdicts, stakes, line);
  live[`choke/${name}`] = projDisposition(d.floorKind, d.disposition, d.executeRaw, d.blindSplit);
}
dm("empty-floor", [], { impactClass: "high" }, LINE);
dm("all-silent", [S(), S()], null, LINE);
dm("any-alarm", [S(), AL()], { impactClass: "trivial" }, LINE);
dm("blind-below-line", [S(), CA()], { impactClass: "low" }, LINE);
dm("blind-above-line", [S(), CA()], { impactClass: "high" }, LINE);
dm("blind-no-line-cautious", [CA()], { impactClass: "trivial" }, null);
dm("alarm-beats-critical-stakes", [AL(), CA()], { impactClass: "critical" }, LINE);

// B · Sig, stable kinds/codes.
live["sig/clean"] = withDurable(SIG_CLEAN, (l) => projVerdict(assessSig(l, SIG_CFG).verdict));
live["sig/f1-inverted"] = withDurable(SIG_INVERTED, (l) => projVerdict(assessSig(l, SIG_CFG).verdict));
live["sig/no-config"] = withDurable(SIG_CLEAN, (l) => projVerdict(assessSig(l, { readableLoadStates: GATE }).verdict));
// T8 · THE EXPECTED CHAIN IS NOW PART OF AN ORDINARY CONFIG. Under T8 a stamp
// joins ONLY when it names the chain this run was told to expect, so a base
// config that injects none would turn every scenario below into a refusal
// scenario and the projections would all read alike.
const F3_CHAIN_LIVE = "chain-LIVE";

// F5: a CONFIGURED-but-blind F3 (unsupported boundary) composes to CANNOT_ASSESS,
// over an F1-clean/F2-clean log so the CANNOT_ASSESS is F3's alone.
const F3_CLEAN_LOG: readonly Spec[] = [
  { eventType: "a", outcome: "ok", timestamp: T0 + 1_000 },
  { eventType: "b", outcome: "ok", timestamp: T0 + 2_000 },
];
live["sig/f3-configured-blind-composes"] = withDurable(F3_CLEAN_LOG, (l) =>
  projVerdict(
    assessSig(l, {
      readableLoadStates: GATE,
      clockToleranceMs: 0,
      preconditionMap: { b: ["a"] },
      // T8 · THE CHAIN IDENTITY IS HERE TO PRESERVE THIS SCENARIO'S INTENT, not
      // to change it. This fixture exists to show an F3 blinded by an
      // UNSUPPORTED BOUNDARY (IN_PROCESS_NO_SEPARATION / LOCAL_CALL), which is
      // a MISSING_CONFIGURATION blind path. Without a chain identity T8 would
      // refuse these stamps first and the projection would read INELIGIBLE_SCOPE
      // — a scenario about separation quietly becoming a scenario about chain
      // identity, with the frozen value moving to say so.
      expectedChainIdentity: F3_CHAIN_LIVE,
      clerkClockSource: [
        { moduleId: "m6", chainIdentity: F3_CHAIN_LIVE, sequenceNumber: 0, clerk_seq: 1, clerk_time: { wall_ms: 1, monotonic_ns: "1" }, separation: "IN_PROCESS_NO_SEPARATION", intake: "LOCAL_CALL", clerk_id: "c", clerk_boot_id: "b" },
        { moduleId: "m6", chainIdentity: F3_CHAIN_LIVE, sequenceNumber: 1, clerk_seq: 2, clerk_time: { wall_ms: 2, monotonic_ns: "2" }, separation: "IN_PROCESS_NO_SEPARATION", intake: "LOCAL_CALL", clerk_id: "c", clerk_boot_id: "b" },
      ],
    }).verdict
  )
);
// F5: an UNCONFIGURED F3 leg is excluded — the clean composite stays SILENT.
live["sig/f3-unconfigured-excluded"] = withDurable(F3_CLEAN_LOG, (l) =>
  projVerdict(assessSig(l, { readableLoadStates: GATE, clockToleranceMs: 0, preconditionMap: { b: ["a"] } }).verdict)
);

// ── T3 · ticket T3-sig-f3-watermark — FOUR NEW PROJECTIONS, nothing moved ────
//
// The existing 40 stay byte-identical; these are ADDED. Ticket condition 3.
// The snapshot's starting sha256 is T1's post-repin 8edcee7a5f7d…, and an
// honest re-freeze shows a from/to pair — because this file RE-CAPTURES A
// MISSING SNAPSHOT SILENTLY AND GREEN (see the capture branch below), with both
// integrity guards skipped on that path, so a green run is NOT by itself proof
// the snapshot is right.
//
// THE MULTI-WRITER FIXTURE IS THE POINT. One ascending sequenceNumber, two
// writers — the shape the live subject chain actually has, and the shape a
// single global watermark cannot express.
const F3_MW_LOG: readonly Spec[] = [
  { eventType: "a", outcome: "ok", moduleId: "w1", timestamp: T0 + 1_000 },
  { eventType: "b", outcome: "ok", moduleId: "w2", timestamp: T0 + 2_000 },
  { eventType: "a", outcome: "ok", moduleId: "w1", timestamp: T0 + 3_000 },
  { eventType: "b", outcome: "ok", moduleId: "w2", timestamp: T0 + 4_000 },
];
const F3_MW_BASE = { readableLoadStates: GATE, clockToleranceMs: 0, preconditionMap: { b: ["a"] } as PreconditionMap, expectedChainIdentity: F3_CHAIN_LIVE };
// T8 · `chain` defaults to the LIVE chain. Before T8 an omitted chain joined and
// was disclosed as unattributed; that arm is gone, so a fixture modelling an
// ORDINARY carry must name its chain the way a T8 carrier does. The scenarios
// that pass a chain explicitly (the retired-chain refusal) are unaffected.
function f3Stamp(seq: number, clerkSeq: number, wall: number, chain: string = F3_CHAIN_LIVE): ClerkClockStamp {
  return {
    // T6 · THE STAMP CARRIES THE RECORD'S OWN WRITER, because that is what the
    // carrier writes (`moduleId: record.moduleId`, mica-clerk-caller.ts:914). Until
    // T6 the join ignored this field, so these fixtures could name any writer and
    // still join. Under T6 a disagreeing stamp is DISCARDED and DISCLOSED, so a
    // fixture modelling an ORDINARY carry must agree. The DELIBERATE mismatch now
    // has its own scenario rather than being every fixture's incidental state.
    moduleId: seq % 2 === 0 ? "w1" : "w2",
    ...(chain === undefined ? {} : { chainIdentity: chain }),
    sequenceNumber: seq,
    clerk_seq: clerkSeq,
    clerk_time: { wall_ms: wall, monotonic_ns: String(wall) },
    separation: "SEPARATE_PROCESS",
    intake: "SOCKET",
    clerk_id: "c",
    clerk_boot_id: "b",
  };
}
const F3_HEAD_STAMPS = [f3Stamp(0, 1, 10_000), f3Stamp(1, 2, 10_001)];

// (1) THE PROOF THE REPAIR DID WHAT IT WAS FOR: an unstamped tail inside the
//     declared bound reads SILENT. Before T3 this fixture was CANNOT_ASSESS on
//     an ordinary working day. It is also the projection that catches a builder
//     who made the tail free in BOTH directions.
live["sig/f3-tail-within-bound-silent"] = withDurable(F3_MW_LOG, (l) =>
  projVerdict(assessSig(l, { ...F3_MW_BASE, clerkClockSource: F3_HEAD_STAMPS, clerkStampLagBoundMs: 30_000, readAtMs: 20_001 }).verdict)
);
// (2) The same tail, beyond the declared bound: AXIS_STALE composes into the floor.
live["sig/f3-stale-axis-composes"] = withDurable(F3_MW_LOG, (l) =>
  projVerdict(assessSig(l, { ...F3_MW_BASE, clerkClockSource: F3_HEAD_STAMPS, clerkStampLagBoundMs: 30_000, readAtMs: 70_001 }).verdict)
);
// (3) A HOLE — w1's seq 0 unstamped BELOW w1's stamped mark at seq 2. The
//     carrier reached past it. A skip is not a lag and must not read clean.
live["sig/f3-hole-carrier-skipped"] = withDurable(F3_MW_LOG, (l) =>
  projVerdict(assessSig(l, { ...F3_MW_BASE, clerkClockSource: [f3Stamp(1, 1, 10_000), f3Stamp(2, 2, 10_001), f3Stamp(3, 3, 10_002)] }).verdict)
);
// (4) A retired chain's stamps, refused rather than joined. Before T3 this read
//     SILENT — a confident wrong answer, the only failure class worse than a refusal.
live["sig/f3-retired-chain-refused"] = withDurable(F3_MW_LOG, (l) =>
  projVerdict(assessSig(l, {
    ...F3_MW_BASE,
    clerkClockSource: [f3Stamp(0, 1, 10_000, "chain-RETIRED"), f3Stamp(1, 2, 10_001, "chain-RETIRED")],
    expectedChainIdentity: "chain-LIVE",
  }).verdict)
);

// C · Eng, stable kinds/codes.
live["eng/healthy"] = withDurable(ENG_HEALTHY, (l) => projVerdict(assessEng(l, ENG_CFG).verdict));
live["eng/flattened-collapse"] = withDurable(ENG_FLATTENED, (l) => projVerdict(assessEng(l, ENG_CFG).verdict));
live["eng/perfect-ceiling"] = withDurable(ENG_PERFECT, (l) => projVerdict(assessEng(l, ENG_CFG).verdict));
live["eng/no-config"] = withDurable(ENG_HEALTHY, (l) => projVerdict(assessEng(l, { readableLoadStates: GATE }).verdict));

// D · W/R/K sibling matrix (the siblings AGREE on these projections).
live["wrk/no-config-W"] = withDurable(WRK_HEALTHY, (l) => projVerdict(assessNarrowW(l, { readableLoadStates: GATE }).verdict));
live["wrk/no-config-R"] = withDurable(WRK_HEALTHY, (l) => projVerdict(assessNarrowR(l, { readableLoadStates: GATE }).verdict));
live["wrk/no-config-K"] = withDurable(WRK_HEALTHY, (l) => projVerdict(assessNarrowK(l, K_CFG(undefined)).verdict));
live["wrk/healthy-W"] = withDurable(WRK_HEALTHY, (l) => projVerdict(assessNarrowW(l, W_CFG(CONS)).verdict));
live["wrk/healthy-R"] = withDurable(WRK_HEALTHY, (l) => projVerdict(assessNarrowR(l, R_CFG(CONS)).verdict));
live["wrk/healthy-K"] = withDurable(WRK_HEALTHY, (l) => projVerdict(assessNarrowK(l, K_CFG(CONS)).verdict));
live["wrk/theatre-W"] = withDurable(WRK_THEATRE, (l) => projVerdict(assessNarrowW(l, W_CFG(CONS)).verdict));
live["wrk/theatre-R"] = withDurable(WRK_THEATRE, (l) => projVerdict(assessNarrowR(l, R_CFG(CONS)).verdict));
live["wrk/theatre-K"] = withDurable(WRK_THEATRE, (l) => projVerdict(assessNarrowK(l, K_CFG(CONS)).verdict));

// D2 · narrow-T — the FIFTH Eng-sibling, INVERTED polarity (structure is the
// alarm). ADDITIVE block (F9); the entries above stay byte-identical. Its own
// event-class alphabet, drift engineered as a class-mix shift across the arc.
const T_CLASSES: readonly (readonly [string, string])[] = [["m3", "e_a"], ["m5", "e_b"], ["m7", "e_c"], ["m9", "e_d"]];
const tev = (c: readonly [string, string]): Spec => ({ moduleId: c[0], eventType: c[1], outcome: "o" });
function tStable(nPerHalf: number): Spec[] { const s: Spec[] = []; for (const _h of [0, 1]) for (let i = 0; i < nPerHalf; i++) s.push(tev(T_CLASSES[i % T_CLASSES.length])); return s; }
function tDrift(nPerHalf: number): Spec[] { const s: Spec[] = []; for (let i = 0; i < nPerHalf; i++) s.push(tev(T_CLASSES[i % 2])); for (let i = 0; i < nPerHalf; i++) s.push(tev(T_CLASSES[2 + (i % 2)])); return s; }
function tCeiling(nPerHalf: number): Spec[] { const s: Spec[] = []; for (let i = 0; i < nPerHalf; i++) s.push(tev(T_CLASSES[0])); for (let i = 0; i < nPerHalf; i++) s.push(tev(T_CLASSES[1])); return s; }
const T_SINGLE: Spec[] = (() => { const s: Spec[] = []; for (let i = 0; i < 80; i++) s.push(tev(T_CLASSES[0])); return s; })();
const TP = NARROW_T_PROXY_CALIBRATION;
const T_CFG = (o: Partial<NarrowTConfig> = {}): NarrowTConfig => ({ readableLoadStates: GATE, driftTolerance: TP.driftTolerance, minimumEventsPerWindow: TP.minimumEventsPerWindow, driftCeilingMargin: TP.driftCeilingMargin, ...o });
live["t/stable-silent"] = withDurable(tStable(40), (l) => projVerdict(assessNarrowT(l, T_CFG()).verdict));
// ticket T1 (2026-09-22, the arbiter-amended): tDrift is DISJOINT total turnover at 4
// classes. It was frozen ALARM, which froze the defect (the verdict depended on
// class count). It now reads CANNOT_ASSESS [INELIGIBLE_SCOPE]; the key keeps its
// historical name so the move stays visible as a move, not a drop-and-add.
live["t/drifted-alarm"] = withDurable(tDrift(40), (l) => projVerdict(assessNarrowT(l, T_CFG()).verdict));
live["t/ceiling-ca"] = withDurable(tCeiling(40), (l) => projVerdict(assessNarrowT(l, T_CFG()).verdict));
live["t/ceiling-no-margin-alarm"] = withDurable(tCeiling(40), (l) => projVerdict(assessNarrowT(l, { readableLoadStates: GATE, driftTolerance: TP.driftTolerance, minimumEventsPerWindow: TP.minimumEventsPerWindow }).verdict));
live["t/single-class-ca"] = withDurable(T_SINGLE, (l) => projVerdict(assessNarrowT(l, T_CFG()).verdict));
live["t/no-config-ca"] = withDurable(tStable(40), (l) => projVerdict(assessNarrowT(l, { readableLoadStates: GATE }).verdict));
// ticket T1 — two projections ADDED (the frozen set grows; that is the point).
// Both records are the pre-registered ones (PREREG T1, vault b6da758), rebuilt
// verbatim in the LIVE record shape: moduleId = the subject, eventType = the
// bridge's kinds. Both sit THIN above the PRE-PILOT PROXY tolerance 0.30 and pin
// the repair ONLY at that proxy calibration: re-calibrate, and both must be re-read.
const tLive = (subj: string, kind: string): Spec => ({ moduleId: subj, eventType: kind, outcome: "o" });
const tClean = (subj: string): Spec[] => [tLive(subj, "TOOL_ATTEMPTED"), tLive(subj, "TOOL_EXECUTED"), tLive(subj, "TOOL_RESULT")];
const tHeld = (subj: string): Spec[] => [tLive(subj, "TOOL_ATTEMPTED"), tLive(subj, "TOOL_HELD_NOT_EXECUTED")];
const tRep = (n: number, f: () => Spec[]): Spec[] => { const o: Spec[] = []; for (let i = 0; i < n; i++) o.push(...f()); return o; };
// 21st · the post-27th shape: one subject, 10 clean acts then 15 held acts (60
// records). AMI 0.3013 (+0.0013 over the proxy tolerance); read ALARM before T1.
// Must read CANNOT_ASSESS: a PHASE CHANGE, not drift.
live["t/phase-change-clean-then-held-ca"] = withDurable([...tRep(10, () => tClean("housekeeper")), ...tRep(15, () => tHeld("housekeeper"))], (l) => projVerdict(assessNarrowT(l, T_CFG()).verdict));
// 22nd · genuine partial drift in the live KINDS that MUST read ALARM — the proof
// T1 did not switch narrow-T off. TWO subjects (A 39:1 -> 1:39 over 240 records,
// every class in both windows). ⚠ AMI 0.3176: margin +0.0176 over the PROXY
// tolerance 0.30 — this pins the repair ONLY at the proxy calibration. ⚠ The
// deployed subjects array has ONE entry, so a two-subject record is the live
// record SHAPE and the live kinds, NOT the deployed vocabulary: with one subject no
// partial drift measured by T1's post-check reads ALARM at 0.30 (max 0.2883).
live["t/partial-drift-2subj-alarm-proxy-margin-0.0176"] = withDurable([...tRep(39, () => tClean("agentA")), ...tClean("agentB"), ...tClean("agentA"), ...tRep(39, () => tClean("agentB"))], (l) => projVerdict(assessNarrowT(l, T_CFG()).verdict));

// E · the clerk-gap adapter — its three kinds mapped.
const gap = (g: GapReadShape): Record<string, unknown> => projVerdict(gapReadToVerdict(g));
live["gap/observed"] = gap({ kind: "GAP_OBSERVED", instrumentId: "clerk1.gap", summary: "s", stops: [{ object: "SUBMITTER_SILENT", question: "q" }], blind: [] });
live["gap/no-gap"] = gap({ kind: "NO_GAP_OBSERVED", instrumentId: "clerk1.gap", summary: "s" });
live["gap/cannot-assess-cadence"] = gap({ kind: "CANNOT_ASSESS_CADENCE", instrumentId: "clerk1.gap", summary: "s", blind: [{ class: "NO_RECORDS", channel: null, detail: "d" }] });

// F · ledger / delivery failures.
{
  // A durable PASS-BLIND whose delivery is dropped fails closed (F1).
  const ledger = new ChokepointLedger({ path: join(root, `snap-${counter++}.jsonl`) });
  const cp = new Chokepoint({
    line: LINE,
    ledger,
    floorTrail: new FloorTrail({ path: join(root, `floor-${counter++}.jsonl`) }),
    deliver: () => ({ kind: "NOT_DELIVERED", detail: "dropped" }),
  });
  const r = cp.guard({ id: "pb-dropped" }, [CA()], { impactClass: "low" });
  live["delivery/passblind-dropped"] = { disposition: r.disposition, execute: r.execute, recorded: r.recorded };
}
{
  const n = narrowForDisposition("RELEASE", { kind: "NOT_DELIVERED", detail: "x" });
  live["delivery/release-dropped"] = { disposition: n.disposition, execute: n.execute };
}
{
  const failed: ExportOutcome = { kind: "WRITE_FAILED", path: "/x", detail: "x" };
  live["delivery/silent-write-failed"] = projVerdict(narrowForDelivery({ kind: "SILENT", sensorId: "s", summary: "x" }, failed));
  live["delivery/alarm-write-failed"] = projVerdict(narrowForDelivery({ kind: "ALARM", sensorId: "s", summary: "x", findings: [{ code: "C", detail: "d" }] }, failed));
}

// ── compare (or capture on first run) ─────────────────────────────────────────

console.log("\nMICA — substrate-era semantic snapshot (F9)\n");

const snapPath = join(__dirname, "verdict-logic.substrate-snapshot.json");

if (!existsSync(snapPath)) {
  writeFileSync(snapPath, JSON.stringify(live, null, 2) + "\n", "utf8");
  console.log(`  captured additive baseline (${Object.keys(live).length} projections) at verdict-logic.substrate-snapshot.json`);
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  rmSync(root, { recursive: true, force: true });
  process.exit(0);
}

const frozen = JSON.parse(readFileSync(snapPath, "utf8")) as Record<string, unknown>;

check("no snapshot projection was quietly dropped", () => {
  const missing = Object.keys(frozen).filter((k) => !(k in live));
  assert.deepStrictEqual(missing, [], `frozen projections not recomputed: ${missing.join(", ")}`);
});
check("no projection was added without being frozen", () => {
  const extra = Object.keys(live).filter((k) => !(k in frozen));
  assert.deepStrictEqual(extra, [], `new projections not in the snapshot: ${extra.join(", ")}`);
});

// The W/R/K siblings must AGREE on each matrix column (the sibling-parity claim).
check("W/R/K siblings project IDENTICALLY on each matrix column", () => {
  for (const col of ["no-config", "healthy", "theatre"]) {
    const w = JSON.stringify(live[`wrk/${col}-W`]);
    const r = JSON.stringify(live[`wrk/${col}-R`]);
    const k = JSON.stringify(live[`wrk/${col}-K`]);
    // W/R/K carry sibling-specific finding CODES on ALARM; compare KIND parity,
    // which is the non-compensatory-grammar claim the matrix must hold.
    const kindOf = (s: string): string => (JSON.parse(s) as { kind: string }).kind;
    assert.strictEqual(kindOf(w), kindOf(r), `W vs R disagree on ${col}`);
    assert.strictEqual(kindOf(r), kindOf(k), `R vs K disagree on ${col}`);
  }
});

for (const key of Object.keys(frozen)) {
  check(`SNAPSHOT UNCHANGED: ${key}`, () => {
    assert.deepStrictEqual(live[key], frozen[key], `semantic projection for ${key} drifted`);
  });
}

rmSync(root, { recursive: true, force: true });
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
