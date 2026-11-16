// ── MICA · DF — the deployment-facts reader (§3.7) ───────────────────────────
//
//   Origin: `ARC_MICA-BRIEF_S112-Deployment-Facts_20260906.md`. Ground: every
//   CONDITIONAL* in the T2 census says "hard to game only while a root-owned
//   deployment fact holds" — and nothing anywhere reads FOR that fact silently
//   stopping. This module converts conditional-and-silent into
//   conditional-and-watched. IT CLOSES NOTHING AND MUST NEVER CLAIM TO.
//
// ── THE ONE SENTENCE THIS MODULE IS ALLOWED TO SAY ────────────────────────────
//
//   A fact an operator declared either holds on this box right now, or it does
//   not, or there is no basis to say — and the declaration is always someone's
//   word, never this module's guess.
//
// ── R8 — DECLARED, NEVER DERIVED (fence 1) ────────────────────────────────────
//
//   Every expectation comes from `--deployment-facts <path>` (JSON, arbiter-
//   written). NO expectation literal lives in this file. Deriving an
//   expectation from the deployed tree would bless whatever is deployed —
//   VACUOUS-PASS by construction. An absent flag reads the whole section
//   CANNOT_ASSESS, named on why (SA precedent, `staleness-alarm.ts`).
//
// ── "NEVER A PARTIAL READ" — WHY THIS MODULE IS STRICTER THAN SA/DC-2 ─────────
//
//   `loadCadenceDeclaration` and `loadJournalDeclarations` skip an individual
//   bad entry and keep the rest (CONFIGURED with `problems`). This module does
//   NOT: the brief's fence 1 reads "Malformed file = same [as absent], never a
//   partial read, never a default." Read literally: if ANY declared fact fails
//   its own shape check, the WHOLE declaration is CONFIGURED_EMPTY and the
//   WHOLE section reads CANNOT_ASSESS — not "27 of 28 facts checked, one
//   skipped". The file is supposed to be baked from a live read with zero
//   fill-in slots (S111-2 standing rule); a malformed entry is evidence the
//   bake itself is untrustworthy, not a reason to trust the rest of it more.
//
// ── NEGATIVE-ONLY VOCABULARY (fence 2) ────────────────────────────────────────
//
//   Per-fact findings are FACT_ABSENT (declared, checked, does not hold — the
//   alarm) or CANNOT_ASSESS (could not check, reason named). A HELD fact earns
//   NO row and NO name — it is a bare COUNT in the section header ("N
//   declared, N held"), never a word like OK/SECURE/HARD. UNDECLARED is a
//   CENSUS line, not an alarm: this module names every fact FAMILY it knows
//   how to check (`FACT_FAMILIES`) that the declaration named zero facts for —
//   visible, so an operator sees what this reader COULD watch and was not
//   asked to.
//
// ── VACUOUS-PASS, AND WHY `file-not-writable-by` IS THE ONE ASYMMETRIC CASE ───
//
//   For every OTHER family, "the declared principal does not exist on this
//   host" is itself the honest alarm (FACT_ABSENT): a custody or identity
//   claim about a principal that is not there cannot hold, and saying so is
//   informative. `file-not-writable-by` is NEGATIVE-SHAPED ("X cannot write
//   path") and a nonexistent X trivially satisfies that sentence — scoring it
//   HELD would be exactly the VACUOUS-PASS this codebase's canon exists to
//   catch: a typo'd principal name would then read "secure" forever. So THAT
//   ONE family reads CANNOT_ASSESS, never HELD, when its principal cannot be
//   resolved. See `assessFileNotWritableBy`.
//
// ── door-preconditions — WHY THIS IS NOT `admitProbeSource` REUSED ────────────
//
//   The brief asks to reuse the door's shipped predicates "if importable
//   without pulling the door into the floor". `admitProbeSource` (in
//   `../glue/probe-door.ts`) is NOT cleanly importable for this purpose: it is
//   one function bundling ROOT-FIRST and UID-REQUIRED gates around the three
//   custody checks, and it answers relative to one CONCRETE invoking uid —
//   which this reader, run nightly out of band, does not have (there is no
//   live `mica-guard` invocation to ask about). Re-implemented here instead,
//   generalized over "the invoker" as "any principal other than the owner":
//   owner === mica-assembler; no GROUP or OTHER write bit (mode & 0o022 === 0)
//   stands in for "no other principal can write it"; the parent-directory
//   check is the door's own sticky-bit-or-not-writable test, unchanged in
//   substance. `probe-door.ts` itself is untouched — not refactored, not
//   imported beyond its own exported `PROBE_SOURCE_OWNER` is NOT reused either
//   (this module resolves `mica-assembler` through its own `resolvePrincipal`,
//   for the FACT_ABSENT-vs-CANNOT_ASSESS distinction below).
//
// ── WHY THIS MODULE DOES NOT REUSE `resolveOwnerUid` ─────────────────────────
//
//   `resolveOwnerUid` (`probe-door.ts`) collapses "no such principal" and
//   "/etc/passwd could not be read" into one `null`. This module's vocabulary
//   needs the two told apart (a genuinely absent principal is FACT_ABSENT for
//   most families, per the fence above; an unreadable `/etc/passwd` is
//   CANNOT_ASSESS) — so `resolvePrincipal` below re-parses `/etc/passwd`
//   itself, a small duplication justified by the distinction the reused
//   function cannot make.
//
// ── WHAT THIS MODULE DOES NOT CHECK, printed rather than buried ──────────────
//
//   `file-not-writable-by`'s ACL consultation is by PRINCIPAL NAME, matching
//   how `getfacl` shows a resolvable system account — it does not round-trip
//   through a numeric uid. `acl-entry`'s match on declared permission letters
//   is EXACT, not a subset test: a file holding `rwx` where `rw` was declared
//   reads FACT_ABSENT, on purpose (an unexpected extra bit is exactly the kind
//   of drift a gaming surface hides in). If `getfacl` cannot be run at all
//   (tool absent, path unreachable) the WHOLE fact reads CANNOT_ASSESS rather
//   than falling back to bare mode bits — a fallback would be a check that
//   quietly stopped seeing ACL-granted access and kept printing HELD.

// ── `unit-last-exit` — AND THE VACUOUS PASS IT WOULD HAVE BEEN (S127-7) ──────
//
//   A systemd unit can fail every night and say so nowhere a reader looks:
//   `mica-clerk-caller.service` exited 1 at 00:00 on eight consecutive nights
//   and the only visible symptom was a stamps file that stopped growing.
//   This family reads the unit's LAST run — `ExecMainStatus`,
//   `ExecMainStartTimestamp` and `Result`, via `systemctl show` — and nothing
//   else. It starts nothing, stops nothing, and reloads nothing.
//
//   THE TRAP, measured on this box before the check was written:
//
//     $ systemctl show no-such-unit-xyz.service -p ExecMainStatus -p ExecMainStartTimestamp -p Result
//     Result=success
//     ExecMainStartTimestamp=
//     ExecMainStatus=0
//
//   `systemctl show` answers for a unit that DOES NOT EXIST with exit 0,
//   `Result=success` and status 0. A check reading only the status would score
//   a typo'd unit name HELD forever — the same VACUOUS-PASS shape this module
//   already fences for `file-not-writable-by`, arriving through a different
//   door. THE EMPTY START TIMESTAMP IS THE ONLY DISCRIMINATOR, so it is
//   checked FIRST and an absent one reads CANNOT_ASSESS: a unit that is
//   unknown and a unit that has never run are indistinguishable from here, and
//   neither is a held fact.
//
//   Order of decision, stated rather than inferred from the code:
//     1. the properties could not be read         -> CANNOT_ASSESS
//     2. no `ExecMainStartTimestamp`               -> CANNOT_ASSESS (unknown, or never ran)
//     3. `ExecMainStatus` missing / not an integer -> CANNOT_ASSESS
//     4. `ExecMainStatus` non-zero                 -> FACT_ABSENT, naming the status
//     5. otherwise                                  -> HELD
//
//   `Result` is carried in the reason text of every outcome and decides none of
//   them: it is systemd's own summary word and this reader does not re-derive a
//   verdict from it.
//
//   R8 holds unchanged: the UNIT NAMES come from the declaration only. There is
//   no unit literal in this file, and there must never be one — a reader that
//   knows which units to watch has derived the expectation from the box.

// ── `unit-listen-loopback` — WHERE a declared unit's port is bound (S128) ────
//
//   `mica-proxy` is the first MICA principal with public egress, and the whole
//   of its safety is that it answers on LOOPBACK ONLY. That is a runtime
//   property: no mode bit, no owner and no ACL can say it, and the six
//   filesystem families above cannot see it. `unit-last-exit` cannot either —
//   it says how the unit's last run ENDED, never whether anything is listening
//   or where.
//
//   So this family reads TWO things and combines them:
//
//     `systemctl show <unit> -p LoadState -p ActiveState -p SubState -p MainPID`
//     `ss -ltnp`
//
//   It starts nothing, stops nothing, reloads nothing, and opens no socket.
//
//   THE SAME VACUOUS-PASS TRAP AS `unit-last-exit`, THROUGH A DIFFERENT DOOR.
//   `systemctl show` answers for a unit that does not exist with exit 0 — and
//   for THIS family the ExecMain* discriminator is the wrong one, because a
//   long-running `Type=simple` unit that has never exited has no interesting
//   ExecMainStatus at all. The discriminator here is `LoadState`: measured on
//   this box, an unknown unit answers `LoadState=not-found` while a real one
//   answers `LoadState=loaded`. Anything but `loaded` reads CANNOT_ASSESS —
//   a unit systemd has never heard of is not a fact that failed, it is a
//   declaration nobody can check.
//
//   WHAT `not-found` DOES *NOT* MEAN, paid for by a seat getting it wrong on
//   2026-09-14 and worth the four lines: it does not mean "never ran". A
//   TRANSIENT unit — one started by `systemd-run` rather than installed — is
//   GARBAGE-COLLECTED by systemd when it succeeds, and afterwards answers
//   `LoadState=not-found` exactly as a unit that never existed does. The two
//   are indistinguishable from here. This family only ever reads units a
//   declaration named, and a declared unit is an installed one, so the
//   discriminator holds where it is used; but CANNOT_ASSESS here means "not
//   loaded NOW", never "never was", and a reader who reasons from it to the
//   second thing has gone past what the property says.
//
//   Order of decision, stated rather than inferred from the code:
//     1. `systemctl show` could not be run            -> CANNOT_ASSESS
//     2. LoadState != "loaded"                        -> CANNOT_ASSESS (unknown unit)
//     3. ActiveState != "active"                      -> FACT_ABSENT, naming the state
//     4. NEITHER `ss` read could be run               -> CANNOT_ASSESS
//     5. `ss` ran and yielded NO parsable LISTEN row  -> CANNOT_ASSESS (see below)
//     6. no LISTEN row on the declared port           -> FACT_ABSENT
//     7. any row on that port NOT bound to loopback   -> FACT_ABSENT, NAMING THE BIND
//     8. the port is held by a pid that is visibly
//        not this unit's MainPID                      -> FACT_ABSENT
//     9. otherwise                                     -> HELD
//
//   WHY STEP 5 IS NOT "FACT_ABSENT". Zero parsable LISTEN rows on a host where
//   step 3 just found this unit ACTIVE does not mean the box is silent; it
//   means this reader could not read `ss`'s output format. "I could not see"
//   and "it is not there" are different findings and this module has already
//   paid for confusing them once. A port with no row among rows that DID parse
//   is step 6, and that one really is FACT_ABSENT.
//
//   STEP 8 IS A STRENGTHENER AND CAN ONLY EVER SUBTRACT — RULED KEPT, S128-4.
//   `ss` shows the owning pid only for sockets the caller may see; unprivileged,
//   another account's socket comes back with an empty Process column. So the
//   pid tie is applied ONLY when it is positively contradicted: MainPID is a
//   real pid AND at least one pid is visible on that port AND none of them
//   match. Absent pid visibility the check does not fire and the HELD reason
//   SAYS SO, because the claim would otherwise be wider than the evidence:
//   without it, this family attests "the unit is active and the declared port
//   is bound loopback-only", which is not quite "this unit's socket".
//
// ── THE ONE PRIVILEGE THIS READER IS GRANTED — RULED S128-6 ─────────────────
//
//   Step 8 is worth little while the pid column is blank, and it is blank for
//   exactly the sockets that matter: another principal's. So the report
//   principal is granted ONE command, NOPASSWD, through a sudoers drop-in —
//   `/usr/bin/ss -ltnp`, argument-matched, nothing else, no wildcard. The
//   drop-in is a DEPLOYMENT ACT (`deploy/mica-report-ss.sudoers`, drafted and
//   not installed); this module only tries to use it.
//
//   ORDER, and it is a fallback rather than a requirement:
//
//     1. `sudo -n /usr/bin/ss -ltnp`   — `-n` so it can NEVER sit at a prompt
//     2. on ANY non-zero, `ss -ltnp`   — the unprivileged read, as before
//     3. if BOTH fail, CANNOT_ASSESS naming BOTH errors, not just the second
//
//   THE FALLBACK IS NOT A SWALLOWED GATE, AND THE THING THAT KEEPS IT HONEST IS
//   THAT EVERY REASON STRING NAMES WHICH READ RAN. A deployment where the
//   drop-in was never installed still reads — and says, in the row a human
//   looks at, that it read without sudo and that another principal's owning pid
//   was therefore invisible. "It worked" and "it worked with the privilege it
//   was granted" must not print the same, or the grant becomes unfalsifiable.
//
//   The two branches are deliberately asymmetric and that is not an oversight:
//   the sudo branch names the binary ABSOLUTELY because sudoers matches on the
//   absolute path and an argument list, so anything else simply would not be
//   permitted; the plain branch resolves `ss` through PATH as it always did,
//   because there the only question is whether the tool is on this box at all.
//
//   R8 holds here too, twice over: the UNIT NAME and the PORT NUMBER both come
//   from the declaration. There is no unit literal and no port literal in this
//   file, and there must never be one — a reader that knows which port to watch
//   has derived the expectation from the box it is supposed to be checking.

import { execFileSync } from "child_process";
import { readFileSync, statSync } from "fs";

// S133 wire B. The probe writes these records and Reader A prints them; this
// reader is the third to ask the same question, and all three take the event
// type's spelling and the lookup from one module so the family cannot be held
// together by a string literal written three times.
import {
  LEDGER_EVENT_TYPE,
  findChainReviewRecord,
  findLedgerDeposit,
} from "../probe/ledger-lookup";
import type { Stats } from "fs";

// ── declared fact shapes ──────────────────────────────────────────────────

export const FACT_FAMILIES = [
  "principal-uid",
  "file-owner",
  "file-not-writable-by",
  "acl-entry",
  "file-mode",
  "door-preconditions",
  "unit-last-exit",
  "unit-listen-loopback",
  // S133 · WIRE B, §4 ruled (a). The only family here that reads a BOOK rather
  // than the filesystem or systemd — and it is still a deployment fact in the
  // sense this module means: an operator declares that a named pilot's review
  // reached the machine's own ledger, and this reader says nightly whether it
  // still has. Its name is the whole of its claim: IN THE LEDGER. It does not
  // say STAMPED, and `assessPilotReviewInLedger` carries the reason.
  "pilot-review-in-ledger",
] as const;
export type FactFamily = (typeof FACT_FAMILIES)[number];

export interface PrincipalUidFact {
  readonly id: string;
  readonly family: "principal-uid";
  readonly name: string;
  readonly uid?: number;
}
export interface FileOwnerFact {
  readonly id: string;
  readonly family: "file-owner";
  readonly path: string;
  readonly owner: string;
}
/**
 * S133 · The declaration is "this chain's review is in that ledger", and every
 * word of it is the arbiter's: the ledger PATH is declared (R8 — no expectation
 * literal lives in this file, and deriving the spine's path from the deployed
 * tree would bless whatever is deployed), and so is the chain's sha.
 *
 * `writer` is OPTIONAL and is the reviewer-is-not-the-writer half of the
 * original `pilot-chain-reviewed` idea: declare the principal that WROTE the
 * chain, and a review deposited by that same principal reads FACT_ABSENT. A
 * seat reviewing its own chain is the one thing this family can catch that
 * "is it there" cannot.
 */
export interface PilotReviewInLedgerFact {
  readonly id: string;
  readonly family: "pilot-review-in-ledger";
  readonly micaLog: string;
  readonly chainSha256: string;
  readonly writer?: string;
  /**
   * S134 Rb · the arbiter's RECORD BOOK. When declared, it is the AUTHORITATIVE
   * line and the journal line becomes corroboration; when absent, this family
   * reads exactly as it did at S133 and says which line it stood on. It never
   * sums the two: a self-narrated line and an independently-recorded one answer
   * different questions.
   */
  readonly recordBook?: string;
}
export interface FileNotWritableByFact {
  readonly id: string;
  readonly family: "file-not-writable-by";
  readonly path: string;
  readonly principal: string;
}
export interface AclEntryFact {
  readonly id: string;
  readonly family: "acl-entry";
  readonly path: string;
  readonly entry: string;
  readonly owner?: string;
  readonly group?: string;
  readonly mask?: string;
}
export interface FileModeFact {
  readonly id: string;
  readonly family: "file-mode";
  readonly path: string;
  readonly mode: string;
}
export interface DoorPreconditionsFact {
  readonly id: string;
  readonly family: "door-preconditions";
  readonly probeSourcePath: string;
}
export interface UnitLastExitFact {
  readonly id: string;
  readonly family: "unit-last-exit";
  /** A systemd unit name, DECLARED. No unit literal lives in this file (R8). */
  readonly unit: string;
}

export interface UnitListenLoopbackFact {
  readonly id: string;
  readonly family: "unit-listen-loopback";
  /** A systemd unit name, DECLARED. No unit literal lives in this file (R8). */
  readonly unit: string;
  /** The TCP port, DECLARED. No port literal lives in this file either (R8). */
  readonly port: number;
}

export type DeclaredFact =
  | PrincipalUidFact
  | FileOwnerFact
  | FileNotWritableByFact
  | AclEntryFact
  | FileModeFact
  | DoorPreconditionsFact
  | UnitLastExitFact
  | UnitListenLoopbackFact
  | PilotReviewInLedgerFact;

// ── the declaration — R8/R-V3, mirrors staleness-alarm.ts's DC-2 pattern,
//    EXCEPT for the whole-file collapse described in the module header ──────

export type DeploymentFactsDeclarationState = "ABSENT" | "CONFIGURED_EMPTY" | "CONFIGURED";

export interface DeploymentFactsDeclaration {
  readonly state: DeploymentFactsDeclarationState;
  readonly source: string;
  /** Empty unless `state` is CONFIGURED — see "never a partial read" above. */
  readonly facts: readonly DeclaredFact[];
  readonly problems: readonly string[];
}

export const ABSENT_DEPLOYMENT_FACTS_DECLARATION: DeploymentFactsDeclaration = {
  state: "ABSENT",
  source: "none",
  facts: [],
  problems: [],
};

function parseDeclaredEntry(
  entry: string
): { readonly type: "user" | "group" | "other" | "mask"; readonly qualifier: string; readonly perm: string } | null {
  const m = /^(u|user|g|group|o|other|m|mask):([^:]*):([rwx]*)$/.exec(entry);
  if (m === null) return null;
  const typeMap: Record<string, "user" | "group" | "other" | "mask"> = {
    u: "user",
    user: "user",
    g: "group",
    group: "group",
    o: "other",
    other: "other",
    m: "mask",
    mask: "mask",
  };
  return { type: typeMap[m[1]], qualifier: m[2], perm: normalizePerm(m[3]) };
}

/**
 * A systemd unit name with an EXPLICIT type suffix. Deliberately narrow: this
 * string is handed to `systemctl show` as an argv element (never a shell), so
 * the pattern is not a shell-injection fence — it is a declaration fence. A
 * name this does not match is a declaration the arbiter should fix, not one
 * this reader should interpret.
 */
const UNIT_NAME =
  /^[A-Za-z0-9:@._\\-]+\.(service|socket|device|mount|automount|swap|target|path|timer|slice|scope)$/;

/** Order-independent letter set, dashes dropped: "rw-" and "wr" both -> "rw". */
function normalizePerm(p: string): string {
  return [...new Set([...p].filter((c) => c !== "-"))].sort().join("");
}

function validateFact(
  raw: unknown,
  index: number
): { readonly ok: true; readonly fact: DeclaredFact } | { readonly ok: false; readonly problem: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, problem: `entry ${index}: not a JSON object` };
  }
  const r = raw as Record<string, unknown>;
  const id = r.id;
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, problem: `entry ${index}: missing or empty "id"` };
  }
  const family = r.family;
  if (typeof family !== "string" || !(FACT_FAMILIES as readonly string[]).includes(family)) {
    return {
      ok: false,
      problem: `fact ${id} (entry ${index}): "family" must be one of ${FACT_FAMILIES.join(", ")}`,
    };
  }
  const str = (key: string): string | null =>
    typeof r[key] === "string" && (r[key] as string).length > 0 ? (r[key] as string) : null;
  const fam = family as FactFamily;

  switch (fam) {
    case "principal-uid": {
      const name = str("name");
      if (name === null) return { ok: false, problem: `fact ${id}: "name" must be a non-empty string` };
      if (r.uid !== undefined && (typeof r.uid !== "number" || !Number.isInteger(r.uid) || r.uid < 0)) {
        return { ok: false, problem: `fact ${id}: "uid" must be a non-negative integer when present` };
      }
      return { ok: true, fact: { id, family: fam, name, uid: r.uid as number | undefined } };
    }
    case "file-owner": {
      const path = str("path");
      const owner = str("owner");
      if (path === null || owner === null) {
        return { ok: false, problem: `fact ${id}: "path" and "owner" must be non-empty strings` };
      }
      return { ok: true, fact: { id, family: fam, path, owner } };
    }
    case "file-not-writable-by": {
      const path = str("path");
      const principal = str("principal");
      if (path === null || principal === null) {
        return { ok: false, problem: `fact ${id}: "path" and "principal" must be non-empty strings` };
      }
      return { ok: true, fact: { id, family: fam, path, principal } };
    }
    case "acl-entry": {
      const path = str("path");
      const entry = str("entry");
      if (path === null || entry === null) {
        return { ok: false, problem: `fact ${id}: "path" and "entry" must be non-empty strings` };
      }
      if (parseDeclaredEntry(entry) === null) {
        return {
          ok: false,
          problem:
            `fact ${id}: "entry" ${JSON.stringify(entry)} is not a recognizable ACL entry ` +
            `(expected TYPE:QUALIFIER:PERMS, e.g. "u:mica-doctor:rw")`,
        };
      }
      const owner = str("owner") ?? undefined;
      const group = str("group") ?? undefined;
      const mask = str("mask") ?? undefined;
      return { ok: true, fact: { id, family: fam, path, entry, owner, group, mask } };
    }
    case "file-mode": {
      const path = str("path");
      const mode = str("mode");
      if (path === null || mode === null || !/^[0-7]{3,4}$/.test(mode)) {
        return {
          ok: false,
          problem: `fact ${id}: "path" must be a non-empty string and "mode" a 3-or-4-digit octal string`,
        };
      }
      return { ok: true, fact: { id, family: fam, path, mode } };
    }
    case "door-preconditions": {
      const probeSourcePath = str("probeSourcePath");
      if (probeSourcePath === null) {
        return { ok: false, problem: `fact ${id}: "probeSourcePath" must be a non-empty string` };
      }
      return { ok: true, fact: { id, family: fam, probeSourcePath } };
    }
    case "pilot-review-in-ledger": {
      const micaLog = str("micaLog");
      if (micaLog === null || micaLog.length === 0) {
        return {
          ok: false,
          problem:
            `fact ${id}: "micaLog" must be the path of the ledger this review was ` +
            `deposited into. It is DECLARED and never derived — a reader that found ` +
            `the spine's path by looking at the deployed tree would be blessing ` +
            `whatever tree it was pointed at (R8).`,
        };
      }
      const chainSha256 = str("chainSha256");
      if (chainSha256 === null || !/^[0-9a-f]{64}$/.test(chainSha256)) {
        return {
          ok: false,
          problem:
            `fact ${id}: "chainSha256" must be 64 lower-case hex — the digest of the ` +
            `evidence chain that was reviewed. The ledger record carries it verbatim ` +
            `and the match is on it alone, never on a runId a later run could re-use.`,
        };
      }
      const writer = str("writer");
      // `str` returns null for both "absent" and "present but not a non-empty
      // string", so the raw record is asked which of the two it is: a `writer`
      // key that is there and unusable is a MALFORMED declaration (and by this
      // module's own rule that collapses the WHOLE file), never a silently
      // dropped half of the check.
      if (r.writer !== undefined && writer === null) {
        return {
          ok: false,
          problem: `fact ${id}: "writer", when given, must be the principal that wrote the chain.`,
        };
      }
      // S134 Rb · the record book, DECLARED like everything else here and never
      // derived. Same rule as `writer` one block up: a key that is present and
      // unusable is a MALFORMED declaration, not a silently dropped check — and
      // by this module's rule that collapses the whole file.
      const recordBook = str("recordBook");
      if (r.recordBook !== undefined && recordBook === null) {
        return {
          ok: false,
          problem:
            `fact ${id}: "recordBook", when given, must be the path of the registrar's ` +
            `record book holding the PILOT_CHAIN_REVIEWED. It is the AUTHORITATIVE line; ` +
            `the ledger line is the depositor's own narration of the same act.`,
        };
      }
      return {
        ok: true,
        fact: {
          id,
          family: fam,
          micaLog,
          chainSha256,
          ...(writer !== null && writer.length > 0 ? { writer } : {}),
          ...(recordBook !== null && recordBook.length > 0 ? { recordBook } : {}),
        },
      };
    }
    case "unit-last-exit": {
      const unit = str("unit");
      if (unit === null || !UNIT_NAME.test(unit)) {
        return {
          ok: false,
          problem:
            `fact ${id}: "unit" must be a systemd unit name with an explicit type ` +
            `suffix (e.g. "mica-report.service"). A bare name is refused rather ` +
            `than suffixed for the declarer: guessing ".service" would make this ` +
            `reader decide WHICH unit is watched, which is the declaration's job.`,
        };
      }
      return { ok: true, fact: { id, family: fam, unit } };
    }
    case "unit-listen-loopback": {
      const unit = str("unit");
      if (unit === null || !UNIT_NAME.test(unit)) {
        return {
          ok: false,
          problem:
            `fact ${id}: "unit" must be a systemd unit name with an explicit type ` +
            `suffix (e.g. "mica-proxy.service"). Same reasoning as unit-last-exit: ` +
            `guessing the suffix would make this reader decide WHICH unit is ` +
            `watched, which is the declaration's job.`,
        };
      }
      const port = r.port;
      if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
        return {
          ok: false,
          problem:
            `fact ${id}: "port" must be an integer TCP port in 1..65535, got ` +
            `${JSON.stringify(port ?? null)}. It is DECLARED because a reader that ` +
            `knows which port to watch has derived the expectation from the box.`,
        };
      }
      return { ok: true, fact: { id, family: fam, unit, port } };
    }
  }
}

/**
 * Reads a JSON array of declared facts. Never throws — every failure becomes
 * a state, same discipline as `loadCadenceDeclaration`. See the module header
 * for why ANY malformed entry collapses the WHOLE declaration rather than
 * being skipped.
 */
export function loadDeploymentFactsDeclaration(path: string | null): DeploymentFactsDeclaration {
  if (path === null) return ABSENT_DEPLOYMENT_FACTS_DECLARATION;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      state: "CONFIGURED_EMPTY",
      source: path,
      facts: [],
      problems: [
        `deployment-facts declaration ${path} could not be read as JSON: ${String(error)}. ` +
          `Never a partial read: the whole section reads CANNOT_ASSESS.`,
      ],
    };
  }
  if (!Array.isArray(raw)) {
    return {
      state: "CONFIGURED_EMPTY",
      source: path,
      facts: [],
      problems: [`deployment-facts declaration ${path} is not a JSON array of facts`],
    };
  }

  const problems: string[] = [];
  const facts: DeclaredFact[] = [];
  const seenIds = new Set<string>();
  raw.forEach((entry, index) => {
    const v = validateFact(entry, index);
    if (!v.ok) {
      problems.push(v.problem);
      return;
    }
    if (seenIds.has(v.fact.id)) {
      problems.push(`fact id ${JSON.stringify(v.fact.id)} (entry ${index}) is declared more than once`);
      return;
    }
    seenIds.add(v.fact.id);
    facts.push(v.fact);
  });

  if (problems.length > 0) {
    // NEVER A PARTIAL READ (fence 1) — one bad entry invalidates all of them.
    return { state: "CONFIGURED_EMPTY", source: path, facts: [], problems };
  }
  if (facts.length === 0) {
    return {
      state: "CONFIGURED_EMPTY",
      source: path,
      facts: [],
      problems: ["deployment-facts declaration is a valid empty array — zero facts declared"],
    };
  }
  return { state: "CONFIGURED", source: path, facts, problems: [] };
}

// ── principal identity — the one thing that must be injectable for tests ────
//
//   A real chown/useradd needs privilege this seat does not have (same note
//   `probe-door.test.ts` carries). `resolvePrincipal` is injected so the
//   DECISION is exercised against real `statSync`/`getfacl` results on real
//   files; what is simulated is WHICH identity a name resolves to.

export interface PrincipalIdentity {
  readonly uid: number;
  readonly gid: number;
  readonly primaryGroupName: string | null;
  readonly secondaryGroupNames: readonly string[];
  readonly allGids: ReadonlySet<number>;
}

export type PrincipalLookup =
  | { readonly found: true; readonly identity: PrincipalIdentity }
  | { readonly found: false; readonly reason: "NOT_FOUND" | "CANNOT_READ"; readonly detail: string };

export interface DeploymentFactsEnv {
  /** getpwnam-equivalent, with group membership. Default: parse /etc/passwd + /etc/group. */
  readonly resolvePrincipal?: (name: string) => PrincipalLookup;
  /** getfacl-equivalent. Default: run the real `getfacl` binary. */
  readonly readAcl?: (
    path: string
  ) => { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string };
  /**
   * `systemctl show <unit> -p …` equivalent, returning its raw KEY=VALUE text.
   * Default: run the real binary, READ-ONLY (`show` only — this module never
   * starts, stops, enables or reloads anything). Injected so the DECISION is
   * exercised against captured systemd output rather than against whatever
   * units happen to exist on the machine running the suite.
   */
  readonly readUnitProperties?: (
    unit: string,
    properties: readonly string[]
  ) => { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string };
  /**
   * `ss -ltnp` equivalent, returning its raw table AND which read produced it.
   * Default: `sudo -n /usr/bin/ss -ltnp`, falling back to plain `ss -ltnp`
   * (S128-6) — READ-ONLY either way: it opens no socket and binds nothing.
   * Injected for the same reason the two above are: the DECISION is exercised
   * against captured `ss` output rather than against whatever happens to be
   * listening on the machine running the suite, which is not a property of
   * this code.
   */
  readonly readListeningSockets?: () => ListeningSocketsRead;
}

interface GroupsIndex {
  readonly gidToName: ReadonlyMap<number, string>;
  readonly nameToGid: ReadonlyMap<string, number>;
  readonly nameToMembers: ReadonlyMap<string, readonly string[]>;
}

function loadGroupsIndex(): GroupsIndex | null {
  let text: string;
  try {
    text = readFileSync("/etc/group", "utf8");
  } catch {
    return null;
  }
  const gidToName = new Map<number, string>();
  const nameToGid = new Map<string, number>();
  const nameToMembers = new Map<string, readonly string[]>();
  for (const line of text.split("\n")) {
    const parts = line.split(":");
    if (parts.length < 4) continue;
    const [name, , gidStr, membersStr] = parts;
    const gid = Number(gidStr);
    if (name.length === 0 || !Number.isInteger(gid)) continue;
    gidToName.set(gid, name);
    nameToGid.set(name, gid);
    nameToMembers.set(
      name,
      membersStr.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
    );
  }
  return { gidToName, nameToGid, nameToMembers };
}

/** Resolve a principal name to uid/gid/group memberships via /etc/passwd + /etc/group. */
function defaultResolvePrincipal(name: string): PrincipalLookup {
  let text: string;
  try {
    text = readFileSync("/etc/passwd", "utf8");
  } catch (err) {
    return { found: false, reason: "CANNOT_READ", detail: `/etc/passwd could not be read: ${String(err)}` };
  }
  for (const line of text.split("\n")) {
    const parts = line.split(":");
    if (parts.length >= 4 && parts[0] === name) {
      const uid = Number(parts[2]);
      const gid = Number(parts[3]);
      if (!Number.isInteger(uid) || !Number.isInteger(gid)) {
        return {
          found: false,
          reason: "CANNOT_READ",
          detail: `/etc/passwd's line for ${name} has a non-integer uid or gid`,
        };
      }
      const groups = loadGroupsIndex();
      const primaryGroupName = groups?.gidToName.get(gid) ?? null;
      const secondaryGroupNames =
        groups === null
          ? []
          : [...groups.nameToMembers.entries()]
              .filter(([, members]) => members.includes(name))
              .map(([n]) => n);
      const allGids = new Set<number>([gid]);
      if (groups !== null) {
        for (const n of secondaryGroupNames) {
          const g = groups.nameToGid.get(n);
          if (g !== undefined) allGids.add(g);
        }
      }
      return { found: true, identity: { uid, gid, primaryGroupName, secondaryGroupNames, allGids } };
    }
  }
  return { found: false, reason: "NOT_FOUND", detail: `no line for ${name} in /etc/passwd` };
}

function resolvePrincipal(name: string, env: DeploymentFactsEnv): PrincipalLookup {
  return (env.resolvePrincipal ?? defaultResolvePrincipal)(name);
}

function defaultReadAcl(
  path: string
): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string } {
  try {
    const text = execFileSync("getfacl", [path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: String((err as Error).message ?? err) };
  }
}

function readAcl(
  path: string,
  env: DeploymentFactsEnv
): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string } {
  return (env.readAcl ?? defaultReadAcl)(path);
}

/** The three properties `unit-last-exit` reads, and no others. */
export const UNIT_LAST_EXIT_PROPERTIES = ["ExecMainStatus", "ExecMainStartTimestamp", "Result"] as const;

/**
 * The four properties `unit-listen-loopback` reads, and no others.
 *
 * `LoadState` is first because it is the VACUOUS-PASS discriminator for this
 * family — see the module header. `MainPID` is the step-8 strengthener.
 */
export const UNIT_LISTEN_LOOPBACK_PROPERTIES = [
  "LoadState",
  "ActiveState",
  "SubState",
  "MainPID",
] as const;

function defaultReadUnitProperties(
  unit: string,
  properties: readonly string[]
): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string } {
  try {
    const args = ["show", unit];
    for (const p of properties) args.push("-p", p);
    const text = execFileSync("systemctl", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: String((err as Error).message ?? err) };
  }
}

function readUnitProperties(
  unit: string,
  properties: readonly string[],
  env: DeploymentFactsEnv
): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string } {
  return (env.readUnitProperties ?? defaultReadUnitProperties)(unit, properties);
}

/** `-l` listening, `-t` TCP, `-n` numeric (never a resolver), `-p` the owning process when visible. */
export const SS_ARGS = ["-ltnp"] as const;

/**
 * The path the sudoers drop-in matches on. sudo matches an ABSOLUTE path and an
 * argument list; a relative name or a different argument simply is not
 * permitted, which is the whole point of granting one command rather than a
 * binary. `deploy/mica-report-ss.sudoers` carries the other half of this pair
 * and the two must be read together — change one and the grant stops matching,
 * loudly (the sudo read fails, the plain read runs, and the row says so).
 */
export const SS_SUDO_PATH = "/usr/bin/ss";

/** Which read produced the table. It reaches the printed reason — see the header. */
export type SocketReadVia = "sudo" | "plain";

export type ListeningSocketsRead =
  | { readonly ok: true; readonly text: string; readonly via: SocketReadVia }
  | { readonly ok: false; readonly error: string };

type CommandRun = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string };

/**
 * THE S128-6 ORDER, factored out so it can be TESTED WITHOUT SHELLING OUT.
 *
 * The default reader below is this function with the two real commands bound
 * to it. A fallback that only ever ran for real would be a ruling nothing in
 * the suite could hold, and this one has a rule attached — every reason names
 * which read ran — that is worth a test of its own.
 *
 * BOTH errors are carried when both fail. Reporting only the second would hide
 * "sudo is not configured" behind "ss is not installed", which are different
 * deployment facts and want different repairs.
 */
export function readSocketsWithFallback(runSudo: () => CommandRun, runPlain: () => CommandRun): ListeningSocketsRead {
  const privileged = runSudo();
  if (privileged.ok) return { ok: true, text: privileged.text, via: "sudo" };
  const plain = runPlain();
  if (plain.ok) return { ok: true, text: plain.text, via: "plain" };
  return {
    ok: false,
    error:
      `sudo -n ${SS_SUDO_PATH} ${SS_ARGS.join(" ")} failed (${privileged.error}) ` +
      `AND plain ss ${SS_ARGS.join(" ")} failed (${plain.error})`,
  };
}

function run(file: string, args: readonly string[]): CommandRun {
  try {
    const text = execFileSync(file, [...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: String((err as Error).message ?? err) };
  }
}

function defaultReadListeningSockets(): ListeningSocketsRead {
  return readSocketsWithFallback(
    // `-n` is LOAD-BEARING: without it a misconfigured sudoers line would sit
    // at a password prompt inside a report run and hang the unit rather than
    // fail it. This reader must never be able to wait for a human.
    () => run("sudo", ["-n", SS_SUDO_PATH, ...SS_ARGS]),
    // PATH, deliberately — see the header on why the two branches differ.
    () => run("ss", [...SS_ARGS])
  );
}

function readListeningSockets(env: DeploymentFactsEnv): ListeningSocketsRead {
  return (env.readListeningSockets ?? defaultReadListeningSockets)();
}

/** The clause every socket-derived reason carries, so a grant that is not in force cannot hide. */
function viaNote(via: SocketReadVia): string {
  return via === "sudo"
    ? `read via sudo -n ${SS_SUDO_PATH} ${SS_ARGS.join(" ")}`
    : `read via plain ss ${SS_ARGS.join(" ")} — WITHOUT sudo, so another principal's owning pid ` +
      `is not visible to this reader`;
}

/**
 * `systemctl show` emits `KEY=VALUE` lines and does NOT preserve the order the
 * properties were asked in (measured: `-p ExecMainStatus -p
 * ExecMainStartTimestamp -p Result` comes back Result first). So this parses
 * into a map and never indexes by position. A value may legitimately be empty.
 */
function parseUnitProperties(text: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    out.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return out;
}

/**
 * One `LISTEN` row of `ss -ltnp`, reduced to what this family decides on.
 *
 * `ss`'s local column is `ADDRESS:PORT` where ADDRESS may be `*`, `0.0.0.0`,
 * `[::]`, `[::1]`, or an address carrying a scope (`127.0.0.53%lo`, measured
 * on this box). The PORT is after the LAST colon — splitting on the first one
 * would cut every IPv6 address in half.
 */
export interface ListeningSocketRow {
  /** Brackets and any `%scope` removed, so one comparison covers every shape. */
  readonly address: string;
  readonly port: number;
  /** The owning pid when `ss` showed one; null when it did not (see step 8). */
  readonly pid: number | null;
  /** Exactly as `ss` printed it, for a reason string that quotes rather than paraphrases. */
  readonly printed: string;
}

/**
 * EXPORTED so a test can feed it captured `ss` output directly. Requiring the
 * literal `LISTEN` in the first column is what drops the header line, rather
 * than "skip line 1" — a table whose header this reader failed to recognize
 * must not silently become a data row.
 */
export function parseListeningSockets(text: string): readonly ListeningSocketRow[] {
  const rows: ListeningSocketRow[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const fields = line.split(/\s+/);
    if (fields[0] !== "LISTEN" || fields.length < 4) continue;
    const printed = fields[3];
    const colon = printed.lastIndexOf(":");
    if (colon <= 0) continue;
    const portText = printed.slice(colon + 1);
    if (!/^\d+$/.test(portText)) continue;
    const address = printed
      .slice(0, colon)
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .replace(/%.*$/, "");
    const pidMatch = /\bpid=(\d+)/.exec(line);
    rows.push({
      address,
      port: Number(portText),
      pid: pidMatch === null ? null : Number(pidMatch[1]),
      printed,
    });
  }
  return rows;
}

export type BindClass = "LOOPBACK" | "WILDCARD" | "OTHER";

/**
 * WILDCARD and OTHER are kept apart even though both fail: "bound to every
 * interface" and "bound to one specific non-loopback address" are different
 * deployment mistakes and the reason string should not flatten them.
 */
export function classifyBind(address: string): BindClass {
  if (address === "*" || address === "0.0.0.0" || address === "::") return "WILDCARD";
  if (address === "::1") return "LOOPBACK";
  // 127.0.0.0/8 entire, matching the unit's own IPAddressAllow and the runner's
  // isLoopbackEndpoint — three places, one meaning of "loopback".
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address)) return "LOOPBACK";
  if (/^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address)) return "LOOPBACK";
  return "OTHER";
}

interface AclEntryRow {
  readonly type: "user" | "group" | "other" | "mask";
  readonly qualifier: string;
  readonly perm: string;
}
interface ParsedAcl {
  readonly owner: string | null;
  readonly group: string | null;
  readonly entries: readonly AclEntryRow[];
}

function parseAclText(text: string): ParsedAcl {
  const ownerMatch = /^# owner: (.*)$/m.exec(text);
  const groupMatch = /^# group: (.*)$/m.exec(text);
  const entries: AclEntryRow[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const m = /^(user|group|other|mask):([^:]*):([rwx-]{3,})$/.exec(line);
    if (m === null) continue;
    entries.push({ type: m[1] as AclEntryRow["type"], qualifier: m[2], perm: normalizePerm(m[3]) });
  }
  return { owner: ownerMatch ? ownerMatch[1] : null, group: groupMatch ? groupMatch[1] : null, entries };
}

function octal(mode: number): string {
  return "0" + (mode & 0o7777).toString(8).padStart(4, "0").slice(-4);
}

// ── per-fact findings ─────────────────────────────────────────────────────

export type DeploymentFactFindingState = "HELD" | "FACT_ABSENT" | "CANNOT_ASSESS";

export interface DeploymentFactFinding {
  readonly id: string;
  readonly family: FactFamily;
  readonly state: DeploymentFactFindingState;
  readonly reason: string;
}

function held(fact: DeclaredFact, reason: string): DeploymentFactFinding {
  return { id: fact.id, family: fact.family, state: "HELD", reason };
}
function factAbsent(fact: DeclaredFact, reason: string): DeploymentFactFinding {
  return { id: fact.id, family: fact.family, state: "FACT_ABSENT", reason };
}
function cannotAssess(fact: DeclaredFact, reason: string): DeploymentFactFinding {
  return { id: fact.id, family: fact.family, state: "CANNOT_ASSESS", reason };
}

function statOrNull(path: string): { readonly st: Stats } | { readonly error: string } {
  try {
    return { st: statSync(path) };
  } catch (err) {
    return { error: `${path} could not be stat'd (${String((err as NodeJS.ErrnoException).code ?? err)})` };
  }
}

function assessPrincipalUid(fact: PrincipalUidFact, env: DeploymentFactsEnv): DeploymentFactFinding {
  const lookup = resolvePrincipal(fact.name, env);
  if (!lookup.found) {
    return lookup.reason === "CANNOT_READ"
      ? cannotAssess(fact, lookup.detail)
      : factAbsent(fact, `${fact.name} does not exist on this host`);
  }
  if (fact.uid !== undefined && lookup.identity.uid !== fact.uid) {
    return factAbsent(
      fact,
      `${fact.name} resolves to uid ${lookup.identity.uid}; the pinned declaration expects ${fact.uid}`
    );
  }
  return held(fact, `${fact.name} resolves to uid ${lookup.identity.uid}`);
}

function assessFileOwner(fact: FileOwnerFact, env: DeploymentFactsEnv): DeploymentFactFinding {
  const lookup = resolvePrincipal(fact.owner, env);
  if (!lookup.found) {
    return lookup.reason === "CANNOT_READ"
      ? cannotAssess(fact, lookup.detail)
      : factAbsent(fact, `declared owner ${fact.owner} does not exist on this host`);
  }
  const s = statOrNull(fact.path);
  if ("error" in s) return cannotAssess(fact, s.error);
  if (s.st.uid !== lookup.identity.uid) {
    return factAbsent(fact, `${fact.path} is owned by uid ${s.st.uid}, not ${fact.owner} (uid ${lookup.identity.uid})`);
  }
  return held(fact, `${fact.path} is owned by ${fact.owner} (uid ${s.st.uid})`);
}

function assessFileMode(fact: FileModeFact, env: DeploymentFactsEnv): DeploymentFactFinding {
  void env;
  const s = statOrNull(fact.path);
  if ("error" in s) return cannotAssess(fact, s.error);
  const mask = fact.mode.length >= 4 ? 0o7777 : 0o777;
  const declared = parseInt(fact.mode, 8) & mask;
  const actual = s.st.mode & mask;
  if (actual !== declared) {
    return factAbsent(fact, `${fact.path} is mode ${octal(s.st.mode)}, declared ${fact.mode}`);
  }
  return held(fact, `${fact.path} is mode ${fact.mode}`);
}

function assessAclEntry(fact: AclEntryFact, env: DeploymentFactsEnv): DeploymentFactFinding {
  const s = statOrNull(fact.path);
  if ("error" in s) return cannotAssess(fact, s.error);
  const read = readAcl(fact.path, env);
  if (!read.ok) return cannotAssess(fact, `ACL for ${fact.path} could not be read: ${read.error}`);
  const parsed = parseAclText(read.text);
  const declared = parseDeclaredEntry(fact.entry) as NonNullable<ReturnType<typeof parseDeclaredEntry>>;
  const match = parsed.entries.find((e) => e.type === declared.type && e.qualifier === declared.qualifier);
  if (!match || match.perm !== declared.perm) {
    return factAbsent(
      fact,
      `${fact.path}'s ACL does not carry ${fact.entry} (found: ${
        match ? `${match.type}:${match.qualifier}:${match.perm || "(none)"}` : "no matching entry"
      })`
    );
  }
  if (fact.owner !== undefined && parsed.owner !== fact.owner) {
    return factAbsent(fact, `${fact.path}'s owner is ${parsed.owner ?? "unknown"}, declared ${fact.owner}`);
  }
  if (fact.group !== undefined && parsed.group !== fact.group) {
    return factAbsent(fact, `${fact.path}'s group is ${parsed.group ?? "unknown"}, declared ${fact.group}`);
  }
  if (fact.mask !== undefined) {
    const maskEntry = parsed.entries.find((e) => e.type === "mask");
    const maskPerm = maskEntry ? maskEntry.perm : "";
    if (maskPerm !== normalizePerm(fact.mask)) {
      return factAbsent(fact, `${fact.path}'s mask is ${maskPerm || "(none)"}, declared ${fact.mask}`);
    }
  }
  return held(fact, `${fact.path} carries ${fact.entry}`);
}

function intersect(a: string, b: string): string {
  return [...a].filter((c) => b.includes(c)).join("");
}

function computeEffectiveWrite(
  st: Stats,
  principalName: string,
  identity: PrincipalIdentity,
  acl: ParsedAcl
): { readonly writable: boolean; readonly via: string } {
  const maskEntry = acl.entries.find((e) => e.type === "mask");
  const masked = (perm: string): string => (maskEntry ? intersect(perm, maskEntry.perm) : perm);

  if (identity.uid === st.uid) {
    const e = acl.entries.find((e) => e.type === "user" && e.qualifier === "");
    return { writable: (e ? e.perm : "").includes("w"), via: "owning user (never masked)" };
  }
  const namedUser = acl.entries.find((e) => e.type === "user" && e.qualifier === principalName);
  if (namedUser) {
    return { writable: masked(namedUser.perm).includes("w"), via: `named ACL user:${principalName}` };
  }
  const groupNames = [identity.primaryGroupName, ...identity.secondaryGroupNames].filter(
    (n): n is string => n !== null
  );
  for (const gname of groupNames) {
    const namedGroup = acl.entries.find((e) => e.type === "group" && e.qualifier === gname);
    if (namedGroup) return { writable: masked(namedGroup.perm).includes("w"), via: `named ACL group:${gname}` };
  }
  if (identity.allGids.has(st.gid)) {
    const e = acl.entries.find((e) => e.type === "group" && e.qualifier === "");
    return { writable: masked(e ? e.perm : "").includes("w"), via: "owning group" };
  }
  const other = acl.entries.find((e) => e.type === "other" && e.qualifier === "");
  return { writable: (other ? other.perm : "").includes("w"), via: "other" };
}

/** See the module header: this is the one family where NOT_FOUND reads CANNOT_ASSESS, not FACT_ABSENT. */
function assessFileNotWritableBy(fact: FileNotWritableByFact, env: DeploymentFactsEnv): DeploymentFactFinding {
  const lookup = resolvePrincipal(fact.principal, env);
  if (!lookup.found) {
    return cannotAssess(
      fact,
      lookup.reason === "CANNOT_READ"
        ? lookup.detail
        : `declared principal ${fact.principal} does not exist on this host — scoring this HELD would be a ` +
          `vacuous pass, so it is not checked at all`
    );
  }
  const s = statOrNull(fact.path);
  if ("error" in s) return cannotAssess(fact, s.error);
  const read = readAcl(fact.path, env);
  if (!read.ok) {
    return cannotAssess(
      fact,
      `ACL for ${fact.path} could not be consulted (${read.error}); mode bits alone are not a sufficient ` +
        `answer once ACLs may be present`
    );
  }
  const parsed = parseAclText(read.text);
  const { writable, via } = computeEffectiveWrite(s.st, fact.principal, lookup.identity, parsed);
  if (writable) return factAbsent(fact, `${fact.principal} CAN write ${fact.path} (via ${via})`);
  return held(fact, `${fact.principal} cannot write ${fact.path} (checked via ${via})`);
}

/** See the module header: the door's own predicates re-implemented, generalized over any non-owner invoker. */
function assessDoorPreconditions(fact: DoorPreconditionsFact, env: DeploymentFactsEnv): DeploymentFactFinding {
  const lookup = resolvePrincipal("mica-assembler", env);
  if (!lookup.found) {
    return lookup.reason === "CANNOT_READ"
      ? cannotAssess(fact, lookup.detail)
      : factAbsent(fact, `the principal mica-assembler does not exist on this host`);
  }
  const s = statOrNull(fact.probeSourcePath);
  if ("error" in s) return cannotAssess(fact, s.error);

  const reasons: string[] = [];
  if (s.st.uid !== lookup.identity.uid) {
    reasons.push(`owner is uid ${s.st.uid}, not mica-assembler (uid ${lookup.identity.uid})`);
  }
  const invokerCannotWrite = (s.st.mode & 0o022) === 0;
  if (!invokerCannotWrite) {
    reasons.push(`mode ${octal(s.st.mode)} allows a non-owner (group or other) to write it`);
  }
  const parent = fact.probeSourcePath.replace(/\/[^/]*$/, "") || "/";
  const p = statOrNull(parent);
  if ("error" in p) return cannotAssess(fact, `parent directory: ${p.error}`);
  const sticky = (p.st.mode & 0o1000) !== 0;
  const parentNotReplaceable = sticky || (p.st.mode & 0o022) === 0;
  if (!parentNotReplaceable) {
    reasons.push(`parent ${parent} is writable by a non-owner with no sticky bit (mode ${octal(p.st.mode)})`);
  }
  if (reasons.length > 0) return factAbsent(fact, reasons.join("; "));
  return held(fact, `${fact.probeSourcePath}: owned by mica-assembler, not writable by another principal, in a directory that cannot replace it`);
}

/**
 * S133 · WIRE B — is this pilot's review in the machine's own ledger?
 *
 * THREE ANSWERS AND THE THIRD IS NOT THE SECOND. `findLedgerDeposit` returns
 * UNREADABLE separately from ABSENT precisely so this reader can keep "I could
 * not open the book" out of "the book does not say it" — the same distinction
 * the registrar draws with CANNOT_SEE_FRAME, and the one this module's own
 * header calls conditional-and-watched rather than conditional-and-silent. A
 * permission fault on the spine reads CANNOT_ASSESS with the errno named, never
 * FACT_ABSENT.
 *
 * NO ENV, AND NO `void env` EITHER. Every other family in this file reaches the
 * host through an injected reader so the DECISION can be exercised against
 * captured output; this one reads a path the DECLARATION names, which the tests
 * write themselves. There is nothing about this machine to inject.
 *
 * IT DOES NOT SAY STAMPED, and the name the arbiter gave the family is the reason it
 * does not have to: `pilot-review-in-ledger` claims the ledger and stops there.
 *
 * S134 Rb · AND NOW THERE ARE TWO LINES, WHICH IS NOT TWO FINDINGS. The journal
 * line is the arbiter narrating its own act; the RECORD BOOK line is what the
 * registrar accepted under owner-uid identity — a second party. When
 * `recordBook` is declared, the book is the line this family HOLDS on and the
 * journal is named beside it as corroboration. They are never added: BR ≠ TR
 * applied to the machine's own ledger, and two counts of one act would be a
 * broadcast wearing a record's clothes.
 */
function assessPilotReviewInLedger(fact: PilotReviewInLedgerFact): DeploymentFactFinding {
  const found = findLedgerDeposit(fact.micaLog, fact.chainSha256);
  if (found.state === "UNREADABLE") {
    return cannotAssess(
      fact,
      `the ledger could not be read: ${found.detail}. That is a deployment fact about ` +
        `this reader's access, not a finding about the review`
    );
  }
  if (found.state === "ABSENT") {
    return factAbsent(
      fact,
      `${fact.micaLog} carries no ${LEDGER_EVENT_TYPE} naming chain ` +
        `${fact.chainSha256.slice(0, 12)}...`
    );
  }
  const d = found.deposit;
  if (fact.writer !== undefined && d.moduleId === fact.writer) {
    return factAbsent(
      fact,
      `the review of chain ${fact.chainSha256.slice(0, 12)}... was deposited by ` +
        `${d.moduleId}, which is the principal declared as the chain's WRITER. A seat ` +
        `reviewing its own chain is a review of nothing`
    );
  }
  const journalLine =
    `${LEDGER_EVENT_TYPE} by ${d.moduleId} at seq ${String(d.sequenceNumber)} in ${fact.micaLog}`;
  if (fact.recordBook === undefined) {
    return held(fact, `${journalLine} (the journal line; no record book declared)`);
  }
  const book = findChainReviewRecord(fact.recordBook, fact.chainSha256);
  if (book.state === "UNREADABLE") {
    return cannotAssess(
      fact,
      `the journal names it (${journalLine}), but the record book could not be read: ` +
        `${book.detail}. The authoritative line is the one this reader could not open, ` +
        `so this is not a HELD on the journal alone`
    );
  }
  if (book.state === "ABSENT") {
    return factAbsent(
      fact,
      `the journal names it (${journalLine}) and the record book does NOT: ` +
        `${fact.recordBook} holds no ${LEDGER_EVENT_TYPE} for chain ` +
        `${fact.chainSha256.slice(0, 12)}.... A seat's own narration of an act it did ` +
        `not deposit is a broadcast, not a record`
    );
  }
  const record = book.records[0];
  return held(
    fact,
    `${LEDGER_EVENT_TYPE} in ${fact.recordBook}, deposited by ${record.depositor} at seq ` +
      `${String(record.sequenceNumber)} — the authoritative line; the journal corroborates ` +
      `it (${journalLine}). Two lines, one act, never summed`
  );
}

function assessUnitLastExit(fact: UnitLastExitFact, env: DeploymentFactsEnv): DeploymentFactFinding {
  const read = readUnitProperties(fact.unit, UNIT_LAST_EXIT_PROPERTIES, env);
  if (!read.ok) {
    return cannotAssess(fact, `systemctl show ${fact.unit} could not be run: ${read.error}`);
  }
  const props = parseUnitProperties(read.text);
  const result = props.get("Result") ?? "(not reported)";
  const started = (props.get("ExecMainStartTimestamp") ?? "").trim();
  // STEP 2 BEFORE STEP 4, and the header says why: `systemctl show` answers for
  // a unit that does not exist with exit 0 and status 0. Without this line a
  // typo'd unit name would read HELD forever.
  if (started.length === 0) {
    return cannotAssess(
      fact,
      `${fact.unit} reports no ExecMainStartTimestamp — it is either unknown to ` +
        `systemd on this host or has never run. systemctl show answers for an ` +
        `unknown unit with exit 0 and ExecMainStatus=0, so a held reading here ` +
        `would be vacuous (Result=${result})`
    );
  }
  const statusText = props.get("ExecMainStatus");
  if (statusText === undefined || !/^-?\d+$/.test(statusText.trim())) {
    return cannotAssess(
      fact,
      `${fact.unit} reports ExecMainStatus=${JSON.stringify(statusText ?? null)}, ` +
        `which is not an integer exit status (Result=${result})`
    );
  }
  const status = Number(statusText.trim());
  if (status !== 0) {
    return factAbsent(
      fact,
      `${fact.unit} last exited ${status} (Result=${result}, started ${started}). ` +
        `A unit that fails on a schedule fails on the schedule: this is the ` +
        `LAST run only, and says nothing about how many before it did the same`
    );
  }
  return held(fact, `${fact.unit} last exited 0 (Result=${result}, started ${started})`);
}

function assessUnitListenLoopback(
  fact: UnitListenLoopbackFact,
  env: DeploymentFactsEnv
): DeploymentFactFinding {
  const where = `${fact.unit} / port ${String(fact.port)}`;

  // 1 — the unit's own properties.
  const read = readUnitProperties(fact.unit, UNIT_LISTEN_LOOPBACK_PROPERTIES, env);
  if (!read.ok) {
    return cannotAssess(fact, `systemctl show ${fact.unit} could not be run: ${read.error}`);
  }
  const props = parseUnitProperties(read.text);
  const loadState = (props.get("LoadState") ?? "").trim();
  const activeState = (props.get("ActiveState") ?? "").trim() || "(not reported)";
  const subState = (props.get("SubState") ?? "").trim() || "(not reported)";

  // 2 — THE VACUOUS-PASS FENCE, and the header says why LoadState is the
  // discriminator here where unit-last-exit uses the start timestamp.
  if (loadState !== "loaded") {
    return cannotAssess(
      fact,
      `${fact.unit} reports LoadState=${loadState || "(not reported)"} — systemd does not have ` +
        `this unit loaded, and systemctl show answers for an unknown unit with exit 0. ` +
        `Whether a port is bound loopback-only says nothing about a unit nobody can find, so ` +
        `this is not assessed rather than scored`
    );
  }

  // 3 — a unit that is not up is not listening, and that is a FINDING.
  if (activeState !== "active") {
    return factAbsent(
      fact,
      `${fact.unit} is ${activeState}/${subState} — not active, so nothing of it is listening on ` +
        `port ${String(fact.port)} or anywhere else`
    );
  }

  // 4 — the sockets. sudo first, plain second, BOTH errors named if neither ran.
  const ss = readListeningSockets(env);
  if (!ss.ok) {
    return cannotAssess(
      fact,
      `no listening-socket table could be read, so where ${where} is bound was not read at all ` +
        `(${ss.error}). There is no third source for this: a bind address is not a mode bit`
    );
  }
  // S128-6: this clause rides EVERY reason below. A deployment where the
  // sudoers drop-in was never installed still reads, and says so where a human
  // looks — "it worked" and "it worked with the privilege it was granted" must
  // not print the same, or the grant becomes unfalsifiable.
  const via = viaNote(ss.via);
  const rows = parseListeningSockets(ss.text);

  // 5 — "I could not see" is not "it is not there". See the header.
  if (rows.length === 0) {
    return cannotAssess(
      fact,
      `ss ran and this reader parsed ZERO listening rows out of it, while ${fact.unit} is ` +
        `active/${subState}. That is this reader failing to read ss's table, not a silent host ` +
        `(${via})`
    );
  }

  // 6 — nothing on the declared port.
  const onPort = rows.filter((r) => r.port === fact.port);
  if (onPort.length === 0) {
    return factAbsent(
      fact,
      `nothing is listening on port ${String(fact.port)} (${String(rows.length)} other listening ` +
        `socket(s) were read), although ${fact.unit} is active/${subState} (${via})`
    );
  }

  // 7 — bound, but not where it was declared to be. NAME THE BIND.
  const strays = onPort.filter((r) => classifyBind(r.address) !== "LOOPBACK");
  if (strays.length > 0) {
    const named = strays
      .map((r) => `${r.printed} (${classifyBind(r.address) === "WILDCARD" ? "every interface" : "a non-loopback address"})`)
      .join(", ");
    return factAbsent(
      fact,
      `port ${String(fact.port)} is bound to ${named} — reachable from off this host. ` +
        `${fact.unit} is the one principal permitted out, and a listener of its own that is ` +
        `not on loopback is a door in the other direction (${via})`
    );
  }

  // 8 — the strengthener, RULED KEPT (S128-4). Only fires when POSITIVELY
  // contradicted, which is exactly what the S128-6 grant makes possible more
  // often: under sudo the pid column is populated for every principal's socket.
  const mainPidText = (props.get("MainPID") ?? "").trim();
  const mainPid = /^\d+$/.test(mainPidText) ? Number(mainPidText) : 0;
  const visiblePids = onPort.map((r) => r.pid).filter((p): p is number => p !== null);
  if (mainPid > 0 && visiblePids.length > 0 && !visiblePids.includes(mainPid)) {
    return factAbsent(
      fact,
      `port ${String(fact.port)} is bound to loopback, but by pid ` +
        `${visiblePids.join(", ")} — not ${fact.unit}'s MainPID ${String(mainPid)}. ` +
        `Something other than the declared unit is holding the declared port (${via})`
    );
  }

  const bound = onPort.map((r) => r.printed).join(", ");
  const pidNote =
    mainPid > 0 && visiblePids.includes(mainPid)
      ? `held by MainPID ${String(mainPid)}`
      : `owning pid not visible to this reader, so this says the PORT is loopback-only, not that ` +
        `the socket is ${fact.unit}'s`;
  return held(
    fact,
    `${fact.unit} is active/${subState} and port ${String(fact.port)} is bound loopback-only ` +
      `(${bound}; ${pidNote}; ${via})`
  );
}

function assessOneFact(fact: DeclaredFact, env: DeploymentFactsEnv): DeploymentFactFinding {
  switch (fact.family) {
    case "principal-uid":
      return assessPrincipalUid(fact, env);
    case "file-owner":
      return assessFileOwner(fact, env);
    case "file-not-writable-by":
      return assessFileNotWritableBy(fact, env);
    case "acl-entry":
      return assessAclEntry(fact, env);
    case "file-mode":
      return assessFileMode(fact, env);
    case "door-preconditions":
      return assessDoorPreconditions(fact, env);
    case "pilot-review-in-ledger":
      return assessPilotReviewInLedger(fact);
    case "unit-last-exit":
      return assessUnitLastExit(fact, env);
    case "unit-listen-loopback":
      return assessUnitListenLoopback(fact, env);
  }
}

// ── the whole reading ────────────────────────────────────────────────────

export interface DeploymentFactsReading {
  readonly declaration: DeploymentFactsDeclaration;
  /** FACT_ABSENT and CANNOT_ASSESS rows ONLY — negative-only vocabulary. Sorted by id. */
  readonly findings: readonly DeploymentFactFinding[];
  readonly heldCount: number;
  readonly factAbsentCount: number;
  readonly cannotAssessCount: number;
  /** Fact families this reader can check that the declaration named zero facts for. Census, not an alarm. */
  readonly undeclaredFamilies: readonly FactFamily[];
}

function noAssessment(declaration: DeploymentFactsDeclaration): DeploymentFactsReading {
  return {
    declaration,
    findings: [],
    heldCount: 0,
    factAbsentCount: 0,
    cannotAssessCount: 0,
    undeclaredFamilies: [],
  };
}

/**
 * Declared-never-derived: every input is either the declaration or a live
 * syscall this run performs itself. `env` is the injectable seam for tests
 * (see `PrincipalIdentity`'s header note); production callers pass `{}`.
 */
export function assessDeploymentFacts(
  declaration: DeploymentFactsDeclaration,
  env: DeploymentFactsEnv = {}
): DeploymentFactsReading {
  if (declaration.state !== "CONFIGURED") return noAssessment(declaration);

  const findings: DeploymentFactFinding[] = [];
  let heldCount = 0;
  let factAbsentCount = 0;
  let cannotAssessCount = 0;
  for (const fact of declaration.facts) {
    const finding = assessOneFact(fact, env);
    if (finding.state === "HELD") {
      heldCount++;
    } else {
      if (finding.state === "FACT_ABSENT") factAbsentCount++;
      else cannotAssessCount++;
      findings.push(finding);
    }
  }
  findings.sort((a, b) => a.id.localeCompare(b.id));

  const declaredFamilies = new Set(declaration.facts.map((f) => f.family));
  const undeclaredFamilies = FACT_FAMILIES.filter((fam) => !declaredFamilies.has(fam));

  return { declaration, findings, heldCount, factAbsentCount, cannotAssessCount, undeclaredFamilies };
}

// ── the printed ceiling — fence 3, verbatim on EVERY §3.7 render ────────────

export const DEPLOYMENT_FACTS_CEILING =
  "root can undo a fact AND edit this declaration AND silence this reader in the same act; " +
  'DF cannot attest its own invocation (F10 class). The T2 asterisks on the overview STAY; ' +
  'this reader changes "conditional" to "conditional, and un-holding prints within the ' +
  'report cadence" — nothing more.';
