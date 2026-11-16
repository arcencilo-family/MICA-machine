// ── GLUE · the clerk-clock-stamps reader — MICA's missing F3 mouth ──────────
//
// Ruled S109-B (arm a): MICA's tree builds the reader that turns a stamps file
// into `ClerkClockSource` (src/mica/sig/index.ts:104-117), the shape F3 already
// types and nothing on disk produced before this build (S109 arm-recon receipt
// §5 item 2). `mica-guard.ts` already refuses `clerkClockSource` from
// `--sensor-config` — "a hand-typed one would be MICA reading a second account
// this program authored itself" (mica-guard.ts:212-219). THIS FILE IS THE ONLY
// OTHER DOOR, and it is built to admit on verified custody, never to bypass
// that refusal: the refused path stays refused, byte-identical, untouched by
// anything below.
//
// ── WHY A CUSTODY DOOR, NOT JUST A NEW FLAG ──────────────────────────────────
//
//   A flag alone is a path string. Anyone who can write to that path can feed
//   MICA a clerk clock it invented — the same objection `--sensor-config`
//   already makes, restated for a file instead of a JSON blob. Ruled S101
//   solved exactly this problem for Sig's OTHER injected axis (`probeSource`):
//   see `probe-door.ts`, admitted ONLY on verified provenance — owned by a
//   named principal, and not writable by the invoking uid. This file applies
//   the SAME two layers (custody vs. correctness) to the clerk-clock axis.
//   THE DOOR CHECKS CUSTODY. IT DOES NOT CHECK WHETHER THE JOIN IS CORRECT —
//   that is F3's job (`sig/index.ts` runF3), unchanged, and F3 still refuses
//   to repair a malformed or duplicate stamp exactly as it always has.
//
// ── THE OWNER, AND WHY IT IS NOT A NEW PRINCIPAL ─────────────────────────────
//
//   The owner this door requires is `CLOCK_STAMPS_OWNER = "mica"` — the SAME
//   OS user that already holds exclusive read access to
//   `/etc/mica/submitter-mica.key` (mode 0400, S108 key-mode-check receipt),
//   because that is the identity `mica-clerk-caller.ts` (this directory) must
//   run as to sign anything at all. Reusing it means this door needs NO new
//   key, no new user, and no new ACL act: it rides on custody the deployment
//   already established for a different reason. This is a finding this build
//   surfaces, not a decision it makes — see the receipt.
//
// ── WHAT THIS DOOR CANNOT DO, printed rather than buried (unchanged from
//    probe-door.ts's own header, restated because it is load-bearing here too)
//
//   Root defeats it completely, and an invoking root is REFUSED rather than
//   waved through — a check whose answer is "yes" only because the asker could
//   have written the file anyway is decorative, and decorative is worse than
//   absent because it reads like a guarantee. Ownership is not correctness:
//   whoever wrote an admitted file could have written it wrongly, and no uid
//   makes a join true. The door raises the cost of forging clerk-clock evidence
//   from "write a file" to "be another principal." It claims nothing further.
//
// ── S108-C GRAMMAR, CARRIED HERE ──────────────────────────────────────────────
//
//   "No writer exists; FILE_ABSENT is honest state." This flag is NEW and NO
//   DEFAULT PATH exists for it. `--clerk-clock-stamps` absent from the
//   invocation never reaches this file at all (mica-guard.ts does not call it),
//   and F3 then reads NOT_CONFIGURED — disclosed, not counted, exactly as an
//   unconfigured F3 always has. `--clerk-clock-stamps` SUPPLIED and nothing at
//   that path is a LOUDER, DIFFERENT fact: an operator declared a source and
//   got nothing. That is FILE_ABSENT below, and mica-guard.ts turns it into a
//   GuardInvocationError (exit 2) — the same wiring-error treatment
//   `--probe-source` already gets on `NOT_FOUND`.

import { readFileSync, statSync } from "fs";
import type { Stats } from "fs";
import { UNATTRIBUTED_STAMP_WRITER } from "../mica/sig";
import type { ClerkClockSource, ClerkClockStamp } from "../mica/sig";

/** The principal that must own an admissible clerk-clock-stamps file. */
export const CLOCK_STAMPS_OWNER = "mica";

export const DOOR_CHECKED_CUSTODY_CLOCK =
  "THE DOOR CHECKED CUSTODY: the file is owned by " +
  `${CLOCK_STAMPS_OWNER} (the same principal that holds submitter-mica.key) ` +
  "and this invoker cannot write it.";

export const SIG_STILL_NEVER_VERIFIES_THE_CLOCK_JOIN =
  "AND F3 STILL NEVER VERIFIES THE JOIN. Ownership is not correctness: " +
  "whoever wrote this could have written it wrongly, and no uid makes a stamp " +
  "true. The door raises the cost of forging clerk-clock evidence from writing " +
  "a file to being another principal. It claims nothing further.";

/**
 * Why a clerk-clock-stamps file was refused at the door. Same nine-case shape
 * as `probe-door.ts`'s `ProbeDoorRefusal`, for the same reason: without the
 * five non-ruled cases the four ruled ones can pass while meaning nothing —
 * see each detail text below. S97-D(2) is in force throughout: NEVER report
 * cannot-see as does-not-exist.
 */
export type ClockDoorRefusal =
  | "NOT_FOUND"
  | "CANNOT_SEE"
  | "NOT_A_FILE"
  | "OWNER_PRINCIPAL_ABSENT"
  | "WRONG_OWNER"
  | "INVOKER_WRITABLE"
  | "INVOKER_IS_ROOT"
  | "PARENT_REPLACEABLE"
  | "UID_UNAVAILABLE";

export interface ClockDoorRefused {
  readonly admitted: false;
  readonly refusal: ClockDoorRefusal;
  readonly detail: string;
  readonly remedy: readonly string[];
}

export interface ClockDoorAdmitted {
  readonly admitted: true;
  readonly raw: string;
  readonly ownerUid: number;
  readonly mode: number;
  readonly provenance: string;
}

export type ClockDoorResult = ClockDoorRefused | ClockDoorAdmitted;

export interface ClockDoorEnv {
  readonly uid?: number;
  readonly gids?: readonly number[];
  readonly resolveOwner?: (name: string) => number | null;
}

/** Resolve a principal name to a uid via /etc/passwd. Same rule as probe-door.ts. */
export function resolveClockOwnerUid(name: string): number | null {
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

function invokerCanWrite(st: Stats, uid: number, gids: readonly number[]): boolean {
  if (uid === st.uid) return (st.mode & 0o200) !== 0;
  if (gids.includes(st.gid)) return (st.mode & 0o020) !== 0;
  return (st.mode & 0o002) !== 0;
}

const octal = (mode: number): string =>
  "0" + (mode & 0o7777).toString(8).padStart(4, "0").slice(-4);

/**
 * Admit a clerk-clock-stamps file, or refuse it with the failed check named.
 * NO DEFAULT PATH: an absent `--clerk-clock-stamps` never reaches this
 * function at all — F3 then reads NOT_CONFIGURED, exactly as an unconfigured
 * probeSource reads NOT_CONFIGURED for F4.
 */
export function admitClockStampsSource(path: string, env: ClockDoorEnv = {}): ClockDoorResult {
  const resolve = env.resolveOwner ?? resolveClockOwnerUid;
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

  if (uid === 0) {
    return {
      admitted: false,
      refusal: "INVOKER_IS_ROOT",
      detail:
        "the invoking uid is 0. Root can rewrite this file whatever its mode " +
        "says, so 'not writable by the invoker' cannot be established and the " +
        "check would pass VACUOUSLY. The door refuses instead of pretending.",
      remedy: [
        `Run mica-guard as an ordinary uid that is NOT root and NOT ${CLOCK_STAMPS_OWNER}.`,
        `The stamps file needs to be readable by that uid and writable only by ` +
          `${CLOCK_STAMPS_OWNER} (mode 0644 owned by ${CLOCK_STAMPS_OWNER} does both).`,
      ],
    };
  }

  let st: Stats;
  try {
    st = statSync(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        admitted: false,
        refusal: "NOT_FOUND",
        detail:
          `no file exists at ${path}. This is 'it is not there', NOT 'I was not ` +
          `allowed to look' — S108-C's FILE_ABSENT grammar: no writer has ` +
          `produced a stamp yet, or none was ever pointed here.`,
        remedy: [
          `Have mica-clerk-caller.ts (running as ${CLOCK_STAMPS_OWNER}) write its ` +
            `stamps to ${path}.`,
        ],
      };
    }
    return {
      admitted: false,
      refusal: "CANNOT_SEE",
      detail: `${path} could not be stat'd (${String(code ?? err)}). THIS IS NOT 'the file is absent'.`,
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
      remedy: [`Point --clerk-clock-stamps at the regular file ${CLOCK_STAMPS_OWNER} writes.`],
    };
  }

  const wantUid = resolve(CLOCK_STAMPS_OWNER);
  if (wantUid === null) {
    return {
      admitted: false,
      refusal: "OWNER_PRINCIPAL_ABSENT",
      detail:
        `the principal ${CLOCK_STAMPS_OWNER} could not be resolved to a uid on ` +
        `this host, so there is no owner to compare against.`,
      remedy: [`Confirm the ${CLOCK_STAMPS_OWNER} OS user exists (it already must, for the submit key).`],
    };
  }

  if (st.uid !== wantUid) {
    return {
      admitted: false,
      refusal: "WRONG_OWNER",
      detail:
        `${path} is owned by uid ${st.uid}; an admissible stamps file must be ` +
        `owned by ${CLOCK_STAMPS_OWNER} (uid ${wantUid}). A parallel clerk read ` +
        `held by the same hand that feeds MICA's guard is not held outside — the ` +
        `same objection mica-guard.ts already makes to a hand-typed clerkClockSource.`,
      remedy: [`sudo chown ${CLOCK_STAMPS_OWNER} ${path}`],
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
        `stat'd (${String((err as NodeJS.ErrnoException).code ?? err)}).`,
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
        `(mode ${octal(pst.mode)}, no sticky bit) — this invoker could delete ` +
        `the file and put its own in place. Ownership of a file you can replace ` +
        `is not custody.`,
      remedy: [
        `Move the stamps file into a directory this invoker cannot write, owned by ${CLOCK_STAMPS_OWNER},`,
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
        `(${String((err as NodeJS.ErrnoException).code ?? err)}).`,
      remedy: [`sudo chmod 0644 ${path}`],
    };
  }

  return {
    admitted: true,
    raw,
    ownerUid: st.uid,
    mode: st.mode,
    provenance:
      `${path} owned by ${CLOCK_STAMPS_OWNER} (uid ${st.uid}), mode ${octal(st.mode)}, ` +
      `not writable by invoking uid ${uid}, in a directory that invoker cannot replace it in.`,
  };
}

// ── content: one ClerkClockStamp per JSONL line, refused-not-repaired ────────
//
// mica-clerk-caller.ts appends one stamp per line (the recon's own sketch,
// S109 arm-recon receipt §2: "append stamps to the stamps JSONL file"). This
// reader checks JSON-parseability and gross field shape ONLY — the same width
// `MicaLogFile`'s `toRecord` checks for MICA log records. It does NOT re-check
// separation/intake/clerk_id-uniqueness/clerk_seq-ordering: those are F3's own
// job (sig/index.ts runF3) and re-checking them here would be a second grader
// of the same bytes, the exact defect witness-report.ts's header names and
// refuses to repeat.

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function isFiniteNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}
function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.length > 0;
}

/** Normalise one parsed JSON value into a ClerkClockStamp, or say why not. */
export function toClockStamp(x: unknown): ClerkClockStamp | string {
  if (!isObj(x)) return "line is not a JSON object";
  // S134 Ra · WHO WROTE IT, OR THE ADMISSION THAT THIS FILE CANNOT SAY.
  //
  // Present: a non-empty string, and NOT the sentinel — a line writing
  // "UNATTRIBUTED" itself is a writer claiming the one value that means "no
  // writer was recorded", which is a malformed line and not an honest gap.
  // Absent: the sentinel, never a principal's name. See sig/index.ts.
  let moduleId: string;
  if (x.moduleId === undefined) {
    moduleId = UNATTRIBUTED_STAMP_WRITER;
  } else if (!isNonEmptyString(x.moduleId)) {
    return "moduleId is present and is not a non-empty string";
  } else if (x.moduleId === UNATTRIBUTED_STAMP_WRITER) {
    return `moduleId is the reserved sentinel ${JSON.stringify(UNATTRIBUTED_STAMP_WRITER)}, which only an ABSENT moduleId may read as`;
  } else {
    moduleId = x.moduleId;
  }
  // ⛔ T8's FIELD, AND THE ONE THIS LOADER DROPPED ON THE FLOOR.
  //
  // MEASURED LIVE 2026-09-29T23:26Z, the whole cost of the omission: the carrier
  // wrote 1244 stamps EVERY ONE of which named its chain, this function built a
  // ClerkClockStamp without the field, and F3 refused ALL 1244 — because under
  // T8 a stamp that does not name its chain is refused, and by the time F3 saw
  // it, none of them did. Sig went CANNOT_ASSESS on a record whose stamps were
  // correct on disk. The reader was right; the projection in front of it was not.
  //
  // WHY NOTHING CAUGHT IT. `ClerkClockStamp.chainIdentity` is OPTIONAL, and
  // deliberately so — its own comment says "the `?` on this field is the wire
  // shape, not the rule", because a stamp from an older carrier must be
  // READABLE in order to be REFUSED with a reason. That decision is right. Its
  // cost is exactly this: an object literal that omits an optional property
  // typechecks, so the compiler had nothing to say about a loader that silently
  // stopped carrying a MANDATORY field. `tsc` cannot defend a rule the type
  // does not state.
  //
  // THE THREE ARMS, mirroring `moduleId` directly above:
  //   absent                      -> omitted, and F3 refuses it by rule.
  //   a non-empty string          -> carried VERBATIM. Whether it MATCHES the
  //                                  expected chain is runF3's judgement, never
  //                                  this loader's; a shaper that decided
  //                                  membership would be a second reckoning
  //                                  beside the reader's.
  //   present, not a non-empty
  //   string                      -> a malformed LINE, refused here, so the
  //                                  problem is reported at the byte offset
  //                                  rather than as a mysterious refusal later.
  let chainIdentity: string | undefined;
  if (x.chainIdentity === undefined) {
    chainIdentity = undefined;
  } else if (!isNonEmptyString(x.chainIdentity)) {
    return "chainIdentity is present and is not a non-empty string";
  } else {
    chainIdentity = x.chainIdentity;
  }
  if (!isFiniteNum(x.sequenceNumber)) return "sequenceNumber is not a finite number";
  if (!isFiniteNum(x.clerk_seq)) return "clerk_seq is not a finite number";
  if (!isObj(x.clerk_time)) return "clerk_time is not an object";
  if (!isFiniteNum(x.clerk_time.wall_ms)) return "clerk_time.wall_ms is not a finite number";
  if (typeof x.clerk_time.monotonic_ns !== "string" || x.clerk_time.monotonic_ns.length === 0) {
    return "clerk_time.monotonic_ns is not a non-empty string";
  }
  if (x.separation !== "SEPARATE_PROCESS" && x.separation !== "IN_PROCESS_NO_SEPARATION") {
    return "separation is not one of the two declared values";
  }
  if (x.intake !== "SOCKET" && x.intake !== "LOCAL_CALL" && x.intake !== "CLERK_INTERNAL") {
    return "intake is not one of the three declared values";
  }
  if (!isNonEmptyString(x.clerk_id)) return "clerk_id is not a non-empty string";
  if (!isNonEmptyString(x.clerk_boot_id)) return "clerk_boot_id is not a non-empty string";
  return {
    moduleId,
    // Present only when the line carried it. Spread rather than `chainIdentity:
    // undefined`, so a stamp from an older carrier has NO such key — which is
    // what `x.chainIdentity === undefined` means one arm up, and what F3's
    // "absent" arm is written against.
    ...(chainIdentity === undefined ? {} : { chainIdentity }),
    sequenceNumber: x.sequenceNumber,
    clerk_seq: x.clerk_seq,
    clerk_time: {
      wall_ms: x.clerk_time.wall_ms,
      monotonic_ns: x.clerk_time.monotonic_ns,
    },
    separation: x.separation,
    intake: x.intake,
    clerk_id: x.clerk_id,
    clerk_boot_id: x.clerk_boot_id,
  };
}

export interface ClockStampsProblem {
  readonly line: number; // 1-indexed, for a human opening the file
  readonly detail: string;
}

export type ClockStampsFileLoadState =
  /** Admitted through the door, parsed, at least one stamp. The only clean state. */
  | "LOADED"
  /** Door refusal NOT_FOUND: S108-C's FILE_ABSENT grammar. */
  | "FILE_ABSENT"
  /** Door refusal CANNOT_SEE / NOT_A_FILE / OWNER_PRINCIPAL_ABSENT / UID_UNAVAILABLE. */
  | "FILE_UNREADABLE"
  /** Door refusal WRONG_OWNER / INVOKER_WRITABLE / INVOKER_IS_ROOT / PARENT_REPLACEABLE. */
  | "CUSTODY_REFUSED"
  /** Admitted, but a line did not parse or did not shape. Refused, not repaired. */
  | "FILE_MALFORMED"
  /** Admitted, readable, and carrying no stamps at all. */
  | "FILE_EMPTY_OR_ERASED";

const UNREADABLE_REFUSALS: readonly ClockDoorRefusal[] = [
  "CANNOT_SEE",
  "NOT_A_FILE",
  "OWNER_PRINCIPAL_ABSENT",
  "UID_UNAVAILABLE",
];

export interface ClockStampsReadResult {
  readonly loadState: ClockStampsFileLoadState;
  readonly source: string;
  readonly stamps: ClerkClockSource;
  readonly doorRefusal: ClockDoorRefused | null;
  readonly problem: ClockStampsProblem | null;
  readonly provenance: string | null;
}

/**
 * The whole read: door, then content. ONE function, ONE result, so a caller
 * (mica-guard.ts) cannot check the door and forget the content, or the
 * reverse.
 */
export function readClockStampsFile(path: string, env: ClockDoorEnv = {}): ClockStampsReadResult {
  const door = admitClockStampsSource(path, env);
  if (!door.admitted) {
    const loadState: ClockStampsFileLoadState =
      door.refusal === "NOT_FOUND"
        ? "FILE_ABSENT"
        : UNREADABLE_REFUSALS.includes(door.refusal)
          ? "FILE_UNREADABLE"
          : "CUSTODY_REFUSED";
    return {
      loadState,
      source: path,
      stamps: [],
      doorRefusal: door,
      problem: null,
      provenance: null,
    };
  }

  const stamps: ClerkClockStamp[] = [];
  const lines = door.raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (text.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return {
        loadState: "FILE_MALFORMED",
        source: path,
        stamps: [],
        doorRefusal: null,
        problem: { line: i + 1, detail: `line ${i + 1} is not valid JSON: ${String(err)}` },
        provenance: door.provenance,
      };
    }
    const stamp = toClockStamp(parsed);
    if (typeof stamp === "string") {
      return {
        loadState: "FILE_MALFORMED",
        source: path,
        stamps: [],
        doorRefusal: null,
        problem: { line: i + 1, detail: `line ${i + 1} is not a ClerkClockStamp: ${stamp}` },
        provenance: door.provenance,
      };
    }
    stamps.push(stamp);
  }

  if (stamps.length === 0) {
    return {
      loadState: "FILE_EMPTY_OR_ERASED",
      source: path,
      stamps: [],
      doorRefusal: null,
      problem: null,
      provenance: door.provenance,
    };
  }

  return {
    loadState: "LOADED",
    source: path,
    stamps,
    doorRefusal: null,
    problem: null,
    provenance: door.provenance,
  };
}

/**
 * S134 Ra · WHO WROTE THE STAMPS, COUNTED — the boundary printed, not remembered.
 *
 * Returned in FILE ORDER of first appearance, with the sentinel wherever the
 * line carried no writer. A caller that wants "is this file attributable yet"
 * reads the sentinel's count; a caller that wants "may I say STAMPED for the
 * arbiter" reads the arbiter's.
 */
export function censusOfStampWriters(
  stamps: ClerkClockSource
): readonly { readonly moduleId: string; readonly count: number }[] {
  const counts = new Map<string, number>();
  for (const s of stamps) counts.set(s.moduleId, (counts.get(s.moduleId) ?? 0) + 1);
  return [...counts.entries()].map(([moduleId, count]) => ({ moduleId, count }));
}

/** `2 UNATTRIBUTED / 1 mica-arbiter` — the census as one printable clause. */
export function formatStampWriters(stamps: ClerkClockSource): string {
  const census = censusOfStampWriters(stamps);
  if (census.length === 0) return "no stamps";
  return census.map((c) => `${String(c.count)} ${c.moduleId}`).join(" / ");
}

/**
 * S134 Ra · MAY A READER SAY `STAMPED` FOR THIS RECORD?
 *
 * Only on a stamp that carries a real writer AND matches the pair. A legacy
 * line matches on `sequenceNumber` alone and that is exactly the false positive
 * Ra exists to stop: the arbiter's seven sat beside the registrar's with
 * nothing to tell them apart, and a sequenceNumber match across writers is a
 * coincidence, not a join.
 */
export function stampFor(
  stamps: ClerkClockSource,
  moduleId: string,
  sequenceNumber: number
): ClerkClockStamp | null {
  if (moduleId === UNATTRIBUTED_STAMP_WRITER) return null;
  for (const s of stamps) {
    if (s.moduleId === moduleId && s.sequenceNumber === sequenceNumber) return s;
  }
  return null;
}

/** One line for a census: what was opened, what came back, how much, and whose. */
export function describeClockStampsRead(r: ClockStampsReadResult): string {
  const base = `${r.source}: loadState=${r.loadState} stamps=${r.stamps.length}`;
  if (r.doorRefusal !== null) return `${base} — DOOR REFUSED (${r.doorRefusal.refusal}): ${r.doorRefusal.detail}`;
  if (r.problem !== null) return `${base} — ${r.problem.detail}`;
  if (r.stamps.length === 0) return base;
  return `${base} writers=${formatStampWriters(r.stamps)}`;
}
