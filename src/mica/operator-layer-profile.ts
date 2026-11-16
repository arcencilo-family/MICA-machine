// ── MICA · operator-layer injected profile ──────────────────────────────────
//
// This object is the only operator-specific configuration shared by OP-1,
// OP-2 and OP-3.  Every section is optional and is validated independently by
// the instrument that owns it.  None of the constants below is a default: a
// caller must inject a value explicitly before any reader will consult it.

export interface OperatorEventClass {
  readonly moduleId: string;
  readonly eventType: string;
}

export interface OperatorLayerProfile {
  readonly doctorCadence?: {
    readonly attestationClass: OperatorEventClass;
    readonly cadenceBoundSteps?: number;
  };
  readonly auditObligation?: {
    readonly auditClass: OperatorEventClass;
    readonly windowSteps?: number;
    readonly minAuditsPerWindow?: number;
  };
  readonly nodeResponse?: {
    readonly expectationClass: OperatorEventClass;
    readonly responseClass: OperatorEventClass;
    readonly responseBoundSteps?: number;
    readonly flatness?: {
      readonly amiFloor: number;
      readonly amiCeilingMargin: number;
      readonly minSample: number;
    };
  };
}

export const OP1_PROXY_CADENCE_BOUND_STEPS = 100;
export const OP2_PROXY_WINDOW_STEPS = 100;
export const OP2_PROXY_MIN_AUDITS_PER_WINDOW = 1;
export const OP3_PROXY_RESPONSE_BOUND_STEPS = 100;
export const OP3_PROXY_AMI_FLOOR = 0.05;
export const OP3_PROXY_AMI_CEILING_MARGIN = 0.02;
export const OP3_PROXY_MIN_SAMPLE = 30;

export const OPERATOR_PROXY_PROVENANCE =
  "PRE-PILOT PROXY, subject to calibration. These named values are available " +
  "for explicit caller injection; no instrument reads them as defaults.";
