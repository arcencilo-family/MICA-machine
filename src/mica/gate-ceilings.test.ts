// ── MICA · gate-reader ceiling presence guard ────────────────────────────────
//
// PRESENCE, NEVER CORRECTNESS. This test asserts that each gate reader's named
// ceiling lines APPEAR on all four verdict surfaces. It cannot tell a good
// ceiling from a hollow one: a future gate could satisfy every assertion here
// with lines that say nothing true. Ceiling WORDING is pinned by each
// instrument's own test arms; ceiling HONESTY is judged at adjudication, by a
// reader of the source, never by this file. This test converts "did anyone
// remember to print the limits?" from a per-seat manual check into suite
// property — and converts nothing else.
//
// ⚠ ONE READER MAY DECLARE TWO SURFACES UNREACHABLE (Gate 1, Stop 2): a
// recorder that never yields SILENT or ALARM by design names WHY for each, and
// a sample of its inputs is run here to show neither kind comes out. The other
// readers' entries are unchanged: all four surfaces, produced.

import assert from "assert";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { MicaFixtureLog } from "./fixture-log";
import type { MicaFixtureInput } from "./fixture-log";
import {
  assessGate1Scope,
  GATE1_SCOPE_CEILING_LINES,
  GATE1_SCOPE_SENSOR_ID,
} from "./gate1-scope";
import type { Gate1ScopeConfig, Gate1ScopeFrame } from "./gate1-scope";
import {
  assessGate2Direction,
  GATE2_DIRECTION_CEILING_LINES,
  GATE2_DIRECTION_SENSOR_ID,
  GATE2_HARM_CEILING_LINES,
} from "./gate2-direction";
import type {
  Gate2Basket,
  Gate2DirectionConfig,
  Gate2SignedClass,
} from "./gate2-direction";
import type { MicaLogRecord, MicaReadableLog } from "./log";
import {
  assessGate4Sunset,
  GATE4_SUNSET_CEILING_LINES,
  GATE4_SUNSET_SENSOR_ID,
} from "./gate4-sunset";
import type {
  Gate4EventClass,
  Gate4SunsetConfig,
  Gate4SunsetProfile,
} from "./gate4-sunset";
import {
  assessGate5Adaptive,
  GATE5_ADAPTIVE_CEILING_LINES,
  GATE5_ADAPTIVE_SENSOR_ID,
} from "./gate5-adaptive";
import type {
  Gate5AdaptiveConfig,
  Gate5AdaptiveProfile,
  Gate5EventClass,
  Gate5ExceptionBudget,
} from "./gate5-adaptive";
import type { SensorVerdict } from "./types";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(error as Error).message}`);
    failed++;
  }
}

const MICA_DIR = __dirname;

interface DiscoveredGateReader {
  readonly dirName: string;
  readonly sensorId: string;
}

/**
 * Local sibling of registration.test.ts's D-32 walker. The duplication keeps
 * this fixture-running guard independent of the suite-wiring guard.
 */
function discoveredGateReaders(): DiscoveredGateReader[] {
  const out: DiscoveredGateReader[] = [];
  for (const name of readdirSync(MICA_DIR)) {
    const dir = join(MICA_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    const names = readdirSync(dir);
    if (!names.includes("index.ts")) continue;
    const source = readFileSync(join(dir, "index.ts"), "utf8");
    const match = source.match(/SENSOR_ID\s*=\s*["'](MICA\/gate[^"']+)["']/);
    if (match === null) continue;
    out.push({ dirName: name, sensorId: match[1] });
  }
  return out.sort((left, right) => left.sensorId.localeCompare(right.sensorId));
}

function logOf(specs: readonly MicaFixtureInput[]): MicaFixtureLog {
  const log = new MicaFixtureLog();
  for (const spec of specs) log.append(spec);
  return log;
}

function record(event: { moduleId: string; eventType: string }): MicaFixtureInput {
  return {
    timestamp: 0,
    moduleId: event.moduleId,
    eventType: event.eventType,
    outcome: "recorded",
    actionId: `${event.moduleId}/${event.eventType}`,
  };
}

// ── Gate 1 fixtures ──────────────────────────────────────────────────────────
//
// Gate 1 is an ENVELOPE RECORDER since Stop 2: the label rides on the label
// class's own outcome, and every reading is CANNOT_ASSESS by design.

const G1_FRAME: Gate1ScopeFrame = {
  categories: [
    { id: "g1-self", self: true, derivable: true },
    { id: "g1-a", self: false, derivable: true },
    { id: "g1-b", self: false, derivable: false },
  ],
  labelClass: { moduleId: "subject-a", eventType: "TOOL_ATTEMPTED" },
  underivedWord: "UNDERIVED",
};

function gate1Config(overrides: Partial<Gate1ScopeConfig> = {}): Gate1ScopeConfig {
  return { readableLoadStates: ["IN_MEMORY"], frame: G1_FRAME, ...overrides };
}

/** n label-class records carrying `label` as their outcome. */
function gate1Labels(label: string, n: number): MicaFixtureInput[] {
  return Array.from({ length: n }, () => ({
    timestamp: 0,
    moduleId: G1_FRAME.labelClass.moduleId,
    eventType: G1_FRAME.labelClass.eventType,
    outcome: label,
  }));
}

/**
 * The inputs the gate-1 entry must show yield NEITHER SILENT NOR ALARM. Chosen
 * to be the shapes a count-share reader would have graded: an even spread, a
 * self-only point mass, a single excluded category, nothing labelled at all —
 * and the stopped shapes beside them.
 */
function gate1NeverSample(): SensorVerdict[] {
  const logs: MicaFixtureInput[][] = [
    [],
    [...gate1Labels("g1-self", 3), ...gate1Labels("g1-a", 3), ...gate1Labels("g1-b", 3)],
    gate1Labels("g1-self", 20),
    [...gate1Labels("g1-a", 10), ...gate1Labels("UNDERIVED", 10)],
    gate1Labels("tool-x", 5),
    [record({ moduleId: "subject-b", eventType: "TOOL_ATTEMPTED" })],
  ];
  const configs: Array<Gate1ScopeConfig | undefined> = [
    gate1Config(),
    undefined,
    gate1Config({ readableLoadStates: undefined }),
    gate1Config({ frame: { ...G1_FRAME, categories: [G1_FRAME.categories[0]] } }),
  ];
  const out: SensorVerdict[] = [];
  for (const specs of logs) {
    for (const config of configs) out.push(assessGate1Scope(logOf(specs), config).verdict);
  }
  return out;
}

// ── Gate 2 fixtures ──────────────────────────────────────────────────────────
//
// Gate 2 reads a declared basket as a bound AT GRADE since Stop 2: a value
// class must pass CVG to buy a SILENT, damage must be at or above establishAt
// to ALARM, and nothing is bounded below nMin. One record per class no longer
// reads anything, so each surface below carries enough records to reach it.

const G2_VALUE: Gate2SignedClass = {
  moduleId: "g2-subject",
  eventType: "deliver",
  outcome: null,
  weight: { lo: 1, hi: 1 },
  grade: { lane: "A", eg: 2 },
  rhoCausal: 0.8,
  bearsOn: ["g2-c1"],
};
const G2_DAMAGE: Gate2SignedClass = { ...G2_VALUE, eventType: "land" };

function gate2Basket(overrides: Partial<Gate2Basket> = {}): Gate2Basket {
  return {
    basketClass: "G2_BASKET@00000000000000aa",
    frameCategories: ["g2-c1"],
    value: [G2_VALUE],
    damage: [G2_DAMAGE],
    unknown: [],
    epsilonNum: 1e-6,
    establishAt: { lane: "A", eg: 1 },
    creditAt: { lane: "B", eg: 2 },
    window: { kind: "sinceBoundary" },
    nMin: 3,
    latchClearedBy: [{ moduleId: "g2-operator", eventType: "resolved" }],
    ...overrides,
  };
}

function gate2Config(overrides: Partial<Gate2Basket> = {}): Gate2DirectionConfig {
  return { readableLoadStates: ["IN_MEMORY"], basket: gate2Basket(overrides) };
}

function gate2Records(value: number, damage: number): MicaFixtureInput[] {
  const out: MicaFixtureInput[] = [];
  for (let i = 0; i < value; i++) out.push(record(G2_VALUE));
  for (let i = 0; i < damage; i++) out.push(record(G2_DAMAGE));
  return out;
}

// ── Gate 4 fixtures ──────────────────────────────────────────────────────────

const G4_HOLD: Gate4EventClass = { moduleId: "g4-hold", eventType: "maintain" };
// T26 · the other five roles leg A needs; a partial vocabulary blinds it.
const G4_PRESENTED: Gate4EventClass = { moduleId: "g4-harness", eventType: "presented" };
const G4_ESCALATED: Gate4EventClass = { moduleId: "g4-subject", eventType: "escalated" };
const G4_COMPLIED: Gate4EventClass = { moduleId: "g4-subject", eventType: "complied" };
const G4_RESOLVED: Gate4EventClass = { moduleId: "g4-arbiter", eventType: "resolved" };
const G4_INVOKE: Gate4EventClass = { moduleId: "g4-governance", eventType: "invoke" };
const G4_AUTH: Gate4EventClass = { moduleId: "g4-papers", eventType: "authorize" };
const G4_TIMEBOX: Gate4EventClass = { moduleId: "g4-papers", eventType: "timebox" };
const G4_EXIT: Gate4EventClass = { moduleId: "g4-papers", eventType: "exit" };
const G4_OWNER: Gate4EventClass = { moduleId: "g4-papers", eventType: "owner" };
// T21 · the fifth paper. 08n: lineage continuity is a CONDITION of the warrant.
const G4_SUCCESSOR: Gate4EventClass = { moduleId: "g4-papers", eventType: "successor" };

function gate4Profile(
  overrides: Partial<Gate4SunsetProfile> = {}
): Gate4SunsetProfile {
  return {
    // T26: six declared response roles replace the one-class allow-list.
    sunsetResponses: {
      presented: [G4_PRESENTED],
      held: [G4_HOLD],
      escalated: [G4_ESCALATED],
      complied: [G4_COMPLIED],
      resolved: [G4_RESOLVED],
    },
    warrantForm: {
      invocation: [G4_INVOKE],
      papers: {
        authorization: [G4_AUTH],
        timebox: [G4_TIMEBOX],
        exitCriteria: [G4_EXIT],
        accountableOwner: [G4_OWNER],
        successor: [G4_SUCCESSOR],
      },
    },
    ...overrides,
  };
}

function gate4Config(overrides: Partial<Gate4SunsetConfig> = {}): Gate4SunsetConfig {
  return {
    readableLoadStates: ["IN_MEMORY"],
    profile: gate4Profile(),
    // T26: the window is derived from the record; no fixture declares one.
    paperFreshnessBound: 100,
    ...overrides,
  };
}

// ── Gate 5 fixtures ──────────────────────────────────────────────────────────

const G5_OPEN: Gate5EventClass = { moduleId: "g5-alpha", eventType: "open" };
const G5_RENEW: Gate5EventClass = { moduleId: "g5-alpha", eventType: "renew" };
const G5_CLOSE: Gate5EventClass = { moduleId: "g5-alpha", eventType: "close" };
const G5_SUCCESSION: Gate5EventClass = {
  moduleId: "g5-lineage",
  eventType: "succession",
};
const G5_FILLER: Gate5EventClass = { moduleId: "g5-work", eventType: "step" };

function gate5Profile(
  overrides: Partial<Gate5AdaptiveProfile> = {}
): Gate5AdaptiveProfile {
  return {
    exceptionLifecycle: {
      open: [G5_OPEN],
      renew: [G5_RENEW],
      close: [G5_CLOSE],
    },
    lineage: { successionDeclared: [G5_SUCCESSION] },
    ...overrides,
  };
}

function gate5Budget(
  overrides: Partial<Gate5ExceptionBudget> = {}
): Gate5ExceptionBudget {
  return {
    windowSteps: 100,
    maxSpanSteps: 20,
    maxConsecutiveRenewals: 2,
    cumulativeBudgetSteps: 80,
    coolingOffSteps: 0,
    maxInvocationsPerWindow: 10,
    ...overrides,
  };
}

function gate5Config(
  overrides: Partial<Gate5AdaptiveConfig> = {}
): Gate5AdaptiveConfig {
  return {
    readableLoadStates: ["IN_MEMORY"],
    profile: gate5Profile(),
    exceptionBudget: gate5Budget(),
    nearExhaustionFraction: 0.75,
    ...overrides,
  };
}

type SurfaceName = "silent" | "alarmed" | "blind" | "composite";
type UnreachableSurface = "silent" | "alarmed";

interface RegistryEntryBase {
  readonly dirName: string;
  readonly sensorId: string;
  readonly ceilingLines: readonly string[];
}

/** The default, and every alarm-capable reader's: all four surfaces produced. */
interface FourSurfaceEntry extends RegistryEntryBase {
  readonly surfaces: Record<SurfaceName, () => SensorVerdict>;
  readonly unreachable?: undefined;
}

/**
 * A reader that cannot produce SILENT or ALARM BY DESIGN (Gate 1 since Stop 2:
 * a recorder whose property is unread by conduct). ⛔ It does not get to skip
 * the two surfaces quietly: it must NAME why each is unreachable, and it must
 * hand over a sample of inputs that this file runs to show neither kind comes
 * out. ⚠ A sample is not a proof — the reader's own property arm carries the
 * wider sweep; this is the presence guard's share of it.
 */
interface RecorderEntry extends RegistryEntryBase {
  readonly surfaces: Record<Exclude<SurfaceName, UnreachableSurface>, () => SensorVerdict>;
  readonly unreachable: Readonly<Record<UnreachableSurface, string>>;
  readonly neverSample: () => readonly SensorVerdict[];
}

type GateCeilingRegistryEntry = FourSurfaceEntry | RecorderEntry;

const EXPECTED_KINDS: Readonly<Record<SurfaceName, SensorVerdict["kind"]>> = {
  silent: "SILENT",
  alarmed: "ALARM",
  blind: "CANNOT_ASSESS",
  composite: "CANNOT_ASSESS",
};

const SURFACE_NAMES: readonly SurfaceName[] = [
  "silent",
  "alarmed",
  "blind",
  "composite",
];

const GATE_REGISTRY: readonly GateCeilingRegistryEntry[] = [
  {
    dirName: "gate1-scope",
    sensorId: GATE1_SCOPE_SENSOR_ID,
    ceilingLines: GATE1_SCOPE_CEILING_LINES,
    unreachable: {
      silent:
        "A recorder of attempted exposure cannot read the gate's property (weight revealed under cost, 03b §2), " +
        "so it has no clean reading to give: a SILENT here would turn an envelope into a pass.",
      alarmed:
        "Touch is not weight (03b §2: weight is revealed under cost; a count of touches carries none): every " +
        "count-share alarm read touch counts as weight and would have alarmed on ordinary work, so the alarm " +
        "legs were removed at Stop 1, not repaired.",
    },
    neverSample: gate1NeverSample,
    surfaces: {
      blind: () => assessGate1Scope(logOf([])).verdict,
      // The composite is a READ: both always-on legs, envelope and weight, blind
      // together beside a stated envelope.
      composite: () => {
        const result = assessGate1Scope(
          logOf([...gate1Labels("g1-self", 2), ...gate1Labels("g1-a", 1)]),
          gate1Config()
        );
        assert.deepStrictEqual(result.blindReasonCodes, ["G1_ENVELOPE_ONLY", "G1_WEIGHT_NOT_READ_BY_CONDUCT"]);
        assert.deepStrictEqual(result.coverage, { reached: 2, ofM: 3 });
        return result.verdict;
      },
    },
  },
  {
    dirName: "gate2-direction",
    sensorId: GATE2_DIRECTION_SENSOR_ID,
    ceilingLines: GATE2_DIRECTION_CEILING_LINES,
    surfaces: {
      // value at grade (passing CVG) dominant: LB above ε
      silent: () => assessGate2Direction(logOf(gate2Records(4, 1)), gate2Config()),
      // damage at grade accumulating: the bound at grade is non-positive
      alarmed: () => assessGate2Direction(logOf(gate2Records(1, 3)), gate2Config()),
      blind: () => assessGate2Direction(logOf([])),
      // A READ that cannot decide: the record is read, the recorder printed,
      // and value failing CVG leaves the interval straddling zero.
      composite: () =>
        assessGate2Direction(
          logOf(gate2Records(4, 1)),
          gate2Config({ value: [{ ...G2_VALUE, grade: { lane: "A", eg: 1 } }] })
        ),
    },
  },
  {
    dirName: "gate4-sunset",
    sensorId: GATE4_SUNSET_SENSOR_ID,
    ceilingLines: GATE4_SUNSET_CEILING_LINES,
    surfaces: {
      // T26: a SILENT COMPOSITE needs both legs reading clean — leg A an order
      // that was presented, answered and closed, and leg B the five papers BEFORE
      // the order. An order with no paperwork alarms leg B and floors this surface.
      silent: () =>
        assessGate4Sunset(
          logOf([
            record(G4_AUTH), record(G4_TIMEBOX), record(G4_EXIT), record(G4_OWNER), record(G4_SUCCESSOR),
            record(G4_INVOKE), record(G4_PRESENTED), record(G4_HOLD), record(G4_RESOLVED),
          ]),
          gate4Config()
        ).verdict,
      // THE ONE RULE: leg A has no alarm at all, and leg B alarms only while the
      // latest order is OPEN. Four papers, not five, and NO resolution — a
      // resolved malformed order is printed history, not an alarm.
      alarmed: () =>
        assessGate4Sunset(
          logOf([
            record(G4_AUTH), record(G4_TIMEBOX), record(G4_EXIT), record(G4_OWNER),
            record(G4_INVOKE), record(G4_PRESENTED), record(G4_HOLD),
          ]),
          gate4Config()
        ).verdict,
      blind: () => assessGate4Sunset(logOf([])).verdict,
      composite: () => {
        // ⛔ R2 · A HALF-DECLARED PROFILE NO LONGER GIVES A MIXED COMPOSITE: a
        //    fault blinds BOTH legs, so the predecessor (an empty `presented`)
        //    now yields CANNOT_ASSESS on both. A genuine mix needs a RECORD
        //    reason, not a config one: no order at all means leg A has no window
        //    to read while leg B truthfully reads "nothing was invoked".
        const result = assessGate4Sunset(logOf([record(G4_AUTH)]), gate4Config());
        assert.strictEqual(result.hold.verdict.kind, "CANNOT_ASSESS");
        assert.strictEqual(result.warrant.verdict.kind, "SILENT");
        return result.verdict;
      },
    },
  },
  {
    dirName: "gate5-adaptive",
    sensorId: GATE5_ADAPTIVE_SENSOR_ID,
    ceilingLines: GATE5_ADAPTIVE_CEILING_LINES,
    surfaces: {
      silent: () => assessGate5Adaptive(logOf([]), gate5Config()).verdict,
      alarmed: () =>
        assessGate5Adaptive(
          logOf([
            record(G5_OPEN),
            record(G5_FILLER),
            record(G5_FILLER),
            record(G5_CLOSE),
          ]),
          gate5Config({ exceptionBudget: gate5Budget({ maxSpanSteps: 2 }) })
        ).verdict,
      blind: () => assessGate5Adaptive(logOf([])).verdict,
      composite: () => {
        const result = assessGate5Adaptive(
          logOf([]),
          gate5Config({
            profile: gate5Profile({
              lineage: { successionDeclared: [] },
            }),
          })
        );
        assert.strictEqual(result.budget.verdict.kind, "SILENT");
        assert.strictEqual(result.lineage.verdict.kind, "CANNOT_ASSESS");
        return result.verdict;
      },
    },
  },
];

console.log("\nMICA — gate-reader ceiling presence guard\n");

check("every discovered gate reader has a ceiling registry entry", () => {
  const discovered = discoveredGateReaders();
  const registered = GATE_REGISTRY.map(({ dirName, sensorId }) => ({
    dirName,
    sensorId,
  })).sort((left, right) => left.sensorId.localeCompare(right.sensorId));
  assert.deepStrictEqual(
    discovered,
    registered,
    "Gate reader discovery and GATE_REGISTRY differ. Add a registry entry with SILENT, " +
      "ALARM, blind, and mixed-kind composite fixtures for every new gate reader."
  );
});

check("every registry entry accounts for all four surfaces: produced, or unreachable with a reason", () => {
  let recorders = 0;
  for (const entry of GATE_REGISTRY) {
    const produced = Object.keys(entry.surfaces);
    const unreachable = entry.unreachable === undefined ? [] : Object.keys(entry.unreachable);
    if (entry.unreachable !== undefined) recorders++;
    assert.deepStrictEqual(
      [...produced, ...unreachable].sort(),
      [...SURFACE_NAMES].sort(),
      `${entry.sensorId}: produced [${produced.join(", ")}] + unreachable [${unreachable.join(", ")}] ` +
        "must be the four surfaces, each exactly once"
    );
  }
  // ⚠ The exemption is for gate 1 alone today; a second reader taking it is a
  //   ruling, not a registry edit.
  assert.strictEqual(recorders, 1, `${recorders} entries declare unreachable surfaces`);
});

for (const entry of GATE_REGISTRY) {
  check(`${entry.sensorId} declares non-empty base ceiling lines`, () => {
    assert.ok(entry.ceilingLines.length > 0, "ceilingLines must not be empty");
    for (const line of entry.ceilingLines) {
      assert.strictEqual(typeof line, "string");
      assert.ok(line.trim().length > 0, "ceiling line must be a non-empty trimmed string");
      assert.strictEqual(line, line.trim(), `ceiling line has edge whitespace: ${line}`);
    }
  });

  if (entry.unreachable !== undefined) {
    const recorder = entry;
    check(`${entry.sensorId} names a reason for each unreachable surface`, () => {
      for (const surfaceName of ["silent", "alarmed"] as const) {
        const reason = recorder.unreachable[surfaceName];
        assert.strictEqual(typeof reason, "string", surfaceName);
        assert.ok(reason.trim().length > 0, `${surfaceName}: empty reason`);
      }
    });
    check(`${entry.sensorId} yields neither SILENT nor ALARM on its sample, and prints every ceiling`, () => {
      const sample = recorder.neverSample();
      assert.ok(sample.length >= SURFACE_NAMES.length, `a sample of ${sample.length} proves little`);
      for (const [index, verdict] of sample.entries()) {
        assert.strictEqual(verdict.sensorId, entry.sensorId);
        assert.ok(
          verdict.kind !== "SILENT" && verdict.kind !== "ALARM",
          `${entry.sensorId} sample #${index} yielded ${verdict.kind}`
        );
        for (const line of entry.ceilingLines) {
          assert.ok(verdict.summary.includes(line), `sample #${index} omitted ceiling: ${line}`);
        }
      }
    });
  }

  for (const surfaceName of SURFACE_NAMES) {
    const produce = (entry.surfaces as Partial<Record<SurfaceName, () => SensorVerdict>>)[surfaceName];
    if (produce === undefined) continue; // accounted for above, by the four-surface arm
    check(`${entry.sensorId} prints every base ceiling on ${surfaceName}`, () => {
      const verdict = produce();
      assert.strictEqual(verdict.sensorId, entry.sensorId);
      assert.strictEqual(verdict.kind, EXPECTED_KINDS[surfaceName]);
      for (const line of entry.ceilingLines) {
        assert.ok(
          verdict.summary.includes(line),
          `${entry.sensorId} ${surfaceName} omitted ceiling: ${line}`
        );
      }
    });
  }
}

// ── Gate 2's HARM BRANCH (T31/T32): one reader directory, a second frozen list ──
//
// The harm branch lives in gate2-direction/index.ts, so discovery finds one reader and the registry above keeps
// one entry. Its own list (GATE2_HARM_CEILING_LINES) is held to the same rule here: every line on all four
// surfaces. Fixture names only: subject-g, item g-item, origin g-o.

const G2H_AT = 1000;

function g2hBook(observed: readonly string[]): MicaReadableLog {
  const records: Record<string, unknown>[] = [
    { recordType: "SUBJECT_LOG_BOUNDARY", sequenceNumber: 0, timestamp: G2H_AT, moduleId: "g-witness", eventType: "SUBJECT_LOG_BOUNDARY", outcome: "b" },
  ];
  observed.forEach((facet, i) =>
    records.push({
      sequenceNumber: i + 1, timestamp: G2H_AT + i + 1, moduleId: "subject-g", eventType: "CONSEQUENCE@g-class",
      outcome: `g1:${facet}`, actionId: `g-act-${i + 1}`, hash: String(i + 1).padStart(64, "0"),
      witnessed: { cites: { subjectSeq: i + 1, targetFingerprint: "g-fp" }, fate: "RAN", observed: facet },
    })
  );
  return { verify: () => ({ valid: true }), getLoadState: () => "IN_MEMORY", getAll: () => records as unknown as readonly MicaLogRecord[] };
}

function g2hConfig(seqs: readonly number[], deciding: string | null): Gate2DirectionConfig {
  return {
    readableLoadStates: ["IN_MEMORY"],
    harm: {
      harmClass: "G2_HARM@00000000000000bb",
      origins: [{ id: "g-o", subject: "subject-g" }],
      items: [{ id: "g-item", category: "g1", control: false, fingerprint: "g-fp" }],
      grants: { "g-item": [] },
      grantSince: { "g-item": {} },
      // AMENDED (S216-2): the grant memory the bridge now sends (a fixture tag).
      grantMemory: { tag: "G2_GRANT_MEMORY@00000000000000bb", state: "BEGUN" },
      errandGrants: [],
      clearances: [],
      saltEpochSince: 0,
    },
    roster: seqs.map((n) => ({ subjectSeq: n, actionId: `g-act-${n}`, label: "g1", timestamp: G2H_AT + n })),
    decidingActionId: deciding,
    predecessors: [],
    bookBoundaryAt: G2H_AT,
  };
}

const G2_HARM_SURFACES: Readonly<Record<SurfaceName, () => SensorVerdict>> = {
  silent: () => assessGate2Direction(g2hBook(["FIRST_SEEN"]), g2hConfig([1, 2], "g-act-2")),
  alarmed: () => assessGate2Direction(g2hBook(["FIRST_SEEN", "CONTENT_DIFFERS"]), g2hConfig([1, 2, 3], "g-act-3")),
  blind: () => assessGate2Direction(g2hBook([]), { ...g2hConfig([], null), roster: null }),
  // A READ that cannot decide: the record is read and printed, and an UNOBSERVABLE look on the item is an unknown.
  composite: () => assessGate2Direction(g2hBook(["UNOBSERVABLE"]), g2hConfig([1, 2], "g-act-2")),
};

for (const surfaceName of SURFACE_NAMES) {
  check(`${GATE2_DIRECTION_SENSOR_ID} (harm branch) prints every HARM ceiling on ${surfaceName}`, () => {
    const verdict = G2_HARM_SURFACES[surfaceName]();
    assert.strictEqual(verdict.sensorId, GATE2_DIRECTION_SENSOR_ID);
    assert.strictEqual(verdict.kind, EXPECTED_KINDS[surfaceName], verdict.summary.slice(0, 300));
    for (const line of GATE2_HARM_CEILING_LINES) {
      assert.ok(verdict.summary.includes(line), `harm ${surfaceName} omitted ceiling: ${line}`);
    }
  });
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
