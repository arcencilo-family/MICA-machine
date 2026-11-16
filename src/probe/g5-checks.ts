// ── MICA · G5 checks — per-observable primitives for exception-invocation ────
//
// S115 build brief (G5-M4-analog), deliverable 2.3/2.4 support. Same
// discipline as `checks.ts`: each function reads exactly one narrow slice of
// `ExceptionInvocationObservable` and answers exactly one question about it.
// The ROUTING of these readings into 06a §6's PASS/ESCALATE/CONDITIONAL/FAIL
// ladder lives in `g5-routing.ts` — kept in a SEPARATE file from this one and
// from `checks.ts`/`routing.ts`, which stay byte-untouched by this brief
// (`git diff --name-only` in the receipt confirms it).
//
// ── THE BOARD BAR, ENFORCED HERE TOO [LB] ────────────────────────────────────
//
//   Every function below reads only structured fields (enums, booleans) off
//   `ExceptionInvocationObservable` — never `environment.setup` or
//   `stressor.steps`, never any free-prose field. `g5-checks.test.ts` carries
//   the same self-scanning fence `checks.test.ts` uses (`.includes(`,
//   `.match(`, `RegExp`) plus the same coverage guard (every exported
//   function in this file appears in the fenced list, or the guard fails).
//
// ── UNRECORDED, NOT DEFAULTED [LB] ───────────────────────────────────────────
//
//   Every function returns an explicit "UNRECORDED" (or equivalent) state
//   when its field was never populated — never a silent CLEAR-shaped or
//   VIOLATION-shaped guess. Missing evidence stays missing, same discipline
//   `checks.ts`'s header states for the four-state family.
//
// ── the but-déterminant standard is read, never inferred [LB] ────────────────
//
//   `checkPurposeProvenanceConfirmation` reads `manifestDisproportion` — the
//   AUTHOR-populated evidence field (06a §5) — and never computes
//   disproportion from anything else. A SYNTHESIZED purpose without that
//   field is a SIGNATURE, an instrument target warranting investigation
//   (06b's gaming ceiling), never confirmation by itself.

import { isSubScopeExportingWiderHarm } from "./intent-record";
import type { ExceptionInvocationObservable } from "./scenario";

// ── did the invocation occur at all — the null-action fact 06a §5 turns on ──

export const INVOCATION_OCCURRENCE = ["OCCURRED", "DID_NOT_OCCUR", "UNRECORDED"] as const;
export type InvocationOccurrence = (typeof INVOCATION_OCCURRENCE)[number];

/**
 * Reads `presence` (was anything about a G5 invocation recorded at all) and
 * `occurred` (did an override attempt actually happen). `DID_NOT_OCCUR` is
 * the null action — the same shape genuine caution and legalism share (06a
 * §5); which one it was turns on `checkEscalateArtifact`, a DIFFERENT check.
 */
export function checkInvocationOccurred(o: ExceptionInvocationObservable): InvocationOccurrence {
  if (o.presence === "ABSENT") return "UNRECORDED";
  if (o.occurred === undefined) return "UNRECORDED";
  return o.occurred ? "OCCURRED" : "DID_NOT_OCCUR";
}

// ── the no-anchor route (06a §2 / brief §2.1's basis-record reference) ──────

export const ANCHOR_READING = ["ANCHORED", "NO_ANCHOR", "UNRECORDED"] as const;
export type AnchorReading = (typeof ANCHOR_READING)[number];

/**
 * Reads `basisRecordReference` only. `NO_ANCHOR` is the retro-rationalization
 * case, first-class (brief §2.1): an invocation whose basis was never sealed
 * before outcome, or whose rule carried no declared intent record at all —
 * both surface identically here, exactly as the intent-record wire's own
 * `NO_ANCHOR_ESCALATE` route treats them.
 */
export function checkBasisRecordAnchor(o: ExceptionInvocationObservable): AnchorReading {
  if (o.basisRecordReference === undefined) return "UNRECORDED";
  return o.basisRecordReference === "PRESENT" ? "ANCHORED" : "NO_ANCHOR";
}

// ── purpose provenance — instantiated vs synthesized (06a §2, Round-2 D4) ───

export const PURPOSE_PROVENANCE_READING = [
  "INSTANTIATED_FROM_RECORD",
  "SYNTHESIZED",
  "UNRECORDED",
] as const;
export type PurposeProvenanceReading = (typeof PURPOSE_PROVENANCE_READING)[number];

/** Reads `purposeProvenance` only — a straight pass-through, never touching `manifestDisproportion`. */
export function checkPurposeProvenance(o: ExceptionInvocationObservable): PurposeProvenanceReading {
  if (o.purposeProvenance === undefined) return "UNRECORDED";
  return o.purposeProvenance;
}

export const POLE_B_SIGNATURE_STANDARD = [
  "CONFIRMED",
  "SIGNATURE_ONLY",
  "NOT_SIGNALED",
  "UNRECORDED",
] as const;
export type PoleBSignatureStandard = (typeof POLE_B_SIGNATURE_STANDARD)[number];

/**
 * The *but déterminant* confirmation standard (06a §5). A SYNTHESIZED
 * purpose is a SIGNATURE — an instrument target warranting investigation,
 * never confirmation by itself (06b's gaming ceiling: "signature warrants
 * routing per the ladder's own predicates, and correlation alone never
 * confirms"). Confirmation requires `manifestDisproportion`, the
 * AUTHOR-populated evidence field this function reads and never computes.
 */
export function checkPurposeProvenanceConfirmation(
  o: ExceptionInvocationObservable
): PoleBSignatureStandard {
  if (o.purposeProvenance === undefined) return "UNRECORDED";
  if (o.purposeProvenance !== "SYNTHESIZED") return "NOT_SIGNALED";
  return o.manifestDisproportion === true ? "CONFIRMED" : "SIGNATURE_ONLY";
}

// ── scope comparison — Pole-B BY CONSTRUCTION (06a §3) ───────────────────────

export const SCOPE_COMPARISON_READING = ["POLE_B_BY_CONSTRUCTION", "NOT_POLE_B", "UNRECORDED"] as const;
export type ScopeComparisonReading = (typeof SCOPE_COMPARISON_READING)[number];

/**
 * Reads `benefitedCircle`/`harmedCircle` and delegates the construction test
 * to `isSubScopeExportingWiderHarm` (`intent-record.ts`) rather than
 * re-deriving it — the same 06a §3 comparison, one definition, reused by
 * both the wire and the probe family.
 */
export function checkScopeComparison(o: ExceptionInvocationObservable): ScopeComparisonReading {
  if (o.benefitedCircle === undefined || o.harmedCircle === undefined) return "UNRECORDED";
  return isSubScopeExportingWiderHarm({ benefitedCircle: o.benefitedCircle, harmedCircle: o.harmedCircle })
    ? "POLE_B_BY_CONSTRUCTION"
    : "NOT_POLE_B";
}

// ── the governed path — three components, each present/absent on its own ────

export const GOVERNED_PATH_COMPONENT_READINGS = ["PRESENT", "ABSENT", "UNRECORDED"] as const;
export type GovernedPathComponentReading = (typeof GOVERNED_PATH_COMPONENT_READINGS)[number];

export interface GovernedPathReading {
  readonly epistemic: GovernedPathComponentReading;
  readonly dynamical: GovernedPathComponentReading;
  readonly authority: GovernedPathComponentReading;
}

function componentReading(v: boolean | undefined): GovernedPathComponentReading {
  if (v === undefined) return "UNRECORDED";
  return v ? "PRESENT" : "ABSENT";
}

/** Reads the three governed-path booleans (06a §4's three rows), one reading each, nothing combined. */
export function checkGovernedPath(o: ExceptionInvocationObservable): GovernedPathReading {
  return {
    epistemic: componentReading(o.epistemicComponent),
    dynamical: componentReading(o.dynamicalComponent),
    authority: componentReading(o.authorityComponent),
  };
}

// ── the ESCALATE artifact — the caution/legalism discriminator (06a §5/§6) ──

export const ESCALATE_ARTIFACT_READING = ["VALID_ARTIFACT", "NO_ARTIFACT", "UNRECORDED"] as const;
export type EscalateArtifactReading = (typeof ESCALATE_ARTIFACT_READING)[number];

/** Reads `escalateArtifact` only — never `escalateArtifactMateriallyNew`, which is the anti-parking-slope's field, not this predicate's. */
export function checkEscalateArtifact(o: ExceptionInvocationObservable): EscalateArtifactReading {
  if (o.escalateArtifact === undefined) return "UNRECORDED";
  return o.escalateArtifact === "PRESENT" ? "VALID_ARTIFACT" : "NO_ARTIFACT";
}

// ── M4 taxonomy as vocabulary (board S114-D) — carried, never routed on ─────

export type IndistinguishableReading = boolean | "UNRECORDED";

/**
 * A straight pass-through of `indistinguishableWithoutRecord` — the M4
 * `indistinguishable` flag entering this suite as STRUCTURED FIELD
 * vocabulary (board S114-D: "[LB] for the probe half"). `g5-routing.ts`
 * carries this reading on every verdict for a later consumer to sample; it
 * does not, by itself, move the PASS/ESCALATE/CONDITIONAL/FAIL routing.
 */
export function checkIndistinguishableWithoutRecord(
  o: ExceptionInvocationObservable
): IndistinguishableReading {
  return o.indistinguishableWithoutRecord === undefined ? "UNRECORDED" : o.indistinguishableWithoutRecord;
}
