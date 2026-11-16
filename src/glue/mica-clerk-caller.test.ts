// ── GLUE · mica-clerk-caller — tests ─────────────────────────────────────────
//
// House style: standalone ts-node script, custom check() harness, no framework.
//   npx ts-node src/glue/mica-clerk-caller.test.ts
//
// WHAT THIS FILE PROVES
//
//   The S109 arm-recon receipt's own scoring (§2.1: 4 clean NO / 2 minimal
//   YES) and the brief's four named refusal paths: absent path, wrong-shape
//   input, cursor corruption, clerk socket dead. Signing itself is NOT
//   re-tested here — `SignedSubmitter`/`SocketClerkClient` are exercised
//   already (src/clerk/clerk.test.ts); this file proves the ARM around them:
//   what it reads, what it refuses, what it writes, and in what order.
//
// A FAKE CLERK CLIENT, NOT A SOCKET. Same reason `glue.test.ts` fakes a
// notifier transport rather than opening a real one: this file proves the
// caller's OWN logic (cursor, ordering, fail-loud-and-unmoved, the stamp
// projection), not `SocketClerkClient`'s wire protocol, which has its own
// suite.

import * as assert from "assert";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createHash, generateKeyPairSync } from "crypto";

import {
  carryJobs,
  EXIT,
  parseArgs,
  missingRequired,
  secondTripleProblem,
  LEGACY_CURSOR_MODULE_ID,
  readCursor,
  resolveClerkSocketPath,
  runOnce,
  writeCursor,
} from "./mica-clerk-caller";
import type { Args } from "./mica-clerk-caller";
// T8 · the journal's OWN hash rule, so this fixture cannot disagree with the reader.
import { subjectRecordHash } from "./subject-event-journal";
import { SocketClerkClient } from "../clerk/client";
import type { ClerkClient } from "../clerk/client";
import { defaultSocketPath } from "../clerk/protocol";
import type { Challenge, SubmissionRequest } from "../clerk/core";
import type {
  CadenceRecord,
  GapMarker,
  HeadAnchor,
  SubmissionReceipt,
} from "../clerk/types";

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
async function checkAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const root = mkdtempSync(join(tmpdir(), "mica-clerk-caller-"));
let n = 0;
function scratch(name: string): string {
  const d = join(root, `${String(++n).padStart(2, "0")}-${name}`);
  mkdirSync(d, { recursive: true });
  return d;
}

const { privateKey } = generateKeyPairSync("ed25519");
const KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

function writeLog(dir: string, records: readonly object[]): string {
  const p = join(dir, "log.jsonl");
  writeFileSync(p, records.map((r) => JSON.stringify(r)).join("\n") + (records.length > 0 ? "\n" : ""), "utf8");
  return p;
}

function baseArgs(dir: string, overrides: Partial<Args> = {}): Args {
  const key = join(dir, "submitter.key");
  writeFileSync(key, KEY_PEM, "utf8");
  return {
    log: join(dir, "log.jsonl"),
    cursor: join(dir, "cursor.json"),
    stampsOut: join(dir, "stamps.jsonl"),
    clerkStore: join(dir, "clerk-store"), // unused by the fake client
    clerkSocket: null,
    submitterId: "mica",
    submitterKey: key,
    channel: "mica-log",
    // ACT B: absent by default, so every pre-Act-B case in this file is still
    // exercising the ONE-JOB path it was written for.
    secondLog: null,
    secondCursor: null,
    secondStampsOut: null,
    secondChannel: null,
    malformed: [],
    ...overrides,
  };
}

/** A fake ClerkClient: no socket, deterministic receipts, injectable failure. */
function fakeClient(opts: { failAt?: number } = {}): ClerkClient & { calls: number } {
  let seq = 0;
  const state = { calls: 0 };
  return {
    separation: "SEPARATE_PROCESS",
    calls: 0,
    async challenge(): Promise<Challenge> {
      return { nonce: `nonce-${seq}`, issued_wall_ms: 1000, expires_wall_ms: 2000 };
    },
    async submit(req: SubmissionRequest): Promise<SubmissionReceipt> {
      state.calls++;
      this.calls = state.calls;
      if (opts.failAt !== undefined && state.calls === opts.failAt) {
        throw new Error("SUBMITTER_NOT_IN_ROSTER: fake refusal");
      }
      seq++;
      return {
        receipt_version: 2,
        kind: "SUBMISSION",
        clerk_id: "clerk-fake",
        clerk_boot_id: "boot-fake",
        separation: "SEPARATE_PROCESS",
        separation_warning: null,
        clerk_principal: "mica",
        intake: "SOCKET",
        attests: {
          form: "ILAS-CLERK-ATTESTATION-1",
          attests: [],
          does_not_attest: [],
          against: "OBSERVED_SYSTEM_ONLY",
          note: "",
        },
        clerk_seq: seq,
        clerk_time: { wall_ms: 5000 + seq, monotonic_ns: String(seq) },
        prev_receipt_hash: "0".repeat(64),
        receipt_hash: `hash-${seq}`,
        signature: "sig",
        signature_alg: "ed25519",
        submitter_id: req.submitter_id,
        channel: req.channel,
        declared_timestamp: req.declared_timestamp ?? null,
        payload_commitment: `commit-${seq}`,
        payload_bytes: 1,
        canonical_form: "ILAS-CANON-JSON-1",
        payload_retained: false,
        payload_canonical: null,
      };
    },
    async declareCadence(): Promise<CadenceRecord> {
      throw new Error("not used by this arm");
    },
    async scanCadences(): Promise<GapMarker[]> {
      throw new Error("not used by this arm");
    },
    async head(): Promise<HeadAnchor | null> {
      return null;
    },
    async info() {
      return {
        clerk_id: "clerk-fake",
        separation: "SEPARATE_PROCESS" as const,
        separation_warning: null,
        clerk_principal: "mica",
        public_key: "",
        clerk_seq_next: seq + 1,
        roster_state: "CONFIGURED" as const,
      };
    },
    async close(): Promise<void> {},
  };
}

async function main(): Promise<void> {
  console.log("\n── flags: no defaults ──");

  check("missingRequired lists every unset path", () => {
    const missing = missingRequired({
      log: null,
      cursor: null,
      stampsOut: null,
      clerkStore: null,
      clerkSocket: null,
      submitterId: null,
      submitterKey: null,
      channel: null,
      secondLog: null,
      secondCursor: null,
      secondStampsOut: null,
      secondChannel: null,
      malformed: [],
    });
    assert.deepStrictEqual(missing.sort(), [
      "--channel",
      "--clerk-store",
      "--cursor",
      "--log",
      "--stamps-out",
      "--submitter-id",
      "--submitter-key",
    ]);
  });

  await checkAsync("CANNOT_START when a required flag is absent — nothing submitted", async () => {
    const dir = scratch("missing-flag");
    const args = baseArgs(dir, { channel: null });
    const r = await runOnce(args, fakeClient());
    assert.strictEqual(r.code, EXIT.CANNOT_START);
    assert.strictEqual(r.stampedCount, 0);
  });

  console.log("\n── --clerk-socket: mirrors clerkd.ts's own args.socket ?? defaultSocketPath ──");

  check("resolveClerkSocketPath — ABSENT --clerk-socket is BYTE-IDENTICAL to today's derivation", () => {
    const dir = scratch("socket-absent");
    const args = baseArgs(dir, { clerkStore: join(dir, "some-store") });
    const resolved = resolveClerkSocketPath(args);
    // The exact computation SocketClerkClient.forStore() has always performed
    // internally — this asserts the two are the same value, not just that
    // neither throws.
    assert.strictEqual(resolved, defaultSocketPath(args.clerkStore as string));
    assert.strictEqual(resolved, SocketClerkClient.forStore(args.clerkStore as string).socketPath);
  });

  check("resolveClerkSocketPath — PRESENT --clerk-socket overrides the derivation entirely", () => {
    const dir = scratch("socket-present");
    const args = baseArgs(dir, {
      clerkStore: join(dir, "some-store"),
      clerkSocket: "/run/mica/clerk.sock",
    });
    const resolved = resolveClerkSocketPath(args);
    assert.strictEqual(resolved, "/run/mica/clerk.sock");
    assert.notStrictEqual(resolved, defaultSocketPath(args.clerkStore as string));
  });

  check("resolveClerkSocketPath — routes the connect: the client is built ON that exact path", () => {
    const dir = scratch("socket-routes");
    const explicit = join(dir, "explicit.sock");
    const args = baseArgs(dir, { clerkStore: join(dir, "some-store"), clerkSocket: explicit });
    const client = new SocketClerkClient(resolveClerkSocketPath(args));
    assert.strictEqual(client.socketPath, explicit);
  });

  await checkAsync(
    "fail-loud message names the ACTUAL socket tried, explicit override case",
    async () => {
      const dir = scratch("socket-failloud-explicit");
      const explicit = join(dir, "no-such-explicit.sock");
      const client = new SocketClerkClient(explicit);
      await assert.rejects(client.challenge(), (err: Error) => {
        assert.ok(
          err.message.includes(explicit),
          `error did not name the explicit socket tried: ${err.message}`
        );
        return true;
      });
    }
  );

  await checkAsync(
    "fail-loud message names the ACTUAL socket tried, derived (absent-flag) case",
    async () => {
      const dir = scratch("socket-failloud-derived");
      const store = join(dir, "some-store");
      const args = baseArgs(dir, { clerkStore: store, clerkSocket: null });
      const derived = resolveClerkSocketPath(args);
      const client = new SocketClerkClient(derived);
      await assert.rejects(client.challenge(), (err: Error) => {
        assert.ok(
          err.message.includes(derived) && err.message.includes(store),
          `error did not name the derived socket tried: ${err.message}`
        );
        return true;
      });
    }
  );

  console.log("\n── the cursor: declared, never guessed past ──");

  check("readCursor — ABSENT on first run is an EMPTY map, everything in scope", () => {
    const dir = scratch("cursor-absent");
    const r = readCursor(join(dir, "nope.json"));
    assert.strictEqual(r.state, "ABSENT");
    assert.strictEqual(r.lastStamped.size, 0);
    assert.strictEqual(r.legacy, false);
  });

  check("readCursor — CORRUPT (bad JSON) is refused, not guessed", () => {
    const dir = scratch("cursor-badjson");
    const p = join(dir, "cursor.json");
    writeFileSync(p, "{not json", "utf8");
    const r = readCursor(p);
    assert.strictEqual(r.state, "CORRUPT");
  });

  check("readCursor — CORRUPT (wrong shape) is refused, not guessed", () => {
    const dir = scratch("cursor-wrongshape");
    const p = join(dir, "cursor.json");
    writeFileSync(p, JSON.stringify({ notLastStamped: 3 }), "utf8");
    const r = readCursor(p);
    assert.strictEqual(r.state, "CORRUPT");
  });

  check("readCursor — CORRUPT (negative / non-integer) is refused, not guessed", () => {
    const dir = scratch("cursor-negative");
    const p = join(dir, "cursor.json");
    writeFileSync(p, JSON.stringify({ lastStamped: -5 }), "utf8");
    assert.strictEqual(readCursor(p).state, "CORRUPT");
    writeFileSync(p, JSON.stringify({ lastStamped: 1.5 }), "utf8");
    assert.strictEqual(readCursor(p).state, "CORRUPT");
  });

  check("readCursor / writeCursor round-trip — per writer", () => {
    const dir = scratch("cursor-roundtrip");
    const p = join(dir, "cursor.json");
    writeCursor(p, new Map([["m7", 42], ["m3", 7]]));
    const r = readCursor(p);
    assert.strictEqual(r.state, "OK");
    assert.strictEqual(r.legacy, false);
    assert.deepStrictEqual([...r.lastStamped.entries()].sort(), [["m3", 7], ["m7", 42]]);
    // Keys are written SORTED, so a run that changes nothing rewrites the same bytes.
    assert.strictEqual(readFileSync(p, "utf8"), '{"lastStamped":{"m3":7,"m7":42}}\n');
  });

  check("S127-8 · a LEGACY single-integer cursor reads as one entry, for the named writer", () => {
    const dir = scratch("cursor-legacy-read");
    const p = join(dir, "cursor.json");
    writeFileSync(p, JSON.stringify({ lastStamped: 1 }) + "\n", "utf8");
    const r = readCursor(p);
    assert.strictEqual(r.state, "OK");
    assert.strictEqual(r.legacy, true, "the read must SAY the file was the old shape");
    assert.deepStrictEqual([...r.lastStamped.entries()], [[LEGACY_CURSOR_MODULE_ID, 1]]);
    // READ-ONLY: reading it does not touch the file.
    assert.strictEqual(readFileSync(p, "utf8"), '{"lastStamped":1}\n');
  });

  check("S127-8 · a map carrying a non-integer, a negative, or an empty key is CORRUPT", () => {
    const dir = scratch("cursor-badmap");
    const p = join(dir, "cursor.json");
    for (const bad of [
      { lastStamped: { "mica-doctor": 1.5 } },
      { lastStamped: { "mica-doctor": -5 } },
      { lastStamped: { "mica-doctor": "3" } },
      { lastStamped: { "": 3 } },
      { lastStamped: [1, 2] },
    ]) {
      writeFileSync(p, JSON.stringify(bad), "utf8");
      assert.strictEqual(readCursor(p).state, "CORRUPT", JSON.stringify(bad));
    }
    // An empty map is a valid "nothing stamped for anyone", not a corruption.
    writeFileSync(p, JSON.stringify({ lastStamped: {} }), "utf8");
    const ok = readCursor(p);
    assert.strictEqual(ok.state, "OK");
    assert.strictEqual(ok.lastStamped.size, 0);
  });

  await checkAsync("CORRUPT cursor stops the whole run — nothing submitted, cursor untouched", async () => {
    const dir = scratch("cursor-corrupt-run");
    writeFileSync(join(dir, "cursor.json"), "not json at all", "utf8");
    writeLog(dir, [{ sequenceNumber: 1, timestamp: 1, moduleId: "m", eventType: "e", outcome: "o" }]);
    const client = fakeClient();
    const r = await runOnce(baseArgs(dir), client);
    assert.strictEqual(r.code, EXIT.CANNOT_START);
    assert.strictEqual(r.stampedCount, 0);
    assert.strictEqual(client.calls, 0, "the clerk must never be reached on a corrupt cursor");
    assert.strictEqual(readFileSync(join(dir, "cursor.json"), "utf8"), "not json at all");
  });

  console.log("\n── the MICA log: absent is clean, malformed is refused ──");

  await checkAsync("OK, nothing to do — the log has never been written", async () => {
    const dir = scratch("log-absent");
    const r = await runOnce(baseArgs(dir), fakeClient());
    assert.strictEqual(r.code, EXIT.OK);
    assert.strictEqual(r.stampedCount, 0);
  });

  await checkAsync("OK, nothing to do — the log exists and is empty", async () => {
    const dir = scratch("log-empty");
    writeLog(dir, []);
    const r = await runOnce(baseArgs(dir), fakeClient());
    assert.strictEqual(r.code, EXIT.OK);
    assert.strictEqual(r.stampedCount, 0);
  });

  await checkAsync("CANNOT_START — the log is malformed (wrong-shape input)", async () => {
    const dir = scratch("log-malformed");
    writeFileSync(join(dir, "log.jsonl"), "{not json\n", "utf8");
    const client = fakeClient();
    const r = await runOnce(baseArgs(dir), client);
    assert.strictEqual(r.code, EXIT.CANNOT_START);
    assert.strictEqual(client.calls, 0);
  });

  console.log("\n── the clerk: fail loud, cursor stays put ──");

  await checkAsync("SUBMIT_FAILED — the clerk refuses/dies partway: NOTHING from this run lands", async () => {
    const dir = scratch("clerk-dies");
    writeLog(dir, [
      { sequenceNumber: 1, timestamp: 100, moduleId: "m", eventType: "e", outcome: "o" },
      { sequenceNumber: 2, timestamp: 200, moduleId: "m", eventType: "e", outcome: "o" },
      { sequenceNumber: 3, timestamp: 300, moduleId: "m", eventType: "e", outcome: "o" },
    ]);
    const client = fakeClient({ failAt: 2 }); // dies on the SECOND submission
    const r = await runOnce(baseArgs(dir), client);
    assert.strictEqual(r.code, EXIT.SUBMIT_FAILED);
    assert.strictEqual(r.stampedCount, 0, "a partial batch must never be reported as stamped");
    assert.throws(() => readFileSync(join(dir, "stamps.jsonl"), "utf8"), /ENOENT/);
    assert.throws(() => readFileSync(join(dir, "cursor.json"), "utf8"), /ENOENT/);
  });

  console.log("\n── the happy path: strict order, one write, cursor advances ──");

  await checkAsync("every new record is stamped, in order, and the cursor advances exactly that far", async () => {
    const dir = scratch("happy-path");
    writeLog(dir, [
      { sequenceNumber: 5, timestamp: 100, moduleId: "m", eventType: "e", outcome: "o" },
      { sequenceNumber: 6, timestamp: 200, moduleId: "m", eventType: "e", outcome: "o" },
    ]);
    const client = fakeClient();
    const r = await runOnce(baseArgs(dir), client);
    assert.strictEqual(r.code, EXIT.OK);
    assert.strictEqual(r.stampedCount, 2);

    const stampLines = readFileSync(join(dir, "stamps.jsonl"), "utf8").trim().split("\n");
    assert.strictEqual(stampLines.length, 2);
    const s0 = JSON.parse(stampLines[0]);
    const s1 = JSON.parse(stampLines[1]);
    assert.strictEqual(s0.sequenceNumber, 5);
    assert.strictEqual(s1.sequenceNumber, 6);
    assert.strictEqual(s0.clerk_seq, 1);
    assert.strictEqual(s1.clerk_seq, 2);
    // The projection is a field projection, nothing renamed, nothing computed:
    assert.strictEqual(s0.separation, "SEPARATE_PROCESS");
    assert.strictEqual(s0.intake, "SOCKET");
    assert.strictEqual(s0.clerk_id, "clerk-fake");

    const cursor = readCursor(join(dir, "cursor.json"));
    assert.strictEqual(cursor.state, "OK");
    assert.deepStrictEqual([...cursor.lastStamped.entries()], [["m", 6]]);
  });

  await checkAsync("a second run only carries what the cursor has not yet seen", async () => {
    const dir = scratch("second-run");
    writeLog(dir, [
      { sequenceNumber: 1, timestamp: 100, moduleId: "m", eventType: "e", outcome: "o" },
      { sequenceNumber: 2, timestamp: 200, moduleId: "m", eventType: "e", outcome: "o" },
    ]);
    const client1 = fakeClient();
    await runOnce(baseArgs(dir), client1);

    // Append a third record — the second run must touch ONLY this one.
    const p = join(dir, "log.jsonl");
    writeFileSync(
      p,
      readFileSync(p, "utf8") +
        JSON.stringify({ sequenceNumber: 3, timestamp: 300, moduleId: "m", eventType: "e", outcome: "o" }) +
        "\n",
      "utf8"
    );
    const client2 = fakeClient();
    const r = await runOnce(baseArgs(dir), client2);
    assert.strictEqual(r.stampedCount, 1);
    assert.strictEqual(client2.calls, 1, "a re-run must not resubmit what the cursor already covers");

    const stampLines = readFileSync(join(dir, "stamps.jsonl"), "utf8").trim().split("\n");
    assert.strictEqual(stampLines.length, 3, "the second run APPENDS; it does not rewrite the first run's stamps");
  });

  console.log("\n── S127-8: the cursor is per writer, and the legacy shape migrates on success ──");

  // The twelve-record shape from S127-6's own fixture (glue.test.ts,
  // THREE_WRITER_SHAPE), re-declared here rather than imported: importing a
  // *.test.ts would RUN it. Indices 0-2 are the arbiter's description of the
  // live head; 3-11 are a constructed interleaving. Module and sequence are
  // what this is about.
  const THREE_WRITER_SHAPE: readonly (readonly [string, number])[] = [
    ["mica-registrar", 0],
    ["mica-registrar", 1],
    ["mica-doctor", 0],
    ["mica-registrar", 2],
    ["mica-doctor", 1],
    ["mica-arbiter", 0],
    ["mica-registrar", 3],
    ["mica-doctor", 2],
    ["mica-arbiter", 1],
    ["mica-registrar", 4],
    ["mica-doctor", 3],
    ["mica-arbiter", 2],
  ];

  /** The dispatch's own arithmetic: registrar 0-9, then one record each from the other two. */
  const REGISTRAR_HEAVY_SHAPE: readonly (readonly [string, number])[] = [
    ...Array.from({ length: 10 }, (_, i) => ["mica-registrar", i] as const),
    ["mica-doctor", 0],
    ["mica-arbiter", 0],
  ];

  function writeShape(dir: string, pairs: readonly (readonly [string, number])[]): void {
    writeLog(
      dir,
      pairs.map(([moduleId, sequenceNumber], i) => ({
        sequenceNumber,
        timestamp: 100 + i,
        moduleId,
        eventType: "e",
        outcome: "o",
      }))
    );
  }

  function cursorOnDisk(dir: string): Record<string, number> {
    return JSON.parse(readFileSync(join(dir, "cursor.json"), "utf8")).lastStamped as Record<string, number>;
  }

  await checkAsync(
    "S127-8 · legacy cursor {lastStamped:1} over the twelve-record shape stamps the TEN unstamped records",
    async () => {
      const dir = scratch("s1278-twelve");
      writeShape(dir, THREE_WRITER_SHAPE);
      writeFileSync(join(dir, "cursor.json"), JSON.stringify({ lastStamped: 1 }) + "\n", "utf8");
      const client = fakeClient();
      const r = await runOnce(baseArgs(dir), client);
      assert.strictEqual(r.code, EXIT.OK);
      // registrar 2,3,4 (its own 0 and 1 are covered) + doctor 0..3 + arbiter 0..2
      assert.strictEqual(r.stampedCount, 10, r.messages.join(" | "));
      assert.strictEqual(client.calls, 10);

      // THE WHOLE POINT: doctor 0 and arbiter 0 are BELOW the legacy cursor and
      // are stamped anyway, because the cursor they are measured against is
      // their own writer's and that writer has no entry.
      const stamped = readFileSync(join(dir, "stamps.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l).sequenceNumber as number);
      assert.strictEqual(stamped.filter((x) => x === 0).length, 2, "doctor 0 and arbiter 0 must both be stamped");
      // File order, not sorted by sequenceNumber.
      assert.deepStrictEqual(stamped, [0, 2, 1, 0, 3, 2, 1, 4, 3, 2]);

      assert.deepStrictEqual(cursorOnDisk(dir), {
        "mica-arbiter": 2,
        "mica-doctor": 3,
        "mica-registrar": 4,
      });

      // An immediate re-run stamps NOTHING and never reaches the clerk.
      const client2 = fakeClient();
      const again = await runOnce(baseArgs(dir), client2);
      assert.strictEqual(again.code, EXIT.OK);
      assert.strictEqual(again.stampedCount, 0);
      assert.strictEqual(client2.calls, 0);
      assert.strictEqual(
        readFileSync(join(dir, "stamps.jsonl"), "utf8").trim().split("\n").length,
        10,
        "a re-run must not append a second copy of anything"
      );
    }
  );

  await checkAsync(
    "S127-8 · the dispatch's own numbers: registrar 0-9 + doctor 0 + arbiter 0, legacy cursor 1",
    async () => {
      const dir = scratch("s1278-regheavy");
      writeShape(dir, REGISTRAR_HEAVY_SHAPE);
      writeFileSync(join(dir, "cursor.json"), JSON.stringify({ lastStamped: 1 }) + "\n", "utf8");
      const client = fakeClient();
      const r = await runOnce(baseArgs(dir), client);
      assert.strictEqual(r.code, EXIT.OK);
      // registrar 2-9 (eight) + doctor 0 + arbiter 0 = ten
      assert.strictEqual(r.stampedCount, 10, r.messages.join(" | "));
      assert.deepStrictEqual(cursorOnDisk(dir), {
        "mica-arbiter": 0,
        "mica-doctor": 0,
        "mica-registrar": 9,
      });
    }
  );

  await checkAsync("S127-8 · a REFUSED run leaves a legacy cursor file BYTE-IDENTICAL", async () => {
    const dir = scratch("s1278-refused");
    writeShape(dir, THREE_WRITER_SHAPE);
    const legacyBytes = JSON.stringify({ lastStamped: 1 }) + "\n";
    writeFileSync(join(dir, "cursor.json"), legacyBytes, "utf8");
    // The clerk refuses partway through the batch.
    const client = fakeClient({ failAt: 4 });
    const r = await runOnce(baseArgs(dir), client);
    assert.strictEqual(r.code, EXIT.SUBMIT_FAILED);
    assert.strictEqual(r.stampedCount, 0);
    assert.strictEqual(
      readFileSync(join(dir, "cursor.json"), "utf8"),
      legacyBytes,
      "the migration must happen on a SUCCESSFUL run and on no other path"
    );
    assert.throws(() => readFileSync(join(dir, "stamps.jsonl"), "utf8"), /ENOENT/);
  });

  await checkAsync("S127-8 · a writer this batch did not touch keeps its entry", async () => {
    const dir = scratch("s1278-carry");
    writeShape(dir, [["mica-doctor", 4]]);
    writeFileSync(
      join(dir, "cursor.json"),
      JSON.stringify({ lastStamped: { "mica-registrar": 9, "mica-doctor": 3 } }) + "\n",
      "utf8"
    );
    const r = await runOnce(baseArgs(dir), fakeClient());
    assert.strictEqual(r.stampedCount, 1);
    assert.deepStrictEqual(cursorOnDisk(dir), { "mica-doctor": 4, "mica-registrar": 9 });
  });

  console.log("\n── S133 wire B: a pilot's chain review is carried like any other record ──");

  await checkAsync(
    "WB-CLERK · a PILOT_CHAIN_REVIEWED record from mica-arbiter is submitted like any other — there is NO kind guard to add it to",
    async () => {
      // THE CLAIM WIRE B RESTS ON, ASSERTED RATHER THAN READ OFF THE SOURCE.
      // The brief's §2.3 allowed for a kind-aware guard that might refuse an
      // unknown eventType and would then need the new kind adding to an
      // allow-list. There is none: selection here is the per-writer cursor and
      // nothing else, so a record this arm has never seen before travels on the
      // same rails as the registrar's own. If a guard is ever added, this test
      // is what fails and names what it broke.
      const dir = scratch("wireb-kind");
      writeLog(dir, [
        { sequenceNumber: 0, timestamp: 100, moduleId: "mica-registrar", eventType: "DEPOSIT_ACCEPTED", outcome: "ok" },
        {
          sequenceNumber: 0,
          timestamp: 200,
          moduleId: "mica-arbiter",
          eventType: "PILOT_CHAIN_REVIEWED",
          // THE SHA IS COMPUTED, NOT TYPED — `evidence-log.test.ts`'s EV-FIX-H3
          // is a standing sweep against a literal 64-hex hash anywhere in a
          // probe/evidence test, and it caught the first cut of this fixture.
          // The rule is right and the fixture was wrong: a digest nobody
          // computed is a digest nobody can check, in a test as much as in a
          // record.
          outcome:
            `chain=${createHash("sha256").update("wire-b fixture chain", "utf8").digest("hex")} ` +
            "subject=mica-subject1 run=pilot8-n5",
        },
      ]);
      const client = fakeClient();
      const r = await runOnce(baseArgs(dir), client);
      assert.strictEqual(r.code, EXIT.OK, JSON.stringify(r.messages));
      assert.strictEqual(r.stampedCount, 2, "both records were carried");
      assert.strictEqual(client.calls, 2);
      // AND THE TWO SEQUENCE NUMBERS ARE BOTH ZERO. Two writers, two counters —
      // the shape S127-6 ruled. The cursor keeps them apart by moduleId; the
      // STAMPS FILE below does not, which is the gap `ledger-lookup.ts`'s
      // STAMP_NOT_DETERMINABLE names and pilot 9's beat owes.
      const stamps = readFileSync(join(dir, "stamps.jsonl"), "utf8")
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as { sequenceNumber: number });
      assert.deepStrictEqual(stamps.map((x) => x.sequenceNumber), [0, 0]);
      assert.deepStrictEqual(cursorOnDisk(dir), { "mica-arbiter": 0, "mica-registrar": 0 });
    }
  );


  // ── ACT B · the second carry job ───────────────────────────────────────────
  //
  // Route (a) of the Act B brief: this ONE arm, under the ONE submitter
  // identity it already holds, carries the bridge's subject chain as well as
  // the registrar's journal — so the subject log gets a second principal's
  // arrival stamp without a new keypair, a roster entry or a uid.
  console.log("\n── Act B: a second journal in the same run ──");

  /** The chain Act A writes: a boundary at seq 0, then 1-based subject events. */
  /**
   * T8 · A REAL CHAIN, NOT A CHAIN-SHAPED FILE.
   *
   * ⛔ THIS FIXTURE USED TO CARRY LITERAL HASHES — `"0".repeat(64)`,
   * `"c".repeat(64)` — and that was fine for as long as the carrier read this
   * file with `MicaLogFile`, which does not check them. T8 makes the job-2 arm
   * read it CHAIN-AWARE, and the chain-aware reader recomputes every hash: the
   * old fixture loads as SUBJECT_CHAIN_BROKEN and the carrier refuses it,
   * correctly. A fixture whose hashes are decorative cannot test a reader whose
   * job is to check them.
   *
   * Hashes are computed with the journal's OWN `subjectRecordHash` rather than
   * a copy of its rule, for the same reason the carrier reads the identity off
   * the chain rather than recomputing it: a second implementation of a hash is
   * a second answer waiting to disagree.
   */
  function writeSubjectChain(dir: string, events: number): string {
    const p = join(dir, "subject-events.jsonl");
    const lines: string[] = [];
    let previousHash = "";
    const seal = (withoutHash: Record<string, unknown>): string => {
      const hash = subjectRecordHash(withoutHash);
      lines.push(JSON.stringify({ ...withoutHash, hash }));
      previousHash = hash;
      return hash;
    };
    seal({
      recordType: "SUBJECT_LOG_BOUNDARY",
      sequenceNumber: 0,
      previousHash: "",
      retired: null,
      basis: "first boot",
      timestamp: 1000,
      moduleId: "MICA/SubjectLog",
      eventType: "SUBJECT_LOG_BOUNDARY",
      outcome: "BOUNDARY_DECLARED",
    });
    for (let i = 1; i <= events; i++) {
      seal({
        subjectSeq: i,
        ts: new Date(1000 + i * 10).toISOString(),
        identity: { subject: "agent/alpha", actionId: `act-${String(i)}` },
        kind: "TASK_DONE",
        eventHash: "b".repeat(64),
        peerUid: 1000,
        sequenceNumber: i,
        timestamp: 1000 + i * 10,
        moduleId: "agent/alpha",
        eventType: "TASK_DONE",
        actionId: `act-${String(i)}`,
        outcome: "OK",
        recordType: "SUBJECT_EVENT",
        previousHash,
      });
    }
    writeFileSync(p, lines.join("\n") + "\n", "utf8");
    return p;
  }

  function secondTriple(dir: string): Partial<Args> {
    return {
      secondLog: join(dir, "subject-events.jsonl"),
      secondCursor: join(dir, "subject-cursor.json"),
      secondStampsOut: join(dir, "subject-stamps.jsonl"),
    };
  }

  function stampsIn(path: string): { moduleId: string; sequenceNumber: number; clerk_seq: number }[] {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l));
  }

  check("secondTripleProblem — all three absent is ONE job, no label, no complaint", () => {
    const args = baseArgs(scratch("actb-absent-shape"));
    assert.strictEqual(secondTripleProblem(args), null);
    const jobs = carryJobs(args);
    assert.strictEqual(jobs.length, 1);
    assert.strictEqual(jobs[0].label, "", "a one-job run's label must be empty — that is what keeps ABSENT byte-identical");
  });

  check("secondTripleProblem — a PARTIAL triple is refused and names exactly what is missing", () => {
    const dir = scratch("actb-partial");
    const problem = secondTripleProblem(baseArgs(dir, { secondLog: join(dir, "x.jsonl") }));
    assert.ok(problem !== null, "a partial triple must be refused");
    assert.ok(/--second-cursor/.test(problem as string));
    assert.ok(/--second-stamps-out/.test(problem as string));
    assert.ok(!/--second-log/.test(problem as string), "the flag that WAS supplied must not be listed as missing");
  });

  check("secondTripleProblem — --second-channel with no second job is refused, never silently ignored", () => {
    const problem = secondTripleProblem(baseArgs(scratch("actb-orphan-channel"), { secondChannel: "subject" }));
    assert.ok(problem !== null);
    assert.ok(/--second-channel/.test(problem as string));
  });

  check("carryJobs — absent --second-channel IS the primary channel; present overrides it", () => {
    const dir = scratch("actb-channel");
    const inherited = carryJobs(baseArgs(dir, secondTriple(dir)));
    assert.strictEqual(inherited[1].channel, "mica-log");
    const overridden = carryJobs(baseArgs(dir, { ...secondTriple(dir), secondChannel: "subject-chain" }));
    assert.strictEqual(overridden[1].channel, "subject-chain");
  });

  await checkAsync(
    "ACT B · ABSENT-IS-IDENTICAL — the same log, run with and without a second triple, is byte-identical",
    async () => {
      const shape = [
        { sequenceNumber: 0, timestamp: 100, moduleId: "mica-registrar", eventType: "DEPOSIT_ACCEPTED", outcome: "ok" },
        { sequenceNumber: 1, timestamp: 200, moduleId: "mica-registrar", eventType: "DEPOSIT_ACCEPTED", outcome: "ok" },
      ];
      const before = scratch("actb-identity-before");
      writeLog(before, shape);
      const clientBefore = fakeClient();
      const baseline = await runOnce(baseArgs(before), clientBefore);

      // The SAME primary journal, in a run that also declares a second one
      // whose log does not exist — so the second job contributes a message but
      // cannot touch the first job's cursor, stamps or clerk traffic.
      const after = scratch("actb-identity-after");
      writeLog(after, shape);
      const clientAfter = fakeClient();
      const twoJob = await runOnce(baseArgs(after, secondTriple(after)), clientAfter);

      assert.strictEqual(twoJob.code, baseline.code);
      assert.strictEqual(twoJob.stampedCount, baseline.stampedCount);
      assert.strictEqual(clientAfter.calls, clientBefore.calls, "the second job must not add clerk traffic of its own");
      assert.strictEqual(
        readFileSync(join(after, "stamps.jsonl"), "utf8"),
        readFileSync(join(before, "stamps.jsonl"), "utf8"),
        "the primary stamps file must be byte-identical"
      );
      assert.strictEqual(
        readFileSync(join(after, "cursor.json"), "utf8"),
        readFileSync(join(before, "cursor.json"), "utf8"),
        "the primary cursor must be byte-identical"
      );
      // The one-job run's messages carry NO label; the two-job run's do.
      assert.ok(baseline.messages.every((m) => !/^journal /.test(m)), baseline.messages.join(" | "));
      assert.ok(twoJob.messages.some((m) => /^journal 1 /.test(m)));
      assert.ok(twoJob.messages.some((m) => /^journal 2 /.test(m)));
    }
  );

  await checkAsync(
    "ACT B · the carrier on a CHAINED subject log CARRIES THE GENESIS LINE — seq 0 is stamped",
    async () => {
      // THE DECISION, PINNED HERE. sig/index.ts joins every entry `getAll()`
      // returns, and SubjectChainLog.getAll() returns the boundary record as
      // entry 0. A carrier that skipped it would leave seq 0 unstamped and F3
      // would read CANNOT_ASSESS for ever. So: carried, and this is the test
      // that says so.
      const dir = scratch("actb-genesis");
      writeLog(dir, []);
      writeSubjectChain(dir, 3);
      const client = fakeClient();
      const r = await runOnce(baseArgs(dir, secondTriple(dir)), client);
      assert.strictEqual(r.code, EXIT.OK, r.messages.join(" | "));
      assert.strictEqual(r.stampedCount, 4, "boundary + three events");

      const stamps = stampsIn(join(dir, "subject-stamps.jsonl"));
      assert.deepStrictEqual(stamps.map((x) => x.sequenceNumber), [0, 1, 2, 3]);
      assert.strictEqual(stamps[0].moduleId, "MICA/SubjectLog", "the boundary's own writer, named on its stamp");
      // Two cursors, kept apart.
      assert.deepStrictEqual(
        JSON.parse(readFileSync(join(dir, "subject-cursor.json"), "utf8")).lastStamped,
        { "MICA/SubjectLog": 0, "agent/alpha": 3 }
      );
      // The PRIMARY stamps file must not have received one line of this.
      assert.throws(() => readFileSync(join(dir, "stamps.jsonl"), "utf8"), /ENOENT/);
    }
  );

  // ══ T8 · EVERY JOB-2 STAMP NAMES ITS CHAIN, AND A LOG WITH NO BOUNDARY IS
  //        REFUSED ════════════════════════════════════════════════════════════
  //
  // The arbiter's ruling, 2026-09-29 (the fork): "the job-2 arm reads the subject log
  // chain-aware and REFUSES a log with no boundary at position 0."

  await checkAsync(
    "T8 · every job-2 stamp carries chainIdentity = the position-0 boundary's OWN hash",
    async () => {
      const dir = scratch("t8-identity");
      writeLog(dir, []);
      writeSubjectChain(dir, 3);
      const r = await runOnce(baseArgs(dir, secondTriple(dir)), fakeClient());
      assert.strictEqual(r.code, EXIT.OK, r.messages.join(" | "));

      // ⛔ THE EXPECTED VALUE IS READ OFF THE FILE, NOT RECOMPUTED HERE. If this
      // test computed the boundary hash from the fixture's fields it would pass
      // even if the carrier recomputed it too — and the one failure mode T8's
      // acceptance names ("read from the chain rather than recomputed") would be
      // invisible. Reading line 0's own `hash` is what the carrier must have done.
      const boundaryHash = JSON.parse(
        readFileSync(join(dir, "subject-events.jsonl"), "utf8").split("\n")[0]
      ).hash as string;
      assert.ok(/^[0-9a-f]{64}$/.test(boundaryHash), boundaryHash);

      const stamps = stampsIn(join(dir, "subject-stamps.jsonl"));
      assert.strictEqual(stamps.length, 4);
      for (const st of stamps) {
        assert.strictEqual(
          (st as unknown as { chainIdentity?: string }).chainIdentity,
          boundaryHash,
          `stamp for seq ${String(st.sequenceNumber)} does not name the chain`
        );
      }
    }
  );

  await checkAsync(
    "T8 · JOB 1 carries NO chainIdentity — the registrar's log is not chained and has none to name",
    async () => {
      // ⚠ THE ASYMMETRY IS THE DESIGN, NOT AN OVERSIGHT. Job 1 reads the
      // registrar's plain JSONL: there is no boundary record, so there is no
      // chain identity that would be TRUE. Writing one anyway — a constant, the
      // file's digest, anything — would be the carrier inventing an attribution,
      // which is the exact move T8 exists to forbid. F3 refuses job 1's stamps,
      // and nothing reads job 1's stamps through F3.
      const dir = scratch("t8-job1-unchained");
      writeLog(dir, [{ sequenceNumber: 0, timestamp: 1000, moduleId: "m", eventType: "a", outcome: "ok" }]);
      writeSubjectChain(dir, 1);
      const r = await runOnce(baseArgs(dir, secondTriple(dir)), fakeClient());
      assert.strictEqual(r.code, EXIT.OK, r.messages.join(" | "));
      for (const st of stampsIn(join(dir, "stamps.jsonl"))) {
        assert.strictEqual(
          (st as unknown as { chainIdentity?: string }).chainIdentity,
          undefined,
          "job 1 must not claim a chain it does not have"
        );
      }
      // And job 2's in the same run DO carry one — so this is an asymmetry
      // between the jobs, not the feature simply being off.
      assert.ok(
        stampsIn(join(dir, "subject-stamps.jsonl")).every(
          (st) => typeof (st as unknown as { chainIdentity?: string }).chainIdentity === "string"
        )
      );
    }
  );

  await checkAsync(
    "T8 · a job-2 log with NO boundary at position 0 is REFUSED — nothing submitted, cursor unmoved",
    async () => {
      const dir = scratch("t8-no-boundary");
      writeLog(dir, []);
      // A well-formed subject log that simply never declared where it began:
      // the chain-aware reader's SUBJECT_CHAIN_NO_BOUNDARY, which the plain
      // reader would have read as an ordinary file and carried happily.
      writeFileSync(
        join(dir, "subject-events.jsonl"),
        JSON.stringify({
          subjectSeq: 1,
          ts: new Date(1010).toISOString(),
          identity: { subject: "agent/alpha", actionId: "act-1" },
          kind: "TASK_DONE",
          eventHash: "b".repeat(64),
          peerUid: 1000,
          sequenceNumber: 1,
          timestamp: 1010,
          moduleId: "agent/alpha",
          eventType: "TASK_DONE",
          actionId: "act-1",
          outcome: "OK",
          recordType: "SUBJECT_EVENT",
          previousHash: "",
          hash: "c".repeat(64),
        }) + "\n",
        "utf8"
      );
      const client = fakeClient();
      const r = await runOnce(baseArgs(dir, secondTriple(dir)), client);
      assert.strictEqual(r.code, EXIT.CANNOT_START, r.messages.join(" | "));
      assert.strictEqual(r.stampedCount, 0);
      // NOTHING REACHED THE CLERK. A refusal that had already submitted would
      // have produced clerk receipts with nowhere to go.
      assert.strictEqual(client.calls, 0, "a refused job must not talk to the clerk");
      assert.throws(() => readFileSync(join(dir, "subject-stamps.jsonl"), "utf8"), /ENOENT/);
      assert.throws(() => readFileSync(join(dir, "subject-cursor.json"), "utf8"), /ENOENT/);
      // The refusal SAYS WHY, and says it in terms of the boundary.
      assert.ok(
        r.messages.some((m) => /SUBJECT_LOG_BOUNDARY record at position 0/.test(m)),
        r.messages.join(" | ")
      );
    }
  );

  await checkAsync(
    "T8 · a TAMPERED job-2 chain is REFUSED — the hashes are checked, not trusted",
    async () => {
      // The fixture's own hashes are real (see writeSubjectChain). Move one byte
      // of a record's payload and the recomputation must disagree. THIS IS THE
      // TEST THE OLD DECORATIVE-HASH FIXTURE COULD NOT HAVE PASSED OR FAILED.
      const dir = scratch("t8-tampered");
      writeLog(dir, []);
      writeSubjectChain(dir, 2);
      const path = join(dir, "subject-events.jsonl");
      const lines = readFileSync(path, "utf8").trimEnd().split("\n");
      const rec = JSON.parse(lines[1]) as Record<string, unknown>;
      rec.outcome = "TAMPERED";
      lines[1] = JSON.stringify(rec);
      writeFileSync(path, lines.join("\n") + "\n", "utf8");

      const client = fakeClient();
      const r = await runOnce(baseArgs(dir, secondTriple(dir)), client);
      assert.strictEqual(r.code, EXIT.CANNOT_START, r.messages.join(" | "));
      assert.strictEqual(client.calls, 0);
      assert.ok(
        r.messages.some((m) => /HASH-CHAINED SUBJECT LOG/.test(m)),
        r.messages.join(" | ")
      );
    }
  );

  await checkAsync(
    "ACT B · a second run carries only what the SECOND cursor has not seen",
    async () => {
      const dir = scratch("actb-incremental");
      writeLog(dir, []);
      writeSubjectChain(dir, 2);
      const first = await runOnce(baseArgs(dir, secondTriple(dir)), fakeClient());
      assert.strictEqual(first.stampedCount, 3);
      writeSubjectChain(dir, 4);
      const client = fakeClient();
      const second = await runOnce(baseArgs(dir, secondTriple(dir)), client);
      assert.strictEqual(second.code, EXIT.OK, second.messages.join(" | "));
      assert.strictEqual(second.stampedCount, 2, "only seq 3 and 4 are new");
      assert.strictEqual(client.calls, 2);
      assert.deepStrictEqual(
        stampsIn(join(dir, "subject-stamps.jsonl")).map((x) => x.sequenceNumber),
        [0, 1, 2, 3, 4]
      );
    }
  );

  await checkAsync(
    "ACT B · MUTANT — a stamp keyed to a PRE-ROTATION sequence number is refused",
    async () => {
      // Sequence numbers RESTART at the rotation, and F3 joins on the number
      // ALONE. So a retired chain's stamp for seq 2 does not FAIL against the
      // new chain's seq 2 — it JOINS, wrongly, and F3 reports a real receipt
      // against the wrong record. The catch: an ABSENT cursor means this job
      // has stamped nothing, so a non-empty stamps file is somebody else's.
      const dir = scratch("actb-prerotation");
      writeLog(dir, []);
      writeSubjectChain(dir, 3);
      const stale = join(dir, "subject-stamps.jsonl");
      writeFileSync(
        stale,
        JSON.stringify({
          moduleId: "agent/alpha",
          sequenceNumber: 2,
          clerk_seq: 77,
          clerk_time: { wall_ms: 1, monotonic_ns: "1" },
          separation: "SEPARATE_PROCESS",
          intake: "SOCKET",
          clerk_id: "clerk-fake",
          clerk_boot_id: "boot-fake",
        }) + "\n",
        "utf8"
      );
      const staleBytes = readFileSync(stale, "utf8");
      const client = fakeClient();
      const r = await runOnce(baseArgs(dir, secondTriple(dir)), client);
      assert.strictEqual(r.code, EXIT.CANNOT_START, r.messages.join(" | "));
      assert.strictEqual(r.stampedCount, 0);
      assert.strictEqual(client.calls, 0, "nothing may reach the clerk");
      assert.ok(r.messages.some((m) => /CURSOR IS ABSENT BUT 1 STAMP/.test(m)), r.messages.join(" | "));
      assert.strictEqual(readFileSync(stale, "utf8"), staleBytes, "the inherited file is neither merged nor truncated");
    }
  );

  await checkAsync(
    "ACT B · job 1 failing does NOT skip job 2 — the S127-6 scar, not rebuilt one layer up",
    async () => {
      const dir = scratch("actb-independent");
      // The PRIMARY journal is malformed: CANNOT_START for job 1.
      writeFileSync(join(dir, "log.jsonl"), JSON.stringify({ nope: true }) + "\n", "utf8");
      writeSubjectChain(dir, 2);
      const client = fakeClient();
      const r = await runOnce(baseArgs(dir, secondTriple(dir)), client);
      assert.strictEqual(r.code, EXIT.CANNOT_START, "the run reports the WORST code");
      assert.strictEqual(r.stampedCount, 3, "job 2 still carried the whole chain");
      assert.strictEqual(client.calls, 3);
      assert.deepStrictEqual(
        stampsIn(join(dir, "subject-stamps.jsonl")).map((x) => x.sequenceNumber),
        [0, 1, 2]
      );
      assert.ok(r.messages.some((m) => /^journal 1 .*COULD NOT BE READ CLEANLY/.test(m)), r.messages.join(" | "));
      assert.ok(r.messages.some((m) => /^journal 2 .*3 record\(s\) stamped/.test(m)), r.messages.join(" | "));
    }
  );

  await checkAsync(
    "ACT B · ONE identity for the run — two jobs, one clerk handshake",
    async () => {
      const dir = scratch("actb-one-identity");
      writeLog(dir, [
        { sequenceNumber: 0, timestamp: 100, moduleId: "mica-registrar", eventType: "DEPOSIT_ACCEPTED", outcome: "ok" },
      ]);
      writeSubjectChain(dir, 1);
      // `SignedSubmitter.forClient` is ONE `info()` call (client.ts:293); the
      // per-submission `challenge()` (client.ts:302) is a different thing and is
      // not what this pins. The identity is established once per RUN — so two
      // jobs cost ONE info(), not two.
      let infos = 0;
      const client = fakeClient();
      const counting: ClerkClient = {
        ...client,
        async info() {
          infos++;
          return client.info();
        },
      };
      const r = await runOnce(baseArgs(dir, secondTriple(dir)), counting);
      assert.strictEqual(r.code, EXIT.OK, r.messages.join(" | "));
      assert.strictEqual(r.stampedCount, 3, "1 registrar record + boundary + 1 subject event");
      assert.strictEqual(infos, 1, "the submitter identity is the RUN's, established once");
    }
  );

  await checkAsync(
    "ACT B · MUTANT — the two journals' stamps never cross into each other's file",
    async () => {
      const dir = scratch("actb-wrong-log");
      writeLog(dir, [
        { sequenceNumber: 0, timestamp: 100, moduleId: "mica-registrar", eventType: "DEPOSIT_ACCEPTED", outcome: "ok" },
        { sequenceNumber: 1, timestamp: 110, moduleId: "mica-registrar", eventType: "DEPOSIT_ACCEPTED", outcome: "ok" },
      ]);
      writeSubjectChain(dir, 2);
      const r = await runOnce(baseArgs(dir, { ...secondTriple(dir), secondChannel: "subject-chain" }), fakeClient());
      assert.strictEqual(r.code, EXIT.OK, r.messages.join(" | "));
      const primary = stampsIn(join(dir, "stamps.jsonl"));
      const subject = stampsIn(join(dir, "subject-stamps.jsonl"));
      assert.deepStrictEqual(primary.map((x) => x.moduleId), ["mica-registrar", "mica-registrar"]);
      assert.deepStrictEqual(subject.map((x) => x.moduleId), ["MICA/SubjectLog", "agent/alpha", "agent/alpha"]);
      assert.ok(
        primary.every((x) => x.moduleId !== "MICA/SubjectLog"),
        "not one subject-chain stamp may appear in the registrar's file"
      );
    }
  );


  // ── (c) THE STRICT PARSER · Codex Finding C, 2026-09-28 ────────────────────
  console.log("\n── flags: a flag-shaped value is refused, never consumed ──");

  const VALUED = [
    "--log", "--cursor", "--stamps-out", "--clerk-store", "--clerk-socket",
    "--submitter-id", "--submitter-key", "--channel",
    "--second-log", "--second-cursor", "--second-stamps-out", "--second-channel",
  ];

  check("EVERY valued flag refuses a flag-shaped value — table-driven, all twelve", () => {
    for (const flag of VALUED) {
      const a = parseArgs([flag, "--clerk-socket", "/run/real.sock"]);
      assert.ok(
        a.malformed.some((m) => m.includes(flag) && m.includes("which is a flag")),
        `${flag} consumed the next flag as its value: ${JSON.stringify(a.malformed)}`
      );
    }
  });

  check("EVERY valued flag refuses a missing value at end of line — all twelve", () => {
    for (const flag of VALUED) {
      const a = parseArgs([flag]);
      assert.ok(
        a.malformed.some((m) => m.includes(flag) && m.includes("last on the command line")),
        `${flag} accepted a missing value: ${JSON.stringify(a.malformed)}`
      );
    }
  });

  check("an UNRECOGNISED token is refused, not ignored — the silent no-op path", () => {
    // ⛔ THE REGRESSION THIS PINS: the old parser ignored unknown tokens, so a
    // swallowed --log left the literal "--clerk-socket" as a relative path, the
    // real path became an ignored token, and an absent file reported "nothing to
    // do" with exit 0. A run that stamped nothing looked like a run with nothing
    // to stamp.
    const a = parseArgs(["--log", "/tmp/x.jsonl", "/tmp/stray.jsonl"]);
    assert.ok(
      a.malformed.some((m) => m.includes("unrecognised argument")),
      `a stray token was ignored: ${JSON.stringify(a.malformed)}`
    );
  });

  check("a REPEATED flag is refused — one flag, at most once", () => {
    const a = parseArgs(["--log", "/a.jsonl", "--log", "/b.jsonl"]);
    assert.ok(
      a.malformed.some((m) => m.includes("more than once")),
      JSON.stringify(a.malformed)
    );
  });

  check("a WELL-FORMED line produces no complaint and reads every value", () => {
    const a = parseArgs([
      "--log", "/l.jsonl", "--cursor", "/c.json", "--stamps-out", "/s.jsonl",
      "--clerk-store", "/store", "--submitter-id", "mica",
      "--submitter-key", "/k.pem", "--channel", "subject",
    ]);
    assert.deepStrictEqual(a.malformed, [], JSON.stringify(a.malformed));
    assert.strictEqual(a.log, "/l.jsonl");
    assert.strictEqual(a.channel, "subject");
    assert.strictEqual(a.clerkSocket, null, "an absent optional stays absent");
  });

  check("malformed COLLECTS every fault on the line, not just the first", () => {
    const a = parseArgs(["--log", "--cursor", "stray", "--channel"]);
    assert.ok(a.malformed.length >= 2, `only ${a.malformed.length}: ${JSON.stringify(a.malformed)}`);
  });

  rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed.\n`);
}

void main();
