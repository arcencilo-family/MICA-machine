// ── MICA · the scope-block guard — printed prose against producible code ──────
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node src/mica/scope-block-guard.test.ts
//
// ── THE DEFECT THIS EXISTS TO END (S100, owed item (a)) ──────────────────────
//
//   On 2026-09-01 Sig's PRINTED SCOPE — the block the T1 reader with no console
//   receives as the instrument's own account of itself — still said:
//
//       THREE FURTHER SIG LEGS EXIST IN THE DESIGN AND ARE DELIBERATELY UNBUILT:
//         · PROBE DIVERGENCE — requires an expectation held OUTSIDE the system.
//           …
//           Blocked on an independent witness that does not exist.
//
//   while `SIG_F4_PROBE_DIVERGENCE` was being built in the same working tree.
//   The sensor built to catch a record contradicting the structure it is
//   embedded in was about to do exactly that, in its own voice, to the only
//   reader who cannot check. It was caught by a build seat's eye and repaired
//   by hand, and two tests in `sig-f4-probe.test.ts` pin THAT SENTENCE gone.
//   Pinning a sentence is not closing a class: the next leg to ship gets a
//   different sentence.
//
//   NOTE FOR ANYONE REPLAYING IT: the defective state is not any commit. At
//   `f4e9e48^` the text was HONEST — F4 did not exist yet — and at `f4e9e48`
//   the text was already repaired. The specimen lived only in the uncommitted
//   tree between them, which is precisely why nothing in git catches this
//   class and a guard has to.
//
//   This file closes the code side of the class, for every instrument that
//   prints a scope block, not for Sig alone.
//
// ── THE JOIN, AND WHY IT IS NOT THE ONE THE DEBT WAS WRITTEN WITH ────────────
//
//   The owed item reads "no leg named 'unbuilt' that has a FlagReport producing
//   its id". Read at bytes, the specimen does not join on an id: the prose said
//   PROBE DIVERGENCE, and `FlagReport.flag` is `"F4"` while `FlagReport.name` is
//   "sealed expectation vs observed result". NEITHER STRING APPEARS IN THE DEAD
//   TEXT. A guard keyed on the flag id would have passed over the very specimen
//   that paid for it.
//
//   What actually bridges prose and code is the FINDING CODE:
//   `SIG_F4_PROBE_DIVERGENCE` carries the leg's human name in its own tail.
//   That is the join used here — and it generalises, because every MICA
//   instrument declares finding codes and only Sig has flags. Flag ids are
//   matched TOO, so the debt as written is also discharged; they are simply not
//   the load-bearing half.
//
// ── NO NEW DECLARED LIST (S96, standing) ─────────────────────────────────────
//
//   Nothing here is enumerated by hand. Instruments are DISCOVERED by walking
//   `src/mica/**/index.ts` for an exported `*ScopeBlockText`. Producible
//   identifiers are read out of each instrument's own source at its single
//   declaration site (`code: "…"`, `flag: "…"`). The scope text is obtained by
//   CALLING the shipped function, so what is scanned is what a reader receives.
//
// ── THE VOCABULARY BOUND, PRINTED RATHER THAN IMPLIED ────────────────────────
//
//   `UNBUILT_CLAIM` below is the whole of what this guard understands as "this
//   is not built". It was not guessed. It was run against all thirteen shipped
//   scope blocks before being fixed, and then against two states it must tell
//   apart: the S100 dead text reinstated into today's source, where it fires
//   and names `SIG_F4_PROBE_DIVERGENCE`, and the genuine pre-F4 source at
//   `f4e9e48^`, where the same words are true and it stays silent.
//
//   THE MATCHING UNIT IS A CLAIM LINE AND WHAT IS INDENTED UNDER IT. A line
//   asserting something is not built owns the lines beneath it that are more
//   deeply indented — its bullets and its continuations — and nothing else.
//   That is the shape of every unbuilt declaration in every shipped block:
//
//       THREE FURTHER SIG LEGS ... ARE DELIBERATELY UNBUILT:      <- claim
//         · PROBE DIVERGENCE — ...                                <- owned
//           Blocked on an independent witness that does not exist. <- owned
//       F2 IS SHIPPED DORMANT.                                    <- not owned
//
//   IT IS NOT "a paragraph containing a claim", and the difference is the
//   whole of whether this guard survives. The blocks are full of honest
//   unbuilt prose — a severity rung designed and unbuilt, a parked leg C, a
//   trajectory leg held out — and the repaired Sig block carries a paragraph
//   narrating that probe divergence WAS blocked and IS NOW BUILT. Under a
//   paragraph-contains rule that honest retraction fires the guard. A guard
//   that cries wolf on the very repair it was written for would be retired
//   within a session.
//
//   IT IS ALSO NOT "a paragraph that OPENS with a claim", which was this
//   file's first form. That rule passed all thirteen blocks AND FAILED ITS OWN
//   NEGATIVE CONTROL: it silently depended on a blank line sitting above every
//   unbuilt list, so an author who omitted one turned the guard off without
//   touching it. Thirteen green checks over a dead detector, caught only
//   because the control fired first. The indent rule has no such dependency.
//
//   WHAT THIS LEAVES UNCAUGHT, stated rather than discovered later: an unbuilt
//   claim whose subject sits ABOVE it or at its own indent rather than beneath
//   it — prose, not a list. The S100 specimen was a list and so is every
//   unbuilt declaration shipped today. This is a real hole and it is the price
//   of not crying wolf.
//
//   It cannot see a leg that is unbuilt AND correctly described — that is not a
//   defect. It reads text against text; it runs no instrument and reads no
//   evidence log. Like the closure and registration guards, it measures the
//   wiring and emits no verdict.

import assert from "assert";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

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

const MICA_ROOT = __dirname;

// ── The vocabulary. This list IS the guard's ceiling. ────────────────────────

/**
 * Phrases that assert a thing is not built. Normalised the same way the prose
 * is (see `normalise`), so hyphens and punctuation do not defeat a match.
 */
const UNBUILT_CLAIM: readonly string[] = [
  "UNBUILT",
  "NOT BUILT",
  "NOT IMPLEMENTED",
  "NOT YET BUILT",
  "DOES NOT EXIST",
  "BLOCKED ON",
  "PARKED",
  "NOT AVAILABLE",
];

/** Lower-cases nothing and flattens everything else: one space, alnum only. */
function normalise(s: string): string {
  return ` ${s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()} `;
}

function contains(haystackNormalised: string, needle: string): boolean {
  return haystackNormalised.includes(normalise(needle));
}

// ── Discovery: every instrument that prints a scope block ────────────────────

interface Instrument {
  readonly dir: string;
  readonly sourcePath: string;
  readonly fnName: string;
}

/**
 * THE ONLY dynamic load in this file, deliberately kept to one call site so the
 * blind spot it costs `closure.test.ts` is one declared line rather than many.
 * It is dynamic because the instruments are DISCOVERED: a static import list
 * would be the hand-maintained enumeration this guard exists to avoid, and it
 * would go stale exactly the way the prose it checks went stale.
 */
function scopeTextOf(inst: Instrument): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(inst.sourcePath);
  const fn = mod[inst.fnName];
  assert.strictEqual(typeof fn, "function", `${inst.dir}: ${inst.fnName} is not callable`);
  const text: unknown = fn();
  assert.ok(
    typeof text === "string" && text.length > 0,
    `${inst.dir}: ${inst.fnName}() returned no text`
  );
  return text as string;
}

function indexFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) out.push(...indexFiles(full));
    else if (entry === "index.ts") out.push(full);
  }
  return out;
}

function discoverInstruments(): Instrument[] {
  const found: Instrument[] = [];
  for (const sourcePath of indexFiles(MICA_ROOT)) {
    const source = readFileSync(sourcePath, "utf8");
    const m = /export function ([A-Za-z0-9]*ScopeBlockText)\s*\(/.exec(source);
    if (m === null) continue;
    found.push({
      dir: relative(MICA_ROOT, sourcePath).replace(/\\/g, "/").replace(/\/index\.ts$/, ""),
      sourcePath,
      fnName: m[1],
    });
  }
  return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

const INSTRUMENTS = discoverInstruments();

// ── What the code can produce, read from the code ────────────────────────────

/**
 * The descriptive tail of a finding code, which is where the leg's human name
 * lives: `SIG_F4_PROBE_DIVERGENCE` -> `PROBE DIVERGENCE`.
 *
 * The first segment is the instrument's namespace and is always dropped. A
 * second segment is dropped only when it is a flag id (`F` + digits), which is
 * the one case where two namespaces are stacked. Nothing else is stripped —
 * a rule that dropped short segments generally would eat `CALL` out of
 * `OP3_CALL_UNANSWERED`.
 */
function findingPhrase(code: string): string {
  const seg = code.split("_");
  seg.shift();
  if (seg.length > 1 && /^F[0-9]+$/.test(seg[0])) seg.shift();
  return seg.join(" ");
}

interface Producible {
  readonly codes: readonly string[];
  readonly phrases: readonly string[];
  readonly flagIds: readonly string[];
}

function producibleIn(source: string): Producible {
  const codes = [
    ...new Set([...source.matchAll(/code:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1])),
  ];
  const flagIds = [
    ...new Set([...source.matchAll(/flag:\s*"(F[0-9]+)"/g)].map((m) => m[1])),
  ];
  return { codes, phrases: codes.map(findingPhrase), flagIds };
}

// ── The printed scope, as a reader receives it, split into paragraphs ────────

interface ScopeLine {
  readonly indent: number;
  readonly text: string;
}

/**
 * `formatScopeBlock` draws a box. Strip ONLY the frame character — the leading
 * whitespace after it is the instrument's own indentation and is load-bearing
 * here. A paragraph is a maximal run of consecutive non-blank lines.
 */
function paragraphs(scopeText: string): ScopeLine[][] {
  const out: ScopeLine[][] = [];
  let current: ScopeLine[] = [];
  for (const line of scopeText.split("\n")) {
    const body = line.replace(/^[│┌├└]/, "");
    if (body.trim() === "" || /^─+$/.test(body.trim())) {
      if (current.length > 0) out.push(current);
      current = [];
    } else current.push({ indent: body.length - body.trimStart().length, text: body.trim() });
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** Does this line assert that something is not built? */
function isUnbuiltClaim(line: ScopeLine): boolean {
  const n = normalise(line.text);
  return UNBUILT_CLAIM.some((v) => n.includes(normalise(v)));
}

/**
 * The claim line plus every following line indented MORE deeply than it — the
 * bullets and continuations the claim owns. Stops at the first line back at or
 * above the claim's own indent.
 */
function claimRegion(para: readonly ScopeLine[], start: number): ScopeLine[] {
  const region = [para[start]];
  for (let i = start + 1; i < para.length; i++) {
    if (para[i].indent <= para[start].indent) break;
    region.push(para[i]);
  }
  return region;
}

interface Contradiction {
  /** The line that made the unbuilt claim. */
  readonly claim: string;
  readonly named: string;
  readonly kind: "finding code" | "flag id";
}

/** The whole rule, in one function, so the control below tests what ships. */
function contradictions(scopeText: string, producible: Producible): Contradiction[] {
  const hits: Contradiction[] = [];
  const seen = new Set<string>();
  for (const para of paragraphs(scopeText)) {
    for (let k = 0; k < para.length; k++) {
      if (!isUnbuiltClaim(para[k])) continue;
      const region = claimRegion(para, k);
      const flat = normalise(region.map((l) => l.text).join(" "));
      const record = (named: string, kind: Contradiction["kind"]): void => {
        const key = `${named}|${para[k].text}`;
        if (seen.has(key)) return;
        seen.add(key);
        hits.push({ claim: para[k].text, named, kind });
      };
      for (let i = 0; i < producible.phrases.length; i++) {
        const phrase = producible.phrases[i];
        if (phrase !== "" && contains(flat, phrase)) record(producible.codes[i], "finding code");
      }
      for (const id of producible.flagIds) {
        if (contains(flat, id)) record(id, "flag id");
      }
    }
  }
  return hits;
}

// ── SBG-A · the guard cannot be reading nothing ──────────────────────────────
//
// Four VACUOUS-PASS specimens are on the corrections ledger. Every input this
// guard depends on is asserted non-empty BEFORE the guard's own verdict, so a
// regex that quietly stops matching fails loudly instead of passing clean.

console.log("\n── scope-block guard · what the code produces vs what it prints ──");

check("SBG-A1 · instruments printing a scope block were DISCOVERED, not listed", () => {
  assert.ok(
    INSTRUMENTS.length > 0,
    "walked src/mica/**/index.ts and found no *ScopeBlockText export. Zero " +
      "discovered is not a clean census — the walk or the naming convention broke."
  );
  console.log(`      ${INSTRUMENTS.length} instruments: ${INSTRUMENTS.map((i) => i.dir).join(", ")}`);
});

check("SBG-A2 · every discovered instrument yields at least one producible finding code", () => {
  const barren = INSTRUMENTS.filter(
    (i) => producibleIn(readFileSync(i.sourcePath, "utf8")).codes.length === 0
  ).map((i) => i.dir);
  assert.deepStrictEqual(
    barren,
    [],
    `no \`code: "…"\` literal found in: ${barren.join(", ")}. An instrument ` +
      "with nothing producible is scanned against an empty set and passes for free."
  );
});

check("SBG-A3 · every flag id declared is a segment of some finding code", () => {
  // Cross-check, not a pinned list: the two extractions are independent regexes
  // over the same file, and this is the only place they must agree. It fails if
  // either one starts reading a namespace the other cannot see.
  for (const inst of INSTRUMENTS) {
    const p = producibleIn(readFileSync(inst.sourcePath, "utf8"));
    for (const id of p.flagIds) {
      assert.ok(
        p.codes.some((c) => c.split("_").includes(id)),
        `${inst.dir}: flag ${id} appears in no finding code — the flag-id and ` +
          "finding-code extractions disagree about this instrument's namespace."
      );
    }
  }
});

check("SBG-A4 · the printed scope is obtained by CALLING the shipped function", () => {
  for (const inst of INSTRUMENTS) {
    assert.ok(
      paragraphs(scopeTextOf(inst)).length > 0,
      `${inst.dir}: the scope block split into zero paragraphs`
    );
  }
});

// ── SBG-B · the negative control, run every time ──────────────────────────────
//
// A guard whose failure was never seen is a VACUOUS-PASS candidate by
// definition. The control is built FROM LIVE DATA — a real producible finding
// code, phrased the way the S100 specimen phrased its leg — so it cannot rot
// into agreement with a detector that has stopped working.

check("SBG-B1 · CONTROL: a leg named in an unbuilt list IS caught", () => {
  const sig = INSTRUMENTS.find((i) => i.dir === "sig");
  assert.ok(sig !== undefined, "sig no longer prints a scope block");
  const p = producibleIn(readFileSync(sig.sourcePath, "utf8"));
  const code = p.codes.find((c) => /^F[0-9]+$/.test(c.split("_")[1] ?? ""));
  assert.ok(code !== undefined, "sig declares no flag-scoped finding code to build a control from");

  // The S100 specimen's shape — indentation included, because the indentation
  // is what the rule reads — rebuilt from the code's own vocabulary.
  const injected = [
    "│ DOES NOT SEE:",
    "│   GRADES. Sig produces flags.",
    "│   THREE FURTHER SIG LEGS EXIST IN THE DESIGN AND ARE DELIBERATELY UNBUILT:",
    `│     · ${findingPhrase(code)} — requires an expectation held OUTSIDE the`,
    "│       system. Blocked on an independent witness that does not exist.",
    "│     · CROSS-ENTITY CORRELATION — requires a second entity's records.",
    "│   F2 IS SHIPPED DORMANT.",
  ].join("\n");

  const hits = contradictions(injected, p);
  assert.ok(hits.length > 0, "the guard did not fire on an injected contradiction");
  assert.ok(
    hits.some((h) => h.named === code),
    `the guard fired but did not NAME the leg: got ${hits.map((h) => h.named).join(", ")}`
  );
  console.log(`      control fired and named: ${hits.map((h) => `${h.named} (${h.kind})`).join(", ")}`);
});

check("SBG-B2 · CONTROL: honest unbuilt prose naming nothing producible is NOT caught", () => {
  const sig = INSTRUMENTS.find((i) => i.dir === "sig");
  assert.ok(sig !== undefined);
  const p = producibleIn(readFileSync(sig.sourcePath, "utf8"));
  const honest = [
    "│   TWO FURTHER SIG LEGS EXIST IN THE DESIGN AND ARE DELIBERATELY UNBUILT:",
    "│     · CROSS-ENTITY CORRELATION — requires a second entity's records.",
    "│     · THE `unknowns` DISCIPLINE — there is nothing to read.",
  ].join("\n");
  const p2 = p;
  void p2;
  assert.deepStrictEqual(
    contradictions(honest, p),
    [],
    "the guard fired on an unbuilt list that names nothing the code can produce — " +
      "an instrument may have unbuilt legs and say so"
  );
});

check("SBG-B3 · CONTROL: a claim does not reach a leg OUTSIDE its indent", () => {
  // The bound that keeps the repaired Sig block from firing: a line narrating a
  // past blockage owns nothing that is not indented under it. If this stops
  // holding, the guard has quietly widened into the cry-wolf rule that was
  // rejected, and the shipped Sig block is the thing it will fire on.
  const sig = INSTRUMENTS.find((i) => i.dir === "sig");
  assert.ok(sig !== undefined);
  const p = producibleIn(readFileSync(sig.sourcePath, "utf8"));
  const code = p.codes.find((c) => /^F[0-9]+$/.test(c.split("_")[1] ?? ""));
  assert.ok(code !== undefined);
  const narration = [
    `│   (${findingPhrase(code)} was the third of these and IS NOW BUILT,`,
    "│    2026-09-01. It was blocked on an expectation held outside the system;",
    "│    that expectation now exists as a sealed pre-commitment.)",
  ].join("\n");
  assert.deepStrictEqual(
    contradictions(narration, p),
    [],
    "the guard fired on a same-indent narration of a blockage that is OVER — " +
      "this is the honest repair note the shipped Sig block carries"
  );
});

// ── SBG-C · THE GUARD ITSELF ─────────────────────────────────────────────────

console.log("\n── the guard · every shipped scope block ─────────────────────");

for (const inst of INSTRUMENTS) {
  check(`SBG-C · ${inst.dir} names no producible leg as unbuilt`, () => {
    const p = producibleIn(readFileSync(inst.sourcePath, "utf8"));
    const hits = contradictions(scopeTextOf(inst), p);
    assert.deepStrictEqual(
      hits.map((h) => `${h.named} [${h.kind}] under "${h.claim}"`),
      [],
      `${inst.dir}'s PRINTED SCOPE declares a leg unbuilt that this instrument ` +
        "can produce findings for. The prose describes the instrument as it WAS. " +
        "Repair the text — do not annotate it, and do not widen this guard."
    );
  });
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
