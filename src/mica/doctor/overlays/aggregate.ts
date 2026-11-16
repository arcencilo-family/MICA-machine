// ── MICA · B9 aggregate-decline overlay (§5.4) ────────────────────────────────
//
// WHAT THE OTHER THREE MISS
//
//   Canon §5.4: min() reads the single weakest factor; §5.1/§5.2 read the vector's
//   shape at an instant; §5.3 reads co-movement at a window. NONE reads the SLOW
//   DISTRIBUTED DRIFT of the whole — overall health sliding (0.90 → 0.82) with no
//   single factor near critical, recorded in every per-factor curve but actioned
//   nowhere. B9 makes that one legible object: "distributed cumulative decline,
//   slope negative, was X now Y." It is the temporal complement to the instantaneous
//   overlays and the surfacing organ for §5.3's within-NOMINAL co-erosion residual.
//
//   Typed IDENTICALLY to §5.1–§5.3, and here the bar is load-bearing: it feeds the
//   warm report and the outside-node channel ONLY; never touches the ceiling, never
//   enters f(), never modifies a state, never latches, never authors a verdict. A
//   show-not-enforce view over recorded data cannot manufacture a false all-clear.
//
// ── THE PROACTIVE EARLY CALL (arbiter-ruled v0.4-patch-2) ────────────────────────
//
//   On a SUSTAINED negative aggregate slope — a bad trend that has not (and may
//   never) reach the hard-alarm path — B9 surfaces an EARLY CALL to the outside
//   node: SALIENCE, never enforcement. It pings/recommends a look; it never
//   throttles, clears, latches, or touches f(). This is the proactive face of the
//   §4.5 partner gradient — call the partner BEFORE the loop. The hard-alarm path
//   (latch → Sig-degrade → min() → CRITICAL) is unchanged and sits entirely beside
//   it. The early call is an EVENT IN THE REPORT, never a disposition.
//
//   Calibration owns WHEN/HOW OFTEN/HOW LOUD (the slope threshold, the sustain
//   window). This build owns only THAT the lens pings on a sustained trend. Both
//   the annoyance residual (over-cautious → alarm fatigue → a real call missed) and
//   the gaming residual (mask the slope) are named, not closed.
//
//   The A3(i) M5 per-factor port (§5.4) — single-parameter rolling-decline triggers
//   on b⃗ — is a NARROWING enrichment, not the core aggregate read. It is left as a
//   stated open edge (build record), so this overlay ships the core §5.4 object
//   without a second declared-config surface the ninth-site ruling would gate.

import type { SubstrateHistory } from "../history";
import {
  alignedSeries,
  formatOverlayScope,
  overlayCannotAssess,
  overlayRead,
} from "./types";
import type { OverlayBlindPath, OverlayReport } from "./types";

export const B9_OVERLAY_ID = "MICA/overlay/B9-aggregate-decline";

export interface B9Config {
  /**
   * How many recent reads the aggregate trajectory is taken over. INJECTED, no
   * default. A positive integer ≥ 2 (a slope needs two points).
   */
  readonly aggregateWindow?: number;
  /**
   * The per-read slope (change in mean bound per read) at or BELOW which the trend
   * counts as a bad trend. A negative finite number. INJECTED, no default. Absent ⇒
   * the trajectory is still reported, but NO early call is raised and the report
   * says so (the slope needs a line to cross).
   */
  readonly slopeThreshold?: number;
  /**
   * How many of the most recent per-read steps must ALL be non-positive for the
   * bad trend to count as SUSTAINED before an early call is raised. INJECTED, no
   * default. A positive integer. Absent ⇒ no early call (sustain is undefined).
   */
  readonly sustainSteps?: number;
}

/**
 * PRE-PILOT PROXY, subject to calibration. Not a default: nothing here reads it.
 *   aggregateWindow: 10 — the window the slow drift is read over.
 *   slopeThreshold: -0.01 — a persistent slide of ~1% of a bound-unit per read.
 *   sustainSteps: 4 — four consecutive non-rising steps before the ping.
 */
export const B9_PROXY_CALIBRATION = {
  aggregateWindow: 10,
  slopeThreshold: -0.01,
  sustainSteps: 4,
  provenance:
    "PRE-PILOT PROXY, subject to calibration. STARTING values, not defaults; " +
    "nothing in this module consults this constant. Calibration owns WHEN/HOW OFTEN/" +
    "HOW LOUD; this build owns only THAT it pings on a sustained trend.",
} as const;

export interface B9Data {
  readonly aggregateWindow: number;
  readonly readCount: number;
  readonly factors: readonly string[];
  /** Mean bound per read over the window, in read order. */
  readonly aggregateSeries: readonly number[];
  /** Least-squares slope of aggregateSeries per read step. */
  readonly slope: number;
  readonly wasValue: number;
  readonly nowValue: number;
  readonly slopeThreshold: number | null;
  readonly sustainSteps: number | null;
  /** The count of trailing non-positive steps (the sustain evidence). */
  readonly trailingNonPositiveSteps: number;
  /** True only when slope ≤ threshold AND the sustain condition is met. */
  readonly earlyCall: boolean;
  readonly earlyCallReason: string | null;
}

/** Least-squares slope of y against index 0..n-1. */
function slopeOf(y: readonly number[]): number {
  const n = y.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - mx;
    sxy += dx * (y[i] - my);
    sxx += dx * dx;
  }
  return sxx === 0 ? 0 : sxy / sxx;
}

export function assessB9(
  history: SubstrateHistory,
  config?: B9Config
): OverlayReport<B9Data> {
  const win = config?.aggregateWindow;
  if (typeof win !== "number" || !Number.isInteger(win) || win < 2) {
    return overlayCannotAssess(
      B9_OVERLAY_ID,
      "the aggregate-decline overlay is not configured; no reading is offered.",
      [
        {
          class: "MISSING_CONFIGURATION",
          detail:
            "aggregateWindow was not injected as an integer ≥ 2. A slope needs two " +
            "points and there is no default.",
        },
      ]
    );
  }

  const reads = history.getReads();
  const { factors, series, readCount } = alignedSeries(reads, win);
  if (readCount < 2) {
    return overlayCannotAssess(
      B9_OVERLAY_ID,
      `only ${readCount} read(s) in the window; a trajectory needs at least two.`,
      [
        {
          class: "INSUFFICIENT_HISTORY",
          detail:
            `the window holds ${readCount} read(s); at least two are required for a ` +
            `slope. Blindness, not a flat trajectory.`,
        },
      ]
    );
  }
  if (factors.length === 0) {
    return overlayCannotAssess(
      B9_OVERLAY_ID,
      "no factor is present in every read of the window; there is no aggregate to trend.",
      [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            "no factor appears in every read of the window (factors that came and " +
            "went are excluded so a wiring change is not read as a health movement). " +
            "There is no stable aggregate to take a trajectory of.",
        },
      ]
    );
  }

  // Aggregate = mean bound across the stable factor set, per read.
  const aggregateSeries: number[] = [];
  for (let i = 0; i < readCount; i++) {
    let sum = 0;
    for (const f of factors) sum += (series.get(f) as number[])[i];
    aggregateSeries.push(sum / factors.length);
  }
  const slope = slopeOf(aggregateSeries);
  const wasValue = aggregateSeries[0];
  const nowValue = aggregateSeries[aggregateSeries.length - 1];

  // Trailing non-positive steps: the sustain evidence.
  let trailing = 0;
  for (let i = aggregateSeries.length - 1; i > 0; i--) {
    if (aggregateSeries[i] - aggregateSeries[i - 1] <= 0) trailing++;
    else break;
  }

  const thr = config?.slopeThreshold;
  const thrUsable = typeof thr === "number" && Number.isFinite(thr) && thr < 0;
  const sustain = config?.sustainSteps;
  const sustainUsable =
    typeof sustain === "number" && Number.isInteger(sustain) && sustain > 0;

  let earlyCall = false;
  let earlyCallReason: string | null = null;
  if (!thrUsable || !sustainUsable) {
    earlyCallReason =
      "NO EARLY CALL EVALUATED: " +
      (!thrUsable ? "no negative slopeThreshold was injected" : "") +
      (!thrUsable && !sustainUsable ? "; " : "") +
      (!sustainUsable ? "no sustainSteps was injected" : "") +
      ". The trajectory is reported; the ping needs a line and a sustain to cross.";
  } else if (slope <= (thr as number) && trailing >= (sustain as number)) {
    earlyCall = true;
    earlyCallReason =
      `EARLY CALL: slope=${slope.toFixed(5)} ≤ threshold=${String(thr)} and the last ` +
      `${trailing} step(s) were non-rising (sustainSteps=${String(sustain)}). A sustained ` +
      `distributed decline, was ${wasValue.toFixed(4)} now ${nowValue.toFixed(4)}. This is ` +
      `SALIENCE to the outside node — a recommendation to look — never enforcement, never a ` +
      `throttle, never a term in the floor.`;
  } else {
    earlyCallReason =
      `no early call: slope=${slope.toFixed(5)} (threshold=${String(thr)}), trailing ` +
      `non-rising steps=${trailing} (sustainSteps=${String(sustain)}).`;
  }

  return overlayRead(
    B9_OVERLAY_ID,
    `aggregate-decline over ${factors.length} factor(s), ${readCount} read(s): ` +
      `slope=${slope.toFixed(5)} per read, was ${wasValue.toFixed(4)} now ` +
      `${nowValue.toFixed(4)}. ${earlyCall ? "EARLY CALL RAISED (salience)." : "no early call."} ` +
      `Show-not-enforce; the hard-alarm path is untouched and sits beside this.`,
    {
      aggregateWindow: win,
      readCount,
      factors,
      aggregateSeries,
      slope,
      wasValue,
      nowValue,
      slopeThreshold: thrUsable ? (thr as number) : null,
      sustainSteps: sustainUsable ? (sustain as number) : null,
      trailingNonPositiveSteps: trailing,
      earlyCall,
      earlyCallReason,
    }
  );
}

export const B9_SCOPE = formatOverlayScope(
  B9_OVERLAY_ID,
  [
    "the mean per-read bound across the stable factor set over the injected window",
    "  of SUBSTRATE_READ records — the SLOW DISTRIBUTED DRIFT of the whole, its slope,",
    "  and a proactive EARLY CALL (salience) when the decline is sustained.",
  ],
  [
    "f() / THE FLOOR / ANY STATE. The bar here is load-bearing: B9 never latches,",
    "  never throttles, never clears, never authors a verdict. It is show-not-enforce.",
    "THE HARD-ALARM PATH. latch → Sig-degrade → min() → CRITICAL is unchanged and",
    "  sits entirely beside the early call. B9 is the call BEFORE the alarm, never it.",
    "WHETHER THE NODE LOOKS. The early call is a ping the outside node may ignore;",
    "  the partner-non-response residual (§4.5) advances the gradient, it does not vanish.",
    "THE WITHIN-NOMINAL GLIDE remainder (§5.4 A3(i)). A sub-threshold per-factor glide",
    "  under the aggregate is a narrowing the M5 port would tighten; that port is a",
    "  stated OPEN EDGE, not built here. min() and B8 remain the level/co-movement backstops.",
  ]
);
