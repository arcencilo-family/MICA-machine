// ──────────────────────────────────────────────────────────────────────────────
// ILAS — CLERK 1: submitter-side clients. Object A (infrastructure).
//
// Two implementations of one interface, and the difference between them is the
// whole point of build brief §3:
//
//   SocketClerkClient    — talks to a clerk in ANOTHER OS PROCESS through the
//                          narrow submit interface. Cannot reach the key, the
//                          counter, the clock, or the store.
//   InProcessClerkClient — holds a ClerkCore in the submitter's own process.
//                          Same memory, same privileges, key in the same
//                          address space. Buys NOTHING against the observed
//                          system, and every record it produces says so IN THE
//                          RECORD, not in a README.
//
// The in-process client cannot be constructed with a SEPARATE_PROCESS mode: a
// separated-looking receipt from an unseparated clerk is the one output this
// build must never produce.
// ──────────────────────────────────────────────────────────────────────────────

import { connect, Socket } from "net";
import { sign as cryptoSign } from "crypto";
import type { KeyObject } from "crypto";
import { commit } from "./canonical";
import { ClerkCore } from "./core";
import type { Challenge, ClerkCoreOptions, SubmissionRequest } from "./core";
import { submitterAuthPreimage } from "./credentials";
import { defaultSocketPath } from "./protocol";
import type {
  ClerkInfo,
  ClerkRequestMessage,
  ClerkResponseMessage,
} from "./protocol";
import type {
  CadenceRecord,
  GapMarker,
  HeadAnchor,
  SeparationMode,
  SubmissionReceipt,
} from "./types";

export interface ClerkClient {
  readonly separation: SeparationMode;
  /** Ask for a single-use nonce. Required before an authenticated submission. */
  challenge(): Promise<Challenge>;
  submit(req: SubmissionRequest): Promise<SubmissionReceipt>;
  declareCadence(
    channel: string,
    period_ms: number,
    grace_ms: number,
    declared_by: string
  ): Promise<CadenceRecord>;
  scanCadences(nowMs?: number): Promise<GapMarker[]>;
  head(): Promise<HeadAnchor | null>;
  info(): Promise<ClerkInfo>;
  close(): Promise<void>;
}

export class ClerkProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClerkProtocolError";
  }
}

// ── in-process: honest about buying nothing ──────────────────────────────────

export class InProcessClerkClient implements ClerkClient {
  readonly separation = "IN_PROCESS_NO_SEPARATION" as const;
  readonly core: ClerkCore;

  constructor(options: Omit<ClerkCoreOptions, "separation">) {
    this.core = new ClerkCore({
      ...options,
      separation: "IN_PROCESS_NO_SEPARATION",
    });
  }

  async challenge(): Promise<Challenge> {
    return this.core.challenge();
  }
  async submit(req: SubmissionRequest): Promise<SubmissionReceipt> {
    return this.core.submit(req);
  }
  async declareCadence(
    channel: string,
    period_ms: number,
    grace_ms: number,
    declared_by: string
  ): Promise<CadenceRecord> {
    return this.core.declareCadence(channel, period_ms, grace_ms, declared_by);
  }
  async scanCadences(nowMs?: number): Promise<GapMarker[]> {
    return this.core.scanCadences(nowMs);
  }
  async head(): Promise<HeadAnchor | null> {
    return this.core.getHead();
  }
  async info(): Promise<ClerkInfo> {
    return {
      clerk_id: this.core.clerkId,
      separation: this.separation,
      separation_warning: null,
      clerk_principal: "<same process as the submitter>",
      public_key: this.core.publicKeyB64,
      clerk_seq_next: this.core.length,
      roster_state: this.core.roster.state,
    };
  }
  async close(): Promise<void> {
    /* nothing to close: there is no boundary here. That is the point. */
  }
}

// ── separate process: the narrow interface ───────────────────────────────────

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export class SocketClerkClient implements ClerkClient {
  readonly separation = "SEPARATE_PROCESS" as const;
  private socket: Socket | null = null;
  private buffer = "";
  private readonly pending: Pending[] = [];
  private closed = false;

  constructor(readonly socketPath: string) {}

  static forStore(storeDir: string): SocketClerkClient {
    return new SocketClerkClient(defaultSocketPath(storeDir));
  }

  private async ensure(): Promise<Socket> {
    if (this.socket !== null) return this.socket;
    const s = await new Promise<Socket>((resolve, reject) => {
      const sock = connect(this.socketPath);
      const onError = (err: Error): void => {
        sock.destroy();
        reject(
          new ClerkProtocolError(
            `cannot reach the clerk at ${this.socketPath}: ${err.message}. ` +
              `A submitter that cannot reach the clerk MUST NOT fall back to ` +
              `writing its own record — that is the failure this build exists to remove.`
          )
        );
      };
      sock.once("error", onError);
      sock.once("connect", () => {
        sock.off("error", onError);
        resolve(sock);
      });
    });

    s.setEncoding("utf8");
    s.on("data", (chunk: string) => this.onData(chunk));
    s.on("error", (err) => this.failAll(err));
    s.on("close", () => {
      if (!this.closed) this.failAll(new Error("clerk connection closed"));
    });
    this.socket = s;
    return s;
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const nl = this.buffer.indexOf("\n");
      if (nl < 0) break;
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (line.trim().length === 0) continue;
      const p = this.pending.shift();
      if (p === undefined) continue;
      let parsed: ClerkResponseMessage;
      try {
        parsed = JSON.parse(line) as ClerkResponseMessage;
      } catch (err) {
        p.reject(new ClerkProtocolError(`unparseable response: ${String(err)}`));
        continue;
      }
      if (parsed.ok) {
        p.resolve(parsed.result);
      } else {
        const e = new ClerkProtocolError(
          `${parsed.error.name}: ${parsed.error.message}`
        );
        e.name = parsed.error.name;
        p.reject(e);
      }
    }
  }

  private failAll(err: Error): void {
    while (this.pending.length > 0) {
      this.pending.shift()?.reject(err);
    }
  }

  private async request<T>(msg: ClerkRequestMessage): Promise<T> {
    const s = await this.ensure();
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ resolve: resolve as (v: unknown) => void, reject });
      s.write(JSON.stringify(msg) + "\n");
    });
  }

  challenge(): Promise<Challenge> {
    return this.request<Challenge>({ op: "challenge" });
  }

  submit(req: SubmissionRequest): Promise<SubmissionReceipt> {
    return this.request<SubmissionReceipt>({
      op: "submit",
      submitter_id: req.submitter_id,
      channel: req.channel,
      declared_timestamp: req.declared_timestamp ?? null,
      payload: req.payload,
      nonce: req.nonce ?? null,
      submitter_signature: req.submitter_signature ?? null,
    });
  }

  declareCadence(
    channel: string,
    period_ms: number,
    grace_ms: number,
    declared_by: string
  ): Promise<CadenceRecord> {
    return this.request<CadenceRecord>({
      op: "declare_cadence",
      channel,
      period_ms,
      grace_ms,
      declared_by,
    });
  }

  scanCadences(nowMs?: number): Promise<GapMarker[]> {
    return this.request<GapMarker[]>({ op: "scan_cadences", now_ms: nowMs });
  }

  head(): Promise<HeadAnchor | null> {
    return this.request<HeadAnchor | null>({ op: "head" });
  }

  info(): Promise<ClerkInfo> {
    return this.request<ClerkInfo>({ op: "info" });
  }

  async close(): Promise<void> {
    this.closed = true;
    const s = this.socket;
    this.socket = null;
    if (s === null) return;
    await new Promise<void>((resolve) => {
      s.end(() => resolve());
    });
    s.destroy();
  }
}

// ── submitter side of the credential ─────────────────────────────────────────

/**
 * Wraps a client with a submitter's own private key and does the two-step:
 * fetch a clerk-issued nonce, sign {clerk_id, nonce, submitter_id, channel,
 * payload_commitment}, submit.
 *
 * NOTE WHAT THIS IS NOT. It is a convenience for a submitter that already HAS a
 * key. It does not generate one, does not enroll anyone, and does not know
 * where the key came from. Enrollment, distribution, rotation and revocation
 * are the deployer's, and no code in this package decides them.
 *
 * The private key stays in the submitter's process. The clerk never sees it —
 * it only ever sees a signature over material it chose half of.
 */
export class SignedSubmitter {
  constructor(
    private readonly client: ClerkClient,
    readonly submitterId: string,
    private readonly privateKey: KeyObject,
    /** The clerk's id, which the signature is bound to. From `info()`. */
    private readonly clerkId: string
  ) {}

  static async forClient(
    client: ClerkClient,
    submitterId: string,
    privateKey: KeyObject
  ): Promise<SignedSubmitter> {
    const info = await client.info();
    return new SignedSubmitter(client, submitterId, privateKey, info.clerk_id);
  }

  async submit(
    channel: string,
    payload: unknown,
    declared_timestamp?: number | null
  ): Promise<SubmissionReceipt> {
    const { nonce } = await this.client.challenge();
    const { commitment } = commit(payload);
    const preimage = submitterAuthPreimage({
      clerk_id: this.clerkId,
      nonce,
      submitter_id: this.submitterId,
      channel,
      payload_commitment: commitment,
    });
    return this.client.submit({
      submitter_id: this.submitterId,
      channel,
      declared_timestamp: declared_timestamp ?? null,
      payload,
      nonce,
      submitter_signature: cryptoSign(
        null,
        Buffer.from(preimage, "utf8"),
        this.privateKey
      ).toString("base64"),
    });
  }
}
