// ──────────────────────────────────────────────────────────────────────────────
// ILAS — CLERK 1: the NARROW SUBMIT INTERFACE.
//
// This is the entire surface a submitter can reach. Read the list and note what
// is absent: there is no operation that reads the signing key, no operation
// that deletes or rewrites a record, no operation that sets the sequence
// counter or the clock, and no operation that discloses the store location.
// A submitter can add to the record and ask the clerk about itself. That is all.
//
// Newline-delimited JSON over a local socket (POSIX) or named pipe (Windows).
// No HTTP, no framework, no new dependency.
// ──────────────────────────────────────────────────────────────────────────────

import { createHash } from "crypto";
import { join } from "path";
import { STORE_FILES } from "./types";
import type { SeparationMode } from "./types";
import type { RosterState } from "./credentials";

export type ClerkOp =
  | "challenge"
  | "submit"
  | "declare_cadence"
  | "scan_cadences"
  | "head"
  | "info";

/**
 * Ask for a single-use nonce. Takes no identity and reveals no roster
 * membership, so it cannot be used to enumerate enrolled submitters — the
 * refusal for an unknown submitter comes later, on the submission itself,
 * where it is recorded.
 */
export interface ChallengeMessage {
  op: "challenge";
}

export interface SubmitRequestMessage {
  op: "submit";
  submitter_id: string;
  channel: string;
  declared_timestamp?: number | null;
  payload: unknown;
  /** Required when a roster is in force. From `challenge`. Single use. */
  nonce?: string | null;
  /** base64 Ed25519 over submitterAuthPreimage({clerk_id, nonce, submitter_id,
   *  channel, payload_commitment}). See credentials.ts. */
  submitter_signature?: string | null;
}

export interface DeclareCadenceMessage {
  op: "declare_cadence";
  channel: string;
  period_ms: number;
  grace_ms: number;
  declared_by: string;
}

export interface ScanCadencesMessage {
  op: "scan_cadences";
  now_ms?: number;
}

export interface HeadMessage {
  op: "head";
}

export interface InfoMessage {
  op: "info";
}

export type ClerkRequestMessage =
  | ChallengeMessage
  | SubmitRequestMessage
  | DeclareCadenceMessage
  | ScanCadencesMessage
  | HeadMessage
  | InfoMessage;

/**
 * What `info` discloses. Deliberately NOT the store location: everything here
 * already rides in every receipt the submitter is handed back, so `info` grants
 * the submitter nothing it did not already have.
 */
export interface ClerkInfo {
  clerk_id: string;
  separation: SeparationMode;
  separation_warning: string | null;
  clerk_principal: string;
  public_key: string;
  clerk_seq_next: number;
  /**
   * Whether a roster is in force — so a submitter knows it must sign. The
   * roster's CONTENTS are never disclosed here: a submitter learns that
   * authentication is required, not who else is enrolled.
   */
  roster_state: RosterState;
}

export interface ClerkOkResponse<T = unknown> {
  ok: true;
  op: ClerkOp;
  result: T;
}

export interface ClerkErrorResponse {
  ok: false;
  op: string;
  error: { name: string; message: string };
}

export type ClerkResponseMessage<T = unknown> =
  | ClerkOkResponse<T>
  | ClerkErrorResponse;

/**
 * Where the clerk listens. Derived from the store directory so a deployment
 * with one store has one clerk and no ambiguity about which one it reached.
 */
export function defaultSocketPath(storeDir: string): string {
  if (process.platform === "win32") {
    const tag = createHash("sha256").update(storeDir).digest("hex").slice(0, 16);
    return `\\\\.\\pipe\\ilas-clerk-${tag}`;
  }
  return join(storeDir, STORE_FILES.socket);
}
