#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# JOB B · THE LOAD-BEARING ACCEPTANCE REFUSAL, MEASURED LINUX-NATIVE
#
#   "mica — the observed system — can READ the clerk's chain, and is REFUSED an
#    APPEND by the kernel."
#
# Run this INSIDE WSL2 from a script file. Not `bash -c`, not through a Windows
# shell: `$?` does not survive that bridge and arrives as a literal 0.
#
#   bash /tmp/r4-jobb.sh 2>&1 | tee jobb-<date>.txt
#
# Steps 4 and 5 are the measurement and require becoming `mica`. That needs root.
# If sudo cannot run non-interactively the script says so and takes NO reading —
# it does not derive one from the mode bits and present it as measured.
# ─────────────────────────────────────────────────────────────────────────────

STORE=/var/lib/mica/clerk
RECEIPTS="$STORE/receipts.jsonl"

echo "════ 0 · WHO IS MEASURING, AND IS THE MEASUREMENT REAL ════"
echo "invoking user : $(id)"
echo "host          : $(uname -srm)"

# THE CONTROL. Without this, a run of all-zeroes is indistinguishable from a run
# that never read a code at all. That is exactly the defect that made this
# re-run necessary.
false
echo "control  \`false\`            -> exit $?   (MUST be 1; if 0, exit codes are NOT being read)"
true
echo "control  \`true\`             -> exit $?   (MUST be 0)"
bash -c "exit 77"
echo "control  \`bash -c exit 77\`  -> exit $?   (MUST be 77)"

echo ""
echo "════ 1 · THE PRINCIPALS, AS THE SYSTEM HOLDS THEM ════"
for u in mica mica-clerk mica-witness; do
  printf '%-14s : %s\n' "$u" "$(getent passwd $u || echo '(no such user)')"
done
echo ""
for u in mica mica-clerk; do
  printf 'id %-12s : %s\n' "$u" "$(id $u 2>&1)"
done
getent group mica-readers mica-submitters mica-drops 2>&1

echo ""
echo "════ 2 · THE STORE, AS THE FILESYSTEM HOLDS IT ════"
ls -ldn /var/lib/mica "$STORE" 2>&1
echo "stat: $(stat -c '%n mode=%a owner=%U(%u) group=%G(%g)' "$STORE" 2>&1)"
echo ""
echo "NOTE: the above is OBSERVED CONFIGURATION, not the measurement. What a"
echo "principal can actually do is measured in steps 4 and 5 by doing it."

echo ""
echo "════ 3 · CAN THIS SEAT BECOME mica AT ALL? ════"
sudo -n true 2>/dev/null
SUDO=$?
echo "sudo -n true -> exit $SUDO"
if [ $SUDO -ne 0 ]; then
  echo ""
  echo "  *** MEASUREMENT NOT TAKEN ***"
  echo ""
  echo "  Becoming \`mica\` requires root and sudo will not run non-interactively"
  echo "  here. Steps 4 and 5 are therefore NOT PERFORMED and NO reading is"
  echo "  reported for them. The mode bits in step 2 would let anyone DERIVE an"
  echo "  answer; a derived answer is not a measurement, and presenting one as"
  echo "  measured is the defect this whole re-run exists to correct."
  echo ""
  echo "  To take the reading, run THIS SAME SCRIPT where sudo is available:"
  echo "      bash $0"
  echo ""
  exit 3
fi

echo ""
echo "════ 4 · THE READ HALF — mica reads the clerk's chain ════"
echo "\$ sudo -u mica ls -la $STORE"
sudo -n -u mica ls -la "$STORE" 2>&1
echo "  -> exit $?   (expect 0)"
echo ""
echo "\$ sudo -u mica head -c 200 $RECEIPTS"
sudo -n -u mica head -c 200 "$RECEIPTS" 2>&1
echo ""
echo "  -> exit $?   (expect 0)"

echo ""
echo "════ 5 · THE APPEND HALF — the kernel refuses mica a write ════"
echo "\$ sudo -u mica bash -c 'printf \"x\\n\" >> $RECEIPTS'"
APPEND_ERR=$(sudo -n -u mica bash -c "printf 'x\n' >> '$RECEIPTS'" 2>&1)
APPEND_CODE=$?
echo "  stderr: $APPEND_ERR"
echo "  -> exit $APPEND_CODE   (expect NON-ZERO; the error text must name a permission denial)"

echo ""
echo "\$ sudo -u mica touch $STORE/mica-was-here"
NEW_ERR=$(sudo -n -u mica touch "$STORE/mica-was-here" 2>&1)
NEW_CODE=$?
echo "  stderr: $NEW_ERR"
echo "  -> exit $NEW_CODE   (expect NON-ZERO; mica must not be able to create in the store either)"

echo ""
echo "════ 6 · DID ANYTHING CHANGE? ════"
sudo -n -u mica ls -la "$STORE" 2>&1
echo "  -> exit $?"
echo ""
echo "If \`mica-was-here\` appears above, the refusal did NOT hold and that is the"
echo "finding. Nothing in this script modifies permissions, principals, or the"
echo "deployment; it only asks the kernel questions."
