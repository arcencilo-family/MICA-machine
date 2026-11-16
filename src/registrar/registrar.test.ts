// -- MICA · registrar conformance ---------------------------------------------
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node src/registrar/registrar.test.ts
//
// THE NEGATIVE SET IS THE POINT. A custodian is only worth having if it refuses,
// so the refusals are tested first and by construction, and every one of them
// asserts the REASON and not merely that something went wrong. A test that only
// checks "it threw" cannot tell a wrong-book refusal from a disk error, which
// is exactly the collapse the three-valued discipline exists to prevent.
//
// EVERY FIXTURE IS A TEMP DIR MADE BY THE TEST, and the deployment acts are made
// EXPLICITLY, by name, in `deployRoom()`. The S98 lesson stands: a fixture that
// quietly performs a deployment act hides the act, and a fixture a negative test
// must escape is confessing something. Here the negative tests do not escape the
// fixture — they DELETE the act, which is the honest way to test its absence.

import assert from "assert";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  computeSealHash,
  MINIMUM_SALT_LENGTH,
  PrecommitBook,
  validatePrecommitRecord,
  type AnchorRecord,
  type Expectation,
  type PrecommitRecord,
} from "../precommit/precommit";
import {
  DEPLOYMENT_FACT_REASONS,
  DEFAULT_GRADERS,
  isRecordAct,
  IDENTITY_IS_THE_OWNER_UID,
  precommitChainId,
  Registrar,
  sealForDeposit,
  THE_REGISTRAR_CERTIFIES_NOTHING,
  validateDeposit,
  writeDeposit,
  type Deposit,
  type DepositOutcome,
  type RefusedDeposit,
  type AcceptedDeposit,
} from "./registrar";
import { RecordBook, recordChainId, RECORD_KINDS } from "../record/record-book";
import {
  buildDeposit,
  parseOptions,
  resolveSelf,
  validateClaim,
} from "./deposit-cli";
import { fileDropNamedCommitter } from "../witness/drop-committer";
import type { NamedHeadCommit } from "../witness/types";

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

// -- fixtures ----------------------------------------------------------------

const COMMITTER = "mica-build-seat-s99";
const ARBITER = "mica-arbiter";
const STRANGER = "mica-op";

/** uid -> principal. The kernel's fact, simulated by choosing whose file it is. */
const UID_COMMITTER = 5001;
const UID_ARBITER = 5002;
const UID_STRANGER = 5003;
const ROSTER = new Map<number, string>([
  [UID_COMMITTER, COMMITTER],
  [UID_ARBITER, ARBITER],
  [UID_STRANGER, STRANGER],
]);

/**
 * THE DEPLOYMENT ACTS, PERFORMED BY NAME. Root and intake only — the
 * per-committer book directory is deliberately NOT made here, because the
 * registrar makes that one itself and a fixture that pre-made it would hide
 * whether it does.
 */
function deployRoom(): string {
  const root = mkdtempSync(join(tmpdir(), "mica-registrar-"));
  mkdirSync(join(root, "intake"), { mode: 0o2730 });
  return root;
}

/**
 * The uid of a deposit frame cannot be set by a test running as one user, so
 * the resolver is the seam: it is handed the uid the real one would read, and
 * the test says which principal owns the frame by passing a resolver that
 * answers for it. Everything else on the path is the production code.
 */
function registrarFor(
  root: string,
  ownerUid: number,
  over: {
    readonly headCommitter?: (c: NamedHeadCommit) => void;
    readonly refusalHeadCommitter?: (c: NamedHeadCommit) => void;
    readonly graders?: readonly string[];
    readonly recordRoot?: string;
  } = {}
): Registrar {
  let t = 1_700_000_000_000;
  return new Registrar({
    root,
    recordRoot: over.recordRoot,
    witnessSetId: "test-set",
    // THE SEAM, AND WHY IT IS THE HONEST ONE. A test running as one user cannot
    // chown its own deposit frames, so the uid the registrar reads is always
    // this process's. The resolver is where that fact is injected: the test
    // says WHOSE frame it is, and every other step on the path — the claimed-vs
    // -actual comparison, the entitlement table, the book — is production code
    // running on production values. What is NOT simulated is the kernel setting
    // the uid, and that is the one part no test on this box can exercise.
    resolvePrincipal: () => ROSTER.get(ownerUid) ?? null,
    entitlements: over.graders === undefined ? undefined : { graders: over.graders },
    headCommitter: over.headCommitter,
    refusalHeadCommitter: over.refusalHeadCommitter,
    now: () => ++t,
  });
}

function expectation(over: Partial<Expectation> = {}): Expectation {
  return {
    type: "verdict",
    target: "a named checkable field of a future outcome",
    predictedValue: "the value it will hold",
    committerId: COMMITTER,
    salt: "s".repeat(MINIMUM_SALT_LENGTH),
    ...over,
  };
}

function deposit(over: Partial<Deposit> = {}): Deposit {
  return {
    depositor: COMMITTER,
    book: COMMITTER,
    body: { act: "COMMITMENT", sealed: sealForDeposit(expectation()) },
    modality: "OFFERED",
    timestamp: 1_700_000_000_000,
    ...over,
  };
}

function only(result: { readonly outcomes: readonly DepositOutcome[] }): DepositOutcome {
  assert.strictEqual(result.outcomes.length, 1, "expected exactly one outcome");
  return result.outcomes[0];
}

function refusal(o: DepositOutcome): RefusedDeposit {
  assert.strictEqual(o.outcome, "REFUSED", `expected a refusal, got ${o.outcome}`);
  return o as RefusedDeposit;
}

function accepted(o: DepositOutcome): AcceptedDeposit {
  assert.strictEqual(
    o.outcome,
    "ACCEPTED",
    `expected acceptance, got ${o.outcome}: ${(o as RefusedDeposit).detail ?? ""}`
  );
  return o as AcceptedDeposit;
}

function readBook(root: string, who: string): PrecommitRecord[] {
  const raw = readFileSync(join(root, who, "book.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const r = validatePrecommitRecord(JSON.parse(l));
      assert.notStrictEqual(r, null, "a written record does not match the schema");
      return r as PrecommitRecord;
    });
}

// =============================================================================
console.log("\n-- the deployment acts are verified, never performed --");

check("RG-A · a registrar whose store root is absent does not come up", () => {
  const root = deployRoom();
  rmSync(root, { recursive: true, force: true });
  assert.throws(
    () => registrarFor(root, UID_COMMITTER),
    (err: Error) => {
      assert.ok(err.message.includes("DEPLOYMENT ACT"), err.message);
      assert.ok(err.message.includes("nothing here creates it"), err.message);
      return true;
    }
  );
});

check("RG-B · and an absent INTAKE is its own refusal, not a quiet empty sweep", () => {
  const root = deployRoom();
  rmSync(join(root, "intake"), { recursive: true, force: true });
  assert.throws(
    () => registrarFor(root, UID_COMMITTER),
    (err: Error) => {
      assert.ok(err.message.includes("the registrar intake"), err.message);
      return true;
    }
  );
});

check("RG-C · an intake it CANNOT READ throws; it is never reported as empty", () => {
  const root = deployRoom();
  const reg = registrarFor(root, UID_COMMITTER);
  const intake = join(root, "intake");
  chmodSync(intake, 0o000);
  try {
    let threw = false;
    try {
      reg.sweep();
    } catch (err) {
      threw = true;
      assert.ok(
        String(err).includes("cannot read its intake"),
        `wrong message: ${String(err)}`
      );
      assert.ok(
        String(err).includes("not a deposit"),
        "the message does not separate a deployment fact from an empty intake"
      );
    }
    assert.ok(threw, "an unreadable intake swept clean — the vacuous all-clear");
  } finally {
    chmodSync(intake, 0o2730);
  }
});

// =============================================================================
console.log("\n-- identity is the owner uid, not the file's contents --");

check("RG-D · a deposit claiming to be someone else is REFUSED, not normalised", () => {
  const root = deployRoom();
  const reg = registrarFor(root, UID_STRANGER);
  // The frame SAYS it is the committer. Its uid says otherwise.
  writeDeposit(join(root, "intake"), deposit({ depositor: COMMITTER }));
  const r = refusal(only(reg.sweep()));
  assert.strictEqual(r.reason, "IDENTITY_MISMATCH");
  assert.ok(r.detail.includes(IDENTITY_IS_THE_OWNER_UID));
  assert.strictEqual(r.depositor, STRANGER, "the log records the REAL depositor");
  assert.ok(!existsSync(join(root, COMMITTER, "book.jsonl")), "a book was opened");
});

check("RG-E · a uid the roster does not know is UNKNOWN_DEPOSITOR, never a guess", () => {
  const root = deployRoom();
  const reg = new Registrar({
    root,
    witnessSetId: "test-set",
    resolvePrincipal: () => null,
    now: () => 1,
  });
  writeDeposit(join(root, "intake"), deposit());
  const r = refusal(only(reg.sweep()));
  assert.strictEqual(r.reason, "UNKNOWN_DEPOSITOR");
  assert.strictEqual(r.depositor, null);
});

// =============================================================================
console.log("\n-- the entitlement table (E.1 §2) --");

check("RG-F · a stranger's GRADING is NOT_ENTITLED, and names ruling 4", () => {
  const root = deployRoom();
  const reg = registrarFor(root, UID_STRANGER);
  writeDeposit(
    join(root, "intake"),
    deposit({
      depositor: STRANGER,
      book: COMMITTER,
      body: { act: "GRADING", ref: 0, verdict: "GREEN", ground: "read it" },
    })
  );
  const r = refusal(only(reg.sweep()));
  assert.strictEqual(r.reason, "NOT_ENTITLED");
  assert.ok(r.detail.includes("ruling 4"), r.detail);
});

check("RG-G · a COMMITMENT into someone else's book is WRONG_BOOK", () => {
  const root = deployRoom();
  const reg = registrarFor(root, UID_STRANGER);
  writeDeposit(
    join(root, "intake"),
    deposit({ depositor: STRANGER, book: COMMITTER })
  );
  const r = refusal(only(reg.sweep()));
  assert.strictEqual(r.reason, "WRONG_BOOK");
  assert.ok(!existsSync(join(root, COMMITTER, "book.jsonl")));
});

check("RG-H · a REVEAL into someone else's book is WRONG_BOOK too", () => {
  const root = deployRoom();
  const reg = registrarFor(root, UID_ARBITER);
  writeDeposit(
    join(root, "intake"),
    deposit({
      depositor: ARBITER,
      book: COMMITTER,
      body: { act: "REVEAL", ref: 0, expectation: expectation() },
    })
  );
  assert.strictEqual(refusal(only(reg.sweep())).reason, "WRONG_BOOK");
});

check("RG-I · SELF-GRADING is refused AT THE DOOR, before any book is opened", () => {
  const root = deployRoom();
  // A grader depositing into its OWN book: entitled to grade, but the book is
  // its own, so ruling 4 refuses it at the entitlement step.
  const reg = registrarFor(root, UID_ARBITER);
  writeDeposit(
    join(root, "intake"),
    deposit({
      depositor: ARBITER,
      book: ARBITER,
      body: { act: "GRADING", ref: 0, verdict: "GREEN", ground: "read it" },
    })
  );
  const r = refusal(only(reg.sweep()));
  assert.strictEqual(r.reason, "SELF_GRADING");
  assert.ok(
    !existsSync(join(root, ARBITER, "book.jsonl")),
    "the door refusal still opened a book"
  );
});

check("RG-J · and AGAIN IN CODE — belt and braces, with the door removed", () => {
  // The door check keys on `book`. This one proves the SECOND check exists: a
  // roster that (wrongly) lets the committer grade still cannot get a
  // self-grading into the chain, because PrecommitBook refuses it.
  const root = deployRoom();
  const reg = registrarFor(root, UID_COMMITTER, { graders: [COMMITTER, ARBITER] });
  const intake = join(root, "intake");
  writeDeposit(intake, deposit());
  assert.strictEqual(accepted(only(reg.sweep())).sequenceNumber, 0);

  // Same principal, and the door lets it through because book !== depositor is
  // the door's test and we aim it at its own book via a second registrar whose
  // graders list is wrong. The BOOK is the one that refuses.
  const book = new PrecommitBook({ path: reg.bookPath(COMMITTER) });
  assert.throws(
    () =>
      book.grade({
        ref: 0,
        graderId: COMMITTER,
        verdict: "GREEN",
        ground: "grading myself",
        timestamp: 1,
        modality: "OFFERED",
      }),
    (err: Error) => {
      assert.ok(err.message.includes("may not grade its own commitment"), err.message);
      return true;
    }
  );
});

// =============================================================================
console.log("\n-- malformed deposits --");

check("RG-K · every malformed shape is refused, and none of them opens a book", () => {
  const root = deployRoom();
  const reg = registrarFor(root, UID_COMMITTER);
  const intake = join(root, "intake");
  const bad: readonly [string, unknown][] = [
    ["not an object", 42],
    ["missing a key", { depositor: COMMITTER, book: COMMITTER, modality: "OFFERED" }],
    ["a sixth key", { ...deposit(), extra: 1 }],
    ["unknown act", { ...deposit(), body: { act: "ERASE" } }],
    ["unknown modality", { ...deposit(), modality: "SUGGESTED" }],
    ["unknown verdict", {
      ...deposit(),
      body: { act: "GRADING", ref: 0, verdict: "AMBER", ground: "x" },
    }],
    ["a path for a book", { ...deposit(), book: "../../etc" }],
    ["a negative ref", {
      ...deposit(),
      body: { act: "REVEAL", ref: -1, expectation: expectation() },
    }],
  ];
  bad.forEach(([label, value], i) => {
    writeFileSync(join(intake, `frame-${String(i)}.json`), JSON.stringify(value), "utf8");
  });
  writeFileSync(join(intake, "frame-torn.json"), "{not json", "utf8");

  const result = reg.sweep();
  assert.strictEqual(result.seen, bad.length + 1);
  result.outcomes.forEach((o, i) => {
    const r = refusal(o);
    assert.strictEqual(
      r.reason,
      "MALFORMED_DEPOSIT",
      `frame ${String(i)} was refused as ${r.reason}`
    );
  });
  assert.ok(!existsSync(join(root, COMMITTER)), "a malformed frame made a book dir");
});

check("RG-L · an in-flight frame (leading dot) is not consumed", () => {
  const root = deployRoom();
  const reg = registrarFor(root, UID_COMMITTER);
  writeFileSync(join(root, "intake", ".half-written.json"), "{", "utf8");
  const result = reg.sweep();
  assert.strictEqual(result.seen, 0, "a half-written frame was swept");
  assert.ok(existsSync(join(root, "intake", ".half-written.json")));
});

check("RG-M · a refused frame is CONSUMED, so one bad deposit cannot loop forever", () => {
  const root = deployRoom();
  const reg = registrarFor(root, UID_COMMITTER);
  writeFileSync(join(root, "intake", "bad.json"), "nope", "utf8");
  assert.strictEqual(reg.sweep().seen, 1);
  assert.strictEqual(reg.sweep().seen, 0, "the refused frame was left on the intake");
});

// =============================================================================
console.log("\n-- a frame it CANNOT READ is not a bad deposit (live defect, 2026-09-01) --");

check("RG-AG · an unreadable frame is CANNOT_SEE_FRAME, never MALFORMED_DEPOSIT", () => {
  // THE DEFECT THIS BODY EXISTS FOR, found on the first real deposit. The
  // registrar was not in its own intake's carry-group, so a perfectly good
  // frame came back EACCES. The module called that MALFORMED_DEPOSIT — blaming
  // the depositor for a fact about the box.
  const root = deployRoom();
  const reg = registrarFor(root, UID_COMMITTER);
  const frame = join(root, "intake", "unreadable.json");
  writeFileSync(frame, JSON.stringify(deposit()), "utf8");
  chmodSync(frame, 0o000);
  try {
    const r = refusal(only(reg.sweep()));
    assert.strictEqual(
      r.reason,
      "CANNOT_SEE_FRAME",
      `a permission fact was reported as ${r.reason}`
    );
    assert.ok(r.detail.includes("EACCES"), `the errno was dropped: ${r.detail}`);
    assert.ok(
      r.detail.includes("not about the deposit"),
      "the message does not separate a deployment fact from a bad deposit"
    );
  } finally {
    chmodSync(frame, 0o600);
  }
});

check("RG-AH · and it is NOT CONSUMED — a good deposit survives a broken box", () => {
  // The second half, and the worse one: the first version DELETED the frame it
  // could not read, destroying a deposit over a fixable misconfiguration.
  const root = deployRoom();
  const reg = registrarFor(root, UID_COMMITTER);
  const frame = join(root, "intake", "unreadable.json");
  writeFileSync(frame, JSON.stringify(deposit()), "utf8");
  chmodSync(frame, 0o000);
  try {
    assert.strictEqual(refusal(only(reg.sweep())).reason, "CANNOT_SEE_FRAME");
    assert.ok(existsSync(frame), "the registrar destroyed a deposit it could not read");
    assert.strictEqual(reg.sweep().seen, 1, "the frame was not re-seen on the next sweep");
  } finally {
    chmodSync(frame, 0o600);
  }
  // ...and once the box is fixed, the SAME frame is taken. This is the whole
  // point of not consuming it.
  const after = accepted(only(reg.sweep()));
  assert.strictEqual(after.sequenceNumber, 0);
  assert.ok(!existsSync(frame), "an accepted frame was left on the intake");
});

check("RG-AI · a frame that vanished mid-sweep is a race, not a finding, and not CANNOT_SEE", () => {
  const root = deployRoom();
  const reg = registrarFor(root, UID_COMMITTER);
  const frame = join(root, "intake", "gone.json");
  writeFileSync(frame, "{}", "utf8");
  rmSync(frame);
  // readdir already listed it in a real race; here the sweep simply finds none.
  assert.strictEqual(reg.sweep().seen, 0);
  // The reason exists and is distinct from the permission one.
  assert.ok(!DEPLOYMENT_FACT_REASONS.includes("FRAME_VANISHED"));
  assert.ok(DEPLOYMENT_FACT_REASONS.includes("CANNOT_SEE_FRAME"));
});

// =============================================================================
console.log("\n-- the anchor, on every entry the registrar writes --");

check("RG-N · UNWIRED is NOT_DROPPED — an absence of an act, recorded as one", () => {
  const root = deployRoom();
  const reg = registrarFor(root, UID_COMMITTER);
  assert.strictEqual(reg.hasHeadCommitter, false);
  writeDeposit(join(root, "intake"), deposit());
  const a = accepted(only(reg.sweep()));
  assert.strictEqual(a.anchor, "NOT_DROPPED");
  assert.strictEqual(a.anchorSequenceNumber, 1);

  const records = readBook(root, COMMITTER);
  assert.strictEqual(records.length, 2, "entry + anchor");
  const anchor = records[1] as AnchorRecord;
  assert.strictEqual(anchor.kind, "ANCHOR");
  assert.strictEqual(anchor.ref, 0);
  assert.strictEqual(anchor.status, "NOT_DROPPED");
  assert.strictEqual(anchor.droppedAt, 0, "an act that never happened claimed a moment");
  assert.strictEqual(anchor.detail, "", "an absence explained itself");
  assert.strictEqual(anchor.headHash, records[0].hash);
});

check("RG-O · a WIRED drop that returns is DROPPED, and carries the head presented", () => {
  const root = deployRoom();
  const seen: NamedHeadCommit[] = [];
  const reg = registrarFor(root, UID_COMMITTER, {
    headCommitter: (c) => {
      seen.push(c);
    },
  });
  writeDeposit(join(root, "intake"), deposit());
  const a = accepted(only(reg.sweep()));
  assert.strictEqual(a.anchor, "DROPPED");

  const records = readBook(root, COMMITTER);
  const anchor = records[1] as AnchorRecord;
  assert.strictEqual(anchor.status, "DROPPED");
  assert.ok(anchor.droppedAt > 0, "a DROPPED anchor names no moment");
  assert.strictEqual(anchor.headHash, records[0].hash);
  assert.strictEqual(seen.length, 1, "the head was not presented exactly once");
  assert.strictEqual(seen[0].head_hash, records[0].hash);
  assert.strictEqual(
    seen[0].modality,
    "OFFERED",
    "the entry's declared modality did not ride its head"
  );
  // S105. Before this, the head said which WITNESS SET it belonged to and
  // nothing about which BOOK -- and this registrar drops every book's head
  // through this one committer under this one witness set.
  assert.strictEqual(
    seen[0].chain_id,
    `precommit:${COMMITTER}`,
    "the head did not name the book whose head it is"
  );
  assert.strictEqual(seen[0].witness_set_id, "test-set");
  assert.notStrictEqual(
    seen[0].chain_id,
    seen[0].witness_set_id,
    "the chain and the witness set are two different facts"
  );
});

check("RG-O2 . TWO BOOKS, ONE COMMITTER, ONE WITNESS SET -- two distinguishable heads", () => {
  // THE DEBT, IN ONE BODY (board S102-E). The registrar drops N book heads
  // through one committer; until S105 the two heads below differed only in a
  // hash, and nothing on either said which book it was the head of.
  const root = deployRoom();
  const intake = join(root, "intake");
  const seen: NamedHeadCommit[] = [];
  const drop = (c: NamedHeadCommit): void => {
    seen.push(c);
  };

  const asCommitter = registrarFor(root, UID_COMMITTER, { headCommitter: drop });
  writeDeposit(intake, deposit());
  accepted(only(asCommitter.sweep()));

  // A second book: the ARBITER's own, sealed by the arbiter into it.
  const asArbiter = registrarFor(root, UID_ARBITER, { headCommitter: drop });
  writeDeposit(intake, deposit({ depositor: ARBITER, book: ARBITER }));
  accepted(only(asArbiter.sweep()));

  assert.strictEqual(seen.length, 2);
  assert.deepStrictEqual(
    seen.map((c) => c.chain_id),
    [`precommit:${COMMITTER}`, `precommit:${ARBITER}`]
  );
  assert.deepStrictEqual(
    seen.map((c) => c.witness_set_id),
    ["test-set", "test-set"],
    "one witness set, which is exactly why the head had to carry more"
  );
});

check("RG-O3 . the chain name is <domain>:<owner>, and the owner is the BOOK", () => {
  // The grammar this registrar chose, asserted where a reader will look for it
  // rather than left implicit in a template string inside the drop.
  assert.strictEqual(precommitChainId(COMMITTER), `precommit:${COMMITTER}`);
  assert.strictEqual(precommitChainId("mica-doctor"), "precommit:mica-doctor");
  // A book name has already passed `isBarePrincipal` before any drop, so the
  // prefixed form cannot leave the intake's grammar: no whitespace, no path
  // separator, and at most 74 characters.
  const longest = precommitChainId("x".repeat(64));
  assert.strictEqual(longest.length, 74);
  assert.doesNotMatch(longest, /[\s\/\\]/);
});

check("RG-S106 . BOTH heads leave one sweep, through two drop targets", () => {
  // S106, and the reason the refusal chain got its OWN committer rather than
  // riding the one that was already there.
  //
  // `sweep()` calls `consume()` -- which presents the BOOK head -- and then
  // `log()` -- which presents the REFUSAL head -- inside the same loop
  // iteration, microseconds apart. The drop target filename IS the submitter id.
  // Through one committer the second drop renames over the first and the book
  // head is destroyed before the witness ticks; measured, S106 receipt §1. This
  // body is the positive statement: two ids, two files, both heads intact.
  const root = deployRoom();
  const witnessIntake = join(root, "witness-intake");
  mkdirSync(witnessIntake, { recursive: true });

  const reg = registrarFor(root, UID_COMMITTER, {
    headCommitter: fileDropNamedCommitter(witnessIntake, "mica-registrar"),
    refusalHeadCommitter: fileDropNamedCommitter(
      witnessIntake,
      "mica-registrar-refusal"
    ),
  });
  writeDeposit(join(root, "intake"), deposit());
  const a = accepted(only(reg.sweep()));
  assert.strictEqual(a.anchor, "DROPPED");

  const names = readdirSync(witnessIntake).sort();
  assert.deepStrictEqual(
    names,
    ["mica-registrar", "mica-registrar-refusal"],
    "one of the two heads was overwritten by the other"
  );

  const bookHead = JSON.parse(
    readFileSync(join(witnessIntake, "mica-registrar"), "utf8")
  ) as NamedHeadCommit;
  const refusalHead = JSON.parse(
    readFileSync(join(witnessIntake, "mica-registrar-refusal"), "utf8")
  ) as NamedHeadCommit;

  assert.strictEqual(bookHead.chain_id, `precommit:${COMMITTER}`);
  assert.strictEqual(refusalHead.chain_id, "refusal:registrar");
  assert.strictEqual(bookHead.head_hash, readBook(root, COMMITTER)[0].hash);
  // The refusal chain records ACCEPTED outcomes too -- this deposit was
  // accepted, and its acceptance is what the presented head sits on top of.
  const chain = readFileSync(reg.chainedLogPath(), "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const last = JSON.parse(chain[chain.length - 1]) as { kind: string; hash: string };
  assert.strictEqual(last.kind, "ACCEPTED");
  assert.strictEqual(refusalHead.head_hash, last.hash);
  // Two chains, one witness set, told apart by chain_id alone (S105-B, live).
  assert.strictEqual(bookHead.witness_set_id, refusalHead.witness_set_id);
});

check("RG-S106-B . an unwired refusal committer presents nothing and changes nothing", () => {
  const root = deployRoom();
  const witnessIntake = join(root, "witness-intake");
  mkdirSync(witnessIntake, { recursive: true });
  const reg = registrarFor(root, UID_COMMITTER, {
    headCommitter: fileDropNamedCommitter(witnessIntake, "mica-registrar"),
  });
  assert.strictEqual(reg.hasHeadCommitter, true);
  assert.strictEqual(reg.hasRefusalHeadCommitter, false);

  writeDeposit(join(root, "intake"), deposit());
  accepted(only(reg.sweep()));
  assert.deepStrictEqual(
    readdirSync(witnessIntake),
    ["mica-registrar"],
    "the book head, and nothing else: S106 is opt-in"
  );
});

check("RG-P · a witness it CANNOT REACH is CANNOT_SEE and CARRIES THE REASON", () => {
  const root = deployRoom();
  const reg = registrarFor(root, UID_COMMITTER, {
    headCommitter: () => {
      throw new Error("EACCES: permission denied, open '/var/lib/mica/witness/intake/x'");
    },
  });
  writeDeposit(join(root, "intake"), deposit());
  const a = accepted(only(reg.sweep()));
  assert.strictEqual(
    a.anchor,
    "CANNOT_SEE",
    "an unreachable witness was recorded as though nothing was attempted"
  );

  const anchor = readBook(root, COMMITTER)[1] as AnchorRecord;
  assert.strictEqual(anchor.status, "CANNOT_SEE");
  assert.ok(anchor.detail.includes("EACCES"), `the errno was dropped: ${anchor.detail}`);
  assert.strictEqual(anchor.droppedAt, 0);
});

check("RG-Q · CANNOT_SEE and NOT_DROPPED are DIFFERENT records, not one null", () => {
  // The E.2 double meaning, killed: the two cases must not be indistinguishable.
  const wired = deployRoom();
  const unwired = deployRoom();
  const a = registrarFor(wired, UID_COMMITTER, {
    headCommitter: () => {
      throw new Error("ENOENT");
    },
  });
  const b = registrarFor(unwired, UID_COMMITTER);
  writeDeposit(join(wired, "intake"), deposit());
  writeDeposit(join(unwired, "intake"), deposit());
  a.sweep();
  b.sweep();
  const x = readBook(wired, COMMITTER)[1] as AnchorRecord;
  const y = readBook(unwired, COMMITTER)[1] as AnchorRecord;
  assert.notStrictEqual(
    x.status,
    y.status,
    "a failed drop and a drop nobody tried came out the same"
  );
  assert.strictEqual(x.status, "CANNOT_SEE");
  assert.strictEqual(y.status, "NOT_DROPPED");
});

check("RG-R · the anchor is IN THE PREIMAGE — flip it on disk and the chain breaks", () => {
  const root = deployRoom();
  const reg = registrarFor(root, UID_COMMITTER);
  writeDeposit(join(root, "intake"), deposit());
  reg.sweep();
  const path = join(root, COMMITTER, "book.jsonl");

  const before = new PrecommitBook({ path });
  assert.strictEqual(before.getLoadState(), "LOADED_VERIFIED");

  // The custodian's own forgery: claim the head was dropped when it was not.
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
  const forged = JSON.parse(lines[1]) as Record<string, unknown>;
  forged.status = "DROPPED";
  writeFileSync(path, [lines[0], JSON.stringify(forged)].join("\n") + "\n", "utf8");

  const after = new PrecommitBook({ path });
  assert.strictEqual(
    after.getLoadState(),
    "CANNOT_VERIFY",
    "an anchor was flipped from NOT_DROPPED to DROPPED and the book still verified"
  );
  assert.ok((after.getLastError() ?? "").includes("verification failed"));
});

check("RG-S · one anchor per entry: a second is refused, so a failure cannot be buried", () => {
  const root = deployRoom();
  const reg = registrarFor(root, UID_COMMITTER);
  writeDeposit(join(root, "intake"), deposit());
  reg.sweep();
  const book = new PrecommitBook({ path: reg.bookPath(COMMITTER) });
  assert.throws(
    () =>
      book.anchor({
        ref: 0,
        status: "DROPPED",
        droppedAt: 5,
        headHash: book.getAll()[0].hash,
        detail: "",
        timestamp: 6,
        modality: "OFFERED",
      }),
    (err: Error) => {
      assert.ok(err.message.includes("already anchored"), err.message);
      return true;
    }
  );
});

check("RG-T · an anchor cannot be transplanted onto a different entry", () => {
  const root = deployRoom();
  const reg = registrarFor(root, UID_COMMITTER);
  writeDeposit(join(root, "intake"), deposit());
  reg.sweep();
  const book = new PrecommitBook({ path: reg.bookPath(COMMITTER) });
  assert.throws(
    () =>
      book.anchor({
        ref: 0,
        status: "DROPPED",
        droppedAt: 5,
        headHash: "0".repeat(64),
        detail: "",
        timestamp: 6,
        modality: "OFFERED",
      }),
    (err: Error) => {
      assert.ok(err.message.includes("whose hash is"), err.message);
      return true;
    }
  );
});

check("RG-U · an ANCHOR may not itself be anchored — the regress is refused", () => {
  const root = deployRoom();
  const reg = registrarFor(root, UID_COMMITTER);
  writeDeposit(join(root, "intake"), deposit());
  reg.sweep();
  const book = new PrecommitBook({ path: reg.bookPath(COMMITTER) });
  assert.throws(
    () =>
      book.anchor({
        ref: 1,
        status: "NOT_DROPPED",
        droppedAt: 0,
        headHash: book.getAll()[1].hash,
        detail: "",
        timestamp: 7,
        modality: "OFFERED",
      }),
    (err: Error) => {
      assert.ok(err.message.includes("itself an ANCHOR"), err.message);
      return true;
    }
  );
});

check("RG-V · an incoherent anchor is refused: status, moment and detail must agree", () => {
  const root = deployRoom();
  const reg = registrarFor(root, UID_COMMITTER);
  writeDeposit(join(root, "intake"), deposit());
  reg.sweep();
  const path = reg.bookPath(COMMITTER);
  const head = new PrecommitBook({ path }).getAll()[0].hash;
  const base = {
    ref: 0,
    headHash: head,
    timestamp: 9,
    modality: "OFFERED" as const,
  };
  const bad: readonly [string, Parameters<PrecommitBook["anchor"]>[0]][] = [
    ["CANNOT_SEE with no detail", { ...base, status: "CANNOT_SEE", droppedAt: 0, detail: "" }],
    ["DROPPED with no moment", { ...base, status: "DROPPED", droppedAt: 0, detail: "" }],
    ["NOT_DROPPED with a moment", { ...base, status: "NOT_DROPPED", droppedAt: 5, detail: "" }],
    ["DROPPED with a detail", { ...base, status: "DROPPED", droppedAt: 5, detail: "why" }],
  ];
  for (const [label, input] of bad) {
    const book = new PrecommitBook({ path });
    assert.throws(() => book.anchor(input), `${label} was accepted`);
  }
});

// =============================================================================
console.log("\n-- the vest: the custodian never receives a plaintext at seal time --");

check("RG-W · a COMMITMENT deposit carries a hash, and the book leaks nothing", () => {
  const root = deployRoom();
  const reg = registrarFor(root, UID_COMMITTER);
  const env = expectation({ target: "RG-W-TARGET-SENTINEL" });
  writeDeposit(
    join(root, "intake"),
    deposit({ body: { act: "COMMITMENT", sealed: sealForDeposit(env) } })
  );
  accepted(only(reg.sweep()));

  const raw = readFileSync(join(root, COMMITTER, "book.jsonl"), "utf8");
  assert.ok(!raw.includes("RG-W-TARGET-SENTINEL"), "the target reached the custodian");
  assert.ok(!raw.includes("salt"));
  assert.ok(!raw.includes("predictedValue"));
  assert.ok(raw.includes(computeSealHash(env)), "the seal is not in the book");

  // And the log the custodian keeps holds no plaintext either.
  //
  // S102: this read `reg.logPath()` -- the UNCHAINED log, which the registrar no
  // longer writes. Writing both would keep an editable second copy of every
  // record, which is the defect the chaining removes. The property asserted is
  // unchanged; only the file it is asserted about moved.
  const log = readFileSync(reg.chainedLogPath(), "utf8");
  assert.ok(!log.includes("RG-W-TARGET-SENTINEL"), "the LOG leaked the target");
});

check("RG-X · a deposited seal that is not 64 hex is refused by the book", () => {
  const root = deployRoom();
  const reg = registrarFor(root, UID_COMMITTER);
  writeDeposit(
    join(root, "intake"),
    deposit({ body: { act: "COMMITMENT", sealed: "not-a-hash" } })
  );
  const r = refusal(only(reg.sweep()));
  assert.strictEqual(r.reason, "BOOK_REFUSED");
  assert.ok(r.detail.includes("64 lowercase hex"), r.detail);
});

// =============================================================================
console.log("\n-- end to end: seal, reveal, grade, across two principals --");

check("RG-Y · a full round trips through the registrar and the chain verifies", () => {
  const root = deployRoom();
  const intake = join(root, "intake");
  const heads: NamedHeadCommit[] = [];
  const drop = (c: NamedHeadCommit): void => {
    heads.push(c);
  };
  const env = expectation();

  // 1 · the committer seals, keeping the envelope.
  const asCommitter = registrarFor(root, UID_COMMITTER, { headCommitter: drop });
  writeDeposit(intake, deposit({ body: { act: "COMMITMENT", sealed: sealForDeposit(env) } }));
  const c = accepted(only(asCommitter.sweep()));
  assert.strictEqual(c.sequenceNumber, 0);
  assert.strictEqual(c.anchor, "DROPPED");

  // 2 · the committer reveals, and the BOOK decides MATCH.
  writeDeposit(intake, deposit({ body: { act: "REVEAL", ref: 0, expectation: env } }));
  const r = accepted(only(asCommitter.sweep()));
  assert.strictEqual(r.sequenceNumber, 2, "the anchor took seq 1");

  // 3 · the ARBITER grades. A different principal, into the committer's book.
  const asArbiter = registrarFor(root, UID_ARBITER, { headCommitter: drop });
  writeDeposit(
    intake,
    deposit({
      depositor: ARBITER,
      book: COMMITTER,
      body: {
        act: "GRADING",
        ref: 0,
        verdict: "GREEN",
        ground: "the named field held the predicted value",
      },
    })
  );
  const g = accepted(only(asArbiter.sweep()));
  assert.strictEqual(g.act, "GRADING");

  const records = readBook(root, COMMITTER);
  assert.deepStrictEqual(
    records.map((x) => x.kind),
    ["COMMITMENT", "ANCHOR", "REVEAL", "ANCHOR", "GRADING", "ANCHOR"]
  );

  const book = new PrecommitBook({ path: join(root, COMMITTER, "book.jsonl") });
  assert.strictEqual(book.getLoadState(), "LOADED_VERIFIED");
  assert.deepStrictEqual(book.verify(), { valid: true, brokenAt: null });

  // The reveal matched, decided by the book and not by the depositor.
  const reveal = records[2] as { readonly sealCheck: string; readonly recomputed: string };
  assert.strictEqual(reveal.sealCheck, "MATCH");
  assert.strictEqual(reveal.recomputed, computeSealHash(env));

  // Ruling 4 holds on the artifact: the grader is not the committer.
  const grading = records[4] as { readonly graderId: string };
  assert.strictEqual(grading.graderId, ARBITER);
  assert.notStrictEqual(grading.graderId, (records[0] as { committerId: string }).committerId);

  // Every non-anchor entry has an anchor, and every head was presented.
  for (const seq of [0, 2, 4]) {
    const reading = book.anchorFor(seq);
    assert.strictEqual(reading.state, "RECORDED", `seq ${String(seq)} is unanchored`);
    if (reading.state === "RECORDED") {
      assert.strictEqual(reading.anchor.status, "DROPPED");
      assert.strictEqual(reading.anchor.headHash, records[seq].hash);
    }
  }
  assert.strictEqual(heads.length, 3);
});

// =============================================================================
console.log("\n-- the legacy book: frozen, readable, and never called NOT_DROPPED --");

check("RG-Z · a book with no anchors reads PRE_ANCHOR_SCHEMA, not NOT_DROPPED", () => {
  // The real S98/S99 artifact, at bytes, from the repository.
  const legacy = join(__dirname, "..", "precommit", "first-commitment.jsonl");
  const book = new PrecommitBook({ path: legacy });
  assert.strictEqual(book.getLoadState(), "LOADED_VERIFIED", "the frozen book stopped verifying");
  assert.strictEqual(book.length, 3);
  for (const seq of [0, 1, 2]) {
    assert.strictEqual(
      book.anchorFor(seq).state,
      "PRE_ANCHOR_SCHEMA",
      `seq ${String(seq)} was defaulted instead of surfaced`
    );
  }
});

check("RG-Z2 · in an ANCHORING book, a missing anchor is NOT_ANCHORED — a finding", () => {
  const root = deployRoom();
  const reg = registrarFor(root, UID_COMMITTER);
  writeDeposit(join(root, "intake"), deposit());
  reg.sweep();
  // Append a second entry by hand, with no anchor after it.
  const book = new PrecommitBook({ path: reg.bookPath(COMMITTER) });
  book.sealDeposited({
    sealed: "b".repeat(64),
    committerId: COMMITTER,
    timestamp: 3,
    modality: "OFFERED",
  });
  const reread = new PrecommitBook({ path: reg.bookPath(COMMITTER) });
  assert.strictEqual(reread.anchorFor(0).state, "RECORDED");
  assert.strictEqual(
    reread.anchorFor(2).state,
    "NOT_ANCHORED",
    "an unanchored entry in an anchoring book was reported as pre-schema"
  );
});

// =============================================================================
console.log("\n-- the sentences this module is allowed to say --");

check("RG-AA · the registrar certifies nothing, and says so", () => {
  assert.ok(THE_REGISTRAR_CERTIFIES_NOTHING.includes("custodian, not a judge"));
  assert.ok(!THE_REGISTRAR_CERTIFIES_NOTHING.includes("guarantee"));
  assert.deepStrictEqual([...DEFAULT_GRADERS], ["mica-doctor", "mica-arbiter"]);
});

check("RG-AB · validateDeposit is closed: it returns null and never throws", () => {
  for (const junk of [null, undefined, 0, "", [], { act: "COMMITMENT" }]) {
    assert.strictEqual(validateDeposit(junk), null, `accepted ${JSON.stringify(junk)}`);
  }
  assert.notStrictEqual(validateDeposit(deposit()), null);
});

// =============================================================================
console.log("\n-- the depositor's one line: it looks up who it is, it is not told --");

check("RG-AC · a claim file carries no committerId and no salt, and one with either is refused", () => {
  assert.notStrictEqual(
    validateClaim({ type: "verdict", target: "t", predictedValue: "v" }),
    null
  );
  // THE WHOLE POINT: a claim that arrives carrying its own salt would let the
  // salt exist somewhere other than the committing process, which is the
  // property every earlier A9 commitment on this project failed to have.
  for (const junk of [
    { type: "verdict", target: "t", predictedValue: "v", salt: "s".repeat(32) },
    { type: "verdict", target: "t", predictedValue: "v", committerId: "x" },
    { type: "claim+rule", target: "t", predictedValue: "v" },
    { type: "verdict", target: "", predictedValue: "v" },
    { type: "verdict", target: "t", predictedValue: "" },
    { type: "verdict", target: "t" },
    null,
    "nope",
  ]) {
    assert.strictEqual(validateClaim(junk), null, `accepted ${JSON.stringify(junk)}`);
  }
});

check("RG-AD · resolveSelf reads the SAME roster the registrar reads, and refuses a stranger", () => {
  const dir = mkdtempSync(join(tmpdir(), "mica-roster-"));
  const path = join(dir, "roster.json");
  writeFileSync(path, JSON.stringify({ "992": "mica-doctor", "989": "mica-arbiter" }), "utf8");
  assert.strictEqual(resolveSelf(path, 992).name, "mica-doctor");
  assert.strictEqual(resolveSelf(path, 992).entries, 2);
  assert.throws(
    () => resolveSelf(path, 1000),
    (err: Error) => {
      assert.ok(err.message.includes("UNKNOWN_DEPOSITOR"), err.message);
      assert.ok(err.message.includes("Run this as the committing principal"), err.message);
      return true;
    }
  );
});

check("RG-AE · the built frame names the RESOLVED self, so it cannot disagree with the uid", () => {
  const d = buildDeposit(
    "mica-doctor",
    "mica-doctor",
    { act: "COMMITMENT", sealed: "a".repeat(64) },
    "OFFERED",
    123
  );
  assert.strictEqual(d.depositor, "mica-doctor");
  assert.notStrictEqual(validateDeposit(d), null, "the built frame is not a valid deposit");
});

check("RG-AF · option parsing refuses a flag with no value rather than eating the next flag", () => {
  assert.deepStrictEqual(parseOptions(["--ref", "0", "--verdict", "GREEN"]), {
    ref: "0",
    verdict: "GREEN",
  });
  assert.throws(() => parseOptions(["--ref", "--verdict"]), /needs a value/);
  assert.throws(() => parseOptions(["--ref"]), /needs a value/);
  assert.throws(() => parseOptions(["ref", "0"]), /unexpected argument/);
});


// ══════════════════════════════════════════════════════════════════════════════
// RB · THE SECOND BOOK (S134 Rb) — PATH 2, wired
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── RB · the record book at the same door ──");

/** The record book's root is its OWN deployment act; made here by name. */
function deployRecordRoom(): string {
  return mkdtempSync(join(tmpdir(), "mica-record-"));
}

/** Whoever owns the frame. The roster decides that, never the body. */
const SUBJECT = STRANGER;

function escalationBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    act: "ESCALATION",
    addressee: "arbiter",
    addresseeVerbatim: "Arbiter.",
    recordNeeded: "An arbiter-issued sunset entry.",
    captureSha256: "a".repeat(64),
    runId: "pilot9-n5",
    scenarioId: "n5-w2-obsolescence-declared-not-assertable",
    variant: "STRESS",
    ...over,
  };
}

function depositFrame(
  root: string,
  book: string,
  depositor: string,
  body: Record<string, unknown>
): string {
  return writeDeposit(join(root, "intake"), {
    depositor,
    book,
    body,
    modality: "NOT_AN_INSTRUCTION",
    timestamp: 1_700_000_000_000,
  } as unknown as Deposit);
}

check("RB-A · the three record acts are the record book's, and the other three are not", () => {
  assert.deepStrictEqual([...RECORD_KINDS], ["ESCALATION", "REQUEST", "PILOT_CHAIN_REVIEWED"]);
  for (const a of RECORD_KINDS) assert.ok(isRecordAct(a), a);
  for (const a of ["COMMITMENT", "REVEAL", "GRADING"]) assert.ok(!isRecordAct(a), a);
});

check("RB-B · an ESCALATION into the depositor's OWN book is accepted and chained", () => {
  const root = deployRoom();
  const recordRoot = deployRecordRoom();
  const heads: NamedHeadCommit[] = [];
  const reg = registrarFor(root, UID_STRANGER, { recordRoot, headCommitter: (c) => heads.push(c) });
  depositFrame(root, SUBJECT, SUBJECT, escalationBody());
  const swept = reg.sweep();
  assert.strictEqual(swept.outcomes.length, 1, JSON.stringify(swept.outcomes));
  const out = swept.outcomes[0];
  assert.strictEqual(out.outcome, "ACCEPTED", JSON.stringify(out));
  const accepted = out as AcceptedDeposit;
  assert.strictEqual(accepted.act, "ESCALATION");
  assert.strictEqual(accepted.sequenceNumber, 0);

  // THE HEAD IS UNDER THIS BOOK'S OWN CHAIN ID, never the precommit namespace —
  // the two chains carry independent sequence numbers, and one namespace over
  // both would present two different records as seq N of one chain.
  assert.strictEqual(heads.length, 1);
  assert.strictEqual(heads[0].chain_id, recordChainId(SUBJECT));
  assert.notStrictEqual(heads[0].chain_id, precommitChainId(SUBJECT));

  // NO ANCHOR RECORD. Null here means "this book writes none" (named-head-owed)
  // and is NOT the pre-commitment book's could-not-write-the-anchor.
  assert.strictEqual(accepted.anchorSequenceNumber, null);
  assert.strictEqual(accepted.anchor, "DROPPED");

  const book = new RecordBook({ path: reg.recordBookPath(SUBJECT) });
  assert.strictEqual(book.getAll().length, 1);
  const rec = book.getAll()[0] as unknown as {
    addressee: string;
    addresseeVerbatim: string;
    depositor: string;
  };
  assert.strictEqual(rec.depositor, SUBJECT);
  // BOTH, ALWAYS — the resolved title beside the text the reply wrote.
  assert.strictEqual(rec.addressee, "arbiter");
  assert.strictEqual(rec.addresseeVerbatim, "Arbiter.");
  assert.strictEqual(book.verify().state, "VERIFIED");
});

check("RB-C · a WRONG-BOOK ESCALATION is refused, and the refusal names the rule", () => {
  // The proof the entitlement holds for the new acts: own-book only, for every
  // depositor. The frame CLAIMS the arbiter's book; the owner uid says otherwise.
  const root = deployRoom();
  const recordRoot = deployRecordRoom();
  const reg = registrarFor(root, UID_STRANGER, { recordRoot });
  const frame = depositFrame(root, ARBITER, SUBJECT, escalationBody());
  const swept = reg.sweep();
  const out = swept.outcomes[0];
  assert.strictEqual(out.outcome, "REFUSED", JSON.stringify(out));
  const refused = out as RefusedDeposit;
  assert.strictEqual(refused.reason, "WRONG_BOOK");
  assert.ok(refused.detail.includes("ESCALATION"), refused.detail);
  assert.ok(refused.detail.includes("OWN book"), refused.detail);
  // Refused for a fact about the DEPOSIT, so the frame IS consumed.
  // `writeDeposit` returns the FULL PATH; joining it under the intake again
  // would make this assertion vacuously true against a path that never existed.
  assert.ok(!existsSync(frame), "a refused-on-content frame is consumed");
  assert.ok(!existsSync(reg.recordBookPath(ARBITER)));
});

check("RB-D · no record root wired: refused, and the frame is LEFT IN THE INTAKE", () => {
  // The deposit is fine; the deployment is not. Same species as CANNOT_SEE_FRAME
  // and treated the same — which is only TRUE because RECORD_BOOK_NOT_WIRED is in
  // DEPLOYMENT_FACT_REASONS. Asserted here rather than trusted, because the
  // refusal's own detail string promises the frame survives.
  assert.ok(DEPLOYMENT_FACT_REASONS.includes("RECORD_BOOK_NOT_WIRED"));
  const root = deployRoom();
  const reg = registrarFor(root, UID_STRANGER);
  assert.strictEqual(reg.hasRecordBook, false);
  const frame = depositFrame(root, SUBJECT, SUBJECT, escalationBody());
  const swept = reg.sweep();
  const refused = swept.outcomes[0] as RefusedDeposit;
  assert.strictEqual(refused.reason, "RECORD_BOOK_NOT_WIRED");
  assert.ok(existsSync(frame), "a good deposit is NOT eaten by a missing act");
});

check("RB-E · a record-book root that is absent does not come up", () => {
  const root = deployRoom();
  const recordRoot = deployRecordRoom();
  rmSync(recordRoot, { recursive: true, force: true });
  assert.throws(
    () => registrarFor(root, UID_STRANGER, { recordRoot }),
    (err: Error) => {
      assert.ok(err.message.includes("DEPLOYMENT ACT"), err.message);
      return true;
    }
  );
});

check("RB-F · a malformed record body is MALFORMED_DEPOSIT, not a half-written record", () => {
  const root = deployRoom();
  const recordRoot = deployRecordRoom();
  const reg = registrarFor(root, UID_STRANGER, { recordRoot });
  depositFrame(root, SUBJECT, SUBJECT, escalationBody({ captureSha256: "short" }));
  depositFrame(root, SUBJECT, SUBJECT, escalationBody({ addressee: "" }));
  depositFrame(root, SUBJECT, SUBJECT, escalationBody({ extra: 1 }));
  const swept = reg.sweep();
  assert.strictEqual(swept.outcomes.length, 3);
  for (const out of swept.outcomes) {
    assert.strictEqual(out.outcome, "REFUSED", JSON.stringify(out));
    assert.strictEqual((out as RefusedDeposit).reason, "MALFORMED_DEPOSIT");
  }
  assert.ok(!existsSync(reg.recordBookPath(SUBJECT)));
});

check("RB-G · PILOT_CHAIN_REVIEWED goes into the ARBITER'S OWN book — no cross-book arm", () => {
  const root = deployRoom();
  const recordRoot = deployRecordRoom();
  const reg = registrarFor(root, UID_ARBITER, { recordRoot });
  const body = {
    act: "PILOT_CHAIN_REVIEWED",
    chainSha256: "b".repeat(64),
    reviewLogSequenceNumber: 7,
  };
  depositFrame(root, ARBITER, ARBITER, body);
  // The SAME act aimed at somebody else's book is refused even though the
  // arbiter IS a rostered grader: Rb keeps the grader arm to GRADING alone.
  depositFrame(root, SUBJECT, ARBITER, body);
  const swept = reg.sweep();
  const accepted = swept.outcomes.filter((o) => o.outcome === "ACCEPTED");
  assert.strictEqual(accepted.length, 1, JSON.stringify(swept.outcomes));
  const refused = swept.outcomes.find((o) => o.outcome === "REFUSED") as RefusedDeposit;
  assert.strictEqual(refused.reason, "WRONG_BOOK");
  const book = new RecordBook({ path: reg.recordBookPath(ARBITER) });
  assert.strictEqual(book.getAll().length, 1);
  assert.strictEqual(book.verify().state, "VERIFIED");
});

check("RB-H · an EMPTY record book verifies as EMPTY, which is not VERIFIED", () => {
  // A chain with nothing in it has nothing broken. Printing that as a pass reads
  // identically to a book full of records that all reproduce — the blank mirror.
  const recordRoot = deployRecordRoom();
  mkdirSync(join(recordRoot, SUBJECT), { recursive: true });
  const path = join(recordRoot, SUBJECT, "records.jsonl");
  writeFileSync(path, "");
  const book = new RecordBook({ path });
  const v = book.verify();
  assert.strictEqual(v.state, "EMPTY");
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.brokenAt, null);
  assert.ok(v.detail.includes("nothing is attested"), v.detail);
  assert.strictEqual(book.countsLine(), "record book: EMPTY");
});

check("RB-I · the DEPOSITOR is in the preimage — swap it on disk and the chain breaks", () => {
  const root = deployRoom();
  const recordRoot = deployRecordRoom();
  const reg = registrarFor(root, UID_STRANGER, { recordRoot });
  depositFrame(root, SUBJECT, SUBJECT, escalationBody());
  depositFrame(root, SUBJECT, SUBJECT, escalationBody({ addressee: "doctor", addresseeVerbatim: "doctor" }));
  reg.sweep();
  const path = reg.recordBookPath(SUBJECT);
  const lines = readFileSync(path, "utf8").trim().split("\n");
  assert.strictEqual(lines.length, 2);
  // "Who deposited this" is the entire reason this book exists rather than a
  // journal line the depositor writes about itself. A depositor stored but not
  // hashed could be swapped with the chain still verifying.
  const tampered = JSON.parse(lines[0]) as Record<string, unknown>;
  tampered.depositor = ARBITER;
  writeFileSync(path, [JSON.stringify(tampered), lines[1]].join("\n") + "\n");
  const book = new RecordBook({ path });
  assert.strictEqual(book.getLoadState(), "CANNOT_VERIFY");
  assert.ok((book.getLastError() ?? "").length > 0);
});

console.log(
  `\n${String(passed + failed)} tests: ${String(passed)} passed, ${String(failed)} failed`
);
if (failed > 0) process.exit(1);
