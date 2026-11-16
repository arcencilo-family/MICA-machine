// ──────────────────────────────────────────────────────────────────────────────
// ILAS — CLERK 1: the ONE definition of what gets hashed and signed.
//
// Writer and reader both call these. There is deliberately no second hashing
// definition anywhere in this directory: two definitions that drift is how a
// verifier comes to disagree with the thing it verifies, quietly.
// ──────────────────────────────────────────────────────────────────────────────

import { canonicalise, sha256Hex } from "./canonical";
import type { ClerkRecord, HeadAnchor, RecordFrame } from "./types";

/**
 * Everything in the record except its own hash and signature, canonicalised.
 * Key order in the stored JSON is irrelevant: canonicalise() sorts.
 */
export function recordPreimage(record: ClerkRecord | RecordFrame): string {
  const copy: Record<string, unknown> = { ...(record as object) };
  delete copy.receipt_hash;
  delete copy.signature;
  return canonicalise(copy);
}

export function recordHash(record: ClerkRecord | RecordFrame): string {
  return sha256Hex(recordPreimage(record));
}

/** Everything in the head anchor except its own signature, canonicalised. */
export function headPreimage(anchor: HeadAnchor): string {
  const copy: Record<string, unknown> = { ...anchor };
  delete copy.signature;
  return canonicalise(copy);
}
