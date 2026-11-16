// ── MICA · the declared-shape guard ───────────────────────────────────────────
//   npx ts-node src/mica/log.test.ts
//
// House style: standalone ts-node script, custom check() harness. No framework.
//
// WHY THIS FILE EXISTS
//
// src/mica/log.ts declares what MICA needs from a log. Two things about that
// declaration can rot silently, and both are guarded here.
//
// ── 1 · THE `parameters` TRAP ─────────────────────────────────────────────────
//
// Standing constraint 4 keeps MICA out of the untyped bag. That rule used to be
// written `keyof Omit<LogEntry, "parameters">`.
//
// `Omit` NEEDS THE KEY TO BE PRESENT IN ORDER TO REMOVE IT. On a record type
// that never declared `parameters`, `Omit<Rec, "parameters">` is just `Rec`:
// the guard excludes nothing, protects nothing, names nothing — AND STILL
// COMPILES, AND STILL LOOKS EXACTLY LIKE A LIVE GUARD. Nothing would ever have
// told anyone it had stopped working.
//
// So the exclusion is checked here THREE independent ways, and a fourth in
// log.ts's own type-level assertions:
//
//   · the declared shape is read OUT OF THE SOURCE and its field names pinned,
//     so adding `parameters` back to MicaLogRecord fails a test rather than
//     quietly widening what MICA may touch;
//   · log.ts must still physically carry both compile-time assertions, so
//     deleting one is a failure and not a relaxation;
//   · log.ts must NOT express the exclusion with `Omit<` again.
//
// ── 2 · THE WIDTH ─────────────────────────────────────────────────────────────
//
// Every field in MicaLogRecord is a REQUIREMENT IMPOSED ON EVERY FUTURE
// ADAPTER. The width is pinned in both directions here: a field added without
// a read site fails, and a field removed fails too, so the list stays a record
// of what IS rather than a wish.
//
// THIS IS A GUARD, NOT A FEATURE. It measures no log and emits no verdict.

import assert from "assert";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  MICA_READABLE_FIELDS,
  MICA_READABLE_METHODS,
  MICA_UNREADABLE_FIELDS,
} from "./log";
import {
  ACTION_ID_COVERAGE_IS_NOT_PROVENANCE,
  RECOMMENDED_READABLE_LOAD_STATES,
  actionIdCoverage,
  assessLogReadability,
  isUsableLoadStateList,
} from "./types";
import type { MicaLogRecord, MicaReadableLog } from "./log";
import { MicaFixtureLog, lookAtFixtureLogFile } from "./fixture-log";
import { assessSig, sigScopeBlockText } from "./sig";
import { assessEng, engScopeBlockText } from "./eng";
import type { CannotAssessVerdict, SensorVerdict } from "./types";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    failed++;
  }
}

const LOG_TS = readFileSync(join(__dirname, "log.ts"), "utf8");
const LOG_TYPES = readFileSync(join(__dirname, "types.ts"), "utf8");

/**
 * Pull the member names out of a named interface declaration in TypeScript
 * source.
 *
 * Reading the SOURCE rather than the type is the whole point. Types are erased
 * at runtime, so a test that only inspects values can never see that a field
 * was added to the shape. This can.
 */
function interfaceMembers(src: string, name: string): string[] {
  const open = src.indexOf(`interface ${name} {`);
  assert.ok(open >= 0, `interface ${name} not found in source`);
  const bodyStart = src.indexOf("{", open) + 1;
  let depth = 1;
  let i = bodyStart;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
  }
  const body = src.slice(bodyStart, i - 1);

  const out: string[] = [];
  for (const line of body.split("\n")) {
    const stripped = line.replace(/\/\/.*$/, "").trim();
    // `readonly foo: T;` · `foo?: T;` · `bar(): T;`
    const m = /^(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*[?(:]/.exec(stripped);
    if (m !== null) out.push(m[1]);
  }
  return out;
}

console.log("\n── MICA declared-shape guard ─────────────────────────────────");

// The parser is only worth having if it catches a real addition, so prove it
// does before trusting it to say there is none.
check("the interface parser reads members, and would see `parameters` appear", () => {
  const synthetic =
    "export interface Fake {\n" +
    "  readonly sequenceNumber: number;\n" +
    "  // readonly commented: string;\n" +
    "  parameters: Record<string, unknown>;\n" +
    "  method(): void;\n" +
    "}\n";
  assert.deepStrictEqual(interfaceMembers(synthetic, "Fake"), [
    "sequenceNumber",
    "parameters",
    "method",
  ]);
});

// ══ THE WIDTH, PINNED IN BOTH DIRECTIONS ═════════════════════════════════════

check("MicaLogRecord declares EXACTLY the six fields with a read site", () => {
  assert.deepStrictEqual(interfaceMembers(LOG_TS, "MicaLogRecord"), [
    "sequenceNumber",
    "timestamp",
    "moduleId",
    "eventType",
    "outcome",
    "actionId",
  ]);
});

check("MicaReadableLog declares EXACTLY the three methods MICA calls", () => {
  assert.deepStrictEqual(interfaceMembers(LOG_TS, "MicaReadableLog"), [
    "verify",
    "getLoadState",
    "getAll",
  ]);
});

check("the exported field and method lists match the declared interfaces", () => {
  assert.deepStrictEqual(
    [...MICA_READABLE_FIELDS],
    interfaceMembers(LOG_TS, "MicaLogRecord")
  );
  assert.deepStrictEqual(
    [...MICA_READABLE_METHODS],
    interfaceMembers(LOG_TS, "MicaReadableLog")
  );
});

// ══ THE `parameters` TRAP ════════════════════════════════════════════════════

check("NO excluded field is on the declared record — `parameters` above all", () => {
  const declared = interfaceMembers(LOG_TS, "MicaLogRecord");
  for (const forbidden of MICA_UNREADABLE_FIELDS) {
    assert.ok(
      !declared.includes(forbidden),
      `MicaLogRecord declares "${forbidden}", which has no read site. If this ` +
        `was added deliberately, it is a requirement imposed on every future ` +
        `adapter and needs a ruling, not a commit.`
    );
  }
  assert.ok(
    MICA_UNREADABLE_FIELDS.includes("parameters" as never),
    "the excluded list no longer names `parameters`"
  );
});

check("the exclusion is NOT expressed with Omit — the pattern that fails silent", () => {
  assert.ok(
    !/\bOmit\s*</.test(LOG_TS.replace(/^\s*\*.*$/gm, "").replace(/\/\/.*$/gm, "")),
    "log.ts expresses the shape with Omit<>. Omit needs the excluded key to be " +
      "PRESENT in order to remove it, so on a record that never declared it the " +
      "exclusion silently becomes a no-op that still compiles. Express the " +
      "readable fields positively instead."
  );
});

check("both compile-time guards are still physically present in log.ts", () => {
  assert.ok(
    LOG_TS.includes("_readableFieldsAreExactlyTheRecordKeys"),
    "the exactness assertion tying MICA_READABLE_FIELDS to keyof MicaLogRecord " +
      "has been deleted; the two can now drift apart at compile time."
  );
  assert.ok(
    LOG_TS.includes("_NoUnreadableFieldOnTheRecord"),
    "the assertion requiring the excluded names to be absent from the record " +
      "has been deleted; `parameters` can now come back without a compile error."
  );
});

check("a fixture record carries no excluded field at runtime either", () => {
  const log = new MicaFixtureLog();
  log.append({
    timestamp: 1,
    moduleId: "m",
    eventType: "e",
    outcome: "o",
    undeclared: { anything: "at all" },
  });
  const record = log.getAll()[0] as unknown as Record<string, unknown>;
  for (const forbidden of ["parameters", "provenanceTag"]) {
    assert.ok(
      !(forbidden in record),
      `the fixture writes a "${forbidden}" key; MICA's record format has none`
    );
  }
  assert.ok("undeclared" in record, "the D2 bag is not on the record");
});

check("the actionId census counts threaded values and blank keys without a verdict", () => {
  const log = new MicaFixtureLog();
  log.append({ timestamp: 1, moduleId: "m", eventType: "e", outcome: "o" });
  log.append({ timestamp: 2, moduleId: "m", eventType: "e", outcome: "o", actionId: "" });
  log.append({ timestamp: 3, moduleId: "m", eventType: "e", outcome: "o", actionId: "action-3" });
  log.append({ timestamp: 4, moduleId: "m", eventType: "e", outcome: "o", actionId: "action-4" });
  assert.deepStrictEqual(actionIdCoverage(log.getAll()), {
    total: 4,
    withKey: 2,
    withoutKey: 2,
  });
});

check("ActionIdCoverage declares exactly the three census members", () => {
  assert.deepStrictEqual(interfaceMembers(LOG_TYPES, "ActionIdCoverage"), [
    "total",
    "withKey",
    "withoutKey",
  ]);
});

check("the actionId census carries its provenance ceiling", () => {
  assert.ok(LOG_TYPES.includes("ACTION_ID_COVERAGE_IS_NOT_PROVENANCE"));
  assert.ok(ACTION_ID_COVERAGE_IS_NOT_PROVENANCE.includes("not an authentication"));
});

check("changing a fixture actionId severs its hash chain at that record", () => {
  const log = new MicaFixtureLog();
  const record = log.append({
    timestamp: 1,
    moduleId: "m",
    eventType: "e",
    outcome: "o",
    actionId: "original-action",
  });
  record.actionId = "rewritten-action";
  assert.deepStrictEqual(log.verify(), { valid: false, brokenAt: 0 });
});

// ══ LOG-AGNOSTIC IN PRACTICE, NOT ONLY IN DECLARATION ════════════════════════
//
// The point of declaring a shape is that anything of that shape can be read.
// A hand-written object literal — no class, no file, no chain, nothing this
// project ships — is enough. If this ever stops compiling or stops being read,
// the interface has grown a requirement nobody declared.

function blindClasses(v: SensorVerdict): string[] {
  assert.strictEqual(v.kind, "CANNOT_ASSESS", `expected CANNOT_ASSESS, got ${v.kind}`);
  return (v as CannotAssessVerdict).blindPaths.map((b) => b.class);
}

function handRolled(
  loadState: string,
  valid: boolean,
  records: readonly MicaLogRecord[]
): MicaReadableLog {
  return {
    verify: () => (valid ? { valid: true } : { valid: false, brokenAt: 0 }),
    getLoadState: () => loadState,
    getAll: () => records,
  };
}

/** What every test below injects. A literal, not the recommendation constant. */
const GATE: readonly string[] = ["LOADED_VERIFIED"];

const HAND_ROLLED_RECORDS: readonly MicaLogRecord[] = [
  { sequenceNumber: 0, timestamp: 10, moduleId: "x", eventType: "a", outcome: "ok" },
  { sequenceNumber: 1, timestamp: 20, moduleId: "x", eventType: "a", outcome: "ok" },
  { sequenceNumber: 2, timestamp: 30, moduleId: "y", eventType: "b", outcome: "no" },
  { sequenceNumber: 3, timestamp: 40, moduleId: "y", eventType: "b", outcome: "no" },
];

check("an OBJECT LITERAL of the declared shape is read by both sensors", () => {
  const log = handRolled("LOADED_VERIFIED", true, HAND_ROLLED_RECORDS);
  const sig = assessSig(log, { readableLoadStates: GATE, clockToleranceMs: 0 });
  const eng = assessEng(log, {
    readableLoadStates: GATE,
    structureThreshold: 0.2,
    minimumSampleSize: 2,
  });
  // No class of verdict is asserted here — the claim is that a log this
  // project did not build is READ, not that it reads any particular way.
  assert.ok(["ALARM", "SILENT", "CANNOT_ASSESS"].includes(sig.verdict.kind));
  assert.ok(["ALARM", "SILENT", "CANNOT_ASSESS"].includes(eng.verdict.kind));
  assert.strictEqual(assessLogReadability(log, "MICA/Test", GATE), null);
});

check("an UNRECOGNISED load state fails CLOSED — blind, never silently readable", () => {
  const log = handRolled("SOME_OTHER_ADAPTERS_WORD", true, HAND_ROLLED_RECORDS);
  const v = assessLogReadability(log, "MICA/Test", GATE);
  assert.notStrictEqual(v, null, "an unknown load state was accepted as readable");
  assert.deepStrictEqual(blindClasses(v as CannotAssessVerdict), [
    "NON_CLEAN_LOAD_STATE",
  ]);
});

check("a log that reports itself broken is BROKEN_CHAIN, whoever wrote it", () => {
  const log = handRolled("LOADED_VERIFIED", false, HAND_ROLLED_RECORDS);
  const v = assessLogReadability(log, "MICA/Test", GATE);
  assert.notStrictEqual(v, null);
  assert.deepStrictEqual(blindClasses(v as CannotAssessVerdict), ["BROKEN_CHAIN"]);
});

// ══ THE GATE LIST IS INJECTED — NO DEFAULT, NO FALLBACK ══════════════════════
//
// `READABLE_LOAD_STATES = ["LOADED_VERIFIED"]` used to be a constant in sensor
// code. `getLoadState()` was already typed `string`, so MICA did not require any
// particular log's TYPE — but it still required that log's WORD. One system's
// vocabulary, hardcoded, deciding a deployment fact.
//
// The list is injected now. The failure mode to guard against is not that the
// injection is missing; it is that a FALLBACK quietly reinstates the constant,
// at which point injection is theatre and nothing ever fails.

console.log("\n── the load-state gate is injected ───────────────────────────");

const CLEAN_LOG = handRolled("LOADED_VERIFIED", true, HAND_ROLLED_RECORDS);

check("NO LIST INJECTED -> MISSING_CONFIGURATION, even on a clean log", () => {
  const v = assessLogReadability(CLEAN_LOG, "MICA/Test", undefined);
  assert.notStrictEqual(
    v,
    null,
    "A log reporting LOADED_VERIFIED was read with NO list injected. That is the " +
      "old constant surviving as a fallback: injection would be theatre."
  );
  assert.deepStrictEqual(blindClasses(v as CannotAssessVerdict), [
    "MISSING_CONFIGURATION",
  ]);
  assert.ok(
    (v as CannotAssessVerdict).blindPaths[0].detail.includes(
      "readableLoadStates was not injected"
    )
  );
});

check("an EMPTY list is MISSING_CONFIGURATION, not `trust nothing`", () => {
  const v = assessLogReadability(CLEAN_LOG, "MICA/Test", []);
  assert.notStrictEqual(v, null);
  assert.deepStrictEqual(blindClasses(v as CannotAssessVerdict), [
    "MISSING_CONFIGURATION",
  ]);
});

check("a MALFORMED list is MISSING_CONFIGURATION, never partially honoured", () => {
  for (const bad of [
    [""],
    ["   "],
    ["LOADED_VERIFIED", ""],
    [42 as unknown as string],
    ["LOADED_VERIFIED", null as unknown as string],
  ]) {
    assert.strictEqual(isUsableLoadStateList(bad), false, `accepted ${JSON.stringify(bad)}`);
    const v = assessLogReadability(CLEAN_LOG, "MICA/Test", bad);
    assert.notStrictEqual(v, null, `read a log with list ${JSON.stringify(bad)}`);
    assert.deepStrictEqual(blindClasses(v as CannotAssessVerdict), [
      "MISSING_CONFIGURATION",
    ]);
  }
});

check("BOTH SENSORS go blind with no list, and nothing else runs", () => {
  const sig = assessSig(CLEAN_LOG, { clockToleranceMs: 0 });
  assert.deepStrictEqual(blindClasses(sig.verdict), ["MISSING_CONFIGURATION"]);
  assert.deepStrictEqual(sig.flags, [], "a flag ran without a readable gate");
  assert.strictEqual(sig.readableLoadStates, null);

  const eng = assessEng(CLEAN_LOG, {
    structureThreshold: 0.2,
    minimumSampleSize: 2,
  });
  assert.deepStrictEqual(blindClasses(eng.verdict), ["MISSING_CONFIGURATION"]);
  assert.strictEqual(eng.structure, undefined, "a statistic ran without a gate");
  assert.strictEqual(eng.readableLoadStates, null);
});

// The gate must not be able to reach the recommendation. If it ever can, the
// constant is back and every test above passes for the wrong reason.
check("the gate function cannot reach the recommended list, or any literal state", () => {
  const open = LOG_TYPES.indexOf("export function assessLogReadability(");
  assert.ok(open >= 0, "assessLogReadability not found in types.ts");
  let depth = 0;
  let i = LOG_TYPES.indexOf("{", open);
  const start = i;
  for (; i < LOG_TYPES.length; i++) {
    if (LOG_TYPES[i] === "{") depth++;
    else if (LOG_TYPES[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = LOG_TYPES.slice(start, i + 1);
  assert.ok(
    !body.includes("RECOMMENDED_READABLE_LOAD_STATES"),
    "the gate references the recommendation — that is a fallback, and a fallback " +
      "is the old constant surviving under a new name"
  );
  for (const literal of RECOMMENDED_READABLE_LOAD_STATES) {
    assert.ok(
      !body.includes(`"${literal}"`),
      `the gate contains the literal "${literal}". Which states are readable is ` +
        `the caller's to say, and a literal here says it for them.`
    );
  }
});

// ══ WIDENING IS FREE, AND IT IS VISIBLE ══════════════════════════════════════
//
// A deployer can inject a permissive list and blind this gate. We cannot prevent
// that and must not try — it is their decision. So it is made VISIBLE: printed
// in the blind path, and printed in the scope block.

console.log("\n── widening is the deployer's, and it is printed ──────────────");

check("a WIDENED list actually widens — an in-memory log becomes readable", () => {
  const inMemory = handRolled("IN_MEMORY", true, HAND_ROLLED_RECORDS);
  assert.notStrictEqual(
    assessLogReadability(inMemory, "MICA/Test", GATE),
    null,
    "IN_MEMORY was readable under the narrow list"
  );
  assert.strictEqual(
    assessLogReadability(inMemory, "MICA/Test", ["IN_MEMORY", "LOADED_VERIFIED"]),
    null,
    "a list naming IN_MEMORY did not make an IN_MEMORY log readable — the gate " +
      "is not honouring the injection"
  );
});

check("the blind path PRINTS the list this run was told to trust", () => {
  const odd = handRolled("SOMETHING_ELSE", true, HAND_ROLLED_RECORDS);
  const v = assessLogReadability(odd, "MICA/Test", [
    "LOADED_VERIFIED",
    "ALSO_FINE",
  ]) as CannotAssessVerdict;
  const detail = v.blindPaths[0].detail;
  assert.ok(detail.includes("SOMETHING_ELSE"), "the reported state is not named");
  assert.ok(
    detail.includes("[ALSO_FINE, LOADED_VERIFIED]"),
    `the injected list is not printed: ${detail}`
  );
});

check("the SCOPE BLOCK prints the list, and states the widening exposure", () => {
  const narrow = sigScopeBlockText(GATE);
  assert.ok(narrow.includes("THIS RUN'S LOAD-STATE GATE"));
  assert.ok(narrow.includes("[LOADED_VERIFIED]"));
  assert.ok(narrow.includes("THE STRICTNESS OF THIS GATE IS THE DEPLOYER'S CHOICE"));
  assert.ok(narrow.includes("disables"));
  assert.ok(narrow.includes("WILL NOT OBJECT"));
  assert.ok(narrow.includes("No minimum is"));

  const wide = engScopeBlockText(["IN_MEMORY", "LOADED_VERIFIED", "CANNOT_VERIFY"]);
  assert.ok(
    wide.includes("[CANNOT_VERIFY, IN_MEMORY, LOADED_VERIFIED]"),
    "a widened list is not printed in the scope block, so widening would be silent"
  );

  const none = sigScopeBlockText();
  assert.ok(none.includes("NO READABLE LOAD-STATE LIST WAS INJECTED FOR THIS RUN"));
});

check("the recommendation is offered as a recommendation, and is still A1", () => {
  const t = sigScopeBlockText(GATE);
  assert.ok(t.includes("WHAT THIS PROJECT RECOMMENDS, and only recommends"));
  assert.ok(t.includes("INTEGRITY"));
  assert.ok(t.includes("PROVENANCE"));
  assert.ok(t.includes("ACCEPTED COST"));
  assert.ok(t.includes("restarted at least once"));
});

// ══ NOTHING MICA EMITS NAMES A FOREIGN TYPE OR COMPONENT ═════════════════════
//
// The log-agnostic round left one wart: verdict text still named a type this
// project does not import. Checking it found more of them — nineteen lines
// across three files. A sweep done once goes stale, so it is a test.
//
// The scan covers everything a reader can actually see: both scope blocks, in
// injected and un-injected form, and the full verdict text of every branch of
// the readability gate and of both sensors.

console.log("\n── MICA's output names no foreign type or component ───────────");

const FOREIGN_NAMES: readonly string[] = [
  "LogEntry",
  "LockedEvidenceLog",
  "ILASKillStack",
  "ILAS",
  "VerdictEngine",
  "ModuleSignal",
];

function verdictText(v: SensorVerdict): string {
  const parts = [v.summary];
  if (v.kind === "ALARM") {
    for (const f of v.findings) parts.push(f.code, f.detail);
  }
  if (v.kind === "CANNOT_ASSESS") {
    for (const b of v.blindPaths) parts.push(b.class, b.detail);
  }
  return parts.join("\n");
}

check("no scope block and no verdict names a foreign type or component", () => {
  const broken = handRolled("LOADED_VERIFIED", false, HAND_ROLLED_RECORDS);
  const odd = handRolled("IN_MEMORY", true, HAND_ROLLED_RECORDS);
  const emitted = [
    sigScopeBlockText(GATE),
    engScopeBlockText(GATE),
    sigScopeBlockText(),
    engScopeBlockText(),
    verdictText(assessSig(CLEAN_LOG, { readableLoadStates: GATE, clockToleranceMs: 0 }).verdict),
    verdictText(assessSig(odd, { readableLoadStates: GATE, clockToleranceMs: 0 }).verdict),
    verdictText(assessSig(broken, { readableLoadStates: GATE, clockToleranceMs: 0 }).verdict),
    verdictText(assessSig(CLEAN_LOG, { clockToleranceMs: 0 }).verdict),
    verdictText(assessSig(CLEAN_LOG, { readableLoadStates: GATE }).verdict),
    verdictText(
      assessEng(CLEAN_LOG, {
        readableLoadStates: GATE,
        structureThreshold: 0.2,
        minimumSampleSize: 2,
      }).verdict
    ),
    verdictText(assessEng(odd, { readableLoadStates: GATE }).verdict),
    verdictText(assessEng(broken, { readableLoadStates: GATE }).verdict),
    verdictText(assessEng(CLEAN_LOG, { readableLoadStates: GATE }).verdict),
  ].join("\n");

  for (const name of FOREIGN_NAMES) {
    assert.ok(
      !emitted.includes(name),
      `MICA emits the foreign name "${name}". MICA describes what it needs, not ` +
        `whose log it is: say "the log", or name the record shape this project declares.`
    );
  }
  assert.ok(
    !/\bL0\b/.test(emitted),
    'MICA emits "L0", a foreign component name'
  );
});

// The artifact carries static prose the sensors never see, so the same rule is
// checked against its source. A source scan is weaker than rendering, and is
// named as such: it catches a foreign name being written, not one composed at
// runtime from pieces.
check("the delivery layer's own prose names no foreign type either", () => {
  for (const file of ["export/index.ts", "export/ledger.ts", "competence.ts"]) {
    const src = readFileSync(join(__dirname, file), "utf8");
    const strings = src.match(/"(?:[^"\\\n]|\\.)*"/g) ?? [];
    for (const literal of strings) {
      for (const name of FOREIGN_NAMES) {
        assert.ok(
          !literal.includes(name),
          `${file} emits the foreign name "${name}" in: ${literal}`
        );
      }
    }
  }
});


// ── FX-S103 · a look that was REFUSED is not a book that is ABSENT ────────────
//
// The class closed in `ruling-log.ts` at S98 and left open in five sibling books
// until S103. `existsSync` returns false both for "no such file" and for "not
// allowed to look"; this fixture read the second as the first, called it
// FIRST_BOOT_OR_ERASED, and — because `mkdirSync(..., { recursive: true })`
// SUCCEEDS on a directory that exists and cannot be entered — set itself
// persisting over content it never read.
//
// IT MATTERS MORE HERE THAN THE NAME "FIXTURE" SUGGESTS. Every MICA sensor in
// this repository is exercised against this class, and `assessLogReadability`
// gates on the load state it reports. A deployment listing FIRST_BOOT_OR_ERASED
// among its readableLoadStates — which is a reasonable thing to list, an empty
// first-boot log being genuinely readable — would have let an unreadable log
// through that gate wearing a clean state.

check("FX-S103-1 · the look has three answers, and only ENOENT means absent", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-fx-look-"));
  const present = join(base, "present.jsonl");
  writeFileSync(present, "", "utf8");
  assert.deepStrictEqual(lookAtFixtureLogFile(present), { state: "PRESENT" });
  assert.deepStrictEqual(lookAtFixtureLogFile(join(base, "nope.jsonl")), { state: "ABSENT" });
  const refused = lookAtFixtureLogFile(join(base, "x".repeat(300)));
  assert.strictEqual(refused.state, "CANNOT_SEE", "a name too long read as merely absent");
  assert.ok(refused.state === "CANNOT_SEE" && refused.detail.includes("ENAMETOOLONG"));
  rmSync(base, { recursive: true, force: true });
});

check("FX-S103-2 · a fixture it CANNOT SEE loads to CANNOT_VERIFY, never to first boot", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-fx-cannotsee-"));
  const log = new MicaFixtureLog({ path: join(base, "x".repeat(300)) });
  assert.strictEqual(
    log.getLoadState(),
    "CANNOT_VERIFY",
    "a fixture this process cannot look at came up as a first boot"
  );
  // No lastError companion on this fixture: it carries no error detail for ANY
  // failure mode, and S103 declined to invent one for this branch alone.
  rmSync(base, { recursive: true, force: true });
});

check("FX-S103-3 · THE REAL SHAPE — a directory whose execute bit is stripped", () => {
  // A mode-based refusal cannot be built for uid 0, which traverses regardless.
  // This body SAYS so rather than passing over a check that never ran;
  // FX-S103-1..2 reach the same branch by another errno for every principal.
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === 0 || uid === null) {
    console.log(
      "      NOT EXERCISED as this principal: a mode-based refusal cannot be " +
        "built for uid 0. The classification and the load state are covered by " +
        "FX-S103-1..2; this body covers only the mode."
    );
    return;
  }
  const base = mkdtempSync(join(tmpdir(), "mica-fx-noexec-"));
  const dir = join(base, "book");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "log.jsonl");
  writeFileSync(path, "", "utf8");
  chmodSync(dir, 0o600); // readable, NOT searchable
  try {
    const look = lookAtFixtureLogFile(path);
    assert.strictEqual(look.state, "CANNOT_SEE", "a directory with no execute bit did not refuse the look");
    assert.ok(look.state === "CANNOT_SEE" && look.detail.includes("EACCES"));
    assert.strictEqual(new MicaFixtureLog({ path }).getLoadState(), "CANNOT_VERIFY");
  } finally {
    chmodSync(dir, 0o700);
    rmSync(base, { recursive: true, force: true });
  }
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
