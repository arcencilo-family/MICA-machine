#!/usr/bin/env node
// ── MICA · the arbiter's one-shot append tool ────────────────────────────────
//
//   ts-node src/arbiter/arbiter-log.ts \
//     --store <file> --intake <dir> --witness-set-id <id> \
//     --submitter-id <id> --modality OFFERED|IMPOSED|NOT_AN_INSTRUCTION \
//     [ruling text …]                      (or the text on stdin)
//
// ── IT IS RUN AS THE ROLE, NOT AS A PERSON WEARING IT (R12) ──────────────────
//
//   `sudo -u mica-arbiter ts-node src/arbiter/arbiter-log.ts …`. The arbiter
//   reads and writes AS THE ROLE, so the book's file ownership, the drop's
//   ownership, and the declared submitter id are one identity that a deployment
//   configured and an operator can check — rather than whichever human account
//   happened to be logged in that evening.
//
// ── WHY IT LIVES IN src/arbiter/ AND NOT IN tools/ ───────────────────────────
//
//   `tools/` is outside `tsc`'s BUILD surface (`rootDir: ./src`), outside the
//   closure guard, and outside `registration.test.ts`. A tool there ships as a
//   script that the build never compiles. This CLI is the ONLY writer of a
//   deployed evidential book, so it belongs where the compiler and the
//   registration guard can both see it: `tsc` typechecks it as part of the build
//   surface, and its sibling `ruling-log.test.ts` is chained in `test:mica`
//   under F10 like every other test file under `src/`.
//
//   THE CONSEQUENCE OF THE OTHER CHOICE, stated so the trade is legible: had it
//   gone to `tools/`, it would be discovered by `test:all` and invisible to
//   `test:mica`, and the closure guard would not walk it. Neither is fatal; both
//   are a weaker claim than the one available here for free.
//
// ── ONE SHOT, NO DAEMON, NO SINK, NO MOUTH ───────────────────────────────────
//
//   It appends ONE ruling and exits. There is no transport here, no send, no
//   default destination, and nothing that reads a witness back. Records surface
//   through C6 when C6 exists. What this prints is what THIS PROCESS DID.
//
//   AND IT NEVER CLAIMS A WITNESS KEPT ANYTHING. The last line it prints says
//   so in words, on the success path as loudly as on the failure path.

import { readFileSync } from "fs";

import { fileDropCommitter } from "../witness/drop-committer";
import {
  ArbiterDeploymentActMissing,
  MODALITIES,
  RulingLog,
  THE_WITNESS_TRAIL_IS_A_SAMPLE,
} from "./ruling-log";
import type { Modality } from "./ruling-log";

export const SUBMISSION_IS_NOT_RETENTION_LINE =
  "SUBMISSION IS NOT RETENTION. The line above says a drop file was WRITTEN " +
  "into the intake. It does not say a witness was running, that it read the " +
  "drop, or that it kept anything — and this tool cannot find out.";

export interface Args {
  /** No defaults for paths. There are none in the source and this keeps it so. */
  store: string | null;
  intake: string | null;
  witnessSetId: string | null;
  submitterId: string | null;
  modality: string | null;
  /** The ruling text from the argv tail; null means "read stdin". */
  text: string | null;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    store: null,
    intake: null,
    witnessSetId: null,
    submitterId: null,
    modality: null,
    text: null,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--store") args.store = argv[++i] ?? null;
    else if (a === "--intake") args.intake = argv[++i] ?? null;
    else if (a === "--witness-set-id") args.witnessSetId = argv[++i] ?? null;
    else if (a === "--submitter-id") args.submitterId = argv[++i] ?? null;
    else if (a === "--modality") args.modality = argv[++i] ?? null;
    else rest.push(a);
  }
  if (rest.length > 0) args.text = rest.join(" ");
  return args;
}

/**
 * Which required arguments were not supplied, or were supplied unusably.
 *
 * `--modality` is checked against the enum HERE, at the front door, and not left
 * to fail at the far end. A ruling appended with an unrecognised modality would
 * be a ruling in the book whose head the intake retains as a
 * MALFORMED_SUBMISSION — the arbiter's own act, permanently recorded as
 * malformed bytes, over one typo. Refusing before the append costs a retype.
 */
export function missingRequired(args: Args): string[] {
  const missing: string[] = [];
  if (args.store === null) missing.push("--store");
  if (args.intake === null) missing.push("--intake");
  if (args.witnessSetId === null) missing.push("--witness-set-id");
  if (args.submitterId === null) missing.push("--submitter-id");
  if (args.modality === null) {
    missing.push("--modality");
  } else if (!(MODALITIES as readonly string[]).includes(args.modality)) {
    missing.push(
      `--modality (got \`${args.modality}\`; it must be one of ` +
        `${MODALITIES.join(" | ")})`
    );
  }
  return missing;
}

export function usage(): string {
  return [
    "usage: arbiter-log --store <file> --intake <dir> --witness-set-id <id> \\",
    "                   --submitter-id <id> --modality " +
      MODALITIES.join("|") +
      " \\",
    "                   [ruling text ...]        (omit to read the text on stdin)",
    "",
    "  Appends ONE ruling to the arbiter's book and commits that book's head",
    "  into the witness intake. Run it AS THE ROLE: sudo -u mica-arbiter.",
    "",
    "  Nothing here has a default. A path this tool was not given is a path it",
    "  does not guess.",
  ].join("\n");
}

/** The ruling text: the argv tail, or stdin when the tail is empty. */
export function readRulingText(args: Args, stdinPath = "/dev/stdin"): string {
  if (args.text !== null) return args.text;
  return readFileSync(stdinPath, "utf8");
}

/**
 * The whole act, with every effect injected so a test can run it end to end.
 *
 * `now` is INJECTED and the CLI passes `Date.now`. That is deliberate: the wall
 * clock is the ARBITER'S OWN PRESENTED DATA, supplied at the edge by the process
 * the seat invoked, and never authored inside the book. See `ruling-log.ts`.
 */
export function appendOneRuling(options: {
  readonly storePath: string;
  readonly intakeDir: string;
  readonly witnessSetId: string;
  readonly submitterId: string;
  readonly modality: Modality;
  readonly rulingText: string;
  readonly now: () => number;
}): string[] {
  const log = new RulingLog({
    path: options.storePath,
    witnessSetId: options.witnessSetId,
    // The committer is built here and NOT given a modality: the modality rides
    // each commit, because this book's entries differ in it by design.
    headCommitter: fileDropCommitter(options.intakeDir, options.submitterId),
  });

  const out: string[] = [];
  out.push(`[arbiter] store        : ${options.storePath}`);
  out.push(`[arbiter] loadState    : ${log.getLoadState()}`);
  const loadError = log.getLastError();
  if (loadError !== null) out.push(`[arbiter] loadError    : ${loadError}`);

  const outcome = log.record({
    timestamp: options.now(),
    rulingText: options.rulingText,
    modality: options.modality,
  });

  out.push(`[arbiter] appended seq : ${String(outcome.record.sequenceNumber)}`);
  out.push(`[arbiter] modality     : ${outcome.record.modality}`);
  out.push(`[arbiter] head hash    : ${outcome.record.hash}`);
  out.push(`[arbiter] persisted    : ${String(outcome.persisted)}`);
  if (outcome.detail !== null) out.push(`[arbiter] appendDetail : ${outcome.detail}`);

  if (outcome.headCommitted) {
    // The path the committer would have written, named because the committer
    // does not report it back — the filename IS the submitter id, by contract.
    out.push(
      `[arbiter] drop written : ${options.intakeDir}/${options.submitterId}`
    );
  } else {
    out.push(
      `[arbiter] drop NOT written: ${outcome.headCommitDetail ?? "no committer was wired"}`
    );
  }

  out.push("");
  out.push(SUBMISSION_IS_NOT_RETENTION_LINE);
  out.push(THE_WITNESS_TRAIL_IS_A_SAMPLE);
  return out;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const missing = missingRequired(args);
  if (missing.length > 0) {
    console.error(`[arbiter] missing or unusable: ${missing.join(", ")}`);
    console.error("");
    console.error(usage());
    process.exit(2);
  }
  const rulingText = readRulingText(args);
  let lines: string[];
  try {
    lines = appendOneRuling({
      storePath: args.store as string,
      intakeDir: args.intake as string,
      witnessSetId: args.witnessSetId as string,
      submitterId: args.submitterId as string,
      modality: args.modality as Modality,
      rulingText,
      now: Date.now,
    });
  } catch (err) {
    // ── THE SIGNPOST IS THE MESSAGE. IT IS PRINTED, NOT REWRAPPED (S97) ───────
    //
    //   `ruling-log.ts` throws `ArbiterDeploymentActMissing` when recipe §5B.2
    //   was never performed, and its message already carries the four things an
    //   operator needs: the act, the recipe section, the expected state with its
    //   mode and ownership, and that nothing was created. Restating it here
    //   would give the deployer two sentences to reconcile and a second place
    //   for the digits to go stale.
    //
    //   NO STACK TRACE ON THIS PATH. An uncaught throw exits 1 with a trace,
    //   which is loud and non-zero and still wrong: a trace tells the reader
    //   where the CODE was, when what they need is which ACT nobody performed.
    //   Error-as-signpost, never error-as-shrug — and never error-as-autopsy.
    //
    //   EXIT 4 · THE DEPLOYMENT ACT NAMED IN THE RECIPE WAS NOT PERFORMED.
    //   The digit is chosen to rhyme with C6: `mica-report` already exits 4 for
    //   "the REPORT DIRECTORY is absent, is not a directory, or the write
    //   failed" (`mica-report.ts` header). Same class of fault, same digit,
    //   across the two tools an operator runs by hand. It is distinct from this
    //   tool's only other code, 2 (a required argument was missing or unusable),
    //   and from 1, which is what an uncaught throw would still produce for
    //   every OTHER error class — all of which propagate exactly as before.
    if (!(err instanceof ArbiterDeploymentActMissing)) throw err;
    console.error(err.message);
    process.exit(4);
  }
  for (const line of lines) console.log(line);
}
