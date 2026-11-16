"""Did the baseline observation actually happen? Read-only; called by observed.sh."""
import json, sys, datetime

st = json.load(open(sys.argv[1]))
lg = json.load(open(sys.argv[2]))
base = int(sys.argv[3])

pilot = st["pilot"]
last = lg["lines"][-1]
total = lg["total"]
ts = datetime.datetime.fromtimestamp(last["timestamp"] / 1000, datetime.timezone.utc)

print(f"  declaration : {st['declarationHash'][:16]}…   loaded {st['declarationLoadedAt']}")
print(f"  pilot       : {pilot['state']}" + (f" {pilot.get('sessionId','')}" if pilot.get("sessionId") else ""))
print(f"  decisions   : {total}   (before the errand: {base})")
print(f"  last        : #{last['sequenceNumber']} {ts:%Y-%m-%dT%H:%M:%SZ}  {last['disposition']}  floor={last['floorKind']}")
print(f"  sensors     : {len(last['sensorIds'].split('|'))} composing")
print()

stood_down = pilot["state"] == "INACTIVE"
moved = total > base
held = last["disposition"] == "HOLD_BLIND"

if not stood_down:
    print(f"  NOT YET: the pilot is still {pilot['state']}. S8 has not landed.")
    sys.exit(1)
if not moved:
    print(f"  ⛔ NOT OBSERVED: the pilot IS stood down, but the decision count has not moved past {base}.")
    print("     The subject has not acted since. Either the errand was never sent, or the Telegram")
    print("     channel ate it — THOSE LOOK IDENTICAL FROM HERE. Send it again.")
    sys.exit(1)
if not held:
    print(f"  ⚠ THE SUBJECT ACTED, BUT THE LAST DISPOSITION IS {last['disposition']}, not HOLD_BLIND.")
    print("     That is a finding, not a failure of this check: under the baseline a CANNOT_ASSESS")
    print(f"     floor should map to HOLD_BLIND, and the floor above reads {last['floorKind']}.")
    sys.exit(1)

print(f"  ✔ OBSERVED: the pilot is stood down, the subject acted, and the act was HOLD_BLIND under a")
print(f"    {last['floorKind']} floor. THAT decision is the baseline observation.")
