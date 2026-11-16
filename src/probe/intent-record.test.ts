// ── MICA · intent-record wire — acceptance tests ──────────────────────────────

import assert from "assert";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { PrecommitBook } from "../precommit/precommit";
import {
  emptyRuleIntentRegistry,
  findRuleIntentOnChain,
  INTENT_RECORD_CLASS_FIELD,
  prepareInvocationBasisSeal,
  prepareRuleIntentSeal,
  readIntentRecordClass,
  instantiateRuleIntent,
  IntentRecordRefused,
  isSubScopeExportingWiderHarm,
  parseInvocationBasisContent,
  parseRuleIntentContent,
  revealInvocationBasis,
  revealRuleIntent,
  sealInvocationBasis,
  sealRuleIntent,
  THE_WIRE_PRICES_TIMING_NOT_TRUTH,
  type RuleIntentContent,
  type ScopeComparison,
} from "./intent-record";

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

function ruleIntent(over: Partial<RuleIntentContent> = {}): RuleIntentContent {
  return {
    ruleId: "no-clerk-scope-widening",
    declaredProtectivePurpose:
      "prevents the clerk's write authority from being widened beyond the store it was granted",
    namedFailureModes: ["store-scope creep", "silent authority widening"],
    scopeFrameRef: "scope-frame-clerk-authority-v1",
    ...over,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the rule-intent record — authored once, instantiated, never regenerated ──");

check("IR-A · sealRuleIntent seals and instantiateRuleIntent reads it back unchanged", () => {
  const book = new PrecommitBook();
  const { registry } = sealRuleIntent(
    emptyRuleIntentRegistry(),
    book,
    ruleIntent(),
    "gate5-authoring-seat",
    1000,
    "OFFERED"
  );
  const instantiated = instantiateRuleIntent(registry, "no-clerk-scope-widening");
  assert.deepStrictEqual(instantiated, ruleIntent());
});

check("IR-B · the registry is threaded, never mutated — the argument registry stays empty", () => {
  const book = new PrecommitBook();
  const before = emptyRuleIntentRegistry();
  sealRuleIntent(before, book, ruleIntent(), "seat", 1000, "OFFERED");
  assert.strictEqual(before.size, 0, "sealRuleIntent must not mutate the registry it was given");
});

check("IR-C · re-sealing an already-present ruleId is refused — authored ONCE", () => {
  const book = new PrecommitBook();
  const { registry } = sealRuleIntent(
    emptyRuleIntentRegistry(),
    book,
    ruleIntent(),
    "seat",
    1000,
    "OFFERED"
  );
  assert.throws(
    () =>
      sealRuleIntent(
        registry,
        book,
        ruleIntent({ declaredProtectivePurpose: "a rewritten purpose" }),
        "seat",
        2000,
        "OFFERED"
      ),
    IntentRecordRefused
  );
});

check("IR-D · instantiateRuleIntent on an unsealed ruleId returns undefined, never a default", () => {
  const registry = emptyRuleIntentRegistry();
  assert.strictEqual(instantiateRuleIntent(registry, "never-sealed"), undefined);
});

check("IR-E · revealRuleIntent puts the plaintext in the chain and reads back MATCH", () => {
  const book = new PrecommitBook();
  const { result } = sealRuleIntent(
    emptyRuleIntentRegistry(),
    book,
    ruleIntent(),
    "seat",
    1000,
    "OFFERED"
  );
  const revealOutcome = revealRuleIntent(book, result, 1500, "OFFERED");
  assert.strictEqual(revealOutcome.record.sealCheck, "MATCH");
  assert.ok(
    revealOutcome.record.sequenceNumber > result.reference.commitmentRef,
    "the reveal must sit after the commitment it reveals"
  );
  const readBack = parseRuleIntentContent(revealOutcome.record.plaintext.predictedValue);
  assert.deepStrictEqual(readBack, ruleIntent());
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the invocation-basis record — pre-outcome, references the intent record ──");

const SCOPE: ScopeComparison = { benefitedCircle: "WIDER_CIRCLE", harmedCircle: "SUB_SCOPE" };

check("IB-A · sealInvocationBasis against a sealed rule succeeds and references it by commitmentRef", () => {
  const book = new PrecommitBook();
  const { registry, result: intentResult } = sealRuleIntent(
    emptyRuleIntentRegistry(),
    book,
    ruleIntent(),
    "authoring-seat",
    1000,
    "OFFERED"
  );
  const outcome = sealInvocationBasis(
    registry,
    book,
    "no-clerk-scope-widening",
    "following the rule here would let a compromised host read the key file off disk",
    SCOPE,
    "invoking-seat",
    2000,
    "IMPOSED"
  );
  assert.strictEqual(outcome.kind, "SEALED");
  if (outcome.kind !== "SEALED") return;
  const content = parseInvocationBasisContent(outcome.result.envelope.predictedValue);
  assert.strictEqual(content.ruleIntentRef.commitmentRef, intentResult.reference.commitmentRef);
  assert.strictEqual(content.ruleIntentRef.ruleId, "no-clerk-scope-widening");
});

check("IB-B · sealInvocationBasis against an unanchored rule is REFUSED into NO_ANCHOR_ESCALATE, never sealed", () => {
  const book = new PrecommitBook();
  const before = book.getAll().length;
  const outcome = sealInvocationBasis(
    emptyRuleIntentRegistry(),
    book,
    "rule-with-no-declared-intent",
    "claiming a basis anyway",
    SCOPE,
    "invoking-seat",
    2000,
    "IMPOSED"
  );
  assert.strictEqual(outcome.kind, "NO_ANCHOR_ESCALATE");
  if (outcome.kind === "NO_ANCHOR_ESCALATE") {
    assert.strictEqual(outcome.ruleId, "rule-with-no-declared-intent");
  }
  assert.strictEqual(book.getAll().length, before, "the book must not be touched on the no-anchor route");
});

check("IB-C · revealInvocationBasis puts the plaintext in the chain and reads back MATCH", () => {
  const book = new PrecommitBook();
  const { registry } = sealRuleIntent(emptyRuleIntentRegistry(), book, ruleIntent(), "seat", 1000, "OFFERED");
  const outcome = sealInvocationBasis(
    registry,
    book,
    "no-clerk-scope-widening",
    "basis text",
    SCOPE,
    "invoking-seat",
    2000,
    "IMPOSED"
  );
  assert.strictEqual(outcome.kind, "SEALED");
  if (outcome.kind !== "SEALED") return;
  const revealOutcome = revealInvocationBasis(book, outcome.result, 2500, "IMPOSED");
  assert.strictEqual(revealOutcome.record.sealCheck, "MATCH");
  assert.ok(revealOutcome.record.sequenceNumber > outcome.result.reference.commitmentRef);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the scope comparison — Pole-B by construction (06a §3) ──");

check("SC-A · sub-scope benefit exporting wider harm reads true", () => {
  assert.strictEqual(
    isSubScopeExportingWiderHarm({ benefitedCircle: "SUB_SCOPE", harmedCircle: "WIDER_CIRCLE" }),
    true
  );
});

check("SC-B · every other combination reads false", () => {
  assert.strictEqual(
    isSubScopeExportingWiderHarm({ benefitedCircle: "WIDER_CIRCLE", harmedCircle: "SUB_SCOPE" }),
    false
  );
  assert.strictEqual(
    isSubScopeExportingWiderHarm({ benefitedCircle: "SUB_SCOPE", harmedCircle: "SUB_SCOPE" }),
    false
  );
  assert.strictEqual(
    isSubScopeExportingWiderHarm({ benefitedCircle: "WIDER_CIRCLE", harmedCircle: "WIDER_CIRCLE" }),
    false
  );
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the printed ceiling ──");

check("CEIL-A · THE_WIRE_PRICES_TIMING_NOT_TRUTH is exported, non-empty, and states the limit", () => {
  assert.ok(THE_WIRE_PRICES_TIMING_NOT_TRUTH.length > 0);
  assert.ok(THE_WIRE_PRICES_TIMING_NOT_TRUTH.includes("NEVER"));
  assert.ok(THE_WIRE_PRICES_TIMING_NOT_TRUTH.includes("retro-rationalization"));
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── S116 · the declared class, and authored-once as a fact about the BOOK ──");

const SALT = "s116-intent-record-fixture-salt-0123456";

function bookPath(tag: string): string {
  return join(mkdtempSync(join(tmpdir(), `s116-ir-${tag}-`)), "book.jsonl");
}

/** Seal a rule intent AND reveal it, which is what makes it scannable. */
function authorOnChain(path: string, content = ruleIntent()): PrecommitBook {
  const book = new PrecommitBook({ path });
  const { result } = sealRuleIntent(
    emptyRuleIntentRegistry(), book, content, "authoring-seat", 1000, "OFFERED", SALT
  );
  revealRuleIntent(book, result, 1500, "OFFERED");
  return book;
}

check("S116-A · the sealed plaintext DECLARES its class, and the parser hands back only the authored content", () => {
  const book = new PrecommitBook();
  const { result } = sealRuleIntent(
    emptyRuleIntentRegistry(), book, ruleIntent(), "seat", 1000, "OFFERED", SALT
  );
  const pv = result.envelope.predictedValue;
  assert.strictEqual(readIntentRecordClass(pv), "RULE_INTENT");
  assert.ok(JSON.parse(pv)[INTENT_RECORD_CLASS_FIELD] === "RULE_INTENT");
  // The stamp is the wire's, not the author's: it does not come back out.
  assert.deepStrictEqual(parseRuleIntentContent(pv), ruleIntent());
  assert.ok(!(INTENT_RECORD_CLASS_FIELD in (parseRuleIntentContent(pv) as object)));
});

check("S116-B · an invocation basis declares its own, different class", () => {
  const book = new PrecommitBook();
  const { registry } = sealRuleIntent(
    emptyRuleIntentRegistry(), book, ruleIntent(), "seat", 1000, "OFFERED", SALT
  );
  const out = sealInvocationBasis(
    registry, book, "no-clerk-scope-widening", "a basis", SCOPE, "seat2", 2000, "IMPOSED", SALT
  );
  assert.strictEqual(out.kind, "SEALED");
  if (out.kind !== "SEALED") return;
  assert.strictEqual(readIntentRecordClass(out.result.envelope.predictedValue), "INVOCATION_BASIS");
});

check("S116-C · findRuleIntentOnChain reads a REVEALED rule intent, and skips a MISMATCHed one", () => {
  const path = bookPath("scan");
  const book = authorOnChain(path);
  const found = findRuleIntentOnChain(book.getAll(), "no-clerk-scope-widening");
  assert.ok(found !== null, "a revealed rule intent was not found on the chain");
  assert.strictEqual(found.reference.ruleId, "no-clerk-scope-widening");
  assert.strictEqual(found.reference.committerId, "authoring-seat");
  assert.strictEqual(found.content.scopeFrameRef, ruleIntent().scopeFrameRef);
  assert.strictEqual(findRuleIntentOnChain(book.getAll(), "some-other-rule"), null);

  // A reveal the book itself scored MISMATCH proves nothing about what was
  // sealed, and must not be able to block a later honest seal.
  const mismatched = book.getAll().map((r) =>
    r.kind === "REVEAL" ? { ...r, sealCheck: "MISMATCH" as const } : r
  );
  assert.strictEqual(findRuleIntentOnChain(mismatched, "no-clerk-scope-widening"), null);
});

check("S116-D · THE DURABLE AUTHORED-ONCE — a FRESH book on the same path refuses the second seal", () => {
  const path = bookPath("authored-once");
  authorOnChain(path);

  // A new process: a new book object on the same file, and an EMPTY registry,
  // which is exactly what a restart, a second operator or the registrar route
  // each begins with.
  const fresh = new PrecommitBook({ path });
  assert.strictEqual(fresh.getLoadState(), "LOADED_VERIFIED");
  const before = fresh.getAll().length;
  let refused: unknown = null;
  try {
    sealRuleIntent(emptyRuleIntentRegistry(), fresh, ruleIntent(), "another-seat", 3000, "OFFERED", SALT);
  } catch (err) {
    refused = err;
  }
  assert.ok(refused instanceof IntentRecordRefused, `expected IntentRecordRefused, got ${String(refused)}`);
  assert.ok((refused as Error).message.includes("ON THIS CHAIN"), (refused as Error).message);
  assert.strictEqual(fresh.getAll().length, before, "the refused seal appended anyway");
});

check("S116-E · a fresh process seals an invocation basis against an anchor found on the CHAIN", () => {
  const path = bookPath("chain-anchor");
  authorOnChain(path);
  const fresh = new PrecommitBook({ path });
  const prepared = prepareInvocationBasisSeal(
    emptyRuleIntentRegistry(), fresh, "no-clerk-scope-widening",
    "following the rule here would strand the operator", SCOPE, "invoking-seat", 4000, SALT
  );
  assert.strictEqual(prepared.kind, "PREPARED");
  if (prepared.kind !== "PREPARED") return;
  assert.strictEqual(prepared.anchorSource, "CHAIN");
  assert.strictEqual(prepared.anchor.committerId, "authoring-seat");
  assert.strictEqual(readIntentRecordClass(prepared.expectation.predictedValue), "INVOCATION_BASIS");
});

check("S116-F · a book that loaded CANNOT_VERIFY refuses BOTH prepares — never read as 'no prior record'", () => {
  const path = bookPath("cannot-verify");
  writeFileSync(path, "{not json at all\n", "utf8");
  const broken = new PrecommitBook({ path });
  assert.strictEqual(broken.getLoadState(), "CANNOT_VERIFY");
  assert.throws(
    () => prepareRuleIntentSeal(emptyRuleIntentRegistry(), broken, ruleIntent(), "seat", SALT),
    IntentRecordRefused
  );
  assert.throws(
    () =>
      prepareInvocationBasisSeal(
        emptyRuleIntentRegistry(), broken, "any-rule", "a basis", SCOPE, "seat", 1, SALT
      ),
    IntentRecordRefused
  );
});

check("S116-G · the parsers refuse a plaintext that is not this wire's, rather than coercing it", () => {
  assert.throws(() => parseRuleIntentContent("GREEN"), IntentRecordRefused);
  assert.throws(() => parseRuleIntentContent('{"ruleId":"x"}'), IntentRecordRefused);
  assert.throws(() => parseInvocationBasisContent("GREEN"), IntentRecordRefused);
  // Right shape, WRONG class: a rule intent is not an invocation basis.
  const book = new PrecommitBook();
  const { result } = sealRuleIntent(
    emptyRuleIntentRegistry(), book, ruleIntent(), "seat", 1000, "OFFERED", SALT
  );
  assert.throws(
    () => parseInvocationBasisContent(result.envelope.predictedValue),
    IntentRecordRefused
  );
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
