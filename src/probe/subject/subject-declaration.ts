// ── MICA · the SUBJECT DECLARATION — who was asked, with what, on whose word ─
//
// S119 pilot, deliverable 3.0 (ARC_MICA-BRIEF_S119-Pilot-Runner_20260909).
//
// ── THE CEILING, PRINTED RATHER THAN BURIED `[LB]` ───────────────────────────
//
//   This pilot grades the subject's WORD. S117 ruled that observables come
//   from disk/process state, never from the transcript. A bare model HAS no
//   disk or process state to read — only an agent subject (OpenClaw, later)
//   does. So every observable this pilot ever produces was DECLARED BY A HUMAN
//   who read a transcript, and `basis` says exactly that, in the declaration
//   and in every evidence record descended from it.
//
//   The field is not decoration. It is the one fact that stops a later reader
//   from mistaking this pilot's evidence for the process-grounded kind the
//   design doc is actually aiming at. `CEILING_SENTENCE` below is printed by
//   the runner's banner and quoted in the receipt, per the brief's §1.
//
// ── NO DEFAULTS, ANYWHERE, ON PURPOSE (DF's "never a partial read") ─────────
//
//   Every field is REQUIRED and the loader REFUSES a declaration missing any
//   one of them. There is no default model, no default endpoint, no default
//   seed, no default system prompt. A pilot that silently supplied its own
//   value for a field the arbiter forgot would be reporting on a subject
//   nobody declared — and the whole point of this file is that the subject
//   is a DECLARED thing, authored by a named principal at a named time.
//
//   `hasExactKeys` is deliberate rather than a subset check: an EXTRA field is
//   refused too. A declaration carrying `"temperature": 0.7` at top level
//   (where it does nothing) beside `options.temperature` is a declaration
//   whose author believed something false about what this file reads.
//
// ── THE MODEL NAME IS NEVER TYPED IN CODE (brief §3.0) ──────────────────────
//
//   Not in this file, not in the runner, not in either test. The model is a
//   string the arbiter writes into the declaration. A literal here would make
//   the repo quietly authoritative about which subject the pilot ran against,
//   which is precisely the fact the declaration exists to carry.
//
// ── WHY `thinkFlag: true` IS REFUSED AND NOT MERELY RECORDED ────────────────
//
//   The rulings in force for S119 say thinking OFF, and the brief's §5 puts a
//   think-on variant explicitly out of scope ("later, ruled as possible"). A
//   loader that accepted `true` would let a think-on run happen by editing a
//   JSON file, with no ruling and no receipt. When that variant IS ruled in,
//   this refusal is the one line to change, and the change will be visible in
//   a diff — which is the property a silent `boolean` would not have.
//
//   Note the flag does NOT stop the model reasoning: S119's timing receipt
//   (§D.4) found `think: false` relocates reasoning into `content` behind a
//   stray `</think>` rather than removing it. The runner NOTICES that and
//   records it; see `ollama-runner.ts`. This file only fixes what was asked.

import { readFileSync } from "fs";

/** The sentence the runner banner prints, verbatim, before it sends anything. */
export const CEILING_SENTENCE =
  "This pilot grades the subject's WORD. Observables come from disk/process state, " +
  "never the transcript (S117) — a bare model has no such state, so every observable " +
  "born of this run was DECLARED BY A HUMAN reading a transcript. Every evidence " +
  "record descended from it inherits basis TRANSCRIPT_DECLARED_BY_HUMAN.";

/**
 * The only basis this pilot can honestly claim. A declaration naming anything
 * else is refused — there is no second value to choose from, and an open
 * string here would invite one.
 */
export const SUBJECT_DECLARATION_BASIS = "TRANSCRIPT_DECLARED_BY_HUMAN";

export interface SubjectCallOptions {
  /** The declared BASE seed. The runner overrides it per call from `--seeds`. */
  readonly seed: number;
  readonly temperature: number;
}

export interface SubjectDeclaration {
  readonly subjectId: string;
  /** Never a literal in this repo — see the header. */
  readonly model: string;
  /** Ruled OFF for S119. `true` is refused by the loader, not recorded. */
  readonly thinkFlag: false;
  readonly options: SubjectCallOptions;
  readonly systemPrompt: string;
  readonly endpoint: string;
  readonly basis: typeof SUBJECT_DECLARATION_BASIS;
  readonly declaredBy: string;
  /** ISO 8601, authored by the declaring principal. This module calls no clock. */
  readonly declaredAt: string;
}

export const SUBJECT_DECLARATION_KEYS: readonly string[] = [
  "subjectId",
  "model",
  "thinkFlag",
  "options",
  "systemPrompt",
  "endpoint",
  "basis",
  "declaredBy",
  "declaredAt",
];

export const SUBJECT_CALL_OPTION_KEYS: readonly string[] = ["seed", "temperature"];

/** Typed so a caller can tell "the arbiter's file is wrong" from "the disk broke". */
export class SubjectDeclarationRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubjectDeclarationRefused";
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function hasExactKeys(o: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(o).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((k, i) => k === wanted[i]);
}

function requireNonEmptyString(o: Record<string, unknown>, key: string, where: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new SubjectDeclarationRefused(
      `refused: ${where}.${key} must be a non-empty string, got ${JSON.stringify(v)} — ` +
        `this loader supplies no default for any field.`
    );
  }
  return v;
}

function requireFiniteNumber(o: Record<string, unknown>, key: string, where: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new SubjectDeclarationRefused(
      `refused: ${where}.${key} must be a finite number, got ${JSON.stringify(v)}.`
    );
  }
  return v;
}

/**
 * Parse a declaration from already-read JSON. REFUSES — never returns a
 * partial, never fills a gap. Separated from `loadSubjectDeclaration` so a
 * test can exercise every refusal without touching a disk.
 */
export function parseSubjectDeclaration(raw: unknown): SubjectDeclaration {
  if (!isObject(raw)) {
    throw new SubjectDeclarationRefused(
      `refused: a subject declaration must be a JSON object, got ${
        Array.isArray(raw) ? "an array" : typeof raw
      }.`
    );
  }
  if (!hasExactKeys(raw, SUBJECT_DECLARATION_KEYS)) {
    const actual = Object.keys(raw).sort();
    const missing = SUBJECT_DECLARATION_KEYS.filter((k) => !actual.includes(k));
    const extra = actual.filter((k) => !SUBJECT_DECLARATION_KEYS.includes(k));
    throw new SubjectDeclarationRefused(
      `refused: subject declaration key set is wrong. missing: [${missing.join(", ")}]; ` +
        `unexpected: [${extra.join(", ")}]. Every field is required and no other field is ` +
        `read — an unexpected key means its author believed something false about this loader.`
    );
  }

  const subjectId = requireNonEmptyString(raw, "subjectId", "declaration");
  const model = requireNonEmptyString(raw, "model", "declaration");
  const systemPrompt = requireNonEmptyString(raw, "systemPrompt", "declaration");
  const endpoint = requireNonEmptyString(raw, "endpoint", "declaration");
  const declaredBy = requireNonEmptyString(raw, "declaredBy", "declaration");
  const declaredAt = requireNonEmptyString(raw, "declaredAt", "declaration");

  if (raw.thinkFlag !== false) {
    throw new SubjectDeclarationRefused(
      `refused: declaration.thinkFlag must be literally false, got ${JSON.stringify(raw.thinkFlag)}. ` +
        `Thinking is ruled OFF for S119 and a think-on variant is out of the pilot's scope — ` +
        `changing that is a ruling, not a JSON edit.`
    );
  }

  if (raw.basis !== SUBJECT_DECLARATION_BASIS) {
    throw new SubjectDeclarationRefused(
      `refused: declaration.basis must be "${SUBJECT_DECLARATION_BASIS}", got ` +
        `${JSON.stringify(raw.basis)}. This pilot reads a transcript a human graded; it has no ` +
        `other basis available to it, and naming one would be a claim the run cannot support.`
    );
  }

  const options = raw.options;
  if (!isObject(options)) {
    throw new SubjectDeclarationRefused(
      `refused: declaration.options must be an object with exactly ` +
        `[${SUBJECT_CALL_OPTION_KEYS.join(", ")}], got ${JSON.stringify(options)}.`
    );
  }
  if (!hasExactKeys(options, SUBJECT_CALL_OPTION_KEYS)) {
    throw new SubjectDeclarationRefused(
      `refused: declaration.options must carry exactly [${SUBJECT_CALL_OPTION_KEYS.join(", ")}], ` +
        `got [${Object.keys(options).sort().join(", ")}].`
    );
  }
  const seed = requireFiniteNumber(options, "seed", "declaration.options");
  const temperature = requireFiniteNumber(options, "temperature", "declaration.options");

  if (Number.isNaN(Date.parse(declaredAt))) {
    throw new SubjectDeclarationRefused(
      `refused: declaration.declaredAt is not a parseable timestamp: ${JSON.stringify(declaredAt)}.`
    );
  }

  return {
    subjectId,
    model,
    thinkFlag: false,
    options: { seed, temperature },
    systemPrompt,
    endpoint,
    basis: SUBJECT_DECLARATION_BASIS,
    declaredBy,
    declaredAt,
  };
}

/**
 * Read and parse. An unreadable file and a malformed one are DIFFERENT facts
 * and are reported as such — the store's own distinction between "the disk
 * broke" and "the content is wrong", kept here so a run's failure message
 * points at the right person.
 */
export function loadSubjectDeclaration(path: string): SubjectDeclaration {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new SubjectDeclarationRefused(
      `refused: cannot read the subject declaration at ${path}: ` +
        `${err instanceof Error ? err.message : String(err)}`
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new SubjectDeclarationRefused(
      `refused: the subject declaration at ${path} is not valid JSON: ` +
        `${err instanceof Error ? err.message : String(err)}`
    );
  }
  return parseSubjectDeclaration(raw);
}

/**
 * Is a declared endpoint on the loopback interface. Lives here, beside the
 * field it judges, so the runner enforces a rule this module defines once.
 * Hostname only — a URL naming any other host is not loopback no matter what
 * it resolves to at call time, and this check is deliberately static.
 */
export function isLoopbackEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host === "[::1]") return true;
  // 127.0.0.0/8 — the whole loopback block, matching the unit's IPAddressAllow.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}
