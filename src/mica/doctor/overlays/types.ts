// ── MICA · overlay reports — the DOCTOR stream, and the report-only bar ────────
//
// THE ONE BAR THAT MAKES THIS CAMPAIGN LOW-RISK
//
//   An OverlayReport is NEVER a SensorVerdict, NEVER an input to guard(), NEVER a
//   term in the floor. Canon 02b: "the trajectory + latch feed the UNREAD
//   classification and the covariance overlay and nothing else — never a standing
//   health certificate, never a term in f()." An overlay that reached the ceiling
//   would import RMBA's back-door compensation; that is the single design error
//   that would poison the floor.
//
//   The type enforces the routing it can: OverlayReport.kind is "OVERLAY_READ" |
//   "OVERLAY_CANNOT_ASSESS" — neither is a VerdictKind, so an OverlayReport is not
//   structurally a SensorVerdict and cannot be handed to composeFloorKind, which
//   reads VerdictKind. Every report also carries stream: "DOCTOR" and the
//   report-only bar in its caveats, and doctor.test.ts asserts the floor is
//   byte-identical whether or not the overlays run.
//
//   Each overlay reads the SUBSTRATE_READ HISTORY (history.ts) — never a live
//   sensor, never the evidence log. Insufficient history or absent config produces
//   an OVERLAY_CANNOT_ASSESS report (blindness stated), never a silent skip.

/** The report-only bar, printed in every overlay report's caveats. */
export const OVERLAY_REPORT_ONLY_BAR =
  "REPORT-ONLY. This overlay emits to the DOCTOR stream. It is NOT a SensorVerdict, " +
  "is NEVER composed into the chokepoint floor, never enters f(), never modifies a " +
  "state, never authors a verdict, and never stands as a health certificate. It is " +
  "a derived view over history the recorder already wrote; it cannot manufacture a " +
  "false all-clear because it authors nothing.";

/**
 * The proxy-resolution caveat every overlay carries. The bounds it reads are the
 * three-level quantization {ALARM:0, CANNOT_ASSESS:0.5, SILENT:1} (history.ts), not
 * a continuum. Overlays canon-designed over continuous b⃗ are coarse here, and that
 * is stated, not smoothed.
 */
export const OVERLAY_PROXY_RESOLUTION_CAVEAT =
  "PROXY RESOLUTION: the per-factor bounds are the three-level quantization of " +
  "sensor verdict kinds (ALARM=0, CANNOT_ASSESS=0.5, SILENT=1), not a continuous " +
  "substrate. This overlay's read is coarse at that resolution; it is stated, not " +
  "hidden. The built machine owns no finer substrate for it to read.";

/**
 * The F6 downgrade, carried on every overlay report. The {0, 0.5, 1} mapping is
 * ORDINAL — it preserves order for a floor/minimum, which is all the verdict
 * lattice establishes. The EQUAL SPACING is a display convenience, NOT a
 * calibrated interval scale. So every mean, geometric mean, distance, covariance,
 * correlation, and slope this overlay computes from those bounds is an
 * UNCALIBRATED ORDINAL HEURISTIC, not an interval-scale statistic, and its
 * thresholds are uncalibrated too. Two concrete consequences a reader must hold:
 * (i) two ALARMs plus two SILENTs share the arithmetic mean of four CANNOT_ASSESS
 * factors, despite very different failure geometry; (ii) CANNOT_ASSESS=0.5 folds
 * DEGRADED and SUBSTRATE-UNREAD into one middle value, so these aggregates
 * CONFLATE damage with unreadability. None of this reaches the floor (report-only,
 * canon 02b); it bounds how much weight the numbers can carry, and it is stated.
 */
export const OVERLAY_ORDINAL_HEURISTIC_CAVEAT =
  "ORDINAL, NOT INTERVAL (uncalibrated heuristic): the bound mapping ALARM=0, " +
  "CANNOT_ASSESS=0.5, SILENT=1 is ORDINAL — the verdict lattice establishes ORDER " +
  "ONLY, not equal spacing. Every mean, geometric mean, distance, covariance, " +
  "correlation, and slope below is therefore an UNCALIBRATED ORDINAL HEURISTIC, " +
  "not an interval-scale measurement, and its thresholds are uncalibrated. Two " +
  "ALARMs plus two SILENTs carry the SAME arithmetic mean as four CANNOT_ASSESS, " +
  "and CANNOT_ASSESS=0.5 folds DEGRADED (damage) and SUBSTRATE-UNREAD " +
  "(unreadability) into one value — these numbers CONFLATE the two. Read them as " +
  "rank-ordered heuristics, never as calibrated magnitudes. Report-only; no floor " +
  "depends on any of it.";

/**
 * The self-authored-history ceiling (T2). Overlays read a history MICA itself
 * wrote from its own gate decisions. That history's ceiling governs them like
 * everything else: an overlay cannot see past what the recorder recorded, and a
 * fabricated-stable history would be a record-discipline violation, not a clean
 * read this overlay could catch on its own.
 */
export const OVERLAY_SELF_AUTHORED_CEILING =
  "SELF-AUTHORED HISTORY (T2): this overlay reads a history MICA wrote from its own " +
  "gate decisions. It is not an independent measurement of the observed system, and " +
  "it inherits every blindness the recorder had. It reads the record, not the world.";

export type OverlayBlindClass =
  | "INSUFFICIENT_HISTORY"
  | "MISSING_CONFIGURATION"
  | "INELIGIBLE_SCOPE";

export interface OverlayBlindPath {
  readonly class: OverlayBlindClass;
  readonly detail: string;
}

/** A report that DID compute a read. `data` is overlay-specific. */
export interface OverlayReadReport<D> {
  readonly kind: "OVERLAY_READ";
  readonly overlayId: string;
  readonly stream: "DOCTOR";
  readonly summary: string;
  readonly data: D;
  readonly caveats: readonly string[];
}

/** A report that could NOT compute a read. Blindness stated, never a silent skip. */
export interface OverlayCannotAssessReport {
  readonly kind: "OVERLAY_CANNOT_ASSESS";
  readonly overlayId: string;
  readonly stream: "DOCTOR";
  readonly summary: string;
  readonly blindPaths: readonly OverlayBlindPath[];
  readonly caveats: readonly string[];
}

export type OverlayReport<D> =
  | OverlayReadReport<D>
  | OverlayCannotAssessReport;

/** Constructor for a computed read. Bar + proxy + self-authored caveats always ride. */
export function overlayRead<D>(
  overlayId: string,
  summary: string,
  data: D,
  extraCaveats: readonly string[] = []
): OverlayReadReport<D> {
  return {
    kind: "OVERLAY_READ",
    overlayId,
    stream: "DOCTOR",
    summary,
    data,
    caveats: [
      OVERLAY_REPORT_ONLY_BAR,
      OVERLAY_PROXY_RESOLUTION_CAVEAT,
      OVERLAY_ORDINAL_HEURISTIC_CAVEAT,
      OVERLAY_SELF_AUTHORED_CEILING,
      ...extraCaveats,
    ],
  };
}

/** Constructor for a stated blindness. */
export function overlayCannotAssess(
  overlayId: string,
  summary: string,
  blindPaths: readonly OverlayBlindPath[],
  extraCaveats: readonly string[] = []
): OverlayCannotAssessReport {
  return {
    kind: "OVERLAY_CANNOT_ASSESS",
    overlayId,
    stream: "DOCTOR",
    summary,
    blindPaths,
    caveats: [
      OVERLAY_REPORT_ONLY_BAR,
      OVERLAY_PROXY_RESOLUTION_CAVEAT,
      OVERLAY_ORDINAL_HEURISTIC_CAVEAT,
      OVERLAY_SELF_AUTHORED_CEILING,
      ...extraCaveats,
    ],
  };
}

// ── shared history-shaped helpers (read the records; touch no live sensor) ─────

import type { SubstrateReadRecord } from "../history";

/** The bound of each factor at the LAST read, or an empty map when no reads. */
export function latestVector(
  reads: readonly SubstrateReadRecord[]
): Map<string, number> {
  const v = new Map<string, number>();
  if (reads.length === 0) return v;
  for (const f of reads[reads.length - 1].factors) v.set(f.factor, f.bound);
  return v;
}

/**
 * Per-factor bound series over the last `window` reads (all reads if window is
 * null). Only factors PRESENT IN EVERY read of the window are returned, so a
 * gradient or correlation is never taken across a factor that came and went — that
 * would read a wiring change as a health movement. Returned in read order.
 */
export function alignedSeries(
  reads: readonly SubstrateReadRecord[],
  window: number | null
): { factors: string[]; series: Map<string, number[]>; readCount: number } {
  const slice =
    window === null ? reads : reads.slice(Math.max(0, reads.length - window));
  const series = new Map<string, number[]>();
  if (slice.length === 0) return { factors: [], series, readCount: 0 };

  // A factor is eligible only if it appears in every read of the slice.
  const perRead = slice.map(
    (r) => new Map(r.factors.map((f) => [f.factor, f.bound]))
  );
  const candidate = new Set(perRead[0].keys());
  for (const m of perRead) {
    for (const f of [...candidate]) if (!m.has(f)) candidate.delete(f);
  }
  const factors = [...candidate].sort();
  for (const f of factors) {
    series.set(
      f,
      perRead.map((m) => m.get(f) as number)
    );
  }
  return { factors, series, readCount: slice.length };
}

/** Consecutive first differences (gradients) of a numeric series. */
export function gradients(series: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) out.push(series[i] - series[i - 1]);
  return out;
}

// ── overlay scope block (NOT the sensor scope block — overlays are not sensors) ─

export function formatOverlayScope(
  overlayId: string,
  reads: readonly string[],
  doesNotSee: readonly string[]
): string {
  const bar = "─".repeat(74);
  const out: string[] = [];
  out.push(`┌${bar}`);
  out.push(`│ OVERLAY SCOPE — ${overlayId} (DOCTOR stream, REPORT-ONLY)`);
  out.push(`├${bar}`);
  out.push(`│ READS (the SUBSTRATE_READ history only):`);
  for (const r of reads) out.push(`│   ${r}`);
  out.push(`│`);
  out.push(`│ DOES NOT SEE / DOES NOT DO:`);
  for (const d of doesNotSee) out.push(`│   ${d}`);
  out.push(`│`);
  out.push(`│ THE BAR:`);
  for (const line of OVERLAY_REPORT_ONLY_BAR.split(". ")) {
    if (line.trim().length > 0) out.push(`│   ${line.trim()}`);
  }
  out.push(`└${bar}`);
  return out.join("\n");
}
