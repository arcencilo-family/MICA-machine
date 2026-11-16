// ──────────────────────────────────────────────────────────────────────────────
// ILAS — CLERK 1: THE GAP DETECTOR. OBJECT B — a READ INSTRUMENT.
//
// This is the only file in src/clerk/ that produces a finding, and it writes
// nothing. The separation from Object A is physical: core.ts stamps GAP RECORDS
// (infrastructure); this file reads the store and produces GAP STOPS (findings).
// Conflating them is how a piece of plumbing acquires the authority of an
// instrument.
//
// TYPED STOPS, per `08b` in full — cited, not restated. Every stop is typed
// twice, by OBJECT and by SHAPE, and carries its own question. There is no
// code path in this file that emits a bare alarm: makeStop() throws if the
// narrative fields are empty, so an untyped stop cannot be constructed at all.
//
// WHAT IT CAN AND CANNOT SAY. It can say "nothing arrived on channel C for
// 40 minutes against a cadence the deployer declared." It can never say "here
// is what should have arrived." A sequencer establishes A before B; it cannot
// establish that C should have happened between them.
// ──────────────────────────────────────────────────────────────────────────────

import { readSubmitterAuth } from "./types";
import type { ClerkRecord, SubmitterAuthState } from "./types";
import type { ChainVerification } from "./verify";

export const GAP_INSTRUMENT_ID = "clerk1.gap";

// ── half (a): what the stop is ABOUT ──────────────────────────────────────────
//
// These are DIFFERENT FINDINGS and must not collapse into one another. A clerk
// that was itself down is not a submitter that went quiet, and reporting the
// first as the second bills a broken probe to the system.

export type GapObject =
  /** The clerk was up throughout and nothing arrived on this channel. */
  | "SUBMITTER_SILENT"
  /** The clerk restarted inside the window: part of the silence is its own. */
  | "CLERK_COVERAGE_GAP"
  /** The clerk's own record did not reconcile at boot. About the record path. */
  | "CHANNEL_IMPAIRED";

// ── half (b): what the stopped state DOES while held ──────────────────────────
//
// "No action" is not the null state. This clerk holds nothing and gates
// nothing, and that has to be SAID: a hold whose shape is undeclared is a
// hidden action. Today there is exactly one shape because the clerk has no
// actuator; it is a union so that adding a gating shape later cannot be done
// without every consumer seeing a new member.

export type GapShape = "RECORD_ONLY_NO_HOLD";

export const SHAPE_STATEMENT: Record<GapShape, string> = {
  RECORD_ONLY_NO_HOLD:
    "SHAPE — RECORD_ONLY_NO_HOLD: this stop holds nothing and gates nothing. " +
    "No privilege is withdrawn, no action is inhibited, no resource is " +
    "reclaimed; the observed system continues at full privilege and is not " +
    "told this stop occurred. The finding is a record and an escalation to a " +
    "human seat, and nothing else. Stated so it is not mistaken for a control.",
};

export interface ClerkCoverage {
  state:
    | "CONTINUOUS_IN_WINDOW"
    | "CLERK_RESTARTED_IN_WINDOW"
    | "CLERK_RECORD_DID_NOT_RECONCILE"
    /**
     * The clerk refused to issue nonces during this window, so an honest
     * submitter could not submit even if it tried. The silence is at least
     * partly the clerk's, and must not be billed to the submitter.
     */
    | "CLERK_REFUSED_CHALLENGES_IN_WINDOW";
  /** clerk_seq of BOOT records falling inside the silence window. */
  boot_seqs: readonly number[];
  detail: string;
}

export interface GapStop {
  object: GapObject;
  shape: GapShape;
  shape_statement: string;
  channel: string;
  cadence: { period_ms: number; grace_ms: number; declared_at_seq: number };
  last_submission: {
    clerk_seq: number;
    clerk_wall_ms: number;
    /** As DECLARED in the submission. Whether it was checked: `auth`. */
    declared_submitter_id: string;
    auth: SubmitterAuthState;
  } | null;
  silence_from_wall_ms: number;
  silence_to_wall_ms: number;
  silence_ms: number;
  /** false when the silence is still open at read time — then silence_ms is a
   *  LOWER BOUND, not a measurement. */
  silence_bounded: boolean;
  clerk_coverage: ClerkCoverage;
  /** clerk_seq of GAP markers the clerk stamped for this episode, if any. The
   *  finding does not depend on them: a clerk that was down stamped none. */
  clerk_marker_seqs: readonly number[];
  /** The typed question handed up. Never a bare alarm. */
  question: string;
}

export type GapBlindClass =
  | "STORE_BREAK"
  | "CHAIN_UNVERIFIED"
  | "NO_RECORDS"
  | "NO_CADENCE_DECLARED"
  /**
   * The channel has a cadence, but its arrivals were never authenticated — so
   * anyone able to reach the submit interface could have produced them, and
   * quiet on this channel could have been manufactured by keeping it warm.
   *
   * QUIET is what this class protects. A GAP on an unauthenticated channel is
   * still reported: an impostor can manufacture arrivals, and therefore quiet,
   * but it cannot manufacture silence that is not there. The blindness is
   * asymmetric because the attack is.
   */
  | "SUBMITTER_UNAUTHENTICATED";

export interface GapBlind {
  class: GapBlindClass;
  /** The channel this blindness is about, or null when it is store-wide. */
  channel: string | null;
  detail: string;
  /** The cheap exit, when there is one. */
  exit: string | null;
}

export interface GapObserved {
  kind: "GAP_OBSERVED";
  instrumentId: string;
  summary: string;
  stops: readonly GapStop[];
  /** Non-empty means part of the deployment could not be assessed at all. */
  blind: readonly GapBlind[];
  channelsAssessed: readonly string[];
}

export interface NoGapObserved {
  kind: "NO_GAP_OBSERVED";
  instrumentId: string;
  /** States in words that this is an absence of finding, not health. */
  summary: string;
  channelsAssessed: readonly string[];
}

export interface CannotAssessCadence {
  kind: "CANNOT_ASSESS_CADENCE";
  instrumentId: string;
  summary: string;
  blind: readonly GapBlind[];
  /** Stops found before the blindness was reached, if any. Never a result. */
  stops: readonly GapStop[];
}

export type GapRead = GapObserved | NoGapObserved | CannotAssessCadence;

export const NO_GAP_IS_NOT_HEALTH =
  "NO_GAP_OBSERVED is an ABSENCE OF FINDING on the declared cadences only. It " +
  "is not a statement of health, it does not say the submissions that arrived " +
  "were true, and it says nothing about any channel for which no cadence was " +
  "declared.";

/**
 * The only constructor for a stop. It refuses to build an untyped one: an
 * untyped stop is a hidden verdict, so the code makes it unconstructible
 * rather than asking politely.
 */
function makeStop(stop: GapStop): GapStop {
  const required: [string, string][] = [
    ["object", stop.object],
    ["shape", stop.shape],
    ["shape_statement", stop.shape_statement],
    ["channel", stop.channel],
    ["question", stop.question],
    ["clerk_coverage.detail", stop.clerk_coverage.detail],
  ];
  for (const [name, value] of required) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(
        `clerk1.gap refused to emit a stop with an empty \`${name}\`: an untyped ` +
          `stop is a hidden verdict and this instrument cannot produce one.`
      );
    }
  }
  return stop;
}

interface ChannelTrack {
  cadence: { period_ms: number; grace_ms: number; declared_at_seq: number } | null;
  /** Reference points in wall time, in chain order. */
  submissions: {
    seq: number;
    wall: number;
    submitter: string;
    auth: SubmitterAuthState;
  }[];
  cadenceDeclaredWall: number | null;
  markers: { seq: number; wall: number }[];
}

function track(map: Map<string, ChannelTrack>, channel: string): ChannelTrack {
  let t = map.get(channel);
  if (t === undefined) {
    t = { cadence: null, submissions: [], cadenceDeclaredWall: null, markers: [] };
    map.set(channel, t);
  }
  return t;
}

/**
 * Whether QUIET on this channel can be measured at all.
 *
 * Two conditions, and both are about the same thing — whether an arrival on
 * this channel could have been manufactured by a party that is not the
 * submitter:
 *
 *   1. every arrival counted as a cadence reference point was AUTHENTICATED; and
 *   2. a roster is in force at the latest boot — because a channel with no
 *      arrivals yet has nothing to authenticate, and its future quiet is
 *      manufacturable at will if anyone may submit.
 *
 * Absence is consumed as typed absence. An unauthenticated channel's quiet is
 * UNMEASURED, and unmeasured is not clean.
 */
function quietAssessable(
  t: ChannelTrack,
  rosterInForce: boolean
): { ok: true } | { ok: false; detail: string } {
  const unauthenticated = t.submissions.filter(
    (s) => s.auth !== "AUTHENTICATED"
  );
  if (unauthenticated.length > 0) {
    const states = [...new Set(unauthenticated.map((s) => s.auth))].join(", ");
    return {
      ok: false,
      detail:
        `${unauthenticated.length} of ${t.submissions.length} arrival(s) on this ` +
        `channel were not authenticated (${states}), at clerk_seq ` +
        `${unauthenticated.map((s) => s.seq).slice(0, 8).join(", ")}` +
        `${unauthenticated.length > 8 ? ", …" : ""}. Anyone able to reach the ` +
        `submit interface could have produced them, so quiet on this channel may ` +
        `have been manufactured by keeping it warm. UNMEASURED, not clean.`,
    };
  }
  if (!rosterInForce) {
    return {
      ok: false,
      detail:
        `no submitter roster is in force at the clerk's latest boot, so any ` +
        `party able to reach the submit interface may post on this channel. ` +
        `With nothing yet to authenticate, this channel's quiet is ` +
        `manufacturable at will. UNMEASURED, not clean.`,
    };
  }
  return { ok: true };
}

export interface GapReadOptions {
  /** Read time, wall ms. Injected so the instrument is testable and honest. */
  now: number;
  /**
   * The chain verification for the store these records came from. Required in
   * substance: a gap read on a record whose authorship cannot be established
   * inherits nothing, so the instrument types its blindness instead of
   * producing a finding it cannot ground.
   */
  verification?: ChainVerification;
}

export function readGaps(
  records: readonly ClerkRecord[],
  options: GapReadOptions
): GapRead {
  const now = options.now;
  const v = options.verification;

  if (v !== undefined && v.kind === "BREAK_FOUND") {
    return {
      kind: "CANNOT_ASSESS_CADENCE",
      instrumentId: GAP_INSTRUMENT_ID,
      summary:
        "The record this instrument would read is broken. A silence measured " +
        "off a record that has been truncated, reordered or edited is not a " +
        "measurement. This is NOT silence and NOT a clean reading.",
      blind: [
        {
          class: "STORE_BREAK",
          channel: null,
          detail: `chain verification returned BREAK_FOUND with ${v.breaks.length} break(s): ${v.breaks
            .map((b) => b.class)
            .join(", ")}`,
          exit: null,
        },
      ],
      stops: [],
    };
  }

  if (v !== undefined && v.kind === "CANNOT_VERIFY") {
    return {
      kind: "CANNOT_ASSESS_CADENCE",
      instrumentId: GAP_INSTRUMENT_ID,
      summary:
        "The record's authorship could not be established, so no gap reading " +
        "is offered. This is NOT silence and NOT a clean reading.",
      blind: v.blind.map((b) => ({
        class: "CHAIN_UNVERIFIED" as const,
        channel: null,
        detail: `${b.class}: ${b.detail}`,
        exit: b.exit,
      })),
      stops: [],
    };
  }

  if (records.length === 0) {
    return {
      kind: "CANNOT_ASSESS_CADENCE",
      instrumentId: GAP_INSTRUMENT_ID,
      summary: "No records. There is nothing to read a cadence against.",
      blind: [
        {
          class: "NO_RECORDS",
          channel: null,
          detail: "the store holds no clerk records",
          exit: null,
        },
      ],
      stops: [],
    };
  }

  // ── build per-channel tracks and the clerk's own coverage timeline ─────────
  const channels = new Map<string, ChannelTrack>();
  const boots: {
    seq: number;
    wall: number;
    reconciled: boolean;
    detail: string | null;
    rosterInForce: boolean;
  }[] = [];
  const challengeRefusals: { seq: number; wall: number }[] = [];

  for (const r of records) {
    if (r.kind === "REFUSAL") {
      // A refusal is not an arrival and is not a reference point for a cadence.
      // It is recorded so a reader can see it; it must not reset a silence.
      // But a refusal to issue a CHALLENGE is about the clerk's own intake, and
      // a silence spanning one is not the submitter's to answer for.
      if (r.reason === "CHALLENGE_UNAVAILABLE") {
        challengeRefusals.push({ seq: r.clerk_seq, wall: r.clerk_time.wall_ms });
      }
      continue;
    }
    if (r.kind === "BOOT") {
      boots.push({
        seq: r.clerk_seq,
        wall: r.clerk_time.wall_ms,
        reconciled: r.store_load_state !== "LOADED_WITH_BREAK",
        detail: r.store_load_detail,
        // A v1 BOOT record has no roster field at all: read as NOT in force,
        // because it predates the mechanism and nothing was checked.
        rosterInForce: r.roster_state === "CONFIGURED",
      });
    } else if (r.kind === "CADENCE") {
      const t = track(channels, r.channel);
      t.cadence = {
        period_ms: r.period_ms,
        grace_ms: r.grace_ms,
        declared_at_seq: r.clerk_seq,
      };
      t.cadenceDeclaredWall = r.clerk_time.wall_ms;
    } else if (r.kind === "SUBMISSION") {
      track(channels, r.channel).submissions.push({
        seq: r.clerk_seq,
        wall: r.clerk_time.wall_ms,
        submitter: r.submitter_id,
        auth: readSubmitterAuth(r).state,
      });
    } else {
      track(channels, r.channel).markers.push({
        seq: r.clerk_seq,
        wall: r.clerk_time.wall_ms,
      });
    }
  }

  const stops: GapStop[] = [];
  const blind: GapBlind[] = [];
  const assessed: string[] = [];
  const rosterInForce =
    boots.length > 0 ? boots[boots.length - 1].rosterInForce : false;

  for (const [channel, t] of channels) {
    if (t.cadence === null) {
      blind.push({
        class: "NO_CADENCE_DECLARED",
        channel,
        detail:
          `channel \`${channel}\` appears in the record but no cadence was ` +
          `declared for it. Silence on this channel is not measurable, and its ` +
          `quiet is consumed as UNMEASURED — never as "nothing was missed".`,
        exit:
          "Declare a cadence for this channel (op `declare_cadence`), if the deployment has one to declare.",
      });
      continue;
    }
    assessed.push(channel);

    // Gaps are still computed and reported on an unauthenticated channel — an
    // impostor can manufacture arrivals but not silence. Only QUIET is withheld.
    const quiet = quietAssessable(t, rosterInForce);
    if (!quiet.ok) {
      blind.push({
        class: "SUBMITTER_UNAUTHENTICATED",
        channel,
        detail: quiet.detail,
        exit:
          "Configure a submitter roster (identifier → public key) and have this " +
          "channel's submitter sign its submissions. Where that key comes from " +
          "is the deployment's decision and no code here makes it.",
      });
    }

    const cadence = t.cadence;
    const threshold = cadence.period_ms + cadence.grace_ms;

    // Reference points: the cadence declaration, then each submission.
    const points: {
      seq: number;
      wall: number;
      submitter: string | null;
      auth: SubmitterAuthState;
    }[] = [];
    if (t.cadenceDeclaredWall !== null) {
      points.push({
        seq: cadence.declared_at_seq,
        wall: t.cadenceDeclaredWall,
        submitter: null,
        auth: "UNKNOWN_PRE_CREDENTIALS",
      });
    }
    for (const s of t.submissions) {
      if (s.seq > cadence.declared_at_seq) {
        points.push({ seq: s.seq, wall: s.wall, submitter: s.submitter, auth: s.auth });
      }
    }
    points.sort((a, b) => a.seq - b.seq);

    for (let i = 0; i < points.length; i++) {
      const from = points[i];
      const next = i + 1 < points.length ? points[i + 1] : null;
      const to = next === null ? now : next.wall;
      const silence = to - from.wall;
      if (silence <= threshold) continue;

      const bootsInWindow = boots.filter(
        (b) => b.wall > from.wall && b.wall <= to
      );
      const unreconciled = bootsInWindow.filter((b) => !b.reconciled);

      const challengesRefusedInWindow = challengeRefusals.filter(
        (c) => c.wall > from.wall && c.wall <= to
      );

      let object: GapObject;
      let coverage: ClerkCoverage;
      if (challengesRefusedInWindow.length > 0) {
        // Read this BEFORE the submitter: the clerk refused to hand out the
        // nonces a submission requires, so an honest submitter could not have
        // submitted. Billing this silence to the submitter would be the exact
        // collapse `08b` half (a) forbids.
        object = "CHANNEL_IMPAIRED";
        coverage = {
          state: "CLERK_REFUSED_CHALLENGES_IN_WINDOW",
          boot_seqs: bootsInWindow.map((b) => b.seq),
          detail:
            `the clerk refused to issue submission nonces inside this window ` +
            `(REFUSAL CHALLENGE_UNAVAILABLE at clerk_seq ` +
            `${challengesRefusedInWindow.map((c) => c.seq).join(", ")}). An ` +
            `honest submitter could not submit while that held, so this silence ` +
            `is at least partly the CLERK'S INTAKE and not the submitter's. ` +
            `Note the bound: this does not establish that the submitter would ` +
            `otherwise have submitted.`,
        };
      } else if (unreconciled.length > 0) {
        object = "CHANNEL_IMPAIRED";
        coverage = {
          state: "CLERK_RECORD_DID_NOT_RECONCILE",
          boot_seqs: bootsInWindow.map((b) => b.seq),
          detail:
            `the clerk restarted inside this window and its own store did not ` +
            `reconcile: ${unreconciled
              .map((b) => `clerk_seq ${b.seq} — ${b.detail ?? "unspecified"}`)
              .join("; ")}. This finding is about the RECORD PATH, not about the submitter.`,
        };
      } else if (bootsInWindow.length > 0) {
        object = "CLERK_COVERAGE_GAP";
        coverage = {
          state: "CLERK_RESTARTED_IN_WINDOW",
          boot_seqs: bootsInWindow.map((b) => b.seq),
          detail:
            `the clerk restarted inside this window (BOOT at clerk_seq ` +
            `${bootsInWindow.map((b) => b.seq).join(", ")}). The clerk was not ` +
            `running for an unknown part of it, so an arriving submission could ` +
            `have found no one to receive it. This finding is about the CLERK, ` +
            `not about the submitter.`,
        };
      } else {
        object = "SUBMITTER_SILENT";
        coverage = {
          state: "CONTINUOUS_IN_WINDOW",
          boot_seqs: [],
          detail:
            "no BOOT record falls inside this window, so on this record the " +
            "clerk was running throughout it. Note the bound: the absence of a " +
            "BOOT record shows no RESTART; it does not by itself prove the " +
            "process was never stopped and started outside this store's view.",
        };
      }

      const last =
        from.submitter === null
          ? null
          : {
              clerk_seq: from.seq,
              clerk_wall_ms: from.wall,
              declared_submitter_id: from.submitter,
              auth: from.auth,
            };

      const bounded = next !== null;
      const markerSeqs = t.markers
        .filter((m) => m.wall > from.wall && m.wall <= to)
        .map((m) => m.seq);

      // The submitter's name means different things depending on whether
      // anything checked it, and the question must not say "unauthenticated"
      // over a submission that was in fact authenticated.
      const provenance =
        last === null
          ? ""
          : last.auth === "AUTHENTICATED"
            ? ` (AUTHENTICATED: that party proved possession of the key this ` +
              `deployment's roster binds to the name — which is not proof it IS ` +
              `that party, and no proof at all that what it sent was true)`
            : ` (${last.auth} — the name is a string the submission declared and ` +
              `the clerk copied; the clerk's signature authenticates the CLERK, ` +
              `never the submitter)`;

      const who =
        last === null
          ? `nothing has ever arrived on this channel since the cadence was declared at clerk_seq ${cadence.declared_at_seq}`
          : `the last arrival was clerk_seq ${last.clerk_seq}, from declared submitter \`${last.declared_submitter_id}\`${provenance}`;

      const question =
        `WHICH CHANNEL: \`${channel}\`. ` +
        `WHICH SUBMITTER: ${who}. ` +
        `HOW LONG: ${silence} ms of silence against a declared cadence of ` +
        `${cadence.period_ms} ms + ${cadence.grace_ms} ms grace` +
        (bounded
          ? ` (bounded: silence ended at clerk_seq ${next.seq})`
          : ` (OPEN at read time — this is a LOWER BOUND, not a measurement)`) +
        `. STATE OF THE CHANNEL ITSELF: ${coverage.state}. ` +
        `QUESTION HANDED UP: is this submitter silent, or was this clerk not ` +
        `there to hear it? The record distinguishes those two and does not ` +
        `assert a cause beyond them — silence is data, typed as silence, and ` +
        `is not interpreted past its type.`;

      stops.push(
        makeStop({
          object,
          shape: "RECORD_ONLY_NO_HOLD",
          shape_statement: SHAPE_STATEMENT.RECORD_ONLY_NO_HOLD,
          channel,
          cadence,
          last_submission: last,
          silence_from_wall_ms: from.wall,
          silence_to_wall_ms: to,
          silence_ms: silence,
          silence_bounded: bounded,
          clerk_coverage: coverage,
          clerk_marker_seqs: markerSeqs,
          question,
        })
      );
    }
  }

  if (stops.length > 0) {
    return {
      kind: "GAP_OBSERVED",
      instrumentId: GAP_INSTRUMENT_ID,
      summary:
        `${stops.length} silence episode(s) exceeded a declared cadence across ` +
        `${assessed.length} assessed channel(s)` +
        (blind.length > 0
          ? `; ${blind.length} channel(s) could not be assessed at all and are listed under \`blind\`.`
          : `.`) +
        ` A gap is a duration, never a content: this instrument cannot say what ` +
        `should have arrived.`,
      stops,
      blind,
      channelsAssessed: assessed,
    };
  }

  if (blind.length > 0 || assessed.length === 0) {
    if (assessed.length === 0 && blind.length === 0) {
      blind.push({
        class: "NO_CADENCE_DECLARED",
        channel: null,
        detail:
          "no cadence was declared for any channel, so silence is not " +
          "measurable anywhere in this deployment.",
        exit: "Declare a cadence (op `declare_cadence`). It is an offer, not an imposition.",
      });
    }
    return {
      kind: "CANNOT_ASSESS_CADENCE",
      instrumentId: GAP_INSTRUMENT_ID,
      summary:
        `No gap reading is offered for ${blind.length} channel(s) or for the ` +
        `deployment as a whole. This is NOT silence and NOT a clean reading — ` +
        `the cause of each blindness is typed below.`,
      blind,
      stops: [],
    };
  }

  return {
    kind: "NO_GAP_OBSERVED",
    instrumentId: GAP_INSTRUMENT_ID,
    summary:
      `Read ${assessed.length} channel(s) with a declared cadence; no silence ` +
      `episode exceeded its cadence. ${NO_GAP_IS_NOT_HEALTH}`,
    channelsAssessed: assessed,
  };
}

/** Human-readable render. Every kind prints its own distinct banner, and every
 *  stop prints its object, its shape, and its question. */
export function renderGapRead(g: GapRead): string {
  const out: string[] = [];
  out.push(`[${g.instrumentId}] GAP READ: ${g.kind}`);
  out.push(`  ${g.summary}`);
  if (g.kind === "GAP_OBSERVED" || g.kind === "CANNOT_ASSESS_CADENCE") {
    const stops = g.kind === "GAP_OBSERVED" ? g.stops : g.stops;
    for (const s of stops) {
      out.push(`  · STOP object=${s.object} shape=${s.shape} channel=${s.channel}`);
      out.push(`      ${s.question}`);
      out.push(`      ${s.shape_statement}`);
      out.push(`      channel state: ${s.clerk_coverage.detail}`);
      out.push(
        `      clerk markers for this episode: ` +
          (s.clerk_marker_seqs.length === 0
            ? "none (the clerk stamped no marker — it may not have been running)"
            : s.clerk_marker_seqs.join(", "))
      );
    }
    for (const b of g.blind) {
      out.push(
        `  · BLIND ${b.class}${b.channel === null ? "" : ` [channel ${b.channel}]`}: ${b.detail}`
      );
      if (b.exit !== null) out.push(`      exit: ${b.exit}`);
    }
  }
  return out.join("\n");
}
