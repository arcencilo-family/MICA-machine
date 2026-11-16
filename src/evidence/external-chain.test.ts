// ── MICA · the external evidence socket, tested ──────────────────────────────
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node src/evidence/external-chain.test.ts
//
// WHAT IS WORTH TESTING HERE IS THE REFUSAL, NOT THE SUCCESS. A socket that has
// only ever been seen accepting a record has been asserted, never tested: the
// whole value of this seam is that an absent external log reads as an absent
// external log rather than as nothing at all. So the three reds come first and
// they are the load-bearing checks: NOT_STATED, STATED_UNREACHABLE, and a
// non-separated chain that must not read like a separated one.
//
// EVERY DOUBLE BELOW IS LOCAL. No implementation is imported, and none exists in
// this repository to import.

import assert from "assert";
import { readFileSync } from "fs";
import { resolve } from "path";

import {
  appendExternalEvidence,
  describeExternalEvidenceSocket,
  EXTERNAL_EVIDENCE_NOT_IN_THE_FLOOR,
  EXTERNAL_EVIDENCE_NOT_STATED,
  EXTERNAL_EVIDENCE_STANCE,
  foldSeparation,
  readExternalEvidenceSocket,
} from "./external-chain";
import type {
  EvidencePosition,
  EvidenceRecordInput,
  ExternalEvidenceChain,
  SeparationStamp,
} from "./external-chain";

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
const asyncChecks: { name: string; fn: () => Promise<void> }[] = [];
function checkAsync(name: string, fn: () => Promise<void>): void {
  asyncChecks.push({ name, fn });
}

const RECORD: EvidenceRecordInput = {
  timestamp: 1_700_000_000_000,
  moduleId: "MICA/test",
  eventType: "evidence_socket_test",
  provenanceTag: "LaneB",
  parameters: { k: 1 },
  outcome: "written",
};

/** A local double. It is not, and does not pretend to be, any real chain. */
function chainDouble(opts: {
  loadState?: string;
  stamps?: readonly SeparationStamp[];
  omitStamps?: boolean;
  throwOnLoadState?: boolean;
  throwOnAppend?: boolean;
}): ExternalEvidenceChain {
  const base = {
    append(_input: EvidenceRecordInput): Promise<EvidencePosition> {
      if (opts.throwOnAppend) return Promise.reject(new Error("disk gone"));
      return Promise.resolve({
        sequenceNumber: 7,
        hash: "a".repeat(64),
        previousHash: "b".repeat(64),
      });
    },
    getLoadState(): string {
      if (opts.throwOnLoadState) throw new Error("socket closed");
      return opts.loadState ?? "LOADED_VERIFIED";
    },
  };
  if (opts.omitStamps) return base;
  return {
    ...base,
    getClerkClockSource(): readonly SeparationStamp[] {
      return opts.stamps ?? [];
    },
  };
}

const SEPARATED: SeparationStamp[] = [
  { separation: "SEPARATE_PROCESS", intake: "SOCKET" },
];
const IN_PROCESS: SeparationStamp[] = [
  { separation: "IN_PROCESS_NO_SEPARATION", intake: "LOCAL_CALL" },
];

console.log("\n── the external evidence socket · the three reds first ───────");

// ── RED 1 ────────────────────────────────────────────────────────────────────
check("EV-A · NO SOCKET STATED -> CANNOT_ASSESS, never a pass and never silence", () => {
  const r = readExternalEvidenceSocket({});
  assert.strictEqual(r.status, "NOT_STATED");
  assert.strictEqual(r.cannotAssess, EXTERNAL_EVIDENCE_NOT_STATED);
  assert.strictEqual(r.finding, null, "nobody stated one, so nobody is wrong yet");
  assert.strictEqual(r.loadState, null);
  assert.strictEqual(r.separation, "NOT_REPORTED");
  assert.ok(r.lines.length > 0, "an unstated socket still prints");
  assert.ok(
    r.lines.join(" ").includes("DEPENDENCY-NOT-STATED"),
    "the family must be named in the print, not just in the type"
  );
});

// ── RED 2 ────────────────────────────────────────────────────────────────────
check("EV-B · SOCKET STATED AND NOTHING THERE -> a FINDING, not a skip", () => {
  const r = readExternalEvidenceSocket({ statedAs: "/srv/evidence/chain.jsonl" });
  assert.strictEqual(r.status, "STATED_UNREACHABLE");
  assert.ok(r.finding !== null, "somebody said where it is; it is not there");
  assert.strictEqual(r.cannotAssess, null, "this is not an unperformed check");
  assert.ok(
    (r.finding as string).includes("/srv/evidence/chain.jsonl"),
    "the finding must quote what the deployer actually stated"
  );
  assert.ok((r.finding as string).includes("finding, not a skip"));
});

check("EV-C · a chain that cannot answer is UNREACHABLE, never reachable", () => {
  const r = readExternalEvidenceSocket({
    statedAs: "chain-that-hangs-up",
    chain: chainDouble({ throwOnLoadState: true }),
  });
  assert.strictEqual(r.status, "STATED_UNREACHABLE");
  assert.ok((r.finding as string).includes("socket closed"), "the reason is carried");
});

// ── RED 3 ────────────────────────────────────────────────────────────────────
check("EV-D · IN_PROCESS_NO_SEPARATION must NOT read the same as SEPARATE_PROCESS", () => {
  const separated = readExternalEvidenceSocket({
    statedAs: "outside",
    chain: chainDouble({ stamps: SEPARATED }),
  });
  const inProcess = readExternalEvidenceSocket({
    statedAs: "outside",
    chain: chainDouble({ stamps: IN_PROCESS }),
  });
  assert.strictEqual(separated.status, "REACHABLE");
  assert.strictEqual(inProcess.status, "REACHABLE", "surfaced, not failed");
  assert.strictEqual(separated.separation, "SEPARATE_PROCESS");
  assert.strictEqual(inProcess.separation, "IN_PROCESS_NO_SEPARATION");
  assert.notDeepStrictEqual(
    separated.lines,
    inProcess.lines,
    "THE WHOLE POINT: the two reads must not be the same text"
  );
  assert.ok(
    inProcess.lines.join(" ").includes("SEPARATION IS NOT ESTABLISHED"),
    "the un-separated read says so in words"
  );
  assert.ok(
    !separated.lines.join(" ").includes("SEPARATION IS NOT ESTABLISHED"),
    "and the separated read does not"
  );
});

console.log("\n── separation is READ, never declared ────────────────────────");

check("EV-E · a chain offering no separation evidence is NOT_REPORTED, never separated", () => {
  const r = readExternalEvidenceSocket({
    statedAs: "quiet-chain",
    chain: chainDouble({ omitStamps: true }),
  });
  assert.strictEqual(r.separation, "NOT_REPORTED");
  assert.ok(r.lines.join(" ").includes("SEPARATION IS NOT ESTABLISHED"));
});

check("EV-F · one un-separated stamp makes the whole read un-separated (min-shaped)", () => {
  assert.strictEqual(
    foldSeparation([...SEPARATED, ...SEPARATED, ...IN_PROCESS]),
    "IN_PROCESS_NO_SEPARATION"
  );
  assert.strictEqual(foldSeparation([]), "NOT_REPORTED");
  assert.strictEqual(foldSeparation(undefined), "NOT_REPORTED");
});

check("EV-G · a chain claiming SEPARATE while reached LOCALLY is its own state", () => {
  const contradiction: SeparationStamp[] = [
    { separation: "SEPARATE_PROCESS", intake: "LOCAL_CALL" },
  ];
  assert.strictEqual(
    foldSeparation(contradiction),
    "CLAIMED_SEPARATE_REACHED_LOCALLY"
  );
  // and a later clean stamp does not undo it
  assert.strictEqual(
    foldSeparation([...contradiction, ...SEPARATED]),
    "CLAIMED_SEPARATE_REACHED_LOCALLY"
  );
  const r = readExternalEvidenceSocket({
    statedAs: "contradicting-chain",
    chain: chainDouble({ stamps: contradiction }),
  });
  assert.strictEqual(r.separation, "CLAIMED_SEPARATE_REACHED_LOCALLY");
  assert.ok(r.lines.join(" ").includes("SEPARATION IS NOT ESTABLISHED"));
});

check("EV-H · an unrecognised separation word cannot manufacture separation", () => {
  assert.strictEqual(
    foldSeparation([{ separation: "TOTALLY_OUTSIDE_TRUST_ME", intake: "SOCKET" }]),
    "NOT_REPORTED"
  );
});

console.log("\n── load state is carried out UNCHANGED, never resolved ───────");

check("EV-I · FIRST_BOOT_OR_ERASED passes through undecided and says so", () => {
  const r = readExternalEvidenceSocket({
    statedAs: "fresh-or-wiped",
    chain: chainDouble({ loadState: "FIRST_BOOT_OR_ERASED", stamps: SEPARATED }),
  });
  assert.strictEqual(r.loadState, "FIRST_BOOT_OR_ERASED");
  assert.strictEqual(r.status, "REACHABLE", "undecided is not unreachable");
  assert.strictEqual(r.finding, null, "MICA does not convert undecided into a finding");
  const text = r.lines.join(" ");
  assert.ok(text.includes("UNDECIDED"), "the undecidedness is printed");
  assert.ok(
    text.includes("first run OR an erased one"),
    "both branches are named; neither is chosen"
  );
});

check("EV-J · CANNOT_VERIFY is carried out as the chain's own report", () => {
  const r = readExternalEvidenceSocket({
    statedAs: "broken-chain",
    chain: chainDouble({ loadState: "CANNOT_VERIFY", stamps: SEPARATED }),
  });
  assert.strictEqual(r.loadState, "CANNOT_VERIFY");
  assert.ok(r.lines.join(" ").includes("could not be verified"));
});

check("EV-K · an UNRECOGNISED load state fails CLOSED and quotes what was said", () => {
  const r = readExternalEvidenceSocket({
    statedAs: "chain-from-elsewhere",
    chain: chainDouble({ loadState: "EVERYTHING_IS_FINE", stamps: SEPARATED }),
  });
  assert.strictEqual(r.loadState, "UNRECOGNISED");
  const text = r.lines.join(" ");
  assert.ok(text.includes('"EVERYTHING_IS_FINE"'), "the raw word is quoted back");
  assert.ok(text.includes("never treated as clean"));
});

console.log("\n── the record either landed outside, or it did not ───────────");

checkAsync("EV-L · no socket -> NOT_APPENDED, with the reason, and no throw", async () => {
  const r = await appendExternalEvidence({}, RECORD);
  assert.strictEqual(r.kind, "NOT_APPENDED");
  assert.strictEqual(r.reading.status, "NOT_STATED");
  assert.ok(r.reason.includes("DEPENDENCY-NOT-STATED"));
});

checkAsync("EV-M · stated-but-absent -> NOT_APPENDED, carrying the finding", async () => {
  const r = await appendExternalEvidence({ statedAs: "/nowhere" }, RECORD);
  assert.strictEqual(r.kind, "NOT_APPENDED");
  assert.ok(r.reason.includes("/nowhere"));
});

checkAsync("EV-N · a reachable chain returns the record's POSITION", async () => {
  const r = await appendExternalEvidence(
    { statedAs: "outside", chain: chainDouble({ stamps: SEPARATED }) },
    RECORD
  );
  assert.strictEqual(r.kind, "APPENDED");
  if (r.kind !== "APPENDED") return;
  assert.strictEqual(r.position.sequenceNumber, 7);
  assert.strictEqual(r.position.hash.length, 64);
  assert.strictEqual(r.reading.separation, "SEPARATE_PROCESS");
});

checkAsync("EV-O · an append the chain refuses is NOT_APPENDED, never a crash and never lost", async () => {
  const r = await appendExternalEvidence(
    { statedAs: "outside", chain: chainDouble({ throwOnAppend: true, stamps: SEPARATED }) },
    RECORD
  );
  assert.strictEqual(r.kind, "NOT_APPENDED");
  assert.ok(r.reason.includes("THE APPEND WAS REFUSED"));
  assert.ok(r.reason.includes("disk gone"), "the chain's own reason is carried");
});

console.log("\n── the fences, read off this module's own bytes ──────────────");

const MODULE_SRC = readFileSync(
  resolve(__dirname, "external-chain.ts"),
  "utf8"
);

check("EV-P · the module takes NO dependency: zero imports, zero requires", () => {
  const imports = MODULE_SRC.match(/^\s*import\b/gm) ?? [];
  assert.deepStrictEqual(
    imports,
    [],
    `an evidence INTERFACE that imports anything is on its way to being a ` +
      `dependency; found ${imports.length}`
  );
  assert.ok(!/\brequire\s*\(/.test(MODULE_SRC), "no require() either");
});

check("EV-Q · the module names NO implementation", () => {
  // The deny-list is written here, in the test, precisely so that the module
  // itself stays clean and a `grep` over src/ finds the name only in the check
  // that forbids it.
  for (const name of ["ilas", "LockedEvidenceLog", "l0/", "kill stack"]) {
    assert.ok(
      !MODULE_SRC.toLowerCase().includes(name.toLowerCase()),
      `the socket must be satisfiable by something we have never seen; ` +
        `found "${name}"`
    );
  }
});

/**
 * EVERY LINE THIS MODULE CAN EVER PRINT.
 *
 * The first draft of EV-R and EV-S banned tokens from the SOURCE and went red on
 * this module's own prose — the header says the claim "must never be softened to
 * 'tamper-proof'", and the not-in-the-floor constant says "never a term in
 * min()". Banning a word a file needs in order to forbid it is the wrong fence,
 * and it would have been closed by deleting the sentence that does the work.
 *
 * THE PROPERTY THAT MATTERS IS WHAT IS CLAIMED, NOT WHAT IS DISCUSSED. So the
 * ban moved to the printed surfaces: no reader of this socket is ever told the
 * log is protected. The stronger structural property — that this module cannot
 * reach a verdict at all — is EV-P's zero imports, which is not a word count.
 */
function everyPrintedLine(): string {
  const surfaces = [
    readExternalEvidenceSocket({}),
    readExternalEvidenceSocket({ statedAs: "x" }),
    readExternalEvidenceSocket({
      statedAs: "x",
      chain: chainDouble({ throwOnLoadState: true }),
    }),
    readExternalEvidenceSocket({ statedAs: "x", chain: chainDouble({ stamps: SEPARATED }) }),
    readExternalEvidenceSocket({ statedAs: "x", chain: chainDouble({ stamps: IN_PROCESS }) }),
    readExternalEvidenceSocket({
      statedAs: "x",
      chain: chainDouble({ loadState: "FIRST_BOOT_OR_ERASED", stamps: SEPARATED }),
    }),
    readExternalEvidenceSocket({
      statedAs: "x",
      chain: chainDouble({ loadState: "CANNOT_VERIFY", stamps: SEPARATED }),
    }),
    readExternalEvidenceSocket({
      statedAs: "x",
      chain: chainDouble({ loadState: "NONSENSE", stamps: SEPARATED }),
    }),
  ];
  return [
    ...surfaces.flatMap((s) => s.lines),
    ...surfaces.map((s) => s.finding ?? ""),
    ...surfaces.map((s) => s.cannotAssess ?? ""),
    ...describeExternalEvidenceSocket({}),
    EXTERNAL_EVIDENCE_STANCE,
    EXTERNAL_EVIDENCE_NOT_STATED,
    EXTERNAL_EVIDENCE_NOT_IN_THE_FLOOR,
  ].join(" ");
}

check("EV-R · NO READER IS EVER TOLD THE LOG IS PROTECTED — detectable, not prevented", () => {
  const printed = everyPrintedLine();
  for (const claim of ["tamper-proof", "tamper proof", "tamperproof", "cannot be deleted", "unforgeable"]) {
    assert.ok(
      !printed.toLowerCase().includes(claim),
      `we cannot make deletion hard; we can make it undeniable — found "${claim}"`
    );
  }
  assert.ok(
    printed.includes("DOES NOT PROTECT THIS LOG AND CANNOT"),
    "and the opposite is said out loud, on the reachable and the stated-absent reads"
  );
});

check("EV-S · the printed surfaces carry no verdict vocabulary, and the module says why", () => {
  const printed = everyPrintedLine();
  for (const forbidden of ["SensorVerdict", "ALARM", "SILENT", "HOLD", "RELEASE"]) {
    assert.ok(
      !printed.includes(forbidden),
      `an evidence seam that speaks in verdicts will end up in one; found "${forbidden}"`
    );
  }
  // "verdict" itself is allowed in exactly ONE place: the sentence that denies
  // it. Third time this fence caught the sentence doing the forbidding rather
  // than a violation — so the rule is stated instead of the word being banned.
  const verdictMentions = printed.match(/verdict/gi) ?? [];
  assert.ok(
    verdictMentions.length > 0 && printed.includes("enters no verdict"),
    "the denial must be present"
  );
  assert.strictEqual(
    printed.replace(/enters no verdict/g, "").match(/verdict/gi),
    null,
    "and it is the only place the word appears in anything a reader is shown"
  );
  // The structural guarantee is EV-P (zero imports): a module that imports
  // nothing cannot construct a verdict or call the floor. This check is the
  // vocabulary half; that one is the reachability half.
  assert.ok(
    MODULE_SRC.includes(EXTERNAL_EVIDENCE_NOT_IN_THE_FLOOR.slice(0, 40)),
    "and it says so in its own text, not only in this test"
  );
});

check("EV-T · the stance is quoted in the module, and in what it prints", () => {
  assert.ok(EXTERNAL_EVIDENCE_STANCE.includes("different act by a different hand"));
  assert.ok(EXTERNAL_EVIDENCE_STANCE.includes("undeniable"));
  const described = describeExternalEvidenceSocket({}).join(" ");
  assert.ok(described.includes("different act by a different hand"));
  assert.ok(described.includes("never a term in min()"));
});

check("EV-U · there is no PASS in this vocabulary", () => {
  const surfaces = [
    readExternalEvidenceSocket({}),
    readExternalEvidenceSocket({ statedAs: "x" }),
    readExternalEvidenceSocket({ statedAs: "x", chain: chainDouble({ stamps: SEPARATED }) }),
  ];
  for (const s of surfaces) {
    assert.ok(
      !/\bPASS\b/.test(s.lines.join(" ")),
      "a socket that prints PASS has started certifying something"
    );
  }
});

void (async () => {
  for (const { name, fn } of asyncChecks) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (error) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${(error as Error).stack ?? String(error)}`);
      failed++;
    }
  }
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
