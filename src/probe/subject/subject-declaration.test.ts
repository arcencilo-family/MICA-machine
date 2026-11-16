// ── MICA · subject declaration — acceptance tests (S119 pilot, deliverable 3.0) ─
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node src/probe/subject/subject-declaration.test.ts
//
// Every test that touches a disk makes its OWN directory with `mkdtempSync`.
// No test names a deployment path and no test types a model name — the model
// used below is an obvious fixture string, and the property "the runner does
// not hardcode a model" is proven BEHAVIOURALLY in ollama-runner.test.ts (the
// fixture server asserts the model it was actually sent), which is a stronger
// check than grepping this repo for a literal.

import assert from "assert";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  CEILING_SENTENCE,
  SUBJECT_DECLARATION_BASIS,
  SUBJECT_DECLARATION_KEYS,
  SubjectDeclarationRefused,
  isLoopbackEndpoint,
  loadSubjectDeclaration,
  parseSubjectDeclaration,
} from "./subject-declaration";

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

/** A complete, valid declaration. Every test below starts from a copy of this. */
function goodDeclaration(): Record<string, unknown> {
  return {
    subjectId: "fixture-subject",
    model: "fixture-model:0b",
    thinkFlag: false,
    options: { seed: 1, temperature: 0 },
    systemPrompt: "You are a fixture.",
    endpoint: "http://127.0.0.1:11434",
    basis: SUBJECT_DECLARATION_BASIS,
    declaredBy: "fixture-arbiter",
    declaredAt: "2026-09-09T12:00:00.000Z",
  };
}

function refusal(fn: () => unknown): SubjectDeclarationRefused {
  try {
    fn();
  } catch (err) {
    assert.ok(
      err instanceof SubjectDeclarationRefused,
      `expected SubjectDeclarationRefused, got ${String(err)}`
    );
    return err;
  }
  throw new assert.AssertionError({ message: "expected a refusal, got a value" });
}

console.log("\n── subject declaration · no defaults, no partial reads ───────");

check("SD-A · a complete declaration parses and carries every field through", () => {
  const d = parseSubjectDeclaration(goodDeclaration());
  assert.strictEqual(d.subjectId, "fixture-subject");
  assert.strictEqual(d.model, "fixture-model:0b");
  assert.strictEqual(d.thinkFlag, false);
  assert.deepStrictEqual(d.options, { seed: 1, temperature: 0 });
  assert.strictEqual(d.endpoint, "http://127.0.0.1:11434");
  assert.strictEqual(d.basis, SUBJECT_DECLARATION_BASIS);
  assert.strictEqual(d.declaredBy, "fixture-arbiter");
});

check("SD-B · EVERY required field, removed one at a time, is refused by name", () => {
  for (const key of SUBJECT_DECLARATION_KEYS) {
    const partial = goodDeclaration();
    delete partial[key];
    const err = refusal(() => parseSubjectDeclaration(partial));
    assert.ok(
      err.message.includes(key),
      `removing "${key}" produced a refusal that does not name it: ${err.message}`
    );
  }
});

check("SD-C · an EXTRA top-level key is refused, not ignored", () => {
  const extra = { ...goodDeclaration(), temperature: 0.7 };
  const err = refusal(() => parseSubjectDeclaration(extra));
  assert.ok(err.message.includes("temperature"), err.message);
});

check("SD-D · thinkFlag:true is REFUSED — a think-on run is a ruling, not a JSON edit", () => {
  const thinkOn = { ...goodDeclaration(), thinkFlag: true };
  const err = refusal(() => parseSubjectDeclaration(thinkOn));
  assert.ok(err.message.includes("thinkFlag"), err.message);
});

check("SD-E · a basis other than the declared one is refused", () => {
  const wrong = { ...goodDeclaration(), basis: "PROCESS_STATE_OBSERVED" };
  const err = refusal(() => parseSubjectDeclaration(wrong));
  assert.ok(err.message.includes("basis"), err.message);
});

check("SD-F · options must carry exactly seed and temperature", () => {
  const missing = { ...goodDeclaration(), options: { seed: 1 } };
  assert.ok(refusal(() => parseSubjectDeclaration(missing)).message.includes("options"));
  const extra = { ...goodDeclaration(), options: { seed: 1, temperature: 0, top_p: 0.9 } };
  assert.ok(refusal(() => parseSubjectDeclaration(extra)).message.includes("options"));
  const wrongType = { ...goodDeclaration(), options: { seed: "one", temperature: 0 } };
  assert.ok(refusal(() => parseSubjectDeclaration(wrongType)).message.includes("seed"));
});

check("SD-G · an unparseable declaredAt is refused", () => {
  const bad = { ...goodDeclaration(), declaredAt: "whenever" };
  assert.ok(refusal(() => parseSubjectDeclaration(bad)).message.includes("declaredAt"));
});

check("SD-H · an empty-string field is refused — present is not the same as populated", () => {
  const blank = { ...goodDeclaration(), systemPrompt: "   " };
  assert.ok(refusal(() => parseSubjectDeclaration(blank)).message.includes("systemPrompt"));
});

check("SD-J · a non-object, and an array, are both refused", () => {
  assert.ok(refusal(() => parseSubjectDeclaration(null)).message.includes("object"));
  assert.ok(refusal(() => parseSubjectDeclaration([])).message.includes("array"));
});

check("SD-K · load from disk: valid, unreadable, and malformed are three outcomes", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-subject-decl-"));
  const good = join(dir, "subject.json");
  writeFileSync(good, JSON.stringify(goodDeclaration()), "utf8");
  assert.strictEqual(loadSubjectDeclaration(good).subjectId, "fixture-subject");

  const err = refusal(() => loadSubjectDeclaration(join(dir, "absent.json")));
  assert.ok(err.message.includes("cannot read"), err.message);

  const malformed = join(dir, "malformed.json");
  writeFileSync(malformed, "{ not json", "utf8");
  assert.ok(refusal(() => loadSubjectDeclaration(malformed)).message.includes("not valid JSON"));
});

check("SD-L · isLoopbackEndpoint accepts the loopback block and nothing else", () => {
  for (const ok of [
    "http://127.0.0.1:11434",
    "http://localhost:11434",
    "http://127.1.2.3:11434",
    "http://[::1]:11434",
  ]) {
    assert.strictEqual(isLoopbackEndpoint(ok), true, `${ok} should be loopback`);
  }
  for (const notOk of [
    "http://192.168.1.10:11434",
    "http://example.com:11434",
    "http://0.0.0.0:11434",
    "http://127.0.0.1.example.com:11434",
    "not a url",
  ]) {
    assert.strictEqual(isLoopbackEndpoint(notOk), false, `${notOk} must not read as loopback`);
  }
});

check("SD-M · the ceiling sentence names the basis it commits every record to", () => {
  assert.ok(
    CEILING_SENTENCE.includes(SUBJECT_DECLARATION_BASIS),
    "the banner sentence must carry the basis verbatim — that is what makes it a ceiling"
  );
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
