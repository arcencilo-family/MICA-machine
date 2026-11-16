// ──────────────────────────────────────────────────────────────────────────────
// MICA — the residual, wired so it can bite
//   npx ts-node src/mica/narrowing.test.ts
//
// House style: standalone ts-node script, custom check() harness. No framework.
//
// TWO THINGS ARE UNDER TEST.
//
//   A · DELIVERY FAILURE AT WRITE TIME must change the verdict, ASYMMETRICALLY.
//       SILENT degrades to CANNOT_ASSESS. ALARM does not degrade at all. The
//       test that matters most here is the one that would catch a SYMMETRIC
//       implementation, because symmetric is the natural instinct and it fails
//       toward quiet.
//
//   B · DELETION AFTER WRITE must be detected, and the claim must fall. This is
//       the severance test (D8): break the named dependency deliberately and
//       show the claim come down. A dependency named without a passing
//       severance test does not satisfy D8.
//
// WHAT IS NOT UNDER TEST, because it is not true: that any of this prevents
// deletion, detects deletion in general, or gives any party independence from
// the observed system.
// ──────────────────────────────────────────────────────────────────────────────

import assert from "assert";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
  appendFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MicaFixtureLog } from "./fixture-log";
import { assessSig } from "./sig";
import { assessEng } from "./eng";
import type { PreconditionMap, SigConfig } from "./sig";
import type { EngConfig } from "./eng";
import {
  deliverSigReading,
  deliverEngReading,
  narrowForDelivery,
} from "./export";
import type { ExportOutcome } from "./export";
import {
  ExportLedger,
  verifyReach,
  digestOf,
  REACH_RESIDUAL_INVISIBLE,
} from "./export/ledger";
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

const root = mkdtempSync(join(tmpdir(), "mica-narrow-"));
let counter = 0;
const freshLog = (): string => join(root, `log-${counter++}.jsonl`);
const freshOut = (): string => join(root, `artifact-${counter++}.txt`);
const freshLedger = (): string => join(root, `ledger-${counter++}.jsonl`);

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

/** Both flags read; nothing found. The SILENT anchor. */
const CLEAN_SPECS: readonly Spec[] = [
  { timestamp: T0 + 0, eventType: "boot", outcome: "ok" },
  { timestamp: T0 + 10, eventType: "escalation_granted", outcome: "granted" },
  { timestamp: T0 + 20, eventType: "escalation_active", outcome: "active" },
  { timestamp: T0 + 20, eventType: "canary_check", outcome: "clean" },
  { timestamp: T0 + 30, eventType: "quarantine_entered", outcome: "entered" },
  { timestamp: T0 + 40, eventType: "quarantine_lifted", outcome: "lifted" },
];

/** An inverted clock pair. The ALARM anchor. */
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
};
const HEALTHY = specs(90, (i) =>
  i % 4 === 0 ? "deferred" : `verdict_class_${i % CLASSES.length}`
);
const FLATTENED = specs(60, () => "approved");

function blindClasses(v: SensorVerdict): string[] {
  assert.strictEqual(v.kind, "CANNOT_ASSESS", `expected CANNOT_ASSESS, got ${v.kind}`);
  return (v as CannotAssessVerdict).blindPaths.map((b) => b.class);
}

console.log("\nMICA — wiring the residual so it can bite\n");

// ══ A · THE ASYMMETRY ════════════════════════════════════════════════════════

console.log("\n══ A · delivery failure changes the verdict, asymmetrically ══");

// ── SILENT degrades ──────────────────────────────────────────────────────────

withDurable(CLEAN_SPECS, (log) => {
  const r = assessSig(log, SIG_CFG);
  assert.strictEqual(r.verdict.kind, "SILENT");

  const d = deliverSigReading(r); // no location injected
  check("SILENT + delivery failure -> CANNOT_ASSESS", () => {
    assert.strictEqual(r.verdict.kind, "SILENT", "the READING is still silent");
    assert.strictEqual(d.verdict.kind, "CANNOT_ASSESS", "the DELIVERED verdict is not");
    assert.strictEqual(d.narrowed, true);
  });
  check("the reason is typed NOT_DELIVERED — its own class", () => {
    assert.deepStrictEqual(blindClasses(d.verdict), ["NOT_DELIVERED"]);
  });
  check("the narrowed verdict says the scope WAS read, not that it could not be", () => {
    assert.ok(d.verdict.summary.includes("read its scope and found nothing"));
    assert.ok(d.verdict.summary.includes("REACHED NO PARTY OUTSIDE THE OBSERVED LOOP"));
    assert.ok(d.verdict.summary.includes("is NOT a claim that the scope could not be read"));
  });
  check("the pre-narrowing reading is preserved, not destroyed", () => {
    assert.ok(d.verdict.summary.includes("The reading verdict, before narrowing, was:"));
    assert.strictEqual(d.result.verdict.kind, "SILENT");
  });

  // The artifact must not tell the reader the instrument was blind. For a
  // delivery-narrowed run it was not: it read its scope perfectly well. The
  // generic CANNOT_ASSESS banner says "it could not look", which would be a
  // false sentence sitting directly above a summary that contradicts it.
  check("the artifact does NOT say the instrument could not look", () => {
    assert.ok(d.artifact.includes("RESULT: CANNOT_ASSESS — THE READING DID NOT REACH ANYONE"));
    assert.ok(d.artifact.includes("it is not a failure to read either"));
    assert.ok(!d.artifact.includes("THE INSTRUMENT DID NOT READ THIS."));
    assert.ok(!d.artifact.includes("This means it could"));
  });
  check("unread scopes and delivery failures are separate, accurate sections", () => {
    assert.ok(d.artifact.includes("SCOPES THE INSTRUMENT COULD NOT READ"));
    assert.ok(d.artifact.includes("(none — every scope this run attempted was read)"));
    assert.ok(d.artifact.includes("DELIVERY FAILURES — readings that reached nobody"));
    assert.ok(d.artifact.includes("NOT DELIVERED 1 of 1"));
  });
  check("the findings section explains the scope WAS read", () => {
    assert.ok(d.artifact.includes("The scope WAS read and nothing in it lowered the bound."));
  });
});

// A genuinely-unread run keeps the original banner, and reports no delivery
// failure when it was in fact delivered.
withDurable(CLEAN_SPECS, (log) => {
  const d = deliverSigReading(assessSig(log, { readableLoadStates: GATE, clockToleranceMs: 0 }), {
    path: freshOut(),
  });
  check("an unread-scope CANNOT_ASSESS keeps the 'could not look' banner", () => {
    assert.strictEqual(d.verdict.kind, "CANNOT_ASSESS");
    assert.ok(d.artifact.includes("THE INSTRUMENT DID NOT READ THIS."));
    assert.ok(d.artifact.includes("UNREAD SCOPE 1 of 1"));
    assert.ok(d.artifact.includes("(none — this reading was delivered)"));
  });
});

// A write that FAILS narrows the same way as a write never attempted.
withDurable(CLEAN_SPECS, (log) => {
  const blocker = join(root, "blocker-a");
  writeFileSync(blocker, "not a directory", "utf8");
  const d = deliverSigReading(assessSig(log, SIG_CFG), {
    path: join(blocker, "child.txt"),
  });
  check("SILENT + FAILED WRITE -> CANNOT_ASSESS, same as no location", () => {
    assert.strictEqual(d.delivery.kind, "WRITE_FAILED");
    assert.strictEqual(d.verdict.kind, "CANNOT_ASSESS");
    assert.deepStrictEqual(blindClasses(d.verdict), ["NOT_DELIVERED"]);
  });
});

// Eng behaves identically.
withDurable(HEALTHY, (log) => {
  const r = assessEng(log, ENG_CFG);
  assert.strictEqual(r.verdict.kind, "SILENT");
  const d = deliverEngReading(r);
  check("Eng: SILENT + delivery failure -> CANNOT_ASSESS", () => {
    assert.strictEqual(d.verdict.kind, "CANNOT_ASSESS");
    assert.deepStrictEqual(blindClasses(d.verdict), ["NOT_DELIVERED"]);
  });
});

// ── ALARM does NOT degrade. This is the test that catches symmetry. ──────────

withDurable(INVERTED, (log) => {
  const r = assessSig(log, SIG_CFG);
  assert.strictEqual(r.verdict.kind, "ALARM");

  const d = deliverSigReading(r); // delivery fails
  check("ALARM + delivery failure -> STILL ALARM", () => {
    assert.strictEqual(d.verdict.kind, "ALARM");
    assert.strictEqual(d.narrowed, false);
  });
  check("the alarm is byte-identical to the reading — not softened in any way", () => {
    assert.deepStrictEqual(d.verdict, r.verdict);
  });
  check("the delivery failure is still carried, as a typed field alongside", () => {
    assert.strictEqual(d.delivery.kind, "NOT_ATTEMPTED_NO_LOCATION");
  });
});

withDurable(FLATTENED, (log) => {
  const r = assessEng(log, ENG_CFG);
  assert.strictEqual(r.verdict.kind, "ALARM");
  const d = deliverEngReading(r);
  check("Eng: ALARM + delivery failure -> STILL ALARM, byte-identical", () => {
    assert.strictEqual(d.verdict.kind, "ALARM");
    assert.deepStrictEqual(d.verdict, r.verdict);
  });
});

// The general statement, over every fixture and every failure mode: NO delivery
// failure ever produces a verdict quieter than the reading. This is the test
// that would fail on a symmetric implementation.
{
  const LOUDNESS: Record<string, number> = {
    ALARM: 2,
    CANNOT_ASSESS: 1,
    SILENT: 0,
  };
  const failures: ExportOutcome[] = [
    { kind: "NOT_ATTEMPTED_NO_LOCATION", detail: "x" },
    { kind: "WRITE_FAILED", path: "/nowhere", detail: "y" },
  ];

  const readings: SensorVerdict[] = [];
  withDurable(CLEAN_SPECS, (l) => readings.push(assessSig(l, SIG_CFG).verdict));
  withDurable(INVERTED, (l) => readings.push(assessSig(l, SIG_CFG).verdict));
  withDurable(CLEAN_SPECS, (l) =>
    readings.push(assessSig(l, { readableLoadStates: GATE, clockToleranceMs: 0 }).verdict)
  );
  withDurable(HEALTHY, (l) => readings.push(assessEng(l, ENG_CFG).verdict));
  withDurable(FLATTENED, (l) => readings.push(assessEng(l, ENG_CFG).verdict));
  withDurable(HEALTHY, (l) => readings.push(assessEng(l, { readableLoadStates: GATE }).verdict));

  check("NO delivery failure ever yields a QUIETER verdict than the reading", () => {
    for (const reading of readings) {
      for (const f of failures) {
        const out = narrowForDelivery(reading, f);
        assert.ok(
          LOUDNESS[out.kind] >= LOUDNESS[reading.kind],
          `${reading.kind} + ${f.kind} produced quieter ${out.kind}`
        );
      }
    }
  });
  check("and an ALARM is never converted to anything else at all", () => {
    for (const reading of readings.filter((v) => v.kind === "ALARM")) {
      for (const f of failures) {
        assert.deepStrictEqual(narrowForDelivery(reading, f), reading);
      }
    }
  });
  check("a successful delivery never changes any verdict", () => {
    for (const reading of readings) {
      const out = narrowForDelivery(reading, {
        kind: "WRITTEN",
        path: "/somewhere",
        bytes: 1,
      });
      assert.strictEqual(out, reading);
    }
  });
}

// ── CANNOT_ASSESS from delivery vs CANNOT_ASSESS from unreadable input ──────

console.log("\n══ the two CANNOT_ASSESS are distinguishable ═════════════════");

withDurable(CLEAN_SPECS, (log) => {
  const fromDelivery = deliverSigReading(assessSig(log, SIG_CFG)).verdict;

  const p = freshLog();
  const unreadable = new MicaFixtureLog({ path: p }); // FIRST_BOOT_OR_ERASED
  const fromInput = deliverSigReading(assessSig(unreadable, SIG_CFG), {
    path: freshOut(),
  }).verdict;
  rmSync(p, { force: true });

  check("[NOT_DELIVERED] vs [NON_CLEAN_LOAD_STATE] — different classes", () => {
    assert.strictEqual(fromDelivery.kind, "CANNOT_ASSESS");
    assert.strictEqual(fromInput.kind, "CANNOT_ASSESS");
    assert.deepStrictEqual(blindClasses(fromDelivery), ["NOT_DELIVERED"]);
    assert.deepStrictEqual(blindClasses(fromInput), ["NON_CLEAN_LOAD_STATE"]);
  });
  check("a consumer can tell them apart WITHOUT parsing prose", () => {
    const classOf = (v: SensorVerdict): string => blindClasses(v)[0];
    assert.notStrictEqual(classOf(fromDelivery), classOf(fromInput));
  });
  check("the third case — nothing found — is a different kind entirely", () => {
    const delivered = deliverSigReading(assessSig(log, SIG_CFG), {
      path: freshOut(),
    }).verdict;
    assert.strictEqual(delivered.kind, "SILENT");
  });
});

// A CANNOT_ASSESS reading that also fails to deliver carries BOTH reasons.
withDurable(CLEAN_SPECS, (log) => {
  const d = deliverSigReading(assessSig(log, { readableLoadStates: GATE, clockToleranceMs: 0 }));
  check("CANNOT_ASSESS + delivery failure keeps its own reason AND adds the new one", () => {
    assert.strictEqual(d.verdict.kind, "CANNOT_ASSESS");
    assert.deepStrictEqual(blindClasses(d.verdict), [
      "MISSING_CONFIGURATION",
      "NOT_DELIVERED",
    ]);
  });
});

// ── The pull is final ────────────────────────────────────────────────────────

console.log("\n══ the pull is final — nothing re-raises a narrowed run ═══════");

withDurable(CLEAN_SPECS, (log) => {
  const r = assessSig(log, SIG_CFG);
  const d = deliverSigReading(r);

  check("the narrowed verdict cannot be re-raised by re-rendering", () => {
    assert.ok(!d.artifact.includes("RESULT: SILENT"));
    assert.ok(d.artifact.includes("RESULT: CANNOT_ASSESS"));
  });
  check("re-narrowing an already-narrowed verdict never returns SILENT", () => {
    let v: SensorVerdict = d.verdict;
    for (let i = 0; i < 5; i++) {
      v = narrowForDelivery(v, { kind: "WRITTEN", path: "/x", bytes: 1 });
      assert.notStrictEqual(v.kind, "SILENT");
    }
  });
  check("a LATER successful delivery is a NEW run, not a repair of this one", () => {
    const second = deliverSigReading(r, { path: freshOut() });
    assert.strictEqual(second.verdict.kind, "SILENT", "the new run stands on its own");
    assert.strictEqual(d.verdict.kind, "CANNOT_ASSESS", "the old run is unchanged");
  });
  check("the artifact states the narrowing is final", () => {
    assert.ok(d.artifact.includes("AND THE NARROWING IS FINAL."));
    assert.ok(d.artifact.includes("It does not repair this one"));
  });
});

// ══ B · SEVERANCE (D8) — the round's central test ════════════════════════════

console.log("\n══ B · SEVERANCE: delete the artifact, watch REACH fall ══════");

{
  const ledgerPath = freshLedger();
  const artifactPath = freshOut();

  withDurable(CLEAN_SPECS, (log) => {
    // Step 1 — a real delivery, recorded.
    const writer = new ExportLedger({ path: ledgerPath });
    const d = deliverSigReading(assessSig(log, SIG_CFG), {
      path: artifactPath,
      ledger: writer,
    });

    check("severance step 1: the artifact is delivered and recorded", () => {
      assert.strictEqual(d.delivery.kind, "WRITTEN");
      assert.strictEqual(d.verdict.kind, "SILENT");
      assert.ok(existsSync(artifactPath));
      assert.ok(d.ledgerRecord !== null);
    });

    // Step 2 — the claim stands while the dependency holds.
    const before = verifyReach(new ExportLedger({ path: ledgerPath }));
    check("severance step 2: with the artifact present, REACH is NOT_CONTRADICTED", () => {
      assert.strictEqual(before.kind, "NOT_CONTRADICTED");
      assert.strictEqual(before.claims.length, 1);
      assert.strictEqual(before.claims[0].state, "PRESENT_MATCHING");
      assert.deepStrictEqual(before.blindPaths, []);
    });

    // Step 3 — SEVER. This is the whole point: rm is silent and free.
    rmSync(artifactPath, { force: true });
    check("severance step 3: the dependency is actually severed", () => {
      assert.ok(!existsSync(artifactPath));
    });

    // Step 4 — the claim must come down.
    const after = verifyReach(new ExportLedger({ path: ledgerPath }));
    check("severance step 4: REACH FALLS to CANNOT_ASSESS", () => {
      assert.strictEqual(after.kind, "CANNOT_ASSESS");
      assert.strictEqual(after.claims[0].kind, "CANNOT_ASSESS");
      assert.strictEqual(after.claims[0].state, "MISSING");
    });
    check("severance step 4: the reason is typed NOT_DELIVERED", () => {
      assert.deepStrictEqual(
        after.blindPaths.map((b) => b.class),
        ["NOT_DELIVERED"]
      );
    });
    check("severance step 4: and it attributes NOTHING", () => {
      const detail = after.blindPaths[0].detail;
      assert.ok(detail.includes("IS NOT KNOWN AND IS NOT GUESSED"));
      assert.ok(detail.includes("NOT a finding about the observed"));
      for (const forbidden of ["deleted by", "attacker", "malicious", "tampered by"]) {
        assert.ok(!detail.includes(forbidden), `attributes: ${forbidden}`);
      }
    });
  });
}

// ── truncation and alteration ────────────────────────────────────────────────

{
  const ledgerPath = freshLedger();
  const artifactPath = freshOut();
  withDurable(CLEAN_SPECS, (log) => {
    const writer = new ExportLedger({ path: ledgerPath });
    deliverSigReading(assessSig(log, SIG_CFG), {
      path: artifactPath,
      ledger: writer,
    });
    truncateSync(artifactPath, 100);
    const v = verifyReach(new ExportLedger({ path: ledgerPath }));
    check("a TRUNCATED artifact is detected and narrows the claim", () => {
      assert.strictEqual(v.kind, "CANNOT_ASSESS");
      assert.strictEqual(v.claims[0].state, "SIZE_MISMATCH");
    });
  });
}

{
  const ledgerPath = freshLedger();
  const artifactPath = freshOut();
  withDurable(CLEAN_SPECS, (log) => {
    const writer = new ExportLedger({ path: ledgerPath });
    const d = deliverSigReading(assessSig(log, SIG_CFG), {
      path: artifactPath,
      ledger: writer,
    });
    // Same length, different content: the size check alone would miss this.
    const original = readFileSync(artifactPath, "utf8");
    const swapped = original.replace("RESULT: SILENT", "RESULT: QUIET!");
    assert.strictEqual(
      Buffer.byteLength(swapped, "utf8"),
      Buffer.byteLength(original, "utf8"),
      "fixture must preserve length to exercise the digest"
    );
    writeFileSync(artifactPath, swapped, "utf8");

    const v = verifyReach(new ExportLedger({ path: ledgerPath }));
    check("an ALTERED artifact of the SAME LENGTH is caught by the digest", () => {
      assert.strictEqual(v.kind, "CANNOT_ASSESS");
      assert.strictEqual(v.claims[0].state, "DIGEST_MISMATCH");
      assert.strictEqual(d.ledgerRecord?.digest, digestOf(original));
    });
  });
}

// ── the ledger's own integrity, and its load state ──────────────────────────

console.log("\n══ the ledger is itself append-only and hash-chained ═════════");

{
  const ledgerPath = freshLedger();
  withDurable(CLEAN_SPECS, (log) => {
    const writer = new ExportLedger({ path: ledgerPath });
    deliverSigReading(assessSig(log, SIG_CFG), {
      path: freshOut(),
      ledger: writer,
    });
    deliverSigReading(assessSig(log, SIG_CFG), {
      path: freshOut(),
      ledger: writer,
    });

    const reloaded = new ExportLedger({ path: ledgerPath });
    check("the ledger reloads, verifies, and chains its records", () => {
      assert.strictEqual(reloaded.getLoadState(), "LOADED_VERIFIED");
      assert.strictEqual(reloaded.length, 2);
      assert.strictEqual(reloaded.verify().valid, true);
      assert.strictEqual(
        reloaded.getAll()[1].previousHash,
        reloaded.getAll()[0].hash
      );
    });
    check("both artifacts verify while both are present", () => {
      assert.strictEqual(verifyReach(reloaded).kind, "NOT_CONTRADICTED");
    });
  });

  // Edit a recorded digest on disk: the chain must refuse the whole ledger.
  const raw = readFileSync(ledgerPath, "utf8").split("\n").filter((l) => l.length > 0);
  const tampered = JSON.parse(raw[0]) as { digest: string };
  tampered.digest = "0".repeat(64);
  writeFileSync(ledgerPath, [JSON.stringify(tampered), raw[1]].join("\n") + "\n", "utf8");

  const broken = new ExportLedger({ path: ledgerPath });
  check("a tampered ledger record breaks the chain and offers NO claim", () => {
    assert.strictEqual(broken.verify().valid, false);
    const v = verifyReach(broken);
    assert.strictEqual(v.kind, "CANNOT_ASSESS");
    assert.strictEqual(v.ledgerIntegrity, "BROKEN");
    assert.deepStrictEqual(v.blindPaths.map((b) => b.class), ["BROKEN_CHAIN"]);
    assert.strictEqual(v.claims.length, 0, "no per-run claim on an untrusted ledger");
  });
}

// An appended-but-unchained record is also caught.
{
  const ledgerPath = freshLedger();
  withDurable(CLEAN_SPECS, (log) => {
    const writer = new ExportLedger({ path: ledgerPath });
    deliverSigReading(assessSig(log, SIG_CFG), { path: freshOut(), ledger: writer });
    appendFileSync(
      ledgerPath,
      JSON.stringify({
        sensorId: "MICA/Sig",
        verdictKind: "SILENT",
        path: "/invented",
        digest: "f".repeat(64),
        bytes: 1,
        sequenceNumber: 1,
        previousHash: "not-the-real-hash",
        hash: "also-invented",
      }) + "\n",
      "utf8"
    );
    check("a forged ledger entry does not chain and is rejected", () => {
      const l = new ExportLedger({ path: ledgerPath });
      assert.strictEqual(l.verify().valid, false);
      assert.strictEqual(verifyReach(l).kind, "CANNOT_ASSESS");
    });
  });
}

// An in-memory ledger, or an absent one, cannot support a claim either.
{
  check("an IN_MEMORY ledger supports no REACH claim (integrity, not provenance)", () => {
    const l = new ExportLedger();
    const v = verifyReach(l);
    assert.strictEqual(v.kind, "CANNOT_ASSESS");
    assert.strictEqual(v.ledgerLoadState, "IN_MEMORY");
    assert.deepStrictEqual(v.blindPaths.map((b) => b.class), ["NON_CLEAN_LOAD_STATE"]);
  });
  check("an ERASED ledger file is not read as 'nothing was ever written'", () => {
    const p = freshLedger();
    writeFileSync(p, "", "utf8");
    const v = verifyReach(new ExportLedger({ path: p }));
    assert.strictEqual(v.kind, "CANNOT_ASSESS");
    assert.ok(v.blindPaths[0].detail.includes("not evidence that nothing was written"));
  });
}


// ── XR-S104 · "gone" and "I could not look" are not the same finding ─────────
//
// `checkOne` opened `if (!existsSync(record.path)) -> MISSING`, and MISSING says
// "no file is there now" — an assertion about the world. existsSync returns
// false for "not there" AND for "not allowed to look", so an artifact this
// process merely could not traverse to was reported as one that had been
// REMOVED. On a REACH claim that is the worst available direction: the claim is
// that a party OUTSIDE the loop can read the finding, and a permission fault on
// THIS side was arriving as evidence about THEIR side.

{
  const ledgerPath = freshLedger();
  const artifactDir = join(root, `xr-s104-${Date.now()}`);
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, "reading.txt");

  withDurable(CLEAN_SPECS, (log) => {
    const writer = new ExportLedger({ path: ledgerPath });
    deliverSigReading(assessSig(log, SIG_CFG), { path: artifactPath, ledger: writer });

    check("XR-S104-1 · with the artifact present the claim stands", () => {
      const v = verifyReach(new ExportLedger({ path: ledgerPath }));
      assert.strictEqual(v.kind, "NOT_CONTRADICTED");
      assert.strictEqual(v.claims[0].state, "PRESENT_MATCHING");
    });

    check("XR-S104-2 · THE REAL SHAPE — unreachable reads UNREADABLE, never MISSING", () => {
      const uid = typeof process.getuid === "function" ? process.getuid() : null;
      if (uid === 0 || uid === null) {
        console.log(
          "      NOT EXERCISED as this principal: a mode-based refusal cannot be " +
            "built for uid 0. XR-S104-3 covers the genuinely-absent branch for all."
        );
        return;
      }
      chmodSync(artifactDir, 0o600); // readable, NOT searchable
      try {
        const v = verifyReach(new ExportLedger({ path: ledgerPath }));
        assert.strictEqual(v.kind, "CANNOT_ASSESS");
        assert.strictEqual(
          v.claims[0].state,
          "UNREADABLE",
          "an artifact behind a stripped execute bit was reported as REMOVED"
        );
        assert.ok(
          v.claims[0].detail.includes("THIS IS NOT THE FINDING THAT IT IS GONE"),
          v.claims[0].detail
        );
        assert.ok(v.claims[0].detail.includes("EACCES"), v.claims[0].detail);
      } finally {
        chmodSync(artifactDir, 0o700);
      }
    });

    check("XR-S104-3 · a genuinely removed artifact still reads MISSING", () => {
      // The other half: the repair must not have bought its honesty by going
      // vague. ENOENT is still, and only, MISSING.
      rmSync(artifactPath, { force: true });
      const v = verifyReach(new ExportLedger({ path: ledgerPath }));
      assert.strictEqual(v.kind, "CANNOT_ASSESS");
      assert.strictEqual(v.claims[0].state, "MISSING");
      assert.ok(v.claims[0].detail.includes("no file is there now"));
    });
  });
}

// ── delivery succeeded but no ledger was injected ───────────────────────────

withDurable(CLEAN_SPECS, (log) => {
  const d = deliverSigReading(assessSig(log, SIG_CFG), { path: freshOut() });
  check("no ledger injected: the verdict is NOT narrowed — delivery did happen", () => {
    assert.strictEqual(d.verdict.kind, "SILENT");
    assert.strictEqual(d.narrowed, false);
    assert.strictEqual(d.ledgerRecord, null);
  });
  check("but the artifact says plainly that nothing will detect a later change", () => {
    assert.ok(d.artifact.includes("NO EXPORT LEDGER WAS INJECTED"));
    assert.ok(d.artifact.includes("NOTHING WILL DETECT THAT"));
  });
});

// ── the byte count the ledger records must be the bytes on disk ─────────────

withDurable(CLEAN_SPECS, (log) => {
  const p = freshOut();
  const writer = new ExportLedger({ path: freshLedger() });
  const d = deliverSigReading(assessSig(log, SIG_CFG), { path: p, ledger: writer });
  check("the recorded byte count equals the file's actual size on disk", () => {
    const actual = Buffer.byteLength(readFileSync(p, "utf8"), "utf8");
    assert.strictEqual(d.ledgerRecord?.bytes, actual);
    assert.strictEqual(d.delivery.kind, "WRITTEN");
    if (d.delivery.kind === "WRITTEN") assert.strictEqual(d.delivery.bytes, actual);
  });
  check("the recorded digest equals the digest of the file on disk", () => {
    assert.strictEqual(d.ledgerRecord?.digest, digestOf(readFileSync(p, "utf8")));
  });
});

// ══ R3 — the invisible remainder, stated narrowly ════════════════════════════

console.log("\n══ R3 · what stays invisible, and only that ══════════════════");

check("the invisible remainder is stated, and is exactly two items", () => {
  const text = REACH_RESIDUAL_INVISIBLE.join("\n");
  assert.ok(text.includes("AN ARTIFACT DELETED WHERE NO VERIFY PASS IS EVER RUN AGAIN"));
  assert.ok(text.includes("AN EXPORT THAT WAS NEVER RECORDED"));
  assert.ok(text.includes("BY CONSTRUCTION and not for"));
});
check("it does NOT claim class-(ii) standing for deletion in general", () => {
  const text = REACH_RESIDUAL_INVISIBLE.join("\n");
  assert.ok(text.includes("EVERYTHING ELSE ABOUT DELETION IS VISIBLE AND IS CHECKED"));
  assert.ok(text.includes("deliberately not one"));
});
check("and the artifact carries it to the outside reader", () => {
  withDurable(CLEAN_SPECS, (log) => {
    const d = deliverSigReading(assessSig(log, SIG_CFG), { path: freshOut() });
    assert.ok(d.artifact.includes("WHAT THE VERIFY PASS CANNOT REACH, STATED NARROWLY."));
  });
});

// ══ §5 — no overclaiming, anywhere ═══════════════════════════════════════════

console.log("\n══ the round does not overclaim ══════════════════════════════");

{
  const ledgerPath = freshLedger();
  const artifactPath = freshOut();
  withDurable(CLEAN_SPECS, (log) => {
    const writer = new ExportLedger({ path: ledgerPath });
    deliverSigReading(assessSig(log, SIG_CFG), {
      path: artifactPath,
      ledger: writer,
    });
    rmSync(artifactPath, { force: true });
    const v = verifyReach(new ExportLedger({ path: ledgerPath }));
    const allText = [v.summary, ...v.blindPaths.map((b) => b.detail), ...v.claims.map((c) => c.detail)].join("\n");

    check("no emitted string claims prevention, tamper-proofing or general detection", () => {
      for (const forbidden of [
        "tamper-proof",
        "prevents",
        "prevented",
        "cannot be deleted",
        "harder to game",
        "independent",
        "separation",
      ]) {
        assert.ok(!allText.includes(forbidden), `overclaims: ${forbidden}`);
      }
    });
    check("a passing check is NOT_CONTRADICTED, never 'verified' or 'healthy'", () => {
      // A genuinely passing verification: artifact present and matching.
      const lp = freshLedger();
      const ap = freshOut();
      const w = new ExportLedger({ path: lp });
      deliverSigReading(assessSig(log, SIG_CFG), { path: ap, ledger: w });
      const ok = verifyReach(new ExportLedger({ path: lp }));
      assert.strictEqual(ok.kind, "NOT_CONTRADICTED");
      const text = `${ok.summary} ${ok.claims.map((c) => c.detail).join(" ")}`;
      assert.ok(!/\bhealthy\b/i.test(text));
      assert.ok(text.includes("NOT CONTRADICTED, which is not the same as verified"));
      assert.ok(text.includes("nothing at all about the observed system"));
    });
    check("an empty ledger is not read as a pass", () => {
      const ok = verifyReach(new ExportLedger({ path: freshLedger() }));
      assert.strictEqual(ok.kind, "CANNOT_ASSESS");
      assert.ok(!allText.toLowerCase().includes("healthy"));
    });
  });
}

// ── show one narrowed reading, so a reviewer sees what a reader sees ────────

console.log("\n══ sample: a SILENT reading that reached nobody ══════════════\n");
withDurable(CLEAN_SPECS, (log) => {
  const d = deliverSigReading(assessSig(log, SIG_CFG));
  const lines = d.artifact.split("\n");
  const start = lines.findIndex((l) => l.includes("RESULT:"));
  console.log(lines.slice(start - 1, start + 12).join("\n"));
});

rmSync(root, { recursive: true, force: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
