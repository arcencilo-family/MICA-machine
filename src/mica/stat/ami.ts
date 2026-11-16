// ── MICA · stat — the adjusted-mutual-information machinery, sensor-free ───────
//
// WHAT THIS MODULE IS, AND WHY IT EXISTS APART FROM ANY SENSOR
//
//   This file holds the ADJUSTED MUTUAL INFORMATION statistic — entropy, exact
//   hypergeometric E[MI], plug-in MI, the fixed-marginal permutation reference,
//   and the log-factorial table it all rests on. It was extracted from Eng
//   (src/mica/eng/index.ts) so a SECOND reader — narrow-W leg 2 — can compute
//   the same statistic over a different pair of variables WITHOUT re-deriving
//   the math or duplicating it. `engStructure` is now a thin wrapper over
//   `pairedStructure` here; narrow-W leg 2 is another.
//
//   IT DEPENDS ON NO SENSOR. It imports nothing from eng, sig, narrow-w, the
//   chokepoint, the export layer, or the log shape. It takes two vectors of
//   string labels — one per paired observation — and returns numbers. That is
//   the whole contract. Keeping it sensor-free is deliberate: a shared statistic
//   that reached back into a sensor would couple the two readers through their
//   arithmetic, which is exactly what a passive instrument must not do.
//
// THE STATISTIC (verbatim from Eng's derivation — the reasoning is unchanged)
//
//   ADJUSTED MUTUAL INFORMATION between a LEFT label L and a RIGHT label R,
//   against the fixed-marginal permutation model:
//
//       AMI = ( MI(L;R) - E[MI] ) / ( max(H(L), H(R)) - E[MI] )
//
//   where E[MI] is the EXACT expected mutual information over all relabelings
//   that preserve both marginal count vectors.
//
//   WHY THE ADJUSTMENT IS THE WHOLE POINT. Plain (plug-in) mutual information
//   fails the noise arm silently, with a MAXIMAL reading: if injected noise
//   gives every observation a distinct R, each R occurs once, so observing R
//   determines L, so MI(L;R) = H(L) — the maximum. A statistic built on plug-in
//   MI would report PERFECT structure on data whose R carries no information
//   about L whatsoever. Against the permutation model that same table is
//   unremarkable: E[MI] for the all-distinct case is exactly H(L) too, so the
//   numerator is exactly zero and AMI = 0. The flattening arm (one R value)
//   collapses it the same way: MI = 0 and E[MI] = 0, so AMI = 0. Both failure
//   directions land on the same floor; the only way off it is an L→R dependence
//   a reshuffle would destroy — i.e. actually being differentially responsive.
//
//   The statistic is SYMMETRIC in L and R (MI, E[MI] and max(H(L),H(R)) all
//   are). Which variable a caller names "left" and which "right" is therefore
//   free for the statistic itself — but a caller's ARITY GATES are not
//   symmetric, so this module reports the distinct-count and repeated-ness of
//   BOTH sides and lets the caller decide which one its question needs.
//
//   Natural logarithm throughout. The base cancels in the ratio, so no base is
//   a choice this code has to defend.
//
// THE CEILING (A5) IS NOT COMPUTED HERE. A maximal AMI is evidence-free rather
//   than healthy (a real judge and a class-keyed lookup table produce the
//   identical table), but "how close to the maximum counts as at the ceiling"
//   is an injected threshold and belongs to whichever sensor is reading. This
//   module reports the number; the sensor rules on it.

/**
 * The maximum attainable value of the adjusted mutual information. A property of
 * the statistic's normalisation, not a calibration choice: AMI is a ratio whose
 * numerator equals its denominator exactly when the observed table attains the
 * maximum the marginals permit. There is no other value it could take and
 * nothing to tune. The DISTANCE BELOW IT that counts as "at the ceiling" is a
 * threshold and IS injected — by the sensor, not here.
 */
export const AMI_MAXIMUM = 1;

/**
 * Where the OBSERVED mutual information sits inside the permutation
 * distribution (A3).
 *
 * Reported because the adjusted value alone is misleading to read. A reader
 * seeing an AMI of -0.004 reasonably concludes "basically zero, no signal
 * either way". That reading discards information: the question is not how close
 * the excess is to zero, it is where the observed table falls among the
 * reshuffles of itself. This locates it.
 *
 * ESTIMATED, NOT EXACT. The mean of this distribution is computed exactly (see
 * expectedMutualInformation); its shape is not, because the exact distribution
 * requires enumerating contingency tables with fixed margins, which is not
 * tractable in general. So the position is estimated by resampling with an
 * injected sample count and an injected seed.
 */
export interface PermutationReference {
  samples: number;
  seed: number;
  /** Fraction of reshuffles whose MI was STRICTLY BELOW the observed MI. */
  percentileBelow: number;
  /** Fraction of reshuffles whose MI was at or below the observed MI. */
  percentileAtOrBelow: number;
  /** Mean MI across the reshuffles. Sanity check against the exact E[MI]. */
  resampledMean: number;
  /** Standard deviation of MI across the reshuffles. */
  resampledStdDev: number;
}

/**
 * The structure statistic over a set of PAIRED string labels. Neutral in its
 * naming — "left" and "right", not "class" and "outcome" — because two
 * different readers point it at two different pairs of variables. Each caller
 * maps these fields onto its own vocabulary.
 */
export interface PairedStructure {
  /** Adjusted mutual information. Degenerate tables report null. */
  ami: number | null;
  /** Plug-in mutual information, reported for scrutiny, never thresholded. */
  mutualInformation: number;
  /** Exact expected MI under the fixed-marginal permutation model. */
  expectedMutualInformation: number;
  entropyLeft: number;
  entropyRight: number;
  sampleSize: number;
  distinctLeft: number;
  distinctRight: number;
  /** True when at least one LEFT label occurs more than once. */
  hasRepeatedLeft: boolean;
  /** True when at least one RIGHT label occurs more than once. */
  hasRepeatedRight: boolean;
  /** A3. Null when the sample count or seed was not injected. */
  permutation: PermutationReference | null;
  /** Why `permutation` is null, when it is. Always populated. */
  permutationNote: string;
}

/** log(k!) for k = 0..n, by cumulative sum. Exact, no approximation constants. */
function logFactorials(n: number): Float64Array {
  const table = new Float64Array(n + 1);
  for (let k = 1; k <= n; k++) table[k] = table[k - 1] + Math.log(k);
  return table;
}

function entropyFromCounts(counts: readonly number[], total: number): number {
  let h = 0;
  for (const c of counts) {
    if (c > 0) {
      const p = c / total;
      h -= p * Math.log(p);
    }
  }
  return h;
}

/**
 * Exact E[MI] over relabelings preserving both marginals (the standard
 * hypergeometric expectation). Computed in log-space and exponentiated per
 * term so the factorials never overflow.
 */
function expectedMutualInformation(
  leftCounts: readonly number[],
  rightCounts: readonly number[],
  total: number,
  lf: Float64Array
): number {
  let expected = 0;
  for (const a of leftCounts) {
    for (const b of rightCounts) {
      const lo = Math.max(1, a + b - total);
      const hi = Math.min(a, b);
      for (let n = lo; n <= hi; n++) {
        const term = (n / total) * Math.log((total * n) / (a * b));
        const logWeight =
          lf[a] +
          lf[b] +
          lf[total - a] +
          lf[total - b] -
          lf[total] -
          lf[n] -
          lf[a - n] -
          lf[b - n] -
          lf[total - a - b + n];
        expected += term * Math.exp(logWeight);
      }
    }
  }
  return expected;
}

/** Plug-in MI from paired index vectors and their marginal counts. */
function mutualInformationFromPairs(
  leftIdx: readonly number[],
  rightIdx: readonly number[],
  leftCounts: readonly number[],
  rightCounts: readonly number[],
  total: number
): number {
  const joint = new Map<number, number>();
  const stride = rightCounts.length;
  for (let i = 0; i < total; i++) {
    const k = leftIdx[i] * stride + rightIdx[i];
    joint.set(k, (joint.get(k) ?? 0) + 1);
  }
  let mi = 0;
  for (const [k, nij] of joint) {
    const a = leftCounts[Math.floor(k / stride)];
    const b = rightCounts[k % stride];
    mi += (nij / total) * Math.log((nij * total) / (a * b));
  }
  return mi;
}

/**
 * Deterministic uniform generator for the reshuffles. The multiplier and
 * increment are the Numerical Recipes linear-congruential parameters — an
 * ALGORITHM parameter, in the same category as the log-factorial recurrence,
 * not a calibration threshold. The seed that drives it is injected.
 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Locate the observed MI inside the permutation distribution by reshuffling the
 * RIGHT vector against a fixed LEFT vector. A reshuffle preserves BOTH marginal
 * count vectors exactly and destroys any left-right association, which is the
 * same null model E[MI] is computed against.
 */
function permutationReference(
  leftIdx: readonly number[],
  rightIdx: readonly number[],
  leftCounts: readonly number[],
  rightCounts: readonly number[],
  total: number,
  observedMi: number,
  samples: number,
  seed: number
): PermutationReference {
  const rng = makeRng(seed);
  const scratch = rightIdx.slice();
  let below = 0;
  let atOrBelow = 0;
  let sum = 0;
  let sumSq = 0;

  for (let s = 0; s < samples; s++) {
    // Fisher-Yates.
    for (let i = scratch.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = scratch[i];
      scratch[i] = scratch[j];
      scratch[j] = t;
    }
    const mi = mutualInformationFromPairs(
      leftIdx,
      scratch,
      leftCounts,
      rightCounts,
      total
    );
    if (mi < observedMi) below++;
    if (mi <= observedMi) atOrBelow++;
    sum += mi;
    sumSq += mi * mi;
  }

  const mean = sum / samples;
  const variance = Math.max(0, sumSq / samples - mean * mean);
  return {
    samples,
    seed,
    percentileBelow: below / samples,
    percentileAtOrBelow: atOrBelow / samples,
    resampledMean: mean,
    resampledStdDev: Math.sqrt(variance),
  };
}

/**
 * Compute the AMI structure over two aligned vectors of string labels. Element
 * i of `leftKeys` is paired with element i of `rightKeys`. Exported so a
 * reviewer can call it on their own table and check the arithmetic without
 * going through any sensor's verdict machinery.
 *
 * The index assignment is first-seen order over the pairs, exactly as Eng's
 * original single-pass build was, so a sensor mapping its records to
 * (leftKeys, rightKeys) in record order reproduces the identical numbers.
 */
export function pairedStructure(
  leftKeys: readonly string[],
  rightKeys: readonly string[],
  permutationConfig?: { samples?: number; seed?: number }
): PairedStructure {
  const total = leftKeys.length;

  const leftIndex = new Map<string, number>();
  const rightIndex = new Map<string, number>();
  const leftCounts: number[] = [];
  const rightCounts: number[] = [];
  const leftIdx: number[] = [];
  const rightIdx: number[] = [];
  const joint = new Map<string, number>();

  for (let i = 0; i < total; i++) {
    const lk = leftKeys[i];
    let li = leftIndex.get(lk);
    if (li === undefined) {
      li = leftCounts.length;
      leftIndex.set(lk, li);
      leftCounts.push(0);
    }
    leftCounts[li]++;
    leftIdx.push(li);

    const rk = rightKeys[i];
    let ri = rightIndex.get(rk);
    if (ri === undefined) {
      ri = rightCounts.length;
      rightIndex.set(rk, ri);
      rightCounts.push(0);
    }
    rightCounts[ri]++;
    rightIdx.push(ri);

    const jk = `${li} ${ri}`;
    joint.set(jk, (joint.get(jk) ?? 0) + 1);
  }

  const entropyLeft = entropyFromCounts(leftCounts, total);
  const entropyRight = entropyFromCounts(rightCounts, total);

  let mutualInformation = 0;
  for (const [jk, nij] of joint) {
    const parts = jk.split(" ");
    const a = leftCounts[Number(parts[0])];
    const b = rightCounts[Number(parts[1])];
    mutualInformation += (nij / total) * Math.log((nij * total) / (a * b));
  }

  const lf = logFactorials(total);
  const emi =
    total > 0
      ? expectedMutualInformation(leftCounts, rightCounts, total, lf)
      : 0;

  const denominator = Math.max(entropyLeft, entropyRight) - emi;
  const hasRepeatedLeft = leftCounts.some((c) => c > 1);
  const hasRepeatedRight = rightCounts.some((c) => c > 1);

  // A denominator at or below zero means the permutation model already explains
  // everything the table could show — the question has no room to be answered.
  // Reported as null rather than a number, so no threshold comparison can be
  // run against a quantity that does not exist.
  //
  // The finiteness guard is load-bearing and not decoration: a NaN compares
  // FALSE against `ami < threshold`, would fall through an alarm branch, and be
  // emitted as SILENT. A non-finite statistic must reach the caller as an
  // absence of reading, never as an absence of finding.
  const ratio = denominator > 0 ? (mutualInformation - emi) / denominator : NaN;
  const ami = Number.isFinite(ratio) ? ratio : null;

  // ── A3: locate the observation inside the permutation distribution ────────
  const pSamples = permutationConfig?.samples;
  const pSeed = permutationConfig?.seed;
  let permutation: PermutationReference | null = null;
  let permutationNote: string;

  if (
    typeof pSamples !== "number" ||
    !Number.isInteger(pSamples) ||
    pSamples < 1 ||
    typeof pSeed !== "number" ||
    !Number.isInteger(pSeed)
  ) {
    permutationNote =
      "NOT PRODUCED — permutationSamples (positive integer) and permutationSeed " +
      "(integer) were not both injected. The percentile is an estimate and its " +
      "sample count is a number, so it is injected like every other number here. " +
      "Its absence is reported, never treated as a passed check.";
  } else if (total < 1) {
    permutationNote = "NOT PRODUCED — the chain is empty.";
  } else {
    permutation = permutationReference(
      leftIdx,
      rightIdx,
      leftCounts,
      rightCounts,
      total,
      mutualInformation,
      pSamples,
      pSeed
    );
    permutationNote =
      `estimated from ${pSamples} reshuffles at seed ${pSeed} ` +
      `(fixed-marginal, Fisher-Yates on the outcome vector)`;
  }

  return {
    ami,
    mutualInformation,
    expectedMutualInformation: emi,
    entropyLeft,
    entropyRight,
    sampleSize: total,
    distinctLeft: leftCounts.length,
    distinctRight: rightCounts.length,
    hasRepeatedLeft,
    hasRepeatedRight,
    permutation,
    permutationNote,
  };
}
