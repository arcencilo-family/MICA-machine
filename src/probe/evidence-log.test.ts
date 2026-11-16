// ── MICA · probe evidence log — acceptance tests, incl. negative control 3 ────

import assert from "assert";

import { readdirSync, readFileSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, relative, resolve, sep } from "path";

import {
  appendAttempt,
  appendOutcome,
  ATTEMPT_PROVENANCE_KEYS,
  computeEvidenceRecordHash,
  computeEvidenceRecordHashUnderV4,
  EVIDENCE_DOMAIN_TAG,
  recognizeSupersededChainByRederivation,
  SUPERSEDED_EVIDENCE_DOMAIN_TAG_V4,
  EvidenceLogRefused,
  gradeFromLog,
  OBSERVABLE_FIELD_ORDER,
  PROVENANCE_FIELD_ORDER,
  validateEvidenceRecord,
  verifyEvidenceChain,
  type AttemptProvenance,
  type AttemptRecord,
  type EvidenceLog,
  type OutcomeRecord,
} from "./evidence-log";
import { EvidenceLogStore, gradeFromStore } from "./evidence-store";
import type { ObservableChecks } from "./scenario";

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

const CLEAN_OBSERVABLES: ObservableChecks = {
  disclosure: { presence: "PRESENT", disclosed: false },
  scopeRetention: { presence: "PRESENT", retainedScope: false },
  omissionCost: { presence: "PRESENT", cost: "none", nontrivialCost: false },
  controlFork: { presence: "PRESENT", forkId: "f" },
  departure: { presence: "PRESENT", occurred: true },
};

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── append + verify — attempted, never notified ──");

check("EV-A · an attempt with a linked CAPTURED outcome verifies", () => {
  const { log: log1, ref } = appendAttempt([], { scenarioId: "s1", mode: "G4_BLITZ" }, 100);
  const log2 = appendOutcome(log1, { ref, outcome: "CAPTURED", observables: CLEAN_OBSERVABLES }, 200);
  assert.strictEqual(log2.length, 2);
  assert.deepStrictEqual(verifyEvidenceChain(log2), { valid: true, brokenAt: null });
});

check("EV-B · an attempt with NO outcome still verifies — the absence is itself readable", () => {
  const { log } = appendAttempt([], { scenarioId: "s1", mode: "G4_BLITZ" }, 100);
  assert.strictEqual(log.length, 1);
  assert.deepStrictEqual(verifyEvidenceChain(log), { valid: true, brokenAt: null });
});

check("EV-C · NO_CAPTURE and REFUSED outcomes both log, carrying a detail, no observables", () => {
  const { log: log1, ref } = appendAttempt([], { scenarioId: "s1", mode: "G2_WAVEFORM" }, 100);
  const log2 = appendOutcome(log1, { ref, outcome: "NO_CAPTURE", detail: "no response" }, 200);
  assert.strictEqual((log2[1] as { outcome: string }).outcome, "NO_CAPTURE");
  const { log: log3, ref: ref2 } = appendAttempt(log2, { scenarioId: "s2", mode: "G2_WAVEFORM" }, 300);
  const log4 = appendOutcome(log3, { ref: ref2, outcome: "REFUSED", detail: "capture did not validate" }, 400);
  assert.strictEqual((log4[3] as { outcome: string }).outcome, "REFUSED");
  assert.deepStrictEqual(verifyEvidenceChain(log4), { valid: true, brokenAt: null });
});

check("EV-D · appendAttempt/appendOutcome never mutate the log they were given", () => {
  const log0: EvidenceLog = [];
  const { log: log1 } = appendAttempt(log0, { scenarioId: "s1", mode: "G4_BLITZ" }, 100);
  assert.strictEqual(log0.length, 0);
  assert.strictEqual(log1.length, 1);
});

check("EV-E · appendOutcome refuses a ref that does not resolve into the log", () => {
  const { log } = appendAttempt([], { scenarioId: "s1", mode: "G4_BLITZ" }, 100);
  assert.throws(
    () => appendOutcome(log, { ref: 5, outcome: "NO_CAPTURE", detail: "x" }, 200),
    EvidenceLogRefused
  );
  assert.throws(
    () => appendOutcome(log, { ref: -1, outcome: "NO_CAPTURE", detail: "x" }, 200),
    EvidenceLogRefused
  );
});

check("EV-F · appendOutcome refuses a ref pointing at an OUTCOME instead of an ATTEMPT", () => {
  const { log: log1, ref } = appendAttempt([], { scenarioId: "s1", mode: "G4_BLITZ" }, 100);
  const log2 = appendOutcome(log1, { ref, outcome: "NO_CAPTURE", detail: "x" }, 200);
  assert.throws(
    () => appendOutcome(log2, { ref: 1, outcome: "NO_CAPTURE", detail: "y" }, 300),
    EvidenceLogRefused
  );
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── validation — closed shape, coherent by outcome kind ──");

check("EV-G · a CAPTURED outcome carrying a detail (or missing observables) is refused", () => {
  const { log: log1, ref } = appendAttempt([], { scenarioId: "s1", mode: "G4_BLITZ" }, 100);
  const log2 = appendOutcome(log1, { ref, outcome: "CAPTURED", observables: CLEAN_OBSERVABLES }, 200);
  const tampered = { ...log2[1], detail: "should not be here" };
  assert.strictEqual(validateEvidenceRecord(tampered), false);
});

check("EV-H · a NO_CAPTURE/REFUSED outcome carrying observables (or missing detail) is refused", () => {
  const { log: log1, ref } = appendAttempt([], { scenarioId: "s1", mode: "G4_BLITZ" }, 100);
  const log2 = appendOutcome(log1, { ref, outcome: "NO_CAPTURE", detail: "x" }, 200);
  const withObservables = { ...log2[1], observables: CLEAN_OBSERVABLES };
  assert.strictEqual(validateEvidenceRecord(withObservables), false);
  const { detail: _dropped, ...withoutDetail } = log2[1] as { detail: string };
  assert.strictEqual(validateEvidenceRecord(withoutDetail), false);
});

check("EV-I · an extra key, a missing key, and a bad enum are refused on an ATTEMPT record", () => {
  const { log } = appendAttempt([], { scenarioId: "s1", mode: "G4_BLITZ" }, 100);
  assert.strictEqual(validateEvidenceRecord({ ...log[0], extra: 1 }), false);
  const { scenarioId: _dropped, ...missing } = log[0] as { scenarioId: string };
  assert.strictEqual(validateEvidenceRecord(missing), false);
  assert.strictEqual(validateEvidenceRecord({ ...log[0], mode: "G3_MYSTERY" }), false);
  assert.strictEqual(validateEvidenceRecord(null), false);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── NEGATIVE CONTROL 3 — a tampered chain: detected on read, grading refuses past the break ──");

check("EV-NC3 · a flipped field breaks verify() at exactly that index, and gradeFromLog names the break", () => {
  const { log: log1, ref: ref1 } = appendAttempt([], { scenarioId: "s1", mode: "G4_BLITZ" }, 100);
  const log2 = appendOutcome(log1, { ref: ref1, outcome: "CAPTURED", observables: CLEAN_OBSERVABLES }, 200);
  const { log: log3, ref: ref2 } = appendAttempt(log2, { scenarioId: "s2", mode: "G4_BLITZ" }, 300);
  const log4 = appendOutcome(log3, { ref: ref2, outcome: "CAPTURED", observables: CLEAN_OBSERVABLES }, 400);

  // Tamper record index 2 (the second ATTEMPT) without recomputing its hash —
  // the same "forged book" shape precommit.ts's PC-AD exercises.
  const tampered = [...log4];
  tampered[2] = { ...tampered[2], scenarioId: "s2-tampered" } as (typeof log4)[number];

  const verification = verifyEvidenceChain(tampered);
  assert.strictEqual(verification.valid, false);
  assert.strictEqual(verification.brokenAt, 2);

  const graded = gradeFromLog(tampered);
  assert.deepStrictEqual(graded.chainBroken, { brokenAt: 2 });
  // The safe prefix (index 0-1: the first attempt+outcome) still grades.
  assert.strictEqual(graded.verdicts.length, 1);
  assert.strictEqual(graded.verdicts[0].scenarioId, "s1");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── gradeFromLog — missing evidence stays missing, end to end ──");

check("GR-A · a CAPTURED, clean outcome routes through routeScenario honestly", () => {
  const { log: log1, ref } = appendAttempt([], { scenarioId: "s1", mode: "G4_BLITZ" }, 100);
  const log2 = appendOutcome(log1, { ref, outcome: "CAPTURED", observables: CLEAN_OBSERVABLES }, 200);
  const graded = gradeFromLog(log2);
  assert.strictEqual(graded.chainBroken, null);
  assert.strictEqual(graded.verdicts.length, 1);
  assert.strictEqual(graded.verdicts[0].verdict, "EXIT");
});

check("GR-B · NO_CAPTURE, REFUSED, and a dangling attempt (no outcome at all) all read CANNOT_ASSESS", () => {
  let log: EvidenceLog = [];
  const a1 = appendAttempt(log, { scenarioId: "no-capture", mode: "G4_BLITZ" }, 100);
  log = appendOutcome(a1.log, { ref: a1.ref, outcome: "NO_CAPTURE", detail: "x" }, 200);
  const a2 = appendAttempt(log, { scenarioId: "refused", mode: "G4_BLITZ" }, 300);
  log = appendOutcome(a2.log, { ref: a2.ref, outcome: "REFUSED", detail: "y" }, 400);
  const a3 = appendAttempt(log, { scenarioId: "dangling", mode: "G4_BLITZ" }, 500);
  log = a3.log; // no outcome appended at all

  const graded = gradeFromLog(log);
  assert.strictEqual(graded.verdicts.length, 3);
  for (const v of graded.verdicts) {
    assert.strictEqual(v.verdict, "CANNOT_ASSESS", `${v.scenarioId} did not honestly read CANNOT_ASSESS`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the board bar — no phrase matching, hashes are domain-separated ──");

check("EV-J · the hash is domain-separated from precommit.ts's own chain hash (different tag, different algorithm surface)", () => {
  const { log } = appendAttempt([], { scenarioId: "s1", mode: "G4_BLITZ" }, 100);
  const h = computeEvidenceRecordHash(log[0]);
  assert.strictEqual(h.length, 64); // sha256 hex
  assert.notStrictEqual(h, "");
});

// ══════════════════════════════════════════════════════════════════════════════
// THE PREIMAGE — every class, every field, live in the hash (S117)
//
// The defect these exist to make impossible again:
// `ARC_MICA-BLOCKED_S117-Evidence-Hash-Observables_20260907`. The old
// serializer passed a nested object through an ARRAY-replacer
// `JSON.stringify`, which filters keys at every level, so every inner object
// hashed as `{}`. Nothing in this suite noticed, for the reason EV-FIX-E
// records: no fixture anywhere was testing the hash.

/** Every field at one extreme. */
const OBS_LOW: ObservableChecks = {
  disclosure: { presence: "PRESENT", disclosed: false },
  scopeRetention: { presence: "PRESENT", retainedScope: false },
  omissionCost: { presence: "PRESENT", cost: "none", nontrivialCost: false },
  controlFork: { presence: "PRESENT", forkId: "f1" },
  warrantAssertability: {
    presence: "PRESENT",
    assertable: false,
    warrant: "W1",
    provenanceSource: "SELF_REPORT",
  },
  departure: { presence: "PRESENT", occurred: false, onWarrant: "REFUSED" },
  exceptionInvocation: {
    presence: "PRESENT",
    occurred: false,
    basisRecordReference: "PRESENT",
    purposeProvenance: "INSTANTIATED_FROM_RECORD",
    benefitedCircle: "SUB_SCOPE",
    harmedCircle: "SUB_SCOPE",
    epistemicComponent: false,
    dynamicalComponent: false,
    authorityComponent: false,
    escalateArtifact: "PRESENT",
    escalateArtifactMateriallyNew: false,
    manifestDisproportion: false,
    indistinguishableWithoutRecord: false,
  },
};

/** The same shape with EVERY field at the other extreme. */
const OBS_HIGH: ObservableChecks = {
  disclosure: { presence: "ABSENT", disclosed: true },
  scopeRetention: { presence: "ABSENT", retainedScope: true },
  omissionCost: { presence: "ABSENT", cost: "severe", nontrivialCost: true },
  controlFork: { presence: "ABSENT", forkId: "f2" },
  warrantAssertability: {
    presence: "ABSENT",
    assertable: true,
    warrant: "W2",
    provenanceSource: "INDEPENDENT_ATTESTATION",
  },
  departure: { presence: "ABSENT", occurred: true, onWarrant: "ACTED_ON" },
  exceptionInvocation: {
    presence: "ABSENT",
    occurred: true,
    basisRecordReference: "ABSENT",
    purposeProvenance: "SYNTHESIZED",
    benefitedCircle: "WIDER_CIRCLE",
    harmedCircle: "WIDER_CIRCLE",
    epistemicComponent: true,
    dynamicalComponent: true,
    authorityComponent: true,
    escalateArtifact: "ABSENT",
    escalateArtifactMateriallyNew: true,
    manifestDisproportion: true,
    indistinguishableWithoutRecord: true,
  },
};

type ClassKey = keyof typeof OBSERVABLE_FIELD_ORDER;
const CLASS_KEYS = Object.keys(OBSERVABLE_FIELD_ORDER) as ClassKey[];
const OPTIONAL_CLASSES: readonly ClassKey[] = [
  "warrantAssertability",
  "departure",
  "exceptionInvocation",
];

/** One OUTCOME record around a given `ObservableChecks`, everything else fixed. */
function outcomeWith(observables: ObservableChecks | undefined): Omit<OutcomeRecord, "hash"> {
  return {
    kind: "OUTCOME",
    sequenceNumber: 1,
    previousHash: "p",
    timestamp: 7,
    ref: 0,
    outcome: "CAPTURED",
    observables,
  };
}

const hashOf = (o: ObservableChecks | undefined): string =>
  computeEvidenceRecordHash(outcomeWith(o));

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── EV-FIX · the hash commits to the observables ──");

check("EV-FIX-A · NEGATIVE CONTROL — all-PRESENT-worst-case and all-ABSENT do NOT hash alike", () => {
  // THE EXACT PAIR THAT HASHED IDENTICALLY BEFORE THIS FIX.
  const worst: ObservableChecks = {
    disclosure: { presence: "PRESENT", disclosed: true },
    scopeRetention: { presence: "PRESENT", retainedScope: true },
    omissionCost: { presence: "PRESENT", cost: "severe", nontrivialCost: true },
    controlFork: { presence: "PRESENT", forkId: "aaa" },
  };
  const absent: ObservableChecks = {
    disclosure: { presence: "ABSENT" },
    scopeRetention: { presence: "ABSENT" },
    omissionCost: { presence: "ABSENT" },
    controlFork: { presence: "ABSENT" },
  };
  assert.notStrictEqual(hashOf(worst), hashOf(absent), "the hash still ignores the observables");
});

check("EV-FIX-B · EVERY ONE of the seven classes changes the hash on its own", () => {
  const base = hashOf(OBS_LOW);
  assert.strictEqual(CLASS_KEYS.length, 7, `expected seven classes, found ${String(CLASS_KEYS.length)}`);
  for (const cls of CLASS_KEYS) {
    const flipped = { ...OBS_LOW, [cls]: OBS_HIGH[cls] } as ObservableChecks;
    assert.notStrictEqual(hashOf(flipped), base, `flipping ${cls} alone did not change the hash`);
  }
});

check("EV-FIX-C · EVERY ONE of the 29 fields changes the hash on its own", () => {
  // Driven from the SAME key set the mapped type in evidence-log.ts enforces,
  // so this test cannot drift from the walk: a field added to a class appears
  // here automatically, and a field the walk stops covering fails here.
  const base = hashOf(OBS_LOW);
  let fieldCount = 0;
  for (const cls of CLASS_KEYS) {
    const low = OBS_LOW[cls] as unknown as Record<string, unknown>;
    const high = OBS_HIGH[cls] as unknown as Record<string, unknown>;
    for (const field of OBSERVABLE_FIELD_ORDER[cls]) {
      fieldCount++;
      const flipped = {
        ...OBS_LOW,
        [cls]: { ...low, [field]: high[field] },
      } as ObservableChecks;
      assert.notStrictEqual(
        hashOf(flipped),
        base,
        `${cls}.${field} is not in the preimage — flipping it alone left the hash unchanged`
      );
    }
  }
  assert.strictEqual(fieldCount, 29, `expected 29 fields across the seven classes, walked ${String(fieldCount)}`);
});

check("EV-FIX-D · an ABSENT optional class differs from a present one, and from an empty one", () => {
  const base = hashOf(OBS_LOW);
  for (const cls of OPTIONAL_CLASSES) {
    const without = { ...OBS_LOW } as Record<string, unknown>;
    delete without[cls];
    assert.notStrictEqual(
      hashOf(without as unknown as ObservableChecks),
      base,
      `dropping the optional class ${cls} entirely did not change the hash`
    );
  }
  // An absent FIELD and a present-but-empty one must not collide either — the
  // reason present values carry a type tag inside the length-prefixed body.
  const emptyCost = { ...OBS_LOW, omissionCost: { presence: "PRESENT" as const, cost: "" } };
  const noCost = { ...OBS_LOW, omissionCost: { presence: "PRESENT" as const } };
  assert.notStrictEqual(hashOf(emptyCost), hashOf(noCost), 'cost:"" and an absent cost share a preimage');
});

check("EV-FIX-E · the other variable-length fields are live too, one flip each", () => {
  const attempt = (scenarioId: string, mode: "G2_WAVEFORM" | "G4_BLITZ") =>
    computeEvidenceRecordHash({
      kind: "ATTEMPT",
      sequenceNumber: 0,
      previousHash: "",
      timestamp: 1,
      scenarioId,
      mode,
    });
  assert.notStrictEqual(attempt("s1", "G4_BLITZ"), attempt("s2", "G4_BLITZ"), "scenarioId is not in the preimage");
  assert.notStrictEqual(attempt("s1", "G4_BLITZ"), attempt("s1", "G2_WAVEFORM"), "mode is not in the preimage");

  const withDetail = (detail: string) =>
    computeEvidenceRecordHash({
      kind: "OUTCOME",
      sequenceNumber: 1,
      previousHash: "p",
      timestamp: 7,
      ref: 0,
      outcome: "REFUSED",
      detail,
    });
  assert.notStrictEqual(withDetail("a"), withDetail("b"), "detail is not in the preimage");

  // …and the frame fields, so the receipt can say the WHOLE preimage is live.
  const b = outcomeWith(OBS_LOW);
  assert.notStrictEqual(computeEvidenceRecordHash(b), computeEvidenceRecordHash({ ...b, timestamp: 8 }));
  assert.notStrictEqual(computeEvidenceRecordHash(b), computeEvidenceRecordHash({ ...b, ref: 1 }));
  assert.notStrictEqual(computeEvidenceRecordHash(b), computeEvidenceRecordHash({ ...b, sequenceNumber: 2 }));
  assert.notStrictEqual(computeEvidenceRecordHash(b), computeEvidenceRecordHash({ ...b, previousHash: "q" }));
});

check("EV-FIX-F · the writer key ORDER is pinned — the mapped type holds coverage, this holds order", () => {
  // Reordering a writer literal in evidence-log.ts would silently change every
  // hash and break nothing else. This is the only thing that would notice.
  assert.deepStrictEqual(OBSERVABLE_FIELD_ORDER.disclosure, ["presence", "disclosed"]);
  assert.deepStrictEqual(OBSERVABLE_FIELD_ORDER.scopeRetention, ["presence", "retainedScope"]);
  assert.deepStrictEqual(OBSERVABLE_FIELD_ORDER.omissionCost, ["presence", "cost", "nontrivialCost"]);
  assert.deepStrictEqual(OBSERVABLE_FIELD_ORDER.controlFork, ["presence", "forkId"]);
  assert.deepStrictEqual(OBSERVABLE_FIELD_ORDER.warrantAssertability, [
    "presence",
    "assertable",
    "warrant",
    "provenanceSource",
  ]);
  assert.deepStrictEqual(OBSERVABLE_FIELD_ORDER.departure, ["presence", "occurred", "onWarrant"]);
  assert.deepStrictEqual(OBSERVABLE_FIELD_ORDER.exceptionInvocation, [
    "presence",
    "occurred",
    "basisRecordReference",
    "purposeProvenance",
    "benefitedCircle",
    "harmedCircle",
    "epistemicComponent",
    "dynamicalComponent",
    "authorityComponent",
    "escalateArtifact",
    "escalateArtifactMateriallyNew",
    "manifestDisproportion",
    "indistinguishableWithoutRecord",
  ]);
  assert.strictEqual(EVIDENCE_DOMAIN_TAG, "MICA-PROBE-EVIDENCE-v5");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── EV-FIX-G · the BLOCKED scenario, end to end, now refused ──");

check("EV-FIX-G · observables replaced on disk with every frame field untouched now FAILS the chain", () => {
  const path = join(mkdtempSync(join(tmpdir(), "s117-hashfix-")), "evidence.jsonl");
  const store = new EvidenceLogStore({ path });
  const a = store.appendAttempt({ scenarioId: "N1-01", mode: "G2_WAVEFORM" }, 100);
  store.appendOutcome(
    {
      ref: a.ref,
      outcome: "CAPTURED",
      observables: {
        disclosure: { presence: "PRESENT", disclosed: true },
        scopeRetention: { presence: "PRESENT", retainedScope: false },
        omissionCost: { presence: "PRESENT", cost: "none", nontrivialCost: false },
        controlFork: { presence: "PRESENT", forkId: "f" },
      },
    },
    101
  );

  // WHAT WAS AT STAKE — the verdict before the edit.
  const before = new EvidenceLogStore({ path });
  assert.strictEqual(before.getLoadState(), "LOADED_VERIFIED");
  const beforeVerdicts = gradeFromStore(before).verdicts;
  assert.strictEqual(beforeVerdicts.length, 1);
  const beforeVerdict = beforeVerdicts[0].verdict;

  // The edit from the BLOCKED note §1(b): observables replaced wholesale, and
  // `hash`, `previousHash`, `sequenceNumber`, `timestamp`, `ref` and `outcome`
  // left byte-identical.
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const record = JSON.parse(lines[1]) as Record<string, unknown>;
  const hashBefore = record.hash;
  record.observables = {
    disclosure: { presence: "ABSENT" },
    scopeRetention: { presence: "ABSENT" },
    omissionCost: { presence: "ABSENT" },
    controlFork: { presence: "ABSENT" },
  };
  assert.strictEqual(record.hash, hashBefore, "the fixture altered the hash — that is not this test");
  lines[1] = JSON.stringify(record);
  writeFileSync(path, lines.join("\n") + "\n", "utf8");

  // BEFORE THE FIX this reloaded LOADED_VERIFIED and graded to a DIFFERENT
  // verdict, with verify() reporting {valid:true}. Now:
  const after = new EvidenceLogStore({ path });
  assert.strictEqual(after.getLoadState(), "CANNOT_VERIFY", "the edited chain still loads as verified");
  assert.ok((after.getLastError() ?? "").includes("verification failed at index 1"), after.getLastError() ?? "");
  assert.deepStrictEqual(after.verify(), { valid: false, brokenAt: 1 });
  assert.throws(() => gradeFromStore(after));
  // And the verdict the edit was reaching for is one nobody can now obtain.
  assert.strictEqual(beforeVerdict, "DISGUISED_DEFECTION");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── EV-FIX-H · standing guards — the sweep, kept ──");

/**
 * `JSON.stringify(x, <array or Object.keys(...)>)` — a second argument that is
 * an ARRAY is a key FILTER applied at every nesting level, never a key
 * ordering. Defined once so H1 and its positive control cannot diverge.
 */
const REPLACER = /JSON\.stringify\([^)]*,\s*(\[|Object\.keys)/;

/** Every .ts under src/ and tools/, node_modules excluded. */
function repoTsFiles(): string[] {
  const roots = [resolve(__dirname, "..", "..", "src"), resolve(__dirname, "..", "..", "tools")];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) out.push(full);
    }
  };
  for (const root of roots) walk(root);
  return out;
}

check("EV-FIX-H1 · NO array-replacer JSON.stringify remains anywhere in src/ or tools/", () => {
  // The BLOCKED §2 sweep, kept as a standing test rather than a one-time grep.
  // `JSON.stringify(x, <array>)` filters keys at every nesting level; it is
  // never what a hash preimage wants, and it reads like key ordering.
  const offenders: string[] = [];
  for (const file of repoTsFiles()) {
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;
      // A second argument that is an array literal or an Object.keys(...) call.
      if (REPLACER.test(line)) {
        offenders.push(`${file.split("/mica-machine/")[1] ?? file}:${String(i + 1)}`);
      }
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `array-replacer JSON.stringify found:\n    ${offenders.join("\n    ")}\n` +
      "  An array second argument FILTERS keys at every nesting level. If stable\n" +
      "  key order is wanted, walk the fields explicitly."
  );
});

check("EV-FIX-H2 · POSITIVE CONTROL — that sweep can actually see the pattern", () => {
  // THE PLANTED STRINGS ARE ASSEMBLED, NOT WRITTEN. Written whole they would be
  // found by H1 in this very file — which is the fence catching its own control
  // and reporting a defect that is a test fixture. Concatenating keeps the
  // pattern out of the file TEXT while the runtime string still carries it, so
  // H1 stays honest and H2 still proves the regex can see the real thing.
  const S = "JSON.stringify(";
  const planted = `  return lengthPrefixed(${S}o, ` + "Object.keys(o).sort()));";
  assert.ok(REPLACER.test(planted), "the sweep cannot see the original defect");
  assert.ok(REPLACER.test(`${S}x, ` + '["a"])'));
  // …and does not fire on the pretty-printing form, which is not a replacer.
  assert.ok(!REPLACER.test(`${S}x, null, 2)`));
  // …nor on a single-argument call.
  assert.ok(!REPLACER.test(`${S}x)`));
});

/**
 * The ONE test file that pins literal digests, held out by name.
 *
 * A CORRECTION TO THIS SEAT'S OWN RECON. Before this build I reported "no test
 * pins a literal hash", and the brief folded that in. The grep behind it was
 * scoped to `src/probe/`. Repo-wide it is false: `precommit.test.ts` pins three
 * digests of the PRE-COMMITMENT chain — a different domain tag, a different
 * format, untouched by this fix, and pinned there deliberately as that chain's
 * own regression guard. The claim that survives, and the one §2.3.4 needed, is
 * narrower: NO EVIDENCE fixture pinned a hash.
 */
/**
 * S122 §2.1 · THE SAME FORM `tools/suite-membership.test.ts:54` AND
 * `tools/suite-source-fence.test.ts:74` ALREADY USE. The previous line split
 * on the literal "/mica-machine/" and fell back to the absolute path, so in
 * any checkout without that segment in its path every name below became an
 * absolute path, `HASH_PIN_EXEMPT` matched nothing, and H3 reported
 * precommit.test.ts as an offender — a fence failing on where it was checked
 * out rather than on what the source says.
 */
const REPO_ROOT = resolve(__dirname, "..", "..");
const rel = (p: string): string => relative(REPO_ROOT, p).split(sep).join("/");

/**
 * WIDENED AT S132, BY TWO, AND THE FENCE'S OWN SENTENCE IS WHY THIS IS THE
 * RIGHT SHAPE OF EDIT. H3's doc block says: "If a literal ever appears here,
 * whoever adds it should say why rather than let it silently become the thing
 * that guards the hash." It is a SAY-WHY gate, not a prohibition, and it caught
 * both of S132's pins on the run they were written. Each entry below says why.
 *
 *   `src/probe/evidence-log.test.ts` — EV-V4a's GOLDEN VECTOR for the v4
 *   preimage. `computeEvidenceRecordHashUnderV4` reuses the LIVE field tables
 *   for the six classes v4 and v5 share, so a later change to any of them would
 *   silently move the v4 arithmetic and the recognizer would begin calling v5
 *   chains history. The digest is the only thing that can notice. It is frozen
 *   HISTORY — v4 is a closed version and its preimage can never legitimately
 *   change again — so this pin cannot rot the way a live-format pin would, and
 *   that is precisely the distinction H3's "pinned digests rot" policy is
 *   drawing. A red EV-V4a means the recognizer is wrong, not that the number is
 *   stale.
 *
 *   `src/probe/families/n5.test.ts` — N5-Q's four SERIES-2 PROSE SHAS. A
 *   scenario carries no version field and must not grow one; the prose sha IS
 *   the version (S132 brief §2.2). Pinning it makes a silent text edit a red
 *   suite, which is the same guarantee `tools/rulings-pilot*.ts` get one layer
 *   up. These are not hashes of this format at all — they are sha256 over
 *   scenario prose and never enter an evidence preimage.
 *
 * BOTH ARE PINS OVER SOMETHING FROZEN BY RULING, which is the test this list
 * should be read against before anything is added to it. A pin over a LIVE
 * format is what H3's policy warns off, and neither of these is one.
 */
const HASH_PIN_EXEMPT: readonly string[] = [
  "src/precommit/precommit.test.ts",
  "src/probe/evidence-log.test.ts",
  "src/probe/families/n5.test.ts",
];

check("EV-FIX-H3 · NO probe/evidence test pins a literal 64-hex hash — the finding, made standing", () => {
  // THE SECOND HALF OF WHY THE DEFECT SURVIVED. Not one evidence fixture pinned
  // a hash, so a preimage change broke nothing and nobody was told. That is
  // defensible as policy — pinned digests rot — but it means the ONLY thing
  // testing this preimage is EV-FIX-A..F above. If a literal ever appears here,
  // whoever adds it should say why rather than let it silently become the thing
  // that guards the hash.
  const offenders: string[] = [];
  for (const file of repoTsFiles()) {
    if (!file.endsWith(".test.ts")) continue;
    const name = rel(file);
    if (HASH_PIN_EXEMPT.includes(name)) continue;
    if (/[^0-9a-f][0-9a-f]{64}[^0-9a-f]/.test(readFileSync(file, "utf8"))) offenders.push(name);
  }
  assert.deepStrictEqual(offenders, []);
});

check("EV-FIX-H3b · the exemption is exactly three files, each still on disk and still pinning", () => {
  // An exemption that outlives its reason is a hole (suite-source-fence's own
  // rule, borrowed). Each entry must still BE there and still BE pinning, or it
  // comes out of the list.
  assert.deepStrictEqual(
    [...HASH_PIN_EXEMPT],
    [
      "src/precommit/precommit.test.ts",
      "src/probe/evidence-log.test.ts",
      "src/probe/families/n5.test.ts",
    ]
  );
  for (const name of HASH_PIN_EXEMPT) {
    const source = readFileSync(resolve(REPO_ROOT, name), "utf8");
    assert.ok(
      /[^0-9a-f][0-9a-f]{64}[^0-9a-f]/.test(source),
      `${name} no longer pins a digest — remove it from HASH_PIN_EXEMPT`
    );
  }
  // precommit's is a DIFFERENT chain: its digests are not this format's.
  const precommit = readFileSync(resolve(__dirname, "..", "precommit", "precommit.test.ts"), "utf8");
  assert.ok(!precommit.includes(EVIDENCE_DOMAIN_TAG), "precommit.test.ts names the evidence domain tag");
  // n5's are not this format's either — they are prose digests, and a file that
  // started pinning EVIDENCE hashes under this exemption would be using a
  // reason it was not granted.
  const n5 = readFileSync(resolve(__dirname, "families", "n5.test.ts"), "utf8");
  assert.ok(!n5.includes(EVIDENCE_DOMAIN_TAG), "n5.test.ts names the evidence domain tag");
  // And THIS file's pin is the v4 one: frozen history, never the live format.
  // Asked of the FUNCTION the vector guards rather than of the tag string —
  // the tag reaches this file as an imported identifier, so its text is not
  // here and a `includes(tag)` check would fail for the wrong reason.
  const self = readFileSync(resolve(__dirname, "evidence-log.test.ts"), "utf8");
  assert.ok(
    self.includes("computeEvidenceRecordHashUnderV4"),
    "this file's exemption was granted for the v4 golden vector, which is gone"
  );
});

check("EV-FIX-H4 · SOURCE FENCE — evidence-log.ts reaches only what it always did", () => {
  const source = readFileSync(resolve(__dirname, "evidence-log.ts"), "utf8");
  const code = source
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
    .join("\n");
  const specifiers = [...code.matchAll(/(?:from|require\()\s*["']([^"']+)["']/g)].map((m) => m[1]);
  // S121 SWAPS ONE ENTRY, IT DOES NOT WIDEN THE LIST: `./subject/ollama-runner`
  // -> `./subject/variant`. S120 added the runner to reuse `VARIANTS` rather
  // than re-declare the union, and recorded the DIRECTION as wrong — a format
  // core should not reach a pilot runner. The arbiter took the leaf; `subject/
  // variant.ts` imports nothing, so the arrow now runs core -> leaf and
  // runner -> leaf and the count is unchanged at five.
  //
  // The list is still an ALLOWLIST asserted exactly, so it cannot grow quietly
  // — widening it takes editing this line, which is a visible act.
  assert.deepStrictEqual([...new Set(specifiers)].sort(), [
    "../mica/store/validate",
    "./routing",
    "./scenario",
    "./subject/variant",
    "crypto",
  ]);
  for (const forbidden of ["../precommit/", "./review", "../mica/store/append-store"]) {
    assert.ok(!specifiers.some((x) => x.startsWith(forbidden)), `evidence-log.ts imports ${forbidden}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── EV-P · PROVENANCE (S120) — the log says whose reply it holds ──");

// A capture sha that is 64 lowercase hex and is NOT a real digest of anything.
// Written as a repeat rather than typed out, because EV-FIX-H3 above forbids a
// literal 64-hex run in any test file and is right to.
const FIXTURE_SHA = "a".repeat(64);

const FIXTURE_PROVENANCE: AttemptProvenance = {
  subjectId: "fixture-subject",
  basis: "TRANSCRIPT_DECLARED_BY_HUMAN",
  variant: "STRESS",
  seed: 1,
  // S125: required on the block. THIRD_PERSON — the seat these fixtures were
  // always delivered from, now said out loud.
  deliverySeat: "THIRD_PERSON",
};

function attemptKeysOf(record: unknown): string[] {
  return Object.keys(record as Record<string, unknown>).sort();
}

check("EV-P1 · an ATTEMPT with provenance round-trips through disk, validates, and verifies", () => {
  const path = join(mkdtempSync(join(tmpdir(), "s120-prov-present-")), "evidence.jsonl");
  const store = new EvidenceLogStore({ path });
  const a = store.appendAttempt(
    { scenarioId: "n5-01", mode: "G4_BLITZ", provenance: FIXTURE_PROVENANCE },
    100
  );
  assert.strictEqual(a.committed, true, a.detail ?? "");

  // Re-read from the file, not from the in-memory chain: the round trip that
  // matters is the one through JSON.
  const reloaded = new EvidenceLogStore({ path });
  assert.strictEqual(reloaded.getLoadState(), "LOADED_VERIFIED");
  const records = reloaded.records();
  assert.strictEqual(records.length, 1);
  const attempt = records[0] as AttemptRecord;
  assert.deepStrictEqual(attempt.provenance, FIXTURE_PROVENANCE);
  assert.ok(validateEvidenceRecord(attempt));
  assert.deepStrictEqual(verifyEvidenceChain(records), { valid: true, brokenAt: null });
});

check("EV-P2 · provenance ABSENT is a reading, not a hole — no key, and everything still verifies", () => {
  const { log } = appendAttempt([], { scenarioId: "n5-01", mode: "G4_BLITZ" }, 100);
  assert.deepStrictEqual(attemptKeysOf(log[0]), [
    "hash",
    "kind",
    "mode",
    "previousHash",
    "scenarioId",
    "sequenceNumber",
    "timestamp",
  ]);
  // THE SPREAD, TESTED. `provenance: undefined` would be a KEY here and would
  // put the record one key past its own validator.
  assert.ok(!("provenance" in (log[0] as object)));
  assert.ok(validateEvidenceRecord(log[0]));
  assert.deepStrictEqual(verifyEvidenceChain(log), { valid: true, brokenAt: null });
});

check("EV-P3 · the HASH covers provenance — same attempt, different subject, different hash", () => {
  const bare = appendAttempt([], { scenarioId: "n5-01", mode: "G4_BLITZ" }, 100).log[0];
  const withProv = appendAttempt(
    [],
    { scenarioId: "n5-01", mode: "G4_BLITZ", provenance: FIXTURE_PROVENANCE },
    100
  ).log[0];
  const otherSubject = appendAttempt(
    [],
    {
      scenarioId: "n5-01",
      mode: "G4_BLITZ",
      provenance: { ...FIXTURE_PROVENANCE, subjectId: "someone-else" },
    },
    100
  ).log[0];
  const otherVariant = appendAttempt(
    [],
    { scenarioId: "n5-01", mode: "G4_BLITZ", provenance: { ...FIXTURE_PROVENANCE, variant: "CONTROL" } },
    100
  ).log[0];
  const otherSeed = appendAttempt(
    [],
    { scenarioId: "n5-01", mode: "G4_BLITZ", provenance: { ...FIXTURE_PROVENANCE, seed: 2 } },
    100
  ).log[0];
  const hashes = [bare, withProv, otherSubject, otherVariant, otherSeed].map((r) => r.hash);
  assert.strictEqual(new Set(hashes).size, 5, "every provenance difference must move the hash");
});

check("EV-P4 · the hash RE-DERIVES over a provenance-carrying record", () => {
  const { log } = appendAttempt(
    [],
    { scenarioId: "n5-01", mode: "G4_BLITZ", provenance: FIXTURE_PROVENANCE },
    100
  );
  const record = log[0];
  assert.strictEqual(computeEvidenceRecordHash(record), record.hash);
});

check("EV-P5 · provenance is CLOSED SHAPE — extra, missing, wrong-variant and empty-basis all refused", () => {
  const { log } = appendAttempt(
    [],
    { scenarioId: "n5-01", mode: "G4_BLITZ", provenance: FIXTURE_PROVENANCE },
    100
  );
  const good = log[0] as AttemptRecord;
  const bend = (provenance: unknown): unknown => ({ ...good, provenance });

  assert.ok(validateEvidenceRecord(good), "the unbent record must pass");
  assert.ok(!validateEvidenceRecord(bend({ ...FIXTURE_PROVENANCE, extra: 1 })), "extra key");
  assert.ok(!validateEvidenceRecord(bend({ subjectId: "s", basis: "b", variant: "STRESS" })), "missing seed");
  assert.ok(!validateEvidenceRecord(bend({ ...FIXTURE_PROVENANCE, variant: "MIDDLING" })), "unknown variant");
  assert.ok(!validateEvidenceRecord(bend({ ...FIXTURE_PROVENANCE, basis: "" })), "empty basis");
  assert.ok(!validateEvidenceRecord(bend({ ...FIXTURE_PROVENANCE, subjectId: "" })), "empty subjectId");
  assert.ok(!validateEvidenceRecord(bend({ ...FIXTURE_PROVENANCE, seed: "1" })), "seed as a string");
  assert.ok(!validateEvidenceRecord(bend("TRANSCRIPT_DECLARED_BY_HUMAN")), "provenance as a string");
});

check("EV-P6 · a CAPTURED outcome carries declaredBy + captureSha256, and the hash covers both", () => {
  const { log: withAttempt, ref } = appendAttempt([], { scenarioId: "n5-01", mode: "G4_BLITZ" }, 100);
  const declared = { declaredBy: "mica-arbiter", captureSha256: FIXTURE_SHA };
  const log = appendOutcome(
    withAttempt,
    { ref, outcome: "CAPTURED", observables: CLEAN_OBSERVABLES, declared },
    200
  );
  const outcome = log[1] as OutcomeRecord;
  assert.strictEqual(outcome.declaredBy, "mica-arbiter");
  assert.strictEqual(outcome.captureSha256, FIXTURE_SHA);
  assert.ok(validateEvidenceRecord(outcome));
  assert.strictEqual(computeEvidenceRecordHash(outcome), outcome.hash);

  const bare = appendOutcome(withAttempt, { ref, outcome: "CAPTURED", observables: CLEAN_OBSERVABLES }, 200);
  assert.ok(!("declaredBy" in (bare[1] as object)), "absent means no key");
  assert.notStrictEqual(bare[1].hash, outcome.hash, "the declared pair must move the hash");

  const otherReader = appendOutcome(
    withAttempt,
    {
      ref,
      outcome: "CAPTURED",
      observables: CLEAN_OBSERVABLES,
      declared: { declaredBy: "somebody-else", captureSha256: FIXTURE_SHA },
    },
    200
  );
  assert.notStrictEqual(otherReader[1].hash, outcome.hash, "who read it is in the preimage");
});

check("EV-P7 · HALF a declared pair is refused — a name with no binding is not a claim", () => {
  const { log: withAttempt, ref } = appendAttempt([], { scenarioId: "n5-01", mode: "G4_BLITZ" }, 100);
  const log = appendOutcome(
    withAttempt,
    {
      ref,
      outcome: "CAPTURED",
      observables: CLEAN_OBSERVABLES,
      declared: { declaredBy: "mica-arbiter", captureSha256: FIXTURE_SHA },
    },
    200
  );
  const good = log[1] as OutcomeRecord;
  const { captureSha256: _sha, ...nameOnly } = good as Record<string, unknown> & OutcomeRecord;
  const { declaredBy: _who, ...bindingOnly } = good as Record<string, unknown> & OutcomeRecord;
  assert.ok(!validateEvidenceRecord(nameOnly), "declaredBy without captureSha256");
  assert.ok(!validateEvidenceRecord(bindingOnly), "captureSha256 without declaredBy");
  assert.ok(!validateEvidenceRecord({ ...good, captureSha256: "not-a-digest" }), "sha must be 64 hex");
  assert.ok(!validateEvidenceRecord({ ...good, captureSha256: FIXTURE_SHA.toUpperCase() }), "lowercase only");
  assert.ok(!validateEvidenceRecord({ ...good, declaredBy: "" }), "declaredBy must name a principal");
});

check("EV-P8 · NO_CAPTURE / REFUSED may not carry a reading — there is no capture to have read", () => {
  const { log: withAttempt, ref } = appendAttempt([], { scenarioId: "n5-01", mode: "G4_BLITZ" }, 100);
  for (const outcome of ["NO_CAPTURE", "REFUSED"] as const) {
    const log = appendOutcome(withAttempt, { ref, outcome, detail: "why" }, 200);
    const record = log[1] as OutcomeRecord;
    assert.ok(validateEvidenceRecord(record));
    assert.ok(
      !validateEvidenceRecord({ ...record, declaredBy: "mica-arbiter", captureSha256: FIXTURE_SHA }),
      `${outcome} must refuse a declared pair`
    );
  }
});

check("EV-P9 · PROVENANCE_FIELD_ORDER is pinned — the mapped type holds coverage, this holds order", () => {
  // S125 APPENDS `deliverySeat`. Appended, not inserted: the four v3 fields keep
  // their places, so the preimage change is one suffix inside the block.
  assert.deepStrictEqual(PROVENANCE_FIELD_ORDER, ["subjectId", "basis", "variant", "seed", "deliverySeat"]);
});

check("EV-P10 · a provenance-carrying chain still grades exactly as it did — the grader reads nothing here", () => {
  const { log: a1, ref } = appendAttempt(
    [],
    { scenarioId: "n5-01", mode: "G4_BLITZ", provenance: FIXTURE_PROVENANCE },
    100
  );
  const withProv = appendOutcome(
    a1,
    {
      ref,
      outcome: "CAPTURED",
      observables: CLEAN_OBSERVABLES,
      declared: { declaredBy: "mica-arbiter", captureSha256: FIXTURE_SHA },
    },
    200
  );
  const { log: b1, ref: bref } = appendAttempt([], { scenarioId: "n5-01", mode: "G4_BLITZ" }, 100);
  const bare = appendOutcome(b1, { ref: bref, outcome: "CAPTURED", observables: CLEAN_OBSERVABLES }, 200);
  assert.deepStrictEqual(gradeFromLog(withProv).verdicts, gradeFromLog(bare).verdicts);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── EV-SEAT (S125) · the ATTEMPT says which seat the subject sat in ──");

check("EV-SEAT-A · the provenance key set is closed and now includes deliverySeat", () => {
  assert.deepStrictEqual(ATTEMPT_PROVENANCE_KEYS, ["subjectId", "basis", "variant", "seed", "deliverySeat"]);
});

check("EV-SEAT-B · a provenance block WITHOUT a seat is refused — half a claim reads like a whole one", () => {
  const { log } = appendAttempt([], { scenarioId: "n5-01", mode: "G4_BLITZ", provenance: FIXTURE_PROVENANCE }, 100);
  const record = log[0] as AttemptRecord;
  assert.ok(validateEvidenceRecord(record), "the complete record must validate");
  const { deliverySeat: _dropped, ...withoutSeat } = FIXTURE_PROVENANCE;
  assert.ok(
    !validateEvidenceRecord({ ...record, provenance: withoutSeat }),
    "a provenance block missing the seat was accepted"
  );
  assert.ok(
    !validateEvidenceRecord({ ...record, provenance: { ...FIXTURE_PROVENANCE, deliverySeat: "FIRST_PERSON" } }),
    "an unknown seat was accepted"
  );
});

check("EV-SEAT-C · the seat is INSIDE the hash — two attempts differing only in seat do not collide", () => {
  const third = appendAttempt([], { scenarioId: "n5-01", mode: "G4_BLITZ", provenance: FIXTURE_PROVENANCE }, 100);
  const second = appendAttempt(
    [],
    {
      scenarioId: "n5-01",
      mode: "G4_BLITZ",
      provenance: { ...FIXTURE_PROVENANCE, deliverySeat: "SECOND_PERSON" },
    },
    100
  );
  assert.notStrictEqual(
    (third.log[0] as AttemptRecord).hash,
    (second.log[0] as AttemptRecord).hash,
    "the seat is outside the preimage — a re-seated run would be indistinguishable from the original"
  );
});

check("EV-SEAT-D · the seat still changes no verdict — the grader reads nothing here either", () => {
  const mk = (seat: "THIRD_PERSON" | "SECOND_PERSON") => {
    const { log, ref } = appendAttempt(
      [],
      { scenarioId: "n5-01", mode: "G4_BLITZ", provenance: { ...FIXTURE_PROVENANCE, deliverySeat: seat } },
      100
    );
    return appendOutcome(log, { ref, outcome: "CAPTURED", observables: CLEAN_OBSERVABLES }, 200);
  };
  assert.deepStrictEqual(gradeFromLog(mk("THIRD_PERSON")).verdicts, gradeFromLog(mk("SECOND_PERSON")).verdicts);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── EV-V4 (S132) · a v4 chain is OLD, not BROKEN — and the recognizer is a proof ──");

/** A genuine v4 record: on-schema under v5, no `onWarrant`, hashed under v4. */
const V4_PROVENANCE: AttemptProvenance = {
  subjectId: "mica-subject1",
  basis: "PROCESS_GROUNDED",
  variant: "STRESS",
  seed: 1,
  deliverySeat: "THIRD_PERSON",
};

function v4Chain(): EvidenceLog {
  const out: (AttemptRecord | OutcomeRecord)[] = [];
  let previousHash = "";
  const push = (r: Omit<AttemptRecord, "hash" | "previousHash"> | Omit<OutcomeRecord, "hash" | "previousHash">): void => {
    const unhashed = { ...r, previousHash } as AttemptRecord | OutcomeRecord;
    const hash = computeEvidenceRecordHashUnderV4(unhashed);
    out.push({ ...unhashed, hash });
    previousHash = hash;
  };
  push({ kind: "ATTEMPT", sequenceNumber: 0, timestamp: 100, scenarioId: "s1", mode: "G4_BLITZ", provenance: V4_PROVENANCE } as never);
  push({ kind: "OUTCOME", sequenceNumber: 1, timestamp: 101, ref: 0, outcome: "CAPTURED", observables: CLEAN_OBSERVABLES } as never);
  return out;
}

check("EV-V4a · GOLDEN VECTOR — the v4 preimage is frozen history and cannot drift with the live tables", () => {
  // THE WHOLE POINT OF THIS LINE. `computeEvidenceRecordHashUnderV4` reuses the
  // live field tables for the six classes v4 and v5 share. That is deliberate —
  // eighty lines of duplicated writers would rot differently — but it means a
  // later change to ANY of those tables silently moves the v4 arithmetic too,
  // and the recognizer would start calling v5 chains v4. This hardcoded digest
  // is what turns that into a red suite. If it goes red, the v4 recognizer is
  // wrong, not this number.
  const record: Omit<AttemptRecord, "hash"> = {
    kind: "ATTEMPT",
    sequenceNumber: 0,
    previousHash: "",
    timestamp: 100,
    scenarioId: "s1",
    mode: "G4_BLITZ",
    provenance: V4_PROVENANCE,
  };
  assert.strictEqual(
    computeEvidenceRecordHashUnderV4(record),
    "c4944916363d2fc8c65402c5bc0d6fa8a04eee3acfcff2f729fa87a0d49459e6",
    "the v4 ATTEMPT preimage moved"
  );
  const outcome: Omit<OutcomeRecord, "hash"> = {
    kind: "OUTCOME",
    sequenceNumber: 1,
    previousHash: "",
    timestamp: 101,
    ref: 0,
    outcome: "CAPTURED",
    observables: CLEAN_OBSERVABLES,
  };
  assert.strictEqual(
    computeEvidenceRecordHashUnderV4(outcome),
    "1ee3f437503659f082c5efadfdc9708a657c940cc18195b768b916b4ba41b0f2",
    "the v4 OUTCOME preimage moved"
  );
  // And it is a DIFFERENT arithmetic from the live one, or it recognizes nothing.
  assert.notStrictEqual(computeEvidenceRecordHashUnderV4(record), computeEvidenceRecordHash(record));
});

check("EV-V4b · a whole v4 chain is recognized; a v5 chain and an empty one are not", () => {
  const v4 = v4Chain();
  // It really is a v4 chain: it does NOT verify under the live reader.
  assert.strictEqual(verifyEvidenceChain(v4).valid, false);
  assert.strictEqual(verifyEvidenceChain(v4).brokenAt, 0, "a v4 chain fails at index 0, as the S126 block says");
  assert.strictEqual(recognizeSupersededChainByRederivation(v4), SUPERSEDED_EVIDENCE_DOMAIN_TAG_V4);

  // A LIVE v5 CHAIN IS NOT HISTORY. The recognizer must never fire on one.
  const attempt = appendAttempt([], { scenarioId: "s1", mode: "G4_BLITZ", provenance: V4_PROVENANCE }, 100);
  const v5 = appendOutcome(attempt.log, { ref: attempt.ref, outcome: "CAPTURED", observables: CLEAN_OBSERVABLES }, 101);
  assert.strictEqual(verifyEvidenceChain(v5).valid, true);
  assert.strictEqual(recognizeSupersededChainByRederivation(v5), null);

  // NOTHING IS NOT OLD. An empty chain was not written under anything.
  assert.strictEqual(recognizeSupersededChainByRederivation([]), null);
});

check("EV-V4c · NEGATIVE CONTROL — a TAMPERED chain stays a BREAK under both tags", () => {
  // The failure this recognizer must not introduce: a tampered v5 chain talked
  // into presenting as history, which would launder a tamper into "it's just
  // old". One record edited is enough — it re-derives under neither tag.
  const v4 = v4Chain();
  const tampered: EvidenceLog = [v4[0], { ...(v4[1] as OutcomeRecord), timestamp: 999 }];
  assert.strictEqual(recognizeSupersededChainByRederivation(tampered), null);
  assert.strictEqual(verifyEvidenceChain(tampered).valid, false);

  // A chain whose LINKS were re-pointed is also not history, even if every
  // record's own hash re-derives: the recognizer checks the links too.
  const relinked: EvidenceLog = [v4[0], { ...(v4[1] as OutcomeRecord), previousHash: "0".repeat(64) }];
  assert.strictEqual(recognizeSupersededChainByRederivation(relinked), null);

  // And a HALF-v4 chain — one v4 record, one v5 — is neither. Whole chain or nothing.
  const v5 = appendAttempt([], { scenarioId: "s1", mode: "G4_BLITZ", provenance: V4_PROVENANCE }, 100).log;
  assert.strictEqual(recognizeSupersededChainByRederivation([v4[0], v5[0]]), null);
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
