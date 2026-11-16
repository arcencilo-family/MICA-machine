// ── MICA · floor-trail ledger, graded against T1 ─────────────────────────────
//   npx ts-node src/mica/chokepoint/floor-trail.test.ts

import assert from "assert";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";

import { lookAtFloorTrailFile, cannotSeeFloorTrailMessage } from "./floor-trail";
import { join } from "path";

import { alarm, cannotAssess, silent } from "../types";
import {
  Chokepoint,
  ChokepointLedger,
  FloorTrail,
  decideChokepoint,
} from "./index";
import {
  canonicalHeadDropBytes,
  COMMIT_IS_NOT_RETENTION,
  fileDropHeadCommitter,
  HEAD_COMMIT_IS_NOT_A_GATE,
  HEAD_DROP_FILE_MODE,
} from "./floor-trail";
import type { HeadCommit } from "./floor-trail";
import type {
  ChokepointDisposition,
  FloorTrailRecord,
  FloorTrailRecordInput,
  ProposedAction,
  StakesLine,
} from "./index";

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

const root = mkdtempSync(join(tmpdir(), "mica-floor-trail-"));
let counter = 0;
const fresh = (stem = "trail"): string =>
  join(root, `${stem}-${counter++}.jsonl`);
const A = (id: string): ProposedAction => ({ id });

const LINE: StakesLine = {
  classes: ["low", "high"],
  holdAtOrAbove: "high",
};
const SILENT_A = silent("sensor-a", "no finding");
const SILENT_B = silent("sensor-b", "no finding");
const ALARM_C = alarm("sensor-c", "adverse", [
  { code: "C", detail: "adverse reading" },
]);
const BLIND_B = cannotAssess("sensor-b", [
  { class: "MISSING_CONFIGURATION", detail: "missing declaration" },
]);

function input(
  actionId: string,
  disposition: ChokepointDisposition,
  timestamp: number
): FloorTrailRecordInput {
  const floorKind =
    disposition === "HOLD"
      ? "ALARM"
      : disposition === "RELEASE"
        ? "SILENT"
        : "CANNOT_ASSESS";
  return {
    timestamp,
    actionId,
    disposition,
    floorKind,
    blindSplit:
      disposition === "PASS_BLIND"
        ? "BELOW_LINE"
        : disposition === "HOLD_BLIND"
          ? "ABOVE_LINE"
          : "NOT_APPLICABLE",
    impactClass:
      disposition === "PASS_BLIND"
        ? "low"
        : disposition === "HOLD_BLIND"
          ? "high"
          : "",
    sensorIds: "sensor-a|sensor-b",
    sensorKinds: `${floorKind}|SILENT`,
  };
}

console.log("\nMICA — the floor-trail ledger (T1)\n");

check("mixed dispositions form a valid append-only hash chain", () => {
  const trail = new FloorTrail({ path: fresh() });
  const dispositions: ChokepointDisposition[] = [
    "RELEASE",
    "HOLD",
    "HOLD_BLIND",
    "PASS_BLIND",
  ];
  dispositions.forEach((d, i) => {
    assert.strictEqual(trail.record(input(`a-${i}`, d, 100 + i)).persisted, true);
  });
  assert.strictEqual(trail.length, 4);
  assert.deepStrictEqual(trail.verify(), { valid: true, brokenAt: null });
  assert.deepStrictEqual(
    trail.getAll().map((record) => record.sequenceNumber),
    [0, 1, 2, 3]
  );
});

check("tampering a record byte breaks the chain at that record", () => {
  const path = fresh();
  const trail = new FloorTrail({ path });
  trail.record(input("untouched", "RELEASE", 1));
  trail.record(input("tamper-me", "HOLD", 2));
  trail.record(input("tail", "HOLD_BLIND", 3));
  const tampered = readFileSync(path, "utf8").replace("tamper-me", "tamper-xx");
  writeFileSync(path, tampered, "utf8");
  const loaded = new FloorTrail({ path });
  assert.strictEqual(loaded.getLoadState(), "CANNOT_VERIFY");
  assert.deepStrictEqual(loaded.verify(), { valid: false, brokenAt: 1 });
});

check("all four raw dispositions append exactly one faithful trail record", () => {
  const cases = [
    { id: "release", verdicts: [SILENT_A, SILENT_B], stakes: null },
    { id: "hold", verdicts: [SILENT_A, ALARM_C], stakes: null },
    { id: "hold-blind", verdicts: [SILENT_A, BLIND_B], stakes: { impactClass: "high" } },
    { id: "pass-blind", verdicts: [SILENT_A, BLIND_B], stakes: { impactClass: "low" } },
  ] as const;

  for (const c of cases) {
    const trail = new FloorTrail({ path: fresh() });
    const cp = new Chokepoint({
      line: LINE,
      floorTrail: trail,
      decisionClock: () => 4242,
      ledger: new ChokepointLedger({ path: fresh("pass") }),
    });
    const expected = decideChokepoint(A(c.id), c.verdicts, c.stakes, LINE);
    const result = cp.guard(A(c.id), c.verdicts, c.stakes);
    assert.strictEqual(trail.length, 1, `${c.id}: one decision must mean one entry`);
    const record = trail.getAll()[0];
    assert.strictEqual(record.timestamp, 4242);
    assert.strictEqual(record.disposition, expected.disposition);
    assert.strictEqual(record.floorKind, expected.floorKind);
    assert.strictEqual(record.blindSplit, expected.blindSplit);
    assert.strictEqual(record.sensorIds, expected.sensorIds.join("|"));
    assert.strictEqual(record.sensorKinds, expected.sensorKinds.join("|"));
    assert.strictEqual(result.floorTrailRecord, record);
    assert.strictEqual(result.floorTrailRecorded, true);
  }
});

check("sensor ids and kinds remain in lockstep for three mixed sensors", () => {
  const trail = new FloorTrail({ path: fresh() });
  const cp = new Chokepoint({
    line: LINE,
    floorTrail: trail,
    decisionClock: () => 7,
  });
  const result = cp.guard(A("order"), [SILENT_A, BLIND_B, ALARM_C], {
    impactClass: "low",
  });
  const record = trail.getAll()[0];
  assert.strictEqual(record.sensorIds, "sensor-a|sensor-b|sensor-c");
  assert.strictEqual(record.sensorKinds, "SILENT|CANNOT_ASSESS|ALARM");
  assert.deepStrictEqual(record.sensorIds.split("|").map((id, i) => [id, record.sensorKinds.split("|")[i]]), [
    ["sensor-a", "SILENT"],
    ["sensor-b", "CANNOT_ASSESS"],
    ["sensor-c", "ALARM"],
  ]);
  assert.strictEqual(result.decision.floorKind, "ALARM");
});

check("an injected append failure never produces execution, exhaustively", () => {
  const cases = [
    { raw: "RELEASE", verdicts: [SILENT_A], stakes: null },
    { raw: "HOLD", verdicts: [ALARM_C], stakes: null },
    { raw: "HOLD_BLIND", verdicts: [BLIND_B], stakes: { impactClass: "high" } },
    { raw: "PASS_BLIND", verdicts: [BLIND_B], stakes: { impactClass: "low" } },
  ] as const;
  for (const c of cases) {
    const trail = new FloorTrail({
      path: fresh(),
      appender: () => {
        throw new Error("injected disk fault");
      },
    });
    const cp = new Chokepoint({
      line: LINE,
      floorTrail: trail,
      ledger: new ChokepointLedger({ path: fresh("pass") }),
    });
    const result = cp.guard(A(`fault-${c.raw}`), c.verdicts, c.stakes);
    assert.strictEqual(result.decision.disposition, c.raw);
    assert.strictEqual(result.execute, false, `${c.raw} executed after trail failure`);
    assert.strictEqual(result.floorTrailRecorded, false);
    assert.strictEqual(trail.length, 0, "failed append advanced the committed chain");
    if (c.raw === "RELEASE" || c.raw === "PASS_BLIND") {
      assert.strictEqual(result.disposition, "HOLD_BLIND");
    } else {
      assert.strictEqual(result.disposition, c.raw);
    }
    assert.ok(result.deliveryNote.includes("floor-trail"));
  }
});

console.log("\n══ corrective cut · an unwired trail is a cautious default, not a bypass ══");

check("an unwired trail narrows RELEASE to HOLD-BLIND with the cautious default stated", () => {
  const cp = new Chokepoint({ line: LINE });
  const result = cp.guard(A("unwired-release"), [SILENT_A], null);
  assert.strictEqual(result.decision.disposition, "RELEASE");
  assert.strictEqual(result.disposition, "HOLD_BLIND");
  assert.strictEqual(result.execute, false);
  assert.strictEqual(result.floorTrailRecord, null);
  assert.strictEqual(result.floorTrailRecorded, false);
  assert.strictEqual(result.floorTrailDetail, null);
  assert.ok(result.deliveryNote.includes("NO FLOOR TRAIL WAS WIRED"));
  assert.ok(result.deliveryNote.includes("cautious default"));
  assert.ok(result.deliveryNote.includes("issues no permit it cannot account for"));
});

check("an unwired trail narrows PASS-BLIND while its separate mandatory ledger record still persists", () => {
  const ledger = new ChokepointLedger({ path: fresh("pass") });
  const cp = new Chokepoint({ line: LINE, ledger });
  const result = cp.guard(A("unwired-pass"), [BLIND_B], {
    impactClass: "low",
  });
  assert.strictEqual(result.decision.disposition, "PASS_BLIND");
  assert.strictEqual(result.disposition, "HOLD_BLIND");
  assert.strictEqual(result.execute, false);
  assert.strictEqual(result.recorded, true, "the §5 PASS-BLIND ledger remains independent");
  assert.strictEqual(result.record?.actionId, "unwired-pass");
  assert.strictEqual(ledger.length, 1);
  assert.strictEqual(result.floorTrailRecord, null);
  assert.strictEqual(result.floorTrailRecorded, false);
  assert.strictEqual(result.floorTrailDetail, null);
  assert.ok(result.deliveryNote.includes("NO FLOOR TRAIL WAS WIRED"));
  assert.ok(result.deliveryNote.includes("cautious default"));
});

check("an unwired trail leaves HOLD and HOLD-BLIND unchanged and non-executing", () => {
  for (const c of [
    { raw: "HOLD", verdicts: [ALARM_C], stakes: null },
    { raw: "HOLD_BLIND", verdicts: [BLIND_B], stakes: { impactClass: "high" } },
  ] as const) {
    const result = new Chokepoint({ line: LINE }).guard(
      A(`unwired-${c.raw}`),
      c.verdicts,
      c.stakes
    );
    assert.strictEqual(result.decision.disposition, c.raw);
    assert.strictEqual(result.disposition, c.raw);
    assert.strictEqual(result.execute, false);
    assert.strictEqual(result.narrowed, false);
    assert.strictEqual(result.deliveryNote, "delivered.");
    assert.strictEqual(result.floorTrailRecord, null);
    assert.strictEqual(result.floorTrailDetail, null);
  }
});

check("an absent head committer never narrows a durable RELEASE", () => {
  const trail = new FloorTrail({ path: fresh() });
  const cp = new Chokepoint({
    line: LINE,
    floorTrail: trail,
    decisionClock: () => 88,
  });
  const result = cp.guard(A("wired-release"), [SILENT_A], null);
  assert.strictEqual(result.decision.disposition, "RELEASE");
  assert.strictEqual(result.disposition, "RELEASE");
  assert.strictEqual(result.execute, true);
  assert.strictEqual(result.floorTrailRecorded, true);
  assert.strictEqual(trail.length, 1);
  assert.strictEqual(trail.getAll()[0].actionId, "wired-release");
  assert.strictEqual(trail.getAll()[0].timestamp, 88);
  assert.match(HEAD_COMMIT_IS_NOT_A_GATE, /absent or failing witness narrows nothing/i);
});

check("an absent path reports IN_MEMORY and permits no executing raw disposition", () => {
  for (const c of [
    { id: "r", verdicts: [SILENT_A], stakes: null },
    { id: "p", verdicts: [BLIND_B], stakes: { impactClass: "low" } },
  ] as const) {
    const trail = new FloorTrail();
    const cp = new Chokepoint({
      line: LINE,
      floorTrail: trail,
      ledger: new ChokepointLedger({ path: fresh("pass") }),
    });
    const result = cp.guard(A(c.id), c.verdicts, c.stakes);
    assert.strictEqual(trail.getLoadState(), "IN_MEMORY");
    assert.strictEqual(trail.length, 1, "memory mode still commits an integrity chain");
    assert.strictEqual(result.floorTrailRecorded, false);
    assert.strictEqual(result.disposition, "HOLD_BLIND");
    assert.strictEqual(result.execute, false);
  }
});

function validRecordFixture(): FloorTrailRecord {
  const path = fresh();
  const trail = new FloorTrail({ path });
  trail.record(input("fixture", "RELEASE", 10));
  return JSON.parse(readFileSync(path, "utf8").trim()) as FloorTrailRecord;
}

function assertHostileRejected(mutate: (record: Record<string, unknown>) => void): void {
  const path = fresh();
  const record = { ...validRecordFixture() } as Record<string, unknown>;
  mutate(record);
  writeFileSync(path, JSON.stringify(record) + "\n", "utf8");
  const loaded = new FloorTrail({ path });
  assert.strictEqual(loaded.getLoadState(), "CANNOT_VERIFY");
  assert.ok((loaded.getLastError() ?? "").includes("closed floor-trail schema"));
}

check("closed schema rejects an extra field before chain verification", () => {
  assertHostileRejected((record) => {
    record.EXTRA = "hostile";
  });
});

check("closed schema rejects a missing field before chain verification", () => {
  assertHostileRejected((record) => {
    delete record.sensorKinds;
  });
});

check("closed schema rejects an unknown disposition enum", () => {
  assertHostileRejected((record) => {
    record.disposition = "EXECUTE_ANYWAY";
  });
});

check("closed schema rejects an unknown floor and blind-split enum", () => {
  assertHostileRejected((record) => {
    record.floorKind = "HEALTHY";
  });
  assertHostileRejected((record) => {
    record.blindSplit = "AROUND_THE_LINE";
  });
});

check("closed schema rejects non-integer sequence numbers", () => {
  assertHostileRejected((record) => {
    record.sequenceNumber = 0.5;
  });
});

check("a failed append can recover without poisoning the durable chain", () => {
  const path = fresh();
  let failNext = true;
  const trail = new FloorTrail({
    path,
    appender: (target, line) => {
      if (failNext) {
        failNext = false;
        throw new Error("transient fault");
      }
      appendFileSync(target, line, "utf8");
    },
  });
  assert.strictEqual(trail.record(input("lost", "HOLD", 1)).persisted, false);
  assert.strictEqual(trail.length, 0);
  assert.strictEqual(trail.record(input("landed", "RELEASE", 2)).persisted, true);
  const loaded = new FloorTrail({ path });
  assert.strictEqual(loaded.getLoadState(), "LOADED_VERIFIED");
  assert.deepStrictEqual(loaded.verify(), { valid: true, brokenAt: null });
  assert.strictEqual(loaded.getAll()[0].sequenceNumber, 0);
  assert.strictEqual(loaded.getAll()[0].actionId, "landed");
});

console.log("\n══ S-4 W2 · post-durable head commits never enter the permit path ══");

check("the first durable append after startup commits even on a loaded trail", () => {
  const path = fresh("first-commit");
  const seed = new FloorTrail({ path });
  seed.record(input("old-0", "HOLD", 1));
  seed.record(input("old-1", "RELEASE", 2));

  const commits: HeadCommit[] = [];
  const trail = new FloorTrail({
    path,
    headCommitter: (commit) => commits.push(commit),
    headCommitEvery: 5,
    witnessSetId: "witness-set-a",
  });
  const outcome = trail.record(input("new-head", "RELEASE", 3));
  assert.strictEqual(outcome.persisted, true);
  assert.strictEqual(outcome.headCommitted, true);
  assert.strictEqual(outcome.headCommitDetail, null);
  assert.deepStrictEqual(commits, [
    {
      seq_no: 2,
      head_hash: outcome.record.hash,
      ts: 3,
      witness_set_id: "witness-set-a",
      // S88: no `modality` was declared, so the machine value is carried. This
      // trail is a machine book — no human instruction rides a permit decision.
      modality: "NOT_AN_INSTRUCTION",
    },
  ]);
});

check("an injected cadence commits the first head and then every N durable appends", () => {
  const committedSeqs: number[] = [];
  const trail = new FloorTrail({
    path: fresh("cadence"),
    headCommitEvery: 3,
    headCommitter: (commit) => committedSeqs.push(commit.seq_no),
  });
  const outcomes = Array.from({ length: 8 }, (_, i) =>
    trail.record(input(`cadence-${i}`, "HOLD", 100 + i))
  );
  assert.deepStrictEqual(committedSeqs, [0, 3, 6]);
  assert.deepStrictEqual(
    outcomes.map((outcome) => outcome.headCommitted),
    [true, false, false, true, false, false, true, false]
  );
  assert.match(outcomes[1].headCommitDetail ?? "", /not due at cadence 3/);
});

check("in-memory and failed appends commit no external head", () => {
  const commits: HeadCommit[] = [];
  const inMemory = new FloorTrail({
    headCommitter: (commit) => commits.push(commit),
  });
  const memoryOutcome = inMemory.record(input("memory", "HOLD", 1));
  assert.strictEqual(memoryOutcome.persisted, false);
  assert.strictEqual(memoryOutcome.headCommitted, false);
  assert.match(memoryOutcome.headCommitDetail ?? "", /not durably persisted/);

  const failed = new FloorTrail({
    path: fresh("failed-head"),
    appender: () => {
      throw new Error("disk unavailable");
    },
    headCommitter: (commit) => commits.push(commit),
  });
  const failedOutcome = failed.record(input("failed", "HOLD", 2));
  assert.strictEqual(failedOutcome.persisted, false);
  assert.strictEqual(failedOutcome.headCommitted, false);
  assert.match(failedOutcome.headCommitDetail ?? "", /not durably persisted/);
  assert.deepStrictEqual(commits, []);
});

check("a throwing committer is reported but cannot narrow a disposition", () => {
  const trail = new FloorTrail({
    path: fresh("throwing-committer"),
    headCommitter: () => {
      throw new Error("transport unavailable");
    },
  });
  const outcome = trail.record(input("direct", "RELEASE", 10));
  assert.strictEqual(outcome.persisted, true);
  assert.strictEqual(outcome.headCommitted, false);
  assert.match(outcome.headCommitDetail ?? "", /transport unavailable/);
  assert.deepStrictEqual(trail.verify(), { valid: true, brokenAt: null });

  const gateTrail = new FloorTrail({
    path: fresh("throwing-gate"),
    headCommitter: () => {
      throw new Error("still unavailable");
    },
  });
  const result = new Chokepoint({
    line: LINE,
    floorTrail: gateTrail,
  }).guard(A("release-despite-witness-failure"), [SILENT_A], null);
  assert.strictEqual(result.floorTrailRecorded, true);
  assert.strictEqual(result.disposition, "RELEASE");
  assert.strictEqual(result.execute, true);
});

check("unwired and failed head commits are distinct on the outcome", () => {
  const unwired = new FloorTrail({ path: fresh("unwired-head") }).record(
    input("unwired", "HOLD", 1)
  );
  const failed = new FloorTrail({
    path: fresh("wired-failed-head"),
    headCommitter: () => {
      throw new Error("no route");
    },
  }).record(input("wired", "HOLD", 2));
  assert.deepStrictEqual(
    { committed: unwired.headCommitted, detail: unwired.headCommitDetail },
    { committed: false, detail: null }
  );
  assert.strictEqual(failed.headCommitted, false);
  assert.match(failed.headCommitDetail ?? "", /no route/);
});

check("each committed fingerprint is the trail head at that sequence", () => {
  const commits: HeadCommit[] = [];
  const trail = new FloorTrail({
    path: fresh("head-equality"),
    headCommitEvery: 2,
    headCommitter: (commit) => commits.push(commit),
  });
  for (let i = 0; i < 6; i++) {
    trail.record(input(`head-${i}`, "RELEASE", 500 + i));
  }
  for (const commit of commits) {
    assert.strictEqual(trail.getAll()[commit.seq_no].hash, commit.head_hash);
    assert.strictEqual(trail.getAll()[commit.seq_no].timestamp, commit.ts);
  }
  assert.deepStrictEqual(trail.verify(), { valid: true, brokenAt: null });
});

check("the trail crosses its real boundary under the ruled fixed-name convention", () => {
  const base = join(root, `w2-e2e-${counter++}`);
  const intakeDir = join(base, "intake");
  const submitterId = "mica-floor-trail";
  mkdirSync(base, { recursive: true });
  // The producer does NOT create this. The intake's permissions are a deployment
  // act (`3730`, group `mica-drops`), never guessed by a submitter.
  mkdirSync(intakeDir, { recursive: true });
  const trail = new FloorTrail({
    path: join(base, "floor.jsonl"),
    // W2 originally asserted a sortable sequence filename. The wire convention
    // is now ruled differently: the filename IS the declared submitter id.
    headCommitter: fileDropHeadCommitter(intakeDir, submitterId),
    witnessSetId: "w2-set",
  });
  const trailOutcome = trail.record(input("cross-boundary", "RELEASE", 800));
  assert.strictEqual(trailOutcome.headCommitted, true);
  assert.deepStrictEqual(readdirSync(intakeDir), [submitterId]);
  const dropped = JSON.parse(
    readFileSync(join(intakeDir, submitterId), "utf8")
  ) as HeadCommit;
  assert.deepStrictEqual(dropped, {
    seq_no: 0,
    head_hash: trailOutcome.record.hash,
    ts: 800,
    witness_set_id: "w2-set",
    modality: "NOT_AN_INSTRUCTION",
  });
  assert.deepStrictEqual(trail.verify(), { valid: true, brokenAt: null });
});

check("an unconsumed fixed-name drop is deliberately replaced by the newer head", () => {
  const base = join(root, `wire-overwrite-${counter++}`);
  const intakeDir = join(base, "intake");
  const submitterId = "mica-floor-trail";
  // The producer does NOT create this. The intake's permissions are a deployment
  // act (`3730`, group `mica-drops`), never guessed by a submitter.
  mkdirSync(intakeDir, { recursive: true });
  const trail = new FloorTrail({
    path: join(base, "floor.jsonl"),
    headCommitter: fileDropHeadCommitter(intakeDir, submitterId),
    witnessSetId: "w2-set",
  });
  const first = trail.record(input("first", "HOLD", 801));
  const second = trail.record(input("second", "RELEASE", 802));
  assert.strictEqual(first.headCommitted, true);
  assert.strictEqual(second.headCommitted, true);
  assert.deepStrictEqual(readdirSync(intakeDir), [submitterId]);
  assert.deepStrictEqual(
    JSON.parse(readFileSync(join(intakeDir, submitterId), "utf8")),
    {
      seq_no: second.record.sequenceNumber,
      head_hash: second.record.hash,
      ts: second.record.timestamp,
      witness_set_id: "w2-set",
      modality: "NOT_AN_INSTRUCTION",
    }
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// S86 FOLLOW-UP · THE COMMITTER STOPPED BEING THE UNSAFE PRODUCER
//
// This function wrote straight onto the bare submitter-id name with no mode set,
// and was the producer a deployer reaching for one would have found first. Both
// halves were live hazards AT THE FAR END, which is the worst place for them:
// the witness's book is append-only, so a MALFORMED_SUBMISSION retained against
// a submitter that did nothing wrong is never correctable.
//
// The body is now a deliberate duplicate of `fileDropCommitter` in
// `src/witness/drop-committer.ts`. The byte-for-byte equality of the two is
// asserted in `src/witness/witnessd.test.ts` — it CANNOT be asserted here,
// because the closure ruling that forces the duplication also bars a test under
// `src/mica/` from importing the sibling to compare against.

console.log("\n── S86 · the committer that stopped being unsafe ──────────────");

function drop(seq: number, hash: string, ts: number): HeadCommit {
  return {
    seq_no: seq,
    head_hash: hash,
    ts,
    witness_set_id: "w2-set",
    modality: "NOT_AN_INSTRUCTION",
  };
}

check("S86-FT-A · the drop lands 0640 whatever the process umask is", () => {
  const intakeDir = join(root, `s86-mode-${counter++}`);
  mkdirSync(intakeDir, { recursive: true });
  const previous = process.umask(0o077);
  try {
    fileDropHeadCommitter(intakeDir, "mica-floor-trail")(drop(0, "h0", 1));
  } finally {
    process.umask(previous);
  }
  // `writeFileSync`'s `mode` option is umask-masked and would have produced 0600
  // here — a file the witness cannot read at all. `chmodSync` is not masked.
  // The pre-S86 body set no mode whatever, so this landed at `0666 & ~umask`.
  assert.strictEqual(
    statSync(join(intakeDir, "mica-floor-trail")).mode & 0o777,
    HEAD_DROP_FILE_MODE
  );
});

check("S86-FT-B · the write is ATOMIC: the bare name holds the OLD head or the NEW one", () => {
  const intakeDir = join(root, `s86-atomic-${counter++}`);
  mkdirSync(intakeDir, { recursive: true });
  const target = join(intakeDir, "mica-floor-trail");
  writeFileSync(target, canonicalHeadDropBytes(drop(0, "old-head", 1)), "utf8");

  // Standing INSIDE the instant of replacement — the only place the property can
  // be observed. The pre-S86 body truncated in place, so a witness sweeping here
  // read a torn half and retained it as a submission that was never sent.
  let observed: { destination: string; frame: string } | null = null;
  fileDropHeadCommitter(intakeDir, "mica-floor-trail", {
    rename: (from, to) => {
      observed = {
        destination: readFileSync(to, "utf8"),
        frame: readFileSync(from, "utf8"),
      };
      renameSync(from, to);
    },
    suffix: () => "fixed",
  })(drop(1, "new-head", 2));

  assert.notStrictEqual(observed, null);
  const seen = observed as unknown as { destination: string; frame: string };
  assert.strictEqual(seen.destination, canonicalHeadDropBytes(drop(0, "old-head", 1)));
  assert.strictEqual(seen.frame, canonicalHeadDropBytes(drop(1, "new-head", 2)));
  assert.strictEqual(
    readFileSync(target, "utf8"),
    canonicalHeadDropBytes(drop(1, "new-head", 2))
  );
  // And nothing is left over: one submission, no frame.
  assert.deepStrictEqual(readdirSync(intakeDir), ["mica-floor-trail"]);
});

check("S86-FT-C · the in-flight frame is DOT-PREFIXED — RULING A's contract, at this producer too", () => {
  const intakeDir = join(root, `s86-frame-${counter++}`);
  mkdirSync(intakeDir, { recursive: true });
  const names: string[] = [];
  fileDropHeadCommitter(intakeDir, "mica-floor-trail", {
    rename: (from, to) => {
      names.push(from.slice(intakeDir.length + 1));
      renameSync(from, to);
    },
    suffix: () => "deadbeef",
  })(drop(0, "h0", 1));

  // The witness skips names beginning `.` before it even stats them. A frame
  // that is not dotted IS a submission, and the atomicity buys nothing.
  assert.deepStrictEqual(names, [".mica-floor-trail.deadbeef"]);
});

check("S86-FT-D · a failed rename throws and leaves NO dotted litter behind", () => {
  const intakeDir = join(root, `s86-litter-${counter++}`);
  mkdirSync(intakeDir, { recursive: true });
  assert.throws(
    () =>
      fileDropHeadCommitter(intakeDir, "mica-floor-trail", {
        rename: () => {
          throw new Error("disk full");
        },
        suffix: () => "abc",
      })(drop(0, "h0", 1)),
    /disk full/
  );
  // A dotted frame is invisible to the sweep, so a leaked one sits there
  // forever. The ORIGINAL error propagates, not the cleanup's.
  assert.deepStrictEqual(readdirSync(intakeDir), []);
});

check("S86-FT-E · the drop carries exactly the five HEAD_KEYS, and no sixth", () => {
  const intakeDir = join(root, `s86-keys-${counter++}`);
  mkdirSync(intakeDir, { recursive: true });
  // The pre-S86 body ran `JSON.stringify(commit)` over whatever arrived, so an
  // EXTRA key reached the intake and landed as a MALFORMED_SUBMISSION against a
  // submitter that did nothing wrong. The commit is now REBUILT field by field.
  //
  // S88: the frozen set is FIVE keys, not four (`modality` joined S-4 §4 on
  // 2026-08-26). The claim this check makes is unchanged — the drop carries the
  // frozen set and nothing else — only the size of the set moved.
  fileDropHeadCommitter(intakeDir, "mica-floor-trail")({
    ...drop(3, "h3", 33),
    extra: "must not reach the intake",
  } as unknown as HeadCommit);

  const bytes = readFileSync(join(intakeDir, "mica-floor-trail"), "utf8");
  assert.strictEqual(
    bytes,
    '{"seq_no":3,"head_hash":"h3","ts":33,"witness_set_id":"w2-set",' +
      '"modality":"NOT_AN_INSTRUCTION"}'
  );
  assert.deepStrictEqual(Object.keys(JSON.parse(bytes)), [
    "seq_no",
    "head_hash",
    "ts",
    "witness_set_id",
    "modality",
  ]);
});

check("S86-FT-F · a MISSING intake is REFUSED, and nothing is created in its place", () => {
  // THE POINT OF THIS BUILD. This committer used to call `mkdirSync` on a
  // missing intake, which created it at the PROCESS UMASK — no setgid, wrong
  // group, wrong mode — and every test still passed while the deployer never
  // learned the `3730`/`mica-drops` act had been skipped. Silence that looks
  // like success is the thing being killed here.
  const base = join(root, `s86-no-create-${counter++}`);
  mkdirSync(base, { recursive: true });
  const missing = join(base, "intake-that-was-never-deployed");

  assert.throws(
    () => fileDropHeadCommitter(missing, "mica-floor-trail")(drop(0, "h0", 1)),
    /ENOENT/
  );
  assert.strictEqual(
    existsSync(missing),
    false,
    "the producer created the intake it was supposed to refuse"
  );

  // AND THE CALLER RECORDS IT. A missing intake is not silence: this file's own
  // `record()` wraps the committer call, so the failure comes back as a
  // retained, printable outcome — the trail's own append is untouched by it,
  // because a head commit never gates anything (HEAD_COMMIT_IS_NOT_A_GATE).
  const outcome = new FloorTrail({
    path: join(base, "floor.jsonl"),
    headCommitter: fileDropHeadCommitter(missing, "mica-floor-trail"),
    witnessSetId: "w2-set",
  }).record(input("no-intake", "RELEASE", 900));

  assert.strictEqual(outcome.persisted, true, "the trail's own record still landed");
  assert.strictEqual(outcome.headCommitted, false);
  assert.match(String(outcome.headCommitDetail), /ENOENT/);
  assert.strictEqual(existsSync(missing), false);
});

check("path-shaped submitter ids fail at wire construction and write no file", () => {
  for (const submitterId of ["", "../escape", "nested/name", "nested\\name", "a..b"]) {
    const intakeDir = join(root, `bad-id-${counter++}`);
    assert.throws(
      () => fileDropHeadCommitter(intakeDir, submitterId),
      /submitterId must be a bare filename/
    );
    assert.strictEqual(existsSync(intakeDir), false);
  }
});

check("an absent witness-set id is carried honestly as the empty string", () => {
  const commits: HeadCommit[] = [];
  const outcome = new FloorTrail({
    path: fresh("empty-witness-set"),
    headCommitter: (commit) => commits.push(commit),
  }).record(input("empty-id", "HOLD", 1));
  assert.strictEqual(outcome.headCommitted, true);
  assert.strictEqual(commits[0].witness_set_id, "");
});

check("the module exports both head-commit ceilings in full", () => {
  assert.match(HEAD_COMMIT_IS_NOT_A_GATE, /does not gate any permit/);
  assert.match(HEAD_COMMIT_IS_NOT_A_GATE, /never as clear/);
  assert.match(COMMIT_IS_NOT_RETENTION, /Submission is not proof of retention/);
  assert.match(COMMIT_IS_NOT_RETENTION, /does not attest/);
});

rmSync(root, { recursive: true, force: true });


// ── FT-S103 · a look that was REFUSED is not a book that is ABSENT ─────────
//
// The class closed in `ruling-log.ts` at S98 and left open in five sibling books
// until S103. `existsSync` returns false both for "no such file" and for "not
// allowed to look"; this book read the second as the first, called it
// FIRST_BOOT_OR_ERASED, and — because `mkdirSync(..., { recursive: true })`
// SUCCEEDS on a directory that exists and cannot be entered — set itself
// persisting over content it never read.

check("FT-S103-1 · the look has three answers, and only ENOENT means absent", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-ft-look-"));
  const present = join(base, "present.jsonl");
  writeFileSync(present, "", "utf8");
  assert.deepStrictEqual(lookAtFloorTrailFile(present), { state: "PRESENT" });
  assert.deepStrictEqual(lookAtFloorTrailFile(join(base, "nope.jsonl")), { state: "ABSENT" });

  // ENAMETOOLONG: a refusal every principal reaches, uid 0 included.
  const refused = lookAtFloorTrailFile(join(base, "x".repeat(300)));
  assert.strictEqual(refused.state, "CANNOT_SEE", "a name too long read as merely absent");
  assert.ok(refused.state === "CANNOT_SEE" && refused.detail.includes("ENAMETOOLONG"));
  rmSync(base, { recursive: true, force: true });
});

check("FT-S103-2 · a book it CANNOT SEE loads to CANNOT_VERIFY, never to first boot", () => {
  const base = mkdtempSync(join(tmpdir(), "mica-ft-cannotsee-"));
  const path = join(base, "x".repeat(300));
  const book = new FloorTrail({ path });
  assert.strictEqual(
    book.getLoadState(),
    "CANNOT_VERIFY",
    "a book this process cannot look at came up as a first boot"
  );
  const detail = book.getLastError() ?? "";
  assert.ok(detail.includes("NOT the finding that it is absent"), detail);
  assert.ok(detail.includes("nothing was recorded as a first boot"), detail);
  rmSync(base, { recursive: true, force: true });
});

check("FT-S103-3 · THE REAL SHAPE — a directory whose execute bit is stripped", () => {
  // The live instrument, and the one the mkdir defence dies on: the directory
  // EXISTS, holds a real book, and cannot be entered. `mkdirSync` recursive
  // returns cleanly here, so nothing downstream of the look would have caught it.
  //
  // A mode-based refusal cannot be built for uid 0, which is allowed to traverse
  // regardless. This body SAYS so rather than passing over a check that never
  // ran; FT-S103-1 and -2 reach the same branch by another errno for every
  // principal.
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === 0 || uid === null) {
    console.log(
      "      NOT EXERCISED as this principal: a mode-based refusal cannot be " +
        "built for uid 0. The classification and the load state are covered by " +
        "FT-S103-1..2; this body covers only the mode."
    );
    return;
  }
  const base = mkdtempSync(join(tmpdir(), "mica-ft-noexec-"));
  const dir = join(base, "book");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "book.jsonl");
  writeFileSync(path, "", "utf8");
  chmodSync(dir, 0o600); // readable, NOT searchable
  try {
    const look = lookAtFloorTrailFile(path);
    assert.strictEqual(look.state, "CANNOT_SEE", "a directory with no execute bit did not refuse the look");
    assert.ok(look.state === "CANNOT_SEE" && look.detail.includes("EACCES"));
    const book = new FloorTrail({ path });
    assert.strictEqual(book.getLoadState(), "CANNOT_VERIFY");
    assert.ok((book.getLastError() ?? "").includes("EACCES"));
  } finally {
    chmodSync(dir, 0o700);
    rmSync(base, { recursive: true, force: true });
  }
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
