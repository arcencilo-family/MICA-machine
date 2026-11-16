// ──────────────────────────────────────────────────────────────────────────────
// ILAS — CLERK 1: READ-ONLY store access.
//
// This file opens files for reading and never for writing. It is what the
// standalone reader uses. Keeping it separate from store.ts means the reader's
// import closure contains no code that can append to, rewrite, or repair the
// record it is reading.
//
// It reads receipts.jsonl and head.json. It does NOT open clerk.key.
// ──────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { STORE_FILES } from "./types";
import type { ClerkRecord, HeadAnchor, RecordKind } from "./types";

export interface MalformedLine {
  /** 1-indexed line number in receipts.jsonl. */
  line: number;
  reason: string;
  /** First 200 characters, so a forensic reader can see what is there. */
  excerpt: string;
}

export type StoreBlindReason =
  /** The configured directory does not exist. */
  | "STORE_DIR_ABSENT"
  /** Directory exists but neither the chain nor the anchor is present. */
  | "STORE_EMPTY"
  /** Present and could not be read (permissions, IO). */
  | "STORE_UNREADABLE";

export interface StoreReadOk {
  kind: "STORE_READ";
  dir: string;
  receiptsPath: string;
  records: readonly ClerkRecord[];
  malformed: readonly MalformedLine[];
  head: HeadAnchor | null;
  /** Why the head anchor is absent or unusable, if it is. */
  headProblem: string | null;
  /**
   * The public key found INSIDE the store. Convenience only. A reader that
   * verifies signatures against a key it took from the same store an attacker
   * could rewrite has verified self-consistency, not authorship.
   */
  storePublicKeyB64: string | null;
}

export interface StoreReadBlind {
  kind: "STORE_BLIND";
  dir: string;
  reason: StoreBlindReason;
  detail: string;
}

export type StoreRead = StoreReadOk | StoreReadBlind;

const REQUIRED_FRAME_FIELDS = [
  "receipt_version",
  "kind",
  "clerk_id",
  "clerk_boot_id",
  "separation",
  "clerk_principal",
  "intake",
  "clerk_seq",
  "clerk_time",
  "prev_receipt_hash",
  "receipt_hash",
  "signature",
] as const;

// Adding a kind is backward-compatible in one direction only: a NEW reader
// accepts an OLD store, which is what G8 requires. An old reader meeting a
// REFUSAL record will call it MALFORMED_LINE — loudly, which is the correct
// direction for that failure.
const KNOWN_KINDS: readonly RecordKind[] = [
  "BOOT",
  "CADENCE",
  "SUBMISSION",
  "GAP",
  "REFUSAL",
];

function frameProblem(v: unknown): string | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return "line is not a JSON object";
  }
  const o = v as Record<string, unknown>;
  for (const f of REQUIRED_FRAME_FIELDS) {
    if (!(f in o)) return `missing frame field \`${f}\``;
  }
  if (typeof o.clerk_seq !== "number") return "clerk_seq is not a number";
  if (!KNOWN_KINDS.includes(o.kind as RecordKind)) {
    return `unknown record kind \`${String(o.kind)}\``;
  }
  const t = o.clerk_time;
  if (typeof t !== "object" || t === null) return "clerk_time is not an object";
  const time = t as Record<string, unknown>;
  if (typeof time.wall_ms !== "number") return "clerk_time.wall_ms is not a number";
  if (typeof time.monotonic_ns !== "string") {
    return "clerk_time.monotonic_ns is not a string";
  }
  return null;
}

function readHead(dir: string): { head: HeadAnchor | null; problem: string | null } {
  const p = join(dir, STORE_FILES.head);
  if (!existsSync(p)) {
    return {
      head: null,
      problem:
        "head.json absent. The signed statement of how far the chain got is " +
        "missing, so tail truncation cannot be excluded from this store alone.",
    };
  }
  let raw: string;
  try {
    raw = readFileSync(p, "utf8");
  } catch (err) {
    return { head: null, problem: `head.json unreadable: ${String(err)}` };
  }
  try {
    const parsed = JSON.parse(raw) as HeadAnchor;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      parsed.form !== "ILAS-CLERK-HEAD-1" ||
      typeof parsed.clerk_seq !== "number" ||
      typeof parsed.receipt_hash !== "string" ||
      typeof parsed.signature !== "string"
    ) {
      return { head: null, problem: "head.json is not a well-formed head anchor" };
    }
    return { head: parsed, problem: null };
  } catch (err) {
    return { head: null, problem: `head.json is not valid JSON: ${String(err)}` };
  }
}

function readStorePublicKey(dir: string): string | null {
  const p = join(dir, STORE_FILES.publicKey);
  if (!existsSync(p)) return null;
  try {
    const s = readFileSync(p, "utf8").trim();
    return s.length > 0 ? s : null;
  } catch {
    return null;
  }
}

/** Open a clerk store for reading. Never writes, never repairs. */
export function readStore(dir: string): StoreRead {
  if (!existsSync(dir)) {
    return {
      kind: "STORE_BLIND",
      dir,
      reason: "STORE_DIR_ABSENT",
      detail:
        `No directory at ${dir}. A store that never existed and a store deleted ` +
        `wholesale are indistinguishable from here. Wholesale deletion is an ` +
        `operator action; the clerk cannot survive its own machine.`,
    };
  }

  const receiptsPath = join(dir, STORE_FILES.receipts);
  const headResult = readHead(dir);
  const receiptsExist = existsSync(receiptsPath);

  if (!receiptsExist && headResult.head === null) {
    return {
      kind: "STORE_BLIND",
      dir,
      reason: "STORE_EMPTY",
      detail:
        `Directory ${dir} exists but holds neither ${STORE_FILES.receipts} nor a ` +
        `usable ${STORE_FILES.head}. Nothing to read.`,
    };
  }

  let raw = "";
  if (receiptsExist) {
    try {
      statSync(receiptsPath);
      raw = readFileSync(receiptsPath, "utf8");
    } catch (err) {
      return {
        kind: "STORE_BLIND",
        dir,
        reason: "STORE_UNREADABLE",
        detail: `${receiptsPath} present but unreadable: ${String(err)}`,
      };
    }
  }

  const records: ClerkRecord[] = [];
  const malformed: MalformedLine[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      malformed.push({
        line: i + 1,
        reason: `not valid JSON: ${String(err)}`,
        excerpt: line.slice(0, 200),
      });
      continue;
    }
    const problem = frameProblem(parsed);
    if (problem !== null) {
      malformed.push({ line: i + 1, reason: problem, excerpt: line.slice(0, 200) });
      continue;
    }
    records.push(parsed as ClerkRecord);
  }

  return {
    kind: "STORE_READ",
    dir,
    receiptsPath,
    records,
    malformed,
    head: headResult.head,
    headProblem: headResult.problem,
    storePublicKeyB64: readStorePublicKey(dir),
  };
}
