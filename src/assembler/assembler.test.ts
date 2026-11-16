// ── MICA · the Assembler — tests ──────────────────────────────────────────────
//
// The assembler is the first PRODUCER Sig's F4 leg has ever had. Half of what
// follows is about the join; the other half is about the two things a producer
// must never do — judge, and repair.

import * as assert from "assert";
import { spawnSync } from "child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import {
  ASSEMBLER_ID,
  ASSEMBLY_IS_NOT_A_VERDICT,
  NO_GRADER_READS_IR_RECORDS,
  NO_IR_GRADER_IS_A_STATED_HOLE,
  UNREVEALED_IR_IS_NOT_COUNTABLE,
  AssemblerDeploymentActMissingError,
  AssemblerRefused,
  THE_GRANT_IS_THE_EVIDENCE,
  assemble,
  decideOrderEvidence,
  declareSweepPeriod,
  deploymentActProposal,
  isSweepPeriodRefusal,
  parseBook,
  readBookOrSignpost,
  declaredIntentRecordClass,
  MIRRORED_INTENT_RECORD_CLASSES,
  MIRRORED_INTENT_RECORD_CLASS_FIELD,
} from "./assembler";
import type { DeclaredSweepPeriod, EmittedProbeRecord, MirroredBookRecord, ObservationInput } from "./assembler";

// THE DRIFT CHECK, half one: compile-time. These are `import type` only, so the
// SHIPPED module keeps its zero import edges while the SUITE still fails to
// compile the day either shape moves. See assertions below.
import type { ProbeRecord, ProbeSource } from "../mica/sig";
import { assessSig } from "../mica/sig";
import { MicaFixtureLog } from "../mica/fixture-log";
import type { SealedPlaintext, RevealRecord, CommitmentRecord } from "../precommit/precommit";

let passed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const root = mkdtempSync(join(tmpdir(), "mica-assembler-"));

// A minimal readable log, so F4 can be exercised end to end on real output.
const sigLogPath = join(root, "sig-log.jsonl");
const seed = new MicaFixtureLog({ path: sigLogPath });
seed.append({ timestamp: 1_000, moduleId: "m", eventType: "a", outcome: "ok" });
seed.append({ timestamp: 2_000, moduleId: "m", eventType: "b", outcome: "ok" });
const sigLog = new MicaFixtureLog({ path: sigLogPath });

/**
 * Ask F4's own VALIDATOR whether it would accept a record. Returns null when the
 * record is well-formed.
 *
 * ⚠ Only the MALFORMED-RECORD refusal counts. F4 also reads CANNOT_ASSESS for
 * records that are perfectly well-formed and simply cannot be read — an
 * unestablished order, a `claim+rule` expectation, a MISMATCHed seal. Treating
 * those as validation failures would make this helper assert that F4 rejects
 * its own correct behaviour.
 */
function malformedFor(rec: ProbeRecord): string | null {
  const r = assessSig(sigLog, {
    readableLoadStates: ["LOADED_VERIFIED"],
    clockToleranceMs: 0,
    preconditionMap: { b: ["a"] },
    probeSource: [rec],
  });
  const f4 = r.flags[3];
  const malformed = f4.blindPaths.find((b) => b.detail.includes("malformed record"));
  return malformed === undefined ? null : malformed.detail;
}

// ── Fixtures — a small book in the real shape ────────────────────────────────

function frame(seq: number, ts: number) {
  return {
    sequenceNumber: seq,
    previousHash: seq === 0 ? "" : `h${seq - 1}`,
    hash: `h${seq}`,
    timestamp: ts,
    modality: "OFFERED",
  };
}

function commitment(seq: number, committerId = "mica-doctor", sealed = `seal${seq}`) {
  return { ...frame(seq, 1_000 + seq), kind: "COMMITMENT", committerId, sealed };
}
function reveal(
  seq: number,
  ref: number,
  over: Partial<{ type: string; target: string; predictedValue: string; sealCheck: string }> = {}
) {
  return {
    ...frame(seq, 1_000 + seq),
    kind: "REVEAL",
    ref,
    plaintext: {
      type: over.type ?? "verdict",
      target: over.target ?? "gate2/direction",
      predictedValue: over.predictedValue ?? "GREEN",
      committerId: "mica-doctor",
      salt: "s".repeat(32),
    },
    sealCheck: over.sealCheck ?? "MATCH",
    recomputed: `seal${ref}`,
  };
}
function anchor(seq: number, ref: number, droppedAt: number, status = "DROPPED") {
  return {
    ...frame(seq, 1_000 + seq),
    kind: "ANCHOR",
    ref,
    status,
    droppedAt,
    headHash: `h${ref}`,
    detail: "",
  };
}

function bookText(records: readonly object[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

function obs(over: Partial<ObservationInput> = {}): ObservationInput {
  return {
    commitmentSeq: 0,
    target: "gate2/direction",
    observedValue: "GREEN",
    observedBy: "mica-arbiter",
    observedAt: 5_000,
    provenance: "frozen-book check output",
    ...over,
  };
}

const BOOK = bookText([commitment(0), reveal(1, 0), anchor(2, 0, 2_000)]);

/** BOOK's anchor droppedAt, so the S103 deltas are arithmetic, not magic. */
const ANCHOR_AT = 2_000;

/** A declaration for the tests, so the helper's callers stay one number long. */
function declaredMs(ms: number): DeclaredSweepPeriod {
  return { ms, declaredBy: "test-arbiter", basis: "fixture" };
}

function assembleWith(
  raw: string,
  observations: readonly ObservationInput[],
  sweepPeriodMs?: number
) {
  return assemble({
    bookPath: "/test/book.jsonl",
    book: parseBook(raw),
    observations,
    sweepPeriod: sweepPeriodMs === undefined ? undefined : declaredMs(sweepPeriodMs),
    ranAs: "uid 4242",
  });
}

// ── Happy path ──────────────────────────────────────────────────────────────

console.log("\n── the join ──");

const happy = assembleWith(BOOK, [obs()]);
check("COMMITMENT ↔ REVEAL ↔ observation joins into one probe record", () => {
  assert.strictEqual(happy.probeSource.length, 1);
  const r = happy.probeSource[0];
  assert.strictEqual(r.commitmentSeq, 0);
  assert.strictEqual(r.sealedDigest, "seal0");
  assert.strictEqual(r.predictedValue, "GREEN");
  assert.strictEqual(r.target, "gate2/direction");
  assert.strictEqual(r.committerId, "mica-doctor");
  assert.strictEqual(r.observed.observedValue, "GREEN");
});
check("provenance names the book, both records, the observer and the principal", () => {
  const p = happy.probeSource[0].provenance;
  assert.ok(p.includes("/test/book.jsonl"));
  assert.ok(p.includes("COMMITMENT seq 0"));
  assert.ok(p.includes("REVEAL seq 1"));
  assert.ok(p.includes("frozen-book check output"));
  assert.ok(p.includes("uid 4242"), "the principal it RAN AS, not the one a doc names");
});
check("observedValue is carried VERBATIM — no parse, trim, or normalise", () => {
  const weird = "  GREEN\t\n mixed  case  ";
  const r = assembleWith(BOOK, [obs({ observedValue: weird })]);
  assert.strictEqual(r.probeSource[0].observed.observedValue, weird);
});
check("an empty predictedValue survives the join — the book permits it", () => {
  const b = bookText([commitment(0), reveal(1, 0, { predictedValue: "" })]);
  const r = assembleWith(b, [obs()]);
  assert.strictEqual(r.probeSource[0].predictedValue, "");
});

// ── EVIDENCE, NEVER JUDGMENT ────────────────────────────────────────────────

console.log("\n── evidence assembly, never judgment ──");

check("THE BAR — the assembler never compares predicted to observed", () => {
  // Both directions: a match and a divergence produce the SAME record shape,
  // with no verdict field, no flag, and no difference in disposition.
  const match = assembleWith(BOOK, [obs({ observedValue: "GREEN" })]);
  const diverge = assembleWith(BOOK, [obs({ observedValue: "RED" })]);
  assert.strictEqual(match.probeSource.length, diverge.probeSource.length);
  assert.deepStrictEqual(
    Object.keys(match.probeSource[0]).sort(),
    Object.keys(diverge.probeSource[0]).sort()
  );
  assert.strictEqual(match.withheld.length, diverge.withheld.length);
});
check("and the source says so: no predicted-vs-observed comparison exists in the module", () => {
  const src = readFileSync(join(__dirname, "assembler.ts"), "utf8");
  // Any line comparing the two values would have both identifiers and an
  // equality/inequality operator on it.
  const offending = src
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .filter((l) => /predictedValue/.test(l) && /observedValue/.test(l))
    .filter((l) => /[!=]==|[<>]/.test(l));
  assert.deepStrictEqual(offending, [], "the assembler must not judge");
});
check("the seal is never recomputed — the book's own sealCheck is carried", () => {
  const src = readFileSync(join(__dirname, "assembler.ts"), "utf8");
  assert.ok(!/createHash|sha256|crypto/i.test(src), "no hashing in an assembler");
  const mism = assembleWith(
    bookText([commitment(0), reveal(1, 0, { sealCheck: "MISMATCH" })]),
    [obs()]
  );
  assert.strictEqual(mism.probeSource[0].sealCheck, "MISMATCH");
});
check("MISMATCH is CARRIED, never repaired — F4 reads it BLIND", () => {
  const mism = assembleWith(
    bookText([commitment(0), reveal(1, 0, { sealCheck: "MISMATCH" })]),
    [obs()]
  );
  assert.strictEqual(mism.probeSource.length, 1, "a broken seal is still evidence");
  assert.strictEqual(mism.withheld.length, 0, "and it is not withheld");
});
check("the emitted artifact carries its own ceiling", () => {
  assert.ok(happy.ceiling.includes(ASSEMBLY_IS_NOT_A_VERDICT));
  assert.ok(happy.ceiling.includes(THE_GRANT_IS_THE_EVIDENCE));
  assert.ok(THE_GRANT_IS_THE_EVIDENCE.includes("never by"));
});

// ── Withheld, never dropped ─────────────────────────────────────────────────

console.log("\n── what is withheld, and said out loud ──");

check("S101 · an observation with NO commitment is EMITTED as UNSEALED, not withheld", () => {
  // Ruled S101, option (a): unsealed observations belong countable inside the
  // sensor's own report, not in a side pile nothing consumes. Before the ruling
  // this was withheld, because the record shape made it unbuildable.
  const r = assembleWith(BOOK, [obs({ commitmentSeq: 99 })]);
  assert.strictEqual(r.withheld.length, 0);
  assert.strictEqual(r.probeSource.length, 1);
  const rec = r.probeSource[0];
  assert.strictEqual(rec.sealCheck, "UNSEALED");
  assert.strictEqual(rec.commitmentSeq, 99, "the sequence the OBSERVER named is kept");
  assert.strictEqual(rec.target, "gate2/direction", "from the observation, its only source");
  assert.ok(rec.provenance.includes("readable, not punishable"));
});
check("NOTHING IS MANUFACTURED — the seal-derived fields are ABSENT, not empty", () => {
  // An empty string would be a value that happens to be blank; that is the
  // ledger S100-1 defect. Absence says there is no such thing to fill.
  const rec = assembleWith(BOOK, [obs({ commitmentSeq: 99 })]).probeSource[0];
  for (const f of ["sealedDigest", "expectationType", "predictedValue", "committerId", "orderEvidence"]) {
    assert.ok(!(f in rec), `${f} must be ABSENT on an unsealed record, not empty`);
  }
});
check("and the emitted JSON carries no such keys either", () => {
  const rec = assembleWith(BOOK, [obs({ commitmentSeq: 99 })]).probeSource[0];
  const round = JSON.parse(JSON.stringify(rec)) as Record<string, unknown>;
  assert.deepStrictEqual(
    Object.keys(round).sort(),
    ["commitmentSeq", "observed", "provenance", "sealCheck", "target"]
  );
});
check("an observation on a still-SEALED commitment is AWAITING_REVEAL, not a fault", () => {
  const r = assembleWith(bookText([commitment(0)]), [obs()]);
  assert.strictEqual(r.probeSource.length, 0);
  assert.strictEqual(r.withheld[0].reason, "AWAITING_REVEAL");
  assert.ok(r.withheld[0].detail.includes("pre-commitment working, not a fault"));
});
check("a withheld observation keeps its own provenance for a reader to chase", () => {
  const r = assembleWith(bookText([commitment(0)]), [obs({ provenance: "run 7 stdout" })]);
  assert.strictEqual(r.withheld[0].reason, "AWAITING_REVEAL");
  assert.strictEqual(r.withheld[0].observation.provenance, "run 7 stdout");
});
check("AWAITING_REVEAL stays withheld — it is NOT unsealed, and the difference is real", () => {
  // A sealed-but-unrevealed commitment HAS an expectation, still under seal.
  // Emitting it as UNSEALED would state that nothing was ever sealed for it,
  // which is false about the book.
  const r = assembleWith(bookText([commitment(0)]), [obs()]);
  assert.strictEqual(r.probeSource.length, 0, "never emitted as an unsealed record");
  assert.strictEqual(r.withheld[0].reason, "AWAITING_REVEAL");
});
check("THE CROSS-CHECK — an observation naming a different target than the seal refuses", () => {
  assert.throws(
    () => assembleWith(BOOK, [obs({ target: "some/other/thing" })]),
    (err: unknown) => {
      assert.ok(err instanceof AssemblerRefused);
      assert.ok((err as Error).message.includes("but the REVEAL sealed"));
      return true;
    }
  );
});
check("an observation that names no target at all refuses", () => {
  assert.throws(
    () => assembleWith(BOOK, [obs({ target: "" })]),
    (err: unknown) => {
      assert.ok(err instanceof AssemblerRefused);
      assert.ok((err as Error).message.includes("names no target"));
      return true;
    }
  );
});

// ── Order evidence — the S100 option-(c) bar ────────────────────────────────

console.log("\n── order evidence: within-sweep order is not evidence ──");

check("NO sweep period injected ⇒ ORDER_NOT_ESTABLISHED, and it says why", () => {
  assert.strictEqual(happy.probeSource[0].orderEvidence, "ORDER_NOT_ESTABLISHED");
  assert.ok(happy.orderReasons.get(0)!.includes("no sweep period was declared"));
});
check("SAME SWEEP ⇒ ORDER_NOT_ESTABLISHED even though the clock says later", () => {
  // anchor droppedAt 2000, observed 2500, sweep 60000: later by the clock, but
  // inside one sweep. The chain would assert an order; this refuses to.
  const r = assembleWith(BOOK, [obs({ observedAt: 2_500 })], 60_000);
  assert.strictEqual(r.probeSource[0].orderEvidence, "ORDER_NOT_ESTABLISHED");
  assert.ok(r.orderReasons.get(0)!.includes("within-sweep order is not evidence"));
});
check("CLEARS THE SWEEP ⇒ SEALED_BEFORE_OBSERVED, with the arithmetic named", () => {
  const r = assembleWith(BOOK, [obs({ observedAt: 100_000 })], 60_000);
  assert.strictEqual(r.probeSource[0].orderEvidence, "SEALED_BEFORE_OBSERVED");
  assert.ok(r.orderReasons.get(0)!.includes("clearing the sweep period"));
});
check("no ANCHOR ⇒ ORDER_NOT_ESTABLISHED — chain position alone is not evidence", () => {
  const r = assembleWith(bookText([commitment(0), reveal(1, 0)]), [obs()], 60_000);
  assert.strictEqual(r.probeSource[0].orderEvidence, "ORDER_NOT_ESTABLISHED");
  assert.ok(r.orderReasons.get(0)!.includes("no ANCHOR record"));
});
check("a CANNOT_SEE anchor establishes nothing", () => {
  const b = bookText([commitment(0), reveal(1, 0), anchor(2, 0, 0, "CANNOT_SEE")]);
  const r = assembleWith(b, [obs({ observedAt: 100_000 })], 60_000);
  assert.strictEqual(r.probeSource[0].orderEvidence, "ORDER_NOT_ESTABLISHED");
  assert.ok(r.orderReasons.get(0)!.includes("not DROPPED"));
});
check("decideOrderEvidence is exhaustive over its refusal reasons", () => {
  assert.strictEqual(
    decideOrderEvidence(undefined, 1, declaredMs(1)).evidence,
    "ORDER_NOT_ESTABLISHED"
  );
});

// ── Refuse to repair ────────────────────────────────────────────────────────

console.log("\n── refusal, never repair ──");

function refuses(fn: () => unknown, needle: string, label: string): void {
  check(label, () => {
    assert.throws(fn, (err: unknown) => {
      assert.ok(err instanceof AssemblerRefused, "refusals are typed");
      assert.ok(
        (err as AssemblerRefused).message.includes(needle),
        `expected ${needle} in: ${(err as Error).message}`
      );
      assert.ok((err as AssemblerRefused).ground.length > 0, "a refusal states its ground");
      return true;
    });
  });
}

refuses(() => parseBook("{not json}\n"), "not valid JSON", "a malformed book line refuses loudly");
refuses(
  () => parseBook(bookText([{ ...frame(0, 1), kind: "COMMITMENT" }])),
  "missing committerId or sealed",
  "a COMMITMENT missing its seal refuses"
);
refuses(
  () => parseBook(bookText([{ ...frame(0, 1), kind: "SOMETHING_NEW", ref: 0 }])),
  "unknown kind",
  "an UNKNOWN record kind stops the read rather than being ignored"
);
refuses(
  () => assembleWith(BOOK, [obs(), obs()]),
  "two observations were presented",
  "two observations for one commitment refuse at assembly"
);
refuses(
  () => assembleWith(bookText([commitment(0), commitment(0)]), [obs()]),
  "two COMMITMENT records at sequence 0",
  "two commitments at one sequence refuse"
);
refuses(
  () => assembleWith(bookText([commitment(0), reveal(1, 0), reveal(2, 0)]), [obs()]),
  "two REVEAL records for commitment 0",
  "two reveals of one commitment refuse"
);
check("a malformed line refuses the WHOLE read — no partial ProbeSource", () => {
  const partial = bookText([commitment(0), reveal(1, 0)]) + "{oops}\n";
  assert.throws(() => parseBook(partial), AssemblerRefused);
});

// ── The deployment seam ─────────────────────────────────────────────────────

console.log("\n── the deployment seam: this code creates nothing ──");

check("an unreadable book raises the SIGNPOST, naming the acts and creating nothing", () => {
  const missing = join(root, "no-such-dir", "book.jsonl");
  assert.throws(
    () => readBookOrSignpost(missing),
    (err: unknown) => {
      assert.ok(err instanceof AssemblerDeploymentActMissingError);
      const m = (err as Error).message;
      assert.ok(m.includes("DEPLOYMENT ACT, not a code defect"));
      assert.ok(m.includes("Nothing was created"));
      assert.ok(m.includes("mica-assembler"));
      assert.ok(m.includes("ENOENT") || m.includes("EACCES"), "the errno rides along");
      return true;
    }
  );
});
check("CANNOT-SEE is not reported as DOES-NOT-EXIST (statSync, not existsSync)", () => {
  // CODE lines only: the module NAMES existsSync in a comment explaining why it
  // does not call it, and a grep that cannot tell a mention from a call would
  // fail on the very sentence documenting the fix.
  const code = readFileSync(join(__dirname, "assembler.ts"), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
  assert.ok(!/existsSync\s*\(/.test(code), "existsSync answers a denied traverse with `false`");
  assert.ok(/statSync\s*\(/.test(code));
});
check("the module creates no directory, no user, and grants nothing", () => {
  const code = readFileSync(join(__dirname, "assembler.ts"), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
  for (const forbidden of ["mkdirSync", "writeFileSync", "chmodSync", "chownSync", "appendFileSync"]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\s*\\(`).test(code),
      `assembler must not call ${forbidden}`
    );
  }
});
check("NO ANGLE-BRACKET PLACEHOLDERS in paste-ready output (standing control, S100-1)", () => {
  // A template shipped as a finished command once reached a permanent chain
  // record. Never again, and it is checked rather than remembered.
  for (const line of deploymentActProposal(join(root, "precommit", "mica-doctor"))) {
    assert.ok(!/<[^>]*>/.test(line), `placeholder in a paste-ready line: ${line}`);
  }
});
check("the proposal grants READ only, and names the read-only verification", () => {
  const lines = deploymentActProposal(join(root, "precommit", "mica-doctor")).join("\n");
  assert.ok(lines.includes("NON-0 IS THE PASS"), "the write probe states which exit is the pass");
  assert.ok(lines.includes("NO_SUCH_USER"), "a missing user is distinguished from a refused grant");
  assert.ok(!/setfacl[^\n]*:rw/.test(lines), "no write bit is ever proposed");
  assert.ok(!lines.includes("mica-readers"), "per-book grant, NOT the blanket reader group");
});

// ── THE DRIFT CHECK (brief §2) ──────────────────────────────────────────────

console.log("\n── drift: this module mirrors two others it cannot import ──");

check("COMPILE-TIME · an emitted record is assignable to Sig's ProbeRecord", () => {
  // If either shape moves, this file stops compiling and the suite goes red.
  // The SHIPPED module still holds zero import edges: these are `import type`.
  const emitted: EmittedProbeRecord = happy.probeSource[0];
  const asSig: ProbeRecord = emitted;
  const asSource: ProbeSource = happy.probeSource;
  assert.strictEqual(asSig.commitmentSeq, 0);
  assert.strictEqual(asSource.length, 1);
});
check("COMPILE-TIME · the book mirror is assignable from the real precommit shapes", () => {
  const p: SealedPlaintext = {
    type: "verdict",
    target: "t",
    predictedValue: "",
    committerId: "c",
    salt: "s".repeat(32),
  };
  // Structural assignment in both directions is the drift alarm.
  const mirrored: { type: string; target: string; predictedValue: string } = p;
  assert.strictEqual(mirrored.predictedValue, "");
  const c: Pick<CommitmentRecord, "kind" | "sealed" | "committerId"> = {
    kind: "COMMITMENT",
    sealed: "x",
    committerId: "y",
  };
  const rv: Pick<RevealRecord, "kind" | "ref" | "sealCheck"> = {
    kind: "REVEAL",
    ref: 0,
    sealCheck: "MATCH",
  };
  assert.strictEqual(c.sealed, "x");
  assert.strictEqual(rv.ref, 0);
});
function declaredFields(src: string, iface: string): readonly string[] {
  const from = src.indexOf(`export interface ${iface} extends ProbeRecordBase {`);
  assert.ok(from >= 0, `sig/index.ts no longer declares ${iface}`);
  const block = src.slice(from, src.indexOf("\n}", from));
  return [...block.matchAll(/readonly (\w+)\??:/g)].map((m) => m[1]);
}

check("RUNTIME · Sig's SEALED record and the assembler's sealed output agree, both ways", () => {
  const sigSrc = readFileSync(join(__dirname, "..", "mica", "sig", "index.ts"), "utf8");
  const base = declaredFields(sigSrc, "SealedProbeRecord");
  const shared = [...sigSrc.matchAll(/interface ProbeRecordBase \{[\s\S]*?\n\}/g)][0][0];
  const inherited = [...shared.matchAll(/readonly (\w+)\??:/g)].map((m) => m[1]);
  const declared = [...base, ...inherited];
  assert.strictEqual(declared.length, 10, `expected a 10-field sealed record, parsed ${declared.length}`);
  const emitted = Object.keys(happy.probeSource[0]);
  for (const f of declared) assert.ok(emitted.includes(f), `Sig declares ${f}; the assembler never emits it`);
  for (const f of emitted) assert.ok(declared.includes(f), `the assembler emits ${f}; Sig does not declare it`);
});

check("RUNTIME · Sig's UNSEALED record and the assembler's unsealed output agree, both ways", () => {
  const sigSrc = readFileSync(join(__dirname, "..", "mica", "sig", "index.ts"), "utf8");
  const forbidden = declaredFields(sigSrc, "UnsealedProbeRecord").filter((f) => f !== "sealCheck");
  const rec = assembleWith(BOOK, [obs({ commitmentSeq: 99 })]).probeSource[0];
  // Every field Sig declares `?: undefined` must be ABSENT on what we emit.
  for (const f of forbidden) {
    assert.ok(!(f in rec), `Sig forbids ${f} on an unsealed record; the assembler emitted it`);
  }
  assert.strictEqual(forbidden.length, 5, `expected 5 forbidden seal-derived fields, parsed ${forbidden.length}`);
});

check("RUNTIME · what the assembler emits is what F4 accepts — asked of F4 itself", () => {
  // Not a shape comparison: F4's own validator is run over both record kinds.
  const both = assembleWith(
    BOOK,
    [obs({ commitmentSeq: 0 }), obs({ commitmentSeq: 99 })],
    1_000
  );
  assert.strictEqual(both.probeSource.length, 2);
  for (const rec of both.probeSource) {
    assert.strictEqual(malformedFor(rec), null, `F4 rejected ${rec.sealCheck}: ${String(malformedFor(rec))}`);
  }
});

check("RUNTIME · the empty-predictedValue permission still matches on BOTH sides", () => {
  // The drift that this build was created by finding. If either side changes its
  // mind about the empty string, this fails and names which one moved.
  const pcSrc = readFileSync(join(__dirname, "..", "precommit", "precommit.ts"), "utf8");
  assert.ok(
    /May be empty/.test(pcSrc),
    "precommit no longer documents predictedValue as permitted-empty"
  );
  const sigSrc = readFileSync(join(__dirname, "..", "mica", "sig", "index.ts"), "utf8");
  assert.ok(
    /typeof r\.predictedValue !== "string"/.test(sigSrc),
    "F4 no longer accepts an empty predictedValue — the two modules have drifted apart again"
  );
});

// ── The documented defect (see receipt §4) ──────────────────────────────────

console.log("\n── the defect this build found, now RULED and REPAIRED ──");

check("RETIRED PIN · F4's UNSEALED status is reachable by an honest producer", () => {
  // This test replaces the `DOCUMENTED ·` pin from the S101 assembler receipt
  // §4. That pin recorded a defect: F4 required sealedDigest and committerId
  // non-empty regardless of sealCheck, so no producer could build an UNSEALED
  // record without MANUFACTURING values — the ledger S100-1 class. The arbiter ruled
  // option (a); F4's validator is kind-aware and this now works end to end.
  const r = assembleWith(BOOK, [obs({ commitmentSeq: 99 })]);
  const unsealed = r.probeSource.filter((x) => x.sealCheck === "UNSEALED");
  assert.strictEqual(unsealed.length, 1, "the status is producible");
  const bad = malformedFor(unsealed[0]);
  assert.strictEqual(bad, null, `F4 must accept what this assembler emits, got: ${String(bad)}`);
});
check("END TO END · the assembler's output feeds F4, which counts the unsealed one", () => {
  // The whole point of the ruling: countable inside the sensor's own report.
  // sweepPeriodMs injected so the sealed record's order IS established and the
  // leg actually reads it — otherwise this would test blindness, not the join.
  const r = assembleWith(
    BOOK,
    [obs({ commitmentSeq: 0, observedValue: "GREEN" }), obs({ commitmentSeq: 99 })],
    1_000
  );
  assert.strictEqual(r.probeSource[0].orderEvidence, "SEALED_BEFORE_OBSERVED");
  const result = assessSig(sigLog, {
    readableLoadStates: ["LOADED_VERIFIED"],
    clockToleranceMs: 0,
    preconditionMap: { b: ["a"] },
    probeSource: r.probeSource,
  });
  const f4 = result.flags[3];
  assert.strictEqual(f4.scopeSize, 1, "one sealed record in scope");
  assert.strictEqual(f4.outOfScope![0].count, 1, "one unsealed record counted");
  assert.strictEqual(f4.kind, "SILENT");
  assert.strictEqual(result.verdict.kind, "SILENT", "an unsealed record never lowers the bound");
});

// ── The book that is not there ──────────────────────────────────────────────
//
// ── WHY THIS NO LONGER READS THE LIVE BOOK (S116) `[LB]` ────────────────────
//
//   It used to name `<the state root>/precommit/mica-doctor/book.jsonl` and
//   read it, reporting either "READ n records" or "REFUSED with signpost". Two
//   things were wrong with that, and only the second one is obvious.
//
//   The obvious one: a test suite reached out and touched the live box. Whether
//   this file passed depended on a deployment, and running the suite as the
//   wrong principal changed what it did.
//
//   The one that matters more: IT ASSERTED ALMOST NOTHING. Both branches passed.
//   `assert.ok(outcome.length > 0)` is true of every string, so the only real
//   check was that ONE of the two happened — and on every box where the book is
//   unreadable, the READ branch was never exercised at all. A green tick over a
//   test that cannot fail is this project's own thesis eating the project.
//
//   The signpost is the thing worth checking, so it is checked DETERMINISTICALLY,
//   against a path under this test's own mkdtemp root that is guaranteed not to
//   exist. Same production function, same error class, and now exactly one
//   possible outcome — which is what makes the assertion mean something.

console.log("\n── the signposted refusal, deterministically ──");

check("a book whose directory was never made raises the SIGNPOST, not a bare error", () => {
  const absent = join(root, "never-deployed", "precommit", "mica-doctor", "book.jsonl");
  assert.strictEqual(existsSync(absent), false, "the fixture path exists — this test proves nothing");
  let thrown: unknown = null;
  try {
    readBookOrSignpost(absent);
  } catch (err) {
    thrown = err;
  }
  assert.ok(
    thrown instanceof AssemblerDeploymentActMissingError,
    `an unreadable book must raise the SIGNPOST, not a bare error — got ${String(thrown)}`
  );
  const message = (thrown as Error).message;
  assert.ok(message.includes(absent) || message.includes(dirname(absent)), message);
  assert.strictEqual(existsSync(absent), false, "the read created something");
});

check("a book that IS there is read — the branch the live-box version never exercised", () => {
  const present = join(root, "readable-book.jsonl");
  writeFileSync(present, BOOK, "utf8");
  assert.strictEqual(parseBook(readBookOrSignpost(present)).length, 3);
});


// -- SP-S103 · the sweep period is DECLARED, and the refusals are the point ---
//
// The arbiter's ruling S103-G: sweepPeriodMs = 80000, arbiter-declared, with margin
// over the running OnUnitActiveSec=1min. Direction is load-bearing: DECLARED >=
// ACTUAL makes F4 slower to claim order, never faster. Calibration downward is
// evidence-only.

check("SP-S103-1 · 80000 declared: the S102 seq-2 shape establishes order", () => {
  // S102-C: seq 2 refused INELIGIBLE_SCOPE — a byte-identical match declined
  // because the comparison could have been reading a prediction written after
  // the event. With the declared period the observation is placed OUTSIDE the
  // sweep that carried the anchor, and F4 reads for real.
  const r = assemble({
    bookPath: "/test/book.jsonl",
    book: parseBook(BOOK),
    observations: [obs({ commitmentSeq: 0, observedValue: "GREEN", observedAt: ANCHOR_AT + 80_001 })],
    sweepPeriod: { ms: 80_000, declaredBy: "mica-arbiter", basis: "S103-G, margin over OnUnitActiveSec=1min" },
    ranAs: "uid 4242",
  });
  assert.strictEqual(r.probeSource[0].orderEvidence, "SEALED_BEFORE_OBSERVED");
  const why = r.orderReasons.get(0) ?? "";
  assert.ok(why.includes("DECLARED BY mica-arbiter"), why);
  assert.ok(
    why.includes("a COMMITMENT, not a measurement"),
    "the reason must not let a declaration read as a measurement of the box"
  );
});

check("SP-S103-2 · exactly one period is still INSIDE the sweep", () => {
  // The margin is real, not decorative: strictly greater.
  for (const delta of [80_000, 79_999]) {
    const r = assemble({
      bookPath: "/test/book.jsonl",
      book: parseBook(BOOK),
      observations: [obs({ commitmentSeq: 0, observedValue: "GREEN", observedAt: ANCHOR_AT + delta })],
      sweepPeriod: { ms: 80_000, declaredBy: "mica-arbiter", basis: "S103-G" },
      ranAs: "uid 4242",
    });
    assert.strictEqual(
      r.probeSource[0].orderEvidence,
      "ORDER_NOT_ESTABLISHED",
      `delta ${delta} cleared a period it does not exceed`
    );
  }
});

check("SP-S103-3 · absent declaration is today's refusal, reason unchanged", () => {
  const r = assembleWith(BOOK, [obs({ commitmentSeq: 0, observedValue: "GREEN" })]);
  assert.strictEqual(r.probeSource[0].orderEvidence, "ORDER_NOT_ESTABLISHED");
  assert.ok((r.orderReasons.get(0) ?? "").includes("no sweep period was declared"));
});

check("SP-S103-4 · CONTROL: the values that MANUFACTURED order are refused", () => {
  // Measured at S103, not argued. The CLI read Number(argv[2]) and kept whatever
  // Number.isFinite accepted, so an EMPTY third argument became a period of 0 —
  // and with a period of 0 every observation after its anchor clears it. An
  // argument that said nothing produced the strongest claim F4 can make.
  for (const bad of [0, -5, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.ok(
      isSweepPeriodRefusal(declareSweepPeriod(bad, "mica-arbiter", "S103-G")),
      `sweep period ${String(bad)} was accepted`
    );
  }
  for (const raw of ["", " "]) {
    assert.ok(
      isSweepPeriodRefusal(declareSweepPeriod(Number(raw), "mica-arbiter", "S103-G")),
      `Number(${JSON.stringify(raw)}) still reaches a usable period`
    );
  }
  // A declaration with nobody behind it is a bare number wearing the word.
  assert.ok(isSweepPeriodRefusal(declareSweepPeriod(80_000, "   ", "S103-G")));
  const good = declareSweepPeriod(80_000, "mica-arbiter", "S103-G");
  assert.ok(!isSweepPeriodRefusal(good));
  assert.strictEqual((good as DeclaredSweepPeriod).ms, 80_000);
});

check("SP-S103-5 · the manufactured period WOULD have flipped it — run, not asserted", () => {
  // The counterfactual: the same observation that honestly reads
  // ORDER_NOT_ESTABLISHED at 80000 reads SEALED_BEFORE_OBSERVED at 0, which is
  // what an empty argument used to produce.
  const near = obs({ commitmentSeq: 0, observedValue: "GREEN", observedAt: ANCHOR_AT + 1 });
  const honest = assemble({
    bookPath: "/test/book.jsonl", book: parseBook(BOOK), observations: [near],
    sweepPeriod: { ms: 80_000, declaredBy: "mica-arbiter", basis: "S103-G" }, ranAs: "uid 4242",
  });
  assert.strictEqual(honest.probeSource[0].orderEvidence, "ORDER_NOT_ESTABLISHED");
  const manufactured = assemble({
    bookPath: "/test/book.jsonl", book: parseBook(BOOK), observations: [near],
    // The shape `declareSweepPeriod` now refuses, built directly to show what is
    // being refused. It can no longer arrive from the CLI.
    sweepPeriod: { ms: 0, declaredBy: "nobody", basis: "an empty argument" }, ranAs: "uid 4242",
  });
  assert.strictEqual(
    manufactured.probeSource[0].orderEvidence,
    "SEALED_BEFORE_OBSERVED",
    "the 0-period path no longer manufactures order — if so, delete this control"
  );
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── S116 · the Gate-5 fence · a basis is not a prediction ──");

/** A sealed intent-wire plaintext, shaped as intent-record.ts writes one. */
function intentPlaintext(cls: string, ruleId = "no-clerk-scope-widening"): string {
  return JSON.stringify(
    cls === "RULE_INTENT"
      ? {
          ruleId,
          declaredProtectivePurpose: "the clerk's scope is the blast radius",
          namedFailureModes: ["a widened scope outlives the reason for it"],
          scopeFrameRef: "scope-frame:clerk-1",
          intentRecordClass: "RULE_INTENT",
        }
      : {
          ruleIntentRef: { ruleId, commitmentRef: 0, committerId: "mica-doctor" },
          claimedBasis: "following the rule here would strand the operator",
          scopeComparison: { benefitedCircle: "SUB_SCOPE", harmedCircle: "WIDER_CIRCLE" },
          intentRecordClass: "INVOCATION_BASIS",
        }
  );
}

check("AS-S116-1 · an observation naming an INVOCATION_BASIS commitment is WITHHELD, never emitted", () => {
  const book = bookText([
    commitment(0),
    reveal(1, 0, { target: "invocation-basis:x", predictedValue: intentPlaintext("INVOCATION_BASIS") }),
    anchor(2, 0, ANCHOR_AT),
  ]);
  const r = assembleWith(book, [obs({ target: "invocation-basis:x" })]);
  assert.strictEqual(r.probeSource.length, 0, "a basis record reached the ProbeSource");
  assert.strictEqual(r.withheld.length, 1);
  assert.strictEqual(r.withheld[0].reason, "NOT_A_PREDICTION");
  assert.ok(r.withheld[0].detail.includes("INVOCATION_BASIS"), r.withheld[0].detail);
  assert.ok(r.withheld[0].detail.includes("forecasts no outcome"), r.withheld[0].detail);
});

check("AS-S116-2 · a RULE_INTENT commitment is withheld on the same ground", () => {
  const book = bookText([
    commitment(0),
    reveal(1, 0, { target: "rule-intent:x", predictedValue: intentPlaintext("RULE_INTENT") }),
    anchor(2, 0, ANCHOR_AT),
  ]);
  const r = assembleWith(book, [obs({ target: "rule-intent:x" })]);
  assert.strictEqual(r.probeSource.length, 0);
  assert.strictEqual(r.withheld[0].reason, "NOT_A_PREDICTION");
  assert.ok(r.withheld[0].detail.includes("RULE_INTENT"));
});

check("AS-S116-3 · CONTROL — an ordinary prediction still flows, S100 shape unchanged", () => {
  const r = assembleWith(BOOK, [obs()]);
  assert.strictEqual(r.withheld.length, 0);
  assert.strictEqual(r.probeSource.length, 1);
  assert.strictEqual(r.probeSource[0].sealCheck, "MATCH");
  assert.strictEqual(r.probeSource[0].predictedValue, "GREEN");
  assert.strictEqual(r.probeSource[0].target, "gate2/direction");
});

check("AS-S116-4 · the fence reads a DECLARED FIELD, not a target label", () => {
  // The target SAYS `invocation-basis:`; the sealed content declares nothing.
  // On the wire that is an ordinary prediction, and it FLOWS. String-matching
  // the label would have withheld it.
  const book = bookText([
    commitment(0),
    reveal(1, 0, { target: "invocation-basis:looks-like-one", predictedValue: "GREEN" }),
    anchor(2, 0, ANCHOR_AT),
  ]);
  const r = assembleWith(book, [obs({ target: "invocation-basis:looks-like-one" })]);
  assert.strictEqual(r.withheld.length, 0, "the fence matched a label, not a declaration");
  assert.strictEqual(r.probeSource.length, 1);
});

check("AS-S116-5 · a plaintext that is not JSON, or declares an unknown class, is not one of ours", () => {
  assert.strictEqual(declaredIntentRecordClass("GREEN"), null);
  assert.strictEqual(declaredIntentRecordClass("[1,2,3]"), null);
  assert.strictEqual(declaredIntentRecordClass("null"), null);
  assert.strictEqual(declaredIntentRecordClass('{"intentRecordClass":"SOMETHING_ELSE"}'), null);
  assert.strictEqual(declaredIntentRecordClass('{"intentRecordClass":42}'), null);
  assert.strictEqual(declaredIntentRecordClass('{"intentRecordClass":"RULE_INTENT"}'), "RULE_INTENT");
});

check("AS-S116-6 · a basis commitment with NO reveal is still AWAITING_REVEAL, not the new reason", () => {
  // The two reasons must not collapse: the fence needs a plaintext, and a
  // sealed-but-unrevealed record has none to read.
  const book = bookText([commitment(0), anchor(1, 0, ANCHOR_AT)]);
  const r = assembleWith(book, [obs()]);
  assert.strictEqual(r.withheld.length, 1);
  assert.strictEqual(r.withheld[0].reason, "AWAITING_REVEAL");
});

// ── DRIFT, half three: the intent wire's declaration ─────────────────────────
//
// This module MIRRORS `intent-record.ts` rather than importing it (header: "NO
// IMPORT EDGE"). That mirror incurs the same duty the other two do, discharged
// the same way: read the real module and fail when either side moves.

check("AS-S116-7 · DRIFT — the mirrored class field, values AND behaviour match intent-record.ts", () => {
  const wire = require("../probe/intent-record") as {
    INTENT_RECORD_CLASS_FIELD: string;
    INTENT_RECORD_CLASSES: readonly string[];
    readIntentRecordClass: (v: string) => string | null;
  };
  assert.strictEqual(
    MIRRORED_INTENT_RECORD_CLASS_FIELD,
    wire.INTENT_RECORD_CLASS_FIELD,
    "the field name drifted from intent-record.ts"
  );
  assert.deepStrictEqual(
    [...MIRRORED_INTENT_RECORD_CLASSES].sort(),
    [...wire.INTENT_RECORD_CLASSES].sort(),
    "the class vocabulary drifted from intent-record.ts"
  );
  for (const v of [
    intentPlaintext("RULE_INTENT"),
    intentPlaintext("INVOCATION_BASIS"),
    "GREEN",
    "{}",
    '{"intentRecordClass":"NOPE"}',
  ]) {
    assert.strictEqual(
      declaredIntentRecordClass(v),
      wire.readIntentRecordClass(v),
      `the mirror and the wire disagree on ${v.slice(0, 40)}`
    );
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// BUILD C (S117) — the grader that does not exist, said on the surface
//
// S116 recon §3, confirmed at bytes in S117 A's receipt: the book carries IR
// records and nothing reads one back against an outcome. Until now that lived
// in prose. These tests hold it on the reading surface.

check("AS-C1 · the census counts REVEALED IR records by class, and states the unrevealed residual", () => {
  const book = bookText([
    commitment(0),
    reveal(1, 0, { target: "rule-intent:a", predictedValue: intentPlaintext("RULE_INTENT", "rule-a") }),
    commitment(2),
    reveal(3, 2, { target: "rule-intent:b", predictedValue: intentPlaintext("RULE_INTENT", "rule-b") }),
    commitment(4),
    reveal(5, 4, { target: "invocation-basis:c", predictedValue: intentPlaintext("INVOCATION_BASIS") }),
    // SEALED, NEVER REVEALED. On the wire this is a hash and a committer id, so
    // whether it is an IR record is exactly what no scan can answer — which is
    // the residual the census has to state rather than round away.
    commitment(6),
    // …and an ordinary revealed PREDICTION, so the census is discriminating.
    commitment(7),
    reveal(8, 7),
  ]);
  const r = assembleWith(book, []);
  const c = r.intentRecords;

  assert.strictEqual(c.revealedByClass.RULE_INTENT, 2);
  assert.strictEqual(c.revealedByClass.INVOCATION_BASIS, 1);
  assert.strictEqual(c.revealedTotal, 3, "the ordinary prediction was counted as an IR record");
  assert.strictEqual(c.unrevealedCommitments, 1);
  assert.strictEqual(c.unrevealedResidual, UNREVEALED_IR_IS_NOT_COUNTABLE);
  assert.ok(c.unrevealedResidual.includes("not countable from the book"), c.unrevealedResidual);
  assert.strictEqual(c.graderState, "NONE_EXISTS");
  assert.strictEqual(c.graderStatement, NO_GRADER_READS_IR_RECORDS);
});

check("AS-C2 · the census is over the WHOLE book, not only records an observation named", () => {
  // The withhold reports on what somebody asked about. The census reports on
  // what the book holds — which is the question "who grades these" is asked of.
  const book = bookText([
    commitment(0),
    reveal(1, 0, { target: "rule-intent:a", predictedValue: intentPlaintext("RULE_INTENT") }),
  ]);
  const r = assembleWith(book, []);
  assert.strictEqual(r.withheld.length, 0, "nothing was asked about, so nothing is withheld");
  assert.strictEqual(r.intentRecords.revealedTotal, 1, "…and the record is still counted");
});

check("AS-C3 · an empty book still states the grader hole — silence is not coverage", () => {
  const r = assembleWith(bookText([]), []);
  assert.strictEqual(r.intentRecords.revealedTotal, 0);
  assert.strictEqual(r.intentRecords.unrevealedCommitments, 0);
  assert.strictEqual(r.intentRecords.graderState, "NONE_EXISTS");
  assert.ok(r.ceiling.includes(NO_IR_GRADER_IS_A_STATED_HOLE), "the ceiling lost the stated hole");
});

check("AS-C4 · NEGATIVE CONTROL — nothing in src/ emits \"WIRED\"", () => {
  // The G5R-P shape. `"WIRED"` exists in the union so the state has somewhere
  // to go when a grader is wired; this fails the day anything PRODUCES it, so
  // a grader cannot appear without a brief and a receipt naming it.
  const srcRoot = join(__dirname, "..");
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".ts")) files.push(full);
    }
  };
  walk(srcRoot);
  assert.ok(files.length > 50, `the walk found only ${String(files.length)} files`);

  const codeOnly = (src: string): string =>
    src
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");

  const emitters: string[] = [];
  const declarations: string[] = [];
  for (const file of files) {
    if (file.endsWith(".test.ts")) continue;
    const code = codeOnly(readFileSync(file, "utf8"));
    const rel = file.split("/mica-machine/")[1] ?? file;
    code.split("\n").forEach((line, i) => {
      if (!line.includes('"WIRED"')) return;
      // The type union is a DECLARATION; anything else is an emission.
      if (/^export type IntentRecordGraderState\s*=/.test(line.trim())) {
        declarations.push(`${rel}:${String(i + 1)}`);
        return;
      }
      emitters.push(`${rel}:${String(i + 1)}: ${line.trim()}`);
    });
  }
  assert.deepStrictEqual(
    emitters,
    [],
    `something in src/ emits "WIRED":\n    ${emitters.join("\n    ")}\n` +
      "  This build emits NONE_EXISTS only. If a grader has been wired, it needs\n" +
      "  a brief, a receipt, and this control updated in the same commit."
  );
  assert.strictEqual(declarations.length, 1, "the union that names WIRED moved or was duplicated");
});

check("AS-C5 · SOURCE FENCE — assembler.ts still does not import the intent wire", () => {
  const source = readFileSync(join(__dirname, "assembler.ts"), "utf8");
  const code = source
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
  const specifiers = [...code.matchAll(/(?:from|require\()\s*["']([^"']+)["']/g)].map((m) => m[1]);
  for (const forbidden of ["../probe/intent-record", "../probe/intent-cli", "../probe/"]) {
    assert.ok(
      !specifiers.some((x) => x.startsWith(forbidden)),
      `assembler.ts imports ${forbidden} — the S116 trust boundary is that this ` +
        "reader MIRRORS the class declaration rather than sharing a module with " +
        "the wire that writes it"
    );
  }
  // The mirror is still a mirror: the field name and the class list are local.
  assert.strictEqual(MIRRORED_INTENT_RECORD_CLASS_FIELD, "intentRecordClass");
  assert.deepStrictEqual([...MIRRORED_INTENT_RECORD_CLASSES], ["RULE_INTENT", "INVOCATION_BASIS"]);
});

check("AS-C6 · the CLI prints the block after the counts, before the ProbeSource, and exits 0", () => {
  const bookPath = join(root, "c-book.jsonl");
  writeFileSync(
    bookPath,
    bookText([
      commitment(0),
      reveal(1, 0, { target: "rule-intent:a", predictedValue: intentPlaintext("RULE_INTENT") }),
      commitment(2),
    ]),
    "utf8"
  );
  const res = spawnSync(
    "npx",
    ["ts-node", join(__dirname, "assemble-cli.ts"), bookPath],
    { encoding: "utf8", cwd: join(__dirname, "..", "..") }
  );
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  assert.strictEqual(res.status, 0, out);

  // POSITION, asserted by index rather than by eye.
  const at = (needle: string): number => {
    const i = out.indexOf(needle);
    assert.ok(i >= 0, `${needle} is not in the output:\n${out}`);
    return i;
  };
  const counts = at("observations withheld:");
  const block = at("── THE GATE-5 INTENT RECORDS");
  const probeSource = at("── ProbeSource");
  assert.ok(counts < block, "the IR block printed before the counts");
  assert.ok(block < probeSource, "the IR block printed after the ProbeSource");

  assert.ok(out.includes("RULE_INTENT"), out);
  assert.ok(out.includes("INVOCATION_BASIS"), out);
  assert.ok(/grader state:\s+NONE_EXISTS/.test(out), out);
  assert.ok(out.includes("graded by:   NOBODY YET"), out);
  assert.ok(out.includes("not countable from the book"), out);
  // …and the ceiling at the tail carries it too.
  assert.ok(out.includes("This book's Gate-5 intent records are counted above"), out);
  // An absent grader is a STATE: nothing here is a refusal.
  assert.ok(!out.includes("REFUSED"), out);
});

rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} tests: ${passed} passed, 0 failed`);
