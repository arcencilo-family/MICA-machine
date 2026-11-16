#!/usr/bin/env python3
# X2 · arms for deploy/wm-apply.py, run as the file owner on a scratch tree (no root needed: fchmod by the owner).
#   python3 -I deploy/wm-apply.test.py
import hashlib, os, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); H = os.path.join(HERE, "wm-apply.py")
P = F = 0
def check(name, ok, detail=""):
    global P, F
    if ok: P += 1; print(f"PASS  {name}")
    else: F += 1; print(f"FAIL  {name}\n      {detail}")
def run(*a): r = subprocess.run([sys.executable, "-I", H, *a], capture_output=True, text=True); return r.returncode, r.stdout + r.stderr
d = tempfile.mkdtemp(prefix="wm-apply-test-")
f1 = os.path.join(d, "a.txt"); open(f1, "w").write("x"); os.chmod(f1, 0o666)
os.symlink(f1, os.path.join(d, "link"))
st = os.stat(f1); man = os.path.join(d, "m.manifest")
body = f"# manifest\n666 {st.st_uid} {st.st_gid} {f1}\n"
open(man, "w").write(body); sha = hashlib.sha256(body.encode()).hexdigest()
rc, out = run("apply", man)
check("no --expect-manifest -> REFUSE, nothing changed", rc == 2 and (os.stat(f1).st_mode & 0o777) == 0o666, out)
rc, out = run("apply", man, "--expect-manifest", sha.upper())
check("an upper-case sha -> REFUSE (one spelling)", rc == 2 and "64 lower-case hex" in out, out)
rc, out = run("apply", man, "--expect-manifest", "0" * 64)
check("a manifest whose sha moved -> REFUSE naming both, nothing changed", rc == 2 and "moved since the run record" in out and (os.stat(f1).st_mode & 0o777) == 0o666, out)
rc, out = run("apply", man, "--expect-manifest", sha)
check("the matching sha -> other-write OFF, exactly that bit", rc == 0 and (os.stat(f1).st_mode & 0o777) == 0o664, out)
rc, out = run("apply", man, "--expect-manifest", sha)
check("a second apply -> REFUSED (mode no longer the manifest's), unchanged", rc == 1 and (os.stat(f1).st_mode & 0o777) == 0o664, out)
rc, out = run("undo", man, "--expect-manifest", sha)
check("undo restores the saved mode", rc == 0 and (os.stat(f1).st_mode & 0o777) == 0o666, out)
lman = os.path.join(d, "l.manifest"); lb = f"666 {st.st_uid} {st.st_gid} {os.path.join(d, 'link')}\n"; open(lman, "w").write(lb)
rc, out = run("apply", lman, "--expect-manifest", hashlib.sha256(lb.encode()).hexdigest())
check("a symlink at the last component -> REFUSED, the target untouched", rc == 1 and (os.stat(f1).st_mode & 0o777) == 0o666, out)
os.symlink(man, os.path.join(d, "man-link"))
rc, out = run("apply", os.path.join(d, "man-link"), "--expect-manifest", sha)
check("the MANIFEST itself through a symlink -> REFUSE", rc == 2 and (os.stat(f1).st_mode & 0o777) == 0o666, out)
print(f"\nCENSUS: {P} passed, {F} failed, {P + F} total"); sys.exit(0 if F == 0 else 1)
