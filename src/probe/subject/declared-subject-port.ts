// ── MICA · the DECLARED subject port — it carries a human's reading, it grades ─
//    nothing ────────────────────────────────────────────────────────────────
//
// S119 pilot, deliverable 3.2 (ARC_MICA-BRIEF_S119-Pilot-Runner_20260909).
//
// WHAT THIS IS. A `SubjectPort` (delivery.ts §1.1, SYNC, unchanged) whose
// `deliver` returns the `ObservableChecks` that a HUMAN — the declaring
// principal — wrote down after reading a capture. Wiring it into
// `deliverAndRecord` puts those observables into `EvidenceLogStore` through
// the ordinary path, which is the pilot's whole point: the first live evidence
// append, with an honest basis attached.
//
// ── THE PORT DOES NOT CHECK THE DECLARATION AGAINST ANYTHING (brief §1) `[LB]` ─
//
//   Grader in code stays NOBODY. This module validates exactly two things, and
//   neither is a judgment about the subject:
//
//     1. SHAPE — the entry is well-formed and its `observables` pass
//        `validateObservableChecks`, REUSED from scenario.ts and not
//        re-implemented here. A declaration file with prose where the
//        observables belong is refused by that function, not by a parser of
//        this module's own.
//     2. BINDING — `captureSha256` names a line that is actually in the
//        captures file, and that line is the SAME (scenarioId, variant, seed)
//        the entry claims to grade.
//
//   It never asks whether the human read the capture correctly. It cannot: the
//   basis is TRANSCRIPT_DECLARED_BY_HUMAN and there is nothing else on this
//   path to check against. A module that second-guessed the declaration would
//   be a grader in code wearing a validator's coat.
//
// ── WHY BINDING IS A HASH OF THE WHOLE CAPTURE LINE ─────────────────────────
//
//   `captureSha256` is sha256 over the captures file's LINE, exactly as
//   written, newline excluded. Not over the payload — `payloadSha256` already
//   identifies the QUESTION, and the brief binds the declaration "to the reply
//   it grades." The reply lives in the line, so the line is what is hashed.
//
//   The consequence worth stating: if a capture is ever re-run, the new line
//   hashes differently and every declaration bound to the old one stops
//   resolving. That is the intended behaviour. A declaration is a reading of
//   ONE reply, and silently carrying it onto a different reply is exactly the
//   drift this binding exists to make impossible.
//
// ── NO DEFAULTS, AND `CANNOT_ASSESS` IS NOT THIS MODULE'S WORD ──────────────
//
//   A scenario with no declaration makes `deliver` THROW, typed. It does not
//   return `undefined`, and it does not return a CANNOT_ASSESS-shaped
//   observable set. `CANNOT_ASSESS` is the harness's reading of an absent or
//   unusable capture (checks.ts / routing.ts decide it); a port that minted it
//   would be pre-empting a judgment that belongs one layer up, and
//   `delivery.ts` already has a word for a port that throws — REFUSED.
//
//   Nothing in this file writes. It reads two files at construction and holds
//   them in memory; `deliver` touches no disk at all.

import { createHash } from "crypto";
import { readFileSync } from "fs";

import type { DeclaredCapture, DeclaredCaptureSource, SubjectPort } from "../delivery";
import { validateObservableChecks, type ObservableChecks } from "../scenario";
import { VARIANTS, type Variant } from "./variant";

/** One human reading of one captured reply. */
export interface ObservableDeclaration {
  readonly scenarioId: string;
  readonly variant: Variant;
  readonly seed: number;
  /** sha256 of the captures-file LINE this reading was made from. */
  readonly captureSha256: string;
  readonly observables: ObservableChecks;
  readonly declaredBy: string;
  readonly declaredAt: string;
}

export const OBSERVABLE_DECLARATION_KEYS: readonly string[] = [
  "scenarioId",
  "variant",
  "seed",
  "captureSha256",
  "observables",
  "declaredBy",
  "declaredAt",
];

/**
 * `replyText` is the ONE tolerated extra key, and it is NEVER READ by anything
 * in this module — not by the parser, not by `deliver`, not by the binding
 * check. It exists because the 3.3 template writes the captured reply beside
 * the slot a human has to fill (brief §3.3), and the alternative was requiring
 * that human to DELETE a field from every entry before the file could be
 * ingested — friction whose only product is a new way to ruin a file that took
 * an afternoon to write.
 *
 * It is tolerated rather than validated on purpose: it is an aid to a reader,
 * not evidence. The binding that actually matters is `captureSha256`, which is
 * checked against the captures file; if `replyText` were edited, corrupted, or
 * deleted, nothing about what this port returns would change.
 */
export const OBSERVABLE_DECLARATION_AID_KEYS: readonly string[] = ["replyText"];

export class DeclaredSubjectPortRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeclaredSubjectPortRefused";
  }
}

/** sha256 of one captures-file line, exactly as written, newline excluded. */
export function captureLineSha256(lineText: string): string {
  return createHash("sha256").update(lineText, "utf8").digest("hex");
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function hasExactKeys(o: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(o).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((k, i) => k === wanted[i]);
}

function entryKey(scenarioId: string, variant: Variant, seed: number): string {
  return [scenarioId, variant, String(seed)].join(" ");
}

/** What the captures file says about one line: which call it was, and its hash. */
interface CaptureIndexEntry {
  readonly scenarioId: string;
  readonly variant: string;
  readonly seed: number;
}

function indexCaptures(capturesPath: string): ReadonlyMap<string, CaptureIndexEntry> {
  let text: string;
  try {
    text = readFileSync(capturesPath, "utf8");
  } catch (err) {
    throw new DeclaredSubjectPortRefused(
      `refused: cannot read the captures file at ${capturesPath}: ` +
        `${err instanceof Error ? err.message : String(err)}`
    );
  }
  const byHash = new Map<string, CaptureIndexEntry>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new DeclaredSubjectPortRefused(
        `refused: ${capturesPath} line ${String(i + 1)} is not valid JSON — a declaration ` +
          `cannot be bound against a captures file this module cannot read whole.`
      );
    }
    if (!isObject(parsed)) {
      throw new DeclaredSubjectPortRefused(
        `refused: ${capturesPath} line ${String(i + 1)} is not an object.`
      );
    }
    const { scenarioId, variant, seed } = parsed;
    if (typeof scenarioId !== "string" || typeof variant !== "string" || typeof seed !== "number") {
      throw new DeclaredSubjectPortRefused(
        `refused: ${capturesPath} line ${String(i + 1)} does not identify a call ` +
          `(scenarioId, variant, seed).`
      );
    }
    byHash.set(captureLineSha256(line), { scenarioId, variant, seed });
  }
  return byHash;
}

/**
 * Parse one entry. REFUSES on shape; never coerces, never defaults. The
 * observables go through `validateObservableChecks` — scenario.ts's function,
 * reused — so "prose where the observables belong" is refused by the same
 * validator every other path in this repo uses.
 */
export function parseObservableDeclaration(raw: unknown, where: string): ObservableDeclaration {
  if (!isObject(raw)) {
    throw new DeclaredSubjectPortRefused(`refused: ${where} is not a JSON object.`);
  }
  const actualKeys = Object.keys(raw).sort();
  const missing = OBSERVABLE_DECLARATION_KEYS.filter((k) => !actualKeys.includes(k));
  const extra = actualKeys.filter(
    (k) =>
      !OBSERVABLE_DECLARATION_KEYS.includes(k) && !OBSERVABLE_DECLARATION_AID_KEYS.includes(k)
  );
  if (missing.length > 0 || extra.length > 0) {
    throw new DeclaredSubjectPortRefused(
      `refused: ${where} key set is wrong. missing: [${missing.join(", ")}]; ` +
        `unexpected: [${extra.join(", ")}]. (Tolerated aid keys, never read: ` +
        `${OBSERVABLE_DECLARATION_AID_KEYS.join(", ")}.)`
    );
  }
  const { scenarioId, variant, seed, captureSha256, observables, declaredBy, declaredAt } = raw;
  if (typeof scenarioId !== "string" || scenarioId.trim() === "") {
    throw new DeclaredSubjectPortRefused(`refused: ${where}.scenarioId must be a non-empty string.`);
  }
  if (typeof variant !== "string" || !(VARIANTS as readonly string[]).includes(variant)) {
    throw new DeclaredSubjectPortRefused(
      `refused: ${where}.variant must be one of ${VARIANTS.join(", ")}, got ${JSON.stringify(variant)}.`
    );
  }
  if (typeof seed !== "number" || !Number.isFinite(seed)) {
    throw new DeclaredSubjectPortRefused(`refused: ${where}.seed must be a finite number.`);
  }
  if (typeof captureSha256 !== "string" || !/^[0-9a-f]{64}$/.test(captureSha256)) {
    throw new DeclaredSubjectPortRefused(
      `refused: ${where}.captureSha256 must be 64 lowercase hex characters, got ` +
        `${JSON.stringify(captureSha256)}.`
    );
  }
  if (typeof declaredBy !== "string" || declaredBy.trim() === "") {
    throw new DeclaredSubjectPortRefused(`refused: ${where}.declaredBy must name a principal.`);
  }
  if (typeof declaredAt !== "string" || Number.isNaN(Date.parse(declaredAt))) {
    throw new DeclaredSubjectPortRefused(`refused: ${where}.declaredAt must be a parseable timestamp.`);
  }
  // THE REUSED VALIDATOR. A null-filled template, or prose in place of the
  // observables, dies here — in scenario.ts's function, not in one of ours.
  if (!validateObservableChecks(observables)) {
    throw new DeclaredSubjectPortRefused(
      `refused: ${where}.observables did not validate as ObservableChecks. An unfilled template ` +
        `(nulls) and free prose are both refused here, and neither is ever coerced.`
    );
  }
  return {
    scenarioId,
    variant: variant as Variant,
    seed,
    captureSha256,
    observables,
    declaredBy,
    declaredAt,
  };
}

export interface DeclaredSubjectPortOptions {
  readonly declarationPath: string;
  readonly capturesPath: string;
  /** The port answers for exactly one (variant, seed) slice — brief §3.2. */
  readonly variant: Variant;
  readonly seed: number;
}

/**
 * A `SubjectPort` over a file of human declarations. Constructed for ONE
 * (variant, seed); `deliver` answers only for that slice, so a run cannot
 * silently mix a control reading into a stress delivery.
 */
export class DeclaredSubjectPort implements SubjectPort, DeclaredCaptureSource {
  private readonly bySlice = new Map<string, ObservableDeclaration>();
  private readonly variant: Variant;
  private readonly seed: number;
  private readonly declarationPath: string;

  constructor(options: DeclaredSubjectPortOptions) {
    this.variant = options.variant;
    this.seed = options.seed;
    this.declarationPath = options.declarationPath;

    let text: string;
    try {
      text = readFileSync(options.declarationPath, "utf8");
    } catch (err) {
      throw new DeclaredSubjectPortRefused(
        `refused: cannot read the declaration file at ${options.declarationPath}: ` +
          `${err instanceof Error ? err.message : String(err)}`
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new DeclaredSubjectPortRefused(
        `refused: the declaration file at ${options.declarationPath} is not valid JSON: ` +
          `${err instanceof Error ? err.message : String(err)}`
      );
    }
    if (!Array.isArray(raw)) {
      throw new DeclaredSubjectPortRefused(
        `refused: the declaration file at ${options.declarationPath} must be an ARRAY of entries.`
      );
    }

    const captureIndex = indexCaptures(options.capturesPath);

    for (let i = 0; i < raw.length; i++) {
      const entry = parseObservableDeclaration(raw[i], `declaration[${String(i)}]`);

      const bound = captureIndex.get(entry.captureSha256);
      if (bound === undefined) {
        throw new DeclaredSubjectPortRefused(
          `refused: declaration[${String(i)}] (${entry.scenarioId} ${entry.variant} ` +
            `seed=${String(entry.seed)}) names captureSha256 ${entry.captureSha256.slice(0, 12)} ` +
            `which is not any line in ${options.capturesPath}. A reading must be bound to the ` +
            `reply it was made from.`
        );
      }
      if (
        bound.scenarioId !== entry.scenarioId ||
        bound.variant !== entry.variant ||
        bound.seed !== entry.seed
      ) {
        throw new DeclaredSubjectPortRefused(
          `refused: declaration[${String(i)}] claims to grade ${entry.scenarioId} ` +
            `${entry.variant} seed=${String(entry.seed)}, but the capture it names is ` +
            `${bound.scenarioId} ${bound.variant} seed=${String(bound.seed)}.`
        );
      }

      if (entry.variant !== this.variant || entry.seed !== this.seed) continue;

      const key = entryKey(entry.scenarioId, entry.variant, entry.seed);
      if (this.bySlice.has(key)) {
        throw new DeclaredSubjectPortRefused(
          `refused: two declarations for ${key}. Which reading stands is not this port's to ` +
            `decide, so it decides nothing and refuses.`
        );
      }
      this.bySlice.set(key, entry);
    }
  }

  /** How many declarations this port answers for. For a caller's own banner. */
  size(): number {
    return this.bySlice.size;
  }

  /**
   * `stressorSteps` is accepted because the seam's signature carries it and is
   * DELIBERATELY UNREAD: this port carries a human's reading, keyed by the
   * scenario and the slice it was constructed for. Re-deriving the question
   * from the steps here would be a second, drifting definition of which
   * capture a declaration belongs to — the binding already lives in
   * `captureSha256`.
   */
  deliver(scenarioId: string, _stressorSteps: readonly string[]): unknown {
    const found = this.entryFor(scenarioId);
    if (found === undefined) {
      throw new DeclaredSubjectPortRefused(
        `refused: no declaration for ${entryKey(scenarioId, this.variant, this.seed)} in ` +
          `${this.declarationPath}. This port returns no default and mints no CANNOT_ASSESS — ` +
          `an absent reading is the harness's to interpret.`
      );
    }
    return found.observables;
  }

  /**
   * WHO read the capture behind `scenarioId`, WHEN, and WHICH capture line it
   * was (S120, brief §3.2). Additive: the `SubjectPort` seam is untouched, and
   * `deliverAndRecord` looks for this METHOD, never for this class.
   *
   * IT SHARES ONE LOOKUP WITH `deliver` `[LB]`. Both go through `entryFor`, so
   * "this returns a declaration for exactly the scenarios `deliver` answers
   * for" is true BY CONSTRUCTION rather than by two lookups agreeing. A second
   * key derivation here is precisely how an outcome would come to carry the
   * `declaredBy` of a reading it did not use.
   *
   * It DECLARES nothing and CHECKS nothing: the binding was verified once, at
   * construction, against the captures file. This is a read of what is already
   * held.
   */
  declarationFor(scenarioId: string): DeclaredCapture | undefined {
    const found = this.entryFor(scenarioId);
    if (found === undefined) return undefined;
    return {
      declaredBy: found.declaredBy,
      declaredAt: found.declaredAt,
      captureSha256: found.captureSha256,
    };
  }

  private entryFor(scenarioId: string): ObservableDeclaration | undefined {
    return this.bySlice.get(entryKey(scenarioId, this.variant, this.seed));
  }
}
