// ── MICA · the Assembler — evidence assembly for Sig's F4 ─────────────────────
//
// WHAT THIS IS
//
//   The glue that reads a live A9 pre-commitment book, joins each sealed
//   expectation to an observation presented from outside, and emits a
//   `ProbeSource` — the injection Sig's F4 leg reads.
//
//   F4 was built (S100, flag F4) with no producer. This module is its first
//   producer, and building it is how the leg stops being dormant.
//
// ⚠ EVIDENCE ASSEMBLY, NEVER JUDGMENT. `[LB]`
//
//   This module NEVER compares a predicted value to an observed one. That
//   comparison is F4's entire job, and an assembler that performed it would be
//   handing Sig a conclusion and calling it evidence. Grep this file for a
//   comparison between `predictedValue` and `observedValue`: there is none, and
//   a test asserts there is none.
//
//   It also never recomputes a seal. `sealCheck` is the BOOK's own verdict,
//   decided at reveal by the module that holds the salt; the reveal's
//   `recomputed` field exists for a human reader, not for this code. An
//   assembler that re-derived the seal would be a second opinion nobody asked
//   for, from a principal that is not the committer.
//
// ⚠ WHERE D-01's INDEPENDENCE IS PERFORMED OR QUIETLY LOST. `[LB]`
//
//   D-01's mechanism is an expectation HELD OUTSIDE the observed system. F4
//   reads whatever it is handed and discloses that it cannot verify the join —
//   so the independence is not in F4. It is HERE, and it is not a code property:
//   it is the deployment fact that this process runs as its own principal, with
//   a read grant on somebody else's book and no write anywhere near it.
//
//   THIS FILE CANNOT MAKE THAT TRUE. It can only refuse to obscure it: it
//   creates no directory and no user, it reports the principal it actually ran
//   as, and when the grant is missing it fails loudly with the exact acts the
//   arbiter must perform. A green run of this module is not evidence of
//   independence. The `useradd` and the grant are.
//
// ── NO IMPORT EDGE, IN EITHER DIRECTION `[LB]` ───────────────────────────────
//
//   This module imports NOTHING from `src/precommit` and NOTHING from
//   `src/mica/sig`. Both shapes below are STRUCTURAL MIRRORS, declared here.
//
//   That is a deliberate cost, and the cost is drift: a field renamed in either
//   module leaves this one compiling and wrong. `sig/index.ts` says so in its
//   own words — "if these shapes drift from the precommit module's, the
//   assembler is the one that must notice" — and this is the module that
//   inherited the duty. It is discharged by `assembler-drift.test.ts`, which
//   reads BOTH real modules and fails when either moves.
//
//   Why not simply import? Because this process reads a book written by a
//   different principal, as a FOREIGN ARTIFACT. Importing the writer's parser
//   would inherit the writer's assumptions about its own output — including
//   that it is well-formed — which is the one thing a reader across a trust
//   boundary must not assume.

import { readFileSync, statSync } from "fs";
import type { Stats } from "fs";

export const ASSEMBLER_ID = "MICA/Assembler";

/**
 * Printed on every emission. The assembler's own ceiling, in its own output,
 * because the artifact travels to readers who never see this file.
 */
export const ASSEMBLY_IS_NOT_A_VERDICT =
  "This is assembled evidence, not a reading. The assembler joins a sealed " +
  "expectation to an observation and never compares them; F4 does the " +
  "comparing. A record appearing here is not a finding, and the absence of a " +
  "record is not a clean bill.";

/**
 * Printed beside it. The independence claim this module is NOT entitled to make.
 */
export const THE_GRANT_IS_THE_EVIDENCE =
  "Independence is a deployment fact, not a property of this code. That the " +
  "expectation was held OUTSIDE the observed system is evidenced by the " +
  "principal this process runs as and the read grant it was given — never by " +
  "the fact that it ran.";

// ── Structural mirror · the book (src/precommit/precommit.ts) ────────────────

export type MirroredExpectationType = "verdict" | "hash" | "claim+rule";
export type MirroredSealCheck = "MATCH" | "MISMATCH";
export type MirroredAnchorStatus = "DROPPED" | "NOT_DROPPED" | "CANNOT_SEE";

/** The five keys a REVEAL puts in the chain. Mirrors SealedPlaintext. */
export interface MirroredPlaintext {
  readonly type: MirroredExpectationType;
  readonly target: string;
  /**
   * MAY BE EMPTY. The precommit module says so in as many words — "a prediction
   * that a field will be empty is a prediction" — and its deposit path refuses
   * an empty `committerId` and an empty `target` while deliberately permitting
   * an empty `predictedValue`. Mirrored exactly, including the permission.
   */
  readonly predictedValue: string;
  readonly committerId: string;
  readonly salt: string;
}

interface MirroredFrame {
  readonly sequenceNumber: number;
  readonly previousHash: string;
  readonly hash: string;
  readonly timestamp: number;
  readonly modality: string;
}

export interface MirroredCommitment extends MirroredFrame {
  readonly kind: "COMMITMENT";
  readonly committerId: string;
  readonly sealed: string;
}

export interface MirroredReveal extends MirroredFrame {
  readonly kind: "REVEAL";
  readonly ref: number;
  readonly plaintext: MirroredPlaintext;
  readonly sealCheck: MirroredSealCheck;
  readonly recomputed: string;
}

export interface MirroredGrading extends MirroredFrame {
  readonly kind: "GRADING";
  readonly ref: number;
  readonly graderId: string;
  readonly verdict: string;
  readonly ground: string;
}

export interface MirroredAnchor extends MirroredFrame {
  readonly kind: "ANCHOR";
  readonly ref: number;
  readonly status: MirroredAnchorStatus;
  readonly droppedAt: number;
  readonly headHash: string;
  readonly detail: string;
}

export type MirroredBookRecord =
  | MirroredCommitment
  | MirroredReveal
  | MirroredGrading
  | MirroredAnchor;

// ── Structural mirror · the injection (src/mica/sig/index.ts) ────────────────

export type MirroredProbeSealCheck = "MATCH" | "MISMATCH" | "UNSEALED";
export type MirroredOrderEvidence =
  | "SEALED_BEFORE_OBSERVED"
  | "ORDER_NOT_ESTABLISHED";

export interface EmittedProbeResult {
  readonly observedValue: string;
  readonly observedBy: string;
  readonly observedAt: number;
}

interface EmittedBase {
  readonly commitmentSeq: number;
  readonly target: string;
  readonly observed: EmittedProbeResult;
  readonly provenance: string;
}

/** A probe for which the book holds a sealed, revealed expectation. */
export interface EmittedSealedRecord extends EmittedBase {
  readonly sealCheck: "MATCH" | "MISMATCH";
  readonly sealedDigest: string;
  readonly expectationType: MirroredExpectationType;
  readonly predictedValue: string;
  readonly committerId: string;
  readonly orderEvidence: MirroredOrderEvidence;
}

/**
 * An observation for which the book holds NO commitment at all.
 *
 * The seal-derived fields are ABSENT, not empty. This assembler will not
 * manufacture a digest, a prediction, a committer or an order to get a record
 * past a validator — that is the ledger S100-1 defect, and it is the reason the
 * old single-shape record could not represent this case at all.
 */
export interface EmittedUnsealedRecord extends EmittedBase {
  readonly sealCheck: "UNSEALED";
  readonly sealedDigest?: undefined;
  readonly expectationType?: undefined;
  readonly predictedValue?: undefined;
  readonly committerId?: undefined;
  readonly orderEvidence?: undefined;
}

export type EmittedProbeRecord = EmittedSealedRecord | EmittedUnsealedRecord;

export type EmittedProbeSource = readonly EmittedProbeRecord[];

// ── The observed side — injected, never fetched `[LB]` ───────────────────────
//
// The book holds NO observation. `GradingRecord.verdict` is a GRADER's judgement
// OF the prediction — feeding it in as the observed value would make the grader
// the observer and collapse the independence the whole leg rests on. So
// observations arrive the way everything arrives in this machine: PRESENTED as
// evidence, never fetched as authority.

export interface ObservationInput {
  /** The join key: the sequence number of the COMMITMENT being observed. */
  readonly commitmentSeq: number;
  /**
   * WHAT was observed. REQUIRED.
   *
   * For a sealed probe the REVEAL's own target is authoritative and is the one
   * carried; this one is then a CROSS-CHECK, and a disagreement between them is
   * refused rather than silently resolved — the assembler cannot know whether
   * the observer looked at the right thing, and picking a winner would be
   * exactly the repair-in-silence this machine forbids.
   *
   * For an UNSEALED observation there is no reveal, so this is the ONLY source
   * of the target, which is why it is required rather than optional.
   */
  readonly target: string;
  /** Verbatim. Never parsed, normalised, trimmed, or coerced. */
  readonly observedValue: string;
  readonly observedBy: string;
  readonly observedAt: number;
  readonly provenance: string;
}

// ── Refusals — loud, structured, never repaired ──────────────────────────────

export class AssemblerRefused extends Error {
  constructor(
    message: string,
    readonly ground: string
  ) {
    super(message);
    this.name = "AssemblerRefused";
  }
}

/**
 * A deployment act named in the recipe was never performed — or this principal
 * was never granted the read. Typed so a caller can tell "the deployer skipped a
 * step" apart from "the disk broke": the two want different people.
 */
export class AssemblerDeploymentActMissingError extends Error {
  constructor(
    message: string,
    readonly path: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "AssemblerDeploymentActMissingError";
  }
}

/**
 * The exact acts the arbiter must perform, as a proposal. This module performs
 * NONE of them: it creates no user, no group, no directory, and grants nothing.
 *
 * NO ANGLE-BRACKET PLACEHOLDERS, EVER (standing control, ledger S100-1: a
 * template shipped as a finished command reached a permanent chain record).
 * Every value below is either a literal or a named parameter substituted here.
 */
export function deploymentActProposal(bookDir: string): readonly string[] {
  return [
    "# Proposal only. The build seat performs none of these. The arbiter's hand.",
    "# 1 · the assembler's own principal — never the observed party.",
    "sudo useradd --system --no-create-home --shell /usr/sbin/nologin mica-assembler",
    "# 2 · a read grant on THIS BOOK ONLY, not a blanket reader group.",
    "#     A second committer later means a second explicit grant: the friction",
    "#     is the topology showing who watches whom.",
    `sudo setfacl -m u:mica-assembler:--x /var/lib/mica/precommit`,
    `sudo setfacl -m u:mica-assembler:r-x ${bookDir}`,
    `sudo setfacl -m u:mica-assembler:r-- ${bookDir}/book.jsonl`,
    "# 3 · verify. Each line distinguishes its own failure from the thing it",
    "#     tests: a missing user must not read as a refused grant.",
    "id mica-assembler || echo NO_SUCH_USER_RUN_STEP_1",
    `sudo -u mica-assembler test -r ${bookDir}/book.jsonl; echo "read grant: exit $?  (0 = granted, non-0 = refused)"`,
    `sudo -u mica-assembler test -w ${bookDir}/book.jsonl; echo "write probe: exit $?  (NON-0 IS THE PASS — a writable book is a failed act)"`,
  ];
}

/**
 * The book is a DEPLOYMENT ARTIFACT under another principal. This checks; it
 * never creates and never widens a permission.
 *
 * `statSync`, not `existsSync`: a path this process may not TRAVERSE must not be
 * reported as a path that does not exist. That misreport is a known defect class
 * in this tree (S97-D(2): a principal who cannot enter a directory was told
 * "first boot"), and it is exactly the failure this reader is most likely to
 * hit, because not being able to enter is the NORMAL state until the arbiter grants.
 */
export function readBookOrSignpost(bookPath: string): string {
  const bookDir = bookPath.replace(/\/[^/]*$/, "");
  const signpost =
    `the A9 book at ${bookPath} could not be read by this principal — this is a ` +
    `DEPLOYMENT ACT, not a code defect. Expected: uid mica-assembler holding an ` +
    `explicit per-book read grant (traverse on /var/lib/mica/precommit, read on ` +
    `${bookDir}/book.jsonl), and NO write anywhere on that path. Nothing was ` +
    `created, nothing was granted, and no directory was made. The acts are ` +
    `printed by deploymentActProposal(); they are the arbiter's alone.`;
  let stats: Stats;
  try {
    stats = statSync(bookPath);
  } catch (err) {
    throw new AssemblerDeploymentActMissingError(
      `${signpost} (${String(err)})`,
      bookPath,
      err
    );
  }
  if (!stats.isFile()) {
    throw new AssemblerDeploymentActMissingError(
      `${signpost} (the path exists and is not a regular file)`,
      bookPath
    );
  }
  try {
    return readFileSync(bookPath, "utf8");
  } catch (err) {
    throw new AssemblerDeploymentActMissingError(
      `${signpost} (${String(err)})`,
      bookPath,
      err
    );
  }
}

// ── Parsing — the book is FOREIGN TEXT ───────────────────────────────────────

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function isStr(x: unknown): x is string {
  return typeof x === "string";
}
function isSeq(x: unknown): x is number {
  return Number.isInteger(x) && (x as number) >= 0;
}

/**
 * Parse one JSONL line into a book record, or refuse.
 *
 * REFUSES, NEVER REPAIRS. A line this reader cannot understand is not skipped
 * and not guessed at: the whole assembly stops. A reader that quietly dropped an
 * unparseable line would emit a ProbeSource that is silently short, and nothing
 * downstream could tell a short book from a short read.
 */
export function parseBookRecord(line: string, lineNo: number): MirroredBookRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    throw new AssemblerRefused(
      `book line ${lineNo} is not valid JSON (${String(err)}).`,
      "A line this reader cannot parse is not skipped. Dropping it would emit a " +
        "ProbeSource that is silently short, and no consumer could tell a short " +
        "book from a short read."
    );
  }
  if (!isObj(parsed)) {
    throw new AssemblerRefused(
      `book line ${lineNo} is not a JSON object.`,
      "The book is a chain of records; a bare value is not one."
    );
  }
  const o = parsed;
  const frameOk =
    isSeq(o.sequenceNumber) &&
    isStr(o.previousHash) &&
    isStr(o.hash) &&
    Number.isFinite(o.timestamp) &&
    isStr(o.modality);
  if (!frameOk) {
    throw new AssemblerRefused(
      `book line ${lineNo} does not carry a well-formed chain frame.`,
      "Every record in this book carries sequenceNumber/previousHash/hash/" +
        "timestamp/modality. One that does not is not a record of this book."
    );
  }
  if (o.kind === "COMMITMENT") {
    if (!isStr(o.committerId) || !isStr(o.sealed))
      throw new AssemblerRefused(
        `book line ${lineNo} is a COMMITMENT missing committerId or sealed.`,
        "A commitment without its committer or its seal cannot be joined to anything."
      );
    return o as unknown as MirroredCommitment;
  }
  if (o.kind === "REVEAL") {
    const p = o.plaintext;
    const plainOk =
      isObj(p) &&
      (p.type === "verdict" || p.type === "hash" || p.type === "claim+rule") &&
      isStr(p.target) &&
      isStr(p.predictedValue) && // MAY BE EMPTY — see MirroredPlaintext
      isStr(p.committerId) &&
      isStr(p.salt);
    if (!isSeq(o.ref) || !plainOk || (o.sealCheck !== "MATCH" && o.sealCheck !== "MISMATCH"))
      throw new AssemblerRefused(
        `book line ${lineNo} is a REVEAL with a malformed ref, plaintext, or sealCheck.`,
        "A reveal is the only place the sealed prediction becomes readable. A " +
          "malformed one is refused rather than partially read."
      );
    return o as unknown as MirroredReveal;
  }
  if (o.kind === "GRADING") {
    if (!isSeq(o.ref) || !isStr(o.graderId) || !isStr(o.verdict) || !isStr(o.ground))
      throw new AssemblerRefused(
        `book line ${lineNo} is a GRADING with a malformed ref, graderId, verdict, or ground.`,
        "Gradings are not read for their content here, but a malformed record " +
          "means this reader has misunderstood the book and must stop."
      );
    return o as unknown as MirroredGrading;
  }
  if (o.kind === "ANCHOR") {
    const statusOk =
      o.status === "DROPPED" || o.status === "NOT_DROPPED" || o.status === "CANNOT_SEE";
    if (!isSeq(o.ref) || !statusOk || !Number.isFinite(o.droppedAt) || !isStr(o.headHash))
      throw new AssemblerRefused(
        `book line ${lineNo} is an ANCHOR with a malformed ref, status, droppedAt, or headHash.`,
        "The anchor is the only order evidence coarser than chain order this " +
          "reader has. A malformed one is refused, never approximated."
      );
    return o as unknown as MirroredAnchor;
  }
  throw new AssemblerRefused(
    `book line ${lineNo} carries an unknown kind ${JSON.stringify(o.kind)}.`,
    "A kind this reader does not know may be a record it must not ignore. It " +
      "stops rather than assuming the unknown is irrelevant."
  );
}

export function parseBook(raw: string): readonly MirroredBookRecord[] {
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  return lines.map((l, i) => parseBookRecord(l, i + 1));
}

// ── The sweep period is DECLARED, and arrives saying so `[LB]` ───────────────
//
// S103-G, the arbiter's ruling: sweepPeriodMs = 80000. Not read off the running timer
// (`OnUnitActiveSec=1min` is what the box currently does); 80000 is what the
// ARBITER COMMITS TO, with margin. The direction is the whole point:
//
//   DECLARED >= ACTUAL  ->  F4 is SLOWER to claim order, never faster.
//
// A period declared too long costs order evidence that could honestly have been
// had. A period declared too short MANUFACTURES it. Those are not symmetric
// errors and this code must never be tuned as though they were: future
// calibration is DOWNWARD-ONLY-WITH-EVIDENCE.
//
// So the value does not arrive as a bare number. A bare number cannot say
// whether it was measured or committed to, and the difference is the whole
// warrant: a measurement of a sweep is a fact about a box on one day, and F4's
// order claim leans on a COMMITMENT that holds across days. `declaredBy` has no
// honest value for a measurement, which is the point of requiring it.
//
// STILL NO DEFAULT (option-B, unchanged). Absent declaration = every record
// reads ORDER_NOT_ESTABLISHED, exactly as before.

export interface DeclaredSweepPeriod {
  /** Milliseconds. A positive integer; see `declareSweepPeriod`. */
  readonly ms: number;
  /** WHO committed to it. A measurement has nobody to put here. */
  readonly declaredBy: string;
  /** What the declaration rests on, in the declarer's own words. */
  readonly basis: string;
}

export interface SweepPeriodRefusal {
  readonly refused: true;
  readonly reason: string;
}

/**
 * Build a declaration, or refuse it. THE REFUSALS ARE THE POINT.
 *
 * The CLI used to read this value as `Number(argv[2])` and keep anything
 * `Number.isFinite` accepted. Measured at S103, not argued:
 *
 *     ""    -> Number("")  === 0    -> kept as sweepPeriodMs 0
 *     " "   -> 0                    -> kept as 0
 *     "0"   -> 0                    -> kept as 0
 *     "-5"  -> -5                   -> kept as -5
 *
 * With a period of 0, `delta > 0` is true for every observation that came after
 * its anchor at all — so AN EMPTY ARGUMENT PRODUCED THE STRONGEST CLAIM F4 CAN
 * MAKE. A negative period is worse: it establishes order for observations
 * BEFORE the anchor. The operator saw `sweepPeriodMs: 0` printed and could
 * reasonably read it as "not injected".
 *
 * A sweep takes time. Zero is not a sweep period, it is the absence of one, and
 * the absence of one already has an honest representation: no declaration.
 */
export function declareSweepPeriod(
  ms: unknown,
  declaredBy: string,
  basis: string
): DeclaredSweepPeriod | SweepPeriodRefusal {
  if (typeof ms !== "number" || !Number.isFinite(ms))
    return { refused: true, reason: `sweep period ${JSON.stringify(ms)} is not a finite number.` };
  if (!Number.isInteger(ms))
    return { refused: true, reason: `sweep period ${ms} is not a whole number of milliseconds.` };
  if (ms <= 0)
    return {
      refused: true,
      reason:
        `sweep period ${ms} is not positive. A sweep takes time; 0 and below do ` +
        `not describe one, and a non-positive period would establish order for ` +
        `observations inside — or before — the sweep that carried the anchor. ` +
        `If no period is being declared, declare none: that reads ` +
        `ORDER_NOT_ESTABLISHED, which is the honest answer.`,
    };
  if (declaredBy.trim() === "")
    return {
      refused: true,
      reason:
        "a sweep period must name WHO declared it. This value is a commitment, " +
        "not a measurement, and a commitment with no committer is a bare number " +
        "wearing the word 'declared'.",
    };
  return { ms, declaredBy: declaredBy.trim(), basis: basis.trim() };
}

export function isSweepPeriodRefusal(
  v: DeclaredSweepPeriod | SweepPeriodRefusal
): v is SweepPeriodRefusal {
  return (v as SweepPeriodRefusal).refused === true;
}

// ── Order evidence — the S100 option-(c) bar, held `[LB]` ────────────────────
//
// RULED (S100, adopted under Prokura): "within-sweep chain order is not evidence
// of arrival order." The chain needs a line; the line proves nothing about
// same-sweep arrival.
//
// So SEALED_BEFORE_OBSERVED is asserted only on evidence COARSER than chain
// order, and this reader has exactly one such source: the commitment's ANCHOR
// record, whose `droppedAt` is a wall time presented when the drop returned. All
// THREE of these must hold, or the answer is ORDER_NOT_ESTABLISHED with the
// failing condition named:
//
//   1 · an ANCHOR for this commitment exists with status DROPPED and droppedAt > 0
//   2 · a sweep period was INJECTED (option-B, no default — how long a sweep
//       takes is a deployment fact this code has no access to, and a default
//       here would be a calibration constant smuggled in as a convenience)
//   3 · observedAt - droppedAt > sweepPeriodMs, STRICTLY — the observation must
//       fall outside the sweep the anchor landed in, not merely after its stamp
//
// With no sweep period injected, every record reads ORDER_NOT_ESTABLISHED. That
// is the honest v1 answer and it ships that way loudly: a first run that says
// "order not established" is a correct instrument, not a failure.

export interface OrderVerdict {
  readonly evidence: MirroredOrderEvidence;
  readonly reason: string;
}

export function decideOrderEvidence(
  anchor: MirroredAnchor | undefined,
  observedAt: number,
  declared: DeclaredSweepPeriod | undefined
): OrderVerdict {
  if (anchor === undefined)
    return {
      evidence: "ORDER_NOT_ESTABLISHED",
      reason:
        "no ANCHOR record for this commitment exists in the book. Chain position " +
        "alone is not evidence of arrival order (S100, option c), and it is the " +
        "only other thing this reader could have used.",
    };
  if (anchor.status !== "DROPPED")
    return {
      evidence: "ORDER_NOT_ESTABLISHED",
      reason:
        `the ANCHOR for this commitment has status ${anchor.status}, not DROPPED, ` +
        `so nothing left this book at a time this reader can name.`,
    };
  if (!(anchor.droppedAt > 0))
    return {
      evidence: "ORDER_NOT_ESTABLISHED",
      reason:
        "the ANCHOR is DROPPED but carries droppedAt 0 — no drop time was presented.",
    };
  if (declared === undefined)
    return {
      evidence: "ORDER_NOT_ESTABLISHED",
      reason:
        "no sweep period was declared. How long a sweep takes is a deployment " +
        "fact this code has no access to and will not default; without it, an " +
        "observation cannot be placed OUTSIDE the sweep the anchor landed in.",
    };
  const delta = observedAt - anchor.droppedAt;
  if (!(delta > declared.ms))
    return {
      evidence: "ORDER_NOT_ESTABLISHED",
      reason:
        `the observation is ${delta} ms after the anchor's droppedAt, which does ` +
        `not clear the sweep period of ${declared.ms} ms DECLARED BY ` +
        `${declared.declaredBy}. The two may have fallen in one sweep, and ` +
        `within-sweep order is not evidence.`,
    };
  return {
    evidence: "SEALED_BEFORE_OBSERVED",
    reason:
      `the ANCHOR dropped at ${anchor.droppedAt} and the observation is ${delta} ms ` +
      `later, clearing the sweep period of ${declared.ms} ms DECLARED BY ` +
      `${declared.declaredBy} (${declared.basis || "no basis stated"}). That period ` +
      `is a COMMITMENT, not a measurement of this box: the claim is that a sweep ` +
      `does not exceed it. The seal was outside this book before the observation ` +
      `was made.`,
  };
}

// ── Structural mirror · the Gate-5 intent wire (src/probe/intent-record.ts) ──
//
//   A THIRD MIRROR, FOR THE SAME REASON AS THE OTHER TWO (see the header's
//   "NO IMPORT EDGE" section). `intent-record.ts` is a WRITER of the records
//   this module reads across a trust boundary, and importing a writer's own
//   reader would inherit the writer's assumption that its output is
//   well-formed — the one thing a reader across that boundary must not assume.
//   So the field name and the two class values are DECLARED here, and
//   `assembler.test.ts` reads the real module and fails when either side moves.
//
//   IT READS A DECLARED FIELD, NOT A LABEL. The obvious cheap tell would be the
//   target string prefix (`rule-intent:` / `invocation-basis:`), and that is
//   string-matching a label — the bar this suite refuses. This reads one
//   structured field out of the sealed content and treats anything else,
//   including a plaintext that does not parse, as "not one of these": a record
//   that declares nothing is, on the wire, an ordinary prediction, and is
//   emitted as one.

/** Mirrors `INTENT_RECORD_CLASS_FIELD`. */
export const MIRRORED_INTENT_RECORD_CLASS_FIELD = "intentRecordClass";

/** Mirrors `IntentRecordClass`. */
export const MIRRORED_INTENT_RECORD_CLASSES: readonly string[] = [
  "RULE_INTENT",
  "INVOCATION_BASIS",
];

/**
 * The declared class of a sealed plaintext, or null when it declares none.
 * Null is the ordinary case: almost every commitment in a book is a prediction.
 */
export function declaredIntentRecordClass(predictedValue: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(predictedValue);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const declared = (parsed as Record<string, unknown>)[MIRRORED_INTENT_RECORD_CLASS_FIELD];
  if (typeof declared !== "string") return null;
  return MIRRORED_INTENT_RECORD_CLASSES.includes(declared) ? declared : null;
}

// ── THE GRADER THAT DOES NOT EXIST — said on the surface (S117, Build C) ─────
//
//   S116's recon found it and S117 A's receipt confirmed it at bytes: the book
//   carries IR-class records (rule-intent, invocation-basis) and NOTHING in this
//   codebase reads one back against an outcome. Until now that absence lived in
//   prose — a recon paragraph, a receipt line, a board entry. This build moves
//   it onto the book's own reading surface, so a reader of the assembler's
//   output learns it WHERE THE RECORDS ARE rather than in a document they may
//   never open.
//
//   IT IS A STATE, NOT A REFUSAL. Nothing is wrong. An IR record with no grader
//   is exactly as sound as one with a grader — it simply has not been read back
//   yet, and saying so is the difference between a hole somebody knows about and
//   a hole somebody could mistake for coverage. The exit code is unaffected.
//
//   NO NEW IMPORT EDGE. The census is derived from the SAME index the
//   `NOT_A_PREDICTION` withhold already reads, through the same mirrored class
//   declaration. `intent-record.ts` stays unimported: the trust boundary S116
//   drew is that this reader MIRRORS the declaration rather than sharing a
//   module with the wire that writes it.

/**
 * Whether anything reads IR records back against outcomes.
 *
 * `"WIRED"` EXISTS IN THIS UNION AND MUST NOT BE EMITTED BY THIS BUILD. It is
 * here so that the day a grader is wired, the state has a name to move to
 * rather than a new type to invent — and so that a test can assert nothing in
 * `src/` emits it yet. When one IS wired it is the S113 shape (S with
 * consequence-structured observables, plus bounded D — blind-first human,
 * bounded signature; L advisory only), over "did the outcome match the declared
 * basis". It is not a new principal and it is not this build.
 */
export type IntentRecordGraderState = "NONE_EXISTS" | "WIRED";

export const NO_GRADER_READS_IR_RECORDS =
  "NOBODY YET - no grader reads IR records back against outcomes. When one is " +
  "wired it is the S113 shape (S + bounded D), not a new principal. " +
  "(S116 recon §3; design v0.2)";

/**
 * THE HONEST HALF. A COMMITMENT is a hash and a committer id; the declared
 * class lives in the REVEAL's plaintext. So a book scan can count revealed IR
 * records exactly and can count how many commitments are unrevealed — but it
 * CANNOT say how many of those unrevealed ones are IR records, because nothing
 * in a sealed commitment says. Reporting the revealed count alone would read as
 * a total.
 */
export const UNREVEALED_IR_IS_NOT_COUNTABLE =
  "not countable from the book - a COMMITMENT is a hash and a committer id; " +
  "the class is declared in the REVEAL. An unrevealed intent record is " +
  "invisible to any scan, including this one (S116-E residual, inherited).";

/** What the book says about its own IR records, and about who grades them. */
export interface IntentRecordCensus {
  /** Revealed IR records by declared class. Every mirrored class is a key. */
  readonly revealedByClass: Readonly<Record<string, number>>;
  readonly revealedTotal: number;
  /** Commitments with no REVEAL here. How many are IR records is UNKNOWABLE. */
  readonly unrevealedCommitments: number;
  /** Why that number is not an IR count. */
  readonly unrevealedResidual: string;
  readonly graderState: IntentRecordGraderState;
  readonly graderStatement: string;
}

/**
 * Derived from the commitment/reveal index this function is handed — the same
 * one the withhold reads. Pure: it counts and states, and decides nothing.
 */
function censusIntentRecords(
  commitments: ReadonlyMap<number, MirroredCommitment>,
  reveals: ReadonlyMap<number, MirroredReveal>
): IntentRecordCensus {
  const revealedByClass: Record<string, number> = {};
  for (const cls of MIRRORED_INTENT_RECORD_CLASSES) revealedByClass[cls] = 0;

  let revealedTotal = 0;
  for (const reveal of reveals.values()) {
    const declared = declaredIntentRecordClass(reveal.plaintext.predictedValue);
    if (declared === null) continue;
    revealedByClass[declared]++;
    revealedTotal++;
  }

  let unrevealedCommitments = 0;
  for (const seq of commitments.keys()) {
    if (!reveals.has(seq)) unrevealedCommitments++;
  }

  return {
    revealedByClass,
    revealedTotal,
    unrevealedCommitments,
    unrevealedResidual: UNREVEALED_IR_IS_NOT_COUNTABLE,
    // The ONLY value this build emits. See the type's own note.
    graderState: "NONE_EXISTS",
    graderStatement: NO_GRADER_READS_IR_RECORDS,
  };
}

/** The ceiling line this build adds, so a reader of the tail sees the hole too. */
export const NO_IR_GRADER_IS_A_STATED_HOLE =
  "This book's Gate-5 intent records are counted above and graded by nothing. " +
  "That is a stated hole, not a covered one: nothing in this codebase compares " +
  "a declared basis to what actually happened.";

// ── Observations this reader will NOT put in the ProbeSource ─────────────────

/**
 * ⚠ TWO reasons since S116. It was ONE from S101 until then, and the comment
 * that said so is kept below rather than deleted, because the reasoning that
 * kept it at one is what decides whether a third belongs.
 *
 * `NO_SUCH_COMMITMENT` used to live here too. It is now EMITTED as an UNSEALED
 * ProbeRecord instead of withheld — ruled S101, option (a): unsealed
 * observations belong countable inside the sensor's own report, not in a side
 * pile nothing consumes. The shape that made that unbuildable was repaired in
 * the same pass.
 *
 * `AWAITING_REVEAL` stays withheld, and the distinction is load-bearing: a
 * sealed-but-unrevealed commitment HAS an expectation, still under seal.
 * Emitting it as UNSEALED would state that nothing was ever sealed for it,
 * which is false about the book.
 *
 * `NOT_A_PREDICTION` is S116's, and it is the opposite kind of fact from both
 * of those. Those two are about how far a PREDICTION has got. This one says
 * the sealed record is not a prediction at all: it is a Gate-5 rule-intent or
 * invocation-basis record, which declares WHY a rule was set aside and has no
 * predicted outcome for anyone to observe. Emitting it would hand F4 a basis
 * blob to compare against an "observed value" — a comparison with no meaning
 * that would nevertheless produce a reading. Withholding is not a demotion
 * here; it is the only honest answer.
 */
export type WithheldReason = "AWAITING_REVEAL" | "NOT_A_PREDICTION";

export interface WithheldObservation {
  readonly observation: ObservationInput;
  readonly reason: WithheldReason;
  readonly detail: string;
}

export interface AssemblyInput {
  readonly bookPath: string;
  readonly book: readonly MirroredBookRecord[];
  readonly observations: readonly ObservationInput[];
  /**
   * Option-B injected, and DECLARED rather than measured. Absent => every
   * record reads ORDER_NOT_ESTABLISHED, unchanged since S101.
   */
  readonly sweepPeriod?: DeclaredSweepPeriod;
  /** The principal this process actually ran as, for the provenance line. */
  readonly ranAs: string;
}

export interface AssemblyResult {
  readonly probeSource: EmittedProbeSource;
  readonly withheld: readonly WithheldObservation[];
  readonly orderReasons: ReadonlyMap<number, string>;
  readonly bookRecordCount: number;
  /** What the book holds of the Gate-5 intent wire, and who grades it. */
  readonly intentRecords: IntentRecordCensus;
  readonly ceiling: readonly string[];
}

/**
 * Join the book to the presented observations and emit the injection.
 *
 * Refuses, loudly and without repair, on: a duplicate observation for one
 * commitment, a book carrying two commitments or two reveals at one sequence.
 * F4 refuses duplicates too; this reader must not manufacture that refusal by
 * handing it a source it already knows is ambiguous.
 */
export function assemble(input: AssemblyInput): AssemblyResult {
  const commitments = new Map<number, MirroredCommitment>();
  const reveals = new Map<number, MirroredReveal>();
  const anchors = new Map<number, MirroredAnchor>();

  for (const r of input.book) {
    if (r.kind === "COMMITMENT") {
      if (commitments.has(r.sequenceNumber))
        throw new AssemblerRefused(
          `the book carries two COMMITMENT records at sequence ${r.sequenceNumber}.`,
          "A chain cannot hold two records at one sequence. This reader has " +
            "misunderstood the book and stops rather than choosing one."
        );
      commitments.set(r.sequenceNumber, r);
    } else if (r.kind === "REVEAL") {
      if (reveals.has(r.ref))
        throw new AssemblerRefused(
          `the book carries two REVEAL records for commitment ${r.ref}.`,
          "Two reveals of one commitment are two different plaintexts claiming " +
            "one seal. This reader cannot choose between them and will not."
        );
      reveals.set(r.ref, r);
    } else if (r.kind === "ANCHOR") {
      // The FIRST anchor for a commitment is the one that dates it. A later
      // anchor is a re-anchoring and cannot make the seal older than it was.
      if (!anchors.has(r.ref)) anchors.set(r.ref, r);
    }
  }

  const seenObs = new Set<number>();
  const probeSource: EmittedProbeRecord[] = [];
  const withheld: WithheldObservation[] = [];
  const orderReasons = new Map<number, string>();

  for (const obs of input.observations) {
    if (!isSeq(obs.commitmentSeq))
      throw new AssemblerRefused(
        `an observation carries commitmentSeq ${JSON.stringify(obs.commitmentSeq)}, ` +
          `which is not a non-negative integer.`,
        "The commitment sequence is the join key. Without a usable one there is " +
          "nothing to join and nothing to name."
      );
    if (seenObs.has(obs.commitmentSeq))
      throw new AssemblerRefused(
        `two observations were presented for commitment ${obs.commitmentSeq}.`,
        "F4 refuses a source with two records for one commitment. This reader " +
          "does not manufacture that refusal by assembling one anyway."
      );
    seenObs.add(obs.commitmentSeq);

    if (!isStr(obs.target) || obs.target.length === 0)
      throw new AssemblerRefused(
        `the observation for commitment ${obs.commitmentSeq} names no target.`,
        "An observation has to say WHAT it observed. Without it an unsealed " +
          "record has nothing to name, and a sealed one cannot be cross-checked."
      );

    const commitment = commitments.get(obs.commitmentSeq);
    if (commitment === undefined) {
      // NOTHING WAS EVER SEALED for this observation. Emitted as an UNSEALED
      // record — counted inside F4's own report — rather than set aside in a
      // pile nothing reads (ruled S101). The seal-derived fields are ABSENT.
      probeSource.push({
        commitmentSeq: obs.commitmentSeq,
        target: obs.target,
        sealCheck: "UNSEALED",
        observed: {
          observedValue: obs.observedValue,
          observedBy: obs.observedBy,
          observedAt: obs.observedAt,
        },
        provenance:
          `${input.bookPath} holds NO COMMITMENT at sequence ${obs.commitmentSeq}; ` +
          `nothing was sealed for this observation, so no expectation was held ` +
          `outside for it. Observation from ${obs.provenance}; assembled by ` +
          `${ASSEMBLER_ID} running as ${input.ranAs}. Absence of a seal is ` +
          `readable, not punishable: this record is counted and read by nothing.`,
      });
      continue;
    }
    const reveal = reveals.get(obs.commitmentSeq);
    if (reveal === undefined) {
      withheld.push({
        observation: obs,
        reason: "AWAITING_REVEAL",
        detail:
          `commitment ${obs.commitmentSeq} is sealed and has no REVEAL in this book. ` +
          `Its prediction is still under seal and cannot be compared to anything. ` +
          `This is the pre-commitment working, not a fault.`,
      });
      continue;
    }

    // ── THE GATE-5 FENCE (S116) ────────────────────────────────────────────
    //
    //   Checked BEFORE the target cross-check, deliberately. A basis record is
    //   not a prediction, so a disagreement between the observer's target and
    //   the seal's is not the finding here — the finding is that somebody
    //   presented an observation for a record that predicts nothing. Refusing
    //   on the target first would report the wrong fact, and refusing at all
    //   would be too strong: presenting one of these is a mistake to be told
    //   about, not a malformed book.
    const declaredClass = declaredIntentRecordClass(reveal.plaintext.predictedValue);
    if (declaredClass !== null) {
      withheld.push({
        observation: obs,
        reason: "NOT_A_PREDICTION",
        detail:
          `commitment ${obs.commitmentSeq} declares itself a ${declaredClass} ` +
          `record of the Gate-5 intent wire, not a prediction. It states why a ` +
          `rule was set aside; it forecasts no outcome, so there is nothing for ` +
          `an observation to be compared against. It is withheld rather than ` +
          `emitted: F4 would compare its sealed content to this observation's ` +
          `value and produce a reading that means nothing.`,
      });
      continue;
    }

    // The observer's target is a CROSS-CHECK against the seal's own. They must
    // agree: the assembler cannot tell which thing was actually looked at, and
    // choosing one would be a silent repair of somebody else's evidence.
    if (obs.target !== reveal.plaintext.target)
      throw new AssemblerRefused(
        `the observation for commitment ${obs.commitmentSeq} names target ` +
          `${JSON.stringify(obs.target)}, but the REVEAL sealed ` +
          `${JSON.stringify(reveal.plaintext.target)}.`,
        "One of the two is looking at the wrong thing and this reader cannot " +
          "tell which. It refuses rather than picking the seal's target and " +
          "quietly discarding the observer's disagreement."
      );

    const order = decideOrderEvidence(
      anchors.get(obs.commitmentSeq),
      obs.observedAt,
      input.sweepPeriod
    );
    orderReasons.set(obs.commitmentSeq, order.reason);

    probeSource.push({
      commitmentSeq: obs.commitmentSeq,
      sealedDigest: commitment.sealed,
      expectationType: reveal.plaintext.type,
      target: reveal.plaintext.target,
      // Carried verbatim from the reveal. NOT compared to anything here.
      predictedValue: reveal.plaintext.predictedValue,
      committerId: reveal.plaintext.committerId,
      // The BOOK's verdict on its own seal. Never recomputed.
      sealCheck: reveal.sealCheck,
      orderEvidence: order.evidence,
      observed: {
        observedValue: obs.observedValue,
        observedBy: obs.observedBy,
        observedAt: obs.observedAt,
      },
      provenance:
        `${input.bookPath} COMMITMENT seq ${commitment.sequenceNumber} ` +
        `(hash ${commitment.hash}), REVEAL seq ${reveal.sequenceNumber}; ` +
        `observation from ${obs.provenance}; assembled by ${ASSEMBLER_ID} ` +
        `running as ${input.ranAs}; order evidence: ${order.reason}`,
    });
  }

  return {
    probeSource,
    withheld,
    orderReasons,
    bookRecordCount: input.book.length,
    // Over the WHOLE book, not only the records an observation named. The
    // withhold reports on what somebody asked about; this reports on what the
    // book holds, which is the question "who grades these" is asked about.
    intentRecords: censusIntentRecords(commitments, reveals),
    ceiling: [ASSEMBLY_IS_NOT_A_VERDICT, THE_GRANT_IS_THE_EVIDENCE, NO_IR_GRADER_IS_A_STATED_HOLE],
  };
}
