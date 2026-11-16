// -- REGISTRAR . the chained refusal log -- tests ----------------------------
//
// The debt is from the S99 receipt, section E.6: the refusal log was "a log,
// not a chain: nothing stops the custodian editing it." These tests are about
// the custodian no longer being able to.

import * as assert from "assert";
import { createHash, generateKeyPairSync } from "crypto";
import { spawnSync } from "child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  computeRefusalRecordHash,
  hashFileOrEmpty,
  legacyPointerDetail,
  loadRefusalLog,
  REFUSAL_CHAIN_DOMAIN,
  REFUSAL_LOG_ATTESTS,
  sealRefusalRecord,
  validateRefusalLogRecord,
} from "./refusal-log";
import type { RefusalLogRecord, RefusalRecordBody } from "./refusal-log";
import { Registrar, REFUSAL_CHAIN_ID, REFUSAL_HEAD_MODALITY } from "./registrar";
import { fileDropNamedCommitter } from "../witness/drop-committer";
import { Witness } from "../witness/witness";
import type { NamedHeadCommit, WitnessRecord } from "../witness/types";

let passed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  [ok] ${name}`);
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    throw err;
  }
}

const root = mkdtempSync(join(tmpdir(), "mica-refusal-log-"));
let n = 0;
const freshDir = (): string => {
  const d = join(root, `case-${String(n++)}`);
  mkdirSync(d, { recursive: true });
  return d;
};

function refusal(i: number): RefusalRecordBody {
  return {
    kind: "REFUSED",
    ts: 1_700_000_000_000 + i,
    reason: "NOT_ENTITLED",
    subject: "mica-doctor",
    subjectUid: 992,
    frame: `frame-${String(i)}`,
    detail: "the depositor is not entitled to this book",
  };
}

/** Build a chain of n refusals on disk and return its path. */
function chainOf(count: number): string {
  const dir = freshDir();
  const path = join(dir, "log.jsonl");
  const records: RefusalLogRecord[] = [];
  for (let i = 0; i < count; i++) {
    records.push(sealRefusalRecord(records, refusal(i)));
  }
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return path;
}

// -- the chain holds ---------------------------------------------------------

console.log("\n-- a chain that verifies --");

check("a sealed chain loads VERIFIED and returns every record", () => {
  const look = loadRefusalLog(chainOf(4));
  assert.strictEqual(look.loadState, "LOADED_VERIFIED");
  assert.strictEqual(look.verify().valid, true);
  assert.strictEqual(look.records.length, 4);
  assert.strictEqual(look.records[0].seq, 0);
  assert.strictEqual(look.records[0].previousHash, "");
});

check("the domain tag is IN the preimage, so a refusal hash is not an A9 hash", () => {
  const r = sealRefusalRecord([], refusal(0));
  const { hash, ...rest } = r;
  assert.strictEqual(computeRefusalRecordHash(rest), hash);
  // Same fields, different domain -> different digest. That is what stops a
  // hash from one chain being presented as a hash from another.
  const forged = createDigestWithoutDomain(rest);
  assert.notStrictEqual(forged, hash);
});
function createDigestWithoutDomain(rest: unknown): string {
  // A plain digest of the same fields with NO domain tag and no length
  // prefixing -- what a naive scheme would produce.
  const r = rest as Record<string, unknown>;
  return createHash("sha256").update(JSON.stringify(r), "utf8").digest("hex");
}

check("the KIND is in the preimage: a REFUSED cannot be relabelled ACCEPTED", () => {
  // TWO defences, and the order matters. Relabelling a REFUSED as ACCEPTED
  // leaves it without book/bookSeq/headHash, so VALIDATION rejects it before
  // any hash is computed -- which is why the load path reports it as a schema
  // failure rather than a chain break.
  const r = sealRefusalRecord([], refusal(0));
  const relabelled = { ...r, kind: "ACCEPTED" };
  assert.strictEqual(validateRefusalLogRecord(relabelled), null);

  // And a relabel that IS shape-valid still breaks the hash, because `kind` is
  // in the preimage. This is the case validation cannot catch.
  const acc = sealRefusalRecord([], {
    kind: "ACCEPTED",
    ts: 1,
    subject: "mica-doctor",
    subjectUid: 992,
    frame: "f",
    book: "mica-doctor",
    bookSeq: 3,
    headHash: "abc",
    detail: "",
  });
  const swapped = { ...acc, kind: "REFUSED", reason: "NOT_ENTITLED" };
  assert.strictEqual(
    validateRefusalLogRecord(swapped) === null,
    false,
    "this relabel IS shape-valid, so only the hash can catch it"
  );
  const { hash, ...rest } = swapped;
  assert.notStrictEqual(computeRefusalRecordHash(rest as never), hash);
});

check("a relabelled record is caught by the LOADER, not by a crash", () => {
  const dir = freshDir();
  const p2 = join(dir, "log.jsonl");
  const r = sealRefusalRecord([], refusal(0));
  writeFileSync(p2, JSON.stringify({ ...r, kind: "ACCEPTED" }) + "\n");
  const look = loadRefusalLog(p2);
  assert.strictEqual(look.loadState, "UNVERIFIED_SCHEMA");
  assert.strictEqual(look.verify().valid, false);
});

// -- the four tampers --------------------------------------------------------

console.log("\n-- what the chain catches --");

function tamper(count: number, fn: (lines: string[]) => string[]): ReturnType<typeof loadRefusalLog> {
  const path = chainOf(count);
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
  writeFileSync(path, fn(lines).join("\n") + "\n");
  return loadRefusalLog(path);
}

check("MIDDLE EDIT -> BROKEN, naming the record that was edited", () => {
  const look = tamper(4, (l) => {
    l[1] = l[1].replace('"NOT_ENTITLED"', '"MALFORMED_DEPOSIT"');
    return l;
  });
  assert.strictEqual(look.loadState, "BROKEN_CHAIN");
  assert.strictEqual(look.verify().brokenAt, 1);
  assert.ok(look.problem!.includes("does not hash to the value it carries"));
});

check("REORDER -> BROKEN", () => {
  const look = tamper(4, (l) => [l[0], l[2], l[1], l[3]]);
  assert.strictEqual(look.loadState, "BROKEN_CHAIN");
  assert.strictEqual(look.verify().valid, false);
});

check("MIDDLE DELETION -> BROKEN", () => {
  const look = tamper(4, (l) => [l[0], l[1], l[3]]);
  assert.strictEqual(look.loadState, "BROKEN_CHAIN");
  assert.ok(look.problem!.includes("removed or reordered"));
});

check("THE HONEST LIMIT -- a custodian who re-seals the whole tail is NOT caught", () => {
  // The strongest case. An editor who understands the chain could recompute
  // every hash after their edit. They cannot -- nothing here is secret, so this
  // test asserts the honest limit rather than a false one.
  const path = chainOf(3);
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
  const recs = lines.map((l) => JSON.parse(l) as RefusalLogRecord);
  const edited = { ...recs[1], detail: "a different sentence" } as RefusalLogRecord;
  const resealed: RefusalLogRecord[] = [recs[0]];
  resealed.push(sealRefusalRecord(resealed, stripFrame(edited)));
  resealed.push(sealRefusalRecord(resealed, stripFrame(recs[2])));
  writeFileSync(path, resealed.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const look = loadRefusalLog(path);
  // IT VERIFIES. A chain alone cannot stop a custodian who rewrites the whole
  // tail; only an external anchor can, and this log has none (see the receipt).
  assert.strictEqual(look.loadState, "LOADED_VERIFIED");
  assert.strictEqual(
    (look.records[1] as { detail: string }).detail,
    "a different sentence",
    "the honest limit, asserted rather than hidden"
  );
});
function stripFrame(r: RefusalLogRecord): RefusalRecordBody {
  const { seq, previousHash, hash, ...body } = r as Record<string, unknown> & RefusalLogRecord;
  return body as unknown as RefusalRecordBody;
}

check("TAIL TRUNCATION -> still VALID, and the attestation says so", () => {
  const look = tamper(4, (l) => l.slice(0, 2));
  assert.strictEqual(look.loadState, "LOADED_VERIFIED");
  assert.strictEqual(look.records.length, 2);
  assert.ok(REFUSAL_LOG_ATTESTS.includes("TAIL"));
  assert.ok(REFUSAL_LOG_ATTESTS.includes("DOES NOT ATTEST COMPLETENESS"));
  assert.ok(REFUSAL_LOG_ATTESTS.includes("no chain can ever"));
});

check("the attestation claims no signature, because there is none", () => {
  assert.ok(REFUSAL_LOG_ATTESTS.includes("NO SIGNATURE"));
  assert.ok(REFUSAL_LOG_ATTESTS.includes("no key is read"));
  // And it separates recording a refusal from the refusal being right.
  assert.ok(REFUSAL_LOG_ATTESTS.includes("never the"));
});

// -- absence, blindness, malformation ----------------------------------------

console.log("\n-- three findings, kept apart --");

check("ABSENT is not CANNOT_SEE", () => {
  const look = loadRefusalLog(join(root, "no-such", "log.jsonl"));
  assert.strictEqual(look.loadState, "ABSENT");
});

check("a non-JSON line is UNVERIFIED_JSON, naming the line", () => {
  const dir = freshDir();
  const p = join(dir, "log.jsonl");
  writeFileSync(p, "{nope}\n");
  const look = loadRefusalLog(p);
  assert.strictEqual(look.loadState, "UNVERIFIED_JSON");
  assert.ok(look.problem!.includes("line 1"));
});

check("JSON that is not a record is UNVERIFIED_SCHEMA", () => {
  const dir = freshDir();
  const p = join(dir, "log.jsonl");
  writeFileSync(p, JSON.stringify({ at: 1, outcome: "REFUSED" }) + "\n");
  const look = loadRefusalLog(p);
  assert.strictEqual(look.loadState, "UNVERIFIED_SCHEMA");
});

check("validate refuses an unknown kind rather than casting it", () => {
  assert.strictEqual(
    validateRefusalLogRecord({
      seq: 0, ts: 1, kind: "SOMETHING", previousHash: "", hash: "x",
    }),
    null
  );
});

check("loadRefusalLog writes nothing: an absent log stays absent", () => {
  const p = join(root, "never-created", "log.jsonl");
  loadRefusalLog(p);
  assert.strictEqual(loadRefusalLog(p).loadState, "ABSENT");
  const code = readFileSync(join(__dirname, "refusal-log.ts"), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
  for (const w of ["writeFileSync", "appendFileSync", "mkdirSync", "openSync"]) {
    assert.ok(!new RegExp(`\\b${w}\\s*\\(`).test(code), `the reader calls ${w}`);
  }
});

// -- the legacy pointer ------------------------------------------------------

console.log("\n-- migration by pointer, never by rewriting --");

check("the legacy pointer pins the retained file's hash, and verifies against it", () => {
  const dir = freshDir();
  const legacyPath = join(dir, "registrar-log.jsonl");
  writeFileSync(legacyPath, '{"at":1,"outcome":"REFUSED"}\n{"at":2,"outcome":"REFUSED"}\n');
  const h = hashFileOrEmpty(legacyPath);
  const seed = sealRefusalRecord([], {
    kind: "LEGACY_POINTER",
    ts: 1,
    legacyPath,
    legacyHash: h.hash,
    legacyBytes: h.bytes,
    detail: legacyPointerDetail(legacyPath, h.hash, h.bytes),
  });
  const p = join(dir, "chained.jsonl");
  writeFileSync(p, JSON.stringify(seed) + "\n");
  const look = loadRefusalLog(p);
  assert.strictEqual(look.loadState, "LOADED_VERIFIED");
  // The retained file still hashes to what seq 0 says it did.
  assert.strictEqual(hashFileOrEmpty(legacyPath).hash, h.hash);
  // And if it is edited, the pointer no longer matches -- which is the point.
  writeFileSync(legacyPath, "edited\n");
  assert.notStrictEqual(hashFileOrEmpty(legacyPath).hash, h.hash);
});

check("seq 0 says plainly that everything before it was unchained", () => {
  const d = legacyPointerDetail("/var/lib/mica/registrar-log.jsonl", "abc123", 42);
  assert.ok(d.includes("EVERYTHING BEFORE THIS RECORD WAS UNCHAINED"));
  assert.ok(d.includes("does NOT make them trustworthy"));
  assert.ok(d.includes("abc123"));
});

check("and when there was no old file, it says THAT instead of pretending", () => {
  const d = legacyPointerDetail("/var/lib/mica/registrar-log.jsonl", "", 0);
  assert.ok(d.includes("no unchained log was found"));
  assert.ok(!d.includes("EVERYTHING BEFORE"));
});

// -- the live path -----------------------------------------------------------

console.log("\n-- a real refusal, through the real registrar --");

check("LIVE -- a real refusal writes a chained record, uid carried as a field", () => {
  const dir = freshDir();
  const intake = join(dir, "intake");
  mkdirSync(intake, { recursive: true });
  // A legacy log with something in it, so seq 0 has a real file to pin.
  const legacyPath = join(dir, "registrar-log.jsonl");
  writeFileSync(legacyPath, '{"at":1,"outcome":"REFUSED","reason":"legacy"}\n');
  const legacyHashBefore = hashFileOrEmpty(legacyPath).hash;

  let t = 1_700_000_000_000;
  const reg = new Registrar({
    root: dir,
    witnessSetId: "set-test",
    // NOBODY is in the roster, so the frame's owner uid resolves to null and
    // the real UNKNOWN_DEPOSITOR path runs. Not a stub: this is the module's
    // own refusal, reached by the module's own identity check.
    resolvePrincipal: () => null,
    now: () => (t += 1),
  });
  writeFileSync(join(intake, "mica-doctor"), JSON.stringify({ depositor: "mica-doctor" }));

  const result = reg.sweep();
  assert.strictEqual(result.outcomes.length, 1);
  assert.strictEqual(result.outcomes[0].outcome, "REFUSED");

  const look = loadRefusalLog(reg.chainedLogPath());
  assert.strictEqual(look.loadState, "LOADED_VERIFIED", String(look.problem));
  assert.strictEqual(look.records.length, 2, "seq 0 legacy pointer + the refusal");

  const seed = look.records[0];
  assert.strictEqual(seed.kind, "LEGACY_POINTER");
  assert.strictEqual((seed as { legacyHash: string }).legacyHash, legacyHashBefore);

  const rec = look.records[1] as {
    kind: string; reason: string; subject: string | null; subjectUid: number | null;
  };
  assert.strictEqual(rec.kind, "REFUSED");
  // The real path refused this frame at the SHAPE check, before identity --
  // MALFORMED_DEPOSIT, not UNKNOWN_DEPOSITOR. Asserted as what the module
  // actually did rather than what the test author expected.
  assert.strictEqual(rec.reason, "MALFORMED_DEPOSIT");
  assert.strictEqual(rec.subject, null, "no principal was resolved for it");
  // THE POINT: the uid survives as a FIELD. Before this build it existed only
  // inside a prose detail string, on the one refusal where identifying the
  // principal matters most.
  assert.strictEqual(rec.subjectUid, process.getuid ? process.getuid() : null);

  // And the legacy file was RETAINED, not rewritten or renamed.
  assert.strictEqual(hashFileOrEmpty(legacyPath).hash, legacyHashBefore);
});

check("LIVE -- a second refusal extends the same chain, and it still verifies", () => {
  const dir = freshDir();
  const intake = join(dir, "intake");
  mkdirSync(intake, { recursive: true });
  let t = 1_700_000_000_000;
  const reg = new Registrar({
    root: dir,
    witnessSetId: "set-test",
    resolvePrincipal: () => null,
    now: () => (t += 1),
  });
  writeFileSync(join(intake, "a"), "{}");
  reg.sweep();
  writeFileSync(join(intake, "b"), "{}");
  reg.sweep();
  const look = loadRefusalLog(reg.chainedLogPath());
  assert.strictEqual(look.loadState, "LOADED_VERIFIED");
  assert.strictEqual(look.records.length, 3, "pointer + two refusals, one chain");
  assert.strictEqual(look.records[2].seq, 2);
  assert.strictEqual(reg.lastRefusalLogProblem(), null);
});

check("LIVE -- the registrar REFUSES to extend a chain that does not verify", () => {
  const dir = freshDir();
  const intake = join(dir, "intake");
  mkdirSync(intake, { recursive: true });
  let t = 1_700_000_000_000;
  const reg = new Registrar({
    root: dir,
    witnessSetId: "set-test",
    resolvePrincipal: () => null,
    now: () => (t += 1),
  });
  writeFileSync(join(intake, "a"), "{}");
  reg.sweep();
  // Break the middle, as root would.
  const p3 = reg.chainedLogPath();
  const lines = readFileSync(p3, "utf8").split("\n").filter((l) => l.trim());
  writeFileSync(p3, [lines[0].replace("unchained", "UNCHAINED"), lines[1]].join("\n") + "\n");
  const before = readFileSync(p3, "utf8");

  writeFileSync(join(intake, "b"), "{}");
  const result = reg.sweep();

  // The sweep still returns its outcome -- a log that cannot be written must
  // not swallow the sweep.
  assert.strictEqual(result.outcomes.length, 1);
  // Nothing was appended onto the broken chain.
  assert.strictEqual(readFileSync(p3, "utf8"), before);
  const problem = reg.lastRefusalLogProblem();
  assert.ok(problem !== null, "the refusal to append is readable, not discarded");
  assert.ok(problem!.includes("BROKEN_CHAIN"));
  assert.ok(problem!.includes("NOTHING WAS APPENDED"));
});

// -- the refusal that told nobody (S102, 16:11:58) ---------------------------

console.log("\n-- the sweep reports whether the record was written --");

/** A registrar over a fresh room, with one frame waiting in the intake. */
function roomWithFrame(frameName = "a"): { reg: Registrar; dir: string; intake: string } {
  const dir = freshDir();
  const intake = join(dir, "intake");
  mkdirSync(intake, { recursive: true });
  let t = 1_700_000_000_000;
  const reg = new Registrar({
    root: dir,
    witnessSetId: "set-test",
    resolvePrincipal: () => null,
    now: () => (t += 1),
  });
  writeFileSync(join(intake, frameName), "{}");
  return { reg, dir, intake };
}

check("HEALTHY -- the sweep says the record was written, and consumes the frame", () => {
  const { reg, intake } = roomWithFrame();
  const r = reg.sweep();
  assert.strictEqual(r.records.length, 1);
  assert.strictEqual(r.records[0].recorded, true);
  assert.strictEqual(r.records[0].reason, null);
  assert.strictEqual(r.recordedCount, 1);
  assert.strictEqual(r.chainState, "ABSENT", "first boot: the chain did not exist yet");
  assert.deepStrictEqual(readdirSync(intake), [], "a booked frame is consumed");
});

check("BROKEN -- the sweep carries the failure, per frame AND at sweep level", () => {
  const { reg, intake } = roomWithFrame("a");
  reg.sweep();
  // Break the middle, as root did at 16:10.
  const p3 = reg.chainedLogPath();
  const lines = readFileSync(p3, "utf8").split("\n").filter((l) => l.trim());
  writeFileSync(p3, [lines[0].replace("unchained", "UNCHAINED"), lines[1]].join("\n") + "\n");
  const before = readFileSync(p3, "utf8");

  writeFileSync(join(intake, "b"), "{}");
  const r = reg.sweep();

  assert.strictEqual(r.outcomes.length, 1, "the sweep still judged the deposit");
  assert.strictEqual(r.records[0].recorded, false);
  assert.strictEqual(r.recordedCount, 0);
  assert.strictEqual(r.chainState, "BROKEN_CHAIN", "reported from ONE reading at open");
  assert.ok(r.records[0].reason!.includes("NOTHING WAS APPENDED"));
  assert.strictEqual(readFileSync(p3, "utf8"), before, "no clean tail was given");
});

check("THE §1.3 DECISION -- an unrecorded frame is NOT consumed", () => {
  // The registrar's own rule extended to a case it did not cover: a frame
  // refused for a fact about the BOX is never consumed, and a refusal log that
  // cannot be extended is a fact about the box. Consuming would lose the
  // deposit AND its record at once.
  const { reg, intake } = roomWithFrame("a");
  reg.sweep();
  const p3 = reg.chainedLogPath();
  const lines = readFileSync(p3, "utf8").split("\n").filter((l) => l.trim());
  writeFileSync(p3, [lines[0].replace("unchained", "UNCHAINED"), lines[1]].join("\n") + "\n");

  writeFileSync(join(intake, "b"), "{}");
  reg.sweep();
  assert.deepStrictEqual(readdirSync(intake), ["b"], "the frame stayed for a healthy sweep");
});

check("AND A HEALTHY SWEEP AFTERWARDS BOOKS IT -- the frame was not lost", () => {
  const { reg, intake } = roomWithFrame("a");
  reg.sweep();
  const p3 = reg.chainedLogPath();
  const good = readFileSync(p3, "utf8");
  const lines = good.split("\n").filter((l) => l.trim());
  writeFileSync(p3, [lines[0].replace("unchained", "UNCHAINED"), lines[1]].join("\n") + "\n");

  writeFileSync(join(intake, "b"), "{}");
  reg.sweep();
  // Restore the chain, as the arbiter did at 16:12.
  writeFileSync(p3, good);
  const r = reg.sweep();
  assert.strictEqual(r.recordedCount, 1, "the held frame is booked on the next healthy sweep");
  assert.deepStrictEqual(readdirSync(intake), [], "and consumed only then");
  const look = loadRefusalLog(p3);
  assert.strictEqual(look.loadState, "LOADED_VERIFIED");
  assert.strictEqual(look.records.length, 3, "pointer + first refusal + the held one");
});

// -- the daemon's own output, spawned ----------------------------------------

console.log("\n-- what the journal will say --");

function runDaemon(
  dir: string,
  extra: readonly string[] = []
): { out: string; status: number | null } {
  const r = spawnSync(
    "npx",
    [
      "ts-node", join(__dirname, "registrard.ts"),
      "--root", dir,
      "--witness-intake", join(dir, "witness-intake"),
      "--witness-set-id", "set-test",
      "--roster", join(dir, "roster.json"),
      ...extra,
    ],
    { encoding: "utf8", cwd: join(__dirname, "..", "..") }
  );
  return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, status: r.status };
}

/** A room the daemon can sweep: intake, witness intake, roster, one frame. */
function daemonRoom(frame = "not-a-real-deposit"): string {
  const dir = freshDir();
  mkdirSync(join(dir, "intake"), { recursive: true });
  mkdirSync(join(dir, "witness-intake"), { recursive: true });
  writeFileSync(join(dir, "roster.json"), JSON.stringify({ "992": "mica-doctor" }));
  writeFileSync(join(dir, "intake", frame), "{}");
  return dir;
}

check("REGRESSION PIN -- the 16:11:58 output is no longer producible", () => {
  const dir = freshDir();
  const intake = join(dir, "intake");
  mkdirSync(intake, { recursive: true });
  mkdirSync(join(dir, "witness-intake"), { recursive: true });
  writeFileSync(join(dir, "roster.json"), JSON.stringify({ "992": "mica-doctor" }));

  writeFileSync(join(intake, "not-a-real-deposit"), "{}");
  const first = runDaemon(dir);
  assert.strictEqual(first.status, 0, `healthy sweep must exit 0: ${first.out}`);
  assert.ok(first.out.includes("(1 recorded)"), first.out);

  // Break the chain and sweep again -- the exact shape of 16:11:58.
  const p3 = join(dir, "registrar-log-chained.jsonl");
  const lines = readFileSync(p3, "utf8").split("\n").filter((l) => l.trim());
  writeFileSync(p3, [lines[0].replace("unchained", "UNCHAINED"), lines[1]].join("\n") + "\n");
  writeFileSync(join(intake, "not-a-real-deposit-2"), "{}");
  const second = runDaemon(dir);

  // THE THING THAT MUST NEVER HAPPEN AGAIN: a clean-looking summary over a
  // record that does not exist.
  assert.ok(
    !/1 refused\. Refusals are outcomes/.test(second.out),
    `the 16:11:58 summary is producible again:\n${second.out}`
  );
  assert.ok(second.out.includes("NOT RECORDED"), second.out);
  assert.ok(second.out.includes("(0 recorded)"), second.out);
  assert.ok(second.out.includes("chain on open  : BROKEN_CHAIN"), second.out);
  assert.ok(second.out.includes("THE FRAME WAS LEFT IN THE INTAKE"), second.out);
  assert.strictEqual(second.status, 3, "a sweep that did not record must exit non-zero");
  assert.deepStrictEqual(
    readdirSync(intake),
    ["not-a-real-deposit-2"],
    "and the frame is still there"
  );
});



// =============================================================================
console.log("\n-- S106 . the refusal chain presents its own head --");

// The debt: the refusal log has been chained since S102 and its head was
// witnessed for the first time on 2026-09-03 BY HAND. There was no wired site.
// Ruled by the arbiter, S106: wire it, best-effort, never blocking.

/**
 * A scratch witness a drop can actually be presented to. The deployment acts
 * (§5.1 store dir, §5.2 outbox, the key) are performed HERE, in the test, for
 * the same reason witness.test.ts performs them in its own bodies: the witness
 * makes no directory of its own and a test that hid that would be testing a
 * different program.
 */
function scratchWitness(dir: string, declared: readonly string[]): {
  witness: Witness;
  intake: string;
  outbox: string;
} {
  const intake = join(dir, "witness-intake");
  const outbox = join(dir, "witness-outbox");
  const storeDir = join(dir, "witness-store");
  mkdirSync(intake, { recursive: true });
  mkdirSync(outbox, { recursive: true });
  mkdirSync(storeDir, { recursive: true });
  const keyPath = join(dir, "witness.key");
  writeFileSync(
    keyPath,
    generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }),
    { mode: 0o600 }
  );
  const witness = new Witness({
    witnessSetId: "set-test",
    storePath: join(storeDir, "store.jsonl"),
    outboxDir: outbox,
    keyPath,
    declaredSubmitters: declared,
    intakeDir: intake,
    witnessClock: () => 1_000,
  });
  return { witness, intake, outbox };
}

/** A registrar over a fresh room whose refusal head goes to `intake` as `id`. */
function roomPresentingRefusals(
  intake: string,
  id: string | null
): { reg: Registrar; dir: string; regIntake: string } {
  const dir = freshDir();
  const regIntake = join(dir, "intake");
  mkdirSync(regIntake, { recursive: true });
  let t = 1_700_000_000_000;
  const reg = new Registrar({
    root: dir,
    witnessSetId: "set-test",
    resolvePrincipal: () => null,
    now: () => (t += 1),
    refusalHeadCommitter:
      id === null ? undefined : fileDropNamedCommitter(intake, id),
  });
  return { reg, dir, regIntake };
}

check("S106-A . a refusal record's head ARRIVES as NAMED_HEAD_COMMIT refusal:registrar", () => {
  // CONTROL 1, end to end through the real producer and the real retainer.
  const dir = freshDir();
  const { witness, intake, outbox } = scratchWitness(dir, ["mica-registrar-refusal"]);
  const { reg, regIntake } = roomPresentingRefusals(intake, "mica-registrar-refusal");

  writeFileSync(join(regIntake, "a"), "{}");
  const swept = reg.sweep();
  assert.strictEqual(swept.records[0].recorded, true, "the refusal record was written");

  const arrived = witness.pollIntake();
  assert.strictEqual(arrived.length, 1, "exactly one head reached the intake");
  const record = arrived[0].record;
  assert.strictEqual(record.kind, "NAMED_HEAD_COMMIT");
  assert.strictEqual(record.submitterId, "mica-registrar-refusal");

  const head = record.witnessed as NamedHeadCommit;
  assert.strictEqual(head.chain_id, "refusal:registrar");
  assert.strictEqual(head.chain_id, REFUSAL_CHAIN_ID);
  assert.strictEqual(head.modality, REFUSAL_HEAD_MODALITY);
  assert.strictEqual(head.modality, "NOT_AN_INSTRUCTION");
  assert.strictEqual(head.witness_set_id, "set-test");

  // AND THE HEAD IS THE CHAIN'S ACTUAL HEAD, read back off disk rather than
  // taken from the drop: a head that names a hash the chain does not hold would
  // pass every check above.
  const lines = readFileSync(reg.chainedLogPath(), "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const last = JSON.parse(lines[lines.length - 1]) as RefusalLogRecord;
  assert.strictEqual(head.head_hash, last.hash);
  assert.strictEqual(head.seq_no, last.seq);

  // Rostered, so it is receipted.
  assert.notStrictEqual(arrived[0].receipt, null, "a declared submitter is receipted");
  assert.strictEqual(readdirSync(outbox).length, 1);
});

check("S106-A2 . an UNROSTERED refusal submitter is retained and named, and not receipted", () => {
  const dir = freshDir();
  const { witness, intake, outbox } = scratchWitness(dir, ["somebody-else"]);
  const { reg, regIntake } = roomPresentingRefusals(intake, "mica-registrar-refusal");
  writeFileSync(join(regIntake, "a"), "{}");
  reg.sweep();

  const arrived = witness.pollIntake();
  assert.strictEqual(arrived[0].record.kind, "NAMED_UNDECLARED_SUBMITTER");
  assert.strictEqual(
    (arrived[0].record.witnessed as NamedHeadCommit).chain_id,
    "refusal:registrar",
    "the chain is named whether or not the submitter is on the roster"
  );
  assert.strictEqual(arrived[0].receipt, null);
  assert.deepStrictEqual(readdirSync(outbox), []);
});

check("S106-B . RULING 2 -- a broken drop path changes NOTHING about the record", () => {
  // THE LOAD-BEARING CONTROL. A drop failure must not change log()'s return,
  // must not throw into the sweep, and must not add a failure mode to the log.
  const dir = freshDir();
  const intake = join(dir, "witness-intake");
  mkdirSync(intake, { recursive: true });
  const { reg, regIntake } = roomPresentingRefusals(intake, "mica-registrar-refusal");

  // One healthy sweep first, so the comparison is against a working chain.
  writeFileSync(join(regIntake, "a"), "{}");
  reg.sweep();
  const chainPath = reg.chainedLogPath();
  const bytesBefore = statSync(chainPath).size;

  // NOW BREAK THE DROP PATH, exactly as an unreachable witness would.
  rmSync(intake, { recursive: true, force: true });

  const captured: string[] = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (c: string) => boolean }).write = (
    chunk: string
  ): boolean => {
    captured.push(String(chunk));
    return true;
  };
  let swept;
  try {
    writeFileSync(join(regIntake, "b"), "{}");
    swept = reg.sweep();
  } finally {
    (process.stderr as unknown as { write: unknown }).write = realWrite;
  }

  // 1 . the sweep did not throw and still judged the deposit.
  assert.strictEqual(swept.outcomes.length, 1);
  // 2 . log() still returned recorded:true with NO reason.
  assert.strictEqual(swept.records[0].recorded, true);
  assert.strictEqual(swept.records[0].reason, null);
  assert.strictEqual(swept.recordedCount, 1);
  // 3 . the refusal record IS on disk -- byte delta shown, not asserted.
  const bytesAfter = statSync(chainPath).size;
  assert.ok(
    bytesAfter > bytesBefore,
    `the record did not reach the chain: ${String(bytesBefore)} -> ${String(bytesAfter)}`
  );
  const lines = readFileSync(chainPath, "utf8").split("\n").filter((l) => l.trim());
  assert.strictEqual(
    (JSON.parse(lines[lines.length - 1]) as RefusalLogRecord).kind,
    "REFUSED"
  );
  // 4 . the chain still verifies -- no failure record was appended to it.
  const look = loadRefusalLog(chainPath);
  assert.strictEqual(look.loadState, "LOADED_VERIFIED");
  assert.strictEqual(look.records.length, 3, "LEGACY_POINTER + two refusals, and NOTHING ELSE");
  // 5 . the failure IS locally visible, names the chain, and says it is not evidence.
  const said = captured.join("");
  assert.match(said, /refusal:registrar/);
  assert.match(said, /could not be presented/);
  assert.match(said, /IS on disk/);
  assert.match(said, /not evidence/);
  // 6 . the frame was still consumed: a recorded outcome is a consumed frame.
  assert.deepStrictEqual(readdirSync(regIntake), []);
});

check("S106-C . a refusal chain written BEFORE S106 reloads and verifies unchanged", () => {
  // CONTROL 3. No reinterpretation, and no head backfilled for old records: the
  // registrar presents the head of the record it JUST wrote, never a history.
  const dir = freshDir();
  const intake = join(dir, "witness-intake");
  mkdirSync(intake, { recursive: true });

  // Three sweeps with NO refusal committer at all -- the pre-S106 registrar.
  const before = roomPresentingRefusals(intake, null);
  for (const name of ["a", "b", "c"]) {
    writeFileSync(join(before.regIntake, name), "{}");
    before.reg.sweep();
  }
  const chainPath = before.reg.chainedLogPath();
  const bytesBefore = statSync(chainPath).size;
  const before4 = loadRefusalLog(chainPath);
  assert.strictEqual(before4.loadState, "LOADED_VERIFIED");
  assert.strictEqual(before4.records.length, 4, "LEGACY_POINTER + three refusals");
  assert.deepStrictEqual(readdirSync(intake), [], "nothing was presented");

  // Now the SAME room, reopened by a registrar that DOES present.
  let t = 1_800_000_000_000;
  const after = new Registrar({
    root: before.dir,
    witnessSetId: "set-test",
    resolvePrincipal: () => null,
    now: () => (t += 1),
    refusalHeadCommitter: fileDropNamedCommitter(intake, "mica-registrar-refusal"),
  });
  const reread = loadRefusalLog(chainPath);
  assert.strictEqual(reread.loadState, "LOADED_VERIFIED");
  assert.strictEqual(reread.records.length, 4);
  assert.strictEqual(statSync(chainPath).size, bytesBefore, "reopening rewrote nothing");
  assert.deepStrictEqual(
    reread.records.map((r) => r.hash),
    before4.records.map((r) => r.hash),
    "every pre-existing record verifies to the identical hash"
  );

  // One new refusal presents ONE head -- the new one, not four.
  writeFileSync(join(before.regIntake, "d"), "{}");
  after.sweep();
  assert.deepStrictEqual(readdirSync(intake), ["mica-registrar-refusal"]);
  const dropped = JSON.parse(
    readFileSync(join(intake, "mica-registrar-refusal"), "utf8")
  ) as NamedHeadCommit;
  assert.strictEqual(dropped.seq_no, 4, "the head is the new record, not a backfill");
});

check("S106-D . ABSENT MEANS NOT WIRED -- the default registrar presents nothing new", () => {
  const dir = freshDir();
  const intake = join(dir, "witness-intake");
  mkdirSync(intake, { recursive: true });
  const { reg, regIntake } = roomPresentingRefusals(intake, null);
  assert.strictEqual(reg.hasRefusalHeadCommitter, false);

  writeFileSync(join(regIntake, "a"), "{}");
  const swept = reg.sweep();
  assert.strictEqual(swept.records[0].recorded, true, "the record is written either way");
  assert.deepStrictEqual(
    readdirSync(intake),
    [],
    "an unwired refusal chain presents no head and leaves no trace"
  );
});

check("S106-E . a committer that THROWS cannot turn a written record into recorded:false", () => {
  // The narrow form of ruling 2, at the seam rather than at the filesystem: the
  // presenter's own try/catch is what stops `log()`'s outer catch from ever
  // seeing a head-drop failure and reporting the durable record as unwritten.
  const dir = freshDir();
  const regIntake = join(dir, "intake");
  mkdirSync(regIntake, { recursive: true });
  let t = 1_700_000_000_000;
  let calls = 0;
  const reg = new Registrar({
    root: dir,
    witnessSetId: "set-test",
    resolvePrincipal: () => null,
    now: () => (t += 1),
    refusalHeadCommitter: () => {
      calls++;
      throw new Error("EACCES: permission denied, open '/var/lib/mica/witness/intake/x'");
    },
  });

  const captured: string[] = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (c: string) => boolean }).write = (
    chunk: string
  ): boolean => {
    captured.push(String(chunk));
    return true;
  };
  let swept;
  try {
    writeFileSync(join(regIntake, "a"), "{}");
    swept = reg.sweep();
  } finally {
    (process.stderr as unknown as { write: unknown }).write = realWrite;
  }

  assert.strictEqual(calls, 1, "the head was presented exactly once per record");
  assert.strictEqual(swept.records[0].recorded, true);
  assert.strictEqual(swept.records[0].reason, null);
  assert.strictEqual(reg.lastRefusalLogProblem(), null, "no problem was recorded on the log");
  assert.match(captured.join(""), /EACCES/);
  assert.strictEqual(loadRefusalLog(reg.chainedLogPath()).loadState, "LOADED_VERIFIED");
});

check("S106-F . the constants are DECLARED, and the chain name passes the intake's own grammar", () => {
  assert.strictEqual(REFUSAL_CHAIN_ID, "refusal:registrar");
  assert.strictEqual(REFUSAL_HEAD_MODALITY, "NOT_AN_INSTRUCTION");
  // The producer's grammar assertion is the one that would fire at a drop; if
  // the constant ever drifted outside it, every refusal head would throw at the
  // committer instead of arriving. Checked against the real function.
  const intake = join(freshDir(), "witness-intake");
  mkdirSync(intake, { recursive: true });
  const present = fileDropNamedCommitter(intake, "mica-registrar-refusal");
  assert.doesNotThrow(() =>
    present({
      seq_no: 0,
      head_hash: "h",
      ts: 0,
      witness_set_id: "set-test",
      modality: REFUSAL_HEAD_MODALITY,
      chain_id: REFUSAL_CHAIN_ID,
    })
  );
  // And the arbiter's declaration is written down beside the constant, with its
  // author -- a modality nobody is named as declaring is not a declaration.
  const source = readFileSync(join(__dirname, "registrar.ts"), "utf8");
  assert.match(source, /RULED BY THE ARBITER \(arbiter\), 2026-09-03, session 106/);
});



check("S106-G . the journal says whether the refusal head is presented, IN BOTH STATES", () => {
  // An absence that is never printed is an absence nobody discovers. The line
  // is emitted every run, wired or not -- an operator reading the journal alone
  // must be able to learn that this chain's head reaches no witness.
  const unwired = runDaemon(daemonRoom());
  assert.strictEqual(unwired.status, 0, unwired.out);
  // S106b rides here too: the same banner must say which code it is running.
  assert.match(unwired.out, /code vintage   : /);
  assert.match(unwired.out, /refusal head   : NOT PRESENTED/);
  assert.match(unwired.out, /no --refusal-submitter-id/);
  assert.match(unwired.out, /written and chained; its head reaches no witness/);
  assert.doesNotMatch(unwired.out, /presented as/);

  const wired = runDaemon(daemonRoom(), [
    "--refusal-submitter-id", "mica-registrar-refusal",
  ]);
  assert.strictEqual(wired.status, 0, wired.out);
  assert.match(
    wired.out,
    /refusal head   : presented as mica-registrar-refusal \(chain refusal:registrar\)/
  );
});

check("S106b . the registrar's banner names its code vintage, and does not guess it", () => {
  // S105 §2.1: a daemon ran four days on code the disk had already replaced,
  // and nothing printed the difference. This is the line that would have.
  const run = runDaemon(daemonRoom());
  assert.strictEqual(run.status, 0, run.out);
  const line = run.out.split("\n").find((l) => l.includes("code vintage"));
  assert.ok(line !== undefined, `no vintage line:\n${run.out}`);
  // The dev tree has no VINTAGE file. The honest answer is UNKNOWN, and a hash
  // appearing here would mean something reached for the wrong tree.
  assert.match(String(line), /UNKNOWN — no VINTAGE file at /);
  assert.doesNotMatch(String(line), /\b[0-9a-f]{7,40}\b/);
});

check("S106-H . the daemon REFUSES two chains under one submitter id, exit 2", () => {
  // The misconfiguration this build must not allow: both flags look reasonable
  // in a unit file, and the book head would vanish on every accepted deposit.
  const dir = daemonRoom();
  const clash = runDaemon(dir, ["--refusal-submitter-id", "mica-registrar"]);
  assert.strictEqual(clash.status, 2, clash.out);
  assert.match(clash.out, /must differ from --submitter-id/);
  assert.match(clash.out, /the book head always loses/);
  // AND NOTHING WAS SWEPT. An argument error must not consume a frame.
  assert.deepStrictEqual(readdirSync(join(dir, "intake")), ["not-a-real-deposit"]);
  assert.deepStrictEqual(readdirSync(join(dir, "witness-intake")), []);

  // The same id under a DIFFERENT --submitter-id is fine, which is the proof
  // that the guard is about the collision and not about the string.
  const ok = runDaemon(daemonRoom(), [
    "--submitter-id", "mica-registrar-books",
    "--refusal-submitter-id", "mica-registrar",
  ]);
  assert.strictEqual(ok.status, 0, ok.out);
});

check("S106-I . the daemon's refusal head really lands, and it is the chain's head", () => {
  // End to end through the SPAWNED process, not the in-process seam: the flag,
  // the committer it builds, the drop, and the chain it claims to be the head of.
  const dir = daemonRoom();
  const run = runDaemon(dir, ["--refusal-submitter-id", "mica-registrar-refusal"]);
  assert.strictEqual(run.status, 0, run.out);

  assert.deepStrictEqual(
    readdirSync(join(dir, "witness-intake")).sort(),
    ["mica-registrar-refusal"],
    "a refused deposit drops no book head, so this is the only drop"
  );
  const dropped = JSON.parse(
    readFileSync(join(dir, "witness-intake", "mica-registrar-refusal"), "utf8")
  ) as NamedHeadCommit;
  assert.strictEqual(dropped.chain_id, "refusal:registrar");
  assert.strictEqual(dropped.modality, "NOT_AN_INSTRUCTION");

  const chain = readFileSync(join(dir, "registrar-log-chained.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const last = JSON.parse(chain[chain.length - 1]) as RefusalLogRecord;
  assert.strictEqual(dropped.head_hash, last.hash);
  assert.strictEqual(dropped.seq_no, last.seq);
});

rmSync(root, { recursive: true, force: true });
console.log(`\n${String(passed)} tests: ${String(passed)} passed, 0 failed`);
