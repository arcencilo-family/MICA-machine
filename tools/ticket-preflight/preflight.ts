// ── MICA · ticket pre-flight — validate a draft with THE DOOR'S OWN parser ────
//
// WHY THIS EXISTS, AND IT COST A SIGNATURE. On 2026-10-02 the arbiter signed T17
// and the core door REFUSED it: `defect has keys [costIsNearlyZero, notAGate,
// partTwo, summary, whyItMatters], expected exactly [ground, summary]`. The seat
// had drafted T16 and T17 modelled on T15 — which IS correctly shaped — and then
// added thirteen keys across them, every one of them more reasoning poured into
// the artefact. The door's exact-keys rule exists to refuse an essay dressed as a
// ticket, and it did, one step after the signature.
//
// ⛔ AND A MALFORMED TICKET REFUSES THE WHOLE DOOR. `parseTicket` throws, so the
//    door returns REFUSED for every file and every other live ticket on the line.
//    Installing an unvalidated ticket does not risk one act; it stops the line.
//
// ⚠ IT IMPORTS THE DOOR'S `parseTicket`. It does NOT restate the schema. A second
//   copy of the ticket shape beside the first is the exact seam this project has
//   paid for nine times — a producer, a hand-written projection carrying fewer
//   entries, and a reader that needs one of the missing ones. If the door's shape
//   changes, this changes with it, because there is one shape and this is not a
//   second one.
//
// THE REPORT IT GIVES, and the three states are different things:
//   INSTALLABLE         — parses clean AND is marked FIXTURE nowhere. ⚠ IT MEANS
//                         THE SCHEMA AND THE FIXTURE GATE AND NOTHING ELSE; the
//                         INSTALL GATE below is printed beside it and is a separate
//                         answer, because a ticket can be perfectly shaped and dead.
//   READY FOR SIGNATURE — the ONLY objection is `arbiter.word is still the
//                         placeholder`. That is what a correct DRAFT looks like.
//   MALFORMED           — anything else. Do not hand this to the arbiter.
//
// ⚠ AND IT ENUMERATES, because `parseTicket` throws on the FIRST violation. After
//   each one it applies the minimal shape fix IN MEMORY and re-parses, so a file
//   with four faults reports four rather than one-at-a-time across four rounds.
//   The file on disk is never written.
//
// USAGE — IT LIVES IN THE TREE NOW, AND THAT WAS THE POINT.
//   node node_modules/ts-node/dist/bin.js tools/ticket-preflight/preflight.ts --census
//   node node_modules/ts-node/dist/bin.js tools/ticket-preflight/preflight.ts <file.json> [...]
//   node node_modules/ts-node/dist/bin.js tools/ticket-preflight/preflight.ts --stamp <draft.json>
//
// ⛔ WHY IT MOVED HERE FROM ~/mica-relay/. It was written in the seat's own relay
//    directory, which closed half the defect: the defect was "no pre-flight
//    existed", and a tool only one seat can run is a tool the next seat will not
//    run. The arbiter's ruling of 2026-10-02 16:27Z made it the rule — "every
//    draft handed for signature carries its preflight state" — and a rule needs
//    to live where any seat and any reviewer can execute it, beside
//    tools/opens-sweep.
//
// ⚠ AND IT NO LONGER NEEDS `-P <repo>/tsconfig.json`. The out-of-tree copy died on
//   TS5109 before reading a single ticket, because a .ts file outside the tree
//   inherits nothing from the tree. That cost two separate debugging rounds, here
//   and on an op3 probe; being inside the tree is what removes it.
//
// ⚠ AND A DRAFT HAS EXACTLY ONE CORRECT WAY TO BE REFUSED. T15's convention puts
//   the `<<`/`>>` marker in `arbiter.word` ALONE, and the door then says
//   "arbiter.word is still the placeholder" — which names the file as UNSIGNED.
//   The seat also put markers in `opens` on an earlier T16 draft, and the door
//   says `opens[8] "<<THIS LIST IS A FLOOR…>>" is not a plain path under
//   src/mica/` — which reads as a MALFORMED ticket, not an unsigned one. Two
//   mechanisms, one misleading message. Markers belong in `arbiter.word`.
// EXIT: 0 every file is INSTALLABLE or READY FOR SIGNATURE **and** its install gate
//       is clean · 1 any MALFORMED · 2 usage · 3 schema-clean but NOT INSTALLABLE
//       NOW (expired, not yet issued, or a stale `base` stamp).
//
// ⚠ 3 IS A SEPARATE CODE ON PURPOSE. An expired ticket is not a malformed one, and
//   `--census` over installed history will return 3 the day the first ticket
//   expires — which is true, and must not read as "a ticket is broken".

import { readFileSync, readdirSync, writeFileSync } from "fs";
import { basename, join, resolve } from "path";

const argv = process.argv.slice(2);
if (require.main === module && argv.length < 1) {
  console.error("usage: preflight.ts <ticket.json>... | --census");
  process.exit(2);
}
// ⛔ THE REPO ROOT IS DERIVED FROM THIS FILE'S OWN LOCATION, never passed in. A
//    path argument is a path that can be wrong, and a pre-flight pointed at the
//    wrong repo would validate against the wrong door.
const ROOT = resolve(__dirname, "..", "..");

import { execFileSync } from "child_process";

import {
  CORE_SCOPE,
  Ticket,
  baseIsCurrent,
  fixtureMarked,
  inDateWindow,
  parseTicket,
  ticketDateWindow,
} from "../../src/core-door/core-door";

const TOP = ["schema", "id", "opens", "defect", "expiresAt", "arbiter", "conditions"];
const PLACEHOLDER_MSG = "arbiter.word is still the placeholder";

/** The three states, and they are different things. */
export type PreflightState = "INSTALLABLE" | "READY FOR SIGNATURE" | "MALFORMED";

/**
 * ⛔ EXPORTED SO IT CAN BE TESTED AS LOGIC RATHER THAN AS A CLI. A pre-flight
 *    whose only interface is a process is a pre-flight whose own behaviour is
 *    checked by reading its output, which is the thing this tool exists to stop
 *    people doing with tickets.
 */
export function preflightState(v: ReadonlyArray<string>): PreflightState {
  if (v.length === 0) return "INSTALLABLE";
  if (v.length === 1 && v[0].includes(PLACEHOLDER_MSG)) return "READY FOR SIGNATURE";
  return "MALFORMED";
}

// ── THE INSTALL GATE — the door's OTHER checks, which the schema is not ──────────
//
// ⛔ WHY IT EXISTS, AND IT IS THE SAME DEFECT THIS FILE'S HEADER ALREADY NAMES ONCE.
//    Codex, 2026-10-03: load T19, set `arbiter.date` to 2026-09-01 and `expiresAt`
//    to 2026-09-02T18:00:00Z, and this tool answered `{"violations":[],"preflight":
//    "INSTALLABLE"}` — on 2026-10-03, five weeks past the expiry. The schema
//    accepted it because the schema's job is shape, and `expiresAt is not after the
//    arbiter's date` was satisfied: both dates moved together. **A ticket can be
//    perfectly shaped and dead.** "INSTALLABLE" claimed the door would take it.
//
// ⚠ THE FIX IS NOT A BETTER CAPTION. Codex offered either — caption the state as
//   "schema and fixture-marker ready, subject to date/door state", or check the
//   state. A caption that says "subject to checks I did not run" is a disclosure
//   where a check belongs, and this campaign has named that defect four times under
//   its own name. So: the checks run, and the caption narrows anyway.
//
// WHAT IT DOES **NOT** CHECK, printed rather than implied: the inventory, the pin
// record, drift, and whether the paths in `opens` exist. Those need the repo's
// state and the door's full evaluation, and `evaluateRealDoor` is the thing that
// answers them. This gate answers exactly two questions — is the ticket inside its
// own date window, and is its `base` stamp still HEAD.

/**
 * The ruling's own date. A ticket whose `arbiter.date` is STRICTLY after this must
 * carry a base; one dated on or before it predates the field. T19 is dated
 * 2026-10-03 and is therefore exempt by one day, which is correct — it is the
 * ticket whose failure produced the rule, not the first ticket bound by it.
 */
export const STAMP_RULE_FROM = "2026-10-03";

/**
 * ⛔ IS THIS A REAL CALENDAR DATE? Codex, 2026-10-03, on 09ab195: the door's `DATE`
 *    pattern checks the SHAPE and `dayMs` then hands back whatever JavaScript makes
 *    of it, so an impossible day rolls silently into the next month.
 *
 * ⚠ AND THE FINDING IS WIDER THAN "A LEAP DAY". Measured, six probes:
 *     2027-02-29  → ACCEPTED (2027 is not a leap year)
 *     2026-02-30  → ACCEPTED
 *     2026-04-31  → ACCEPTED (April has thirty days)
 *     2026-13-01  → refused ("is not a real date")
 *     2026-00-10  → refused
 *     2026-02-28  → accepted, correctly
 *   The MONTH is range-checked and the DAY is not checked against the month's
 *   length. Three of the six pass. So this is not the leap year; it is every
 *   short-month overflow, and the leap day is one instance.
 *
 * Returns the day in UTC milliseconds, or null when the text is not the date it
 * claims to be. The test is a ROUND TRIP: build the date, render it back, compare.
 * Nothing else distinguishes "2026-02-30" from the 2nd of March.
 */
export function calendarDayMs(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (m === null) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  if (Number.isNaN(ms)) return null;
  const back = new Date(ms);
  const rendered =
    `${String(back.getUTCFullYear()).padStart(4, "0")}-` +
    `${String(back.getUTCMonth() + 1).padStart(2, "0")}-` +
    `${String(back.getUTCDate()).padStart(2, "0")}`;
  return rendered === date ? ms : null;
}

export type WindowState = "IN WINDOW" | "EXPIRED" | "NOT YET ISSUED";
export type BaseState =
  | "STAMPED AND CURRENT"
  | "STAMPED, CORE UNMOVED"
  | "STAMPED BUT STALE"
  | "STAMPED, NOT AN ANCESTOR"
  | "STAMPED, RELATION UNKNOWN"
  | "UNSTAMPED"
  | "STAMPED, HEAD UNKNOWN";

/**
 * ── T23 · WHAT A STALE STAMP ACTUALLY MEANS ────────────────────────────────
 *
 * ⛔ TWO INCIDENTS IN TWO TICKS PAID FOR THIS. T24's draft was stamped at
 *    a506e89; `f5ca85c` landed (the door's unfilled-draft widening) and the gate
 *    read STAMPED BUT STALE, so the draft was re-derived with two full sweep arms
 *    and re-stamped. Then `f71e685` landed (the sweep's own caption fix) and it
 *    went stale AGAIN — while `f5ca85c..f71e685` touches `tools/opens-sweep` and
 *    NOTHING under src/mica. The derivation it protects could not have moved, and
 *    the gate refused it anyway.
 *
 * ⚠ AND THE OLD RULE SPELLED TWO VERY DIFFERENT FAULTS THE SAME WAY. A base one
 *   commit behind and a base on an abandoned branch both read "not HEAD". The
 *   second is the worse fault and had no name.
 *
 * THE RULE: `base === HEAD` is best. Otherwise the base must be an ANCESTOR of
 * HEAD and `git diff base..HEAD -- src/mica` must be EMPTY. That preserves T19's
 * protection exactly — T19's base was wrong BECAUSE core files moved in between,
 * and that case still refuses, now NAMING them — while not punishing a commit
 * that cannot have changed what the ticket opens.
 *
 * ⚠ DENY BY DEFAULT: a relation that cannot be determined is REFUSED, never read
 *   as "unmoved". The same rule the bridge's role helper was repaired to obey.
 */
export interface BaseRelation {
  readonly isAncestor: boolean;
  /** Paths under CORE_SCOPE that changed between base and HEAD. */
  readonly coreMoved: readonly string[];
  /** Every path that changed, so an acceptance can say what DID move. */
  readonly allMoved: readonly string[];
}

/** The relation, from git. `null` when git could not answer — which refuses. */
export function baseRelation(root: string, base: string, head: string): BaseRelation | null {
  const git = (args: readonly string[]): string | null => {
    try {
      return execFileSync("git", ["-C", root, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  };
  // `merge-base --is-ancestor` answers by EXIT CODE, so a throw is the honest
  // "no" and an unreadable repo is indistinguishable from it — which is why the
  // object existence is probed first.
  if (git(["cat-file", "-e", `${base}^{commit}`]) === null) return null;
  if (git(["cat-file", "-e", `${head}^{commit}`]) === null) return null;
  let isAncestor = false;
  try {
    execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", base, head], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    isAncestor = true;
  } catch {
    isAncestor = false;
  }
  const diff = git(["diff", "--name-only", `${base}..${head}`]);
  if (diff === null) return null;
  const allMoved = diff === "" ? [] : diff.split("\n");
  return {
    isAncestor,
    coreMoved: allMoved.filter((f) => f === CORE_SCOPE || f.startsWith(`${CORE_SCOPE}/`)),
    allMoved,
  };
}

export interface InstallGate {
  readonly windowState: WindowState;
  readonly baseState: BaseState;
  /** Empty means: the door's date window and the base stamp both pass, now. */
  readonly objections: readonly string[];
  /** T23 · the base relation this reading used, or null when none was supplied. */
  readonly relation: BaseRelation | null;
}

/**
 * ⛔ `headSha` IS PASSED IN, NEVER READ IN HERE. A gate that shells out to git
 *    cannot be tested against a tip that is not the tip, and the one case that
 *    matters — a stamp that has gone stale — is exactly a tip that is not the tip.
 *    `null` means the caller could not determine HEAD, which is its own answer.
 */
export function installGate(
  ticket: Ticket,
  nowMs: number,
  headSha: string | null,
  // T23 · injected rather than read here, for the reason every other probe in
  // this house is injected: this function JUDGES and does not do IO. Absent means
  // "not determined", which REFUSES — see BaseRelation.
  relation?: BaseRelation | null
): InstallGate {
  const objections: string[] = [];
  // ⛔ FIRST, because every window fact below is computed FROM this date. An
  //    impossible day does not fail — it rolls, so `issuedMs` names a day the
  //    ticket does not. The door accepts such a ticket today; this gate refuses to
  //    install it and says plainly that the two disagree.
  const real = calendarDayMs(ticket.arbiter.date);
  if (real === null) {
    const rolled = new Date(Date.parse(`${ticket.arbiter.date}T00:00:00Z`));
    objections.push(
      `arbiter.date "${ticket.arbiter.date}" is not a real calendar date` +
        (Number.isNaN(rolled.getTime())
          ? ", and the window below cannot be computed from it."
          : ` — it rolls to ${rolled.toISOString().slice(0, 10)}, so every window fact below is about a day this ticket does not name.`) +
        " ⚠ THE DOOR ACCEPTS THIS TICKET: its DATE pattern checks the shape only. This gate refuses the install; the door-side check is owed."
    );
  }
  const w = ticketDateWindow(ticket);
  let windowState: WindowState;
  if (inDateWindow(w, nowMs)) {
    windowState = "IN WINDOW";
  } else if (nowMs > w.expiresMs) {
    windowState = "EXPIRED";
    objections.push(
      `EXPIRED ${ticket.expiresAt} — the door's inDateWindow refuses it now. ` +
        `The schema cannot see this: expiresAt is after the arbiter's date, so the shape is correct and the ticket is dead.`
    );
  } else {
    windowState = "NOT YET ISSUED";
    objections.push(
      `NOT YET ISSUED — arbiter.date ${ticket.arbiter.date} is in the future, so the door's window has not opened.`
    );
  }

  const current = baseIsCurrent(ticket, headSha ?? "");
  let baseState: BaseState;
  if (current === false && headSha !== null) {
    // ── T23 · not HEAD is three answers, not one ────────────────────────────
    if (relation === undefined || relation === null) {
      baseState = "STAMPED, RELATION UNKNOWN";
      objections.push(
        `base ${ticket.base} is not HEAD (${headSha}) and the relation between them could not be ` +
          `determined, so this gate cannot tell a base one commit behind from a base on an ` +
          `abandoned branch. UNDETERMINED IS REFUSED, never read as "nothing moved".`
      );
    } else if (!relation.isAncestor) {
      baseState = "STAMPED, NOT AN ANCESTOR";
      objections.push(
        `base ${ticket.base} is NOT AN ANCESTOR of HEAD (${headSha}) — it is not on this history at ` +
          `all, so the tip this ticket's work is a child of is not behind the tip it would install ` +
          `on. A rewritten or abandoned branch reads exactly like a base one commit behind under ` +
          `the old rule; it is the worse fault and this is its own name.`
      );
    } else if (relation.coreMoved.length > 0) {
      baseState = "STAMPED BUT STALE";
      objections.push(
        `base ${ticket.base} is an ancestor of HEAD (${headSha}), but ${relation.coreMoved.length} ` +
          `file(s) under ${CORE_SCOPE}/ moved in between, so the derivation this stamp vouches for is ` +
          `measured against the wrong tree: ${relation.coreMoved.join(", ")}. ` +
          `T19 is why: its condition named cceccda, 0ff78c9 landed in between, and the condition was ` +
          `measured against the wrong one. Re-derive, then re-stamp.`
      );
    } else {
      // ACCEPTED, and the acceptance SAYS WHY — a silent relaxation is how a gate
      // stops being one.
      baseState = "STAMPED, CORE UNMOVED";
    }
  } else if (current === null) {
    baseState = "UNSTAMPED";
    // ⛔ AND A NOTE IS NOT A GATE. The ruling says the stamp is required "from the
    //    next ticket on", and a rule that lives in a ⚠ line is a disclosure where a
    //    check belongs — this campaign has named that defect under its own name four
    //    times. So the rule is mechanical and dated: a ticket the arbiter signed
    //    AFTER the rule must carry a base; T1…T19, all dated on or before it, are
    //    not faulted for a field that did not exist when they were signed.
    if (ticket.arbiter.date > STAMP_RULE_FROM) {
      objections.push(
        `no \`base\` stamp, and arbiter.date ${ticket.arbiter.date} is after ${STAMP_RULE_FROM} — ` +
          "every ticket signed after the ruling of 2026-10-03 carries the tip its work is a child of. " +
          "Stamp the DRAFT with `--stamp <file>` before the arbiter signs it."
      );
    }
  } else if (headSha === null) {
    baseState = "STAMPED, HEAD UNKNOWN";
    objections.push(
      `base ${ticket.base} cannot be checked — HEAD was not determined, so the one thing the stamp is for is the one thing unverified.`
    );
  } else {
    baseState = "STAMPED AND CURRENT";
  }
  return { windowState, baseState, objections, relation: relation ?? null };
}

/** HEAD, or null. A tool that cannot read HEAD must say so, never assume one. */
export function headShaOf(root: string): string | null {
  try {
    const out = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    return /^[0-9a-f]{40}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

/**
 * The ticket as the door would parse it, for gate purposes only — a DRAFT's
 * placeholder word is substituted in memory so that a draft's dates and base can
 * be reported too. Returns null when no substitution makes it parse.
 *
 * ⚠ THE SENTINEL MUST NOT MATCH /FIXTURE/i, or this helper would manufacture the
 *   very violation the second gate exists to catch.
 */
export function parseForGate(raw: string, stem: string): Ticket | null {
  try {
    return parseTicket(raw, stem);
  } catch { /* fall through to the draft path */ }
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const a = (o.arbiter ?? {}) as Record<string, unknown>;
    o.arbiter = { ...a, word: "UNSIGNED DRAFT, SUBSTITUTED IN MEMORY BY THE PRE-FLIGHT" };
    return parseTicket(JSON.stringify(o), stem);
  } catch {
    return null;
  }
}

/**
 * ⛔ THE STAMP ITSELF — the ruling's own verb, and it writes. This is the ONE place
 *    this tool touches a file, and it refuses three things rather than one:
 *
 *    · a ticket that is already SIGNED. The arbiter signs BYTES; a tool that edits
 *      a signed ticket has changed what was granted, whatever it wrote. A stamp
 *      belongs to the draft, before the sentence.
 *    · a ticket that already carries a DIFFERENT base. Overwriting one silently is
 *      how a stale value becomes a fresh-looking one.
 *    · a HEAD it could not read. Stamping "unknown" is worse than not stamping.
 *
 * ⚠ IT REWRITES THE WHOLE FILE as 2-space JSON. On a draft that is harmless and the
 *   byte delta is printed; on anything signed it never runs.
 */
export function stampedWith(raw: string, headSha: string | null): string {
  if (headSha === null) throw new Error("refusing to stamp: HEAD could not be read");
  if (!/^[0-9a-f]{40}$/.test(headSha)) throw new Error(`refusing to stamp: "${headSha}" is not a full sha`);
  const o = JSON.parse(raw) as Record<string, unknown>;
  const word = ((o.arbiter ?? {}) as Record<string, unknown>).word;
  if (typeof word !== "string" || !/<<|>>/.test(word)) {
    throw new Error(
      "refusing to stamp: this ticket is SIGNED (arbiter.word carries no placeholder). " +
        "The arbiter signs bytes; a base is stamped into a DRAFT, never into a grant."
    );
  }
  if (typeof o.base === "string" && o.base !== headSha) {
    throw new Error(`refusing to stamp: it already carries base ${o.base}, which is not HEAD ${headSha} — re-derive the draft, do not overwrite the stamp`);
  }
  // rebuilt in the interface's own key order, with `base` after `expiresAt`
  const out: Record<string, unknown> = {};
  for (const k of ["schema", "id", "opens", "defect", "expiresAt"]) if (k in o) out[k] = o[k];
  out.base = headSha;
  for (const k of Object.keys(o)) if (!(k in out)) out[k] = o[k];
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** Every violation, by applying each minimal shape fix in memory and re-parsing. */
export function violations(raw: string, stem: string): string[] {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch (e) {
    return [`not JSON at all: ${(e as Error).message}`];
  }
  const found: string[] = [];
  // ⛔ THE FIXTURE GATE, READ FROM THE RAW `id` BEFORE ANY PARSE — because the
  //    parse is exactly what hides it on a draft. `fixtureMarked` is checked
  //    below, AFTER `parseTicket` succeeds; a draft's placeholder word makes
  //    `parseTicket` THROW, so the gate that exists because T19 slipped through
  //    was unreachable at the only moment it would help.
  //
  // ⚠ MEASURED 2026-10-04, ON T25: the signed ticket read `✗ MALFORMED · is
  //   marked FIXTURE`, and the IDENTICAL ticket with a placeholder word read
  //   `✓ READY FOR SIGNATURE` — same offending id, `T25-sig-f3-fixture-names-
  //   its-chain`. The draft was handed to the arbiter, signed, and refused by
  //   the door. One regex on the id, one round earlier, and it would have been
  //   caught while the id was still mine to change.
  //
  // ⚠ ONLY THE `id` IS CHECKED HERE, NOT `arbiter.word`: a DRAFT's word is
  //   SUPPOSED to be a placeholder, and the word's own FIXTURE case is already
  //   caught below once a real word is in. The id is the half that is final from
  //   the moment it is written.
  if (typeof obj.id === "string" && /FIXTURE/i.test(obj.id)) {
    found.push(
      `id "${obj.id}" matches /FIXTURE/i — the door's loadTickets REFUSES a ticket so marked where ` +
        `real tickets live, and an id is final from the moment it is written. Rename it before the ` +
        `arbiter signs: a signed id cannot be changed by this seat.`
    );
  }
  for (let round = 0; round < 10; round++) {
    try {
      // ⛔ THE DOOR HAS A SECOND GATE AND THIS TOOL WAS BLIND TO IT. `parseTicket`
      //    is the schema; `loadTickets` ALSO refuses a ticket marked FIXTURE where
      //    real tickets live. On 2026-10-03 the signed T19 passed here as
      //    INSTALLABLE and the door refused it, because its id and the arbiter's
      //    own word both contain "fixtures" — the ticket is ABOUT fixtures. The
      //    predicate is IMPORTED from the door, not restated, so the two cannot
      //    come to disagree.
      const parsed = parseTicket(JSON.stringify(obj), stem);
      if (fixtureMarked(parsed)) {
        found.push(
          "is marked FIXTURE and sits where real tickets live — the door's loadTickets " +
            "refuses this even though the schema accepts it. /FIXTURE/i matches the ticket's " +
            "`id` or its `arbiter.word`, and the pre-flight used to miss it."
        );
      }
      return found;
    } catch (e) {
      const msg = (e as Error).message;
      found.push(msg);
      if (/^ticket has keys/.test(msg)) {
        for (const k of Object.keys(obj)) if (!TOP.includes(k)) delete obj[k];
      } else if (/^defect has keys/.test(msg)) {
        const d = (obj.defect ?? {}) as Record<string, unknown>;
        obj.defect = { summary: String(d.summary ?? "x"), ground: String(d.ground ?? "x") };
      } else if (/^arbiter has keys/.test(msg)) {
        const a = (obj.arbiter ?? {}) as Record<string, unknown>;
        obj.arbiter = { word: String(a.word ?? "x"), date: String(a.date ?? "2026-01-01") };
      } else if (/^arbiter\.date/.test(msg)) {
        (obj.arbiter as Record<string, unknown>).date = "2026-01-01";
      } else {
        // not a SHAPE fault this tool can step past (a placeholder, a bad path, a
        // stale expiry). Reporting one of those is the whole answer.
        return found;
      }
    }
  }
  found.push("gave up after 10 rounds — the file is further from the shape than this tool steps");
  return found;
}

/**
 * The stem the door will check `id` against. For a vault file the repo filename is
 * not the vault filename, so it is taken from `id` itself — and `id` is then
 * checked against the stem the door WOULD see once installed as `<id>.json`,
 * which is the only name an installer should give it.
 */
function stemFor(file: string, raw: string): string {
  try {
    const id = (JSON.parse(raw) as { id?: unknown }).id;
    if (typeof id === "string" && id.trim() !== "") return id;
  } catch { /* reported by violations() */ }
  return basename(file).replace(/\.json$/, "");
}

// ⛔ THE CLI BODY RUNS ONLY AS A CLI. Imported — by its own test, or by anything
//    else — this module must not read argv, print a census or call process.exit.
if (require.main !== module) {
  // exported API only; nothing below runs
} else {
let worst = 0;
// ⛔ ONE CLOCK READ AND ONE HEAD READ FOR THE WHOLE RUN, captured before the loop.
//    A per-file `Date.now()` would let a census straddle an expiry and report two
//    different answers for the same question in one output.
const NOW_MS = Date.now();
const HEAD = headShaOf(ROOT);
console.log(`now ${new Date(NOW_MS).toISOString()} · HEAD ${HEAD ?? "UNKNOWN"}\n`);
const files: string[] = [];
if (argv[0] === "--stamp") {
  // ⛔ A MODE THAT WRITES, NAMED SO IT CANNOT BE ENTERED BY ACCIDENT.
  const target = argv[1];
  if (!target) { console.error("usage: preflight.ts --stamp <draft.json>"); process.exit(2); }
  const before = readFileSync(target, "utf8");
  let after: string;
  try { after = stampedWith(before, HEAD); }
  catch (e) { console.error(`✗ ${(e as Error).message}`); process.exit(1); }
  writeFileSync(target, after);
  console.log(`✓ STAMPED  ${basename(target)}  base = ${HEAD}`);
  console.log(`    ${before.length} → ${after.length} bytes (${after.length - before.length >= 0 ? "+" : ""}${after.length - before.length}); rewritten as 2-space JSON`);
  console.log("    ⚠ the install gate now REFUSES this draft if HEAD moves before it is installed — which is the point.");
  process.exit(0);
}
if (argv[0] === "--census") {
  const dir = join(ROOT, "src/core-door/tickets");
  for (const f of readdirSync(dir).sort()) if (f.endsWith(".json")) files.push(join(dir, f));
  console.log(`CENSUS of installed tickets: ${files.length} file(s) under src/core-door/tickets/\n`);
} else {
  files.push(...argv);
}

for (const file of files) {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (e) {
    console.log(`✗ UNREADABLE  ${basename(file)}  ${(e as Error).message}`);
    worst = 1;
    continue;
  }
  const stem = stemFor(file, raw);
  const v = violations(raw, stem);
  const state = preflightState(v);
  if (state === "MALFORMED") worst = 1;
  console.log(`${state === "MALFORMED" ? "✗" : "✓"} ${state.padEnd(19)} ${basename(file)}`);
  console.log(`    id → installs as src/core-door/tickets/${stem}.json`);
  for (const m of v) console.log(`    · ${m}`);
  if (state === "READY FOR SIGNATURE") {
    console.log("    · nothing else in the SHAPE. This is what a correct DRAFT looks like; the arbiter's sentence is all it lacks.");
  }
  if (state === "INSTALLABLE") {
    console.log("    · the door's own parser accepts it as-is, and it is marked FIXTURE nowhere.");
  }
  // ⛔ THE INSTALL GATE IS PRINTED FOR EVERY FILE THE DOOR'S PARSER CAN READ,
  //    including drafts, and its answer is NOT folded into the state above. Two
  //    questions, two answers: "is this ticket well made" and "would the door take
  //    it right now" are different, and the second one used to be unasked.
  const t = parseForGate(raw, stem);
  if (t === null) {
    console.log("    INSTALL GATE  not run — the door's parser cannot read this file at all");
  } else {
    // T23 · the relation is computed HERE, by the CLI that already shells out for
    // HEAD, and handed to the gate. Probed only when it can matter: a ticket with
    // no base, or an unknown HEAD, has nothing to relate.
    const relation =
      t.base === undefined || HEAD === null || t.base === HEAD ? null : baseRelation(ROOT, t.base, HEAD);
    const gate = installGate(t, NOW_MS, HEAD, relation);
    const ok = gate.objections.length === 0;
    if (!ok && worst === 0) worst = 3;
    console.log(
      `    INSTALL GATE  ${ok ? "✓ INSTALLABLE NOW" : "✗ NOT INSTALLABLE NOW"}` +
        `  ·  window: ${gate.windowState}  ·  base: ${gate.baseState}`
    );
    for (const o of gate.objections) console.log(`      ⛔ ${o}`);
    // ⛔ AN ACCEPTANCE THAT DOES NOT SAY WHY IS A SILENT RELAXATION, which is how a
    //    gate stops being one. T23 accepts a base behind HEAD only when nothing
    //    under the core moved, so the reading prints what DID move instead.
    if (gate.baseState === "STAMPED, CORE UNMOVED" && gate.relation !== null) {
      const n = gate.relation.allMoved.length;
      console.log(
        `      ⓘ base is BEHIND HEAD and accepted: ${n} file(s) moved between them and NONE is under ` +
          `${CORE_SCOPE}/, so the derivation this stamp vouches for cannot have changed.`
      );
      console.log(`         moved: ${n === 0 ? "(nothing)" : gate.relation.allMoved.join(", ")}`);
    }
    if (gate.baseState === "UNSTAMPED" && gate.objections.every((o) => !o.includes("no `base` stamp"))) {
      console.log(
        "      ⚠ no `base` stamp, and exempt: this ticket was signed on or before " +
          `${STAMP_RULE_FROM}, when the field did not exist.`
      );
    }
  }
  console.log();
}
process.exit(worst);
}
