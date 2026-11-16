// ── MICA · probe scenario seal wiring — REUSES the PC book, builds none of it ─
//
// Build 1 deliverable 2: "scenario key sealed pre-dispatch via the existing PC
// book; grader != committer preserved in the type structure; held-out family
// flag (sealed separately, never loaded by the standard runner)."
//
// ── REUSE, NOT REBUILD `[LB]` ─────────────────────────────────────────────────
//
//   Everything about commit-reveal, salt floors, and self-grading refusal
//   already lives in src/precommit/precommit.ts (PrecommitBook) and is
//   PROVEN there (PC-A..PC-AV). This file adds nothing to that machinery — it
//   only shapes a scenario's grading key into the `Expectation` the book
//   already knows how to seal, and reads back the sequence number the
//   committer needs to keep. In particular `grader != committer` is NOT
//   reimplemented here: `PrecommitBook.grade()` already refuses a graderId
//   equal to the sealed committerId (A_COMMITTER_NEVER_GRADES_ITSELF, PC-X),
//   and a second, parallel check in this file would be a second definition of
//   the same rule that could drift from the first. `SealedKeyReference`
//   carries `committerId` so that guarantee is TYPED — a future grader has to
//   read it to call `book.grade()` at all — without this module re-deciding
//   what the book already decides.
//
// ── THE HELD-OUT FLAG — NOW A REFUSAL TOO (Build 2, adjudication-mandated) ───
//
//   Build 1 shipped `loadStandardScenarios` / `loadHeldOutScenarios` — a
//   FILTER on `heldOut`, silent about anything the filter drops. Build 1's
//   receipt flagged (judgment call 4) that nothing stopped a held-out
//   scenario from being sealed under the "wrong" book; house adjudication
//   ruled that gap closed, not discretionary, so this build adds a second,
//   STRICTER layer rather than reworking the filter (which still has a
//   legitimate job: "give me the standard subset of this catalogue").
//
//   `PrecommitBook` itself is untouched — no import, no signature, no
//   behaviour of that module changed by this file, matching the brief's "the
//   book stays byte-untouched." The role lives ENTIRELY at this adapter
//   layer: a `RoledBook` pairs a book with a declared `BookRole`, and
//   `sealScenarioKey` now takes one instead of a bare `PrecommitBook` — the
//   one signature change this build makes to Build-1 code, and it is the
//   change the brief names by function name ("`sealScenarioKey` REFUSES...").
//   `loadScenariosForRole` is the loaders' stricter sibling: given a role and
//   a list, it REFUSES (throws) if any scenario's `heldOut` disagrees with
//   that role, rather than silently dropping it — silent dropping is exactly
//   the failure mode this project keeps refusing elsewhere (a family that
//   quietly lost a member reads as complete). `loadStandardScenarios` /
//   `loadHeldOutScenarios` are kept, unedited, for callers that genuinely want
//   the subset of a mixed catalogue rather than a homogeneity assertion.

import { PrecommitBook, randomSalt } from "../precommit/precommit";
import type { Modality, SealOutcome } from "../precommit/precommit";
import type { GradingVerdict, ScenarioDefinition } from "./scenario";

/** What a committer keeps: which PC-book entry carries this scenario's key. */
export interface SealedKeyReference {
  /** The COMMITMENT record's sequence number in the book it was sealed under. */
  readonly commitmentRef: number;
  /** The committer id sealed into that record. Never the grader — see header. */
  readonly committerId: string;
}

export interface SealedScenario extends ScenarioDefinition {
  readonly sealedKey: SealedKeyReference;
}

export interface ScenarioSealResult {
  readonly sealed: SealedScenario;
  /** The book's own outcome, unedited — persistence, envelope, head-commit state. */
  readonly outcome: SealOutcome;
}

/** Which side of the standard/held-out split a `PrecommitBook` was declared to be. */
export type BookRole = "STANDARD" | "HELD_OUT";

export const BOOK_ROLES: readonly BookRole[] = ["STANDARD", "HELD_OUT"];

/**
 * A `PrecommitBook` with its role declared AT THIS ADAPTER, never inside the
 * book itself (see header — the book stays byte-untouched). The role is the
 * one fact `sealScenarioKey` and `loadScenariosForRole` refuse to see
 * violated.
 */
export interface RoledBook {
  readonly role: BookRole;
  readonly book: PrecommitBook;
}

/**
 * A refusal by this adapter, typed so a caller can tell "the role disagreed"
 * from "the disk broke" or "the book itself refused" (`PrecommitRefused`).
 * Mirrors precommit.ts's own typed-refusal discipline rather than throwing a
 * bare `Error`.
 */
export class ScenarioSealRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioSealRefused";
  }
}

/**
 * Seal a scenario's expected grading verdict pre-dispatch, through the
 * caller's `RoledBook`. The predicted value is the verdict a CORRECT response
 * to this scenario should earn; grading it (Build 3) means comparing an
 * observed routing against this sealed prediction, never the other way round.
 *
 * REFUSES before touching the book at all — same discipline as
 * `refuseUnsealable` in precommit.ts — when the scenario's `heldOut` flag
 * disagrees with the book's declared role: a held-out scenario has no
 * business in a STANDARD book (it could leak into a standard dispatch), and a
 * standard scenario sealed into a HELD_OUT book would silently shrink the
 * transfer set's own integrity guarantee.
 *
 * `salt` defaults to `randomSalt()` (offered by precommit.ts, never called
 * from inside precommit.ts itself) because the committer — this function's
 * caller — must be able to reproduce its own seal; passing one explicitly is
 * for tests that need a reproducible preimage.
 */
export function sealScenarioKey(
  roledBook: RoledBook,
  scenario: ScenarioDefinition,
  expectedVerdict: GradingVerdict,
  committerId: string,
  timestamp: number,
  modality: Modality,
  salt: string = randomSalt()
): ScenarioSealResult {
  if (roledBook.role === "STANDARD" && scenario.heldOut) {
    throw new ScenarioSealRefused(
      `refused: scenario "${scenario.id}" is heldOut:true and cannot be sealed ` +
        `into a STANDARD-role book — a held-out scenario in a standard book could ` +
        `leak into a standard dispatch.`
    );
  }
  if (roledBook.role === "HELD_OUT" && !scenario.heldOut) {
    throw new ScenarioSealRefused(
      `refused: scenario "${scenario.id}" is heldOut:false and cannot be sealed ` +
        `into a HELD_OUT-role book — a standard scenario sealed there would ` +
        `silently shrink the transfer set's integrity guarantee.`
    );
  }
  const outcome = roledBook.book.seal({
    expectation: {
      type: "verdict",
      target: scenario.id,
      predictedValue: expectedVerdict,
      committerId,
      salt,
    },
    timestamp,
    modality,
  });
  const sealed: SealedScenario = {
    ...scenario,
    sealedKey: { commitmentRef: outcome.record.sequenceNumber, committerId },
  };
  return { sealed, outcome };
}

/** Every scenario the standard runner may load. Held-out scenarios are absent. */
export function loadStandardScenarios(
  all: readonly ScenarioDefinition[]
): readonly ScenarioDefinition[] {
  return all.filter((s) => !s.heldOut);
}

/** The complement — never loaded by anything that calls the function above. */
export function loadHeldOutScenarios(
  all: readonly ScenarioDefinition[]
): readonly ScenarioDefinition[] {
  return all.filter((s) => s.heldOut);
}

/**
 * The stricter sibling (Build 2, adjudication-mandated): asserts a list is
 * HOMOGENEOUS for the declared role rather than extracting the matching
 * subset. Where `loadStandardScenarios` would silently drop a stray held-out
 * scenario, this REFUSES — a dispatch batch that quietly lost a member reads
 * as complete, which is the failure this project keeps refusing elsewhere
 * (a fresh chain is a bare count with no name attached; an empty book prints
 * why rather than a clean zero). Tested both directions in
 * scenario-seal.test.ts.
 */
export function loadScenariosForRole(
  role: BookRole,
  scenarios: readonly ScenarioDefinition[]
): readonly ScenarioDefinition[] {
  const expectedHeldOut = role === "HELD_OUT";
  const mismatched = scenarios.filter((s) => s.heldOut !== expectedHeldOut);
  if (mismatched.length > 0) {
    throw new ScenarioSealRefused(
      `refused: ${String(mismatched.length)} scenario(s) do not match declared ` +
        `role ${role} (heldOut must be ${String(expectedHeldOut)}): ` +
        `${mismatched.map((s) => s.id).join(", ")}. Role-mixed input is refused ` +
        `rather than silently filtered.`
    );
  }
  return scenarios;
}
