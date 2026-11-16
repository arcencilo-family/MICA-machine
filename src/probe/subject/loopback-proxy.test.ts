// ── MICA · the loopback proxy — acceptance tests (S128, brief §9.2) ──────────
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node src/probe/subject/loopback-proxy.test.ts
//
// NO VENDOR IS EVER CONTACTED. Every test starts a FAKE vendor on 127.0.0.1:0
// (an ephemeral port the OS picks) which records the body and the Authorization
// header it was handed, and answers with a canned — or deliberately broken —
// OpenAI chat-completions body. The suite must be runnable on a box with no
// network and no key, and it is.
//
// Every test that touches a disk makes its OWN directory with `mkdtempSync`.
// No test names a deployment path.
//
// THE ALIAS AND THE VENDOR'S RETURNED MODEL ARE DIFFERENT STRINGS IN EVERY
// FIXTURE, and that is the point of LP-2: a proxy that echoed the requested
// alias back would pass a test where the two were the same and would quietly
// destroy R5 — the returned string is the subject, the alias is only what was
// asked for.
//
// LP-8 is the seam the brief's §4 exists for, proven end to end: the REAL
// runner, unmodified, against this proxy, against the fake vendor. A vendor 429
// must produce ZERO captures lines and runner exit 1 — because a 429 handed
// back as JSON would be appended as a capture and skipped by the resume key
// forever.

import assert from "assert";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "http";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "fs";
import type { AddressInfo, Socket } from "net";
import { tmpdir } from "os";
import { join } from "path";

import { N5_FAMILY } from "../families/n5";
import { main as runnerMain } from "./ollama-runner";
import { SUBJECT_DECLARATION_BASIS } from "./subject-declaration";
import {
  configFromEnv,
  droppedKeys,
  KEY_MODE_FORBIDDEN_BITS,
  ProxyRefusedToStart,
  readKeyFile,
  startProxy,
  TEMPERATURE_NOT_SENT_MODELS,
  VENDOR_TIMEOUT_MS,
  type ProxyConfig,
  type ProxyRuntime,
} from "./loopback-proxy";

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(error as Error).stack ?? String(error)}`);
    failed++;
  }
}

// ── fixtures ────────────────────────────────────────────────────────────────

/** Obvious, unmistakable, and never a real credential. LP-7 greps for it. */
const FIXTURE_KEY = "sk-fixture-DO-NOT-LOG-0123456789";
/** What the DECLARATION asks for. */
const FIXTURE_ALIAS = "fixture-alias-mini";
/** What the vendor SAYS ANSWERED. Deliberately not the alias. */
const FIXTURE_RETURNED_MODEL = "fixture-alias-mini-2026-07-18";

// ── S130 · the two aliases the temperature tests need are REAL names ─────────
//
// Unlike every other fixture in this file these are not invented, because the
// thing under test is membership of a table keyed by real model strings. LP-T0
// asserts both directions against the exported table, so a later edit to it
// cannot leave LP-T1/LP-T3 quietly testing nothing.
/** A member of TEMPERATURE_NOT_SENT_MODELS — pilot 5's subject (S129-1). */
const REFUSES_TEMPERATURE_ALIAS = "gpt-5-mini";
/** Also a member — pilot 6's subject, ruled S130-6; the vendor's 400 is proxy log seq 41. */
const ALSO_REFUSES_TEMPERATURE_ALIAS = "gpt-5";
/** NOT a member — pilot 4's subject, which accepted the field on the wire. */
const ACCEPTS_TEMPERATURE_ALIAS = "gpt-4o";
/**
 * NOT a member, and NOT a model anyone has run: a string that SHARES `gpt-5`'s prefix.
 *
 * It exists because the table's shape changed at S131. While `gpt-5-mini` was the only
 * member, a family rule and an exact set disagreed about `gpt-5` and the tests could tell
 * them apart. Now that BOTH are members they agree about both, and the file's standing claim
 * — exact strings, no prefix match, no family rule — has nothing left to falsify it except a
 * prefix-sharing non-member.
 */
const SHARES_PREFIX_NOT_A_MEMBER = "gpt-5-nano";

interface VendorCall {
  readonly body: string;
  readonly authorization: string | undefined;
  readonly contentType: string | undefined;
}

interface FakeVendor {
  readonly url: string;
  readonly calls: VendorCall[];
  readonly close: () => Promise<void>;
}

function cannedCompletion(extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "chatcmpl-fixture-001",
    object: "chat.completion",
    created: 1757800000,
    model: FIXTURE_RETURNED_MODEL,
    system_fingerprint: "fp_fixture_9",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "a fixture vendor reply" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
    ...extra,
  };
}

async function startFakeVendor(options?: {
  readonly status?: number;
  readonly body?: string;
  readonly contentType?: string;
  /** Accept the request and never answer — for the timeout test. */
  readonly hang?: boolean;
  /**
   * S130-4. Answer with status AND HEADERS and part of a body, then never send
   * another byte and never close.
   *
   * This is NOT `hang`, and the difference is the whole point of LP-6b: `hang`
   * is a vendor that says nothing at all, and the socket's inactivity timer has
   * always caught that — LP-6 is green and was green before the fix. THIS one
   * has already handed the proxy a `res`, which is where the fault then lands,
   * and where before S130-4 nothing was listening. It is the seq-33 vendor.
   */
  readonly headersThenHang?: boolean;
  /** The same, and then the connection breaks mid-body. */
  readonly headersThenClose?: boolean;
}): Promise<FakeVendor> {
  const calls: VendorCall[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      calls.push({
        body: Buffer.concat(chunks).toString("utf8"),
        authorization: req.headers.authorization,
        contentType: req.headers["content-type"],
      });
      if (options?.hang === true) return; // deliberately no answer, ever
      if (options?.headersThenHang === true || options?.headersThenClose === true) {
        // Headers first — from here the proxy HAS a `res` — then a partial body,
        // then either silence or a broken socket. Neither ever reaches
        // `res.on("end")`, and `req` never hears about it.
        res.writeHead(200, { "content-type": "application/json" });
        res.write('{"id":"chatcmpl-', () => {
          // Only once the partial body is actually flushed, so the proxy has
          // really seen bytes before the socket goes.
          if (options?.headersThenClose === true) req.socket.destroy();
        });
        return;
      }
      res.statusCode = options?.status ?? 200;
      res.setHeader("content-type", options?.contentType ?? "application/json");
      res.end(options?.body ?? JSON.stringify(cannedCompletion()));
    });
  });
  server.on("connection", (s: Socket) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${String(port)}/v1/chat/completions`,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => {
          resolve();
        });
      }),
  };
}

function newDir(tag: string): string {
  return mkdtempSync(join(tmpdir(), `mica-proxy-${tag}-`));
}

function keyFileIn(dir: string, key = FIXTURE_KEY): string {
  const path = join(dir, "openai.key");
  writeFileSync(path, key, "utf8");
  chmodSync(path, 0o600);
  return path;
}

function proxyConfig(o: {
  readonly vendorUrl: string;
  readonly logPath: string;
  readonly port?: number;
  readonly model?: string;
  readonly key?: string;
  readonly vendorTimeoutMs?: number;
}): ProxyConfig {
  return {
    port: o.port ?? 0,
    model: o.model ?? FIXTURE_ALIAS,
    key: o.key ?? FIXTURE_KEY,
    logPath: o.logPath,
    vendor: "openai",
    vendorUrl: o.vendorUrl,
    vendorTimeoutMs: o.vendorTimeoutMs ?? 5000,
  };
}

async function withProxy(
  config: ProxyConfig,
  body: (runtime: ProxyRuntime, endpoint: string) => Promise<void>
): Promise<void> {
  const runtime = await startProxy(config);
  try {
    await body(runtime, `http://127.0.0.1:${String(runtime.port)}`);
  } finally {
    await runtime.close();
  }
}

interface Reply {
  readonly status: number;
  readonly contentType: string | undefined;
  readonly body: string;
}

function call(
  endpoint: string,
  path: string,
  method: "GET" | "POST",
  body: string | null,
  /**
   * A TEST-SIDE ceiling on the proxy's answer, passed only by LP-6b and LP-6c.
   *
   * Without it, a proxy that never settles HANGS this suite instead of failing
   * it — and a mutation demo that hangs proves nothing to a reader. It is set
   * far above the 250 ms those two tests give the proxy, so it can only fire
   * when the thing under test is broken, and when it fires it says so in those
   * words rather than pretending the proxy answered.
   */
  deadlineMs?: number
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, endpoint);
    let settled = false;
    let deadline: NodeJS.Timeout | undefined;
    function settle(finish: () => void): void {
      if (settled) return;
      settled = true;
      if (deadline !== undefined) clearTimeout(deadline);
      finish();
    }
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method,
        headers:
          body === null
            ? {}
            : { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          settle(() => {
            resolve({
              status: res.statusCode ?? 0,
              contentType: res.headers["content-type"],
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        });
      }
    );
    req.on("error", (err: Error) => {
      settle(() => {
        reject(err);
      });
    });
    if (deadlineMs !== undefined) {
      deadline = setTimeout(() => {
        settle(() => {
          req.destroy();
          reject(
            new Error(
              `the proxy did not answer within ${String(deadlineMs)} ms — it never settled`
            )
          );
        });
      }, deadlineMs);
    }
    if (body !== null) req.write(body);
    req.end();
  });
}

/** The runner's own payload shape, as `buildPayload` emits it. */
function chatBody(overrides?: Record<string, unknown>): string {
  return JSON.stringify({
    model: FIXTURE_ALIAS,
    stream: false,
    think: false,
    messages: [
      { role: "system", content: "You are a fixture agent." },
      { role: "user", content: "the composed scenario text" },
    ],
    options: { seed: 7, temperature: 0 },
    ...overrides,
  });
}

function logLines(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function capturedLines(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** The runner prints a banner per call. Swallow it so this suite stays readable. */
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const log = console.log;
  const err = console.error;
  console.log = (): void => undefined;
  console.error = (): void => undefined;
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = err;
  }
}

function declarationFile(dir: string, endpoint: string): string {
  const path = join(dir, "subject.json");
  writeFileSync(
    path,
    JSON.stringify({
      subjectId: "fixture-subject",
      model: FIXTURE_ALIAS,
      thinkFlag: false,
      options: { seed: 1, temperature: 0 },
      systemPrompt: "You are a fixture agent.",
      endpoint,
      basis: SUBJECT_DECLARATION_BASIS,
      declaredBy: "fixture-arbiter",
      declaredAt: "2026-09-13T20:00:00.000Z",
    }),
    "utf8"
  );
  return path;
}

// ══════════════════════════════════════════════════════════════════════════════
async function main_(): Promise<void> {
  console.log("\n── mica-proxy · the loopback proxy for API subjects ───────────");

  // ── LP-1 ────────────────────────────────────────────────────────────────
  await check("LP-1 · /api/tags serves EXACTLY the configured alias and nothing else", async () => {
    const dir = newDir("tags");
    const vendor = await startFakeVendor();
    try {
      await withProxy(
        proxyConfig({ vendorUrl: vendor.url, logPath: join(dir, "proxy-log.jsonl") }),
        async (_rt, endpoint) => {
          const reply = await call(endpoint, "/api/tags", "GET", null);
          assert.strictEqual(reply.status, 200);
          const parsed = JSON.parse(reply.body) as { models: { name: string }[] };
          assert.deepStrictEqual(parsed, { models: [{ name: FIXTURE_ALIAS }] });
          assert.strictEqual(parsed.models.length, 1, "exactly one name is served");
          assert.strictEqual(vendor.calls.length, 0, "a tags read reaches no vendor");
        }
      );
      const lines = logLines(join(dir, "proxy-log.jsonl"));
      assert.strictEqual(lines.length, 1, "one line per inbound call, tags included");
      assert.strictEqual(lines[0].seq, 1, "seq begins at (existing lines) + 1");
      assert.strictEqual(lines[0].path, "/api/tags");
      assert.strictEqual(lines[0].sent, null, "nothing was sent for a tags read");
    } finally {
      await vendor.close();
    }
  });

  // ── LP-2 ────────────────────────────────────────────────────────────────
  await check(
    "LP-2 · happy path: messages byte-identical, think/seed dropped, temperature sent, " +
      "reply model is the VENDOR'S returned string",
    async () => {
      const dir = newDir("happy");
      const logPath = join(dir, "proxy-log.jsonl");
      const vendor = await startFakeVendor();
      try {
        await withProxy(
          proxyConfig({ vendorUrl: vendor.url, logPath }),
          async (_rt, endpoint) => {
            const inboundRaw = chatBody();
            const reply = await call(endpoint, "/api/chat", "POST", inboundRaw);
            assert.strictEqual(reply.status, 200, reply.body);

            // ── what went over the wire to the vendor ──────────────────────
            assert.strictEqual(vendor.calls.length, 1);
            const sent = JSON.parse(vendor.calls[0].body) as Record<string, unknown>;
            assert.deepStrictEqual(
              Object.keys(sent).sort(),
              ["messages", "model", "stream", "temperature"],
              "the outbound body carries these four keys and no others"
            );
            assert.strictEqual(sent.think, undefined, "`think` is dropped");
            assert.strictEqual(
              (sent as { options?: unknown }).options,
              undefined,
              "`options` (and so `options.seed`) never reaches the vendor"
            );
            assert.strictEqual(sent.temperature, 0, "`temperature` is forwarded");
            assert.strictEqual(sent.model, FIXTURE_ALIAS, "the proxy sends its OWN alias");
            assert.strictEqual(sent.stream, false);

            const inbound = JSON.parse(inboundRaw) as { messages: unknown };
            assert.strictEqual(
              JSON.stringify(sent.messages),
              JSON.stringify(inbound.messages),
              "messages are forwarded byte-identical — nothing prepended, appended or reordered"
            );

            // ── what came back to the runner ──────────────────────────────
            const out = JSON.parse(reply.body) as Record<string, unknown>;
            assert.strictEqual(
              out.model,
              FIXTURE_RETURNED_MODEL,
              "top-level model is the string the VENDOR returned (R5)"
            );
            assert.notStrictEqual(out.model, FIXTURE_ALIAS, "it is NOT the requested alias");
            assert.deepStrictEqual(out.message, {
              role: "assistant",
              content: "a fixture vendor reply",
            });
            assert.strictEqual(out.done, true);
            assert.strictEqual(out.done_reason, "stop");
            assert.strictEqual(
              out.total_duration,
              undefined,
              "no Ollama timing field is fabricated — absent is honest"
            );

            const vendorFacts = out.vendor as Record<string, unknown>;
            assert.strictEqual(vendorFacts.model, FIXTURE_RETURNED_MODEL);
            assert.strictEqual(vendorFacts.id, "chatcmpl-fixture-001");
            assert.strictEqual(vendorFacts.system_fingerprint, "fp_fixture_9");
            assert.strictEqual(vendorFacts.finish_reason, "stop");
            assert.deepStrictEqual(vendorFacts.usage, {
              prompt_tokens: 11,
              completion_tokens: 5,
              total_tokens: 16,
            });

            const proxyFacts = out.proxy as Record<string, unknown>;
            assert.strictEqual(proxyFacts.requestedModel, FIXTURE_ALIAS);
            assert.deepStrictEqual(
              proxyFacts.dropped,
              ["think", "options.seed"],
              "both dropped keys are NAMED as dropped"
            );
            assert.strictEqual(proxyFacts.logSeq, 1);

            // ── the join key between the reply and the log ────────────────
            const lines = logLines(logPath);
            assert.strictEqual(lines.length, 1);
            const line = lines[0];
            assert.strictEqual(line.outcome, "OK");
            assert.strictEqual(
              line.sentSha256,
              proxyFacts.sentSha256,
              "the log's sentSha256 IS the reply's — that is the receipt's join key"
            );
            assert.deepStrictEqual(line.sent, sent, "the log holds the exact outbound body");
            assert.strictEqual(line.vendorStatus, 200);
            assert.strictEqual(line.vendorModelReturned, FIXTURE_RETURNED_MODEL);
            assert.strictEqual(line.vendorId, "chatcmpl-fixture-001");
            assert.strictEqual(line.systemFingerprint, "fp_fixture_9");
            assert.strictEqual(line.finishReason, "stop");
            assert.deepStrictEqual(line.dropped, ["think", "options.seed"]);
            assert.strictEqual(typeof line.wallMs, "number");
            assert.strictEqual(line.vendorBody, undefined, "no vendor body is kept on success");
          }
        );
      } finally {
        await vendor.close();
      }
    }
  );

  // ── LP-3 ────────────────────────────────────────────────────────────────
  await check(
    "LP-3 · a requested model that is not the alias → 502 text/plain, NOTHING sent",
    async () => {
      const dir = newDir("mismatch");
      const logPath = join(dir, "proxy-log.jsonl");
      const vendor = await startFakeVendor();
      try {
        await withProxy(proxyConfig({ vendorUrl: vendor.url, logPath }), async (_rt, endpoint) => {
          const reply = await call(
            endpoint,
            "/api/chat",
            "POST",
            chatBody({ model: "some-other-model" })
          );
          assert.strictEqual(reply.status, 502);
          assert.ok(
            (reply.contentType ?? "").startsWith("text/plain"),
            `content-type was ${String(reply.contentType)}`
          );
          assert.throws(() => JSON.parse(reply.body), "the refusal must NOT parse as JSON");
          assert.ok(reply.body.startsWith("mica-proxy: "), reply.body);
          assert.ok(reply.body.includes("logSeq=1"), reply.body);
          assert.strictEqual(vendor.calls.length, 0, "nothing was sent to the vendor");
        });
        const lines = logLines(logPath);
        assert.strictEqual(lines.length, 1);
        assert.strictEqual(lines[0].outcome, "REFUSED_model_mismatch");
        assert.strictEqual(lines[0].sent, null);
        assert.strictEqual(lines[0].sentSha256, null);
      } finally {
        await vendor.close();
      }
    }
  );

  // ── LP-4 ────────────────────────────────────────────────────────────────
  await check(
    "LP-4 · a vendor 429 with a JSON body → 502 text/plain; log VENDOR_429 with vendorBody",
    async () => {
      const dir = newDir("429");
      const logPath = join(dir, "proxy-log.jsonl");
      const vendorBody = JSON.stringify({ error: { message: "rate limited", type: "rate_limit" } });
      const vendor = await startFakeVendor({ status: 429, body: vendorBody });
      try {
        await withProxy(proxyConfig({ vendorUrl: vendor.url, logPath }), async (_rt, endpoint) => {
          const reply = await call(endpoint, "/api/chat", "POST", chatBody());
          assert.strictEqual(reply.status, 502);
          assert.ok((reply.contentType ?? "").startsWith("text/plain"));
          assert.throws(
            () => JSON.parse(reply.body),
            "a 429 handed back as JSON would be appended as a capture and never re-asked"
          );
          assert.strictEqual(vendor.calls.length, 1, "it really was sent — the vendor said no");
        });
        const lines = logLines(logPath);
        assert.strictEqual(lines.length, 1);
        assert.strictEqual(lines[0].outcome, "VENDOR_429");
        assert.strictEqual(lines[0].vendorStatus, 429);
        assert.strictEqual(lines[0].vendorBody, vendorBody, "the vendor's own words are kept");
        assert.notStrictEqual(lines[0].sentSha256, null, "and what we sent is still on record");
      } finally {
        await vendor.close();
      }
    }
  );

  // ── LP-5 ────────────────────────────────────────────────────────────────
  await check("LP-5 · vendor 200 with `content: null` → 502 text/plain, never an empty capture", async () => {
    const dir = newDir("nullcontent");
    const logPath = join(dir, "proxy-log.jsonl");
    const vendor = await startFakeVendor({
      body: JSON.stringify(
        cannedCompletion({
          choices: [{ index: 0, message: { role: "assistant", content: null }, finish_reason: "content_filter" }],
        })
      ),
    });
    try {
      await withProxy(proxyConfig({ vendorUrl: vendor.url, logPath }), async (_rt, endpoint) => {
        const reply = await call(endpoint, "/api/chat", "POST", chatBody());
        assert.strictEqual(reply.status, 502);
        assert.ok((reply.contentType ?? "").startsWith("text/plain"));
        assert.throws(() => JSON.parse(reply.body));
      });
      const lines = logLines(logPath);
      assert.strictEqual(lines[0].outcome, "REFUSED_vendor_content_absent");
      assert.strictEqual(lines[0].vendorStatus, 200);
      assert.strictEqual(
        lines[0].finishReason,
        "content_filter",
        "why the vendor gave nothing is kept, and decides nothing"
      );
    } finally {
      await vendor.close();
    }
  });

  // ── LP-6 ────────────────────────────────────────────────────────────────
  await check("LP-6 · a vendor that never answers → 502 text/plain, outcome TIMEOUT", async () => {
    const dir = newDir("timeout");
    const logPath = join(dir, "proxy-log.jsonl");
    const vendor = await startFakeVendor({ hang: true });
    try {
      await withProxy(
        proxyConfig({ vendorUrl: vendor.url, logPath, vendorTimeoutMs: 250 }),
        async (_rt, endpoint) => {
          const reply = await call(endpoint, "/api/chat", "POST", chatBody());
          assert.strictEqual(reply.status, 502);
          assert.ok((reply.contentType ?? "").startsWith("text/plain"));
          assert.throws(() => JSON.parse(reply.body));
          assert.strictEqual(vendor.calls.length, 1, "the request did arrive; no answer came back");
        }
      );
      const lines = logLines(logPath);
      assert.strictEqual(lines[0].outcome, "TIMEOUT");
      assert.notStrictEqual(lines[0].sentSha256, null);
      assert.strictEqual(
        lines[0].vendorBody,
        undefined,
        "the vendor said nothing at all — our own error text must not sit in its field"
      );
      assert.ok(
        typeof lines[0].transportError === "string",
        "the transport fault is kept, under its own name"
      );
    } finally {
      await vendor.close();
    }
  });

  // ── LP-6b / LP-6c · S130-4, the hard wall-clock ceiling ─────────────────
  //
  // LP-6 above is a vendor that says NOTHING. That has always been caught, by
  // the socket's inactivity timer, and it is not the fault seq 33 was. These
  // two are the fault: a vendor that has ALREADY ANSWERED with headers, and
  // then stalls (LP-6b) or breaks (LP-6c). Both faults land on `res`, which
  // before S130-4 had no listener, so the promise settled neither way and a
  // `seq` claimed by `log.take()` was never written.

  await check(
    "LP-6b · headers, then silence: the ceiling settles it inside the timeout, and the " +
      "claimed seq IS WRITTEN — the seq-33 case, made impossible",
    async () => {
      const dir = newDir("headers-then-hang");
      const logPath = join(dir, "proxy-log.jsonl");
      const vendor = await startFakeVendor({ headersThenHang: true });
      try {
        await withProxy(
          proxyConfig({ vendorUrl: vendor.url, logPath, vendorTimeoutMs: 250 }),
          async (_rt, endpoint) => {
            const startedNs = process.hrtime.bigint();
            const reply = await call(endpoint, "/api/chat", "POST", chatBody(), 5000);
            const wallMs = Number(process.hrtime.bigint() - startedNs) / 1e6;

            // "Eventually" is exactly what seq 33 did NOT do. The window is the
            // assertion, not a comment about one.
            assert.ok(
              wallMs < 2000,
              `the proxy took ${wallMs.toFixed(0)} ms against a 250 ms ceiling`
            );
            assert.strictEqual(reply.status, 502);
            assert.ok((reply.contentType ?? "").startsWith("text/plain"));
            assert.throws(() => JSON.parse(reply.body), "the refusal must NOT parse as JSON");
            assert.ok(reply.body.includes("logSeq=1"), reply.body);
            assert.strictEqual(
              vendor.calls.length,
              1,
              "it was sent, the vendor DID answer with headers, and the body never ended"
            );
          }
        );
        const lines = logLines(logPath);
        // ── the seq-33 assertion ──────────────────────────────────────────
        assert.strictEqual(
          lines.length,
          1,
          "one inbound call, one line: the seq `log.take()` claimed was WRITTEN"
        );
        assert.strictEqual(lines[0].seq, 1, "and it is that seq, not a later one");
        assert.strictEqual(lines[0].outcome, "TIMEOUT");
        assert.notStrictEqual(lines[0].sentSha256, null, "what we sent is still on record");
        assert.strictEqual(
          lines[0].vendorBody,
          undefined,
          "a partial body the vendor never ended is not a vendor body"
        );
        assert.ok(
          typeof lines[0].transportError === "string",
          "the transport fault is kept, under its own name"
        );
        // wallMs ~= the ceiling is the RECEIPT'S proof that the ceiling fired
        // and not some other clock: it is measured from the inbound call, so it
        // is a little over 250 and nowhere near a socket's own idea of idle.
        const logged = lines[0].wallMs;
        assert.ok(
          typeof logged === "number" && logged >= 250 && logged < 2000,
          `wallMs was ${String(logged)} — it must be at the ceiling, not past it`
        );
      } finally {
        await vendor.close();
      }
    }
  );

  await check(
    "LP-6c · headers, then the socket breaks mid-body → REFUSED_vendor_unreachable in " +
      "milliseconds. SEAT'S RULING: the ceiling is the only CLOCK, but a vendor that CLOSED " +
      "is not a vendor that was SLOW, and the log must not say it was",
    async () => {
      const dir = newDir("headers-then-close");
      const logPath = join(dir, "proxy-log.jsonl");
      const vendor = await startFakeVendor({ headersThenClose: true });
      try {
        await withProxy(
          proxyConfig({ vendorUrl: vendor.url, logPath, vendorTimeoutMs: 250 }),
          async (_rt, endpoint) => {
            const startedNs = process.hrtime.bigint();
            const reply = await call(endpoint, "/api/chat", "POST", chatBody(), 5000);
            const wallMs = Number(process.hrtime.bigint() - startedNs) / 1e6;

            // It must NOT wait for the ceiling: the fault was known at once.
            assert.ok(
              wallMs < 250,
              `the proxy took ${wallMs.toFixed(0)} ms — a broken socket is not a slow one`
            );
            assert.strictEqual(reply.status, 502);
            assert.ok((reply.contentType ?? "").startsWith("text/plain"));
            assert.throws(() => JSON.parse(reply.body));
            assert.strictEqual(vendor.calls.length, 1);
          }
        );
        const lines = logLines(logPath);
        assert.strictEqual(lines.length, 1, "one inbound call, one line, seq written");
        assert.strictEqual(lines[0].seq, 1);
        assert.strictEqual(
          lines[0].outcome,
          "REFUSED_vendor_unreachable",
          "a mid-body close is a transport fault, not a timeout"
        );
        assert.notStrictEqual(lines[0].sentSha256, null);
        assert.strictEqual(lines[0].vendorBody, undefined);
        assert.ok(typeof lines[0].transportError === "string");
      } finally {
        await vendor.close();
      }
    }
  );

  // ── LP-7 ────────────────────────────────────────────────────────────────
  await check(
    "LP-7 · the key reaches the Authorization header and NOTHING else — not the log, not the reply",
    async () => {
      const dir = newDir("key");
      const logPath = join(dir, "proxy-log.jsonl");
      const vendor = await startFakeVendor();
      try {
        await withProxy(proxyConfig({ vendorUrl: vendor.url, logPath }), async (_rt, endpoint) => {
          const reply = await call(endpoint, "/api/chat", "POST", chatBody());
          assert.strictEqual(reply.status, 200, reply.body);

          assert.strictEqual(
            vendor.calls[0].authorization,
            `Bearer ${FIXTURE_KEY}`,
            "the vendor is handed the key, in the header, exactly once"
          );
          assert.ok(
            !vendor.calls[0].body.includes(FIXTURE_KEY),
            "and the outbound BODY does not carry it"
          );
          assert.ok(
            !reply.body.includes(FIXTURE_KEY),
            "the reply to the runner does not carry it"
          );
        });
        const raw = readFileSync(logPath, "utf8");
        assert.ok(raw.length > 0, "the log was written at all");
        assert.ok(!raw.includes(FIXTURE_KEY), "no log line anywhere carries the key");
      } finally {
        await vendor.close();
      }
    }
  );

  // ── LP-8 ────────────────────────────────────────────────────────────────
  await check(
    "LP-8a · the REAL runner, unmodified, through the proxy, to the fake vendor: " +
      "captures carry the VENDOR'S model and the RUNNER'S seed",
    async () => {
      const dir = newDir("e2e-ok");
      const logPath = join(dir, "proxy-log.jsonl");
      const captures = join(dir, "captures.jsonl");
      const vendor = await startFakeVendor();
      try {
        await withProxy(proxyConfig({ vendorUrl: vendor.url, logPath }), async (_rt, endpoint) => {
          const declaration = declarationFile(dir, endpoint);
          const code = await quiet(() =>
            runnerMain([
              "--subject", declaration,
              "--families", "N5",
              "--variants", "CONTROL",
              "--seeds", "3",
              "--captures", captures,
              "--endpoint-must-be-loopback",
            ])
          );
          assert.strictEqual(code, 0, "the runner completed");

          const lines = capturedLines(captures);
          assert.strictEqual(
            lines.length,
            N5_FAMILY.length,
            "one capture per N5 scenario at one variant and one seed"
          );
          for (const line of lines) {
            const response = line.response as Record<string, unknown>;
            assert.strictEqual(
              response.model,
              FIXTURE_RETURNED_MODEL,
              "the capture records what ANSWERED, not what was asked for"
            );
            const request = line.request as Record<string, unknown>;
            assert.strictEqual(request.model, FIXTURE_ALIAS, "the runner asked for the alias");
            assert.deepStrictEqual(
              request.options,
              { seed: 3, temperature: 0 },
              "the capture keeps what the RUNNER sent — seed included"
            );
            const proxyFacts = response.proxy as Record<string, unknown>;
            assert.deepStrictEqual(proxyFacts.dropped, ["think", "options.seed"]);
          }

          // Both are true, and they answer different questions: the captures
          // file says what the runner sent, the proxy log says what the proxy
          // sent. `options.seed` is in the first and in neither of the others.
          assert.strictEqual(vendor.calls.length, N5_FAMILY.length);
          for (const c of vendor.calls) {
            const sent = JSON.parse(c.body) as Record<string, unknown>;
            assert.strictEqual((sent as { options?: unknown }).options, undefined);
            assert.strictEqual(sent.think, undefined);
          }

          const log = logLines(logPath);
          assert.strictEqual(
            log.length,
            N5_FAMILY.length + 1,
            "one tags read plus one line per chat call"
          );
          assert.strictEqual(log[0].path, "/api/tags");
          assert.deepStrictEqual(
            log.map((l) => l.seq),
            log.map((_l, i) => i + 1),
            "seq is the line number while one process owns the file"
          );
          for (const l of log.slice(1)) {
            assert.strictEqual(l.outcome, "OK");
            assert.strictEqual(l.vendorModelReturned, FIXTURE_RETURNED_MODEL);
          }
        });
      } finally {
        await vendor.close();
      }
    }
  );

  await check(
    "LP-8b · LP-4's shape through the same path → ZERO captures lines and runner exit 1",
    async () => {
      const dir = newDir("e2e-429");
      const logPath = join(dir, "proxy-log.jsonl");
      const captures = join(dir, "captures.jsonl");
      const vendor = await startFakeVendor({
        status: 429,
        body: JSON.stringify({ error: { message: "rate limited" } }),
      });
      try {
        await withProxy(proxyConfig({ vendorUrl: vendor.url, logPath }), async (_rt, endpoint) => {
          const declaration = declarationFile(dir, endpoint);
          const code = await quiet(() =>
            runnerMain([
              "--subject", declaration,
              "--families", "N5",
              "--variants", "CONTROL",
              "--seeds", "3",
              "--captures", captures,
              "--endpoint-must-be-loopback",
            ])
          );
          assert.strictEqual(code, 1, "an IO/deployment fact — not a refusal of the arguments");
          assert.deepStrictEqual(
            capturedLines(captures),
            [],
            "NOTHING was appended: the next run re-asks, which is the whole seam"
          );

          const log = logLines(logPath);
          assert.strictEqual(log.length, 2, "the tags read, then the one chat call that failed");
          assert.strictEqual(log[1].outcome, "VENDOR_429");
          assert.ok(
            typeof log[1].vendorBody === "string" && log[1].vendorBody.includes("rate limited"),
            "the receipt can still read what the vendor said"
          );
        });
      } finally {
        await vendor.close();
      }
    }
  );

  // ── start-time refusals (brief §9.1) ────────────────────────────────────
  await check("LP-9 · the key file: unreadable, empty, or wider than 0640 all refuse to start", () => {
    const dir = newDir("keyfile");

    assert.throws(
      () => readKeyFile(join(dir, "not-there.key")),
      (e: unknown) => e instanceof ProxyRefusedToStart && e.message.includes("cannot stat")
    );

    const empty = join(dir, "empty.key");
    writeFileSync(empty, "\n", "utf8");
    chmodSync(empty, 0o600);
    assert.throws(
      () => readKeyFile(empty),
      (e: unknown) => e instanceof ProxyRefusedToStart && e.message.includes("is empty")
    );

    const wide = join(dir, "wide.key");
    writeFileSync(wide, FIXTURE_KEY, "utf8");
    chmodSync(wide, 0o644);
    assert.throws(
      () => readKeyFile(wide),
      (e: unknown) => e instanceof ProxyRefusedToStart && e.message.includes("wider than 0640")
    );

    // POSITIVE CONTROL — the two modes §6 act 3 actually produces DO start.
    const ok = keyFileIn(dir);
    assert.strictEqual(readKeyFile(ok), FIXTURE_KEY);
    chmodSync(ok, 0o640);
    assert.strictEqual(readKeyFile(ok), FIXTURE_KEY, "0640 is the ceiling, not a refusal");
    // And the forbidden mask really is 0o777 & ~0o640.
    assert.strictEqual(KEY_MODE_FORBIDDEN_BITS, 0o777 & ~0o640);
  });

  await check("LP-10 · the environment: every variable required, and only `openai` is spoken", () => {
    const dir = newDir("env");
    const key = keyFileIn(dir);
    const full = {
      MICA_PROXY_PORT: "11444",
      MICA_PROXY_MODEL: FIXTURE_ALIAS,
      MICA_PROXY_KEY_FILE: key,
      MICA_PROXY_LOG: join(dir, "proxy-log.jsonl"),
      MICA_PROXY_VENDOR: "openai",
    };

    const config = configFromEnv(full);
    assert.strictEqual(config.port, 11444);
    assert.strictEqual(config.model, FIXTURE_ALIAS);
    assert.strictEqual(config.key, FIXTURE_KEY);
    assert.strictEqual(config.vendorTimeoutMs, VENDOR_TIMEOUT_MS);
    assert.ok(
      config.vendorUrl.startsWith("https://"),
      "the vendor URL comes from the name, never from the environment"
    );

    for (const name of Object.keys(full)) {
      const partial: NodeJS.ProcessEnv = { ...full };
      delete partial[name];
      assert.throws(
        () => configFromEnv(partial),
        (e: unknown) => e instanceof ProxyRefusedToStart && e.message.includes(name),
        `${name} unset must refuse by name`
      );
    }

    assert.throws(
      () => configFromEnv({ ...full, MICA_PROXY_VENDOR: "anthropic" }),
      (e: unknown) => e instanceof ProxyRefusedToStart && e.message.includes("anthropic"),
      "an Anthropic rung is a ruling and a later beat, not a variable"
    );
    assert.throws(
      () => configFromEnv({ ...full, MICA_PROXY_PORT: "not-a-port" }),
      (e: unknown) => e instanceof ProxyRefusedToStart
    );
    assert.throws(
      () => configFromEnv({ ...full, MICA_PROXY_PORT: "70000" }),
      (e: unknown) => e instanceof ProxyRefusedToStart
    );
  });

  await check("LP-11 · a port already taken refuses to start; it never slides to another", async () => {
    const dir = newDir("port");
    const held = createServer(() => undefined);
    await new Promise<void>((resolve) => held.listen(0, "127.0.0.1", resolve));
    const taken = (held.address() as AddressInfo).port;
    try {
      await assert.rejects(
        startProxy(
          proxyConfig({
            vendorUrl: "http://127.0.0.1:1/v1/chat/completions",
            logPath: join(dir, "proxy-log.jsonl"),
            port: taken,
          })
        ),
        (e: unknown) => e instanceof ProxyRefusedToStart && e.message.includes("cannot listen")
      );
    } finally {
      await new Promise<void>((resolve) => held.close(() => { resolve(); }));
    }
  });

  // ── the two refusals this file adds to the brief's list, held behaviourally ─
  await check(
    "LP-12 · a body with no messages, and one with no options.temperature, both refuse unsent",
    async () => {
      const dir = newDir("adds");
      const logPath = join(dir, "proxy-log.jsonl");
      const vendor = await startFakeVendor();
      try {
        await withProxy(proxyConfig({ vendorUrl: vendor.url, logPath }), async (_rt, endpoint) => {
          const noMessages = await call(endpoint, "/api/chat", "POST", chatBody({ messages: [] }));
          assert.strictEqual(noMessages.status, 502);
          assert.throws(() => JSON.parse(noMessages.body));

          const noTemp = await call(endpoint, "/api/chat", "POST", chatBody({ options: { seed: 7 } }));
          assert.strictEqual(noTemp.status, 502);
          assert.throws(() => JSON.parse(noTemp.body));

          const notJson = await call(endpoint, "/api/chat", "POST", "{ not json");
          assert.strictEqual(notJson.status, 502);
          assert.throws(() => JSON.parse(notJson.body));

          assert.strictEqual(vendor.calls.length, 0, "none of the three reached the vendor");
        });
        assert.deepStrictEqual(
          logLines(logPath).map((l) => l.outcome),
          ["REFUSED_messages_absent", "REFUSED_temperature_absent", "REFUSED_inbound_not_json"]
        );
      } finally {
        await vendor.close();
      }
    }
  );

  await check("LP-13 · `dropped` names what was actually present, not a fixed pair", () => {
    // S130 gave `droppedKeys` a second parameter; every call below passes an
    // alias that is NOT in the table, so each assertion is the pre-S130 one,
    // unchanged in value. The table's effect is LP-T4's business.
    assert.deepStrictEqual(
      droppedKeys({ think: false, options: { seed: 1, temperature: 0 } }, FIXTURE_ALIAS),
      ["think", "options.seed"]
    );
    assert.deepStrictEqual(droppedKeys({ options: { temperature: 0 } }, FIXTURE_ALIAS), []);
    assert.deepStrictEqual(droppedKeys({ think: true }, FIXTURE_ALIAS), ["think"]);
    assert.deepStrictEqual(droppedKeys({ options: { seed: 0 } }, FIXTURE_ALIAS), ["options.seed"]);
  });

  await check("LP-14 · seq continues from the lines already in the log, across a restart", async () => {
    const dir = newDir("seq");
    const logPath = join(dir, "proxy-log.jsonl");
    const vendor = await startFakeVendor();
    try {
      const config = proxyConfig({ vendorUrl: vendor.url, logPath });
      await withProxy(config, async (_rt, endpoint) => {
        await call(endpoint, "/api/tags", "GET", null);
        await call(endpoint, "/api/chat", "POST", chatBody());
      });
      assert.deepStrictEqual(logLines(logPath).map((l) => l.seq), [1, 2]);

      // A SECOND process over the same file, as a restart would be.
      await withProxy(config, async (_rt, endpoint) => {
        await call(endpoint, "/api/tags", "GET", null);
      });
      assert.deepStrictEqual(logLines(logPath).map((l) => l.seq), [1, 2, 3]);
    } finally {
      await vendor.close();
    }
  });

  await check("LP-15 · the log file is born 0640, and a call to an unknown door is a 404", async () => {
    const dir = newDir("misc");
    const logPath = join(dir, "proxy-log.jsonl");
    const vendor = await startFakeVendor();
    try {
      await withProxy(proxyConfig({ vendorUrl: vendor.url, logPath }), async (_rt, endpoint) => {
        const reply = await call(endpoint, "/api/generate", "POST", "{}");
        assert.strictEqual(reply.status, 404);
        assert.ok((reply.contentType ?? "").startsWith("text/plain"));
        assert.throws(() => JSON.parse(reply.body));

        // A POST to the tags door is not a tags read either.
        const wrongMethod = await call(endpoint, "/api/tags", "POST", "{}");
        assert.strictEqual(wrongMethod.status, 404);
      });
      assert.strictEqual(
        statSync(logPath).mode & 0o777 & ~0o640,
        0,
        "0640 is a ceiling a umask may only narrow — never a bit wider"
      );
      assert.deepStrictEqual(
        logLines(logPath).map((l) => l.outcome),
        ["REFUSED_unknown_door", "REFUSED_unknown_door"]
      );
    } finally {
      await vendor.close();
    }
  });

  // ══ S130 · the per-model "temperature not sent" wire mode ═════════════════
  //
  // The vendor refused `temperature: 0` on `gpt-5-mini` with a 400
  // (`unsupported_value`, param `temperature`) — proxy log seq 23, read off
  // disk, not from training. The wire changes; NOTHING the declaration says
  // changes, and LP-T2 is the test that holds that line.

  await check(
    "LP-T0 · the table itself: gpt-5-mini AND gpt-5 are in it, gpt-4o is not, and it is a " +
      "set of EXACT STRINGS rather than a family rule — all three directions",
    () => {
      assert.ok(
        TEMPERATURE_NOT_SENT_MODELS.has(REFUSES_TEMPERATURE_ALIAS),
        `${REFUSES_TEMPERATURE_ALIAS} must be a member, or LP-T1/LP-T2/LP-T4 test nothing`
      );
      assert.ok(
        TEMPERATURE_NOT_SENT_MODELS.has(ALSO_REFUSES_TEMPERATURE_ALIAS),
        `${ALSO_REFUSES_TEMPERATURE_ALIAS} must be a member (S131, proxy log seq 41), or ` +
          `pilot 6 sends a field its vendor answers 400 to`
      );
      assert.ok(
        !TEMPERATURE_NOT_SENT_MODELS.has(ACCEPTS_TEMPERATURE_ALIAS),
        `${ACCEPTS_TEMPERATURE_ALIAS} must NOT be a member, or LP-T3's snapshot is vacuous`
      );
      assert.deepStrictEqual(
        [...TEMPERATURE_NOT_SENT_MODELS],
        ["gpt-5-mini", "gpt-5"],
        "one string per ruling, and exactly the two rulings: S130 seq 23, S131 seq 41"
      );

      // ── the set is EXACT STRINGS, asked where the substitution would happen ──
      //
      // The set assertion above cannot catch this on its own any more. A hand
      // that replaced `.has(alias)` with a prefix or family test would leave the
      // SET untouched, and both members would still behave correctly, because
      // `gpt-5` is a prefix of `gpt-5-mini`. So this is asked of `droppedKeys`,
      // which is the call site, about a non-member that shares the prefix: under
      // a family rule it comes back naming a key that was in fact SENT.
      assert.deepStrictEqual(
        droppedKeys({ options: { temperature: 0 } }, SHARES_PREFIX_NOT_A_MEMBER),
        [],
        `${SHARES_PREFIX_NOT_A_MEMBER} is not in the table, so nothing about temperature is ` +
          `dropped for it — membership is the exact string, never the family`
      );
    }
  );

  await check(
    "LP-T1 · a table member: the vendor receives NO `temperature` key, and the omission is named",
    async () => {
      const dir = newDir("temp-not-sent");
      const logPath = join(dir, "proxy-log.jsonl");
      const vendor = await startFakeVendor();
      try {
        await withProxy(
          proxyConfig({ vendorUrl: vendor.url, logPath, model: REFUSES_TEMPERATURE_ALIAS }),
          async (_rt, endpoint) => {
            const reply = await call(
              endpoint,
              "/api/chat",
              "POST",
              chatBody({ model: REFUSES_TEMPERATURE_ALIAS })
            );
            assert.strictEqual(reply.status, 200, reply.body);

            // ── the wire ──────────────────────────────────────────────────
            assert.strictEqual(vendor.calls.length, 1);
            const received = JSON.parse(vendor.calls[0].body) as Record<string, unknown>;
            assert.strictEqual(
              "temperature" in received,
              false,
              "the key is ABSENT from the body the vendor received — not null, not undefined"
            );
            assert.deepStrictEqual(
              Object.keys(received).sort(),
              ["messages", "model", "stream"],
              "three keys now, and the missing one is temperature"
            );
            assert.strictEqual(received.model, REFUSES_TEMPERATURE_ALIAS);
            assert.strictEqual(received.stream, false);

            // ── what the runner is told ───────────────────────────────────
            const out = JSON.parse(reply.body) as Record<string, unknown>;
            const proxyFacts = out.proxy as Record<string, unknown>;
            assert.ok(
              (proxyFacts.dropped as string[]).includes("options.temperature"),
              `proxy.dropped was ${JSON.stringify(proxyFacts.dropped)}`
            );

            // ── and the log, which is where a receipt reads both facts ────
            const lines = logLines(logPath);
            assert.strictEqual(lines.length, 1);
            assert.strictEqual(lines[0].outcome, "OK");
            const sent = lines[0].sent as Record<string, unknown>;
            assert.strictEqual(
              "temperature" in sent,
              false,
              "the log's `sent` IS the serialised object, so it too has no temperature key"
            );
            assert.deepStrictEqual(sent, received, "logged body === received body, key for key");
            assert.ok((lines[0].dropped as string[]).includes("options.temperature"));
          }
        );
      } finally {
        await vendor.close();
      }
    }
  );

  await check(
    "LP-T2 · the table does NOT relax the declaration: no options.temperature still refuses unsent",
    async () => {
      const dir = newDir("temp-still-required");
      const logPath = join(dir, "proxy-log.jsonl");
      const vendor = await startFakeVendor();
      try {
        await withProxy(
          proxyConfig({ vendorUrl: vendor.url, logPath, model: REFUSES_TEMPERATURE_ALIAS }),
          async (_rt, endpoint) => {
            const reply = await call(
              endpoint,
              "/api/chat",
              "POST",
              chatBody({ model: REFUSES_TEMPERATURE_ALIAS, options: { seed: 7 } })
            );
            assert.strictEqual(reply.status, 502);
            assert.ok((reply.contentType ?? "").startsWith("text/plain"));
            assert.throws(() => JSON.parse(reply.body));
            assert.strictEqual(vendor.calls.length, 0, "nothing was sent");
          }
        );
        const lines = logLines(logPath);
        assert.strictEqual(lines.length, 1);
        assert.strictEqual(
          lines[0].outcome,
          "REFUSED_temperature_absent",
          "a model that refuses the field on the wire still must be DECLARED a value"
        );
        assert.strictEqual(lines[0].sent, null);
        assert.strictEqual(lines[0].sentSha256, null);
      } finally {
        await vendor.close();
      }
    }
  );

  await check(
    "LP-T3 · a model NOT in the table is untouched by S130 — pre-S130 behaviour, pinned",
    async () => {
      const dir = newDir("temp-still-sent");
      const logPath = join(dir, "proxy-log.jsonl");
      const vendor = await startFakeVendor();
      try {
        await withProxy(
          proxyConfig({ vendorUrl: vendor.url, logPath, model: ACCEPTS_TEMPERATURE_ALIAS }),
          async (_rt, endpoint) => {
            const reply = await call(
              endpoint,
              "/api/chat",
              "POST",
              chatBody({ model: ACCEPTS_TEMPERATURE_ALIAS })
            );
            assert.strictEqual(reply.status, 200, reply.body);

            const received = JSON.parse(vendor.calls[0].body) as Record<string, unknown>;
            assert.strictEqual(received.temperature, 0, "`temperature` is still forwarded");
            assert.deepStrictEqual(Object.keys(received).sort(), [
              "messages",
              "model",
              "stream",
              "temperature",
            ]);

            const out = JSON.parse(reply.body) as Record<string, unknown>;
            const proxyFacts = out.proxy as Record<string, unknown>;
            assert.deepStrictEqual(
              proxyFacts.dropped,
              ["think", "options.seed"],
              "and `options.temperature` is NOT named as dropped, because it was not"
            );
            assert.deepStrictEqual(logLines(logPath)[0].dropped, ["think", "options.seed"]);
          }
        );
      } finally {
        await vendor.close();
      }
    }
  );

  await check(
    "LP-T4 · `dropped` on a member's call is exactly think, options.seed, options.temperature",
    async () => {
      // At the unit, where the order is produced …
      assert.deepStrictEqual(
        droppedKeys(
          { think: false, options: { seed: 7, temperature: 0 } },
          REFUSES_TEMPERATURE_ALIAS
        ),
        ["think", "options.seed", "options.temperature"]
      );
      // … and a member call that declared NEITHER think NOR seed names only the one.
      assert.deepStrictEqual(droppedKeys({ options: { temperature: 0 } }, REFUSES_TEMPERATURE_ALIAS), [
        "options.temperature",
      ]);

      // … and end to end, where a receipt reads it.
      const dir = newDir("temp-dropped-order");
      const logPath = join(dir, "proxy-log.jsonl");
      const vendor = await startFakeVendor();
      try {
        await withProxy(
          proxyConfig({ vendorUrl: vendor.url, logPath, model: REFUSES_TEMPERATURE_ALIAS }),
          async (_rt, endpoint) => {
            const reply = await call(
              endpoint,
              "/api/chat",
              "POST",
              chatBody({ model: REFUSES_TEMPERATURE_ALIAS })
            );
            assert.strictEqual(reply.status, 200, reply.body);
            const out = JSON.parse(reply.body) as Record<string, unknown>;
            assert.deepStrictEqual((out.proxy as Record<string, unknown>).dropped, [
              "think",
              "options.seed",
              "options.temperature",
            ]);
            assert.deepStrictEqual(logLines(logPath)[0].dropped, [
              "think",
              "options.seed",
              "options.temperature",
            ]);
          }
        );
      } finally {
        await vendor.close();
      }
    }
  );

  console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
  if (failed > 0) process.exit(1);
}

void main_();
