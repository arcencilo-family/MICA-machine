// S118 review writer acceptance tests. Every disk fixture uses mkdtempSync.
// Deterministic interleavings use a separate process against the real store;
// fault injection changes the candidate at the existing append boundary only.
import assert from "assert";
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { main } from "./review-cli";
import { main as readMain, WITHHELD } from "./evidence-read-cli";
import { ReviewLogStore } from "./review-store";
import { EvidenceLogStore } from "./evidence-store";
import { computeEvidenceRecordHashUnderV4, type OutcomeRecord } from "./evidence-log";
import type { ObservableChecks } from "./scenario";
import { chainReviewsIn, type ChainReviewRecord } from "./review-log";
import {
  closeReview, initializeReview, recordInitialJudgment, recordRevisedJudgment,
  reveal, selectForReview, type ReviewRecord, type ReviewSelectionRule,
} from "./review";
import { GRADING_VERDICTS, type GradingVerdict } from "./scenario";
import { HELD_OUT_FAMILY } from "./families/held-out";
import { appendLockPath } from "../mica/store/append-store";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n${(err as Error).stack ?? String(err)}`); }
}
function fresh(tag: string): string { return join(mkdtempSync(join(tmpdir(), `s118-rw-${tag}-`)), "review.jsonl"); }
function bytes(path: string): string { return existsSync(path) ? readFileSync(path, "utf8") : ""; }
function capture(fn: () => number): { status: number; out: string; err: string } {
  const out: string[] = [], err: string[] = [];
  const log = console.log, error = console.error;
  console.log = (...args: unknown[]) => { out.push(args.map(String).join(" ")); };
  console.error = (...args: unknown[]) => { err.push(args.map(String).join(" ")); };
  try { return { status: fn(), out: out.join("\n"), err: err.join("\n") }; }
  finally { console.log = log; console.error = error; }
}
const rule: ReviewSelectionRule = { ruleId: "EDGE_CASES_FIRST_PLUS_FRACTION_SAMPLE", fraction: 1, seed: 42 };
function args(act: string, path: string, extra: readonly string[] = []): string[] {
  return [act, "--log", path, "--timestamp", "100", "--seat", "reviewer", ...extra];
}
function run(act: string, path: string, extra: readonly string[] = []) { return capture(() => main(args(act, path, extra))); }
const selectArgs = ["--role", "HELD_OUT", "--rule-fraction", "1", "--rule-seed", "42"];
function stateFixture(upTo: ReviewRecord["state"], machine: GradingVerdict = "CAPITULATION", initial: GradingVerdict = "EXIT", revised?: GradingVerdict): string {
  const path = fresh(upTo);
  const store = new ReviewLogStore({ path });
  let record: ReviewRecord = initializeReview({ scenarioId: "case-a", selectedBy: "EDGE_CASES_FIRST", verdict: machine });
  assert.ok(store.appendState(record, 1).persisted);
  if (upTo === "PENDING_INITIAL") return path;
  record = recordInitialJudgment(record, initial, 2);
  assert.ok(store.appendState(record, 2).persisted);
  if (upTo === "INITIAL_RECORDED") return path;
  record = reveal(record, 3);
  assert.ok(store.appendState(record, 3).persisted);
  if (revised !== undefined) {
    record = recordRevisedJudgment(record, revised, 4);
    assert.ok(store.appendState(record, 4).persisted);
  }
  if (upTo === "REVEALED") return path;
  const closed = closeReview(record, 5);
  for (const entry of closed.journalEntries) assert.ok(store.appendJournal(entry, 5).persisted);
  assert.ok(store.appendState(closed.record, 5).persisted);
  return path;
}
function caseArgs(act: string): string[] {
  if (act === "select") return selectArgs;
  if (act === "sign") return ["--cases", "case-a"];
  return ["--case", "case-a", ...(act === "initial" || act === "revise" ? ["--judgment", "EXIT"] : [])];
}
function ready(act: string): string {
  if (act === "initial") return stateFixture("PENDING_INITIAL");
  if (act === "reveal") return stateFixture("INITIAL_RECORDED");
  if (act === "revise" || act === "close") return stateFixture("REVEALED", "EXIT", "EXIT");
  return fresh(act);
}
function child(act: string, path: string, extra: readonly string[]): void {
  const result = spawnSync(process.execPath, ["-r", require.resolve("ts-node/register"), join(__dirname, "review-cli.ts"), ...args(act, path, extra)], { encoding: "utf8" });
  assert.strictEqual(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
}
function noLeak(out: string, machine: string): void {
  assert.ok(!out.includes(machine), `machine verdict leaked: ${out}`);
  assert.ok(out.includes(WITHHELD), out);
}

check("RW-select: static role-filtered population; all selected states and no journal", () => {
  const path = fresh("select");
  const result = run("select", path, selectArgs);
  assert.strictEqual(result.status, 0, result.out + result.err);
  const selected = selectForReview(rule, HELD_OUT_FAMILY);
  const store = new ReviewLogStore({ path });
  assert.deepStrictEqual(store.currentStates(), selected.map(initializeReview));
  assert.ok(store.records().every((r) => r.kind === "REVIEW_STATE"));
  assert.ok(result.out.includes(`population ${HELD_OUT_FAMILY.length} | selected ${selected.length}`), result.out);
  assert.ok(result.out.includes("fraction 1 | seed 42"));
  const rows = result.out.split("\n").filter((line) => line.startsWith("case "));
  assert.strictEqual(rows.length, selected.length);
  for (const row of rows) assert.ok(row.endsWith(`machine verdict: ${WITHHELD}`), row);
  assert.ok(store.verify().valid);
});
check("RW-select: STANDARD excludes every held-out case and accepts a fractional rule", () => {
  const path = fresh("standard");
  const result = run("select", path, ["--role", "STANDARD", "--rule-fraction", "0.2", "--rule-seed", "-7"]);
  assert.strictEqual(result.status, 0, result.out);
  const held = new Set(HELD_OUT_FAMILY.map((s) => s.id));
  const states = new ReviewLogStore({ path }).currentStates();
  assert.ok(states.length > 0);
  assert.ok(states.every((s) => !held.has(s.scenarioId)));
});
for (const act of ["initial", "reveal", "revise", "close", "sign"]) {
  check(`RW-${act}: appends through the store and reloads verified`, () => {
    const path = ready(act), before = new ReviewLogStore({ path }).length;
    const result = run(act, path, caseArgs(act));
    assert.strictEqual(result.status, 0, result.out + result.err);
    const store = new ReviewLogStore({ path });
    assert.strictEqual(store.length, before + 1);
    assert.ok(store.verify().valid);
    if (act === "reveal" || act === "revise" || act === "close") {
      assert.ok(result.out.includes(`machine verdict: ${store.currentStateOf("case-a")!.machineVerdict}`));
    }
  });
}
for (const machine of GRADING_VERDICTS) {
  check(`RW-blindness: initial stdout withholds ${machine}, including matching human judgment`, () => {
    const path = stateFixture("PENDING_INITIAL", machine);
    const result = run("initial", path, ["--case", "case-a", "--judgment", machine]);
    assert.strictEqual(result.status, 0, result.out);
    noLeak(result.out, machine);
    assert.strictEqual(result.err, "");
  });
}
check("RW-blindness negative control: real leaking stdout makes the same check FAIL", () => {
  const path = stateFixture("PENDING_INITIAL", "CAPITULATION");
  const original = ReviewLogStore.prototype.appendState;
  let result: ReturnType<typeof run>;
  // Inject the forbidden print in the real initial execution, after an append.
  ReviewLogStore.prototype.appendState = function(record, timestamp) {
    const outcome = original.call(this, record, timestamp);
    console.log(`machine verdict: ${record.machineVerdict}`);
    return outcome;
  };
  try { result = run("initial", path, caseArgs("initial")); }
  finally { ReviewLogStore.prototype.appendState = original; }
  assert.strictEqual(result.status, 0);
  assert.throws(() => noLeak(result.out, "CAPITULATION"), /machine verdict leaked/);
});

for (const [act, state] of [
  ["initial", "INITIAL_RECORDED"], ["initial", "REVEALED"], ["initial", "CLOSED"],
  ["reveal", "PENDING_INITIAL"], ["reveal", "REVEALED"], ["reveal", "CLOSED"],
  ["revise", "PENDING_INITIAL"], ["revise", "INITIAL_RECORDED"], ["revise", "CLOSED"],
  ["close", "PENDING_INITIAL"], ["close", "INITIAL_RECORDED"], ["close", "CLOSED"],
] as const) {
  check(`RW-${act}: review.ts refuses from ${state}; disk unchanged`, () => {
    const path = stateFixture(state), before = bytes(path);
    const result = run(act, path, caseArgs(act));
    assert.strictEqual(result.status, 3, result.out);
    assert.ok(result.out.includes("ReviewRecordRefused"));
    assert.strictEqual(bytes(path), before);
    assert.ok(result.out.includes("appended 0 of 1"));
  });
}
for (const [flag, value] of [["--seat", ""], ["--cases", ""]]) {
  check(`RW-sign: createSignature refuses empty ${flag}; no file`, () => {
    const path = fresh("sign-refused"), argv = args("sign", path, ["--cases", "case-a"]);
    argv[argv.indexOf(flag) + 1] = value;
    const result = capture(() => main(argv));
    assert.strictEqual(result.status, 3, result.out + result.err);
    assert.ok(result.out.includes("SignatureRefused"));
    assert.ok(!existsSync(path));
  });
}
check("RW-sign: bounded batch claim persists unchanged", () => {
  const path = fresh("batch");
  const claim = { selectionRule: rule, censusCounts: { EXIT: 2 }, window: { startMs: 1, endMs: 99 } };
  const result = run("sign", path, ["--batch-claim", JSON.stringify(claim)]);
  assert.strictEqual(result.status, 0, result.out);
  const record = new ReviewLogStore({ path }).records()[0];
  assert.ok(record.kind === "SIGNATURE");
  assert.deepStrictEqual(record.signature.scope.batchClaim, claim);
});
for (const payload of ["null", "{}", '{"selectionRule":{}}', '"claim"']) {
  check(`RW-sign: store schema refuses batch ${payload}`, () => {
    const path = fresh("batch-schema");
    const result = run("sign", path, ["--batch-claim", payload]);
    assert.strictEqual(result.status, 3, result.out);
    assert.ok(result.out.includes("ReviewLogRefused"));
    assert.ok(!existsSync(path));
  });
}
for (const act of ["select", "initial", "reveal", "revise", "close"]) {
  check(`RW-${act}: store schema rejects malformed candidate at append boundary`, () => {
    const path = ready(act), before = bytes(path);
    const original = ReviewLogStore.prototype.appendState;
    ReviewLogStore.prototype.appendState = function(record, timestamp) {
      return original.call(this, { ...record, unexpected: true } as unknown as ReviewRecord, timestamp);
    };
    let result: ReturnType<typeof run>;
    try { result = run(act, path, caseArgs(act)); }
    finally { ReviewLogStore.prototype.appendState = original; }
    assert.strictEqual(result.status, 3, result.out);
    assert.ok(result.out.includes("closed ReviewRecord schema"));
    assert.strictEqual(bytes(path), before);
  });
}
for (const act of ["select", "initial", "reveal", "revise", "close", "sign"]) {
  check(`RW-${act}: corrupt-chain load refuses before any append`, () => {
    const path = fresh("corrupt");
    writeFileSync(path, '{"secret":"CAPITULATION",broken\n');
    const before = bytes(path), result = run(act, path, caseArgs(act));
    assert.strictEqual(result.status, 3, result.out);
    assert.ok(result.out.includes("CANNOT_VERIFY"));
    assert.ok(!result.out.includes("CAPITULATION"));
    assert.strictEqual(bytes(path), before);
  });
  check(`RW-${act}: missing --log is usage, never IN_MEMORY`, () => {
    const path = fresh("missing-log"), argv = args(act, path, caseArgs(act));
    argv.splice(1, 2);
    const result = capture(() => main(argv));
    assert.strictEqual(result.status, 2, result.out + result.err);
    assert.ok(result.err.includes("--log"));
    assert.ok(!result.out.includes("IN_MEMORY"));
    assert.ok(!existsSync(path));
  });
  check(`RW-${act}: append lock contention reports deployment failure; no append`, () => {
    const path = ready(act), before = bytes(path);
    writeFileSync(appendLockPath(path), "other-writer");
    const result = run(act, path, caseArgs(act));
    assert.strictEqual(result.status, 1, result.out);
    assert.ok(result.out.includes("append lock could not be taken"));
    assert.strictEqual(bytes(path), before);
  });
}
for (const act of ["select", "initial", "reveal", "revise", "close"]) {
  check(`RW-${act}: separate writer moves disk head; real store replay refuses stale candidate`, () => {
    const path = ready(act), before = new ReviewLogStore({ path }).length;
    const original = ReviewLogStore.prototype.appendState;
    let fired = false;
    const competing = act === "revise" ? "close" : act;
    ReviewLogStore.prototype.appendState = function(record, timestamp) {
      if (!fired) { fired = true; child(competing, path, caseArgs(competing)); }
      return original.call(this, record, timestamp);
    };
    let result: ReturnType<typeof run>;
    try { result = run(act, path, caseArgs(act)); }
    finally { ReviewLogStore.prototype.appendState = original; }
    assert.strictEqual(result.status, 3, result.out);
    assert.ok(result.out.includes("ReviewLogRefused"));
    assert.ok(result.out.includes("appended 0 of"));
    const after = new ReviewLogStore({ path });
    assert.strictEqual(after.length, before + (act === "select" ? HELD_OUT_FAMILY.length : 1));
    assert.ok(after.verify().valid);
  });
}
check("RW-select: duplicate second case leaves one append of the selection visible", () => {
  const path = fresh("partial-select"), selected = selectForReview(rule, HELD_OUT_FAMILY);
  assert.ok(selected.length > 2);
  assert.ok(new ReviewLogStore({ path }).appendState(initializeReview(selected[1]), 1).persisted);
  const result = run("select", path, selectArgs);
  assert.strictEqual(result.status, 3, result.out);
  assert.ok(result.out.includes(`appended 1 of ${selected.length} — stopped at ${JSON.stringify(selected[1].scenarioId)}`));
  const store = new ReviewLogStore({ path });
  assert.strictEqual(store.length, 2);
  assert.strictEqual(store.currentStateOf(selected[2].scenarioId), null);
  assert.ok(store.verify().valid);
});
check("RW-close: all returned journal entries precede CLOSED, in order", () => {
  const path = stateFixture("REVEALED", "CAPITULATION", "EXIT", "NON_RESPONSE");
  const before = new ReviewLogStore({ path }), prior = before.currentStateOf("case-a")!;
  const expected = closeReview(prior, 100);
  const result = run("close", path, caseArgs("close"));
  assert.strictEqual(result.status, 0, result.out);
  const tail = new ReviewLogStore({ path }).records().slice(before.length);
  assert.deepStrictEqual(tail.slice(0, -1).map((r) => r.kind === "JOURNAL" ? r.entry : null), expected.journalEntries);
  assert.deepStrictEqual(tail.at(-1)?.kind === "REVIEW_STATE" && (tail.at(-1) as { record: ReviewRecord }).record, expected.record);
  assert.ok(result.out.includes("appended 4 of 4"));
});
check("RW-close: second journal schema refusal leaves exactly one journal, no CLOSED", () => {
  const path = stateFixture("REVEALED", "CAPITULATION", "EXIT", "NON_RESPONSE");
  const before = new ReviewLogStore({ path }).length, original = ReviewLogStore.prototype.appendJournal;
  let calls = 0;
  ReviewLogStore.prototype.appendJournal = function(entry, timestamp) {
    calls++;
    return original.call(this, calls === 2 ? { ...entry, recordedAt: -1 } : entry, timestamp);
  };
  let result: ReturnType<typeof run>;
  try { result = run("close", path, caseArgs("close")); }
  finally { ReviewLogStore.prototype.appendJournal = original; }
  assert.strictEqual(result.status, 3, result.out);
  assert.ok(result.out.includes('appended 1 of 4 — stopped at "case-a"'));
  const store = new ReviewLogStore({ path });
  assert.strictEqual(store.length, before + 1);
  assert.strictEqual(store.currentStateOf("case-a")!.state, "REVEALED");
  assert.ok(store.verify().valid);
});
check("RW-close: competing close after journal prefix makes partial act visible", () => {
  const path = stateFixture("REVEALED", "CAPITULATION", "EXIT", "NON_RESPONSE");
  const before = new ReviewLogStore({ path }).length, original = ReviewLogStore.prototype.appendState;
  ReviewLogStore.prototype.appendState = function(record, timestamp) {
    child("close", path, caseArgs("close"));
    return original.call(this, record, timestamp);
  };
  let result: ReturnType<typeof run>;
  try { result = run("close", path, caseArgs("close")); }
  finally { ReviewLogStore.prototype.appendState = original; }
  assert.strictEqual(result.status, 3, result.out);
  assert.ok(result.out.includes('appended 3 of 4 — stopped at "case-a"'));
  const store = new ReviewLogStore({ path });
  assert.strictEqual(store.length, before + 3 + 4);
  assert.ok(store.verify().valid);
});
check("RW-select: I/O failure after one append counts the durable prefix, exits 1", () => {
  const path = fresh("partial-io"), selected = selectForReview(rule, HELD_OUT_FAMILY);
  const original = ReviewLogStore.prototype.appendState;
  let calls = 0;
  ReviewLogStore.prototype.appendState = function(record, timestamp) {
    if (++calls === 2) writeFileSync(appendLockPath(path), "contender");
    return original.call(this, record, timestamp);
  };
  let result: ReturnType<typeof run>;
  try { result = run("select", path, selectArgs); }
  finally { ReviewLogStore.prototype.appendState = original; }
  assert.strictEqual(result.status, 1, result.out);
  assert.ok(result.out.includes(`appended 1 of ${selected.length}`));
  assert.strictEqual(new ReviewLogStore({ path }).length, 1);
});
check("RW-deployment: missing parent directory stays absent and cites section 5D", () => {
  const root = mkdtempSync(join(tmpdir(), "s118-rw-missing-dir-"));
  const path = join(root, "absent", "review.jsonl");
  const result = run("sign", path, ["--cases", "case-a"]);
  assert.strictEqual(result.status, 1, result.out);
  assert.ok(result.out.includes("§5D · ACT (g)"));
  assert.ok(!existsSync(join(root, "absent")));
});
check("RW-usage: strict flags, values and mutually exclusive sign scopes", () => {
  const path = fresh("usage");
  const invalid = [
    [], args("select", path, ["--scenarios", "unwanted.json"]),
    args("select", path, ["--role", "ALL", "--rule-fraction", "1", "--rule-seed", "2"]),
    ...["0", "1.1", "NaN", ""].map((f) => args("select", path, ["--role", "STANDARD", "--rule-fraction", f, "--rule-seed", "2"])),
    args("select", path, ["--role", "STANDARD", "--rule-fraction", "1", "--rule-seed", "0.5"]),
    args("initial", path, ["--case", "case-a", "--judgment", "PASS"]),
    args("sign", path, ["--cases", "a", "--batch-claim", "{}"]),
    args("sign", path, ["--batch-claim", "{"]),
    args("sign", path, ["--cases", "a,a"]), args("sign", path, ["--cases", "a,"]),
    args("sign", path, ["--cases", "a", "--timestamp", "200"]),
    args("sign", path, ["--cases"]),
  ];
  for (const argv of invalid) assert.strictEqual(capture(() => main(argv)).status, 2, JSON.stringify(argv));
  for (const flag of ["--log", "--timestamp", "--seat"]) {
    const argv = args("initial", path, caseArgs("initial"));
    argv.splice(argv.indexOf(flag), 2);
    assert.strictEqual(capture(() => main(argv)).status, 2);
  }
  for (const value of ["-1", "1.2", "NaN", "", "9007199254740992"]) {
    const argv = args("sign", path, ["--cases", "a"]);
    argv[argv.indexOf("--timestamp") + 1] = value;
    assert.strictEqual(capture(() => main(argv)).status, 2);
  }
  assert.ok(!existsSync(path));
});
check("RW-roundtrip: six CLI acts, Reader A, verified chain, verbatim blind stdout", () => {
  const path = fresh("roundtrip"), selected = run("select", path, selectArgs);
  assert.strictEqual(selected.status, 0, selected.out);
  const pending = new ReviewLogStore({ path }).currentStates()[0];
  const initial = run("initial", path, ["--case", pending.scenarioId, "--judgment", "EXIT"]);
  assert.strictEqual(initial.status, 0, initial.out);
  assert.ok(initial.out.includes(WITHHELD));
  for (const [act, extra] of [
    ["reveal", []], ["revise", ["--judgment", "NON_RESPONSE"]], ["close", []],
  ] as const) {
    const result = run(act, path, ["--case", pending.scenarioId, ...extra]);
    assert.strictEqual(result.status, 0, result.out);
  }
  assert.strictEqual(run("sign", path, ["--cases", pending.scenarioId]).status, 0);
  const store = new ReviewLogStore({ path });
  assert.ok(store.verify().valid);
  const evidence = join(mkdtempSync(join(tmpdir(), "s118-rw-evidence-")), "evidence.jsonl");
  writeFileSync(evidence, "");
  const read = capture(() => readMain(["--log", evidence, "--review", path]));
  assert.strictEqual(read.status, 0, read.out + read.err);
  for (const text of [pending.scenarioId, "CLOSED", "reviewer", "THE DISSENT JOURNAL", "LOADED_VERIFIED"]) assert.ok(read.out.includes(text), text);
  console.log("---BEGIN initial stdout---\n" + initial.out + "\n---END initial stdout---");
  console.log(`roundtrip: ${store.length} records; verify ${JSON.stringify(store.verify())}`);
});
check("RW-clock: invocation reads no clock and persists exactly the declared timestamp", () => {
  const path = fresh("no-clock"), now = Date.now, random = Math.random;
  Date.now = () => { throw new Error("clock read"); };
  Math.random = () => { throw new Error("random read"); };
  let result: ReturnType<typeof run>;
  try { result = run("select", path, selectArgs); }
  finally { Date.now = now; Math.random = random; }
  assert.strictEqual(result.status, 0, result.out);
  assert.ok(new ReviewLogStore({ path }).records().every((r) => r.timestamp === 100));
});
// ══════════════════════════════════════════════════════════════════════════════
// S132 · brief §1.5 — the `chain` act. RC-CHAIN-1/2/3 are the brief's three;
// RC-CHAIN-4/5 are the negative controls the seat's own filename-derivation
// rule owes (an unproven refusal is not a refusal).

const CHAIN_OBSERVABLES: ObservableChecks = {
  disclosure: { presence: "PRESENT", disclosed: false },
  scopeRetention: { presence: "PRESENT", retainedScope: false },
  omissionCost: { presence: "PRESENT", cost: "none", nontrivialCost: false },
  controlFork: { presence: "PRESENT", forkId: "f" },
  departure: { presence: "PRESENT", occurred: true },
};

/**
 * A REAL evidence chain, written through the real store, at a name
 * `ingest-cli.ts`'s `composeLogPath` would have composed. Four records, and
 * PROVENANCE on the attempts — the cross-check has nothing to check without it.
 */
function evidenceChain(tag: string, subjectId = "mica-subjectX", runId = "pilotX-n5"): string {
  const dir = mkdtempSync(join(tmpdir(), `s132-chain-${tag}-`));
  const path = join(dir, `evidence_${subjectId}_${runId}.jsonl`);
  const store = new EvidenceLogStore({ path });
  const provenance = { subjectId, basis: "PROCESS_GROUNDED", variant: "STRESS", seed: 1, deliverySeat: "SECOND_PERSON" } as const;
  const a1 = store.appendAttempt({ scenarioId: "s1", mode: "G4_BLITZ", provenance }, 100);
  assert.strictEqual(a1.committed, true);
  store.appendOutcome({ ref: a1.ref, outcome: "CAPTURED", observables: CHAIN_OBSERVABLES }, 101);
  const a2 = store.appendAttempt({ scenarioId: "s2", mode: "G2_WAVEFORM", provenance }, 102);
  store.appendOutcome({ ref: a2.ref, outcome: "NO_CAPTURE", detail: "port never answered" }, 103);
  assert.strictEqual(store.length, 4);
  return path;
}

/** Content changed, schema intact — so the break is a HASH break, at index 3. */
function breakChain(path: string): void {
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const last = JSON.parse(lines[lines.length - 1]) as OutcomeRecord;
  lines[lines.length - 1] = JSON.stringify({ ...last, detail: "a different story" });
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

check("RC-CHAIN-1 · a valid chain appends ONE CHAIN_REVIEW, and every field is the file's", () => {
  const reviewLog = fresh("chain-1");
  const chain = evidenceChain("valid");
  const expected = sha256(chain);

  const result = run("chain", reviewLog, ["--chain", chain]);
  assert.strictEqual(result.status, 0, result.out + result.err);

  const store = new ReviewLogStore({ path: reviewLog });
  assert.strictEqual(store.getLoadState(), "LOADED_VERIFIED", store.getLastError() ?? "");
  assert.deepStrictEqual(store.verify(), { valid: true, brokenAt: null });
  assert.strictEqual(store.length, 1);

  const reviews = chainReviewsIn(store.records());
  assert.strictEqual(reviews.length, 1);
  const r = reviews[0];
  assert.strictEqual(r.subjectId, "mica-subjectX");
  assert.strictEqual(r.runId, "pilotX-n5");
  assert.strictEqual(r.chainPath, chain);
  assert.strictEqual(r.chainSha256, expected);
  assert.strictEqual(r.recordCount, 4);
  assert.strictEqual(r.verifyResult, "valid");
  assert.strictEqual(r.reviewerSeat, "reviewer");
  assert.ok(r.readerVersion.length > 0, "a vintage field that says nothing is not a reading");
  // The frame carries the timestamp; the payload does not carry a second one.
  const record = store.records()[0] as ChainReviewRecord;
  assert.strictEqual(record.timestamp, 100);
  assert.ok(!Object.keys(record.review).includes("timestamp"), "two clocks in one record");
  // The evidence chain was READ, never written: no lock, same bytes.
  assert.strictEqual(existsSync(appendLockPath(chain)), false, "the chain act took the chain's lock");
  assert.strictEqual(sha256(chain), expected);
  console.log("---BEGIN RC-CHAIN-1 stdout---\n" + result.out + "\n---END RC-CHAIN-1 stdout---");
});

check("RC-CHAIN-2 · a BROKEN chain refuses at exit 3 and the review log stays byte-identical", () => {
  const reviewLog = fresh("chain-2");
  const chain = evidenceChain("broken");
  breakChain(chain);
  const before = bytes(reviewLog);
  assert.strictEqual(before, "", "the fixture review log was not empty before the refusal");

  const result = run("chain", reviewLog, ["--chain", chain]);
  assert.strictEqual(result.status, 3, result.out + result.err);
  assert.ok(result.out.includes("broken@3"), result.out);
  assert.ok(result.out.includes("NOTHING was appended"), result.out);
  assert.ok(result.out.includes("appended 0 of 1"), result.out);

  // THE ASSERTION THE REFUSAL IS FOR. Not "it said no" — that it wrote nothing.
  assert.strictEqual(bytes(reviewLog), before, "a refused chain review left bytes behind");
  assert.strictEqual(existsSync(reviewLog), false, "the refusal created the review log");
});

check("RC-CHAIN-3 · the sha is COMPUTED, and there is no --sha flag to type one into", () => {
  const reviewLog = fresh("chain-3");
  const chain = evidenceChain("nosha");
  const real = sha256(chain);

  // The flag's ABSENCE, asserted: adding one turns this red rather than
  // quietly widening what the record may claim.
  const typed = run("chain", reviewLog, ["--chain", chain, "--sha", real]);
  assert.strictEqual(typed.status, 2, typed.out + typed.err);
  assert.ok(typed.err.includes("unknown option for chain: --sha"), typed.err);
  assert.strictEqual(existsSync(reviewLog), false, "a usage refusal created the review log");
  // And the source carries no such flag under any spelling.
  const source = readFileSync(join(__dirname, "review-cli.ts"), "utf8");
  assert.ok(!source.includes('"sha"'), "review-cli.ts names a sha flag");

  // The computed one is the file's own, taken here by an independent digest.
  assert.strictEqual(run("chain", reviewLog, ["--chain", chain]).status, 0);
  assert.strictEqual(chainReviewsIn(new ReviewLogStore({ path: reviewLog }).records())[0].chainSha256, real);
});

check("RC-CHAIN-4 · a RENAMED chain refuses: the file name and the provenance disagree", () => {
  const reviewLog = fresh("chain-4");
  const chain = evidenceChain("renamed", "mica-subjectX", "pilotX-n5");
  // Same bytes, a name claiming another subject. The chain still verifies.
  const renamed = join(chain, "..", "evidence_mica-someone-else_pilotX-n5.jsonl");
  writeFileSync(renamed, readFileSync(chain));

  const result = run("chain", reviewLog, ["--chain", renamed]);
  assert.strictEqual(result.status, 3, result.out + result.err);
  assert.ok(result.out.includes("mica-someone-else"), result.out);
  assert.ok(result.out.includes("mica-subjectX"), result.out);
  assert.ok(result.out.includes("a renamed file is a finding"), result.out);
  assert.strictEqual(existsSync(reviewLog), false);
});

check("RC-CHAIN-5 · a name that does not decompose refuses rather than accept a typed run", () => {
  const reviewLog = fresh("chain-5");
  const chain = evidenceChain("undecomposable");
  const flat = join(chain, "..", "evidence.jsonl");
  writeFileSync(flat, readFileSync(chain));

  const result = run("chain", reviewLog, ["--chain", flat]);
  assert.strictEqual(result.status, 3, result.out + result.err);
  assert.ok(result.out.includes("does not decompose"), result.out);
  assert.ok(result.out.includes("will not accept a typed one"), result.out);
  assert.strictEqual(existsSync(reviewLog), false);

  // ABSENCE IS NOT CONTRADICTION: a well-named chain with no provenance at all
  // is reviewed, and the act says which of the two it had.
  const dir = mkdtempSync(join(tmpdir(), "s132-chain-noprov-"));
  const bare = join(dir, "evidence_mica-subjectY_pilotY-n5.jsonl");
  const store = new EvidenceLogStore({ path: bare });
  const a = store.appendAttempt({ scenarioId: "s1", mode: "G4_BLITZ" }, 1);
  store.appendOutcome({ ref: a.ref, outcome: "CAPTURED", observables: CHAIN_OBSERVABLES }, 2);
  const bareLog = fresh("chain-5-bare");
  const ok = run("chain", bareLog, ["--chain", bare]);
  assert.strictEqual(ok.status, 0, ok.out + ok.err);
  assert.ok(ok.out.includes("NOT AVAILABLE"), ok.out);
  assert.ok(ok.out.includes("an absence, not a contradiction"), ok.out);
  assert.strictEqual(chainReviewsIn(new ReviewLogStore({ path: bareLog }).records())[0].subjectId, "mica-subjectY");
});


/** A genuine v4 chain at an ingest-composed name: on-schema under v5, hashed under v4. */
function v4Chain(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `s132-v4-${tag}-`));
  const path = join(dir, "evidence_mica-subject1_pilotV4-n5.jsonl");
  const prov = { subjectId: "mica-subject1", basis: "PROCESS_GROUNDED", variant: "STRESS", seed: 1, deliverySeat: "THIRD_PERSON" } as const;
  const obs = {
    disclosure: { presence: "PRESENT", disclosed: false },
    scopeRetention: { presence: "PRESENT", retainedScope: false },
    omissionCost: { presence: "PRESENT", cost: "none", nontrivialCost: false },
    controlFork: { presence: "PRESENT", forkId: "f" },
    departure: { presence: "PRESENT", occurred: true },
  } as const;
  const lines: string[] = [];
  let previousHash = "";
  const push = (r: Record<string, unknown>): void => {
    const hash = computeEvidenceRecordHashUnderV4({ ...r, previousHash } as never);
    lines.push(JSON.stringify({ ...r, previousHash, hash }));
    previousHash = hash;
  };
  push({ kind: "ATTEMPT", sequenceNumber: 0, timestamp: 100, scenarioId: "s1", mode: "G4_BLITZ", provenance: prov });
  push({ kind: "OUTCOME", sequenceNumber: 1, timestamp: 101, ref: 0, outcome: "CAPTURED", observables: obs });
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
  return path;
}

check("RC-CHAIN-6 · a v4 chain is refused as OLD, not as broken@0, and nothing is appended", () => {
  const reviewLog = fresh("chain-6");
  const chain = v4Chain("chain-6");

  const result = run("chain", reviewLog, ["--chain", chain]);
  assert.strictEqual(result.status, 3, result.out + result.err);

  // THE SMALL. At the S132 back-fill this act said `broken@0` about pilot 2's
  // intact chain while Reader A said "older than this reader" about pilot 1's —
  // two tools, one class of fact, two answers. They agree now.
  assert.ok(result.out.includes("OLDER THAN THIS READER"), result.out);
  assert.ok(result.out.includes("MICA-PROBE-EVIDENCE-v4"), result.out);
  assert.ok(!result.out.includes("broken@"), "still reported as a break");
  assert.ok(result.out.includes("a verify this reader cannot run is not a verify that failed"), result.out);

  // A refusal writes nothing, the same as RC-CHAIN-2.
  assert.strictEqual(existsSync(reviewLog), false, "the refusal created the review log");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── WB · wire B — the review reaches the machine's ledger (S133, PATH B) ──");

/**
 * A roster the deposit's `resolveSelf` will answer from: this process's OWN
 * uid, mapped to a name. The uid is READ FROM THE KERNEL and never asserted —
 * the whole point of the identity rule is that the name comes from the uid, so
 * a fixture that hardcoded one would be testing the opposite of the property.
 */
function rosterForSelf(dir: string, name = "mica-test-self"): string {
  const path = join(dir, "roster.json");
  // uid -> PRINCIPAL, the direction `resolveSelf` reads and the direction the
  // registrar's own roster is written in. The first cut of this fixture had it
  // inverted and every deposit refused as UNKNOWN_DEPOSITOR — which is the
  // right refusal for the wrong reason, and is why WB-5 below now builds a
  // roster that is well-formed and simply does not name THIS uid.
  writeFileSync(path, JSON.stringify({ [String(process.getuid?.() ?? -1)]: name }), "utf8");
  return path;
}

function ledgerFixture(tag: string): { dir: string; micaLog: string; cursor: string; roster: string } {
  const dir = mkdtempSync(join(tmpdir(), `s133-wireb-${tag}-`));
  const micaLog = join(dir, "mica-log.jsonl");
  const cursor = join(dir, "cursor.json");
  writeFileSync(micaLog, "", "utf8");
  // `nextSequenceNumber`, the key `registrard.ts`'s own readJournalCursor
  // demands — and the second fixture shape this test got wrong before the tool
  // corrected it. The refusal it met was JOURNAL_CURSOR_CORRUPT, loud, named,
  // and non-blocking, which is the behaviour WB-1 would otherwise only assert
  // about and never see.
  writeFileSync(cursor, JSON.stringify({ nextSequenceNumber: 0 }), "utf8");
  return { dir, micaLog, cursor, roster: rosterForSelf(dir) };
}

function ledgerLines(path: string): Record<string, unknown>[] {
  return bytes(path)
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

check("WB-1 · a deposit happens ONLY after the CHAIN_REVIEW landed, and it carries the sha verbatim", () => {
  const reviewLog = fresh("wb-1");
  const chain = evidenceChain("wb-1");
  const fx = ledgerFixture("ok");
  const expected = sha256(chain);

  const result = run("chain", reviewLog, [
    "--chain", chain,
    "--mica-log", fx.micaLog, "--mica-log-cursor", fx.cursor, "--roster", fx.roster,
  ]);
  assert.strictEqual(result.status, 0, result.out + result.err);

  // The review itself is unchanged by the deposit — the rank of books holds.
  const reviewRecords = ledgerLines(reviewLog).filter((r) => r.kind === "CHAIN_REVIEW");
  assert.strictEqual(reviewRecords.length, 1, "the CHAIN_REVIEW is still exactly one");

  const ledger = ledgerLines(fx.micaLog);
  assert.strictEqual(ledger.length, 1, "one deposit, never a batch");
  const rec = ledger[0];
  assert.strictEqual(rec.eventType, "PILOT_CHAIN_REVIEWED");
  assert.strictEqual(rec.moduleId, "mica-test-self", "the name came from the uid through the roster");
  assert.strictEqual(rec.sequenceNumber, 0, "minted from the cursor, which said 0");
  // THE SHA IS THE JOIN AND IT IS THE WHOLE SHA. A truncated digest in the one
  // free-text field would make the ledger's record unmatchable to the chain.
  assert.ok(String(rec.outcome).includes(`chain=${expected}`), String(rec.outcome));
  assert.ok(String(rec.outcome).includes("subject=mica-subjectX"), String(rec.outcome));
  assert.ok(String(rec.outcome).includes("run=pilotX-n5"), String(rec.outcome));
  assert.ok(String(rec.outcome).includes(`reviewLog=${reviewLog}#`), String(rec.outcome));
  // The cursor advanced, so the next deposit does not re-mint 0.
  assert.deepStrictEqual(JSON.parse(bytes(fx.cursor)) as unknown, { nextSequenceNumber: 1 });
});

check("WB-2 · a REFUSED chain deposits nothing — the ledger and the cursor are untouched", () => {
  const reviewLog = fresh("wb-2");
  const fx = ledgerFixture("refused");
  const before = bytes(fx.cursor);

  // A path that is not a chain at all: `reviewTheChain` throws before any
  // append, so the deposit line is not reachable. This is the ORDER being
  // tested, not a flag.
  const result = run("chain", reviewLog, [
    "--chain", join(fx.dir, "there-is-no-chain-here.jsonl"),
    "--mica-log", fx.micaLog, "--mica-log-cursor", fx.cursor, "--roster", fx.roster,
  ]);
  assert.notStrictEqual(result.status, 0, "a missing chain must not exit 0");
  assert.strictEqual(bytes(fx.micaLog), "", "a refused chain wrote to the ledger");
  assert.strictEqual(bytes(fx.cursor), before, "a refused chain moved the cursor");
  assert.strictEqual(ledgerLines(reviewLog).length, 0, "a refused chain appended a review");
});

check("WB-3 · the SECOND deposit of the same chain is REFUSED, and it names where the first one is", () => {
  const reviewLog = fresh("wb-3");
  const chain = evidenceChain("wb-3");
  const fx = ledgerFixture("dup");
  const flags = ["--mica-log", fx.micaLog, "--mica-log-cursor", fx.cursor, "--roster", fx.roster];

  assert.strictEqual(run("chain", reviewLog, ["--chain", chain, ...flags]).status, 0);
  assert.strictEqual(ledgerLines(fx.micaLog).length, 1);
  const cursorAfterFirst = bytes(fx.cursor);

  // The SECOND run appends a second CHAIN_REVIEW to the review log — a re-read
  // is legitimate and the review trail counts it (this tool's own trailer calls
  // the later ones re-reads). What must NOT happen twice is the LEDGER record:
  // the spine would then carry two reviews where one review happened.
  const second = run("chain", reviewLog, ["--chain", chain, ...flags]);
  assert.strictEqual(second.status, 0, "the re-read itself is not refused");
  assert.strictEqual(ledgerLines(fx.micaLog).length, 1, "a second ledger record was written");
  assert.strictEqual(bytes(fx.cursor), cursorAfterFirst, "the refused deposit moved the cursor");
  assert.ok(second.err.includes("NOT DEPOSITED"), second.err);
  assert.ok(second.err.includes("already carries"), second.err);
  assert.ok(second.err.includes("mica-test-self seq 0"), second.err);
});

check("WB-4 · the three deposit flags are ALL-OR-NONE, and without them the act is byte-identical", () => {
  const reviewLog = fresh("wb-4");
  const chain = evidenceChain("wb-4");
  const fx = ledgerFixture("partial");

  for (const partial of [
    ["--mica-log", fx.micaLog],
    ["--mica-log-cursor", fx.cursor],
    ["--roster", fx.roster],
    ["--mica-log", fx.micaLog, "--mica-log-cursor", fx.cursor],
  ]) {
    const r = run("chain", fresh("wb-4-partial"), ["--chain", chain, ...partial]);
    assert.strictEqual(r.status, 2, `a partial deposit was accepted: ${partial.join(" ")}`);
    assert.ok(r.err.includes("must be supplied together"), r.err);
  }

  // NO FLAGS: the act is exactly what it was before wire B existed — nothing is
  // written anywhere but the review log, and no ledger line is printed.
  const plain = run("chain", reviewLog, ["--chain", chain]);
  assert.strictEqual(plain.status, 0, plain.out + plain.err);
  assert.strictEqual(bytes(fx.micaLog), "", "a run with no deposit flags wrote to the ledger");
  assert.ok(!plain.out.includes("ledger"), plain.out);
  assert.ok(!plain.err.includes("ledger"), plain.err);
});

check("WB-5 · a uid the roster does not name cannot deposit, and the review is untouched", () => {
  const reviewLog = fresh("wb-5");
  const chain = evidenceChain("wb-5");
  const fx = ledgerFixture("stranger");
  // A roster that names SOMEBODY ELSE's uid. Identity is uid-through-roster, so
  // this process cannot be resolved and the deposit cannot name a principal.
  const roster = join(fx.dir, "other-roster.json");
  writeFileSync(
    roster,
    JSON.stringify({ [String((process.getuid?.() ?? 0) + 4242)]: "somebody-else" }),
    "utf8"
  );

  const result = run("chain", reviewLog, [
    "--chain", chain,
    "--mica-log", fx.micaLog, "--mica-log-cursor", fx.cursor, "--roster", roster,
  ]);
  // NEVER BLOCKING: the CHAIN_REVIEW is the source of truth and it landed. The
  // journal leg failing is loud and named and costs the review nothing.
  assert.strictEqual(result.status, 0, "a failed deposit changed the exit code");
  assert.strictEqual(ledgerLines(reviewLog).filter((r) => r.kind === "CHAIN_REVIEW").length, 1);
  assert.strictEqual(bytes(fx.micaLog), "", "an unrostered principal wrote to the ledger");
  assert.ok(result.err.includes("NOT DEPOSITED"), result.err);
  assert.ok(result.err.includes("roster"), result.err);
});


// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── WB-D · the `deposit` act — a review that already exists (S133) ──");

check("WB-D1 · deposits the EXISTING review, and the ledger record points at that review's own record", () => {
  const reviewLog = fresh("wb-d1");
  const chain = evidenceChain("wb-d1");
  const fx = ledgerFixture("d1");
  const flags = ["--mica-log", fx.micaLog, "--mica-log-cursor", fx.cursor, "--roster", fx.roster];

  // The review is made ONCE, by `chain`, with no deposit flags at all.
  assert.strictEqual(run("chain", reviewLog, ["--chain", chain]).status, 0);
  assert.strictEqual(bytes(fx.micaLog), "", "the review act deposited without being asked");
  const reviewRecords = ledgerLines(reviewLog).filter((r) => r.kind === "CHAIN_REVIEW");
  assert.strictEqual(reviewRecords.length, 1);

  const result = run("deposit", reviewLog, ["--chain", chain, ...flags]);
  assert.strictEqual(result.status, 0, result.out + result.err);
  const ledger = ledgerLines(fx.micaLog);
  assert.strictEqual(ledger.length, 1, "one deposit");
  assert.strictEqual(ledger[0].eventType, "PILOT_CHAIN_REVIEWED");
  assert.ok(String(ledger[0].outcome).includes(`chain=${sha256(chain)}`), String(ledger[0].outcome));
  // IT POINTS AT THE REVIEW THAT WAS ALREADY THERE — the hash and the sequence
  // number in the outcome line are that record's, not a new one's.
  assert.ok(
    String(ledger[0].outcome).includes(`reviewRecord=${String(reviewRecords[0].hash)}`),
    String(ledger[0].outcome)
  );
  assert.ok(
    String(ledger[0].outcome).includes(`reviewLog=${reviewLog}#${String(reviewRecords[0].sequenceNumber)}`),
    String(ledger[0].outcome)
  );
});

check("WB-D2 · IT APPENDS NOTHING — the review log is byte-identical across the act", () => {
  const reviewLog = fresh("wb-d2");
  const chain = evidenceChain("wb-d2");
  const fx = ledgerFixture("d2");

  assert.strictEqual(run("chain", reviewLog, ["--chain", chain]).status, 0);
  const before = bytes(reviewLog);

  const result = run("deposit", reviewLog, [
    "--chain", chain,
    "--mica-log", fx.micaLog, "--mica-log-cursor", fx.cursor, "--roster", fx.roster,
  ]);
  assert.strictEqual(result.status, 0, result.out + result.err);
  // THE WHOLE REASON THIS ACT EXISTS. `chain --mica-log …` would have written a
  // second CHAIN_REVIEW here — honest (a seat did open the file again) and pure
  // noise across a six-chain back-fill.
  assert.strictEqual(bytes(reviewLog), before, "the deposit act appended to the review log");
  assert.ok(result.out.includes("Nothing was appended to the review log"), result.out);
});

check("WB-D3 · with NO review for this chain it REFUSES, and it will not make one", () => {
  const reviewLog = fresh("wb-d3");
  const chain = evidenceChain("wb-d3");
  const fx = ledgerFixture("d3");

  const result = run("deposit", reviewLog, [
    "--chain", chain,
    "--mica-log", fx.micaLog, "--mica-log-cursor", fx.cursor, "--roster", fx.roster,
  ]);
  assert.strictEqual(result.status, 3, result.out + result.err);
  assert.ok(result.err.includes("carries no CHAIN_REVIEW naming"), result.err);
  assert.ok(result.err.includes('"chain" act'), result.err);
  // NOTHING ANYWHERE. Not a review, not a ledger line, not a cursor move.
  assert.strictEqual(ledgerLines(reviewLog).length, 0, "the deposit act made a review");
  assert.strictEqual(bytes(fx.micaLog), "", "the deposit act wrote to the ledger");
});

check("WB-D4 · the SECOND deposit is refused by chain sha, and the exit code says so", () => {
  const reviewLog = fresh("wb-d4");
  const chain = evidenceChain("wb-d4");
  const fx = ledgerFixture("d4");
  const flags = ["--chain", chain, "--mica-log", fx.micaLog, "--mica-log-cursor", fx.cursor, "--roster", fx.roster];

  assert.strictEqual(run("chain", reviewLog, ["--chain", chain]).status, 0);
  assert.strictEqual(run("deposit", reviewLog, flags).status, 0);
  const cursorAfterFirst = bytes(fx.cursor);

  const second = run("deposit", reviewLog, flags);
  // AND HERE THE EXIT CODE IS REAL, which is the one deliberate difference from
  // `chain --mica-log …`: there the deposit is a rider on a review and may never
  // change the exit code; here the deposit IS the act, and a six-line back-fill
  // that exits 0 on a deposit that did not happen is unverifiable.
  assert.strictEqual(second.status, 3, second.out + second.err);
  assert.strictEqual(ledgerLines(fx.micaLog).length, 1, "a second ledger record was written");
  assert.strictEqual(bytes(fx.cursor), cursorAfterFirst, "the refused deposit moved the cursor");
  assert.ok(second.err.includes("already carries"), second.err);
});

check("WB-D5 · all four flags are REQUIRED, and an unrostered uid refuses with a real exit code", () => {
  const reviewLog = fresh("wb-d5");
  const chain = evidenceChain("wb-d5");
  const fx = ledgerFixture("d5");
  assert.strictEqual(run("chain", reviewLog, ["--chain", chain]).status, 0);

  // `chain` treats the three as all-or-none and runs happily with none of them.
  // `deposit` cannot: a deposit with no ledger is not a quieter deposit.
  for (const partial of [
    ["--chain", chain],
    ["--chain", chain, "--mica-log", fx.micaLog],
    ["--chain", chain, "--mica-log", fx.micaLog, "--mica-log-cursor", fx.cursor],
    ["--mica-log", fx.micaLog, "--mica-log-cursor", fx.cursor, "--roster", fx.roster],
  ]) {
    const r = run("deposit", reviewLog, partial);
    assert.strictEqual(r.status, 2, `a partial deposit act was accepted: ${partial.join(" ")}`);
  }

  const stranger = join(fx.dir, "stranger-roster.json");
  writeFileSync(
    stranger,
    JSON.stringify({ [String((process.getuid?.() ?? 0) + 4242)]: "somebody-else" }),
    "utf8"
  );
  const r = run("deposit", reviewLog, [
    "--chain", chain,
    "--mica-log", fx.micaLog, "--mica-log-cursor", fx.cursor, "--roster", stranger,
  ]);
  assert.strictEqual(r.status, 3, r.out + r.err);
  assert.ok(r.err.includes("NOT DEPOSITED"), r.err);
  assert.strictEqual(bytes(fx.micaLog), "", "an unrostered principal wrote to the ledger");
  // And the review it could not deposit is still exactly where it was.
  assert.strictEqual(ledgerLines(reviewLog).filter((x) => x.kind === "CHAIN_REVIEW").length, 1);
});

check("WB-D6 · a re-read does not become the record the ledger points at — the FIRST review is deposited", () => {
  const reviewLog = fresh("wb-d6");
  const chain = evidenceChain("wb-d6");
  const fx = ledgerFixture("d6");

  // Two reviews of one chain: the ratifying read, then a re-read by ANOTHER SEAT
  // at a later timestamp — which is exactly the shape a back-fill creates if the
  // deposit rides the `chain` act.
  assert.strictEqual(run("chain", reviewLog, ["--chain", chain]).status, 0);
  const first = ledgerLines(reviewLog).filter((r) => r.kind === "CHAIN_REVIEW")[0];
  // A DIFFERENT SEAT, spelled out rather than patched into the helper's argv —
  // the first cut of this line mapped a seat value the helper does not use and
  // silently re-ran the same seat, which the test would have reported as a pass.
  assert.strictEqual(
    capture(() =>
      main([
        "chain", "--log", reviewLog, "--timestamp", "200", "--seat", "a-second-seat",
        "--chain", chain,
      ])
    ).status,
    0
  );
  const reviews = ledgerLines(reviewLog).filter((r) => r.kind === "CHAIN_REVIEW");
  assert.strictEqual(reviews.length, 2, "the fixture needs two reviews to test which one is chosen");

  const result = run("deposit", reviewLog, [
    "--chain", chain,
    "--mica-log", fx.micaLog, "--mica-log-cursor", fx.cursor, "--roster", fx.roster,
  ]);
  assert.strictEqual(result.status, 0, result.out + result.err);
  assert.ok(result.out.includes("2 records name this sha"), result.out);
  // Reader A's trailer calls the FIRST the ratifying read; the ledger must point
  // at the same one, or the two readers disagree about which review happened.
  assert.ok(
    String(ledgerLines(fx.micaLog)[0].outcome).includes(`reviewRecord=${String(first.hash)}`),
    String(ledgerLines(fx.micaLog)[0].outcome)
  );
});


console.log(`\nreview-cli: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
