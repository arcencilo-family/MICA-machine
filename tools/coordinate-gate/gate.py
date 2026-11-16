#!/usr/bin/env python3
"""THE SUBJECT-LOG COORDINATE GATE — Codex's grade-C repair, made executable.

WHAT IT IS FOR. On 2026-09-28 Act A rotated the subject log. `readers.nodeResponse.since = 211`
was a sequence number read off the RETIRED log; after the rotation it silently meant "skip the
first 211 records of the NEW chain". When the chain crossed 211 the window opened holding three
pairs -- exactly the declared flatness.minSample floor -- AMI over three points was 0, and op3
ALARMED. The box held seven times (route #10). Act A was reviewed four times and nobody asked
which declared numbers the rotation would invalidate.

WHY THIS IS A GATE AND NOT A CHECKLIST (Codex, ARC_MICA-VERIFY_Act-B-Stranded_20260928, §E):
a gate needs a CLOSED DOMAIN and an EXECUTABLE PASS CONDITION. My first proposal said "at least",
"probably", and "I do not know what else without going field by field". That is a discovery task.
So:

  1. EVERY declared field must appear in PROVENANCE below. An unclassified field FAILS the gate
     -- the domain is closed by construction, and a new declaration field cannot slip past it.
  2. Fields whose warrant is RECORD-DERIVED carry a rotation rule and must be DISCHARGED against
     the chain identity now in force. An undischarged rule FAILS.

THE BLOCKING CONDITION, in Codex's words: no declaration field with record-derived provenance may
retain an old log identity after rotation without its declared rotation rule passing.

PROVENANCE is not one thing, and conflating the kinds is what made the first proposal too broad:
  SCHEMA / WRITER_CODE / DEPLOYMENT  -- not about the record at all; rotation cannot invalidate.
  ABSOLUTE_POSITION                  -- a coordinate. A new origin makes it false. WITHDRAW or TRANSLATE.
  RELATIVE_SPAN                      -- a delta. A uniform origin shift does NOT invalidate it.
  SAMPLE_FLOOR                       -- a count. Not invalid, but may be UNSATISFIED on a young chain.
  EMPIRICAL                          -- calibrated from measurements on a named population. RE_MEASURE.
  OCCURRENCE_BASED                   -- declared because a class was SEEN on a named record. RE_OBSERVE.
  BOUNDARY_FACT                      -- a fact ABOUT the retired log. True forever, as history.
"""
import json, sys, os

LIVE = "/opt/mica-bridge/mica-bridge/declarations.config.json"
LEDGER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "discharges.json")

INV, WITHDRAW, TRANSLATE, RE_MEASURE, RE_OBSERVE, RE_SATISFY = (
    "INVARIANT", "WITHDRAW", "TRANSLATE", "RE_MEASURE", "RE_OBSERVE", "RE_SATISFY")

# ── THE CLOSED DOMAIN. One row per declared field. ───────────────────────────
PROVENANCE = {
    "schemaVersion": ("SCHEMA", INV),
    "readers.readableLoadStates": ("SCHEMA", INV),
    "readers.logPath": ("DEPLOYMENT", INV),
    "readers.logKind": ("DEPLOYMENT", INV),
    "readers.eng.structureThreshold": ("EMPIRICAL", RE_MEASURE),
    "readers.eng.minimumSampleSize": ("SAMPLE_FLOOR", RE_SATISFY),
    "readers.sig.clockToleranceMs": ("EMPIRICAL", RE_MEASURE),
    "readers.sig.clockToleranceBasis": ("EMPIRICAL", RE_MEASURE),
    "readers.sig.preconditionMap": ("WRITER_CODE", INV),
    "readers.sig.reentryMap": ("WRITER_CODE", INV),
    "readers.narrowT.driftTolerance": ("EMPIRICAL", RE_MEASURE),
    "readers.narrowT.minimumEventsPerWindow": ("SAMPLE_FLOOR", RE_SATISFY),
    "readers.narrowK.declaredProfile": ("OCCURRENCE_BASED", RE_OBSERVE),
    "readers.narrowK.correlationThreshold": ("EMPIRICAL", RE_MEASURE),
    "readers.narrowK.correlationCeilingMargin": ("EMPIRICAL", RE_MEASURE),
    "readers.narrowK.correlationMinimumConstraintEvents": ("SAMPLE_FLOOR", RE_SATISFY),
    "readers.narrowW.declaredProfile": ("OCCURRENCE_BASED", RE_OBSERVE),
    "readers.narrowW.correlationThreshold": ("EMPIRICAL", RE_MEASURE),
    "readers.narrowW.correlationCeilingMargin": ("EMPIRICAL", RE_MEASURE),
    "readers.narrowW.correlationMinimumInquiryEvents": ("SAMPLE_FLOOR", RE_SATISFY),
    "readers.narrowR.declaredProfile": ("OCCURRENCE_BASED", RE_OBSERVE),
    "readers.narrowR.correlationThreshold": ("EMPIRICAL", RE_MEASURE),
    "readers.narrowR.correlationCeilingMargin": ("EMPIRICAL", RE_MEASURE),
    "readers.narrowR.correlationMinimumVerificationEvents": ("SAMPLE_FLOOR", RE_SATISFY),
    "readers.nodeResponse.expectationClass": ("WRITER_CODE", INV),
    "readers.nodeResponse.responseClass": ("WRITER_CODE", INV),
    "readers.nodeResponse.responseBoundSteps": ("RELATIVE_SPAN", INV),
    "readers.nodeResponse.since": ("ABSOLUTE_POSITION", WITHDRAW),
    "readers.nodeResponse.flatness.amiFloor": ("EMPIRICAL", RE_MEASURE),
    "readers.nodeResponse.flatness.amiCeilingMargin": ("EMPIRICAL", RE_MEASURE),
    "readers.nodeResponse.flatness.minSample": ("SAMPLE_FLOOR", RE_SATISFY),
    "readers.doctorCadence.attestationClass": ("WRITER_CODE", INV),
    "readers.doctorCadence.cadenceBoundSteps": ("RELATIVE_SPAN", INV),
    "stakes.baseline.holdAtOrAbove": ("DEPLOYMENT", INV),
    "pilot.active": ("DEPLOYMENT", INV),
    "pilot.sessionId": ("DEPLOYMENT", INV),
    "pilot.expiresAt": ("DEPLOYMENT", INV),
    "pilot.holdAtOrAbove": ("DEPLOYMENT", INV),
    "notice.window": ("DEPLOYMENT", INV),
    "notice.maxPerMinute": ("DEPLOYMENT", INV),
    "subjectLog.maxUnacknowledged": ("DEPLOYMENT", INV),
    "subjectLog.chainBoundary.retiredPath": ("BOUNDARY_FACT", INV),
    "subjectLog.chainBoundary.retiredRecords": ("BOUNDARY_FACT", INV),
    "subjectLog.chainBoundary.retiredBytes": ("BOUNDARY_FACT", INV),
    "subjectLog.chainBoundary.retiredSha256": ("BOUNDARY_FACT", INV),
}
# ⛔ paths.clerkStamps IS NOT LIKE THE OTHER PATHS, AND THE PREFIX RULE SWALLOWED IT.
#
#   Added 2026-09-29 after the gate reported it rotation-invariant. The PATH is a
#   deployment fact like its eight neighbours. THE FILE IT NAMES IS NOT: it holds
#   clerk stamps keyed by (moduleId, sequenceNumber) on the SUBJECT CHAIN, and a
#   rotation restarts those numbers.
#
#   So after a rotation, a stamp for `housekeeper` at sequence 5 from the RETIRED
#   chain joins the NEW chain's `housekeeper` record at sequence 5 — same writer,
#   same number. ⛔ T6/T7's writer check CANNOT catch that, because the writer is
#   genuinely the same. That is route #10's shape one layer out, on the very file
#   this gate was written because of.
#
#   T3's `chainIdentity` is the check that would catch it, and it is OPTIONAL BY
#   DEFAULT. MEASURED 2026-09-29: 0 of 678 live stamps carry one. Act B's unit
#   header names the operational mitigation — "--second-stamps-out points at a NEW
#   file that has never held a pre-rotation stamp" — which is a PROCEDURE, not a
#   guard, and this gate exists because procedures written in headers are not
#   self-executing.
CHAIN_SCOPED_PATHS = {"paths.clerkStamps"}

PREFIX_RULES = [  # positional families that are deployment facts, not record facts
    ("stakes.lineClasses[", ("SCHEMA", INV)),
    ("subjects[", ("DEPLOYMENT", INV)),
    ("routes[", ("DEPLOYMENT", INV)),
    ("paths.", ("DEPLOYMENT", INV)),
]
RECORD_DERIVED = {"ABSOLUTE_POSITION", "EMPIRICAL", "OCCURRENCE_BASED", "SAMPLE_FLOOR", "CHAIN_SCOPED_FILE"}

def classify(path):
    # the chain-scoped path is checked BEFORE the prefix rule that would swallow it
    for cs in CHAIN_SCOPED_PATHS:
        if path == cs or path.startswith(cs + "."):
            return ("CHAIN_SCOPED_FILE", WITHDRAW)
    if path in PROVENANCE: return PROVENANCE[path]
    for pre, pr in PREFIX_RULES:
        if path.startswith(pre): return pr
    return None

def fields(o, p=""):
    if isinstance(o, dict):
        if "value" in o and ("basis" in o or "proxy" in o):
            yield p, o["value"]; return
        for k, v in o.items(): yield from fields(v, f"{p}.{k}" if p else k)
    elif isinstance(o, list):
        for i, v in enumerate(o): yield from fields(v, f"{p}[{i}]")
    else: yield p, o

def main():
    cfg = json.load(open(LIVE))
    chain = cfg.get("subjectLog", {}).get("chainBoundary")
    chain_id = chain["retiredSha256"]["value"] if chain else None
    ledger = json.load(open(LEDGER)) if os.path.exists(LEDGER) else {}
    discharged = ledger.get("discharged", {})

    print(f"=== SUBJECT-LOG COORDINATE GATE ===")
    print(f"  config      : {LIVE}")
    print(f"  chain since : boundary naming retired sha256 {str(chain_id)[:16]}…")
    print(f"  ledger      : {LEDGER} ({len(discharged)} discharges recorded)\n")

    fs = list(fields(cfg))
    unclassified, owed, ok = [], [], 0
    print(f"{'field':54s} {'provenance':18s} {'rule':12s} status")
    print("-"*104)
    for path, val in fs:
        c = classify(path)
        if c is None:
            unclassified.append(path); continue
        prov, rule = c
        if prov not in RECORD_DERIVED:
            ok += 1; continue
        d = discharged.get(path)
        if d and d.get("chain") == chain_id:
            ok += 1
            print(f"{path:54s} {prov:18s} {rule:12s} DISCHARGED — {d.get('evidence','')[:40]}")
        else:
            owed.append((path, prov, rule, val))
            print(f"{path:54s} {prov:18s} {rule:12s} ⛔ OWED")

    print("-"*104)
    print(f"  fields: {len(fs)}   rotation-invariant or discharged: {ok}   owed: {len(owed)}   unclassified: {len(unclassified)}")
    fail = False
    if unclassified:
        fail = True
        print("\n⛔ GATE FAILS — UNCLASSIFIED FIELDS. The domain must be closed; a field the gate")
        print("   has never heard of is exactly how `since` survived four reviews.")
        for p in unclassified: print(f"     {p}")
    if owed:
        fail = True
        print(f"\n⛔ GATE FAILS — {len(owed)} RECORD-DERIVED FIELD(S) NOT DISCHARGED against this chain.")
        print("   Each retains a warrant earned on a log that is no longer the one being read.")
    if not fail:
        print("\n✅ GATE PASSES — every record-derived field discharged against the chain in force.")
    return 1 if fail else 0

if __name__ == "__main__":
    sys.exit(main())
