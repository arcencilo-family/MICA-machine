// ── MICA · the code vintage — which commit is this process EXECUTING? ────────
//
// ── THE DEFECT THIS EXISTS TO MAKE VISIBLE (S105 receipt §2.1, §E.3) ─────────
//
//   On 2026-09-03 the live witness daemon had been running since 30 August.
//   `witness.ts` under `/opt` had been replaced on 31 August, and again twice
//   since. `Restart=no`, so every relay in between changed the DISK and not the
//   RUN. Four days of a daemon executing code nobody could name, while the
//   handoff said — correctly, about the files — that /opt ran the current lay.
//
//   THE LAY IS NOT THE RUN. Nothing in this repository printed the difference,
//   and nothing could: a running process's vintage was not a fact any surface
//   carried. This module is that surface, and it is one line in a banner.
//
// ── WHAT IT READS, AND WHY IT IS A CLAIM AND NOT A MEASUREMENT ───────────────
//
//   A one-line `VINTAGE` file at the tree root, written by the relay. That is a
//   CLAIM BY THE RELAY: it says what the relaying hand believed it was laying
//   down, and a hand that lays the wrong tree writes the wrong claim into it.
//   The banner line says so in those words. Nothing here verifies it, and this
//   file computes no digest of the tree it sits in.
//
//   WHY NOT `git rev-parse HEAD`. Because `/opt` IS NOT A GIT TREE — the relay
//   excludes `.git`, verified at bytes on 2026-09-03 (`/opt/mica-machine/.git`
//   → ENOENT). Running git there answers about the CWD or about nothing, and a
//   vintage line that silently reported the DEV tree's HEAD would be the exact
//   false attestation the whole instrument exists to make loud. It would also
//   put a child process on the startup path of three daemons in order to print
//   a label. A label must never be able to stop a daemon.
//
// ── WHY IT IS READ AT STARTUP, AND WHY THAT IS THE WHOLE POINT ───────────────
//
//   The banner is printed once, when the process comes up, and the journal
//   timestamps it. So the line answers "what did this tree claim to be at the
//   moment this process loaded its modules" — which, for a process that loads
//   everything at boot, is as close to "what is this process executing" as a
//   file on disk can get. A reader comparing an old banner line against the
//   CURRENT `VINTAGE` file sees the drift that went unseen for four days.
//
//   ITS OWN LIMIT, STATED: this is only as visible as journal retention. A
//   daemon whose start line has rotated out of the journal is a daemon whose
//   vintage is unknown again, and nothing here fixes that.
//
// ── THE ROOT IS THIS MODULE'S OWN, NOT THE CALLER'S ──────────────────────────
//
//   `defaultTreeRoot()` derives the tree from `__dirname` — the directory THIS
//   FILE WAS LOADED FROM. A caller cannot point it at another tree by mistake,
//   and it is the correct answer by construction: the process is executing the
//   tree this module came out of. A caller-supplied root would be a second
//   place for the answer to be wrong.

import { readFileSync } from "fs";
import { join, resolve } from "path";

/** The file the relay writes, at the tree root. */
export const VINTAGE_FILENAME = "VINTAGE";

/**
 * FOUR STATES, AND THE BRIEF ASKED FOR THREE.
 *
 * S106b §1 ruled `read | absent | cannot-see`. A fourth is separated out here
 * because the tree's own S104 lesson says to: *"gone is not I could not look"*,
 * and by the same reading **"present and holding nothing usable" is neither of
 * the other two**. A truncated relay write — disk full at exactly the wrong
 * moment — produces a file that exists, opens, reads, and says nothing. Folding
 * that into UNREADABLE would tell an operator to go looking at permissions;
 * folding it into ABSENT would tell them the relay never ran. Both are wrong
 * turns, and the file is right there to be looked at.
 *
 * Contradicted in the receipt, not in silence.
 */
export type VintageState = "READ" | "ABSENT" | "UNREADABLE" | "PRESENT_UNUSABLE";

export interface VintageReading {
  readonly state: VintageState;
  /** The path looked at. Always present, including when nothing was there. */
  readonly path: string;
  /** The claim, copied verbatim. Non-null exactly when state is READ. */
  readonly commit: string | null;
  /** What happened instead. Non-null exactly when state is not READ. */
  readonly detail: string | null;
}

/**
 * The longest claim this will carry. A vintage is a commit-ish, not a document;
 * a file that holds more than this is holding something else.
 */
export const VINTAGE_MAX = 200;

/** The tree this module was loaded from: `<root>/src/deploy/vintage.ts`. */
export function defaultTreeRoot(): string {
  return resolve(__dirname, "..", "..");
}

/**
 * Read the vintage claim. NEVER THROWS, for any input, for any filesystem
 * state — it is called on the startup path of every daemon in this tree and a
 * label that can stop a daemon is worse than no label.
 *
 * `read` is a narrow test seam. Production leaves it absent and gets `readFileSync`.
 */
export function readVintage(
  treeRoot: string = defaultTreeRoot(),
  read: (path: string) => string = (p) => readFileSync(p, "utf8")
): VintageReading {
  const path = join(treeRoot, VINTAGE_FILENAME);
  let raw: string;
  try {
    raw = read(path);
  } catch (err) {
    const message = String(err);
    // ENOENT IS A DIFFERENT FINDING FROM EVERY OTHER ERRNO, and this is the one
    // place the distinction is made. A missing file means no relay wrote one; a
    // permission fault means one may be sitting there unread.
    if (/ENOENT/.test(message)) {
      return { state: "ABSENT", path, commit: null, detail: "no such file" };
    }
    return { state: "UNREADABLE", path, commit: null, detail: oneLine(message) };
  }

  const first = raw.split("\n", 1)[0].trim();
  if (first.length === 0) {
    return {
      state: "PRESENT_UNUSABLE",
      path,
      commit: null,
      detail: `the file is ${String(raw.length)} byte(s) and its first line is empty`,
    };
  }
  if (first.length > VINTAGE_MAX) {
    return {
      state: "PRESENT_UNUSABLE",
      path,
      commit: null,
      detail: `the first line is ${String(first.length)} characters, past the ${String(VINTAGE_MAX)} allowed`,
    };
  }
  if (/\s/.test(first)) {
    return {
      state: "PRESENT_UNUSABLE",
      path,
      commit: null,
      detail: "the first line carries whitespace; a vintage is one bare token",
    };
  }
  // COPIED VERBATIM AND JUDGED NOT AT ALL. Whether it is a short hash, a long
  // one, a tag, or a `-dirty` suffix is the relay's business — this module
  // frames the field and reads nothing into its content. Same discipline the
  // intake applies to `chain_id`.
  return { state: "READ", path, commit: first, detail: null };
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * The banner VALUE — no label, no box-drawing, no padding. Each banner owns its
 * own column widths and this module owns the sentence.
 *
 * EVERY BRANCH SAYS "UNKNOWN" IN THE SAME WORD and then says which unknown it
 * is. A reader scanning three journals must not have to tell four kinds of
 * silence apart by their punctuation.
 */
export function vintageText(reading: VintageReading): string {
  switch (reading.state) {
    case "READ":
      return (
        `${String(reading.commit)} (from ${reading.path}, read at THIS process's ` +
        "startup — a CLAIM written by the relay, not a measurement of this process)"
      );
    case "ABSENT":
      return (
        `UNKNOWN — no VINTAGE file at ${reading.path}. Nothing here guesses: a ` +
        "dev tree's HEAD is not this tree's vintage, and a baked-in constant is " +
        "not this tree either."
      );
    case "UNREADABLE":
      return (
        `UNKNOWN — the VINTAGE file at ${reading.path} could not be READ: ` +
        `${String(reading.detail)}. That is not the same finding as absent — ` +
        "something may be sitting there."
      );
    case "PRESENT_UNUSABLE":
      return (
        `UNKNOWN — the VINTAGE file at ${reading.path} was read and holds ` +
        `nothing usable: ${String(reading.detail)}. Present, not missing, and ` +
        "not unreadable."
      );
  }
}

/**
 * Read and render in one call, with the outermost guarantee this module makes:
 * IT CANNOT THROW. `readVintage` is already total, and this is the belt to that
 * braces — a banner line is not worth a failed start, and a future edit to
 * either function above must not be able to make it one.
 */
export function vintageBannerText(treeRoot?: string): string {
  try {
    return vintageText(readVintage(treeRoot));
  } catch (err) {
    return `UNKNOWN — reading the vintage itself failed: ${oneLine(String(err))}`;
  }
}
