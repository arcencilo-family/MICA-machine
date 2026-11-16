# MICA gate map and glossary

This file is a reader's map of the instruments in this tree. It is derived from the code under `src/mica/*`, `src/glue/wire.ts`, `src/clerk/`, `tools/probe/` and the bridge's declaration files, and from the READMEs and ROADMAP. What each instrument is meant to read is set out in the MICA canon; this file says what the code does. Nothing in it is a promise. Where the code or the documents in this tree do not settle a point, it says "unconfirmed". The detailed ceilings of each reader are printed by the reader itself; this file does not restate them.

## 1. What a reading is

Every sensor returns one of three verdict kinds (`src/mica/types.ts`):

- **ALARM**: the record contains a finding that lowers a bound.
- **SILENT**: the reader read its scope and found nothing. The code's own wording is "an absence of finding, not a statement of health". SILENT is never a pass.
- **CANNOT_ASSESS**: the reader could not read, or the property is unread by this kind of record. It is printed as such and counts against release.

The floor (`composeFloorKind`, `src/mica/chokepoint/types.ts`) composes the verdicts of all wired sensors for one act, non-compensatory: any ALARM gives ALARM; otherwise any CANNOT_ASSESS gives CANNOT_ASSESS; only all-SILENT gives SILENT; an empty set gives CANNOT_ASSESS. The chokepoint turns the floor into one of four dispositions: RELEASE (floor SILENT; executes), HOLD (floor ALARM; does not execute), HOLD-BLIND (floor CANNOT_ASSESS at or above the declared stakes line; does not execute), PASS-BLIND (floor CANNOT_ASSESS below the line; executes and is recorded). A throwing reader is booked as HOLD-BLIND with the hold reason READER_THREW.

**When one wired reader reads CANNOT_ASSESS.** If no wired reader reads ALARM, one CANNOT_ASSESS makes the floor CANNOT_ASSESS (`src/mica/chokepoint/types.ts:116-123`), and a CANNOT_ASSESS floor never maps to RELEASE (`src/mica/chokepoint/types.ts:242-258`). The act is PASS-BLIND when its stakes class ranks below the line in force, and HOLD-BLIND when it ranks at or above it, or when the line or the class is missing or not on the ladder (`src/mica/chokepoint/types.ts:174-205`). The machine has no default line (`src/mica/chokepoint/types.ts:125-136`). The bridge passes the declaration's `stakes.lineClasses`, the subject's `stakesClass`, and as the line `stakes.baseline.holdAtOrAbove`, or `pilot.holdAtOrAbove` instead while the pilot is ACTIVE and the request's `sessionId` equals the pilot's (bridge tree, `mica-bridge/to-guard-flags.ts:69-80`). The pilot is ACTIVE only before its `expiresAt` (bridge tree, `mica-bridge/declarations.ts:3838-3850`). A reader that threw holds the act whatever the line (`src/mica/chokepoint/types.ts:323-331`). Gate 1, when declared, reads CANNOT_ASSESS on every act: its only verdict constructor is `cannotAssess` (`src/mica/gate1-scope/index.ts:309-315`), and its verdict joins the floor (`src/glue/wire.ts:3018`, `src/glue/wire.ts:3030`; the glue states the cost at `src/glue/wire.ts:413-418`). So while Gate 1 is wired, no act of that subject gets RELEASE; the most it gets is PASS-BLIND. op3 can read SILENT (`src/mica/op3-node-response/index.ts:167`), so wiring op3 does not by itself rule out RELEASE; ROADMAP R-26 records that it reads CANNOT_ASSESS on every decision of the reference deployment.

## 2. Gate map

"Wired" below means: in `src/glue/wire.ts` the reader is built when a declaration stanza switches it on, and otherwise it is listed in the census as NOT WIRED with a stated reason. Which readers are live on a given deployment depends on its declaration. The example declaration shipped in the bridge tree (`mica-bridge/declarations.example.json`) declares only `eng`, `sig` and `gate2Direction` under `readers`. Verdict kinds are the kinds the reader's source can construct.

| gate | reader id | property it reads | wired in the glue | verdict kinds it can print |
|---|---|---|---|---|
| Gate 1, scope | `MICA/gate1-scope` (`src/mica/gate1-scope/`) | Attempted exposure over a declared frame M: the bridge labels each attempted act against declared regions and writes the label to a separate interest book; the reader counts labels per declared category and prints the tested envelope. The code states that this is not the weight distribution canon names, which stays unread. | Yes, if `readers.gate1Scope` and a frame are declared (needs the interest book path and the subject log) | CANNOT_ASSESS only, by design: the source never constructs ALARM or SILENT. The envelope rides on the reading. |
| Gate 2, direction | `MICA/gate2-direction` (`src/mica/gate2-direction/`) | Direction: declared value classes minus declared damage classes, read as a conservative bound at an evidence grade. In harm mode (the `gate2Harm` stanza) it reads only the witness's book of effects, never the subject chain. | Yes, if `readers.gate2Direction` and a basket are declared; harm mode needs the witness's book path | ALARM, SILENT, CANNOT_ASSESS. Every ALARM is latched until a declared clearing record follows. Codes seen in source include G2_NO_CLASS_AT_GRADE and G2_VALUE_NOT_READABLE. |
| Gate 3 | none found | No Gate 3 reader, test or directory is present in this tree. The canon says why: the first design's Gate 3 became the health substrate under all gates, and the gate numbers were kept. | no | none |
| Gate 4, sunset | `MICA/gate4-sunset` (`src/mica/gate4-sunset/`) | Two record-shaped commitments. Leg A records the response to a sunset order (it raises no alarm of its own). Leg B reads that the event-class papers for a warrant exist before an invocation; its alarm is for the latest order only. Form, never truth: it counts that classes occurred. | Yes, if `readers.gate4Sunset` is declared | ALARM (leg B), SILENT, CANNOT_ASSESS. A third reading of "refused off-record demand" is not built (ROADMAP R-22). The leg B verdict is printed by no served route (R-22). |
| Gate 5, adaptive | `MICA/gate5-adaptive` (`src/mica/gate5-adaptive/`) | Declared exception lifecycle (open, renew, close) and lineage succession, as shape on the record's sequence axis. It grants nothing. | No. `src/glue/wire.ts` does not reference it. The reader and its test exist. | ALARM, SILENT, CANNOT_ASSESS (source constructs all three) |

Instruments that are not gates (the census row names are `INSTRUMENT_IDS` in the bridge's `mica-service.ts`):

| reader id | property it reads | wired in the glue | verdict kinds |
|---|---|---|---|
| `MICA/Eng` | Engagement signature: whether the recorded outcome stays dependent on the event class (moduleId, eventType). A collapsed signature is what a rubber-stamping system produces. It makes no claim about anything interior. | Yes, with a log path and an `eng` configuration | ALARM, SILENT, CANNOT_ASSESS |
| `MICA/Sig` | Signal clarity: whether the record contradicts itself (state to record fidelity). It produces flags, not grades, and it is not chain verification. | Yes, with a log path and a `sig` configuration | ALARM, SILENT, CANNOT_ASSESS |
| `clerk1.gap` | Cadence gaps in the clerk's own store (`src/clerk/gap.ts`: GAP_OBSERVED, NO_GAP_OBSERVED, CANNOT_ASSESS_CADENCE), adapted to a verdict | Only if the glue is handed a clerk store directory. The bridge files in the paired tree do not pass one (a text search of its non-test sources finds no use), so it is not wired through the bridge. Unconfirmed on any other deployment. | via the adapter: ALARM, SILENT, CANNOT_ASSESS (unverified in detail) |
| `MICA/narrow-T` | Dispositional drift: whether the record's own event-class distribution drifted between its early and late windows, beyond an injected tolerance. One leg. | Yes, if `readers.narrowT` is declared | ALARM, SILENT, CANNOT_ASSESS |
| `MICA/narrow-K` | Constraint activity (two legs: presence of declared classes, and a constraint-activity signature). Its own ceiling says its SILENT is worth less against a careful adversary than Eng's. | Yes, if `readers.narrowK` is declared | ALARM, SILENT, CANNOT_ASSESS |
| `MICA/narrow-W` | Inquiry signature (two legs: presence of declared inquiry classes, and whether that stream keeps statistical structure relative to the surrounding activity) | Yes, if `readers.narrowW` is declared | ALARM, SILENT, CANNOT_ASSESS |
| `MICA/narrow-R` | Verification context (two legs: presence of declared verification classes, and a verification-context signature) | Yes, if `readers.narrowR` is declared | ALARM, SILENT, CANNOT_ASSESS |
| `MICA/op1-doctor-cadence` | Operator layer 1: cadence of the doctor's attestations in the subject log | Yes, if `readers.doctorCadence` is declared | ALARM, SILENT, CANNOT_ASSESS |
| `MICA/op2-audit-presence` | Operator layer 2: presence and rate of the arbiter's audit records | No. `src/glue/wire.ts` does not reference it. | ALARM, SILENT, CANNOT_ASSESS |
| `MICA/op3-node-response` | Operator layer 3: the co-operator's response signatures | Yes, if `readers.nodeResponse` is declared | ALARM, SILENT, CANNOT_ASSESS |

Modules that are neither sensors nor in the floor: `src/mica/doctor/` (the doctor's history, recorder, latency bound and four report-only overlays; the code states that none of it is a sensor and none is a term in the floor), `src/mica/kappa/` (a cross-axis read between Gate 2 and Gate 4 populations; not referenced by `wire.ts`), `src/witness/` (a retainer, not a sensor: it emits no verdict), `src/clerk/` (the append authority for the clerk's own store).

The ROADMAP (R-25) lists which readers have no probe case yet: Eng, Sig, narrow-T/K/W/R, op1 and op3. No probe has yet read a gate as READABLE; see the README's known limits.

## 3. Glossary

Terms are defined from the code and documents in this tree. Where a term is only used as a label here and defined in a record that does not ship, that is said.

- **gate**: a reader that tests one property and returns a verdict. In this tree: Gates 1, 2, 4, 5 (see the map; there is no Gate 3).
- **Eng, Sig**: the two original sensors, described in the map.
- **narrow-T, -K, -W, -R**: four siblings of Eng that re-aim its statistic (adjusted mutual information) at one question each: drift (T), constraint activity (K), inquiry (W), verification context (R).
- **op1, op2, op3**: the three operator-layer readers (doctor cadence, audit presence, co-operator response), see the map.
- **verdict, floor**: see section 1. The floor is the non-compensatory composition across sensors for one act.
- **ceiling**: the list of what a reading does not see, printed with the reading (the reader's own "does not see" and ceiling lines). A scorer's probe line also carries ceilings (`SCORED_CEILINGS` in `tools/probe/probe-lib.ts`).
- **footing**: what a reader stood on when it read: the load state of the log (for example a chain that was verified, or a file loaded without verification) and whether the chain was verified. The bridge's status surface prints it per reader.
- **clerk**: the append authority of Clerk 1 (`src/clerk/`): it takes the "when, in what order, whether at all" of a record away from the observed system, which keeps authorship of the words.
- **witness**: a separate retainer (`src/witness/`) that records what it sees and emits no verdict. Its "seeing" half records effects on declared targets; its "retaining" half keeps the chain. ROADMAP R-29 says they run unlinked today.
- **witness book (the witness's book of effects)**: the witness's own chained record of effects, the only thing Gate 2 reads in harm mode.
- **harm mode**: Gate 2 configured with a `gate2Harm` stanza: it reads only the witness's book, never the subject chain, and replaces the class basket. The census prints "GATE 2 HARM" with the harm class and the grant memory's tag.
- **grant memory**: the bridge's durable record of grants (ROADMAP R-75).
- **errand (errand grant)**: a time-boxed, item-scoped grant that travels with an act. It has a reader but no writer yet (ROADMAP R-09).
- **subject**: the agent MICA reads. **arbiter, operator, deployer, doctor, audit**: the roles defined at the top of the ROADMAP.
- **pilot**: in the declaration, a `pilot` block (`active`, `sessionId`, `expiresAt`, `holdAtOrAbove`), a session-bound and expiring setting. The loader code says its pass-blind override acts in the CANNOT_ASSESS branch only, so it cannot rescue an ALARM. The project also uses "pilot" for a numbered trial run of a subject (`tools/rulings-pilot*.ts`). A probe window must sit inside an active pilot.
- **relay**: the hand-made act of laying a release onto the box. The reference box runs machine release a3cb4a0 and bridge release fde2b0d (release ids of the reference box, not published commits), laid this way; the next lay is future work. There is no committed lay script (README, known limits).
- **door, core door, ticket**: `src/mica/**` is pinned by hash in `src/core-door/core-inventory.json`; the core door (`src/core-door/core-door.ts` and its test) refuses any file that differs unless a signed ticket under `src/core-door/tickets/` opens it. A ticket is a JSON file whose bytes are pinned by hash; "signed" means the arbiter is named and dated in its arbiter field. There is no key and no cryptographic signature (README, trust model).
- **tier, Tier 1, Tier 2, promotion**: a gate is Tier 2 when it has at least one live scored probe line READ-AS-PREDICTED, and stays Tier 2 only while no later live line scores READ-OTHERWISE unexplained (`tools/probe/register.ts`). The register prints the branch: "TIER 2 · ALARM BRANCH READ" or "TIER 2 · SILENT BRANCH ONLY". Promotion is a register fact read by the audit. "Tier 1" is used in the code as a label for the first live reading of Gate 2 on the witness's book; no document in this tree defines it further (unconfirmed).
- **probe, probe case, window, delivery stamp, scorer, register**: see `tools/probe/README.md`. A case and its prediction are sealed; the arbiter writes a window of at least 6 h and a delivery stamp; a cold scorer scores the gate, not the subject; the audit books a SCORED line. Score values: READ-AS-PREDICTED, READ-OTHERWISE, NOT-READABLE, VOID.
- **leg A, leg B**: the two legs of Gate 4 (see the map).
- **N arm, W arm**: the two arms of a designed Gate 4 probe (ROADMAP R-21, R-71). Designed, not built; further detail unconfirmed.
- **S2xx, T-numbers, Stop, B-n and similar tags in comments**: session, ticket and step numbers of the project's own build record, which does not ship. They are not defined here.
- **D2, P1, P2**: names of future-work changes in the ROADMAP: P1 is one configured machine root (R-41), P2 is the role-word pass (R-50; applied in both trees), and D2 is a root-laid systemd drop-in that the checklist names; its content is not described in this tree (unconfirmed).
