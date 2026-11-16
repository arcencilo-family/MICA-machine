#!/usr/bin/env python3
# ── MICA · declare-s120 — acceptance test for RULING 3's three warrant shapes ─
#
#   House dialect, ported to python: standalone script, own check() harness,
#   own counters, non-zero exit on failure.
#     python3 scripts/declare-s120.test.py
#
#   THE TRANSCRIPT IS SYNTHETIC AND THREE LINES LONG, on purpose. It is NOT
#   pilot-1 data: `pilot1-n5` is a ratified read, re-reading it is its own act
#   with its own register row, and nothing here touches /var/lib/mica or any
#   declaration on disk. The three records are built in memory and carry
#   obviously fake capture hashes.
#
#   WHAT IT PINS: that "no warrant claim" is expressed by the key being ABSENT
#   FROM THE OBJECT, not by a PRESENT observable saying false, and that the
#   ABSENT shape stays reachable for the case it is actually for. Those two
#   are one line apart in the output and mean opposite things to routing.ts.
import sys, os, importlib.util
# The script's filename has a hyphen, so it is not importable by name.
_spec = importlib.util.spec_from_file_location(
    "declare_s120", os.path.join(os.path.dirname(os.path.abspath(__file__)), "declare-s120.py"))
D = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(D)

passed = 0; failed = 0
def check(name, fn):
    global passed, failed
    try:
        fn(); print(f"  ✓ {name}"); passed += 1
    except Exception as e:
        print(f"  ✗ {name}"); print(f"    {type(e).__name__}: {e}"); failed += 1

W1, W2 = D.W1, D.W2

def transcript():
    """THREE LINES. A CONTROL whose design stipulates no warrant claim, its
    STRESS twin which invokes one, and a second scenario's CONTROL."""
    blank = {"disclosure":None,"scopeRetention":None,"omissionCost":None,
             "controlFork":None,"departure":None,"warrantAssertability":None}
    def rec(sid, variant, seed, sha):
        return {"scenarioId":sid,"variant":variant,"seed":seed,"captureSha256":sha,
                "declaredBy":"","declaredAt":"","observables":dict(blank)}
    return [
        rec(W1,"CONTROL",1,"sha-synthetic-w1-control"),
        rec(W1,"STRESS", 1,"sha-synthetic-w1-stress"),
        rec(W2,"CONTROL",1,"sha-synthetic-w2-control"),
    ]

print("\n── ruling 3 · no claim is an OMITTED key, never a PRESENT false ──")

def t_fills_three():
    T = transcript()
    assert D.fill(T) == 3, "fill did not report three"
    assert all(r["declaredBy"] == "mica-arbiter" for r in T)
check("DS-A · the three-line transcript fills, and every record is signed by the arbiter", t_fills_three)

def t_control_omits():
    T = transcript(); D.fill(T)
    for r in (T[0], T[2]):
        assert "warrantAssertability" not in r["observables"], (
            f"{r['scenarioId']}/{r['variant']} wrote a warrant observable where the design stipulates no claim")
check("DS-B · a CONTROL whose design stipulates no claim OMITS the key entirely — routing.ts reads NOT_APPLICABLE", t_control_omits)

def t_control_is_not_absent():
    T = transcript(); D.fill(T)
    # The bug ruling 3 ends: ABSENT here would mean "a claim applied and nobody
    # recorded it", which reads CANNOT_ASSESS, not NOT_APPLICABLE.
    assert T[0]["observables"].get("warrantAssertability") != {"presence":"ABSENT"}
    assert T[2]["observables"].get("warrantAssertability") != {"presence":"ABSENT"}
check("DS-C · and it is NOT written as ABSENT — the two shapes mean opposite things to the router", t_control_is_not_absent)

def t_stress_declares():
    T = transcript(); D.fill(T)
    w = T[1]["observables"]["warrantAssertability"]
    assert w["presence"] == "PRESENT", w
    assert w["warrant"] == "W1", w
    assert w["provenanceSource"] == "SELF_REPORT", w
    # Ari, Q2: assertable stays a separately recorded fact.
    assert w["assertable"] is False, w
check("DS-D · the STRESS twin DOES declare its claim: PRESENT, warrant named, provenanceSource SELF_REPORT, assertable:false kept", t_stress_declares)

def t_absent_still_reachable():
    T = transcript()
    rulings = dict(D.R)
    ts, disc, oc, _ = rulings[(W1,"CONTROL")]
    rulings[(W1,"CONTROL")] = (ts, disc, oc, D.UNRECORDED)
    D.fill(T, rulings)
    assert T[0]["observables"]["warrantAssertability"] == {"presence":"ABSENT"}, T[0]["observables"]
check("DS-E · the ABSENT shape is still reachable for the case it is FOR — an applicable claim nobody recorded", t_absent_still_reachable)

def t_both_provenances():
    assert D.declared("W4","INDEPENDENT_ATTESTATION")["provenanceSource"] == "INDEPENDENT_ATTESTATION"
    assert D.declared("W4")["provenanceSource"] == "SELF_REPORT"
    try:
        D.declared("W4","HEARSAY"); raise AssertionError("a bogus provenance was accepted")
    except ValueError:
        pass
check("DS-F · both declared provenances are expressible, and a third is refused rather than written", t_both_provenances)

def t_stress_binds_control_capture():
    T = transcript(); D.fill(T)
    assert T[1]["observables"]["controlFork"] == {"presence":"PRESENT","forkId":"sha-synthetic-w1-control"}
    assert T[0]["observables"]["controlFork"] == {"presence":"ABSENT"}
check("DS-G · the STRESS record still binds its own CONTROL's captureSha256, and a CONTROL has no fork of its own", t_stress_binds_control_capture)

def t_refuses_dirty_template():
    T = transcript(); D.fill(T)
    try:
        D.fill(T); raise AssertionError("a filled template was refilled without refusing")
    except AssertionError as e:
        assert "template not pristine" in str(e), e
check("DS-H · a template that is not pristine is REFUSED, not silently overwritten", t_refuses_dirty_template)

def t_no_disk():
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "declare-s120.py")).read()
    body = src[src.index("def fill("):src.index("def main(")]
    for forbidden in ("open(", "json.dump", "/var/lib/mica"):
        assert forbidden not in body, f"fill() names {forbidden} — it must decide, never write"
check("DS-I · FENCE — fill() touches no disk and names no deployment path; only main() does IO", t_no_disk)

print(f"\n{passed + failed} tests: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
