// MICA review writer (S118, brief section 7 applied).
// The one sentence this tool may say: these records were appended through
// ReviewLogStore; this declared seat and timestamp certify nothing.
// Each append has its own lock. Multi-record acts are NOT atomic; a stopped
// prefix stays on disk and is counted. No retry, rollback, default path or clock.
// Seat names are declarations, not uid/roster authentication. Only signatures
// persist a seat in the existing schema; other acts display the declaration.
//
// ── THE `chain` ACT (S132, brief §1.2) — and the two things it never types ───
//
//   `chain` appends one CHAIN_REVIEW: this seat opened this evidence file, ran
//   the chain verify that already existed in `EvidenceLogStore`, and the sha it
//   saw was this one. It grades nothing and reads no observable.
//
//   THE SHA IS COMPUTED, NEVER TYPED. There is no `--sha` flag and there must
//   never be one: a digest an operator can type is a digest an operator can
//   type wrong, and the whole value of this record is that its sha came off the
//   bytes. `RC-CHAIN-3` asserts the flag's ABSENCE, so adding one turns a
//   suite red rather than quietly widening the claim.
//
//   THE RUN ID IS DERIVED, NEVER TYPED EITHER — and it is the WEAKER of the two
//   facts, which is why it is said out loud here. A run id exists nowhere in an
//   evidence chain: `ingest-cli.ts` composes it into the FILENAME
//   (`evidence_<subjectId>_<runId>.jsonl`) and the records carry no copy. So
//   this act inverts that one rule over the basename and refuses a name that
//   does not decompose, rather than accepting a typed claim about which run a
//   file holds. What the record then says is exactly: the file at this path,
//   whose name decomposes to this run id, hashed to this sha. A renamed file
//   carries a wrong run id and a right sha, and the sha is the fact a reader
//   matches on.
//
//   THE SUBJECT IS CROSS-CHECKED, NOT TAKEN. The filename's subjectId is
//   compared against the `provenance.subjectId` the chain's own ATTEMPTs carry,
//   and a CONTRADICTION refuses. A chain carrying NO provenance (written before
//   S120) does not refuse — absence is not contradiction — and the act says
//   which of the two it had. That distinction is `evidence-read-cli.ts`'s own
//   rule about ABSENT records, applied one layer up.
//
//   THE FILE IS HASHED TWICE, AROUND THE LOAD. `EvidenceLogStore` opens the
//   path itself, so a single hash taken before or after it would describe bytes
//   that are not necessarily the bytes that were verified. Both hashes must
//   agree or the act refuses: a file that moved under the read is a finding,
//   not something to record a sha for.

import { createHash } from "crypto";
import { readFileSync } from "fs";
import { basename, resolve } from "path";

import {
  closeReview, createSignature, initializeReview, recordInitialJudgment,
  recordRevisedJudgment, reveal, selectForReview, ReviewRecordRefused,
  SignatureRefused, type BatchClaim, type ReviewRecord, type ReviewSelectionRule,
} from "./review";
import {
  CHAIN_VERIFY_VALID, ReviewLogRefused, chainVerifyBroken,
  type ChainReview, type ChainReviewRecord, type ReviewLogRecord,
} from "./review-log";
// S133 wire B. `deposit-cli.ts` guards its own `main` with `require.main ===
// module`, so importing its two library functions runs nothing: the journal
// primitive and the roster resolution are shared with the registrar's depositor
// rather than re-implemented beside it, which is the whole reason the cursor
// semantics cannot drift between the two writers of this one book.
import { journalAct, resolveSelf } from "../registrar/deposit-cli";
import { EvidenceLogStore, EvidenceStoreDeploymentActMissing } from "./evidence-store";
import { LEDGER_EVENT_TYPE, findLedgerDeposit } from "./ledger-lookup";
import { EVIDENCE_DOMAIN_TAG } from "./evidence-log";
import { readVintage } from "../deploy/vintage";
import { ReviewLogStore, type ReviewAppendOutcome } from "./review-store";
import { WITHHELD } from "./evidence-read-cli";
import { GRADING_VERDICTS, type GradingVerdict } from "./scenario";
import { loadHeldOutScenarios, loadStandardScenarios, type BookRole } from "./scenario-seal";
import { N1_FAMILY } from "./families/n1";
import { N2_FAMILY } from "./families/n2";
import { N3_FAMILY } from "./families/n3";
import { N4_FAMILY } from "./families/n4";
import { N5_FAMILY } from "./families/n5";
import { W_FAMILY } from "./families/w";
import { SIGMA_TIME_FAMILY } from "./families/sigma-time";
import { SIGMA_DOUBT_FAMILY } from "./families/sigma-doubt";
import { SIGMA_DEFECT_FAMILY } from "./families/sigma-defect";
import { SIGMA_UNMON_FAMILY } from "./families/sigma-unmon";
import { SIGMA_CONFLICT_FAMILY } from "./families/sigma-conflict";
import { G5_FAMILY } from "./families/g5";
import { HELD_OUT_FAMILY } from "./families/held-out";

export const REVIEW_CLI_EXIT = { APPENDED: 0, DEPLOYMENT: 1, USAGE: 2, REFUSED: 3 } as const;

const ACTS = ["select", "initial", "reveal", "revise", "close", "sign", "chain", "deposit"] as const;
type Act = (typeof ACTS)[number];
class ReviewCliUsage extends Error {}
class AppendUnavailable extends Error {}
/** The chain named by `--chain` cannot be reviewed. Nothing is appended. */
class ChainNotReviewable extends Error {}

const FAMILIES = [
  ...N1_FAMILY, ...N2_FAMILY, ...N3_FAMILY, ...N4_FAMILY, ...N5_FAMILY,
  ...W_FAMILY, ...SIGMA_TIME_FAMILY, ...SIGMA_DOUBT_FAMILY, ...SIGMA_DEFECT_FAMILY,
  ...SIGMA_UNMON_FAMILY, ...SIGMA_CONFLICT_FAMILY, ...G5_FAMILY, ...HELD_OUT_FAMILY,
];

interface Options {
  readonly act: Act;
  readonly log: string;
  readonly timestamp: number;
  readonly seat: string;
  readonly caseId?: string;
  readonly judgment?: GradingVerdict;
  readonly role?: BookRole;
  readonly rule?: ReviewSelectionRule;
  readonly cases?: readonly string[];
  readonly batchClaim?: BatchClaim;
  readonly chainPath?: string;
  /** S133 wire B — all three together or none. See `parseOptions`. */
  readonly deposit?: {
    readonly micaLog: string;
    readonly micaLogCursor: string;
    readonly roster: string;
  };
}

function parseOptions(argv: readonly string[]): Options {
  const [rawAct, ...rest] = argv;
  if (!(ACTS as readonly string[]).includes(rawAct)) {
    throw new ReviewCliUsage(`usage: review-cli.ts <${ACTS.join("|")}> --log <path> --timestamp <ms> --seat <id>; ` +
      "select: --role STANDARD|HELD_OUT --rule-fraction <0..1] --rule-seed <integer>; " +
      "initial/revise: --case <id> --judgment <verdict>; reveal/close: --case <id>; " +
      "sign: --cases a,b,c OR --batch-claim <inline-json>; " +
      "chain: --chain <evidence-log path> (there is NO --sha: the digest is computed) " +
      "[--mica-log <path> --mica-log-cursor <path> --roster <path>: deposit the review " +
      "into the machine's ledger, all three or none]; " +
      "deposit: --chain <evidence-log path> --mica-log <path> --mica-log-cursor <path> " +
      "--roster <path> — deposits a review that ALREADY EXISTS; appends nothing");
  }
  const act = rawAct as Act;
  const specific: Record<Act, readonly string[]> = {
    select: ["role", "rule-fraction", "rule-seed"],
    initial: ["case", "judgment"], reveal: ["case"], revise: ["case", "judgment"],
    close: ["case"], sign: ["cases", "batch-claim"],
    chain: ["chain", "mica-log", "mica-log-cursor", "roster"],
    deposit: ["chain", "mica-log", "mica-log-cursor", "roster"],
  };
  const allowed = new Set(["log", "timestamp", "seat", ...specific[act]]);
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const key = flag.startsWith("--") ? flag.slice(2) : "";
    if (!allowed.has(key)) throw new ReviewCliUsage(`unknown option for ${act}: ${flag}`);
    if (flags.has(key)) throw new ReviewCliUsage(`duplicate --${key}`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) throw new ReviewCliUsage(`--${key} needs a value`);
    flags.set(key, value);
  }
  const need = (key: string): string => {
    const value = flags.get(key);
    if (value === undefined) throw new ReviewCliUsage(`missing required argument --${key}`);
    return value;
  };
  const nonempty = (key: string): string => {
    const value = need(key);
    if (value.trim().length === 0) throw new ReviewCliUsage(`--${key} must not be empty`);
    return value;
  };
  const integer = (key: string, nonnegative: boolean): number => {
    const value = Number(nonempty(key));
    if (!Number.isSafeInteger(value) || (nonnegative && value < 0)) {
      throw new ReviewCliUsage(`--${key} must be a ${nonnegative ? "non-negative " : ""}safe integer`);
    }
    return value;
  };
  const common = { act, log: nonempty("log"), timestamp: integer("timestamp", true), seat: need("seat") };
  // Let createSignature own its empty-seat refusal; no parallel copy of it.
  if (act !== "sign" && common.seat.trim().length === 0) throw new ReviewCliUsage("--seat must not be empty");
  if (act === "select") {
    const role = need("role");
    if (role !== "STANDARD" && role !== "HELD_OUT") throw new ReviewCliUsage("--role must be STANDARD or HELD_OUT");
    const fraction = Number(nonempty("rule-fraction"));
    if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
      throw new ReviewCliUsage("--rule-fraction must be greater than 0 and at most 1");
    }
    const seed = integer("rule-seed", false);
    return { ...common, role, rule: { ruleId: "EDGE_CASES_FIRST_PLUS_FRACTION_SAMPLE", fraction, seed } };
  }
  if (act === "chain") {
    // S133 WIRE B · THE DEPOSIT IS THREE FLAGS, ALL OR NONE — not a bare
    // `--deposit`. This parser reads flags in `--key value` pairs and has no
    // valueless flag anywhere; adding the first one would change how EVERY act
    // is parsed, to save typing two paths on a line an arbiter runs by hand.
    // The all-or-nothing rule and the first two names are `deposit-cli.ts`'s
    // own, verbatim, so the two tools that write this journal ask for it the
    // same way. `--roster` is the third because identity here is
    // uid-through-roster and never a flag: `--seat` says which seat REVIEWED,
    // and the ledger records which PRINCIPAL wrote, and they are not the same
    // question.
    const parts = ["mica-log", "mica-log-cursor", "roster"];
    const given = parts.filter((k) => flags.has(k));
    if (given.length !== 0 && given.length !== parts.length) {
      throw new ReviewCliUsage(
        `--${parts.join(", --")} must be supplied together, or not at all (got ` +
          `--${given.join(", --")}). A deposit with no cursor mints a sequenceNumber ` +
          `nothing persists, and a deposit with no roster would have to take a ` +
          `principal's name from a flag.`
      );
    }
    return {
      ...common,
      chainPath: nonempty("chain"),
      ...(given.length === parts.length
        ? {
            deposit: {
              micaLog: nonempty("mica-log"),
              micaLogCursor: nonempty("mica-log-cursor"),
              roster: nonempty("roster"),
            },
          }
        : {}),
    };
  }
  if (act === "deposit") {
    // S133 · ALL FOUR ARE REQUIRED HERE, where `chain`'s three are optional —
    // and the difference is the whole point of the act. On `chain` the deposit
    // is a rider on a review that is being written; here the deposit IS the act,
    // so a `deposit` with no ledger to write to is not a quieter deposit, it is
    // nothing at all, and it refuses at the usage line rather than at the end.
    return {
      ...common,
      chainPath: nonempty("chain"),
      deposit: {
        micaLog: nonempty("mica-log"),
        micaLogCursor: nonempty("mica-log-cursor"),
        roster: nonempty("roster"),
      },
    };
  }
  if (act === "sign") {
    if (flags.has("cases") === flags.has("batch-claim")) {
      throw new ReviewCliUsage("sign requires exactly one of --cases or --batch-claim");
    }
    if (flags.has("cases")) {
      const raw = need("cases");
      const cases = raw === "" ? [] : raw.split(",").map((id) => id.trim());
      if (cases.some((id) => id.length === 0) || new Set(cases).size !== cases.length) {
        throw new ReviewCliUsage("--cases must contain distinct, nonempty comma-separated ids");
      }
      return { ...common, cases };
    }
    let batchClaim: unknown;
    try { batchClaim = JSON.parse(need("batch-claim")); }
    catch { throw new ReviewCliUsage("--batch-claim must be inline JSON"); }
    // The store's existing closed-shape validator owns batch-claim validation.
    // This cast does not validate it: malformed JSON values reach that refusal.
    return { ...common, batchClaim: batchClaim as BatchClaim };
  }
  const caseId = nonempty("case");
  if (act === "initial" || act === "revise") {
    const judgment = need("judgment");
    if (!(GRADING_VERDICTS as readonly string[]).includes(judgment)) {
      throw new ReviewCliUsage(`--judgment must be one of ${GRADING_VERDICTS.join(", ")}`);
    }
    return { ...common, caseId, judgment: judgment as GradingVerdict };
  }
  return { ...common, caseId };
}

// ── the `chain` act ──────────────────────────────────────────────────────────

/**
 * The inverse of `ingest-cli.ts`'s `composeLogPath`, and the ONLY place a run
 * id comes from. The run-id group forbids `_` — that is `ingest-cli`'s own
 * charset, not a convenience here — so the greedy subject group lands exactly
 * on the last underscore and the decomposition is unambiguous.
 */
const CHAIN_BASENAME = /^evidence_(.+)_([A-Za-z0-9][A-Za-z0-9._-]*)\.jsonl$/;

function decomposeChainPath(path: string): { subjectId: string; runId: string } {
  const match = CHAIN_BASENAME.exec(basename(path));
  if (match === null) {
    throw new ChainNotReviewable(
      `the file name does not decompose into a subject and a run: expected ` +
        `evidence_<subjectId>_<runId>.jsonl as ingest-cli.ts composes it, got ` +
        `${JSON.stringify(basename(path))}. Nothing was appended: a CHAIN_REVIEW ` +
        `names a run, and this tool will not accept a typed one.`
    );
  }
  return { subjectId: match[1], runId: match[2] };
}

function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** The relay's claim about the tree this process is executing, or which unknown. */
function readerVersion(): string {
  const reading = readVintage();
  return reading.state === "READ" ? (reading.commit as string) : `UNKNOWN:${reading.state}`;
}

/**
 * Builds the record, or refuses. Appends nothing and opens the review log not
 * at all — so every refusal below leaves the review trail byte-identical.
 */
function reviewTheChain(rawPath: string, seat: string): ChainReview {
  const chainPath = resolve(rawPath);
  const { subjectId, runId } = decomposeChainPath(chainPath);

  let shaBefore: string;
  try {
    shaBefore = sha256OfFile(chainPath);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    throw new ChainNotReviewable(
      `the chain at ${chainPath} could not be read (${error.code ?? error.name}). ` +
        `Nothing was appended.`
    );
  }

  const store = new EvidenceLogStore({ path: chainPath });
  const loadState = store.getLoadState();
  const verification = store.verify();

  if (loadState !== "LOADED_VERIFIED") {
    // OLD IS NOT BROKEN, AND IT IS ASKED FIRST (S132). A chain written under a
    // superseded preimage is intact; calling it `broken@0` tells an operator to
    // go looking for a tamper that never happened. Reader A has drawn this line
    // since S125 (its exit 10) and this act was reporting the other sentence for
    // the same file — `pilot2-n5` refused `broken@0` at the S132 back-fill while
    // Reader A called pilot 1 superseded, two tools disagreeing about one class
    // of fact. The store's own recognizer decides it; this reads the answer.
    const superseded = store.getSupersededChainTag();
    if (superseded !== null) {
      throw new ChainNotReviewable(
        `this chain is OLDER THAN THIS READER: written under ${superseded}, which ` +
          `${EVIDENCE_DOMAIN_TAG} cannot re-derive. It is intact, and this is NOT the ` +
          `finding that it is broken or tampered with. NOTHING was appended — a ` +
          `CHAIN_REVIEW says "verify valid at this sha", and a verify this reader ` +
          `cannot run is not a verify that failed. The read already ratified for this ` +
          `chain stands where it was ratified; re-deriving history here would not be ` +
          `verifying it.`
      );
    }
    // A LOCATED break is a different finding from "this could not be
    // established", and the operator's next move differs, so they are named
    // apart — `evidence-read-cli.ts`'s exit 5 / exit 4 split, one layer up.
    const why =
      verification.brokenAt !== null
        ? `the chain verify came back ${chainVerifyBroken(verification.brokenAt)}`
        : `the store did not reach LOADED_VERIFIED (${loadState}); no break was located, ` +
          `so what failed is upstream of the chain`;
    throw new ChainNotReviewable(
      `${why}. NOTHING was appended: the only sentence a CHAIN_REVIEW may say is ` +
        `"verify valid at this sha", and this chain does not let it be said.`
    );
  }
  if (!verification.valid) {
    throw new ChainNotReviewable(
      `the store loaded but verify came back ${chainVerifyBroken(verification.brokenAt ?? 0)}; ` +
        `nothing was appended.`
    );
  }

  // WHAT THE CHAIN ITSELF SAYS ABOUT WHOSE RUN IT IS. Contradiction refuses;
  // absence does not — see the header.
  const declared = new Set<string>();
  for (const record of store.records()) {
    if (record.kind === "ATTEMPT" && record.provenance !== undefined) {
      declared.add(record.provenance.subjectId);
    }
  }
  if (declared.size > 1) {
    throw new ChainNotReviewable(
      `the chain's ATTEMPTs name ${String(declared.size)} different subjects ` +
        `(${[...declared].sort().join(", ")}); a CHAIN_REVIEW names one. Nothing was appended.`
    );
  }
  if (declared.size === 1 && !declared.has(subjectId)) {
    throw new ChainNotReviewable(
      `the file name says subject ${JSON.stringify(subjectId)} and the chain's own ` +
        `provenance says ${JSON.stringify([...declared][0])}. Nothing was appended: a ` +
        `renamed file is a finding, not something to certify.`
    );
  }
  console.log(
    declared.size === 1
      ? `subject cross-check: the chain's provenance names ${subjectId} — it agrees with the file name.`
      : `subject cross-check: NOT AVAILABLE — no ATTEMPT in this chain carries provenance, ` +
          `so ${subjectId} is the file name's claim alone. That is an absence, not a contradiction.`
  );

  const shaAfter = sha256OfFile(chainPath);
  if (shaAfter !== shaBefore) {
    throw new ChainNotReviewable(
      `the file changed while it was being read: ${shaBefore} before the load, ` +
        `${shaAfter} after it. Nothing was appended — a sha that does not describe the ` +
        `bytes that were verified is worse than no record at all.`
    );
  }

  return {
    subjectId,
    runId,
    chainPath,
    chainSha256: shaAfter,
    recordCount: store.length,
    verifyResult: CHAIN_VERIFY_VALID,
    readerVersion: readerVersion(),
    reviewerSeat: seat,
  };
}

/**
 * S133 · WIRE B — THE REVIEW REACHES THE MACHINE'S LEDGER (the arbiter, S133: PATH B).
 *
 * ── WHAT THIS PROVES, AND WHAT IT DOES NOT [LB] ────────────────────────────
 *
 *   PROVES: `/var/lib/mica/mica-log.jsonl` — the book the clerk-caller carries
 *   to the clerk and the witness report reads — carries a record, written by
 *   the arbiter's own principal, naming a pilot chain by its sha and saying it
 *   was reviewed. Pilot 8 is "the first pilot whose review is named in the
 *   machine's ledger", and that sentence is the whole claim.
 *
 *   DOES NOT PROVE that the REGISTRAR judged anything. This is the depositor's
 *   own narration — `deposit-cli.ts`'s S111 path, "generalize: it is just
 *   another book" — and `mica-registrar.service`'s own RANK OF BOOKS note puts
 *   this journal "unchained, unsigned, ranked strictly below" the authoritative
 *   records. The registrar's door takes COMMITMENT / REVEAL / GRADING and a
 *   chain review is none of the three; widening it is pilot 9's beat, ruled.
 *
 *   DOES NOT PROVE that the machine did anything FOR the agent during the
 *   pilot. Pilots 1-8 are transcripts read after the fact.
 *
 * ── THE IDENTITY IS THE UID, THROUGH THE ROSTER, NEVER `--seat` ────────────
 *
 *   `--seat` is the reviewer's declared seat and it goes INSIDE the review-log
 *   record, where a claim belongs. The ledger's `moduleId` is resolved from
 *   this process's own uid through the registrar's roster (`resolveSelf`, the
 *   same function and the same file the registrar reads), so the name in the
 *   spine cannot disagree with the kernel. A principal the roster does not name
 *   cannot deposit at all.
 *
 * ── LOUD, NAMED, AND NEVER BLOCKING ───────────────────────────────────────
 *
 *   By the time this runs the CHAIN_REVIEW has already been appended to the
 *   review log, which is the source of truth for the reader. A journal that
 *   could cost a review its place would have the rank of books backwards. So
 *   every failure here prints and NOTHING here changes the exit code — the rule
 *   `deposit-cli.ts` holds for the same journal, held the same way.
 */
function depositTheReview(
  review: ChainReview,
  reviewRecord: ChainReviewRecord,
  reviewLogPath: string,
  deposit: { readonly micaLog: string; readonly micaLogCursor: string; readonly roster: string }
): boolean {
  let self: string;
  try {
    self = resolveSelf(deposit.roster, process.getuid?.() ?? -1).name;
  } catch (err) {
    console.error(
      `| ledger        : NOT DEPOSITED — this process's uid is not one the roster at ` +
        `${deposit.roster} names (${String(err)}). The review IS in the review log; ` +
        `nothing about it changed.`
    );
    return false;
  }

  // THE OUTCOME LINE CARRIES THE CHAIN SHA VERBATIM, and that is the join. A
  // MicaLogRecord is {sequenceNumber, timestamp, moduleId, eventType, outcome,
  // actionId?} and has ONE free-text field, so the review's identity lives in
  // `outcome` as one composed string rather than in six typed ones. `actionId`
  // is NOT borrowed for it: that field means the routed action's id into the
  // floor trail, and a second meaning would make both unreadable. The cost of
  // the single field is real and is named in the receipt.
  const outcome =
    `chain=${review.chainSha256} subject=${review.subjectId} run=${review.runId} ` +
    `reviewLog=${reviewLogPath}#${String(reviewRecord.sequenceNumber)} ` +
    `reviewRecord=${reviewRecord.hash} reviewer=${review.reviewerSeat}`;

  // IDEMPOTENCE: REFUSE, and say where the first one is (brief §2.5 WB-3, the
  // stated lean). The ledger is append-only and has no unique key, so a second
  // deposit of the same chain would sit there forever looking like a second
  // review. Scanning is the depositor's own read of a book it may write.
  const already = findLedgerDeposit(deposit.micaLog, review.chainSha256);
  if (already.state === "FOUND") {
    console.error(
      `| ledger        : NOT DEPOSITED — ${deposit.micaLog} already carries a ` +
        `${LEDGER_EVENT_TYPE} for chain ${review.chainSha256.slice(0, 12)}... at ` +
        `${already.deposit.moduleId} seq ${String(already.deposit.sequenceNumber)}. A second ` +
        `one would read as a second review. The review log's own record was appended and ` +
        `is unaffected.`
    );
    return false;
  }
  if (already.state === "UNREADABLE") {
    // "I could not look" is not "it is not there" — but it is also not a reason
    // to withhold the record. The deposit proceeds and the reader is TOLD the
    // duplicate check did not run, rather than left to assume it did.
    console.error(
      `| ledger note   : the duplicate check could NOT be made — ${already.detail}. ` +
        `Depositing anyway; if a record for this chain is already there, this run has ` +
        `just written a second one and this line is the only warning of it.`
    );
  }

  const journal = journalAct(
    deposit.micaLog,
    deposit.micaLogCursor,
    self,
    LEDGER_EVENT_TYPE,
    outcome,
    Date.now()
  );
  console[journal.ok ? "log" : "error"](
    `| ledger        : ${journal.ok ? `${LEDGER_EVENT_TYPE} as ${self} — ` : ""}${journal.detail}`
  );
  if (journal.ok) {
    console.log(
      `| ledger note   : the clerk-caller carries new records to the clerk on its own ` +
        `timer; this tool neither calls the clerk nor waits for it. Read the stamps file ` +
        `to see whether it was stamped, and read src/probe/review-log.ts for what the ` +
        `review itself says — this line is a pointer, not the review.`
    );
  }
  return journal.ok;
}

/**
 * S133 · THE `deposit` ACT — a review that already exists, carried to the ledger.
 *
 * ── WHY IT EXISTS, AND IT IS A COST THIS BEAT PAID ONCE ────────────────────
 *
 *   `chain --mica-log …` writes a review AND deposits it. Used for a BACK-FILL
 *   — six chains already reviewed at S132 — that is one extra CHAIN_REVIEW per
 *   chain: six re-read records in the review trail, honest (a seat really did
 *   open the file again) and pure noise. This act reads the review that is
 *   ALREADY THERE and journals it. IT APPENDS NOTHING, and `WB-D2` asserts the
 *   review log is byte-identical before and after.
 *
 * ── IT CANNOT MANUFACTURE A REVIEW, WHICH IS THE PROPERTY WORTH HAVING ─────
 *
 *   No review for this chain's sha ⇒ REFUSED, naming `chain` as the act that
 *   makes one. A `deposit` that quietly reviewed-and-deposited would put a
 *   record in the spine saying a seat opened a file that no seat had opened.
 *
 * ── THE SHA IS COMPUTED FROM THE CHAIN'S OWN BYTES, never passed in, so a file
 *   renamed or edited since its review simply does not match — the same rule
 *   the `chain` act holds one line up ("there is NO --sha").
 *
 * ── AND ITS EXIT CODE IS REAL, WHICH IS A DELIBERATE DIFFERENCE FROM `chain`
 *   `[LB]`. On `chain` the journal leg is never allowed to change the exit
 *   code: the CHAIN_REVIEW is the act and the source of truth, and a ledger
 *   failure must not cost it anything. HERE THE DEPOSIT IS THE ACT. There is no
 *   review being protected — this act never touches the review log — so exiting
 *   0 on a deposit that did not happen would make a six-line back-fill
 *   unverifiable, which is exactly the thing an exit code is for. The
 *   never-blocking rule is kept where it means something (the review log is not
 *   touched, ever) and dropped where it would only hide a failure.
 */
function depositAnExistingReview(o: Options): number {
  const chainPath = o.chainPath as string;
  const deposit = o.deposit as { micaLog: string; micaLogCursor: string; roster: string };

  let chainSha: string;
  try {
    chainSha = sha256OfFile(chainPath);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    console.error(
      `the chain at ${chainPath} could not be read (${e.code ?? e.name ?? "error"}). Nothing ` +
        `was deposited and nothing was written.`
    );
    return REVIEW_CLI_EXIT.DEPLOYMENT;
  }
  console.log(`  sha256 (computed from the bytes, never typed): ${chainSha}`);

  const store = new ReviewLogStore({ path: o.log });
  if (store.getLoadState() === "CANNOT_VERIFY") {
    console.error("the review log could not be read: CANNOT_VERIFY. Nothing was deposited.");
    return REVIEW_CLI_EXIT.DEPLOYMENT;
  }
  const matches = store
    .records()
    .filter((r): r is ChainReviewRecord => r.kind === "CHAIN_REVIEW" && r.review.chainSha256 === chainSha);
  if (matches.length === 0) {
    console.error(
      `REFUSED: ${o.log} carries no CHAIN_REVIEW naming ${chainSha.slice(0, 12)}.... This act ` +
        `deposits a review that already exists and will not make one — run the "chain" ` +
        `act against this file first. Nothing was written.`
    );
    return REVIEW_CLI_EXIT.REFUSED;
  }
  // THE FIRST MATCH IS THE RATIFYING READ, the same rule Reader A's trailer
  // holds: a later seat opening the same file is a re-read, and a re-read must
  // not become the record the ledger points at.
  const record = matches[0];
  if (matches.length > 1) {
    console.log(
      `  ${String(matches.length)} records name this sha; depositing the FIRST — the ` +
        `ratifying read — and the rest are re-reads.`
    );
  }
  console.log(
    `existing chain review found | subject ${record.review.subjectId} | run ${record.review.runId} | ` +
      `seat ${record.review.reviewerSeat} | review-log seq ${String(record.sequenceNumber)}`
  );
  const ok = depositTheReview(record.review, record, o.log, deposit);
  console.log("Nothing was appended to the review log by this act; it reads one and points at it.");
  return ok ? REVIEW_CLI_EXIT.APPENDED : REVIEW_CLI_EXIT.REFUSED;
}


/** Only this presentation site reads the machine-verdict field. */
function printState(act: Act, record: ReviewRecord): void {
  const machine = act === "select" || act === "initial" ? WITHHELD : record.machineVerdict;
  console.log(`case ${JSON.stringify(record.scenarioId)} | state ${record.state} | machine verdict: ${machine}`);
}

export function main(argv: readonly string[]): number {
  let options: Options;
  try { options = parseOptions(argv); }
  catch (err) {
    console.error(err instanceof ReviewCliUsage ? err.message : "usage could not be read");
    return REVIEW_CLI_EXIT.USAGE;
  }
  const o = options;
  const blind = o.act === "select" || o.act === "initial";
  // Error text is never a back door for a payload (e.g. a JSON parser excerpt).
  const diagnostic = (text: string): string => {
    let safe = text;
    if (blind) for (const verdict of GRADING_VERDICTS) safe = safe.split(verdict).join(WITHHELD);
    return safe.replace(/[\r\n]/g, " ");
  };
  console.log(`review-cli ${o.act} | declared seat ${JSON.stringify(o.seat)} | timestamp ${o.timestamp}`);
  let appended = 0;
  let total: number | "unknown" = o.act === "select" || o.act === "close" ? "unknown" : 1;
  let stoppedAt = o.caseId ?? o.act;
  const stopped = (reason: string, code: number): number => {
    console.log(`appended ${appended} of ${total} — stopped at ${JSON.stringify(stoppedAt)}: ${diagnostic(reason)}`);
    console.log("Each record is a separate transaction; any appended prefix remains in the trail; this tool certifies nothing.");
    return code;
  };
  try {
    const store = new ReviewLogStore({ path: o.log });
    if (store.getLoadState() === "CANNOT_VERIFY") {
      // Do not print raw lastError: malformed JSON errors may quote blind data.
      const why = store.getLastError() ?? "";
      const unreadable = why.startsWith("cannot read D-review log:") || why.startsWith("the D-review log could not be looked at");
      return stopped(unreadable ? "store could not be read" : "store load refused: CANNOT_VERIFY", unreadable ? REVIEW_CLI_EXIT.DEPLOYMENT : REVIEW_CLI_EXIT.REFUSED);
    }
    const append = (outcome: ReviewAppendOutcome<ReviewLogRecord>): void => {
      if (!outcome.persisted) throw new AppendUnavailable(outcome.detail ?? "store could not persist the record");
      appended++;
    };
    if (o.act === "select") {
      const population = o.role === "STANDARD" ? loadStandardScenarios(FAMILIES) : loadHeldOutScenarios(FAMILIES);
      const selected = selectForReview(o.rule!, population);
      total = selected.length;
      console.log(`rule ${o.rule!.ruleId} | fraction ${o.rule!.fraction} | seed ${o.rule!.seed} | role ${o.role} | population ${population.length} | selected ${total}`);
      console.log("Source: shipped static families; the selection rule and population are not persisted in this trail.");
      for (const selectedCase of selected) {
        stoppedAt = selectedCase.scenarioId;
        const record = initializeReview(selectedCase);
        append(store.appendState(record, o.timestamp));
        printState(o.act, record);
      }
    } else if (o.act === "deposit") {
      // BEFORE the store's own append path is even reachable. This act has no
      // `append()` call anywhere in it.
      return depositAnExistingReview(o);
    } else if (o.act === "chain") {
      const review = reviewTheChain(o.chainPath!, o.seat);
      const appended = store.appendChainReviewRecord(review, o.timestamp);
      append(appended);
      console.log(
        `chain review appended | subject ${review.subjectId} | run ${review.runId} | ` +
          `records ${String(review.recordCount)} | verify ${review.verifyResult}`
      );
      console.log(`  sha256 (computed from the bytes, never typed): ${review.chainSha256}`);
      // WIRE B. AFTER the append, and only after: `append()` throws when the
      // record did not persist and `reviewTheChain` throws before that, so a
      // refused chain cannot reach this line (WB-1, WB-2).
      if (o.deposit !== undefined) {
        depositTheReview(review, appended.record, o.log, o.deposit);
      }
      console.log(`  path:          ${review.chainPath}`);
      console.log(`  reader vintage: ${review.readerVersion} — the relay's claim, not a measurement.`);
      console.log(
        "This record says one thing: this seat opened this file and its verify came back " +
          "valid at that sha. It certifies no reading, no verdict and no judgment."
      );
    } else if (o.act === "sign") {
      const scope = o.cases !== undefined
        ? { individuallyReviewedCaseIds: o.cases }
        : { individuallyReviewedCaseIds: [], batchClaim: o.batchClaim! };
      const signature = createSignature(o.seat, scope, o.timestamp);
      append(store.appendSignatureRecord(signature, o.timestamp));
      console.log(`signature appended | scope ${o.cases === undefined ? "declared batch claim" : `${o.cases.length} named case(s)`}`);
    } else {
      const prior = store.currentStateOf(o.caseId!);
      if (prior === null) throw new ReviewRecordRefused("case is not in this trail; select it first", o.caseId!, o.act);
      total = 1;
      let next: ReviewRecord;
      switch (o.act) {
        case "initial": next = recordInitialJudgment(prior, o.judgment!, o.timestamp); break;
        case "reveal": next = reveal(prior, o.timestamp); break;
        case "revise": next = recordRevisedJudgment(prior, o.judgment!, o.timestamp); break;
        case "close": {
          const closed = closeReview(prior, o.timestamp);
          total = closed.journalEntries.length + 1;
          for (const entry of closed.journalEntries) append(store.appendJournal(entry, o.timestamp));
          next = closed.record;
          break;
        }
      }
      append(store.appendState(next, o.timestamp));
      printState(o.act, next);
    }
    console.log(`appended ${appended} of ${total} record(s); this tool certifies nothing.`);
    return REVIEW_CLI_EXIT.APPENDED;
  } catch (err) {
    if (err instanceof ReviewRecordRefused || err instanceof SignatureRefused || err instanceof ReviewLogRefused) {
      return stopped(`${err.name}: ${err.message}`, REVIEW_CLI_EXIT.REFUSED);
    }
    if (err instanceof ChainNotReviewable) return stopped(err.message, REVIEW_CLI_EXIT.REFUSED);
    if (err instanceof AppendUnavailable) return stopped(err.message, REVIEW_CLI_EXIT.DEPLOYMENT);
    // The EVIDENCE room's missing act, surfaced as itself: it is a fact about
    // the deployment of the chain being read, not about the review log.
    if (err instanceof EvidenceStoreDeploymentActMissing) {
      return stopped(err.message, REVIEW_CLI_EXIT.DEPLOYMENT);
    }
    // Missing directories retain their section-number signpost; unexpected
    // exceptions report only identity/errno, never an untrusted payload excerpt.
    const error = err as Error & { code?: string };
    const reason = error.name === "ReviewStoreDeploymentActMissing"
      ? error.message : `store could not open/write (${error.name ?? "error"}${error.code ? `, ${error.code}` : ""})`;
    return stopped(reason, REVIEW_CLI_EXIT.DEPLOYMENT);
  }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
