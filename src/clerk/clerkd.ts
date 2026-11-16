#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// ILAS — CLERK 1: the clerk DAEMON. A SEPARATE OS PROCESS.
//
//   npx ts-node src/clerk/clerkd.ts --store <dir> [--tick-ms 1000]
//
// This is the preferred configuration of build brief §3: the clerk owns its
// store and its key in its own process, and the submitter reaches it only
// through the narrow interface in protocol.ts.
//
// WHAT THIS ACHIEVES: memory separation and interface narrowing. The submitter
// has no code path to the key object, the sequence counter, the clock, or the
// store handle. Defeating the clerk stops being a function call and becomes an
// OS-level act against another process.
//
// WHAT IT DOES NOT ACHIEVE, and this is stamped in every record rather than
// left to prose: if the clerk and the observed system run as the SAME OS
// principal, that principal can read the key file off disk and delete the
// store. Running the clerk as its own OS user is a DEPLOYMENT act. This
// program cannot do it for you and does not pretend it has.
// ──────────────────────────────────────────────────────────────────────────────

import { createServer, Server, Socket } from "net";
import { chmodSync, existsSync, unlinkSync } from "fs";
import { ClerkCore } from "./core";
import { defaultSocketPath } from "./protocol";
import type {
  ClerkInfo,
  ClerkRequestMessage,
  ClerkResponseMessage,
} from "./protocol";
import { resolveStoreDir } from "./store";
import { READER_PRESUMPTION, SEPARATE_PROCESS_BOUND, STORE_FILES } from "./types";

interface Args {
  store: string | null;
  socket: string | null;
  tickMs: number;
  clerkId: string | null;
  retainPayload: boolean;
  /** Path to the DEPLOYER-SUPPLIED roster JSON. No default, no built-in entry. */
  roster: string | null;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    store: null,
    socket: null,
    tickMs: 1000,
    clerkId: null,
    retainPayload: true,
    roster: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--store") args.store = argv[++i] ?? null;
    else if (a === "--socket") args.socket = argv[++i] ?? null;
    else if (a === "--tick-ms") args.tickMs = Number(argv[++i]);
    else if (a === "--clerk-id") args.clerkId = argv[++i] ?? null;
    else if (a === "--no-retain-payload") args.retainPayload = false;
    else if (a === "--roster") args.roster = argv[++i] ?? null;
  }
  if (!Number.isFinite(args.tickMs) || args.tickMs <= 0) args.tickMs = 1000;
  return args;
}

export interface RunningClerk {
  server: Server;
  core: ClerkCore;
  socketPath: string;
  stop(): Promise<void>;
}

function dispatch(core: ClerkCore, msg: ClerkRequestMessage): unknown {
  switch (msg.op) {
    case "challenge":
      return core.challenge();
    case "submit":
      // `SOCKET` is an OBSERVED fact: these bytes arrived on the clerk's
      // listener, not as a call inside its own process. See IntakeChannel.
      return core.submit(
        {
          submitter_id: String(msg.submitter_id),
          channel: String(msg.channel),
          declared_timestamp: msg.declared_timestamp ?? null,
          payload: msg.payload,
          nonce: msg.nonce ?? null,
          submitter_signature: msg.submitter_signature ?? null,
        },
        "SOCKET"
      );
    case "declare_cadence":
      return core.declareCadence(
        String(msg.channel),
        Number(msg.period_ms),
        Number(msg.grace_ms),
        String(msg.declared_by),
        "SOCKET"
      );
    case "scan_cadences":
      return core.scanCadences(msg.now_ms);
    case "head":
      return core.getHead();
    case "info": {
      const info: ClerkInfo = {
        clerk_id: core.clerkId,
        separation: core.separation,
        separation_warning: null,
        clerk_principal: "<not disclosed through the submit interface>",
        public_key: core.publicKeyB64,
        clerk_seq_next: core.length,
        // Whether authentication is required — never who is enrolled.
        roster_state: core.roster.state,
      };
      return info;
    }
    default: {
      const op = (msg as { op?: unknown }).op;
      throw new Error(
        `unknown op \`${String(op)}\`. The submit interface is deliberately ` +
          `narrow: challenge, submit, declare_cadence, scan_cadences, head, info.`
      );
    }
  }
}

function handleConnection(core: ClerkCore, socket: Socket): void {
  socket.setEncoding("utf8");
  let buffer = "";
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const nl = buffer.indexOf("\n");
      if (nl < 0) break;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.trim().length === 0) continue;

      let response: ClerkResponseMessage;
      let op = "<unparsed>";
      try {
        const msg = JSON.parse(line) as ClerkRequestMessage;
        op = String((msg as { op?: unknown }).op);
        response = { ok: true, op: msg.op, result: dispatch(core, msg) };
      } catch (err) {
        const e = err as Error;
        response = {
          ok: false,
          op,
          error: { name: e.name ?? "Error", message: e.message ?? String(err) },
        };
      }
      socket.write(JSON.stringify(response) + "\n");
    }
  });
  socket.on("error", () => {
    /* a submitter that drops its connection is not the clerk's problem */
  });
}

export async function startClerkDaemon(args: Args): Promise<RunningClerk> {
  const storeDir = resolveStoreDir(args.store);
  const core = new ClerkCore({
    storeDir,
    separation: "SEPARATE_PROCESS",
    clerkId: args.clerkId ?? undefined,
    retainPayload: args.retainPayload,
    roster: args.roster,
  });

  const socketPath = args.socket ?? defaultSocketPath(storeDir);
  if (process.platform !== "win32" && existsSync(socketPath)) {
    // A stale socket file from a previous run would make listen() fail. The
    // socket is not part of the record and removing it destroys no evidence.
    unlinkSync(socketPath);
  }

  const server = createServer((socket) => handleConnection(core, socket));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });

  // ── S110 F-3: the socket's own MODE, set explicitly, not inherited by hope ──
  //
  //   node's net.Server.listen() on an AF_UNIX path creates the socket file at
  //   whatever mode the platform's bind() call and this process's umask leave
  //   it — historically NOT group-writable on this box, which is why a
  //   submitter in the intended group (e.g. `mica`, meant to reach this socket
  //   through `/run/mica`'s own setgid group `mica-submitters`) got EACCES on
  //   its first live cargo run (F-3, S110 deployment findings). THE GROUP
  //   ITSELF is a directory fact this file does not touch: `/run/mica`'s own
  //   setgid bit is what makes every new entry inside it inherit that
  //   directory's group, and that is a DEPLOYMENT fact (the socket directory's
  //   own ownership and mode), not something clerkd.ts decides. What clerkd.ts
  //   DOES own is the file it just created, and 0660 is this file's own
  //   explicit word about it: owner and group both read/write, other nothing.
  //
  //   NO chown HERE, and that is deliberate, not an oversight: a non-root
  //   process can only change a file's group to one it already belongs to,
  //   and clerkd has no stated reason to belong to `mica-submitters` — trying
  //   and silently swallowing an EPERM would be exactly the "a label must not
  //   gate" shape this tree keeps away from real failures. If the setgid
  //   inheritance this depends on ever proves insufficient on its own, that
  //   is a deployment-directory finding, not a reason for this daemon to
  //   reach for a privilege it was never given.
  //
  //   THE CLERK FENCE (S106-B) IS UNCROSSED: `chmodSync` is `fs`, already
  //   imported above; nothing outside src/clerk/ is touched to make this fix.
  chmodSync(socketPath, 0o660);

  const tick = setInterval(() => {
    try {
      core.scanCadences();
    } catch {
      /* a failed scan must not take the clerk down; the next tick retries */
    }
  }, args.tickMs);
  tick.unref();

  return {
    server,
    core,
    socketPath,
    stop: async () => {
      clearInterval(tick);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export function printBanner(running: RunningClerk): void {
  const core = running.core;
  const bar = "─".repeat(76);
  console.log(`┌${bar}`);
  console.log(`│ ILAS CLERK 1 — append authority. Object A: INFRASTRUCTURE.`);
  console.log(`│ It emits receipts, never verdicts. There is no health statement here.`);
  console.log(`├${bar}`);
  console.log(`│ separation   : SEPARATE_PROCESS (own OS process, own key, own store)`);
  console.log(`│ ${SEPARATE_PROCESS_BOUND}`);
  console.log(`│ clerk_id     : ${core.clerkId}`);
  console.log(`│ boot_id      : ${core.bootId}`);
  console.log(`│ store        : ${core.storeDir}`);
  console.log(`│   chain      : ${STORE_FILES.receipts}`);
  console.log(`│   tail       : ${STORE_FILES.head}`);
  console.log(`│   public key : ${STORE_FILES.publicKey}`);
  console.log(`│ socket       : ${running.socketPath}`);
  console.log(`│ load state   : ${core.storeLoadState}${core.storeLoadDetail === null ? "" : ` — ${core.storeLoadDetail}`}`);
  console.log(`│ roster       : ${core.roster.state} (${core.roster.entries.size} entries, source: ${core.roster.source})`);
  if (core.roster.state !== "CONFIGURED") {
    console.log(`│   !! NO SUBMITTER AUTHENTICATION IS IN FORCE. \`submitter_id\` and \`channel\``);
    console.log(`│      are strings the submitter declares and this clerk copies. Anyone able`);
    console.log(`│      to reach the submit socket can post on any channel as any submitter,`);
    console.log(`│      which can keep a dead submitter's channel warm. Quiet on such a`);
    console.log(`│      channel is UNMEASURED, not clean, and the gap detector says so.`);
  }
  for (const problem of core.roster.problems) {
    console.log(`│   roster problem: ${problem}`);
  }
  console.log(`│ public key   : ${core.publicKeyB64}`);
  console.log(`├${bar}`);
  for (const line of READER_PRESUMPTION) console.log(`│ ${line}`);
  console.log(`├${bar}`);
  console.log(`│ Read this store WITHOUT this process and WITHOUT the observed system:`);
  console.log(`│   npx ts-node src/clerk/reader.ts --store ${core.storeDir} --pubkey <key>`);
  console.log(`└${bar}`);
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  startClerkDaemon(args)
    .then((running) => {
      printBanner(running);
      console.log(`CLERK_READY ${running.socketPath}`);
      if (typeof process.send === "function") {
        process.send({
          type: "clerk-ready",
          socketPath: running.socketPath,
          storeDir: running.core.storeDir,
          publicKey: running.core.publicKeyB64,
          clerkId: running.core.clerkId,
        });
      }
      const shutdown = (): void => {
        void running.stop().then(() => process.exit(0));
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      process.on("message", (m: unknown) => {
        if (
          typeof m === "object" &&
          m !== null &&
          (m as { type?: unknown }).type === "clerk-stop"
        ) {
          shutdown();
        }
      });
    })
    .catch((err: unknown) => {
      console.error(`clerkd failed to start: ${String(err)}`);
      process.exit(1);
    });
}
