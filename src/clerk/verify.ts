// ──────────────────────────────────────────────────────────────────────────────
// ILAS — CLERK 1: chain verification. PURE. READ-ONLY. NO REPAIR.
//
// Three outcomes, a discriminated union, never a boolean and never a nullable.
// The prior art is deliberate: MICA's VerdictKind is three-way precisely so a
// consumer cannot collapse CANNOT_ASSESS into SILENT by accident of
// representation (src/mica/types.ts). The same shape is used here so a consumer
// cannot collapse CANNOT_VERIFY into INTACT.
//
// Note what INTACT_SINCE_ARRIVAL means and does not mean. It means: these bytes
// are the bytes that arrived, in the order they arrived, and the tail is where
// the clerk said it was. It is NOT a health statement about anything, and the
// value carries a `meaning` string that says so in words — so a consumer who
// converts it into "the system is fine" is doing so against text that
// contradicts them.
//
// ORDERING NOTE. Breaks are computed and reported BEFORE blindness, because a
// break is the more specific reading: it names a violated link rather than an
// unbounded scope. Hash-link and sequence breaks need no trust anchor at all.
// ──────────────────────────────────────────────────────────────────────────────

import { GENESIS_PREV_HASH } from "./types";
import type { ClerkRecord, HeadAnchor } from "./types";
import { headPreimage, recordHash, recordPreimage } from "./preimage";
import { publicKeyFromB64, verifySignature } from "./signature";
import type { StoreRead } from "./read-store";

/** Where the reader got the key it checked signatures against. */
export type TrustAnchor =
  /** Supplied by the operator from outside this store. The only real anchor. */
  | "OUT_OF_BAND"
  /**
   * Taken from clerk.pub inside the store being verified. This checks
   * self-consistency, NOT authorship: anyone able to rewrite the store can
   * re-sign it with their own key and update clerk.pub to match.
   */
  | "FROM_STORE"
  | "NONE";

export type BreakClass =
  | "MALFORMED_LINE"
  | "SEQ_DISCONTINUITY"
  | "PREV_HASH_MISMATCH"
  | "RECEIPT_HASH_MISMATCH"
  | "SIGNATURE_INVALID"
  | "TAIL_TRUNCATED"
  | "HEAD_ANCHOR_MISMATCH"
  | "HEAD_ANCHOR_SIGNATURE_INVALID";

export interface ChainBreak {
  class: BreakClass;
  /** Index into the parsed record list, or null when the break is store-level. */
  index: number | null;
  clerk_seq: number | null;
  detail: string;
}

export type VerifyBlindClass =
  | "STORE_BLIND"
  | "NO_TRUST_ANCHOR"
  | "TRUST_ANCHOR_FROM_STORE"
  | "HEAD_ANCHOR_ABSENT"
  | "EMPTY_CHAIN";

export interface VerifyBlind {
  class: VerifyBlindClass;
  detail: string;
  /** The cheap exit, when there is one. T1's shape: fail closed, exit stated. */
  exit: string | null;
}

export interface VerifyCounts {
  recordsParsed: number;
  malformedLines: number;
  linksChecked: number;
  signaturesChecked: number;
  firstSeq: number | null;
  lastSeq: number | null;
}

export interface BreakFound {
  kind: "BREAK_FOUND";
  dir: string;
  trustAnchor: TrustAnchor;
  counts: VerifyCounts;
  breaks: readonly ChainBreak[];
  meaning: string;
}

export interface IntactSinceArrival {
  kind: "INTACT_SINCE_ARRIVAL";
  dir: string;
  trustAnchor: "OUT_OF_BAND";
  counts: VerifyCounts;
  head: HeadAnchor;
  meaning: string;
}

export interface CannotVerify {
  kind: "CANNOT_VERIFY";
  dir: string;
  trustAnchor: TrustAnchor;
  counts: VerifyCounts;
  blind: readonly VerifyBlind[];
  /**
   * What DID hold, reported as detail and never as a result. Present so a
   * forensic reader is not left with nothing; typed under CANNOT_VERIFY so it
   * cannot be quoted as a clean verification.
   */
  selfConsistency: {
    linksHeld: boolean;
    signaturesHeld: boolean | null;
    headAnchorHeld: boolean | null;
  };
  meaning: string;
}

export type ChainVerification = BreakFound | IntactSinceArrival | CannotVerify;

export const INTACT_IS_NOT_HEALTH =
  "INTACT_SINCE_ARRIVAL means the stored bytes are the bytes that arrived, in " +
  "the order they arrived, with the tail where the clerk said it was. It is " +
  "NOT a statement of health, and NOT a statement that any payload is true. A " +
  "system that lies in real time produces a perfectly intact chain of lies.";

export interface VerifyOptions {
  /** base64 SPKI DER. Omit to verify without a trust anchor. */
  publicKeyB64?: string | null;
  /** How the caller came by that key. Required when a key is supplied. */
  trustAnchor?: TrustAnchor;
}

function emptyCounts(): VerifyCounts {
  return {
    recordsParsed: 0,
    malformedLines: 0,
    linksChecked: 0,
    signaturesChecked: 0,
    firstSeq: null,
    lastSeq: null,
  };
}

export function verifyChain(
  store: StoreRead,
  options: VerifyOptions = {}
): ChainVerification {
  const anchorGiven = options.publicKeyB64 ?? null;
  const trustAnchor: TrustAnchor =
    anchorGiven === null ? "NONE" : options.trustAnchor ?? "FROM_STORE";

  if (store.kind === "STORE_BLIND") {
    return {
      kind: "CANNOT_VERIFY",
      dir: store.dir,
      trustAnchor,
      counts: emptyCounts(),
      blind: [
        {
          class: "STORE_BLIND",
          detail: `${store.reason}: ${store.detail}`,
          exit:
            store.reason === "STORE_DIR_ABSENT"
              ? "Point --store at the configured location, or restore it from wherever the deployment keeps it."
              : null,
        },
      ],
      selfConsistency: {
        linksHeld: false,
        signaturesHeld: null,
        headAnchorHeld: null,
      },
      meaning:
        "No reading was made. This is not silence and it is not a clean result.",
    };
  }

  const records: readonly ClerkRecord[] = store.records;
  const breaks: ChainBreak[] = [];
  const counts: VerifyCounts = {
    recordsParsed: records.length,
    malformedLines: store.malformed.length,
    linksChecked: 0,
    signaturesChecked: 0,
    firstSeq: records.length > 0 ? records[0].clerk_seq : null,
    lastSeq: records.length > 0 ? records[records.length - 1].clerk_seq : null,
  };

  for (const m of store.malformed) {
    breaks.push({
      class: "MALFORMED_LINE",
      index: null,
      clerk_seq: null,
      detail: `receipts.jsonl line ${m.line}: ${m.reason} — ${m.excerpt}`,
    });
  }

  let publicKey = null as ReturnType<typeof publicKeyFromB64> | null;
  if (anchorGiven !== null) {
    try {
      publicKey = publicKeyFromB64(anchorGiven);
    } catch (err) {
      publicKey = null;
      breaks.push({
        class: "SIGNATURE_INVALID",
        index: null,
        clerk_seq: null,
        detail: `supplied public key is unusable: ${String(err)}`,
      });
    }
  }

  // ── the chain itself ───────────────────────────────────────────────────────
  let expectedPrev = GENESIS_PREV_HASH;
  let expectedSeq = 0;
  let linksHeld = true;
  let signaturesHeld: boolean | null = publicKey === null ? null : true;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];

    if (r.clerk_seq !== expectedSeq) {
      linksHeld = false;
      breaks.push({
        class: "SEQ_DISCONTINUITY",
        index: i,
        clerk_seq: r.clerk_seq,
        detail:
          `expected clerk_seq ${expectedSeq}, found ${r.clerk_seq}. ` +
          (r.clerk_seq > expectedSeq
            ? `${r.clerk_seq - expectedSeq} record(s) are missing from the store.`
            : `the sequence went backwards; records were reordered or duplicated.`),
      });
      // Continue from what is actually here, so later independent breaks are
      // still reported rather than cascading from this one.
      expectedSeq = r.clerk_seq;
    }

    if (r.prev_receipt_hash !== expectedPrev) {
      linksHeld = false;
      breaks.push({
        class: "PREV_HASH_MISMATCH",
        index: i,
        clerk_seq: r.clerk_seq,
        detail:
          `prev_receipt_hash is ${r.prev_receipt_hash.slice(0, 16)}… but the ` +
          `preceding record in this store hashes to ${expectedPrev.slice(0, 16)}…`,
      });
    }

    const recomputed = recordHash(r);
    if (recomputed !== r.receipt_hash) {
      linksHeld = false;
      breaks.push({
        class: "RECEIPT_HASH_MISMATCH",
        index: i,
        clerk_seq: r.clerk_seq,
        detail:
          `stored receipt_hash ${r.receipt_hash.slice(0, 16)}… does not match ` +
          `the hash of the record's own contents (${recomputed.slice(0, 16)}…). ` +
          `This record was edited after it was written.`,
      });
    }
    counts.linksChecked++;

    if (publicKey !== null) {
      const ok = verifySignature(recordPreimage(r), r.signature, publicKey);
      counts.signaturesChecked++;
      if (!ok) {
        signaturesHeld = false;
        breaks.push({
          class: "SIGNATURE_INVALID",
          index: i,
          clerk_seq: r.clerk_seq,
          detail:
            `signature does not verify against the supplied public key ` +
            `(trust anchor: ${trustAnchor}).`,
        });
      }
    }

    expectedPrev = r.receipt_hash;
    expectedSeq = r.clerk_seq + 1;
  }

  // ── the head anchor: the only thing that catches tail truncation ───────────
  let headAnchorHeld: boolean | null = null;
  const head = store.head;
  if (head !== null) {
    headAnchorHeld = true;

    if (publicKey !== null) {
      const ok = verifySignature(headPreimage(head), head.signature, publicKey);
      if (!ok) {
        headAnchorHeld = false;
        breaks.push({
          class: "HEAD_ANCHOR_SIGNATURE_INVALID",
          index: null,
          clerk_seq: head.clerk_seq,
          detail:
            "head.json signature does not verify. The tail statement was " +
            "written or altered by something that does not hold the clerk's key.",
        });
      }
    }

    const last = records.length > 0 ? records[records.length - 1] : null;
    if (last === null || last.clerk_seq < head.clerk_seq) {
      headAnchorHeld = false;
      breaks.push({
        class: "TAIL_TRUNCATED",
        index: null,
        clerk_seq: head.clerk_seq,
        detail:
          `head.json states the chain reached clerk_seq ${head.clerk_seq} ` +
          `(${head.record_count} records); the store ends at ` +
          `${last === null ? "no records at all" : `clerk_seq ${last.clerk_seq}`}. ` +
          `Records were removed from the end of the chain.`,
      });
    } else if (last.clerk_seq === head.clerk_seq && last.receipt_hash !== head.receipt_hash) {
      headAnchorHeld = false;
      breaks.push({
        class: "HEAD_ANCHOR_MISMATCH",
        index: null,
        clerk_seq: head.clerk_seq,
        detail:
          `head.json records tail hash ${head.receipt_hash.slice(0, 16)}… but ` +
          `the record at that sequence hashes to ${last.receipt_hash.slice(0, 16)}…`,
      });
    }
  }

  if (breaks.length > 0) {
    return {
      kind: "BREAK_FOUND",
      dir: store.dir,
      trustAnchor,
      counts,
      breaks,
      meaning:
        "The stored record contradicts itself or contradicts the clerk's signed " +
        "tail statement. Something was removed, reordered, edited, or written " +
        "by a party that does not hold the clerk's key. This finding is about " +
        "the RECORD, not about the health of the observed system.",
    };
  }

  const blind: VerifyBlind[] = [];

  if (publicKey === null) {
    blind.push({
      class: "NO_TRUST_ANCHOR",
      detail:
        "No public key was supplied, so no signature was checked. Hash links " +
        "hold, but hash links alone are reproducible by anyone who can rewrite " +
        "the whole file.",
      exit: "Supply the clerk's public key: --pubkey <path or base64>.",
    });
  } else if (trustAnchor === "FROM_STORE") {
    blind.push({
      class: "TRUST_ANCHOR_FROM_STORE",
      detail:
        "Signatures were checked against clerk.pub taken from the store being " +
        "verified. That establishes self-consistency, not authorship: a party " +
        "able to rewrite the store can re-sign every record with its own key " +
        "and replace clerk.pub to match, and this check would still pass.",
      exit:
        "Supply the clerk's public key from outside this store: --pubkey <path or base64>.",
    });
  }

  if (head === null) {
    blind.push({
      class: "HEAD_ANCHOR_ABSENT",
      detail:
        (store.headProblem ?? "head.json is absent or unusable.") +
        " Without it, removal of records from the END of the chain cannot be " +
        "excluded: a truncated hash chain verifies perfectly as a shorter chain.",
      exit: "Keep head.json alongside receipts.jsonl; the clerk rewrites it after every record.",
    });
  }

  if (records.length === 0) {
    blind.push({
      class: "EMPTY_CHAIN",
      detail: "No records. There is nothing to be intact.",
      exit: null,
    });
  }

  if (blind.length > 0) {
    return {
      kind: "CANNOT_VERIFY",
      dir: store.dir,
      trustAnchor,
      counts,
      blind,
      selfConsistency: { linksHeld, signaturesHeld, headAnchorHeld },
      meaning:
        "No verification was reached. This is NOT a clean result and NOT " +
        "silence — it is a stated inability to check, with its cause typed.",
    };
  }

  return {
    kind: "INTACT_SINCE_ARRIVAL",
    dir: store.dir,
    trustAnchor: "OUT_OF_BAND",
    counts,
    head: head as HeadAnchor,
    meaning: INTACT_IS_NOT_HEALTH,
  };
}

/** Human-readable render. Every kind prints its own distinct banner. */
export function renderVerification(v: ChainVerification): string {
  const out: string[] = [];
  out.push(`CHAIN: ${v.kind}`);
  out.push(`  store        : ${v.dir}`);
  out.push(`  trust anchor : ${v.trustAnchor}`);
  out.push(
    `  records      : ${v.counts.recordsParsed} parsed, ` +
      `${v.counts.malformedLines} malformed, ` +
      `${v.counts.linksChecked} links checked, ` +
      `${v.counts.signaturesChecked} signatures checked`
  );
  if (v.kind === "BREAK_FOUND") {
    for (const b of v.breaks) {
      const where =
        b.clerk_seq === null ? "store-level" : `clerk_seq ${b.clerk_seq}`;
      out.push(`  · BREAK ${b.class} [${where}]: ${b.detail}`);
    }
  }
  if (v.kind === "CANNOT_VERIFY") {
    for (const b of v.blind) {
      out.push(`  · BLIND ${b.class}: ${b.detail}`);
      if (b.exit !== null) out.push(`      exit: ${b.exit}`);
    }
    out.push(
      `  · what did hold (detail, not a result): links=${v.selfConsistency.linksHeld}` +
        ` signatures=${String(v.selfConsistency.signaturesHeld)}` +
        ` head_anchor=${String(v.selfConsistency.headAnchorHeld)}`
    );
  }
  out.push(`  meaning      : ${v.meaning}`);
  return out.join("\n");
}
