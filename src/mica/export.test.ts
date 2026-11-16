// ──────────────────────────────────────────────────────────────────────────────
// MICA — the exported record (T1 v1.2 step 4, REACH)
//   npx ts-node src/mica/export.test.ts
//
// House style: standalone ts-node script, custom check() harness. No framework.
//
// WHAT IS BEING TESTED, AND WHAT IS NOT
//
//   Tested: that a full, self-describing artifact reaches a declared location
//   for EVERY verdict kind from BOTH sensors; that a run which found nothing
//   still produces one; that CANNOT_ASSESS cannot be mistaken for SILENT; and
//   that an absent location produces a TYPED ABSENCE rather than a silent skip.
//
//   NOT tested, because it is not true: that any of this is independent of the
//   observed system. The artifact is written by the observed party to a path
//   the observed party controls. These tests check LEGIBILITY, not custody, and
//   one test below asserts the artifact says so to its own reader.
// ──────────────────────────────────────────────────────────────────────────────

import assert from "assert";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MicaFixtureLog } from "./fixture-log";
import { assessSig, printSigScope } from "./sig";
import { assessEng, printEngScope } from "./eng";
import type { ClerkClockSource, PreconditionMap, SigConfig, SigResult } from "./sig";
import type { EngConfig, EngResult } from "./eng";
import {
  deliverSigReading,
  deliverEngReading,
  NO_LOCATION_DETAIL,
} from "./export";
import type { ExportOutcome } from "./export";
import { ExportLedger, lookAtExportLedgerFile } from "./export/ledger";

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

const root = mkdtempSync(join(tmpdir(), "mica-export-"));
let counter = 0;
const freshLog = (): string => join(root, `log-${counter++}.jsonl`);
const freshOut = (): string => join(root, `artifact-${counter++}.txt`);

interface Spec {
  timestamp: number;
  eventType: string;
  outcome: string;
  moduleId?: string;
}

function appendAll(log: MicaFixtureLog, specs: readonly Spec[]): void {
  for (const s of specs) {
    log.append({
      timestamp: s.timestamp,
      moduleId: s.moduleId ?? "m6",
      eventType: s.eventType,
      outcome: s.outcome,
    });
  }
}

function withDurable<T>(specs: readonly Spec[], fn: (log: MicaFixtureLog) => T): T {
  const path = freshLog();
  try {
    appendAll(new MicaFixtureLog({ path }), specs);
    const loaded = new MicaFixtureLog({ path });
    if (loaded.getLoadState() !== "LOADED_VERIFIED") {
      throw new Error(`FIXTURE BROKEN: ${loaded.getLoadState()}`);
    }
    return fn(loaded);
  } finally {
    rmSync(path, { force: true });
  }
}

const T0 = 1_700_000_000_000;

/**
 * THE READABLE LOAD-STATE LIST, INJECTED INTO EVERY FIXTURE IN THIS FILE.
 *
 * The gate holds no list of its own and no default: which load states are
 * trustworthy is a deployment fact, so every caller must say. Injecting exactly
 * ["LOADED_VERIFIED"] here keeps every assertion below reading what it read
 * before the list was injected rather than hardcoded.
 *
 * Written as a literal rather than imported from RECOMMENDED_READABLE_LOAD_STATES
 * ON PURPOSE: a fixture that tracked the recommendation would stop being able to
 * detect the recommendation changing underneath it.
 */
const GATE: readonly string[] = ["LOADED_VERIFIED"];

const TEST_MAP: PreconditionMap = {
  escalation_active: ["escalation_granted"],
  quarantine_lifted: ["quarantine_entered", "operator_override"],
};
const SIG_CFG: SigConfig = {
  readableLoadStates: GATE,
  clockToleranceMs: 0,
  preconditionMap: TEST_MAP,
};

const CLEAN_SPECS: readonly Spec[] = [
  { timestamp: T0 + 0, eventType: "boot", outcome: "ok" },
  { timestamp: T0 + 10, eventType: "escalation_granted", outcome: "granted" },
  { timestamp: T0 + 20, eventType: "escalation_active", outcome: "active" },
  { timestamp: T0 + 20, eventType: "canary_check", outcome: "clean" },
  { timestamp: T0 + 30, eventType: "quarantine_entered", outcome: "entered" },
  { timestamp: T0 + 40, eventType: "quarantine_lifted", outcome: "lifted" },
];

const INVERTED: readonly Spec[] = [
  { timestamp: T0 + 500, eventType: "a", outcome: "ok" },
  { timestamp: T0 + 100, eventType: "b", outcome: "ok" },
];

const CLASSES = [
  { moduleId: "m3", eventType: "canary_check" },
  { moduleId: "m5", eventType: "drift_sample" },
  { moduleId: "m7", eventType: "permission_check" },
];

function specs(n: number, outcomeOf: (i: number) => string): Spec[] {
  const out: Spec[] = [];
  for (let i = 0; i < n; i++) {
    const c = CLASSES[i % CLASSES.length];
    out.push({
      moduleId: c.moduleId,
      eventType: c.eventType,
      outcome: outcomeOf(i),
      timestamp: T0 + i,
    });
  }
  return out;
}

const ENG_CFG: EngConfig = {
  readableLoadStates: GATE,
  structureThreshold: 0.2,
  minimumSampleSize: 30,
  // T11 · the observed-coverage floor, declared and with no default. This
  // suite declares its OWN Eng config, which is why it is in T11's `opens`:
  // without this line Eng returns MISSING_CONFIGURATION and every reading
  // through it becomes CANNOT_ASSESS.
  minimumClassCoverage: 3,
  ceilingMargin: 0.02,
  permutationSamples: 200,
  permutationSeed: 20260806,
};
const ENG_CFG_NO_CEILING: EngConfig = {
  readableLoadStates: GATE,
  structureThreshold: 0.2,
  minimumSampleSize: 30,
  // T11 · the observed-coverage floor, declared and with no default. This
  // suite declares its OWN Eng config, which is why it is in T11's `opens`:
  // without this line Eng returns MISSING_CONFIGURATION and every reading
  // through it becomes CANNOT_ASSESS.
  minimumClassCoverage: 3,
  permutationSamples: 200,
  permutationSeed: 20260806,
};

const HEALTHY = specs(90, (i) =>
  i % 4 === 0 ? "deferred" : `verdict_class_${i % CLASSES.length}`
);
const PERFECT = specs(60, (i) => `verdict_class_${i % CLASSES.length}`);
const FLATTENED = specs(60, () => "approved");

console.log("\nMICA export (T1 REACH) tests\n");

// ══ Every verdict kind, both sensors, actually written to disk ════════════════
//
// "An unexercised export is not a verified one." Each case below runs the real
// sensor, writes the real file, and reads the bytes back off the filesystem.

console.log("\n══ every verdict kind reaches a declared location ════════════");

interface Written {
  path: string;
  text: string;
  delivery: ExportOutcome;
}

function writeSig(result: SigResult): Written {
  const path = freshOut();
  const d = deliverSigReading(result, { path });
  return { path, text: readFileSync(path, "utf8"), delivery: d.delivery };
}

function writeEng(result: EngResult): Written {
  const path = freshOut();
  const d = deliverEngReading(result, { path });
  return { path, text: readFileSync(path, "utf8"), delivery: d.delivery };
}

/** Sections every artifact carries, whatever the run found. */
function assertFullArtifact(text: string, sensorId: string): void {
  for (const required of [
    `MICA SENSOR RECORD — ${sensorId}`,
    "WHAT THIS FILE IS",
    "WHAT THIS FILE IS NOT",
    "THE THREE POSSIBLE RESULTS, AND WHY THERE ARE THREE",
    "THIS FILE'S DECLARED LOCATION",
    "FINDINGS — things read that lower the bound",
    "SCOPES THE INSTRUMENT COULD NOT READ",
    "THE INSTRUMENT'S FULL DECLARED SCOPE",
    "READER COMPETENCE THIS INSTRUMENT PRESUMES (stated, never tested)",
    "DELIVERY — what became of this record",
    "END OF RECORD",
  ]) {
    assert.ok(text.includes(required), `artifact is missing section: ${required}`);
  }
}

const sigCases: { label: string; run: () => Written; kind: string }[] = [
  {
    label: "Sig ALARM",
    kind: "ALARM",
    run: () => withDurable(INVERTED, (l) => writeSig(assessSig(l, SIG_CFG))),
  },
  {
    label: "Sig SILENT",
    kind: "SILENT",
    run: () => withDurable(CLEAN_SPECS, (l) => writeSig(assessSig(l, SIG_CFG))),
  },
  {
    label: "Sig CANNOT_ASSESS (F2 dormant — no map injected)",
    kind: "CANNOT_ASSESS",
    run: () =>
      withDurable(CLEAN_SPECS, (l) =>
        writeSig(assessSig(l, { readableLoadStates: GATE, clockToleranceMs: 0 }))
      ),
  },
];

for (const c of sigCases) {
  const w = c.run();
  check(`${c.label}: artifact exists on disk and is a FULL record`, () => {
    assert.ok(existsSync(w.path));
    assert.ok(w.text.length > 2000, `artifact suspiciously short: ${w.text.length}`);
    assertFullArtifact(w.text, "MICA/Sig");
  });
  check(`${c.label}: the artifact states RESULT: ${c.kind}`, () => {
    assert.ok(w.text.includes(`RESULT: ${c.kind}`));
    assert.strictEqual(w.delivery.kind, "WRITTEN");
  });
  check(`${c.label}: the per-flag table is present`, () => {
    assert.ok(w.text.includes("PER-FLAG DETAIL"));
  });
}

const engCases: { label: string; run: () => Written; kind: string }[] = [
  {
    label: "Eng ALARM",
    kind: "ALARM",
    run: () => withDurable(FLATTENED, (l) => writeEng(assessEng(l, ENG_CFG))),
  },
  {
    label: "Eng SILENT",
    kind: "SILENT",
    run: () => withDurable(HEALTHY, (l) => writeEng(assessEng(l, ENG_CFG))),
  },
  {
    label: "Eng CANNOT_ASSESS (A5 ceiling)",
    kind: "CANNOT_ASSESS",
    run: () => withDurable(PERFECT, (l) => writeEng(assessEng(l, ENG_CFG))),
  },
];

for (const c of engCases) {
  const w = c.run();
  check(`${c.label}: artifact exists on disk and is a FULL record`, () => {
    assert.ok(existsSync(w.path));
    assert.ok(w.text.length > 2000);
    assertFullArtifact(w.text, "MICA/Eng");
  });
  check(`${c.label}: the artifact states RESULT: ${c.kind}`, () => {
    assert.ok(w.text.includes(`RESULT: ${c.kind}`));
    assert.strictEqual(w.delivery.kind, "WRITTEN");
  });
  check(`${c.label}: statistic, ceiling and breakdown sections all present`, () => {
    assert.ok(w.text.includes("THE STATISTIC — what was actually computed"));
    assert.ok(w.text.includes("THE CEILING"));
    assert.ok(w.text.includes("BREAKDOWNS — REPORTED BUT NEVER ACTED ON"));
  });
}

// ── The A5 ceiling CANNOT_ASSESS must carry its actual reasoning ─────────────

withDurable(PERFECT, (l) => {
  const w = writeEng(assessEng(l, ENG_CFG));
  check("A5 ceiling: the artifact explains a top score is an ABSENCE of evidence", () => {
    assert.ok(w.text.includes("RESULT: CANNOT_ASSESS"));
    assert.ok(w.text.includes("LOOKUP TABLE"));
    assert.ok(w.text.includes("IDENTICAL RECORD"));
  });
  check("A5 ceiling: the artifact never presents the top score as a good result", () => {
    assert.ok(!/RESULT: SILENT/.test(w.text));
  });
});

// ── Sig F2's dormant CANNOT_ASSESS must be visible as UNREAD, per flag ───────

withDurable(CLEAN_SPECS, (l) => {
  const w = writeSig(assessSig(l, { readableLoadStates: GATE, clockToleranceMs: 0 }));
  check("F2 dormant: the artifact names F2 as NOT READ, not as finding nothing", () => {
    assert.ok(w.text.includes("F2 — declared precondition violated"));
    assert.ok(w.text.includes("result:      CANNOT_ASSESS"));
    // F2 dormant is a verdict-bearing CANNOT_ASSESS: the artifact now says the
    // leg is NOT READ *and* that it lowers the bound (contrasting with the F5
    // NOT_CONFIGURED status, which does not).
    assert.ok(w.text.includes("NOT READ. This check covered nothing on this run"));
    assert.ok(w.text.includes("LOWERS"));
  });
  check("F2 dormant: F1's separate SILENT is still visible alongside it", () => {
    assert.ok(w.text.includes("F1 — declared clock vs append order"));
    assert.ok(w.text.includes("result:      SILENT"));
  });
});

// ══ Every note string the brief named ════════════════════════════════════════

console.log("\n══ permutationNote / windowNote / ceiling note ═══════════════");

withDurable(HEALTHY, (l) => {
  const w = writeEng(assessEng(l, { ...ENG_CFG, windowSize: 30 }));
  check("windowNote is carried when windows WERE produced", () => {
    assert.ok(w.text.includes("consecutive non-overlapping window(s) of injected size 30"));
    assert.ok(w.text.includes("window 0: records"));
  });
  check("permutationNote is carried when the percentile WAS produced", () => {
    assert.ok(w.text.includes("reshuffles at seed"));
    assert.ok(w.text.includes("Fisher-Yates on the outcome vector"));
  });
  check("the percentile is explicitly NOT offered as a significance test", () => {
    assert.ok(w.text.includes("THIS IS NOT A SIGNIFICANCE TEST"));
  });
});

withDurable(HEALTHY, (l) => {
  const w = writeEng(
    assessEng(l, {
          readableLoadStates: GATE,
      structureThreshold: 0.2,
      minimumSampleSize: 30,
      // T11 · the observed-coverage floor, declared and with no default. This
      // suite declares its OWN Eng config, which is why it is in T11's `opens`:
      // without this line Eng returns MISSING_CONFIGURATION and every reading
      // through it becomes CANNOT_ASSESS.
      minimumClassCoverage: 3,
    })
  );
  check("windowNote is carried when windows were NOT produced", () => {
    assert.ok(w.text.includes("NOT PRODUCED — windowSize was not injected"));
  });
  check("permutationNote is carried when the percentile was NOT produced", () => {
    assert.ok(w.text.includes("NOT PRODUCED — permutationSamples"));
  });
});

withDurable(HEALTHY, (l) => {
  const w = writeEng(assessEng(l, ENG_CFG_NO_CEILING));
  check("CEILING_NOT_PERFORMED_NOTE is carried verbatim when the check did not run", () => {
    assert.ok(w.text.includes("ceiling check: NOT_PERFORMED"));
    assert.ok(w.text.includes("The CEILING CHECK DID NOT RUN: no ceilingMargin was injected."));
    assert.ok(w.text.includes("evidence-free rather than healthy"));
  });
});

// The ceiling disclosure must reach the artifact even on an ALARM, whose
// summary does not embed it. This is delivery doing more than the console did.
withDurable(FLATTENED, (l) => {
  const r = assessEng(l, {
        readableLoadStates: GATE,
    structureThreshold: 0.2,
    minimumSampleSize: 30,
    // T11 · the observed-coverage floor, declared and with no default. This
    // suite declares its OWN Eng config, which is why it is in T11's `opens`:
    // without this line Eng returns MISSING_CONFIGURATION and every reading
    // through it becomes CANNOT_ASSESS.
    minimumClassCoverage: 3,
  });
  const w = writeEng(r);
  check("an ALARM produced with no ceiling margin still discloses the unrun check", () => {
    assert.strictEqual(r.verdict.kind, "ALARM");
    assert.ok(!r.verdict.summary.includes("CEILING CHECK DID NOT RUN"));
    assert.ok(w.text.includes("The CEILING CHECK DID NOT RUN"));
    assert.ok(w.text.includes("THE ABOVE RESULT WAS NOT CHECKED FOR THAT"));
  });
});

// ══ A run that found nothing still produces a full artifact ══════════════════
//
// The canon's §5 fence: an alarm-gated channel is curated by the instrument.
// This is the test that the channel is not gated.

console.log("\n══ uncurated: a run that found nothing still writes ══════════");

withDurable(CLEAN_SPECS, (l) => {
  const r = assessSig(l, SIG_CFG);
  const path = freshOut();
  const d = deliverSigReading(r, { path });
  check("SILENT run: nothing was found, and a full artifact is written anyway", () => {
    assert.strictEqual(r.verdict.kind, "SILENT");
    assert.strictEqual((r.verdict as { findings?: unknown }).findings, undefined);
    assert.strictEqual(d.delivery.kind, "WRITTEN");
    assert.ok(existsSync(path));
    assertFullArtifact(readFileSync(path, "utf8"), "MICA/Sig");
  });
  check("SILENT run: the artifact is comparable in size to an ALARM's", () => {
    const silentText = readFileSync(path, "utf8");
    const alarmText = withDurable(INVERTED, (a) => writeSig(assessSig(a, SIG_CFG)).text);
    const ratio = silentText.length / alarmText.length;
    assert.ok(ratio > 0.7, `silent artifact is only ${(ratio * 100).toFixed(0)}% the size`);
  });
  check("SILENT run: the artifact carries SILENCE_IS_NOT_HEALTH", () => {
    const t = readFileSync(path, "utf8");
    assert.ok(t.includes("SILENT is an ABSENCE OF FINDING, not a statement of health."));
    assert.ok(t.includes("THIS IS NOT A STATEMENT OF HEALTH"));
  });
  check("SILENT run: the empty findings section says so explicitly", () => {
    const t = readFileSync(path, "utf8");
    assert.ok(t.includes("(none — no finding was made on this run)"));
    assert.ok(t.includes("(none — every scope this run attempted was read)"));
  });
});

// An unreadable log is the emptiest run there is: no flag executes at all.
{
  const p = freshLog();
  try {
    const log = new MicaFixtureLog({ path: p });
    const r = assessSig(log, SIG_CFG);
    const path = freshOut();
    deliverSigReading(r, { path });
    check("unreadable log: still a full artifact, naming why nothing ran", () => {
      assert.strictEqual(r.verdict.kind, "CANNOT_ASSESS");
      assert.strictEqual(r.flags.length, 0);
      const t = readFileSync(path, "utf8");
      assertFullArtifact(t, "MICA/Sig");
      assert.ok(t.includes("(no check ran at all — the evidence log itself was not readable"));
      assert.ok(t.includes("NON_CLEAN_LOAD_STATE"));
    });
  } finally {
    rmSync(p, { force: true });
  }
}

// ══ CANNOT_ASSESS is not, and cannot be rendered as, SILENT ══════════════════

console.log("\n══ CANNOT_ASSESS is structurally distinct from SILENT ════════");

withDurable(CLEAN_SPECS, (l) => {
  const silentText = writeSig(assessSig(l, SIG_CFG)).text;
  const blindText = writeSig(assessSig(l, { readableLoadStates: GATE, clockToleranceMs: 0 })).text;

  check("the two artifacts are not the same document", () => {
    assert.notStrictEqual(silentText, blindText);
  });
  check("neither artifact contains the OTHER's result line", () => {
    assert.ok(silentText.includes("RESULT: SILENT"));
    assert.ok(!silentText.includes("RESULT: CANNOT_ASSESS"));
    assert.ok(blindText.includes("RESULT: CANNOT_ASSESS"));
    assert.ok(!blindText.includes("RESULT: SILENT"));
  });
  check("CANNOT_ASSESS says in terms that it is NOT silence", () => {
    assert.ok(blindText.includes("***THIS IS NOT SILENCE.***"));
    assert.ok(blindText.includes("Do not record this as a clean result. It is an unread one."));
    assert.ok(!silentText.includes("THIS IS NOT SILENCE"));
  });
  check("the two banners use different border characters — distinct at a glance", () => {
    assert.ok(blindText.includes("#".repeat(80)));
    assert.ok(!silentText.includes("#".repeat(80)));
    assert.ok(silentText.includes("-".repeat(80)));
  });
  check("CANNOT_ASSESS explains the empty findings list as NOT-LOOKED, not NOT-FOUND", () => {
    assert.ok(
      blindText.includes("No finding was made BECAUSE THE SCOPE WAS NOT READ")
    );
    assert.ok(
      silentText.includes("The scope named above was read and nothing in it lowered")
    );
  });
  check("only CANNOT_ASSESS enumerates unread scopes; SILENT reports none", () => {
    assert.ok(blindText.includes("UNREAD SCOPE 1 of"));
    assert.ok(!silentText.includes("UNREAD SCOPE"));
  });
});

// Structural, in the type system rather than the text: the two verdicts do not
// have the same shape, so one cannot be substituted for the other by accident.
withDurable(CLEAN_SPECS, (l) => {
  const s = assessSig(l, SIG_CFG).verdict;
  const c = assessSig(l, { readableLoadStates: GATE, clockToleranceMs: 0 }).verdict;
  check("the two verdicts are structurally different objects, not just labels", () => {
    assert.strictEqual(s.kind, "SILENT");
    assert.strictEqual(c.kind, "CANNOT_ASSESS");
    assert.strictEqual((s as { blindPaths?: unknown }).blindPaths, undefined);
    assert.ok(Array.isArray((c as { blindPaths?: unknown }).blindPaths));
    assert.ok((c as { blindPaths: readonly unknown[] }).blindPaths.length > 0);
  });
});

// ══ Absent location -> TYPED ABSENCE, never a silent skip ════════════════════

console.log("\n══ absent export location is a typed absence ═════════════════");

withDurable(CLEAN_SPECS, (l) => {
  const r = assessSig(l, SIG_CFG);

  const noTarget = deliverSigReading(r);
  check("no target argument at all -> NOT_ATTEMPTED_NO_LOCATION", () => {
    assert.strictEqual(noTarget.delivery.kind, "NOT_ATTEMPTED_NO_LOCATION");
  });

  const emptyTarget = deliverSigReading(r, {});
  check("an empty target object -> NOT_ATTEMPTED_NO_LOCATION", () => {
    assert.strictEqual(emptyTarget.delivery.kind, "NOT_ATTEMPTED_NO_LOCATION");
  });

  const undefPath = deliverSigReading(r, { path: undefined });
  check("an explicitly undefined path -> NOT_ATTEMPTED_NO_LOCATION", () => {
    assert.strictEqual(undefPath.delivery.kind, "NOT_ATTEMPTED_NO_LOCATION");
  });

  const emptyPath = deliverSigReading(r, { path: "" });
  check("an empty-string path is not accepted as a location", () => {
    assert.strictEqual(emptyPath.delivery.kind, "NOT_ATTEMPTED_NO_LOCATION");
  });

  check("the absence carries a reason, not a bare flag", () => {
    const d = noTarget.delivery;
    assert.strictEqual(d.kind, "NOT_ATTEMPTED_NO_LOCATION");
    if (d.kind === "NOT_ATTEMPTED_NO_LOCATION") {
      assert.strictEqual(d.detail, NO_LOCATION_DETAIL);
      assert.ok(d.detail.includes("NO PARTY OUTSIDE THIS PROCESS WAS TOLD ANYTHING"));
      assert.ok(d.detail.includes("deliberately no default path"));
    }
  });

  // CHANGED 2026-08-10, the residual-wiring round. This test previously
  // asserted the artifact still read `RESULT: SILENT` when no location was
  // injected. That assertion encoded exactly the behaviour this round exists
  // to remove: a silence that reached nobody, reported as silence. The
  // artifact is still rendered in full — that part of the old test was right
  // and is kept — but the verdict is now narrowed. See narrowing.test.ts.
  check("it is NOT a silent skip: the reading is still rendered in full", () => {
    assertFullArtifact(noTarget.artifact, "MICA/Sig");
    assert.ok(noTarget.artifact.includes("RESULT: CANNOT_ASSESS"));
    assert.ok(noTarget.artifact.includes("NARROWED BY A DELIVERY FAILURE"));
  });

  check("the artifact says its location is none, rather than inventing one", () => {
    assert.ok(
      noTarget.artifact.includes(
        "(none — no location was injected; see DELIVERY at the end of this file)"
      )
    );
    assert.ok(noTarget.artifact.includes("NO EXPORT LOCATION WAS INJECTED"));
  });

  check("and nothing was written anywhere — no default path was invented", () => {
    const before = require("fs").readdirSync(root).length;
    deliverSigReading(r);
    assert.strictEqual(require("fs").readdirSync(root).length, before);
  });
});

withDurable(HEALTHY, (l) => {
  const noTarget = deliverEngReading(assessEng(l, ENG_CFG));
  check("Eng behaves identically with no location injected", () => {
    assert.strictEqual(noTarget.delivery.kind, "NOT_ATTEMPTED_NO_LOCATION");
    assertFullArtifact(noTarget.artifact, "MICA/Eng");
  });
});

// A write that fails is also typed, and also not swallowed.
withDurable(CLEAN_SPECS, (l) => {
  const blocker = join(root, "blocker");
  writeFileSync(blocker, "not a directory", "utf8");
  const d = deliverSigReading(assessSig(l, SIG_CFG), {
    path: join(blocker, "child.txt"),
  });
  check("a failed write is reported as WRITE_FAILED, not as success or silence", () => {
    assert.strictEqual(d.delivery.kind, "WRITE_FAILED");
    if (d.delivery.kind === "WRITE_FAILED") {
      assert.ok(d.delivery.detail.length > 0);
    }
    assert.ok(d.artifact.includes("WRITE FAILED for"));
    assert.ok(d.artifact.includes("recorded as one rather than swallowed"));
  });
});

// ══ R2 — the presumption is STATED, in the artifact and in the scope print ═══

console.log("\n══ reader-competence presumption: stated, never tested ═══════");

withDurable(CLEAN_SPECS, (l) => {
  const t = writeSig(assessSig(l, SIG_CFG)).text;
  check("Sig's artifact states its presumption", () => {
    assert.ok(t.includes("READER COMPETENCE THIS INSTRUMENT PRESUMES (stated, never tested)"));
    assert.ok(t.includes("F1 SILENCE IS NOT A CLOCK-HONESTY FINDING"));
    assert.ok(t.includes("That the reader understands a DORMANT flag has read nothing"));
  });
  check("Sig's artifact carries the presumptions common to every sensor", () => {
    assert.ok(t.includes("That the reader treats CANNOT_ASSESS as a THIRD RESULT"));
    assert.ok(t.includes("That the reader understands this record was WRITTEN BY THE OBSERVED SYSTEM."));
  });
  check("the presumption is explicitly not a gate", () => {
    assert.ok(t.includes("Stated, never tested."));
    assert.ok(t.includes("nothing is withheld from a reader who lacks it"));
    assert.ok(t.includes("Certifying a reader belongs to the deployer or a governing body"));
  });
});

withDurable(HEALTHY, (l) => {
  const t = writeEng(assessEng(l, ENG_CFG)).text;
  check("Eng's artifact states its HEAVIER presumption, and says it is heavier", () => {
    assert.ok(t.includes("⚠ ENG PRESUMES MORE OF ITS READER THAN SIG DOES."));
    assert.ok(t.includes("THE LOAD-BEARING ONE — that the reader can tell A LOW SCORE from AN"));
    assert.ok(t.includes("EVIDENCE-FREE ONE."));
  });
  check("Eng names the specific statistical readings it presumes", () => {
    assert.ok(t.includes("PERMUTATION PERCENTILE"));
    assert.ok(t.includes("LEAVE-ONE-OUT TABLE"));
    assert.ok(t.includes("AN AGGREGATE CAN HIDE A DEAD SUBSYSTEM"));
  });
});

// The presumption must also reach printSigScope/printEngScope, per the brief.
{
  const lines: string[] = [];
  const realLog = console.log;
  console.log = (...args: unknown[]): void => {
    lines.push(args.map(String).join(" "));
  };
  try {
    printSigScope(GATE);
    printEngScope(GATE);
  } finally {
    console.log = realLog;
  }
  const printed = lines.join("\n");
  check("printSigScope() and printEngScope() both print the presumption", () => {
    assert.ok(printed.includes("READER COMPETENCE THIS INSTRUMENT PRESUMES (stated, never tested)"));
    assert.ok(printed.includes("F1 SILENCE IS NOT A CLOCK-HONESTY FINDING"));
    assert.ok(printed.includes("⚠ ENG PRESUMES MORE OF ITS READER THAN SIG DOES."));
  });
  check("the printed scope block and the artifact's scope block are the SAME text", () => {
    const t = withDurable(CLEAN_SPECS, (l) => writeSig(assessSig(l, SIG_CFG)).text);
    assert.ok(t.includes("F1 IS A SELF-CONSISTENCY CHECK, NOT A TRUTHFULNESS CHECK."));
    assert.ok(printed.includes("F1 IS A SELF-CONSISTENCY CHECK, NOT A TRUTHFULNESS CHECK."));
  });
}

// No predicate may exist in the competence module. This is the back door the
// canon's second fence names, and it is checked mechanically rather than
// trusted to review.
check("the competence module contains no predicate, gate or merit test", () => {
  const src = readFileSync(join(__dirname, "competence.ts"), "utf8");
  const code = src
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
  assert.ok(!/\bfunction\b/.test(code), "competence.ts declares a function");
  assert.ok(!/=>/.test(code), "competence.ts contains an arrow function");
  assert.ok(!/\bboolean\b/.test(code), "competence.ts mentions boolean");
  assert.ok(!/\bif\s*\(/.test(code), "competence.ts contains a branch");
});

// ══ §5 — the artifact must not overclaim ═════════════════════════════════════

console.log("\n══ the artifact does not claim independence ══════════════════");

withDurable(CLEAN_SPECS, (l) => {
  const t = writeSig(assessSig(l, SIG_CFG)).text;
  check("the artifact tells its reader it is NOT independent evidence", () => {
    assert.ok(t.includes("IT IS NOT INDEPENDENT EVIDENCE."));
    assert.ok(t.includes("Legibility to an outside reader is"));
    assert.ok(t.includes("NOT independence from the writer."));
  });
  check("it states the true, narrow width of what the export buys", () => {
    assert.ok(t.includes("It is not a defence."));
  });
  check("it does not claim tamper-resistance, separation, or custody", () => {
    for (const forbidden of [
      "harder to game",
      "tamper-proof",
      "out of reach",
      "cannot be altered",
      "independently authored",
    ]) {
      assert.ok(!t.includes(forbidden), `artifact claims "${forbidden}"`);
    }
    assert.ok(t.includes("Delivery is not custody"));
  });
});

// ══ SUBSTRATE CORRECTION · F7 — the export ledger shares the transaction contract ═
//
// The export ledger pushed a record into its chain BEFORE the durable append and
// swallowed a write error, returning an ordinary record with no persisted outcome
// — the same partial-commit shape as the chokepoint BLOCKER. It now: (1) appends
// durably before committing to the chain, (2) returns a typed persist outcome, and
// (3) lets a caller distinguish "artifact written" from "REACH record persisted".

console.log("\n══ F7 · export ledger — durable-before-commit + typed persist outcome ══");

check("F7 · a transient ledger append failure poisons nothing and reports persisted:false", () => {
  const path = join(root, `exledger-${counter++}.jsonl`);
  let failNext = true;
  const flaky = (p: string, line: string): void => {
    if (failNext) {
      failNext = false;
      throw new Error("transient ENOSPC");
    }
    require("fs").appendFileSync(p, line, "utf8");
  };
  const ledger = new ExportLedger({ path, appender: flaky });

  // First append FAILS: persisted:false, and the chain is NOT advanced.
  const a = ledger.append({ sensorId: "MICA/Sig", verdictKind: "SILENT", path: "/tmp/x", digest: "d0", bytes: 1 });
  assert.strictEqual(a.persisted, false, "the failed append did not persist");
  assert.strictEqual(ledger.length, 0, "the poisoned node was NOT left in the chain");

  // Second append SUCCEEDS and lands contiguously as seq 0.
  const b = ledger.append({ sensorId: "MICA/Sig", verdictKind: "SILENT", path: "/tmp/y", digest: "d1", bytes: 2 });
  assert.strictEqual(b.persisted, true, "the recovered append persisted");
  assert.strictEqual(ledger.length, 1);

  // Restart parity: a cold reload verifies, with only the recovered record.
  const reloaded = new ExportLedger({ path });
  assert.strictEqual(reloaded.getLoadState(), "LOADED_VERIFIED");
  assert.strictEqual(reloaded.length, 1);
  assert.strictEqual(reloaded.verify().valid, true);
  assert.strictEqual(reloaded.getAll()[0].sequenceNumber, 0);
  assert.strictEqual(reloaded.getAll()[0].digest, "d1", "only the recovered record is on disk");
  rmSync(path, { force: true });
});

check("F7 · an artifact can be WRITTEN while its REACH record fails to persist — the two are distinct", () => {
  const alwaysFail = (): void => {
    throw new Error("ledger volume unmounted");
  };
  const ledger = new ExportLedger({
    path: join(root, `exledger-${counter++}.jsonl`),
    appender: alwaysFail,
  });
  const artifactPath = freshOut();
  const d = withDurable(CLEAN_SPECS, (l) =>
    deliverSigReading(assessSig(l, SIG_CFG), { path: artifactPath, ledger })
  );
  // The artifact genuinely landed on disk...
  assert.strictEqual(d.delivery.kind, "WRITTEN");
  assert.ok(existsSync(artifactPath));
  // ...but the REACH record did NOT persist, and the caller can tell.
  assert.strictEqual(d.ledgerPersisted, false, "the ledger append failed — record not durable");
  assert.strictEqual(ledger.length, 0, "and it left no phantom record in the chain");
});

check("F7 · with no ledger injected, ledgerPersisted is null (nothing was recorded)", () => {
  const d = withDurable(CLEAN_SPECS, (l) => deliverSigReading(assessSig(l, SIG_CFG), { path: freshOut() }));
  assert.strictEqual(d.ledgerPersisted, null);
  assert.strictEqual(d.ledgerRecord, null);
});

// ══ F8 · closed-shape loading — hostile valid JSON fails to CANNOT_VERIFY ═════

console.log("\n══ F8 · the export ledger rejects hostile valid JSON, not casts it ══");

check("F8 · an unknown verdictKind enum loads to CANNOT_VERIFY (not a cast)", () => {
  const path = join(root, `ex8-${counter++}.jsonl`);
  writeFileSync(
    path,
    JSON.stringify({ sensorId: "s", verdictKind: "MAYBE", path: "/x", digest: "d", bytes: 1, sequenceNumber: 0, previousHash: "", hash: "h" }) + "\n",
    "utf8"
  );
  const led = new ExportLedger({ path });
  assert.strictEqual(led.getLoadState(), "CANNOT_VERIFY");
  assert.strictEqual(led.length, 0);
  assert.ok((led.getLastError() ?? "").includes("schema"));
  rmSync(path, { force: true });
});

check("F8 · a non-numeric bytes field is rejected, not coerced", () => {
  const path = join(root, `ex8-${counter++}.jsonl`);
  writeFileSync(
    path,
    JSON.stringify({ sensorId: "s", verdictKind: "SILENT", path: "/x", digest: "d", bytes: "1", sequenceNumber: 0, previousHash: "", hash: "h" }) + "\n",
    "utf8"
  );
  assert.strictEqual(new ExportLedger({ path }).getLoadState(), "CANNOT_VERIFY");
  rmSync(path, { force: true });
});

// ── Show one artifact in full, so a reviewer sees what a reader sees ─────────

console.log("\n══ sample artifact (Sig, CANNOT_ASSESS — F2 dormant) ═════════\n");
withDurable(CLEAN_SPECS, (l) => {
  console.log(deliverSigReading(assessSig(l, { readableLoadStates: GATE, clockToleranceMs: 0 })).artifact);
});

rmSync(root, { recursive: true, force: true });


// -- XL-S103 · a look that was REFUSED is not a book that is ABSENT -----------
//
// The sixth book of the family repaired at S103, and the one the census could
// not see: this file carries a literal NUL byte, so grep skips it as binary and
// the S103 sweep passed over an unrepaired instance of the very defect it was
// closing. `load-site-guard.test.ts` reads with node for that reason.

check("XL-S103-1 · the look has three answers, and only ENOENT means absent", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-xl-look-"));
  const present = join(base, "present.jsonl");
  writeFileSync(present, "", "utf8");
  assert.deepStrictEqual(lookAtExportLedgerFile(present), { state: "PRESENT" });
  assert.deepStrictEqual(lookAtExportLedgerFile(join(base, "nope.jsonl")), { state: "ABSENT" });
  const refused = lookAtExportLedgerFile(join(base, "x".repeat(300)));
  assert.strictEqual(refused.state, "CANNOT_SEE", "a name too long read as merely absent");
  assert.ok(refused.state === "CANNOT_SEE" && refused.detail.includes("ENAMETOOLONG"));
  rmSync(base, { recursive: true, force: true });
});

check("XL-S103-2 · a ledger it CANNOT SEE loads to CANNOT_VERIFY, never to first boot", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-xl-cannotsee-"));
  const book = new ExportLedger({ path: join(base, "x".repeat(300)) });
  assert.strictEqual(
    book.getLoadState(),
    "CANNOT_VERIFY",
    "a ledger this process cannot look at came up as a first boot"
  );
  const detail = book.getLastError() ?? "";
  assert.ok(detail.includes("NOT the finding that it is absent"), detail);
  assert.ok(detail.includes("nothing was recorded as a first boot"), detail);
  rmSync(base, { recursive: true, force: true });
});

check("XL-S103-3 · THE REAL SHAPE — a directory whose execute bit is stripped", () => {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === 0 || uid === null) {
    console.log(
      "      NOT EXERCISED as this principal: a mode-based refusal cannot be " +
        "built for uid 0. XL-S103-1..2 cover the classification and the state."
    );
    return;
  }
  const base = mkdtempSync(join(tmpdir(), "mica-xl-noexec-"));
  const dir = join(base, "book");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "ledger.jsonl");
  writeFileSync(path, "", "utf8");
  chmodSync(dir, 0o600); // readable, NOT searchable
  try {
    const look = lookAtExportLedgerFile(path);
    assert.strictEqual(look.state, "CANNOT_SEE");
    assert.ok(look.state === "CANNOT_SEE" && look.detail.includes("EACCES"));
    const book = new ExportLedger({ path });
    assert.strictEqual(book.getLoadState(), "CANNOT_VERIFY");
    assert.ok((book.getLastError() ?? "").includes("EACCES"));
  } finally {
    chmodSync(dir, 0o700);
    rmSync(base, { recursive: true, force: true });
  }
});

// ══ T5 · F3's DISCLOSURE REACHES THE ARTIFACT ════════════════════════════════
//
// WHY THIS SECTION EXISTS. T3 put `clerkStampCoverage` and `f3Deviation` on
// `SigResult` and its ticket did not open `export/index.ts`, so the numbers
// existed and nobody printed them. The cold verifier graded that FAIL against
// T3's own condition 1 ("on SigResult AND in the export artifact"). A caller
// holding the in-process result could see the evidence; the outside reader,
// who has only this file, could not.
//
// THE MUTANT THESE CHECKS EXIST TO KILL: delete the two new blocks from
// `sigSections`. It compiles cleanly and every other test in this file still
// passes, because nothing else in the suite ever looked at the F3 footing.
// Each check below names the specific string whose absence is the kill.

console.log("\n══ T5 · the artifact PRINTS F3's coverage and margin ══════════");

const T5_STAMP_BASE = {
  clerk_id: "clerk-test",
  clerk_boot_id: "boot-test",
  separation: "SEPARATE_PROCESS" as const,
  intake: "SOCKET" as const,
};

/** Two writers, four records: w1 at seq 0 and 2, w2 at seq 1 and 3. */
const T5_SPECS: readonly Spec[] = [
  { timestamp: T0 + 1_000, moduleId: "w1", eventType: "a", outcome: "ok" },
  { timestamp: T0 + 2_000, moduleId: "w2", eventType: "b", outcome: "ok" },
  { timestamp: T0 + 3_000, moduleId: "w1", eventType: "a", outcome: "ok" },
  { timestamp: T0 + 4_000, moduleId: "w2", eventType: "b", outcome: "ok" },
];
// T8 · an ordinary carry names its chain, and an ordinary config expects it.
// A base injecting none would make every T5 scenario a refusal scenario, and
// these tests exist to tell tail from lag from hole from margin.
const T5_CHAIN_LIVE = "chain-LIVE";
const T5_CFG: SigConfig = {
  readableLoadStates: GATE,
  clockToleranceMs: 0,
  expectedChainIdentity: T5_CHAIN_LIVE,
};

function t5Stamps(
  // T8 · `noChain` is the EXPLICIT opt-out. Under T8 "no chain identity" is a
  // scenario, not a baseline — leaving it implicit is how every fixture in this
  // file would quietly have become a refusal fixture.
  specs: readonly {
    seq: number;
    clerkSeq: number;
    wall: number;
    chain?: string;
    noChain?: true;
  }[]
): ClerkClockSource {
  return specs.map((s) => ({
    ...T5_STAMP_BASE,
    // T6 · THE STAMP CARRIES THE RECORD'S OWN WRITER, because that is what the
    // carrier writes (`moduleId: record.moduleId`, mica-clerk-caller.ts:914). Until
    // T6 the join ignored this field, so these fixtures could name any writer and
    // still join. Under T6 a disagreeing stamp is DISCARDED and DISCLOSED, so a
    // fixture modelling an ORDINARY carry must agree. The DELIBERATE mismatch now
    // has its own scenario rather than being every fixture's incidental state.
    moduleId: s.seq % 2 === 0 ? "w1" : "w2",
    // T8 · defaulted to the live chain; `noChain` omits it deliberately.
    ...(s.noChain === true ? {} : { chainIdentity: s.chain ?? T5_CHAIN_LIVE }),
    sequenceNumber: s.seq,
    clerk_seq: s.clerkSeq,
    clerk_time: { wall_ms: s.wall, monotonic_ns: String(s.wall) },
  }));
}

// ── TAIL + LAG WITHIN THE BOUND + MARGIN — the ordinary day (T3 S3) ──────────
{
  const w = withDurable(T5_SPECS, (l) =>
    writeSig(
      assessSig(l, {
        ...T5_CFG,
        clerkClockSource: t5Stamps([
          { seq: 0, clerkSeq: 1, wall: 10_000 },
          { seq: 1, clerkSeq: 2, wall: 10_001 },
        ]),
        clerkStampLagBoundMs: 30_000,
        readAtMs: 20_001,
      })
    )
  );
  check("T5 · the artifact carries the F3 coverage block at all", () => {
    assert.ok(
      w.text.includes("WHAT F3 ACTUALLY COVERED"),
      "the coverage block is absent — the disclosure does not reach the reader"
    );
  });
  check("T5 · TAIL is printed by COUNT, not merely alluded to", () => {
    assert.ok(
      w.text.includes("STAMPED:  2 record(s) joined a stamp"),
      "the stamped count is not printed"
    );
    assert.ok(
      w.text.includes("TAIL:     2 record(s) sit ABOVE their own writer's stamped"),
      "the tail count is not printed"
    );
    assert.ok(w.text.includes("NOT charged"), "the tail's non-charge is not stated");
  });
  check("T5 · HOLE is printed even when it is ZERO — an absent hole is a reading", () => {
    assert.ok(
      w.text.includes("HOLE:     0 record(s) sit BELOW their own writer's mark"),
      "a zero hole count is not printed"
    );
    assert.ok(
      !w.text.includes("local sequenceNumber(s): ["),
      "no hole exists, so no hole sequence list may be printed"
    );
  });
  check("T5 · LAG prints the axis silence, the bound, and WHICH SIDE of it", () => {
    assert.ok(w.text.includes("LAG:      the axis last spoke at clerk wall_ms 10001"));
    assert.ok(w.text.includes("SILENT FOR 10000 ms"), "the axis silence is not printed");
    assert.ok(
      w.text.includes("declared clerkStampLagBoundMs of 30000 ms"),
      "the declared bound is not printed"
    );
    assert.ok(w.text.includes("WITHIN THE BOUND."), "which side of the bound is not stated");
  });
  check("T5 · CHAIN ATTRIBUTION is printed, with the unattributed count", () => {
    // ⛔ THIS SCENARIO IS NOW ITS OWN FIXTURE, AND THAT IS THE T8 CHANGE IN ONE
    // TEST. It used to ride the ordinary-day artifact above, because "no chain
    // identity" WAS the ordinary day. Under T8 an unattributed stamp is
    // REFUSED, so a fixture carrying two of them is no longer an ordinary day —
    // it is the pre-T8 stamps file, met by a post-T8 reader. The count printed
    // is the same number with the opposite meaning, and the export must still
    // print it: a refusal nobody can read is the defect this block exists for.
    const unattributed = withDurable(T5_SPECS, (l) =>
      writeSig(
        assessSig(l, {
          ...T5_CFG,
          clerkClockSource: t5Stamps([
            { seq: 0, clerkSeq: 1, wall: 10_000, noChain: true },
            { seq: 1, clerkSeq: 2, wall: 10_001, noChain: true },
          ]),
        })
      )
    );
    assert.ok(unattributed.text.includes("CHAIN ATTRIBUTION:"));
    assert.ok(
      unattributed.text.includes("2 stamp(s) carry NO chainIdentity at all"),
      "the unattributed count is not printed"
    );
    assert.ok(unattributed.text.includes("0 stamp(s) were REFUSED for naming another chain"));
  });
  check("T5 · the MARGIN is printed as a NUMBER, with its tolerance and its sign", () => {
    assert.ok(w.text.includes("F3's ORDER DEVIATION"), "the margin block is absent");
    assert.ok(
      w.text.includes("largest declared inversion: -1000 ms over 1 adjacent"),
      "the deviation number is not printed"
    );
    assert.ok(
      w.text.includes("tolerance it was measured against: 0 ms"),
      "the injected tolerance is not printed"
    );
    assert.ok(w.text.includes("MARGIN:   -1000 ms"), "the margin number is not printed");
    assert.ok(w.text.includes("NEGATIVE is headroom"), "the sign is not explained");
  });
  check("T5 · UNJOINABLE is printed, and is zero here", () => {
    assert.ok(w.text.includes("UNJOINABLE: 0 stamp(s) name a local sequenceNumber"));
  });
}

// ── A HOLE, NAMED BY SEQUENCE NUMBER (T3 S3b) ────────────────────────────────
{
  const w = withDurable(T5_SPECS, (l) =>
    writeSig(
      assessSig(l, {
        ...T5_CFG,
        clerkClockSource: t5Stamps([
          { seq: 1, clerkSeq: 1, wall: 10_000 },
          { seq: 2, clerkSeq: 2, wall: 10_001 },
          { seq: 3, clerkSeq: 3, wall: 10_002 },
        ]),
        clerkStampLagBoundMs: 30_000,
        readAtMs: 10_003,
      })
    )
  );
  check("T5 · a HOLE is printed by count AND by its local sequenceNumber", () => {
    assert.ok(
      w.text.includes("HOLE:     1 record(s) sit BELOW their own writer's mark"),
      "the hole count is not printed"
    );
    assert.ok(
      w.text.includes("local sequenceNumber(s): [0]"),
      "the skipped record is not named — a hole nobody can locate is not disclosed"
    );
  });
  check("T5 · a run that never compared a pair says the margin was NOT COMPUTED", () => {
    assert.ok(w.text.includes("F3's ORDER DEVIATION"));
    assert.ok(
      w.text.includes("not computed — F3 never got as far as comparing a pair"),
      "an uncomputed margin must say so, never print a zero"
    );
    assert.ok(!w.text.includes("MARGIN:"), "no margin number may be printed when none exists");
  });
}

// ── LAG NOT EVALUATED, AND WHICH OF THE THREE REASONS ────────────────────────
{
  const w = withDurable(T5_SPECS, (l) =>
    writeSig(
      assessSig(l, {
        ...T5_CFG,
        clerkClockSource: t5Stamps([
          { seq: 0, clerkSeq: 1, wall: 10_000 },
          { seq: 1, clerkSeq: 2, wall: 10_001 },
        ]),
        readAtMs: 20_001,
      })
    )
  );
  check("T5 · an unevaluated LAG is a FINDING, and names the missing input", () => {
    assert.ok(w.text.includes("LAG:      NOT EVALUATED this run"));
    assert.ok(
      w.text.includes("no clerkStampLagBoundMs was declared"),
      "which of the three reasons it was is not printed"
    );
    assert.ok(
      w.text.includes("FALSE HERE IS A FINDING, NOT A BLANK"),
      "an unevaluated bound must not read as a blank"
    );
    assert.ok(w.text.includes("declared bound: none declared"));
  });
}

// ── A REFUSED FOREIGN CHAIN, AND WRITERS NEVER REACHED (T3 S5) ───────────────
{
  const w = withDurable(T5_SPECS, (l) =>
    writeSig(
      assessSig(l, {
        ...T5_CFG,
        clerkClockSource: t5Stamps([
          { seq: 0, clerkSeq: 1, wall: 10_000, chain: "chain-RETIRED" },
          { seq: 1, clerkSeq: 2, wall: 10_001, chain: "chain-RETIRED" },
        ]),
        expectedChainIdentity: "chain-LIVE",
      })
    )
  );
  check("T5 · a REFUSED foreign chain is printed, and the identity is NAMED", () => {
    assert.ok(
      w.text.includes("2 stamp(s) were REFUSED for naming another chain"),
      "the refusal count is not printed"
    );
    assert.ok(
      w.text.includes("[chain-RETIRED]"),
      "the foreign chain identity is not named"
    );
  });
  check("T5 · WRITERS NEVER REACHED is printed and named, not folded into the tail", () => {
    assert.ok(
      w.text.includes("WRITERS NEVER REACHED: [w1, w2]"),
      "the unreached writers are not named"
    );
    assert.ok(
      w.text.includes("CANNOT TELL"),
      "the ceiling — never visited vs not caught up — is not printed"
    );
  });
}

// ── A NOT_CONFIGURED LEG PRINTS NOTHING NEW ──────────────────────────────────
//
// The block is deliberately gated on a source having been injected. A zeroed
// coverage over a scope nobody looked at reads as "nothing was missing", which
// is the fail-open the tail/hole split exists to prevent.
{
  const w = withDurable(CLEAN_SPECS, (l) => writeSig(assessSig(l, SIG_CFG)));
  check("T5 · no source injected: NO coverage or margin block is printed at all", () => {
    assert.ok(w.text.includes("WHAT F3 WAS GIVEN"), "the pre-T5 F3 block must remain");
    assert.ok(w.text.includes("(none injected"), "the pre-T5 dormant branch must remain");
    assert.ok(
      !w.text.includes("WHAT F3 ACTUALLY COVERED"),
      "a dormant leg must not print a zeroed coverage block"
    );
    assert.ok(
      !w.text.includes("F3's ORDER DEVIATION"),
      "a dormant leg must not print a margin block"
    );
  });
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
