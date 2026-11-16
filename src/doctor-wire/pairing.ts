// ── MICA · doctor wire — the pairing reader ──────────────────────────────────
//
// For each raising in the notice book, in sequence order: the replies on record
// by role, or "no reply on record". A reply pairs with a raising only when BOTH
// its answersSequenceNumber and its answersHash match that record; a reply that
// matches no raising is printed apart, never dropped.
//
// WHAT IT CANNOT SAY
//
//   A reply recorded is not a reading, an agreement or a remedy, and no reply on
//   record is not a finding that nobody acted. Neither book authors time, and no
//   witness arrival stamp is joined to either here, so this reader prints no
//   wall-clock time at all — order is by sequence only. It judges no adequacy
//   and knows no deadline.

import type { NoticeLogRecord } from "../mica/notify";
import type { ReplyRecord } from "./reply-book";

export interface PairedRaising {
  readonly raising: NoticeLogRecord;
  /** In reply-book sequence order. */
  readonly replies: readonly ReplyRecord[];
}

export interface Pairing {
  /** In notice-book sequence order. */
  readonly raisings: readonly PairedRaising[];
  /** Replies whose (sequenceNumber, hash) pair names no raising in this book. */
  readonly unpaired: readonly ReplyRecord[];
}

export function pairReplies(
  notices: readonly NoticeLogRecord[],
  replies: readonly ReplyRecord[]
): Pairing {
  const raisings = [...notices].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const ordered = [...replies].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const unpaired: ReplyRecord[] = [];
  const byRaising = new Map<number, ReplyRecord[]>();
  for (const reply of ordered) {
    const match = raisings.find(
      (r) => r.sequenceNumber === reply.answersSequenceNumber && r.hash === reply.answersHash
    );
    if (match === undefined) {
      unpaired.push(reply);
      continue;
    }
    const list = byRaising.get(match.sequenceNumber) ?? [];
    list.push(reply);
    byRaising.set(match.sequenceNumber, list);
  }
  return {
    raisings: raisings.map((raising) => ({
      raising,
      replies: byRaising.get(raising.sequenceNumber) ?? [],
    })),
    unpaired,
  };
}

export const PAIRING_CEILING_LINES: readonly string[] = [
  "A reply recorded is not a statement that anyone read, knew or agreed, and no reply on record is not a finding that nobody acted.",
  "Order is by sequence only: neither book authors time, and no witness arrival stamp is joined here, so no wall-clock time is printed.",
  "No timer, no deadline, no adequacy judgement: this reader asks for nothing and waits for nothing.",
];

function shortHash(hash: string): string {
  return hash.slice(0, 16);
}

export function renderPairing(pairing: Pairing): string[] {
  const out: string[] = [];
  if (pairing.raisings.length === 0) out.push("no raising on record in the notice book");
  for (const { raising, replies } of pairing.raisings) {
    const head =
      `raising seq ${String(raising.sequenceNumber)} (hash ${shortHash(raising.hash)}…) ` +
      `${raising.sourceId} ${raising.kind}: `;
    if (replies.length === 0) {
      out.push(head + "no reply on record");
    } else {
      const parts = replies.map(
        (r) => `${r.role} (reply seq ${String(r.sequenceNumber)})`
      );
      out.push(head + `reply recorded — ${parts.join(", ")}`);
    }
  }
  for (const reply of pairing.unpaired) {
    out.push(
      `reply seq ${String(reply.sequenceNumber)} (${reply.role}) names raising seq ` +
        `${String(reply.answersSequenceNumber)} hash ${shortHash(reply.answersHash)}…, ` +
        "which is not in this notice book"
    );
  }
  out.push(...PAIRING_CEILING_LINES);
  return out;
}
