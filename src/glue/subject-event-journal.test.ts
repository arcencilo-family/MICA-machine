// ── GLUE · the chained subject log — tests ───────────────────────────────────
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node src/glue/subject-event-journal.test.ts
//
// THE FIXTURES ARE REAL CHAINS written by the REAL `SubjectEventJournal` in a
// tmpdir, in the shape the BRIDGE actually writes (C9's record, verbatim from
// `mica-service.ts:2131-2160`), so what is under test is the grammar that will
// exist on the box and not one copied out of a paste. Nothing here touches the
// live store, and nothing here writes outside the tmpdir.
//
// ── THE FOUR PRE-REGISTERED READINGS (brief §5, procedure) ───────────────────
//
//   (a) today's UNCHAINED log, read by the subject-chain reader
//   (b) a CHAINED log
//   (c) a chained log with a DAMAGED LAST LINE
//   (d) the BOUNDARY record's effect on Sig and Eng
//
// Each is a named block below, and each is written so a mutation that made the
// reader lenient would fail it. See `mica-mutation-demo-20260922-acta.txt`.

import * as assert from "assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
// TYPE-ONLY, AND THAT IS THE WHOLE POINT. `wire.ts` imports THIS file's subject, so
// the two checks below load it LATE, with `require()` inside the check body, and that
// lateness is deliberate. Annotating that require with `typeof import("./wire")` made
// each site a dynamic `import()` expression the repository's closure scanner cannot
// see, so `closure.test.ts` required both to be declared as blind spots — and the only
// place that declaration can live is inside `closure.test.ts` itself, which is PINNED
// CORE and is the arbiter's door. Declaring them would have drifted a pinned file with
// no ticket; the door refused it, correctly.
//
// `import type` is erased entirely at runtime, so this adds no load and no cycle. The
// scanner now sees one ordinary quoted specifier resolving inside src/, there is no
// blind spot to declare, and src/mica/** is untouched. Removing the blindness beats
// declaring it.
import type * as WireModule from "./wire";

import {
  CLERK_STAMPS_FIRST_LOAD_EVENT_TYPE,
  FORBIDDEN_LOAD_STATE,
  LOADED_SUBJECT_CHAIN_VERIFIED,
  SUBJECT_CHAIN_ATTESTS,
  SUBJECT_CHAIN_OWN_EVENT_TYPES,
  SUBJECT_LOG_BOUNDARY_EVENT_TYPE,
  SUBJECT_LOG_BOUNDARY_MODULE_ID,
  SUBJECT_LOG_BOUNDARY_OUTCOME,
  SubjectChainLog,
  SubjectEventJournal,
  durableLineAppender,
  subjectRecordHash,
  validateSubjectRecord,
} from "./subject-event-journal";
import { MicaLogFile, LOADED_UNVERIFIED_FILE } from "./mica-log-file";
import { assessSig } from "../mica/sig";
import { assessEng, engStructure } from "../mica/eng";
import { assessLogReadability } from "../mica/types";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).stack ?? String(err)}`);
  }
}

const root = mkdtempSync(join(tmpdir(), "mica-subject-chain-"));
let clock = 1_800_000_000_000;
const tick = (): number => (clock += 1_000);

/** The bridge's C9 record, verbatim in shape. `subjectSeq` rides alongside. */
function bridgeEvent(subjectSeq: number, subject: string, kind: string, outcome: string) {
  const at = tick();
  return {
    subjectSeq,
    ts: new Date(at).toISOString(),
    identity: { subject, sessionId: "s1", actionId: `a${String(subjectSeq)}` },
    kind,
    eventHash: `hash-${String(subjectSeq)}`,
    peerUid: 1000,
    sequenceNumber: subjectSeq,
    timestamp: at,
    moduleId: subject,
    eventType: kind,
    actionId: `a${String(subjectSeq)}`,
    outcome,
  };
}

/** A real chain: a boundary record plus `n` real bridge-shaped events. */
function realChain(name: string, n = 4, retire = true): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "subject-events.jsonl");
  const j = new SubjectEventJournal({ path });
  const b = j.appendBoundary(
    retire
      ? {
          // NEVER the live box's own path, even as a fixture STRING:
          // tools/suite-source-fence.test.ts SF-D forbids a test file naming a
          // deployment path in code, and it caught this line. The rule reads a
          // SHAPE, and the shape is how a fixture becomes a live write.
          path: join(dir, "subject-events.20260922-000000.pre-chain-boundary.jsonl"),
          records: 57,
          bytes: 26_411,
          sha256: "a".repeat(64),
        }
      : null,
    "fixture",
    tick()
  );
  assert.ok(b.persisted, `boundary did not persist: ${String(b.detail)}`);
  // Outcomes vary WITHIN a class on purpose: a table where each class has one
  // outcome is perfectly predictive and its AMI is 1 whatever else is in it,
  // which would make the boundary record's effect on Eng unmeasurable.
  const kinds = ["TOOL_CALL", "TOOL_RESULT"];
  const outcomes = ["OK", "REFUSED", "OK", "TIMEOUT"];
  for (let i = 1; i <= n; i++) {
    const r = j.appendEvent((seq) =>
      bridgeEvent(seq, "richards-cat", kinds[i % 2], outcomes[i % 4])
    );
    assert.ok(r.persisted, `event ${String(i)} did not persist: ${String(r.detail)}`);
  }
  return path;
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── (b) A CHAINED LOG — the reading this act exists to produce ──");
// ════════════════════════════════════════════════════════════════════════════

const goodPath = realChain("good");
const good = new SubjectChainLog({ path: goodPath });

check("SC-B1 · a real chain LOADS as LOADED_SUBJECT_CHAIN_VERIFIED and verifies", () => {
  assert.strictEqual(good.getLoadState(), LOADED_SUBJECT_CHAIN_VERIFIED);
  assert.strictEqual(good.verify().valid, true);
  assert.strictEqual(good.recordCount, 5, "1 boundary + 4 events");
});

check("SC-B2 · the load state is NOT `LOADED_VERIFIED` — never one word for two facts", () => {
  // The arbiter, ruling 2. `witness-log-file.ts:126-131` argues this side by name and
  // this store is a THIRD fact again: chained by the party it is about. If this
  // ever becomes the shared literal, the whole distinction is gone in one line.
  assert.notStrictEqual(good.getLoadState(), FORBIDDEN_LOAD_STATE);
  assert.strictEqual(LOADED_SUBJECT_CHAIN_VERIFIED, "LOADED_SUBJECT_CHAIN_VERIFIED");
  assert.notStrictEqual(LOADED_SUBJECT_CHAIN_VERIFIED, FORBIDDEN_LOAD_STATE);
});

check("SC-B3 · the gate OPENS on a chained log when the new state is declared", () => {
  const verdict = assessLogReadability(good, "MICA/Eng", [LOADED_SUBJECT_CHAIN_VERIFIED]);
  assert.strictEqual(verdict, null, "a declared, verified chain is readable");
});

check("SC-B4 · the gate STAYS SHUT when the new state is not in the declared list", () => {
  // The unwelcome way this act fails (brief §5): a verified chain reporting a
  // state nobody declared makes the machine BLINDER than before.
  const verdict = assessLogReadability(good, "MICA/Eng", ["LOADED_VERIFIED"]);
  assert.ok(verdict !== null, "an undeclared state must not be read");
  assert.strictEqual(verdict.kind, "CANNOT_ASSESS");
  assert.ok(
    JSON.stringify(verdict).includes("NON_CLEAN_LOAD_STATE"),
    JSON.stringify(verdict).slice(0, 300)
  );
});

check("SC-B5 · subjectSeq === the chain position, BY CONSTRUCTION (boundary at 0)", () => {
  // The bridge has always returned a 1-based `seq` to its caller. With the
  // boundary at position 0, the chain's positional sequence IS that number, so
  // no external contract moves. Pinned so a successor does not tidy one away.
  const lines = readFileSync(goodPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  for (let i = 1; i < lines.length; i++) {
    assert.strictEqual(lines[i].sequenceNumber, i);
    assert.strictEqual(lines[i].subjectSeq, i, "subjectSeq and the chain position coincide");
  }
});

check("SC-B6 · the bridge's own fields survive verbatim and are HASHED", () => {
  const lines = readFileSync(goodPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const e = lines[1];
  for (const k of ["subjectSeq", "ts", "identity", "kind", "eventHash", "peerUid"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(e, k), `${k} was dropped`);
  }
  // Unvalidated is not unhashed: change one and the chain breaks.
  const { hash, ...rest } = e;
  assert.strictEqual(subjectRecordHash(rest), hash);
  const tampered = { ...rest, peerUid: 0 };
  assert.notStrictEqual(subjectRecordHash(tampered), hash, "peerUid is outside the hash");
});

check("SC-B7 · the attestation sentence says TAMPER-EVIDENT, NOT INDEPENDENT", () => {
  // The publication width, ruled. If this sentence ever loses the second half,
  // the receipt and the census start implying Act B was done.
  assert.ok(SUBJECT_CHAIN_ATTESTS.includes("TAMPER-EVIDENT, NOT INDEPENDENT"));
  assert.ok(SUBJECT_CHAIN_ATTESTS.includes("SAME PRINCIPAL"));
  assert.ok(good.describe().includes("subject chain"));
  assert.ok(good.describe().includes("boundary=retired("), good.describe());
});

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── (a) TODAY'S UNCHAINED LOG, read by the new reader ─────────");
// ════════════════════════════════════════════════════════════════════════════

const unchainedDir = join(root, "unchained");
mkdirSync(unchainedDir, { recursive: true });
const unchainedPath = join(unchainedDir, "subject-events.jsonl");
writeFileSync(
  unchainedPath,
  [1, 2, 3]
    .map((i) => JSON.stringify(bridgeEvent(i, "richards-cat", "TOOL_CALL", "OK")))
    .join("\n") + "\n",
  "utf8"
);

check("SC-A1 · today's log reads LOADED_UNVERIFIED_FILE under the OLD reader", () => {
  // The live baseline, reproduced: /status this run reports exactly this for
  // both footings over 57 records. The act's whole job is to move this.
  const old = new MicaLogFile({ path: unchainedPath });
  assert.strictEqual(old.getLoadState(), LOADED_UNVERIFIED_FILE);
  assert.strictEqual(old.verify().valid, true, "parse+order OK — and no chain checked");
});

check("SC-A2 · the SUBJECT-CHAIN reader REFUSES an unchained file — the mutation kill", () => {
  // ⚠ THE MUTATION THIS EXISTS FOR: a reader that reported the new, verified
  // load state for a file with no chain in it. That is the whole act, undone in
  // one line, and it would print `verifiedChain: true` about bytes nobody
  // chained.
  const l = new SubjectChainLog({ path: unchainedPath });
  assert.notStrictEqual(l.getLoadState(), LOADED_SUBJECT_CHAIN_VERIFIED);
  assert.strictEqual(l.getLoadState(), "SUBJECT_CHAIN_UNVERIFIED_SCHEMA");
  assert.strictEqual(l.verify().valid, false);
  assert.strictEqual(l.getAll().length, 0, "nothing is offered from a file that did not verify");
});

check("SC-A3 · a chain-shaped file with NO boundary at position 0 is REFUSED", () => {
  // E13's amnesia, caught at load: a chain that restarted at 0 with nothing
  // recording that a prior chain existed VERIFIES and LIES BY OMISSION.
  const dir = join(root, "no-boundary");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "s.jsonl");
  const j = new SubjectEventJournal({ path: p });
  // Build the amnesiac file by hand — the writer itself refuses to make one.
  const body = { ...bridgeEvent(0, "richards-cat", "TOOL_CALL", "OK"), recordType: "SUBJECT_EVENT", sequenceNumber: 0, previousHash: "" };
  writeFileSync(p, JSON.stringify({ ...body, hash: subjectRecordHash(body) }) + "\n", "utf8");
  const l = new SubjectChainLog({ path: p });
  assert.strictEqual(l.getLoadState(), "SUBJECT_CHAIN_NO_BOUNDARY");
  assert.strictEqual(l.verify().valid, false);
  assert.ok((l.getProblem() ?? "").includes("cannot say where it began"), l.getProblem() ?? "");
  // And the writer will not create one either.
  assert.throws(
    () => new SubjectEventJournal({ path: join(dir, "fresh.jsonl") }).appendEvent((seq) => bridgeEvent(seq, "x", "K", "OK")),
    /no SUBJECT_LOG_BOUNDARY at position 0/
  );
  void j;
});

check("SC-A4 · a REWRITTEN middle record BREAKS the chain — tamper evidence, fired", () => {
  const p = realChain("rewritten");
  const lines = readFileSync(p, "utf8").trim().split("\n");
  const r = JSON.parse(lines[2]);
  r.outcome = "OK_ACTUALLY_NOT";
  lines[2] = JSON.stringify(r);
  writeFileSync(p, lines.join("\n") + "\n", "utf8");
  const l = new SubjectChainLog({ path: p });
  assert.strictEqual(l.getLoadState(), "SUBJECT_CHAIN_BROKEN");
  assert.strictEqual(l.verify().valid, false);
  assert.strictEqual(l.verify().brokenAt, 2);
  assert.strictEqual(l.getAll().length, 0);
});

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── (c) A DAMAGED LAST LINE — stop and shout (the arbiter, ruling 6) ──");
// ════════════════════════════════════════════════════════════════════════════

function tornChain(name: string): string {
  const p = realChain(name);
  // A torn write from a crash mid-append: half a record, no newline.
  appendFileSync(p, '{"recordType":"SUBJECT_EVENT","sequenceNu', "utf8");
  return p;
}

check("SC-C1 · a torn last line is REFUSED, not quarantined — the mutation kill", () => {
  // ⚠ THE MUTATION THIS EXISTS FOR: a reader that quietly dropped the damaged
  // tail and loaded the prefix, like `decision-journal.ts` does for its own
  // (different) product, or `SerializedAppender.evictTrailingCorruption()` does
  // by truncating the bytes away. In a CHAINED store the torn line was a LINK.
  const l = new SubjectChainLog({ path: tornChain("torn") });
  assert.strictEqual(l.getLoadState(), "SUBJECT_CHAIN_TORN_TAIL");
  assert.strictEqual(l.verify().valid, false);
  assert.strictEqual(
    l.getAll().length,
    0,
    "NOT n-1 records read clean: a partial chain handed to a reader is the quiet loss"
  );
  assert.ok((l.getProblem() ?? "").includes("that line was a LINK"), l.getProblem() ?? "");
});

check("SC-C2 · a torn tail makes EVERY instrument CANNOT_ASSESS(BROKEN_CHAIN)", () => {
  const l = new SubjectChainLog({ path: tornChain("torn-readers") });
  for (const id of ["MICA/Eng", "MICA/Sig"]) {
    const v = assessLogReadability(l, id, [LOADED_SUBJECT_CHAIN_VERIFIED]);
    assert.ok(v !== null, `${id} read a torn chain`);
    assert.strictEqual(v.kind, "CANNOT_ASSESS");
    assert.ok(JSON.stringify(v).includes("BROKEN_CHAIN"), JSON.stringify(v).slice(0, 200));
  }
});

check("SC-C3 · the WRITER refuses to append over damage, and the file does not grow", () => {
  const p = tornChain("torn-writer");
  const before = readFileSync(p, "utf8");
  const j = new SubjectEventJournal({ path: p });
  assert.strictEqual(j.isPersisting(), false, "a damaged store is not persisting");
  const out = j.appendEvent((seq) => bridgeEvent(seq, "richards-cat", "TOOL_CALL", "OK"));
  assert.strictEqual(out.persisted, false);
  assert.strictEqual(out.committed, false);
  assert.ok(out.record !== undefined, "the candidate that did NOT land is still reported");
  assert.strictEqual(readFileSync(p, "utf8"), before, "not one byte was written over the damage");
});

// ── (c-bis) THE BLANK LINE — the hole the cold verifier found, 2026-09-23 ───
//
// Codex inserted one empty line into a VALID chain and got
// `LOADED_SUBJECT_CHAIN_VERIFIED`, `verify().valid === true`, the full record
// count — and a fresh writer then appended to the file successfully. The
// loader was filtering every whitespace-only line away before it validated
// anything, so a malformed line could be ignored AND the file extended. These
// checks are that finding turned into the thing that fails if it ever comes
// back. The arbiter ordered a regression test at BOTH layers: this is the store
// layer; `mica-service.test.ts` carries the service layer.

/** A valid chain with one blank line spliced in after record `after`. */
function blankLineChain(name: string, after = 1, filler = ""): string {
  const p = realChain(name);
  const lines = readFileSync(p, "utf8").split("\n");
  // `lines` ends with "" — the last record's own newline. Splice INSIDE that.
  lines.splice(after, 0, filler);
  writeFileSync(p, lines.join("\n"), "utf8");
  return p;
}

check("SC-G1 · a blank line inside a valid chain is REFUSED — the cold verifier's finding", () => {
  // ⚠ THE MUTATION THIS EXISTS FOR: any reader that filters, skips or trims
  // away a whitespace-only line before it validates. Before the fix this
  // assertion read LOADED_SUBJECT_CHAIN_VERIFIED, valid=true, 5 records.
  const l = new SubjectChainLog({ path: blankLineChain("blank") });
  assert.strictEqual(l.getLoadState(), "SUBJECT_CHAIN_BLANK_LINE");
  assert.strictEqual(l.verify().valid, false, "a chain with an ignored line is NOT verified");
  assert.strictEqual(l.getAll().length, 0, "NOT the records either side of it");
  assert.ok((l.getProblem() ?? "").includes("EMPTY or"), l.getProblem() ?? "");
});

check("SC-G2 · a WHITESPACE-only line is refused too, not only an empty one", () => {
  // A line of spaces and a tab survives every `!== ""` a successor might reach
  // for. `.trim().length === 0` is the predicate, and it lives in one place.
  const l = new SubjectChainLog({ path: blankLineChain("blank-ws", 2, "  \t ") });
  assert.strictEqual(l.getLoadState(), "SUBJECT_CHAIN_BLANK_LINE");
  assert.strictEqual(l.getAll().length, 0);
});

check("SC-G3 · a TRAILING blank line is refused as well — an extra newline is an edit", () => {
  // Distinct from SC-C1: a torn tail is half a record; this is a bare newline
  // on the end. Both refused, and told apart BY NAME rather than folded.
  const p = realChain("blank-tail");
  appendFileSync(p, "\n", "utf8");
  const l = new SubjectChainLog({ path: p });
  assert.strictEqual(l.getLoadState(), "SUBJECT_CHAIN_BLANK_LINE");
  assert.notStrictEqual(l.getLoadState(), "SUBJECT_CHAIN_TORN_TAIL", "not one word for two facts");
  assert.strictEqual(l.getAll().length, 0);
});

check("SC-G4 · the ORDINARY trailing newline is still the file's normal shape", () => {
  // The non-regression that stops SC-G1..G3 from being a reader which refuses
  // every JSONL file ever written. Every record ends with its own "\n".
  const p = realChain("blank-control");
  assert.ok(readFileSync(p, "utf8").endsWith("\n"), "the fixture really does end in a newline");
  const l = new SubjectChainLog({ path: p });
  assert.strictEqual(l.getLoadState(), LOADED_SUBJECT_CHAIN_VERIFIED);
  assert.strictEqual(l.verify().valid, true);
  assert.strictEqual(l.getAll().length, 5, "boundary + 4 events; no line invented and none lost");
});

check("SC-G5 · a FRESH writer will not extend a file with a blank line in it", () => {
  // Codex's exact second half: the reader called it verified, so the writer wrote.
  const p = blankLineChain("blank-writer");
  const before = readFileSync(p, "utf8");
  const j = new SubjectEventJournal({ path: p });
  assert.strictEqual(j.isPersisting(), false, "a file with an ignored line is not persisting");
  const out = j.appendEvent((seq) => bridgeEvent(seq, "richards-cat", "TOOL_CALL", "OK"));
  assert.strictEqual(out.persisted, false);
  assert.strictEqual(out.committed, false);
  assert.strictEqual(readFileSync(p, "utf8"), before, "not one byte was added past the blank line");
});

check("SC-G6 · a blank line inserted AFTER load BLOCKS the append, under the lock, from GLUE", () => {
  // ⚠ THE ONE THAT PROVES THE FENCE HELD. `resyncAppendStore`
  // (`src/mica/store/append-store.ts:278`) still filters whitespace lines away
  // and was NOT touched — core, both Act A tickets spent. The refusal is
  // enforced by the journal's own re-read inside the `resync` callback, which
  // the core invokes under the exclusive lock BEFORE a sequence number is
  // derived or a byte is written. If this ever fails, the writer is extending
  // past an ignored line again and the core filter is load-bearing after all.
  const p = realChain("blank-resync");
  const j = new SubjectEventJournal({ path: p });
  assert.strictEqual(j.isPersisting(), true, "it loaded clean — the damage comes next");
  // Somebody else edits the file while this writer holds it loaded.
  const lines = readFileSync(p, "utf8").split("\n");
  lines.splice(2, 0, "");
  writeFileSync(p, lines.join("\n"), "utf8");
  const before = readFileSync(p, "utf8");
  const out = j.appendEvent((seq) => bridgeEvent(seq, "richards-cat", "TOOL_CALL", "OK"));
  assert.strictEqual(out.persisted, false, "the append must not land on an edited file");
  assert.strictEqual(out.committed, false);
  assert.ok((out.detail ?? "").includes("EMPTY or"), out.detail ?? "no detail");
  assert.strictEqual(readFileSync(p, "utf8"), before, "not one byte was appended");
  assert.throws(() => readFileSync(`${p}.lock`, "utf8"), /ENOENT/, "the lock was released");
});

check("SC-C4 · nothing is ever moved to a .quarantine sidecar by this store", () => {
  // `SerializedAppender` writes `<path>.quarantine` and truncates. This store
  // must not, ever: the record of what happened is the thing being protected.
  const p = tornChain("torn-sidecar");
  const j = new SubjectEventJournal({ path: p });
  j.appendEvent((seq) => bridgeEvent(seq, "richards-cat", "TOOL_CALL", "OK"));
  assert.throws(() => readFileSync(`${p}.quarantine`, "utf8"), /ENOENT/);
});

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── (d) WHAT SIG AND ENG DO WHEN THEY MEET THE BOUNDARY RECORD ──");
// ════════════════════════════════════════════════════════════════════════════

const dLog = new SubjectChainLog({ path: realChain("readers", 8) });
const dRecords = dLog.getAll();

check("SC-D1 · the boundary record IS in the chain, at position 0, with its own kind", () => {
  assert.strictEqual(dRecords[0].sequenceNumber, 0);
  assert.strictEqual(dRecords[0].eventType, SUBJECT_LOG_BOUNDARY_EVENT_TYPE);
  assert.strictEqual(dRecords[0].moduleId, SUBJECT_LOG_BOUNDARY_MODULE_ID);
  assert.strictEqual(dRecords[0].outcome, SUBJECT_LOG_BOUNDARY_OUTCOME);
  const b = dLog.getBoundary();
  assert.ok(b !== null && b.retired !== null, "it names what it replaced");
});

check("SC-D2 · Sig F2 IGNORES it — the eventType is in NEITHER map, the safe default", () => {
  // A NEW *CLEAR* WOULD SILENCE THE ONE SIGNAL ON THIS LOG THAT CAN ALARM ON
  // SOMETHING REAL. F2 governs exactly the eventTypes that are KEYS in the
  // injected maps; a kind in neither is outside its scope and invisible to it.
  const preconditionMap = { TOOL_RESULT: ["TOOL_CALL"] };
  const reentryMap = { TOOL_CALL: ["TOOL_RESULT"] };
  for (const m of [preconditionMap, reentryMap]) {
    for (const own of SUBJECT_CHAIN_OWN_EVENT_TYPES) {
      assert.ok(!Object.prototype.hasOwnProperty.call(m, own), `${own} must stay OUT of the Sig maps`);
    }
  }
  const withBoundary = assessSig(dLog, {
    readableLoadStates: [LOADED_SUBJECT_CHAIN_VERIFIED],
    clockToleranceMs: 60_000,
    preconditionMap,
    reentryMap,
  });
  // The same chain with the boundary record filtered out reads the same F2.
  const f2With = withBoundary.flags.find((f) => f.flag === "F2");
  const bare = {
    verify: () => ({ valid: true }) as const,
    getLoadState: () => LOADED_SUBJECT_CHAIN_VERIFIED,
    getAll: () => dRecords.filter((r) => r.eventType !== SUBJECT_LOG_BOUNDARY_EVENT_TYPE),
  };
  const f2Without = assessSig(bare, {
    readableLoadStates: [LOADED_SUBJECT_CHAIN_VERIFIED],
    clockToleranceMs: 60_000,
    preconditionMap,
    reentryMap,
  }).flags.find((f) => f.flag === "F2");
  assert.ok(f2With !== undefined && f2Without !== undefined);
  assert.strictEqual(f2With.kind, f2Without.kind, "F2's verdict does not move for the boundary");
  assert.strictEqual(f2With.scopeSize, f2Without.scopeSize, "and the boundary is not in its scope");
});

check("SC-D3 · Sig F1 SEES it — it is an ordered record, and its clock runs forward", () => {
  const f1 = assessSig(dLog, {
    readableLoadStates: [LOADED_SUBJECT_CHAIN_VERIFIED],
    clockToleranceMs: 60_000,
  }).flags.find((f) => f.flag === "F1");
  assert.ok(f1 !== undefined);
  // The boundary is written at the rotation instant, before every event in the
  // chain, so its pair with the first event has a non-negative delta.
  assert.ok(dRecords[0].timestamp <= dRecords[1].timestamp, "the boundary precedes event 1");
  assert.notStrictEqual(f1.kind, "ALARM", `F1 alarmed on a forward clock: ${JSON.stringify(f1)}`);
});

check("SC-D4 · Eng SEES it — one singleton class, one singleton outcome, NOT invisible", () => {
  // Stated as a measurement rather than as reassurance. The boundary adds one
  // entry, one event class and one outcome value that occur nowhere else; the
  // AMI moves, and this records the direction and the size rather than
  // implying it is zero.
  const without = dRecords.filter((r) => r.eventType !== SUBJECT_LOG_BOUNDARY_EVENT_TYPE);
  const sWith = engStructure(dRecords);
  const sWithout = engStructure(without);
  assert.strictEqual(sWith.sampleSize, sWithout.sampleSize + 1, "exactly one extra entry");
  assert.strictEqual(sWith.distinctClasses, sWithout.distinctClasses + 1, "one new class");
  assert.strictEqual(sWith.distinctOutcomes, sWithout.distinctOutcomes + 1, "one new outcome");
  const fmt = (x: number | null): string => (x === null ? "null (undefined for this table)" : x.toFixed(6));
  console.log(
    `      AMI with boundary = ${fmt(sWith.ami)} · without = ${fmt(sWithout.ami)} ` +
      `· over n=${String(sWith.sampleSize)}`
  );
  const eng = assessEng(dLog, {
    readableLoadStates: [LOADED_SUBJECT_CHAIN_VERIFIED],
    structureThreshold: 0.9,
    minimumSampleSize: 2,
  });
  assert.ok(eng.verdict !== undefined, "Eng reads the chain rather than refusing it");
});

check("SC-D5 · a SUBJECT EVENT may not wear the boundary's eventType", () => {
  // One kind, one meaning: a subject that could post SUBJECT_LOG_BOUNDARY could
  // mint a second "log starts here" inside a running chain.
  const body = {
    recordType: "SUBJECT_EVENT",
    sequenceNumber: 1,
    previousHash: "x",
    timestamp: 1,
    moduleId: "richards-cat",
    eventType: SUBJECT_LOG_BOUNDARY_EVENT_TYPE,
    outcome: "OK",
    hash: "y",
  };
  assert.strictEqual(validateSubjectRecord(body), null);
});

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── THE fsync, AND THE LOCK — owed with Act A ───────────────────");
// ════════════════════════════════════════════════════════════════════════════

check("SC-F1 · the default appender IS `durableLineAppender` — the mutation kill", () => {
  // ⚠ THE MUTATION THIS EXISTS FOR: an appender that omits the fsync. Today the
  // subject log's writer is a bare `appendFileSync` (mica-service.ts:511, :569)
  // and a power loss drops an acked record — mildly bad while nothing chains.
  // After chaining, a lost or torn tail is a CHAIN BREAK and every reader goes
  // blind until a human acts. `durableLineAppender` holds the fd and fsyncs
  // before closing (append-store.ts); THAT the fsync happens is pinned in
  // `src/mica/store/append-store.test.ts`, and that THIS store uses it is
  // pinned here, by identity.
  const j = new SubjectEventJournal({ path: join(root, "fsync", "s.jsonl") });
  assert.strictEqual(j.getAppender(), durableLineAppender);
  const memoryOnly = new SubjectEventJournal();
  assert.strictEqual(memoryOnly.getAppender(), durableLineAppender);
});

check("SC-F2 · an appender that throws leaves the committed prefix EXACTLY as it was", () => {
  const dir = join(root, "throwing");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "s.jsonl");
  const j = new SubjectEventJournal({ path: p });
  j.appendBoundary(null, "fixture", tick());
  const before = readFileSync(p, "utf8");
  const j2 = new SubjectEventJournal({
    path: p,
    appender: () => {
      throw new Error("ENOSPC simulated");
    },
  });
  const out = j2.appendEvent((seq) => bridgeEvent(seq, "richards-cat", "TOOL_CALL", "OK"));
  assert.strictEqual(out.persisted, false);
  assert.strictEqual(out.committed, false);
  assert.strictEqual(readFileSync(p, "utf8"), before);
  assert.ok((j2.getLastError() ?? "").includes("ENOSPC simulated"), j2.getLastError() ?? "");
});

check("SC-F3 · an unavailable lock BLOCKS the append — never a silent unlocked write", () => {
  const dir = join(root, "locked");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "s.jsonl");
  const j = new SubjectEventJournal({ path: p });
  j.appendBoundary(null, "fixture", tick());
  const before = readFileSync(p, "utf8");
  const j2 = new SubjectEventJournal({
    path: p,
    acquire: () => ({ acquired: false, reason: "the lock file already exists" }),
  });
  const out = j2.appendEvent((seq) => bridgeEvent(seq, "richards-cat", "TOOL_CALL", "OK"));
  assert.strictEqual(out.persisted, false);
  assert.strictEqual(readFileSync(p, "utf8"), before);
  assert.ok((out.detail ?? "").includes("subject chain append lock"), out.detail ?? "");
});

check("SC-F4 · a chain FORKED on disk blocks the append rather than deepening the fork", () => {
  const dir = join(root, "forked");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "s.jsonl");
  const j = new SubjectEventJournal({ path: p });
  j.appendBoundary(null, "fixture", tick());
  j.appendEvent((seq) => bridgeEvent(seq, "richards-cat", "TOOL_CALL", "OK"));
  // Another writer replaces the file with a shorter one: truncated or replaced.
  const lines = readFileSync(p, "utf8").trim().split("\n");
  writeFileSync(p, lines[0] + "\n", "utf8");
  const out = j.appendEvent((seq) => bridgeEvent(seq, "richards-cat", "TOOL_CALL", "OK"));
  assert.strictEqual(out.persisted, false);
  assert.ok((out.detail ?? "").includes("no longer links onto the chain"), out.detail ?? "");
});

check("SC-F5 · a memory-only journal reports integrity WITHOUT provenance, never silently", () => {
  const j = new SubjectEventJournal();
  const out = j.appendBoundary(null, "fixture", tick());
  assert.strictEqual(out.persisted, false, "there is no disk to persist to");
  assert.strictEqual(out.committed, true, "and integrity still holds in memory");
  assert.ok((out.detail ?? "").includes("does not survive the process"), out.detail ?? "");
});

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── THE READER IS SELECTED, NOT SNIFFED — wire() and the census ──");
// ════════════════════════════════════════════════════════════════════════════

check("SC-W1 · wire(logKind:'subject-chain') builds THIS reader and prints its sentence", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { wire, renderCensus } = require("./wire") as typeof WireModule;
  const wiring = wire({
    logPath: goodPath,
    logKind: "subject-chain",
    readableLoadStates: [LOADED_SUBJECT_CHAIN_VERIFIED],
    eng: { structureThreshold: 0.9, minimumSampleSize: 2 },
    sig: { clockToleranceMs: 60_000 },
    line: { classes: ["read", "write", "state_changing", "irreversible"], holdAtOrAbove: "irreversible" },
    stakesClass: "read",
    actionId: "sc-w1",
  } as never);
  assert.ok(wiring.logFile instanceof SubjectChainLog, "wire() built the wrong adapter");
  const text = renderCensus(wiring.census);
  assert.ok(text.includes("SUBJECT CHAIN READER"), text.slice(0, 400));
  assert.ok(text.includes("TAMPER-EVIDENT, NOT INDEPENDENT"), "the true sentence printed");
  assert.ok(!text.includes("JSONL file carries no hash chain"), "the generic disclaimer printed");
  assert.ok(text.includes(SUBJECT_LOG_BOUNDARY_EVENT_TYPE), "the boundary record is disclosed");
});

check("SC-W2 · wire() DEFAULTS to the generic reader — no existing invocation moves", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { wire } = require("./wire") as typeof WireModule;
  const wiring = wire({
    logPath: unchainedPath,
    readableLoadStates: [LOADED_UNVERIFIED_FILE],
    eng: { structureThreshold: 0.9, minimumSampleSize: 2 },
    sig: { clockToleranceMs: 60_000 },
    line: { classes: ["read", "write", "state_changing", "irreversible"], holdAtOrAbove: "irreversible" },
    stakesClass: "read",
    actionId: "sc-w2",
  } as never);
  assert.ok(wiring.logFile instanceof MicaLogFile, "the default is still the generic reader");
});

// ══ SHAPE (b) · THE WITNESS WORD, AND WHO MAY SPEAK IT ══════════════════════
//
// The arbiter's ruling 2026-09-29, after Codex FAILED the cursor design: the bridge
// records its first successful clerk-stamps load in its OWN hash-chained book,
// and an empty stamps source with that record present is an ERASURE.
//
// ⛔ THE RECORD IS A HOLD SWITCH. Once it exists, every later empty or absent
// stamps source REFUSES. So the question "who may write it" is not hygiene: a
// writer able to mint it can blind F3 by writing one line, and a writer able to
// mint it AND empty the stamps file can do so while presenting as the victim.

check("(b) · the witness word is one of the store's OWN eventTypes, not a subject's", () => {
  assert.ok(
    SUBJECT_CHAIN_OWN_EVENT_TYPES.includes(CLERK_STAMPS_FIRST_LOAD_EVENT_TYPE),
    "a word the store mints must be listed, so a declaration author can check mechanically " +
      "that it never appears in preconditionMap or reentryMap"
  );
});

check("(b) · the witness word IS accepted when it speaks in the chain's own voice", () => {
  const rec = validateSubjectRecord({
    recordType: "SUBJECT_EVENT",
    sequenceNumber: 3,
    previousHash: "a".repeat(64),
    timestamp: 1000,
    moduleId: SUBJECT_LOG_BOUNDARY_MODULE_ID,
    eventType: CLERK_STAMPS_FIRST_LOAD_EVENT_TYPE,
    outcome: "STAMPS_OBSERVED",
    chainIdentity: "b".repeat(64),
    stampCount: 678,
    hash: "c".repeat(64),
  });
  assert.ok(rec !== null, "the bridge must be able to write its own witness");
});

check("(b) · THE FORGERY: the witness word from ANY OTHER moduleId is REFUSED", () => {
  // The positive control above is what makes this one mean something: the ONLY
  // difference between the two records is the moduleId.
  for (const impostor of ["housekeeper", "agent/alpha", "MICA/SubjectLo", "mica/subjectlog", ""]) {
    const rec = validateSubjectRecord({
      recordType: "SUBJECT_EVENT",
      sequenceNumber: 3,
      previousHash: "a".repeat(64),
      timestamp: 1000,
      moduleId: impostor,
      eventType: CLERK_STAMPS_FIRST_LOAD_EVENT_TYPE,
      outcome: "STAMPS_OBSERVED",
      chainIdentity: "b".repeat(64),
      stampCount: 678,
      hash: "c".repeat(64),
    });
    assert.strictEqual(rec, null, `moduleId ${JSON.stringify(impostor)} must not be able to mint the witness`);
  }
});

check("(b) · the refusal is at the VALIDATOR, so it does not depend on a route allow-list", () => {
  // ⛔ `authorizeSubjectEventKind` in the bridge also refuses this word, because
  // it is not in SUBJECT_EVENT_KINDS. THAT CHECK IS NOT THE ONE THIS TEST IS
  // ABOUT. A route list is a list somebody can add to; this check holds for any
  // writer of these bytes, including a second one that does not exist yet, and
  // it holds on READ — so a forged record already on disk is refused when the
  // chain is loaded, not merely refused at the door it came through.
  //
  // Asserted by validating bytes DIRECTLY, with no service and no route.
  const forged = {
    recordType: "SUBJECT_EVENT",
    sequenceNumber: 1,
    previousHash: "a".repeat(64),
    timestamp: 1,
    moduleId: "housekeeper",
    eventType: CLERK_STAMPS_FIRST_LOAD_EVENT_TYPE,
    outcome: "STAMPS_OBSERVED",
    hash: "c".repeat(64),
  };
  assert.strictEqual(validateSubjectRecord(forged), null);
  // And the same record with an ordinary eventType IS valid — so the refusal is
  // about the WORD and not about anything else in the shape.
  assert.ok(validateSubjectRecord({ ...forged, eventType: "TOOL_EXECUTED" }) !== null);
});

check("(b) · a chain carrying a REAL witness loads, and the witness is findable by its word", () => {
  // The read the bridge performs, at bytes, over a chain this test built.
  const dir = mkdtempSync(join(tmpdir(), "mica-witness-"));
  const path = join(dir, "subject-events.jsonl");
  try {
    const j = new SubjectEventJournal({ path });
    const b = j.appendBoundary(null, "first boot", 1000);
    assert.ok(b.persisted, b.detail ?? "boundary not written");
    const before = new SubjectChainLog({ path });
    assert.strictEqual(before.getLoadState(), LOADED_SUBJECT_CHAIN_VERIFIED);
    const genesis = before.getBoundary()!.hash;
    assert.ok(
      !before.getAll().some((r) => r.eventType === CLERK_STAMPS_FIRST_LOAD_EVENT_TYPE),
      "a fresh chain must have no witness — that is the FIRST RUN state"
    );

    const w = j.appendEvent((seq, previous) => ({
      recordType: "SUBJECT_EVENT",
      sequenceNumber: seq,
      previousHash: typeof previous?.hash === "string" ? previous.hash : "",
      timestamp: 2000,
      moduleId: SUBJECT_LOG_BOUNDARY_MODULE_ID,
      eventType: CLERK_STAMPS_FIRST_LOAD_EVENT_TYPE,
      outcome: "STAMPS_OBSERVED",
      chainIdentity: genesis,
      stampCount: 678,
    }));
    assert.ok(w.persisted, w.detail ?? "witness not written");

    const after = new SubjectChainLog({ path });
    assert.strictEqual(
      after.getLoadState(),
      LOADED_SUBJECT_CHAIN_VERIFIED,
      "the witness must not break the chain it rides in"
    );
    assert.ok(
      after
        .getAll()
        .some(
          (r) =>
            r.eventType === CLERK_STAMPS_FIRST_LOAD_EVENT_TYPE &&
            r.moduleId === SUBJECT_LOG_BOUNDARY_MODULE_ID
        ),
      "the witness must be findable by the word and the voice together"
    );
    // ⛔ AND THE CODEX PROPERTY: the witness is BOUND TO THIS CHAIN by living in
    // it. The genesis it carries names the boundary above it, so a copy of this
    // line pasted into another chain names a boundary that chain does not have.
    assert.strictEqual(genesis, after.getBoundary()!.hash);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

rmSync(root, { recursive: true, force: true });
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
