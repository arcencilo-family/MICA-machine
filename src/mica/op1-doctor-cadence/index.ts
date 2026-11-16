// ── MICA · OP-1 doctor-attestation cadence ──────────────────────────────────

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

export const OP1_DOCTOR_CADENCE_SENSOR_ID = "MICA/op1-doctor-cadence";

export type Op1BlindReasonCode =
  | "OP1_READABILITY_GATE"
  | "OP1_PROFILE_ABSENT"
  | "OP1_PROFILE_VACUOUS"
  | "OP1_PROFILE_MALFORMED"
  | "OP1_INSUFFICIENT_EVIDENCE";

export interface Op1DoctorCadenceResult {
  readonly verdict: SensorVerdict;
  readonly blindReasonCodes: readonly Op1BlindReasonCode[];
  readonly recordsExamined: number;
  readonly attestationCount: number;
}

export const OP1_BOUND_MODE_CEILING =
  "BOUND MODE: cadence is measured only in sequence-steps; exact-bound gaps conform and a gap one step larger alarms.";

export const OP1_PRESENCE_MODE_CEILING =
  "PRESENCE-ONLY / LOUDER: staleness is unbounded — a single attestation of any age satisfies this mode.";

export const OP1_DOCTOR_CADENCE_CEILING_LINES: readonly string[] = [
  "SEQUENCE-STEPS ARE NOT TIME — a quiet system makes an absent doctor look punctual; a busy system makes a punctual doctor look absent. This is a dosimeter of activity, never duration.",
  "GAP NEVER CAUSE — fatigue, capture, abandonment, death, and a suppressed append pipeline are identical in a gap. This reader alarms the gap and types nothing else.",
  "CLASS PRESENCE, NOT CONTENT — a hollow attestation of the right class reads as kept cadence. Form, never truth.",
  "PARTIAL INDEPENDENCE, DEPLOYMENT-CONDITIONAL — the class is doctor-authored but rides the deployment log; independence is only as real as the deployed append path.",
  "NOT clerk1.gap, NOT B3 — OP-1 reads the DEPLOYMENT log for the DECLARED doctor class. The deployment record, Clerk-1 delivery gap, and doctor B3 decision-latency record are three different objects and must not be counted as one another.",
];

const OP1_SITE_THIRTEEN =
  "SITE THIRTEEN FLAGGED (one layer-profile, three sections, per-section vacuity independent — arbiter-ruled (ii), 2026-08-21).";

const OP1_COMPETENCE_LINES: readonly string[] = [
  ...COMMON_COMPETENCE_LINES,
  "That the reader keeps the deployment record, Clerk-1 delivery-gap record, and doctor B3 decision-latency record distinct.",
  "That the reader does not translate sequence distance into elapsed time.",
];

function ceilingText(modeLine?: string): string {
  return [
    modeLine,
    ...OP1_DOCTOR_CADENCE_CEILING_LINES,
    OP1_SITE_THIRTEEN,
  ].filter((line): line is string => line !== undefined).join(" || ");
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

function blind(code: Op1BlindReasonCode, path: BlindPath): Op1DoctorCadenceResult {
  return {
    verdict: withCeilings(cannotAssess(OP1_DOCTOR_CADENCE_SENSOR_ID, [path])),
    blindReasonCodes: [code],
    recordsExamined: 0,
    attestationCount: 0,
  };
}

export function assessOp1DoctorCadence(
  log: MicaReadableLog,
  profile: OperatorLayerProfile | undefined,
  readableLoadStates?: readonly string[]
): Op1DoctorCadenceResult {
  const unreadable = assessLogReadability(log, OP1_DOCTOR_CADENCE_SENSOR_ID, readableLoadStates);
  if (unreadable !== null) {
    return {
      verdict: withCeilings(unreadable),
      blindReasonCodes: ["OP1_READABILITY_GATE"],
      recordsExamined: 0,
      attestationCount: 0,
    };
  }

  const section = profile?.doctorCadence;
  if (section === undefined) {
    return blind("OP1_PROFILE_ABSENT", {
      class: "MISSING_CONFIGURATION",
      detail: "OP1_PROFILE_ABSENT: no doctorCadence section was injected; another operator-profile section cannot repair it.",
    });
  }
  if (!usableClass(section.attestationClass)) {
    return blind("OP1_PROFILE_VACUOUS", {
      class: "MISSING_CONFIGURATION",
      detail: "OP1_PROFILE_VACUOUS: doctorCadence is present but attestationClass has an empty moduleId or eventType.",
    });
  }
  if (section.cadenceBoundSteps !== undefined && !positiveInteger(section.cadenceBoundSteps)) {
    return blind("OP1_PROFILE_MALFORMED", {
      class: "MISSING_CONFIGURATION",
      detail: "OP1_PROFILE_MALFORMED: cadenceBoundSteps must be a positive integer when present.",
    });
  }

  const entries = [...log.getAll()].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  if (entries.length === 0) {
    return blind("OP1_INSUFFICIENT_EVIDENCE", {
      class: "INSUFFICIENT_SAMPLE",
      detail: "The readable range is empty. No cadence or presence question can be asked; this is never SILENT.",
    });
  }

  const attestations = entries.filter((entry) => matches(entry, section.attestationClass));
  const base = {
    blindReasonCodes: [] as Op1BlindReasonCode[],
    recordsExamined: entries.length,
    attestationCount: attestations.length,
  };
  const bound = section.cadenceBoundSteps;

  if (bound === undefined) {
    if (attestations.length === 0) {
      const finding: Finding = {
        code: "OP1_ATTESTATION_GAP",
        detail: `Presence-only mode found zero declared doctor attestations in ${entries.length} readable record(s).`,
      };
      return {
        ...base,
        verdict: withCeilings(
          alarm(OP1_DOCTOR_CADENCE_SENSOR_ID, "The standing doctor-attestation duty has no matching record in the readable range.", [finding]),
          OP1_PRESENCE_MODE_CEILING
        ),
      };
    }
    return {
      ...base,
      verdict: withCeilings(
        silent(OP1_DOCTOR_CADENCE_SENSOR_ID, `${entries.length} record(s); presence-only mode found ${attestations.length} declared doctor attestation(s)`),
        OP1_PRESENCE_MODE_CEILING
      ),
    };
  }

  const start = entries[0].sequenceNumber;
  const end = entries[entries.length - 1].sequenceNumber;
  const findings: Finding[] = [];
  if (attestations.length === 0) {
    const span = end - start;
    if (span > bound) {
      findings.push({
        code: "OP1_ATTESTATION_GAP",
        detail: `maximal gap ${start}→${end} spans ${span} sequence-step(s), above injected bound ${bound}.`,
      });
    }
  } else {
    const positions = attestations.map((entry) => entry.sequenceNumber);
    const spans: Array<[number, number]> = [[start, positions[0]]];
    for (let i = 1; i < positions.length; i++) spans.push([positions[i - 1], positions[i]]);
    spans.push([positions[positions.length - 1], end]);
    for (const [from, to] of spans) {
      const gap = to - from;
      if (gap > bound) {
        findings.push({
          code: "OP1_ATTESTATION_GAP",
          detail: `gap ${from}→${to} spans ${gap} sequence-step(s), above injected bound ${bound}.`,
        });
      }
    }
  }

  if (findings.length > 0) {
    return {
      ...base,
      verdict: withCeilings(
        alarm(OP1_DOCTOR_CADENCE_SENSOR_ID, `${findings.length} doctor-attestation cadence gap(s) exceeded the injected sequence-step bound ${bound}.`, findings),
        OP1_BOUND_MODE_CEILING
      ),
    };
  }
  return {
    ...base,
    verdict: withCeilings(
      silent(OP1_DOCTOR_CADENCE_SENSOR_ID, `${entries.length} record(s); every observed head, consecutive, and tail cadence gap was at most ${bound} sequence-step(s)`),
      OP1_BOUND_MODE_CEILING
    ),
  };
}

function sectionStatus(profile: OperatorLayerProfile | undefined): string {
  const section = profile?.doctorCadence;
  if (section === undefined) return "doctorCadence section status: ABSENT (OP1_PROFILE_ABSENT).";
  if (!usableClass(section.attestationClass)) return "doctorCadence section status: VACUOUS (OP1_PROFILE_VACUOUS).";
  if (section.cadenceBoundSteps !== undefined && !positiveInteger(section.cadenceBoundSteps)) return "doctorCadence section status: MALFORMED (OP1_PROFILE_MALFORMED).";
  return `doctorCadence section status: DECLARED (${section.cadenceBoundSteps === undefined ? "presence-only" : "bounded"} mode).`;
}

export function op1DoctorCadenceScopeBlockText(
  profile?: OperatorLayerProfile,
  readableLoadStates?: readonly string[]
): string {
  return formatScopeBlock(
    "MICA/op1-doctor-cadence — declared doctor-attestation gap reader",
    [
      "sequenceNumber for readable-range head, consecutive, and tail gaps; never as time.",
      "moduleId + eventType only to match the injected doctor attestation class.",
      "verify(), getLoadState(), and getAll() through the shared readability gate.",
    ],
    [...OP1_DOCTOR_CADENCE_CEILING_LINES, OP1_BOUND_MODE_CEILING, OP1_PRESENCE_MODE_CEILING],
    OP1_COMPETENCE_LINES,
    [sectionStatus(profile), OP1_SITE_THIRTEEN, ...loadStateScopeLines(readableLoadStates)]
  );
}

export function printOp1DoctorCadenceScope(profile?: OperatorLayerProfile, readableLoadStates?: readonly string[]): void {
  printScopeBlock(
    "MICA/op1-doctor-cadence — declared doctor-attestation gap reader",
    ["sequenceNumber gaps and the injected class match; no timestamp."],
    [...OP1_DOCTOR_CADENCE_CEILING_LINES, OP1_BOUND_MODE_CEILING, OP1_PRESENCE_MODE_CEILING],
    OP1_COMPETENCE_LINES,
    [sectionStatus(profile), OP1_SITE_THIRTEEN, ...loadStateScopeLines(readableLoadStates)]
  );
}
