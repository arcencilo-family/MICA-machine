// ── MICA · C6/W5 — acceptance tests for the daily witness report ─────────────
//
// Everything here runs on SYNTHETIC STORE FIXTURES in a temp tree. Nothing
// reads `/var/lib/mica`, nothing needs a group membership, and nothing starts a
// witness — constructing one would append a PLACEMENT record, which is the very
// reason this program never constructs one.
//
// THE DEPLOYMENT ACT IS PERFORMED PER TEST BODY, never in the shared fixture.
// `deployReportDir()` is called explicitly by the checks that need a report
// directory, exactly as `deployOutbox()` is in `witness.test.ts` — because
// R-P asserts the directory is NOT created by the program, and a fixture that
// made one for everybody would falsify that check while leaving it green.

import assert from "assert";

import { DEPLOYMENT_PATH_PREFIXES } from "../deploy/deployment-paths";

/**
 * The deployment state root, taken from the ONE place it is named rather than
 * retyped here (S116 suite hygiene: no test file spells a deployment path).
 * These assertions are unchanged in strength — the shipped unit must still
 * carry exactly these arguments — they simply no longer name the box.
 */
const STATE_ROOT = DEPLOYMENT_PATH_PREFIXES[0];
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { WITNESSED_KINDS } from "../witness/types";
import {
  ARRIVAL_KINDS,
  BARRED_VOCABULARY,
  HONEST_LIMIT_TEXT,
  checkSymmetry,
  foldDay,
  localDayOf,
  previousLocalDay,
  quietDaySentence,
  readOutbox,
  readStoreText,
  renderRecordsJsonl,
  renderReport,
  reportRecords,
  windowForDay,
} from "./witness-report";
import type { RenderInput, ReportRecord } from "./witness-report";
import {
  EXIT,
  KNOWN_FLAGS,
  missingRequired,
  parseArgs,
  produceReport,
  recordFileName,
  reportFileName,
} from "./mica-report";
import { assessStaleness, loadCadenceDeclaration, MS_PER_DAY } from "./staleness-alarm";
import { DEPLOYMENT_FACTS_CEILING } from "./deployment-facts";

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

const REPO_ROOT = resolve(__dirname, "..", "..");
const root = mkdtempSync(join(tmpdir(), "mica-report-"));
let counter = 0;

const DAY = "2026-08-29";
const WINDOW = windowForDay(DAY);
assert.ok(WINDOW !== null, "the fixture day must be a calendar date");
const W = WINDOW;
/** A moment inside the fixture day, `hour` hours after local midnight. */
const at = (hour: number): number => W.startMs + hour * 3_600_000;
/** A fixed "now": 09:00 local on the day AFTER the fixture day. */
const NOW = W.endMs + 9 * 3_600_000;

interface Scratch {
  base: string;
  storePath: string;
  outboxDir: string;
  reportDir: string;
}

/** The temp tree. It creates the OUTBOX (a deployer performed §5.2) and NOT the report dir. */
function scratch(stem: string): Scratch {
  const base = join(root, `${stem}-${counter++}`);
  const outboxDir = join(base, "outbox");
  mkdirSync(outboxDir, { recursive: true });
  return {
    base,
    storePath: join(base, "store.jsonl"),
    outboxDir,
    reportDir: join(base, "report"),
  };
}

/** Recipe §5.5, rendered in a test. Called by name, in the bodies that need it. */
function deployReportDir(s: Scratch): void {
  mkdirSync(s.reportDir, { recursive: true });
}

interface RecordSpec {
  seq: number;
  ts: number;
  kind: string;
  submitterId?: string;
  witnessed?: unknown;
}

const observed = (value: number) => ({ state: "OBSERVED", value });

function record(spec: RecordSpec): string {
  return JSON.stringify({
    seq: spec.seq,
    arrivalTs: spec.ts,
    submitterId: spec.submitterId ?? "mica-node",
    kind: spec.kind,
    witnessed: spec.witnessed ?? {},
    previousHash: spec.seq === 0 ? "" : `hash-${spec.seq - 1}`,
    hash: `hash-${spec.seq}`,
  });
}

function writeStore(s: Scratch, lines: readonly string[]): void {
  writeFileSync(s.storePath, lines.length === 0 ? "" : lines.join("\n") + "\n", "utf8");
}

function receipt(s: Scratch, seq: number): void {
  writeFileSync(
    join(s.outboxDir, `receipt-${String(seq).padStart(12, "0")}.json`),
    JSON.stringify({ seq_no: seq, head_hash: "h", witness_ts: 1, witness_sig: "s" }) + "\n",
    "utf8"
  );
}

/** DC-2. A cadence declaration file: `{ "<chain_id>": <max age in days>, ... }`. */
function cadenceFile(s: Scratch, entries: Record<string, number>): string {
  const path = join(s.base, "expected-cadence.json");
  writeFileSync(path, JSON.stringify(entries), "utf8");
  return path;
}

/** All seven kinds inside the window, in the order a real day would produce them. */
function sevenKindDay(): string[] {
  return [
    record({ seq: 0, ts: at(0.1), kind: "PLACEMENT", submitterId: "", witnessed: {
      platform: "linux",
      effectiveUid: observed(995),
      effectiveGid: observed(985),
      hostname: "box",
      storePath: `${STATE_ROOT}/witness/store.jsonl`,
      storeMode: observed(0o640),
      keyAvailable: true,
    } }),
    record({ seq: 1, ts: at(1), kind: "HEAD_COMMIT", witnessed: {
      seq_no: 12, head_hash: "abc", ts: at(1), witness_set_id: "set-alpha", modality: "OFFERED",
    } }),
    record({ seq: 2, ts: at(2), kind: "MALFORMED_SUBMISSION", witnessed: {
      byteLength: 17, sha256: "deadbeef",
    } }),
    record({ seq: 3, ts: at(3), kind: "UNDECLARED_SUBMITTER", submitterId: "stranger", witnessed: {
      seq_no: 1, head_hash: "zzz", ts: at(3), witness_set_id: "set-alpha", modality: "IMPOSED",
    } }),
    record({ seq: 4, ts: at(4), kind: "UNDECLARED_MODALITY", submitterId: "old-node", witnessed: {
      seq_no: 5, head_hash: "yyy", ts: at(4), witness_set_id: "set-alpha",
    } }),
    record({ seq: 5, ts: at(5), kind: "UNREADABLE_DROP", submitterId: "shy-node", witnessed: {
      error: `Error: EACCES: permission denied, open '${STATE_ROOT}/witness/intake/shy-node'`,
      size: observed(184),
      mode: observed(0o600),
    } }),
    record({ seq: 6, ts: at(6), kind: "HEAD_COMMIT", witnessed: {
      seq_no: 13, head_hash: "def", ts: at(6), witness_set_id: "set-alpha", modality: "OFFERED",
    } }),
    record({ seq: 7, ts: at(6.001), kind: "KEY_UNAVAILABLE", witnessed: {
      keyPath: `${STATE_ROOT}/witness/witness.key`,
      detail: "Error: ENOENT: no such file or directory",
    } }),
  ];
}

/**
 * Two named chains and one nameless head, in the order a real day produces them.
 * `precommit:mica-doctor` presents TWICE, so "newest" has something to be newer
 * than.
 */
function namedChainDay(): string[] {
  return [
    record({ seq: 0, ts: at(1), kind: "NAMED_HEAD_COMMIT", submitterId: "mica-registrar", witnessed: {
      seq_no: 4, head_hash: "aaa", ts: at(1), witness_set_id: "set-alpha",
      modality: "OFFERED", chain_id: "precommit:mica-doctor",
    } }),
    record({ seq: 1, ts: at(2), kind: "HEAD_COMMIT", submitterId: "old-node", witnessed: {
      seq_no: 12, head_hash: "bbb", ts: at(2), witness_set_id: "set-alpha", modality: "OFFERED",
    } }),
    record({ seq: 2, ts: at(3), kind: "NAMED_HEAD_COMMIT", submitterId: "mica-registrar-refusal", witnessed: {
      seq_no: 9, head_hash: "ccc", ts: at(3), witness_set_id: "set-alpha",
      modality: "NOT_AN_INSTRUCTION", chain_id: "refusal:registrar",
    } }),
    record({ seq: 3, ts: at(4), kind: "NAMED_HEAD_COMMIT", submitterId: "mica-registrar", witnessed: {
      seq_no: 5, head_hash: "ddd", ts: at(4), witness_set_id: "set-alpha",
      modality: "OFFERED", chain_id: "precommit:mica-doctor",
    } }),
  ];
}

/** The RenderInput the existing helpers share, so both artifacts fold one day. */
function renderInput(s: Scratch, lines: readonly string[]): RenderInput {
  writeStore(s, lines);
  const read = readStoreText(readFileSync(s.storePath, "utf8"));
  const outbox = readOutbox(s.outboxDir);
  const fold = foldDay(read, W);
  return {
    fold,
    read,
    outbox,
    symmetry: checkSymmetry(fold, read, outbox),
    storePath: s.storePath,
    outboxDir: s.outboxDir,
    nowMs: NOW,
    dayProvenance: "DECLARED" as const,
  };
}

function render(s: Scratch, lines: readonly string[]): string {
  writeStore(s, lines);
  const read = readStoreText(readFileSync(s.storePath, "utf8"));
  const outbox = readOutbox(s.outboxDir);
  const fold = foldDay(read, W);
  return renderReport({
    dayProvenance: "DECLARED",
    fold,
    read,
    outbox,
    symmetry: checkSymmetry(fold, read, outbox),
    storePath: s.storePath,
    outboxDir: s.outboxDir,
    nowMs: NOW,
  });
}

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the window · a civil day, not 86,400,000 ms ───────────────");

check("R-O1 · a calendar date yields a local-midnight-to-local-midnight window", () => {
  assert.strictEqual(localDayOf(W.startMs), DAY);
  assert.strictEqual(localDayOf(W.endMs - 1), DAY);
  assert.strictEqual(localDayOf(W.endMs), "2026-08-30");
});

check("R-O2 · a date that is not a date is refused, not rolled forward", () => {
  assert.strictEqual(windowForDay("2026-02-30"), null);
  assert.strictEqual(windowForDay("2026-13-01"), null);
  assert.strictEqual(windowForDay("yesterday"), null);
  assert.strictEqual(windowForDay("2026-8-9"), null);
  assert.strictEqual(windowForDay(""), null);
});

check("R-O3 · the default day is the most recent COMPLETE local day", () => {
  // A timer firing at 00:00 must fold yesterday, whole — not today, empty.
  const midnight = windowForDay("2026-08-30");
  assert.ok(midnight !== null);
  assert.strictEqual(previousLocalDay(midnight.startMs), "2026-08-29");
  assert.strictEqual(previousLocalDay(midnight.startMs + 23 * 3_600_000), "2026-08-29");
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the fold · seven kinds, and the loud ones first ───────────");

check("R-A · all seven kinds are counted, and the seven names are the WITNESS's, not a copy", () => {
  const s = scratch("seven");
  const text = render(s, sevenKindDay());
  for (const kind of WITNESSED_KINDS) {
    assert.ok(
      new RegExp(`\\| ${kind} \\| \\d+ \\|`).test(text),
      `the counts table must carry a row for ${kind}:\n${text}`
    );
  }
  // The row order IS `WITNESSED_KINDS`' order. If a kind is ever added there,
  // this report gains a row without anyone editing this file — which is the
  // whole reason the list is imported instead of written out here.
  const rows = [...text.matchAll(/^\| ([A-Z_]+) \| \d+ \|$/gm)].map((m) => m[1]);
  assert.deepStrictEqual(rows, [...WITNESSED_KINDS]);
});

check("R-B · an UNREADABLE_DROP is reported with error, size and mode — a 0600 drop AS 0600", () => {
  const s = scratch("drop");
  const text = render(s, sevenKindDay());
  assert.match(text, /OBSERVED 0600/);
  assert.match(text, /OBSERVED 184/);
  assert.match(text, /EACCES: permission denied/);
  assert.match(text, /`shy-node`/);
});

check("R-B2 · no digest is claimed for a drop whose bytes were never read", () => {
  const s = scratch("drop-nohash");
  const text = render(s, sevenKindDay());
  const loud = text.slice(
    text.indexOf("### 1.1"),
    text.indexOf("### 1.2")
  );
  assert.doesNotMatch(loud, /sha256|digest [0-9a-f]{8}/i);
  assert.match(text, /no hash is claimed for any of them/);
});

check("R-C · the loud section comes BEFORE the counts, and the counts before the totals", () => {
  const s = scratch("order");
  const text = render(s, sevenKindDay());
  const loud = text.indexOf("## 1 · THE LOUD SECTION");
  const counts = text.indexOf("## 2 · Counts for the day");
  const whole = text.indexOf("## 3 · The store as a whole");
  assert.ok(loud > -1 && counts > loud && whole > counts, `sections out of order:\n${text}`);
});

check("R-D · KEY_UNAVAILABLE is surfaced as arrivals-retained-receipts-silently-absent", () => {
  const s = scratch("keyless");
  const text = render(s, sevenKindDay());
  assert.match(text, /KEY_UNAVAILABLE — arrivals retained, receipts silently absent/);
  assert.match(text, /The arrival WAS retained in every case/);
  assert.match(text, /witness\.key/);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── silence · the one sentence that must never be softened ────");

check("R-E · zero arrivals prints the quiet-day sentence verbatim, with the age", () => {
  const s = scratch("empty");
  const text = render(s, []);
  assert.match(text, /no arrivals recorded — cannot distinguish a quiet day from a stopped witness/);
  assert.ok(text.includes(quietDaySentence("no record in the store at all")));
});

check("R-F · a day of PLACEMENT records only is still a quiet day — restarts are not arrivals", () => {
  const s = scratch("placement-only");
  const text = render(s, [
    record({ seq: 0, ts: at(1), kind: "PLACEMENT", submitterId: "" }),
    record({ seq: 1, ts: at(9), kind: "PLACEMENT", submitterId: "" }),
    record({ seq: 2, ts: at(17), kind: "PLACEMENT", submitterId: "" }),
  ]);
  assert.match(text, /\*\*Arrivals in the window: 0\.\*\*/);
  // NOW is 09:00 on the following day; the last PLACEMENT sits at 17:00 on this one.
  assert.ok(text.includes(quietDaySentence("16.0 h")), `expected the age of the last record:\n${text}`);
  assert.match(text, /\| PLACEMENT \| 3 \|/);
  for (const kind of ARRIVAL_KINDS) assert.match(text, new RegExp(`\\| ${kind} \\| 0 \\|`));
});

check("R-F2 · records outside the window are not counted in it, but still set the height", () => {
  const s = scratch("outside");
  const text = render(s, [
    record({ seq: 0, ts: W.startMs - 60_000, kind: "HEAD_COMMIT" }),
    record({ seq: 1, ts: W.endMs, kind: "HEAD_COMMIT" }),
  ]);
  assert.match(text, /\| HEAD_COMMIT \| 0 \|/);
  assert.match(text, /record frames read : 2/);
  assert.match(text, /no arrivals recorded/);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the corrupt line · reported, never skipped ────────────────");

check("R-J · a line that is not JSON is REPORTED with its line number, and the fold reads on", () => {
  const s = scratch("corrupt");
  const lines = sevenKindDay();
  lines.splice(3, 0, "{this is not json");
  const text = render(s, lines);
  assert.match(text, /### 1\.3 · Lines this fold could not read/);
  assert.match(text, /\| 4 \| 17 \| .*JSON/i);
  // It read on: the records after the bad line are still counted.
  assert.match(text, /\| UNREADABLE_DROP \| 1 \|/);
  assert.match(text, /\| KEY_UNAVAILABLE \| 1 \|/);
});

check("R-J2 · and it states the consequence the WITNESS's own loader carries", () => {
  const s = scratch("corrupt-consequence");
  const lines = sevenKindDay();
  lines.splice(3, 0, "{this is not json");
  const text = render(s, lines);
  assert.match(text, /non-appendable/);
  assert.match(text, /witnessd` exits 3|exits 3/);
  assert.match(text, /is a store nothing can be added to/);
});

check("R-K · a JSON line carrying no record frame is reported as such, not as a record", () => {
  const s = scratch("no-frame");
  const text = render(s, [
    record({ seq: 0, ts: at(1), kind: "HEAD_COMMIT" }),
    JSON.stringify({ hello: "world" }),
  ]);
  assert.match(text, /carries no record frame/);
  assert.match(text, /record frames read : 1/);
  assert.match(text, /unreadable lines   : 1/);
});

check("R-L · a kind the seven do not name is COUNTED AND NAMED, never dropped", () => {
  const s = scratch("eighth");
  const text = render(s, [
    record({ seq: 0, ts: at(1), kind: "SOMETHING_NEW" }),
  ]);
  assert.match(text, /KINDS THIS FOLD DOES NOT KNOW: `SOMETHING_NEW`/);
  assert.match(text, /SOMETHING_NEW {2}← NOT ONE OF THE DECLARED KINDS \| 1 \|/);
});

check("R-M · a gap in the sequence numbering is stated — arithmetic, not cryptography", () => {
  const s = scratch("seqbreak");
  const text = render(s, [
    record({ seq: 0, ts: at(1), kind: "PLACEMENT", submitterId: "" }),
    record({ seq: 1, ts: at(2), kind: "HEAD_COMMIT" }),
    record({ seq: 4, ts: at(3), kind: "HEAD_COMMIT" }),
  ]);
  assert.match(text, /BREAK\(S\) IN THE NUMBERING/);
  assert.match(text, /\| 3 \| 2 \| 4 \| 0 — NOTHING IN THIS FILE ACCOUNTS FOR THE GAP \|/);
});

check("R-M3 · a gap an unreadable line accounts for is NOT reported as a missing record", () => {
  // The sample run reported "1 BREAK IN THE NUMBERING" for a store whose only
  // fault was one corrupt line. The record was there; it would not parse.
  const s = scratch("gap-accounted");
  const text = render(s, [
    record({ seq: 0, ts: at(1), kind: "PLACEMENT", submitterId: "" }),
    "{\"seq\": 1, truncated",
    record({ seq: 2, ts: at(3), kind: "HEAD_COMMIT" }),
  ]);
  assert.match(text, /no record is missing, one will not parse/);
  assert.doesNotMatch(text, /NOTHING IN THIS FILE ACCOUNTS FOR THE GAP/);
});

check("R-M2 · a store whose first readable record is not seq 0 says its head is missing", () => {
  const s = scratch("headless");
  const text = render(s, [record({ seq: 41, ts: at(1), kind: "HEAD_COMMIT" })]);
  assert.match(text, /THE FIRST READABLE RECORD IS seq 41, NOT 0/);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── receipt symmetry · filenames, and nothing more ────────────");

check("R-G · a HEAD_COMMIT with its receipt file matches; one explained by KEY_UNAVAILABLE is explained", () => {
  const s = scratch("symmetry");
  receipt(s, 1);
  const text = render(s, sevenKindDay());
  assert.match(text, /of those, receipted            : 1/);
  assert.match(text, /missing, explained by KEY_UNAVAILABLE at seq\+1 : 1 \(6\)/);
  assert.doesNotMatch(text, /HAVE NO RECEIPT FILE AND NOTHING IN THE STORE EXPLAINS IT/);
});

check("R-S105-A . a NAMED_HEAD_COMMIT's receipt is a MATCH, never an orphan", () => {
  // THE FAILURE THIS PINS. Receipt symmetry used to be computed against the one
  // literal "HEAD_COMMIT". A receipted kind the check did not know about turns
  // every receipt the new path writes into "a receipt file names a seq that is
  // no HEAD_COMMIT" -- the report shouting a fault at the operator on the first
  // working day of the shape, over a store that is perfectly correct.
  const s = scratch("s105-named-symmetry");
  receipt(s, 0);
  const text = render(s, [
    record({ seq: 0, ts: at(1), kind: "NAMED_HEAD_COMMIT", witnessed: {
      seq_no: 12,
      head_hash: "abc",
      ts: at(1),
      witness_set_id: "set-alpha",
      modality: "OFFERED",
      chain_id: "precommit:mica-doctor",
    } }),
    record({ seq: 1, ts: at(2), kind: "PLACEMENT", submitterId: "" }),
  ]);
  assert.match(text, /of those, receipted            : 1/);
  assert.doesNotMatch(text, /NAME A SEQ THAT IS NO HEAD_COMMIT/);
  assert.doesNotMatch(text, /NOT ONE OF THE DECLARED KINDS/);
});

check("R-S105-B . both new kinds count as ARRIVALS, and neither is an unknown kind", () => {
  // ARRIVAL_KINDS is this file's OWN copy of a subset of WITNESSED_KINDS, and a
  // subset cannot be derived from the import: the split is arrival-versus-self-
  // observation, a judgement only this file makes. So it is checked here.
  assert.ok(ARRIVAL_KINDS.includes("NAMED_HEAD_COMMIT"));
  assert.ok(ARRIVAL_KINDS.includes("NAMED_UNDECLARED_SUBMITTER"));
  const s = scratch("s105-arrivals");
  const text = render(s, [
    record({ seq: 0, ts: at(1), kind: "NAMED_HEAD_COMMIT", witnessed: {
      seq_no: 1, head_hash: "a", ts: at(1), witness_set_id: "set-alpha",
      modality: "OFFERED", chain_id: "precommit:book-a",
    } }),
    record({ seq: 1, ts: at(2), kind: "NAMED_UNDECLARED_SUBMITTER", submitterId: "stranger", witnessed: {
      seq_no: 2, head_hash: "b", ts: at(2), witness_set_id: "set-alpha",
      modality: "IMPOSED", chain_id: "refusal:registrar",
    } }),
  ]);
  assert.match(text, /\| NAMED_HEAD_COMMIT \| 1 \|/);
  assert.match(text, /\| NAMED_UNDECLARED_SUBMITTER \| 1 \|/);
  assert.doesNotMatch(text, /NOT ONE OF THE DECLARED KINDS/);
});

check("R-S106b-A . two named chains and one nameless head — three facts, no verdicts", () => {
  const s = scratch("s106b-chains");
  const text = render(s, namedChainDay());

  // The markdown half: one row per chain, NEWEST head only.
  assert.match(text, /### 3\.2 · The newest head retained for each chain/);
  assert.match(
    text,
    /\| precommit:mica-doctor \| 3 \|[^|]+\| NAMED_HEAD_COMMIT \| mica-registrar \|/
  );
  assert.match(
    text,
    /\| refusal:registrar \| 2 \|[^|]+\| NAMED_HEAD_COMMIT \| mica-registrar-refusal \|/
  );
  // seq 0 is the OLDER precommit head and must NOT appear as a row of its own.
  assert.doesNotMatch(text, /\| precommit:mica-doctor \| 0 \|/);
  // Sorted, so two folds of one store render byte-identically.
  assert.ok(
    text.indexOf("| precommit:mica-doctor |") < text.indexOf("| refusal:registrar |"),
    "chain rows must be sorted by chain_id"
  );
  // The nameless kinds get ONE line and it says it is not a chain.
  assert.match(text, /unnamed-chain heads \(HEAD_COMMIT \/ UNDECLARED_SUBMITTER \/ UNDECLARED_MODALITY\): newest at seq 1/);
  assert.match(text, /\*\*These are not one chain\.\*\*/);
  // NO THRESHOLD, NO JUDGMENT — and the denial is printed, not merely obeyed.
  assert.match(text, /Facts, not verdicts/);
  assert.match(text, /nothing in this report can tell them apart/);

  // The jsonl half: the same facts as structured fields.
  const rows = reportRecords(renderInput(s, namedChainDay()));
  const chainRows = rows.filter((r) => r.category === "CHAIN_LAST_SEEN");
  assert.strictEqual(chainRows.length, 2);
  assert.deepStrictEqual(chainRows.map((r) => r.chainId), [
    "precommit:mica-doctor",
    "refusal:registrar",
  ]);
  assert.deepStrictEqual(chainRows.map((r) => r.newestSeq), [3, 2]);
  const summary = rows.filter((r) => r.category === "CHAIN_SUMMARY");
  assert.strictEqual(summary.length, 1);
  assert.strictEqual(summary[0].namedChains, 2);
  assert.strictEqual(summary[0].unnamedHeadRetained, true);
  const unnamed = rows.filter((r) => r.category === "UNNAMED_CHAIN_HEADS");
  assert.strictEqual(unnamed.length, 1);
  assert.strictEqual(unnamed[0].newestSeq, 1);
});

check("R-S106b-B . a store with no named heads SAYS SO — a zero is a statement", () => {
  const s = scratch("s106b-none");
  const text = render(s, [record({ seq: 0, ts: at(1), kind: "PLACEMENT", submitterId: "" })]);
  assert.match(text, /- no named-chain heads retained/);
  assert.match(text, /UNDECLARED_MODALITY\): none retained/);
  // The section is printed even when empty: an absent table would let a reader
  // take the absence of the answer for the absence of the question.
  assert.match(text, /### 3\.2 · The newest head retained for each chain/);

  const rows = reportRecords(renderInput(s, [record({ seq: 0, ts: at(1), kind: "PLACEMENT", submitterId: "" })]));
  const summary = rows.filter((r) => r.category === "CHAIN_SUMMARY");
  assert.strictEqual(summary[0].namedChains, 0);
  assert.strictEqual(summary[0].unnamedHeadRetained, false);
  assert.strictEqual(rows.filter((r) => r.category === "CHAIN_LAST_SEEN").length, 0);
  assert.strictEqual(rows.filter((r) => r.category === "UNNAMED_CHAIN_HEADS").length, 0);
});

check("R-S106b-C . WHOLE STORE, NOT THE WINDOW — a chain silent all day still appears", () => {
  // THE LOAD-BEARING CHOICE. The line exists because a chain that stops
  // presenting is invisible. A window-scoped version would drop exactly that
  // chain from exactly the report meant to surface it — worse than nothing.
  const s = scratch("s106b-outside-window");
  const lines = [
    record({ seq: 0, ts: W.startMs - 86_400_000, kind: "NAMED_HEAD_COMMIT", submitterId: "mica-registrar", witnessed: {
      seq_no: 1, head_hash: "old", ts: W.startMs - 86_400_000, witness_set_id: "set-alpha",
      modality: "OFFERED", chain_id: "precommit:went-quiet",
    } }),
    record({ seq: 1, ts: at(1), kind: "PLACEMENT", submitterId: "" }),
  ];
  const text = render(s, lines);
  assert.match(text, /\| precommit:went-quiet \| 0 \|/);
  // …and it is counted as zero FOR THE DAY, which is the other half of the
  // honesty: present in §3, absent from §2's counts.
  assert.match(text, /\| NAMED_HEAD_COMMIT \| 0 \|/);
});

check("R-S106b-D . NEWEST means last in the file, not the largest timestamp", () => {
  // The store is append-only and its ORDER is the order of arrival. Taking a
  // max over a clock would let one bad stamp on one frame pin a chain's
  // last-seen line forever.
  const s = scratch("s106b-order");
  const text = render(s, [
    record({ seq: 0, ts: at(9), kind: "NAMED_HEAD_COMMIT", submitterId: "mica-registrar", witnessed: {
      seq_no: 1, head_hash: "first", ts: at(9), witness_set_id: "set-alpha",
      modality: "OFFERED", chain_id: "precommit:book",
    } }),
    record({ seq: 1, ts: at(2), kind: "NAMED_HEAD_COMMIT", submitterId: "mica-registrar", witnessed: {
      seq_no: 2, head_hash: "second", ts: at(2), witness_set_id: "set-alpha",
      modality: "OFFERED", chain_id: "precommit:book",
    } }),
  ]);
  assert.match(text, /\| precommit:book \| 1 \|/, "the LAST frame is the newest head");
  assert.doesNotMatch(text, /\| precommit:book \| 0 \|/);
});

check("R-S106b-E . a NAMED kind whose payload has no readable chain_id says exactly that", () => {
  // This fold reads FILES, not an intake. `validateRecord` would refuse such a
  // record at a witness; a hand-edited store can still hold one, and the fold
  // must report what it found rather than skip it or invent a name.
  const s = scratch("s106b-noname");
  const text = render(s, [
    record({ seq: 0, ts: at(1), kind: "NAMED_HEAD_COMMIT", submitterId: "mica-registrar", witnessed: {
      seq_no: 1, head_hash: "x", ts: at(1), witness_set_id: "set-alpha", modality: "OFFERED",
    } }),
  ]);
  assert.match(text, /NAMED KIND WITH NO READABLE chain_id/);
});

check("R-G2 · an EXPLAINED absence is still an absence — the report must not call the day symmetric", () => {
  // The first sample run printed "Every HEAD_COMMIT in the window has a receipt
  // file named for it" over a day in which one demonstrably did not. The
  // KEY_UNAVAILABLE record explained it; the summary rounded that down.
  const s = scratch("explained-is-not-symmetric");
  receipt(s, 1);
  const text = render(s, sevenKindDay());
  assert.doesNotMatch(text, /Every HEAD_COMMIT in the window has a receipt file named for it/);
  assert.match(text, /1 HEAD_COMMIT\(S\) IN THE WINDOW HAVE NO RECEIPT FILE\.\*\* The store says why/);
  assert.match(text, /that is an explanation, not a receipt\. The submitter got nothing back/);
});

check("R-G3 · with every receipt present the symmetric sentence IS printed", () => {
  const s = scratch("fully-symmetric");
  receipt(s, 0);
  const text = render(s, [
    record({ seq: 0, ts: at(1), kind: "HEAD_COMMIT" }),
    record({ seq: 1, ts: at(2), kind: "PLACEMENT", submitterId: "" }),
  ]);
  assert.match(text, /Every HEAD_COMMIT in the window has a receipt file named for it/);
  assert.match(text, /statement about FILENAMES/);
});

check("R-G4 · 0 HEAD_COMMITs and 0 receipts: the symmetry statement is WITHHELD, not passed", () => {
  // Caught in the wild on the 2026-08-30 report: over a day with nothing in it,
  // §4 printed an all-clear about receipts across a denominator of zero. The
  // affirmative sentence must not appear, and the report must say why.
  const s = scratch("vacuous-symmetry");
  const text = render(s, [
    record({ seq: 0, ts: at(1), kind: "PLACEMENT", submitterId: "" }),
  ]);
  assert.match(
    text,
    /0 HEAD_COMMITs in the window and 0 receipt files: the symmetry statement has nothing to compare and is therefore not made\./
  );
  assert.ok(
    !text.includes("Every HEAD_COMMIT in the window has a receipt file named for it"),
    `the vacuous all-clear is still being printed:\n${text}`
  );
  // The bound stays either way — it is load-bearing honesty in both branches.
  assert.match(text, /statement about FILENAMES/);
});

check("R-G5 · the boundary is BOTH counts at zero, and the ruled condition is what runs", () => {
  // One receipt, naming a HEAD_COMMIT this store holds OUTSIDE the window. The
  // second half of the affirmative sentence — "every receipt file names a
  // HEAD_COMMIT this store holds" — has something real to say here, so the
  // sentence is made. The FIRST half is still quantifying over an empty window,
  // and that residue is named in the S97 receipt §E rather than widened into
  // this build's scope.
  const s = scratch("half-vacuous");
  receipt(s, 0);
  const text = render(s, [
    record({ seq: 0, ts: W.startMs - 60_000, kind: "HEAD_COMMIT" }),
    record({ seq: 1, ts: at(1), kind: "PLACEMENT", submitterId: "" }),
  ]);
  assert.match(text, /- HEAD_COMMITs in this window    : 0/);
  assert.match(text, /Every HEAD_COMMIT in the window has a receipt file named for it/);
  assert.ok(
    !text.includes("has nothing to compare"),
    `the vacuity sentence fired outside its ruled condition:\n${text}`
  );
});

check("R-H · a HEAD_COMMIT with no receipt and no explanation prints LOUD", () => {
  const s = scratch("gap");
  const text = render(s, [
    record({ seq: 0, ts: at(1), kind: "HEAD_COMMIT" }),
    record({ seq: 1, ts: at(2), kind: "HEAD_COMMIT" }),
  ]);
  assert.match(text, /2 HEAD_COMMIT\(S\) IN THIS WINDOW HAVE NO RECEIPT FILE AND NOTHING IN THE STORE EXPLAINS IT:\*\* seq 0, 1/);
});

check("R-H2 · a KEY_UNAVAILABLE somewhere else does NOT explain a gap — it is looked for at seq+1", () => {
  const s = scratch("wrong-explanation");
  const text = render(s, [
    record({ seq: 0, ts: at(1), kind: "HEAD_COMMIT" }),
    record({ seq: 1, ts: at(2), kind: "PLACEMENT", submitterId: "" }),
    record({ seq: 2, ts: at(3), kind: "KEY_UNAVAILABLE" }),
  ]);
  assert.match(text, /HAVE NO RECEIPT FILE AND NOTHING IN THE STORE EXPLAINS IT:\*\* seq 0/);
});

check("R-I · a receipt naming a seq that is no HEAD_COMMIT in this store is an ORPHAN, and is named", () => {
  const s = scratch("orphan");
  receipt(s, 1);
  receipt(s, 900);
  writeFileSync(join(s.outboxDir, "notes.txt"), "x", "utf8");
  const text = render(s, sevenKindDay());
  assert.match(text, /RECEIPT FILE\(S\) NAME A SEQ THAT IS NO HEAD_COMMIT ANYWHERE IN THIS STORE:\*\* seq 900/);
  assert.match(text, /are not named like a receipt\*\* and were counted as nothing: `notes\.txt`/);
});

check("R-I2 · an outbox that will not list is NOT an empty outbox, and says so", () => {
  const s = scratch("no-outbox");
  rmSync(s.outboxDir, { recursive: true, force: true });
  const text = render(s, sevenKindDay());
  assert.match(text, /THE OUTBOX COULD NOT BE LISTED, SO NO SYMMETRY WAS CHECKED/);
  assert.match(text, /NOT the same finding as an empty outbox and must never be read as one/);
  assert.match(text, /ENOENT/);
});

check("R-I3 · nothing in this program opens a receipt file", () => {
  const s = scratch("names-only");
  receipt(s, 1);
  const text = render(s, sevenKindDay());
  assert.match(text, /\*\*That is a statement about FILENAMES\.\*\*|comparison of NAMES/);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the vocabulary bar · a fold of a book is not a doctor ─────");

check("R-N · no fixture renders a barred word", () => {
  const s = scratch("vocab");
  const texts = [
    render(scratch("vocab-a"), sevenKindDay()),
    render(scratch("vocab-b"), []),
    render(scratch("vocab-c"), [record({ seq: 0, ts: at(1), kind: "HEAD_COMMIT" })]),
    render(s, ["{nope"]),
    // S106b: the per-chain last-seen lines, in BOTH of their states. A renderer
    // added after this fence was written is a renderer the fence never saw.
    render(scratch("vocab-d"), namedChainDay()),
    render(scratch("vocab-e"), [record({ seq: 0, ts: at(1), kind: "PLACEMENT", submitterId: "" })]),
  ];
  for (const text of texts) {
    for (const word of BARRED_VOCABULARY) {
      assert.ok(
        !text.toLowerCase().includes(word),
        `the report used the barred word ${JSON.stringify(word)}`
      );
    }
    assert.doesNotMatch(text, /\b(?:is|are|was|were) (?:ok|fine|good|clean)\b/i);
    assert.doesNotMatch(text, /\bno (?:issues|errors|faults)\b/i);
  }
});

check("R-N2 · every liveness sentence in the report is a DENIAL, never a claim", () => {
  const text = render(scratch("liveness"), sevenKindDay());
  // THE FENCE IS ON THE CLAIM, NOT ON THE WORDS. The report has to be able to
  // write "the witness is running" in order to say it is not claiming it —
  // banning a word a file needs in order to forbid it is the wrong fence (S95),
  // and it would be satisfied by deleting the sentence that does the work. So
  // every sentence that mentions liveness must also carry a negation.
  const liveness = /the witness (?:is|was) (?:running|up|alive|down|stopped)|\b(?:uptime|heartbeat|health check|liveness)\b/i;
  const sentences = text.split(/(?<=[.!?])\s+/);
  const mentions = sentences.filter((sentence) => liveness.test(sentence));
  assert.ok(mentions.length > 0, "the report must address liveness at all, to disclaim it");
  for (const sentence of mentions) {
    assert.match(
      sentence,
      /\b(?:not|never|cannot|nothing|no)\b/i,
      `an UNQUALIFIED liveness sentence reached the report: ${JSON.stringify(sentence)}`
    );
  }
  assert.match(text, /It does not say the witness is running, was running, or stopped/);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the report directory · a deployment act this program refuses to perform");

check("R-P · a MISSING report directory exits non-zero, NAMES THE PATH, and creates nothing", () => {
  const s = scratch("no-report-dir");
  writeStore(s, sevenKindDay());
  // deployReportDir is deliberately NOT called.
  const outcome = produceReport(
    { store: s.storePath, outbox: s.outboxDir, reportDir: s.reportDir, day: DAY },
    NOW
  );
  assert.strictEqual(outcome.code, EXIT.REPORT_DIR);
  assert.notStrictEqual(outcome.code, 0);
  const joined = outcome.messages.join("\n");
  assert.ok(joined.includes(s.reportDir), `the failure must name the path: ${joined}`);
  assert.match(joined, /THE REPORT DIRECTORY IS NOT THERE/);
  assert.match(joined, /This program does not create it/);
  assert.strictEqual(existsSync(s.reportDir), false, "it must not have been created");
  assert.strictEqual(outcome.text, null, "no report is rendered when it cannot be placed");
});

check("R-P2 · a report directory that is a FILE is refused too", () => {
  const s = scratch("report-dir-is-a-file");
  writeStore(s, sevenKindDay());
  writeFileSync(s.reportDir, "not a directory", "utf8");
  const outcome = produceReport(
    { store: s.storePath, outbox: s.outboxDir, reportDir: s.reportDir, day: DAY },
    NOW
  );
  assert.strictEqual(outcome.code, EXIT.REPORT_DIR);
  assert.match(outcome.messages.join("\n"), /NOT A DIRECTORY/);
});

check("R-P3 · NEITHER SOURCE FILE CALLS mkdirSync — the fence, checked at bytes", () => {
  // The fence is on the CALL, not on the word: both files NAME `mkdirSync` in
  // prose in order to forbid it, and a fence that banned the word would be
  // satisfied by deleting the sentence that does the work (S95's rule).
  for (const file of ["witness-report.ts", "mica-report.ts"]) {
    const source = readFileSync(join(__dirname, file), "utf8");
    assert.doesNotMatch(
      source,
      /mkdirSync\s*\(/,
      `${file} must not create a directory anywhere`
    );
  }
  // And the file that owns the WRITE must still carry the reason, so the next
  // hand finds an argument where it looks for the missing call.
  const writer = readFileSync(join(__dirname, "mica-report.ts"), "utf8");
  assert.match(writer, /mkdirSync/);
  assert.match(writer, /deployment act/);
});

check("R-Q · with the act performed, the report is written, named for the day, at 0640", () => {
  const s = scratch("written");
  deployReportDir(s);
  writeStore(s, sevenKindDay());
  const outcome = produceReport(
    { store: s.storePath, outbox: s.outboxDir, reportDir: s.reportDir, day: DAY },
    NOW
  );
  assert.strictEqual(outcome.code, EXIT.WRITTEN);
  // BOTH halves, and nothing else. The prose a person reads and the record a
  // consumer reads are one day folded once (S104).
  assert.deepStrictEqual(readdirSync(s.reportDir).sort(), [
    `witness-report-${DAY}.jsonl`,
    `witness-report-${DAY}.md`,
  ]);
  assert.strictEqual(outcome.path, join(s.reportDir, reportFileName(DAY)));
  assert.strictEqual(statSync(outcome.path as string).mode & 0o777, 0o640);
  assert.strictEqual(readFileSync(outcome.path as string, "utf8"), outcome.text);
  const recordPath = join(s.reportDir, recordFileName(DAY));
  assert.strictEqual(statSync(recordPath).mode & 0o777, 0o640, "the record's digit is the report's");
  assert.ok(outcome.messages.some((m: string) => m.includes(recordPath)), "the run did not name the record it wrote");
});

check("R-R · a report already there is NOT overwritten, and the exit code says which", () => {
  const s = scratch("already");
  deployReportDir(s);
  writeStore(s, sevenKindDay());
  const path = join(s.reportDir, reportFileName(DAY));
  writeFileSync(path, "an earlier hand wrote this\n", "utf8");
  const outcome = produceReport(
    { store: s.storePath, outbox: s.outboxDir, reportDir: s.reportDir, day: DAY },
    NOW
  );
  assert.strictEqual(outcome.code, EXIT.ALREADY_WRITTEN);
  assert.strictEqual(readFileSync(path, "utf8"), "an earlier hand wrote this\n");
  assert.match(outcome.messages.join("\n"), /IS ALREADY THERE/);
});

check("R-S · a store that will not read writes NO REPORT, and exits 3", () => {
  const s = scratch("no-store");
  deployReportDir(s);
  const outcome = produceReport(
    { store: s.storePath, outbox: s.outboxDir, reportDir: s.reportDir, day: DAY },
    NOW
  );
  assert.strictEqual(outcome.code, EXIT.STORE_UNREADABLE);
  assert.deepStrictEqual(readdirSync(s.reportDir), []);
  const joined = outcome.messages.join("\n");
  assert.ok(joined.includes(s.storePath));
  assert.match(joined, /NO REPORT WAS WRITTEN/);
  assert.match(joined, /would read exactly like a quiet day/);
});

check("R-S2 · an outbox that will not list still produces the report — and exit 6, not 0", () => {
  const s = scratch("outbox-refused");
  deployReportDir(s);
  writeStore(s, sevenKindDay());
  rmSync(s.outboxDir, { recursive: true, force: true });
  const outcome = produceReport(
    { store: s.storePath, outbox: s.outboxDir, reportDir: s.reportDir, day: DAY },
    NOW
  );
  assert.strictEqual(outcome.code, EXIT.WRITTEN_WITH_A_READING_REFUSED);
  assert.strictEqual(existsSync(outcome.path as string), true);
  assert.match(outcome.messages.join("\n"), /Receipt symmetry was NOT checked/);
});

check("R-T · no default paths: each required flag missing exits 1 and is named", () => {
  const s = scratch("flags");
  deployReportDir(s);
  assert.deepStrictEqual(missingRequired(parseArgs([])), ["--store", "--outbox", "--report-dir"]);
  const outcome = produceReport(parseArgs(["--store", s.storePath]), NOW);
  assert.strictEqual(outcome.code, EXIT.CANNOT_START);
  assert.match(outcome.messages.join("\n"), /NO DEFAULT PATHS/);
  assert.match(outcome.messages.join("\n"), /--outbox, --report-dir/);
});

check("R-T2 · a --day that is not a date exits 1 before anything is read", () => {
  const s = scratch("bad-day");
  deployReportDir(s);
  writeStore(s, sevenKindDay());
  const outcome = produceReport(
    { store: s.storePath, outbox: s.outboxDir, reportDir: s.reportDir, day: "2026-02-30" },
    NOW
  );
  assert.strictEqual(outcome.code, EXIT.CANNOT_START);
  assert.deepStrictEqual(readdirSync(s.reportDir), []);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── the units · flags proven against the program, at bytes ────");

const SERVICE = readFileSync(join(REPO_ROOT, "deploy", "mica-report.service"), "utf8");
const TIMER = readFileSync(join(REPO_ROOT, "deploy", "mica-report.timer"), "utf8");

function execStart(unit: string): string {
  const lines = unit.split("\n");
  const start = lines.findIndex((l) => l.startsWith("ExecStart="));
  assert.ok(start > -1, "the unit must have an ExecStart");
  const collected = [lines[start]];
  for (let i = start; lines[i].trimEnd().endsWith("\\"); i++) collected.push(lines[i + 1]);
  return collected.join(" ").replace(/\\/g, " ");
}

check("R-U · every flag the unit passes is a flag the program knows", () => {
  const flags = [...execStart(SERVICE).matchAll(/(--[a-z-]+)/g)].map((m) => m[1]);
  assert.ok(flags.length > 0, "the ExecStart passes no flags at all");
  for (const flag of flags) {
    assert.ok(KNOWN_FLAGS.includes(flag), `the unit passes ${flag}, which parseArgs ignores`);
  }
});

check("R-U2 · and every REQUIRED flag is present in the unit, with an argument", () => {
  const parsed = parseArgs(
    execStart(SERVICE)
      .replace(/^ExecStart=\S+\s+\S+\s*/, "")
      .trim()
      .split(/\s+/)
  );
  assert.deepStrictEqual(missingRequired(parsed), []);
  assert.strictEqual(parsed.store, `${STATE_ROOT}/witness/store.jsonl`);
  assert.strictEqual(parsed.outbox, `${STATE_ROOT}/witness/outbox`);
  assert.strictEqual(parsed.reportDir, `${STATE_ROOT}/report`);
  // --day is deliberately absent: the schedule folds the previous complete day.
  assert.strictEqual(parsed.day, null);
});

check("R-V · the service is a oneshot with NO [Install], and the timer is the enabled half", () => {
  assert.match(SERVICE, /^Type=oneshot$/m);
  assert.doesNotMatch(SERVICE, /^\[Install\]$/m);
  assert.doesNotMatch(SERVICE, /^Restart=/m);
  assert.match(TIMER, /^\[Install\]$/m);
  assert.match(TIMER, /^WantedBy=timers\.target$/m);
  assert.match(TIMER, /^Unit=mica-report\.service$/m);
  assert.match(TIMER, /^OnCalendar=daily$/m);
  assert.match(TIMER, /^Persistent=true$/m);
});

check("R-V2 · the unit does not smuggle in the liveness claim the code refuses to make", () => {
  assert.doesNotMatch(SERVICE, /^After=mica-witnessd/m);
  assert.doesNotMatch(SERVICE, /^Requires=/m);
  assert.doesNotMatch(SERVICE, /^BindsTo=/m);
});

check("R-V3 · the principal is an unusable-looking placeholder, and it is not the witness", () => {
  assert.match(SERVICE, /^User=REPLACE-WITH-THE-REPORT-PRINCIPAL$/m);
  assert.doesNotMatch(SERVICE, /^User=mica-witness$/m);
  assert.match(SERVICE, /^SupplementaryGroups=mica-readers$/m);
});


// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── S104 · the machine-readable half, and the window's provenance");

check("R-W1 · every one of the seven kinds emits a COUNT line, ZEROS INCLUDED", () => {
  const s = scratch("records-zeros");
  // A day with ONE arrival: six of the seven are zero and all seven must appear.
  const records = reportRecords(renderInput(s, [
    record({ seq: 0, ts: at(1), kind: "PLACEMENT", submitterId: "w", witnessed: {} }),
  ]));
  const counts = records.filter((r: ReportRecord) => r.category === "COUNT");
  for (const kind of WITNESSED_KINDS) {
    const row = counts.find((r: ReportRecord) => r.kind === kind);
    assert.ok(row !== undefined, `no COUNT line for ${kind} — a category that vanishes when empty`);
    assert.strictEqual(typeof row.inWindow, "number");
  }
  const zeros = counts.filter((r: ReportRecord) => r.inWindow === 0);
  assert.ok(zeros.length >= 6, `expected zeros to be printed, got ${zeros.length}`);
});

check("R-W2 · UNREADABLE_DROP is its own counted category AND its own rows", () => {
  const s = scratch("records-drop");
  const records = reportRecords(renderInput(s, [
    record({ seq: 0, ts: at(1), kind: "UNREADABLE_DROP", submitterId: "shy", witnessed: {
      error: "EACCES: permission denied", size: 41, mode: "0600",
    } }),
  ]));
  const count = records.find((r: ReportRecord) => r.category === "COUNT" && r.kind === "UNREADABLE_DROP");
  assert.strictEqual(count?.inWindow, 1, "the ruled category is not counted");
  const rows = records.filter((r: ReportRecord) => r.category === "UNREADABLE_DROP");
  assert.strictEqual(rows.length, 1, "the drop the witness could not read reached no record row");
  assert.strictEqual(rows[0].submitterId, "shy");
  assert.ok(String(rows[0].error).includes("EACCES"), "the OS error did not survive into the record");
});

check("R-W3 · a WITHHELD symmetry is a state, never a zero", () => {
  // Zero HEAD_COMMITs and zero receipts: the ruled boundary where the symmetry
  // statement is withheld. The record must not report it as a symmetry that
  // came out even.
  const s = scratch("records-withheld");
  const records = reportRecords(renderInput(s, [
    record({ seq: 0, ts: at(1), kind: "PLACEMENT", submitterId: "w", witnessed: {} }),
  ]));
  const sym = records.find((r: ReportRecord) => r.category === "SYMMETRY");
  assert.ok(sym !== undefined);
  assert.ok(
    sym.state === "WITHHELD" || sym.state === "COMPUTED",
    `symmetry state is neither: ${JSON.stringify(sym)}`
  );
  if (sym.state === "WITHHELD") {
    assert.ok(!("matched" in sym), "a withheld symmetry carried counts anyway");
  }
});

check("R-W4 · the record carries the window's PROVENANCE, declared or computed", () => {
  const s = scratch("records-provenance");
  const records = reportRecords(renderInput(s, sevenKindDay()));
  const w = records.find((r: ReportRecord) => r.category === "WINDOW");
  assert.strictEqual(w?.dayProvenance, "DECLARED");
  assert.strictEqual(w?.day, DAY);
});

check("R-W5 · a COMPUTED day says so on the report's own face", () => {
  // The default is the timer's contract and it stays; what goes is the SILENCE.
  const s = scratch("computed-day");
  deployReportDir(s);
  writeStore(s, sevenKindDay());
  const outcome = produceReport(
    { store: s.storePath, outbox: s.outboxDir, reportDir: s.reportDir, day: null },
    NOW
  );
  assert.strictEqual(outcome.code, EXIT.WRITTEN);
  assert.match(String(outcome.text), /WINDOW PROVENANCE: COMPUTED/);
  assert.match(String(outcome.text), /not a day anybody named/);
});

check("R-W6 · a DECLARED day says that instead, and never claims to be computed", () => {
  const s = scratch("declared-day");
  deployReportDir(s);
  writeStore(s, sevenKindDay());
  const outcome = produceReport(
    { store: s.storePath, outbox: s.outboxDir, reportDir: s.reportDir, day: DAY },
    NOW
  );
  assert.match(String(outcome.text), /WINDOW PROVENANCE: DECLARED/);
  assert.doesNotMatch(String(outcome.text), /WINDOW PROVENANCE: COMPUTED/);
});

check("R-W7 · the record uses no barred word either — the fence covers BOTH artifacts", () => {
  // R-N fences the prose. A machine-readable half that slipped a judgment word
  // past that fence would be the same claim in a format nobody proof-reads.
  const texts = [
    renderRecordsJsonl(reportRecords(renderInput(scratch("records-vocab"), sevenKindDay()))),
    // S106b: the chain rows, in both states.
    renderRecordsJsonl(reportRecords(renderInput(scratch("records-vocab-chains"), namedChainDay()))),
    renderRecordsJsonl(reportRecords(renderInput(scratch("records-vocab-none"), []))),
  ];
  for (const text of texts) {
    for (const word of BARRED_VOCABULARY) {
      assert.ok(!text.toLowerCase().includes(word), `the record used the barred word ${JSON.stringify(word)}`);
    }
    assert.doesNotMatch(text, /\b(?:is|are|was|were) (?:ok|fine|good|clean)\b/i);
    // And no line carries a verdict-shaped key: the record states counts, not conclusions.
    for (const line of text.trim().split("\n")) {
      const row = JSON.parse(line) as Record<string, unknown>;
      for (const key of ["status", "severity", "health", "ok", "verdict", "summary"]) {
        assert.ok(!(key in row), `the record grew a judgment key ${JSON.stringify(key)}`);
      }
    }
  }
});

check("R-W8 · every record line is one JSON object, newline-terminated", () => {
  const s = scratch("records-shape");
  const text = renderRecordsJsonl(reportRecords(renderInput(s, sevenKindDay())));
  assert.ok(text.endsWith("\n"), "the record file does not end with a newline");
  const lines = text.trim().split("\n");
  assert.ok(lines.length > 0);
  for (const line of lines) {
    const row: unknown = JSON.parse(line);
    assert.ok(typeof row === "object" && row !== null && !Array.isArray(row));
    assert.ok(typeof (row as Record<string, unknown>).category === "string", `no category: ${line}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── DC-2 · the staleness alarm — declared, never derived, negative-only ─");

/**
 * One store, four chains, each testing one clause of the brief:
 *  - `precommit:mica-doctor`  newest head 40 days before NOW, declared 30d → STALE
 *  - `precommit:fresh-book`   newest head  5 days before NOW, declared 30d → no verdict row
 *  - `precommit:ghost-book`   declared 30d, NEVER presents a head           → CANNOT_ASSESS
 *  - `precommit:wild-book`    presents a head, NOT in the declaration       → UNDECLARED
 */
function dc2Day(): string[] {
  return [
    record({
      seq: 0,
      ts: NOW - 40 * MS_PER_DAY,
      kind: "NAMED_HEAD_COMMIT",
      submitterId: "mica-registrar",
      witnessed: {
        seq_no: 1, head_hash: "stale-1", ts: NOW - 40 * MS_PER_DAY,
        witness_set_id: "set-alpha", modality: "OFFERED", chain_id: "precommit:mica-doctor",
      },
    }),
    record({
      seq: 1,
      ts: NOW - 5 * MS_PER_DAY,
      kind: "NAMED_HEAD_COMMIT",
      submitterId: "mica-registrar",
      witnessed: {
        seq_no: 1, head_hash: "fresh-1", ts: NOW - 5 * MS_PER_DAY,
        witness_set_id: "set-alpha", modality: "OFFERED", chain_id: "precommit:fresh-book",
      },
    }),
    record({
      seq: 2,
      ts: NOW - 3 * MS_PER_DAY,
      kind: "NAMED_HEAD_COMMIT",
      submitterId: "mica-arbiter",
      witnessed: {
        seq_no: 1, head_hash: "wild-1", ts: NOW - 3 * MS_PER_DAY,
        witness_set_id: "set-alpha", modality: "IMPOSED", chain_id: "precommit:wild-book",
      },
    }),
  ];
}

check("R-DC2-1 . a head older than its declared cadence fires STALE, named", () => {
  const s = scratch("dc2-stale");
  const input = renderInput(s, dc2Day());
  const declaration = loadCadenceDeclaration(
    cadenceFile(s, { "precommit:mica-doctor": 30, "precommit:fresh-book": 30, "precommit:ghost-book": 30 })
  );
  const staleness = assessStaleness(declaration, input.fold.chainsLastSeen, NOW);
  const stale = staleness.verdicts.find((v) => v.chainId === "precommit:mica-doctor");
  assert.ok(stale !== undefined, "the 40-day-old declared chain did not fire");
  assert.strictEqual(stale?.state, "STALE");
  assert.strictEqual(stale?.declaredMaxAgeDays, 30);

  const text = renderReport({ ...input, staleness });
  assert.match(text, /precommit:mica-doctor \| \*\*STALE\*\*/);
  const records = reportRecords({ ...input, staleness });
  const row = records.find(
    (r) => r.category === "STALENESS_ALARM" && r.chainId === "precommit:mica-doctor"
  );
  assert.strictEqual(row?.state, "STALE");
});

check("R-DC2-2 . a fresh declared chain earns NO verdict row, in prose or record — only a count", () => {
  const s = scratch("dc2-fresh");
  const input = renderInput(s, dc2Day());
  const declaration = loadCadenceDeclaration(
    cadenceFile(s, { "precommit:mica-doctor": 30, "precommit:fresh-book": 30 })
  );
  const staleness = assessStaleness(declaration, input.fold.chainsLastSeen, NOW);
  assert.strictEqual(
    staleness.verdicts.find((v) => v.chainId === "precommit:fresh-book"),
    undefined,
    "a fresh chain must never earn a verdict entry"
  );
  assert.strictEqual(staleness.assessedFreshCount, 1);

  const records = reportRecords({ ...input, staleness });
  const freshRow = records.find(
    (r) => r.category === "STALENESS_ALARM" && r.chainId === "precommit:fresh-book"
  );
  assert.strictEqual(freshRow, undefined, "the record must carry no row for the fresh chain");
  const summary = records.find((r) => r.category === "STALENESS_SUMMARY");
  assert.strictEqual(summary?.assessedFreshCount, 1);
  // Negative-only: the fresh chain's own id must not sit beside a healthy-sounding
  // word anywhere in the rendered prose.
  const text = renderReport({ ...input, staleness });
  assert.doesNotMatch(text, /precommit:fresh-book[^\n]*\*\*(?:STALE|OK|HEALTHY)\*\*/);
});

check("R-DC2-3 . a declared chain that never presented a head is CANNOT_ASSESS, not silence", () => {
  const s = scratch("dc2-ghost");
  const input = renderInput(s, dc2Day());
  const declaration = loadCadenceDeclaration(cadenceFile(s, { "precommit:ghost-book": 30 }));
  const staleness = assessStaleness(declaration, input.fold.chainsLastSeen, NOW);
  const ghost = staleness.verdicts.find((v) => v.chainId === "precommit:ghost-book");
  assert.strictEqual(ghost?.state, "CANNOT_ASSESS");
  assert.strictEqual(ghost?.newestSeq, null);
  assert.strictEqual(staleness.cannotAssessCount, 1);
});

check("R-DC2-4 . a store chain absent from the declaration is named UNDECLARED, not graded", () => {
  const s = scratch("dc2-undeclared");
  const input = renderInput(s, dc2Day());
  // The declaration says nothing about `precommit:wild-book` at all.
  const declaration = loadCadenceDeclaration(cadenceFile(s, { "precommit:mica-doctor": 30 }));
  const staleness = assessStaleness(declaration, input.fold.chainsLastSeen, NOW);
  assert.ok(staleness.undeclaredChains.includes("precommit:wild-book"));
  assert.strictEqual(
    staleness.verdicts.find((v) => v.chainId === "precommit:wild-book"),
    undefined,
    "an undeclared chain must never be graded STALE or CANNOT_ASSESS"
  );
  const records = reportRecords({ ...input, staleness });
  const row = records.find(
    (r) => r.category === "STALENESS_UNDECLARED" && r.chainId === "precommit:wild-book"
  );
  assert.ok(row !== undefined, "no STALENESS_UNDECLARED record for the wild chain");
  const text = renderReport({ ...input, staleness });
  assert.match(text, /UNDECLARED[\s\S]*precommit:wild-book/);
});

check("R-DC2-5 . an ABSENT declaration file (no flag) is CANNOT_ASSESS, never a code default", () => {
  const s = scratch("dc2-absent-flag");
  const input = renderInput(s, dc2Day());
  const declaration = loadCadenceDeclaration(null);
  assert.strictEqual(declaration.state, "ABSENT");
  const staleness = assessStaleness(declaration, input.fold.chainsLastSeen, NOW);
  assert.strictEqual(staleness.verdicts.length, 0);
  assert.strictEqual(staleness.undeclaredChains.length, 0);
  const text = renderReport({ ...input, staleness });
  assert.match(text, /CANNOT_ASSESS — the whole section/);
  assert.doesNotMatch(text, /\b30\b.*day.*cadence/);
  const records = reportRecords({ ...input, staleness });
  const decl = records.find((r) => r.category === "STALENESS_DECLARATION");
  assert.strictEqual(decl?.state, "ABSENT");
});

check("R-DC2-6 . a declaration file that does not exist on disk is CANNOT_ASSESS too, with a reason", () => {
  const s = scratch("dc2-absent-file");
  const input = renderInput(s, dc2Day());
  const missingPath = join(s.base, "no-such-cadence-file.json");
  const declaration = loadCadenceDeclaration(missingPath);
  assert.notStrictEqual(declaration.state, "CONFIGURED");
  assert.ok(declaration.problems.length > 0, "an unreadable declaration must name why");
  const staleness = assessStaleness(declaration, input.fold.chainsLastSeen, NOW);
  const text = renderReport({ ...input, staleness });
  assert.match(text, /CANNOT_ASSESS — the whole section/);
  const records = reportRecords({ ...input, staleness });
  const decl = records.find((r) => r.category === "STALENESS_DECLARATION");
  assert.ok(decl !== undefined);
  assert.notStrictEqual(decl?.state, "CONFIGURED");
});

check("R-DC2-7 . R8 held: no chain's cadence is ever computed from arrival history", () => {
  // The module takes no arrival-history input capable of producing a cadence —
  // its only two parameters besides the clock are the declaration and the
  // store's chain rows, and the declared days are echoed back verbatim, never
  // averaged, medianed, or padded from the rows themselves.
  const s = scratch("dc2-r8");
  const input = renderInput(s, dc2Day());
  const declaration = loadCadenceDeclaration(cadenceFile(s, { "precommit:mica-doctor": 30 }));
  const staleness = assessStaleness(declaration, input.fold.chainsLastSeen, NOW);
  const stale = staleness.verdicts.find((v) => v.chainId === "precommit:mica-doctor");
  assert.strictEqual(stale?.declaredMaxAgeDays, 30, "the declared number must survive unchanged");
});

check("R-DC2-8 . the vocabulary bar covers the staleness section too", () => {
  const s = scratch("dc2-vocab");
  const input = renderInput(s, dc2Day());
  const declaration = loadCadenceDeclaration(
    cadenceFile(s, { "precommit:mica-doctor": 30, "precommit:fresh-book": 30 })
  );
  const staleness = assessStaleness(declaration, input.fold.chainsLastSeen, NOW);
  const text = renderReport({ ...input, staleness });
  for (const word of BARRED_VOCABULARY) {
    assert.ok(!text.toLowerCase().includes(word), `staleness section used the barred word ${JSON.stringify(word)}`);
  }
  assert.doesNotMatch(text, /\b(?:is|are|was|were) (?:ok|fine|good|clean)\b/i);
});

check("R-DC2-9 . mica-report.ts wires --cadence-file end to end, best-effort", () => {
  const s = scratch("dc2-e2e");
  deployReportDir(s);
  writeStore(s, dc2Day());
  const cadence = cadenceFile(s, { "precommit:mica-doctor": 30 });
  const outcome = produceReport(
    {
      store: s.storePath,
      outbox: s.outboxDir,
      reportDir: s.reportDir,
      day: null,
      cadenceFile: cadence,
    },
    NOW
  );
  assert.strictEqual(outcome.code, EXIT.WRITTEN);
  assert.match(String(outcome.text), /precommit:mica-doctor \| \*\*STALE\*\*/);
  const recordText = readFileSync(recordPathOf(s, NOW), "utf8");
  assert.match(recordText, /"category":"STALENESS_ALARM"/);
});

function recordPathOf(s: Scratch, nowMs: number): string {
  const day = previousLocalDay(nowMs);
  return join(s.reportDir, recordFileName(day));
}

check("R-DC2-10 . mica-report.ts never stops on a --cadence-file that will not parse", () => {
  const s = scratch("dc2-malformed");
  deployReportDir(s);
  writeStore(s, dc2Day());
  const badPath = join(s.base, "bad-cadence.json");
  writeFileSync(badPath, "{ not json", "utf8");
  const outcome = produceReport(
    {
      store: s.storePath,
      outbox: s.outboxDir,
      reportDir: s.reportDir,
      day: null,
      cadenceFile: badPath,
    },
    NOW
  );
  assert.strictEqual(outcome.code, EXIT.WRITTEN, "a bad cadence file must never cost the report");
  assert.match(String(outcome.text), /CANNOT_ASSESS — the whole section/);
});

check("R-DC2-11 . rider 1 — item-4's honest limit is printed verbatim, prose and record", () => {
  const s = scratch("dc2-honest-limit");
  const text = render(s, sevenKindDay());
  assert.ok(text.includes(HONEST_LIMIT_TEXT), "the exact ruled text is not on the report's face");
  const records = reportRecords(renderInput(scratch("dc2-honest-limit-records"), sevenKindDay()));
  const row = records.find((r) => r.category === "HONEST_LIMIT");
  assert.strictEqual(row?.text, HONEST_LIMIT_TEXT);
});

// ── S109-B item 3 · clerk-caller attestation, negative-only ──────────────────

check("S109-B-1 . no --clerk-stamps-file → CALLER_ABSENT, prose and record, no default in code", () => {
  const s = scratch("clerkcaller-notwired");
  const text = render(s, sevenKindDay());
  assert.match(text, /CALLER_ABSENT/);
  assert.ok(text.includes("NOT ATTEMPTED — no --clerk-stamps-file"));
  const records = reportRecords(renderInput(scratch("clerkcaller-notwired-rec"), sevenKindDay()));
  const row = records.find((r) => r.category === "CLERK_CALLER_ATTESTATION");
  assert.strictEqual(row?.state, "CALLER_ABSENT");
  assert.strictEqual(row?.stampedRecordCount, null);
});

check("S109-B-2 . a --clerk-stamps-file pointing nowhere is ALSO CALLER_ABSENT (S108-C grammar)", () => {
  const s = scratch("clerkcaller-absent-path");
  deployReportDir(s);
  writeStore(s, sevenKindDay());
  const outcome = produceReport(
    {
      store: s.storePath,
      outbox: s.outboxDir,
      reportDir: s.reportDir,
      day: null,
      clerkStampsFile: join(s.base, "does-not-exist.jsonl"),
    },
    NOW
  );
  assert.strictEqual(outcome.code, EXIT.WRITTEN);
  assert.match(String(outcome.text), /CALLER_ABSENT/);
  const recordText = readFileSync(recordPathOf(s, NOW), "utf8");
  assert.match(recordText, /"category":"CLERK_CALLER_ATTESTATION","state":"CALLER_ABSENT"/);
});

check("S109-B-3 . an existing, empty stamps file reports NO_STAMPED_RECORDS, named", () => {
  const s = scratch("clerkcaller-empty");
  deployReportDir(s);
  writeStore(s, sevenKindDay());
  const stampsPath = join(s.base, "stamps.jsonl");
  writeFileSync(stampsPath, "", "utf8");
  const outcome = produceReport(
    { store: s.storePath, outbox: s.outboxDir, reportDir: s.reportDir, day: null, clerkStampsFile: stampsPath },
    NOW
  );
  assert.strictEqual(outcome.code, EXIT.WRITTEN);
  assert.match(String(outcome.text), /NO_STAMPED_RECORDS/);
  const recordText = readFileSync(recordPathOf(s, NOW), "utf8");
  assert.match(recordText, /"category":"CLERK_CALLER_ATTESTATION","state":"NO_STAMPED_RECORDS"/);
});

check("S109-B-4 . stamps present → a COUNT, prose and record, and NO health word anywhere", () => {
  const s = scratch("clerkcaller-present");
  deployReportDir(s);
  writeStore(s, sevenKindDay());
  const stampsPath = join(s.base, "stamps.jsonl");
  writeFileSync(
    stampsPath,
    [{ sequenceNumber: 1 }, { sequenceNumber: 2 }, { sequenceNumber: 3 }]
      .map((r) => JSON.stringify(r))
      .join("\n") + "\n",
    "utf8"
  );
  const outcome = produceReport(
    { store: s.storePath, outbox: s.outboxDir, reportDir: s.reportDir, day: null, clerkStampsFile: stampsPath },
    NOW
  );
  assert.strictEqual(outcome.code, EXIT.WRITTEN);
  assert.match(String(outcome.text), /stamped record count: 3/);
  for (const word of BARRED_VOCABULARY) {
    assert.ok(
      !String(outcome.text).toLowerCase().includes(word),
      `report used the barred word "${word}" in the clerk-caller section`
    );
  }
  const recordText = readFileSync(recordPathOf(s, NOW), "utf8");
  assert.match(
    recordText,
    /"category":"CLERK_CALLER_ATTESTATION","state":"STAMPS_PRESENT".*"stampedRecordCount":3/
  );
});

check("S109-B-5 . mica-report.ts never stops on a --clerk-stamps-file it cannot parse", () => {
  const s = scratch("clerkcaller-malformed");
  deployReportDir(s);
  writeStore(s, sevenKindDay());
  const stampsPath = join(s.base, "stamps.jsonl");
  writeFileSync(stampsPath, "{not json\n", "utf8");
  const outcome = produceReport(
    { store: s.storePath, outbox: s.outboxDir, reportDir: s.reportDir, day: null, clerkStampsFile: stampsPath },
    NOW
  );
  assert.strictEqual(outcome.code, EXIT.WRITTEN, "a bad stamps file must never cost the report");
  assert.match(String(outcome.text), /CANNOT_ASSESS/);
});

check("S109-B-6 . --clerk-stamps-file is a KNOWN flag (the unit-flags fence covers it too)", () => {
  assert.ok(KNOWN_FLAGS.includes("--clerk-stamps-file"));
});

// ── S112 · DF, the deployment-facts reader (§3.7), negative-only ─────────────

check("S112-DF-1 . no --deployment-facts → CANNOT_ASSESS, the whole section, no default in code", () => {
  const s = scratch("df-notwired");
  const text = render(s, sevenKindDay());
  assert.match(text, /### 3\.7 · Deployment facts/);
  assert.ok(text.includes("CANNOT_ASSESS — the whole section"));
  assert.ok(text.includes("no deployment-facts declaration was supplied"));
  const records = reportRecords(renderInput(scratch("df-notwired-rec"), sevenKindDay()));
  const row = records.find((r) => r.category === "DEPLOYMENT_FACTS_DECLARATION");
  assert.strictEqual(row?.state, "ABSENT");
});

check("S112-DF-2 . the printed ceiling is on the report's face verbatim, every render", () => {
  const s = scratch("df-ceiling");
  const text = render(s, sevenKindDay());
  assert.ok(text.includes(DEPLOYMENT_FACTS_CEILING), "the exact F10-class ceiling text is not on the report's face");
});

check("S112-DF-3 . a --deployment-facts file that will not parse never stops the report", () => {
  const s = scratch("df-malformed");
  deployReportDir(s);
  writeStore(s, sevenKindDay());
  const badPath = join(s.base, "bad-deployment-facts.json");
  writeFileSync(badPath, "{ not json", "utf8");
  const outcome = produceReport(
    { store: s.storePath, outbox: s.outboxDir, reportDir: s.reportDir, day: null, deploymentFactsFile: badPath },
    NOW
  );
  assert.strictEqual(outcome.code, EXIT.WRITTEN, "a bad deployment-facts file must never cost the report");
  assert.match(String(outcome.text), /CANNOT_ASSESS — the whole section/);
});

check("S112-DF-4 . a well-formed declaration renders a held count and a FACT_ABSENT row, prose and record", () => {
  const s = scratch("df-wired");
  deployReportDir(s);
  writeStore(s, sevenKindDay());
  const modePath = join(s.base, "socket");
  writeFileSync(modePath, "x");
  const declPath = join(s.base, "deployment-facts.json");
  writeFileSync(
    declPath,
    JSON.stringify([{ id: "socket-mode", family: "file-mode", path: modePath, mode: "000" }]),
    "utf8"
  );
  const outcome = produceReport(
    { store: s.storePath, outbox: s.outboxDir, reportDir: s.reportDir, day: null, deploymentFactsFile: declPath },
    NOW
  );
  assert.strictEqual(outcome.code, EXIT.WRITTEN);
  assert.match(String(outcome.text), /\*\*FACT_ABSENT\*\*/);
  const recordText = readFileSync(recordPathOf(s, NOW), "utf8");
  assert.match(recordText, /"category":"DEPLOYMENT_FACTS_FINDING".*"id":"socket-mode".*"state":"FACT_ABSENT"/);
  assert.match(recordText, /"category":"DEPLOYMENT_FACTS_SUMMARY"/);
});

check("S112-DF-5 . --deployment-facts is a KNOWN flag (the unit-flags fence covers it too)", () => {
  assert.ok(KNOWN_FLAGS.includes("--deployment-facts"));
});

rmSync(root, { recursive: true, force: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
