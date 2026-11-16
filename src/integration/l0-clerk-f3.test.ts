// Deployment glue: ILAS L0 -> Clerk 1 socket client -> MICA/Sig F3.

import * as assert from "assert";
import { fork } from "child_process";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { SocketClerkClient } from "../clerk/client";
import type { SubmissionRequest } from "../clerk/core";
import type { SubmissionReceipt } from "../clerk/types";
import { readStore } from "../clerk/read-store";
import { verifyChain } from "../clerk/verify";
import { recordPreimage } from "../clerk/preimage";
import { publicKeyFromB64, verifySignature } from "../clerk/signature";
import { assessSig } from "../mica/sig";
import type { ClerkClockSource } from "../mica/sig";
import type { MicaReadableLog } from "../mica/log";
import { decideChokepoint } from "../mica/chokepoint/types";

interface ReadyMessage {
  type: string;
  socketPath: string;
  publicKey: string;
}

function startClerk(dir: string): Promise<{
  child: ReturnType<typeof fork>;
  ready: ReadyMessage;
}> {
  return new Promise((resolveReady, reject) => {
    const child = fork(join(__dirname, "../clerk/clerkd.ts"), [
      "--store",
      dir,
      "--tick-ms",
      "60000",
    ], {
      execArgv: ["-r", "ts-node/register"],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("clerkd did not report ready within 60s"));
    }, 60_000);
    child.once("message", (message: unknown) => {
      clearTimeout(timer);
      const ready = message as ReadyMessage;
      if (ready?.type !== "clerk-ready") {
        reject(new Error(`unexpected clerk message: ${JSON.stringify(message)}`));
        return;
      }
      resolveReady({ child, ready });
    });
    child.once("error", reject);
  });
}

class ReorderingClient {
  private first:
    | {
        req: SubmissionRequest;
        resolve: (r: SubmissionReceipt) => void;
        reject: (e: unknown) => void;
      }
    | undefined;

  constructor(
    private readonly a: SocketClerkClient,
    private readonly b: SocketClerkClient
  ) {}

  submit(req: SubmissionRequest): Promise<SubmissionReceipt> {
    if (this.first === undefined) {
      return new Promise<SubmissionReceipt>((resolveReceipt, reject) => {
        this.first = { req, resolve: resolveReceipt, reject };
      });
    }
    const first = this.first;
    this.first = undefined;
    return this.b.submit(req).then(async (secondReceipt) => {
      try {
        const firstReceipt = await this.a.submit(first.req);
        first.resolve(firstReceipt);
      } catch (err) {
        first.reject(err);
      }
      return secondReceipt;
    });
  }
}

const l0ModulePath = resolve(
  __dirname,
  "../../../ILAS/ilas-github-copy/src/l0"
);
// Dynamic on purpose: MICA's compile/import closure remains free of ILAS.
const { LockedEvidenceLog, L0ClerkError } = require(l0ModulePath) as {
  LockedEvidenceLog: new (options?: Record<string, unknown>) => {
    append(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    settle(): Promise<void>;
    getAll(): readonly Record<string, unknown>[];
    getClerkClockSource(): readonly Record<string, unknown>[];
    getLoadState(): string;
    verify(): { valid: boolean };
    // ILAS f5d3cc5: a durable log holds "<logPath>.lock" until close().
    close(): void;
    readonly length: number;
  };
  L0ClerkError: new (...args: unknown[]) => Error;
};
// ⛔ THIS IMPORT SITS BELOW THE REQUIRE ON PURPOSE. src/mica/closure.test.ts
//    declares the dynamic require above by FILE AND LINE (DYNAMIC_SPECIFIERS,
//    line: 96) and fails on drift in either direction. Placed with the other
//    imports, this one line moved the require to :97 and turned closure.test.ts
//    red while this file was green — found by a cold reviewer, not by the seat
//    that made the change, which had run only this file. closure.test.ts is
//    behind the core door; moving the import is the change that needs no ticket.
import { generateKeyPairSync } from "crypto";

// ── THE TALLY IS COUNTED, NOT PRINTED ──────────────────────────────────────────
//
// ⛔ THE PREDECESSOR PRINTED "4 tests: 4 passed, 0 failed" AS A LITERAL after the
//    last assert. Any failure threw past it, so a red run printed NO count line
//    and a green one printed a constant: the line could only ever say 4/4, and
//    it said that because it was reached, not because anything counted. Adding a
//    fifth case to a literal would have made it lie by construction. Each case
//    now ends in ok(i); the tally is printed FIRST in `finally`, from the
//    counter, on the red path as well as the green one.
// ⚠ WHAT THAT DOES NOT COVER, said rather than implied: the tally prints for any
//   failure once the clerk is up. A missing or unloadable ILAS fails at the
//   top-level require above, and a clerkd that never reports ready fails in
//   startClerk — both before `try`, both with NO count line. The first is the
//   coupling this file has to ILAS's checkout, and it is named as a fork in the
//   receipt rather than hidden behind a counter that never started.
//
// The cases run in ORDER and later ones use earlier results (the mismatched
// receipt is built from case 0's r0), so a throw ends the run: every case after
// it is counted as NOT PASSED and named as not run, rather than dropped.
const CASES = [
  "real socket clerk stamps L0 records, signatures verify, and every receipt names its route",
  "F1 SILENT + F3 ALARM -> composite ALARM -> chokepoint HOLD",
  "clerk failure leaves L0 unchanged (fail closed) - refused as a SUBMISSION failure",
  "separation/intake mismatch leaves L0 unchanged (fail closed) - refused as a MALFORMED receipt",
  "the real clerk under a WRONG key is refused on its SIGNATURE, and nothing is committed",
] as const;
let passed = 0;
function ok(i: number): void {
  assert.strictEqual(i, passed, `case ${i} reported out of order (expected ${passed})`);
  console.log(`  ✓ ${CASES[i]}`);
  passed++;
}

/**
 * ⛔ A REFUSAL IS ASSERTED BY ITS REASON, NOT ONLY ITS CLASS. Every way this
 *    seam can refuse throws L0ClerkError — a missing key at construction, a
 *    failed submission, a malformed receipt, a bad signature — so `instanceof`
 *    alone passes when the case is refused for ANY of them, including the wrong
 *    one. That is exactly how the predecessor's two refusal arms would have
 *    stayed green under ILAS f5d3cc5 had their routes lacked a key: refused,
 *    for "no key", which is not what either arm claims to test.
 *
 * `kind` and `detail` are read from ILAS's own source at the commit this suite
 * loads (src/l0/index.ts confirmReceipt / the append path, src/l0/clerk-verify.ts),
 * not from the brief that asked for them.
 */
//
// ⛔ ANCHORED, NOT SUBSTRINGS. `kind` must be the message's PREFIX and `reason`
//    must follow it immediately, so the pair is one contiguous string — the
//    template ILAS builds. The first version checked two independent
//    `includes`, and a cold reviewer showed a SUBMISSION failure whose error
//    text happened to quote the mismatched receipt's reason would have
//    satisfied the mismatched arm: refused, as the wrong kind, and green.
function refusedFor(kind: string, reason: string): (err: unknown) => boolean {
  return (err: unknown): boolean => {
    assert.ok(err instanceof L0ClerkError, `refused, but not by L0ClerkError: ${String(err)}`);
    const message = (err as Error).message;
    assert.ok(message.startsWith(kind), `refused, but not as "${kind}": ${message}`);
    assert.ok(
      message.startsWith(kind + reason),
      `refused as "${kind}", but not for "${reason.trim()}": ${message}`
    );
    return true;
  };
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "mica-f3-l0-clerk-"));
  const store = join(root, "clerk");
  const logPath = join(root, "l0.jsonl");
  // THE DEPLOYMENT ACT OF RECIPE §4.1, RENDERED IN A TEST. Since S97 the clerk
  // does not create its own store directory; a clerkd spawned into a directory
  // no deployer made now exits at boot instead of coming up on a store born at
  // the process umask. Performed here, in this body, before the daemon starts.
  mkdirSync(store, { recursive: true });
  const started = await startClerk(store);
  const clientA = new SocketClerkClient(started.ready.socketPath);
  const clientB = new SocketClerkClient(started.ready.socketPath);
  // The wrong-key case talks to the real clerk DIRECTLY. Not through the
  // ReorderingClient: that one holds a first submission until a second
  // arrives, and a single append would wait on it for ever.
  const clientC = new SocketClerkClient(started.ready.socketPath);
  // Every log this body opens, so `finally` can close each one: a durable log
  // holds "<logPath>.lock" until close(), and a red run must not leak it.
  const opened: Array<{ close(): void }> = [];
  try {
    // ILAS f5d3cc5: every ClerkRoute needs the clerk's Ed25519 public key as
    // PEM (SPKI), checked at construction. clerkd publishes base64 SPKI DER, so
    // this is the same key re-encoded, never a different one. ⛔ INSIDE `try`:
    // publicKeyFromB64 throws on an unusable key, and above the `try` that
    // throw skipped `finally` — clerkd stayed alive and held the process open
    // (a cold reviewer measured exit 124 after 88 s under `timeout 90`).
    const clerkPublicKeyPem = publicKeyFromB64(started.ready.publicKey).export({
      type: "spki",
      format: "pem",
    }) as string;
    const log = new LockedEvidenceLog({
      path: logPath,
      clerk: {
        client: new ReorderingClient(clientA, clientB),
        submitterId: "ilas-l0",
        channel: "ilas-evidence",
        clerkPublicKeyPem,
      },
    });
    opened.push(log);
    const common = {
      moduleId: "m",
      provenanceTag: "LaneA",
      parameters: {},
      outcome: "ok",
    };
    const first = log.append({ ...common, timestamp: 1_000, eventType: "a" });
    const second = log.append({ ...common, timestamp: 2_000, eventType: "b" });
    await Promise.all([first, second]);
    await log.settle();

    assert.strictEqual(log.length, 2);
    const entries = log.getAll();
    const r0 = entries[0].clerkReceipt as SubmissionReceipt;
    const r1 = entries[1].clerkReceipt as SubmissionReceipt;
    assert.strictEqual(r0.separation, "SEPARATE_PROCESS");
    assert.strictEqual(r0.intake, "SOCKET");
    assert.ok(r0.clerk_seq > r1.clerk_seq, "harness did not reverse clerk order");
    const publicKey = publicKeyFromB64(started.ready.publicKey);
    assert.ok(verifySignature(recordPreimage(r0), r0.signature, publicKey));
    assert.ok(verifySignature(recordPreimage(r1), r1.signature, publicKey));
    const chain = verifyChain(readStore(store), {
      publicKeyB64: started.ready.publicKey,
      trustAnchor: "OUT_OF_BAND",
    });
    assert.strictEqual(chain.kind, "INTACT_SINCE_ARRIVAL");
    // ILAS f5d3cc5 refuses a receipt that does not name its route. MICA's clerk
    // COPIES submitter_id and channel from the submission into the receipt
    // (core.ts:707-709; client.ts:216-217 only puts them on the wire), so this
    // asserts the copy happened rather than inferring it from the appends
    // having landed.
    for (const r of [r0, r1]) {
      assert.strictEqual(r.submitter_id, "ilas-l0", "receipt does not name the route's submitter");
      assert.strictEqual(r.channel, "ilas-evidence", "receipt does not name the route's channel");
    }
    ok(0);

    // The reload takes the writer lock from `log` (the newest log on a path
    // owns it). Nothing appends to `log` after this line, so that is safe.
    const reloaded = new LockedEvidenceLog({ path: logPath });
    opened.push(reloaded);
    assert.strictEqual(reloaded.getLoadState(), "LOADED_VERIFIED");
    assert.strictEqual(reloaded.verify().valid, true);
    // ── T8 · THE STAMPS ARE GIVEN A CHAIN IDENTITY HERE, AND THAT IS A COST ───
    //
    // ⛔ WHY THIS ARM WENT RED AND NOBODY SAW IT. T8 made a clerk stamp that does
    //    not name its chain REFUSED, and `LockedEvidenceLog.getClerkClockSource()`
    //    is ILAS code (required at :96) that does not write one. So from the hour
    //    T8 shipped, F3 refused every stamp here, read CANNOT_ASSESS, and the
    //    `strictEqual(..., "ALARM")` below threw UNCAUGHT — which is why this
    //    suite has printed NO COUNT LINE in every sweep since and was recorded as
    //    "not comparable" rather than as a failure with a number.
    //
    // RULED (b), audit 2026-10-04 12:39Z: the test injects the identity NOW.
    //
    // ⚠ AND THE COST OF (b) IS STATED RATHER THAN HIDDEN: this is a TEST-SIDE
    //   injection standing in for something the real clerk does not do, so the
    //   arm proves F3's contradiction logic over a well-formed join and proves
    //   NOTHING about the live stamps file. Option (a) — the clerk writing
    //   chainIdentity on live stamps — is a live-stamp change with its own
    //   register item (S185) and its own WHAT for the arbiter, deliberately not folded
    //   into a test fix.
    // ⛔ TWO FIELDS, NOT ONE, AND THE SECOND IS THE FINDING. Injecting the chain
    //    identity alone still read CANNOT_ASSESS, with a DIFFERENT cause
    //    underneath: "WRITER_IDENTITY_MISMATCH: … NONE names the writer that
    //    wrote the record … Claimed writer(s): []" — that is T6, not T8. Probed,
    //    the live clerk stamp carries sequenceNumber, clerk_seq, clerk_time,
    //    separation, intake, clerk_id and clerk_boot_id — and NEITHER the writer
    //    (T6) NOR the chain identity (T8). So the join this arm needs fails on
    //    both of the fields those two tickets made mandatory, and the §1 WHAT
    //    that named only chainIdentity was one layer short.
    const L0_CHAIN_IDENTITY = "l0-clerk-f3-chain";
    const stampedSource = reloaded
      .getClerkClockSource()
      .map((st) => ({ ...(st as Record<string, unknown>), moduleId: common.moduleId, chainIdentity: L0_CHAIN_IDENTITY }));
    const sig = assessSig(reloaded as unknown as MicaReadableLog, {
      readableLoadStates: ["LOADED_VERIFIED"],
      clockToleranceMs: 0,
      preconditionMap: { b: ["a"] },
      clerkClockSource: stampedSource as unknown as ClerkClockSource,
      expectedChainIdentity: L0_CHAIN_IDENTITY,
    });
    assert.strictEqual(sig.flags[0].kind, "SILENT");
    assert.strictEqual(sig.flags[2].kind, "ALARM");
    assert.strictEqual(sig.verdict.kind, "ALARM");
    const decision = decideChokepoint({ id: "l0-f3-e2e" }, [sig.verdict]);
    assert.strictEqual(decision.disposition, "HOLD");
    assert.strictEqual(decision.executeRaw, false);
    ok(1);

    // The REAL key, so construction passes and the refusal can only come from
    // the submission itself. Without it this case would be refused for "no key"
    // and stay green for a reason it does not claim to test.
    const failed = new LockedEvidenceLog({
      clerk: {
        client: { submit: async () => { throw new Error("clerk unavailable"); } },
        submitterId: "ilas-l0",
        channel: "ilas-evidence",
        clerkPublicKeyPem,
      },
    });
    opened.push(failed);
    await assert.rejects(
      failed.append({ ...common, timestamp: 3_000, eventType: "c" }),
      // index.ts (append path): `clerk submission failed; L0 append did not land: ${describe(err)}`,
      // and describe(err) is String(err) — so OUR error's text must be in it.
      refusedFor("clerk submission failed; L0 append did not land", ": Error: clerk unavailable")
    );
    assert.strictEqual(failed.length, 0, "failed clerk append landed locally");
    ok(2);

    const mismatched = new LockedEvidenceLog({
      clerk: {
        client: {
          submit: async () => ({
            ...r0,
            declared_timestamp: 4_000,
            separation: "SEPARATE_PROCESS",
            intake: "LOCAL_CALL",
          }),
        },
        submitterId: "ilas-l0",
        channel: "ilas-evidence",
        clerkPublicKeyPem,
      },
    });
    opened.push(mismatched);
    await assert.rejects(
      mismatched.append({ ...common, timestamp: 4_000, eventType: "d" }),
      // index.ts confirmReceipt, kind "shape": the SHAPE check runs before the
      // route binding and before the signature, and this receipt's one
      // self-contradiction is the first shape rule it meets
      // (receiptShapeProblem: "SEPARATE_PROCESS claimed over a LOCAL_CALL intake").
      // Its edited fields would ALSO break receipt_hash — so a refusal that
      // names verification instead would be this arm failing for the wrong reason.
      refusedFor(
        "clerk returned a malformed or mismatched receipt",
        " (SEPARATE_PROCESS claimed over a LOCAL_CALL intake)"
      )
    );
    assert.strictEqual(
      mismatched.length,
      0,
      "separation/intake mismatch landed locally"
    );
    ok(3);

    // ── THE WRONG KEY: proves the glue passes THE clerk's key, not just A key ──
    // A real clerk, a real socket, a real signed receipt that names this route —
    // and a route configured with a freshly generated Ed25519 key that never
    // signed anything. The receipt passes every shape rule and the route
    // binding, so the ONLY thing left to refuse it is the signature
    // (clerk-verify.ts: "signature does not verify against the configured clerk
    // key"). ⚠ The clerk itself BOOKS this submission — it does not know L0 will
    // refuse — so "nothing committed" is a claim about L0, not about the clerk's
    // store, whose chain was already asserted INTACT above, before this case.
    const wrongPem = generateKeyPairSync("ed25519").publicKey.export({
      type: "spki",
      format: "pem",
    }) as string;
    assert.notStrictEqual(wrongPem, clerkPublicKeyPem, "the wrong key is the clerk's key");
    // The receipt is CAPTURED on its way back, so the case can prove its own
    // premise in-test rather than by a mutation run nobody re-runs: the clerk
    // WAS reached, returned exactly one receipt, and that receipt is GENUINE
    // under the clerk's real key. So the refusal below is about the configured
    // key and nothing else.
    const returned: SubmissionReceipt[] = [];
    const wrongKey = new LockedEvidenceLog({
      clerk: {
        client: {
          submit: async (req: SubmissionRequest): Promise<SubmissionReceipt> => {
            const receipt = await clientC.submit(req);
            returned.push(receipt);
            return receipt;
          },
        },
        submitterId: "ilas-l0",
        channel: "ilas-evidence",
        clerkPublicKeyPem: wrongPem,
      },
    });
    opened.push(wrongKey);
    await assert.rejects(
      wrongKey.append({ ...common, timestamp: 5_000, eventType: "e" }),
      refusedFor(
        "clerk receipt failed verification",
        " (signature does not verify against the configured clerk key)"
      )
    );
    assert.strictEqual(wrongKey.length, 0, "a receipt under the wrong key landed locally");
    assert.strictEqual(returned.length, 1, "the clerk was not reached exactly once");
    assert.ok(
      verifySignature(recordPreimage(returned[0]), returned[0].signature, publicKey),
      "the refused receipt does not verify under the clerk's REAL key either — the case is not about the key"
    );
    ok(4);
  } catch (err) {
    if (passed < CASES.length) {
      console.log(`  ✗ ${CASES[passed]}`);
      const notRun = CASES.length - passed - 1;
      if (notRun > 0) {
        console.log(`  ⊘ ${notRun} later case(s) NOT RUN — counted as failed: a case that did not run did not pass`);
      }
    }
    throw err;
  } finally {
    // The count is final here, so it prints BEFORE cleanup: a cleanup step that
    // throws must not be able to take the count line with it.
    console.log(`\n${CASES.length} tests: ${passed} passed, ${CASES.length - passed} failed`);
    for (const l of opened.reverse()) {
      try {
        l.close();
      } catch (closeErr) {
        console.error(`close() threw: ${String(closeErr)}`);
      }
    }
    await Promise.allSettled([clientA.close(), clientB.close(), clientC.close()]);
    started.child.kill();
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (rmErr) {
      console.error(`could not remove ${root}: ${String(rmErr)}`);
    }
  }
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
