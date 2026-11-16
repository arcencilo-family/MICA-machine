// ── MICA · the exported record (T1 v1.2, step 4 — REACH) ──────────────────────
//
// WHAT THIS MODULE IS FOR
//
//   T1's fourth step, cited from ARC_MICA-CANON_Two-Tier-Read-Test_20260807 §2
//   and not restated here, requires that a party OUTSIDE the observed loop can
//   read the finding WITHOUT the observed system's tooling, at a declared and
//   stable location — and that the instrument STATES the reader-competence it
//   presumes.
//
//   Before this module, both sensors returned a typed value to their caller and
//   printed to a console. Both of those require our tooling: a TypeScript
//   consumer holding our type definitions, or a terminal attached to our
//   process. Neither is available to an outside reader. The finding existed and
//   could not be read.
//
//   This module writes it to a file, in prose, at an injected path.
//
// ⚠ WHAT THIS MODULE IS NOT, AND THE ERROR IT MUST NOT REPEAT
//
//   THIS BUYS TOOLING-INDEPENDENCE. IT BUYS NO ADVERSARIAL DISTANCE WHATEVER.
//
//   The file is written by the observed party, in the observed party's process,
//   at a path the observed party can read, truncate or rewrite. A field-
//   authorship census of this codebase found 37 typed fields and ZERO the
//   observed party cannot determine. A beautifully legible export of a
//   fabricated record is a beautifully legible fabrication.
//
//   So this module claims NONE of the following, and no future edit may add
//   them: that the export is independent, external, separated, or out of reach
//   of the observed system; that a reader outside the loop now sees something
//   the system did not author; that anything here is harder to game than it was
//   before.
//
//   PRECEDENT, AND IT IS EXACTLY THIS SHAPE. X-1 claimed a separate clerk
//   process meant "defeating the clerk now requires OS-level privilege." False
//   at the default deployment: a separate process is not a separate OS
//   principal. Writing a file at the same user is the same error one step over.
//
//   The artifact says all of this to its own reader, in the WHAT THIS FILE IS
//   NOT section, because a reader who mistakes legibility for independence has
//   been misled by the thing they are holding.
//
// ⚠ THE ARTIFACT IS UNCURATED, AND THAT IS THE POINT
//
//   The canon's §5 commentary is explicit that an alarm-gated channel is
//   curated — curated by the instrument — so the human sees only what the
//   instrument decided to show. An exporter that wrote only ALARMs would be
//   exactly that, and would fail T1 while appearing to satisfy it.
//
//   Every run writes a full artifact. ALARM, SILENT and CANNOT_ASSESS get the
//   same sections in the same order with the same weight. A run that found
//   nothing produces a complete record of having found nothing over a named
//   scope. There is no filter, no severity gate, and no "only write if
//   interesting" branch anywhere in this file.
//
// ⚠ CANNOT_ASSESS IS NOT A KIND OF SILENCE
//
//   It gets its own banner, its own border character, and a line stating in
//   terms that the scope was not read. Nothing in this module maps it onto
//   SILENT, defaults it to SILENT, or renders it in a way a reader could
//   mistake for SILENT.

import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { cannotAssess, SILENCE_IS_NOT_HEALTH } from "../types";
import type { BlindPath, SensorVerdict } from "../types";
import {
  digestOf,
  ExportLedger,
  REACH_RESIDUAL_INVISIBLE,
} from "./ledger";
import type { ExportLedgerRecord } from "./ledger";
import { COMMON_COMPETENCE_LINES, COMPETENCE_HEADING } from "../competence";
import { sigScopeBlockText, SIG_SENSOR_ID } from "../sig";
import type { SigResult } from "../sig";
import {
  engScopeBlockText,
  ENG_SENSOR_ID,
  CEILING_NOT_PERFORMED_NOTE,
} from "../eng";
import type { EngResult } from "../eng";

// ── The delivery outcome — a typed absence, never a silent skip ───────────────
//
// D6 forbids constants in sensor code, and a default output path is a constant:
// it is a deployment decision about where evidence lands, made by the wrong
// party. So the location is INJECTED and there is no fallback.
//
// The consequence has to be handled honestly. An export that quietly does
// nothing when no path was given is a silent skip, and a silent skip is exactly
// the failure mode the whole verdict vocabulary exists to prevent — it converts
// "nobody was told" into something indistinguishable from "there was nothing to
// tell". So absence is TYPED and travels with the reading.

export type ExportOutcome =
  | {
      readonly kind: "WRITTEN";
      readonly path: string;
      readonly bytes: number;
    }
  | {
      readonly kind: "NOT_ATTEMPTED_NO_LOCATION";
      readonly detail: string;
    }
  | {
      readonly kind: "WRITE_FAILED";
      readonly path: string;
      readonly detail: string;
    };

/** Where the artifact goes. Injected by the caller; never defaulted here. */
export interface ExportTarget {
  /**
   * Absolute or relative filesystem path for the artifact. REQUIRED for a
   * write to happen. Absent -> ExportOutcome is NOT_ATTEMPTED_NO_LOCATION and
   * the reading carries that absence.
   */
  readonly path?: string;
  /**
   * The append-only ledger that records what was written, so a later verify
   * pass can tell whether the artifact is still there and still says what it
   * said. INJECTED like everything else; absent means no record is kept and
   * the delivered reading says so.
   *
   * Absence does NOT narrow the verdict: the artifact genuinely was delivered.
   * What is lost is the ability to notice later that it stopped being there.
   */
  readonly ledger?: ExportLedger;
}

export const NO_LOCATION_DETAIL =
  "NO EXPORT LOCATION WAS INJECTED, so no artifact was written and NO PARTY " +
  "OUTSIDE THIS PROCESS WAS TOLD ANYTHING. This is a typed absence, not a " +
  "completed export and not a skipped one: the reading below was produced and " +
  "then went nowhere. There is deliberately no default path — where evidence " +
  "lands is a deployment decision, and a default would be this code making it.";

/** A sensor reading plus the record of what happened to it on the way out. */
export interface DeliveredReading<R> {
  /**
   * The sensor's own result, untouched. `result.verdict` is the READING
   * verdict — what the instrument saw. It is NOT the verdict to report.
   */
  readonly result: R;
  /**
   * THE VERDICT AS DELIVERED, and the one a consumer must use. Equal to the
   * reading verdict when delivery succeeded; narrowed per the asymmetry below
   * when it did not.
   */
  readonly verdict: SensorVerdict;
  /** True when delivery failure changed the verdict. */
  readonly narrowed: boolean;
  /** The exact text written, or that would have been written. */
  readonly artifact: string;
  /** What became of it. Never silently absent. */
  readonly delivery: ExportOutcome;
  /**
   * The ledger record written for this export, when a ledger was injected and
   * the artifact was actually written. Null otherwise — and null is reported,
   * never treated as a record that exists.
   */
  readonly ledgerRecord: ExportLedgerRecord | null;
  /**
   * Whether that ledger record DURABLY persisted (F7). "The artifact was written"
   * and "the REACH record persisted" are two different facts: an artifact can land
   * on disk while its ledger append fails, leaving nothing to detect a later
   * deletion. Null when no ledger was injected (nothing was recorded); true/false
   * when one was. A caller relying on later REACH verification must read this, not
   * assume a written artifact implies a persisted record.
   */
  readonly ledgerPersisted: boolean | null;
}

// ── THE ASYMMETRY ─────────────────────────────────────────────────────────────
//
// A delivery failure must NOT degrade the three verdicts the same way. Building
// this symmetrically is the natural instinct and it is wrong in the one
// direction this architecture never permits.
//
//   SILENT + failed delivery  ->  CANNOT_ASSESS
//       A silence nobody received is not evidence of anything. Quiet that never
//       arrived cannot be read as quiet-and-fine. Silence is not health, and
//       undelivered silence is not even silence.
//
//   ALARM + failed delivery   ->  ALARM, unchanged
//       DOWNGRADING AN ALARM BECAUSE IT FAILED TO DELIVER IS FAILING TOWARD
//       QUIET. The alarm is the thing most worth preserving when the channel
//       breaks. It is never softened, never converted, and never absorbed into
//       a delivery note.
//
//   CANNOT_ASSESS + failed delivery -> CANNOT_ASSESS, with the delivery failure
//       added to its reasons. Already at the floor for this purpose.
//
// THE RULE UNDERNEATH, IN ONE LINE: degradation runs toward the alarm, never
// away from it. A design where a broken channel quiets an alarm is the false
// all-clear wearing an engineering label.
//
// ── AND THE PULL IS FINAL ─────────────────────────────────────────────────────
//
// Once a run has been narrowed, nothing re-raises it. This function is the only
// producer of a delivered verdict, it is pure, and it has no inverse: there is
// no argument that turns a narrowed CANNOT_ASSESS back into SILENT. If the
// artifact is later restored, that is a NEW run producing a NEW verdict — never
// a retroactive repair of this one, which really did fail to arrive.

function notDeliveredBlindPath(delivery: ExportOutcome): BlindPath {
  const why =
    delivery.kind === "NOT_ATTEMPTED_NO_LOCATION"
      ? "no export location was injected, so the reading was never written anywhere"
      : delivery.kind === "WRITE_FAILED"
        ? `the write to ${delivery.path} failed (${delivery.detail})`
        : "the reading was not delivered";
  return {
    class: "NOT_DELIVERED",
    detail:
      `${why}. THE INSTRUMENT READ ITS SCOPE PERFECTLY WELL AND THE READING ` +
      `REACHED NO ONE. This is not a failure to read and must not be recorded ` +
      `as one — the record was legible, the finding was produced, and then it ` +
      `went nowhere. A reading no party outside the loop can obtain is, to that ` +
      `party, indistinguishable from a reading that was never taken.`,
  };
}

/**
 * Apply the asymmetry. The ONLY producer of a delivered verdict.
 *
 * Exported so the rule can be tested directly and read by a reviewer without
 * going through the filesystem.
 */
export function narrowForDelivery(
  reading: SensorVerdict,
  delivery: ExportOutcome
): SensorVerdict {
  if (delivery.kind === "WRITTEN") return reading;

  const blind = notDeliveredBlindPath(delivery);

  // ALARM: unchanged. There is deliberately no branch below this line that can
  // produce anything quieter than what the instrument read.
  if (reading.kind === "ALARM") return reading;

  if (reading.kind === "CANNOT_ASSESS") {
    return {
      ...reading,
      blindPaths: [...reading.blindPaths, blind],
      summary:
        `${reading.summary} ADDITIONALLY, THIS READING WAS NOT DELIVERED: ` +
        `${blind.detail}`,
    };
  }

  // SILENT -> CANNOT_ASSESS.
  const narrowed = cannotAssess(reading.sensorId, [blind]);
  return {
    ...narrowed,
    summary:
      `THIS RUN'S VERDICT WAS NARROWED BY A DELIVERY FAILURE. The instrument ` +
      `read its scope and found nothing that lowers the bound — and that ` +
      `finding of nothing REACHED NO PARTY OUTSIDE THE OBSERVED LOOP. A ` +
      `silence nobody received is not evidence of anything, so this is ` +
      `reported as CANNOT_ASSESS rather than as SILENT. It is NOT a claim that ` +
      `the scope could not be read; it was read. ${SILENCE_IS_NOT_HEALTH} ` +
      `The reading verdict, before narrowing, was: ${reading.summary}`,
  };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const RULE = "=".repeat(80);
const THIN = "-".repeat(80);

/**
 * Per-kind banner. The three are deliberately different at a glance — different
 * border characters, different headline, different explanatory line — so that
 * CANNOT_ASSESS cannot be mistaken for SILENT by a reader skimming, and so a
 * naive grep for one does not match another.
 */
function banner(v: SensorVerdict): string[] {
  const kind = v.kind;
  // A CANNOT_ASSESS produced by delivery failure needs its OWN banner. The
  // ordinary one says "it could not look", and for a delivery-narrowed run
  // that is FALSE — the instrument looked, and looked successfully. Printing
  // the generic banner here would put a false sentence directly above a
  // summary that contradicts it, which is precisely the kind of thing an
  // outside reader has no way to resolve.
  if (kind === "CANNOT_ASSESS") {
    const classes = v.blindPaths.map((b) => b.class);
    const undelivered = classes.includes("NOT_DELIVERED");
    const alsoUnread = classes.some((c) => c !== "NOT_DELIVERED");
    if (undelivered) {
      const b = "#".repeat(80);
      const lines = [
        b,
        "###  RESULT: CANNOT_ASSESS — THE READING DID NOT REACH ANYONE",
        "###  ***THIS IS NOT SILENCE***, and it is not a failure to read either.",
      ];
      if (alsoUnread) {
        lines.push(
          "###  Part of this run's scope was not read, AND the reading that was",
          "###  produced was not delivered. Both are listed below."
        );
      } else {
        lines.push(
          "###  The instrument read its scope and found nothing that lowers the",
          "###  bound. That finding then reached no party outside the observed",
          "###  loop. A silence nobody received is not evidence of anything, so",
          "###  it is NOT reported as SILENT."
        );
      }
      lines.push(
        "###  Do not record this as a clean result. Nobody outside was told.",
        b
      );
      return lines;
    }
  }
  if (kind === "ALARM") {
    const b = "*".repeat(80);
    return [
      b,
      "***  RESULT: ALARM",
      "***  A FINDING WAS MADE. The instrument read a scope and something in it",
      "***  lowered the bound. The findings are listed below in full.",
      b,
    ];
  }
  if (kind === "SILENT") {
    const b = "-".repeat(80);
    return [
      b,
      "---  RESULT: SILENT",
      "---  THE SCOPE WAS READ AND NOTHING IN IT LOWERED THE BOUND.",
      "---  THIS IS NOT A STATEMENT OF HEALTH. It is the absence of one finding",
      "---  over one named scope, and nothing wider.",
      b,
    ];
  }
  const b = "#".repeat(80);
  return [
    b,
    "###  RESULT: CANNOT_ASSESS",
    "###  THE INSTRUMENT DID NOT READ THIS. ***THIS IS NOT SILENCE.***",
    "###  Silence would mean it looked and found nothing. This means it could",
    "###  not look. The scopes it could not read are named below, one by one.",
    "###  Do not record this as a clean result. It is an unread one.",
    b,
  ];
}

function header(sensorId: string, target: ExportTarget): string[] {
  const out: string[] = [];
  out.push(RULE);
  out.push(`MICA SENSOR RECORD — ${sensorId}`);
  out.push(RULE);
  out.push("");
  out.push("WHAT THIS FILE IS");
  out.push(
    "  A record written by an automated read-instrument. The instrument"
  );
  out.push(
    "  inspected an append-only, hash-chained evidence log kept by a running"
  );
  out.push(
    "  software system, and wrote down what it read, what it found, and what it"
  );
  out.push("  could not read. That is the whole of its job.");
  out.push("");
  out.push(
    "  It is plain text on purpose. Reading it requires no software from the"
  );
  out.push(
    "  system that produced it, no type definitions, no build step and no"
  );
  out.push("  account. Opening the file is the whole procedure.");
  out.push("");
  out.push(
    "  The instrument is ALARM-ONLY. It can report a problem or report nothing."
  );
  out.push(
    "  IT CANNOT REPORT THAT THE SYSTEM IS WELL, and no reading below should be"
  );
  out.push("  converted into that claim.");
  out.push("");
  out.push("WHAT THIS FILE IS NOT — read this before relying on anything below");
  out.push(
    "  IT IS NOT INDEPENDENT EVIDENCE. This file was written by the very system"
  );
  out.push(
    "  whose behaviour is in question, by its own code, in its own process, to"
  );
  out.push(
    "  a location it can itself read, rewrite or delete. Every field it reports"
  );
  out.push(
    "  is a field that system authored. A survey of this codebase found 37"
  );
  out.push(
    "  typed fields on the record and NOT ONE the observed system cannot"
  );
  out.push("  determine.");
  out.push("");
  out.push(
    "  So: a system motivated to look good can produce a perfectly legible file"
  );
  out.push(
    "  that says exactly what it wants said. Legibility to an outside reader is"
  );
  out.push(
    "  NOT independence from the writer. This file buys the first. It does not"
  );
  out.push("  buy the second, and it does not claim to.");
  out.push("");
  out.push(
    "  What it genuinely buys: a finding that existed and could not be read"
  );
  out.push(
    "  without the system's own tooling can now be read without it. That is"
  );
  out.push("  worth having. It is not a defence.");
  out.push("");
  out.push("THE THREE POSSIBLE RESULTS, AND WHY THERE ARE THREE");
  out.push(
    "  ALARM          the instrument read a scope and found something in it"
  );
  out.push("                 that lowers confidence.");
  out.push(
    "  SILENT         the instrument read a scope and found no such thing."
  );
  out.push(
    "  CANNOT_ASSESS  the instrument did NOT read the scope — missing"
  );
  out.push(
    "                 configuration, an unreadable log, or a scope with nothing"
  );
  out.push("                 in it to read.");
  out.push("");
  out.push(
    "  THE THIRD IS THE ONE THAT GETS MISREAD. CANNOT_ASSESS is not a mild"
  );
  out.push(
    "  SILENT and not a soft pass. Collapsing the two turns 'we never looked'"
  );
  out.push(
    "  into 'we looked and it was fine', which is the single misreading this"
  );
  out.push("  vocabulary exists to prevent. They are kept apart everywhere: in the");
  out.push("  banner below, in this file's structure, and in the instrument's code.");
  out.push("");
  for (const line of wrap(SILENCE_IS_NOT_HEALTH, 76)) out.push(`  ${line}`);
  out.push("");
  out.push("THIS FILE'S DECLARED LOCATION");
  out.push(
    target.path === undefined
      ? "  (none — no location was injected; see DELIVERY at the end of this file)"
      : `  ${target.path}`
  );
  return out;
}

function verdictSection(v: SensorVerdict): string[] {
  const out: string[] = [];
  out.push("");
  out.push(...banner(v));
  out.push("");
  out.push("SENSOR");
  out.push(`  ${v.sensorId}`);
  out.push("");
  out.push("WHAT THE INSTRUMENT SAID, IN ITS OWN WORDS");
  for (const line of wrap(v.summary, 76)) out.push(`  ${line}`);
  out.push("");

  // FINDINGS — always present as a section, even when empty. An absent section
  // would let a reader infer the shape of the result from what is missing;
  // every run carries every section.
  out.push(THIN);
  out.push("FINDINGS — things read that lower the bound");
  out.push(THIN);
  if (v.kind === "ALARM") {
    let n = 0;
    for (const f of v.findings) {
      n++;
      out.push("");
      out.push(`  FINDING ${n} of ${v.findings.length}   code: ${f.code}`);
      for (const line of wrap(f.detail, 72)) out.push(`      ${line}`);
    }
    out.push("");
    out.push(
      "  SEVERITY: none. This instrument has no graded severity ramp — a finding"
    );
    out.push(
      "  is a finding. Ranking them is a calibration decision it does not make."
    );
  } else {
    out.push("");
    out.push("  (none — no finding was made on this run)");
    out.push("");
    if (v.kind === "SILENT") {
      out.push(
        "  The scope named above was read and nothing in it lowered the bound."
      );
      out.push(
        "  This is an absence of finding. It is NOT a statement of health, and"
      );
      out.push("  this instrument is incapable of making one.");
    } else {
      const onlyUndelivered =
        v.blindPaths.length > 0 &&
        v.blindPaths.every((b) => b.class === "NOT_DELIVERED");
      if (onlyUndelivered) {
        out.push(
          "  The scope WAS read and nothing in it lowered the bound. What failed"
        );
        out.push(
          "  was delivery, not reading — see DELIVERY FAILURES below. Because"
        );
        out.push(
          "  that finding reached nobody outside the loop, it is not reported as"
        );
        out.push("  SILENT.");
      } else {
        out.push(
          "  No finding was made BECAUSE THE SCOPE WAS NOT READ — not because it"
        );
        out.push(
          "  was read and came back clean. See the sections immediately below."
        );
      }
    }
  }
  out.push("");

  // The two kinds of blindness are DIFFERENT OBJECTS and get different
  // sections. "Could not read the record" and "read it fine, told nobody" are
  // not variants of one thing, and listing them together under one heading
  // would make the heading false for whichever entry it did not describe.
  // Both sections are always present, empty or not.
  const unread =
    v.kind === "CANNOT_ASSESS"
      ? v.blindPaths.filter((b) => b.class !== "NOT_DELIVERED")
      : [];
  const undelivered =
    v.kind === "CANNOT_ASSESS"
      ? v.blindPaths.filter((b) => b.class === "NOT_DELIVERED")
      : [];

  out.push(THIN);
  out.push("SCOPES THE INSTRUMENT COULD NOT READ");
  out.push(THIN);
  if (unread.length > 0) {
    let n = 0;
    for (const b of unread) {
      n++;
      out.push("");
      out.push(`  UNREAD SCOPE ${n} of ${unread.length}   class: ${b.class}`);
      for (const line of wrap(b.detail, 72)) out.push(`      ${line}`);
    }
    out.push("");
    out.push(
      "  Each of the above is a scope this run did NOT cover. Nothing is claimed"
    );
    out.push("  about any of them, in either direction.");
  } else {
    out.push("");
    out.push("  (none — every scope this run attempted was read)");
  }
  out.push("");

  out.push(THIN);
  out.push("DELIVERY FAILURES — readings that reached nobody");
  out.push(THIN);
  if (undelivered.length > 0) {
    let n = 0;
    for (const b of undelivered) {
      n++;
      out.push("");
      out.push(`  NOT DELIVERED ${n} of ${undelivered.length}`);
      for (const line of wrap(b.detail, 72)) out.push(`      ${line}`);
    }
    out.push("");
    out.push(
      "  A reading no party outside the loop can obtain is, to that party, the"
    );
    out.push(
      "  same as a reading never taken. That is why this run is CANNOT_ASSESS"
    );
    out.push("  and not SILENT.");
  } else {
    out.push("");
    out.push("  (none — this reading was delivered)");
  }
  return out;
}

/** Simple word wrap. Long unbroken tokens are left intact rather than cut. */
function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (current.length === 0) current = w;
    else if (current.length + 1 + w.length <= width) current += ` ${w}`;
    else {
      lines.push(current);
      current = w;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function num(x: number): string {
  return Number.isFinite(x) ? x.toFixed(6) : String(x);
}

function deliverySection(
  outcome: ExportOutcome,
  narrowed: boolean,
  ledgerKept: boolean
): string[] {
  const out: string[] = [];
  out.push("");
  out.push(THIN);
  out.push("DELIVERY — what became of this record");
  out.push(THIN);
  out.push("");
  if (outcome.kind === "WRITTEN") {
    out.push(`  WRITTEN to ${outcome.path}`);
    out.push("");
    out.push(
      "  This file's own length is deliberately not printed here. A file cannot"
    );
    out.push(
      "  state its own byte count without changing it, so the count is kept in"
    );
    out.push(
      "  the export ledger instead, where it can be compared against the file"
    );
    out.push("  later without this paradox.");
    out.push("");
    out.push(
      "  Written by the observed system, to a location the observed system can"
    );
    out.push(
      "  reach. Delivery is not custody: nothing here prevents that system from"
    );
    out.push("  rewriting or removing this file afterwards.");
    out.push("");
    if (ledgerKept) {
      out.push(
        "  A record of this artifact — its path, its length and a digest of its"
      );
      out.push(
        "  contents — was appended to a hash-chained export ledger. If this file"
      );
      out.push(
        "  is later removed, truncated or altered, a verify pass over that ledger"
      );
      out.push(
        "  will no longer find it as recorded, and the claim that an outside"
      );
      out.push(
        "  party can read this finding narrows to CANNOT_ASSESS at that point."
      );
      out.push(
        "  THAT DETECTS A CHANGE. IT PREVENTS NOTHING, and it says nothing about"
      );
      out.push("  who changed it or why.");
    } else {
      out.push(
        "  NO EXPORT LEDGER WAS INJECTED, so no record of this artifact was kept."
      );
      out.push(
        "  The file was delivered — that part is not in doubt — but if it is"
      );
      out.push(
        "  later removed or altered, NOTHING WILL DETECT THAT. There is no"
      );
      out.push("  record to compare it against.");
    }
  } else if (outcome.kind === "NOT_ATTEMPTED_NO_LOCATION") {
    for (const line of wrap(outcome.detail, 76)) out.push(`  ${line}`);
  } else {
    out.push(`  WRITE FAILED for ${outcome.path}`);
    for (const line of wrap(outcome.detail, 76)) out.push(`  ${line}`);
    out.push("");
    out.push(
      "  The reading was produced and could not be delivered. This is a failure"
    );
    out.push("  to deliver, and it is recorded as one rather than swallowed.");
  }

  if (narrowed) {
    out.push("");
    out.push("  ⚠ THIS RUN'S VERDICT WAS NARROWED BECAUSE OF THE ABOVE.");
    out.push(
      "    The instrument read its scope and found nothing that lowers the"
    );
    out.push(
      "    bound. Because that finding reached no party outside the observed"
    );
    out.push(
      "    loop, it is reported as CANNOT_ASSESS and not as SILENT. A silence"
    );
    out.push("    nobody received is not evidence of anything.");
    out.push("");
    out.push(
      "    AND THE NARROWING IS FINAL. If the artifact is later restored, that"
    );
    out.push(
      "    is a new run producing a new verdict. It does not repair this one,"
    );
    out.push("    which really did fail to arrive.");
  }

  out.push("");
  for (const line of REACH_RESIDUAL_INVISIBLE) out.push(`  ${line}`);
  return out;
}

function commonCompetenceSection(): string[] {
  const out: string[] = [];
  out.push("");
  out.push(THIN);
  out.push(`${COMPETENCE_HEADING} — COMMON TO EVERY MICA SENSOR`);
  out.push(THIN);
  out.push("");
  out.push(
    "  Stated, never tested. Nothing in this instrument checks, scores or gates"
  );
  out.push(
    "  on any of the below, and nothing is withheld from a reader who lacks it."
  );
  out.push(
    "  Certifying a reader belongs to the deployer or a governing body and not"
  );
  out.push("  to this code. The list exists so a reader can judge for themselves.");
  out.push("");
  for (const line of COMMON_COMPETENCE_LINES) out.push(`  ${line}`);
  return out;
}

function scopeSection(scopeText: string): string[] {
  const out: string[] = [];
  out.push("");
  out.push(THIN);
  out.push("THE INSTRUMENT'S FULL DECLARED SCOPE");
  out.push(THIN);
  out.push("");
  out.push(
    "  Reproduced verbatim from the instrument itself, including what it"
  );
  out.push(
    "  refuses to look at and what it presumes of you. The list of things it"
  );
  out.push("  DOES NOT SEE is the more useful half.");
  out.push("");
  out.push(scopeText);
  return out;
}

function footer(): string[] {
  return [
    "",
    RULE,
    "END OF RECORD",
    "  No wall-clock generation time is stamped here. The observed system"
    + " determines",
    "  its own clock, so a self-authored timestamp would add a field that party",
    "  controls while looking like corroboration. The evidence log's own"
    + " sequence",
    "  numbers, quoted throughout, are what locate these readings.",
    RULE,
  ];
}

// ── Sig ───────────────────────────────────────────────────────────────────────

function sigSections(result: SigResult): string[] {
  const out: string[] = [];
  out.push("");
  out.push(THIN);
  out.push("PER-FLAG DETAIL — what each check did, separately");
  out.push(THIN);
  out.push("");
  out.push(
    "  This sensor runs three checks. EACH ONE REPORTS ITS OWN RESULT"
  );
  out.push(
    "  OVER ITS OWN SCOPE, and they can differ: one may find something while"
  );
  out.push(
    "  the other reads nothing at all. The overall result above is composed"
  );
  out.push("  from these, and this table is where you see which was which.");
  out.push("");
  if (result.flags.length === 0) {
    out.push(
      "  (no check ran at all — the evidence log itself was not readable, so"
    );
    out.push(
      "  the sensor stopped before either check. See SCOPES THE INSTRUMENT"
    );
    out.push("  COULD NOT READ, above.)");
    return out;
  }
  for (const f of result.flags) {
    out.push(`  ${f.flag} — ${f.name}`);
    out.push(`      result:      ${f.kind}`);
    out.push(
      `      scope size:  ${f.scopeSize} record(s) fell inside this check's scope`
    );
    if (f.kind === "CANNOT_ASSESS") {
      out.push(
        `      NOT READ. This check covered nothing on this run, and this LOWERS`
      );
      out.push(
        `      THE BOUND — a configured leg that could not read composes into the`
      );
      out.push(`      verdict (F5). Reason(s):`);
      for (const b of f.blindPaths) {
        for (const line of wrap(`${b.class}: ${b.detail}`, 66)) {
          out.push(`          ${line}`);
        }
      }
    } else if (f.kind === "NOT_CONFIGURED") {
      out.push(
        `      NOT CONFIGURED. No source was injected for this leg, so it is`
      );
      out.push(
        `      dormant. It is disclosed here and DOES NOT lower the verdict bound`
      );
      out.push(
        `      — an unconfigured leg is a distinct non-verdict status, not a blind`
      );
      out.push(`      CANNOT_ASSESS (F5 honest split). Detail(s):`);
      for (const b of f.blindPaths) {
        for (const line of wrap(`${b.class}: ${b.detail}`, 66)) {
          out.push(`          ${line}`);
        }
      }
    } else if (f.kind === "SILENT") {
      out.push(
        `      Read its scope; found nothing that lowers the bound. Not health.`
      );
    } else {
      out.push(`      findings:    ${f.findings.length} (listed in full above)`);
    }
    // RECORDS HANDED TO THIS CHECK THAT FALL OUTSIDE ITS SUBJECT — counted here
    // so an outside reader can see them, and deliberately NOT in the blind-path
    // list above, because they are not unread evidence and must not be charged
    // to the verdict. The console has this on the FlagReport; the reader of this
    // artifact has no console, which is the whole reason it is printed.
    for (const n of f.outOfScope ?? []) {
      out.push(
        `      OUT OF SCOPE: ${n.count} record(s) — ${n.class}. Counted, not charged.`
      );
      for (const line of wrap(n.detail, 66)) {
        out.push(`          ${line}`);
      }
    }
    out.push("");
  }

  // WHAT F2 WAS TOLD TO CHECK — the injected precondition map, printed so a
  // clean F2 SILENT cannot hide what it did or did not check. This is the same
  // "visible, not free" discipline the load-state gate follows: the map is a
  // deployment fact this instrument holds none of and defaults to none of, and
  // WHICH preconditions a run checked is exactly the half a reader needs.
  out.push("  WHAT F2 WAS TOLD TO CHECK — the injected precondition map");
  if (result.preconditionMap === null) {
    out.push(
      "      (none injected — F2 is DORMANT this run: it reads CANNOT_ASSESS,"
    );
    out.push(
      "      never SILENT, and no precondition was checked. Which eventType"
    );
    out.push(
      "      requires which prior event is a deployment fact this instrument"
    );
    out.push("      holds no map of, and it does not infer one.)");
  } else {
    const keys = Object.keys(result.preconditionMap).sort();
    out.push(
      `      ${keys.length} governed eventType(s), INJECTED by the deployer,`
    );
    out.push(
      "      derived from nothing and defaulted to nothing. Each names the prior"
    );
    out.push("      events ANY ONE of which makes its state reachable:");
    for (const k of keys) {
      const priors = [...result.preconditionMap[k]].join(", ");
      out.push(`          ${k}  <-  any one prior of [${priors}]`);
    }
  }
  out.push("");

  // WHAT F2 WAS TOLD TO EXCLUDE — the injected re-entry (mutual-exclusion) map.
  // This is where "the re-entry scope was not checked" is disclosed when no map
  // was injected: kept OUT of the verdict (frozen), printed here instead, so a
  // clean verdict never silently implies re-entry was assessed when it was not.
  out.push("  WHAT F2 WAS TOLD TO EXCLUDE — the injected re-entry map");
  if (result.reentryMap === null) {
    out.push(
      "      (none injected — the RE-ENTRY scope was NOT CHECKED this run. A"
    );
    out.push(
      "      state entered while already active would not be flagged. This is"
    );
    out.push(
      "      disclosed HERE rather than in the verdict, which is unchanged by the"
    );
    out.push("      absence — only a re-entry VIOLATION lowers the bound.)");
  } else {
    const keys = Object.keys(result.reentryMap).sort();
    out.push(
      `      ${keys.length} governed enter event(s), INJECTED by the deployer.`
    );
    out.push(
      "      Each ALARMs if it re-enters its state while already active — a prior"
    );
    out.push("      enter with no intervening clear from the listed clear events:");
    for (const k of keys) {
      const clears = [...result.reentryMap[k]].join(", ");
      out.push(`          ${k}  cleared by any of [${clears}]`);
    }
  }
  out.push("");

  out.push("  WHAT F3 WAS GIVEN — the injected Clerk 1 receipt-order source");
  if (result.clerkClockSource === null) {
    out.push(
      "      (none injected — F3's independent clock scope was NOT CHECKED."
    );
    out.push(
      "      F3 reports CANNOT_ASSESS on the result while leaving the pre-F3"
    );
    out.push(
      "      frozen verdict untouched; only an F3 violation lowers the bound.)"
    );
  } else {
    const modes = [...new Set(
      result.clerkClockSource.map((s) => `${s.separation}/${s.intake}`)
    )].sort();
    out.push(
      `      ${result.clerkClockSource.length} stamp(s), mode(s): [${modes.join(", ")}].`
    );
    out.push(
      "      F3 binds arrival/order only, never payload truth. Its independent"
    );
    out.push(
      "      axis is warranted only under genuine OS-principal separation; this"
    );
    out.push("      instrument reads that precondition and does not perform it.");
  }
  out.push("");

  // ── T5 · WHAT F3 ACTUALLY COVERED, PRINTED ──────────────────────────────────
  //
  // T3 put `clerkStampCoverage` and `f3Deviation` on `SigResult` and stopped
  // there, because T3's ticket did not open this file. The cold verifier's §5.1
  // named the consequence in one sentence: a caller holding the in-process
  // result can see the new evidence and AN OUTSIDE READER CANNOT. This artifact
  // is the outside reader's only copy, so a disclosure that does not reach it
  // is not a disclosure. T5 closes exactly that gap and nothing wider.
  //
  // PRINTED ONLY WHEN A SOURCE WAS INJECTED. A NOT_CONFIGURED leg gets no
  // coverage block at all: a zeroed one would read as "nothing was missing"
  // over a scope nobody looked at, which is the same fail-open the tail/hole
  // split exists to prevent. The "(none injected)" branch above already says
  // the true thing about that run.
  if (result.clerkClockSource !== null) {
    out.push("  WHAT F3 ACTUALLY COVERED — the join, and what it did not reach");
    const c = result.clerkStampCoverage;
    if (c === null) {
      out.push(
        "      (no coverage was computed — F3 REFUSED this source before it"
      );
      out.push(
        "      joined anything to the log. The reason is in the per-flag detail"
      );
      out.push(
        "      above. There is no tail, hole or lag reading to print here, and a"
      );
      out.push(
        "      zeroed one would claim a measurement that was never taken.)"
      );
    } else {
      out.push(
        `      STAMPED:  ${c.stampedCount} record(s) joined a stamp and were read.`
      );
      out.push(
        `      TAIL:     ${c.tailCount} record(s) sit ABOVE their own writer's stamped`
      );
      out.push(
        "                high-water mark with no stamp. The carrier has NOT"
      );
      out.push(
        "                REACHED them. Disclosed here, counted, and NOT charged"
      );
      out.push("                to the verdict — a lag is not a skip.");
      if (c.unreachedWriters.length === 0) {
        out.push("      WRITERS NEVER REACHED: none.");
      } else {
        out.push(
          `      WRITERS NEVER REACHED: [${c.unreachedWriters.join(", ")}]`
        );
        out.push(
          "                NOT ONE record of theirs carries a stamp, so no"
        );
        out.push(
          "                high-water mark exists for them and F3 CANNOT TELL"
        );
        out.push(
          '                "the carrier has never visited this writer" from "the'
        );
        out.push(
          '                carrier has not caught up with it". They are counted'
        );
        out.push(
          "                in the TAIL above. This is the leg's ceiling, printed."
        );
      }
      out.push(
        `      HOLE:     ${c.holeCount} record(s) sit BELOW their own writer's mark with`
      );
      out.push(
        "                no stamp. The carrier reached PAST them and did not"
      );
      out.push(
        "                stamp them. That is a SKIP, it is evidence, and it"
      );
      out.push("                composes CANNOT_ASSESS.");
      if (c.holeSequenceNumbers.length > 0) {
        out.push(
          `                local sequenceNumber(s): [${c.holeSequenceNumbers.join(", ")}]`
        );
      }
      // LAG. FALSE on `lagBoundEvaluated` is a finding, not a blank: an absent
      // bound or an absent read-time means the tail is disclosed and NOT judged
      // stale, and the artifact must say WHICH of those it was.
      if (c.lagBoundEvaluated) {
        out.push(
          `      LAG:      the axis last spoke at clerk wall_ms ${c.newestStampedWallMs};`
        );
        out.push(
          `                read at ${c.readAtMs}; SILENT FOR ${c.axisSilentForMs} ms against a`
        );
        out.push(
          `                declared clerkStampLagBoundMs of ${c.lagBoundMs} ms —`
        );
        if (c.axisStale) {
          out.push(
            "                BEYOND THE BOUND. The carrier has stopped speaking"
          );
          out.push(
            "                for longer than this deployment declared it may, so"
          );
          out.push(
            "                the tail is no longer a lag F3 can wait out"
          );
          out.push("                (AXIS_STALE, in the per-flag detail above).");
        } else {
          out.push("                WITHIN THE BOUND.");
        }
        out.push(
          "                Measured from the NEWEST STAMPED record's clerk time,"
        );
        out.push(
          "                never from the tail's own declared timestamps — those"
        );
        out.push("                are the axis under suspicion.");
      } else {
        const why =
          c.tailCount === 0
            ? "nothing is unstamped, so there is no staleness question to ask"
            : c.lagBoundMs === null
              ? "no clerkStampLagBoundMs was declared by this deployment"
              : c.readAtMs === null
                ? "no readAtMs was injected, and this instrument reads no clock"
                : "no stamp joined, so the axis has no time to be measured from";
        out.push("      LAG:      NOT EVALUATED this run —");
        for (const line of wrap(`${why}.`, 54)) {
          out.push(`                ${line}`);
        }
        out.push(
          "                FALSE HERE IS A FINDING, NOT A BLANK: the tail is"
        );
        out.push(
          "                disclosed and NOT judged stale. A bound that cannot"
        );
        out.push("                be read must not manufacture a hold.");
        out.push(
          `                declared bound: ${c.lagBoundMs === null ? "none declared" : `${c.lagBoundMs} ms`};`
            + ` read-time: ${c.readAtMs === null ? "none injected" : c.readAtMs};`
        );
        out.push(
          `                newest stamped clerk wall_ms: ${c.newestStampedWallMs === null ? "none — nothing joined" : c.newestStampedWallMs}.`
        );
      }
      out.push("      CHAIN ATTRIBUTION:");
      out.push(
        `                ${c.unattributedStampCount} stamp(s) carry NO chainIdentity at all —`
      );
      out.push(
        "                today's behaviour, disclosed, never refused for it."
      );
      out.push(
        `                ${c.unverifiedAttributionCount} stamp(s) carry one while nothing was injected`
      );
      out.push(
        "                to check it against — joined, and NOT promoted to"
      );
      out.push(
        "                checked. An unchecked claim is not a checked one."
      );
      out.push(
        `                ${c.refusedChainStampCount} stamp(s) were REFUSED for naming another chain`
      );
      if (c.refusedChainIdentities.length > 0) {
        out.push(
          `                [${c.refusedChainIdentities.join(", ")}]. Sequence numbers restart at`
        );
        out.push(
          "                chain rotation, so joining them would report a real"
        );
        out.push(
          "                clerk receipt against the WRONG record — a confident"
        );
        out.push("                wrong answer, which is worse than a refusal.");
      } else {
        out.push("                — none this run.");
      }
      out.push(
        `      UNJOINABLE: ${c.unjoinableStampCount} stamp(s) name a local sequenceNumber this log`
      );
      out.push(
        "                does not hold. Counted, never charged: a stamp for a"
      );
      out.push(
        "                record F3 was not handed is not evidence about this log."
      );
    }
    out.push("");

    // THE MARGIN, as the number that was computed and not as the prose that
    // quoted it. Recovering a number by parsing a reader's English is the move
    // this codebase refuses everywhere else.
    out.push("  F3's ORDER DEVIATION — the margin, as a number and not as prose");
    const dv = result.f3Deviation;
    if (dv === null) {
      out.push(
        "      (not computed — F3 never got as far as comparing a pair in clerk"
      );
      out.push(
        "      receipt order this run. No margin exists to print, and a printed"
      );
      out.push("      zero would read as a measured zero.)");
    } else {
      out.push(
        `      largest declared inversion: ${dv.maxDeclaredInversionMs} ms over ${dv.pairsCompared} adjacent`
      );
      out.push(
        "                pair(s) in clerk receipt order. SIGNED: NEGATIVE means"
      );
      out.push(
        "                declared time ran FORWARD with the clerk, which is the"
      );
      out.push("                clean direction.");
      out.push(
        `      tolerance it was measured against: ${dv.clockToleranceMs} ms — INJECTED`
      );
      out.push(
        "                by the deployer, never defaulted by this instrument."
      );
      out.push(
        `      MARGIN:   ${dv.distanceMs} ms. POSITIVE is the adverse side (over`
      );
      out.push(
        "                tolerance); NEGATIVE is headroom, and headroom is a"
      );
      out.push("                reading, not an absence of one.");
    }
    out.push("");
  }

  return out;
}

/**
 * @param verdict THE DELIVERED VERDICT — narrowed where delivery failed. It is
 * passed in rather than read off `result` so that no render path can reach
 * around the narrowing and print the pre-delivery reading as though it stood.
 * That is the mechanism behind "the pull is final".
 */
export function renderSigArtifact(
  result: SigResult,
  verdict: SensorVerdict,
  target: ExportTarget,
  delivery: ExportOutcome
): string {
  return [
    ...header(SIG_SENSOR_ID, target),
    ...verdictSection(verdict),
    ...sigSections(result),
    ...scopeSection(sigScopeBlockText(result.readableLoadStates ?? undefined)),
    ...commonCompetenceSection(),
    ...deliverySection(
      delivery,
      verdict.kind !== result.verdict.kind,
      target.ledger !== undefined
    ),
    ...footer(),
  ].join("\n");
}

// ── Eng ───────────────────────────────────────────────────────────────────────

function engSections(result: EngResult): string[] {
  const out: string[] = [];
  out.push("");
  out.push(THIN);
  out.push("THE STATISTIC — what was actually computed");
  out.push(THIN);
  out.push("");

  const s = result.structure;
  if (s === undefined) {
    out.push(
      "  (not computed — the sensor stopped before reaching the statistic,"
    );
    out.push(
      "  either because the evidence log was unreadable or because required"
    );
    out.push(
      "  configuration was not supplied. See SCOPES THE INSTRUMENT COULD NOT"
    );
    out.push("  READ, above.)");
  } else {
    out.push(
      "  The question: DOES THE RECORDED OUTCOME DEPEND ON WHAT KIND OF EVENT IT"
    );
    out.push(
      "  WAS? A system doing real work produces outcomes that vary with the"
    );
    out.push(
      "  event class. A system rubber-stamping produces outcomes that stop"
    );
    out.push("  depending on the input.");
    out.push("");
    out.push(
      `  ADJUSTED MUTUAL INFORMATION (the figure the result turns on): ${
        s.ami === null ? "not computable" : num(s.ami)
      }`
    );
    out.push("      0 means the outcomes carry no more information about event");
    out.push("        class than a random reshuffle of this same table would.");
    out.push("      1 means the outcome is fully determined by the event class —");
    out.push("        which is NOT a good score. See THE CEILING below.");
    out.push("");
    out.push("  Supporting figures, reported so the arithmetic can be checked:");
    out.push(
      `      plain mutual information            ${num(s.mutualInformation)}`
    );
    out.push(
      `        (reported for scrutiny; deliberately NOT the figure compared`
    );
    out.push(`         against the threshold — see the scope block below)`);
    out.push(
      `      expected under random reshuffling   ${num(s.expectedMutualInformation)}`
    );
    out.push(`      spread of the event classes         ${num(s.entropyClass)}`);
    out.push(`      spread of the outcomes              ${num(s.entropyOutcome)}`);
    out.push(`      records read                        ${s.sampleSize}`);
    out.push(`      distinct event classes              ${s.distinctClasses}`);
    out.push(`      distinct outcome values             ${s.distinctOutcomes}`);
    out.push(
      `      at least one class recurs           ${s.hasRepeatedClass ? "yes" : "no"}`
    );
    out.push("");

    out.push("  WHERE THIS OBSERVATION SITS AMONG RESHUFFLES OF ITSELF");
    if (s.permutation === null) {
      for (const line of wrap(s.permutationNote, 72)) out.push(`      ${line}`);
    } else {
      const p = s.permutation;
      out.push(
        `      of ${p.samples} reshuffles at injected seed ${p.seed}, the observed`
      );
      out.push(
        `      figure is strictly above ${(p.percentileBelow * 100).toFixed(1)}% of them,`
      );
      out.push(
        `      and at or above ${(p.percentileAtOrBelow * 100).toFixed(1)}% of them.`
      );
      out.push(
        `      mean across reshuffles ${num(p.resampledMean)}, spread ${num(
          p.resampledStdDev
        )}`
      );
      out.push("");
      out.push(
        "      THIS IS NOT A SIGNIFICANCE TEST AND NOT A PROBABILITY THAT THE"
      );
      out.push(
        "      SYSTEM IS WELL. It locates one observation among reshuffles of"
      );
      out.push("      itself, and licenses nothing beyond that.");
      out.push("");
      for (const line of wrap(s.permutationNote, 72)) out.push(`      ${line}`);
    }
  }

  // ── The ceiling. Carried on EVERY run, not only the one whose summary
  //    happens to embed it.
  out.push("");
  out.push(THIN);
  out.push("THE CEILING — the check that a high score is not a good sign");
  out.push(THIN);
  out.push("");
  out.push(`  ceiling check: ${result.ceilingCheck}`);
  out.push("");
  if (result.ceilingCheck === "NOT_PERFORMED") {
    for (const line of wrap(CEILING_NOT_PERFORMED_NOTE, 74)) {
      out.push(`  ${line}`);
    }
    out.push("");
    out.push(
      "  Stated plainly for this run: THE ABOVE RESULT WAS NOT CHECKED FOR THAT"
    );
    out.push(
      "  CONDITION. Whatever it says, it does not say the reading is clear of"
    );
    out.push("  the ceiling.");
  } else {
    out.push(
      "  The check ran. A reading at or near the maximum is reported as"
    );
    out.push(
      "  CANNOT_ASSESS rather than as a good result, because a system that"
    );
    out.push(
      "  genuinely assesses every case and a lookup table that reads nothing"
    );
    out.push(
      "  and returns a canned value per class PRODUCE THE IDENTICAL RECORD."
    );
    out.push(
      "  The evidence that would separate them is not in this record at all."
    );
  }

  // ── A4 diagnostics.
  out.push("");
  out.push(THIN);
  out.push("BREAKDOWNS — REPORTED BUT NEVER ACTED ON");
  out.push(THIN);
  out.push("");
  out.push(
    "  ⚠ NO RESULT ABOVE DEPENDS ON ANYTHING IN THIS SECTION. No threshold, no"
  );
  out.push(
    "  alarm rule and no verdict is attached to these figures. They are here"
  );
  out.push(
    "  because the overall result is computed across the WHOLE log, and an"
  );
  out.push(
    "  aggregate can sit comfortably above its threshold while one part of the"
  );
  out.push(
    "  system has died completely. IF YOU DO NOT READ THIS SECTION, NOTHING"
  );
  out.push(
    "  ELSE IN THIS FILE WILL RAISE THAT. Whether such a pattern ought to raise"
  );
  out.push("  an alarm is a judgement this instrument does not make.");
  out.push("");

  const d = result.diagnostics;
  if (d === undefined) {
    out.push("  (not computed — no statistic was reached on this run)");
    return out;
  }

  out.push("  BY EVENT CLASS");
  out.push(
    "      'own contribution' near zero means that class's outcomes look just"
  );
  out.push(
    "      like everyone else's — it is not being differentiated from anything."
  );
  out.push(
    "      'without this class' is the overall figure recomputed with the class"
  );
  out.push(
    "      removed: a sharp RISE means it was dragging the aggregate down, a"
  );
  out.push("      sharp FALL means it was carrying it.");
  out.push("");
  if (d.perClass.length === 0) {
    out.push("      (none)");
  }
  for (const c of d.perClass) {
    out.push(`      ${c.eventClass}`);
    out.push(`          records:            ${c.count}`);
    out.push(`          own contribution:   ${num(c.divergenceFromPooled)}`);
    out.push(
      `          without this class: ${
        c.leaveOneOutAmi === null ? "not computable" : num(c.leaveOneOutAmi)
      }`
    );
  }
  out.push("");
  out.push("  OVER TIME");
  for (const line of wrap(d.windowNote, 72)) out.push(`      ${line}`);
  if (d.windows !== null) {
    out.push("");
    for (const w of d.windows) {
      out.push(
        `      window ${w.windowIndex}: records ${w.fromSequence}-${w.toSequence} ` +
          `(${w.size}) figure ${w.ami === null ? "not computable" : num(w.ami)}`
      );
      out.push(`          ${w.note}`);
    }
  }
  return out;
}

/** @param verdict the DELIVERED verdict — see renderSigArtifact. */
export function renderEngArtifact(
  result: EngResult,
  verdict: SensorVerdict,
  target: ExportTarget,
  delivery: ExportOutcome
): string {
  return [
    ...header(ENG_SENSOR_ID, target),
    ...verdictSection(verdict),
    ...engSections(result),
    ...scopeSection(engScopeBlockText(result.readableLoadStates ?? undefined)),
    ...commonCompetenceSection(),
    ...deliverySection(
      delivery,
      verdict.kind !== result.verdict.kind,
      target.ledger !== undefined
    ),
    ...footer(),
  ].join("\n");
}

// ── Writing ───────────────────────────────────────────────────────────────────

/**
 * Decide the delivery outcome, write if a location was injected, and record
 * what was written in the ledger.
 *
 * ── ON THE BYTE COUNT, AND A DEFECT THIS FIXES ────────────────────────────────
 *
 * The previous round rendered the artifact twice: once with a placeholder byte
 * count to measure it, then again with the measured count embedded. That is
 * self-referential and it was WRONG — embedding a five-digit count where a
 * one-digit placeholder stood makes the final file four bytes longer than the
 * number it reports. The error was harmless while nothing compared the two.
 *
 * It stops being harmless the moment a ledger records that count and a verify
 * pass compares it against the file on disk: every artifact would come back
 * SIZE_MISMATCH, and the detector would fire on its own arithmetic rather than
 * on anything that happened to the file.
 *
 * So the count is no longer printed inside the artifact at all. The text is
 * rendered once, and the digest and byte count are taken from exactly those
 * bytes — the ones written.
 */
function deliver(
  target: ExportTarget,
  sensorId: string,
  readingVerdict: SensorVerdict,
  render: (verdict: SensorVerdict, delivery: ExportOutcome) => string
): {
  artifact: string;
  delivery: ExportOutcome;
  verdict: SensorVerdict;
  ledgerRecord: ExportLedgerRecord | null;
  ledgerPersisted: boolean | null;
} {
  const path = target.path;

  const fail = (
    outcome: ExportOutcome
  ): {
    artifact: string;
    delivery: ExportOutcome;
    verdict: SensorVerdict;
    ledgerRecord: ExportLedgerRecord | null;
    ledgerPersisted: boolean | null;
  } => {
    const verdict = narrowForDelivery(readingVerdict, outcome);
    return {
      artifact: render(verdict, outcome),
      delivery: outcome,
      verdict,
      ledgerRecord: null,
      ledgerPersisted: null,
    };
  };

  if (typeof path !== "string" || path.length === 0) {
    return fail({
      kind: "NOT_ATTEMPTED_NO_LOCATION",
      detail: NO_LOCATION_DETAIL,
    });
  }

  // Delivery succeeds -> no narrowing -> the reading verdict stands. Render
  // once, and let the bytes written be the bytes measured and digested.
  const outcome: ExportOutcome = {
    kind: "WRITTEN",
    path,
    bytes: 0, // replaced below, once the real text exists
  };
  const artifact = render(readingVerdict, outcome);
  const bytes = Buffer.byteLength(artifact, "utf8");
  const written: ExportOutcome = { kind: "WRITTEN", path, bytes };

  try {
    // mkdirSync RULED in-bounds (S96-D): only the parent of the artifact this
    // call was told to write, and no deployment site calls deliverSigReading or
    // deliverEngReading — grep over src/ and tools/ returns tests only
    // (verified at bytes S97). No principal is entitled to a directory no
    // deployment names. Annotated S97: THE DAY A DEPLOYMENT NAMES AN EXPORT
    // DESTINATION FOR ANOTHER ROLE TO READ, this line is wrong-side, because
    // the whole point of an export is that somebody else opens it.
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, artifact, "utf8");
  } catch (err) {
    return fail({
      kind: "WRITE_FAILED",
      path,
      detail: `${(err as Error).message}`,
    });
  }

  // The record goes in AFTER the write, describing the bytes that actually
  // landed. A ledger entry for a file that failed to appear would be a claim
  // the disk does not support.
  let ledgerRecord: ExportLedgerRecord | null = null;
  let ledgerPersisted: boolean | null = null;
  if (target.ledger !== undefined) {
    // The artifact WAS written (above). Whether its REACH record then durably
    // persisted is a separate outcome, surfaced rather than assumed (F7): a
    // record kept only in memory, or lost to a failed append, cannot later detect
    // this artifact's deletion.
    const outcome = target.ledger.append({
      sensorId,
      verdictKind: readingVerdict.kind,
      path,
      digest: digestOf(artifact),
      bytes,
    });
    ledgerRecord = outcome.record;
    ledgerPersisted = outcome.persisted;
  }

  return {
    artifact,
    delivery: written,
    verdict: readingVerdict,
    ledgerRecord,
    ledgerPersisted,
  };
}

/**
 * Write Sig's full reading to the injected location.
 *
 * UNCONDITIONAL. Called on an ALARM, a SILENT and a CANNOT_ASSESS alike, and
 * writes a complete record in every case. There is no branch here that
 * suppresses an uninteresting run — that branch is what makes a channel
 * curated, and a curated channel fails T1 while appearing to satisfy it.
 */
export function deliverSigReading(
  result: SigResult,
  target: ExportTarget = {}
): DeliveredReading<SigResult> {
  const { artifact, delivery, verdict, ledgerRecord, ledgerPersisted } = deliver(
    target,
    SIG_SENSOR_ID,
    result.verdict,
    (v, d) => renderSigArtifact(result, v, target, d)
  );
  return {
    result,
    verdict,
    narrowed: verdict.kind !== result.verdict.kind,
    artifact,
    delivery,
    ledgerRecord,
    ledgerPersisted,
  };
}

/** Eng's equivalent. Same unconditional contract, same asymmetry. */
export function deliverEngReading(
  result: EngResult,
  target: ExportTarget = {}
): DeliveredReading<EngResult> {
  const { artifact, delivery, verdict, ledgerRecord, ledgerPersisted } = deliver(
    target,
    ENG_SENSOR_ID,
    result.verdict,
    (v, d) => renderEngArtifact(result, v, target, d)
  );
  return {
    result,
    verdict,
    narrowed: verdict.kind !== result.verdict.kind,
    artifact,
    delivery,
    ledgerRecord,
    ledgerPersisted,
  };
}
