// ──────────────────────────────────────────────────────────────────────────────
// ILAS — CLERK 1: ClerkCore. OBJECT A — infrastructure.
//
// Receives submissions, stamps receipts, chains them, signs them, stores them.
// It emits NO findings and NO verdicts. There is no method on this class that
// returns a verdict type, and nothing in this file imports gap.ts.
//
// The four things the observed system loses, and where each one lives:
//   WHEN            → clerk_time, read from THIS process's clocks (§2.2)
//   IN WHAT ORDER   → clerk_seq, this clerk's own counter
//   WHETHER AT ALL  → gap markers against a deployer-declared cadence
//   STILL INTACT    → payload_commitment over a canonical COPY (§2.1)
//
// What the observed system keeps: the words. Unchanged. Forever.
// ──────────────────────────────────────────────────────────────────────────────

import { randomUUID } from "crypto";
import { userInfo } from "os";
import { commit, CANONICAL_FORM, sha256Hex } from "./canonical";
import { canonicalise } from "./canonical";
import { loadOrCreateKeys, signPreimage } from "./keys";
import { loadRoster, submitterAuthPreimage } from "./credentials";
import type { LoadedRoster, SubmitterRoster } from "./credentials";
import { verifySignature } from "./signature";
import { readStore } from "./read-store";
import { ClerkStore, resolveStoreDir } from "./store";
import {
  ATTESTATION_SCOPE,
  AUTH_NOTE_AUTHENTICATED,
  AUTH_NOTE_EMPTY_ROSTER,
  AUTH_NOTE_NO_ROSTER,
  CLERK_BUILD,
  GENESIS_PREV_HASH,
  IN_PROCESS_WARNING,
  MARKER_NOT_A_FINDING,
  RECEIPT_VERSION,
  REFUSAL_NOT_A_FINDING,
} from "./types";
import type {
  BootRecord,
  CadenceRecord,
  ClerkRecord,
  ClerkTime,
  GapMarker,
  HeadAnchor,
  IntakeChannel,
  RecordFrame,
  RefusalReason,
  RefusalRecord,
  SubmitterAuth,
  SeparationMode,
  StoreLoadState,
  SubmissionReceipt,
} from "./types";
import type { KeyObject } from "crypto";

export const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;

/** Single-use nonce lifetime. Short: it only has to survive one round trip. */
export const DEFAULT_NONCE_TTL_MS = 30_000;
/** Bound on outstanding nonces, so issuance cannot be used to exhaust memory. */
export const DEFAULT_MAX_OUTSTANDING_NONCES = 4096;
/** Minimum interval between REFUSAL records for one (reason, channel, submitter). */
export const DEFAULT_REFUSAL_COOLDOWN_MS = 1000;
/** Bound on distinct refusal keys tracked, so key cardinality cannot be gamed. */
export const DEFAULT_MAX_REFUSAL_KEYS = 256;

export class SubmissionRejected extends Error {
  constructor(
    message: string,
    readonly reason: RefusalReason | "CADENCE_INVALID",
    /** clerk_seq of the REFUSAL record, or null when none was emitted. */
    readonly refusalSeq: number | null = null
  ) {
    super(message);
    this.name = "SubmissionRejected";
  }
}

export class NonceUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonceUnavailable";
  }
}

export interface Challenge {
  nonce: string;
  issued_wall_ms: number;
  expires_wall_ms: number;
}

export interface ClerkCoreOptions {
  /** Explicit store directory. See resolveStoreDir for the fallback order. */
  storeDir?: string;
  /**
   * REQUIRED and deliberately not defaulted. A caller must say which of the two
   * things it is building; there is no "probably separated" case.
   */
  separation: SeparationMode;
  clerkId?: string;
  /** Keep the canonical bytes in the receipt. Default true. */
  retainPayload?: boolean;
  maxPayloadBytes?: number;
  wallClock?: () => number;
  monotonicClock?: () => bigint;
  bootId?: string;
  /**
   * DEPLOYER-SUPPLIED submitter roster: identifier → base64 SPKI public key, or
   * a path to a JSON file of that shape. There is no default and no built-in
   * entry. Absent means submissions are accepted and stamped UNAUTHENTICATED.
   *
   * Loaded ONCE, here, at boot. It cannot be swapped underneath a running clerk.
   */
  roster?: string | SubmitterRoster | null;
  nonceTtlMs?: number;
  maxOutstandingNonces?: number;
  refusalCooldownMs?: number;
  maxRefusalKeys?: number;
}

export interface SubmissionRequest {
  /** Declared by the submitter. Copied, never verified. */
  submitter_id: string;
  /** Declared by the submitter. Copied, never verified. */
  channel: string;
  /** The submitter's own clock reading. Retained, never trusted. */
  declared_timestamp?: number | null;
  /** The words. The clerk commits to their canonical bytes and never reads them. */
  payload: unknown;
  /** The clerk-issued nonce from `challenge()`. Required when a roster is in force. */
  nonce?: string | null;
  /** Ed25519 over submitterAuthPreimage(...), base64. See credentials.ts §3. */
  submitter_signature?: string | null;
}

interface ChannelState {
  cadence: { period_ms: number; grace_ms: number; declared_at_seq: number } | null;
  /** Wall time the cadence clock counts from when nothing has arrived yet. */
  referenceWallMs: number | null;
  lastSubmissionSeq: number | null;
  lastSubmissionWallMs: number | null;
  openEpisodeId: string | null;
}

function newChannelState(): ChannelState {
  return {
    cadence: null,
    referenceWallMs: null,
    lastSubmissionSeq: null,
    lastSubmissionWallMs: null,
    openEpisodeId: null,
  };
}

export class ClerkCore {
  readonly storeDir: string;
  readonly clerkId: string;
  readonly bootId: string;
  readonly separation: SeparationMode;
  readonly publicKeyB64: string;
  readonly storeLoadState: StoreLoadState;
  readonly storeLoadDetail: string | null;

  private readonly store: ClerkStore;
  private readonly privateKey: KeyObject;
  private readonly principal: string;
  private readonly retainPayload: boolean;
  private readonly maxPayloadBytes: number;
  private readonly wallClock: () => number;
  private readonly monotonicClock: () => bigint;

  private nextSeq = 0;
  private prevHash = GENESIS_PREV_HASH;
  private head: HeadAnchor | null = null;
  private readonly channels = new Map<string, ChannelState>();

  // ── credentials ───────────────────────────────────────────────────────────
  readonly roster: LoadedRoster;
  private readonly nonces = new Map<string, number>(); // nonce → expires_wall_ms
  private readonly nonceTtlMs: number;
  private readonly maxOutstandingNonces: number;
  private readonly refusalCooldownMs: number;
  private readonly maxRefusalKeys: number;
  private readonly refusalGate = new Map<
    string,
    { lastEmitWallMs: number; suppressed: number }
  >();

  constructor(options: ClerkCoreOptions) {
    this.storeDir = resolveStoreDir(options.storeDir);
    this.separation = options.separation;
    this.retainPayload = options.retainPayload ?? true;
    this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    this.wallClock = options.wallClock ?? Date.now;
    this.monotonicClock = options.monotonicClock ?? process.hrtime.bigint;
    this.bootId = options.bootId ?? randomUUID();
    this.clerkId = options.clerkId ?? `clerk-${sha256Hex(this.storeDir).slice(0, 16)}`;

    this.nonceTtlMs = options.nonceTtlMs ?? DEFAULT_NONCE_TTL_MS;
    this.maxOutstandingNonces =
      options.maxOutstandingNonces ?? DEFAULT_MAX_OUTSTANDING_NONCES;
    this.refusalCooldownMs =
      options.refusalCooldownMs ?? DEFAULT_REFUSAL_COOLDOWN_MS;
    this.maxRefusalKeys = options.maxRefusalKeys ?? DEFAULT_MAX_REFUSAL_KEYS;
    this.roster = loadRoster(options.roster);

    this.store = new ClerkStore(this.storeDir);
    this.store.requireDeployed();

    const keys = loadOrCreateKeys(
      this.store.privateKeyPath,
      this.store.publicKeyPath
    );
    this.privateKey = keys.privateKey;
    this.publicKeyB64 = keys.publicKeyB64;

    try {
      this.principal = userInfo().username;
    } catch {
      this.principal = "<unknown>";
    }

    const loaded = this.loadExisting();
    this.storeLoadState = loaded.state;
    this.storeLoadDetail = loaded.detail;

    this.emitBoot();
  }

  // ── boot-time reconstruction ───────────────────────────────────────────────
  //
  // The clerk continues an existing chain; it never repairs one. If the store
  // does not reconcile, that is RECORDED in the BOOT record and the chain goes
  // on from where it actually is — a silent repair would erase the only
  // evidence that something happened.

  private loadExisting(): { state: StoreLoadState; detail: string | null } {
    const s = readStore(this.storeDir);
    if (s.kind === "STORE_BLIND") {
      return { state: "FRESH", detail: null };
    }
    if (s.records.length === 0 && s.malformed.length === 0 && s.head === null) {
      return { state: "FRESH", detail: null };
    }

    const problems: string[] = [];
    if (s.malformed.length > 0) {
      problems.push(`${s.malformed.length} malformed line(s) in the store`);
    }

    let maxSeq = -1;
    let tail: ClerkRecord | null = null;
    for (const r of s.records) {
      if (r.clerk_seq > maxSeq) {
        maxSeq = r.clerk_seq;
        tail = r;
      }
      this.replayChannelState(r);
    }

    if (tail !== null) {
      this.nextSeq = maxSeq + 1;
      this.prevHash = tail.receipt_hash;
    }

    if (s.head !== null) {
      this.head = s.head;
      if (tail === null || s.head.clerk_seq > maxSeq) {
        problems.push(
          `head.json states clerk_seq ${s.head.clerk_seq} but the store ends at ` +
            `${maxSeq < 0 ? "no records" : `clerk_seq ${maxSeq}`}`
        );
      } else if (s.head.clerk_seq === maxSeq && s.head.receipt_hash !== tail.receipt_hash) {
        problems.push(`head.json tail hash disagrees with the record at clerk_seq ${maxSeq}`);
      }
    } else if (s.records.length > 0) {
      problems.push(s.headProblem ?? "head.json absent");
    }

    if (problems.length > 0) {
      return { state: "LOADED_WITH_BREAK", detail: problems.join("; ") };
    }
    return { state: "LOADED", detail: null };
  }

  private replayChannelState(r: ClerkRecord): void {
    if (r.kind === "CADENCE") {
      const st = this.channelState(r.channel);
      st.cadence = {
        period_ms: r.period_ms,
        grace_ms: r.grace_ms,
        declared_at_seq: r.clerk_seq,
      };
      st.referenceWallMs = r.clerk_time.wall_ms;
    } else if (r.kind === "SUBMISSION") {
      const st = this.channelState(r.channel);
      st.lastSubmissionSeq = r.clerk_seq;
      st.lastSubmissionWallMs = r.clerk_time.wall_ms;
      st.openEpisodeId = null;
    } else if (r.kind === "GAP") {
      this.channelState(r.channel).openEpisodeId = r.episode_id;
    }
  }

  private channelState(channel: string): ChannelState {
    let st = this.channels.get(channel);
    if (st === undefined) {
      st = newChannelState();
      this.channels.set(channel, st);
    }
    return st;
  }

  // ── stamping ───────────────────────────────────────────────────────────────

  private now(): ClerkTime {
    return {
      wall_ms: this.wallClock(),
      monotonic_ns: this.monotonicClock().toString(),
    };
  }

  private frame(
    kind: ClerkRecord["kind"],
    intake: IntakeChannel
  ): Omit<RecordFrame, "receipt_hash" | "signature"> {
    return {
      receipt_version: RECEIPT_VERSION,
      kind,
      clerk_id: this.clerkId,
      clerk_boot_id: this.bootId,
      separation: this.separation,
      separation_warning:
        this.separation === "IN_PROCESS_NO_SEPARATION" ? IN_PROCESS_WARNING : null,
      clerk_principal: this.principal,
      intake,
      attests: ATTESTATION_SCOPE,
      clerk_seq: this.nextSeq,
      clerk_time: this.now(),
      prev_receipt_hash: this.prevHash,
      signature_alg: "ed25519",
    };
  }

  private emit<T extends ClerkRecord>(
    kind: T["kind"],
    body: Omit<T, keyof RecordFrame>,
    intake: IntakeChannel
  ): T {
    const unsigned = { ...this.frame(kind, intake), ...body } as unknown as Omit<
      T,
      "receipt_hash" | "signature"
    >;
    const preimage = canonicalise(unsigned);
    const receipt_hash = sha256Hex(preimage);
    const signature = signPreimage(preimage, this.privateKey);
    const record = { ...unsigned, receipt_hash, signature } as unknown as T;

    this.store.append(record);
    this.nextSeq = record.clerk_seq + 1;
    this.prevHash = receipt_hash;
    this.writeHead(record);
    return record;
  }

  private writeHead(record: ClerkRecord): void {
    const unsigned: Omit<HeadAnchor, "signature"> = {
      form: "ILAS-CLERK-HEAD-1",
      clerk_id: this.clerkId,
      clerk_seq: record.clerk_seq,
      record_count: record.clerk_seq + 1,
      receipt_hash: record.receipt_hash,
      wall_ms: record.clerk_time.wall_ms,
    };
    const anchor: HeadAnchor = {
      ...unsigned,
      signature: signPreimage(canonicalise(unsigned), this.privateKey),
    };
    this.store.writeHead(anchor);
    this.head = anchor;
  }

  private emitBoot(): BootRecord {
    return this.emit<BootRecord>("BOOT", {
      clerk_build: CLERK_BUILD,
      store_dir: this.storeDir,
      public_key: this.publicKeyB64,
      store_load_state: this.storeLoadState,
      store_load_detail: this.storeLoadDetail,
      clerk_pid: process.pid,
      roster_state: this.roster.state,
      roster_size: this.roster.entries.size,
      roster_fingerprint: this.roster.rosterFingerprint,
      roster_source: this.roster.source,
      roster_problems: this.roster.problems,
    }, "CLERK_INTERNAL");
  }

  // ── credentials: challenge, check, refuse ─────────────────────────────────

  /**
   * Issue a single-use, short-lived, CLERK-CHOSEN nonce. This is what makes a
   * submitter credential worth anything: a captured submission cannot be
   * re-posted, because its nonce was consumed the first time.
   *
   * Issuance discloses nothing about the roster — no identity is required and
   * no membership is revealed — so it cannot be used to enumerate submitters.
   */
  challenge(): Challenge {
    const now = this.wallClock();
    this.sweepNonces(now);
    if (this.nonces.size >= this.maxOutstandingNonces) {
      const detail =
        `${this.nonces.size} nonces are outstanding (limit ${this.maxOutstandingNonces}); ` +
        `refusing to issue more. While this holds, an honest submitter CANNOT ` +
        `submit and will look silent. This record exists so that silence is not ` +
        `billed to the submitter: the gap detector reads it as an impairment of ` +
        `the clerk's own intake.`;
      // Rate-limited through the same gate as every other refusal, so a flood
      // of challenge requests cannot be turned into chain growth.
      this.refuse(
        { submitter_id: "<undisclosed>", channel: "<challenge>", payload: null },
        "CHALLENGE_UNAVAILABLE",
        detail,
        null,
        "CLERK_INTERNAL"
      );
      throw new NonceUnavailable(detail);
    }
    const nonce = randomUUID();
    const expires_wall_ms = now + this.nonceTtlMs;
    this.nonces.set(nonce, expires_wall_ms);
    return { nonce, issued_wall_ms: now, expires_wall_ms };
  }

  private sweepNonces(now: number): void {
    for (const [nonce, expires] of this.nonces) {
      if (expires <= now) this.nonces.delete(nonce);
    }
  }

  /** Outstanding, unconsumed nonces. Diagnostic only; not a health statement. */
  get outstandingNonces(): number {
    return this.nonces.size;
  }

  private checkSubmitterAuth(
    req: SubmissionRequest,
    payload_commitment: string
  ): {
    auth: SubmitterAuth;
    refusal: { reason: RefusalReason; detail: string } | null;
  } {
    if (this.roster.state === "ABSENT") {
      return {
        auth: {
          state: "UNAUTHENTICATED_NO_ROSTER",
          proven_submitter_ids: null,
          submitter_key_fp: null,
          nonce: null,
          note: AUTH_NOTE_NO_ROSTER,
        },
        refusal: null,
      };
    }

    if (this.roster.state === "CONFIGURED_EMPTY") {
      // Not fail-shut: an empty roster must not make the clerk unusable, or it
      // will simply be turned off. Not clean either: this is its own state and
      // the gap detector treats it as blind.
      return {
        auth: {
          state: "UNAUTHENTICATED_EMPTY_ROSTER",
          proven_submitter_ids: null,
          submitter_key_fp: null,
          nonce: null,
          note: AUTH_NOTE_EMPTY_ROSTER,
        },
        refusal: null,
      };
    }

    const entry = this.roster.entries.get(req.submitter_id);
    if (entry === undefined) {
      return {
        auth: this.unauthenticatedStub(),
        refusal: {
          reason: "SUBMITTER_NOT_IN_ROSTER",
          detail:
            `declared submitter \`${req.submitter_id}\` is not in the roster in ` +
            `force for this clerk run (${this.roster.entries.size} entries, ` +
            `fingerprint ${String(this.roster.rosterFingerprint)}). The clerk does ` +
            `not enroll submitters and did not attempt to.`,
        },
      };
    }

    const nonce = req.nonce ?? null;
    if (nonce === null || !this.nonces.has(nonce)) {
      return {
        auth: this.unauthenticatedStub(),
        refusal: {
          reason: "MISSING_OR_UNKNOWN_NONCE",
          detail:
            nonce === null
              ? `no nonce presented. A roster is in force, so a submission must ` +
                `carry a clerk-issued nonce from \`challenge\`; without one the ` +
                `submission would be replayable.`
              : `nonce was not issued by this clerk run, or has already been ` +
                `consumed. Nonces are single-use and do not survive a restart.`,
        },
      };
    }

    const expires = this.nonces.get(nonce) as number;
    const now = this.wallClock();
    if (expires <= now) {
      this.nonces.delete(nonce);
      return {
        auth: this.unauthenticatedStub(),
        refusal: {
          reason: "NONCE_EXPIRED",
          detail: `nonce expired at ${expires}; the clerk's clock now reads ${now}.`,
        },
      };
    }

    const signature = req.submitter_signature ?? null;
    if (signature === null || signature.length === 0) {
      return {
        auth: this.unauthenticatedStub(),
        refusal: {
          reason: "MISSING_SUBMITTER_SIGNATURE",
          detail:
            `no submitter signature presented, and a roster is in force. The ` +
            `nonce is NOT consumed by this refusal, so a submitter that simply ` +
            `forgot to sign can retry with it.`,
        },
      };
    }

    const preimage = submitterAuthPreimage({
      clerk_id: this.clerkId,
      nonce,
      submitter_id: req.submitter_id,
      channel: req.channel,
      payload_commitment,
    });

    if (!verifySignature(preimage, signature, entry.key)) {
      // The nonce IS consumed here. A wrong signature against a live nonce is
      // the shape an attacker probes with, and leaving the nonce alive would
      // hand them unlimited attempts against one challenge.
      this.nonces.delete(nonce);
      return {
        auth: this.unauthenticatedStub(),
        refusal: {
          reason: "SUBMITTER_SIGNATURE_INVALID",
          detail:
            `signature does not verify against the roster key for ` +
            `\`${req.submitter_id}\` (key ${entry.fingerprint}) over ` +
            `{clerk_id, nonce, submitter_id, channel, payload_commitment}. The ` +
            `nonce has been consumed. This does NOT say who submitted: a stale ` +
            `roster, a mismatched canonicalisation and an impostor look alike here.`,
        },
      };
    }

    this.nonces.delete(nonce); // single use, consumed on success
    const shared = this.roster.sharedKeys.get(entry.fingerprint) ?? [entry.submitterId];
    return {
      auth: {
        state: "AUTHENTICATED",
        proven_submitter_ids: shared,
        submitter_key_fp: entry.fingerprint,
        nonce,
        note:
          AUTH_NOTE_AUTHENTICATED +
          (shared.length > 1
            ? ` NOTE: this deployment's roster binds this key to ${shared.length} ` +
              `identifiers (${shared.join(", ")}), so possession does not ` +
              `distinguish between them.`
            : ""),
      },
      refusal: null,
    };
  }

  private unauthenticatedStub(): SubmitterAuth {
    return {
      state: "UNAUTHENTICATED_NO_ROSTER",
      proven_submitter_ids: null,
      submitter_key_fp: null,
      nonce: null,
      note: AUTH_NOTE_NO_ROSTER,
    };
  }

  /**
   * Record the refusal and return the error to throw.
   *
   * RATE-LIMITED. Every refusal writes a chained record, so an attacker with
   * socket access could otherwise grow the store as fast as it can open
   * connections. At most one record per (reason, channel, declared submitter)
   * per cooldown; suppressed refusals are COUNTED and reported in the next
   * record for that key, never dropped. The number of distinct keys tracked is
   * capped, because the key is attacker-chosen — beyond the cap everything
   * collapses into one `<overflow>` bucket, which is visible in the record.
   */
  private refuse(
    req: SubmissionRequest,
    reason: RefusalReason,
    detail: string,
    payload_commitment: string | null,
    intake: IntakeChannel
  ): SubmissionRejected {
    const now = this.wallClock();
    let key = `${reason}|${req.channel}|${req.submitter_id}`;
    if (!this.refusalGate.has(key) && this.refusalGate.size >= this.maxRefusalKeys) {
      key = "<overflow>";
    }
    const gate = this.refusalGate.get(key) ?? { lastEmitWallMs: -Infinity, suppressed: 0 };

    if (now - gate.lastEmitWallMs < this.refusalCooldownMs) {
      gate.suppressed++;
      this.refusalGate.set(key, gate);
      return new SubmissionRejected(
        `${reason}: ${detail} (refusal record suppressed by rate limit; ` +
          `${gate.suppressed} suppressed since the last record for this key)`,
        reason,
        null
      );
    }

    const record = this.emit<RefusalRecord>(
      "REFUSAL",
      {
        is_finding: false,
        refusal_note: REFUSAL_NOT_A_FINDING,
        reason,
        detail:
          key === "<overflow>"
            ? `${detail} [refusal-key table full at ${this.maxRefusalKeys}; this ` +
              `record is the overflow bucket and covers refusals whose ` +
              `(reason, channel, submitter) was not individually tracked]`
            : detail,
        declared_submitter_id: req.submitter_id,
        channel: req.channel,
        payload_commitment,
        payload_retained: false,
        suppressed_since_last: gate.suppressed,
      },
      intake
    );

    this.refusalGate.set(key, { lastEmitWallMs: now, suppressed: 0 });
    return new SubmissionRejected(`${reason}: ${detail}`, reason, record.clerk_seq);
  }

  // ── the submit interface (the only thing a submitter can reach) ────────────

  /**
   * Commit to a submission. The payload is CANONICALISED — serialised to a
   * string at this boundary — so the submitter's object graph is not reachable
   * from anything stored afterwards. Mutating the submitted object after this
   * call returns cannot change the commitment or invalidate the chain.
   */
  submit(
    req: SubmissionRequest,
    intake: IntakeChannel = "LOCAL_CALL"
  ): SubmissionReceipt {
    let committed: { canonical: string; commitment: string; bytes: number };
    try {
      committed = commit(req.payload);
    } catch (err) {
      throw this.refuse(
        req,
        "PAYLOAD_UNCOMMITTABLE",
        `payload cannot be canonicalised, so it cannot be committed to: ${String(err)}`,
        null,
        intake
      );
    }
    if (committed.bytes > this.maxPayloadBytes) {
      throw this.refuse(
        req,
        "PAYLOAD_TOO_LARGE",
        `payload is ${committed.bytes} canonical bytes; limit is ${this.maxPayloadBytes}`,
        committed.commitment,
        intake
      );
    }

    // ── credentials ───────────────────────────────────────────────────────────
    const auth = this.checkSubmitterAuth(req, committed.commitment);
    if (auth.refusal !== null) {
      throw this.refuse(
        req,
        auth.refusal.reason,
        auth.refusal.detail,
        committed.commitment,
        intake
      );
    }

    const receipt = this.emit<SubmissionReceipt>("SUBMISSION", {
      submitter_id: req.submitter_id,
      channel: req.channel,
      declared_timestamp: req.declared_timestamp ?? null,
      payload_commitment: committed.commitment,
      payload_bytes: committed.bytes,
      canonical_form: CANONICAL_FORM,
      payload_retained: this.retainPayload,
      payload_canonical: this.retainPayload ? committed.canonical : null,
      submitter_auth: auth.auth,
    }, intake);

    const st = this.channelState(req.channel);
    st.lastSubmissionSeq = receipt.clerk_seq;
    st.lastSubmissionWallMs = receipt.clerk_time.wall_ms;
    st.openEpisodeId = null;
    return receipt;
  }

  /**
   * A deployer MAY declare an expected submission cadence for a channel.
   * Offer, not imposition: no cadence, no gap markers, and the gap detector
   * says so in a typed way rather than reporting quiet.
   */
  declareCadence(
    channel: string,
    period_ms: number,
    grace_ms: number,
    declared_by: string,
    intake: IntakeChannel = "LOCAL_CALL"
  ): CadenceRecord {
    if (!Number.isFinite(period_ms) || period_ms <= 0) {
      throw new SubmissionRejected(
        `cadence period must be a positive finite number of ms; got ${String(period_ms)}`,
        "CADENCE_INVALID"
      );
    }
    if (!Number.isFinite(grace_ms) || grace_ms < 0) {
      throw new SubmissionRejected(
        `cadence grace must be a non-negative finite number of ms; got ${String(grace_ms)}`,
        "CADENCE_INVALID"
      );
    }
    const record = this.emit<CadenceRecord>("CADENCE", {
      channel,
      period_ms,
      grace_ms,
      declared_by,
    }, intake);
    const st = this.channelState(channel);
    st.cadence = { period_ms, grace_ms, declared_at_seq: record.clerk_seq };
    st.referenceWallMs = record.clerk_time.wall_ms;
    return record;
  }

  /**
   * Stamp a gap marker for every channel whose declared cadence has been broken
   * and that does not already have an open silence episode.
   *
   * ONE MARKER PER EPISODE, by design: a channel silent for a week must not
   * produce a marker per tick, which would bury the record in its own alarm.
   * The marker therefore carries a LOWER BOUND on the silence; the end of the
   * silence is established by the next submission's receipt, and the gap
   * detector (gap.ts) is what puts the two together.
   *
   * This method emits RECORDS, not findings. It is Object A.
   */
  scanCadences(nowMs?: number): GapMarker[] {
    const now = nowMs ?? this.wallClock();
    const markers: GapMarker[] = [];
    for (const [channel, st] of this.channels) {
      if (st.cadence === null) continue;
      if (st.openEpisodeId !== null) continue;
      const ref = st.lastSubmissionWallMs ?? st.referenceWallMs;
      if (ref === null) continue;
      const silence = now - ref;
      if (silence <= st.cadence.period_ms + st.cadence.grace_ms) continue;

      const episode_id = randomUUID();
      const marker = this.emit<GapMarker>("GAP", {
        is_finding: false,
        marker_note: MARKER_NOT_A_FINDING,
        channel,
        cadence_period_ms: st.cadence.period_ms,
        cadence_grace_ms: st.cadence.grace_ms,
        last_submission_seq: st.lastSubmissionSeq,
        last_submission_wall_ms: st.lastSubmissionWallMs,
        gap_ms_at_marker: silence,
        episode_id,
      }, "CLERK_INTERNAL");
      st.openEpisodeId = episode_id;
      markers.push(marker);
    }
    return markers;
  }

  // ── read-back surface (no verdicts; plain state) ───────────────────────────

  getHead(): HeadAnchor | null {
    return this.head;
  }

  get length(): number {
    return this.nextSeq;
  }
}
