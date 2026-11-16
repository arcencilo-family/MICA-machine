// ──────────────────────────────────────────────────────────────────────────────
// ILAS — CLERK 1: the rung-1 append authority. RECORD TYPES.
//
// Design source: ARC_MICA-DESIGN_Clerk1-Append-Authority_20260809.
// Acceptance gate: ARC_MICA-CANON_Two-Tier-Read-Test_20260807 (`T1/T2`).
//   CITED, NEVER RESTATED. Nothing in this directory paraphrases that file.
//
// WHAT THIS DIRECTORY IS
//
//   The observed system keeps authorship of THE WORDS. It loses WHEN, IN WHAT
//   ORDER, WHETHER AT ALL, and WHETHER STILL INTACT. Those four move to a party
//   the observed system cannot reach.
//
// TWO OBJECTS, GRADED DIFFERENTLY (build brief §1)
//
//   OBJECT A — the clerk. Infrastructure. core.ts / store.ts / clerkd.ts /
//     client.ts. It emits NO findings and NO verdicts.
//   OBJECT B — the gap detector. A READ INSTRUMENT. gap.ts, and only gap.ts.
//
//   The split is physical, not rhetorical: no file that implements A returns a
//   finding type, and gap.ts writes nothing.
//
// THIS DIRECTORY IMPORTS NOTHING FROM THE OBSERVED SYSTEM. Not `../l0`, not
// `../types`, not `../index`, not `../mica`, not `../s4`. Node built-ins only.
// That is not tidiness — it is what makes reader.ts a standalone entry point
// rather than a debug flag on the watched thing's binary. There is a test that
// walks the import closure and fails if this is ever violated.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 1 — Clerk 1, first round.
 * 2 — adds submitter credentials (`submitter_auth` on submissions, `REFUSAL`
 *     records, roster state in BOOT). Version 1 records remain valid, remain
 *     verifiable, and MUST NOT be relabelled: a record written before the
 *     mechanism existed is `UNKNOWN_PRE_CREDENTIALS`, never "unauthenticated by
 *     choice" and never "authenticated".
 */
export type ReceiptVersion = 1 | 2;
export const RECEIPT_VERSION: ReceiptVersion = 2;
export const CLERK_BUILD = "clerk-1/rung-1+credentials";

// ── Separation (build brief §3) ───────────────────────────────────────────────
//
// A clerk running inside the observed system's process buys nothing: same
// memory, same privileges, same everything. The mode is a FIELD IN EVERY
// RECORD, never a note in a README, so an in-process record can never be
// mistaken for a separated one by anyone reading the store.

export type SeparationMode =
  /** Same OS process as the submitter. NO adversarial separation whatsoever. */
  | "IN_PROCESS_NO_SEPARATION"
  /** Own OS process, own store handle, own key handle. See the principal note. */
  | "SEPARATE_PROCESS";

export const IN_PROCESS_WARNING =
  "NO ADVERSARIAL SEPARATION. This clerk ran INSIDE the observed system's own " +
  "OS process: same memory, same privileges, same signing key in the same " +
  "address space. These receipts carry NO authority against the observed " +
  "system. They are shaped identically to separated receipts and are not " +
  "equivalent to them. Do not cite them as evidence of arrival, order, gap or " +
  "integrity against the party that produced them.";

/**
 * What a SEPARATE_PROCESS record does and does not buy. Printed and stored,
 * because "separate process" is routinely over-read.
 *
 * Separate process gives MEMORY separation and a narrow submit interface: the
 * submitter cannot reach the key object, the sequence counter, or the store
 * handle through any code path it can call.
 *
 * It does NOT by itself give PRINCIPAL separation. If the clerk and the
 * observed system run as the same OS user, that user can read the key file off
 * disk and can delete the store. Principal separation is a DEPLOYMENT act (run
 * the clerk as its own OS user, with the store and key owned by that user),
 * not a code act, and this build does not and cannot perform it. The clerk
 * therefore stamps the principal it actually ran as, and states this bound
 * rather than asserting a separation it did not achieve.
 */
export const SEPARATE_PROCESS_BOUND =
  "SEPARATE_PROCESS means own OS process, own memory, narrow submit interface. " +
  "It does NOT by itself mean the signing key is unreadable by the observed " +
  "system: if both run as the OS principal named in `clerk_principal`, that " +
  "principal can read the key file and delete the store. Principal separation " +
  "is a deployment act, not a code act, and is NOT claimed here.";

// ── The attestation scope — the typed residual, carried in every record ───────
//
// Build brief §5: the residual must be a TYPE, not a sentence. This object is
// the machine-readable half (it rides in every record, so even a raw-JSON
// consumer in another language sees it); scope.ts is the enforced half.

export const ATTESTS = [
  "ARRIVAL",
  "ORDER",
  "GAP",
  "INTEGRITY_SINCE_ARRIVAL",
  /**
   * ADDED WITH CREDENTIALS, and note how narrow it is. On an AUTHENTICATED
   * submission the clerk attests that the party which submitted held the
   * private key the deployer bound to this identifier. It does NOT attest that
   * the party IS that identifier — that binding is the deployer's roster, not
   * the clerk's knowledge — and it attests nothing about honesty. An
   * authenticated liar is authenticated.
   *
   * `claimFrom` refuses this claim on any record that is not an authenticated
   * submission, so it cannot be quoted off an unauthenticated one.
   */
  "SUBMITTER_KEY_POSSESSION",
] as const;

export const DOES_NOT_ATTEST = [
  "PAYLOAD_TRUTH",
  "SYSTEM_HEALTH",
  "OPERATOR_CONDUCT",
  "HISTORY_COMPLETENESS",
  "SUBMITTER_IDENTITY",
] as const;

export type InScopeClaim = (typeof ATTESTS)[number];
export type OutOfScopeClaim = (typeof DOES_NOT_ATTEST)[number];

export interface AttestationScope {
  readonly form: "ILAS-CLERK-ATTESTATION-1";
  readonly attests: readonly InScopeClaim[];
  readonly does_not_attest: readonly OutOfScopeClaim[];
  /** The adversary this record speaks against. There is exactly one. */
  readonly against: "OBSERVED_SYSTEM_ONLY";
  readonly note: string;
}

export const ATTESTATION_SCOPE: AttestationScope = Object.freeze({
  form: "ILAS-CLERK-ATTESTATION-1",
  attests: Object.freeze([...ATTESTS]),
  does_not_attest: Object.freeze([...DOES_NOT_ATTEST]),
  against: "OBSERVED_SYSTEM_ONLY",
  note:
    "This record attests that these bytes arrived at this clerk at this clerk's " +
    "time, after the previous record, and have not changed since. It is NOT a " +
    "verdict and NOT a health statement. It says nothing about whether the " +
    "payload is true: a system that lies in real time receives flawless " +
    "receipts. It says nothing against the operator of this machine.",
});

// ── Time ──────────────────────────────────────────────────────────────────────

export interface ClerkTime {
  /** The clerk's own wall clock, read by the clerk. Never the submitter's. */
  wall_ms: number;
  /**
   * The clerk's monotonic counter, decimal nanoseconds. Comparable ONLY within
   * one clerk_boot_id — a monotonic clock has no meaning across restarts, and
   * pretending otherwise is how a false ordering claim gets made.
   */
  monotonic_ns: string;
}

// ── Records ───────────────────────────────────────────────────────────────────

export type RecordKind = "BOOT" | "CADENCE" | "SUBMISSION" | "GAP" | "REFUSAL";

// ── Submitter authentication (v2) ─────────────────────────────────────────────

export type SubmitterAuthState =
  /** A roster was configured and the submitter proved possession of its key. */
  | "AUTHENTICATED"
  /** No roster was configured. The submitter claim is a bare declaration. */
  | "UNAUTHENTICATED_NO_ROSTER"
  /**
   * A roster was configured and holds no usable entry. Accepted — an empty
   * roster must not make the clerk unusable — but it buys no clean reading, and
   * it is a DIFFERENT state from having never asked for authentication.
   */
  | "UNAUTHENTICATED_EMPTY_ROSTER"
  /**
   * Reader-side only. A version-1 record, written before the mechanism existed.
   * Never stamped by a clerk. Its submitter claim is unverified, and saying so
   * is not the same as saying the deployment declined to verify it.
   */
  | "UNKNOWN_PRE_CREDENTIALS";

export interface SubmitterAuth {
  state: SubmitterAuthState;
  /**
   * The identifiers the KEY belongs to, per the roster in force at the time.
   * Normally one. More than one means the roster binds one key to several
   * names, so possession does not distinguish between them — and the receipt
   * says that rather than picking one. null when unauthenticated.
   */
  proven_submitter_ids: readonly string[] | null;
  /** Fingerprint of the key that verified. Identifies the KEY, not the party. */
  submitter_key_fp: string | null;
  /** The clerk-issued single-use nonce this submission consumed. */
  nonce: string | null;
  /** In the record, so a raw-JSON consumer reads it without reading prose. */
  note: string;
}

export const AUTH_NOTE_AUTHENTICATED =
  "AUTHENTICATED means the submitting party proved possession of the private " +
  "key this deployment's roster binds to this identifier, over a clerk-issued " +
  "single-use nonce. It does NOT mean the party IS that identifier — that " +
  "binding is the deployer's, not the clerk's — and it says NOTHING about " +
  "whether the payload is true. An authenticated liar is authenticated.";

export const AUTH_NOTE_NO_ROSTER =
  "UNAUTHENTICATED. No submitter roster was configured, so `submitter_id` and " +
  "`channel` are strings this submission declared and the clerk copied. Anyone " +
  "able to reach the submit interface could have written them. Quiet on such a " +
  "channel is UNMEASURED, not clean.";

export const AUTH_NOTE_EMPTY_ROSTER =
  "UNAUTHENTICATED. A submitter roster was configured but holds no usable " +
  "entry. An empty roster describes zero enrolled submitters, which is not the " +
  "same as zero impostors. This is NOT the same state as no roster at all: the " +
  "deployment asked for authentication and did not get it.";

export const AUTH_NOTE_PRE_CREDENTIALS =
  "UNKNOWN. This is a version-1 record, written before submitter credentials " +
  "existed. Its submitter claim was never checked and cannot be checked now. " +
  "It is not evidence that the deployment declined to authenticate.";

/**
 * HOW the clerk received this record — an OBSERVED fact, not a declared one.
 *
 * `separation` says what the deployment believes it built. `intake` says what
 * the clerk actually saw: a byte stream over a socket, or a method call inside
 * its own process. They can disagree, and when they do the record shows it —
 * a clerk started inside the observed system's process would stamp
 * SEPARATE_PROCESS with LOCAL_CALL intake, and a reader can see that for what
 * it is. The clerk cannot verify a topology claim; it can report what it
 * touched.
 */
export type IntakeChannel =
  /** Arrived as bytes on the clerk's socket / named pipe. */
  | "SOCKET"
  /** Arrived as a direct method call in the clerk's own process. */
  | "LOCAL_CALL"
  /** The clerk wrote this itself (BOOT, GAP markers). Nothing arrived. */
  | "CLERK_INTERNAL";

/** Fields every chained record carries. The frame the observed system loses. */
export interface RecordFrame {
  receipt_version: ReceiptVersion;
  kind: RecordKind;
  clerk_id: string;
  /** New per clerk process. Scopes monotonic_ns and marks restarts. */
  clerk_boot_id: string;
  separation: SeparationMode;
  /** Non-null EXACTLY when separation is IN_PROCESS_NO_SEPARATION. */
  separation_warning: string | null;
  /** The OS principal the clerk actually ran as. See SEPARATE_PROCESS_BOUND. */
  clerk_principal: string;
  /** OBSERVED, not declared. Cross-check against `separation`. */
  intake: IntakeChannel;
  attests: AttestationScope;
  /** The clerk's own monotone counter. Not the submitter's call count. */
  clerk_seq: number;
  clerk_time: ClerkTime;
  prev_receipt_hash: string;
  /** sha256 over the canonicalised record minus receipt_hash and signature. */
  receipt_hash: string;
  signature: string;
  signature_alg: "ed25519";
}

export type StoreLoadState =
  /** No prior store at this location. */
  | "FRESH"
  /** Prior store read, tail located, chain continued. */
  | "LOADED"
  /** Prior store read but something did not reconcile. Recorded, NOT repaired. */
  | "LOADED_WITH_BREAK";

export interface BootRecord extends RecordFrame {
  kind: "BOOT";
  clerk_build: string;
  /** The OS process id the clerk ran in. Forensic detail, not a claim. */
  clerk_pid: number;
  store_dir: string;
  /** base64 SPKI DER. A convenience copy — NOT a trust anchor. See reader.ts. */
  public_key: string;
  store_load_state: StoreLoadState;
  store_load_detail: string | null;
  /**
   * The roster in force for this clerk run. The roster is loaded ONCE, at boot,
   * so it cannot be swapped underneath a running clerk — changing it requires a
   * restart, and a restart is a BOOT record with a different fingerprint. That
   * makes a roster downgrade visible in the chain rather than preventing it.
   */
  roster_state: import("./credentials").RosterState;
  roster_size: number;
  roster_fingerprint: string | null;
  roster_source: string;
  roster_problems: readonly string[];
}

/**
 * A submission the clerk REFUSED. Chained and signed like everything else.
 *
 * Without this, "never attempted" and "attempted and refused" would be
 * indistinguishable in the store — misreading 12 from the first round's list,
 * re-created by the very mechanism meant to close a hole.
 *
 * RATE-LIMITED, and the suppression is counted rather than hidden: an attacker
 * with socket access must not be able to grow the chain as fast as it can open
 * connections. See `suppressed_since_last`.
 */
export interface RefusalRecord extends RecordFrame {
  kind: "REFUSAL";
  /** ALWAYS false. A refusal is a record of an event, not a finding about anyone. */
  is_finding: false;
  refusal_note: string;
  reason: RefusalReason;
  detail: string;
  /** As DECLARED in the refused submission. Unauthenticated by construction. */
  declared_submitter_id: string;
  channel: string;
  /** Present when the bytes were canonicalisable; null when they were not. */
  payload_commitment: string | null;
  /** The clerk did not retain the refused bytes. Always false. */
  payload_retained: false;
  /** Refusals of this same (reason, channel, submitter) suppressed by rate
   *  limiting since the last record emitted for it. Never silently dropped. */
  suppressed_since_last: number;
}

export type RefusalReason =
  /**
   * The clerk declined to ISSUE a nonce because too many were outstanding.
   *
   * This one is not about a submitter at all, and recording it is what stops a
   * new hole this round opened. `challenge` is unauthenticated by design (so it
   * cannot be used to enumerate the roster), so anyone reaching the socket can
   * exhaust the nonce table — after which honest submitters cannot submit, go
   * quiet, and are read as SUBMITTER_SILENT. That bills a clerk-side refusal to
   * the submitter, which is exactly the collapse `08b` half (a) forbids. With
   * this record in the chain the gap detector can type the window
   * CHANNEL_IMPAIRED instead.
   */
  | "CHALLENGE_UNAVAILABLE"
  | "SUBMITTER_NOT_IN_ROSTER"
  | "MISSING_SUBMITTER_SIGNATURE"
  | "MISSING_OR_UNKNOWN_NONCE"
  | "NONCE_EXPIRED"
  | "SUBMITTER_SIGNATURE_INVALID"
  | "PAYLOAD_UNCOMMITTABLE"
  | "PAYLOAD_TOO_LARGE";

export const REFUSAL_NOT_A_FINDING =
  "REFUSAL, NOT A FINDING. The clerk declined to commit to a submission and " +
  "recorded that it did. It is not typed by object and asserts no cause: a " +
  "misconfigured submitter, an expired nonce, a clock skew and an impostor all " +
  "produce refusals, and this record does not tell them apart. SHAPE: nothing " +
  "is held and nothing is gated; the submitting party keeps every privilege it " +
  "had. Consuming `kind: \"REFUSAL\"` as an accusation is a misuse.";

export interface CadenceRecord extends RecordFrame {
  kind: "CADENCE";
  channel: string;
  period_ms: number;
  grace_ms: number;
  /** Declared by the deployer. A string the clerk records and does not verify. */
  declared_by: string;
}

export interface SubmissionReceipt extends RecordFrame {
  kind: "SUBMISSION";
  /** DECLARED by the submitter. Unauthenticated. The clerk does not verify it. */
  submitter_id: string;
  /** DECLARED by the submitter. Unauthenticated. */
  channel: string;
  /**
   * The submitter's own declared timestamp, RETAINED unchanged and never
   * trusted. Kept because the whole value of the repair is having both this and
   * clerk_time and being able to compare them.
   */
  declared_timestamp: number | null;
  /** sha256 over the canonicalised submitted bytes. */
  payload_commitment: string;
  payload_bytes: number;
  canonical_form: string;
  payload_retained: boolean;
  /** The canonical bytes, if retained. A COPY. Never a reference. */
  payload_canonical: string | null;
  /**
   * v2 and later. ABSENT on version-1 records, which readers must treat as
   * UNKNOWN_PRE_CREDENTIALS rather than relabelling them either way.
   */
  submitter_auth?: SubmitterAuth;
}

/**
 * Rides in every GAP marker. Without it, `kind: "GAP"` in the raw store is a
 * bare alarm — exactly the thing an untyped stop must never be. The clerk is
 * infrastructure and does not classify what a silence is ABOUT; that is a read,
 * and the read belongs to gap.ts. So the marker says what it is, says what it
 * does while held, and hands the classification onward instead of implying one.
 */
export const MARKER_NOT_A_FINDING =
  "MARKER, NOT A FINDING. This record states only that a declared cadence " +
  "elapsed without an arrival on this channel, as measured by the clerk's own " +
  "clock. It is NOT typed by object: whether this silence is about the " +
  "submitter, about the clerk's own coverage, or about the record path is a " +
  "READ, made by the instrument `clerk1.gap` over the whole store — not by the " +
  "clerk. SHAPE: this marker holds nothing and gates nothing; no privilege is " +
  "withdrawn and no action is inhibited, and the observed system is not told " +
  "it was written. Consuming `kind: \"GAP\"` as an alarm on its own is a misuse.";

export interface GapMarker extends RecordFrame {
  kind: "GAP";
  /** ALWAYS false. Present so a raw-JSON consumer sees it without reading prose. */
  is_finding: false;
  marker_note: string;
  channel: string;
  cadence_period_ms: number;
  cadence_grace_ms: number;
  last_submission_seq: number | null;
  last_submission_wall_ms: number | null;
  /**
   * Silence at the moment the marker was stamped. A LOWER BOUND: the end of the
   * silence is established by the next submission's receipt, not by this
   * marker. One marker per contiguous silence episode.
   */
  gap_ms_at_marker: number;
  episode_id: string;
}

export type ClerkRecord =
  | BootRecord
  | CadenceRecord
  | SubmissionReceipt
  | GapMarker
  | RefusalRecord;

/**
 * The auth state of a submission AS READ, which is not the same as what was
 * stamped: a version-1 record has no `submitter_auth` field at all, and must be
 * read as UNKNOWN_PRE_CREDENTIALS rather than defaulted in either direction.
 */
export function readSubmitterAuth(r: SubmissionReceipt): SubmitterAuth {
  if (r.submitter_auth === undefined) {
    return {
      state: "UNKNOWN_PRE_CREDENTIALS",
      proven_submitter_ids: null,
      submitter_key_fp: null,
      nonce: null,
      note: AUTH_NOTE_PRE_CREDENTIALS,
    };
  }
  return r.submitter_auth;
}

// ── Head anchor ───────────────────────────────────────────────────────────────
//
// A hash chain detects edits and deletions in the middle. It does NOT detect
// truncation of the tail: lop off the last k records and what remains verifies
// perfectly. The head anchor is the separate, signed statement of how far the
// chain got, so a truncated store contradicts it.
//
// The anchor is not magic. An attacker who can delete records can delete the
// anchor too — but cannot forge a NEW one, because the key is the clerk's. So
// truncation becomes: contradiction (anchor kept) or a missing anchor
// (CANNOT_VERIFY). Neither is silence.

export interface HeadAnchor {
  form: "ILAS-CLERK-HEAD-1";
  clerk_id: string;
  clerk_seq: number;
  record_count: number;
  receipt_hash: string;
  wall_ms: number;
  signature: string;
}

export const GENESIS_PREV_HASH = "0".repeat(64);

// ── Store layout (C6 — a declared, stable location) ───────────────────────────

export const STORE_FILES = Object.freeze({
  /** The chain. Append-only, one JSON record per line. */
  receipts: "receipts.jsonl",
  /** The signed tail statement. Rewritten (not appended) after every record. */
  head: "head.json",
  /** base64 SPKI DER, one line. A convenience copy, NOT a trust anchor. */
  publicKey: "clerk.pub",
  /** PKCS#8 PEM, mode 0600. Never read by anything under this directory except
   *  the clerk process itself. reader.ts does not open it. */
  privateKey: "clerk.key",
  /** POSIX only. On Windows the clerk listens on a named pipe. */
  socket: "clerk.sock",
});

/** Environment variable that configures the store location. */
export const STORE_DIR_ENV = "ILAS_CLERK_STORE";

// ── Reader-competence presumption (T1 REACH — STATED, NEVER TESTED) ───────────
//
// Printed at runtime by reader.ts and by the clerk daemon. Stated because the
// acceptance gate requires the instrument to state what reader it presumes, and
// NEVER tested because certifying reader competence belongs to the deployer or
// a governing body and no merit test enters through the record's back door.

export const READER_PRESUMPTION: readonly string[] = Object.freeze([
  "READER-COMPETENCE PRESUMED (stated, never tested — certification is the",
  "deployer's or a governing body's, never this program's):",
  "  This record presumes a reader who can obtain the clerk's public key by a",
  "  route that does not pass through this store, and who reads 'no finding'",
  "  as the absence of a finding rather than as a statement of health.",
]);
