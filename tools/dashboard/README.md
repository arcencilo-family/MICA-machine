# The MICA machinery dashboard

**The generator is the deliverable. The HTML is a by-product that goes stale the
moment anything on disk moves.**

---

## Regenerate

```
npx ts-node tools/dashboard/generate-dashboard.ts
```

Writes `tools/dashboard/mica-dashboard-<YYYYMMDD-HHMM>.html` — one self-contained
file, inline CSS, no network dependency of any kind. The `dashboard` and
`outsider` registers carry no JavaScript; the `operator` register carries exactly
one inline script, for the sound, with no network. It opens from
disk in any browser. Prior outputs are never overwritten; each run gets its own
timestamp, and old ones should be kept or deleted deliberately, never silently.

Environment overrides, all optional and all defaulting to siblings of this repo:

| variable | default | what it is |
|---|---|---|
| `MICA_WORK_NOW` | `../MICA-4-gates/work-now` | the board, the ledger, the audit, the sweep |
| `MICA_ILAS_ROOT` | `../ILAS` | the ILAS checkout (any subdirectory containing `src/`) |
| `MICA_OUT_DIR` | this directory | where the HTML lands |
| `MICA_REGISTER` | `dashboard` | `dashboard`, `outsider` or `operator` — see *Layering*, below |
| `MICA_NOTICE_BOOK` | none | `operator` only: path of the notice book (JSONL). Undeclared prints as undeclared |
| `MICA_REPLY_BOOK` | none | `operator` only: path of the reply book (JSONL). Undeclared prints as undeclared |
| `MICA_DOCTOR_HISTORY` | none | `operator` only: path of the doctor history (JSONL), for the latest `DOCTOR_ATTESTATION` |

Setting any of them to a path that does not exist is a supported way to check that
the generator fails **visibly**: every unread source becomes a printed hole on the
page, never a skipped section.

---

## What it touches

**Reads, never writes:** everything under `src/`, `package.json`, the suite
transcript the board names, and four files in the vault (board · sweep · park
audit · deferrals ledger), plus the ILAS checkout's `src/` tree and `README.md`.

**Writes:** exactly one file, in this directory.

**Never:** imports from `src/`, executes instrument code, or requires the repo to
compile. Instrument self-descriptions are lifted as **text** by a brace-aware
scanner, so a module that does not compile still renders — as itself, with its
own failure printed. `package.json` is read and never edited. No dependency is
added; the generator uses `fs`, `path` and `crypto` only.

The generator lives outside `tsconfig.json`'s `include` (`src/**/*`), so
`npm run typecheck` and `npm run build` neither see it nor are affected by it.

---

## What is read, and what each source is trusted for

| source | what is taken from it |
|---|---|
| `src/**/*.ts` | every top-level `const` (exported and module-private) lifted as text; each instrument's `*_TITLE` / `*_SCOPE_TITLE`, `*_READS` / `*_SCOPE_READS`, ceiling / does-not-see / scope-lines constants, `*_COMPETENCE_LINES`, blind-reason unions, and the fence constants (`ROUTING_PRECONDITION`, `RELEASE_IS_NOT_SAFE`, `DISPOSITION_DOES_NOT_ATTEST`, `DELIVERY_FAILS_CLOSED`, `CHOKEPOINT_SCOPE_LINES`). Where a module states these INLINE at a `formatScopeBlock(…)` call site rather than exporting them, the call site is read instead, and the page says so. |
| `package.json` | the ordered file list inside `test:mica` — the only on-disk statement of which test file is which suite slot |
| the suite transcript the board names | re-summed here, block by block, from the bytes: byte count, SHA-256, CRLF/LF census, per-file totals. The board's figures and this re-sum are printed side by side. A disagreement is **rendered, not reconciled**. |
| every `mica-suite-*.txt` in the repo root | `stat` only, never read. If one is **newer** than the transcript the board names, the page says so as a hole. The generator reads the board's choice and will not quietly prefer a newer file. |
| `ARC_MICA-BOARD.md` | the **topmost** `last-pass` block only: pass name, date, tally, WATCH, suite-of-record name + SHA + bytes + per-file count, `[owed]` markers. Plus the §2a table, for the few module↔sweep-row joins it carries. |
| `ARC_MICA-INVENTORY_Full-Function-Sweep_20260806.md` | all 57 sweep rows: id, function name, instrument, reads-verdict, note |
| `ARC_MICA-AUDIT_Park-Inventory_20260821-74.md` §5.1 | which sweep rows the 34 retains, per layer |
| `ARC_MICA-LEDGER_Deferrals*.md` (newest match) | every ledger row: id, status, subject, reason, unblock condition |
| the ILAS checkout | module directory structure, README section headings, the L0 `loadState` table, and the README's own *Threat model*, *What it is NOT*, *L0 durability & S-4 anchor readiness*, and *Named external dependencies* sections, verbatim |

Nothing is transcribed from the dispatch brief. Where the brief and the disk
disagree, the disk wins and the disagreement is what gets rendered.

---

## Two things about the suite that the page refuses to smooth

**The suite reports in two dialects.** Thirty-one test files end their run with
`<n> tests: <p> passed, <f> failed`. `src/clerk/clerk.test.ts` — added to
`test:mica` on 2026-08-22 by the arbiter's ruling — ends with `<p> passed, <f> failed`
and no total. The generator counts **both**, marks each block's dialect in the
per-file table, and renders the split as a hole. An awk-sum written against the
first shape alone silently omits the clerk's 72 tests; the page says so in those
words rather than normalising the difference out of sight.

*Caveat, stated:* a bare `<p> passed, <f> failed` line appearing anywhere else in
a transcript would be read as a per-file block. Today exactly one file emits that
shape, and the slot-count check (`test:mica` entries vs parsed blocks) fires
loudly if the two ever stop matching.

**The board's suite of record can lag the disk.** The dashboard reads the
transcript the *board* names — that anchoring is the point, and no newer file is
silently preferred. When a newer transcript exists, the page prints a hole naming
it, and every `CERTIFIED-AT-BYTES` badge on that page is understood to be against
the older one. A newly registered test file therefore shows as **registered in
the suite and outside the certification** until a board pass names a transcript
that covers its slot. That is not a defect; it is BR≠TR holding.

---

## The five states, and how they are assigned

The vocabulary is negative-attestation-native. There is no state that says a
thing is good, safe, healthy, or working, and there is none for the dashboard
either.

- **CERTIFIED-AT-BYTES** — the module's own `*.test.ts` is listed in
  `test:mica`, the positionally-corresponding per-file block of the named suite
  transcript reports `0 failed`, and the generator re-summed that transcript
  itself. *A statement about tests passing. Never about safety.*
- **CEILING-LIMITED** — the module carries at least one ceiling / does-not-see /
  scope-lines statement, and it is printed verbatim on the node, one click away.
  A module with none renders that absence as a hole.
- **BLIND-CONFIGURABLE** — the module declares a blind-reason union containing at
  least one code that fires on an absent, vacuous or malformed *injected*
  declaration. The codes are listed: they are what un-configures it.
- **PARKED** — named in the deferrals ledger with a status that is not
  BUILT/CLOSED. The ledger id and the stated reason ride the node, verbatim.
- **UNBUILT** — a sweep row inside the 34 whose own reads-verdict is `NO`, which
  the sweep defines as *“canon names the gap and states no instrument exists.”*
  The blocker is the sweep's own note, quoted.

The states are **not** mutually exclusive, and the page does not pretend they
are: a built instrument is CEILING-LIMITED whether or not it is also
CERTIFIED-AT-BYTES. Every applicable badge is shown.

---

## What this dashboard CAN claim

- That, at generation time, these files existed, hashed to these values, and
  contained this text.
- That the named suite transcript, re-summed from its own bytes, reported these
  per-file counts and this many failures.
- That the board's topmost pass stated these figures, and that they did or did
  not match the re-sum.
- That these modules on disk print these ceilings, in these words.

## What it CANNOT claim, and does not

- **Nothing about health, safety, correctness or fitness.** Not of MICA, not of
  ILAS, not of any observed system, not of itself. There is no green on the page.
- **That the 34 and the modules on disk correspond.** They are shown as two
  columns because nothing on disk joins them — see below.
- **That the 34 is complete or correct.** It is assembled here from two documents
  and inherits every defect in either.
- **That an instrument does what its ceilings say it does.** The page quotes what
  the code *says*; it does not execute the code and cannot check the claim.
- **That the repository compiles, that the tests pass now, or that the transcript
  it read corresponds to the code it read.** The transcript is a historical
  artifact. Nothing here re-runs anything.
- **That anything is still true.** It was true of some bytes, once.

---

## The 34-list finding, restated here because it survives the HTML

There is **no single machine-readable list of the 34 anywhere on disk.** The
denominator is assembled at generation time from two documents read against each
other: the sweep (57 rows, by name) and the park audit's §5.1 table (which rows
each layer retains). The assembly yields **33 row ids**, against a declared 34 —
the missing member is the **clerk layer**, which post-dates the sweep, is inside
the denominator, and has no row id at all. It cannot be rendered as a row; it
appears on the page only as a hole.

Worse, and separately: **nothing on disk maps a sweep row to a built module.** No
source file names a sweep row id. The board's §2a table names a sweep row in only
three of its thirteen module cells. The correspondence between *“the 34 named”*
and *“the modules on disk”* is house-held knowledge that exists in no file, and
the dashboard therefore refuses to draw it.

---

## Layering

Every string the dashboard speaks in its own voice — as opposed to text lifted
from disk — lives in one register object at the top of the generator, separated
from layout. The switch is wired:

```
MICA_REGISTER=outsider npx ts-node tools/dashboard/generate-dashboard.ts
```

The `outsider` register is **stubbed by ruling**: every string returns
`[outsider register: later pass]`. No outsider content was written in this pass.
The lifted-from-disk content is register-independent and renders identically in
both — an instrument's ceilings are its ceilings.

### The `operator` register (wire-v01 W3)

```
MICA_REGISTER=operator MICA_NOTICE_BOOK=<path> MICA_REPLY_BOOK=<path> \
  npx ts-node tools/dashboard/generate-dashboard.ts
```

Writes `mica-operator-<YYYYMMDD-HHMM>.html`. Code: `operator-register.ts`; test:
`tools/dashboard/operator-register.test.ts`. It reads only the books named by the
three variables above, parsed raw: **it verifies no chain**, and says so on the
page. It shows each raising in sequence order, its replies by role or
`no reply on record`, and its age as a count of notice-book records after it. No
wall-clock time is printed: no witness arrival stamp is joined in this build.

The light is **red** when any raising has no reply on record. When every raising
has one it is **grey**, not green, and says that a reply recorded is not a
reading, an agreement or a remedy. A raising the page read and could pair with
no reply keeps the light red even when the reply book is undeclared or
unreadable (the card says so), so a missing file cannot silence it; a declared
reply book that does not exist yet reads as one with no records. Otherwise an
undeclared or unreadable book, or a line that does not parse, is **cannot
see**. A reply pairs with a raising only when
both its sequence number and its hash match; otherwise it is listed apart.

The page is named to the minute and written exclusively: a second run in the same
minute is refused with `NOT WRITTEN` and exit 1, and the earlier page is left as it
was. The sound needs one click to arm (browsers block autoplay); the red light works
without it. The one inline script opens no connection and loads nothing.

---

*The dashboard is a thermometer for the thermometer-makers. It gets ceilings too.
Regenerate; do not trust.*
