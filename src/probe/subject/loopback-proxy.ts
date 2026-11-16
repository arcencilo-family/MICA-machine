#!/usr/bin/env node
// ── MICA · `mica-proxy` — the loopback proxy for API subjects (S128) ──────────
//
// S128 build, deliverable §9.1 (ARC_MICA-BRIEF_S128-Loopback-Proxy_20260913).
//
// ONE SENTENCE THIS PROGRAM IS ALLOWED TO SAY:
//
//   A request arrived on loopback in Ollama's `/api/chat` shape; I forwarded
//   its `messages` and its `temperature` — or, for a model that refuses the
//   field, its `messages` alone and the omission named — and nothing else — to
//   the one configured vendor under my own key, and I answered with the
//   vendor's words and the model string the VENDOR RETURNED, having written
//   down the exact bytes I sent.
//
//   It adds no system prompt, no tools, no memory, no retry that re-asks, and
//   no fallback model. It grades nothing and reads nothing for meaning.
//
// ── IT IS DELIBERATELY RUDE WHEN IT CANNOT ANSWER HONESTLY `[LB]` (brief §4) ─
//
//   The runner JSON-parses the subject's reply REGARDLESS of HTTP status and
//   appends whatever parses (`ollama-runner.ts`, `run()`); its resume key then
//   skips that (scenario, variant, seed, payloadSha256) forever. So a vendor
//   429, a filtered completion or a timeout handed back as well-formed JSON
//   would become a "capture" that is never re-asked — a hole in the evidence
//   with a tick beside it.
//
//   Therefore every failure answers **HTTP 502, `Content-Type: text/plain`**,
//   one line, NOT JSON:
//
//       mica-proxy: <reason>; logSeq=<n>
//
//   The runner throws "was not JSON", appends nothing, exits IO=1, and the next
//   run re-asks. The full vendor status and body live in this proxy's own log
//   (§5 of the brief, `ProxyLog` below), where a receipt can reach them.
//
//   This is the one place the proxy is impolite, and it is impolite on purpose.
//
// ── THE MODEL STRING IS THE VENDOR'S, NOT THE ALIAS (R5) ────────────────────
//
//   The reply's top-level `model` is the string the vendor RETURNED
//   (e.g. `gpt-4o-mini-2024-07-18`), not the alias that was requested. The
//   requested alias is carried separately under `proxy.requestedModel`. The
//   runner keeps the whole reply verbatim, so R5 lands in the captures file
//   itself and not only in a side log. The alias is what was ASKED FOR; the
//   returned string is what ANSWERED, and those are two different facts.
//
// ── WHAT IS DROPPED, AND NAMED AS DROPPED ───────────────────────────────────
//
//   `think`         — OpenAI has no wire form for it on this model (R4/§3).
//   `options.seed`  — NOT forwarded, by ruling (R3). OpenAI's `seed` is
//                     best-effort and is declined on purpose so pilots 3–5 stay
//                     comparable with an Anthropic rung later.
//   `options.temperature` — NOT SENT for models in TEMPERATURE_NOT_SENT_MODELS
//                     (S130); the inbound must still declare it.
//
//   All appear in `proxy.dropped` in the reply and in `dropped` in the log,
//   listing what was ACTUALLY PRESENT on this call rather than a fixed set.
//   `options.seed` is therefore CARRIED by the declaration and NOT SENT by this
//   proxy — the register row and the receipt must say so in those words, and
//   for a member of the table `options.temperature` is carried and not sent in
//   exactly the same sense.
//
// ── THREE REFUSALS THIS FILE ADDS TO THE BRIEF'S §4 LIST, NAMED RATHER THAN
//    SLIPPED IN ────────────────────────────────────────────────────────────
//
//   The brief enumerates: vendor non-2xx; vendor body not JSON; content not a
//   non-empty string; model ≠ alias; malformed inbound JSON; timeout. Three
//   more are refused here, each for the same reason the six are:
//
//     1. inbound `messages` absent or not a non-empty array — the proxy would
//        otherwise pay the vendor to reject an empty question, and the 400 that
//        came back would be recorded as a vendor fault rather than ours.
//     2. inbound `options.temperature` absent or not a finite number — sending
//        without it lets the VENDOR'S default stand in for a declared value.
//        A declaration saying `temperature: 0` that silently ran at 1 is the
//        exact silent-substitution this whole instrument refuses.
//     3. the vendor's reply carries no `model` string — R5 says the returned
//        string IS the subject. A reply that will not say what answered cannot
//        be recorded as an answer.
//
//   All three are `[owed → board]` for a ruling if the house disagrees; until
//   then they refuse loudly rather than send or record something unstated.
//
// ── THE KEY IS REDACTED BY CONSTRUCTION, NOT BY A FILTER ────────────────────
//
//   The key is written into ONE place: the outbound `Authorization` header. It
//   is never a field of the outbound JSON body, and the log's `sent` IS that
//   body object. So there is no scrubbing step that could be forgotten — the
//   object that gets logged has never held the secret. `loopback-proxy.test.ts`
//   LP-7 holds this behaviourally rather than by inspection.
//
// ── THE VENDOR URL IS NOT AN ENVIRONMENT KNOB ───────────────────────────────
//
//   `MICA_PROXY_VENDOR` names a vendor; `VENDOR_ENDPOINTS` maps that name to a
//   URL. There is deliberately no `MICA_PROXY_VENDOR_URL`: an env var that
//   could point this program's key at an arbitrary host is a credential
//   exfiltration switch wearing a config field. The tests build a
//   `ProxyConfig` in-process and aim it at a fake vendor on loopback, which is
//   a thing a test can do and a deployment cannot.
//
//   The same reasoning holds `vendorTimeoutMs`: production takes
//   `VENDOR_TIMEOUT_MS` and nothing else.
//
// ── THE VENDOR EXCHANGE HAS A HARD CEILING, NOT ONLY AN IDLE TIMER (S130-4) ─
//
//   Until S130-4 the only clock here was `req.setTimeout`, an INACTIVITY timer
//   on the socket. It fires on a vendor that accepts and never speaks (LP-6),
//   so "the vendor never answered" was never the open state. The open state was
//   AFTER THE HEADERS: once the vendor has answered with status and headers the
//   response object `res` is in hand, and a stall or a break in the BODY is
//   emitted on `res`, not on `req`. With no listener there the promise settled
//   neither way — `res.on("end")` never came, `req.on("error")` never fired —
//   and the inbound call held a `seq` claimed by `log.take()` that was never
//   written. That is proxy log seq 33: pilot 5 attempt (2), wifi drop mid-call,
//   a runner waiting 49 minutes for a line that could not arrive (S130-A).
//
//   The whole exchange now runs under ONE hard wall-clock ceiling at
//   `vendorTimeoutMs`, phase-independent — before the socket, before the
//   headers, or mid-body — and `res`'s own faults reject. The inactivity timer
//   is gone rather than kept beside it: two clocks at one deadline are two
//   clocks no test can tell apart. The promise settles EXACTLY ONCE, the settle
//   clears the timer, and NO inbound call can claim a `seq` it never writes.
//   LP-6, LP-6b and LP-6c hold all of this behaviourally.
//
// ── THE LOG'S SEQUENCE RULE, STATED (brief §5) ──────────────────────────────
//
//   `seq` is monotone PER PROCESS START and begins at (lines already in the log
//   file) + 1. One line is written per INBOUND CALL — `/api/tags` included — so
//   while one process owns the file, `seq` IS the line number. Two processes
//   appending at once would break that, and the unit runs exactly one.
//
//   The file is born `0640` via `openSync(path, "a", 0o640)` — the same idiom
//   and the same reasoning as `appendCapture` in `ollama-runner.ts` (S122 §2.4):
//   the mode applies only when this call CREATES the file, so it is "what a new
//   log is born as" and never a chmod of one already in progress.
//
// ── WHAT THIS FILE DOES NOT TOUCH ───────────────────────────────────────────
//
//   `ollama-runner.ts`, `subject-declaration.ts` and the subject unit are
//   BYTE-IDENTICAL across this build (R1). The runner still speaks Ollama's
//   shape to `127.0.0.1` and still asserts `--endpoint-must-be-loopback`; the
//   subject unit still carries `IPAddressDeny=any`. Only this program, under
//   its own principal, is permitted out. Honey's gateway is not the door and
//   nothing in `.openclaw-honey/` is read or written (R4).
//
// EXIT CODES
//   0  the server was closed cleanly
//   2  it REFUSED TO START: a missing or malformed env var, an unreadable /
//      empty / too-permissive key file, an unknown vendor, or a port that would
//      not bind. Nothing was served and nothing was sent.

import { createHash } from "crypto";
import { closeSync, openSync, readFileSync, statSync, writeSync } from "fs";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "http";
import { request as httpsRequest } from "https";

/** The one sentence, printed by the banner before the listener is open. */
export const PROXY_SAYS_ONE_THING =
  "A request arrived on loopback in Ollama's /api/chat shape; I forwarded its messages and " +
  "its temperature — or, for a model that refuses the field, its messages alone and the " +
  "omission named — and nothing else — to the one configured vendor under my own key, and I " +
  "answered with the vendor's words and the model string the VENDOR RETURNED, having written " +
  "down the exact bytes I sent. I add no prompt, no tools, no memory, no retry and no fallback.";

/** A vendor name maps to exactly one URL. There is no env override — see the header. */
export const VENDOR_ENDPOINTS: ReadonlyMap<string, string> = new Map([
  ["openai", "https://api.openai.com/v1/chat/completions"],
]);

/**
 * Models whose vendor REFUSES an explicit `temperature`. For these the inbound MUST still
 * declare `options.temperature` — the refusal below stands — but the field is NOT SENT, and
 * its absence is named in `dropped` as `options.temperature`.
 *
 * Each member is here because a VENDOR SAID SO, in this proxy's own log, on this key:
 *
 *   `gpt-5-mini`  S130, proxy log seq 23 — 400 `unsupported_value`, param `temperature`.
 *   `gpt-5`       S131, proxy log seq 41 — 400 `unsupported_value`, param `temperature`:
 *                 "Unsupported value: 'temperature' does not support 0 with this model.
 *                 Only the default (1) value is supported."
 *
 * MEMBERSHIP IS SOURCE, NOT ENV: a knob that silently changes what reaches the vendor is the
 * substitution this file refuses. It is also EXACT STRINGS AND NOTHING ELSE — no prefix
 * match, no family rule — and from S131 that costs something it did not cost at S130: the
 * set now holds `gpt-5`, which is a prefix of `gpt-5-mini`, so a family rule and this table
 * would agree about both members and disagree only about a model nobody has run yet. LP-T0
 * therefore asks `droppedKeys` directly about a non-member that shares the prefix.
 */
export const TEMPERATURE_NOT_SENT_MODELS: ReadonlySet<string> = new Set(["gpt-5-mini", "gpt-5"]);

/** Brief §4. One value, in one place, for the one deployment. */
export const VENDOR_TIMEOUT_MS = 120_000;

/**
 * Permission bits a key file may NOT carry: `0o777 & ~0o640`. A key at 0600 or
 * 0640 starts; anything group-writable, world-anything or owner-executable does
 * not. The ceiling is 0640 because §6 act 3 installs it `root:mica-proxy 0640`.
 */
export const KEY_MODE_FORBIDDEN_BITS = 0o137;

export const PROXY_EXIT = { OK: 0, REFUSED_TO_START: 2 } as const;

export interface ProxyConfig {
  readonly port: number;
  /** The alias this proxy serves and the ONLY `model` it will accept inbound. */
  readonly model: string;
  /**
   * The secret itself, read from the key file at start. It reaches exactly one
   * place — the outbound `Authorization` header. Never log this object.
   */
  readonly key: string;
  readonly logPath: string;
  readonly vendor: string;
  readonly vendorUrl: string;
  readonly vendorTimeoutMs: number;
}

/** Typed so a caller can tell "the deployment is wrong" from "the disk broke". */
export class ProxyRefusedToStart extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProxyRefusedToStart";
  }
}

class VendorTimeout extends Error {}
class VendorUnreachable extends Error {}

// ── configuration — read once, at start, from the environment ───────────────

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (typeof v !== "string" || v.trim() === "") {
    throw new ProxyRefusedToStart(
      `refused to start: ${name} is not set. This program defaults no configuration value.`
    );
  }
  return v;
}

/**
 * Read the key file and REFUSE if it is unreadable, empty, or wider than 0640.
 *
 * The mode check is not decoration: a key readable by every account on the box
 * makes the "two principals never share one secret file" ruling (R2) a
 * statement about intentions rather than about the filesystem.
 */
export function readKeyFile(path: string): string {
  let mode: number;
  try {
    mode = statSync(path).mode;
  } catch (err) {
    throw new ProxyRefusedToStart(
      `refused to start: cannot stat the key file at ${path}: ` +
        `${err instanceof Error ? err.message : String(err)}`
    );
  }
  if ((mode & KEY_MODE_FORBIDDEN_BITS) !== 0) {
    throw new ProxyRefusedToStart(
      `refused to start: the key file at ${path} is mode ` +
        `0${(mode & 0o777).toString(8)}, wider than 0640 — a credential this proxy holds alone ` +
        `must not be readable or writable by anyone else.`
    );
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new ProxyRefusedToStart(
      `refused to start: cannot read the key file at ${path}: ` +
        `${err instanceof Error ? err.message : String(err)}`
    );
  }
  // §6 act 3 writes one line with no trailing newline; one that crept in is
  // stripped rather than sent, because a key with a newline in it fails at the
  // vendor with a message that names nothing useful.
  const key = text.replace(/\r?\n$/, "");
  if (key === "") {
    throw new ProxyRefusedToStart(`refused to start: the key file at ${path} is empty.`);
  }
  if (/\s/.test(key)) {
    throw new ProxyRefusedToStart(
      `refused to start: the key file at ${path} contains whitespace inside the key — it must be ` +
        `exactly one line holding the credential and nothing else.`
    );
  }
  return key;
}

export function configFromEnv(env: NodeJS.ProcessEnv): ProxyConfig {
  const portText = requireEnv(env, "MICA_PROXY_PORT");
  if (!/^\d+$/.test(portText)) {
    throw new ProxyRefusedToStart(
      `refused to start: MICA_PROXY_PORT must be a whole number, got ${JSON.stringify(portText)}.`
    );
  }
  const port = Number(portText);
  if (port < 1 || port > 65535) {
    throw new ProxyRefusedToStart(
      `refused to start: MICA_PROXY_PORT ${String(port)} is not a usable port.`
    );
  }

  const vendor = requireEnv(env, "MICA_PROXY_VENDOR");
  const vendorUrl = VENDOR_ENDPOINTS.get(vendor);
  if (vendorUrl === undefined) {
    throw new ProxyRefusedToStart(
      `refused to start: MICA_PROXY_VENDOR ${JSON.stringify(vendor)} is not one this proxy ` +
        `speaks (${[...VENDOR_ENDPOINTS.keys()].join(", ")}). An Anthropic rung is a later ` +
        `beat and a ruling, not a variable.`
    );
  }

  return {
    port,
    model: requireEnv(env, "MICA_PROXY_MODEL"),
    key: readKeyFile(requireEnv(env, "MICA_PROXY_KEY_FILE")),
    logPath: requireEnv(env, "MICA_PROXY_LOG"),
    vendor,
    vendorUrl,
    vendorTimeoutMs: VENDOR_TIMEOUT_MS,
  };
}

// ── the log — R5's home (brief §5) ──────────────────────────────────────────

export interface ProxyLogLine {
  readonly seq: number;
  readonly ts: string;
  /** Which inbound door this call came through. Added so `/api/tags` can be a line too. */
  readonly path: string;
  readonly inboundSha256: string;
  /** The EXACT outbound body, or null when nothing was sent. Never holds the key. */
  readonly sent: Record<string, unknown> | null;
  readonly sentSha256: string | null;
  readonly dropped: readonly string[];
  readonly vendorStatus: number | null;
  readonly vendorModelReturned: string | null;
  readonly vendorId: string | null;
  readonly systemFingerprint: string | null;
  readonly usage: unknown;
  readonly finishReason: string | null;
  readonly outcome: string;
  readonly wallMs: number;
  /** First 2,000 bytes of the vendor's body, on failure only. */
  readonly vendorBody?: string;
  /**
   * The TRANSPORT fault, when the vendor never got to answer at all (a timeout,
   * a refused connection). Kept apart from `vendorBody` on purpose: a receipt
   * reader must not mistake OUR error text for something the vendor said.
   */
  readonly transportError?: string;
}

/** Bytes of a failed vendor body kept in the log. Enough to name the fault, not a transcript. */
export const VENDOR_BODY_LOG_LIMIT = 2000;

export class ProxyLog {
  private next: number;

  constructor(private readonly path: string) {
    this.next = countLines(path) + 1;
  }

  /** Claimed at the START of an inbound call, so even an early refusal can cite it. */
  take(): number {
    return this.next++;
  }

  write(line: ProxyLogLine): void {
    const fd = openSync(this.path, "a", 0o640);
    try {
      writeSync(fd, JSON.stringify(line) + "\n");
    } finally {
      closeSync(fd);
    }
  }
}

function countLines(path: string): number {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return 0; // No log yet is the ordinary first-start case.
  }
  return text.split("\n").filter((l) => l.trim() !== "").length;
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// ── the vendor call ─────────────────────────────────────────────────────────

interface VendorReply {
  readonly status: number;
  readonly body: string;
}

/**
 * POST the body to the vendor and settle — always, once, within `timeoutMs`.
 *
 * THE CEILING IS THE CLOCK (S130-4). One `setTimeout` covers the whole exchange
 * and knows nothing about which phase it is in: connect, headers, or body. When
 * it fires it destroys the request and rejects `VendorTimeout`, with the message
 * this function has always used.
 *
 * `req.setTimeout` IS GONE, and that is a decision rather than a tidy-up (brief
 * S130-4 §2.1 left it to the seat). It was an inactivity timer at the same
 * value: it resets on every byte, so it can fire late or never, while the
 * ceiling fires no later than `timeoutMs` after the call began. The ceiling
 * therefore covers every case the idle timer covered and one it did not — a
 * vendor that dribbles bytes forever without ending the body. Keeping both
 * would leave TWO clocks at one deadline, and a test could not then say which
 * of them settled a call: the mutation that removes the ceiling would still
 * pass, and the ceiling would be untested code wearing a green tick.
 *
 * `res`'s own faults reject too — `error`, and `aborted` for the Node <= 16
 * spelling. A vendor that closes mid-body is `VendorUnreachable`, never a hang.
 * If the ceiling has already fired, `VendorTimeout` wins: the FIRST true fact
 * about why this call ended is the one the log should carry, and every later
 * error on a destroyed socket is only the echo of that one.
 */
function postToVendor(
  urlString: string,
  key: string,
  body: string,
  timeoutMs: number
): Promise<VendorReply> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(urlString);
    } catch {
      reject(new VendorUnreachable(`the vendor URL ${urlString} is not a URL`));
      return;
    }
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;

    // SETTLE ONCE. Several paths below fire for the SAME broken call — the
    // ceiling destroys the socket, which raises an error on `req` and an abort
    // on `res` — and one inbound call must produce one log line, not two.
    let settled = false;
    let timedOut = false;
    let ceiling: NodeJS.Timeout | undefined;

    function clearCeiling(): void {
      if (ceiling !== undefined) {
        clearTimeout(ceiling);
        ceiling = undefined;
      }
    }
    function settleOk(reply: VendorReply): void {
      if (settled) return;
      settled = true;
      clearCeiling();
      resolve(reply);
    }
    function settleErr(err: Error): void {
      if (settled) return;
      settled = true;
      clearCeiling();
      reject(err);
    }
    /** Every transport fault reads the same way: the ceiling wins if it fired. */
    function transportFailed(message: string): void {
      settleErr(
        timedOut
          ? new VendorTimeout(`no reply from the vendor within ${String(timeoutMs)} ms`)
          : new VendorUnreachable(message)
      );
    }

    const req = send(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port === "" ? undefined : url.port,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          // THE ONLY PLACE THE KEY IS WRITTEN. Not a body field, ever.
          authorization: `Bearer ${key}`,
        },
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          settleOk({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        // THE RESPONSE SIDE, which before S130-4 had no listener at all. This
        // is where a vendor that answered and then stopped puts its fault.
        res.on("error", (err: Error) => {
          transportFailed(err.message);
        });
        res.on("aborted", () => {
          transportFailed("the vendor closed the connection before the body ended");
        });
      }
    );

    // THE HARD CEILING. Phase-independent, and the only clock this function
    // depends on. `req.destroy()` first so the socket is gone, then the settle.
    ceiling = setTimeout(() => {
      timedOut = true;
      req.destroy();
      settleErr(new VendorTimeout(`no reply from the vendor within ${String(timeoutMs)} ms`));
    }, timeoutMs);

    req.on("error", (err: Error) => {
      transportFailed(err.message);
    });
    req.write(body);
    req.end();
  });
}

// ── reading the inbound request ─────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function stringOrNull(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}

/**
 * The outbound body, exactly: `model` is the PROXY'S alias, `messages` are the
 * caller's own value untouched, `temperature` comes from `options`, `stream` is
 * false. Nothing else — no `max_tokens`, no `n`, no `tools`, no
 * `response_format`. `[owed]` if a vendor default proves too short for a reply:
 * that is a ruling and then a config field, never a silent constant here.
 *
 * `temperature === undefined` means the caller decided this model is one that
 * REFUSES the field (S130). The key is then ABSENT FROM THE OBJECT — not `null`
 * and not present-and-undefined, because `JSON.stringify` would drop the latter
 * silently and the log's `sent` must BE the object that was serialised. The
 * decision is the caller's and never this function's: a body builder that read
 * the table itself would let a caller believe it had sent what it had not.
 */
export function buildVendorBody(
  alias: string,
  messages: unknown,
  temperature: number | undefined
): Record<string, unknown> {
  return temperature === undefined
    ? { model: alias, messages, stream: false }
    : { model: alias, messages, temperature, stream: false };
}

/**
 * Which of the dropped keys were actually present on THIS call.
 *
 * `alias` is the model this proxy serves, and it decides only the third entry:
 * `options.temperature` is named as dropped when the alias is in
 * TEMPERATURE_NOT_SENT_MODELS **and** the inbound actually declared it. The
 * parameter is required rather than optional on purpose — a caller that forgot
 * it would under-report what it had not sent, which is the one thing this list
 * exists to prevent.
 */
export function droppedKeys(inbound: Record<string, unknown>, alias: string): string[] {
  const dropped: string[] = [];
  if (inbound.think !== undefined) dropped.push("think");
  const options = inbound.options;
  if (isObject(options) && options.seed !== undefined) dropped.push("options.seed");
  if (
    TEMPERATURE_NOT_SENT_MODELS.has(alias) &&
    isObject(options) &&
    options.temperature !== undefined
  ) {
    dropped.push("options.temperature");
  }
  return dropped;
}

// ── the server ──────────────────────────────────────────────────────────────

const TAGS_PATH = "/api/tags";
const CHAT_PATH = "/api/chat";

export function createProxy(config: ProxyConfig): Server {
  const log = new ProxyLog(config.logPath);

  const blank = {
    sent: null,
    sentSha256: null,
    dropped: [] as readonly string[],
    vendorStatus: null,
    vendorModelReturned: null,
    vendorId: null,
    systemFingerprint: null,
    usage: null,
    finishReason: null,
  };

  /** The rude answer. Not JSON, on purpose — see the header. */
  function rude(res: ServerResponse, seq: number, reason: string, status = 502): void {
    res.statusCode = status;
    res.setHeader("content-type", "text/plain");
    res.end(`mica-proxy: ${reason}; logSeq=${String(seq)}\n`);
  }

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const seq = log.take();
    const startedNs = process.hrtime.bigint();
    const path = req.url ?? "";
    const wall = (): number => Number(process.hrtime.bigint() - startedNs) / 1e6;

    void readBody(req)
      .then(async (raw) => {
        const inboundSha256 = sha256(raw);
        const base = { seq, ts: new Date().toISOString(), path, inboundSha256, ...blank };

        // ── /api/tags — exactly one name, the configured alias ─────────────
        if (path === TAGS_PATH && req.method === "GET") {
          log.write({ ...base, outcome: "OK", wallMs: wall() });
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ models: [{ name: config.model }] }));
          return;
        }

        if (path !== CHAT_PATH || req.method !== "POST") {
          log.write({
            ...base,
            outcome: "REFUSED_unknown_door",
            wallMs: wall(),
          });
          rude(res, seq, `no such door: ${req.method ?? "?"} ${path}`, 404);
          return;
        }

        // ── /api/chat ──────────────────────────────────────────────────────
        let inbound: unknown;
        try {
          inbound = JSON.parse(raw);
        } catch {
          log.write({ ...base, outcome: "REFUSED_inbound_not_json", wallMs: wall() });
          rude(res, seq, "the inbound body was not JSON");
          return;
        }
        if (!isObject(inbound)) {
          log.write({ ...base, outcome: "REFUSED_inbound_not_an_object", wallMs: wall() });
          rude(res, seq, "the inbound body was not a JSON object");
          return;
        }

        // The declaration and this proxy must agree on the alias, or the run is
        // asking one thing and sending another. NOTHING is sent on a mismatch.
        if (inbound.model !== config.model) {
          log.write({ ...base, outcome: "REFUSED_model_mismatch", wallMs: wall() });
          rude(
            res,
            seq,
            `requested model ${JSON.stringify(inbound.model)} is not the one this proxy serves ` +
              `(${config.model}); nothing was sent`
          );
          return;
        }

        const messages = inbound.messages;
        if (!Array.isArray(messages) || messages.length === 0) {
          log.write({ ...base, outcome: "REFUSED_messages_absent", wallMs: wall() });
          rude(res, seq, "the inbound body carried no messages; nothing was sent");
          return;
        }

        const options = inbound.options;
        const temperature = isObject(options) ? options.temperature : undefined;
        if (typeof temperature !== "number" || !Number.isFinite(temperature)) {
          log.write({ ...base, outcome: "REFUSED_temperature_absent", wallMs: wall() });
          rude(
            res,
            seq,
            "the inbound body declared no options.temperature; the vendor's default must not " +
              "stand in for a declared value, so nothing was sent"
          );
          return;
        }

        // S130: for a model that refuses the field, the inbound declaration is
        // still required above — only the WIRE changes. The branch is decided
        // here, once, and `dropped` names the omission in the same breath.
        const dropped = droppedKeys(inbound, config.model);
        const sent = buildVendorBody(
          config.model,
          messages,
          TEMPERATURE_NOT_SENT_MODELS.has(config.model) ? undefined : temperature
        );
        const serialized = JSON.stringify(sent);
        const sentSha256 = sha256(serialized);
        const sentBase = { ...base, sent, sentSha256, dropped };

        let reply: VendorReply;
        try {
          reply = await postToVendor(
            config.vendorUrl,
            config.key,
            serialized,
            config.vendorTimeoutMs
          );
        } catch (err) {
          const timedOut = err instanceof VendorTimeout;
          log.write({
            ...sentBase,
            outcome: timedOut ? "TIMEOUT" : "REFUSED_vendor_unreachable",
            wallMs: wall(),
            transportError: err instanceof Error ? err.message : String(err),
          });
          rude(
            res,
            seq,
            timedOut ? "the vendor did not answer in time" : "the vendor could not be reached"
          );
          return;
        }

        if (reply.status < 200 || reply.status > 299) {
          log.write({
            ...sentBase,
            vendorStatus: reply.status,
            outcome: `VENDOR_${String(reply.status)}`,
            wallMs: wall(),
            vendorBody: reply.body.slice(0, VENDOR_BODY_LOG_LIMIT),
          });
          rude(res, seq, `the vendor answered ${String(reply.status)}`);
          return;
        }

        let vendorJson: unknown;
        try {
          vendorJson = JSON.parse(reply.body);
        } catch {
          log.write({
            ...sentBase,
            vendorStatus: reply.status,
            outcome: "REFUSED_vendor_body_not_json",
            wallMs: wall(),
            vendorBody: reply.body.slice(0, VENDOR_BODY_LOG_LIMIT),
          });
          rude(res, seq, "the vendor's body was not JSON");
          return;
        }
        if (!isObject(vendorJson)) {
          log.write({
            ...sentBase,
            vendorStatus: reply.status,
            outcome: "REFUSED_vendor_body_not_an_object",
            wallMs: wall(),
            vendorBody: reply.body.slice(0, VENDOR_BODY_LOG_LIMIT),
          });
          rude(res, seq, "the vendor's body was not a JSON object");
          return;
        }

        const choicesRaw: unknown = vendorJson.choices;
        const firstChoice: unknown = Array.isArray(choicesRaw) ? choicesRaw[0] : undefined;
        const choice = isObject(firstChoice) ? firstChoice : undefined;
        const messageRaw: unknown = choice === undefined ? undefined : choice.message;
        const vendorMessage = isObject(messageRaw) ? messageRaw : undefined;
        const content: unknown = vendorMessage === undefined ? undefined : vendorMessage.content;
        const vendorModelReturned = stringOrNull(vendorJson.model);
        const vendorId = stringOrNull(vendorJson.id);
        const systemFingerprint = stringOrNull(vendorJson.system_fingerprint);
        const usage = vendorJson.usage ?? null;
        const finishReason = choice === undefined ? null : stringOrNull(choice.finish_reason);
        const vendorFacts = {
          vendorStatus: reply.status,
          vendorModelReturned,
          vendorId,
          systemFingerprint,
          usage,
          finishReason,
        };

        // An empty or absent `content` would template as a blank reply and be
        // skipped on resume forever. It is a refusal, never an empty string.
        if (typeof content !== "string" || content === "") {
          log.write({
            ...sentBase,
            ...vendorFacts,
            outcome: "REFUSED_vendor_content_absent",
            wallMs: wall(),
            vendorBody: reply.body.slice(0, VENDOR_BODY_LOG_LIMIT),
          });
          rude(res, seq, "the vendor returned no assistant content");
          return;
        }

        // R5: the returned string IS the subject. A reply that will not say what
        // answered cannot be recorded as an answer.
        if (vendorModelReturned === null) {
          log.write({
            ...sentBase,
            ...vendorFacts,
            outcome: "REFUSED_vendor_model_absent",
            wallMs: wall(),
            vendorBody: reply.body.slice(0, VENDOR_BODY_LOG_LIMIT),
          });
          rude(res, seq, "the vendor named no model in its reply");
          return;
        }

        log.write({ ...sentBase, ...vendorFacts, outcome: "OK", wallMs: wall() });

        // Ollama's non-streaming chat shape, plus two keys the runner ignores
        // and keeps verbatim. NO `total_duration` and friends are fabricated:
        // absent is honest, and the runner measures `wallMs` from outside.
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            model: vendorModelReturned,
            created_at: new Date().toISOString(),
            message: { role: "assistant", content },
            done: true,
            done_reason: finishReason,
            vendor: {
              id: vendorId,
              model: vendorModelReturned,
              system_fingerprint: systemFingerprint,
              usage,
              finish_reason: finishReason,
            },
            proxy: {
              requestedModel: config.model,
              dropped,
              sentSha256,
              logSeq: seq,
            },
          })
        );
      })
      .catch((err: unknown) => {
        // The inbound socket broke while being read. Nothing was sent.
        log.write({
          seq,
          ts: new Date().toISOString(),
          path,
          inboundSha256: "",
          ...blank,
          outcome: "REFUSED_inbound_read_failed",
          wallMs: wall(),
          transportError: err instanceof Error ? err.message : String(err),
        });
        if (!res.headersSent) rude(res, seq, "the inbound request could not be read");
      });
  });
}

export interface ProxyRuntime {
  readonly server: Server;
  readonly port: number;
  readonly close: () => Promise<void>;
}

/**
 * Bind, or refuse to start. A port that is not free is a deployment fact and
 * exits 2 — never a retry on another port, which would leave the runner talking
 * to nothing while this process looked healthy.
 */
export function startProxy(config: ProxyConfig, host = "127.0.0.1"): Promise<ProxyRuntime> {
  const server = createProxy(config);
  return new Promise((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      reject(
        new ProxyRefusedToStart(
          `refused to start: cannot listen on ${host}:${String(config.port)}: ${err.message}`
        )
      );
    });
    server.listen(config.port, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : config.port;
      resolve({
        server,
        port,
        close: () => new Promise<void>((done) => server.close(() => { done(); })),
      });
    });
  });
}

export async function main(
  env: NodeJS.ProcessEnv,
  out: (s: string) => void,
  err: (s: string) => void
): Promise<number> {
  let config: ProxyConfig;
  try {
    config = configFromEnv(env);
  } catch (e) {
    err(`mica-proxy: ${e instanceof Error ? e.message : String(e)}`);
    return PROXY_EXIT.REFUSED_TO_START;
  }

  let runtime: ProxyRuntime;
  try {
    runtime = await startProxy(config);
  } catch (e) {
    err(`mica-proxy: ${e instanceof Error ? e.message : String(e)}`);
    return PROXY_EXIT.REFUSED_TO_START;
  }

  out(`── mica-proxy ─────────────────────────────────────────────────`);
  out(PROXY_SAYS_ONE_THING);
  out(``);
  out(`listening   127.0.0.1:${String(runtime.port)}`);
  out(`alias       ${config.model}   (the only model served and the only one accepted)`);
  out(`vendor      ${config.vendor} -> ${config.vendorUrl}`);
  out(`timeout     ${String(config.vendorTimeoutMs)} ms`);
  out(`log         ${config.logPath}`);
  out(
    `dropped     think, options.seed — carried, NOT SENT (R3); options.temperature — NOT SENT ` +
      `for: ${[...TEMPERATURE_NOT_SENT_MODELS].join(", ")} (S130, S131)`
  );
  out(``);

  await new Promise<void>((resolve) => runtime.server.once("close", resolve));
  return PROXY_EXIT.OK;
}

if (require.main === module) {
  void main(
    process.env,
    (s) => {
      console.log(s);
    },
    (s) => {
      console.error(s);
    }
  ).then((code) => {
    process.exit(code);
  });
}
