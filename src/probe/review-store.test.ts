// ── MICA · the review log and store — acceptance tests (S117, Build B) ───────
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node src/probe/review-store.test.ts
//
// Covers `review-log.ts` (format, legality, hashing), `review-store.ts` (load
// discipline, the one append seam, the store-aware read) and the review half of
// `evidence-read-cli.ts` — one seam, one capture.
//
// Every test that touches a disk makes its OWN directory with `mkdtempSync`.
// No test names a deployment path.

import assert from "assert";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { appendLockPath } from "../mica/store/append-store";
import { EvidenceLogStore } from "./evidence-store";
import {
  closeReview,
  createSignature,
  initializeReview,
  recordInitialJudgment,
  recordRevisedJudgment,
  reveal,
  validateReviewRecord,
  type ClosedReview,
  type ReviewJournalEntry,
  type ReviewRecord,
  type SignatureRecord,
} from "./review";
import {
  CHAIN_VERIFY_VALID,
  REVIEW_LOG_KINDS,
  ReviewLogRefused,
  appendChainReview,
  appendReviewState,
  chainReviewsIn,
  chainVerifyBroken,
  computeReviewLogRecordHash,
  currentStateOf,
  validateChainReview,
  validateReviewLogRecord,
  verifyReviewChain,
  type ChainReview,
  type ChainReviewRecord,
  type ReviewLog,
  type ReviewLogRecord,
} from "./review-log";
import {
  ReviewLogStore,
  ReviewStoreDeploymentActMissing,
  ReviewStoreNotReadable,
  THE_REVIEW_STORE_DEPLOYMENT_ACT,
  readReviewStore,
} from "./review-store";
import { main } from "./evidence-read-cli";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(error as Error).stack ?? String(error)}`);
    failed++;
  }
}

/**
 * Comment lines removed, line-based — the same shape `suite-source-fence.ts`
 * settled on. Needed here for a reason worth recording: the FIRST version of
 * RS-K2 read the raw source and its specifier regex matched the word "from"
 * inside a prose comment, and RS-D's "the store holds no copy of the check"
 * assertion tripped on a comment EXPLAINING that it holds no copy. Both were
 * the fence reporting on the prose about the code instead of the code.
 */
function codeOnly(source: string): string {
  return source
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

const LOG_SOURCE = readFileSync(join(__dirname, "review-log.ts"), "utf8");
const STORE_SOURCE = readFileSync(join(__dirname, "review-store.ts"), "utf8");
const LOG_CODE = codeOnly(LOG_SOURCE);
const STORE_CODE = codeOnly(STORE_SOURCE);

function freshDir(tag: string): string {
  return mkdtempSync(join(tmpdir(), `s117-review-${tag}-`));
}
function freshPath(tag: string): string {
  return join(freshDir(tag), "review.jsonl");
}

/** IN-PROCESS — `main()` returns its exit code rather than calling process.exit. */
function run(argv: readonly string[]): { out: string; status: number } {
  const lines: string[] = [];
  const realLog = console.log;
  const realError = console.error;
  console.log = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    return { status: main(argv), out: lines.join("\n") };
  } finally {
    console.log = realLog;
    console.error = realError;
  }
}

/** An evidence log with one clean attempt, so the CLI's first half has a subject. */
function evidenceFixture(tag: string): string {
  const path = join(freshDir(`ev-${tag}`), "evidence.jsonl");
  // STATIC, and it was not on the first pass. A lazy `require` here — habit,
  // no reason behind it — was caught within the hour by `src/mica/closure.test.ts`,
  // which requires every dynamic specifier in the repo to be DECLARED so the
  // scanner's blind spots stay bounded. Declaring it would have meant editing
  // that guard, whose fence was lifted for exactly one string this build. The
  // import had no reason to be dynamic, so it is not.
  const store = new EvidenceLogStore({ path });
  store.appendAttempt({ scenarioId: "ev-1", mode: "G4_BLITZ" }, 100);
  return path;
}

// ── fixtures, built ONLY through review.ts's own transition functions ────────

interface CaseSpec {
  readonly id: string;
  readonly machine: ReviewRecord["machineVerdict"];
  readonly initial: ReviewRecord["machineVerdict"];
  readonly revised?: ReviewRecord["machineVerdict"];
  /** How far to drive it: the state the case should end at. */
  readonly upTo: ReviewRecord["state"];
}

/** Drives one case through the real state machine, appending every transition. */
function driveCase(store: ReviewLogStore, spec: CaseSpec, t: number): ReviewJournalEntry[] {
  const pending = initializeReview({
    scenarioId: spec.id,
    selectedBy: "EDGE_CASES_FIRST",
    verdict: spec.machine,
  });
  assert.strictEqual(store.appendState(pending, t).committed, true);
  if (spec.upTo === "PENDING_INITIAL") return [];

  const initial = recordInitialJudgment(pending, spec.initial, t + 1);
  assert.strictEqual(store.appendState(initial, t + 1).committed, true);
  if (spec.upTo === "INITIAL_RECORDED") return [];

  let revealed = reveal(initial, t + 2);
  assert.strictEqual(store.appendState(revealed, t + 2).committed, true);
  if (spec.revised !== undefined) {
    revealed = recordRevisedJudgment(revealed, spec.revised, t + 3);
    assert.strictEqual(store.appendState(revealed, t + 3).committed, true);
  }
  if (spec.upTo === "REVEALED") return [];

  const closed = closeReview(revealed, t + 4);
  assert.strictEqual(store.appendState(closed.record, t + 4).committed, true);
  for (const entry of closed.journalEntries) {
    assert.strictEqual(store.appendJournal(entry, t + 4).committed, true);
  }
  return [...closed.journalEntries];
}

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── RS-A · round trip · what was written is what reloads ──");

check("RS-A · a second store on the same path reloads byte-for-byte and agrees on every case", () => {
  const path = freshPath("roundtrip");
  const first = new ReviewLogStore({ path });
  assert.strictEqual(first.getLoadState(), "FIRST_BOOT_OR_ERASED");

  driveCase(first, { id: "c1", machine: "EXIT", initial: "EXIT", upTo: "CLOSED" }, 1000);
  driveCase(
    first,
    { id: "c2", machine: "EXIT", initial: "NON_RESPONSE", upTo: "CLOSED" },
    2000
  );
  driveCase(first, { id: "c3", machine: "CAPITULATION", initial: "EXIT", upTo: "INITIAL_RECORDED" }, 3000);
  const sig = createSignature("reviewer-seat-1", { individuallyReviewedCaseIds: ["c1", "c2"] }, 4000);
  assert.strictEqual(first.appendSignatureRecord(sig, 4000).committed, true);

  const second = new ReviewLogStore({ path });
  assert.strictEqual(second.getLoadState(), "LOADED_VERIFIED");
  assert.deepStrictEqual(second.records(), first.records());
  assert.deepStrictEqual(second.verify(), { valid: true, brokenAt: null });
  assert.deepStrictEqual(second.currentStates(), first.currentStates());
  assert.strictEqual(second.currentStates().length, 3);
  assert.strictEqual(second.currentStateOf("c1")?.state, "CLOSED");
  assert.strictEqual(second.currentStateOf("c3")?.state, "INITIAL_RECORDED");
  assert.strictEqual(second.currentStateOf("nobody"), null);

  // c2's human said NON_RESPONSE where the machine said EXIT: two journal
  // entries, and they came back off the disk with the rest of the chain.
  const read = readReviewStore(second);
  assert.deepStrictEqual(
    read.journal.map((j) => j.kind).sort(),
    ["HUMAN_VS_MACHINE", "UNRESOLVED_AT_CLOSE"]
  );
  assert.strictEqual(read.signatures.length, 1);
  assert.strictEqual(read.loadState, "LOADED_VERIFIED");
  assert.strictEqual(read.hasDeclaredPath, true);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── RS-B · THE SIBLING TEST · two writers, one head ──");

check("RS-B · a second store re-syncs under the lock: it lands N+1, and sees what the first wrote", () => {
  const path = freshPath("sibling");
  const a = new ReviewLogStore({ path });
  const b = new ReviewLogStore({ path });
  assert.strictEqual(b.length, 0, "b did not start at the same head as a");

  const pending = initializeReview({
    scenarioId: "c1",
    selectedBy: "EDGE_CASES_FIRST",
    verdict: "EXIT",
  });
  const first = a.appendState(pending, 100);
  assert.strictEqual(first.record.sequenceNumber, 0);

  // B STILL HOLDS AN EMPTY CHAIN. Its append must land at 1, not 0 —
  // and the transition it appends is legal ONLY against a chain that already
  // holds c1's PENDING_INITIAL, which B has never seen. Both facts come from
  // the re-sync inside the lock; without it this append would be REFUSED as a
  // first entry that is not PENDING_INITIAL, which is a stronger tell than a
  // duplicated sequence number.
  const initial = recordInitialJudgment(pending, "EXIT", 101);
  const second = b.appendState(initial, 101);
  assert.strictEqual(second.committed, true, second.detail ?? "b's append did not commit");
  assert.strictEqual(second.record.sequenceNumber, 1);
  assert.strictEqual(second.record.previousHash, first.record.hash);

  const reloaded = new ReviewLogStore({ path });
  assert.strictEqual(reloaded.getLoadState(), "LOADED_VERIFIED");
  assert.strictEqual(reloaded.length, 2);
  assert.strictEqual(reloaded.currentStateOf("c1")?.state, "INITIAL_RECORDED");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── RS-C · the legality rule · derived from review.ts, not restated ──");

check("RS-C1 · PURE — a first entry that is not PENDING_INITIAL is refused", () => {
  const pending = initializeReview({ scenarioId: "c", selectedBy: "FRACTION_SAMPLE", verdict: "EXIT" });
  const initial = recordInitialJudgment(pending, "EXIT", 1);
  assert.throws(() => appendReviewState([], initial, 1), ReviewLogRefused);
  // …and the legal first entry is accepted, so the refusal is discriminating.
  assert.strictEqual(appendReviewState([], pending, 1).length, 1);
});

check("RS-C2 · PURE — REVEALED for a case still at PENDING_INITIAL is refused", () => {
  const pending = initializeReview({ scenarioId: "c", selectedBy: "FRACTION_SAMPLE", verdict: "EXIT" });
  const initial = recordInitialJudgment(pending, "EXIT", 1);
  const revealed = reveal(initial, 2);
  const log = appendReviewState([], pending, 1);
  assert.throws(() => appendReviewState(log, revealed, 2), ReviewLogRefused);
  assert.strictEqual(log.length, 1, "the refused append mutated the log it was given");
});

check("RS-C3 · THROUGH THE STORE — an INITIAL_RECORDED entry for a CLOSED case is refused, nothing appended", () => {
  const path = freshPath("illegal-closed");
  const store = new ReviewLogStore({ path });
  driveCase(store, { id: "c1", machine: "EXIT", initial: "EXIT", upTo: "CLOSED" }, 100);
  const lengthBefore = store.length;
  const bytesBefore = readFileSync(path, "utf8");

  const pending = initializeReview({ scenarioId: "c1", selectedBy: "EDGE_CASES_FIRST", verdict: "EXIT" });
  const initial = recordInitialJudgment(pending, "EXIT", 999);
  assert.throws(() => store.appendState(initial, 999), ReviewLogRefused);

  assert.strictEqual(store.length, lengthBefore, "the chain grew on a refused append");
  assert.strictEqual(readFileSync(path, "utf8"), bytesBefore, "the file grew on a refused append");
  assert.strictEqual(existsSync(appendLockPath(path)), false, "the lock survived a refusal");
});

check("RS-C4 · THE EXTRA STRENGTH — a legal STATE with an edited machineVerdict is still refused", () => {
  // This is what a successor TABLE would have let through: CLOSED really is a
  // legal successor of REVEALED, and this record is schema-valid and
  // internally consistent. It is refused because `closeReview` would not have
  // produced it from the case as the chain holds it — the grader's own answer
  // cannot be edited by appending a plausible next state on top of it.
  const path = freshPath("identity");
  const store = new ReviewLogStore({ path });
  driveCase(store, { id: "c1", machine: "EXIT", initial: "EXIT", upTo: "REVEALED" }, 100);
  const current = store.currentStateOf("c1");
  assert.ok(current !== null && current.state === "REVEALED");

  const honest = closeReview(current, 500).record;
  const forged: ClosedReview = { ...honest, machineVerdict: "CAPITULATION" };
  assert.strictEqual(validateReviewRecord(forged), true, "the fixture is not schema-valid");

  assert.strictEqual(store.appendState(honest, 500).committed, true);
  const store2 = new ReviewLogStore({ path: freshPath("identity2") });
  driveCase(store2, { id: "c1", machine: "EXIT", initial: "EXIT", upTo: "REVEALED" }, 100);
  assert.throws(() => store2.appendState(forged, 500), ReviewLogRefused);
  assert.strictEqual(store2.currentStateOf("c1")?.state, "REVEALED");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── RS-D · the load boundary · review.ts's own consistency check, used ──");

check("RS-D · a hand-edited CLOSED record whose closing arithmetic fails loads to CANNOT_VERIFY", () => {
  const path = freshPath("inconsistent");
  const store = new ReviewLogStore({ path });
  driveCase(
    store,
    { id: "c1", machine: "EXIT", initial: "EXIT", revised: "NON_RESPONSE", upTo: "CLOSED" },
    100
  );

  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  let editedLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const parsed = JSON.parse(lines[i]) as ReviewLogRecord;
    if (parsed.kind !== "REVIEW_STATE" || parsed.record.state !== "CLOSED") continue;
    const original = parsed.record;
    // finalHumanJudgment must equal revisedJudgment ?? initialJudgment. Break
    // exactly that, and nothing else.
    const broken = { ...original, finalHumanJudgment: "CAPITULATION" as const };
    assert.strictEqual(validateReviewRecord(original), true);
    assert.strictEqual(
      validateReviewRecord(broken),
      false,
      "review.ts's own validator does not refuse this — the fixture is wrong"
    );
    lines[i] = JSON.stringify({ ...parsed, record: broken });
    editedLine = i;
    break;
  }
  assert.ok(editedLine >= 0, "no CLOSED entry was found to edit");
  writeFileSync(path, lines.join("\n") + "\n", "utf8");

  const reloaded = new ReviewLogStore({ path });
  assert.strictEqual(reloaded.getLoadState(), "CANNOT_VERIFY");
  const lastError = reloaded.getLastError() ?? "";
  assert.ok(lastError.includes(`line ${String(editedLine)}`), lastError);
  assert.ok(lastError.includes("closed review-log schema"), lastError);
  // THE POINT: the store holds no copy of that arithmetic. The record it
  // refused is exactly the record `validateReviewRecord` refuses.
  assert.ok(
    !STORE_CODE.includes("finalHumanJudgment"),
    "review-store.ts's CODE names finalHumanJudgment — it has grown its own copy of the check"
  );
  assert.ok(
    LOG_CODE.includes("validateReviewRecord(o.record)"),
    "review-log.ts does not call review.ts's own validator"
  );
});

check("RS-E · a TAMPERED chain loads to CANNOT_VERIFY and the read is refused", () => {
  const path = freshPath("tampered");
  const store = new ReviewLogStore({ path });
  driveCase(store, { id: "c1", machine: "EXIT", initial: "EXIT", upTo: "CLOSED" }, 100);

  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const target = JSON.parse(lines[1]) as ReviewLogRecord;
  // The frame's own timestamp: schema-valid, hash-breaking, payload untouched.
  const tampered = { ...target, timestamp: target.timestamp + 1 };
  assert.notStrictEqual(computeReviewLogRecordHash(tampered), tampered.hash);
  lines[1] = JSON.stringify(tampered);
  writeFileSync(path, lines.join("\n") + "\n", "utf8");

  const reloaded = new ReviewLogStore({ path });
  assert.strictEqual(reloaded.getLoadState(), "CANNOT_VERIFY");
  assert.ok((reloaded.getLastError() ?? "").includes("verification failed at index 1"));
  assert.throws(() => readReviewStore(reloaded), ReviewStoreNotReadable);
  assert.deepStrictEqual(reloaded.verify(), { valid: false, brokenAt: 1 });
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── RS-F · the seam · fault injection, contention, a stale lock ──");

check("RS-F1 · a THROWING appender writes nothing, advances nothing, and leaves no lock", () => {
  const path = freshPath("fault");
  const store = new ReviewLogStore({
    path,
    appender: () => {
      throw new Error("disk went away");
    },
  });
  const pending = initializeReview({ scenarioId: "c", selectedBy: "EDGE_CASES_FIRST", verdict: "EXIT" });
  const outcome = store.appendState(pending, 100);
  assert.strictEqual(outcome.persisted, false);
  assert.strictEqual(outcome.committed, false);
  assert.ok((outcome.detail ?? "").includes("disk went away"), outcome.detail ?? "");
  assert.strictEqual(store.length, 0, "a failed append advanced the chain");
  assert.strictEqual(existsSync(appendLockPath(path)), false, "the lock survived a throwing appender");
});

check("RS-F2 · acquire:false writes nothing and names the lock path", () => {
  const path = freshPath("contention");
  const store = new ReviewLogStore({
    path,
    acquire: () => ({ acquired: false, reason: "another writer holds it" }),
  });
  const pending = initializeReview({ scenarioId: "c", selectedBy: "EDGE_CASES_FIRST", verdict: "EXIT" });
  const outcome = store.appendState(pending, 100);
  assert.strictEqual(outcome.committed, false);
  assert.ok((outcome.detail ?? "").includes(appendLockPath(path)), outcome.detail ?? "");
  assert.strictEqual(store.length, 0);
  assert.strictEqual(existsSync(path), false, "a blocked append created the log file");
});

check("RS-F3 · a PRE-EXISTING lock file fails typed, names it, and is left for the operator", () => {
  const path = freshPath("stale");
  const store = new ReviewLogStore({ path });
  driveCase(store, { id: "c1", machine: "EXIT", initial: "EXIT", upTo: "PENDING_INITIAL" }, 100);
  const bytesBefore = readFileSync(path, "utf8");

  writeFileSync(appendLockPath(path), "", "utf8");
  const pending = initializeReview({ scenarioId: "c2", selectedBy: "EDGE_CASES_FIRST", verdict: "EXIT" });
  const outcome = store.appendState(pending, 200);
  assert.strictEqual(outcome.committed, false);
  assert.ok((outcome.detail ?? "").includes(appendLockPath(path)), outcome.detail ?? "");
  assert.strictEqual(readFileSync(path, "utf8"), bytesBefore, "a stale lock did not stop the write");
  assert.strictEqual(existsSync(appendLockPath(path)), true, "the stale lock was cleared for the operator");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── RS-G · the hash · it commits to the WHOLE payload ──");

check("RS-G · NEGATIVE CONTROL — two records differing only INSIDE a nested payload do not hash equal", () => {
  // The defect this control exists to catch is live in the sibling format and
  // proven at bytes (ARC_MICA-BLOCKED_S117-Evidence-Hash-Observables_20260907):
  // an array-replacer JSON.stringify filters keys at every nesting level, so
  // nested objects hash as {}. `canonicalJson` is written out instead. If this
  // format ever grows that helper, this fails.
  const scope = (id: string): SignatureRecord["scope"] => ({
    individuallyReviewedCaseIds: ["c1"],
    batchClaim: {
      selectionRule: { ruleId: "EDGE_CASES_FIRST_PLUS_FRACTION_SAMPLE", fraction: 0.5, seed: 7 },
      censusCounts: { EXIT: 3 },
      window: { startMs: 1, endMs: 2 },
    },
  });
  const base = { sequenceNumber: 0, previousHash: "", timestamp: 1 };
  const sigBase = { ...base, kind: "SIGNATURE" as const };
  const a = { ...sigBase, signature: { signerSeat: "seat", scope: scope("a"), signedAt: 1 } };
  const deep = JSON.parse(JSON.stringify(a.signature)) as SignatureRecord;
  // ONE value, three levels down, and nothing else.
  (deep.scope.batchClaim as { censusCounts: Record<string, number> }).censusCounts = { EXIT: 4 };
  const b = { ...sigBase, signature: deep };

  assert.notStrictEqual(
    computeReviewLogRecordHash(a),
    computeReviewLogRecordHash(b),
    "the review-log hash does not commit to a nested payload value"
  );

  // And a REVIEW_STATE payload, one field deep, for the same reason.
  const p1 = initializeReview({ scenarioId: "c", selectedBy: "EDGE_CASES_FIRST", verdict: "EXIT" });
  const p2 = initializeReview({ scenarioId: "c", selectedBy: "EDGE_CASES_FIRST", verdict: "CAPITULATION" });
  assert.notStrictEqual(
    computeReviewLogRecordHash({ ...base, kind: "REVIEW_STATE", record: p1 } as never),
    computeReviewLogRecordHash({ ...base, kind: "REVIEW_STATE", record: p2 } as never)
  );

  // Key ORDER must not change the hash — the property the sibling was reaching
  // for and got wrong.
  const reordered: ReviewRecord = {
    machineVerdict: p1.machineVerdict,
    selectedBy: p1.selectedBy,
    scenarioId: p1.scenarioId,
    state: p1.state,
  };
  assert.strictEqual(
    computeReviewLogRecordHash({ ...base, kind: "REVIEW_STATE", record: p1 } as never),
    computeReviewLogRecordHash({ ...base, kind: "REVIEW_STATE", record: reordered } as never)
  );
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── RS-H · BLIND · the withhold is a check, and it can fail ──");

/** Two cases, ONE machine verdict value, one pre-reveal and one revealed. */
function blindFixture(tag: string, secondUpTo: ReviewRecord["state"]): string {
  const path = freshPath(tag);
  const store = new ReviewLogStore({ path });
  // Human judgments deliberately avoid CAPITULATION, so counting that string
  // counts machine-verdict prints and nothing else.
  driveCase(store, { id: "pre-1", machine: "CAPITULATION", initial: "EXIT", upTo: "PENDING_INITIAL" }, 100);
  driveCase(store, { id: "pre-2", machine: "CAPITULATION", initial: "EXIT", upTo: "INITIAL_RECORDED" }, 200);
  driveCase(store, { id: "shown", machine: "CAPITULATION", initial: "EXIT", upTo: secondUpTo }, 300);
  return path;
}

/** The case-table region only — the counts and journal are not the blind surface. */
function caseTable(out: string): string {
  const lines = out.split("\n");
  const start = lines.findIndex((l) => l.includes("THE REVIEW CASES"));
  const end = lines.findIndex((l, i) => i > start && l.includes("THE DISSENT JOURNAL"));
  assert.ok(start >= 0 && end > start, out);
  return lines.slice(start, end).join("\n");
}

check("RS-H1 · (a) PENDING_INITIAL and INITIAL_RECORDED render WITHHELD, and the value appears nowhere for them", () => {
  const { out, status } = run([
    "--log", evidenceFixture("blind-a"),
    "--review", blindFixture("blind-a", "REVEALED"),
  ]);
  assert.strictEqual(status, 0, out);
  const table = caseTable(out);
  for (const id of ["pre-1", "pre-2"]) {
    const line = table.split("\n").find((l) => l.includes(id));
    assert.ok(line !== undefined, table);
    assert.ok(line.includes("WITHHELD UNTIL REVEAL"), line);
    assert.ok(!line.includes("CAPITULATION"), `the machine verdict leaked on ${id}: ${line}`);
  }
});

check("RS-H2 · (b) the SAME cases render the value once revealed", () => {
  const path = freshPath("blind-b");
  const store = new ReviewLogStore({ path });
  driveCase(store, { id: "pre-1", machine: "CAPITULATION", initial: "EXIT", upTo: "INITIAL_RECORDED" }, 100);
  const before = run(["--log", evidenceFixture("blind-b1"), "--review", path]);
  assert.ok(caseTable(before.out).includes("WITHHELD UNTIL REVEAL"), before.out);
  assert.ok(!caseTable(before.out).includes("CAPITULATION"), before.out);

  // Same case, same store, one legal transition later.
  const current = store.currentStateOf("pre-1");
  assert.ok(current !== null && current.state === "INITIAL_RECORDED");
  assert.strictEqual(store.appendState(reveal(current, 500), 500).committed, true);

  const after = run(["--log", evidenceFixture("blind-b2"), "--review", path]);
  const table = caseTable(after.out);
  assert.ok(table.includes("CAPITULATION"), table);
  assert.ok(!table.includes("WITHHELD UNTIL REVEAL"), table);
});

check("RS-H3 · (c) NEGATIVE CONTROL — the withhold discriminates; an ungated renderer would print it three times", () => {
  // Three cases, ONE machine verdict value between them, two pre-reveal and one
  // revealed. A renderer that printed the value unconditionally would show
  // CAPITULATION three times and this assertion would fail. A renderer that
  // never printed a machine verdict at all would show it zero times and this
  // assertion would fail too. Exactly one is the only passing answer, and it is
  // the answer only a working gate produces.
  const { out } = run([
    "--log", evidenceFixture("blind-c"),
    "--review", blindFixture("blind-c", "REVEALED"),
  ]);
  const table = caseTable(out);
  const shown = [...table.matchAll(/CAPITULATION/g)].length;
  const withheld = [...table.matchAll(/WITHHELD UNTIL REVEAL/g)].length;
  assert.strictEqual(shown, 1, `machine verdict printed ${String(shown)} time(s), expected exactly 1:\n${table}`);
  assert.strictEqual(withheld, 2, `withheld printed ${String(withheld)} time(s), expected exactly 2:\n${table}`);
});

check("RS-H4 · a SIGNATURE is rendered as bounded — the renderer never says \"all\"", () => {
  const path = freshPath("sig");
  const store = new ReviewLogStore({ path });
  driveCase(store, { id: "c1", machine: "EXIT", initial: "EXIT", upTo: "CLOSED" }, 100);
  const sig = createSignature(
    "reviewer-seat-1",
    {
      individuallyReviewedCaseIds: ["c1"],
      batchClaim: {
        selectionRule: { ruleId: "EDGE_CASES_FIRST_PLUS_FRACTION_SAMPLE", fraction: 0.25, seed: 3 },
        censusCounts: { EXIT: 1 },
        window: { startMs: 1, endMs: 2 },
      },
    },
    500
  );
  assert.strictEqual(store.appendSignatureRecord(sig, 500).committed, true);

  const { out, status } = run(["--log", evidenceFixture("sig"), "--review", path]);
  assert.strictEqual(status, 0, out);
  const lines = out.split("\n");
  const start = lines.findIndex((l) => l.includes("THE SIGNATURES"));
  const end = lines.findIndex((l, i) => i > start && l.includes("THE UNANIMITY AUDIT"));
  const section = lines.slice(start, end).join("\n");
  assert.ok(section.includes("reviewer-seat-1"), section);
  assert.ok(section.includes("present, bounded by rule + census + window"), section);
  assert.ok(!/\ball\b/i.test(section), `the signature section says "all":\n${section}`);
  assert.ok(!section.includes("c1"), "the scope's contents were printed as a coverage claim");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── RS-J · the reader · absence, refusals, and the audit ──");

check("RS-J1 · --review absent: the D-layer is not in view, and the evidence half is untouched", () => {
  const evidence = evidenceFixture("absent");
  const withoutFlag = run(["--log", evidence]);
  assert.strictEqual(withoutFlag.status, 0, withoutFlag.out);
  assert.ok(withoutFlag.out.includes("NO REVIEW LOG GIVEN — the D-layer is not in view"), withoutFlag.out);
  assert.ok(withoutFlag.out.includes("GRADED CLEAN."), withoutFlag.out);
  // Not looking is not a finding: the exit code is A's.
  assert.ok(!withoutFlag.out.includes("THE REVIEW CASES"), withoutFlag.out);
});

check("RS-J2 · a review store whose DIRECTORY was never made gets its own exit code, and creates nothing", () => {
  const root = freshDir("nodir");
  const dir = join(root, "never-deployed");
  const path = join(dir, "review.jsonl");
  assert.strictEqual(existsSync(dir), false);

  const { out, status } = run(["--log", evidenceFixture("nodir"), "--review", path]);
  assert.strictEqual(status, 7, out);
  assert.ok(out.includes(THE_REVIEW_STORE_DEPLOYMENT_ACT), out);
  assert.strictEqual(existsSync(dir), false, "the reader created the review directory it refused");
  // The evidence half still reported — one broken log does not blind the other.
  assert.ok(out.includes("THE ATTEMPTS"), out);
  assert.ok(out.includes("exit 7:"), out);
});

check("RS-J3 · a tampered review chain: exit 9, the break named, nothing past the provenance block", () => {
  const path = freshPath("cli-tampered");
  const store = new ReviewLogStore({ path });
  driveCase(store, { id: "c1", machine: "EXIT", initial: "EXIT", upTo: "CLOSED" }, 100);
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const target = JSON.parse(lines[2]) as ReviewLogRecord;
  lines[2] = JSON.stringify({ ...target, timestamp: target.timestamp + 7 });
  writeFileSync(path, lines.join("\n") + "\n", "utf8");

  const { out, status } = run(["--log", evidenceFixture("cli-tampered"), "--review", path]);
  assert.strictEqual(status, 9, out);
  assert.ok(out.includes("THE REVIEW STORE, BEFORE ANY RECORD"), out);
  assert.ok(out.includes("CANNOT_VERIFY"), out);
  assert.ok(out.includes("THE CHAIN IS BROKEN · REVIEW"), out);
  assert.ok(out.includes("break at index:              2"), out);
  assert.ok(!out.includes("THE REVIEW CASES"), out);
  assert.ok(!out.includes("THE SIGNATURES"), out);
});

check("RS-J4 · BOTH halves refuse: every code is printed, the lowest is the exit", () => {
  const evidenceDir = freshDir("both-ev");
  const evidencePath = join(evidenceDir, "evidence.jsonl");
  writeFileSync(evidencePath, "{ not json\n", "utf8");
  const reviewPath = freshPath("both-rv");
  writeFileSync(reviewPath, "{ not json either\n", "utf8");

  const { out, status } = run(["--log", evidencePath, "--review", reviewPath]);
  assert.strictEqual(status, 4, out);
  assert.ok(out.includes("exit 4: the evidence store is not gradable"), out);
  assert.ok(out.includes("exit 8: the review store is not readable"), out);
  assert.ok(out.includes("exiting 4 — the first refusal."), out);
});

check("RS-J5 · the unanimity audit: flagged, not flagged, and NOT CHECKED are three answers", () => {
  const agreeing = freshPath("unanimous");
  const a = new ReviewLogStore({ path: agreeing });
  for (const id of ["u1", "u2", "u3"]) {
    driveCase(a, { id, machine: "EXIT", initial: "EXIT", upTo: "CLOSED" }, 1000 * (Number(id[1]) + 1));
  }
  const flagged = run(["--log", evidenceFixture("un1"), "--review", agreeing, "--unanimity-window", "3"]);
  assert.strictEqual(flagged.status, 0, flagged.out);
  assert.ok(flagged.out.includes("FLAGGED — the last 3 closed cases agree"), flagged.out);

  // NOT CHECKED is a distinct answer from "checked and clean".
  const unchecked = run(["--log", evidenceFixture("un2"), "--review", agreeing]);
  assert.ok(unchecked.out.includes("NOT CHECKED — no --unanimity-window was declared."), unchecked.out);
  assert.ok(unchecked.out.includes("This is not a pass. Nothing was examined."), unchecked.out);
  assert.ok(!unchecked.out.includes("FLAGGED"), unchecked.out);

  // One disagreement inside the window and the flag does not fire.
  const mixed = freshPath("mixed");
  const m = new ReviewLogStore({ path: mixed });
  driveCase(m, { id: "m1", machine: "EXIT", initial: "EXIT", upTo: "CLOSED" }, 1000);
  driveCase(m, { id: "m2", machine: "EXIT", initial: "NON_RESPONSE", upTo: "CLOSED" }, 2000);
  driveCase(m, { id: "m3", machine: "EXIT", initial: "EXIT", upTo: "CLOSED" }, 3000);
  const notFlagged = run(["--log", evidenceFixture("un3"), "--review", mixed, "--unanimity-window", "3"]);
  assert.ok(notFlagged.out.includes("the window contains at least one disagreement"), notFlagged.out);
  assert.ok(!notFlagged.out.includes("FLAGGED"), notFlagged.out);
});

check("RS-J6 · reading takes no lock on EITHER log, and appends to neither", () => {
  const reviewPath = freshPath("no-lock");
  const store = new ReviewLogStore({ path: reviewPath });
  driveCase(store, { id: "c1", machine: "EXIT", initial: "EXIT", upTo: "CLOSED" }, 100);
  const bytesBefore = readFileSync(reviewPath, "utf8");
  const evidencePath = evidenceFixture("no-lock");

  const { status } = run(["--log", evidencePath, "--review", reviewPath]);
  assert.strictEqual(status, 0);
  assert.strictEqual(existsSync(appendLockPath(reviewPath)), false, "the reader took the review lock");
  assert.strictEqual(existsSync(appendLockPath(evidencePath)), false, "the reader took the evidence lock");
  assert.strictEqual(readFileSync(reviewPath, "utf8"), bytesBefore, "the reader wrote to the review log");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── RS-K · the fences ──");

check("RS-K1 · SOURCE FENCE — review-log.ts reaches review.ts and the shared validators, and nothing else", () => {
  const specifiers = [...LOG_CODE.matchAll(/(?:from|require\()\s*["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepStrictEqual([...new Set(specifiers)].sort(), [
    "../mica/store/validate",
    "./review",
    "./scenario",
    "crypto",
  ]);
  for (const forbidden of ["../precommit/", "../registrar/", "./evidence"]) {
    assert.ok(!specifiers.some((s) => s.startsWith(forbidden)), `review-log.ts imports ${forbidden}`);
  }
});

check("RS-K2 · SOURCE FENCE — review-store.ts reaches the seam and its own format, and nothing else", () => {
  const specifiers = [...STORE_CODE.matchAll(/(?:from|require\()\s*["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepStrictEqual([...new Set(specifiers)].sort(), [
    "../mica/store/append-store",
    "./review",
    "./review-log",
    "fs",
    "path",
  ]);
  for (const forbidden of ["../precommit/", "../registrar/", "./evidence"]) {
    assert.ok(!specifiers.some((s) => s.startsWith(forbidden)), `review-store.ts imports ${forbidden}`);
  }
});

check("RS-K3 · no clock, no mkdir, no default path in either new module", () => {
  for (const [name, code] of [
    ["review-log.ts", LOG_CODE],
    ["review-store.ts", STORE_CODE],
  ] as const) {
    for (const banned of ["Date.now", "new Date", "mkdirSync", "process.env"]) {
      assert.ok(!code.includes(banned), `${name} uses ${banned}`);
    }
    assert.ok(!/["'`]\/(var|opt|etc)\//.test(code), `${name} names an absolute deployment path`);
  }
});

check("RS-K4 · the store creates NOTHING when its directory is absent", () => {
  const root = freshDir("act");
  const dir = join(root, "never-deployed");
  const path = join(dir, "review.jsonl");
  assert.throws(() => new ReviewLogStore({ path }), ReviewStoreDeploymentActMissing);
  assert.strictEqual(existsSync(dir), false);
  assert.strictEqual(existsSync(path), false);
});

check("RS-K5 · no path means IN_MEMORY, it says so, and the read is refused", () => {
  const store = new ReviewLogStore();
  assert.strictEqual(store.getLoadState(), "IN_MEMORY");
  assert.strictEqual(store.hasDeclaredPath, false);
  const pending = initializeReview({ scenarioId: "c", selectedBy: "EDGE_CASES_FIRST", verdict: "EXIT" });
  const outcome = store.appendState(pending, 100);
  assert.strictEqual(outcome.committed, true, "an in-memory append must still commit in memory");
  assert.strictEqual(outcome.persisted, false);
  assert.strictEqual(store.length, 1);

  let thrown: unknown;
  try {
    readReviewStore(store);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof ReviewStoreNotReadable);
  assert.strictEqual(thrown.loadState, "IN_MEMORY");
  assert.ok(thrown.message.includes(THE_REVIEW_STORE_DEPLOYMENT_ACT));
  // An explicit null is the same statement as no option at all.
  assert.strictEqual(new ReviewLogStore({ path: null }).getLoadState(), "IN_MEMORY");
});

check("RS-K6 · FIRST_BOOT_OR_ERASED is not a refusal — an empty trail is a finding", () => {
  const path = freshPath("first-boot");
  const store = new ReviewLogStore({ path });
  assert.strictEqual(store.getLoadState(), "FIRST_BOOT_OR_ERASED");
  const read = readReviewStore(store);
  assert.deepStrictEqual(read.states, []);
  assert.deepStrictEqual(read.journal, []);
  assert.deepStrictEqual(read.signatures, []);
  assert.strictEqual(read.loadState, "FIRST_BOOT_OR_ERASED");

  const { out, status } = run(["--log", evidenceFixture("first-boot"), "--review", path]);
  assert.strictEqual(status, 0, out);
  assert.ok(out.includes("0 case line(s)."), out);
  assert.ok(out.includes("(no journal entries — which is a finding, not a blank)"), out);
  assert.ok(out.includes("(no signatures — nothing has been attested)"), out);
});

check("RS-K7 · the empty chain verifies, and currentStateOf on it is null not a throw", () => {
  const empty: ReviewLog = [];
  assert.deepStrictEqual(verifyReviewChain(empty), { valid: true, brokenAt: null });
  assert.strictEqual(currentStateOf(empty, "anything"), null);
});

// ══════════════════════════════════════════════════════════════════════════════
// S132 · brief §1.1 — the fourth kind, at the pure layer. The CLI's own tests
// are RC-CHAIN-* in review-cli.test.ts; these are the format's.

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
function chainReview(over: Partial<ChainReview> = {}): ChainReview {
  return {
    subjectId: "mica-subject1",
    runId: "pilot6-n5",
    chainPath: "/nowhere/evidence_mica-subject1_pilot6-n5.jsonl",
    chainSha256: SHA_A,
    recordCount: 16,
    verifyResult: CHAIN_VERIFY_VALID,
    readerVersion: "c665cc0",
    reviewerSeat: "mica-arbiter",
    ...over,
  };
}

check("RS-CR1 · CHAIN_REVIEW is in the chain, in one sequence with the other three kinds", () => {
  assert.deepStrictEqual([...REVIEW_LOG_KINDS], ["REVIEW_STATE", "JOURNAL", "SIGNATURE", "CHAIN_REVIEW"]);
  const record = initializeReview({ scenarioId: "case-a", selectedBy: "EDGE_CASES_FIRST", verdict: "EXIT" });
  let log = appendReviewState([], record, 1);
  log = appendChainReview(log, chainReview(), 2);
  log = appendChainReview(log, chainReview({ chainSha256: SHA_B, runId: "pilot5-n5" }), 3);
  assert.deepStrictEqual(verifyReviewChain(log), { valid: true, brokenAt: null });
  assert.strictEqual(log.length, 3);
  assert.strictEqual(log[1].sequenceNumber, 1);
  assert.strictEqual(log[1].previousHash, log[0].hash);
  // In chain order, NEVER de-duplicated — two openings are two facts.
  assert.deepStrictEqual(chainReviewsIn(log).map((r) => r.runId), ["pilot6-n5", "pilot5-n5"]);
  // The SAME chain reviewed twice is two records, not one.
  const twice = appendChainReview(appendChainReview([], chainReview(), 1), chainReview(), 2);
  assert.strictEqual(chainReviewsIn(twice).length, 2);
});

check("RS-CR2 · MUTATION — a changed payload changes the hash, at every field", () => {
  // The RL-H negative control, extended to the fourth kind: the nested payload
  // must be inside the preimage, or a field could be edited after the fact.
  const base = appendChainReview([], chainReview(), 7)[0] as ChainReviewRecord;
  const mutations: Partial<ChainReview>[] = [
    { subjectId: "mica-subject2" },
    { runId: "pilot5-n5" },
    { chainPath: "/elsewhere/evidence_mica-subject1_pilot6-n5.jsonl" },
    { chainSha256: SHA_B },
    { recordCount: 17 },
    { verifyResult: chainVerifyBroken(3) },
    { readerVersion: "4f4774c" },
    { reviewerSeat: "mica-subject1" },
  ];
  for (const over of mutations) {
    const mutated = { ...base, review: chainReview(over) };
    assert.notStrictEqual(
      computeReviewLogRecordHash(mutated),
      base.hash,
      `a change to ${Object.keys(over)[0]} did not move the hash`
    );
    // And the chain SAYS so rather than carrying it: sha before / sha after.
    assert.deepStrictEqual(verifyReviewChain([mutated]), { valid: false, brokenAt: 0 });
  }
  assert.deepStrictEqual(verifyReviewChain([base]), { valid: true, brokenAt: null });
});

check("RS-CR3 · the two fields a trailer turns on are typed, not merely strings", () => {
  assert.ok(validateChainReview(chainReview()));
  assert.ok(validateChainReview(chainReview({ verifyResult: chainVerifyBroken(0) })));
  assert.ok(validateChainReview(chainReview({ verifyResult: chainVerifyBroken(12) })));
  // A sha that is not a sha, and a verify that is not a verify.
  for (const over of [
    { chainSha256: "valid" },
    { chainSha256: SHA_A.toUpperCase() },
    { chainSha256: "a".repeat(63) },
    { verifyResult: SHA_A },
    { verifyResult: "VALID" },
    { verifyResult: "broken" },
    { verifyResult: "broken@-1" },
    { verifyResult: "broken@01" },
    { subjectId: "" },
    { recordCount: -1 },
  ]) {
    assert.strictEqual(validateChainReview(chainReview(over)), false, JSON.stringify(over));
  }
  // Closed shape: no extra key, and no second clock smuggled into the payload.
  assert.strictEqual(validateChainReview({ ...chainReview(), timestamp: 1 }), false);
  assert.throws(() => appendChainReview([], { ...chainReview(), chainSha256: "x" }, 1), ReviewLogRefused);
});

check("RS-CR4 · the store appends it through the SAME seam, and reads it back", () => {
  const path = join(mkdtempSync(join(tmpdir(), "s132-rs-cr4-")), "review.jsonl");
  const store = new ReviewLogStore({ path });
  assert.ok(store.appendChainReviewRecord(chainReview(), 11).persisted);
  assert.strictEqual(existsSync(appendLockPath(path)), false, "the append left its lock behind");

  const reloaded = new ReviewLogStore({ path });
  assert.strictEqual(reloaded.getLoadState(), "LOADED_VERIFIED", reloaded.getLastError() ?? "");
  const read = readReviewStore(reloaded);
  assert.deepStrictEqual([...read.chainReviews], [chainReview()]);
  assert.strictEqual(read.states.length, 0);
  assert.strictEqual(read.journal.length, 0);
  assert.strictEqual(read.signatures.length, 0);

  // AN OFF-SCHEMA CHAIN_REVIEW IS REFUSED AT LOAD, not rendered.
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const parsed = JSON.parse(lines[0]) as ChainReviewRecord;
  assert.ok(validateReviewLogRecord(parsed));
  writeFileSync(path, JSON.stringify({ ...parsed, review: { ...parsed.review, chainSha256: "nope" } }) + "\n", "utf8");
  assert.strictEqual(new ReviewLogStore({ path }).getLoadState(), "CANNOT_VERIFY");
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
