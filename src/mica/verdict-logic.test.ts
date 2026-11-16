// ──────────────────────────────────────────────────────────────────────────────
// MICA — VERDICT LOGIC IS UNCHANGED BY THE REACH ROUND
//   npx ts-node src/mica/verdict-logic.test.ts
//
// WHY THIS FILE EXISTS
//
//   The REACH round is a DELIVERY repair. It gives the two sensors a way to put
//   their reading in front of a party outside the loop. It is not a sensor
//   change, and the brief that commissioned it required both sensors' reading
//   logic to come out byte-identical.
//
//   That is a claim, so it needs something that can falsify it.
//
//   verdict-logic.frozen.json was captured by running both sensors over the
//   fixtures below BEFORE any file in this round was touched. It holds the
//   complete verdict object for each: kind, sensorId, the full summary string,
//   every finding code and detail, every blind-path class and detail. This file
//   recomputes all of them and demands exact equality.
//
//   Not just the KIND. The kind alone would pass while a summary quietly
//   reworded itself, and the summary is the part an outside reader actually
//   reads. Any drift in any character of any of the seventeen readings fails
//   this test.
//
//   IF THIS TEST FAILS, THE CORRECT RESPONSE IS ALMOST NEVER TO UPDATE THE
//   FROZEN FILE. The frozen file is the record of what the sensors said before
//   a round that was not supposed to change what they say. Re-freezing it to
//   make the suite green would delete the only evidence that something moved.
//
// ── THE BASELINE HAS BEEN RE-FROZEN ONCE, DELIBERATELY (2026-08-12) ───────────
//
//   The load-state gate round was RULED to change one string: the
//   NON_CLEAN_LOAD_STATE detail, which stopped naming a foreign type and started
//   printing the injected readable-state list. Two of the seventeen entries carry
//   that string.
//
//   "Almost never" is not "never", and the exception was handled as an exception
//   rather than as a regeneration:
//
//     · the old baseline was copied aside BEFORE anything was regenerated;
//     · the new one was generated from the same fixtures, with every fixture now
//       injecting readableLoadStates: ["LOADED_VERIFIED"] so behaviour was held;
//     · old and new were diffed FIELD BY FIELD, and the delta was asserted to be
//       exactly `blindPaths[0].detail` on `sig/in-memory-load-state` and
//       `eng/in-memory-load-state` — 2 differing fields, 15 entries byte-identical,
//       2 lines of 196 in the file. Same kind, same sensorId, same summary, same
//       blind-path class everywhere;
//     · both strings, before and after, are quoted in the build record.
//
//   A THIRD DIFFERENCE WOULD HAVE BEEN A FAILED ROUND, not a rounding difference.
//   There was no third difference. Any future re-freeze owes the same proof.
//
// ── THE SUBSTRATE-CORRECTIONS RE-FREEZE (2026-08-19, F5) — RATIFIED & SWAPPED ──
//
//   F5, arbiter-ruled (a): Sig's F3 (and the F2 re-entry leg) are VERDICT-BEARING.
//   A configured-but-blind F3 CANNOT_ASSESS now COMPOSES into the floor, and a
//   genuinely-unconfigured F3 is a distinct NON-VERDICT status, NOT_CONFIGURED.
//   That legitimately moves exactly ONE frozen entry — `sig/f3-absent-report`,
//   whose F3 flag report goes kind CANNOT_ASSESS -> NOT_CONFIGURED (and its
//   disclosure detail is reworded to say NOT CONFIGURED). Every other entry is
//   byte-identical: no configured clean/alarm F3 fixture moves, and no fixture
//   without a clerkClockSource moves (an unconfigured F3 was dropped before, and
//   is excluded now — same verdict bytes).
//
//   THE re-freeze was PRESENTED provisional and then RATIFIED. Handoff -68 §0.3
//   owed one mechanical act — "make the provisional the canonical baseline" — and
//   this file now carries it (performed 2026-08-19 as its own step, ahead of the
//   narrow-T build, per SUBSTRATE_CORRECTIONS_BUILD_RECORD §3 + Deviation 1):
//     · the CANONICAL baseline `verdict-logic.frozen.json` now CARRIES the ratified
//       F5 delta, and live recomputation is checked against IT.
//     · the pre-F5 historical baseline is preserved BYTE-FOR-BYTE and hash-pinned
//       at E06F99…B13A8B1B in `verdict-logic.frozen.pre-substrate-20260819.json` —
//       the archive the pin now guards (asserted below).
//     · the transient `verdict-logic.frozen.provisional-20260819.json` is RETIRED:
//       its content was promoted into the canonical file, so a byte-identical
//       "provisional" copy would only be a second place for the baseline to drift.
//     · the delta archive->canonical is STILL asserted to be EXACTLY the one entry,
//       with old and new both quoted in the build records.
// ──────────────────────────────────────────────────────────────────────────────

import assert from "assert";
import { createHash } from "crypto";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MicaFixtureLog } from "./fixture-log";
import { assessSig } from "./sig";
import { assessEng } from "./eng";
import type { PreconditionMap, SigConfig } from "./sig";
import type { EngConfig } from "./eng";
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

const root = mkdtempSync(join(tmpdir(), "mica-vl-"));
let counter = 0;

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

// ── Fixtures — identical to the ones the freeze was captured from ────────────

const TEST_MAP: PreconditionMap = {
  escalation_active: ["escalation_granted"],
  quarantine_lifted: ["quarantine_entered", "operator_override"],
};
const SIG_CFG: SigConfig = {
  readableLoadStates: GATE,
  clockToleranceMs: 0,
  preconditionMap: TEST_MAP,
};

const CLEAN_SPECS: readonly Spec[] = [
  { timestamp: T0 + 0, eventType: "boot", outcome: "ok" },
  { timestamp: T0 + 10, eventType: "escalation_granted", outcome: "granted" },
  { timestamp: T0 + 20, eventType: "escalation_active", outcome: "active" },
  { timestamp: T0 + 20, eventType: "canary_check", outcome: "clean" },
  { timestamp: T0 + 30, eventType: "quarantine_entered", outcome: "entered" },
  { timestamp: T0 + 40, eventType: "quarantine_lifted", outcome: "lifted" },
];

const INVERTED: readonly Spec[] = [
  { timestamp: T0 + 500, eventType: "a", outcome: "ok" },
  { timestamp: T0 + 100, eventType: "b", outcome: "ok" },
];

const F2_VIOLATED: readonly Spec[] = [
  { timestamp: T0 + 0, eventType: "boot", outcome: "ok" },
  { timestamp: T0 + 10, eventType: "escalation_active", outcome: "escalation_in_force" },
  { timestamp: T0 + 20, eventType: "escalation_granted", outcome: "granted" },
];

const CLASSES = [
  { moduleId: "m3", eventType: "canary_check" },
  { moduleId: "m5", eventType: "drift_sample" },
  { moduleId: "m7", eventType: "permission_check" },
];

function specs(n: number, outcomeOf: (i: number) => string): Spec[] {
  const out: Spec[] = [];
  for (let i = 0; i < n; i++) {
    const c = CLASSES[i % CLASSES.length];
    out.push({
      moduleId: c.moduleId,
      eventType: c.eventType,
      outcome: outcomeOf(i),
      timestamp: T0 + i,
    });
  }
  return out;
}

const ENG_CFG: EngConfig = {
  readableLoadStates: GATE,
  structureThreshold: 0.2,
  minimumSampleSize: 30,
  ceilingMargin: 0.02,
  // T11. Injected so these scenarios keep reading the record they were
  // frozen against. The sensor has no default and refuses without it, so an
  // omission here would turn every eng scenario into MISSING_CONFIGURATION —
  // which is what it did on the first run of this change.
  minimumClassCoverage: 3,
  permutationSamples: 400,
  permutationSeed: 20260806,
};
const ENG_CFG_NO_CEILING: EngConfig = {
  readableLoadStates: GATE,
  structureThreshold: 0.2,
  minimumSampleSize: 30,
  minimumClassCoverage: 3,
  permutationSamples: 400,
  permutationSeed: 20260806,
};

const HEALTHY = specs(90, (i) =>
  i % 4 === 0 ? "deferred" : `verdict_class_${i % CLASSES.length}`
);
const PERFECT = specs(60, (i) => `verdict_class_${i % CLASSES.length}`);
const FLATTENED = specs(60, () => "approved");
const NOISE_DISTINCT = specs(60, (i) => `outcome_unique_${i}`);

const F3_SPECS: readonly Spec[] = [
  { timestamp: T0 + 1_000, eventType: "a", outcome: "ok" },
  { timestamp: T0 + 2_000, eventType: "b", outcome: "ok" },
];
/**
 * ⛔ T8 · A STAMP THAT DOES NOT NAME ITS CHAIN IS REFUSED, and these fixtures did
 *    not name one. T8 shipped, was re-pinned and was SPENT, and from that moment
 *    `F3_SOURCE`'s stamps were refused wholesale: `sig/f3-consistent-report` went
 *    SILENT -> CANNOT_ASSESS (INELIGIBLE_SCOPE, scopeSize 0) and
 *    `sig/f3-contradiction-f1-silent` went ALARM -> CANNOT_ASSESS, both with
 *    "CHAIN_IDENTITY_MISSING: 2 stamp(s) carry NO chainIdentity … ALL OF THEM ARE
 *    REFUSED". Two of the twenty frozen entries had been failing identically in
 *    every sweep since, and a differential cannot see a constant.
 *
 * ⚠ THE BASELINE WAS NEVER WRONG — THE FIXTURE WAS. The frozen entries record the
 *   readings T8 PRESERVED; repairing the fixture restores them and the frozen
 *   file needs no edit to either one. My first diagnosis had the culprit the
 *   other way round and said the baseline was stale.
 *
 * AND THE SHAPE OF THE REPAIR IS T6's, ONE TICKET EARLIER, in the comment just
 * below: a fixture modelling an ORDINARY carry is updated to satisfy the new
 * precondition, and the DELIBERATE violation gets its own scenario rather than
 * being every fixture's incidental state. `sig/f3-no-chain-identity` is that
 * scenario, so the blind reading this drift produced is now recorded on purpose.
 */
const F3_CHAIN = "chain-freeze-f3";

const F3_SOURCE = (reversed: boolean, chained = true) => [
  {
    // T6 · THE STAMP CARRIES THE RECORD'S OWN WRITER, because that is what the
    // carrier writes (`moduleId: record.moduleId`, mica-clerk-caller.ts:914). Until
    // T6 the join ignored this field, so these fixtures could name any writer and
    // still join. Under T6 a disagreeing stamp is DISCARDED and DISCLOSED, so a
    // fixture modelling an ORDINARY carry must agree. The DELIBERATE mismatch now
    // has its own scenario rather than being every fixture's incidental state.
    moduleId: "m6",
    sequenceNumber: 0,
    clerk_seq: reversed ? 2 : 1,
    clerk_time: { wall_ms: T0 + 10_000, monotonic_ns: "100" },
    separation: "SEPARATE_PROCESS" as const,
    intake: "SOCKET" as const,
    clerk_id: "clerk-freeze",
    clerk_boot_id: "boot-freeze",
    ...(chained ? { chainIdentity: F3_CHAIN } : {}),
  },
  {
    // T6 · THE STAMP CARRIES THE RECORD'S OWN WRITER, because that is what the
    // carrier writes (`moduleId: record.moduleId`, mica-clerk-caller.ts:914). Until
    // T6 the join ignored this field, so these fixtures could name any writer and
    // still join. Under T6 a disagreeing stamp is DISCARDED and DISCLOSED, so a
    // fixture modelling an ORDINARY carry must agree. The DELIBERATE mismatch now
    // has its own scenario rather than being every fixture's incidental state.
    moduleId: "m6",
    sequenceNumber: 1,
    clerk_seq: reversed ? 1 : 2,
    clerk_time: { wall_ms: T0 + 10_001, monotonic_ns: "101" },
    separation: "SEPARATE_PROCESS" as const,
    intake: "SOCKET" as const,
    clerk_id: "clerk-freeze",
    clerk_boot_id: "boot-freeze",
    ...(chained ? { chainIdentity: F3_CHAIN } : {}),
  },
];

// ── Freeze/compare ───────────────────────────────────────────────────────────

function freeze(v: SensorVerdict): Record<string, unknown> {
  const base: Record<string, unknown> = {
    kind: v.kind,
    sensorId: v.sensorId,
    summary: v.summary,
  };
  if (v.kind === "ALARM") {
    base.findings = (v as AlarmVerdict).findings.map((f) => ({
      code: f.code,
      detail: f.detail,
    }));
    base.severity = (v as AlarmVerdict).severity ?? null;
  }
  if (v.kind === "CANNOT_ASSESS") {
    base.blindPaths = (v as CannotAssessVerdict).blindPaths.map((b) => ({
      class: b.class,
      detail: b.detail,
    }));
  }
  return base;
}

const live: Record<string, unknown> = {};

live["sig/clean-both-flags-read"] = withDurable(CLEAN_SPECS, (l) =>
  freeze(assessSig(l, SIG_CFG).verdict)
);
live["sig/f1-inverted-pair"] = withDurable(INVERTED, (l) =>
  freeze(assessSig(l, SIG_CFG).verdict)
);
live["sig/f1-alarm-while-f2-unread"] = withDurable(INVERTED, (l) =>
  freeze(assessSig(l, { readableLoadStates: GATE, clockToleranceMs: 0 }).verdict)
);
live["sig/f2-precondition-unreached"] = withDurable(F2_VIOLATED, (l) =>
  freeze(assessSig(l, SIG_CFG).verdict)
);
live["sig/no-config-at-all"] = withDurable(CLEAN_SPECS, (l) =>
  freeze(assessSig(l, { readableLoadStates: GATE }).verdict)
);
live["sig/no-map-f2-dormant"] = withDurable(CLEAN_SPECS, (l) =>
  freeze(assessSig(l, { readableLoadStates: GATE, clockToleranceMs: 0 }).verdict)
);
live["sig/empty-map"] = withDurable(CLEAN_SPECS, (l) =>
  freeze(assessSig(l, { readableLoadStates: GATE, clockToleranceMs: 0, preconditionMap: {} }).verdict)
);
live["sig/single-entry-ineligible"] = withDurable(
  [{ timestamp: T0, eventType: "boot", outcome: "ok" }],
  (l) => freeze(assessSig(l, SIG_CFG).verdict)
);
{
  const inMem = new MicaFixtureLog();
  appendAll(inMem, CLEAN_SPECS);
live["sig/in-memory-load-state"] = freeze(assessSig(inMem, SIG_CFG).verdict);
}
live["sig/f3-consistent-report"] = withDurable(F3_SPECS, (l) =>
  assessSig(l, {
    readableLoadStates: GATE,
    clockToleranceMs: 0,
    preconditionMap: { b: ["a"] },
    clerkClockSource: F3_SOURCE(false),
    // T8 · without this every stamp above is refused and F3 reads blind.
    expectedChainIdentity: F3_CHAIN,
  }).flags[2]
);
live["sig/f3-absent-report"] = withDurable(F3_SPECS, (l) =>
  assessSig(l, {
    readableLoadStates: GATE,
    clockToleranceMs: 0,
    preconditionMap: { b: ["a"] },
  }).flags[2]
);
live["sig/f3-contradiction-f1-silent"] = withDurable(F3_SPECS, (l) =>
  freeze(
    assessSig(l, {
      readableLoadStates: GATE,
      clockToleranceMs: 0,
      preconditionMap: { b: ["a"] },
      clerkClockSource: F3_SOURCE(true),
      // T8 · see above; this is the arm that carries the F3 contradiction.
      expectedChainIdentity: F3_CHAIN,
    }).verdict
  )
);

// ⛔ T8's DELIBERATE VIOLATION, AS ITS OWN SCENARIO. The same specs and the same
//    reversed clerk order as the contradiction arm above — so the ONLY difference
//    is that the stamps name no chain — and the reading it freezes is the blind
//    one the drift produced by accident. A rule worth shipping is worth a fixture.
live["sig/f3-no-chain-identity"] = withDurable(F3_SPECS, (l) =>
  freeze(
    assessSig(l, {
      readableLoadStates: GATE,
      clockToleranceMs: 0,
      preconditionMap: { b: ["a"] },
      clerkClockSource: F3_SOURCE(true, false),
      expectedChainIdentity: F3_CHAIN,
    }).verdict
  )
);

live["eng/healthy-anchor"] = withDurable(HEALTHY, (l) =>
  freeze(assessEng(l, ENG_CFG).verdict)
);
live["eng/perfect-at-ceiling"] = withDurable(PERFECT, (l) =>
  freeze(assessEng(l, ENG_CFG).verdict)
);
live["eng/perfect-ceiling-not-performed"] = withDurable(PERFECT, (l) =>
  freeze(assessEng(l, ENG_CFG_NO_CEILING).verdict)
);
live["eng/flattened-collapse"] = withDurable(FLATTENED, (l) =>
  freeze(assessEng(l, ENG_CFG).verdict)
);
live["eng/noise-all-distinct-outcomes"] = withDurable(NOISE_DISTINCT, (l) =>
  freeze(assessEng(l, ENG_CFG).verdict)
);
live["eng/no-config-at-all"] = withDurable(HEALTHY, (l) =>
  freeze(assessEng(l, { readableLoadStates: GATE }).verdict)
);
live["eng/insufficient-sample"] = withDurable(HEALTHY, (l) =>
  freeze(assessEng(l, { ...ENG_CFG, minimumSampleSize: 1000 }).verdict)
);
{
  const inMem = new MicaFixtureLog();
  appendAll(inMem, HEALTHY);
  live["eng/in-memory-load-state"] = freeze(assessEng(inMem, ENG_CFG).verdict);
}

// ── The assertions ───────────────────────────────────────────────────────────

console.log("\nMICA — verdict logic unchanged by the REACH round\n");

// The CANONICAL baseline now carries the ratified F5 delta and is what live is
// checked against. The pre-F5 historical baseline survives only in the archive,
// which the hash pin now guards. (§0.3 swap, 2026-08-19 — see the header.)
const canonicalPath = join(__dirname, "verdict-logic.frozen.json");
const archivePath = join(__dirname, "verdict-logic.frozen.pre-substrate-20260819.json");
const HISTORICAL_PIN =
  "E06F990F510BE6B83589D3EA4ADA6A5E52654927416184A5236092BDB13A8B1B";

const archiveRaw = readFileSync(archivePath, "utf8");
const historical = JSON.parse(archiveRaw) as Record<string, unknown>;
const frozen = JSON.parse(readFileSync(canonicalPath, "utf8")) as Record<
  string,
  unknown
>;

// ── §3 re-freeze proof (F5), post-swap ────────────────────────────────────────

check("the pre-F5 historical baseline is preserved byte-for-byte and hash-pinned at E06F99…", () => {
  const sha = createHash("sha256").update(archiveRaw, "utf8").digest("hex").toUpperCase();
  assert.strictEqual(sha, HISTORICAL_PIN, "the archived historical baseline moved — the pin is broken");
});

check("the §0.3 swap is applied — the canonical baseline is NOT the pre-F5 archive", () => {
  const canonicalRaw = readFileSync(canonicalPath, "utf8");
  assert.notStrictEqual(
    canonicalRaw,
    archiveRaw,
    "verdict-logic.frozen.json is byte-identical to the pre-F5 archive — the ratified swap was reverted"
  );
});

check("archive -> canonical delta is EXACTLY THE FOUR RULED RE-FREEZES", () => {
  // ⛔ FOUR SINCE 2026-10-02, AND IT WAS TWO BEFORE. This assertion is the guard
  //    the 2026-08-12 header means by "A THIRD DIFFERENCE WOULD HAVE BEEN A
  //    FAILED ROUND", and T11 was the second difference — ruled, not drifted.
  //
  //    ⚠ THE THIRD AND FOURTH ARE NOT LIKE THE FIRST TWO, AND THE DIFFERENCE IS
  //      WORTH THE LINE. F5 and T11 each moved a VERDICT — what the sensor
  //      concludes. T17 moves neither: both entries keep `kind: SILENT` and their
  //      findings and blindPaths BYTE-IDENTICAL, and only `summary` grows, because
  //      Eng now discloses the margins its alarm path always carried. The
  //      re-freeze script proved that by SUBTRACTION — strip the inserted margin
  //      block from the new summary and what remains equals the old one exactly —
  //      and it refused to touch the two pre-existing sig/f3 entries, which are
  //      red at the base commit and are not T17's to ratify.
  //
  //      sig/f3-absent-report   F5, 2026-08-19. A configured-but-blind F3
  //                             CANNOT_ASSESS composes into the floor and a
  //                             genuinely-unconfigured F3 becomes its own
  //                             non-verdict status.
  //      eng/healthy-anchor     T17, 2026-10-02. DISCLOSURE ONLY. The quiet Eng
  //                           summary now carries plug-in MI, E[MI], H(C) and
  //                           H(O) — the four its ALARM detail always carried
  //                           and its SILENT text never did, so a reading that
  //                           found nothing left no record of HOW. Verdict
  //                           unchanged: kind, findings and blindPaths are
  //                           byte-identical and only `summary` grew.
  //      eng/perfect-ceiling-not-performed
  //                           T17, 2026-10-02. The same insertion, on the
  //                           fixture whose ceiling check did not run.
  //                           Verdict unchanged.
  //      eng/no-config-at-all   T11, the arbiter's ruling (a), board §1b 2026-10-01
  //                             11:06Z. Eng requires a THIRD declared floor
  //                             (readers.eng.minimumClassCoverage), so a
  //                             scenario that injects NO configuration now names
  //                             three missing floors where it named two. ⚠ THE
  //                             SENSOR HAS ONE MORE THING TO BE MISSING — the
  //                             baseline moves BY DECISION, which is what an
  //                             anti-drift anchor is for, and NOT because a
  //                             reading drifted.
  //
  // ⚠ THE ARCHIVE IS NOT TOUCHED AND MUST NEVER BE. It is hash-pinned above and
  //   is the only surviving record of what the sensors said before either
  //   re-freeze. Moving the entry THERE instead of widening this list would have
  //   made the suite green by deleting the evidence — which is the move this
  //   whole file exists to prevent.
  const changed = Object.keys(historical).filter(
    (k) => JSON.stringify(historical[k]) !== JSON.stringify(frozen[k])
  );
  assert.deepStrictEqual(
    changed,
    // ⚠ ARCHIVE KEY ORDER, not alphabetical: `changed` is built by filtering
    //   Object.keys(historical), so this array pins the ORDER too. Sorting it
    //   here to make it read nicely would quietly weaken the assertion.
    ["eng/healthy-anchor", "eng/perfect-ceiling-not-performed", "eng/no-config-at-all", "sig/f3-absent-report"],
    "the archive->canonical delta is not exactly the four RULED re-freezes"
  );

  // F5's entry, unchanged claim.
  const before = historical["sig/f3-absent-report"] as { kind: string };
  const after = frozen["sig/f3-absent-report"] as { kind: string };
  assert.strictEqual(before.kind, "CANNOT_ASSESS", "archived pre-F5 kind");
  assert.strictEqual(after.kind, "NOT_CONFIGURED", "canonical post-F5 kind (F5 honest split)");

  // T11's entry, and the per-entry check is TIGHTER than the old key-list check:
  // the third floor is ADDED, the first two are byte-identical, and nothing else
  // in the entry moves. A widened list that did not say this would have traded a
  // guard for a permission.
  type Blind = { class: string; detail: string };
  type EngEntry = { kind: string; sensorId: string; blindPaths: Blind[]; summary: string };
  const b = historical["eng/no-config-at-all"] as EngEntry;
  const a = frozen["eng/no-config-at-all"] as EngEntry;
  assert.strictEqual(b.blindPaths.length, 2, "the archive names TWO missing floors");
  assert.strictEqual(a.blindPaths.length, 3, "the canonical names THREE");
  assert.deepStrictEqual(a.blindPaths.slice(0, 2), b.blindPaths, "the first two floors moved");
  assert.strictEqual(a.blindPaths[2].class, "MISSING_CONFIGURATION", "the added floor's class");
  assert.match(a.blindPaths[2].detail, /minimumClassCoverage/, "the added floor names its field");
  assert.strictEqual(a.kind, b.kind, "the verdict kind moved — this ticket does not authorise that");
  assert.strictEqual(a.sensorId, b.sensorId, "the sensorId moved");
  assert.strictEqual(
    a.summary,
    b.summary.replace(
      "(MISSING_CONFIGURATION, MISSING_CONFIGURATION)",
      "(MISSING_CONFIGURATION, MISSING_CONFIGURATION, MISSING_CONFIGURATION)"
    ),
    "the summary moved by more than the one added floor in its parenthetical"
  );
});

check("the canonical baseline is present and non-empty", () => {
  assert.ok(Object.keys(frozen).length > 0);
});

check("every frozen fixture is still exercised — none quietly dropped", () => {
  const missing = Object.keys(frozen).filter((k) => !(k in live));
  assert.deepStrictEqual(
    missing,
    [],
    `fixtures in the freeze but not recomputed: ${missing.join(", ")}`
  );
});

check("no fixture was added without being frozen", () => {
  const extra = Object.keys(live).filter((k) => !(k in frozen));
  assert.deepStrictEqual(extra, []);
});

check("all three verdict kinds are represented, for BOTH sensors", () => {
  const kindsFor = (prefix: string): Set<string> =>
    new Set(
      Object.entries(live)
        .filter(([k]) => k.startsWith(prefix))
        .map(([, v]) => (v as { kind: string }).kind)
    );
  for (const prefix of ["sig/", "eng/"]) {
    const kinds = kindsFor(prefix);
    for (const want of ["ALARM", "SILENT", "CANNOT_ASSESS"]) {
      assert.ok(kinds.has(want), `${prefix} has no ${want} fixture`);
    }
  }
});

for (const key of Object.keys(frozen)) {
  check(`MATCHES SUBSTRATE-ERA BASELINE: ${key}`, () => {
    assert.deepStrictEqual(
      live[key],
      frozen[key],
      `verdict output for ${key} differs from the provisional substrate-era baseline`
    );
  });
}

// The delivery layer must not be reachable from the sensors at all: if
// assessSig/assessEng imported the exporter, a change there could change a
// verdict. The dependency runs one way only.
check("neither sensor imports the delivery layer (one-way dependency)", () => {
  for (const f of ["sig/index.ts", "eng/index.ts"]) {
    const src = readFileSync(join(__dirname, f), "utf8");
    assert.ok(
      !/from\s+["'][^"']*export[^"']*["']/.test(src),
      `${f} imports the export layer; verdicts could then depend on delivery`
    );
  }
});

rmSync(root, { recursive: true, force: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
