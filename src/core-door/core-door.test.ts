// ── MICA · the core door, tested ─────────────────────────────────────────────
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node src/core-door/core-door.test.ts
//
// Two halves. CD-01…CD-19 run the door over FIXTURE trees built in a temp
// directory — never over the real tickets directory, and every fixture ticket
// is named FIXTURE-… with a word that says it is not the arbiter's (CD-15 proves the
// door refuses such a ticket where real tickets live). CD-LIVE runs the door
// over THIS tree, with the real pin, and is the check that fails when
// `src/mica/**` drifts without a live ticket.

import assert from "assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";

import {
  AUTHORSHIP_NOT_VERIFIED,
  CORE_SCOPE,
  evaluateDoor,
  evaluateRealDoor,
  INVENTORY_REL,
  INVENTORY_SCHEMA,
  proposeRepins,
  requireShippable,
  sha256,
  TICKET_SCHEMA,
  TICKETS_REL,
} from "./core-door";
import type { DoorResult, Repin, TicketStatus } from "./core-door";

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

const REPO_ROOT = resolve(__dirname, "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "mica-core-door-"));
let n = 0;

const A = "src/mica/a.ts";
const B = "src/mica/sub/b.ts";

/** The digest, computed HERE and not by the door: `sha  path\n`, sorted — what `sha256sum` prints. */
function independentDigest(files: Record<string, string>): string {
  return sha256(Object.keys(files).sort().map((p) => `${files[p]}  ${p}\n`).join(""));
}

interface Fx {
  root: string;
  digest: string;
  write(rel: string, body: string): void;
  inventory(mut?: (inv: Record<string, any>) => void): void;
  ticket(id: string, over?: Record<string, unknown>): string;
  door(now: string, opts?: { realTickets?: boolean; digest?: string }): DoorResult;
}

function fixture(): Fx {
  const root = join(tmp, `fx-${n++}`);
  const write = (rel: string, body: string): void => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body, "utf8");
  };
  write(A, "export const a = 1;\n");
  write(B, "export const b = 2;\n");
  const files = { [A]: sha256("export const a = 1;\n"), [B]: sha256("export const b = 2;\n") };
  const digest = independentDigest(files);
  const inv: Record<string, any> = {
    schema: INVENTORY_SCHEMA,
    scope: CORE_SCOPE,
    baseline: { commit: "0000000fixture", pinnedOn: "2026-01-01", files },
    repins: [],
  };
  const fx: Fx = {
    root,
    digest,
    write,
    inventory(mut) {
      if (mut) mut(inv);
      write(INVENTORY_REL, JSON.stringify(inv, null, 2) + "\n");
    },
    ticket(id, over = {}) {
      const t = {
        schema: TICKET_SCHEMA,
        id,
        opens: [A],
        defect: { summary: "FIXTURE defect", ground: "FIXTURE ground" },
        expiresAt: "2026-02-01T00:00:00Z",
        arbiter: { word: "FIXTURE — not the arbiter's word; a test wrote this", date: "2026-01-10" },
        conditions: ["FIXTURE condition"],
        ...over,
      };
      const body = JSON.stringify(t, null, 2) + "\n";
      write(`${TICKETS_REL}/${id}.json`, body);
      return sha256(body);
    },
    door(now, opts = {}) {
      return evaluateDoor({
        repoRoot: root,
        now: new Date(now),
        expectedBaselineDigest: opts.digest ?? digest,
        realTickets: opts.realTickets ?? false,
      });
    },
  };
  fx.inventory();
  return fx;
}

const text = (r: DoorResult): string => r.lines.join("\n");
function expectRefused(r: DoorResult, needle: string): void {
  assert.strictEqual(r.kind, "REFUSED", `expected REFUSED, got ${r.kind}:\n${text(r)}`);
  assert.ok(text(r).includes(needle), `refusal does not say "${needle}":\n${text(r)}`);
  assert.ok(r.lines[0].startsWith("CORE DOOR REFUSED"), r.lines[0]);
}

const DURING = "2026-01-20T12:00:00Z";
const AFTER = "2026-03-01T00:00:00Z";
const T = "FIXTURE-t1";

console.log("\n── the core door · fixtures ──────────────────────────────────");

check("CD-01 · an untouched tree reads CLOSED with its count, and ships", () => {
  const r = fixture().door(DURING);
  assert.strictEqual(r.kind, "CLOSED", text(r));
  assert.strictEqual(r.lines[0], "core CLOSED, 2 files pinned");
  assert.strictEqual(r.shippable, true);
});

check("CD-02 · a drifted core file with no ticket is REFUSED, named, and says why", () => {
  const fx = fixture();
  fx.write(A, "export const a = 666;\n");
  const r = fx.door(DURING);
  expectRefused(r, `DRIFT ${A} drifted`);
  assert.ok(text(r).includes("there are no tickets"), text(r));
});

check("CD-03 · a NEW file under the core is drift", () => {
  const fx = fixture();
  fx.write("src/mica/new.ts", "x");
  expectRefused(fx.door(DURING), "src/mica/new.ts is not pinned (new file)");
});

check("CD-04 · a DELETED pinned file is drift", () => {
  const fx = fixture();
  unlinkSync(join(fx.root, B));
  expectRefused(fx.door(DURING), `${B} is pinned but gone`);
});

check("CD-05 · no hiding place: dist/, node_modules/ and dotfiles under the core are all seen", () => {
  for (const hidden of ["src/mica/dist/x.js", "src/mica/node_modules/y.js", "src/mica/.z"]) {
    const fx = fixture();
    fx.write(hidden, "smuggled");
    expectRefused(fx.door(DURING), `${hidden} is not pinned`);
  }
});

check("CD-06 · drift under a LIVE ticket naming the file reads OPEN — with the ticket, files and expiry — but NOT SHIPPABLE", () => {
  const fx = fixture();
  fx.ticket(T);
  fx.write(A, "export const a = 3;\n");
  const r = fx.door(DURING);
  assert.strictEqual(r.kind, "OPEN", text(r));
  assert.strictEqual(r.lines[0], `core OPEN under ticket ${T} for ${A}, expires 2026-02-01T00:00:00Z`);
  assert.ok(text(r).includes(`DRIFTED UNDER TICKET, NOT YET RE-PINNED: ${A}`), text(r));
  assert.strictEqual(r.shippable, false);
  assert.ok(text(r).includes("NOT SHIPPABLE"), text(r));
  assert.ok(text(r).includes("condition (carried, not enforced by this door): FIXTURE condition"), text(r));
});

check("CD-07 · the door closes by itself: the SAME drift after expiresAt is REFUSED (boundary: at the instant still open, one second later not)", () => {
  const fx = fixture();
  fx.ticket(T);
  fx.write(A, "export const a = 3;\n");
  assert.strictEqual(fx.door("2026-02-01T00:00:00Z").kind, "OPEN");
  expectRefused(fx.door("2026-02-01T00:00:01Z"), `ticket ${T} names it but EXPIRED 2026-02-01T00:00:00Z`);
  expectRefused(fx.door(AFTER), "EXPIRED");
});

check("CD-08 · a ticket is not live before its arbiter date", () => {
  const fx = fixture();
  fx.ticket(T);
  fx.write(A, "export const a = 3;\n");
  expectRefused(fx.door("2026-01-09T23:59:59Z"), "is not issued until 2026-01-10");
});

check("CD-09 · a live ticket does not cover a file it does not name", () => {
  const fx = fixture();
  fx.ticket(T);
  fx.write(B, "export const b = 9;\n");
  expectRefused(fx.door(DURING), `ticket ${T} does not name this file`);
});

check("CD-10 · a live ticket with nothing drifted reads OPEN, nothing drifted, SHIPPABLE", () => {
  const fx = fixture();
  fx.ticket(T);
  const r = fx.door(DURING);
  assert.strictEqual(r.kind, "OPEN", text(r));
  assert.ok(text(r).includes("nothing has drifted under it"), text(r));
  assert.ok(text(r).includes("SHIPPABLE — every byte"), text(r));
  assert.strictEqual(r.shippable, true);
});

function repaired(): { fx: Fx; repin: Repin } {
  const fx = fixture();
  const tsha = fx.ticket(T);
  fx.write(A, "export const a = 3;\n");
  const repin: Repin = {
    path: A,
    from: sha256("export const a = 1;\n"),
    to: sha256("export const a = 3;\n"),
    ticket: T,
    ticketSha256: tsha,
    pinnedOn: "2026-01-20",
  };
  return { fx, repin };
}

check("CD-11 · a repair re-pinned in the same tree SAYS SO, ships, and reads CLOSED — before its date, because the ticket is now SPENT (the arbiter, 2026-09-22)", () => {
  const { fx, repin } = repaired();
  fx.inventory((inv) => inv.repins.push(repin));
  // BEFORE the SPENT rule this read OPEN until 2026-02-01 and CLOSED only after.
  const during = fx.door(DURING);
  assert.strictEqual(during.kind, "CLOSED", text(during));
  assert.strictEqual(during.shippable, true, text(during));
  assert.ok(text(during).includes(`RE-PINNED (repair shipped): ${A} under ticket ${T}`), text(during));
  assert.ok(text(during).includes(`ticket ${T} SPENT`), text(during));
  assert.ok(text(during).includes("has not been reached — the pin record closed it early"), text(during));
  // Its bytes are untouched: expiresAt still says what the arbiter signed.
  const onDisk = JSON.parse(readFileSync(join(fx.root, `${TICKETS_REL}/${T}.json`), "utf8"));
  assert.strictEqual(onDisk.expiresAt, "2026-02-01T00:00:00Z", "the door closed the ticket by editing it");
  // After the date it is still SPENT — the reason it closed does not change.
  const after = fx.door(AFTER);
  assert.strictEqual(after.kind, "CLOSED", text(after));
  assert.ok(text(after).includes(`ticket ${T} SPENT`), text(after));
  assert.ok(text(after).includes("has also passed"), text(after));
});

check("CD-12 · THE RE-PIN BYPASS: an edit re-pinned without a valid ticket is REFUSED, in every form", () => {
  const cases: Array<[string, (r: Repin) => Repin, string]> = [
    ["no such ticket", (r) => ({ ...r, ticket: "FIXTURE-nope" }), "which does not exist"],
    ["ticket does not name it", (r) => ({ ...r, path: B, from: sha256("export const b = 2;\n") }), "which does not name that file"],
    ["dated after expiry", (r) => ({ ...r, pinnedOn: "2026-02-02" }), "after the ticket expired"],
    ["dated before issue", (r) => ({ ...r, pinnedOn: "2026-01-09" }), "before the ticket was issued"],
    ["dated in the future", (r) => ({ ...r, pinnedOn: "2026-01-25" }), "which is in the future"],
    ["ticket bytes changed", (r) => ({ ...r, ticketSha256: "0".repeat(64) }), "the ticket's bytes changed since"],
    ["wrong from", (r) => ({ ...r, from: "1".repeat(64) }), "but the pin in force is"],
  ];
  for (const [label, mut, needle] of cases) {
    const { fx, repin } = repaired();
    if (label === "ticket does not name it") fx.write(B, "export const b = 9;\n");
    fx.inventory((inv) => inv.repins.push(mut(repin)));
    const r = fx.door(label === "dated in the future" ? "2026-01-24T00:00:00Z" : DURING);
    try {
      expectRefused(r, needle);
    } catch (e) {
      throw new Error(`[${label}] ${(e as Error).message}`);
    }
  }
});

check("CD-13 · one re-pin per ticket per file: a shipped repair's ticket cannot re-pin that file again", () => {
  const { fx, repin } = repaired();
  fx.write(A, "export const a = 4;\n");
  fx.inventory((inv) =>
    inv.repins.push(repin, { ...repin, from: repin.to, to: sha256("export const a = 4;\n") })
  );
  expectRefused(fx.door(DURING), "a second time — one re-pin per ticket per file");
});

check("CD-14 · editing a BASELINE hash to match an edited file is REFUSED (the naive re-pin)", () => {
  const fx = fixture();
  fx.write(A, "export const a = 666;\n");
  fx.inventory((inv) => (inv.baseline.files[A] = sha256("export const a = 666;\n")));
  expectRefused(fx.door(DURING), "a baseline hash was edited");
});

check("CD-15 · a FIXTURE ticket where REAL tickets live is refused (and accepted only in a fixture tree)", () => {
  const fx = fixture();
  fx.ticket(T);
  expectRefused(fx.door(DURING, { realTickets: true }), "is marked FIXTURE and sits where real tickets live");
  assert.notStrictEqual(fx.door(DURING, { realTickets: false }).kind, "REFUSED");
});

check("CD-16 · malformed tickets fail closed: the unpasted placeholder, a date-only expiry, an unknown key, a misnamed file, a stray file", () => {
  const bad: Array<[string, (fx: Fx) => void, string]> = [
    ["placeholder", (fx) => fx.ticket(T, { arbiter: { word: "<<ARBITER: your words>>", date: "2026-01-10" } }), "still the placeholder"],
    ["date-only", (fx) => fx.ticket(T, { expiresAt: "2026-02-01" }), "expiresAt"],
    ["unknown key", (fx) => fx.ticket(T, { expiresat: "2026-02-01T00:00:00Z" }), "expected exactly"],
    ["misnamed", (fx) => fx.ticket(T, { id: "FIXTURE-other" }), "does not match its file name"],
    ["outside core", (fx) => fx.ticket(T, { opens: ["src/core-door/core-inventory.json"] }), "is not a plain path under src/mica/"],
    ["dot-dot", (fx) => fx.ticket(T, { opens: ["src/mica/../glue/wire.ts"] }), "is not a plain path"],
    ["no conditions key", (fx) => fx.ticket(T, { conditions: undefined }), "expected exactly"],
    ["stray", (fx) => fx.write(`${TICKETS_REL}/notes.txt`, "hi"), "only <id>.json ticket files"],
  ];
  for (const [label, make, needle] of bad) {
    const fx = fixture();
    make(fx);
    try {
      expectRefused(fx.door(DURING), needle);
    } catch (e) {
      throw new Error(`[${label}] ${(e as Error).message}`);
    }
  }
});

// ── CD-16b · THE UNFILLED DRAFT, IN THE TWO FIELDS THAT ARE FREE TEXT ───────
//
// ⛔ CD-16's "placeholder" row covered `arbiter.word` and nothing else, and the
//    door's check was that one field. Probed 2026-10-03, one marker per field:
//    id / opens[0] / expiresAt / arbiter.date / base are all refused by their OWN
//    FORMAT PATTERNS as a side effect, and `defect.summary`, `defect.ground` and
//    `conditions[i]` were ACCEPTED. The door was mostly safe by accident, and the
//    accident has a shape: the only free-text fields were the only open ones.
check("CD-16b · a draft marker in defect.summary, defect.ground or a condition is REFUSED, and the refusal NAMES the field", () => {
  const cases: Array<[string, (fx: Fx) => void, string]> = [
    ["defect.summary", (fx) => fx.ticket(T, { defect: { summary: "<<WHAT IS BROKEN>>", ground: "g" } }), "defect.summary still carries a draft marker"],
    ["defect.ground", (fx) => fx.ticket(T, { defect: { summary: "s", ground: "<<MEASURE IT FIRST>>" } }), "defect.ground still carries a draft marker"],
    ["conditions[0]", (fx) => fx.ticket(T, { conditions: ["<<DERIVATION PASTED HERE>>"] }), "conditions[0] still carries a draft marker"],
    // the INDEX matters: a reader of the refusal has to know which condition
    ["conditions[2]", (fx) => fx.ticket(T, { conditions: ["1. a", "2. b", "<<3. OPENS DERIVED BY THE SWEEP>>"] }), "conditions[2] still carries a draft marker"],
    ["base", (fx) => fx.ticket(T, { base: "<<STAMP ME>>" }), "base still carries a draft marker"],
  ];
  for (const [label, make, needle] of cases) {
    const fx = fixture();
    make(fx);
    try {
      expectRefused(fx.door(DURING), needle);
    } catch (e) {
      throw new Error(`[${label}] ${(e as Error).message}`);
    }
  }
});

check("CD-16b · UNSIGNED and UNFINISHED are different states, and the unfinished one wins", () => {
  // ⛔ THIS IS THE CASE THE WIDENING EXISTS FOR, and it is the case a real draft is
  //    in. A draft legitimately carries the arbiter placeholder; if the door
  //    reported THAT while a condition was still unfilled, the preflight would
  //    call the file READY FOR SIGNATURE — its verdict is defined as "exactly one
  //    objection and it is the arbiter.word one". So the scan runs FIRST.
  const fx = fixture();
  fx.ticket(T, {
    arbiter: { word: "<<ARBITER: your words>>", date: "2026-01-10" },
    conditions: ["<<DERIVATION PASTED HERE WHEN THE ARM REPORTS>>"],
  });
  expectRefused(fx.door(DURING), "conditions[0] still carries a draft marker");
  const refusal = JSON.stringify(fx.door(DURING));
  assert.ok(
    !refusal.includes("still the placeholder"),
    `the refusal must NOT be the arbiter.word one, or the preflight reads this as ready: ${refusal}`
  );
});

check("CD-16b · arbiter.word's own message is UNCHANGED, byte for byte, because another tool keys on it", () => {
  // ⚠ tools/ticket-preflight keys READY FOR SIGNATURE on this exact sentence. If
  //   the widening had rephrased it, every correct draft would have read MALFORMED
  //   and nothing in THIS suite would have noticed.
  const fx = fixture();
  fx.ticket(T, { arbiter: { word: "<<ARBITER: your words>>", date: "2026-01-10" } });
  expectRefused(fx.door(DURING), "arbiter.word is still the placeholder — the arbiter's own words go there");
});

check("CD-16b · a QUOTED marker is refused too, deliberately — and this bit the first ticket after the change", () => {
  // ⛔ IT BIT IMMEDIATELY, AND IT BIT THE TICKET ABOUT THE RULE. T24's draft
  //    carried a condition DESCRIBING this check, and that description quoted the
  //    markers — so the widened door refused the file. The markers were prose, not
  //    an unfilled slot.
  //
  // ⚠ THE PATTERN CANNOT TELL THE TWO APART AND IT IS NOT GOING TO BE TAUGHT TO.
  //   A gate that cannot be described inside the document it gates is an
  //   inconvenience; a gate that lets an unfilled slot through is a defect, and
  //   the strict pattern is also keyed on by tools/ticket-preflight. So the
  //   decision is: STRICT, the author rewords, and the refusal names the field and
  //   index so the fix is a ten-second one. T24's condition now says "the
  //   double-angle draft markers" in words.
  //
  //   This arm exists so the next seat finds the DECISION rather than re-deriving
  //   it from a surprising refusal.
  const fx = fixture();
  fx.ticket(T, {
    defect: {
      summary: "s",
      ground: "the door's PLACEHOLDER regex matches << or >> anywhere, and this sentence quotes them",
    },
  });
  expectRefused(fx.door(DURING), "defect.ground still carries a draft marker");
});

check("CD-16b · a ticket with no markers anywhere still parses — the scan refuses drafts, not tickets", () => {
  const fx = fixture();
  fx.ticket(T, {
    defect: { summary: "a real summary", ground: "a real ground, measured at bytes" },
    conditions: ["1. one thing", "2. another thing"],
  });
  assert.notStrictEqual(fx.door(DURING, { realTickets: false }).kind, "REFUSED");
});

check("CD-17 · a missing or malformed inventory is REFUSED, not read as empty", () => {
  const fx = fixture();
  writeFileSync(join(fx.root, INVENTORY_REL), "{", "utf8");
  expectRefused(fx.door(DURING), "unreadable or malformed");
  const fx2 = fixture();
  rmSync(join(fx2.root, INVENTORY_REL));
  expectRefused(fx2.door(DURING), "unreadable or malformed");
});

check("CD-18 · DISTINCT WORDS: CLOSED, OPEN and REFUSED never print the same headline, and each carries the authorship limit", () => {
  const closed = fixture().door(DURING);
  const fxo = fixture();
  fxo.ticket(T);
  const open = fxo.door(DURING);
  const fxr = fixture();
  fxr.write(A, "zzz");
  const refused = fxr.door(DURING);
  assert.deepStrictEqual([closed.kind, open.kind, refused.kind], ["CLOSED", "OPEN", "REFUSED"]);
  const heads = [closed.lines[0], open.lines[0], refused.lines[0]];
  assert.ok(heads[0].startsWith("core CLOSED,") && !heads[0].includes("OPEN") && !heads[0].includes("REFUSED"), heads[0]);
  assert.ok(heads[1].startsWith("core OPEN under ticket") && !heads[1].includes("CLOSED") && !heads[1].includes("REFUSED"), heads[1]);
  assert.ok(heads[2].startsWith("CORE DOOR REFUSED") && !heads[2].includes("CLOSED") && !heads[2].includes("core OPEN"), heads[2]);
  for (const r of [closed, open, refused]) {
    assert.strictEqual(r.lines[r.lines.length - 1], AUTHORSHIP_NOT_VERIFIED, `${r.kind} does not end with the authorship limit`);
  }
  assert.ok(AUTHORSHIP_NOT_VERIFIED.startsWith("ticket authorship is not verified by this test"));
});

check("CD-19 · --propose-repin's entries, pasted, turn NOT SHIPPABLE into SHIPPABLE — and name only the ticket's own files", () => {
  const fx = fixture();
  fx.ticket(T, { opens: [A, B] });
  fx.write(A, "export const a = 3;\n");
  const proposed = proposeRepins(fx.root, T, "2026-01-20", false);
  assert.deepStrictEqual(proposed.map((p) => p.path), [A], "only the drifted file the ticket names");
  fx.inventory((inv) => inv.repins.push(...proposed));
  const r = fx.door(DURING);
  // B was opened and left at its pin, so pasting A's re-pin settles the whole
  // ticket: SHIPPABLE, and CLOSED rather than OPEN because the ticket is SPENT.
  assert.strictEqual(r.kind, "CLOSED", text(r));
  assert.strictEqual(r.shippable, true, text(r));
  assert.ok(text(r).includes(`ticket ${T} SPENT`), text(r));
  assert.ok(text(r).includes("1 re-pinned under it, 1 left at its pin"), text(r));
  // A spent ticket proposes nothing further: A is used up, B is at its pin.
  assert.deepStrictEqual(proposeRepins(fx.root, T, "2026-01-20", false), []);
});

check("CD-20 · the acceptance's rule (requireShippable): CLOSED and re-pinned OPEN pass; un-re-pinned OPEN and REFUSED throw — and every line is printed", () => {
  const printed: string[] = [];
  const p = (l: string): void => void printed.push(l);
  const closed = fixture().door(DURING);
  requireShippable(closed, p);
  assert.strictEqual(printed.length, closed.lines.length, "not every door line was printed");
  const { fx, repin } = repaired();
  assert.throws(() => requireShippable(fx.door(DURING), p), /OPEN and NOT SHIPPABLE/);
  fx.inventory((inv) => inv.repins.push(repin));
  requireShippable(fx.door(DURING), p);
  const fxr = fixture();
  fxr.write(A, "zzz");
  assert.throws(() => requireShippable(fxr.door(DURING), p), /REFUSED and NOT SHIPPABLE/);
});

check("CD-21 · the real door holds its pin in its OWN source: a tree whose baseline is not the pinned one is REFUSED by evaluateRealDoor", () => {
  const fx = fixture();
  expectRefused(evaluateRealDoor(fx.root, new Date(DURING)), "a baseline hash was edited");
});

// ── SPENT · closure the door DERIVES from the pin record ─────────────────────
//
// The arbiter, 2026-09-22: "A ticket whose opened files are ALL re-pinned is SPENT.
// Treat it as closed without touching its bytes, and refuse further changes
// under it." The ruling exists because the door REFUSED an attempt to close T1
// early by editing its `expiresAt` — every re-pin cites `ticketSha256`, so a
// shipped ticket's bytes may not change. That refusal stands; closure moved to
// the pin record instead.

const T2 = "FIXTURE-t2";

/** The status the door derived for one ticket. Refusals carry no states. */
function statusFor(r: DoorResult, id: string): TicketStatus {
  assert.notStrictEqual(r.kind, "REFUSED", `expected a reading, got REFUSED:\n${text(r)}`);
  const s = (r as { states: readonly TicketStatus[] }).states.find((x) => x.id === id);
  assert.ok(s !== undefined, `the door reported no state for ticket ${id}:\n${text(r)}`);
  return s as TicketStatus;
}

/** The one line that reports a ticket's STATE — not the RE-PINNED lines that also name it. */
function stateLine(r: DoorResult, id: string): string {
  const want = `  ticket ${id} `;
  const hits = r.lines.filter((l) => l.startsWith(want));
  assert.strictEqual(hits.length, 1, `expected exactly one state line for ${id}:\n${text(r)}`);
  return hits[0];
}

check("CD-22 · THE RULING: every opened file re-pinned ⇒ SPENT — the door reads CLOSED before expiresAt, and the ticket's bytes are byte-identical", () => {
  const fx = fixture();
  const tsha = fx.ticket(T, { opens: [A, B] });
  const before = readFileSync(join(fx.root, `${TICKETS_REL}/${T}.json`));
  fx.write(A, "export const a = 3;\n");
  fx.write(B, "export const b = 9;\n");
  const mk = (path: string, from: string, to: string): Repin => ({
    path, from, to, ticket: T, ticketSha256: tsha, pinnedOn: "2026-01-20",
  });
  fx.inventory((inv) =>
    inv.repins.push(
      mk(A, sha256("export const a = 1;\n"), sha256("export const a = 3;\n")),
      mk(B, sha256("export const b = 2;\n"), sha256("export const b = 9;\n"))
    )
  );
  const r = fx.door(DURING);
  assert.strictEqual(r.kind, "CLOSED", text(r));
  const s = statusFor(r, T);
  assert.strictEqual(s.state, "SPENT");
  assert.deepStrictEqual([...s.usedUp], [A, B]);
  assert.deepStrictEqual([...s.outstanding], []);
  assert.strictEqual(s.datePassed, false, "SPENT closed it before its date, which is the point");
  // The bytes the arbiter signed are untouched — closure came from the record.
  const after = readFileSync(join(fx.root, `${TICKETS_REL}/${T}.json`));
  assert.strictEqual(sha256(after), tsha, "the door changed the ticket's bytes to close it");
  assert.ok(before.equals(after), "the ticket's bytes moved while the door read it");
  assert.strictEqual(JSON.parse(after.toString("utf8")).expiresAt, "2026-02-01T00:00:00Z",
    "expiresAt was rewritten — the very edit the door refused the arbiter");
});

check("CD-23 · A CHANGE UNDER A SPENT TICKET IS REFUSED, and the refusal NAMES the ticket and says SPENT — not a generic hash mismatch", () => {
  const { fx, repin } = repaired();
  fx.inventory((inv) => inv.repins.push(repin));
  assert.strictEqual(fx.door(DURING).kind, "CLOSED", "precondition: the ticket is spent");
  // A second edit to the very file the spent ticket opened and repaired.
  fx.write(A, "export const a = 4;\n");
  const r = fx.door(DURING);
  expectRefused(r, `ticket ${T} names it but is SPENT`);
  assert.ok(text(r).includes("it authorises nothing further"), text(r));
  assert.ok(text(r).includes("its bytes are unchanged and stay as signed"), text(r));
  assert.ok(text(r).includes(`and it closed before its 2026-02-01T00:00:00Z`), text(r));
  // The named ticket is live by DATE — so this is not the expiry rule doing the work.
  assert.ok(!text(r).includes("EXPIRED"), `the refusal blamed expiry, not spentness:\n${text(r)}`);
});

check("CD-24 · PARTIAL SHIPMENT IS NOT SPENT: one opened file still drifted and un-re-pinned keeps the ticket OPEN", () => {
  const fx = fixture();
  const tsha = fx.ticket(T, { opens: [A, B] });
  fx.write(A, "export const a = 3;\n");
  fx.write(B, "export const b = 9;\n");
  fx.inventory((inv) =>
    inv.repins.push({
      path: A, from: sha256("export const a = 1;\n"), to: sha256("export const a = 3;\n"),
      ticket: T, ticketSha256: tsha, pinnedOn: "2026-01-20",
    })
  );
  const r = fx.door(DURING);
  assert.strictEqual(r.kind, "OPEN", text(r));
  const s = statusFor(r, T);
  assert.strictEqual(s.state, "OPEN", "half a shipment is not a shipment");
  assert.deepStrictEqual([...s.usedUp], [A]);
  assert.deepStrictEqual([...s.outstanding], [B]);
  assert.strictEqual(r.shippable, false, text(r));
  assert.ok(!text(r).includes("SPENT"), text(r));
});

check("CD-25 · THE UNCHANGED OPENED FILE, both ways: left at its pin it SETTLES a ticket that shipped work; but with NO re-pin at all a ticket is never SPENT, however clean the tree", () => {
  // (a) opened, work did not need it: settled, so one untouched file does not
  //     hold the ticket open until its date.
  const fx = fixture();
  const tsha = fx.ticket(T, { opens: [A, B] });
  fx.write(A, "export const a = 3;\n");
  fx.inventory((inv) =>
    inv.repins.push({
      path: A, from: sha256("export const a = 1;\n"), to: sha256("export const a = 3;\n"),
      ticket: T, ticketSha256: tsha, pinnedOn: "2026-01-20",
    })
  );
  const spent = statusFor(fx.door(DURING), T);
  assert.strictEqual(spent.state, "SPENT");
  assert.deepStrictEqual([...spent.usedUp], [A]);
  assert.deepStrictEqual([...spent.atPin], [B], "B was opened and left alone — settled, not owed");

  // (b) NO work at all: every opened file is at its pin, and the ticket is NOT
  //     spent. Writing a ticket must never be the same act as spending it.
  const fresh = fixture();
  fresh.ticket(T, { opens: [A, B] });
  const r = fresh.door(DURING);
  assert.strictEqual(r.kind, "OPEN", text(r));
  const s = statusFor(r, T);
  assert.strictEqual(s.state, "OPEN", "a ticket with no re-pins read SPENT — no work had happened");
  assert.deepStrictEqual([...s.usedUp], []);
  assert.deepStrictEqual([...s.atPin], [A, B]);
});

check("CD-26 · SPENT and EXPIRED are TWO WORDS FOR TWO FACTS — and a spent ticket still names its expiry rather than swallowing it", () => {
  // unspent, past its date: EXPIRED, and it never says SPENT.
  const un = fixture();
  un.ticket(T);
  const expired = un.door(AFTER);
  const es = statusFor(expired, T);
  assert.strictEqual(es.state, "EXPIRED");
  const eLine = stateLine(expired, T);
  assert.ok(/\bEXPIRED\b/.test(eLine), eLine);
  assert.ok(!/\bSPENT\b/.test(eLine), `an EXPIRED ticket printed the word SPENT: ${eLine}`);

  // spent, before its date: SPENT, and it never says EXPIRED.
  const { fx, repin } = repaired();
  fx.inventory((inv) => inv.repins.push(repin));
  const early = fx.door(DURING);
  assert.strictEqual(statusFor(early, T).state, "SPENT");
  const sLine = stateLine(early, T);
  assert.ok(/\bSPENT\b/.test(sLine), sLine);
  assert.ok(!/\bEXPIRED\b/.test(sLine), `a SPENT ticket printed the word EXPIRED: ${sLine}`);

  // spent AND past its date: still SPENT (that is why it closed, and it closed
  // first) — with the date fact carried beside it, not collapsed into it.
  const both = fx.door(AFTER);
  const bs = statusFor(both, T);
  assert.strictEqual(bs.state, "SPENT");
  assert.strictEqual(bs.datePassed, true, "the expiry fact was lost");
  const bLine = stateLine(both, T);
  assert.ok(/\bSPENT\b/.test(bLine) && bLine.includes("2026-02-01T00:00:00Z") && bLine.includes("has also passed"), bLine);
});

check("CD-27 · WHICHEVER COMES FIRST: expiresAt still closes an unspent ticket on time, SPENT closes a shipped one early, and both are printed", () => {
  // the clock, doing its unchanged job on a ticket whose work never shipped
  const un = fixture();
  un.ticket(T);
  assert.strictEqual(statusFor(un.door("2026-02-01T00:00:00Z"), T).state, "OPEN", "still inside its window");
  assert.strictEqual(statusFor(un.door("2026-02-01T00:00:01Z"), T).state, "EXPIRED", "one second later, closed by the clock");
  // the record, closing a shipped ticket eleven days early
  const { fx, repin } = repaired();
  fx.inventory((inv) => inv.repins.push(repin));
  assert.strictEqual(statusFor(fx.door("2026-01-20T12:00:00Z"), T).state, "SPENT");
  // expiresAt has not lost its other job: it still bounds a re-pin's date.
  const late = repaired();
  late.fx.inventory((inv) => inv.repins.push({ ...late.repin, pinnedOn: "2026-02-02" }));
  expectRefused(late.fx.door("2026-02-03T00:00:00Z"), "after the ticket expired");
});

check("CD-28 · THE OVERLAP TRAP, SHUT: with a SPENT ticket and a LIVE one open at once, an edit reaching the spent ticket's file is REFUSED by its name — it cannot ride in on authority whose work is done", () => {
  const fx = fixture();
  const tshaA = fx.ticket(T, { opens: [A] });          // shipped and re-pinned
  fx.ticket(T2, { opens: [B] });                        // live, work not started
  fx.write(A, "export const a = 3;\n");
  fx.inventory((inv) =>
    inv.repins.push({
      path: A, from: sha256("export const a = 1;\n"), to: sha256("export const a = 3;\n"),
      ticket: T, ticketSha256: tshaA, pinnedOn: "2026-01-20",
    })
  );
  const settled = fx.door(DURING);
  assert.strictEqual(statusFor(settled, T).state, "SPENT");
  assert.strictEqual(statusFor(settled, T2).state, "OPEN");
  assert.strictEqual(settled.kind, "OPEN", "the second ticket is still live, so the core is open under IT");
  assert.deepStrictEqual((settled as { live: readonly { id: string }[] }).live.map((t) => t.id), [T2],
    "a spent ticket must not be counted live");

  // Now the work under the LIVE ticket also touches the SPENT ticket's file.
  fx.write(A, "export const a = 4;\n");
  const r = fx.door(DURING);
  expectRefused(r, `ticket ${T} names it but is SPENT`);
  assert.ok(text(r).includes(`ticket ${T2} does not name this file`), text(r));
  // The live ticket's own file is untouched, so nothing is blamed on it.
  assert.ok(!text(r).includes(`DRIFT ${B}`), text(r));
});

console.log("\n── the core door · THIS tree ─────────────────────────────────");

check("CD-SELF · the inventory and the tickets live OUTSIDE the core they pin", () => {
  for (const p of [INVENTORY_REL, TICKETS_REL]) {
    assert.ok(!(p + "/").startsWith(CORE_SCOPE + "/"), `${p} is under ${CORE_SCOPE}/ — the door would pin itself`);
  }
});

check("CD-WIRED · the machine relay's acceptance (glue.test.ts) calls the real door", () => {
  const glue = readFileSync(join(REPO_ROOT, "src", "glue", "glue.test.ts"), "utf8");
  assert.ok(
    /check\("the core door:[^"]*",\s*\(\)\s*=>\s*\{\s*requireShippable\(evaluateRealDoor\(REPO_ROOT\),/.test(glue),
    "glue.test.ts no longer runs the door as a check; the acceptance would not see drift"
  );
});

check("CD-LIVE · src/mica/** against the pinned inventory, now", () => {
  const r = evaluateRealDoor(REPO_ROOT);
  for (const l of r.lines) console.log(`      ${l}`);
  assert.notStrictEqual(r.kind, "REFUSED", "the core drifted without a live ticket — see the REFUSED lines above");
});

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
