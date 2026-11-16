#!/usr/bin/env python3
# W-M · the root-side helper of ~/wm-modefix.sh. LAID BY THE MACHINE RELAY to /opt/mica-machine/deploy/wm-apply.py
# (root-owned, never run from a seat-writable tree: X2, 2026-10-17; the seat's own flag of 2026-10-16 20:00Z).
# Run ONLY as `sudo python3 -I /opt/mica-machine/deploy/wm-apply.py <apply|undo> <manifest> --expect-manifest <sha256>`.
#
# THE MANIFEST IS READ ONCE (X2, the S215d class): it lives in a operator-uid directory, so between the caller's run record
# and this read it could be swapped. The bytes are read ONE time, their sha256 must equal --expect-manifest (64 lower-
# case hex, one spelling), and every line acted on comes from those bytes; the path is never opened again.
#
# Per line it never follows a symlink at the last component (O_NOFOLLOW), acts only on a REGULAR file whose owner and
# mode still equal the manifest's line, and changes exactly one bit: other-write off (apply) or the saved mode (undo).
# RESIDUAL, printed by the caller: a parent directory component swapped between the manifest and the act is not
# guarded (O_NOFOLLOW guards the last component only).
import hashlib, os, re, stat, sys

SHA = re.compile(r"^[0-9a-f]{64}$")

def main(argv: list) -> int:
    if len(argv) != 4 or argv[2] != "--expect-manifest":
        print("REFUSE: usage: wm-apply.py <apply|undo> <manifest> --expect-manifest <sha256>"); return 2
    mode, manifest, want_sha = argv[0], argv[1], argv[3]
    if mode not in ("apply", "undo"):
        print("REFUSE: mode is apply or undo"); return 2
    if not SHA.match(want_sha):
        print("REFUSE: --expect-manifest is 64 lower-case hex"); return 2
    try:
        fd = os.open(manifest, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as fh:
            raw = fh.read()
    except OSError as e:
        print(f"REFUSE: manifest {manifest}: {e.strerror}"); return 2
    got = hashlib.sha256(raw).hexdigest()
    if got != want_sha:
        print(f"REFUSE: manifest sha256 {got} is not --expect-manifest {want_sha}: it moved since the run record"); return 2
    done = refused = 0
    for line in raw.decode("utf-8").split("\n"):
        if not line or line.startswith("#"):
            continue
        try:
            saved_mode, uid, gid, path = line.split(" ", 3)
            saved = int(saved_mode, 8)
        except ValueError:
            print(f"REFUSED line {line[:80]!r}: not '<octal> <uid> <gid> <path>'"); refused += 1; continue
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except OSError as e:
            print(f"REFUSED {path}: {e.strerror} (a symlink at the last component is refused here)"); refused += 1; continue
        try:
            st = os.fstat(fd)
            now = stat.S_IMODE(st.st_mode)
            if not stat.S_ISREG(st.st_mode):
                print(f"REFUSED {path}: not a regular file"); refused += 1; continue
            if str(st.st_uid) != uid or str(st.st_gid) != gid:
                print(f"REFUSED {path}: owner moved since the manifest ({st.st_uid}:{st.st_gid} vs {uid}:{gid})"); refused += 1; continue
            want = (saved & ~0o002) if mode == "apply" else saved
            expect_now = saved if mode == "apply" else (saved & ~0o002)
            if now != expect_now:
                print(f"REFUSED {path}: mode is {oct(now)}, the manifest expects {oct(expect_now)} before this {mode}"); refused += 1; continue
            os.fchmod(fd, want)
            print(f"{mode.upper()} {oct(now)} -> {oct(want)} {path}"); done += 1
        finally:
            os.close(fd)
    print(f"W-M {mode}: {done} changed, {refused} refused (manifest sha256 {got})")
    return 0 if refused == 0 else 1

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
