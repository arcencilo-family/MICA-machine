// ──────────────────────────────────────────────────────────────────────────────
// ILAS — CLERK 1: canonicalisation. THE COPY, NOT THE REFERENCE.
//
// This file exists to kill one specific, measured defect.
//
//   ILAS-TYPED-FIELD-AUTHORSHIP-CENSUS.md §7.4: `parameters` is stored BY
//   REFERENCE (l0/index.ts:254), with no clone and no freeze anywhere in src/.
//   A submitter that retains its handle is holding a live write handle into a
//   hashed payload: it can invalidate verify() for the whole chain after the
//   fact, or supply a getter that makes the payload non-deterministic at hash
//   time.
//
// The defect dies HERE, at the clerk's boundary, and nowhere else — the census
// fence is explicit that it is not to be chased around the rest of the tree.
// After canonicalise() returns, the submitter's object graph is not reachable
// from anything the clerk stores: what the clerk holds is a string.
//
// Determinism rules, stated so they can be attacked:
//   · object keys sorted by code unit, so key insertion order cannot change the
//     commitment
//   · every property read EXACTLY ONCE — a hostile getter or toJSON gets one
//     turn, and the string is the snapshot of that turn
//   · non-finite numbers, bigint, symbol, function REJECTED rather than coerced
//   · `undefined` object properties dropped (JSON semantics), `undefined` in an
//     array REJECTED rather than silently becoming null
//   · cycles rejected; depth bounded
//
// This file is Object A (infrastructure). It emits no findings.
// ──────────────────────────────────────────────────────────────────────────────

import { createHash } from "crypto";

export const CANONICAL_FORM = "ILAS-CANON-JSON-1";

/** Bounds a hostile submission before it reaches the recursion. */
export const DEFAULT_MAX_DEPTH = 64;

export class CanonicalisationError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${message} (at ${path || "<root>"})`);
    this.name = "CanonicalisationError";
  }
}

function quote(s: string): string {
  // JSON.stringify on a string is already the canonical minimal escaping.
  return JSON.stringify(s);
}

function canonicalNumber(n: number, path: string): string {
  if (!Number.isFinite(n)) {
    throw new CanonicalisationError(
      `non-finite number (${String(n)}) cannot be committed to`,
      path
    );
  }
  // JSON.stringify(-0) === "0"; that collapse is intended and deterministic.
  return JSON.stringify(n);
}

function walk(
  value: unknown,
  path: string,
  depth: number,
  maxDepth: number,
  seen: Set<object>
): string {
  if (depth > maxDepth) {
    throw new CanonicalisationError(
      `structure deeper than ${maxDepth} levels`,
      path
    );
  }

  if (value === null) return "null";

  const t = typeof value;

  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") return canonicalNumber(value as number, path);
  if (t === "string") return quote(value as string);

  if (t === "undefined") {
    throw new CanonicalisationError("undefined cannot be committed to", path);
  }
  if (t === "bigint") {
    throw new CanonicalisationError(
      "bigint cannot be committed to (no canonical JSON form)",
      path
    );
  }
  if (t === "symbol") {
    throw new CanonicalisationError("symbol cannot be committed to", path);
  }
  if (t === "function") {
    throw new CanonicalisationError("function cannot be committed to", path);
  }

  const obj = value as object;

  if (seen.has(obj)) {
    throw new CanonicalisationError("cyclic reference", path);
  }

  // toJSON gets exactly one turn, and its result is the thing committed to.
  // (This is what makes a Date work and a hostile toJSON harmless: whatever it
  // returns on that single call is what the commitment is over.)
  const maybe = obj as { toJSON?: unknown };
  if (typeof maybe.toJSON === "function") {
    const replaced = (maybe.toJSON as () => unknown).call(obj);
    if (replaced === obj) {
      throw new CanonicalisationError("toJSON returned the object itself", path);
    }
    seen.add(obj);
    try {
      return walk(replaced, path, depth, maxDepth, seen);
    } finally {
      seen.delete(obj);
    }
  }

  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const parts: string[] = [];
      for (let i = 0; i < obj.length; i++) {
        const item = obj[i];
        if (item === undefined) {
          // JSON.stringify would silently emit null here. Refuse instead: a
          // hole in an array is not the same fact as a null in an array.
          throw new CanonicalisationError(
            "undefined element in array (would be silently coerced to null)",
            `${path}[${i}]`
          );
        }
        parts.push(walk(item, `${path}[${i}]`, depth + 1, maxDepth, seen));
      }
      return `[${parts.join(",")}]`;
    }

    // Own enumerable string keys only, sorted. Prototype getters are not read.
    const record = obj as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const child = record[k]; // read exactly once
      if (child === undefined) continue; // JSON semantics: the property is absent
      parts.push(
        `${quote(k)}:${walk(child, `${path}.${k}`, depth + 1, maxDepth, seen)}`
      );
    }
    return `{${parts.join(",")}}`;
  } finally {
    seen.delete(obj);
  }
}

/**
 * Serialise `value` to canonical bytes. THE RETURN VALUE IS A COPY: no part of
 * the caller's object graph is reachable from it, and later mutation of the
 * caller's object cannot change it.
 */
export function canonicalise(
  value: unknown,
  maxDepth: number = DEFAULT_MAX_DEPTH
): string {
  return walk(value, "", 0, maxDepth, new Set<object>());
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Canonical bytes plus their commitment, in one pass. */
export function commit(
  value: unknown,
  maxDepth: number = DEFAULT_MAX_DEPTH
): { canonical: string; commitment: string; bytes: number } {
  const canonical = canonicalise(value, maxDepth);
  return {
    canonical,
    commitment: sha256Hex(canonical),
    bytes: Buffer.byteLength(canonical, "utf8"),
  };
}
