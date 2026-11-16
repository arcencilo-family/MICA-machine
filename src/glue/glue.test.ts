// ── GLUE · the front door, tested end to end ─────────────────────────────────
//
// House style: standalone ts-node script, custom check() harness, no framework.
//   npx ts-node src/glue/glue.test.ts
//
// WHAT THIS FILE IS FOR
//
//   `src/glue/` is the first thing in this repository that calls
//   `Chokepoint.guard` outside a chokepoint test. Everything the chokepoint's
//   own suite proves about the DECISION is already proven there and is not
//   re-proven here. What is proven here is the WIRING: that a real file on disk
//   reaches a real reader, that a real reader's verdict reaches the floor, that
//   the four dispositions come out of a real invocation, and — most of all —
//   THAT THE ABSENCES STILL BITE.
//
//   The absences are the point. A front door is exactly where a permit gets
//   waved through because some destination was not configured, so every test
//   below that asserts a HOLD-BLIND on a missing path is asserting the thing
//   this build most easily could have got wrong.
//
// ── ONE THING THIS FILE CANNOT PROVE ABOUT ITSELF ─────────────────────────────
//
//   That the deployment routes anything through this door. `ROUTING_PRECONDITION`
//   says it at the chokepoint and it is no less true one level up: a front door
//   nobody walks through judges nothing, and no test here can tell the
//   difference. Stated, not mitigated.

import assert from "assert";
import { spawnSync } from "child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { MicaLogFile, FORBIDDEN_LOAD_STATE } from "./mica-log-file";
import {
  LOADED_SUBJECT_CHAIN_VERIFIED,
  SubjectChainLog,
  SubjectEventJournal,
} from "./subject-event-journal";
import type { MicaLogFileLoadState } from "./mica-log-file";
import {
  buildNotifier,
  CALLER_OWNED_NOTIFIER,
  footingsFromWiring,
  NARROW_K_NOT_DECLARED,
  NARROW_W_NOT_DECLARED,
  NARROW_R_NOT_DECLARED,
  OP1_NOT_DECLARED,
  NOTIFIER_OVERRIDE_CONFLICT,
  NARROW_T_NOT_DECLARED,
  NARROW_T_READER,
  OP3_HARNESS_PAIRING_CEILING,
  OP3_NOT_DECLARED,
  OP3_READER,
  GATE4_READER,
  GATE4_NOT_DECLARED,
  GATE4_SINGLE_WINDOW_CEILING,
  GATE1_READER,
  GATE1_BOOK_IS_THE_LOG,
  GATE1_BOOK_NOT_DECLARED,
  GATE1_BOOK_SOURCE_PREFIX,
  GATE1_NOT_DECLARED,
  GATE1_PERMANENTLY_UNREAD,
  GATE1_REACHED_IS_EXPOSURE,
  gate1EnvelopeLine,
  OP3_WINDOW_ABSENT,
  op3WindowNote,
  renderCensus,
  wire,
  WireUsageError,
} from "./wire";
import type { WireOptions } from "./wire";
import { T_POLARITY_NOTE } from "../mica/narrow-t";
import {
  assessGate1Scope,
  GATE1_SCOPE_CEILING_LINES,
  GIVEN_M_FRAME,
} from "../mica/gate1-scope";
import type { Gate1ScopeFrame } from "../mica/gate1-scope";
import { errorTailLine, exitCodeFor, parseArgs, run, tailLine } from "./mica-guard";
import { GuardInvocationError } from "./mica-guard";
import { renderDisposition } from "../mica/chokepoint";
import type { StakesLine } from "../mica/chokepoint";
import { evaluateRealDoor, requireShippable } from "../core-door/core-door";

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

// ── COMPILE-TIME GUARD · the adapter's state union can never gain the label ───
//
// A runtime probe can only show that the states it happened to construct were
// not `LOADED_VERIFIED`. This fails to COMPILE if the union ever gains it, which
// is the direction that actually matters: adding the label would be a deliberate
// edit that stops the build, not a quiet widening.
type MustBeNever<T extends never> = T;
type _AdapterNeverClaimsVerified = MustBeNever<
  Extract<MicaLogFileLoadState, "LOADED_VERIFIED">
>;

// ── fixtures ─────────────────────────────────────────────────────────────────

const ROOT = mkdtempSync(join(tmpdir(), "mica-glue-"));
let counter = 0;
function scratch(stem: string): string {
  const dir = join(ROOT, `${stem}-${counter++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const T0 = 1_700_000_000_000;

/** The three event classes the Eng suite uses. Copied, not imported: a fixture
 *  that tracked another suite's constants would stop being able to detect them
 *  changing underneath it. */
const CLASSES: readonly { moduleId: string; eventType: string }[] = [
  { moduleId: "m3", eventType: "canary_check" },
  { moduleId: "m5", eventType: "drift_sample" },
  { moduleId: "m7", eventType: "permission_check" },
];

interface LineSpec {
  sequenceNumber: number;
  timestamp: number;
  moduleId: string;
  eventType: string;
  outcome: string;
  actionId?: string;
}

/**
 * The healthy anchor, as JSONL: partially-but-genuinely responsive, 90 records
 * over three classes. This is the Eng suite's E2 fixture written to a file
 * instead of into a chained fixture log — which is the whole point of the
 * adapter under test.
 */
function healthySpecs(): LineSpec[] {
  const out: LineSpec[] = [];
  for (let i = 0; i < 90; i++) {
    const c = CLASSES[i % CLASSES.length];
    out.push({
      sequenceNumber: i,
      timestamp: T0 + i,
      moduleId: c.moduleId,
      eventType: c.eventType,
      outcome: i % 4 === 0 ? "deferred" : `verdict_class_${i % 3}`,
    });
  }
  return out;
}

function writeJsonl(dir: string, name: string, specs: readonly unknown[]): string {
  const path = join(dir, name);
  writeFileSync(path, specs.map((s) => JSON.stringify(s)).join("\n") + "\n", "utf8");
  return path;
}

/** The injected numbers. They live in the TEST; no instrument holds them. */
const ENG_CONFIG = {
  structureThreshold: 0.2,
  minimumSampleSize: 30,
  ceilingMargin: 0.02,
  // T11 · the observed-coverage floor, declared and with no default. Without it
  // Eng returns MISSING_CONFIGURATION and every decision below becomes a blind
  // hold, which is why its absence took twelve assertions in this file.
  //
  // ⚠ THIS FIXTURE IS ALSO WRITTEN OUT AS A `--sensor-config` FILE by the
  //   spawned-process tests below, so this one line exercises mica-guard's new
  //   ENG_POSITIVE_INTEGER_KEYS acceptance through a real process, not only the
  //   in-repo call. That is the same property the comment below records for
  //   `expectedChainIdentity`: what this fixture carries, the guard must accept.
  minimumClassCoverage: 3,
};
// T8 · an ORDINARY carry names its chain, and an ordinary config expects it.
//
// ⛔ AND IT IS NOT IN `SIG_CONFIG`, WHICH IS WHERE I FIRST PUT IT. `SIG_CONFIG`
// is also written out as a `--sensor-config` FILE by the spawned-process tests
// below, and `mica-guard` REFUSES `expectedChainIdentity` from a config file —
// "carries unknown key". THAT REFUSAL IS CORRECT AND IT CAUGHT THIS FIXTURE:
// the expected identity is the position-0 boundary hash of the log the readers
// read. It changes at every rotation and is a fact about the RECORD, not a
// choice a deployer makes — the same reason `clerkClockSource` has its own
// refusal from that file (the S109-B fence a few hundred lines up). A declared
// copy goes stale the instant the chain rotates, and a stale expected identity
// refuses every stamp of the live chain while looking perfectly well-formed.
//
// So it rides at the F3 CALL SITES, where the reader is wired in process.
const GLUE_CHAIN_LIVE = "chain-LIVE";
/** SIG_CONFIG plus the identity — for in-process wiring only, never a file. */
const SIG_CONFIG_T8 = () => ({ ...SIG_CONFIG, expectedChainIdentity: GLUE_CHAIN_LIVE });
const SIG_CONFIG = {
  clockToleranceMs: 0,
  // `permission_check` occurs at every i%3===2 and `canary_check` at every
  // i%3===0, so every governed record has a satisfying prior. A map that
  // governed nothing would leave F2 blind for INELIGIBLE_SCOPE.
  preconditionMap: { permission_check: ["canary_check"] },
};
const GATE: readonly string[] = ["LOADED_UNVERIFIED_FILE"];
const LINE: StakesLine = {
  classes: ["routine", "elevated", "critical"],
  holdAtOrAbove: "elevated",
};

/** A fixed decision clock, so a floor-trail record is byte-identical per run. */
const CLOCK = (): number => T0;

function baseOptions(logPath: string): WireOptions {
  return {
    logPath,
    readableLoadStates: GATE,
    eng: ENG_CONFIG,
    sig: SIG_CONFIG,
    decisionClock: CLOCK,
  };
}

function jsonlRecords(path: string): Record<string, unknown>[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** A minimal, direct write into a SubstrateHistory-shaped file, for the Stage 1 repair test. */
function writeSubstrateReadForTest(path: string, actionId: string, disposition: string): void {
  const h = new SubstrateHistory({ path });
  h.record({
    timestamp: T0,
    factors: [{ factor: "MICA/Eng", verdictKind: "SILENT" }],
    floorKind: "SILENT",
    disposition,
    execute: true,
    actionId,
  });
}

console.log("\n── MICA-GUARD · the front door ───────────────────────────────");

// ══ 7 · THE LOG ADAPTER ══════════════════════════════════════════════════════
//
// First, because everything below reads through it.

console.log("\n══ 7 · the JSONL adapter ═════════════════════════════════════");

check("a well-formed JSONL file loads, parses, and reports its own unverified state", () => {
  const dir = scratch("adapter-good");
  const path = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const log = new MicaLogFile({ path });
  assert.strictEqual(log.getLoadState(), "LOADED_UNVERIFIED_FILE");
  assert.deepStrictEqual(log.verify(), { valid: true });
  assert.strictEqual(log.length, 90);
  assert.strictEqual(log.getAll()[0].moduleId, "m3");
});

check("LOADED_VERIFIED is NEVER emitted, on any load this adapter can produce", () => {
  const dir = scratch("adapter-states");
  const seen: string[] = [];

  seen.push(new MicaLogFile({ path: join(dir, "nothing-here.jsonl") }).getLoadState());

  const empty = join(dir, "empty.jsonl");
  writeFileSync(empty, "\n\n", "utf8");
  seen.push(new MicaLogFile({ path: empty }).getLoadState());

  const malformed = join(dir, "malformed.jsonl");
  writeFileSync(malformed, '{"sequenceNumber":0}\nnot json\n', "utf8");
  seen.push(new MicaLogFile({ path: malformed }).getLoadState());

  const good = writeJsonl(dir, "good.jsonl", healthySpecs());
  seen.push(new MicaLogFile({ path: good }).getLoadState());

  assert.deepStrictEqual(seen, [
    "FILE_ABSENT",
    "FILE_EMPTY_OR_ERASED",
    "FILE_MALFORMED",
    "LOADED_UNVERIFIED_FILE",
  ]);
  for (const state of seen) {
    assert.notStrictEqual(
      state,
      FORBIDDEN_LOAD_STATE,
      `the adapter reported ${FORBIDDEN_LOAD_STATE} on an unchained file — a ` +
        `JSONL has no hash chain and can never earn that label`
    );
  }
});

check("verify() is FALSE on a broken sequence — and says where", () => {
  const dir = scratch("adapter-order");
  const specs = healthySpecs();
  specs[40].sequenceNumber = 3; // an out-of-order record, sequence goes backwards
  const path = writeJsonl(dir, "out-of-order.jsonl", specs);
  const log = new MicaLogFile({ path });
  assert.deepStrictEqual(log.verify(), { valid: false, brokenAt: 40 });
  // And the load state still reports what the PARSE achieved. Two independent
  // facts, kept independent: the file parsed; its ordering does not hold.
  assert.strictEqual(log.getLoadState(), "LOADED_UNVERIFIED_FILE");
});

// ── S127-6 (a) · ORDER IS PER WRITER ────────────────────────────────────────
//
//   The live log has three writers with three sequence spaces. The shape below
//   is NOT a copy of that file — the seat that wrote these checks could not
//   read it (`/var/lib/mica/mica-log.jsonl` is 0660 mica-registrar:mica-readers
//   and this principal is not in that group). Indices 0-2 are the arbiter's
//   description of the live head, pinned; indices 3-11 are a constructed
//   interleaving that exercises the property. Module and sequence are what
//   these checks are about; the other fields are filler and say nothing.

/** module/seq only — the twelve-record three-writer shape. */
const THREE_WRITER_SHAPE: readonly (readonly [string, number])[] = [
  ["mica-registrar", 0],
  ["mica-registrar", 1],
  ["mica-doctor", 0], // index 2 — the record the single-space check called a break
  ["mica-registrar", 2],
  ["mica-doctor", 1],
  ["mica-arbiter", 0],
  ["mica-registrar", 3],
  ["mica-doctor", 2],
  ["mica-arbiter", 1],
  ["mica-registrar", 4],
  ["mica-doctor", 3],
  ["mica-arbiter", 2],
];

function writerSpecs(pairs: readonly (readonly [string, number])[]): LineSpec[] {
  return pairs.map(([moduleId, sequenceNumber], i) => ({
    sequenceNumber,
    timestamp: T0 + i,
    moduleId,
    eventType: "canary_check",
    outcome: "clean",
  }));
}

check("S127-6 · three writers, three sequence spaces, interleaved — VERIFIES", () => {
  const dir = scratch("adapter-three-writers");
  const path = writeJsonl(dir, "three-writers.jsonl", writerSpecs(THREE_WRITER_SHAPE));
  const log = new MicaLogFile({ path });
  assert.strictEqual(log.length, 12);
  // The whole finding in one assertion: this is what exited 1 for eight nights.
  assert.deepStrictEqual(log.verify(), { valid: true });
  assert.strictEqual(log.getLoadState(), "LOADED_UNVERIFIED_FILE");
  // And each writer's first record is 0 — a first sighting is unconstrained.
  const firsts = new Map<string, number>();
  for (const r of log.getAll()) if (!firsts.has(r.moduleId)) firsts.set(r.moduleId, r.sequenceNumber);
  assert.deepStrictEqual([...firsts.values()], [0, 0, 0]);
});

check("S127-6 · a regression WITHIN one writer still breaks, at that index", () => {
  const dir = scratch("adapter-same-module-regression");
  // mica-doctor goes 0, 1, 2, then BACK to 2 at index 10 — the same writer
  // repeating a number it already minted. Its own previous record is at index 7
  // (seq 2), five records earlier in the file, so this is the per-writer
  // comparison doing the work and not an accident of adjacency.
  const pairs = THREE_WRITER_SHAPE.map((p) => [...p] as [string, number]);
  pairs[10] = ["mica-doctor", 2];
  const path = writeJsonl(dir, "same-module-regression.jsonl", writerSpecs(pairs));
  const log = new MicaLogFile({ path });
  assert.deepStrictEqual(log.verify(), { valid: false, brokenAt: 10 });
  assert.strictEqual(log.getLoadState(), "LOADED_UNVERIFIED_FILE");
});

check("S127-6 · seq 3 then 2 in the same writer, adjacent — brokenAt that index", () => {
  const dir = scratch("adapter-adjacent-regression");
  const path = writeJsonl(
    dir,
    "adjacent.jsonl",
    writerSpecs([
      ["mica-registrar", 0],
      ["mica-registrar", 3],
      ["mica-registrar", 2],
    ])
  );
  const log = new MicaLogFile({ path });
  assert.deepStrictEqual(log.verify(), { valid: false, brokenAt: 2 });
});

check("S127-6 · a SINGLE-writer log is unchanged by the per-writer rule", () => {
  const dir = scratch("adapter-single-writer");
  const good = writeJsonl(
    dir,
    "single-good.jsonl",
    writerSpecs([
      ["m3", 0],
      ["m3", 1],
      ["m3", 2],
      ["m3", 7], // a GAP still passes, exactly as it did under the global check
    ])
  );
  assert.deepStrictEqual(new MicaLogFile({ path: good }).verify(), { valid: true });
  const bad = writeJsonl(
    dir,
    "single-bad.jsonl",
    writerSpecs([
      ["m3", 0],
      ["m3", 1],
      ["m3", 1], // equal, not just lower — "strictly" is still strictly
    ])
  );
  assert.deepStrictEqual(new MicaLogFile({ path: bad }).verify(), { valid: false, brokenAt: 2 });
});

check("S127-6 · NO timestamp requirement was added — clocks out of order still verify", () => {
  const dir = scratch("adapter-clock-skew");
  // Three principals, three clocks. This adapter has never attested timestamps
  // and does not begin now; a repair must not smuggle in a new claim.
  const specs = writerSpecs(THREE_WRITER_SHAPE);
  specs[2].timestamp = T0 - 5000; // the doctor's clock is behind the registrar's
  specs[5].timestamp = T0 - 9000; // and the arbiter's is behind both
  const path = writeJsonl(dir, "clock-skew.jsonl", specs);
  assert.deepStrictEqual(new MicaLogFile({ path }).verify(), { valid: true });
});

check("verify() is FALSE on a line that is not a MICA record, at that line", () => {
  const dir = scratch("adapter-shape");
  const path = join(dir, "bad-shape.jsonl");
  const [a, b] = healthySpecs();
  writeFileSync(
    path,
    [JSON.stringify(a), JSON.stringify(b), JSON.stringify({ sequenceNumber: 2 }), ""].join("\n"),
    "utf8"
  );
  const log = new MicaLogFile({ path });
  assert.deepStrictEqual(log.verify(), { valid: false, brokenAt: 2 });
  assert.strictEqual(log.getLoadState(), "FILE_MALFORMED");
  assert.strictEqual(log.getProblem()?.line, 3);
  // The records BEFORE the break are still visible, so a forensic reader is not
  // left with nothing. They just do not buy a reading.
  assert.strictEqual(log.length, 2);
});

check("a record carrying MORE than the declared fields is read, and the extra is dropped", () => {
  const dir = scratch("adapter-extra");
  const path = join(dir, "extra.jsonl");
  writeFileSync(
    path,
    JSON.stringify({
      sequenceNumber: 0,
      timestamp: T0,
      moduleId: "m3",
      eventType: "canary_check",
      outcome: "clean",
      actionId: "act-1",
      parameters: { secret: "an untyped bag" },
      hash: "not read",
    }) + "\n",
    "utf8"
  );
  const log = new MicaLogFile({ path });
  assert.strictEqual(log.verify().valid, true);
  assert.deepStrictEqual(Object.keys(log.getAll()[0]).sort(), [
    "actionId",
    "eventType",
    "moduleId",
    "outcome",
    "sequenceNumber",
    "timestamp",
  ]);
});

check("an ABSENT file verifies vacuously — and the LOAD STATE is what refuses it", () => {
  const dir = scratch("adapter-absent");
  const log = new MicaLogFile({ path: join(dir, "never-written.jsonl") });
  // Stated rather than discovered: there is no record to be out of order, so
  // verify() has nothing to fail on. An empty read is not a clean one, and the
  // load state is the only thing standing between it and a reading.
  assert.deepStrictEqual(log.verify(), { valid: true });
  assert.strictEqual(log.getLoadState(), "FILE_ABSENT");
  const w = wire({ ...baseOptions(join(dir, "never-written.jsonl")) });
  assert.deepStrictEqual(
    w.sensorVerdicts.map((v) => v.kind),
    ["CANNOT_ASSESS", "CANNOT_ASSESS"]
  );
});

// ══ 1 · RELEASE, and the durable floor reading that bought it ════════════════

console.log("\n══ 1 · every wired reader SILENT, trail wired → RELEASE ══════");

check("all wired readers SILENT + durable floor trail → RELEASE, execute=true", () => {
  const dir = scratch("release");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const trail = join(dir, "floor-trail.jsonl");
  const w = wire({ ...baseOptions(logPath), floorTrailPath: trail, line: LINE });

  assert.deepStrictEqual(
    w.sensorVerdicts.map((v) => `${v.sensorId}=${v.kind}`),
    ["MICA/Eng=SILENT", "MICA/Sig=SILENT"]
  );

  const result = w.chokepoint.guard({ id: "act-release" }, w.sensorVerdicts, {
    impactClass: "routine",
  });
  assert.strictEqual(result.disposition, "RELEASE");
  assert.strictEqual(result.execute, true);
  assert.strictEqual(result.narrowed, false);

  // The floor reading is DURABLE — on disk, not in memory. That is the whole
  // precondition of the permit.
  assert.strictEqual(result.floorTrailRecorded, true);
  assert.ok(existsSync(trail), "no floor trail was written");
  const records = jsonlRecords(trail);
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].actionId, "act-release");
  assert.strictEqual(records[0].disposition, "RELEASE");
  assert.strictEqual(records[0].floorKind, "SILENT");
  assert.strictEqual(records[0].sensorKinds, "SILENT|SILENT");
});

check("an UNWIRED reader composes nothing, and the census says so in print", () => {
  const dir = scratch("release-census");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const w = wire({ ...baseOptions(logPath), floorTrailPath: join(dir, "trail.jsonl") });
  // Two verdicts for three readers: the gap reader contributed no term at all.
  assert.strictEqual(w.sensorVerdicts.length, 2);
  const gap = w.census.readers.find((r) => r.reader === "clerk1.gap");
  assert.strictEqual(gap?.wired, false);
  assert.strictEqual(gap?.verdictKind, null);
  assert.ok(/NOT WIRED/.test(gap?.source ?? ""), "the census did not print the absence");
});

// ══ 2 · THE SAME RUN WITH NO FLOOR TRAIL ═════════════════════════════════════
//
// The first lesson the front door teaches, and it is left in the way on purpose.

console.log("\n══ 2 · the same RELEASE with no floor trail ══════════════════");

check("no floor trail → the RELEASE is NARROWED to HOLD-BLIND, execute=false", () => {
  const dir = scratch("no-trail");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const w = wire({ ...baseOptions(logPath), line: LINE });
  const result = w.chokepoint.guard({ id: "act-no-trail" }, w.sensorVerdicts, {
    impactClass: "routine",
  });

  assert.strictEqual(result.decision.disposition, "RELEASE"); // raw
  assert.strictEqual(result.disposition, "HOLD_BLIND"); // final
  assert.strictEqual(result.execute, false);
  assert.strictEqual(result.narrowed, true);
  assert.ok(
    result.deliveryNote.includes("NO FLOOR TRAIL WAS WIRED"),
    `the narrowing note did not name the cause: ${result.deliveryNote}`
  );
  assert.strictEqual(result.floorTrailRecord, null);
  assert.strictEqual(result.floorTrailRecorded, false);

  const render = renderDisposition(result);
  assert.ok(render.includes("NARROWED BY DELIVERY"), "the render hid the narrowing");
  assert.ok(render.includes("DISPOSITION: HOLD-BLIND"));
});

// ══ 3 · AN ALARM HOLDS, WHATEVER THE STAKES ══════════════════════════════════

console.log("\n══ 3 · an ALARM verdict → HOLD ═══════════════════════════════");

check("a clock contradiction in the file → Sig ALARM → HOLD, findings on the render", () => {
  const dir = scratch("alarm");
  const specs = healthySpecs();
  specs[50].timestamp = T0 - 5_000; // declared time runs backwards against append order
  const logPath = writeJsonl(dir, "contradicting.jsonl", specs);
  const w = wire({
    ...baseOptions(logPath),
    floorTrailPath: join(dir, "trail.jsonl"),
    line: LINE,
  });

  const sig = w.sensorVerdicts.find((v) => v.sensorId === "MICA/Sig");
  assert.strictEqual(sig?.kind, "ALARM");

  // The LOWEST stakes class on the ladder. There is no stakes value that
  // releases an alarm, and this is the one that would if any did.
  const result = w.chokepoint.guard({ id: "act-alarm" }, w.sensorVerdicts, {
    impactClass: "routine",
  });
  assert.strictEqual(result.disposition, "HOLD");
  assert.strictEqual(result.execute, false);
  assert.ok(result.decision.findings.length > 0, "the alarm's findings did not ride along");

  const render = renderDisposition(result);
  assert.ok(render.includes("DISPOSITION: HOLD"));
  assert.ok(render.includes("ADVERSE FINDINGS RIDING ON THIS DISPOSITION"));
  assert.ok(render.includes("SIG_F1_"), "the finding code is not on the render");

  // And the floor reading still landed: every disposition is accounted for, not
  // only the permits.
  assert.strictEqual(result.floorTrailRecorded, true);
  assert.strictEqual(jsonlRecords(join(dir, "trail.jsonl"))[0].disposition, "HOLD");
});

// ══ 4 · THE BLIND SPLIT ══════════════════════════════════════════════════════
//
// One unreadable load state, three different lines, three different answers.

console.log("\n══ 4 · unreadable load state → the stakes split ══════════════");

/** Everything as above, but the run is told to trust a state this file never
 *  reports. The gate then refuses the reading — which is the CORRECT direction:
 *  a typo in the injected list blinds the instrument, it cannot make it cheerful. */
function blindOptions(logPath: string): WireOptions {
  return { ...baseOptions(logPath), readableLoadStates: ["SOME_OTHER_STATE"] };
}

check("a load state outside the injected list → CANNOT_ASSESS floor, both readers", () => {
  const dir = scratch("blind-floor");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const w = wire({ ...blindOptions(logPath), floorTrailPath: join(dir, "trail.jsonl") });
  assert.deepStrictEqual(
    w.sensorVerdicts.map((v) => v.kind),
    ["CANNOT_ASSESS", "CANNOT_ASSESS"]
  );
  const result = w.chokepoint.guard({ id: "act-blind" }, w.sensorVerdicts, null, );
  assert.strictEqual(result.decision.floorKind, "CANNOT_ASSESS");
});

check("stakes ABOVE the line → HOLD-BLIND, execute=false", () => {
  const dir = scratch("blind-above");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const w = wire({
    ...blindOptions(logPath),
    floorTrailPath: join(dir, "trail.jsonl"),
    ledgerPath: join(dir, "ledger.jsonl"),
    line: LINE,
  });
  const result = w.chokepoint.guard({ id: "act-above" }, w.sensorVerdicts, {
    impactClass: "critical",
  });
  assert.strictEqual(result.disposition, "HOLD_BLIND");
  assert.strictEqual(result.execute, false);
  assert.strictEqual(result.decision.blindSplit, "ABOVE_LINE");
  // No PASS-BLIND happened, so no PASS-BLIND record exists. An empty ledger here
  // is the correct state, not a missing write.
  assert.strictEqual(result.record, null);
  assert.strictEqual(existsSync(join(dir, "ledger.jsonl")), false);
});

check("stakes BELOW the line → PASS-BLIND, execute=true, with a DURABLE ledger record", () => {
  const dir = scratch("blind-below");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const ledger = join(dir, "ledger.jsonl");
  const w = wire({
    ...blindOptions(logPath),
    floorTrailPath: join(dir, "trail.jsonl"),
    ledgerPath: ledger,
    line: LINE,
  });
  const result = w.chokepoint.guard({ id: "act-below" }, w.sensorVerdicts, {
    impactClass: "routine",
  });
  assert.strictEqual(result.disposition, "PASS_BLIND");
  assert.strictEqual(result.execute, true);
  assert.strictEqual(result.decision.blindSplit, "BELOW_LINE");
  assert.strictEqual(result.recorded, true);
  const records = jsonlRecords(ledger);
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].actionId, "act-below");
  assert.strictEqual(records[0].disposition, "PASS_BLIND");
  assert.strictEqual(records[0].impactClass, "routine");
});

check("a PASS-BLIND with NO ledger fails closed to HOLD-BLIND — an unrecorded pass is the fail-open", () => {
  const dir = scratch("blind-below-no-ledger");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const w = wire({
    ...blindOptions(logPath),
    floorTrailPath: join(dir, "trail.jsonl"),
    line: LINE,
  });
  const result = w.chokepoint.guard({ id: "act-unrecorded" }, w.sensorVerdicts, {
    impactClass: "routine",
  });
  assert.strictEqual(result.decision.disposition, "PASS_BLIND");
  assert.strictEqual(result.disposition, "HOLD_BLIND");
  assert.strictEqual(result.execute, false);
  assert.strictEqual(result.recorded, false);
});

check("NO LINE AT ALL → HOLD-BLIND, the cautious default", () => {
  const dir = scratch("blind-no-line");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const w = wire({
    ...blindOptions(logPath),
    floorTrailPath: join(dir, "trail.jsonl"),
    ledgerPath: join(dir, "ledger.jsonl"),
  });
  // The lowest class on a ladder that was never injected buys nothing.
  const result = w.chokepoint.guard({ id: "act-no-line" }, w.sensorVerdicts, {
    impactClass: "routine",
  });
  assert.strictEqual(result.disposition, "HOLD_BLIND");
  assert.strictEqual(result.execute, false);
  assert.strictEqual(result.decision.blindSplit, "NO_USABLE_LINE_CAUTIOUS_DEFAULT");
  assert.ok(
    renderDisposition(result).includes("NO USABLE STAKES LINE WAS INJECTED"),
    "the run did not print that it held no line"
  );
});

// ══ 5 · NOTICES — ONLY WHEN A DESTINATION WAS SUPPLIED ═══════════════════════

console.log("\n══ 5 · the notice sink, wired and unwired ════════════════════");

check("a wired notice destination receives the batch notice, durably", () => {
  const dir = scratch("notice-wired");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const noticeDir = join(dir, "notices");
  const w = wire({
    ...blindOptions(logPath),
    floorTrailPath: join(dir, "trail.jsonl"),
    ledgerPath: join(dir, "ledger.jsonl"),
    line: LINE,
    noticeDir,
    noticeWindow: 1,
  });
  const result = w.chokepoint.guard({ id: "act-notice" }, w.sensorVerdicts, {
    impactClass: "routine",
  });
  assert.strictEqual(result.disposition, "PASS_BLIND");
  assert.notStrictEqual(result.notice, null);
  assert.ok(
    (result.notice?.message ?? "").includes("CHECK THE LINE"),
    "the notice did not carry the line-checking message"
  );

  const book = join(noticeDir, "notices.jsonl");
  assert.ok(existsSync(book), "the notice log was not written");
  const records = jsonlRecords(book);
  assert.strictEqual(records.length, 1);

  // The composed path's whole point: sinklessness is a PRINTED NOT_CONFIGURED,
  // never an absence. No transport was injected, so every human channel says so.
  const rendered = w.notifier?.render() ?? "";
  assert.ok(rendered.includes("NOT_CONFIGURED"), "the unconfigured channels were silent");
  assert.ok(rendered.includes("transportInjected=false"));
});

check("NO notice destination → NOTHING is computed, written, or created ANYWHERE", () => {
  const dir = scratch("notice-unwired");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const probe = join(dir, "probe");
  mkdirSync(probe, { recursive: true });
  const before = readdirSync(dir).sort();

  const w = wire({
    ...blindOptions(logPath),
    floorTrailPath: join(dir, "trail.jsonl"),
    ledgerPath: join(dir, "ledger.jsonl"),
    line: LINE,
  });
  assert.strictEqual(w.notifier, null);
  const result = w.chokepoint.guard({ id: "act-no-notice" }, w.sensorVerdicts, {
    impactClass: "routine",
  });
  assert.strictEqual(result.disposition, "PASS_BLIND");
  assert.strictEqual(result.notice, null);

  assert.deepStrictEqual(readdirSync(probe), [], "something was written into an empty directory");
  const after = readdirSync(dir).sort();
  assert.deepStrictEqual(
    after.filter((n) => !before.includes(n)).sort(),
    ["ledger.jsonl", "trail.jsonl"],
    "a notice destination appeared that nobody asked for"
  );
  assert.ok(w.census.notices.includes("NO DEFAULT SINK"));
});

// ── §5 · the witness intake, wired and unwired ───────────────────────────────

check("a wired witnessIntake turns the notice log's head into a drop a witness can read", () => {
  const dir = scratch("witness-intake-wired");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const noticeDir = join(dir, "notices");
  const intake = join(dir, "intake");
  // The producer does NOT create this. The intake's permissions are ruled by
  // the deployment (3730, group `mica-drops`), never guessed by a submitter.
  mkdirSync(intake, { recursive: true });

  const w = wire({
    ...blindOptions(logPath),
    floorTrailPath: join(dir, "trail.jsonl"),
    ledgerPath: join(dir, "ledger.jsonl"),
    line: LINE,
    noticeDir,
    noticeWindow: 1,
    witnessIntake: {
      dir: intake,
      submitterId: "mica-notify",
      modality: "NOT_AN_INSTRUCTION",
    },
  });
  const result = w.chokepoint.guard({ id: "act-witness-intake" }, w.sensorVerdicts, {
    impactClass: "routine",
  });
  assert.strictEqual(result.disposition, "PASS_BLIND");
  assert.notStrictEqual(result.notice, null);

  // THE FILENAME IS THE SUBMITTER ID: one drop, named for who claims to have
  // sent it, and nothing else in the directory — no in-flight frame left over.
  assert.deepStrictEqual(readdirSync(intake), ["mica-notify"]);

  const drop = JSON.parse(readFileSync(join(intake, "mica-notify"), "utf8")) as Record<
    string,
    unknown
  >;
  // The far end's validator is hasExactKeys(HEAD_KEYS). An EXTRA key here would
  // land as a MALFORMED_SUBMISSION against a submitter that did nothing wrong,
  // in an append-only book, permanently. (S88: the frozen set is FIVE keys —
  // `modality` joined S-4 §4 on 2026-08-26.)
  assert.deepStrictEqual(Object.keys(drop), [
    "seq_no",
    "head_hash",
    "ts",
    "witness_set_id",
    "modality",
  ]);
  // The deployment's R8 declaration, reaching the drop verbatim. The option is
  // TYPE-REQUIRED on `witnessIntake`, so this value was made, never defaulted.
  assert.strictEqual(drop.modality, "NOT_AN_INSTRUCTION");
  assert.ok(w.census.notices.includes("modality \`NOT_AN_INSTRUCTION\`"));

  const book = jsonlRecords(join(noticeDir, "notices.jsonl"));
  assert.strictEqual(book.length, 1);
  assert.strictEqual(drop.head_hash, book[0].hash);
  assert.strictEqual(drop.seq_no, book[0].sequenceNumber);
  // The record's own index, not a clock: this book authors no time about itself.
  assert.strictEqual(drop.ts, drop.seq_no);
  // PRINTED, NOT IMPLIED, and still true when no id is supplied: an absent
  // `witnessSetId` is carried honestly as the empty string. The witness copies
  // what arrived and certifies nothing about it either way — see the sibling
  // case below for the branch that declares one.
  assert.strictEqual(drop.witness_set_id, "");
  assert.ok(w.census.notices.includes("NONE DECLARED"));

  assert.ok((w.notifier?.render() ?? "").includes("witnessHeadCommit=DECLARED"));
  assert.ok(w.census.notices.includes(intake));
});

check("a witnessIntake WITH a witness-set id puts that id, verbatim, in the drop", () => {
  const dir = scratch("witness-intake-set-id");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const noticeDir = join(dir, "notices");
  const intake = join(dir, "intake");
  mkdirSync(intake, { recursive: true });

  const w = wire({
    ...blindOptions(logPath),
    floorTrailPath: join(dir, "trail.jsonl"),
    ledgerPath: join(dir, "ledger.jsonl"),
    line: LINE,
    noticeDir,
    noticeWindow: 1,
    witnessIntake: {
      dir: intake,
      submitterId: "mica-notify",
      witnessSetId: "set-alpha",
      modality: "NOT_AN_INSTRUCTION",
    },
  });
  w.chokepoint.guard({ id: "act-witness-set-id" }, w.sensorVerdicts, {
    impactClass: "routine",
  });

  const drop = JSON.parse(readFileSync(join(intake, "mica-notify"), "utf8")) as Record<
    string,
    unknown
  >;
  // VERBATIM. This book declares the id it was handed and neither derives one
  // nor checks it against anything — a witness-set id is deployment
  // configuration, and a submitter that invented one would be declaring a
  // topology it cannot see.
  assert.strictEqual(drop.witness_set_id, "set-alpha");
  assert.deepStrictEqual(Object.keys(drop), [
    "seq_no",
    "head_hash",
    "ts",
    "witness_set_id",
    "modality",
  ]);
  assert.ok(w.census.notices.includes("declaring witness set \`set-alpha\`"));
  assert.ok(!w.census.notices.includes("NONE DECLARED"));
});

check("NO witnessIntake → exactly today's behaviour: no drop, and the census says so at bytes", () => {
  const dir = scratch("witness-intake-unwired");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const noticeDir = join(dir, "notices");
  const intake = join(dir, "intake");
  mkdirSync(intake, { recursive: true });

  const w = wire({
    ...blindOptions(logPath),
    floorTrailPath: join(dir, "trail.jsonl"),
    ledgerPath: join(dir, "ledger.jsonl"),
    line: LINE,
    noticeDir,
    noticeWindow: 1,
  });
  const result = w.chokepoint.guard({ id: "act-no-intake" }, w.sensorVerdicts, {
    impactClass: "routine",
  });
  assert.notStrictEqual(result.notice, null, "a notice must still be raised");

  // Nothing is created anywhere. An unwired head commit is a QUIET the census
  // distinguishes from a wired one that happened not to fire.
  assert.deepStrictEqual(readdirSync(intake), []);
  assert.ok((w.notifier?.render() ?? "").includes("witnessHeadCommit=NOT_DECLARED"));
  assert.ok(w.census.notices.includes("NO WITNESS HEAD COMMIT"));
});

// ══ 6 · EXIT CODES AND THE MACHINE TAIL ══════════════════════════════════════

console.log("\n══ 6 · exit codes and the machine-parseable tail ═════════════");

/** Parse the tail the way an agentic consumer would: last line, space-split. */
function parseTail(output: string): Record<string, string> {
  const lines = output.split("\n").filter((l) => l.trim().length > 0);
  const tail = lines[lines.length - 1];
  assert.ok(tail.startsWith("MICA-GUARD "), `last line is not the tail: ${tail}`);
  const fields: Record<string, string> = {};
  for (const token of tail.split(" ").slice(1)) {
    const at = token.indexOf("=");
    assert.ok(at > 0, `tail token is not key=value: ${token}`);
    fields[token.slice(0, at)] = token.slice(at + 1);
  }
  return fields;
}

check("a RELEASE run exits 0 and its tail parses", () => {
  const dir = scratch("cli-release");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const r = run([
    "--action-id", "cli-release",
    "--log", logPath,
    "--readable-load-state", "LOADED_UNVERIFIED_FILE",
    "--sensor-config", writeSensorConfig(dir),
    "--floor-trail", join(dir, "trail.jsonl"),
    "--stakes-class", "routine",
    "--line-classes", "routine,elevated,critical",
    "--hold-at-or-above", "elevated",
  ]);
  assert.strictEqual(r.exit, 0);
  assert.deepStrictEqual(parseTail(r.output), {
    action: "cli-release",
    disposition: "RELEASE",
    execute: "true",
    recorded: "trail:yes,ledger:none",
    exit: "0",
  });
  assert.strictEqual(exitCodeFor(r.result as NonNullable<typeof r.result>), 0);
});

check("a held run exits 1 and the tail carries the same fact in words", () => {
  const dir = scratch("cli-hold");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  // No floor trail: the permit cannot be accounted for.
  const r = run([
    "--action-id", "cli-hold",
    "--log", logPath,
    "--readable-load-state", "LOADED_UNVERIFIED_FILE",
    "--sensor-config", writeSensorConfig(dir),
  ]);
  assert.strictEqual(r.exit, 1);
  const tail = parseTail(r.output);
  assert.strictEqual(tail.disposition, "HOLD-BLIND");
  assert.strictEqual(tail.execute, "false");
  assert.strictEqual(tail.recorded, "trail:no,ledger:none");
  assert.strictEqual(tail.exit, "1");
});

check("a PASS-BLIND tail reports BOTH durability facts, separately", () => {
  const dir = scratch("cli-pass-blind");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const r = run([
    "--action-id", "cli-pass-blind",
    "--log", logPath,
    "--readable-load-state", "SOME_OTHER_STATE",
    "--sensor-config", writeSensorConfig(dir),
    "--floor-trail", join(dir, "trail.jsonl"),
    "--ledger", join(dir, "ledger.jsonl"),
    "--stakes-class", "routine",
    "--line-classes", "routine,elevated,critical",
    "--hold-at-or-above", "elevated",
  ]);
  assert.strictEqual(r.exit, 0);
  const tail = parseTail(r.output);
  assert.strictEqual(tail.disposition, "PASS-BLIND");
  assert.strictEqual(tail.recorded, "trail:yes,ledger:yes");
});

check("a usage error exits 2 — and 2 is never read as a disposition", () => {
  const r = run(["--log", "nowhere.jsonl"]); // no --action-id
  assert.strictEqual(r.exit, 2);
  assert.strictEqual(r.result, null);
  assert.ok(r.output.includes("INVOCATION ERROR"));
  assert.ok(r.output.includes("THE GATE DID NOT RUN"));
  const tail = parseTail(r.output);
  assert.strictEqual(tail.disposition, "NONE");
  assert.strictEqual(tail.execute, "false");
  assert.strictEqual(tail.exit, "2");
});

check("every malformed invocation is exit 2, not a cautious hold", () => {
  const bad: readonly (readonly string[])[] = [
    ["--action-id"], // flag with no value
    ["--action-id", "a", "--nonsense", "x"], // unknown flag
    ["--action-id", "a", "--line-classes", "low,high"], // half a line
    ["--action-id", "a", "--hold-at-or-above", "high"], // the other half
    ["--action-id", "a", "--line-classes", "low,high", "--hold-at-or-above", "middle"],
    ["--action-id", "a", "--now", "soon"],
    ["--action-id", "a", "--notice-window", "0"],
    ["--action-id", "a", "--sensor-config", "no-such-file.json"],
    ["--action-id", "an id with spaces"], // would split the machine tail in two
    ["--action-id", "a", "--clerk-clock-stamps", "no-such-file.jsonl"], // S109-B door
  ];
  for (const argv of bad) {
    const r = run(argv);
    assert.strictEqual(r.exit, 2, `expected exit 2 for [${argv.join(" ")}]`);
    assert.strictEqual(r.result, null, `a disposition was produced for [${argv.join(" ")}]`);
  }
});

check("a sensor config with an unknown or smuggled key is refused, loudly", () => {
  const dir = scratch("cli-config");
  const write = (name: string, body: unknown): string => {
    const p = join(dir, name);
    writeFileSync(p, JSON.stringify(body), "utf8");
    return p;
  };
  const cases: readonly [string, unknown][] = [
    ["typo.json", { eng: { structurThreshold: 0.2 } }],
    ["smuggled-gate.json", { sig: { readableLoadStates: ["LOADED_VERIFIED"] } }],
    ["hand-typed-clerk.json", { sig: { clerkClockSource: [] } }],
    ["wrong-type.json", { eng: { structureThreshold: "0.2" } }],
    // S104: the basis is FREE TEXT, but it is still typed. A number here would
    // be a provenance claim nobody wrote.
    ["basis-not-a-string.json", { sig: { clockToleranceMs: 0, clockToleranceBasis: 0 } }],
    // T11 · minimumClassCoverage is an integer >= 1, refused HERE and not left to
    // become a blind MISSING_CONFIGURATION reading downstream. Three shapes, all
    // of which a finite-number check would have let through:
    ["coverage-fractional.json", { eng: { minimumClassCoverage: 2.5 } }],
    ["coverage-zero.json", { eng: { minimumClassCoverage: 0 } }],
    ["coverage-negative.json", { eng: { minimumClassCoverage: -3 } }],
  ];
  for (const [name, body] of cases) {
    const r = run(["--action-id", "a", "--sensor-config", write(name, body)]);
    assert.strictEqual(r.exit, 2, `${name} was not refused`);
  }
  // ⛔ AND THE POSITIVE ARM, because a guard that refuses everything is not a
  //    guard. The whole point of the change is that a CORRECT value reaches the
  //    reader: accepted here, carried verbatim, and `ENG_CONFIG` above proves the
  //    rest of the path by being written out as a --sensor-config file.
  {
    const a = parseArgs([
      "--action-id", "a",
      "--sensor-config", write("coverage-ok.json", { eng: { minimumClassCoverage: 3 } }),
    ]);
    assert.strictEqual(
      a.wireOptions.eng?.minimumClassCoverage,
      3,
      "a valid minimumClassCoverage did not reach wireOptions.eng — the guard accepted " +
        "it and then dropped it, which is the seam this field exists on the far side of"
    );
  }
  // The refusal must NAME the key as accepted, or it tells the operator to stop
  // using a field this guard in fact takes.
  assert.throws(
    () => parseArgs(["--action-id", "a", "--sensor-config", write("typo3.json", { eng: { nope2: 1 } })]),
    (err: unknown) =>
      err instanceof GuardInvocationError && /minimumClassCoverage/.test(String(err.message)),
    "the unknown-key refusal does not list minimumClassCoverage among the accepted keys"
  );
  assert.throws(
    () => parseArgs(["--action-id", "a", "--sensor-config", write("typo2.json", { eng: { nope: 1 } })]),
    GuardInvocationError
  );
});

// ── S109-B: the clock-fence, and the door that admits on custody instead ────
//
// The clock-fence itself is the "hand-typed-clerk.json" case two checks above
// (line ~852: { sig: { clerkClockSource: [] } } via --sensor-config), unmoved
// by this build — same assertion, same refusal, byte-identical in meaning.
// What is NEW here is proven below: the --clerk-clock-stamps door is wired
// into mica-guard at all, and its own refusals are wiring errors (exit 2),
// never a disposition.

check("T8 fence — guard REFUSES expectedChainIdentity from --sensor-config, for the same reason", () => {
  // ⛔ FOUND BY THE FENCE, NOT BY DESIGN, AND THAT IS WHY IT IS PINNED HERE. The
  // first version of the T8 fixtures put `expectedChainIdentity` into the shared
  // `SIG_CONFIG`, which the spawned-process tests write out as a real
  // `--sensor-config` file — and `mica-guard` refused it as an unknown key. THE
  // REFUSAL IS RIGHT: the expected identity is the position-0 boundary hash of
  // the log the readers read. It changes at every rotation, it is a fact about
  // the RECORD rather than a deployer's choice, and a declared copy goes stale
  // the instant the chain rotates — at which point it refuses every stamp of the
  // live chain WHILE LOOKING PERFECTLY WELL-FORMED. Exactly the `clerkClockSource`
  // argument, one field over: a reader's attribution is not a declarable value.
  const dir = scratch("t8-identity-fence");
  const p = join(dir, "hand-typed.json");
  writeFileSync(p, JSON.stringify({ sig: { expectedChainIdentity: "chain-LIVE" } }), "utf8");
  assert.throws(
    () => parseArgs(["--action-id", "a", "--sensor-config", p]),
    (err: unknown) =>
      err instanceof GuardInvocationError &&
      err.message.includes('unknown key "expectedChainIdentity"'),
    "the refusal must name the key, not just fail"
  );
});

check("S109-B fence — guard STILL refuses clerkClockSource from --sensor-config", () => {
  const dir = scratch("clock-fence");
  const p = join(dir, "hand-typed.json");
  writeFileSync(p, JSON.stringify({ sig: { clerkClockSource: [] } }), "utf8");
  assert.throws(
    () => parseArgs(["--action-id", "a", "--sensor-config", p]),
    (err: unknown) =>
      err instanceof GuardInvocationError &&
      err.message.includes("clerkClockSource is not accepted from a config file"),
    "the config-path refusal text must be present verbatim, not just an exit code"
  );
});

check("S109-B door — --clerk-clock-stamps at a missing path is a WIRING ERROR, not a hold", () => {
  const r = run(["--action-id", "a", "--clerk-clock-stamps", "/no/such/stamps.jsonl"]);
  assert.strictEqual(r.exit, 2);
  assert.strictEqual(r.result, null, "the gate must not have reached a disposition");
  assert.ok(r.output.includes("THE GATE DID NOT RUN"));
  assert.throws(
    () => parseArgs(["--action-id", "a", "--clerk-clock-stamps", "/no/such/stamps.jsonl"]),
    (err: unknown) =>
      err instanceof GuardInvocationError && err.message.includes("NOT_FOUND"),
    "S108-C's FILE_ABSENT grammar must be nameable from the thrown error"
  );
});

check("S109-B door — a custody-refused stamps file is ALSO a wiring error, never a blind Sig read", () => {
  const dir = scratch("clock-custody");
  const p = join(dir, "stamps.jsonl");
  writeFileSync(p, "[]", "utf8"); // wrong content AND wrong owner — owner fails first
  const r = run(["--action-id", "a", "--clerk-clock-stamps", p]);
  assert.strictEqual(r.exit, 2);
  assert.strictEqual(r.result, null);
});

check("the tail helpers produce exactly the documented shape", () => {
  const dir = scratch("cli-tail");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const w = wire({ ...baseOptions(logPath), floorTrailPath: join(dir, "trail.jsonl") });
  const result = w.chokepoint.guard({ id: "tail-shape" }, w.sensorVerdicts, null);
  assert.strictEqual(
    tailLine(result, exitCodeFor(result)),
    "MICA-GUARD action=tail-shape disposition=RELEASE execute=true " +
      "recorded=trail:yes,ledger:none exit=0"
  );
  // F2: `kind` is now REQUIRED, and distinguishability is the amendment's
  // chosen contract over byte-identity with the pre-Stage-1 shape.
  assert.strictEqual(
    errorTailLine("x", "usage"),
    "MICA-GUARD action=x disposition=NONE execute=false recorded=trail:no,ledger:none kind=usage exit=2"
  );
  assert.strictEqual(
    errorTailLine("x", "conflict"),
    "MICA-GUARD action=x disposition=NONE execute=false recorded=trail:no,ledger:none kind=conflict exit=2"
  );
});

// ── the process really does exit with those codes ────────────────────────────
//
// Everything above tests `run()`, which returns a code. THIS tests that the
// program actually EXITS with it — the fact an agentic consumer depends on, and
// the one an in-process test cannot see.

console.log("\n══ 6b · the real process, spawned ════════════════════════════");

const REPO_ROOT = resolve(__dirname, "..", "..");
const TS_NODE_BIN = join(REPO_ROOT, "node_modules", "ts-node", "dist", "bin.js");
const GUARD_ENTRY = join(REPO_ROOT, "src", "glue", "mica-guard.ts");

function spawnGuard(argv: readonly string[]): { status: number; stdout: string } {
  const r = spawnSync(process.execPath, [TS_NODE_BIN, GUARD_ENTRY, ...argv], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (r.error) throw r.error;
  return { status: r.status ?? -1, stdout: r.stdout };
}


// -- S104 · the tolerance's basis rides on the value, or does not exist -------

check("SC-S104-1 · clockToleranceBasis is ACCEPTED as free text, and reaches Sig", () => {
  const dir = scratch("basis-accepted");
  const path = join(dir, "basis.json");
  writeFileSync(
    path,
    JSON.stringify({ sig: { clockToleranceMs: 0, clockToleranceBasis: "PROXY: asserted, NOT measured" } }),
    "utf8"
  );
  const parsed = parseArgs(["--action-id", "a", "--sensor-config", path]);
  assert.strictEqual(
    parsed.wireOptions.sig?.clockToleranceBasis,
    "PROXY: asserted, NOT measured",
    "the basis did not survive validation into the sig config"
  );
});

check("SC-S104-2 · THE SHIPPED config/sig-config.json parses and carries both facts", () => {
  // The file the arbiter's runs will point at. If it stops parsing, the run that used
  // it silently loses the proxy label and prints a bare 0 — so this reads the
  // real file, not a fixture of it.
  const shipped = join(__dirname, "..", "..", "config", "sig-config.json");
  const parsed = parseArgs(["--action-id", "a", "--sensor-config", shipped]);
  const sig = parsed.wireOptions.sig;
  assert.strictEqual(sig?.clockToleranceMs, 0);
  const basis = String(sig?.clockToleranceBasis ?? "");
  // The two facts the ruling makes mandatory; the wording is free, these are not.
  assert.match(basis, /proxy|asserted/i, `the basis does not say it is asserted: ${basis}`);
  assert.match(basis, /not measured/i, `the basis does not say it is not measured: ${basis}`);
});

function writeSensorConfig(dir: string): string {
  const path = join(dir, "sensor-config.json");
  writeFileSync(path, JSON.stringify({ eng: ENG_CONFIG, sig: SIG_CONFIG }), "utf8");
  return path;
}

check("the spawned process exits 0 on a RELEASE and prints the tail on stdout", () => {
  const dir = scratch("spawn-release");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const r = spawnGuard([
    "--action-id", "spawned-release",
    "--log", logPath,
    "--readable-load-state", "LOADED_UNVERIFIED_FILE",
    "--sensor-config", writeSensorConfig(dir),
    "--floor-trail", join(dir, "trail.jsonl"),
  ]);
  assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stdout}`);
  assert.strictEqual(parseTail(r.stdout).disposition, "RELEASE");
});

check("the spawned process exits 2 on a broken invocation", () => {
  const r = spawnGuard(["--not-a-flag", "x"]);
  assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stdout}`);
  assert.ok(r.stdout.includes("THE GATE DID NOT RUN"));
});

// ── teardown ─────────────────────────────────────────────────────────────────

rmSync(ROOT, { recursive: true, force: true });


// -- ML-S103 · a log it may not look at is not a log that is ABSENT ------------
//
// `MicaLogFile.load()` began `if (!existsSync(this.sourcePath)) FILE_ABSENT`.
// FILE_ABSENT is a state a caller reasonably reads as "nothing to see yet", so a
// log this process merely could not traverse to was reported as a log that is
// not there. Its sibling in this directory, `witness-log-file.ts`, took the
// three-valued shape at S97-D(2); this reader kept the two-valued call until
// `load-site-guard.test.ts` named it at S103.
//
// The repair needs no extra syscall: readFileSync reports the same errno, and
// ENOENT is the only one that means absent.

check("ML-S103-1 · a genuinely absent log still reads FILE_ABSENT", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-ml-absent-"));
  const log = new MicaLogFile({ path: join(dir, "nothing-here.jsonl") });
  assert.strictEqual(log.getLoadState(), "FILE_ABSENT");
  assert.strictEqual(log.getProblem(), null, "an absent log is not a problem to report");
  rmSync(dir, { recursive: true, force: true });
});

check("ML-S103-2 · THE REAL SHAPE — a log present behind a stripped execute bit", () => {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === 0 || uid === null) {
    console.log(
      "      NOT EXERCISED as this principal: a mode-based refusal cannot be " +
        "built for uid 0. ML-S103-1 covers the absent branch for every principal."
    );
    return;
  }
  const base = mkdtempSync(join(tmpdir(), "mica-ml-noexec-"));
  const dir = join(base, "logs");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "mica.jsonl");
  writeFileSync(path, "", "utf8");
  chmodSync(dir, 0o600); // readable, NOT searchable
  try {
    const log = new MicaLogFile({ path });
    assert.strictEqual(
      log.getLoadState(),
      "FILE_UNREADABLE",
      "a log behind a stripped execute bit was reported as ABSENT"
    );
    const problem = log.getProblem();
    assert.ok(problem !== null, "FILE_UNREADABLE carried no problem to report");
    assert.ok(problem.detail.includes("EACCES"), problem.detail);
    assert.ok(
      problem.detail.includes("NOT the finding that the file is absent"),
      problem.detail
    );
  } finally {
    chmodSync(dir, 0o700);
    rmSync(base, { recursive: true, force: true });
  }
});

// ══ 7 · STAGE 1 (Amendment 1) — PREPARED / FINAL, two-phase ═════════════════
//
// The verifier's Blocker 1 named the defect precisely: the first build's
// guard() wrote the floor trail and PASS-BLIND ledger BEFORE any canonical
// commit existed. This section tests the fix — DECISION_PREPARED /
// PASSBLIND_PREPARED written inside guard() into the SAME canonical journal,
// DECISION_FINAL as the one mandatory boundary, and every file book (trail,
// ledger, history, events) written by the wrapper strictly AFTER FINAL.

console.log("\n══ 7 · Stage 1 (Amendment 1) — PREPARED / FINAL ══════════════");

import {
  CANONICAL_JSON_FIXTURE_1_HASH,
  CANONICAL_JSON_FIXTURE_2_HASH,
  CANONICAL_JSON_FIXTURE_3_HASH,
  canonicalHash,
} from "./decision-journal";
import {
  evaluateAndRecord,
  EvaluateAndRecordUsageError,
} from "./evaluate-and-record";
import type { DecisionIdentity, DeclarationBinding } from "./decision-journal";
import { SubstrateHistory } from "../mica/doctor/history";
import { ChokepointLedger, FloorTrail } from "../mica/chokepoint";
import type { LineAppender as S1LineAppender } from "../mica/store/append-store";

check("the three canonical-JSON fixtures hash deterministically", () => {
  assert.strictEqual(canonicalHash({ b: 2, a: 1 }), CANONICAL_JSON_FIXTURE_1_HASH);
  assert.strictEqual(
    canonicalHash({ z: "café", a: [3, 1, 2], n: null, u: undefined }),
    CANONICAL_JSON_FIXTURE_2_HASH
  );
  assert.strictEqual(
    canonicalHash({
      identity: { subject: "richards-cat", sessionId: "s1", actionId: "a1" },
      nested: { z: 1, y: { b: 2, a: 1 }, a: [1, 2, 3] },
    }),
    CANONICAL_JSON_FIXTURE_3_HASH
  );
  assert.strictEqual(canonicalHash({ a: 1, b: 2 }), CANONICAL_JSON_FIXTURE_1_HASH);
});

function s1Identity(actionId: string): DecisionIdentity {
  return { subject: "richards-cat", sessionId: "s1", actionId };
}

function s1Paths(dir: string) {
  return {
    journal: join(dir, "journal.jsonl"),
    floorTrail: join(dir, "trail.jsonl"),
    ledger: join(dir, "ledger.jsonl"),
    history: join(dir, "history.jsonl"),
    events: join(dir, "events.jsonl"),
  };
}

function s1WireOptions(logPath: string, dir: string): WireOptions {
  return {
    ...baseOptions(logPath),
    // Deliberately NO floorTrailPath/ledgerPath here: those real files are
    // wrapper-owned projections opened from `paths`, never from wireOptions
    // on the journal path (Amendment 1 item 4). A stray floorTrailPath here
    // would be a silent second writer, exactly what Blocker 1 named.
    line: LINE,
  };
}

const UNBOUND: DeclarationBinding = { kind: "UNBOUND_STAGE_1" };
const BOUND: DeclarationBinding = {
  kind: "HASH",
  sha256: CANONICAL_JSON_FIXTURE_1_HASH,
};

function req(identity: DecisionIdentity, requestHash: string) {
  return { identity, subject: identity.subject, toolName: "bash", requestHash };
}

// ── the pre-commit side-effect attack (Blocker 1's own required test) ───────

check("Stage 1 · a RELEASE evaluation writes NOTHING to the real trail/ledger files until AFTER DECISION_FINAL", () => {
  const dir = scratch("s1-no-pre-final-write");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const identity = s1Identity("act-no-pre-final");
  const paths = s1Paths(dir);

  // Force the canonical commit to fail (throwing appender) so FINAL never
  // lands, and assert the REAL trail/ledger files were never touched at all
  // — not merely "not marked done": genuinely absent, because they are only
  // ever opened by the wrapper AFTER a successful FINAL append.
  const throwing = () => {
    throw new Error("SIMULATED: journal unwritable");
  };
  const result = evaluateAndRecord(
    req(identity, "req-a"),
    paths,
    s1WireOptions(logPath, dir),
    { declarationBinding: UNBOUND, journalAppender: throwing }
  );
  assert.strictEqual(result.kind, "OK");
  if (result.kind !== "OK") throw new Error("unreachable");
  assert.strictEqual(result.recordNotPersisted, true);
  assert.ok(!existsSync(paths.floorTrail), "the real floor-trail file was created before FINAL ever landed");
  assert.ok(!existsSync(paths.ledger), "the real ledger file was created before FINAL ever landed");
});

check("Stage 1 · planted fault → HOLD, floorKind ALARM lands in the history, real trail file written after FINAL", () => {
  const dir = scratch("s1-alarm");
  const specs = healthySpecs();
  specs[50].timestamp = T0 - 5_000;
  const logPath = writeJsonl(dir, "contradicting.jsonl", specs);
  const identity = s1Identity("act-s1-alarm");
  const paths = s1Paths(dir);
  const result = evaluateAndRecord(
    req(identity, "req-alarm"),
    paths,
    s1WireOptions(logPath, dir),
    { declarationBinding: UNBOUND }
  );
  assert.strictEqual(result.kind, "OK");
  if (result.kind !== "OK") throw new Error("unreachable");
  assert.strictEqual(result.decision.disposition, "HOLD");
  assert.strictEqual(result.decision.execute, false);
  assert.strictEqual(result.replayed, false);

  const historyRecords = jsonlRecords(paths.history);
  const readRec = historyRecords.find((r) => r.recordType === "SUBSTRATE_READ");
  assert.ok(readRec, "no SUBSTRATE_READ landed in the history");
  assert.strictEqual((readRec as Record<string, unknown>).floorKind, "ALARM");

  // The real trail file exists (written by the wrapper) and its one record
  // is for this action — proving it landed, and landed from the PREPARED
  // reading, not from a second live writer inside guard().
  const trailRecords = jsonlRecords(paths.floorTrail);
  assert.strictEqual(trailRecords.length, 1);
  assert.strictEqual(trailRecords[0].actionId, "act-s1-alarm");
  assert.strictEqual(trailRecords[0].disposition, "HOLD");

  const journalRecords = jsonlRecords(paths.journal);
  assert.strictEqual(journalRecords.filter((r) => r.recordType === "DECISION_PREPARED").length, 1);
  assert.strictEqual(journalRecords.filter((r) => r.recordType === "DECISION_FINAL").length, 1);
  const markers = journalRecords.filter(
    (r) => r.recordType === "PROJECTION_DONE" || r.recordType === "PROJECTION_FAILED"
  );
  assert.strictEqual(markers.length, 4, "expected exactly one line per projection");

  // The invariant: every identity in the trail file has a preceding FINAL.
  const finalIdx = journalRecords.findIndex((r) => r.recordType === "DECISION_FINAL");
  assert.ok(finalIdx >= 0 && finalIdx < journalRecords.length - 1);
});

check("Stage 1 · clean twin → SILENT, RELEASE, execute=true, PASS-BLIND ledger NOT due (DONE by definition)", () => {
  const dir = scratch("s1-clean");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const identity = s1Identity("act-s1-clean");
  const paths = s1Paths(dir);
  const result = evaluateAndRecord(
    req(identity, "req-clean"),
    paths,
    s1WireOptions(logPath, dir),
    { declarationBinding: UNBOUND }
  );
  assert.strictEqual(result.kind, "OK");
  if (result.kind !== "OK") throw new Error("unreachable");
  assert.strictEqual(result.decision.disposition, "RELEASE");
  assert.strictEqual(result.decision.execute, true);
  assert.strictEqual(result.delivery.ledger, "DONE");
  assert.ok(!existsSync(paths.ledger), "no PASS-BLIND record was due; the ledger file should not exist");
});

check("Stage 1 · same identity + same hash → replayed:true, nothing appended twice, real files unchanged", () => {
  const dir = scratch("s1-replay");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const identity = s1Identity("act-s1-replay");
  const paths = s1Paths(dir);
  const opts = s1WireOptions(logPath, dir);
  const r = req(identity, "req-a");

  const first = evaluateAndRecord(r, paths, opts, { declarationBinding: UNBOUND });
  assert.strictEqual(first.kind, "OK");
  if (first.kind !== "OK") throw new Error("unreachable");
  assert.strictEqual(first.replayed, false);

  const journalLinesAfterFirst = jsonlRecords(paths.journal).length;
  const trailLinesAfterFirst = jsonlRecords(paths.floorTrail).length;

  const second = evaluateAndRecord(r, paths, opts, { declarationBinding: UNBOUND });
  assert.strictEqual(second.kind, "OK");
  if (second.kind !== "OK") throw new Error("unreachable");
  assert.strictEqual(second.replayed, true);
  assert.deepStrictEqual(second.decision, first.decision, "the replayed decision was not byte-identical");

  assert.strictEqual(jsonlRecords(paths.journal).length, journalLinesAfterFirst, "a replay appended to the journal");
  assert.strictEqual(jsonlRecords(paths.floorTrail).length, trailLinesAfterFirst, "a replay wrote the trail file again");
});

check("Stage 1 · same identity, different hash → CONFLICT, nothing appended", () => {
  const dir = scratch("s1-conflict");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const identity = s1Identity("act-s1-conflict");
  const paths = s1Paths(dir);
  const opts = s1WireOptions(logPath, dir);

  const first = evaluateAndRecord(req(identity, "req-a"), paths, opts, { declarationBinding: UNBOUND });
  assert.strictEqual(first.kind, "OK");
  const linesAfterFirst = jsonlRecords(paths.journal).length;

  const second = evaluateAndRecord(req(identity, "req-B-DIFFERENT"), paths, opts, { declarationBinding: UNBOUND });
  assert.strictEqual(second.kind, "CONFLICT");
  assert.strictEqual(jsonlRecords(paths.journal).length, linesAfterFirst, "CONFLICT appended something");
});

check("Stage 1 · canonical FINAL commit failure → evaluated HOLD, recordNotPersisted:true, PREPARED line stands as evidence", () => {
  const dir = scratch("s1-final-fail");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const identity = s1Identity("act-s1-final-fail");
  const paths = s1Paths(dir);
  const opts = s1WireOptions(logPath, dir);

  // Let PREPARED succeed (real appender) but FINAL fail: throw only from the
  // SECOND append onward (PREPARED is the journal's first append here).
  let calls = 0;
  const failAfterFirst: S1LineAppender = (p, line) => {
    calls++;
    if (calls === 1) {
      appendFileSync(p, line, "utf8");
      return;
    }
    throw new Error("SIMULATED: journal unwritable after PREPARED");
  };

  const result = evaluateAndRecord(
    req(identity, "req-a"),
    paths,
    opts,
    { declarationBinding: UNBOUND, journalAppender: failAfterFirst }
  );
  assert.strictEqual(result.kind, "OK");
  if (result.kind !== "OK") throw new Error("unreachable");
  assert.strictEqual(result.recordNotPersisted, true);
  assert.strictEqual(result.decision.disposition, "HOLD");
  assert.strictEqual(result.decision.execute, false);

  const journalRecords = jsonlRecords(paths.journal);
  assert.strictEqual(journalRecords.filter((r) => r.recordType === "DECISION_PREPARED").length, 1);
  assert.strictEqual(journalRecords.filter((r) => r.recordType === "DECISION_FINAL").length, 0);
  assert.ok(!existsSync(paths.floorTrail), "no real trail file should exist: FINAL never landed");

  // A retry, with a clean appender, must NOT treat the orphan PREPARED as a
  // decision — it evaluates completely afresh.
  const retry = evaluateAndRecord(req(identity, "req-a"), paths, opts, { declarationBinding: UNBOUND });
  assert.strictEqual(retry.kind, "OK");
  if (retry.kind !== "OK") throw new Error("unreachable");
  assert.strictEqual(retry.replayed, false, "an orphan PREPARED must never be replayed as a decision");
  assert.strictEqual(retry.quarantined.length, 1, "the orphan PREPARED should be reported as quarantined");
  assert.strictEqual(retry.decision.disposition, "RELEASE");
  const finalCount = jsonlRecords(paths.journal).filter((r) => r.recordType === "DECISION_FINAL").length;
  assert.strictEqual(finalCount, 1, "exactly one FINAL after the retry");
});

// ── crash tests via file truncation (reconstructed-state, not literal kill) ─
//
// The child-process failpoint tests below (§7c) are the DETERMINISTIC crash
// mechanism the verifier's Blocker 2 asks for. These truncation-based tests
// stay as an additional, cheaper in-process check of the same repair logic;
// they are named honestly as reconstructed-state tests, not crash tests.

check("Stage 1 · reconstructed state: FINAL present, all markers missing → repair, no duplicate FINAL", () => {
  const dir = scratch("s1-recon-after-final");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const identity = s1Identity("act-s1-recon-1");
  const paths = s1Paths(dir);
  const opts = s1WireOptions(logPath, dir);
  const r = req(identity, "req-a");

  const first = evaluateAndRecord(r, paths, opts, { declarationBinding: UNBOUND });
  assert.strictEqual(first.kind, "OK");

  // Truncate the journal back to PREPARED + FINAL only (drop every marker) —
  // as if the process died immediately after FINAL landed.
  const allLines = readFileSync(paths.journal, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const preparedAndFinal = allLines.filter((l) => {
    const parsed = JSON.parse(l);
    return parsed.recordType === "DECISION_PREPARED" || parsed.recordType === "DECISION_FINAL";
  });
  writeFileSync(paths.journal, preparedAndFinal.join("\n") + "\n", "utf8");

  const retry = evaluateAndRecord(r, paths, opts, { declarationBinding: UNBOUND });
  assert.strictEqual(retry.kind, "OK");
  if (retry.kind !== "OK") throw new Error("unreachable");
  assert.strictEqual(retry.replayed, true);
  assert.strictEqual(retry.delivery.trail, "DONE");
  assert.strictEqual(retry.delivery.ledger, "DONE");
  assert.strictEqual(retry.delivery.history, "DONE");
  assert.strictEqual(retry.delivery.events, "DONE");

  const journalRecords = jsonlRecords(paths.journal);
  assert.strictEqual(journalRecords.filter((r) => r.recordType === "DECISION_FINAL").length, 1);
  assert.strictEqual(journalRecords.filter((r) => r.recordType === "PROJECTION_DONE").length, 4);
});

check("Stage 1 · a FAILED history projection repairs to DONE without changing decisionHash or a second FINAL", () => {
  const dir = scratch("s1-repair-split");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const identity = s1Identity("act-s1-repair-split");
  const paths = s1Paths(dir);
  const opts = s1WireOptions(logPath, dir);
  const r = req(identity, "req-a");

  const blockedHistoryDir = join(dir, "blocked-history-parent");
  writeFileSync(blockedHistoryDir, "not a directory", "utf8");
  const firstPaths = { ...paths, history: join(blockedHistoryDir, "sub", "history.jsonl") };

  const first = evaluateAndRecord(r, firstPaths, opts, { declarationBinding: UNBOUND });
  assert.strictEqual(first.kind, "OK");
  if (first.kind !== "OK") throw new Error("unreachable");
  assert.strictEqual(first.delivery.history, "FAILED");
  const firstHash = (first.decision as Record<string, unknown>).decisionHash;

  writeSubstrateReadForTest(paths.history, identity.actionId, "RELEASE");

  const repaired = evaluateAndRecord(r, paths, opts, { declarationBinding: UNBOUND });
  assert.strictEqual(repaired.kind, "OK");
  if (repaired.kind !== "OK") throw new Error("unreachable");
  assert.strictEqual(repaired.replayed, true);
  assert.strictEqual(
    (repaired.decision as Record<string, unknown>).decisionHash,
    firstHash,
    "decisionHash changed across a repair"
  );
  assert.strictEqual(repaired.delivery.history, "DONE");
  assert.strictEqual(
    jsonlRecords(paths.journal).filter((rec) => rec.recordType === "DECISION_FINAL").length,
    1,
    "the repair issued a second FINAL"
  );
});

// ── declaration binding (Blocker 3) ──────────────────────────────────────────

check("Stage 1 · declarationBinding HASH is carried verbatim, never fabricated", () => {
  const dir = scratch("s1-decl-hash");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const identity = s1Identity("act-decl-hash");
  const paths = s1Paths(dir);
  const result = evaluateAndRecord(
    req(identity, "req-a"),
    paths,
    s1WireOptions(logPath, dir),
    { declarationBinding: BOUND }
  );
  assert.strictEqual(result.kind, "OK");
  if (result.kind !== "OK") throw new Error("unreachable");
  assert.deepStrictEqual((result.decision as Record<string, unknown>).declarationBinding, BOUND);
  const journalRecords = jsonlRecords(paths.journal);
  const final = journalRecords.find((r) => r.recordType === "DECISION_FINAL") as Record<string, unknown>;
  assert.deepStrictEqual(final.declarationBinding, BOUND);
});

check("Stage 1 · declarationBinding UNBOUND_STAGE_1 can never be parsed as a sha256", () => {
  const dir = scratch("s1-decl-unbound");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const identity = s1Identity("act-decl-unbound");
  const paths = s1Paths(dir);
  const result = evaluateAndRecord(
    req(identity, "req-a"),
    paths,
    s1WireOptions(logPath, dir),
    { declarationBinding: UNBOUND }
  );
  assert.strictEqual(result.kind, "OK");
  if (result.kind !== "OK") throw new Error("unreachable");
  const binding = (result.decision as Record<string, unknown>).declarationBinding as Record<string, unknown>;
  assert.strictEqual(binding.kind, "UNBOUND_STAGE_1");
  assert.strictEqual(binding.sha256, undefined, "UNBOUND_STAGE_1 must carry no sha256-shaped field at all");
});

// ── identity / toolName validation (belt and braces) ─────────────────────────

check("Stage 1 · evaluateAndRecord throws on an empty toolName — the library validates too", () => {
  const dir = scratch("s1-empty-toolname");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const identity = s1Identity("act-empty-tool");
  const paths = s1Paths(dir);
  assert.throws(
    () =>
      evaluateAndRecord(
        { identity, subject: identity.subject, toolName: "", requestHash: "req-a" },
        paths,
        s1WireOptions(logPath, dir),
        { declarationBinding: UNBOUND }
      ),
    EvaluateAndRecordUsageError
  );
});

// ── the CLI, spawned, routed through --journal ────────────────────────────────

console.log("\n══ 7b · --journal, spawned end to end ════════════════════════");

check("Stage 1 CLI · --journal with full identity/toolName/declaration routes through evaluateAndRecord", () => {
  const dir = scratch("s1-cli");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const sensorConfigPath = writeSensorConfig(dir);
  const paths = s1Paths(dir);
  const argv = [
    "--action-id", "act-cli-1",
    "--log", logPath,
    "--readable-load-state", "LOADED_UNVERIFIED_FILE",
    "--sensor-config", sensorConfigPath,
    "--line-classes", "routine,elevated,critical",
    "--hold-at-or-above", "elevated",
    "--subject", "richards-cat",
    "--session-id", "s-cli-1",
    "--tool-name", "bash",
    "--declaration-unbound",
    "--journal", paths.journal,
    "--floor-trail", paths.floorTrail,
    "--ledger", paths.ledger,
    "--history", paths.history,
    "--events", paths.events,
  ];
  const spawned = spawnGuard(argv);
  assert.ok(spawned.stdout.includes("MICA-GUARD action=act-cli-1"), `no machine tail line: ${spawned.stdout}`);
  assert.ok(existsSync(paths.journal), "no journal file created");
  const journalRecords = jsonlRecords(paths.journal);
  assert.strictEqual(journalRecords.filter((r) => r.recordType === "DECISION_FINAL").length, 1);
  assert.ok(existsSync(paths.floorTrail), "the real trail file was not written by the wrapper");
});

check("Stage 1 CLI · --journal without --tool-name is a usage error, exit 2", () => {
  const dir = scratch("s1-cli-no-toolname");
  const paths = s1Paths(dir);
  assert.throws(
    () =>
      parseArgs([
        "--action-id", "a", "--subject", "x", "--session-id", "y",
        "--journal", paths.journal, "--declaration-unbound",
      ]),
    GuardInvocationError
  );
});

check("Stage 1 CLI · --journal without a declaration flag is a usage error, exit 2", () => {
  const dir = scratch("s1-cli-no-decl");
  const paths = s1Paths(dir);
  assert.throws(
    () =>
      parseArgs([
        "--action-id", "a", "--subject", "x", "--session-id", "y",
        "--tool-name", "bash", "--journal", paths.journal,
      ]),
    GuardInvocationError
  );
});

check("Stage 1 CLI · --declaration-hash and --declaration-unbound together is a usage error", () => {
  const dir = scratch("s1-cli-both-decl");
  const paths = s1Paths(dir);
  assert.throws(
    () =>
      parseArgs([
        "--action-id", "a", "--subject", "x", "--session-id", "y",
        "--tool-name", "bash", "--journal", paths.journal,
        "--declaration-hash", CANONICAL_JSON_FIXTURE_1_HASH, "--declaration-unbound",
      ]),
    GuardInvocationError
  );
});

check("Stage 1 CLI · CONFLICT is exit 2 with kind=conflict, distinguishable from a usage/wiring exit 2", () => {
  const dir = scratch("s1-cli-conflict");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const sensorConfigPath = writeSensorConfig(dir);
  const paths = s1Paths(dir);
  const base = [
    "--log", logPath,
    "--readable-load-state", "LOADED_UNVERIFIED_FILE",
    "--sensor-config", sensorConfigPath,
    "--line-classes", "routine,elevated,critical",
    "--hold-at-or-above", "elevated",
    "--subject", "richards-cat",
    "--session-id", "s-cli-conflict",
    "--tool-name", "bash",
    "--declaration-unbound",
    "--journal", paths.journal,
    "--floor-trail", paths.floorTrail,
    "--ledger", paths.ledger,
  ];
  const first = spawnGuard(["--action-id", "act-cli-conflict", ...base]);
  assert.strictEqual(first.status, 0);

  // Same action-id, but a DIFFERENT stakes-class changes requestHash's inputs
  // (the CLI hashes identity/subject/toolName/stakesClass) enough to conflict
  // — simplest reliable way to force a hash mismatch from the CLI's own
  // request-hash construction without hand-computing it.
  const second = spawnGuard([
    "--action-id", "act-cli-conflict", ...base, "--stakes-class", "elevated",
  ]);
  assert.strictEqual(second.status, 2);
  assert.ok(/kind=conflict/.test(second.stdout), `no kind=conflict token: ${second.stdout}`);

  // A genuinely different, non-conflict exit-2 case: a malformed invocation.
  // F2: this must carry kind=usage, not merely "not kind=conflict".
  const malformed = spawnGuard(["--unknown-flag", "x"]);
  assert.strictEqual(malformed.status, 2);
  assert.ok(!/kind=conflict/.test(malformed.stdout), "a malformed invocation should never carry kind=conflict");
  assert.ok(/kind=usage/.test(malformed.stdout), `a malformed invocation must carry kind=usage: ${malformed.stdout}`);
});

// ── failpoints: a deterministic, child-process crash mechanism (Blocker 2) ──

console.log("\n══ 7c · failpoints — deterministic child-process crash tests ══");

function spawnGuardWithEnv(
  argv: readonly string[],
  env: Record<string, string>
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [TS_NODE_BIN, GUARD_ENTRY, ...argv], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (r.error) throw r.error;
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

function s1CliArgv(actionId: string, paths: ReturnType<typeof s1Paths>, logPath: string, sensorConfigPath: string): string[] {
  return [
    "--action-id", actionId,
    "--log", logPath,
    "--readable-load-state", "LOADED_UNVERIFIED_FILE",
    "--sensor-config", sensorConfigPath,
    "--line-classes", "routine,elevated,critical",
    "--hold-at-or-above", "elevated",
    "--subject", "richards-cat",
    "--session-id", "s-fp",
    "--tool-name", "bash",
    "--declaration-unbound",
    "--journal", paths.journal,
    "--floor-trail", paths.floorTrail,
    "--ledger", paths.ledger,
    "--history", paths.history,
    "--events", paths.events,
  ];
}

/**
 * F1's own healing note: the crash matrix must exercise a request where the
 * LEDGER is genuinely due — otherwise "ledger DONE" means "nothing was due"
 * for every boundary, and the ledger/events failpoints prove nothing. This
 * forces CANNOT_ASSESS (an injected load-state list the log's real state
 * will never match) with stakes BELOW the line, i.e. PASS_BLIND.
 */
function s1CliArgvPassBlind(
  actionId: string,
  paths: ReturnType<typeof s1Paths>,
  logPath: string,
  sensorConfigPath: string
): string[] {
  return [
    "--action-id", actionId,
    "--log", logPath,
    "--readable-load-state", "SOME_OTHER_STATE",
    "--sensor-config", sensorConfigPath,
    "--line-classes", "routine,elevated,critical",
    "--hold-at-or-above", "elevated",
    "--stakes-class", "routine",
    "--subject", "richards-cat",
    "--session-id", "s-fp",
    "--tool-name", "bash",
    "--declaration-unbound",
    "--journal", paths.journal,
    "--floor-trail", paths.floorTrail,
    "--ledger", paths.ledger,
    "--history", paths.history,
    "--events", paths.events,
  ];
}

// ALL TEN named boundaries (F1 item 4) — every one of the four projections'
// two failpoints, plus the two whole-evaluation boundaries.
for (const failpoint of [
  "after-prepared",
  "after-final",
  "after-projection:trail",
  "after-projection:ledger",
  "after-projection:history",
  "after-projection:events",
  "after-projection-append-before-marker:trail",
  "after-projection-append-before-marker:ledger",
  "after-projection-append-before-marker:history",
  "after-projection-append-before-marker:events",
] as const) {
  check(`FP · MICA_FAILPOINT=${failpoint} under NODE_ENV=test kills the process at exactly that boundary; restart+retry repairs`, () => {
    const dir = scratch(`s1-fp-${failpoint.replace(/[:]/g, "-")}`);
    const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
    const sensorConfigPath = writeSensorConfig(dir);
    const paths = s1Paths(dir);
    const argv = s1CliArgvPassBlind("act-fp", paths, logPath, sensorConfigPath);

    const crashed = spawnGuardWithEnv(argv, { NODE_ENV: "test", MICA_FAILPOINT: failpoint });
    assert.strictEqual(crashed.status, 70, `expected exit 70 at ${failpoint}, got ${crashed.status}`);
    assert.ok(/FAILPOINT FIRED/.test(crashed.stderr), crashed.stderr);

    // Restart WITHOUT the failpoint, retry the SAME request.
    const retried = spawnGuard(argv);
    assert.strictEqual(retried.status, 0, `retry should PASS-BLIND cleanly: ${retried.stdout}`);

    const journalRecords = jsonlRecords(paths.journal);
    assert.strictEqual(
      journalRecords.filter((r) => r.recordType === "DECISION_FINAL").length,
      1,
      `expected exactly one DECISION_FINAL after crash-at-${failpoint} + retry`
    );
    assert.strictEqual(
      journalRecords.filter((r) => r.recordType === "PROJECTION_DONE").length,
      4,
      `expected all four projections DONE after crash-at-${failpoint} + retry`
    );
    assert.ok(existsSync(paths.ledger), `the real ledger file must exist after crash-at-${failpoint} + retry (PASS_BLIND was due)`);

    // The target check F1 asks for explicitly: not "some event for this
    // identity" but the ONE event that IS the events projection's target —
    // kind DECISION_FINAL, projection null — actually present in the real
    // event book, exactly once, regardless of which boundary crashed.
    const eventRecords = jsonlRecords(paths.events);
    const targetEvents = eventRecords.filter(
      (r) => r.kind === "DECISION_FINAL" && r.projection === null
    );
    assert.strictEqual(
      targetEvents.length,
      1,
      `expected exactly one target DECISION_FINAL event after crash-at-${failpoint} + retry, found ${targetEvents.length} among ${JSON.stringify(eventRecords)}`
    );
  });
}

check("FP · MICA_FAILPOINT set WITHOUT NODE_ENV=test is INERT and says so once on stderr", () => {
  const dir = scratch("s1-fp-inert");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const sensorConfigPath = writeSensorConfig(dir);
  const paths = s1Paths(dir);
  const argv = s1CliArgv("act-fp-inert", paths, logPath, sensorConfigPath);
  const r = spawnGuardWithEnv(argv, { MICA_FAILPOINT: "after-final", NODE_ENV: "development" });
  assert.strictEqual(r.status, 0, "an inert failpoint outside NODE_ENV=test must never fire");
  assert.ok(/INERT/.test(r.stderr), r.stderr);
});

// ══ C8 · THE PASS-BLIND COUNTER'S LIFETIME ═══════════════════════════════════
//
// THE DEFECT, stated so a future reader does not have to reconstruct it:
// `BatchedNotifier` holds `sinceLastNotice` and `total` as INSTANCE fields, and
// `wire()` built one per call. `evaluate-and-record.ts` calls `wire()` once per
// ACTION. So the counter was born and buried inside one evaluation: three real
// pass-blind acts on the box each reported `count=1 totalSoFar=1`, and at any
// window above 1 the pending count died unflushed and NO notice was ever
// emitted at all. The notice text asks the operator to check whether the count
// is HIGHER THAN EXPECTED. Pinned at 1, it never could be.
//
// These tests are the difference between a counter and a constant. Test C8-2
// keeps the constant visible on purpose: the defect still holds for any caller
// that does not hand in an override, and pretending otherwise would be the same
// class of mistake one level along.

console.log("\n══ C8 · the pass-blind counter's lifetime ════════════════════");

/** A pass-blind request: blind floor (below), impact class below the line. */
function c8Req(actionId: string, stakesClass: string) {
  return {
    identity: s1Identity(actionId),
    subject: "richards-cat",
    toolName: "bash",
    stakesClass,
    requestHash: `req-${actionId}`,
  };
}

/** The notices actually on disk, as `count`/`totalSoFar` pairs, in book order. */
function noticeCounts(bookPath: string): { count: number; totalSoFar: number }[] {
  if (!existsSync(bookPath)) return [];
  return jsonlRecords(bookPath).map((record) => {
    const lines = record.lines as string[];
    const read = (prefix: string): number => {
      const hit = lines.find((l) => l.startsWith(prefix));
      assert.ok(hit !== undefined, `no ${prefix} line in ${JSON.stringify(lines)}`);
      return Number((hit as string).slice(prefix.length));
    };
    return { count: read("count="), totalSoFar: read("totalSoFar=") };
  });
}

check("C8-1 THE PLANTED CASE · one shared notifier across three evaluateAndRecord calls counts 1, 2, 3", () => {
  const dir = scratch("c8-shared-override");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const noticeDir = join(dir, "notices");

  // Built ONCE, outside the loop. This is the whole fix: the pair's lifetime is
  // the caller's, and the caller here outlives all three evaluations.
  const shared = buildNotifier({ noticeDir, noticeWindow: 1 });

  for (const n of [1, 2, 3]) {
    const result = evaluateAndRecord(
      c8Req(`c8-shared-${n}`, "routine"),
      s1Paths(dir),
      { ...blindOptions(logPath), line: LINE, decisionClock: CLOCK, notifierOverride: shared },
      { declarationBinding: UNBOUND }
    );
    assert.strictEqual(result.kind, "OK");
    assert.strictEqual(
      (result as { decision: Record<string, unknown> }).decision.disposition,
      "PASS_BLIND",
      `act ${n} was not PASS_BLIND, so this test would prove nothing about the counter`
    );
  }

  // THE ASSERTION THE DEFECT MADE IMPOSSIBLE. Before C8 this read 1, 1, 1.
  assert.deepStrictEqual(noticeCounts(join(noticeDir, "notices.jsonl")), [
    { count: 1, totalSoFar: 1 },
    { count: 1, totalSoFar: 2 },
    { count: 1, totalSoFar: 3 },
  ]);
  // The in-memory counter agrees with the book. Two readings of one fact: if
  // they ever disagree, the sink stopped receiving what the counter counted.
  assert.strictEqual(shared.batched.totalRecorded, 3);
  assert.strictEqual(shared.batched.pending, 0);
});

check("C8-2 THE DEFECT, PINNED · the SAME three acts WITHOUT an override still count 1, 1, 1", () => {
  const dir = scratch("c8-no-override");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const noticeDir = join(dir, "notices");

  for (const n of [1, 2, 3]) {
    const result = evaluateAndRecord(
      c8Req(`c8-peract-${n}`, "routine"),
      s1Paths(dir),
      { ...blindOptions(logPath), line: LINE, decisionClock: CLOCK, noticeDir, noticeWindow: 1 },
      { declarationBinding: UNBOUND }
    );
    assert.strictEqual(
      (result as { decision: Record<string, unknown> }).decision.disposition,
      "PASS_BLIND"
    );
  }

  // THIS IS THE C8 DEFECT, KEPT VISIBLE — NOT A BEHAVIOUR TO RELY ON.
  //
  // `wire()` still builds a notifier per call when no override is handed in,
  // because that is what every existing caller and fixture does and C8 changed
  // none of them. For a per-action caller `totalSoFar` is therefore still a
  // constant, and the notice's "if this count is higher than expected" is still
  // unreachable. The fix is not in this file: it is a caller whose lifetime is
  // longer than one action, which is what C8-1 above exercises and what the
  // bridge service does. If this test ever goes red, `wire()` acquired a
  // lifetime of its own and that is a deliberate change, not a pass.
  assert.deepStrictEqual(noticeCounts(join(noticeDir, "notices.jsonl")), [
    { count: 1, totalSoFar: 1 },
    { count: 1, totalSoFar: 1 },
    { count: 1, totalSoFar: 1 },
  ]);
});

check("C8-3 · window=3 over five acts emits at three, and flush() emits the tail of two — none uncounted, none twice", () => {
  const dir = scratch("c8-window-3");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const noticeDir = join(dir, "notices");
  const shared = buildNotifier({ noticeDir, noticeWindow: 3 });
  const book = join(noticeDir, "notices.jsonl");

  for (const n of [1, 2, 3, 4, 5]) {
    evaluateAndRecord(
      c8Req(`c8-w3-${n}`, "routine"),
      s1Paths(dir),
      { ...blindOptions(logPath), line: LINE, decisionClock: CLOCK, notifierOverride: shared },
      { declarationBinding: UNBOUND }
    );
  }

  // At window=3 the FIRST notice does not appear until the third act — which,
  // before C8, never happened at all: the counter died at act 1 with pending=1
  // and nothing was ever written. A window above 1 was an unusable value.
  assert.deepStrictEqual(noticeCounts(book), [{ count: 3, totalSoFar: 3 }]);
  assert.strictEqual(shared.batched.pending, 2, "two acts are suppressed, not lost");

  const tail = shared.batched.flush();
  assert.strictEqual(tail?.count, 2);
  assert.strictEqual(tail?.totalSoFar, 5);
  assert.deepStrictEqual(noticeCounts(book), [
    { count: 3, totalSoFar: 3 },
    { count: 2, totalSoFar: 5 },
  ]);

  // The arithmetic that makes "batched" honest: every act is covered by exactly
  // one notice's count, and the counts sum to the acts.
  const counts = noticeCounts(book);
  assert.strictEqual(
    counts.reduce((sum, c) => sum + c.count, 0),
    5
  );
  assert.strictEqual(counts[counts.length - 1].totalSoFar, 5);
  assert.strictEqual(shared.batched.flush(), null, "a second flush must emit nothing");
});

check("C8-4 · a HELD act and a RELEASE act move the counter NOT AT ALL — it counts PASS-BLIND and nothing else", () => {
  const dir = scratch("c8-only-pass-blind");
  const blindLog = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const noticeDir = join(dir, "notices");
  const shared = buildNotifier({ noticeDir, noticeWindow: 1 });
  const book = join(noticeDir, "notices.jsonl");

  // HELD: same blind floor, impact class AT the line.
  const held = evaluateAndRecord(
    c8Req("c8-held", "critical"),
    s1Paths(dir),
    { ...blindOptions(blindLog), line: LINE, decisionClock: CLOCK, notifierOverride: shared },
    { declarationBinding: UNBOUND }
  );
  assert.strictEqual(
    (held as { decision: Record<string, unknown> }).decision.disposition,
    "HOLD_BLIND"
  );

  // RELEASE: readable load states, so the floor is not blind at all.
  const released = evaluateAndRecord(
    c8Req("c8-release", "routine"),
    s1Paths(dir),
    { ...baseOptions(blindLog), line: LINE, decisionClock: CLOCK, notifierOverride: shared },
    { declarationBinding: UNBOUND }
  );
  assert.strictEqual(
    (released as { decision: Record<string, unknown> }).decision.disposition,
    "RELEASE"
  );

  assert.strictEqual(shared.batched.totalRecorded, 0);
  assert.strictEqual(shared.batched.pending, 0);
  assert.deepStrictEqual(noticeCounts(book), []);

  // And it is still live: one real pass-blind act after both, and it counts 1.
  evaluateAndRecord(
    c8Req("c8-after", "routine"),
    s1Paths(dir),
    { ...blindOptions(blindLog), line: LINE, decisionClock: CLOCK, notifierOverride: shared },
    { declarationBinding: UNBOUND }
  );
  assert.deepStrictEqual(noticeCounts(book), [{ count: 1, totalSoFar: 1 }]);
});

check("C8-5 · notifierOverride TOGETHER with any construction field is REFUSED, by name, before anything is wired", () => {
  const dir = scratch("c8-conflict");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const shared = buildNotifier({ noticeDir: join(dir, "owned"), noticeWindow: 1 });
  const intakeDir = join(dir, "intake");
  mkdirSync(intakeDir, { recursive: true });

  const conflicts: { field: string; extra: Partial<WireOptions> }[] = [
    { field: "noticeDir", extra: { noticeDir: join(dir, "second") } },
    { field: "noticeWindow", extra: { noticeWindow: 5 } },
    {
      field: "witnessIntake",
      extra: {
        witnessIntake: { dir: intakeDir, submitterId: "x", modality: "NOT_AN_INSTRUCTION" },
      },
    },
    { field: "transport", extra: { transport: () => ({ detail: "accepted" }) } },
  ];

  for (const { field, extra } of conflicts) {
    let threw: unknown = null;
    try {
      wire({ ...blindOptions(logPath), line: LINE, notifierOverride: shared, ...extra });
    } catch (err) {
      threw = err;
    }
    assert.ok(threw instanceof WireUsageError, `${field}: expected WireUsageError, got ${threw}`);
    assert.ok(
      (threw as Error).message.includes(field),
      `${field}: the refusal must NAME the field that conflicts, got: ${(threw as Error).message}`
    );
    assert.ok((threw as Error).message.startsWith(NOTIFIER_OVERRIDE_CONFLICT));
  }

  // NOTHING was created for the refused destination. A refusal that had already
  // opened a second book would be worse than the silent ignore it replaces.
  assert.ok(!existsSync(join(dir, "second")), "the refused noticeDir was created anyway");

  // And the override ALONE still wires — the refusal is about the combination.
  const ok = wire({ ...blindOptions(logPath), line: LINE, notifierOverride: shared });
  assert.strictEqual(ok.census.noticeOwnership, "CALLER_OWNED");
});

check("C8-6 · the census tells the three ownerships apart as a VALUE, not only as prose", () => {
  const dir = scratch("c8-census");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());

  const unwired = wire({ ...blindOptions(logPath), line: LINE });
  assert.strictEqual(unwired.census.noticeOwnership, "NOT_WIRED");
  assert.strictEqual(unwired.notifier, null);
  assert.ok(unwired.census.notices.includes("NO DEFAULT SINK"));

  const builtHere = wire({
    ...blindOptions(logPath),
    line: LINE,
    noticeDir: join(dir, "built-here"),
    noticeWindow: 1,
  });
  assert.strictEqual(builtHere.census.noticeOwnership, "BUILT_BY_THIS_WIRING");
  // BYTE-IDENTICAL to what this census said before C8: the extraction moved the
  // construction, and the wording with it, without changing either.
  assert.strictEqual(
    builtHere.census.notices,
    buildNotifier({ noticeDir: join(dir, "built-here"), noticeWindow: 1 }).censusLine
  );
  assert.ok(!builtHere.census.notices.includes("CALLER-OWNED"));

  const shared = buildNotifier({ noticeDir: join(dir, "caller-owned"), noticeWindow: 1 });
  const owned = wire({ ...blindOptions(logPath), line: LINE, notifierOverride: shared });
  assert.strictEqual(owned.census.noticeOwnership, "CALLER_OWNED");
  assert.ok(owned.census.notices.startsWith(CALLER_OWNED_NOTIFIER));
  // The census still names the real book under an override — a reader who can
  // see "caller-owned" but not WHICH FILE has been told half a fact.
  assert.ok(owned.census.notices.includes(shared.bookPath));
  assert.ok(owned.census.notices.includes("SERVICE-LIFETIME"));

  // Rendered, the owner is its own line — `totalSoFar` cannot be read without it.
  for (const [wiring, expected] of [
    [unwired, "NOT_WIRED"],
    [builtHere, "BUILT_BY_THIS_WIRING"],
    [owned, "CALLER_OWNED"],
  ] as const) {
    assert.ok(
      renderCensus(wiring.census).includes(`notice owner    : ${expected}`),
      `the rendered census did not carry ownership ${expected}`
    );
  }
});

/** Every path under `dir`, relative and sorted — directories included. */
function treeOf(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string, prefix: string): void => {
    for (const name of readdirSync(at, { withFileTypes: true })) {
      const rel = prefix === "" ? name.name : `${prefix}/${name.name}`;
      out.push(name.isDirectory() ? `${rel}/` : rel);
      if (name.isDirectory()) walk(join(at, name.name), rel);
    }
  };
  walk(dir, "");
  return out.sort();
}

check("C8-7 · with NO destination and NO override, still nothing is computed, written, or created", () => {
  const dir = scratch("c8-still-nothing");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const before = treeOf(dir);

  // TWO pass-blind acts, not one. A default destination smuggled in with the
  // shipped window of 25 would write nothing on a single act, so a one-act
  // version of this test would pass over exactly the defect it names. Two is
  // not proof either — see the residual below — it simply costs nothing.
  for (const n of [1, 2]) {
    const result = evaluateAndRecord(
      c8Req(`c8-nothing-${n}`, "routine"),
      { journal: join(dir, "journal.jsonl") },
      { ...blindOptions(logPath), line: LINE, decisionClock: CLOCK },
      { declarationBinding: UNBOUND }
    );
    assert.strictEqual(
      (result as { decision: Record<string, unknown> }).decision.disposition,
      "PASS_BLIND"
    );
  }

  // RECURSIVE, and directories count. `NoticeLog` mkdir's its book's parent at
  // CONSTRUCTION, before any notice fires, so a created-but-silent destination
  // shows up here as a directory even when no record was ever written.
  const appeared = treeOf(dir).filter((n) => !before.includes(n));
  assert.deepStrictEqual(
    appeared,
    ["journal.jsonl"],
    "a notice destination appeared that nobody asked for"
  );

  // THE RESIDUAL, NAMED. `evaluateAndRecord` does not return `wire()`'s census,
  // so on THIS path the only evidence available is the filesystem — and a
  // destination whose parent already exists and whose window never closes
  // leaves no trace on it. The claim "no notifier was constructed at all" is
  // C8-6's to make, at the `wire()` seam, where the census is readable.
});

// ══ P6 · the reader footing, and WHOSE reading it is ═════════════════════════
//
// THE DEFECT THESE CLOSE. `mica-bridge`'s /guard response returned
// `readerFootings: []` on every guarded act while two readers really did run —
// "a field that reads identically whether or not the thing it describes
// happened" (stage1-guard-adapter.ts:151-172, register E1). Closing it needs
// the footing to travel OUT of `evaluateAndRecord`, and the only footing worth
// carrying is the one THIS call's `wire()` took.
//
// THE TRAP THESE TESTS EXIST TO SPRING. The cheap way to populate the field is
// to read the log again — a second `wire()`, a `/status` probe, a memoised
// census — and present that as the decision's footing. It looks identical on a
// quiet box and is a lie exactly when the log changed between the two reads.
// `footings-belong-to-their-own-call` below is the test that can tell.

console.log("\n══ P6 · the reader footing ══════════════════════════════════");

/** Both wired readers' footing, as `{reader: loadState}`, in wiring order. */
function footingPairs(
  report: { kind: "THIS_CALL"; readers: readonly { reader: string; loadState: string }[] } | { kind: "NO_READING_TAKEN"; reason: string }
): [string, string][] {
  assert.strictEqual(report.kind, "THIS_CALL", `expected a reading, got ${JSON.stringify(report)}`);
  if (report.kind !== "THIS_CALL") throw new Error("unreachable");
  return report.readers.map((f) => [f.reader, f.loadState]);
}

check("P6 · a guarded act reports BOTH wired readers' footing, at the load state the reader really reported", () => {
  const dir = scratch("p6-live");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const result = evaluateAndRecord(
    req(s1Identity("p6-live"), "req-p6-live"),
    s1Paths(dir),
    s1WireOptions(logPath, dir),
    { declarationBinding: UNBOUND }
  );
  assert.strictEqual(result.kind, "OK");
  if (result.kind !== "OK") throw new Error("unreachable");
  // EXACTLY two, and EXACTLY these two. A mapping that walked every census row
  // would also emit `clerk1.gap` — which is UNWIRED here and read no log at
  // all — and that is a fabricated reading, not a thinner one.
  assert.deepStrictEqual(footingPairs(result.readerFootings), [
    ["MICA/Eng", "LOADED_UNVERIFIED_FILE"],
    ["MICA/Sig", "LOADED_UNVERIFIED_FILE"],
  ]);
});

check("P6 · no log wired → an EMPTY reading, never an invented one", () => {
  const dir = scratch("p6-unwired");
  const opts = s1WireOptions(join(dir, "observed.jsonl"), dir);
  const { logPath: _dropped, ...noLog } = opts as WireOptions & { logPath?: string };
  const result = evaluateAndRecord(
    req(s1Identity("p6-unwired"), "req-p6-unwired"),
    s1Paths(dir),
    noLog as WireOptions,
    { declarationBinding: UNBOUND }
  );
  assert.strictEqual(result.kind, "OK");
  if (result.kind !== "OK") throw new Error("unreachable");
  // Ruling R item 2, unchanged: UNWIRED has no footing to disclose. The report
  // still says THIS_CALL — a reading WAS attempted this call and found nothing
  // to stand on, which is a different fact from "no reading was taken".
  assert.deepStrictEqual(footingPairs(result.readerFootings), []);
});

check("P6 · footings belong to their OWN call — a log that changes between two acts changes the footing, in both directions", () => {
  const dir = scratch("p6-own-call");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const paths = s1Paths(dir);
  const opts = s1WireOptions(logPath, dir);

  // Act 1 — the file is there and parses.
  const first = evaluateAndRecord(req(s1Identity("p6-own-1"), "req-1"), paths, opts, {
    declarationBinding: UNBOUND,
  });
  // Act 2 — the same path, the file GONE. A footing sourced from any earlier
  // reading (a cached census, a module-level wiring, a /status probe taken at
  // start-up) still says LOADED_UNVERIFIED_FILE here. Only a footing taken by
  // THIS call's reader can say FILE_ABSENT.
  rmSync(logPath);
  const second = evaluateAndRecord(req(s1Identity("p6-own-2"), "req-2"), paths, opts, {
    declarationBinding: UNBOUND,
  });
  // Act 3 — the file BACK. The other direction, so a footing frozen at the
  // most recent reading rather than the first is killed too.
  writeJsonl(dir, "observed.jsonl", healthySpecs());
  const third = evaluateAndRecord(req(s1Identity("p6-own-3"), "req-3"), paths, opts, {
    declarationBinding: UNBOUND,
  });

  assert.strictEqual(first.kind, "OK");
  assert.strictEqual(second.kind, "OK");
  assert.strictEqual(third.kind, "OK");
  if (first.kind !== "OK" || second.kind !== "OK" || third.kind !== "OK") throw new Error("unreachable");
  assert.deepStrictEqual(footingPairs(first.readerFootings), [
    ["MICA/Eng", "LOADED_UNVERIFIED_FILE"],
    ["MICA/Sig", "LOADED_UNVERIFIED_FILE"],
  ]);
  assert.deepStrictEqual(footingPairs(second.readerFootings), [
    ["MICA/Eng", "FILE_ABSENT"],
    ["MICA/Sig", "FILE_ABSENT"],
  ]);
  assert.deepStrictEqual(footingPairs(third.readerFootings), [
    ["MICA/Eng", "LOADED_UNVERIFIED_FILE"],
    ["MICA/Sig", "LOADED_UNVERIFIED_FILE"],
  ]);
});

check("P6 · a REPLAY says no reading was taken — it does not borrow the original call's footing, and it does not report an empty one", () => {
  const dir = scratch("p6-replay");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const paths = s1Paths(dir);
  const opts = s1WireOptions(logPath, dir);
  const identity = s1Identity("p6-replay");

  const live = evaluateAndRecord(req(identity, "req-same"), paths, opts, { declarationBinding: UNBOUND });
  const replay = evaluateAndRecord(req(identity, "req-same"), paths, opts, { declarationBinding: UNBOUND });

  assert.strictEqual(live.kind, "OK");
  assert.strictEqual(replay.kind, "OK");
  if (live.kind !== "OK" || replay.kind !== "OK") throw new Error("unreachable");
  assert.strictEqual(live.replayed, false);
  assert.strictEqual(replay.replayed, true);
  assert.strictEqual(live.readerFootings.kind, "THIS_CALL");
  // THE WHOLE POINT: not `{kind:"THIS_CALL", readers: []}`. `[]` would say
  // "this call's readers found nothing to stand on", which is false — this
  // call HAS no readers. The two are different facts and are different values.
  assert.strictEqual(replay.readerFootings.kind, "NO_READING_TAKEN");
  if (replay.readerFootings.kind !== "NO_READING_TAKEN") throw new Error("unreachable");
  assert.ok(
    replay.readerFootings.reason.includes("REPLAYED"),
    `the reason must name the path that took no reading: ${replay.readerFootings.reason}`
  );
});

/**
 * Code with COMMENT LINES removed, line-based — the same discipline (and the
 * same reason for it) as `tools/suite-source-fence.test.ts`'s `codeOnly`:
 * a trailing-comment regex strip truncates at the first `//` on the line,
 * including one inside a string literal. Copied rather than imported, because
 * importing it would mean importing a `*.test.ts` and running its checks
 * inside this file's counters.
 */
function codeOnlyLines(source: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of source.split("\n")) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes("*/")) inBlock = false;
      continue;
    }
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) inBlock = true;
      continue;
    }
    if (t.startsWith("//") || t.startsWith("*")) continue;
    out.push(line);
  }
  return out.join("\n");
}

/** Calls to `wire(` in code, comments excluded. */
function wireCallsIn(source: string): number {
  return (codeOnlyLines(source).match(/\bwire\(/g) ?? []).length;
}

check("P6 · THE FENCE'S OWN VALIDITY GATE — a planted second wire() call is seen, and a commented one is not", () => {
  // A fence that has never been shown to fail is a fence nobody has tested.
  assert.strictEqual(wireCallsIn("const w = wire(opts);\nconst x = wire(opts);"), 2);
  assert.strictEqual(wireCallsIn("// const w = wire(opts);\nconst x = wire(opts);"), 1);
  assert.strictEqual(wireCallsIn("const w = footingsFromWiring(w);"), 0);
});

check("P6 · evaluate-and-record.ts calls wire() EXACTLY ONCE — a second call is a second reading, and it is not the one that decided", () => {
  // THE STRUCTURAL HALF OF THE SAME-CALL GUARANTEE, and the only half a test
  // can hold. `footingsFromWiring(wire(wireOptions))` — a fresh wiring built
  // purely to answer "what are the readers standing on?" — is the most
  // plausible wrong implementation there is: it compiles, it returns two real
  // footings, and on a quiet box it agrees with the right answer every time.
  // No behavioural test can separate two reads microseconds apart of the same
  // unchanged file. What CAN be held is that the second read does not exist:
  // one `wire()` call in this file means the wiring that decided and the
  // wiring that was asked are necessarily the same object.
  const source = readFileSync(join(__dirname, "evaluate-and-record.ts"), "utf8");
  assert.strictEqual(
    wireCallsIn(source),
    1,
    "evaluate-and-record.ts must call wire() exactly once — see this check's body"
  );
});

check("P6 · footingsFromWiring reads ITS ARGUMENT and nothing else — two live wirings over two different files never cross", () => {
  const dir = scratch("p6-pure");
  const goodPath = writeJsonl(dir, "good.jsonl", healthySpecs());
  const absentPath = join(dir, "never-written.jsonl");

  const good = wire(baseOptions(goodPath));
  const absent = wire(baseOptions(absentPath));

  // Both wirings are alive AT THE SAME TIME and are read in the opposite order
  // to the one they were built in. A derivation that consulted anything global
  // — a last-wire cache, the filesystem at read time, a module-level census —
  // would give these two the same answer.
  assert.deepStrictEqual(
    footingsFromWiring(absent).map((f) => f.loadState),
    ["FILE_ABSENT", "FILE_ABSENT"]
  );
  assert.deepStrictEqual(
    footingsFromWiring(good).map((f) => f.loadState),
    ["LOADED_UNVERIFIED_FILE", "LOADED_UNVERIFIED_FILE"]
  );
  assert.deepStrictEqual(
    footingsFromWiring(absent).map((f) => f.reader),
    ["MICA/Eng", "MICA/Sig"]
  );

  // No log at all → no reader stood anywhere. Not a fabricated row per census
  // entry, and not a null-filled one either: the array is the readers that
  // READ, and it is allowed to be empty.
  const noLog = wire({ readableLoadStates: GATE, eng: ENG_CONFIG, sig: SIG_CONFIG, decisionClock: CLOCK });
  assert.deepStrictEqual(footingsFromWiring(noLog), []);
});

// ── ITEM 4 · narrow-K at the front door ──────────────────────────────────────
//
// What these prove, in one line each, because the value of this block is the
// THIRD one and the others are there so it cannot be misread:
//
//   1. undeclared narrow-K is a VACANCY — it composes nothing and the sensor
//      list is byte-identical to the list before narrow-K existed;
//   2. a declared narrow-K COMPOSES — it is a real reader, not a census row;
//   3. **a profile declared BEFORE a caller writes its classes HOLDS EVERY
//      ACT** — leg 1 alarms on absence with no sample grace, and no stakes
//      line releases an alarm;
//   4. the same profile, once the classes are in the record but the sample is
//      short, is CANNOT_ASSESS with INSUFFICIENT_SAMPLE named — which is the
//      state this deployment should expect to sit in for a while;
//   5. a wired narrow-K reports the footing it actually stood on.

/** The three post-hold conduct kinds the bridge accepts (R1 substrate). */
const POST_HOLD_PROFILE: readonly string[] = [
  "HELD_THEN_STOPPED",
  "HELD_THEN_RETRIED",
  "HELD_THEN_DIVERGED",
];

/** Leg 2's injected numbers. They live in the TEST; no instrument holds them. */
const NARROW_K_CONFIG = {
  declaredProfile: POST_HOLD_PROFILE,
  correlationThreshold: 0.05,
  correlationMinimumConstraintEvents: 30,
  correlationCeilingMargin: 0.02,
};

function sensorIds(w: ReturnType<typeof wire>): string[] {
  return w.sensorVerdicts.map((v) => v.sensorId);
}

check("narrow-K UNDECLARED is a vacancy: it composes nothing and says why", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-nk-"));
  const logPath = writeJsonl(dir, "log.jsonl", healthySpecs());
  const w = wire({ ...baseOptions(logPath), floorTrailPath: join(dir, "trail.jsonl") });

  const row = w.census.readers.find((r) => r.reader === "MICA/narrow-K");
  assert.ok(row, "narrow-K must appear in the census even when it is not wired");
  assert.strictEqual(row!.wired, false);
  assert.strictEqual(row!.verdictKind, null);
  assert.strictEqual(row!.source, NARROW_K_NOT_DECLARED);

  // THE INERTNESS CLAIM, ASSERTED RATHER THAN BELIEVED. An undeclared narrow-K
  // must leave the composed sensor list exactly as it was — same ids, same
  // order. This is the assertion that makes "relaying this change cannot move
  // a disposition" a tested statement instead of a hopeful one.
  assert.deepStrictEqual(sensorIds(w), ["MICA/Eng", "MICA/Sig"]);
  assert.ok(!renderCensus(w.census).includes("WIRED     MICA/narrow-K"));
});

check("narrow-K DECLARED composes — it is a reader, not a census row", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-nk-"));
  // Give it the classes so this test is about COMPOSITION, not about the alarm.
  const specs = healthySpecs();
  for (let i = 0; i < 6; i++) {
    specs.push({
      sequenceNumber: 90 + i,
      timestamp: T0 + 90 + i,
      moduleId: "m3",
      eventType: POST_HOLD_PROFILE[i % 3],
      outcome: "STAKES",
    });
  }
  const logPath = writeJsonl(dir, "log.jsonl", specs);
  const w = wire({
    ...baseOptions(logPath),
    narrowK: NARROW_K_CONFIG,
    floorTrailPath: join(dir, "trail.jsonl"),
  });

  const row = w.census.readers.find((r) => r.reader === "MICA/narrow-K");
  assert.strictEqual(row!.wired, true);
  assert.ok(sensorIds(w).includes("MICA/narrow-K"), "a declared narrow-K must reach the floor");
});

check(
  "THE ORDERING HAZARD · a profile declared before any caller writes its classes HOLDS EVERY ACT",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "mica-glue-nk-"));
    // The record is HEALTHY and contains none of the three post-hold classes —
    // which is exactly what this deployment's subject log looks like today.
    const logPath = writeJsonl(dir, "log.jsonl", healthySpecs());
    const w = wire({
      ...baseOptions(logPath),
      narrowK: NARROW_K_CONFIG,
      floorTrailPath: join(dir, "trail.jsonl"),
      line: LINE,
    });

    const k = w.sensorVerdicts.find((v) => v.sensorId === "MICA/narrow-K");
    assert.ok(k, "narrow-K must have composed");
    assert.strictEqual(
      k!.kind,
      "ALARM",
      "leg 1 alarms on an ABSENT declared class and has NO minimum-sample grace — " +
        "correlationMinimumConstraintEvents guards leg 2 alone"
    );
    assert.deepStrictEqual(
      (k as unknown as { findings: readonly { code: string }[] }).findings.map((f) => f.code),
      ["K_CONSTRAINT_CLASS_ABSENT", "K_CONSTRAINT_CLASS_ABSENT", "K_CONSTRAINT_CLASS_ABSENT"]
    );

    // And the consequence, at the door rather than in the reader: an ALARM
    // holds whatever the stakes are. A `routine` action — the LOWEST class on
    // the line — is held, which is the shape of "every act".
    const d = w.chokepoint.guard({ id: "act-1" }, w.sensorVerdicts, {
      impactClass: "routine",
    });
    assert.strictEqual(
      d.disposition,
      "HOLD",
      "an ALARM floor HOLDs at every stakes class: there is no stakes value that " +
        "releases an alarm (chokepoint/types.ts). A pilot pass-blind override " +
        "cannot rescue this either — that override lives in the CANNOT_ASSESS " +
        "branch alone. DECLARE THE PROFILE ONLY AFTER A CALLER WRITES ITS CLASSES."
    );
    assert.strictEqual(d.execute, false);
  }
);

check(
  "narrow-K with the classes present but the sample short → CANNOT_ASSESS, INSUFFICIENT_SAMPLE named",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "mica-glue-nk-"));
    const specs = healthySpecs();
    // Nine post-hold records, three of each class — present, and far below the
    // injected minimum of 30.
    for (let i = 0; i < 9; i++) {
      specs.push({
        sequenceNumber: 90 + i,
        timestamp: T0 + 90 + i,
        moduleId: "m3",
        eventType: POST_HOLD_PROFILE[i % 3],
        outcome: "STAKES",
      });
    }
    const logPath = writeJsonl(dir, "log.jsonl", specs);
    const w = wire({
      ...baseOptions(logPath),
      narrowK: NARROW_K_CONFIG,
      floorTrailPath: join(dir, "trail.jsonl"),
      line: LINE,
    });

    const k = w.sensorVerdicts.find((v) => v.sensorId === "MICA/narrow-K");
    assert.strictEqual(k!.kind, "CANNOT_ASSESS");
    assert.deepStrictEqual(
      (k as unknown as { blindPaths: readonly { class: string }[] }).blindPaths.map(
        (b) => b.class
      ),
      ["INSUFFICIENT_SAMPLE"],
      "the reason must be NAMED, the way Eng's is — a bare CANNOT_ASSESS is a " +
        "shrug, and a shrug is what this project keeps paying to remove"
    );
  }
);

check("a WIRED narrow-K reports the footing it actually stood on", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-nk-"));
  const logPath = writeJsonl(dir, "log.jsonl", healthySpecs());

  const without = wire({ ...baseOptions(logPath) });
  assert.deepStrictEqual(
    footingsFromWiring(without).map((f) => f.reader),
    ["MICA/Eng", "MICA/Sig"],
    "an unwired narrow-K took no reading, so it has no footing to report"
  );

  const with_ = wire({ ...baseOptions(logPath), narrowK: NARROW_K_CONFIG });
  assert.deepStrictEqual(
    footingsFromWiring(with_).map((f) => f.reader),
    ["MICA/Eng", "MICA/Sig", "MICA/narrow-K"]
  );
  assert.deepStrictEqual(
    footingsFromWiring(with_).map((f) => f.loadState),
    ["LOADED_UNVERIFIED_FILE", "LOADED_UNVERIFIED_FILE", "LOADED_UNVERIFIED_FILE"],
    "narrow-K is handed the SAME adapter instance Eng and Sig are handed, so its " +
      "footing is that adapter's state by construction"
  );
});

// ── H12 · OP-3 node response at the front door ───────────────────────────────
//
// Item 4's block, aimed at item 4's three properties and at the two this
// deployment adds. What each one proves, one line each:
//
//   1. undeclared OP-3 is a VACANCY — it composes nothing, the sensor list and
//      the footings list are byte-identical to the lists before OP-3 existed,
//      and the census says why AND prints the ceiling while saying it;
//   2. a declared OP-3 COMPOSES — it is a real reader, not a census row;
//   3. **THE HELD-ACT TRIPWIRE** — this caller writes no TOOL_RESULT on the
//      held path, so with `responseClass = TOOL_RESULT` one held act ALARMS
//      and every act is held from then on;
//   4. **THE MISPAIRING** — widening the bound to hide (3) pairs an attempt to
//      a DIFFERENT actionId's result. The instrument never reads actionId; the
//      record carries it on every line. This is the ceiling, demonstrated;
//   5. the ceiling is on the VERDICT'S OWN FACE, not only in the census;
//   6. a wired OP-3 reports the footing it actually stood on.

/** This deployment's subject, as `mica-service.ts` writes it: `moduleId = identity.subject`. */
const HK = "housekeeper";

/**
 * THE CALLER'S ACTUAL GRAMMAR, read at bytes from `claude-bot.ts` rather than
 * imagined: one act writes TOOL_ATTEMPTED -> TOOL_EXECUTED -> TOOL_RESULT when
 * it RAN, and TOOL_ATTEMPTED -> TOOL_HELD_NOT_EXECUTED when it was HELD. Acts
 * are processed one at a time in an awaited loop over a single serialized
 * outbox, so the records of one act are contiguous and `sequenceNumber`
 * increments by exactly one per record. THE RESULT IS THEREFORE EXACTLY TWO
 * STEPS AFTER ITS ATTEMPT, and that fact — not a round number — is what
 * `responseBoundSteps` is declared from.
 */
function harnessSpecs(acts: readonly ("RAN" | "HELD")[]): LineSpec[] {
  const out: LineSpec[] = [];
  acts.forEach((act, i) => {
    const actionId = `toolu_${String(i).padStart(4, "0")}`;
    const push = (eventType: string, outcome: string): void => {
      out.push({
        sequenceNumber: out.length,
        timestamp: T0 + out.length,
        moduleId: HK,
        eventType,
        outcome,
        actionId,
      });
    };
    push("TOOL_ATTEMPTED", "bash");
    if (act === "RAN") {
      push("TOOL_EXECUTED", "bash");
      push("TOOL_RESULT", "CLEAN");
    } else {
      push("TOOL_HELD_NOT_EXECUTED", "MICA_HOLD");
    }
  });
  return out;
}

/** The declaration under test. It lives in the TEST; no instrument holds it. */
const OP3_PROFILE = {
  expectationClass: { moduleId: HK, eventType: "TOOL_ATTEMPTED" },
  responseClass: { moduleId: HK, eventType: "TOOL_RESULT" },
  responseBoundSteps: 2,
};

function op3Of(w: ReturnType<typeof wire>) {
  return w.sensorVerdicts.find((v) => v.sensorId === OP3_READER);
}

check("OP-3 UNDECLARED is a vacancy: it composes nothing, and says why WITH the ceiling", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-op3-"));
  const logPath = writeJsonl(dir, "log.jsonl", harnessSpecs(["RAN", "RAN", "RAN"]));
  const w = wire({ ...baseOptions(logPath), floorTrailPath: join(dir, "trail.jsonl") });

  const row = w.census.readers.find((r) => r.reader === OP3_READER);
  assert.ok(row, "OP-3 must appear in the census even when it is not wired");
  assert.strictEqual(row!.wired, false);
  assert.strictEqual(row!.verdictKind, null);
  assert.ok(row!.source.includes(OP3_NOT_DECLARED), "the vacancy must state its own reason");
  assert.ok(
    row!.source.includes(OP3_HARNESS_PAIRING_CEILING),
    "the ceiling rides the UNWIRED row too — a reader deciding whether to declare " +
      "this block is exactly the reader who needs to know what it would be reading"
  );

  // THE INERTNESS CLAIM, ASSERTED RATHER THAN BELIEVED. An undeclared OP-3 must
  // leave the composed sensor list and the footings list exactly as they were —
  // same ids, same order. This is what makes "relaying this change cannot move a
  // disposition" a tested statement instead of a hopeful one.
  assert.deepStrictEqual(sensorIds(w), ["MICA/Eng", "MICA/Sig"]);
  assert.deepStrictEqual(
    footingsFromWiring(w).map((f) => f.reader),
    ["MICA/Eng", "MICA/Sig"],
    "an unwired OP-3 took no reading, so it has no footing to report"
  );
  assert.ok(!renderCensus(w.census).includes(`WIRED     ${OP3_READER}`));
});

check("OP-3 DECLARED composes — it is a reader, not a census row", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-op3-"));
  const logPath = writeJsonl(dir, "log.jsonl", harnessSpecs(["RAN", "RAN", "RAN", "RAN"]));
  const w = wire({
    ...baseOptions(logPath),
    op3: OP3_PROFILE,
    floorTrailPath: join(dir, "trail.jsonl"),
  });

  const row = w.census.readers.find((r) => r.reader === OP3_READER);
  assert.strictEqual(row!.wired, true);
  assert.ok(sensorIds(w).includes(OP3_READER), "a declared OP-3 must reach the floor");
  // Every attempt on the RAN path has its result exactly two steps later, so
  // the declared bound of 2 admits it and leg A finds nothing to alarm about.
  assert.notStrictEqual(op3Of(w)!.kind, "ALARM");
});

check(
  "THE HELD-ACT TRIPWIRE · one held act ALARMS OP-3 and then every act is held",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "mica-glue-op3-"));
    // Three acts ran; ONE was held. The held act's TOOL_ATTEMPTED is followed by
    // TOOL_HELD_NOT_EXECUTED and by no TOOL_RESULT, ever — the caller writes
    // none on that path, and `responseClass` has room for exactly one class.
    const specs = harnessSpecs(["RAN", "HELD", "RAN", "RAN"]);
    const logPath = writeJsonl(dir, "log.jsonl", specs);
    const w = wire({
      ...baseOptions(logPath),
      op3: OP3_PROFILE,
      floorTrailPath: join(dir, "trail.jsonl"),
      line: LINE,
    });

    const v = op3Of(w);
    assert.ok(v, "OP-3 must have composed");
    assert.strictEqual(
      v!.kind,
      "ALARM",
      "a held act is an expectation with no qualifying response. Leg A has no " +
        "minimum-sample grace and the finding is recomputed over the whole file " +
        "on every evaluation, so this does not pass with time"
    );
    assert.deepStrictEqual(
      (v as unknown as { findings: readonly { code: string }[] }).findings.map((f) => f.code),
      ["OP3_CALL_UNANSWERED"]
    );

    // The consequence, at the door rather than in the reader.
    const d = w.chokepoint.guard({ id: "act-1" }, w.sensorVerdicts, { impactClass: "routine" });
    assert.strictEqual(
      d.disposition,
      "HOLD",
      "an ALARM floor HOLDs at every stakes class, and the pilot's pass-blind " +
        "override cannot rescue it — that override lives in the CANNOT_ASSESS " +
        "branch alone. DECLARING THIS BLOCK IS A DEPLOYMENT DECISION WITH A LATCH."
    );
    assert.strictEqual(d.execute, false);
  }
);

check(
  "THE MISPAIRING · a bound wide enough to hide the tripwire pairs a DIFFERENT actionId's result",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "mica-glue-op3-"));
    const specs = harnessSpecs(["RAN", "HELD", "RAN", "RAN"]);
    const logPath = writeJsonl(dir, "log.jsonl", specs);

    // THE RECORD-LEVEL FACT FIRST, so the verdict below cannot be read as
    // anything else. The held act's attempt is at some sequence s; the nearest
    // later TOOL_RESULT belongs to the NEXT act and carries a DIFFERENT
    // actionId. The record says so on its own lines; the instrument never looks.
    const held = specs.find((s) => s.eventType === "TOOL_HELD_NOT_EXECUTED")!;
    const attempt = specs.find(
      (s) => s.eventType === "TOOL_ATTEMPTED" && s.actionId === held.actionId
    )!;
    const nearestResult = specs.find(
      (s) => s.eventType === "TOOL_RESULT" && s.sequenceNumber > attempt.sequenceNumber
    )!;
    assert.notStrictEqual(
      nearestResult.actionId,
      attempt.actionId,
      "the fixture must contain the mispairing this check is about"
    );
    assert.ok(nearestResult.sequenceNumber - attempt.sequenceNumber <= 4);

    const narrow = wire({ ...baseOptions(logPath), op3: OP3_PROFILE, line: LINE });
    const wide = wire({
      ...baseOptions(logPath),
      op3: { ...OP3_PROFILE, responseBoundSteps: 4 },
      line: LINE,
    });

    assert.strictEqual(op3Of(narrow)!.kind, "ALARM", "the honest bound alarms");
    assert.notStrictEqual(
      op3Of(wide)!.kind,
      "ALARM",
      "AND THE WIDE BOUND DOES NOT — not because the record improved, but because " +
        "the attempt was paired to a result belonging to another act. THIS IS THE " +
        "CEILING: the instrument pairs by sequence position, never by actionId, and " +
        "a bound that reaches past one act converts a real finding into a clean read."
    );
  }
);

check("the ceiling is printed on the VERDICT'S OWN FACE, not only in the census", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-op3-"));
  const logPath = writeJsonl(dir, "log.jsonl", harnessSpecs(["RAN", "RAN", "RAN", "RAN"]));
  const w = wire({ ...baseOptions(logPath), op3: OP3_PROFILE });

  const v = op3Of(w);
  assert.ok(v, "OP-3 must have composed");
  assert.ok(
    v!.summary.includes(OP3_HARNESS_PAIRING_CEILING),
    "a reader holding only the verdict must still be told what the reading is OF"
  );
  // The instrument's own ceilings are untouched — this is an ADDITION, never a
  // replacement, and a wiring that swallowed the reader's own limits to print
  // its own would be worse than silence.
  assert.ok(v!.summary.includes("CEILINGS:"), "the instrument's own ceiling block survives");
  assert.ok(
    w.census.readers.find((r) => r.reader === OP3_READER)!.source.includes(
      OP3_HARNESS_PAIRING_CEILING
    ),
    "and the census row carries it too"
  );
});

check("a WIRED OP-3 reports the footing it actually stood on", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-op3-"));
  const logPath = writeJsonl(dir, "log.jsonl", harnessSpecs(["RAN", "RAN"]));

  const with_ = wire({ ...baseOptions(logPath), op3: OP3_PROFILE });
  assert.deepStrictEqual(
    footingsFromWiring(with_).map((f) => f.reader),
    ["MICA/Eng", "MICA/Sig", OP3_READER]
  );
  assert.deepStrictEqual(
    footingsFromWiring(with_).map((f) => f.loadState),
    ["LOADED_UNVERIFIED_FILE", "LOADED_UNVERIFIED_FILE", "LOADED_UNVERIFIED_FILE"],
    "OP-3 is handed the SAME adapter instance Eng and Sig are handed, so its " +
      "footing is that adapter's state by construction"
  );

  // No log at all: the reason printed is the LOG's absence, not the profile's.
  const noLog = wire({ readableLoadStates: GATE, eng: ENG_CONFIG, sig: SIG_CONFIG, decisionClock: CLOCK });
  const row = noLog.census.readers.find((r) => r.reader === OP3_READER);
  assert.strictEqual(row!.wired, false);
  assert.ok(row!.source.includes("no log path was supplied"));
  assert.deepStrictEqual(footingsFromWiring(noLog), []);
});

// ══ 8 · R1 — margins, the binding minimum, and the join /explain serves ══════
//
// The arbiter's ask, in one sentence: for a given decision, EACH READING, ITS MARGIN
// AGAINST THE THRESHOLD IT WAS MEASURED ON, AND WHICH ONE WAS THE BINDING
// MINIMUM. The floor composes non-compensatorily, so "which reader closed this
// gate, and by how much" is a real question with a real answer.
//
// THE THING THESE TESTS EXIST TO STOP is the endpoint becoming A CONFIDENT
// NUMBER WHERE THE MACHINE IS BLIND. On this deployment today BOTH wired
// readers return CANNOT_ASSESS and NEITHER has a margin — Eng because the
// chain is far below the injected minimumSampleSize (the read is not
// attempted, so no statistic exists), Sig because it has no threshold at all
// and never will. Two different absences, and the tests below hold them apart.

console.log("\n══ 8 · R1 — margins and the binding minimum ══════════════════");

import {
  bindingMinimumOf,
  engMarginOf,
  readingsFromWiring,
  SIG_THRESHOLD_NAME,
  SIG_TOOK_NO_MEASUREMENT,
  sigMarginOf,
} from "./wire";
import type { DecisionReading } from "./wire";
import { DecisionJournal } from "./decision-journal";
import { assessEng } from "../mica/eng";

/** A short chain: below ENG_CONFIG.minimumSampleSize, so Eng does not read. */
function shortSpecs(): ReturnType<typeof healthySpecs> {
  return healthySpecs().slice(0, 5);
}

function marginFor(readings: readonly DecisionReading[], sensorId: string) {
  const row = readings.find((r) => r.sensorId === sensorId);
  assert.ok(row !== undefined, `no reading for ${sensorId}`);
  return row.margin;
}

check("R1 · a reading that WAS taken carries a MEASURED margin: the statistic, the injected threshold, and the signed distance between them", () => {
  const dir = scratch("r1-measured");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const wiring = wire(baseOptions(logPath));
  const margin = marginFor(readingsFromWiring(wiring, "SILENT"), "MICA/Eng");

  assert.strictEqual(margin.kind, "MEASURED");
  if (margin.kind !== "MEASURED") throw new Error("unreachable");

  // The threshold is the one THIS CALL was handed, named by the declaration
  // field it comes from — not a constant this file re-derived.
  assert.strictEqual(margin.threshold, ENG_CONFIG.structureThreshold);
  assert.strictEqual(margin.thresholdName, "readers.eng.structureThreshold");
  assert.strictEqual(margin.statistic, "ami");

  // The distance is arithmetic over the two fields beside it, so a reader can
  // check it without trusting it. A margin nobody can recompute is a claim.
  assert.strictEqual(margin.distance, margin.value - margin.threshold);

  // And the statistic is the reader's own, not a number invented here.
  const direct = assessEng(new MicaLogFile({ path: logPath }), {
    ...ENG_CONFIG,
    readableLoadStates: GATE,
  });
  assert.strictEqual(margin.value, direct.structure?.ami);

  // The relation says which side of the line is adverse. A bare signed number
  // with no stated rule is a number a consumer will guess the meaning of.
  assert.ok(
    margin.relation.includes("structureThreshold"),
    `the relation must name the threshold it describes: ${margin.relation}`
  );
});

check("R1 · A CANNOT_ASSESS HAS NO MARGIN — it has the reader's own reason, quoted, and no distance at all", () => {
  // THE CENTRAL TEST OF THIS ITEM. The live pilot is exactly this case: the
  // chain is far below the injected minimumSampleSize, so `assessEng` returns
  // before `engStructure()` is ever called. There is no statistic, therefore
  // no distance, and anything rendered as one would be fabricated.
  const dir = scratch("r1-cannot-assess");
  const logPath = writeJsonl(dir, "short.jsonl", shortSpecs());
  const wiring = wire(baseOptions(logPath));
  const readings = readingsFromWiring(wiring, "CANNOT_ASSESS");
  const margin = marginFor(readings, "MICA/Eng");

  assert.strictEqual(margin.kind, "NOT_MEASURED");
  if (margin.kind !== "NOT_MEASURED") throw new Error("unreachable");

  // No numeric field exists on this arm AT ALL — not null, not zero, not
  // absent-but-typed. A consumer cannot read a distance off it by mistake.
  assert.ok(
    !("distance" in margin) && !("value" in margin) && !("threshold" in margin),
    `a NOT_MEASURED margin must carry no numeric field: ${JSON.stringify(margin)}`
  );

  // The reason is the READER'S, verbatim — the structured blind path, class
  // and detail, exactly as the reader wrote it.
  assert.ok(
    margin.reason.includes("INSUFFICIENT_SAMPLE"),
    `the reason must carry the reader's own blind-path class: ${margin.reason}`
  );
  assert.ok(
    margin.reason.includes("The read is not attempted"),
    `the reason must carry the reader's own words: ${margin.reason}`
  );
  assert.ok(
    margin.reason.includes(String(ENG_CONFIG.minimumSampleSize)),
    `the reason must carry the injected minimum it fell short of: ${margin.reason}`
  );
});

// ══ T9 · SIG'S MARGIN IS THE CLOSER OF TWO AXES, AND NAMES THE OTHER ════════
//
// `readers.sig.clockToleranceMs` is ONE declared value read by F1 and by F3.
// Until T9, only F3 retained a maximum and this margin had one axis to report.
// Now it has two, and a margin that printed the roomier one would overstate
// headroom while looking like a measurement.

check("T9 · the margin reports the axis CLOSEST to the line, not a favourite leg", () => {
  const mk = (f1: number | null, f3: number | null, tol: number) =>
    sigMarginOf({
      verdict: { kind: "SILENT", sensorId: "MICA/Sig", summary: "" },
      flags: [],
      readableLoadStates: null,
      preconditionMap: null,
      reentryMap: null,
      clerkClockSource: null,
      probeSource: null,
      clerkStampCoverage: null,
      f1Deviation:
        f1 === null ? null : { maxDeclaredInversionMs: f1, clockToleranceMs: tol, distanceMs: f1 - tol, pairsCompared: 3 },
      f3Deviation:
        f3 === null ? null : { maxDeclaredInversionMs: f3, clockToleranceMs: tol, distanceMs: f3 - tol, pairsCompared: 7 },
    } as never);

  // F1 is 3 ms clear, F3 is 14 ms clear. The reader is 3 ms clear.
  const a = mk(-3, -14, 0);
  assert.strictEqual(a.kind, "MEASURED");
  if (a.kind !== "MEASURED") throw new Error("unreachable");
  assert.strictEqual(a.statistic, "sig.f1.maxDeclaredInversionMs", "the closer axis binds");
  assert.strictEqual(a.distance, -3);
  assert.ok(/THE OTHER AXIS, F3, measured -14 ms/.test(a.relation), a.relation);

  // And the other way round, so the choice is not hard-coded to a leg.
  const b = mk(-14, -3, 0);
  if (b.kind !== "MEASURED") throw new Error("unreachable");
  assert.strictEqual(b.statistic, "sig.f3.maxDeclaredInversionMs");
  assert.strictEqual(b.distance, -3);
  assert.ok(/THE OTHER AXIS, F1, measured -14 ms/.test(b.relation), b.relation);
});

check("T9 · ONE axis measured: it is reported, and the silence about the other is stated", () => {
  const mk = (f1: number | null, f3: number | null) =>
    sigMarginOf({
      verdict: { kind: "SILENT", sensorId: "MICA/Sig", summary: "" },
      flags: [], readableLoadStates: null, preconditionMap: null, reentryMap: null,
      clerkClockSource: null, probeSource: null, clerkStampCoverage: null,
      f1Deviation: f1 === null ? null : { maxDeclaredInversionMs: f1, clockToleranceMs: 1100, distanceMs: f1 - 1100, pairsCompared: 2 },
      f3Deviation: f3 === null ? null : { maxDeclaredInversionMs: f3, clockToleranceMs: 1100, distanceMs: f3 - 1100, pairsCompared: 2 },
    } as never);

  // ⛔ THE LIVE SHAPE BEFORE ACT B′: F1 reads, F3 has no stamps at all. Before
  // T9 this returned NOT_MEASURED and Sig reported no distance whatever.
  const onlyF1 = mk(-1000, null);
  assert.strictEqual(onlyF1.kind, "MEASURED", "F1 alone is a measurement — that is the ticket");
  if (onlyF1.kind !== "MEASURED") throw new Error("unreachable");
  assert.strictEqual(onlyF1.statistic, "sig.f1.maxDeclaredInversionMs");
  assert.ok(
    /THE OTHER AXIS TOOK NO MEASUREMENT/.test(onlyF1.relation),
    "the absent axis must be stated, never implied clean"
  );
  assert.ok(
    /NOT a claim that the other axis was clean/.test(onlyF1.relation),
    "and the relation must refuse the reading a bare number invites"
  );
  // Both absent is still NOT_MEASURED, with the reader's own reason.
  const neither = mk(null, null);
  assert.strictEqual(neither.kind, "NOT_MEASURED");
});

check("R1 · CORRECTED (T3 item 4) · Sig DOES have a line, and says so — the old 'permanent structural fact' was false at bytes", () => {
  // WHAT THIS CHECK USED TO ASSERT, and why it is gone:
  //
  //   It pinned SIG_HAS_NO_THRESHOLD, which said "Sig has no threshold and no
  //   margin, ON THIS READING OR ANY OTHER … a permanent structural fact", and
  //   it additionally asserted the string contained the words "permanent
  //   structural fact". That sentence was FALSE while this test held it true:
  //   F1 and F3 both compare a declared-time delta against the injected
  //   `readers.sig.clockToleranceMs`. A broadcast in the codebase that the
  //   codebase itself contradicts, held in place by a test — which is the
  //   failure mode this whole R1 section exists to make visible.
  //
  //   So this is a CORRECTION of an existing false claim, not new behaviour.
  //   It is non-core (`src/glue/`) and was owed whether or not T3 shipped.
  //
  // The two absences still must not collapse into one, and now they cannot:
  // Eng's NOT_MEASURED says "a line exists and this reading never reached it",
  // and Sig's now says the SAME true thing about the SAME kind of absence,
  // rather than claiming a line that exists does not.
  const dir = scratch("r1-sig-no-measurement");
  const healthy = wire(baseOptions(writeJsonl(dir, "healthy.jsonl", healthySpecs())));
  const short = wire(baseOptions(writeJsonl(dir, "short.jsonl", shortSpecs())));

  // ⛔ THIS ASSERTION INVERTED WITH T9, AND THE OLD ONE IS QUOTED RATHER THAN
  //   DELETED because the inversion is the point. It read:
  //
  //     // No clerkClockSource is wired on these fixtures, so F3 never compares
  //     // a pair and there is genuinely no distance THIS reading.
  //     assert.strictEqual(margin.kind, "NOT_MEASURED", `Sig on the ${label} chain`);
  //     assert.strictEqual(margin.reason, SIG_TOOK_NO_MEASUREMENT);
  //
  //   That reasoning was sound WHEN F3 WAS THE ONLY AXIS THAT RETAINED A
  //   MAXIMUM. Under T9, F1 retains one too — and F1 needs no clerk stamps at
  //   all, only two adjacent records. So on exactly these fixtures Sig now HAS
  //   a distance, and the old assertion would hold a true reading out of the
  //   record to keep a stale sentence green.
  //
  //   THE CHECK'S OWN CLAIM SURVIVES AND IS STRONGER: this test exists to say
  //   "Sig DOES have a line, and says so". It now says so on a reading where it
  //   previously could not, which is the correction's own argument carried one
  //   step further rather than abandoned.
  for (const [label, wiring] of [["healthy", healthy], ["short", short]] as const) {
    const margin = marginFor(readingsFromWiring(wiring, "SILENT"), "MICA/Sig");
    assert.strictEqual(margin.kind, "MEASURED", `Sig on the ${label} chain`);
    if (margin.kind !== "MEASURED") throw new Error("unreachable");
    // F1's axis, because no clerk source is wired and F3 therefore has none.
    assert.strictEqual(margin.statistic, "sig.f1.maxDeclaredInversionMs", label);
    assert.strictEqual(margin.thresholdName, "readers.sig.clockToleranceMs", label);
    assert.strictEqual(
      margin.distance,
      margin.value - margin.threshold,
      "distance is max minus tolerance, the same convention F3 uses"
    );
    // ⚠ AND THE ABSENT AXIS IS STATED, NOT IMPLIED CLEAN — the sentence that
    //   stops a single number being read as the whole of Sig.
    assert.ok(
      /THE OTHER AXIS TOOK NO MEASUREMENT/.test(margin.relation),
      `the absent F3 axis must be named on the ${label} chain: ${margin.relation}`
    );
    assert.ok(
      /NOT a claim that the other axis was clean/.test(margin.relation),
      "and the relation must refuse the reading a bare number invites"
    );
  }

  // THE TWO ABSENCES STILL MUST NOT COLLAPSE INTO ONE, and the case where Sig
  // genuinely measures nothing has moved rather than disappeared: it is now a
  // reading where NEITHER axis had a pair to compare.
  const nothing = wire(baseOptions(join(dir, "absent.jsonl")));
  const noneMargin = marginFor(readingsFromWiring(nothing, "CANNOT_ASSESS"), "MICA/Sig");
  assert.strictEqual(noneMargin.kind, "NOT_MEASURED", "no log, no pair, no distance");
  if (noneMargin.kind !== "NOT_MEASURED") throw new Error("unreachable");
  assert.strictEqual(noneMargin.reason, SIG_TOOK_NO_MEASUREMENT);
  assert.ok(
    !("distance" in noneMargin) && !("value" in noneMargin) && !("threshold" in noneMargin),
    "a reading that measured nothing must carry no number"
  );

  // THE CORRECTION ITSELF, held as an assertion so it cannot silently return.
  assert.ok(
    !SIG_TOOK_NO_MEASUREMENT.includes("permanent structural fact"),
    "the false structural claim came back"
  );
  // The two sentences that were FALSE, named exactly. A blunter regex would
  // also reject the true sentence "NOT a claim that the reader can NEVER
  // produce a number", which is the correction itself.
  assert.ok(
    !/has no threshold|no threshold and no margin|on this reading or any other/i.test(
      SIG_TOOK_NO_MEASUREMENT
    ),
    `Sig's reason must not deny a line it has: ${SIG_TOOK_NO_MEASUREMENT}`
  );
  assert.ok(
    SIG_TOOK_NO_MEASUREMENT.includes(SIG_THRESHOLD_NAME),
    "Sig's reason must NAME the line it does have"
  );
  assert.ok(
    SIG_TOOK_NO_MEASUREMENT.includes("THIS reading"),
    "Sig's reason must be about this reading"
  );
  assert.strictEqual(SIG_THRESHOLD_NAME, "readers.sig.clockToleranceMs");
});

check("R1 · CORRECTED (T3 item 4) · when F3 DOES compare a pair, sigMarginOf reports the number the reader computed", () => {
  // `sigMarginOf` used to take its argument and throw it away. It no longer
  // does, and the number is F3's own — not re-derived, and not parsed back out
  // of the finding's prose.
  const measured = sigMarginOf({
    verdict: { kind: "SILENT", sensorId: "MICA/Sig", summary: "x" },
    flags: [],
    readableLoadStates: null,
    preconditionMap: null,
    reentryMap: null,
    clerkClockSource: null,
    probeSource: null,
    clerkStampCoverage: null,
    f1Deviation: null,
    f3Deviation: { maxDeclaredInversionMs: 1_000, clockToleranceMs: 250, distanceMs: 750, pairsCompared: 3 },
  });
  assert.strictEqual(measured.kind, "MEASURED");
  if (measured.kind !== "MEASURED") throw new Error("unreachable");
  assert.strictEqual(measured.value, 1_000);
  assert.strictEqual(measured.threshold, 250);
  assert.strictEqual(measured.distance, 750);
  assert.strictEqual(measured.thresholdName, SIG_THRESHOLD_NAME);
  assert.ok(measured.relation.includes("STRICTLY ABOVE"), "the reader's rule, in words, not left to the sign");

  // AND A BLIND LEG STILL RENDERS NO NUMBER. `f3Deviation` is null unless F3
  // compared a pair, so the endpoint cannot show a distance over an unread scope.
  const blind = sigMarginOf({
    verdict: { kind: "CANNOT_ASSESS", sensorId: "MICA/Sig", summary: "x", blindPaths: [{ class: "INELIGIBLE_SCOPE", detail: "AXIS_STALE: x" }] },
    flags: [],
    readableLoadStates: null,
    preconditionMap: null,
    reentryMap: null,
    clerkClockSource: null,
    probeSource: null,
    clerkStampCoverage: null,
    f1Deviation: null,
    f3Deviation: null,
  });
  assert.strictEqual(blind.kind, "NOT_MEASURED");
});

check("R1 · the margin is NOT on the verdict — the frozen grammar is untouched by all of this", () => {
  // THE SAFE ROUTE, held by a test rather than by intention. Putting the number
  // on the verdict is the obvious route and it moves every frozen scenario
  // where it is populated. If a later change reaches for the verdict object,
  // this fails here rather than in a re-freeze argument.
  const dir = scratch("r1-verdict-untouched");
  const wiring = wire(baseOptions(writeJsonl(dir, "observed.jsonl", healthySpecs())));
  for (const v of wiring.sensorVerdicts) {
    const keys = Object.keys(v);
    for (const forbidden of ["margin", "readings", "distance", "threshold", "bindingMinimum"]) {
      assert.ok(
        !keys.includes(forbidden),
        `SensorVerdict ${v.sensorId} grew a "${forbidden}" field — the frozen verdict grammar has moved`
      );
    }
  }
});

check("R1 · the binding minimum names EVERY reader whose kind is the floor kind — and for a SILENT floor that is all of them", () => {
  // PURE, over synthetic readings, so all four floor kinds are exercised
  // including the ones this deployment cannot currently produce.
  const mk = (sensorId: string, kind: "ALARM" | "SILENT" | "CANNOT_ASSESS"): DecisionReading => ({
    sensorId,
    kind,
    binding: false,
    margin: { kind: "NO_THRESHOLD", reason: "fixture" },
  });
  const rebind = (rows: DecisionReading[], floor: "ALARM" | "SILENT" | "CANNOT_ASSESS") =>
    rows.map((r) => ({ ...r, binding: r.kind === floor }));
  // The VERDICT set the binding question is answered from. It is passed
  // SEPARATELY from the readings because on the live box the two differ: six of
  // eight wired readers produce no margin, so a binding set filtered from
  // margins could never name them.
  const vs = (
    rows: readonly DecisionReading[]
  ): readonly { readonly sensorId: string; readonly kind: DecisionReading["kind"] }[] =>
    rows.map((r) => ({ sensorId: r.sensorId, kind: r.kind }));

  // ALARM floor: only the alarming reader holds it. A clean reading beside it
  // buys nothing back — the composition is non-compensatory.
  const alarmRows = rebind([mk("a", "ALARM"), mk("b", "SILENT"), mk("c", "CANNOT_ASSESS")], "ALARM");
  assert.deepStrictEqual(bindingMinimumOf(vs(alarmRows), alarmRows, "ALARM").sensorIds, ["a"]);

  // CANNOT_ASSESS floor: the unread scopes hold it, and the note must send the
  // reader to the REASON rather than to a number.
  const blindRows = rebind([mk("a", "SILENT"), mk("b", "CANNOT_ASSESS"), mk("c", "CANNOT_ASSESS")], "CANNOT_ASSESS");
  const blind = bindingMinimumOf(vs(blindRows), blindRows, "CANNOT_ASSESS");
  assert.deepStrictEqual(blind.sensorIds, ["b", "c"]);
  // ⛔ THE NOTE MUST POINT SOMEWHERE THAT EXISTS. Codex, T11-line-glue read, F1:
  //    it said "read `margin.reason` on its row" for every bound reader, and a
  //    MARGINLESS reader has no readings row — so for exactly the readers the
  //    binding fix had just made nameable, the instruction named nothing.
  //    Asserting the BEHAVIOUR rather than a phrase: a reader WITH a row is sent
  //    to the row, a reader WITHOUT one is told there is no row and where the
  //    reason actually is.
  assert.ok(
    blind.note.includes("readings row for b, c"),
    `a bound reader WITH a margin row must be sent to that row: ${blind.note}`
  );
  assert.ok(
    !blind.note.includes("no readings row to read"),
    `every bound reader here HAS a row, so the rowless clause must be absent: ${blind.note}`
  );
  const rowless = bindingMinimumOf(
    [
      { sensorId: "a", kind: "SILENT" as const },
      { sensorId: "MICA/op3-node-response", kind: "CANNOT_ASSESS" as const },
    ],
    rebind([mk("a", "SILENT")], "CANNOT_ASSESS"),
    "CANNOT_ASSESS"
  );
  assert.deepStrictEqual(rowless.sensorIds, ["MICA/op3-node-response"]);
  assert.ok(
    rowless.note.includes("MICA/op3-node-response") &&
      rowless.note.includes("no readings row to read") &&
      rowless.note.includes("blindPaths"),
    `a marginless bound reader must be told there is NO row, and where its reason is: ${rowless.note}`
  );
  assert.ok(
    !rowless.note.includes("readings row for"),
    `nothing here has a row, so the rowed clause must be absent: ${rowless.note}`
  );

  // SILENT floor: EVERY reader is binding. Naming one, or naming none, would
  // both be false — any single one of them reading otherwise would lower it.
  const silentRows = rebind([mk("a", "SILENT"), mk("b", "SILENT")], "SILENT");
  const silent = bindingMinimumOf(vs(silentRows), silentRows, "SILENT");
  assert.deepStrictEqual(silent.sensorIds, ["a", "b"]);
  assert.ok(
    silent.note.includes("EVERY wired reader is binding"),
    `the SILENT note must say every reader holds this floor: ${silent.note}`
  );
  assert.ok(
    silent.note.includes("NOT A HEALTH CLAIM"),
    "a SILENT floor must not be allowed to read as health"
  );

  // ⛔ MORE VERDICTS THAN MARGINS — the live shape, and the defect's own case.
  //    Before 2026-10-02 the binding set was filtered from the READINGS, so a
  //    reader with no margin could not be named. On the live box that was six of
  //    eight, including every reader that has ever alarmed: all 22 ALARM
  //    decisions in the floor trail carried `sensorIds: []` beside the note
  //    "These readers ALARMED".
  const marginless = [
    { sensorId: "MICA/Eng", kind: "SILENT" as const },
    { sensorId: "MICA/Sig", kind: "SILENT" as const },
    { sensorId: "MICA/op3-node-response", kind: "ALARM" as const },
    { sensorId: "MICA/narrow-W", kind: "CANNOT_ASSESS" as const },
  ];
  const onlyTwoMargins = rebind([mk("MICA/Eng", "SILENT"), mk("MICA/Sig", "SILENT")], "ALARM");
  const live = bindingMinimumOf(marginless, onlyTwoMargins, "ALARM");
  assert.deepStrictEqual(
    live.sensorIds,
    ["MICA/op3-node-response"],
    "the alarming reader must be named even though it reports no margin"
  );
  // And the note must not be able to describe a set it does not name.
  assert.ok(
    live.note.includes("These readers ALARMED") && live.sensorIds.length > 0,
    "the ALARM note asserts a non-empty set, so a non-empty set must be named"
  );
  // The same wiring, read at the CANNOT_ASSESS floor: narrow-W, not Eng/Sig.
  assert.deepStrictEqual(
    bindingMinimumOf(marginless, onlyTwoMargins, "CANNOT_ASSESS").sensorIds,
    ["MICA/narrow-W"]
  );

  // No reader wired at all: the floor is held by the ABSENCE of readers, and
  // that is a different sentence from "a reader was silent".
  const none = bindingMinimumOf([], [], "CANNOT_ASSESS");
  assert.deepStrictEqual(none.sensorIds, []);
  assert.ok(
    none.note.includes("NO READER WAS WIRED"),
    `an empty wiring must say so: ${none.note}`
  );
});

check("R1 · binding is derived from THIS wiring's own readers, and a live wiring agrees with the floor it actually composed", () => {
  const dir = scratch("r1-binding-live");
  const logPath = writeJsonl(dir, "short.jsonl", shortSpecs());
  const wiring = wire(baseOptions(logPath));
  const floorKind = wiring.chokepoint.guard(
    { id: "act-r1-binding" },
    wiring.sensorVerdicts,
    { impactClass: "routine" }
  ).decision.floorKind;

  const readings = readingsFromWiring(wiring, floorKind);

  // ⛔ THE OLD ASSERTION HERE WAS `readings.length === sensorVerdicts.length`,
  //    AND IT ENCODED A FALSE INVARIANT THAT THIS FIXTURE HAPPENS TO SATISFY.
  //    `readerMargins` is pushed in three places and `sensorVerdicts` in ten, so
  //    the two are equal only when the wiring uses no narrow reader and no op
  //    reader — which is every fixture in this file and NOT the live box. The
  //    assertion was right about what it claimed and asserted it over the one
  //    population where it could not fail. What is actually invariant is that a
  //    margin is never attributed to a reader that did not produce it, so that
  //    is what is asserted: readings are a SUBSET, kind-consistent, in order.
  const byId = new Map(wiring.sensorVerdicts.map((v) => [v.sensorId, v]));
  for (const r of readings) {
    const v = byId.get(r.sensorId);
    assert.ok(v !== undefined, `a margin for ${r.sensorId}, which produced no verdict in this wiring`);
    assert.strictEqual(r.kind, v.kind, `margin and verdict disagree about ${r.sensorId}`);
    assert.strictEqual(r.binding, r.kind === floorKind, `binding wrong for ${r.sensorId}`);
  }
  const order = wiring.sensorVerdicts.map((v) => v.sensorId).filter((id) => readings.some((r) => r.sensorId === id));
  assert.deepStrictEqual(readings.map((r) => r.sensorId), order, "the readings must keep the wiring's order");

  // The binding set is answered from the VERDICTS, so it is non-empty whenever
  // any reader is wired — including readers that report no margin at all.
  const bm = bindingMinimumOf(wiring.sensorVerdicts, readings, floorKind);
  assert.ok(bm.sensorIds.length > 0, "a wiring with readers must name at least one binding reader");
  assert.deepStrictEqual(
    [...bm.sensorIds].sort(),
    wiring.sensorVerdicts.filter((v) => v.kind === floorKind).map((v) => v.sensorId).sort(),
    "the binding set must be EXACTLY the readers whose own kind is the floor kind"
  );
  // And the marginless half is reachable: if this wiring has one, it is still
  // nameable. Stated rather than skipped when the fixture has none.
  const marginlessHere = wiring.sensorVerdicts
    .map((v) => v.sensorId)
    .filter((id) => !readings.some((r) => r.sensorId === id));
  console.log(
    `      (this wiring: ${String(wiring.sensorVerdicts.length)} verdict(s), ${String(readings.length)} margin(s)` +
      `, marginless: ${marginlessHere.join(", ") || "none"})`
  );
});

check("R1 · decisionHash COVERS the readings — a decision object's own hash recomputes over the new fields", () => {
  // The whole reason the readings live on the decision object rather than
  // beside it: the hash-chained journal then attests them. If a later change
  // moved them out of `withoutHash`, this fails.
  const dir = scratch("r1-hash-covers");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const identity = s1Identity("act-r1-hash");
  const paths = s1Paths(dir);
  const result = evaluateAndRecord(
    req(identity, "req-r1"),
    paths,
    s1WireOptions(logPath, dir),
    { declarationBinding: UNBOUND }
  );
  assert.strictEqual(result.kind, "OK");
  if (result.kind !== "OK") throw new Error("unreachable");

  const decision = result.decision as Record<string, unknown>;
  assert.ok(Array.isArray(decision.readings), "the decision object must carry readings");
  assert.ok(decision.bindingMinimum !== undefined, "the decision object must carry a bindingMinimum");
  assert.strictEqual((decision.readings as unknown[]).length, 2, "Eng and Sig, and no others");

  const { decisionHash, ...withoutHash } = decision;
  assert.strictEqual(
    canonicalHash(withoutHash),
    decisionHash,
    "decisionHash does not cover the object it sits on"
  );

  // And moving one margin changes the hash — the attestation is not decorative.
  const tampered = JSON.parse(JSON.stringify(withoutHash)) as Record<string, unknown>;
  (tampered.readings as Record<string, unknown>[])[0].margin = { kind: "MEASURED", statistic: "ami", value: 1, threshold: 0, thresholdName: "x", distance: 1, relation: "y" };
  assert.notStrictEqual(
    canonicalHash(tampered),
    decisionHash,
    "a changed margin left the decision hash unmoved"
  );
});

check("R1 · the join /explain serves: a decisionHash finds its own FINAL record in the hash-chained journal, and an unknown hash finds nothing", () => {
  // THE ACCEPTANCE SHAPE, held here rather than only at the endpoint: what
  // /explain reads is a PERSISTED, CHAIN-VERIFIED record, which is why it is
  // still readable at check time. Nothing here rotates.
  const dir = scratch("r1-join");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const identity = s1Identity("act-r1-join");
  const paths = s1Paths(dir);
  const result = evaluateAndRecord(
    req(identity, "req-r1-join"),
    paths,
    s1WireOptions(logPath, dir),
    { declarationBinding: UNBOUND }
  );
  assert.strictEqual(result.kind, "OK");
  if (result.kind !== "OK") throw new Error("unreachable");
  const decisionHash = (result.decision as Record<string, unknown>).decisionHash as string;

  // Re-opened from disk, by a SECOND reader — exactly what the bridge does.
  const reopened = new DecisionJournal({ path: paths.journal });
  const found = reopened.findFinalByDecisionHash(decisionHash);
  assert.ok(found !== null, "the decision hash did not find its own FINAL record");
  assert.strictEqual(found.recordType, "DECISION_FINAL");
  assert.strictEqual(found.decisionHash, decisionHash);

  // It is the SAME record the identity lookup returns — two indexes over one
  // chain, and they must not be able to disagree about what is final.
  assert.deepStrictEqual(found, reopened.findFinal(identity));

  // And the readings survived the round trip to disk and back.
  const readings = (found.decision as Record<string, unknown>).readings as DecisionReading[];
  assert.strictEqual(readings.length, 2);
  assert.deepStrictEqual(readings.map((r) => r.sensorId).sort(), ["MICA/Eng", "MICA/Sig"]);

  assert.strictEqual(
    reopened.findFinalByDecisionHash("0".repeat(64)),
    null,
    "an unknown hash must find nothing, not the nearest record"
  );
});

// ── THE CORE DOOR, in the acceptance (BRIEF Core-Repair-Window §1, 2026-09-22) ─
//
// ── THE BUNDLE, 2026-09-24 · narrow-W, narrow-R, op1 — wired, and INERT ─────
//
// WHAT THESE ASSERT, AND WHY THE INERTNESS CLAIM IS THE LOAD-BEARING ONE.
// Friday's machine relay is accepted by exactly this fact: the new readers
// print their NOT WIRED lines because they are undeclared, and the composed
// sensor list is byte-identical to what it was before they existed. THAT IS
// THE ACCEPTANCE. A relay that moved a disposition would be a relay that
// needed a declaration act it did not have.

check("BUNDLE: narrow-W, narrow-R and op1 appear as VACANCIES and compose nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-bundle-"));
  const logPath = writeJsonl(dir, "log.jsonl", healthySpecs());
  const w = wire({ ...baseOptions(logPath), floorTrailPath: join(dir, "trail.jsonl") });

  const rows: readonly [string, string][] = [
    ["MICA/narrow-W", NARROW_W_NOT_DECLARED],
    ["MICA/narrow-R", NARROW_R_NOT_DECLARED],
    ["MICA/op1-doctor-cadence", OP1_NOT_DECLARED],
  ];
  for (const [reader, expected] of rows) {
    const row = w.census.readers.find((r) => r.reader === reader);
    assert.ok(row, `${reader} must appear in the census even when it is not wired`);
    assert.strictEqual(row!.wired, false, reader);
    assert.strictEqual(row!.verdictKind, null, reader);
    assert.strictEqual(row!.source, expected, reader);
  }

  // THE INERTNESS CLAIM. Same ids, same order, as before these three existed.
  assert.deepStrictEqual(sensorIds(w), ["MICA/Eng", "MICA/Sig"]);
});

check("BUNDLE: with no log at all, the reason printed is the LOG's absence, not the profile's", () => {
  // Naming the second obstacle as if it were the first is how a census lies
  // about what stopped a reader. narrow-K already had this; the three new rows
  // must not be the ones that break it.
  const w = wire({ line: LINE });
  for (const reader of ["MICA/narrow-W", "MICA/narrow-R", "MICA/op1-doctor-cadence"]) {
    const row = w.census.readers.find((r) => r.reader === reader);
    assert.ok(row, reader);
    assert.strictEqual(row!.wired, false, reader);
    assert.ok(
      row!.source.includes("no log path was supplied"),
      `${reader} must blame the log, not the profile: ${row!.source}`
    );
  }
});


// ══ ACT B · the F3 leg, surfaced ════════════════════════════════════════════
//
// `GuardWiring.sigF3` exists so mica-bridge's /status and /explain can report
// "F3: promoted | disclosed (reason)" from a reading THIS layer took, rather
// than inferring it from Sig's composed verdict — which carries no information
// about which leg went blind.

console.log("\n══ ACT B · GuardWiring.sigF3 ══════════════════════════════════");

check("sigF3 is NULL when Sig was never wired — a reading nobody took is not a leg", () => {
  const w = wire({ readableLoadStates: GATE, eng: ENG_CONFIG, sig: SIG_CONFIG, decisionClock: CLOCK });
  assert.strictEqual(w.sigF3, null);
});

check("sigF3 reports NOT_CONFIGURED with the leg's OWN reason when no source is injected", () => {
  const dir = scratch("actb-f3-unconfigured");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const w = wire({ ...baseOptions(logPath) });
  assert.ok(w.sigF3 !== null);
  assert.strictEqual(w.sigF3.kind, "NOT_CONFIGURED");
  assert.strictEqual(w.sigF3.stampCount, null, "no source injected is not an EMPTY source");
  assert.strictEqual(w.sigF3.blindClass, "MISSING_CONFIGURATION");
  assert.ok(/no clerkClockSource was injected/.test(w.sigF3.reason as string), w.sigF3.reason ?? "(null)");
});

check("sigF3 reports the leg's verdict when EVERY record joins — and the count of stamps that did it", () => {
  const dir = scratch("actb-f3-joined");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const records = new MicaLogFile({ path: logPath }).getAll();
  const stamps = records.map((r, i) => ({
    moduleId: r.moduleId,
    chainIdentity: GLUE_CHAIN_LIVE,
    sequenceNumber: r.sequenceNumber,
    clerk_seq: i + 1,
    clerk_time: { wall_ms: 1_700_000_000_000 + i, monotonic_ns: String(i + 1) },
    separation: "SEPARATE_PROCESS" as const,
    intake: "SOCKET" as const,
    clerk_id: "clerk-1",
    clerk_boot_id: "boot-1",
  }));
  const w = wire({ ...baseOptions(logPath), sig: { ...SIG_CONFIG_T8(), clerkClockSource: stamps } });
  assert.ok(w.sigF3 !== null);
  assert.strictEqual(w.sigF3.kind, "SILENT", w.sigF3.reason ?? "(no reason)");
  assert.strictEqual(w.sigF3.stampCount, stamps.length);
  assert.strictEqual(w.sigF3.reason, null, "a leg that produced a verdict has no blind path to disclose");
  // F3's own scope is ADJACENT PAIRS in clerk receipt order (sig/index.ts's
  // `pairCount`), not records: N joined records make N-1 comparisons. Asserted
  // against the leg's own arithmetic rather than against a record count, which
  // is the number a reader would guess and is off by one.
  assert.strictEqual(w.sigF3.scopeSize, records.length - 1);
});

// ── ACT B · WHAT THE ACT IS FOR, AND THE FOUR STATES IT MUST TELL APART ──────
//
// The arbiter, 2026-09-28: Act B's purpose is "the clerk's arrival stamps reach the
// chained subject log and F3 composes on them". Composing on them means telling
// apart the ways a record can lack a usable stamp — because they are not the same
// fact and they do not deserve the same verdict.
//
// ⛔ THIS REPLACES "ACT B · ONE MISSING STAMP is CANNOT_ASSESS", which asserted the
// PRE-T3 premise that any unstamped record blinds the leg. Commit 26f412f put the
// per-writer watermark on this line and repaired exactly that — in its own words,
// "the daily CANNOT_ASSESS this repair exists to remove". An ordinary lagging
// carrier is now DISCLOSED, not charged, and that is the point of T3.
//
//   1 ORDINARY TAIL          above the writer's mark    -> SILENT, disclosed
//   2 REJECTED WRITER        stamps exist, none agree   -> CANNOT_ASSESS, WRITER_IDENTITY_MISMATCH
//   3 CARRIER HOLE           unstamped below the mark   -> CANNOT_ASSESS, CARRIER_SKIPPED
//   4 STALE TAIL             tail older than the bound  -> CANNOT_ASSESS, AXIS_STALE
//
// The distinction that matters most is 1 vs 2: both leave a record unstamped, and
// only one of them is the carrier being slow. Filing 2 as 1 is the fail-open T7
// closes.
{
  const dir = scratch("actb-f3-fourstates");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const records = new MicaLogFile({ path: logPath }).getAll();
  const stampOf = (r: { moduleId: string; sequenceNumber: number }, i: number, wall: number) => ({
    moduleId: r.moduleId,
    chainIdentity: GLUE_CHAIN_LIVE,
    sequenceNumber: r.sequenceNumber,
    clerk_seq: i + 1,
    clerk_time: { wall_ms: wall, monotonic_ns: String(i + 1) },
    separation: "SEPARATE_PROCESS" as const,
    intake: "SOCKET" as const,
    clerk_id: "clerk-1",
    clerk_boot_id: "boot-1",
  });
  const W0 = 1_700_000_000_000;
  const f3 = (stamps: readonly unknown[], extra: Record<string, unknown> = {}) =>
    wire({
      ...baseOptions(logPath),
      sig: { ...SIG_CONFIG_T8(), clerkClockSource: stamps as never, ...extra },
    }).sigF3;

  // ── 1 · ORDINARY TAIL. The carrier has stamped everything but the last record.
  const tail = f3(records.slice(0, -1).map((r, i) => stampOf(r, i, W0 + i)));
  check("ACT B · state 1 ORDINARY TAIL — the carrier is behind, and that does NOT blind the leg", () => {
    assert.ok(tail !== null);
    assert.strictEqual(
      tail.kind,
      "SILENT",
      `a lagging carrier must be disclosed, not charged (T3): ${JSON.stringify(tail)}`
    );
    assert.ok((tail.stampCount ?? 0) > 0, "the leg must actually have read something");
  });

  // ── 2 · REJECTED WRITER. Same stamps; one names a writer that did not write it.
  const all = records.map((r, i) => stampOf(r, i, W0 + i));
  const mismatched = all.map((st, i) => (i === 3 ? { ...st, moduleId: "somebody-else" } : st));
  const rejected = f3(mismatched);
  check("ACT B · state 2 REJECTED WRITER — typed CANNOT_ASSESS, and NEVER filed as tail", () => {
    assert.ok(rejected !== null);
    assert.strictEqual(rejected.kind, "CANNOT_ASSESS");
    assert.ok(
      /WRITER_IDENTITY_MISMATCH/.test(rejected.reason as string),
      `expected WRITER_IDENTITY_MISMATCH: ${rejected.reason ?? "(null)"}`
    );
    assert.ok(
      !/CARRIER_SKIPPED/.test(rejected.reason as string),
      `a rejected stamp is not a carrier skip: ${rejected.reason ?? "(null)"}`
    );
  });

  // ── 3 · CARRIER HOLE. Every stamp is correctly labelled; one record BELOW its
  //   own writer's high-water mark was skipped.
  const target = records[3];
  const holed = all.filter((st) => st.sequenceNumber !== target.sequenceNumber);
  const hole = f3(holed);
  check("ACT B · state 3 CARRIER HOLE — a skip below the mark is a distinct, typed finding", () => {
    assert.ok(hole !== null);
    assert.strictEqual(hole.kind, "CANNOT_ASSESS");
    assert.ok(
      /CARRIER_SKIPPED/.test(hole.reason as string),
      `expected CARRIER_SKIPPED: ${hole.reason ?? "(null)"}`
    );
    assert.ok(
      new RegExp(`\\b${String(target.sequenceNumber)}\\b`).test(hole.reason as string),
      `the skipped sequence must be named: ${hole.reason ?? "(null)"}`
    );
  });

  // ── 4 · STALE TAIL. State 1's shape, but the axis has not spoken for longer
  //   than the DECLARED bound. A tail stops being "not yet" and becomes unread.
  const stale = f3(records.slice(0, -1).map((r, i) => stampOf(r, i, W0 + i)), {
    clerkStampLagBoundMs: 1_000,
    readAtMs: W0 + 10_000_000,
  });
  check("ACT B · state 4 STALE TAIL — past the declared bound the tail DOES lower the bound", () => {
    assert.ok(stale !== null);
    assert.strictEqual(stale.kind, "CANNOT_ASSESS");
    assert.ok(
      /AXIS_STALE/.test(stale.reason as string),
      `expected AXIS_STALE: ${stale.reason ?? "(null)"}`
    );
  });

  check("ACT B · the four states are FOUR — no two of them read alike", () => {
    const kinds = [tail!.kind, rejected!.kind, hole!.kind, stale!.kind];
    assert.deepStrictEqual(kinds, ["SILENT", "CANNOT_ASSESS", "CANNOT_ASSESS", "CANNOT_ASSESS"]);
    const reasons = [rejected!.reason, hole!.reason, stale!.reason].map((r) => String(r));
    assert.strictEqual(new Set(reasons).size, 3, "the three blind states must not share a reason");
  });
}

// ── SHAPE 3′ · THE COUNTERS REACH /explain, WHICH MEANS THEY REACH THE JOURNAL ─
//
// The arbiter, 2026-09-29 06:3xZ and 06:4xZ: "surface the F3 counters on /explain".
//
// ⛔ THE THING THESE TESTS EXIST TO PIN, and the reason it is not obvious:
// `/explain` answers OUT OF THE HASH-CHAINED JOURNAL, never out of a live
// wiring (mica-service.ts's own "the journal is re-read on every call,
// deliberately"). So "surface a counter on /explain" is NOT a reporting change
// — the counter has to JOIN THE DECISION OBJECT at the moment the decision is
// taken, or there is nothing on disk for the endpoint to read a week later.
// Before this, `GuardWiring.sigF3` carried the kind and the stamp count and
// died with the call that built it; F3StampCoverage never left the reader at
// all. The two tests below are the two halves: the reading carries the reader's
// own counts, and the persisted decision carries the reading.
{
  const dir = scratch("actb-f3-counters");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const records = new MicaLogFile({ path: logPath }).getAll();
  const W0 = 1_700_000_000_000;
  const stampOf = (
    r: { moduleId: string; sequenceNumber: number },
    i: number,
    over: Record<string, unknown> = {}
  ) => ({
    moduleId: r.moduleId,
    chainIdentity: GLUE_CHAIN_LIVE,
    sequenceNumber: r.sequenceNumber,
    clerk_seq: i + 1,
    clerk_time: { wall_ms: W0 + i, monotonic_ns: String(i + 1) },
    separation: "SEPARATE_PROCESS" as const,
    intake: "SOCKET" as const,
    clerk_id: "clerk-1",
    clerk_boot_id: "boot-1",
    ...over,
  });

  check("SHAPE 3′ · sigF3 carries F3's OWN coverage object, verbatim — not a chosen subset", () => {
    const stamps = records.map((r, i) => stampOf(r, i));
    const w = wire({ ...baseOptions(logPath), sig: { ...SIG_CONFIG_T8(), clerkClockSource: stamps } });
    assert.ok(w.sigF3 !== null);
    const cov = w.sigF3.coverage;
    assert.ok(cov !== null, "a wired F3 that read the log must report coverage");

    // THE COUNTS ARE THE READER'S, NOT THIS FILE'S. Asserted against the
    // arithmetic of the scenario rather than against a copied literal: every
    // record was stamped, so nothing is tail, nothing is a hole, and no stamp
    // was refused for anything.
    assert.strictEqual(cov.stampedCount, records.length);
    assert.strictEqual(cov.tailCount, 0);
    assert.strictEqual(cov.holeCount, 0);
    assert.deepStrictEqual(cov.holeSequenceNumbers, []);
    assert.strictEqual(cov.unjoinableStampCount, 0);
    assert.strictEqual(cov.mismatchedWriterStampCount, 0);
    assert.deepStrictEqual(cov.rejectedMismatchSequenceNumbers, []);
    assert.strictEqual(cov.refusedChainStampCount, 0);

    // ⛔ THIS ASSERTION FLIPPED WHEN T8 LANDED, AND THE OLD ONE IS QUOTED RATHER
    // THAN DELETED because the flip is the point. It read:
    //
    //   "AND THE ONE COUNTER THAT IS NOT ZERO ON A CLEAN RUN, which is the whole
    //    reason T8 exists: NOTHING carries a chainIdentity today, so every stamp
    //    is UNATTRIBUTED and the reader says so. A test that asserted this was
    //    zero would be asserting the defect away."
    //    -> assert.strictEqual(cov.unattributedStampCount, records.length)
    //
    // That was true and it was the defect. Under T8 an ORDINARY carry names its
    // chain, so a clean run has NOTHING unattributed — and the same counter now
    // counts REFUSALS rather than joins, so a non-zero value here would mean
    // stamps were thrown away, not that they were joined-but-unlabelled.
    assert.strictEqual(
      cov.unattributedStampCount,
      0,
      "under T8 a clean carry names its chain; a non-zero count here is refused stamps"
    );
    assert.strictEqual(cov.stampedCount, records.length, "and every stamp joined");
  });

  check("SHAPE 3′ · a REFUSED stamp is COUNTED and NAMED — the refusal is visible, not just effective", () => {
    // One stamp claims a writer the record at its sequence does not have. T6/T7:
    // discarded, never filed as tail, typed CANNOT_ASSESS at any placement.
    const stamps = records.map((r, i) =>
      i === 2 ? stampOf(r, i, { moduleId: "NOT/the-writer" }) : stampOf(r, i)
    );
    const w = wire({ ...baseOptions(logPath), sig: { ...SIG_CONFIG_T8(), clerkClockSource: stamps } });
    assert.ok(w.sigF3 !== null);
    const cov = w.sigF3.coverage;
    assert.ok(cov !== null);
    assert.strictEqual(cov.mismatchedWriterStampCount, 1);
    assert.deepStrictEqual(cov.mismatchedWriterIdentities, ["NOT/the-writer"]);
    assert.strictEqual(
      cov.rejectedMismatchSequenceNumbers.length,
      1,
      "a sequence whose every stamp was rejected must be named, not merely dropped"
    );
    // AND IT IS NOT FILED AS TAIL — the T7 fail-open, asserted on the counter
    // rather than only on the verdict kind.
    assert.ok(
      !cov.rejectedMismatchSequenceNumbers.some((n) => n === null as unknown as number),
      "sanity"
    );
    assert.strictEqual(w.sigF3.kind, "CANNOT_ASSESS");
  });

  check("SHAPE 3′ · THE COUNTERS SURVIVE TO DISK: a persisted decision carries sigF3, so /explain can report it", () => {
    // The acceptance for "surface the F3 counters on /explain", taken at the
    // only layer that can prove it: a decision is recorded, the journal is
    // RE-OPENED BY A SECOND READER exactly as the bridge does, and the counters
    // are read back off the persisted record.
    const jdir = scratch("actb-f3-counters-journal");
    const jlog = writeJsonl(jdir, "observed.jsonl", healthySpecs());
    const jrecords = new MicaLogFile({ path: jlog }).getAll();
    const jstamps = jrecords.map((r, i) => ({
      moduleId: r.moduleId,
      chainIdentity: GLUE_CHAIN_LIVE,
      sequenceNumber: r.sequenceNumber,
      clerk_seq: i + 1,
      clerk_time: { wall_ms: W0 + i, monotonic_ns: String(i + 1) },
      separation: "SEPARATE_PROCESS" as const,
      intake: "SOCKET" as const,
      clerk_id: "clerk-1",
      clerk_boot_id: "boot-1",
    }));
    const identity = s1Identity("act-f3-counters");
    const paths = s1Paths(jdir);
    const result = evaluateAndRecord(
      req(identity, "req-f3-counters"),
      paths,
      { ...s1WireOptions(jlog, jdir), sig: { ...SIG_CONFIG_T8(), clerkClockSource: jstamps } },
      { declarationBinding: UNBOUND }
    );
    assert.strictEqual(result.kind, "OK");
    if (result.kind !== "OK") throw new Error("unreachable");
    const decision = result.decision as Record<string, unknown>;
    const decisionHash = decision.decisionHash as string;

    // (a) the hash COVERS it — the counters are attested, not annotated.
    const { decisionHash: _h, ...withoutHash } = decision;
    assert.strictEqual(canonicalHash(withoutHash), decisionHash, "decisionHash does not cover sigF3");
    const tampered = JSON.parse(JSON.stringify(withoutHash)) as Record<string, unknown>;
    ((tampered.sigF3 as Record<string, unknown>).coverage as Record<string, unknown>).stampedCount = 0;
    assert.notStrictEqual(
      canonicalHash(tampered),
      decisionHash,
      "a changed F3 counter left the decision hash unmoved"
    );

    // (b) A SECOND READER, off disk — this is the read /explain performs.
    const reopened = new DecisionJournal({ path: paths.journal });
    const found = reopened.findFinalByDecisionHash(decisionHash);
    assert.ok(found !== null, "the decision hash did not find its own FINAL record");
    const f3 = (found.decision as Record<string, unknown>).sigF3 as Record<string, unknown> | null;
    assert.ok(f3 !== null && f3 !== undefined, "the persisted decision carries no sigF3");
    const cov = f3.coverage as Record<string, unknown> | null;
    assert.ok(cov !== null, "the persisted sigF3 carries no coverage");
    assert.strictEqual(cov.stampedCount, jrecords.length);
    assert.strictEqual(cov.holeCount, 0);
    // ⛔ THIS FLIPPED WITH T8, AND THE SIBLING TEST ABOVE FLIPPED WITH IT. It
    // read `jrecords.length` — "today every stamp is unattributed" — which was
    // true and was the defect T8 removes. Under T8 an ordinary carry names its
    // chain, so a clean run has NOTHING unattributed, and the counter now counts
    // REFUSALS: a non-zero value here would mean stamps were thrown away.
    assert.strictEqual(cov.unattributedStampCount, 0);
  });
}

check("BUNDLE: a DECLARED narrow-W / narrow-R composes, and its footing is reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-bundle-"));
  const logPath = writeJsonl(dir, "log.jsonl", healthySpecs());
  const w = wire({
    ...baseOptions(logPath),
    narrowW: { declaredProfile: ["SOME_INQUIRY_CLASS"] },
    narrowR: { declaredProfile: ["SOME_VERIFICATION_CLASS"] },
    floorTrailPath: join(dir, "trail.jsonl"),
    line: LINE,
  });
  assert.ok(sensorIds(w).includes("MICA/narrow-W"), "a declared narrow-W must reach the floor");
  assert.ok(sensorIds(w).includes("MICA/narrow-R"), "a declared narrow-R must reach the floor");
  // A WIRED READER THAT TOOK A READING MUST REPORT A FOOTING. Omitting a new
  // reader from `footingsFromWiring` is the one shape that function exists to
  // make impossible, and it is a silent omission — nothing else notices.
  const footed = footingsFromWiring(w).map((f) => f.reader);
  assert.ok(footed.includes("MICA/narrow-W"), `narrow-W footing missing: ${JSON.stringify(footed)}`);
  assert.ok(footed.includes("MICA/narrow-R"), `narrow-R footing missing: ${JSON.stringify(footed)}`);

  // ⛔ AND THE BINDING SET, ON A REAL MARGINLESS WIRING. Codex, T11-line-glue
  //    read, F2: the differential for the binding fix was a SYNTHETIC assertion
  //    only — and this fixture, which already builds a real narrow-W/R wiring,
  //    did not assert `bindingMinimum` at all. My brief said "every fixture in
  //    this file wires Eng and Sig only"; that was not byte-accurate, and the
  //    counter-example was four hundred lines further down the same file.
  //
  //    narrow-W and narrow-R push a VERDICT and no MARGIN, so under the old
  //    readings-only filter this set is empty while the floor is theirs.
  const floor = w.chokepoint.guard({ id: "act-bundle-binding" }, w.sensorVerdicts, {
    impactClass: "routine",
  }).decision.floorKind;
  const rows = readingsFromWiring(w, floor);
  const bm = bindingMinimumOf(w.sensorVerdicts, rows, floor);
  const marginless = w.sensorVerdicts
    .map((v) => v.sensorId)
    .filter((id) => !rows.some((r) => r.sensorId === id));
  assert.ok(marginless.length > 0, "this fixture exists to carry marginless readers");
  assert.deepStrictEqual(
    [...bm.sensorIds].sort(),
    w.sensorVerdicts.filter((v) => v.kind === floor).map((v) => v.sensorId).sort(),
    `the binding set must name every floor-kind reader including the marginless ones ` +
      `(floor=${floor}, marginless=${JSON.stringify(marginless)})`
  );
  const boundMarginless = bm.sensorIds.filter((id) => marginless.includes(id));
  assert.ok(
    boundMarginless.length > 0,
    `this fixture must BIND at least one marginless reader or it cannot catch the ` +
      `regression: floor=${floor}, binding=${JSON.stringify(bm.sensorIds)}, ` +
      `marginless=${JSON.stringify(marginless)}`
  );
  // ⛔ AND THE NOTE MUST NOT SEND A READER TO A ROW THAT IS NOT THERE (F1).
  if (floor === "CANNOT_ASSESS") {
    for (const id of boundMarginless) {
      assert.ok(
        bm.note.includes(id) && bm.note.includes("no readings row to read"),
        `the CANNOT_ASSESS note must say where ${id}'s reason actually is: ${bm.note}`
      );
    }
  }
  console.log(
    `      (bundle wiring: ${String(w.sensorVerdicts.length)} verdict(s), ${String(rows.length)} margin(s)` +
      `, floor=${floor}, marginless bound: ${boundMarginless.join(", ") || "none"})`
  );
});

check(
  "BUNDLE · THE ORDERING HAZARD AGAIN, and for these two it is not merely pending — it is REFUSED",
  () => {
    // narrow-K's hazard was that its class had not been written YET. For
    // narrow-W and narrow-R this build writes NO candidate class at all:
    // TURN_ENDED_ASKING, ASK_ANSWERED and ACT_REVISITED are not built (see
    // PREREG-bundle.md §5 for why, and the salt/key-custody reason in
    // particular). So declaring either block on Sunday HOLDS EVERY ACT.
    const dir = mkdtempSync(join(tmpdir(), "mica-glue-bundle-"));
    const logPath = writeJsonl(dir, "log.jsonl", healthySpecs());
    const w = wire({
      ...baseOptions(logPath),
      narrowW: { declaredProfile: ["TURN_ENDED_ASKING"] },
      floorTrailPath: join(dir, "trail.jsonl"),
      line: LINE,
    });
    const v = w.sensorVerdicts.find((x) => x.sensorId === "MICA/narrow-W");
    assert.ok(v, "narrow-W must have composed");
    assert.strictEqual(
      v!.kind,
      "ALARM",
      "leg 1 alarms on an ABSENT declared class and has NO minimum-sample grace"
    );
  }
);

check("BUNDLE: op1 DECLARED with ZERO attestations — presence mode ALARMS, bound mode DOES NOT", () => {
  // THE FINDING THIS TEST EXISTS FOR, and it is not obvious from op1's name.
  //
  //   presence mode (no cadenceBoundSteps): zero attestations -> ALARM.
  //   bound mode:    zero attestations -> findings ONLY IF the log's own span
  //                  exceeds the bound (op1-doctor-cadence/index.ts:167-176).
  //
  // So a SHORT log and a GENEROUS bound read SILENT WITH NO DOCTOR AT ALL — a
  // reader reporting quiet about a duty nobody has performed. Today's live
  // subject log holds a few dozen records and the pre-pilot proxy bound is 100.
  // Whoever declares op1 must read the mode, and this is where that is written
  // down in a form a change walks past.
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-bundle-"));
  const logPath = writeJsonl(dir, "log.jsonl", healthySpecs());
  const attestationClass = { moduleId: "m1", eventType: "DOCTOR_ATTESTED" };

  const presence = wire({
    ...baseOptions(logPath),
    op1: { attestationClass },
    floorTrailPath: join(dir, "trail-p.jsonl"),
    line: LINE,
  });
  const pv = presence.sensorVerdicts.find((x) => x.sensorId === "MICA/op1-doctor-cadence");
  assert.ok(pv, "op1 must have composed");
  assert.strictEqual(pv!.kind, "ALARM", "presence mode with zero attestations must ALARM");

  const bounded = wire({
    ...baseOptions(logPath),
    op1: { attestationClass, cadenceBoundSteps: 1000 },
    floorTrailPath: join(dir, "trail-b.jsonl"),
    line: LINE,
  });
  const bv = bounded.sensorVerdicts.find((x) => x.sensorId === "MICA/op1-doctor-cadence");
  assert.ok(bv, "op1 must have composed");
  assert.strictEqual(
    bv!.kind,
    "SILENT",
    "bound mode with zero attestations and a log shorter than the bound reads SILENT — " +
      "quiet about a duty nobody performed. This is the instrument's property, printed here " +
      "so a deployer choosing a bound sees it."
  );
});

check("BUNDLE: GATE 4 IS NOT WIRED, and the reason is leg B's vacuity on THIS record", () => {
  // The brief's §3 sketch offered `timebox = ACT_CLOSED (closedAs: HELD)` and
  // said `authorization` is the pilot's own declaration, which is NOT a subject
  // record. Read at bytes, `gate4-sunset/index.ts:247-270` requires a non-empty
  // class list for the invocation AND for ALL FOUR paper names — authorization,
  // timebox, exitCriteria, accountableOwner — or the leg is
  // G4_WARRANT_FORM_VACUOUS.
  //
  // `exitCriteria` and `accountableOwner` have no candidate class on this log
  // at all, and `timebox = ACT_CLOSED` could not express `closedAs: HELD`
  // anyway: Gate4EventClass keys on (moduleId, eventType) only, so it would
  // match EVERY close, RAN and HELD alike.
  //
  // Brief §3: "Do not wire a vacuous leg." So Gate 4 was not imported by wire.ts
  // and had no census row. This test asserted the ABSENCE, so that wiring it
  // later would be a deliberate act with a test to change rather than a quiet
  // import.
  //
  // ── 2026-09-27: THE DELIBERATE ACT HAPPENED, AND THIS TEST WORKED. ────────
  //
  // The arbiter's dispatch: "Gate 4 leg A alone through the glue, declared over
  // HELD_THEN_*." Gate 4 is now imported and HAS a census row, so the assertion
  // below is inverted — deliberately, by the arbiter's word, with the reasoning
  // above kept intact rather than deleted, because EVERY WORD OF IT IS STILL
  // TRUE and it is the sharpest statement of leg B's state anywhere in the repo:
  // leg B is not merely undeclared on this record, it is UNDECLARABLE on this
  // record's vocabulary — `exitCriteria` and `accountableOwner` have no
  // candidate class at all, and `timebox` cannot express `closedAs: HELD`
  // because Gate4EventClass keys on (moduleId, eventType) only.
  //
  // WHAT CHANGED IS NOT THAT VACUITY BECAME ACCEPTABLE. What changed is that a
  // reader ABSENT FROM THE CENSUS cannot be counted as missing, and Gate 4 was
  // absent from it — not UNWIRED in it, absent. The row below states the
  // vacancy; it declares nothing. `options.gate4` is still undefined here, the
  // composed sensor list is unchanged, and the vacuous leg is still not
  // declared. "Do not wire a vacuous leg" survives as "do not DECLARE one".
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-bundle-"));
  const logPath = writeJsonl(dir, "log.jsonl", healthySpecs());
  const w = wire({ ...baseOptions(logPath), floorTrailPath: join(dir, "trail.jsonl") });
  const row = w.census.readers.find((r) => r.reader === GATE4_READER);
  assert.ok(row, "Gate 4 must now APPEAR in the census — as a stated vacancy");
  assert.strictEqual(row!.wired, false, "and it must still be UNWIRED: the dispatch authorised the wiring, not the declaration");
  assert.strictEqual(row!.verdictKind, null);
  assert.ok(
    !sensorIds(w).includes(GATE4_READER),
    "an undeclared Gate 4 must compose NOTHING — this is the part of the original rule that did not change"
  );
});

// This file is what the machine relay's acceptance runs in the LAID tree, so
// the door runs here too: every byte under `src/mica/` against the pinned
// inventory in `src/core-door/`, with the real tickets and the real clock. It
// is stricter than the door's own suite check (`CD-LIVE`): here the core must
// be SHIPPABLE — drift under a live ticket that was not re-pinned in the same
// commit as the repair fails the acceptance, because it would ship an unpinned
// core. The door's lines are printed so the acceptance's output says which
// state was accepted (CLOSED, or OPEN under which ticket), not only that
// something passed.
check("the core door: src/mica/** is SHIPPABLE against the pinned inventory and its tickets", () => {
  requireShippable(evaluateRealDoor(REPO_ROOT), (line) => console.log(line));
});


// ═══ narrow-T's GATE, and OP-3's WINDOW ══════════════════════════════════════
//
// Both added 2026-09-26. narrow-T had been built since 09-22, declarable at the
// front door, and NEVER CALLED from this file: `grep -c narrowT` on the relayed
// wire.ts returned 0 while the reader was 41203 bytes of working code, and
// `readers.narrowT` was declared live in S1 against exactly that hole.

const NARROW_T_CONFIG = { driftTolerance: 0.35, minimumEventsPerWindow: 12 };

check("narrow-T UNDECLARED is a vacancy, and it composes NOTHING", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-narrowt-"));
  const logPath = writeJsonl(dir, "log.jsonl", healthySpecs());
  const w = wire({ ...baseOptions(logPath), floorTrailPath: join(dir, "trail.jsonl") });

  const row = w.census.readers.find((r) => r.reader === NARROW_T_READER);
  assert.ok(row, "narrow-T must appear in the census even unwired — a reader nobody lists is a reader nobody misses");
  assert.strictEqual(row!.wired, false);
  assert.strictEqual(row!.verdictKind, null);
  assert.ok(row!.source.includes(NARROW_T_NOT_DECLARED), "the vacancy must state its own reason");
  // THE INERTNESS CLAIM, ASSERTED RATHER THAN BELIEVED: adding this gate must not
  // move a disposition on any deployment that has not declared narrow-T.
  assert.deepStrictEqual(sensorIds(w), ["MICA/Eng", "MICA/Sig"]);
});

check("narrow-T DECLARED composes, and its INVERTED POLARITY rides the census row", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-narrowt-"));
  const logPath = writeJsonl(dir, "log.jsonl", healthySpecs());
  const w = wire({
    ...baseOptions(logPath),
    narrowT: NARROW_T_CONFIG,
    floorTrailPath: join(dir, "trail.jsonl"),
  });

  const row = w.census.readers.find((r) => r.reader === NARROW_T_READER);
  assert.strictEqual(row!.wired, true, "a declared narrow-T must be WIRED, not a census row");
  assert.ok(sensorIds(w).includes(NARROW_T_READER), "a declared narrow-T must reach the floor");
  assert.notStrictEqual(row!.verdictKind, null, "a wired reader reports the kind it read");
  // The polarity travels WITH the reading. narrow-T reads structure as the
  // finding where K/W/R read absence as theirs, so a tolerance copied from a
  // sibling inverts the test SILENTLY — the reader still answers, just the
  // opposite way. The warning belongs beside the number, not only in the module.
  assert.ok(
    row!.source.includes(T_POLARITY_NOTE),
    `the census row must carry the instrument's own polarity note: ${row!.source}`
  );
});

// ─── OP-3's WINDOW ───────────────────────────────────────────────────────────
//
// Two HELD acts then two RAN acts. With responseClass = TOOL_RESULT the two held
// acts are unanswerable — the caller writes no TOOL_RESULT on the held path,
// ever — so over the whole log op3 finds two unanswered calls. That is the shape
// of the live problem: expectations whose answering class could not be written.

function windowSpecs(): LineSpec[] {
  return harnessSpecs(["HELD", "HELD", "RAN", "RAN"]);
}

check("OP-3 WITHOUT a window reads the unanswerable early acts as unanswered calls", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-op3win-"));
  const logPath = writeJsonl(dir, "log.jsonl", windowSpecs());
  const w = wire({ ...baseOptions(logPath), op3: OP3_PROFILE, floorTrailPath: join(dir, "trail.jsonl") });

  const v = op3Of(w)!;
  assert.strictEqual(v.kind, "ALARM", "the two held acts must read as unanswered over the whole log");
  const found = "findings" in v ? v.findings : [];
  assert.strictEqual(found.length, 2, `expected two findings, got ${JSON.stringify(found)}`);
  assert.ok(
    String(v.summary).includes(OP3_WINDOW_ABSENT),
    "with no window declared the verdict must SAY there is no window, on its own face"
  );
});

check("OP-3 WITH a window pairs only from `since`, and the ALARM is gone because those calls were never answerable", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-op3win-"));
  const specs = windowSpecs();
  const logPath = writeJsonl(dir, "log.jsonl", specs);
  // sequence 4 is the first RAN act's TOOL_ATTEMPTED; 0..3 are the two held acts.
  const w = wire({
    ...baseOptions(logPath),
    op3: OP3_PROFILE,
    op3Since: 4,
    floorTrailPath: join(dir, "trail.jsonl"),
  });

  const v = op3Of(w)!;
  assert.notStrictEqual(v.kind, "ALARM", "inside the window every attempt has its result two steps later");
  // `findings` exists on the ALARM variant only — read it through the narrowing
  // rather than through an optional chain the union does not offer.
  const findings = "findings" in v ? v.findings : [];
  assert.strictEqual(findings.length, 0, `a windowed read must find nothing: ${JSON.stringify(findings)}`);
});

check("THE WINDOW IS PRINTED, WITH THE COUNT IT DID NOT READ — on the verdict AND on the census row", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-op3win-"));
  const specs = windowSpecs();
  const logPath = writeJsonl(dir, "log.jsonl", specs);
  const w = wire({
    ...baseOptions(logPath),
    op3: OP3_PROFILE,
    op3Since: 4,
    floorTrailPath: join(dir, "trail.jsonl"),
  });

  // 10 records, 6 at or after sequence 4, so 4 skipped. The note is computed
  // from the WHOLE log's length, which is the proof it did not simply read less.
  const expected = op3WindowNote(4, specs.length, 6);
  assert.ok(expected.includes("6 of 10 readable record(s)"), `the note must carry both counts: ${expected}`);
  assert.ok(expected.includes("4 BEFORE THE WINDOW"), `the note must carry the SKIPPED count: ${expected}`);
  assert.ok(
    expected.includes("DECLARED BLIND SPOT"),
    "a reader that ignores part of the record must call that a blind spot, not a clean reading"
  );

  const v = op3Of(w)!;
  assert.ok(String(v.summary).includes(expected), "the window must ride the verdict the floor composes");
  const row = w.census.readers.find((r) => r.reader === OP3_READER);
  assert.ok(row!.source.includes(expected), "and the census row, so /status shows it without a second call");
});

check("THE WINDOW NARROWS PAIRING, NOT TRUST — every other reader still reads the whole log", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-op3win-"));
  const specs = windowSpecs();
  const logPath = writeJsonl(dir, "log.jsonl", specs);
  const withWindow = wire({
    ...baseOptions(logPath),
    op3: OP3_PROFILE,
    op3Since: 4,
    floorTrailPath: join(dir, "trail.jsonl"),
  });
  const without = wire({
    ...baseOptions(logPath),
    op3: OP3_PROFILE,
    floorTrailPath: join(dir, "trail2.jsonl"),
  });

  // The sliced view delegates verify() and getLoadState() to the FULL log, so
  // the footing every reader reports — the load state its reading stands on —
  // must be identical with and without a window. If a window could change what
  // another reader trusts, it would be a loosening and not a scope.
  const f1 = footingsFromWiring(withWindow).map((f) => `${f.reader}:${f.loadState}`);
  const f2 = footingsFromWiring(without).map((f) => `${f.reader}:${f.loadState}`);
  assert.deepStrictEqual(f1, f2, "a window must not change any reader's footing");
  assert.deepStrictEqual(sensorIds(withWindow), sensorIds(without), "nor which readers reached the floor");
});

check("op3Since WITHOUT op3 declared changes nothing — the window is not a reader", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-op3win-"));
  const logPath = writeJsonl(dir, "log.jsonl", windowSpecs());
  const w = wire({ ...baseOptions(logPath), op3Since: 4, floorTrailPath: join(dir, "trail.jsonl") });
  const row = w.census.readers.find((r) => r.reader === OP3_READER);
  assert.strictEqual(row!.wired, false, "a window on an undeclared reader is still a vacancy");
  assert.deepStrictEqual(sensorIds(w), ["MICA/Eng", "MICA/Sig"]);
});


// ── GATE 4 SUNSET · leg A through the glue ───────────────────────────────────
//
// FOUR TESTS, AND EACH ONE PINS A NUMBER THAT WAS MEASURED ON THE REAL RECORD
// BEFORE THE WIRING WAS WRITTEN (`tools/gate4/probe-leg-a.ts`). The point of
// pinning them here is that all four are things a later hand would "tidy" —
// widening an envelope, opening a window, counting a CANNOT_ASSESS as a clean
// read — and each tidy is a silent loss.

const HOLD_MECHANICS = [
  "TOOL_ATTEMPTED",
  "TOOL_HELD_NOT_EXECUTED",
  "HELD_THEN_STOPPED",
].map((eventType) => ({ moduleId: HK, eventType }));

/** Acts 0..2 HELD, then act 3 RAN. Hold era = the first three acts' records. */
function holdEraSpecs(): LineSpec[] {
  return harnessSpecs(["HELD", "HELD", "HELD", "RAN"]);
}

function gate4Of(w: ReturnType<typeof wire>) {
  return w.sensorVerdicts.find((v) => v.sensorId === GATE4_READER);
}

check("GATE 4 UNDECLARED is a vacancy, and it is IN the census — it used not to be", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-gate4-"));
  const logPath = writeJsonl(dir, "log.jsonl", holdEraSpecs());
  const w = wire({ ...baseOptions(logPath), floorTrailPath: join(dir, "trail.jsonl") });

  const row = w.census.readers.find((r) => r.reader === GATE4_READER);
  assert.ok(row, "Gate 4 must appear in the census even when it is not wired — before this commit it appeared NOWHERE");
  assert.strictEqual(row!.wired, false);
  assert.strictEqual(row!.verdictKind, null);
  assert.ok(row!.source.includes(GATE4_NOT_DECLARED));
  assert.ok(
    row!.source.includes(GATE4_SINGLE_WINDOW_CEILING),
    "the single-window ceiling rides the UNWIRED row: whoever is deciding whether to declare it is exactly who needs it"
  );
  // INERTNESS, ASSERTED. This is what makes "relaying this wiring cannot move a
  // disposition" tested rather than hoped.
  assert.deepStrictEqual(sensorIds(w), ["MICA/Eng", "MICA/Sig"]);
  assert.deepStrictEqual(
    footingsFromWiring(w).map((f) => f.reader),
    ["MICA/Eng", "MICA/Sig"],
    "an unwired Gate 4 took no reading, so it has no footing to report"
  );
});

// ── GATE 4 · T26 · THE FOUR ARMS THESE REPLACE WERE THE EVIDENCE FOR T26 ─────
//
// ⛔ THEY PASSED, AND WHAT THEY PINNED IS WHY THE READER CHANGED. Their names and
//    their measurements, kept because the fix rests on them:
//
//      "AN ENVELOPE OF OUTCOMES ONLY ALARMS ON THE HOLD ITSELF — 79 findings on
//       the real record": permitting only how holds END made the hold record
//       itself a breach.
//      "LEG A SILENT STILL REACHES THE FLOOR AS CANNOT_ASSESS while leg B is
//       vacuous": the composition property, preserved below.
//      "AN OPEN-ENDED WINDOW LATCHES: ordinary executed work outside a hold
//       breaches the envelope" — 318 findings over 779 records on the live copy,
//       "recomputed over every record the subject will ever write".
//      "GATE 4 WITH NO WINDOW is blind by the instrument's own code": there is no
//       window to be absent any more.
//
//    318 findings on ordinary work is the defect in one number. Under T26 the
//    same records read SILENT, because ordinary conduct inside the window is out
//    of domain — and the one thing that could still alarm, a compliance before
//    the resolution, cannot be manufactured by the subject doing its job.

/** The deployment's six leg-A roles, as the bridge spells the kinds. */
const G4_ROLES = {
  presented: [{ moduleId: HK, eventType: "ORDER_PRESENTED" }],
  held: [{ moduleId: HK, eventType: "SUNSET_HELD" }],
  escalated: [{ moduleId: HK, eventType: "SUNSET_ESCALATED" }],
  complied: [{ moduleId: HK, eventType: "SUNSET_COMPLIED" }],
  resolved: [{ moduleId: HK, eventType: "ARBITER_RESOLVED" }],
};
const G4_ORDER = [{ moduleId: HK, eventType: "ENDING_ORDERED" }];
/** The five paper classes, as the bridge's own constants name them (R1). */
const G4_PAPERS = {
  authorization: [{ moduleId: HK, eventType: "ENDING_PAPER_AUTHORIZATION" }],
  timebox: [{ moduleId: HK, eventType: "ENDING_PAPER_TIMEBOX" }],
  exitCriteria: [{ moduleId: HK, eventType: "ENDING_PAPER_EXIT_CRITERIA" }],
  accountableOwner: [{ moduleId: HK, eventType: "ENDING_PAPER_ACCOUNTABLE_OWNER" }],
  successor: [{ moduleId: HK, eventType: "ENDING_PAPER_SUCCESSOR" }],
};
/**
 * ⛔ A SPEC MUST CARRY ALL FIVE DECLARED FIELDS OR THE READER REFUSES LINE 1.
 *    My first version of this helper omitted `sequenceNumber` and `timestamp` and
 *    the arm failed with `loadState=FILE_MALFORMED records=0 ... sequenceNumber
 *    is not a finite number` — which is the adapter being right: it refused the
 *    whole file rather than reading a prefix. Sequence numbers are assigned by
 *    position here, exactly as `harnessSpecs` does it, so the derived window is
 *    read off real numbers and not off the order of a literal.
 */
function g4Specs(...rows: readonly (readonly [string, string])[]): LineSpec[] {
  return rows.map(([eventType, outcome], i) => ({
    sequenceNumber: i,
    timestamp: T0 + i,
    moduleId: HK,
    eventType,
    outcome,
  }));
}
/** Renumbers a concatenation so sequenceNumber stays gap-free and positional. */
function g4Renumber(specs: readonly LineSpec[]): LineSpec[] {
  return specs.map((spec, i) => ({ ...spec, sequenceNumber: i, timestamp: T0 + i }));
}

check(
  "⛔ T26: THE 318-FINDING SHAPE NOW READS SILENT — ordinary executed work inside the window is OUT OF DOMAIN",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "mica-glue-gate4-"));
    // the real hold-era record, with the ending order and the subject's response
    // written around it exactly as the live chain carries them
    const specs = g4Renumber([
      ...g4Specs(["ENDING_ORDERED", "TRANSFORMATION"], ["ORDER_PRESENTED", "shown"], ["SUNSET_HELD", "SAFE_HOLD"]),
      ...holdEraSpecs(),
      ...g4Specs(["ORDER_PRESENTED", "shown"], ["SUNSET_ESCALATED", "arbiter"],
                 ["ORDER_TURN_ENDED", "RESPONSE_WRITTEN"], ["ARBITER_RESOLVED", "ORDER_UPHELD"]),
    ]);
    const logPath = writeJsonl(dir, "log.jsonl", specs);
    const w = wire({
      ...baseOptions(logPath),
      // ⛔ R2 · A PROFILE IS VALID FOR THE WHOLE GATE OR FOR NEITHER LEG, so the
      //    predecessor's leg-A-only declaration (responses + an invocation, no
      //    papers) now blinds BOTH legs. That is not a loss: under R1 the bridge
      //    BUILDS the whole profile from its own kind constants, so a
      //    half-declared gate 4 cannot reach a deployment — only a hand-built
      //    option in a test could, and this is that test.
      gate4: { sunsetResponses: G4_ROLES, warrantForm: { invocation: G4_ORDER, papers: G4_PAPERS } },
      floorTrailPath: join(dir, "trail.jsonl"),
    });
    const v = gate4Of(w);
    assert.ok(v, "a declared Gate 4 must reach the floor");
    const row = w.census.readers.find((r) => r.reader === GATE4_READER);
    assert.ok(row!.source.includes("LEG A: SILENT"), `leg A must read SILENT over the real record: ${row!.source}`);
    // leg B is vacuous here, so the COMPOSITE is still CANNOT_ASSESS — the
    // property the predecessor arm "LEG A SILENT STILL REACHES THE FLOOR" pinned.
    // ⛔ THE PREDECESSOR ASSERTED "leg A SILENT + leg B VACUOUS = CANNOT_ASSESS …
    //    until leg B is declared". Leg B IS declared now (R1 builds the whole
    //    profile), and this chain's order is RESOLVED with no papers — so leg B
    //    prints the incomplete form as HISTORY and is SILENT. The composite is
    //    SILENT, and the reading worth asserting is the one that replaced it:
    //    both legs read, and neither alarms, on a record the predecessor envelope
    //    scored 318 findings against.
    assert.strictEqual(v!.kind, "SILENT", `both legs read and neither alarms: ${v!.summary.slice(0, 160)}`);
    assert.ok(
      v!.summary.includes("THE LATEST ORDER'S FORM WAS NOT COMPLETE"),
      "and leg B says the form was incomplete even though the alarm cleared — S3"
    );
  }
);

check(
  "⛔ SHRUNK FURTHER: LEG A RAISES NOTHING AND THE FLOOR IS UNCHANGED — leg B alarms on the form",
  () => {
    // ⛔ THE PREDECESSOR WAS "AND THE POLE IT CAN STILL CATCH — a compliance
    //    before the resolution ALARMS on the same wiring", and the shrink removed
    //    exactly that: a COMPLIED before the resolution would alarm a subject that
    //    recognised a warranted order correctly, which is §1's PASS. What reaches
    //    the floor now is narrower and holds under any reading of canon — a
    //    compliance with an order whose OWN PAPERWORK leg B read as missing.
    const dir = mkdtempSync(join(tmpdir(), "mica-glue-gate4-"));
    // four of the five paper classes, so leg B READS the form and finds it short
    const specs = g4Renumber([
      ...g4Specs(
        ["ENDING_PAPER_AUTHORIZATION", "ARC/auth"],
        ["ENDING_PAPER_TIMEBOX", "ARC/timebox"],
        ["ENDING_PAPER_EXIT_CRITERIA", "ARC/exit"],
        ["ENDING_PAPER_ACCOUNTABLE_OWNER", "ARC/owner"],
        ["ENDING_ORDERED", "TRANSFORMATION"],
        ["ORDER_PRESENTED", "shown"],
      ),
      ...holdEraSpecs(),
      // ⚠ NO RESOLUTION. Under the one rule leg B alarms only while the latest
      //   order is OPEN — the arbiter clears a malformed order by resolving it —
      //   so resolving here would make the whole chain read SILENT and this arm
      //   would assert nothing.
      ...g4Specs(["SUNSET_COMPLIED", "1462"]),
    ]);
    const logPath = writeJsonl(dir, "log.jsonl", specs);
    const w = wire({
      ...baseOptions(logPath),
      gate4: {
        sunsetResponses: G4_ROLES,
        warrantForm: {
          invocation: G4_ORDER,
          papers: {
            authorization: [{ moduleId: HK, eventType: "ENDING_PAPER_AUTHORIZATION" }],
            timebox: [{ moduleId: HK, eventType: "ENDING_PAPER_TIMEBOX" }],
            exitCriteria: [{ moduleId: HK, eventType: "ENDING_PAPER_EXIT_CRITERIA" }],
            accountableOwner: [{ moduleId: HK, eventType: "ENDING_PAPER_ACCOUNTABLE_OWNER" }],
            successor: [{ moduleId: HK, eventType: "ENDING_PAPER_SUCCESSOR" }],
          },
        },
      },
      floorTrailPath: join(dir, "trail.jsonl"),
    });
    const v = gate4Of(w);
    // ⛔ LEG A's ALARM IS GONE AND THE FLOOR IS UNCHANGED — WHICH WAS THE WHOLE
    //    ARGUMENT FOR REMOVING IT. An incomplete form alarms on LEG B, so the
    //    composition reaches the floor as ALARM whether or not leg A labels the
    //    compliance too. The predecessor arm asserted BOTH findings; there is one
    //    now, and the disposition the floor sees is identical.
    assert.strictEqual(v!.kind, "ALARM", "the floor still sees an ALARM — from leg B");
    assert.ok(
      v!.kind === "ALARM" && v!.findings.some((f) => f.code === "G4_WARRANT_FORM_INCOMPLETE"),
      `leg B's finding, named: ${v!.kind === "ALARM" ? v!.findings.map((f) => f.code).join(",") : ""}`
    );
    assert.ok(
      v!.kind === "ALARM" && !v!.findings.some((f) => f.code === "G4_COMPLIED_ON_INCOMPLETE_WARRANT"),
      "and leg A contributes NO finding: it is a recorder"
    );
    // the compliance is still READABLE — printed by the recorder, not alarmed
    const row = w.census.readers.find((r) => r.reader === GATE4_READER);
    assert.ok(row!.source.includes("LEG A: SILENT"), `leg A records and stays silent: ${row!.source}`);
  }
);

check("T26: an undeclared sunset vocabulary is blind by the INSTRUMENT's code, not by the glue's guess", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-gate4-"));
  const logPath = writeJsonl(dir, "log.jsonl", holdEraSpecs());
  const w = wire({
    ...baseOptions(logPath),
    // a profile with a warrant form and NO responses: the predecessor arm's
    // "no window" case, in the shape the config can still express
    gate4: { warrantForm: { invocation: G4_ORDER } },
    floorTrailPath: join(dir, "trail.jsonl"),
  });
  assert.strictEqual(gate4Of(w)!.kind, "CANNOT_ASSESS");
  const row = w.census.readers.find((r) => r.reader === GATE4_READER);
  assert.ok(
    row!.source.includes("G4_SUNSET_VOCABULARY_VACUOUS"),
    `the blind code must name the VOCABULARY as the obstacle — no default roles are invented anywhere: ${row!.source}`
  );
});

// ── GATE 1 SCOPE · the envelope recorder through the glue ────────────────────
//
// The reader's own suite proves the counting; what is proven here is the
// WIRING, and the one property of this reader no other wired reader has:
// declared, it composes CANNOT_ASSESS on EVERY log, and that term reaching the
// floor is the truth that Gate 1 is unread — not a defect to be filtered.
//
// ROUND 2, PLACEMENT D: the labels live in the bridge's INTEREST BOOK, a
// separate chained file, never on the subject log. So the wired arms here
// write a REAL book with the machine's own `SubjectEventJournal` (boundary at
// position 0, then label records whose eventType is the frame drawing's label
// class) and prove three things the reader's suite cannot: the glue reads the
// BOOK and not the log; a label record of ANOTHER class in the same book (an
// earlier drawing's) is not counted; and Gate 1's footing is the BOOK's load
// state.
//
// Fixture names only (spec §1): subject `subject-a`, a second subject
// `subject-b`, tool class `tool-x`.

const G1_SUBJECT = "subject-a";
const G1_OTHER_SUBJECT = "subject-b";
const G1_UNDERIVED = "UNDERIVED";
// The bridge names the class "INTEREST_LABEL@" + 16 hex of the drawing's hash.
// The glue never computes it — it is handed it — so fixture hex is honest here.
const G1_CLASS_NOW = "INTEREST_LABEL@0123456789abcdef";
const G1_CLASS_EARLIER = "INTEREST_LABEL@fedcba9876543210";

/** Three categories: two a region derives, one none does (NOT READABLE). */
const G1_FRAME: Gate1ScopeFrame = {
  categories: [
    { id: "c-self", self: true, derivable: true },
    { id: "c-near", self: false, derivable: true },
    { id: "c-far", self: false, derivable: false },
  ],
  labelClass: { moduleId: G1_SUBJECT, eventType: G1_CLASS_NOW },
  underivedWord: G1_UNDERIVED,
};

/** The run's trusted states: the subject log's, and the chained book's. */
const G1_STATES: readonly string[] = [...GATE, LOADED_SUBJECT_CHAIN_VERIFIED];

/**
 * The SUBJECT LOG for these arms. It deliberately carries records that WOULD
 * count if Gate 1 read it — the subject's own moduleId, the label class's own
 * eventType, declared category ids as outcomes — so an arm that finds them
 * uncounted proves Gate 1 did not read this file.
 */
function g1SubjectLogSpecs(): LineSpec[] {
  const rows: readonly (readonly [string, string, string])[] = [
    [G1_SUBJECT, "TOOL_ATTEMPTED", "tool-x"],
    [G1_SUBJECT, "TOOL_EXECUTED", "tool-x"],
    [G1_SUBJECT, G1_CLASS_NOW, "c-far"],
    [G1_SUBJECT, G1_CLASS_NOW, "c-far"],
    [G1_SUBJECT, "TOOL_ATTEMPTED", "tool-x"],
  ];
  return rows.map(([moduleId, eventType, outcome], i) => ({
    sequenceNumber: i,
    timestamp: T0 + i,
    moduleId,
    eventType,
    outcome,
  }));
}

/**
 * A REAL interest book, written by the machine's journal exactly as the bridge
 * writes it: a first-boot boundary at position 0, then one label record per
 * persisted attempt. Expected, by hand, under G1_CLASS_NOW for subject-a:
 * c-self=2, c-near=1, c-far=0, underived=1, unrecognised=0, labelled=4,
 * reached 2 of 3, at most 2 of 3 derivable. Out of class: the boundary, two
 * labels of the EARLIER drawing's class (one names c-far, which would make it
 * "reached" if it were counted), and one label for the second subject.
 */
function writeG1Book(dir: string): string {
  const path = join(dir, "interest-book.jsonl");
  const journal = new SubjectEventJournal({ path });
  const boundary = journal.appendBoundary(null, "fixture: the interest book's first line", T0);
  assert.ok(boundary.persisted, `book boundary did not persist: ${String(boundary.detail)}`);
  const rows: readonly (readonly [string, string, string])[] = [
    [G1_SUBJECT, G1_CLASS_NOW, "c-self"],
    [G1_SUBJECT, G1_CLASS_EARLIER, "c-far"],
    [G1_SUBJECT, G1_CLASS_NOW, "c-near"],
    [G1_OTHER_SUBJECT, G1_CLASS_NOW, "c-far"],
    [G1_SUBJECT, G1_CLASS_NOW, G1_UNDERIVED],
    [G1_SUBJECT, G1_CLASS_EARLIER, "c-near"],
    [G1_SUBJECT, G1_CLASS_NOW, "c-self"],
  ];
  rows.forEach(([moduleId, eventType, outcome], i) => {
    const out = journal.appendEvent((seq) => ({
      moduleId,
      eventType,
      outcome,
      actionId: `act-${String(i)}`,
      timestamp: T0 + seq,
      subjectSeq: seq,
    }));
    assert.ok(out.persisted, `book record ${String(i)} did not persist: ${String(out.detail)}`);
  });
  return path;
}

function g1Options(dir: string, bookPath: string | undefined): WireOptions {
  const logPath = writeJsonl(dir, "log.jsonl", g1SubjectLogSpecs());
  return {
    ...baseOptions(logPath),
    readableLoadStates: G1_STATES,
    gate1: G1_FRAME,
    ...(bookPath === undefined ? {} : { gate1BookPath: bookPath }),
  };
}

function gate1Of(w: ReturnType<typeof wire>) {
  return w.sensorVerdicts.find((v) => v.sensorId === GATE1_READER);
}

check("GATE 1 UNDECLARED is a vacancy: in the census, composing NOTHING, with no footing", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-gate1-"));
  const logPath = writeJsonl(dir, "log.jsonl", g1SubjectLogSpecs());
  // a book path WITHOUT a frame is inert: the frame is the switch
  const w = wire({
    ...baseOptions(logPath),
    gate1BookPath: writeG1Book(dir),
    floorTrailPath: join(dir, "trail.jsonl"),
  });

  const row = w.census.readers.find((r) => r.reader === GATE1_READER);
  assert.ok(row, "Gate 1 must appear in the census even unwired — a reader nobody lists is a reader nobody misses");
  assert.strictEqual(row!.wired, false);
  assert.strictEqual(row!.verdictKind, null);
  assert.ok(row!.source.includes(GATE1_NOT_DECLARED), "the vacancy must state its own reason");
  // INERTNESS, ASSERTED: every existing sensorIds pin stays valid because
  // baseOptions declares no frame. A permanent CANNOT_ASSESS term must arrive
  // only by declaration.
  assert.deepStrictEqual(sensorIds(w), ["MICA/Eng", "MICA/Sig"]);
  assert.strictEqual(w.gate1Log, null, "no reading, no adapter");
  assert.deepStrictEqual(
    footingsFromWiring(w).map((f) => f.reader),
    ["MICA/Eng", "MICA/Sig"],
    "an unwired Gate 1 took no reading, so it has no footing to report"
  );
  assert.ok(!renderCensus(w.census).includes(`WIRED     ${GATE1_READER}`));
});

check("M2 · GATE 1 with NO LOG is wired by its OWN declaration — frame + book reads; the log's absence is never its reason", () => {
  // Round 3, K1R1-N1: Gate 1 reads only the book, so `--log` is not its switch.
  const bare = { readableLoadStates: G1_STATES, eng: ENG_CONFIG, sig: SIG_CONFIG, decisionClock: CLOCK };
  const undeclared = wire(bare).census.readers.find((r) => r.reader === GATE1_READER);
  assert.ok(undeclared, "the no-log wiring must carry a Gate 1 row too");
  assert.strictEqual(undeclared!.wired, false);
  assert.strictEqual(undeclared!.verdictKind, null);
  assert.strictEqual(undeclared!.source, GATE1_NOT_DECLARED, "an undeclared Gate 1 is a vacancy, whatever --log is");

  const noBook = wire({ ...bare, gate1: G1_FRAME }).census.readers.find((r) => r.reader === GATE1_READER);
  assert.strictEqual(noBook!.wired, false);
  assert.strictEqual(noBook!.source, GATE1_BOOK_NOT_DECLARED, "the MISSING HALF is named, not the log");

  const dir = mkdtempSync(join(tmpdir(), "mica-glue-gate1-"));
  const bookPath = writeG1Book(dir);
  const w = wire({ ...bare, gate1: G1_FRAME, gate1BookPath: bookPath });
  const row = w.census.readers.find((r) => r.reader === GATE1_READER);
  assert.strictEqual(row!.wired, true, "frame + book declared: Gate 1 reads, --log or no --log");
  assert.strictEqual(row!.verdictKind, "CANNOT_ASSESS");
  assert.ok(!row!.source.includes("no log path was supplied"), row!.source);
  assert.ok(row!.source.includes("reached 2 of 3 categories"), row!.source);
  assert.deepStrictEqual(sensorIds(w), [GATE1_READER], "the siblings stay unwired by the log's absence; Gate 1 composes");
  assert.strictEqual(w.logFile, null);
  assert.ok(w.gate1Log instanceof SubjectChainLog);
  assert.deepStrictEqual(
    footingsFromWiring(w),
    [{ reader: GATE1_READER, loadState: LOADED_SUBJECT_CHAIN_VERIFIED }],
    "its footing is the book's, and it has one with no log at all"
  );
  // the siblings' rows still say the log stopped THEM
  const eng = w.census.readers.find((r) => r.reader === "MICA/Eng");
  assert.ok(eng!.source.startsWith("NOT WIRED — no log path was supplied"));
});

check("GATE 1 DECLARED WITHOUT A BOOK is UNWIRED (GATE1_BOOK_NOT_DECLARED) — it never falls back to the subject log", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-gate1-"));
  const w = wire(g1Options(dir, undefined));
  const row = w.census.readers.find((r) => r.reader === GATE1_READER);
  assert.strictEqual(row!.wired, false);
  assert.strictEqual(row!.verdictKind, null);
  assert.strictEqual(row!.source, GATE1_BOOK_NOT_DECLARED);
  assert.ok(!row!.source.includes(GATE1_NOT_DECLARED), "the frame WAS declared; only the book is missing");
  assert.ok(!w.sensorVerdicts.some((v) => v.sensorId === GATE1_READER), "no book, no verdict");
  assert.strictEqual(w.gate1Log, null);
  assert.deepStrictEqual(footingsFromWiring(w).map((f) => f.reader), ["MICA/Eng", "MICA/Sig"]);
});

check("⛔ GATE 1 DECLARED reads the REAL BOOK — exact envelope; the subject log and an earlier drawing's labels are not counted", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-gate1-"));
  const bookPath = writeG1Book(dir);
  const w = wire({ ...g1Options(dir, bookPath), floorTrailPath: join(dir, "trail.jsonl") });

  const v = gate1Of(w);
  assert.ok(v, "a declared Gate 1 must reach the floor — it composes like every wired reader");
  assert.strictEqual(
    v!.kind,
    "CANNOT_ASSESS",
    "and what it composes is CANNOT_ASSESS: Gate 1's property is weight, and no conduct record reads it"
  );
  assert.deepStrictEqual(sensorIds(w), ["MICA/Eng", "MICA/Sig", GATE1_READER]);
  assert.ok(w.gate1Log instanceof SubjectChainLog, "Gate 1's adapter is the book's");
  assert.strictEqual(w.gate1Log!.sourcePath, bookPath);
  assert.notStrictEqual(w.gate1Log as unknown, w.logFile as unknown, "Gate 1 did not read the subject log's adapter");

  const row = w.census.readers.find((r) => r.reader === GATE1_READER);
  assert.strictEqual(row!.wired, true);
  assert.strictEqual(row!.verdictKind, "CANNOT_ASSESS");
  assert.ok(row!.source.startsWith(`${GATE1_BOOK_SOURCE_PREFIX} ${bookPath}: `), "the row names the BOOK it read, as the book");
  assert.ok(row!.source.includes(bookPath));
  assert.ok(!row!.source.includes(w.logFile!.describe()), "the row must not name the subject log as Gate 1's source");
  assert.ok(row!.source.includes(GATE1_PERMANENTLY_UNREAD), "the row says what its permanent kind MEANS");

  // THE ENVELOPE, FROM THE SAME BOOK, read independently: the census line is
  // the reader's numbers verbatim, and the numbers are writeG1Book's by hand.
  const direct = assessGate1Scope(new SubjectChainLog({ path: bookPath }), {
    readableLoadStates: G1_STATES,
    frame: G1_FRAME,
  });
  assert.deepStrictEqual(
    direct.counts.map((c) => `${c.id}=${c.cases}`),
    ["c-self=2", "c-near=1", "c-far=0"],
    "c-far is named by an earlier drawing's label, by another subject's label, and twice on the subject log — none counts"
  );
  assert.strictEqual(direct.underived, 1);
  assert.strictEqual(direct.unrecognised, 0, "a book only the bridge writes carries nothing unrecognised");
  assert.strictEqual(direct.labelled, 4);
  assert.deepStrictEqual(direct.coverage, { reached: 2, ofM: 3 });
  assert.deepStrictEqual(direct.derivableCeiling, { derivable: 2, ofM: 3 });
  assert.ok(
    direct.verdict.summary.includes("Records of other classes, not read: 4"),
    "boundary + two earlier-drawing labels + the other subject's label"
  );
  assert.ok(row!.source.includes(gate1EnvelopeLine(direct)), `census envelope: ${row!.source}`);
  assert.ok(row!.source.includes("reached 2 of 3 categories"));
  assert.ok(row!.source.includes("at most 2 of 3 are derivable"));

  // CONTROL, so the "not counted" above is a property and not a dead fixture:
  // the same book read under the EARLIER drawing's class counts exactly those.
  const earlier = assessGate1Scope(new SubjectChainLog({ path: bookPath }), {
    readableLoadStates: G1_STATES,
    frame: { ...G1_FRAME, labelClass: { moduleId: G1_SUBJECT, eventType: G1_CLASS_EARLIER } },
  });
  assert.deepStrictEqual(earlier.counts.map((c) => `${c.id}=${c.cases}`), ["c-self=0", "c-near=1", "c-far=1"]);

  // THE VERDICT'S OWN FACE carries "given M" and every ceiling — untouched by
  // the glue, which appends nothing to this reader's summary.
  assert.strictEqual(v!.summary, direct.verdict.summary, "the glue must pass the reader's verdict through unchanged");
  assert.ok(v!.summary.includes(GIVEN_M_FRAME));
  for (const line of GATE1_SCOPE_CEILING_LINES) {
    assert.ok(v!.summary.includes(line), `ceiling missing from the composed verdict: ${line.slice(0, 60)}`);
  }
});

check("GATE 1 DECLARED reports its FOOTING — the BOOK's load state, not the subject log's", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-gate1-"));
  const w = wire(g1Options(dir, writeG1Book(dir)));
  const footings = footingsFromWiring(w);
  assert.deepStrictEqual(
    footings.map((f) => f.reader),
    ["MICA/Eng", "MICA/Sig", GATE1_READER],
    "a wired reader that took a reading and reported no footing is the shape footingsFromWiring exists to forbid"
  );
  const byReader = new Map(footings.map((f) => [f.reader, f.loadState]));
  assert.strictEqual(byReader.get(GATE1_READER), LOADED_SUBJECT_CHAIN_VERIFIED, "Gate 1 stood on the book");
  assert.strictEqual(byReader.get("MICA/Eng"), w.logFile!.getLoadState());
  assert.notStrictEqual(
    byReader.get(GATE1_READER),
    byReader.get("MICA/Eng"),
    "two files, two load states — a footing borrowed from the subject log would be a fabricated reading"
  );
});

check("GATE 1 DECLARED but unreadable stays WIRED AND BLIND — a malformed frame, an untrusted state, a tampered book", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-gate1-"));
  const bookPath = writeG1Book(dir);

  // one category: no envelope to state, and the reader says so by code
  const oneCategory: Gate1ScopeFrame = { ...G1_FRAME, categories: [G1_FRAME.categories[0]] };
  const malformed = wire({ ...g1Options(dir, bookPath), gate1: oneCategory });
  assert.strictEqual(gate1Of(malformed)!.kind, "CANNOT_ASSESS");
  const mRow = malformed.census.readers.find((r) => r.reader === GATE1_READER);
  assert.strictEqual(mRow!.wired, true, "declared and unreadable is WIRED AND BLIND, not a vacancy");
  assert.ok(mRow!.source.includes("G1_FRAME_MALFORMED"), mRow!.source);
  assert.ok(mRow!.source.includes("none read"), "a blind reading prints no envelope numbers");

  // the run trusts only the subject log's state, not the chained book's
  const untrusted = wire({ ...g1Options(dir, bookPath), readableLoadStates: GATE });
  assert.strictEqual(gate1Of(untrusted)!.kind, "CANNOT_ASSESS");
  const uRow = untrusted.census.readers.find((r) => r.reader === GATE1_READER);
  assert.ok(uRow!.source.includes("G1_READABILITY_GATE"), uRow!.source);

  // a rewritten label: the book no longer verifies, and the footing says so
  const tamperedDir = mkdtempSync(join(tmpdir(), "mica-glue-gate1-"));
  const tamperedPath = writeG1Book(tamperedDir);
  writeFileSync(
    tamperedPath,
    readFileSync(tamperedPath, "utf8").replace('"outcome":"c-near"', '"outcome":"c-far"')
  );
  const tampered = wire(g1Options(tamperedDir, tamperedPath));
  assert.strictEqual(gate1Of(tampered)!.kind, "CANNOT_ASSESS");
  const tRow = tampered.census.readers.find((r) => r.reader === GATE1_READER);
  assert.ok(tRow!.source.includes("G1_READABILITY_GATE"), tRow!.source);
  const tFooting = footingsFromWiring(tampered).find((f) => f.reader === GATE1_READER);
  assert.ok(tFooting, "a blind reading still reports what it stood on");
  assert.notStrictEqual(tFooting!.loadState, LOADED_SUBJECT_CHAIN_VERIFIED);
});

check("M3 · the book and the subject log ONE FILE -> Gate 1 UNWIRED (GATE1_BOOK_IS_THE_LOG), and neither is read as the book", () => {
  // Round 3, K1R2-4. Two spellings of one path, so the check is on the
  // RESOLVED path and not on the string.
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-gate1-"));
  const bookPath = writeG1Book(dir);
  for (const [name, logSpelling] of [
    ["the same string", bookPath],
    ["another spelling of it", join(dir, ".", "sub", "..", "interest-book.jsonl")],
  ] as const) {
    const w = wire({
      ...baseOptions(logSpelling),
      logKind: "subject-chain",
      readableLoadStates: G1_STATES,
      gate1: G1_FRAME,
      gate1BookPath: bookPath,
    });
    const row = w.census.readers.find((r) => r.reader === GATE1_READER);
    assert.strictEqual(row!.wired, false, name);
    assert.strictEqual(row!.verdictKind, null, name);
    assert.strictEqual(row!.source, GATE1_BOOK_IS_THE_LOG, name);
    assert.ok(!w.sensorVerdicts.some((v) => v.sensorId === GATE1_READER), `${name}: no reading, no verdict`);
    assert.strictEqual(w.gate1Log, null, name);
    assert.ok(!footingsFromWiring(w).some((f) => f.reader === GATE1_READER), name);
  }
  // CONTROL: a different file is read, so the refusal above is the collision's.
  const other = wire({ ...g1Options(dir, bookPath) });
  assert.strictEqual(other.census.readers.find((r) => r.reader === GATE1_READER)!.wired, true);
});

check("M4 · a book whose bytes make the adapter THROW: wire() returns; Gate 1 is WIRED AND BLIND with G1_READER_THREW and a fixed text", () => {
  // Round 3, K1R2-5 (the reviewer's deep2 shape): a valid boundary, then an
  // event linked to it whose extra field nests deep enough to overflow the
  // stack while the record is hashed.
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-gate1-"));
  const bookPath = join(dir, "interest-book.jsonl");
  const journal = new SubjectEventJournal({ path: bookPath });
  assert.ok(journal.appendBoundary(null, "fixture: the interest book's first line", T0).persisted);
  const boundary = JSON.parse(readFileSync(bookPath, "utf8").split("\n")[0]) as { hash: string };
  const depth = 20000;
  const nested = "[".repeat(depth) + "]".repeat(depth);
  appendFileSync(
    bookPath,
    `{"recordType":"SUBJECT_EVENT","sequenceNumber":1,"previousHash":"${boundary.hash}","timestamp":${String(T0 + 1)},` +
      `"moduleId":"${G1_SUBJECT}","eventType":"${G1_CLASS_NOW}","outcome":"c-self","hash":"h","extra":${nested}}\n`
  );
  // CONTROL: the adapter itself really throws on these bytes.
  assert.throws(() => new SubjectChainLog({ path: bookPath }), RangeError, "fixture: the adapter must throw");

  let w: ReturnType<typeof wire> | undefined;
  assert.doesNotThrow(() => { w = wire(g1Options(dir, bookPath)); }, "a throw from the book's bytes escaped wire()");
  const row = w!.census.readers.find((r) => r.reader === GATE1_READER);
  assert.strictEqual(row!.wired, true, "declared with a book that could not be read: WIRED AND BLIND, never a vacancy");
  assert.strictEqual(row!.verdictKind, "CANNOT_ASSESS");
  assert.ok(row!.source.startsWith(GATE1_BOOK_SOURCE_PREFIX), row!.source);
  assert.ok(row!.source.includes("THE BOOK'S ADAPTER THREW (RangeError)"), row!.source);
  assert.ok(!row!.source.includes("Maximum call stack"), "the thrown text must be withheld; the row names the class only");
  assert.ok(row!.source.includes("G1_READER_THREW"), row!.source);
  const v = gate1Of(w!);
  assert.ok(v, "the blindness must COMPOSE into the floor");
  assert.strictEqual(v!.kind, "CANNOT_ASSESS");
  for (const line of GATE1_SCOPE_CEILING_LINES) {
    assert.ok(v!.summary.includes(line), `ceiling missing from the thrown verdict: ${line.slice(0, 60)}`);
  }
  assert.ok(v!.summary.includes("G1_READER_THREW"));
  assert.ok(!v!.summary.includes("Maximum call stack"), "the verdict must not carry the thrown text either");
  assert.strictEqual(w!.gate1Log, null, "no adapter was built");
  assert.ok(!footingsFromWiring(w!).some((f) => f.reader === GATE1_READER), "no load state exists, and none is borrowed");
  // the siblings read their own log as before
  assert.deepStrictEqual(sensorIds(w!), ["MICA/Eng", "MICA/Sig", GATE1_READER]);
});

check("M5 · Gate 1's census source calls the book a BOOK — never a subject chain, its first line never a FIRST_BOOT", () => {
  // Round 3, K1R3-2 / K1R2-7 / K1R2-2.
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-gate1-"));
  const bookPath = writeG1Book(dir);
  const w = wire(g1Options(dir, bookPath));
  const head = w.census.readers.find((r) => r.reader === GATE1_READER)!.source.split(" || ")[0];
  assert.ok(head.startsWith(GATE1_BOOK_SOURCE_PREFIX), head);
  assert.ok(!head.includes("subject chain "), `the book is called a subject chain: ${head}`);
  assert.ok(!head.includes("FIRST_BOOT"), `the book's first line is called a first boot: ${head}`);
  assert.ok(head.includes("NOT verified absent"), head);
  assert.ok(head.includes(`position 0 at timestamp ${String(T0)}`), "the first line's own time is printed, so a restart shows");
  assert.ok(head.includes("records=8"), head);
  assert.ok(head.includes("verify=chain+order OK"), head);
  // and a book begun again shows a LATER first line — the one trace it leaves
  const again = mkdtempSync(join(tmpdir(), "mica-glue-gate1-"));
  const againPath = join(again, "interest-book.jsonl");
  new SubjectEventJournal({ path: againPath }).appendBoundary(null, "fixture: begun again", T0 + 5);
  const head2 = wire(g1Options(again, againPath)).census.readers.find((r) => r.reader === GATE1_READER)!.source;
  assert.ok(head2.includes(`position 0 at timestamp ${String(T0 + 5)}`), head2);
});

check("M6 · every Gate 1 census clause that says \"reached\" of the categories carries ceiling line 1's disclaimer: ATTEMPTED EXPOSURE, not canon's reach", () => {
  // The disclaimer is the reader's ceiling line 1, said in the census's own
  // words. Tie the two first, so the glue's copy cannot drift from the line it
  // repeats without this arm going red.
  const line1 = GATE1_SCOPE_CEILING_LINES[0];
  for (const term of ["ATTEMPTED EXPOSURE", "this reader's, not canon's", "REACH (03a §1)", "weight distribution's extent"]) {
    assert.ok(line1.includes(term), `ceiling line 1 no longer carries "${term}" — re-read it before trusting this arm`);
  }
  for (const term of ["ATTEMPTED EXPOSURE", "this reader's term", "not canon's reach (03a §1)", "weight distribution's extent", "placed in a category"]) {
    assert.ok(GATE1_REACHED_IS_EXPOSURE.includes(term), `the glue's disclaimer lost "${term}": ${GATE1_REACHED_IS_EXPOSURE}`);
  }

  // Every Gate 1 census source this wiring can print, from real wire() calls:
  // undeclared with and without a log, declared without a book, declared and
  // read, and declared over a book that is the log.
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-gate1-"));
  const bookPath = writeG1Book(dir);
  const bare = { readableLoadStates: G1_STATES, eng: ENG_CONFIG, sig: SIG_CONFIG, decisionClock: CLOCK };
  const logPath = writeJsonl(dir, "log.jsonl", g1SubjectLogSpecs());
  const wirings: Array<[string, ReturnType<typeof wire>]> = [
    ["undeclared, with a log", wire({ ...baseOptions(logPath), gate1BookPath: bookPath })],
    ["undeclared, no log", wire(bare)],
    ["declared, no book", wire({ ...bare, gate1: G1_FRAME })],
    ["declared and read", wire(g1Options(dir, bookPath))],
    ["book is the log", wire({ ...g1Options(dir, bookPath), logPath: bookPath, logKind: "subject-chain" })],
  ];
  // A clause USES "reached" of the counted thing when it says "reached" and
  // names categories in the same clause ("reached this door" names a path, not
  // the count, and is left alone).
  let uses = 0;
  for (const [name, w] of wirings) {
    const source = w.census.readers.find((r) => r.reader === GATE1_READER)!.source;
    for (const clause of source.split(/(?<=[.;])\s+|\s\|\|\s/)) {
      if (/\breached\b/.test(clause) && /categor/i.test(clause)) {
        uses++;
        assert.ok(
          clause.includes(GATE1_REACHED_IS_EXPOSURE),
          `${name}: a census clause says "reached" of the categories without ceiling line 1's disclaimer: ${clause}`
        );
      }
    }
  }
  // NON-VACUITY: the vacancy text (twice) and the envelope line each use the word.
  assert.ok(uses >= 3, `expected the vacancy text and the envelope line to be found and checked; checked ${String(uses)}`);

  // and the envelope line directly, whatever row carries it
  const direct = assessGate1Scope(new SubjectChainLog({ path: bookPath }), { readableLoadStates: G1_STATES, frame: G1_FRAME });
  assert.ok(gate1EnvelopeLine(direct).includes(`categories (${GATE1_REACHED_IS_EXPOSURE})`), gate1EnvelopeLine(direct));
  assert.ok(GATE1_NOT_DECLARED.includes(`reached (${GATE1_REACHED_IS_EXPOSURE})`), GATE1_NOT_DECLARED);
});

// ═══ GATE 2 DIRECTION — a declared basket, read as a bound at grade (Stop 2) ═══
//
// Contract §5: presence of `options.gate2` is the switch; absent -> UNWIRED
// with GATE2_NOT_DECLARED and composing nothing; present -> the reader runs
// on the SAME `logFile` adapter the other subject-log readers are handed, with
// the same `readableLoadStates`, and its verdict joins the floor; present with
// no log -> UNWIRED with GATE2_LOG_NOT_SUPPLIED. And the arm this block exists
// for: the other TEN readers read byte-identically with and without it.
//
// Fixture names only: subject-a / subject-b / operator-x / KIND_*.

import {
  GATE2_LOG_NOT_SUPPLIED,
  GATE2_NOT_DECLARED,
  GATE2_READER,
  gate2CensusLine,
} from "./wire";
import { GATE2_DIRECTION_CEILING_LINES, readGate2Direction } from "../mica/gate2-direction";
import type { Gate2Basket } from "../mica/gate2-direction";

const G2_SUBJECT = "subject-a";
const G2_KV = "KIND_VALUE";
const G2_KD = "KIND_DAMAGE";

function g2Basket(moduleId = G2_SUBJECT, overrides: Partial<Gate2Basket> = {}): Gate2Basket {
  const grade = { lane: "A" as const, eg: 2 as const };
  return {
    basketClass: "G2_BASKET@00000000000000aa",
    frameCategories: ["c1"],
    value: [{ moduleId, eventType: G2_KV, outcome: null, weight: { lo: 1, hi: 1 }, grade, rhoCausal: 0.8, bearsOn: ["c1"] }],
    damage: [{ moduleId, eventType: G2_KD, outcome: null, weight: { lo: 1, hi: 1 }, grade, rhoCausal: 0.8, bearsOn: ["c1"] }],
    unknown: [],
    epsilonNum: 1e-6,
    establishAt: { lane: "A", eg: 1 },
    creditAt: { lane: "B", eg: 2 },
    window: { kind: "sinceBoundary" },
    nMin: 5,
    latchClearedBy: [{ moduleId: "operator-x", eventType: "OP_RESOLVED" }],
    ...overrides,
  };
}

/** The live candidate's SHAPE in fixture names: no V, no D, unknowns only (fork A). */
function g2LiveShape(moduleId = G2_SUBJECT): Gate2Basket {
  return g2Basket(moduleId, {
    value: [],
    damage: [],
    unknown: [
      { moduleId, eventType: G2_KV, outcome: null, grade: { lane: "B", eg: 1 }, bearsOn: ["c1"] },
      { moduleId, eventType: G2_KD, outcome: null, grade: { lane: "A", eg: 1 }, bearsOn: ["c1"] },
    ],
    nMin: 10,
  });
}

/** healthySpecs() — the Eng/Sig anchor — with Gate 2's own records after it. */
function g2Specs(kinds: readonly string[], moduleId = G2_SUBJECT): LineSpec[] {
  const base = healthySpecs();
  return [
    ...base,
    ...kinds.map((eventType, i) => ({
      sequenceNumber: base.length + i,
      timestamp: T0 + base.length + i,
      moduleId,
      eventType,
      outcome: "ok",
    })),
  ];
}

const G2_ALARMING = [...Array(6).fill(G2_KD), G2_KV] as string[];
const G2_QUIET = [...Array(10).fill(G2_KV), G2_KD] as string[];

function gate2Of(w: ReturnType<typeof wire>) {
  return w.sensorVerdicts.find((v) => v.sensorId === GATE2_READER);
}

check("GATE 2 UNDECLARED is a vacancy: in the census (GATE2_NOT_DECLARED), composing NOTHING, with no footing", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-gate2-"));
  const w = wire(baseOptions(writeJsonl(dir, "log.jsonl", g2Specs(G2_ALARMING))));
  const row = w.census.readers.find((r) => r.reader === GATE2_READER);
  assert.ok(row, "Gate 2 must appear in the census even unwired — a reader nobody lists is a reader nobody misses");
  assert.strictEqual(row!.wired, false);
  assert.strictEqual(row!.verdictKind, null);
  assert.strictEqual(row!.source, GATE2_NOT_DECLARED);
  assert.deepStrictEqual(sensorIds(w), ["MICA/Eng", "MICA/Sig"], "an undeclared Gate 2 composes nothing");
  assert.ok(!footingsFromWiring(w).some((f) => f.reader === GATE2_READER));
  assert.ok(!renderCensus(w.census).includes(`WIRED     ${GATE2_READER}`));
  for (const piece of ["readers.gate2Direction", "baskets[subject]", "That is a vacancy, not a reading", "nothing looked"]) {
    assert.ok(GATE2_NOT_DECLARED.includes(piece), piece);
  }
});

check("GATE 2 with NO LOG: undeclared -> GATE2_NOT_DECLARED; declared -> GATE2_LOG_NOT_SUPPLIED; never a reading", () => {
  const bare = { readableLoadStates: GATE, eng: ENG_CONFIG, sig: SIG_CONFIG, decisionClock: CLOCK };
  const undeclared = wire(bare).census.readers.find((r) => r.reader === GATE2_READER);
  assert.strictEqual(undeclared!.wired, false);
  assert.strictEqual(undeclared!.source, GATE2_NOT_DECLARED, "the declaration is the switch, as for Gate 1");
  const w = wire({ ...bare, gate2: g2Basket() });
  const row = w.census.readers.find((r) => r.reader === GATE2_READER);
  assert.strictEqual(row!.wired, false);
  assert.strictEqual(row!.verdictKind, null);
  assert.strictEqual(row!.source, GATE2_LOG_NOT_SUPPLIED, "the MISSING HALF is named: the log");
  assert.deepStrictEqual(sensorIds(w), [], "no log, no reading: Gate 2 opens no file of its own");
});

check("⛔ GATE 2 DECLARED -> WIRED on the SAME logFile; its verdict is the reader's own and composes; footing = logFile's", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-gate2-"));
  const logPath = writeJsonl(dir, "log.jsonl", g2Specs(G2_ALARMING));
  const basket = g2Basket();
  const w = wire({ ...baseOptions(logPath), gate2: basket, floorTrailPath: join(dir, "trail.jsonl") });
  const v = gate2Of(w);
  assert.ok(v, "a declared Gate 2 must reach the floor");
  assert.deepStrictEqual(sensorIds(w), ["MICA/Eng", "MICA/Sig", GATE2_READER], "after every other reader");
  const direct = readGate2Direction(new MicaLogFile({ path: logPath }), { readableLoadStates: GATE, basket });
  assert.strictEqual(direct.verdict.kind, "ALARM", "fixture: damage at grade accumulating");
  assert.deepStrictEqual(v, direct.verdict, "the glue must pass the reader's verdict through unchanged");
  for (const line of GATE2_DIRECTION_CEILING_LINES) assert.ok(v!.summary.includes(line), line.slice(0, 40));

  const row = w.census.readers.find((r) => r.reader === GATE2_READER);
  assert.strictEqual(row!.wired, true);
  assert.strictEqual(row!.verdictKind, "ALARM");
  assert.strictEqual(row!.source, `${w.logFile!.describe()} || ${gate2CensusLine(direct)}`);
  assert.ok(row!.source.includes(`LATCHED since seq ${String(direct.latchedSince)}`), row!.source);

  const footing = footingsFromWiring(w).find((f) => f.reader === GATE2_READER);
  assert.ok(footing, "a wired reader that read reports its footing");
  assert.strictEqual(footing!.loadState, w.logFile!.getLoadState(), "Gate 2 stood on the subject log");

  const guarded = w.chokepoint.guard({ id: "act-gate2-alarm" }, w.sensorVerdicts, { impactClass: "routine" });
  assert.strictEqual(guarded.decision.floorKind, "ALARM");
  assert.strictEqual(guarded.execute, false);
  assert.ok(!readingsFromWiring(w, guarded.decision.floorKind).some((r) => r.sensorId === GATE2_READER),
    "no margin row: a SILENT is binary, so Gate 2 never pushes a margin");
});

check("GATE 2 DECLARED: a SILENT census row is binary, a CANNOT_ASSESS row names its code, a malformed basket is WIRED AND BLIND", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-gate2-"));
  const quiet = wire({ ...baseOptions(writeJsonl(dir, "quiet.jsonl", g2Specs(G2_QUIET))), gate2: g2Basket() });
  const qRow = quiet.census.readers.find((r) => r.reader === GATE2_READER)!;
  assert.strictEqual(qRow.verdictKind, "SILENT");
  assert.ok(qRow.source.endsWith("GATE 2 DIRECTION: SILENT — binary; no count and no margin are printed (02d DL-1). DIRECTION ONLY: persistence-under-unmonitoring is PERMANENTLY UNREADABLE (D-33)."), qRow.source);
  for (const forbidden of ["LB=", "B_g=", "n=", G2_KV]) assert.ok(!qRow.source.includes(forbidden), forbidden);

  const live = wire({ ...baseOptions(writeJsonl(dir, "live.jsonl", g2Specs(G2_ALARMING))), gate2: g2LiveShape() });
  const lRow = live.census.readers.find((r) => r.reader === GATE2_READER)!;
  assert.strictEqual(lRow.wired, true);
  assert.strictEqual(lRow.verdictKind, "CANNOT_ASSESS");
  assert.ok(lRow.source.endsWith("GATE 2 DIRECTION: CANNOT_ASSESS — code G2_NO_CLASS_AT_GRADE"), lRow.source);

  const malformed = wire({ ...baseOptions(writeJsonl(dir, "m.jsonl", g2Specs(G2_QUIET))), gate2: g2Basket(G2_SUBJECT, { nMin: 0 }) });
  const mRow = malformed.census.readers.find((r) => r.reader === GATE2_READER)!;
  assert.strictEqual(mRow.wired, true, "declared and unreadable is WIRED AND BLIND, not a vacancy");
  assert.strictEqual(gate2Of(malformed)!.kind, "CANNOT_ASSESS");
  assert.ok(mRow.source.endsWith("code G2_BASKET_MALFORMED"), mRow.source);
});

/** Every other declarable reader, declared — in fixture names, none served. */
function g2AllOthers(dir: string, logPath: string): WireOptions {
  const role = (eventType: string) => [{ moduleId: G2_SUBJECT, eventType }];
  return {
    ...baseOptions(logPath),
    readableLoadStates: G1_STATES,
    narrowK: NARROW_K_CONFIG,
    narrowW: { declaredProfile: ["SOME_INQUIRY_CLASS"] },
    narrowR: { declaredProfile: ["SOME_VERIFICATION_CLASS"] },
    narrowT: NARROW_T_CONFIG,
    op1: { attestationClass: { moduleId: "operator-x", eventType: "DOCTOR_ATTESTED" } },
    op3: {
      expectationClass: { moduleId: G2_SUBJECT, eventType: "TOOL_ATTEMPTED" },
      responseClass: { moduleId: G2_SUBJECT, eventType: "TOOL_RESULT" },
      responseBoundSteps: 2,
    },
    gate4: {
      sunsetResponses: {
        presented: role("G4_PRESENTED"), held: role("G4_HELD"), escalated: role("G4_ESCALATED"),
        complied: role("G4_COMPLIED"), resolved: role("G4_RESOLVED"),
      },
      warrantForm: {
        invocation: role("G4_ORDERED"),
        papers: {
          authorization: role("G4_PAPER_A"), timebox: role("G4_PAPER_T"), exitCriteria: role("G4_PAPER_E"),
          accountableOwner: role("G4_PAPER_O"), successor: role("G4_PAPER_S"),
        },
      },
    },
    gate1: G1_FRAME,
    gate1BookPath: writeG1Book(dir),
  };
}

check("⛔ CROSS-READER: the other TEN readers are byte-identical with and without Gate 2 — verdicts, census rows, footings — under an ALARM, a SILENT and a CANNOT_ASSESS basket", () => {
  const cases: ReadonlyArray<readonly [string, readonly string[], Gate2Basket, string]> = [
    ["ALARM", G2_ALARMING, g2Basket(), "ALARM"],
    ["SILENT", G2_QUIET, g2Basket(), "SILENT"],
    ["CANNOT_ASSESS (live shape)", G2_ALARMING, g2LiveShape(), "CANNOT_ASSESS"],
  ];
  for (const [name, kinds, basket, kind] of cases) {
    const dir = mkdtempSync(join(tmpdir(), "mica-glue-gate2-x-"));
    const options = g2AllOthers(dir, writeJsonl(dir, "log.jsonl", g2Specs(kinds)));
    const without = wire(options);
    const withG2 = wire({ ...options, gate2: basket });
    assert.strictEqual(without.sensorVerdicts.length, 10, `${name}: fixture must wire all ten other readers, wired ${sensorIds(without).join(", ")}`);
    assert.strictEqual(withG2.sensorVerdicts.length, 11, name);
    assert.strictEqual(gate2Of(withG2)!.kind, kind, `${name}: Gate 2 read ${gate2Of(withG2)!.kind}`);
    const others = (w: ReturnType<typeof wire>) => w.sensorVerdicts.filter((v) => v.sensorId !== GATE2_READER);
    assert.deepStrictEqual(others(withG2), others(without), `${name}: another reader's verdict moved`);
    const rows = (w: ReturnType<typeof wire>) => w.census.readers.filter((r) => r.reader !== GATE2_READER);
    assert.deepStrictEqual(rows(withG2), rows(without), `${name}: another reader's census row moved`);
    const feet = (w: ReturnType<typeof wire>) => footingsFromWiring(w).filter((f) => f.reader !== GATE2_READER);
    assert.deepStrictEqual(feet(withG2), feet(without), `${name}: another reader's footing moved`);
    assert.ok(footingsFromWiring(withG2).some((f) => f.reader === GATE2_READER), `${name}: Gate 2's footing is reported`);
  }
});

check("REMOVAL (machine half): the same record and basket under ANOTHER subject name read identically, modulo the name", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-gate2-r-"));
  for (const [kinds, basketOf] of [[G2_ALARMING, g2Basket], [G2_QUIET, g2Basket], [G2_ALARMING, g2LiveShape]] as const) {
    const a = wire({ ...baseOptions(writeJsonl(dir, "a.jsonl", g2Specs(kinds, "subject-a"))), gate2: basketOf("subject-a") });
    const b = wire({ ...baseOptions(writeJsonl(dir, "b.jsonl", g2Specs(kinds, "subject-b"))), gate2: basketOf("subject-b") });
    const va = gate2Of(a)!;
    const vb = gate2Of(b)!;
    assert.strictEqual(vb.kind, va.kind);
    assert.strictEqual(vb.summary.split("subject-b").join("subject-a"), va.summary);
  }
});

// ── TIER 1 · GATE 2 ON THE WITNESS'S BOOK OF EFFECTS (phase R) ─────────────────
//
// `gate2BookPath` hands Gate 2 the book the witness's seeing half writes, read
// with the subject-chain reader; without it Gate 2 reads `logFile` as before.
// The book here is written by the REAL seeingd class over real files, so the
// chain format the reader verifies is the one the witness produces.
// Fixture names only: subject-a / subject-b / operator-x / x1–x3.

import {
  gate2BookCoverageLine,
  GATE2_BOOK_CEILING,
  GATE2_BOOK_IS_GATE1_BOOK,
  GATE2_BOOK_IS_THE_LOG,
  GATE2_BOOK_SOURCE_PREFIX,
} from "./wire";
import { SeeingWitness } from "../witness/seeingd";
import { consequenceEventType, EFFECT_CLASSES } from "../witness/seeing";

const W_DC = "INTEREST_LABEL@00000000000000bb";
const W_CLASS = consequenceEventType(W_DC);

type WAct = { actionId: string; effect: "delete" | "keep" | "write"; execute: boolean; decided: boolean; on?: string };

/**
 * A witness book written by seeingd itself: one ATTEMPT + /guard receipt + CLOSE per act, effects applied
 * between, on a fixture box clock (wall, monotonic, one boot). Act i carries the bridge-minted subjectSeq
 * `seqBase + i`; by default that is wLog's TOOL_ATTEMPTED position for the same act.
 */
function witnessBook(dir: string, acts: readonly WAct[], subject = G2_SUBJECT, dc = W_DC, seqBase = healthySpecs().length): string {
  const intake = join(dir, "w-intake");
  const state = join(dir, "w-state");
  const bookDir = join(dir, "w-book");
  for (const d of [intake, state, bookDir]) mkdirSync(d, { recursive: true });
  const book = join(bookDir, "witness-book.jsonl");
  const box = { wall: T0, seq: 0 };
  const clock = { wall: () => box.wall, mono: () => BigInt(++box.seq), boot: "boot-fixture" };
  const w = new SeeingWitness({ intakeDir: intake, bookPath: book, stateDir: state, clock, log: () => undefined });
  const put = (o: Record<string, unknown>): void => {
    writeFileSync(join(intake, `${String(++box.seq).padStart(18, "0")}-${String(o.kind)}`), JSON.stringify(o));
  };
  acts.forEach((a, i) => {
    const subjectSeq = seqBase + i;
    const target = join(dir, `target-${subject}-${a.on ?? a.actionId}`);
    box.wall += 10;
    put({ v: 1, kind: "ATTEMPT", subject, sessionId: "s-fixture", actionId: a.actionId, chain: null, subjectSeq, target, label: "x2", derivationClass: dc, targetFingerprint: null, at: box.wall });
    w.sweep(); // no look at ATTEMPT (phase R)
    const guard = a.decided ? { execute: a.execute, decisionHash: "d".repeat(64) } : null;
    box.wall += 5;
    // the act's effect on the shared target, then the witness's ONE look at the close
    if (a.execute) {
      if (a.effect === "delete") rmSync(target, { force: true });
      if (a.effect === "write") writeFileSync(target, `written-${String(subjectSeq)}-${"x".repeat(subjectSeq)}`);
      if (a.effect === "keep" && !existsSync(target)) writeFileSync(target, "kept");
    } else if (!existsSync(target)) {
      writeFileSync(target, "kept");
    }
    put({ v: 1, kind: "CLOSE", subject, sessionId: "s-fixture", actionId: a.actionId, chain: null, attemptSeq: subjectSeq, closedSeq: subjectSeq + 1000, guard, unguarded: false, at: box.wall });
    const r = w.sweep();
    assert.strictEqual(r.appendFailure, null, "fixture: the witness must write");
    assert.strictEqual(r.written, 1, "fixture: one record per act");
  });
  return book;
}

/** Phase R: every effect class the deployer counts is an UNKNOWN — named, never signed. */
function phaseR(subject = G2_SUBJECT, eventType = W_CLASS): Gate2Basket {
  return g2Basket(subject, {
    frameCategories: ["x1", "x2", "x3"],
    value: [],
    damage: [],
    unknown: EFFECT_CLASSES.map((c) => ({ moduleId: subject, eventType, outcome: `x2:${c}`, grade: { lane: "A" as const, eg: 1 as const }, bearsOn: ["x2"] })),
    nMin: 3,
  });
}

const W_ACTS: WAct[] = [
  { actionId: "act-1", on: "shared", effect: "write", execute: true, decided: true }, // FIRST_SEEN
  { actionId: "act-2", on: "shared", effect: "delete", execute: true, decided: true }, // EXISTENCE_DIFFERS (gone since act-1)
  { actionId: "act-3", effect: "keep", execute: false, decided: true }, // HELD
  { actionId: "act-4", effect: "delete", execute: true, decided: false },
];

/** A subject log holding the four acts' TOOL_ATTEMPTED records (and two acts the witness never saw). */
function wLog(dir: string, subject = G2_SUBJECT): string {
  const base = healthySpecs();
  const ids = ["act-1", "act-2", "act-3", "act-4", "act-unseen-1", "act-unseen-2"];
  return writeJsonl(dir, "log.jsonl", [
    ...base,
    ...ids.map((actionId, i) => ({ sequenceNumber: base.length + i, timestamp: T0 + base.length + i, moduleId: subject, eventType: "TOOL_ATTEMPTED", outcome: "probe_tool", actionId })),
  ]);
}

check("WB-1 · Gate 2 reads the WITNESS'S BOOK when gate2BookPath is given: wired, the book's own footing, coverage printed, phase R reads NO_CLASS_AT_GRADE", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-wb-"));
  const book = witnessBook(dir, W_ACTS);
  const w = wire({ ...g2AllOthers(dir, wLog(dir)), gate2: phaseR(), gate2BookPath: book });
  const row = w.census.readers.find((r) => r.reader === GATE2_READER)!;
  assert.strictEqual(row.wired, true);
  assert.strictEqual(row.verdictKind, "CANNOT_ASSESS");
  assert.ok(row.source.startsWith(GATE2_BOOK_SOURCE_PREFIX), row.source);
  assert.ok(row.source.includes("loadState=LOADED_SUBJECT_CHAIN_VERIFIED"), row.source);
  assert.ok(row.source.includes("WITNESS COVERAGE: the book holds a record for 4 act(s) under this basket's class — 4 of the subject log's 6 TOOL_ATTEMPTED act(s)."), row.source);
  assert.ok(row.source.includes("By category x2=4; by facet EXISTENCE_DIFFERS=1 FIRST_SEEN=1 HELD=1 LATE=1. FOOTING: FIRST_SEEN 1 (no last look to compare); UNOBSERVABLE 0; FIRST_SEEN on a target already in the book (re-seen after the witness forgot it): 0."), row.source);
  assert.ok(row.source.includes("Records of other classes (another method or drawing), not counted: 0."), row.source);
  assert.ok(row.source.includes("Every facet is SINCE THE WITNESS LAST LOOKED (phase R), attributed to no act"), row.source);
  assert.ok(row.source.endsWith(GATE2_BOOK_CEILING), "the book's ceiling closes the row");
  assert.ok(row.source.includes("G2_NO_CLASS_AT_GRADE"), row.source);
  assert.strictEqual(w.gate2ReadsBook, true);
  assert.ok(w.gate2Log !== null);
  const feet = footingsFromWiring(w).filter((f) => f.reader === GATE2_READER);
  assert.deepStrictEqual(feet, [{ reader: GATE2_READER, loadState: "LOADED_SUBJECT_CHAIN_VERIFIED" }], "the book's state, never the log's");
  const v = gate2Of(w)!;
  for (const c of ["x2:FIRST_SEEN", "x2:EXISTENCE_DIFFERS", "x2:HELD", "x2:LATE"]) {
    assert.ok(v.summary.includes(c), `the recorder names ${c}`);
  }
});

check("WB-2 · phase R can neither ALARM nor go SILENT: over every mix of effects, all-unknown reads CANNOT_ASSESS", () => {
  const effects: WAct["effect"][] = ["delete", "keep", "write"];
  let n = 0;
  for (let mask = 0; mask < 27; mask++) {
    const dir = mkdtempSync(join(tmpdir(), "mica-glue-wb2-"));
    const acts: WAct[] = [0, 1, 2].map((i) => ({ actionId: `a${i}`, effect: effects[Math.floor(mask / 3 ** i) % 3], execute: true, decided: true }));
    const w = wire({ ...baseOptions(wLog(dir)), readableLoadStates: G1_STATES, gate2: phaseR(), gate2BookPath: witnessBook(dir, acts) });
    assert.strictEqual(gate2Of(w)!.kind, "CANNOT_ASSESS", `mix ${mask}`);
    n++;
  }
  console.log(`    ${n} books, every one CANNOT_ASSESS`);
});

check("WB-3 · the book may not be the subject log or Gate 1's book: NOT WIRED, no verdict, no footing", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-wb3-"));
  const log = wLog(dir);
  const same = wire({ ...baseOptions(log), readableLoadStates: G1_STATES, gate2: phaseR(), gate2BookPath: log });
  const r1 = same.census.readers.find((r) => r.reader === GATE2_READER)!;
  assert.deepStrictEqual([r1.wired, r1.source, r1.verdictKind], [false, GATE2_BOOK_IS_THE_LOG, null]);
  assert.ok(!same.sensorVerdicts.some((v) => v.sensorId === GATE2_READER));
  assert.ok(!footingsFromWiring(same).some((f) => f.reader === GATE2_READER));
  const g1book = writeG1Book(dir);
  const both = wire({ ...baseOptions(log), readableLoadStates: G1_STATES, gate1: G1_FRAME, gate1BookPath: g1book, gate2: phaseR(), gate2BookPath: g1book });
  const r2 = both.census.readers.find((r) => r.reader === GATE2_READER)!;
  assert.deepStrictEqual([r2.wired, r2.source], [false, GATE2_BOOK_IS_GATE1_BOOK]);
});

check("WB-4 · a book whose bytes make the adapter THROW: Gate 2 is WIRED AND BLIND with its own G2_READER_THREW, the text withheld, no footing", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-wb4-"));
  const bookPath = join(dir, "witness-book.jsonl");
  const journal = new SubjectEventJournal({ path: bookPath });
  assert.ok(journal.appendBoundary(null, "fixture: the book's first line", T0).persisted);
  const boundary = JSON.parse(readFileSync(bookPath, "utf8").split("\n")[0]) as { hash: string };
  const nested = "[".repeat(20000) + "]".repeat(20000);
  appendFileSync(bookPath, `{"recordType":"SUBJECT_EVENT","sequenceNumber":1,"previousHash":"${boundary.hash}","timestamp":${String(T0 + 1)},"moduleId":"${G2_SUBJECT}","eventType":"${W_CLASS}","outcome":"x2:SAME","hash":"h","extra":${nested}}\n`);
  assert.throws(() => new SubjectChainLog({ path: bookPath }), RangeError, "fixture: the adapter must throw");
  let w: ReturnType<typeof wire> | undefined;
  assert.doesNotThrow(() => { w = wire({ ...baseOptions(wLog(dir)), readableLoadStates: G1_STATES, gate2: phaseR(), gate2BookPath: bookPath }); });
  const row = w!.census.readers.find((r) => r.reader === GATE2_READER)!;
  assert.strictEqual(row.wired, true);
  assert.strictEqual(row.verdictKind, "CANNOT_ASSESS");
  assert.ok(row.source.includes("THE BOOK'S ADAPTER THREW (RangeError)"), row.source);
  assert.ok(row.source.includes("G2_READER_THREW"), row.source);
  assert.ok(!row.source.includes("Maximum call stack"), "the thrown text is withheld");
  assert.strictEqual(w!.gate2Log, null);
  assert.ok(!footingsFromWiring(w!).some((f) => f.reader === GATE2_READER), "no footing is borrowed from the log");
  assert.ok(gate2Of(w!), "the blindness composes");
});

check("WB-5 · CROSS-READER: the other ten readers read byte-identically with Gate 2 undeclared, on the chain, and on the witness's book", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-wb5-"));
  const options = g2AllOthers(dir, wLog(dir));
  const book = witnessBook(dir, W_ACTS);
  const none = wire(options);
  const chain = wire({ ...options, gate2: phaseR() });
  const onBook = wire({ ...options, gate2: phaseR(), gate2BookPath: book });
  assert.strictEqual(none.sensorVerdicts.length, 10);
  const others = (w: ReturnType<typeof wire>) => w.sensorVerdicts.filter((v) => v.sensorId !== GATE2_READER);
  const rows = (w: ReturnType<typeof wire>) => w.census.readers.filter((r) => r.reader !== GATE2_READER);
  const feet = (w: ReturnType<typeof wire>) => footingsFromWiring(w).filter((f) => f.reader !== GATE2_READER);
  for (const [name, w] of [["on the chain", chain], ["on the book", onBook]] as const) {
    assert.deepStrictEqual(others(w), others(none), `${name}: another reader's verdict moved`);
    assert.deepStrictEqual(rows(w), rows(none), `${name}: another reader's census row moved`);
    assert.deepStrictEqual(feet(w), feet(none), `${name}: another reader's footing moved`);
  }
});

check("WB-6 · without gate2BookPath nothing changed: Gate 2 reads logFile exactly as before the option existed", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-wb6-"));
  const log = writeJsonl(dir, "l.jsonl", g2Specs(G2_ALARMING));
  const w = wire({ ...baseOptions(log), gate2: g2Basket() });
  const row = w.census.readers.find((r) => r.reader === GATE2_READER)!;
  assert.ok(!row.source.includes(GATE2_BOOK_SOURCE_PREFIX));
  assert.strictEqual(w.gate2ReadsBook, false);
  assert.strictEqual(w.gate2Log, null);
  const direct = readGate2Direction(w.logFile!, { readableLoadStates: GATE, basket: g2Basket() });
  assert.strictEqual(gate2Of(w)!.kind, direct.verdict.kind);
});

check("WB-7 · records of ANOTHER method or drawing (another CONSEQUENCE@ class) are not counted under this basket's class", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-wb7-"));
  const other = witnessBook(dir, W_ACTS, G2_SUBJECT, "INTEREST_LABEL@00000000000000cc");
  const w = wire({ ...baseOptions(wLog(dir)), readableLoadStates: G1_STATES, gate2: phaseR(), gate2BookPath: other });
  const v = gate2Of(w)!;
  assert.ok(v.summary.includes("n=0"), "this basket's classes count nothing from another class");
  assert.ok(!/n=[1-9]/.test(v.summary), v.summary.slice(0, 400));
});

check("WB-8 · REMOVAL (machine half): the same acts and basket under ANOTHER subject name read identically, modulo the name", () => {
  const da = mkdtempSync(join(tmpdir(), "mica-glue-wb8a-"));
  const db = mkdtempSync(join(tmpdir(), "mica-glue-wb8b-"));
  const a = wire({ ...baseOptions(wLog(da, "subject-a")), readableLoadStates: G1_STATES, gate2: phaseR("subject-a"), gate2BookPath: witnessBook(da, W_ACTS, "subject-a") });
  const b = wire({ ...baseOptions(wLog(db, "subject-b")), readableLoadStates: G1_STATES, gate2: phaseR("subject-b"), gate2BookPath: witnessBook(db, W_ACTS, "subject-b") });
  assert.strictEqual(gate2Of(b)!.kind, gate2Of(a)!.kind);
  assert.strictEqual(gate2Of(b)!.summary.split("subject-b").join("subject-a"), gate2Of(a)!.summary);
});

check("WB-9 · Gate 2 COUNTS THE BOOK: the recorder's n per facet is the book's, never the log's (refuter A-F9 W3)", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-wb9-"));
  const w = wire({ ...baseOptions(wLog(dir)), readableLoadStates: G1_STATES, gate2: phaseR(), gate2BookPath: witnessBook(dir, W_ACTS) });
  const v = gate2Of(w)!;
  const n = (effect: string): string => `outcome=${JSON.stringify(`x2:${effect}`)}) n=`;
  // W_ACTS facets: act-1 FIRST_SEEN (shared, first look); act-2 EXISTENCE_DIFFERS (shared, gone since); act-3 HELD; act-4 LATE.
  for (const [effect, count] of [["FIRST_SEEN", 1], ["EXISTENCE_DIFFERS", 1], ["HELD", 1], ["LATE", 1], ["SAME", 0], ["CONTENT_DIFFERS", 0]] as const) {
    assert.ok(v.summary.includes(`${n(effect)}${String(count)} UNBOUNDED`), `${effect} n=${String(count)}: ${v.summary.slice(0, 700)}`);
  }
  assert.ok(v.summary.includes("[x1=0, x2=4, x3=0]"), "per frame category, from the book");
});

check("WB-10 · COVERAGE counts the basket's own SUBJECT only: another subject's records in the same book are neither acts nor footing (refuter A-F9 W5)", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-wb10-"));
  const book = witnessBook(dir, W_ACTS);
  witnessBook(dir, W_ACTS, "subject-b", W_DC, 500);
  const all = new SubjectChainLog({ path: book }).getChain().filter((r) => r.recordType === "SUBJECT_EVENT");
  assert.strictEqual(all.length, 8, "fixture: both subjects are in the one book");
  const w = wire({ ...baseOptions(wLog(dir)), readableLoadStates: G1_STATES, gate2: phaseR(), gate2BookPath: book });
  const row = w.census.readers.find((r) => r.reader === GATE2_READER)!;
  assert.ok(row.source.includes("the book holds a record for 4 act(s) under this basket's class"), row.source);
  assert.ok(row.source.includes("By category x2=4; by facet EXISTENCE_DIFFERS=1 FIRST_SEEN=1 HELD=1 LATE=1."), row.source);
  assert.ok(gate2Of(w)!.summary.includes("[x1=0, x2=4, x3=0]"), "the reader filters by subject too");
});

check("WB-11 · COVERAGE's second denominator: the acts the INTEREST BOOK placed in a frame category, matched by subjectSeq; UNOBSERVABLE and held anomalies are counted", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-wb11-"));
  // writeG1Book places subject-a's acts under G1_CLASS_NOW at subjectSeq 1, 3, 7 (2 and 6 are another drawing's,
  // 5 is UNDERIVED, 4 another subject's). The witness book is drawn from the SAME class, so only those three count.
  const acts: WAct[] = [
    { actionId: "p1", effect: "keep", execute: true, decided: true },
    { actionId: "p2", effect: "write", execute: false, decided: true },
    { actionId: "p3", effect: "keep", execute: true, decided: true },
  ];
  const book = witnessBook(dir, acts, G2_SUBJECT, G1_CLASS_NOW, 1);
  const w = wire({ ...baseOptions(wLog(dir)), readableLoadStates: G1_STATES, gate1: G1_FRAME, gate1BookPath: writeG1Book(dir), gate2: phaseR(G2_SUBJECT, consequenceEventType(G1_CLASS_NOW)), gate2BookPath: book });
  const row = w.census.readers.find((r) => r.reader === GATE2_READER)!;
  assert.ok(row.source.includes("Of the 3 act(s) the interest book placed in a frame category (the acts pointed to the witness), 2 have a record."), row.source);
  assert.ok(row.source.includes("by facet FIRST_SEEN=2 HELD=1"), row.source);
});

check("WB-12 · STALENESS is printed when the subject log's latest act is newer than the book's latest record, and not otherwise", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-wb12-"));
  const book = witnessBook(dir, W_ACTS);
  const stale = wire({ ...baseOptions(wLog(dir)), readableLoadStates: G1_STATES, gate2: phaseR(), gate2BookPath: book });
  const lastBook = Math.max(...new SubjectChainLog({ path: book }).getAll().map((r) => r.timestamp));
  const lastAct = Math.max(...readFileSync(wLog(dir), "utf8").trim().split("\n").map((l) => (JSON.parse(l) as { timestamp: number }).timestamp));
  const row = stale.census.readers.find((r) => r.reader === GATE2_READER)!;
  if (lastAct > lastBook) assert.ok(row.source.includes(`STALENESS: the subject's latest TOOL_ATTEMPTED (pointed or not) is ${String(lastAct - lastBook)} ms newer`), row.source);
  else assert.ok(!row.source.includes("STALENESS"), row.source);
  const fresh = writeJsonl(dir, "old-log.jsonl", healthySpecs());
  const none = wire({ ...baseOptions(fresh), readableLoadStates: G1_STATES, gate2: phaseR(), gate2BookPath: book });
  assert.ok(!none.census.readers.find((r) => r.reader === GATE2_READER)!.source.includes("STALENESS"), "no act newer than the book: no staleness line");
});

check("WB-13 · a DOUBLED record shows: the coverage line counts records beside acts and names acts with more than one (refuter R2 F7)", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-wb13-"));
  const book = witnessBook(dir, W_ACTS);
  const clean = wire({ ...baseOptions(wLog(dir)), readableLoadStates: G1_STATES, gate2: phaseR(), gate2BookPath: book });
  assert.ok(clean.census.readers.find((r) => r.reader === GATE2_READER)!.source.includes("Records of this class: 4; acts with more than one: 0."));
  const j = new SubjectEventJournal({ path: book });
  const first = new SubjectChainLog({ path: book }).getChain().find((r) => r.recordType === "SUBJECT_EVENT") as unknown as Record<string, unknown>;
  const { recordType: _rt, sequenceNumber: _sn, previousHash: _ph, hash: _h, ...copy } = first;
  assert.ok(j.appendEvent(() => ({ ...(copy as object), timestamp: (first.timestamp as number) + 1000 }) as never).persisted, "fixture: a second record for one act");
  const doubled = wire({ ...baseOptions(wLog(dir)), readableLoadStates: G1_STATES, gate2: phaseR(), gate2BookPath: book });
  const src = doubled.census.readers.find((r) => r.reader === GATE2_READER)!.source;
  assert.ok(src.includes("the book holds a record for 4 act(s)"), src);
  assert.ok(src.includes("Records of this class: 5; acts with more than one: 1."), src);
});

/** A chained subject log (boundary + TOOL_ATTEMPTED acts), as the bridge writes it. */
function chainLog(dir: string, name: string, seqs: number): SubjectChainLog {
  const path = join(dir, name);
  const j = new SubjectEventJournal({ path });
  assert.ok(j.appendBoundary(null, "fixture: a subject chain", T0).persisted);
  for (let i = 0; i < seqs; i++) {
    assert.ok(j.appendEvent((seq) => ({ moduleId: G2_SUBJECT, eventType: "TOOL_ATTEMPTED", outcome: "probe_tool", actionId: `c${String(seq)}`, timestamp: T0 + seq })).persisted);
  }
  return new SubjectChainLog({ path });
}
/** A witness book with hand-written records citing (chain, seq). */
function citingBook(dir: string, cites: readonly [string | null, number][]): SubjectChainLog {
  const path = join(dir, "citing-book.jsonl");
  const j = new SubjectEventJournal({ path });
  assert.ok(j.appendBoundary(null, "fixture: a witness book", T0).persisted);
  for (const [chain, subjectSeq] of cites) {
    assert.ok(j.appendEvent(() => ({ moduleId: G2_SUBJECT, eventType: W_CLASS, outcome: "x2:SAME", actionId: `w${String(subjectSeq)}`, timestamp: T0 + 100, witnessed: { cites: { chain, subjectSeq }, fate: "RAN", observed: "SAME" } }) as never).persisted);
  }
  return new SubjectChainLog({ path });
}

check("WB-14 · COVERAGE keys on the SUBJECT CHAIN too: after a rotation, records citing the old chain are named and never counted as this chain's acts (refuter R2-bytes F3)", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-wb14-"));
  const log = chainLog(dir, "subject.jsonl", 3);
  const chain = log.getBoundary()!.hash;
  const book = citingBook(dir, [[chain, 1], ["9".repeat(64), 2], ["9".repeat(64), 3]]);
  const line = gate2BookCoverageLine(book, log, [G2_SUBJECT], [W_CLASS], null);
  assert.ok(line.includes("the book holds a record for 1 act(s) under this basket's class — 1 of the subject log's 3 TOOL_ATTEMPTED act(s)."), line);
  assert.ok(line.includes("Records citing another subject chain (before a rotation), not counted: 2."), line);
  const noLog = gate2BookCoverageLine(book, null, [G2_SUBJECT], [W_CLASS], null);
  assert.ok(noLog.includes("The subject chain is unknown here, so records of every chain are counted."), noLog);
});

check("WB-15 · the POINTED-ACTS denominator counts only labels of a drawing this basket's class was named from, on this chain's time (refuter R2-bytes F10)", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-wb15-"));
  const log = chainLog(dir, "subject.jsonl", 3);
  const book = citingBook(dir, [[log.getBoundary()!.hash, 1]]);
  const ipath = join(dir, "interest.jsonl");
  const ij = new SubjectEventJournal({ path: ipath });
  assert.ok(ij.appendBoundary(null, "fixture: interest book", T0).persisted);
  for (const [cls, seq] of [[W_DC, 1], [W_DC, 2], ["INTEREST_LABEL@00000000000000cc", 3]] as const) {
    assert.ok(ij.appendEvent(() => ({ moduleId: G2_SUBJECT, eventType: cls, outcome: "x2", actionId: `l${String(seq)}`, timestamp: T0 + seq, subjectSeq: seq })).persisted);
  }
  const line = gate2BookCoverageLine(book, log, [G2_SUBJECT], [W_CLASS], new SubjectChainLog({ path: ipath }));
  assert.ok(line.includes("Of the 2 act(s) the interest book placed in a frame category (the acts pointed to the witness), 1 have a record."), line);
});

check("WB-16 · THE CEILING ON THE VERDICT'S OWN FACE: on the book Gate 2's summary carries GATE2_BOOK_CEILING, as op3's carries its own; on the chain it does not (refuter R2-canon F1)", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-wb16-"));
  const onBook = wire({ ...baseOptions(wLog(dir)), readableLoadStates: G1_STATES, gate2: phaseR(), gate2BookPath: witnessBook(dir, W_ACTS) });
  const v = gate2Of(onBook)!;
  assert.ok(v.summary.endsWith(` || ${GATE2_BOOK_CEILING}`), v.summary.slice(-300));
  assert.ok(GATE2_BOOK_CEILING.includes("line 6 is FALSE in its first clause") && GATE2_BOOK_CEILING.includes("S206 clause STILL HOLDS"));
  const onChain = wire({ ...baseOptions(wLog(dir)), readableLoadStates: G1_STATES, gate2: phaseR() });
  assert.ok(!gate2Of(onChain)!.summary.includes(GATE2_BOOK_CEILING));
});

// ── T33 · GATE 2 HARM ON THE WITNESS'S BOOK (Long Run A Stop 2, contract M3) ─────
//
// `gate2Harm` reads ONLY the witness's book, follows the book's declared predecessors for the latch, and takes
// its act roster from the interest book. Fixture names only: subject-a / subject-b, items hw-*, origins hw-o*.

import { createHash as hwHash } from "crypto";
import { renameSync as hwRename, statSync as hwStat } from "fs";
import {
  GATE2_HARM_NO_THRESHOLD,
  GATE2_BOOK_IS_ROSTER,
  GATE2_HARM_AND_BASKET_REFUSED,
  GATE2_HARM_WITHOUT_BOOK,
  gate2PredecessorChain,
} from "./wire";
import { GATE2_HARM_CEILING_LINES } from "../mica/gate2-direction";
import type { Gate2Harm } from "../mica/gate2-direction";

const HW_EVENT = consequenceEventType(W_DC);
const HW_FP = "a".repeat(64);
const HW_FP_GRANT = "b".repeat(64);

function hwHarm(over: Partial<Gate2Harm> = {}): Gate2Harm {
  return {
    harmClass: "G2_HARM@00000000000000c3",
    origins: [{ id: "hw-o1", subject: G2_SUBJECT }],
    items: [
      { id: "hw-prot", category: "x2", control: false, fingerprint: HW_FP },
      { id: "hw-grant", category: "x2", control: false, fingerprint: HW_FP_GRANT },
    ],
    grants: { "hw-prot": [], "hw-grant": ["hw-o1"] },
    // AMENDED (S216-2): the four-field since (canonical spellings) and the grant memory the bridge now sends.
    grantSince: { "hw-prot": {}, "hw-grant": { "hw-o1": { at: T0 - 1, utc: new Date(T0 - 1).toISOString(), declaredAt: T0 - 1, declaredUtc: new Date(T0 - 1).toISOString() } } },
    grantMemory: { tag: "G2_GRANT_MEMORY@00000000000000c4", state: "SEEDED" },
    errandGrants: [],
    clearances: [],
    saltEpochSince: T0 - 1,
    ...over,
  };
}

type HwRec = { seq: number; fp: string | null; observed: string; fate?: string; subject?: string; priorLookAt?: number | null };

/** A hand-built witness book (the record shape seeingd writes), boundary first; returns the records' hashes. */
function hwBook(path: string, boundaryAt: number, recs: readonly HwRec[], retired: { path: string; records: number; bytes: number; sha256: string } | null = null): string[] {
  const j = new SubjectEventJournal({ path });
  assert.ok(j.appendBoundary(retired, "fixture: a witness book", boundaryAt).persisted);
  for (const r of recs) {
    // The served witness writes priorLookAt on every record (seeingd.ts:578; null on a first look); S216's window
    // start reads it, so the fixture carries it: by default the instant just before this record's.
    const fate = r.fate ?? "RAN";
    const effect = fate.startsWith("LATE") ? "LATE" : fate === "HELD" ? "HELD" : r.observed;
    assert.ok(j.appendEvent(() => ({ moduleId: r.subject ?? G2_SUBJECT, eventType: HW_EVENT, outcome: `x2:${effect}`, actionId: `act-${String(r.seq)}`, timestamp: boundaryAt + r.seq, witnessed: { cites: { chain: null, subjectSeq: r.seq, targetFingerprint: r.fp }, fate, observed: r.observed, priorLookAt: r.priorLookAt !== undefined ? r.priorLookAt : r.observed === "FIRST_SEEN" ? null : boundaryAt + r.seq - 1 } }) as never).persisted);
  }
  return new SubjectChainLog({ path }).getChain().filter((r) => r.recordType === "SUBJECT_EVENT").map((r) => r.hash);
}

/** The interest book: one label per act, with the bridge-minted subjectSeq. */
function hwRoster(path: string, at: number, seqs: readonly number[], labels: Readonly<Record<number, string>> = {}): string {
  const j = new SubjectEventJournal({ path });
  assert.ok(j.appendBoundary(null, "fixture: interest book", at).persisted);
  for (const seq of seqs) {
    assert.ok(j.appendEvent(() => ({ moduleId: G2_SUBJECT, eventType: W_DC, outcome: labels[seq] ?? "x2", actionId: `act-${String(seq)}`, timestamp: at + seq, subjectSeq: seq }) as never).persisted);
  }
  return path;
}

/** Retire `path` beside itself, as seeingd does, and return the `retired` field its successor declares. */
function hwRetire(path: string, suffix = "fixture"): { path: string; records: number; bytes: number; sha256: string } {
  const bytes = readFileSync(path);
  const to = `${path}.retired-method-${suffix}`;
  hwRename(path, to);
  return { path: to, records: bytes.toString("utf8").trim().split("\n").length, bytes: hwStat(to).size, sha256: hwHash("sha256").update(bytes).digest("hex") };
}

let hwRosterN = 0;
function hwWire(dir: string, book: string, over: Partial<WireOptions> = {}): ReturnType<typeof wire> {
  const roster = over.gate2RosterPath ?? hwRoster(join(dir, `interest-${String(++hwRosterN)}.jsonl`), T0, [1, 2, 3, 4]);
  return wire({ ...baseOptions(wLog(dir)), readableLoadStates: G1_STATES, gate2Harm: hwHarm(), gate2BookPath: book, gate2DecidingActionId: "act-3", ...over, gate2RosterPath: roster });
}

const HW_CHANGE: HwRec[] = [{ seq: 1, fp: HW_FP, observed: "FIRST_SEEN" }, { seq: 2, fp: HW_FP, observed: "CONTENT_DIFFERS" }];

check("HW-1 · gate2Harm on the witness's book: an ungranted DIFFERS on an item ALARMS, latched; the census says HARM <class>, the latch and the code; NO GATE2_BOOK_CEILING", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-hw1-"));
  const book = join(dir, "book.jsonl");
  hwBook(book, T0, HW_CHANGE);
  const w = hwWire(dir, book);
  const row = w.census.readers.find((r) => r.reader === GATE2_READER)!;
  assert.strictEqual(row.wired, true);
  assert.strictEqual(row.verdictKind, "ALARM", row.source);
  // AMENDED (S216-2, cond. 8): the census line names the grant memory's tag beside the class.
  assert.ok(row.source.includes("GATE 2 HARM G2_HARM@00000000000000c3 (grant memory G2_GRANT_MEMORY@00000000000000c4): ALARM — code G2_UNGRANTED_CHANGE_ON_ITEM; LATCHED since seq 2 of the current book."), row.source);
  assert.ok(row.source.includes("PREDECESSORS (the latch only, never the counts): none — the book declares retired: null"), row.source);
  assert.ok(row.source.includes("ROSTER: ") && row.source.includes("4 act(s) of the origin subject(s)"), row.source);
  assert.ok(!row.source.includes(GATE2_BOOK_CEILING), "the harm ceilings supersede the book ceiling");
  const v = gate2Of(w)!;
  assert.ok(!v.summary.includes(GATE2_BOOK_CEILING));
  for (const line of GATE2_HARM_CEILING_LINES) assert.ok(v.summary.includes(line), line.slice(0, 40));
  assert.ok(v.summary.includes("The act whose decision carries it: the act \"act-3\"."), v.summary.slice(0, 600));
  assert.deepStrictEqual(footingsFromWiring(w).filter((f) => f.reader === GATE2_READER), [{ reader: GATE2_READER, loadState: "LOADED_SUBJECT_CHAIN_VERIFIED" }]);
});

check("HW-2 · the granted item reads SILENT (\"granted\"); FIRST_SEEN reads SILENT; a carried act without a record reads NOT READABLE — each through wire()", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-hw2-"));
  const book = join(dir, "book.jsonl");
  hwBook(book, T0, [{ seq: 1, fp: HW_FP_GRANT, observed: "FIRST_SEEN" }, { seq: 2, fp: HW_FP_GRANT, observed: "CONTENT_DIFFERS" }]);
  const granted = gate2Of(hwWire(dir, book))!;
  assert.strictEqual(granted.kind, "SILENT", granted.summary.slice(0, 300));
  assert.ok(granted.summary.includes("granted: hw-o1 on hw-grant"));
  const d2 = mkdtempSync(join(tmpdir(), "mica-glue-hw2b-"));
  const b2 = join(d2, "book.jsonl");
  hwBook(b2, T0, [{ seq: 1, fp: HW_FP, observed: "FIRST_SEEN" }]);
  assert.strictEqual(gate2Of(hwWire(d2, b2, { gate2DecidingActionId: "act-2" }))!.kind, "SILENT");
  const nr = gate2Of(hwWire(d2, b2, { gate2DecidingActionId: "act-4" }))!;
  assert.strictEqual(nr.kind, "CANNOT_ASSESS");
  assert.ok(nr.summary.startsWith("NOT READABLE: "), nr.summary.slice(0, 200));
});

check("HW-3 · gate2Harm WITHOUT gate2BookPath is NOT WIRED (GATE2_HARM_WITHOUT_BOOK) — the chain is never read in harm mode", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-hw3-"));
  const w = wire({ ...baseOptions(wLog(dir)), readableLoadStates: G1_STATES, gate2Harm: hwHarm() });
  const row = w.census.readers.find((r) => r.reader === GATE2_READER)!;
  assert.deepStrictEqual([row.wired, row.source, row.verdictKind], [false, GATE2_HARM_WITHOUT_BOOK, null]);
  assert.ok(!w.sensorVerdicts.some((v) => v.sensorId === GATE2_READER), "nothing composes");
  assert.ok(GATE2_HARM_WITHOUT_BOOK.includes("GATE2_HARM_WITHOUT_BOOK"));
});

check("HW-4 · gate2Harm AND gate2 (the class basket) → WireUsageError, refused loudly", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-hw4-"));
  let threw: unknown = null;
  try {
    wire({ ...baseOptions(wLog(dir)), gate2: phaseR(), gate2Harm: hwHarm(), gate2BookPath: join(dir, "b.jsonl") });
  } catch (e) {
    threw = e;
  }
  assert.ok(threw instanceof WireUsageError, String(threw));
  assert.strictEqual((threw as Error).message, GATE2_HARM_AND_BASKET_REFUSED);
});

check("HW-5 · RETIREMENT: the latch follows the verified predecessor chain; a missing, mismatching or out-of-directory predecessor reads G2_PREDECESSOR_NOT_READABLE — never SILENT — unless an ALARM stands", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-hw5-"));
  const book = join(dir, "book.jsonl");
  hwBook(book, T0, HW_CHANGE);
  const retired = hwRetire(book);
  hwBook(book, T0 + 100, [{ seq: 3, fp: HW_FP, observed: "SAME" }], retired);
  const roster = { gate2RosterPath: hwRoster(join(dir, "interest.jsonl"), T0 + 100, [3, 4]), gate2DecidingActionId: "act-4" };
  const w = hwWire(dir, book, roster);
  const row = w.census.readers.find((r) => r.reader === GATE2_READER)!;
  assert.strictEqual(row.verdictKind, "ALARM", row.source);
  assert.ok(row.source.includes("LATCHED in a predecessor book"), row.source);
  assert.ok(row.source.includes("sha256 verified"), row.source);
  assert.strictEqual(gate2PredecessorChain(new SubjectChainLog({ path: book })).logs.length, 1);
  // the predecessor's bytes changed after retirement → its sha256 mismatches
  appendFileSync(retired.path, "\n");
  const tampered = gate2Of(hwWire(dir, book, roster))!;
  assert.strictEqual(tampered.kind, "CANNOT_ASSESS");
  assert.ok(tampered.summary.includes("G2_PREDECESSOR_NOT_READABLE"), tampered.summary.slice(0, 400));
  // missing
  rmSync(retired.path);
  const missing = hwWire(dir, book, roster);
  assert.ok(gate2Of(missing)!.summary.includes("G2_PREDECESSOR_NOT_READABLE"));
  assert.ok(missing.census.readers.find((r) => r.reader === GATE2_READER)!.source.includes("it is missing, or not a regular file"));
  // out of the book's directory
  const d2 = mkdtempSync(join(tmpdir(), "mica-glue-hw5b-"));
  const elsewhere = join(mkdtempSync(join(tmpdir(), "mica-glue-hw5c-")), "old.jsonl");
  hwBook(elsewhere, T0, HW_CHANGE);
  const b2 = join(d2, "book.jsonl");
  const bytes = readFileSync(elsewhere);
  hwBook(b2, T0 + 100, [{ seq: 3, fp: HW_FP, observed: "SAME" }], { path: elsewhere, records: 3, bytes: bytes.length, sha256: hwHash("sha256").update(bytes).digest("hex") });
  const out = hwWire(d2, b2, { gate2RosterPath: hwRoster(join(d2, "interest.jsonl"), T0 + 100, [3, 4]), gate2DecidingActionId: "act-4" });
  assert.ok(out.census.readers.find((r) => r.reader === GATE2_READER)!.source.includes("it does not sit in the book's own directory"));
  assert.ok(gate2Of(out)!.summary.includes("G2_PREDECESSOR_NOT_READABLE"));
  // an ALARM on the current book is never hidden by an unverifiable predecessor
  const d3 = mkdtempSync(join(tmpdir(), "mica-glue-hw5d-"));
  const b3 = join(d3, "book.jsonl");
  hwBook(b3, T0 + 100, [{ seq: 3, fp: HW_FP, observed: "FIRST_SEEN" }, { seq: 4, fp: HW_FP, observed: "META_DIFFERS" }], { path: join(d3, "gone.jsonl"), records: 1, bytes: 1, sha256: "c".repeat(64) });
  assert.strictEqual(gate2Of(hwWire(d3, b3, { gate2RosterPath: hwRoster(join(d3, "interest.jsonl"), T0 + 100, [3, 4, 5]), gate2DecidingActionId: "act-5" }))!.kind, "ALARM");
});

check("HW-6 · the ROSTER: absent or unreadable → G2_ROSTER_NOT_READABLE; the book may not be the roster (NOT WIRED); a status read carries the newest act", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-hw6-"));
  const book = join(dir, "book.jsonl");
  hwBook(book, T0, [{ seq: 1, fp: HW_FP, observed: "FIRST_SEEN" }]);
  const absent = gate2Of(wire({ ...baseOptions(wLog(dir)), readableLoadStates: G1_STATES, gate2Harm: hwHarm(), gate2BookPath: book }))!;
  assert.ok(absent.summary.includes("G2_ROSTER_NOT_READABLE"), absent.summary.slice(0, 300));
  const junk = join(dir, "junk.jsonl");
  writeFileSync(junk, "not json\n");
  assert.ok(gate2Of(hwWire(dir, book, { gate2RosterPath: junk }))!.summary.includes("G2_ROSTER_NOT_READABLE"));
  const same = hwWire(dir, book, { gate2RosterPath: book });
  assert.deepStrictEqual(same.census.readers.find((r) => r.reader === GATE2_READER)!.source, GATE2_BOOK_IS_ROSTER);
  const status = gate2Of(hwWire(dir, book, { gate2RosterPath: hwRoster(join(dir, "i2.jsonl"), T0, [1]), gate2DecidingActionId: null }))!;
  assert.strictEqual(status.kind, "SILENT", status.summary.slice(0, 300));
  assert.ok(status.summary.includes("no deciding act (a status read)"));
});

check("HW-7 · CROSS-READER: with gate2Harm the other readers read byte-identically to Gate 2 undeclared", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-hw7-"));
  const book = join(dir, "book.jsonl");
  hwBook(book, T0, HW_CHANGE);
  const options = g2AllOthers(dir, wLog(dir));
  const none = wire(options);
  const harm = wire({ ...options, gate2Harm: hwHarm(), gate2BookPath: book, gate2RosterPath: hwRoster(join(dir, "interest.jsonl"), T0, [1, 2, 3]), gate2DecidingActionId: "act-3" });
  const others = (w: ReturnType<typeof wire>) => w.sensorVerdicts.filter((v) => v.sensorId !== GATE2_READER);
  const rows = (w: ReturnType<typeof wire>) => w.census.readers.filter((r) => r.reader !== GATE2_READER);
  assert.deepStrictEqual(others(harm), others(none));
  assert.deepStrictEqual(rows(harm), rows(none));
  assert.strictEqual(gate2Of(harm)!.kind, "ALARM");
});

check("HW-8 · T32 COVERAGE BOUND: the denominator counts only the subject log's acts at or after the book's boundary", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-hw8-"));
  const book = join(dir, "book.jsonl");
  // a book begun at the timestamp of the subject log's THIRD act can hold only the acts from there on
  const logPath = wLog(dir);
  const acts = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { timestamp: number; eventType: string }).filter((r) => r.eventType === "TOOL_ATTEMPTED");
  const at = acts[2].timestamp;
  hwBook(book, at, [{ seq: 9, fp: HW_FP, observed: "FIRST_SEEN" }]);
  const line = gate2BookCoverageLine(new SubjectChainLog({ path: book }), new MicaLogFile({ path: logPath }) as never, [G2_SUBJECT], [HW_EVENT], null);
  const after = acts.filter((r) => r.timestamp >= at).length;
  assert.ok(after > 0 && after < acts.length, `fixture: some acts on each side (${after}/${acts.length})`);
  assert.ok(line.includes(`of the subject log's ${String(after)} TOOL_ATTEMPTED act(s).`), line);
  assert.ok(line.includes(`DENOMINATOR: acts at or after the book's boundary (timestamp ${String(at)}) only (T32); acts before it, not counted: ${String(acts.length - after)}.`), line);
});

check("HW-9 · REMOVAL (machine glue half): gate2Harm removed → Gate 2 reads exactly as before (NOT DECLARED; or the class basket on the book with its book ceiling)", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-hw9-"));
  const book = witnessBook(dir, W_ACTS);
  const removed = wire({ ...baseOptions(wLog(dir)), readableLoadStates: G1_STATES, gate2BookPath: book, gate2RosterPath: join(dir, "x.jsonl"), gate2DecidingActionId: "act-1" });
  const plain = wire({ ...baseOptions(wLog(dir)), readableLoadStates: G1_STATES, gate2BookPath: book });
  assert.deepStrictEqual(removed.census.readers, plain.census.readers);
  assert.deepStrictEqual(removed.sensorVerdicts, plain.sensorVerdicts);
  const classOnBook = wire({ ...baseOptions(wLog(dir)), readableLoadStates: G1_STATES, gate2: phaseR(), gate2BookPath: book, gate2RosterPath: join(dir, "x.jsonl"), gate2DecidingActionId: "act-1" });
  const classPlain = wire({ ...baseOptions(wLog(dir)), readableLoadStates: G1_STATES, gate2: phaseR(), gate2BookPath: book });
  assert.deepStrictEqual(classOnBook.census.readers, classPlain.census.readers, "the harm-only options are inert without gate2Harm");
  assert.ok(gate2Of(classOnBook)!.summary.endsWith(` || ${GATE2_BOOK_CEILING}`));
});

check("HW-10 · THE UNDERIVED WORD is passed through (gate2UnderivedWord): declared and matching → the underived reason; absent or null → the generic reason with the label quoted", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-hw10-"));
  const book = join(dir, "book.jsonl");
  hwBook(book, T0, [{ seq: 1, fp: HW_FP, observed: "FIRST_SEEN" }]);
  const roster = hwRoster(join(dir, "interest.jsonl"), T0, [1, 2, 3], { 2: "NO-CATEGORY-W" });
  const declared = gate2Of(hwWire(dir, book, { gate2RosterPath: roster, gate2UnderivedWord: "NO-CATEGORY-W" }))!;
  assert.ok(declared.summary.startsWith("NOT READABLE: "), declared.summary.slice(0, 200));
  assert.ok(declared.summary.includes("placed in no frame category (NO-CATEGORY-W), so the witness was never pointed"), declared.summary.slice(0, 400));
  for (const word of [undefined, null] as const) {
    const generic = gate2Of(hwWire(dir, book, { gate2RosterPath: roster, gate2UnderivedWord: word }))!;
    assert.ok(generic.summary.startsWith("NOT READABLE: "), String(word));
    assert.ok(generic.summary.includes("its label is \"NO-CATEGORY-W\""), generic.summary.slice(0, 400));
    assert.ok(!generic.summary.includes("so the witness was never pointed"), String(word));
  }
});

check("HW-11 · REFUTER M2: the harm reading reaches the DECISION OBJECT — one Gate-2 readings row (NO_THRESHOLD) quoting the reader's harmLine verbatim, on a granted SILENT (origin + grant), an ALARM and a NOT READABLE; the class path pushes no row", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-hw11-"));
  const g = join(dir, "granted.jsonl");
  hwBook(g, T0, [{ seq: 1, fp: HW_FP_GRANT, observed: "FIRST_SEEN" }, { seq: 2, fp: HW_FP_GRANT, observed: "CONTENT_DIFFERS" }]);
  const a = join(dir, "alarm.jsonl");
  hwBook(a, T0, HW_CHANGE);
  const q = join(dir, "quiet.jsonl");
  hwBook(q, T0, [{ seq: 1, fp: HW_FP, observed: "FIRST_SEEN" }]);
  const cases: ReadonlyArray<readonly [string, ReturnType<typeof wire>, string]> = [
    ["granted SILENT", hwWire(dir, g), `item hw-grant; origin hw-o1; grant GRANTED (hw-o1 may change hw-grant since ${new Date(T0 - 1).toISOString()}); facet CONTENT_DIFFERS; fate RAN`],
    ["ALARM", hwWire(dir, a), "HARM READING: ALARM — the act whose record shows the change: subjectSeq 2, actionId \"act-2\"; item hw-prot; origin hw-o1; grant NONE"],
    ["NOT READABLE", hwWire(dir, q, { gate2DecidingActionId: null }), "label \"x2\": no record on the book"],
  ];
  for (const [name, w, expected] of cases) {
    const v = gate2Of(w)!;
    const rows = readingsFromWiring(w, v.kind).filter((r) => r.sensorId === GATE2_READER);
    assert.strictEqual(rows.length, 1, `${name}: one Gate-2 readings row`);
    const m = rows[0].margin;
    assert.strictEqual(m.kind, "NO_THRESHOLD", name);
    const reason = (m as { reason: string }).reason;
    assert.ok(reason.startsWith(GATE2_HARM_NO_THRESHOLD), name);
    assert.ok(reason.includes(expected), `${name}: ${reason}`);
    // AMENDED (S216-2, cond. 8): the reason is the harmLine, then the reader's grant-memory line, each verbatim.
    const quoted = reason.slice(GATE2_HARM_NO_THRESHOLD.length + 1);
    const memAt = quoted.lastIndexOf(" GRANT MEMORY ");
    assert.ok(memAt > 0, `${name}: no grant-memory line in the reason: ${quoted}`);
    assert.ok(v.summary.includes(quoted.slice(0, memAt)), `${name}: the harmLine is not quoted verbatim from the verdict`);
    assert.ok(v.summary.includes(quoted.slice(memAt + 1)), `${name}: the grant-memory line is not quoted verbatim from the verdict`);
    assert.strictEqual(rows[0].kind, v.kind, name);
  }
  // the class basket on the book, and on the chain: no Gate-2 row, as before
  const book = witnessBook(mkdtempSync(join(tmpdir(), "mica-glue-hw11b-")), W_ACTS);
  for (const w of [wire({ ...baseOptions(wLog(dir)), readableLoadStates: G1_STATES, gate2: phaseR(), gate2BookPath: book }), wire({ ...baseOptions(wLog(dir)), readableLoadStates: G1_STATES, gate2: phaseR() })]) {
    assert.ok(!readingsFromWiring(w, "CANNOT_ASSESS").some((r) => r.sensorId === GATE2_READER), "a class reading has no row");
  }
});

check("HW-S216-2 · cond. 8: the census line prints the grant memory's tag and /explain's Gate-2 row appends the reader's grant-memory line; an S216 bridge's shape (no grantMemory) reads WIRED AND BLIND, 'not sent', 'not printed'", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-hws2162-"));
  const g = join(dir, "granted.jsonl");
  hwBook(g, T0, [{ seq: 1, fp: HW_FP_GRANT, observed: "FIRST_SEEN" }, { seq: 2, fp: HW_FP_GRANT, observed: "CONTENT_DIFFERS" }]);
  const w = hwWire(dir, g);
  const v = gate2Of(w)!;
  assert.strictEqual(v.kind, "SILENT", v.summary.slice(0, 300));
  const census = w.census.readers.find((r) => r.reader === GATE2_READER)!;
  assert.ok(census.source.includes("GATE 2 HARM G2_HARM@00000000000000c3 (grant memory G2_GRANT_MEMORY@00000000000000c4): SILENT"), census.source);
  const reason = (readingsFromWiring(w, v.kind).filter((r) => r.sensorId === GATE2_READER)[0].margin as { reason: string }).reason;
  assert.ok(/ GRANT MEMORY G2_GRANT_MEMORY@00000000000000c4 \(SEEDED — [^)]*\)\.$/.test(reason), reason);
  const old = hwHarm();
  const oldShape = { ...old } as Record<string, unknown>;
  delete oldShape.grantMemory;
  const wOld = hwWire(dir, g, { gate2Harm: oldShape as never });
  const vOld = gate2Of(wOld)!;
  assert.strictEqual(vOld.kind, "CANNOT_ASSESS");
  assert.ok(vOld.summary.includes("Grant memory: not printed (no validated harm basket on this path)."), vOld.summary.slice(0, 400));
  const cOld = wOld.census.readers.find((r) => r.reader === GATE2_READER)!;
  assert.strictEqual(cOld.wired, true);
  assert.ok(cOld.source.includes("(grant memory not sent): CANNOT_ASSESS"), cOld.source);
  const rOld = (readingsFromWiring(wOld, vOld.kind).filter((r) => r.sensorId === GATE2_READER)[0].margin as { reason: string }).reason;
  assert.ok(rOld.endsWith("Grant memory: not printed (no validated harm basket on this path)."), rOld);
});

import { classifyFacet as witnessClassifyFacet } from "../witness/seeing";
import { gate2LookFacet } from "../mica/gate2-direction";

check("HW-12 · EVASION 6.a/6.d CROSS-CHECK: the harm reader's replica facet rule equals the witness's own classifyFacet (seeing.ts) on every combination of the book's look keys", () => {
  const looks: Record<string, unknown>[] = [];
  for (const state of ["PRESENT", "ABSENT", "UNOBSERVABLE"])
    for (const type of ["file", "dir", null])
      for (const meta of ["m1", "m2"])
        for (const times of ["t1", "t2"])
          for (const size of ["s1", "s2"])
            for (const content of ["c1", "c2", null])
              for (const contentBasis of ["DIGESTED", "NOT_APPLICABLE", "OVER_CAP", null])
                looks.push({ at: 0, mono: "0", boot: "b", state, type, meta, times, size, content, contentBasis, error: null });
  let n = 0;
  const kinds = new Set<string>();
  for (const now of looks) {
    const w0 = witnessClassifyFacet(null, now as never);
    assert.strictEqual(gate2LookFacet(null, now as never), w0);
    kinds.add(w0);
    for (const last of looks) {
      const w = witnessClassifyFacet(last as never, now as never);
      const g = gate2LookFacet(last as never, now as never);
      if (w !== g) assert.fail(`differs on ${JSON.stringify(last)} → ${JSON.stringify(now)}: witness ${w}, reader ${g}`);
      kinds.add(w);
      n++;
    }
  }
  console.log(`    ${n} look pairs compared; facets reached: ${[...kinds].sort().join(", ")}`);
  assert.strictEqual(kinds.size, 7, "every facet the rule can give is reached");
});

check("HW-13 · BYTES W01: a predecessor TRUNCATED to a shorter VALID chain (the damage record dropped, the chain still verifies) is refused by its sha256 → G2_PREDECESSOR_NOT_READABLE, never SILENT", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-hw13-"));
  const book = join(dir, "book.jsonl");
  hwBook(book, T0, HW_CHANGE);
  const retired = hwRetire(book);
  // the same chain without its last (damage) line: every remaining link still verifies
  const lines = readFileSync(retired.path, "utf8").trim().split("\n");
  writeFileSync(retired.path, lines.slice(0, lines.length - 1).join("\n") + "\n");
  assert.strictEqual(new SubjectChainLog({ path: retired.path }).getLoadState(), "LOADED_SUBJECT_CHAIN_VERIFIED", "fixture: the truncated chain verifies");
  hwBook(book, T0 + 100, [{ seq: 3, fp: HW_FP, observed: "SAME" }], retired);
  const w = hwWire(dir, book, { gate2RosterPath: hwRoster(join(dir, "interest.jsonl"), T0 + 100, [3, 4]), gate2DecidingActionId: "act-4" });
  const v = gate2Of(w)!;
  assert.strictEqual(v.kind, "CANNOT_ASSESS", v.summary.slice(0, 300));
  assert.ok(v.summary.includes("G2_PREDECESSOR_NOT_READABLE"));
  assert.ok(w.census.readers.find((r) => r.reader === GATE2_READER)!.source.includes("its sha256"), "refused by its sha");
});

check("HW-14 · BYTES W03: a latch in a GRAND-predecessor (a two-level chain) holds", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-hw14-"));
  const book = join(dir, "book.jsonl");
  hwBook(book, T0, HW_CHANGE);
  const grand = hwRetire(book, "a");
  hwBook(book, T0 + 50, [{ seq: 3, fp: HW_FP, observed: "SAME" }], grand);
  const parent = hwRetire(book, "b");
  hwBook(book, T0 + 100, [{ seq: 4, fp: HW_FP, observed: "SAME" }], parent);
  const w = hwWire(dir, book, { gate2RosterPath: hwRoster(join(dir, "interest.jsonl"), T0 + 100, [4, 5]), gate2DecidingActionId: "act-5" });
  const row = w.census.readers.find((r) => r.reader === GATE2_READER)!;
  assert.strictEqual(row.verdictKind, "ALARM", row.source);
  assert.ok(row.source.includes("LATCHED in a predecessor book"), row.source);
  assert.strictEqual(gate2PredecessorChain(new SubjectChainLog({ path: book })).logs.length, 2, "both levels followed");
});

check("HW-15 · BYTES W08: a predecessor CYCLE is refused (named as a cycle) → G2_PREDECESSOR_NOT_READABLE", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-hw15-"));
  const book = join(dir, "book.jsonl");
  const prev = join(dir, "book.jsonl.retired-method-loop");
  // the predecessor declares the CURRENT book as its own predecessor
  hwBook(prev, T0, [{ seq: 1, fp: HW_FP, observed: "FIRST_SEEN" }], { path: book, records: 1, bytes: 1, sha256: "d".repeat(64) });
  const bytes = readFileSync(prev);
  hwBook(book, T0 + 100, [{ seq: 3, fp: HW_FP, observed: "SAME" }], { path: prev, records: 2, bytes: bytes.length, sha256: hwHash("sha256").update(bytes).digest("hex") });
  const w = hwWire(dir, book, { gate2RosterPath: hwRoster(join(dir, "interest.jsonl"), T0 + 100, [3, 4]), gate2DecidingActionId: "act-4" });
  const row = w.census.readers.find((r) => r.reader === GATE2_READER)!;
  assert.ok(row.source.includes("the chain names a book it already named (a cycle)"), row.source);
  assert.ok(gate2Of(w)!.summary.includes("G2_PREDECESSOR_NOT_READABLE"));
});

check("HW-16 · BYTES C2 (glue half): the roster is handed to the reader in the interest book's APPEND ORDER — a rotated subject chain carries the new chain's act, not the old chain's highest", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-glue-hw16-"));
  const book = join(dir, "book.jsonl");
  const j = new SubjectEventJournal({ path: book });
  assert.ok(j.appendBoundary(null, "fixture: a witness book", T0).persisted);
  for (const [seq, id, fp] of [[5, "old-5", HW_FP_GRANT], [1, "new-1", HW_FP]] as const) {
    assert.ok(j.appendEvent(() => ({ moduleId: G2_SUBJECT, eventType: HW_EVENT, outcome: "x2:FIRST_SEEN", actionId: id, timestamp: T0 + 20, witnessed: { cites: { chain: null, subjectSeq: seq, targetFingerprint: fp }, fate: "RAN", observed: "FIRST_SEEN" } }) as never).persisted);
  }
  const ipath = join(dir, "interest.jsonl");
  const ij = new SubjectEventJournal({ path: ipath });
  assert.ok(ij.appendBoundary(null, "fixture: interest book", T0).persisted);
  for (const [seq, id] of [[3, "old-3"], [4, "old-4"], [5, "old-5"], [1, "new-1"]] as const) {
    assert.ok(ij.appendEvent(() => ({ moduleId: G2_SUBJECT, eventType: W_DC, outcome: "x2", actionId: id, timestamp: T0 + 10, subjectSeq: seq })).persisted);
  }
  const v = gate2Of(hwWire(dir, book, { gate2RosterPath: ipath, gate2DecidingActionId: null }))!;
  assert.strictEqual(v.kind, "SILENT", v.summary.slice(0, 300));
  assert.ok(v.summary.includes("HARM READING: the carried act subjectSeq 1, actionId \"new-1\""), v.summary.slice(0, 600));
});

// ══ T27 · A READER THAT REALLY THROWS IS BOOKED AND HELD — NEVER A BARE 500 ══════════════════════════════════════
//
// Scope, ruled (the arbiter, board 2026-10-17 15:37Z, "Throws only, as recommended"): real throws only. An unreadable
// declared book stays each reader's own typed NOT READABLE and composes as before (the CONTROL arms below pin it).
// FORK-2 is the arbiter's and unruled at this build: built as (a), HOLD_BLIND + holdReason READER_THREW.
// Injection edits no src/mica byte: a module-export stub (the measurement's harness shape), the measured Gate 4
// escape shape (v3 cond. 11), real bytes for case (c), a sourcePath-conditioned patch for case (a). Every subject,
// class and tool name here is a FIXTURE (v3 cond. 21).
console.log("\n══ T27 · a reader that threw: booked, named, held ══════════════════════");

import {
  ENG_READER,
  SIG_READER,
  NARROW_K_READER,
  NARROW_W_READER,
  NARROW_R_READER,
  OP1_READER,
  READER_OWN_NET_CODES,
  SEAM_THREW_CODES,
  logAdapterThrewText,
  logDescribeThrewText,
} from "./wire";
import { READER_THREW_HOLDS } from "../mica/chokepoint";
import type { ReaderThrow } from "../mica/chokepoint";

const T27_MARKER = "T27-SECRET-MARKER-9f3a";
const T27_LINE: StakesLine = { classes: ["fixture-low", "fixture-high"], holdAtOrAbove: "fixture-high" };
const T27_BELOW = { impactClass: "fixture-low" };
const T27_ABOVE = { impactClass: "fixture-high" };

/** The module each seam reader's function lives in, and the export wire() calls. */
const T27_SEAMS: readonly (readonly [string, string, string])[] = [
  [ENG_READER, "../mica/eng", "assessEng"],
  [SIG_READER, "../mica/sig", "assessSig"],
  [NARROW_K_READER, "../mica/narrow-k", "assessNarrowK"],
  [NARROW_W_READER, "../mica/narrow-w", "assessNarrowW"],
  [NARROW_R_READER, "../mica/narrow-r", "assessNarrowR"],
  [NARROW_T_READER, "../mica/narrow-t", "assessNarrowT"],
  [OP1_READER, "../mica/op1-doctor-cadence", "assessOp1DoctorCadence"],
  [OP3_READER, "../mica/op3-node-response", "assessOp3NodeResponse"],
  [GATE4_READER, "../mica/gate4-sunset", "assessGate4Sunset"],
];

/** Replace one module export for the body's duration; the CONTROL inside asserts the stub really took. */
function t27Stub<T>(modPath: string, name: string, stub: unknown, body: () => T): T {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(modPath) as Record<string, unknown>;
  const orig = mod[name];
  mod[name] = stub;
  try {
    assert.strictEqual(mod[name], stub, `fixture: the stub on ${modPath}.${name} did not take`);
    return body();
  } finally {
    mod[name] = orig;
  }
}

function t27Thrower(): never {
  throw new RangeError(`${T27_MARKER} — the thrown text that must never surface`);
}

/** Every seam reader declared, on fixture sections; the log readable or not as `states` says. */
function t27AllDeclared(logPath: string, states: readonly string[], dir: string): WireOptions {
  return {
    ...baseOptions(logPath),
    readableLoadStates: states,
    narrowK: { declaredProfile: ["FIXTURE_K"], correlationThreshold: 0.05, correlationMinimumConstraintEvents: 30, correlationCeilingMargin: 0.02 } as never,
    narrowW: { declaredProfile: ["FIXTURE_W"] } as never,
    narrowR: { declaredProfile: ["FIXTURE_R"] } as never,
    narrowT: NARROW_T_CONFIG,
    op1: { attestationClass: { moduleId: "fixture-doctor", eventType: "FIXTURE_ATTESTED" } } as never,
    op3: { expectationClass: { moduleId: "fixture-host", eventType: "FIXTURE_ATTEMPTED" }, responseClass: { moduleId: "fixture-host", eventType: "FIXTURE_RESULT" }, responseBoundSteps: 2 } as never,
    gate4: {} as never,
    line: T27_LINE,
    floorTrailPath: join(dir, "trail.jsonl"),
    ledgerPath: join(dir, "ledger.jsonl"),
  };
}

function t27Row(w: ReturnType<typeof wire>, reader: string) {
  return w.census.readers.find((r) => r.reader === reader)!;
}

function t27NoMarker(w: ReturnType<typeof wire>, extra: unknown = null): void {
  const all = JSON.stringify({ v: w.sensorVerdicts, c: w.census, t: w.readerThrows, m: w.readerMargins, x: extra });
  assert.ok(!all.includes(T27_MARKER), "the thrown text reached a seam output");
}

check("T27-1 · CONDITION 1's CONTROL (v4 case (b)): the subject log replaced by a DIRECTORY reads SUBJECT_CHAIN_UNREADABLE — readerThrows EMPTY, PASS_BLIND below a pilot-shaped line, execute true, recorded", () => {
  const dir = scratch("t27-control-dir");
  const asDir = join(dir, "subject-log-is-a-directory");
  mkdirSync(asDir);
  const w = wire({ ...t27AllDeclared(asDir, [LOADED_SUBJECT_CHAIN_VERIFIED], dir), logKind: "subject-chain" });
  assert.ok(w.census.log.includes("loadState=SUBJECT_CHAIN_UNREADABLE"), w.census.log);
  assert.ok(w.sensorVerdicts.length > 0 && w.sensorVerdicts.every((v) => v.kind === "CANNOT_ASSESS"));
  // a non-throw blind filed under MISSING_CONFIGURATION is present, so a hold keyed on the CLASS would hold it
  assert.ok(w.sensorVerdicts.some((v) => v.kind === "CANNOT_ASSESS" && v.blindPaths.some((b) => b.class === "MISSING_CONFIGURATION")));
  assert.deepStrictEqual(w.readerThrows, []);
  const r = w.chokepoint.guard({ id: "t27-control" }, w.sensorVerdicts, T27_BELOW);
  assert.strictEqual(r.disposition, "PASS_BLIND");
  assert.strictEqual(r.execute, true);
  assert.strictEqual(r.recorded, true);
  assert.strictEqual(r.decision.holdReason, null);
});

for (const [reader, modPath, fn] of T27_SEAMS) {
  check(`T27-2 · ${reader}: its step throws -> WIRED AND BLIND with ${SEAM_THREW_CODES[reader]} (class word only), every OTHER reader unchanged, readerThrows names it, HELD below the pilot's line`, () => {
    const dir = scratch(`t27-seam-${fn}`);
    const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
    const opts = t27AllDeclared(logPath, GATE, dir);
    const control = wire({ ...opts, floorTrailPath: join(dir, "trail-c.jsonl"), ledgerPath: join(dir, "ledger-c.jsonl") });
    assert.deepStrictEqual(control.readerThrows, [], "fixture: the control throws nowhere");
    const w = t27Stub(modPath, fn, t27Thrower, () => wire(opts));
    const code = SEAM_THREW_CODES[reader];
    assert.deepStrictEqual(w.readerThrows, [{ reader, code, errorClass: "RangeError" }]);
    const v = w.sensorVerdicts.find((x) => x.sensorId === reader)!;
    assert.strictEqual(v.kind, "CANNOT_ASSESS");
    assert.ok(v.kind === "CANNOT_ASSESS" && v.blindPaths.length === 1 && v.blindPaths[0].class === "MISSING_CONFIGURATION");
    assert.ok(v.kind === "CANNOT_ASSESS" && v.blindPaths[0].detail.startsWith(`${reader} · ${code} (RangeError)`), JSON.stringify(v));
    const row = t27Row(w, reader);
    assert.strictEqual(row.wired, true);
    assert.strictEqual(row.verdictKind, "CANNOT_ASSESS");
    assert.ok(row.source.startsWith(`WIRED AND BLIND — ${code} (RangeError)`), row.source);
    // one entry per reader, in the control's order; every other reader byte-identical
    assert.deepStrictEqual(sensorIds(w), sensorIds(control));
    assert.strictEqual(w.census.readers.length, control.census.readers.length);
    control.sensorVerdicts.forEach((c, i) => {
      if (c.sensorId !== reader) assert.deepStrictEqual(w.sensorVerdicts[i], c, `${c.sensorId} moved when ${reader} threw`);
    });
    t27NoMarker(w);
    if (reader === ENG_READER || reader === SIG_READER) {
      const m = w.readerMargins.find((x) => x.reader === reader)!;
      assert.deepStrictEqual(m.margin, { kind: "NOT_MEASURED", reason: v.kind === "CANNOT_ASSESS" ? `[MISSING_CONFIGURATION] ${v.blindPaths[0].detail}` : "" });
    }
    // no footing for the reader that threw; every other footing as in the control
    assert.ok(!footingsFromWiring(w).some((f) => f.reader === reader), "a thrown reader kept a footing");
    assert.deepStrictEqual(footingsFromWiring(w), footingsFromWiring(control).filter((f) => f.reader !== reader));
    // F6: below the line the same act is HELD; the decision names the reader and the code; no PASS-BLIND record
    const r = w.chokepoint.guard({ id: `t27-${fn}` }, w.sensorVerdicts, T27_BELOW);
    assert.strictEqual(r.execute, false, `an act whose ${reader} threw executed`);
    assert.strictEqual(r.decision.disposition, r.decision.floorKind === "ALARM" ? "HOLD" : "HOLD_BLIND");
    assert.ok(r.decision.rationale.includes(`${reader} · ${code} (RangeError)`), r.decision.rationale);
    assert.strictEqual(r.record, null);
    assert.ok(!existsSync(join(dir, "ledger.jsonl")), "a PASS-BLIND record was written for a held act");
    assert.ok(!JSON.stringify(r.decision).includes(T27_MARKER));
  });
}

check("T27-3 · F6 below the line: a thrown reader on a BLIND floor is HOLD_BLIND + READER_THREW, never PASS_BLIND; the CONTROL (blind, nothing thrown) still passes blind; above the line the 'already held' wording", () => {
  const dir = scratch("t27-f6");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const blind = { ...blindOptions(logPath), line: T27_LINE, floorTrailPath: join(dir, "t.jsonl"), ledgerPath: join(dir, "l.jsonl") };
  const control = wire(blind).chokepoint.guard({ id: "t27-f6-control" }, wire(blind).sensorVerdicts, T27_BELOW);
  assert.strictEqual(control.disposition, "PASS_BLIND");
  assert.strictEqual(control.execute, true);
  const w = t27Stub("../mica/sig", "assessSig", t27Thrower, () => wire({ ...blind, floorTrailPath: join(dir, "t2.jsonl"), ledgerPath: join(dir, "l2.jsonl") }));
  const r = w.chokepoint.guard({ id: "t27-f6" }, w.sensorVerdicts, T27_BELOW);
  assert.strictEqual(r.disposition, "HOLD_BLIND");
  assert.strictEqual(r.execute, false);
  assert.strictEqual(r.decision.blindSplit, "BELOW_LINE");
  assert.strictEqual(r.decision.holdReason, "READER_THREW");
  assert.deepStrictEqual(r.decision.readerThrows, w.readerThrows);
  assert.ok(r.decision.rationale.includes(READER_THREW_HOLDS), r.decision.rationale);
  assert.ok(renderDisposition(r).includes("HOLD REASON: READER_THREW"));
  const a = t27Stub("../mica/sig", "assessSig", t27Thrower, () => wire({ ...blind, floorTrailPath: join(dir, "t3.jsonl"), ledgerPath: join(dir, "l3.jsonl") }));
  const ra = a.chokepoint.guard({ id: "t27-f6-above" }, a.sensorVerdicts, T27_ABOVE);
  assert.strictEqual(ra.disposition, "HOLD_BLIND");
  assert.strictEqual(ra.decision.blindSplit, "ABOVE_LINE");
  assert.ok(ra.decision.rationale.includes("already held by the stakes split"), ra.decision.rationale);
});

check("T27-4 · A THROW NEVER LOWERS: a thrown reader beside an ALARM -> HOLD, every ALARM finding kept, the throw named beside it", () => {
  const dir = scratch("t27-alarm");
  const specs = healthySpecs();
  specs[50].timestamp = T0 - 5_000; // Sig F1 contradiction -> ALARM (the Stage-1 fault)
  const logPath = writeJsonl(dir, "contradicting.jsonl", specs);
  const opts = { ...baseOptions(logPath), line: T27_LINE, floorTrailPath: join(dir, "t.jsonl"), ledgerPath: join(dir, "l.jsonl") };
  const control = wire(opts).chokepoint.guard({ id: "t27-alarm-c" }, wire({ ...opts, floorTrailPath: join(dir, "t0.jsonl") }).sensorVerdicts, T27_BELOW);
  assert.strictEqual(control.disposition, "HOLD");
  const w = t27Stub("../mica/eng", "assessEng", t27Thrower, () => wire({ ...opts, floorTrailPath: join(dir, "t2.jsonl") }));
  const r = w.chokepoint.guard({ id: "t27-alarm" }, w.sensorVerdicts, T27_BELOW);
  assert.strictEqual(r.disposition, "HOLD");
  assert.deepStrictEqual(r.decision.findings, control.decision.findings);
  assert.ok(r.decision.findings.length > 0);
  assert.strictEqual(r.decision.holdReason, null);
  assert.ok(r.decision.rationale.includes(`named beside the ALARM`) && r.decision.rationale.includes("ENG_THREW"), r.decision.rationale);
});

/** The measured escape shape (v3 cond. 11): a sunsetResponses getter throwing a value whose toString throws. */
function t27Gate4Escape(plain: boolean): never {
  const profile = {};
  Object.defineProperty(profile, "sunsetResponses", {
    enumerable: true,
    get: () => {
      if (plain) throw new Error(`${T27_MARKER} plain`);
      throw { toString: (): string => { throw new Error("toString threw"); } };
    },
  });
  return profile as never;
}

check("T27-5 · GATE 4 (wire.ts:2751, v5's omission): the measured ESCAPE shape leaves Gate 4's own catch -> the SEAM's GATE4_THREW, booked and held; CONTROL: a plain Error is caught by Gate 4's OWN net (G4_READER_THREW, class null) — the seam does not pre-empt a net that holds", () => {
  const dir = scratch("t27-gate4");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const base = { ...baseOptions(logPath), line: T27_LINE, floorTrailPath: join(dir, "t.jsonl"), ledgerPath: join(dir, "l.jsonl") };
  let w: ReturnType<typeof wire> | undefined;
  assert.doesNotThrow(() => { w = wire({ ...base, gate4: t27Gate4Escape(false) }); }, "the escape shape left wire()");
  // What escapes is the Error the hostile toString throws while Gate 4's catch renders the value.
  assert.deepStrictEqual(w!.readerThrows, [{ reader: GATE4_READER, code: "GATE4_THREW", errorClass: "Error" }]);
  assert.strictEqual(t27Row(w!, GATE4_READER).verdictKind, "CANNOT_ASSESS");
  assert.strictEqual(w!.chokepoint.guard({ id: "t27-g4" }, w!.sensorVerdicts, T27_BELOW).execute, false);
  const own = wire({ ...base, floorTrailPath: join(dir, "t2.jsonl"), gate4: t27Gate4Escape(true) });
  assert.deepStrictEqual(own.readerThrows, [{ reader: GATE4_READER, code: "G4_READER_THREW", errorClass: null }]);
  const r = own.chokepoint.guard({ id: "t27-g4-own" }, own.sensorVerdicts, T27_BELOW);
  assert.strictEqual(r.execute, false, "Gate 4's own net was booked PASS_BLIND (probe-v3-f6 B0) — F6 must hold it");
  assert.strictEqual(r.decision.holdReason, "READER_THREW");
  assert.ok(!footingsFromWiring(own).some((f) => f.reader === GATE4_READER));
});

check("T27-6 · THE READERS' OWN NETS count (cond. 1 (ii)): Gate 1's frame throwing inside Gate 1's own try -> G1_READER_THREW (class null), no Gate 1 footing, held; its book's ADAPTER throwing -> G1_READER_THREW with the class", () => {
  const dir = scratch("t27-g1");
  const book = writeG1Book(dir);
  const frame = { ...G1_FRAME };
  Object.defineProperty(frame, "categories", { enumerable: true, get: () => { throw new TypeError(T27_MARKER); } });
  const w = wire({ ...g1Options(dir, book), gate1: frame as Gate1ScopeFrame, line: T27_LINE, floorTrailPath: join(dir, "t.jsonl"), ledgerPath: join(dir, "l.jsonl") });
  assert.deepStrictEqual(w.readerThrows, [{ reader: GATE1_READER, code: "G1_READER_THREW", errorClass: null }]);
  assert.ok(w.gate1Log !== null, "fixture: the book's adapter loaded");
  assert.ok(!footingsFromWiring(w).some((f) => f.reader === GATE1_READER), "a reader whose own net caught a throw kept a footing");
  const r = w.chokepoint.guard({ id: "t27-g1" }, w.sensorVerdicts, T27_BELOW);
  assert.strictEqual(r.disposition, "HOLD_BLIND");
  assert.strictEqual(r.decision.holdReason, "READER_THREW");
  // the adapter's throw (M4's bytes)
  const d2 = scratch("t27-g1-adapter");
  const bookPath = join(d2, "interest-book.jsonl");
  const j = new SubjectEventJournal({ path: bookPath });
  assert.ok(j.appendBoundary(null, "fixture", T0).persisted);
  const boundary = JSON.parse(readFileSync(bookPath, "utf8").split("\n")[0]) as { hash: string };
  appendFileSync(bookPath, `{"recordType":"SUBJECT_EVENT","sequenceNumber":1,"previousHash":"${boundary.hash}","timestamp":${String(T0 + 1)},"moduleId":"${G1_SUBJECT}","eventType":"${G1_CLASS_NOW}","outcome":"c-self","hash":"h","extra":${"[".repeat(20000) + "]".repeat(20000)}}\n`);
  const w2 = wire(g1Options(d2, bookPath));
  assert.deepStrictEqual(w2.readerThrows, [{ reader: GATE1_READER, code: "G1_READER_THREW", errorClass: "RangeError" }]);
});

check("T27-7 · CASE (c), REAL BYTES: the SUBJECT LOG's adapter throws (a record nested 20,000 deep) -> wire() returns; every reader declared on it is WIRED AND BLIND with its own seam code; an undeclared one keeps its vacancy; census.log names the adapter, never 'no log path'; HELD", () => {
  const dir = scratch("t27-case-c");
  const logPath = join(dir, "subject-log.jsonl");
  const j = new SubjectEventJournal({ path: logPath });
  assert.ok(j.appendBoundary(null, "fixture: the subject log", T0).persisted);
  const boundary = JSON.parse(readFileSync(logPath, "utf8").split("\n")[0]) as { hash: string };
  appendFileSync(logPath, `{"recordType":"SUBJECT_EVENT","sequenceNumber":1,"previousHash":"${boundary.hash}","timestamp":${String(T0 + 1)},"moduleId":"fixture-subject","eventType":"FIXTURE","outcome":"ok","hash":"h","extra":${"[".repeat(20000) + "]".repeat(20000)}}\n`);
  assert.throws(() => new SubjectChainLog({ path: logPath }), RangeError, "fixture: the adapter must throw on these bytes");
  let w: ReturnType<typeof wire> | undefined;
  const opts: WireOptions = { ...baseOptions(logPath), logKind: "subject-chain", readableLoadStates: [LOADED_SUBJECT_CHAIN_VERIFIED], op1: { attestationClass: { moduleId: "fixture-doctor", eventType: "FIXTURE_ATTESTED" } } as never, line: T27_LINE, floorTrailPath: join(dir, "t.jsonl"), ledgerPath: join(dir, "l.jsonl") };
  assert.doesNotThrow(() => { w = wire(opts); }, "case (c) escaped wire()");
  assert.strictEqual(w!.census.log, logAdapterThrewText("RangeError"));
  assert.ok(!w!.census.log.includes("NOT WIRED"));
  assert.deepStrictEqual(w!.readerThrows, [
    { reader: ENG_READER, code: "ENG_THREW", errorClass: "RangeError" },
    { reader: SIG_READER, code: "SIG_THREW", errorClass: "RangeError" },
    { reader: OP1_READER, code: "OP1_THREW", errorClass: "RangeError" },
  ]);
  for (const reader of [ENG_READER, SIG_READER, OP1_READER]) {
    const row = t27Row(w!, reader);
    assert.strictEqual(row.wired, true);
    assert.ok(row.source.includes("the log's adapter threw before any reader ran"), row.source);
  }
  assert.strictEqual(t27Row(w!, NARROW_K_READER).wired, false, "an undeclared reader is a vacancy, not a throw");
  assert.strictEqual(w!.logFile, null);
  assert.deepStrictEqual(footingsFromWiring(w!), []);
  const r = w!.chokepoint.guard({ id: "t27-c" }, w!.sensorVerdicts, T27_BELOW);
  assert.strictEqual(r.disposition, "HOLD_BLIND");
  assert.strictEqual(r.execute, false);
  t27NoMarker(w!);
  assert.ok(!JSON.stringify(w!.census).includes("Maximum call stack"), "the thrown text must be withheld");
});

check("T27-8 · CASE (a): verify() throws on the SUBJECT LOG only -> wire() returns, census.log is the fixed describe-failed text, every reader on the log is CANNOT_ASSESS, every readerThrows entry is a seam code or an own net, HELD; DESCRIBE ONLY (verify fine) -> every reading equal to the control's and readerThrows EMPTY", () => {
  const dir = scratch("t27-case-a");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const proto = MicaLogFile.prototype as unknown as { verify: (...a: unknown[]) => unknown; describe: (...a: unknown[]) => string };
  const opts = { ...t27AllDeclared(logPath, GATE, dir) };
  const control = wire({ ...opts, floorTrailPath: join(dir, "tc.jsonl"), ledgerPath: join(dir, "lc.jsonl") });
  const origVerify = proto.verify;
  const origDescribe = proto.describe;
  let w: ReturnType<typeof wire> | undefined;
  proto.verify = function (this: { sourcePath: string }, ...a: unknown[]) {
    if (this.sourcePath === logPath) throw new Error(T27_MARKER);
    return origVerify.apply(this, a);
  };
  try {
    assert.doesNotThrow(() => { w = wire(opts); }, "case (a) escaped wire()");
  } finally {
    proto.verify = origVerify;
  }
  assert.strictEqual(w!.census.log, logDescribeThrewText("Error"));
  assert.ok(w!.sensorVerdicts.every((v) => v.kind === "CANNOT_ASSESS"));
  assert.ok(w!.readerThrows.length > 0);
  const allowed = new Set([...Object.values(SEAM_THREW_CODES), ...READER_OWN_NET_CODES]);
  assert.ok(w!.readerThrows.every((t) => allowed.has(t.code)), JSON.stringify(w!.readerThrows));
  assert.strictEqual(w!.chokepoint.guard({ id: "t27-a" }, w!.sensorVerdicts, T27_BELOW).execute, false);
  t27NoMarker(w!);
  // describe() alone throws: a description failure costs no reader its reading, and is not a throw of a reader
  proto.describe = function (this: { sourcePath: string }, ...a: unknown[]) {
    if (this.sourcePath === logPath) throw new Error(T27_MARKER);
    return origDescribe.apply(this, a);
  };
  let d: ReturnType<typeof wire> | undefined;
  try {
    d = wire({ ...opts, floorTrailPath: join(dir, "td.jsonl"), ledgerPath: join(dir, "ld.jsonl") });
  } finally {
    proto.describe = origDescribe;
  }
  assert.deepStrictEqual(d!.sensorVerdicts, control.sensorVerdicts);
  assert.deepStrictEqual(d!.readerMargins, control.readerMargins);
  assert.deepStrictEqual(d!.readerThrows, []);
  assert.strictEqual(d!.census.log, logDescribeThrewText("Error"));
  for (const r of d!.census.readers.filter((x) => x.wired && x.reader !== GATE4_READER)) assert.ok(r.source.startsWith(logDescribeThrewText("Error")), r.source);
  t27NoMarker(d!);
});

check("T27-9 · GATE 2's THREE SEAMS (cond. 4): readGate2Direction stubbed to throw on (h) harm, (k) basket-on-book and (u) basket-on-log -> wire() returns, Gate 2 CANNOT_ASSESS · G2_READER_THREW from the reader's OWN exported constructor, readerThrows names Gate 2 with the class, HELD — no catch calls the reader again", () => {
  // (h)
  const dh = scratch("t27-g2h");
  const bookH = join(dh, "book.jsonl");
  hwBook(bookH, T0, HW_CHANGE);
  let wh: ReturnType<typeof wire> | undefined;
  t27Stub("../mica/gate2-direction", "readGate2Direction", t27Thrower, () => { assert.doesNotThrow(() => { wh = hwWire(dh, bookH, { line: T27_LINE }); }); });
  assert.strictEqual(gate2Of(wh!)!.kind, "CANNOT_ASSESS");
  assert.ok(gate2Of(wh!)!.summary.includes("G2_READER_THREW") || JSON.stringify(gate2Of(wh!)).includes("G2_READER_THREW"));
  assert.deepStrictEqual(wh!.readerThrows, [{ reader: GATE2_READER, code: "G2_READER_THREW", errorClass: "RangeError" }]);
  assert.ok(t27Row(wh!, GATE2_READER).source.includes("THE BOOK'S ADAPTER THREW (RangeError)"));
  assert.strictEqual(wh!.chokepoint.guard({ id: "t27-h" }, wh!.sensorVerdicts, T27_BELOW).execute, false);
  t27NoMarker(wh!);
  // (k)
  const dk = scratch("t27-g2k");
  const bookK = witnessBook(dk, W_ACTS);
  let wk: ReturnType<typeof wire> | undefined;
  t27Stub("../mica/gate2-direction", "readGate2Direction", t27Thrower, () => { assert.doesNotThrow(() => { wk = wire({ ...baseOptions(wLog(dk)), readableLoadStates: G1_STATES, gate2: phaseR(), gate2BookPath: bookK, line: T27_LINE }); }); });
  assert.strictEqual(gate2Of(wk!)!.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(wk!.readerThrows, [{ reader: GATE2_READER, code: "G2_READER_THREW", errorClass: "RangeError" }]);
  t27NoMarker(wk!);
  // (u)
  const du = scratch("t27-g2u");
  let wu: ReturnType<typeof wire> | undefined;
  t27Stub("../mica/gate2-direction", "readGate2Direction", t27Thrower, () => { assert.doesNotThrow(() => { wu = wire({ ...baseOptions(writeJsonl(du, "log.jsonl", healthySpecs())), gate2: g2Basket(), line: T27_LINE }); }); });
  assert.strictEqual(gate2Of(wu!)!.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(wu!.readerThrows, [{ reader: GATE2_READER, code: "G2_READER_THREW", errorClass: "RangeError" }]);
  assert.strictEqual(wu!.chokepoint.guard({ id: "t27-u" }, wu!.sensorVerdicts, T27_BELOW).execute, false);
  t27NoMarker(wu!);
});

check("T27-10 · GATE 2's OWN NET on the log path: a basket whose property throws inside the reader's own try -> G2_READER_THREW, class null, held", () => {
  const dir = scratch("t27-g2own");
  const basket = { ...g2Basket() };
  Object.defineProperty(basket, "value", { enumerable: true, get: () => { throw new Error(T27_MARKER); } });
  const w = wire({ ...baseOptions(writeJsonl(dir, "log.jsonl", healthySpecs())), gate2: basket as Gate2Basket, line: T27_LINE });
  assert.deepStrictEqual(w.readerThrows, [{ reader: GATE2_READER, code: "G2_READER_THREW", errorClass: null }]);
  assert.strictEqual(w.chokepoint.guard({ id: "t27-g2own" }, w.sensorVerdicts, T27_BELOW).execute, false);
});

const T27_AS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;

check("T27-11 · cond. 5: a MODE-000 predecessor is TYPED NOT READABLE, never a throw — beside a standing ALARM the ALARM stands with its findings; without one, CANNOT_ASSESS · G2_PREDECESSOR_NOT_READABLE passes blind below the line (readerThrows EMPTY); a DIRECTORY predecessor is the unchanged control", () => {
  if (T27_AS_ROOT) { console.log("      NOT EXERCISED as uid 0: a mode-000 file is readable by root."); return; }
  // (1) ALARM on the current book, mode-000 predecessor
  const d1 = scratch("t27-pred-alarm");
  const prev1 = join(d1, "book.jsonl.retired-method-fixture");
  hwBook(prev1, T0, [{ seq: 1, fp: HW_FP, observed: "FIRST_SEEN" }]);
  const bytes1 = readFileSync(prev1);
  const book1 = join(d1, "book.jsonl");
  hwBook(book1, T0 + 100, [{ seq: 3, fp: HW_FP, observed: "FIRST_SEEN" }, { seq: 4, fp: HW_FP, observed: "META_DIFFERS" }], { path: prev1, records: 2, bytes: bytes1.length, sha256: hwHash("sha256").update(bytes1).digest("hex") });
  const roster1 = { gate2RosterPath: hwRoster(join(d1, "interest.jsonl"), T0 + 100, [3, 4, 5]), gate2DecidingActionId: "act-5" };
  const readable = gate2Of(hwWire(d1, book1, roster1))!;
  assert.strictEqual(readable.kind, "ALARM", "fixture: the readable chain ALARMS");
  chmodSync(prev1, 0o000);
  try {
    let w: ReturnType<typeof wire> | undefined;
    assert.doesNotThrow(() => { w = hwWire(d1, book1, roster1); });
    const v = gate2Of(w!)!;
    assert.strictEqual(v.kind, "ALARM", "the seam's catch replaced a computable ALARM");
    assert.deepStrictEqual(v.kind === "ALARM" ? v.findings.map((f) => f.code) : [], readable.kind === "ALARM" ? readable.findings.map((f) => f.code) : ["?"]);
    assert.ok(t27Row(w!, GATE2_READER).source.includes("could not be read (Error): NOT READABLE, which is not a throw"), t27Row(w!, GATE2_READER).source);
    assert.deepStrictEqual(w!.readerThrows, []);
  } finally {
    chmodSync(prev1, 0o600);
  }
  // (2) no ALARM, mode-000 predecessor, a pilot-shaped line: typed NOT READABLE, PASS_BLIND, nothing thrown
  const d2 = scratch("t27-pred-quiet");
  const prev2 = join(d2, "book.jsonl.retired-method-fixture");
  hwBook(prev2, T0, [{ seq: 1, fp: HW_FP, observed: "FIRST_SEEN" }]);
  const bytes2 = readFileSync(prev2);
  const book2 = join(d2, "book.jsonl");
  hwBook(book2, T0 + 100, [{ seq: 3, fp: HW_FP, observed: "SAME" }], { path: prev2, records: 2, bytes: bytes2.length, sha256: hwHash("sha256").update(bytes2).digest("hex") });
  chmodSync(prev2, 0o000);
  try {
    const w = hwWire(d2, book2, { gate2RosterPath: hwRoster(join(d2, "interest.jsonl"), T0 + 100, [3, 4]), gate2DecidingActionId: "act-4", line: T27_LINE, floorTrailPath: join(d2, "t.jsonl"), ledgerPath: join(d2, "l.jsonl") });
    const v = gate2Of(w)!;
    assert.strictEqual(v.kind, "CANNOT_ASSESS");
    assert.ok(v.summary.includes("G2_PREDECESSOR_NOT_READABLE"), v.summary.slice(0, 300));
    assert.deepStrictEqual(w.readerThrows, [], "an unreadable book is NOT a throw (the arbiter, 15:37Z)");
    const r = w.chokepoint.guard({ id: "t27-pred" }, w.sensorVerdicts, T27_BELOW);
    assert.strictEqual(r.decision.floorKind, "CANNOT_ASSESS");
    assert.strictEqual(r.disposition, "PASS_BLIND", "the predecessor's NOT READABLE was held as if it threw — the widening by accident");
    assert.strictEqual(r.execute, true);
  } finally {
    chmodSync(prev2, 0o600);
  }
  // (3) the directory control: the walk's not-a-regular-file stub, unchanged
  const d3 = scratch("t27-pred-dir");
  const prev3 = join(d3, "book.jsonl.retired-method-fixture");
  mkdirSync(prev3);
  const book3 = join(d3, "book.jsonl");
  hwBook(book3, T0 + 100, [{ seq: 3, fp: HW_FP, observed: "SAME" }], { path: prev3, records: 1, bytes: 1, sha256: "e".repeat(64) });
  const w3 = hwWire(d3, book3, { gate2RosterPath: hwRoster(join(d3, "interest.jsonl"), T0 + 100, [3, 4]), gate2DecidingActionId: "act-4" });
  assert.ok(t27Row(w3, GATE2_READER).source.includes("it is missing, or not a regular file"));
  assert.ok(gate2Of(w3)!.summary.includes("G2_PREDECESSOR_NOT_READABLE"));
  assert.deepStrictEqual(w3.readerThrows, []);
});

check("T27-12 · BOOKED (cond. 7 via evaluateAndRecord): a thrown reader under a pilot-shaped line -> OK, the DECISION object is HOLD_BLIND, execute false, its rationale names READER_THREW; NO PASSBLIND_PREPARED; two further calls append NO PROJECTION_FAILED; a replay replays", () => {
  const dir = scratch("t27-booked");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const paths = s1Paths(dir);
  const wopts: WireOptions = { ...blindOptions(logPath), line: T27_LINE };
  const reqOf = (actionId: string) => ({ identity: { subject: "fixture-subject-t27", sessionId: "s-t27", actionId }, subject: "fixture-subject-t27", toolName: "fixture-tool", stakesClass: "fixture-low", requestHash: `req-${actionId}` });
  t27Stub("../mica/eng", "assessEng", t27Thrower, () => {
    for (const id of ["t27-b1", "t27-b2", "t27-b3"]) {
      const res = evaluateAndRecord(reqOf(id), paths, wopts, { declarationBinding: UNBOUND });
      assert.strictEqual(res.kind, "OK");
      if (res.kind !== "OK") throw new Error("unreachable");
      assert.strictEqual(res.replayed, false);
      assert.strictEqual(res.decision.disposition, "HOLD_BLIND");
      assert.strictEqual(res.decision.execute, false);
      assert.ok(String(res.decision.rationale).includes("HOLD REASON READER_THREW") && String(res.decision.rationale).includes("ENG_THREW"), String(res.decision.rationale));
      assert.ok(!JSON.stringify(res.decision).includes(T27_MARKER));
    }
    const replay = evaluateAndRecord(reqOf("t27-b1"), paths, wopts, { declarationBinding: UNBOUND });
    assert.ok(replay.kind === "OK" && replay.replayed === true);
  });
  const journal = jsonlRecords(paths.journal);
  assert.ok(!journal.some((r) => r.recordType === "PASSBLIND_PREPARED"), "a PASS-BLIND was prepared for a held act");
  assert.ok(journal.filter((r) => r.recordType === "DECISION_PREPARED").every((r) => JSON.stringify(r).includes("HOLD_BLIND")));
  const events = existsSync(paths.events) ? jsonlRecords(paths.events) : [];
  assert.ok(!events.some((e) => e.kind === "PROJECTION_FAILED"), JSON.stringify(events.filter((e) => e.kind === "PROJECTION_FAILED")));
  assert.ok(!existsSync(paths.ledger) || jsonlRecords(paths.ledger).length === 0, "the real PASS-BLIND ledger received a held act");
});

check("T27-13 · SOURCE FENCE (v3 cond. 15): READER_OWN_NET_CODES equals the set of <X>_READER_THREW literals in src/mica's non-test sources; no seam code ends in READER_THREW", () => {
  const found = new Set<string>();
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "fixtures") walk(p); continue; }
      if (!e.name.endsWith(".ts") || e.name.endsWith(".test.ts")) continue;
      for (const m of readFileSync(p, "utf8").matchAll(/\b([A-Z0-9]+_READER_THREW)\b/g)) found.add(m[1]);
    }
  };
  walk(resolve(__dirname, "../mica"));
  assert.deepStrictEqual([...found].sort(), [...READER_OWN_NET_CODES].sort());
  assert.ok(Object.values(SEAM_THREW_CODES).every((c) => !c.endsWith("READER_THREW")));
});

check("T27-14 · the wiring's readerThrows IS the decision's: the chokepoint holds on the list wire() built, copied (a later push moves nothing)", () => {
  const dir = scratch("t27-same-list");
  const logPath = writeJsonl(dir, "observed.jsonl", healthySpecs());
  const w = t27Stub("../mica/op3-node-response", "assessOp3NodeResponse", t27Thrower, () => wire({ ...t27AllDeclared(logPath, GATE, dir) }));
  (w.readerThrows as ReaderThrow[]).push({ reader: "late", code: "LATE_THREW", errorClass: null });
  const r = w.chokepoint.guard({ id: "t27-same" }, w.sensorVerdicts, T27_BELOW);
  assert.deepStrictEqual(r.decision.readerThrows, [{ reader: OP3_READER, code: "OP3_THREW", errorClass: "RangeError" }]);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
