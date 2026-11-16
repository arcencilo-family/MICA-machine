#!/usr/bin/env python3
"""Generates the arbiter's three scripts for the witness's seeing half, phase R (sight-since-last-look; audit 2026-10-11
09:32Z), to the own-home-v4 standard — every measured value guarded, backups before every overwrite, nothing deleted,
exact undo — and pins the code bytes the machine relay lays (`G1`).

  python3 deploy/gen-deploy.py           write witness-sight-deploy.sh, witness-sight-remove.sh,
                                         what13-ilas-devtree-hygiene.sh beside this file; print each sha256
  python3 deploy/gen-deploy.py --check   write nothing; exit 1 unless the committed scripts are exactly what this
                                         generator makes from this tree (the fence runs it: F-6)

COMMITTED UNDER deploy/ (audit 2026-10-11 12:51Z) so the literal fence sees all four files. They name nothing: each
measured value that would name the subject or the operator is pinned as a SHA-256 of the measured string, with the
command that re-derives it beside the pin; the scripts read the live value and compare. The generator never measures:
a pin moves only when a seat re-measures and edits it here, by hand, with the time.
"""
import hashlib, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TREE = os.path.dirname(HERE)  # the repository root: deploy/..
sha_file = lambda p: hashlib.sha256(open(os.path.join(TREE, p), "rb").read()).hexdigest()
sha_text = lambda s: hashlib.sha256(s.encode()).hexdigest()

PINS = [
    "src/witness/seeingd.ts",
    "src/witness/seeing.ts",
    "src/witness/seeing-intake.ts",
    "src/glue/subject-event-journal.ts",
    "deploy/mica-witness-sight.service",
]
UNIT_SHA = sha_file("deploy/mica-witness-sight.service")
SIGHT = "/var/lib/mica/witness-sight"
DROPIN_TEXT = f"[Service]\nReadWritePaths={SIGHT}/intake\n"
DROPIN_SHA = sha_text(DROPIN_TEXT)
# The seeing method's digest at the pinned seeing.ts (SEEING_METHOD_DIGEST): the unit gate requires the running witness
# to name exactly this; seeingd.test.ts SD-37 holds it equal to the code's, so a change to the method fails a test until
# this pin moves with it. W-1 (audit 2026-10-11 18:43Z) moved it from bd91dc37… — the method the live unit started under
# at 16:37:23Z and still names until it is restarted onto the relayed code (the --finish does that, recorded).
METHOD_WANT = "2a4c1dad0956d152318c96037fc324306e35ad76f0dfd041b87608e7dcc3a6b8"
GATE_WAIT = 90  # seconds the unit gate waits for the witness to start (ts-node took 4.5 s at 16:37Z; the old gate slept 3)

# ── MEASURED by the build seat, the operator's uid, read-only, 2026-10-11T13:1xZ (unchanged since 06:3xZ) ──────────────────────
MEASURED = r'''# ── MEASURED (2026-10-11T13:1xZ, build seat, the operator's uid, read-only) — re-derive any pin with the command beside it ──
SERVED_DECL=/opt/mica-bridge/mica-bridge/declarations.config.json
SERVED_DECL_SHA=08fe2ad9994e55ffd7e7c7445d98ca292d7b65a675132476ffd480b52a7ad347   # S30, live: sha256sum $SERVED_DECL
# the served subject's passwd line:  printf '%s' "$(getent passwd <the declaration's peerUid>)" | sha256sum
SUBJ_PASSWD_SHA=048330e5b62bf31530370951832d8923a35c5ec04932fdc61c5521626733c53d
# the served frame's /home regions, "prefix=category" sorted, space-joined (the operator's home = c1, the subject's = c5)
HOMES_WANT_SHA=da1c8946e124489f5ee0b83363c6422a9789d1b0c132856ff07eeec0e853ddd3
BRIDGE_PASSWD='mica-bridge:x:982:972::/home/mica-bridge:/usr/sbin/nologin'
DROPIN_DIR=/etc/systemd/system/mica-bridge.service.d
DROPIN_DIR_WANT='alerter.conf'
ALERTER_SHA=9d5b3473dd4b4cc94f783503c25d316335bb10a4abb793e7925a1fa8101b7ac8
OPT=/opt/mica-machine
SIGHT=@@SIGHT@@
UNIT_SRC=$OPT/deploy/mica-witness-sight.service
UNIT_DST=/etc/systemd/system/mica-witness-sight.service
UNIT_SHA=@@UNIT_SHA@@        # the committed unit (deploy/mica-witness-sight.service)
DROPIN=$DROPIN_DIR/witness-sight.conf
DROPIN_SHA=@@DROPIN_SHA@@      # the drop-in this deploy writes: [Service] ReadWritePaths=$SIGHT/intake
METHOD_WANT=@@METHOD_WANT@@   # the seeing method the running witness must name (SD-37 = the code's)
GATE_WAIT=@@GATE_WAIT@@   # seconds the unit gate polls for the witness to come up (no fixed sleep)
SAVE=/var/backups/mica-witness-sight   # every backup and the run record land here, per run stamp (root 0700)
# ───────────────────────────────────────────────────────────────────────────────────────────────────────────
'''

# The remover declares ONLY what it compares (audit 2026-10-11 15:27Z: six values were declared and never checked —
# the S30 declaration's sha, the subject's passwd line, the drop-in directory's listing, the alerter's sha and the unit's
# source are deploy-time facts the remover has no use for, so it no longer carries them).
REMOVE_MEASURED = r'''# ── WHAT THIS REMOVER COMPARES (2026-10-11T13:1xZ measurements; every value below is checked before any change) ──
SERVED_DECL=/opt/mica-bridge/mica-bridge/declarations.config.json   # read by the DRY run only, for the homes
# the served frame's /home regions, "prefix=category" sorted, space-joined: the run record's must hash to this (R1)
HOMES_WANT_SHA=da1c8946e124489f5ee0b83363c6422a9789d1b0c132856ff07eeec0e853ddd3
BRIDGE_PASSWD='mica-bridge:x:982:972::/home/mica-bridge:/usr/sbin/nologin'   # R7
SIGHT=@@SIGHT@@                                                     # R5: mica-sight's, 0755
UNIT_DST=/etc/systemd/system/mica-witness-sight.service
UNIT_SHA=@@UNIT_SHA@@        # R3: the committed unit
DROPIN_DIR=/etc/systemd/system/mica-bridge.service.d
DROPIN=$DROPIN_DIR/witness-sight.conf
DROPIN_SHA=@@DROPIN_SHA@@      # R4: the drop-in the deploy wrote
SAVE=/var/backups/mica-witness-sight   # the deploy's backups and run record, per run stamp (root 0700)
# ───────────────────────────────────────────────────────────────────────────────────────────────────────────
'''

COMMON = r'''set -uo pipefail
set -f
umask 077
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
say()  { printf '%s\n' "$*"; }
g()    { say "  ok  $*"; }
sha()  { sha256sum "$1" 2>/dev/null | cut -d' ' -f1; }
sha_s() { printf '%s' "$1" | sha256sum | cut -c1-64; }
acl()  { getfacl -cpE "$1" 2>/dev/null | grep -v '^$' | paste -sd'|'; }
aclfile() { printf '%s/acl%s' "$1" "$(printf '%s' "$2" | tr / _)"; }
# the served frame's /home regions, "prefix=category" sorted, one line (empty on any failure: a guard never passes empty)
decl_homes() { python3 - "$1" <<'PY' 2>/dev/null
import json, sys
d = json.load(open(sys.argv[1])); s = d["subjects"][0]
regions = d["frame"][s["subject"]]["regions"]["value"]
print(" ".join(sorted(f'{r["prefix"]}={r["category"]}' for r in regions if r["prefix"].startswith("/home/"))))
PY
}
'''

DEPLOY = r'''#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
# witness-sight-deploy.sh — Gate 2 Tier 1 · the WITNESS's seeing half, PHASE R (sight-since-last-look; audit
# 2026-10-11 09:32Z). Generated by deploy/gen-deploy.py (committed); THE ARBITER'S HAND ONLY; own-home-v4 standard.
#
#   bash witness-sight-deploy.sh                 DRY (default): evaluates every guard the operator's uid can, changes NOTHING.
#   sudo bash witness-sight-deploy.sh --apply [--reach | --reach-list]
#                                                THE DEPLOY. Root only. Stops at the first refusal. Nothing deleted.
#                                                --reach: traverse-only (--x) for the witness's uid on the two homes
#                                                (the audit recommends it); --reach-list: r-x.
#   [sudo] bash witness-sight-deploy.sh --finish --stamp <deploy run stamp> --reach|--reach-list|--no-reach [--apply]
#                                                RE-ENTRANT FINISH of a run that stopped after its unit started (the
#                                                16:37Z unit gate): checks everything that run left against its own run
#                                                record (G7 READS what exists instead of refusing it), re-takes the unit
#                                                gate, then steps 5 and 6 only — recorded in the SAME run record, nothing
#                                                re-created. The reach flag must agree with the record. Safe to repeat.
#                                                If the running witness names an older method than the relayed code, it
#                                                is restarted onto it (recorded); it retires its old book unaltered.
#
# RUN IT FROM /opt/mica-machine/deploy/ once the machine relay has laid it there (root-owned, the committed bytes),
# and compare `sha256sum` of that file with the sha the seat gave you. Never copy this script to the Windows mount.
#
# PHASE R, SHRUNK: the unit runs --no-witness — the book IS the record, chained and 0644. Head submission to
# witnessd (its roster, its restart) and the ILAS/dev-tree hygiene are NOT here: the hygiene is the separate
# what13-ilas-devtree-hygiene.sh (the arbiter's hand), and witnessd integration is S210.
#
# ORDER OF ACTS (this is step 2): 1. machine relay of gate2-witness -> 2. THIS -> 3. bridge relay (its restart
# applies the group and the drop-in) -> 4. S31. Run it BEFORE S31: guard G2 pins the live declaration to S30.
#
# WHAT IT DOES (each act checked; a refusal names the phase and prints the exact undo):
#   G  guards — every measured value re-read now (refuse if anything differs; nothing touched)
#   R  the RUN RECORD $SAVE/<stamp>/deploy.record (root 0600): each step is recorded BEFORE it is taken, so the
#      remover undoes exactly the steps this run began, and checks each against what the run recorded
#   1  group mica-sight-drops (new), user mica-sight (new); mica-sight joins mica-sight-drops; mica-bridge joins
#      mica-sight-drops — and the subject is re-checked in NEITHER new group
#   2  /var/lib/mica/witness-sight (0755), intake (3730 setgid), state (0700)
#   3  the bridge drop-in witness-sight.conf (new; the directory's other file backed up first; read back by sha)
#   4  the unit installed (read back by sha), started — GATED by a bounded poll (GATE_WAIT s, no fixed sleep): the
#      unit active, THIS invocation's journal naming the pinned method, the book's first line the boundary naming it
#      (the 16:37Z run refused on a 3 s sleep while ts-node took 4.5 s to write that line: a race, now gone)
#   5  [--reach] the ACL grant on the two homes (each ACL saved first, whole, for the remover to RESTORE)
#   6  read-backs, incl. access probes AS THE SUBJECT
#   => THE EXACT UNDO, printed with this run's stamp.
#
# NO SIGNAL TRAPS (S205): an interrupted run stops where it is; its record names every step begun.
# EXIT: 0 done · 1 refused, NOTHING changed · 3 done with a GAP (named) · 4 refused AFTER changes began.
# NEVER: deletes; reads /etc/mica-*/bot.env or /proc/<pid>/environ; touches the subject's unit, code or home
# contents; touches witnessd or its roster; widens an ACL beyond --x (r-x with --reach-list); runs an errand.
# ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
''' + COMMON + MEASURED + r'''
MODE=dry; REACH=none; REACH_SAID=no; FINISH=no; FSTAMP=""
usage() { echo "usage: $0 [--apply] [--reach|--reach-list]  |  $0 --finish --stamp <STAMP> --reach|--reach-list|--no-reach [--apply]" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) MODE=apply ;;
    --reach) REACH=traverse; REACH_SAID=yes ;;
    --reach-list) REACH=list; REACH_SAID=yes ;;
    --no-reach) REACH=none; REACH_SAID=yes ;;
    --finish) FINISH=yes ;;
    --stamp) FSTAMP="${2:-}"; shift ;;
    *) usage ;;
  esac; shift
done
if [ "$FINISH" = yes ]; then
  case "$FSTAMP" in [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;; *) usage ;; esac
  [ "$REACH_SAID" = yes ] || usage   # the operator states the reach; it is checked against the run record
  RUN_STAMP=$FSTAMP
else
  [ -z "$FSTAMP" ] || usage
  RUN_STAMP=$STAMP
fi
PHASE=pre; GAP=no; DONE=""
done_() { DONE="$DONE $1"; }
undo_line() { say "  UNDO (exact): sudo bash $OPT/deploy/witness-sight-remove.sh --apply --stamp $RUN_STAMP$( [ "$REACH" != none ] && printf ' --reach-was-granted')"; }
refuse() {
  say "REFUSED (phase $PHASE): $*"
  if [ "$PHASE" = pre ]; then say "Nothing was changed."; exit 1; fi
  say "Steps done before the refusal:$DONE"; undo_line; exit 4
}
REC=""
rec() { [ "$MODE" = apply ] || return 0; printf '%s\n' "$1" >> "$REC" || refuse "the run record $REC could not be written"; }
act() { say "  \$ $*"; [ "$MODE" = apply ] || return 0; "$@" || refuse "failed: $*"; }
pin() { local f="$1" want="$2" got; got=$(sha "$OPT/$f"); if [ "$got" = "$want" ]; then g "$OPT/$f"; else PIN_FAIL=yes; say "  X   $OPT/$f is ${got:-ABSENT}, want $want"; fi; }
recorded() { [ "$MODE" = apply ] && grep -qx "$1" "$REC"; }
recv() { grep -m1 "^$1=" "$REC" 2>/dev/null | cut -d= -f2-; }
rec_once() { recorded "$1" || rec "$1"; }
BOOK=$SIGHT/book-of-effects.jsonl
# THE UNIT GATE — a bounded poll, never a fixed sleep: the unit active, THIS invocation's journal naming the pinned
# method (seeingd logs it only after its constructor has written the book's first line), and that first line the
# boundary naming the same method. More lines after it are allowed: a bridge already dropping pointers is not a fault.
unit_gate() {
  local i=0 st inv meth=""
  while :; do
    st=$(systemctl is-active mica-witness-sight 2>/dev/null)
    case "$st" in failed|inactive) refuse "mica-witness-sight is $st — its journal: $(journalctl -u mica-witness-sight -n 5 -o cat --no-pager 2>/dev/null | paste -sd'|')";; esac
    inv=$(systemctl show -p InvocationID --value mica-witness-sight 2>/dev/null)
    [ -n "$inv" ] && meth=$(journalctl _SYSTEMD_INVOCATION_ID="$inv" -o cat --no-pager 2>/dev/null | grep -o 'method [0-9a-f]\{64\}' | tail -1 | cut -d' ' -f2)
    { [ "$st" = active ] && [ -n "$meth" ] && [ -s "$BOOK" ]; } && break
    i=$((i + 1)); [ "$i" -le "$GATE_WAIT" ] || refuse "after ${GATE_WAIT}s mica-witness-sight is '$st', its method line '${meth:-not logged}', the book $( [ -s "$BOOK" ] && echo present || echo absent)"
    sleep 1
  done
  [ "$meth" = "$METHOD_WANT" ] || refuse "the running witness names method $meth, not the pinned $METHOD_WANT"
  head -1 "$BOOK" | python3 -c 'import json,sys; o=json.loads(sys.stdin.read()); sys.exit(0 if o.get("recordType") == "SUBJECT_LOG_BOUNDARY" and o.get("sequenceNumber") == 0 and sys.argv[1] in o.get("basis", "") else 1)' "$METHOD_WANT" \
    || refuse "the book's first line is not the boundary naming method $METHOD_WANT"
  g "unit active; this invocation names method $meth (= pinned) after ${i}s of polling; the book: $(stat -c '%a %U:%G' "$BOOK"), $(wc -l < "$BOOK") line(s), its first the boundary naming that method"
}
# ONE HOME'S REACH: its whole ACL saved ONCE (an earlier save is kept, never overwritten), recorded, then the grant.
reach_home() {
  local h="$1" F; F=$(aclfile "$SAVE/$RUN_STAMP" "$h")
  if [ "$MODE" = apply ] && [ -e "$F" ]; then
    recorded "acl_saved=$h" || refuse "$F exists but the run record does not name it — read both before anything else"
    say "  $h: its ACL was saved by an earlier pass of this run ($F) — kept, not overwritten"
  else
    say "  \$ getfacl -pE $h > $F   (the whole ACL, saved for the remover to RESTORE)"
    if [ "$MODE" = apply ]; then getfacl -pE "$h" > "$F" || refuse "could not save the ACL of $h"; rec_once "acl_saved=$h"; fi
  fi
  rec_once "step=reach:$h"
  if [ "$MODE" = apply ]; then
    if setfacl -m "u:mica-sight:$PERM" "$h"; then done_ "reach:$h"; else GAP=yes; say "  GAP: the grant on $h failed (the rest stands): setfacl -m u:mica-sight:$PERM $h"; fi
  else say "  \$ setfacl -m u:mica-sight:$PERM $h"; fi
}
readbacks() {
  if [ "$MODE" = apply ]; then
    say "  mica-sight      $(getent passwd mica-sight) · groups $(id -nG mica-sight)"
    say "  mica-bridge     groups $(id -nG mica-bridge)"
    say "  subject         groups $(id -nG "$SUBJ")"
    say "  unit            $(systemctl is-active mica-witness-sight) · the book $(wc -l < "$BOOK") line(s) · retired beside it: $(find "$SIGHT" -maxdepth 1 -type f -name 'book-of-effects.jsonl.retired-*' | wc -l)"
    say "  dirs            $(stat -c '%a %U:%G %n' "$SIGHT" "$SIGHT/intake" "$SIGHT/state" | paste -sd';')"
    for h in $HOMES; do
      say "  ACL $h  $(acl "$h")"
      if [ -n "$PERM" ] && ! getfacl -cpE "$h" 2>/dev/null | grep -qx "user:mica-sight:$PERM"; then GAP=yes; say "  GAP: $h does not carry user:mica-sight:$PERM"; fi
    done
    while read -r who op path exp; do
      [ -n "$who" ] || continue
      u=$who; [ "$u" = SUBJ ] && u=$SUBJ
      if runuser -u "$u" -- test "-$op" "$path" </dev/null; then got=yes; else got=no; fi
      say "  $who -$op $path: $got (expected $exp)"
      [ "$got" = "$exp" ] || { GAP=yes; say "  GAP: the probe above is not as expected"; }
    done <<EOF
SUBJ r $SIGHT/book-of-effects.jsonl yes
SUBJ w $SIGHT/intake no
SUBJ x $SIGHT/state no
SUBJ w $SIGHT/book-of-effects.jsonl no
$(for h in $HOMES; do [ -n "$PERM" ] && printf 'mica-sight x %s yes\n' "$h"; done)
EOF
    say "  run record      $REC: $(wc -l < "$REC") lines"
  else
    say "  [dry] would print users/groups, the unit, the dirs, the ACLs, the run record, four access probes AS THE SUBJECT"
    say "  [dry] and, with reach, one traverse probe AS mica-sight per home (each a GAP if not as expected)."
  fi
}

say "witness-sight-deploy.sh (phase R)  mode=$MODE$( [ "$FINISH" = yes ] && printf '  FINISH of run %s' "$FSTAMP")  reach=$REACH  run=$STAMP  self-sha256=$(sha "$0") (compare it yourself)"
if [ "$MODE" = apply ] && [ "$(id -u)" != 0 ]; then refuse "--apply must run as root (sudo bash $0 ... --apply)"; fi
[ "$MODE" = dry ] && say "DRY: guards are evaluated; commands are printed, not run."

say ""; say "-- G - GUARDS -------------------------------------------------------------"
PIN_FAIL=no
@@PINS@@
if [ "$PIN_FAIL" = yes ]; then
  if [ "$MODE" = apply ]; then refuse "G1: /opt does not carry the pinned witness code — lay the machine relay of gate2-witness first"; fi
  say "  [dry] G1 fails today: the machine relay has not laid this code. --apply would refuse here; the rest is evaluated anyway."
fi
if [ "$FINISH" = no ]; then
  [ "$(sha "$SERVED_DECL")" = "$SERVED_DECL_SHA" ] || refuse "G2: the live declaration is not S30 ($SERVED_DECL_SHA) — run this BEFORE S31"; g "G2 live declaration S30"
else
  say "  G2 not applied by --finish: the deploy ran before S31; the served declaration is now $(sha "$SERVED_DECL") — its subject and homes are re-checked below"
fi
DECL_UID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["subjects"][0]["peerUid"])' "$SERVED_DECL" 2>/dev/null)
SUBJ_LINE=$(getent passwd "${DECL_UID:-none}")
{ [ -n "$DECL_UID" ] && [ -n "$SUBJ_LINE" ] && [ "$(sha_s "$SUBJ_LINE")" = "$SUBJ_PASSWD_SHA" ]; } || refuse "G3: the served subject (uid ${DECL_UID:-unread}) is '${SUBJ_LINE:-no passwd entry}', not the measured line (sha $SUBJ_PASSWD_SHA)"
SUBJ=${SUBJ_LINE%%:*}; g "G3 served subject = the measured passwd line: $SUBJ_LINE"
DECL_HOMES=$(decl_homes "$SERVED_DECL")
{ [ -n "$DECL_HOMES" ] && [ "$(sha_s "$DECL_HOMES")" = "$HOMES_WANT_SHA" ]; } || refuse "G4: the served frame's /home regions are '$DECL_HOMES', not the measured pair (sha $HOMES_WANT_SHA)"
HOMES=""
for hc in $DECL_HOMES; do h=${hc%%=*}; { [ -d "$h" ] && [ ! -L "$h" ]; } || refuse "G4: $h is not a directory (or is a link)"; HOMES="$HOMES $h"; done
HOMES=${HOMES# }
g "G4 homes = the served c1/c5 regions, as measured, both directories: $HOMES"
[ "$(getent passwd mica-bridge)" = "$BRIDGE_PASSWD" ] || refuse "G5: mica-bridge is not '$BRIDGE_PASSWD'"; g "G5 mica-bridge"
SUBJ_GROUPS=$(id -nG "$SUBJ" 2>/dev/null); { [ -n "$SUBJ" ] && [ -n "$SUBJ_GROUPS" ]; } || refuse "G6: could not read the subject's groups — a guard never passes empty"
case " $SUBJ_GROUPS " in *" mica-sight "*|*" mica-sight-drops "*) refuse "G6: the subject is already in a witness group";; esac; g "G6 the subject is in neither witness group ($SUBJ_GROUPS)"
if [ "$FINISH" = no ]; then
for x in "$SIGHT" "$UNIT_DST" "$DROPIN"; do { [ ! -e "$x" ] && [ ! -L "$x" ]; } || refuse "G7: $x exists — installed already; run witness-sight-remove.sh first (it retires, never deletes)"; done
{ ! getent passwd mica-sight >/dev/null && ! getent group mica-sight >/dev/null && ! getent group mica-sight-drops >/dev/null; } || refuse "G7: user or group mica-sight / mica-sight-drops exists already"
g "G7 nothing of the witness's seeing half exists yet"
[ "$(ls -A "$DROPIN_DIR" | paste -sd' ')" = "$DROPIN_DIR_WANT" ] && [ "$(sha "$DROPIN_DIR/alerter.conf")" = "$ALERTER_SHA" ] || refuse "G8: $DROPIN_DIR is not exactly alerter.conf $ALERTER_SHA"; g "G8 the bridge's drop-ins: alerter.conf only"
NDR=$(systemctl show -p Id -p NeedDaemonReload '*.service' | paste -sd' ' | tr ' ' '\n' | grep -c '^NeedDaemonReload=yes$')
[ "$NDR" = 0 ] || refuse "G9: $NDR loaded service(s) report NeedDaemonReload=yes — a daemon-reload would also apply someone else's pending edit"; g "G9 no loaded service needs a daemon-reload"
else
  # ── --finish: G7 READS what exists — each thing the run made must be exactly what it made; anything else refuses ──
  say ""; say "-- F - WHAT RUN $FSTAMP LEFT, READ AGAINST ITS OWN RECORD (nothing is re-created) ------------"
  REC=$SAVE/$FSTAMP/deploy.record
  ex() { if [ "$2" = "$1" ]; then g "$3: $2"; else refuse "$3 is '$2', not '$1'"; fi; }
  if [ "$MODE" = apply ]; then
    { [ -d "$SAVE/$FSTAMP" ] && [ ! -L "$SAVE/$FSTAMP" ] && [ "$(stat -c '%U %a' "$SAVE/$FSTAMP")" = "root 700" ]; } || refuse "F1: no root-owned 0700 save dir $SAVE/$FSTAMP"
    { [ -f "$REC" ] && [ ! -L "$REC" ] && [ "$(stat -c %U "$REC")" = root ] && [ "$(recv stamp)" = "$FSTAMP" ]; } || refuse "F1: $REC is not that run's record (root's, naming stamp $FSTAMP)"
    [ "$(recv reach)" = "$REACH" ] || refuse "F1: the record says reach=$(recv reach), you said reach=$REACH — state the reach the run was started with"
    { [ "$(recv homes_decl)" = "$DECL_HOMES" ] && [ "$(recv homes)" = "$HOMES" ]; } || refuse "F1: the record's homes are not the served pair the guards just measured"
    recorded "step=unit-started" || refuse "F1: the run never reached its unit — not a run to finish; the remover undoes it"
    KNOWN=' group-mica-sight-drops user-mica-sight mica-sight-in-group mica-bridge-in-group dirs alerter-backup dropin unit daemon-reload unit-started unit-restarted '
    for st in $(sed -n 's/^step=//p' "$REC"); do
      case "$st" in
        reach:*) case " $HOMES " in *" ${st#reach:} "*) ;; *) refuse "F1: the record grants reach on '${st#reach:}', not one of its homes";; esac ;;
        *) case "$KNOWN" in *" $st "*) ;; *) refuse "F1: the record names a step this script never writes: '$st'";; esac ;;
      esac
    done
    g "F1 the run record: $(wc -l < "$REC") lines, stamp $FSTAMP, reach=$REACH (= yours), the measured homes, the unit reached"
    ex "$(recv passwd_mica_sight)" "$(getent passwd mica-sight)" "F2 mica-sight (= the recorded passwd line)"
  else
    say "  [dry] the run record $REC is root's (0700 dir): read at --apply — its stamp, reach (= yours: $REACH), homes,"
    say "  [dry] that the run reached its unit, every step known, and mica-sight = its recorded passwd line ('$(getent passwd mica-sight)' now)."
  fi
  ex "mica-sight mica-sight-drops" "$(id -nG mica-sight 2>/dev/null)" "F2 mica-sight's groups"
  case ",$(getent group mica-sight-drops | cut -d: -f4)," in *,mica-bridge,*) g "F2 mica-bridge is in mica-sight-drops";; *) refuse "F2: mica-bridge is not in mica-sight-drops";; esac
  for x in "$SIGHT" "$SIGHT/intake" "$SIGHT/state" "$UNIT_DST" "$DROPIN"; do [ ! -L "$x" ] || refuse "F3: $x is a link"; done
  ex "755 mica-sight:mica-sight" "$(stat -c '%a %U:%G' "$SIGHT" 2>/dev/null)" "F3 $SIGHT"
  ex "3730 mica-sight:mica-sight-drops" "$(stat -c '%a %U:%G' "$SIGHT/intake" 2>/dev/null)" "F3 $SIGHT/intake"
  ex "700 mica-sight:mica-sight" "$(stat -c '%a %U:%G' "$SIGHT/state" 2>/dev/null)" "F3 $SIGHT/state"
  ex "alerter.conf witness-sight.conf" "$(ls -A "$DROPIN_DIR" | paste -sd' ')" "F4 the bridge's drop-ins"
  ex "$ALERTER_SHA" "$(sha "$DROPIN_DIR/alerter.conf")" "F4 alerter.conf"
  ex "$DROPIN_SHA" "$(sha "$DROPIN")" "F4 witness-sight.conf"
  ex "$UNIT_SHA" "$(sha "$UNIT_DST")" "F5 the installed unit (the committed one)"
  ex "enabled" "$(systemctl is-enabled mica-witness-sight 2>/dev/null)" "F5 the unit"
  case "$REACH" in traverse) PERM=--x;; list) PERM=r-x;; *) PERM=;; esac
  TODO=""
  for h in $HOMES; do
    ent=$(getfacl -cpE "$h" 2>/dev/null | grep '^user:mica-sight:')
    if [ -z "$ent" ]; then
      [ -n "$PERM" ] && TODO="$TODO $h"
      g "F7 $h: no mica-sight entry yet$( [ -n "$PERM" ] && printf ' — %s to grant' "$PERM")"
    elif [ -n "$PERM" ] && [ "$ent" = "user:mica-sight:$PERM" ] && { [ "$MODE" = dry ] || { recorded "step=reach:$h" && recorded "acl_saved=$h"; }; }; then
      g "F7 $h: already granted by this run ($ent) — nothing to do"
    else refuse "F7: $h carries '$ent', which this run did not record as its grant of '${PERM:-nothing}'"; fi
  done
  # F6 · THE RUNNING WITNESS'S METHOD. A relay lays new code but restarts nothing; if the running invocation still
  # names an older method, the finish restarts it onto the relayed code (recorded) — it then retires its book, begun
  # under the older method, UNALTERED, and begins a new one naming METHOD_WANT (seeingd: one method per book).
  INV=$(systemctl show -p InvocationID --value mica-witness-sight 2>/dev/null)
  RUNM=$( [ -n "$INV" ] && journalctl _SYSTEMD_INVOCATION_ID="$INV" -o cat --no-pager 2>/dev/null | grep -o 'method [0-9a-f]\{64\}' | tail -1 | cut -d' ' -f2)
  [ -n "$RUNM" ] || refuse "F6: the running invocation of mica-witness-sight names no method in its journal"
  if [ "$RUNM" = "$METHOD_WANT" ]; then
    say "  F6 the running witness names method $RUNM (= pinned): no restart; the unit gate, re-taken:"
    unit_gate
  else
    say "  F6 the running witness names method $RUNM — the relayed code is method $METHOD_WANT: it is restarted onto"
    say "     the relayed code; it then retires its book (begun under $RUNM) UNALTERED and begins one naming $METHOD_WANT"
    if [ "$MODE" = apply ]; then
      rec_once "step=unit-restarted"
      PHASE=restart
      act systemctl restart mica-witness-sight.service; done_ unit-restarted
      unit_gate
      R=$(find "$SIGHT" -maxdepth 1 -type f -name "book-of-effects.jsonl.retired-method-${RUNM:0:16}-*" | LC_ALL=C sort | tail -1)   # find, not a glob: set -f
      [ -n "$R" ] || refuse "after the restart no book retired under method $RUNM is beside the new one"
      g "the book begun under $RUNM is retired unaltered as $R ($(wc -l < "$R") lines); the new book's first line names it"
    else
      say "  \$ systemctl restart mica-witness-sight.service   [dry; then the unit gate, re-taken, must find method $METHOD_WANT and a new book]"
    fi
  fi

  say ""; say "-- 5 - REACH ($REACH), FINISHING RUN $FSTAMP ------------------------------------"
  rec "finish=$STAMP"
  PHASE=reach
  for h in $TODO; do reach_home "$h"; done
  [ -n "$TODO" ] || say "  nothing to grant"
  say ""; say "-- 6 - READ-BACKS ---------------------------------------------------------"
  readbacks
  say ""
  undo_line
  if [ "$GAP" = yes ]; then say "done WITH A GAP: --finish of run $FSTAMP, mode=$MODE, pass $STAMP (named above)"; exit 3; fi
  say "done: --finish of run $FSTAMP, mode=$MODE, pass $STAMP — recorded in that run's record."
  exit 0
fi

say ""; say "-- R - THE RUN RECORD ------------------------------------------------------"
REC=$SAVE/$STAMP/deploy.record
say "  \$ install -d -m 0700 -o root -g root $SAVE/$STAMP; record: $REC (root 0600; each step recorded BEFORE it is taken)"
if [ "$MODE" = apply ]; then
  install -d -m 0700 -o root -g root "$SAVE/$STAMP" || refuse "could not create $SAVE/$STAMP"
  ( umask 077; : > "$REC" ) || refuse "could not create $REC"
fi
rec "stamp=$STAMP"; rec "deploy_sha256=$(sha "$0")"; rec "reach=$REACH"; rec "homes=$HOMES"; rec "homes_decl=$DECL_HOMES"

say ""; say "-- 1 - GROUPS AND THE WITNESS'S UID ---------------------------------------"
PHASE=groups
rec "step=group-mica-sight-drops"; act groupadd --system mica-sight-drops; done_ group-mica-sight-drops
rec "step=user-mica-sight"; act useradd --system --user-group --no-create-home --home-dir "$SIGHT" --shell /usr/sbin/nologin mica-sight; done_ user-mica-sight
[ "$MODE" = apply ] && rec "passwd_mica_sight=$(getent passwd mica-sight)"
rec "step=mica-sight-in-group"; act usermod -aG mica-sight-drops mica-sight; done_ mica-sight-in-group
rec "step=mica-bridge-in-group"; act usermod -aG mica-sight-drops mica-bridge; done_ mica-bridge-in-group
if [ "$MODE" = apply ]; then
  SUBJ_GROUPS=$(id -nG "$SUBJ"); [ -n "$SUBJ_GROUPS" ] || refuse "G6 after step 1: could not read the subject's groups"
  case " $SUBJ_GROUPS " in *" mica-sight "*|*" mica-sight-drops "*) refuse "G6 after step 1: the subject is in a witness group";; esac
  g "the subject is still in neither witness group; mica-sight: $(id -nG mica-sight)"
fi

say ""; say "-- 2 - THE WITNESS'S DIRECTORIES ------------------------------------------"
PHASE=dirs
rec "step=dirs"
act install -d -m 0755 -o mica-sight -g mica-sight "$SIGHT"; done_ dir-sight
act install -d -m 3730 -o mica-sight -g mica-sight-drops "$SIGHT/intake"; done_ dir-intake
act install -d -m 0700 -o mica-sight -g mica-sight "$SIGHT/state"; done_ dir-state

say ""; say "-- 3 - THE BRIDGE DROP-IN -------------------------------------------------"
PHASE=dropin
rec "step=alerter-backup"; act cp -a "$DROPIN_DIR/alerter.conf" "$SAVE/$STAMP/alerter.conf.bak"
rec "step=dropin"
say "  \$ write $DROPIN (root 0644): [Service] ReadWritePaths=$SIGHT/intake"
if [ "$MODE" = apply ]; then
  { printf '[Service]\nReadWritePaths=%s/intake\n' "$SIGHT" > "$DROPIN" && chmod 0644 "$DROPIN"; } || refuse "could not write $DROPIN"
  [ "$(sha "$DROPIN")" = "$DROPIN_SHA" ] || refuse "the drop-in read back is not $DROPIN_SHA"
  done_ dropin
fi

say ""; say "-- 4 - THE UNIT - INSTALLED, STARTED, GATED ------------------------------"
PHASE=unit
rec "step=unit"
say "  \$ install -m 0644 -o root -g root $UNIT_SRC $UNIT_DST"
if [ "$MODE" = apply ]; then
  install -m 0644 -o root -g root "$UNIT_SRC" "$UNIT_DST" || refuse "could not install $UNIT_DST"
  [ "$(sha "$UNIT_DST")" = "$UNIT_SHA" ] || refuse "the unit read back is not the committed one ($UNIT_SHA)"
  done_ unit
fi
rec "step=daemon-reload"; act systemctl daemon-reload
rec "step=unit-started"; act systemctl enable --now mica-witness-sight.service; done_ unit-started
if [ "$MODE" = apply ]; then unit_gate; else say "  [dry] the unit gate: a bounded poll (<= ${GATE_WAIT}s) for: active, this invocation naming method $METHOD_WANT, the book's first line the boundary naming it"; fi

say ""; say "-- 5 - REACH ($REACH) -----------------------------------------------------"
case "$REACH" in traverse) PERM=--x;; list) PERM=r-x;; *) PERM=;; esac
PHASE=reach
for h in $HOMES; do
  say "  $h: $(stat -c '%a %U:%G' "$h") · ACL now: $(acl "$h")"
  [ -n "$PERM" ] && reach_home "$h"
done
[ -z "$PERM" ] && say "  no grant: targets under the homes read UNOBSERVABLE (the audit recommends --reach)"

say ""; say "-- 6 - READ-BACKS ---------------------------------------------------------"
readbacks
say ""
undo_line
if [ "$GAP" = yes ]; then say "done WITH A GAP: mode=$MODE run=$STAMP (named above)"; exit 3; fi
say "done: mode=$MODE run=$STAMP. Next: the bridge relay (its restart applies the group and the drop-in), then S31."
'''

REMOVE = r'''#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
# witness-sight-remove.sh — the EXACT UNDO of the phase-R witness-sight-deploy.sh (own-home-v4). THE ARBITER'S HAND ONLY.
# Generated by deploy/gen-deploy.py (committed).
#
#   bash witness-sight-remove.sh --stamp <deploy run stamp> [--reach-was-granted]          DRY (default)
#   sudo bash witness-sight-remove.sh --apply --stamp <STAMP> [--reach-was-granted]
#
# THE RUN RECORD DECIDES: the deploy recorded each step BEFORE taking it (root 0600, $SAVE/<STAMP>/deploy.record).
# This undoes exactly those steps, newest first, and checks EVERY value it declares before changing anything: the
# record's own stamp and owner; its homes against the measured pair (HOMES_WANT_SHA); every step it names is one this
# remover knows how to undo; the unit's and the drop-in's bytes (pinned); the witness's directory and uid; the
# bridge's passwd line; each home's ACL against the copy the deploy saved. It declares nothing it does not check. --reach-was-granted is HONOURED: it
# must agree with the record (the deploy prints it in its undo line exactly when it granted reach).
# THE ACL IS RESTORED, NOT EDITED: each home gets back the whole ACL the deploy saved (setfacl --restore) — and
# only if nothing but the witness's own entry (and the mask it recalculated) changed since; read back after.
#
# BEFORE THIS: relay a declaration WITHOUT paths.witnessIntake / paths.witnessBook; the bridge reads the intake
# path per act, so from that reload on it drops nothing.
# NOTHING IS DELETED: the unit file and the drop-in are moved into $SAVE/<STAMP>/, /var/lib/mica/witness-sight is
# moved aside with a dated suffix (the book stays readable); group MEMBERSHIPS are reverted; the user and groups are
# kept, locked. A step the deploy never began is not touched — and must not be present.
# NO SIGNAL TRAPS (S205). Re-running after a refusal is safe: a step already undone reads "not present".
# EXIT: 0 done · 1 refused, nothing changed · 4 refused after changes began.
# ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
''' + COMMON + REMOVE_MEASURED + r'''
MODE=dry; DSTAMP=""; FLAG_REACH=no
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) MODE=apply ;;
    --stamp) DSTAMP="${2:-}"; shift ;;
    --reach-was-granted) FLAG_REACH=yes ;;
    *) echo "usage: $0 [--apply] --stamp <STAMP> [--reach-was-granted]" >&2; exit 2 ;;
  esac; shift
done
case "$DSTAMP" in [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;; *) echo "usage: --stamp <the deploy run's stamp, YYYYMMDDTHHMMSSZ>" >&2; exit 2 ;; esac
B=$SAVE/$DSTAMP; REC=$B/deploy.record
PHASE=pre
refuse() { say "REFUSED (phase $PHASE): $*"; [ "$PHASE" = pre ] && { say "Nothing was changed."; exit 1; }; say "Re-run after reading the lines above; every act so far moved or restored, never deleted."; exit 4; }
need() { if [ "$MODE" = apply ]; then refuse "$1"; else say "  [dry] --apply would refuse here: $1"; fi; }
act() { say "  \$ $*"; [ "$MODE" = apply ] || return 0; "$@" || refuse "failed: $*"; }
recv() { grep -m1 "^$1=" "$REC" 2>/dev/null | cut -d= -f2-; }
say "witness-sight-remove.sh (phase R)  mode=$MODE  deploy-run=$DSTAMP  reach-was-granted=$FLAG_REACH  run=$STAMP  self-sha256=$(sha "$0")"
if [ "$MODE" = apply ] && [ "$(id -u)" != 0 ]; then refuse "--apply must run as root"; fi

say ""; say "-- G - GUARDS (nothing changes until every one has passed) --------------"
if [ "$MODE" = apply ]; then
  { [ -d "$B" ] && [ ! -L "$B" ] && [ "$(stat -c '%U %a' "$B")" = "root 700" ]; } || refuse "R1: no root-owned 0700 save dir for deploy run $DSTAMP at $B"
  { [ -f "$REC" ] && [ ! -L "$REC" ] && [ "$(stat -c %U "$REC")" = root ] && [ "$(recv stamp)" = "$DSTAMP" ]; } || refuse "R1: $REC is not this run's record (root's, naming stamp $DSTAMP)"
  has() { grep -qx "step=$1" "$REC"; }
  REC_REACH=$(recv reach); REC_HOMES=$(recv homes); REC_HOMES_DECL=$(recv homes_decl)
  [ -n "$REC_REACH" ] || refuse "R1: the record names no reach"
  { [ -n "$REC_HOMES_DECL" ] && [ "$(sha_s "$REC_HOMES_DECL")" = "$HOMES_WANT_SHA" ]; } || refuse "R1: the record's homes ('$REC_HOMES_DECL') are not the measured pair (sha $HOMES_WANT_SHA)"
  DH=""; for hc in $REC_HOMES_DECL; do DH="$DH ${hc%%=*}"; done
  [ "${DH# }" = "$REC_HOMES" ] || refuse "R1: the record's homes '$REC_HOMES' are not the paths of its served pairs '${DH# }'"
  KNOWN=' group-mica-sight-drops user-mica-sight mica-sight-in-group mica-bridge-in-group dirs alerter-backup dropin unit daemon-reload unit-started unit-restarted '
  for st in $(sed -n 's/^step=//p' "$REC"); do
    case "$st" in
      reach:*) case " $REC_HOMES " in *" ${st#reach:} "*) ;; *) refuse "R1: the record grants reach on '${st#reach:}', not one of its homes";; esac ;;
      *) case "$KNOWN" in *" $st "*) ;; *) refuse "R1: the record names a step this remover does not know how to undo: '$st'";; esac ;;
    esac
  done
  g "R1 the run record: $(wc -l < "$REC") lines, stamp $DSTAMP, reach=$REC_REACH, homes = the measured pair: $REC_HOMES; every step known"
else
  say "  [dry] the run record $REC sits in a root 0700 directory: it is read at --apply. This dry run assumes"
  say "  [dry] every step was taken, with reach as the flag says, and evaluates every live check the operator's uid can."
  has() { case "$1" in reach:*) [ "$FLAG_REACH" = yes ];; *) return 0;; esac; }
  REC_REACH=$([ "$FLAG_REACH" = yes ] && echo granted || echo none)
  DH=$(decl_homes "$SERVED_DECL")
  [ -n "$DH" ] && [ "$(sha_s "$DH")" = "$HOMES_WANT_SHA" ] && g "R1 [dry] the served frame's homes = the measured pair (--apply checks the record's)" || need "R1: the served frame's homes '$DH' are not the measured pair (sha $HOMES_WANT_SHA)"
  REC_HOMES=""; for hc in $DH; do REC_HOMES="$REC_HOMES ${hc%%=*}"; done; REC_HOMES=${REC_HOMES# }
fi
# R2 · the flag is honoured: it must agree with what the run recorded
case "$REC_REACH:$FLAG_REACH" in none:no|traverse:yes|list:yes|granted:yes) g "R2 --reach-was-granted=$FLAG_REACH agrees with the record (reach=$REC_REACH)";;
  *) need "R2: the record says reach=$REC_REACH but --reach-was-granted is '$FLAG_REACH' — pass exactly the undo line the deploy printed";; esac
# R3 · the unit: the committed bytes if the deploy began that step; absent if it did not
if [ -e "$UNIT_DST" ] || [ -L "$UNIT_DST" ]; then
  if has unit; then { [ -f "$UNIT_DST" ] && [ ! -L "$UNIT_DST" ] && [ "$(sha "$UNIT_DST")" = "$UNIT_SHA" ]; } && g "R3 $UNIT_DST = the committed unit" || need "R3: $UNIT_DST is not the committed unit ($UNIT_SHA)"
  else need "R3: $UNIT_DST exists but this run never installed it"; fi
else say "  R3 $UNIT_DST not present (nothing to undo there)"; fi
# R4 · the drop-in: exactly what the deploy wrote
if [ -e "$DROPIN" ] || [ -L "$DROPIN" ]; then
  if has dropin; then { [ -f "$DROPIN" ] && [ ! -L "$DROPIN" ] && [ "$(sha "$DROPIN")" = "$DROPIN_SHA" ]; } && g "R4 $DROPIN = the deployed drop-in" || need "R4: $DROPIN is not the deployed drop-in ($DROPIN_SHA)"
  else need "R4: $DROPIN exists but this run never wrote it"; fi
else say "  R4 $DROPIN not present"; fi
# R5 · the witness's directory: as the deploy made it
if [ -e "$SIGHT" ] || [ -L "$SIGHT" ]; then
  if has dirs; then { [ -d "$SIGHT" ] && [ ! -L "$SIGHT" ] && [ "$(stat -c '%U %a' "$SIGHT")" = "mica-sight 755" ]; } && g "R5 $SIGHT is mica-sight's, 0755" || need "R5: $SIGHT is not mica-sight's 0755 directory"
  else need "R5: $SIGHT exists but this run never made it"; fi
else say "  R5 $SIGHT not present"; fi
# R6 · the witness's uid: the passwd line the deploy recorded
if has user-mica-sight; then
  if [ "$MODE" = apply ]; then
    PW=$(getent passwd mica-sight); { [ -n "$PW" ] && [ "$PW" = "$(recv passwd_mica_sight)" ]; } && g "R6 mica-sight = the recorded passwd line" || need "R6: mica-sight is '${PW:-absent}', not the line the deploy recorded"
  else say "  R6 [dry] mica-sight now: '$(getent passwd mica-sight)' — compared at --apply with the recorded line"; fi
fi
# R7 · the bridge's uid: the measured passwd line
if has mica-bridge-in-group; then [ "$(getent passwd mica-bridge)" = "$BRIDGE_PASSWD" ] && g "R7 mica-bridge = '$BRIDGE_PASSWD'" || need "R7: mica-bridge is not '$BRIDGE_PASSWD'"; fi
# R8 · each home's ACL: restorable from the saved copy, and nothing but the witness's entry changed since
entries() { grep -v -e '^#' -e '^$' -e '^user:mica-sight:' -e '^mask::'; }
for h in $REC_HOMES; do
  F=$(aclfile "$B" "$h")
  if [ "$MODE" = apply ] && grep -qx "acl_saved=$h" "$REC"; then
    { [ -f "$F" ] && [ ! -L "$F" ] && [ "$(stat -c %U "$F")" = root ] && [ "$(head -1 "$F")" = "# file: $h" ]; } || need "R8: the saved ACL $F is missing or not $h's"
    [ "$(sed -n 's/^# owner: //p' "$F") $(sed -n 's/^# group: //p' "$F")" = "$(stat -c '%U %G' "$h")" ] || need "R8: $h's owner/group moved since the deploy saved its ACL"
    [ "$(getfacl -cpE "$h" | entries)" = "$(entries < "$F")" ] && g "R8 $h: ACL = the saved copy + only the witness's entry" || need "R8: $h's ACL changed beyond the witness's entry since the deploy — restore by hand, after reading both"
  elif getfacl -cpE "$h" 2>/dev/null | grep -q '^user:mica-sight:'; then
    if [ "$MODE" = apply ]; then need "R8: $h carries a mica-sight entry but this run saved no ACL for it"
    else say "  R8 [dry] $h carries a mica-sight entry: --apply restores it from the saved copy"; fi
  else say "  R8 $h: no mica-sight entry$( [ "$MODE" = apply ] || printf ' (dry: --apply checks the saved copy)')"; fi
done

say ""; say "-- 1 - STOP AND DISABLE; THE UNIT MOVED INTO THE SAVE DIR -----------------"
has alerter-backup && say "  recorded alerter-backup: a backup the deploy took ($B/alerter.conf.bak) — nothing to undo; kept"
has daemon-reload && say "  recorded daemon-reload: undone by this remover's own daemon-reload after the unit moves"
has unit-restarted && say "  recorded unit-restarted (a --finish onto relayed code): nothing to undo — the unit is stopped below; any retired book moves with $SIGHT"
PHASE=unit
if [ -f "$UNIT_DST" ]; then
  act systemctl disable --now mica-witness-sight.service
  act mv "$UNIT_DST" "$B/mica-witness-sight.service.retired-$STAMP"
  act systemctl daemon-reload
else say "  not present"; fi

say ""; say "-- 2 - REACH: EACH HOME'S ACL RESTORED FROM THE SAVED COPY ---------------"
PHASE=reach
for h in $REC_HOMES; do
  F=$(aclfile "$B" "$h")
  if [ "$MODE" = apply ] && grep -qx "acl_saved=$h" "$REC"; then
    say "  \$ (cd / && setfacl --restore=$F)"
    ( cd / && setfacl --restore="$F" ) || refuse "failed: setfacl --restore=$F"
    [ "$(getfacl -cpE "$h" | grep -v -e '^#' -e '^$')" = "$(grep -v -e '^#' -e '^$' "$F")" ] || refuse "$h's ACL read back is not the saved copy"
    g "$h: ACL restored and read back = the saved copy ($(acl "$h"))"
  elif [ "$MODE" = dry ] && [ "$FLAG_REACH" = yes ]; then say "  \$ (cd / && setfacl --restore=$F)   [dry]"
  else say "  $h: no ACL was saved — none to restore"; fi
done

say ""; say "-- 3 - THE DROP-IN MOVED INTO THE SAVE DIR (effective at the bridge's next restart) --"
PHASE=dropin
if [ -f "$DROPIN" ]; then act mv "$DROPIN" "$B/witness-sight.conf.retired-$STAMP"; else say "  not present"; fi

say ""; say "-- 4 - GROUP MEMBERSHIPS REVERTED; USER AND GROUPS KEPT, LOCKED ----------"
PHASE=groups
member() { getent group mica-sight-drops | cut -d: -f4 | tr ',' '\n' | grep -qx "$1"; }
for u in mica-bridge mica-sight; do
  if has "$u-in-group" && member "$u"; then act gpasswd -d "$u" mica-sight-drops
  elif [ "$MODE" = dry ]; then say "  \$ gpasswd -d $u mica-sight-drops   [dry; today: $(member "$u" && echo member || echo not a member)]"
  else say "  $u: not a member of mica-sight-drops — nothing to undo"; fi
done
if has user-mica-sight && { [ "$MODE" = dry ] || getent passwd mica-sight >/dev/null; }; then act usermod -L mica-sight; fi
[ "$MODE" = apply ] && g "mica-bridge: $(id -nG mica-bridge) · mica-sight: $(id -nG mica-sight 2>/dev/null) (locked; kept)"

say ""; say "-- 5 - THE WITNESS'S DIRECTORY RETIRED (MOVED, NOT DELETED) --------------"
PHASE=dirs
if [ -d "$SIGHT" ] || [ "$MODE" = dry ]; then
  act mv "$SIGHT" "$SIGHT.retired-$STAMP"
  say "  the book stays readable at $SIGHT.retired-$STAMP/book-of-effects.jsonl"
else say "  not present"; fi
say ""; say "done: mode=$MODE run=$STAMP — KEPT: uid/groups mica-sight(-drops) locked, $SIGHT.retired-$STAMP, every backup under $B."
'''

# The walker every chmod of what13 goes through (audit 2026-10-11 12:51Z ③): each path is opened component by
# component with O_NOFOLLOW from "/"; the object reached is checked (device, inode, type, owner, group — saved, and
# checked again before every change); its mode is set through /proc/self/fd, on the inode the descriptor holds. A
# symlink anywhere on the way is refused, never followed; an entry swapped after the scan is skipped by name.
WALKER = r'''import hashlib, os, stat, sys
def die(code, msg):
    print("  " + msg); sys.exit(code)
def open_path(abspath):
    fd = os.open("/", os.O_PATH | os.O_DIRECTORY)
    parts = [p for p in abspath.split("/") if p]
    try:
        for i, p in enumerate(parts):
            nfd = os.open(p, os.O_PATH | os.O_NOFOLLOW | (os.O_DIRECTORY if i < len(parts) - 1 else 0), dir_fd=fd)
            os.close(fd); fd = nfd
        return fd
    except BaseException:
        os.close(fd); raise
def kind(m):
    return "d" if stat.S_ISDIR(m) else "f" if stat.S_ISREG(m) else "l" if stat.S_ISLNK(m) else "o"
def ident(st):
    """What makes an entry the SAME object: device, inode, type, owner and group. (An inode number the filesystem
    reuses for a NEW object of the same owner and group is not told apart: the stated ceiling — once group/other
    write is cleared, only that owner or root can make one there.)"""
    return (st.st_dev, st.st_ino, kind(st.st_mode), st.st_uid, st.st_gid)
def listsha(top, es):
    """The listing's sha, as `find TOP -xdev -printf '%y %m %P\\n' | LC_ALL=C sort | sha256sum` gives it."""
    lines = sorted(f"{k} {m:o} {os.path.relpath(p, top) if p != top else ''}" for p, k, m, _, _, _, _ in es)
    return hashlib.sha256("".join(l + "\n" for l in lines).encode()).hexdigest()
def setmode(fd, mode):
    os.chmod(f"/proc/self/fd/{fd}", mode)  # the inode the fd holds: no path is resolved again
    if stat.S_IMODE(os.fstat(fd).st_mode) != mode: raise OSError("mode did not take")
def scan(top):
    """Every entry under top (top included), each opened without following anything: (abspath, kind, mode, dev, ino, uid, gid)."""
    out, errs = [], []
    for d, dirs, files in os.walk(top, onerror=errs.append, followlinks=False):
        for n in [None] + dirs + files:
            if n is None and d != top: continue
            p = d if n is None else os.path.join(d, n)
            fd = open_path(p)
            try: st = os.fstat(fd)
            finally: os.close(fd)
            out.append((p, kind(st.st_mode), stat.S_IMODE(st.st_mode), st.st_dev, st.st_ino, st.st_uid, st.st_gid))
    if errs: die(1, f"REFUSED (nothing changed): {len(errs)} entr(y/ies) under {top} could not be listed")
    return out
def main(cmd):
    if cmd == "scan":  # scan TOP -> the measured facts, one per line
        top = sys.argv[2]; es = scan(top); tdev = es[0][3]
        print(f"entries={len(es)}")
        print(f"writable={sum(1 for e in es if e[1] in 'df' and e[2] & 0o022)}")
        print(f"symlinks={sum(1 for e in es if e[1] == 'l')}")
        print(f"other={sum(1 for e in es if e[1] == 'o')}")
        print(f"foreign_dev={sum(1 for e in es if e[3] != tdev)}")
        print(f"nonroot={sum(1 for e in es if e[5] != 0)}")
        print(f"badnames={sum(1 for e in es if chr(9) in e[0] or chr(10) in e[0])}")
        print("listsha=" + listsha(top, es))
        return 0
    elif cmd in ("save-and-clear", "dry-clear"):  # TOP SAVEFILE CLEARBITS(octal) ENTRIES LISTSHA: save every mode, then clear
        top, save, bits, want_n, want_sha = sys.argv[2], sys.argv[3], int(sys.argv[4], 8), int(sys.argv[5]), sys.argv[6]
        es = scan(top); tdev = es[0][3]
        # RE-PINNED HERE, by the scan this pass acts on (audit 2026-10-11 15:27Z): not only by the guard's earlier scan
        if len(es) != want_n or listsha(top, es) != want_sha:
            die(1, f"REFUSED (nothing changed): {top} is no longer as measured ({len(es)} entries, listing {listsha(top, es)[:16]}…; measured {want_n}, {want_sha[:16]}…)")
        if any(e[1] not in "df" or e[3] != tdev for e in es): die(1, "REFUSED (nothing changed): a link, a special file or another filesystem under " + top)
        if any(chr(9) in e[0] or chr(10) in e[0] for e in es): die(1, "REFUSED (nothing changed): a name with a tab or newline under " + top)
        todo = [e for e in es if e[2] & bits]
        if cmd == "dry-clear":
            print(f"  [dry] re-pinned: {len(es)} entries, listing = measured; would save {len(es)} modes, then clear {bits:o} on {len(todo)} entr(y/ies), each through the walker"); return 0
        with open(save, "x") as f:
            for p, k, m, dev, ino, uid, gid in es: f.write(f"{m:o}\t{dev}\t{ino}\t{k}\t{uid}:{gid}\t{p}\n")
            f.flush(); os.fsync(f.fileno())
        print(f"  saved {len(es)} modes to {save}")
        moved = 0
        for p, k, m, dev, ino, uid, gid in todo:
            try:
                fd = open_path(p)
            except OSError as e:
                moved += 1; print(f"  SKIPPED (moved since the scan, errno {e.errno}): {p}"); continue
            try:
                st = os.fstat(fd)
                if ident(st) != (dev, ino, k, uid, gid): moved += 1; print(f"  SKIPPED (another object since the scan): {p}"); continue
                setmode(fd, m & ~bits)
            finally: os.close(fd)
        print(f"  cleared {bits:o} on {len(todo) - moved} entr(y/ies); skipped {moved}")
        return 4 if moved else 0
    elif cmd == "top-clear":  # DIR SAVEFILE CLEARBITS WANTMODE: the directory itself only, its mode appended to SAVEFILE first
        top, save, bits, want_mode = sys.argv[2], sys.argv[3], int(sys.argv[4], 8), int(sys.argv[5], 8)
        fd = open_path(top)
        try:
            st = os.fstat(fd)
            if kind(st.st_mode) != "d": die(1, f"REFUSED (nothing changed here): {top} is not a directory")
            m = stat.S_IMODE(st.st_mode)
            if m != want_mode: die(1, f"REFUSED (nothing changed here): {top} is mode {m:o}, measured {want_mode:o}")
            with open(save, "a") as f:
                f.write(f"{m:o}\t{st.st_dev}\t{st.st_ino}\td\t{st.st_uid}:{st.st_gid}\t{top}\n"); f.flush(); os.fsync(f.fileno())
            setmode(fd, m & ~bits)
            print(f"  {top}: {m:o} -> {m & ~bits:o} (the old mode saved)")
        finally: os.close(fd)
        return 0
    elif cmd == "restore":  # SAVEFILE -> every saved mode back, only on the saved object (ident), reached without a link
        bad = done = same = 0
        for line in open(sys.argv[2]):
            m, dev, ino, k, owner, p = line.rstrip("\n").split("\t", 5)
            uid, gid = owner.split(":")
            try:
                fd = open_path(p)
            except OSError as e:
                bad += 1; print(f"  NOT RESTORED (not reachable without following a link, errno {e.errno}): {p}"); continue
            try:
                st = os.fstat(fd)
                if ident(st) != (int(dev), int(ino), k, int(uid), int(gid)): bad += 1; print(f"  NOT RESTORED (not the saved object): {p}"); continue
                if stat.S_IMODE(st.st_mode) == int(m, 8): same += 1; continue
                setmode(fd, int(m, 8)); done += 1
            finally: os.close(fd)
        print(f"  restored {done}, already as saved {same}, NOT restored {bad}")
        return 4 if bad else 0
    die(2, "walker: unknown command")
    return 2
try:
    sys.exit(main(sys.argv[1]))
except SystemExit:
    raise
except BaseException as e:  # a fault is never read as "refused, nothing changed" (exit 1): it may come mid-pass
    print(f"  WALKER FAULT ({type(e).__name__}: {e})"); sys.exit(4)
'''

WHAT13 = r'''#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
# what13-ilas-devtree-hygiene.sh — box hygiene, SEPARATE from the witness deploy (audit 2026-10-11 09:32Z; the
# chmods were folded out of the deploy). Generated by deploy/gen-deploy.py (committed); THE ARBITER'S HAND ONLY;
# own-home-v4 standard.
#
#   bash what13-ilas-devtree-hygiene.sh                                   DRY (default): every guard, nothing changed
#   sudo bash what13-ilas-devtree-hygiene.sh --apply [--ilas] [--dev-trees]
#   sudo bash what13-ilas-devtree-hygiene.sh --undo --stamp <STAMP>         the exact undo of one --apply run
#
# WHAT: --ilas removes group/other write from every directory and file of /opt/ILAS; --dev-trees removes other
# read/traverse (o-rx) from the MICA/ILAS dev trees in the operator's home (the top directory of each) — NEVER
# ~/citadel, ~/.nvm, ~/.local (services run from them). At least one of --ilas / --dev-trees with --apply.
# EVERY GUARD RUNS BEFORE ANY CHANGE (exit 1, nothing changed): /opt/ILAS is exactly as measured (type, mode, owner;
# entry count; the list of every entry's type, mode and name, pinned as a sha); no link, special file or other
# filesystem under it; the operator's home is the measured one; each dev tree is a directory of its measured mode,
# the operator's, named by no unit.
# NO CHMOD FOLLOWS A LINK (audit 2026-10-11 12:51Z ③): every mode is set through a walker that opens each path
# component by component with O_NOFOLLOW and changes the INODE it holds; the undo changes a mode only on the very
# object that was saved (device, inode, type, owner, group) — a link planted later is never followed, it is named
# and left.
# Every entry's PREVIOUS mode is saved first; NOTHING is deleted. NO SIGNAL TRAPS (S205).
# EXIT: 0 done · 1 refused, nothing changed · 4 refused or incomplete after changes began.
# ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
''' + COMMON + r'''
# ── MEASURED (2026-10-11T13:1xZ, build seat, the operator's uid, read-only) ────────────────────────────────────────────
ILAS=/opt/ILAS
ILAS_WANT='directory 777 root:root'          # stat -c '%F %a %U:%G' /opt/ILAS
ILAS_ENTRIES=98                               # every entry, the top included; all root's; no link, no other fs
ILAS_WRITABLE=94                              # directories and files with group or other write
ILAS_LISTSHA=9d9b878c3781ea5adaac81502e4419953f5f88fb648a649fb8a41adc471e0740   # find /opt/ILAS -xdev -printf '%y %m %P\n' | LC_ALL=C sort | sha256sum
OP_HOME_SHA=20551977eaf27af64390e2b6f019bb1b8c44d5a5b68939cf7393a962ae797fab    # printf '%s' <the operator's home> | sha256sum
DEV_TREES='mica-machine=755 mica-machine.snap-20260827=775 mica-wt=755 citadel-wt=755 ILAS=775 ilas=755'   # in the operator's home
SAVE=/var/backups/mica-what13
# ───────────────────────────────────────────────────────────────────────────────────────────────────────────
walker() { python3 - "$@" <<'PY'
@@WALKER@@PY
}
MODE=dry; DO_ILAS=no; DO_DEV=no; USTAMP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) MODE=apply ;;
    --undo) MODE=undo ;;
    --stamp) USTAMP="${2:-}"; shift ;;
    --ilas) DO_ILAS=yes ;;
    --dev-trees) DO_DEV=yes ;;
    *) echo "usage: $0 [--apply [--ilas] [--dev-trees] | --undo --stamp <STAMP>]" >&2; exit 2 ;;
  esac; shift
done
PHASE=pre
refuse() { say "REFUSED (phase $PHASE): $*"; [ "$PHASE" = pre ] && { say "Nothing was changed."; exit 1; }; say "Read the lines above; every mode was saved first, nothing deleted."; exit 4; }
need() { if [ "$MODE" = dry ]; then say "  [dry] --apply would refuse here: $1"; else refuse "$1"; fi; }
say "what13-ilas-devtree-hygiene.sh  mode=$MODE  ilas=$DO_ILAS dev-trees=$DO_DEV  run=$STAMP  self-sha256=$(sha "$0")"
if [ "$MODE" != dry ] && [ "$(id -u)" != 0 ]; then refuse "--$MODE must run as root"; fi

if [ "$MODE" = undo ]; then
  case "$USTAMP" in [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;; *) refuse "--undo needs --stamp <the --apply run's stamp>";; esac
  U=$SAVE/$USTAMP
  { [ -d "$U" ] && [ ! -L "$U" ] && [ "$(stat -c '%U %a' "$U")" = "root 700" ]; } || refuse "no root-owned 0700 save dir $U"
  N=0
  for f in "$U/ilas-modes.tsv" "$U/dev-tree-modes.tsv"; do
    [ -e "$f" ] || continue
    { [ -f "$f" ] && [ ! -L "$f" ] && [ "$(stat -c %U "$f")" = root ]; } || refuse "$f is not root's regular file"
    N=$((N + 1))
  done
  [ "$N" -gt 0 ] || refuse "nothing saved under $U"
  PHASE=undo
  RC=0
  for f in "$U/ilas-modes.tsv" "$U/dev-tree-modes.tsv"; do
    [ -f "$f" ] || continue
    say "-- restoring $f ($(wc -l < "$f") saved modes) --"
    walker restore "$f"; r=$?; [ "$r" = 0 ] || RC=4
  done
  [ "$RC" = 0 ] && say "done: every saved mode is back (run $USTAMP undone)." || say "INCOMPLETE: the entries named above were NOT restored (exit 4)."
  exit $RC
fi
if [ "$MODE" = apply ] && [ "$DO_ILAS" = no ] && [ "$DO_DEV" = no ]; then refuse "--apply needs --ilas and/or --dev-trees"; fi

say ""; say "-- G - GUARDS (all of them, before any change) ----------------------------"
if [ "$DO_ILAS" = yes ] || [ "$MODE" = dry ]; then
  { [ -d "$ILAS" ] && [ ! -L "$ILAS" ]; } || need "G-ILAS: $ILAS is not a directory (or is a link)"
  [ "$(stat -c '%F %a %U:%G' "$ILAS" 2>/dev/null)" = "$ILAS_WANT" ] && g "G-ILAS $ILAS is '$ILAS_WANT'" || need "G-ILAS: $ILAS is '$(stat -c '%F %a %U:%G' "$ILAS" 2>/dev/null)', measured '$ILAS_WANT'"
  SCAN=$(walker scan "$ILAS"); [ -n "$SCAN" ] || need "G-ILAS: the scan of $ILAS returned nothing"
  sv() { printf '%s\n' "$SCAN" | sed -n "s/^$1=//p"; }
  for kv in "entries=$ILAS_ENTRIES" "writable=$ILAS_WRITABLE" "symlinks=0" "other=0" "foreign_dev=0" "nonroot=0" "badnames=0" "listsha=$ILAS_LISTSHA"; do
    k=${kv%%=*}; v=${kv#*=}
    [ "$(sv "$k")" = "$v" ] && g "G-ILAS $k = $v" || need "G-ILAS: $k is '$(sv "$k")', measured '$v'"
  done
fi
if [ "$DO_DEV" = yes ] || [ "$MODE" = dry ]; then
  OPUSER=$([ "$MODE" = apply ] && printf '%s' "${SUDO_USER:-}" || id -un)
  OPHOME=$(getent passwd "${OPUSER:-none}" | cut -d: -f6)
  { [ -n "$OPUSER" ] && [ "$OPUSER" != root ] && [ -n "$OPHOME" ] && [ "$(sha_s "$OPHOME")" = "$OP_HOME_SHA" ]; } && g "G-DEV the operator ($OPUSER) and home $OPHOME = measured" || need "G-DEV: the operator '${OPUSER:-unknown}' (home '${OPHOME:-unknown}') is not the measured one — run it with sudo from the operator's account"
  for tm in $DEV_TREES; do
    t=$OPHOME/${tm%%=*}; m=${tm##*=}
    { [ -d "$t" ] && [ ! -L "$t" ] && [ "$(stat -c '%a %U' "$t")" = "$m $OPUSER" ]; } && g "G-DEV $t is the operator's, mode $m" || need "G-DEV: $t is '$(stat -c '%F %a %U' "$t" 2>/dev/null)', measured 'directory $m $OPUSER'"
    if grep -rlsF "$t" /etc/systemd/system/ >/dev/null 2>&1; then need "G-DEV: a unit names $t — not a dev tree to close"; fi   # -r, not a glob (inert under set -f): refuter R4-harness H-F1
  done
fi
[ "$MODE" = apply ] && { install -d -m 0700 -o root -g root "$SAVE/$STAMP" || refuse "could not create $SAVE/$STAMP"; }
CHANGED=no
# a walker that refuses before its first change (exit 1) while nothing else has changed is still "nothing changed"
pass_() { walker "$@"; local r=$?; [ "$r" = 0 ] && { CHANGED=yes; return 0; }; { [ "$r" = 1 ] && [ "$CHANGED" = no ]; } && PHASE=pre; refuse "the $1 pass did not complete (named above)"; }

if [ "$DO_ILAS" = yes ] || [ "$MODE" = dry ]; then
  say ""; say "-- /opt/ILAS: go-w on every directory and file ----------------------------"
  PHASE=ilas
  if [ "$MODE" = apply ]; then
    pass_ save-and-clear "$ILAS" "$SAVE/$STAMP/ilas-modes.tsv" 022 "$ILAS_ENTRIES" "$ILAS_LISTSHA"
    say "  after: $(walker scan "$ILAS" | sed -n 's/^writable=//p') group/world-writable — expect 0"
  else walker dry-clear "$ILAS" /dev/null 022 "$ILAS_ENTRIES" "$ILAS_LISTSHA"; fi
fi
if [ "$DO_DEV" = yes ] || [ "$MODE" = dry ]; then
  say ""; say "-- DEV-TREE HYGIENE: o-rx on each top directory (never ~/citadel, ~/.nvm, ~/.local) --"
  PHASE=devtrees
  for tm in $DEV_TREES; do
    t=$OPHOME/${tm%%=*}; m=${tm##*=}
    if [ "$MODE" = apply ]; then pass_ top-clear "$t" "$SAVE/$STAMP/dev-tree-modes.tsv" 005 "$m"
    else say "  [dry] o-rx on $t ($(stat -c %a "$t" 2>/dev/null) now), its mode saved first, through the walker"; fi
  done
  say "  NOT touched (services run from them): ~/citadel, ~/.nvm, ~/.local"
fi
say ""
[ "$MODE" = apply ] && say "  UNDO (exact): sudo bash /opt/mica-machine/deploy/what13-ilas-devtree-hygiene.sh --undo --stamp $STAMP"
say "done: mode=$MODE run=$STAMP. Nothing was deleted; every mode changed was saved under $SAVE/$STAMP."
'''


def build():
    pin_lines = "\n".join(f"pin {p} {sha_file(p)}" for p in PINS)
    measured = (MEASURED.replace("@@SIGHT@@", SIGHT).replace("@@UNIT_SHA@@", UNIT_SHA).replace("@@DROPIN_SHA@@", DROPIN_SHA)
                .replace("@@METHOD_WANT@@", METHOD_WANT).replace("@@GATE_WAIT@@", str(GATE_WAIT)))
    out = {
        "witness-sight-deploy.sh": DEPLOY.replace(MEASURED, measured).replace("@@PINS@@", pin_lines),
        "witness-sight-remove.sh": REMOVE.replace("@@SIGHT@@", SIGHT).replace("@@UNIT_SHA@@", UNIT_SHA).replace("@@DROPIN_SHA@@", DROPIN_SHA),
        "what13-ilas-devtree-hygiene.sh": WHAT13.replace("@@WALKER@@", WALKER),
    }
    for n, body in out.items():
        assert "@@" not in body, n
    return out

if __name__ == "__main__":
    out = build()
    if sys.argv[1:] == ["--check"]:
        bad = [n for n, body in out.items() if not os.path.exists(os.path.join(HERE, n)) or open(os.path.join(HERE, n)).read() != body]
        print("generated == committed" if not bad else "DIFFERS: " + " ".join(bad))
        sys.exit(1 if bad else 0)
    if sys.argv[1:]:
        sys.exit("usage: gen-deploy.py [--check]")
    for n, body in out.items():
        path = os.path.join(HERE, n)
        open(path, "w").write(body)
        os.chmod(path, 0o644)
        print(f"wrote deploy/{n}  sha256 {hashlib.sha256(body.encode()).hexdigest()}")
    for p in PINS:
        print(f"  pin {p} {sha_file(p)}")
