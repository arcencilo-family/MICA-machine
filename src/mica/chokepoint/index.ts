// ── MICA · the loop chokepoint — the object that turns a reader into a gate ───
//
// This wires the pure decision (types.ts) to the side effects §5 and §6 require:
// the all-disposition floor trail (floor-trail.ts), the unconditional PASS-BLIND
// record (ledger.ts), the batched notice (notifier.ts), and the §6 delivery rule
// that fails closed. It also carries the adapter that bridges the third built
// reader, whose return type the brief got wrong (see gapReadToVerdict).
//
// THE FLOOR TRAIL CUTS. This chokepoint issues no permit it cannot account for.
// RELEASE and PASS-BLIND require a durably persisted floor reading; an unwired,
// in-memory-only, or failed trail narrows either permit to HOLD-BLIND. A permit
// without that reading is the silent fail-open, and this gate refuses it.
//
// It is the orientation point later gates build toward: a new gate contributes a
// SensorVerdict to `guard`'s `sensorVerdicts` and needs no change here. The floor
// composes over whatever readers are wired and grows stronger as readers are
// added (§1). This is a T1 interrupter against the three built readers; the
// unbuilt gates contribute nothing to the floor and are not depended on.

import type { SensorVerdict } from "../types";
import { alarm, cannotAssess } from "../types";
import {
  ChokepointLedger,
} from "./ledger";
import type { ChokepointLedgerRecord } from "./ledger";
import { FloorTrail } from "./floor-trail";
import type { FloorTrailRecord } from "./floor-trail";
import { BatchedNotifier } from "./notifier";
import type { BatchNotice } from "./notifier";
import {
  DISPOSITION_LABEL,
  ROUTING_PRECONDITION,
  RELEASE_IS_NOT_SAFE,
  DELIVERY_FAILS_CLOSED,
  decideChokepoint,
  narrowForDisposition,
  renderStakesLine,
  renderReaderThrows,
} from "./types";
import type {
  ChokepointDecision,
  ChokepointDisposition,
  DispositionDelivery,
  ProposedAction,
  Stakes,
  StakesLine,
  ReaderThrow,
} from "./types";

export const CHOKEPOINT_ID = "MICA/Chokepoint";

// ── The adapter the brief's §2 requires but does not name ─────────────────────
//
// §2 says the three built readers each return a SensorVerdict, "clerk1.gap via
// its gap read". ON DISK IT DOES NOT: readGaps(...) (src/clerk/gap.ts) returns a
// GapRead — GAP_OBSERVED | NO_GAP_OBSERVED | CANNOT_ASSESS_CADENCE — its own
// union. The floor composes over SensorVerdict, so the gap read is BRIDGED here.
//
// ── AND WHY THE SHAPE IS DECLARED HERE, NOT IMPORTED FROM clerk ────────────────
//
//   The 2026-08-12 closure ruling (src/mica/closure.test.ts) is that src/mica/
//   takes clerk/ILAS as a dependency of NO kind — not runtime, not dev, NOT
//   TYPE-ONLY. A type-only `import { GapRead } from "../../clerk/gap"` is an edge
//   out of src/mica and the closure guard fails on it. So this file DECLARES the
//   gap-read shape it reads, MICA-locally — exactly as MICA declares its own
//   MicaReadableLog rather than importing ILAS's log type. A caller wiring the
//   real reader passes a real GapRead, which is structurally assignable to
//   GapReadShape; that binding is checked at the DEPLOYMENT GLUE where clerk and
//   MICA meet (a file outside src/mica), never inside MICA. GapReadShape is a
//   structural subset of src/clerk/gap.ts's GapRead as it stands on disk.
//
// The mapping is natural because the gap read carries the same three-way shape
// with the same "is-not-health" discipline:
//   GAP_OBSERVED          -> ALARM   (silence episodes exceeded a declared cadence)
//   NO_GAP_OBSERVED       -> SILENT  (its summary already carries NO_GAP_IS_NOT_HEALTH)
//   CANNOT_ASSESS_CADENCE -> CANNOT_ASSESS

/** The minimal read-shape of a clerk1.gap read, declared MICA-locally. */
export interface GapObservedShape {
  readonly kind: "GAP_OBSERVED";
  readonly instrumentId: string;
  readonly summary: string;
  readonly stops: readonly { readonly object: string; readonly question: string }[];
  readonly blind: readonly GapBlindShape[];
}
export interface NoGapObservedShape {
  readonly kind: "NO_GAP_OBSERVED";
  readonly instrumentId: string;
  readonly summary: string;
}
export interface CannotAssessCadenceShape {
  readonly kind: "CANNOT_ASSESS_CADENCE";
  readonly instrumentId: string;
  readonly summary: string;
  readonly blind: readonly GapBlindShape[];
}
export interface GapBlindShape {
  readonly class: string;
  readonly channel: string | null;
  readonly detail: string;
}
export type GapReadShape =
  | GapObservedShape
  | NoGapObservedShape
  | CannotAssessCadenceShape;

// The gap detector's finer blind vocabulary has no member on BlindPathClass, so
// it is translated to the nearest MICA class with the original class preserved
// verbatim in the detail — nothing is lost, and an unknown class degrades to
// INELIGIBLE_SCOPE rather than being dropped.
function mapGapBlindClass(
  c: string
): "BROKEN_CHAIN" | "INELIGIBLE_SCOPE" | "MISSING_CONFIGURATION" {
  switch (c) {
    case "STORE_BREAK":
    case "CHAIN_UNVERIFIED":
      return "BROKEN_CHAIN";
    case "NO_CADENCE_DECLARED":
    case "SUBMITTER_UNAUTHENTICATED":
      return "MISSING_CONFIGURATION";
    case "NO_RECORDS":
    default:
      return "INELIGIBLE_SCOPE";
  }
}

/**
 * Bridge a clerk1.gap read into a SensorVerdict the floor can compose. Reads a
 * MICA-declared shape; produces a fresh SensorVerdict and mutates nothing.
 */
export function gapReadToVerdict(g: GapReadShape): SensorVerdict {
  if (g.kind === "GAP_OBSERVED") {
    const findings = g.stops.map((s) => ({
      code: `GAP_${s.object}`,
      detail: s.question,
    }));
    for (const b of g.blind) {
      findings.push({
        code: "GAP_SCOPE_UNREAD",
        detail: `[gap:${b.class}]${b.channel === null ? "" : ` [channel ${b.channel}]`} ${b.detail}`,
      });
    }
    return alarm(g.instrumentId, g.summary, findings);
  }
  if (g.kind === "NO_GAP_OBSERVED") {
    // Preserve the gap read's own words: its summary already states that
    // NO_GAP_OBSERVED is an absence of finding, not health (§3 — preserve it).
    return {
      kind: "SILENT",
      sensorId: g.instrumentId,
      summary: g.summary,
    };
  }
  // CANNOT_ASSESS_CADENCE
  const blindPaths = g.blind.map((b) => ({
    class: mapGapBlindClass(b.class),
    detail: `[gap:${b.class}]${b.channel === null ? "" : ` [channel ${b.channel}]`} ${b.detail}`,
  }));
  // A gap read can be CANNOT_ASSESS with an empty blind list only via internal
  // paths that always populate it; guard against an empty set producing a
  // verdict with no reason by carrying the summary as the sole blind path.
  return cannotAssess(
    g.instrumentId,
    blindPaths.length > 0
      ? blindPaths
      : [{ class: "INELIGIBLE_SCOPE", detail: g.summary }]
  );
}

// ── The result ────────────────────────────────────────────────────────────────

export interface DispositionResult {
  /** The FINAL disposition, after the §6 delivery rule. */
  readonly disposition: ChokepointDisposition;
  /**
   * The FINAL execute permission. This is the ONE field a gate reads to decide
   * whether to run the action. HOLD and HOLD-BLIND are always false; a delivery
   * failure can only ever turn this from true to false, never the reverse.
   */
  readonly execute: boolean;
  /** True when the §6 delivery rule changed the disposition. */
  readonly narrowed: boolean;
  readonly deliveryNote: string;
  /** The raw, pre-delivery decision, kept so a reviewer sees what was composed. */
  readonly decision: ChokepointDecision;
  /** The PASS-BLIND record, when one was written. Null otherwise, and reported. */
  readonly record: ChokepointLedgerRecord | null;
  /** True only when a PASS-BLIND record durably persisted. */
  readonly recorded: boolean;
  /** A batched notice, when this event closed a window. Null otherwise. */
  readonly notice: BatchNotice | null;
  /** The floor reading attempted for this decision, when a trail is wired. */
  readonly floorTrailRecord: FloorTrailRecord | null;
  /** True only when that reading durably persisted. */
  readonly floorTrailRecorded: boolean;
  /**
   * Persistence detail from the floor trail. Null means either durable success
   * or UNWIRED; distinguish those states with floorTrailRecord/Recorded. The
   * unwired cautious default is also printed in deliveryNote for any raw permit.
   */
  readonly floorTrailDetail: string | null;
}

export interface ChokepointOptions {
  /** The injected stakes line (§4). Absent -> blind actions are HELD (cautious). */
  readonly line?: StakesLine;
  /**
   * T27 · F6. Every throw the wiring caught for THIS act (seam catches, the
   * readers' own nets, an adapter that threw before any reading). Non-empty ->
   * the act does not execute whatever the line (see holdForReaderThrows).
   * Absent or empty -> today's mapping, unchanged. The wiring builds a
   * chokepoint per act, after every reader has run, so the list is complete.
   */
  readonly readerThrows?: readonly ReaderThrow[];
  /** Where PASS-BLIND records land (§5). Absent -> PASS-BLIND fails closed to HOLD-BLIND. */
  readonly ledger?: ChokepointLedger;
  /** The batched PASS-BLIND notifier (§5). Absent -> records still land; no notices. */
  readonly notifier?: BatchedNotifier;
  /**
   * The independent all-disposition floor trail. When injected, every decision
   * attempts exactly one append. An absent trail is a cautious-default semantic
   * state, not a bypass: this chokepoint issues no permit it cannot account for.
   * Absent or non-durable trail + executing disposition -> HOLD-BLIND. Held
   * dispositions remain held.
   */
  readonly floorTrail?: FloorTrail;
  /**
   * Supplies the decision timestamp written to floorTrail. The evidence-log
   * discipline is caller-supplied time; absent here falls back to Date.now()
   * because guard predates and carries no timestamp argument.
   */
  readonly decisionClock?: () => number;
  /**
   * Deliver a RELEASE permit to the executor, or a HOLD/HOLD-BLIND escalation to
   * the seat, and report whether it arrived (§6). Absent -> delivery is assumed
   * to succeed: the caller receives the returned result synchronously, so the
   * return value IS the delivery. Provide this only when the seat or executor is
   * out of process and delivery can actually fail.
   */
  readonly deliver?: (info: {
    readonly disposition: ChokepointDisposition;
    readonly execute: boolean;
  }) => DispositionDelivery;
}

/**
 * The chokepoint. `guard` is the whole interface: one action, the verdicts the
 * wired readers returned on it, and the action's injected stakes -> exactly one
 * of four dispositions, with the record and notice §5 requires and the
 * fail-closed delivery §6 requires already applied.
 */
export class Chokepoint {
  constructor(private readonly options: ChokepointOptions = {}) {}

  guard(
    action: ProposedAction,
    sensorVerdicts: readonly SensorVerdict[],
    stakes?: Stakes | null
  ): DispositionResult {
    const decision = decideChokepoint(
      action,
      sensorVerdicts,
      stakes ?? null,
      this.options.line ?? null,
      this.options.readerThrows ?? null
    );

    let record: ChokepointLedgerRecord | null = null;
    let recorded = false;
    let notice: BatchNotice | null = null;
    let delivery: DispositionDelivery;
    let floorTrailRecord: FloorTrailRecord | null = null;
    let floorTrailRecorded = false;
    let floorTrailDetail: string | null = null;

    // The floor reading lands immediately after the pure decision and before
    // any permit can be delivered. This is the exact decision-path wiring point:
    // one attempt for every raw disposition, never inside a sensor read.
    let floorTrailFailure: Extract<
      DispositionDelivery,
      { readonly kind: "NOT_DELIVERED" }
    > | null = null;
    if (this.options.floorTrail === undefined) {
      if (decision.executeRaw) {
        floorTrailFailure = {
          kind: "NOT_DELIVERED",
          detail:
            "NO FLOOR TRAIL WAS WIRED: the cautious default refuses this permit. " +
            "The chokepoint issues no permit it cannot account for; a permit " +
            "without a durable floor reading is the silent fail-open.",
        };
      }
    } else {
      const trailOutcome = this.options.floorTrail.record({
        timestamp: (this.options.decisionClock ?? Date.now)(),
        actionId: action.id,
        disposition: decision.disposition,
        floorKind: decision.floorKind,
        blindSplit: decision.blindSplit,
        impactClass: decision.stakes?.impactClass ?? "",
        sensorIds: decision.sensorIds.join("|"),
        sensorKinds: decision.sensorKinds.join("|"),
      });
      floorTrailRecord = trailOutcome.record;
      floorTrailRecorded = trailOutcome.persisted;
      floorTrailDetail = trailOutcome.detail;
      if (!trailOutcome.persisted) {
        floorTrailFailure = {
          kind: "NOT_DELIVERED",
          detail:
            `the mandatory floor-trail reading did not persist: ${trailOutcome.detail}`,
        };
      }
    }

    if (decision.disposition === "PASS_BLIND") {
      // §5: a PASS-BLIND MUST be recorded. The durable record IS the delivery
      // precondition — an unrecorded pass is the silent fail-open, so a record
      // that does not persist fails the PASS-BLIND closed to HOLD-BLIND (§6).
      if (this.options.ledger === undefined) {
        const ledgerFailure: Extract<
          DispositionDelivery,
          { readonly kind: "NOT_DELIVERED" }
        > = {
          kind: "NOT_DELIVERED",
          detail:
            "no ledger was injected, so this PASS-BLIND could not be recorded; " +
            "§5 requires every PASS-BLIND to be recorded, so it fails closed.",
        };
        delivery = this.combineFailures(floorTrailFailure, ledgerFailure);
      } else {
        const outcome = this.options.ledger.record({
          actionId: action.id,
          disposition: "PASS_BLIND",
          floorKind: decision.floorKind,
          impactClass: decision.stakes?.impactClass ?? "",
          sensorIds: decision.sensorIds.join("|"),
        });
        record = outcome.record;
        recorded = outcome.persisted;
        if (!outcome.persisted) {
          const ledgerFailure: Extract<
            DispositionDelivery,
            { readonly kind: "NOT_DELIVERED" }
          > = {
            kind: "NOT_DELIVERED",
            detail: `the mandatory PASS-BLIND record did not persist: ${outcome.detail}`,
          };
          delivery = this.combineFailures(floorTrailFailure, ledgerFailure);
        } else {
          // The mandatory record durably persisted. Persistence and delivery are
          // TWO INDEPENDENT PRECONDITIONS (F1): a durable record is not proof the
          // permit reached its consumer. So deliver through the SAME injected
          // boundary every other disposition uses, then narrow. A dropping
          // boundary fails this PASS-BLIND closed to HOLD-BLIND even though the
          // record landed — the record proves the pass was logged, never that it
          // was delivered. The batched notice fires on the RECORDING (§5),
          // independent of whether delivery then succeeded.
          delivery = floorTrailFailure ?? this.resolveDelivery(decision);
          if (this.options.notifier !== undefined) {
            notice = this.options.notifier.onPassBlindRecorded();
          }
        }
      }
    } else {
      delivery = floorTrailFailure ?? this.resolveDelivery(decision);
    }

    const narrowed = narrowForDisposition(decision.disposition, delivery);
    return {
      disposition: narrowed.disposition,
      execute: narrowed.execute,
      narrowed: narrowed.narrowed,
      deliveryNote: narrowed.note,
      decision,
      record,
      recorded,
      notice,
      floorTrailRecord,
      floorTrailRecorded,
      floorTrailDetail,
    };
  }

  private resolveDelivery(decision: ChokepointDecision): DispositionDelivery {
    if (this.options.deliver === undefined) return { kind: "DELIVERED" };
    return this.options.deliver({
      disposition: decision.disposition,
      execute: decision.executeRaw,
    });
  }

  private combineFailures(
    first: Extract<DispositionDelivery, { readonly kind: "NOT_DELIVERED" }> | null,
    second: Extract<DispositionDelivery, { readonly kind: "NOT_DELIVERED" }>
  ): DispositionDelivery {
    if (first === null) return second;
    return {
      kind: "NOT_DELIVERED",
      detail: `${first.detail} ALSO: ${second.detail}`,
    };
  }
}

// ── Rendering — the printed contradiction the type system cannot carry (§7) ────

/**
 * The lines the chokepoint prints about what it DOES NOT CLAIM. Where §7 can be
 * a type error it is (claimFromDisposition); where it cannot — a human reading a
 * disposition as health — it is a printed contradiction, here.
 */
export const CHOKEPOINT_SCOPE_LINES: readonly string[] = [
  "DOES NOT MEAN SAFE ON A RELEASE. " + RELEASE_IS_NOT_SAFE,
  "DOES NOT COMPOSE RELEASES INTO HEALTH. No count or run of RELEASEs is a",
  "  positive health statement; MICA emits none, ever.",
  "DOES NOT READ AN ACTION'S PAYLOAD. It composes sensor verdicts. Truth of what",
  "  it released is out of scope and unknowable from here.",
  "DOES NOT JUDGE ACTIONS NOT ROUTED TO IT. " + ROUTING_PRECONDITION,
  "DOES NOT ADD A FOURTH VERDICT KIND OR EDIT A SENSOR VERDICT. The dispositions",
  "  are a new type computed FROM the frozen verdict grammar, never by changing it.",
  "ISSUES NO PERMIT IT CANNOT ACCOUNT FOR. RELEASE and PASS-BLIND require a",
  "  durably persisted floor reading; absent or failed trail means HOLD-BLIND.",
  "FAILS CLOSED ON A DROPPED DISPOSITION. " + DELIVERY_FAILS_CLOSED,
];

/** Human-readable render of a disposition. Distinct banner per disposition. */
export function renderDisposition(result: DispositionResult): string {
  const d = result.disposition;
  const out: string[] = [];
  out.push(`[${CHOKEPOINT_ID}] DISPOSITION: ${DISPOSITION_LABEL[d]}`);
  out.push(
    `  action=${result.decision.action.id}  execute=${result.execute}  ` +
      `floor=${result.decision.floorKind}`
  );
  out.push(`  ${result.decision.rationale}`);
  // T27 · the hold's reason beside the label, never only inside the rationale.
  if (result.decision.holdReason !== null) {
    out.push(`  HOLD REASON: ${result.decision.holdReason}`);
  }
  for (const t of result.decision.readerThrows) {
    out.push(`  READER THREW: ${renderReaderThrows([t])} — WIRED AND BLIND; the thrown text is withheld`);
  }
  if (result.narrowed) {
    out.push(`  ⚠ NARROWED BY DELIVERY: ${result.deliveryNote}`);
  }
  // The floor reading's own line, printed for EVERY disposition and never only
  // for the executing ones. `floorTrailDetail` is null on a durable append and
  // null when no trail is wired, so a non-null value is always a real failure —
  // and since S83 it names the append lock path, which is the operator's remedy.
  //
  // UNCONDITIONAL ON PURPOSE, and it does overlap. When a RAW RELEASE or
  // PASS-BLIND fails its floor reading, narrowForDisposition puts the same
  // detail inside `deliveryNote` and the ⚠ line above already carries it. When a
  // raw HOLD or HOLD-BLIND fails one, that function returns `narrowed: false`
  // (the action was already held), the ⚠ line does not print, and the detail was
  // computed and THROWN AWAY. That silent case is the one an operator most needs
  // — a hold is what a failed floor reading forces — so this line does not ask
  // whether the ⚠ line already said it. Suppressing it conditionally would couple
  // this renderer to narrowForDisposition's narrowed flag invisibly, and a later
  // change there would silence this line without failing anything.
  //
  // It is deliberately NOT the RECORDED: line below: that one is the PASS-BLIND
  // ledger. These are two different books and two different failures.
  if (result.floorTrailDetail !== null) {
    out.push(`  FLOOR READING NOT DURABLE: ${result.floorTrailDetail}`);
  }
  if (result.decision.findings.length > 0) {
    out.push(`  ADVERSE FINDINGS RIDING ON THIS DISPOSITION:`);
    for (const f of result.decision.findings) {
      out.push(`    · ${f.code}: ${f.detail}`);
    }
  }
  if (result.decision.blindPaths.length > 0) {
    out.push(`  UNREAD SCOPES:`);
    for (const b of result.decision.blindPaths) {
      out.push(`    · ${b.class}: ${b.detail}`);
    }
  }
  if (result.disposition === "PASS_BLIND") {
    out.push(
      `  RECORDED: ${result.recorded ? "yes (durable)" : "NO — see delivery note"}`
    );
    if (result.notice !== null) {
      out.push(`  NOTICE: ${result.notice.message}`);
    }
  }
  out.push("");
  for (const line of renderStakesLine(result.decision.line)) {
    out.push(`  ${line}`);
  }
  out.push("");
  out.push("  WHAT THIS DISPOSITION DOES NOT CLAIM:");
  for (const line of CHOKEPOINT_SCOPE_LINES) out.push(`    ${line}`);
  return out.join("\n");
}

export { ChokepointLedger } from "./ledger";
export type { ChokepointLedgerRecord } from "./ledger";
export { FloorTrail } from "./floor-trail";
export type {
  FloorTrailLoadState,
  FloorTrailOptions,
  FloorTrailRecord,
  FloorTrailRecordInput,
  FloorTrailRecordOutcome,
  FloorTrailVerifyResult,
} from "./floor-trail";
export { BatchedNotifier, DEFAULT_NOTIFY_WINDOW } from "./notifier";
export type { BatchNotice, NoticeSink } from "./notifier";
export * from "./types";
