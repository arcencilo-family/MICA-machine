// ── MICA · A9, the pre-commitment path — acceptance tests ────────────────────
//
// What is asserted here is what a sealed commitment actually buys: the plaintext
// is not in the book at seal time, a reveal that does not match its deposit is
// RECORDED rather than swallowed, a committer cannot grade itself, and a
// reference forward in the chain has nothing to resolve to. Three of those four
// were mutation-tested before this file was called green; the fourth is the
// white vest, and it is asserted against the serialized BYTES, not the object.
//
// ── NO FILESYSTEM WHERE MEMORY SUFFICES ──────────────────────────────────────
//
//   Most of this file runs a book with no path at all. A `PrecommitBook` without
//   one is IN_MEMORY, holds the same chain, computes the same hashes and makes
//   the same refusals — a temp directory would buy nothing but a slower test and
//   a fixture to get wrong. Disk appears in exactly four places, each because
//   the property under test IS about disk: the load-and-verify path, the forged
//   book, the deployment act, and the end-to-end anchor into a real Witness.
//
// ── AND NO SHARED FIXTURE PERFORMS A DEPLOYMENT ACT (S97-C specimens 1–2) ────
//
//   The bodies that need a directory make their own, inline, so that the
//   negative test — a book whose directory was never made — cannot be leaning on
//   the same helper that makes the positive case pass. A negative test that
//   depends on the fixture proving the positive one checks nothing.

import assert from "assert";

import { DEPLOYMENT_PATH_PREFIXES } from "../deploy/deployment-paths";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { Witness } from "../witness/witness";
import { fileDropCommitter } from "../witness/drop-committer";
import {
  A_COMMITTER_NEVER_GRADES_ITSELF,
  cannotSeePrecommitMessage,
  lookAtPrecommitFile,
  COMMITMENTS_NEVER_SEEDS,
  computePrecommitRecordHash,
  computeSealHash,
  IMPLEMENTED_TYPES,
  MINIMUM_SALT_LENGTH,
  OFFER_NOT_IMPOSE,
  PRECOMMIT_TITLE,
  PRECOMMIT_TITLE_AS_DESIGNED,
  PrecommitBook,
  PrecommitDeploymentActMissing,
  PrecommitRefused,
  randomSalt,
  SUBMISSION_IS_NOT_RETENTION,
  THE_ANCHOR_IS_THE_ARROW,
  THE_FREE_TEXT_DOOR,
  THE_RESERVED_SLOT_IS_IN_THE_PREIMAGE,
  THE_STORE_LOCATION_IS_UNDESIGNATED,
  validatePrecommitRecord,
} from "./precommit";
import type {
  CommitmentRecord,
  Expectation,
  GradingRecord,
  HeadCommit,
  PrecommitRecord,
  RevealRecord,
} from "./precommit";

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

/** A salt that clears the floor, fixed so a preimage assertion is reproducible. */
const SALT_A = "a".repeat(MINIMUM_SALT_LENGTH);
const SALT_B = "b".repeat(MINIMUM_SALT_LENGTH);

function expectation(over: Partial<Expectation> = {}): Expectation {
  return {
    type: "verdict",
    target: "the 2026-08-31 daily witness report, section 4",
    predictedValue: "the symmetry statement is withheld",
    committerId: "mica-build",
    salt: SALT_A,
    ...over,
  };
}

/** Source with comments removed, so a fence can be about CALLS, not words. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Source with comments AND string literals removed. A fence about calls has to
 * lose the strings too: this module quotes its own API inside the signposts it
 * hands to callers, and a grep that counts those is counting prose.
 */
function codeOnlyNoStrings(source: string): string {
  return codeOnly(source)
    .replace(/"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, " ")
    .replace(/`(?:[^`\\]|\\.)*`/g, " ");
}

function refusalFrom(fn: () => unknown): PrecommitRefused {
  try {
    fn();
  } catch (error) {
    assert.ok(
      error instanceof PrecommitRefused,
      `expected a PrecommitRefused, got ${String(error)}`
    );
    return error as PrecommitRefused;
  }
  throw new Error("expected a refusal and nothing was refused");
}

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the seal · what enters the chain, and what never does ──");

check("PC-A · a sealed commitment carries a hash and a committer id, and chains", () => {
  const book = new PrecommitBook();
  const out = book.seal({
    expectation: expectation(),
    timestamp: 1_700_000_000_000,
    modality: "NOT_AN_INSTRUCTION",
  });

  assert.strictEqual(out.record.kind, "COMMITMENT");
  assert.strictEqual(out.record.sequenceNumber, 0);
  assert.strictEqual(out.record.previousHash, "");
  assert.strictEqual(out.record.committerId, "mica-build");
  assert.strictEqual(out.record.sealed, computeSealHash(expectation()));
  assert.strictEqual(out.record.modality, "NOT_AN_INSTRUCTION");
  assert.deepStrictEqual(book.verify(), { valid: true, brokenAt: null });
  // In memory: integrity, and honestly no provenance.
  assert.strictEqual(out.persisted, false);
  assert.strictEqual(book.getLoadState(), "IN_MEMORY");
  assert.ok((out.detail ?? "").includes("IN MEMORY"));
});

check("PC-B · THE WHITE VEST — no part of the plaintext is in the serialized record", () => {
  // Asserted against BYTES, not the object. A field that is undefined on the
  // type but present on the value would pass an object check and still ship the
  // secret; JSON.stringify is what actually reaches disk.
  const e = expectation({
    target: "TARGET-SENTINEL-8f2a",
    predictedValue: "VALUE-SENTINEL-51cc",
    salt: `SALT-SENTINEL-b703${"z".repeat(MINIMUM_SALT_LENGTH)}`,
  });
  const book = new PrecommitBook();
  const out = book.seal({
    expectation: e,
    timestamp: 5,
    modality: "OFFERED",
  });

  const line = JSON.stringify(out.record);
  assert.ok(!line.includes("TARGET-SENTINEL-8f2a"), "the target reached the chain");
  assert.ok(!line.includes("VALUE-SENTINEL-51cc"), "the predicted value reached the chain");
  assert.ok(!line.includes("SALT-SENTINEL-b703"), "the salt reached the chain");
  assert.ok(!line.includes("verdict"), "the expectation type reached the chain");
  assert.ok(!line.includes("target"), "a `target` key reached the chain");
  assert.ok(!line.includes("plaintext"), "a `plaintext` key reached the chain");
  assert.deepStrictEqual(Object.keys(out.record).sort(), [
    "committerId",
    "hash",
    "kind",
    "modality",
    "previousHash",
    "sealed",
    "sequenceNumber",
    "timestamp",
  ]);
});

check("PC-C · the envelope comes BACK to the committer, because nothing stored it", () => {
  const e = expectation();
  const book = new PrecommitBook();
  const out = book.seal({ expectation: e, timestamp: 5, modality: "OFFERED" });

  assert.deepStrictEqual(out.envelope, e);
  assert.ok(COMMITMENTS_NEVER_SEEDS.includes("never the seed"));
});

check("PC-D · the salt is load-bearing: same claim, different salt, different seal", () => {
  const one = computeSealHash(expectation({ salt: SALT_A }));
  const two = computeSealHash(expectation({ salt: SALT_B }));
  assert.notStrictEqual(one, two);
  // And the seal is deterministic, or a committer could not reproduce it.
  assert.strictEqual(one, computeSealHash(expectation({ salt: SALT_A })));
});

check("PC-E · every sealed field moves the seal — none is decoration", () => {
  const base = computeSealHash(expectation());
  const moved = [
    expectation({ type: "hash" }),
    expectation({ target: "something else entirely" }),
    expectation({ predictedValue: "the symmetry statement is made" }),
    expectation({ committerId: "mica-doctor" }),
    expectation({ salt: SALT_B }),
  ];
  for (const e of moved) {
    assert.notStrictEqual(
      computeSealHash(e),
      base,
      `a change to this expectation did not move the seal: ${JSON.stringify(e)}`
    );
  }
});

check("PC-F · the seal preimage is LENGTH-PREFIXED — content cannot slide across fields", () => {
  // MUTATION-CORRECTED. This body first read `{target:"ab", predictedValue:"cd"}`
  // against `{target:"a", predictedValue:"bcd"}` and passed — but it passed
  // because the UNIT SEPARATOR was still between the fields, not because of the
  // length prefixes. Removing every `lengthPrefixed` from the seal preimage left
  // that version green. It asserted the right property about the wrong mechanism.
  //
  // The prefixes earn their place only when the CONTENT can carry a separator.
  // These two expectations produce the identical separator-joined byte string
  // and are told apart by nothing but the lengths.
  const US = "\u001f";
  const left = computeSealHash(
    expectation({ target: `a${US}b`, predictedValue: "c" })
  );
  const right = computeSealHash(
    expectation({ target: "a", predictedValue: `b${US}c` })
  );
  assert.notStrictEqual(
    left,
    right,
    "a separator inside a field moved content across a field boundary"
  );
});

check("PC-G · the seal is DOMAIN-SEPARATED from the chain hash", () => {
  const book = new PrecommitBook();
  const out = book.seal({ expectation: expectation(), timestamp: 5, modality: "OFFERED" });
  assert.notStrictEqual(out.record.hash, out.record.sealed);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the free-text door · reserved, refused, and quoted (ruling 1) ──");

check("PC-H · `claim+rule` is REFUSED, and the refusal quotes the design note", () => {
  const book = new PrecommitBook();
  const refusal = refusalFrom(() =>
    book.seal({
      expectation: expectation({ type: "claim+rule" }),
      timestamp: 5,
      modality: "OFFERED",
    })
  );

  assert.ok(refusal.signpost.includes("DOOR, not a room"));
  assert.ok(refusal.signpost.includes("ARC_MICA-NOTE_A9-Precommit-Design_20260831-98.md"));
  assert.ok(refusal.signpost.includes("fill this room yourself"));
  assert.strictEqual(refusal.signpost, THE_FREE_TEXT_DOOR);
  // Refused means NOTHING WAS WRITTEN. A door that logs what it turned away is
  // a door that lets the claim in.
  assert.strictEqual(book.length, 0);
});

check("PC-I · a `gradingRule` is refused even on an IMPLEMENTED type", () => {
  const book = new PrecommitBook();
  const refusal = refusalFrom(() =>
    book.seal({
      expectation: expectation({ type: "verdict", gradingRule: "grader decides" }),
      timestamp: 5,
      modality: "OFFERED",
    })
  );
  assert.strictEqual(refusal.signpost, THE_FREE_TEXT_DOOR);
  assert.strictEqual(book.length, 0);
  assert.deepStrictEqual([...IMPLEMENTED_TYPES], ["verdict", "hash"]);
});

check("PC-J · the reserved slot IS in the seal preimage, empty and waiting", () => {
  // The v1 seal and a hypothetical v2 seal of the same claim differ, which is
  // only true if the field has a slot. That is the property that lets a later
  // version fill the room without rewriting a single seal taken before it.
  const v1 = computeSealHash(expectation());
  const v2 = computeSealHash({ ...expectation(), gradingRule: "read §4 at bytes" });
  assert.notStrictEqual(v1, v2);
  // And an EXPLICIT empty rule is the same as no rule: the default is the slot's
  // value, not a second encoding of it.
  assert.strictEqual(computeSealHash({ ...expectation(), gradingRule: "" }), v1);
  assert.ok(THE_RESERVED_SLOT_IS_IN_THE_PREIMAGE.includes("Do not remove it"));
});

check("PC-K · an unknown type is refused and names what v1 implements", () => {
  const book = new PrecommitBook();
  const refusal = refusalFrom(() =>
    book.seal({
      expectation: expectation({ type: "prophecy" as never }),
      timestamp: 5,
      modality: "OFFERED",
    })
  );
  assert.ok(refusal.signpost.includes("verdict, hash"));
  assert.strictEqual(book.length, 0);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the salt floor · a house bar, and it is loud ──");

check("PC-L · a salt below the floor is refused, naming both numbers", () => {
  const book = new PrecommitBook();
  const refusal = refusalFrom(() =>
    book.seal({
      expectation: expectation({ salt: "x" }),
      timestamp: 5,
      modality: "OFFERED",
    })
  );
  assert.ok(refusal.message.includes("1 characters"));
  assert.ok(refusal.message.includes(String(MINIMUM_SALT_LENGTH)));
  assert.ok(refusal.signpost.includes("hides nothing"));
  assert.strictEqual(book.length, 0);
});

check("PC-M · `randomSalt()` clears the floor, and the module never calls it", () => {
  assert.ok(randomSalt().length >= MINIMUM_SALT_LENGTH);
  assert.notStrictEqual(randomSalt(), randomSalt());
  // NO call site anywhere in the module: the committer makes its own salt,
  // because the committer has to be able to reproduce its own seal. Counted over
  // source with comments and STRINGS removed — the module quotes `randomSalt()`
  // inside a refusal signpost, and a fence that counted that would be counting
  // prose. (It did, on the first run of this body, and said 2.)
  const source = codeOnlyNoStrings(
    readFileSync(join(__dirname, "precommit.ts"), "utf8")
  );
  const declaration = "export function randomSalt(): string";
  // The DECLARATION contains the literal `randomSalt()` too — `randomSalt():`
  // ends in exactly those characters — so it comes out before anything is
  // counted. Asserting it was there first is what keeps this a fence over
  // something real rather than a grep that passes because the name changed.
  assert.ok(source.includes(declaration), "randomSalt is no longer declared");
  const calls = source.replace(declaration, " ").split("randomSalt()").length - 1;
  assert.strictEqual(calls, 0, "randomSalt is called from inside the module");
});

check("PC-N · an empty committer id and an empty target are both refused", () => {
  const book = new PrecommitBook();
  refusalFrom(() =>
    book.seal({
      expectation: expectation({ committerId: "" }),
      timestamp: 5,
      modality: "OFFERED",
    })
  );
  refusalFrom(() =>
    book.seal({
      expectation: expectation({ target: "" }),
      timestamp: 5,
      modality: "OFFERED",
    })
  );
  assert.strictEqual(book.length, 0);
  // But an EMPTY PREDICTED VALUE is a prediction and is accepted.
  const out = book.seal({
    expectation: expectation({ predictedValue: "" }),
    timestamp: 5,
    modality: "OFFERED",
  });
  assert.strictEqual(out.record.sequenceNumber, 0);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the reveal · a mismatch is RECORDED, never swallowed ──");

check("PC-O · a matching reveal records MATCH and puts the plaintext in the chain", () => {
  const e = expectation();
  const book = new PrecommitBook();
  book.seal({ expectation: e, timestamp: 1, modality: "OFFERED" });
  const out = book.reveal({ ref: 0, expectation: e, timestamp: 2, modality: "OFFERED" });

  assert.strictEqual(out.record.kind, "REVEAL");
  assert.strictEqual(out.record.ref, 0);
  assert.strictEqual(out.record.sealCheck, "MATCH");
  assert.strictEqual(out.record.recomputed, computeSealHash(e));
  assert.deepStrictEqual(out.record.plaintext, {
    type: e.type,
    target: e.target,
    predictedValue: e.predictedValue,
    committerId: e.committerId,
    salt: e.salt,
  });
  // NOW the content is in the book, and NOW rewriting it breaks the chain.
  assert.deepStrictEqual(book.verify(), { valid: true, brokenAt: null });
});

check("PC-P · A REVEAL THAT DOES NOT MATCH IS RECORDED, LOUDLY, AND NOT REJECTED", () => {
  // Somebody changing their story is the single most interesting thing that can
  // happen to this instrument. Silence is never safety.
  const sealedClaim = expectation({ predictedValue: "the report says A" });
  const changedStory = expectation({ predictedValue: "the report says B" });
  const book = new PrecommitBook();
  book.seal({ expectation: sealedClaim, timestamp: 1, modality: "OFFERED" });

  const out = book.reveal({
    ref: 0,
    expectation: changedStory,
    timestamp: 2,
    modality: "OFFERED",
  });

  assert.strictEqual(out.record.sealCheck, "MISMATCH");
  assert.strictEqual(book.length, 2, "the mismatching reveal was not retained");
  // The recomputed hash rides along beside the deposit, so a reader can see the
  // two numbers without rerunning any code.
  const commitment = book.getAll()[0];
  assert.strictEqual(commitment.kind, "COMMITMENT");
  assert.notStrictEqual(out.record.recomputed, (commitment as { sealed: string }).sealed);
  assert.strictEqual(out.record.recomputed, computeSealHash(changedStory));
  assert.deepStrictEqual(book.verify(), { valid: true, brokenAt: null });
});

check("PC-Q · a reveal differing ONLY in the salt still mismatches", () => {
  const book = new PrecommitBook();
  book.seal({ expectation: expectation({ salt: SALT_A }), timestamp: 1, modality: "OFFERED" });
  const out = book.reveal({
    ref: 0,
    expectation: expectation({ salt: SALT_B }),
    timestamp: 2,
    modality: "OFFERED",
  });
  assert.strictEqual(out.record.sealCheck, "MISMATCH");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── THE ARROW · the cheat, attempted four ways (the [LB] property) ──");

check("PC-R · THE CHEAT 1 — a reveal referencing a seq that does not exist yet", () => {
  const book = new PrecommitBook();
  const refusal = refusalFrom(() =>
    book.reveal({ ref: 0, expectation: expectation(), timestamp: 1, modality: "OFFERED" })
  );
  assert.ok(refusal.message.includes("holds 0 record(s)"));
  assert.ok(refusal.signpost.includes("POST-DATE"));
  assert.strictEqual(book.length, 0, "a refused cheat left a trace");
});

check("PC-S · THE CHEAT 2 — a grading referencing the seq the grading itself would take", () => {
  const book = new PrecommitBook();
  book.seal({ expectation: expectation(), timestamp: 1, modality: "OFFERED" });
  // The book holds one record; the next record will be seq 1. Naming seq 1 is
  // naming yourself, which is the tidiest possible forward reference.
  const refusal = refusalFrom(() =>
    book.grade({
      ref: 1,
      graderId: "mica-doctor",
      verdict: "GREEN",
      ground: "graded a commitment that will not exist until I exist",
      timestamp: 2,
      modality: "OFFERED",
    })
  );
  assert.ok(refusal.message.includes("names ref 1"));
  assert.strictEqual(book.length, 1);
});

check("PC-T · THE CHEAT 3 — a reveal naming a seq far past the end of the chain", () => {
  const book = new PrecommitBook();
  book.seal({ expectation: expectation(), timestamp: 1, modality: "OFFERED" });
  refusalFrom(() =>
    book.reveal({ ref: 999, expectation: expectation(), timestamp: 2, modality: "OFFERED" })
  );
  refusalFrom(() =>
    book.reveal({ ref: -1, expectation: expectation(), timestamp: 2, modality: "OFFERED" })
  );
  refusalFrom(() =>
    book.reveal({ ref: 0.5, expectation: expectation(), timestamp: 2, modality: "OFFERED" })
  );
  assert.strictEqual(book.length, 1);
});

check("PC-U · THE CHEAT 4 — referring to a REVEAL or a GRADING instead of a deposit", () => {
  const e = expectation();
  const book = new PrecommitBook();
  book.seal({ expectation: e, timestamp: 1, modality: "OFFERED" });
  book.reveal({ ref: 0, expectation: e, timestamp: 2, modality: "OFFERED" });
  book.grade({
    ref: 0,
    graderId: "mica-doctor",
    verdict: "GREEN",
    ground: "read the field at bytes",
    timestamp: 3,
    modality: "OFFERED",
  });

  const onReveal = refusalFrom(() =>
    book.grade({
      ref: 1,
      graderId: "mica-doctor",
      verdict: "GREEN",
      ground: "grading a reveal",
      timestamp: 4,
      modality: "OFFERED",
    })
  );
  assert.ok(onReveal.message.includes("which is a REVEAL"));
  const onGrading = refusalFrom(() =>
    book.reveal({ ref: 2, expectation: e, timestamp: 4, modality: "OFFERED" })
  );
  assert.ok(onGrading.message.includes("which is a GRADING"));
  assert.strictEqual(book.length, 3);
});

check("PC-V · over a mixed book, EVERY accepted ref is strictly below its own seq", () => {
  const book = new PrecommitBook();
  const first = expectation({ predictedValue: "one" });
  const second = expectation({ predictedValue: "two" });
  book.seal({ expectation: first, timestamp: 1, modality: "OFFERED" });
  book.seal({ expectation: second, timestamp: 2, modality: "IMPOSED" });
  book.reveal({ ref: 0, expectation: first, timestamp: 3, modality: "OFFERED" });
  book.grade({
    ref: 1,
    graderId: "mica-arbiter",
    verdict: "CANNOT_ASSESS",
    ground: "not revealed yet",
    timestamp: 4,
    modality: "IMPOSED",
  });
  book.grade({
    ref: 0,
    graderId: "mica-doctor",
    verdict: "RED",
    ground: "the field did not read as predicted",
    timestamp: 5,
    modality: "OFFERED",
  });

  for (const record of book.getAll()) {
    if (record.kind === "COMMITMENT") continue;
    assert.ok(
      record.ref < record.sequenceNumber,
      `record ${String(record.sequenceNumber)} refers to ${String(record.ref)}`
    );
  }
  assert.deepStrictEqual(book.verify(), { valid: true, brokenAt: null });
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── grading · nobody grades themselves, and disagreement is kept (ruling 4) ──");

check("PC-W · a grader who is not the committer is recorded with its ground", () => {
  const book = new PrecommitBook();
  book.seal({ expectation: expectation(), timestamp: 1, modality: "OFFERED" });
  const out = book.grade({
    ref: 0,
    graderId: "mica-doctor",
    verdict: "GREEN",
    ground: "§4 of the report reads exactly as the reveal predicted",
    timestamp: 2,
    modality: "OFFERED",
  });

  assert.strictEqual(out.record.kind, "GRADING");
  assert.strictEqual(out.record.graderId, "mica-doctor");
  assert.strictEqual(out.record.verdict, "GREEN");
  assert.strictEqual(out.record.ref, 0);
});

check("PC-X · SELF-GRADING IS REFUSED, and the refusal names the design note", () => {
  const book = new PrecommitBook();
  book.seal({
    expectation: expectation({ committerId: "mica-build" }),
    timestamp: 1,
    modality: "OFFERED",
  });
  const refusal = refusalFrom(() =>
    book.grade({
      ref: 0,
      graderId: "mica-build",
      verdict: "GREEN",
      ground: "I graded myself and I passed",
      timestamp: 2,
      modality: "OFFERED",
    })
  );

  assert.ok(refusal.message.includes("may not grade its own commitment"));
  assert.ok(refusal.signpost.includes("ARC_MICA-NOTE_A9-Precommit-Design_20260831-98.md"));
  assert.ok(refusal.signpost.includes("ruling 4"));
  assert.strictEqual(book.length, 1, "a refused self-grading left a trace");
});

check("PC-Y · two graders who DISAGREE are both recorded, and nothing resolves them", () => {
  const book = new PrecommitBook();
  book.seal({ expectation: expectation(), timestamp: 1, modality: "OFFERED" });
  book.grade({
    ref: 0,
    graderId: "mica-doctor",
    verdict: "GREEN",
    ground: "the substring is present",
    timestamp: 2,
    modality: "NOT_AN_INSTRUCTION",
  });
  book.grade({
    ref: 0,
    graderId: "mica-arbiter",
    verdict: "RED",
    ground: "present, but in the wrong section",
    timestamp: 3,
    modality: "IMPOSED",
  });

  const gradings = book.getAll().filter((r) => r.kind === "GRADING");
  assert.strictEqual(gradings.length, 2);
  assert.deepStrictEqual(
    gradings.map((g) => (g as { verdict: string }).verdict),
    ["GREEN", "RED"]
  );
  // There is no resolved verdict anywhere, and there must never be one.
  assert.strictEqual(book.length, 3);
  assert.ok(A_COMMITTER_NEVER_GRADES_ITSELF.includes("PRESERVED, never resolved"));
});

check("PC-Z · a grading with no ground, or a ground that is not one line, is refused", () => {
  const book = new PrecommitBook();
  book.seal({ expectation: expectation(), timestamp: 1, modality: "OFFERED" });
  refusalFrom(() =>
    book.grade({
      ref: 0,
      graderId: "mica-doctor",
      verdict: "GREEN",
      ground: "",
      timestamp: 2,
      modality: "OFFERED",
    })
  );
  const multiline = refusalFrom(() =>
    book.grade({
      ref: 0,
      graderId: "mica-doctor",
      verdict: "GREEN",
      ground: "first line\nsecond line",
      timestamp: 2,
      modality: "OFFERED",
    })
  );
  assert.ok(multiline.signpost.includes("one line"));
  refusalFrom(() =>
    book.grade({
      ref: 0,
      graderId: "",
      verdict: "GREEN",
      ground: "anonymous",
      timestamp: 2,
      modality: "OFFERED",
    })
  );
  refusalFrom(() =>
    book.grade({
      ref: 0,
      graderId: "mica-doctor",
      verdict: "MOSTLY_FINE" as never,
      ground: "a fourth verdict",
      timestamp: 2,
      modality: "OFFERED",
    })
  );
  assert.strictEqual(book.length, 1);
});

check("PC-AA · a grading BEFORE any reveal is legal, and the state is readable", () => {
  // Show, do not enforce. A grader who has not seen the plaintext is grading
  // something they cannot have read — a finding for a READER of the book, not a
  // thing for the book to forbid. CANNOT_ASSESS exists for exactly that grader.
  const book = new PrecommitBook();
  book.seal({ expectation: expectation(), timestamp: 1, modality: "OFFERED" });
  const out = book.grade({
    ref: 0,
    graderId: "mica-arbiter",
    verdict: "CANNOT_ASSESS",
    ground: "the commitment is sealed and has not been revealed",
    timestamp: 2,
    modality: "IMPOSED",
  });
  assert.strictEqual(out.record.verdict, "CANNOT_ASSESS");
  const [open] = book.openCommitments();
  assert.strictEqual(open.gradings, 1);
  assert.strictEqual(open.sequenceNumber, 0);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the chain · rewriting anything breaks it ──");

check("PC-AB · THE FLIP TEST — a modality edited on disk breaks verify() at that seq", () => {
  // The same trap the witness has to avoid on the other side of the wire, and
  // the same one the ruling log names: a modality stored but not hashed could be
  // rewritten from IMPOSED to OFFERED with the chain still verifying.
  const base = mkdtempSync(join(tmpdir(), "mica-precommit-flip-"));
  const path = join(base, "precommit.jsonl");
  const first = new PrecommitBook({ path });
  first.seal({ expectation: expectation(), timestamp: 1, modality: "IMPOSED" });

  const tampered = readFileSync(path, "utf8").replace('"IMPOSED"', '"OFFERED"');
  writeFileSync(path, tampered, "utf8");

  const reopened = new PrecommitBook({ path });
  assert.strictEqual(reopened.getLoadState(), "CANNOT_VERIFY");
  assert.ok((reopened.getLastError() ?? "").includes("index 0"));
});

check("PC-AC · a revealed prediction edited on disk breaks the chain", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-precommit-edit-"));
  const path = join(base, "precommit.jsonl");
  const e = expectation({ predictedValue: "the symmetry statement is withheld" });
  const book = new PrecommitBook({ path });
  book.seal({ expectation: e, timestamp: 1, modality: "OFFERED" });
  book.reveal({ ref: 0, expectation: e, timestamp: 2, modality: "OFFERED" });

  const tampered = readFileSync(path, "utf8").replace(
    "the symmetry statement is withheld",
    "the symmetry statement is made"
  );
  writeFileSync(path, tampered, "utf8");

  const reopened = new PrecommitBook({ path });
  assert.strictEqual(reopened.getLoadState(), "CANNOT_VERIFY");
  assert.ok((reopened.getLastError() ?? "").includes("index 1"));
});

check("PC-AD · A FORGED BOOK — a forward ref written straight to disk fails verify()", () => {
  // Inside this process the ordering property is unreachable by construction.
  // The filesystem has made no such promise, so `verify()` re-checks it on load:
  // a forward reference on disk is a forged book, not a bug.
  const base = mkdtempSync(join(tmpdir(), "mica-precommit-forged-"));
  const path = join(base, "precommit.jsonl");
  const honest = new PrecommitBook({ path });
  honest.seal({ expectation: expectation(), timestamp: 1, modality: "OFFERED" });
  honest.grade({
    ref: 0,
    graderId: "mica-doctor",
    verdict: "GREEN",
    ground: "honest",
    timestamp: 2,
    modality: "OFFERED",
  });

  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const grading = JSON.parse(lines[1]) as Record<string, unknown>;
  // Point it at itself and RE-HASH, so only the ordering property can catch it.
  grading.ref = 1;
  grading.hash = computePrecommitRecordHash(
    grading as unknown as Parameters<typeof computePrecommitRecordHash>[0]
  );
  writeFileSync(path, `${lines[0]}\n${JSON.stringify(grading)}\n`, "utf8");

  const reopened = new PrecommitBook({ path });
  assert.strictEqual(reopened.getLoadState(), "CANNOT_VERIFY");
  assert.ok((reopened.getLastError() ?? "").includes("index 1"));
});

check("PC-AE · the closed schema rejects an extra key, a missing key, a wrong enum", () => {
  const book = new PrecommitBook();
  const out = book.seal({ expectation: expectation(), timestamp: 1, modality: "OFFERED" });
  const good = JSON.parse(JSON.stringify(out.record)) as Record<string, unknown>;
  assert.notStrictEqual(validatePrecommitRecord(good), null);

  assert.strictEqual(validatePrecommitRecord({ ...good, extra: 1 }), null);
  const { sealed: _dropped, ...missing } = good;
  assert.strictEqual(validatePrecommitRecord(missing), null);
  assert.strictEqual(validatePrecommitRecord({ ...good, modality: "MAYBE" }), null);
  assert.strictEqual(validatePrecommitRecord({ ...good, kind: "PROMISE" }), null);
  assert.strictEqual(validatePrecommitRecord({ ...good, sequenceNumber: -1 }), null);
  assert.strictEqual(validatePrecommitRecord(null), null);
  assert.strictEqual(validatePrecommitRecord([good]), null);
});

check("PC-AF · a REVEAL's plaintext is validated as a closed shape too", () => {
  const e = expectation();
  const book = new PrecommitBook();
  book.seal({ expectation: e, timestamp: 1, modality: "OFFERED" });
  const out = book.reveal({ ref: 0, expectation: e, timestamp: 2, modality: "OFFERED" });
  const good = JSON.parse(JSON.stringify(out.record)) as Record<string, unknown>;
  assert.notStrictEqual(validatePrecommitRecord(good), null);

  const plaintext = good.plaintext as Record<string, unknown>;
  assert.strictEqual(
    validatePrecommitRecord({ ...good, plaintext: { ...plaintext, gradingRule: "x" } }),
    null,
    "the reserved field was accepted into a v1 record"
  );
  assert.strictEqual(
    validatePrecommitRecord({ ...good, sealCheck: "PROBABLY" }),
    null
  );
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── durability and the head · the order is the invariant ──");

check("PC-AG · a failing appender leaves the committed prefix unchanged and says so", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-precommit-fault-"));
  const path = join(base, "precommit.jsonl");
  let fail = false;
  const book = new PrecommitBook({
    path,
    appender: (p, line) => {
      if (fail) throw new Error("disk is full");
      writeFileSync(p, line, { flag: "a" });
    },
  });
  book.seal({ expectation: expectation({ predictedValue: "one" }), timestamp: 1, modality: "OFFERED" });

  fail = true;
  const out = book.seal({
    expectation: expectation({ predictedValue: "two" }),
    timestamp: 2,
    modality: "OFFERED",
  });
  assert.strictEqual(out.persisted, false);
  assert.ok((out.detail ?? "").includes("disk is full"));
  assert.strictEqual(book.length, 1, "the failed append advanced the chain");

  // Fail-then-recover: the next append lands contiguously at seq 1.
  fail = false;
  const recovered = book.seal({
    expectation: expectation({ predictedValue: "three" }),
    timestamp: 3,
    modality: "OFFERED",
  });
  assert.strictEqual(recovered.persisted, true);
  assert.strictEqual(recovered.record.sequenceNumber, 1);
  assert.deepStrictEqual(book.verify(), { valid: true, brokenAt: null });
});

check("PC-AH · NO HEAD IS COMMITTED over a record that did not persist", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-precommit-nohead-"));
  const commits: HeadCommit[] = [];
  const book = new PrecommitBook({
    path: join(base, "precommit.jsonl"),
    appender: () => {
      throw new Error("nothing lands");
    },
    headCommitter: (commit) => commits.push(commit),
  });
  const out = book.seal({ expectation: expectation(), timestamp: 1, modality: "OFFERED" });

  assert.strictEqual(out.persisted, false);
  assert.strictEqual(out.headCommitted, false);
  assert.deepStrictEqual(commits, []);
  assert.ok((out.headCommitDetail ?? "").includes("not durably persisted"));
});

check("PC-AI · the head committer runs once per entry, carrying THAT entry's modality", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-precommit-head-"));
  const path = join(base, "precommit.jsonl");
  const commits: HeadCommit[] = [];
  const e = expectation();
  const book = new PrecommitBook({
    path,
    headCommitter: (commit) => commits.push(commit),
    witnessSetId: "set-alpha",
  });
  const sealed = book.seal({ expectation: e, timestamp: 1, modality: "IMPOSED" });
  const revealed = book.reveal({ ref: 0, expectation: e, timestamp: 2, modality: "OFFERED" });

  assert.strictEqual(commits.length, 2);
  assert.deepStrictEqual(commits[0], {
    seq_no: 0,
    head_hash: sealed.record.hash,
    ts: 0,
    witness_set_id: "set-alpha",
    modality: "IMPOSED",
  });
  assert.strictEqual(commits[1].modality, "OFFERED");
  assert.strictEqual(commits[1].head_hash, revealed.record.hash);
  assert.strictEqual(sealed.headCommitted, true);
});

check("PC-AJ · a head committer that THROWS is reported, never thrown — the entry survives", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-precommit-throw-"));
  const path = join(base, "precommit.jsonl");
  const book = new PrecommitBook({
    path,
    headCommitter: () => {
      throw new Error("the intake was never deployed");
    },
  });
  const out = book.seal({ expectation: expectation(), timestamp: 1, modality: "OFFERED" });

  assert.strictEqual(out.persisted, true);
  assert.strictEqual(out.headCommitted, false);
  assert.ok((out.headCommitDetail ?? "").includes("the intake was never deployed"));
  // A witness that is down may not cost this book the commitment it already wrote.
  assert.strictEqual(readFileSync(path, "utf8").trim().split("\n").length, 1);
});

check("PC-AK · what the book refuses to claim is stated where a reader can find it", () => {
  assert.ok(SUBMISSION_IS_NOT_RETENTION.includes("Submission is not retention"));
  assert.ok(THE_ANCHOR_IS_THE_ARROW.includes("never that"));
  assert.ok(THE_ANCHOR_IS_THE_ARROW.includes("between two witness sweeps"));
  assert.ok(OFFER_NOT_IMPOSE.includes("No principal is required to pre-commit"));
  // §1 of the design note, and the one word this build had to drop from it.
  assert.ok(PRECOMMIT_TITLE_AS_DESIGNED.includes("witness sequence N"));
  assert.ok(!PRECOMMIT_TITLE.includes("witness sequence"));
  // The two sentences differ in exactly one word, and that word is the claim
  // this build cannot make.
  assert.strictEqual(
    PRECOMMIT_TITLE_AS_DESIGNED.replace("witness sequence N", "sequence N"),
    PRECOMMIT_TITLE
  );
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the deployment act · it checks, and it never creates (S96-D) ──");

check("PC-AL · a book whose directory was never made THROWS and creates nothing", () => {
  // DELIBERATELY NOT using any helper that makes a directory: a negative test
  // leaning on the fixture that proves the positive case checks nothing.
  const root = mkdtempSync(join(tmpdir(), "mica-precommit-noact-"));
  const absent = join(root, "never-deployed");
  const path = join(absent, "precommit.jsonl");

  let thrown: unknown = null;
  try {
    new PrecommitBook({ path });
  } catch (error) {
    thrown = error;
  }

  assert.ok(
    thrown instanceof PrecommitDeploymentActMissing,
    `expected PrecommitDeploymentActMissing, got ${String(thrown)}`
  );
  assert.strictEqual((thrown as PrecommitDeploymentActMissing).path, absent);
  assert.strictEqual(existsSync(absent), false, "the book created its own directory");
  assert.strictEqual(existsSync(path), false, "a store file appeared anyway");
});

check("PC-AM · the signpost names the UNDESIGNATED act instead of inventing a §", () => {
  const root = mkdtempSync(join(tmpdir(), "mica-precommit-signpost-"));
  let message = "";
  try {
    new PrecommitBook({ path: join(root, "gone", "precommit.jsonl") });
  } catch (error) {
    message = (error as Error).message;
  }
  assert.ok(message.includes("no recipe section yet"));
  assert.ok(message.includes("Nothing was created"));
  assert.ok(message.includes(THE_STORE_LOCATION_IS_UNDESIGNATED));
  // The three sibling seams cite §5.1, §5.2, §5B.2. This one has nothing to
  // cite, and a fabricated citation would hide the finding.
  assert.ok(!/recipe §\d/.test(message), `the signpost invented a section: ${message}`);
});

check("PC-AN · a path that exists and is NOT a directory is its own finding", () => {
  const root = mkdtempSync(join(tmpdir(), "mica-precommit-notdir-"));
  const file = join(root, "not-a-directory");
  writeFileSync(file, "", "utf8");
  let message = "";
  try {
    new PrecommitBook({ path: join(file, "precommit.jsonl") });
  } catch (error) {
    message = (error as Error).message;
  }
  assert.ok(message.includes("exists and is not a directory"));
});

check("PC-AO · there is no mkdirSync, and no default path, anywhere in the module", () => {
  const source = codeOnly(readFileSync(join(__dirname, "precommit.ts"), "utf8"));
  assert.ok(!source.includes("mkdirSync"), "the module creates a directory");
  assert.ok(!source.includes("mkdir"), "the module creates a directory");
  // No path literal either: where an A9 book lives is the arbiter's to rule.
  for (const prefix of DEPLOYMENT_PATH_PREFIXES) {
    assert.ok(!source.includes(prefix), `the module names a deployment path (${prefix})`);
  }
  // And no clock: `timestamp` is injected, always.
  assert.ok(!source.includes("Date.now"), "the module calls a clock");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the daily-report line · silence is not health, for promises too ──");

check("PC-AP · a book with NO commitments withholds the count and says why", () => {
  // A count with nothing to count is not a clean count (S96-B, S97). "0 open"
  // over an empty book is the vacuous all-clear the daily report had to cut.
  const book = new PrecommitBook();
  const line = book.openCommitmentsLine();
  assert.ok(line.includes("nothing to count"));
  assert.ok(line.includes("therefore not made"));
  assert.ok(!line.includes(": 0 of"), "an empty book printed a zero anyway");
  assert.deepStrictEqual(book.openCommitments(), []);
});

check("PC-AQ · open commitments are listed with their committer and their age in entries", () => {
  const book = new PrecommitBook();
  const one = expectation({ predictedValue: "one" });
  book.seal({ expectation: one, timestamp: 1, modality: "OFFERED" });
  book.seal({
    expectation: expectation({ predictedValue: "two", committerId: "mica-doctor" }),
    timestamp: 2,
    modality: "OFFERED",
  });
  book.grade({
    ref: 1,
    graderId: "mica-arbiter",
    verdict: "CANNOT_ASSESS",
    ground: "sealed, not revealed",
    timestamp: 3,
    modality: "IMPOSED",
  });

  const open = book.openCommitments();
  assert.deepStrictEqual(open, [
    { sequenceNumber: 0, committerId: "mica-build", entriesSince: 2, gradings: 0 },
    { sequenceNumber: 1, committerId: "mica-doctor", entriesSince: 1, gradings: 1 },
  ]);
  const line = book.openCommitmentsLine();
  assert.ok(line.includes("2 of 2 sealed and not revealed"));
  assert.ok(line.includes("seq 0 (mica-build, 2 entries since)"));
  assert.ok(line.includes("seq 1 (mica-doctor, 1 entry since, 1 grading(s))"));
});

check("PC-AR · a revealed commitment leaves the open set, and the line changes with it", () => {
  const book = new PrecommitBook();
  const e = expectation();
  book.seal({ expectation: e, timestamp: 1, modality: "OFFERED" });
  assert.strictEqual(book.openCommitments().length, 1);

  book.reveal({ ref: 0, expectation: e, timestamp: 2, modality: "OFFERED" });
  assert.strictEqual(book.openCommitments().length, 0);
  const line = book.openCommitmentsLine();
  assert.ok(line.includes("0 of 1"));
  assert.ok(line.includes("every commitment in this book has been revealed"));
});

check("PC-AS · a MISMATCHING reveal still closes the promise — it was answered", () => {
  // The commitment is no longer open: somebody came back to it. What they came
  // back WITH is the MISMATCH on the reveal, and that is a different finding
  // living in a different field. Folding the two would hide one of them.
  const book = new PrecommitBook();
  book.seal({ expectation: expectation({ predictedValue: "A" }), timestamp: 1, modality: "OFFERED" });
  const out = book.reveal({
    ref: 0,
    expectation: expectation({ predictedValue: "B" }),
    timestamp: 2,
    modality: "OFFERED",
  });
  assert.strictEqual(out.record.sealCheck, "MISMATCH");
  assert.strictEqual(book.openCommitments().length, 0);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── end to end · the head of a sealed commitment reaches a real witness ──");

check("PC-AT · a commitment's head is retained by a Witness, and the seed is not", () => {
  // Every directory here is made INLINE by this body: these mkdirSync calls are
  // the deployment acts, performed by a deployer, before any book or witness
  // opens on them.
  const base = mkdtempSync(join(tmpdir(), "mica-precommit-e2e-"));
  const intake = join(base, "intake");
  const outbox = join(base, "outbox");
  mkdirSync(intake, { recursive: true });
  mkdirSync(outbox, { recursive: true });

  const e = expectation({
    target: "E2E-TARGET-SENTINEL",
    predictedValue: "E2E-VALUE-SENTINEL",
  });
  const book = new PrecommitBook({
    path: join(base, "precommit.jsonl"),
    headCommitter: fileDropCommitter(intake, "mica-precommit"),
    witnessSetId: "set-alpha",
  });
  const out = book.seal({ expectation: e, timestamp: 1, modality: "NOT_AN_INSTRUCTION" });
  assert.strictEqual(out.headCommitted, true);

  const witness = new Witness({
    witnessSetId: "set-alpha",
    storePath: join(base, "witness.jsonl"),
    outboxDir: outbox,
    intakeDir: intake,
    declaredSubmitters: ["mica-precommit"],
    witnessClock: () => 5_000,
  });
  const [result] = witness.pollIntake();

  assert.strictEqual(result.record.kind, "HEAD_COMMIT");
  assert.strictEqual(result.record.witnessed.modality, "NOT_AN_INSTRUCTION");
  // The retained head IS this book's entry hash. That is the whole anchor.
  assert.strictEqual(result.record.witnessed.head_hash, out.record.hash);
  assert.deepStrictEqual(witness.verify(), { valid: true, brokenAt: null });

  // R2 AND the white vest, at bytes, on the far side of the wire: neither the
  // plaintext nor the seal's content reached any witness record.
  const retained = readFileSync(join(base, "witness.jsonl"), "utf8");
  assert.ok(!retained.includes("E2E-TARGET-SENTINEL"));
  assert.ok(!retained.includes("E2E-VALUE-SENTINEL"));
  assert.ok(!retained.includes("plaintext"));
  assert.ok(!retained.includes("sealed"));
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the first live use · a real commitment, sealed before its event ──");

check("PC-AU · the first book verifies, holds ONE commitment revealed and graded, and every COMMITMENT leaks nothing", () => {
  // `first-commitment.jsonl` is a REAL chain, not a fixture. Seq 0 was sealed
  // 2026-08-31 22:35:53 and committed to this repository BEFORE the 00:00
  // report run it predicts. Seq 1 (REVEAL) and seq 2 (GRADING) were appended
  // 2026-09-01 in S99 under ruling (c), closing the first sealed promise this
  // project made: predicted GREEN, graded GREEN by a principal that could not
  // have committed it.
  //
  // ── IT IS ALSO THE GOLDEN VECTOR, AND THAT IS NOT A SIDE EFFECT ────────────
  //
  //   The chain preimage is pinned here by hash literals, so ANY change to it
  //   — field order, the domain tag, the separator, the length prefixes, or
  //   dropping `kind` — breaks this body. That matters because `kind` in the
  //   preimage has no behavioural test of its own and cannot easily have one:
  //   the three tails have different arity and are length-prefixed, so a
  //   cross-kind collision is not constructible to assert against. Mutation
  //   testing found exactly that — removing `kind` from the preimage was killed
  //   by this body ALONE. The pin is the fence, and it is named as one rather
  //   than left to look like an incidental kill.
  //
  //   S99 STRENGTHENED IT WITHOUT MEANING TO: the book now holds one record of
  //   EACH kind, and all three are pinned. The `kind` mutation formerly had one
  //   record to survive; it now has three, one per arity.
  //
  //   A DELIBERATE format change breaks these lines and must: it means every
  //   seal taken before it is unverifiable, which is a decision for the arbiter
  //   and not a number to update.
  //
  // ── WHY THE VEST ASSERTION MOVED, AND DID NOT WEAKEN (S99) ─────────────────
  //
  //   It used to read over the WHOLE FILE, which was exact while the book held
  //   a single COMMITMENT. Ruling 2 puts the plaintext into the chain AT THE
  //   REVEAL — so a file-wide "no plaintext anywhere" would now assert the
  //   opposite of the design, and the honest repair is not to delete it but to
  //   state it where it is actually true. The vest is a property of the
  //   COMMITMENT record: a hash, a committer id, and nothing else. It is now
  //   asserted per COMMITMENT line, so it keeps biting as the book grows, and
  //   a REVEAL is left free to carry the seed it is supposed to carry.
  //
  // ── WHAT THIS BOOK CANNOT SAY, AND SAYS BY OMISSION (S99) ──────────────────
  //
  //   Not one of these three entries was anchored to the witness. The live path
  //   ran with no head committer, and no principal on the box could have
  //   supplied one — `mica-doctor` and `mica-arbiter`, the two entitled to
  //   grade, are not in `mica-drops`. Nothing in the RECORDS says so; a reader
  //   cannot tell an anchored entry from an unanchored one. Do not read a
  //   passing PC-AU as evidence of anchoring. It is evidence of an intact
  //   chain, and THE_ANCHOR_IS_THE_ARROW says how far that may be read.
  const path = resolve(__dirname, "first-commitment.jsonl");
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  assert.strictEqual(lines.length, 3, "the first book is three records long");

  const records = lines.map((line, i) => {
    const r = validatePrecommitRecord(JSON.parse(line));
    assert.notStrictEqual(r, null, `record ${String(i)} does not match the schema`);
    return r as PrecommitRecord;
  });

  // Every record rehashes, and the chain links head to tail.
  records.forEach((r, i) => {
    assert.strictEqual(r.sequenceNumber, i, `record ${String(i)} is out of sequence`);
    assert.strictEqual(
      r.previousHash,
      i === 0 ? "" : records[i - 1].hash,
      `record ${String(i)} does not link to its predecessor`
    );
    assert.strictEqual(
      computePrecommitRecordHash(
        r as Parameters<typeof computePrecommitRecordHash>[0]
      ),
      r.hash,
      `record ${String(i)} does not rehash to its stored hash`
    );
  });

  const PINNED = [
    "8f7d4e068052e79bef630c5767f00e8617344c473d09947603b69c7971c8cf71",
    "c34996e78df388ff0f10ebcaa63cc772a5fa619b10b5c406a810bbb06b9b1d7f",
    "9077390400804fd5b8f8d000ec92187f0fb6764d7d46c2a4c5623cfa98464ab6",
  ];
  records.forEach((r, i) => {
    assert.strictEqual(
      r.hash,
      PINNED[i],
      "the chain preimage changed: every seal taken before this change is now " +
        "unverifiable, and that is the arbiter's call, not a number to update"
    );
  });

  const commitment = records[0] as CommitmentRecord;
  const reveal = records[1] as RevealRecord;
  const grading = records[2] as GradingRecord;

  assert.strictEqual(commitment.kind, "COMMITMENT");
  assert.strictEqual(reveal.kind, "REVEAL");
  assert.strictEqual(grading.kind, "GRADING");

  // THE REVEAL MATCHED THE DEPOSIT, on the artifact and not in a fixture: the
  // plaintext in the chain recomputes to the hash sealed 85 minutes before the
  // event, and the book wrote MATCH rather than being told to.
  assert.strictEqual(reveal.ref, 0);
  assert.strictEqual(reveal.sealCheck, "MATCH");
  assert.strictEqual(reveal.recomputed, commitment.sealed);
  assert.strictEqual(
    computeSealHash(reveal.plaintext),
    commitment.sealed,
    "the revealed plaintext no longer recomputes to the sealed deposit"
  );

  // RULING 4, ON THE REAL RECORD: the grader is not the committer.
  assert.strictEqual(grading.ref, 0);
  assert.strictEqual(grading.verdict, "GREEN");
  assert.notStrictEqual(
    grading.graderId,
    commitment.committerId,
    A_COMMITTER_NEVER_GRADES_ITSELF
  );

  // The white vest, asserted where it holds: on each COMMITMENT line.
  lines.forEach((line, i) => {
    if ((JSON.parse(line) as { kind: string }).kind !== "COMMITMENT") return;
    assert.ok(!line.includes("plaintext"), `COMMITMENT at line ${String(i)} carries plaintext`);
    assert.ok(!line.includes("target"), `COMMITMENT at line ${String(i)} carries a target`);
    assert.ok(!line.includes("predictedValue"), `COMMITMENT at line ${String(i)} carries a predicted value`);
    assert.ok(!line.includes("salt"), `COMMITMENT at line ${String(i)} carries a salt`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── S98 · a look that was REFUSED is not a book that is ABSENT ──");

check("PC-AV-1 · the look has three answers, and only ENOENT means absent", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-precommit-look-"));
  const present = join(base, "book.jsonl");
  writeFileSync(present, "", "utf8");
  assert.deepStrictEqual(lookAtPrecommitFile(present), { state: "PRESENT" });
  assert.deepStrictEqual(lookAtPrecommitFile(join(base, "nope.jsonl")), { state: "ABSENT" });

  // A NON-ENOENT errno, produced WITHOUT touching permissions so this body is
  // deterministic for every principal including root: a path component longer
  // than NAME_MAX is ENAMETOOLONG, inside a directory that stats perfectly well.
  const tooLong = join(base, "x".repeat(300));
  const refused = lookAtPrecommitFile(tooLong);
  assert.strictEqual(
    refused.state,
    "CANNOT_SEE",
    `a stat error that is not ENOENT was classified as ${refused.state}`
  );
  assert.ok(
    refused.state === "CANNOT_SEE" && refused.detail.includes("ENAMETOOLONG"),
    "the errno the look could not get past is not carried on the finding"
  );
});

check("PC-AV-2 · a book it CANNOT SEE loads to CANNOT_VERIFY, never to first boot", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-precommit-cannotsee-"));
  const unseeable = join(base, "x".repeat(300));

  const book = new PrecommitBook({ path: unseeable });

  assert.strictEqual(
    book.getLoadState(),
    "CANNOT_VERIFY",
    "a book this process cannot look at came up as a first boot"
  );
  const detail = book.getLastError() ?? "";
  assert.ok(detail.includes("NOT the finding that it is absent"), detail);
  assert.ok(detail.includes("ENAMETOOLONG"), detail);
  assert.ok(detail.includes("nothing was recorded as a first boot"), detail);
  assert.ok(detail.includes("vacuous all-clear wearing a seal"), detail);
  // And the line must not print a clean nothing over an unreadable book.
  assert.ok(book.openCommitmentsLine().includes("no commitments at all"));
});

check("PC-AV-3 · and it does not persist — the write is refused, typed, over nothing", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-precommit-cannotsee-write-"));
  const book = new PrecommitBook({ path: join(base, "x".repeat(300)) });
  const out = book.seal({ expectation: expectation(), timestamp: 1, modality: "OFFERED" });
  assert.strictEqual(out.persisted, false);
  assert.ok((out.detail ?? "").includes("NOT the finding that it is absent"));
  assert.strictEqual(book.length, 0, "a book nobody could read advanced anyway");
});

check("PC-AV-4 · THE REAL SHAPE — a directory whose execute bit is stripped", () => {
  // This is the deployment fault the fix exists for: the directory stats fine
  // and refuses every path inside it. It needs a principal the mode applies to,
  // so it is attempted only as non-root; as root the condition cannot be built
  // and this body SAYS SO rather than passing quietly over a check that never
  // ran. PC-AV-1 through PC-AV-3 reach the same branch by another errno and are
  // deterministic for every principal.
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === 0 || uid === null) {
    console.log(
      "      NOT EXERCISED as this principal: a mode-based refusal cannot be " +
        "built for uid 0. The classification and the load state are covered by " +
        "PC-AV-1..3; this body covers only the mode."
    );
    return;
  }
  const base = mkdtempSync(join(tmpdir(), "mica-precommit-noexec-"));
  const dir = join(base, "book");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "book.jsonl");
  writeFileSync(path, "", "utf8");
  chmodSync(dir, 0o600); // readable, NOT searchable
  try {
    const look = lookAtPrecommitFile(path);
    assert.strictEqual(
      look.state,
      "CANNOT_SEE",
      "a directory with no execute bit did not refuse the look"
    );
    const book = new PrecommitBook({ path });
    assert.strictEqual(book.getLoadState(), "CANNOT_VERIFY");
    assert.ok((book.getLastError() ?? "").includes("EACCES"));
  } finally {
    chmodSync(dir, 0o700);
  }
});

console.log(`\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
