// ── MICA · the ingestion driver — the first caller that writes DECLARED readings
//    into a durable evidence log, with provenance on every one ────────────────
//
// House dialect: standalone ts-node CLI, `main(argv)` returning an exit code.
//   npx ts-node src/probe/ingest-cli.ts --declaration ... --write
//
// THE ONE SENTENCE THIS TOOL MAY SAY: these records were appended through
// `EvidenceLogStore`, and each one names the subject, the slice and the basis
// its caller DECLARED. It grades nothing, it certifies nothing, and it does not
// make a human's reading of a transcript into an observation of a system.
//
// ── WHY A CLI AND NOT `ts-node -e` (S121) ───────────────────────────────────
//
//   S120 rehearsed the same 24 readings through `deliverAndRecord` with an
//   inline `-e` script against an IN-MEMORY store. That was the right shape for
//   a rehearsal and is the wrong shape for the real append: the script is not on
//   disk, so it is not in the suite, not in the vintage, not reviewable, and not
//   repeatable by anyone who was not in that session. The act that writes the
//   pilot's evidence has to be a file somebody can read before it runs and diff
//   after it ran.
//
// ── WHAT IT REFUSES, AND WHY EACH REFUSAL IS WHERE IT IS ────────────────────
//
//   1 · THE DECLARATION'S SHA, BEFORE ANY PORT EXISTS. The live declaration is
//       `640 mica-arbiter:mica-readers` and the principal that runs this driver
//       (`mica-subject1`, ruled P2/S121) is NOT in `mica-readers`. So it is
//       handed a COPY, through `/tmp`, and a copy is only the declaration if its
//       bytes hash to the sha the operator names on the command line. The check
//       runs BEFORE `DeclaredSubjectPort` is constructed, because a port built
//       over the wrong file has already read it. THE DRIVER NEVER DERIVES TRUST
//       FROM THE PATH IT WAS GIVEN — the path says where, the sha says what.
//
//   2 · NOTHING IS DEFAULTED. No default log directory, no default run id, no
//       default timestamp, no default scenario list. A default path is a place
//       evidence can land that nobody chose, and a default clock is this layer
//       inventing a fact. Every one of them is a missing-argument refusal that
//       names the argument.
//
//   3 · THE FIRST NON-`RECORDED` RESULT STOPS THE RUN. `deliverAndRecord`'s
//       three states are three different facts (see `RecordedDelivery`), and
//       only `RECORDED` is one a grader may read from. A driver that continued
//       past `ATTEMPT_NOT_RECORDED` would be delivering to a subject whose
//       attempt is not in the chain — the exact gate that function exists to
//       hold, defeated one layer up.
//
// ── THE LOG'S NAME IS COMPOSED, NOT TYPED (§0, ruled S121) ──────────────────
//
//   `<log-dir>/evidence_<subjectId>_<runId>.jsonl`. The `subjectId` is READ out
//   of the subject declaration and never typed by the operator, so the file
//   cannot come to be named for a subject other than the one whose declaration
//   this run is ingesting. One file per run, one chain per file: a re-run after
//   any harness change takes a NEW `--run-id` and therefore a new file, and
//   never appends into the old chain.
//
// EXIT CODES
//   0  the run did what was asked (a `--dry` plan printed, or 24 appended)
//   1  DEPLOYMENT: the evidence directory is not there, the store cannot
//      persist, the log cannot be read
//   2  USAGE: a missing, duplicated or unreadable argument. Nothing was opened.
//   3  REFUSED: the sha did not match, a port refused a declaration, a delivery
//      came back in a state that is not `RECORDED`

import { createHash } from "crypto";
import { closeSync, existsSync, openSync, readFileSync, statSync } from "fs";
import { join } from "path";

import { deliverAndRecord, deliveryModeForAxis, type RecordedDelivery } from "./delivery";
import { EvidenceLogStore } from "./evidence-store";
import type { AttemptProvenance, AttemptRecord } from "./evidence-log";
import { N5_FAMILY } from "./families/n5";
import { DEFAULT_DELIVERY_SEAT, type ScenarioDefinition } from "./scenario";
import { loadScenariosForRole } from "./scenario-seal";
import { DeclaredSubjectPort } from "./subject/declared-subject-port";
import { CEILING_SENTENCE, loadSubjectDeclaration } from "./subject/subject-declaration";
import { VARIANTS, type Variant } from "./subject/variant";

export const INGEST_CLI_EXIT = { OK: 0, DEPLOYMENT: 1, USAGE: 2, REFUSED: 3 } as const;

class IngestUsage extends Error {}
class IngestRefused extends Error {}

/**
 * The family this pilot ingests, and naming a scenario outside it is a refusal
 * rather than a widening — the same sentence, and the same single map, that
 * `subject/ollama-runner.ts` holds on the sending side. The driver ingests what
 * the runner sent; if the runner's families grow, this list is the visible edit
 * that lets the driver follow.
 */
const INGESTIBLE: readonly ScenarioDefinition[] = N5_FAMILY;

const USAGE =
  "usage: ingest-cli.ts --declaration <path> --declaration-sha256 <hex> " +
  "--captures <path> --subject-declaration <path> --log-dir <dir> --run-id <label> " +
  "--scenarios <id,id,...> --variants <CONTROL,STRESS> --seeds <1,2,3> --at <ms> " +
  "[--dry | --write]  (--dry is the default; nothing is defaulted but the dry-run)";

export interface IngestOptions {
  readonly declaration: string;
  readonly declarationSha256: string;
  readonly captures: string;
  readonly subjectDeclaration: string;
  readonly logDir: string;
  readonly runId: string;
  readonly scenarios: readonly string[];
  readonly variants: readonly Variant[];
  readonly seeds: readonly number[];
  readonly atMs: number;
  readonly write: boolean;
}

const VALUE_FLAGS = [
  "declaration",
  "declaration-sha256",
  "captures",
  "subject-declaration",
  "log-dir",
  "run-id",
  "scenarios",
  "variants",
  "seeds",
  "at",
] as const;
const BOOLEAN_FLAGS = ["dry", "write"] as const;

export function parseOptions(argv: readonly string[]): IngestOptions {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new IngestUsage(`unexpected argument ${JSON.stringify(token)}. ${USAGE}`);
    const key = token.slice(2);
    if ((BOOLEAN_FLAGS as readonly string[]).includes(key)) {
      if (booleans.has(key)) throw new IngestUsage(`duplicate --${key}`);
      booleans.add(key);
      continue;
    }
    if (!(VALUE_FLAGS as readonly string[]).includes(key)) {
      throw new IngestUsage(`unknown option ${token}. ${USAGE}`);
    }
    if (values.has(key)) throw new IngestUsage(`duplicate --${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new IngestUsage(`--${key} needs a value`);
    values.set(key, value);
    i++;
  }
  // THE ARGUMENT IS NAMED, NEVER A PATH THIS TOOL PICKED. See header note 2.
  const need = (key: string): string => {
    const value = values.get(key);
    if (value === undefined) {
      throw new IngestUsage(
        `missing required argument --${key}; this tool has no default for it and will not invent one`
      );
    }
    if (value.trim().length === 0) throw new IngestUsage(`--${key} must not be empty`);
    return value;
  };
  const list = (key: string): readonly string[] => {
    const items = need(key).split(",").map((s) => s.trim());
    if (items.some((s) => s.length === 0)) throw new IngestUsage(`--${key} has an empty entry`);
    if (new Set(items).size !== items.length) throw new IngestUsage(`--${key} repeats an entry`);
    return items;
  };

  if (booleans.has("dry") && booleans.has("write")) {
    throw new IngestUsage("--dry and --write are the same choice made twice; name one");
  }

  const sha = need("declaration-sha256").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha)) {
    throw new IngestUsage("--declaration-sha256 must be 64 hex characters");
  }
  const variants = list("variants");
  for (const v of variants) {
    if (!(VARIANTS as readonly string[]).includes(v)) {
      throw new IngestUsage(`--variants: ${JSON.stringify(v)} is not one of ${VARIANTS.join(", ")}`);
    }
  }
  const seeds = list("seeds").map((raw) => {
    const seed = Number(raw);
    if (!Number.isSafeInteger(seed)) throw new IngestUsage(`--seeds: ${JSON.stringify(raw)} is not an integer`);
    return seed;
  });
  const atMs = Number(need("at"));
  if (!Number.isSafeInteger(atMs) || atMs < 0) {
    throw new IngestUsage("--at must be a non-negative safe integer (milliseconds); this tool calls no clock");
  }
  const runId = need("run-id");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) {
    // The run id becomes part of a FILE NAME. A separator or a leading dot in it
    // would compose a path somewhere other than the directory that was named.
    throw new IngestUsage(
      "--run-id must be alphanumerics, dot, dash or underscore, starting with an alphanumeric — it becomes part of the log's file name"
    );
  }
  return {
    declaration: need("declaration"),
    declarationSha256: sha,
    captures: need("captures"),
    subjectDeclaration: need("subject-declaration"),
    logDir: need("log-dir"),
    runId,
    scenarios: list("scenarios"),
    variants: variants as readonly Variant[],
    seeds,
    atMs,
    write: booleans.has("write"),
  };
}

/** `<dir>/evidence_<subjectId>_<runId>.jsonl` — §0, ruled S121. */
export function composeLogPath(logDir: string, subjectId: string, runId: string): string {
  return join(logDir, `evidence_${subjectId}_${runId}.jsonl`);
}

/**
 * The refusal that has to happen before anything else. The bytes are hashed;
 * the path is not trusted. Both shas are named in the message, because "sha
 * mismatch" without the two numbers is a claim the reader cannot check.
 */
export function verifyDeclarationSha(
  path: string,
  expected: string
): { readonly sha256: string; readonly bytes: number } {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (err) {
    throw new IngestRefused(
      `cannot read the declaration at ${path}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new IngestRefused(
      `the declaration at ${path} is not the declaration this run was authorised for. ` +
        `expected sha256 ${expected}, read sha256 ${actual} (${String(bytes.length)} bytes). ` +
        `Nothing was constructed and nothing was appended.`
    );
  }
  // The size is taken from the SAME bytes the digest was taken from, not from a
  // second `statSync` — a report whose two halves came from two reads is a
  // report about no single file.
  return { sha256: actual, bytes: bytes.length };
}

function resolveScenarios(ids: readonly string[]): readonly ScenarioDefinition[] {
  const byId = new Map(INGESTIBLE.map((s) => [s.id, s]));
  const resolved: ScenarioDefinition[] = [];
  for (const id of ids) {
    const scenario = byId.get(id);
    if (scenario === undefined) {
      throw new IngestUsage(
        `--scenarios names ${JSON.stringify(id)}, which this driver does not ingest. ` +
          `Ingestible: ${[...byId.keys()].join(", ")}`
      );
    }
    resolved.push(scenario);
  }
  // The runner passed its selection through this same gate before sending. A
  // role-mixed list is refused here rather than silently filtered.
  return loadScenariosForRole("STANDARD", resolved);
}

function sliceKey(variant: Variant, seed: number): string {
  return `${variant}/${String(seed)}`;
}

export function main(argv: readonly string[], out: (s: string) => void = console.log): number {
  let o: IngestOptions;
  try {
    o = parseOptions(argv);
  } catch (err) {
    console.error(err instanceof IngestUsage ? err.message : "usage could not be read");
    return INGEST_CLI_EXIT.USAGE;
  }

  try {
    // ── 1 · the sha, before any port ────────────────────────────────────────
    const { sha256: sha, bytes: declarationBytes } = verifyDeclarationSha(
      o.declaration,
      o.declarationSha256
    );

    // ── 2 · the subject, READ — subjectId and basis are never typed ─────────
    const subject = loadSubjectDeclaration(o.subjectDeclaration);
    const logPath = composeLogPath(o.logDir, subject.subjectId, o.runId);
    const scenarios = resolveScenarios(o.scenarios);
    const readings = scenarios.length * o.variants.length * o.seeds.length;

    out("── MICA ingestion driver ─────────────────────────────────────");
    out(CEILING_SENTENCE);
    out("");
    out(`subject      ${subject.subjectId} (declared by ${subject.declaredBy} at ${subject.declaredAt})`);
    out(`basis        ${subject.basis}`);
    out(`declaration  ${o.declaration}`);
    out(`             sha256 ${sha} VERIFIED against --declaration-sha256 (${String(declarationBytes)} bytes)`);
    out(`captures     ${o.captures}`);
    out(`run-id       ${o.runId}`);
    out(`log          ${logPath}`);
    out(`scenarios    ${String(scenarios.length)}  variants ${o.variants.join(",")}  seeds ${o.seeds.join(",")}`);
    out(`readings     ${String(readings)}  at ${String(o.atMs)}`);
    out(`mode         ${o.write ? "WRITE — records will be appended" : "DRY — nothing will be written"}`);
    out("");

    // ── 3 · one port per slice, all of them, before any delivery ────────────
    const ports = new Map<string, DeclaredSubjectPort>();
    for (const variant of o.variants) {
      for (const seed of o.seeds) {
        ports.set(
          sliceKey(variant, seed),
          new DeclaredSubjectPort({
            declarationPath: o.declaration,
            capturesPath: o.captures,
            variant,
            seed,
          })
        );
      }
    }
    out(`ports        ${String(ports.size)} constructed (one per variant×seed slice)`);

    // ── 4 · the store. Constructed in BOTH modes: a dry run that did not look
    //        at the deployment is not a rehearsal of the write. It only reads.
    const store = new EvidenceLogStore({ path: logPath });
    const before = store.records().length;
    out(`store        load state ${store.getLoadState()} | ${String(before)} record(s) already in this chain`);
    if (store.getLoadState() === "CANNOT_VERIFY") {
      out(`STOPPED — the log at ${logPath} could not be verified: ${store.getLastError() ?? "no detail"}`);
      return INGEST_CLI_EXIT.DEPLOYMENT;
    }
    out("");

    // ── 5 · THE WHOLE PLAN IS BUILT BEFORE THE FIRST APPEND ────────────────
    //
    //   Every one of the readings is resolved to a declaration here, and a
    //   slice the declaration does not cover is refused NOW — while the chain
    //   is still exactly as we found it. Discovering a gap at reading 19 would
    //   leave 18 committed records behind a run that then refused, and a
    //   half-ingested chain is the thing a reader cannot tell from a complete
    //   one without counting. Runner order — scenario, then variant, then seed
    //   — so the chain's order is the captures file's order.
    const plan: {
      readonly scenario: ScenarioDefinition;
      readonly mode: ReturnType<typeof deliveryModeForAxis>;
      readonly port: DeclaredSubjectPort;
      readonly where: string;
      readonly captureSha256: string;
      readonly provenance: AttemptProvenance;
    }[] = [];
    for (const scenario of scenarios) {
      const mode = deliveryModeForAxis(scenario.axis);
      for (const variant of o.variants) {
        for (const seed of o.seeds) {
          const port = ports.get(sliceKey(variant, seed)) as DeclaredSubjectPort;
          const declared = port.declarationFor(scenario.id);
          if (declared === undefined) {
            throw new IngestRefused(
              `the ${variant} seed=${String(seed)} slice holds no declaration for ${scenario.id}. ` +
                `The declaration does not cover the ${String(readings)} readings this run names, ` +
                `and nothing has been appended.`
            );
          }
          plan.push({
            scenario,
            mode,
            port,
            where: `${scenario.id} ${variant} seed=${String(seed)}`,
            captureSha256: declared.captureSha256,
            provenance: {
              subjectId: subject.subjectId,
              // READ, NOT TYPED — the same rule the brief states for
              // `subjectId`, and for the same reason. See the receipt's
              // deviation note.
              basis: subject.basis,
              variant,
              seed,
              // S125: READ OFF THE SCENARIO, never chosen here. The default
              // lives in `scenario.ts` beside the field it defaults, so a
              // scenario that names no seat and a record of its delivery say
              // the same word.
              deliverySeat: scenario.deliverySeat ?? DEFAULT_DELIVERY_SEAT,
            },
          });
        }
      }
    }
    if (plan.length !== readings) {
      throw new IngestRefused(
        `planned ${String(plan.length)} reading(s) where ${String(readings)} were declared`
      );
    }

    if (!o.write) {
      for (const step of plan) {
        out(
          `PLAN  ${step.where} | subject ${step.provenance.subjectId} | ` +
            `basis ${step.provenance.basis} | mode ${step.mode} | capture ${step.captureSha256}`
        );
      }
      out("");
      out(`planned ${String(readings)} reading(s); DRY — nothing was appended.`);
      return INGEST_CLI_EXIT.OK;
    }

    // ── 5a · THE MODE THE EVIDENCE FILE IS BORN WITH — S122 §2.3 ──────────
    //
    //   `durableLineAppender` (src/mica/store/append-store.ts) opens with
    //   `openSync(path, "a")` and no mode, so the file it creates is born
    //   0666 & ~umask. Under this deployment's umask 002 that is 664, and 664
    //   let the GRADER'S GROUP write the evidence it grades until the owner's
    //   hand closed the first live chain by chmod (recipe §5D.6). This is the
    //   driver refusing to leave that to a later hand: the log file is created
    //   HERE, at 0640, so the appender finds it rather than making it.
    //
    //   WHY HERE AND NOT BEFORE THE STORE, which is where S122 §2.3 asked for
    //   it: `IG-A3` requires that a run refused for incomplete coverage leave
    //   NO log file in existence — the directory exactly as it was found. A
    //   pre-create above the store ran before the plan was built, so a refusal
    //   left a zero-length file behind and IG-A3 went red. The two clauses
    //   cannot both hold, and IG-A3's is the stronger one: a refusal that
    //   leaves a trace is a refusal a reader has to interpret. Placed here the
    //   run is already committed to writing — the `--dry` path returned above,
    //   every refusal has fired, and the next statement is the first append.
    //
    //   Three things this deliberately is NOT:
    //   · It is not a write. `openSync(…, "a")` then `closeSync` leaves a
    //     ZERO-LENGTH file, and `EvidenceLogStore` reads a zero-length file as
    //     FIRST_BOOT_OR_ERASED exactly as it reads an absent one (evidence-
    //     store.ts: an empty split yields an empty chain). Behaviour unchanged;
    //     only the mode of a NEW file is.
    //   · It is not a chmod. AN EXISTING FILE IS LEFT EXACTLY AS IT WAS —
    //     `existsSync` guards it, and this driver never changes the mode of a
    //     file it did not create. Closing an already-open chain is the
    //     arbiter's hand, not a side effect of the next run.
    //   · It is not a dry-run act. `--dry` returned above and creates NOTHING:
    //     after a dry run against a fresh directory the log is still ABSENT,
    //     not zero-length (IG-C2).
    //
    //   0o640 and not a umask call: a umask only CLEARS bits, so 0o640 yields
    //   640 under 002, under 022, and under 077 it yields 600 — never wider.
    if (!existsSync(logPath)) {
      closeSync(openSync(logPath, "a", 0o640));
    }

    // ── 5b · the walk ──────────────────────────────────────────────────────
    const byState = new Map<string, number>();
    let stopped: { readonly at: string; readonly result: RecordedDelivery } | null = null;
    for (const step of plan) {
      const result = deliverAndRecord(
        step.port,
        step.scenario.id,
        step.scenario.stressor.steps,
        step.mode,
        store,
        { atMs: o.atMs, provenance: step.provenance }
      );
      byState.set(result.state, (byState.get(result.state) ?? 0) + 1);
      if (result.state !== "RECORDED") {
        stopped = { at: step.where, result };
        break;
      }
      out(`OK    ${step.where} | capture ${step.captureSha256}`);
    }

    out("");

    // ── 6 · what the run says about itself, read back from the store ────────
    out(JSON.stringify(Object.fromEntries([...byState.entries()].sort())));
    if (stopped !== null) {
      const r = stopped.result;
      const detail =
        r.state === "ATTEMPT_NOT_RECORDED"
          ? r.attempt.detail ?? "no detail"
          : r.outcome.detail ?? "no detail";
      out(`STOPPED at ${stopped.at} — state ${r.state}: ${detail}`);
      out("The prefix already appended remains in the chain; each append is its own transaction.");
      return INGEST_CLI_EXIT.REFUSED;
    }

    const records = store.records();
    const attempts = records.filter((r): r is AttemptRecord => r.kind === "ATTEMPT");
    const lacking = attempts.some((r) => r.provenance === undefined);
    out(`log bytes    ${String(statSync(logPath).size)}`);
    out(`records      ${String(records.length)} (was ${String(before)})`);
    out(`verify       ${JSON.stringify(store.verify())}`);
    // THE LAST LINE, and it is the inversion of the S120 rehearsal's: that run
    // printed `false` for "any record naming a subject", proving ABSENCE. This
    // one prints `false` for "any ATTEMPT lacking provenance", proving PRESENCE.
    out(`${String(lacking)}`);
    return INGEST_CLI_EXIT.OK;
  } catch (err) {
    const error = err as Error & { code?: string };
    if (err instanceof IngestUsage) {
      console.error(error.message);
      return INGEST_CLI_EXIT.USAGE;
    }
    if (err instanceof IngestRefused || error.name === "DeclaredSubjectPortRefused" ||
        error.name === "SubjectDeclarationRefused" || error.name === "ScenarioSealRefused" ||
        error.name === "EvidenceLogRefused") {
      console.error(`REFUSED — ${error.message}`);
      return INGEST_CLI_EXIT.REFUSED;
    }
    if (error.name === "EvidenceStoreDeploymentActMissing") {
      console.error(`DEPLOYMENT — ${error.message}`);
      return INGEST_CLI_EXIT.DEPLOYMENT;
    }
    console.error(
      `DEPLOYMENT — the store could not be opened or written ` +
        `(${error.name ?? "error"}${error.code ? `, ${error.code}` : ""})`
    );
    return INGEST_CLI_EXIT.DEPLOYMENT;
  }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
