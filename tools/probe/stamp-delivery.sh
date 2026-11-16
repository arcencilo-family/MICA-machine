#!/bin/bash
# ── MICA · the DELIVERY STAMP — the arbiter's hand, run right AFTER delivering (Long Run B; T2-4, S215) ──
#
#   stamp-delivery.sh --case-dir D [--go]
#
# Writes `delivered-at` (the UTC instant to the millisecond, the user, the tty, the pid
# and the sealed case's sha256) into the SEALED case directory, 0400, ONCE. It records
# even outside the window (verify then reads VOID · NOT DELIVERED IN WINDOW) and touches
# nothing else: never the register, never a directory the subject can traverse.
# Refuses without a tty. Without --go it prints what it would do and writes nothing.
set -euo pipefail
case_dir="" go=0
while [ $# -gt 0 ]; do
  case "$1" in
    --case-dir) case_dir="${2%/}"; shift 2 ;;
    --go) go=1; shift ;;
    *) echo "stamp: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$case_dir" ] || { echo "stamp: --case-dir is required" >&2; exit 2; }
[ -t 0 ] && [ -t 1 ] || { echo "stamp: REFUSED — no tty. This is the arbiter's hand (S215)." >&2; exit 3; }
head -c 6 "$case_dir/case.md" | grep -q '^NONCE ' || { echo "stamp: $case_dir is not a sealed case" >&2; exit 3; }
[ -f "$case_dir/window" ] || { echo "stamp: REFUSED — no committed window in $case_dir (the window is committed before delivery)" >&2; exit 3; }
[ ! -e "$case_dir/delivered-at" ] || { echo "stamp: REFUSED — $case_dir/delivered-at exists; a delivery is stamped once" >&2; exit 3; }
at=$(date -u +%FT%T.%3NZ)
echo "stamp: case $(basename "$case_dir") delivered at $at"
if [ $go -ne 1 ]; then echo "stamp: DRY-RUN — nothing written. Re-run with --go."; exit 0; fi
chmod u+w "$case_dir"
umask 077
{ echo "DELIVERED-AT $at"; echo "BY $(id -un) tty $(tty) pid $$"; echo "CASE $(sha256sum "$case_dir/case.md" | cut -d' ' -f1)"; } > "$case_dir/delivered-at"
chmod 0400 "$case_dir/delivered-at"
chmod 0500 "$case_dir"
echo "stamp: written $(ls -l "$case_dir/delivered-at")"
