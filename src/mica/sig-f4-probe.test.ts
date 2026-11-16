// MICA/Sig F4 — a sealed expectation against the result the probe produced.
//
// A9 = Sig leg 3 = flag F4. The first authorship-layer leg: every other flag in
// this sensor reads the record against itself or against a receipt taken as the
// record arrived, and none of them holds anything committed BEFORE the event.

import * as assert from "assert";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MicaFixtureLog } from "./fixture-log";
import { assessSig } from "./sig";
import type {
  ProbeSource,
  SealedProbeRecord,
  SigConfig,
  UnsealedProbeRecord,
} from "./sig";
import { decideChokepoint } from "./chokepoint/types";

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

const root = mkdtempSync(join(tmpdir(), "mica-sig-f4-"));
const path = join(root, "log.jsonl");
const first = new MicaFixtureLog({ path });
first.append({ timestamp: 1_000, moduleId: "m", eventType: "a", outcome: "ok" });
first.append({ timestamp: 2_000, moduleId: "m", eventType: "b", outcome: "ok" });
const log = new MicaFixtureLog({ path });

// F1 SILENT, F2 SILENT, F3 unconfigured — so anything the composite says below
// is F4 talking and nothing else.
const base: SigConfig = {
  readableLoadStates: ["LOADED_VERIFIED"],
  clockToleranceMs: 0,
  preconditionMap: { b: ["a"] },
};

const F4 = 3; // flags order: F1, F2, F3, F4

function probe(over: Partial<SealedProbeRecord> = {}): SealedProbeRecord {
  return {
    commitmentSeq: 2,
    sealedDigest: "aa8a8664",
    expectationType: "verdict",
    target: "gate2/direction",
    predictedValue: "GREEN",
    committerId: "mica-doctor",
    sealCheck: "MATCH",
    orderEvidence: "SEALED_BEFORE_OBSERVED",
    observed: {
      observedValue: "GREEN",
      observedBy: "mica-arbiter",
      observedAt: 1_700_000_000_000,
    },
    provenance: "book.jsonl seq 2, revealed seq 5",
    ...over,
  };
}

/**
 * An observation for which NOTHING WAS EVER SEALED. The seal-derived fields are
 * ABSENT — the type makes carrying one a compile error, which is half of the
 * S101 repair; the other half is the runtime refusal, tested below.
 */
function unsealedProbe(
  over: Partial<UnsealedProbeRecord> = {}
): UnsealedProbeRecord {
  return {
    commitmentSeq: 7,
    target: "gate2/direction",
    sealCheck: "UNSEALED",
    observed: {
      observedValue: "RED",
      observedBy: "mica-arbiter",
      observedAt: 1_700_000_000_000,
    },
    provenance: "book.jsonl holds no commitment at sequence 7",
    ...over,
  };
}

function withProbes(source: ProbeSource) {
  return assessSig(log, { ...base, probeSource: source });
}

// ── NOT_CONFIGURED · the F5 honest split ─────────────────────────────────────

console.log("\n── F4 · unconfigured is dormant, not blind ──");

const absent = assessSig(log, base);
check("no probeSource injected: F4 is NOT_CONFIGURED, not a blind CANNOT_ASSESS", () => {
  assert.strictEqual(absent.flags[F4].kind, "NOT_CONFIGURED");
  assert.strictEqual(absent.probeSource, null);
});
check("an unconfigured F4 is excluded from the floor: composite stays SILENT", () => {
  assert.strictEqual(absent.verdict.kind, "SILENT");
});
check("THE FREEZE FENCE — an unconfigured F4 never appears in the verdict summary", () => {
  // verdict-logic.frozen.json is byte-frozen and its summaries carry the
  // scopeNote. NOT_CONFIGURED legs are filtered out before that note is built,
  // which is exactly why adding this leg does not move the frozen verdicts.
  assert.ok(!absent.verdict.summary.includes("F4["));
});
check("an EMPTY probeSource is also NOT_CONFIGURED (nothing to read is not blindness)", () => {
  const empty = withProbes([]);
  assert.strictEqual(empty.flags[F4].kind, "NOT_CONFIGURED");
  assert.strictEqual(empty.probeSource, null);
  assert.strictEqual(empty.verdict.kind, "SILENT");
});

// ── The match, and what it does NOT buy ──────────────────────────────────────

console.log("\n── F4 · a match, and the ceiling it prints ──");

const matched = withProbes([probe()]);
check("prediction equals observation: F4 SILENT over 1 record", () => {
  assert.strictEqual(matched.flags[F4].kind, "SILENT");
  assert.strictEqual(matched.flags[F4].scopeSize, 1);
  assert.strictEqual(matched.verdict.kind, "SILENT");
});
check("THE LIMIT — a match certifies nothing; the scope block says so in the code's own output", () => {
  const { sigScopeBlockText } = require("./sig");
  const text: string = sigScopeBlockText(["LOADED_VERIFIED"]);
  assert.ok(text.includes("A MATCH CERTIFIES"), "the ceiling is printed, not only commented");
  assert.ok(
    text.includes("never evidence that the committer is reliable"),
    "SILENT is not promoted to a health statement"
  );
});
// ── The S100 pin, repaired S103 (2026-09-02) ─────────────────────────────────
//
// WHAT WAS HERE AND WHY IT LEFT. The check below used to assert the literal
// "TWO FURTHER SIG LEGS" was present, reasoned as "the unbuilt count came down
// from three". THAT PIN INVERTED INTO THE DEFECT IT GUARDS. When a fifth leg
// ships, the honest text reads "ONE FURTHER", the pin fails for exactly the
// right reason, and the cheapest repair in that moment is to edit the pin. A
// pin whose correct failure teaches the next author to edit it is worse than no
// pin: it trains the hand that the text should follow the test.
//
// It is not weakened, it is replaced by the two properties it was actually
// holding, neither of which mentions a number:
//
//   (1) probe divergence is not NAMED in the unbuilt list — the S100 defect
//       itself rather than one sentence of it;
//   (2) the list's own count word agrees with the legs it lists, so the block
//       cannot be edited into a lie by removing a bullet and leaving the count.
//
// `scope-block-guard.test.ts` holds (1) as a CLASS, over all thirteen
// instruments that print a scope block. It is restated here because this is
// F4's own file and F4 was the specimen: if that guard is ever narrowed, this
// file still refuses. Duplication is the point, not an oversight.

const NUMBER_WORDS = [
  "ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE",
  "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
];

/**
 * The unbuilt-legs declaration as the printed scope actually carries it: the
 * count word from its header, and the bullets indented beneath it.
 *
 * Re-derived locally rather than imported from the scope-block guard. That
 * guard scans EVERY instrument and answers a different question; borrowing its
 * internals would couple two tests whose reasons to exist are not the same, and
 * would put an import edge where the closure guard would rightly ask about it.
 */
function unbuiltLegDeclaration(text: string): {
  countWord: string;
  bullets: readonly string[];
} {
  const lines = text.split("\n").map((l) => l.replace(/^[│┌├└]/, ""));
  // LEGS? — the plural agrees with the count, so matching only "LEGS" would be
  // the same number-dependency the old pin had, wearing grammar as a disguise:
  // it would go silent at exactly ONE remaining leg. Found by control D, S103.
  const at = lines.findIndex((l) => /FURTHER SIG LEGS? .*UNBUILT:/.test(l.toUpperCase()));
  assert.ok(
    at >= 0,
    "the printed scope declares no unbuilt-legs list at all. If the last unbuilt " +
      "leg has shipped, retire this check deliberately — do not let it pass by " +
      "finding nothing."
  );
  const header = lines[at];
  const indent = header.length - header.trimStart().length;
  const bullets: string[] = [];
  for (let i = at + 1; i < lines.length; i++) {
    const body = lines[i].trim();
    // The declaration ends at a blank line or at the first line back to the
    // header's own indent — the same "a claim owns what is indented under it"
    // reading the scope-block guard uses.
    if (body === "" || lines[i].length - lines[i].trimStart().length <= indent) break;
    if (body.startsWith("·")) bullets.push(body);
  }
  const m = /([A-Z]+) FURTHER SIG LEGS?/.exec(header.trim().toUpperCase());
  assert.ok(m !== null, `unreadable unbuilt-legs header: ${header.trim()}`);
  return { countWord: m[1], bullets };
}

check("the printed scope no longer calls probe divergence unbuilt or blocked", () => {
  const { sigScopeBlockText } = require("./sig");
  const text: string = sigScopeBlockText(["LOADED_VERIFIED"]);
  assert.ok(
    !text.includes("Blocked on an independent witness that does not exist"),
    "the code's own output described an instrument that has since been built"
  );
  const { bullets } = unbuiltLegDeclaration(text);
  assert.deepStrictEqual(
    bullets.filter((b) => /PROBE\W+DIVERGENCE/.test(b.toUpperCase())),
    [],
    "F4 ships, and the printed scope still lists probe divergence as an unbuilt leg"
  );
});

check("the unbuilt-legs count word agrees with the legs actually listed", () => {
  const { sigScopeBlockText } = require("./sig");
  const { countWord, bullets } = unbuiltLegDeclaration(sigScopeBlockText(["LOADED_VERIFIED"]));
  const stated = NUMBER_WORDS.indexOf(countWord);
  assert.ok(
    stated >= 0,
    `the unbuilt-legs header counts in a word this check cannot read: "${countWord}"`
  );
  assert.strictEqual(
    stated,
    bullets.length,
    `the printed scope says ${countWord} unbuilt Sig legs and lists ${bullets.length}`
  );
});

// ── The divergence ───────────────────────────────────────────────────────────

console.log("\n── F4 · divergence between a sealed promise and the world ──");

const diverged = withProbes([
  probe({ observed: { observedValue: "RED", observedBy: "mica-arbiter", observedAt: 1_700_000_000_000 } }),
]);
check("prediction differs from observation: F4 ALARMS", () => {
  assert.strictEqual(diverged.flags[F4].kind, "ALARM");
  assert.strictEqual(diverged.verdict.kind, "ALARM");
});
check("the finding names both values, the seal and the observer", () => {
  const f = diverged.flags[F4].findings.find((x) => x.code === "SIG_F4_PROBE_DIVERGENCE");
  assert.ok(f, "the divergence finding is emitted under its own code");
  assert.ok(f!.detail.includes('"GREEN"') && f!.detail.includes('"RED"'));
  assert.ok(f!.detail.includes("aa8a8664"), "the seal it read is named");
  assert.ok(f!.detail.includes("mica-arbiter"), "the observer is named");
});
check("the finding prints its ceiling: divergence, never motive or honesty", () => {
  const f = diverged.flags[F4].findings.find((x) => x.code === "SIG_F4_PROBE_DIVERGENCE");
  assert.ok(f!.detail.includes("not a claim about motive, honesty, or disposition"));
  assert.ok(f!.detail.includes("recorded the miss faithfully"));
});
check("F4 ALARM composes to chokepoint HOLD", () => {
  const d = decideChokepoint({ id: "f4-diverged" }, [diverged.verdict]);
  assert.strictEqual(d.disposition, "HOLD");
  assert.strictEqual(d.executeRaw, false);
});
check("F1 and F2 are untouched by F4's alarm — the legs stay independent", () => {
  assert.strictEqual(diverged.flags[0].kind, "SILENT");
  assert.strictEqual(diverged.flags[1].kind, "SILENT");
});

// ── The unsealed probe · readable, not punishable ────────────────────────────

console.log("\n── F4 · an unsealed probe is out of scope, never an alarm ──");

const unsealedOnly = withProbes([unsealedProbe()]);
check("an unsealed probe whose values would diverge is NOT an alarm", () => {
  // There is no sealed prediction, so there is nothing F4 is entitled to call a
  // divergence. Offer-not-impose: absence of a seal is readable, not punishable.
  assert.strictEqual(unsealedOnly.flags[F4].kind, "NOT_CONFIGURED");
  assert.strictEqual(unsealedOnly.flags[F4].findings.length, 0);
  assert.strictEqual(unsealedOnly.verdict.kind, "SILENT");
});
check("the all-unsealed case is disclosed, and says how many records it declined", () => {
  const bp = unsealedOnly.flags[F4].blindPaths;
  assert.strictEqual(bp.length, 1);
  assert.ok(bp[0].detail.includes("NOT ONE of them is sealed"));
  assert.ok(bp[0].detail.includes("readable, not punishable"));
});
check("NO FAIL-OPEN — injecting only unsealed records hides nothing not already hidden", () => {
  assert.strictEqual(unsealedOnly.verdict.kind, absent.verdict.kind);
  assert.strictEqual(unsealedOnly.flags[F4].kind, absent.flags[F4].kind);
});

// ── S101 · UNSEALED is now REACHABLE, and COUNTED ───────────────────────────

console.log("\n── F4 · unsealed records are counted, never charged ──");

const mixed = withProbes([probe({ commitmentSeq: 2 }), unsealedProbe({ commitmentSeq: 4 })]);
check("COUNTED — an unsealed record is reported in outOfScope, not blindPaths", () => {
  // The distinction is the whole ruling: a blindPath on a verdict-bearing leg
  // composes into the floor. An out-of-scope note must not, or absence of a
  // seal would be punished after all.
  assert.strictEqual(mixed.flags[F4].kind, "SILENT");
  assert.strictEqual(mixed.flags[F4].scopeSize, 1, "scope counts the sealed record only");
  const notes = mixed.flags[F4].outOfScope;
  assert.ok(notes, "the unsealed record is counted on the report");
  assert.strictEqual(notes!.length, 1);
  assert.strictEqual(notes![0].class, "UNSEALED_NO_EXPECTATION");
  assert.strictEqual(notes![0].count, 1);
  assert.ok(notes![0].detail.includes("does not lower the verdict bound"));
});
check("NEVER CHARGED — counted unsealed records leave the composite SILENT", () => {
  assert.strictEqual(mixed.verdict.kind, "SILENT");
  assert.strictEqual(mixed.flags[F4].blindPaths.length, 0, "not a blind path");
});
check("a report with NO unsealed records carries no outOfScope key at all", () => {
  // Keeps every other leg's report byte-identical, which is what keeps the
  // frozen verdict logic from moving.
  const clean = withProbes([probe()]);
  assert.ok(!("outOfScope" in clean.flags[F4]));
  assert.ok(!("outOfScope" in clean.flags[0]), "F1 never grows the key");
});
check("THE NEW REFUSAL — UNSEALED while carrying a seal is malformed", () => {
  // A letter claiming it never had an envelope, while holding one. The type
  // forbids it; this is the runtime half, for records that arrive as JSON.
  const liar = { ...unsealedProbe(), sealedDigest: "aa8a8664" } as unknown as UnsealedProbeRecord;
  const r = withProbes([liar]);
  assert.strictEqual(r.flags[F4].kind, "CANNOT_ASSESS");
  assert.ok(r.flags[F4].blindPaths[0].detail.includes("sealedDigest"));
  assert.ok(r.flags[F4].blindPaths[0].detail.includes("contradiction inside a single record"));
});
check("the same refusal catches an EMPTY-STRING seal, not just a populated one", () => {
  // An empty string here would be a manufactured value — the S100-1 defect.
  const liar = { ...unsealedProbe(), predictedValue: "" } as unknown as UnsealedProbeRecord;
  const r = withProbes([liar]);
  assert.strictEqual(r.flags[F4].kind, "CANNOT_ASSESS");
  assert.ok(r.flags[F4].blindPaths[0].detail.includes("predictedValue"));
  assert.ok(r.flags[F4].blindPaths[0].detail.includes("manufactured value"));
});
check("an unsealed record still has to say WHAT it observed and WHERE it came from", () => {
  const noTarget = { ...unsealedProbe(), target: "" } as UnsealedProbeRecord;
  assert.strictEqual(withProbes([noTarget]).flags[F4].kind, "CANNOT_ASSESS");
  const noProv = { ...unsealedProbe(), provenance: "" } as UnsealedProbeRecord;
  assert.strictEqual(withProbes([noProv]).flags[F4].kind, "CANNOT_ASSESS");
});
check("an unsealed record cannot claim an order it has no seal to order", () => {
  const liar = {
    ...unsealedProbe(),
    orderEvidence: "SEALED_BEFORE_OBSERVED",
  } as unknown as UnsealedProbeRecord;
  const r = withProbes([liar]);
  assert.strictEqual(r.flags[F4].kind, "CANNOT_ASSESS");
  assert.ok(r.flags[F4].blindPaths[0].detail.includes("orderEvidence"));
});

// ── Refuse to repair ─────────────────────────────────────────────────────────

console.log("\n── F4 · configured and malformed lowers the bound ──");

const malformed = withProbes([probe({ committerId: "" })]);
check("a malformed record is CANNOT_ASSESS — configured, and could not read", () => {
  assert.strictEqual(malformed.flags[F4].kind, "CANNOT_ASSESS");
  assert.ok(malformed.flags[F4].blindPaths[0].detail.includes("refuses to substitute or repair"));
});
check("a malformed record LOWERS THE BOUND (unlike an unconfigured leg)", () => {
  assert.strictEqual(malformed.verdict.kind, "CANNOT_ASSESS");
  assert.ok(malformed.verdict.summary.includes("F4["), "the blind leg is named in the verdict");
});
check("E2E — a blind F4 drives the chokepoint off RELEASE", () => {
  const d = decideChokepoint({ id: "f4-blind" }, [malformed.verdict]);
  assert.strictEqual(d.floorKind, "CANNOT_ASSESS");
  assert.notStrictEqual(d.disposition, "RELEASE");
  assert.strictEqual(d.executeRaw, false);
});
check("AN EMPTY predictedValue IS LAWFUL — the book permits it deliberately", () => {
  // CORRECTED S101. This test previously asserted the opposite. The precommit
  // module documents `predictedValue` as "May be empty: a prediction that a
  // field will be empty is a prediction", refuses an empty committerId and an
  // empty target, and admits an empty predictedValue into the chain. F4 refusing
  // it failed the WHOLE LEG on a lawful record. A match on empty is the
  // prediction coming true, not a free SILENT.
  const emptyMatched = withProbes([
    probe({ predictedValue: "", observed: { observedValue: "", observedBy: "o", observedAt: 1 } }),
  ]);
  assert.strictEqual(emptyMatched.flags[F4].kind, "SILENT");
  assert.strictEqual(emptyMatched.flags[F4].scopeSize, 1);

  const emptyDiverged = withProbes([
    probe({ predictedValue: "", observed: { observedValue: "GREEN", observedBy: "o", observedAt: 1 } }),
  ]);
  assert.strictEqual(emptyDiverged.flags[F4].kind, "ALARM");
});
check("an empty TARGET is still malformed — precommit refuses that one at deposit", () => {
  // The alignment cuts both ways: F4's non-empty bars on target and committerId
  // MATCH precommit's own deposit-time refusals, so they stay.
  const badTarget = withProbes([probe({ target: "" })]);
  assert.strictEqual(badTarget.flags[F4].kind, "CANNOT_ASSESS");
  assert.ok(badTarget.flags[F4].blindPaths[0].detail.includes("target"));
});
check("two records for one commitment: F4 refuses to choose between them", () => {
  const dup = withProbes([probe({ commitmentSeq: 7 }), probe({ commitmentSeq: 7, predictedValue: "RED" })]);
  assert.strictEqual(dup.flags[F4].kind, "CANNOT_ASSESS");
  assert.ok(dup.flags[F4].blindPaths[0].detail.includes("cannot choose between them"));
});

// ── The three per-record refusals ────────────────────────────────────────────

console.log("\n── F4 · what it declines to read, one record at a time ──");

check("a MISMATCHed seal is BLIND, not a divergence — seal integrity is the book's finding", () => {
  const bad = withProbes([
    probe({ sealCheck: "MISMATCH", observed: { observedValue: "RED", observedBy: "o", observedAt: 1 } }),
  ]);
  assert.strictEqual(bad.flags[F4].kind, "CANNOT_ASSESS");
  assert.strictEqual(bad.flags[F4].findings.length, 0, "a broken seal is never reported as divergence");
  assert.ok(bad.flags[F4].blindPaths[0].detail.includes("no trustworthy sealed prediction"));
});
check("WITHIN-SWEEP ORDER IS NOT EVIDENCE — unestablished order reads CANNOT_ASSESS, not ALARM", () => {
  // Board S100-B(3): the chain's within-sweep order is decided by a random
  // frame-name suffix and is finer than the evidence supports.
  const unordered = withProbes([
    probe({
      orderEvidence: "ORDER_NOT_ESTABLISHED",
      observed: { observedValue: "RED", observedBy: "o", observedAt: 1 },
    }),
  ]);
  assert.strictEqual(unordered.flags[F4].kind, "CANNOT_ASSESS");
  assert.strictEqual(unordered.flags[F4].findings.length, 0, "no order is asserted, so no divergence is claimed");
  assert.ok(unordered.flags[F4].blindPaths[0].detail.includes("asserts no order of its own"));
  assert.strictEqual(unordered.flags[F4].blindPaths[0].class, "INELIGIBLE_SCOPE");
});
// ── S101 · THE LIVE SHAPE — a PERFECT MATCH that still cannot be read ────────
//
// This is the decision the first live run turns on, pinned here so it is
// checkable without the live data and cannot drift.
//
// The live ProbeSource (2 records, commitments 0 and 2 of the doctor's book)
// carries sealCheck MATCH, a predictedValue equal to the observedValue
// character-for-character, and orderEvidence ORDER_NOT_ESTABLISHED — because no
// sweepPeriodMs was injected, and, for commitment 0, because its ANCHOR is
// permanently CANNOT_SEE.
//
// The values below are SHORT STAND-INS, not the live strings: the decision does
// not depend on their contents, only on their EQUALITY, and a fixture pretending
// to be the live record would be the thing this whole leg exists to catch.
check("A PERFECT MATCH WITH NO ORDER EVIDENCE READS CANNOT_ASSESS, NEVER SILENT", () => {
  const matchedButUnordered = withProbes([
    probe({
      commitmentSeq: 0,
      predictedValue: "LOADED_VERIFIED valid=true 3",
      orderEvidence: "ORDER_NOT_ESTABLISHED",
      observed: {
        observedValue: "LOADED_VERIFIED valid=true 3",
        observedBy: "mica-build-seat",
        observedAt: 1_788_294_613_264,
      },
    }),
  ]);
  // The two values ARE equal. F4 still declines to call it a match, because it
  // cannot establish that the seal predates the observation — a "match" it
  // cannot order could be a prediction written after the event it predicts.
  assert.strictEqual(matchedButUnordered.flags[F4].kind, "CANNOT_ASSESS");
  assert.strictEqual(matchedButUnordered.flags[F4].findings.length, 0, "equal values are never an ALARM");
  assert.strictEqual(matchedButUnordered.verdict.kind, "CANNOT_ASSESS");
  assert.ok(
    matchedButUnordered.flags[F4].blindPaths[0].detail.includes("does not establish that the seal PREDATES"),
    "and it says exactly why it declined"
  );
});
check("SILENT is reachable for the SAME record once order IS established", () => {
  // The control: the only difference is the order evidence. Without this, the
  // test above would pass for a leg that could never read anything at all.
  const ordered = withProbes([
    probe({
      commitmentSeq: 0,
      predictedValue: "LOADED_VERIFIED valid=true 3",
      orderEvidence: "SEALED_BEFORE_OBSERVED",
      observed: {
        observedValue: "LOADED_VERIFIED valid=true 3",
        observedBy: "mica-build-seat",
        observedAt: 1_788_294_613_264,
      },
    }),
  ]);
  assert.strictEqual(ordered.flags[F4].kind, "SILENT");
  assert.strictEqual(ordered.verdict.kind, "SILENT");
});

check("`claim+rule` is refused: adjudicating a claim against a rule is a grader's act", () => {
  const cr = withProbes([
    probe({
      expectationType: "claim+rule",
      observed: { observedValue: "RED", observedBy: "o", observedAt: 1 },
    }),
  ]);
  assert.strictEqual(cr.flags[F4].kind, "CANNOT_ASSESS");
  assert.strictEqual(cr.flags[F4].findings.length, 0);
  assert.ok(cr.flags[F4].blindPaths[0].detail.includes("GRADER's judgement"));
  assert.strictEqual(cr.flags[F4].blindPaths[0].class, "INELIGIBLE_SCOPE");
});
check("a divergence and a blind record in one sweep: ALARM stands, the unread scope rides along", () => {
  const both = withProbes([
    probe({ commitmentSeq: 2, observed: { observedValue: "RED", observedBy: "o", observedAt: 1 } }),
    probe({ commitmentSeq: 4, expectationType: "claim+rule" }),
  ]);
  assert.strictEqual(both.flags[F4].kind, "ALARM");
  assert.strictEqual(both.flags[F4].scopeSize, 2);
  assert.strictEqual(both.verdict.kind, "ALARM");
  assert.ok(both.verdict.kind === "ALARM");
  assert.ok(
    both.verdict.findings.some((f) => f.code === "SIG_SCOPE_UNREAD"),
    "the blind record is carried into the verdict, not dropped behind the alarm"
  );
});

// ── Sig owns the comparison and nothing else ─────────────────────────────────

console.log("\n── F4 · injected, never coupled ──");

check("Sig imports nothing from the pre-commitment module, the book, or the registrar", () => {
  const src: string = require("fs").readFileSync(
    join(__dirname, "sig", "index.ts"),
    "utf8"
  );
  for (const forbidden of ["precommit", "registrar", "witness", "book.jsonl"]) {
    assert.ok(
      !new RegExp(`from\\s+["'][^"']*${forbidden}`).test(src),
      `sig/index.ts must hold no import edge to ${forbidden}`
    );
  }
});
check("THE LIMIT — Sig never verifies the join it was handed", () => {
  const { sigScopeBlockText } = require("./sig");
  const text: string = sigScopeBlockText(["LOADED_VERIFIED"]);
  assert.ok(text.includes("SIG NEVER VERIFIES THE JOIN"));
  assert.ok(text.includes("if that assembler is"), "the assembler-is-the-observed-party case is printed");
});

rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} tests: ${passed} passed, 0 failed`);
