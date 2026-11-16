// seeingd — the witness's seeing half as a process (phase R = sight-since-last-look): one look per pointed act,
// a facet against the witness's own last look at that target, nothing anchored, nothing attributed.
//   ts-node src/witness/seeingd.test.ts
import assert from "assert";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { tmpdir } from "os";
import { join } from "path";

import { SubjectChainLog, SubjectEventJournal, LOADED_SUBJECT_CHAIN_VERIFIED } from "../glue/subject-event-journal";
import { classifyFacet, consequenceEventType, SEEING_METHOD_DIGEST, type SeeingClock } from "./seeing";
import { parseArgs, SeeingWitness, EFFECTS_CHAIN_ID, EFFECTS_BOOK_BOUNDARY_BASIS } from "./seeingd";
import { parsePointer } from "./seeing-intake";
import type { NamedHeadCommit } from "./types";

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

const root = mkdtempSync(join(tmpdir(), "mica-seeingd-"));
let n = 0;
const DC = "INTEREST_LABEL@2b7df2aba755e90c";
const SUBJECT = "fixture-subject";
const CHAIN = "c".repeat(64);
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

interface Rig {
  dir: string;
  intake: string;
  state: string;
  book: string;
  wall: number;
  mono: number;
  boot: string;
  seq: number;
  clock: SeeingClock;
  heads: NamedHeadCommit[];
  logs: string[];
  make: (extra?: { committer?: (c: NamedHeadCommit) => void; closeTimeoutMs?: number; pendingCap?: number; stateByteCap?: number }) => SeeingWitness;
}

function rig(): Rig {
  const dir = join(root, `r${++n}`);
  const r = { dir, intake: join(dir, "intake"), state: join(dir, "state"), book: join(dir, "book", "effects.jsonl"), wall: 1000, mono: 1000, boot: "boot-A", seq: 0, heads: [], logs: [] } as unknown as Rig;
  r.clock = { wall: () => r.wall, mono: () => BigInt(++r.mono), get boot() { return r.boot; } };
  r.make = (extra = {}) =>
    new SeeingWitness({
      intakeDir: r.intake,
      bookPath: r.book,
      stateDir: r.state,
      committer: extra.committer ?? ((c) => r.heads.push(c)),
      witnessSetId: "fixture-set",
      closeTimeoutMs: extra.closeTimeoutMs ?? 60000,
      ...(extra.pendingCap === undefined ? {} : { pendingCap: extra.pendingCap }),
      ...(extra.stateByteCap === undefined ? {} : { stateByteCap: extra.stateByteCap }),
      clock: r.clock,
      log: (l) => r.logs.push(l),
    });
  mkdirSync(r.intake, { recursive: true });
  mkdirSync(r.state, { recursive: true });
  mkdirSync(join(dir, "book"), { recursive: true });
  return r;
}

/** A drop, named by a per-rig counter so an ATTEMPT sorts before its CLOSE. */
function drop(r: Rig, o: Record<string, unknown>): string {
  const name = `${String(++r.seq).padStart(18, "0")}-${String(o.kind)}`;
  writeFileSync(join(r.intake, name), JSON.stringify(o));
  return name;
}
interface Act { sessionId?: string; actionId?: string; subjectSeq?: number; target: string; label?: string; chain?: string | null }
function attempt(r: Rig, a: Act): string {
  return drop(r, {
    v: 1, kind: "ATTEMPT", subject: SUBJECT, sessionId: a.sessionId ?? "s-1", actionId: a.actionId ?? "act-1", chain: a.chain === undefined ? CHAIN : a.chain, subjectSeq: a.subjectSeq ?? 7,
    target: a.target, label: a.label ?? "x2", derivationClass: DC, targetFingerprint: "f".repeat(64), at: r.wall,
  });
}
/** The /guard decision the bridge carries on the CLOSE. */
function decision(execute = true): Record<string, unknown> {
  return { execute, decisionHash: "d".repeat(64) };
}
function close(r: Rig, a: { sessionId?: string; actionId?: string; attemptSeq?: number; chain?: string | null; guard: Record<string, unknown> | null; unguarded?: boolean; extra?: Record<string, unknown> }): string {
  return drop(r, {
    v: 1, kind: "CLOSE", subject: SUBJECT, sessionId: a.sessionId ?? "s-1", actionId: a.actionId ?? "act-1", chain: a.chain === undefined ? CHAIN : a.chain, attemptSeq: a.attemptSeq ?? 7, closedSeq: 9,
    guard: a.guard, unguarded: a.unguarded ?? false, at: r.wall, ...(a.extra ?? {}),
  });
}
function events(r: Rig): Record<string, any>[] {
  return readFileSync(r.book, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((x) => x.recordType === "SUBJECT_EVENT");
}
function file(r: Rig, name: string, content = "content"): string {
  const p = join(r.dir, name);
  writeFileSync(p, content);
  return p;
}
/** One whole act on a target: ATTEMPT, (effect), CLOSE — the witness looks once, at the close. */
function act(r: Rig, o: { target: string; seq?: number; actionId?: string; effect?: () => void; execute?: boolean; unguarded?: boolean; noClose?: boolean }): void {
  const seq = o.seq ?? 7;
  const actionId = o.actionId ?? `act-${String(seq)}`;
  const w = r._w as SeeingWitness; // set by the test
  attempt(r, { target: o.target, subjectSeq: seq, actionId });
  w.sweep();
  o.effect?.();
  if (o.noClose) return;
  const guard = o.unguarded ? null : decision(o.execute ?? true);
  close(r, { attemptSeq: seq, actionId, guard, unguarded: o.unguarded ?? false });
  w.sweep();
}
interface Rig { _w?: SeeingWitness }

check("SD-1 · first boot writes the boundary; it names the method and carries the ceilings; the book loads VERIFIED through Gate 2's reader", () => {
  const r = rig();
  r.make();
  const log = new SubjectChainLog({ path: r.book });
  assert.strictEqual(log.getLoadState(), LOADED_SUBJECT_CHAIN_VERIFIED);
  assert.strictEqual(log.getAll().length, 1);
  assert.ok(EFFECTS_BOOK_BOUNDARY_BASIS.includes(SEEING_METHOD_DIGEST));
  for (const w of ["SINCE THE WITNESS LAST LOOKED", "CLAIMED TARGET", "TAMPER-EVIDENT"]) assert.ok(EFFECTS_BOOK_BOUNDARY_BASIS.includes(w), w);
  assert.ok(readFileSync(r.book, "utf8").includes("TAMPER-EVIDENT"), "the ceilings are IN the book");
});

check("SD-2 · a target the witness never saw before reads <c>:FIRST_SEEN, citing act and decision, no plain target in the book", () => {
  const r = rig();
  const target = file(r, "victim-file-name");
  r._w = r.make();
  act(r, { target, seq: 7, actionId: "act-1", effect: () => unlinkSync(target) });
  const [e] = events(r);
  assert.strictEqual(e.eventType, consequenceEventType(DC));
  assert.strictEqual(e.outcome, "x2:FIRST_SEEN", "no last look to compare, whatever the act did");
  assert.strictEqual(e.moduleId, SUBJECT);
  assert.strictEqual(e.actionId, "act-1");
  const wv = e.witnessed;
  assert.strictEqual(wv.method, SEEING_METHOD_DIGEST);
  assert.strictEqual(wv.fate, "RAN");
  assert.strictEqual(wv.observed, "FIRST_SEEN");
  assert.strictEqual(wv.priorLookAt, null);
  assert.deepStrictEqual(wv.cites, { chain: CHAIN, subjectSeq: 7, sessionId: "s-1", targetFingerprint: "f".repeat(64), closedSeq: 9, decisionHash: "d".repeat(64) });
  assert.ok(!readFileSync(r.book, "utf8").includes("victim-file-name"), "the plain target is the witness's only");
  assert.strictEqual(readdirSync(r.intake).length, 0, "both drops consumed");
});

check("SD-3 · SINCE THE WITNESS LAST LOOKED: a second act on the same target reads the facet against the FIRST act's look", () => {
  const r = rig();
  const target = file(r, "t", "one");
  r._w = r.make();
  act(r, { target, seq: 1, actionId: "a1" }); // FIRST_SEEN; the witness now holds this look
  act(r, { target, seq: 2, actionId: "a2", effect: () => writeFileSync(target, "two, longer") });
  const es = events(r);
  assert.strictEqual(es[0].outcome, "x2:FIRST_SEEN");
  assert.strictEqual(es[1].outcome, "x2:CONTENT_DIFFERS");
  assert.strictEqual(es[1].witnessed.priorLookAt, es[0].witnessed.clockAt, "it compared to act 1's close look");
});

check("SD-4 · SAME when nothing changed since the last look; EXISTENCE_DIFFERS when the target vanished since", () => {
  const r = rig();
  const target = file(r, "t", "stable");
  r._w = r.make();
  act(r, { target, seq: 1, actionId: "a1" });
  act(r, { target, seq: 2, actionId: "a2" }); // untouched since act 1
  act(r, { target, seq: 3, actionId: "a3", effect: () => unlinkSync(target) });
  const es = events(r);
  assert.strictEqual(es[1].outcome, "x2:SAME");
  assert.strictEqual(es[2].outcome, "x2:EXISTENCE_DIFFERS");
});

check("SD-5 · a HELD act (the bridge's execute:false) reads <c>:HELD whatever the look shows; the facet rides beside it", () => {
  const r = rig();
  const t1 = file(r, "held-1");
  const t2 = file(r, "held-2");
  r._w = r.make();
  // prime a last look on t2, then a held act whose target moved since
  act(r, { target: t2, seq: 1, actionId: "p" });
  act(r, { target: t1, seq: 2, actionId: "h1", execute: false }); // FIRST_SEEN but HELD
  act(r, { target: t2, seq: 3, actionId: "h2", execute: false, effect: () => writeFileSync(t2, "moved while held") });
  const es = events(r);
  const h1 = es.find((e) => e.actionId === "h1")!;
  const h2 = es.find((e) => e.actionId === "h2")!;
  assert.strictEqual(h1.outcome, "x2:HELD");
  assert.strictEqual(h1.witnessed.fate, "HELD");
  assert.strictEqual(h1.witnessed.observed, "FIRST_SEEN");
  assert.strictEqual(h2.outcome, "x2:HELD", "a held act NEVER reads as change in the outcome");
  assert.strictEqual(h2.witnessed.observed, "CONTENT_DIFFERS", "but the look's facet rides beside it, attributed to nothing");
});

check("SD-6 · a fail-open act (ran with no /guard answer) reads <c>:LATE", () => {
  const r = rig();
  const target = file(r, "t");
  r._w = r.make();
  act(r, { target, seq: 1, actionId: "a1", unguarded: true, effect: () => unlinkSync(target) });
  const [e] = events(r);
  assert.strictEqual(e.outcome, "x2:LATE");
  assert.strictEqual(e.witnessed.fate, "LATE_UNGUARDED");
  assert.strictEqual(e.witnessed.cites.decisionHash, null);
});

check("SD-7 · a CLOSE with no decision the witness can read reads <c>:LATE (fate LATE_NO_DECISION)", () => {
  const r = rig();
  const target = file(r, "t");
  const w = r.make();
  attempt(r, { target, subjectSeq: 1, actionId: "a1" });
  w.sweep();
  close(r, { attemptSeq: 1, actionId: "a1", guard: null });
  w.sweep();
  const [e] = events(r);
  assert.strictEqual(e.outcome, "x2:LATE");
  assert.strictEqual(e.witnessed.fate, "LATE_NO_DECISION");
});

check("SD-8 · no CLOSE within the timeout: the witness looks anyway and writes <c>:LATE (fate LATE_TIMEOUT), on the monotonic clock", () => {
  const r = rig();
  const w = r.make({ closeTimeoutMs: 100 });
  attempt(r, { target: file(r, "a"), subjectSeq: 1, actionId: "a" });
  attempt(r, { target: file(r, "b"), subjectSeq: 2, actionId: "b" });
  w.sweep();
  r.mono += 50_000_000;
  assert.strictEqual(w.sweep().timedOut, 0, "not yet");
  r.mono += 100_000_000;
  const rep = w.sweep();
  assert.strictEqual(rep.timedOut, 2);
  for (const e of events(r)) {
    assert.strictEqual(e.outcome, "x2:LATE");
    assert.strictEqual(e.witnessed.fate, "LATE_TIMEOUT");
    assert.strictEqual(e.witnessed.cites.closedSeq, null);
  }
});

check("SD-9 · the close timeout runs on the MONOTONIC clock: a wall step closes nothing; a reboot ends the wait at once", () => {
  const r = rig();
  const w = r.make({ closeTimeoutMs: 100 });
  attempt(r, { target: file(r, "t") });
  w.sweep();
  r.wall += 10_000_000;
  assert.strictEqual(w.sweep().timedOut, 0, "a wall jump is not time passing");
  r.boot = "boot-NEXT";
  assert.strictEqual(r.make({ closeTimeoutMs: 100 }).sweep().timedOut, 1, "a reboot ends the wait");
});

check("SD-10 · two acts sharing sessionId AND actionId are two acts, keyed by the bridge-minted seq", () => {
  const r = rig();
  const t1 = file(r, "one");
  const t2 = file(r, "two");
  r._w = r.make();
  act(r, { target: t1, seq: 11, actionId: "same", effect: () => unlinkSync(t1) });
  act(r, { target: t2, seq: 12, actionId: "same" });
  const es = events(r);
  assert.strictEqual(es.length, 2);
  assert.deepStrictEqual(es.map((e) => [e.witnessed.cites.subjectSeq, e.outcome]).sort(), [[11, "x2:FIRST_SEEN"], [12, "x2:FIRST_SEEN"]]);
});

check("SD-11 · a ROTATED subject chain numbers from 1 again: the chain is part of the key, so the same seq is two acts", () => {
  const r = rig();
  const old = "a".repeat(64);
  const fresh = "b".repeat(64);
  const w = r.make();
  attempt(r, { target: file(r, "t1"), subjectSeq: 1, chain: old, actionId: "old-1" });
  w.sweep();
  close(r, { attemptSeq: 1, chain: old, actionId: "old-1", guard: null });
  w.sweep();
  attempt(r, { target: file(r, "t2"), subjectSeq: 1, chain: fresh, actionId: "new-1" });
  w.sweep();
  close(r, { attemptSeq: 1, chain: fresh, actionId: "new-1", guard: null });
  w.sweep();
  assert.deepStrictEqual(events(r).map((e) => [e.witnessed.cites.chain, e.witnessed.cites.subjectSeq]), [[old, 1], [fresh, 1]]);
});

check("SD-12 · a SECOND ATTEMPT for the same act with another target is QUARANTINED; the same ATTEMPT again is a replay", () => {
  const r = rig();
  const w = r.make();
  attempt(r, { target: file(r, "first") });
  w.sweep();
  attempt(r, { target: file(r, "first") });
  attempt(r, { target: file(r, "second") });
  const rep = w.sweep();
  assert.strictEqual(rep.replays, 1);
  assert.strictEqual(rep.quarantined, 1);
  assert.ok(readdirSync(join(r.state, "quarantine")).some((q) => q.includes("SECOND_ATTEMPT_FOR_ACT")));
});

check("SD-13 · a recorded key that returns under ANOTHER identity is quarantined loudly, never taken as a replay", () => {
  const r = rig();
  r._w = r.make();
  act(r, { target: file(r, "t"), seq: 4, actionId: "first" });
  attempt(r, { target: file(r, "u"), subjectSeq: 4, actionId: "someone-else" });
  const rep = (r._w as SeeingWitness).sweep();
  assert.strictEqual(rep.quarantined, 1);
  assert.ok(readdirSync(join(r.state, "quarantine")).some((q) => q.includes("RECORDED_KEY_IDENTITY_MISMATCH")));
  assert.ok(r.logs.some((l) => l.includes("another identity")));
});

check("SD-14 · a CLOSE whose identity differs from its ATTEMPT's is QUARANTINED; the act stays pending", () => {
  const r = rig();
  const w = r.make();
  attempt(r, { target: file(r, "t") });
  w.sweep();
  close(r, { sessionId: "s-OTHER", guard: decision() });
  const rep = w.sweep();
  assert.strictEqual(rep.quarantined, 1);
  assert.strictEqual(rep.written, 0);
  assert.strictEqual(events(r).length, 0);
});

check("SD-15 · a malformed drop is QUARANTINED, never in the book; the reason names no target; a CLOSE with one extra key is one", () => {
  const r = rig();
  const w = r.make();
  writeFileSync(join(r.intake, "00-bad"), "{not json /secret/target/name");
  attempt(r, { target: file(r, "t") });
  w.sweep();
  close(r, { guard: null, extra: { note: "x" } });
  w.sweep();
  const q = readdirSync(join(r.state, "quarantine"));
  assert.strictEqual(q.length, 2);
  assert.ok(q.some((x) => x.includes("NOT_JSON")) && q.some((x) => x.includes("CLOSE_KEYS")));
  assert.ok(!r.logs.join("\n").includes("secret"));
  assert.strictEqual(events(r).length, 0);
});

check("SD-16 · a crash between the book append and the state persist writes NO second record on replay", () => {
  const r = rig();
  const target = file(r, "t");
  const w = r.make();
  attempt(r, { target });
  w.sweep();
  const stateBefore = readFileSync(join(r.state, "state.json"));
  const name = close(r, { guard: decision() });
  const closeBytes = readFileSync(join(r.intake, name));
  assert.strictEqual(w.sweep().written, 1);
  writeFileSync(join(r.state, "state.json"), stateBefore);
  writeFileSync(join(r.intake, name), closeBytes);
  const rep = r.make().sweep();
  assert.strictEqual(rep.written, 0);
  assert.strictEqual(rep.replays, 1);
  assert.strictEqual(events(r).length, 1);
});

check("SD-17 · a LOST state never loses a pending act: its ATTEMPT drop stays until the act is written", () => {
  if (isRoot) return console.log("    (root — skipped)");
  const r = rig();
  const target = file(r, "t");
  r.make();
  attempt(r, { target });
  r.make().sweep();
  assert.strictEqual(readdirSync(r.intake).length, 1, "the ATTEMPT is kept while its act is open");
  writeFileSync(join(r.state, "state.json"), "{torn", { mode: 0o600 });
  const w = r.make();
  w.sweep();
  close(r, { guard: null });
  assert.strictEqual(w.sweep().written, 1);
  assert.strictEqual(events(r).length, 1);
  assert.strictEqual(readdirSync(r.intake).length, 0, "both drops go with the record");
});

check("SD-18 · an UNREADABLE state is set aside (0600 kept); the witness starts with no last looks and says so", () => {
  const r = rig();
  r.make();
  writeFileSync(join(r.state, "state.json"), "{torn", { mode: 0o600 });
  r.make();
  const aside = readdirSync(r.state).filter((f) => f.startsWith("state.json.unreadable-"));
  assert.strictEqual(aside.length, 1);
  assert.strictEqual(statSync(join(r.state, aside[0])).mode & 0o777, 0o600);
  assert.ok(r.logs.some((l) => l.includes("no last looks")));
});

check("SD-19 · a CLOSE with no ATTEMPT here is discarded and counted, never written; one whose ATTEMPT was unreadable this sweep is kept", () => {
  const r = rig();
  const w = r.make();
  close(r, { guard: decision() });
  const rep = w.sweep();
  assert.strictEqual(rep.orphanCloses, 1);
  assert.strictEqual(events(r).length, 0);
  assert.strictEqual(readdirSync(r.intake).length, 0);
  if (isRoot) return;
  const r2 = rig();
  const w2 = r2.make();
  const a = attempt(r2, { target: file(r2, "t") });
  chmodSync(join(r2.intake, a), 0o000);
  close(r2, { guard: null });
  assert.strictEqual(w2.sweep().orphanCloses, 0, "its ATTEMPT could not be read: the CLOSE is kept, not orphaned");
  chmodSync(join(r2.intake, a), 0o600);
  w2.sweep();
  assert.strictEqual(events(r2).length, 1);
});

check("SD-20 · a dot-named file is in flight and is not read", () => {
  const r = rig();
  const w = r.make();
  writeFileSync(join(r.intake, ".in-flight"), "{");
  const rep = w.sweep();
  assert.strictEqual(rep.quarantined + rep.attempts + rep.closes, 0);
  assert.ok(existsSync(join(r.intake, ".in-flight")));
});

check("SD-21 · a drop that is not a regular file (a symlink, a directory) is QUARANTINED unread", () => {
  const r = rig();
  const w = r.make();
  const real = file(r, "pointed-at", JSON.stringify({ v: 1 }));
  symlinkSync(real, join(r.intake, "01-link"));
  mkdirSync(join(r.intake, "02-dir"));
  assert.strictEqual(w.sweep().quarantined, 2);
});

check("SD-22 · every written record submits a named head (chain witness-effects, NOT_AN_INSTRUCTION); a committer that throws is not fatal", () => {
  const r = rig();
  r._w = r.make();
  act(r, { target: file(r, "t") });
  assert.strictEqual(r.heads.length, 1);
  assert.strictEqual(r.heads[0].chain_id, EFFECTS_CHAIN_ID);
  assert.strictEqual(r.heads[0].modality, "NOT_AN_INSTRUCTION");
  assert.strictEqual(r.heads[0].witness_set_id, "fixture-set");
  const r2 = rig();
  const w2 = r2.make({ committer: () => { throw new Error("intake gone"); } });
  attempt(r2, { target: file(r2, "t") });
  w2.sweep();
  close(r2, { guard: null });
  assert.strictEqual(w2.sweep().written, 1);
  assert.ok(r2.logs.some((l) => l.includes("not fatal")));
});

check("SD-23 · the private state holds the plain target and the key at 0600; the book holds neither, and no raw metadata", () => {
  const r = rig();
  r._w = r.make();
  const target = file(r, "a-distinctive-name");
  act(r, { target });
  const st = join(r.state, "state.json");
  assert.strictEqual(statSync(st).mode & 0o777, 0o600);
  assert.ok(readFileSync(st, "utf8").includes("a-distinctive-name"));
  const key = join(r.state, "digest.key");
  assert.strictEqual(statSync(key).mode & 0o777, 0o600);
  assert.strictEqual(readFileSync(key).length, 32);
  const book = readFileSync(r.book);
  assert.ok(!book.includes("a-distinctive-name"));
  assert.ok(!book.includes(readFileSync(key).toString("hex")));
  const look = events(r)[0].witnessed.look;
  for (const k of ["mode", "uid", "gid", "mtimeMs", "ctimeMs"]) assert.ok(!(k in look), `${k} reached the book`);
  for (const k of ["meta", "times", "size"]) assert.match(String(look[k]), /^[0-9a-f]{64}$/, k);
});

check("SD-24 · the witness's own directories are never looked into: an act claiming its state reads UNOBSERVABLE (SELF)", () => {
  const r = rig();
  r._w = r.make();
  act(r, { target: join(r.state, "state.json") });
  const e = events(r)[0];
  assert.strictEqual(e.witnessed.look.error, "SELF");
  // W-1 (audit 2026-10-11 18:43Z): the look FAILED (SELF), so even the first act reads UNOBSERVABLE — never FIRST_SEEN
  assert.strictEqual(e.outcome, "x2:UNOBSERVABLE", "a failed first look is UNOBSERVABLE, not FIRST_SEEN");
  // a second act on the same SELF path: UNOBSERVABLE again
  act(r, { target: join(r.state, "state.json"), seq: 8, actionId: "a8" });
  assert.strictEqual(events(r)[1].outcome, "x2:UNOBSERVABLE");
});

check("SD-25 · book timestamps never go backward when the wall clock steps back; the book verifies", () => {
  const r = rig();
  r._w = r.make();
  r.wall = 5000;
  act(r, { target: file(r, "a"), seq: 1, actionId: "a" });
  r.wall = 2000;
  act(r, { target: file(r, "b"), seq: 2, actionId: "b" });
  const [x, y] = events(r);
  assert.ok(y.timestamp >= x.timestamp);
  assert.strictEqual(y.witnessed.clockAt, 2000);
  assert.strictEqual(new SubjectChainLog({ path: r.book }).getLoadState(), LOADED_SUBJECT_CHAIN_VERIFIED);
});

check("SD-26 · a book append that does not land STOPS the sweep with the CLOSE drop and the act kept", () => {
  if (isRoot) return console.log("    (root — skipped)");
  const r = rig();
  const w = r.make();
  attempt(r, { target: file(r, "t") });
  w.sweep();
  close(r, { guard: decision() });
  chmodSync(r.book, 0o444);
  try {
    const rep = w.sweep();
    assert.notStrictEqual(rep.appendFailure, null);
    assert.strictEqual(rep.written, 0);
    assert.strictEqual(readdirSync(r.intake).length, 2, "the CLOSE and its ATTEMPT stay");
  } finally {
    chmodSync(r.book, 0o644);
  }
  assert.strictEqual(r.make().sweep().written, 1, "a restarted witness writes it then");
});

check("SD-27 · PENDING IS BOUNDED: past the cap the OLDEST waiting acts are closed at once as LATE_PENDING_CAP, each its own record", () => {
  const r = rig();
  const w = r.make({ pendingCap: 3 });
  for (let i = 1; i <= 5; i++) {
    attempt(r, { target: file(r, `p${i}`), subjectSeq: i, actionId: `p${i}` });
    w.sweep();
  }
  const es = events(r);
  assert.strictEqual(es.length, 2);
  assert.deepStrictEqual(es.map((e) => [e.witnessed.cites.subjectSeq, e.witnessed.fate, e.outcome]), [[1, "LATE_PENDING_CAP", "x2:LATE"], [2, "LATE_PENDING_CAP", "x2:LATE"]]);
  assert.strictEqual(Object.keys(JSON.parse(readFileSync(join(r.state, "state.json"), "utf8")).pending).length, 3);
});

check("SD-28 · the state's byte cap evicts the LEAST RECENTLY looked target in one pass; never over the cap", () => {
  const r = rig();
  const w = r.make({ stateByteCap: 6000 });
  for (let i = 1; i <= 40; i++) {
    attempt(r, { target: file(r, `t-${"x".repeat(60)}-${i}`), subjectSeq: i, actionId: `a${i}` });
    w.sweep();
    close(r, { attemptSeq: i, actionId: `a${i}`, guard: null });
    w.sweep();
  }
  const bytes = readFileSync(join(r.state, "state.json"));
  assert.ok(bytes.length <= 6000, `state ${bytes.length} bytes`);
  const stt = JSON.parse(bytes.toString("utf8"));
  assert.ok(stt.order.length > 0 && stt.order.length < 40, `kept ${stt.order.length} targets`);
  assert.ok(stt.order[stt.order.length - 1].endsWith("-40"), "the most recent target is kept");
  assert.ok(!r.logs.some((l) => l.includes("over its cap")));
  assert.strictEqual(events(r).length, 40);
});

check("SD-29 · a digest key any other uid could read is REFUSED at start", () => {
  const r = rig();
  r.make();
  chmodSync(join(r.state, "digest.key"), 0o640);
  assert.throws(() => r.make(), /not 0600/);
});

check("SD-30 · the intake contract: exact keys, absolute target, fixed reasons, NO anchor fields", () => {
  const ok = { v: 1, kind: "ATTEMPT", subject: "s", sessionId: "x", actionId: "a", chain: null, subjectSeq: 1, target: "/t", label: "x2", derivationClass: DC, targetFingerprint: null, at: 1 };
  assert.ok(parsePointer(JSON.stringify(ok)).ok);
  assert.deepStrictEqual(parsePointer(JSON.stringify({ ...ok, target: "rel" })), { ok: false, reason: "TARGET" });
  assert.deepStrictEqual(parsePointer(JSON.stringify({ ...ok, extra: 1 })), { ok: false, reason: "ATTEMPT_KEYS" });
  assert.deepStrictEqual(parsePointer(JSON.stringify({ ...ok, mono: "5" })), { ok: false, reason: "ATTEMPT_KEYS" }, "a leftover anchor stamp is a rejected shape");
  assert.deepStrictEqual(parsePointer(JSON.stringify({ ...ok, chain: "not-a-hash" })), { ok: false, reason: "CHAIN" });
  const c = { v: 1, kind: "CLOSE", subject: "s", sessionId: "x", actionId: "a", chain: CHAIN, attemptSeq: 1, closedSeq: 2, guard: null, unguarded: false, at: 1 };
  assert.ok(parsePointer(JSON.stringify(c)).ok);
  assert.ok(parsePointer(JSON.stringify({ ...c, guard: { execute: true, decisionHash: "d".repeat(64) } })).ok);
  assert.deepStrictEqual(parsePointer(JSON.stringify({ ...c, guard: { execute: true, decisionHash: "d".repeat(64), mono: "5" } })), { ok: false, reason: "GUARD_KEYS" }, "a leftover anchor stamp in the guard is refused");
  assert.deepStrictEqual(parsePointer(JSON.stringify({ ...c, unguarded: "no" })), { ok: false, reason: "UNGUARDED" });
});

check("SD-31 · arguments: the witness wiring is declared or explicitly refused; the repository's placeholder is refused", () => {
  assert.match(String(parseArgs(["--intake", "/i", "--book", "/b"])), /required/);
  assert.match(String(parseArgs(["--intake", "/i", "--book", "/b", "--state", "/s"])), /--witness-intake/);
  const ok = parseArgs(["--intake", "/i", "--book", "/b", "--state", "/s", "--no-witness"]);
  assert.strictEqual(typeof ok, "object");
  assert.match(String(parseArgs(["--intake", "/i", "--book", "/b", "--state", "/s", "--witness-intake", "/w", "--submitter-id", "x", "--witness-set-id", "REPLACE-WITH-THE-DEPLOYMENT-DECLARATION"])), /placeholder/);
  assert.match(String(parseArgs(["--bogus"])), /unknown argument/);
});

check("SD-32 · a REPLAY never re-baselines from a RE-LOOK (refuter R4-bytes F1): after a crash the BOOK's record is the last look, so a real change is not masked SAME", () => {
  const r = rig();
  const target = file(r, "t", "v1");
  const w = r.make();
  // act 1 writes its record; simulate the crash by restoring the pre-persist state and re-dropping its CLOSE.
  attempt(r, { target, subjectSeq: 1, actionId: "a1" });
  w.sweep();
  const stateBefore = readFileSync(join(r.state, "state.json"));
  const closeName = close(r, { attemptSeq: 1, actionId: "a1", guard: decision() });
  const closeBytes = readFileSync(join(r.intake, closeName));
  assert.strictEqual(w.sweep().written, 1);
  assert.strictEqual(events(r)[0].outcome, "x2:FIRST_SEEN");
  // the crash: state as before the CLOSE sweep, the CLOSE drop back; and the target CHANGES during downtime.
  writeFileSync(join(r.state, "state.json"), stateBefore);
  writeFileSync(join(r.intake, closeName), closeBytes);
  writeFileSync(target, "v2, changed while the witness was down");
  const w2 = r.make();
  assert.strictEqual(w2.sweep().replays, 1, "the re-dropped CLOSE is a replay, not a second record");
  // act 2 on the same target: its facet must be read against act 1's RECORDED look (v1), not the replay re-look (v2).
  attempt(r, { target, subjectSeq: 2, actionId: "a2" });
  w2.sweep();
  close(r, { attemptSeq: 2, actionId: "a2", guard: decision() });
  w2.sweep();
  const [one, two] = [1, 2].map((q) => events(r).find((e) => e.witnessed.cites.subjectSeq === q)!);
  // The BOOK holds act 1's look (v1): on start it is the baseline again (audit 2026-10-11 12:51Z ①), so act 2 reads
  // the v1->v2 change. With the F1 bug (replay adopts the v2 re-look as the baseline) it would read a FALSE SAME.
  assert.strictEqual(two.outcome, "x2:CONTENT_DIFFERS", "read against act 1's recorded look, never a false SAME over the v1->v2 change");
  assert.strictEqual(two.witnessed.observed, classifyFacet(one.witnessed.look, two.witnessed.look), "the facet is re-derivable from the book");
  assert.strictEqual(two.witnessed.priorLookAt, one.witnessed.look.at);
});

/**
 * The crash the audit named (2026-10-11 12:51Z ①): act 1 is the baseline; act 2's record LANDS, the persist does not;
 * the target then does `during` while the witness is down; act 3 must be read against act 2's record in the BOOK.
 * `viaIntake`: act 2's ATTEMPT and CLOSE came in one sweep, so the persisted state never held it pending — the
 * record is matched to its target through the ATTEMPT drop still in the intake.
 */
function crashAfterWrittenRecord(during: "revert" | "nothing", viaIntake: boolean): { two: Record<string, any>; three: Record<string, any>; r: Rig } {
  const r = rig();
  const target = file(r, "t", "v1");
  r._w = r.make();
  act(r, { target, seq: 1, actionId: "a1" });
  writeFileSync(target, "v2");
  let stateBefore: Buffer;
  const redrop: [string, Buffer][] = [];
  if (viaIntake) {
    stateBefore = readFileSync(join(r.state, "state.json"));
    const an = attempt(r, { target, subjectSeq: 2, actionId: "a2" });
    const cn = close(r, { attemptSeq: 2, actionId: "a2", guard: decision() });
    for (const nm of [an, cn]) redrop.push([nm, readFileSync(join(r.intake, nm))]);
    assert.strictEqual(r._w.sweep().written, 1);
  } else {
    attempt(r, { target, subjectSeq: 2, actionId: "a2" });
    r._w.sweep();
    stateBefore = readFileSync(join(r.state, "state.json"));
    const cn = close(r, { attemptSeq: 2, actionId: "a2", guard: decision() });
    redrop.push([cn, readFileSync(join(r.intake, cn))]);
    assert.strictEqual(r._w.sweep().written, 1);
  }
  assert.strictEqual(events(r)[1].witnessed.observed, "CONTENT_DIFFERS", "act 2 recorded v1 -> v2");
  // THE CRASH: the record landed, the persist did not — the state is as before, the drops are back.
  writeFileSync(join(r.state, "state.json"), stateBefore);
  for (const [nm, bytes] of redrop) writeFileSync(join(r.intake, nm), bytes);
  if (during === "revert") writeFileSync(target, "v1");
  r._w = r.make();
  assert.ok(r.logs.some((l) => l.includes("1 re-baselined from the book")), "the rebuild is said");
  assert.strictEqual(r._w.sweep().written, 0, "the replay writes nothing");
  act(r, { target, seq: 3, actionId: "a3" });
  const [two, three] = [2, 3].map((q) => events(r).find((e) => e.witnessed.cites.subjectSeq === q)!);
  assert.strictEqual(events(r).length, 3);
  assert.strictEqual(three.witnessed.observed, classifyFacet(two.witnessed.look, three.witnessed.look), "act 3's facet is the book's own: against act 2's record");
  assert.strictEqual(three.witnessed.priorLookAt, two.witnessed.look.at, "the prior look is act 2's recorded look");
  return { two, three, r };
}

check("SD-33a · CRASH AFTER A WRITTEN RECORD WITH A BASELINE (audit 12:51Z ①): the target reverts while down — act 3 reads the change against the BOOK's record, never a false SAME", () => {
  const { three } = crashAfterWrittenRecord("revert", false);
  assert.strictEqual(three.outcome, "x2:CONTENT_DIFFERS", "v2 (act 2's record) -> v1; the stale baseline v1 would hide it");
});

check("SD-33b · CRASH AFTER A WRITTEN RECORD WITH A BASELINE: the target is untouched while down — act 3 reads SAME against the book's record, never a false DIFFERS", () => {
  const { three } = crashAfterWrittenRecord("nothing", false);
  assert.strictEqual(three.outcome, "x2:SAME", "v2 = v2; the stale baseline v1 would read CONTENT_DIFFERS a second time");
});

check("SD-33c · the same crash when act 2 was never pending in the persisted state: the record is matched through its ATTEMPT drop in the intake", () => {
  const { three } = crashAfterWrittenRecord("nothing", true);
  assert.strictEqual(three.outcome, "x2:SAME");
});

check("SD-34 · a state that names a record THIS book does not hold is set aside (0600), never trusted; a record no ATTEMPT matches is counted and said", () => {
  const r = rig();
  const target = file(r, "t", "v1");
  r._w = r.make();
  act(r, { target, seq: 1, actionId: "a1" });
  const st = JSON.parse(readFileSync(join(r.state, "state.json"), "utf8"));
  assert.strictEqual(st.book.seq, 1, "the state names the record it reflects");
  st.book.hash = "0".repeat(64);
  writeFileSync(join(r.state, "state.json"), JSON.stringify(st), { mode: 0o600 });
  r._w = r.make();
  const aside = readdirSync(r.state).filter((f) => f.startsWith("state.json.not-this-book-"));
  assert.strictEqual(aside.length, 1);
  assert.strictEqual(statSync(join(r.state, aside[0])).mode & 0o777, 0o600);
  assert.ok(r.logs.some((l) => l.includes("1 not matched to a target")), "the unmatched record is said");
  act(r, { target, seq: 2, actionId: "a2" });
  assert.strictEqual(events(r)[1].outcome, "x2:FIRST_SEEN", "no baseline was invented");
});

check("SD-35 · a NEW digest key never compares across the lost one: the state's looks are set aside and the book re-baselines nothing", () => {
  const r = rig();
  const target = file(r, "t", "v1");
  r._w = r.make();
  act(r, { target, seq: 1, actionId: "a1" });
  unlinkSync(join(r.state, "digest.key"));
  r._w = r.make();
  assert.strictEqual(readdirSync(r.state).filter((f) => f.startsWith("state.json.key-lost-")).length, 1);
  act(r, { target, seq: 2, actionId: "a2" });
  // Under the old key the untouched target would read a FALSE CONTENT_DIFFERS (digests under two keys never agree).
  assert.strictEqual(events(r)[1].outcome, "x2:FIRST_SEEN");
});

/** Acts 1 and 2 baseline t and u; act 3's record on t LANDS, the persist does not; `then` shapes the intake. */
function unmatchedCrash(then: (r: Rig, attemptName: string, attemptBytes: string) => void): { e4: Record<string, any>; e5: Record<string, any>; r: Rig } {
  const r = rig();
  const t = file(r, "t", "v1");
  const u = file(r, "u", "u1");
  r._w = r.make();
  act(r, { target: t, seq: 1, actionId: "a1" });
  act(r, { target: u, seq: 2, actionId: "a2" });
  const stateBefore = readFileSync(join(r.state, "state.json"));
  writeFileSync(t, "v2");
  const an = attempt(r, { target: t, subjectSeq: 3, actionId: "a3" });
  const attemptBytes = readFileSync(join(r.intake, an), "utf8");
  close(r, { attemptSeq: 3, actionId: "a3", guard: decision() });
  assert.strictEqual(r._w.sweep().written, 1);
  assert.strictEqual(events(r)[2].witnessed.observed, "CONTENT_DIFFERS", "act 3's record says v1 -> v2");
  writeFileSync(join(r.state, "state.json"), stateBefore); // THE CRASH: the state is as before act 3
  then(r, an, attemptBytes);
  r._w = r.make();
  r._w.sweep();
  act(r, { target: t, seq: 4, actionId: "a4" });
  act(r, { target: u, seq: 5, actionId: "a5" });
  const [e4, e5] = [4, 5].map((q) => events(r).find((e) => e.witnessed.cites.subjectSeq === q)!);
  return { e4, e5, r };
}

check("SD-36a · a record past the persist that NO ATTEMPT names forgets every cached look (audit 2026-10-11 15:27Z): t is never read against the v1 the book has moved past", () => {
  const { e4, e5, r } = unmatchedCrash((rr) => assert.strictEqual(readdirSync(rr.intake).length, 0, "act 3's drops are gone"));
  // With the cached v1 still in use, act 4 would read a FALSE CONTENT_DIFFERS: the book's own act 3 already says v2.
  assert.strictEqual(e4.outcome, "x2:FIRST_SEEN");
  assert.strictEqual(e5.outcome, "x2:FIRST_SEEN", "the unmatched record could have been u's: its cached look is forgotten too");
  assert.ok(r.logs.some((l) => l.includes("1 not matched to a target — 2 cached look(s) forgotten")), "the forgetting is said");
});

check("SD-36b · an ATTEMPT that names the act but disagrees with its record (another target fingerprint) forgets THAT target's cached look only", () => {
  const { e4, e5, r } = unmatchedCrash((rr, an, bytes) => writeFileSync(join(rr.intake, an), JSON.stringify({ ...JSON.parse(bytes), targetFingerprint: "e".repeat(64) })));
  assert.strictEqual(e4.outcome, "x2:FIRST_SEEN", "t's cached v1 is forgotten, never compared");
  assert.strictEqual(e5.outcome, "x2:SAME", "u's cached look is untouched");
  assert.ok(r.logs.some((l) => l.includes("1 not matched to a target — 1 cached look(s) forgotten")), "the forgetting is said");
});

check("SD-37 · the deploy's unit gate pins THIS method: witness-sight-deploy.sh's METHOD_WANT is the code's SEEING_METHOD_DIGEST", () => {
  const script = readFileSync(join(__dirname, "..", "..", "deploy", "witness-sight-deploy.sh"), "utf8");
  const pinned = /^METHOD_WANT=([0-9a-f]{64})\b/m.exec(script);
  assert.ok(pinned !== null, "the deploy script pins no METHOD_WANT");
  assert.strictEqual(pinned[1], SEEING_METHOD_DIGEST, "the method moved: re-pin METHOD_WANT in deploy/gen-deploy.py and regenerate");
});

check("SD-38 · ONE METHOD PER BOOK (W-1): a book whose first line names another method is RETIRED unaltered; the new book's first line names this method and declares it; last looks and recorded acts carry across", () => {
  const r = rig();
  const t = file(r, "t", "v1");
  r._w = r.make();
  act(r, { target: t, seq: 1, actionId: "a1" });
  const rec1 = events(r)[0];
  // THE BOOK UNDER ANOTHER METHOD: act 1's record under a first line naming method 0…0 — written with the journal
  // itself, so it chains — and the state pointed at it, as if that book had been kept all along.
  const OTHER = "0".repeat(64);
  const forged = join(r.dir, "forged.jsonl");
  const j = new SubjectEventJournal({ path: forged });
  assert.ok(j.appendBoundary(null, EFFECTS_BOOK_BOUNDARY_BASIS.replace(`(method ${SEEING_METHOD_DIGEST})`, `(method ${OTHER})`), rec1.timestamp - 1).persisted);
  assert.ok(j.appendEvent(() => ({ timestamp: rec1.timestamp, moduleId: rec1.moduleId, eventType: rec1.eventType, outcome: rec1.outcome, actionId: rec1.actionId, witnessed: rec1.witnessed })).persisted);
  renameSync(forged, r.book);
  const forgedBytes = readFileSync(r.book);
  const lines = forgedBytes.toString("utf8").trim().split("\n").map((l) => JSON.parse(l));
  const st = JSON.parse(readFileSync(join(r.state, "state.json"), "utf8"));
  st.book = { seq: 1, hash: lines[1].hash };
  writeFileSync(join(r.state, "state.json"), JSON.stringify(st), { mode: 0o600 });
  r._w = r.make();
  const aside = readdirSync(join(r.dir, "book")).filter((f) => f.startsWith("effects.jsonl.retired-method-0000000000000000-"));
  assert.strictEqual(aside.length, 1, "the old book is retired beside the new one");
  const retiredPath = join(r.dir, "book", aside[0]);
  assert.ok(readFileSync(retiredPath).equals(forgedBytes), "retired UNALTERED");
  assert.strictEqual(new SubjectChainLog({ path: r.book }).getLoadState(), LOADED_SUBJECT_CHAIN_VERIFIED);
  const first = JSON.parse(readFileSync(r.book, "utf8").split("\n")[0]);
  assert.deepStrictEqual(first.retired, { path: retiredPath, records: 2, bytes: forgedBytes.length, sha256: createHash("sha256").update(forgedBytes).digest("hex") });
  assert.ok(first.basis.includes(`(method ${SEEING_METHOD_DIGEST})`), "the new first line names THIS method");
  assert.ok(first.basis.includes(`kept under method ${OTHER}`), "and declares the predecessor's");
  assert.ok(r.logs.some((l) => l.includes("RETIRED unaltered")), "the retirement is said");
  // THE LAST LOOK CARRIES ACROSS: the untouched target reads SAME against act 1's look, recorded in the predecessor.
  act(r, { target: t, seq: 2, actionId: "a2" });
  const e2 = events(r)[0];
  assert.strictEqual(e2.outcome, "x2:SAME");
  assert.strictEqual(e2.witnessed.priorLookAt, rec1.witnessed.look.at);
  // A REPLAY of act 1 (recorded only in the predecessor) is never written into the new book — nor after a restart.
  attempt(r, { target: t, subjectSeq: 1, actionId: "a1" });
  close(r, { attemptSeq: 1, actionId: "a1", guard: decision() });
  assert.strictEqual(r._w.sweep().written, 0);
  r._w = r.make();
  attempt(r, { target: t, subjectSeq: 1, actionId: "a1" });
  close(r, { attemptSeq: 1, actionId: "a1", guard: decision() });
  assert.strictEqual(r._w.sweep().written, 0, "the predecessor's acts are recorded after a restart too");
  assert.strictEqual(events(r).length, 1);
  assert.strictEqual(r.logs.filter((l) => l.includes("RETIRED unaltered")).length, 1, "a book under this method is never retired again");
});

rmSync(root, { recursive: true, force: true });
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
