// ── MICA · B7 fragility lens overlay (§5.2) ───────────────────────────────────
//
// WHAT IT MAKES VISIBLE
//
//   Canon §5.2: a per-factor brittleness transform amplifying PROXIMITY TO THE
//   DEGRADED THRESHOLD — making approaching-trouble visually loud while it is still
//   approaching, with a max-beacon over the per-factor values. RMBA's lens anchors
//   to a FAIL floor; MICA has no floor, so the lens anchors to the nearest
//   MICA-native object, the degraded threshold. The transform SHAPE (monotone
//   amplification of proximity; per-factor values; a max-beacon) is canon; the
//   constants (the threshold, the proximity window, the curvature) are calibration.
//   The lens changes nothing — it only makes brittleness visible before it becomes
//   an event. REPORT-ONLY.
//
//   Per-factor proximity, from a factor's current bound:
//     p = clamp( (degradedThreshold + proximityWindow - bound) / proximityWindow, 0, 1 )
//     — 0 when the factor sits a full window ABOVE the threshold (safe),
//     — 1 when it is AT or BELOW the threshold (in trouble),
//     — rising as it approaches from above.
//   fragility = p ^ (1 / curvature). curvature > 1 makes a factor a little into the
//   window read LOUD, which is the "loud while still approaching" the canon wants.
//   The max-beacon is max(fragility) and the beacon factor is its argmax.

import type { SubstrateHistory } from "../history";
import {
  formatOverlayScope,
  latestVector,
  overlayCannotAssess,
  overlayRead,
} from "./types";
import type { OverlayBlindPath, OverlayReport } from "./types";

export const B7_OVERLAY_ID = "MICA/overlay/B7-fragility-lens";

export interface B7Config {
  /**
   * The bound at or below which a factor is DEGRADED — the lens's anchor. INJECTED,
   * no default: MICA has no floor and this build does not decide where "degraded"
   * sits. A finite number in [0,1].
   */
  readonly degradedThreshold?: number;
  /**
   * How far ABOVE the threshold (in bound units) counts as "approaching" — the
   * width of the proximity ramp. INJECTED, no default. A finite number > 0.
   */
  readonly proximityWindow?: number;
  /**
   * Curvature of the amplification. > 1 makes approaching loud early; = 1 is
   * linear. INJECTED, no default. A finite number > 0.
   */
  readonly curvature?: number;
}

/**
 * PRE-PILOT PROXY, subject to calibration. Not a default: nothing here reads it.
 *   degradedThreshold: 0.5  — the CANNOT_ASSESS rung is the degraded anchor.
 *   proximityWindow:   0.5  — a factor within half a bound-unit above is approaching.
 *   curvature:         2    — square-root amplification: loud while still approaching.
 */
export const B7_PROXY_CALIBRATION = {
  degradedThreshold: 0.5,
  proximityWindow: 0.5,
  curvature: 2,
  provenance:
    "PRE-PILOT PROXY, subject to calibration. STARTING values, not defaults; " +
    "nothing in this module consults this constant.",
} as const;

export interface B7FactorFragility {
  readonly factor: string;
  readonly bound: number;
  readonly proximity: number;
  readonly fragility: number;
}

export interface B7Data {
  readonly degradedThreshold: number;
  readonly proximityWindow: number;
  readonly curvature: number;
  readonly perFactor: readonly B7FactorFragility[];
  readonly maxBeacon: number;
  readonly beaconFactors: readonly string[];
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function assessB7(
  history: SubstrateHistory,
  config?: B7Config
): OverlayReport<B7Data> {
  const reads = history.getReads();
  if (reads.length === 0) {
    return overlayCannotAssess(
      B7_OVERLAY_ID,
      "no SUBSTRATE_READ records in history yet.",
      [
        {
          class: "INSUFFICIENT_HISTORY",
          detail:
            "the fragility lens reads the latest factor vector's proximity to the " +
            "degraded threshold; there is no vector to read. Blindness, not safety.",
        },
      ]
    );
  }

  const missing: OverlayBlindPath[] = [];
  const thr = config?.degradedThreshold;
  const win = config?.proximityWindow;
  const cur = config?.curvature;
  if (typeof thr !== "number" || !Number.isFinite(thr) || thr < 0 || thr > 1) {
    missing.push({
      class: "MISSING_CONFIGURATION",
      detail:
        "degradedThreshold was not injected as a finite number in [0,1]. MICA has " +
        "no floor of its own, so the lens has nothing to anchor to and does not run.",
    });
  }
  if (typeof win !== "number" || !Number.isFinite(win) || win <= 0) {
    missing.push({
      class: "MISSING_CONFIGURATION",
      detail:
        "proximityWindow was not injected as a finite number > 0. Without a ramp " +
        "width, 'approaching' is undefined and no per-factor value can be formed.",
    });
  }
  if (typeof cur !== "number" || !Number.isFinite(cur) || cur <= 0) {
    missing.push({
      class: "MISSING_CONFIGURATION",
      detail:
        "curvature was not injected as a finite number > 0. The amplification shape " +
        "is calibration, and there is no default.",
    });
  }
  if (missing.length > 0) {
    return overlayCannotAssess(
      B7_OVERLAY_ID,
      "the fragility lens is not fully configured; no reading is offered.",
      missing
    );
  }

  const vector = latestVector(reads);
  const entries = [...vector.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) {
    return overlayCannotAssess(
      B7_OVERLAY_ID,
      "the latest read has an empty factor vector.",
      [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            "a per-factor lens over zero factors has nothing to amplify. Blindness, " +
            "not safety.",
        },
      ]
    );
  }

  const threshold = thr as number;
  const window = win as number;
  const curvature = cur as number;
  const perFactor: B7FactorFragility[] = entries.map(([factor, bound]) => {
    const proximity = clamp01((threshold + window - bound) / window);
    const fragility = Math.pow(proximity, 1 / curvature);
    return { factor, bound, proximity, fragility };
  });
  const maxBeacon = Math.max(...perFactor.map((f) => f.fragility));
  const beaconFactors = perFactor
    .filter((f) => f.fragility === maxBeacon)
    .map((f) => f.factor);

  return overlayRead(
    B7_OVERLAY_ID,
    `fragility lens over ${perFactor.length} factor(s), anchored at ` +
      `degradedThreshold=${String(threshold)} (window=${String(window)}, ` +
      `curvature=${String(curvature)}): max-beacon=${maxBeacon.toFixed(4)} on ` +
      `[${beaconFactors.join(", ")}]. The lens makes brittleness visible before it is ` +
      `an event; it changes nothing.`,
    {
      degradedThreshold: threshold,
      proximityWindow: window,
      curvature,
      perFactor,
      maxBeacon,
      beaconFactors,
    },
    [
      "CALIBRATION is INJECTED and comes from pilot data this overlay has never " +
        "seen. Where this project supplies STARTING numbers (B7_PROXY_CALIBRATION) " +
        "they are PRE-PILOT PROXY, subject to calibration.",
    ]
  );
}

export const B7_SCOPE = formatOverlayScope(
  B7_OVERLAY_ID,
  [
    "the LATEST SUBSTRATE_READ's per-factor bounds — each factor's PROXIMITY to the",
    "  injected degraded threshold, amplified into a per-factor fragility and a",
    "  max-beacon over them.",
  ],
  [
    "THE FLOOR / THE CEILING. The lens changes nothing; it only makes approaching-",
    "  trouble loud. It is never composed into a disposition.",
    "A FLOOR TO ANCHOR TO. MICA has none; the anchor is the injected degraded",
    "  threshold, and absent it the lens does not run (CANNOT_ASSESS), never guesses.",
    "TREND. B7 reads one instant. Whether a factor is falling toward the threshold",
    "  over time is B9's aggregate read and B8's co-movement, not this one.",
  ]
);
