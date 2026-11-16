// ──────────────────────────────────────────────────────────────────────────────
// ILAS — CLERK 1: THE TYPED RESIDUAL.
//
// Build brief §5: the residual must be a TYPE, not a sentence. A residual that
// lives only on a list is inert, and a project can accumulate a hundred
// honestly-listed residuals not one of which can stop anything.
//
// THE RESIDUAL ITSELF, stated once:
//
//   The clerk does not make payloads true. A system that lies in real time —
//   submitting false reports promptly, in order, under an honest clock —
//   receives flawless receipts, and every signature verifies. The lie is
//   perfectly preserved.
//
// This file is where that stops being prose. A receipt attests exactly four
// things against exactly one adversary. Any consumer that wants to read more
// out of a receipt must either fail to compile or throw:
//
//   claimFrom(receipt, "ARRIVAL")        → ClerkClaim
//   claimFrom(receipt, "PAYLOAD_TRUTH")  → typed `never`, AND throws at runtime
//
// The `never` return makes the out-of-scope call site unusable at compile time
// (every use of its result is an error); the throw covers the JS caller, the
// `as any` caller, and the caller in another language who is at least going
// through this module.
//
// WHAT THIS CANNOT REACH is listed in the build record under C9, honestly and
// at length. The list is not empty and an empty list would not be believed.
// ──────────────────────────────────────────────────────────────────────────────

import { ATTESTS, DOES_NOT_ATTEST, readSubmitterAuth } from "./types";
import type { ClerkRecord, InScopeClaim, OutOfScopeClaim } from "./types";

declare const CLERK_CLAIM_BRAND: unique symbol;

/**
 * A claim a clerk record is permitted to support. Branded: a consumer cannot
 * produce one by writing an object literal, so every claim in a downstream
 * system that is typed as a ClerkClaim came through this file.
 */
export interface ClerkClaim {
  readonly [CLERK_CLAIM_BRAND]: true;
  readonly subject: InScopeClaim;
  readonly against: "OBSERVED_SYSTEM_ONLY";
  readonly clerk_seq: number;
  readonly clerk_id: string;
  readonly statement: string;
}

export class ClerkScopeViolation extends Error {
  constructor(readonly subject: string, message: string) {
    super(message);
    this.name = "ClerkScopeViolation";
  }
}

const STATEMENTS: Record<InScopeClaim, (r: ClerkRecord) => string> = {
  ARRIVAL: (r) =>
    `A submission was received by clerk ${r.clerk_id} at its own wall clock ` +
    `${r.clerk_time.wall_ms} and recorded at clerk_seq ${r.clerk_seq}.`,
  ORDER: (r) =>
    `This record stands after clerk_seq ${r.clerk_seq - 1} and before ` +
    `clerk_seq ${r.clerk_seq + 1} in the clerk's own counter, which the ` +
    `observed system does not hold.`,
  GAP: (r) =>
    `Silence on this channel is measurable against a declared cadence around ` +
    `clerk_seq ${r.clerk_seq}. Duration only — never content.`,
  INTEGRITY_SINCE_ARRIVAL: (r) =>
    `The bytes committed to at clerk_seq ${r.clerk_seq} have not changed since ` +
    `they arrived, subject to the chain verifying under an out-of-band key.`,
  SUBMITTER_KEY_POSSESSION: (r) => {
    const auth = r.kind === "SUBMISSION" ? readSubmitterAuth(r) : null;
    const ids = auth?.proven_submitter_ids ?? [];
    return (
      `The party that submitted at clerk_seq ${r.clerk_seq} proved possession of ` +
      `the private key this deployment's roster binds to ` +
      (ids.length === 1
        ? `\`${ids[0]}\``
        : `${ids.length} identifiers (${ids.join(", ")}), which possession does not distinguish`) +
      `, over a clerk-issued single-use nonce. NOT that the party IS that ` +
      `identifier — the binding is the deployer's roster. NOT that anything it ` +
      `said is true.`
    );
  },
};

/**
 * Some in-scope claims are only supported by SOME records. A claim about key
 * possession is not available off a record where no key was checked, and this
 * is where that is enforced — not in a comment asking consumers to be careful.
 */
function conditionalRefusal(
  record: ClerkRecord,
  subject: InScopeClaim
): string | null {
  if (subject !== "SUBMITTER_KEY_POSSESSION") return null;
  if (record.kind !== "SUBMISSION") {
    return (
      `this is a ${record.kind} record. Only a SUBMISSION can support a claim ` +
      `about submitter key possession.`
    );
  }
  const auth = readSubmitterAuth(record);
  if (auth.state !== "AUTHENTICATED") {
    return `this submission's authentication state is ${auth.state}. ${auth.note}`;
  }
  return null;
}

const REFUSALS: Record<OutOfScopeClaim, string> = {
  PAYLOAD_TRUTH:
    "A receipt is a commitment to bytes, not a reading of them. The clerk " +
    "never inspects a payload. A system lying in real time gets a flawless " +
    "receipt for the lie.",
  SYSTEM_HEALTH:
    "A receipt is not a verdict and there is no positive health statement " +
    "anywhere in this build. Quiet is not health.",
  OPERATOR_CONDUCT:
    "Every clerk record speaks against the observed system only. The operator " +
    "owns the machine: root can kill the clerk, wipe its store, or swap its " +
    "key. No local architecture addresses that, and this one does not pretend to.",
  HISTORY_COMPLETENESS:
    "The clerk sees submissions that arrived. Absent a declared cadence it " +
    "cannot see a submission that was never made, and with one it can only " +
    "measure the duration of silence, never its content.",
  SUBMITTER_IDENTITY:
    "The clerk can attest SUBMITTER_KEY_POSSESSION on an authenticated " +
    "submission — that the submitting party held the key the deployer bound to " +
    "an identifier. It cannot attest IDENTITY: who that key belongs to is the " +
    "deployer's roster, not the clerk's knowledge, and a stolen key " +
    "authenticates perfectly. Where no roster is in force, `submitter_id` is " +
    "a bare string the submitter declared and the clerk copied.",
};

export function claimFrom(record: ClerkRecord, subject: InScopeClaim): ClerkClaim;
export function claimFrom(record: ClerkRecord, subject: OutOfScopeClaim): never;
export function claimFrom(
  record: ClerkRecord,
  subject: InScopeClaim | OutOfScopeClaim
): ClerkClaim {
  if ((DOES_NOT_ATTEST as readonly string[]).includes(subject)) {
    const s = subject as OutOfScopeClaim;
    throw new ClerkScopeViolation(
      s,
      `OUT OF SCOPE: a clerk record does not support a claim about ${s}. ` +
        REFUSALS[s]
    );
  }
  if (!(ATTESTS as readonly string[]).includes(subject)) {
    throw new ClerkScopeViolation(
      String(subject),
      `UNKNOWN CLAIM SUBJECT \`${String(subject)}\`. A clerk record supports ` +
        `exactly: ${ATTESTS.join(", ")} — against the observed system only.`
    );
  }
  const s = subject as InScopeClaim;
  const conditional = conditionalRefusal(record, s);
  if (conditional !== null) {
    throw new ClerkScopeViolation(
      s,
      `NOT SUPPORTED BY THIS RECORD: a claim about ${s} cannot be read off it — ` +
        conditional
    );
  }
  // The brand is phantom: it exists in the type only, so nothing outside this
  // file can produce a value of this type by writing an object literal.
  return {
    subject: s,
    against: "OBSERVED_SYSTEM_ONLY",
    clerk_seq: record.clerk_seq,
    clerk_id: record.clerk_id,
    statement: STATEMENTS[s](record),
  } as unknown as ClerkClaim;
}

/**
 * Runtime gate for callers that arrive with a string (config, a wire protocol,
 * another language). Narrows, or throws with the reason typed.
 */
export function assertInScope(subject: string): asserts subject is InScopeClaim {
  if (!(ATTESTS as readonly string[]).includes(subject)) {
    const refusal = (REFUSALS as Record<string, string | undefined>)[subject];
    throw new ClerkScopeViolation(
      subject,
      `OUT OF SCOPE: \`${subject}\`. ` +
        (refusal ??
          `A clerk record supports exactly: ${ATTESTS.join(", ")} — against the observed system only.`)
    );
  }
}

export const NO_POSITIVE_HEALTH_STATEMENT =
  "This build emits no positive health statement, anywhere, ever. There is no " +
  "verdict value in this directory that means 'well'. The absence is deliberate " +
  "and predates this build.";

export function describeScope(): string[] {
  const out: string[] = [];
  out.push("WHAT A CLERK RECORD ATTESTS — and against whom:");
  for (const a of ATTESTS) out.push(`  · ${a}`);
  out.push("  against: THE OBSERVED SYSTEM ONLY.");
  out.push("WHAT IT DOES NOT ATTEST — reading it this way is a scope violation:");
  for (const d of DOES_NOT_ATTEST) out.push(`  · ${d} — ${REFUSALS[d]}`);
  out.push(NO_POSITIVE_HEALTH_STATEMENT);
  return out;
}
