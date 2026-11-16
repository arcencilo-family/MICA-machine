#!/bin/bash
# ── MICA · CAPTURE — read-only, GET only, after the window closes (Long Run B; T2-9, T2-10) ──
#
#   capture.sh --case-dir D --socket S --book B --roster R [--predecessor P]... --other-errands N [--grace-min M]
#
# Collects into D/capture-<UTC>/: GET /status; GET /log?tail=500 and the decisions in
# [delivered-at, window end + grace]; GET /explain for each of them (the decision hash
# is read from /events, which carries it per action); GET /events (all pages) and the
# events in the window; a copy of the witness's book, its declared predecessors and the
# interest book; the operator's word on other errands in the window (condition 5).
# Then MANIFEST (sha256, bytes, lines, ls -l per file), committed by its own sha256 in
# D/capture-<UTC>.manifest.sha256 (0400). ATTRIBUTES NOTHING; scores nothing.
# INCOMPLETE (a file named INCOMPLETE in the capture, and exit 4) when /log's tail of 500 does
# not reach back to the delivery, or /events has a gap, an empty page with more:true, or does not end (T2-10).
# Refuses before the window's end, and on a case with no window or no stamp.
# Every request is a GET; the fence in probe.test.ts holds this file to it.
set -euo pipefail
case_dir="" socket="" book="" roster="" other="" grace=0
preds=()
while [ $# -gt 0 ]; do
  case "$1" in
    --case-dir) case_dir="${2%/}"; shift 2 ;;
    --socket) socket="$2"; shift 2 ;;
    --book) book="$2"; shift 2 ;;
    --roster) roster="$2"; shift 2 ;;
    --predecessor) preds+=("$2"); shift 2 ;;
    --other-errands) other="$2"; shift 2 ;;
    --grace-min) grace="$2"; shift 2 ;;
    *) echo "capture: unknown argument $1" >&2; exit 2 ;;
  esac
done
for v in case_dir socket book roster other; do [ -n "${!v}" ] || { echo "capture: --${v//_/-} is required (nothing is defaulted)" >&2; exit 2; }; done
[[ "$other" =~ ^[0-9]+$ ]] || { echo "capture: --other-errands is a count (the operator's word)" >&2; exit 2; }
[ -f "$case_dir/window" ] || { echo "capture: REFUSED — no window in $case_dir" >&2; exit 3; }
[ -f "$case_dir/delivered-at" ] || { echo "capture: REFUSED — no delivery stamp in $case_dir" >&2; exit 3; }
start=$(sed -n 's/^START //p' "$case_dir/window")
end=$(sed -n 's/^END //p' "$case_dir/window")
delivered=$(sed -n 's/^DELIVERED-AT //p' "$case_dir/delivered-at")
now_ms=$(date -u +%s%3N)
end_ms=$(date -u -d "$end" +%s%3N)
[ "$now_ms" -ge "$end_ms" ] || { echo "capture: REFUSED — the window ends at $end; it is $(date -u +%FT%TZ)" >&2; exit 3; }

get() { curl -sS --fail-with-body --max-time 30 --unix-socket "$socket" "http://localhost$1"; }

stamp=$(date -u +%Y%m%dT%H%M%S.%3NZ)
cap="$case_dir/capture-$stamp"
chmod u+w "$case_dir"
umask 077
mkdir "$cap" "$cap/explain" "$cap/files"
# A capture that does not finish is marked, never mistaken for one that did; the case directory is closed again.
trap '[ -f "$cap/MANIFEST" ] || echo "capture did not finish; no MANIFEST" > "$cap.FAILED"; chmod 0500 "$case_dir"' EXIT
get "/status" > "$cap/status.json"
get "/log?tail=500" > "$cap/log-tail.json"
# /events pages forward from a cursor. THE CURSOR IS THE LAST SEQ THIS PAGE RETURNED, never the response's lastSeq:
# the bridge's lastSeq is the WHOLE BOOK's last seq, so paging on it skips every event between a page's end and the
# book's end the moment `more` is true (MP6; the old loop dropped 501..N of an N-event book). Every page is checked:
# its seqs run on exactly from the previous page's last (the first page from the book's start, 1, or earlier), more:true
# with an empty page is a gap, and the last page's last seq equals the book's lastSeq. Any failure stops the paging and
# writes INCOMPLETE naming the gap; the capture is still sealed (the evidence is kept) and capture.sh exits 4.
after=0; page=0; expect=""
while :; do
  get "/events?after=$after&limit=500" > "$cap/events-page-$page.json"
  verdict=$(P_PAGEFILE="$cap/events-page-$page.json" P_AFTER="$after" P_EXPECT="$expect" python3 - <<'PY'
import json, os
E = os.environ
d = json.load(open(E["P_PAGEFILE"]))
after, expect = int(E["P_AFTER"]), (int(E["P_EXPECT"]) if E["P_EXPECT"] else None)
ev, more, last = d.get("events"), d.get("more"), d.get("lastSeq")
def gap(why): print("GAP " + why); raise SystemExit(0)
if not isinstance(ev, list) or not isinstance(more, bool): gap(f"page after={after}: no events list or no boolean more")
seqs = []
for e in ev:
    s = e.get("seq") if isinstance(e, dict) else None
    try:
        n = int(s)
        if str(n) != str(s).strip(): raise ValueError
    except (TypeError, ValueError): gap(f"page after={after}: an event with no integer seq ({json.dumps(s)})")
    seqs.append(n)
if more and not seqs: gap(f"page after={after}: more:true with an empty page (lastSeq {last})")
nxt = expect
for n in seqs:
    if nxt is None:
        # the first event of the capture: the book starts at 1 (a book may carry a 0); anything later is a gap
        if n > after + 1: gap(f"seqs {after + 1}..{n - 1} missing before the first returned seq {n}")
    elif n != nxt: gap(f"seq {n} where {nxt} was due" + (f" ({nxt}..{n - 1} missing)" if n > nxt else " (repeated or out of order)"))
    nxt = n + 1
cursor = max(seqs) if seqs else after
if not more:
    if not isinstance(last, int) or isinstance(last, bool): gap(f"last page: no integer lastSeq ({json.dumps(last)})")
    if seqs or nxt is not None:
        if cursor != last: gap(f"the last returned seq {cursor} is not the book's lastSeq {last} ({cursor + 1}..{last} missing)" if last > cursor else f"the last returned seq {cursor} is past the book's lastSeq {last}")
    elif last > after: gap(f"no events returned but the book's lastSeq is {last}")
print("OK", cursor, "-" if nxt is None else nxt, "1" if more else "0", len(seqs))
PY
)
  page=$((page+1))
  case "$verdict" in
    "GAP "*) echo "events: ${verdict#GAP } (T2-10; paging stopped at page $((page-1)))" >> "$cap/INCOMPLETE"; break ;;
    "OK "*) read -r _ after expect more _ <<< "$verdict"; [ "$expect" != "-" ] || expect="" ;;
    *) echo "events: page $((page-1)) could not be read (verdict: $verdict)" >> "$cap/INCOMPLETE"; break ;;
  esac
  [ "$more" = "1" ] || break
  [ $page -lt 5000 ] || { echo "events: more than 5000 pages" >> "$cap/INCOMPLETE"; break; }
done
# The instants travel in the environment, not on the command line (/proc carries no hidepid here).
P_CAP="$cap" P_START="$start" P_END="$end" P_DELIVERED="$delivered" P_GRACE="$grace" P_OTHER="$other" python3 - <<'PY'
import json, sys, glob, datetime, os
E = os.environ
cap, start, end, delivered, grace, other = E["P_CAP"], E["P_START"], E["P_END"], E["P_DELIVERED"], int(E["P_GRACE"]), int(E["P_OTHER"])
def ms(s): return int(datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000)
s_ms, e_ms, d_ms = ms(start), ms(end) + grace * 60000, ms(delivered)
log = json.load(open(f"{cap}/log-tail.json"))
lines = log["lines"]
complete = len(lines) >= log.get("total", 0) or (len(lines) > 0 and lines[0]["timestamp"] < min(s_ms, d_ms))
if not complete:
    open(f"{cap}/INCOMPLETE", "a").write(f"log: the tail of {len(lines)} of {log.get('total')} does not reach back to the window's start (T2-10)\n")
decisions = [l for l in lines if d_ms <= l["timestamp"] <= e_ms]
events = []
for p in sorted(glob.glob(f"{cap}/events-page-*.json"), key=lambda x: int(x.rsplit("-", 1)[1].split(".")[0])):
    events += json.load(open(p))["events"]
json.dump(events, open(f"{cap}/events-all.json", "w"), indent=1)
def when(e):
    t = e.get("ts") or e.get("at")
    return None if t is None else ms(t)
untimed = [e.get("seq") for e in events if when(e) is None]
if untimed:
    open(f"{cap}/events-untimed.txt", "w").write("events with neither ts nor at (kept in events-all.json, never placed in the window): " + " ".join(map(str, untimed)) + "\n")
win = [e for e in events if when(e) is not None and s_ms <= when(e) <= e_ms]
json.dump(win, open(f"{cap}/events-window.json", "w"), indent=1)
by_action = {}
for e in events:
    a = (e.get("identity") or {}).get("actionId")
    if a is not None and e.get("decisionHash"):
        by_action.setdefault(a, e["decisionHash"])
out = []
for l in decisions:
    out.append({"sequenceNumber": l["sequenceNumber"], "actionId": l["actionId"], "timestamp": l["timestamp"],
                "decisionHash": by_action.get(l["actionId"])})
json.dump({"window": {"start": start, "end": end, "graceMin": grace}, "deliveredAt": delivered, "decisions": out}, open(f"{cap}/decisions.json", "w"), indent=1)
json.dump({"otherErrands": other, "word": "the operator's count of other delivered errands between the stamp and the window's end (condition 5)"}, open(f"{cap}/operator-word.json", "w"), indent=1)
with open(f"{cap}/explain-list.txt", "w") as f:
    for d in out:
        f.write(f"{d['sequenceNumber']} {d['decisionHash'] or '-'}\n")
PY
while read -r seq h; do
  if [ "$h" = "-" ]; then echo "$seq: no decision hash on /events for this action" >> "$cap/explain-missing.txt"; continue; fi
  get "/explain?decisionHash=$h" > "$cap/explain/$seq.json"
done < "$cap/explain-list.txt"
cp --preserve=timestamps "$book" "$cap/files/book.jsonl"
cp --preserve=timestamps "$roster" "$cap/files/roster.jsonl"
i=0; for p in "${preds[@]+"${preds[@]}"}"; do cp --preserve=timestamps "$p" "$cap/files/predecessor-$i.jsonl"; i=$((i+1)); done
{ echo "source book $book"; echo "source roster $roster"; for p in "${preds[@]+"${preds[@]}"}"; do echo "source predecessor $p"; done; echo "socket $socket"; echo "captured-at $(date -u +%FT%T.%3NZ) by $(id -un)"; } > "$cap/SOURCES"
# MANIFEST: every file, its sha256, bytes, lines and ls -l; nothing unlisted.
( cd "$cap" && find . -type f ! -name MANIFEST | LC_ALL=C sort | while read -r f; do
    printf '%s %s %s %s\n' "$(sha256sum "$f" | cut -d' ' -f1)" "$(stat -c %s "$f")" "$(wc -l < "$f")" "${f#./}"
  done > MANIFEST
  echo "# ls -l" >> MANIFEST; find . -type f ! -name MANIFEST | LC_ALL=C sort | xargs ls -l | sed 's/^/# /' >> MANIFEST )
find "$cap" -type f -exec chmod 0400 {} +
find "$cap" -type d -exec chmod 0500 {} +
msha=$(sha256sum "$cap/MANIFEST" | cut -d' ' -f1)
echo "$msha" > "$cap.manifest.sha256"; chmod 0400 "$cap.manifest.sha256"
chmod 0500 "$case_dir"
echo "CAPTURE $cap"
echo "MANIFEST sha256 $msha ($(grep -vc '^#' "$cap/MANIFEST") files)"
# An INCOMPLETE capture is sealed like any other (the evidence is kept) and is never a success: exit 4.
if [ -e "$cap/INCOMPLETE" ]; then echo "INCOMPLETE:"; cat "$cap/INCOMPLETE"; exit 4; fi
