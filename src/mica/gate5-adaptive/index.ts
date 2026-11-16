// ── MICA · Gate 5 adaptive — passive exception-throttle reader ─────────────
//
// This is an alarm-only reader of declared exception lifecycle shape. It reads
// bounding and lineage form on the record's sequence axis; it grants nothing.

import type { MicaLogRecord, MicaReadableLog } from "../log";
import { tupleKey } from "../tuple-key";
import {
  alarm,
  assessLogReadability,
  cannotAssess,
  formatScopeBlock,
  loadStateScopeLines,
  printScopeBlock,
  SILENCE_IS_NOT_HEALTH,
} from "../types";
import type { BlindPath, Finding, SensorVerdict } from "../types";
import { COMMON_COMPETENCE_LINES } from "../competence";

export const GATE5_ADAPTIVE_SENSOR_ID = "MICA/gate5-adaptive";

export interface Gate5EventClass {
  readonly moduleId: string;
  readonly eventType: string;
}

export interface Gate5AdaptiveProfile {
  /** Section A: exception lifecycle event classes. */
  readonly exceptionLifecycle?: {
    readonly open?: readonly Gate5EventClass[];
    readonly renew?: readonly Gate5EventClass[];
    readonly close?: readonly Gate5EventClass[];
  };
  /** Section B: event classes declaring a lineage succession or handover. */
  readonly lineage?: {
    readonly successionDeclared?: readonly Gate5EventClass[];
  };
}

export interface Gate5ExceptionBudget {
  readonly windowSteps: number;
  readonly maxSpanSteps: number;
  readonly maxConsecutiveRenewals: number;
  readonly cumulativeBudgetSteps: number;
  readonly coolingOffSteps: number;
  readonly maxInvocationsPerWindow: number;
}

export interface Gate5AdaptiveConfig {
  /** Shared MICA readability policy: injected, with no default. */
  readonly readableLoadStates?: readonly string[];
  /** One combined deployment profile: vacuity site twelve. */
  readonly profile?: Gate5AdaptiveProfile;
  /** Injected budget; absent means leg A cannot be assessed. */
  readonly exceptionBudget?: Gate5ExceptionBudget;
  /** Optional fraction in [0, 1); absent selects order-only lineage mode. */
  readonly nearExhaustionFraction?: number;
}

/**
 * House Willkür, chosen 2026-08-20: ratio-preserving translation of RMBA's
 * Bounded Temporary Breach timings onto the sequence axis. Calibration is
 * [owed] to the deployer. This reader supplies no default and never consults
 * this constant internally.
 */
export const GATE5_HOUSE_PROXY_BUDGET: Gate5ExceptionBudget = {
  windowSteps: 4000,
  maxSpanSteps: 1000,
  maxConsecutiveRenewals: 2,
  cumulativeBudgetSteps: 3000,
  coolingOffSteps: 1000,
  maxInvocationsPerWindow: 1,
};

/** House proxy for fixtures and explicit caller injection; never a default. */
export const GATE5_HOUSE_PROXY_NEAR_EXHAUSTION_FRACTION = 0.75;

export type Gate5AdaptiveBlindReasonCode =
  | "G5_PROFILE_ABSENT"
  | "G5_LIFECYCLE_VACUOUS"
  | "G5_LIFECYCLE_MALFORMED"
  | "G5_BUDGET_ABSENT"
  | "G5_BUDGET_MALFORMED"
  | "G5_LINEAGE_VACUOUS"
  | "G5_LINEAGE_MALFORMED"
  | "G5_EXHAUSTION_FRACTION_MALFORMED"
  | "G5_READABILITY_GATE";

export interface Gate5LegResult {
  readonly verdict: SensorVerdict;
  readonly blindReasonCodes: readonly Gate5AdaptiveBlindReasonCode[];
  readonly recordsExamined: number;
}

export interface Gate5AdaptiveResult {
  readonly verdict: SensorVerdict;
  readonly blindReasonCodes: readonly Gate5AdaptiveBlindReasonCode[];
  readonly budget: Gate5LegResult;
  readonly lineage: Gate5LegResult;
}

// Source-discipline fence: vocabulary that could be mistaken for a disposition
// claim may occur only between this declaration and the named fence end.
export const GATE5_ADAPTIVE_CEILING_LINES: readonly string[] = [
  "THROTTLE, NEVER DISCRIMINATOR: the cap bounds the extent of an exception; it cannot tell a rule-failure-rich environment from manufactured triggers. That discrimination is a verdict-layer pattern read, not a Gate-5 internal. This reader reads bounding, never rightness.",
  "THE DISCRIMINATION PROPERTY IS NOT READ: rule-failure versus rule-inconvenience, anchored to a declared rule-purpose, is probe-borne and parked. The required authoring-layer intent record is absent and the probe apparatus is barred. A perfectly bounded exception with a purely self-serving basis reads SILENT here; no warranted, justified, sincere, genuine, or appropriate conclusion follows.",
  "SELF-WRITTEN RECORD: every record was produced by the observed party; the writing is the watching. An adversary who logs a tidy lifecycle stays inside budget on the record.",
  "SEQUENCE-STEPS ARE NOT TIME: a quiet system burns few steps and can hold an exception open across a long wall-clock period at low sequence cost. This is a dosimeter of activity under exception, not duration of exception.",
  "THE LIFECYCLE IS DECLARED, NEVER DETECTED: an exception not logged as an open is invisible. Conformance is read only given the declared classes.",
  "OVERLAPPING OPENS SHARE A CLOSE: each open pairs with the next higher-sequence close, so concurrent or nested exceptions can pair several opens onto one close and leave a later close unpaired. Under overlap this reader can read SILENT where an order-disciplined pairing would breach. It reads one lifecycle stream and models no concurrency; the record declares no open-to-close binding.",
  "LINEAGE IS A moduleId PROXY: a system that keeps one moduleId while internally re-identifying is invisible to this leg; a legitimately new module is flagged. The finding says continuity cannot be asserted and does not decide evasion or intent.",
  "VACUITY SITE TWELVE — FLAGGED: the one combined Gate-5 profile is checked per section; one declared half does not repair a vacuous half. The option-B WATCH question remains OPEN across substrate and three gate sites.",
  "THE ANTI-BACKDOOR INVARIANT IS NOT TOUCHED: this reader emits an alarm; it neither grants nor replaces anything, and never reads a gate verdict.",
];

export const GATE5_ADAPTIVE_BOUNDED_LINEAGE_CEILING =
  "LINEAGE (LEG B): bounded mode requires a caller-injected exhaustion fraction and budget. This reader supplies no default; validation gates the read, and calibration is [owed].";

export const GATE5_ADAPTIVE_ORDER_ONLY_LINEAGE_CEILING =
  "LINEAGE (LEG B) — UNBOUNDED/LOUDER: no nearExhaustionFraction was injected. A fresh exception-bearing moduleId is therefore checked only for prior exception activity and a preceding declared succession; no exhaustion-threshold claim is offered.";

export const GATE5_ADAPTIVE_CEILING_FENCE_END = true;

export const GATE5_ADAPTIVE_PROFILE_PROVENANCE =
  "Every configured input is INJECTED BY THE CALLER. Absent inputs are never " +
  "defaulted. This reader performs no classification and treats calibration " +
  "as [owed].";

function usableName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function eventKey(value: Gate5EventClass): string {
  return tupleKey([value.moduleId, value.eventType]);
}

function recordKey(value: MicaLogRecord): string {
  return tupleKey([value.moduleId, value.eventType]);
}

function isNonEmptyClassList(value: unknown): value is readonly Gate5EventClass[] {
  return Array.isArray(value) && value.length > 0;
}

function isValidClassList(value: readonly Gate5EventClass[]): boolean {
  return value.every(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      usableName(entry.moduleId) &&
      usableName(entry.eventType)
  );
}

function isValidBudget(value: Gate5ExceptionBudget): boolean {
  const positive = [
    value.windowSteps,
    value.maxSpanSteps,
    value.cumulativeBudgetSteps,
    value.maxInvocationsPerWindow,
  ];
  const nonNegative = [
    value.maxConsecutiveRenewals,
    value.coolingOffSteps,
  ];
  return (
    positive.every((entry) => Number.isInteger(entry) && entry > 0) &&
    nonNegative.every((entry) => Number.isInteger(entry) && entry >= 0)
  );
}

export function gate5AdaptiveCeilingLines(
  nearExhaustionFraction?: number
): readonly string[] {
  return [
    ...GATE5_ADAPTIVE_CEILING_LINES,
    nearExhaustionFraction === undefined
      ? GATE5_ADAPTIVE_ORDER_ONLY_LINEAGE_CEILING
      : GATE5_ADAPTIVE_BOUNDED_LINEAGE_CEILING,
  ];
}

function ceilingText(config: Gate5AdaptiveConfig | undefined): string {
  return gate5AdaptiveCeilingLines(config?.nearExhaustionFraction).join(" ");
}

function blindLeg(
  code: Gate5AdaptiveBlindReasonCode,
  detail: string,
  config: Gate5AdaptiveConfig | undefined
): Gate5LegResult {
  const verdict = cannotAssess(GATE5_ADAPTIVE_SENSOR_ID, [
    { class: "MISSING_CONFIGURATION", detail },
  ]);
  return {
    verdict: {
      ...verdict,
      summary:
        `${verdict.summary} Blind reason code: ${code}. ` +
        `${ceilingText(config)}`,
    },
    blindReasonCodes: [code],
    recordsExamined: 0,
  };
}

function readabilityBlind(
  verdict: SensorVerdict,
  config: Gate5AdaptiveConfig | undefined
): Gate5LegResult {
  return {
    verdict: {
      ...verdict,
      summary:
        `${verdict.summary} Blind reason code: G5_READABILITY_GATE. ` +
        `${ceilingText(config)}`,
    },
    blindReasonCodes: ["G5_READABILITY_GATE"],
    recordsExamined: 0,
  };
}

function lifecycleConfigBlind(
  config: Gate5AdaptiveConfig | undefined
): Gate5LegResult | null {
  if (config?.profile === undefined) {
    return blindLeg(
      "G5_PROFILE_ABSENT",
      "The one combined Gate-5 profile was absent. Site twelve is undeclared, so the exception-lifecycle section cannot be read.",
      config
    );
  }
  const lifecycle = config.profile.exceptionLifecycle;
  const lists = [lifecycle?.open, lifecycle?.renew, lifecycle?.close];
  if (lists.some((list) => !isNonEmptyClassList(list))) {
    return blindLeg(
      "G5_LIFECYCLE_VACUOUS",
      "At least one of profile.exceptionLifecycle.open, renew, or close was absent or empty. Vacuity blinds leg A; it does not manufacture a clean throttle reading.",
      config
    );
  }
  if (
    lists.some((list) =>
      !isValidClassList(list as readonly Gate5EventClass[])
    )
  ) {
    return blindLeg(
      "G5_LIFECYCLE_MALFORMED",
      "Every lifecycle entry must contain non-empty moduleId and eventType strings. No malformed entry is ignored.",
      config
    );
  }
  if (config.exceptionBudget === undefined) {
    return blindLeg(
      "G5_BUDGET_ABSENT",
      "No exceptionBudget was injected. Leg A has no bounds of its own and supplies no default.",
      config
    );
  }
  const budget = config.exceptionBudget;
  if (!isValidBudget(budget)) {
    return blindLeg(
      "G5_BUDGET_MALFORMED",
      "exceptionBudget requires positive integers for windowSteps, maxSpanSteps, cumulativeBudgetSteps, and maxInvocationsPerWindow, plus non-negative integers for maxConsecutiveRenewals and coolingOffSteps. No value is repaired, clamped, or defaulted.",
      config
    );
  }
  return null;
}

function lineageConfigBlind(
  config: Gate5AdaptiveConfig | undefined
): Gate5LegResult | null {
  if (config?.profile === undefined) {
    return blindLeg(
      "G5_PROFILE_ABSENT",
      "The one combined Gate-5 profile was absent. Site twelve is undeclared, so the lineage section cannot be read.",
      config
    );
  }
  const succession = config.profile.lineage?.successionDeclared;
  if (!isNonEmptyClassList(succession)) {
    return blindLeg(
      "G5_LINEAGE_VACUOUS",
      "profile.lineage.successionDeclared was absent or empty. Vacuity blinds leg B; it does not manufacture continuity.",
      config
    );
  }
  if (!isValidClassList(succession)) {
    return blindLeg(
      "G5_LINEAGE_MALFORMED",
      "Every lineage entry must contain non-empty moduleId and eventType strings. No malformed entry is ignored.",
      config
    );
  }
  const open = config.profile.exceptionLifecycle?.open;
  if (!isNonEmptyClassList(open)) {
    return blindLeg(
      "G5_LIFECYCLE_VACUOUS",
      "Leg B groups exception opens by moduleId, but profile.exceptionLifecycle.open was absent or empty. The lineage section remains separately declared; its required input class is vacuous, so no continuity reading is offered.",
      config
    );
  }
  if (!isValidClassList(open)) {
    return blindLeg(
      "G5_LIFECYCLE_MALFORMED",
      "Leg B groups exception opens by moduleId, but profile.exceptionLifecycle.open contains a malformed class. The lineage section remains separately declared; no malformed input class is ignored.",
      config
    );
  }
  const fraction = config.nearExhaustionFraction;
  if (
    fraction !== undefined &&
    (typeof fraction !== "number" ||
      !Number.isFinite(fraction) ||
      fraction < 0 ||
      fraction >= 1)
  ) {
    return blindLeg(
      "G5_EXHAUSTION_FRACTION_MALFORMED",
      `nearExhaustionFraction was injected as ${String(fraction)}; the legal range is a finite number in [0, 1). No repair, clamp, or default is applied.`,
      config
    );
  }
  const close = config.profile.exceptionLifecycle?.close;
  if (fraction !== undefined && !isNonEmptyClassList(close)) {
    return blindLeg(
      "G5_LIFECYCLE_VACUOUS",
      "Bounded lineage computes prior active sequence-steps from paired spans, but profile.exceptionLifecycle.close was absent or empty. The lineage section remains separately declared; its bounded read lacks a required lifecycle input.",
      config
    );
  }
  if (
    fraction !== undefined &&
    !isValidClassList(close as readonly Gate5EventClass[])
  ) {
    return blindLeg(
      "G5_LIFECYCLE_MALFORMED",
      "Bounded lineage computes prior active sequence-steps from paired spans, but profile.exceptionLifecycle.close contains a malformed class. No malformed lifecycle input is ignored.",
      config
    );
  }
  if (fraction !== undefined && config.exceptionBudget === undefined) {
    return blindLeg(
      "G5_BUDGET_ABSENT",
      "nearExhaustionFraction was injected, but exceptionBudget was absent. Leg B cannot derive its trailing window or cumulative exhaustion threshold, and it does not silently fall back to order-only mode.",
      config
    );
  }
  if (
    fraction !== undefined &&
    config.exceptionBudget !== undefined &&
    !isValidBudget(config.exceptionBudget)
  ) {
    return blindLeg(
      "G5_BUDGET_MALFORMED",
      "nearExhaustionFraction was injected, but exceptionBudget is malformed. Leg B cannot derive a valid trailing window and cumulative exhaustion threshold; no value is repaired or ignored.",
      config
    );
  }
  return null;
}

interface ExceptionSpan {
  readonly open: MicaLogRecord;
  readonly close: MicaLogRecord | null;
  readonly endSequenceNumber: number;
  readonly renewalsUsed: number;
}

function buildSpans(
  records: readonly MicaLogRecord[],
  openKeys: ReadonlySet<string>,
  renewKeys: ReadonlySet<string>,
  closeKeys: ReadonlySet<string>
): readonly ExceptionSpan[] {
  const opens = records.filter((entry) => openKeys.has(recordKey(entry)));
  const closes = records.filter((entry) => closeKeys.has(recordKey(entry)));
  const recordEnd = records.reduce(
    (highest, entry) => Math.max(highest, entry.sequenceNumber),
    0
  );
  return opens.map((open) => {
    const close = closes.find(
      (candidate) => candidate.sequenceNumber > open.sequenceNumber
    ) ?? null;
    const endSequenceNumber = close?.sequenceNumber ?? recordEnd;
    const renewalsUsed = records.filter(
      (entry) =>
        renewKeys.has(recordKey(entry)) &&
        entry.sequenceNumber > open.sequenceNumber &&
        entry.sequenceNumber < endSequenceNumber
    ).length;
    return { open, close, endSequenceNumber, renewalsUsed };
  });
}

function spanLabel(span: ExceptionSpan): string {
  return `span(open=${span.open.sequenceNumber}, close=${
    span.close === null ? `record-end:${span.endSequenceNumber}` : span.close.sequenceNumber
  })`;
}

function activeStepsInWindow(
  span: ExceptionSpan,
  windowEnd: number,
  windowSteps: number
): number {
  const left = Math.max(span.open.sequenceNumber, windowEnd - windowSteps);
  const right = Math.min(span.endSequenceNumber, windowEnd);
  return Math.max(0, right - left);
}

function assessBudget(
  records: readonly MicaLogRecord[],
  config: Gate5AdaptiveConfig
): Gate5LegResult {
  const lifecycle = config.profile?.exceptionLifecycle as NonNullable<
    Gate5AdaptiveProfile["exceptionLifecycle"]
  >;
  const budget = config.exceptionBudget as Gate5ExceptionBudget;
  const openKeys = new Set(
    (lifecycle.open as readonly Gate5EventClass[]).map(eventKey)
  );
  const renewKeys = new Set(
    (lifecycle.renew as readonly Gate5EventClass[]).map(eventKey)
  );
  const closeKeys = new Set(
    (lifecycle.close as readonly Gate5EventClass[]).map(eventKey)
  );
  const ordered = [...records].sort(
    (left, right) => left.sequenceNumber - right.sequenceNumber
  );
  const spans = buildSpans(ordered, openKeys, renewKeys, closeKeys);
  const findings: Finding[] = [];

  for (const span of spans) {
    const spanLength = span.endSequenceNumber - span.open.sequenceNumber;
    const renewalAllowance = Math.min(
      span.renewalsUsed,
      budget.maxConsecutiveRenewals
    );
    const spanBound = budget.maxSpanSteps * (1 + renewalAllowance);
    if (spanLength > spanBound) {
      findings.push({
        code: "G5_EXCEPTION_BUDGET_BREACH",
        detail:
          `${spanLabel(span)} measured spanLength=${spanLength} sequence-step(s), ` +
          `exceeding injected span bound=${spanBound} ` +
          `(maxSpanSteps=${budget.maxSpanSteps} × (1 + min(renewalsUsed=${span.renewalsUsed}, ` +
          `maxConsecutiveRenewals=${budget.maxConsecutiveRenewals}))).`,
      });
    }
    if (span.renewalsUsed > budget.maxConsecutiveRenewals) {
      findings.push({
        code: "G5_EXCEPTION_BUDGET_BREACH",
        detail:
          `${spanLabel(span)} measured sequence-axis renewal count ` +
          `renewalsUsed=${span.renewalsUsed}, exceeding injected renewal cap ` +
          `maxConsecutiveRenewals=${budget.maxConsecutiveRenewals}.`,
      });
    }
  }

  for (const span of spans) {
    const inWindow = spans.filter(
      (candidate) =>
        candidate.open.sequenceNumber <= span.open.sequenceNumber &&
        candidate.open.sequenceNumber >=
          span.open.sequenceNumber - budget.windowSteps
    );
    if (inWindow.length > budget.maxInvocationsPerWindow) {
      findings.push({
        code: "G5_EXCEPTION_BUDGET_BREACH",
        detail:
          `${spanLabel(span)} completes a trailing window ending at ` +
          `${span.open.sequenceNumber} with measured invocations=${inWindow.length} ` +
          `at open sequence numbers [${inWindow.map((entry) => entry.open.sequenceNumber).join(", ")}], ` +
          `exceeding injected invocation cap maxInvocationsPerWindow=${budget.maxInvocationsPerWindow} ` +
          `within injected windowSteps=${budget.windowSteps}.`,
      });
    }
  }

  const candidates = [...new Set([
    ...ordered.map((entry) => entry.sequenceNumber),
    ...spans.map((span) => span.endSequenceNumber),
  ])].sort((left, right) => left - right);
  let cumulativePeak:
    | { readonly end: number; readonly steps: number; readonly active: readonly ExceptionSpan[] }
    | null = null;
  for (const end of candidates) {
    const active = spans.filter(
      (span) => activeStepsInWindow(span, end, budget.windowSteps) > 0
    );
    const steps = active.reduce(
      (sum, span) => sum + activeStepsInWindow(span, end, budget.windowSteps),
      0
    );
    if (cumulativePeak === null || steps > cumulativePeak.steps) {
      cumulativePeak = { end, steps, active };
    }
  }
  if (
    cumulativePeak !== null &&
    cumulativePeak.steps > budget.cumulativeBudgetSteps
  ) {
    findings.push({
      code: "G5_EXCEPTION_BUDGET_BREACH",
      detail:
        `Spans [${cumulativePeak.active.map(spanLabel).join(", ")}] measured cumulative ` +
        `active sequence-step(s)=${cumulativePeak.steps} in the trailing window ending at ` +
        `${cumulativePeak.end}, exceeding injected cumulative cap cumulativeBudgetSteps=` +
        `${budget.cumulativeBudgetSteps} within injected windowSteps=${budget.windowSteps}.`,
    });
  }

  const closes = ordered.filter((entry) => closeKeys.has(recordKey(entry)));
  for (const span of spans) {
    const preceding = [...closes].reverse().find(
      (close) => close.sequenceNumber < span.open.sequenceNumber
    );
    if (preceding === undefined) continue;
    const gap = span.open.sequenceNumber - preceding.sequenceNumber;
    if (gap < budget.coolingOffSteps) {
      findings.push({
        code: "G5_EXCEPTION_BUDGET_BREACH",
        detail:
          `${spanLabel(span)} opened ${gap} sequence-step(s) after preceding close=` +
          `${preceding.sequenceNumber}, below injected cooling-off minimum ` +
          `coolingOffSteps=${budget.coolingOffSteps}.`,
      });
    }
  }

  const base =
    `Leg A read ${spans.length} declared exception invocation span(s). ` +
    `${GATE5_ADAPTIVE_PROFILE_PROVENANCE}`;
  if (findings.length > 0) {
    return {
      verdict: alarm(
        GATE5_ADAPTIVE_SENSOR_ID,
        `${base} One or more independent throttle checks lower the bound. ` +
          `${ceilingText(config)}`,
        findings
      ),
      blindReasonCodes: [],
      recordsExamined: spans.length,
    };
  }
  const openEnded = spans.filter((span) => span.close === null).length;
  const none = spans.length === 0
    ? " Zero open events is conforming here: not bending the rule is the point. This is a reading rather than blindness."
    : ` Every declared span remains within all five injected throttle checks.` +
      (openEnded > 0
        ? ` ${openEnded} open-ended span(s) legally extend to the record end.`
        : "");
  return {
    verdict: {
      kind: "SILENT",
      sensorId: GATE5_ADAPTIVE_SENSOR_ID,
      summary:
        `${base}${none} ${ceilingText(config)} ${SILENCE_IS_NOT_HEALTH}`,
    },
    blindReasonCodes: [],
    recordsExamined: spans.length,
  };
}

function assessLineage(
  records: readonly MicaLogRecord[],
  config: Gate5AdaptiveConfig
): Gate5LegResult {
  const lifecycle = config.profile?.exceptionLifecycle;
  const openKeys = new Set(
    (lifecycle?.open ?? []).map(eventKey)
  );
  const renewKeys = new Set<string>();
  const closeClasses = lifecycle?.close;
  const closeKeys = new Set(
    isNonEmptyClassList(closeClasses) && isValidClassList(closeClasses)
      ? closeClasses.map(eventKey)
      : []
  );
  const successionKeys = new Set(
    (config.profile?.lineage?.successionDeclared as readonly Gate5EventClass[]).map(eventKey)
  );
  const ordered = [...records].sort(
    (left, right) => left.sequenceNumber - right.sequenceNumber
  );
  const spans = buildSpans(ordered, openKeys, renewKeys, closeKeys);
  const opens = spans.map((span) => span.open);
  const seenModules = new Set<string>();
  const findings: Finding[] = [];

  for (const currentSpan of spans) {
    const open = currentSpan.open;
    const isFresh = !seenModules.has(open.moduleId);
    const priorModules = new Set(
      opens
        .filter((candidate) => candidate.sequenceNumber < open.sequenceNumber)
        .map((candidate) => candidate.moduleId)
    );
    priorModules.delete(open.moduleId);
    const hasPriorSuccession = ordered.some(
      (entry) =>
        entry.sequenceNumber < open.sequenceNumber &&
        successionKeys.has(recordKey(entry))
    );

    if (isFresh && priorModules.size > 0 && !hasPriorSuccession) {
      let trigger:
        | { readonly moduleId: string; readonly consumed: number }
        | null = null;
      if (config.nearExhaustionFraction === undefined) {
        const firstPrior = [...priorModules][0];
        if (firstPrior !== undefined) trigger = { moduleId: firstPrior, consumed: 0 };
      } else if (config.exceptionBudget !== undefined) {
        const threshold =
          config.nearExhaustionFraction *
          config.exceptionBudget.cumulativeBudgetSteps;
        for (const moduleId of priorModules) {
          const consumed = spans
            .filter((span) => span.open.moduleId === moduleId)
            .reduce(
              (sum, span) =>
                sum +
                activeStepsInWindow(
                  span,
                  open.sequenceNumber,
                  config.exceptionBudget?.windowSteps as number
                ),
              0
            );
          if (consumed >= threshold) {
            trigger = { moduleId, consumed };
            break;
          }
        }
      }

      if (trigger !== null) {
        const mode = config.nearExhaustionFraction === undefined
          ? "order-only mode with no injected exhaustion threshold"
          : `measured prior-module active steps=${trigger.consumed}, at or above injected threshold=` +
            `${config.nearExhaustionFraction * (config.exceptionBudget?.cumulativeBudgetSteps as number)} ` +
            `(nearExhaustionFraction × cumulativeBudgetSteps)`;
        findings.push({
          code: "G5_LINEAGE_DISCONTINUITY",
          detail:
            `Continuity cannot be asserted for fresh moduleId=${JSON.stringify(open.moduleId)} ` +
            `at ${spanLabel(currentSpan)}: prior exception-bearing ` +
            `moduleId=${JSON.stringify(trigger.moduleId)} exists, ${mode}, and no injected ` +
            `successionDeclared event class precedes the new open.`,
        });
      }
    }
    seenModules.add(open.moduleId);
  }

  const modeText = config.nearExhaustionFraction === undefined
    ? "order-only lineage mode (no exhaustion fraction)"
    : `injected nearExhaustionFraction=${config.nearExhaustionFraction}`;
  const base =
    `Leg B read ${opens.length} exception open event(s) across ` +
    `${new Set(opens.map((entry) => entry.moduleId)).size} moduleId proxy value(s) under ${modeText}. ` +
    `${GATE5_ADAPTIVE_PROFILE_PROVENANCE}`;
  if (findings.length > 0) {
    return {
      verdict: alarm(
        GATE5_ADAPTIVE_SENSOR_ID,
        `${base} At least one fresh proxy lineage lacks a preceding declared succession, so continuity cannot be asserted. ` +
          `${ceilingText(config)}`,
        findings
      ),
      blindReasonCodes: [],
      recordsExamined: opens.length,
    };
  }
  const none = opens.length === 0
    ? " Nothing was invoked; there is no proxy-lineage transition to check, and this is a reading rather than blindness."
    : " No fresh proxy-lineage transition met this leg's finding rule.";
  return {
    verdict: {
      kind: "SILENT",
      sensorId: GATE5_ADAPTIVE_SENSOR_ID,
      summary:
        `${base}${none} ${ceilingText(config)} ${SILENCE_IS_NOT_HEALTH}`,
    },
    blindReasonCodes: [],
    recordsExamined: opens.length,
  };
}

function rankOf(kind: SensorVerdict["kind"]): number {
  return kind === "ALARM" ? 2 : kind === "CANNOT_ASSESS" ? 1 : 0;
}

function composeLegs(
  budget: Gate5LegResult,
  lineage: Gate5LegResult
): SensorVerdict {
  const worst =
    rankOf(budget.verdict.kind) >= rankOf(lineage.verdict.kind)
      ? budget.verdict.kind
      : lineage.verdict.kind;
  const summary =
    "Gate 5 adaptive composes TWO legs by the worst-of floor " +
    "(ALARM > CANNOT_ASSESS > SILENT); both are represented below. " +
    `|| [LEG A exception budget / ${budget.verdict.kind}; blind codes=${budget.blindReasonCodes.join(", ") || "none"}] ${budget.verdict.summary} ` +
    `|| [LEG B lineage continuity / ${lineage.verdict.kind}; blind codes=${lineage.blindReasonCodes.join(", ") || "none"}] ${lineage.verdict.summary}`;
  if (worst === "ALARM") {
    return {
      kind: "ALARM",
      sensorId: GATE5_ADAPTIVE_SENSOR_ID,
      summary,
      findings: [
        ...(budget.verdict.kind === "ALARM" ? budget.verdict.findings : []),
        ...(lineage.verdict.kind === "ALARM" ? lineage.verdict.findings : []),
      ],
    };
  }
  if (worst === "CANNOT_ASSESS") {
    const blindPaths: BlindPath[] = [
      ...(budget.verdict.kind === "CANNOT_ASSESS"
        ? budget.verdict.blindPaths
        : []),
      ...(lineage.verdict.kind === "CANNOT_ASSESS"
        ? lineage.verdict.blindPaths
        : []),
    ];
    return {
      kind: "CANNOT_ASSESS",
      sensorId: GATE5_ADAPTIVE_SENSOR_ID,
      summary,
      blindPaths,
    };
  }
  return { kind: "SILENT", sensorId: GATE5_ADAPTIVE_SENSOR_ID, summary };
}

export function assessGate5Adaptive(
  log: MicaReadableLog,
  config?: Gate5AdaptiveConfig
): Gate5AdaptiveResult {
  let budget = lifecycleConfigBlind(config);
  let lineage = lineageConfigBlind(config);

  if (budget === null || lineage === null) {
    const unreadable = assessLogReadability(
      log,
      GATE5_ADAPTIVE_SENSOR_ID,
      config?.readableLoadStates
    );
    if (unreadable !== null) {
      if (budget === null) budget = readabilityBlind(unreadable, config);
      if (lineage === null) lineage = readabilityBlind(unreadable, config);
    }
  }

  if (budget === null || lineage === null) {
    const records = log.getAll();
    if (budget === null) {
      budget = assessBudget(records, config as Gate5AdaptiveConfig);
    }
    if (lineage === null) {
      lineage = assessLineage(records, config as Gate5AdaptiveConfig);
    }
  }

  const resolvedBudget = budget as Gate5LegResult;
  const resolvedLineage = lineage as Gate5LegResult;
  return {
    verdict: composeLegs(resolvedBudget, resolvedLineage),
    blindReasonCodes: [
      ...resolvedBudget.blindReasonCodes,
      ...resolvedLineage.blindReasonCodes,
    ],
    budget: resolvedBudget,
    lineage: resolvedLineage,
  };
}

function sectionStatus(config: Gate5AdaptiveConfig | undefined): readonly string[] {
  const lifecycle = config?.profile?.exceptionLifecycle;
  const lifecycleLists = [lifecycle?.open, lifecycle?.renew, lifecycle?.close];
  const lifecycleComplete = lifecycleLists.every(isNonEmptyClassList);
  const lifecycleValid =
    lifecycleComplete &&
    lifecycleLists.every((list) =>
      isValidClassList(list as readonly Gate5EventClass[])
    );
  const lifecycleStatus = !lifecycleComplete
    ? "VACUOUS/ABSENT — leg A is CANNOT_ASSESS"
    : lifecycleValid
      ? "DECLARED"
      : "MALFORMED — leg A is CANNOT_ASSESS";

  const succession = config?.profile?.lineage?.successionDeclared;
  const lineageStatus = !isNonEmptyClassList(succession)
    ? "VACUOUS/ABSENT — leg B is CANNOT_ASSESS"
    : isValidClassList(succession)
      ? "DECLARED"
      : "MALFORMED — leg B is CANNOT_ASSESS";
  return [
    `SITE-TWELVE SECTION A (exceptionLifecycle): ${lifecycleStatus}.`,
    `SITE-TWELVE SECTION B (lineage): ${lineageStatus}.`,
  ];
}

export const GATE5_ADAPTIVE_TITLE =
  "MICA/gate5-adaptive — Gate 5 passive exception throttle";

export const GATE5_ADAPTIVE_READS: readonly string[] = [
  "moduleId and eventType, encoded together through the shared collision-proof",
  "  tuple key, for membership in injected lifecycle and succession classes",
  "sequenceNumber for lifecycle pairing, span and renewal arithmetic, trailing",
  "  windows, cooling-off gaps, and strict succession-before-open order; no",
  "  clock field is consulted",
  "moduleId alone as the explicitly weak lineage proxy for exception-bearing",
  "  activity; no lineage token exists in the declared readable record shape",
  "the log's own verify() and getLoadState() — readability gate only",
];

export const GATE5_ADAPTIVE_COMPETENCE_LINES: readonly string[] = [
  ...COMMON_COMPETENCE_LINES,
  "That the reader treats every throttle figure as caller-injected sequence-axis",
  "  calibration and never as a wall-clock duration or an internal default.",
  "That the reader keeps budget conformance separate from exception rightness:",
  "  this module reads only the declared lifecycle's bounding arithmetic.",
  "That the reader treats moduleId as a weak proxy in both directions and reads",
  "  a lineage finding only as an inability to assert continuity.",
];

export function gate5AdaptiveScopeBlockText(
  config?: Gate5AdaptiveConfig
): string {
  return formatScopeBlock(
    GATE5_ADAPTIVE_TITLE,
    GATE5_ADAPTIVE_READS,
    [
      ...gate5AdaptiveCeilingLines(config?.nearExhaustionFraction),
      ...sectionStatus(config),
      "EXCEPTION PURPOSE, INTENT, CONTENT, OR EFFECT. This reader sees only typed lifecycle shape.",
      "A CLOCK OR CALENDAR. All arithmetic is on sequenceNumber and remains activity-relative.",
    ],
    GATE5_ADAPTIVE_COMPETENCE_LINES,
    loadStateScopeLines(config?.readableLoadStates)
  );
}

export function printGate5Adaptive(config?: Gate5AdaptiveConfig): void {
  printScopeBlock(
    GATE5_ADAPTIVE_TITLE,
    GATE5_ADAPTIVE_READS,
    [
      ...gate5AdaptiveCeilingLines(config?.nearExhaustionFraction),
      ...sectionStatus(config),
      "EXCEPTION PURPOSE, INTENT, CONTENT, OR EFFECT. This reader sees only typed lifecycle shape.",
      "A CLOCK OR CALENDAR. All arithmetic is on sequenceNumber and remains activity-relative.",
    ],
    GATE5_ADAPTIVE_COMPETENCE_LINES,
    loadStateScopeLines(config?.readableLoadStates)
  );
}
