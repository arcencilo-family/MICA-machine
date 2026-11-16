#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# observed.sh — DID THE BASELINE OBSERVATION ACTUALLY HAPPEN?
#
# S8 being relayed is not the observation. The observation is A DECISION, written
# because the subject attempted an act while the baseline governed. Those are two
# different facts and only one of them is the point.
#
# This reports the second one. Read-only: GETs on the operator socket, nothing else.
# No sudo, no privilege, no writes. Safe to run as often as you like.
#
# WHY IT EXISTS: nothing on this box schedules the subject, and its Telegram channel
# is lossy (~0.23-0.30 failures/min measured 2026-09-28). So an errand can be sent and
# silently not arrive, and the log would look exactly as it does now. "I sent it" and
# "it happened" are not the same claim.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
SOCK=${MICA_SOCK:-/run/mica-bridge/peers/1000/guard.sock}
BASELINE_DECISIONS=${1:-269}   # the count BEFORE the errand; default = the count at S8's prep

command -v curl >/dev/null || { echo "REFUSED: curl not found"; exit 2; }
[ -S "$SOCK" ] || { echo "REFUSED: $SOCK is not a socket. Is mica-bridge up?"; exit 2; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
curl -sS --max-time 10 --unix-socket "$SOCK" http://localhost/status -o "$TMP/status.json" \
  || { echo "REFUSED: could not GET /status over $SOCK"; exit 2; }
curl -sS --max-time 10 --unix-socket "$SOCK" http://localhost/log -o "$TMP/log.json" \
  || { echo "REFUSED: could not GET /log over $SOCK"; exit 2; }

python3 "$(dirname "$0")/observed.py" "$TMP/status.json" "$TMP/log.json" "$BASELINE_DECISIONS"
