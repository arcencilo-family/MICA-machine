// ── MICA · the seeing witness's INTAKE — the pointer contract, reader side ────
//
// The bridge is the only writer of this intake (deployment: a directory the
// witness owns, group-writable by the bridge's group alone, never by the
// subject's uid). It drops TWO kinds of pointer per act, each one JSON object in
// its own file, written temp-then-rename so a dot-named file is in flight and is
// never read (the drop committer's framing rule, S86):
//
//   ATTEMPT — after the act's TOOL_ATTEMPTED persisted (not a duplicate), at the
//             bridge's interest-label site. Carries the PLAIN canonical target:
//             "the plain target to the witness only" (audit 18:03Z (4)). It never
//             enters MICA's chain or this witness's book; the witness keeps it in
//             its own private state, as the caller's outbox already does.
//   CLOSE   — after the act's ACT_CLOSED persisted. Carries no target. Carries the
//             act's FATE for the outcome: the /guard decision's execute flag and
//             hash (`guard`), or null when the bridge holds none; and `unguarded`,
//             true when the caller recorded the act as executed without a /guard
//             answer. Phase R anchors on NOTHING here (audit 2026-10-11 09:32Z):
//             no receipt, no monotonic stamp — the witness takes one look at the
//             close and compares it to its own last look, not to this act.
//
// THE ACT'S KEY is (subject, chain, the ATTEMPT's subjectSeq): the bridge MINTS
// the number, one per persisted act — but a ROTATED subject chain starts its
// numbers again, so the chain's identity (its position-0 record's hash) is part of
// the key (refuter R2-bytes F3). The caller chooses its sessionId and actionId,
// and two acts may share both halves of a narrower key (refuters A-F7, B M1).
//
// THE FORMAT IS A CONTRACT WITH TWO COPIES, ON PURPOSE (the drop committer's
// rule): the bridge's writer and this reader each pin it with their own
// fixtures, and a drop of any other shape is QUARANTINED here, never repaired.

export const POINTER_VERSION = 1;

const IDENT = /^[A-Za-z0-9._:@-]{1,200}$/;
const DERIVATION = /^INTEREST_LABEL@[0-9a-f]{16}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export interface AttemptPointer {
  readonly v: 1;
  readonly kind: "ATTEMPT";
  readonly subject: string;
  readonly sessionId: string;
  readonly actionId: string;
  /** The subject chain's identity — its position-0 record's hash — or null when the bridge holds none. */
  readonly chain: string | null;
  /** The bridge-minted position of the act's TOOL_ATTEMPTED on that chain — with `chain`, the act's key. */
  readonly subjectSeq: number;
  /** The bridge's canonical form of the caller's claimed target. Absolute. */
  readonly target: string;
  /** The frame category the bridge derived for it (never UNDERIVED: no pointer is sent then). */
  readonly label: string;
  /** Gate 1's derivation class that placed it (INTEREST_LABEL@<16 hex>). */
  readonly derivationClass: string;
  /** The bridge's salted fingerprint of the target, or null when it had no salt epoch. */
  readonly targetFingerprint: string | null;
  /** The bridge's wall clock when it dropped the pointer, ms (for reading). */
  readonly at: number;
}

export interface PointerGuard {
  /** The /guard decision: whether the bridge released the act, and the decision's hash (cited, never an anchor). */
  readonly execute: boolean;
  readonly decisionHash: string;
}

export interface ClosePointer {
  readonly v: 1;
  readonly kind: "CLOSE";
  readonly subject: string;
  readonly sessionId: string;
  readonly actionId: string;
  readonly chain: string | null;
  /** The ATTEMPT's subjectSeq — with `chain`, the act's key. */
  readonly attemptSeq: number;
  readonly closedSeq: number;
  readonly guard: PointerGuard | null;
  readonly unguarded: boolean;
  readonly at: number;
}

export type Pointer = AttemptPointer | ClosePointer;

function hasExactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNonNegInt = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const isTime = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;
const isChain = (x: unknown): x is string | null => x === null || (typeof x === "string" && HEX64.test(x));

/**
 * The whole validation. Returns the pointer, or a REASON (a fixed phrase, never
 * a quotation of the bytes — a quarantine note must not leak a target).
 */
export function parsePointer(bytes: string): { readonly ok: true; readonly pointer: Pointer } | { readonly ok: false; readonly reason: string } {
  let o: unknown;
  try {
    o = JSON.parse(bytes);
  } catch {
    return { ok: false, reason: "NOT_JSON" };
  }
  if (!isObj(o)) return { ok: false, reason: "NOT_AN_OBJECT" };
  if (o.v !== POINTER_VERSION) return { ok: false, reason: "UNKNOWN_VERSION" };
  if (o.kind === "ATTEMPT") {
    if (!hasExactKeys(o, ["v", "kind", "subject", "sessionId", "actionId", "chain", "subjectSeq", "target", "label", "derivationClass", "targetFingerprint", "at"])) {
      return { ok: false, reason: "ATTEMPT_KEYS" };
    }
    if (typeof o.subject !== "string" || !IDENT.test(o.subject)) return { ok: false, reason: "SUBJECT" };
    if (typeof o.sessionId !== "string" || !IDENT.test(o.sessionId)) return { ok: false, reason: "SESSION_ID" };
    if (typeof o.actionId !== "string" || !IDENT.test(o.actionId)) return { ok: false, reason: "ACTION_ID" };
    if (!isChain(o.chain)) return { ok: false, reason: "CHAIN" };
    if (!isNonNegInt(o.subjectSeq)) return { ok: false, reason: "SUBJECT_SEQ" };
    if (typeof o.target !== "string" || !o.target.startsWith("/") || o.target.includes("\u0000") || o.target.length > 4096) {
      return { ok: false, reason: "TARGET" };
    }
    if (typeof o.label !== "string" || !IDENT.test(o.label)) return { ok: false, reason: "LABEL" };
    if (typeof o.derivationClass !== "string" || !DERIVATION.test(o.derivationClass)) return { ok: false, reason: "DERIVATION_CLASS" };
    if (!(o.targetFingerprint === null || (typeof o.targetFingerprint === "string" && HEX64.test(o.targetFingerprint)))) {
      return { ok: false, reason: "TARGET_FINGERPRINT" };
    }
    if (!isTime(o.at)) return { ok: false, reason: "AT" };
    return { ok: true, pointer: o as unknown as AttemptPointer };
  }
  if (o.kind === "CLOSE") {
    if (!hasExactKeys(o, ["v", "kind", "subject", "sessionId", "actionId", "chain", "attemptSeq", "closedSeq", "guard", "unguarded", "at"])) {
      return { ok: false, reason: "CLOSE_KEYS" };
    }
    if (typeof o.subject !== "string" || !IDENT.test(o.subject)) return { ok: false, reason: "SUBJECT" };
    if (typeof o.sessionId !== "string" || !IDENT.test(o.sessionId)) return { ok: false, reason: "SESSION_ID" };
    if (typeof o.actionId !== "string" || !IDENT.test(o.actionId)) return { ok: false, reason: "ACTION_ID" };
    if (!isChain(o.chain)) return { ok: false, reason: "CHAIN" };
    if (!isNonNegInt(o.attemptSeq)) return { ok: false, reason: "ATTEMPT_SEQ" };
    if (!isNonNegInt(o.closedSeq)) return { ok: false, reason: "CLOSED_SEQ" };
    if (o.guard !== null) {
      const g = o.guard;
      if (!isObj(g) || !hasExactKeys(g, ["execute", "decisionHash"])) return { ok: false, reason: "GUARD_KEYS" };
      if (typeof g.execute !== "boolean") return { ok: false, reason: "EXECUTE" };
      if (typeof g.decisionHash !== "string" || !HEX64.test(g.decisionHash)) return { ok: false, reason: "DECISION_HASH" };
    }
    if (typeof o.unguarded !== "boolean") return { ok: false, reason: "UNGUARDED" };
    if (!isTime(o.at)) return { ok: false, reason: "AT" };
    return { ok: true, pointer: o as unknown as ClosePointer };
  }
  return { ok: false, reason: "UNKNOWN_KIND" };
}

/** The key one act is tracked under between its ATTEMPT and its CLOSE: the subject chain and its bridge-minted seq. */
export function actKey(subject: string, chain: string | null, attemptSeq: number): string {
  return JSON.stringify([subject, chain, attemptSeq]);
}
