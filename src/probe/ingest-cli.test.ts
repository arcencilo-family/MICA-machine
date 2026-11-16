// ── MICA · the ingestion driver — acceptance tests (S121, brief §3.2) ────────
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node src/probe/ingest-cli.test.ts
//
// Every test that touches a disk makes its OWN directory with `mkdtempSync`. No
// test names a deployment path, no test pins a literal 64-hex digest (every sha
// here is computed from the bytes the test itself just wrote), and no live
// subject exists anywhere in this file: the captures these readings bind
// against are written by the fixture.

import assert from "assert";
import { createHash } from "crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { EvidenceLogStore } from "./evidence-store";
import type { AttemptRecord, OutcomeRecord } from "./evidence-log";
import { N5_FAMILY } from "./families/n5";
import { composeLogPath, INGEST_CLI_EXIT, main } from "./ingest-cli";
import type { ObservableChecks } from "./scenario";
import { captureLineSha256 } from "./subject/declared-subject-port";
import { SUBJECT_DECLARATION_BASIS } from "./subject/subject-declaration";
import { VARIANTS } from "./subject/variant";

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

const SUBJECT_ID = "fixture-subject";
const RUN_ID = "fixturerun-n5";
const SCENARIOS = N5_FAMILY.map((s) => s.id);
const SEEDS = [1, 2, 3];
const READINGS = SCENARIOS.length * VARIANTS.length * SEEDS.length;

function goodObservables(): ObservableChecks {
  return {
    disclosure: { presence: "PRESENT", disclosed: false },
    scopeRetention: { presence: "PRESENT", retainedScope: false },
    omissionCost: { presence: "PRESENT", cost: "none recorded", nontrivialCost: false },
    controlFork: { presence: "PRESENT", forkId: "declared-by-hand" },
  };
}

interface Bed {
  readonly dir: string;
  readonly logDir: string;
  readonly declarationPath: string;
  readonly declarationSha: string;
  readonly capturesPath: string;
  readonly subjectPath: string;
  readonly logPath: string;
}

/**
 * The whole pilot in miniature: 24 captures, 24 declarations bound to them by
 * sha, one subject declaration, and an EXISTING (empty) evidence directory —
 * because the store refuses an absent one and that refusal is not what these
 * checks are about.
 */
function bed(tag: string): Bed {
  const dir = mkdtempSync(join(tmpdir(), `mica-ingest-${tag}-`));
  // The evidence DIRECTORY exists and the log FILE does not — the store refuses
  // an absent directory, and whether it creates an absent file inside a present
  // one is exactly what IG-B1 answers.
  const logDir = join(dir, "probe-evidence");
  mkdirSync(logDir);

  const capturesPath = join(dir, "captures.jsonl");
  const declarationPath = join(dir, "declaration.json");
  const subjectPath = join(dir, "subject-declaration.json");

  const lines: string[] = [];
  const entries: Record<string, unknown>[] = [];
  for (const scenarioId of SCENARIOS) {
    for (const variant of VARIANTS) {
      for (const seed of SEEDS) {
        const line = JSON.stringify({
          scenarioId,
          variant,
          seed,
          subjectId: SUBJECT_ID,
          payloadSha256: createHash("sha256").update(`${scenarioId}|${variant}|${String(seed)}`).digest("hex"),
          request: {},
          response: { message: { role: "assistant", content: `fixture reply ${scenarioId} ${variant}` } },
          wallMs: 12,
          ts: "2026-09-09T12:00:00.000Z",
        });
        lines.push(line);
        entries.push({
          scenarioId,
          variant,
          seed,
          captureSha256: captureLineSha256(line),
          observables: goodObservables(),
          declaredBy: "fixture-arbiter",
          declaredAt: "2026-09-09T13:00:00.000Z",
        });
      }
    }
  }
  writeFileSync(capturesPath, lines.join("\n") + "\n", "utf8");
  writeFileSync(declarationPath, JSON.stringify(entries), "utf8");
  writeFileSync(
    subjectPath,
    JSON.stringify({
      subjectId: SUBJECT_ID,
      model: "fixture-model:0b",
      thinkFlag: false,
      options: { seed: 1, temperature: 0 },
      systemPrompt: "You are a fixture.",
      endpoint: "http://127.0.0.1:11434",
      basis: SUBJECT_DECLARATION_BASIS,
      declaredBy: "fixture-arbiter",
      declaredAt: "2026-09-09T13:00:00.000Z",
    }),
    "utf8"
  );
  return {
    dir,
    logDir,
    declarationPath,
    declarationSha: createHash("sha256").update(readFileSync(declarationPath)).digest("hex"),
    capturesPath,
    subjectPath,
    logPath: composeLogPath(logDir, SUBJECT_ID, RUN_ID),
  };
}

function args(b: Bed, overrides: Record<string, string | null> = {}, extra: readonly string[] = []): string[] {
  const base: Record<string, string | null> = {
    declaration: b.declarationPath,
    "declaration-sha256": b.declarationSha,
    captures: b.capturesPath,
    "subject-declaration": b.subjectPath,
    "log-dir": b.logDir,
    "run-id": RUN_ID,
    scenarios: SCENARIOS.join(","),
    variants: VARIANTS.join(","),
    seeds: SEEDS.join(","),
    at: "1700000000000",
    ...overrides,
  };
  const out: string[] = [];
  for (const [key, value] of Object.entries(base)) {
    if (value === null) continue;
    out.push(`--${key}`, value);
  }
  return [...out, ...extra];
}

function run(argv: readonly string[]): { status: number; out: string; err: string } {
  const lines: string[] = [];
  const errs: string[] = [];
  const error = console.error;
  console.error = (...a: unknown[]) => { errs.push(a.map(String).join(" ")); };
  try {
    const status = main(argv, (s) => { lines.push(s); });
    return { status, out: lines.join("\n"), err: errs.join("\n") };
  } finally {
    console.error = error;
  }
}

function recordsOf(path: string): ReturnType<EvidenceLogStore["records"]> {
  return new EvidenceLogStore({ path }).records();
}

console.log("── IG-A · the sha gate, before any port ──");

check("IG-A1 · a declaration whose bytes do not hash to --declaration-sha256 is REFUSED", () => {
  const b = bed("sha");
  // A sha that is the RIGHT SHAPE and the WRONG VALUE: the digest of different
  // bytes, computed here rather than typed, so this file pins no literal.
  const wrong = createHash("sha256").update("not the declaration").digest("hex");
  const r = run(args(b, { "declaration-sha256": wrong }));
  assert.strictEqual(r.status, INGEST_CLI_EXIT.REFUSED);
  assert.ok(r.err.includes(wrong), "the message names the sha that was demanded");
  assert.ok(r.err.includes(b.declarationSha), "the message names the sha that was read");
  assert.ok(!existsSync(b.logPath), "no log file came into existence");
});

check("IG-A2 · the sha is checked BEFORE a port is constructed — proved by which refusal comes back", () => {
  // The captures file is destroyed, so CONSTRUCTING a port over this
  // declaration cannot succeed: every entry names a captureSha256 that is no
  // longer any line in it. If the driver built a port first, THAT is the
  // refusal we would read. We read the sha refusal instead, which is the only
  // way this assertion can pass.
  const b = bed("order");
  writeFileSync(b.capturesPath, "", "utf8");
  const wrong = createHash("sha256").update("not the declaration").digest("hex");
  const r = run(args(b, { "declaration-sha256": wrong }));
  assert.strictEqual(r.status, INGEST_CLI_EXIT.REFUSED);
  assert.ok(r.err.includes("expected sha256"), `expected the sha refusal, got: ${r.err}`);
  assert.ok(!r.err.includes("is not any line in"), "a port was constructed before the sha was checked");
  assert.strictEqual(recordsOf(b.logPath).length, 0, "nothing was appended");
});

check("IG-A3 · a declaration that does not cover all 24 readings is refused BEFORE the first append", () => {
  // A half-ingested chain cannot be told from a complete one without counting,
  // so the gap is found while the log is still exactly as we found it. Seed 3
  // is dropped from the declaration; the port for that slice constructs
  // happily and simply holds nothing.
  const b = bed("partial");
  const entries = (JSON.parse(readFileSync(b.declarationPath, "utf8")) as { seed: number }[])
    .filter((e) => e.seed !== 3);
  writeFileSync(b.declarationPath, JSON.stringify(entries), "utf8");
  const sha = createHash("sha256").update(readFileSync(b.declarationPath)).digest("hex");

  const r = run(args(b, { "declaration-sha256": sha }, ["--write"]));
  assert.strictEqual(r.status, INGEST_CLI_EXIT.REFUSED, `${r.out}\n${r.err}`);
  assert.ok(r.err.includes("nothing has been appended"), r.err);
  assert.strictEqual(recordsOf(b.logPath).length, 0, "a prefix was appended before the refusal");
  assert.ok(!existsSync(b.logPath), "no log file came into existence");
});

console.log("\n── IG-B · the write — 24 readings, every one with provenance ──");

check("IG-B1 · a byte-identical declaration writes 24 RECORDED with provenance and readings", () => {
  const b = bed("write");
  const r = run(args(b, {}, ["--write"]));
  assert.strictEqual(r.status, INGEST_CLI_EXIT.OK, `${r.out}\n${r.err}`);
  assert.ok(r.out.includes(`{"RECORDED":${String(READINGS)}}`), `count-by-state line missing: ${r.out}`);

  const records = recordsOf(b.logPath);
  assert.strictEqual(records.length, READINGS * 2, "one ATTEMPT and one OUTCOME per reading");

  const attempts = records.filter((x): x is AttemptRecord => x.kind === "ATTEMPT");
  assert.strictEqual(attempts.length, READINGS);
  for (const a of attempts) {
    assert.ok(a.provenance !== undefined, `${a.scenarioId} carries no provenance`);
    assert.strictEqual(a.provenance.subjectId, SUBJECT_ID);
    assert.strictEqual(a.provenance.basis, SUBJECT_DECLARATION_BASIS);
    assert.ok((VARIANTS as readonly string[]).includes(a.provenance.variant));
    assert.ok(SEEDS.includes(a.provenance.seed));
  }
  // Every slice exactly once — the 24 are the declared 24, not 24 of anything.
  const slices = attempts.map((a) => `${a.scenarioId}|${a.provenance!.variant}|${String(a.provenance!.seed)}`);
  assert.strictEqual(new Set(slices).size, READINGS);

  const outcomes = records.filter((x): x is OutcomeRecord => x.kind === "OUTCOME");
  assert.strictEqual(outcomes.length, READINGS);
  for (const o of outcomes) {
    assert.strictEqual(o.outcome, "CAPTURED");
    assert.ok(o.declaredBy !== undefined, "a CAPTURED outcome carries the reading it came from");
    assert.strictEqual(o.declaredBy, "fixture-arbiter");
    assert.ok(o.captureSha256 !== undefined, "a CAPTURED outcome names the capture it is bound to");
    assert.match(o.captureSha256, /^[0-9a-f]{64}$/);
  }
  assert.deepStrictEqual(new EvidenceLogStore({ path: b.logPath }).verify(), { valid: true, brokenAt: null });
  // The last line is the inversion of the S120 rehearsal's: `false` = no
  // ATTEMPT lacks provenance.
  assert.strictEqual(r.out.trimEnd().split("\n").pop(), "false");
});

check("IG-B2 · the recorded basis is the one the SUBJECT DECLARATION carries, not the name of a constant", () => {
  // S121 DEVIATION, pinned here so it cannot be undone silently. The brief's
  // §2.4 asks for `basis: "SUBJECT_DECLARATION_BASIS"` — but that is the
  // IDENTIFIER of `subject-declaration.ts`'s exported constant, whose VALUE is
  // "TRANSCRIPT_DECLARED_BY_HUMAN". Writing the identifier into the chain would
  // record the name of a variable as the basis of a human's reading. The driver
  // READS `basis` out of the subject declaration, exactly as the brief already
  // requires for `subjectId`, and this check is the difference stated.
  const b = bed("basis");
  assert.strictEqual(run(args(b, {}, ["--write"])).status, INGEST_CLI_EXIT.OK);
  const declared = JSON.parse(readFileSync(b.subjectPath, "utf8")) as { basis: string };
  const attempts = recordsOf(b.logPath).filter((x): x is AttemptRecord => x.kind === "ATTEMPT");
  for (const a of attempts) {
    assert.strictEqual(a.provenance?.basis, declared.basis);
    assert.notStrictEqual(a.provenance?.basis, "SUBJECT_DECLARATION_BASIS");
  }
});

console.log("\n── IG-C · the dry run writes nothing ──");

check("IG-C1 · --dry (the default) plans all 24 and leaves the log's bytes exactly as they were", () => {
  const b = bed("dry");
  // Write first, so there ARE bytes for a dry run to fail to change. A dry run
  // against an absent file could pass this check by doing nothing at all.
  assert.strictEqual(run(args(b, {}, ["--write"])).status, INGEST_CLI_EXIT.OK);
  const before = statSync(b.logPath).size;
  const beforeBytes = readFileSync(b.logPath);

  const dry = run(args(b));
  assert.strictEqual(dry.status, INGEST_CLI_EXIT.OK, `${dry.out}\n${dry.err}`);
  assert.strictEqual(statSync(b.logPath).size, before, "a dry run changed the log's size");
  assert.ok(beforeBytes.equals(readFileSync(b.logPath)), "a dry run changed the log's bytes");
  assert.strictEqual((dry.out.match(/^PLAN /gm) ?? []).length, READINGS, "one plan line per reading");
  assert.ok(dry.out.includes("DRY — nothing will be written"));
  // The default IS dry: the same argv with neither flag was just run.
  assert.ok(!dry.out.includes("WRITE — records will be appended"));
});

check("IG-C2 · --dry against a FRESH directory leaves the log ABSENT, not zero-length", () => {
  // S122 §2.3. IG-C1 above writes first, so the file it watches for a byte
  // change necessarily EXISTS — which means IG-C1 cannot answer "does a dry run
  // CREATE anything?". It never could, and the S122 brief asked one test to
  // hold both clauses. It cannot, so the second clause is a second test and
  // IG-C1 is untouched. This is the one that would catch a pre-create escaping
  // its `o.write` guard.
  const b = bed("dryfresh");
  assert.ok(!existsSync(b.logPath), "the bed starts with the log absent");
  const dry = run(args(b));
  assert.strictEqual(dry.status, INGEST_CLI_EXIT.OK, `${dry.out}\n${dry.err}`);
  assert.ok(!existsSync(b.logPath), "a dry run CREATED the evidence log");
});

console.log("\n── IG-M · the mode the evidence file is born with ──");

check("IG-M1 · a --write into an empty directory creates the log at 0640, under umask 002", () => {
  // S122 §2.3. THE UMASK IS SET EXPLICITLY, not inherited: the whole point is
  // that the old code's 0666-default open came back 664 under THIS deployment's
  // umask, so a test that ran under 022 would go green on a box where the
  // defect does not show and stay silent on the box where it does. 002 is the
  // hostile case, named here rather than assumed.
  const saved = process.umask(0o002);
  try {
    const b = bed("mode");
    assert.ok(!existsSync(b.logPath), "the bed starts with the log absent");
    assert.strictEqual(run(args(b, {}, ["--write"])).status, INGEST_CLI_EXIT.OK);
    // At bytes, from the file itself — not from what the driver printed.
    assert.strictEqual(statSync(b.logPath).mode & 0o777, 0o640, "the new evidence log is not 0640");
    // And it is a real chain, not an empty file the mode was checked on: the
    // pre-create must not have cost the run its records.
    assert.strictEqual(recordsOf(b.logPath).length, READINGS * 2);
  } finally {
    process.umask(saved);
  }
});

check("IG-M2 · an EXISTING log keeps its own mode — the driver chmods nothing it did not create", () => {
  // The other half, and the one that matters on the box: the first live chain
  // was closed to 640 by the arbiter's hand. A driver that re-asserted a mode
  // on every run would be a deployment act performed by a build artifact. A
  // deliberately WIDE existing file is left wide, and the log's mode stays the
  // property of whoever created it.
  const saved = process.umask(0o002);
  try {
    const b = bed("existingmode");
    assert.strictEqual(run(args(b, {}, ["--write"])).status, INGEST_CLI_EXIT.OK);
    chmodSync(b.logPath, 0o666);
    // A second run-id, so this appends to the SAME file rather than forking.
    assert.strictEqual(run(args(b, {}, ["--write"])).status, INGEST_CLI_EXIT.OK);
    assert.strictEqual(statSync(b.logPath).mode & 0o777, 0o666, "the driver changed an existing file's mode");
  } finally {
    process.umask(saved);
  }
});

console.log("\n── IG-D · nothing is defaulted ──");

check("IG-D1 · a missing --log-dir is refused by NAME, and no path is invented", () => {
  const b = bed("nologdir");
  const r = run(args(b, { "log-dir": null }, ["--write"]));
  assert.strictEqual(r.status, INGEST_CLI_EXIT.USAGE);
  assert.ok(r.err.includes("--log-dir"), `the refusal names the argument: ${r.err}`);
  assert.ok(r.err.includes("no default"), `the refusal says it has no default: ${r.err}`);
  assert.ok(!existsSync(b.logPath));
});

check("IG-D2 · a missing --run-id is refused by NAME", () => {
  const b = bed("norunid");
  const r = run(args(b, { "run-id": null }, ["--write"]));
  assert.strictEqual(r.status, INGEST_CLI_EXIT.USAGE);
  assert.ok(r.err.includes("--run-id"), `the refusal names the argument: ${r.err}`);
  assert.ok(!existsSync(b.logPath));
});

check("IG-D3 · a --run-id that would compose a path elsewhere is refused", () => {
  const b = bed("badrunid");
  for (const bad of ["../escape", "with/slash", ".hidden"]) {
    const r = run(args(b, { "run-id": bad }, ["--write"]));
    assert.strictEqual(r.status, INGEST_CLI_EXIT.USAGE, `--run-id ${bad} was accepted`);
    assert.ok(r.err.includes("--run-id"));
  }
});

console.log("\n── IG-E · the log's name is composed from what was READ ──");

check("IG-E1 · the composed path is <dir>/evidence_<subjectId>_<runId>.jsonl, exactly", () => {
  const b = bed("compose");
  const expected = join(b.logDir, `evidence_${SUBJECT_ID}_${RUN_ID}.jsonl`);
  assert.strictEqual(composeLogPath(b.logDir, SUBJECT_ID, RUN_ID), expected);

  const dry = run(args(b));
  assert.strictEqual(dry.status, INGEST_CLI_EXIT.OK, `${dry.out}\n${dry.err}`);
  assert.ok(dry.out.includes(expected), `the dry run prints the composed path: ${dry.out}`);

  assert.strictEqual(run(args(b, {}, ["--write"])).status, INGEST_CLI_EXIT.OK);
  assert.ok(existsSync(expected), "the run appended to the composed path and nowhere else");
});

check("IG-E2 · the subjectId in the file name is the one READ, never one the operator typed", () => {
  // There is no --subject-id argument to type. Change the declaration's own
  // subjectId and the file name follows it, with every other argument fixed.
  const b = bed("readsubject");
  const declaration = JSON.parse(readFileSync(b.subjectPath, "utf8")) as Record<string, unknown>;
  declaration.subjectId = "a-different-subject";
  writeFileSync(b.subjectPath, JSON.stringify(declaration), "utf8");

  const r = run(args(b, {}, ["--write"]));
  assert.strictEqual(r.status, INGEST_CLI_EXIT.OK, `${r.out}\n${r.err}`);
  assert.ok(existsSync(join(b.logDir, `evidence_a-different-subject_${RUN_ID}.jsonl`)));
  assert.ok(!existsSync(b.logPath), "the old subject's file was not the one written");
});

check("IG-E3 · a second run-id is a NEW chain, never an append onto the old one", () => {
  const b = bed("rerun");
  assert.strictEqual(run(args(b, {}, ["--write"])).status, INGEST_CLI_EXIT.OK);
  const firstBytes = readFileSync(b.logPath);

  const second = composeLogPath(b.logDir, SUBJECT_ID, "fixturerun-n5b");
  assert.strictEqual(run(args(b, { "run-id": "fixturerun-n5b" }, ["--write"])).status, INGEST_CLI_EXIT.OK);
  assert.ok(firstBytes.equals(readFileSync(b.logPath)), "the first run's chain was touched");
  assert.strictEqual(recordsOf(second).length, READINGS * 2);
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
