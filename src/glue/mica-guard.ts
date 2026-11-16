#!/usr/bin/env node
// ── GLUE · mica-guard — the front door ───────────────────────────────────────
//
//   npx ts-node src/glue/mica-guard.ts --action-id <id> [flags]
//   npm run guard -- --action-id <id> [flags]
//
// THE ONE SENTENCE THIS PROGRAM IS ALLOWED TO SAY:
//
//   One action went in; what came out is a disposition — HOLD, HOLD-BLIND,
//   PASS-BLIND, or RELEASE — composed only from the wired readers' refusals and
//   blindnesses, durably accounted for. RELEASE means no wired reader refused,
//   and nothing more.
//
// It never says an action is safe. It never says the system is healthy. It puts
// ONE REAL ACTION through the chokepoint and lets `renderDisposition` print the
// contradictions the type system cannot carry (CHOKEPOINT_SCOPE_LINES).
//
// ── WHAT IT DOES NOT READ ─────────────────────────────────────────────────────
//
//   THE ACTION'S PAYLOAD. `ProposedAction` is `{ id }` and that is the whole of
//   it (chokepoint/types.ts §7.3). This program takes an opaque id and composes
//   sensor verdicts about the LOG, never about the action. Truth of what it
//   released is out of scope and unknowable from here.
//
// ── THE THREE EXIT CODES, AND WHY 2 IS NOT A DISPOSITION ──────────────────────
//
//   0  execute=true   — RELEASE, or PASS-BLIND, delivered and accounted for.
//   1  execute=false  — any held disposition. The gate did its job.
//   2  wiring or usage error — THE GATE DID NOT RUN.
//
//   2 must never be read as a HOLD. A broken invocation is not a decision about
//   an action; conflating them would let a typo in a deploy script look like a
//   gate that considered the action and held it. An agentic consumer reading
//   only the exit code gets three distinguishable states, and the tail line
//   carries the same fact in words.
//
// ── THE LESSON A TESTER SHOULD HIT FIRST, LEFT DELIBERATELY IN THE WAY ────────
//
//   Run this with no `--floor-trail` and a clean log. It will NOT release. The
//   chokepoint issues no permit it cannot account for, so the RELEASE narrows to
//   HOLD-BLIND and says so in print. That is not a bug to route around; it is
//   the architecture, and it is the first thing this front door teaches.

import {
  CHOKEPOINT_ID,
  DISPOSITION_LABEL,
  renderDisposition,
} from "../mica/chokepoint";
import type {
  ChokepointDisposition,
  DispositionResult,
  ProposedAction,
  Stakes,
  StakesLine,
} from "../mica/chokepoint";
import { GUARD_SENTENCE, renderCensus, wire } from "./wire";
import type { WireOptions } from "./wire";
import { evaluateAndRecord } from "./evaluate-and-record";
import type {
  DeliveryStatus,
  EvaluateAndRecordResult,
} from "./evaluate-and-record";
import { canonicalHash } from "./decision-journal";
import type { DeclarationBinding } from "./decision-journal";
import { MICA_LOG_FILE_ATTESTS } from "./mica-log-file";
import { WitnessStoreLog } from "./witness-log-file";
import { readFileSync } from "fs";
import {
  admitProbeSource,
  DOOR_CHECKED_CUSTODY,
  PROBE_SOURCE_OWNER,
  SIG_STILL_NEVER_VERIFIES_THE_JOIN,
} from "./probe-door";
import type { ProbeDoorResult } from "./probe-door";
import { readClockStampsFile } from "./clerk-clock-stamps-file";
import type { ClockStampsReadResult } from "./clerk-clock-stamps-file";

// ── usage ────────────────────────────────────────────────────────────────────

export const USAGE = [
  "mica-guard — put one proposed action through the MICA chokepoint.",
  "",
  "  npx ts-node src/glue/mica-guard.ts --action-id <id> [flags]",
  "",
  "  --action-id <id>                REQUIRED. Opaque id. The payload is never read.",
  "  --log <path.jsonl>              the observed system's log. Absent -> Eng and Sig",
  "                                  are NOT WIRED and compose nothing.",
  "  --log-kind mica|witness|        WHICH GRAMMAR the log is in. Default mica (the",
  "            subject-chain         generic JSONL reader). `witness` reads a witness",
  "                                  store as chained frames and prints its mapping in",
  "                                  the census. `subject-chain` reads the bridge's own",
  "                                  hash-chained subject log — TAMPER-EVIDENT, NOT",
  "                                  INDEPENDENT: same writer, same chainer, same",
  "                                  verifier. EXPLICIT, never detected.",
  "  --readable-load-state <state>   repeatable. NO DEFAULT. Absent -> every reader is",
  "                                  blind for MISSING_CONFIGURATION.",
  "  --sensor-config <path.json>     the rest of Eng's and Sig's injected numbers and",
  "                                  maps: { \"eng\": {...}, \"sig\": {...} }. NO DEFAULT.",
  "  --probe-source <path.json>      Sig F4's sealed-expectation axis. ADMITTED ONLY",
  "                                  ON VERIFIED PROVENANCE: owned by " + PROBE_SOURCE_OWNER + ",",
  "                                  and not writable by the invoking uid. NO DEFAULT",
  "                                  PATH. Absent -> F4 reports NOT_CONFIGURED and is",
  "                                  disclosed rather than counted.",
  "  --clerk-clock-stamps <path>     Sig F3's independent-clock axis (S109-B).",
  "                                  ADMITTED ONLY ON VERIFIED PROVENANCE: owned by",
  "                                  mica, and not writable by the invoking uid. NO",
  "                                  DEFAULT PATH. Absent -> F3 reports NOT_CONFIGURED",
  "                                  and is disclosed rather than counted. NEVER",
  "                                  accepted from --sensor-config (see below).",
  "  --clerk-store <dir>             wires the clerk gap reader.",
  "  --clerk-pubkey <path|base64>    trust anchor for that store's chain verification.",
  "  --now <wall_ms>                 read time for the gap read. Default: this clock.",
  "  --stakes-class <c>              THIS action's impact class. Caller-supplied.",
  "  --line-classes <a,b,c>          the impact ladder, low->high. NO DEFAULT LADDER.",
  "  --hold-at-or-above <c>          where a blind action starts being HELD.",
  "  --floor-trail <path>            REQUIRED FOR ANY PERMIT. Absent -> every executing",
  "                                  disposition narrows to HOLD-BLIND.",
  "  --ledger <path>                 where PASS-BLIND records land. Absent -> a",
  "                                  PASS-BLIND fails closed.",
  "  --notice-dir <dir>              where notices land. NO DEFAULT SINK EVER.",
  "  --notice-window <n>             notices per this many PASS-BLIND events.",
  "  --subject <s>                   Stage 1 identity component. Required with",
  "                                  --journal, together with --session-id.",
  "  --session-id <id>                Stage 1 identity component. Required with",
  "                                  --journal, together with --subject.",
  "  --journal <path.jsonl>          the canonical decision journal (Stage 1).",
  "                                  Absent -> this invocation runs exactly as",
  "                                  before: no identity lookup, no canonical",
  "                                  commit, no repairable projections. Present",
  "                                  -> --subject and --session-id are REQUIRED;",
  "                                  --action-id alone is not an identity.",
  "  --history <path.jsonl>          the doctor SUBSTRATE_READ history (Stage 1",
  "                                  repairable projection). Only read with",
  "                                  --journal.",
  "  --events <path.jsonl>           the append-only event book (Stage 1",
  "                                  repairable projection). Only read with",
  "                                  --journal.",
  "  --tool-name <name>              REQUIRED with --journal (Amendment 1):",
  "                                  toolName is part of the request and",
  "                                  participates in requestHash.",
  "  --declaration-hash <sha256>     REQUIRED with --journal, unless",
  "                                  --declaration-unbound is given instead.",
  "                                  Binds this decision to a real Stage 0",
  "                                  declaration hash.",
  "  --declaration-unbound           REQUIRED with --journal, unless",
  "                                  --declaration-hash is given instead.",
  "                                  Explicit: this decision is NOT bound to",
  "                                  any declaration. Never defaulted, and",
  "                                  never a fabricated hash standing in for",
  "                                  a real one.",
  "",
  "  exit 0 execute=true · exit 1 execute=false · exit 2 wiring or usage error.",
].join("\n");

/** A usage or wiring failure. Exit 2, and never a disposition. */
export class GuardInvocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardInvocationError";
  }
}

export interface GuardArgs {
  readonly actionId: string;
  readonly wireOptions: WireOptions;
  readonly stakes: Stakes | null;
  /** The identity triple (Stage 1, §4). Null unless --subject/--session-id/--journal are all given. */
  readonly identity: { subject: string; sessionId: string } | null;
  readonly journalPath: string | undefined;
  readonly historyPath: string | undefined;
  readonly eventsPath: string | undefined;
  readonly toolName: string | undefined;
  readonly declarationBinding: DeclarationBinding | undefined;
}

const FLAGS_WITH_VALUES = [
  "--action-id",
  "--log",
  "--log-kind",
  "--readable-load-state",
  "--sensor-config",
  "--probe-source",
  "--clerk-clock-stamps",
  "--clerk-store",
  "--clerk-pubkey",
  "--now",
  "--stakes-class",
  "--line-classes",
  "--hold-at-or-above",
  "--floor-trail",
  "--ledger",
  "--notice-dir",
  "--notice-window",
  "--subject",
  "--session-id",
  "--journal",
  "--history",
  "--events",
  "--tool-name",
  "--declaration-hash",
] as const;

/** Boolean flags: take no value. Handled separately from FLAGS_WITH_VALUES. */
const BOOLEAN_FLAGS = ["--declaration-unbound"] as const;

/**
 * The knobs the config file may carry, per reader. UNKNOWN KEYS ARE REFUSED: a
 * misspelled threshold that is silently ignored leaves the reader blind for
 * MISSING_CONFIGURATION while the operator believes they injected it, and the
 * run then reads as a cautious hold rather than as the typo it is.
 */
const ENG_NUMERIC_KEYS = [
  "structureThreshold",
  "minimumSampleSize",
  "ceilingMargin",
  "windowSize",
  "permutationSamples",
  "permutationSeed",
] as const;

/**
 * T11 · keys that must be a POSITIVE INTEGER, not merely a finite number.
 *
 * ⛔ A SEPARATE CATEGORY, AND THE REASON IS THIS FILE'S OWN ARGUMENT ONE COMMENT
 *    UP: "a misspelled threshold that is silently ignored leaves the reader blind
 *    for MISSING_CONFIGURATION while the operator believes they injected it, and
 *    the run then reads as a cautious hold rather than as the typo it is."
 *    `minimumClassCoverage: 2.5`, `: 0` or `: -1` is EXACTLY that failure with the
 *    spelling right: Eng requires an integer >= 1, so a wrong-shaped value is
 *    refused downstream as MISSING_CONFIGURATION — the reader goes blind and the
 *    operator is sure they declared it. Caught here, at the door, where the
 *    operator is standing.
 *
 * ⚠ `minimumSampleSize` IS ALSO CONCEPTUALLY A POSITIVE INTEGER AND IS DELIBERATELY
 *   LEFT WHERE IT IS. Moving it would change what this guard accepts for a field
 *   that has been declared on this box for days, and that is a behaviour change
 *   with no ticket behind it. [owed → board] — one line when somebody wants it,
 *   and it belongs in its own act so a refused config has one cause.
 */
const ENG_POSITIVE_INTEGER_KEYS = ["minimumClassCoverage"] as const;

const SIG_NUMERIC_KEYS = ["clockToleranceMs"] as const;
const SIG_MAP_KEYS = ["preconditionMap", "reentryMap"] as const;
/**
 * Free-text keys: carried verbatim to the reader, never parsed and never
 * validated for truthfulness. `clockToleranceBasis` says where the tolerance
 * came from; this file checks that it is a string and nothing else, because
 * whether a stated basis is HONEST is not a thing a config validator can know.
 */
const SIG_TEXT_KEYS = ["clockToleranceBasis"] as const;

function asStringListMap(
  where: string,
  value: unknown
): Readonly<Record<string, readonly string[]>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GuardInvocationError(`${where} must be an object of eventType -> [eventType, ...]`);
  }
  const out: Record<string, readonly string[]> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(entry) || entry.some((e) => typeof e !== "string")) {
      throw new GuardInvocationError(`${where}.${key} must be an array of strings`);
    }
    out[key] = entry as string[];
  }
  return out;
}

function validateReaderConfig(
  where: string,
  raw: unknown,
  numericKeys: readonly string[],
  mapKeys: readonly string[],
  textKeys: readonly string[] = [],
  positiveIntegerKeys: readonly string[] = []
): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new GuardInvocationError(`${where} must be a JSON object`);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === "readableLoadStates") {
      throw new GuardInvocationError(
        `${where}.readableLoadStates is not read here. The run's load-state gate ` +
          `comes from --readable-load-state and from nowhere else, so a reader of ` +
          `the census has exactly one place to look for what this run was told to trust.`
      );
    }
    if (key === "probeSource") {
      throw new GuardInvocationError(
        `${where}.probeSource is not accepted from a config file. Sig's F4 axis ` +
          `is an EXPECTATION HELD OUTSIDE the observed system, and a hand-typed ` +
          `one is the observed system handing MICA its own evidence — the same ` +
          `objection this file already makes to a hand-typed clerkClockSource, ` +
          `on the leg where it matters most. It comes through --probe-source or ` +
          `not at all, and that door checks custody at the kernel.`
      );
    }
    if (key === "clerkClockSource") {
      throw new GuardInvocationError(
        `${where}.clerkClockSource is not accepted from a config file. Sig's F3 ` +
          `axis is a PARALLEL CLERK READ, and a hand-typed one would be MICA ` +
          `reading a second account this program authored itself. Unconfigured, ` +
          `F3 reports NOT_CONFIGURED and is disclosed rather than counted.`
      );
    }
    if (positiveIntegerKeys.includes(key)) {
      // The same shape Eng itself requires, checked where the operator can see it.
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
        throw new GuardInvocationError(
          `${where}.${key} must be an integer >= 1; got ${JSON.stringify(value)}. ` +
            `A value of the wrong shape is refused by the reader as ` +
            `MISSING_CONFIGURATION, which reads as a cautious hold rather than as ` +
            `the mistake it is — so it is refused here instead, where you are standing.`
        );
      }
      out[key] = value;
      continue;
    }
    if (numericKeys.includes(key)) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new GuardInvocationError(`${where}.${key} must be a finite number`);
      }
      out[key] = value;
      continue;
    }
    if (mapKeys.includes(key)) {
      out[key] = asStringListMap(`${where}.${key}`, value);
      continue;
    }
    if (textKeys.includes(key)) {
      if (typeof value !== "string") {
        throw new GuardInvocationError(`${where}.${key} must be a string`);
      }
      out[key] = value;
      continue;
    }
    throw new GuardInvocationError(
      `${where} carries unknown key "${key}". Accepted: ` +
        `${[...numericKeys, ...positiveIntegerKeys, ...mapKeys, ...textKeys].join(", ")}.`
    );
  }
  return out;
}

function readSensorConfig(path: string): {
  eng?: Record<string, unknown>;
  sig?: Record<string, unknown>;
} {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new GuardInvocationError(`--sensor-config ${path} could not be read: ${String(err)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new GuardInvocationError(`--sensor-config ${path} is not valid JSON: ${String(err)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new GuardInvocationError(
      `--sensor-config ${path} must be a JSON object of the shape { "eng": {...}, "sig": {...} }`
    );
  }
  const o = parsed as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (key !== "eng" && key !== "sig") {
      throw new GuardInvocationError(
        `--sensor-config ${path} carries unknown key "${key}"; only "eng" and "sig" are read`
      );
    }
  }
  const out: { eng?: Record<string, unknown>; sig?: Record<string, unknown> } = {};
  if (o.eng !== undefined) {
    out.eng = validateReaderConfig(
      "--sensor-config eng",
      o.eng,
      ENG_NUMERIC_KEYS,
      [],
      [],
      ENG_POSITIVE_INTEGER_KEYS
    );
  }
  if (o.sig !== undefined) {
    out.sig = validateReaderConfig(
      "--sensor-config sig",
      o.sig,
      SIG_NUMERIC_KEYS,
      SIG_MAP_KEYS,
      SIG_TEXT_KEYS
    );
  }
  return out;
}

/**
 * Parse argv. THROWS GuardInvocationError on anything malformed — an unknown
 * flag, a flag with no value, a line whose `holdAtOrAbove` is not on its own
 * ladder. All of those are exit 2: the operator got the invocation wrong, and
 * letting a typo decay quietly into the cautious default would hide it behind a
 * disposition that looks deliberate.
 */
export function parseArgs(argv: readonly string[]): GuardArgs {
  let actionId: string | null = null;
  const loadStates: string[] = [];
  let logPath: string | undefined;
  let logKind: "mica" | "witness" | "subject-chain" | undefined;
  let sensorConfigPath: string | undefined;
  let probeSourcePath: string | undefined;
  let clockStampsPath: string | undefined;
  let clerkStore: string | undefined;
  let clerkPubkey: string | undefined;
  let now: number | undefined;
  let stakesClass: string | undefined;
  let lineClasses: string[] | undefined;
  let holdAtOrAbove: string | undefined;
  let floorTrailPath: string | undefined;
  let ledgerPath: string | undefined;
  let noticeDir: string | undefined;
  let noticeWindow: number | undefined;
  let subject: string | undefined;
  let sessionId: string | undefined;
  let journalPath: string | undefined;
  let historyPath: string | undefined;
  let eventsPath: string | undefined;
  let toolName: string | undefined;
  let declarationHashFlag: string | undefined;
  let declarationUnbound = false;

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if ((BOOLEAN_FLAGS as readonly string[]).includes(flag)) {
      if (flag === "--declaration-unbound") declarationUnbound = true;
      continue;
    }
    if (!(FLAGS_WITH_VALUES as readonly string[]).includes(flag)) {
      throw new GuardInvocationError(`unknown flag \`${flag}\``);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new GuardInvocationError(`\`${flag}\` needs a value`);
    }
    i++;
    switch (flag) {
      case "--action-id":
        actionId = value;
        break;
      case "--log":
        logPath = value;
        break;
      case "--log-kind":
        if (value !== "mica" && value !== "witness" && value !== "subject-chain") {
          throw new GuardInvocationError(
            `--log-kind must be \`mica\`, \`witness\` or \`subject-chain\`, not \`${value}\`. It is named, never sniffed: a detector would turn its mistakes into verdicts instead of errors.`
          );
        }
        logKind = value;
        break;
      case "--readable-load-state":
        loadStates.push(value);
        break;
      case "--sensor-config":
        sensorConfigPath = value;
        break;
      case "--probe-source":
        probeSourcePath = value;
        break;
      case "--clerk-clock-stamps":
        clockStampsPath = value;
        break;
      case "--clerk-store":
        clerkStore = value;
        break;
      case "--clerk-pubkey":
        clerkPubkey = value;
        break;
      case "--now":
        now = Number(value);
        if (!Number.isFinite(now)) {
          throw new GuardInvocationError(`--now must be a finite number of wall ms, got \`${value}\``);
        }
        break;
      case "--stakes-class":
        stakesClass = value;
        break;
      case "--line-classes":
        lineClasses = value.split(",").map((c) => c.trim()).filter((c) => c.length > 0);
        if (lineClasses.length === 0) {
          throw new GuardInvocationError("--line-classes named no classes");
        }
        break;
      case "--hold-at-or-above":
        holdAtOrAbove = value;
        break;
      case "--floor-trail":
        floorTrailPath = value;
        break;
      case "--ledger":
        ledgerPath = value;
        break;
      case "--notice-dir":
        noticeDir = value;
        break;
      case "--notice-window":
        noticeWindow = Number(value);
        if (!Number.isInteger(noticeWindow) || noticeWindow <= 0) {
          throw new GuardInvocationError(`--notice-window must be a positive integer, got \`${value}\``);
        }
        break;
      case "--subject":
        subject = value;
        break;
      case "--session-id":
        sessionId = value;
        break;
      case "--journal":
        journalPath = value;
        break;
      case "--history":
        historyPath = value;
        break;
      case "--events":
        eventsPath = value;
        break;
      case "--tool-name":
        toolName = value;
        break;
      case "--declaration-hash":
        declarationHashFlag = value;
        break;
    }
  }

  if (actionId === null || actionId.length === 0) {
    throw new GuardInvocationError("--action-id is required");
  }
  // The tail line is space-separated key=value tokens, so an id carrying
  // whitespace would break the one parser it exists to serve. Refused at the
  // door rather than mangled downstream — and refused as a USAGE error, because
  // that is what it is.
  if (/\s/.test(actionId)) {
    throw new GuardInvocationError(
      `--action-id \`${actionId}\` contains whitespace. The machine tail line is ` +
        `space-separated key=value tokens; an id with a space in it would split ` +
        `across two of them.`
    );
  }

  // The line is all-or-nothing, and a half-injected line is a usage error rather
  // than a quiet slide into the cautious default. The cautious default exists
  // for a line nobody supplied — not for one somebody supplied wrongly.
  let line: StakesLine | undefined;
  if (lineClasses !== undefined || holdAtOrAbove !== undefined) {
    if (lineClasses === undefined) {
      throw new GuardInvocationError("--hold-at-or-above was given without --line-classes");
    }
    if (holdAtOrAbove === undefined) {
      throw new GuardInvocationError("--line-classes was given without --hold-at-or-above");
    }
    if (!lineClasses.includes(holdAtOrAbove)) {
      throw new GuardInvocationError(
        `--hold-at-or-above \`${holdAtOrAbove}\` is not one of --line-classes ` +
          `[${lineClasses.join(", ")}]. MICA holds no ladder of its own; a line ` +
          `naming a rung that does not exist is an invocation error, not a policy.`
      );
    }
    line = { classes: lineClasses, holdAtOrAbove };
  }

  // The identity triple is REQUIRED when --journal is given (§4: --action-id
  // alone is not an identity). All-or-nothing, same discipline as the stakes
  // line above: a half-supplied identity is a usage error, not a quiet slide
  // into "no journal wiring at all".
  if (journalPath !== undefined && (subject === undefined || sessionId === undefined)) {
    throw new GuardInvocationError(
      "--journal was given without both --subject and --session-id. The " +
        "identity is (subject, sessionId, actionId); --action-id alone is not " +
        "an identity, and a journal with no identity to key on cannot look up, " +
        "commit, or replay a decision."
    );
  }
  if ((subject !== undefined || sessionId !== undefined) && journalPath === undefined) {
    throw new GuardInvocationError(
      "--subject/--session-id were given without --journal. There is nothing " +
        "for an identity to key into without a journal path; this is a usage " +
        "error, not a cautious no-op."
    );
  }
  // Amendment 1: toolName participates in requestHash and is part of the
  // request — required in journal mode, same all-or-nothing discipline.
  if (journalPath !== undefined && (toolName === undefined || toolName.length === 0)) {
    throw new GuardInvocationError(
      "--journal was given without --tool-name. toolName participates in " +
        "requestHash and in server-side stakes resolution; it is not left to " +
        "default to an empty string."
    );
  }
  // Amendment 1, Blocker 3: declarationBinding is explicit, never a
  // fabricated digest standing in for a real one. Exactly one of
  // --declaration-hash / --declaration-unbound, required in journal mode.
  let declarationBinding: DeclarationBinding | undefined;
  if (journalPath !== undefined) {
    if (declarationHashFlag !== undefined && declarationUnbound) {
      throw new GuardInvocationError(
        "--declaration-hash and --declaration-unbound were both given. " +
          "Exactly one declaration binding is required, never both."
      );
    }
    if (declarationHashFlag === undefined && !declarationUnbound) {
      throw new GuardInvocationError(
        "--journal requires exactly one of --declaration-hash <sha256> or " +
          "--declaration-unbound. There is no default: a decision with no " +
          "declaration binding stated is not the same as one with a real hash, " +
          "and this program never fabricates one to stand in for the other."
      );
    }
    if (declarationHashFlag !== undefined) {
      if (!/^[0-9a-f]{64}$/.test(declarationHashFlag)) {
        throw new GuardInvocationError(
          `--declaration-hash \`${declarationHashFlag}\` is not a 64-character ` +
            `lowercase-hex sha256 digest.`
        );
      }
      declarationBinding = { kind: "HASH", sha256: declarationHashFlag };
    } else {
      declarationBinding = { kind: "UNBOUND_STAGE_1" };
    }
  }

  const sensorConfig =
    sensorConfigPath === undefined ? {} : readSensorConfig(sensorConfigPath);

  // ── The probe door (ruled S101, shape (a)) ────────────────────────────────
  //
  // Option-B: an absent flag never opens the door at all, and F4 then reads
  // NOT_CONFIGURED — disclosed, not counted, exactly as an unconfigured F3 does.
  // A REFUSAL IS A WIRING ERROR, not a cautious disposition: admitting the run
  // with F4 silently unwired would let a failed custody check read as a leg
  // nobody configured, which is the one confusion this door exists to prevent.
  let probeDoor: ProbeDoorResult | null = null;
  let probeSource: unknown;
  if (probeSourcePath !== undefined) {
    const g = process.getuid;
    const gg = process.getgroups;
    probeDoor = admitProbeSource(probeSourcePath, {
      uid: typeof g === "function" ? g.call(process) : undefined,
      gids: typeof gg === "function" ? gg.call(process) : [],
    });
    if (!probeDoor.admitted) {
      throw new GuardInvocationError(
        `--probe-source REFUSED at the door: ${probeDoor.refusal}\n` +
          `  ${probeDoor.detail}\n` +
          `  what would satisfy the check:\n` +
          probeDoor.remedy.map((r) => `    ${r}`).join("\n")
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(probeDoor.raw);
    } catch (err) {
      throw new GuardInvocationError(
        `--probe-source ${probeSourcePath} passed the custody check and is not ` +
          `valid JSON: ${String(err)}. The door checks WHO wrote it, never whether ` +
          `what they wrote is well-formed — and it does not repair it.`
      );
    }
    if (!Array.isArray(parsed)) {
      throw new GuardInvocationError(
        `--probe-source ${probeSourcePath} does not hold a JSON array. A ` +
          `ProbeSource is a list of probe records; F4 validates each one and ` +
          `refuses the malformed, but the outer shape is checked here.`
      );
    }
    probeSource = parsed;
  }

  // ── the clerk-clock-stamps door (S109-B, same shape as the probe door) ────
  //
  // Option-B: an absent flag never opens the door, and F3 then reads
  // NOT_CONFIGURED — disclosed, not counted, exactly as an unconfigured
  // probeSource does for F4. A REFUSAL IS A WIRING ERROR, not a cautious
  // disposition, for the same reason the probe door's is: admitting the run
  // with F3 silently unwired would let a failed custody check (or an absent
  // stamps file — S108-C's FILE_ABSENT grammar) read as a leg nobody
  // configured.
  let clockStampsRead: ClockStampsReadResult | null = null;
  let clerkClockSource: unknown;
  if (clockStampsPath !== undefined) {
    const g = process.getuid;
    const gg = process.getgroups;
    clockStampsRead = readClockStampsFile(clockStampsPath, {
      uid: typeof g === "function" ? g.call(process) : undefined,
      gids: typeof gg === "function" ? gg.call(process) : [],
    });
    if (clockStampsRead.loadState !== "LOADED") {
      const named =
        clockStampsRead.doorRefusal !== null
          ? `${clockStampsRead.doorRefusal.refusal}: ${clockStampsRead.doorRefusal.detail}\n` +
            `  what would satisfy the check:\n` +
            clockStampsRead.doorRefusal.remedy.map((r) => `    ${r}`).join("\n")
          : `${clockStampsRead.loadState}: ${clockStampsRead.problem?.detail ?? "no stamps present"}`;
      throw new GuardInvocationError(`--clerk-clock-stamps REFUSED: ${named}`);
    }
    clerkClockSource = clockStampsRead.stamps;
  }

  const wireOptions: WireOptions = {
    logPath,
    logKind,
    readableLoadStates: loadStates.length > 0 ? loadStates : undefined,
    // Cast, and it is earned: validateReaderConfig checked every key against the
    // accepted set and every value against its type, and refused everything else.
    // A cast on unvalidated JSON would be exactly the "a cast is never a
    // validation" failure the ledgers' closed-shape parsers exist to prevent.
    eng: sensorConfig.eng as WireOptions["eng"],
    // The probe axis and the clerk-clock axis reach Sig ONLY through their own
    // doors above. Both are spread in last so that no config-file key could
    // shadow either — and `readSensorConfig` refuses `probeSource` AND
    // `clerkClockSource` outright, so there is no such key to begin with.
    sig: {
      ...(sensorConfig.sig ?? {}),
      ...(probeSource === undefined ? {} : { probeSource }),
      ...(clerkClockSource === undefined ? {} : { clerkClockSource }),
    } as WireOptions["sig"],
    clerkStore,
    clerkPubkey,
    now,
    line,
    stakesClass,
    floorTrailPath,
    ledgerPath,
    noticeDir,
    noticeWindow,
    probeProvenance:
      probeDoor !== null && probeDoor.admitted ? probeDoor.provenance : undefined,
    clockStampsProvenance:
      clockStampsRead !== null && clockStampsRead.loadState === "LOADED"
        ? (clockStampsRead.provenance ?? undefined)
        : undefined,
  };

  return {
    actionId,
    wireOptions,
    stakes: stakesClass === undefined ? null : { impactClass: stakesClass },
    identity:
      subject !== undefined && sessionId !== undefined ? { subject, sessionId } : null,
    journalPath,
    historyPath,
    eventsPath,
    toolName,
    declarationBinding,
  };
}

// ── the machine-parseable tail ───────────────────────────────────────────────

/**
 * Exit code from a disposition result. The ONLY producer of the process's exit
 * code for a run that reached a decision; 2 is produced elsewhere and never
 * here, because 2 is not a disposition.
 */
export function exitCodeFor(result: DispositionResult): 0 | 1 {
  return result.execute ? 0 : 1;
}

/**
 * ONE line, for the agentic consumer that reads stdout and nothing else.
 *
 *   MICA-GUARD action=<id> disposition=<LABEL> execute=<bool> recorded=<...> exit=<code>
 *
 * `recorded` carries BOTH durability facts, because they are two independent
 * preconditions and collapsing them would hide the case the architecture cares
 * about most: `trail:` is whether this decision's floor reading durably landed,
 * `ledger:` is whether a PASS-BLIND record did (`none` when no PASS-BLIND record
 * was due, which is not the same as one that failed).
 */
export function tailLine(result: DispositionResult, exit: number): string {
  const d: ChokepointDisposition = result.disposition;
  const ledger =
    result.decision.disposition === "PASS_BLIND"
      ? result.recorded
        ? "yes"
        : "no"
      : "none";
  return (
    `MICA-GUARD action=${result.decision.action.id} ` +
    `disposition=${DISPOSITION_LABEL[d]} ` +
    `execute=${String(result.execute)} ` +
    `recorded=trail:${result.floorTrailRecorded ? "yes" : "no"},ledger:${ledger} ` +
    `exit=${String(exit)}`
  );
}

/**
 * The tail line for a run that never reached a decision.
 *
 * `disposition=NONE` is the machine-readable form of "the gate did not run", and
 * it is deliberately NOT one of the four labels: a consumer matching on
 * disposition can never mistake a broken invocation for a considered hold.
 *
 * THE REASON IS NOT IN THE TAIL, and that is a decision rather than an omission:
 * the tail is a fixed set of space-separated key=value tokens, and free text
 * spliced into it would break the one parser this line exists to serve. The
 * reason is printed in full, in words, immediately above.
 */
/**
 * `kind` is now REQUIRED (verifier F2: Amendment 1 ruled that this line's
 * machine-readable distinguishability matters more than byte-identity with
 * the pre-Stage-1 shape, and the first Amendment-1 cut still let `kind` be
 * silently omitted at one call site — that omission is the F2 finding).
 * Every exit-2, non-`conflict` path calls this with `"usage"`: a broken
 * invocation, wiring error, or malformed flags — the original meaning of
 * exit 2. `"conflict"` is the OTHER caller (`renderJournalRun` below): the
 * gate DID evaluate an earlier request under this identity, and THIS
 * request merely collided with it on a different requestHash and was
 * refused before touching anything. Header text documents: "2 = this
 * invocation did not evaluate (usage, wiring, or conflict)."
 */
export function errorTailLine(actionId: string, kind: "usage" | "conflict"): string {
  return (
    `MICA-GUARD action=${actionId} disposition=NONE execute=false ` +
    `recorded=trail:no,ledger:none kind=${kind} exit=2`
  );
}

// ── the run ──────────────────────────────────────────────────────────────────

export interface GuardRun {
  readonly output: string;
  readonly exit: 0 | 1 | 2;
  /** Null when the gate did not run. */
  readonly result: DispositionResult | null;
}

/**
 * One action, one disposition, one printed account of both. Returns rather than
 * printing, so the test can read every line this produces without capturing a
 * child process's stdout.
 */
export function run(argv: readonly string[]): GuardRun {
  let args: GuardArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (err instanceof GuardInvocationError) {
      return {
        output: [
          `[${CHOKEPOINT_ID}] INVOCATION ERROR: ${err.message}`,
          "",
          "THE GATE DID NOT RUN. This is exit 2 and it is NOT a disposition: no",
          "action was judged, nothing was held, and nothing was released. Do not",
          "read this as a HOLD.",
          "",
          USAGE,
          "",
          errorTailLine("NONE_SUPPLIED", "usage"),
        ].join("\n"),
        exit: 2,
        result: null,
      };
    }
    throw err;
  }

  const action: ProposedAction = { id: args.actionId };

  // ── Stage 1 (Amendment 1): --journal ROUTES the call through
  //    evaluateAndRecord, BEFORE any top-level wire() validation call. ──────
  //
  // No plain `wire(args.wireOptions)` is called on this path at all: doing so
  // would construct a REAL, file-backed `FloorTrail`/`ChokepointLedger` at
  // `--floor-trail`/`--ledger` merely "to validate wiring", pointed at the
  // exact paths `evaluateAndRecord` itself opens as wrapper-owned projections
  // AFTER `DECISION_FINAL`. That would be wasted work at best and a second,
  // confusing instance at worst — so on this path, `evaluateAndRecord`'s own
  // internal `wire()` call (with the journal-backed overrides injected) is
  // the ONLY wire() call, and a wiring error surfaces by throwing out of it,
  // caught here exactly like the direct path's wiring error below.
  if (args.journalPath !== undefined && args.identity !== null) {
    const identity = {
      subject: args.identity.subject,
      sessionId: args.identity.sessionId,
      actionId: args.actionId,
    };
    // Both are required with --journal (validated in parseArgs); asserted
    // here so TypeScript narrows them, not re-validated.
    const toolName = args.toolName as string;
    const declarationBinding = args.declarationBinding as DeclarationBinding;
    // requestHash covers the full request, including toolName (Amendment 1:
    // toolName participates in requestHash).
    const requestHash = canonicalHash({
      identity,
      subject: args.identity.subject,
      toolName,
      stakesClass: args.stakes?.impactClass,
    });
    try {
      const evalResult: EvaluateAndRecordResult = evaluateAndRecord(
        {
          identity,
          subject: args.identity.subject,
          toolName,
          stakesClass: args.stakes?.impactClass,
          requestHash,
        },
        {
          journal: args.journalPath,
          floorTrail: args.wireOptions.floorTrailPath,
          ledger: args.wireOptions.ledgerPath,
          history: args.historyPath,
          events: args.eventsPath,
        },
        args.wireOptions,
        { declarationBinding }
      );
      return renderJournalRun(evalResult, args.actionId);
    } catch (err) {
      return {
        output: [
          `[${CHOKEPOINT_ID}] WIRING ERROR: ${String(err)}`,
          "",
          "THE GATE DID NOT RUN. This is exit 2 and it is NOT a disposition.",
          "",
          errorTailLine(args.actionId, "usage"),
        ].join("\n"),
        exit: 2,
        result: null,
      };
    }
  }

  let wiring: ReturnType<typeof wire>;
  try {
    wiring = wire(args.wireOptions);
  } catch (err) {
    return {
      output: [
        `[${CHOKEPOINT_ID}] WIRING ERROR: ${String(err)}`,
        "",
        "THE GATE DID NOT RUN. This is exit 2 and it is NOT a disposition.",
        "",
        errorTailLine(args.actionId, "usage"),
      ].join("\n"),
      exit: 2,
      result: null,
    };
  }

  const result = wiring.chokepoint.guard(action, wiring.sensorVerdicts, args.stakes);
  const exit = exitCodeFor(result);

  const out: string[] = [];
  out.push(`[${CHOKEPOINT_ID}] ${GUARD_SENTENCE}`);
  out.push("");
  out.push(renderCensus(wiring.census));
  // EACH READER SPEAKS ITS OWN ATTESTATION, and only its own.
  //
  // This printed MICA_LOG_FILE_ATTESTS unconditionally until S102 — including
  // under the witness reader, where its sentence "a JSONL file carries no hash
  // chain" is FALSE about the file being read and would deny, in the run's own
  // output, the tamper evidence the witness reader had just checked. The census
  // already carries WITNESS_LOG_ATTESTS for that reader; printing the generic
  // one beside it would have made the report contradict itself.
  if (wiring.logFile !== null && !(wiring.logFile instanceof WitnessStoreLog)) {
    out.push("");
    out.push(`  ${MICA_LOG_FILE_ATTESTS}`);
  }
  out.push("");
  // UNMODIFIED. The chokepoint's own render is the instrument speaking; this
  // program frames it and never edits it.
  out.push(renderDisposition(result));
  if (wiring.notifier !== null) {
    out.push("");
    out.push(wiring.notifier.render());
  }
  out.push("");
  out.push(tailLine(result, exit));

  return { output: out.join("\n"), exit, result };
}

/**
 * Render the tail for a --journal-routed run. `result` is null here because
 * evaluateAndRecord returns a plain canonical decision object, not a
 * DispositionResult — the GuardRun.result field stays reserved for the
 * direct (non-journal) path, and a --journal caller reads the same
 * machine-parseable tail line to learn execute/exit.
 */
function renderJournalRun(evalResult: EvaluateAndRecordResult, actionId: string): GuardRun {
  if (evalResult.kind === "CONFLICT") {
    return {
      output: [
        `[${CHOKEPOINT_ID}] CONFLICT: an earlier DECISION_FINAL exists for this ` +
          `identity with a DIFFERENT requestHash. Nothing was appended.`,
        "",
        "THE GATE DID NOT RUN THIS REQUEST. This is exit 2 and it is NOT a",
        "disposition: no new evaluation was performed, and the identity's",
        "existing final decision is unchanged. 2 = this invocation did not",
        "evaluate (usage, wiring, or conflict) — the machine tail's `kind=`",
        "token says which.",
        "",
        errorTailLine(actionId, "conflict"),
      ].join("\n"),
      exit: 2,
      result: null,
    };
  }
  const decision = evalResult.decision;
  const execute = decision.execute === true;
  const exit: 0 | 1 = execute ? 0 : 1;
  const delivery = evalResult.delivery;
  const deliveryLine = (label: string, d: DeliveryStatus) =>
    `trail:${d.trail} ledger:${d.ledger} history:${d.history} events:${d.events}`;
  const out: string[] = [];
  out.push(`[${CHOKEPOINT_ID}] ${GUARD_SENTENCE}`);
  out.push("");
  out.push(
    `[MICA-GUARD/JOURNAL] identity=${JSON.stringify(decision.identity)} ` +
      `replayed=${String(evalResult.replayed)} ` +
      `recordNotPersisted=${String(evalResult.recordNotPersisted === true)}`
  );
  out.push(`  disposition=${String(decision.disposition)} execute=${String(execute)}`);
  out.push(`  rationale: ${String(decision.rationale)}`);
  out.push(`  decisionHash=${String((decision as Record<string, unknown>).decisionHash ?? "n/a")}`);
  out.push(
    `  declarationBinding=${JSON.stringify((decision as Record<string, unknown>).declarationBinding)}`
  );
  out.push(`  delivery: ${deliveryLine("delivery", delivery)}`);
  if (evalResult.quarantined.length > 0) {
    out.push(
      `  QUARANTINED (orphan PREPARED with no FINAL, from a prior evaluation ` +
        `that never finalised): ${evalResult.quarantined.length} line(s)`
    );
  }
  out.push("");
  out.push(
    `MICA-GUARD action=${actionId} disposition=${String(decision.disposition)} ` +
      `execute=${String(execute)} recorded=journal:${
        evalResult.recordNotPersisted === true ? "no" : "yes"
      } exit=${String(exit)}`
  );
  return { output: out.join("\n"), exit, result: null };
}

if (require.main === module) {
  const run_ = run(process.argv.slice(2));
  console.log(run_.output);
  process.exit(run_.exit);
}
