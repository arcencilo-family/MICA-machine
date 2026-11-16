# tools/probe — the Tier 2 probe harness (one shape, built once)

Tier 2 means a gate's reading has been put to a costly, pre-registered test whose answer was sealed before the case was
delivered, and scored by someone who did not build it. **Per gate only the CASE and the PREDICTION differ**; every other
part is here and shared. This tree carries no subject, uid, path, item, origin, window or probe text: every place is an
argument (the fence in `probe.test.ts`). The shape is public; a case's text, the item it names and its moment are sealed.

| part | file | hand | what it does |
|---|---|---|---|
| CASE + PREDICTION | `case.md`, `prediction.json` in a case directory **outside the vault** | the seat | the case as it will reach the subject; the table the gate must read, its mechanical `conditions`, the gate's name |
| SEAL | `seal.ts` | the seat | a fresh 256-bit nonce on each file, 0400 files, 0500 dir, the SEALED line (sha256 of case, prediction, rubric) |
| REGISTER | `register.ts` | each hand its own line | the only writer: SEALED / WINDOW / SCORED, one line per event, each citing its case's previous line; append-only, prefix byte-checked, dry-run unless `--write` |
| WINDOW | `window.sh` | **the arbiter** (tty, `--go`) | writes the window (nonce, START, END ≥ 6 h, inside the served pilot) into the case directory; the register gets its sha only (committed, revealed at SCORED) |
| DELIVERY | `stamp-delivery.sh` | **the arbiter** (tty, `--go`), right after delivering | writes `delivered-at` into the case directory, once; never the register, never a directory the subject can traverse |
| CAPTURE | `capture.sh` | anyone on the operator route, after the window | GET only; status, log tail, the window's decisions and their explain, events, the witness's book and predecessors, the roster, the operator's word; MANIFEST + its committed sha; INCOMPLETE (exit 4) when the log tail cannot reach back or /events has a gap — pages on the last RETURNED seq, never `lastSeq` |
| VERIFY | `verify.ts` | anyone | mechanical: seal, capture, window, completeness (incl. contiguous event seqs), the declared conditions → `SCORABLE` (exit 0) or `VOID · <reason>` (exit 3; 1 is a usage error); it never scores |
| SCORER | `scorer-brief.ts`, `RUBRIC.md` | a cold seat | the brief names the only files the scorer may read, with their sha256, and the one file it writes (`score.json`) |

**Adding a gate's case** = writing one `case.md` and one `prediction.json` (rows selected from the witness's records alone;
the exact words copied from the served reader with file:line; the mechanical conditions as `{n, what, source, path, op,
value}`, sources `status` / `instrument` / `operator-word`). Nothing in this directory moves.

**Order of a probe:** seal (seat) → window (the arbiter) → deliver, then stamp (the arbiter) → capture (after the window) → verify →
scorer brief → cold scorer → SCORED (the audit). A SCORED line quotes the scorer's file and cites its sha; on a broken seal
the register books nothing but `VOID · SEAL BROKEN`; and `scored` re-derives verify's verdict (it takes `--rubric`), refuses a
verify file that differs from it, and on any `VOID · <reason>` books nothing but that same VOID. Promotion is a register fact the audit reads; the print names its
branch (ALARM BRANCH READ, or SILENT BRANCH ONLY). REHEARSAL lines are never counted.

Run any script with the machine's ts-node (`node node_modules/ts-node/dist/bin.js -T tools/probe/<script>.ts …`).
