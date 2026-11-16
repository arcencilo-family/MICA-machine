// ── MICA · the doctor-overlay campaign — barrel ───────────────────────────────
//
// The SUBSTRATE_READ history substrate, the recorder that feeds it (deployment
// glue over guard()), the four report-only overlays (B6–B9) to the doctor stream,
// and the B3 doctor-latency bound. NONE of it is a sensor, NONE reaches guard(),
// NONE is a term in the floor. The history is read by the overlays and the latency
// detector and by no sensor — doctor.test.ts asserts that isolation.

export * from "./history";
export * from "./recorder";
export * from "./latency";
export * from "./overlays/types";
export {
  assessB6,
  B6_OVERLAY_ID,
  B6_PROXY_CALIBRATION,
  B6_SCOPE,
} from "./overlays/balance";
export type { B6Config, B6Data, BalanceClass } from "./overlays/balance";
export {
  assessB7,
  B7_OVERLAY_ID,
  B7_PROXY_CALIBRATION,
  B7_SCOPE,
} from "./overlays/fragility";
export type {
  B7Config,
  B7Data,
  B7FactorFragility,
} from "./overlays/fragility";
export {
  assessB8,
  B8_OVERLAY_ID,
  B8_PROXY_CALIBRATION,
  B8_SCOPE,
  B8_D15_CAVEAT,
  B8_NO_METHOD_VARIANCE_CAVEAT,
} from "./overlays/covariance";
export type { B8Config, B8Data, B8Pair } from "./overlays/covariance";
export {
  assessB9,
  B9_OVERLAY_ID,
  B9_PROXY_CALIBRATION,
  B9_SCOPE,
} from "./overlays/aggregate";
export type { B9Config, B9Data } from "./overlays/aggregate";
