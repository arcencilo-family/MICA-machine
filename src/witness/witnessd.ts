#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// MICA — the S-4 WITNESS DAEMON. A SEPARATE OS PROCESS. THE INVOKER.
//
//   npx ts-node src/witness/witnessd.ts \
//     --store <file> --intake <dir> --outbox <dir> --witness-set-id <id> \
//     [--key <file>] [--declared <file>] [--tick-ms 1000] [--once]
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
//
//   `Witness.pollIntake()` was called by exactly one caller in this repository:
//   `witness.test.ts`. The consumer end of the channel was built, tested, and
//   never invoked by anything a deployment could start. This is the invoker.
//
// ── THIS PROCESS ANSWERS NO READS ────────────────────────────────────────────
//
//   Ruled S85 and it is a hard bound on this file: the witness has NO READER,
//   EVER. There is no socket here, no listener, no HTTP, no op that returns
//   store content to a caller. The four entitled roles read the raw store FILE,
//   out of band, without this process and without the observed node. A read
//   interface would be a second thing to compromise for the same evidence, and
//   the evidence is a text file.
//
// ── IT DOES NOT CATCH AND CONTINUE ───────────────────────────────────────────
//
//   A tick that swallowed an append failure would be the silently-swallowed
//   lock-contention failure wearing a daemon: submissions consumed off the
//   intake, nothing retained, and a process that looks alive. So any throw out
//   of the sweep PRINTS the error and the store path and EXITS NON-ZERO. A
//   witness that cannot append cannot witness.
//
//   Nothing is lost by exiting. `pollIntake` reads, appends, and only THEN
//   removes the drop: an append that throws leaves the drop file on disk, and
//   the submitter still holds its own head regardless.
//
//   Whether anything restarts this process is a DEPLOYMENT choice (a systemd
//   `Restart=` line), not a policy this file holds. It holds no timers of its
//   own beyond the sweep cadence it was handed.
//
// ── EXIT CODES ───────────────────────────────────────────────────────────────
//
//   0  a `--once` sweep completed, or a signal stopped the daemon cleanly
//   1  it could not start: a required path was not supplied, or the store
//      would not load appendably
//   3  a sweep threw while running. Something was NOT retained, and the drop
//      that was being handled is still on disk.
// ──────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "fs";

import {
  INDEPENDENCE_IS_A_DEPLOYMENT_FACT,
  WITNESS_CERTIFIES_NOTHING,
  WITNESS_READS,
  WITNESS_TITLE,
  Witness,
} from "./witness";
import type { WitnessOptions, WitnessSubmissionResult } from "./types";
import { vintageBannerText } from "../deploy/vintage";

/** The one sentence this instrument is allowed to say. */
export const WITNESSD_SAYS_ONE_THING =
  "A head was presented at my intake and I retained a record of its arrival — or I " +
  "retained a record that something arrived which I was not permitted to read. I certify " +
  "nothing about any chain, any submitter, or my own independence, and I answer no reads.";

export const WITNESSD_ANSWERS_NO_READS =
  "THIS PROCESS ANSWERS NO READS. It serves no socket and exposes no read op. The " +
  "store is a file; the entitled roles read that file without this process and " +
  "without the observed node.";

export interface Args {
  /** No defaults for paths. The source has none and this keeps it so. */
  store: string | null;
  key: string | null;
  intake: string | null;
  outbox: string | null;
  witnessSetId: string | null;
  /** Path to the DEPLOYER-SUPPLIED declared-submitter list. No built-in entry. */
  declared: string | null;
  tickMs: number;
  once: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    store: null,
    key: null,
    intake: null,
    outbox: null,
    witnessSetId: null,
    declared: null,
    tickMs: 1000,
    once: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--store") args.store = argv[++i] ?? null;
    else if (a === "--key") args.key = argv[++i] ?? null;
    else if (a === "--intake") args.intake = argv[++i] ?? null;
    else if (a === "--outbox") args.outbox = argv[++i] ?? null;
    else if (a === "--witness-set-id") args.witnessSetId = argv[++i] ?? null;
    else if (a === "--declared") args.declared = argv[++i] ?? null;
    else if (a === "--tick-ms") args.tickMs = Number(argv[++i]);
    else if (a === "--once") args.once = true;
  }
  if (!Number.isFinite(args.tickMs) || args.tickMs <= 0) args.tickMs = 1000;
  return args;
}

/** Which required paths were not supplied. Empty means the invocation stands. */
export function missingRequired(args: Args): string[] {
  const missing: string[] = [];
  if (args.store === null) missing.push("--store");
  if (args.intake === null) missing.push("--intake");
  if (args.outbox === null) missing.push("--outbox");
  if (args.witnessSetId === null) missing.push("--witness-set-id");
  return missing;
}

// ── the declared-submitter list ──────────────────────────────────────────────
//
// The clerk roster's distinction, kept exactly: ABSENT (nobody asked for a
// declared list) must not read the same as CONFIGURED_EMPTY (a deployment asked
// and did not get one). Both mean every submission retains as
// UNDECLARED_SUBMITTER — which is a RECORD, not a rejection. Nothing is lost
// either way, and the banner says which happened.

export interface DeclaredSubmitters {
  readonly state: "ABSENT" | "CONFIGURED" | "CONFIGURED_EMPTY";
  readonly source: string;
  readonly ids: readonly string[];
  readonly problems: readonly string[];
}

export function loadDeclared(path: string | null): DeclaredSubmitters {
  if (path === null) {
    return { state: "ABSENT", source: "none", ids: [], problems: [] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      state: "CONFIGURED_EMPTY",
      source: path,
      ids: [],
      problems: [
        `declared-submitter file ${path} could not be read as JSON: ` +
          `${String(error)}. A configured-but-unreadable list is CONFIGURED_EMPTY, ` +
          `never ABSENT: the deployment asked and did not get it.`,
      ],
    };
  }
  if (!Array.isArray(raw)) {
    return {
      state: "CONFIGURED_EMPTY",
      source: path,
      ids: [],
      problems: [`declared-submitter file ${path} is not a JSON array of ids`],
    };
  }
  const problems: string[] = [];
  const ids: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length === 0) {
      problems.push(`entry ${JSON.stringify(entry)} is not a non-empty string; skipped`);
      continue;
    }
    ids.push(entry);
  }
  return {
    state: ids.length === 0 ? "CONFIGURED_EMPTY" : "CONFIGURED",
    source: path,
    ids,
    problems,
  };
}

// ── the running witness ──────────────────────────────────────────────────────

export interface RunningWitness {
  readonly witness: Witness;
  readonly storePath: string;
  readonly intakeDir: string;
  readonly outboxDir: string;
  readonly keyPath: string | null;
  readonly witnessSetId: string;
  readonly declared: DeclaredSubmitters;
  /** One sweep of the intake. Throws if the append path throws; it must. */
  readonly sweep: () => readonly WitnessSubmissionResult[];
}

/**
 * Construct the witness. ONE `Witness` per process, and therefore exactly one
 * PLACEMENT record per start — a restart is a fact worth a record, and two
 * constructions on one store would be two.
 *
 * `overrides` is the fault-injection seam the class already carries (appender,
 * lock acquirer, placement runtime, clock). Production passes nothing; there is
 * no command-line flag for any of it and there must not be.
 */
export function startWitnessDaemon(
  args: Args,
  overrides: Partial<WitnessOptions> = {}
): RunningWitness {
  const missing = missingRequired(args);
  if (missing.length > 0) {
    throw new Error(
      `witnessd has NO DEFAULT PATHS. Not supplied: ${missing.join(", ")}. ` +
        `Every path this process touches is a deployment decision and none of ` +
        `them is guessed here.`
    );
  }
  const declared = loadDeclared(args.declared);
  const options: WitnessOptions = {
    witnessSetId: args.witnessSetId as string,
    storePath: args.store as string,
    outboxDir: args.outbox as string,
    keyPath: args.key ?? undefined,
    declaredSubmitters: declared.ids,
    intakeDir: args.intake as string,
    ...overrides,
  };
  const witness = new Witness(options);
  return {
    witness,
    storePath: options.storePath,
    intakeDir: args.intake as string,
    outboxDir: options.outboxDir,
    keyPath: args.key,
    witnessSetId: options.witnessSetId,
    declared,
    sweep: () => witness.pollIntake(),
  };
}

const BAR = "─".repeat(76);

export function printBanner(running: RunningWitness, args: Args): void {
  console.log(`┌${BAR}`);
  console.log(`│ MICA S-4 WITNESS DAEMON — a retainer, not a sensor.`);
  console.log(`├${BAR}`);
  console.log(`│ ${WITNESS_TITLE}`);
  console.log(`│ ${WITNESS_READS}`);
  console.log(`│ ${WITNESS_CERTIFIES_NOTHING}`);
  console.log(`│ ${INDEPENDENCE_IS_A_DEPLOYMENT_FACT}`);
  console.log(`├${BAR}`);
  // THE LAY IS NOT THE RUN (S105 §2.1). This line is the only place a reader
  // learns which code this process is executing rather than which code is on
  // disk right now — see ../deploy/vintage.
  console.log(`│ code vintage   : ${vintageBannerText()}`);
  console.log(`│ witness_set_id : ${running.witnessSetId}`);
  console.log(`│ store          : ${running.storePath}`);
  console.log(`│ load state     : ${running.witness.getLoadState()}`);
  console.log(`│ intake         : ${running.intakeDir}`);
  console.log(`│ outbox         : ${running.outboxDir}`);
  console.log(
    `│ signing key    : ${
      running.keyPath === null
        ? "NOT SUPPLIED — every HEAD_COMMIT retains, and each is followed by a " +
          "KEY_UNAVAILABLE record. No receipt is written."
        : running.keyPath
    }`
  );
  console.log(
    `│ declared       : ${running.declared.state} ` +
      `(${running.declared.ids.length} submitter(s), source: ${running.declared.source})`
  );
  if (running.declared.state !== "CONFIGURED") {
    console.log(`│   !! NO DECLARED SUBMITTER IS ON FILE. EVERY SUBMISSION WILL RETAIN AS`);
    console.log(`│      UNDECLARED_SUBMITTER, and no receipt will be signed for any of them.`);
    console.log(`│      Nothing is rejected and nothing is lost — the witness adjudicates`);
    console.log(`│      nothing — but no submission here is a DECLARED one.`);
  }
  for (const problem of running.declared.problems) {
    console.log(`│   declared problem: ${problem}`);
  }
  console.log(`│ mode           : ${args.once ? "--once (single sweep, then exit 0)" : `daemon, tick ${args.tickMs}ms`}`);
  console.log(`├${BAR}`);
  console.log(`│ ${WITNESSD_ANSWERS_NO_READS}`);
  console.log(`├${BAR}`);
  console.log(`│ ${WITNESSD_SAYS_ONE_THING}`);
  console.log(`└${BAR}`);
}

/** Counts by kind, in the order the sweep retained them. Counts only. */
export function summariseSweep(results: readonly WitnessSubmissionResult[]): string {
  if (results.length === 0) return "0 drops consumed";
  const byKind = new Map<string, number>();
  for (const result of results) {
    byKind.set(result.record.kind, (byKind.get(result.record.kind) ?? 0) + 1);
  }
  const parts = [...byKind.entries()].sort().map(([k, n]) => `${k}=${n}`);
  return `${results.length} drop(s) consumed — ${parts.join(" ")}`;
}

export function printAppendFailure(running: RunningWitness, error: unknown): void {
  console.error(`┌${BAR}`);
  console.error(`│ WITNESSD IS STOPPING. A SWEEP THREW AND NOTHING IS BEING SWALLOWED.`);
  console.error(`├${BAR}`);
  console.error(`│ store : ${running.storePath}`);
  console.error(`│ intake: ${running.intakeDir}`);
  console.error(`│ error : ${String(error)}`);
  console.error(`├${BAR}`);
  console.error(`│ The witness reads a drop, appends, and only THEN removes it. An append`);
  console.error(`│ that threw leaves that drop file on the intake: nothing was consumed`);
  console.error(`│ unrecorded. A witness that cannot append cannot witness, so this`);
  console.error(`│ process exits rather than run on looking alive.`);
  console.error(`└${BAR}`);
}

/**
 * ONE sweep, and the whole of the not-catch-and-continue rule.
 *
 * `onFailure` is wired by the entry point to print and exit non-zero. It is a
 * parameter rather than a `process.exit` in here so this body can be run — and
 * therefore proven not to swallow — without spawning a process or waiting on a
 * timer. What it must NEVER become is a `catch {}` that lets the next tick try
 * again: that is drops consumed off the intake, nothing retained, and a process
 * that looks alive.
 */
export function sweepOrFail(
  running: RunningWitness,
  onFailure: (error: unknown) => void
): void {
  let results: readonly WitnessSubmissionResult[];
  try {
    results = running.sweep();
  } catch (error) {
    onFailure(error);
    return;
  }
  if (results.length > 0) console.log(summariseSweep(results));
}

/**
 * Start the sweep timer. Returns the stop handle. `onFailure` is called with the
 * throw and is expected NOT to return — the caller exits the process there.
 */
export function startTicking(
  running: RunningWitness,
  tickMs: number,
  onFailure: (error: unknown) => void
): () => void {
  const tick = setInterval(() => sweepOrFail(running, onFailure), tickMs);
  return () => clearInterval(tick);
}

function main(args: Args): void {
  let running: RunningWitness;
  try {
    running = startWitnessDaemon(args);
  } catch (error) {
    console.error(`witnessd failed to start: ${String(error)}`);
    process.exit(1);
    return;
  }
  printBanner(running, args);

  if (args.once) {
    try {
      console.log(summariseSweep(running.sweep()));
    } catch (error) {
      printAppendFailure(running, error);
      process.exit(3);
      return;
    }
    process.exit(0);
    return;
  }

  const stop = startTicking(running, args.tickMs, (error) => {
    printAppendFailure(running, error);
    process.exit(3);
  });
  console.log(`WITNESSD_READY ${running.storePath}`);
  if (typeof process.send === "function") {
    process.send({
      type: "witnessd-ready",
      storePath: running.storePath,
      intakeDir: running.intakeDir,
      loadState: running.witness.getLoadState(),
      declared: running.declared.state,
    });
  }
  const shutdown = (): void => {
    stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("message", (m: unknown) => {
    if (
      typeof m === "object" &&
      m !== null &&
      (m as { type?: unknown }).type === "witnessd-stop"
    ) {
      shutdown();
    }
  });
}

if (require.main === module) {
  main(parseArgs(process.argv.slice(2)));
}
