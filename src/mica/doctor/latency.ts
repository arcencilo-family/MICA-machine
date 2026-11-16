// ── MICA · B3/E6 doctor-latency bound — the twice-named live gap, arbiter-ruled ──
//
// THE RULE (brief §1.3, arbiter-RULED 2026-08-18)
//
//   After N CONSECUTIVE cadence points at which the composed state is SAFE-HOLD/
//   CRITICAL-equivalent — operationally: guard() returned HOLD or HOLD_BLIND —
//   WITHOUT a doctor attestation recorded in the history, emit a typed
//   DOCTOR_LATENCY_BREACH event to the doctor stream. A doctor attestation recorded
//   in the history RESETS the count; so does a read that was not a HOLD (the run
//   must be consecutive). The breach is a TYPED EVENT, not a verdict: it changes no
//   disposition — consequence layers are step-3 (D-25), out of scope here.
//
// ── THE NUMBER N IS AN INJECTED PROXY — THE ARBITER'S WORD: WILLKÜR ──────────────────
//
//   N = 3 is the ruled starting value and it is EXPLICITLY arbitrary — a proxy to
//   be calibrated, printed with that provenance wherever it appears. There is no
//   default: absent an injected breachAfterConsecutive, the detector does not
//   evaluate and says so (blind, never a silent pass). The constant below is a
//   STARTING value, not a default; nothing in this module consults it.
//
// ── WHAT THIS IS NOT ───────────────────────────────────────────────────────────
//
//   It reads the DOCTOR_ATTESTATION record's EXISTENCE (H1) only. It makes NO claim
//   about the attestation's quality (H2, fenced in history.ts). And it authors no
//   consequence: a breach is a signal to the doctor stream, nothing downstream.

import type { HistoryRecord, SubstrateHistory } from "./history";

export const DOCTOR_LATENCY_ID = "MICA/doctor-latency/B3";

export const B3_WILLKUR_PROVENANCE =
  "N is an INJECTED PROXY. The arbiter's word: Willkür — an explicitly arbitrary starting " +
  "number, subject to calibration, printed with this provenance wherever it appears. " +
  "This build does not decide how many un-attested holds are too many; it emits the " +
  "typed breach and changes no disposition (consequence is step-3, D-25).";

/**
 * PRE-PILOT PROXY, subject to calibration. Not a default: nothing here reads it.
 *   breachAfterConsecutive: 3 — arbiter-ruled 2026-08-18, explicitly Willkür.
 */
export const B3_PROXY_CALIBRATION = {
  breachAfterConsecutive: 3,
  provenance: B3_WILLKUR_PROVENANCE,
} as const;

export interface DoctorLatencyBreach {
  readonly eventType: "DOCTOR_LATENCY_BREACH";
  readonly stream: "DOCTOR";
  /** The sequence number of the HOLD read that tripped the breach. */
  readonly atSequence: number;
  /** How many consecutive un-attested holds tripped it (= the injected N). */
  readonly consecutiveHolds: number;
  /** The sequence numbers of the run of holds that tripped it. */
  readonly holdSequences: readonly number[];
  readonly detail: string;
}

export interface DoctorLatencyResult {
  /** True only when an injected N let the detector actually run. */
  readonly evaluated: boolean;
  readonly breachAfterConsecutive: number | null;
  /** Every breach the history's read/attestation stream tripped, in order. */
  readonly breaches: readonly DoctorLatencyBreach[];
  /** The count of consecutive un-attested holds at the END of the history. */
  readonly openConsecutiveHolds: number;
  readonly summary: string;
}

export interface DoctorLatencyConfig {
  /**
   * N — consecutive un-attested HOLD/HOLD_BLIND reads that trip a breach. INJECTED
   * PROXY (Willkür), no default. A positive integer. Absent/unusable ⇒ the detector
   * does not evaluate and says so.
   */
  readonly breachAfterConsecutive?: number;
}

const HOLD_DISPOSITIONS = new Set(["HOLD", "HOLD_BLIND"]);

/**
 * Walk the interleaved history (reads + attestations, in sequence order) and emit
 * a DOCTOR_LATENCY_BREACH each time N consecutive HOLD/HOLD_BLIND reads accrue with
 * no attestation among them. After a breach the counter RE-ARMS (resets to 0), so a
 * long un-attended hold trips one breach per N holds rather than once forever.
 *
 * PURE: reads the history, emits typed events, mutates nothing and touches no
 * disposition.
 */
export function evaluateDoctorLatency(
  history: SubstrateHistory,
  config?: DoctorLatencyConfig
): DoctorLatencyResult {
  const n = config?.breachAfterConsecutive;
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
    return {
      evaluated: false,
      breachAfterConsecutive: null,
      breaches: [],
      openConsecutiveHolds: 0,
      summary:
        "DOCTOR-LATENCY NOT EVALUATED: no usable breachAfterConsecutive (N) was " +
        `injected. ${B3_WILLKUR_PROVENANCE} With no N there is no line to cross, and ` +
        "this is stated blindness, not a pass.",
    };
  }

  const all: readonly HistoryRecord[] = history.getAll();
  const breaches: DoctorLatencyBreach[] = [];
  let run: number[] = [];

  for (const rec of all) {
    if (rec.recordType === "DOCTOR_ATTESTATION") {
      // A recorded attestation resets the run — existence (H1) only; the detector
      // makes no claim about whether the attestation was any good (H2 fenced).
      run = [];
      continue;
    }
    if (rec.recordType !== "SUBSTRATE_READ") {
      // RECOVERY_ATTESTATION / REFUSAL_TO_CLEAR carry no disposition and are not
      // reads: they are latch-transition records. They neither extend nor break a
      // consecutive-hold run — the run is about un-attended HOLD reads only.
      continue;
    }
    // SUBSTRATE_READ
    if (HOLD_DISPOSITIONS.has(rec.disposition)) {
      run.push(rec.sequenceNumber);
      if (run.length >= n) {
        breaches.push({
          eventType: "DOCTOR_LATENCY_BREACH",
          stream: "DOCTOR",
          atSequence: rec.sequenceNumber,
          consecutiveHolds: run.length,
          holdSequences: [...run],
          detail:
            `${run.length} consecutive HOLD/HOLD_BLIND read(s) at sequences ` +
            `[${run.join(", ")}] with no doctor attestation recorded among them, ` +
            `reaching the injected N=${n}. ${B3_WILLKUR_PROVENANCE}`,
        });
        run = []; // re-arm
      }
    } else {
      // A non-HOLD read (RELEASE / PASS_BLIND) breaks the consecutive run.
      run = [];
    }
  }

  return {
    evaluated: true,
    breachAfterConsecutive: n,
    breaches,
    openConsecutiveHolds: run.length,
    summary:
      `doctor-latency over ${all.length} history record(s), N=${n} (Willkür): ` +
      `${breaches.length} breach(es); ${run.length} un-attested hold(s) open at the ` +
      `end of history. A breach is a typed event to the doctor stream and changes no ` +
      `disposition.`,
  };
}
