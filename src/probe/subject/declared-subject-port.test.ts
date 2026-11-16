// ── MICA · the declared subject port — acceptance tests (S119, deliverable 3.2) ─
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node src/probe/subject/declared-subject-port.test.ts
//
// Every test that touches a disk makes its OWN directory with `mkdtempSync`.
// No test names a deployment path. No live subject and no model anywhere: the
// captures these tests bind against are written by the test itself.

import assert from "assert";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { deliverAndRecord } from "../delivery";
import { EvidenceLogStore } from "../evidence-store";
import { N5_FAMILY } from "../families/n5";
import type { ObservableChecks } from "../scenario";
import {
  captureLineSha256,
  DeclaredSubjectPort,
  DeclaredSubjectPortRefused,
  parseObservableDeclaration,
} from "./declared-subject-port";

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

const SCENARIO = N5_FAMILY[0];

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
  readonly capturesPath: string;
  readonly declarationPath: string;
  /** sha of the one capture line written for (SCENARIO, STRESS, 1). */
  readonly sha: string;
  readonly writeDeclaration: (entries: unknown[]) => void;
}

/** A captures file with one line, plus a place to put a declaration file. */
function bed(tag: string, capture?: Record<string, unknown>): Bed {
  const dir = mkdtempSync(join(tmpdir(), `mica-declport-${tag}-`));
  const capturesPath = join(dir, "captures.jsonl");
  const declarationPath = join(dir, "declaration.json");
  const line = JSON.stringify(
    capture ?? {
      scenarioId: SCENARIO.id,
      variant: "STRESS",
      seed: 1,
      subjectId: "fixture-subject",
      payloadSha256: "a".repeat(64),
      request: {},
      response: { message: { role: "assistant", content: "a fixture reply" } },
      wallMs: 12,
      ts: "2026-09-09T12:00:00.000Z",
    }
  );
  writeFileSync(capturesPath, line + "\n", "utf8");
  return {
    dir,
    capturesPath,
    declarationPath,
    sha: captureLineSha256(line),
    writeDeclaration: (entries) => {
      writeFileSync(declarationPath, JSON.stringify(entries), "utf8");
    },
  };
}

function goodEntry(b: Bed, overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    scenarioId: SCENARIO.id,
    variant: "STRESS",
    seed: 1,
    captureSha256: b.sha,
    observables: goodObservables(),
    declaredBy: "mica-arbiter",
    declaredAt: "2026-09-09T13:00:00.000Z",
    ...overrides,
  };
}

function portFor(b: Bed, variant: "STRESS" | "CONTROL" = "STRESS", seed = 1): DeclaredSubjectPort {
  return new DeclaredSubjectPort({
    declarationPath: b.declarationPath,
    capturesPath: b.capturesPath,
    variant,
    seed,
  });
}

function refusal(fn: () => unknown): DeclaredSubjectPortRefused {
  try {
    fn();
  } catch (err) {
    assert.ok(
      err instanceof DeclaredSubjectPortRefused,
      `expected DeclaredSubjectPortRefused, got ${String(err)}`
    );
    return err;
  }
  throw new assert.AssertionError({ message: "expected a refusal, got a value" });
}

console.log("\n── declared subject port · carries a reading, grades nothing ──");

check("DP-A · a bound declaration resolves, and deliver returns it unchanged", () => {
  const b = bed("ok");
  b.writeDeclaration([goodEntry(b)]);
  const port = portFor(b);
  assert.strictEqual(port.size(), 1);
  assert.deepStrictEqual(port.deliver(SCENARIO.id, SCENARIO.stressor.steps), goodObservables());
});

check("DP-B · a scenario with NO declaration throws — no default, no CANNOT_ASSESS", () => {
  const b = bed("missing");
  b.writeDeclaration([goodEntry(b)]);
  const port = portFor(b);
  const err = refusal(() => port.deliver("n5-some-other-scenario", []));
  assert.ok(err.message.includes("n5-some-other-scenario"), err.message);
  assert.ok(err.message.includes("CANNOT_ASSESS"), "the refusal must say whose word that is");
});

check("DP-C · a captureSha256 that names NO line in the captures file is refused", () => {
  const b = bed("nosha");
  b.writeDeclaration([goodEntry(b, { captureSha256: "b".repeat(64) })]);
  const err = refusal(() => portFor(b));
  assert.ok(err.message.includes("not any line"), err.message);
});

check("DP-D · a sha bound to a DIFFERENT call is refused — the binding is checked, not assumed", () => {
  const b = bed("wrongbind");
  // The capture on disk is (SCENARIO, STRESS, 1); the entry claims seed 2.
  b.writeDeclaration([goodEntry(b, { seed: 2 })]);
  const err = refusal(() => portFor(b, "STRESS", 2));
  assert.ok(err.message.includes("claims to grade"), err.message);
});

check("DP-E · NEGATIVE CONTROL: prose where the observables belong is refused", () => {
  const b = bed("prose");
  b.writeDeclaration([
    goodEntry(b, {
      observables: "The actor declared completion but supplied no artifact, so I judge it a defection.",
    }),
  ]);
  const err = refusal(() => portFor(b));
  assert.ok(err.message.includes("ObservableChecks"), err.message);
});

check("DP-F · an UNFILLED TEMPLATE (nulls) can never be ingested", () => {
  const b = bed("nulls");
  b.writeDeclaration([
    goodEntry(b, {
      observables: {
        disclosure: null,
        scopeRetention: null,
        omissionCost: null,
        controlFork: null,
      },
    }),
  ]);
  assert.ok(refusal(() => portFor(b)).message.includes("ObservableChecks"));
});

check("DP-G · shape refusals: wrong key set, bad variant, bad sha, unparseable timestamp", () => {
  const b = bed("shape");
  const missing = goodEntry(b);
  delete missing.declaredBy;
  assert.ok(refusal(() => parseObservableDeclaration(missing, "e")).message.includes("declaredBy"));

  assert.ok(
    refusal(() => parseObservableDeclaration({ ...goodEntry(b), extra: 1 }, "e")).message.includes("extra")
  );
  assert.ok(
    refusal(() => parseObservableDeclaration(goodEntry(b, { variant: "SIDEWAYS" }), "e")).message.includes(
      "variant"
    )
  );
  assert.ok(
    refusal(() => parseObservableDeclaration(goodEntry(b, { captureSha256: "short" }), "e")).message.includes(
      "captureSha256"
    )
  );
  assert.ok(
    refusal(() => parseObservableDeclaration(goodEntry(b, { declaredAt: "whenever" }), "e")).message.includes(
      "declaredAt"
    )
  );
});

check("DP-H · the port answers only for the (variant, seed) it was constructed for", () => {
  const b = bed("slice");
  b.writeDeclaration([goodEntry(b)]);
  const wrongSlice = portFor(b, "CONTROL", 1);
  assert.strictEqual(wrongSlice.size(), 0, "a CONTROL port must not hold a STRESS reading");
  refusal(() => wrongSlice.deliver(SCENARIO.id, []));
});

check("DP-J · two declarations for one slice are refused — the port picks no winner", () => {
  const b = bed("dupe");
  b.writeDeclaration([goodEntry(b), goodEntry(b)]);
  assert.ok(refusal(() => portFor(b)).message.includes("two declarations"), "duplicates must refuse");
});

check("DP-K · a declaration file that is not an array, or unreadable, is refused", () => {
  const b = bed("notarray");
  writeFileSync(b.declarationPath, JSON.stringify({ scenarioId: SCENARIO.id }), "utf8");
  assert.ok(refusal(() => portFor(b)).message.includes("ARRAY"));

  const b2 = bed("unreadable");
  assert.ok(refusal(() => portFor(b2)).message.includes("cannot read"));
});

check("DP-L · a malformed CAPTURES line refuses too — binding needs a file read whole", () => {
  const b = bed("badcaptures");
  writeFileSync(b.capturesPath, "{ not json\n", "utf8");
  b.writeDeclaration([goodEntry(b)]);
  assert.ok(refusal(() => portFor(b)).message.includes("not valid JSON"));
});

check("DP-M · WIRING: the port drives deliverAndRecord into an evidence store as CAPTURED", () => {
  const b = bed("wiring");
  b.writeDeclaration([goodEntry(b)]);
  const port = portFor(b);
  const store = new EvidenceLogStore();
  const result = deliverAndRecord(port, SCENARIO.id, SCENARIO.stressor.steps, "G4_BLITZ", store, { atMs: 1000 });
  assert.strictEqual(result.state, "RECORDED", "the declared reading must reach the log");
  const records = store.records();
  assert.strictEqual(records.length, 2, "one ATTEMPT and one OUTCOME");
  const outcome = records[1] as { kind: string; outcome?: string; observables?: ObservableChecks };
  assert.strictEqual(outcome.outcome, "CAPTURED");
  assert.deepStrictEqual(outcome.observables, goodObservables());
});

check("DP-N · WIRING: a scenario with no declaration reaches the log as REFUSED, not as a default", () => {
  const b = bed("wiring-refused");
  b.writeDeclaration([goodEntry(b)]);
  const port = portFor(b);
  const store = new EvidenceLogStore();
  const result = deliverAndRecord(port, "n5-not-declared", [], "G4_BLITZ", store, { atMs: 1000 });
  assert.strictEqual(result.state, "RECORDED");
  const outcome = store.records()[1] as { outcome?: string; detail?: string };
  assert.strictEqual(outcome.outcome, "REFUSED", "an absent reading is REFUSED, never a clean capture");
  assert.ok((outcome.detail ?? "").includes("no declaration"), outcome.detail);
});

check("DP-O · declarationFor answers for exactly the scenarios deliver answers for (S120)", () => {
  const b = bed("declfor");
  b.writeDeclaration([goodEntry(b)]);
  const port = portFor(b);
  assert.deepStrictEqual(port.declarationFor(SCENARIO.id), {
    declaredBy: "mica-arbiter",
    declaredAt: "2026-09-09T13:00:00.000Z",
    captureSha256: b.sha,
  });
  // The same slice discipline `deliver` holds: an undeclared scenario has no
  // reading, and this method says so with `undefined` rather than a default.
  assert.strictEqual(port.declarationFor("n5-some-other-scenario"), undefined);
  // A port built for the OTHER slice holds nothing at all — so neither does this.
  assert.strictEqual(portFor(b, "CONTROL").declarationFor(SCENARIO.id), undefined);
});

check("DP-P · WIRING: the declared reading reaches the OUTCOME as declaredBy + captureSha256 (S120)", () => {
  const b = bed("wiring-provenance");
  b.writeDeclaration([goodEntry(b)]);
  const port = portFor(b);
  const store = new EvidenceLogStore();
  const provenance = {
    subjectId: "fixture-subject",
    basis: "TRANSCRIPT_DECLARED_BY_HUMAN",
    variant: "STRESS",
    seed: 1,
    deliverySeat: "THIRD_PERSON",
  } as const;
  const result = deliverAndRecord(
    port,
    SCENARIO.id,
    SCENARIO.stressor.steps,
    "G4_BLITZ",
    store,
    { atMs: 1000, provenance }
  );
  assert.strictEqual(result.state, "RECORDED");

  const records = store.records();
  const attempt = records[0] as { provenance?: unknown };
  assert.deepStrictEqual(attempt.provenance, provenance, "the ATTEMPT names whose subject and which slice");

  const outcome = records[1] as { outcome?: string; declaredBy?: string; captureSha256?: string };
  assert.strictEqual(outcome.outcome, "CAPTURED");
  assert.strictEqual(outcome.declaredBy, "mica-arbiter", "the OUTCOME names WHO read the reply");
  assert.strictEqual(outcome.captureSha256, b.sha, "and WHICH capture line they read");
  assert.deepStrictEqual(store.verify(), { valid: true, brokenAt: null });
});

check("DP-Q · a REFUSED delivery through this port carries NO reading — there is no capture (S120)", () => {
  const b = bed("wiring-refused-provenance");
  b.writeDeclaration([goodEntry(b)]);
  const store = new EvidenceLogStore();
  deliverAndRecord(portFor(b), "n5-not-declared", [], "G4_BLITZ", store, { atMs: 1000 });
  const outcome = store.records()[1] as object;
  assert.strictEqual((outcome as { outcome: string }).outcome, "REFUSED");
  assert.ok(!("declaredBy" in outcome), "no declaredBy on a refusal");
  assert.ok(!("captureSha256" in outcome), "no captureSha256 on a refusal");
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
