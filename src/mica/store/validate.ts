// ── MICA · closed-shape runtime validation for persisted records (F8) ─────────
//
// WHAT THIS IS, AND THE HOLE IT CLOSES
//
//   The three append-stores each parsed a JSON line and CAST it to the target
//   TypeScript record: `JSON.parse(line) as XRecord`. TypeScript types do not
//   validate disk input. Structurally wrong but syntactically valid JSON could
//   therefore reach array operations and throw (a SUBSTRATE_READ with a non-array
//   `factors`), or an unknown `recordType` could be processed through the wrong
//   hash branch. The existing loaders covered malformed JSON and hash breaks —
//   NOT hostile VALID JSON with wrong fields, types, or enums.
//
//   These primitives let each loader validate a parsed line against a CLOSED
//   discriminated shape BEFORE hashing or replay: reject unknown fields where the
//   canonical byte shape matters, reject unknown record types, bound integers and
//   require finite numbers, and convert every schema failure into the store's
//   typed CANNOT_VERIFY load-failure state rather than a crash or a best-effort
//   cast. Node built-ins only — no edge out of src/mica.

export type Parsed = Record<string, unknown>;

export function isObject(x: unknown): x is Parsed {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function isString(x: unknown): x is string {
  return typeof x === "string";
}

export function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/** A safe integer (finite, whole, within Number.MAX_SAFE_INTEGER). */
export function isInteger(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x);
}

/** A non-negative safe integer — for sequence numbers, byte counts, counters. */
export function isNonNegInteger(x: unknown): x is number {
  return isInteger(x) && x >= 0;
}

export function isBoolean(x: unknown): x is boolean {
  return typeof x === "boolean";
}

export function isEnum<T extends string>(
  x: unknown,
  allowed: readonly T[]
): x is T {
  return typeof x === "string" && (allowed as readonly string[]).includes(x);
}

export function isArrayOf<T>(
  x: unknown,
  each: (v: unknown) => v is T
): x is readonly T[] {
  return Array.isArray(x) && x.every((v) => each(v));
}

export function isStringArray(x: unknown): x is readonly string[] {
  return Array.isArray(x) && x.every((v) => typeof v === "string");
}

/**
 * The CLOSED-SHAPE check: the object's own keys are EXACTLY `keys`, no more and
 * no fewer. Extra fields are rejected because the canonical hash byte shape is
 * fixed — an unknown field means the record is not the shape this store writes,
 * and silently ignoring it would let a hostile record ride alongside a valid one.
 */
export function hasExactKeys(obj: Parsed, keys: readonly string[]): boolean {
  const own = Object.keys(obj);
  if (own.length !== keys.length) return false;
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) return false;
  }
  return true;
}

/** The three verdict kinds — the only values a *Kind field may hold. */
export const VERDICT_KINDS = ["ALARM", "CANNOT_ASSESS", "SILENT"] as const;
