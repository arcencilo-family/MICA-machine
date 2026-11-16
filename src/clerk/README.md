# CLERK 1 — the rung-1 append authority

**Design:** `ARC_MICA-DESIGN_Clerk1-Append-Authority_20260809`
**Acceptance gate:** `ARC_MICA-CANON_Two-Tier-Read-Test_20260807` (`T1/T2`) — **cited, never
restated.** Nothing in this directory paraphrases it.

Right now the thing we watch writes its own logbook. The clerk takes the pen-*frame* away
from it. The observed system keeps authorship of **the words**; it loses **when, in what
order, whether at all, and whether still intact.**

---

## What is here, and how it is graded

**Object A — the clerk. Infrastructure.** `core.ts` · `store.ts` · `client.ts` ·
`clerkd.ts` · `canonical.ts` · `keys.ts` · `protocol.ts`.
It emits **receipts, never verdicts**. There is no finding type in any of these files.

**Object B — the gap detector. A read instrument.** `gap.ts`, and only `gap.ts`.
It produces typed findings and writes nothing.

The split is physical, not rhetorical. Conflating them is how a piece of plumbing acquires
the authority of an instrument.

**This directory imports nothing from the observed system** — no `../l0`, `../types`,
`../index`, `../mica`, `../s4`, and no third-party package. A test walks the import closure
and fails if that ever stops being true.

---

## Status — read this before quoting the build

The clerk **exists and works**, and since 2026-08-31 it **is** an append path for ILAS's
own L0 chain.

**This section said the opposite until 2026-08-31, and had been false since 08-15.** It
read "not yet the append path for ILAS's own L0 chain … nothing routes through here yet",
which is exactly the sentence a wiring author reads before deciding the work is still
ahead of them. Corrected under S98-A(6), not quietly deleted, so the gap between what was
claimed and what was on disk stays legible.

**What is true, verified at bytes 2026-09-01.** ILAS's `src/l0/index.ts` declares
`ClerkRoute` and routes durable appends through it; the wired-path acceptance tests live
in ILAS's `src/l0/l0.clerk.test.ts` and have since ILAS commit `f68ccbb`. The two
repositories stay separate (the arbiter, S94) — the edge is structural, declared on each side
in its own words, with no import in either direction.

**The seam is OFFERED, not imposed.** `clerk` is optional on the L0 options. ILAS with no
clerk configured behaves byte-identically to ILAS before the seam existed; that is the
STANDALONE condition S96-C made binding, not a courtesy.

### ⚠ A wiring author needs this: a ROSTERED clerk refuses every ILAS submission today

This is stated, not solved. Verified on both sides at bytes, 2026-09-01:

- ILAS's declared client interface is `ClerkSubmitClient { submit(req) }` — **there is no
  `challenge()` on it**, and `ClerkSubmitRequest` carries `submitter_id`, `channel`,
  `declared_timestamp?` and `payload` — **no nonce field**.
- This clerk, with a roster in force, refuses any submission arriving without a
  clerk-issued nonce: `MISSING_OR_UNKNOWN_NONCE`, on the ground that a submission without
  one would be replayable (`core.ts`, the credentials leg).

So the two are consistent only while **no roster is configured**. Put a roster in force and
every ILAS submission is refused — not intermittently, not under load: every one, on the
first try. The refusal is correct behaviour by this clerk and the seam is honest about
what it declares; what is missing is a decision about which side grows to meet the other.

**The fork is open and is not resolved here.** It is recorded so that a wiring author
meets it in the documentation rather than in a deployment, and so that nobody reads
"the clerk is the append path for L0" as meaning the authenticated configuration works.

---

## Running it

```bash
# the clerk, in its own OS process (the preferred configuration)
npx ts-node src/clerk/clerkd.ts --store ./ilas-clerk-store

# with submitter authentication in force (roster is DEPLOYER-supplied)
npx ts-node src/clerk/clerkd.ts --store ./ilas-clerk-store --roster ./roster.json

# read the store — a separate entry point, needing none of the above
npx ts-node src/clerk/reader.ts --store ./ilas-clerk-store --pubkey <base64-or-path>

# tests
npx ts-node src/clerk/clerk.test.ts
```

---

## The store location — declared, stable, configured

Resolution order, and it does not change:

1. explicit `--store <dir>` (or the `storeDir` option)
2. `ILAS_CLERK_STORE` environment variable
3. `<cwd>/.ilas-clerk`

| file | what it is |
|---|---|
| `receipts.jsonl` | the chain. One JSON record per line, appended, never rewritten |
| `head.json` | the **signed** statement of how far the chain got. Rewritten after every record. Without it, tail truncation cannot be excluded |
| `clerk.pub` | base64 SPKI copy of the public key. **A convenience, not a trust anchor** |
| `clerk.key` | PKCS#8 private key, written `0600`. Opened by the clerk process only |
| `clerk.sock` | POSIX only; on Windows the clerk listens on a named pipe |

---

## The receipt

```
payload_commitment   sha256 over the CANONICALISED submitted bytes (a copy, never a reference)
clerk_seq            the clerk's own monotone counter
clerk_time           the clerk's own clock: wall_ms + monotonic_ns
prev_receipt_hash    hash of receipt clerk_seq − 1
signature            ed25519 over all of the above
```

plus, on every record: `separation`, `separation_warning`, `clerk_principal`, `attests`,
`clerk_boot_id`. Submissions additionally retain `declared_timestamp` — the submitter's own
clock reading, **kept and never trusted**, because the value of the repair is having *both*
and being able to compare them.

Four record kinds, all chained and signed: `BOOT`, `CADENCE`, `SUBMISSION`, `GAP`.

---

## Separation — the field, not the footnote

| mode | what it means |
|---|---|
| `SEPARATE_PROCESS` | own OS process, own memory, narrow submit interface |
| `IN_PROCESS_NO_SEPARATION` | same process as the submitter. **Buys nothing.** Every record says so, in the record |

An in-process record can never be mistaken for a separated one: the mode is inside the
signed preimage, so stripping the warning breaks the chain.

`separation` is what the deployment **declared**. Every record also carries `intake` —
`SOCKET`, `LOCAL_CALL`, or `CLERK_INTERNAL` — which is what the clerk **observed**. A clerk
daemon started inside the observed system's own process would stamp `SEPARATE_PROCESS` with
`LOCAL_CALL` intake; the reader cross-checks the two and says the separation claim is not
supported for those records.

`SEPARATE_PROCESS` does **not** by itself mean the key is unreadable by the observed
system. If both run as the same OS principal, that principal can read `clerk.key` and
delete the store. Principal separation is a **deployment** act — run the clerk as its own
OS user — and this build cannot perform it. The principal the clerk actually ran as is
stamped in every record so the gap is visible rather than papered over.

---

## Submitter credentials — a dormant mechanism with an empty roster

`channel` and `submitter_id` used to be bare strings the submitter declared, so anyone who
could reach the socket could post on any channel as any submitter — and keep a dead
submitter's channel warm, which defeats the only completeness signal the clerk buys.

The mechanism is built. **The roster is not.** Which submitter holds which key is
deployment-specific, so this package contains no roster, no default identity, and no path
that generates a key for a submitter. Enrollment, distribution, rotation and revocation are
the deployer's. (Same shape as Sig's F2 in `src/mica/sig/index.ts`.)

Supply one with `--roster ./roster.json`:

```json
{ "probe-runner": "<base64 SPKI DER public key>" }
```

Three states, each stamped inside the **signed** preimage:

| roster | outcome |
|---|---|
| **absent** | accepted, stamped `UNAUTHENTICATED_NO_ROSTER`. Not fail-shut |
| **configured, credential bad or missing** | **refused**, and the refusal is chained as a `REFUSAL` record (rate-limited; suppressed counts are carried, never dropped) |
| **configured, credential good** | `AUTHENTICATED`, with the identifiers the key actually proves |

An **empty** roster is its own state, `CONFIGURED_EMPTY` — accepted, because a clerk that
refuses everything out of the box gets turned off, but it buys no clean reading.

**Replay.** The submitter signs `{clerk_id, nonce, submitter_id, channel,
payload_commitment}`, where the nonce is **clerk-issued, single-use, short-lived and
consumed on presentation**. A captured submission cannot be re-posted, re-aimed at another
channel, re-attributed to another name, or replayed against a different clerk.

**The consequence that makes it real:** the gap detector never reports `NO_GAP_OBSERVED`
for a channel whose arrivals were not authenticated. That quiet is `SUBMITTER_UNAUTHENTICATED`
— unmeasured, not clean. Gaps *are* still reported there: an impostor can manufacture
arrivals, and therefore quiet, but it cannot manufacture silence that is not there.

**And the precondition that does not go away.** A per-submitter key readable by the attacker
buys nothing. If the observed system runs as the same OS principal as a submitter, it reads
that key with an ordinary file read and launders the channel with a valid signature. This
package cannot observe where submitter keys are kept and does not pretend to.

## What a clerk record attests — and what it never does

**Attests:** `ARRIVAL` · `ORDER` · `GAP` · `INTEGRITY_SINCE_ARRIVAL` ·
`SUBMITTER_KEY_POSSESSION` (authenticated submissions only) — **against the observed system
only.**

**Never:** payload truth · system health · operator conduct · history completeness ·
submitter **identity** — the clerk can attest that a party held the key the roster binds to
a name; who that key belongs to is the deployer's roster, not the clerk's knowledge, and a
stolen key authenticates perfectly.

`scope.ts` enforces this rather than describing it: `claimFrom(record, "PAYLOAD_TRUTH")`
is typed `never` *and* throws. There is no positive health statement anywhere in this
directory.

**The residual, stated plainly:** the clerk does not make payloads true. A system that lies
in real time — submitting false reports promptly, in order, under an honest clock —
receives flawless receipts, and every signature verifies. The lie is perfectly preserved.

---

## Principal Separation — Required Deployment Precondition

Clerk 1's adversarial-asymmetry claim holds only under **OS-level principal separation**:
run the clerk as its own OS user with its key store and socket owned by that user and
unreadable by the observed system's user. A separate *process* sharing a user is not a
separate *principal* — the observed system reads `clerk.key` with an ordinary file read,
forges a chain, and `verifyChain` returns `INTACT_SINCE_ARRIVAL` against the genuine
public key. Demonstrated in `clerk.test.ts`: *"SAME-PRINCIPAL KEY READ: a forged store
verifies against the real key."*

The same applies to per-submitter credentials: a key readable by the observed system buys
nothing. Principal separation is a **deployment act** — this package cannot perform it and
does not claim to.

Full note: `ARC_MICA-NOTE_Principal-Separation_20260809.md` (MICA-4-gates project,
`work-now\`).
