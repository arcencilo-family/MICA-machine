// ── MICA · DC-2 — the staleness alarm. A COMPARISON, and only a comparison ────
//
//   Origin: `ARC_MICA-NOTE_Design-Candidates.md` DC-2, parked S106, briefed S108
//   (`ARC_MICA-BRIEF_S108-DC2-Staleness-Alarm_20260903.md`). Ground: S106 receipt
//   §E's finding that nothing in this tree holds an expectation that any chain's
//   head SHOULD have arrived, so a chain that stops presenting is invisible
//   among the ones that keep speaking.
//
// ── THE ONE SENTENCE THIS MODULE IS ALLOWED TO SAY ────────────────────────────
//
//   A chain's newest retained head is older than a cadence someone declared for
//   it, or it is not, or there is no basis to say — and the declaration is
//   always someone's word, never this module's guess.
//
// ── R8 — DECLARED, NEVER DERIVED ──────────────────────────────────────────────
//
//   The expected cadence is read from a file an operator wrote. This module
//   NEVER computes a cadence from observed arrival history — no mean, no
//   median, no "usually every N days so N+slack is expected". A cadence this
//   module invented from the data would be the data grading itself.
//
// ── RULING-B BOUNDARY (S106) ──────────────────────────────────────────────────
//
//   The observed system never self-attests its connectivity; the witness side
//   holds the expectation. This module IS that holding — it lives on the report
//   side, reads the witness store's own `chainsLastSeen` (whole-store, S106b),
//   and compares it to a file the deployer wrote. Nothing here asks anybody
//   anything.
//
// ── NEGATIVE-ONLY VOCABULARY ───────────────────────────────────────────────────
//
//   The only two verdict words this module ever writes are STALE and
//   CANNOT_ASSESS. THERE IS NO THIRD WORD. A chain that is declared, present in
//   the store, and not stale earns no row here — ever. It is counted
//   (`assessedFreshCount`), because a count that vanishes when it is not zero
//   is indistinguishable from a count nobody took (same discipline as the
//   report's COUNT lines elsewhere) — but it is a NUMBER, not a claim about any
//   named chain, and "fresh" never becomes "healthy" in this module's mouth.

import { readFileSync } from "fs";

import type { ChainLastSeenRow } from "./witness-report";

export const MS_PER_DAY = 86_400_000;

export type CadenceDeclarationState = "ABSENT" | "CONFIGURED_EMPTY" | "CONFIGURED";

/**
 * The declared expected cadence, per chain, in DAYS. Same three-state shape as
 * `witnessd.ts`'s `loadDeclared` (`DeclaredSubmitters`), on purpose: a
 * configured-but-unreadable file is `CONFIGURED_EMPTY`, never `ABSENT` — the
 * deployment asked for a declaration and did not get a usable one, which is a
 * different fact than nobody asking at all.
 */
export interface CadenceDeclaration {
  readonly state: CadenceDeclarationState;
  readonly source: string; // "none" when no path was even supplied
  /** chain_id -> declared max age, in days. Empty unless `state` is CONFIGURED. */
  readonly cadenceDaysByChain: ReadonlyMap<string, number>;
  readonly problems: readonly string[];
}

/** The state a caller that never supplied `--cadence-file` reads as. */
export const ABSENT_CADENCE_DECLARATION: CadenceDeclaration = {
  state: "ABSENT",
  source: "none",
  cadenceDaysByChain: new Map(),
  problems: [],
};

/**
 * Reads a JSON object of `{ "<chain_id>": <max age in days>, ... }`. Never
 * throws — every failure becomes a state, exactly as `loadDeclared` does for
 * the witness's own declared-submitters file, and for the identical reason:
 * this program's exit code must never ride on whether a deployer's config file
 * parses.
 */
export function loadCadenceDeclaration(path: string | null): CadenceDeclaration {
  if (path === null) return ABSENT_CADENCE_DECLARATION;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      state: "CONFIGURED_EMPTY",
      source: path,
      cadenceDaysByChain: new Map(),
      problems: [
        `cadence declaration ${path} could not be read as JSON: ${String(error)}. ` +
          `A configured-but-unreadable declaration is CONFIGURED_EMPTY, never ABSENT: ` +
          `the deployment asked and did not get one.`,
      ],
    };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      state: "CONFIGURED_EMPTY",
      source: path,
      cadenceDaysByChain: new Map(),
      problems: [`cadence declaration ${path} is not a JSON object of chain_id -> days`],
    };
  }

  const problems: string[] = [];
  const map = new Map<string, number>();
  for (const [chainId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (chainId.length === 0) {
      problems.push("an empty chain_id key was present; skipped");
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      problems.push(
        `chain ${JSON.stringify(chainId)}: declared cadence ${JSON.stringify(value)} is not ` +
          `a positive finite number of days; skipped`
      );
      continue;
    }
    map.set(chainId, value);
  }
  return {
    state: map.size === 0 ? "CONFIGURED_EMPTY" : "CONFIGURED",
    source: path,
    cadenceDaysByChain: map,
    problems,
  };
}

export type StalenessVerdictState = "STALE" | "CANNOT_ASSESS";

export interface StalenessVerdict {
  readonly chainId: string;
  readonly state: StalenessVerdictState;
  readonly reason: string;
  readonly declaredMaxAgeDays: number;
  /** Null exactly for a CANNOT_ASSESS chain that has no head in the store at all. */
  readonly newestSeq: number | null;
  readonly newestArrivalTs: number | null;
  readonly ageHours: number | null;
}

export interface StalenessReading {
  readonly declaration: CadenceDeclaration;
  readonly nowMs: number;
  /**
   * STALE rows and per-chain CANNOT_ASSESS rows only. Sorted by chain_id so
   * two assessments of the same inputs render byte-identically. NEVER a row
   * for a fresh chain — see the module header.
   */
  readonly verdicts: readonly StalenessVerdict[];
  /**
   * Chain ids present in the store's whole-store `chainsLastSeen` but absent
   * from a CONFIGURED declaration. Visible, sorted, and NEVER graded — the
   * declaration's membership is the arbiter's, not inferred from arrival.
   */
  readonly undeclaredChains: readonly string[];
  readonly staleCount: number;
  readonly cannotAssessCount: number;
  readonly undeclaredCount: number;
  /** Declared, present in the store, not stale. A COUNT, never a per-chain claim. */
  readonly assessedFreshCount: number;
}

/** What every field reads as when there is no usable declaration at all. */
function noAssessment(declaration: CadenceDeclaration, nowMs: number): StalenessReading {
  return {
    declaration,
    nowMs,
    verdicts: [],
    undeclaredChains: [],
    staleCount: 0,
    cannotAssessCount: 0,
    undeclaredCount: 0,
    assessedFreshCount: 0,
  };
}

/**
 * The comparison. Declared-never-derived: `chainsLastSeen` is the ONLY store
 * input, and it is read, never fitted to. `nowMs` is the caller's own clock,
 * read once and injected — the same discipline the rest of this report holds.
 *
 * `declaration.state !== "CONFIGURED"` (ABSENT or CONFIGURED_EMPTY) means
 * there is no declared cadence for anything: the whole assessment is
 * CANNOT_ASSESS, named on `declaration.state`/`declaration.problems`, and no
 * per-chain verdicts or UNDECLARED names are produced — "undeclared" is
 * meaningless relative to a declaration that does not exist.
 */
export function assessStaleness(
  declaration: CadenceDeclaration,
  chainsLastSeen: readonly ChainLastSeenRow[],
  nowMs: number
): StalenessReading {
  if (declaration.state !== "CONFIGURED") return noAssessment(declaration, nowMs);

  const storeByChain = new Map(chainsLastSeen.map((row) => [row.chainId, row] as const));
  const declaredChainIds = [...declaration.cadenceDaysByChain.keys()].sort();
  const verdicts: StalenessVerdict[] = [];
  let staleCount = 0;
  let cannotAssessCount = 0;
  let assessedFreshCount = 0;

  for (const chainId of declaredChainIds) {
    const maxDays = declaration.cadenceDaysByChain.get(chainId) as number;
    const row = storeByChain.get(chainId);
    if (row === undefined) {
      cannotAssessCount++;
      verdicts.push({
        chainId,
        state: "CANNOT_ASSESS",
        reason: "declared chain has never presented a NAMED head in this store",
        declaredMaxAgeDays: maxDays,
        newestSeq: null,
        newestArrivalTs: null,
        ageHours: null,
      });
      continue;
    }
    const ageMs = nowMs - row.arrivalTs;
    if (ageMs > maxDays * MS_PER_DAY) {
      staleCount++;
      verdicts.push({
        chainId,
        state: "STALE",
        reason: `newest head is older than the declared ${maxDays}-day cadence`,
        declaredMaxAgeDays: maxDays,
        newestSeq: row.seq,
        newestArrivalTs: row.arrivalTs,
        ageHours: ageMs / 3_600_000,
      });
    } else {
      // Negative-only vocabulary: NO row is written for a fresh chain. Counted, not named.
      assessedFreshCount++;
    }
  }

  const declaredSet = new Set(declaredChainIds);
  const undeclaredChains = chainsLastSeen
    .map((row) => row.chainId)
    .filter((chainId) => !declaredSet.has(chainId))
    .sort();

  return {
    declaration,
    nowMs,
    verdicts,
    undeclaredChains,
    staleCount,
    cannotAssessCount,
    undeclaredCount: undeclaredChains.length,
    assessedFreshCount,
  };
}
