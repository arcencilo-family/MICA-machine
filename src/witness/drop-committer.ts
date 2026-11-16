// ── MICA · the drop committer — the PRODUCER end of the witness intake ───────
//
// The witness has an intake (`pollIntake`) and nothing in this repository ever
// wrote a file into one. This is that writer, and it is deliberately the whole
// of it: five fields, one atomic replace, no retry, no queue, no clock.
//
// ── IT WAS FOUR FIELDS UNTIL 2026-08-26 ──────────────────────────────────────
//
//   `modality` joined the S-4 §4 freeze that day, ruled by the arbiter in session 88,
//   taking the contract from v0.2 to v0.3. This header used to say "A fifth key
//   is a MALFORMED_SUBMISSION at the far end". THAT SENTENCE IS NOW FALSE, and
//   it is replaced rather than quietly deleted so the change stays legible:
//   FIVE keys is the shape, a SIXTH key is a MALFORMED_SUBMISSION at the far
//   end, and so is a five-key drop whose `modality` is outside the enum.
//
//   A FOUR-KEY drop is neither. It is retained at the far end as
//   UNDECLARED_MODALITY carrying exactly the four fields it presented — no
//   receipt, and no modality invented on the submitter's behalf.
//
// ── WHY IT IMPORTS NEITHER SUBMITTER ─────────────────────────────────────────
//
//   `src/mica/notify/types.ts` and `src/mica/chokepoint/floor-trail.ts` each
//   declare their OWN structurally identical `HeadCommitter`, on purpose: a
//   book's evidence format must not couple to a sibling's. This file declares
//   neither and imports neither. It takes the witness's own `HeadCommit` —
//   the intake's contract, which is the thing actually being written — and the
//   function it returns is structurally assignable to BOTH local committer
//   types, because all three are `(commit) => void` over the same four fields.
//
// ── WHY THE WRITE IS ATOMIC (RULING A, S86, 2026-08-26) ──────────────────────
//
//   A witness sweeping the intake can read a torn half-write and retain it as a
//   MALFORMED_SUBMISSION that was never sent. The submitter is then permanently
//   accused of malformed bytes it never produced, and the record is not
//   correctable — that is the whole point of an append-only retainer.
//
//   So the write is write-to-temp-then-rename INSIDE THE SAME DIRECTORY, which
//   needs one framing rule and gets it: NAMES BEGINNING WITH `.` ARE IN-FLIGHT
//   FRAMES, NOT SUBMISSIONS, and `pollIntake` does not consume them. That is
//   channel framing — like "a line ends with a newline" — not adjudication. The
//   witness still judges nothing whatever about content.
//
// ── WHY `chmod` AND NOT THE `mode` OPTION ────────────────────────────────────
//
//   `writeFileSync`'s `mode` is masked by the process umask; `chmodSync` is not.
//   A submitter running under `umask 0077` writing with `mode: 0o640` produces a
//   0600 file the witness cannot read — which, before §4 of this build, wedged
//   the sweep permanently and silently. The explicit chmod kills that at the
//   producer, where it is cheap, instead of relying on every deployment getting
//   its umask right.
//
// ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────────
//
//   It does not create `intakeDir`. The intake's permissions are a DEPLOYMENT
//   act (the Linux recipe rules the digits: 3730, group `mica-drops`); a
//   producer that quietly created the directory would create it with the wrong
//   ones and hide a missing deployment step behind a working test.
//
//   It does not catch its own failures. Disk full, no permission, no directory:
//   it throws, and the CALLER records that it threw — notify's post-durable
//   committer call is already try/caught and retained with the reason.
//
//   Submission is not retention. This file can prove it CALLED rename. It
//   cannot prove anything was retained, by whom, or where.

import { chmodSync, renameSync, rmSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import { join } from "path";

import type { HeadCommit, NamedHeadCommit } from "./types";

/**
 * The five fields MICA S-4 v0.3 §4 freezes (ruled 2026-08-26, the arbiter, S88), in
 * the order the drop carries them. A SIXTH key is a MALFORMED_SUBMISSION at the
 * far end, so the commit is REBUILT field by field here rather than
 * re-serialised: whatever else the caller's object carries never reaches the
 * intake.
 */
const HEAD_KEYS = ["seq_no", "head_hash", "ts", "witness_set_id", "modality"] as const;

/** The bytes a drop file holds. Exactly the five keys, in exactly this order. */
export function canonicalDropBytes(commit: HeadCommit): string {
  return JSON.stringify({
    seq_no: commit.seq_no,
    head_hash: commit.head_hash,
    ts: commit.ts,
    witness_set_id: commit.witness_set_id,
    modality: commit.modality,
  });
}

/** The key list, exported so a test can assert the drop against it by name. */
export const DROP_HEAD_KEYS: readonly string[] = HEAD_KEYS;

// ── THE SIX-KEY SHAPE (S105, 2026-09-03) ─────────────────────────────────────
//
//   `chain_id` joined the head a submitter presents, ruled by the arbiter in session
//   105. THE FIVE-KEY SERIALISER ABOVE IS NOT RETIRED and must not be: it is
//   the producer end of `HEAD_COMMIT`, a kind that still exists, still
//   validates, and still names records already on disk. Two shapes, two
//   serialisers, and the caller's TYPE decides which one it can reach.
//
//   A SIXTH KEY IS NO LONGER A MALFORMED_SUBMISSION AT THE FAR END — a SEVENTH
//   is, and so is a six-key drop whose `chain_id` fails the grammar or whose
//   `modality` is outside the enum. The sentence this replaces is left standing
//   in the header above with its date, not deleted, for the same reason S88's
//   was.
const NAMED_HEAD_KEYS = [
  "seq_no",
  "head_hash",
  "ts",
  "witness_set_id",
  "modality",
  "chain_id",
] as const;

/** The bytes a NAMED drop file holds. Exactly six keys, in exactly this order. */
export function canonicalNamedDropBytes(commit: NamedHeadCommit): string {
  return JSON.stringify({
    seq_no: commit.seq_no,
    head_hash: commit.head_hash,
    ts: commit.ts,
    witness_set_id: commit.witness_set_id,
    modality: commit.modality,
    chain_id: commit.chain_id,
  });
}

/** The named key list, exported so a test can assert the drop against it. */
export const NAMED_DROP_HEAD_KEYS: readonly string[] = NAMED_HEAD_KEYS;

/**
 * ── A PRODUCER THAT CANNOT NAME ITS CHAIN IS A DEFECT, NOT A DEFAULT (S105) ──
 *
 *   Ruled: from this commit, a new submission path SUPPLIES `chain_id`. This
 *   function is where that ruling is enforced for every caller of the named
 *   committer, and it THROWS rather than substituting anything, because the one
 *   act barred everywhere in this family is a party authoring another party's
 *   declaration. A committer that quietly filled in "unknown" would put a false
 *   name in a retained record and nothing downstream could ever tell.
 *
 *   IT FAILS AT CONSTRUCTION, not at the first commit, exactly as the
 *   submitter-id bar does: a misconfigured deployment must not come up clean
 *   and then start dropping heads nobody can attribute.
 *
 *   The grammar checked here is the SUBMITTER's copy of the intake's rule. It
 *   is deliberately re-stated rather than imported: this file is a producer and
 *   that one is a retainer, and a producer that borrowed the retainer's check
 *   would stop being an independent statement of the same contract. If they
 *   drift, `witnessd.test.ts` — which holds both — is where it shows.
 */
export function assertFramedChainId(chainId: string): void {
  const bad =
    // `typeof` first, and not because the type says string: an ABSENT field is
    // the case this ruling is about, and a caller reaching here from untyped
    // JavaScript with `undefined` must get the named refusal below, not a
    // TypeError about reading `length`.
    typeof chainId !== "string" ||
    chainId.length === 0 ||
    chainId.length > 128 ||
    chainId.includes("/") ||
    chainId.includes("\\") ||
    chainId.includes("..") ||
    /[\s\u0000-\u001f\u007f-\u009f]/.test(chainId);
  if (bad) {
    throw new Error(
      `chain_id is missing or unframed: ${JSON.stringify(chainId)}. ` +
        "A submission path that cannot name its chain is a defect, not a " +
        "default, and nothing here will name it on the submitter's behalf. " +
        "Required: non-empty, at most 128 characters, no whitespace, no " +
        "control characters, and none of \"/\", \"\\\\\" or \"..\"."
    );
  }
}

/**
 * A head committer that writes each NAMED commit as one file in `intakeDir`.
 *
 * Same file, same atomic replace, same last-writer-wins filename as
 * `fileDropCommitter` — and THAT IS A LIMIT THIS FUNCTION DOES NOT LIFT.
 * `chain_id` makes a head that ARRIVES readable as its chain's head. It does
 * not make N chains' heads arrive: the drop target is still `submitterId`, so a
 * producer that commits to two chains between two sweeps still leaves one drop
 * file, and the first head is gone before the witness ever sees it. Naming the
 * chain and delivering every chain's head are two debts; this pays the first.
 * See the S105 receipt, section E.
 */
export function fileDropNamedCommitter(
  intakeDir: string,
  submitterId: string,
  seam: DropCommitterSeam = {}
): (commit: NamedHeadCommit) => void {
  const write = fileDropCommitterFor(intakeDir, submitterId, seam);
  return (commit: NamedHeadCommit): void => {
    assertFramedChainId(commit.chain_id);
    write(canonicalNamedDropBytes(commit));
  };
}

/**
 * THE MODALITY IS NOT COMMITTER CONSTRUCTION CONFIG, AND MUST NOT BECOME IT.
 *
 * It arrives on the COMMIT OBJECT, per call, because the arbiter varies it per
 * entry: one ruling is OFFERED and the next IMPOSED from the same book, through
 * the same committer, in the same process. A construction-time value could not
 * express that, and a committer built with one would silently stamp the wrong
 * declaration onto every entry after the first that differed.
 *
 * So `fileDropCommitter`'s signature is unchanged and its callback type stays
 * `(commit) => void`. That is a deliberate non-change; do not "tidy" the
 * modality up into the factory.
 */
export const MODALITY_RIDES_THE_COMMIT =
  "The declared modality is a field of each commit, never a property of the " +
  "committer that writes it. A book whose entries differ in modality uses ONE " +
  "committer and varies the commit; a committer configured with a modality " +
  "would stamp the same declaration onto entries that did not share it.";

/** The mode an in-flight frame is chmod'ed to before it becomes a submission. */
export const DROP_FILE_MODE = 0o640;

/**
 * Narrow test seam. Production leaves both absent and gets the native calls.
 *
 * `rename` exists so a test can observe the instant of replacement — the
 * property being claimed is that the destination name holds the OLD drop or the
 * NEW one and never a half of either, and the only place to stand and watch
 * that is inside the rename.
 */
export interface DropCommitterSeam {
  readonly rename?: (from: string, to: string) => void;
  readonly suffix?: () => string;
}

/**
 * A head committer that writes each commit as one file in `intakeDir`, named
 * `submitterId`.
 *
 * THE FILENAME IS THE SUBMITTER ID and head commits are therefore
 * LAST-WRITER-WINS. Under a content drop that would be data loss; under a head
 * commit it is what a head IS — a later head at a later seq constrains a longer
 * prefix of the same chain. Renaming over another submitter's drop is barred by
 * the intake's sticky bit, which is a deployment fact, not a check made here.
 */
export function fileDropCommitter(
  intakeDir: string,
  submitterId: string,
  seam: DropCommitterSeam = {}
): (commit: HeadCommit) => void {
  const write = fileDropCommitterFor(intakeDir, submitterId, seam);
  return (commit: HeadCommit): void => {
    write(canonicalDropBytes(commit));
  };
}

/**
 * THE ATOMIC REPLACE, WITH THE SERIALISER LIFTED OUT (S105).
 *
 * Everything argued in this file's header — the temp-then-rename, the dotted
 * in-flight name, the explicit chmod, the frame removed on failure, the
 * construction-time submitter-id bar — lives HERE, once, and both committers
 * ride it. The extraction is deliberate and is the reason the six-key shape
 * costs a serialiser rather than a second copy of the delivery mechanics: two
 * copies of an atomic write is two places for a torn write to come back.
 *
 * It takes BYTES, not a commit. That is the seam: a caller cannot reach this
 * without having already decided which shape it is serialising, and no shape
 * can be widened here by accident.
 */
function fileDropCommitterFor(
  intakeDir: string,
  submitterId: string,
  seam: DropCommitterSeam = {}
): (bytes: string) => void {
  // Taken verbatim in intent from `fileDropHeadCommitter` in
  // src/mica/chokepoint/floor-trail.ts, which had it first and was right to.
  // `join(intakeDir, submitterId)` escapes the intake for any id carrying a
  // separator or `..`, and a submitter id is deployment configuration, not a
  // literal. It fails at CONSTRUCTION so a misconfigured deployment cannot come
  // up and then write outside the intake at the first commit.
  if (
    submitterId.length === 0 ||
    submitterId.includes("/") ||
    submitterId.includes("\\") ||
    submitterId.includes("..")
  ) {
    throw new Error("submitterId must be a bare filename");
  }
  const rename = seam.rename ?? renameSync;
  const suffix = seam.suffix ?? (() => randomBytes(8).toString("hex"));

  return (bytes: string): void => {
    const target = join(intakeDir, submitterId);
    const frame = join(intakeDir, `.${submitterId}.${suffix()}`);

    // `wx` — a frame name that already exists is not overwritten. Nothing is
    // ever written to `target` directly; it only ever appears by rename.
    writeFileSync(frame, bytes, {
      encoding: "utf8",
      flag: "wx",
    });
    try {
      chmodSync(frame, DROP_FILE_MODE);
      rename(frame, target);
    } catch (error) {
      // The frame was never a submission and must not be left behind as one —
      // a dotted name is invisible to the sweep, so it would sit there forever.
      // Removal is best-effort: the ORIGINAL failure is the one worth throwing.
      try {
        rmSync(frame, { force: true });
      } catch {
        /* the reason the rename failed is very likely the reason this did */
      }
      throw error;
    }
  };
}
