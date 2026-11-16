// MICA/Sig F3 — declared clock vs Clerk 1 receipt order.

import * as assert from "assert";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MicaFixtureLog } from "./fixture-log";
import { assessSig, sigScopeBlockText,
  F3_WRITER_IDENTITY_MISMATCH_TOKEN,
  F3_CARRIER_SKIPPED_TOKEN,
} from "./sig";
import type { ClerkClockSource, SigConfig } from "./sig";
import { decideChokepoint } from "./chokepoint/types";
import type { StakesLine } from "./chokepoint/types";
import type { SensorVerdict } from "./types";

let passed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const root = mkdtempSync(join(tmpdir(), "mica-sig-f3-"));
const path = join(root, "log.jsonl");
const first = new MicaFixtureLog({ path });
first.append({ timestamp: 1_000, moduleId: "m", eventType: "a", outcome: "ok" });
first.append({ timestamp: 2_000, moduleId: "m", eventType: "b", outcome: "ok" });
const log = new MicaFixtureLog({ path });

/**
 * T8 · THE FIXTURE CHAIN. Under T8 a stamp joins ONLY when it names the chain
 * this run was told to expect, so an ORDINARY carry is now a stamp carrying
 * this value against a config injecting it. Every fixture below that models an
 * ordinary carry gets it by default (see `source` and `stamps`); a scenario
 * that deliberately omits or contradicts it says so at its own call site.
 */
const CHAIN_LIVE = "chain-LIVE";

const base: SigConfig = {
  readableLoadStates: ["LOADED_VERIFIED"],
  clockToleranceMs: 0,
  preconditionMap: { b: ["a"] },
  expectedChainIdentity: CHAIN_LIVE,
};

function source(order: readonly [number, number]): ClerkClockSource {
  // T8: an ordinary carry names its chain. Before T8 these carried none and
  // joined anyway; that arm is gone.
  return [
    {
      moduleId: "m",
      chainIdentity: CHAIN_LIVE,
      sequenceNumber: 0,
      clerk_seq: order[0],
      clerk_time: { wall_ms: 10_000, monotonic_ns: "100" },
      separation: "SEPARATE_PROCESS",
      intake: "SOCKET",
      clerk_id: "clerk-test",
      clerk_boot_id: "boot-test",
    },
    {
      moduleId: "m",
      chainIdentity: CHAIN_LIVE,
      sequenceNumber: 1,
      clerk_seq: order[1],
      clerk_time: { wall_ms: 10_001, monotonic_ns: "101" },
      separation: "SEPARATE_PROCESS",
      intake: "SOCKET",
      clerk_id: "clerk-test",
      clerk_boot_id: "boot-test",
    },
  ];
}

const absent = assessSig(log, base);
check("F5 · absent clerk source is NOT_CONFIGURED (a dormant leg), not a blind CANNOT_ASSESS", () => {
  // The honest split: no source injected => the leg is unconfigured, not blind.
  assert.strictEqual(absent.flags[2].kind, "NOT_CONFIGURED");
  assert.strictEqual(absent.clerkClockSource, null);
});
check("F5 · an unconfigured F3 leg is excluded from the floor: composite stays SILENT", () => {
  assert.strictEqual(absent.verdict.kind, "SILENT");
  assert.ok(!absent.verdict.summary.includes("F3["));
});

const consistent = assessSig(log, { ...base, clerkClockSource: source([1, 2]) });
check("consistent declared time and clerk order: F1 SILENT + F3 SILENT", () => {
  assert.deepStrictEqual(
    consistent.flags.map((f) => f.kind),
    // F4 (probe divergence) is unconfigured in this F3 fixture and reads
    // NOT_CONFIGURED — dormant, disclosed, excluded from the floor.
    ["SILENT", "SILENT", "SILENT", "NOT_CONFIGURED"]
  );
  assert.strictEqual(consistent.verdict.kind, "SILENT");
});

const contradicted = assessSig(log, {
  ...base,
  clerkClockSource: source([2, 1]),
});
check("monotone declared clock keeps F1 SILENT while F3 ALARMS", () => {
  assert.strictEqual(contradicted.flags[0].kind, "SILENT");
  assert.strictEqual(contradicted.flags[2].kind, "ALARM");
  assert.strictEqual(contradicted.verdict.kind, "ALARM");
});
check("F3 finding prints its independent-axis ceiling", () => {
  assert.ok(contradicted.verdict.kind === "ALARM");
  const finding = contradicted.verdict.findings.find(
    (f) => f.code === "SIG_F3_DECLARED_VS_CLERK_CLOCK_CONTRADICTION"
  );
  assert.ok(finding?.detail.includes("arrival/order only, never payload truth"));
  assert.ok(finding?.detail.includes("separate OS principal"));
});
check("F3 ALARM composes to chokepoint HOLD", () => {
  const decision = decideChokepoint(
    { id: "f3-careful-clock" },
    [contradicted.verdict]
  );
  assert.strictEqual(decision.disposition, "HOLD");
  assert.strictEqual(decision.executeRaw, false);
});

const localCall = source([1, 2]).map((s) => ({
  ...s,
  separation: "IN_PROCESS_NO_SEPARATION" as const,
  intake: "LOCAL_CALL" as const,
}));
const unsupported = assessSig(log, { ...base, clerkClockSource: localCall });
check("in-process/local-call receipts cannot masquerade as F3's independent axis", () => {
  assert.strictEqual(unsupported.flags[2].kind, "CANNOT_ASSESS");
});

// ── F5 (arbiter-ruled a) · a CONFIGURED-but-blind F3 composes into the verdict ──
//
// This is the fail-open the review named: an F3 that WAS configured (a source was
// injected) but could not be read — here, receipts that do not demonstrate the
// required OS-principal boundary — was named CANNOT_ASSESS and then SILENTLY
// DROPPED before composition, so Sig read SILENT and the chokepoint could RELEASE
// over an unread verdict-bearing leg. It now composes: the blind leg lowers the
// composite bound to CANNOT_ASSESS, and the gate cannot RELEASE.
check("F5 · a configured-but-blind F3 lowers the composite to CANNOT_ASSESS (no longer dropped)", () => {
  assert.strictEqual(unsupported.flags[0].kind, "SILENT");
  assert.strictEqual(unsupported.flags[1].kind, "SILENT");
  assert.strictEqual(unsupported.flags[2].kind, "CANNOT_ASSESS");
  assert.strictEqual(unsupported.verdict.kind, "CANNOT_ASSESS");
  assert.ok(unsupported.verdict.summary.includes("F3["), "the blind F3 leg is named in the verdict");
});
check("F5 · E2E floor — a blind F3 drives the chokepoint OFF RELEASE (the fail-open is closed)", () => {
  const decision = decideChokepoint({ id: "f3-blind-leg" }, [unsupported.verdict]);
  assert.strictEqual(decision.floorKind, "CANNOT_ASSESS");
  assert.notStrictEqual(decision.disposition, "RELEASE");
  assert.strictEqual(decision.executeRaw, false);
});


// ══════════════════════════════════════════════════════════════════════════════
// T3 · ticket T3-sig-f3-watermark — the per-writer watermark, the lag bound,
//      chain identity, and the order deviation as a number.
//
// THE PRE-REGISTERED SCENARIOS, in the order the ticket names them, each under
// BOTH stakes lines in force on this deployment. Registered before a line of
// the repair was written; the rows below are the post-check of that table.
//
//   pilot     holdAtOrAbove = irreversible   (in force until 2026-09-27T18:00Z)
//   baseline  holdAtOrAbove = state_changing (in force after)
//   the one declared subject: stakesClass "bash"
//
// So for this subject: CANNOT_ASSESS is PASS_BLIND (executes) under the pilot
// and HOLD_BLIND (does not) under the baseline. That asymmetry is the whole
// reason T3 was signed, and it is why every row below is checked twice.
// ══════════════════════════════════════════════════════════════════════════════

const CLASSES = ["routine", "advisory", "state_changing", "bash", "irreversible"];
const PILOT: StakesLine = { classes: CLASSES, holdAtOrAbove: "irreversible" };
const BASELINE: StakesLine = { classes: CLASSES, holdAtOrAbove: "state_changing" };
const SUBJECT = { impactClass: "bash" };

/** Both dispositions for one Sig verdict, as the pre-registration table prints them. */
function bothLines(v: SensorVerdict): { pilot: string; baseline: string; pilotExec: boolean; baselineExec: boolean } {
  const p = decideChokepoint({ id: "t3-pilot" }, [v], SUBJECT, PILOT);
  const b = decideChokepoint({ id: "t3-baseline" }, [v], SUBJECT, BASELINE);
  return { pilot: p.disposition, baseline: b.disposition, pilotExec: p.executeRaw, baselineExec: b.executeRaw };
}

// ── the multi-writer fixture, which is the shape the live log actually has ────
//
// ONE ASCENDING sequenceNumber, MANY writers — `sequenceNumber = chain.length`
// is global while `moduleId` is per-record. A single global watermark cannot
// express the stamped set of this log, which is §5.1's whole point.
const mwRoot = mkdtempSync(join(tmpdir(), "mica-sig-f3-mw-"));
let mwCounter = 0;
function multiWriterLog(timestamps: readonly number[]): MicaFixtureLog {
  // A FRESH PATH PER CALL. Reusing one path would APPEND to a fixture another
  // check already wrote, and the second reading would be taken over eight
  // records instead of four — a fixture that fails for a reason nobody named.
  const p = join(mwRoot, `log-${mwCounter++}.jsonl`);
  const w = new MicaFixtureLog({ path: p });
  //  seq  writer  eventType
  //   0   w1      a
  //   1   w2      b     (precondition "a" already seen — F2 stays SILENT)
  //   2   w1      a
  //   3   w2      b
  w.append({ timestamp: timestamps[0], moduleId: "w1", eventType: "a", outcome: "ok" });
  w.append({ timestamp: timestamps[1], moduleId: "w2", eventType: "b", outcome: "ok" });
  w.append({ timestamp: timestamps[2], moduleId: "w1", eventType: "a", outcome: "ok" });
  w.append({ timestamp: timestamps[3], moduleId: "w2", eventType: "b", outcome: "ok" });
  return new MicaFixtureLog({ path: p });
}
const MW_ORDERLY = [1_000, 2_000, 3_000, 4_000] as const;
/** The tail declares FRESH times while the stamped head is old. See S4-backdated. */
const MW_BACKDATED_TAIL = [1_000, 2_000, 1_000_000_000, 1_000_000_001] as const;

interface StampSpec {
  seq: number;
  clerkSeq: number;
  wall: number;
  chain?: string;
  mod?: string;
  /**
   * T8 · omit the chain identity ENTIRELY, which is now a REFUSAL rather than
   * the default. It is an explicit flag because under T8 "no chain identity" is
   * a scenario, not a baseline — leaving it implicit is how every fixture in
   * this file would quietly have become a refusal fixture.
   */
  noChain?: true;
}
function stamps(specs: readonly StampSpec[]): ClerkClockSource {
  return specs.map((s) => ({
    // T6 · THE STAMP CARRIES THE RECORD'S OWN WRITER, because that is what the
    // carrier writes (`moduleId: record.moduleId`, mica-clerk-caller.ts:914). Until
    // T6 the join ignored this field, so these fixtures could name any writer and
    // still join. Under T6 a disagreeing stamp is DISCARDED and DISCLOSED, so a
    // fixture modelling an ORDINARY carry must agree. The DELIBERATE mismatch now
    // has its own scenario rather than being every fixture's incidental state.
    moduleId: s.mod ?? (s.seq % 2 === 0 ? "w1" : "w2"),
    // T8 · an ordinary carry names its chain; `noChain` is the explicit opt-out.
    ...(s.noChain === true ? {} : { chainIdentity: s.chain ?? CHAIN_LIVE }),
    sequenceNumber: s.seq,
    clerk_seq: s.clerkSeq,
    clerk_time: { wall_ms: s.wall, monotonic_ns: String(s.wall) },
    separation: "SEPARATE_PROCESS" as const,
    intake: "SOCKET" as const,
    clerk_id: "clerk-test",
    clerk_boot_id: "boot-test",
  }));
}
const MW_CFG: SigConfig = {
  readableLoadStates: ["LOADED_VERIFIED"],
  clockToleranceMs: 0,
  preconditionMap: { b: ["a"] },
  expectedChainIdentity: CHAIN_LIVE,
};

// ── S1 · no stamps at all — UNCHANGED, DELIBERATELY ──────────────────────────
{
  const r = assessSig(multiWriterLog(MW_ORDERLY), MW_CFG);
  check("T3 S1 · no clerk source at all stays NOT_CONFIGURED and stays out of the floor", () => {
    assert.strictEqual(r.flags[2].kind, "NOT_CONFIGURED");
    assert.strictEqual(r.verdict.kind, "SILENT");
    // Nothing to disclose, and a zeroed coverage object would read as "nothing
    // was missing" over a scope nobody looked at.
    assert.strictEqual(r.clerkStampCoverage, null);
    assert.strictEqual(r.f3Deviation, null);
    const d = bothLines(r.verdict);
    assert.deepStrictEqual([d.pilot, d.baseline], ["RELEASE", "RELEASE"]);
  });
}

// ── S2 · complete join — UNCHANGED, and the tail is disclosed as empty ───────
{
  const r = assessSig(multiWriterLog(MW_ORDERLY), {
    ...MW_CFG,
    clerkClockSource: stamps([
      { seq: 0, clerkSeq: 1, wall: 10_000 },
      { seq: 1, clerkSeq: 2, wall: 10_001 },
      { seq: 2, clerkSeq: 3, wall: 10_002 },
      { seq: 3, clerkSeq: 4, wall: 10_003 },
    ]),
  });
  check("T3 S2 · a complete join is SILENT and discloses an EMPTY tail and no holes", () => {
    assert.strictEqual(r.flags[2].kind, "SILENT");
    assert.strictEqual(r.verdict.kind, "SILENT");
    const c = r.clerkStampCoverage;
    assert.ok(c !== null);
    assert.strictEqual(c.stampedCount, 4);
    assert.strictEqual(c.tailCount, 0);
    assert.strictEqual(c.holeCount, 0);
    assert.deepStrictEqual(c.unreachedWriters, []);
    const d = bothLines(r.verdict);
    assert.deepStrictEqual([d.pilot, d.baseline], ["RELEASE", "RELEASE"]);
  });
}

// ── S3 · the ORDINARY DAY: an unstamped tail inside the bound ────────────────
//
// THE ROW T3 EXISTS FOR. Before this repair the same fixture was CANNOT_ASSESS
// — "no stamp for local sequenceNumber(s) [2, 3]" — which under the baseline
// line is HOLD_BLIND, so the box stopped on an ordinary working day.
{
  const r = assessSig(multiWriterLog(MW_ORDERLY), {
    ...MW_CFG,
    clerkClockSource: stamps([
      { seq: 0, clerkSeq: 1, wall: 10_000 },
      { seq: 1, clerkSeq: 2, wall: 10_001 },
    ]),
    clerkStampLagBoundMs: 30_000,
    readAtMs: 20_001,
  });
  check("T3 S3 · an unstamped TAIL inside the bound is SILENT — it no longer blinds the floor", () => {
    assert.strictEqual(r.flags[2].kind, "SILENT");
    assert.strictEqual(r.flags[2].blindPaths.length, 0);
    assert.strictEqual(r.verdict.kind, "SILENT");
  });
  check("T3 S3 · the tail is DISCLOSED by count and by the axis's own silence", () => {
    const c = r.clerkStampCoverage;
    assert.ok(c !== null);
    assert.strictEqual(c.stampedCount, 2);
    assert.strictEqual(c.tailCount, 2);
    assert.strictEqual(c.holeCount, 0);
    assert.strictEqual(c.newestStampedWallMs, 10_001);
    assert.strictEqual(c.axisSilentForMs, 10_000);
    assert.strictEqual(c.lagBoundMs, 30_000);
    assert.strictEqual(c.lagBoundEvaluated, true);
    assert.strictEqual(c.axisStale, false);
  });
  check("T3 S3 · and the disposition moves from HOLD_BLIND to RELEASE under the BASELINE line", () => {
    const d = bothLines(r.verdict);
    assert.deepStrictEqual([d.pilot, d.baseline], ["RELEASE", "RELEASE"]);
    assert.strictEqual(d.baselineExec, true);
  });
}

// ── S3b · a HOLE is NOT a tail. THE FAIL-OPEN THIS REPAIR MUST NOT CREATE ────
//
// MUTANT SENTINEL M1. A builder who models "the stamped prefix" as one global
// high-water mark files a genuinely SKIPPED record into the tail and calls it
// fresh. Here w1's mark is seq 2 and w1's seq 0 carries no stamp: the carrier
// reached PAST it. That is evidence, and it must blind the leg.
{
  const r = assessSig(multiWriterLog(MW_ORDERLY), {
    ...MW_CFG,
    clerkClockSource: stamps([
      { seq: 1, clerkSeq: 1, wall: 10_000 },
      { seq: 2, clerkSeq: 2, wall: 10_001 },
      { seq: 3, clerkSeq: 3, wall: 10_002 },
    ]),
    clerkStampLagBoundMs: 30_000,
    readAtMs: 10_003,
  });
  check("T3 S3b · a HOLE (below its own writer's mark) composes CANNOT_ASSESS — never a tail", () => {
    assert.strictEqual(r.flags[2].kind, "CANNOT_ASSESS");
    assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
    const c = r.clerkStampCoverage;
    assert.ok(c !== null);
    assert.strictEqual(c.holeCount, 1);
    assert.deepStrictEqual(c.holeSequenceNumbers, [0]);
    assert.strictEqual(c.tailCount, 0, "a hole must NOT be counted as tail");
  });
  check("T3 S3b · the skip is named CARRIER_SKIPPED, and the class stays INELIGIBLE_SCOPE", () => {
    const b = r.flags[2].blindPaths[0];
    assert.strictEqual(b.class, "INELIGIBLE_SCOPE", "BlindPathClass is closed and shared; types.ts is not opened");
    assert.ok(b.detail.startsWith("CARRIER_SKIPPED: "), b.detail);
    assert.ok(b.detail.includes("BELOW their own writer"));
  });
  check("T3 S3b · disposition: PASS_BLIND under the pilot, HOLD_BLIND under the baseline", () => {
    const d = bothLines(r.verdict);
    assert.deepStrictEqual([d.pilot, d.baseline], ["PASS_BLIND", "HOLD_BLIND"]);
    assert.strictEqual(d.pilotExec, true);
    assert.strictEqual(d.baselineExec, false);
  });
}

// ── S4 · a tail OLDER than the declared bound: AXIS_STALE ────────────────────
{
  const r = assessSig(multiWriterLog(MW_ORDERLY), {
    ...MW_CFG,
    clerkClockSource: stamps([
      { seq: 0, clerkSeq: 1, wall: 10_000 },
      { seq: 1, clerkSeq: 2, wall: 10_001 },
    ]),
    clerkStampLagBoundMs: 30_000,
    readAtMs: 10_001 + 60_000,
  });
  check("T3 S4 · a tail beyond the declared bound composes CANNOT_ASSESS, reason AXIS_STALE", () => {
    assert.strictEqual(r.flags[2].kind, "CANNOT_ASSESS");
    assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
    const b = r.flags[2].blindPaths[0];
    assert.strictEqual(b.class, "INELIGIBLE_SCOPE");
    assert.ok(b.detail.startsWith("AXIS_STALE: "), b.detail);
    assert.ok(b.detail.includes("30000"), "the bound it exceeded is named");
    assert.ok(b.detail.includes("60000"), "how long the axis has been silent is named");
  });
  check("T3 S4 · disposition: PASS_BLIND under the pilot, HOLD_BLIND under the baseline", () => {
    const d = bothLines(r.verdict);
    assert.deepStrictEqual([d.pilot, d.baseline], ["PASS_BLIND", "HOLD_BLIND"]);
    assert.strictEqual(d.baselineExec, false);
  });
}

// ── S4-backdated · MUTANT SENTINEL M3 ────────────────────────────────────────
//
// THE STALENESS CLOCK IS THE AXIS UNDER SUSPICION. Here the stamped head is old
// (clerk wall 10_001) and the unstamped tail DECLARES itself fresh. Measured
// the obvious way — against the tail's own declared timestamps — the axis reads
// current and the subject has backdated its way out of the check meant to catch
// it. Measured from the newest STAMPED record's clerk_time, it reads stale.
{
  const r = assessSig(multiWriterLog(MW_BACKDATED_TAIL), {
    ...MW_CFG,
    clerkClockSource: stamps([
      { seq: 0, clerkSeq: 1, wall: 10_000 },
      { seq: 1, clerkSeq: 2, wall: 10_001 },
    ]),
    clerkStampLagBoundMs: 30_000,
    readAtMs: 1_000_000_002,
  });
  check("T3 S4b · a tail that DECLARES itself fresh cannot hide a stale axis", () => {
    const c = r.clerkStampCoverage;
    assert.ok(c !== null);
    // Measured from the stamp, not from the record: 1_000_000_002 - 10_001.
    assert.strictEqual(c.axisSilentForMs, 999_990_001);
    assert.strictEqual(c.axisStale, true);
    assert.strictEqual(r.flags[2].kind, "CANNOT_ASSESS");
    // The mutant's number, spelled out so the sentinel cannot be read as a typo:
    // max declared tail timestamp is 1_000_000_001, so a declared-time clock
    // would have read 1 ms of silence and called the axis current.
    assert.ok(1_000_000_002 - 1_000_000_001 < 30_000);
  });
}

// ── S4c · an absent bound, or an absent now, DISCLOSES and does NOT hold ─────
{
  const src = stamps([
    { seq: 0, clerkSeq: 1, wall: 10_000 },
    { seq: 1, clerkSeq: 2, wall: 10_001 },
  ]);
  const noBound = assessSig(multiWriterLog(MW_ORDERLY), { ...MW_CFG, clerkClockSource: src, readAtMs: 9_999_999 });
  const noNow = assessSig(multiWriterLog(MW_ORDERLY), { ...MW_CFG, clerkClockSource: src, clerkStampLagBoundMs: 1 });
  check("T3 S4c · a bound that cannot be read must not manufacture a hold", () => {
    for (const [label, r] of [["no bound", noBound], ["no readAtMs", noNow]] as const) {
      assert.strictEqual(r.flags[2].kind, "SILENT", label);
      const c = r.clerkStampCoverage;
      assert.ok(c !== null);
      assert.strictEqual(c.lagBoundEvaluated, false, label);
      assert.strictEqual(c.axisStale, false, label);
      assert.strictEqual(c.tailCount, 2, `${label}: and the tail is still disclosed`);
    }
  });
}

// ── S5 · a stamp from a RETIRED chain. MUTANT SENTINEL M2 ────────────────────
//
// The worst row on the list, because it is the only one that produced a
// CONFIDENT WRONG ANSWER rather than a refusal: sequence numbers restart at
// rotation, so the old chain's seq 0 joined the new chain's seq 0 and F3
// reported a real clerk receipt against the wrong record — and read SILENT.
{
  const foreign = stamps([
    { seq: 0, clerkSeq: 1, wall: 10_000, chain: "chain-RETIRED" },
    { seq: 1, clerkSeq: 2, wall: 10_001, chain: "chain-RETIRED" },
    { seq: 2, clerkSeq: 3, wall: 10_002, chain: "chain-RETIRED" },
    { seq: 3, clerkSeq: 4, wall: 10_003, chain: "chain-RETIRED" },
  ]);
  const r = assessSig(multiWriterLog(MW_ORDERLY), {
    ...MW_CFG,
    clerkClockSource: foreign,
    expectedChainIdentity: "chain-LIVE",
  });
  check("T3 S5 · a non-matching chain identity is REFUSED, never joined", () => {
    assert.strictEqual(r.flags[2].kind, "CANNOT_ASSESS");
    assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
    const b = r.flags[2].blindPaths[0];
    assert.strictEqual(b.class, "INELIGIBLE_SCOPE");
    assert.ok(b.detail.startsWith("CHAIN_IDENTITY_MISMATCH: "), b.detail);
    assert.ok(b.detail.includes("chain-RETIRED") && b.detail.includes("chain-LIVE"));
    const c = r.clerkStampCoverage;
    assert.ok(c !== null);
    assert.strictEqual(c.refusedChainStampCount, 4);
    assert.deepStrictEqual(c.refusedChainIdentities, ["chain-RETIRED"]);
    assert.strictEqual(c.stampedCount, 0, "a refused stamp is NEVER joined");
  });
  check("T3 S5 · disposition: the false RELEASE becomes PASS_BLIND / HOLD_BLIND", () => {
    const d = bothLines(r.verdict);
    assert.deepStrictEqual([d.pilot, d.baseline], ["PASS_BLIND", "HOLD_BLIND"]);
    assert.strictEqual(d.baselineExec, false);
  });
}

// ── S5b · OPTIONAL BY DEFAULT — ticket condition 2, at bytes ─────────────────
{
  const complete: readonly StampSpec[] = [
    { seq: 0, clerkSeq: 1, wall: 10_000 },
    { seq: 1, clerkSeq: 2, wall: 10_001 },
    { seq: 2, clerkSeq: 3, wall: 10_002 },
    { seq: 3, clerkSeq: 4, wall: 10_003 },
  ];
  // ⛔ T8 REPLACES THIS SCENARIO'S VERDICT, AND THE OLD TEST IS QUOTED RATHER
  //   THAN DELETED so the change is legible to whoever reads this next. It was:
  //
  //     "T3 S5b · a stamp with NO chain identity behaves exactly as today, and
  //      is disclosed as unattributed" — flags[2] SILENT, verdict SILENT,
  //      unattributedStampCount 4.
  //
  //   T8 revokes exactly that permission. The arbiter's word: "a stamp with no
  //   chain identity or another chain's is refused, not joined and not excused
  //   as unattributed ... because a stamp that does not name its chain is a
  //   claim about a NUMBER, not about a RECORD". The COUNT SURVIVES WITH ITS
  //   NAME (ticket condition 2) and now counts refusals, which is why the
  //   assertion below is the same number with the opposite meaning.
  const bare = assessSig(multiWriterLog(MW_ORDERLY), {
    ...MW_CFG,
    clerkClockSource: stamps(complete.map((sp) => ({ ...sp, noChain: true as const }))),
  });
  check("T8 · a stamp with NO chain identity is REFUSED — the 'unattributed' permission is gone", () => {
    assert.strictEqual(bare.flags[2].kind, "CANNOT_ASSESS");
    const c = bare.clerkStampCoverage;
    assert.ok(c !== null);
    // The SAME number as before T8, and it now counts REFUSALS, not joins.
    assert.strictEqual(c.unattributedStampCount, 4);
    assert.strictEqual(c.refusedChainStampCount, 0);
    // NOT ONE of them reached a join.
    assert.strictEqual(c.stampedCount, 0);
  });
  check("T8 · the refusal is NAMED, and its token is NOT the foreign-chain one", () => {
    // TICKET FAIL CONDITION (d), pinned: a leg that refuses evidence and then
    // reports a clean read is worse than one that never checked.
    const d = bare.flags[2].blindPaths[0].detail;
    assert.ok(d.startsWith("CHAIN_IDENTITY_MISSING: "), d);
    assert.ok(!d.includes("CHAIN_IDENTITY_MISMATCH"), "an old axis must not read as a contaminated one");
    // AND THE REMEDY IS IN THE TEXT. An operator reading this must be told to
    // re-stamp, not sent looking for an intruder.
    assert.ok(/re-stamp/i.test(d), d);
  });
  const matching = assessSig(multiWriterLog(MW_ORDERLY), {
    ...MW_CFG,
    clerkClockSource: stamps(complete.map((s) => ({ ...s, chain: "chain-LIVE" }))),
    expectedChainIdentity: "chain-LIVE",
  });
  check("T3 S5b · a MATCHING chain identity joins and is not counted as unattributed", () => {
    assert.strictEqual(matching.flags[2].kind, "SILENT");
    const c = matching.clerkStampCoverage;
    assert.ok(c !== null);
    assert.strictEqual(c.unattributedStampCount, 0);
    assert.strictEqual(c.unverifiedAttributionCount, 0);
    assert.strictEqual(c.refusedChainStampCount, 0);
  });
  // ⛔ THE SECOND SCENARIO T8 INVERTS, AND THE ONE THAT DECIDES WHETHER THE
  //   TICKET WORKS AT ALL. It was: "an identity with nothing injected to check
  //   it against is joined but NOT promoted to checked" — SILENT, 4 joined.
  //
  //   Under T8 it REFUSES, and the reason is not symmetry: NOTHING IN
  //   PRODUCTION INJECTED `expectedChainIdentity` WHEN THIS TICKET WAS WRITTEN
  //   (measured at bytes 2026-09-29: the field appears in sig/index.ts and in
  //   tests, nowhere else). So if this arm still joined, a deployment that
  //   simply never wires the expected identity would get a FULL SET OF JOINS ON
  //   UNCHECKED CLAIMS and a clean F3 — the whole ticket bought by an omission.
  //   Ticket condition 2 names this counter alongside the other as becoming a
  //   count of REFUSED stamps, and this is that arm.
  const unchecked = assessSig(multiWriterLog(MW_ORDERLY), {
    ...MW_CFG,
    expectedChainIdentity: undefined,
    clerkClockSource: stamps(complete.map((sp) => ({ ...sp, chain: "chain-WHATEVER" }))),
  });
  check("T8 · a claim with NOTHING TO CHECK IT AGAINST is refused — a forgotten wiring must not buy a clean read", () => {
    assert.strictEqual(unchecked.flags[2].kind, "CANNOT_ASSESS");
    const c = unchecked.clerkStampCoverage;
    assert.ok(c !== null);
    assert.strictEqual(c.unverifiedAttributionCount, 4);
    assert.strictEqual(c.stampedCount, 0);
    assert.strictEqual(c.refusedChainStampCount, 0);
    // AND THE REASON NAMES THE CALLER, not the stamps — this is a wiring fault.
    const d = unchecked.flags[2].blindPaths[0].detail;
    assert.ok(d.startsWith("CHAIN_IDENTITY_MISSING: "), d);
    assert.ok(/NO expectedChainIdentity WAS INJECTED/.test(d), d);
  });
  check("T8 · a MATCHING identity still joins — the one arm that was left", () => {
    // The positive control. Without it the three refusals above are consistent
    // with a leg that refuses everything, which would pass every one of them.
    const c = matching.clerkStampCoverage;
    assert.ok(c !== null);
    assert.strictEqual(c.stampedCount, 4);
    assert.strictEqual(matching.flags[2].kind, "SILENT");
  });
  const empty = assessSig(multiWriterLog(MW_ORDERLY), {
    ...MW_CFG,
    clerkClockSource: stamps(complete).map((s, i) => (i === 0 ? { ...s, chainIdentity: "" } : s)),
    expectedChainIdentity: "chain-LIVE",
  });
  check("T3 S5b · an EMPTY chainIdentity is MALFORMED, not a way to buy today's behaviour", () => {
    assert.strictEqual(empty.flags[2].kind, "CANNOT_ASSESS");
    assert.ok(empty.flags[2].blindPaths[0].detail.includes("malformed stamp"));
  });
}

// ── S6 · unjoinable stamps — disclosed, never charged ────────────────────────
{
  const r = assessSig(multiWriterLog(MW_ORDERLY), {
    ...MW_CFG,
    clerkClockSource: stamps([
      { seq: 0, clerkSeq: 1, wall: 10_000 },
      { seq: 1, clerkSeq: 2, wall: 10_001 },
      { seq: 2, clerkSeq: 3, wall: 10_002 },
      { seq: 3, clerkSeq: 4, wall: 10_003 },
      { seq: 99, clerkSeq: 5, wall: 10_004 },
    ]),
  });
  check("T3 S6 · a stamp for a record this log does not hold is COUNTED, not charged", () => {
    assert.strictEqual(r.flags[2].kind, "SILENT");
    assert.strictEqual(r.verdict.kind, "SILENT");
    const c = r.clerkStampCoverage;
    assert.ok(c !== null);
    assert.strictEqual(c.unjoinableStampCount, 1);
    assert.strictEqual(c.stampedCount, 4);
    const d = bothLines(r.verdict);
    assert.deepStrictEqual([d.pilot, d.baseline], ["RELEASE", "RELEASE"]);
  });
}

// ── S7 · the LIVE file's shape: duplicate sequenceNumbers ────────────────────
//
// /var/lib/mica/clerk-clock-stamps.jsonl holds 27 stamps with TEN duplicated
// sequence numbers. UNTIL T6 this refused the WHOLE LEG before any watermark
// logic ran, so pointing F3 at the real file made every item in T3 unreachable
// on the very box T3 was built for.
//
// ⛔ T6 CHANGES THIS DELIBERATELY, AND IT IS THE TICKET'S POINT. Duplicates are
// resolved by the record's own authority: a stamp disagreeing with the record at
// its sequence is discarded and disclosed. Only when MORE THAN ONE stamp still
// AGREES is there a real ambiguity — one writer stamping its own sequence twice
// — and that leaves THAT RECORD unstamped while every other record still reads.
{
  const r = assessSig(multiWriterLog(MW_ORDERLY), {
    ...MW_CFG,
    clerkClockSource: stamps([
      { seq: 0, clerkSeq: 1, wall: 10_000 },   // both default to w1, the writer of
      { seq: 0, clerkSeq: 2, wall: 10_001 },   // record 0 — so both AGREE: ambiguous
    ]),
  });
  check("T3 S7 · duplicates no longer BLIND THE LEG — the leg reaches coverage", () => {
    assert.notStrictEqual(
      r.clerkStampCoverage,
      null,
      "T6: F3 must get as far as coverage instead of refusing the whole leg"
    );
    assert.ok(
      !JSON.stringify(r.flags[2]).includes("cannot choose between them"),
      "the blanket refusal must be gone"
    );
  });
  check("T3 S7 · the ambiguous SEQUENCE is disclosed by number, and its record is unstamped", () => {
    assert.deepStrictEqual(r.clerkStampCoverage!.ambiguousStampSequences, [0]);
  });
}

// ── S7b · A MISLABELLED STAMP IS DISCARDED AND DISCLOSED, NEVER USED ─────────
//
// T6's core claim. The stamp's moduleId is the carrier's CLAIM about a record it
// read; the RECORD's identity is authoritative. A stamp landing on sequence 1
// claiming "w1" when record 1 was written by w2 is not evidence about record 1 —
// it is evidence that the carrier is wrong about something.
//
// ⛔ AND THE DIRECTION OF THE COST IS THE WHOLE DESIGN: the discarded stamp
// leaves record 1 UNSTAMPED, which under T3's watermark reads as a HOLE and
// composes CANNOT_ASSESS. A mislabelled stamp therefore COSTS A READING rather
// than buying one. Keying the join on the stamp's moduleId would have done the
// opposite — that is the fail-open T3(1) refuses and T6 does not reintroduce.
{
  const r = assessSig(multiWriterLog(MW_ORDERLY), {
    ...MW_CFG,
    clerkClockSource: [
      ...stamps([{ seq: 0, clerkSeq: 1, wall: 10_000 }]),                  // w1, agrees
      { ...stamps([{ seq: 1, clerkSeq: 2, wall: 10_001 }])[0], moduleId: "w1" }, // record 1 is w2
      ...stamps([{ seq: 2, clerkSeq: 3, wall: 10_002 }]),                  // w1, agrees
      ...stamps([{ seq: 3, clerkSeq: 4, wall: 10_003 }]),                  // w2, agrees
    ],
  });
  check("T3 S7b · the mislabelled stamp is COUNTED and its claimed writer NAMED", () => {
    assert.strictEqual(r.clerkStampCoverage!.mismatchedWriterStampCount, 1);
    assert.deepStrictEqual(r.clerkStampCoverage!.mismatchedWriterIdentities, ["w1"]);
  });
  check("T3 S7b · it is NEVER USED — the record it claimed is a HOLE, and F3 says so", () => {
    assert.strictEqual(
      r.flags[2].kind,
      "CANNOT_ASSESS",
      `a discarded stamp must cost a reading, not buy one: ${JSON.stringify(r.flags[2])}`
    );
  });
}

// ── S7c · CODEX'S MISMATCH-AS-TAIL TEST — THE FAIL-OPEN ONE STEP OVER ───────
//
// THE ATTACK, and the first T6 was open to it. A rejected stamp left its record
// UNSTAMPED, and an unstamped record ABOVE its writer's high-water mark is an
// ordinary TAIL — disclosed, not charged. So a stamp carrying the WRONG WRITER
// could take a record that ALARMS when correctly labelled and file it as "the
// carrier has not got there yet", leaving the leg SILENT.
//
// ⛔ MISLABELLING MUST NEVER BE CHEAPER THAN LABELLING CORRECTLY. The arbiter's ruling,
// 2026-09-28: a sequence carrying stamps of which none agrees returns a TYPED
// CANNOT_ASSESS at ANY placement, and a rejected stamp is never filed as tail.
//
// The pair below is the whole test: the SAME two stamps, in the SAME inverted
// order, differing only in the writer they name.
{
  // RIGHT LABEL: the inversion is seen and the leg ALARMS.
  const rightLabel = assessSig(log, { ...base, clerkClockSource: source([2, 1]) });

  // WRONG LABEL: identical stamps, one naming a writer that did not write the
  // record. Records here are written by "m".
  const wrongLabel = assessSig(log, {
    ...base,
    clerkClockSource: source([2, 1]).map((st, i) =>
      i === 0 ? { ...st, moduleId: "somebody-else" } : st
    ),
  });

  check("T3 S7c · RIGHT LABEL — the inversion ALARMS", () => {
    assert.strictEqual(rightLabel.flags[2].kind, "ALARM");
  });

  check("T3 S7c · WRONG LABEL — the leg MUST NOT go SILENT (the fail-open)", () => {
    assert.notStrictEqual(
      wrongLabel.flags[2].kind,
      "SILENT",
      `mislabelling a stamp silenced a leg that ALARMS when labelled correctly: ${JSON.stringify(wrongLabel.flags[2])}`
    );
  });

  check("T3 S7c · and it is TYPED — WRITER_IDENTITY_MISMATCH, not a tail and not a skip", () => {
    assert.strictEqual(wrongLabel.flags[2].kind, "CANNOT_ASSESS");
    const detail = wrongLabel.flags[2].blindPaths.map((b) => b.detail).join(" | ");
    assert.ok(
      detail.includes(F3_WRITER_IDENTITY_MISMATCH_TOKEN),
      `expected ${F3_WRITER_IDENTITY_MISMATCH_TOKEN}: ${detail}`
    );
    assert.ok(
      !detail.includes(F3_CARRIER_SKIPPED_TOKEN),
      `a rejected stamp must not be reported as a carrier SKIP: ${detail}`
    );
  });

  check("T3 S7c · the rejected sequence is named on coverage, and never counted as tail", () => {
    assert.deepStrictEqual(wrongLabel.clerkStampCoverage!.rejectedMismatchSequenceNumbers, [0]);
    assert.strictEqual(
      wrongLabel.clerkStampCoverage!.tailCount,
      0,
      "a rejected stamp must never be filed as tail"
    );
  });
}

// ── S8 · A WRITER THE CARRIER HAS NEVER VISITED — MUTANT SENTINEL M5 ─────────
//
// ADDED BY T5. THE T3 BUILD SEAT PREDICTED ITS OWN BLIND SPOT IN WRITING:
//
//   "a fifth mutant I did not write and would value: make `unreachedWriters`
//    blind the leg instead of disclosing it, and see whether any test notices.
//    I believe none does — it is a ruled fork, not a tested one."
//
// The cold verifier ran it. The mutant COMPILED and PASSED both focused suites
// (34/34 here, 47/47 on the snapshot). The seat was right about its own gap:
// the implementation is correct on this case and nothing checked in protected
// it, so the next builder could have flipped the fork back with a green suite.
// This check is that protection, and it is the reason T5's ticket opens this
// file at all.
//
// THE FORK IT PINS. w2 has NO stamp anywhere, so `markByWriter` holds no mark
// for it and F3 cannot tell "the carrier has never visited this writer" from
// "the carrier has not caught up with it". T3 RULED: DISCLOSE, do not blind —
// `unreachedWriters` names them, they are counted in the tail, and the leg
// stays SILENT. A builder who reads "cannot tell" as "cannot assess" turns an
// ordinary lag on a quiet writer into a hold, which is the S3 failure again by
// another door.
{
  const r = assessSig(multiWriterLog(MW_ORDERLY), {
    ...MW_CFG,
    // w1's two records (seq 0, 2) are stamped. w2's two (seq 1, 3) are NOT, and
    // w2 has no stamp at all, so it has no high-water mark to be compared to.
    clerkClockSource: stamps([
      { seq: 0, clerkSeq: 1, wall: 10_000 },
      { seq: 2, clerkSeq: 2, wall: 10_002 },
    ]),
    clerkStampLagBoundMs: 30_000,
    readAtMs: 10_003,
  });
  check("T3 S8 · a writer with NO stamp at all is DISCLOSED, never a blinding", () => {
    // THE KILL for M5: the mutant returns CANNOT_ASSESS here.
    assert.strictEqual(r.flags[2].kind, "SILENT", "an unreached writer must NOT blind the leg");
    assert.strictEqual(r.flags[2].blindPaths.length, 0, "and must produce no blind path");
    assert.strictEqual(r.verdict.kind, "SILENT");
  });
  check("T3 S8 · the unreached writer is NAMED, and its records counted as TAIL", () => {
    const c = r.clerkStampCoverage;
    assert.ok(c !== null);
    assert.deepStrictEqual(c.unreachedWriters, ["w2"], "the writer nobody reached must be named");
    assert.strictEqual(c.stampedCount, 2);
    assert.strictEqual(c.tailCount, 2, "its records are tail — the carrier has not reached them");
    assert.strictEqual(c.holeCount, 0, "a writer with no mark can produce no hole");
    assert.deepStrictEqual(c.holeSequenceNumbers, []);
  });
  check("T3 S8 · disposition stays RELEASE under BOTH lines — no hold is manufactured", () => {
    const d = bothLines(r.verdict);
    assert.deepStrictEqual([d.pilot, d.baseline], ["RELEASE", "RELEASE"]);
    assert.strictEqual(d.baselineExec, true);
  });
}

// ── item (4) · THE ORDER DEVIATION AS A NUMBER ───────────────────────────────
{
  const clean = assessSig(multiWriterLog(MW_ORDERLY), {
    ...MW_CFG,
    clerkClockSource: stamps([
      { seq: 0, clerkSeq: 1, wall: 10_000 },
      { seq: 1, clerkSeq: 2, wall: 10_001 },
      { seq: 2, clerkSeq: 3, wall: 10_002 },
      { seq: 3, clerkSeq: 4, wall: 10_003 },
    ]),
  });
  check("T3 (4) · a SILENT F3 still reports its deviation — headroom is a reading", () => {
    const dev = clean.f3Deviation;
    assert.ok(dev !== null);
    assert.strictEqual(dev.pairsCompared, 3);
    assert.strictEqual(dev.clockToleranceMs, 0);
    // Declared time ran FORWARD with the clerk on every pair, so the largest
    // "inversion" is negative: the clean direction, and a real distance.
    assert.strictEqual(dev.maxDeclaredInversionMs, -1_000);
    assert.strictEqual(dev.distanceMs, dev.maxDeclaredInversionMs - dev.clockToleranceMs);
  });
  check("T3 (4) · an ALARMing F3 reports the SAME number the finding's prose quotes", () => {
    const dev = contradicted.f3Deviation;
    assert.ok(dev !== null);
    assert.strictEqual(dev.maxDeclaredInversionMs, 1_000);
    assert.strictEqual(dev.clockToleranceMs, 0);
    assert.strictEqual(dev.distanceMs, 1_000);
    const finding = contradicted.verdict.kind === "ALARM"
      ? contradicted.verdict.findings.find((f) => f.code === "SIG_F3_DECLARED_VS_CLERK_CLOCK_CONTRADICTION")
      : undefined;
    assert.ok(finding?.detail.includes("which is 1000 earlier"), "the prose and the number must not drift apart");
  });
}

// ── MUTANT SENTINEL M4 · THE DISCLOSURE MUST NOT REACH FlagReport ────────────
//
// Ticket condition 1. `sig/f3-consistent-report` and `sig/f3-absent-report` in
// verdict-logic.frozen.json ARE F3's whole FlagReport, compared with
// deepStrictEqual. One extra key on the report moves both, and that file is not
// opened by this ticket. This check fails HERE, in F3's own suite, rather than
// in a re-freeze argument.
check("T3 · F3's FlagReport grew NO new key — the frozen grammar is untouched", () => {
  const FROZEN_KEYS = ["flag", "name", "kind", "findings", "blindPaths", "scopeSize"];
  const shapes = [
    assessSig(multiWriterLog(MW_ORDERLY), MW_CFG),
    assessSig(multiWriterLog(MW_ORDERLY), {
      ...MW_CFG,
      clerkClockSource: stamps([{ seq: 0, clerkSeq: 1, wall: 10_000 }, { seq: 1, clerkSeq: 2, wall: 10_001 }]),
      clerkStampLagBoundMs: 1,
      readAtMs: 10_000_000,
      expectedChainIdentity: "chain-LIVE",
    }),
    consistent,
    contradicted,
  ];
  for (const r of shapes) {
    assert.deepStrictEqual(
      Object.keys(r.flags[2]).sort(),
      [...FROZEN_KEYS].sort(),
      `F3's FlagReport grew a key: ${JSON.stringify(Object.keys(r.flags[2]))}`
    );
  }
});

check("T3 · assessSig is still PURE — the staleness clock is INJECTED, never read", () => {
  // If `now` were read from the wall clock, this would be non-deterministic and
  // every frozen fixture would break on some future run rather than on this one.
  const cfg: SigConfig = {
    ...MW_CFG,
    clerkClockSource: stamps([{ seq: 0, clerkSeq: 1, wall: 10_000 }, { seq: 1, clerkSeq: 2, wall: 10_001 }]),
    clerkStampLagBoundMs: 30_000,
    readAtMs: 20_001,
  };
  const a = assessSig(multiWriterLog(MW_ORDERLY), cfg);
  const b = assessSig(multiWriterLog(MW_ORDERLY), cfg);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});

check("T3 · the printed ceiling says the tail is not read, and does not promise the carrier ran", () => {
  const text = sigScopeBlockText(["LOADED_VERIFIED"]);
  assert.ok(text.includes("AND THE TAIL IS NOT READ"));
  assert.ok(text.includes("THIS READER'S GUARANTEE"));
  assert.ok(text.includes("cannot verify that the carrier"));
  assert.ok(text.includes("F3 CANNOT VERIFY THE CARRIER VISITED EVERY WRITER"));
  assert.ok(text.includes("AND THE CHAIN-IDENTITY CHECK IS NARROWER THAN IT LOOKS"));
});

rmSync(mwRoot, { recursive: true, force: true });

rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} tests: ${passed} passed, 0 failed`);
