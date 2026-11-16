// ── MICA · doctor wire — a doctor's finding, as a raising ────────────────────
//
// WHAT THIS IS
//
//   The doctor (07a) reports one of four findings. Three of them are adverse —
//   DEGRADATION-ATTESTED, CORRUPTION-ATTESTED, CANNOT-READ — and until v0.1.0 an
//   adverse finding reached no one who has to act on it. This file maps each of
//   those three to ONE notice envelope, raised through notify exactly as every
//   other raising is: the whole roster, no order, no priority, no timer. The
//   fourth, NO-CORRUPTION-DETECTED, raises nothing.
//
// WHY IT LIVES OUTSIDE src/mica/ (audit ruling F1, 2026-11-02)
//
//   Every file under src/mica/ is pinned by the core door, a NEW file included.
//   This adapter only CALLS notify; it changes none of notify's files, wording
//   or ceilings, so it sits outside the door, unpinned, and is reviewed at bytes
//   instead. It is not an EscalationRecord and touches no record schema: the
//   raising lands in notify's own notice book, in notify's own closed shape.
//
// WHAT IT DOES NOT DO
//
//   It does not decide that a finding is true, grade it, or shape the window and
//   scope it was given: those travel verbatim, one line each. It does not name
//   who submitted beyond the declared uid line the caller hands it (identity
//   separation is ROADMAP R-02, not built).

import type { NoticeEnvelope } from "../mica/notify";
import { hasExactKeys, isObject, isString } from "../mica/store/validate";
import type { Parsed } from "../mica/store/validate";

/** The source every doctor-finding raising carries. One path, one id. */
export const DOCTOR_FINDING_SOURCE_ID = "MICA/doctor-finding";

/** The doctor's four findings, as 07a names them. */
export const DOCTOR_FINDINGS = [
  "NO-CORRUPTION-DETECTED",
  "DEGRADATION-ATTESTED",
  "CORRUPTION-ATTESTED",
  "CANNOT-READ",
] as const;

export type DoctorFindingKind = (typeof DOCTOR_FINDINGS)[number];

/** The three that raise. NO-CORRUPTION-DETECTED is absent on purpose. */
export const RAISING_FINDINGS: readonly DoctorFindingKind[] = [
  "DEGRADATION-ATTESTED",
  "CORRUPTION-ATTESTED",
  "CANNOT-READ",
];

/** One finding as submitted: the kind, and the window and scope as given. */
export interface DoctorFinding {
  readonly kind: DoctorFindingKind;
  readonly window: string;
  readonly scope: string;
}

const FINDING_KEYS = ["kind", "window", "scope"] as const;

/**
 * The closed shape of a submitted finding, or the reason it is refused.
 *
 * A line break inside window or scope is refused rather than split: the notice
 * carries one entry per line, and splitting would change what was given.
 */
export function parseFinding(value: unknown): DoctorFinding | string {
  if (!isObject(value) || !hasExactKeys(value as Parsed, FINDING_KEYS)) {
    return `a finding is exactly {${FINDING_KEYS.join(", ")}}; this one is not`;
  }
  const o = value as Parsed;
  if (!isString(o.kind) || !(DOCTOR_FINDINGS as readonly string[]).includes(o.kind)) {
    return `kind must be one of ${DOCTOR_FINDINGS.join(", ")}`;
  }
  for (const key of ["window", "scope"] as const) {
    const field = o[key];
    if (!isString(field) || field.length === 0) return `${key} must be a non-empty string`;
    if (/[\r\n]/.test(field)) return `${key} must be one line; it is carried as given, never split`;
  }
  return { kind: o.kind as DoctorFindingKind, window: o.window as string, scope: o.scope as string };
}

/** True for the three findings that raise a notice. */
export function findingRaises(kind: DoctorFindingKind): boolean {
  return RAISING_FINDINGS.includes(kind);
}

/**
 * The envelope for one adverse finding, or null for NO-CORRUPTION-DETECTED.
 *
 * `sequence` is notify's caller-supplied index and NOT the raising's identity: a
 * fresh process can repeat it. A reply names a raising by the notice book's own
 * record sequenceNumber and hash (audit condition, 2026-11-02), never by this.
 */
export function findingEnvelope(
  finding: DoctorFinding,
  submitterLine: string,
  sequence: number
): NoticeEnvelope | null {
  if (!findingRaises(finding.kind)) return null;
  return {
    sourceId: DOCTOR_FINDING_SOURCE_ID,
    kind: finding.kind,
    lines: [
      `doctor finding: ${finding.kind}`,
      `window: ${finding.window}`,
      `scope: ${finding.scope}`,
      submitterLine,
    ],
    sequence,
  };
}
