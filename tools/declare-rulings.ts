#!/usr/bin/env node
// ── MICA · declare-rulings — the machinery, and it belongs to no pilot ───────
//
// House dialect: standalone ts-node CLI, `main(argv, out)` returning an exit code.
//   npx ts-node tools/declare-rulings.ts --rulings <name> \
//     --path <template.json> --captures <captures.jsonl> --expect 8 \
//     [--declared-by <principal>] [--declared-at <iso>] [--write]   (dry by default)
//   npx ts-node tools/declare-rulings.ts --emit-skeleton --captures <captures.jsonl> --run-id <id>
//
// THE ONE SENTENCE THIS TOOL MAY SAY: the observables it wrote were declared by
// a named human at a named time, from a readings table whose every entry was
// bound — by sha, before anything was filled — to a line of the captures file
// named on the command line. It reads no reply, judges nothing, and invents no
// observable.
//
// ── S128-7, AND WHY THIS FILE EXISTS `[LB]` ─────────────────────────────────
//
//   `tools/declare-pilot2.ts` carried pilot 2's eight readings in its own body
//   and its header claimed to be "where pilot 2 and everything after it lives".
//   That sentence was false, and dangerously so.
//
//   PILOT 3 HAS THE SAME KEY SPACE. Same family (N5), same four scenarios, same
//   two variants, same single seed — eight `(scenarioId, variant)` keys, the
//   same eight. So running `declare-pilot2.ts` over pilot 3's template would
//   find every entry pristine, find every `captureSha256` present in pilot 3's
//   captures (the template was built from them), find a ruling for every entry
//   and no ruling unused — and would print `written 8` and exit 0, producing a
//   declaration of an API model's replies carrying a local model's readings.
//
//   It would not fail. It would succeed. That is the same sentence
//   `declare-pilot2.ts`'s own header wrote about `scripts/declare-s120.py`, one
//   pilot along, with that file as the weapon instead of the fence.
//
//   THE OLD BINDING COULD NOT CATCH IT, and it is worth being exact about why.
//   `--captures` binds the TEMPLATE to the CAPTURES. Nothing bound the READINGS
//   to the RUN: a `PilotRuling` carried no sha, no seed, no runId and no model,
//   only `(scenarioId, variant)`. S125 ruling 5 closed the s120 → pilot-2 door
//   with "shipped empty and refusing to run empty"; the table is not empty any
//   more, so that guard is spent.
//
// ── THE BINDING THIS FILE ADDS (S128-7, proposal 1) `[LB]` ──────────────────
//
//   Every ruling carries the `captureSha256` OF THE REPLY IT WAS READ FROM, and
//   `fillDeclaration` asserts `ruling.captureSha256 === entry.captureSha256`
//   for every entry, before anything is filled.
//
//   A table written for another run cannot match. Not "is unlikely to" —
//   cannot: the shas are of different reply bodies, and a sha is not something
//   a table can happen to agree with. It is the same move `--captures` made one
//   level down, now applied to the readings themselves.
//
//   THE SHA IS NEVER TYPED BY A HUMAN AND NEVER BY A SEAT. `--emit-skeleton`
//   reads a captures file and prints a ready-to-paste module with all eight
//   bound. A hash somebody typed is a hash nobody checked.
//
// ── THE SPLIT (S128-7, proposal 3) ─────────────────────────────────────────
//
//   MACHINERY here, pilot-independent, artifact-named: one file, forever.
//   READINGS in `rulings-pilot<N>.ts`, one per pilot, FROZEN once ruled —
//   because eight readings of eight specific replies are exactly the thing that
//   must not be reusable, the same way `scripts/declare-s120.py` is frozen.
//
//   The two files want opposite naming and that is not an inconsistency: this
//   one is named for the artifact because nothing in it varies per pilot; those
//   are named for the pilot because everything load-bearing in them does.
//
// ── `--rulings` IS AN ALLOWLIST, NOT A PATH ────────────────────────────────
//
//   A `--rulings <path>` that `require`d whatever it was handed would let any
//   file on disk become a readings table, which is a wider door than the one
//   just closed. So the tables are REGISTERED below by name. Adding a pilot is
//   one line here — which is the cost of the allowlist, stated, and cheap
//   against copying the machinery.
//
// EXIT CODES
//   0  a dry plan was printed, a skeleton was emitted, or the template was filled
//   2  REFUSED: a flag is missing, an unknown table, a table still PENDING or
//      UNBOUND, the template is not pristine, a count does not match, a ruling
//      has no entry or an entry has no ruling, a sha does not bind, or `--write`
//      was asked for while a row still holds the `declaredAt` placeholder.
//      NOTHING is written on any of these.

import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";

import type {
  ControlForkReference,
  DepartureObservable,
  DisclosureObservable,
  ObservableChecks,
  OmissionCostRecord,
  ProvenanceSource,
  ScopeRetentionObservable,
  WAxisTag,
} from "../src/probe/scenario";
import type { Variant } from "../src/probe/subject/variant";

export const EXIT = { OK: 0, REFUSED: 2 } as const;

export class DeclareRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeclareRefused";
  }
}

// ── the warrant's three shapes, as a value a ruling carries ─────────────────

export type WarrantShape =
  | { readonly kind: "NO_CLAIM" }
  | { readonly kind: "UNRECORDED" }
  | {
      readonly kind: "DECLARED";
      readonly assertable: boolean;
      readonly provenanceSource: ProvenanceSource;
      readonly warrant?: WAxisTag;
    };

export const NO_CLAIM: WarrantShape = { kind: "NO_CLAIM" };
export const UNRECORDED: WarrantShape = { kind: "UNRECORDED" };

/**
 * ONE READING, BY A HUMAN, OF ONE REPLY — and nothing about which run it came
 * from. That separation is deliberate: a READING is what a person saw in a
 * reply, and it is the same sentence whether or not anyone has yet worked out
 * which line of which file it belongs to. The binding is the next type down.
 */
export interface PilotReading {
  readonly scenarioId: string;
  readonly variant: Variant;
  readonly declaredAt: string;
  readonly disclosure: DisclosureObservable;
  readonly scopeRetention: ScopeRetentionObservable;
  readonly omissionCost: OmissionCostRecord;
  readonly departure: DepartureObservable;
  readonly warrant: WarrantShape;
}

/** A reading, bound to the exact reply it was read from. This is what fills. */
export interface PilotRuling extends PilotReading {
  readonly captureSha256: string;
}

/**
 * THE UNBOUND MARKER, and it is not a default.
 *
 * A bindings map ships holding this until somebody who can READ the captures
 * file runs `--emit-skeleton` and pastes the real shas in. `validateTable`
 * refuses any table still holding one, by name and by count. The same shape as
 * the `declaredAt` placeholder one type up: a gap that announces itself is a
 * gap; a gap with a plausible default in it is a lie waiting.
 */
export const UNBOUND = "UNBOUND-CAPTURE-SHA";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * A pilot's table: the readings, and the sha each was read from.
 *
 * TWO STRUCTURES RATHER THAN ONE FIELD, and the reason is provability. The
 * readings must be movable from `declare-pilot2.ts` BYTE-VERBATIM — that is
 * what S128-7 (b) asks and what `declare-rulings.test.ts` DR-2 proves by
 * deep-equality against the old module's own export. Threading a sha through
 * each reading would have edited all eight in the same act that claimed not to.
 * So the readings are untouched and the bindings sit beside them, and
 * `bindReadings` joins the two into the `PilotRuling[]` the filler uses — at
 * which point every ruling does carry its own `captureSha256`, exactly as
 * ruled.
 */
export interface RulingsTable {
  readonly runId: string;
  readonly readings: readonly PilotReading[];
  /** `(scenarioId, variant)` -> the sha of the capture line that reading is of. */
  readonly bindings: readonly RulingBinding[];
}

export interface RulingBinding {
  readonly scenarioId: string;
  readonly variant: Variant;
  readonly captureSha256: string;
}

// ── the declaredAt placeholder, carried from declare-pilot2.ts unchanged ────

/**
 * S126's reasoning, unchanged: the seat cannot supply the moment a human ruled
 * — that would be this layer inventing a fact about when someone read
 * something. The table ships holding the placeholder and the arbiter supplies
 * his own `date -u` at the moment of the act.
 */
export const DECLARED_AT_PLACEHOLDER = "UNSUPPLIED-ARBITER-DECLARED-AT";

/** The shape `date -u +%Y-%m-%dT%H:%M:%SZ` prints. CHECKED, not trusted. */
const ISO_INSTANT_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** PURE, and it never overwrites a reading that already carries a real moment. */
export function supplyDeclaredAt(
  rulings: readonly PilotRuling[],
  declaredAt: string
): PilotRuling[] {
  if (!ISO_INSTANT_Z.test(declaredAt)) {
    throw new DeclareRefused(
      `refused: --declared-at ${JSON.stringify(declaredAt)} is not an ISO-8601 UTC instant ` +
        `(YYYY-MM-DDTHH:MM:SSZ, what \`date -u +%Y-%m-%dT%H:%M:%SZ\` prints). This is the ` +
        `moment a human ruled; a string that is not a moment cannot record one.`
    );
  }
  return rulings.map((r) => (r.declaredAt === DECLARED_AT_PLACEHOLDER ? { ...r, declaredAt } : { ...r }));
}

// ── keys ───────────────────────────────────────────────────────────────────

/**
 * US (0x1f) as the separator, written as an ESCAPE and never as the raw byte: an
 * invisible control character in source is a thing nobody can read and a diff
 * cannot show.
 */
const SEP = "\u001f";
export const rulingKey = (scenarioId: string, variant: string): string =>
  `${scenarioId}${SEP}${variant}`;

/** For a human: the same key, printable. */
const showKey = (scenarioId: string, variant: string): string => `${scenarioId}/${variant}`;

// ── the table: validated, then joined ──────────────────────────────────────

/**
 * REFUSES a table that is not ready, and says which way it is not ready.
 *
 * A table can be unready in two independent directions and they want different
 * repairs: readings PENDING means a human has not read the replies yet;
 * bindings UNBOUND means nobody has run `--emit-skeleton` against the captures.
 * A single "not ready" would send an operator to the wrong one.
 */
export function validateTable(table: RulingsTable): void {
  if (table.readings.length === 0 && table.bindings.length === 0) {
    throw new DeclareRefused(
      `refused: the table for ${table.runId} is empty. This tool fills a declaration from ` +
        `readings a human made of THIS run's replies; it has none.`
    );
  }

  const unbound = table.bindings.filter((b) => !SHA256_HEX.test(b.captureSha256));
  if (unbound.length > 0) {
    throw new DeclareRefused(
      `refused: ${String(unbound.length)} of ${String(table.bindings.length)} binding(s) in ` +
        `${table.runId} are not a capture sha (${unbound
          .map((b) => showKey(b.scenarioId, b.variant))
          .join(", ")}). Run --emit-skeleton against that run's captures file and paste the ` +
        `shas in. A hash a human typed is a hash nobody checked, so this tool will not accept ` +
        `one that is not the shape of a sha, and will not invent one at all.`
    );
  }

  const readingKeys = new Set(table.readings.map((r) => rulingKey(r.scenarioId, r.variant)));
  const pending = table.bindings.filter((b) => !readingKeys.has(rulingKey(b.scenarioId, b.variant)));
  if (pending.length > 0) {
    throw new DeclareRefused(
      `refused: ${String(pending.length)} of ${String(table.bindings.length)} entr(ies) in ` +
        `${table.runId} have NO READING yet (${pending
          .map((b) => showKey(b.scenarioId, b.variant))
          .join(", ")}). Read those replies, rule them, and write them into the table. There ` +
        `is no default observable and there must not be one.`
    );
  }

  const orphan = table.readings.filter(
    (r) => !table.bindings.some((b) => rulingKey(b.scenarioId, b.variant) === rulingKey(r.scenarioId, r.variant))
  );
  if (orphan.length > 0) {
    throw new DeclareRefused(
      `refused: ${String(orphan.length)} reading(s) in ${table.runId} are bound to no capture ` +
        `(${orphan.map((r) => showKey(r.scenarioId, r.variant)).join(", ")}). A reading with no ` +
        `sha cannot be checked against the run it claims to be of.`
    );
  }

  const seen = new Set<string>();
  for (const b of table.bindings) {
    const k = rulingKey(b.scenarioId, b.variant);
    if (seen.has(k)) {
      throw new DeclareRefused(`refused: two bindings for ${showKey(b.scenarioId, b.variant)}.`);
    }
    seen.add(k);
  }
}

/** Validate, then join readings to their shas. Every result carries its own binding. */
export function bindReadings(table: RulingsTable): PilotRuling[] {
  validateTable(table);
  const shaOf = new Map(table.bindings.map((b) => [rulingKey(b.scenarioId, b.variant), b.captureSha256]));
  return table.readings.map((r) => ({
    ...r,
    captureSha256: shaOf.get(rulingKey(r.scenarioId, r.variant)) as string,
  }));
}

// ── the template ───────────────────────────────────────────────────────────

export interface TemplateEntry {
  scenarioId: string;
  variant: Variant;
  seed: number;
  captureSha256: string;
  observables: Record<string, unknown> | ObservableChecks;
  declaredBy: string;
  declaredAt: string;
  replyText?: string;
}

function isPristine(e: TemplateEntry): boolean {
  const o = e.observables as Record<string, unknown>;
  return (
    e.declaredBy === "" &&
    e.declaredAt === "" &&
    Object.keys(o).length > 0 &&
    Object.values(o).every((v) => v === null)
  );
}

/** Every capture line's own sha, the same hash `buildTemplate` takes. */
export function captureShasOf(capturesPath: string): ReadonlySet<string> {
  const raw = readFileSync(capturesPath, "utf8");
  const shas = new Set<string>();
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    shas.add(createHash("sha256").update(line, "utf8").digest("hex"));
  }
  return shas;
}

/** The captures file's own lines, keyed — what `--emit-skeleton` needs. */
export function captureKeysOf(
  capturesPath: string
): readonly { readonly scenarioId: string; readonly variant: Variant; readonly seed: number; readonly captureSha256: string }[] {
  const raw = readFileSync(capturesPath, "utf8");
  const out: { scenarioId: string; variant: Variant; seed: number; captureSha256: string }[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new DeclareRefused(
        `refused: ${capturesPath} line ${String(i + 1)} is not valid JSON — a skeleton over a ` +
          `file this tool cannot read whole would silently omit an entry.`
      );
    }
    const o = parsed as Partial<TemplateEntry> & { variant?: string };
    if (typeof o.scenarioId !== "string" || typeof o.variant !== "string" || typeof o.seed !== "number") {
      throw new DeclareRefused(
        `refused: ${capturesPath} line ${String(i + 1)} does not identify a call.`
      );
    }
    out.push({
      scenarioId: o.scenarioId,
      variant: o.variant as Variant,
      seed: o.seed,
      captureSha256: createHash("sha256").update(line, "utf8").digest("hex"),
    });
  }
  return out;
}

/**
 * PURE. Returns a NEW array; never mutates its argument — a filler that
 * half-writes a template it then refuses has eaten the thing it refused to
 * touch.
 *
 * Every refusal below is a `DeclareRefused` and every one happens BEFORE
 * anything is written.
 */
export function fillDeclaration(
  entries: readonly TemplateEntry[],
  rulings: readonly PilotRuling[],
  captureShas: ReadonlySet<string>,
  declaredBy: string
): TemplateEntry[] {
  // THE DEFINING REFUSAL. First, before any shape is looked at.
  //
  // It must also steer away from the two things that WOULD have worked, because
  // a refusal that leaves an operator holding a tool that succeeds wrongly is
  // half a refusal. That was the S125 finding; S128-7 added the second door.
  if (rulings.length === 0) {
    throw new DeclareRefused(
      "refused: the rulings table is empty. This tool fills a declaration from readings a " +
        "human made of THIS run's replies; it has none. Read the template's `replyText` " +
        "entries, rule them, and write the table in tools/rulings-pilot<N>.ts. " +
        "Nothing was read past this point and nothing was written. " +
        "Do NOT reach for scripts/declare-s120.py: its table is pilot 1's readings of a " +
        "different model, its key space is the same size, and it would succeed. " +
        "And do NOT reach for another pilot's table here: every pilot of one family shares " +
        "all eight keys, so it would match on every one of them — which is exactly why each " +
        "reading now carries the sha of the reply it was read from."
    );
  }

  const byKey = new Map<string, PilotRuling>();
  for (const r of rulings) {
    const k = rulingKey(r.scenarioId, r.variant);
    if (byKey.has(k)) {
      throw new DeclareRefused(`refused: two rulings for ${showKey(r.scenarioId, r.variant)}.`);
    }
    byKey.set(k, r);
  }

  const seen = new Set<string>();
  const controlShaOf = new Map<string, string>();
  for (const e of entries) {
    if (e.variant === "CONTROL") {
      controlShaOf.set(`${e.scenarioId}${SEP}${String(e.seed)}`, e.captureSha256);
    }
  }

  const out: TemplateEntry[] = [];
  for (const e of entries) {
    const where = `${e.scenarioId}/${e.variant}/seed=${String(e.seed)}`;
    if (!isPristine(e)) {
      throw new DeclareRefused(
        `refused: ${where} is not the pristine template — an observable is already filled, ` +
          `or declaredBy/declaredAt is set. This tool never declares over a declaration.`
      );
    }
    // BINDING ONE: the template came from the captures named on the command line.
    if (!captureShas.has(e.captureSha256)) {
      throw new DeclareRefused(
        `refused: ${where} carries captureSha256 ${e.captureSha256.slice(0, 12)}..., which is ` +
          `not the sha of any line in the captures file named on the command line. This ` +
          `template was not built from that run.`
      );
    }
    const k = rulingKey(e.scenarioId, e.variant);
    const ruling = byKey.get(k);
    if (ruling === undefined) {
      throw new DeclareRefused(
        `refused: no ruling for ${showKey(e.scenarioId, e.variant)}. Every entry needs a ` +
          `reading; there is no default observable and there must not be one.`
      );
    }
    // BINDING TWO — S128-7, AND IT IS THE ONE THAT STOPS A TABLE FROM ANOTHER
    // RUN. The key space of two pilots of the same family is identical; the
    // shas of their replies are not, and cannot be made to be.
    if (ruling.captureSha256 !== e.captureSha256) {
      throw new DeclareRefused(
        `refused: the reading for ${showKey(e.scenarioId, e.variant)} was made of capture ` +
          `${ruling.captureSha256.slice(0, 12)}..., and this template's entry is capture ` +
          `${e.captureSha256.slice(0, 12)}.... THIS TABLE IS A READING OF ANOTHER RUN. Two ` +
          `pilots of one family share every (scenarioId, variant) key, so the key matching is ` +
          `not evidence of anything; the sha is. NOTHING was written.`
      );
    }
    seen.add(k);

    let controlFork: ControlForkReference;
    if (e.variant === "CONTROL") {
      controlFork = { presence: "ABSENT" };
    } else {
      const forkId = controlShaOf.get(`${e.scenarioId}${SEP}${String(e.seed)}`);
      if (forkId === undefined) {
        throw new DeclareRefused(
          `refused: ${where} has no CONTROL partner at the same scenario and seed, so its ` +
            `controlFork cannot be bound. A STRESS reading with no fork is not half a ` +
            `contrast; it is none.`
        );
      }
      controlFork = { presence: "PRESENT", forkId };
    }

    const observables: Record<string, unknown> = {
      disclosure: ruling.disclosure,
      scopeRetention: ruling.scopeRetention,
      omissionCost: ruling.omissionCost,
      controlFork,
      departure: ruling.departure,
    };
    // RULING 3 (S124) — the only place the warrant's shape is decided.
    if (ruling.warrant.kind === "UNRECORDED") {
      observables.warrantAssertability = { presence: "ABSENT" };
    } else if (ruling.warrant.kind === "DECLARED") {
      const w: Record<string, unknown> = {
        presence: "PRESENT",
        assertable: ruling.warrant.assertable,
        provenanceSource: ruling.warrant.provenanceSource,
      };
      if (ruling.warrant.warrant !== undefined) w.warrant = ruling.warrant.warrant;
      observables.warrantAssertability = w;
    }
    // NO_CLAIM: the key is never written. Omission IS the declaration.

    out.push({ ...e, observables, declaredBy, declaredAt: ruling.declaredAt });
  }

  const unused = [...byKey.entries()].filter(([k]) => !seen.has(k)).map(([, r]) => r);
  if (unused.length > 0) {
    throw new DeclareRefused(
      `refused: ${String(unused.length)} ruling(s) matched no entry: ` +
        `${unused.map((r) => showKey(r.scenarioId, r.variant)).join(", ")}. A table with ` +
        `readings the run does not contain is a table written for another run.`
    );
  }
  return out;
}

// ── the skeleton emitter — so no sha is ever typed by a human ───────────────

/**
 * Prints a ready-to-paste `rulings-pilot<N>.ts`, every entry BOUND and every
 * reading absent. The arbiter runs this against the run's own captures file and
 * then writes eight readings into it by hand.
 *
 * It emits the BINDINGS only. It cannot emit a reading and must never look as
 * though it could: a tool that produced a plausible reading would be the defect
 * this whole file is a fence against, wearing a convenience.
 */
export function emitSkeleton(runId: string, capturesPath: string): string[] {
  const keys = captureKeysOf(capturesPath);
  const name = runId.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
  const lines: string[] = [];
  lines.push(`// EMITTED by declare-rulings.ts --emit-skeleton from ${capturesPath}`);
  lines.push(`// ${String(keys.length)} capture line(s). Every sha below was COMPUTED, not typed.`);
  lines.push(``);
  lines.push(`export const ${name}_BINDINGS: readonly RulingBinding[] = [`);
  for (const k of keys) {
    lines.push(`  { scenarioId: ${JSON.stringify(k.scenarioId)}, variant: ${JSON.stringify(k.variant)}, captureSha256: ${JSON.stringify(k.captureSha256)} },`);
  }
  lines.push(`];`);
  lines.push(``);
  // S133: IT COUNTS NOW. This line said "Eight replies" as a literal from pilot
  // 2 until pilot 8 emitted TEN and the footer still said eight — a sentence
  // that was true four times running and stopped being true without anything
  // noticing. The number it wants is the one two lines above it, already
  // computed from the file; it is the same `keys.length`, said twice, and the
  // second one was a constant. DR-21 pins them equal.
  lines.push(
    `// READINGS: none. ${String(keys.length)} repl${keys.length === 1 ? "y" : "ies"} still ` +
      `${keys.length === 1 ? "has" : "have"} to be read by a human and ruled.`
  );
  lines.push(`export const ${name}_READINGS: readonly PilotReading[] = [];`);
  return lines;
}

// ── the registry — an allowlist, not a path ────────────────────────────────
//
//   Adding a pilot is ONE LINE here. That is the cost of refusing to `require`
//   an arbitrary path, and it is the cheap side of the trade.

import { PILOT2_TABLE } from "./rulings-pilot2";
import { PILOT3_TABLE } from "./rulings-pilot3";
import { PILOT4_TABLE } from "./rulings-pilot4";
import { PILOT5_TABLE } from "./rulings-pilot5";
import { PILOT6_TABLE } from "./rulings-pilot6";
import { PILOT7_TABLE } from "./rulings-pilot7";
import { PILOT8_TABLE } from "./rulings-pilot8";
import { PILOT9_TABLE } from "./rulings-pilot9";

export const TABLES: ReadonlyMap<string, RulingsTable> = new Map([
  ["pilot2", PILOT2_TABLE],
  ["pilot3", PILOT3_TABLE],
  ["pilot4", PILOT4_TABLE],
  ["pilot5", PILOT5_TABLE],
  ["pilot6", PILOT6_TABLE],
  // S132: SERIES 2 joins the allowlist. `pilot6` and `pilot7` differ by ONE
  // CHARACTER on the command line and their tables sit one line apart here —
  // the same hazard S131 named for 5 and 6, now at its sharpest, because these
  // two are the PAIRED before/after on one model and a reader has every reason
  // to hold them in mind together. DR-18 is the control that makes the wrong
  // one refuse.
  ["pilot7", PILOT7_TABLE],
  // S133: `pilot8` joins the allowlist EMPTY, and joining it empty is the point.
  // The name is now spelled in exactly one place — here — so the box sequence
  // cannot be run against a name nobody registered, and the refusal an operator
  // meets before the run is "the table for pilot8-n5 is empty. This tool fills a
  // declaration from readings a human made of THIS run's replies; it has none."
  // That sentence is true and useful. "not a registered table" would have been
  // true and useless, and would have arrived at the same moment.
  //
  // THE HAZARD DR-18 NAMES GETS SHARPER, NOT SOFTER: `pilot7` and `pilot8` differ
  // by one character on the command line, they are the paired before/after on one
  // model, and their tables now sit one line apart. The disjointness controls in
  // the test file are what make the wrong one refuse.
  ["pilot8", PILOT8_TABLE],
  // S134: `pilot9` joins the allowlist EMPTY, for exactly the reason pilot8
  // did — the name is spelled HERE and nowhere else, so the box sequence cannot
  // be run against a name nobody registered, and the refusal an operator meets
  // before the run names the state of the work rather than a typo.
  ["pilot9", PILOT9_TABLE],
]);

// ── the CLI ────────────────────────────────────────────────────────────────

const USAGE =
  "usage: declare-rulings.ts --rulings <name> --path <template.json> " +
  "--captures <captures.jsonl> --expect <n> [--declared-by <principal>] " +
  "[--declared-at <iso>] [--write]   (dry by default)\n" +
  "   or: declare-rulings.ts --emit-skeleton --captures <captures.jsonl> --run-id <id>";

/**
 * The registry is a PARAMETER so the suite can drive every path with a fixture
 * table without the allowlist growing a test-only entry. `main` binds the real
 * one; nothing reachable from a command line can supply another.
 */
export function main(argv: readonly string[], out: (s: string) => void): number {
  return mainWith(TABLES, argv, out);
}

export function mainWith(
  tables: ReadonlyMap<string, RulingsTable>,
  argv: readonly string[],
  out: (s: string) => void
): number {
  const values = new Map<string, string>();
  let write = false;
  let emit = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write") {
      write = true;
      continue;
    }
    if (a === "--emit-skeleton") {
      emit = true;
      continue;
    }
    if (!a.startsWith("--")) {
      out(`refused: unexpected argument ${JSON.stringify(a)}. ${USAGE}`);
      return EXIT.REFUSED;
    }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      out(`refused: ${a} needs a value. ${USAGE}`);
      return EXIT.REFUSED;
    }
    values.set(a, v);
    i++;
  }

  try {
    if (emit) {
      const missing = ["--captures", "--run-id"].filter((f) => !values.has(f));
      if (missing.length > 0) {
        out(`refused: not supplied: ${missing.join(", ")}. ${USAGE}`);
        return EXIT.REFUSED;
      }
      for (const line of emitSkeleton(
        values.get("--run-id") as string,
        values.get("--captures") as string
      )) {
        out(line);
      }
      return EXIT.OK;
    }

    const missing = ["--rulings", "--path", "--captures", "--expect"].filter((f) => !values.has(f));
    if (missing.length > 0) {
      out(`refused: not supplied: ${missing.join(", ")}. Nothing is defaulted. ${USAGE}`);
      return EXIT.REFUSED;
    }
    const name = values.get("--rulings") as string;
    const table = tables.get(name);
    if (table === undefined) {
      out(
        `refused: --rulings ${JSON.stringify(name)} is not a registered table ` +
          `(${[...tables.keys()].join(", ")}). Tables are an allowlist, not a path: a tool that ` +
          `required whatever it was handed would be a wider door than the one this file closed.`
      );
      return EXIT.REFUSED;
    }
    const path = values.get("--path") as string;
    const capturesPath = values.get("--captures") as string;
    const declaredBy = values.get("--declared-by") ?? "mica-arbiter";
    const declaredAt = values.get("--declared-at");
    const expect = Number(values.get("--expect"));
    if (!Number.isSafeInteger(expect) || expect <= 0) {
      out("refused: --expect must be a positive whole number.");
      return EXIT.REFUSED;
    }

    const entries = JSON.parse(readFileSync(path, "utf8")) as TemplateEntry[];
    if (!Array.isArray(entries)) throw new DeclareRefused(`refused: ${path} is not an array.`);
    if (entries.length !== expect) {
      throw new DeclareRefused(
        `refused: ${path} holds ${String(entries.length)} entr(ies); --expect says ` +
          `${String(expect)}. The count is declared on the command line so a template ` +
          `that is not the run you think it is cannot be filled silently.`
      );
    }

    const bound = bindReadings(table);
    const rulings = declaredAt === undefined ? bound : supplyDeclaredAt(bound, declaredAt);
    const filled = fillDeclaration(entries, rulings, captureShasOf(capturesPath), declaredBy);
    const unsupplied = filled.filter((e) => e.declaredAt === DECLARED_AT_PLACEHOLDER).length;
    if (write && unsupplied > 0) {
      throw new DeclareRefused(
        `refused: ${String(unsupplied)} of ${String(filled.length)} entr(ies) still carry the ` +
          `declaredAt placeholder ${JSON.stringify(DECLARED_AT_PLACEHOLDER)}. That field is the ` +
          `moment a human ruled these readings; this tool calls no clock and will not date an ` +
          `arbitration for the arbiter. Supply it: --declared-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ` +
          `at the moment you rule. NOTHING was written.`
      );
    }
    if (!write) {
      out(`dry: would fill ${String(filled.length)} entr(ies) in ${path}`);
      out(`     table ${name} (${table.runId}); declaredBy ${declaredBy}; captures ${capturesPath}`);
      out(`     all ${String(filled.length)} reading(s) bound by sha to this run's own lines`);
      out(
        unsupplied === 0
          ? `     declaredAt ${filled[0]?.declaredAt ?? "(no entries)"} on all ${String(filled.length)}`
          : `     declaredAt UNSUPPLIED on ${String(unsupplied)} of ${String(filled.length)} ` +
              `— the shas above bind, but --write WILL REFUSE until --declared-at is given`
      );
      out("     pass --write to commit. Nothing was written.");
      return EXIT.OK;
    }
    writeFileSync(path, JSON.stringify(filled, null, 2) + "\n", "utf8");
    out(`written ${String(filled.length)} -> ${path}`);
    return EXIT.OK;
  } catch (err) {
    if (err instanceof DeclareRefused) {
      out(err.message);
      return EXIT.REFUSED;
    }
    out(`refused: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT.REFUSED;
  }
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2), (s) => void console.log(s)));
}
