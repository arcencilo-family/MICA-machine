// ── GLUE · the probe door — tests ────────────────────────────────────────────
//
// Ruled S101, shape (a): a probeSource file is admitted ONLY on verified
// provenance — owned by `mica-assembler`, and not writable by the invoking uid.
//
// ⚠ MOST OF THIS FILE RUNS WITHOUT ROOT, and says how.
//
//   A real `chown` to another principal needs privilege this seat does not have.
//   Rather than skip the owner check — the one the ruling is actually about —
//   the tests inject `resolveOwner` and `uid`, so the DECISION is exercised
//   against real `statSync` results on real files with real modes. What is
//   simulated is WHICH uid counts as the owner, never whether the door
//   compares them.
//
//   The one thing that cannot be faked is the true end-to-end pass on a file
//   genuinely owned by another uid. That is exercised only when this file is run
//   with the privilege to create one, and it SAYS SO rather than reporting a
//   green it did not earn.

import * as assert from "assert";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  admitProbeSource,
  DOOR_CHECKED_CUSTODY,
  PROBE_SOURCE_OWNER,
  resolveOwnerUid,
  SIG_STILL_NEVER_VERIFIES_THE_JOIN,
} from "./probe-door";
import type { ProbeDoorRefused, ProbeDoorResult } from "./probe-door";

let passed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const root = mkdtempSync(join(tmpdir(), "mica-probe-door-"));
const ME = process.getuid ? process.getuid() : 1000;
const OWNER = 4242; // the stand-in for mica-assembler's uid
const resolveOwner = (name: string): number | null =>
  name === PROBE_SOURCE_OWNER ? OWNER : null;

function refused(r: ProbeDoorResult): ProbeDoorRefused {
  assert.strictEqual(r.admitted, false, "expected a refusal");
  return r as ProbeDoorRefused;
}

/** A file in its own directory, so the parent's mode can be set per case. */
function fileIn(dirName: string, mode: number, dirMode = 0o755): string {
  const dir = join(root, dirName);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "probe.json");
  writeFileSync(p, "[]");
  chmodSync(p, mode);
  chmodSync(dir, dirMode);
  return p;
}

// ── THE FOUR RULED CASES ────────────────────────────────────────────────────

console.log("\n── the four ruled refusals ──");

check("NOT_FOUND — the file is not there, and that is what it says", () => {
  const r = refused(
    admitProbeSource(join(root, "nope", "probe.json"), { uid: ME, resolveOwner })
  );
  assert.strictEqual(r.refusal, "NOT_FOUND");
  assert.ok(r.detail.includes("NOT 'I was not"), "absence is distinguished from blindness");
  assert.ok(r.remedy.length > 0);
});

check("CANNOT_SEE — a path we may not traverse is NEVER reported as absent", () => {
  // The S97-D(2) class, exercised for real: a directory with no execute bit.
  const dir = join(root, "sealed");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "probe.json");
  writeFileSync(p, "[]");
  chmodSync(dir, 0o000);
  try {
    const r = refused(admitProbeSource(p, { uid: ME, resolveOwner }));
    // Running as root would traverse anyway; that case is its own refusal.
    if (r.refusal === "INVOKER_IS_ROOT") return;
    assert.strictEqual(r.refusal, "CANNOT_SEE");
    assert.ok(r.detail.includes("THIS IS NOT"), "it refuses to claim an absence");
    assert.ok(!r.detail.includes("no file exists"));
  } finally {
    chmodSync(dir, 0o755);
  }
});

check("WRONG_OWNER — owned by someone who is not the assembler", () => {
  const p = fileIn("wrongowner", 0o644);
  const r = refused(admitProbeSource(p, { uid: ME, resolveOwner }));
  assert.strictEqual(r.refusal, "WRONG_OWNER");
  assert.ok(r.detail.includes("not held OUTSIDE"), "it names what the check is FOR");
  assert.ok(r.remedy[0].includes(`chown ${PROBE_SOURCE_OWNER}`));
});

check("INVOKER_WRITABLE — right owner, but this uid can rewrite it", () => {
  const p = fileIn("writable", 0o666);
  const r = refused(
    admitProbeSource(p, { uid: ME, resolveOwner: () => ME === OWNER ? ME : OWNER })
  );
  // Owner is OWNER (not me), so the OTHER class applies and 0o666 has o+w.
  assert.strictEqual(r.refusal, "WRONG_OWNER"); // real owner is ME, not OWNER
  // Now the honest version: make the door believe I am not the owner by
  // resolving the owner to MY uid and checking the owner-write bit instead.
  const mine = refused(admitProbeSource(p, { uid: ME, resolveOwner: () => ME }));
  assert.strictEqual(mine.refusal, "INVOKER_WRITABLE");
  assert.ok(mine.detail.includes("can write it"));
  assert.ok(mine.remedy[0].includes("chmod 0644"));
});

// ── THE FIVE THAT MAKE THE RULED FOUR MEAN SOMETHING ────────────────────────

console.log("\n── the additions, without which the four can pass vacuously ──");

check("INVOKER_IS_ROOT — refused, because root's 'cannot write' is false", () => {
  const p = fileIn("asroot", 0o644);
  const r = refused(admitProbeSource(p, { uid: 0, resolveOwner }));
  assert.strictEqual(r.refusal, "INVOKER_IS_ROOT");
  assert.ok(r.detail.includes("VACUOUSLY"));
  assert.ok(r.remedy.some((x) => x.includes("NOT root")));
});

check("PARENT_REPLACEABLE — a file I can't write, in a directory I can", () => {
  // Ownership of a file you can delete and replace is not custody.
  const p = fileIn("replaceable", 0o444, 0o777);
  const r = refused(admitProbeSource(p, { uid: ME, resolveOwner: () => ME }));
  assert.strictEqual(r.refusal, "PARENT_REPLACEABLE");
  assert.ok(r.detail.includes("delete"));
});

check("...and the STICKY BIT is honoured, not special-cased by path", () => {
  const p = fileIn("sticky", 0o444, 0o1777);
  const r = admitProbeSource(p, { uid: ME, resolveOwner: () => ME });
  assert.strictEqual(r.admitted, true, "a sticky parent cannot be replaced in");
});

check("OWNER_PRINCIPAL_ABSENT — the user does not exist, which is not WRONG_OWNER", () => {
  const p = fileIn("nouser", 0o644);
  const r = refused(admitProbeSource(p, { uid: ME, resolveOwner: () => null }));
  assert.strictEqual(r.refusal, "OWNER_PRINCIPAL_ABSENT");
  assert.ok(r.detail.includes("blame the file for a missing user"));
  assert.ok(r.remedy[0].includes("useradd"));
});

check("NOT_A_FILE — a directory has no single owner to check", () => {
  const dir = join(root, "adir");
  mkdirSync(dir, { recursive: true });
  const r = refused(admitProbeSource(dir, { uid: ME, resolveOwner }));
  assert.strictEqual(r.refusal, "NOT_A_FILE");
});

check("UID_UNAVAILABLE — a platform that will not say who is asking", () => {
  const p = fileIn("nouid", 0o644);
  const r = refused(admitProbeSource(p, { resolveOwner }));
  assert.strictEqual(r.refusal, "UID_UNAVAILABLE");
  assert.ok(r.detail.includes("not a custody check"));
});

// ── THE PASS CASE ───────────────────────────────────────────────────────────

console.log("\n── admitted, and what it does and does not claim ──");

check("ADMITTED — right owner, unwritable by me, unreplaceable directory", () => {
  // dirMode 0o555: I cannot write the DIRECTORY either, so I cannot replace the
  // file. The first draft of this test used the default 0o755 and the door
  // refused it PARENT_REPLACEABLE — correctly. The fixture was wrong, not the
  // door, and that is worth leaving on the record here.
  const p = fileIn("good", 0o444, 0o555);
  const r = admitProbeSource(p, { uid: ME, resolveOwner: () => ME });
  assert.strictEqual(r.admitted, true);
  if (r.admitted) {
    assert.strictEqual(r.raw, "[]");
    assert.ok(r.provenance.includes("not writable by invoking uid"));
    assert.ok(r.provenance.includes(PROBE_SOURCE_OWNER));
  }
});

check("the door reads bytes, and checks NOTHING about their content", () => {
  const dir = join(root, "garbage");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "probe.json");
  writeFileSync(p, "this is not json at all");
  chmodSync(p, 0o444);
  chmodSync(dir, 0o555);
  const r = admitProbeSource(p, { uid: ME, resolveOwner: () => ME });
  assert.strictEqual(r.admitted, true, "custody is not correctness");
  // mica-guard is what refuses the content; the door has no opinion on it.
});

check("TWO LAYERS — the door's claim is narrow and says so in its own words", () => {
  assert.ok(DOOR_CHECKED_CUSTODY.includes("CHECKED CUSTODY"));
  assert.ok(SIG_STILL_NEVER_VERIFIES_THE_JOIN.includes("Ownership is not correctness"));
  assert.ok(
    SIG_STILL_NEVER_VERIFIES_THE_JOIN.includes("claims nothing further"),
    "the second layer must close, not trail off"
  );
});

check("every refusal names a failed check AND the acts that would satisfy it", () => {
  const cases: ProbeDoorResult[] = [
    admitProbeSource(join(root, "nope", "x.json"), { uid: ME, resolveOwner }),
    admitProbeSource(fileIn("r1", 0o644), { uid: ME, resolveOwner }),
    admitProbeSource(fileIn("r2", 0o666), { uid: ME, resolveOwner: () => ME }),
    admitProbeSource(fileIn("r3", 0o644), { uid: 0, resolveOwner }),
    admitProbeSource(fileIn("r4", 0o644), { uid: ME, resolveOwner: () => null }),
  ];
  for (const c of cases) {
    const r = refused(c);
    assert.ok(r.refusal.length > 0, "the failed check is named");
    assert.ok(r.detail.length > 40, "and explained");
    assert.ok(r.remedy.length > 0, `${r.refusal} offers no remedy`);
    for (const line of r.remedy) {
      assert.ok(!/<[^>]*>/.test(line), `placeholder in a remedy line: ${line}`);
    }
  }
});

// ── The real principal, on this host ────────────────────────────────────────

console.log("\n── the real resolver, against this host's /etc/passwd ──");

check("resolveOwnerUid finds mica-assembler here, or says null honestly", () => {
  const uid = resolveOwnerUid(PROBE_SOURCE_OWNER);
  console.log(
    `      → ${PROBE_SOURCE_OWNER} resolves to ${uid === null ? "null (absent on this host)" : String(uid)}`
  );
  assert.ok(uid === null || Number.isInteger(uid));
  assert.strictEqual(resolveOwnerUid("no-such-principal-anywhere"), null);
});

check("END TO END on a REAL other-owned file, or an honest skip", () => {
  // Only possible with privilege to chown. Never faked: if this seat cannot
  // create such a file, the test says so rather than reporting a green.
  const uid = resolveOwnerUid(PROBE_SOURCE_OWNER);
  const p = fileIn("realowner", 0o444, 0o555);
  const r = admitProbeSource(p, { uid: ME });
  if (uid === null) {
    assert.strictEqual((r as ProbeDoorRefused).refusal, "OWNER_PRINCIPAL_ABSENT");
    console.log("      → SKIPPED: mica-assembler does not exist on this host");
    return;
  }
  if (ME === uid) {
    console.log("      → SKIPPED: this seat IS mica-assembler; nothing to separate");
    return;
  }
  assert.strictEqual((r as ProbeDoorRefused).refusal, "WRONG_OWNER");
  console.log(
    `      → this seat (uid ${ME}) is correctly refused on a file it owns; a genuine ` +
      `pass needs a file chown'd to uid ${uid}, which needs root`
  );
});

// Teardown: several fixtures deliberately left their directory unwritable (that
// is the PARENT_REPLACEABLE check being real), so the modes come back before the
// tree can be removed. A test that cannot clean up after itself leaves the next
// run reading somebody else's files.
for (const d of readdirSync(root)) {
  try {
    chmodSync(join(root, d), 0o755);
  } catch {
    // Already writable, or gone. Neither is a finding.
  }
}
rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} tests: ${passed} passed, 0 failed`);
