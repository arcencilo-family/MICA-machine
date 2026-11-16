// ──────────────────────────────────────────────────────────────────────────────
// ILAS — CLERK 1 acceptance tests.
// House style: standalone ts-node script, custom check() harness. No framework.
//   npx ts-node src/clerk/clerk.test.ts
//
// Organised by the build's done-conditions C1–C9 so the evidence maps to the
// prompt one-for-one. C10 (suite + tsc + diff) and C11 (T1/T2 verdicts) are in
// the build record, not here.
// ──────────────────────────────────────────────────────────────────────────────

import assert from "assert";
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign as cryptoSign,
} from "crypto";
import type { KeyObject } from "crypto";
import { fork } from "child_process";
import { connect } from "net";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { canonicalise, commit } from "./canonical";
import { ClerkCore, NonceUnavailable, SubmissionRejected } from "./core";
import { InProcessClerkClient, SignedSubmitter, SocketClerkClient } from "./client";
import { submitterAuthPreimage } from "./credentials";
import { readGaps, renderGapRead } from "./gap";
import type { GapStop } from "./gap";
import { readStore } from "./read-store";
import { ClerkDeploymentActMissingError } from "./store";
import { loadOrCreateKeys } from "./keys";
import { resolveStoreDir } from "./location";
import { claimFrom, assertInScope, ClerkScopeViolation } from "./scope";
import { publicKeyFromB64, verifySignature } from "./signature";
import { recordPreimage } from "./preimage";
import { STORE_DIR_ENV, STORE_FILES } from "./types";
import type { ClerkRecord, SubmissionReceipt } from "./types";
import { renderVerification, verifyChain } from "./verify";
import { buildReport, renderReport } from "./reader";

let passed = 0;
let failed = 0;
/** Source with comments removed, so a fence can be about CALLS, not words. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    failed++;
  }
}
async function checkAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    failed++;
  }
}

const root = mkdtempSync(join(tmpdir(), "ilas-clerk-"));
let counter = 0;
/** A path. NOT a directory — naming one and making one are different acts. */
const freshDir = (): string => join(root, `store-${counter++}`);

/**
 * THE DEPLOYMENT ACT OF RECIPE §4.1, RENDERED IN A TEST.
 *
 * Since S97 the clerk does not create its own store directory — see `store.ts`,
 * where the `mkdirSync` used to be, and `keys.ts`, the second door onto the same
 * act. A test that wants a clerk to come up must therefore model a deployer who
 * performed §4.1, IN ITS OWN BODY, the way the witness tests model §5.2.
 *
 * It is deliberately NOT folded into `freshDir()`. A fixture that made the
 * directory for every test would vacuously satisfy the negative tests at the end
 * of this file, which assert that NOTHING is created when the act was skipped.
 * That is the S96 outbox lesson said in this file's vocabulary: the lazy repair
 * wears the legitimate one's clothes, and passes.
 */
function deployClerkStore(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/** A clerk whose clocks we own, so the tests are about the code, not the day. */
function fixedClockCore(dir: string, startMs: number): { core: ClerkCore; setWall: (ms: number) => void } {
  let wall = startMs;
  let mono = 0n;
  const core = new ClerkCore({
    storeDir: dir,
    separation: "IN_PROCESS_NO_SEPARATION",
    wallClock: () => wall,
    monotonicClock: () => (mono += 1000n),
  });
  return { core, setWall: (ms: number) => (wall = ms) };
}

/** A clerk with a deployer-supplied roster. The roster is always the test's. */
function rosteredCore(
  dir: string,
  startMs: number,
  roster: Record<string, string> | string | null
): { core: ClerkCore; setWall: (ms: number) => void } {
  let wall = startMs;
  let mono = 0n;
  const core = new ClerkCore({
    storeDir: dir,
    separation: "IN_PROCESS_NO_SEPARATION",
    wallClock: () => wall,
    monotonicClock: () => (mono += 1000n),
    roster,
  });
  return { core, setWall: (ms: number) => (wall = ms) };
}

/** base64 SPKI DER, the form the roster takes. */
function spki(publicKey: KeyObject): string {
  return publicKey.export({ type: "spki", format: "der" }).toString("base64");
}

/** The submitter side of the credential, done by hand so the test owns it. */
function signedSubmit(
  core: ClerkCore,
  submitterId: string,
  channel: string,
  payload: unknown,
  privateKey: KeyObject,
  overrides: { nonce?: string; declared_timestamp?: number } = {}
): SubmissionReceipt {
  const nonce = overrides.nonce ?? core.challenge().nonce;
  const preimage = submitterAuthPreimage({
    clerk_id: core.clerkId,
    nonce,
    submitter_id: submitterId,
    channel,
    payload_commitment: commit(payload).commitment,
  });
  return core.submit({
    submitter_id: submitterId,
    channel,
    payload,
    declared_timestamp: overrides.declared_timestamp ?? null,
    nonce,
    submitter_signature: cryptoSign(null, Buffer.from(preimage, "utf8"), privateKey).toString("base64"),
  });
}

function lines(path: string): string[] {
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
}
function writeLines(path: string, ls: readonly string[]): void {
  writeFileSync(path, ls.join("\n") + "\n", "utf8");
}

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── C1 · the clerk receives submissions and emits a chained, signed record ──");

check("submissions are stamped with the clerk's own counter, chained and signed", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core } = fixedClockCore(dir, 1_000);
  const r1 = core.submit({ submitter_id: "obs", channel: "main", payload: { a: 1 } });
  const r2 = core.submit({ submitter_id: "obs", channel: "main", payload: { a: 2 } });

  // seq 0 is the clerk's own BOOT record; the submitter does not author it.
  assert.strictEqual(r1.clerk_seq, 1);
  assert.strictEqual(r2.clerk_seq, 2);
  assert.strictEqual(r2.prev_receipt_hash, r1.receipt_hash);

  const store = readStore(dir);
  assert.strictEqual(store.kind, "STORE_READ");
  if (store.kind !== "STORE_READ") return;
  assert.strictEqual(store.records.length, 3);
  assert.strictEqual(store.records[0].kind, "BOOT");

  const key = publicKeyFromB64(core.publicKeyB64);
  for (const rec of store.records) {
    assert.ok(
      verifySignature(recordPreimage(rec), rec.signature, key),
      `signature failed at clerk_seq ${rec.clerk_seq}`
    );
  }
});

check("the sequence counter is the clerk's, not the submitter's call count", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core } = fixedClockCore(dir, 1_000);
  core.declareCadence("main", 1000, 0, "deployer");
  const r = core.submit({ submitter_id: "obs", channel: "main", payload: {} });
  // Two clerk-authored records (BOOT, CADENCE) precede the submitter's first
  // submission. Nothing the submitter does can set or predict this number.
  assert.strictEqual(r.clerk_seq, 2);
});

check("verifyChain reports INTACT_SINCE_ARRIVAL under an out-of-band key", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core } = fixedClockCore(dir, 1_000);
  core.submit({ submitter_id: "obs", channel: "main", payload: { hello: "world" } });
  const v = verifyChain(readStore(dir), {
    publicKeyB64: core.publicKeyB64,
    trustAnchor: "OUT_OF_BAND",
  });
  assert.strictEqual(v.kind, "INTACT_SINCE_ARRIVAL", renderVerification(v));
  assert.ok(v.meaning.includes("NOT a statement of health"));
});

check("a chain read with the store's OWN key is CANNOT_VERIFY, not a clean result", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core } = fixedClockCore(dir, 1_000);
  core.submit({ submitter_id: "obs", channel: "main", payload: {} });
  const store = readStore(dir);
  assert.strictEqual(store.kind, "STORE_READ");
  if (store.kind !== "STORE_READ") return;
  const v = verifyChain(store, {
    publicKeyB64: store.storePublicKeyB64,
    trustAnchor: "FROM_STORE",
  });
  assert.strictEqual(v.kind, "CANNOT_VERIFY");
  if (v.kind !== "CANNOT_VERIFY") return;
  assert.ok(v.blind.some((b) => b.class === "TRUST_ANCHOR_FROM_STORE"));
  assert.ok(v.blind.every((b) => b.class !== "TRUST_ANCHOR_FROM_STORE" || b.exit !== null));
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── C2 · canonicalisation is a COPY, not a reference (census §7.4) ──");

check("mutating the submitted object AFTER submission cannot invalidate verify()", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core } = fixedClockCore(dir, 1_000);

  // The census's defect, reproduced deliberately: the submitter keeps its handle.
  const retained: { a: number; nested: { b: number[] } } = { a: 1, nested: { b: [1, 2, 3] } };
  const receipt = core.submit({ submitter_id: "obs", channel: "main", payload: retained });
  const commitmentAtSubmission = receipt.payload_commitment;
  const canonicalAtSubmission = receipt.payload_canonical;

  // ... and then uses it, after the fact, exactly as [P4] describes.
  retained.a = 999;
  retained.nested.b.push(4);
  (retained as unknown as Record<string, unknown>).injected = "after the fact";

  const v = verifyChain(readStore(dir), {
    publicKeyB64: core.publicKeyB64,
    trustAnchor: "OUT_OF_BAND",
  });
  assert.strictEqual(v.kind, "INTACT_SINCE_ARRIVAL", renderVerification(v));

  const store = readStore(dir);
  if (store.kind !== "STORE_READ") throw new Error("store unreadable");
  const stored = store.records.find((r) => r.kind === "SUBMISSION") as SubmissionReceipt;
  assert.strictEqual(stored.payload_commitment, commitmentAtSubmission);
  assert.strictEqual(stored.payload_canonical, canonicalAtSubmission);
  assert.strictEqual(stored.payload_canonical, '{"a":1,"nested":{"b":[1,2,3]}}');
});

check("a hostile getter gets exactly one turn; the commitment is that snapshot", () => {
  let n = 0;
  const hostile = {
    get v(): number {
      return n++;
    },
  };
  const first = canonicalise(hostile);
  assert.strictEqual(first, '{"v":0}');
  // Second canonicalisation of the same live object yields something else —
  // which is precisely why the clerk stores the STRING and never the object.
  assert.strictEqual(canonicalise(hostile), '{"v":1}');
  assert.strictEqual(commit({ v: 0 }).commitment, commit(JSON.parse(first)).commitment);
});

check("key order cannot change the commitment", () => {
  assert.strictEqual(canonicalise({ b: 1, a: 2 }), canonicalise({ a: 2, b: 1 }));
});

check("uncommittable payloads are rejected, not silently coerced", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core } = fixedClockCore(dir, 1_000);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(
    () => core.submit({ submitter_id: "obs", channel: "main", payload: cyclic }),
    SubmissionRejected
  );
  assert.throws(() => canonicalise({ n: NaN }));
  assert.throws(() => canonicalise([undefined]));
  assert.throws(() => canonicalise({ big: 1n }));
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── C3 · clerk_time is the clerk's clock; the declared time is retained ──");

check("both times are present, and they are different parties' readings", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core } = fixedClockCore(dir, 1_700_000_000_000);
  const receipt = core.submit({
    submitter_id: "obs",
    channel: "main",
    declared_timestamp: 1_000_000_000_000, // the submitter backdating itself
    payload: { note: "I happened long ago, honest" },
  });
  assert.strictEqual(receipt.clerk_time.wall_ms, 1_700_000_000_000);
  assert.strictEqual(receipt.declared_timestamp, 1_000_000_000_000);
  assert.notStrictEqual(receipt.clerk_time.wall_ms, receipt.declared_timestamp);
  assert.ok(typeof receipt.clerk_time.monotonic_ns === "string");
  assert.ok(receipt.clerk_boot_id.length > 0);
});

check("a submission with no declared timestamp still carries the clerk's", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core } = fixedClockCore(dir, 42);
  const r = core.submit({ submitter_id: "obs", channel: "main", payload: {} });
  assert.strictEqual(r.declared_timestamp, null);
  assert.strictEqual(r.clerk_time.wall_ms, 42);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── C4 · the separation mode is a FIELD IN THE RECEIPT ──");

check("in-process receipts carry the no-separation warning in the record itself", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const client = new InProcessClerkClient({ storeDir: dir });
  const r = client.core.submit({ submitter_id: "obs", channel: "main", payload: {} });
  assert.strictEqual(r.separation, "IN_PROCESS_NO_SEPARATION");
  assert.ok(r.separation_warning !== null);
  assert.ok(r.separation_warning.includes("NO ADVERSARIAL SEPARATION"));
  assert.ok(r.separation_warning.includes("NO authority against the observed"));
});

check("the warning is inside the signed preimage — stripping it breaks the chain", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const client = new InProcessClerkClient({ storeDir: dir });
  client.core.submit({ submitter_id: "obs", channel: "main", payload: {} });

  const p = join(dir, STORE_FILES.receipts);
  const ls = lines(p).map((l) => {
    const o = JSON.parse(l) as Record<string, unknown>;
    if (o.kind === "SUBMISSION") o.separation_warning = null; // launder the mode
    return JSON.stringify(o);
  });
  writeLines(p, ls);

  const v = verifyChain(readStore(dir), {
    publicKeyB64: client.core.publicKeyB64,
    trustAnchor: "OUT_OF_BAND",
  });
  assert.strictEqual(v.kind, "BREAK_FOUND");
  if (v.kind !== "BREAK_FOUND") return;
  assert.ok(v.breaks.some((b) => b.class === "RECEIPT_HASH_MISMATCH"));
  assert.ok(v.breaks.some((b) => b.class === "SIGNATURE_INVALID"));
});

check("`intake` is an OBSERVED fact and is stamped separately from `separation`", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const client = new InProcessClerkClient({ storeDir: dir });
  const r = client.core.submit({ submitter_id: "obs", channel: "main", payload: {} });
  assert.strictEqual(r.intake, "LOCAL_CALL");
  const store = readStore(dir);
  if (store.kind !== "STORE_READ") throw new Error("store unreadable");
  assert.strictEqual(store.records[0].intake, "CLERK_INTERNAL"); // BOOT
  assert.strictEqual((store.records[0] as { clerk_pid?: number }).clerk_pid, process.pid);
});

check("a SEPARATE_PROCESS clerk fed by direct calls is flagged by the reader", () => {
  // The hole this closes: startClerkDaemon() can be called from inside the
  // observed system's own process, which would stamp SEPARATE_PROCESS on
  // records that are not separated at all. `separation` is a declaration;
  // `intake` is an observation, and the reader cross-checks them.
  const dir = freshDir();
  deployClerkStore(dir);
  const core = new ClerkCore({
    storeDir: dir,
    separation: "SEPARATE_PROCESS", // the lie
    wallClock: () => 1_000,
  });
  core.submit({ submitter_id: "obs", channel: "main", payload: {} }); // LOCAL_CALL
  const report = buildReport({ store: dir, pubkey: core.publicKeyB64, now: 2_000, json: false });
  assert.deepStrictEqual(report.unsupportedSeparationSeqs, [1]);
  const text = renderReport(report);
  assert.ok(text.includes("separation claim is NOT SUPPORTED"));
});

check("the reader prints the no-separation warning for an in-process store", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const client = new InProcessClerkClient({ storeDir: dir });
  client.core.submit({ submitter_id: "obs", channel: "main", payload: {} });
  const text = renderReport(
    buildReport({ store: dir, pubkey: client.core.publicKeyB64, now: 2_000, json: false })
  );
  assert.ok(text.includes("NO ADVERSARIAL SEPARATION"));
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── C5 · the standalone reader imports nothing from the observed system ──");

/**
 * Module specifiers imported by a file.
 *
 * Line-structure aware on purpose. A bare /from\s*"…"/ over the whole source
 * also matches the word "from" inside PROSE — which it did, on the sentence
 * "Where that key comes from " in gap.ts, and reported a phantom foreign
 * import. A scanner that cries wolf gets its assertion relaxed, and then it
 * stops catching the real thing. So: only lines that actually open an import /
 * export statement, close a multi-line one, or call require().
 */
function importSpecifiers(src: string): string[] {
  const out: string[] = [];
  for (const line of src.split("\n")) {
    const structural = /^\s*(?:import\b|export\b|\}\s*from\b)/.test(line);
    const requiring = line.includes("require(");
    if (!structural && !requiring) continue;
    const re = /(?:from\s*|require\()\s*["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) out.push(m[1]);
  }
  return out;
}

/** Walks the reader's static import closure over src/clerk/*.ts. */
function importClosure(entry: string): { files: string[]; foreign: string[] } {
  const seen = new Set<string>();
  const foreign: string[] = [];
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const spec of importSpecifiers(src)) {
      if (spec.startsWith("./")) {
        stack.push(join(__dirname, spec.slice(2) + ".ts"));
      } else if (spec.startsWith("../")) {
        foreign.push(`${file} → ${spec}`);
      } else if (
        ![
          "assert",
          "crypto",
          "fs",
          "os",
          "path",
          "net",
          "child_process",
        ].includes(spec)
      ) {
        foreign.push(`${file} → ${spec} (not a node built-in)`);
      }
    }
  }
  return { files: [...seen], foreign };
}

/**
 * The scanner is only worth having if it catches a real violation, so prove it
 * does before trusting it to say there are none.
 */
check("the import scanner catches a real foreign import and ignores prose", () => {
  assert.deepStrictEqual(
    importSpecifiers('import { LockedEvidenceLog } from "../l0";'),
    ["../l0"]
  );
  assert.deepStrictEqual(importSpecifiers('import express from "express";'), [
    "express",
  ]);
  assert.deepStrictEqual(
    importSpecifiers('const x = require("../mica/types");'),
    ["../mica/types"]
  );
  assert.deepStrictEqual(
    importSpecifiers('  detail: "Where that key comes from " + b,'),
    []
  );
});

check("reader.ts's import closure contains no `../` and no third-party package", () => {
  const { files, foreign } = importClosure(join(__dirname, "reader.ts"));
  assert.deepStrictEqual(foreign, [], `foreign imports: ${foreign.join(", ")}`);
  assert.ok(files.length >= 6, `closure suspiciously small: ${files.join(", ")}`);
  for (const f of files) assert.ok(existsSync(f), `missing closure file ${f}`);
});

check("no file under src/clerk imports the observed system", () => {
  const offenders: string[] = [];
  const dir = __dirname;
  const names = [
    "types.ts", "canonical.ts", "signature.ts", "keys.ts", "preimage.ts",
    "read-store.ts", "store.ts", "location.ts", "core.ts", "verify.ts",
    "gap.ts", "scope.ts", "protocol.ts", "client.ts", "clerkd.ts",
    "reader.ts", "credentials.ts", "index.ts",
  ];
  for (const n of names) {
    const src = readFileSync(join(dir, n), "utf8");
    for (const spec of importSpecifiers(src)) {
      if (spec.startsWith("../")) offenders.push(`${n} → ${spec}`);
    }
  }
  assert.deepStrictEqual(offenders, [], `imports from outside src/clerk: ${offenders.join(", ")}`);
});

check("the reader states its reader-competence presumption in its own output", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core } = fixedClockCore(dir, 1_000);
  core.submit({ submitter_id: "obs", channel: "main", payload: {} });
  const text = renderReport(
    buildReport({ store: dir, pubkey: core.publicKeyB64, now: 2_000, json: false })
  );
  assert.ok(text.includes("READER-COMPETENCE PRESUMED"));
  assert.ok(text.includes("stated, never tested"));
  assert.ok(text.includes("obtain the clerk's public key by a"));
  // and it states the scope and the bounds, not only the presumption
  assert.ok(text.includes("WHAT IT DOES NOT ATTEST"));
  assert.ok(text.includes("BOUNDS OF THIS READING"));
  assert.ok(text.includes("cannot survive its own machine"));
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── C6 · the store location is configured and documented ──");

check("resolution order: explicit > env > default, and it is absolute", () => {
  const before = process.env[STORE_DIR_ENV];
  try {
    delete process.env[STORE_DIR_ENV];
    const dflt = resolveStoreDir();
    assert.ok(dflt.endsWith(".ilas-clerk"));
    process.env[STORE_DIR_ENV] = join(root, "from-env");
    assert.strictEqual(resolveStoreDir(), join(root, "from-env"));
    assert.strictEqual(resolveStoreDir(join(root, "explicit")), join(root, "explicit"));
  } finally {
    if (before === undefined) delete process.env[STORE_DIR_ENV];
    else process.env[STORE_DIR_ENV] = before;
  }
});

check("the documented file names are the ones actually written", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core } = fixedClockCore(dir, 1_000);
  core.submit({ submitter_id: "obs", channel: "main", payload: {} });
  assert.ok(existsSync(join(dir, STORE_FILES.receipts)));
  assert.ok(existsSync(join(dir, STORE_FILES.head)));
  assert.ok(existsSync(join(dir, STORE_FILES.publicKey)));
  assert.ok(existsSync(join(dir, STORE_FILES.privateKey)));
  assert.ok(existsSync(join(__dirname, "README.md")), "src/clerk/README.md documents the location");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── C7 · the gap detector types its stops by object and by shape ──");

const allStops: GapStop[] = [];

check("SUBMITTER_SILENT: clerk up throughout, nothing arrived", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core, setWall } = fixedClockCore(dir, 1_000);
  core.declareCadence("heartbeat", 1_000, 100, "deployer");
  setWall(1_500);
  core.submit({ submitter_id: "obs", channel: "heartbeat", payload: { n: 1 } });

  const store = readStore(dir);
  const v = verifyChain(store, { publicKeyB64: core.publicKeyB64, trustAnchor: "OUT_OF_BAND" });
  const g = readGaps(store.kind === "STORE_READ" ? store.records : [], {
    now: 20_000,
    verification: v,
  });
  assert.strictEqual(g.kind, "GAP_OBSERVED", renderGapRead(g));
  if (g.kind !== "GAP_OBSERVED") return;
  assert.strictEqual(g.stops.length, 1);
  const s = g.stops[0];
  allStops.push(s);
  assert.strictEqual(s.object, "SUBMITTER_SILENT");
  assert.strictEqual(s.shape, "RECORD_ONLY_NO_HOLD");
  assert.strictEqual(s.silence_bounded, false);
  assert.strictEqual(s.last_submission?.declared_submitter_id, "obs");
  assert.ok(s.question.includes("WHICH CHANNEL"));
  assert.ok(s.question.includes("HOW LONG"));
  assert.ok(s.question.includes("STATE OF THE CHANNEL ITSELF"));
  assert.ok(s.question.includes("LOWER BOUND"));
});

check("CLERK_COVERAGE_GAP: the clerk restarted inside the window — about the CLERK", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const a = fixedClockCore(dir, 1_000);
  a.core.declareCadence("heartbeat", 1_000, 0, "deployer");
  a.setWall(1_200);
  a.core.submit({ submitter_id: "obs", channel: "heartbeat", payload: { n: 1 } });

  // The clerk goes away and comes back later: BOOT lands inside the silence.
  const b = fixedClockCore(dir, 10_000);
  assert.strictEqual(b.core.storeLoadState, "LOADED");

  const store = readStore(dir);
  const v = verifyChain(store, { publicKeyB64: b.core.publicKeyB64, trustAnchor: "OUT_OF_BAND" });
  const g = readGaps(store.kind === "STORE_READ" ? store.records : [], {
    now: 20_000,
    verification: v,
  });
  assert.strictEqual(g.kind, "GAP_OBSERVED", renderGapRead(g));
  if (g.kind !== "GAP_OBSERVED") return;
  const s = g.stops[0];
  allStops.push(s);
  assert.strictEqual(s.object, "CLERK_COVERAGE_GAP");
  assert.strictEqual(s.clerk_coverage.state, "CLERK_RESTARTED_IN_WINDOW");
  assert.ok(s.clerk_coverage.boot_seqs.length > 0);
  assert.ok(s.clerk_coverage.detail.includes("about the CLERK"));
});

check("CHANNEL_IMPAIRED: the clerk's own record did not reconcile at boot", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const a = fixedClockCore(dir, 1_000);
  a.core.declareCadence("heartbeat", 1_000, 0, "deployer");
  a.setWall(1_200);
  a.core.submit({ submitter_id: "obs", channel: "heartbeat", payload: { n: 1 } });

  // The signed tail statement goes missing while the clerk is down.
  unlinkSync(join(dir, STORE_FILES.head));

  const b = fixedClockCore(dir, 10_000);
  assert.strictEqual(b.core.storeLoadState, "LOADED_WITH_BREAK");

  const store = readStore(dir);
  const v = verifyChain(store, { publicKeyB64: b.core.publicKeyB64, trustAnchor: "OUT_OF_BAND" });
  assert.strictEqual(v.kind, "INTACT_SINCE_ARRIVAL", renderVerification(v));
  const g = readGaps(store.kind === "STORE_READ" ? store.records : [], {
    now: 20_000,
    verification: v,
  });
  assert.strictEqual(g.kind, "GAP_OBSERVED", renderGapRead(g));
  if (g.kind !== "GAP_OBSERVED") return;
  const s = g.stops[0];
  allStops.push(s);
  assert.strictEqual(s.object, "CHANNEL_IMPAIRED");
  assert.strictEqual(s.clerk_coverage.state, "CLERK_RECORD_DID_NOT_RECONCILE");
  assert.ok(s.clerk_coverage.detail.includes("about the RECORD PATH"));
});

check("no cadence declared ⇒ CANNOT_ASSESS_CADENCE, never quiet", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core } = fixedClockCore(dir, 1_000);
  core.submit({ submitter_id: "obs", channel: "main", payload: {} });
  const store = readStore(dir);
  const v = verifyChain(store, { publicKeyB64: core.publicKeyB64, trustAnchor: "OUT_OF_BAND" });
  const g = readGaps(store.kind === "STORE_READ" ? store.records : [], {
    now: 999_999,
    verification: v,
  });
  assert.strictEqual(g.kind, "CANNOT_ASSESS_CADENCE");
  if (g.kind !== "CANNOT_ASSESS_CADENCE") return;
  assert.ok(g.blind.some((b) => b.class === "NO_CADENCE_DECLARED"));
  assert.ok(g.blind.every((b) => b.detail.length > 0));
  assert.ok(g.summary.includes("NOT silence"));
});

check("a broken record ⇒ CANNOT_ASSESS_CADENCE, not a gap finding", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core, setWall } = fixedClockCore(dir, 1_000);
  core.declareCadence("heartbeat", 1_000, 0, "deployer");
  setWall(1_200);
  core.submit({ submitter_id: "obs", channel: "heartbeat", payload: {} });

  const p = join(dir, STORE_FILES.receipts);
  const ls = lines(p);
  writeLines(p, [ls[0], ls[2]]); // remove the middle record

  const store = readStore(dir);
  const v = verifyChain(store, { publicKeyB64: core.publicKeyB64, trustAnchor: "OUT_OF_BAND" });
  const g = readGaps(store.kind === "STORE_READ" ? store.records : [], {
    now: 20_000,
    verification: v,
  });
  assert.strictEqual(g.kind, "CANNOT_ASSESS_CADENCE");
  if (g.kind !== "CANNOT_ASSESS_CADENCE") return;
  assert.ok(g.blind.some((b) => b.class === "STORE_BREAK"));
});

check("quiet on an AUTHENTICATED cadence is an ABSENCE OF FINDING, never health", () => {
  // NOTE: quiet is only reachable at all once submissions are authenticated —
  // see the SUBMITTER_UNAUTHENTICATED tests below. That is the credential
  // round's whole point, and this test had to gain a roster to keep passing.
  const dir = freshDir();
  deployClerkStore(dir);
  const submitter = generateKeyPairSync("ed25519");
  const { core, setWall } = rosteredCore(dir, 1_000, {
    "probe-runner": spki(submitter.publicKey),
  });
  core.declareCadence("heartbeat", 10_000, 0, "deployer");
  setWall(1_100);
  signedSubmit(core, "probe-runner", "heartbeat", {}, submitter.privateKey);

  const store = readStore(dir);
  const v = verifyChain(store, { publicKeyB64: core.publicKeyB64, trustAnchor: "OUT_OF_BAND" });
  const g = readGaps(store.kind === "STORE_READ" ? store.records : [], {
    now: 2_000,
    verification: v,
  });
  assert.strictEqual(g.kind, "NO_GAP_OBSERVED", renderGapRead(g));
  if (g.kind !== "NO_GAP_OBSERVED") return;
  assert.ok(g.summary.includes("ABSENCE OF FINDING"));
  assert.ok(g.summary.includes("not a statement of health"));
});

check("NO BARE ALARM: every emitted stop carries object, shape, and its question", () => {
  assert.ok(allStops.length >= 3, "expected stops from the three object classes");
  for (const s of allStops) {
    assert.ok(s.object.length > 0);
    assert.ok(s.shape.length > 0);
    assert.ok(s.shape_statement.includes("holds nothing and gates nothing"));
    assert.ok(s.channel.length > 0);
    assert.ok(s.question.includes("WHICH CHANNEL"));
    assert.ok(s.question.includes("WHICH SUBMITTER"));
    assert.ok(s.question.includes("HOW LONG"));
    assert.ok(s.question.includes("STATE OF THE CHANNEL ITSELF"));
    assert.ok(s.question.includes("QUESTION HANDED UP"));
    assert.ok(s.clerk_coverage.detail.length > 0);
  }
  // the three object classes are distinct findings and did not collapse
  assert.deepStrictEqual(
    [...new Set(allStops.map((s) => s.object))].sort(),
    ["CHANNEL_IMPAIRED", "CLERK_COVERAGE_GAP", "SUBMITTER_SILENT"]
  );
});

check("a GAP marker in the raw store is not a bare alarm either", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core, setWall } = fixedClockCore(dir, 1_000);
  core.declareCadence("heartbeat", 1_000, 0, "deployer");
  setWall(5_000);
  const [marker] = core.scanCadences();
  // The clerk is infrastructure: it records the breach and hands the
  // classification onward rather than implying one.
  assert.strictEqual(marker.is_finding, false);
  assert.ok(marker.marker_note.includes("MARKER, NOT A FINDING"));
  assert.ok(marker.marker_note.includes("NOT typed by object"));
  assert.ok(marker.marker_note.includes("holds nothing and gates nothing"));
  assert.ok(marker.marker_note.includes("clerk1.gap"));
  const raw = JSON.parse(lines(join(dir, STORE_FILES.receipts))[2]) as Record<string, unknown>;
  assert.strictEqual(raw.is_finding, false);
});

check("the clerk also stamps a gap MARKER, and only one per silence episode", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core, setWall } = fixedClockCore(dir, 1_000);
  core.declareCadence("heartbeat", 1_000, 0, "deployer");
  setWall(5_000);
  assert.strictEqual(core.scanCadences().length, 1);
  setWall(6_000);
  assert.strictEqual(core.scanCadences().length, 0, "second tick must not re-alarm");
  setWall(7_000);
  core.submit({ submitter_id: "obs", channel: "heartbeat", payload: {} });
  setWall(20_000);
  assert.strictEqual(core.scanCadences().length, 1, "a new episode re-arms");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── C8 · deletion and truncation break something a verifier reports ──");

function seededStore(): { dir: string; pub: string } {
  // §4.1 first: this helper's whole product is a store that EXISTS with five
  // records in it, so the deployment act is part of the scenario it builds.
  const dir = freshDir();
  deployClerkStore(dir);
  const { core, setWall } = fixedClockCore(dir, 1_000);
  for (let i = 0; i < 5; i++) {
    setWall(1_000 + i * 10);
    core.submit({ submitter_id: "obs", channel: "main", payload: { i } });
  }
  return { dir, pub: core.publicKeyB64 };
}

check("removing a record from the MIDDLE breaks the chain, twice over", () => {
  const { dir, pub } = seededStore();
  const p = join(dir, STORE_FILES.receipts);
  const ls = lines(p);
  ls.splice(3, 1);
  writeLines(p, ls);

  const v = verifyChain(readStore(dir), { publicKeyB64: pub, trustAnchor: "OUT_OF_BAND" });
  assert.strictEqual(v.kind, "BREAK_FOUND");
  if (v.kind !== "BREAK_FOUND") return;
  assert.ok(v.breaks.some((b) => b.class === "SEQ_DISCONTINUITY"));
  assert.ok(v.breaks.some((b) => b.class === "PREV_HASH_MISMATCH"));
});

check("truncating the TAIL contradicts the signed head anchor", () => {
  const { dir, pub } = seededStore();
  const p = join(dir, STORE_FILES.receipts);
  const ls = lines(p);
  writeLines(p, ls.slice(0, ls.length - 2));

  const v = verifyChain(readStore(dir), { publicKeyB64: pub, trustAnchor: "OUT_OF_BAND" });
  assert.strictEqual(v.kind, "BREAK_FOUND");
  if (v.kind !== "BREAK_FOUND") return;
  const t = v.breaks.find((b) => b.class === "TAIL_TRUNCATED");
  assert.ok(t !== undefined, renderVerification(v));
  assert.ok(t.detail.includes("removed from the end"));
});

check("editing a record in place is caught by hash AND by signature", () => {
  const { dir, pub } = seededStore();
  const p = join(dir, STORE_FILES.receipts);
  const ls = lines(p).map((l) => {
    const o = JSON.parse(l) as Record<string, unknown>;
    if (o.kind === "SUBMISSION" && o.clerk_seq === 2) {
      o.declared_timestamp = 999;
    }
    return JSON.stringify(o);
  });
  writeLines(p, ls);

  const v = verifyChain(readStore(dir), { publicKeyB64: pub, trustAnchor: "OUT_OF_BAND" });
  assert.strictEqual(v.kind, "BREAK_FOUND");
  if (v.kind !== "BREAK_FOUND") return;
  assert.ok(v.breaks.some((b) => b.class === "RECEIPT_HASH_MISMATCH"));
  assert.ok(v.breaks.some((b) => b.class === "SIGNATURE_INVALID"));
  // NOTE, so the width of the claim is on the record: the break is isolated to
  // the edited record and does NOT cascade. `expectedPrev` follows the STORED
  // receipt_hash, so the following record's link still holds. The edit is
  // caught twice at its own index, not five times down the chain.
  assert.ok(!v.breaks.some((b) => b.class === "PREV_HASH_MISMATCH"));
});

check("editing a record AND re-hashing it is caught by the link and the signature", () => {
  const { dir, pub } = seededStore();
  const p = join(dir, STORE_FILES.receipts);
  const ls = lines(p).map((l) => {
    const o = JSON.parse(l) as Record<string, unknown>;
    if (o.kind === "SUBMISSION" && o.clerk_seq === 2) {
      o.declared_timestamp = 999;
      // the forger repairs the record's own hash, which it can compute...
      const copy: Record<string, unknown> = { ...o };
      delete copy.receipt_hash;
      delete copy.signature;
      o.receipt_hash = createHash("sha256").update(canonicalise(copy), "utf8").digest("hex");
      // ...but cannot re-sign, and cannot fix the NEXT record's prev hash.
    }
    return JSON.stringify(o);
  });
  writeLines(p, ls);

  const v = verifyChain(readStore(dir), { publicKeyB64: pub, trustAnchor: "OUT_OF_BAND" });
  assert.strictEqual(v.kind, "BREAK_FOUND");
  if (v.kind !== "BREAK_FOUND") return;
  assert.ok(v.breaks.some((b) => b.class === "SIGNATURE_INVALID"));
  assert.ok(v.breaks.some((b) => b.class === "PREV_HASH_MISMATCH"));
});

check("garbage appended to the store is reported, not skipped", () => {
  const { dir, pub } = seededStore();
  const p = join(dir, STORE_FILES.receipts);
  writeLines(p, [...lines(p), "{not json"]);
  const v = verifyChain(readStore(dir), { publicKeyB64: pub, trustAnchor: "OUT_OF_BAND" });
  assert.strictEqual(v.kind, "BREAK_FOUND");
  if (v.kind !== "BREAK_FOUND") return;
  assert.ok(v.breaks.some((b) => b.class === "MALFORMED_LINE"));
});

check("BOUND, honestly: truncation WITH the anchor removed reads CANNOT_VERIFY", () => {
  const { dir, pub } = seededStore();
  const p = join(dir, STORE_FILES.receipts);
  const ls = lines(p);
  writeLines(p, ls.slice(0, ls.length - 2));
  unlinkSync(join(dir, STORE_FILES.head));

  const v = verifyChain(readStore(dir), { publicKeyB64: pub, trustAnchor: "OUT_OF_BAND" });
  // This is the honest result: the remaining prefix is internally perfect, and
  // the reader is told it cannot exclude truncation. It is NOT reported clean.
  assert.strictEqual(v.kind, "CANNOT_VERIFY");
  if (v.kind !== "CANNOT_VERIFY") return;
  assert.ok(v.blind.some((b) => b.class === "HEAD_ANCHOR_ABSENT"));
  assert.notStrictEqual(v.kind as string, "INTACT_SINCE_ARRIVAL");
});

check("BOUND, honestly: the whole store deleted reads CANNOT_VERIFY, not clean", () => {
  const { dir, pub } = seededStore();
  rmSync(dir, { recursive: true, force: true });
  const v = verifyChain(readStore(dir), { publicKeyB64: pub, trustAnchor: "OUT_OF_BAND" });
  assert.strictEqual(v.kind, "CANNOT_VERIFY");
  if (v.kind !== "CANNOT_VERIFY") return;
  assert.ok(v.blind.some((b) => b.class === "STORE_BLIND"));
  assert.ok(v.blind[0].detail.includes("cannot survive its own machine"));
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── C9 · the typed residual: in-scope claims only ──");

check("an in-scope claim is constructible and carries its adversary", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core } = fixedClockCore(dir, 1_000);
  const r = core.submit({ submitter_id: "obs", channel: "main", payload: {} });
  const c = claimFrom(r, "ARRIVAL");
  assert.strictEqual(c.subject, "ARRIVAL");
  assert.strictEqual(c.against, "OBSERVED_SYSTEM_ONLY");
  assert.ok(c.statement.includes("clerk"));
});

check("out-of-scope claims throw — loudly, with the reason typed", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core } = fixedClockCore(dir, 1_000);
  const r: ClerkRecord = core.submit({ submitter_id: "obs", channel: "main", payload: {} });
  for (const subject of [
    "PAYLOAD_TRUTH",
    "SYSTEM_HEALTH",
    "OPERATOR_CONDUCT",
    "HISTORY_COMPLETENESS",
    "SUBMITTER_IDENTITY",
  ] as const) {
    assert.throws(
      () => claimFrom(r, subject),
      (err: unknown) =>
        err instanceof ClerkScopeViolation && err.message.includes("OUT OF SCOPE"),
      `claimFrom(record, "${subject}") should have thrown`
    );
  }
  assert.throws(() => assertInScope("SYSTEM_HEALTH"), ClerkScopeViolation);
  assert.throws(() => assertInScope("anything else"), ClerkScopeViolation);
});

check("the attestation scope rides inside every record, for non-TS readers too", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core } = fixedClockCore(dir, 1_000);
  core.submit({ submitter_id: "obs", channel: "main", payload: {} });
  const raw = JSON.parse(lines(join(dir, STORE_FILES.receipts))[1]) as Record<string, unknown>;
  const attests = raw.attests as Record<string, unknown>;
  assert.strictEqual(attests.against, "OBSERVED_SYSTEM_ONLY");
  assert.deepStrictEqual(attests.attests, [
    "ARRIVAL",
    "ORDER",
    "GAP",
    "INTEGRITY_SINCE_ARRIVAL",
    "SUBMITTER_KEY_POSSESSION",
  ]);
  assert.ok((attests.does_not_attest as string[]).includes("PAYLOAD_TRUTH"));
  assert.ok(String(attests.note).includes("lies in real time"));
});

check("THE RESIDUAL ITSELF: a real-time lie gets a flawless receipt", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core } = fixedClockCore(dir, 1_000);
  // A perfectly promptly submitted, perfectly ordered, perfectly false report.
  const r = core.submit({
    submitter_id: "obs",
    channel: "main",
    declared_timestamp: 1_000,
    payload: { status: "all probes green", actually: "no probes were run" },
  });
  const v = verifyChain(readStore(dir), {
    publicKeyB64: core.publicKeyB64,
    trustAnchor: "OUT_OF_BAND",
  });
  assert.strictEqual(v.kind, "INTACT_SINCE_ARRIVAL");
  assert.strictEqual(r.declared_timestamp, r.clerk_time.wall_ms); // an honest clock
  // and there is no way to ask this record whether the payload is true:
  assert.throws(() => claimFrom(r, "PAYLOAD_TRUTH"), ClerkScopeViolation);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── G1–G2 · dormant mechanism, three states, all in the signed preimage ──");

check("G1: the package contains no roster, no default identity, no key generation", () => {
  // The mechanism is in scope; the map is not. Same shape as Sig's F2.
  const names = [
    "credentials.ts", "core.ts", "clerkd.ts", "client.ts", "protocol.ts",
    "types.ts", "gap.ts", "reader.ts",
  ];
  for (const n of names) {
    const src = readFileSync(join(__dirname, n), "utf8");
    assert.ok(
      !/generateKeyPair/.test(src) || n === "keys.ts",
      `${n} generates a key pair; submitter keys are the deployment's, not ours`
    );
  }
  // keys.ts makes exactly one key-generation CALL: the CLERK's own signing key.
  const keysSrc = readFileSync(join(__dirname, "keys.ts"), "utf8");
  assert.strictEqual((keysSrc.match(/generateKeyPairSync\(/g) ?? []).length, 1);
  // and an unconfigured clerk holds no entries at all
  const dir = freshDir();
  deployClerkStore(dir);
  const { core } = fixedClockCore(dir, 1_000);
  assert.strictEqual(core.roster.state, "ABSENT");
  assert.strictEqual(core.roster.entries.size, 0);
});

check("G2 state 1 — no roster: accepted, stamped UNAUTHENTICATED_NO_ROSTER", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core } = fixedClockCore(dir, 1_000);
  const r = core.submit({ submitter_id: "obs", channel: "main", payload: {} });
  assert.strictEqual(r.submitter_auth?.state, "UNAUTHENTICATED_NO_ROSTER");
  assert.strictEqual(r.submitter_auth?.proven_submitter_ids, null);
  assert.ok(r.submitter_auth?.note.includes("Anyone able to reach the submit interface"));
});

check("G2 state 2 — roster configured, bad credential: refused, and it leaves a trace", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const real = generateKeyPairSync("ed25519");
  const { core } = rosteredCore(dir, 1_000, { "probe-runner": spki(real.publicKey) });

  let err: SubmissionRejected | null = null;
  try {
    core.submit({ submitter_id: "probe-runner", channel: "heartbeat", payload: { n: 0 } });
  } catch (e) {
    err = e as SubmissionRejected;
  }
  assert.ok(err !== null, "an unsigned submission must be refused");
  assert.strictEqual(err.reason, "MISSING_OR_UNKNOWN_NONCE");
  // seq 0 is BOOT; the refusal is the very next record.
  assert.strictEqual(err.refusalSeq, 1);

  const store = readStore(dir);
  if (store.kind !== "STORE_READ") throw new Error("store unreadable");
  const refusal = store.records.find((r) => r.kind === "REFUSAL");
  assert.ok(refusal !== undefined, "the refusal must be in the chain");
  if (refusal?.kind !== "REFUSAL") return;
  assert.strictEqual(refusal.declared_submitter_id, "probe-runner");
  assert.strictEqual(refusal.channel, "heartbeat");
  assert.strictEqual(refusal.is_finding, false);
  assert.strictEqual(refusal.payload_retained, false);
  assert.ok(refusal.refusal_note.includes("REFUSAL, NOT A FINDING"));
  assert.ok(refusal.refusal_note.includes("asserts no cause"));
});

check("G2 state 3 — roster configured, good credential: AUTHENTICATED with the proven id", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const real = generateKeyPairSync("ed25519");
  const { core } = rosteredCore(dir, 1_000, { "probe-runner": spki(real.publicKey) });
  const r = signedSubmit(core, "probe-runner", "heartbeat", { n: 1 }, real.privateKey);
  assert.strictEqual(r.submitter_auth?.state, "AUTHENTICATED");
  assert.deepStrictEqual(r.submitter_auth?.proven_submitter_ids, ["probe-runner"]);
  assert.ok((r.submitter_auth?.submitter_key_fp ?? "").length > 0);
  assert.ok(r.submitter_auth?.note.includes("An authenticated liar is authenticated"));
});

check("G2 — an EMPTY roster is its own state: accepted, but it buys no clean reading", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core } = rosteredCore(dir, 1_000, {});
  assert.strictEqual(core.roster.state, "CONFIGURED_EMPTY");
  const r = core.submit({ submitter_id: "obs", channel: "main", payload: {} });
  // Not fail-shut — the clerk stays usable. Not clean either.
  assert.strictEqual(r.submitter_auth?.state, "UNAUTHENTICATED_EMPTY_ROSTER");
  assert.ok(r.submitter_auth?.note.includes("not the same as zero impostors"));
  assert.ok(r.submitter_auth?.note.includes("NOT the same state as no roster at all"));
});

check("G2 — the auth state is inside the signed preimage; laundering it breaks the chain", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core } = fixedClockCore(dir, 1_000);
  core.submit({ submitter_id: "obs", channel: "main", payload: {} });

  const p = join(dir, STORE_FILES.receipts);
  writeLines(
    p,
    lines(p).map((l) => {
      const o = JSON.parse(l) as Record<string, unknown>;
      if (o.kind === "SUBMISSION") {
        // Promote an unauthenticated receipt to an authenticated-looking one.
        o.submitter_auth = {
          state: "AUTHENTICATED",
          proven_submitter_ids: ["obs"],
          submitter_key_fp: "deadbeefdeadbeef",
          nonce: "fabricated",
          note: "looks authentic",
        };
      }
      return JSON.stringify(o);
    })
  );

  const v = verifyChain(readStore(dir), {
    publicKeyB64: core.publicKeyB64,
    trustAnchor: "OUT_OF_BAND",
  });
  assert.strictEqual(v.kind, "BREAK_FOUND");
  if (v.kind !== "BREAK_FOUND") return;
  assert.ok(v.breaks.some((b) => b.class === "RECEIPT_HASH_MISMATCH"));
  assert.ok(v.breaks.some((b) => b.class === "SIGNATURE_INVALID"));
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── G4 · replay resistance: what the signature covers ──");

check("a captured submission cannot be re-posted: the nonce is single-use", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const real = generateKeyPairSync("ed25519");
  const { core } = rosteredCore(dir, 1_000, { "probe-runner": spki(real.publicKey) });

  // The attacker captures a complete, valid submission off the wire.
  const nonce = core.challenge().nonce;
  const payload = { n: 1 };
  const preimage = submitterAuthPreimage({
    clerk_id: core.clerkId,
    nonce,
    submitter_id: "probe-runner",
    channel: "heartbeat",
    payload_commitment: commit(payload).commitment,
  });
  const signature = cryptoSign(null, Buffer.from(preimage, "utf8"), real.privateKey).toString("base64");
  const captured = {
    submitter_id: "probe-runner",
    channel: "heartbeat",
    payload,
    nonce,
    submitter_signature: signature,
  };

  core.submit({ ...captured }); // the genuine one goes through
  assert.throws(
    () => core.submit({ ...captured }), // byte-identical replay
    (err: unknown) =>
      err instanceof SubmissionRejected && err.reason === "MISSING_OR_UNKNOWN_NONCE"
  );
});

check("a captured submission cannot be re-aimed at another channel", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const real = generateKeyPairSync("ed25519");
  const { core } = rosteredCore(dir, 1_000, { "probe-runner": spki(real.publicKey) });

  const nonce = core.challenge().nonce;
  const payload = { n: 1 };
  const preimage = submitterAuthPreimage({
    clerk_id: core.clerkId,
    nonce,
    submitter_id: "probe-runner",
    channel: "heartbeat",
    payload_commitment: commit(payload).commitment,
  });
  const signature = cryptoSign(null, Buffer.from(preimage, "utf8"), real.privateKey).toString("base64");

  // Same live nonce, same signature, different channel — the channel is in the
  // signed material, so this is not a valid credential for it.
  assert.throws(
    () =>
      core.submit({
        submitter_id: "probe-runner",
        channel: "audit",
        payload,
        nonce,
        submitter_signature: signature,
      }),
    (err: unknown) =>
      err instanceof SubmissionRejected && err.reason === "SUBMITTER_SIGNATURE_INVALID"
  );
});

check("a captured submission cannot be re-aimed at another payload or submitter", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const a = generateKeyPairSync("ed25519");
  const b = generateKeyPairSync("ed25519");
  const { core } = rosteredCore(dir, 1_000, {
    "probe-runner": spki(a.publicKey),
    "other": spki(b.publicKey),
  });

  const nonce = core.challenge().nonce;
  const preimage = submitterAuthPreimage({
    clerk_id: core.clerkId,
    nonce,
    submitter_id: "probe-runner",
    channel: "heartbeat",
    payload_commitment: commit({ n: 1 }).commitment,
  });
  const signature = cryptoSign(null, Buffer.from(preimage, "utf8"), a.privateKey).toString("base64");

  assert.throws(
    () =>
      core.submit({
        submitter_id: "probe-runner",
        channel: "heartbeat",
        payload: { n: 99 }, // swapped content
        nonce,
        submitter_signature: signature,
      }),
    (err: unknown) =>
      err instanceof SubmissionRejected && err.reason === "SUBMITTER_SIGNATURE_INVALID"
  );

  const nonce2 = core.challenge().nonce;
  const preimage2 = submitterAuthPreimage({
    clerk_id: core.clerkId,
    nonce: nonce2,
    submitter_id: "probe-runner",
    channel: "heartbeat",
    payload_commitment: commit({ n: 1 }).commitment,
  });
  const signature2 = cryptoSign(null, Buffer.from(preimage2, "utf8"), a.privateKey).toString("base64");
  assert.throws(
    () =>
      core.submit({
        submitter_id: "other", // re-posted under another name
        channel: "heartbeat",
        payload: { n: 1 },
        nonce: nonce2,
        submitter_signature: signature2,
      }),
    (err: unknown) =>
      err instanceof SubmissionRejected && err.reason === "SUBMITTER_SIGNATURE_INVALID"
  );
});

check("a nonce from another clerk does not work here", () => {
  const realKey = generateKeyPairSync("ed25519");
  const roster = { "probe-runner": spki(realKey.publicKey) };
  const dirA = freshDir();
  const dirB = freshDir();
  deployClerkStore(dirA);
  deployClerkStore(dirB);
  const a = rosteredCore(dirA, 1_000, roster);
  const b = rosteredCore(dirB, 1_000, roster);

  // A nonce issued by clerk A, signed for clerk A, presented to clerk B.
  const nonce = a.core.challenge().nonce;
  const preimage = submitterAuthPreimage({
    clerk_id: a.core.clerkId,
    nonce,
    submitter_id: "probe-runner",
    channel: "heartbeat",
    payload_commitment: commit({ n: 1 }).commitment,
  });
  const signature = cryptoSign(null, Buffer.from(preimage, "utf8"), realKey.privateKey).toString("base64");
  assert.throws(
    () =>
      b.core.submit({
        submitter_id: "probe-runner",
        channel: "heartbeat",
        payload: { n: 1 },
        nonce,
        submitter_signature: signature,
      }),
    (err: unknown) =>
      err instanceof SubmissionRejected && err.reason === "MISSING_OR_UNKNOWN_NONCE"
  );
});

check("an expired nonce is refused, and nonces do not survive a restart", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const real = generateKeyPairSync("ed25519");
  const { core, setWall } = rosteredCore(dir, 1_000, {
    "probe-runner": spki(real.publicKey),
  });
  const nonce = core.challenge().nonce;
  setWall(1_000 + 60_000); // past the 30s TTL
  assert.throws(
    () => signedSubmit(core, "probe-runner", "heartbeat", { n: 1 }, real.privateKey, { nonce }),
    (err: unknown) =>
      err instanceof SubmissionRejected && err.reason === "NONCE_EXPIRED"
  );

  const fresh = rosteredCore(dir, 2_000_000, { "probe-runner": spki(real.publicKey) });
  const staleNonce = core.challenge().nonce;
  assert.throws(
    () => signedSubmit(fresh.core, "probe-runner", "heartbeat", { n: 1 }, real.privateKey, { nonce: staleNonce }),
    (err: unknown) =>
      err instanceof SubmissionRejected && err.reason === "MISSING_OR_UNKNOWN_NONCE"
  );
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── G5–G8 · the trace, the blindness, the reader, and old stores ──");

check("G5: what a reader sees after a rejected submission", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const real = generateKeyPairSync("ed25519");
  const { core } = rosteredCore(dir, 1_000, { "probe-runner": spki(real.publicKey) });
  try {
    core.submit({ submitter_id: "ghost", channel: "heartbeat", payload: {} });
  } catch {
    /* expected */
  }
  const text = renderReport(
    buildReport({ store: dir, pubkey: core.publicKeyB64, now: 2_000, json: false })
  );
  assert.ok(text.includes("refusals recorded"), text);
  assert.ok(text.includes("SUBMITTER_NOT_IN_ROSTER"), text);
  assert.ok(text.includes("declared=ghost"), text);
  assert.ok(text.includes("never an accusation"), text);
});

check("G5: refusal records are rate-limited, and the suppression is COUNTED", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const real = generateKeyPairSync("ed25519");
  const { core, setWall } = rosteredCore(dir, 1_000, {
    "probe-runner": spki(real.publicKey),
  });
  // A flood of identical refusals inside one cooldown window.
  for (let i = 0; i < 50; i++) {
    try {
      core.submit({ submitter_id: "ghost", channel: "heartbeat", payload: { i } });
    } catch {
      /* expected */
    }
  }
  const store = readStore(dir);
  if (store.kind !== "STORE_READ") throw new Error("store unreadable");
  const refusals = store.records.filter((r) => r.kind === "REFUSAL");
  assert.strictEqual(refusals.length, 1, "the chain must not grow once per attempt");

  // The next window emits one record, and it carries the suppressed count.
  setWall(3_000);
  try {
    core.submit({ submitter_id: "ghost", channel: "heartbeat", payload: {} });
  } catch {
    /* expected */
  }
  const after = readStore(dir);
  if (after.kind !== "STORE_READ") throw new Error("store unreadable");
  const second = after.records.filter((r) => r.kind === "REFUSAL")[1];
  assert.ok(second !== undefined);
  if (second?.kind !== "REFUSAL") return;
  assert.strictEqual(second.suppressed_since_last, 49);
});

check("G6: a channel whose arrivals are unauthenticated is BLIND for quiet, never clean", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core, setWall } = fixedClockCore(dir, 1_000);
  core.declareCadence("heartbeat", 10_000, 0, "deployer");
  setWall(1_100);
  core.submit({ submitter_id: "obs", channel: "heartbeat", payload: {} });

  const store = readStore(dir);
  const v = verifyChain(store, { publicKeyB64: core.publicKeyB64, trustAnchor: "OUT_OF_BAND" });
  const g = readGaps(store.kind === "STORE_READ" ? store.records : [], {
    now: 2_000,
    verification: v,
  });
  assert.notStrictEqual(g.kind, "NO_GAP_OBSERVED");
  assert.strictEqual(g.kind, "CANNOT_ASSESS_CADENCE");
  if (g.kind !== "CANNOT_ASSESS_CADENCE") return;
  const b = g.blind.find((x) => x.class === "SUBMITTER_UNAUTHENTICATED");
  assert.ok(b !== undefined);
  assert.ok(b.exit !== null && b.exit.includes("no code here makes it"));
});

check("NONCE EXHAUSTION: a starved submitter is typed CHANNEL_IMPAIRED, not SUBMITTER_SILENT", () => {
  // The hole this round opened, found and closed inside it. `challenge` is
  // unauthenticated on purpose (so it cannot enumerate the roster), so anyone
  // reaching the socket can exhaust the nonce table. Honest submitters then
  // cannot submit and look silent — and reading that as SUBMITTER_SILENT bills
  // a clerk-side refusal to the submitter.
  const dir = freshDir();
  deployClerkStore(dir);
  const real = generateKeyPairSync("ed25519");
  const { core, setWall } = rosteredCore(dir, 1_000, {
    "probe-runner": spki(real.publicKey),
  });
  core.declareCadence("heartbeat", 1_000, 100, "deployer");
  setWall(1_500);
  signedSubmit(core, "probe-runner", "heartbeat", { n: 1 }, real.privateKey);

  // The attacker drains the nonce table (this clerk is configured small).
  const small = new ClerkCore({
    storeDir: dir,
    separation: "IN_PROCESS_NO_SEPARATION",
    wallClock: () => 3_000,
    roster: { "probe-runner": spki(real.publicKey) },
    maxOutstandingNonces: 4,
  });
  for (let i = 0; i < 4; i++) small.challenge();
  assert.throws(() => small.challenge(), NonceUnavailable);

  // The honest submitter now cannot get a nonce at all.
  assert.throws(() => small.challenge(), NonceUnavailable);

  const store = readStore(dir);
  if (store.kind !== "STORE_READ") throw new Error("store unreadable");
  assert.ok(
    store.records.some((r) => r.kind === "REFUSAL" && r.reason === "CHALLENGE_UNAVAILABLE"),
    "the refusal to issue must be in the chain, or the silence gets misattributed"
  );

  const v = verifyChain(store, { publicKeyB64: core.publicKeyB64, trustAnchor: "OUT_OF_BAND" });
  const g = readGaps(store.records, { now: 20_000, verification: v });
  assert.strictEqual(g.kind, "GAP_OBSERVED", renderGapRead(g));
  if (g.kind !== "GAP_OBSERVED") return;
  const stop = g.stops.find((s) => s.channel === "heartbeat");
  assert.ok(stop !== undefined, renderGapRead(g));
  assert.strictEqual(stop.object, "CHANNEL_IMPAIRED");
  assert.strictEqual(stop.clerk_coverage.state, "CLERK_REFUSED_CHALLENGES_IN_WINDOW");
  assert.ok(stop.clerk_coverage.detail.includes("CLERK'S INTAKE"));
  assert.ok(stop.clerk_coverage.detail.includes("does not establish"));
});

check("G6: a GAP is still reported on an unauthenticated channel — the blindness is asymmetric", () => {
  // An impostor can manufacture arrivals, and therefore quiet. It cannot
  // manufacture silence that is not there, so a gap is still worth reporting.
  const dir = freshDir();
  deployClerkStore(dir);
  const { core, setWall } = fixedClockCore(dir, 1_000);
  core.declareCadence("heartbeat", 1_000, 100, "deployer");
  setWall(1_500);
  core.submit({ submitter_id: "obs", channel: "heartbeat", payload: {} });

  const store = readStore(dir);
  const v = verifyChain(store, { publicKeyB64: core.publicKeyB64, trustAnchor: "OUT_OF_BAND" });
  const g = readGaps(store.kind === "STORE_READ" ? store.records : [], {
    now: 20_000,
    verification: v,
  });
  assert.strictEqual(g.kind, "GAP_OBSERVED", renderGapRead(g));
  if (g.kind !== "GAP_OBSERVED") return;
  assert.strictEqual(g.stops.length, 1);
  assert.ok(g.blind.some((b) => b.class === "SUBMITTER_UNAUTHENTICATED"));
});

check("G7: the reader states the precondition in its own voice", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const real = generateKeyPairSync("ed25519");
  const { core } = rosteredCore(dir, 1_000, { "probe-runner": spki(real.publicKey) });
  signedSubmit(core, "probe-runner", "heartbeat", { n: 1 }, real.privateKey);
  const text = renderReport(
    buildReport({ store: dir, pubkey: core.publicKeyB64, now: 2_000, json: false })
  );
  assert.ok(text.includes("SUBMITTER CREDENTIALS"), text);
  assert.ok(text.includes("WHAT AN AUTHENTICATED CLAIM DOES NOT MEAN"), text);
  assert.ok(text.includes("an authenticated liar is authenticated"), text);
  assert.ok(text.includes("AND THE PRECONDITION THAT DOES NOT GO AWAY"), text);
  assert.ok(text.includes("readable by the attacker buys nothing"), text);
  assert.ok(text.includes("reported here as unverified"), text);
  assert.ok(text.includes("AUTHENTICATED=1"), text);
});

check("G7: an AUTHENTICATED credential checked in-process is cross-checked and flagged", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const real = generateKeyPairSync("ed25519");
  const core = new ClerkCore({
    storeDir: dir,
    separation: "SEPARATE_PROCESS",
    wallClock: () => 1_000,
    roster: { "probe-runner": spki(real.publicKey) },
  });
  signedSubmit(core, "probe-runner", "heartbeat", { n: 1 }, real.privateKey);
  const report = buildReport({ store: dir, pubkey: core.publicKeyB64, now: 2_000, json: false });
  assert.deepStrictEqual(report.credentials.authenticatedButLocalCallSeqs, [1]);
  const text = renderReport(report);
  assert.ok(text.includes("DIRECT IN-PROCESS CALL"), text);
  assert.ok(text.includes("proves nothing about who ran"), text);
});

check("G7: a roster change across boots is visible in the record", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const real = generateKeyPairSync("ed25519");
  const a = rosteredCore(dir, 1_000, { "probe-runner": spki(real.publicKey) });
  signedSubmit(a.core, "probe-runner", "heartbeat", { n: 1 }, real.privateKey);
  // The clerk is restarted with authentication removed. Nothing prevents it.
  const b = fixedClockCore(dir, 5_000);
  const report = buildReport({ store: dir, pubkey: b.core.publicKeyB64, now: 6_000, json: false });
  assert.strictEqual(report.credentials.rosterHistory.length, 2);
  assert.strictEqual(report.credentials.rosterState, "ABSENT");
  const text = renderReport(report);
  assert.ok(text.includes("THE ROSTER CHANGED DURING THIS STORE'S HISTORY"), text);
  assert.ok(text.includes("DOWNGRADE"), text);
});

check("G8: a store written BEFORE this round still verifies, and is not relabelled", () => {
  // A genuine version-1 store: no `submitter_auth`, no roster fields, no
  // REFUSAL kind. Built here with its own key so it is a real v1 artefact and
  // not this build's output with fields deleted.
  const dir = freshDir();
  deployClerkStore(dir);
  const clerkKey = generateKeyPairSync("ed25519");
  const pub = spki(clerkKey.publicKey);

  let prev = "0".repeat(64);
  const out: string[] = [];
  let tail: Record<string, unknown> | null = null;
  const v1Frame = (seq: number, kind: string, wall: number): Record<string, unknown> => ({
    receipt_version: 1,
    kind,
    clerk_id: "legacy-clerk",
    clerk_boot_id: "legacy-boot",
    separation: "SEPARATE_PROCESS",
    separation_warning: null,
    clerk_principal: "legacy",
    intake: kind === "BOOT" ? "CLERK_INTERNAL" : "SOCKET",
    attests: {
      form: "ILAS-CLERK-ATTESTATION-1",
      attests: ["ARRIVAL", "ORDER", "GAP", "INTEGRITY_SINCE_ARRIVAL"],
      does_not_attest: ["PAYLOAD_TRUTH"],
      against: "OBSERVED_SYSTEM_ONLY",
      note: "v1",
    },
    clerk_seq: seq,
    clerk_time: { wall_ms: wall, monotonic_ns: String(seq * 1000) },
    prev_receipt_hash: prev,
    signature_alg: "ed25519",
  });

  const bodies: Record<string, unknown>[] = [
    { ...v1Frame(0, "BOOT", 1_000), clerk_build: "clerk-1/rung-1", clerk_pid: 1, store_dir: dir, public_key: pub, store_load_state: "FRESH", store_load_detail: null },
    { ...v1Frame(1, "CADENCE", 1_010), channel: "heartbeat", period_ms: 10_000, grace_ms: 0, declared_by: "deployer" },
    { ...v1Frame(2, "SUBMISSION", 1_020), submitter_id: "obs", channel: "heartbeat", declared_timestamp: null, payload_commitment: commit({ v: 1 }).commitment, payload_bytes: 9, canonical_form: "ILAS-CANON-JSON-1", payload_retained: true, payload_canonical: canonicalise({ v: 1 }) },
  ];
  for (const body of bodies) {
    body.prev_receipt_hash = prev;
    const preimage = canonicalise(body);
    body.receipt_hash = createHash("sha256").update(preimage, "utf8").digest("hex");
    body.signature = cryptoSign(null, Buffer.from(preimage, "utf8"), clerkKey.privateKey).toString("base64");
    prev = body.receipt_hash as string;
    tail = body;
    out.push(JSON.stringify(body));
  }
  writeLines(join(dir, STORE_FILES.receipts), out);
  const headUnsigned = {
    form: "ILAS-CLERK-HEAD-1",
    clerk_id: "legacy-clerk",
    clerk_seq: 2,
    record_count: 3,
    receipt_hash: tail!.receipt_hash,
    wall_ms: 1_020,
  };
  writeFileSync(
    join(dir, STORE_FILES.head),
    JSON.stringify({
      ...headUnsigned,
      signature: cryptoSign(null, Buffer.from(canonicalise(headUnsigned), "utf8"), clerkKey.privateKey).toString("base64"),
    }),
    "utf8"
  );

  // 1. It still parses: no line becomes MALFORMED_LINE.
  const store = readStore(dir);
  assert.strictEqual(store.kind, "STORE_READ");
  if (store.kind !== "STORE_READ") return;
  assert.deepStrictEqual(store.malformed, []);

  // 2. It still verifies.
  const v = verifyChain(store, { publicKeyB64: pub, trustAnchor: "OUT_OF_BAND" });
  assert.strictEqual(v.kind, "INTACT_SINCE_ARRIVAL", renderVerification(v));

  // 3. Its submitter claim is UNKNOWN, not relabelled in either direction.
  const report = buildReport({ store: dir, pubkey: pub, now: 1_100, json: false });
  assert.deepStrictEqual(report.credentials.authCounts, { UNKNOWN_PRE_CREDENTIALS: 1 });
  assert.strictEqual(report.credentials.rosterState, "UNKNOWN_PRE_CREDENTIALS");
  const text = renderReport(report);
  assert.ok(text.includes("UNKNOWN_PRE_CREDENTIALS"), text);

  // 4. And an unverifiable submitter claim still withholds quiet.
  const g = readGaps(store.records, { now: 1_100, verification: v });
  assert.notStrictEqual(g.kind, "NO_GAP_OBSERVED");
});

check("a claim about key possession cannot be read off an unauthenticated record", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const real = generateKeyPairSync("ed25519");
  const { core } = rosteredCore(dir, 1_000, { "probe-runner": spki(real.publicKey) });
  const good = signedSubmit(core, "probe-runner", "heartbeat", { n: 1 }, real.privateKey);
  const claim = claimFrom(good, "SUBMITTER_KEY_POSSESSION");
  assert.strictEqual(claim.subject, "SUBMITTER_KEY_POSSESSION");
  assert.ok(claim.statement.includes("NOT that the party IS that identifier"));

  const bareDir = freshDir();
  deployClerkStore(bareDir);
  const bare = fixedClockCore(bareDir, 1_000);
  const unauth = bare.core.submit({ submitter_id: "obs", channel: "main", payload: {} });
  assert.throws(
    () => claimFrom(unauth, "SUBMITTER_KEY_POSSESSION"),
    (err: unknown) =>
      err instanceof ClerkScopeViolation && err.message.includes("NOT SUPPORTED BY THIS RECORD")
  );
  // and never off a record that is not a submission at all
  const store = readStore(dir);
  if (store.kind !== "STORE_READ") throw new Error("store unreadable");
  assert.throws(
    () => claimFrom(store.records[0], "SUBMITTER_KEY_POSSESSION"),
    ClerkScopeViolation
  );
  // IDENTITY remains out of scope even now that possession is in it
  assert.throws(() => claimFrom(good, "SUBMITTER_IDENTITY"), ClerkScopeViolation);
});

check("a roster binding one key to two names says so rather than picking one", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const shared = generateKeyPairSync("ed25519");
  const { core } = rosteredCore(dir, 1_000, {
    "probe-runner": spki(shared.publicKey),
    "probe-runner-standby": spki(shared.publicKey),
  });
  assert.ok(core.roster.problems.some((p) => p.includes("is shared by 2 identifiers")));
  const r = signedSubmit(core, "probe-runner", "heartbeat", { n: 1 }, shared.privateKey);
  assert.deepStrictEqual(r.submitter_auth?.proven_submitter_ids, [
    "probe-runner",
    "probe-runner-standby",
  ]);
  assert.ok(r.submitter_auth?.note.includes("does not distinguish between them"));
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── T2 · the finer problems this build OPENS — demonstrated, not asserted ──");

/** The laundering scenario, run against whatever clerk the caller configures. */
function launderingRun(
  core: ClerkCore,
  setWall: (ms: number) => void,
  keepWarm: (t: number) => void
): ReturnType<typeof readGaps> {
  core.declareCadence("heartbeat", 1_000, 100, "deployer");
  setWall(1_500);
  core.submit({ submitter_id: "probe-runner", channel: "heartbeat", payload: { n: 1 } });
  // probe-runner dies here. Something else tries to keep its channel alive.
  for (let t = 2_400; t <= 9_000; t += 800) {
    setWall(t);
    keepWarm(t);
  }
  const store = readStore(core.storeDir);
  const v = verifyChain(store, {
    publicKeyB64: core.publicKeyB64,
    trustAnchor: "OUT_OF_BAND",
  });
  assert.strictEqual(v.kind, "INTACT_SINCE_ARRIVAL", renderVerification(v));
  return readGaps(store.kind === "STORE_READ" ? store.records : [], {
    now: 9_100,
    verification: v,
  });
}

check("BEFORE (no roster): the impostor keeps the channel warm — and quiet is now WITHHELD", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const { core, setWall } = fixedClockCore(dir, 1_000);
  const g = launderingRun(core, setWall, () => {
    core.submit({ submitter_id: "probe-runner", channel: "heartbeat", payload: { n: 0 } });
  });

  // Last round this returned NO_GAP_OBSERVED on a perfect chain while the real
  // submitter was dead. The impostor still succeeds in submitting — nothing
  // stops it without a roster — but the READING is no longer clean.
  assert.strictEqual(g.kind, "CANNOT_ASSESS_CADENCE", renderGapRead(g));
  if (g.kind !== "CANNOT_ASSESS_CADENCE") return;
  const b = g.blind.find((x) => x.class === "SUBMITTER_UNAUTHENTICATED");
  assert.ok(b !== undefined, renderGapRead(g));
  assert.strictEqual(b.channel, "heartbeat");
  assert.ok(b.detail.includes("UNMEASURED, not clean"));
  assert.ok(b.exit !== null);
});

check("AFTER (roster in force): the impostor is REFUSED and the real gap surfaces", () => {
  const dir = freshDir();
  deployClerkStore(dir);
  const real = generateKeyPairSync("ed25519");
  const impostor = generateKeyPairSync("ed25519");
  const { core, setWall } = rosteredCore(dir, 1_000, {
    "probe-runner": spki(real.publicKey),
  });

  core.declareCadence("heartbeat", 1_000, 100, "deployer");
  setWall(1_500);
  signedSubmit(core, "probe-runner", "heartbeat", { n: 1 }, real.privateKey);

  // probe-runner dies. The impostor holds no key and tries anyway — three ways.
  let refused = 0;
  for (let t = 2_400; t <= 9_000; t += 800) {
    setWall(t);
    try {
      if (t % 2400 === 0) {
        // bare submission, no credential at all
        core.submit({ submitter_id: "probe-runner", channel: "heartbeat", payload: { n: 0 } });
      } else {
        // a signature, but from a key the roster does not bind to this name
        signedSubmit(core, "probe-runner", "heartbeat", { n: 0 }, impostor.privateKey);
      }
    } catch (err) {
      assert.ok(err instanceof SubmissionRejected, String(err));
      refused++;
    }
  }
  assert.strictEqual(refused, 9, "every impostor attempt must be refused");

  const store = readStore(dir);
  const v = verifyChain(store, { publicKeyB64: core.publicKeyB64, trustAnchor: "OUT_OF_BAND" });
  assert.strictEqual(v.kind, "INTACT_SINCE_ARRIVAL", renderVerification(v));
  const g = readGaps(store.kind === "STORE_READ" ? store.records : [], {
    now: 9_100,
    verification: v,
  });

  // The real submitter's silence is now visible, and typed.
  assert.strictEqual(g.kind, "GAP_OBSERVED", renderGapRead(g));
  if (g.kind !== "GAP_OBSERVED") return;
  assert.strictEqual(g.stops.length, 1);
  assert.strictEqual(g.stops[0].channel, "heartbeat");
  assert.strictEqual(g.stops[0].object, "SUBMITTER_SILENT");
  assert.ok(g.stops[0].silence_ms >= 7_000);
  assert.ok(
    !g.blind.some((b) => b.class === "SUBMITTER_UNAUTHENTICATED"),
    "an authenticated channel must not be blind for quiet"
  );
});

check("SAME-PRINCIPAL KEY READ: a forged store verifies against the real key", () => {
  // SEPARATE_PROCESS gives memory separation. It does NOT give principal
  // separation. At the same OS user, the observed system reads clerk.key with
  // an ordinary file read — no privilege escalation — and can then mint any
  // chain it likes, which verifies against the genuine out-of-band public key.
  const dir = freshDir();
  deployClerkStore(dir);
  const { core, setWall } = fixedClockCore(dir, 1_000);
  for (let i = 0; i < 3; i++) {
    setWall(1_000 + i * 10);
    core.submit({ submitter_id: "obs", channel: "main", payload: { truth: i } });
  }
  const genuinePub = core.publicKeyB64;

  // The forgery, performed with nothing but a file read.
  const stolen = createPrivateKey(readFileSync(join(dir, STORE_FILES.privateKey), "utf8"));
  const original = readStore(dir);
  if (original.kind !== "STORE_READ") throw new Error("store unreadable");

  let prev = "0".repeat(64);
  const forged: string[] = [];
  let tail: Record<string, unknown> | null = null;
  for (const rec of original.records) {
    const o = JSON.parse(JSON.stringify(rec)) as Record<string, unknown>;
    if (o.kind === "SUBMISSION") {
      o.payload_canonical = '{"truth":"whatever the forger prefers"}';
      o.payload_commitment = createHash("sha256")
        .update(o.payload_canonical as string, "utf8")
        .digest("hex");
    }
    o.prev_receipt_hash = prev;
    const unsigned: Record<string, unknown> = { ...o };
    delete unsigned.receipt_hash;
    delete unsigned.signature;
    const preimage = canonicalise(unsigned);
    o.receipt_hash = createHash("sha256").update(preimage, "utf8").digest("hex");
    o.signature = cryptoSign(null, Buffer.from(preimage, "utf8"), stolen).toString("base64");
    prev = o.receipt_hash as string;
    tail = o;
    forged.push(JSON.stringify(o));
  }
  writeLines(join(dir, STORE_FILES.receipts), forged);

  const headUnsigned = {
    form: "ILAS-CLERK-HEAD-1",
    clerk_id: tail!.clerk_id,
    clerk_seq: tail!.clerk_seq,
    record_count: (tail!.clerk_seq as number) + 1,
    receipt_hash: tail!.receipt_hash,
    wall_ms: (tail!.clerk_time as { wall_ms: number }).wall_ms,
  };
  writeFileSync(
    join(dir, STORE_FILES.head),
    JSON.stringify({
      ...headUnsigned,
      signature: cryptoSign(null, Buffer.from(canonicalise(headUnsigned), "utf8"), stolen).toString("base64"),
    }),
    "utf8"
  );

  const v = verifyChain(readStore(dir), {
    publicKeyB64: genuinePub, // the GENUINE key, obtained out of band
    trustAnchor: "OUT_OF_BAND",
  });
  // This is the honest, uncomfortable result and it is recorded, not hidden.
  assert.strictEqual(v.kind, "INTACT_SINCE_ARRIVAL", renderVerification(v));
});

// ══════════════════════════════════════════════════════════════════════════════
// Asynchronous section: the separate OS process, and the reader run as a person
// would run it.
// ══════════════════════════════════════════════════════════════════════════════

interface ReadyMessage {
  type: string;
  socketPath: string;
  storeDir: string;
  publicKey: string;
  clerkId: string;
}

function forkClerkd(
  dir: string,
  rosterPath?: string
): Promise<{ child: ReturnType<typeof fork>; ready: ReadyMessage }> {
  return new Promise((resolve, reject) => {
    const argv = ["--store", dir, "--tick-ms", "60000"];
    if (rosterPath !== undefined) argv.push("--roster", rosterPath);
    const child = fork(join(__dirname, "clerkd.ts"), argv, {
      execArgv: ["-r", "ts-node/register"],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("clerkd did not report ready within 60s"));
    }, 60_000);
    child.once("message", (m: unknown) => {
      clearTimeout(timer);
      const msg = m as ReadyMessage;
      if (msg?.type !== "clerk-ready") {
        reject(new Error(`unexpected first message: ${JSON.stringify(m)}`));
        return;
      }
      resolve({ child, ready: msg });
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── S97 · the store directory is a DEPLOYMENT ACT, and the clerk will not make one ──");

check("S97-C1 · a clerk whose store directory was never deployed throws a SIGNPOST", () => {
  // `freshDir()` names a path and makes nothing, and `deployClerkStore` is NOT
  // called here on purpose: this body models a deployer who skipped §4.1.
  const dir = freshDir();
  assert.strictEqual(existsSync(dir), false, "the test's own premise moved");

  let caught: unknown = null;
  try {
    new ClerkCore({ storeDir: dir, separation: "IN_PROCESS_NO_SEPARATION" });
  } catch (err) {
    caught = err;
  }

  // ASSERT ON THE OUTPUT, NEVER ON "IT THREW" (S96-B candidate 1): each of the
  // three signpost elements is named on its own line.
  assert.ok(
    caught instanceof ClerkDeploymentActMissingError,
    `wrong error type: ${String(caught)}`
  );
  const message = (caught as Error).message;
  assert.ok(message.includes("clerk store directory absent"), message);
  assert.ok(message.includes("this is a deployment act"), message);   // the act
  assert.ok(message.includes("deploy recipe §4.1"), message);         // the section
  assert.ok(message.includes(`${dir} at 2750 mica-clerk:mica-readers`), message);
  assert.ok(message.includes("Nothing was created"), message);
  assert.strictEqual((caught as ClerkDeploymentActMissingError).path, dir);
});

check("S97-C2 · and NOTHING is created — no store dir, no receipts, no key", () => {
  const dir = freshDir();
  assert.throws(
    () => new ClerkCore({ storeDir: dir, separation: "IN_PROCESS_NO_SEPARATION" }),
    ClerkDeploymentActMissingError
  );
  assert.strictEqual(existsSync(dir), false, "the store directory was created after all");
  assert.strictEqual(
    readdirSync(root).includes(dir.split("/").pop() as string),
    false,
    "something with the store's name appeared beside its siblings"
  );
});

check("S97-C3 · the KEY DOOR onto the same act is shut, and no key was generated", () => {
  // keys.ts is the second door: cutting store.ts alone would have left §4.1
  // skippable from here, which is exactly how the S86 intake cut had to be
  // made twice. This body calls loadOrCreateKeys directly, past ClerkCore.
  const dir = freshDir();
  const keyPath = join(dir, "clerk-private.pem");
  const pubPath = join(dir, "clerk-public.b64");

  let caught: unknown = null;
  try {
    loadOrCreateKeys(keyPath, pubPath);
  } catch (err) {
    caught = err;
  }
  assert.ok(
    caught instanceof ClerkDeploymentActMissingError,
    `wrong error type: ${String(caught)}`
  );
  const message = (caught as Error).message;
  assert.ok(message.includes("clerk key directory absent"), message);
  assert.ok(message.includes("this is a deployment act"), message);   // the act
  assert.ok(message.includes("deploy recipe §4.1"), message);         // the section
  assert.ok(message.includes(`${dir} at 2750 mica-clerk:mica-readers`), message);
  // The consequence stated in keys.ts, asserted rather than trusted: the
  // generation path is unreachable until the act is performed.
  assert.ok(message.includes("Nothing was created, and no key was generated"), message);
  assert.strictEqual(existsSync(dir), false, "the key directory was created after all");
  assert.strictEqual(existsSync(keyPath), false, "a signing key was written after all");
});

check("S97-C4 · store.ts and keys.ts CALL mkdirSync nowhere — the fence, at bytes", () => {
  // The fence is on the CALL, not on the word (R-P3's rule, S95): both files
  // name `mkdirSync` in prose in order to forbid it, and a fence that banned
  // the word would be satisfied by deleting the sentence doing the work.
  for (const file of ["store.ts", "keys.ts"]) {
    const source = readFileSync(join(__dirname, file), "utf8");
    assert.doesNotMatch(
      codeOnly(source),
      /mkdirSync\s*\(/,
      `${file} must not create a directory anywhere`
    );
    assert.match(source, /mkdirSync/, `${file} lost the reason along with the call`);
    assert.match(source, /deployment act/, `${file} lost the reason along with the call`);
  }
});

check("S97-C5 · and once the deployer HAS performed §4.1, both doors open normally", () => {
  // The other half of the fence: a check that only ever refuses proves nothing
  // about the check passing. Same directory, act performed, clerk comes up.
  const dir = freshDir();
  deployClerkStore(dir);
  const core = new ClerkCore({ storeDir: dir, separation: "IN_PROCESS_NO_SEPARATION" });
  const receipt = core.submit({ submitter_id: "obs", channel: "main", payload: { n: 1 } });
  assert.strictEqual(receipt.clerk_seq, 1);
  assert.ok(existsSync(join(dir, STORE_FILES.receipts)));
  assert.ok(existsSync(join(dir, STORE_FILES.privateKey)));
});

async function main(): Promise<void> {
  console.log("\n── §3 · the separate OS process (the preferred configuration) ──");

  const dir = freshDir();
  deployClerkStore(dir);
  let ready: ReadyMessage | null = null;
  let child: ReturnType<typeof fork> | null = null;

  await checkAsync("clerkd starts in its own OS process and answers the narrow interface", async () => {
    const started = await forkClerkd(dir);
    child = started.child;
    ready = started.ready;
    assert.ok(ready.socketPath.length > 0);
    assert.notStrictEqual(child.pid, process.pid);

    const client = new SocketClerkClient(ready.socketPath);
    const info = await client.info();
    assert.strictEqual(info.separation, "SEPARATE_PROCESS");
    assert.strictEqual(info.separation_warning, null);
    // the submit interface does not disclose the store location
    assert.ok(!JSON.stringify(info).includes(dir));
    await client.close();
  });

  await checkAsync(
    "S110 F-3 — the socket is explicitly 0660 (group read/write), not whatever bind()+umask left it",
    async () => {
      assert.ok(ready !== null, "daemon not started");
      const mode = statSync((ready as ReadyMessage).socketPath).mode & 0o777;
      assert.strictEqual(mode, 0o660, `socket mode was 0${mode.toString(8)}, expected 0660`);
    }
  );

  await checkAsync("receipts from the separate process carry SEPARATE_PROCESS and no warning", async () => {
    assert.ok(ready !== null, "daemon not started");
    const client = new SocketClerkClient((ready as ReadyMessage).socketPath);
    const receipt = await client.submit({
      submitter_id: "observed-system",
      channel: "main",
      declared_timestamp: 1,
      payload: { across: "a process boundary" },
    });
    assert.strictEqual(receipt.separation, "SEPARATE_PROCESS");
    assert.strictEqual(receipt.separation_warning, null);
    // and the separation is corroborated by an OBSERVED intake, not just declared
    assert.strictEqual(receipt.intake, "SOCKET");
    assert.ok(receipt.clerk_principal.length > 0);
    assert.notStrictEqual(receipt.clerk_time.wall_ms, receipt.declared_timestamp);
    await client.close();
  });

  await checkAsync("the interface is narrow: an unknown op is refused, not improvised", async () => {
    assert.ok(ready !== null, "daemon not started");
    const path = (ready as ReadyMessage).socketPath;
    const response = await new Promise<string>((resolve, reject) => {
      const sock = connect(path, () => {
        sock.write(JSON.stringify({ op: "read_private_key" }) + "\n");
      });
      sock.setEncoding("utf8");
      let buf = "";
      sock.on("data", (c: string) => {
        buf += c;
        if (buf.includes("\n")) {
          sock.end();
          resolve(buf.split("\n")[0]);
        }
      });
      sock.on("error", reject);
      setTimeout(() => reject(new Error("no response in 10s")), 10_000);
    });
    const parsed = JSON.parse(response) as { ok: boolean; error?: { message: string } };
    assert.strictEqual(parsed.ok, false);
    assert.ok(parsed.error?.message.includes("deliberately"));
  });

  await checkAsync("credentials work over the real socket, end to end", async () => {
    // The whole path: a deployer roster on disk, a daemon in its own process, a
    // submitter holding its own key, challenge over the wire, signature over
    // {clerk_id, nonce, submitter_id, channel, payload_commitment}.
    const credDir = freshDir();
    deployClerkStore(credDir);
    const submitter = generateKeyPairSync("ed25519");
    const rosterPath = join(credDir, "roster.json");
    writeFileSync(
      rosterPath,
      JSON.stringify({ "probe-runner": spki(submitter.publicKey) }),
      "utf8"
    );

    const started = await forkClerkd(credDir, rosterPath);
    try {
      const client = new SocketClerkClient(started.ready.socketPath);
      const info = await client.info();
      assert.strictEqual(info.roster_state, "CONFIGURED");

      const signer = await SignedSubmitter.forClient(client, "probe-runner", submitter.privateKey);
      const receipt = await signer.submit("heartbeat", { n: 1 });
      assert.strictEqual(receipt.submitter_auth?.state, "AUTHENTICATED");
      assert.strictEqual(receipt.intake, "SOCKET");
      assert.deepStrictEqual(receipt.submitter_auth?.proven_submitter_ids, ["probe-runner"]);

      // An impostor on the same socket, with no key, is refused.
      await assert.rejects(
        client.submit({ submitter_id: "probe-runner", channel: "heartbeat", payload: { n: 0 } }),
        (err: unknown) => String(err).includes("MISSING_OR_UNKNOWN_NONCE")
      );
      await client.close();

      const v = verifyChain(readStore(credDir), {
        publicKeyB64: started.ready.publicKey,
        trustAnchor: "OUT_OF_BAND",
      });
      assert.strictEqual(v.kind, "INTACT_SINCE_ARRIVAL", renderVerification(v));
      const report = buildReport({
        store: credDir,
        pubkey: started.ready.publicKey,
        now: Date.now(),
        json: false,
      });
      assert.strictEqual(report.credentials.rosterState, "CONFIGURED");
      assert.deepStrictEqual(report.credentials.authenticatedButLocalCallSeqs, []);
      assert.strictEqual(report.credentials.refusals.length, 1);
    } finally {
      started.child.kill();
    }
  });

  await checkAsync("the store the separate process wrote verifies from outside it", async () => {
    assert.ok(ready !== null, "daemon not started");
    const r = ready as ReadyMessage;
    const v = verifyChain(readStore(dir), {
      publicKeyB64: r.publicKey,
      trustAnchor: "OUT_OF_BAND",
    });
    assert.strictEqual(v.kind, "INTACT_SINCE_ARRIVAL", renderVerification(v));
  });

  await checkAsync("the reader runs as its own process and prints what T1 REACH requires", async () => {
    assert.ok(ready !== null, "daemon not started");
    const r = ready as ReadyMessage;
    const out = await new Promise<{ code: number | null; text: string }>((resolve, reject) => {
      const proc = fork(join(__dirname, "reader.ts"), ["--store", dir, "--pubkey", r.publicKey], {
        execArgv: ["-r", "ts-node/register"],
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      let text = "";
      proc.stdout?.on("data", (c: Buffer) => (text += c.toString("utf8")));
      proc.stderr?.on("data", (c: Buffer) => (text += c.toString("utf8")));
      proc.once("exit", (code) => resolve({ code, text }));
      proc.once("error", reject);
      setTimeout(() => reject(new Error("reader did not exit in 60s")), 60_000);
    });
    assert.strictEqual(out.code, 0, out.text);
    assert.ok(out.text.includes("READER-COMPETENCE PRESUMED"), out.text);
    assert.ok(out.text.includes("INTACT_SINCE_ARRIVAL"), out.text);
    assert.ok(out.text.includes("SEPARATE_PROCESS"), out.text);
    assert.ok(out.text.includes("BOUNDS OF THIS READING"), out.text);
    assert.ok(out.text.includes(dir), out.text);
  });

  if (child !== null) {
    const c = child as ReturnType<typeof fork>;
    await new Promise<void>((resolve) => {
      c.once("exit", () => resolve());
      c.send({ type: "clerk-stop" });
      setTimeout(() => {
        c.kill();
        resolve();
      }, 10_000);
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* the temp dir is not the deliverable */
  }
  process.exit(failed === 0 ? 0 : 1);
}

void main();
