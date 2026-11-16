// ── MICA · B6 balance-read overlay (§5.1, GM-shaped) ──────────────────────────
//
// WHAT min() IS LOSSY ON, AND WHAT THIS RECOVERS
//
//   Canon §5.1: min() cannot tell "one weak factor among five strong" from "six
//   uniformly mediocre factors" — the first is a treatment target, the second is
//   systemic exhaustion, and the doctor should know which patient walked in. The
//   balance-read is a geometric-mean-shaped scalar over b⃗, read ALONGSIDE (never
//   inside) the ceiling: the GM shape survives, its verdict authority does not.
//
//   The reading, made robust to a zero bound: report the geometric mean AND the
//   arithmetic mean of the latest bound vector, and their ratio GM/AM ∈ (0,1].
//   AM ≥ GM always; the two are equal only when every bound is equal. So:
//
//     GM/AM near 1   → UNIFORM: the vector is flat — systemic exhaustion if low,
//                      broad health if high. min() alone could not see the flatness.
//     GM/AM near 0   → CONCENTRATED: one (or few) factor is far below the rest — a
//                      treatment target. (A single ALARM bound at 0 sends GM to 0
//                      and the ratio to 0, which is exactly "concentrated weakness".)
//
//   An injected balanceThreshold splits UNIFORM from CONCENTRATED. It is a proxy,
//   printed as such. REPORT-ONLY: the classification is a note to the doctor, never
//   a verdict and never a term in the floor.

import type { SubstrateHistory } from "../history";
import {
  formatOverlayScope,
  latestVector,
  overlayCannotAssess,
  overlayRead,
} from "./types";
import type { OverlayReport } from "./types";

export const B6_OVERLAY_ID = "MICA/overlay/B6-balance-read";

export interface B6Config {
  /**
   * GM/AM at or above this reads UNIFORM; below it reads CONCENTRATED. INJECTED,
   * no default: where the line between "one treatment target" and "systemic
   * exhaustion" sits is calibration this build does not own. Absent or not a finite
   * number in (0,1] ⇒ the classification is NOT produced and the report says so
   * (the scalars are still reported — they need no threshold).
   */
  readonly balanceThreshold?: number;
}

/**
 * PRE-PILOT PROXY, subject to calibration. Not a default: nothing here reads it.
 *   balanceThreshold: 0.9 — within a tenth of a flat vector reads UNIFORM.
 */
export const B6_PROXY_CALIBRATION = {
  balanceThreshold: 0.9,
  provenance:
    "PRE-PILOT PROXY, subject to calibration. A STARTING value, not a default; " +
    "nothing in this module consults it and a caller who wants it injects it.",
} as const;

export type BalanceClass = "UNIFORM" | "CONCENTRATED" | "NOT_CLASSIFIED";

export interface B6Data {
  readonly factorCount: number;
  readonly bounds: readonly { readonly factor: string; readonly bound: number }[];
  readonly geometricMean: number;
  readonly arithmeticMean: number;
  /** GM/AM ∈ (0,1], or null when AM is 0 (every factor at bound 0). */
  readonly balanceRatio: number | null;
  readonly min: number;
  readonly classification: BalanceClass;
  readonly balanceThreshold: number | null;
}

export function assessB6(
  history: SubstrateHistory,
  config?: B6Config
): OverlayReport<B6Data> {
  const reads = history.getReads();
  if (reads.length === 0) {
    return overlayCannotAssess(B6_OVERLAY_ID, "no SUBSTRATE_READ records in history yet.", [
      {
        class: "INSUFFICIENT_HISTORY",
        detail:
          "the balance-read is a shape read over the latest factor vector; there " +
          "is no read to take a shape of. This is blindness, not a balanced vector.",
      },
    ]);
  }
  const vector = latestVector(reads);
  const entries = [...vector.entries()]
    .map(([factor, bound]) => ({ factor, bound }))
    .sort((a, b) => a.factor.localeCompare(b.factor));
  if (entries.length === 0) {
    return overlayCannotAssess(
      B6_OVERLAY_ID,
      "the latest read has an empty factor vector (no sensors were wired).",
      [
        {
          class: "INELIGIBLE_SCOPE",
          detail:
            "a geometric mean over zero factors is undefined; there is no shape to " +
            "read. An empty vector is blindness, not balance.",
        },
      ]
    );
  }

  const bounds = entries.map((e) => e.bound);
  const n = bounds.length;
  const am = bounds.reduce((s, b) => s + b, 0) / n;
  // GM via logs would need b>0; a zero bound makes GM exactly 0, which is the
  // correct and wanted answer (concentrated weakness), so compute the product.
  const product = bounds.reduce((p, b) => p * b, 1);
  const gm = Math.pow(product, 1 / n);
  const min = Math.min(...bounds);
  const ratio = am === 0 ? null : gm / am;

  const thr = config?.balanceThreshold;
  const thresholdUsable =
    typeof thr === "number" && Number.isFinite(thr) && thr > 0 && thr <= 1;
  let classification: BalanceClass = "NOT_CLASSIFIED";
  if (thresholdUsable && ratio !== null) {
    classification = ratio >= thr ? "UNIFORM" : "CONCENTRATED";
  }

  const classNote =
    classification === "NOT_CLASSIFIED"
      ? thresholdUsable
        ? "GM/AM is undefined (every factor at bound 0) so no class is assigned"
        : "no usable balanceThreshold was injected, so UNIFORM vs CONCENTRATED was not classified (the scalars stand on their own)"
      : classification === "UNIFORM"
        ? `UNIFORM: the vector is flat (GM/AM=${(ratio as number).toFixed(4)} >= ${String(thr)}) — read as systemic exhaustion if low, broad health if high; min() alone could not see the flatness`
        : `CONCENTRATED: one or few factors sit far below the rest (GM/AM=${(ratio as number).toFixed(4)} < ${String(thr)}) — a treatment target the doctor can name`;

  return overlayRead(
    B6_OVERLAY_ID,
    `balance-read over ${n} factor(s): GM=${gm.toFixed(4)}, AM=${am.toFixed(4)}, ` +
      `min=${min.toFixed(4)}. ${classNote}. The GM shape is read ALONGSIDE the floor, ` +
      `never inside it.`,
    {
      factorCount: n,
      bounds: entries,
      geometricMean: gm,
      arithmeticMean: am,
      balanceRatio: ratio,
      min,
      classification,
      balanceThreshold: thresholdUsable ? (thr as number) : null,
    }
  );
}

export const B6_SCOPE = formatOverlayScope(
  B6_OVERLAY_ID,
  [
    "the LATEST SUBSTRATE_READ's per-factor bounds — the current factor vector",
    "  whose SHAPE (geometric vs arithmetic mean) this overlay reads.",
  ],
  [
    "THE CEILING / THE FLOOR. The GM shape is read alongside them, never inside;",
    "  RMBA folds GM into the compensation path, and that authority does not cross.",
    "TREND OVER TIME. B6 reads one instant's shape; the slow drift is B9's read and",
    "  the co-movement is B8's. B6 says nothing about whether the vector is falling.",
    "WHETHER THE WEAKNESS IS REAL. It reads recorded bounds; a fabricated-stable",
    "  history reads as balanced. That is the self-authored-history ceiling (T2).",
  ]
);
