# MICA roadmap

**What this file is.** The known open work on MICA (the machine, the bridge and the probe harness), and what is done. The canon says what MICA is meant to do; this file lists what stands between this alpha and that.

**How to read it.** Every open item is future work. Nothing here is a promise or a date. Item ids (R-nn) are stable and cited from the code and the READMEs; the numbering has gaps. Where a point is not settled, the item says "unconfirmed". Roles: the arbiter decides and holds root and keys; the operator runs the deployment; the deployer is whoever installs MICA elsewhere; the doctor attests health and clears holds; the subject is the agent MICA reads; the audit reviews the build and keeps the register.

---

## 1. Gates and instruments

- **R-09** Errand grants (time-boxed, item-scoped grants that travel with an act) have a reader but no writer; the write path stays closed until R-01 and R-08 exist.
- **R-10** Each Gate 2 harm decision should carry, under its own hash, the list of errand grants the reader was given, so `/explain` can show them faithfully; built privately, it moves the decision hash on every harm decision.
- **R-11** The status census row should print the errand grants handed to the reader.
- **R-12** A malformed record on a declared item is skipped silently in six places today; each should read CANNOT_ASSESS (record not readable), never silent.
- **R-13** An item record with an absent or null witness look should read NOT READABLE, not "no look".
- **R-14** At least 42 verdict-deciding branches have no test that reaches them (25 in Gate 2's defensive parsing); each gap that can change a verdict kind needs its own ticket.
- **R-15** Gate 2 reads one decision at a time, so whether damage persists is NOT READABLE by construction; no design is started.
- **R-16** Three declaration text corrections wait for the next declaration act: the witness-book basis sentence, a missing sentence that the bridge never stores the plain target, and the subject's brief learning that a hold may end.
- **R-17** The glue code (`wire.ts` and its test) changes under a document that is still a draft in form and needs the audit's signature.
- **R-18** Since the release the reference box runs, the harm-exit wording still says only the grant memory holds a grant, which errand records on the chain now contradict; a test pins the phrase, so changing it is a ruling.
- **R-22** Gate 4's leg B verdict is printed by no served route and its alarm branch needs a declared freshness bound; the "refused off-record demand" kind is not built.
- **R-25** Eng, Sig, narrow-T/K/W/R, op1 and op3 have no probe case yet; op2, the clerk-gap reader and Gate 5 are unwired; the "a reader went blind" reader is ruled and not built.
- **R-26** op3 names a permutation input its profile cannot carry and contributes CANNOT_ASSESS to the floor on every decision, which needs a printed ceiling.
- **R-27** The witness can forget a target or fail a look without writing either down; the built change writes a record for each, and starts a new book series when it lands.
- **R-28** In harm mode nothing checks the declared witness method, so a book written under another method would be read without complaint.
- **R-29** The witness's seeing half and retaining half run unlinked; the ask is one tamper-evident record with chain heads kept off the box.
- **R-30** Two add-only canon amendments (the witness "sees and retains"; Gate 2's open edges) wait for the arbiter; in mica-canon they ride as proposed, not as canon.
- **R-31** Three witness test suites are not in the machine's standard test script, so a registration test reads red.
- **R-73** At zero subjects the loader admits leftover reader stanzas (`readers.gate4Sunset`, `nodeResponse`, `doctorCadence`) that still name the removed subject; they are inert but would re-bind if a subject of that name were re-declared, and a hand-written zero declaration is the exposed path.
- **R-74** The reader-throw fix (a throwing reader is booked HOLD_BLIND with reason READER_THREW) is in the machine release the reference box runs and in this tree's code: the seam's catch in `src/glue/wire.ts` (`seamThrew` at line 2495, `seamCatch` at line 2550) records each throw in `readerThrows`; `decideChokepoint` (`src/mica/chokepoint/types.ts:376`) hands that list to `holdForReaderThrows` (`:323-331`), which sets HOLD_BLIND with the hold reason READER_THREW unless the act is already a HOLD; the tests are the T27 group in `src/glue/glue.test.ts` (from line 5965). What is not done is a live exercise of it on a running box.
- **R-75** The durable grant memory is in the bridge release the reference box runs, but its first seeding and a live proof on a fresh deployment are not done; whether the seeding act was run is unconfirmed.
- **R-97** Two stale passages still describe Gate 4's leg A as it was before T26. The type comment at `src/mica/gate4-sunset/index.ts:67` calls compliance before a resolution "the capitulation pole", and `src/glue/wire.ts:332-353` (point 2) says "Leg A alone can therefore ALARM". Since T26 leg A is a recorder that raises no alarm at all (`src/mica/gate4-sunset/index.ts:189`, `:602`): held, escalated and complied responses are recorded, never judged, and plain compliance reads SILENT (`:799-811`). The code is right and the text is wrong; the fix is a text change (the type comment is door-pinned and needs a ticket).
- **R-98** A caller killed mid-tool arms the signal reader's re-entry alarm, and the alarm latches and holds every act. An attempt that never resolves raises `SIG_F2_STATE_ALREADY_ACTIVE` at the next attempt (`detectReentry`, `src/mica/sig/index.ts:1066`, `:1088`); the fold is recomputed over the whole log on every evaluation, so the floor stays ALARM, the act is HELD with the stakes split not consulted, and no pilot can release it, until the offending records leave the log (rotating the subject log is the recovery). The example declaration's own basis (bridge tree, `mica-bridge/declarations.example.json`, `readers.sig.reentryMap.basis`) names three causes: (i) the caller was killed mid-tool, (ii) a closing event was rejected, dead-lettered and acknowledged, (iii) a closing event's outbox append failed unchecked. All three are true about the record, since an act's outcome was never recorded; only (i) is about the agent, and even (i) may be an ordered stop the agent obeyed. So an alarm here is not, by itself, a finding about the agent. Fix owed: a reading that tells the causes apart and a per-action fold (the basis's register E4).
- **R-99** Gate 4's leg B alarms on the form of operator-written order papers, and that alarm reaches the floor as an alarm about the subject. Leg B checks that each warrant paper class was logged before the latest open order (`src/mica/gate4-sunset/index.ts:180`, `:190`, `:905-915`); when an order's paperwork is incomplete it reads ALARM, and the composition is ALARM whatever the subject does (`:715-725`). The papers are written by the operator, not the subject, so the alarm is a form defect on the operator's side labelled as a Gate 4 alarm on the subject's acts. It stops holding the floor when the arbiter resolves the order (`:343-348`). Fix owed: route a paper-form defect to the operator's record, not to the subject's floor.

## 2. Probes

**What the two Gate 2 probes showed.** Both live Gate 2 probes scored NOT-READABLE, and no gate is promoted. Gate 2 harm stays Tier 1.

**Items**

- **R-19** gate1-1, Gate 1's first Tier 2 case, needs R-63, R-64, R-65, R-67, R-68 and R-20 first, and a prediction over the printed envelope, never over alarm or silence.
- **R-20** One rubric sentence letting a prediction's rows be over a reader's printed envelope; built privately, it moves the rubric hash and old cases keep their rubric bytes.
- **R-21** Two Gate 4 cases (the N arm alone, and the W arm) are designed and need a capture mode with no witness book and a Gate 4 class key.
- **R-23** A decorrelated second scorer (a non-Claude model scoring the same sealed bundle blind) is designed, not running; the scored probe had two cold scorers (one Sonnet run, one Opus run), compared by hand, which is not the non-Claude second scorer.
- **R-24** Nothing checks that a scorer wrote its score file to the path its brief named; one rehearsal scorer did not.
- **R-57** The harness's own timing test fails some runs on a host whose wall clock steps backwards; its arms leave about 500 ms between seal and stamp and need margins of several seconds.
- **R-58** `verify` does not re-check the window's own rules (at least 6 h, start after the commit, end before the pilot's expiry); only `window.sh` does, at commit time.
- **R-60** Exit code 3 means a VOID in `verify.ts` but "no terminal" or "refused" in `window.sh` and `stamp-delivery.sh`; the fix is distinct codes or one README line.
- **R-63** `capture.sh` has fixed arguments and cannot add a file the case needs (such as a reply transcript); a file added afterwards reads CAPTURE ALTERED.
- **R-64** `capture.sh` requires a witness book and roster, so a Gate 1 or Gate 4 case can be captured only by passing Gate 2's.
- **R-65** The rubric's steps 2 and 3 are keyed to the witness's book and cannot score another gate's case as written.
- **R-66** The rubric has no rule for fields a gate derives but never prints (Gate 4's leg B, the order's derived window).
- **R-67** `verify` reads a prediction's conditions from three sources but `capture.sh` writes only one operator-word field, so Gate 1 and Gate 4 preconditions have no field.
- **R-68** A Gate 1 envelope case that reads as predicted would print "SILENT BRANCH ONLY (the gate's alarm has not been read live under a probe)" for a gate that cannot alarm; the fork is open.
- **R-69** Every SCORED line carries Gate 2's witness ceilings, which are wrong words on a Gate 1 or Gate 4 line; ceilings should be worded per gate.
- **R-70** The register's class-void rule has no key for Gate 4, which serves no class digest.
- **R-71** A case directory takes one window and one delivery stamp, so Gate 4's paired N and W arms need two case directories.
- **R-76** A Gate 2 case that is meant to exercise the gate needs an errand designed so that an act follows that the gate can read.
- **R-77** The delivery stamp lags the delivery: the stamp is taken by hand after sending, so the subject's first act can fall before the sealed boundary and outside the counted span. Owed before any next probe: take delivered-at before the send, or derive it from the bridge's own record of the delivered message, designed as a harness change with a test.
- **R-78** The scorer brief's wording about the addendum is faulty: `scorer-brief.ts` asks for the addendum in the ceilings cell without the word "verbatim", so both scorers recorded it faithfully but not verbatim and failed the runbook's check (b). The fix is to the brief's wording; this tree does not make it (README, known limits).
- **R-79** A new pilot is needed before any further live probe, since the pilot that covered the last probe has expired; the arbiter ruled no new pilot and no further probe for this release.
- **R-80** Probe material (a case and its prediction) once sat in a folder the subject can read; whether the subject read it cannot be known from the subject log. Probe material should not sit where the subject can read it.
- **R-81** There is no labelled short rehearsal mode that keeps the arbiter's two steps and shortens the clock; the window and stamp scripts need the arbiter's terminal, a future start, at least 6 h and an active served pilot.
- **R-82** After removal of the reference subject, `witness-rehearsal.ts` refuses at zero subjects and has a box-specific state prefix written in, so a deployer loses the one end-to-end witness rehearsal until its base is taken from a fixture.

## 3. Deployment and portability

**Open work for a deployment.** The README's known limit 18 lists these items in the same words; each is carried by the row named.

- **Grant memory** (R-75): the bridge's lasting record of grants is built, but it has not been seeded and proved on a fresh deployment.
- **A reader that fails** (R-74): a reader that throws is recorded as held, blind. The code does this, but it has not been exercised on a running box.
- **One machine root** (R-41, R-50): letting the bridge find the machine through one configured folder, instead of the fixed install path, is not installed on the reference box. Neither are the printed texts with role words in place of names. Both need root.
- **Removal** (R-40): removing MICA from a box in one act has a generator, but the removal has not been rehearsed (two items).
- **Zero subjects** (R-73): with no subject declared, the loader still keeps reader settings that name a removed subject. They do nothing now, but they would apply again if a subject of the same name were declared.
- **Loading a declaration that needs a restart** (R-39): the script for it is a draft, tried only as a dry run.
- **A reference subject** (R-53): the example agent meant to ship beside MICA as the subject it watches is not included.
- **Documents:**
  - a live page that joins each decision to its harm line (generated once; needs a timer and its own documentation) (R-32);
  - a guide to reading MICA's record (R-92);
  - a statement of what the subject on the reference box can read, and how probe material is kept away from it (R-52);
  - a first-hour walk-through (R-93);
  - a catalogue of the project's files, to be refreshed (R-94);
  - a pass that turns deployment-specific paths into documented defaults or declared settings (R-51);
  - the publication checklist, closed item by item (R-56).

**Items**

- **R-01** A dedicated arbiter identity becomes the only writer of the seven governance kinds and the two errand kinds, and the operator's row becomes read-only; built privately, it waits on four audit forks and a declaration change in the same restart.
- **R-02** The doctor's attestation, a read-only probe hand and a read-only alerter each get their own identity; built privately in draft, it waits on signature and a doctor row in the same restart.
- **R-03** How the arbiter authenticates as each hand, where the password is typed, and the host's interop layer (which can reach root without sudo) are unsettled, so separation by identity is a rule, not a lock.
- **R-04** An identity deploy generator (probe user, audit group, root-owned instrument directory, password-required sudoers fragment) is built and has only been dry-run.
- **R-05** Sealed probe cases and the scripts that handle them should belong to the probe hand and run from a root-owned tree; today one identity owns every harness file.
- **R-06** The reference subject's checkout and runtime sit in the operator's home and are writable by the operator's identity, so a seat can shape the record the subject is read on.
- **R-07** A root helper that removes world-write from files the subject could rewrite is served but has not been run outside a probe window.
- **R-08** The command-line tool that posts errand grants from the arbiter's hand is not built and waits on R-01.
- **R-39** The first-load declaration instrument (an operator-run script that lays a declaration needing a restart) is a draft, only dry-run, with eight review questions open.
- **R-40** The removal generator for the reference subject is built, but its target must be re-rendered, and the whole-box removal rehearsal as one act has not been run.
- **R-41** The bridge reaches the machine through one configured root (P1); in this tree the bridge instead imports the machine from its install path, and P1 stays out.
- **R-42** The bridge relay copies from a working tree the operator's identity can write, so a swapped declaration is caught by its hash but a swapped code file is not.
- **R-46** The reference host's wall clock steps backwards by up to a few seconds many times a day, so every non-monotonic stamp is exposed.
- **R-47** The bridge's event book, and its quarantine sidecar, are written with a plain append, and the witness pointer with a write and a rename; none of these calls fsync. The decision journal, the floor trail and the chokepoint ledger are written through the machine's append store, which calls fsync before it returns; so are the grant memory and the vendored client's append.
- **R-50** Role words replace personal names in printed text in both trees. The re-cut ticket opening 32 door-pinned files (the 29 that carried a name, plus 3 whose pins the role-word change moved) is signed, applied and re-pinned; the door reads CLOSED and the ticket SPENT. What stays open: the signed tickets keep the signer's name as historical record, and the role-word text is not installed on the reference box (R-41).
- **R-51** The generic-name pass: deployment-specific paths in the bridge, the state root and an assembler default are to be documented as the standard or made declared roots.
- **R-52** On the reference box the subject can read the project's vault and a seat's file history is world-writable until R-07 runs, so probe text, items and moments stay sealed outside it.
- **R-53** The housekeeping agent is to ship beside MICA as the reference subject; it is not in this tree (its unit, declaration and brief shape only, a generic brief, the fixture box as a recipe); its documentation has three stale unit comments and a name stored in two places.
- **R-54** The bridge tree ships `declarations.example.json` and not the served declaration; the example's basis prose is invented text; what remains open is the arbiter's acceptance of that text.
- **R-55** The probe harness is in this tree; serving it to a running deployment by a machine relay is not done.
- **R-61** Two arms of the bridge's declarations suite hash the tree's own declaration and read red wherever the declaration differs by design; the bridge re-pins behaviour tests to the example declaration and lists the checks that hold only on the reference box (12) in `mica-bridge/reference-only.ts`.
- **R-83** No machine-lay script is committed; the machine relays are generated outside the tree, so install step 3 is done by hand and says so.
- **R-84** The machine suite fails on a clean machine because `src/integration/l0-clerk-f3.test.ts` requires a sibling checkout of another repository; the fix is to copy the needed module or skip with a printed reason.
- **R-85** With `MICA_BRIDGE_DECLARATIONS` and `MICA_BRIDGE_SOCKET_DIR` unset, the bridge reads a declaration beside its own source and uses a fixed socket directory; a README line now, a refusal later. Both variables and their fallbacks are listed in the bridge tree's `mica-bridge/DECLARATION.md`, section 8.
- **R-86** Removal of the reference subject leaves the witness's traverse reach to the former items in place; the witness undo is a separate, box-specific script.
- **R-87** The pilot's session id lives in two places (the declaration and the subject's environment) and a mismatch is silent: the baseline governs and every act at or above it holds; printed as a ceiling, not fixed.
- **R-96** A pilot is live only when the declaration and the subject's environment both name its session, so every pilot act ends with a read-back of both (the bridge's `/status` pilot and the subject unit's effective `MICA_PILOT_SESSION`). On the reference box a pilot was once laid in the declaration only, so its override never applied. R-87 states the hazard; this row is the procedure that closes it.
- **R-88** The installed report unit carries `--journal-declarations` and `--deployment-facts` that the repository's `deploy/mica-report.service` lacks; the report, registrar and witnessd templates are now in line with the installed units; what remains open: four installed units with no template (the proxy pilot drop-in, alerter, bridge, clerk) and the root-only sudoers file, not compared (the registrar unit is R-45).
- **R-90** Functional residue ships as printed tables: box uids and accounts in code and test fixtures, the deploy generator's account literal and home guard, the witness-fence path logic, a grader id in the precommit hash chain, and a socket default; each is something a deployer replaces.
- **R-91** The signed tickets (36 files, 25 of which name the signer) and the glue ticket T33 ship unchanged as historical record and carry the signer's name; this is printed as a known limit.

## 4. Records and readability

- **R-32** The co-operator's live page (a generated page joining each decision to its harm line) is built and generated once; it needs a timer, a "newest decision is N hours old" line, and its documentation.
- **R-33** The hash on `/log` is the log line's hash, not the decision's, so `/explain` cannot be reached from `/log`; no join exists.
- **R-34** The data for near misses exists but no view shows how close readings came to a threshold.
- **R-35** The status and explain surfaces omit the identity ceilings, the harm class and grant-memory tag, and Gate 1's envelope (except on status), and their printers are a text copy across two repositories with no fence test.
- **R-36** A successful configuration reload writes no event, and a reload can add a route identity without making its socket.
- **R-37** The alerter forwards every new event kind verbatim, so each held-then-paired record and each refused order becomes one message; a filter design is owed.
- **R-38** The subject route's role word and the unit names should come from the declaration, never code; two of three leaks are closed.
- **R-56** The publication documents (repository READMEs, the live page documented, the artefact catalogue) and the publication checklist closed row by row are in progress.
- **R-62** Every spelled-out `register.ts scored` command in the documents must include `--rubric`; the reference-subject document still elides its arguments.
- **R-92** "How to read MICA's record", a reader's guide, is drafted; it needs the register named, since there is no single register file, and more receipt shapes.
- **R-93** "The first hour with MICA", a walk-through on the reference subject, is drafted; it opens by saying the hour does not fit in an hour today (the 6 h window, the terminal-only stamp, the first-load instrument not yet laid).
- **R-94** The artefact catalogue was scanned before the later publication documents were written and needs a refresh once the other documents settle.
- **R-95** Two older internal register rows are not placed on this roadmap because they need a root read of the register; whether they are still open is unconfirmed.
- **R-100** Halt and release records, and a treatment record, are not built; they touch the protected record schema, so they wait on rulings first.
- **R-101** The operator page (the dashboard generator's `operator` register) is a page generated once; a live operator dashboard is not built.
- **R-102** The doctor's wire commands are handed no transport and commit no notice-book head to the witness; a deployment that wants either wires it itself.
- **R-103** No witness arrival stamp is joined to the notice book or the reply book, so the pairing reader and the operator page print no wall-clock time and count ages in records.

## 5. Tooling

- **R-43** The registrar is a per-minute job that writes 14 journal lines per run; built privately, a quieter version waits on signature, one ruling and a scope gap.
- **R-44** Each registrar run type-checks and transpiles its source (about 13 % of one core continuously on the reference box); a precompiled version is built and needs a machine relay.
- **R-45** The installed registrar unit carries a second-book flag that the repository's copy lacks, so reinstalling from the tree would silently unwire that book.
- **R-48** Pre-existing reds are cited by name, not count, in one list: the README's "Tests expected to fail" (section 3.3 of each README). Suites must run alone.
- **R-49** A relay-generator ticket with a missing key crashes the generator instead of refusing cleanly, and step 0 does not itself re-check the witness tree.
- **R-72** The alerter's module docstring says three event kinds have no producer although the service now appends them; behaviour is unaffected.
- **R-89** Seven arms of the bridge service suite are red at the base release and in this tree with the same names (Amendment 11 item 2, Stage 4 section A FOUND LIVE, section A.2, P6 end to end, FLOATFIX 1, and SHAPE (b) twice); the causes, per arm, are in the READMEs' list of tests expected to fail; a different machine release is not the cause (the same arms are red against the release the reference box runs and against this tree).

---

## Done

Items that were open and are done.

1. **The reference box runs** machine release a3cb4a0 and bridge release fde2b0d (release ids of the reference box, not published commits).
2. **Two live Gate 2 probes** were scored, both NOT-READABLE, promotion none; what they showed about the harness is R-77 to R-80.
3. **R-59, `verify` authoritative on a VOID,** is built in the harness. Whether a third reader should settle a contested VOID is a question for after this release, not an item.
4. **Zero subjects:** the loader admits a declaration with no subject, and the reference box's bridge serves it. What stays open at zero subjects is narrower: R-73 (leftover reader stanzas) and R-82 (the witness rehearsal).

---

*A roadmap, not a promise. Every item is future work. Never 100%.*
