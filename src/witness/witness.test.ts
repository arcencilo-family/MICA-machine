// ── MICA · S-4 witness acceptance tests ───────────────────────────────

import assert from "assert";
import {
  createHash,
  generateKeyPairSync,
  verify as verifySignature,
} from "crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import { appendLockPath } from "../mica/store/append-store";
import type { LineAppender } from "../mica/store/append-store";
import { FloorTrail } from "../mica/chokepoint/floor-trail";
import type { FloorTrailRecordInput } from "../mica/chokepoint/floor-trail";
import {
  ALL_RECEIPTS_HISTORICAL,
  canonicalReceipt,
  canonicalWitnessRecord,
  CHAIN_ID_GRAMMAR,
  DROP_HEAD_KEYS,
  NAMED_DROP_HEAD_KEYS,
  assertFramedChainId,
  canonicalNamedDropBytes,
  fileDropCommitter,
  fileDropNamedCommitter,
  INDEPENDENCE_IS_A_DEPLOYMENT_FACT,
  MODALITIES,
  RETENTION_IS_NOT_TRUTH,
  SRSSOT_NAMED_DEPENDENCY,
  THE_STORE_REFUSES_TO_FORK,
  WITNESS_CERTIFIES_NOTHING,
  WITNESS_READS,
  WITNESS_TITLE,
  WITNESSED_KINDS,
  Witness,
  WitnessDeploymentActMissing,
} from "./index";
import type {
  HeadCommit,
  Modality,
  NamedHeadCommit,
  WitnessOptions,
  WitnessRecord,
} from "./index";

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
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(error as Error).stack ?? String(error)}`);
    failed++;
  }
}

const root = mkdtempSync(join(tmpdir(), "mica-witness-"));
let counter = 0;
const privatePem = generateKeyPairSync("ed25519");

/**
 * PATHS ONLY. IT CREATES NOTHING AND IT WRITES NOTHING (S97-D(1), done S98).
 *
 * It used to `mkdirSync` the store's parent and write the signing key, and both
 * were wrong for the same reason in two different registers.
 *
 * THE DIRECTORY. Making it here is recipe §5.1 — a DEPLOYMENT ACT — performed
 * invisibly, once, for every body in the file. `deployOutbox` below already
 * models §5.2 as a named act a body opts into; §5.1 was the one act still
 * happening by accident. The S97 bodies had to opt OUT of this helper entirely
 * and build their config by hand, with a comment explaining why: that is the
 * tell. A fixture a negative test must escape is a fixture doing something the
 * positive tests are not admitting to.
 *
 * THE KEY. Writing it here made SIGNING the default and made "no key" the thing
 * a body had to ask for — twenty bodies carried `keyPath: undefined` to decline
 * a key they never wanted. The polarity was backwards: a body that NEEDS a
 * signature never said so, so a receipt appearing in a test proved nothing about
 * whether that test meant to exercise signing.
 *
 * So: this computes names. `deployStoreDir`, `deployOutbox` and `deployKey` are
 * the three acts, each named, each called where it is wanted.
 */
function paths(stem: string): {
  storePath: string;
  outboxDir: string;
  keyPath: string;
  intakeDir: string;
} {
  const base = join(root, `${stem}-${counter++}`);
  return {
    storePath: join(base, "witness.jsonl"),
    outboxDir: join(base, "outbox"),
    keyPath: join(base, "witness-private.pem"),
    intakeDir: join(base, "intake"),
  };
}

/**
 * THE DEPLOYMENT ACT OF RECIPE §5.1, RENDERED IN A TEST — the store directory.
 *
 * Since S97 the witness does not create it. A test that wants a witness to come
 * up must therefore model a deployer who performed §5.1, exactly as
 * `deployOutbox` models one who performed §5.2.
 */
function deployStoreDir(config: WitnessOptions): void {
  mkdirSync(dirname(config.storePath), { recursive: true });
}

/**
 * THE SIGNING KEY A DEPLOYER PLACES. Called only by bodies that want a receipt.
 *
 * A body that does not call this gets a witness whose configured key is not
 * there, which is a REAL and different state from `keyPath: undefined`: the
 * first retains KEY_UNAVAILABLE naming the path, the second names null. Both are
 * worth testing and neither is now the accident.
 */
function deployKey(config: WitnessOptions): void {
  mkdirSync(dirname(config.keyPath as string), { recursive: true });
  writeFileSync(
    config.keyPath as string,
    privatePem.privateKey.export({ format: "pem", type: "pkcs8" }),
    { mode: 0o600 }
  );
}

/**
 * A config whose §5.1 act HAS been performed, and nothing else.
 *
 * The store directory is made here rather than left to each body because every
 * body that constructs a `Witness` needs it and a witness that will not come up
 * is not a test of anything — but it is made by a NAMED act, on one line a
 * reader can see, instead of inside a path helper. §5.2 and the key stay opt-in.
 */
function options(stem: string, overrides: Partial<WitnessOptions> = {}): WitnessOptions {
  const config: WitnessOptions = {
    witnessSetId: "set-alpha",
    declaredSubmitters: ["mica-node"],
    witnessClock: () => 1_000,
    ...paths(stem),
    ...overrides,
  };
  deployStoreDir(config);
  return config;
}

/**
 * THE DEPLOYMENT ACT OF RECIPE §5.2, RENDERED IN A TEST.
 *
 * Since S96 the witness does not create its own outbox — the same cut S88 made
 * on the intake, and for a worse reason (a conjured outbox carries the process's
 * primary group, so receipts land where no entitled reader can enter). A test
 * that wants receipts must therefore model a deployer who performed §5.2, the
 * way the intake tests already model one who performed §5.3.
 *
 * It is a helper in the TEST file on purpose. Putting it back in the source
 * behind a flag or a test-only branch would be a fence with a bypass, which is
 * not a fence.
 */
function deployOutbox(config: WitnessOptions): void {
  mkdirSync(config.outboxDir as string, { recursive: true });
}

function head(
  seq = 7,
  hash = "head-7",
  ts = 700,
  modality: Modality = "OFFERED"
): HeadCommit {
  return {
    seq_no: seq,
    head_hash: hash,
    ts,
    witness_set_id: "set-alpha",
    modality,
  };
}

/** The SIX-key shape a submitter presents from S105 on. Names its chain. */
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

/** The FOUR-key legacy shape a v0.2 submitter presents. Not a `HeadCommit`. */
function legacyHead(seq = 7, hash = "head-7", ts = 700): unknown {
  return { seq_no: seq, head_hash: hash, ts, witness_set_id: "set-alpha" };
}

function bytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function payloadFields(record: WitnessRecord): string[] {
  switch (record.kind) {
    case "HEAD_COMMIT":
    case "UNDECLARED_SUBMITTER":
      return [
        String(record.witnessed.seq_no),
        record.witnessed.head_hash,
        String(record.witnessed.ts),
        record.witnessed.witness_set_id,
        record.witnessed.modality,
      ];
    // SIX fields, `chain_id` LAST — independently restated here rather than
    // imported, because a test that borrows the canonicaliser it is checking
    // proves only that the module agrees with itself. The order matters: see
    // the neighbours argument in `canonicalWitnessed`.
    case "NAMED_HEAD_COMMIT":
    case "NAMED_UNDECLARED_SUBMITTER":
      return [
        String(record.witnessed.seq_no),
        record.witnessed.head_hash,
        String(record.witnessed.ts),
        record.witnessed.witness_set_id,
        record.witnessed.modality,
        record.witnessed.chain_id,
      ];
    // FOUR fields, because four is what arrived. The witness invents no fifth.
    case "UNDECLARED_MODALITY":
      return [
        String(record.witnessed.seq_no),
        record.witnessed.head_hash,
        String(record.witnessed.ts),
        record.witnessed.witness_set_id,
      ];
    case "MALFORMED_SUBMISSION":
      return [String(record.witnessed.byteLength), record.witnessed.sha256];
    case "PLACEMENT":
      return [
        record.witnessed.platform,
        record.witnessed.effectiveUid.state,
        record.witnessed.effectiveUid.state === "OBSERVED"
          ? String(record.witnessed.effectiveUid.value)
          : record.witnessed.effectiveUid.reason,
        record.witnessed.effectiveGid.state,
        record.witnessed.effectiveGid.state === "OBSERVED"
          ? String(record.witnessed.effectiveGid.value)
          : record.witnessed.effectiveGid.reason,
        record.witnessed.hostname,
        record.witnessed.storePath,
        record.witnessed.storeMode.state,
        record.witnessed.storeMode.state === "OBSERVED"
          ? String(record.witnessed.storeMode.value)
          : record.witnessed.storeMode.reason,
        String(record.witnessed.keyAvailable),
      ];
    case "KEY_UNAVAILABLE":
      return [record.witnessed.keyPath ?? "null", record.witnessed.detail];
    case "UNREADABLE_DROP":
      return [
        record.witnessed.error,
        record.witnessed.size.state,
        record.witnessed.size.state === "OBSERVED"
          ? String(record.witnessed.size.value)
          : record.witnessed.size.reason,
        record.witnessed.mode.state,
        record.witnessed.mode.state === "OBSERVED"
          ? String(record.witnessed.mode.value)
          : record.witnessed.mode.reason,
      ];
  }
}

function independentlyHash(record: WitnessRecord): string {
  return createHash("sha256")
    .update(
      [
        String(record.seq),
        String(record.arrivalTs),
        record.submitterId,
        record.kind,
        ...payloadFields(record),
        record.previousHash,
      ].join(" "),
      "utf8"
    )
    .digest("hex");
}

console.log("\nMICA — S-4 witness\n");

check("mixed kinds form a chain whose explicit-order hashes reproduce", () => {
  const witness = new Witness(options("mixed", { keyPath: undefined }));
  witness.submitRaw(bytes(head()), "mica-node");
  witness.submitRaw(Buffer.from("{bad", "utf8"), "mica-node");
  witness.submitRaw(bytes(head(8, "foreign", 701)), "not-declared");
  const records = witness.readAll();
  assert.deepStrictEqual(
    records.map((record) => record.kind),
    [
      "PLACEMENT",
      "HEAD_COMMIT",
      "KEY_UNAVAILABLE",
      "MALFORMED_SUBMISSION",
      "UNDECLARED_SUBMITTER",
    ]
  );
  assert.deepStrictEqual(witness.verify(), { valid: true, brokenAt: null });
  records.forEach((record) => assert.strictEqual(record.hash, independentlyHash(record)));
});

check("tampering a middle store record breaks verification at its index", () => {
  const config = options("tamper");
  deployOutbox(config);
  const witness = new Witness(config);
  witness.submitRaw(bytes(head(1, "middle-head", 1)), "mica-node");
  witness.submitRaw(bytes(head(2, "tail-head", 2)), "mica-node");
  const before = readFileSync(config.storePath, "utf8");
  writeFileSync(config.storePath, before.replace("middle-head", "mutated-he"), "utf8");
  const loaded = new Witness(config);
  assert.strictEqual(loaded.getLoadState(), "STORE_BREAK");
  assert.deepStrictEqual(loaded.verify(), { valid: false, brokenAt: 1 });
});

check("five hostile JSON shapes become hashed malformed-submission records", () => {
  const witness = new Witness(options("hostile"));
  const cases = [
    Buffer.from(
      '{"seq_no":1,"head_hash":"h","ts":1,"witness_set_id":"s","extra":true}',
      "utf8"
    ),
    Buffer.from('{"seq_no":1,"head_hash":"h","ts":1}', "utf8"),
    Buffer.from(
      '{"seq_no":"1","head_hash":"h","ts":1,"witness_set_id":"s"}',
      "utf8"
    ),
    Buffer.from(
      '{"seq_no":1,"head_hash":"h","ts":1,"witness_set_id":"s","__proto__":{"polluted":true}}',
      "utf8"
    ),
    Buffer.from('{"seq_no":1,"head_hash":', "utf8"),
  ];
  for (const hostile of cases) {
    const result = witness.submitRaw(hostile, "mica-node");
    assert.strictEqual(result.record.kind, "MALFORMED_SUBMISSION");
    if (result.record.kind !== "MALFORMED_SUBMISSION") throw new Error("narrowing");
    assert.deepStrictEqual(result.record.witnessed, {
      byteLength: hostile.byteLength,
      sha256: createHash("sha256").update(hostile).digest("hex"),
    });
  }
  assert.strictEqual(({} as { polluted?: boolean }).polluted, undefined);
  assert.deepStrictEqual(witness.verify(), { valid: true, brokenAt: null });
});

check("a well-formed commit from an undeclared submitter is retained in full", () => {
  const witness = new Witness(options("undeclared"));
  const commit = head();
  const result = witness.submitRaw(bytes(commit), "stranger");
  assert.strictEqual(result.record.kind, "UNDECLARED_SUBMITTER");
  assert.deepStrictEqual(result.record.witnessed, commit);
  assert.strictEqual(result.receipt, null);
});

check("receipt signing, canonical order, outbox write, and key separation hold", () => {
  const config = options("receipt", { witnessClock: () => 4_242 });
  // This body verifies a SIGNATURE, so it places the key knowingly. Under the
  // old fixture every body got one and this one's need was indistinguishable
  // from the thirty-eight that did not care.
  deployKey(config);
  deployOutbox(config);
  const witness = new Witness(config);
  const result = witness.submitRaw(bytes(head(9, "signed-head", 99)), "mica-node");
  assert.ok(result.receipt !== null);
  assert.ok(result.receiptPath !== null);
  const receipt = result.receipt;
  assert.strictEqual(canonicalReceipt(receipt), "9 signed-head 4242");
  assert.strictEqual(
    verifySignature(
      null,
      Buffer.from(canonicalReceipt(receipt), "utf8"),
      privatePem.publicKey,
      Buffer.from(receipt.witness_sig, "base64")
    ),
    true
  );
  const other = generateKeyPairSync("ed25519");
  assert.strictEqual(
    verifySignature(
      null,
      Buffer.from(canonicalReceipt(receipt), "utf8"),
      other.publicKey,
      Buffer.from(receipt.witness_sig, "base64")
    ),
    false
  );
  assert.strictEqual(existsSync(result.receiptPath), true);
  assert.deepStrictEqual(
    JSON.parse(readFileSync(result.receiptPath, "utf8")),
    receipt
  );
});

check("an unavailable key degrades receipts while retention continues", () => {
  const config = options("no-key", { keyPath: undefined });
  const witness = new Witness(config);
  const result = witness.submitRaw(bytes(head()), "mica-node");
  assert.strictEqual(result.record.kind, "HEAD_COMMIT");
  assert.strictEqual(result.receipt, null);
  assert.deepStrictEqual(
    witness.readAll().map((record) => record.kind),
    ["PLACEMENT", "HEAD_COMMIT", "KEY_UNAVAILABLE"]
  );
  assert.strictEqual(existsSync(config.outboxDir), false);
  assert.deepStrictEqual(witness.verify(), { valid: true, brokenAt: null });
});

// ── S96 · THE OUTBOX IS A DEPLOYMENT ACT, NOT A THING THE CONSUMER CONJURES ──
//
// Written BEFORE the fix and run against the old behaviour, where it failed:
// `submitRaw` used to `mkdirSync` the outbox and no throw ever arrived. That red
// is the whole reason these two are worth having — a guard nobody has watched
// refuse is a guard that has been asserted.

check("S96-A · a MISSING OUTBOX throws and NAMES THE PATH, and the arrival is still retained", () => {
  const config = options("s96-missing-outbox");
  // A KEY IS REQUIRED TO REACH THE DEFECT. With no key, `submitRaw` retains
  // KEY_UNAVAILABLE and RETURNS before it ever touches the outbox — the missing
  // directory would never be noticed and this body would assert nothing.
  deployKey(config);
  const witness = new Witness(config);
  assert.strictEqual(existsSync(config.outboxDir), false, "the fixture does not create it");

  assert.throws(
    () => witness.submitRaw(bytes(head()), "mica-node"),
    (error: unknown) => {
      const text = String((error as Error).message);
      assert.ok(
        text.includes(config.outboxDir as string),
        `the failure must name the directory a deployment act was supposed to ` +
          `create; got: ${text}`
      );
      return true;
    }
  );

  // NOTHING IS LOST, and this is the half that made the fix safe to make: the
  // durable append happens BEFORE the receipt write, so the arrival is already
  // on the record when the throw lands. Only the receipt is absent.
  assert.deepStrictEqual(
    witness.readAll().map((record) => record.kind),
    ["PLACEMENT", "HEAD_COMMIT"]
  );
  assert.deepStrictEqual(witness.verify(), { valid: true, brokenAt: null });
  assert.strictEqual(
    existsSync(config.outboxDir),
    false,
    "and it is STILL not created — the consumer does not conjure it on the way out either"
  );
});

check("S96-B · the sweep fails LOUD and the drop stays on disk for the retry", () => {
  const config = options("s96-missing-outbox-sweep");
  // Same reason as S96-A: the outbox write is only reached once a receipt is
  // actually produced, and no receipt is produced without a key.
  deployKey(config);
  const witness = new Witness(config);
  const intake = config.intakeDir as string;
  mkdirSync(intake, { recursive: true });
  writeFileSync(join(intake, "mica-node"), JSON.stringify(head()), "utf8");

  assert.throws(() => witness.pollIntake(), /outbox/);

  // `rmSync` sits AFTER `submitRaw` in the sweep loop, so a throw skips it. The
  // drop survives, the submitter needs no retry of its own, and the operator
  // gets a failed unit instead of receipts landing where no reader can reach.
  assert.deepStrictEqual(
    readdirSync(intake),
    ["mica-node"],
    "the drop is NOT consumed by a sweep that failed"
  );
});

check("startup placement carries observed principal, host, store, mode, and key shape", () => {
  const config = options("placement");
  const witness = new Witness(config);
  const placement = witness.readAll()[0];
  assert.strictEqual(placement.kind, "PLACEMENT");
  if (placement.kind !== "PLACEMENT") throw new Error("narrowing");
  assert.deepStrictEqual(Object.keys(placement.witnessed), [
    "platform",
    "effectiveUid",
    "effectiveGid",
    "hostname",
    "storePath",
    "storeMode",
    "keyAvailable",
  ]);
  assert.strictEqual(placement.witnessed.platform, process.platform);
  for (const reading of [
    placement.witnessed.effectiveUid,
    placement.witnessed.effectiveGid,
    placement.witnessed.storeMode,
  ]) {
    assert.ok(["OBSERVED", "NOT_OBSERVABLE", "READ_FAILED"].includes(reading.state));
    if (reading.state === "OBSERVED") {
      assert.ok(Number.isSafeInteger(reading.value));
    } else {
      assert.strictEqual(typeof reading.reason, "string");
    }
  }
  assert.strictEqual(typeof placement.witnessed.hostname, "string");
  assert.strictEqual(placement.witnessed.storePath, config.storePath);
  assert.strictEqual(typeof placement.witnessed.keyAvailable, "boolean");
});

check("placement readings round-trip observed, unavailable, and failed states", () => {
  const scenarios = [
    {
      name: "observed",
      runtime: {
        platform: "test-posix",
        getuid: () => 101,
        getgid: () => 102,
        storeMode: () => 0o700,
      },
      states: ["OBSERVED", "OBSERVED", "OBSERVED"],
    },
    {
      name: "unavailable",
      runtime: {
        platform: "test-non-posix",
        getuid: undefined,
        getgid: undefined,
        storeMode: () => {
          throw new Error("store mode must not be read");
        },
      },
      states: ["NOT_OBSERVABLE", "NOT_OBSERVABLE", "NOT_OBSERVABLE"],
    },
    {
      name: "failed",
      runtime: {
        platform: "test-posix",
        getuid: () => {
          throw new Error("uid unavailable");
        },
        getgid: () => {
          throw new Error("gid unavailable");
        },
        storeMode: () => {
          throw new Error("mode unavailable");
        },
      },
      states: ["READ_FAILED", "READ_FAILED", "READ_FAILED"],
    },
  ] as const;
  for (const scenario of scenarios) {
    const config = options(`placement-${scenario.name}`, {
      placementRuntime: scenario.runtime,
    });
    const witness = new Witness(config);
    const stored = JSON.parse(readFileSync(config.storePath, "utf8"));
    const reloaded = new Witness(config);
    const placement = reloaded.readAll()[0];
    assert.strictEqual(placement.kind, "PLACEMENT");
    if (placement.kind !== "PLACEMENT") throw new Error("narrowing");
    assert.deepStrictEqual(
      [
        placement.witnessed.effectiveUid.state,
        placement.witnessed.effectiveGid.state,
        placement.witnessed.storeMode.state,
      ],
      scenario.states
    );
    assert.deepStrictEqual(stored.witnessed, placement.witnessed);
    if (scenario.name === "unavailable") {
      assert.deepStrictEqual(placement.witnessed.storeMode, {
        state: "NOT_OBSERVABLE",
        reason: "this host cannot express POSIX placement facts",
      });
      assert.strictEqual("value" in placement.witnessed.storeMode, false);
    }
    assert.deepStrictEqual(witness.verify(), { valid: true, brokenAt: null });
    assert.deepStrictEqual(reloaded.verify(), { valid: true, brokenAt: null });
  }
});

check("a returned reading-state mutation severs the chain", () => {
  const witness = new Witness(options("placement-severance", {
    placementRuntime: {
      platform: "test-posix",
      getuid: () => 33,
      getgid: () => 34,
      storeMode: () => 0o700,
    },
  }));
  const placement = witness.readAll()[0];
  assert.strictEqual(placement.kind, "PLACEMENT");
  if (placement.kind !== "PLACEMENT") throw new Error("narrowing");
  const reading = placement.witnessed.effectiveUid as { state: string; value: number };
  const value = reading.value;
  reading.state = "NOT_OBSERVABLE";
  assert.strictEqual(reading.value, value);
  assert.deepStrictEqual(witness.verify(), { valid: false, brokenAt: 0 });
});

check("unavailable and failed placement readings have distinct preimages and hashes", () => {
  const unavailable = new Witness(options("placement-unavailable-hash", {
    placementRuntime: {
      platform: "test-non-posix",
      getuid: undefined,
      getgid: undefined,
      storeMode: () => 0o700,
    },
  })).readAll()[0];
  const failed = new Witness(options("placement-failed-hash", {
    placementRuntime: {
      platform: "test-posix",
      getuid: () => {
        throw new Error("uid unavailable");
      },
      getgid: () => {
        throw new Error("gid unavailable");
      },
      storeMode: () => {
        throw new Error("mode unavailable");
      },
    },
  })).readAll()[0];
  assert.notStrictEqual(canonicalWitnessRecord(unavailable), canonicalWitnessRecord(failed));
  assert.notStrictEqual(unavailable.hash, failed.hash);
});

check("malformed placement readings stop schema loading without coercion", () => {
  const config = options("placement-schema");
  new Witness(config);
  const malformed = JSON.parse(readFileSync(config.storePath, "utf8"));
  malformed.witnessed.storeMode = { state: "OBSERVED", value: -1 };
  writeFileSync(config.storePath, JSON.stringify(malformed) + "\n", "utf8");
  const loaded = new Witness(config);
  assert.strictEqual(loaded.getLoadState(), "LOADED_UNVERIFIED_SCHEMA");
  assert.deepStrictEqual(loaded.verify(), { valid: false, brokenAt: 0 });
});

check("the witness clock surrounds but never alters the submitter clock", () => {
  let now = 20;
  const config = options("clocks", { witnessClock: () => now++ });
  deployOutbox(config);
  const witness = new Witness(config);
  const commit = head(3, "clock-head", 9_999);
  const result = witness.submitRaw(bytes(commit), "mica-node");
  assert.strictEqual(result.record.arrivalTs, 21);
  assert.strictEqual(result.record.kind, "HEAD_COMMIT");
  if (result.record.kind !== "HEAD_COMMIT") throw new Error("narrowing");
  assert.strictEqual(result.record.witnessed.ts, 9_999);
});

check("sequence stays monotone and a store empty at load is typed EMPTY", () => {
  const witness = new Witness(options("sequence", { keyPath: undefined }));
  assert.strictEqual(witness.getLoadState(), "EMPTY");
  witness.submitRaw(bytes(head()), "mica-node");
  witness.submitRaw(Buffer.from("no"), "mica-node");
  witness.submitRaw(bytes(head()), "outsider");
  assert.deepStrictEqual(
    witness.readAll().map((record) => record.seq),
    [0, 1, 2, 3, 4]
  );
});

check("a FloorTrail head commits through retention, receipt, and verification", () => {
  const floorPath = join(root, `floor-${counter++}.jsonl`);
  const trail = new FloorTrail({ path: floorPath });
  const input: FloorTrailRecordInput = {
    timestamp: 55,
    actionId: "action-55",
    disposition: "RELEASE",
    floorKind: "SILENT",
    blindSplit: "NOT_APPLICABLE",
    impactClass: "",
    sensorIds: "sensor-a",
    sensorKinds: "SILENT",
  };
  trail.record(input);
  const floorHead = trail.getAll()[trail.length - 1];
  const config = options("tie-in", { witnessClock: () => 88 });
  // The claim is retention THROUGH receipt and verification, so both acts are
  // performed here and named.
  deployKey(config);
  deployOutbox(config);
  const witness = new Witness(config);
  const result = witness.submitRaw(
    bytes({
      seq_no: floorHead.sequenceNumber,
      head_hash: floorHead.hash,
      ts: floorHead.timestamp,
      witness_set_id: "set-alpha",
      // S88: the trail is a MACHINE book. No human instruction rides a permit
      // decision, so the declaration it makes is the machine one.
      modality: "NOT_AN_INSTRUCTION",
    }),
    "mica-node"
  );
  assert.strictEqual(result.record.kind, "HEAD_COMMIT");
  assert.ok(result.receipt !== null);
  assert.strictEqual(result.receipt.head_hash, floorHead.hash);
  assert.deepStrictEqual(witness.verify(), { valid: true, brokenAt: null });
});

// Renamed at S85 (A-D4). This made `storePath` a directory so that appendFileSync
// threw EISDIR — but since the lock build the re-sync reads that same path FIRST, so
// the throw now comes from `resyncAppendStore`, several lines earlier. Still worth
// keeping, under a name that says which path it takes. The append's OWN failure is
// T-G and T-H, which need the injected pen because nothing else can reach it.
check("a store path replaced by a directory fails at the RE-SYNC and advances nothing", () => {
  const config = options("append-failure");
  const witness = new Witness(config);
  const length = witness.readAll().length;
  rmSync(config.storePath);
  mkdirSync(config.storePath);
  assert.throws(
    () => witness.submitRaw(bytes(head()), "mica-node"),
    /EISDIR|illegal operation on a directory|permission denied/i
  );
  assert.strictEqual(witness.readAll().length, length);
});

check("the file-drop poller consumes names in order only after witnessing", () => {
  const config = options("poller", {
    declaredSubmitters: ["a.drop", "b.drop"],
  });
  deployOutbox(config);
  const witness = new Witness(config);
  mkdirSync(config.intakeDir as string, { recursive: true });
  writeFileSync(join(config.intakeDir as string, "b.drop"), bytes(head(2)));
  writeFileSync(join(config.intakeDir as string, "a.drop"), bytes(head(1)));
  const results = witness.pollIntake();
  assert.deepStrictEqual(
    results.map((result) => result.record.submitterId),
    ["a.drop", "b.drop"]
  );
  assert.deepStrictEqual(readdirSync(config.intakeDir as string), []);
});

check("self-description is exported, non-empty, and makes no positive health claim", () => {
  const descriptions = [
    WITNESS_TITLE,
    WITNESS_READS,
    WITNESS_CERTIFIES_NOTHING,
    INDEPENDENCE_IS_A_DEPLOYMENT_FACT,
    RETENTION_IS_NOT_TRUTH,
    ALL_RECEIPTS_HISTORICAL,
    SRSSOT_NAMED_DEPENDENCY,
    THE_STORE_REFUSES_TO_FORK,
  ];
  descriptions.forEach((description) => assert.ok(description.trim().length > 0));
  const joined = descriptions.join("\n");
  assert.doesNotMatch(joined, /(?:system|chain|deployment) is (?:healthy|safe)/i);
  assert.doesNotMatch(joined, /all[- ]clear/i);
  assert.match(joined, /Certification belongs to the doctor and the arbiter/i);
  assert.match(joined, /recommends nothing/i);
});

// ══ S85 · the witness takes the lock the other three stores hold ═════════════
//
// The defect these cover was PROVEN against the pre-fix code before any of this
// was written: construct A, construct B, A.submitRaw -> [0, 1, 1, 2] on disk,
// STORE_BREAK at load, every later append refused forever. Because the
// CONSTRUCTOR appends a PLACEMENT record, the fork needed no concurrency at all.

console.log("\n══ S85 · the append lock and the disk-true head ══");

/** Every record the store file actually holds, parsed, in file order. */
function storedRecords(storePath: string): WitnessRecord[] {
  return readFileSync(storePath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as WitnessRecord);
}

check("T-A · the sequential three-step fork now catches up onto the true head", () => {
  const config = options("s85-catch-up", { keyPath: undefined });
  const a = new Witness(config); // PLACEMENT seq 0
  const b = new Witness(config); // loads seq 0, appends PLACEMENT seq 1
  const result = a.submitRaw(bytes(head()), "mica-node"); // A is stale: this forked

  // A re-synced under the lock, adopted B's placement, and derived from the head
  // the DISK holds — not from the one it loaded.
  assert.strictEqual(result.record.seq, 2);
  assert.deepStrictEqual(
    storedRecords(config.storePath).map((record) => [record.seq, record.kind]),
    [[0, "PLACEMENT"], [1, "PLACEMENT"], [2, "HEAD_COMMIT"], [3, "KEY_UNAVAILABLE"]]
  );
  assert.deepStrictEqual(a.readAll().map((record) => record.seq), [0, 1, 2, 3]);

  // B is untouched and still holds its stale prefix. Catching up is something a
  // writer does when it writes, never something done to it in the background.
  assert.deepStrictEqual(b.readAll().map((record) => record.seq), [0, 1]);

  // The lock was released on the success path — twice, once per append.
  assert.strictEqual(existsSync(appendLockPath(config.storePath)), false);

  const reloaded = new Witness(config);
  assert.strictEqual(reloaded.getLoadState(), "LOADED_VERIFIED");
  assert.deepStrictEqual(reloaded.verify(), { valid: true, brokenAt: null });
  assert.deepStrictEqual(
    reloaded.readAll().map((record) => record.seq),
    [0, 1, 2, 3, 4]
  );
});

check("T-B · a held lock fails the append typed, names the lock, and moves nothing", () => {
  const config = options("s85-contended", { keyPath: undefined });
  const witness = new Witness(config);
  const lockPath = appendLockPath(config.storePath);
  writeFileSync(lockPath, "", "utf8");
  const bytesBefore = readFileSync(config.storePath, "utf8");
  const prefixBefore = witness.readAll();

  assert.throws(
    () => witness.submitRaw(bytes(head()), "mica-node"),
    (error: Error) => {
      assert.ok(
        error.message.includes(lockPath),
        `the failure does not name the lock path:\n${error.message}`
      );
      assert.match(error.message, /no expiry and no timer will ever clear it/);
      return true;
    }
  );

  assert.strictEqual(readFileSync(config.storePath, "utf8"), bytesBefore);
  assert.deepStrictEqual(witness.readAll(), prefixBefore);
  // Not ours to remove: this process never held it.
  assert.strictEqual(existsSync(lockPath), true);
});

check("T-C · a held lock fails CONSTRUCTION loudly and retains no placement", () => {
  const config = options("s85-construction", { keyPath: undefined });
  const lockPath = appendLockPath(config.storePath);
  writeFileSync(lockPath, "", "utf8");

  assert.throws(
    () => new Witness(config),
    (error: Error) => {
      assert.ok(error.message.includes(lockPath), error.message);
      return true;
    }
  );

  // The store file exists — preparing it is not appending to it — and holds
  // nothing. No half-made witness escaped the constructor.
  assert.strictEqual(existsSync(config.storePath), true);
  assert.deepStrictEqual(storedRecords(config.storePath), []);
  assert.strictEqual(existsSync(lockPath), true);
});

check("T-D · a lock of any age fails identically: there is no expiry path", () => {
  const fresh = options("s85-fresh-lock", { keyPath: undefined });
  const stale = options("s85-stale-lock", { keyPath: undefined });
  const freshWitness = new Witness(fresh);
  const staleWitness = new Witness(stale);
  const freshLock = appendLockPath(fresh.storePath);
  const staleLock = appendLockPath(stale.storePath);
  writeFileSync(freshLock, "", "utf8");
  writeFileSync(staleLock, "", "utf8");
  utimesSync(staleLock, new Date(0), new Date(0)); // 1970. A year is not a timeout.

  const messages = [
    { witness: freshWitness, lock: freshLock },
    { witness: staleWitness, lock: staleLock },
  ].map(({ witness, lock }) => {
    try {
      witness.submitRaw(bytes(head()), "mica-node");
    } catch (error) {
      return (error as Error).message.split(lock).join("<lock>");
    }
    throw new Error("the append did not fail");
  });
  assert.strictEqual(
    messages[0],
    messages[1],
    "the lock's AGE reached the failure - which would mean an expiry policy exists"
  );

  // And the source carries no way to grow one by accident.
  const source = readFileSync(join(__dirname, "witness.ts"), "utf8");
  for (const banned of ["setTimeout", "setInterval", "unlinkSync"]) {
    assert.ok(
      !source.includes(banned),
      `witness.ts now uses ${banned}: a timer, or a hand on a lock it may not hold`
    );
  }
});

check("T-E · a fork already on disk fails the append and is not deepened", () => {
  const config = options("s85-forked", { keyPath: undefined });
  const witness = new Witness(config);
  const placement = storedRecords(config.storePath)[0];
  // A record that is schema-valid and correctly numbered, and links onto NOTHING.
  appendFileSync(
    config.storePath,
    JSON.stringify({ ...placement, seq: 1 }) + "\n",
    "utf8"
  );
  const bytesBefore = readFileSync(config.storePath, "utf8");

  assert.throws(
    () => witness.submitRaw(bytes(head()), "mica-node"),
    (error: Error) => {
      assert.match(error.message, /no longer links onto the chain loaded from it/);
      assert.match(error.message, /appending onto a fork deepens it/);
      return true;
    }
  );

  assert.strictEqual(readFileSync(config.storePath, "utf8"), bytesBefore);
  assert.strictEqual(witness.readAll().length, 1);
  assert.strictEqual(existsSync(appendLockPath(config.storePath)), false);
});

check("T-F · a broken load still refuses appends, and never reaches the lock", () => {
  const config = options("s85-broken-load", { keyPath: undefined });
  new Witness(config);
  const placement = storedRecords(config.storePath)[0];
  writeFileSync(
    config.storePath,
    JSON.stringify({ ...placement, arrivalTs: 999_999 }) + "\n",
    "utf8"
  );

  const loaded = new Witness(config);
  assert.strictEqual(loaded.getLoadState(), "STORE_BREAK");
  assert.deepStrictEqual(loaded.readAll().length, 1, "no placement over a broken load");
  assert.throws(
    () => loaded.submitRaw(bytes(head()), "mica-node"),
    /witness store is not appendable: STORE_BREAK/
  );
  assert.strictEqual(
    existsSync(appendLockPath(config.storePath)),
    false,
    "a store that cannot append must not take the lock to find that out"
  );
});

// ══ S85 · the injected appender — a pen that can be made to fail ═══════════════
//
// THERE IS NO DEFECT HERE. The durable write and the in-memory push are adjacent
// statements and the `finally` already released the lock over a thrown append
// before this seam existed. What was missing was any way to MAKE the write fail
// on its own: the re-sync reads the store file before the append does, so every
// broken-path trick now fails at the re-sync instead. These tests fence an
// ordering invariant that is correct and was untested.

console.log("\n══ S85 · the injected appender ══");

check("T-G · a throwing pen retains nothing, and still releases the lock", () => {
  let pen: "writes" | "throws" = "writes";
  const appender: LineAppender = (path, line) => {
    if (pen === "throws") throw new Error("the pen ran dry");
    appendFileSync(path, line, "utf8");
  };
  const config = options("s85-pen-throws", { keyPath: undefined, appender });
  const witness = new Witness(config);
  pen = "throws";
  const bytesBefore = readFileSync(config.storePath, "utf8");
  const prefixBefore = witness.readAll();

  assert.throws(() => witness.submitRaw(bytes(head()), "mica-node"), /the pen ran dry/);

  assert.deepStrictEqual(witness.readAll(), prefixBefore);
  assert.strictEqual(readFileSync(config.storePath, "utf8"), bytesBefore);
  assert.strictEqual(existsSync(appendLockPath(config.storePath)), false);

  // A fresh witness on the same path — with the production pen — loads clean. The
  // failed append left no trace to trip over.
  const reloaded = new Witness({ ...config, appender: undefined });
  assert.strictEqual(reloaded.getLoadState(), "LOADED_VERIFIED");
  assert.deepStrictEqual(reloaded.verify(), { valid: true, brokenAt: null });
});

check("T-H · fail then recover: the next append lands contiguously", () => {
  let calls = 0;
  const appender: LineAppender = (path, line) => {
    calls++;
    if (calls === 2) throw new Error("the pen skipped once");
    appendFileSync(path, line, "utf8");
  };
  const config = options("s85-pen-recovers", { keyPath: undefined, appender });
  const witness = new Witness(config); // call 1: the PLACEMENT lands

  assert.throws(() => witness.submitRaw(bytes(head()), "mica-node"), /the pen skipped once/);
  assert.strictEqual(witness.readAll().length, 1, "a failed append advanced the prefix");
  assert.strictEqual(storedRecords(config.storePath).length, 1);

  // The pen writes again. Nothing was poisoned: the record that did not land left
  // no gap, and the next one links onto the head that DID.
  const result = witness.submitRaw(bytes(head()), "mica-node");
  assert.strictEqual(result.record.seq, 1);
  assert.strictEqual(result.record.previousHash, witness.readAll()[0].hash);
  assert.deepStrictEqual(
    storedRecords(config.storePath).map((record) => record.seq),
    [0, 1, 2]
  );

  const reloaded = new Witness({ ...config, appender: undefined });
  assert.strictEqual(reloaded.getLoadState(), "LOADED_VERIFIED");
  assert.deepStrictEqual(reloaded.verify(), { valid: true, brokenAt: null });
});

check("T-I · the fault is injectable at CONSTRUCTION too", () => {
  const config = options("s85-pen-construction", {
    keyPath: undefined,
    appender: () => {
      throw new Error("the pen ran dry");
    },
  });

  assert.throws(() => new Witness(config), /the pen ran dry/);

  // The store file exists and holds nothing; no half-made witness escaped.
  assert.strictEqual(existsSync(config.storePath), true);
  assert.deepStrictEqual(storedRecords(config.storePath), []);
  assert.strictEqual(existsSync(appendLockPath(config.storePath)), false);
});

check("T-J · the absent option is the production pen, and it writes for real", () => {
  const config = options("s85-pen-default", { keyPath: undefined });
  assert.strictEqual(config.appender, undefined, "this case must not inject a pen");
  const witness = new Witness(config);
  witness.submitRaw(bytes(head()), "mica-node");

  // Read off the DISK, not off readAll(): the point is that bytes landed.
  assert.deepStrictEqual(
    storedRecords(config.storePath).map((record) => [record.seq, record.kind]),
    [[0, "PLACEMENT"], [1, "HEAD_COMMIT"], [2, "KEY_UNAVAILABLE"]]
  );
  assert.deepStrictEqual(witness.verify(), { valid: true, brokenAt: null });
});

// ══════════════════════════════════════════════════════════════════════════════
// S86 · THE ONE SILENT EXIT, AND THE FRAMING RULE
//
// Before this build a drop the OS refused to let the witness read threw out of
// `pollIntake` BEFORE the `rmSync`. The file stayed. Every drop sorting after it
// was never read. The next poll threw at the same file. Permanent, unrecorded,
// and reachable by any submitter with `umask 0077` — measured on Linux with
// real users. These are the tests that say it is over.

console.log("\n── S86 · the unreadable drop and the in-flight frame ──────────");

/** A drop this process genuinely cannot read. Skipped when running as root. */
function unreadableDrop(dir: string, name: string, content: string): boolean {
  const path = join(dir, name);
  writeFileSync(path, content, "utf8");
  chmodSync(path, 0o000);
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    // root reads anything; the permission wedge is not reachable here and a
    // test that pretended otherwise would be asserting nothing.
    return false;
  }
  return true;
}

check("S86-A · an unreadable drop is RETAINED, removed, and does not stop the sweep", () => {
  const config = options("s86-unreadable", {
    declaredSubmitters: ["a.drop", "b.drop"],
  });
  deployOutbox(config);
  const witness = new Witness(config);
  const intake = config.intakeDir as string;
  mkdirSync(intake, { recursive: true });

  writeFileSync(join(intake, "b.drop"), bytes(head(2)));
  const reachable = unreadableDrop(intake, "a.drop", "never read");
  if (!reachable) {
    console.log("    (skipped: running as root, the permission wedge is unreachable)");
    return;
  }

  const results = witness.pollIntake();

  // `a.drop` sorts FIRST. Before this build it threw here and `b.drop` was
  // never reached — not this sweep, and not any later one.
  assert.deepStrictEqual(
    results.map((r) => [r.record.submitterId, r.record.kind]),
    [
      ["a.drop", "UNREADABLE_DROP"],
      ["b.drop", "HEAD_COMMIT"],
    ]
  );
  // Both consumed. Leaving the unreadable one strands a file that wedges the
  // next sweep exactly as before.
  assert.deepStrictEqual(readdirSync(intake), []);
});

check("S86-B · the record has NO hash of bytes it never read", () => {
  const config = options("s86-no-hash", { declaredSubmitters: [] });
  const witness = new Witness(config);
  const intake = config.intakeDir as string;
  mkdirSync(intake, { recursive: true });
  if (!unreadableDrop(intake, "denied", "never read")) {
    console.log("    (skipped: running as root)");
    return;
  }

  const [result] = witness.pollIntake();
  assert.strictEqual(result.record.kind, "UNREADABLE_DROP");
  const witnessed = result.record.witnessed;

  // THE ASSERTION THAT MATTERS. A `sha256` here would digest something the
  // witness never saw; a record implying a read that did not happen is a false
  // attestation, and the store is append-only, so it would never be correctable.
  assert.deepStrictEqual(Object.keys(witnessed).sort(), ["error", "mode", "size"]);
  assert.ok(!("sha256" in witnessed), "UNREADABLE_DROP must carry no content hash");
  assert.ok(!("byteLength" in witnessed), "byteLength would also imply a read");

  // What `stat` DID answer is kept, because it is what was actually observed.
  assert.deepStrictEqual(witnessed.mode, { state: "OBSERVED", value: 0o000 });
  assert.strictEqual(witnessed.size.state, "OBSERVED");
  assert.ok(/EACCES|permission denied/i.test(witnessed.error));

  // No receipt, ever: nothing was declared, nothing was read, nothing is signed.
  assert.strictEqual(result.receipt, null);
  assert.strictEqual(result.receiptPath, null);
});

check("S86-C · a stat that ALSO refuses is itself the observation", () => {
  const config = options("s86-stat-refused", { declaredSubmitters: [] });
  const witness = new Witness(config);
  const intake = config.intakeDir as string;
  mkdirSync(intake, { recursive: true });

  // A dangling symlink: `statSync` follows it and throws, so the witness cannot
  // even learn whether this entry is a file. It is handled, never skipped —
  // skipping it would leave it on the intake forever.
  symlinkSync(join(intake, "no-such-target"), join(intake, "dangling"));

  const [result] = witness.pollIntake();
  assert.strictEqual(result.record.kind, "UNREADABLE_DROP");
  const witnessed = result.record.witnessed;
  assert.strictEqual(witnessed.size.state, "READ_FAILED");
  assert.strictEqual(witnessed.mode.state, "READ_FAILED");
  assert.ok(/ENOENT/.test(witnessed.size.reason));
  assert.deepStrictEqual(readdirSync(intake), []);
});

check("S86-D · the sixth kind chains, survives a reload, and verifies", () => {
  const config = options("s86-chains", { declaredSubmitters: [] });
  const witness = new Witness(config);
  const intake = config.intakeDir as string;
  mkdirSync(intake, { recursive: true });
  symlinkSync(join(intake, "no-such-target"), join(intake, "dangling"));
  witness.pollIntake();

  assert.deepStrictEqual(witness.verify(), { valid: true, brokenAt: null });

  // Off the DISK: the record must parse, validate, and re-hash from a cold
  // start, which is the only proof the canonical form covers the new fields.
  const reloaded = new Witness({ ...config, appender: undefined });
  assert.strictEqual(reloaded.getLoadState(), "LOADED_VERIFIED");
  assert.deepStrictEqual(reloaded.verify(), { valid: true, brokenAt: null });
  assert.deepStrictEqual(
    storedRecords(config.storePath).map((r) => r.kind),
    ["PLACEMENT", "UNREADABLE_DROP", "PLACEMENT"]
  );
});

check("S86-E · the canonical form of the sixth kind is the record's own fields", () => {
  const config = options("s86-canonical", { declaredSubmitters: [] });
  const witness = new Witness(config);
  const intake = config.intakeDir as string;
  mkdirSync(intake, { recursive: true });
  symlinkSync(join(intake, "no-such-target"), join(intake, "dangling"));
  const [result] = witness.pollIntake();
  const record = result.record;

  assert.strictEqual(
    canonicalWitnessRecord(record),
    [
      String(record.seq),
      String(record.arrivalTs),
      record.submitterId,
      "UNREADABLE_DROP",
      ...payloadFields(record),
      record.previousHash,
    ].join(" ")
  );
});

check("S86-F · RULING A — a name beginning with `.` is an IN-FLIGHT FRAME, not a submission", () => {
  const config = options("s86-framing", {
    declaredSubmitters: ["mica-node"],
  });
  deployOutbox(config);
  const witness = new Witness(config);
  const intake = config.intakeDir as string;
  mkdirSync(intake, { recursive: true });

  // What an atomic producer's directory looks like mid-write: a half-written
  // dotted frame beside a finished submission. Before RULING A the witness read
  // the frame and retained a MALFORMED_SUBMISSION THAT WAS NEVER SENT — an
  // accusation against a submitter that did nothing wrong, in an append-only
  // book, permanently.
  writeFileSync(join(intake, ".mica-node.a1b2c3"), '{"seq_no":1,"head_ha');
  writeFileSync(join(intake, "mica-node"), bytes(head()));

  const results = witness.pollIntake();
  assert.deepStrictEqual(
    results.map((r) => [r.record.submitterId, r.record.kind]),
    [["mica-node", "HEAD_COMMIT"]]
  );
  // The frame is UNTOUCHED — not read, and above all not DELETED. Deleting a
  // frame mid-rename would destroy a submission that was on its way.
  assert.deepStrictEqual(readdirSync(intake), [".mica-node.a1b2c3"]);
  assert.strictEqual(
    readFileSync(join(intake, ".mica-node.a1b2c3"), "utf8"),
    '{"seq_no":1,"head_ha'
  );
});

check("S86-G · a dotted name is skipped BEFORE stat, so an unreadable frame is inert too", () => {
  const config = options("s86-framing-unreadable", { declaredSubmitters: [] });
  const witness = new Witness(config);
  const intake = config.intakeDir as string;
  mkdirSync(intake, { recursive: true });
  symlinkSync(join(intake, "no-such-target"), join(intake, ".dangling-frame"));

  assert.deepStrictEqual(witness.pollIntake(), []);
  assert.deepStrictEqual(readdirSync(intake), [".dangling-frame"]);
});

// ══════════════════════════════════════════════════════════════════════════════
// S88 · THE DECLARED MODALITY (R8; the third value ruled by the arbiter, 2026-08-26)
//
// S-4 went from a four-field freeze to a five-field one. These checks are the
// acceptance surface for that: what a five-key drop does, what a four-key drop
// does, what an out-of-enum drop does, and — the load-bearing one — that the
// new field is HASHED and not merely stored.

console.log("\n── S88 · the declared modality ────────────────────────────────");

check("S88-A · THE FLIP TEST — a modality edited on disk BREAKS verify() at that seq", () => {
  // THE WHOLE POINT OF THE FIELD. A modality that is stored but not hashed can
  // be rewritten from IMPOSED to OFFERED with the chain still verifying, which
  // is precisely the false attestation this instrument exists to make loud. If
  // this check ever goes green while `canonicalWitnessed` has stopped covering
  // the field, the check is wrong, not the code — read the mutation back.
  const config = options("s88-flip");
  deployOutbox(config);
  const witness = new Witness(config);
  witness.submitRaw(bytes(head(3, "h3", 33, "IMPOSED")), "mica-node");
  assert.deepStrictEqual(witness.verify(), { valid: true, brokenAt: null });

  const lines = readFileSync(config.storePath, "utf8").split("\n").filter((l) => l.length > 0);
  const target = lines.findIndex((l) => (JSON.parse(l) as WitnessRecord).kind === "HEAD_COMMIT");
  assert.ok(target > 0, "there is a HEAD_COMMIT to mutate");
  const record = JSON.parse(lines[target]) as { witnessed: { modality: string } };
  assert.strictEqual(record.witnessed.modality, "IMPOSED");
  record.witnessed.modality = "OFFERED";
  lines[target] = JSON.stringify(record);
  writeFileSync(config.storePath, lines.join("\n") + "\n", "utf8");

  const reloaded = new Witness({ ...config, appender: undefined });
  assert.strictEqual(reloaded.getLoadState(), "STORE_BREAK");
  assert.deepStrictEqual(reloaded.verify(), { valid: false, brokenAt: target });
});

check("S88-B · the flip test holds for UNDECLARED_SUBMITTER too", () => {
  const config = options("s88-flip-undeclared", { declaredSubmitters: [] });
  const witness = new Witness(config);
  witness.submitRaw(bytes(head(4, "h4", 44, "IMPOSED")), "a-stranger");
  assert.deepStrictEqual(witness.verify(), { valid: true, brokenAt: null });

  const lines = readFileSync(config.storePath, "utf8").split("\n").filter((l) => l.length > 0);
  const target = lines.findIndex(
    (l) => (JSON.parse(l) as WitnessRecord).kind === "UNDECLARED_SUBMITTER"
  );
  assert.ok(target > 0);
  const record = JSON.parse(lines[target]) as { witnessed: { modality: string } };
  record.witnessed.modality = "NOT_AN_INSTRUCTION";
  lines[target] = JSON.stringify(record);
  writeFileSync(config.storePath, lines.join("\n") + "\n", "utf8");

  const reloaded = new Witness({ ...config, appender: undefined });
  assert.deepStrictEqual(reloaded.verify(), { valid: false, brokenAt: target });
});

check("S88-C · a FOUR-key legacy drop is UNDECLARED_MODALITY — not malformed, no receipt", () => {
  const config = options("s88-legacy");
  const witness = new Witness(config);
  const legacy = legacyHead(5, "h5", 55);
  const result = witness.submitRaw(bytes(legacy), "mica-node");

  assert.strictEqual(result.record.kind, "UNDECLARED_MODALITY");
  // EXACTLY the four fields presented, and NOT ONE MORE. A `modality` key here
  // in any form — including null or "" — would be the witness authoring a
  // declaration on the submitter's behalf.
  assert.deepStrictEqual(result.record.witnessed, legacy);
  assert.deepStrictEqual(Object.keys(result.record.witnessed).sort(), [
    "head_hash",
    "seq_no",
    "ts",
    "witness_set_id",
  ]);
  assert.strictEqual(result.receipt, null, "receipts attest HEAD_COMMITs only");
  assert.strictEqual(result.receiptPath, null);
  assert.strictEqual(existsSync(config.outboxDir), false, "no outbox is even created");
});

check("S88-D · the drop is CONSUMED and the sweep continues past it", () => {
  const config = options("s88-legacy-sweep");
  const witness = new Witness(config);
  const intake = config.intakeDir as string;
  mkdirSync(intake, { recursive: true });
  writeFileSync(join(intake, "mica-node"), JSON.stringify(legacyHead(1, "h1", 11)), "utf8");

  const results = witness.pollIntake();
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].record.kind, "UNDECLARED_MODALITY");
  assert.deepStrictEqual(readdirSync(intake), [], "the drop is consumed like any other");
});

check("S88-E · the seventh kind chains, survives a reload, and verifies", () => {
  const config = options("s88-chains");
  const witness = new Witness(config);
  witness.submitRaw(bytes(legacyHead(2, "h2", 22)), "mica-node");
  assert.deepStrictEqual(witness.verify(), { valid: true, brokenAt: null });

  // Off the DISK: only a cold reload proves the closed schema and the canonical
  // form both cover the new kind.
  const reloaded = new Witness({ ...config, appender: undefined });
  assert.strictEqual(reloaded.getLoadState(), "LOADED_VERIFIED");
  assert.deepStrictEqual(reloaded.verify(), { valid: true, brokenAt: null });
  assert.deepStrictEqual(
    storedRecords(config.storePath).map((r) => r.kind),
    ["PLACEMENT", "UNDECLARED_MODALITY", "PLACEMENT"]
  );
});

check("S88-F · the canonical form of the seventh kind is its FOUR presented fields", () => {
  const config = options("s88-canonical");
  const witness = new Witness(config);
  const [record] = [witness.submitRaw(bytes(legacyHead(6, "h6", 66)), "mica-node").record];

  assert.strictEqual(
    canonicalWitnessRecord(record),
    [
      String(record.seq),
      String(record.arrivalTs),
      record.submitterId,
      "UNDECLARED_MODALITY",
      ...payloadFields(record),
      record.previousHash,
    ].join(" ")
  );
  assert.strictEqual(payloadFields(record).length, 4);
});

check("S88-G · a five-key drop whose modality is OUTSIDE the enum is MALFORMED", () => {
  // The enum is CHANNEL FRAMING, exactly as the exact-key rule already is. The
  // digest retains the attempt; nothing about it is adjudicated.
  const config = options("s88-bad-enum");
  const witness = new Witness(config);
  const raw = bytes({
    seq_no: 1,
    head_hash: "h1",
    ts: 11,
    witness_set_id: "set-alpha",
    modality: "COERCED",
  });
  const result = witness.submitRaw(raw, "mica-node");

  assert.strictEqual(result.record.kind, "MALFORMED_SUBMISSION");
  assert.strictEqual(result.record.witnessed.byteLength, raw.byteLength);
  assert.strictEqual(
    result.record.witnessed.sha256,
    createHash("sha256").update(raw).digest("hex"),
    "the attempt is retained by digest"
  );
  assert.strictEqual(result.receipt, null);
});

check("S88-H · lowercase, empty and null modalities are all MALFORMED, none coerced", () => {
  const config = options("s88-bad-enum-family");
  const witness = new Witness(config);
  for (const bad of ["offered", "", null, 0, { m: "OFFERED" }]) {
    const result = witness.submitRaw(
      bytes({ seq_no: 1, head_hash: "h", ts: 1, witness_set_id: "s", modality: bad }),
      "mica-node"
    );
    assert.strictEqual(
      result.record.kind,
      "MALFORMED_SUBMISSION",
      `${JSON.stringify(bad)} must not be coerced into the enum`
    );
  }
});

check("S88-I · a SIXTH key is still MALFORMED — the exact-key rule did not loosen", () => {
  const config = options("s88-six-keys");
  const witness = new Witness(config);
  const result = witness.submitRaw(
    bytes({ ...head(1, "h1", 11), extra: "one key too many" }),
    "mica-node"
  );
  assert.strictEqual(result.record.kind, "MALFORMED_SUBMISSION");
});

check("S88-J · PRECEDENCE — an undeclared submitter with a VALID five-key commit", () => {
  // Identity before completeness: ONE record, and it names the identity.
  const config = options("s88-precedence", { declaredSubmitters: [] });
  const witness = new Witness(config);
  const before = witness.readAll().length;
  const result = witness.submitRaw(bytes(head(7, "h7", 77, "IMPOSED")), "a-stranger");

  assert.strictEqual(result.record.kind, "UNDECLARED_SUBMITTER");
  assert.strictEqual(witness.readAll().length, before + 1, "exactly one record per drop");
  assert.strictEqual(result.receipt, null);
});

check("S88-K · the cell the order cannot reach: undeclared submitter, FOUR-key drop", () => {
  // An UNDECLARED_SUBMITTER record's payload IS a five-key commit, and a
  // four-key drop has no fifth key — retaining one as UNDECLARED_SUBMITTER
  // would mean the witness authoring the missing modality. So this lands as
  // UNDECLARED_MODALITY, and THE UNDECLARED NAME IS STILL RETAINED, on the
  // record frame, where a reader holding the roster finds it.
  const config = options("s88-precedence-legacy", { declaredSubmitters: ["mica-node"] });
  const witness = new Witness(config);
  const result = witness.submitRaw(bytes(legacyHead(8, "h8", 88)), "a-stranger");

  assert.strictEqual(result.record.kind, "UNDECLARED_MODALITY");
  assert.strictEqual(result.record.submitterId, "a-stranger");
  assert.strictEqual(result.receipt, null);
});

check("S88-L · a declared five-key commit still receipts, and the receipt is unchanged", () => {
  // The receipt preimage is {seq_no, head_hash, witness_ts} and S88 did NOT
  // widen it: a receipt attests ARRIVAL of a head, and the modality is a
  // submitter's claim about its own act, not something a witness countersigns.
  const config = options("s88-receipt");
  // The claim is about a RECEIPT's shape, so the key is placed deliberately.
  deployKey(config);
  deployOutbox(config);
  const witness = new Witness(config);
  const result = witness.submitRaw(bytes(head(9, "h9", 99, "OFFERED")), "mica-node");

  assert.strictEqual(result.record.kind, "HEAD_COMMIT");
  assert.strictEqual(result.record.witnessed.modality, "OFFERED");
  assert.ok(result.receipt !== null);
  assert.deepStrictEqual(Object.keys(result.receipt as object).sort(), [
    "head_hash",
    "seq_no",
    "witness_sig",
    "witness_ts",
  ]);
});

check("S88-M · the drop the PRODUCER writes is exactly the five keys, in order", () => {
  const config = options("s88-producer");
  const intake = config.intakeDir as string;
  mkdirSync(intake, { recursive: true });
  fileDropCommitter(intake, "mica-node")(head(2, "h2", 22, "IMPOSED"));

  assert.strictEqual(
    readFileSync(join(intake, "mica-node"), "utf8"),
    '{"seq_no":2,"head_hash":"h2","ts":22,"witness_set_id":"set-alpha","modality":"IMPOSED"}'
  );
  assert.deepStrictEqual(DROP_HEAD_KEYS, [
    "seq_no",
    "head_hash",
    "ts",
    "witness_set_id",
    "modality",
  ]);
});

check("S88-N · producer to retainer, end to end: the modality survives the wire", () => {
  const config = options("s88-round-trip");
  deployOutbox(config);
  const witness = new Witness(config);
  const intake = config.intakeDir as string;
  mkdirSync(intake, { recursive: true });
  fileDropCommitter(intake, "mica-node")(head(4, "h4", 44, "IMPOSED"));

  const [result] = witness.pollIntake();
  assert.strictEqual(result.record.kind, "HEAD_COMMIT");
  assert.strictEqual(result.record.witnessed.modality, "IMPOSED");
  assert.strictEqual(result.record.witnessed.head_hash, "h4");
});

check("S88-P · THE CONSUMER DOES NOT CREATE THE INTAKE EITHER — a missing one is loud", () => {
  // The S86 cut removed the auto-create from both PRODUCERS and left this side
  // untouched. A consumer that conjures the intake makes one at the process
  // umask — no setgid, wrong group — that submitters cannot write to, so every
  // submission fails at the far end while this sweep reads an empty directory
  // forever and reports zero drops. That is indistinguishable from "nobody
  // submitted anything", which is the one sentence a witness must never say by
  // accident. It now throws instead.
  const config = options("s88-no-intake");
  const witness = new Witness(config);
  const intake = config.intakeDir as string;
  assert.strictEqual(existsSync(intake), false, "nothing pre-created it");

  assert.throws(() => witness.pollIntake(), /ENOENT/);
  assert.strictEqual(existsSync(intake), false, "and the sweep did NOT conjure it");
  // Nothing was retained over the refusal: the store holds only the
  // constructor's own PLACEMENT.
  assert.deepStrictEqual(
    storedRecords(config.storePath).map((r) => r.kind),
    ["PLACEMENT"]
  );
  assert.deepStrictEqual(witness.verify(), { valid: true, brokenAt: null });
});

check("S88-Q · a DEPLOYED intake sweeps normally — the cut costs the honest path nothing", () => {
  const config = options("s88-deployed-intake");
  deployOutbox(config);
  const witness = new Witness(config);
  const intake = config.intakeDir as string;
  // The deployment act, modelled: `3730`, group `mica-drops`. A test that
  // pre-creates the intake models a deployer who performed it.
  mkdirSync(intake, { recursive: true });
  assert.deepStrictEqual(witness.pollIntake(), [], "an empty deployed intake is fine");

  writeFileSync(join(intake, "mica-node"), JSON.stringify(head(1, "h1", 11)), "utf8");
  const results = witness.pollIntake();
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].record.kind, "HEAD_COMMIT");
});

check("S88-O · WITNESSED_KINDS is the nine, in order, and every one is named", () => {
  // THE ORDER IS PART OF THE ASSERTION. These strings are kind labels on
  // retained records; the list may be APPENDED to and must never be reordered
  // or renamed, because a rename is a rewrite of what a record on disk says it
  // is. S105 appended the eighth and ninth.
  assert.deepStrictEqual([...WITNESSED_KINDS], [
    "HEAD_COMMIT",
    "MALFORMED_SUBMISSION",
    "UNDECLARED_SUBMITTER",
    "PLACEMENT",
    "KEY_UNAVAILABLE",
    "UNREADABLE_DROP",
    "UNDECLARED_MODALITY",
    "NAMED_HEAD_COMMIT",
    "NAMED_UNDECLARED_SUBMITTER",
  ]);
  assert.deepStrictEqual([...MODALITIES], ["OFFERED", "IMPOSED", "NOT_AN_INSTRUCTION"]);
});

// ══════════════════════════════════════════════════════════════════════════════
// S92 · THE READBACK — the witness checks its own handwriting
//
// The append is an injected SEAM, and a seam that RETURNS is not a seam that
// WROTE. Before this build, live state advanced on the strength of a call that
// came back: a pen that silently wrote nothing, or wrote something other than
// the record handed to it, left the chain in memory holding a record the book
// did not. That divergence surfaced only at the NEXT append, where the re-sync
// called the file "truncated or replaced" — deferred, and conditional on there
// being a next append at all.
//
// These tests say the raise is now at THIS append, under the same lock, before
// anything advances. They also fence the two things the throw must NOT become:
// a retry, and a repair.

console.log("\n══ S92 · the readback ══");

check("S92-A · a pen that writes NOTHING advances nothing, and still releases the lock", () => {
  let pen: "writes" | "swallows" = "writes";
  const appender: LineAppender = (path, line) => {
    if (pen === "swallows") return;
    appendFileSync(path, line, "utf8");
  };
  const config = options("s92-pen-swallows", { keyPath: undefined, appender });
  const witness = new Witness(config);
  pen = "swallows";
  const bytesBefore = readFileSync(config.storePath, "utf8");
  const prefixBefore = witness.readAll();

  assert.throws(
    () => witness.submitRaw(bytes(head()), "mica-node"),
    /did not find the record it had just written/
  );

  assert.deepStrictEqual(
    witness.readAll(),
    prefixBefore,
    "live state advanced over a record the book never received"
  );
  assert.strictEqual(readFileSync(config.storePath, "utf8"), bytesBefore);
  assert.strictEqual(
    existsSync(appendLockPath(config.storePath)),
    false,
    "the readback throw escaped without releasing the lock"
  );

  // And NOT a retry: the pen was called once for the record that never landed.
  // A fresh witness on the same path, with the production pen, loads clean.
  const reloaded = new Witness({ ...config, appender: undefined });
  assert.strictEqual(reloaded.getLoadState(), "LOADED_VERIFIED");
  assert.deepStrictEqual(reloaded.verify(), { valid: true, brokenAt: null });
});

check("S92-B · a pen that writes SOMETHING ELSE names the store, the expectation and the finding", () => {
  const OTHER = '{"seq":99,"not":"the record you handed me"}';
  let pen: "writes" | "corrupts" = "writes";
  const appender: LineAppender = (path, line) => {
    appendFileSync(path, pen === "corrupts" ? OTHER + "\n" : line, "utf8");
  };
  const config = options("s92-pen-corrupts", { keyPath: undefined, appender });
  const witness = new Witness(config);
  pen = "corrupts";
  const prefixBefore = witness.readAll();

  let raised: string | null = null;
  try {
    witness.submitRaw(bytes(head()), "mica-node");
  } catch (error) {
    raised = (error as Error).message;
  }
  assert.ok(raised !== null, "a corrupted line was accepted as this record");
  const said = raised ?? "";

  assert.match(said, /did not find the record it had just written/);
  assert.ok(said.includes(config.storePath), "the message must name the store it read");
  assert.ok(said.includes(OTHER), "the message must say what was FOUND");
  assert.match(said, /"kind":"HEAD_COMMIT"/, "the message must say what was EXPECTED");
  // The idiom, fenced: no timer, no second attempt, no repair path.
  assert.match(said, /no second attempt and no repair/);

  assert.deepStrictEqual(witness.readAll(), prefixBefore);
  assert.strictEqual(existsSync(appendLockPath(config.storePath)), false);
});

check("S92-C · the witness whose ONLY record vanishes raises AT THAT APPEND, not at the next", () => {
  // The §2 sentence, executed: the pen empties the book instead of extending it,
  // on the constructor's own PLACEMENT. There is no next append to defer to and
  // no re-sync to notice later — so if this one does not raise, nothing ever
  // does. No half-made witness escapes, exactly as a dry pen already could not.
  const config = options("s92-only-record-vanishes", {
    keyPath: undefined,
    appender: (path) => writeFileSync(path, "", "utf8"),
  });

  assert.throws(() => new Witness(config), /the store holds no records at all/);
  assert.deepStrictEqual(storedRecords(config.storePath), []);
  assert.strictEqual(existsSync(appendLockPath(config.storePath)), false);
});

check("S92-D · the readback is silent when the line IS in the book, and the book matches the chain", () => {
  const config = options("s92-readback-silent");
  deployOutbox(config);
  const witness = new Witness(config);
  const result = witness.submitRaw(bytes(head()), "mica-node");

  // Line for line, the book and the live chain say the same thing — which is
  // the invariant the readback exists to hold, read off the disk to prove it.
  const onDisk = readFileSync(config.storePath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  assert.deepStrictEqual(onDisk, witness.readAll().map((record) => JSON.stringify(record)));
  assert.strictEqual(result.record.kind, "HEAD_COMMIT");
  assert.ok(
    onDisk.includes(JSON.stringify(result.record)),
    "the record handed back to the caller is not the one on disk"
  );
  assert.deepStrictEqual(witness.verify(), { valid: true, brokenAt: null });
  assert.strictEqual(existsSync(appendLockPath(config.storePath)), false);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── S97 · the store directory is a DEPLOYMENT ACT, and this witness will not make one ──");

check("S97-W1 · an absent store directory throws, and the message is a SIGNPOST", () => {
  // Built by hand rather than through `options()`: that helper creates the
  // store's parent, which is the very act this test needs UNPERFORMED. A
  // negative test that leans on the fixture proving the positive case is the
  // vacuous-check class this build exists to end.
  const base = join(root, `s97-absent-store-${counter++}`);
  const neverMade = join(base, "witness");
  const config: WitnessOptions = {
    witnessSetId: "set-alpha",
    declaredSubmitters: ["mica-node"],
    witnessClock: () => 1_000,
    storePath: join(neverMade, "witness.jsonl"),
    outboxDir: join(base, "outbox"),
    keyPath: join(base, "witness-private.pem"),
    intakeDir: join(base, "intake"),
  };
  assert.strictEqual(existsSync(base), false, "the test's own premise moved");

  let caught: unknown = null;
  try {
    new Witness(config);
  } catch (error) {
    caught = error;
  }

  // ASSERT ON THE OUTPUT, NEVER ON "IT THREW" (S96-B candidate 1). All three
  // signpost elements are named separately, so a message that keeps the shape
  // and loses a part fails here.
  assert.ok(caught instanceof WitnessDeploymentActMissing, `wrong error type: ${String(caught)}`);
  const message = (caught as Error).message;
  assert.ok(message.includes("this is a deployment act"), message);  // the act
  assert.ok(message.includes("deploy recipe §5.1"), message);        // the section
  assert.ok(
    message.includes(`${neverMade} at 2750 mica-witness:mica-readers`),
    message
  );                                                                  // the expected state
  assert.ok(message.includes("Nothing was created"), message);
  assert.strictEqual((caught as WitnessDeploymentActMissing).path, neverMade);
});

check("S97-W2 · nothing is created and NO PLACEMENT is appended — read off the filesystem", () => {
  const base = join(root, `s97-absent-store-${counter++}`);
  const neverMade = join(base, "witness");
  const storePath = join(neverMade, "witness.jsonl");
  mkdirSync(base, { recursive: true });   // the PARENT exists; the store dir does not
  assert.throws(
    () =>
      new Witness({
        witnessSetId: "set-alpha",
        declaredSubmitters: ["mica-node"],
        witnessClock: () => 1_000,
        storePath,
        outboxDir: join(base, "outbox"),
        keyPath: join(base, "witness-private.pem"),
        intakeDir: join(base, "intake"),
      }),
    WitnessDeploymentActMissing
  );

  // The throw is half the claim. The other half is the disk: `recursive: true`
  // would have made BOTH levels, and the constructor would then have appended a
  // PLACEMENT into a book born at the process umask. Neither happened.
  assert.strictEqual(existsSync(neverMade), false, "the store directory was created after all");
  assert.strictEqual(existsSync(storePath), false, "a store file was created after all");
  assert.deepStrictEqual(readdirSync(base), [], "something was written beside the store");
});

check("S97-W3 · a store path whose parent is a FILE is refused too, and says so", () => {
  const base = join(root, `s97-parent-is-a-file-${counter++}`);
  mkdirSync(base, { recursive: true });
  const notADirectory = join(base, "witness");
  writeFileSync(notADirectory, "this is a file, not the deployment act\n", "utf8");
  let caught: unknown = null;
  try {
    new Witness({
      witnessSetId: "set-alpha",
      declaredSubmitters: ["mica-node"],
      witnessClock: () => 1_000,
      storePath: join(notADirectory, "witness.jsonl"),
      outboxDir: join(base, "outbox"),
      keyPath: join(base, "witness-private.pem"),
      intakeDir: join(base, "intake"),
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof WitnessDeploymentActMissing, `wrong error type: ${String(caught)}`);
  assert.ok((caught as Error).message.includes("exists and is not a directory"), (caught as Error).message);
  assert.strictEqual(
    readFileSync(notADirectory, "utf8"),
    "this is a file, not the deployment act\n",
    "the file standing where the directory belongs was touched"
  );
});

check("S98-W5 · `paths()` performs NO act — the fixture creates and writes nothing", () => {
  // The anti-rot fence for the S97-D(1) refactor. `paths()` used to make the
  // store's parent (recipe §5.1) and write the signing key, invisibly, for every
  // body in this file. If either creeps back, the three named acts below stop
  // meaning anything and the S97 negative bodies go back to having to escape
  // this helper by hand — which is how the defect was spotted in the first place.
  const p = paths("s98-fixture-performs-nothing");
  assert.strictEqual(existsSync(dirname(p.storePath)), false, "paths() made the store directory");
  assert.strictEqual(existsSync(p.storePath), false, "paths() made the store file");
  assert.strictEqual(existsSync(p.outboxDir), false, "paths() made the outbox");
  assert.strictEqual(existsSync(p.intakeDir), false, "paths() made the intake");
  assert.strictEqual(existsSync(p.keyPath), false, "paths() wrote the signing key");

  // And the three acts are separable: §5.1 alone leaves §5.2 and the key undone.
  const config: WitnessOptions = {
    witnessSetId: "set-alpha",
    declaredSubmitters: ["mica-node"],
    witnessClock: () => 1_000,
    ...p,
  };
  deployStoreDir(config);
  assert.strictEqual(existsSync(dirname(p.storePath)), true, "§5.1 did not happen");
  assert.strictEqual(existsSync(p.outboxDir), false, "§5.1 also made the outbox");
  assert.strictEqual(existsSync(p.keyPath), false, "§5.1 also placed the key");
});

check("S98-W6 · a CONFIGURED key that is absent is not the same finding as no key at all", () => {
  // The polarity the old fixture hid. Twenty bodies carried `keyPath: undefined`
  // to decline a key they never wanted; nothing exercised the other state — a
  // deployment that DECLARES a key path and never placed the file. The two
  // retain different KEY_UNAVAILABLE records, and only one of them names a path
  // an operator can go and look at.
  const declaredButAbsent = options("s98-key-declared-absent");
  const w1 = new Witness(declaredButAbsent);
  w1.submitRaw(bytes(head()), "mica-node");
  const r1 = w1.readAll()[w1.readAll().length - 1];
  assert.strictEqual(r1.kind, "KEY_UNAVAILABLE");
  assert.strictEqual(
    (r1.witnessed as { keyPath: string | null }).keyPath,
    declaredButAbsent.keyPath,
    "a declared-but-absent key must name the path the deployer was supposed to fill"
  );

  const noneDeclared = options("s98-key-undeclared", { keyPath: undefined });
  const w2 = new Witness(noneDeclared);
  w2.submitRaw(bytes(head()), "mica-node");
  const r2 = w2.readAll()[w2.readAll().length - 1];
  assert.strictEqual(r2.kind, "KEY_UNAVAILABLE");
  assert.strictEqual(
    (r2.witnessed as { keyPath: string | null }).keyPath,
    null,
    "an undeclared key must not invent a path"
  );
});

check("S97-W4 · witness.ts CALLS mkdirSync nowhere — the fence, checked at bytes", () => {
  // The fence is on the CALL, not on the word (R-P3's rule, S95): this file
  // names `mkdirSync` three times in prose in order to forbid it, and a fence
  // that banned the word would be satisfied by deleting the argument.
  const source = readFileSync(join(__dirname, "witness.ts"), "utf8");
  assert.doesNotMatch(
    codeOnly(source),
    /mkdirSync\s*\(/,
    "witness.ts must not create a directory anywhere"
  );
  // And the reasons must still be there, so the next hand finds an argument
  // where it looks for the missing call. One per cut: store, outbox, intake.
  assert.strictEqual((source.match(/mkdirSync/g) ?? []).length, 3, source.slice(0, 0));
  assert.match(source, /deployment act/);
});


console.log("\n-- S105 . the head names its chain ----------------------------");

// ==============================================================================
// THE DEBT (board S102-E, ruled dowry S103-A, ruled option (b) by the arbiter S105).
//
// `HeadCommit` named no chain. The registrar drops N BOOK heads through ONE
// committer under ONE witness_set_id; the refusal log shipped
// CHAINED-BUT-TRUNCATABLE for the same reason. A nameless head can be presented
// as any chain's head, and a silent chain is invisible among the others.
//
// THE BRIEF WAS CONTRADICTED ON ONE POINT, and these tests are where the
// contradiction is checked rather than argued. The brief said the OLD shape
// should take a new deficit-name, following S88. It cannot: the intake's schema
// is CLOSED, every retained record is re-validated on load, and redefining
// HEAD_COMMIT to six keys stops a store that verified yesterday from verifying
// today. S105-C is that check.

check("S105-A . a SIX-key named drop is NAMED_HEAD_COMMIT, receipted, chain intact", () => {
  const config = options("s105-named");
  deployOutbox(config);
  deployKey(config);
  const witness = new Witness(config);
  const result = witness.submitRaw(
    bytes(namedHead(4, "h4", 44, "precommit:mica-doctor")),
    "mica-node"
  );

  assert.strictEqual(result.record.kind, "NAMED_HEAD_COMMIT");
  assert.deepStrictEqual(result.record.witnessed, {
    seq_no: 4,
    head_hash: "h4",
    ts: 44,
    witness_set_id: "set-alpha",
    modality: "OFFERED",
    chain_id: "precommit:mica-doctor",
  });
  assert.notStrictEqual(
    result.receipt,
    null,
    "a named head from a declared submitter is receipted"
  );
  assert.strictEqual(witness.verify().valid, true);
});

check("S105-B . TWO CHAINS, ONE witness_set_id -- told apart by chain_id ALONE", () => {
  // THIS IS THE WHOLE POINT. Same submitter, same witness set, same seq_no,
  // same modality: before S105 these two records were indistinguishable and
  // either could be presented as the other's chain head.
  const config = options("s105-two-chains");
  const witness = new Witness(config);
  const a = witness.submitRaw(bytes(namedHead(9, "h9", 99, "precommit:book-a")), "mica-node");
  const b = witness.submitRaw(bytes(namedHead(9, "h9", 99, "precommit:book-b")), "mica-node");

  const fieldsA = a.record.witnessed as NamedHeadCommit;
  const fieldsB = b.record.witnessed as NamedHeadCommit;
  assert.strictEqual(fieldsA.chain_id, "precommit:book-a");
  assert.strictEqual(fieldsB.chain_id, "precommit:book-b");
  // Every OTHER field is equal -- so chain_id is carrying the distinction by
  // itself, and this assertion fails the day something else starts carrying it.
  const withoutChain = (c: NamedHeadCommit): Record<string, unknown> => {
    const copy: Record<string, unknown> = { ...c };
    delete copy.chain_id;
    return copy;
  };
  assert.deepStrictEqual(
    withoutChain(fieldsA),
    withoutChain(fieldsB),
    "nothing but chain_id may separate these two"
  );
  assert.notStrictEqual(a.record.hash, b.record.hash, "and the difference reaches the hash");
});

check("S105-C . a store written BEFORE S105 still loads, still verifies, keeps its kinds", () => {
  // The control the brief named: old records are retained, never reinterpreted,
  // never backfilled. This store is written in the PRE-S105 shapes and must come
  // back exactly as it went in.
  const config = options("s105-old-store");
  const before = new Witness(config);
  before.submitRaw(bytes(head(1, "h1", 11)), "mica-node");            // HEAD_COMMIT
  before.submitRaw(bytes(head(2, "h2", 22)), "a-stranger");           // UNDECLARED_SUBMITTER
  before.submitRaw(bytes(legacyHead(3, "h3", 33)), "mica-node");      // UNDECLARED_MODALITY
  before.submitRaw(Buffer.from("{not json", "utf8"), "mica-node");    // MALFORMED_SUBMISSION

  const reopened = new Witness(config);
  assert.strictEqual(reopened.getLoadState(), "LOADED_VERIFIED");
  assert.strictEqual(reopened.verify().valid, true);
  // The PLACEMENT frames are the witness observing ITSELF at each start, and the
  // KEY_UNAVAILABLE is this config having no signing key. They are listed
  // because they are what the store HOLDS -- a control that quietly filtered
  // the store down to the records it expected would not be reading the store.
  assert.deepStrictEqual(
    reopened.readAll().map((r: WitnessRecord) => r.kind),
    [
      "PLACEMENT",
      "HEAD_COMMIT",
      "KEY_UNAVAILABLE",
      "UNDECLARED_SUBMITTER",
      "UNDECLARED_MODALITY",
      "MALFORMED_SUBMISSION",
      "PLACEMENT",
    ]
  );
  // And a five-key drop STILL retains as HEAD_COMMIT after S105 -- the old kind
  // is a kind, not a deprecation.
  const still = reopened.submitRaw(bytes(head(5, "h5", 55)), "mica-node");
  assert.strictEqual(still.record.kind, "HEAD_COMMIT");
  assert.strictEqual(reopened.verify().valid, true);
});

check("S105-D . a named drop from an UNDECLARED submitter: the NAME is the finding, no receipt", () => {
  const config = options("s105-named-stranger");
  deployOutbox(config);
  deployKey(config);
  const witness = new Witness(config);
  const result = witness.submitRaw(
    bytes(namedHead(6, "h6", 66, "refusal:registrar")),
    "a-stranger"
  );

  assert.strictEqual(result.record.kind, "NAMED_UNDECLARED_SUBMITTER");
  assert.strictEqual(result.record.submitterId, "a-stranger");
  assert.strictEqual(result.receipt, null, "naming your chain is not being on the roster");
  // ALL SIX FIELDS ARE RETAINED. The witness discards nothing a submitter said
  // in order to reuse a narrower kind.
  assert.strictEqual(
    (result.record.witnessed as NamedHeadCommit).chain_id,
    "refusal:registrar"
  );
  assert.strictEqual(witness.verify().valid, true);
});

check("S105-E . THE FLIP TEST -- a chain_id edited on disk BREAKS verify() at that seq", () => {
  // The field is HASHED, not merely stored. A chain_id that was stored and not
  // hashed could be rewritten on disk and a head would silently change chains
  // with verify() still saying VALID -- the exact false attestation this
  // instrument exists to make loud.
  const config = options("s105-flip");
  const witness = new Witness(config);
  witness.submitRaw(bytes(namedHead(1, "h1", 11, "precommit:book-a")), "mica-node");
  witness.submitRaw(bytes(namedHead(2, "h2", 22, "precommit:book-a")), "mica-node");

  assert.deepStrictEqual(witness.verify(), { valid: true, brokenAt: null });

  const lines = readFileSync(config.storePath, "utf8").split("\n").filter((l) => l.length > 0);
  const target = lines.findIndex(
    (l) => (JSON.parse(l) as WitnessRecord).kind === "NAMED_HEAD_COMMIT"
  );
  assert.ok(target > 0, "there is a NAMED_HEAD_COMMIT to mutate");
  const record = JSON.parse(lines[target]) as { witnessed: { chain_id: string } };
  assert.strictEqual(record.witnessed.chain_id, "precommit:book-a");
  record.witnessed.chain_id = "precommit:book-b";
  lines[target] = JSON.stringify(record);
  writeFileSync(config.storePath, lines.join("\n") + "\n", "utf8");

  // The edited record is PERFECTLY WELL FORMED -- book-b is inside the grammar,
  // so nothing about its schema gives it away. Only the hash does.
  const reloaded = new Witness({ ...config, appender: undefined });
  assert.strictEqual(reloaded.getLoadState(), "STORE_BREAK");
  assert.deepStrictEqual(reloaded.verify(), { valid: false, brokenAt: target });
});

check("S105-F . chain_id sits LAST in the preimage, between two space-free fields", () => {
  // NOT DECORATION. The preimage is space-joined. Two adjacent fields that can
  // both hold a space are a boundary a disk edit can move: different bytes,
  // identical preimage, matching hash. chain_id cannot hold a space, and it is
  // placed between `modality` (an enum) and `previousHash` (a hex digest), so
  // no boundary here is movable. Beside `witness_set_id` -- a free
  // submitter-supplied string -- it would have been.
  const config = options("s105-preimage");
  const witness = new Witness(config);
  const result = witness.submitRaw(
    bytes(namedHead(3, "h3", 33, "precommit:book-a")),
    "mica-node"
  );
  const record = result.record;

  assert.strictEqual(
    canonicalWitnessRecord(record),
    [
      String(record.seq),
      String(record.arrivalTs),
      record.submitterId,
      "NAMED_HEAD_COMMIT",
      "3",
      "h3",
      "33",
      "set-alpha",
      "OFFERED",
      "precommit:book-a",
      record.previousHash,
    ].join(" ")
  );
});

check("S105-G . an unframed chain_id is MALFORMED -- the exact treatment a bad modality gets", () => {
  const config = options("s105-unframed");
  const witness = new Witness(config);
  const rejected: readonly unknown[] = [
    "",                                       // named nothing
    "precommit: book-a",                      // a space: the preimage boundary
    "precommit:book\ta",                      // any whitespace, not just the space
    "precommit:book\na",
    "precommit:../etc",                       // a bare identifier is not a path
    "precommit:a/b",
    "precommit:a\\b",
    "precommit:book\u0001a",                  // a control character
    "x".repeat(129),                          // past the bound
    42,                                       // not a string at all
    null,
  ];
  for (const chainId of rejected) {
    const drop = { ...namedHead(1, "h1", 11), chain_id: chainId };
    const result = witness.submitRaw(bytes(drop), "mica-node");
    assert.strictEqual(
      result.record.kind,
      "MALFORMED_SUBMISSION",
      `chain_id ${JSON.stringify(chainId)} must not frame`
    );
    assert.strictEqual(result.receipt, null);
  }
  // And the digest of the attempt is retained either way: nothing about what
  // arrived is lost by refusing to call it a commit.
  assert.strictEqual(witness.verify().valid, true);
});

check("S105-H . a SEVENTH key is MALFORMED -- the exact-key rule did not loosen", () => {
  const config = options("s105-seventh");
  const witness = new Witness(config);
  const result = witness.submitRaw(
    bytes({ ...namedHead(1, "h1", 11), extra: "surplus" }),
    "mica-node"
  );
  assert.strictEqual(result.record.kind, "MALFORMED_SUBMISSION");
});

check("S105-I . the PRODUCER refuses namelessness -- and names the field it refused for", () => {
  // Ruled: a submission path that cannot name its chain is a DEFECT, NOT A
  // DEFAULT. The producer throws rather than substituting anything, because a
  // committer that quietly filled in "unknown" would put a false name in a
  // retained record and nothing downstream could ever tell.
  for (const bad of ["", "a b", "../x", "a/b", "x".repeat(129)]) {
    assert.throws(
      () => assertFramedChainId(bad),
      /chain_id is missing or unframed/,
      `producer must refuse ${JSON.stringify(bad)}`
    );
  }
  // An ABSENT field reaches the named refusal, not a TypeError about `length`.
  assert.throws(
    () => assertFramedChainId(undefined as unknown as string),
    /chain_id is missing or unframed/
  );
  assert.doesNotThrow(() => assertFramedChainId("precommit:mica-doctor"));
});

check("S105-J . the drop the PRODUCER writes is exactly the six keys, in order", () => {
  const intake = mkdtempSync(join(tmpdir(), "s105-intake-"));
  const drop = fileDropNamedCommitter(intake, "mica-node");
  drop(namedHead(2, "h2", 22, "precommit:book-a"));

  const written = readFileSync(join(intake, "mica-node"), "utf8");
  assert.strictEqual(
    written,
    '{"seq_no":2,"head_hash":"h2","ts":22,"witness_set_id":"set-alpha",' +
      '"modality":"OFFERED","chain_id":"precommit:book-a"}'
  );
  assert.deepStrictEqual(Object.keys(JSON.parse(written)), [...NAMED_DROP_HEAD_KEYS]);
  // The five-key serialiser is NOT retired: HEAD_COMMIT is still a kind, and
  // the named shape is exactly one field wider than it.
  assert.strictEqual(
    Object.keys(JSON.parse(canonicalNamedDropBytes(namedHead()))).length,
    DROP_HEAD_KEYS.length + 1
  );
  rmSync(intake, { recursive: true, force: true });
});

check("S105-K . producer to retainer, end to end: the chain name survives the wire", () => {
  const intake = mkdtempSync(join(tmpdir(), "s105-wire-"));
  const config = options("s105-wire", { intakeDir: intake });
  const witness = new Witness(config);
  fileDropNamedCommitter(intake, "mica-node")(namedHead(5, "h5", 55, "precommit:book-c"));

  const swept = witness.pollIntake();
  assert.strictEqual(swept.length, 1);
  assert.strictEqual(swept[0].record.kind, "NAMED_HEAD_COMMIT");
  assert.strictEqual(
    (swept[0].record.witnessed as NamedHeadCommit).chain_id,
    "precommit:book-c"
  );
  rmSync(intake, { recursive: true, force: true });
});

check("S105-L . A THIRD CHAIN COSTS NO CODE -- only a producer that names itself", () => {
  // The forward-looking control. Nothing in this body configures, registers or
  // declares a chain: `arbiter:ruling-log` is named nowhere else in this
  // repository, and it retains and verifies the same as the two the registrar
  // owns.
  const config = options("s105-third-chain");
  const witness = new Witness(config);
  for (const chainId of ["precommit:book-a", "refusal:registrar", "arbiter:ruling-log"]) {
    const result = witness.submitRaw(bytes(namedHead(1, "h1", 11, chainId)), "mica-node");
    assert.strictEqual(result.record.kind, "NAMED_HEAD_COMMIT");
    assert.strictEqual((result.record.witnessed as NamedHeadCommit).chain_id, chainId);
  }
  assert.strictEqual(witness.verify().valid, true);
});

check("S105-M . the printed grammar states every clause the check enforces", () => {
  // CHAIN_ID_GRAMMAR is the copy a reader is meant to find. A prose rule that
  // has drifted from the check is worse than no prose rule.
  for (const clause of ["non-empty", "128", "whitespace", "control", "<domain>:<owner>"]) {
    assert.ok(CHAIN_ID_GRAMMAR.includes(clause), `the printed grammar must state: ${clause}`);
  }
  assert.ok(
    CHAIN_ID_GRAMMAR.includes("space-joined"),
    "and must say WHY whitespace is barred, not merely that it is"
  );
});

rmSync(root, { recursive: true, force: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
