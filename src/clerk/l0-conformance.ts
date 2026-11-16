// ── MICA · does this clerk satisfy what L0 declared it needs? ────────────────
//
// A COMPILE-TIME ANSWER TO A SIZING QUESTION, AND NOTHING ELSE. Nothing here
// runs, nothing here wires anything, and no record moves because this file
// exists. If it compiles, MICA's `ClerkClient` is a `ClerkSubmitClient` as L0
// declared that shape. If it stops compiling, the compiler names the field.
//
// ── WHY IT IS A COPY AND NOT AN IMPORT ───────────────────────────────────────
//
//   MICA takes a dependency on ILAS of NO kind — not runtime, not dev, not
//   type-only. So the declarations below are TRANSCRIBED, by hand, from the
//   sources named at each block. This is the same method the other side already
//   uses toward us, and it is drawn from both ends:
//
//     ILAS  src/l0/index.ts:28
//       /** Structural edge to MICA-machine/src/clerk/client.ts::ClerkClient. */
//
//     MICA  ~/mica-external-evidence-log/stage/src/socket-conformance.ts (S95)
//       the mirror of this file, copying MICA's evidence socket into the log
//       package so the log can prove it fits without importing MICA.
//
//   A copied declaration can go stale. That is a real cost and it is the
//   cheaper one: an import would make two projects that must be able to die
//   separately into one build. If either shape changes, this file fails to
//   compile and somebody fixes it in the open — a LOUD staleness, which is the
//   only kind worth having.
//
//   THE STALENESS IS ONE-SIDED AND SAYS SO. This file fails when MICA moves.
//   It CANNOT notice L0 moving: nothing here reads ILAS at build time, by
//   design. Re-transcribe against the source below when ILAS changes, and the
//   line numbers are recorded so that re-read is a diff and not an archaeology.
//
// ── PROVENANCE OF THE COPY — read at bytes 2026-08-30, S96 ───────────────────
//
//   ~/ILAS/ilas-github-copy/src/l0/index.ts   18,030 B, mtime 2026-08-15 20:11
//     ll.21–26  ClerkSubmitRequest
//     ll.28–31  ClerkSubmitClient
//   ~/ILAS/ilas-github-copy/src/types.ts       5,012 B, mtime 2026-08-15 19:39
//     ll.19–40  ClerkSubmissionReceipt
//
//   Transcribed verbatim below, comments and all, EXCEPT that `export` is
//   dropped: these are not MICA's types to publish, and re-exporting them would
//   invite a MICA module to import the copy and start speaking ILAS's
//   vocabulary. They are local to this file on purpose, and this file is
//   deliberately NOT in `src/clerk/index.ts`'s barrel.
//
// ── WHERE THIS FILE LIVES, AND WHY HERE ──────────────────────────────────────
//
//   `src/clerk/`, beside the interface it constrains. A declaration copy that
//   sits next to the thing it describes shows up in the same directory listing
//   and the same review as the edit that would break it. The S95 socket earned
//   `src/evidence/` by being neither sensor nor participant; this one is about
//   the clerk's outward shape and belongs with the clerk.
// ──────────────────────────────────────────────────────────────────────────────

import type { ClerkClient } from "./client";

// ── the copy · ILAS src/l0/index.ts ll.21–26 ─────────────────────────────────

interface ClerkSubmitRequest {
  submitter_id: string;
  channel: string;
  declared_timestamp?: number | null;
  payload: unknown;
}

// ── the copy · ILAS src/types.ts ll.19–40 ────────────────────────────────────
//
// Its own header there, kept because it states the direction of the edge:
//   "The receipt fields L0 retains from Clerk 1. This is a structural subset of
//    MICA-machine/src/clerk/types.ts::SubmissionReceipt: ILAS depends on the
//    clerk's narrow client shape, while the clerk imports nothing from ILAS."

interface ClerkSubmissionReceipt {
  readonly kind: "SUBMISSION";
  readonly clerk_id: string;
  readonly clerk_boot_id: string;
  readonly separation: "SEPARATE_PROCESS" | "IN_PROCESS_NO_SEPARATION";
  readonly separation_warning: string | null;
  readonly clerk_principal: string;
  readonly intake: "SOCKET" | "LOCAL_CALL" | "CLERK_INTERNAL";
  readonly clerk_seq: number;
  readonly clerk_time: {
    readonly wall_ms: number;
    readonly monotonic_ns: string;
  };
  readonly prev_receipt_hash: string;
  readonly receipt_hash: string;
  readonly signature: string;
  readonly signature_alg: "ed25519";
  readonly declared_timestamp: number | null;
  readonly payload_commitment: string;
  readonly payload_retained: boolean;
  readonly payload_canonical: string | null;
}

// ── the copy · ILAS src/l0/index.ts ll.28–31 ─────────────────────────────────

/** Structural edge to MICA-machine/src/clerk/client.ts::ClerkClient. */
interface ClerkSubmitClient {
  submit(req: ClerkSubmitRequest): Promise<ClerkSubmissionReceipt>;
}

// ── the assertion ────────────────────────────────────────────────────────────
//
// If this assignment stops compiling, MICA's clerk no longer satisfies the
// shape L0 declared, and the compiler names the field that broke it. There is
// no runtime cost and no caller: it is a type position.
//
// WHAT IT PROVES, EXACTLY — and the bound is worth as much as the claim:
//
//   IT PROVES A SHAPE. The receipt MICA returns carries every field L0's
//   declaration requires, at compatible types. It proves NOTHING about
//   separation being real, about the clerk being uncompromised, or about the
//   two ever having spoken to each other. A green here is a statement about
//   TYPES, and a `separation: "SEPARATE_PROCESS"` field is still only a field.
//
//   IT PROVES NOTHING ABOUT WIRING. No caller exists. Whether L0 should route
//   its appends through this clerk is a ruling, and this file is not it.

export function conforms(client: ClerkClient): ClerkSubmitClient {
  const narrowed: ClerkSubmitClient = client;
  return narrowed;
}
