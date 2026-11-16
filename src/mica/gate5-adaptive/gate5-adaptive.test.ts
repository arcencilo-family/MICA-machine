import assert from "assert";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Chokepoint } from "../chokepoint";
import { ENG_SENSOR_ID } from "../eng";
import { MicaFixtureLog } from "../fixture-log";
import type { MicaFixtureInput } from "../fixture-log";
import { GATE1_SCOPE_SENSOR_ID } from "../gate1-scope";
import { GATE4_SUNSET_SENSOR_ID } from "../gate4-sunset";
import { NARROW_K_SENSOR_ID } from "../narrow-k";
import { NARROW_R_SENSOR_ID } from "../narrow-r";
import { NARROW_T_SENSOR_ID } from "../narrow-t";
import { NARROW_W_SENSOR_ID } from "../narrow-w";
import { SIG_SENSOR_ID } from "../sig";
import { silent } from "../types";
import type { AlarmVerdict, CannotAssessVerdict, SensorVerdict } from "../types";
import {
  assessGate5Adaptive,
  GATE5_ADAPTIVE_CEILING_LINES,
  GATE5_ADAPTIVE_ORDER_ONLY_LINEAGE_CEILING,
  GATE5_ADAPTIVE_SENSOR_ID,
  GATE5_HOUSE_PROXY_BUDGET,
  GATE5_HOUSE_PROXY_NEAR_EXHAUSTION_FRACTION,
  gate5AdaptiveScopeBlockText,
} from "./index";
import type {
  Gate5AdaptiveConfig,
  Gate5AdaptiveProfile,
  Gate5EventClass,
  Gate5ExceptionBudget,
} from "./index";

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

const OPEN: Gate5EventClass = { moduleId: "alpha", eventType: "exception-open" };
const BETA_OPEN: Gate5EventClass = { moduleId: "beta", eventType: "exception-open" };
const RENEW: Gate5EventClass = { moduleId: "alpha", eventType: "exception-renew" };
const CLOSE: Gate5EventClass = { moduleId: "alpha", eventType: "exception-close" };
const SUCCESSION: Gate5EventClass = {
  moduleId: "lineage",
  eventType: "succession-declared",
};
const FILLER: Gate5EventClass = { moduleId: "work", eventType: "ordinary-step" };
const OVERLAPPING_OPENS_SHARE_A_CLOSE_CEILING =
  "OVERLAPPING OPENS SHARE A CLOSE: each open pairs with the next higher-sequence close, so concurrent or nested exceptions can pair several opens onto one close and leave a later close unpaired. Under overlap this reader can read SILENT where an order-disciplined pairing would breach. It reads one lifecycle stream and models no concurrency; the record declares no open-to-close binding.";

const profile = (
  overrides: Partial<Gate5AdaptiveProfile> = {}
): Gate5AdaptiveProfile => ({
  exceptionLifecycle: { open: [OPEN, BETA_OPEN], renew: [RENEW], close: [CLOSE] },
  lineage: { successionDeclared: [SUCCESSION] },
  ...overrides,
});

const compactBudget = (
  overrides: Partial<Gate5ExceptionBudget> = {}
): Gate5ExceptionBudget => ({
  windowSteps: 100,
  maxSpanSteps: 20,
  maxConsecutiveRenewals: 2,
  cumulativeBudgetSteps: 80,
  coolingOffSteps: 0,
  maxInvocationsPerWindow: 10,
  ...overrides,
});

const baseConfig = (
  overrides: Partial<Gate5AdaptiveConfig> = {}
): Gate5AdaptiveConfig => ({
  readableLoadStates: ["IN_MEMORY"],
  profile: profile(),
  exceptionBudget: compactBudget(),
  nearExhaustionFraction: 0.75,
  ...overrides,
});

function record(
  event: Gate5EventClass,
  timestamp = 0
): MicaFixtureInput {
  return {
    timestamp,
    moduleId: event.moduleId,
    eventType: event.eventType,
    outcome: "recorded",
  };
}

function logOf(specs: readonly MicaFixtureInput[]): MicaFixtureLog {
  const log = new MicaFixtureLog();
  for (const spec of specs) log.append(spec);
  return log;
}

function fillers(count: number, timestamp = 0): MicaFixtureInput[] {
  return Array.from({ length: count }, (_, index) =>
    record({ moduleId: FILLER.moduleId, eventType: `${FILLER.eventType}-${index}` }, timestamp)
  );
}

type Gate5Result = ReturnType<typeof assessGate5Adaptive>;

function findingsOf(result: Gate5Result): readonly { code: string; detail: string }[] {
  assert.strictEqual(result.budget.verdict.kind, "ALARM");
  return (result.budget.verdict as AlarmVerdict).findings;
}

function assertOneBudgetBreach(result: Gate5Result, feature: RegExp): void {
  const findings = findingsOf(result);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].code, "G5_EXCEPTION_BUDGET_BREACH");
  assert.match(findings[0].detail, feature);
  assert.match(findings[0].detail, /injected/i);
  assert.match(findings[0].detail, /sequence/i);
  assert.match(findings[0].detail, /open/i);
  assert.match(findings[0].detail, /close/i);
  assert.match(findings[0].detail, /measured|count|length|steps|gap/i);
  assert.match(findings[0].detail, /bound|cap|maximum|minimum/i);
}

function assertBaseCeilings(verdict: SensorVerdict): void {
  for (const ceiling of GATE5_ADAPTIVE_CEILING_LINES) {
    assert.ok(verdict.summary.includes(ceiling), `missing ceiling: ${ceiling}`);
  }
}

console.log("\nMICA — Gate 5 adaptive exception-throttle reader\n");

check("house proxy keeps both translated BTB identities and all ruled values", () => {
  assert.deepStrictEqual(GATE5_HOUSE_PROXY_BUDGET, {
    windowSteps: 4000,
    maxSpanSteps: 1000,
    maxConsecutiveRenewals: 2,
    cumulativeBudgetSteps: 3000,
    coolingOffSteps: 1000,
    maxInvocationsPerWindow: 1,
  });
  assert.strictEqual(
    GATE5_HOUSE_PROXY_BUDGET.cumulativeBudgetSteps,
    GATE5_HOUSE_PROXY_BUDGET.maxSpanSteps *
      (1 + GATE5_HOUSE_PROXY_BUDGET.maxConsecutiveRenewals)
  );
  assert.strictEqual(
    GATE5_HOUSE_PROXY_BUDGET.windowSteps,
    GATE5_HOUSE_PROXY_BUDGET.cumulativeBudgetSteps +
      GATE5_HOUSE_PROXY_BUDGET.coolingOffSteps
  );
  assert.strictEqual(GATE5_HOUSE_PROXY_NEAR_EXHAUSTION_FRACTION, 0.75);
});

check("injected budgets need not preserve the house identities", () => {
  const nonIdentityBudget = compactBudget({
    windowSteps: 17,
    maxSpanSteps: 5,
    maxConsecutiveRenewals: 1,
    cumulativeBudgetSteps: 13,
    coolingOffSteps: 2,
  });
  const result = assessGate5Adaptive(
    logOf([]),
    baseConfig({ exceptionBudget: nonIdentityBudget })
  );
  assert.strictEqual(result.budget.verdict.kind, "SILENT");
});

check("span boundary: length 3 is SILENT; length 4 breaches injected max 3", () => {
  const config = baseConfig({
    exceptionBudget: compactBudget({ maxSpanSteps: 3, maxConsecutiveRenewals: 0 }),
  });
  // open=0, close=3 => spanLength=3, exactly on the injected bound.
  const exact = assessGate5Adaptive(
    logOf([record(OPEN), ...fillers(2), record(CLOSE)]),
    config
  );
  assert.strictEqual(exact.budget.verdict.kind, "SILENT");

  // open=0, close=4 => spanLength=4, exactly one step over the injected bound.
  const over = assessGate5Adaptive(
    logOf([record(OPEN), ...fillers(3), record(CLOSE)]),
    config
  );
  assertOneBudgetBreach(over, /span/i);
});

check("renewal boundary: one renewal is SILENT; two breach injected cap 1", () => {
  const config = baseConfig({
    exceptionBudget: compactBudget({
      maxSpanSteps: 100,
      maxConsecutiveRenewals: 1,
    }),
  });
  const exact = assessGate5Adaptive(
    logOf([record(OPEN), record(RENEW), record(CLOSE)]),
    config
  );
  assert.strictEqual(exact.budget.verdict.kind, "SILENT");

  const over = assessGate5Adaptive(
    logOf([record(OPEN), record(RENEW), record(RENEW), record(CLOSE)]),
    config
  );
  assertOneBudgetBreach(over, /renewal/i);
});

check("invocation boundary: two opens are SILENT; the third in-window open breaches cap 2", () => {
  const config = baseConfig({
    exceptionBudget: compactBudget({
      windowSteps: 20,
      maxInvocationsPerWindow: 2,
    }),
  });
  // Two open events in the same trailing 20-step window exactly meet the cap.
  const exact = assessGate5Adaptive(
    logOf([record(OPEN), record(CLOSE), record(OPEN), record(CLOSE)]),
    config
  );
  assert.strictEqual(exact.budget.verdict.kind, "SILENT");

  // The third open is count=3, exactly one invocation over the injected cap.
  const over = assessGate5Adaptive(
    logOf([
      record(OPEN),
      record(CLOSE),
      record(OPEN),
      record(CLOSE),
      record(OPEN),
      record(CLOSE),
    ]),
    config
  );
  assertOneBudgetBreach(over, /invocation/i);
  assert.ok(
    findingsOf(over)[0].detail.includes("span(open=4, close=5)"),
    "invocation finding must name the third invocation's actual paired close=5"
  );
});

check("cumulative boundary: three active steps are SILENT; four breach cap 3", () => {
  const config = baseConfig({
    exceptionBudget: compactBudget({
      maxSpanSteps: 100,
      cumulativeBudgetSteps: 3,
    }),
  });
  // open=0, close=3 => three active sequence-steps, exactly on the cap.
  const exact = assessGate5Adaptive(
    logOf([record(OPEN), ...fillers(2), record(CLOSE)]),
    config
  );
  assert.strictEqual(exact.budget.verdict.kind, "SILENT");

  // open=0, close=4 => four active sequence-steps, exactly one over the cap.
  const over = assessGate5Adaptive(
    logOf([record(OPEN), ...fillers(3), record(CLOSE)]),
    config
  );
  assertOneBudgetBreach(over, /cumulative/i);
});

check("cooling boundary: gap 2 is SILENT; gap 1 breaches injected minimum 2", () => {
  const config = baseConfig({
    exceptionBudget: compactBudget({ coolingOffSteps: 2 }),
  });
  // close=1, next open=3 => gap=2, exactly on the injected minimum.
  const exact = assessGate5Adaptive(
    logOf([record(OPEN), record(CLOSE), record(FILLER), record(OPEN)]),
    config
  );
  assert.strictEqual(exact.budget.verdict.kind, "SILENT");

  // close=1, next open=2 => gap=1, exactly one below the injected minimum.
  const over = assessGate5Adaptive(
    logOf([record(OPEN), record(CLOSE), record(OPEN)]),
    config
  );
  assertOneBudgetBreach(over, /cooling/i);
});

check("open-ended span legally extends to record end", () => {
  const result = assessGate5Adaptive(
    // open=0, record end=3 => legal open-ended spanLength=3 at the bound.
    logOf([record(OPEN), ...fillers(3)]),
    baseConfig({
      exceptionBudget: compactBudget({
        maxSpanSteps: 3,
        maxConsecutiveRenewals: 0,
      }),
    })
  );
  assert.strictEqual(result.budget.verdict.kind, "SILENT");
  assert.match(result.budget.verdict.summary, /open-ended|record end/i);
});

check("known limit: overlapping opens share one close, masking a long span as SILENT and saying so", () => {
  // seq 1=open(alpha), seq 2=open(beta), seq 3=close, seq 4..99=filler,
  // seq 100=close. Next-close pairing makes spans [1,3] and [2,3]; FIFO or
  // LIFO pairing would leave one span open through seq 100 and breach 50.
  const result = assessGate5Adaptive(
    logOf([
      record(FILLER),
      record(OPEN),
      record(BETA_OPEN),
      record(CLOSE),
      ...fillers(96),
      record(CLOSE),
    ]),
    baseConfig({
      exceptionBudget: compactBudget({
        windowSteps: 200,
        maxSpanSteps: 50,
        maxConsecutiveRenewals: 0,
        cumulativeBudgetSteps: 1_000,
        coolingOffSteps: 0,
        maxInvocationsPerWindow: 10,
      }),
    })
  );
  assert.strictEqual(result.budget.recordsExamined, 2);
  assert.strictEqual(result.budget.verdict.kind, "SILENT");
  assert.strictEqual(result.verdict.kind, "SILENT");
  assert.ok(result.budget.verdict.summary.includes("Leg A read 2 declared exception invocation span(s)"));
  assert.ok(result.budget.verdict.summary.includes(OVERLAPPING_OPENS_SHARE_A_CLOSE_CEILING));
});

check("renewal extends one span and never counts as another invocation", () => {
  const result = assessGate5Adaptive(
    // open=0, renew=1, close=4: length 4 equals 2*(1+1); open count remains 1.
    logOf([record(OPEN), record(RENEW), ...fillers(2), record(CLOSE)]),
    baseConfig({
      exceptionBudget: compactBudget({
        maxSpanSteps: 2,
        maxConsecutiveRenewals: 1,
        maxInvocationsPerWindow: 1,
      }),
    })
  );
  assert.strictEqual(result.budget.verdict.kind, "SILENT");
});

check("all five simultaneous budget breaches are collected non-compensatorily", () => {
  const result = assessGate5Adaptive(
    logOf([
      record(OPEN),       // 0
      record(RENEW),      // 1
      record(RENEW),      // 2: renewal count 2 > 1
      ...fillers(5),      // 3..7
      record(CLOSE),      // 8: span 8 > 2*(1+1)=4
      record(OPEN),       // 9: second invocation; cooling gap 1 < 2
      record(CLOSE),      // 10; cumulative active steps also > 3
    ]),
    baseConfig({
      exceptionBudget: {
        windowSteps: 20,
        maxSpanSteps: 2,
        maxConsecutiveRenewals: 1,
        cumulativeBudgetSteps: 3,
        coolingOffSteps: 2,
        maxInvocationsPerWindow: 1,
      },
    })
  );
  const findings = findingsOf(result);
  assert.strictEqual(findings.length, 5);
  assert.ok(findings.every((finding) => finding.code === "G5_EXCEPTION_BUDGET_BREACH"));
  assert.ok(findings.every((finding) => /injected/i.test(finding.detail)));
  const detail = findings.map((finding) => finding.detail).join("\n");
  for (const feature of [/span/i, /renewal/i, /invocation/i, /cumulative/i, /cooling/i]) {
    assert.match(detail, feature);
  }
});

check("no open events is a real SILENT read: not bending the rule is the point", () => {
  const result = assessGate5Adaptive(
    logOf([record(RENEW), record(CLOSE), record(FILLER)]),
    baseConfig()
  );
  assert.strictEqual(result.budget.verdict.kind, "SILENT");
  assert.ok(
    result.budget.verdict.summary.includes("not bending the rule is the point")
  );
  assert.strictEqual(result.budget.recordsExamined, 0);
});

check("fresh module after near-exhaustion without succession -> lineage ALARM", () => {
  const result = assessGate5Adaptive(
    // alpha consumes 3 steps in [0,3]; 3 >= 0.75 * cumulative bound 4.
    logOf([
      record(OPEN),
      ...fillers(2),
      record(CLOSE),
      record(BETA_OPEN),
    ]),
    baseConfig({
      exceptionBudget: compactBudget({
        windowSteps: 20,
        maxSpanSteps: 100,
        cumulativeBudgetSteps: 4,
      }),
    })
  );
  assert.strictEqual(result.lineage.verdict.kind, "ALARM");
  const finding = (result.lineage.verdict as AlarmVerdict).findings[0];
  assert.strictEqual(finding.code, "G5_LINEAGE_DISCONTINUITY");
  assert.match(finding.detail, /cannot be asserted/i);
  assert.match(finding.detail, /alpha/i);
  assert.match(finding.detail, /beta/i);
});

check("declared succession before a fresh module keeps lineage SILENT", () => {
  const result = assessGate5Adaptive(
    logOf([
      record(OPEN),
      ...fillers(2),
      record(CLOSE),
      record(SUCCESSION),
      record(BETA_OPEN),
    ]),
    baseConfig({
      exceptionBudget: compactBudget({
        windowSteps: 20,
        maxSpanSteps: 100,
        cumulativeBudgetSteps: 4,
      }),
    })
  );
  assert.strictEqual(result.lineage.verdict.kind, "SILENT");
});

check("absent exhaustion threshold uses order-only mode and prints its louder ceiling", () => {
  const result = assessGate5Adaptive(
    logOf([record(OPEN), record(CLOSE), record(BETA_OPEN)]),
    baseConfig({ nearExhaustionFraction: undefined })
  );
  assert.strictEqual(result.lineage.verdict.kind, "ALARM");
  assert.ok(
    result.lineage.verdict.summary.includes(
      GATE5_ADAPTIVE_ORDER_ONLY_LINEAGE_CEILING
    )
  );
  assert.ok(
    result.verdict.summary.includes(GATE5_ADAPTIVE_ORDER_ONLY_LINEAGE_CEILING)
  );
});

check("profile absence reaches its blind code", () => {
  const result = assessGate5Adaptive(
    logOf([]),
    baseConfig({ profile: undefined })
  );
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
  assert.ok(result.blindReasonCodes.includes("G5_PROFILE_ABSENT"));
  assert.strictEqual((result.verdict as CannotAssessVerdict).blindPaths.length, 2);
});

check("vacuous lifecycle.open blinds both the budget and its lineage consumer", () => {
  const result = assessGate5Adaptive(
    logOf([]),
    baseConfig({
      profile: profile({
        exceptionLifecycle: { open: [], renew: [RENEW], close: [CLOSE] },
      }),
    })
  );
  assert.deepStrictEqual(result.budget.blindReasonCodes, ["G5_LIFECYCLE_VACUOUS"]);
  assert.strictEqual(result.budget.verdict.kind, "CANNOT_ASSESS");
  assert.strictEqual(result.lineage.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.lineage.blindReasonCodes, ["G5_LIFECYCLE_VACUOUS"]);
  assert.ok(!result.lineage.verdict.summary.includes("Nothing was invoked"));
});

check("lifecycle malformed tuple blinds rather than dropping the tuple", () => {
  const result = assessGate5Adaptive(
    logOf([]),
    baseConfig({
      profile: profile({
        exceptionLifecycle: {
          open: [{ moduleId: "", eventType: OPEN.eventType }],
          renew: [RENEW],
          close: [CLOSE],
        },
      }),
    })
  );
  assert.deepStrictEqual(result.budget.blindReasonCodes, ["G5_LIFECYCLE_MALFORMED"]);
  assert.strictEqual(result.lineage.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.lineage.blindReasonCodes, ["G5_LIFECYCLE_MALFORMED"]);
  assert.ok(!result.lineage.verdict.summary.includes("Nothing was invoked"));
});

check("bounded lineage is blind when its required budget is absent", () => {
  const result = assessGate5Adaptive(
    logOf([]),
    baseConfig({ exceptionBudget: undefined })
  );
  assert.deepStrictEqual(result.budget.blindReasonCodes, ["G5_BUDGET_ABSENT"]);
  assert.strictEqual(result.lineage.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.lineage.blindReasonCodes, ["G5_BUDGET_ABSENT"]);
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
});

check("bounded lineage is blind when its required budget is malformed", () => {
  const result = assessGate5Adaptive(
    logOf([]),
    baseConfig({
      exceptionBudget: compactBudget({ cumulativeBudgetSteps: Number.NaN }),
    })
  );
  assert.strictEqual(result.budget.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.budget.blindReasonCodes, ["G5_BUDGET_MALFORMED"]);
  assert.strictEqual(result.lineage.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.lineage.blindReasonCodes, ["G5_BUDGET_MALFORMED"]);
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
});

check("order-only lineage remains readable without a usable budget", () => {
  const cases: Array<[string, Gate5ExceptionBudget | undefined]> = [
    ["absent", undefined],
    ["malformed", compactBudget({ windowSteps: 0 })],
  ];
  for (const [name, exceptionBudget] of cases) {
    const result = assessGate5Adaptive(
      logOf([]),
      baseConfig({ exceptionBudget, nearExhaustionFraction: undefined })
    );
    assert.strictEqual(result.budget.verdict.kind, "CANNOT_ASSESS", name);
    assert.strictEqual(result.lineage.verdict.kind, "SILENT", name);
    assert.deepStrictEqual(result.lineage.blindReasonCodes, [], name);
    assert.ok(
      result.lineage.verdict.summary.includes(
        GATE5_ADAPTIVE_ORDER_ONLY_LINEAGE_CEILING
      ),
      name
    );
  }
});

check("bounded lineage requires usable close classes; order-only remains open-only", () => {
  const cases: Array<[
    string,
    NonNullable<Gate5AdaptiveProfile["exceptionLifecycle"]>,
    "G5_LIFECYCLE_VACUOUS" | "G5_LIFECYCLE_MALFORMED"
  ]> = [
    [
      "vacuous close",
      { open: [OPEN, BETA_OPEN], renew: [RENEW], close: [] },
      "G5_LIFECYCLE_VACUOUS",
    ],
    [
      "malformed close",
      {
        open: [OPEN, BETA_OPEN],
        renew: [RENEW],
        close: [{ moduleId: CLOSE.moduleId, eventType: "" }],
      },
      "G5_LIFECYCLE_MALFORMED",
    ],
  ];

  for (const [name, exceptionLifecycle, code] of cases) {
    const bounded = assessGate5Adaptive(
      logOf([]),
      baseConfig({ profile: profile({ exceptionLifecycle }) })
    );
    assert.strictEqual(bounded.lineage.verdict.kind, "CANNOT_ASSESS", name);
    assert.deepStrictEqual(bounded.lineage.blindReasonCodes, [code], name);

    const orderOnly = assessGate5Adaptive(
      logOf([record(OPEN), record(BETA_OPEN)]),
      baseConfig({
        profile: profile({ exceptionLifecycle }),
        nearExhaustionFraction: undefined,
      })
    );
    assert.strictEqual(orderOnly.budget.verdict.kind, "CANNOT_ASSESS", name);
    assert.strictEqual(orderOnly.lineage.verdict.kind, "ALARM", name);
    assert.deepStrictEqual(orderOnly.lineage.blindReasonCodes, [], name);
    assert.strictEqual(
      (orderOnly.lineage.verdict as AlarmVerdict).findings[0].code,
      "G5_LINEAGE_DISCONTINUITY",
      name
    );
  }
});

check("every malformed budget scalar blinds instead of repair, clamp, or fallback", () => {
  const invalidCases: Array<[keyof Gate5ExceptionBudget, number]> = [
    ["windowSteps", 0],
    ["maxSpanSteps", 0],
    ["maxConsecutiveRenewals", -1],
    ["cumulativeBudgetSteps", 0],
    ["coolingOffSteps", -1],
    ["maxInvocationsPerWindow", 0],
    ["windowSteps", 1.5],
    ["maxSpanSteps", 1.5],
    ["maxConsecutiveRenewals", 1.5],
    ["cumulativeBudgetSteps", 1.5],
    ["coolingOffSteps", 1.5],
    ["maxInvocationsPerWindow", 1.5],
    ["windowSteps", Number.NaN],
    ["cumulativeBudgetSteps", Number.POSITIVE_INFINITY],
  ];
  for (const [field, value] of invalidCases) {
    const malformed = { ...compactBudget(), [field]: value };
    const result = assessGate5Adaptive(
      logOf([]),
      baseConfig({ exceptionBudget: malformed })
    );
    assert.deepStrictEqual(
      result.budget.blindReasonCodes,
      ["G5_BUDGET_MALFORMED"],
      `${field}=${value}`
    );
  }
});

check("lineage vacuity blinds only leg B", () => {
  const result = assessGate5Adaptive(
    logOf([]),
    baseConfig({
      profile: profile({ lineage: { successionDeclared: [] } }),
    })
  );
  assert.deepStrictEqual(result.lineage.blindReasonCodes, ["G5_LINEAGE_VACUOUS"]);
  assert.strictEqual(result.budget.verdict.kind, "SILENT");
});

check("lineage malformed tuple blinds rather than dropping the tuple", () => {
  const result = assessGate5Adaptive(
    logOf([]),
    baseConfig({
      profile: profile({
        lineage: {
          successionDeclared: [{ moduleId: SUCCESSION.moduleId, eventType: "" }],
        },
      }),
    })
  );
  assert.deepStrictEqual(result.lineage.blindReasonCodes, ["G5_LINEAGE_MALFORMED"]);
});

check("every malformed exhaustion fraction blinds leg B rather than repairing it", () => {
  for (const nearExhaustionFraction of [
    -0.01,
    1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    const result = assessGate5Adaptive(
      logOf([]),
      baseConfig({ nearExhaustionFraction })
    );
    assert.deepStrictEqual(
      result.lineage.blindReasonCodes,
      ["G5_EXHAUSTION_FRACTION_MALFORMED"],
      String(nearExhaustionFraction)
    );
  }
});

check("missing readableLoadStates reaches the shared readability blind code", () => {
  const result = assessGate5Adaptive(
    logOf([]),
    baseConfig({ readableLoadStates: undefined })
  );
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
  assert.deepStrictEqual(result.blindReasonCodes, [
    "G5_READABILITY_GATE",
    "G5_READABILITY_GATE",
  ]);
});

check("per-section vacuity remains independent and is printed separately", () => {
  const config = baseConfig({
    profile: profile({ lineage: { successionDeclared: [] } }),
  });
  const result = assessGate5Adaptive(logOf([]), config);
  assert.strictEqual(result.budget.verdict.kind, "SILENT");
  assert.strictEqual(result.lineage.verdict.kind, "CANNOT_ASSESS");
  assert.strictEqual(result.verdict.kind, "CANNOT_ASSESS");
  const scope = gate5AdaptiveScopeBlockText(config);
  assert.ok(scope.includes("SITE-TWELVE SECTION A (exceptionLifecycle): DECLARED"));
  assert.ok(scope.includes("SITE-TWELVE SECTION B (lineage): VACUOUS/ABSENT"));
});

check("tuple-key membership is collision-proof in lifecycle and lineage classes", () => {
  const left = { moduleId: "a", eventType: "b0000c" };
  const right = { moduleId: "a0000b", eventType: "c" };
  const collisionProfile: Gate5AdaptiveProfile = {
    exceptionLifecycle: { open: [left], renew: [RENEW], close: [CLOSE] },
    lineage: { successionDeclared: [left] },
  };
  const result = assessGate5Adaptive(
    logOf([record(right)]),
    baseConfig({ profile: collisionProfile })
  );
  assert.strictEqual(result.budget.recordsExamined, 0);
  assert.strictEqual(result.budget.verdict.kind, "SILENT");
  assert.strictEqual(result.lineage.verdict.kind, "SILENT");
});

check("leg-A ALARM survives leg-B blindness and prints the blind code", () => {
  const result = assessGate5Adaptive(
    logOf([record(OPEN), ...fillers(2), record(CLOSE)]),
    baseConfig({
      profile: profile({ lineage: { successionDeclared: [] } }),
      exceptionBudget: compactBudget({
        maxSpanSteps: 2,
        maxConsecutiveRenewals: 0,
      }),
    })
  );
  assert.strictEqual(result.budget.verdict.kind, "ALARM");
  assert.strictEqual(result.lineage.verdict.kind, "CANNOT_ASSESS");
  assert.strictEqual(result.verdict.kind, "ALARM");
  assert.ok(result.verdict.summary.includes("G5_LINEAGE_VACUOUS"));
});

check("leg-B ALARM survives leg-A blindness and prints the blind code", () => {
  const result = assessGate5Adaptive(
    logOf([record(OPEN), record(CLOSE), record(BETA_OPEN)]),
    baseConfig({
      exceptionBudget: undefined,
      nearExhaustionFraction: undefined,
    })
  );
  assert.strictEqual(result.budget.verdict.kind, "CANNOT_ASSESS");
  assert.strictEqual(result.lineage.verdict.kind, "ALARM");
  assert.strictEqual(result.verdict.kind, "ALARM");
  assert.ok(result.verdict.summary.includes("G5_BUDGET_ABSENT"));
});

check("base ceilings are printed on SILENT, ALARM, blind legs, and composites", () => {
  const silentResult = assessGate5Adaptive(logOf([]), baseConfig());
  const alarmResult = assessGate5Adaptive(
    logOf([record(OPEN), ...fillers(2), record(CLOSE)]),
    baseConfig({
      exceptionBudget: compactBudget({
        maxSpanSteps: 2,
        maxConsecutiveRenewals: 0,
      }),
    })
  );
  const blindResult = assessGate5Adaptive(logOf([]));
  for (const verdict of [
    silentResult.budget.verdict,
    silentResult.lineage.verdict,
    silentResult.verdict,
    alarmResult.budget.verdict,
    alarmResult.lineage.verdict,
    alarmResult.verdict,
    blindResult.budget.verdict,
    blindResult.lineage.verdict,
    blindResult.verdict,
  ]) {
    assertBaseCeilings(verdict);
  }
});

check("scope block prints every base ceiling and both declared site-twelve sections", () => {
  const scope = gate5AdaptiveScopeBlockText(baseConfig());
  for (const ceiling of GATE5_ADAPTIVE_CEILING_LINES) {
    assert.ok(scope.includes(ceiling));
  }
  assert.ok(scope.includes("SITE-TWELVE SECTION A (exceptionLifecycle): DECLARED"));
  assert.ok(scope.includes("SITE-TWELVE SECTION B (lineage): DECLARED"));
});

check("adversarial timestamps leave the complete verdict byte-identical", () => {
  const ordinary = [
    record(OPEN, 0),
    record(RENEW, 0),
    record(CLOSE, 0),
    record(BETA_OPEN, 0),
  ];
  const adversarial = [
    record(OPEN, Number.NaN),
    record(RENEW, Number.POSITIVE_INFINITY),
    record(CLOSE, Number.NEGATIVE_INFINITY),
    record(BETA_OPEN, -9e15),
  ];
  const first = assessGate5Adaptive(logOf(ordinary), baseConfig());
  const second = assessGate5Adaptive(logOf(adversarial), baseConfig());
  assert.strictEqual(JSON.stringify(first), JSON.stringify(second));
});

check("source statically reads no timestamp, parameters bag, doctor, or gate-verdict input", () => {
  const source = readFileSync(join(__dirname, "index.ts"), "utf8");
  assert.ok(!/\.\s*timestamp\b|\[\s*["']timestamp["']\s*\]/.test(source));
  assert.ok(!/\.\s*parameters\b|\[\s*["']parameters["']\s*\]/.test(source));
  assert.ok(!/from\s+["'][^"']*doctor(?:\/|["'])/.test(source));
  assert.ok(!/\bgateVerdict\b|\bGateVerdict\b/.test(source));
});

check("source vocabulary stays inside the ceiling fence", () => {
  const source = readFileSync(join(__dirname, "index.ts"), "utf8");
  const start = source.indexOf("export const GATE5_ADAPTIVE_CEILING_LINES");
  const end = source.indexOf("export const GATE5_ADAPTIVE_CEILING_FENCE_END", start);
  assert.ok(start >= 0 && end > start, "ceiling fence not found");
  const outside = (source.slice(0, start) + source.slice(end)).toLowerCase();
  for (const banned of [
    "warranted",
    "justified",
    "legitimate",
    "sincere",
    "genuine",
    "appropriate",
  ]) {
    assert.ok(!outside.includes(banned), `\`${banned}\` escaped the ceiling fence`);
  }
  const all = source.toLowerCase();
  for (const forbidden of ["override-approved", "exception-granted"]) {
    assert.ok(!all.includes(forbidden), `\`${forbidden}\` appears in the module`);
  }
});

check("Gate-5 ALARM floors all sibling SILENT verdicts and leaves chokepoint files byte-untouched", () => {
  const chokepointDir = join(__dirname, "..", "chokepoint");
  const files = readdirSync(chokepointDir)
    .filter((name) => name.endsWith(".ts"))
    .sort();
  const before = new Map(
    files.map((name) => [name, readFileSync(join(chokepointDir, name))] as const)
  );

  const gate = assessGate5Adaptive(
    logOf([record(OPEN), ...fillers(2), record(CLOSE)]),
    baseConfig({
      exceptionBudget: compactBudget({
        maxSpanSteps: 2,
        maxConsecutiveRenewals: 0,
      }),
    })
  ).verdict;
  assert.strictEqual(gate.kind, "ALARM");
  const siblings = [
    SIG_SENSOR_ID,
    ENG_SENSOR_ID,
    NARROW_W_SENSOR_ID,
    NARROW_R_SENSOR_ID,
    NARROW_K_SENSOR_ID,
    NARROW_T_SENSOR_ID,
    GATE1_SCOPE_SENSOR_ID,
    GATE4_SUNSET_SENSOR_ID,
  ].map((sensorId) => silent(sensorId, "fixture scope"));
  const result = new Chokepoint().guard(
    { id: "gate5-third-reader-floor-proof" },
    [...siblings, gate],
    { impactClass: "not-consulted-for-alarm" }
  );
  assert.ok(siblings.every((verdict) => verdict.kind === "SILENT"));
  assert.strictEqual(result.decision.floorKind, "ALARM");
  assert.strictEqual(result.disposition, "HOLD");
  assert.strictEqual(result.execute, false);

  for (const name of files) {
    assert.ok(
      (before.get(name) as Buffer).equals(readFileSync(join(chokepointDir, name))),
      `${name} changed during guard-floor proof`
    );
  }
});

check("sensor id is the registered Gate-5 identity", () => {
  assert.strictEqual(GATE5_ADAPTIVE_SENSOR_ID, "MICA/gate5-adaptive");
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
