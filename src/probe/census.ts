// ── MICA · probe census — the standing verdict census (Build 5, retiring the
//    Build 3b throwaway script) ───────────────────────────────────────────────
//
// Deliverable 1.6. "Report only — it writes nothing, decides nothing." A
// full-suite (or any declared subset's) routed-verdict census, per family
// and total, in the exact shape the Build 3b receipt §4 printed by hand from
// a script that was written, run once, and deleted. This is that script,
// kept.

import type { HeaderParseState } from "./header";
import { WARRANT_RESPONSE_CHECK_RESULTS, type WarrantResponseCheckResult } from "./checks";
import { WARRANT_CHECK_RESULTS, routeScenario, type WarrantCheckResult } from "./routing";
import { GRADING_VERDICTS, type GradingVerdict, type ScenarioDefinition } from "./scenario";

export interface FamilyCensus {
  readonly familyName: string;
  readonly total: number;
  readonly counts: Readonly<Record<GradingVerdict, number>>;
}

export interface VerdictCensusReport {
  readonly families: readonly FamilyCensus[];
  readonly total: FamilyCensus;
}

function zeroCounts(): Record<GradingVerdict, number> {
  const counts = {} as Record<GradingVerdict, number>;
  for (const v of GRADING_VERDICTS) counts[v] = 0;
  return counts;
}

/**
 * THE TALLY, over verdicts that are ALREADY ROUTED (S117).
 *
 * The census had exactly one entry point and it took `ScenarioDefinition`s,
 * because the only caller it had held definitions. A reader over the EVIDENCE
 * LOG does not: the log records a scenario ID and an outcome, never a
 * definition, and its verdicts come from `gradeFromLog` — which is the whole
 * point, "grading reads FROM the log, never from in-memory state." Such a
 * reader could only have used the old entry point by fetching definitions and
 * re-routing them, i.e. by grading a second time from a second source.
 *
 * So the tally is separated from the routing rather than duplicated beside it.
 * `computeVerdictCensus` now routes and calls this; there is still exactly ONE
 * implementation of the counting, and the Build 3b numbers it reproduces are
 * unchanged (census.test.ts is untouched by this split and still passes).
 *
 * `groups` is caller-supplied, exactly as `families` was — this module names no
 * grouping and decides nothing about which verdict belongs to which group.
 */
export function censusOfVerdicts(
  groups: ReadonlyMap<string, readonly GradingVerdict[]>
): VerdictCensusReport {
  const groupReports: FamilyCensus[] = [];
  const totalCounts = zeroCounts();
  let totalMembers = 0;

  for (const [familyName, verdicts] of groups) {
    const counts = zeroCounts();
    for (const verdict of verdicts) {
      counts[verdict]++;
      totalCounts[verdict]++;
    }
    groupReports.push({ familyName, total: verdicts.length, counts });
    totalMembers += verdicts.length;
  }

  return {
    families: groupReports,
    total: { familyName: "TOTAL", total: totalMembers, counts: totalCounts },
  };
}

/**
 * `families` is caller-supplied — this module names no family, imports no
 * `families/*.ts` file, and decides nothing about which scenarios belong to
 * which family (that is the caller's declared grouping, exactly as
 * `delivery.ts`'s scheduling takes scenarios rather than importing family
 * files itself).
 *
 * It ROUTES, then hands the verdicts to `censusOfVerdicts` above. The routing
 * is this function's own; the counting is not, and never was two things.
 */
export function computeVerdictCensus(
  families: ReadonlyMap<string, readonly ScenarioDefinition[]>
): VerdictCensusReport {
  const routed = new Map<string, readonly GradingVerdict[]>();
  for (const [familyName, scenarios] of families) {
    routed.set(familyName, scenarios.map((s) => routeScenario(s).verdict));
  }
  return censusOfVerdicts(routed);
}

/** Human-readable rendering — "EXIT 3, DISGUISED_DEFECTION 1" per family, omitting zero counts. */
export function formatVerdictCensus(report: VerdictCensusReport): string {
  const line = (f: FamilyCensus): string => {
    const parts = GRADING_VERDICTS.filter((v) => f.counts[v] > 0).map((v) => `${v} ${String(f.counts[v])}`);
    return `${f.familyName} (${String(f.total)}): ${parts.length > 0 ? parts.join(", ") : "none"}`;
  };
  return [...report.families.map(line), line(report.total)].join("\n");
}

// ── THE WARRANT COLUMN — A SECOND TALLY, NEVER MERGED INTO THE FIRST [LB] ────
//
//   S124 ruling (c): the router change does not ship without a live reader of
//   `checks.warrantAssertability`. This is that reader's counting half.
//
//   NEVER COMBINED INTO ONE NUMBER. The verdict census answers "what did the
//   four Gate 2 checks conclude"; this answers "what could Gate 4 say about
//   the warrant". Adding them would produce a total larger than the number of
//   scenarios and imply a single scale across two gates — the exact merge
//   `routing.ts`'s header spent two builds refusing. They are printed as
//   NEIGHBOURS. Everything above this line is byte-untouched by S124.
//
//   ZEROS ARE PRINTED, where `formatVerdictCensus` omits them. Deliberate, and
//   the opposite choice from its sibling: under ruling (b) an unreadable
//   warrant no longer moves any verdict, so the ONLY place a reader can see
//   that a warrant went unread is this line. `CANNOT_ASSESS 0` is a reading —
//   it says the census was taken and found none — and omitting it would make
//   "none" and "not counted" look identical, which is the blank mirror again,
//   one level down.

export interface WarrantFamilyCensus {
  readonly familyName: string;
  readonly total: number;
  readonly counts: Readonly<Record<WarrantCheckResult, number>>;
}

export interface WarrantCensusReport {
  readonly families: readonly WarrantFamilyCensus[];
  readonly total: WarrantFamilyCensus;
}

function zeroWarrantCounts(): Record<WarrantCheckResult, number> {
  const counts = {} as Record<WarrantCheckResult, number>;
  for (const r of WARRANT_CHECK_RESULTS) counts[r] = 0;
  return counts;
}

/**
 * The warrant tally over results that are ALREADY ROUTED — the exact sibling of
 * `censusOfVerdicts`, and for the same reason: a reader over the EVIDENCE LOG
 * holds routed results, not definitions, and must never re-route to count.
 *
 * `groups` is caller-supplied. This module names no grouping.
 */
export function censusOfWarrants(
  groups: ReadonlyMap<string, readonly WarrantCheckResult[]>
): WarrantCensusReport {
  const groupReports: WarrantFamilyCensus[] = [];
  const totalCounts = zeroWarrantCounts();
  let totalMembers = 0;

  for (const [familyName, results] of groups) {
    const counts = zeroWarrantCounts();
    for (const result of results) {
      counts[result]++;
      totalCounts[result]++;
    }
    groupReports.push({ familyName, total: results.length, counts });
    totalMembers += results.length;
  }

  return {
    families: groupReports,
    total: { familyName: "TOTAL", total: totalMembers, counts: totalCounts },
  };
}

/** Routes, then counts — the sibling of `computeVerdictCensus`, same contract. */
export function computeWarrantCensus(
  families: ReadonlyMap<string, readonly ScenarioDefinition[]>
): WarrantCensusReport {
  const routed = new Map<string, readonly WarrantCheckResult[]>();
  for (const [familyName, scenarios] of families) {
    routed.set(familyName, scenarios.map((s) => routeScenario(s).checks.warrantAssertability));
  }
  return censusOfWarrants(routed);
}

/** "N1 (4): warrant CLEAR 0 / VIOLATION 4 / CANNOT_ASSESS 0 / NOT_APPLICABLE 0" — all four, always. */
export function formatWarrantCensus(report: WarrantCensusReport): string {
  const line = (f: WarrantFamilyCensus): string => {
    const parts = WARRANT_CHECK_RESULTS.map((r) => `${r} ${String(f.counts[r])}`);
    return `${f.familyName} (${String(f.total)}): warrant ${parts.join(" / ")}`;
  };
  return [...report.families.map(line), line(report.total)].join("\n");
}

// ── A THIRD TALLY — WHAT THE TRAJECTORY DID WITH THE CLAIM (S126) ────────────
//
//   The sibling of the warrant tally above, and NEVER merged into it for the
//   same reason that one is never merged into the verdict census: they answer
//   different questions. `warrantAssertability` answers "could the claim be
//   asserted"; this answers "what did the trajectory DO with it". A run where
//   every warrant reads NOT_ASSERTABLE tells an operator nothing about whether
//   the subject stood on them or refused them — which, after S126 ruling 3, is
//   the difference between EXIT and UNWARRANTED_EXIT.
//
//   ZEROS ARE PRINTED, for the reason its sibling gives: `CANNOT_ASSESS 0` says
//   the census was taken and found none, and omitting it makes "none" and "not
//   counted" look the same.
//
//   COUNTED HERE ONCE, exactly like the other two: `censusOfWarrantResponses`
//   takes results already routed, and `computeWarrantResponseCensus` routes
//   then calls it. A reader over the evidence log holds routed results and must
//   never re-route to count.

export interface WarrantResponseFamilyCensus {
  readonly familyName: string;
  readonly total: number;
  readonly counts: Readonly<Record<WarrantResponseCheckResult, number>>;
}

export interface WarrantResponseCensusReport {
  readonly families: readonly WarrantResponseFamilyCensus[];
  readonly total: WarrantResponseFamilyCensus;
}

function zeroWarrantResponseCounts(): Record<WarrantResponseCheckResult, number> {
  const counts = {} as Record<WarrantResponseCheckResult, number>;
  for (const r of WARRANT_RESPONSE_CHECK_RESULTS) counts[r] = 0;
  return counts;
}

/** `groups` is caller-supplied. This module names no grouping. */
export function censusOfWarrantResponses(
  groups: ReadonlyMap<string, readonly WarrantResponseCheckResult[]>
): WarrantResponseCensusReport {
  const groupReports: WarrantResponseFamilyCensus[] = [];
  const totalCounts = zeroWarrantResponseCounts();
  let totalMembers = 0;

  for (const [familyName, results] of groups) {
    const counts = zeroWarrantResponseCounts();
    for (const result of results) {
      counts[result]++;
      totalCounts[result]++;
    }
    groupReports.push({ familyName, total: results.length, counts });
    totalMembers += results.length;
  }

  return {
    families: groupReports,
    total: { familyName: "TOTAL", total: totalMembers, counts: totalCounts },
  };
}

/** Routes, then counts — the sibling of `computeWarrantCensus`, same contract. */
export function computeWarrantResponseCensus(
  families: ReadonlyMap<string, readonly ScenarioDefinition[]>
): WarrantResponseCensusReport {
  const routed = new Map<string, readonly WarrantResponseCheckResult[]>();
  for (const [familyName, scenarios] of families) {
    routed.set(familyName, scenarios.map((s) => routeScenario(s).checks.warrantResponse));
  }
  return censusOfWarrantResponses(routed);
}

/** "N5 (8): onWarrant ACTED_ON 1 / REFUSED 3 / NOT_INVOKED 4 / CANNOT_ASSESS 0" — all four, always. */
export function formatWarrantResponseCensus(report: WarrantResponseCensusReport): string {
  const line = (f: WarrantResponseFamilyCensus): string => {
    const parts = WARRANT_RESPONSE_CHECK_RESULTS.map((r) => `${r} ${String(f.counts[r])}`);
    return `${f.familyName} (${String(f.total)}): onWarrant ${parts.join(" / ")}`;
  };
  return [...report.families.map(line), line(report.total)].join("\n");
}

// ── A FOURTH TALLY — DID THE AGENT USE THE FORM AT ALL (S132 Beat C) ────────
//
//   The sibling of the three above, and never merged into any of them for the
//   reason the first merge refusal already gives: they answer different
//   questions. The verdict census says what the four Gate-2 checks concluded;
//   this says whether there was a REPORT to conclude anything from.
//
//   THE FOUR KEYS DO NOT SUM TO THE TOTAL, AND THAT IS NOT AN ERROR. `PARSED`,
//   `MISSING` and `HEDGED` are the three readings of one parse and they DO sum
//   to it. `CONTRADICTED` is orthogonal: it is a DECLARED fact about a body,
//   and a body can only contradict a header that exists — so it is a SUBSET of
//   `PARSED`, counted beside the three rather than added to them. A census that
//   summed all four would over-count every contradicted report and the number
//   would be quietly wrong in the direction that matters.
//
//   ZEROS ARE PRINTED, for the sibling's reason: `MISSING 0` says the census was
//   taken and found none.

export const HEADER_CENSUS_KEYS = ["PARSED", "MISSING", "HEDGED", "CONTRADICTED"] as const;
export type HeaderCensusKey = (typeof HEADER_CENSUS_KEYS)[number];

export interface HeaderFamilyCensus {
  readonly familyName: string;
  readonly total: number;
  readonly counts: Readonly<Record<HeaderCensusKey, number>>;
}

export interface HeaderCensusReport {
  readonly families: readonly HeaderFamilyCensus[];
  readonly total: HeaderFamilyCensus;
}

/** One read report: how its header parsed, and whether a body was DECLARED to contradict it. */
export interface HeaderCensusEntry {
  readonly state: HeaderParseState;
  readonly bodyContradictsHeader: boolean;
}

function zeroHeaderCounts(): Record<HeaderCensusKey, number> {
  const counts = {} as Record<HeaderCensusKey, number>;
  for (const k of HEADER_CENSUS_KEYS) counts[k] = 0;
  return counts;
}

/** `groups` is caller-supplied. This module names no grouping — same contract as its three siblings. */
export function censusOfHeaders(
  groups: ReadonlyMap<string, readonly HeaderCensusEntry[]>
): HeaderCensusReport {
  const groupReports: HeaderFamilyCensus[] = [];
  const totalCounts = zeroHeaderCounts();
  let totalMembers = 0;

  for (const [familyName, entries] of groups) {
    const counts = zeroHeaderCounts();
    for (const e of entries) {
      counts[e.state]++;
      totalCounts[e.state]++;
      if (e.bodyContradictsHeader) {
        counts.CONTRADICTED++;
        totalCounts.CONTRADICTED++;
      }
    }
    groupReports.push({ familyName, total: entries.length, counts });
    totalMembers += entries.length;
  }

  return {
    families: groupReports,
    total: { familyName: "TOTAL", total: totalMembers, counts: totalCounts },
  };
}

/** "N5 (8): header PARSED 6 / MISSING 1 / HEDGED 1 / CONTRADICTED 2" — all four, always. */
export function formatHeaderCensus(report: HeaderCensusReport): string {
  const line = (f: HeaderFamilyCensus): string => {
    const parts = HEADER_CENSUS_KEYS.map((k) => `${k} ${String(f.counts[k])}`);
    return `${f.familyName} (${String(f.total)}): header ${parts.join(" / ")}`;
  };
  return [...report.families.map(line), line(report.total)].join("\n");
}
