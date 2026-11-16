#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// MICA — C6/W5, THE DAILY WITNESS REPORT. A SEPARATE OS PROCESS. THE INVOKER.
//
//   npx ts-node src/report/mica-report.ts \
//     --store <file> --outbox <dir> --report-dir <dir> [--day YYYY-MM-DD]
//
// ── WHAT IT IS ───────────────────────────────────────────────────────────────
//
//   A reader-side, out-of-band, once-a-day fold of the witness store file into
//   one dated report. It reads two paths and writes one file. It opens no
//   socket, contacts no process, polls nothing and asks nobody anything. The
//   substance is in `./witness-report.ts`; this file is arguments, exit codes,
//   and the one write.
//
// ── IT IS A ONESHOT, AND THE SCHEDULE IS NOT ITS BUSINESS ────────────────────
//
//   No timer lives in here. `deploy/mica-report.timer` holds the cadence, the
//   same way `deploy/mica-witnessd.service` holds the restart policy that
//   `witnessd.ts` refuses to hold. A program that scheduled itself would be a
//   daemon, and a daemon that reads a book once a day is a monitor wearing a
//   reader's coat.
//
// ── THE REPORT DIRECTORY IS A DEPLOYMENT ACT AND THIS PROGRAM DOES NOT MAKE IT
//
//   Draft discriminator, S96-D (house, unratified; board §3): *a directory
//   another principal must reach is a deployment act, never a `mkdirSync`; the
//   test is not authorship but whether any OTHER principal must enter.* The
//   report directory is the definitive case — the whole point of the file is
//   that somebody else reads it. Conjured here it would land at this process's
//   umask with this process's PRIMARY group, and every report would sit where
//   the people entitled to it cannot open it, with nothing failing.
//
//   THERE IS NO `mkdirSync` IN THIS FILE. A missing report directory exits
//   non-zero naming the path. **Do not add a create-if-missing flag**, and do
//   not add one under a test-only branch: a fence with a bypass is not a fence.
//
// ── EXIT CODES ───────────────────────────────────────────────────────────────
//
//   0  a report was written and every reading it names was taken
//   1  it could not start: a required path was not supplied, or --day was not a
//      date. Nothing was read and nothing was written.
//   3  the STORE could not be read. NO REPORT IS WRITTEN — a report of seven
//      zeros from a book this process never opened is the exact lie the quiet-
//      day sentence exists to prevent.
//   4  the REPORT DIRECTORY is absent, is not a directory, or the write failed.
//   5  a report for that day is already there. Nothing was overwritten.
//   6  the report WAS written, and a reading it names could not be taken (the
//      outbox would not list). The report says so, in its own text, loudly.
// ──────────────────────────────────────────────────────────────────────────────

import { readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";

import {
  checkSymmetry,
  foldDay,
  previousLocalDay,
  readOutbox,
  readStoreText,
  renderRecordsJsonl,
  renderReport,
  reportRecords,
  windowForDay,
} from "./witness-report";
import type { DayProvenance, EngObservableReading } from "./witness-report";
import { MicaLogFile, LOADED_UNVERIFIED_FILE } from "../glue/mica-log-file";
import { engStructure } from "../mica/eng";
import { assessStaleness, loadCadenceDeclaration } from "./staleness-alarm";
import type { StalenessReading } from "./staleness-alarm";
import { readClerkCallerAttestation } from "./clerk-caller-attestation";
import type { ClerkCallerReading } from "./clerk-caller-attestation";
import {
  assessDeclaredJournalReconciliations,
  assessJournalBookReconciliation,
  assessStampShapeReconciliation,
  loadJournalDeclarations,
} from "./reconciliation";
import { assessDeploymentFacts, loadDeploymentFactsDeclaration } from "./deployment-facts";

export const EXIT = {
  WRITTEN: 0,
  CANNOT_START: 1,
  STORE_UNREADABLE: 3,
  REPORT_DIR: 4,
  ALREADY_WRITTEN: 5,
  WRITTEN_WITH_A_READING_REFUSED: 6,
} as const;

export interface Args {
  /** No defaults for paths, exactly as `witnessd` has none. */
  store: string | null;
  outbox: string | null;
  reportDir: string | null;
  /** `YYYY-MM-DD`. Absent means the most recent COMPLETE local day. */
  day: string | null;
  /**
   * S107 Eng-baseline-capture brief. OPTIONAL — declared optional on the
   * interface itself, unlike the three paths above, so every existing
   * `Args` literal (this file's own tests included) keeps compiling. Its
   * absence does not stop this program: the Eng line prints NOT_ATTEMPTED
   * and the witness report is unaffected. The MICA log, not the witness
   * store; a different file, read best-effort.
   */
  log?: string | null;
  /**
   * S108 DC-2. OPTIONAL, same shape as `log`: a declaration file mapping
   * chain_id -> declared max age in days. Absence does not stop this program
   * — the staleness section prints CANNOT_ASSESS and the witness report is
   * unaffected. R8: the code never derives this cadence from arrival history.
   */
  cadenceFile?: string | null;
  /**
   * S109-B item 3. OPTIONAL, same shape as `cadenceFile`: absence does not
   * stop this program — the clerk-caller section prints CALLER_ABSENT and the
   * witness report is unaffected. Points at the SAME file
   * `clerk-clock-stamps-file.ts` reads through its custody door; this report
   * reads it directly, best-effort, WITHOUT that door — a report is a reader,
   * never a gate, and the door's custody claim is Sig's to make, not this
   * program's to borrow.
   */
  clerkStampsFile?: string | null;
  /**
   * S110-B. OPTIONAL, same shape as `clerkStampsFile`: absence does not stop
   * this program — the Pair A reconciliation reads CANNOT_ASSESS ("no
   * --registrar-log was supplied") and the witness report is unaffected.
   * The registrar's own authoritative chain
   * (`<precommit root>/registrar-log-chained.jsonl`, `registrar.ts`'s
   * `chainedLogPath()`) — a DIFFERENT file from everything else this program
   * already reads, named explicitly rather than derived from `--store`.
   */
  registrarLog?: string | null;
  /**
   * S111, generalized. OPTIONAL, same shape as `cadenceFile`: a declarations
   * file mapping principal name -> declared uid (mirrors expected-cadence.json's
   * own pattern, DC-2 precedent). Absence does not stop this program — the
   * per-principal reconciliation family reads CANNOT_ASSESS and the witness
   * report is unaffected. R-V3: no uid in it is ever guessed by this program;
   * The arbiter writes the file, on the box, never checked in with real uids.
   */
  journalDeclarationsFile?: string | null;
  /**
   * S112, DF. OPTIONAL, same shape as `cadenceFile`: absence does not stop
   * this program — the deployment-facts section (§3.7) prints CANNOT_ASSESS
   * and the witness report is unaffected. R8: every expectation this section
   * compares against comes from THIS file; nothing here is derived from the
   * deployed tree.
   */
  deploymentFactsFile?: string | null;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    store: null,
    outbox: null,
    reportDir: null,
    day: null,
    log: null,
    cadenceFile: null,
    clerkStampsFile: null,
    registrarLog: null,
    journalDeclarationsFile: null,
    deploymentFactsFile: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--store") args.store = argv[++i] ?? null;
    else if (a === "--outbox") args.outbox = argv[++i] ?? null;
    else if (a === "--report-dir") args.reportDir = argv[++i] ?? null;
    else if (a === "--day") args.day = argv[++i] ?? null;
    else if (a === "--log") args.log = argv[++i] ?? null;
    else if (a === "--cadence-file") args.cadenceFile = argv[++i] ?? null;
    else if (a === "--clerk-stamps-file") args.clerkStampsFile = argv[++i] ?? null;
    else if (a === "--registrar-log") args.registrarLog = argv[++i] ?? null;
    else if (a === "--journal-declarations") args.journalDeclarationsFile = argv[++i] ?? null;
    else if (a === "--deployment-facts") args.deploymentFactsFile = argv[++i] ?? null;
  }
  return args;
}

/** Every flag this program understands. The unit's ExecStart is checked against it. */
export const KNOWN_FLAGS: readonly string[] = [
  "--store",
  "--outbox",
  "--report-dir",
  "--day",
  "--log",
  "--cadence-file",
  "--clerk-stamps-file",
  "--registrar-log",
  "--journal-declarations",
  "--deployment-facts",
];

/**
 * The Eng baseline observable, read best-effort. WARN-NEVER-STOP: whatever
 * happens here, it must never change this program's exit code or keep the
 * witness report from being written — that report is about the witness
 * store, which this function never touches.
 *
 * `MicaLogFile`'s own `load()` does not throw (see its header) — every
 * failure it can hit becomes a load state instead. This function does not
 * lean on that promise blind: the construction and the statistic are both
 * wrapped, because a line that must never stop the report earns the
 * belt-and-suspenders the rest of this program's required paths do not need.
 */
export function readEngObservable(logPath: string | null): EngObservableReading {
  if (logPath === null) {
    return {
      attempted: false,
      logPath: null,
      loadState: null,
      recordCount: null,
      mutualInformation: null,
      ami: null,
      expectedMutualInformation: null,
      entropyClass: null,
      entropyOutcome: null,
      distinctClasses: null,
      distinctOutcomes: null,
      note: "NOT ATTEMPTED — no --log was supplied to this run.",
    };
  }
  try {
    const log = new MicaLogFile({ path: logPath });
    const loadState = log.getLoadState();
    if (loadState !== LOADED_UNVERIFIED_FILE) {
      return {
        attempted: true,
        logPath,
        loadState,
        recordCount: log.length,
        mutualInformation: null,
        ami: null,
        expectedMutualInformation: null,
        entropyClass: null,
        entropyOutcome: null,
        distinctClasses: null,
        distinctOutcomes: null,
        note: `NOT COMPUTED — ${log.describe()}`,
      };
    }
    const entries = log.getAll();
    const structure = engStructure(entries);
    return {
      attempted: true,
      logPath,
      loadState,
      recordCount: entries.length,
      mutualInformation: structure.mutualInformation,
      ami: structure.ami,
      expectedMutualInformation: structure.expectedMutualInformation,
      entropyClass: structure.entropyClass,
      entropyOutcome: structure.entropyOutcome,
      distinctClasses: structure.distinctClasses,
      distinctOutcomes: structure.distinctOutcomes,
      note:
        "COMPUTED — record-only: no threshold was compared and no verdict is implied.",
    };
  } catch (err) {
    // Not expected — MicaLogFile's own construction is best-effort by design
    // — but this line's one rule is that it never takes the report down with
    // it, so the possibility is caught rather than assumed away.
    return {
      attempted: true,
      logPath,
      loadState: null,
      recordCount: null,
      mutualInformation: null,
      ami: null,
      expectedMutualInformation: null,
      entropyClass: null,
      entropyOutcome: null,
      distinctClasses: null,
      distinctOutcomes: null,
      note: `NOT COMPUTED — reading ${logPath} threw: ${String(err)}.`,
    };
  }
}

/** Which required paths were not supplied. Empty means the invocation stands. */
export function missingRequired(args: Args): string[] {
  const missing: string[] = [];
  if (args.store === null) missing.push("--store");
  if (args.outbox === null) missing.push("--outbox");
  if (args.reportDir === null) missing.push("--report-dir");
  return missing;
}

export function recordFileName(day: string): string {
  return `witness-report-${day}.jsonl`;
}

export function reportFileName(day: string): string {
  return `witness-report-${day}.md`;
}

export interface Outcome {
  readonly code: number;
  /** Where the report went, or would have gone. Null before the day is known. */
  readonly path: string | null;
  readonly messages: readonly string[];
  /** The rendered text, when one was rendered. Written or not. */
  readonly text: string | null;
}

/**
 * The whole run, with the clock injected and no `process.exit` anywhere.
 *
 * The clock is a parameter for the reason the witness's is: a body that reads
 * `Date.now()` in the middle of itself cannot be shown to produce the same
 * report twice from the same store.
 */
export function produceReport(args: Args, nowMs: number): Outcome {
  const missing = missingRequired(args);
  if (missing.length > 0) {
    return {
      code: EXIT.CANNOT_START,
      path: null,
      text: null,
      messages: [
        `mica-report has NO DEFAULT PATHS. Not supplied: ${missing.join(", ")}. ` +
          `Every path this program touches is a deployment decision and none of ` +
          `them is guessed here.`,
      ],
    };
  }
  const storePath = args.store as string;
  const outboxDir = args.outbox as string;
  const reportDir = args.reportDir as string;

  // The window's provenance is carried, not assumed away. The DEFAULT stays —
  // deploy/mica-report.service passes no --day on purpose and the timer means
  // "yesterday" — but it is no longer SILENT: every artifact this run writes
  // says on its face whether an operator named the day or this host's clock
  // did (the arbiter's ruling, S104).
  const dayProvenance: DayProvenance = args.day === null ? "COMPUTED" : "DECLARED";
  const day = args.day ?? previousLocalDay(nowMs);
  const window = windowForDay(day);
  if (window === null) {
    return {
      code: EXIT.CANNOT_START,
      path: null,
      text: null,
      messages: [
        `--day ${JSON.stringify(day)} is not a calendar date of the form ` +
          `YYYY-MM-DD. No report was produced.`,
      ],
    };
  }
  const path = join(reportDir, reportFileName(day));

  // ── the deployment act, checked BEFORE the book is opened ─────────────────
  //
  //   Checked first so a missing directory costs one `stat` rather than a full
  //   fold thrown away at the last line, and so the message names the act
  //   rather than the syscall.
  try {
    const stats = statSync(reportDir);
    if (!stats.isDirectory()) {
      return {
        code: EXIT.REPORT_DIR,
        path,
        text: null,
        messages: [
          `the report directory ${reportDir} exists and is NOT A DIRECTORY. ` +
            `Nothing was read and nothing was written.`,
        ],
      };
    }
  } catch (error) {
    return {
      code: EXIT.REPORT_DIR,
      path,
      text: null,
      messages: [
        `THE REPORT DIRECTORY IS NOT THERE: ${reportDir}`,
        String(error),
        `This program does not create it. A directory another principal must ` +
          `reach is a deployment act; one conjured here would land at this ` +
          `process's umask with this process's primary group, and every report ` +
          `would sit where the entitled readers cannot open it. Create it, with ` +
          `its ownership and its setgid bit, and run again.`,
      ],
    };
  }

  let raw: string;
  try {
    raw = readFileSync(storePath, "utf8");
  } catch (error) {
    return {
      code: EXIT.STORE_UNREADABLE,
      path,
      text: null,
      messages: [
        `THE WITNESS STORE COULD NOT BE READ: ${storePath}`,
        String(error),
        `NO REPORT WAS WRITTEN. A report of zeros folded from a book this ` +
          `process never opened would read exactly like a quiet day, and telling ` +
          `those two apart is what this program is for.`,
      ],
    };
  }

  const read = readStoreText(raw);
  const outbox = readOutbox(outboxDir);
  const fold = foldDay(read, window);
  const symmetry = checkSymmetry(fold, read, outbox);
  // WARN-NEVER-STOP: read after the store's own required paths are already
  // known good, so a --log problem never costs a report the store earned.
  const engObservable = readEngObservable(args.log ?? null);
  // Same discipline, DC-2: `loadCadenceDeclaration` never throws (mirrors
  // `witnessd.ts`'s `loadDeclared`), and the comparison itself
  // (`assessStaleness`) is pure arithmetic over `fold.chainsLastSeen` plus
  // the declaration — nothing here can cost the report the store earned.
  const cadenceDeclaration = loadCadenceDeclaration(args.cadenceFile ?? null);
  const staleness: StalenessReading = assessStaleness(
    cadenceDeclaration,
    fold.chainsLastSeen,
    nowMs
  );
  // Same discipline: `readClerkCallerAttestation` never throws (mirrors
  // `loadCadenceDeclaration` / `loadDeclared`), so a --clerk-stamps-file
  // problem never costs the report the store earned.
  const callerReading: ClerkCallerReading = readClerkCallerAttestation(
    args.clerkStampsFile ?? null
  );
  // S110-B: same discipline — assessJournalBookReconciliation and
  // assessStampShapeReconciliation never throw, so a --registrar-log or
  // --clerk-stamps-file problem never costs the report the store earned.
  const journalBookReconciliation = assessJournalBookReconciliation(
    args.registrarLog ?? null,
    args.log ?? null
  );
  const stampShapeReconciliation = assessStampShapeReconciliation(
    args.clerkStampsFile ?? null
  );
  // S111, generalized: loadJournalDeclarations never throws (same discipline
  // as loadCadenceDeclaration), so an absent or unusable --journal-declarations
  // file never costs the report the store earned — the per-principal family
  // reads CANNOT_ASSESS and nothing else.
  const journalDeclaration = loadJournalDeclarations(args.journalDeclarationsFile ?? null);
  const principalJournalReconciliations = assessDeclaredJournalReconciliations(
    journalDeclaration,
    args.log ?? null,
    args.registrarLog ?? null
  );
  // S112, DF: loadDeploymentFactsDeclaration and assessDeploymentFacts never
  // throw (same discipline as loadCadenceDeclaration), so a --deployment-facts
  // problem never costs the report the store earned — §3.7 reads
  // CANNOT_ASSESS and nothing else.
  const deploymentFactsDeclaration = loadDeploymentFactsDeclaration(args.deploymentFactsFile ?? null);
  const deploymentFacts = assessDeploymentFacts(deploymentFactsDeclaration);
  const text = renderReport({
    fold,
    read,
    outbox,
    symmetry,
    storePath,
    outboxDir,
    engObservable,
    staleness,
    callerReading,
    journalBookReconciliation,
    stampShapeReconciliation,
    journalDeclaration,
    principalJournalReconciliations,
    deploymentFacts,
    nowMs,
    dayProvenance,
  });

  try {
    // `wx` refuses to overwrite. A report already written is a thing somebody
    // may have read; this program does not silently replace one. Mode 0640 is
    // the store's own digit — the writer writes, `mica-readers` reads. The
    // FILE's group comes from the directory's setgid bit, which is why §5.5
    // asks for `2750` and not `0750`.
    writeFileSync(path, text, { encoding: "utf8", flag: "wx", mode: 0o640 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return {
        code: EXIT.ALREADY_WRITTEN,
        path,
        text,
        messages: [
          `A REPORT FOR ${day} IS ALREADY THERE: ${path}`,
          `Nothing was overwritten and nothing was compared. Move or remove that ` +
            `file if you want this run's fold instead.`,
        ],
      };
    }
    return {
      code: EXIT.REPORT_DIR,
      path,
      text,
      messages: [
        `THE REPORT COULD NOT BE WRITTEN: ${path}`,
        String(error),
      ],
    };
  }

  // ── the machine-readable half ─────────────────────────────────────────────
  //
  //   Written AFTER the prose and only when the prose landed, so the pair is
  //   never half-present: a record file beside no report would invite a consumer
  //   to believe a fold happened that nobody can read the account of. Same `wx`,
  //   same mode, same day in the name.
  //
  //   ITS FAILURE DOES NOT ERASE THE REPORT. The prose is already on disk and a
  //   human can read the day; this returns the reading-refused code and SAYS the
  //   record is missing, rather than pretending the run was clean or deleting a
  //   report somebody may already have opened.
  const recordPath = join(reportDir, recordFileName(day));
  const recordText = renderRecordsJsonl(
    reportRecords({
      fold,
      read,
      outbox,
      symmetry,
      storePath,
      outboxDir,
      engObservable,
      staleness,
      callerReading,
      journalBookReconciliation,
      stampShapeReconciliation,
      journalDeclaration,
      principalJournalReconciliations,
      deploymentFacts,
      nowMs,
      dayProvenance,
    })
  );
  try {
    writeFileSync(recordPath, recordText, { encoding: "utf8", flag: "wx", mode: 0o640 });
  } catch (error) {
    return {
      code: EXIT.WRITTEN_WITH_A_READING_REFUSED,
      path,
      text,
      messages: [
        `report written: ${path}`,
        `THE MACHINE-READABLE RECORD WAS NOT WRITTEN: ${recordPath}`,
        String(error),
        `The prose report above is on disk and complete. A consumer reading the ` +
          `records for this day will not find them.`,
      ],
    };
  }

  if (outbox.state === "READ_FAILED") {
    return {
      code: EXIT.WRITTEN_WITH_A_READING_REFUSED,
      path,
      text,
      messages: [
        `report written: ${path}`,
        `records written: ${recordPath}`,
        `THE OUTBOX WOULD NOT LIST: ${outboxDir}`,
        outbox.reason,
        `Receipt symmetry was NOT checked. The report says so where the check ` +
          `would have been. An outbox that cannot be listed is not an empty one.`,
      ],
    };
  }
  return {
    code: EXIT.WRITTEN,
    path,
    text,
    messages: [`report written: ${path}`, `records written: ${recordPath}`],
  };
}

function main(argv: readonly string[]): void {
  const outcome = produceReport(parseArgs(argv), Date.now());
  const stream = outcome.code === EXIT.WRITTEN ? console.log : console.error;
  for (const message of outcome.messages) stream(message);
  process.exit(outcome.code);
}

if (require.main === module) {
  main(process.argv.slice(2));
}
