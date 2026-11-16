// ── MICA · clerk-caller attestation — item 3 (S109-B) ────────────────────────
//
//   Origin: `ARC_MICA-BRIEF_S109-Item2-Wiring_20260904.md` item 3. Ground: the
//   caller (`mica-clerk-caller.ts`) can fail silently in every way a cron-run
//   program can — never installed, never scheduled, wedged behind a dead
//   clerk socket — and none of that shows up anywhere unless something reads
//   FOR its absence, the same way DC-2 (staleness-alarm.ts) reads for a
//   chain's silence instead of trusting its last good word.
//
// ── THE ONE SENTENCE THIS MODULE IS ALLOWED TO SAY ────────────────────────────
//
//   The stamps file the caller is supposed to be writing either does not
//   exist, exists and holds nothing, could not be read, or holds some number
//   of stamps — and that number is a COUNT, never a claim that the caller is
//   running, in good order, or current.
//
// ── NEGATIVE-ONLY VOCABULARY (brief item 3; same fence as staleness-alarm) ───
//
//   The only two NAMED states this module ever prints are CALLER_ABSENT and
//   NO_STAMPED_RECORDS. A file that holds N>0 stamps earns NO third word —
//   not "flowing", not a health word, not "current" — it earns a COUNT
//   (`stampedRecordCount`), exactly as an assessed-fresh chain in DC-2 earns a
//   count and never a row. A THIRD state, CANNOT_ASSESS, is kept for "present
//   and unreadable/malformed" — S97-D(2) is in force: never read a
//   cannot-see as an absence, and never read either as a clean zero.
//
// ── WHAT "ABSENT" MEANS HERE, AND WHY IT DIFFERS FROM "EMPTY" ─────────────────
//
//   CALLER_ABSENT: no `--clerk-stamps-file` was supplied, OR one was supplied
//   and NOTHING is at that path (ENOENT) — no writer has ever produced a
//   stamp. This is the louder fact: an operator either never wired the
//   attestation at all, or wired it and nothing has EVER run.
//
//   NO_STAMPED_RECORDS: the file exists, is readable, parses — and holds zero
//   stamps. The caller (or its deployment) exists in some observable sense
//   (something created the file), but has not stamped anything, e.g. because
//   the log has not grown past whatever cursor position it started at.
//
//   These are DIFFERENT FACTS and this module refuses to fold them into one.

import { readFileSync } from "fs";

export type CallerAttestationState =
  | "CALLER_ABSENT"
  | "NO_STAMPED_RECORDS"
  | "CANNOT_ASSESS"
  | "STAMPS_PRESENT"; // never printed as a claim of health — count only, see below

export interface ClerkCallerReading {
  readonly state: CallerAttestationState;
  readonly source: string; // "none" when no path was even supplied
  readonly reason: string;
  /** A COUNT, never a health claim. Null exactly when state is CANNOT_ASSESS. */
  readonly stampedRecordCount: number | null;
}

export const CLERK_CALLER_NOT_WIRED: ClerkCallerReading = {
  state: "CALLER_ABSENT",
  source: "none",
  reason: "NOT ATTEMPTED — no --clerk-stamps-file was supplied to this run.",
  stampedRecordCount: null,
};

/**
 * Count non-blank, JSON-parseable lines in a JSONL file. Deliberately NOT the
 * full ClerkClockStamp shape check `clerk-clock-stamps-file.ts`'s reader
 * performs — this module answers "how many lines does this file hold", not
 * "is F3 able to trust them". Re-implementing F3's own shape gate here would
 * be a second grader of the same bytes; a report is a reader, not a sensor.
 */
function countParseableLines(raw: string): { count: number; malformedAt: number | null } {
  const lines = raw.split("\n");
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (text.trim().length === 0) continue;
    try {
      JSON.parse(text);
      count++;
    } catch {
      return { count, malformedAt: i + 1 };
    }
  }
  return { count, malformedAt: null };
}

/**
 * Read best-effort, WARN-NEVER-STOP — same discipline `readEngObservable` and
 * `loadCadenceDeclaration` hold: whatever happens here must never change the
 * report's exit code or keep the rest of the report from being written.
 */
export function readClerkCallerAttestation(stampsPath: string | null): ClerkCallerReading {
  if (stampsPath === null) return CLERK_CALLER_NOT_WIRED;

  let raw: string;
  try {
    raw = readFileSync(stampsPath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        state: "CALLER_ABSENT",
        source: stampsPath,
        reason:
          `no file exists at ${stampsPath}. A path was declared and nothing is ` +
          `there: no writer has ever produced a stamp.`,
        stampedRecordCount: null,
      };
    }
    return {
      state: "CANNOT_ASSESS",
      source: stampsPath,
      reason: `${stampsPath} could not be read (${String(code ?? err)}). THIS IS NOT absence.`,
      stampedRecordCount: null,
    };
  }

  const { count, malformedAt } = countParseableLines(raw);
  if (malformedAt !== null) {
    return {
      state: "CANNOT_ASSESS",
      source: stampsPath,
      reason: `${stampsPath} line ${malformedAt} is not valid JSON. Not re-parsed further.`,
      stampedRecordCount: null,
    };
  }
  if (count === 0) {
    return {
      state: "NO_STAMPED_RECORDS",
      source: stampsPath,
      reason: `${stampsPath} exists, is readable, and holds zero stamps.`,
      stampedRecordCount: 0,
    };
  }
  // A count. Never a claim. See the module header.
  return {
    state: "STAMPS_PRESENT",
    source: stampsPath,
    reason: `${stampsPath} holds ${count} line(s). A count, not a health claim.`,
    stampedRecordCount: count,
  };
}
