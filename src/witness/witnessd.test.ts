// ── MICA · the witness INVOKER — producer, daemon, and the wire between ──────
//
// The channel was built at both ends and wired at neither: `pollIntake` had one
// caller in the whole repository (a test), and nothing anywhere wrote a file
// into an intake directory. These are the acceptance tests for the two ends and
// for the two properties that make the channel safe to run unattended — an
// atomic producer, and a consumer that cannot be wedged by one bad drop.

import assert from "assert";
import { spawnSync } from "child_process";
import { generateKeyPairSync } from "crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { durableLineAppender } from "../mica/store/append-store";
// THE DUPLICATION'S ASSERTION LIVES HERE, and it has to. The closure ruling of
// 2026-08-12 bars everything under `src/mica/` from importing outside itself, so
// `floor-trail.test.ts` cannot reach `./drop-committer` to compare against. This
// file is under `src/witness/` and can import BOTH — it is the only place in the
// repository where the two producers can be put side by side.
import {
  canonicalHeadDropBytes,
  fileDropHeadCommitter,
  MODALITIES as FLOOR_TRAIL_MODALITIES,
} from "../mica/chokepoint/floor-trail";
import { MODALITIES as NOTIFY_MODALITIES } from "../mica/notify/types";
import { MODALITIES as ARBITER_MODALITIES } from "../arbiter/ruling-log";
import { MODALITIES } from "./types";
import {
  canonicalDropBytes,
  canonicalNamedDropBytes,
  DROP_FILE_MODE,
  DROP_HEAD_KEYS,
  NAMED_DROP_HEAD_KEYS,
  fileDropCommitter,
} from "./drop-committer";
import { Witness } from "./witness";
import type { HeadCommit, Modality, NamedHeadCommit } from "./types";
import {
  loadDeclared,
  missingRequired,
  parseArgs,
  printBanner,
  startWitnessDaemon,
  startTicking,
  sweepOrFail,
  summariseSweep,
  WITNESSD_ANSWERS_NO_READS,
  WITNESSD_SAYS_ONE_THING,
} from "./witnessd";

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

const root = mkdtempSync(join(tmpdir(), "mica-witnessd-"));
let counter = 0;
const keys = generateKeyPairSync("ed25519");

interface Scratch {
  base: string;
  storePath: string;
  intakeDir: string;
  outboxDir: string;
  keyPath: string;
}

function scratch(stem: string): Scratch {
  const base = join(root, `${stem}-${counter++}`);
  const intakeDir = join(base, "intake");
  mkdirSync(intakeDir, { recursive: true });
  const keyPath = join(base, "witness-private.pem");
  writeFileSync(keyPath, keys.privateKey.export({ format: "pem", type: "pkcs8" }), {
    mode: 0o600,
  });
  return {
    base,
    storePath: join(base, "witness.jsonl"),
    intakeDir,
    outboxDir: join(base, "outbox"),
    keyPath,
  };
}

/**
 * The deployment act of recipe §5.2, rendered in a test.
 *
 * Since S96 the witness does not create its own outbox (see `witness.ts`, the
 * comment where the `mkdirSync` used to be). `scratch()` already models a
 * deployer who performed §5.3 by creating the intake; a test that expects a
 * RECEIPT must model one who performed §5.2 as well. It is NOT in `scratch()`
 * because WD-L asserts the outbox is never created when no receipt is written,
 * and that assertion is worth keeping true.
 */
function deployOutbox(s: Scratch): void {
  mkdirSync(s.outboxDir, { recursive: true });
}

function head(
  seq = 7,
  hash = "head-7",
  ts = 700,
  modality: Modality = "OFFERED"
): HeadCommit {
  return { seq_no: seq, head_hash: hash, ts, witness_set_id: "set-alpha", modality };
}

function namedHead(
  seq = 7,
  hash = "head-7",
  ts = 700,
  chainId = "precommit:mica-doctor",
  modality: Modality = "OFFERED"
): NamedHeadCommit {
  return {
    seq_no: seq,
    head_hash: hash,
    ts,
    witness_set_id: "set-alpha",
    modality,
    chain_id: chainId,
  };
}

function storedRecords(storePath: string): { seq: number; kind: string; submitterId: string }[] {
  return readFileSync(storePath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { seq: number; kind: string; submitterId: string });
}

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the drop committer · the producer end ─────────────────────");

check("DC-A · the drop carries exactly the five HEAD_KEYS, in order, and no sixth", () => {
  // S88: the frozen set went from four keys to five on 2026-08-26 (`modality`
  // joined S-4 §4). The claim is unchanged — the drop carries the frozen set and
  // nothing else — only the size of the set moved.
  const bytes = canonicalDropBytes({
    ...head(3, "h3", 33),
    // A caller's object may carry more. The intake's validator is
    // hasExactKeys(HEAD_KEYS), so an EXTRA key that reached the file would be a
    // MALFORMED_SUBMISSION at the far end — an accusation earned by nobody.
    extra: "must not reach the intake",
  } as unknown as HeadCommit);

  assert.strictEqual(
    bytes,
    '{"seq_no":3,"head_hash":"h3","ts":33,"witness_set_id":"set-alpha",' +
      '"modality":"OFFERED"}'
  );
  assert.deepStrictEqual(Object.keys(JSON.parse(bytes)), [...DROP_HEAD_KEYS]);
  assert.deepStrictEqual([...DROP_HEAD_KEYS], [
    "seq_no",
    "head_hash",
    "ts",
    "witness_set_id",
    "modality",
  ]);
});

check("DC-A1 · the NAMED drop carries exactly the six keys, in order, and no seventh", () => {
  // S105: `chain_id` joined the head a submitter presents on 2026-09-03. The
  // claim is the same claim DC-A makes one shape down, and it is written out
  // again rather than parameterised: two frozen shapes are two contracts, and a
  // loop over both would let an edit to one quietly re-state the other.
  const bytes = canonicalNamedDropBytes({
    ...namedHead(3, "h3", 33, "precommit:book-a"),
    extra: "must not reach the intake",
  } as unknown as NamedHeadCommit);

  assert.strictEqual(
    bytes,
    '{"seq_no":3,"head_hash":"h3","ts":33,"witness_set_id":"set-alpha",' +
      '"modality":"OFFERED","chain_id":"precommit:book-a"}'
  );
  assert.deepStrictEqual(Object.keys(JSON.parse(bytes)), [...NAMED_DROP_HEAD_KEYS]);
  assert.deepStrictEqual([...NAMED_DROP_HEAD_KEYS], [
    "seq_no",
    "head_hash",
    "ts",
    "witness_set_id",
    "modality",
    "chain_id",
  ]);
  // THE NAMED SHAPE IS THE FIVE-KEY SHAPE PLUS ONE, and `chain_id` is LAST in
  // both the drop and the witness preimage. Neither ordering is cosmetic: the
  // preimage is space-joined, and `chain_id`'s neighbours there are the two
  // fields that cannot hold a space.
  assert.deepStrictEqual(
    [...NAMED_DROP_HEAD_KEYS].slice(0, DROP_HEAD_KEYS.length),
    [...DROP_HEAD_KEYS]
  );
  assert.strictEqual(NAMED_DROP_HEAD_KEYS[NAMED_DROP_HEAD_KEYS.length - 1], "chain_id");
});

check("DC-A2 · every SUBMITTER spells the modality enum exactly as the retainer does", () => {
  // THE ONE PLACE IN THIS REPOSITORY THAT MAY HOLD ALL FOUR LISTS. Every book
  // declares its own `Modality` — the coupling bar forbids importing a
  // sibling's — and a divergence in any one of them would not fail to compile.
  // It would ship: that book's drops would land at the intake as
  // MALFORMED_SUBMISSION, permanently, against a submitter that did nothing
  // wrong. So the equality is asserted here, where all four can be imported.
  assert.deepStrictEqual([...FLOOR_TRAIL_MODALITIES], [...MODALITIES]);
  assert.deepStrictEqual([...NOTIFY_MODALITIES], [...MODALITIES]);
  assert.deepStrictEqual([...ARBITER_MODALITIES], [...MODALITIES]);
  assert.deepStrictEqual([...MODALITIES], ["OFFERED", "IMPOSED", "NOT_AN_INSTRUCTION"]);
});

check("DC-B · the write is ATOMIC: the destination holds the OLD drop or the NEW one, never a half", () => {
  const s = scratch("dc-atomic");
  const target = join(s.intakeDir, "mica-node");
  writeFileSync(target, canonicalDropBytes(head(1, "old-head", 1)), "utf8");

  // Standing INSIDE the instant of replacement — the only place the property
  // can actually be observed. If the producer ever truncated in place, the
  // destination here would already be short or empty.
  let observed: { destination: string; frame: string } | null = null;
  const commit = fileDropCommitter(s.intakeDir, "mica-node", {
    rename: (from, to) => {
      observed = {
        destination: readFileSync(to, "utf8"),
        frame: readFileSync(from, "utf8"),
      };
      renameSync(from, to);
    },
    suffix: () => "fixed",
  });
  commit(head(2, "new-head", 2));

  assert.notStrictEqual(observed, null);
  const seen = observed as unknown as { destination: string; frame: string };
  assert.strictEqual(seen.destination, canonicalDropBytes(head(1, "old-head", 1)));
  assert.strictEqual(seen.frame, canonicalDropBytes(head(2, "new-head", 2)));
  assert.strictEqual(
    readFileSync(target, "utf8"),
    canonicalDropBytes(head(2, "new-head", 2))
  );
});

check("DC-C · the in-flight frame is DOT-PREFIXED, which is the whole of RULING A's contract", () => {
  const s = scratch("dc-frame-name");
  const names: string[] = [];
  const commit = fileDropCommitter(s.intakeDir, "mica-node", {
    rename: (from, to) => {
      names.push(from.slice(s.intakeDir.length + 1));
      renameSync(from, to);
    },
    suffix: () => "deadbeef",
  });
  commit(head());
  assert.deepStrictEqual(names, [".mica-node.deadbeef"]);
  // The sweep must not consume it, and this is the reason the name is shaped so.
  assert.ok(names[0].startsWith("."), "a frame that is not dotted IS a submission");
});

check("DC-D · the mode is 0640 EXPLICITLY, whatever the process umask is", () => {
  const s = scratch("dc-mode");
  const previous = process.umask(0o077);
  try {
    fileDropCommitter(s.intakeDir, "mica-node")(head());
  } finally {
    process.umask(previous);
  }
  // `writeFileSync`'s `mode` option is umask-masked and would have produced
  // 0600 here — a file the witness cannot read, which before this build wedged
  // its sweep permanently and silently. `chmodSync` is not masked.
  assert.strictEqual(
    statSync(join(s.intakeDir, "mica-node")).mode & 0o777,
    DROP_FILE_MODE
  );
});

check("DC-E · last-writer-wins onto its OWN previous drop, which is what a head IS", () => {
  const s = scratch("dc-lww");
  const commit = fileDropCommitter(s.intakeDir, "mica-node");
  commit(head(1, "h1", 1));
  commit(head(2, "h2", 2));
  commit(head(3, "h3", 3));

  // One file, not three. A later head at a later seq constrains a longer prefix
  // of the SAME chain; under a content drop this would be loss, under a head
  // commit it is the semantics working as stated.
  assert.deepStrictEqual(readdirSync(s.intakeDir), ["mica-node"]);
  assert.strictEqual(
    readFileSync(join(s.intakeDir, "mica-node"), "utf8"),
    canonicalDropBytes(head(3, "h3", 3))
  );
});

check("DC-F · a failed rename throws and leaves NO dotted litter behind", () => {
  const s = scratch("dc-rename-fails");
  const commit = fileDropCommitter(s.intakeDir, "mica-node", {
    rename: () => {
      throw new Error("disk full");
    },
    suffix: () => "abc",
  });
  assert.throws(() => commit(head()), /disk full/);

  // A dotted frame is invisible to the sweep, so a leaked one sits there
  // forever. The ORIGINAL error is the one that propagates, not the cleanup's.
  assert.deepStrictEqual(readdirSync(s.intakeDir), []);
});

check("DC-G · it does NOT create the intake directory — those permissions are a deployment act", () => {
  const s = scratch("dc-no-mkdir");
  const missing = join(s.base, "not-deployed");
  assert.throws(() => fileDropCommitter(missing, "mica-node")(head()), /ENOENT/);
  assert.strictEqual(existsSync(missing), false);
});

check("DC-H · END TO END: what the producer writes, the witness retains", () => {
  const s = scratch("dc-e2e");
  deployOutbox(s);
  fileDropCommitter(s.intakeDir, "mica-node")(head(9, "h9", 99));

  const witness = new Witness({
    witnessSetId: "set-alpha",
    storePath: s.storePath,
    outboxDir: s.outboxDir,
    keyPath: s.keyPath,
    declaredSubmitters: ["mica-node"],
    intakeDir: s.intakeDir,
  });
  const [result] = witness.pollIntake();
  assert.strictEqual(result.record.kind, "HEAD_COMMIT");
  assert.deepStrictEqual(result.record.witnessed, head(9, "h9", 99));
  assert.notStrictEqual(result.receipt, null);
  assert.deepStrictEqual(readdirSync(s.intakeDir), []);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── witnessd · arguments, roster, and the banner ──────────────");

check("DC-I · a submitter id that is not a bare filename is refused at CONSTRUCTION", () => {
  const s = scratch("dc-bare-name");
  for (const bad of ["", "../escape", "a/b", "a\\b", "..", "x/../../y"]) {
    assert.throws(
      () => fileDropCommitter(s.intakeDir, bad),
      /bare filename/,
      `accepted a submitter id that escapes the intake: ${JSON.stringify(bad)}`
    );
  }
  // It refuses BEFORE any commit, so a misconfigured deployment cannot come up
  // and then write outside the intake on its first head.
  assert.deepStrictEqual(readdirSync(s.intakeDir), []);
  // And a bare name is still fine.
  fileDropCommitter(s.intakeDir, "mica-node")(head());
  assert.deepStrictEqual(readdirSync(s.intakeDir), ["mica-node"]);
});

check("DC-J · the DUPLICATED producer in floor-trail.ts is byte-identical to this one", () => {
  const s = scratch("dc-duplication");
  // Not "equivalent". IDENTICAL BYTES, for the same input, including an input
  // carrying a key neither is allowed to pass on. If this ever fails, the defect
  // is in the DUPLICATE (src/mica/chokepoint/floor-trail.ts), never here: this
  // file is the asserting sibling and floor-trail's pointer comment says so.
  const cases: HeadCommit[] = [
    head(),
    head(0, "", 0),
    { seq_no: -1, head_hash: "genesis", ts: 0, witness_set_id: "", modality: "IMPOSED" },
    { ...head(5, "h5", 55), extra: "must not reach the intake" } as unknown as HeadCommit,
    {
      seq_no: 9,
      head_hash: 'quote"and\\slash',
      ts: 1.5,
      witness_set_id: "sét-ünicode",
      modality: "NOT_AN_INSTRUCTION",
    },
  ];
  for (const commit of cases) {
    assert.strictEqual(
      canonicalHeadDropBytes(commit),
      canonicalDropBytes(commit),
      `the two producers disagree on ${JSON.stringify(commit)}`
    );
  }

  // And the FILES they write agree too, not merely the serialisers — same bytes,
  // same mode, same single entry with no frame left behind.
  const a = join(s.base, "intake-witness");
  const b = join(s.base, "intake-floor");
  mkdirSync(a, { recursive: true });
  mkdirSync(b, { recursive: true });
  const commit = head(7, "h7", 77);
  fileDropCommitter(a, "same-id")(commit);
  fileDropHeadCommitter(b, "same-id")(commit);

  assert.deepStrictEqual(readdirSync(a), readdirSync(b));
  assert.strictEqual(
    readFileSync(join(a, "same-id"), "utf8"),
    readFileSync(join(b, "same-id"), "utf8")
  );
  assert.strictEqual(
    statSync(join(a, "same-id")).mode & 0o777,
    statSync(join(b, "same-id")).mode & 0o777
  );

  // AND THEY REFUSE A MISSING INTAKE IDENTICALLY. This was the last divergence
  // between the two bodies — floor-trail's created it, this one never did — and
  // it is cut (S86). Asserted on BOTH so it cannot come back on either side: an
  // intake's permissions are a deployment act, and a producer that conjures the
  // directory at the process umask hides a skipped deployment step behind a
  // green suite.
  const gone = join(s.base, "intake-that-was-never-deployed");
  assert.throws(() => fileDropCommitter(gone, "same-id")(commit), /ENOENT/);
  assert.strictEqual(existsSync(gone), false);
  assert.throws(() => fileDropHeadCommitter(gone, "same-id")(commit), /ENOENT/);
  assert.strictEqual(existsSync(gone), false);
});

check("WD-A · every path is required and NONE is guessed", () => {
  assert.deepStrictEqual(missingRequired(parseArgs([])), [
    "--store",
    "--intake",
    "--outbox",
    "--witness-set-id",
  ]);
  const s = scratch("wd-args");
  const full = parseArgs([
    "--store", s.storePath,
    "--intake", s.intakeDir,
    "--outbox", s.outboxDir,
    "--witness-set-id", "set-alpha",
    "--key", s.keyPath,
    "--tick-ms", "250",
    "--once",
  ]);
  assert.deepStrictEqual(missingRequired(full), []);
  assert.strictEqual(full.tickMs, 250);
  assert.strictEqual(full.once, true);
  assert.strictEqual(full.declared, null);
  // clerkd's precedent, kept: an unusable cadence falls back rather than
  // silently becoming zero and spinning the CPU.
  assert.strictEqual(parseArgs(["--tick-ms", "nonsense"]).tickMs, 1000);
  assert.strictEqual(parseArgs([]).tickMs, 1000);
});

check("WD-B · startWitnessDaemon refuses to invent a path", () => {
  assert.throws(
    () => startWitnessDaemon(parseArgs(["--store", "/tmp/x"])),
    /NO DEFAULT PATHS[\s\S]*--intake, --outbox, --witness-set-id/
  );
});

check("WD-C · ABSENT and CONFIGURED_EMPTY are different facts and stay different", () => {
  const s = scratch("wd-declared");
  assert.deepStrictEqual(loadDeclared(null), {
    state: "ABSENT",
    source: "none",
    ids: [],
    problems: [],
  });

  const good = join(s.base, "declared.json");
  writeFileSync(good, JSON.stringify(["mica-node", "other-node"]), "utf8");
  const loaded = loadDeclared(good);
  assert.strictEqual(loaded.state, "CONFIGURED");
  assert.deepStrictEqual([...loaded.ids], ["mica-node", "other-node"]);
  assert.deepStrictEqual([...loaded.problems], []);

  // The deployment ASKED for a declared list and did not get one. That must not
  // read the same as never having asked — the clerk roster's distinction,
  // kept, because the operational consequence is identical and the cause is not.
  const broken = join(s.base, "broken.json");
  writeFileSync(broken, "{not json", "utf8");
  assert.strictEqual(loadDeclared(broken).state, "CONFIGURED_EMPTY");
  assert.strictEqual(loadDeclared(broken).problems.length, 1);
  assert.strictEqual(loadDeclared(join(s.base, "absent.json")).state, "CONFIGURED_EMPTY");

  const wrongShape = join(s.base, "object.json");
  writeFileSync(wrongShape, JSON.stringify({ "mica-node": true }), "utf8");
  assert.strictEqual(loadDeclared(wrongShape).state, "CONFIGURED_EMPTY");

  const mixed = join(s.base, "mixed.json");
  writeFileSync(mixed, JSON.stringify(["mica-node", 7, ""]), "utf8");
  const partial = loadDeclared(mixed);
  assert.deepStrictEqual([...partial.ids], ["mica-node"]);
  assert.strictEqual(partial.problems.length, 2);
});

check("WD-D · the banner prints the four self-descriptions and the no-reads bound", () => {
  const s = scratch("wd-banner");
  const args = parseArgs([
    "--store", s.storePath,
    "--intake", s.intakeDir,
    "--outbox", s.outboxDir,
    "--witness-set-id", "set-alpha",
  ]);
  const running = startWitnessDaemon(args);
  const lines: string[] = [];
  const realLog = console.log;
  console.log = (...parts: unknown[]) => lines.push(parts.map(String).join(" "));
  try {
    printBanner(running, args);
  } finally {
    console.log = realLog;
  }
  const banner = lines.join("\n");
  for (const required of [
    "S-4 WITNESS",
    "THIS PROCESS ANSWERS NO READS",
    "Retention is not truth",
    "It cannot verify its own independence",
    s.storePath,
    "load state     : EMPTY",
    "declared       : ABSENT (0 submitter(s)",
    "EVERY SUBMISSION WILL RETAIN AS",
    // S106b: which code is this process EXECUTING. The dev tree carries no
    // VINTAGE file, so the honest answer here is the ABSENT branch — and a
    // banner that printed a hash anyway would be the defect, not the feature.
    "code vintage   : ",
  ]) {
    assert.ok(banner.includes(required), `banner is missing: ${required}\n${banner}`);
  }
});

check("WD-D2 · the vintage line NEVER guesses, and never stops the daemon", () => {
  // The line sits on the startup path. Its load-bearing property is not what it
  // says but that saying it cannot fail — and that when it does not know, it
  // says UNKNOWN rather than reaching for the dev tree's HEAD.
  const s = scratch("wd-vintage");
  const args = parseArgs([
    "--store", s.storePath,
    "--intake", s.intakeDir,
    "--outbox", s.outboxDir,
    "--witness-set-id", "set-alpha",
  ]);
  const running = startWitnessDaemon(args);
  const lines: string[] = [];
  const realLog = console.log;
  console.log = (...parts: unknown[]) => lines.push(parts.map(String).join(" "));
  try {
    assert.doesNotThrow(() => printBanner(running, args));
  } finally {
    console.log = realLog;
  }
  const vintage = lines.find((l) => l.includes("code vintage"));
  assert.ok(vintage !== undefined, "the banner printed no vintage line");
  assert.match(String(vintage), /code vintage   : UNKNOWN — no VINTAGE file at /);
  assert.match(String(vintage), /Nothing here guesses/);
  // The dev tree's HEAD must not appear anywhere in it, by construction.
  assert.doesNotMatch(String(vintage), /\b[0-9a-f]{7,40}\b/);
});

check("WD-E · the one sentence, and only the one sentence", () => {
  assert.ok(WITNESSD_SAYS_ONE_THING.includes("I certify nothing about any chain"));
  assert.ok(WITNESSD_SAYS_ONE_THING.includes("I answer no reads"));
  assert.ok(WITNESSD_ANSWERS_NO_READS.includes("no socket"));
});

check("WD-F · there is NO READER in this file, and the source says so", () => {
  const source = readFileSync(join(__dirname, "witnessd.ts"), "utf8");
  // S85 ruling, asserted at bytes rather than left to prose: witnessd serves no
  // socket and answers no read request. A guard on the SOURCE is the only kind
  // that fails when someone adds one.
  const structural = source
    .split("\n")
    .filter((line) => /^\s*(?:import\b|export\b|\}\s*from\b)/.test(line) || line.includes("require("))
    .join("\n");
  for (const banned of ['"net"', '"http"', '"https"', '"dgram"', '"tls"']) {
    assert.ok(!structural.includes(banned), `witnessd imports ${banned}`);
  }
  const code = source.replace(/^\s*\/\/.*$/gm, "");
  for (const banned of ["createServer", ".listen(", "readAll(", ".verify("]) {
    assert.ok(
      !code.includes(banned),
      `witnessd reached for \`${banned}\` — this process answers no reads`
    );
  }
});

check("WD-G · the sweep summary counts and states nothing else", () => {
  assert.strictEqual(summariseSweep([]), "0 drops consumed");
  const fake = (kind: string) =>
    ({ record: { kind }, receipt: null, receiptPath: null }) as never;
  assert.strictEqual(
    summariseSweep([fake("HEAD_COMMIT"), fake("HEAD_COMMIT"), fake("UNREADABLE_DROP")]),
    "3 drop(s) consumed — HEAD_COMMIT=2 UNREADABLE_DROP=1"
  );
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── witnessd · the sweep, and what it refuses to swallow ───────");

check("WD-H · one Witness per process means exactly ONE placement per start", () => {
  const s = scratch("wd-one-placement");
  const argv = [
    "--store", s.storePath,
    "--intake", s.intakeDir,
    "--outbox", s.outboxDir,
    "--witness-set-id", "set-alpha",
  ];
  startWitnessDaemon(parseArgs(argv));
  assert.deepStrictEqual(storedRecords(s.storePath).map((r) => r.kind), ["PLACEMENT"]);

  // A restart is a fact worth a record, and it gets exactly one more.
  startWitnessDaemon(parseArgs(argv));
  assert.deepStrictEqual(
    storedRecords(s.storePath).map((r) => r.kind),
    ["PLACEMENT", "PLACEMENT"]
  );
});

check("WD-I · an append that throws leaves the drop ON DISK and does not return", () => {
  const s = scratch("wd-append-throws");
  fileDropCommitter(s.intakeDir, "mica-node")(head());

  // The pen writes the construction PLACEMENT and then runs dry. Injected
  // through the class's own seam — there is no command-line flag for this and
  // there must not be.
  let writes = 0;
  const running = startWitnessDaemon(parseArgs([
    "--store", s.storePath,
    "--intake", s.intakeDir,
    "--outbox", s.outboxDir,
    "--witness-set-id", "set-alpha",
  ]), {
    appender: (path, line) => {
      if (writes++ === 0) return durableLineAppender(path, line);
      throw new Error("the pen ran dry");
    },
  });

  assert.throws(() => running.sweep(), /the pen ran dry/);

  // THE ORDERING INVARIANT, observed: read -> append -> remove. Nothing was
  // consumed unrecorded, and the submitter's drop is still there to be swept
  // again by whatever comes up next.
  assert.deepStrictEqual(readdirSync(s.intakeDir), ["mica-node"]);
  assert.deepStrictEqual(storedRecords(s.storePath).map((r) => r.kind), ["PLACEMENT"]);
});

check("WD-J · the tick body hands the throw ON — it never catches and continues", () => {
  const s = scratch("wd-tick-body");
  const running = startWitnessDaemon(parseArgs([
    "--store", s.storePath,
    "--intake", s.intakeDir,
    "--outbox", s.outboxDir,
    "--witness-set-id", "set-alpha",
  ]));

  // THE FAILURE C1 NAMED, and the one this must never become: a tick that
  // swallowed the throw would consume drops off the intake, retain nothing, and
  // leave a process that looks perfectly alive. `onFailure` is wired at the
  // entry point to print and exit non-zero; here it records, so the test can
  // see that it is reached at all.
  const failures: unknown[] = [];
  const broken = { ...running, sweep: () => { throw new Error("append refused"); } };
  sweepOrFail(broken, (error) => failures.push(error));
  assert.strictEqual(failures.length, 1);
  assert.ok(/append refused/.test(String(failures[0])));

  // A sweep that returns normally reaches no failure path at all.
  sweepOrFail(running, (error) => failures.push(error));
  assert.strictEqual(failures.length, 1);

  // The timer handle is real, and clearing it does not throw.
  const stop = startTicking(running, 1_000_000, () => undefined);
  stop();
});

// ══════════════════════════════════════════════════════════════════════════════
// THE REAL PROCESS. Everything above tests functions that RETURN; these test
// that the program actually EXITS with the code a deployment depends on.

console.log("\n── witnessd · the real process, spawned ──────────────────────");

const REPO_ROOT = resolve(__dirname, "..", "..");
const TS_NODE_BIN = join(REPO_ROOT, "node_modules", "ts-node", "dist", "bin.js");
const WITNESSD_ENTRY = join(REPO_ROOT, "src", "witness", "witnessd.ts");

/**
 * `-T` (transpile-only) for the CHILDREN, and the reason is worth stating: each
 * spawn otherwise pays a full type-check of the witness tree, which put this one
 * file at roughly a minute of the chained suite's wall clock. What these cases
 * exercise is PROCESS behaviour — exit codes, what is on disk afterwards, what
 * reached stderr — none of which a type-check can change. The types on this same
 * entry point are checked by `npm run typecheck` and by this file's own compile,
 * so nothing goes unchecked; it is checked once instead of six times.
 */
function spawnWitnessd(argv: readonly string[]): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync(process.execPath, [TS_NODE_BIN, "-T", WITNESSD_ENTRY, ...argv], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (r.error) throw r.error;
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

check("WD-K · `--once` consumes the intake, retains, writes a receipt, and exits 0", () => {
  const s = scratch("wd-once");
  deployOutbox(s);
  const declared = join(s.base, "declared.json");
  writeFileSync(declared, JSON.stringify(["mica-node"]), "utf8");
  fileDropCommitter(s.intakeDir, "mica-node")(head(4, "h4", 44));

  const r = spawnWitnessd([
    "--store", s.storePath,
    "--intake", s.intakeDir,
    "--outbox", s.outboxDir,
    "--witness-set-id", "set-alpha",
    "--key", s.keyPath,
    "--declared", declared,
    "--once",
  ]);

  assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.deepStrictEqual(
    storedRecords(s.storePath).map((record) => [record.kind, record.submitterId]),
    [["PLACEMENT", ""], ["HEAD_COMMIT", "mica-node"]]
  );
  assert.deepStrictEqual(readdirSync(s.intakeDir), []);
  assert.deepStrictEqual(readdirSync(s.outboxDir), ["receipt-000000000001.json"]);
  assert.ok(r.stdout.includes("1 drop(s) consumed — HEAD_COMMIT=1"));
  assert.ok(r.stdout.includes("THIS PROCESS ANSWERS NO READS"));
});

check("WD-L · an undeclared submitter RETAINS — nothing is rejected, nothing is lost", () => {
  const s = scratch("wd-undeclared");
  fileDropCommitter(s.intakeDir, "nobody-declared-me")(head());
  const r = spawnWitnessd([
    "--store", s.storePath,
    "--intake", s.intakeDir,
    "--outbox", s.outboxDir,
    "--witness-set-id", "set-alpha",
    "--key", s.keyPath,
    "--once",
  ]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.deepStrictEqual(
    storedRecords(s.storePath).map((record) => record.kind),
    ["PLACEMENT", "UNDECLARED_SUBMITTER"]
  );
  // No receipt, so the outbox was never even created. Nothing implies one.
  assert.strictEqual(existsSync(s.outboxDir), false);
});

check("WD-M · an unappendable store EXITS NON-ZERO and the drop is STILL ON DISK", () => {
  const s = scratch("wd-exit-nonzero");
  // A store that loads but cannot be appended to: the class refuses to extend a
  // chain it could not verify, and that refusal must reach the exit code.
  mkdirSync(s.base, { recursive: true });
  writeFileSync(s.storePath, "this is not a witness record\n", "utf8");
  fileDropCommitter(s.intakeDir, "mica-node")(head());

  const r = spawnWitnessd([
    "--store", s.storePath,
    "--intake", s.intakeDir,
    "--outbox", s.outboxDir,
    "--witness-set-id", "set-alpha",
    "--once",
  ]);

  assert.notStrictEqual(r.status, 0, "a witness that cannot append must not exit 0");
  assert.strictEqual(r.status, 3);
  assert.ok(/not appendable/.test(r.stderr), r.stderr);
  assert.ok(r.stderr.includes(s.storePath), "the failure must name the store");
  assert.ok(/NOTHING IS BEING SWALLOWED/.test(r.stderr));

  // The whole reason exiting is safe: the drop was never consumed.
  assert.deepStrictEqual(readdirSync(s.intakeDir), ["mica-node"]);
});

check("WD-N · a missing required path exits 1 before touching anything", () => {
  const s = scratch("wd-missing");
  const r = spawnWitnessd(["--store", s.storePath]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/NO DEFAULT PATHS/.test(r.stderr));
  assert.strictEqual(existsSync(s.storePath), false, "a refused start writes nothing");
});

check("WD-O · a wedging drop no longer wedges: the sweep finishes and exits 0", () => {
  const s = scratch("wd-no-wedge");
  deployOutbox(s);
  const declared = join(s.base, "declared.json");
  writeFileSync(declared, JSON.stringify(["b-good"]), "utf8");

  // `a-denied` sorts first. Before this build it threw out of the sweep before
  // the removal, so `b-good` was never read — this poll, or any later one.
  const denied = join(s.intakeDir, "a-denied");
  writeFileSync(denied, "never read", "utf8");
  spawnSync("chmod", ["000", denied]);
  fileDropCommitter(s.intakeDir, "b-good")(head(5, "h5", 55));

  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
  if (asRoot) {
    console.log("    (skipped: running as root, the permission wedge is unreachable)");
    return;
  }

  const r = spawnWitnessd([
    "--store", s.storePath,
    "--intake", s.intakeDir,
    "--outbox", s.outboxDir,
    "--witness-set-id", "set-alpha",
    "--key", s.keyPath,
    "--declared", declared,
    "--once",
  ]);

  assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.deepStrictEqual(
    storedRecords(s.storePath).map((record) => [record.kind, record.submitterId]),
    [
      ["PLACEMENT", ""],
      ["UNREADABLE_DROP", "a-denied"],
      ["HEAD_COMMIT", "b-good"],
    ]
  );
  assert.deepStrictEqual(readdirSync(s.intakeDir), []);
  assert.ok(
    r.stdout.includes("2 drop(s) consumed — HEAD_COMMIT=1 UNREADABLE_DROP=1"),
    r.stdout
  );
});

check("WD-P · DAEMON MODE: the timer really sweeps, and the drop really lands", () => {
  const s = scratch("wd-daemon");
  deployOutbox(s);
  const declared = join(s.base, "declared.json");
  writeFileSync(declared, JSON.stringify(["mica-node"]), "utf8");
  fileDropCommitter(s.intakeDir, "mica-node")(head(6, "h6", 66));

  // No --once. The process is meant to stay up, so the test ends it the way a
  // deployment would end it and then reads what it left behind. The exit code
  // of a killed process says nothing; the STORE says everything.
  const r = spawnSync(process.execPath, [TS_NODE_BIN, "-T", WITNESSD_ENTRY,
    "--store", s.storePath,
    "--intake", s.intakeDir,
    "--outbox", s.outboxDir,
    "--witness-set-id", "set-alpha",
    "--key", s.keyPath,
    "--declared", declared,
    "--tick-ms", "50",
  ], { cwd: REPO_ROOT, encoding: "utf8", timeout: 6_000, killSignal: "SIGKILL" });
  if (r.error !== undefined && !/ETIMEDOUT/.test(String(r.error))) throw r.error;

  // A daemon does not exit, so this case always costs its full timeout and the
  // kill tells us nothing. If the banner never appeared the machine did not get
  // the child up in time — a different fact from a broken sweep, and it should
  // read as one.
  assert.ok(
    r.stdout.includes("WITNESSD_READY"),
    `the child never came up within the timeout (machine load, not a sweep fault): ${r.stdout}${r.stderr}`
  );
  assert.deepStrictEqual(
    storedRecords(s.storePath).map((record) => [record.kind, record.submitterId]),
    [["PLACEMENT", ""], ["HEAD_COMMIT", "mica-node"]]
  );
  assert.deepStrictEqual(readdirSync(s.intakeDir), []);
});

rmSync(root, { recursive: true, force: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
