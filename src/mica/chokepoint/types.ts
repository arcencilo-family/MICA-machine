// ── MICA · the loop chokepoint — dispositions, floor, and scope ───────────────
//
// WHAT THIS IS
//
//   A pre-execution GATE. It takes a proposed action plus the verdicts the built
//   MICA sensors returned on it, composes those verdicts through a NON-
//   COMPENSATORY FLOOR (§2 of the build brief; min() semantics), and returns one
//   of four DISPOSITIONS that tell the caller whether the action may execute:
//
//     RELEASE     executes.        floor = SILENT
//     HOLD        does not execute. floor = ALARM
//     HOLD-BLIND  does not execute. floor = CANNOT_ASSESS, stakes ≥ line
//     PASS-BLIND  executes, recorded. floor = CANNOT_ASSESS, stakes < line
//
//   The dispositions are a NEW type, computed FROM sensor verdicts. This file
//   NEVER edits a SensorVerdict, never adds a fourth VerdictKind, and never
//   touches verdict-logic.frozen.json. The verdict grammar is consumed, not
//   extended.
//
// ── THREE LOAD-BEARING CORRECTIONS THIS BUILD MAKES AGAINST THE BRIEF ──────────
//
//   1. THE THIRD READER DOES NOT RETURN A SensorVerdict. The brief (§2) says the
//      three built readers each return a SensorVerdict, "clerk1.gap via its gap
//      read". On disk `readGaps(...)` (src/clerk/gap.ts) returns a GapRead —
//      GAP_OBSERVED | NO_GAP_OBSERVED | CANNOT_ASSESS_CADENCE — its own union,
//      NOT a SensorVerdict. So the floor cannot compose over it directly. An
//      explicit adapter (gapReadToVerdict, in ./index) bridges it, read-only.
//      The chokepoint core composes over SensorVerdict[]; the adapter is named,
//      not smuggled.
//
//   2. AN EMPTY FLOOR IS NOT A CLEAN FLOOR. A naive min() over an EMPTY set of
//      verdicts returns "all SILENT" -> RELEASE, i.e. release everything a
//      chokepoint with no readers wired sees. That is the exact fail-open the
//      architecture refuses: no reader ran, so nothing was read, so this is
//      CANNOT_ASSESS — blind, not clean. Same shape as Sig's "empty map does not
//      buy a clean reading" and the clerk's "empty roster does not buy a clean
//      reading". composeFloorKind([]) is CANNOT_ASSESS, deliberately.
//
//   3. THE STAKES LINE GOVERNS ONLY THE CANNOT_ASSESS SPLIT. A clear ALARM HOLDs
//      regardless of stakes — there is no stakes value that releases an alarm
//      (brief §3, ruled). Enforced in mapFloorToDisposition and probed in the
//      test.
//
// The floor rule itself is LIFTED from Sig's flag-composition (src/mica/sig/
// index.ts, the "Composition" block): "Any flag ALARMs -> ALARM. No alarm, any
// flag CANNOT_ASSESS -> CANNOT_ASSESS. Every flag SILENT -> SILENT." Sig applies
// it across its two flags; the chokepoint applies the SAME rule one level up,
// across sensors. It is expressed here once, as a named function over
// VerdictKind, so the rule has a single canonical home a reader can attack.

import type {
  BlindPath,
  Finding,
  SensorVerdict,
  VerdictKind,
} from "../types";

// ── The disposition grammar — NEW, and frozen at four ─────────────────────────

export type ChokepointDisposition =
  | "RELEASE"
  | "HOLD"
  | "HOLD_BLIND"
  | "PASS_BLIND";

/** The label a human reader sees. The brief spells two of them with a hyphen. */
export const DISPOSITION_LABEL: Record<ChokepointDisposition, string> = {
  RELEASE: "RELEASE",
  HOLD: "HOLD",
  HOLD_BLIND: "HOLD-BLIND",
  PASS_BLIND: "PASS-BLIND",
};

/**
 * Whether a disposition PERMITS the action to run. Single source of truth: every
 * other file reads `execute` off a result rather than re-deriving this, so the
 * "does not execute" half of HOLD/HOLD-BLIND cannot drift.
 *
 * HOLD and HOLD-BLIND never execute. RELEASE and PASS-BLIND execute — subject to
 * the delivery rule in §6, applied by narrowForDisposition, which can only ever
 * move an executing disposition to a non-executing one, never the reverse.
 */
export function executes(d: ChokepointDisposition): boolean {
  return d === "RELEASE" || d === "PASS_BLIND";
}

/**
 * The single most dangerous misreading, stated in words the way the sensors
 * state SILENCE_IS_NOT_HEALTH. A RELEASE is not a clean bill of health.
 */
export const RELEASE_IS_NOT_SAFE =
  "RELEASE means NO UN-HEALTH WAS DETECTED IN THE READ SCOPES, THIS ACTION. It " +
  "is not a statement that the action is safe, good, or healthy; MICA emits no " +
  "positive health statement, and a floor of SILENT verdicts is a floor of " +
  "absences-of-finding, not a floor of attestations. A run of RELEASEs is not a " +
  "safe session, and it judged only the actions ROUTED to it.";

// ── The floor (§2) — the non-compensatory min() rule, named once ──────────────

/**
 * Compose sensor verdict KINDS into one floor kind.
 *
 *   (empty)              -> CANNOT_ASSESS   (no reader ran: BLIND, not clean —
 *                                            correction 2 above)
 *   any ALARM            -> ALARM           (one adverse reading caps the floor;
 *                                            a clean scope cannot buy it back)
 *   else any CANNOT_ASSESS -> CANNOT_ASSESS (an unread scope is not silence)
 *   else                 -> SILENT          (every wired reader read and was
 *                                            silent — still not a health claim)
 *
 * This is min() with ALARM < CANNOT_ASSESS < SILENT as "healthiness", and it is
 * non-compensatory by construction: no number of SILENT verdicts raises the
 * floor above its worst member. It is the same rule Sig applies across its
 * flags; here it is across sensors.
 */
export function composeFloorKind(
  kinds: readonly VerdictKind[]
): VerdictKind {
  if (kinds.length === 0) return "CANNOT_ASSESS";
  if (kinds.some((k) => k === "ALARM")) return "ALARM";
  if (kinds.some((k) => k === "CANNOT_ASSESS")) return "CANNOT_ASSESS";
  return "SILENT";
}

// ── The stakes line (§4) — injected, never defaulted ──────────────────────────
//
// Following types.ts constraint 3 (no numbers in the spec; every threshold
// injected by the caller): the stakes line is a DEPLOYMENT FACT. MICA neither
// computes the action's impact class nor decides where the line sits.
//
// GRANULARITY (deferred to this build by design §4): a small ORDERED SET of
// named impact classes, low->high, plus one class naming where a blind action
// starts being HELD rather than passed. A deployer moves exactly one string
// (`holdAtOrAbove`) to make the gate stricter or looser. Both the vocabulary and
// the line are printed (loadStateScopeLines discipline), so what a run was told
// is visible, never silent.

export interface StakesLine {
  /**
   * The deployment's impact vocabulary, ORDERED low->high. INJECTED. There is no
   * default and no built-in ladder: what "impact" means and how many rungs it
   * has is a deployment fact this code has no access to.
   */
  readonly classes: readonly string[];
  /**
   * The lowest class at or above which a BLIND action is HELD (HOLD-BLIND)
   * rather than passed (PASS-BLIND). INJECTED. Must be a member of `classes`.
   */
  readonly holdAtOrAbove: string;
}

export interface Stakes {
  /**
   * This action's impact class, supplied by the CALLER. MICA does not compute
   * it. Must be a member of the injected line's `classes` to be usable.
   */
  readonly impactClass: string;
}

export type BlindSplit =
  /** floor was not CANNOT_ASSESS; the line did not apply. */
  | "NOT_APPLICABLE"
  /** stakes ≥ line -> HOLD-BLIND. */
  | "ABOVE_LINE"
  /** stakes < line -> PASS-BLIND. */
  | "BELOW_LINE"
  /**
   * The line or the action's stakes were absent or unusable. The CAUTIOUS
   * DEFAULT applies (§4): treat as above the line -> HOLD-BLIND. An unconfigured
   * chokepoint holds blind actions; it never passes them.
   */
  | "NO_USABLE_LINE_CAUTIOUS_DEFAULT";

function isUsableLine(line: StakesLine | null | undefined): line is StakesLine {
  return (
    !!line &&
    Array.isArray(line.classes) &&
    line.classes.length > 0 &&
    line.classes.every((c) => typeof c === "string" && c.trim().length > 0) &&
    typeof line.holdAtOrAbove === "string" &&
    line.classes.includes(line.holdAtOrAbove)
  );
}

/**
 * The CANNOT_ASSESS split, and ONLY that split. Returns the cautious default on
 * any missing or unusable input — never the permissive one.
 */
export function stakesSplit(
  stakes: Stakes | null | undefined,
  line: StakesLine | null | undefined
): Exclude<BlindSplit, "NOT_APPLICABLE"> {
  if (!isUsableLine(line)) return "NO_USABLE_LINE_CAUTIOUS_DEFAULT";
  if (
    !stakes ||
    typeof stakes.impactClass !== "string" ||
    !line.classes.includes(stakes.impactClass)
  ) {
    return "NO_USABLE_LINE_CAUTIOUS_DEFAULT";
  }
  const impactRank = line.classes.indexOf(stakes.impactClass);
  const lineRank = line.classes.indexOf(line.holdAtOrAbove);
  return impactRank >= lineRank ? "ABOVE_LINE" : "BELOW_LINE";
}

/** Renders an injected line for printing. Order is the deployer's, kept as-is. */
export function renderStakesLine(
  line: StakesLine | null | undefined
): string[] {
  if (!isUsableLine(line)) {
    return [
      "NO USABLE STAKES LINE WAS INJECTED FOR THIS RUN. Every blind action is",
      "  therefore HELD (HOLD-BLIND), never passed: the cautious default. This",
      "  instrument holds no impact ladder of its own and no default line — with",
      "  nothing injected it does not pass blind actions.",
    ];
  }
  return [
    "THIS RUN'S STAKES LINE (impact classes, low->high), INJECTED BY THE CALLER:",
    `  [${line.classes.join(" < ")}]`,
    `  A blind action is HELD at or above \`${line.holdAtOrAbove}\`, and PASSED`,
    "  (recorded) below it. MICA does not compute an action's impact class or",
    "  decide where this line sits — both are deployment facts. Move",
    "  `holdAtOrAbove` to make the gate stricter or looser; that is the",
    "  deployer's decision, printed here so it is not silent.",
  ];
}

// ── The mapping (§3) — floor kind -> raw disposition ──────────────────────────

export interface FloorMapping {
  readonly disposition: ChokepointDisposition;
  readonly blindSplit: BlindSplit;
}

/**
 * Map a composed floor kind to a raw (pre-delivery) disposition.
 *
 * THE STAKES LINE IS CONSULTED ONLY IN THE CANNOT_ASSESS BRANCH. An ALARM HOLDs
 * whatever the stakes are — there is no stakes value that releases an alarm.
 */
export function mapFloorToDisposition(
  floorKind: VerdictKind,
  stakes: Stakes | null | undefined,
  line: StakesLine | null | undefined
): FloorMapping {
  if (floorKind === "ALARM") {
    return { disposition: "HOLD", blindSplit: "NOT_APPLICABLE" };
  }
  if (floorKind === "SILENT") {
    return { disposition: "RELEASE", blindSplit: "NOT_APPLICABLE" };
  }
  // CANNOT_ASSESS — and only here does the line govern anything.
  const split = stakesSplit(stakes, line);
  return {
    disposition: split === "BELOW_LINE" ? "PASS_BLIND" : "HOLD_BLIND",
    blindSplit: split,
  };
}

// ── F6 · A READER THAT THREW (T27) ────────────────────────────────────────────
//
// The arbiter, 2026-10-09 16:02Z: "an act whose reader threw is HELD regardless of
// pilot — instrument failure is not the blindness the pilot was sealed for."
// Scope, ruled 2026-10-17 15:37Z ("Throws only, as recommended"): REAL THROWS
// ONLY. A throw is exactly (i) a throw the wire seam caught at a reader step,
// (ii) a reader's OWN net (G1_READER_THREW, G2_READER_THREW, G4_READER_THREW),
// (iii) a log's or book's adapter throwing before any reading existed. Every
// typed NOT READABLE a reader returns through its own try path is NOT a throw
// and never appears here: it composes exactly as before, PASS_BLIND below a
// pilot's line included.
//
// THE TRIGGER IS THIS LIST AND NOTHING ELSE — never the blind class
// MISSING_CONFIGURATION (throws and configuration gaps share it) and never a
// CANNOT_ASSESS floor as such. The caller (the wiring) names each throw; the
// floor does not infer one from a verdict's words.
//
// ⚠ FORK-2 IS THE ARBITER'S AND IS UNRULED AT THIS BUILD. Built here as (a):
// HOLD_BLIND with a typed holdReason READER_THREW, so the grammar stays frozen
// at four and executes() and every consumer are unchanged. Precedent:
// narrowForDisposition already returns HOLD_BLIND for a reason that is not the
// stakes split (NOT_DELIVERED). The cost of (a), stated: the label alone no
// longer implies "stakes at or above the line"; the reason prints beside it,
// in the rationale, and blindSplit is reported AS COMPUTED, so BELOW_LINE +
// HOLD_BLIND + READER_THREW reads apart from an above-line hold.

/** One throw the wiring caught. Codes and class words only; never thrown text. */
export interface ReaderThrow {
  /** The reader's sensorId. */
  readonly reader: string;
  /** The seam's <READER>_THREW code, or the reader's own <G>_READER_THREW. */
  readonly code: string;
  /**
   * The error's class word from a fixed set, or null when the throw was caught
   * by the READER'S OWN net (the class then lives only inside the reader's own
   * detail, which the wiring does not parse).
   */
  readonly errorClass: string | null;
}

/** Why a non-ALARM act is held although the stakes split alone would not hold it. */
export type HoldReason = "READER_THREW";

/** The sentence every READER_THREW hold carries, verbatim. */
export const READER_THREW_HOLDS =
  "HOLD REASON READER_THREW (F6, the arbiter holds 2026-10-09 16:02Z): a reader THREW for this act, and an act whose " +
  "reader threw is HELD whatever the pilot or the stakes line — instrument failure is not the blindness a " +
  "pilot passes. The thrown text is withheld; codes and class words only.";

/** "reader · code (class)" per throw, joined. Throw-free: fixed strings and the entries' own strings only. */
export function renderReaderThrows(throws: readonly ReaderThrow[]): string {
  return throws
    .map((t) => `${t.reader} · ${t.code} (${t.errorClass === null ? "class in the reader's own detail" : t.errorClass})`)
    .join("; ");
}

/**
 * F6 over a raw floor mapping. PURE. A throw NEVER LOWERS: an ALARM stays HOLD
 * (the throw is named beside it, holdReason null — the ALARM is the reason);
 * any other floor with at least one throw becomes HOLD_BLIND with holdReason
 * READER_THREW, blindSplit kept as computed. No throws: the mapping unchanged.
 */
export function holdForReaderThrows(
  mapping: FloorMapping,
  throws: readonly ReaderThrow[]
): FloorMapping & { readonly holdReason: HoldReason | null } {
  if (throws.length === 0 || mapping.disposition === "HOLD") {
    return { ...mapping, holdReason: null };
  }
  return { disposition: "HOLD_BLIND", blindSplit: mapping.blindSplit, holdReason: "READER_THREW" };
}

// ── The decision (pure, pre-delivery) ─────────────────────────────────────────

export interface ProposedAction {
  /**
   * An opaque identifier the record can reference. The chokepoint DOES NOT read
   * the action's payload and never attests anything about its content (§7.3).
   */
  readonly id: string;
}

export interface ChokepointDecision {
  /** Raw disposition, before the §6 delivery rule is applied. */
  readonly disposition: ChokepointDisposition;
  /** Whether the RAW disposition permits execution. Final value is on the result. */
  readonly executeRaw: boolean;
  readonly floorKind: VerdictKind;
  readonly blindSplit: BlindSplit;
  /** The verdict kinds composed, in the order the readers were wired. */
  readonly sensorKinds: readonly VerdictKind[];
  /** Sensor ids that contributed, for the record and the render. */
  readonly sensorIds: readonly string[];
  /** ADVERSE findings ride on the disposition (§3): every ALARM finding. */
  readonly findings: readonly Finding[];
  /** Unread scopes ride on the disposition: every CANNOT_ASSESS blind path. */
  readonly blindPaths: readonly BlindPath[];
  readonly action: ProposedAction;
  readonly stakes: Stakes | null;
  readonly line: StakesLine | null;
  readonly rationale: string;
  /** T27 · every throw the wiring named for this act, [] when none. Never inferred from a verdict. */
  readonly readerThrows: readonly ReaderThrow[];
  /** T27 · READER_THREW exactly when a throw made a non-ALARM act HOLD_BLIND; null otherwise. */
  readonly holdReason: HoldReason | null;
}

/**
 * Compose a set of sensor verdicts into a raw disposition. PURE: no side
 * effects, no delivery, no recording. Exported so the mapping can be tested and
 * read directly, exactly as engStructure/narrowForDelivery are.
 *
 * The verdict grammar is consumed here and nowhere altered: this reads `.kind`,
 * `.findings`, `.blindPaths` off SensorVerdicts and returns a new object.
 */
export function decideChokepoint(
  action: ProposedAction,
  sensorVerdicts: readonly SensorVerdict[],
  stakes?: Stakes | null,
  line?: StakesLine | null,
  readerThrows?: readonly ReaderThrow[] | null
): ChokepointDecision {
  const sensorKinds = sensorVerdicts.map((v) => v.kind);
  const sensorIds = sensorVerdicts.map((v) => v.sensorId);
  const floorKind = composeFloorKind(sensorKinds);
  // T27 · copied, so a caller's later push cannot move a decision already taken.
  const throws: readonly ReaderThrow[] = [...(readerThrows ?? [])];
  const { disposition, blindSplit, holdReason } = holdForReaderThrows(
    mapFloorToDisposition(floorKind, stakes, line),
    throws
  );

  const findings: Finding[] = [];
  const blindPaths: BlindPath[] = [];
  for (const v of sensorVerdicts) {
    if (v.kind === "ALARM") findings.push(...v.findings);
    if (v.kind === "CANNOT_ASSESS") blindPaths.push(...v.blindPaths);
  }

  const scopeNote =
    sensorVerdicts.length === 0
      ? "NO READER WAS WIRED for this action: the floor is CANNOT_ASSESS, blind."
      : sensorVerdicts.map((v) => `${v.sensorId}=${v.kind}`).join("; ");

  const rationale =
    `floor=${floorKind} over ${sensorVerdicts.length} reader(s) [${scopeNote}] ` +
    `-> ${DISPOSITION_LABEL[disposition]}` +
    (floorKind === "CANNOT_ASSESS" ? ` (blind split: ${blindSplit})` : "") +
    (disposition === "RELEASE" ? `. ${RELEASE_IS_NOT_SAFE}` : "") +
    (throws.length === 0
      ? ""
      : holdReason === "READER_THREW"
        ? `. ${READER_THREW_HOLDS} READER(S) THAT THREW: ${renderReaderThrows(throws)}.` +
          (blindSplit === "BELOW_LINE"
            ? " The stakes split alone would have PASSED this act blind; the throw holds it."
            : " The act was already held by the stakes split; the throw is named beside it.")
        : `. READER(S) THAT THREW, named beside the ALARM (a throw never lowers a hold): ${renderReaderThrows(throws)}.`);

  return {
    disposition,
    executeRaw: executes(disposition),
    floorKind,
    blindSplit,
    sensorKinds,
    sensorIds,
    findings,
    blindPaths,
    action,
    stakes: stakes ?? null,
    line: line ?? null,
    rationale,
    readerThrows: throws,
    holdReason,
  };
}

// ── §6 · the NOT_DELIVERED rule — the fail-open this build must not open ───────
//
// A disposition that does not reach whoever must act on it is a lock whose
// "stop" was dropped. This is the disposition-level mirror of narrowForDelivery
// (src/mica/export/index.ts), whose rule is: degradation runs TOWARD the alarm,
// never away from it. Here:
//
//   HOLD / HOLD-BLIND + not delivered  -> unchanged, STILL NON-EXECUTING.
//       These already do not execute; the action stays held. The delivery
//       failure is recorded on the result (the escalation reached no seat, which
//       is worse), but a dropped "stop" can only make the gate more closed, and
//       here it makes it no less closed.
//
//   RELEASE / PASS-BLIND + not delivered -> HOLD-BLIND, NON-EXECUTING.
//       A permit whose delivery is uncertain must not let the action through.
//       A RELEASE degrades toward HOLD-BLIND (§6, explicit), and a PASS-BLIND
//       whose mandatory record did not persist degrades the same way — an
//       unrecorded pass is precisely the silent fail-open (§5).
//
// THE INVARIANT, IN ONE LINE: a delivery failure can only ever move an executing
// disposition to a non-executing one. It NEVER produces execution, and it never
// silently becomes a RELEASE. Tested exhaustively.

export type DispositionDelivery =
  | { readonly kind: "DELIVERED" }
  | { readonly kind: "NOT_DELIVERED"; readonly detail: string };

export interface NarrowedDisposition {
  readonly disposition: ChokepointDisposition;
  readonly execute: boolean;
  /** True when the delivery failure changed the disposition. */
  readonly narrowed: boolean;
  /** Stated in the disposition's own output, per §6. */
  readonly note: string;
}

export const DELIVERY_FAILS_CLOSED =
  "A DELIVERY FAILURE FAILS CLOSED: the action does not execute. A disposition " +
  "that did not reach whoever must act on it is a dropped 'stop', and the only " +
  "safe reading of a dropped stop is that the action was not permitted. This is " +
  "never narrowed toward execution and never silently becomes a RELEASE.";

/**
 * Apply the §6 asymmetry. The ONLY producer of a delivered disposition, pure and
 * without inverse: nothing re-raises a narrowed disposition into execution.
 */
export function narrowForDisposition(
  raw: ChokepointDisposition,
  delivery: DispositionDelivery
): NarrowedDisposition {
  if (delivery.kind === "DELIVERED") {
    return {
      disposition: raw,
      execute: executes(raw),
      narrowed: false,
      note: "delivered.",
    };
  }

  // NOT_DELIVERED. Nothing below this line can produce execution.
  if (raw === "HOLD" || raw === "HOLD_BLIND") {
    return {
      disposition: raw,
      execute: false,
      narrowed: false,
      note:
        `${DISPOSITION_LABEL[raw]} was not delivered (${delivery.detail}). The ` +
        `action was already held and stays held. The escalation reached no seat, ` +
        `which is a worse state and is recorded — but the gate is no less closed. ` +
        `${DELIVERY_FAILS_CLOSED}`,
    };
  }

  // RELEASE / PASS-BLIND -> HOLD-BLIND, non-executing.
  return {
    disposition: "HOLD_BLIND",
    execute: false,
    narrowed: true,
    note:
      `${DISPOSITION_LABEL[raw]} could not be delivered (${delivery.detail}), so ` +
      `it was narrowed to HOLD-BLIND and the action DID NOT EXECUTE. ` +
      (raw === "PASS_BLIND"
        ? "A PASS-BLIND whose mandatory record did not persist is an unrecorded " +
          "pass, which is the silent fail-open this architecture refuses. "
        : "A RELEASE whose delivery is uncertain degrades toward HOLD-BLIND, " +
          "never toward execution. ") +
      DELIVERY_FAILS_CLOSED,
  };
}

// ── §7 · what the chokepoint must NEVER claim — enforced in types ─────────────
//
// The clerk enforces its scope in code: claimFrom(record, "PAYLOAD_TRUTH") is
// typed `never` and throws (src/clerk/scope.ts). The same shape is used here.
// TWO fences, stated at their true strength:
//   · TYPE: the out-of-scope subjects are a DISTINCT union, not assignable to
//     DispositionInScopeClaim. Consumer code parameterised on an in-scope claim
//     cannot be handed a forbidden one — that is a compile error (probed in the
//     test with @ts-expect-error). The `never` return documents intent but does
//     NOT by itself error at the call site, because `never` is assignable
//     everywhere; the throw is what stops that caller.
//   · RUNTIME: the throw covers the JS caller, the `as any` caller, and the
//     caller in another language going through this module.

export type DispositionInScopeClaim =
  /** This action was routed to the chokepoint and composed through the floor. */
  | "ACTION_WAS_ROUTED_AND_READ"
  /** Execution was gated on a delivered, non-holding disposition. */
  | "EXECUTION_WAS_GATED";

export type DispositionOutOfScopeClaim =
  /** §7.1 — a RELEASE means the action is safe/good/healthy. */
  | "RELEASE_MEANS_SAFE"
  /** §7.2 — a run of RELEASEs means the session was safe. */
  | "SESSION_WAS_SAFE"
  /** §7.3 — payload truth of anything it released. */
  | "PAYLOAD_TRUTH"
  /** §7.4 — that it judged every action (it judged every action ROUTED to it). */
  | "JUDGED_EVERY_ACTION"
  /** §7.5 — a positive health attestation synthesised from RELEASEs. */
  | "POSITIVE_HEALTH_FROM_RELEASES";

export const DISPOSITION_ATTESTS: readonly DispositionInScopeClaim[] = [
  "ACTION_WAS_ROUTED_AND_READ",
  "EXECUTION_WAS_GATED",
];

export const DISPOSITION_DOES_NOT_ATTEST: readonly DispositionOutOfScopeClaim[] =
  [
    "RELEASE_MEANS_SAFE",
    "SESSION_WAS_SAFE",
    "PAYLOAD_TRUTH",
    "JUDGED_EVERY_ACTION",
    "POSITIVE_HEALTH_FROM_RELEASES",
  ];

const DISPOSITION_REFUSALS: Record<DispositionOutOfScopeClaim, string> = {
  RELEASE_MEANS_SAFE:
    "A RELEASE is an absence of detected un-health over the READ scopes, this " +
    "action. It is not a claim that the action is safe, good or healthy, and " +
    "there is no positive health statement anywhere in MICA. " +
    RELEASE_IS_NOT_SAFE,
  SESSION_WAS_SAFE:
    "A run of RELEASEs is a run of absences-of-finding over routed actions. " +
    "Read as a safe session it is the same misuse as reading a stream of green " +
    "tokens as health. It attests nothing about the actions it never saw.",
  PAYLOAD_TRUTH:
    "The chokepoint reads sensor verdicts, never an action's payload. A system " +
    "lying in real time can be RELEASEd on every clean-reading scope. Truth of " +
    "what was released is out of scope and unknowable from here.",
  JUDGED_EVERY_ACTION:
    "The chokepoint judged every action ROUTED to it, and cannot verify that " +
    "the deployment routes every consequential action through it. Whether it " +
    "did is a topology claim it cannot make about itself (§8).",
  POSITIVE_HEALTH_FROM_RELEASES:
    "No count, ratio or run of RELEASEs composes into a health attestation. " +
    "Synthesising one is manufacturing exactly the positive statement MICA is " +
    "built never to emit.",
};

declare const DISPOSITION_CLAIM_BRAND: unique symbol;

/**
 * A claim a disposition is permitted to support. Branded so a consumer cannot
 * fabricate one with an object literal: every DispositionClaim in a downstream
 * system came through claimFromDisposition.
 */
export interface DispositionClaim {
  readonly [DISPOSITION_CLAIM_BRAND]: true;
  readonly subject: DispositionInScopeClaim;
  readonly statement: string;
}

export class ChokepointScopeViolation extends Error {
  constructor(readonly subject: string, message: string) {
    super(message);
    this.name = "ChokepointScopeViolation";
  }
}

const DISPOSITION_STATEMENTS: Record<
  DispositionInScopeClaim,
  (d: ChokepointDisposition) => string
> = {
  ACTION_WAS_ROUTED_AND_READ: (d) =>
    `An action routed to this chokepoint was composed through the sensor floor ` +
    `and received disposition ${DISPOSITION_LABEL[d]}. This attests routing and ` +
    `reading of THIS action only — not of any action not routed here.`,
  EXECUTION_WAS_GATED: (d) =>
    `Execution of this action was gated on the disposition: it ran only if the ` +
    `disposition was ${DISPOSITION_LABEL["RELEASE"]} or ` +
    `${DISPOSITION_LABEL["PASS_BLIND"]} AND delivered. This one was ` +
    `${DISPOSITION_LABEL[d]}. Gating is not a safety claim.`,
};

/**
 * Read a claim off a disposition — or refuse, in the type system and at runtime.
 * Mirrors src/clerk/scope.ts::claimFrom exactly.
 */
export function claimFromDisposition(
  d: ChokepointDisposition,
  subject: DispositionInScopeClaim
): DispositionClaim;
export function claimFromDisposition(
  d: ChokepointDisposition,
  subject: DispositionOutOfScopeClaim
): never;
export function claimFromDisposition(
  d: ChokepointDisposition,
  subject: DispositionInScopeClaim | DispositionOutOfScopeClaim
): DispositionClaim {
  if ((DISPOSITION_DOES_NOT_ATTEST as readonly string[]).includes(subject)) {
    const s = subject as DispositionOutOfScopeClaim;
    throw new ChokepointScopeViolation(
      s,
      `OUT OF SCOPE: a chokepoint disposition does not support a claim about ` +
        `${s}. ${DISPOSITION_REFUSALS[s]}`
    );
  }
  if (!(DISPOSITION_ATTESTS as readonly string[]).includes(subject)) {
    throw new ChokepointScopeViolation(
      String(subject),
      `UNKNOWN CLAIM SUBJECT \`${String(subject)}\`. A disposition supports ` +
        `exactly: ${DISPOSITION_ATTESTS.join(", ")}.`
    );
  }
  const s = subject as DispositionInScopeClaim;
  return {
    subject: s,
    statement: DISPOSITION_STATEMENTS[s](d),
  } as unknown as DispositionClaim;
}

// ── §8 · the routing precondition — reported, never verified ──────────────────

export const ROUTING_PRECONDITION =
  "ROUTING PRECONDITION — STAMPED, NOT VERIFIED. This chokepoint interrupts only " +
  "actions ROUTED through it. Whether the deployment routes every consequential " +
  "action through it is a topology claim the chokepoint CANNOT verify about " +
  "itself — the same shape as the clerk's principal-separation precondition. It " +
  "stamps what it judged and states plainly that it cannot attest it judged " +
  "everything. No code here checks routing completeness, and none pretends to.";
