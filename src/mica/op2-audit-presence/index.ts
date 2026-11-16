// ── MICA · OP-2 arbiter audit presence/rate ─────────────────────────────────

import type { MicaLogRecord, MicaReadableLog } from "../log";
import type { OperatorEventClass, OperatorLayerProfile } from "../operator-layer-profile";
import {
  alarm,
  assessLogReadability,
  cannotAssess,
  formatScopeBlock,
  loadStateScopeLines,
  printScopeBlock,
  silent,
} from "../types";
import type { BlindPath, Finding, SensorVerdict } from "../types";
import { COMMON_COMPETENCE_LINES } from "../competence";

export const OP2_AUDIT_PRESENCE_SENSOR_ID = "MICA/op2-audit-presence";

export type Op2BlindReasonCode =
  | "OP2_READABILITY_GATE"
  | "OP2_PROFILE_ABSENT"
  | "OP2_PROFILE_VACUOUS"
  | "OP2_PROFILE_MALFORMED"
  | "OP2_INSUFFICIENT_EVIDENCE";

export interface Op2AuditPresenceResult {
  readonly verdict: SensorVerdict;
  readonly blindReasonCodes: readonly Op2BlindReasonCode[];
  readonly recordsExamined: number;
  readonly auditsInScope: number;
  readonly trailingWindow?: { readonly start: number; readonly end: number };
}

export const OP2_RATE_MODE_CEILING =
  "RATE MODE: the trailing window is [end−W, end] inclusive on sequenceNumber; count exactly M conforms and M−1 alarms.";

export const OP2_PRESENCE_MODE_CEILING =
  "PRESENCE-ONLY / LOUDER: audit rate is unbounded — one matching audit anywhere in the readable range satisfies this mode.";

export const OP2_AUDIT_PRESENCE_CEILING_LINES: readonly string[] = [
  "RANDOMNESS IS NOT READ — a scheduled, pre-announced, or gamed ‘random’ audit reads identically to a random one. Presence and rate only; randomness is a claim this reader cannot check.",
  "PRESENCE NEVER QUALITY — MICA makes the audit's presence-or-absence provable without performing it.",
  "AUDIT SCOPE IS NOT READABLE HERE — scope lives in record content the declared five-field shape does not carry; this reader cannot enforce an unscoped-audit consumption rule.",
  "SELF-WRITTEN-LOG RESIDUE — audit records ride the deployment log; suppression and absence are indistinguishable.",
];

const OP2_SITE_THIRTEEN =
  "SITE THIRTEEN FLAGGED (one layer-profile, three sections, per-section vacuity independent — arbiter-ruled (ii), 2026-08-21).";

const OP2_COMPETENCE_LINES: readonly string[] = [
  ...COMMON_COMPETENCE_LINES,
  "That the reader does not infer randomness, audit quality, or audit scope from a matching class record.",
  "That the inclusive sequence window is an activity window and never a duration.",
];

function ceilingText(modeLine?: string): string {
  return [modeLine, ...OP2_AUDIT_PRESENCE_CEILING_LINES, OP2_SITE_THIRTEEN]
    .filter((line): line is string => line !== undefined).join(" || ");
}

function withCeilings(verdict: SensorVerdict, modeLine?: string): SensorVerdict {
  return { ...verdict, summary: `${verdict.summary} || CEILINGS: ${ceilingText(modeLine)}` };
}

function usableClass(value: OperatorEventClass | undefined): value is OperatorEventClass {
  return value !== undefined &&
    typeof value.moduleId === "string" && value.moduleId.trim().length > 0 &&
    typeof value.eventType === "string" && value.eventType.trim().length > 0;
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function matches(record: MicaLogRecord, eventClass: OperatorEventClass): boolean {
  return record.moduleId === eventClass.moduleId && record.eventType === eventClass.eventType;
}

function blind(code: Op2BlindReasonCode, path: BlindPath): Op2AuditPresenceResult {
  return {
    verdict: withCeilings(cannotAssess(OP2_AUDIT_PRESENCE_SENSOR_ID, [path])),
    blindReasonCodes: [code],
    recordsExamined: 0,
    auditsInScope: 0,
  };
}

export function assessOp2AuditPresence(
  log: MicaReadableLog,
  profile: OperatorLayerProfile | undefined,
  readableLoadStates?: readonly string[]
): Op2AuditPresenceResult {
  const unreadable = assessLogReadability(log, OP2_AUDIT_PRESENCE_SENSOR_ID, readableLoadStates);
  if (unreadable !== null) {
    return {
      verdict: withCeilings(unreadable),
      blindReasonCodes: ["OP2_READABILITY_GATE"],
      recordsExamined: 0,
      auditsInScope: 0,
    };
  }

  const section = profile?.auditObligation;
  if (section === undefined) {
    return blind("OP2_PROFILE_ABSENT", {
      class: "MISSING_CONFIGURATION",
      detail: "OP2_PROFILE_ABSENT: no auditObligation section was injected; another operator-profile section cannot repair it.",
    });
  }
  if (!usableClass(section.auditClass)) {
    return blind("OP2_PROFILE_VACUOUS", {
      class: "MISSING_CONFIGURATION",
      detail: "OP2_PROFILE_VACUOUS: auditObligation is present but auditClass has an empty moduleId or eventType.",
    });
  }
  if ((section.windowSteps !== undefined && !positiveInteger(section.windowSteps)) ||
      (section.minAuditsPerWindow !== undefined && !positiveInteger(section.minAuditsPerWindow))) {
    return blind("OP2_PROFILE_MALFORMED", {
      class: "MISSING_CONFIGURATION",
      detail: "OP2_PROFILE_MALFORMED: windowSteps and minAuditsPerWindow must each be positive integers when present.",
    });
  }

  const entries = [...log.getAll()].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  if (entries.length === 0) {
    return blind("OP2_INSUFFICIENT_EVIDENCE", {
      class: "INSUFFICIENT_SAMPLE",
      detail: "The readable range is empty. No audit presence or rate question can be asked; this is never SILENT.",
    });
  }

  const window = section.windowSteps;
  const minimum = section.minAuditsPerWindow;
  if (window === undefined || minimum === undefined) {
    const audits = entries.filter((entry) => matches(entry, section.auditClass));
    const base = {
      blindReasonCodes: [] as Op2BlindReasonCode[],
      recordsExamined: entries.length,
      auditsInScope: audits.length,
    };
    if (audits.length === 0) {
      const finding: Finding = {
        code: "OP2_AUDIT_OBLIGATION_BREACH",
        detail: `Presence-only mode found zero matching audit records in ${entries.length} readable record(s).`,
      };
      return {
        ...base,
        verdict: withCeilings(
          alarm(OP2_AUDIT_PRESENCE_SENSOR_ID, "The declared audit obligation has no matching record in the readable range.", [finding]),
          OP2_PRESENCE_MODE_CEILING
        ),
      };
    }
    return {
      ...base,
      verdict: withCeilings(
        silent(OP2_AUDIT_PRESENCE_SENSOR_ID, `${entries.length} record(s); presence-only mode found ${audits.length} declared audit record(s)`),
        OP2_PRESENCE_MODE_CEILING
      ),
    };
  }

  const end = entries[entries.length - 1].sequenceNumber;
  const start = end - window;
  const audits = entries.filter((entry) =>
    entry.sequenceNumber >= start && entry.sequenceNumber <= end && matches(entry, section.auditClass)
  );
  const base = {
    blindReasonCodes: [] as Op2BlindReasonCode[],
    recordsExamined: entries.length,
    auditsInScope: audits.length,
    trailingWindow: { start, end },
  };

  if (audits.length < minimum) {
    const finding: Finding = {
      code: "OP2_AUDIT_OBLIGATION_BREACH",
      detail: `trailing inclusive window [${start}, ${end}] contains ${audits.length} matching audit(s), below injected minimum ${minimum}.`,
    };
    return {
      ...base,
      verdict: withCeilings(
        alarm(OP2_AUDIT_PRESENCE_SENSOR_ID, "The declared audit rate is below its injected trailing-window minimum.", [finding]),
        OP2_RATE_MODE_CEILING
      ),
    };
  }
  return {
    ...base,
    verdict: withCeilings(
      silent(OP2_AUDIT_PRESENCE_SENSOR_ID, `trailing inclusive window [${start}, ${end}] with ${audits.length} matching audit(s), meeting injected minimum ${minimum}`),
      OP2_RATE_MODE_CEILING
    ),
  };
}

function sectionStatus(profile: OperatorLayerProfile | undefined): string {
  const section = profile?.auditObligation;
  if (section === undefined) return "auditObligation section status: ABSENT (OP2_PROFILE_ABSENT).";
  if (!usableClass(section.auditClass)) return "auditObligation section status: VACUOUS (OP2_PROFILE_VACUOUS).";
  if ((section.windowSteps !== undefined && !positiveInteger(section.windowSteps)) ||
      (section.minAuditsPerWindow !== undefined && !positiveInteger(section.minAuditsPerWindow))) return "auditObligation section status: MALFORMED (OP2_PROFILE_MALFORMED).";
  return `auditObligation section status: DECLARED (${section.windowSteps !== undefined && section.minAuditsPerWindow !== undefined ? "rate" : "presence-only"} mode).`;
}

export function op2AuditPresenceScopeBlockText(profile?: OperatorLayerProfile, readableLoadStates?: readonly string[]): string {
  return formatScopeBlock(
    "MICA/op2-audit-presence — declared arbiter-audit presence/rate reader",
    [
      "sequenceNumber for the trailing inclusive activity window; never as time.",
      "moduleId + eventType only to match the injected audit class.",
      "verify(), getLoadState(), and getAll() through the shared readability gate.",
    ],
    [...OP2_AUDIT_PRESENCE_CEILING_LINES, OP2_RATE_MODE_CEILING, OP2_PRESENCE_MODE_CEILING],
    OP2_COMPETENCE_LINES,
    [sectionStatus(profile), OP2_SITE_THIRTEEN, ...loadStateScopeLines(readableLoadStates)]
  );
}

export function printOp2AuditPresenceScope(profile?: OperatorLayerProfile, readableLoadStates?: readonly string[]): void {
  printScopeBlock(
    "MICA/op2-audit-presence — declared arbiter-audit presence/rate reader",
    ["sequenceNumber window and the injected class match; no timestamp."],
    [...OP2_AUDIT_PRESENCE_CEILING_LINES, OP2_RATE_MODE_CEILING, OP2_PRESENCE_MODE_CEILING],
    OP2_COMPETENCE_LINES,
    [sectionStatus(profile), OP2_SITE_THIRTEEN, ...loadStateScopeLines(readableLoadStates)]
  );
}
