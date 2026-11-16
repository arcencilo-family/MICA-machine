// ── MICA · the pilot runner — acceptance tests (S119 pilot, deliverable 3.1) ──
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node src/probe/subject/ollama-runner.test.ts
//
// NO LIVE MODEL IS EVER CONTACTED. Every test that needs a subject starts a
// fixture HTTP server on 127.0.0.1:0 (an ephemeral port the OS picks) which
// records what it was sent and answers with a canned Ollama-shaped body. The
// suite must be runnable on a box with no Ollama installed, and it is.
//
// Every test that touches a disk makes its OWN directory with `mkdtempSync`.
// No test names a deployment path.
//
// THE MODEL NAME IS NOT TYPED ANYWHERE IN THIS FILE, and OR-E is why: the
// fixture asserts that the model on the wire is the one the DECLARATION named,
// using an obvious fixture string. That is a behavioural proof that the runner
// hardcodes no model — strictly stronger than grepping the repo for a literal.

import assert from "assert";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { AddressInfo } from "net";

import { G5_FAMILY } from "../families/g5";
import { HELD_OUT_FAMILY } from "../families/held-out";
import { N1_FAMILY } from "../families/n1";
import { N2_FAMILY } from "../families/n2";
import { N3_FAMILY } from "../families/n3";
import { N4_FAMILY } from "../families/n4";
import { N5_FAMILY, N5_NEGATIVE_CONTROL_ABSENT_DISCLOSURE } from "../families/n5";
import { SIGMA_CONFLICT_FAMILY } from "../families/sigma-conflict";
import { SIGMA_DEFECT_FAMILY } from "../families/sigma-defect";
import { SIGMA_DOUBT_FAMILY } from "../families/sigma-doubt";
import { SIGMA_TIME_FAMILY } from "../families/sigma-time";
import { SIGMA_UNMON_FAMILY } from "../families/sigma-unmon";
import { W_FAMILY, W_NEGATIVE_CONTROL_PHRASING_VS_OBSERVABLE } from "../families/w";
import { validateObservableChecks, type ScenarioDefinition } from "../scenario";

/**
 * Every scenario the repo ships, the two standalone negative controls included:
 * OR-D3 asserts the THIRD_PERSON composition over ALL of them, so a family
 * added later without a seat is covered the moment it is imported here.
 */
const ALL_SHIPPED_FAMILIES: readonly (readonly ScenarioDefinition[])[] = [
  N1_FAMILY,
  N2_FAMILY,
  N3_FAMILY,
  N4_FAMILY,
  N5_FAMILY,
  W_FAMILY,
  SIGMA_TIME_FAMILY,
  SIGMA_DOUBT_FAMILY,
  SIGMA_DEFECT_FAMILY,
  SIGMA_UNMON_FAMILY,
  SIGMA_CONFLICT_FAMILY,
  G5_FAMILY,
  HELD_OUT_FAMILY,
  [N5_NEGATIVE_CONTROL_ABSENT_DISCLOSURE, W_NEGATIVE_CONTROL_PHRASING_VS_OBSERVABLE],
];
import { DeclaredSubjectPort, DeclaredSubjectPortRefused } from "./declared-subject-port";
import {
  buildPayload,
  buildTemplate,
  composeUserMessage,
  SECOND_PERSON_SEAT_FRAMING,
  main,
  noticesFor,
  parseArgs,
  parseTemplateArgs,
  readExistingKeys,
  RunnerRefused,
  selectScenarios,
  TEMPLATE_OBSERVABLE_KEYS,
} from "./ollama-runner";
import {
  CEILING_SENTENCE,
  SUBJECT_DECLARATION_BASIS,
  parseSubjectDeclaration,
} from "./subject-declaration";

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

// ── the fixture subject ─────────────────────────────────────────────────────

interface Fixture {
  readonly server: Server;
  readonly endpoint: string;
  /** Every /api/chat body this fixture was sent, parsed. */
  readonly chatRequests: unknown[];
  readonly close: () => Promise<void>;
}

/** A canned reply. `total_duration` is present so a test can prove it survives. */
function cannedReply(extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    model: "fixture-model:0b",
    created_at: "2026-09-09T12:00:00.000Z",
    message: { role: "assistant", content: "a fixture reply" },
    done: true,
    done_reason: "stop",
    total_duration: 123456789,
    eval_count: 7,
    eval_duration: 1000,
    ...extra,
  };
}

async function startFixture(options?: {
  readonly servedModels?: readonly string[];
  readonly reply?: Record<string, unknown>;
}): Promise<Fixture> {
  const chatRequests: unknown[] = [];
  const served = options?.servedModels ?? ["fixture-model:0b"];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      if (req.url === "/api/tags") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ models: served.map((n) => ({ name: n })) }));
        return;
      }
      if (req.url === "/api/chat") {
        chatRequests.push(JSON.parse(body));
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(options?.reply ?? cannedReply()));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    endpoint: `http://127.0.0.1:${String(port)}`,
    chatRequests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function declarationFile(dir: string, overrides?: Record<string, unknown>): string {
  const path = join(dir, "subject.json");
  writeFileSync(
    path,
    JSON.stringify({
      subjectId: "fixture-subject",
      model: "fixture-model:0b",
      thinkFlag: false,
      options: { seed: 1, temperature: 0 },
      systemPrompt: "You are a fixture agent.",
      endpoint: "http://127.0.0.1:1",
      basis: SUBJECT_DECLARATION_BASIS,
      declaredBy: "fixture-arbiter",
      declaredAt: "2026-09-09T12:00:00.000Z",
      ...overrides,
    }),
    "utf8"
  );
  return path;
}

function fixtureDeclaration(overrides?: Record<string, unknown>) {
  return parseSubjectDeclaration({
    subjectId: "fixture-subject",
    model: "fixture-model:0b",
    thinkFlag: false,
    options: { seed: 1, temperature: 0 },
    systemPrompt: "You are a fixture agent.",
    endpoint: "http://127.0.0.1:1",
    basis: SUBJECT_DECLARATION_BASIS,
    declaredBy: "fixture-arbiter",
    declaredAt: "2026-09-09T12:00:00.000Z",
    ...overrides,
  });
}

function capturedLines(path: string): Record<string, unknown>[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function argvFor(subject: string, captures: string, extra?: readonly string[]): string[] {
  return [
    "--subject",
    subject,
    "--families",
    "N5",
    "--variants",
    "STRESS,CONTROL",
    "--seeds",
    "1",
    "--captures",
    captures,
    "--endpoint-must-be-loopback",
    ...(extra ?? []),
  ];
}

/** Runs `main` with stdout captured, so the banner can be asserted. */
async function mainCapturingOutput(argv: readonly string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const realLog = console.log;
  const realError = console.error;
  console.log = (...a: unknown[]) => lines.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => lines.push(a.map(String).join(" "));
  try {
    const code = await main(argv);
    return { code, out: lines.join("\n") };
  } finally {
    console.log = realLog;
    console.error = realError;
  }
}

async function main_(): Promise<void> {
  console.log("\n── pilot runner · no defaults, append-only, nothing graded ────");

  await check("OR-A · every required flag, omitted one at a time, is refused by name", () => {
    const full = argvFor("/s", "/c");
    const flags = ["--subject", "--families", "--variants", "--seeds", "--captures"];
    for (const flag of flags) {
      const i = full.indexOf(flag);
      const without = [...full.slice(0, i), ...full.slice(i + 2)];
      assert.throws(
        () => parseArgs(without),
        (e: unknown) => e instanceof RunnerRefused && e.message.includes(flag),
        `omitting ${flag} was not refused by name`
      );
    }
    const noLoopback = full.filter((a) => a !== "--endpoint-must-be-loopback");
    assert.throws(
      () => parseArgs(noLoopback),
      (e: unknown) => e instanceof RunnerRefused && e.message.includes("--endpoint-must-be-loopback")
    );
  });

  await check("OR-B · unknown family, unknown variant and a non-integer seed are refused", () => {
    assert.throws(
      () => parseArgs(argvFor("/s", "/c").map((a) => (a === "N5" ? "N9" : a))),
      (e: unknown) => e instanceof RunnerRefused && e.message.includes("N9")
    );
    assert.throws(
      () => parseArgs(argvFor("/s", "/c").map((a) => (a === "STRESS,CONTROL" ? "STRESS,SIDEWAYS" : a))),
      (e: unknown) => e instanceof RunnerRefused && e.message.includes("SIDEWAYS")
    );
    assert.throws(
      () => parseArgs(argvFor("/s", "/c").map((a) => (a === "1" ? "one" : a))),
      (e: unknown) => e instanceof RunnerRefused && e.message.includes("one")
    );
  });

  await check("OR-C · selection is exactly N5_FAMILY — the negative control is unreachable", () => {
    const ids = selectScenarios(["N5"]).map((s) => s.id);
    assert.deepStrictEqual(ids, N5_FAMILY.map((s) => s.id));
    // S133: 4 -> 5. The fifth N5 packet (W2u) is delivered by the same axis
    // selection, which is what makes pilot 8 a TEN-call run and not an eight.
    assert.strictEqual(ids.length, 5, "N5_FAMILY is five scenarios");
    assert.ok(
      !ids.includes(N5_NEGATIVE_CONTROL_ABSENT_DISCLOSURE.id),
      "the negative control must never be selected — it is not a family member"
    );
  });

  await check("OR-D · STRESS carries the stressor verbatim; CONTROL is the setup alone", () => {
    // S132: THIS USED TO BE `N5_FAMILY[0]`, and it cannot be any more. Series 2
    // re-seated all four N5 members to SECOND_PERSON, so that scenario now gets
    // the seat framing prepended and the plain formula below is no longer what
    // it composes to. The property under test here is the SEAT-LESS one — the
    // formula every third-person scenario still obeys — so it is asked of a
    // scenario that actually is one, rather than weakened to accommodate a
    // framing line. OR-D2 holds the SECOND_PERSON half.
    const s = ALL_SHIPPED_FAMILIES.flat().find(
      (x) => (x.deliverySeat ?? "THIRD_PERSON") === "THIRD_PERSON"
    );
    assert.ok(s, "no third-person scenario is shipped — OR-D has nothing to stand on");
    const stress = composeUserMessage(s!, "STRESS");
    const control = composeUserMessage(s!, "CONTROL");
    assert.strictEqual(control, s!.environment.setup, "CONTROL is the setup with the stressor removed");
    assert.ok(stress.startsWith(s!.environment.setup), "STRESS keeps the setup first");
    for (const step of s!.stressor.steps) {
      assert.ok(stress.includes(step), "every stressor step appears verbatim, unedited");
      assert.ok(!control.includes(step), "no stressor step may appear in the control");
    }
    assert.strictEqual(stress, [s!.environment.setup, ...s!.stressor.steps].join("\n"));
  });

  await check("OR-D2 · SECOND_PERSON prepends the seat framing ONCE, and edits not one byte of the prose", () => {
    // S132: EVERY SECOND_PERSON SCENARIO, not the first one found. Under S125
    // there was exactly one and `.find()` was the whole set; series 2 makes four,
    // and a `.find()` left alone would have gone on testing one of them while
    // three shipped unchecked — a test that silently narrows as the thing it
    // covers grows. The count is asserted too, so the next widening is visible
    // here as well as in CEN-SEAT.
    const seated: readonly ScenarioDefinition[] = ALL_SHIPPED_FAMILIES.flat().filter(
      (s) => s.deliverySeat === "SECOND_PERSON"
    );
    assert.strictEqual(seated.length, 5, `${String(seated.length)} SECOND_PERSON scenarios; series 3 ships five`);
    for (const w5 of seated) {
    for (const variant of ["CONTROL", "STRESS"] as const) {
      const composed = composeUserMessage(w5!, variant);
      const parts: readonly string[] =
        variant === "STRESS"
          ? [w5!.environment.setup, ...w5!.stressor.steps]
          : [w5!.environment.setup];
      // BOTH variants. A control delivered from a different seat than its own
      // stressor is not a fork of that stressor (scenario.ts's S125 addendum).
      assert.strictEqual(
        composed,
        [SECOND_PERSON_SEAT_FRAMING, ...parts].join("\n"),
        `${variant} is not framing + prose, exactly`
      );
      assert.strictEqual(
        composed.split(SECOND_PERSON_SEAT_FRAMING).length - 1,
        1,
        "the framing appears more than once"
      );
      // The composer must not have touched the author's words.
      for (const part of parts) {
        assert.ok(composed.includes(part), "a prose field was edited on the way to the subject");
      }
    }
    }
  });

  await check("OR-D3 · THIRD_PERSON composition is byte-identical to pre-S125 — over every shipped scenario", () => {
    // THE BEFORE/AFTER PIN. Pre-S125 `composeUserMessage` was exactly
    // `[setup, ...steps].join("\n")` for STRESS and `setup` for CONTROL, with no
    // branch. Asserting that formula over every scenario that is not
    // SECOND_PERSON is the same claim as diffing the old renderer against the
    // new one, and it keeps holding as families are added.
    let thirdPerson = 0;
    let secondPerson = 0;
    for (const family of ALL_SHIPPED_FAMILIES) {
      for (const s of family) {
        if ((s.deliverySeat ?? "THIRD_PERSON") === "SECOND_PERSON") {
          secondPerson++;
          continue;
        }
        thirdPerson++;
        assert.strictEqual(
          composeUserMessage(s, "STRESS"),
          [s.environment.setup, ...s.stressor.steps].join("\n"),
          `${s.id} STRESS composition moved`
        );
        assert.strictEqual(composeUserMessage(s, "CONTROL"), s.environment.setup, `${s.id} CONTROL composition moved`);
        assert.ok(
          !composeUserMessage(s, "STRESS").includes(SECOND_PERSON_SEAT_FRAMING),
          `${s.id} was handed a seat framing it never declared`
        );
      }
    }
    // S132: 1 -> 4. The N5 family is series 2 and is delivered whole from the
    // agent's own seat; every other shipped scenario still composes byte-identically
    // to pre-S125, which is what this test exists to keep saying.
    assert.strictEqual(secondPerson, 5, `${String(secondPerson)} scenarios are SECOND_PERSON; series 3 ships five`);
    assert.ok(thirdPerson > 50, `only ${String(thirdPerson)} third-person scenarios were checked`);
  });

  await check("OR-E · the payload's model, prompt and think flag come from the DECLARATION", () => {
    const d = fixtureDeclaration({ model: "another-fixture:1b", systemPrompt: "declared prompt" });
    const p = buildPayload(d, N5_FAMILY[0], "STRESS", 7) as Record<string, unknown>;
    assert.strictEqual(p.model, "another-fixture:1b", "the model is the declared one, never a literal");
    assert.strictEqual(p.think, false);
    assert.strictEqual(p.stream, false);
    assert.deepStrictEqual(p.options, { seed: 7, temperature: 0 }, "the call's seed overrides the base");
    const messages = p.messages as { role: string; content: string }[];
    assert.strictEqual(messages[0].role, "system");
    assert.strictEqual(messages[0].content, "declared prompt");
    assert.strictEqual(messages[1].role, "user");
  });

  await check("OR-F · a NON-LOOPBACK endpoint is refused and nothing is sent", async () => {
    const fx = await startFixture();
    try {
      const dir = mkdtempSync(join(tmpdir(), "mica-runner-loopback-"));
      const subject = declarationFile(dir, { endpoint: "http://192.168.1.10:11434" });
      const captures = join(dir, "captures.jsonl");
      const { code, out } = await mainCapturingOutput(argvFor(subject, captures));
      assert.strictEqual(code, 2, "a non-loopback endpoint is exit 2");
      assert.ok(out.includes("not loopback"), out);
      assert.strictEqual(fx.chatRequests.length, 0, "nothing may be sent");
      assert.throws(() => statSync(captures), "no captures file may be created");
    } finally {
      await fx.close();
    }
  });

  await check("OR-G · a model the subject does not serve is refused, and nothing is sent", async () => {
    const fx = await startFixture({ servedModels: ["some-other-fixture:2b"] });
    try {
      const dir = mkdtempSync(join(tmpdir(), "mica-runner-model-"));
      const subject = declarationFile(dir, { endpoint: fx.endpoint });
      const captures = join(dir, "captures.jsonl");
      const { code, out } = await mainCapturingOutput(argvFor(subject, captures));
      assert.strictEqual(code, 2);
      assert.ok(out.includes("not served"), out);
      assert.strictEqual(fx.chatRequests.length, 0, "nothing may be sent");
    } finally {
      await fx.close();
    }
  });

  await check("OR-H · a full run captures one line per call, with the reply VERBATIM", async () => {
    const reply = cannedReply();
    const fx = await startFixture({ reply });
    try {
      const dir = mkdtempSync(join(tmpdir(), "mica-runner-run-"));
      const subject = declarationFile(dir, { endpoint: fx.endpoint });
      const captures = join(dir, "captures.jsonl");
      // S122 §2.4. THE UMASK IS SET EXPLICITLY around the run that CREATES the
      // file: 002 is the umask this deployment actually uses and the one under
      // which a default 0666 open comes back 664. Under 022 the same defect
      // reads 644 and a mode assertion could pass for the wrong reason, so the
      // hostile value is named rather than inherited. Restored in `finally`
      // before anything else in this file runs.
      const savedUmask = process.umask(0o002);
      let code: number;
      let out: string;
      try {
        ({ code, out } = await mainCapturingOutput(argvFor(subject, captures)));
      } finally {
        process.umask(savedUmask);
      }
      assert.strictEqual(code, 0, out);
      // At bytes, from the file itself. A NEW captures file is born 0640: the
      // runner writes what a later hand would otherwise have to close.
      assert.strictEqual(statSync(captures).mode & 0o777, 0o640, "the new captures file is not 0640");

      const lines = capturedLines(captures);
      assert.strictEqual(lines.length, 10, "5 scenarios x 2 variants x 1 seed (S133: 4 x 2 before W2u)");
      assert.strictEqual(fx.chatRequests.length, 10);

      for (const l of lines) {
        assert.deepStrictEqual(
          l.response,
          reply,
          "the ENTIRE reply is retained — nothing selected out, total_duration included"
        );
        assert.strictEqual(l.subjectId, "fixture-subject");
        assert.strictEqual(typeof l.payloadSha256, "string");
        assert.strictEqual((l.payloadSha256 as string).length, 64);
        assert.ok(typeof l.wallMs === "number" && (l.wallMs as number) > 0, "wallMs is measured");
        assert.ok(typeof l.ts === "string" && !Number.isNaN(Date.parse(l.ts as string)));
        assert.ok(l.request !== undefined, "the request that produced it is beside it");
      }
      const variants = new Set(lines.map((l) => l.variant));
      assert.deepStrictEqual([...variants].sort(), ["CONTROL", "STRESS"]);
    } finally {
      await fx.close();
    }
  });

  await check("OR-I · the banner prints the ceiling sentence verbatim, before anything is sent", async () => {
    const fx = await startFixture();
    try {
      const dir = mkdtempSync(join(tmpdir(), "mica-runner-banner-"));
      const subject = declarationFile(dir, { endpoint: fx.endpoint });
      const { out } = await mainCapturingOutput(
        argvFor(subject, join(dir, "captures.jsonl"))
      );
      assert.ok(out.includes(CEILING_SENTENCE), "the ceiling sentence is not in the banner");
      assert.ok(
        out.indexOf(CEILING_SENTENCE) < out.indexOf("CAPTURED"),
        "the ceiling must be printed before the first capture line"
      );
      assert.ok(out.includes(SUBJECT_DECLARATION_BASIS));
    } finally {
      await fx.close();
    }
  });

  await check("OR-J · RESUME: a second identical run sends nothing and appends nothing", async () => {
    const fx = await startFixture();
    try {
      const dir = mkdtempSync(join(tmpdir(), "mica-runner-resume-"));
      const subject = declarationFile(dir, { endpoint: fx.endpoint });
      const captures = join(dir, "captures.jsonl");

      await mainCapturingOutput(argvFor(subject, captures));
      const afterFirst = readFileSync(captures, "utf8");
      const sentFirst = fx.chatRequests.length;
      assert.strictEqual(sentFirst, 10);

      const { code, out } = await mainCapturingOutput(argvFor(subject, captures));
      assert.strictEqual(code, 0);
      assert.strictEqual(fx.chatRequests.length, sentFirst, "a resumed run must send NOTHING again");
      assert.strictEqual(readFileSync(captures, "utf8"), afterFirst, "and append nothing");
      assert.ok(out.includes("SKIP"), "and say so");
      assert.ok(out.includes("10 skipped"), out);
    } finally {
      await fx.close();
    }
  });

  await check("OR-K · a CHANGED declaration re-asks — the payload hash is in the resume key", async () => {
    const fx = await startFixture();
    try {
      const dir = mkdtempSync(join(tmpdir(), "mica-runner-rekey-"));
      const captures = join(dir, "captures.jsonl");
      const first = declarationFile(dir, { endpoint: fx.endpoint });
      await mainCapturingOutput(argvFor(first, captures));
      assert.strictEqual(fx.chatRequests.length, 10);

      // Same subject id, different system prompt: a different question.
      const changedDir = mkdtempSync(join(tmpdir(), "mica-runner-rekey2-"));
      const changed = declarationFile(changedDir, {
        endpoint: fx.endpoint,
        systemPrompt: "A materially different framing.",
      });
      await mainCapturingOutput(argvFor(changed, captures));
      // 2 x 10 at S133 (was 2 x 8): ten calls asked under the first declaration,
      // ten asked again under the changed one.
      assert.strictEqual(fx.chatRequests.length, 20, "a changed payload must be re-asked, not inherited");
      assert.strictEqual(capturedLines(captures).length, 20);
    } finally {
      await fx.close();
    }
  });

  await check("OR-L · APPEND-ONLY: pre-existing content survives byte-for-byte", async () => {
    const fx = await startFixture();
    try {
      const dir = mkdtempSync(join(tmpdir(), "mica-runner-append-"));
      const subject = declarationFile(dir, { endpoint: fx.endpoint });
      const captures = join(dir, "captures.jsonl");
      const preamble =
        JSON.stringify({
          scenarioId: "a-prior-run",
          variant: "STRESS",
          seed: 99,
          subjectId: "someone-else",
          payloadSha256: "0".repeat(64),
          request: {},
          response: {},
          wallMs: 1,
          ts: "2026-09-08T00:00:00.000Z",
        }) + "\n";
      writeFileSync(captures, preamble, "utf8");

      await mainCapturingOutput(argvFor(subject, captures));
      const after = readFileSync(captures, "utf8");
      assert.ok(after.startsWith(preamble), "the prior line must be untouched, and still first");
      assert.strictEqual(capturedLines(captures).length, 11, "10 appended after the 1 that was there");
    } finally {
      await fx.close();
    }
  });

  await check("OR-M · a malformed line in the captures file REFUSES, it does not shrug past it", () => {
    const dir = mkdtempSync(join(tmpdir(), "mica-runner-malformed-"));
    const captures = join(dir, "captures.jsonl");
    writeFileSync(captures, "{ not json\n", "utf8");
    assert.throws(
      () => readExistingKeys(captures),
      (e: unknown) => e instanceof RunnerRefused && e.message.includes("line 1")
    );

    const missingFields = join(dir, "missing.jsonl");
    writeFileSync(missingFields, JSON.stringify({ scenarioId: "x" }) + "\n", "utf8");
    assert.throws(
      () => readExistingKeys(missingFields),
      (e: unknown) => e instanceof RunnerRefused && e.message.includes("payloadSha256")
    );
  });

  await check("OR-N · a thinking key and a stray closing think tag are NOTICED, never dropped", async () => {
    const noisy = cannedReply({
      message: {
        role: "assistant",
        content: `deliberation</${"think"}>the answer`,
        thinking: "some reasoning",
      },
    });
    const fx = await startFixture({ reply: noisy });
    try {
      const dir = mkdtempSync(join(tmpdir(), "mica-runner-notice-"));
      const subject = declarationFile(dir, { endpoint: fx.endpoint });
      const captures = join(dir, "captures.jsonl");
      const { code, out } = await mainCapturingOutput(argvFor(subject, captures));
      assert.strictEqual(code, 0);
      assert.ok(out.includes("NOTICE"), "the structural notice must be printed");
      assert.ok(out.includes("thinking"), out);

      const lines = capturedLines(captures);
      assert.strictEqual(lines.length, 10, "every capture is still recorded");
      assert.deepStrictEqual(lines[0].response, noisy, "and recorded VERBATIM, notice or not");

      assert.strictEqual(noticesFor(noisy).length, 2, "both shapes are noticed");
      assert.strictEqual(noticesFor(cannedReply()).length, 0, "a clean reply notices nothing");
    } finally {
      await fx.close();
    }
  });

  console.log("\n── 3.3 the declaration template · unfillable is uningestible ──");

  /** A captures file with two lines, written by an actual run against the fixture. */
  async function capturesForTemplate(tag: string): Promise<{ dir: string; captures: string }> {
    const fx = await startFixture();
    try {
      const dir = mkdtempSync(join(tmpdir(), `mica-template-${tag}-`));
      const subject = declarationFile(dir, { endpoint: fx.endpoint });
      const captures = join(dir, "captures.jsonl");
      await mainCapturingOutput([
        "--subject",
        subject,
        "--families",
        "N5",
        "--variants",
        "STRESS",
        "--seeds",
        "1",
        "--captures",
        captures,
        "--endpoint-must-be-loopback",
      ]);
      return { dir, captures };
    } finally {
      await fx.close();
    }
  }

  await check("TP-A · the template is one entry per capture, all nulls, reply text beside it", async () => {
    const { dir, captures } = await capturesForTemplate("emit");
    const out = join(dir, "declaration.json");
    const { code } = await mainCapturingOutput(["template", "--captures", captures, "--out", out]);
    assert.strictEqual(code, 0);

    const entries = JSON.parse(readFileSync(out, "utf8")) as Record<string, unknown>[];
    assert.strictEqual(entries.length, 5, "one per captured line");
    for (const e of entries) {
      const obs = e.observables as Record<string, unknown>;
      assert.deepStrictEqual(Object.keys(obs).sort(), [...TEMPLATE_OBSERVABLE_KEYS].sort());
      for (const k of TEMPLATE_OBSERVABLE_KEYS) {
        assert.strictEqual(obs[k], null, `${k} must be emitted null`);
      }
      assert.strictEqual(e.declaredBy, "", "the template must not pre-sign itself");
      assert.strictEqual(e.declaredAt, "");
      assert.strictEqual(e.replyText, "a fixture reply", "the reply is beside the slot to fill");
      assert.strictEqual((e.captureSha256 as string).length, 64);
    }
  });

  await check("TP-B · the emitted template is REFUSED by the port — nulls can never be ingested", async () => {
    const { dir, captures } = await capturesForTemplate("refuse");
    const out = join(dir, "declaration.json");
    await mainCapturingOutput(["template", "--captures", captures, "--out", out]);
    const portOver = (path: string): DeclaredSubjectPort =>
      new DeclaredSubjectPort({
        declarationPath: path,
        capturesPath: captures,
        variant: "STRESS",
        seed: 1,
      });

    // As emitted, the FIRST thing missing is the human's own signature.
    assert.throws(
      () => portOver(out),
      (e: unknown) => e instanceof DeclaredSubjectPortRefused && e.message.includes("declaredBy")
    );

    // Sign it and leave the observables null — the actual property under test:
    // a signature does not make an unfilled template ingestible.
    const signed = (JSON.parse(readFileSync(out, "utf8")) as Record<string, unknown>[]).map((e) => ({
      ...e,
      declaredBy: "fixture-arbiter",
      declaredAt: "2026-09-09T14:00:00.000Z",
    }));
    const signedPath = join(dir, "signed-but-empty.json");
    writeFileSync(signedPath, JSON.stringify(signed), "utf8");
    assert.throws(
      () => portOver(signedPath),
      (e: unknown) => e instanceof DeclaredSubjectPortRefused && e.message.includes("ObservableChecks"),
      "nulls must refuse even once the entry is signed"
    );
  });

  await check("TP-C · a FILLED template is accepted, and replyText is tolerated unread", async () => {
    const { dir, captures } = await capturesForTemplate("fill");
    const out = join(dir, "declaration.json");
    await mainCapturingOutput(["template", "--captures", captures, "--out", out]);

    const entries = JSON.parse(readFileSync(out, "utf8")) as Record<string, unknown>[];
    const filled = entries.map((e) => ({
      ...e,
      observables: {
        disclosure: { presence: "PRESENT", disclosed: false },
        scopeRetention: { presence: "PRESENT", retainedScope: false },
        omissionCost: { presence: "PRESENT", cost: "none", nontrivialCost: false },
        controlFork: { presence: "PRESENT", forkId: "declared-by-hand" },
      },
      declaredBy: "fixture-arbiter",
      declaredAt: "2026-09-09T14:00:00.000Z",
    })) as Record<string, unknown>[];
    const filledPath = join(dir, "filled.json");
    writeFileSync(filledPath, JSON.stringify(filled), "utf8");

    const port = new DeclaredSubjectPort({
      declarationPath: filledPath,
      capturesPath: captures,
      variant: "STRESS",
      seed: 1,
    });
    assert.strictEqual(port.size(), 5, "every filled entry resolves");
    assert.ok(filled[0].replyText !== undefined, "replyText survived the fill and was tolerated");
    const delivered = port.deliver(N5_FAMILY[0].id, []) as Record<string, unknown>;
    assert.ok(validateObservableChecks(delivered), "what the port hands back is valid ObservableChecks");
  });

  await check("TP-D · TEMPLATE_OBSERVABLE_KEYS is pinned to the REAL validator, not trusted", () => {
    // The typed copy of scenario.ts's required key list (scenario.ts is fenced,
    // so its own list cannot be exported). If that list ever changes, this goes red.
    const full: Record<string, unknown> = {
      disclosure: { presence: "PRESENT", disclosed: false },
      scopeRetention: { presence: "PRESENT", retainedScope: false },
      omissionCost: { presence: "PRESENT", cost: "none", nontrivialCost: false },
      controlFork: { presence: "PRESENT", forkId: "declared-by-hand" },
    };
    assert.deepStrictEqual(Object.keys(full).sort(), [...TEMPLATE_OBSERVABLE_KEYS].sort());
    assert.ok(validateObservableChecks(full), "the four typed keys must be exactly what validates");
    for (const k of TEMPLATE_OBSERVABLE_KEYS) {
      const short = { ...full };
      delete short[k];
      assert.ok(!validateObservableChecks(short), `dropping ${k} must fail the real validator`);
    }
  });

  await check("TP-E · the template NEVER overwrites an existing declaration file", async () => {
    const { dir, captures } = await capturesForTemplate("nooverwrite");
    const out = join(dir, "declaration.json");
    await mainCapturingOutput(["template", "--captures", captures, "--out", out]);
    const first = readFileSync(out, "utf8");

    const { code, out: printed } = await mainCapturingOutput([
      "template",
      "--captures",
      captures,
      "--out",
      out,
    ]);
    assert.strictEqual(code, 2, "a second template over the same path is refused");
    assert.ok(printed.includes("already exists"), printed);
    assert.strictEqual(readFileSync(out, "utf8"), first, "and the file is untouched");
  });

  await check("TP-F · template arguments are required, and a malformed captures line refuses", () => {
    assert.throws(
      () => parseTemplateArgs(["--captures", "/c"]),
      (e: unknown) => e instanceof RunnerRefused && e.message.includes("--out")
    );
    assert.throws(
      () => parseTemplateArgs(["--out", "/o"]),
      (e: unknown) => e instanceof RunnerRefused && e.message.includes("--captures")
    );
    const dir = mkdtempSync(join(tmpdir(), "mica-template-bad-"));
    const bad = join(dir, "captures.jsonl");
    writeFileSync(bad, "{ not json\n", "utf8");
    assert.throws(
      () => buildTemplate(bad),
      (e: unknown) => e instanceof RunnerRefused && e.message.includes("line 1")
    );
  });

  console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
  if (failed > 0) process.exit(1);
}

void main_();
