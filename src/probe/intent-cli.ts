#!/usr/bin/env node
// ── MICA · intent-cli — the Gate-5 intent wire's hand (S116) ──────────────────
//
// ONE SENTENCE THIS TOOL IS ALLOWED TO SAY:
//
//   A rule-intent or invocation-basis record was built BY `intent-record.ts`,
//   passed every refusal that module holds, and was deposited at the registrar
//   door as the principal this process actually runs as — or it was refused,
//   by name, and nothing was deposited.
//
// ── WHY THIS EXISTS (S116 recon §4) ─────────────────────────────────────────
//
//   The recon found the wire had no hand. The only live door was
//   `deposit-cli.ts commit --claim <file>`, whose claim file is
//   `{type, target, predictedValue}` — the WIRE SHAPE. An arbiter could type a
//   JSON blob that looked exactly like a rule-intent record, and every refusal
//   `intent-record.ts` holds would be bypassed: no registry, no authored-once,
//   and no `NO_ANCHOR_ESCALATE` — the 06a §2 route the whole wire was built to
//   make unavoidable — because nothing on that path could look.
//
//   SO THIS TOOL NEVER WRITES A CLAIM FILE. It calls
//   `prepareRuleIntentSeal` / `prepareInvocationBasisSeal`, which run the
//   refusals and return the `Expectation`. The wire shape is DERIVED from the
//   authored content by the module that owns it, and is never typed by hand.
//
//   `--content <file>` is NOT a claim file and the difference is the whole
//   point: it holds AUTHORED content — a rule id, its declared protective
//   purpose, its named failure modes, its scope-frame reference — which is the
//   wire's own input. A claim file holds the wire's OUTPUT and would let the
//   author skip the wire.
//
// ── IT CALLS NO CLOCK AND MINTS NO SALT ─────────────────────────────────────
//
//   `--timestamp` and `--salt` are REQUIRED. `deposit-cli.ts` calls `Date.now()`
//   and `randomSalt()` itself, and for an ordinary deposit that is right — the
//   salt must exist only where the committer is. This tool takes both as
//   arguments instead, because S116's brief fences a clock out of this build
//   and because a rule-intent seal is an AUTHORING act whose timestamp a
//   receipt has to be able to state. The arbiter mints the salt (`randomSalt()`
//   is offered by precommit.ts) and keeps the envelope; lose it and the
//   commitment can never be revealed. That cost is real and deliberate.
//
// ── REVEAL AT SEAL, DEFAULT AND ONLY (RULED S116, the arbiter) `[LB]` ─────────────
//
//   THE STANCE: an intent record is a DECLARATION, not a secret. A basis that
//   cannot be stated openly is not a basis MICA acts on — the exception is not
//   invoked and the case escalates. So both seal acts seal AND reveal in one
//   invocation, and the plaintext is in the chain before the act it justifies.
//
//   THERE IS NO `--hold-reveal` AND THERE MUST NEVER BE ONE. A deferred reveal
//   is a justification held back until after the outcome is known, which is the
//   retro-rationalization vector this whole wire exists to price, wearing a
//   flag. A house proposal for a hold flag (the rare third-party-weakness case)
//   was withdrawn under the stance, and this comment is where that decision is
//   findable.
//
//   WHY IT IS TWO DEPOSITS AND NOT ONE. A REVEAL carries the sequence number of
//   the COMMITMENT it reveals, and that number is assigned by the REGISTRAR
//   when it sweeps — not by this process. So this hand deposits the seal, then
//   WAITS for its own commitment to appear in the book, identified by its seal
//   hash (which nothing else can produce, because nothing else holds the salt),
//   and only then deposits the reveal against the sequence the registrar
//   actually gave it.
//
//   IT NEVER PREDICTS THAT SEQUENCE. Deriving "the book has N records, so mine
//   will be N" is the stale-head defect S83's append contract exists to kill,
//   and here it would be worse than a fork: a reveal against another
//   committer's commitment records a permanent MISMATCH in someone else's
//   entry. The hand waits and reads; it does not guess.
//
//   THE WAIT IS INJECTED, NOT TUNED. `--await-attempts` and
//   `--await-interval-ms` are REQUIRED for both seal acts. How long a
//   registrar takes to sweep is a deployment fact this file has no business
//   holding an opinion about — the same reasoning `append-store.ts` gives for
//   having no retry policy of its own.
//
// ── THE BOOK IS READ, NEVER WRITTEN, ON THIS PATH ───────────────────────────
//
//   `--book-path` is opened to answer ONE question: has this rule already been
//   authored? `PrecommitBook`'s constructor reads; nothing here calls `seal`,
//   `reveal`, `grade` or `anchor` on it. The record is appended by the
//   REGISTRAR, running as its own principal, after its own sweep — which is
//   what puts the head on the witness and the ANCHOR in the chain.
//
//   THERE IS NO DEFAULT BOOK PATH, AND MISSING IT IS A REFUSAL, NOT A SKIP. A
//   seal that ran without the scan is exactly the failure this build exists to
//   end, and a tool that silently sealed when it could not look would be worse
//   than the hand-typed claim file it replaces.
//
// EXIT CODES
//   0  deposited — the frame is in the intake, named in the output
//   1  the deposit could not be written, or the book could not be opened: a
//      DEPLOYMENT fact, and nothing was deposited
//   2  usage
//   3  REFUSED BY THE WIRE — a named refusal from intent-record.ts, or the
//      NO_ANCHOR_ESCALATE route. Nothing was deposited and nothing is wrong
//      with the deployment.
//   4  SEALED BUT NOT REVEALED — the seal was deposited and the reveal was not
//      confirmed in the chain. THIS IS THE ONE OUTCOME THAT LEAVES WORK OWED:
//      the record may be sealed, unrevealed, and therefore invisible both to
//      the authored-once scan and to every reader. The output names the
//      recovery command. It is a distinct code from 1 because the deployment
//      may be perfectly healthy and the arbiter still has something to finish.

import { chmodSync, readFileSync, writeFileSync } from "fs";

import { PrecommitBook, PrecommitDeploymentActMissing } from "../precommit/precommit";
import type { CommitmentRecord, Expectation, Modality, RevealRecord } from "../precommit/precommit";
import { buildDeposit, parseOptions, resolveSelf, type Options } from "../registrar/deposit-cli";
import { writeDeposit, sealForDeposit, type DepositBody } from "../registrar/registrar";
import {
  IntentRecordRefused,
  emptyRuleIntentRegistry,
  prepareInvocationBasisSeal,
  prepareRuleIntentSeal,
  readIntentRecordClass,
  SCOPE_CIRCLES,
  type RuleIntentContent,
  type ScopeCircle,
} from "./intent-record";

export const ACTS = ["seal-rule-intent", "seal-invocation-basis", "reveal"] as const;
export type IntentAct = (typeof ACTS)[number];

/** Usage errors are their own class so main() can tell them from wire refusals. */
export class IntentCliUsage extends Error {}

function need(o: Options, key: string): string {
  const v = o[key];
  if (v === undefined) throw new IntentCliUsage(`missing required argument --${key}`);
  return v;
}

function needInteger(o: Options, key: string): number {
  const raw = need(o, key);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new IntentCliUsage(`--${key} must be a non-negative whole number, not ${raw}`);
  }
  return n;
}

function modalityOf(o: Options): Modality {
  const m = o.modality ?? "OFFERED";
  if (m !== "OFFERED" && m !== "IMPOSED" && m !== "NOT_AN_INSTRUCTION") {
    throw new IntentCliUsage(
      `--modality must be OFFERED, IMPOSED or NOT_AN_INSTRUCTION (R8), not ${m}`
    );
  }
  return m;
}

function circleOf(o: Options, key: string): ScopeCircle {
  const v = need(o, key);
  if (!(SCOPE_CIRCLES as readonly string[]).includes(v)) {
    throw new IntentCliUsage(`--${key} must be one of ${SCOPE_CIRCLES.join(", ")}, not ${v}`);
  }
  return v as ScopeCircle;
}

/**
 * Closed-shape read of the AUTHORED content file. It must NOT carry the wire's
 * own fields — no `intentRecordClass`, no `target`, no `predictedValue`, no
 * salt — because supplying any of those would be the author reaching past the
 * module that is supposed to derive them.
 */
export function readRuleIntentContentFile(raw: string): RuleIntentContent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new IntentCliUsage(`the --content file is not valid JSON: ${String(err)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new IntentCliUsage("the --content file must hold one JSON object");
  }
  const o = parsed as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(",");
  if (keys !== "declaredProtectivePurpose,namedFailureModes,ruleId,scopeFrameRef") {
    throw new IntentCliUsage(
      "the --content file must hold exactly {ruleId, declaredProtectivePurpose, " +
        "namedFailureModes, scopeFrameRef}. It must NOT carry a target, a " +
        "predictedValue, a salt or an intentRecordClass: those are the WIRE's, " +
        "derived by intent-record.ts, and an author who supplies them is " +
        "writing a claim file by another name. " +
        `Got: ${keys || "(no keys)"}.`
    );
  }
  if (typeof o.ruleId !== "string" || o.ruleId.length === 0) {
    throw new IntentCliUsage("ruleId must be a non-empty string");
  }
  if (typeof o.declaredProtectivePurpose !== "string") {
    throw new IntentCliUsage("declaredProtectivePurpose must be a string");
  }
  if (!Array.isArray(o.namedFailureModes) || !o.namedFailureModes.every((m) => typeof m === "string")) {
    throw new IntentCliUsage("namedFailureModes must be an array of strings");
  }
  if (typeof o.scopeFrameRef !== "string") {
    throw new IntentCliUsage("scopeFrameRef must be a string");
  }
  return {
    ruleId: o.ruleId,
    declaredProtectivePurpose: o.declaredProtectivePurpose,
    namedFailureModes: o.namedFailureModes as readonly string[],
    scopeFrameRef: o.scopeFrameRef,
  };
}

/**
 * Open the book for the authored-once scan. Read-only: this function
 * constructs and returns, and no caller in this file writes through it.
 *
 * ── A BOOK DIRECTORY THAT IS NOT THERE IS A REFUSAL, NOT AN EMPTY BOOK `[LB]` ─
 *
 *   `PrecommitBook` throws `PrecommitDeploymentActMissing` when the book's
 *   DIRECTORY is absent, and it is right to: a half-made book is worse than
 *   none. But the registrar creates that directory itself, on the first
 *   deposit it appends — so on a book that has never been written to, the scan
 *   cannot run at all.
 *
 *   That case is REPORTED, not swallowed. Reading "the directory is not there"
 *   as "this rule was never authored" would be the vacuous all-clear wearing a
 *   seal, and it would be wrong in the one direction that matters: it would
 *   seal. So the FIRST record into a virgin book cannot be a rule intent
 *   through this hand, and the message says so rather than leaving the arbiter
 *   with a raw stack trace. `[owed → arbiter: on the live book this does not
 *   arise, because the book already exists]`
 */
function openBookForScan(path: string): PrecommitBook {
  try {
    return new PrecommitBook({ path });
  } catch (err) {
    if (err instanceof PrecommitDeploymentActMissing) {
      throw new Error(
        `the book directory for ${path} is not there, so the authored-once scan ` +
          `could not run and NOTHING was deposited. This is not the finding that ` +
          `the rule was never authored — it is the finding that there is no book ` +
          `to ask. The REGISTRAR creates a committer's book directory when it ` +
          `appends that committer's first entry, so a book nothing has ever been ` +
          `deposited into cannot be scanned: the first record in a virgin book ` +
          `cannot be a rule intent through this hand. (${err.message})`
      );
    }
    throw err;
  }
}

/**
 * A synchronous pause that reads no clock. `Atomics.wait` blocks this thread
 * for a duration the CALLER declared; it asks the platform for no time of day,
 * which is what keeps this file's no-clock fence (IC-L) true while still
 * letting the hand wait for another process to sweep.
 */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The COMMITMENT this process sealed, found by a hash only it could produce. */
function findOwnCommitment(path: string, sealHash: string): CommitmentRecord | null {
  let book: PrecommitBook;
  try {
    book = new PrecommitBook({ path });
  } catch {
    // Mid-sweep the book can be momentarily unopenable. Not a finding yet: the
    // caller is in a declared wait and will report exhaustion if it never opens.
    return null;
  }
  for (const r of book.getAll()) {
    if (r.kind === "COMMITMENT" && r.sealed === sealHash) return r;
  }
  return null;
}

/** The REVEAL of a given commitment sequence, if the chain already holds one. */
function findRevealOf(path: string, ref: number): RevealRecord | null {
  let book: PrecommitBook;
  try {
    book = new PrecommitBook({ path });
  } catch {
    return null;
  }
  for (const r of book.getAll()) {
    if (r.kind === "REVEAL" && r.ref === ref) return r;
  }
  return null;
}

/** Poll a declared number of times, pausing a declared interval between. */
function awaitInChain<T>(attempts: number, intervalMs: number, look: () => T | null): T | null {
  for (let i = 0; i < attempts; i++) {
    const found = look();
    if (found !== null) return found;
    if (i + 1 < attempts) pause(intervalMs);
  }
  return look();
}

function writeEnvelope(o: Options, envelope: Expectation): string {
  const out = need(o, "envelope-out");
  writeFileSync(out, JSON.stringify(envelope, null, 2) + "\n", "utf8");
  try {
    chmodSync(out, 0o600);
  } catch {
    // A mount that will not hold a mode is a fact about the mount; the banner
    // below reports the path either way rather than implying it is protected.
  }
  return out;
}

export function main(argv: readonly string[]): number {
  const [act, ...rest] = argv;
  if (!(ACTS as readonly string[]).includes(act ?? "")) {
    console.error(`usage: intent-cli.ts <${ACTS.join("|")}> [options]`);
    console.error("");
    console.error("  common: --intake <dir> --roster <file> --timestamp <ms> [--modality M]");
    console.error("  seal-rule-intent:      --book-path <file> --content <file> --salt <s>");
    console.error("                         --envelope-out <file>");
    console.error("                         --await-attempts <n> --await-interval-ms <ms>");
    console.error("  seal-invocation-basis: --book-path <file> --rule-id <id> --claimed-basis <text>");
    console.error("                         --benefited-circle <C> --harmed-circle <C> --salt <s>");
    console.error("                         --envelope-out <file>");
    console.error("                         --await-attempts <n> --await-interval-ms <ms>");
    console.error("  reveal:                --book-path <file> --ref <n> --envelope <file>");
    console.error("        RECOVERY ONLY — both seal acts reveal on their own. Use this when a");
    console.error("        seal act exited 4, to finish the record it left sealed and unrevealed.");
    return 2;
  }

  let o: Options;
  try {
    o = parseOptions(rest);
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    return 2;
  }

  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  let self: string;
  let rosterEntries: number;
  let modality: Modality;
  let timestamp: number;
  try {
    modality = modalityOf(o);
    timestamp = needInteger(o, "timestamp");
    const resolved = resolveSelf(need(o, "roster"), uid);
    self = resolved.name;
    rosterEntries = resolved.entries;
  } catch (err) {
    if (err instanceof IntentCliUsage) {
      console.error(err.message);
      return 2;
    }
    // A uid the roster does not name is a DEPLOYMENT fact: the registrar would
    // refuse this frame UNKNOWN_DEPOSITOR, so this tool does not write one.
    console.error(String(err instanceof Error ? err.message : err));
    return 1;
  }

  const intake = need(o, "intake");

  /** One frame into the intake, as this principal, into this principal's book. */
  const deposit = (b: DepositBody): string =>
    writeDeposit(intake, buildDeposit(self, self, b, modality, timestamp));

  // ── the RECOVERY path ──────────────────────────────────────────────────────
  if (act === "reveal") {
    let frame: string;
    let declared: string;
    let ref: number;
    try {
      const bookPath = need(o, "book-path");
      const book = openBookForScan(bookPath);
      const envelope = JSON.parse(readFileSync(need(o, "envelope"), "utf8")) as Expectation;
      const cls = readIntentRecordClass(envelope.predictedValue);
      if (cls === null) {
        throw new IntentCliUsage(
          "that envelope does not declare an intent-record class, so it is not " +
            "one of this wire's. Reveal an ordinary commitment with " +
            "deposit-cli.ts reveal, which is the tool for it."
        );
      }
      declared = cls;
      ref = needInteger(o, "ref");

      // THE THREE CHECKS THAT MAKE A RECOVERY SAFE TO RUN TWICE.
      //
      // A standalone reveal is the one command in this hand that a human types
      // with a sequence number in it, which is the one place a wrong number can
      // come from. A reveal against the WRONG commitment is not a no-op: the
      // book records a permanent MISMATCH inside somebody else's entry. So the
      // ref is checked against the chain before anything is deposited.
      const records = book.getAll();
      const target = records.find((r) => r.sequenceNumber === ref);
      if (target === undefined || target.kind !== "COMMITMENT") {
        throw new IntentCliUsage(
          `sequence ${String(ref)} in ${bookPath} is ` +
            `${target === undefined ? "not there at all" : `a ${target.kind}, not a COMMITMENT`}. ` +
            "Nothing was deposited. A reveal against the wrong sequence writes a " +
            "permanent MISMATCH into another entry, so this hand checks first."
        );
      }
      if (target.sealed !== sealForDeposit(envelope)) {
        throw new IntentCliUsage(
          `the commitment at sequence ${String(ref)} was not sealed from this ` +
            "envelope: its seal hash and this envelope's do not agree. Nothing " +
            "was deposited. Either the ref is wrong or the envelope is not the " +
            "one that was kept for it."
        );
      }
      const already = records.find((r) => r.kind === "REVEAL" && r.ref === ref);
      if (already !== undefined) {
        throw new IntentCliUsage(
          `commitment ${String(ref)} was ALREADY revealed, at sequence ` +
            `${String(already.sequenceNumber)}. Nothing was deposited. This ` +
            "command exists to finish a seal act that exited 4, and that record " +
            "is finished — a second reveal would put a second plaintext in the " +
            "chain claiming one seal, which is a thing no reader can resolve."
        );
      }
      frame = deposit({ act: "REVEAL", ref, expectation: envelope });
    } catch (err) {
      if (err instanceof IntentCliUsage) {
        console.error(err.message);
        return 2;
      }
      console.error(String(err instanceof Error ? err.message : err));
      return 1;
    }
    console.log("intent-cli — reveal (RECOVERY)");
    console.log(`| depositor    : ${self} (uid ${String(uid)}, roster of ${String(rosterEntries)})`);
    console.log(`| class        : ${declared}`);
    console.log(`| ref          : ${String(ref)}`);
    console.log(`| frame        : ${frame}`);
    console.log("");
    console.log("  The registrar appends it, drops the head to the witness and writes");
    console.log("  the ANCHOR — this tool did none of those and certifies nothing.");
    return 0;
  }

  // ── the SEAL acts · prepare, deposit, await, reveal, deposit, await ────────
  let envelope: Expectation;
  let bookPath: string;
  let attempts: number;
  let intervalMs: number;
  let banner: readonly string[];
  try {
    bookPath = need(o, "book-path");
    attempts = needInteger(o, "await-attempts");
    intervalMs = needInteger(o, "await-interval-ms");
    if (attempts < 1) throw new IntentCliUsage("--await-attempts must be at least 1");
    const book = openBookForScan(bookPath);

    if (act === "seal-rule-intent") {
      const content = readRuleIntentContentFile(readFileSync(need(o, "content"), "utf8"));
      envelope = prepareRuleIntentSeal(emptyRuleIntentRegistry(), book, content, self, need(o, "salt"));
      banner = [
        `rule id:      ${content.ruleId}`,
        `book scanned: ${bookPath} (${book.getLoadState()}, ${String(book.length)} record(s))`,
        `target:       ${envelope.target}`,
      ];
    } else {
      const ruleId = need(o, "rule-id");
      const prepared = prepareInvocationBasisSeal(
        emptyRuleIntentRegistry(),
        book,
        ruleId,
        need(o, "claimed-basis"),
        {
          benefitedCircle: circleOf(o, "benefited-circle"),
          harmedCircle: circleOf(o, "harmed-circle"),
        },
        self,
        timestamp,
        need(o, "salt")
      );
      if (prepared.kind === "NO_ANCHOR_ESCALATE") {
        console.log("── NO_ANCHOR_ESCALATE · nothing was deposited ──────────────");
        console.log("");
        console.log(`  ${prepared.reason}`);
        console.log("");
        console.log("  This is a deployer-conformance condition, not a defect. Either");
        console.log("  the rule's declared purpose is authored and revealed first, or");
        console.log("  this invocation routes to ESCALATE as canon requires.");
        return 3;
      }
      envelope = prepared.expectation;
      banner = [
        `rule id:      ${ruleId}`,
        `anchor:       commitment seq ${String(prepared.anchor.commitmentRef)} ` +
          `(committer ${prepared.anchor.committerId}), found in ${prepared.anchorSource}`,
        `book scanned: ${bookPath} (${book.getLoadState()}, ${String(book.length)} record(s))`,
        `target:       ${envelope.target}`,
      ];
    }
  } catch (err) {
    if (err instanceof IntentRecordRefused) {
      console.log("── REFUSED BY THE WIRE · nothing was deposited ─────────────");
      console.log("");
      console.log(`  ${err.name}: ${err.message}`);
      console.log("");
      return 3;
    }
    if (err instanceof IntentCliUsage) {
      console.error(err.message);
      return 2;
    }
    console.error(String(err instanceof Error ? err.message : err));
    return 1;
  }

  const envelopePath = writeEnvelope(o, envelope);
  const sealHash = sealForDeposit(envelope);

  let sealFrame: string;
  try {
    sealFrame = deposit({ act: "COMMITMENT", sealed: sealHash });
  } catch (err) {
    console.error(
      `the deposit could not be written to ${intake}: ${String(err)}. That is a ` +
        `deployment fact — check this principal is in the intake's group — and ` +
        `NOTHING was deposited.`
    );
    return 1;
  }

  /** Everything below this line runs with a seal already in the intake. */
  const sealedButNotRevealed = (what: string, ref: number | null): number => {
    console.log("");
    console.log("── SEALED BUT NOT REVEALED · this record is UNFINISHED ─────");
    console.log("");
    console.log(`  ${what}`);
    console.log("");
    console.log("  A sealed record that is not revealed is a hash and a committer id");
    console.log("  and nothing else. It anchors no invocation, no reader can see what");
    console.log("  it declares, and the authored-once scan CANNOT SEE IT — so a later");
    console.log("  seal of the same rule will not be refused. It is not lost: the");
    console.log("  envelope below is the only thing that can finish it.");
    console.log("");
    console.log(`  envelope : ${envelopePath}`);
    console.log(`  frame    : ${sealFrame}`);
    console.log("");
    console.log("  RECOVER, once the registrar has swept and you can read the");
    console.log("  sequence number it assigned:");
    console.log(
      `    intent-cli.ts reveal --intake <dir> --roster <file> --timestamp <ms> \\`
    );
    console.log(
      `      --book-path ${bookPath} --ref ${ref === null ? "<seq>" : String(ref)} --envelope ${envelopePath}`
    );
    console.log("");
    return 4;
  };

  const commitment = awaitInChain(attempts, intervalMs, () => findOwnCommitment(bookPath, sealHash));
  if (commitment === null) {
    return sealedButNotRevealed(
      `the seal frame reached the intake, but no COMMITMENT carrying its seal ` +
        `hash appeared in ${bookPath} within the declared wait ` +
        `(${String(attempts)} attempt(s), ${String(intervalMs)} ms apart). This ` +
        `hand does not know whether the registrar has swept yet, and it will ` +
        `NOT guess a sequence number.`,
      null
    );
  }

  let revealFrame: string;
  try {
    revealFrame = deposit({ act: "REVEAL", ref: commitment.sequenceNumber, expectation: envelope });
  } catch (err) {
    return sealedButNotRevealed(
      `the seal landed at sequence ${String(commitment.sequenceNumber)}, and the ` +
        `REVEAL frame could not be written to ${intake}: ${String(err)}.`,
      commitment.sequenceNumber
    );
  }

  const reveal = awaitInChain(attempts, intervalMs, () =>
    findRevealOf(bookPath, commitment.sequenceNumber)
  );
  if (reveal === null) {
    return sealedButNotRevealed(
      `the seal landed at sequence ${String(commitment.sequenceNumber)} and the ` +
        `REVEAL frame was deposited (${revealFrame}), but no REVEAL for it ` +
        `appeared in ${bookPath} within the declared wait. It may yet land on ` +
        `the registrar's next sweep — read the book before re-running the ` +
        `recovery, which refuses a sequence that is already revealed.`,
      commitment.sequenceNumber
    );
  }

  console.log(`intent-cli — ${act}`);
  console.log(`| depositor    : ${self} (uid ${String(uid)}, roster of ${String(rosterEntries)})`);
  console.log(`| book         : ${self}`);
  console.log(`| modality     : ${modality}`);
  console.log(`| timestamp    : ${String(timestamp)} (declared, not read from a clock)`);
  for (const line of banner) console.log(`| ${line}`);
  console.log(`| COMMITMENT   : seq ${String(commitment.sequenceNumber)}  hash ${commitment.hash}`);
  console.log(`| REVEAL       : seq ${String(reveal.sequenceNumber)}  hash ${reveal.hash}`);
  console.log(`| seal check   : ${reveal.sealCheck}`);
  console.log(`| envelope     : ${envelopePath} — KEEP IT.`);
  console.log(`| frames       : ${sealFrame}`);
  console.log(`|                ${revealFrame}`);
  console.log("");
  console.log("  DECLARED AND READABLE. The plaintext is in the chain, at a sequence");
  console.log("  fixed before the act it justifies. That is the whole property this");
  console.log("  wire sells: it prices TIMING. It does not read minds, and a");
  console.log("  well-crafted pre-declared inconvenience still reads clean.");
  console.log("");
  console.log("  The registrar appended both, dropped both heads to the witness and");
  console.log("  wrote both ANCHORs — this tool did none of those and certifies nothing.");
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
