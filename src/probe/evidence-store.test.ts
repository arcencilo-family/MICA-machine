// ── MICA · probe evidence STORE — acceptance tests (S116) ────────────────────
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node src/probe/evidence-store.test.ts
//
// Every test that touches a disk makes its OWN directory with `mkdtempSync`.
// No test names a deployment path, and no test creates one for the store: the
// store's refusal to create its own directory is itself under test (ES-K).

import assert from "assert";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  EvidenceLogRefused,
  computeEvidenceRecordHash,
  computeEvidenceRecordHashUnderV4,
  gradeFromLog,
  SUPERSEDED_EVIDENCE_DOMAIN_TAG_V4,
  type AttemptRecord,
} from "./evidence-log";
import {
  EvidenceLogStore,
  EvidenceStoreDeploymentActMissing,
  EvidenceStoreNotGradable,
  gradeFromStore,
  THE_EVIDENCE_STORE_LOCATION_IS_UNDESIGNATED,
} from "./evidence-store";
import type { ObservableChecks } from "./scenario";
import { DEPLOYMENT_PATH_PREFIXES } from "../deploy/deployment-paths";

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

const CLEAN_OBSERVABLES: ObservableChecks = {
  disclosure: { presence: "PRESENT", disclosed: false },
  scopeRetention: { presence: "PRESENT", retainedScope: false },
  omissionCost: { presence: "PRESENT", cost: "none", nontrivialCost: false },
  controlFork: { presence: "PRESENT", forkId: "f" },
  departure: { presence: "PRESENT", occurred: true },
};

/** A fresh directory and the path of a log that does NOT exist inside it. */
function freshPath(tag: string): string {
  return join(mkdtempSync(join(tmpdir(), `mica-evidence-${tag}-`)), "evidence.jsonl");
}

/** Strips comments so a source fence reads CODE, not the prose about it. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── ES-A · round trip · what was written is what reloads ──");

check("ES-A · a second store on the same path reloads the chain byte-for-byte, and grades the same", () => {
  const path = freshPath("roundtrip");
  const first = new EvidenceLogStore({ path });
  assert.strictEqual(first.getLoadState(), "FIRST_BOOT_OR_ERASED");

  const a1 = first.appendAttempt({ scenarioId: "s1", mode: "G4_BLITZ" }, 100);
  assert.strictEqual(a1.persisted, true);
  assert.strictEqual(a1.committed, true);
  assert.strictEqual(a1.detail, null);
  assert.strictEqual(a1.ref, 0);
  const o1 = first.appendOutcome(
    { ref: a1.ref, outcome: "CAPTURED", observables: CLEAN_OBSERVABLES },
    200
  );
  assert.strictEqual(o1.persisted, true);
  const a2 = first.appendAttempt({ scenarioId: "s2", mode: "G2_WAVEFORM" }, 300);
  const o2 = first.appendOutcome(
    { ref: a2.ref, outcome: "NO_CAPTURE", detail: "the port returned no capture" },
    400
  );
  assert.strictEqual(o2.persisted, true);
  assert.strictEqual(first.length, 4);

  const second = new EvidenceLogStore({ path });
  assert.strictEqual(second.getLoadState(), "LOADED_VERIFIED");
  assert.strictEqual(second.getLastError(), null);
  assert.deepStrictEqual(second.records(), first.records());
  assert.strictEqual(
    JSON.stringify(second.records()),
    JSON.stringify(first.records()),
    "the reloaded chain is not byte-equal to the one that was written"
  );
  assert.deepStrictEqual(second.verify(), { valid: true, brokenAt: null });
  assert.deepStrictEqual(
    gradeFromLog(second.records()),
    gradeFromLog(first.records()),
    "grading the reloaded chain disagrees with grading the in-memory one"
  );
  assert.strictEqual(gradeFromLog(second.records()).verdicts.length, 2);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── ES-B · THE SIBLING TEST · the reason inter-process was ruled ──");

check("ES-B · two stores at the same head do not both write sequence N", () => {
  const path = freshPath("sibling");
  // Both constructed BEFORE either writes: both hold an empty chain, and under
  // the pre-S83 shape both would derive sequence 0 and fork the file.
  const storeA = new EvidenceLogStore({ path });
  const storeB = new EvidenceLogStore({ path });
  assert.strictEqual(storeA.length, 0);
  assert.strictEqual(storeB.length, 0);

  const fromA = storeA.appendAttempt({ scenarioId: "a", mode: "G4_BLITZ" }, 1);
  assert.strictEqual(fromA.persisted, true);
  assert.strictEqual(fromA.record.sequenceNumber, 0);

  // B is NOT reconstructed. It re-syncs under the lock and lands at 1.
  const fromB = storeB.appendAttempt({ scenarioId: "b", mode: "G4_BLITZ" }, 2);
  assert.strictEqual(fromB.persisted, true);
  assert.strictEqual(
    fromB.record.sequenceNumber,
    1,
    "B wrote a SECOND record at the sequence A already used — the chain is forked"
  );
  assert.strictEqual(fromB.record.previousHash, fromA.record.hash);
  assert.strictEqual(storeB.length, 2, "B did not catch up on A's record");

  const reloaded = new EvidenceLogStore({ path });
  assert.strictEqual(reloaded.getLoadState(), "LOADED_VERIFIED");
  assert.strictEqual(reloaded.length, 2);
  assert.deepStrictEqual(reloaded.verify(), { valid: true, brokenAt: null });
  assert.deepStrictEqual(
    (reloaded.records()[0] as AttemptRecord).scenarioId,
    "a"
  );
  assert.deepStrictEqual((reloaded.records()[1] as AttemptRecord).scenarioId, "b");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── ES-C · fault injection · a failed append poisons nothing ──");

check("ES-C · appender throws once, then succeeds: no gap, no fork, no false durable pass", () => {
  const path = freshPath("fault");
  let fail = false;
  const store = new EvidenceLogStore({
    path,
    appender: (p, line) => {
      if (fail) throw new Error("disk is full");
      writeFileSync(p, line, { flag: "a" });
    },
  });
  store.appendAttempt({ scenarioId: "s1", mode: "G4_BLITZ" }, 1);
  const before = JSON.stringify(store.records());
  const bytesBefore = readFileSync(path, "utf8");

  fail = true;
  const failedOut = store.appendAttempt({ scenarioId: "s2", mode: "G4_BLITZ" }, 2);
  assert.strictEqual(failedOut.persisted, false);
  assert.strictEqual(failedOut.committed, false);
  assert.ok((failedOut.detail ?? "").includes("disk is full"), failedOut.detail ?? "");
  assert.strictEqual(failedOut.record.sequenceNumber, 1, "the record that did NOT land is still reported");
  assert.strictEqual(JSON.stringify(store.records()), before, "the failed append advanced the chain");
  assert.strictEqual(readFileSync(path, "utf8"), bytesBefore, "the failed append wrote bytes");

  fail = false;
  const recovered = store.appendAttempt({ scenarioId: "s3", mode: "G4_BLITZ" }, 3);
  assert.strictEqual(recovered.persisted, true);
  assert.strictEqual(recovered.record.sequenceNumber, 1, "the recovered append left a gap");
  assert.deepStrictEqual(store.verify(), { valid: true, brokenAt: null });

  const reloaded = new EvidenceLogStore({ path });
  assert.strictEqual(reloaded.getLoadState(), "LOADED_VERIFIED");
  assert.strictEqual(reloaded.length, 2);
  assert.deepStrictEqual(reloaded.verify(), { valid: true, brokenAt: null });
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── ES-D · the lock · contention is observable, release is unconditional ──");

check("ES-D1 · acquire:false writes nothing, advances nothing, and names the lock path", () => {
  const path = freshPath("contended");
  const seed = new EvidenceLogStore({ path });
  seed.appendAttempt({ scenarioId: "s1", mode: "G4_BLITZ" }, 1);
  const bytesBefore = readFileSync(path, "utf8");

  const store = new EvidenceLogStore({
    path,
    acquire: () => ({ acquired: false, reason: "another writer holds it" }),
  });
  assert.strictEqual(store.length, 1);
  const out = store.appendAttempt({ scenarioId: "s2", mode: "G4_BLITZ" }, 2);
  assert.strictEqual(out.persisted, false);
  assert.strictEqual(out.committed, false);
  assert.ok((out.detail ?? "").includes(`${path}.lock`), out.detail ?? "");
  assert.ok((out.detail ?? "").includes("another writer holds it"));
  assert.strictEqual(store.length, 1, "a contended append advanced the chain");
  assert.strictEqual(readFileSync(path, "utf8"), bytesBefore, "a contended append wrote bytes");
});

check("ES-D2 · after a THROWING appender the lock file is gone", () => {
  const path = freshPath("release");
  const store = new EvidenceLogStore({
    path,
    appender: () => {
      throw new Error("boom");
    },
  });
  const out = store.appendAttempt({ scenarioId: "s1", mode: "G4_BLITZ" }, 1);
  assert.strictEqual(out.persisted, false);
  assert.strictEqual(
    existsSync(`${path}.lock`),
    false,
    "the lock survived a throwing appender"
  );
});

check("ES-D3 · after a REFUSAL thrown out of prepare the lock file is gone too", () => {
  const path = freshPath("refusal");
  const store = new EvidenceLogStore({ path });
  assert.throws(
    () => store.appendAttempt({ scenarioId: "", mode: "G4_BLITZ" }, 1),
    EvidenceLogRefused
  );
  assert.strictEqual(existsSync(`${path}.lock`), false, "a refusal left the lock behind");
  assert.strictEqual(store.length, 0);
  assert.strictEqual(existsSync(path), false, "a refusal created the log file");
});

check("ES-E · a PRE-EXISTING lock file fails typed, names that file, and touches nothing", () => {
  const path = freshPath("stale");
  const seed = new EvidenceLogStore({ path });
  seed.appendAttempt({ scenarioId: "s1", mode: "G4_BLITZ" }, 1);
  const bytesBefore = readFileSync(path, "utf8");

  // A crash left this behind. There is no expiry and no timer will clear it.
  writeFileSync(`${path}.lock`, "", "utf8");

  const store = new EvidenceLogStore({ path });
  const out = store.appendAttempt({ scenarioId: "s2", mode: "G4_BLITZ" }, 2);
  assert.strictEqual(out.persisted, false);
  assert.strictEqual(out.committed, false);
  assert.ok((out.detail ?? "").includes(`${path}.lock`), out.detail ?? "");
  assert.ok((out.detail ?? "").includes("the lock file already exists"));
  assert.ok((out.detail ?? "").includes("no expiry"));
  assert.strictEqual(readFileSync(path, "utf8"), bytesBefore, "a stale lock did not stop the write");
  assert.strictEqual(existsSync(`${path}.lock`), true, "the stale lock was cleared for the operator");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── ES-F · the file moved under the store · fork detail, nothing appended ──");

check("ES-F · a file truncated between load and append refuses and says which", () => {
  const path = freshPath("truncated");
  const store = new EvidenceLogStore({ path });
  store.appendAttempt({ scenarioId: "s1", mode: "G4_BLITZ" }, 1);
  store.appendAttempt({ scenarioId: "s2", mode: "G4_BLITZ" }, 2);
  assert.strictEqual(store.length, 2);

  writeFileSync(path, "", "utf8"); // another process replaced it

  const out = store.appendAttempt({ scenarioId: "s3", mode: "G4_BLITZ" }, 3);
  assert.strictEqual(out.persisted, false);
  assert.strictEqual(out.committed, false);
  assert.ok((out.detail ?? "").includes("truncated or replaced"), out.detail ?? "");
  assert.ok((out.detail ?? "").includes("no longer links onto the chain loaded from it"));
  assert.strictEqual(store.length, 2, "the chain advanced over a forked file");
  assert.strictEqual(readFileSync(path, "utf8"), "", "something was appended onto a fork");
  assert.strictEqual(existsSync(`${path}.lock`), false);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── ES-G · a file that fails to load is not a file with no records ──");

check("ES-G1 · malformed JSON loads to CANNOT_VERIFY, not to an empty log", () => {
  const path = freshPath("malformed");
  writeFileSync(path, "{not json at all\n", "utf8");
  const store = new EvidenceLogStore({ path });
  assert.strictEqual(store.getLoadState(), "CANNOT_VERIFY");
  assert.ok((store.getLastError() ?? "").includes("malformed JSON at line 0"));
  assert.notStrictEqual(store.getLoadState(), "FIRST_BOOT_OR_ERASED");
});

check("ES-G2 · a record that does not link loads to CANNOT_VERIFY and names the index", () => {
  const path = freshPath("nonlinking");
  const honest = new EvidenceLogStore({ path });
  honest.appendAttempt({ scenarioId: "s1", mode: "G4_BLITZ" }, 1);
  honest.appendAttempt({ scenarioId: "s2", mode: "G4_BLITZ" }, 2);

  // Forge line 1: same shape, re-hashed so only the LINK is wrong.
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const forged = { ...JSON.parse(lines[1]), previousHash: "" } as AttemptRecord;
  const rehashed = { ...forged, hash: computeEvidenceRecordHash(forged) };
  writeFileSync(path, `${lines[0]}\n${JSON.stringify(rehashed)}\n`, "utf8");

  const store = new EvidenceLogStore({ path });
  assert.strictEqual(store.getLoadState(), "CANNOT_VERIFY");
  assert.ok((store.getLastError() ?? "").includes("verification failed at index 1"));
  // THE SEAT'S CHOICE, RECEIPTED: the store hands back what it READ — the
  // prefix and the record that broke — rather than an empty array that would
  // be indistinguishable from a log nobody ever wrote to. The load state and
  // `verify()` carry the truth, and `gradeFromLog` grades only the safe prefix.
  assert.strictEqual(store.length, 2);
  assert.deepStrictEqual(store.verify(), { valid: false, brokenAt: 1 });
  assert.strictEqual(gradeFromLog(store.records()).chainBroken?.brokenAt, 1);
  assert.strictEqual(gradeFromLog(store.records()).verdicts.length, 1);
});

check("ES-G3 · a non-persisting store appends NOTHING and reports the load error", () => {
  const path = freshPath("nonpersisting");
  writeFileSync(path, "{not json at all\n", "utf8");
  const bytesBefore = readFileSync(path, "utf8");
  const store = new EvidenceLogStore({ path });
  const out = store.appendAttempt({ scenarioId: "s1", mode: "G4_BLITZ" }, 1);
  assert.strictEqual(out.persisted, false);
  assert.strictEqual(out.committed, false);
  assert.ok((out.detail ?? "").includes("malformed JSON"), out.detail ?? "");
  assert.strictEqual(readFileSync(path, "utf8"), bytesBefore);
  assert.strictEqual(existsSync(`${path}.lock`), false, "a non-persisting store took the lock");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── ES-H · in memory · integrity without provenance, and it says so ──");

check("ES-H · no path means IN_MEMORY, commits without persisting, and takes no lock", () => {
  const store = new EvidenceLogStore();
  assert.strictEqual(store.getLoadState(), "IN_MEMORY");
  assert.strictEqual(store.hasDeclaredPath, false);
  const out = store.appendAttempt({ scenarioId: "s1", mode: "G4_BLITZ" }, 1);
  assert.strictEqual(out.persisted, false);
  assert.strictEqual(out.committed, true, "an in-memory store must still commit for integrity");
  assert.ok((out.detail ?? "").includes("IN MEMORY"), out.detail ?? "");
  assert.strictEqual(store.length, 1);
  assert.deepStrictEqual(store.verify(), { valid: true, brokenAt: null });
});

check("ES-H2 · an explicit null path is the SAME statement as no path at all", () => {
  const store = new EvidenceLogStore({
    path: null,
    acquire: () => {
      throw new Error("an in-memory store took a lock");
    },
  });
  assert.strictEqual(store.getLoadState(), "IN_MEMORY");
  const out = store.appendAttempt({ scenarioId: "s1", mode: "G4_BLITZ" }, 1);
  assert.strictEqual(out.committed, true);
  assert.strictEqual(out.persisted, false);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── ES-J/K · the look has three answers · the act is checked, never performed ──");

check("ES-J · a store whose directory was never made THROWS and creates nothing", () => {
  const root = mkdtempSync(join(tmpdir(), "mica-evidence-noact-"));
  const absent = join(root, "never-deployed");
  const path = join(absent, "evidence.jsonl");

  let thrown: unknown = null;
  try {
    new EvidenceLogStore({ path });
  } catch (error) {
    thrown = error;
  }
  assert.ok(
    thrown instanceof EvidenceStoreDeploymentActMissing,
    `expected EvidenceStoreDeploymentActMissing, got ${String(thrown)}`
  );
  assert.strictEqual((thrown as EvidenceStoreDeploymentActMissing).path, absent);
  assert.ok((thrown as Error).message.includes(THE_EVIDENCE_STORE_LOCATION_IS_UNDESIGNATED));
  assert.ok(!/recipe §\d/.test((thrown as Error).message), "the signpost invented a section");
  assert.strictEqual(existsSync(absent), false, "the store created its own directory");
  assert.strictEqual(existsSync(path), false, "a store file appeared anyway");
});

check("ES-K · a log this process CANNOT SEE loads to CANNOT_VERIFY, never to first boot", () => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    // Root defeats the permission bit, so this check would pass vacuously.
    // Reported as what it is rather than counted as a pass.
    throw new Error("SKIPPED-AS-FAILURE: running as root, the mode bit proves nothing");
  }
  const root = mkdtempSync(join(tmpdir(), "mica-evidence-cannotsee-"));
  const dir = join(root, "logdir");
  const path = join(dir, "evidence.jsonl");
  mkdirSync(dir);
  writeFileSync(path, "", "utf8");
  chmodSync(dir, 0o600); // readable, NOT traversable: statSync(path) -> EACCES
  try {
    assert.strictEqual(statSync(dir).isDirectory(), true);
    const store = new EvidenceLogStore({ path });
    assert.strictEqual(store.getLoadState(), "CANNOT_VERIFY");
    assert.ok((store.getLastError() ?? "").includes("could not be looked at"));
    assert.ok((store.getLastError() ?? "").includes("NOT the finding"));
  } finally {
    chmodSync(dir, 0o700);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── ES-P · FENCE — what this module is allowed to reach ──");

check("ES-P · evidence-store.ts imports the seam and the log, and NOTHING from precommit", () => {
  const source = readFileSync(join(__dirname, "evidence-store.ts"), "utf8");
  const code = codeOnly(source);
  assert.ok(code.includes('from "../mica/store/append-store"'), "it does not adopt the seam");
  assert.ok(code.includes('from "./evidence-log"'), "it does not use the pure log");
  assert.ok(!code.includes("../precommit"), "it imports from the sibling book");
  assert.ok(!code.includes("precommit"), "it reaches into precommit in code");
});

check("ES-P2 · no mkdir, no default path, no clock", () => {
  const code = codeOnly(readFileSync(join(__dirname, "evidence-store.ts"), "utf8"));
  assert.ok(!code.includes("mkdir"), "the module creates a directory");
  assert.ok(!code.includes("Date.now"), "the module calls a clock");
  for (const prefix of DEPLOYMENT_PATH_PREFIXES) {
    assert.ok(!code.includes(prefix), `the module names a deployment path (${prefix})`);
  }
  // `resync: null` is the road not taken: this store adopted the inter-process
  // contract, so the declared-single-writer shape must not appear in its code.
  assert.ok(!/resync:\s*null/.test(code), "the store declared itself single-writer");
  assert.ok(/resync:\s*\(\)/.test(code), "the store does not pass a resync function");
});


/** The observable block a v4 OUTCOME carried: no `onWarrant` anywhere. */
const V4_CLEAN = {
  disclosure: { presence: "PRESENT", disclosed: false },
  scopeRetention: { presence: "PRESENT", retainedScope: false },
  omissionCost: { presence: "PRESENT", cost: "none", nontrivialCost: false },
  controlFork: { presence: "PRESENT", forkId: "f" },
  departure: { presence: "PRESENT", occurred: true },
} as const;

/** A genuine v4 chain on disk: on-schema under v5, hashed under v4. */
function writeV4Chain(path: string): void {
  const prov = { subjectId: "mica-subject1", basis: "PROCESS_GROUNDED", variant: "STRESS", seed: 1, deliverySeat: "THIRD_PERSON" } as const;
  const lines: string[] = [];
  let previousHash = "";
  const push = (r: Record<string, unknown>): void => {
    const hash = computeEvidenceRecordHashUnderV4({ ...r, previousHash } as never);
    lines.push(JSON.stringify({ ...r, previousHash, hash }));
    previousHash = hash;
  };
  push({ kind: "ATTEMPT", sequenceNumber: 0, timestamp: 100, scenarioId: "s1", mode: "G4_BLITZ", provenance: prov });
  push({ kind: "OUTCOME", sequenceNumber: 1, timestamp: 101, ref: 0, outcome: "CAPTURED", observables: V4_CLEAN });
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
}

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── ES-V4 (S132) · a v4 chain loads as OLD, and NOTHING of it stays reachable ──");

check("ES-V4 · a v4 chain is CANNOT_VERIFY, tagged v4, and its records are DISCARDED", () => {
  const path = join(mkdtempSync(join(tmpdir(), "s132-es-v4-")), "evidence.jsonl");
  writeV4Chain(path);
  const store = new EvidenceLogStore({ path });

  assert.strictEqual(store.getLoadState(), "CANNOT_VERIFY");
  assert.strictEqual(store.getSupersededChainTag(), SUPERSEDED_EVIDENCE_DOMAIN_TAG_V4);

  // THE ASSERTION THIS BEAT IS FOR. Before S132 this said `verification failed
  // at index 0` — an intact file reported as tampered.
  const why = store.getLastError() ?? "";
  assert.ok(why.includes("SUPERSEDED preimage"), why);
  assert.ok(why.includes("PROOF"), "the message does not say how the tag was established");
  assert.ok(why.includes("older than this reader"), why);
  assert.ok(!why.includes("verification failed at index"), "still reported as a break");

  // RECOGNITION IS NOT A DOOR. The records are on-schema and would otherwise sit
  // in `records()` where a caller could reach them behind the store's refusal.
  assert.strictEqual(store.length, 0, "a v4 record stayed reachable after recognition");
  assert.deepStrictEqual([...store.records()], []);
  assert.throws(() => gradeFromStore(store), EvidenceStoreNotGradable);

  // And the file was not touched on the way past.
  assert.ok(existsSync(path));
});

check("ES-V4b · a TAMPERED chain is still a BREAK — recognition did not launder one", () => {
  const path = join(mkdtempSync(join(tmpdir(), "s132-es-v4b-")), "evidence.jsonl");
  writeV4Chain(path);
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const last = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
  lines[lines.length - 1] = JSON.stringify({ ...last, timestamp: 999 });
  writeFileSync(path, lines.join("\n") + "\n", "utf8");

  const store = new EvidenceLogStore({ path });
  assert.strictEqual(store.getLoadState(), "CANNOT_VERIFY");
  assert.strictEqual(store.getSupersededChainTag(), null, "a tampered chain was called history");
  assert.ok((store.getLastError() ?? "").includes("verification failed at index"));
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
