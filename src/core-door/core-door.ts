#!/usr/bin/env node
// ── MICA · the core door — `src/mica/**` is pinned, and opens only under a ticket ─
//
//   npx ts-node src/core-door/core-door.ts                        -> the door's state
//   npx ts-node src/core-door/core-door.ts --propose-repin <id>   -> repin entries, to stdout
//   npx ts-node src/core-door/core-door.ts --pin-baseline         -> a fresh baseline, to stdout
//
// Ruled 2026-09-22 (BRIEF Core-Repair-Window §1): the core opens for two named
// defects only, through a door that is a TEST. This file is that door's logic.
// It is called from two places, and both are load-bearing:
//
//   · `src/core-door/core-door.test.ts` — the normal suite (`npm run test:mica`).
//   · `src/glue/glue.test.ts`, its last check — the machine relay's acceptance,
//     run at the deployed tree. A door nobody executes is not a door.
//
// ── WHAT IT CHECKS ───────────────────────────────────────────────────────────
//
//   Every file under `src/mica/` — no skipped directories, dotfiles included —
//   is hashed (sha256 over bytes) and compared with the PINNED INVENTORY
//   (`src/core-door/core-inventory.json`). A file that differs, is new, or is
//   gone is DRIFT. Drift passes only when a LIVE TICKET names the file. A ticket
//   is live from its arbiter date until `expiresAt`; after that it authorises
//   nothing, and the same drift fails. The door closes by itself.
//
//   The inventory and the tickets live OUTSIDE `src/mica/`, or the door would
//   pin itself: a ticket would change the very hashes that decide it.
//
// ── THE RE-PIN RULE (how a shipped repair closes the door behind it) ─────────
//
//   The inventory is a BASELINE plus an append-only list of RE-PINS. The
//   baseline's digest is a constant in THIS file (`PINNED_BASELINE_DIGEST`), so
//   editing a baseline hash to match an edited core file needs a second edit
//   here, in the door's own source. A re-pin moves one file's pin from `from` to
//   `to`, and it counts only if it cites a ticket that
//     · exists, is well-formed, and NAMES that file,
//     · is byte-identical to the ticket as it was when the re-pin was made
//       (`ticketSha256`) — a ticket cannot be widened or extended afterwards,
//     · was not expired on the re-pin's declared date (`pinnedOn`),
//   and only if `from` is the pin in force at that point in the list (the
//   chain cannot skip), and at most ONE re-pin per (ticket, file). So once a
//   repair has shipped, the same ticket cannot be reused to re-pin that file
//   a second time — a later edit to a repaired file is drift with no cover.
//
// ── SPENT: closure the door DERIVES, never a date somebody edits ─────────────
//
//   Ruled by the arbiter 2026-09-22: a ticket whose opened files are ALL re-pinned is
//   SPENT — treated as closed without touching its bytes, and refusing further
//   changes under it. The ruling came out of a refusal the door was RIGHT to
//   make: T1 had shipped, and closing it early by editing its `expiresAt` was
//   rejected, because every re-pin cites `ticketSha256` and a ticket's bytes may
//   not change after it has shipped. A ticket is evidence of what was
//   authorised, and evidence that can be edited after the fact is not evidence.
//   So closure moved to where it belongs: the PIN RECORD, which is append-only
//   and which the arbiter cannot quietly re-date.
//
//   A file a ticket opened is SETTLED when either
//     · a re-pin under THAT ticket has shipped for it — USED UP, and the
//       one-re-pin-per-(ticket, file) rule above already forbids a second; or
//     · it stands exactly at its pin — the ticket opened it and the work did not
//       need to change it. Without this second limb one untouched opened file
//       would hold a ticket open until its date, which is the very state SPENT
//       exists to end.
//   A ticket is SPENT once it has shipped AT LEAST ONE re-pin and every file it
//   opened is settled. The one-re-pin floor is what stops a brand-new ticket —
//   every opened file still at its pin, no work done yet — from reading SPENT
//   the instant it is written.
//
//   A SPENT ticket is not live. Drift on a file it opened is REFUSED BY NAME,
//   saying SPENT — not as a generic hash mismatch. That is what closes the
//   OVERLAP TRAP: while T1 and T2 were both open, a change made under T2 could
//   reach a file T1 had opened and ride in on T1's authority long after T1's own
//   work had shipped. Under SPENT it cannot.
//
//   `expiresAt` still does its job. The two compose as WHICHEVER COMES FIRST:
//   SPENT closes a ticket the moment its work is fully pinned, `expiresAt`
//   closes one whose work never shipped or never finished. `expiresAt` also
//   still bounds re-pin validity (`pinnedOn` may not be after it). Both facts
//   are printed on a spent ticket's line, because they are two facts.
//
//   KNOWN RESIDUE, printed here rather than implied: the pin record cannot tell
//   "this opened file was left unchanged because the work did not need it" from
//   "this opened file has not been worked on yet". The second limb of SETTLED
//   resolves that ambiguity toward closure. The cost: for a ticket that opened a
//   file and never re-pinned it, a LATER edit to that file un-settles it and the
//   ticket reads OPEN again until its `expiresAt`. A file that WAS re-pinned
//   stays settled forever, so the trap stays shut on every file a ticket
//   actually repaired — which is every file of T1 and T2. Closing the residue
//   needs a ticket-format change (an explicit "no change needed" re-pin, or a
//   per-file settlement the seat declares), and that is the arbiter's call.
//
// ── WHAT IT CANNOT STOP — printed, not implied ───────────────────────────────
//
//   AUTHORSHIP. "Only the arbiter writes a ticket" is not checkable on this box: every
//   commit in this repository carries the same author line (the shared
//   ~/.gitconfig that the arbiter and every seat commit through) and none is signed.
//   This door therefore does NOT check who wrote a ticket, and it says so on
//   every run (`AUTHORSHIP_NOT_VERIFIED`). The real fix is priced, not built:
//   a signed commit on each ticket (`git verify-commit`, SSH or GPG) with the
//   key in the arbiter's custody — and a check that has a git history to read, which
//   the deployed tree does not have.
//
//   ITS OWN FILES. Anyone who can edit this file, the inventory, or the
//   tickets can make the door say anything. `pinnedOn` is DECLARED, not
//   verified: a seat can write a back-dated re-pin under an expired ticket for
//   a file that ticket names and that was never re-pinned. The control is the arbiter
//   writing tickets plus review of every diff that touches `src/core-door/`;
//   this test makes such a diff necessary and visible. It does not make it
//   impossible.
// ──────────────────────────────────────────────────────────────────────────────

import { createHash } from "crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from "fs";
import { join, relative, resolve } from "path";

/** sha256 of the canonical baseline listing (see `baselineDigest`). Pinned at d743ad6. */
export const PINNED_BASELINE_DIGEST =
  "1bcfac23a9e52583e5a03e24c51af44d9018901f760ed28c5734913ab4c17c3e";

export const CORE_SCOPE = "src/mica";
export const INVENTORY_REL = "src/core-door/core-inventory.json";
export const TICKETS_REL = "src/core-door/tickets";
export const INVENTORY_SCHEMA = "mica-core-door/inventory/1";
export const TICKET_SCHEMA = "mica-core-door/ticket/1";

export const AUTHORSHIP_NOT_VERIFIED =
  "ticket authorship is not verified by this test — every commit here carries the " +
  "same author line and none is signed; a ticket file is trusted as the arbiter's because " +
  "review says so, not because this door checked";

// ── shapes ───────────────────────────────────────────────────────────────────

export interface Ticket {
  readonly schema: string;
  readonly id: string;
  readonly opens: readonly string[];
  readonly defect: { readonly summary: string; readonly ground: string };
  readonly expiresAt: string;
  /**
   * ⛔ THE TIP THIS TICKET'S OWN WORK IS A CHILD OF — OPTIONAL, AND OPTIONAL ONLY
   *    BECAUSE T1…T19 WERE SIGNED BEFORE IT EXISTED. From the arbiter's ruling of
   *    2026-10-03 11:37Z. T19's signed condition 8 named `cceccda` as the base of
   *    its 107-suite comparison; by the time T19 was installed the tip was
   *    `0ff78c9`, because T19's own first install had been REFUSED at the door and
   *    the fix for that refusal landed in between. The condition was true when
   *    written and false when measured, and nothing checked.
   *
   * ⚠ A STAMP ALONE DOES NOT FIX IT, which is why `baseIsCurrent` exists beside
   *   this field. A value written at SIGNING time goes stale exactly the way a
   *   hand-typed one does — the staleness was never in who typed it. What closes
   *   the hole is checking the stamp against `HEAD` at INSTALL, when the parent of
   *   the ticket's own first commit is finally knowable and is simply `HEAD`.
   */
  readonly base?: string;
  readonly arbiter: { readonly word: string; readonly date: string };
  /**
   * Rules the repair must keep, in the arbiter's terms (e.g. "the existing 20
   * frozen scenarios stay byte-identical"). CARRIED AND PRINTED, NOT ENFORCED
   * HERE: each is enforced, if at all, by the test that owns it. May be empty.
   */
  readonly conditions: readonly string[];
}

export interface Repin {
  readonly path: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly ticket: string;
  readonly ticketSha256: string;
  readonly pinnedOn: string;
}

export interface Inventory {
  readonly schema: string;
  readonly scope: string;
  readonly baseline: {
    readonly commit: string;
    readonly pinnedOn: string;
    readonly files: Readonly<Record<string, string>>;
  };
  readonly repins: readonly Repin[];
}

interface LoadedTicket {
  readonly ticket: Ticket;
  readonly sha256: string;
  readonly expiresMs: number;
  readonly issuedMs: number;
}

export interface Drift {
  readonly path: string;
  /** null: the file is not pinned (new). */
  readonly pinned: string | null;
  /** null: the file is pinned but gone. */
  readonly onDisk: string | null;
}

export interface DoorInput {
  /** The tree whose `src/mica/`, inventory and tickets are read. */
  readonly repoRoot: string;
  readonly now: Date;
  readonly expectedBaselineDigest: string;
  /**
   * True when `repoRoot/src/core-door/tickets` is where REAL tickets live.
   * A ticket marked FIXTURE found there is refused: a test fixture must never
   * sit where it could be read as the arbiter's word.
   */
  readonly realTickets: boolean;
}

/**
 * What a ticket IS right now. Four words for four facts, never one for two:
 *
 *   NOT_YET_ISSUED  before `arbiter.date` — it authorises nothing yet.
 *   OPEN            issued, within its date window, work not fully pinned.
 *   SPENT           every file it opened is settled and at least one re-pin
 *                   shipped — closed by the PIN RECORD, whatever the date says.
 *   EXPIRED         past `expiresAt` with work still owed — closed by the CLOCK.
 *
 * SPENT wins over EXPIRED when both hold, because SPENT is why it closed and it
 * closed first; `datePassed` carries the other fact so neither is lost.
 */
export type TicketState = "NOT_YET_ISSUED" | "OPEN" | "SPENT" | "EXPIRED";

export interface TicketStatus {
  readonly id: string;
  readonly state: TicketState;
  readonly expiresAt: string;
  /** Opened files a re-pin under THIS ticket shipped for. Settled, permanently. */
  readonly usedUp: readonly string[];
  /** Opened files standing exactly at their pin. Settled while they stay there. */
  readonly atPin: readonly string[];
  /** Opened files drifted and never re-pinned under this ticket — work still owed. */
  readonly outstanding: readonly string[];
  /** `now` is past `expiresAt`. A fact of its own, kept beside `state`. */
  readonly datePassed: boolean;
}

export type DoorResult =
  | {
      readonly kind: "CLOSED";
      readonly pinned: number;
      readonly states: readonly TicketStatus[];
      readonly lines: readonly string[];
      readonly shippable: true;
    }
  | {
      readonly kind: "OPEN";
      readonly pinned: number;
      readonly live: readonly Ticket[];
      readonly states: readonly TicketStatus[];
      /** Drift covered by a live ticket, not yet re-pinned. */
      readonly unpinnedDrift: readonly Drift[];
      readonly lines: readonly string[];
      readonly shippable: boolean;
    }
  | {
      readonly kind: "REFUSED";
      readonly reasons: readonly string[];
      readonly lines: readonly string[];
      readonly shippable: false;
    };

// ── hashing ──────────────────────────────────────────────────────────────────

export const sha256 = (b: Buffer | string): string =>
  createHash("sha256").update(b).digest("hex");

/**
 * Every entry under `<repoRoot>/src/mica`, repo-relative, hashed.
 *
 * NO SKIP LIST. The inventory tool skips `node_modules` and `dist`; the door
 * does not, because a core file hidden in a directory named `dist` is exactly
 * the file a door must see. A symlink is hashed as its target string, marked,
 * so a file cannot be swapped for a link to elsewhere without drifting.
 * Anything else that is not a file or directory is refused by name.
 */
export function hashCore(repoRoot: string): { files: Map<string, string>; odd: string[] } {
  const files = new Map<string, string>();
  const odd: string[] = [];
  const base = join(repoRoot, CORE_SCOPE);
  const rel = (abs: string): string => relative(repoRoot, abs).split("\\").join("/");
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const st = lstatSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (st.isFile()) files.set(rel(abs), sha256(readFileSync(abs)));
      else if (st.isSymbolicLink()) files.set(rel(abs), sha256("symlink:" + readlinkSync(abs)));
      else odd.push(rel(abs));
    }
  };
  if (existsSync(base)) walk(base);
  return { files, odd };
}

/** The canonical baseline listing: `sha  path\n`, byte-order sorted by path. */
export function baselineDigest(files: Readonly<Record<string, string>>): string {
  const paths = Object.keys(files).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sha256(paths.map((p) => `${files[p]}  ${p}\n`).join(""));
}

// ── parsing, strict: an unknown key is a refusal, not a shrug ────────────────

const HEX64 = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PLACEHOLDER = /<<|>>/;

/**
 * ── WHERE AN UNFILLED DRAFT CAN HIDE, MEASURED RATHER THAN ASSUMED ──────────
 *
 * ⛔ THE CHECK WAS `arbiter.word` ALONE, and I wrote a condition into a T24 draft
 *    claiming a marker in `conditions` would be refused. It would not. Probed
 *    against this door, 2026-10-03, one placement per field:
 *
 *      id             refused  (ID pattern — a marker does not start alphanumeric)
 *      opens[0]       refused  (corePath — not a plain path under src/mica)
 *      defect.summary ACCEPTED  ⛔
 *      defect.ground  ACCEPTED  ⛔
 *      expiresAt      refused  (INSTANT pattern)
 *      arbiter.date   refused  (DATE pattern)
 *      arbiter.word   refused  (this check)
 *      conditions[0]  ACCEPTED  ⛔
 *      base           refused  (40-hex pattern)
 *
 * ⚠ SO THE DOOR WAS MOSTLY SAFE BY ACCIDENT, AND THE ACCIDENT HAS A SHAPE: every
 *   field with a FORMAT refuses a marker as a side effect of its own pattern, and
 *   the only fields that are FREE TEXT are the only fields that were open. A free
 *   text field is the one place an unfilled draft can hide, and both of them were
 *   hiding places. My own board line said "conditions, defect or id"; `id` was
 *   wrong, and three placements in two fields is the measurement.
 *
 * ⚠ AND THE SECOND OPINION SHARED THE FIRST ONE'S EYES: the preflight's
 *   READY FOR SIGNATURE verdict is defined as "exactly one objection and it is the
 *   arbiter.word one", so it reproduced this blind spot faithfully. That is why
 *   this scan runs BEFORE the arbiter.word check: a draft that is BOTH unsigned
 *   and unfilled must report the unfilled field, or the preflight will call it
 *   ready. Unsigned is a state a draft is supposed to be in; unfinished is not.
 *
 * The walk is generic rather than a list of the three open fields, because a list
 * is right only until the next free-text field is added — and `arbiter.word` is
 * skipped by PATH so its own message, which the preflight keys on, is untouched.
 */
const PLACEHOLDER_SKIP = "arbiter.word";

function placeholderPath(value: unknown, path: string): string | null {
  if (path === PLACEHOLDER_SKIP) return null;
  if (typeof value === "string") return PLACEHOLDER.test(value) ? path : null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = placeholderPath(value[i], `${path}[${i}]`);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const hit = placeholderPath((value as Record<string, unknown>)[key], path === "" ? key : `${path}.${key}`);
      if (hit !== null) return hit;
    }
  }
  return null;
}

function exactKeys(o: unknown, keys: readonly string[], what: string): Record<string, unknown> {
  if (typeof o !== "object" || o === null || Array.isArray(o)) throw new Error(`${what} is not an object`);
  const have = Object.keys(o).sort();
  const want = [...keys].sort();
  if (JSON.stringify(have) !== JSON.stringify(want)) {
    throw new Error(`${what} has keys [${have.join(", ")}], expected exactly [${want.join(", ")}]`);
  }
  return o as Record<string, unknown>;
}

function str(v: unknown, what: string, re?: RegExp): string {
  if (typeof v !== "string" || v.trim() === "") throw new Error(`${what} must be a non-empty string`);
  if (re && !re.test(v)) throw new Error(`${what} "${v}" does not match ${String(re)}`);
  return v;
}

function corePath(v: unknown, what: string): string {
  const p = str(v, what);
  if (!p.startsWith(CORE_SCOPE + "/") || p.split("/").some((s) => s === ".." || s === "." || s === "")) {
    throw new Error(`${what} "${p}" is not a plain path under ${CORE_SCOPE}/`);
  }
  return p;
}

function dayMs(d: string): number {
  const ms = Date.parse(d + "T00:00:00Z");
  if (Number.isNaN(ms)) throw new Error(`"${d}" is not a real date`);
  return ms;
}

/**
 * Is this ticket marked FIXTURE, in the door's own sense?
 *
 * ⛔ EXPORTED BECAUSE THE PRE-FLIGHT COULD NOT SEE IT. `tools/ticket-preflight`
 *    imports `parseTicket` precisely so it never restates the schema — and this
 *    guard is NOT in `parseTicket`, it is in `loadTickets`. So a ticket could pass
 *    the pre-flight ("the door's own parser accepts it as-is") and be REFUSED by
 *    the door. Measured 2026-10-03 on the signed T19, whose `id` and whose
 *    arbiter's word both legitimately contain the word "fixtures" because the
 *    ticket is ABOUT fixtures: pre-flight said INSTALLABLE, the door refused.
 *
 *    A PRE-FLIGHT THAT CHECKS ONE OF THE DOOR'S TWO GATES AND REPORTS "THE DOOR
 *    ACCEPTS IT" IS A CAPTION WIDER THAN ITS MEASUREMENT. One predicate, one
 *    source, both callers.
 */
export function fixtureMarked(ticket: Ticket): boolean {
  return /FIXTURE/i.test(ticket.id) || /FIXTURE/i.test(ticket.arbiter.word);
}

export function parseTicket(raw: string, fileStem: string): Ticket {
  // `base` is pulled off BEFORE the exact-keys check, so the seven required keys
  // stay exactly seven and a ticket without a base still parses. Every ticket
  // T1…T19 predates the field; refusing them would close the door on its own
  // history to enforce a rule none of them could have met.
  const whole = JSON.parse(raw) as Record<string, unknown>;
  const rawBase = whole.base;
  if (rawBase !== undefined) delete whole.base;
  const o = exactKeys(whole, ["schema", "id", "opens", "defect", "expiresAt", "arbiter", "conditions"], "ticket");
  if (o.schema !== TICKET_SCHEMA) throw new Error(`schema must be "${TICKET_SCHEMA}"`);
  const id = str(o.id, "id", ID);
  if (id !== fileStem) throw new Error(`id "${id}" does not match its file name "${fileStem}.json"`);
  if (!Array.isArray(o.opens) || o.opens.length === 0) throw new Error("opens must be a non-empty list");
  const opens = o.opens.map((p, i) => corePath(p, `opens[${i}]`));
  if (new Set(opens).size !== opens.length) throw new Error("opens names a file twice");
  const d = exactKeys(o.defect, ["summary", "ground"], "defect");
  const a = exactKeys(o.arbiter, ["word", "date"], "arbiter");
  // The whole ticket, `base` included, minus `arbiter.word` — see placeholderPath.
  const unfilled = placeholderPath(
    rawBase === undefined ? whole : { ...whole, base: rawBase },
    ""
  );
  if (unfilled !== null) {
    throw new Error(
      `${unfilled} still carries a draft marker (\`<<\` or \`>>\`) — an unfilled draft is not a ticket. ` +
        `A ticket may be UNSIGNED, which is what arbiter.word's placeholder says; it may not be UNFINISHED.`
    );
  }
  const word = str(a.word, "arbiter.word");
  if (PLACEHOLDER.test(word)) throw new Error("arbiter.word is still the placeholder — the arbiter's own words go there");
  const date = str(a.date, "arbiter.date", DATE);
  dayMs(date);
  const expiresAt = str(o.expiresAt, "expiresAt (full UTC instant, e.g. 2026-09-29T23:59:59Z)", INSTANT);
  if (Number.isNaN(Date.parse(expiresAt))) throw new Error(`expiresAt "${expiresAt}" is not a real instant`);
  if (Date.parse(expiresAt) <= dayMs(date)) throw new Error("expiresAt is not after the arbiter's date");
  if (!Array.isArray(o.conditions)) throw new Error("conditions must be a list (it may be empty)");
  const conditions = o.conditions.map((c, i) => str(c, `conditions[${i}]`));
  const base = rawBase === undefined ? undefined : str(rawBase, "base (the full 40-hex sha of the tip this ticket's work is a child of)", /^[0-9a-f]{40}$/);
  return {
    schema: TICKET_SCHEMA,
    id,
    opens,
    defect: { summary: str(d.summary, "defect.summary"), ground: str(d.ground, "defect.ground") },
    expiresAt,
    arbiter: { word, date },
    conditions,
    ...(base === undefined ? {} : { base }),
  };
}

export function parseInventory(raw: string): Inventory {
  const o = exactKeys(JSON.parse(raw), ["schema", "scope", "baseline", "repins"], "inventory");
  if (o.schema !== INVENTORY_SCHEMA) throw new Error(`schema must be "${INVENTORY_SCHEMA}"`);
  if (o.scope !== CORE_SCOPE) throw new Error(`scope must be "${CORE_SCOPE}"`);
  const b = exactKeys(o.baseline, ["commit", "pinnedOn", "files"], "baseline");
  const filesRaw = b.files;
  if (typeof filesRaw !== "object" || filesRaw === null || Array.isArray(filesRaw)) {
    throw new Error("baseline.files is not an object");
  }
  const files: Record<string, string> = {};
  for (const [p, h] of Object.entries(filesRaw)) files[corePath(p, "baseline path")] = str(h, `baseline[${p}]`, HEX64);
  if (!Array.isArray(o.repins)) throw new Error("repins must be a list");
  const repins = o.repins.map((r, i): Repin => {
    const x = exactKeys(r, ["path", "from", "to", "ticket", "ticketSha256", "pinnedOn"], `repins[${i}]`);
    const hashOrNull = (v: unknown, w: string): string | null => (v === null ? null : str(v, w, HEX64));
    const rp: Repin = {
      path: corePath(x.path, `repins[${i}].path`),
      from: hashOrNull(x.from, `repins[${i}].from`),
      to: hashOrNull(x.to, `repins[${i}].to`),
      ticket: str(x.ticket, `repins[${i}].ticket`, ID),
      ticketSha256: str(x.ticketSha256, `repins[${i}].ticketSha256`, HEX64),
      pinnedOn: str(x.pinnedOn, `repins[${i}].pinnedOn`, DATE),
    };
    if (rp.from === rp.to) throw new Error(`repins[${i}] moves ${rp.path} nowhere`);
    return rp;
  });
  return {
    schema: INVENTORY_SCHEMA,
    scope: CORE_SCOPE,
    baseline: { commit: str(b.commit, "baseline.commit"), pinnedOn: str(b.pinnedOn, "baseline.pinnedOn", DATE), files },
    repins,
  };
}

function loadTickets(repoRoot: string, realTickets: boolean): Map<string, LoadedTicket> {
  const dir = join(repoRoot, TICKETS_REL);
  const out = new Map<string, LoadedTicket>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const where = `${TICKETS_REL}/${name}`;
    if (!name.endsWith(".json") || !lstatSync(join(dir, name)).isFile()) {
      throw new Error(`${where}: only <id>.json ticket files may live in the tickets directory`);
    }
    const bytes = readFileSync(join(dir, name));
    let ticket: Ticket;
    try {
      ticket = parseTicket(bytes.toString("utf8"), name.slice(0, -".json".length));
    } catch (e) {
      throw new Error(`${where} is not a valid ticket: ${(e as Error).message}`);
    }
    if (realTickets && fixtureMarked(ticket)) {
      throw new Error(`${where} is marked FIXTURE and sits where real tickets live`);
    }
    out.set(ticket.id, {
      ticket,
      sha256: sha256(bytes),
      expiresMs: Date.parse(ticket.expiresAt),
      issuedMs: dayMs(ticket.arbiter.date),
    });
  }
  return out;
}

/**
 * The ticket's DATE WINDOW only: issued on or before `now`, and `now` not past
 * `expiresAt`. Deliberately NOT called "live" any more — a ticket inside its
 * window may still be SPENT, and a spent ticket is not live. One word, one fact.
 */
export function inDateWindow(
  // ⚠ A STRUCTURAL MINIMUM, not `LoadedTicket`. The pre-flight has a parsed ticket
  //   and no pin record, and it must be able to ask the door's own question rather
  //   than ask a copy of it. `LoadedTicket` satisfies this shape, so no call site
  //   here changes. Same move as `bindingMinimumOf`'s verdict parameter.
  t: { readonly issuedMs: number; readonly expiresMs: number },
  nowMs: number
): boolean {
  return t.issuedMs <= nowMs && nowMs <= t.expiresMs;
}

/**
 * The two instants a ticket's OWN BYTES determine, built the way `loadTickets`
 * builds them — so that a caller with a parsed ticket and no pin record can ask
 * `inDateWindow` instead of recomputing it.
 *
 * ⛔ IT EXISTS BECAUSE A CAPTION OUT-RAN ITS MEASUREMENT. The pre-flight reported
 *    `INSTALLABLE` for a ticket whose `expiresAt` was five weeks in the past
 *    (Codex F3, 2026-10-03): the schema accepted it, and the schema is not the
 *    door. `dayMs` is module-private and must stay so; this is the seam that lets
 *    one predicate serve both callers.
 */
export function ticketDateWindow(ticket: Ticket): { readonly issuedMs: number; readonly expiresMs: number } {
  return { issuedMs: dayMs(ticket.arbiter.date), expiresMs: Date.parse(ticket.expiresAt) };
}

/**
 * ⛔ THE STAMP CHECKED WHERE IT CAN STILL BE WRONG. A ticket's `base` names the tip
 *    its work is a child of. At INSTALL the ticket file is in the working tree and
 *    not yet committed, so the parent of its own first commit IS `HEAD` — which
 *    makes this the one moment the claim is both knowable and checkable.
 *
 * Returns `null` when the ticket carries no base (T1…T19): an absent stamp is a
 * fact about the ticket's age, not a failed check, and the two must not collapse
 * into one `false`.
 */
export function baseIsCurrent(ticket: Ticket, headSha: string): boolean | null {
  if (ticket.base === undefined) return null;
  return ticket.base === headSha;
}

/**
 * A ticket's state, derived from the REPLAYED PIN RECORD and the disk — never
 * from the ticket's own bytes, which may not change after it has shipped.
 * See the SPENT section of this file's header for the ruling and the residue.
 *
 * `repinnedHere` is the set of paths a valid re-pin citing THIS ticket moved;
 * `drifted` is the set of paths whose disk bytes differ from the pin in force.
 */
function statusOf(
  t: LoadedTicket,
  repinnedHere: ReadonlySet<string>,
  drifted: ReadonlySet<string>,
  nowMs: number
): TicketStatus {
  const usedUp = t.ticket.opens.filter((p) => repinnedHere.has(p));
  const rest = t.ticket.opens.filter((p) => !repinnedHere.has(p));
  const outstanding = rest.filter((p) => drifted.has(p));
  const atPin = rest.filter((p) => !drifted.has(p));
  const datePassed = nowMs > t.expiresMs;
  // At least one re-pin shipped, and nothing it opened is still owed.
  // A valid re-pin is dated on or after the ticket's issue and not in the
  // future, so `usedUp` is non-empty only for a ticket already issued: SPENT
  // can never mask NOT_YET_ISSUED.
  const spent = usedUp.length > 0 && outstanding.length === 0;
  const state: TicketState = spent
    ? "SPENT"
    : t.issuedMs > nowMs
      ? "NOT_YET_ISSUED"
      : datePassed
        ? "EXPIRED"
        : "OPEN";
  return { id: t.ticket.id, state, expiresAt: t.ticket.expiresAt, usedUp, atPin, outstanding, datePassed };
}

// ── the door ─────────────────────────────────────────────────────────────────

const short = (h: string | null): string => (h === null ? "(absent)" : h.slice(0, 12) + "…");

function refused(reasons: string[]): DoorResult {
  const lines = [
    `CORE DOOR REFUSED — ${reasons.length} reason(s); ${CORE_SCOPE}/ is not what the pinned inventory and its tickets allow`,
    ...reasons.map((r) => `  REFUSED: ${r}`),
    AUTHORSHIP_NOT_VERIFIED,
  ];
  return { kind: "REFUSED", reasons, lines, shippable: false };
}

export function evaluateDoor(input: DoorInput): DoorResult {
  const nowMs = input.now.getTime();

  let inventory: Inventory;
  let tickets: Map<string, LoadedTicket>;
  try {
    inventory = parseInventory(readFileSync(join(input.repoRoot, INVENTORY_REL), "utf8"));
  } catch (e) {
    return refused([`${INVENTORY_REL} unreadable or malformed: ${(e as Error).message}`]);
  }
  try {
    tickets = loadTickets(input.repoRoot, input.realTickets);
  } catch (e) {
    return refused([(e as Error).message]);
  }

  const digest = baselineDigest(inventory.baseline.files);
  if (digest !== input.expectedBaselineDigest) {
    return refused([
      `the inventory's baseline digests to ${short(digest)}, the door pins ${short(input.expectedBaselineDigest)} — ` +
        `a baseline hash was edited; a core change moves its pin only by a re-pin under a ticket`,
    ]);
  }

  // Replay the re-pins, in order, onto the baseline.
  const pins = new Map<string, string>(Object.entries(inventory.baseline.files));
  const used = new Set<string>();
  const shipped: string[] = [];
  const bad: string[] = [];
  inventory.repins.forEach((r, i) => {
    const at = `re-pin #${i + 1} of ${r.path} cites ticket ${r.ticket}`;
    const t = tickets.get(r.ticket);
    if (t === undefined) return void bad.push(`${at}, which does not exist in ${TICKETS_REL}/`);
    if (!t.ticket.opens.includes(r.path)) return void bad.push(`${at}, which does not name that file`);
    if (t.sha256 !== r.ticketSha256) {
      return void bad.push(`${at}, but the ticket's bytes changed since (${short(t.sha256)} ≠ ${short(r.ticketSha256)})`);
    }
    const onMs = dayMs(r.pinnedOn);
    if (onMs < t.issuedMs) return void bad.push(`${at}, dated ${r.pinnedOn}, before the ticket was issued`);
    if (onMs > t.expiresMs) return void bad.push(`${at}, dated ${r.pinnedOn}, after the ticket expired ${t.ticket.expiresAt}`);
    if (onMs > nowMs) return void bad.push(`${at}, dated ${r.pinnedOn}, which is in the future`);
    const key = `${r.ticket}\u0000${r.path}`;
    if (used.has(key)) return void bad.push(`${at} a second time — one re-pin per ticket per file`);
    used.add(key);
    const current = pins.get(r.path) ?? null;
    if (current !== r.from) return void bad.push(`${at}, from ${short(r.from)}, but the pin in force is ${short(current)}`);
    if (r.to === null) pins.delete(r.path);
    else pins.set(r.path, r.to);
    shipped.push(`  RE-PINNED (repair shipped): ${r.path} under ticket ${r.ticket} on ${r.pinnedOn}, ${short(r.from)} → ${short(r.to)}`);
  });
  if (bad.length > 0) return refused(bad);

  // Compare the disk with the pins.
  const { files: disk, odd } = hashCore(input.repoRoot);
  if (odd.length > 0) return refused(odd.map((p) => `${p} is neither a file, a directory, nor a symlink`));
  const drift: Drift[] = [];
  for (const p of [...new Set([...pins.keys(), ...disk.keys()])].sort()) {
    const pinned = pins.get(p) ?? null;
    const onDisk = disk.get(p) ?? null;
    if (pinned !== onDisk) drift.push({ path: p, pinned, onDisk });
  }

  // ── ticket state, derived from the pin record (see header: SPENT) ──────────
  const all = [...tickets.values()];
  const drifted = new Set(drift.map((d) => d.path));
  const repinnedBy = new Map<string, Set<string>>();
  for (const r of inventory.repins) {
    // Every re-pin reaching here was validated above (`bad` is empty).
    const s = repinnedBy.get(r.ticket) ?? new Set<string>();
    s.add(r.path);
    repinnedBy.set(r.ticket, s);
  }
  const EMPTY: ReadonlySet<string> = new Set<string>();
  const states = all.map((t) => statusOf(t, repinnedBy.get(t.ticket.id) ?? EMPTY, drifted, nowMs));
  const stateOf = new Map(states.map((s) => [s.id, s]));
  // LIVE means OPEN. A ticket inside its date window but SPENT is not live.
  const live = all.filter((t) => stateOf.get(t.ticket.id)?.state === "OPEN");

  const uncovered: string[] = [];
  for (const d of drift) {
    if (live.some((t) => t.ticket.opens.includes(d.path))) continue;
    const why =
      all.length === 0
        ? "there are no tickets"
        : all
            .map((t) => {
              if (!t.ticket.opens.includes(d.path)) return `ticket ${t.ticket.id} does not name this file`;
              const s = stateOf.get(t.ticket.id) as TicketStatus;
              switch (s.state) {
                case "SPENT":
                  return (
                    `ticket ${t.ticket.id} names it but is SPENT — every file it opened is settled ` +
                    `(${s.usedUp.length} re-pinned under it${s.atPin.length > 0 ? `, ${s.atPin.length} left at its pin` : ""}), ` +
                    `so it authorises nothing further; its bytes are unchanged and stay as signed` +
                    (s.datePassed ? `, and its ${s.expiresAt} has also passed` : `, and it closed before its ${s.expiresAt}`)
                  );
                case "EXPIRED":
                  return `ticket ${t.ticket.id} names it but EXPIRED ${t.ticket.expiresAt}`;
                case "NOT_YET_ISSUED":
                  return `ticket ${t.ticket.id} names it but is not issued until ${t.ticket.arbiter.date}`;
                case "OPEN":
                  // Unreachable: an OPEN ticket naming this path covered it above.
                  return `ticket ${t.ticket.id} names it and is OPEN`;
              }
            })
            .join("; ");
    const what = d.pinned === null ? "is not pinned (new file)" : d.onDisk === null ? "is pinned but gone" : "drifted";
    uncovered.push(`DRIFT ${d.path} ${what}: pinned ${short(d.pinned)}, on disk ${short(d.onDisk)} — no ticket covers it: ${why}`);
  }
  if (uncovered.length > 0) return refused(uncovered);

  const pinned = pins.size;
  const repinNote =
    inventory.repins.length === 0
      ? `  baseline ${inventory.baseline.commit.slice(0, 7)}, no re-pins`
      : `  baseline ${inventory.baseline.commit.slice(0, 7)} + ${inventory.repins.length} re-pin(s)`;
  // Every ticket that is not OPEN says so in its own words — a human reads this.
  const closedTickets = states
    .filter((s) => s.state !== "OPEN")
    .map((s) => {
      switch (s.state) {
        case "SPENT":
          return (
            `  ticket ${s.id} SPENT — all ${s.usedUp.length + s.atPin.length} file(s) it opened are settled ` +
            `(${s.usedUp.length} re-pinned under it${s.atPin.length > 0 ? `, ${s.atPin.length} left at its pin` : ""}); ` +
            `it authorises nothing further, and its bytes are unchanged. ` +
            (s.datePassed
              ? `Its expiresAt ${s.expiresAt} has also passed.`
              : `Its expiresAt ${s.expiresAt} has not been reached — the pin record closed it early.`)
          );
        case "EXPIRED":
          return (
            `  ticket ${s.id} EXPIRED ${s.expiresAt} — authorises nothing` +
            (s.outstanding.length > 0
              ? `; ${s.outstanding.length} file(s) it opened drifted and were never re-pinned`
              : "")
          );
        case "NOT_YET_ISSUED":
          return `  ticket ${s.id} NOT YET ISSUED — authorises nothing yet`;
        default:
          return `  ticket ${s.id} ${s.state}`;
      }
    });

  if (live.length === 0) {
    return {
      kind: "CLOSED",
      pinned,
      states,
      shippable: true,
      lines: [`core CLOSED, ${pinned} files pinned`, repinNote, ...shipped, ...closedTickets, AUTHORSHIP_NOT_VERIFIED],
    };
  }

  const lines: string[] = [];
  for (const t of live) {
    lines.push(`core OPEN under ticket ${t.ticket.id} for ${t.ticket.opens.join(", ")}, expires ${t.ticket.expiresAt}`);
    const under = drift.filter((d) => t.ticket.opens.includes(d.path));
    for (const c of t.ticket.conditions) lines.push(`  condition (carried, not enforced by this door): ${c}`);
    if (under.length === 0) lines.push("  nothing has drifted under it");
    for (const d of under) {
      lines.push(`  DRIFTED UNDER TICKET, NOT YET RE-PINNED: ${d.path} ${short(d.pinned)} → ${short(d.onDisk)}`);
    }
  }
  lines.push(`  ${pinned} files pinned`, repinNote, ...shipped, ...closedTickets);
  lines.push(
    drift.length === 0
      ? "SHIPPABLE — every byte under src/mica/ matches its pin"
      : `NOT SHIPPABLE — ${drift.length} file(s) drifted under a live ticket and are not re-pinned; ` +
          "re-pin them in the same commit as the repair (--propose-repin)"
  );
  lines.push(AUTHORSHIP_NOT_VERIFIED);
  return {
    kind: "OPEN",
    pinned,
    live: live.map((t) => t.ticket),
    states,
    unpinnedDrift: drift,
    lines,
    shippable: drift.length === 0,
  };
}

/** The door over a real tree, with the real pin. What both suites call. */
export function evaluateRealDoor(repoRoot: string, now: Date = new Date()): DoorResult {
  // ⛔ A MISSING ROOT MUST NOT READ AS A VERDICT. TypeScript requires this
  //    argument, so no in-tree caller can omit it — but an untyped caller can,
  //    and on 2026-10-02 a seat's own `node -e` did. `evaluateDoor` then joined
  //    `undefined` with the inventory path, failed to read it, and returned
  //    `shippable: false`: COULD NOT READ reported as NOT SHIPPABLE, inside the
  //    door whose whole purpose is to keep those two apart. What saved that seat
  //    was `requireShippable` crashing on `door.lines`, i.e. a crash rather than
  //    a reading. One line removes the hazard; the paragraph is longer than the
  //    fix because the confusion is the project's own subject matter.
  if (typeof repoRoot !== "string" || repoRoot === "") {
    throw new Error(
      "evaluateRealDoor(repoRoot) requires the repository root. A door that cannot find the " +
        "repository has NOT READ the core and must not report on its shippability."
    );
  }
  return evaluateDoor({ repoRoot, now, expectedBaselineDigest: PINNED_BASELINE_DIGEST, realTickets: true });
}

/**
 * The acceptance's rule, as one call: print the door's lines, then throw
 * unless the core is SHIPPABLE (CLOSED, or OPEN with every drift re-pinned).
 * `glue.test.ts` calls exactly this, so the rule is unit-tested here rather
 * than only in a six-minute suite that cannot be handed a drifted core.
 */
export function requireShippable(door: DoorResult, print: (line: string) => void): void {
  for (const line of door.lines) print(`      ${line}`);
  if (!door.shippable) {
    throw new Error(`the core door is ${door.kind} and NOT SHIPPABLE — see the lines above`);
  }
}

// ── CLI: prints, writes nothing ──────────────────────────────────────────────

/** Repin entries for the drift a ticket covers, for a seat to paste in the same commit. */
export function proposeRepins(
  repoRoot: string,
  ticketId: string,
  today: string,
  realTickets = true
): Repin[] {
  const inventory = parseInventory(readFileSync(join(repoRoot, INVENTORY_REL), "utf8"));
  const tickets = loadTickets(repoRoot, realTickets);
  const t = tickets.get(ticketId);
  if (t === undefined) throw new Error(`no ticket ${ticketId} in ${TICKETS_REL}/`);
  const pins = new Map<string, string>(Object.entries(inventory.baseline.files));
  const alreadyUsedUp = new Set<string>();
  for (const r of inventory.repins) {
    if (r.ticket === ticketId) alreadyUsedUp.add(r.path);
    if (r.to === null) pins.delete(r.path);
    else pins.set(r.path, r.to);
  }
  const { files: disk } = hashCore(repoRoot);
  return t.ticket.opens
    // A file this ticket has already re-pinned is USED UP: one re-pin per
    // (ticket, file), so proposing a second would hand the seat an entry the
    // door refuses. A spent ticket therefore proposes nothing.
    .filter((path) => !alreadyUsedUp.has(path))
    .map((path) => ({ path, from: pins.get(path) ?? null, to: disk.get(path) ?? null }))
    .filter((x) => x.from !== x.to)
    .map((x) => ({ ...x, ticket: ticketId, ticketSha256: t.sha256, pinnedOn: today }));
}

function main(argv: readonly string[]): number {
  const repoRoot = resolve(__dirname, "..", "..");
  if (argv[0] === "--pin-baseline") {
    const { files, odd } = hashCore(repoRoot);
    if (odd.length > 0) throw new Error(`unpinnable entries: ${odd.join(", ")}`);
    const obj = Object.fromEntries([...files.entries()]);
    process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
    process.stdout.write(`# ${files.size} files, baseline digest ${baselineDigest(obj)}\n`);
    return 0;
  }
  if (argv[0] === "--propose-repin") {
    const id = argv[1];
    if (!id) throw new Error("--propose-repin needs a ticket id");
    const today = new Date().toISOString().slice(0, 10);
    process.stdout.write(JSON.stringify(proposeRepins(repoRoot, id, today), null, 2) + "\n");
    return 0;
  }
  const result = evaluateRealDoor(repoRoot);
  for (const l of result.lines) console.log(l);
  return result.kind === "REFUSED" ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
