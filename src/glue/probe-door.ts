// ── GLUE · the probe door — provenance as a kernel fact ──────────────────────
//
// RULED (the arbiter, S101, shape (a)): `mica-guard` admits a probeSource file ONLY on
// verified provenance — owned by `mica-assembler`, and NOT writable by the
// invoking uid.
//
// ── WHY A DOOR AT ALL, AND WHY THIS ONE ─────────────────────────────────────
//
//   `mica-guard` already refuses `clerkClockSource` from a config file, and the
//   ground it gives is the one that matters here too: *a hand-typed one would be
//   MICA reading a second account this program authored itself*. A ProbeSource
//   read from an arbitrary path is, to this program, INDISTINGUISHABLE from a
//   hand-typed one. `mica-assembler` may have written it; nothing in the bytes
//   says so.
//
//   D-01's whole mechanism is an expectation HELD OUTSIDE the observed system.
//   This module is where "held outside" stops being a sentence in a receipt and
//   becomes something the kernel can be asked about: a uid that is not this one,
//   and a file this one cannot rewrite.
//
// ── THE TWO LAYERS, NAMED SEPARATELY (ruling §3) `[LB]` ─────────────────────
//
//   THE DOOR checks CUSTODY: who owns the file, and whether the invoker could
//   have written it. That is all it checks and all it claims.
//
//   SIG STILL NEVER VERIFIES THE JOIN. F4's own ceiling is unchanged and stays
//   printed: whoever assembled the injection could have assembled it wrongly,
//   and no ownership bit makes a join correct. The door raises the cost of
//   forging provenance from "write a file" to "be another principal". It does
//   not make the evidence true.
//
//   A reader who collapses these two into "MICA verified the probe" has been
//   told something this code does not say.
//
// ── WHAT THIS DOOR CANNOT DO, printed rather than buried ────────────────────
//
//   Root defeats it completely, which is why an invoking root is REFUSED rather
//   than waved through: a check whose answer is "yes" only because the asker
//   could have written the file anyway is decorative, and a decorative check is
//   worse than none because it reads like a guarantee.

import { readFileSync, statSync } from "fs";
import type { Stats } from "fs";

/** The principal that must own an admissible probe source. */
export const PROBE_SOURCE_OWNER = "mica-assembler";

/**
 * The two layers, as one sentence each, carried into the census so the report
 * cannot state the first and imply the second.
 */
export const DOOR_CHECKED_CUSTODY =
  "THE DOOR CHECKED CUSTODY: the file is owned by " +
  `${PROBE_SOURCE_OWNER} and this invoker cannot write it.`;

export const SIG_STILL_NEVER_VERIFIES_THE_JOIN =
  "AND SIG STILL NEVER VERIFIES THE JOIN. Ownership is not correctness: " +
  "whoever assembled this could have assembled it wrongly, and no uid makes a " +
  "join true. The door raises the cost of forging provenance from writing a " +
  "file to being another principal. It claims nothing further.";

/**
 * Why a probe source was refused. NINE cases, because a door that says only
 * "no" teaches nothing — and because the S97-D(2) class is in force: NEVER
 * report cannot-see as does-not-exist.
 *
 * FOUR are the ruled ones (NOT_FOUND, CANNOT_SEE, WRONG_OWNER,
 * INVOKER_WRITABLE). The other five exist because without them the ruled four
 * can pass while meaning nothing — see each one's own detail text.
 */
export type ProbeDoorRefusal =
  | "NOT_FOUND"
  | "CANNOT_SEE"
  | "NOT_A_FILE"
  | "OWNER_PRINCIPAL_ABSENT"
  | "WRONG_OWNER"
  | "INVOKER_WRITABLE"
  | "INVOKER_IS_ROOT"
  | "PARENT_REPLACEABLE"
  | "UID_UNAVAILABLE";

export interface ProbeDoorRefused {
  readonly admitted: false;
  readonly refusal: ProbeDoorRefusal;
  readonly detail: string;
  /** The acts that would satisfy the failed check. Never performed here. */
  readonly remedy: readonly string[];
}

export interface ProbeDoorAdmitted {
  readonly admitted: true;
  /** The file's bytes, unparsed. The door checks custody, not content. */
  readonly raw: string;
  readonly ownerUid: number;
  readonly mode: number;
  /** One line for the census. */
  readonly provenance: string;
}

export type ProbeDoorResult = ProbeDoorRefused | ProbeDoorAdmitted;

export interface ProbeDoorEnv {
  /** Invoking uid. Absent means the platform would not say — refused. */
  readonly uid?: number;
  /** Invoking gids, for the group-class resolution. */
  readonly gids?: readonly number[];
  /** Resolves `mica-assembler` to a uid. Absent -> read /etc/passwd. */
  readonly resolveOwner?: (name: string) => number | null;
}

/**
 * Resolve a principal name to a uid via /etc/passwd.
 *
 * Node has no `getpwnam`. /etc/passwd is world-readable by design on every
 * system this ships to; if it cannot be read, the honest answer is "I could not
 * resolve the principal", never "the principal is wrong".
 */
export function resolveOwnerUid(name: string): number | null {
  let text: string;
  try {
    text = readFileSync("/etc/passwd", "utf8");
  } catch {
    return null;
  }
  for (const line of text.split("\n")) {
    const parts = line.split(":");
    if (parts.length >= 3 && parts[0] === name) {
      const uid = Number(parts[2]);
      return Number.isInteger(uid) ? uid : null;
    }
  }
  return null;
}

/** The write bit that applies to THIS invoker, by owner/group/other class. */
function invokerCanWrite(
  st: Stats,
  uid: number,
  gids: readonly number[]
): boolean {
  if (uid === st.uid) return (st.mode & 0o200) !== 0;
  if (gids.includes(st.gid)) return (st.mode & 0o020) !== 0;
  return (st.mode & 0o002) !== 0;
}

const octal = (mode: number): string =>
  "0" + (mode & 0o7777).toString(8).padStart(4, "0").slice(-4);

/**
 * Admit a probe source, or refuse it with the failed check named.
 *
 * OPTION-B THROUGHOUT: no default path, no fallback, and nothing is inferred.
 * An absent `--probe-source` never reaches this function at all; F4 then reads
 * NOT_CONFIGURED and is disclosed rather than counted, exactly as F3 does.
 */
export function admitProbeSource(
  path: string,
  env: ProbeDoorEnv = {}
): ProbeDoorResult {
  const resolve = env.resolveOwner ?? resolveOwnerUid;

  const uid = env.uid;
  if (uid === undefined) {
    return {
      admitted: false,
      refusal: "UID_UNAVAILABLE",
      detail:
        "this platform will not say what uid is running, so the door cannot " +
        "establish that the file's owner is somebody else. A custody check that " +
        "cannot identify the asker is not a custody check.",
      remedy: ["Run mica-guard on a POSIX host where process.getuid() is available."],
    };
  }

  // ROOT FIRST, and refused rather than admitted `[LB]`.
  //
  // Root writes regardless of every bit below. If the invoker is root the mode
  // check would return "cannot write" while being false in fact, and the census
  // would print a custody guarantee that the kernel does not back.
  if (uid === 0) {
    return {
      admitted: false,
      refusal: "INVOKER_IS_ROOT",
      detail:
        "the invoking uid is 0. Root can rewrite this file whatever its mode " +
        "says, so 'not writable by the invoker' cannot be established and the " +
        "check would pass VACUOUSLY. A decorative check is worse than none: it " +
        "reads like a guarantee. The door refuses instead of pretending.",
      remedy: [
        `Run mica-guard as an ordinary uid that is NOT root and NOT ${PROBE_SOURCE_OWNER}.`,
        "The probe file needs to be readable by that uid and writable only by " +
          `${PROBE_SOURCE_OWNER} (mode 0644 owned by ${PROBE_SOURCE_OWNER} does both).`,
      ],
    };
  }

  let st: Stats;
  try {
    st = statSync(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // S97-D(2) IS IN FORCE: a path this process may not traverse must NEVER be
    // reported as a path that does not exist. Those are different findings and
    // they want different people.
    if (code === "ENOENT") {
      return {
        admitted: false,
        refusal: "NOT_FOUND",
        detail:
          `no file exists at ${path}. This is 'it is not there', NOT 'I was not ` +
          `allowed to look' — the two are reported separately here on purpose.`,
        remedy: [
          `Have ${PROBE_SOURCE_OWNER} write the assembler's ProbeSource output to ${path}.`,
        ],
      };
    }
    return {
      admitted: false,
      refusal: "CANNOT_SEE",
      detail:
        `${path} could not be stat'd (${String(code ?? err)}). THIS IS NOT ` +
        `'the file is absent'. The door could not look, and says so rather than ` +
        `reporting an absence it never established.`,
      remedy: [
        `Grant this invoker traverse on the directories leading to ${path}, and read on the file.`,
        "Do NOT grant write — that would trade this refusal for INVOKER_WRITABLE.",
      ],
    };
  }

  if (!st.isFile()) {
    return {
      admitted: false,
      refusal: "NOT_A_FILE",
      detail: `${path} exists and is not a regular file, so it has no single owner to check.`,
      remedy: [`Point --probe-source at the regular file ${PROBE_SOURCE_OWNER} wrote.`],
    };
  }

  const wantUid = resolve(PROBE_SOURCE_OWNER);
  if (wantUid === null) {
    // NOT the same as WRONG_OWNER. The principal that is supposed to hold
    // custody does not exist on this box, which is a deployment fact about the
    // system, not a fact about this file.
    return {
      admitted: false,
      refusal: "OWNER_PRINCIPAL_ABSENT",
      detail:
        `the principal ${PROBE_SOURCE_OWNER} could not be resolved to a uid on ` +
        `this host, so there is no owner to compare against. Reporting this as ` +
        `WRONG_OWNER would blame the file for a missing user.`,
      remedy: [
        `sudo useradd --system --no-create-home --shell /usr/sbin/nologin ${PROBE_SOURCE_OWNER}`,
      ],
    };
  }

  if (st.uid !== wantUid) {
    return {
      admitted: false,
      refusal: "WRONG_OWNER",
      detail:
        `${path} is owned by uid ${st.uid}; an admissible probe source must be ` +
        `owned by ${PROBE_SOURCE_OWNER} (uid ${wantUid}). An expectation held by ` +
        `the same hand that reads it is not held OUTSIDE, and that is the whole ` +
        `claim this leg rests on.`,
      remedy: [`sudo chown ${PROBE_SOURCE_OWNER} ${path}`],
    };
  }

  if (invokerCanWrite(st, uid, env.gids ?? [])) {
    return {
      admitted: false,
      refusal: "INVOKER_WRITABLE",
      detail:
        `${path} is mode ${octal(st.mode)} and uid ${uid} can write it. Custody ` +
        `by another principal means nothing if this one can rewrite the bytes ` +
        `before reading them.`,
      remedy: [`sudo chmod 0644 ${path}`],
    };
  }

  // THE PARENT DIRECTORY, and why this is not over-reach `[LB]`.
  //
  // A file the invoker cannot write, in a directory the invoker CAN write, is a
  // file the invoker can DELETE AND REPLACE. The ownership check would then be
  // defeatable by anyone the check is meant to constrain, which makes it
  // decorative in exactly the way the root case is. The sticky bit is the
  // exception the kernel already provides (/tmp being the obvious case), and it
  // is honoured here rather than special-cased by path.
  const parent = path.replace(/\/[^/]*$/, "") || "/";
  let pst: Stats;
  try {
    pst = statSync(parent);
  } catch (err) {
    return {
      admitted: false,
      refusal: "CANNOT_SEE",
      detail:
        `${path} passed its own checks but its directory ${parent} could not be ` +
        `stat'd (${String((err as NodeJS.ErrnoException).code ?? err)}), so the ` +
        `door cannot establish whether this invoker could replace the file.`,
      remedy: [`Grant this invoker traverse and read on ${parent}.`],
    };
  }
  const sticky = (pst.mode & 0o1000) !== 0;
  if (!sticky && invokerCanWrite(pst, uid, env.gids ?? [])) {
    return {
      admitted: false,
      refusal: "PARENT_REPLACEABLE",
      detail:
        `${path} is not writable by uid ${uid}, but its directory ${parent} is ` +
        `(mode ${octal(pst.mode)}, no sticky bit) — so this invoker can delete ` +
        `the file and put its own in place. Ownership of a file you can replace ` +
        `is not custody.`,
      remedy: [
        `Move the probe source into a directory this invoker cannot write, owned by ${PROBE_SOURCE_OWNER},`,
        "or set the sticky bit on that directory so only its owner can unlink.",
      ],
    };
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return {
      admitted: false,
      refusal: "CANNOT_SEE",
      detail:
        `${path} passed every custody check and then could not be READ ` +
        `(${String((err as NodeJS.ErrnoException).code ?? err)}). The door does ` +
        `not report this as absence or as bad ownership; it is neither.`,
      remedy: [`sudo chmod 0644 ${path}`],
    };
  }

  return {
    admitted: true,
    raw,
    ownerUid: st.uid,
    mode: st.mode,
    provenance:
      `${path} owned by ${PROBE_SOURCE_OWNER} (uid ${st.uid}), mode ` +
      `${octal(st.mode)}, not writable by invoking uid ${uid}, in a directory ` +
      `that invoker cannot replace it in.`,
  };
}
