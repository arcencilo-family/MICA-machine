// ── MICA · notice sinks — the roster, the seam, and the attempt record ───────
//
// WHAT THIS MODULE IS
//
//   The hands the PASS-BLIND notifier never had. `chokepoint/notifier.ts` ends
//   at `export type NoticeSink = (notice: BatchNotice) => void;` and its own
//   comment there says an absent sink means the notice is computed and then goes
//   nowhere at all. This module is the layer that takes a computed notice
//   somewhere — and, far more importantly, the layer that writes down what it
//   TRIED. (The original comment is quoted nowhere here on purpose: it contains
//   a word this module's own fence bans, and paraphrasing it is cheaper than
//   carving an exception into the fence.)
//
//   THIS IS A TOOL, like the clerk and the witness. It is NOT an instrument. It
//   moves no tally, judges nothing, reads no evidence log, and is never a term in
//   the floor. It declares no SENSOR_ID and registers with no reader.
//
// MICA OWNS THE ROSTER. THE DEPLOYER OWNS THE WIRE.
//
//   Roster: which roles exist, what address each carries, and a record of every
//   attempt made against them. That is MICA's, and it is shipped.
//
//   Wire: the injected function that actually puts a message on a network. That
//   is the deployer's, and NOTHING under src/ implements one. The ground is that
//   an address is not a route: a declared endpoint proves nothing, so declining
//   to own the transport costs nothing a declaration would have bought.
//
//   The consequence is stated on the module's face rather than buried: an
//   injected stub that returns normally every time satisfies everything MICA can
//   observe about this layer. MICA observes a FUNCTION, never a wire.
//
// WHY THE ADDRESSES SHIPPED HERE CANNOT WORK, ON PURPOSE
//
//   The roster ships pre-filled with addresses that are unusable by construction:
//   `.invalid` (RFC 6761 — guaranteed never to resolve) and the NANP fiction
//   range 555-0100–555-0199. An address the deployer MUST overwrite beats an
//   address that plausibly works. A real-looking default is the failure mode
//   where a misconfigured deployment quietly puts MICA's notices in front of a
//   stranger who happens to own that domain.
//
//   A shipped placeholder is NOT a configured channel, and the census says so.
//
// THE VOCABULARY THIS MODULE LIVES BY
//
//   attempted · recorded · raised · configured · failed.
//
//   Not the other seven. The fence in notify.test.ts enforces it over SOURCE,
//   and that test carries the reason the fence is source-only.

// ── the envelope ─────────────────────────────────────────────────────────────

/**
 * The generalisation the fan-out carries. `BatchNotice` is shipped, pinned
 * machinery (chokepoint/notifier.ts, protected-inventory row 8) and is NOT
 * redesigned here; `envelopeFromBatchNotice` adapts it into this shape.
 *
 * `sequence` is CALLER-SUPPLIED. MICA does not stamp self-authored wall-clock
 * time, so there is no clock field here and none is wanted. The pattern adopted
 * is the floor-trail / witness one — a monotone integer that is the record's own
 * index in its chain (`floor-trail.ts` `const sequenceNumber = this.chain.length`,
 * `witness.ts` `const seq = this.records.length`) — and NOT the chokepoint's
 * `decisionClock`, which does exist but falls back to `Date.now()` because the
 * guard interface it serves predates any timestamp argument. A count is
 * deterministic and testable; a clock here would be MICA authoring time about
 * itself.
 */
export interface NoticeEnvelope {
  /** Who raised it. An opaque id, never a payload. */
  readonly sourceId: string;
  /** What class of thing was raised. Opaque to this module. */
  readonly kind: string;
  /** The human-readable body, one entry per line. */
  readonly lines: readonly string[];
  /** Caller-supplied monotone index. See the note above. */
  readonly sequence: number;
}

// ── the roster ───────────────────────────────────────────────────────────────

export const RECIPIENT_ROLES = ["doctor", "arbiter", "operator"] as const;

export type RecipientRole = (typeof RECIPIENT_ROLES)[number];

/**
 * One roster row, and it carries NOTHING ELSE — no priority, no delay, no order,
 * no "if this one is quiet then that one." The absence is the point and it is
 * load-bearing: any such field would be MICA judging adequate response time, a
 * judgment the arbiter has ruled it cannot make. A test pins that this type CANNOT
 * express timing or priority, by reading this file's own source.
 */
export interface RecipientEntry {
  readonly role: RecipientRole;
  /**
   * Opaque to MICA. A URL, a telephone number, a queue name — this module never
   * parses it, and the shipped placeholders deliberately span two modalities to
   * keep that honest.
   */
  readonly address: string;
}

export type Roster = readonly RecipientEntry[];

/**
 * The shipped roster. Every address here is unusable by construction and every
 * one of them is meant to be overwritten by a deployment.
 *
 * Two modalities on purpose: a URL-shaped address and a telephone-shaped one, so
 * nothing downstream can grow a habit of assuming `address` is a URL. MICA does
 * not know what these are; the injected transport does.
 */
export const PLACEHOLDER_ROSTER: Roster = [
  { role: "doctor", address: "https://doctor.mica-notify.invalid/raise" },
  { role: "arbiter", address: "https://arbiter.mica-notify.invalid/raise" },
  { role: "operator", address: "tel:+1-555-0137" },
];

/** Every shipped placeholder, for the census and for `isPlaceholderAddress`. */
export const PLACEHOLDER_ADDRESSES: readonly string[] = PLACEHOLDER_ROSTER.map(
  (entry) => entry.address
);

// ── the transport seam ───────────────────────────────────────────────────────

/**
 * What an injected transport returns when it did not throw. `detail` is recorded
 * verbatim into the attempt as TRANSPORT ACCEPTANCE — an HTTP status, a queue
 * id, whatever the deployer's wire reports. It is never a statement about a
 * human.
 */
export interface TransportOutcome {
  readonly detail: string;
}

/**
 * The deployer's wire. Synchronous on purpose: this layer makes ONE attempt and
 * records it, so there is no retry loop, no backoff, and nothing to await. A
 * transport that must bound its own time does so internally and throws on
 * expiry — which this layer records as FAILED.
 *
 * ABSENT means every human-channel attempt is NOT_CONFIGURED, loudly. There is
 * no default, no fallback, and no localhost.
 */
export type Transport = (
  address: string,
  envelope: NoticeEnvelope
) => TransportOutcome;

// ── the attempt record ───────────────────────────────────────────────────────

export const ATTEMPT_OUTCOMES = [
  "ATTEMPTED",
  "FAILED",
  "NOT_CONFIGURED",
] as const;

export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

/**
 * One attempt against one sink. The closed union is the whole point: there is no
 * fourth state, and in particular there is no state meaning a person holds the
 * information.
 *
 * ATTEMPTED       the injected transport (or the log write) returned without
 *                 throwing. Any status the wire reported is in `detail` as
 *                 TRANSPORT ACCEPTANCE, never as anyone being told anything.
 * FAILED          it threw. One attempt, no retries.
 * NOT_CONFIGURED  no transport was injected, or the address is still a shipped
 *                 placeholder, or no notice-log path was declared. A PRINTED
 *                 blindness point, never a silent skip.
 */
export interface DeliveryAttempt {
  /** Which sink made it, e.g. `channel:doctor` or `notice-log`. */
  readonly sinkId: string;
  /** The roster role, when the sink is a human channel. Null for the log. */
  readonly role: RecipientRole | null;
  readonly outcome: AttemptOutcome;
  readonly detail: string;
}

// ── the head committer (locally declared, deliberately) ──────────────────────

/**
 * R8's declared modality. Declared LOCALLY, like everything else in this block:
 * this module is a SUBMITTER and imports neither the witness's enum nor another
 * submitter's copy of it. The three spellings must equal the retainer's or the
 * drop lands as MALFORMED_SUBMISSION — that is the price of the coupling bar,
 * and the reason `witnessd.test.ts` asserts the lists equal in the one place in
 * this repository allowed to hold both.
 */
export type Modality = "OFFERED" | "IMPOSED" | "NOT_AN_INSTRUCTION";

export const MODALITIES: readonly Modality[] = [
  "OFFERED",
  "IMPOSED",
  "NOT_AN_INSTRUCTION",
];

/**
 * The five fields MICA S-4 v0.3 §4 freezes — four until 2026-08-26, when
 * `modality` joined the freeze (The arbiter, S88). Declared LOCALLY here for the same
 * reason `floor-trail.ts` declares them locally: this module is a SUBMITTER and
 * imports neither the witness nor another submitter's chain arithmetic. A
 * retainer's evolution must not reshape the chain that submits to it.
 */
export interface HeadCommit {
  readonly seq_no: number;
  readonly head_hash: string;
  readonly ts: number;
  readonly witness_set_id: string;
  readonly modality: Modality;
}

export type HeadCommitter = (commit: HeadCommit) => void;

// ── the census ───────────────────────────────────────────────────────────────

/**
 * Counts and states only. No threshold, no expectation, no verdict.
 *
 * WHY IT EXISTS: without it, "zero notices raised" is byte-identical to "nothing
 * ever called raise()". That is the vacuity the actionId coverage census was
 * built to repair one level up, and the repair is the same shape — the census
 * ships WITH the thing it describes, so an unwired deployment and a quiet one
 * are distinguishable at bytes.
 */
export interface NotifyConfigCensus {
  /** How many roles are on the roster. */
  readonly rosterRoles: number;
  /** How many of those addresses are still shipped placeholders. */
  readonly placeholderAddresses: number;
  /** Whether a transport was injected at all. */
  readonly transportInjected: boolean;
  /** Whether the notice log has a declared path, or is memory-only. */
  readonly noticeLog: "DECLARED_PATH" | "IN_MEMORY";
  /** Whether a witness head committer was injected. */
  readonly witnessHeadCommit: "DECLARED" | "NOT_DECLARED";
  /**
   * The modality this deployment DECLARES on every head this book commits.
   * Never null: the option is type-required, so a deployment cannot skip the
   * declaration, only make it. Printed so a reader of the census sees WHAT was
   * declared, not merely that something was.
   */
  readonly declaredModality: Modality;
}

export const CENSUS_IS_NOT_A_VERDICT =
  "This census COUNTS configuration and states nothing about it. It carries no " +
  "threshold, no expectation, and no reading of whether the counts are adequate. " +
  "A fully configured roster is not a working channel, and a roster of " +
  "placeholders is not a fault — it is an undeployed tool reporting that it is " +
  "undeployed.";

export const CENSUS_HAS_NO_CONSUMER_YET =
  "NOTHING READS THIS CENSUS TODAY. Its read site is build 3b (the declaration " +
  "instrument) or W5 (the daily witness report), and neither exists. Stated as " +
  "house debt on the record rather than left to be discovered later: a census " +
  "with no consumer is a fact about this build, not a claim about coverage.";

// ── the ceilings ─────────────────────────────────────────────────────────────

export const MICA_OBSERVES_A_FUNCTION_NEVER_A_WIRE =
  "An injected stub that returns normally every time satisfies EVERYTHING MICA " +
  "can observe about this layer. MICA observes a function call and its return; " +
  "it cannot observe a network, a host, an inbox, or a person. ATTEMPTED means " +
  "the injected function returned without throwing, and means nothing else.";

export const AN_ADDRESS_IS_NOT_A_ROUTE =
  "A declared address proves nothing. It is not checked, not resolved, and not " +
  "reachability-tested, and it could name a host that has never existed. The " +
  "roster records what a deployment DECLARED, never what is reachable.";

export const ATTEMPT_IS_THE_CEILING =
  "The maximum this module can do is ATTEMPT, and RECORD THE ATTEMPT " +
  "tamper-evidently. There is no state above that one. Never 'they know.'";

export const SYMMETRIC_BROADCAST =
  "The same envelope goes to every configured recipient with no ordering, no " +
  "priority, no per-recipient delay, and no conditional second knock. MICA never " +
  "encodes the hierarchy. Any such logic would be MICA judging adequate response " +
  "time, which it cannot do — and the roster type has no field that could carry " +
  "it, which is how the impossibility is enforced rather than promised.";

/**
 * The lines this module prints about what it DOES NOT CLAIM. Chokepoint-style:
 * where the limit can be a type error it is one, and where it cannot — a human
 * reading an attempt as an outcome — it is a printed contradiction, here.
 */
export const NOTIFY_SCOPE_LINES: readonly string[] = [
  "DOES NOT CLAIM ANY HUMAN READ ANYTHING, EVER. " + ATTEMPT_IS_THE_CEILING,
  "DOES NOT JUDGE RESPONSE TIME. No timer runs here, and the roster type carries",
  "  no field that could express one.",
  "DOES NOT ESCALATE OR ORDER RECIPIENTS. " + SYMMETRIC_BROADCAST,
  "DOES NOT RETRY. One attempt per recipient per raising; retry policy is",
  "  deployment machinery and is not MICA's to choose.",
  "A TRANSPORT ACCEPTANCE IS ACCEPTANCE OF BYTES BY A FUNCTION, never a person",
  "  having read anything. " + MICA_OBSERVES_A_FUNCTION_NEVER_A_WIRE,
  "ADDRESSES AND TRANSPORT ARE DECLARED DEPLOYMENT FACTS. " +
    AN_ADDRESS_IS_NOT_A_ROUTE,
  "SHIPS NO TRANSPORT. Nothing under src/ opens a network connection; absent an",
  "  injected wire every human-channel attempt is NOT_CONFIGURED.",
  "MICA CANNOT BE MADE RESPONSIBLE FOR THE IRRESPONSIBILITY IN THE HUMAN REALM.",
  "  Its whole job is to make sure the nudger and the nudged hold the same facts",
  "  at the same moment. What they then do with them is theirs.",
];

/** The blindness line, printed whenever a raising reached no configured sink. */
export const TOTAL_BLINDNESS_LINE =
  "BLINDNESS POINT: this raising reached NO configured sink. The notice was " +
  "computed and nothing carried it anywhere. This line is printed rather than " +
  "omitted because an unconfigured channel that stays quiet is indistinguishable " +
  "from a configured one with nothing to say.";
