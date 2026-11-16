// ── MICA · tools/ticket-preflight — the pre-flight's own suite ───────────────
//
// ⛔ WHY THIS TOOL EXISTS, AND IT COST A SIGNATURE. On 2026-10-02 the arbiter
//    signed T17 and the core door REFUSED it one step later: `defect has keys
//    [costIsNearlyZero, notAGate, partTwo, summary, whyItMatters], expected
//    exactly [ground, summary]`. The seat had drafted T16 and T17 modelled on
//    T15 — which IS correctly shaped — and then added thirteen keys across them,
//    every one of them more reasoning poured into the artefact, which is
//    precisely what the door's exact-keys rule exists to refuse. No check stood
//    between a draft and a signature.
//
// ⛔ AND THE COST WAS NOT ONE ACT. A ticket `parseTicket` cannot read makes the
//    door throw, so it returns REFUSED for every file and every OTHER live
//    ticket on the line. An unvalidated install does not risk its own act; it
//    stops the line.
//
// ⚠ THE TOOL IMPORTS THE DOOR'S `parseTicket` AND DOES NOT RESTATE THE SCHEMA,
//   and this suite asserts that property rather than trusting it: the fixtures
//   below are built from the shape the door's own parser demands, so if the door
//   tightens, these fail and the tool is re-read. A second copy of the ticket
//   shape beside the first is the seam this project has paid for nine times.

import assert from "assert";
import { execFileSync } from "child_process";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";

import { parseTicket } from "../../src/core-door/core-door";
import { STAMP_RULE_FROM, baseRelation, calendarDayMs, headShaOf, installGate, parseForGate, preflightState, stampedWith, violations } from "./preflight";

const ROOT = resolve(__dirname, "..", "..");

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}`); console.error(`    ${(error as Error).message}`); failed++; }
}

const TICKETS = join(__dirname, "..", "..", "src", "core-door", "tickets");
// ⛔ THIS STEM USED TO BE "T99-fixture", AND THE WORD BELOW SAID "grant this
//    fixture" — so the suite's own WELL-SHAPED, SIGNED ticket was one the DOOR
//    REFUSES (`loadTickets` rejects /FIXTURE/i on the id or the arbiter's word).
//    The happy-path test therefore asserted INSTALLABLE on something uninstallable,
//    and it only surfaced when the pre-flight learned to check the door's second
//    gate. A fixture that cannot be installed is the wrong fixture for the case
//    called "installable".
const STEM = "T99-well-shaped";
/** A minimally well-shaped ticket, built to the door's exact keys. */
function wellShaped(): Record<string, unknown> {
  return {
    schema: "mica-core-door/ticket/1",
    id: STEM,
    opens: ["src/mica/eng/index.ts"],
    defect: { summary: "a summary", ground: "a ground" },
    expiresAt: "2099-01-02T18:00:00Z",
    arbiter: { word: "I, the arbiter, grant this test sample.", date: "2099-01-01" },
    conditions: ["one condition"],
  };
}
const v = (o: unknown, stem: string = STEM): string[] => violations(JSON.stringify(o), stem);

console.log("\nMICA — tools/ticket-preflight\n");

check("a well-shaped, signed ticket is INSTALLABLE", () => {
  assert.deepStrictEqual(v(wellShaped()), []);
  assert.strictEqual(preflightState(v(wellShaped())), "INSTALLABLE");
});

check("a ticket marked FIXTURE is MALFORMED — the door's SECOND gate, which this tool used to miss", () => {
  // ⛔ FOUND BY A SIGNED TICKET, 2026-10-03. T19's id was
  //    `T19-op-ceilings-resolvable-fixtures` and the arbiter's own word read
  //    "tests assert verdicts only on fixtures large enough to resolve them" —
  //    both legitimately contain "fixtures", because the ticket is ABOUT fixtures.
  //    The pre-flight said INSTALLABLE and the door REFUSED. The schema is in
  //    `parseTicket`; this guard is in `loadTickets`, and a tool that checks one of
  //    two gates while reporting "the door's own parser accepts it as-is" is a
  //    caption wider than its measurement.
  const byId = wellShaped();
  byId.id = "T99-some-fixture-thing";
  const gotId = v(byId, "T99-some-fixture-thing");
  // ⚠ PREMISE MOVED 2026-10-04, IN PLACE AND WITH THE REASON. A FIXTURE-ish id is
  //   now reported TWICE and that is deliberate: once by the raw-id gate that
  //   runs BEFORE the parse (so a DRAFT is caught, which is the only moment the
  //   id is still changeable) and once by `fixtureMarked` after it. The arm used
  //   to assert exactly one objection; the property it holds — MALFORMED, and the
  //   words "marked FIXTURE" present — is unchanged.
  assert.ok(gotId.length >= 1, JSON.stringify(gotId));
  assert.ok(gotId.some((m) => m.includes("marked FIXTURE")), JSON.stringify(gotId));
  assert.ok(gotId.some((m) => m.includes("matches /FIXTURE/i")), `and the draft-time gate fires too: ${JSON.stringify(gotId)}`);
  assert.strictEqual(preflightState(gotId), "MALFORMED");

  const byWord = wellShaped();
  byWord.arbiter = { word: "I, the arbiter, grant this: the FIXTURE must be resized.", date: "2099-01-01" };
  const gotWord = v(byWord);
  assert.strictEqual(gotWord.length, 1, JSON.stringify(gotWord));
  assert.ok(gotWord[0].includes("marked FIXTURE"), gotWord[0]);

  // ⚠ AND IT IS CASE-INSENSITIVE, which is why a ticket about fixtures cannot pass
  //   by lowercasing. The door's regex is /FIXTURE/i and this asserts that.
  const lower = wellShaped();
  lower.arbiter = { word: "I, the arbiter, grant this: the fixture must be resized.", date: "2099-01-01" };
  assert.ok(v(lower).some((x) => x.includes("marked FIXTURE")), JSON.stringify(v(lower)));
});

check("⛔ an id matching /FIXTURE/i is caught ON THE DRAFT, where the door's own gate cannot reach", () => {
  // ⛔ MEASURED ON T25, 2026-10-04. The signed ticket read "✗ MALFORMED · is
  //    marked FIXTURE"; the IDENTICAL ticket with a placeholder word read
  //    "✓ READY FOR SIGNATURE" — same offending id. `fixtureMarked` is checked
  //    only AFTER `parseTicket` succeeds, and a placeholder word makes
  //    `parseTicket` throw, so the gate that exists because T19 slipped through
  //    was unreachable at the only moment it would help. The draft was handed
  //    over, signed, and refused by the door with the id no longer mine to change.
  const d = wellShaped();
  d.id = "T99-sig-f3-fixture-names-its-chain";
  d.arbiter = { word: "<<DRAFT, NOT SIGNED — the arbiter's own sentence replaces this>>", date: "2099-01-01" };
  const got = v(d, "T99-sig-f3-fixture-names-its-chain");
  assert.strictEqual(preflightState(got), "MALFORMED", JSON.stringify(got));
  assert.ok(got.some((m) => m.includes('matches /FIXTURE/i')), JSON.stringify(got));
  assert.ok(got.some((m) => m.includes("final from the moment it is written")), JSON.stringify(got));
  // ⚠ AND IT IS THE ID ALONE: a draft's WORD is SUPPOSED to be a placeholder, so
  //   a word-only FIXTURE case must still reach the arbiter as READY.
  const clean = wellShaped();
  clean.arbiter = { word: "<<DRAFT, NOT SIGNED — the arbiter's own sentence replaces this>>", date: "2099-01-01" };
  assert.strictEqual(preflightState(v(clean)), "READY FOR SIGNATURE", "a clean id must still read ready");
});

check("a draft whose ONLY fault is the placeholder is READY FOR SIGNATURE, not MALFORMED", () => {
  // ⛔ THE DISTINCTION IS THE WHOLE POINT. A correct draft and a broken one both
  //    fail the door; only one of them should be handed to the arbiter.
  const d = wellShaped();
  d.arbiter = { word: "<<DRAFT, NOT SIGNED — the arbiter's own sentence replaces this>>", date: "2099-01-01" };
  const got = v(d);
  assert.strictEqual(got.length, 1, `expected exactly one violation, got ${JSON.stringify(got)}`);
  assert.ok(got[0].includes("arbiter.word is still the placeholder"), got[0]);
  assert.strictEqual(preflightState(got), "READY FOR SIGNATURE");
});

check("a draft that is BOTH unsigned AND unfilled is NOT ready — the unfilled field wins", () => {
  // ⛔ THIS TOOL COULD NOT HAVE CAUGHT IT, AND THAT IS THE FINDING. Its
  //    READY FOR SIGNATURE verdict is defined as "exactly one objection and it is
  //    the arbiter.word one", and until 2026-10-03 the door's unfilled-draft check
  //    was arbiter.word ALONE — so a draft whose `conditions` still said
  //    "<<DERIVATION PASTED HERE>>" came back READY, and this tool agreed with the
  //    door by construction. A second opinion that shares the first one's eyes.
  //
  // ⚠ IT IS FIXED IN THE DOOR, NOT HERE, AND THIS ARM IS HOW THAT IS VISIBLE: the
  //   tool imports `parseTicket` rather than restating the schema, so widening the
  //   door moved this verdict without a line changing in this file.
  const d = wellShaped();
  d.arbiter = { word: "<<DRAFT, NOT SIGNED — the arbiter's own sentence replaces this>>", date: "2099-01-01" };
  d.conditions = ["1. a real condition", "<<2. OPENS DERIVED BY THE SWEEP — PASTE HERE>>"];
  const got = v(d);
  assert.strictEqual(preflightState(got), "MALFORMED");
  assert.ok(
    got.some((m) => m.includes("conditions[1] still carries a draft marker")),
    `the unfilled condition must be named, with its index: ${JSON.stringify(got)}`
  );
  assert.ok(
    !got.some((m) => m.includes("arbiter.word is still the placeholder")),
    `and the arbiter.word objection must NOT be the one reported, or this reads as ready: ${JSON.stringify(got)}`
  );

  // ⚠ AND THE CORRECT DRAFT IS STILL CORRECT, or the widening would have made
  //   every draft MALFORMED and the distinction this suite exists for would be gone.
  const ok = wellShaped();
  ok.arbiter = { word: "<<DRAFT, NOT SIGNED — the arbiter's own sentence replaces this>>", date: "2099-01-01" };
  assert.strictEqual(preflightState(v(ok)), "READY FOR SIGNATURE");
});

check("T17's ACTUAL defect — extra keys inside `defect` — is MALFORMED and named", () => {
  const d = wellShaped();
  d.defect = { summary: "s", ground: "g", whyItMatters: "x", partTwo: "y", notAGate: "z" };
  const got = v(d);
  assert.strictEqual(preflightState(got), "MALFORMED");
  assert.ok(got.some((m) => m.startsWith("defect has keys")), JSON.stringify(got));
  assert.ok(got[0].includes("expected exactly [ground, summary]"), got[0]);
});

check("IT ENUMERATES: four faults are reported in one pass, not one per round", () => {
  // ⛔ `parseTicket` throws on the FIRST violation. Without the enumeration a seat
  //    fixes one fault, re-runs, finds the next, and learns the shape four
  //    round-trips at a time — which is how T16's draft reached a finalised state
  //    with four of them still in it.
  const d = wellShaped();
  (d as Record<string, unknown>).buildEvidence = "an extra top-level key";
  d.defect = { summary: "s", ground: "g", extra: "x" };
  d.arbiter = { word: "<<placeholder>>", date: "2099-01-01", orderingWarning: "x" };
  const got = v(d);
  assert.ok(got.length >= 4, `expected at least four violations in one pass, got ${got.length}: ${JSON.stringify(got)}`);
  assert.ok(got.some((m) => m.startsWith("ticket has keys")), "the extra top-level key must be named");
  assert.ok(got.some((m) => m.startsWith("defect has keys")), "the extra defect key must be named");
  assert.ok(got.some((m) => m.startsWith("arbiter has keys")), "the extra arbiter key must be named");
  assert.ok(got.some((m) => m.includes("placeholder")), "the placeholder must still be named");
  assert.strictEqual(preflightState(got), "MALFORMED");
});

check("a file that is not JSON at all is MALFORMED and says so, rather than throwing", () => {
  const got = violations("{ not json", STEM);
  assert.strictEqual(got.length, 1);
  assert.ok(got[0].startsWith("not JSON at all:"), got[0]);
  assert.strictEqual(preflightState(got), "MALFORMED");
});

check("an id that will not match its installed filename is caught BEFORE the install", () => {
  const d = wellShaped();
  d.id = "T98-different";
  const got = v(d);
  assert.strictEqual(preflightState(got), "MALFORMED");
  assert.ok(got.some((m) => m.includes("does not match its file name")), JSON.stringify(got));
});

check("an `opens` path outside src/mica is refused — including a marker left in it", () => {
  // ⚠ A DRAFT HAS EXACTLY ONE CORRECT WAY TO BE REFUSED, and this is the wrong
  //   one. Markers belong in `arbiter.word`, where the door names the file
  //   UNSIGNED; a marker in `opens` reads as a MALFORMED ticket instead. The seat
  //   used both mechanisms on an earlier T16 draft and only one told the truth.
  const d = wellShaped();
  d.opens = ["<<THIS LIST IS A FLOOR, NOT THE MEASURED SET>>"];
  const got = v(d);
  assert.strictEqual(preflightState(got), "MALFORMED");
  assert.ok(got.some((m) => m.includes("is not a plain path under src/mica")), JSON.stringify(got));
});


// ── THE INSTALL GATE — the door's date window and the base stamp ─────────────────
//
// ⛔ EVERY TEST BELOW EXISTS BECAUSE `INSTALLABLE` MEANT LESS THAN IT SAID. Codex,
//    2026-10-03: a T19 with `arbiter.date` 2026-09-01 and `expiresAt`
//    2026-09-02T18:00:00Z returned `violations: []`, `preflight: INSTALLABLE` on
//    2026-10-03 — five weeks dead, perfectly shaped. The schema could not see it,
//    because the only date rule in the schema is RELATIVE (expiresAt after the
//    arbiter's date) and both dates had moved together.

const DAY = 86400000;
/** A ticket inside its window today, built from the clock rather than from a literal. */
function dated(nowMs: number, o: Record<string, unknown> = wellShaped()): Record<string, unknown> {
  const iso = (ms: number) => new Date(ms).toISOString();
  o.arbiter = { ...(o.arbiter as Record<string, unknown>), date: iso(nowMs - DAY).slice(0, 10) };
  o.expiresAt = iso(nowMs + 7 * DAY).replace(/\.\d{3}Z$/, "Z");
  return o;
}
const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

check("PF-G1 · ⛔ THE CODEX PROBE: a ticket five weeks EXPIRED is schema-clean and the install gate refuses it", () => {
  const now = Date.parse("2026-10-03T00:00:00Z");
  const d = wellShaped();
  d.arbiter = { ...(d.arbiter as Record<string, unknown>), date: "2026-09-01" };
  d.expiresAt = "2026-09-02T18:00:00Z";
  // the defect, still true and now harmless: the SCHEMA accepts it
  assert.deepStrictEqual(v(d), [], "the schema still accepts it — that was never the bug");
  assert.strictEqual(preflightState(v(d)), "INSTALLABLE");
  // the fix: the gate is a second answer, and it refuses
  const t = parseTicket(JSON.stringify(d), STEM);
  const g = installGate(t, now, HEAD_A);
  assert.strictEqual(g.windowState, "EXPIRED");
  assert.ok(g.objections.some((o) => o.includes("EXPIRED 2026-09-02T18:00:00Z")), JSON.stringify(g.objections));
  assert.ok(
    g.objections.some((o) => o.includes("the shape is correct and the ticket is dead")),
    "the objection must say WHY the schema could not see it"
  );
});

check("PF-G2 · a ticket inside its window, with no base, passes the gate and is NOT faulted for the missing stamp", () => {
  // ⚠ T1…T19 carry no `base`. A gate that failed them would refuse this tool's own
  //   history to enforce a rule none of them could have met.
  const now = Date.now();
  const t = parseTicket(JSON.stringify(dated(now)), STEM);
  const g = installGate(t, now, HEAD_A);
  assert.strictEqual(g.windowState, "IN WINDOW");
  assert.strictEqual(g.baseState, "UNSTAMPED");
  assert.deepStrictEqual(g.objections, [], "an absent stamp is a fact about the ticket's age, not a failure");
});

check("PF-G3 · ⛔ a `base` that is not HEAD is REFUSED, and this is the T19 defect made mechanical", () => {
  const now = Date.now();
  const d = dated(now);
  d.base = HEAD_B;
  const t = parseTicket(JSON.stringify(d), STEM);
  assert.strictEqual(t.base, HEAD_B, "parseTicket must carry the base through");
  // ⛔ T23 MOVED THIS PREMISE AND THE SAFETY PROPERTY IS UNCHANGED. "not HEAD" is
  //    three answers now, and a call that supplies NO relation is asking the gate
  //    to judge without the evidence — so the state is RELATION UNKNOWN rather
  //    than STALE. It still REFUSES, which is what this arm was written to hold;
  //    only the name of the refusal moved. The STALE case is PF-G3b, with the
  //    relation supplied, where it can be reached for the right reason.
  const g = installGate(t, now, HEAD_A);
  assert.strictEqual(g.baseState, "STAMPED, RELATION UNKNOWN");
  assert.strictEqual(g.objections.length, 1, JSON.stringify(g.objections));
  assert.ok(g.objections[0].includes(HEAD_A), "the objection must print the HEAD it was measured against");
  assert.ok(
    g.objections[0].includes("UNDETERMINED IS REFUSED"),
    `an undetermined relation must deny by default and say so: ${g.objections[0]}`
  );
  // and the same ticket at the right tip is clean
  assert.deepStrictEqual(installGate(t, now, HEAD_B).objections, []);
  assert.strictEqual(installGate(t, now, HEAD_B).baseState, "STAMPED AND CURRENT");
});

// ── T23 · "NOT HEAD" IS THREE ANSWERS, NOT ONE ──────────────────────────────
//
// ⛔ TWO INCIDENTS IN TWO TICKS. T24's draft was stamped at a506e89; f5ca85c
//    landed and the gate said STALE, so it was re-derived with two full sweep arms
//    and re-stamped; then f71e685 landed and it went stale AGAIN — while
//    f5ca85c..f71e685 touches tools/opens-sweep and NOTHING under src/mica. The
//    derivation could not have moved and the gate refused it anyway.
const REL = (isAncestor: boolean, coreMoved: readonly string[], allMoved: readonly string[]) => ({
  isAncestor,
  coreMoved,
  allMoved,
});

check("PF-G3a · a base BEHIND HEAD with NOTHING under src/mica moved is ACCEPTED, and the acceptance says why", () => {
  const now = Date.now();
  const d = dated(now);
  d.base = HEAD_B;
  const t = parseTicket(JSON.stringify(d), STEM);
  const moved = ["tools/opens-sweep/opens-sweep.ts", "tools/opens-sweep/opens-sweep.test.ts"];
  const g = installGate(t, now, HEAD_A, REL(true, [], moved));
  assert.deepStrictEqual(g.objections, [], JSON.stringify(g.objections));
  assert.strictEqual(g.baseState, "STAMPED, CORE UNMOVED");
  // the relation is carried OUT, so the caller can print what moved instead of
  // asserting an acceptance nobody can check
  assert.deepStrictEqual(g.relation?.allMoved, moved);
});

check("PF-G3b · a base BEHIND HEAD with a CORE file moved is REFUSED, and the refusal NAMES the files", () => {
  // ⛔ THIS IS T19'S DEFECT, AND T23 DOES NOT WEAKEN IT — it sharpens it. T19's
  //    base was wrong BECAUSE core files moved in between; that case still
  //    refuses, and now says which ones.
  const now = Date.now();
  const d = dated(now);
  d.base = HEAD_B;
  const t = parseTicket(JSON.stringify(d), STEM);
  const g = installGate(t, now, HEAD_A, REL(true, ["src/mica/eng.ts", "src/mica/eng.test.ts"], ["src/mica/eng.ts", "src/mica/eng.test.ts"]));
  assert.strictEqual(g.baseState, "STAMPED BUT STALE");
  assert.strictEqual(g.objections.length, 1, JSON.stringify(g.objections));
  assert.ok(g.objections[0].includes("src/mica/eng.ts"), `name them: ${g.objections[0]}`);
  assert.ok(g.objections[0].includes("src/mica/eng.test.ts"), `all of them: ${g.objections[0]}`);
  assert.ok(g.objections[0].includes("cceccda"), "and still name the case that paid for it");
});

check("PF-G3c · ⛔ a base that is NOT AN ANCESTOR gets its OWN name — the fault the old rule could not spell", () => {
  // Under the old rule an abandoned or rewritten branch read exactly like a base
  // one commit behind: both were simply "not HEAD". The second is the worse fault.
  const now = Date.now();
  const d = dated(now);
  d.base = HEAD_B;
  const t = parseTicket(JSON.stringify(d), STEM);
  const g = installGate(t, now, HEAD_A, REL(false, [], ["src/mica/eng.ts"]));
  assert.strictEqual(g.baseState, "STAMPED, NOT AN ANCESTOR");
  assert.strictEqual(g.objections.length, 1, JSON.stringify(g.objections));
  assert.ok(g.objections[0].includes("NOT AN ANCESTOR"), g.objections[0]);
  // ⚠ AND IT MUST NOT BE SAVED BY AN EMPTY coreMoved. A base off the history is
  //   refused whatever the diff says, because the diff is not about this history.
  assert.ok(!g.objections[0].includes("moved in between"), `not the stale message: ${g.objections[0]}`);
});

check("PF-G3d · an UNDETERMINED relation is REFUSED, never read as `nothing moved`", () => {
  // ⚠ DENY BY DEFAULT, the rule the bridge's role helper was repaired to obey the
  //   same week: absent evidence is not evidence of absence.
  const now = Date.now();
  const d = dated(now);
  d.base = HEAD_B;
  const t = parseTicket(JSON.stringify(d), STEM);
  for (const rel of [null, undefined]) {
    const g = installGate(t, now, HEAD_A, rel);
    assert.strictEqual(g.baseState, "STAMPED, RELATION UNKNOWN", JSON.stringify(rel));
    assert.strictEqual(g.objections.length, 1, JSON.stringify(g.objections));
    assert.ok(g.objections[0].includes("UNDETERMINED IS REFUSED"), g.objections[0]);
  }
});

check("PF-G3e · baseRelation reads THIS repo for real: an ancestor, a non-ancestor, and an unknown sha", () => {
  // ⛔ A FIXTURE PROVES ONLY THAT I CAN MATCH MY OWN PROSE. The four arms above
  //    inject the relation; this one measures the function that produces it,
  //    against this worktree's own history.
  const head = headShaOf(ROOT);
  assert.ok(head !== null, "this test needs a readable HEAD");
  const parent = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD~1"], { encoding: "utf8" }).trim();

  const behind = baseRelation(ROOT, parent, head!);
  assert.ok(behind !== null, "the parent of HEAD must be relatable to HEAD");
  assert.strictEqual(behind!.isAncestor, true);
  assert.deepStrictEqual(
    behind!.allMoved,
    execFileSync("git", ["-C", ROOT, "diff", "--name-only", `${parent}..${head}`], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter((x) => x !== ""),
    "allMoved must be git's own answer, not a re-derived one"
  );
  for (const f of behind!.coreMoved) {
    assert.ok(f.startsWith("src/mica/"), `coreMoved must hold only core paths, got ${f}`);
  }

  // HEAD is not an ancestor of its own parent
  const ahead = baseRelation(ROOT, head!, parent);
  assert.ok(ahead !== null);
  assert.strictEqual(ahead!.isAncestor, false);

  // ⚠ AND A SHA THIS REPO HAS NEVER SEEN MUST RETURN null, NOT `isAncestor:false`.
  //   "I cannot answer" and "no" are different, and only one of them is a finding
  //   about the ticket.
  assert.strictEqual(baseRelation(ROOT, "0".repeat(40), head!), null);
});

check("PF-G4 · ⛔ a stamp that CANNOT be checked is an objection, never a pass", () => {
  // A tool that cannot read HEAD and reports a clean gate has turned the one
  // question the stamp exists to answer into silence.
  const now = Date.now();
  const d = dated(now);
  d.base = HEAD_B;
  const g = installGate(parseTicket(JSON.stringify(d), STEM), now, null);
  assert.strictEqual(g.baseState, "STAMPED, HEAD UNKNOWN");
  assert.ok(g.objections.some((o) => o.includes("cannot be checked")), JSON.stringify(g.objections));
});

check("PF-G5 · a ticket whose arbiter date is in the future is NOT YET ISSUED, not expired", () => {
  // wellShaped() is dated 2099 — the suite's own fixture is the fixture for this.
  const now = Date.now();
  const g = installGate(parseTicket(JSON.stringify(wellShaped()), STEM), now, HEAD_A);
  assert.strictEqual(g.windowState, "NOT YET ISSUED");
  assert.ok(g.objections.some((o) => o.includes("has not opened")), JSON.stringify(g.objections));
});

check("PF-G6 · a malformed `base` is a SCHEMA violation — the door's parser, not the gate", () => {
  const d = dated(Date.now());
  d.base = "6cdb573";                        // the short sha a hand would type
  const got = v(d);
  assert.strictEqual(preflightState(got), "MALFORMED");
  assert.ok(got.some((m) => m.includes("base")), JSON.stringify(got));
});

check("PF-G7 · an UNSIGNED draft still gets a gate reading, via an in-memory substitution", () => {
  // The dates and the base are facts about the ticket, independent of the word —
  // so a draft handed for signature can be told its expiry is already past.
  const now = Date.parse("2026-10-03T00:00:00Z");
  const d = wellShaped();
  d.arbiter = { word: "<<THE ARBITER'S OWN WORDS GO HERE>>", date: "2026-09-01" };
  d.expiresAt = "2026-09-02T18:00:00Z";
  assert.strictEqual(preflightState(v(d)), "READY FOR SIGNATURE", "it is a correct draft in SHAPE");
  const t = parseForGate(JSON.stringify(d), STEM);
  assert.ok(t !== null, "the gate must be able to read a draft");
  assert.strictEqual(installGate(t!, now, HEAD_A).windowState, "EXPIRED");
  // ⚠ and the substituted word must not trip the FIXTURE gate it was invented to avoid
  assert.ok(!/FIXTURE/i.test(t!.arbiter.word), `the sentinel must not match /FIXTURE/i: ${t!.arbiter.word}`);
});

check("PF-G8 · headShaOf reads a real HEAD here, and null where there is no repo", () => {
  const here = headShaOf(join(__dirname, "..", ".."));
  assert.ok(here !== null && /^[0-9a-f]{40}$/.test(here), `expected a sha, got ${here}`);
  assert.strictEqual(headShaOf("/nonexistent-path-for-this-test"), null);
  console.log(`      (HEAD here: ${here!.slice(0, 7)})`);
});


check("PF-G9 · ⛔ THE STAMP REFUSES A SIGNED TICKET — the arbiter signs bytes", () => {
  // A tool that stamps a grant has edited what was granted, whatever it wrote.
  const signed = JSON.stringify(dated(Date.now()));
  assert.throws(() => stampedWith(signed, HEAD_A), /this ticket is SIGNED/);
});

check("PF-G10 · the stamp writes HEAD into a DRAFT, after expiresAt, and nowhere else", () => {
  const d = dated(Date.now());
  d.arbiter = { word: "<<THE ARBITER'S OWN WORDS GO HERE>>", date: (d.arbiter as Record<string, unknown>).date };
  const out = stampedWith(JSON.stringify(d), HEAD_A);
  const o = JSON.parse(out) as Record<string, unknown>;
  assert.strictEqual(o.base, HEAD_A);
  const keys = Object.keys(o);
  assert.strictEqual(keys[keys.indexOf("base") - 1], "expiresAt", `base must follow expiresAt: ${keys.join(",")}`);
  // every other field is carried through untouched
  for (const k of Object.keys(d)) assert.deepStrictEqual(o[k], d[k], `${k} was altered by the stamp`);
  assert.ok(out.endsWith("\n"), "a JSON file ends with a newline");
});

check("PF-G11 · ⛔ it refuses an UNREADABLE HEAD and an EXISTING DIFFERENT stamp, rather than overwriting either", () => {
  const d = dated(Date.now());
  d.arbiter = { word: "<<PLACEHOLDER>>", date: (d.arbiter as Record<string, unknown>).date };
  assert.throws(() => stampedWith(JSON.stringify(d), null), /HEAD could not be read/);
  assert.throws(() => stampedWith(JSON.stringify(d), "6cdb573"), /is not a full sha/);
  d.base = HEAD_B;
  assert.throws(() => stampedWith(JSON.stringify(d), HEAD_A), /do not overwrite the stamp/);
  // stamping the SAME value again is idempotent, not an error
  assert.strictEqual((JSON.parse(stampedWith(JSON.stringify(d), HEAD_B)) as Record<string, unknown>).base, HEAD_B);
});


check("PF-G12 · ⛔ A NOTE IS NOT A GATE: a ticket signed AFTER the ruling and carrying no base is REFUSED", () => {
  // the first version of this gate printed a ⚠ and passed — a disclosure where a
  // check belongs, which is the defect this campaign has named four times.
  const now = Date.parse("2026-11-01T00:00:00Z");
  const d = wellShaped();
  d.arbiter = { ...(d.arbiter as Record<string, unknown>), date: "2026-10-04" };
  d.expiresAt = "2026-11-08T18:00:00Z";
  const g = installGate(parseTicket(JSON.stringify(d), STEM), now, HEAD_A);
  assert.strictEqual(g.baseState, "UNSTAMPED");
  assert.ok(g.objections.some((o) => o.includes("no `base` stamp")), JSON.stringify(g.objections));
  assert.ok(g.objections.some((o) => o.includes("--stamp")), "and it must say how to fix it");
});

check("PF-G13 · every INSTALLED ticket is exempt from the stamp rule, by date — including T19", () => {
  // ⛔ THE EXEMPTION IS ASSERTED, NOT ASSUMED. If a future ticket lands in this
  //    directory without a base and dated after the rule, this fails — which is
  //    exactly when someone should be told.
  const files = readdirSync(TICKETS).filter((f) => f.endsWith(".json")).sort();
  const late: string[] = [];
  for (const f of files) {
    const t = parseTicket(readFileSync(join(TICKETS, f), "utf8"), f.replace(/\.json$/, ""));
    if (t.base === undefined && t.arbiter.date > STAMP_RULE_FROM) late.push(`${f} (${t.arbiter.date})`);
  }
  assert.deepStrictEqual(late, [], `installed tickets signed after ${STAMP_RULE_FROM} with no base stamp`);
  console.log(`      (${files.length} installed, all dated on or before ${STAMP_RULE_FROM})`);
});


check("PF-G14 · ⛔ CODEX, 09ab195: three IMPOSSIBLE dates pass the door, and the day is never checked against the month", () => {
  // The finding was reported as a leap day. Measured, it is wider: the MONTH is
  // range-checked and the DAY is not checked against the month's LENGTH, so every
  // short-month overflow passes. These three are the measured ones.
  for (const bad of ["2027-02-29", "2026-02-30", "2026-04-31"]) {
    assert.strictEqual(calendarDayMs(bad), null, `${bad} is not a real date`);
    // ⚠ AND THE DOOR STILL ACCEPTS IT — asserted, so the gap is pinned rather than
    //   described. If a future door tightens, THIS fails and the comment is re-read.
    const d = wellShaped();
    d.arbiter = { ...(d.arbiter as Record<string, unknown>), date: bad };
    d.expiresAt = "2099-06-01T18:00:00Z";
    assert.deepStrictEqual(v(d), [], `the door accepts ${bad}; if it no longer does, this gate is redundant`);
    // the install gate refuses it, and names what it rolled to
    const g = installGate(parseTicket(JSON.stringify(d), STEM), Date.parse("2099-01-01T00:00:00Z"), HEAD_A);
    assert.ok(
      g.objections.some((o) => o.includes("not a real calendar date")),
      `${bad}: ${JSON.stringify(g.objections)}`
    );
    assert.ok(g.objections.some((o) => o.includes("THE DOOR ACCEPTS THIS TICKET")), bad);
  }
});

check("PF-G15 · real dates — including a REAL leap day — are not refused", () => {
  // ⛔ THE OTHER HALF. A check that refused every February would satisfy PF-G14.
  for (const good of ["2024-02-29", "2026-02-28", "2026-04-30", "2026-12-31", "2026-01-01"]) {
    assert.ok(calendarDayMs(good) !== null, `${good} IS a real date and must not be refused`);
  }
  // 2024 is a leap year, 2027 is not, and the difference must be visible
  assert.ok(calendarDayMs("2024-02-29") !== null);
  assert.strictEqual(calendarDayMs("2027-02-29"), null);
  // and a date inside its window with a real date raises no objection at all
  const now = Date.now();
  const g = installGate(parseTicket(JSON.stringify(dated(now)), STEM), now, HEAD_A);
  assert.deepStrictEqual(g.objections, [], JSON.stringify(g.objections));
});

check("EVERY INSTALLED TICKET IS INSTALLABLE — the census, as an assertion", () => {
  // ⛔ THIS IS THE ONE THAT WOULD HAVE CAUGHT THE 2026-10-02 INSTALL. A malformed
  //    ticket in this directory refuses the whole door, so the directory's own
  //    state is a property of the repository and not of whoever last looked.
  const files = readdirSync(TICKETS).filter((f) => f.endsWith(".json")).sort();
  assert.ok(files.length > 0, "no tickets found — the census would pass vacuously");
  const bad: string[] = [];
  for (const f of files) {
    const raw = readFileSync(join(TICKETS, f), "utf8");
    const stem = f.replace(/\.json$/, "");
    const got = violations(raw, stem);
    if (preflightState(got) !== "INSTALLABLE") bad.push(`${f}: ${got.join(" | ")}`);
  }
  assert.deepStrictEqual(bad, [], `installed tickets that the door's own parser refuses:\n    ${bad.join("\n    ")}`);
  console.log(`      (census: ${files.length} installed ticket(s), all INSTALLABLE)`);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
