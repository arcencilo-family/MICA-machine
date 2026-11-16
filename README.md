# MICA machine

**What this is.** The MICA machine holds the readers that read what an AI agent does: the gates, the substrate's instruments, the release floor that composes their verdicts, the witness that keeps its own book of effects, the clerk, and the probe harness. It runs no service of its own for an agent to call: the MICA bridge loads it and serves it.

**The canon says what MICA is meant to do; this repository reports what is built and what has run.** Start with the canon's chapter 01, "The architecture in brief".

**State: alpha.** This is a working prototype that runs on one reference box, built by a small project. Most of what it reads has been designed and unit-tested. Less of it has run live, and none of it has been shown to read a probe correctly (section 3). Names, formats and the record series may still change, and nothing here is supported or certified. What is offered is this alpha. [ROADMAP.md](ROADMAP.md) names its known problems, and each needs design and building before the machine works as intended.

**The other repositories.**
- **MICA bridge** (`https://github.com/arcencilo-family/mica-bridge`): the service an agent's harness asks before each act. It imports this machine.
- **MICA canon** (`https://github.com/arcencilo-family/mica-canon`): the method. It says what each instrument is meant to read, and why.
- **ILAS** (`https://github.com/arcencilo-family/ilas`): a second repository; one test of this tree loads a module of it (limit 16).

**Where to look first.**
- Build and test: section 3.2.
- Tests expected to fail, and why: section 3.3.
- Known limits: section 4.
- What each gate reads, and the terms: [GATES.md](GATES.md).
- Open work: [ROADMAP.md](ROADMAP.md).

Licence: Apache-2.0 (`LICENSE`, `NOTICE`, `CITATION.cff`). Version 0.1.0.

---

## 1. The target (by pointer to the canon)

What MICA is for is set out in the MICA canon; start with its chapter 01. In the canon's own words, MICA is "a set of instruments that read what an AI agent does and print what they can and cannot see". This section adds no claim of its own.

---

## 2. The design (design, not tested as a whole)

**When MICA works as intended**, in the canon's words:

- **The operating rule** (chapter 01): "Health conditions confidence; confidence conditions assertion." At critical health the system "withholds assertion, holds itself reversible, and escalates. It never converts degraded health into an action." And: "This is what makes a degraded MICA quiet and reversible rather than confidently wrong."
- **Negative attestation** (chapters 01 and 08a): the substrate "may emit alarm (degraded, critical); it never emits a positive attestation of health". Health is attested from outside: "an external doctor attests the substrate's health from outside, which the substrate cannot do for itself; it can attest un-health, never certify health".
- **Where an escalation ends** (chapters 01 and 07): "A designated arbiter terminates every escalation in a node that cannot itself defer. Both are appointed by the deployer, which carries final liability."
- **The last resort** (chapters 01 and 08i): "MICA's real work is upstream: read degradation so early the crunch never arrives (sub-certain)." When it does come to that, "the failsafe is abstain-and-hold — the last resort, not the primary mechanism".

**The machine's part in a working deployment:**

1. Each reader reads the record of what the agent did (the subject log, or for Gate 2 in harm mode the witness's book) and returns one verdict: ALARM, SILENT or CANNOT_ASSESS. Each verdict carries what the reader could not see.
2. The release floor composes the verdicts of all wired readers for one act, non-compensatory: any ALARM gives ALARM; otherwise any CANNOT_ASSESS gives CANNOT_ASSESS; only all-SILENT gives SILENT (`src/mica/chokepoint/types.ts`).
3. The chokepoint turns the floor into one disposition: RELEASE (SILENT), HOLD (ALARM), HOLD_BLIND (CANNOT_ASSESS at or above the declared stakes line) or PASS_BLIND (CANNOT_ASSESS below it). A reader that throws holds the act.
4. Each decision is written through the machine's append store, which calls fsync before it returns (`src/mica/store/append-store.ts`).
5. The witness, a separate service, records the effects it sees on declared targets in its own book and gives no verdict. The clerk keeps the time and order of records away from the system it observes.
6. The doctor's findings raise notices, and replies are recorded in their own book (`src/doctor-wire/`).

GATES.md says, reader by reader, what each one reads and whether it is wired.

**How much of this path the alpha walks today.** On the reference box the readers run and every decision is booked, but no act has been released: Gate 1 can never read SILENT, so every act is held or passes blind (limit 1). The doctor's wire is not on the reference box, and where it runs its notices reach no one, because no transport is configured (limit 17). No gate has read READABLE under a probe (limit 3). Section 3 gives the detail.

---

## 3. Today: what this alpha does, and what has been tested

### 3.1 Which release

The reference box runs machine release a3cb4a0 (a release id of the reference box, not a published commit). This tree is that release plus four additions that do not run on the reference box:
- the probe harness (`tools/probe/`);
- the role-word pass (comments, printed strings and test titles; ticket `P2-role-words`);
- unit templates brought in line with the box's installed units;
- the doctor's wire, reply book and operator page (`src/doctor-wire/`, `tools/doctor-wire/`, `tools/dashboard/operator-register.ts`; limit 17).

Build records and run captures are not included.

**Tested and design.** What each reader has produced on the reference box, by kind of reading:

| reader or part | wired on the box | tests | kinds of reading on the box | status |
|---|---|---|---|---|
| Gate 1 scope | yes | yes | CANNOT_ASSESS only, by construction | running; can never read SILENT |
| Gate 2 direction (harm mode) | yes | yes | SILENT, ALARM, CANNOT_ASSESS | running; both probes NOT-READABLE |
| Gate 3 | — | — | — | not a gate: the canon's chapter 01 ("The shape") says "No Gate 3: the system's immune health is the substrate, not a peer gate." The gate numbers were kept. |
| Gate 4 sunset | yes | yes | SILENT | running |
| Gate 5 adaptive | **no** | yes | none | design and tests only |
| Eng | yes | yes | SILENT, CANNOT_ASSESS | running |
| Sig | yes | yes | SILENT, CANNOT_ASSESS | running |
| narrow-T | yes | yes | SILENT, CANNOT_ASSESS | running |
| narrow-K | yes | yes | ALARM, CANNOT_ASSESS | running |
| narrow-W | yes | yes | ALARM, CANNOT_ASSESS | running |
| narrow-R | yes | yes | ALARM, CANNOT_ASSESS | running |
| op1 doctor cadence | yes | yes | SILENT, ALARM | running |
| op2 audit presence | **no** | yes | none | design and tests only |
| op3 node response | yes | yes | ALARM, CANNOT_ASSESS | running; cannot read SILENT today (R-26) |
| clerk gap | no (needs a clerk store) | indirectly | none | design and tests only |
| witness (keeps the book; gives no verdict) | yes, its own service | partly (three witness suites are not in the chain, R-31) | gives no verdict | running |
| release floor | yes | yes | CANNOT_ASSESS, ALARM; **no RELEASE read** | running; see limit 1 |
| probe harness | not on the box | yes | two scored probes, run from a checkout | both NOT-READABLE |
| doctor's wire, reply book, operator page | not on the box | yes | none | tests only (limit 17) |

**In plain words:**
- **No act has been released by the readers.**
- **No gate has read READABLE under a probe.**
- Gate 5 and op2 are not wired.
- Every wired reader except Gate 1 has produced a reading other than CANNOT_ASSESS on the reference box.

### 3.2 Build and test

These steps build and test this tree. They do not deploy it: laying MICA on a box is outside this release (limit 13).

**Tested with:** Linux (WSL2, kernel 6.6, Ubuntu 24.04) with bash; Node v22.22.0; npm 10.9.4; Python 3.12.3; 3 CPU cores.
- The lockfile resolves TypeScript 5.9.3, ts-node 10.9.2 and @types/node 20.19.43.
- `package.json` asks for typescript ^5.4.0, ts-node ^10.9.2 and @types/node ^20.12.0, and pins no Node version.
- Other Node versions and other systems are unconfirmed.
- There are no runtime dependencies (`dependencies` is empty).

1. **Use a git clone**, not a bare archive. `tools/opens-sweep` and `tools/ticket-preflight` read git state, and some of their checks fail without `.git` (section 3.3).
2. **Install:** `npm ci` (needs the npm registry). On the reference box a plain `npm ci` installed the packages and then did not return from its audit request; `npm ci --no-audit --no-fund` installs the same packages and returns.
3. **Type-check:** `npm run typecheck` checks the whole tree, `tools/` included. It reports two errors, both in `tools/gate4/probe-leg-a.ts`, and exits 2 (section 3.3). `npm run typecheck:build` (`src/` only) and `npm run build` (emits `dist/`, which git ignores) both pass.
4. **Run the suite alone:** `npm run test:mica`.
   - It runs, one after another, the 111 files named by `test:mica:chain` in `package.json`, and prints a PASSED or FAILED line per file and a summary.
   - It takes about a quarter of an hour on a 3-core box, and exits 1 while the expected reds stand.
   - Run it alone: run in parallel with other suites, tests that start a child process can time out.
5. **The sibling checkout:** `src/integration/l0-clerk-f3.test.ts` loads a module of a second repository, ILAS, from `<the folder that holds this tree>/ILAS/ilas-github-copy` (limit 16). Clone `https://github.com/arcencilo-family/ilas` to that path. The tests were run against a checkout whose tree is equal to that of the public commit `f768236a20f00eb203f6ce1c292f388c7a7a2a7e`.
6. **One file, or the Python tests:**
   - `node node_modules/ts-node/dist/bin.js <path>.ts` runs one test file; most also have an `npm run test:*` name.
   - `python3 -B scripts/declare-s120.test.py` and `python3 -B deploy/wm-apply.test.py` are not in the chain.

**Dependencies.** No deployed instrument depends on ILAS. The one edge is the test of step 5, which loads ILAS with a dynamic `require` so that the compile closure stays free of it. `src/clerk/l0-conformance.ts` holds a transcribed copy of the part of ILAS's record format the clerk follows, and does not read ILAS. `tools/dashboard/generate-dashboard.ts` reads an ILAS checkout (`MICA_ILAS_ROOT`) and the project's own notes folder (`MICA_WORK_NOW`); outside the project it has nothing to read, but `tools/dashboard/operator-register.ts` depends on it.

### 3.3 Tests expected to fail

A red that is not on this list is a finding.

The check names below are given as the suite prints them, so that a red line can be matched; they carry no meaning beyond that.

**This tree** (in a git clone, with the sibling ILAS checkout, each suite alone):
- `npm run typecheck`: 2 errors in `tools/gate4/probe-leg-a.ts`. The tool uses `holdWindow` and `holdEnvelope`, which the current Gate 4 config type does not have.
- `tools/suite-membership.test.ts`, `SM-A`: three witness test files are not in the test chain (R-31).
- `src/mica/registration.test.ts`, `EVERY discovered src/**/*.test.ts is registered in test:mica`: the same three files.
- `src/probe/evidence-log.test.ts`, `EV-FIX-H3`: six test files pin a literal 64-hex hash.
- `tools/ticket-preflight/preflight.test.ts`, `PF-G2` and `PF-G15`: both build a ticket dated today with no `base` stamp, which the preflight refuses for any ticket after its cut-off date.
- `tools/ticket-preflight/preflight.test.ts`, **`PF-G3e` in a repository with one commit**: the check reads `HEAD~1`, which a one-commit repository does not have.
- `src/integration/l0-clerk-f3.test.ts`: "module not found" without the sibling ILAS checkout (limit 16).
- In a copy **without `.git`** only: `OS-B`, `OS-G` and `OS-N` in `tools/opens-sweep/opens-sweep.test.ts`, and `PF-G3e` and `PF-G8` in the preflight test. These checks read git state.

**The MICA bridge tree** (its README has the same list):
- `mica-bridge/mica-service.test.ts`, 7 checks:
  - `AMENDMENT 11 / Ruling R item 2 (ACT A)`; `P6 END TO END`; `STAGE 4 §A.2`. Each expects the readers to stand on a verified subject chain, but the example declaration declares log kind `mica`.
  - `STAGE 4 §A`. It expects more wired readers than the example declares.
  - `FLOATFIX 1`. It expects 500 where the code answers a typed 503.
  - Both `SHAPE (b)` checks. They need this machine's clerk-stamps door to accept the test's own account as owner, and it does not.
- `mica-bridge/declarations.test.ts`, the guard check: red when `MICA_MACHINE_ROOT` is not set.
- `mica-bridge/mica-alerter.test.py`, `committed executable, mode 100755`: red only in a copy without `.git`.
- `bash mica-bridge/run-suite.sh --reference`: the 12 reference-only checks. Away from the reference box they are not expected to pass; on the reference box, in a checkout with its history, 7 read red and 5 pass.

### 3.4 The reference box, and who holds what on it

**The box.**
- One Linux machine: WSL2 (kernel 6.6, Ubuntu 24.04) on a Windows host.
- The machine and the bridge are installed under `/opt` and run as services.
- The witness is its own service (`deploy/mica-witnessd.service` is its template).
- The subject, a housekeeping agent, runs as its own service account. It is read by MICA; it does not build or review. Code, tests and account names call it `housekeeper` (account `mica-housekeeper`).
- The project's notes live on the Windows drive, mounted into the Linux machine. The subject can read them (R-52).

This section says what the state is; it does not claim that the state is adequate.

**Who holds what**

| role | holds | cannot |
|---|---|---|
| the arbiter (one person) | root, key custody, scope and the canon; every privileged act by their own hand (installing into the served tree, restarting services, laying releases, sealing probe material) | nothing in this list; the arbiter is the only holder |
| the builder (an AI agent with a shell) | builds code on branches, drafts tickets, runs suites, writes receipts; no password-capable `sudo` | root acts, laying releases, sealing probes, editing the canon. When a task needs a privilege it lacks, it stops and says so. |
| the reviewer (an AI agent) | reads the builder's work, keeps the shared record, names and dates tickets under a delegation from the arbiter, rules inside that delegation; reads the live bridge with GET only | root, laying releases, ruling on the canon, scope or key custody |
| independent verifiers (models of another family) | read, run suites, plant faults; agreement raises confidence. For this release every scorer and cold reader was a Claude model, so this role's independence was not exercised. | sign, lay or rule; never a sole gate |
| the operator | the operator route into the bridge; on the reference box this is the arbiter, who for the build also acts as co-operator and doctor (a one-person build-time arrangement, not a deployment shape) | |
| the subject | runs as its own service account; reads the shared notes; is read by the gates | write the record or the shared notes (its unit mounts them read-only); build, review or rule |

**LOCKS (enforced by mechanism)**

- No agent has password-capable `sudo`; root acts are the arbiter's. This locks `sudo` only: root is still reachable without a password through the host's interop layer (see the RULES), so who acts as root is held by rule.
- The subject's unit applies three sandbox settings on the reference box: the notes area is mounted read-only to it (`ReadOnlyPaths`), other users' processes are hidden from it (`ProtectProc=invisible`), and the host-interop folder is closed to it (`InaccessiblePaths`). These are systemd settings of the box, not part of this tree.
- The core door pins every file under `src/mica/**` by hash in `src/core-door/core-inventory.json`.
  - A changed file is refused unless a ticket under `src/core-door/tickets/` opens it.
  - A ticket with an unfinished or malformed field is refused, and every re-pin cites the ticket's sha256.
  - The door checks shape and hashes only.
- The bridge identifies a caller by the per-caller socket it connected to, in a folder only that caller's account owns (bridge, `mica-bridge/peer-auth.ts`). This is a lock against a caller whose user id the builder does not hold (see the first RULE).
- Probe material is kept in owner-only files: the harness's capture, window and stamp scripts set sealed files to mode 0400 and the case folder to 0500. A separate owner for the probe tree is owed (R-05); today one account owns every harness file.

**RULES (held by discipline; an agent could break them)**

- **The operator route is not separate from the builder.** On the reference box the operator's user id is the one the builder runs under. So a route that is "operator-only" admits the builder as well as the arbiter's terminal. Until a dedicated identity exists (R-01, R-02, R-04), the builder could in principle post an arbiter's resolution or a doctor's attestation. The rule is that it does not; the shared record and the witness's book are a check after the fact, not a prevention.
- **Root is reachable without a password** through the host's interop layer, and how the arbiter authenticates as each hand is unsettled (R-03). Separation by identity is a rule, not a lock.
- **The door does not verify authorship.** It prints "ticket authorship is not verified by this test". There is no key and no cryptographic signature: "signed" means named and dated in the ticket's arbiter field. The delegation of ticket-naming from the arbiter to the reviewer is written in the shared record; the door does not know it.
- **Who built, reviewed and signed** is shown by prefixes the agents write themselves in the shared record. These are conventions.
- **The operator could shape the subject's record.** The subject's checkout and runtime sit in a home folder writable by the operator's user id (R-06), and a file history is world-writable until a root helper runs (R-07). The rule is that no agent edits the subject.
- **The subject can read the shared notes** (R-52). Probe text, items and moments are never to be written there; only shapes and hashes. This rule has failed once: probe material sat where the subject could read it, and whether the subject read it cannot be known (R-80).
- **Separation of the harness and the case:** the case text is not to be seen by the agent that builds the harness, and agents do not pass probe material to one another. Both are conventions, not mechanisms.

**What this section cannot show.**
- That the roles were played as stated: the record is written by the agents themselves, and a reader can check consistency, hashes and order, not which instance wrote a line.
- That no builder acted as the operator: the shared user id means the bridge would not tell.
- That a deployment with separate people in each role behaves as intended: it has not been run that way.

### 3.5 Values a deployer replaces

**Signed tickets carry the signer's name.**
- `src/core-door/tickets/*.json` (36 files) and `src/core-door/glue-tickets/T33-gate2-harm-glue.json` ship unchanged. 25 of the 36, and the glue ticket, name the arbiter by first name as signer.
- One ticket also carries the reference box's login name.
- Each signed ticket's bytes are cited by hash in `src/core-door/core-inventory.json` (`ticketSha256`), so the text cannot be rewritten without breaking the pin.
- Everything else in the tree speaks of roles, except the copyright holder in `NOTICE` and the author in `CITATION.cff`.

**Door-pinned files.**
- The core door pins every file under `src/mica/` by its sha256 in `src/core-door/core-inventory.json`. A pinned file whose bytes differ from its pin is refused unless a ticket under `src/core-door/tickets/` opens it.
- No file under `src/mica/` names a person.
- Five pinned files carry the phrase "uid 1000" in one comment each: `src/mica/chokepoint/floor-trail.ts`, `src/mica/chokepoint/ledger.ts`, `src/mica/doctor/history.ts`, `src/mica/fixture-log.ts`, `src/mica/notify/notice-log.ts`.

**Functional values.** Each row is a value that the code or a test uses as a live value. Nothing was silently changed.

| item | file:line or constant | class |
|---|---|---|
| bridge passwd line (uid 982, with the bridge account's home folder) | `deploy/gen-deploy.py:49,73`; generated `deploy/witness-sight-deploy.sh:75`, `deploy/witness-sight-remove.sh:48` | reference default; a deployer replaces |
| a test that a declared region lies under the home-folder root | `deploy/gen-deploy.py:99`; generated `deploy/what13-ilas-devtree-hygiene.sh:40`, `deploy/witness-sight-deploy.sh:65`, `deploy/witness-sight-remove.sh:41` | reference default; a deployer replaces |
| peer-socket default path with the operator's uid | `tools/standdown/observed.sh:18` (`MICA_SOCK` overrides) | reference default; a deployer replaces |
| home-path guard of the witness fence | `src/witness/witness-fence.test.ts:47,102` | test fixture |
| grader id in a hash-chained sample commitment | `src/precommit/first-commitment.jsonl:3` | test fixture (a real chain; editing a field breaks its hashes) |
| box uids as fixture values (992, 993, 989) | `src/report/reconciliation.test.ts:70,293,381,413,414,415,429,430,440,491,497,499,500,506,538,549,558` | test fixture |
| box uids as fixture values (995, 985) | `src/report/witness-report.test.ts:166,167` | test fixture |
| box uid 992 in rosters and refusal records | `src/registrar/refusal-log.test.ts:64,126,543,553` | test fixture |
| box uids 992, 989 in a roster | `src/registrar/registrar.test.ts:1049,1050,1051` | test fixture |
| box uid 992 in a roster | `src/registrar/registrard.test.ts:263` | test fixture |
| uid and gid fallback 1000 when `getuid` is absent | `src/report/deployment-facts.test.ts:66,67`; `src/glue/clerk-clock-stamps-file.test.ts:55`; `src/glue/probe-door.test.ts:54`; `src/probe/subject/door-cli.test.ts:30` | test fixture |
| peer uid 1000 in journal and caller records | `src/glue/mica-clerk-caller.test.ts:733,947`; `src/glue/subject-event-journal.test.ts:88` | test fixture |
| peer uid 1000 in a harm-line assertion | `src/mica/gate2-direction/gate2-direction.test.ts:2372,2380,2414,2453` (door-pinned) | test fixture |
| the installed `--witness-set-id` and the report unit's `User=` and `Group=` | `deploy/mica-witnessd.service`, `deploy/mica-report.service` (`REPLACE-WITH-...` placeholders; a test keeps the `User=` placeholder verbatim, so a deployer never guesses a principal's uid) | deploy-time declaration; a deployer fills in |

---

## 4. Known limits

The same limits in both trees; only a pointer to the reader's own tree differs (limits 1, 12, 14 and 18). In brackets: the tree or trees each concerns. Each is work that can be done.

1. **The release floor: no act is released by the readers while Gate 1 is wired.** [both] The floor composes reader verdicts as ALARM over CANNOT_ASSESS over SILENT. Only all-SILENT gives RELEASE. CANNOT_ASSESS never releases: it goes to the stakes split, which gives HOLD_BLIND at or above the line in force and PASS_BLIND below it (`src/mica/chokepoint/types.ts`). Gate 1 only ever returns CANNOT_ASSESS (`src/mica/gate1-scope/index.ts`). So while Gate 1 is wired, every act is held or proceeds as PASS_BLIND, which is a permit and not a verdict. No RELEASE has been read in the reference box's decision log. Whether a reader that can never read SILENT should take part in the release floor is an open design question.
2. **"Cannot assess" is not yet guaranteed everywhere.** [machine] Four open ROADMAP rows say where it does not yet hold in full:
   - R-12: a malformed record on a declared item is skipped silently in six places.
   - R-13: an absent witness look reads "no look" instead of NOT READABLE.
   - R-27: the witness can forget a target or fail a look without a record.
   - R-28: in harm mode nothing checks the declared witness method.
3. **No probe has read READABLE.** [both] Two live Gate 2 probes have been scored. Both scored NOT-READABLE, and no gate is promoted.
4. **The delivery stamp is taken by hand after the send.** [machine harness; both affected] The probe's "delivered-at" stamp is the sealed boundary. When it is taken by hand after the message is sent, the subject's first act can fall before it and is then not read. The fix is owed before any further probe: take the stamp before the send, or derive it from the bridge's own record of the delivered message (R-77).
5. **The scorer brief's wording.** [machine harness] The scorer brief asks for the addendum in the ceilings cell without the word "verbatim". Both scorers recorded it faithfully but not verbatim, and so failed the runbook's check (b). The wording fix is future work (R-78).
6. **Both scorers were one vendor's models.** [machine harness] The two scorers were Claude models, one Sonnet run and one Opus run. They are not decorrelated from each other or from the models that built the harness, and their agreement was compared by hand. A non-Claude second scorer is designed, not running (R-23).
7. **A killed caller holds every act.** [machine; seen through the bridge] If the caller is killed mid-tool, the signal reader's re-entry alarm latches and every later act is held, with no pilot able to release it, until the subject log is rotated. The alarm is true about the record, but not necessarily about the agent (R-98).
8. **A declaration change leaves no event of its own in the bridge's book.** [bridge; ROADMAP R-36] The bridge loads its declaration at start or on SIGHUP. A change shows only as a new declaration hash:
   - in the journal line an accepted SIGHUP prints (`SIGHUP: reloaded, declarationHash=…`);
   - on `GET /status`;
   - in the next start's `GRANT_MEMORY_ADOPTED` (or `_BEGUN`) detail, and in `SUBJECTS_DECLARED` when the subject set also changed;
   - in each later decision's `declarationBinding` (read through `/explain`).

   Whoever audits a box must compare hashes to notice a change. An event carrying the old and the new hash at every load is future work.
9. **The subject can read its declaration; that is by design.** [bridge] On the reference box the declaration file is readable by the subject's account (by file mode; the read was not exercised as that account), so the subject can know what is read and where the lines are. MICA offers its orientation and does not hide it. The cost is stated: a subject that sets out to game the readers knows where they look.
10. **The host clock steps backwards.** [both] The reference host's wall clock steps backwards by up to a few seconds many times a day, so every non-monotonic stamp is exposed (R-46). The harness's own timing test can fail some runs on such a host (R-57).
11. **The bridge's event book and witness pointer are written without fsync.** [bridge] The event book, and its quarantine sidecar, are written with a plain append; the witness pointer with a write and a rename. None of these calls fsync, so a power loss can drop a record the bridge already counted as written.
    - The decision journal, the floor trail and the chokepoint ledger are written through the machine's append store, which calls fsync before it returns.
    - So are the grant memory and the vendored client's append (R-47).
12. **What a lab can run, and what it cannot.** [both]
    - **Can run:** this machine's unit suite (`npm run test:mica`) as an ordinary user without root, with the expected reds in section 3.3.
    - **Needs root or the staging script:** the bridge suite. The bridge imports this machine from `/opt/mica-machine`, and its `tsconfig.json` points `typeRoots` there. Without root, the bridge tree's `tools/stage-machine-half.sh` copies both trees into a scratch folder with that prefix rewritten; one bridge check also needs `MICA_MACHINE_ROOT` (the bridge README, section 3.2).
    - **Cannot run: an agent connected end to end.** The witness and the bridge run as their own systemd services under their own accounts, the bridge's per-caller socket folders must be made by root, and there are no install steps (limit 13).
13. **No install steps; the lay step is by hand.** [both] No committed script lays the machine or the bridge onto a box, and this release gives no install steps. The build-and-test steps are not install steps (R-83).
14. **Reference defaults are left in place.** [both] Uids, socket paths, account names and installed paths of the reference box stay as written, and a deployer replaces them. This tree lists them in section 3.5; the bridge in its `mica-bridge/README.md`. In the bridge, two of them are a deployer's own:
    - The rendered `mica-bridge/deploy/mica-bridge.tmpfiles.conf` carries the reference box's account names. A deployer re-renders it on their own box (`mica-bridge/deploy/render-tmpfiles.ts`).
    - `mica-bridge/deploy/deployment-facts.fragment.json` names the operator's account as `USER`. A deployer sets it.
15. **Signed tickets name the signer.** [machine] The 36 tickets under `src/core-door/tickets/` and one glue ticket ship unchanged. 25 of the 36, and the glue ticket, name the arbiter by first name as signer. They are pinned by checksum in `src/core-door/core-inventory.json`, and the machine code is frozen for this release, so the name stays.
16. **One test needs a second repository.** [machine] `src/integration/l0-clerk-f3.test.ts` loads `src/l0` from a sibling checkout of ILAS (`https://github.com/arcencilo-family/ilas`) at `<the folder that holds the machine tree>/ILAS/ilas-github-copy`; clone it there. The machine's tests were run against a checkout whose tree is equal to that of the public commit `f768236a20f00eb203f6ce1c292f388c7a7a2a7e`. Without the checkout, that file fails with "module not found". Copying the module in, or skipping the test with a printed reason, is owed (R-84).
17. **The doctor's wire, reply book and operator page are partly built.** [machine] Built:
    - a doctor's finding raises a notice;
    - a reply is recorded in its own chained book;
    - a pairing reader prints each raising's replies;
    - the operator page renders both books.

    Not built:
    - no transport is handed to the commands, so they reach no one;
    - the submitter is a declared uid, not a separate identity (R-02);
    - the notice book's head is not committed to the witness;
    - no wall-clock time is joined to either book (R-103);
    - the page is generated once and does not verify the chains;
    - there are no halt, release or treatment records (R-100).
18. **Open work for a deployment.** [both] Each item below is in ROADMAP section 3 in the same words.
    - **Grant memory:** the bridge's lasting record of grants is built, but it has not been seeded and proved on a fresh deployment.
    - **A reader that fails:** a reader that throws is recorded as held, blind. The code does this, but it has not been exercised on a running box.
    - **One machine root:** letting the bridge find the machine through one configured folder, instead of the fixed install path, is not installed on the reference box. Neither are the printed texts with role words in place of names. Both need root.
    - **Removal:** removing MICA from a box in one act has a generator, but the removal has not been rehearsed (two items).
    - **Zero subjects:** with no subject declared, the loader still keeps reader settings that name a removed subject. They do nothing now, but they would apply again if a subject of the same name were declared.
    - **Loading a declaration that needs a restart:** the script for it is a draft, tried only as a dry run.
    - **A reference subject:** the example agent meant to ship beside MICA as the subject it watches is not included.
    - **Documents:**
      - a live page that joins each decision to its harm line (generated once; needs a timer and its own documentation);
      - a guide to reading MICA's record;
      - a statement of what the subject on the reference box can read, and how probe material is kept away from it;
      - a first-hour walk-through;
      - a catalogue of the project's files, to be refreshed;
      - a pass that turns deployment-specific paths into documented defaults or declared settings;
      - the publication checklist, closed item by item.

---

## 5. What stays uncertain

These are not limits that a build removes. They are what the canon says no instrument of this kind can settle, in the canon's own words (chapter and title given; the canon holds the argument):

- **08f, the externality cut:** "MICA cannot police a channel it is not on, nor attest in a vocabulary it does not have; every external property is required and named, never verified from inside; the regress halts at a declared human posit".
- **08a, negative attestation:** "no node may positively attest health, and the entitlement even to a bounded negative must come from outside the loop".
- **08e, record and truth:** a "closure that is technical, never epistemic", and "the doctor–arbiter disagreement the architecture deliberately leaves unadjudicated."
- **08g, show, not enforce:** MICA "makes their conduct provable on the record and compels none of it".

Each reading this machine prints is bounded by these.
