#!/usr/bin/env node
// ── MICA · declare-subject — the next rung's declaration, carried not retyped ─
//
// House dialect: standalone ts-node CLI, `main(argv)` returning an exit code.
//   npx ts-node tools/declare-subject.ts --from <existing> --out <new> \
//     --model <string> --endpoint <url> --seed <int> --temperature <number>
//
// THE ONE SENTENCE THIS TOOL MAY SAY: the declaration it wrote carries
// `subjectId`, `systemPrompt`, `basis` and `declaredBy` BYTE-IDENTICALLY from a
// declaration that already exists on disk, changes only the four fields named
// on the command line, and stamps `declaredAt` from the clock at the moment of
// writing. It reads no reply, contacts no subject, and invents no field.
//
// ── WHY THIS FILE IS NOT CALLED `declare-pilot3.ts` `[LB]` ──────────────────
//
//   `tools/declare-pilot2.ts` fills the OBSERVABLES TEMPLATE — the arbiter's
//   readings of eight replies, made after a run. This tool writes the SUBJECT
//   DECLARATION — who is about to be asked, with what — before a run. Different
//   artifact, different moment, different act.
//
//   A file called `declare-pilot3.ts` sitting beside `declare-pilot2.ts` would
//   read as "the same tool, next pilot" and it is not. The next seat would open
//   it looking for a rulings table and find a declaration writer. That is drift
//   by filename, and this repository has spent sessions on smaller versions of
//   it. So the name says the ARTIFACT, not the pilot.
//
//   And because it says the artifact, THERE IS NO PILOT NUMBER IN THIS FILE AT
//   ALL. Pilot 4 and pilot 5 need no new file and no edit here: they are two
//   different `--model` values and a different `--out`.
//
// ── THE MODEL NAME IS NEVER TYPED IN CODE, AND NEITHER IS THE ENDPOINT ──────
//
//   `subject-declaration.ts`'s own header (brief §3.0): "Not in this file, not
//   in the runner, not in either test. The model is a string the arbiter writes
//   into the declaration. A literal here would make the repo quietly
//   authoritative about which subject the pilot ran against."
//
//   That rule is why `--model` and `--endpoint` are FLAGS and not a table keyed
//   by pilot. `declare-subject.test.ts` DS-9 proves it behaviourally rather than
//   by grepping: the same source declaration through two different `--model`
//   values produces two different outputs, which a hardcoded name could not do.
//
// ── WHAT IS CARRIED, AND WHY IT IS CARRIED RATHER THAN RETYPED `[LB]` ───────
//
//   `subjectId` · `systemPrompt` · `basis` · `declaredBy`
//
//   The `systemPrompt` is the reason this tool exists. Pilot 3 is only
//   comparable with pilots 1 and 2 if the framing is the same WORDS — and a
//   multi-line prompt retyped by a human, or pasted through a terminal, or
//   round-tripped through a chat window, is a prompt that may differ by a
//   newline nobody can see. A different frame is a different question, and a
//   pilot that silently asked a different question would produce a comparison
//   that is not one.
//
//   So the bytes never leave the box: this tool reads them from `--from` and
//   writes them to `--out`, and `assertCarried` below re-checks all four AFTER
//   the output has been round-tripped through the real loader. The check is not
//   a reminder; it is the last thing that runs before the file is written.
//
//   `[TG]` `systemPrompt` is PRINTED AS A SHA AND A BYTE COUNT, never as text.
//   Not secrecy — a prompt splashed across a terminal is a prompt someone can
//   copy, and copying is the failure this tool prevents. The sha is what the
//   register row should carry.
//
// ── WHAT IS RULED, AND SO IS A FLAG ────────────────────────────────────────
//
//   `model` · `endpoint` · `options.seed` · `options.temperature`
//
//   `thinkFlag` is NOT a flag: it is literally `false` and the loader refuses
//   anything else ("Thinking is ruled OFF ... changing that is a ruling, not a
//   JSON edit"). This tool does not get to be the JSON edit either.
//
//   `options.seed` IS CARRIED BY THE DECLARATION AND MAY NOT BE SENT BY WHAT
//   ANSWERS. That is not this tool's business — the declaration schema requires
//   a seed, so a seed is written. What a proxy in front of the subject forwards
//   is the proxy's own ruled behaviour and its own log. Both facts are true and
//   they answer different questions.
//
// ── THE CLOCK, AND WHY THIS FILE READS ONE WHERE ITS NEIGHBOUR REFUSES TO ──
//
//   `declare-pilot2.ts` calls no clock, deliberately: `declaredAt` there is the
//   moment a HUMAN READ a reply, and a default clock would be that layer
//   inventing a fact about when someone read something.
//
//   Here `declaredAt` is the moment the subject was DECLARED — and running this
//   tool, by the declaring principal's own hand, IS that act. The clock is
//   therefore reporting the act it is part of rather than guessing at one it
//   was not present for. There is deliberately no `--declared-at` flag: an
//   operator-supplied timestamp on a declaration written by this tool could
//   only ever be less true than the clock.
//
//   The clock is INJECTABLE (`now`) so the tests are deterministic. That seam
//   is not reachable from the command line.
//
// ── REFUSALS — nothing is written on any of them ───────────────────────────
//
//   · any flag missing, or a seed/temperature that is not a number
//   · `--from` does not exist, or does not validate as a declaration
//   · `--endpoint` is not loopback (the runner refuses it later with
//     `--endpoint-must-be-loopback`; failing here is the same refusal, hours
//     earlier and before a unit is launched)
//   · the built declaration does not itself validate
//   · any carried field is not byte-identical to `--from`'s
//   · `--out` already exists. NEVER over a declaration: an existing one may be
//     the file a run is using, and this tool has no business being the thing
//     that replaced it mid-flight.
//
// EXIT CODES
//   0  a dry plan was printed, or the declaration was written
//   2  REFUSED, by name, with nothing written

import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";

import {
  isLoopbackEndpoint,
  loadSubjectDeclaration,
  parseSubjectDeclaration,
  SubjectDeclarationRefused,
  SUBJECT_DECLARATION_KEYS,
  type SubjectDeclaration,
} from "../src/probe/subject/subject-declaration";

export const EXIT = { OK: 0, REFUSED: 2 } as const;

export class DeclareSubjectRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeclareSubjectRefused";
  }
}

/**
 * The four fields that must arrive unchanged. Named once, here, and used by
 * both the builder and the assertion — a second copy of this list is a second
 * thing that can drift from the first.
 */
export const CARRIED_FIELDS = ["subjectId", "systemPrompt", "basis", "declaredBy"] as const;

/**
 * ── S132 · `--system-prompt-file`: THE SERIES BOUNDARY, AND WHY IT IS A FILE ──
 *
 *   Pilots 1-6 share one prompt and this tool exists to keep it that way. Canon
 *   08r went LIVE at S132 and is part of the instrument: a run under it asks a
 *   different question, so pilot 7 is SERIES 2 and needs a prompt this tool had
 *   no way to supply. That is not a gap in the design — carrying was the design
 *   — so the replacement is not a quiet widening of `buildNext`. It is its own
 *   flag, its own refusal, and its own line in the plan that says REPLACED.
 *
 *   IT IS A FILE AND NEVER A STRING ARGUMENT, for the header's own reason one
 *   level along. The whole thesis of this tool is that a multi-line prompt
 *   retyped by a human, pasted through a terminal, or round-tripped through a
 *   chat window is a prompt that may differ by a newline nobody can see.
 *   Accepting `--system-prompt <text>` would rebuild exactly that failure at the
 *   shell, where `$` and backslashes and line continuations all get a vote. A
 *   path moves bytes; an argument moves a transcription.
 *
 *   ONE TRAILING NEWLINE IS STRIPPED, AND NOTHING ELSE IS TOUCHED. Every editor
 *   and every heredoc ends a text file with one, and a prompt that silently
 *   gained a byte the author never typed is the same defect in a new place. One
 *   — not all trailing whitespace, which would let a real blank line vanish.
 *   Said out loud in the plan so the two shas can be told apart.
 *
 *   WHAT DOES NOT CHANGE: `subjectId`, `basis` and `declaredBy` are still
 *   carried byte-identically and still re-checked after the round trip. The
 *   prompt leaves that set ONLY for the run that names the flag, and
 *   `assertCarried` is told which field was replaced rather than having the
 *   check removed.
 */
export const PROMPT_REPLACED_FIELD = "systemPrompt" as const;

/** The four the command line rules. `thinkFlag` is not among them — see the header. */
export const RULED_FIELDS = ["model", "endpoint", "options.seed", "options.temperature"] as const;

export interface DeclareSubjectArgs {
  readonly from: string;
  readonly out: string;
  readonly model: string;
  readonly endpoint: string;
  readonly seed: number;
  readonly temperature: number;
  readonly dryRun: boolean;
  /** S132: absent means CARRY (pilots 1-6). Present means REPLACE — series 2. */
  readonly systemPromptFile?: string;
}

export function parseArgs(argv: readonly string[]): DeclareSubjectArgs {
  const values = new Map<string, string>();
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (!a.startsWith("--")) throw new DeclareSubjectRefused(`refused: unexpected argument "${a}".`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      throw new DeclareSubjectRefused(`refused: ${a} requires a value.`);
    }
    values.set(a, v);
    i++;
  }

  const required = ["--from", "--out", "--model", "--endpoint", "--seed", "--temperature"];
  const missing = required.filter((f) => !values.has(f));
  if (missing.length > 0) {
    throw new DeclareSubjectRefused(
      `refused: not supplied: ${missing.join(", ")}. Every flag is required; this tool defaults ` +
        `nothing — the same rule the declaration loader itself holds.`
    );
  }

  const seedText = values.get("--seed") as string;
  if (!/^-?\d+$/.test(seedText)) {
    throw new DeclareSubjectRefused(`refused: --seed "${seedText}" is not an integer.`);
  }
  const temperatureText = values.get("--temperature") as string;
  const temperature = Number(temperatureText);
  if (temperatureText.trim() === "" || !Number.isFinite(temperature)) {
    throw new DeclareSubjectRefused(
      `refused: --temperature "${temperatureText}" is not a finite number.`
    );
  }

  return {
    from: values.get("--from") as string,
    out: values.get("--out") as string,
    // OPTIONAL, and the only optional flag this tool has. Its absence is the
    // behaviour every pilot to date used; its presence is a series boundary.
    ...(values.has("--system-prompt-file")
      ? { systemPromptFile: values.get("--system-prompt-file") as string }
      : {}),
    model: values.get("--model") as string,
    endpoint: values.get("--endpoint") as string,
    seed: Number(seedText),
    temperature,
    dryRun,
  };
}

/**
 * Build the next declaration from an existing one.
 *
 * The four carried fields are read off `from` — the PARSED object, so they have
 * already survived the loader's own refusals — and the four ruled ones come
 * from `args`. Key order follows `SUBJECT_DECLARATION_KEYS`, which is also the
 * order the loader declares them in, so a human diffing two declarations sees
 * fields in the same places.
 */
export function buildNext(
  from: SubjectDeclaration,
  args: DeclareSubjectArgs,
  now: () => Date
): SubjectDeclaration {
  const candidate = {
    subjectId: from.subjectId,
    model: args.model,
    // Literal, and the loader is the fence. See the header.
    thinkFlag: false,
    options: { seed: args.seed, temperature: args.temperature },
    systemPrompt: args.systemPromptFile === undefined
      ? from.systemPrompt
      : readReplacementPrompt(args.systemPromptFile),
    endpoint: args.endpoint,
    basis: from.basis,
    declaredBy: from.declaredBy,
    declaredAt: now().toISOString(),
  };
  // ROUND-TRIPPED THROUGH THE REAL LOADER before anyone sees it. A declaration
  // this tool would write but the runner would refuse is a file that costs a
  // deployment window to discover.
  return parseSubjectDeclaration(candidate);
}

/**
 * THE LAST THING THAT RUNS BEFORE THE WRITE.
 *
 * Compared AFTER the round trip, not before it: the question is whether the
 * bytes that are about to reach disk match, and a check against the object as
 * built would not have watched the loader touch them.
 */
/**
 * The replacement prompt's bytes, with ONE trailing newline removed. Refuses an
 * empty file rather than writing a declaration with no frame in it — the loader
 * would refuse it later, and later is a deployment window away.
 */
export function readReplacementPrompt(path: string): string {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new DeclareSubjectRefused(
      `refused: --system-prompt-file ${path} could not be read (${String(err)}). Nothing was written.`
    );
  }
  const prompt = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  if (prompt.trim().length === 0) {
    throw new DeclareSubjectRefused(
      `refused: --system-prompt-file ${path} holds no prompt. A declaration with an empty ` +
        `frame asks nothing, and the runner would refuse it a deployment window from now. ` +
        `Nothing was written.`
    );
  }
  return prompt;
}

export function assertCarried(
  from: SubjectDeclaration,
  made: SubjectDeclaration,
  replaced?: typeof PROMPT_REPLACED_FIELD
): void {
  for (const field of CARRIED_FIELDS) {
    // S132: the replaced field is EXCLUDED, never un-checked. The loop still
    // runs over all four and still refuses a drift in the other three; what the
    // flag buys is one named exemption, for one run, printed as REPLACED.
    if (field === replaced) {
      if (made[field] === from[field]) {
        throw new DeclareSubjectRefused(
          `refused: --system-prompt-file was given and the ${field} is IDENTICAL to the ` +
            `source's. That is not a series boundary, it is a no-op wearing one — and the ` +
            `register row it produces would say series 2 about the same question pilots 1-6 ` +
            `were asked. Drop the flag, or give the file the prompt that differs. Nothing ` +
            `was written.`
        );
      }
      continue;
    }
    if (made[field] !== from[field]) {
      throw new DeclareSubjectRefused(
        `refused: ${field} was not carried. The whole point of this tool is that the four ` +
          `carried fields arrive byte-identical; a difference here means the declaration ` +
          `about to be written asks a different question than the one it claims to repeat. ` +
          `Nothing was written.`
      );
    }
  }
}

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** What a human should be able to read back off the terminal and into a register row. */
export function planLines(
  args: DeclareSubjectArgs,
  from: SubjectDeclaration,
  made: SubjectDeclaration
): string[] {
  const bytes = Buffer.byteLength(made.systemPrompt, "utf8");
  const replaced = args.systemPromptFile !== undefined;
  const carried = CARRIED_FIELDS.filter((f) => !replaced || f !== PROMPT_REPLACED_FIELD);
  return [
    `from        ${args.from}`,
    `out         ${args.out}`,
    ``,
    `CARRIED, byte-identical (${carried.join(", ")}):`,
    `  subjectId     ${made.subjectId}`,
    `  basis         ${made.basis}`,
    `  declaredBy    ${made.declaredBy}`,
    // Never the text. See the header.
    ...(replaced
      ? [
          ``,
          `REPLACED — THIS IS A SERIES BOUNDARY, NOT AN EDIT:`,
          `  systemPrompt  ${String(bytes)} B  sha256 ${sha256(made.systemPrompt)}`,
          `                (was ${String(Buffer.byteLength(from.systemPrompt, "utf8"))} B  sha256 ${sha256(
            from.systemPrompt
          )})`,
          `  source file   ${String(args.systemPromptFile)}`,
          `                one trailing newline stripped if the file had one; nothing else touched`,
          `  A run under this prompt is NOT comparable with a run under the one it`,
          `  replaces. The register row has to say which series it belongs to.`,
        ]
      : [
          `  systemPrompt  ${String(bytes)} B  sha256 ${sha256(made.systemPrompt)}`,
          `                (source ${String(Buffer.byteLength(from.systemPrompt, "utf8"))} B  sha256 ${sha256(
            from.systemPrompt
          )})`,
        ]),
    ``,
    `RULED by the command line:`,
    `  model         ${made.model}      (was ${from.model})`,
    `  endpoint      ${made.endpoint}      (was ${from.endpoint})`,
    `  options.seed         ${String(made.options.seed)}      (was ${String(from.options.seed)})`,
    `  options.temperature  ${String(made.options.temperature)}      (was ${String(
      from.options.temperature
    )})`,
    `  thinkFlag     false      (not a flag — the loader refuses anything else)`,
    ``,
    `STAMPED at write time:`,
    `  declaredAt    ${made.declaredAt}`,
  ];
}

export function run(
  args: DeclareSubjectArgs,
  out: (s: string) => void,
  now: () => Date = () => new Date()
): number {
  if (!isLoopbackEndpoint(args.endpoint)) {
    throw new DeclareSubjectRefused(
      `refused: --endpoint ${args.endpoint} is not loopback. The runner refuses a non-loopback ` +
        `endpoint at launch under --endpoint-must-be-loopback; this is the same refusal, before ` +
        `a unit is started rather than after.`
    );
  }
  // Checked BEFORE the source is read, so the refusal cannot depend on whether
  // the source happened to be readable by whoever ran this.
  if (existsSync(args.out)) {
    throw new DeclareSubjectRefused(
      `refused: ${args.out} already exists. This tool never writes over a declaration — an ` +
        `existing one may be the file a run is reading right now. Move it aside or name another ` +
        `path.`
    );
  }

  const from = loadSubjectDeclaration(args.from);
  const made = buildNext(from, args, now);
  assertCarried(from, made, args.systemPromptFile === undefined ? undefined : PROMPT_REPLACED_FIELD);

  for (const line of planLines(args, from, made)) out(line);
  out(``);

  if (args.dryRun) {
    out(`--dry-run: NOTHING WAS WRITTEN. Re-run without it to write ${args.out}.`);
    return EXIT.OK;
  }

  const text = JSON.stringify(orderedForWrite(made), null, 2) + "\n";
  // `wx` so a file that appeared between the check above and this line is still
  // a refusal rather than an overwrite; 0o640 so it is born no wider than the
  // captures file beside it (S122 §2.4's reasoning, one artifact along).
  writeFileSync(args.out, text, { encoding: "utf8", flag: "wx", mode: 0o640 });
  out(`written ${args.out}  ${String(Buffer.byteLength(text, "utf8"))} B  sha256 ${sha256(text)}`);
  out(
    `the declaration is NOT in place until it is installed where the runner's principal can ` +
      `read it — that is a deployment act, not this tool's.`
  );
  return EXIT.OK;
}

/** `SUBJECT_DECLARATION_KEYS` order, so two declarations diff line by line. */
function orderedForWrite(d: SubjectDeclaration): Record<string, unknown> {
  const source = d as unknown as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const k of SUBJECT_DECLARATION_KEYS) ordered[k] = source[k];
  return ordered;
}

export async function main(argv: readonly string[]): Promise<number> {
  try {
    const args = parseArgs(argv);
    return run(args, (s) => {
      console.log(s);
    });
  } catch (err) {
    console.error(`declare-subject: ${err instanceof Error ? err.message : String(err)}`);
    return err instanceof DeclareSubjectRefused || err instanceof SubjectDeclarationRefused
      ? EXIT.REFUSED
      : EXIT.REFUSED;
  }
}

if (require.main === module) {
  void main(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
