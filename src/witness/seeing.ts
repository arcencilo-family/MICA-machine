// ── MICA · the witness's SEEING half — one fixed, published method ───────────
//
// RULED (the arbiter, board 2026-10-10 18:20Z): the witness SEES and WRITES. Its
// retaining half is `witnessd` (heads presented at an intake, retained, no
// reads answered — S85). This file is the other half: the METHOD by which the
// witness looks at the one target an act claimed, and the closed vocabulary in
// which it writes what changed. `seeingd.ts` is the process that runs it.
//
// ── WHAT IT LOOKS AT, AND WHAT IT DOES NOT ──────────────────────────────────
//
//   ONE path per act — the act's CLAIMED target, as the bridge canonicalised it
//   from the caller's `targetIdentity`. Never the filesystem around it, never
//   anything else the act may touch. The pointer is the caller's claim; only
//   the LOOK is the witness's. A path reached THROUGH a symbolic link in any
//   directory component is refused (INDIRECT_PATH): the witness looks at the
//   object the path names, never at one a link elsewhere would hand it.
//
// ── WHEN, AND SINCE-LAST-LOOK (phase R SHRINK, audit 2026-10-11 09:32Z) ──────
//
//   Nobody waits for the witness. The bridge hands it the pointer after the act
//   persisted; /guard decides as if the witness did not exist. For each pointed
//   act the witness takes ONE look at the claimed target, at the act's close (or
//   when the close times out). There is NO look before the act and no second
//   look: no window, and no anchor on anything the subject's records can post.
//   The look's FACET is this look against the witness's OWN last recorded look at
//   the SAME path — whenever that was, an earlier pointed act's close or never
//   (FIRST_SEEN). It is "the target differs from when I last saw it", never
//   "this act changed it"; attribution is phase H's, with S208 and its own
//   anchor design. The outcome is that facet, or HELD (the bridge's own decision
//   not to execute) or LATE (the act ran with no /guard answer, or its close
//   never reached the witness).
//
// ── THE GRADE, AS RULED (audit 18:03Z (1)) ───────────────────────────────────
//
//   One look by one internal process: a MEASURED fact (Lane A) at EG-1 (RMBA
//   §11: "internal measurement without independent verification"). The class
//   rides in the record as `observed`; it is re-derivable by comparing this
//   record's look with the witness's prior look at that path — which the book
//   holds as the `look` of the earlier record for the path (its time in
//   `priorLookAt`): digests compare equal or not, but no one can re-take a
//   past look.

import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readFileSync, readSync, readlinkSync } from "fs";
import { createHash, createHmac } from "crypto";
import { basename, dirname } from "path";

import { subjectCanonicalJson } from "../glue/subject-event-journal";

// ── the vocabulary ───────────────────────────────────────────────────────────

/**
 * THE FACETS — phase R, SIGHT-SINCE-LAST-LOOK (audit 2026-10-11 09:32Z). Per pointed act, ONE look at the target
 * after the act; its facet is the target's state NOW against the witness's OWN last look at that same target —
 * "since the witness last looked", never "caused by this act" (attribution is phase H's, with S208 and its own
 * anchor design). CLOSED and TOTAL: `classifyFacet` is the whole map and its test walks every combination.
 *   FIRST_SEEN        this look was taken, and the witness has no earlier look at this target
 *   SAME              present or absent exactly as last seen, content and metadata verified unchanged
 *   EXISTENCE_DIFFERS present vs absent changed
 *   TYPE_DIFFERS      file / dir / symlink / other changed
 *   CONTENT_DIFFERS   same type, content (or size, when content is uncomparable) changed
 *   META_DIFFERS      same content, mode / owner / times changed
 *   UNOBSERVABLE      this look could not be taken (WHATEVER THE HISTORY: a failed look is never FIRST_SEEN —
 *                     audit 2026-10-11 18:43Z, W-1), or the last could not, or content cannot be confirmed either way
 * and two OUTCOME facets the look never yields, set from the act's own records:
 *   HELD              the bridge's own decision was not to execute (execute:false)
 *   LATE              the act ran with no /guard answer, or its close never reached the witness
 */
export type EffectClass =
  | "FIRST_SEEN"
  | "SAME"
  | "EXISTENCE_DIFFERS"
  | "TYPE_DIFFERS"
  | "CONTENT_DIFFERS"
  | "META_DIFFERS"
  | "UNOBSERVABLE"
  | "HELD"
  | "LATE";

export const EFFECT_CLASSES: readonly EffectClass[] = Object.freeze([
  "FIRST_SEEN",
  "SAME",
  "EXISTENCE_DIFFERS",
  "TYPE_DIFFERS",
  "CONTENT_DIFFERS",
  "META_DIFFERS",
  "UNOBSERVABLE",
  "HELD",
  "LATE",
]) as readonly EffectClass[];

/** The two OUTCOME facets the look map never returns — the bridge's decision word, not the witness's sight. */
export const OUTCOME_ONLY_CLASSES: readonly EffectClass[] = Object.freeze(["HELD", "LATE"]) as readonly EffectClass[];

/**
 * The facets that carry no evidence of a change either way, so never a value or damage class on the book: FIRST_SEEN
 * (no earlier look to compare), UNOBSERVABLE (could not see, or could not confirm), LATE (the act's fate is unknown).
 */
export const EVIDENCE_FREE_CLASSES: readonly EffectClass[] = Object.freeze(["FIRST_SEEN", "UNOBSERVABLE", "LATE"]) as readonly EffectClass[];

/** A regular file is digested only up to this many bytes. */
export const CONTENT_CAP_BYTES = 1048576;
/** A directory's entry names are digested only up to this many entries. */
export const LISTING_CAP_ENTRIES = 4096;

// ── the method, frozen, and its digest ───────────────────────────────────────

/**
 * THE PUBLISHED METHOD. Every rule that decides a class, and every ceiling the
 * witness's records are read under, is a sentence here; the digest covers all
 * of it, and the digest names the record class (CONSEQUENCE@…), so records of
 * two methods are never summed by any reader. ⚠ The digest covers the method's
 * WORDS; the code is pinned by the suites (seeing.test.ts, seeingd.test.ts).
 */
export const SEEING_METHOD = Object.freeze({
  name: "MICA witness, seeing half: the state of each pointed act's target since the witness last looked (phase R)",
  version: 1,
  contentCapBytes: CONTENT_CAP_BYTES,
  listingCapEntries: LISTING_CAP_ENTRIES,
  vocabulary: EFFECT_CLASSES,
  rules: Object.freeze([
    "LOOK: the path's directory part is opened and HELD (search permission only) and must be, by the kernel's own name for it, the path named — no symbolic link in any directory component, a dangling one included — else UNOBSERVABLE (INDIRECT_PATH). Every later step goes through the held directory, so a component swapped mid-look cannot hand the witness another object. A path inside the witness's own directories is UNOBSERVABLE (SELF). The target is lstat'ed, never followed. A missing target, or a missing or non-directory component, is ABSENT; EACCES, ELOOP or any other error is UNOBSERVABLE, never ABSENT.",
    "CONTENT: a regular file is digested only if its size is at most contentCapBytes, it opens as the SAME file lstat saw (device and inode), and two full reads give the same bytes with size and times unchanged; a directory is held the same way and digests its sorted entry names only if it has at most listingCapEntries entries, two listings agree, and lstat after them equals lstat before; a symlink digests its own target string; anything else has no content (NOT_APPLICABLE). A target that is gone or changed identity while looked at is UNOBSERVABLE (SWAPPED); one that changed while read is UNOBSERVABLE (MOVING).",
    "DIGEST: every digest is HMAC-SHA256 under a key only the witness holds, BOUND TO THE TARGET'S PATH and to what is digested (file content, directory listing, link target, mode and owner, times, size). Two looks at the same path compare by equality, so the facet is re-derivable from a record; nothing compares across paths. The book carries mode, owner, times and size only as such tokens; their raw values stay in the witness's private state.",
    "ONE LOOK PER ACT: for each act the bridge points at, the witness takes ONE look at the claimed target, after the act (at the act's close, or when the close timeout passes). There is no look before the act and no second look: no window, and no anchor on anything the subject's records can post.",
    "SINCE THE WITNESS LAST LOOKED: the look's facet is this look against the witness's OWN last recorded look at the SAME path, whenever that was — the close of an earlier pointed act, or never. The record cites the time of that last look, or that there was none (FIRST_SEEN). It is 'the target differs from when I last saw it', never 'this act changed it'.",
    "FACET: this look UNOBSERVABLE -> UNOBSERVABLE, whatever the history (a look that failed found nothing, so it is never FIRST_SEEN). Else no last look -> FIRST_SEEN. The last look UNOBSERVABLE -> UNOBSERVABLE. Present-vs-absent changed -> EXISTENCE_DIFFERS; both absent -> SAME. Both present: type changed -> TYPE_DIFFERS. Both content-verified: digest changed -> CONTENT_DIFFERS; else mode/owner or times changed -> META_DIFFERS; else SAME. Content not verified on either side: a file's size changed -> CONTENT_DIFFERS; else mode/owner or times changed -> META_DIFFERS; else UNOBSERVABLE (content could not be confirmed same). A directory's size is filesystem bookkeeping and is not compared.",
    "THE OUTCOME, IN ORDER: LATE when the act ran with no /guard answer (the caller's fail-open) or its close never reached the witness; else HELD when the bridge's own decision was not to execute; else the facet from the look. The look's own facet always rides beside the outcome, so a held act whose target moved is visible, attributed to nothing.",
  ]),
  ceilings: Object.freeze([
    "ARTEFACT EFFECTS ARE NOT BENEFIT: a file that appeared is not a good done, and one that vanished is not a harm done until a grant says whose it was and who asked (S208).",
    "CLAIMED TARGET IS NOT THE TOUCHED SET: the witness looks only at the one target the act's own harness names; whatever else the act touches is unread. The pointer is the subject's claim (EG-1); only the look is the witness's.",
    "SINCE THE WITNESS LAST LOOKED, NOT CAUSED BY THIS ACT: a facet compares the target to the witness's own previous look, which may predate this act by many acts or much time; anything, by anyone, could have changed it in between. No change is attributed to the act. Attribution is phase H's, with S208 and its own anchor design.",
    "THE ACT'S RECORDS ARE THE SUBJECT'S WORD: which acts the witness is pointed at, their targets, and whether an act was held or ran unguarded all come from records the subject's uid can post (EG-1 until S206); the witness never sees when an act ran, and anchors on nothing it can post.",
    "AN ACT WITH NO RECORD IS NOT A READING: acts never pointed to the witness are not observations; UNKNOWN is not zero.",
    "EXIT STATE IS THE HARNESS'S WORD: the only exit state on the record is the subject's own TOOL_RESULT; the witness does not observe it.",
    "THIS BOX'S FILES ONLY: no network, no message channel, no person the act addressed; a category with no region on this box is not seen at all.",
    "REACH IS A DEPLOYMENT FACT: what the witness's uid may read — and, as much, the method's own refusals and the modes of the files themselves — decides what is UNOBSERVABLE; UNOBSERVABLE is never UNCHANGED.",
    "TAMPER-EVIDENT, NOT TAMPER-PROOF: the book is chained, written only by the witness, and its heads go to witnessd while they reach it; nothing here holds against root on this box (S210).",
  ]),
});

export const SEEING_METHOD_DIGEST: string = createHash("sha256")
  .update(subjectCanonicalJson(SEEING_METHOD), "utf8")
  .digest("hex");

export const CONSEQUENCE_EVENT_TYPE_PREFIX = "CONSEQUENCE@";
const DERIVATION_CLASS_PATTERN = /^INTEREST_LABEL@[0-9a-f]{16}$/;

/**
 * The record class of the witness's book for one frame DERIVATION: the method's
 * digest and the derivation class (Gate 1's label class, which names the rule
 * versions and the regions that placed the target in a category), digested.
 */
export function consequenceEventType(derivationClass: string): string {
  if (!DERIVATION_CLASS_PATTERN.test(derivationClass)) {
    throw new Error(
      `derivationClass must be an INTEREST_LABEL@<16 hex> class, got ${JSON.stringify(derivationClass)}`
    );
  }
  const hex = createHash("sha256")
    .update(subjectCanonicalJson([SEEING_METHOD_DIGEST, derivationClass]), "utf8")
    .digest("hex")
    .slice(0, 16);
  return CONSEQUENCE_EVENT_TYPE_PREFIX + hex;
}

/** The record's `outcome`: the target's frame category and the effect class. */
export function consequenceOutcome(category: string, effect: EffectClass): string {
  return `${category}:${effect}`;
}

// ── the clock ────────────────────────────────────────────────────────────────

/** The box's clocks: wall (for reading), monotonic ns (for ordering), and the boot. */
export interface SeeingClock {
  wall(): number;
  mono(): bigint;
  readonly boot: string;
}

/** This boot's id, or a fixed word when it cannot be read (then no stamp of another process can match it). */
export function readBootId(): string {
  try {
    const b = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    return /^[0-9a-f-]{8,64}$/.test(b) ? b : "BOOT_ID_MALFORMED";
  } catch {
    return "BOOT_ID_UNREADABLE";
  }
}

export const SYSTEM_CLOCK: SeeingClock = Object.freeze({
  wall: () => Date.now(),
  mono: () => process.hrtime.bigint(),
  boot: readBootId(),
});

// ── one look ─────────────────────────────────────────────────────────────────

export type LookState = "PRESENT" | "ABSENT" | "UNOBSERVABLE";
export type LookType = "file" | "dir" | "symlink" | "other";
export type ContentBasis = "DIGESTED" | "OVER_CAP" | "UNREADABLE" | "NOT_APPLICABLE";

/**
 * What one look saw. It carries NO path: a look is stored beside a target
 * fingerprint in the book, and the plain target stays with the witness.
 */
export interface Look {
  /** The wall clock when the look ENDED, ms — for reading, never for ordering. */
  readonly at: number;
  /** The monotonic clock when the look ENDED, ns, decimal — the ordering stamp. */
  readonly mono: string;
  /** The boot the look was taken in. */
  readonly boot: string;
  readonly state: LookState;
  readonly type: LookType | null;
  readonly mode: number | null;
  readonly uid: number | null;
  readonly gid: number | null;
  readonly size: number | null;
  readonly mtimeMs: number | null;
  readonly ctimeMs: number | null;
  /** HMAC-SHA256 hex of the content under the witness's key (see SEEING_METHOD), or null. */
  readonly content: string | null;
  readonly contentBasis: ContentBasis | null;
  /** The errno code or refusal word behind ABSENT / UNOBSERVABLE / UNREADABLE, else null. */
  readonly error: string | null;
}

export interface LookContext {
  /** The witness's private digest key. */
  readonly key: Buffer;
  readonly clock: SeeingClock;
  /** The witness's own directories (resolved): a target inside one is SELF. */
  readonly selfRoots: readonly string[];
  /** TESTS ONLY: called at each window a concurrent writer could use. Never set by seeingd. */
  readonly between?: (stage: LookStage) => void;
}

export type LookStage = "after-parent" | "after-lstat" | "after-open" | "after-first-read";

/** Linux O_PATH: a descriptor that pins a directory with search permission only. Node does not export it. */
const O_PATH = 0o10000000;
/** Errors after a successful lstat that mean the object lstat saw is gone or changed kind. */
const SWAP_CODES: readonly string[] = ["ELOOP", "ENOENT", "ENOTDIR", "EINVAL"];
const swapped = (): Content => ({ content: null, basis: "UNREADABLE", error: "SWAPPED", refused: "SWAPPED" });
const moving = (): Content => ({ content: null, basis: "UNREADABLE", error: "MOVING", refused: "MOVING" });

function errCode(e: unknown): string {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" ? c : "UNKNOWN";
}

type Content = { content: string | null; basis: ContentBasis; error: string | null; refused?: "SWAPPED" | "MOVING" };

/**
 * THE ONE MAC (refuter R2 F2): HMAC-SHA256 under the witness's key over the target's path (length-prefixed) and a
 * tag naming what is digested, then the data. Equal data at the SAME path gives equal tokens; across paths, or
 * across tags, nothing is comparable — so a reader of the book cannot test a guess about one target by digesting it
 * at another.
 */
export function boundMac(key: Buffer, path: string, tag: string, data: string | Buffer): string {
  return createHmac("sha256", key).update(`${String(Buffer.byteLength(path, "utf8"))}:${path}\u0000${tag}\u0000`, "utf8").update(data).digest("hex");
}

function sameObject(a: { dev: number; ino: number }, b: { dev: number; ino: number }): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function readFileCapped(at: string, path: string, st: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }, ctx: LookContext): Content {
  if (st.size > CONTENT_CAP_BYTES) return { content: null, basis: "OVER_CAP", error: null };
  let fd: number;
  try {
    fd = openSync(at, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (e) {
    const code = errCode(e);
    // ELOOP under O_NOFOLLOW: the last component became a link after lstat. ENOENT / ENOTDIR / EINVAL: the
    // object lstat saw is gone or changed kind — the look did not see ONE object (refuter R2-bytes F7).
    return SWAP_CODES.includes(code) ? swapped() : { content: null, basis: "UNREADABLE", error: code };
  }
  try {
    ctx.between?.("after-open");
    const first = fstatSync(fd);
    if (!first.isFile() || !sameObject(first, st)) return swapped();
    if (first.size > CONTENT_CAP_BYTES) return { content: null, basis: "OVER_CAP", error: null };
    // READ TWICE from offset 0 (refuter R2-bytes F8): a rewrite inside one timestamp tick leaves size, mtime and
    // ctime equal, so only the bytes can show it.
    const a = readAllCapped(fd);
    if (a === null) return { content: null, basis: "OVER_CAP", error: null };
    ctx.between?.("after-first-read");
    const b = readAllCapped(fd);
    const after = fstatSync(fd);
    if (b === null || !a.equals(b) || after.size !== st.size || after.mtimeMs !== st.mtimeMs || after.ctimeMs !== st.ctimeMs) return moving();
    return { content: boundMac(ctx.key, path, "file", a), basis: "DIGESTED", error: null };
  } catch (e) {
    return { content: null, basis: "UNREADABLE", error: errCode(e) };
  } finally {
    closeSync(fd);
  }
}

/** The whole file from offset 0, or null past the cap. */
function readAllCapped(fd: number): Buffer | null {
  const buf = Buffer.alloc(CONTENT_CAP_BYTES + 1);
  let total = 0;
  for (;;) {
    const n = readSync(fd, buf, total, buf.length - total, total);
    if (n === 0) break;
    total += n;
    if (total > CONTENT_CAP_BYTES) return null;
  }
  return buf.subarray(0, total);
}

/** The sorted entry names of a directory held by fd, or a code; null past the cap. */
function listNames(fd: number): { names: string[] | null } | { error: string } {
  let dir;
  try {
    dir = opendirSync(`/proc/self/fd/${String(fd)}`);
  } catch (e) {
    return { error: errCode(e) };
  }
  const names: string[] = [];
  try {
    for (;;) {
      const ent = dir.readSync();
      if (ent === null) break;
      names.push(ent.name);
      if (names.length > LISTING_CAP_ENTRIES) return { names: null };
    }
  } catch (e) {
    return { error: errCode(e) };
  } finally {
    try {
      dir.closeSync();
    } catch {
      // closing a handle that failed mid-read is not a finding about the target
    }
  }
  return { names: names.sort() };
}

function readListingCapped(at: string, path: string, st: { dev: number; ino: number; mtimeMs: number; ctimeMs: number }, ctx: LookContext): Content {
  // The directory itself is PINNED (O_PATH, never following a link at the last component) and listed through its
  // own descriptor, so a swap after lstat can never hand the witness another directory's listing.
  let dfd: number;
  try {
    dfd = openSync(at, O_PATH | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } catch (e) {
    const code = errCode(e);
    return SWAP_CODES.includes(code) ? swapped() : { content: null, basis: "UNREADABLE", error: code };
  }
  try {
    const held = fstatSync(dfd);
    if (!held.isDirectory() || !sameObject(held, st)) return swapped();
    ctx.between?.("after-open");
    const one = listNames(dfd);
    if ("error" in one) return { content: null, basis: "UNREADABLE", error: one.error };
    ctx.between?.("after-first-read");
    const two = listNames(dfd);
    if ("error" in two) return { content: null, basis: "UNREADABLE", error: two.error };
    let again;
    try {
      again = lstatSync(at);
    } catch {
      return swapped();
    }
    if (!again.isDirectory() || !sameObject(again, st)) return swapped();
    if (again.mtimeMs !== st.mtimeMs || again.ctimeMs !== st.ctimeMs) return moving();
    if (one.names === null || two.names === null) return one.names === null && two.names === null ? { content: null, basis: "OVER_CAP", error: null } : moving();
    if (JSON.stringify(one.names) !== JSON.stringify(two.names)) return moving();
    return { content: boundMac(ctx.key, path, "dir", subjectCanonicalJson(one.names)), basis: "DIGESTED", error: null };
  } finally {
    closeSync(dfd);
  }
}

function insideAny(path: string, roots: readonly string[]): boolean {
  return roots.some((r) => path === r || path.startsWith(r.endsWith("/") ? r : `${r}/`));
}

/**
 * Why a parent directory could not be pinned, named by walking from / (refuter R2-bytes F6): the first component
 * that is a symbolic link is INDIRECT_PATH (UNOBSERVABLE) — a DANGLING link included, which a plain realpath would
 * have let through as ABSENT; the first that is missing, or not a directory, is ABSENT; any other error is
 * UNOBSERVABLE. If every component is there now, the parent changed under the look: SWAPPED.
 */
function unpinnedParent(parent: string): { state: LookState; error: string } {
  let cur = "";
  for (const part of parent.split("/").filter((x) => x.length > 0)) {
    cur = `${cur}/${part}`;
    let st;
    try {
      st = lstatSync(cur);
    } catch (e) {
      const c = errCode(e);
      return c === "ENOENT" || c === "ENOTDIR" ? { state: "ABSENT", error: c } : { state: "UNOBSERVABLE", error: c };
    }
    if (st.isSymbolicLink()) return { state: "UNOBSERVABLE", error: "INDIRECT_PATH" };
    if (!st.isDirectory()) return { state: "ABSENT", error: "ENOTDIR" };
  }
  return { state: "UNOBSERVABLE", error: "SWAPPED" };
}

/**
 * ONE LOOK at ONE path. The parent directory is PINNED first (refuter R2-bytes F1): opened O_PATH (search permission
 * only — traverse-only reach is enough) and required to BE the path named, by the kernel's own name for the held
 * directory (/proc/self/fd), so no component above the target is a link. Every later step — lstat, open, listing,
 * readlink — goes THROUGH that descriptor, so renaming or swapping any directory component mid-look cannot hand the
 * witness another object. The target itself is lstat'ed, never followed. Stamped when the look ENDS.
 */
export function look(path: string, ctx: LookContext): Look {
  const stamp = (): { at: number; mono: string; boot: string } => ({ at: ctx.clock.wall(), mono: ctx.clock.mono().toString(), boot: ctx.clock.boot });
  const empty = { type: null, mode: null, uid: null, gid: null, size: null, mtimeMs: null, ctimeMs: null, content: null, contentBasis: null };
  const refuse = (state: LookState, error: string): Look => ({ ...stamp(), state, ...empty, error });
  if (insideAny(path, ctx.selfRoots)) return refuse("UNOBSERVABLE", "SELF");
  const parent = dirname(path);
  const base = basename(path);
  if (base === "" || base === "." || base === ".." || !path.startsWith("/")) return refuse("UNOBSERVABLE", "NOT_A_NAME");
  let pfd: number;
  try {
    pfd = openSync(parent, O_PATH | constants.O_DIRECTORY);
  } catch (e) {
    const code = errCode(e);
    if (code === "ENOENT" || code === "ENOTDIR") {
      const why = unpinnedParent(parent);
      return refuse(why.state, why.error);
    }
    return refuse("UNOBSERVABLE", code);
  }
  try {
    let held: string;
    try {
      held = readlinkSync(`/proc/self/fd/${String(pfd)}`);
    } catch (e) {
      return refuse("UNOBSERVABLE", errCode(e));
    }
    if (held !== parent) return refuse("UNOBSERVABLE", held.endsWith(" (deleted)") ? "SWAPPED" : "INDIRECT_PATH");
    ctx.between?.("after-parent");
    const at = `/proc/self/fd/${String(pfd)}/${base}`;
    let st;
    try {
      st = lstatSync(at);
    } catch (e) {
      const code = errCode(e);
      return refuse(code === "ENOENT" ? "ABSENT" : "UNOBSERVABLE", code);
    }
    ctx.between?.("after-lstat");
    const type: LookType = st.isFile() ? "file" : st.isDirectory() ? "dir" : st.isSymbolicLink() ? "symlink" : "other";
    let c: Content;
    if (type === "file") c = readFileCapped(at, path, st, ctx);
    else if (type === "dir") c = readListingCapped(at, path, st, ctx);
    else if (type === "symlink") {
      try {
        const target = readlinkSync(at);
        const again = lstatSync(at);
        c = again.isSymbolicLink() && sameObject(again, st) ? { content: boundMac(ctx.key, path, "symlink", target), basis: "DIGESTED", error: null } : swapped();
      } catch (e) {
        const code = errCode(e);
        c = SWAP_CODES.includes(code) ? swapped() : { content: null, basis: "UNREADABLE", error: code };
      }
    } else c = { content: null, basis: "NOT_APPLICABLE", error: null };
    if (c.refused !== undefined) return refuse("UNOBSERVABLE", c.refused);
    return {
      ...stamp(),
      state: "PRESENT",
      type,
      mode: st.mode,
      uid: st.uid,
      gid: st.gid,
      size: st.size,
      mtimeMs: st.mtimeMs,
      ctimeMs: st.ctimeMs,
      content: c.content,
      contentBasis: c.basis,
      error: c.error,
    };
  } finally {
    closeSync(pfd);
  }
}

// ── the class ────────────────────────────────────────────────────────────────

/**
 * What the BOOK carries of a look (refuter R2 F3): the stamps, the state, the type, the content digest and its basis,
 * the error word — and mode/owner, times and size only as path-bound tokens (`boundMac`). A reader learns whether two
 * looks at one path agree, never the values. The raw Look stays in the witness's private state (0600).
 */
export interface PublicLook {
  readonly at: number;
  readonly mono: string;
  readonly boot: string;
  readonly state: LookState;
  readonly type: LookType | null;
  readonly meta: string | null;
  readonly times: string | null;
  readonly size: string | null;
  readonly content: string | null;
  readonly contentBasis: ContentBasis | null;
  readonly error: string | null;
}

interface ClassKeys {
  readonly state: LookState;
  readonly type: LookType | null;
  readonly meta: string | null;
  readonly times: string | null;
  readonly size: string | null;
  readonly content: string | null;
  readonly contentBasis: ContentBasis | null;
}

function rawKeys(l: Look): { meta: string | null; times: string | null; size: string | null } {
  return {
    meta: l.mode === null ? null : `${String(l.mode)}:${String(l.uid)}:${String(l.gid)}`,
    times: l.mtimeMs === null ? null : `${String(l.mtimeMs)}:${String(l.ctimeMs)}`,
    size: l.size === null ? null : String(l.size),
  };
}

export function publicLook(l: Look, key: Buffer, path: string): PublicLook {
  const r = rawKeys(l);
  const tok = (tag: string, v: string | null): string | null => (v === null ? null : boundMac(key, path, tag, v));
  return {
    at: l.at,
    mono: l.mono,
    boot: l.boot,
    state: l.state,
    type: l.type,
    meta: tok("meta", r.meta),
    times: tok("times", r.times),
    size: tok("size", r.size),
    content: l.content,
    contentBasis: l.contentBasis,
    error: l.error,
  };
}

function classKeys(l: Look | PublicLook): ClassKeys {
  if ("meta" in l) return l;
  return { state: l.state, type: l.type, content: l.content, contentBasis: l.contentBasis, ...rawKeys(l) };
}

function verified(l: ClassKeys): boolean {
  return l.contentBasis === "DIGESTED" || l.contentBasis === "NOT_APPLICABLE";
}

/**
 * THE WHOLE FACET MAP, from the witness's LAST look at a path and its look NOW. A look NOW that failed is UNOBSERVABLE
 * first, whatever the history (W-1); otherwise `last === null` means the witness has no earlier look at this path:
 * FIRST_SEEN. Equality only, so the same map reads raw looks and the book's tokens
 * alike (SM-19 walks every combination). It never returns an OUTCOME facet (HELD, LATE): those are set from the
 * act's records by the caller, not from sight.
 */
export function classifyFacet(lastIn: Look | PublicLook | null, nowIn: Look | PublicLook): EffectClass {
  const now = classKeys(nowIn);
  // A FAILED LOOK READS UNOBSERVABLE WHATEVER THE HISTORY (audit 2026-10-11 18:43Z, W-1): FIRST_SEEN asserts that a
  // look happened and found no prior; one that failed found nothing (act 1549 on the box: EACCES, read FIRST_SEEN).
  if (now.state === "UNOBSERVABLE") return "UNOBSERVABLE";
  if (lastIn === null) return "FIRST_SEEN";
  const last = classKeys(lastIn);
  if (last.state === "UNOBSERVABLE") return "UNOBSERVABLE";
  if ((last.state === "ABSENT") !== (now.state === "ABSENT")) return "EXISTENCE_DIFFERS";
  if (last.state === "ABSENT") return "SAME"; // both absent
  if (last.type !== now.type) return "TYPE_DIFFERS";
  const metaDiffers = last.meta !== now.meta || last.times !== now.times;
  if (verified(last) && verified(now)) {
    if (last.content !== now.content) return "CONTENT_DIFFERS";
    return metaDiffers ? "META_DIFFERS" : "SAME";
  }
  // Content could not be compared on one side (over the cap or unreadable): size stands in for a file's content.
  if (last.type === "file" && last.size !== now.size) return "CONTENT_DIFFERS";
  if (metaDiffers) return "META_DIFFERS";
  return "UNOBSERVABLE"; // present, same type and metadata, but content could not be confirmed either way
}
