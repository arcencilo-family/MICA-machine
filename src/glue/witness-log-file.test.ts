// ── GLUE · the witness-store log adapter — tests ─────────────────────────────
//
// The fixtures are REAL STORES built by the REAL `Witness` class in a tmpdir, so
// the frame shape under test is the one the witness actually writes rather than
// one copied out of a paste. Nothing here touches the live store.

import * as assert from "assert";
import { spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  LOADED_WITNESS_CHAIN_VERIFIED,
  WITNESS_LOG_ATTESTS,
  WITNESS_LOG_MAPPING,
  WITNESS_MODULE_ID,
  WITNESS_NO_OUTCOME,
  WitnessStoreLog,
} from "./witness-log-file";
import { MicaLogFile } from "./mica-log-file";
import { Witness } from "../witness/witness";
import { assessSig } from "../mica/sig";

let passed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const root = mkdtempSync(join(tmpdir(), "mica-witness-log-"));

/** A real store, written by the real witness. Returns its path. */
function realStore(name: string, submissions = 2): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const storePath = join(dir, "store.jsonl");
  const outboxDir = join(dir, "outbox");
  mkdirSync(outboxDir, { recursive: true });
  const w = new Witness({
    witnessSetId: `set-${name}`,
    storePath,
    outboxDir,
    declaredSubmitters: ["mica"],
    witnessClock: (() => {
      let t = 1_700_000_000_000;
      return () => (t += 1_000);
    })(),
  });
  for (let i = 0; i < submissions; i++) {
    w.submitRaw(
      Buffer.from(
        JSON.stringify({
          seq_no: i,
          head_hash: `head-${i}`,
          ts: 1_700_000_000_000 + i,
          witness_set_id: `set-${name}`,
          modality: "OFFERED",
        }),
        "utf8"
      ),
      "mica"
    );
  }
  return storePath;
}

// ── The mapping ─────────────────────────────────────────────────────────────

console.log("\n── frames become MICA records, and every row is a claim ──");

const goodPath = realStore("good");
const good = new WitnessStoreLog({ path: goodPath });

check("a real witness store LOADS, and the chain VERIFIES", () => {
  assert.strictEqual(good.getLoadState(), LOADED_WITNESS_CHAIN_VERIFIED);
  assert.strictEqual(good.verify().valid, true);
  assert.ok(good.frameCount > 0, "the constructor's PLACEMENT alone is a record");
});

check("seq -> sequenceNumber and arrivalTs -> timestamp, verbatim", () => {
  const frames = readFileSync(goodPath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { seq: number; arrivalTs: number; kind: string });
  const recs = good.getAll();
  assert.strictEqual(recs.length, frames.length);
  for (let i = 0; i < recs.length; i++) {
    assert.strictEqual(recs[i].sequenceNumber, frames[i].seq);
    assert.strictEqual(recs[i].timestamp, frames[i].arrivalTs);
    assert.strictEqual(recs[i].eventType, frames[i].kind, "kind -> eventType, verbatim");
  }
});

check("moduleId is the WITNESS, not the submitter — the witness wrote every line", () => {
  for (const r of good.getAll()) assert.strictEqual(r.moduleId, WITNESS_MODULE_ID);
  // submitterId names the party the record is ABOUT. Mapping it to moduleId
  // would claim the submitter emitted the log record, which is false.
  const raw = readFileSync(goodPath, "utf8");
  assert.ok(raw.includes('"submitterId":"mica"'), "the fixture really has submissions");
  for (const r of good.getAll()) assert.notStrictEqual(r.moduleId, "mica");
});

check("outcome is a LITERAL saying there is no outcome — never a fabricated OK", () => {
  for (const r of good.getAll()) assert.strictEqual(r.outcome, WITNESS_NO_OUTCOME);
  assert.ok(!/\bOK\b/.test(WITNESS_NO_OUTCOME));
  assert.ok(WITNESS_NO_OUTCOME.includes("NO_OUTCOME"));
});

check("no MICA record carries an actionId — submitterId is NOT one", () => {
  for (const r of good.getAll()) assert.strictEqual(r.actionId, undefined);
});

check("the mapping table names every dropped field, not just the kept ones", () => {
  const table = WITNESS_LOG_MAPPING.join("\n");
  for (const kept of ["seq", "arrivalTs", "kind", "moduleId", "outcome"]) {
    assert.ok(table.includes(kept), `mapping does not mention ${kept}`);
  }
  for (const dropped of ["submitterId", "witnessed", "previousHash", "hash"]) {
    assert.ok(table.includes(dropped), `mapping hides ${dropped}`);
  }
  assert.ok(table.includes("DROPPED"));
  assert.ok(!/<[^>]*>/.test(table), "no placeholders in a printed table");
});

// ── The chain, honoured rather than disclaimed ──────────────────────────────

console.log("\n── the chain is checked, and the claim is sized to it ──");

check("EQUIVALENCE — this adapter agrees with the real Witness.verify() on a VALID store", () => {
  // The chain WALK is local (the Witness constructor writes, so it cannot be
  // used to read). This binds the duplicate to the original.
  const p = realStore("equiv-valid");
  const w = new Witness({
    witnessSetId: "set-equiv-valid",
    storePath: p,
    outboxDir: join(root, "equiv-valid", "outbox"),
    declaredSubmitters: ["mica"],
  });
  const adapter = new WitnessStoreLog({ path: p });
  assert.strictEqual(w.verify().valid, true);
  assert.strictEqual(adapter.verify().valid, w.verify().valid);
  assert.strictEqual(w.getLoadState(), "LOADED_VERIFIED");
  assert.strictEqual(adapter.getLoadState(), LOADED_WITNESS_CHAIN_VERIFIED);
});

check("EQUIVALENCE — and on a BROKEN store, both say invalid", () => {
  const p = realStore("equiv-broken");
  const lines = readFileSync(p, "utf8").split("\n").filter((l) => l.trim());
  // Tamper with a payload without touching the hash: the recompute must catch it.
  const tampered = lines.map((l, i) =>
    i === 0 ? l.replace(/"arrivalTs":\d+/, '"arrivalTs":1') : l
  );
  writeFileSync(p, tampered.join("\n") + "\n");
  const adapter = new WitnessStoreLog({ path: p });
  assert.strictEqual(adapter.verify().valid, false);
  assert.strictEqual(adapter.getLoadState(), "WITNESS_STORE_BREAK");
  assert.strictEqual(adapter.verify().brokenAt, 0);
  const w = new Witness({
    witnessSetId: "set-equiv-broken",
    storePath: p,
    outboxDir: join(root, "equiv-broken", "outbox"),
    declaredSubmitters: ["mica"],
  });
  assert.strictEqual(w.verify().valid, false, "the real class agrees it is broken");
});

check("a BROKEN LINK is caught even when every record hashes to its own value", () => {
  const p = realStore("relink", 2);
  const lines = readFileSync(p, "utf8").split("\n").filter((l) => l.trim());
  assert.ok(lines.length >= 3, "need a middle record to drop");
  // Drop record 1. Records 0 and 2 both still hash correctly; the LINK breaks.
  writeFileSync(p, [lines[0], lines[2]].join("\n") + "\n");
  const adapter = new WitnessStoreLog({ path: p });
  assert.strictEqual(adapter.getLoadState(), "WITNESS_STORE_BREAK");
  assert.ok(adapter.getProblem()!.includes("does not link to its predecessor"));
});

check("the attestation sentence sizes the claim, and denies the ones it cannot make", () => {
  assert.ok(WITNESS_LOG_ATTESTS.includes("ATTESTS THE WITNESS CHAIN AND ORDERING"));
  assert.ok(WITNESS_LOG_ATTESTS.includes("Not completeness"));
  assert.ok(WITNESS_LOG_ATTESTS.includes("Not authorship of meaning"));
  // ⚠ The brief said the store is "Ed25519-signed". It is not: the signature
  // rides on the OUTBOX RECEIPT. The sentence says so rather than inheriting it.
  assert.ok(WITNESS_LOG_ATTESTS.includes("Not signatures"));
  assert.ok(WITNESS_LOG_ATTESTS.includes("no public key is read"));
});

check("the generic JSONL disclaimer does NOT print for this adapter", () => {
  assert.ok(!WITNESS_LOG_ATTESTS.includes("carries no hash chain"));
  const generic = readFileSync(join(__dirname, "mica-log-file.ts"), "utf8");
  assert.ok(generic.includes("NO HASH CHAIN"), "the generic reader still says it of itself");
});

// ── Failure paths, each distinct ────────────────────────────────────────────

console.log("\n── absence, blindness and malformation are three findings ──");

check("an ABSENT store is not an unreadable one", () => {
  const a = new WitnessStoreLog({ path: join(root, "nope", "store.jsonl") });
  assert.strictEqual(a.getLoadState(), "WITNESS_STORE_ABSENT");
  assert.strictEqual(a.verify().valid, false);
});

check("a non-JSON line reads WITNESS_UNVERIFIED_JSON and names the line", () => {
  const dir = join(root, "badjson");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "store.jsonl");
  writeFileSync(p, "{not json}\n");
  const a = new WitnessStoreLog({ path: p });
  assert.strictEqual(a.getLoadState(), "WITNESS_UNVERIFIED_JSON");
  assert.ok(a.getProblem()!.includes("line 1"));
});

check("JSON that is not a frame reads WITNESS_UNVERIFIED_SCHEMA, and says what a frame is", () => {
  const dir = join(root, "badschema");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "store.jsonl");
  writeFileSync(p, JSON.stringify({ sequenceNumber: 0 }) + "\n");
  const a = new WitnessStoreLog({ path: p });
  assert.strictEqual(a.getLoadState(), "WITNESS_UNVERIFIED_SCHEMA");
  assert.ok(a.getProblem()!.includes("seq, arrivalTs"));
});

check("an EMPTY store is neither absent nor broken", () => {
  const dir = join(root, "empty");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "store.jsonl");
  writeFileSync(p, "");
  assert.strictEqual(new WitnessStoreLog({ path: p }).getLoadState(), "WITNESS_STORE_EMPTY");
});

check("every failure path yields ZERO records — nothing is half-read", () => {
  for (const s of ["nope/store.jsonl", "badjson/store.jsonl", "badschema/store.jsonl"]) {
    assert.strictEqual(new WitnessStoreLog({ path: join(root, s) }).getAll().length, 0);
  }
});

// ── The regression pin on this morning's failure ────────────────────────────

console.log("\n── the S102 09:11 failure, pinned ──");

check("REGRESSION — the GENERIC reader still fails on a witness store exactly as it did", () => {
  // This is the failure that produced today's brief. It must keep happening:
  // pointing the generic reader at a witness store is an operator error and it
  // has to stay loud.
  const generic = new MicaLogFile({ path: goodPath });
  assert.strictEqual(generic.getLoadState(), "FILE_MALFORMED");
  assert.strictEqual(generic.getAll().length, 0);
  assert.strictEqual(generic.verify().valid, false);
  assert.ok(
    generic.describe().includes("sequenceNumber is not a finite number"),
    `this morning's text changed: ${generic.describe()}`
  );
});

check("...and the WITNESS reader reads the same file cleanly", () => {
  assert.strictEqual(good.getLoadState(), LOADED_WITNESS_CHAIN_VERIFIED);
  assert.ok(good.getAll().length > 0);
});

// ── End to end, into Sig ────────────────────────────────────────────────────

console.log("\n── Sig reads it, and F4 is reached ──");

check("Sig reads the witness store when the operator injects its load state BY NAME", () => {
  const r = assessSig(good, {
    readableLoadStates: [LOADED_WITNESS_CHAIN_VERIFIED],
    clockToleranceMs: 0,
  });
  // The gate is the operator's: without this exact string injected, nothing reads.
  assert.ok(r.flags.length > 0, "the readability gate let the flags run");
  assert.strictEqual(r.flags[3].flag, "F4");
});

check("THE POINT — F4 EXECUTES, where this morning it never ran at all", () => {
  const r = assessSig(good, {
    readableLoadStates: [LOADED_WITNESS_CHAIN_VERIFIED],
    clockToleranceMs: 0,
  });
  // No probeSource here, so F4 is NOT_CONFIGURED — but it RAN and said so,
  // which is the whole difference from a log that could not be read.
  assert.strictEqual(r.flags[3].kind, "NOT_CONFIGURED");
});

check("an UNINJECTED load state still reads nothing — the gate did not move", () => {
  const r = assessSig(good, {
    readableLoadStates: ["LOADED_VERIFIED"],
    clockToleranceMs: 0,
  });
  assert.strictEqual(r.flags.length, 0, "a store whose state was not named is not read");
  assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
});

// ── Read-only ───────────────────────────────────────────────────────────────

console.log("\n── it touches nothing ──");

check("the adapter's source contains no write, create, or append call", () => {
  const code = readFileSync(join(__dirname, "witness-log-file.ts"), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
  for (const forbidden of [
    "writeFileSync", "appendFileSync", "mkdirSync", "openSync", "chmodSync", "rmSync",
  ]) {
    assert.ok(!new RegExp(`\\b${forbidden}\\s*\\(`).test(code), `adapter calls ${forbidden}`);
  }
  assert.ok(!/existsSync\s*\(/.test(code), "statSync, so cannot-see is not reported as absent");
});

check("reading a store twice leaves its bytes identical", () => {
  const before = readFileSync(goodPath, "utf8");
  new WitnessStoreLog({ path: goodPath });
  new WitnessStoreLog({ path: goodPath });
  assert.strictEqual(readFileSync(goodPath, "utf8"), before);
});

// ── The guard's own output, spawned ─────────────────────────────────────────

console.log("\n── the report does not contradict itself ──");

check("the generic 'JSONL carries no hash chain' sentence does NOT print under this reader", () => {
  // It printed unconditionally until S102 — including under the witness reader,
  // where it is FALSE about the file being read and denies, in the run's own
  // output, the tamper evidence the reader had just checked.
  const r = spawnSync(
    "npx",
    [
      "ts-node", join(__dirname, "mica-guard.ts"),
      "--action-id", "witness-attest-pin",
      "--log", goodPath,
      "--log-kind", "witness",
      "--readable-load-state", LOADED_WITNESS_CHAIN_VERIFIED,
    ],
    { encoding: "utf8", cwd: join(__dirname, "..", "..") }
  );
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  assert.ok(out.includes("WITNESS STORE READER"), `guard did not run: ${out.slice(0, 300)}`);
  assert.ok(
    !out.includes("JSONL file carries no hash chain"),
    "the generic disclaimer printed under the witness reader"
  );
  assert.ok(out.includes("ATTESTS THE WITNESS CHAIN"), "the true sentence printed instead");
  assert.ok(out.includes("seq          -> sequenceNumber"), "the mapping table printed");
});

rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} tests: ${passed} passed, 0 failed`);
