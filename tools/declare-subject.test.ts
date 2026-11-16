// ── MICA · declare-subject — acceptance tests ────────────────────────────────
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node tools/declare-subject.test.ts
//
// Every test that touches a disk makes its OWN directory with `mkdtempSync`.
// No test names a deployment path, and no test reads a real declaration.
//
// ⚠ THE PILOT-2 FIXTURE BELOW IS PILOT-2-SHAPED, NOT PILOT 2'S BYTES, AND THE
//   DIFFERENCE IS LOAD-BEARING. The live declaration lives under
//   `mica-subject1:mica-readers` 0640 in a 2750 directory, and the build seat is
//   in neither. It could not be read from the seat that wrote this file and it
//   was NOT guessed at: the fixture carries the SHAPE (the nine keys, a
//   multi-line framing prompt, an arbiter-authored `declaredBy`) so the
//   transformation can be held end to end, and the real bytes are carried at
//   RUN TIME by `--from`, on the box, by the principal who can read them.
//
//   That is the whole design: the tool is what reads pilot 2, not this suite,
//   and not the seat that wrote it.
//
// THE MODEL NAME AND THE ENDPOINT ARE FIXTURE STRINGS EVERYWHERE HERE, and DS-9
// is why: the same source through two different `--model` values must produce
// two different outputs. A hardcoded model could not pass that, which is a
// behavioural proof and strictly stronger than grepping the repo for a literal.

import assert from "assert";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  assertCarried,
  buildNext,
  CARRIED_FIELDS,
  DeclareSubjectRefused,
  main,
  parseArgs,
  PROMPT_REPLACED_FIELD,
  readReplacementPrompt,
  run,
  sha256,
  type DeclareSubjectArgs,
} from "./declare-subject";
import {
  loadSubjectDeclaration,
  parseSubjectDeclaration,
  SUBJECT_DECLARATION_BASIS,
  SUBJECT_DECLARATION_KEYS,
  SubjectDeclarationRefused,
  type SubjectDeclaration,
} from "../src/probe/subject/subject-declaration";

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

/**
 * Pilot-2-SHAPED. See the header on why it is not pilot 2's bytes.
 *
 * The prompt is deliberately MULTI-LINE and carries trailing-whitespace-free
 * lines and a unicode character: the failure this tool prevents is a prompt
 * that survives a human's eye and not a byte comparison, so the fixture is the
 * kind of string that would.
 */
const PILOT2_PROMPT =
  "You are an agent operating under a written scope.\n" +
  "Answer from the situation as given — do not ask for more.\n" +
  "If something is outside the scope you were handed, say so plainly.";

const PILOT2_SHAPED = {
  subjectId: "fixture-subject1",
  model: "fixture-local:8b",
  thinkFlag: false,
  options: { seed: 1, temperature: 0 },
  systemPrompt: PILOT2_PROMPT,
  endpoint: "http://127.0.0.1:11434",
  basis: SUBJECT_DECLARATION_BASIS,
  declaredBy: "fixture-arbiter",
  declaredAt: "2026-09-12T12:54:32.000Z",
};

/** The S128 differences, as ruled — model and endpoint are fixture strings here. */
const NEXT_MODEL = "fixture-api-mini";
const NEXT_ENDPOINT = "http://127.0.0.1:11444";

function newDir(tag: string): string {
  return mkdtempSync(join(tmpdir(), `mica-declare-subject-${tag}-`));
}

function sourceFile(dir: string, overrides?: Record<string, unknown>): string {
  const p = join(dir, "from.json");
  writeFileSync(p, JSON.stringify({ ...PILOT2_SHAPED, ...overrides }, null, 2) + "\n", "utf8");
  return p;
}

function args(dir: string, over?: Partial<DeclareSubjectArgs>): DeclareSubjectArgs {
  return {
    from: over?.from ?? sourceFile(dir),
    out: over?.out ?? join(dir, "out.json"),
    model: over?.model ?? NEXT_MODEL,
    endpoint: over?.endpoint ?? NEXT_ENDPOINT,
    seed: over?.seed ?? 1,
    temperature: over?.temperature ?? 0,
    dryRun: over?.dryRun ?? false,
    ...(over?.systemPromptFile === undefined ? {} : { systemPromptFile: over.systemPromptFile }),
  };
}

/** A replacement-prompt file, written with the trailing newline an editor leaves. */
const SERIES2_PROMPT =
  "Line one of a different question.\n" + "Line two — with an em dash.";
function promptFile(dir: string, text: string = SERIES2_PROMPT, newline = true): string {
  const p = join(dir, "prompt.txt");
  writeFileSync(p, newline ? `${text}\n` : text, "utf8");
  return p;
}

const FIXED_CLOCK = new Date("2026-09-14T08:30:00.000Z");
const fixedNow = (): Date => FIXED_CLOCK;

function sink(): { readonly lines: string[]; readonly out: (s: string) => void } {
  const lines: string[] = [];
  return { lines, out: (s: string) => lines.push(s) };
}

function written(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

// ══════════════════════════════════════════════════════════════════════════════
async function main_(): Promise<void> {
  console.log("\n── declare-subject · carried, not retyped ─────────────────────");

  await check("DS-1 · the four carried fields are BYTE-IDENTICAL; the four ruled ones are as given", () => {
    const dir = newDir("ok");
    const a = args(dir);
    const s = sink();
    assert.strictEqual(run(a, s.out, fixedNow), 0);

    const made = written(a.out);
    assert.strictEqual(made.subjectId, PILOT2_SHAPED.subjectId);
    assert.strictEqual(made.systemPrompt, PILOT2_PROMPT, "the framing is the same WORDS");
    assert.strictEqual(made.basis, PILOT2_SHAPED.basis);
    assert.strictEqual(made.declaredBy, PILOT2_SHAPED.declaredBy);
    // and byte-for-byte against the source file, not only against the constant
    const from = written(a.from);
    for (const f of CARRIED_FIELDS) {
      assert.strictEqual(made[f], from[f], `${f} must arrive unchanged`);
    }

    assert.strictEqual(made.model, NEXT_MODEL);
    assert.strictEqual(made.endpoint, NEXT_ENDPOINT);
    assert.deepStrictEqual(made.options, { seed: 1, temperature: 0 });
    assert.strictEqual(made.thinkFlag, false);
  });

  await check("DS-2 · REGRESSION: the pilot-2 shape through the S128 differences, field by field", () => {
    const dir = newDir("regression");
    const a = args(dir);
    assert.strictEqual(run(a, sink().out, fixedNow), 0);
    const made = written(a.out);

    // The whole object, asserted at once. Anything this tool changed that it
    // was not told to change shows up here rather than in a later pilot.
    assert.deepStrictEqual(made, {
      subjectId: PILOT2_SHAPED.subjectId,
      model: NEXT_MODEL,
      thinkFlag: false,
      options: { seed: 1, temperature: 0 },
      systemPrompt: PILOT2_PROMPT,
      endpoint: NEXT_ENDPOINT,
      basis: SUBJECT_DECLARATION_BASIS,
      declaredBy: PILOT2_SHAPED.declaredBy,
      declaredAt: FIXED_CLOCK.toISOString(),
    });
    // Key ORDER too — two declarations must diff line by line.
    assert.deepStrictEqual(Object.keys(made), [...SUBJECT_DECLARATION_KEYS]);
  });

  await check("DS-3 · declaredAt is the WRITE-TIME clock, not the source's", () => {
    const dir = newDir("clock");
    const a = args(dir);
    assert.strictEqual(run(a, sink().out, fixedNow), 0);
    const made = written(a.out);
    assert.strictEqual(made.declaredAt, FIXED_CLOCK.toISOString());
    assert.notStrictEqual(made.declaredAt, PILOT2_SHAPED.declaredAt, "never inherited");
    assert.ok(!Number.isNaN(Date.parse(made.declaredAt as string)));

    // And the default clock really is a clock — two runs, two moments.
    const b = args(dir, { out: join(dir, "out2.json") });
    assert.strictEqual(run(b, sink().out), 0);
    const auto = written(b.out).declaredAt as string;
    assert.ok(Math.abs(Date.now() - Date.parse(auto)) < 60_000, `declaredAt was ${auto}`);
  });

  await check("DS-4 · POSITIVE CONTROL — the carry assertion actually fires", () => {
    // A check that has never been shown to fail is a check nobody has tested.
    const from = parseSubjectDeclaration(PILOT2_SHAPED);
    const tampered = parseSubjectDeclaration({
      ...PILOT2_SHAPED,
      systemPrompt: PILOT2_PROMPT + " ",
    });
    assert.throws(
      () => assertCarried(from, tampered),
      (e: unknown) => e instanceof DeclareSubjectRefused && e.message.includes("systemPrompt")
    );
    // one trailing space is the whole difference, and it is caught
    assert.notStrictEqual(sha256(tampered.systemPrompt), sha256(from.systemPrompt));

    // NOT built through the loader: `basis` has exactly one legal value, so a
    // tampered-basis declaration cannot be parsed into existence at all. The
    // cast is deliberate — `assertCarried` is a comparison and its job is to
    // catch a difference however it arrived, including one the loader would
    // never have produced.
    for (const field of CARRIED_FIELDS) {
      const other = { ...from, [field]: "something-else" } as SubjectDeclaration;
      assert.throws(
        () => assertCarried(from, other),
        (e: unknown) => e instanceof DeclareSubjectRefused && e.message.includes(field),
        `${field} must be caught`
      );
    }
  });

  await check("DS-5 · it NEVER writes over an existing declaration, and leaves it untouched", () => {
    const dir = newDir("nooverwrite");
    const a = args(dir);
    writeFileSync(a.out, "{\n  \"a run may be reading this\": true\n}\n", "utf8");
    const before = readFileSync(a.out, "utf8");
    assert.throws(
      () => run(a, sink().out, fixedNow),
      (e: unknown) => e instanceof DeclareSubjectRefused && e.message.includes("already exists")
    );
    assert.strictEqual(readFileSync(a.out, "utf8"), before, "byte-identical after the refusal");
  });

  await check("DS-6 · a source that does not validate REFUSES, and writes nothing", () => {
    const dir = newDir("badsource");
    for (const bad of [
      { thinkFlag: true },
      { basis: "SOMETHING_ELSE" },
      { options: { seed: 1 } },
      { systemPrompt: "" },
    ]) {
      const a = args(dir, {
        from: sourceFile(dir, bad),
        out: join(dir, `out-${Object.keys(bad)[0]}.json`),
      });
      assert.throws(
        () => run(a, sink().out, fixedNow),
        (e: unknown) => e instanceof SubjectDeclarationRefused,
        `${JSON.stringify(bad)} should refuse`
      );
      assert.ok(!existsSync(a.out), "nothing is written on a refusal");
    }
    // An EXTRA key is refused too — hasExactKeys, not a subset check.
    const a = args(dir, {
      from: sourceFile(dir, { temperature: 0.7 } as Record<string, unknown>),
      out: join(dir, "out-extra.json"),
    });
    assert.throws(() => run(a, sink().out, fixedNow), (e: unknown) => e instanceof SubjectDeclarationRefused);
    assert.ok(!existsSync(a.out));
  });

  await check("DS-7 · a non-loopback endpoint refuses HERE, not hours later at launch", () => {
    const dir = newDir("endpoint");
    for (const endpoint of ["http://api.example.com/v1", "http://10.0.0.5:11444", "not-a-url"]) {
      const a = args(dir, { endpoint, out: join(dir, `out-${endpoint.length}.json`) });
      assert.throws(
        () => run(a, sink().out, fixedNow),
        (e: unknown) => e instanceof DeclareSubjectRefused && e.message.includes("not loopback"),
        endpoint
      );
      assert.ok(!existsSync(a.out));
    }
    // and the loopback forms the runner accepts are accepted here
    const accepted = ["http://127.0.0.1:11444", "http://localhost:11444", "http://127.0.0.5:1"];
    accepted.forEach((endpoint, i) => {
      const a = args(dir, { endpoint, out: join(dir, `ok-${String(i)}.json`) });
      assert.strictEqual(run(a, sink().out, fixedNow), 0, endpoint);
      assert.strictEqual(written(a.out).endpoint, endpoint);
    });
  });

  await check("DS-8 · the output round-trips through the REAL loader", () => {
    const dir = newDir("roundtrip");
    const a = args(dir);
    assert.strictEqual(run(a, sink().out, fixedNow), 0);
    const reloaded = loadSubjectDeclaration(a.out);
    assert.strictEqual(reloaded.model, NEXT_MODEL);
    assert.strictEqual(reloaded.systemPrompt, PILOT2_PROMPT);
    assert.strictEqual(reloaded.endpoint, NEXT_ENDPOINT);
    // the file the runner will actually open, opened the way the runner opens it
    assert.deepStrictEqual(Object.keys(written(a.out)), [...SUBJECT_DECLARATION_KEYS]);
  });

  await check("DS-9 · NO MODEL AND NO ENDPOINT LITERAL — two runs, two different subjects", () => {
    const dir = newDir("noliteral");
    const from = sourceFile(dir);
    const one = args(dir, { from, out: join(dir, "one.json"), model: "fixture-alpha" });
    const two = args(dir, {
      from,
      out: join(dir, "two.json"),
      model: "fixture-beta",
      endpoint: "http://127.0.0.1:9999",
    });
    assert.strictEqual(run(one, sink().out, fixedNow), 0);
    assert.strictEqual(run(two, sink().out, fixedNow), 0);
    assert.strictEqual(written(one.out).model, "fixture-alpha");
    assert.strictEqual(written(two.out).model, "fixture-beta");
    assert.strictEqual(written(one.out).endpoint, NEXT_ENDPOINT);
    assert.strictEqual(written(two.out).endpoint, "http://127.0.0.1:9999");
    // the carried half is identical across both, which is the other half of the claim
    for (const f of CARRIED_FIELDS) {
      assert.strictEqual(written(one.out)[f], written(two.out)[f], f);
    }
  });

  await check("DS-10 · --dry-run prints the plan and writes NOTHING", () => {
    const dir = newDir("dry");
    const a = args(dir, { dryRun: true });
    const s = sink();
    assert.strictEqual(run(a, s.out, fixedNow), 0);
    assert.ok(!existsSync(a.out), "no file");
    const text = s.lines.join("\n");
    assert.ok(text.includes("NOTHING WAS WRITTEN"), text);
    assert.ok(text.includes(NEXT_MODEL), "the plan names the model it would write");
    assert.ok(text.includes(sha256(PILOT2_PROMPT)), "and the prompt's sha");
  });

  await check("DS-11 · the plan prints the prompt's SHA and never the prompt", () => {
    const dir = newDir("sha");
    const a = args(dir);
    const s = sink();
    assert.strictEqual(run(a, s.out, fixedNow), 0);
    const text = s.lines.join("\n");
    assert.ok(text.includes(sha256(PILOT2_PROMPT)), "the sha is printed");
    assert.ok(
      text.includes(`${String(Buffer.byteLength(PILOT2_PROMPT, "utf8"))} B`),
      "and the byte count"
    );
    // A prompt on the terminal is a prompt someone can copy, and copying is the
    // failure this tool exists to prevent.
    assert.ok(!text.includes(PILOT2_PROMPT), "the prompt itself is NOT printed");
    assert.ok(!text.includes("do not ask for more"), "not even one of its lines");
  });

  await check("DS-12 · the file is born 0640", () => {
    const dir = newDir("mode");
    const a = args(dir);
    assert.strictEqual(run(a, sink().out, fixedNow), 0);
    assert.strictEqual(
      statSync(a.out).mode & 0o777 & ~0o640,
      0,
      "0640 is a ceiling a umask may only narrow — never a bit wider"
    );
  });

  await check("DS-13 · every flag is required, and each refusal NAMES the flag", async () => {
    const full = [
      "--from", "/f", "--out", "/o", "--model", "m",
      "--endpoint", "http://127.0.0.1:1", "--seed", "1", "--temperature", "0",
    ];
    for (let i = 0; i < full.length; i += 2) {
      const flag = full[i];
      const partial = full.filter((_, j) => j !== i && j !== i + 1);
      assert.throws(
        () => parseArgs(partial),
        (e: unknown) => e instanceof DeclareSubjectRefused && e.message.includes(flag),
        `${flag} unset must refuse by name`
      );
    }
    assert.throws(
      () => parseArgs([...full.slice(0, 8), "--seed", "one", "--temperature", "0"]),
      (e: unknown) => e instanceof DeclareSubjectRefused && e.message.includes("not an integer")
    );
    assert.throws(
      () => parseArgs([...full.slice(0, 10), "--temperature", "warm"]),
      (e: unknown) => e instanceof DeclareSubjectRefused && e.message.includes("finite number")
    );
    assert.strictEqual(parseArgs(full).dryRun, false);
    assert.strictEqual(parseArgs([...full, "--dry-run"]).dryRun, true);
  });

  await check("DS-14 · main() returns 2 on every refusal and 0 on a write", async () => {
    const dir = newDir("main");
    const from = sourceFile(dir);
    const out = join(dir, "via-main.json");
    const base = [
      "--from", from, "--out", out, "--model", NEXT_MODEL,
      "--endpoint", NEXT_ENDPOINT, "--seed", "1", "--temperature", "0",
    ];
    const log = console.log;
    const err = console.error;
    console.log = (): void => undefined;
    console.error = (): void => undefined;
    try {
      assert.strictEqual(await main(base), 0);
      assert.strictEqual(await main(base), 2, "the second run meets its own output");
      assert.strictEqual(await main(base.slice(0, 4)), 2, "missing flags");
      assert.strictEqual(
        await main([...base.slice(0, 8), "--endpoint", "http://example.com", "--seed", "1", "--temperature", "0"]),
        2,
        "non-loopback"
      );
    } finally {
      console.log = log;
      console.error = err;
    }
    assert.ok(existsSync(out));
    assert.strictEqual(loadSubjectDeclaration(out).model, NEXT_MODEL);
  });

  await check("DS-15 · buildNext refuses to produce something the loader would reject", () => {
    // thinkFlag is not a flag and cannot be made one from here: the builder
    // writes the literal and the loader is the fence behind it.
    const from = parseSubjectDeclaration(PILOT2_SHAPED);
    const made = buildNext(
      from,
      { ...args(newDir("build")), model: "fixture-x", endpoint: "http://127.0.0.1:2" },
      fixedNow
    );
    assert.strictEqual(made.thinkFlag, false);
    // a non-finite temperature cannot reach disk — the round trip catches it
    assert.throws(
      () =>
        buildNext(
          from,
          { ...args(newDir("build2")), temperature: Number.NaN },
          fixedNow
        ),
      (e: unknown) => e instanceof SubjectDeclarationRefused
    );
  });

  // ══════════════════════════════════════════════════════════════════════════════
  console.log("\n── DS-S2 (S132) · --system-prompt-file: the series boundary ──");

await check("DS-S2a · the prompt is REPLACED, the other three still carried, and both shas printed", () => {
  const dir = newDir("s2a");
  const a = args(dir, { systemPromptFile: promptFile(dir) });
  const from = loadSubjectDeclaration(a.from);
  const made = buildNext(from, a, fixedNow);

  assert.strictEqual(made.systemPrompt, SERIES2_PROMPT, "the replacement is not the file's bytes");
  assert.notStrictEqual(made.systemPrompt, from.systemPrompt);
  // The other three are untouched, and `assertCarried` still enforces them.
  for (const f of CARRIED_FIELDS) {
    if (f === PROMPT_REPLACED_FIELD) continue;
    assert.strictEqual(made[f], from[f], `${f} stopped being carried`);
  }
  assertCarried(from, made, PROMPT_REPLACED_FIELD);

  const { lines, out } = sink();
  run(a, out, fixedNow);
  const text = lines.join("\n");
  assert.ok(text.includes("REPLACED — THIS IS A SERIES BOUNDARY"), text);
  assert.ok(text.includes(sha256(SERIES2_PROMPT)), "the new sha is not printed");
  assert.ok(text.includes(sha256(PILOT2_PROMPT)), "the old sha is not printed");
  // The carried list shrank to three and SAYS so.
  assert.ok(text.includes("CARRIED, byte-identical (subjectId, basis, declaredBy)"), text);
  // Never the text itself — the header's standing rule, unchanged by this flag.
  assert.ok(!text.includes(SERIES2_PROMPT), "the replacement prompt was splashed across the terminal");
});

await check("DS-S2b · ONE trailing newline is stripped, and only one", () => {
  const dir = newDir("s2b");
  assert.strictEqual(readReplacementPrompt(promptFile(dir)), SERIES2_PROMPT);
  // A file with NO trailing newline is taken whole.
  assert.strictEqual(readReplacementPrompt(promptFile(newDir("s2b2"), SERIES2_PROMPT, false)), SERIES2_PROMPT);
  // A file with TWO keeps the first: a real blank line is part of the prompt and
  // stripping "all trailing whitespace" would silently eat it.
  const two = promptFile(newDir("s2b3"), `${SERIES2_PROMPT}\n`);
  assert.strictEqual(readReplacementPrompt(two), `${SERIES2_PROMPT}\n`);
});

await check("DS-S2c · an ABSENT flag is byte-identical to every run before S132", () => {
  // THE REGRESSION THAT MATTERS MOST. Pilots 1-6 were produced by this tool
  // without the flag, and the flag must not have changed what that path does.
  const dir = newDir("s2c");
  const a = args(dir);
  const from = loadSubjectDeclaration(a.from);
  const made = buildNext(from, a, fixedNow);
  assert.strictEqual(made.systemPrompt, from.systemPrompt, "the carry path stopped carrying");
  assertCarried(from, made);
  const { lines, out } = sink();
  run(a, out, fixedNow);
  const text = lines.join("\n");
  assert.ok(text.includes(`CARRIED, byte-identical (${CARRIED_FIELDS.join(", ")})`), text);
  assert.ok(!text.includes("REPLACED"), "the carry path announced a series boundary");
});

await check("DS-S2d · REFUSALS — an identical prompt, an empty file, and an unreadable one", () => {
  const dir = newDir("s2d");
  // A no-op wearing a series boundary: the flag given, the bytes the same.
  const same = args(dir, { systemPromptFile: promptFile(dir, PILOT2_PROMPT) });
  const from = loadSubjectDeclaration(same.from);
  const made = buildNext(from, same, fixedNow);
  assert.throws(
    () => assertCarried(from, made, PROMPT_REPLACED_FIELD),
    (e: Error) => e instanceof DeclareSubjectRefused && /IDENTICAL to the source/.test(e.message)
  );
  // An empty frame asks nothing.
  assert.throws(
    () => readReplacementPrompt(promptFile(newDir("s2d2"), "   ")),
    (e: Error) => e instanceof DeclareSubjectRefused && /holds no prompt/.test(e.message)
  );
  // A path that is not there is a refusal, never a default.
  assert.throws(
    () => readReplacementPrompt(join(dir, "nothing-here.txt")),
    (e: Error) => e instanceof DeclareSubjectRefused && /could not be read/.test(e.message)
  );
});

await check("DS-S2e · the flag is a FILE — there is no --system-prompt string form", () => {
  // The header's reason, asserted: a multi-line prompt through a shell is the
  // transcription failure this tool exists to prevent, so the string form must
  // not exist. `parseArgs` refuses an unknown flag by taking it as a value-less
  // argument, and the source names no such option.
  const source = readFileSync(join(__dirname, "declare-subject.ts"), "utf8");
  assert.ok(!source.includes('"--system-prompt"'), "a string-form prompt flag exists");
  const dir = newDir("s2e");
  const parsed = parseArgs([
    "--from", sourceFile(dir), "--out", join(dir, "o.json"),
    "--model", NEXT_MODEL, "--endpoint", NEXT_ENDPOINT,
    "--seed", "1", "--temperature", "0",
    "--system-prompt-file", promptFile(dir),
  ]);
  assert.strictEqual(parsed.systemPromptFile, join(dir, "prompt.txt"));
  // And absent means absent, not empty-string.
  const plain = parseArgs([
    "--from", sourceFile(dir), "--out", join(dir, "o.json"),
    "--model", NEXT_MODEL, "--endpoint", NEXT_ENDPOINT,
    "--seed", "1", "--temperature", "0",
  ]);
  assert.strictEqual(plain.systemPromptFile, undefined);
  });

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
  if (failed > 0) process.exit(1);
}

void main_();
