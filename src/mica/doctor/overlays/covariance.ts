// ── MICA · B8 co-collapse covariance overlay (§5.3) ───────────────────────────
//
// WHAT min() AND THE SHAPE-OVERLAYS MISS
//
//   Canon §5.3: min() reads the vector's LEVEL, §5.1/§5.2 read its SHAPE at an
//   instant — none read CO-MOVEMENT. Two factors declining TOGETHER (the K/Sig/Eng
//   co-collapse, CC4) can mask a systemic collapse as a single local dip. This
//   overlay is a moving cross-correlation over the GRADIENTS of the factor bounds,
//   pairwise. It makes correlated decline visible to the doctor. Typed IDENTICALLY
//   to §5.1/§5.2 — REPORT-ONLY, never a term in f(); Gemini's covariance-in-f()
//   was declined (Round-2), and that decline is the whole point of the overlay
//   existing instead of a ceiling penalty.
//
// ── THE D-15 CAVEAT, PRINTED IN EVERY REPORT (brief §1) ────────────────────────
//
//   Factor-independence is PILOT-UNVERIFIED. Covariance over possibly-DEPENDENT
//   factors is not the same object as covariance over independent ones: a high
//   correlation may be structure the wiring imposes, not a co-collapse in the
//   world. Canon §5.3 also parks Émilie's corr≠cause (two independent factors
//   dropping under a common shock read as systemic collapse) as ROUTED, not
//   decided. Both ride in the caveats of every B8 report.
//
//   Method-variance correction (§5.3 "after method-variance correction") is NOT
//   available: the built machine exposes no per-factor method variance to correct
//   by. That absence is stated in every report, not silently skipped.

import type { SubstrateHistory } from "../history";
import {
  alignedSeries,
  formatOverlayScope,
  gradients,
  overlayCannotAssess,
  overlayRead,
} from "./types";
import type { OverlayBlindPath, OverlayReport } from "./types";

export const B8_OVERLAY_ID = "MICA/overlay/B8-co-collapse-covariance";

export const B8_D15_CAVEAT =
  "D-15: FACTOR-INDEPENDENCE IS PILOT-UNVERIFIED. This covariance is taken over " +
  "factors that may be dependent by construction; a high correlation may be wiring " +
  "structure, not a co-collapse in the world. Per §5.3 the corr≠cause case (two " +
  "independent factors dropping under a common external shock) is ROUTED, not " +
  "decided. Read the pairwise correlations as a doctor signal to look, never as a " +
  "finding.";

export const B8_NO_METHOD_VARIANCE_CAVEAT =
  "NO METHOD-VARIANCE CORRECTION: §5.3 specifies correlation AFTER method-variance " +
  "correction; the built machine exposes no per-factor method variance to correct " +
  "by, so the correlation is uncorrected. Stated, not skipped.";

export interface B8Config {
  /**
   * How many recent reads the moving correlation is taken over. INJECTED, no
   * default. A positive integer ≥ 3 (a correlation over gradients needs at least
   * two gradient points, i.e. three reads).
   */
  readonly covarianceWindow?: number;
  /**
   * The minimum number of gradient points a pair needs before a correlation is
   * computed for it. INJECTED, no default. A positive integer ≥ 2.
   */
  readonly minGradientPoints?: number;
  /**
   * Report-only. Correlation at or above this, with both factors trending DOWN
   * over the window, is flagged as a CO-DECLINE pair in the report. OPTIONAL:
   * absent ⇒ pairs are reported with their correlations but none is flagged, and
   * the report says so. A finite number in [-1,1].
   */
  readonly coDeclineFloor?: number;
}

/**
 * PRE-PILOT PROXY, subject to calibration. Not a default: nothing here reads it.
 *   covarianceWindow: 10  — the §5.3 re-attack's W.
 *   minGradientPoints: 3  — small-sample floor for a correlation.
 *   coDeclineFloor: 0.7   — strong positive co-movement of two falling factors.
 */
export const B8_PROXY_CALIBRATION = {
  covarianceWindow: 10,
  minGradientPoints: 3,
  coDeclineFloor: 0.7,
  provenance:
    "PRE-PILOT PROXY, subject to calibration. STARTING values, not defaults; " +
    "nothing in this module consults this constant.",
} as const;

export interface B8Pair {
  readonly a: string;
  readonly b: string;
  /** Pearson correlation of the two gradient series, or null when undefined. */
  readonly correlation: number | null;
  /** Why null, when it is (a flat series has zero variance). */
  readonly note: string | null;
  /** Both factors' net bound change over the window (end - start). */
  readonly netChangeA: number;
  readonly netChangeB: number;
  /** True only when correlation ≥ coDeclineFloor AND both net changes < 0. */
  readonly coDecline: boolean;
}

export interface B8Data {
  readonly covarianceWindow: number;
  readonly minGradientPoints: number;
  readonly coDeclineFloor: number | null;
  readonly factors: readonly string[];
  readonly readCount: number;
  readonly pairs: readonly B8Pair[];
  readonly coDeclinePairs: readonly B8Pair[];
}

function pearson(x: readonly number[], y: readonly number[]): number | null {
  const n = x.length;
  if (n < 2 || y.length !== n) return null;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null; // a flat series: correlation undefined
  return sxy / Math.sqrt(sxx * syy);
}

export function assessB8(
  history: SubstrateHistory,
  config?: B8Config
): OverlayReport<B8Data> {
  const missing: OverlayBlindPath[] = [];
  const win = config?.covarianceWindow;
  const minPts = config?.minGradientPoints;
  if (typeof win !== "number" || !Number.isInteger(win) || win < 3) {
    missing.push({
      class: "MISSING_CONFIGURATION",
      detail:
        "covarianceWindow was not injected as an integer ≥ 3. A correlation over " +
        "gradients needs at least two gradient points (three reads); there is no default.",
    });
  }
  if (typeof minPts !== "number" || !Number.isInteger(minPts) || minPts < 2) {
    missing.push({
      class: "MISSING_CONFIGURATION",
      detail:
        "minGradientPoints was not injected as an integer ≥ 2. There is no default.",
    });
  }
  const cdf = config?.coDeclineFloor;
  const cdfUsable =
    typeof cdf === "number" && Number.isFinite(cdf) && cdf >= -1 && cdf <= 1;

  if (missing.length > 0) {
    return overlayCannotAssess(
      B8_OVERLAY_ID,
      "the covariance overlay is not configured; no reading is offered.",
      missing,
      [B8_D15_CAVEAT, B8_NO_METHOD_VARIANCE_CAVEAT]
    );
  }

  const reads = history.getReads();
  const { factors, series, readCount } = alignedSeries(reads, win as number);
  if (readCount < 3) {
    return overlayCannotAssess(
      B8_OVERLAY_ID,
      `only ${readCount} read(s) in the window; a gradient correlation needs at least three.`,
      [
        {
          class: "INSUFFICIENT_HISTORY",
          detail:
            `the window holds ${readCount} read(s); at least three reads (two gradient ` +
            `points) are required. This is blindness, not an absence of co-movement.`,
        },
      ],
      [B8_D15_CAVEAT, B8_NO_METHOD_VARIANCE_CAVEAT]
    );
  }
  if (factors.length < 2) {
    return overlayCannotAssess(
      B8_OVERLAY_ID,
      `only ${factors.length} factor(s) present in every read of the window; covariance needs two.`,
      [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            `${factors.length} factor(s) appear in every read of the window. Co-movement ` +
            `is a relation between two factors; with fewer than two there is no pair to read. ` +
            `Factors that came and went within the window are excluded so a wiring change is ` +
            `not read as a health movement.`,
        },
      ],
      [B8_D15_CAVEAT, B8_NO_METHOD_VARIANCE_CAVEAT]
    );
  }

  const grad = new Map<string, number[]>();
  const net = new Map<string, number>();
  for (const f of factors) {
    const s = series.get(f) as number[];
    grad.set(f, gradients(s));
    net.set(f, s[s.length - 1] - s[0]);
  }

  const pairs: B8Pair[] = [];
  for (let i = 0; i < factors.length; i++) {
    for (let j = i + 1; j < factors.length; j++) {
      const a = factors[i];
      const b = factors[j];
      const ga = grad.get(a) as number[];
      const gb = grad.get(b) as number[];
      let correlation: number | null = null;
      let note: string | null = null;
      if (ga.length < (minPts as number)) {
        note = `only ${ga.length} gradient point(s); minGradientPoints=${String(minPts)}`;
      } else {
        correlation = pearson(ga, gb);
        if (correlation === null) {
          note =
            "one of the gradient series is flat (zero variance); correlation is undefined";
        }
      }
      const netA = net.get(a) as number;
      const netB = net.get(b) as number;
      const coDecline =
        cdfUsable &&
        correlation !== null &&
        correlation >= (cdf as number) &&
        netA < 0 &&
        netB < 0;
      pairs.push({ a, b, correlation, note, netChangeA: netA, netChangeB: netB, coDecline });
    }
  }
  const coDeclinePairs = pairs.filter((p) => p.coDecline);

  return overlayRead(
    B8_OVERLAY_ID,
    `co-collapse covariance over ${factors.length} factor(s), ${readCount} read(s): ` +
      `${pairs.length} pair(s) read, ${coDeclinePairs.length} flagged co-declining` +
      `${cdfUsable ? ` (coDeclineFloor=${String(cdf)})` : " (no coDeclineFloor injected: none flagged)"}. ` +
      `Correlated decline surfaced to the doctor, never composed into the floor.`,
    {
      covarianceWindow: win as number,
      minGradientPoints: minPts as number,
      coDeclineFloor: cdfUsable ? (cdf as number) : null,
      factors,
      readCount,
      pairs,
      coDeclinePairs,
    },
    [B8_D15_CAVEAT, B8_NO_METHOD_VARIANCE_CAVEAT]
  );
}

export const B8_SCOPE = formatOverlayScope(
  B8_OVERLAY_ID,
  [
    "the per-factor bound GRADIENTS over the injected window of SUBSTRATE_READ",
    "  records — a pairwise Pearson correlation, surfacing factors that decline",
    "  TOGETHER (the co-movement min() and the shape-overlays are blind to).",
  ],
  [
    "f() / THE FLOOR. The covariance-in-f() term was declined (Round-2); this",
    "  overlay exists precisely so co-movement reaches the doctor and NOT the ceiling.",
    "INDEPENDENCE OF THE FACTORS (D-15). It is pilot-unverified; a high correlation",
    "  may be wiring, not a real co-collapse. Printed in every report, never resolved.",
    "CAUSE. corr≠cause: a common external shock reads as systemic collapse. §5.3",
    "  routes this, does not decide it; B8 reports the correlation, not a cause.",
    "METHOD VARIANCE. §5.3 wants correction by it; the machine exposes none, so the",
    "  correlation is uncorrected — stated in every report.",
    "THE WITHIN-NOMINAL PHASE-SHIFT RESIDUAL. A staggered drift with no two factors",
    "  co-moving within one window defeats the early co-movement warning; min() and",
    "  B9 remain the backstops. Named bounded residual (§5.3 (A)), not closed here.",
  ]
);
