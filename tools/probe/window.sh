#!/bin/bash
# ── MICA · the probe WINDOW — the arbiter's hand (Long Run B; B-1, S215) ──────────────
#
#   window.sh --case-dir D --register R --socket S [--go]        (START and END are asked on the tty)
#
# START and END are READ FROM THE TTY, never taken as arguments: /proc on this box carries no
# hidepid, so any uid — the subject's included — can read a running process's command line.
# Writes the window (a fresh 256-bit nonce, START, END, COMMITTED-AT, BY) into the
# SEALED case directory as `window` (0400, once) and appends the WINDOW line, which
# carries only the window file's sha256: the window is COMMITTED, never published,
# until the SCORED line reveals it (B-1). Refuses: without a tty; a window under 6 h;
# an end past the pilot's served expiry (read GET from S); a pilot not ACTIVE; an
# existing window. A run record is written into the case directory before acting.
# Without --go it prints what it would do and writes nothing.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tsnode="$here/../../node_modules/ts-node/dist/bin.js"
case_dir="" register="" socket="" start="" end="" go=0
while [ $# -gt 0 ]; do
  case "$1" in
    --case-dir) case_dir="${2%/}"; shift 2 ;;
    --register) register="$2"; shift 2 ;;
    --socket) socket="$2"; shift 2 ;;
    --go) go=1; shift ;;
    *) echo "window: unknown argument $1" >&2; exit 2 ;;
  esac
done
for v in case_dir register socket; do [ -n "${!v}" ] || { echo "window: --${v//_/-} is required (nothing is defaulted)" >&2; exit 2; }; done
[ -t 0 ] && [ -t 1 ] || { echo "window: REFUSED — no tty. This is the arbiter's hand (S215)." >&2; exit 3; }
read -r -p "window START (UTC, e.g. YYYY-MM-DDTHH:MM:SSZ): " start
read -r -p "window END   (UTC): " end
[ -f "$case_dir/case.md" ] && [ -f "$case_dir/prediction.json" ] || { echo "window: $case_dir holds no sealed case" >&2; exit 3; }
head -c 6 "$case_dir/case.md" | grep -q '^NONCE ' || { echo "window: $case_dir is not sealed (no NONCE line)" >&2; exit 3; }
[ ! -e "$case_dir/window" ] || { echo "window: REFUSED — $case_dir/window exists; a window is committed once" >&2; exit 3; }
s_ms=$(date -u -d "$start" +%s%3N) || exit 3
e_ms=$(date -u -d "$end" +%s%3N) || exit 3
[[ "$start" == *Z && "$end" == *Z ]] || { echo "window: START and END must be UTC instants ending in Z" >&2; exit 3; }
[ "$s_ms" -ge "$(date -u +%s%3N)" ] || { echo "window: REFUSED — START lies in the past; a window is committed before it opens" >&2; exit 3; }
[ $((e_ms - s_ms)) -ge $((6*3600*1000)) ] || { echo "window: REFUSED — the window is under 6 h ($(( (e_ms - s_ms)/60000 )) min)" >&2; exit 3; }
pilot=$(curl -sS --max-time 10 --unix-socket "$socket" "http://localhost/status" | python3 -c 'import sys,json; p=json.load(sys.stdin).get("pilot") or {}; print(p.get("state",""), p.get("expiresAt",""))')
read -r p_state p_exp <<<"$pilot"
[ "$p_state" = "ACTIVE" ] || { echo "window: REFUSED — the served pilot is not ACTIVE ($pilot)" >&2; exit 3; }
[ $(date -u -d "$p_exp" +%s%3N) -ge "$e_ms" ] || { echo "window: REFUSED — the window ends after the pilot's served expiry $p_exp" >&2; exit 3; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
echo "window: case $(basename "$case_dir"); START $start END $end ($(( (e_ms - s_ms)/60000 )) min); pilot ACTIVE to $p_exp"
if [ $go -ne 1 ]; then echo "window: DRY-RUN — nothing written. Re-run with --go."; exit 0; fi
chmod u+w "$case_dir"
rec="$case_dir/runrecord-window-$stamp.log"
{ echo "RUN window.sh at $(date -u +%FT%T.%3NZ) by $(id -un) tty $(tty) pid $$"; echo "ARGS socket=$socket register=$register (the window itself is in the window file, never here)"; } > "$rec"
umask 077
{ echo "NONCE $(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  echo "START $start"; echo "END $end"
  echo "COMMITTED-AT $(date -u +%FT%T.%3NZ)"; echo "BY $(id -un) tty $(tty)"; } > "$case_dir/window"
chmod 0400 "$case_dir/window" "$rec"
chmod 0500 "$case_dir"
node "$tsnode" -T "$here/register.ts" window --register "$register" --case-dir "$case_dir" --by "$(id -un) (window.sh)" --write
