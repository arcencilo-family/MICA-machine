// ── MICA · the recorder — deployment glue that feeds the SUBSTRATE_READ history ─
//
// WHERE THIS SITS, AND WHAT IT MUST NOT TOUCH
//
//   The brief: the history is "populated by a recorder at the deployment-glue
//   layer consuming guard()'s output. The chokepoint's disposition logic stays
//   byte-identical; if a hook is needed, it wraps guard(), never edits it."
//
//   So this file reads a DispositionResult that guard() ALREADY produced and
//   appends one SUBSTRATE_READ to the history. It changes no disposition, reads no
//   action payload, and imports nothing from the chokepoint but the RESULT TYPE it
//   is handed. The chokepoint files are untouched; chokepoint.test.ts stays green
//   without being run differently.
//
//   The recorder is glue, not a sensor. It is the one writer into the history; the
//   history is read only by the overlays and the doctor-latency detector. No path
//   runs the other way: nothing the recorder writes re-enters guard().
//
// ── WHY THE FACTOR SLICES COME FROM sensorIds × sensorKinds ────────────────────
//
//   The DispositionResult carries decision.sensorIds and decision.sensorKinds as
//   PARALLEL arrays in wired order (src/mica/chokepoint/types.ts). Each (id, kind)
//   pair is one factor-read under the proxy mapping (history.ts): the sensor is
//   the factor, its verdict kind is the conservative bound. floorKind is read
//   straight off the decision — never recomputed here, so the history can never
//   disagree with the floor the gate actually composed.

import type { DispositionResult } from "../chokepoint";
import type { SubstrateHistory } from "./history";
import type { SubstrateReadRecord, FactorReadInput } from "./history";

export interface RecordGuardOutcome {
  readonly record: SubstrateReadRecord;
  /** True only when the read was durably persisted to the injected history file. */
  readonly persisted: boolean;
  readonly detail: string | null;
  /** True only when the post-durable head commit returned normally. */
  readonly headCommitted: boolean;
  /** Null when unwired or when the commit call returned; otherwise why not. */
  readonly headCommitDetail: string | null;
}

/**
 * THE MODALITY EVERY SUBSTRATE_READ CARRIES — RE-EXPORTED, NOT DECLARED HERE.
 *
 * `recordGuardResult` appends what `guard()` already composed. No human handed
 * it an instruction — there is no human anywhere in this path — so the honest
 * declaration is `NOT_AN_INSTRUCTION` on every read.
 *
 * IT WAS DECLARED IN THIS FILE UNTIL 2026-08-27 (S88), AND THAT WAS THE WRONG
 * HOME. This header used to say the constant meant "no caller can quietly claim
 * otherwise about a read the machine took by itself". THAT WAS NOT TRUE while it
 * lived here: `SubstrateReadInput` also took an optional `modality`, so the
 * constant bound only callers who came through this function, and `history.record`
 * would take any of the three from anyone. Now that the value is RETAINED in the
 * record and covered by its hash, that gap would have written declarations nobody
 * made into the book permanently. The declaration moved to the construction site
 * in `history.ts` and the input parameter is gone, so the sentence is true for
 * the first time. The name is re-exported here because this is where it was
 * first published and the census reads it by that name.
 *
 * A doctor's ATTESTATION is a different act with a different answer, and that
 * one is declared per append on `recordAttestation` / `attemptRecovery`.
 */
export { GUARD_READS_CARRY_NO_INSTRUCTION } from "./history";

/**
 * Append one SUBSTRATE_READ derived from a DispositionResult guard() already
 * returned. PURE with respect to the gate: it reads the result and writes the
 * history, and returns to the caller whether the write persisted. The `timestamp`
 * is injected — this module never calls Date.now, exactly as the sensors never do.
 *
 * The caller (deployment glue) does:  const r = chokepoint.guard(...); use(r);
 *                                      recordGuardResult(history, r, now());
 * and `r` is the SAME object either way — recording is downstream and side-effect
 * free on the disposition.
 */
export function recordGuardResult(
  history: SubstrateHistory,
  result: DispositionResult,
  timestamp: number
): RecordGuardOutcome {
  const decision = result.decision;
  const ids = decision.sensorIds;
  const kinds = decision.sensorKinds;

  // Zip the parallel arrays. If they ever disagree in length (they never do on
  // disk — decideChokepoint builds both from the same map) we take the shorter,
  // so a malformed result under-reports factors rather than inventing one.
  const n = Math.min(ids.length, kinds.length);
  const factors: FactorReadInput[] = [];
  for (let i = 0; i < n; i++) {
    factors.push({ factor: ids[i], verdictKind: kinds[i] });
  }

  // No `modality` is passed and none can be: the history stamps
  // GUARD_READS_CARRY_NO_INSTRUCTION at the construction site itself (S88).
  return history.record({
    timestamp,
    factors,
    floorKind: decision.floorKind,
    disposition: result.disposition,
    execute: result.execute,
    actionId: decision.action.id,
  });
}
