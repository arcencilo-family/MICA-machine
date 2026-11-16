// ── MICA · DF — the deployment-facts reader — tests ──────────────────────────
//
//   npx ts-node src/report/deployment-facts.test.ts
//
// ⚠ MOST OF THIS FILE RUNS WITHOUT ROOT, and says how — same note
//   `probe-door.test.ts` carries. A real `chown`/`useradd` needs privilege
//   this seat does not have. Rather than skip the identity checks, the tests
//   inject `resolvePrincipal` so the DECISION is exercised against real
//   `statSync`/`getfacl` results on real files; what is simulated is WHICH
//   identity a name resolves to. Where the REAL account (this test process's
//   own uid/username) is enough to prove the mechanism, no injection is used
//   at all — `getfacl`/`setfacl` are real binaries here and their output is
//   parsed for real.

import * as assert from "assert";

import { RecordBook } from "../record/record-book";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { tmpdir, userInfo } from "os";
import { join } from "path";

import {
  ABSENT_DEPLOYMENT_FACTS_DECLARATION,
  assessDeploymentFacts,
  classifyBind,
  DEPLOYMENT_FACTS_CEILING,
  FACT_FAMILIES,
  loadDeploymentFactsDeclaration,
  parseListeningSockets,
  readSocketsWithFallback,
  SS_ARGS,
  SS_SUDO_PATH,
} from "./deployment-facts";
import type {
  DeploymentFactFinding,
  DeploymentFactsEnv,
  PrincipalIdentity,
  PrincipalLookup,
  SocketReadVia,
} from "./deployment-facts";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).stack ?? String(err)}`);
  }
}

const root = mkdtempSync(join(tmpdir(), "mica-df-"));
const ME_UID = process.getuid ? process.getuid() : 1000;
const ME_GID = process.getgid ? process.getgid() : 1000;
const ME_NAME = userInfo().username;

function fixture(name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeDecl(dir: string, facts: readonly unknown[]): string {
  const p = join(dir, "decl.json");
  writeFileSync(p, JSON.stringify(facts), "utf8");
  return p;
}

// Captured from THIS box, 2026-09-13, verbatim — `systemctl show <unit> -p
// ExecMainStatus -p ExecMainStartTimestamp -p Result`. Note the order: systemd
// returns Result FIRST, not in the order the properties were asked for.
const SHOW_FAILED_1 = "Result=exit-code\nExecMainStartTimestamp=Sun 2026-09-13 00:00:00 CEST\nExecMainStatus=1\n";
const SHOW_RAN_CLEAN = "Result=success\nExecMainStartTimestamp=Sun 2026-09-13 00:00:00 CEST\nExecMainStatus=0\n";
// THE TRAP, also captured verbatim: a unit that does not exist answers with
// exit 0, Result=success and ExecMainStatus=0. Only the empty timestamp differs.
const SHOW_UNKNOWN_UNIT = "Result=success\nExecMainStartTimestamp=\nExecMainStatus=0\n";

// ── unit-listen-loopback fixtures (S128) ───────────────────────────────────
//
// Captured from THIS box, 2026-09-13, verbatim — `systemctl show <unit>
// -p LoadState -p ActiveState -p SubState -p MainPID`. Note the order again:
// MainPID comes back FIRST, not in the order asked. Only MainPID is edited,
// to a fixture pid, because a real one would make the test depend on the box.
const SHOW_LOADED_ACTIVE = "MainPID=4242\nLoadState=loaded\nActiveState=active\nSubState=running\n";
const SHOW_LOADED_INACTIVE = "MainPID=0\nLoadState=loaded\nActiveState=inactive\nSubState=dead\n";
// THE TRAP FOR THIS FAMILY, captured verbatim from a unit that does not exist:
// systemctl answers exit 0 and calls it inactive/dead. LoadState is the only
// word that separates "not running" from "systemd has never heard of it".
const SHOW_NOT_FOUND = "MainPID=0\nLoadState=not-found\nActiveState=inactive\nSubState=dead\n";

// `ss -ltnp`'s header, verbatim from this box — note "Peer Address:PortProcess"
// really does come back glued together. It must never parse as a data row.
const SS_HEADER =
  "State  Recv-Q Send-Q               Local Address:Port  Peer Address:PortProcess\n";

/** A LISTEN row in ss's real column shape. `pid` null = the Process column is empty. */
function ssRow(localAddressPort: string, pid: number | null): string {
  const process = pid === null ? "" : `    users:(("fixture-proc",pid=${String(pid)},fd=20))`;
  return `LISTEN 0      511    ${localAddressPort.padStart(28)}      0.0.0.0:*${process}\n`;
}

function ssTable(...rows: readonly string[]): string {
  return SS_HEADER + rows.join("");
}

/**
 * The whole env for this family: both readers stubbed, neither binary run.
 *
 * `via` has NO DEFAULT on purpose (S128-6). Every test that simulates a socket
 * read must say which read it is simulating, because "it worked" and "it worked
 * with the privilege it was granted" are different facts and the reason string
 * is required to tell them apart. A default would let a test quietly stop
 * saying which — and the type error that appeared across this file the moment
 * `via` became required is the mechanism doing its job.
 */
function listenEnv(
  show: string | { readonly error: string },
  ss: string | { readonly error: string },
  via: SocketReadVia
): DeploymentFactsEnv {
  return {
    readUnitProperties: () =>
      typeof show === "string" ? { ok: true, text: show } : { ok: false, error: show.error },
    readListeningSockets: () =>
      typeof ss === "string" ? { ok: true, text: ss, via } : { ok: false, error: ss.error },
  };
}

function unitEnv(
  reader: (unit: string) => { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string }
): DeploymentFactsEnv {
  return { readUnitProperties: reader };
}

/** An identity that is NOT this test process, and matches no real group. */
function fakeOtherIdentity(): PrincipalIdentity {
  return { uid: 424242, gid: 424242, primaryGroupName: null, secondaryGroupNames: [], allGids: new Set([424242]) };
}

function envWith(identity: PrincipalIdentity | null, name = "the-principal"): DeploymentFactsEnv {
  return {
    resolvePrincipal: (n: string): PrincipalLookup =>
      n === name && identity !== null
        ? { found: true, identity }
        : { found: false, reason: "NOT_FOUND", detail: `${n} not in this fake env` },
  };
}

function findingFor(findings: readonly DeploymentFactFinding[], id: string): DeploymentFactFinding | undefined {
  return findings.find((f) => f.id === id);
}

function assertHeld(dir: string, fact: unknown, env?: DeploymentFactsEnv): void {
  const decl = loadDeploymentFactsDeclaration(writeDecl(dir, [fact]));
  assert.strictEqual(decl.state, "CONFIGURED", JSON.stringify(decl.problems));
  const reading = assessDeploymentFacts(decl, env);
  assert.strictEqual(reading.heldCount, 1, JSON.stringify(reading.findings));
  assert.strictEqual(reading.findings.length, 0, "a HELD fact earns no row");
}

function assertState(
  dir: string,
  fact: unknown,
  state: "FACT_ABSENT" | "CANNOT_ASSESS",
  env?: DeploymentFactsEnv
): DeploymentFactFinding {
  const decl = loadDeploymentFactsDeclaration(writeDecl(dir, [fact]));
  assert.strictEqual(decl.state, "CONFIGURED", JSON.stringify(decl.problems));
  const reading = assessDeploymentFacts(decl, env);
  const f = findingFor(reading.findings, (fact as { id: string }).id);
  assert.ok(f !== undefined, "expected a row for this fact");
  assert.strictEqual(f?.state, state, f?.reason);
  return f as DeploymentFactFinding;
}

// ══════════════════════════════════════════════════════════════════════════
console.log("\n── the declaration — R8, and the whole-file collapse ──────────");

check("ABSENT — no path supplied", () => {
  assert.deepStrictEqual(loadDeploymentFactsDeclaration(null), ABSENT_DEPLOYMENT_FACTS_DECLARATION);
});

check("CONFIGURED_EMPTY — file does not exist", () => {
  const d = loadDeploymentFactsDeclaration(join(fixture("nope"), "nope.json"));
  assert.strictEqual(d.state, "CONFIGURED_EMPTY");
});

check("CONFIGURED_EMPTY — not valid JSON", () => {
  const dir = fixture("badjson");
  const p = join(dir, "decl.json");
  writeFileSync(p, "{ not json", "utf8");
  const d = loadDeploymentFactsDeclaration(p);
  assert.strictEqual(d.state, "CONFIGURED_EMPTY");
});

check("CONFIGURED_EMPTY — valid JSON but not an array", () => {
  const dir = fixture("notarray");
  const p = join(dir, "decl.json");
  writeFileSync(p, JSON.stringify({ id: "x" }), "utf8");
  const d = loadDeploymentFactsDeclaration(p);
  assert.strictEqual(d.state, "CONFIGURED_EMPTY");
  assert.ok(d.problems[0].includes("not a JSON array"));
});

check("CONFIGURED_EMPTY — a valid empty array is still empty, never CONFIGURED", () => {
  const d = loadDeploymentFactsDeclaration(writeDecl(fixture("emptyarr"), []));
  assert.strictEqual(d.state, "CONFIGURED_EMPTY");
});

check("NEVER A PARTIAL READ — one malformed entry among otherwise-good ones invalidates ALL of them", () => {
  const dir = fixture("partial");
  const good = { id: "a", family: "file-mode", path: "/etc/hostname", mode: "644" };
  const bad = { id: "b", family: "file-mode", path: "/etc/hostname" }; // missing "mode"
  const d = loadDeploymentFactsDeclaration(writeDecl(dir, [good, bad]));
  assert.strictEqual(d.state, "CONFIGURED_EMPTY", "the whole file must collapse, not skip the bad entry");
  assert.strictEqual(d.facts.length, 0, "not even the good entry is kept — never a partial read");
  assert.ok(d.problems.some((p) => p.includes("fact b")));
});

check("CONFIGURED_EMPTY — an unknown family is a malformed entry", () => {
  const d = loadDeploymentFactsDeclaration(
    writeDecl(fixture("unknownfam"), [{ id: "x", family: "not-a-real-family" }])
  );
  assert.strictEqual(d.state, "CONFIGURED_EMPTY");
});

check("CONFIGURED_EMPTY — a duplicate id is a malformed declaration", () => {
  const dir = fixture("dupid");
  const one = { id: "dup", family: "file-mode", path: "/etc/hostname", mode: "644" };
  const two = { id: "dup", family: "file-mode", path: "/etc/hosts", mode: "644" };
  const d = loadDeploymentFactsDeclaration(writeDecl(dir, [one, two]));
  assert.strictEqual(d.state, "CONFIGURED_EMPTY");
  assert.ok(d.problems.some((p) => p.includes("more than once")));
});

check("CONFIGURED — a well-formed multi-family declaration parses whole", () => {
  const dir = fixture("wellformed");
  const facts = [
    { id: "a", family: "principal-uid", name: ME_NAME },
    { id: "b", family: "file-mode", path: "/etc/hostname", mode: "644" },
  ];
  const d = loadDeploymentFactsDeclaration(writeDecl(dir, facts));
  assert.strictEqual(d.state, "CONFIGURED");
  assert.strictEqual(d.facts.length, 2);
});

console.log("\n── the ceiling — printed on every render, verbatim ─────────────");

check("DEPLOYMENT_FACTS_CEILING is a non-empty, fixed sentence naming the F10 class", () => {
  assert.ok(DEPLOYMENT_FACTS_CEILING.length > 0);
  assert.ok(DEPLOYMENT_FACTS_CEILING.includes("F10 class"));
  assert.ok(DEPLOYMENT_FACTS_CEILING.includes("root can undo a fact"));
});

console.log("\n── absent/malformed declaration → the whole section is unassessed ──");

check("assessDeploymentFacts on an ABSENT declaration yields no findings and zero counts", () => {
  const reading = assessDeploymentFacts(ABSENT_DEPLOYMENT_FACTS_DECLARATION);
  assert.strictEqual(reading.declaration.state, "ABSENT");
  assert.strictEqual(reading.findings.length, 0);
  assert.strictEqual(reading.heldCount, 0);
  assert.strictEqual(reading.factAbsentCount, 0);
  assert.strictEqual(reading.cannotAssessCount, 0);
});

console.log("\n── principal-uid ──────────────────────────────────────────────");

check("principal-uid HELD — an unpinned, real principal resolves", () => {
  assertHeld(fixture("puid-holds"), { id: "p1", family: "principal-uid", name: ME_NAME });
});

check("principal-uid HELD — a pinned uid that matches", () => {
  assertHeld(fixture("puid-pin-holds"), { id: "p1", family: "principal-uid", name: ME_NAME, uid: ME_UID });
});

check("principal-uid FACT_ABSENT — a pinned uid that does NOT match", () => {
  const f = assertState(
    fixture("puid-pin-mismatch"),
    { id: "p1", family: "principal-uid", name: ME_NAME, uid: ME_UID + 999 },
    "FACT_ABSENT"
  );
  assert.ok(f.reason.includes("pinned"));
});

check("principal-uid FACT_ABSENT — the principal does not exist on this host", () => {
  assertState(
    fixture("puid-notfound"),
    { id: "p1", family: "principal-uid", name: "mica-nonexistent-du112" },
    "FACT_ABSENT"
  );
});

check("principal-uid CANNOT_ASSESS — /etc/passwd could not be read (injected)", () => {
  const env: DeploymentFactsEnv = {
    resolvePrincipal: () => ({ found: false, reason: "CANNOT_READ", detail: "injected failure" }),
  };
  assertState(fixture("puid-cannotread"), { id: "p1", family: "principal-uid", name: ME_NAME }, "CANNOT_ASSESS", env);
});

console.log("\n── file-owner ──────────────────────────────────────────────────");

check("file-owner HELD — a real file, real owner", () => {
  const dir = fixture("fo-holds");
  const p = join(dir, "f");
  writeFileSync(p, "x");
  assertHeld(dir, { id: "o1", family: "file-owner", path: p, owner: ME_NAME });
});

check("file-owner FACT_ABSENT — declared owner resolves to a DIFFERENT uid", () => {
  const dir = fixture("fo-mismatch");
  const p = join(dir, "f");
  writeFileSync(p, "x");
  assertState(dir, { id: "o1", family: "file-owner", path: p, owner: "the-principal" }, "FACT_ABSENT", envWith(fakeOtherIdentity()));
});

check("file-owner FACT_ABSENT — declared owner does not exist on this host", () => {
  const dir = fixture("fo-notfound");
  const p = join(dir, "f");
  writeFileSync(p, "x");
  assertState(dir, { id: "o1", family: "file-owner", path: p, owner: "mica-nonexistent-du112" }, "FACT_ABSENT");
});

check("file-owner CANNOT_ASSESS — the path does not exist (S97-D(2): never a clean absence)", () => {
  const dir = fixture("fo-nopath");
  assertState(dir, { id: "o1", family: "file-owner", path: join(dir, "nope"), owner: ME_NAME }, "CANNOT_ASSESS");
});

console.log("\n── file-mode ───────────────────────────────────────────────────");

check("file-mode HELD — the declared mode matches", () => {
  const dir = fixture("fm-holds");
  const p = join(dir, "f");
  writeFileSync(p, "x");
  chmodSync(p, 0o640);
  assertHeld(dir, { id: "m1", family: "file-mode", path: p, mode: "640" });
});

check("file-mode FACT_ABSENT — the real mode differs from declared", () => {
  const dir = fixture("fm-mismatch");
  const p = join(dir, "f");
  writeFileSync(p, "x");
  chmodSync(p, 0o644);
  const f = assertState(dir, { id: "m1", family: "file-mode", path: p, mode: "600" }, "FACT_ABSENT");
  assert.ok(f.reason.includes("declared 600"));
});

check("file-mode CANNOT_ASSESS — the path does not exist", () => {
  const dir = fixture("fm-nopath");
  assertState(dir, { id: "m1", family: "file-mode", path: join(dir, "nope"), mode: "644" }, "CANNOT_ASSESS");
});

check("file-mode — a 4-digit declared mode also checks the special bits", () => {
  const dir = fixture("fm-4digit");
  const p = join(dir, "f");
  writeFileSync(p, "x");
  chmodSync(p, 0o644);
  assertHeld(dir, { id: "m1", family: "file-mode", path: p, mode: "0644" });
});

console.log("\n── acl-entry ───────────────────────────────────────────────────");

check("acl-entry HELD — a real setfacl entry, matched exactly", () => {
  const dir = fixture("acl-holds");
  const p = join(dir, "f");
  writeFileSync(p, "x");
  execFileSync("setfacl", ["-m", `u:${ME_NAME}:rw`, p]);
  assertHeld(dir, { id: "a1", family: "acl-entry", path: p, entry: `u:${ME_NAME}:rw` });
});

check("acl-entry FACT_ABSENT — exact match, not a subset: rwx on disk does not satisfy declared rw", () => {
  const dir = fixture("acl-extrabit");
  const p = join(dir, "f");
  writeFileSync(p, "x");
  execFileSync("setfacl", ["-m", `u:${ME_NAME}:rwx`, p]);
  assertState(dir, { id: "a1", family: "acl-entry", path: p, entry: `u:${ME_NAME}:rw` }, "FACT_ABSENT");
});

check("acl-entry FACT_ABSENT — no such entry on the file at all", () => {
  const dir = fixture("acl-missing");
  const p = join(dir, "f");
  writeFileSync(p, "x");
  assertState(dir, { id: "a1", family: "acl-entry", path: p, entry: "u:mica-nonexistent-du112:rw" }, "FACT_ABSENT");
});

check("acl-entry HELD — owner/group declared and matched", () => {
  const dir = fixture("acl-ownergroup");
  const p = join(dir, "f");
  writeFileSync(p, "x");
  execFileSync("setfacl", ["-m", `u:${ME_NAME}:r`, p]);
  assertHeld(dir, {
    id: "a1",
    family: "acl-entry",
    path: p,
    entry: `u:${ME_NAME}:r`,
    owner: ME_NAME,
  });
});

check("acl-entry FACT_ABSENT — declared owner does not match the real owner", () => {
  const dir = fixture("acl-wrongowner");
  const p = join(dir, "f");
  writeFileSync(p, "x");
  execFileSync("setfacl", ["-m", `u:${ME_NAME}:r`, p]);
  assertState(
    dir,
    { id: "a1", family: "acl-entry", path: p, entry: `u:${ME_NAME}:r`, owner: "mica-nonexistent-du112" },
    "FACT_ABSENT"
  );
});

check("acl-entry CANNOT_ASSESS — the path does not exist", () => {
  const dir = fixture("acl-nopath");
  assertState(dir, { id: "a1", family: "acl-entry", path: join(dir, "nope"), entry: "o::r" }, "CANNOT_ASSESS");
});

console.log("\n── file-not-writable-by ─────────────────────────────────────────");

check("file-not-writable-by HELD — other has no write bit, principal is neither owner nor group", () => {
  const dir = fixture("fnwb-holds");
  const p = join(dir, "f");
  writeFileSync(p, "x");
  chmodSync(p, 0o600); // owner rw, nobody else anything
  assertHeld(dir, { id: "w1", family: "file-not-writable-by", path: p, principal: "the-principal" }, envWith(fakeOtherIdentity()));
});

check("file-not-writable-by FACT_ABSENT — other CAN write (the alarm case)", () => {
  const dir = fixture("fnwb-absent-other");
  const p = join(dir, "f");
  writeFileSync(p, "x");
  chmodSync(p, 0o606); // owner rw, other rw
  const f = assertState(
    dir,
    { id: "w1", family: "file-not-writable-by", path: p, principal: "the-principal" },
    "FACT_ABSENT",
    envWith(fakeOtherIdentity())
  );
  assert.ok(f.reason.includes("CAN write"));
});

check("file-not-writable-by FACT_ABSENT — principal's OWN group has the write bit", () => {
  const dir = fixture("fnwb-absent-group");
  const p = join(dir, "f");
  writeFileSync(p, "x");
  chmodSync(p, 0o660); // owner rw, group rw, other none
  const identity: PrincipalIdentity = {
    uid: 424242,
    gid: ME_GID, // matches the file's real owning gid
    primaryGroupName: null,
    secondaryGroupNames: [],
    allGids: new Set([ME_GID]),
  };
  assertState(
    dir,
    { id: "w1", family: "file-not-writable-by", path: p, principal: "the-principal" },
    "FACT_ABSENT",
    envWith(identity)
  );
});

check("file-not-writable-by CANNOT_ASSESS — the principal does not exist (NEVER a vacuous HELD)", () => {
  const dir = fixture("fnwb-notfound");
  const p = join(dir, "f");
  writeFileSync(p, "x");
  chmodSync(p, 0o600);
  const f = assertState(
    dir,
    { id: "w1", family: "file-not-writable-by", path: p, principal: "mica-nonexistent-du112" },
    "CANNOT_ASSESS"
  );
  assert.ok(f.reason.includes("vacuous"), f.reason);
});

check("file-not-writable-by CANNOT_ASSESS — the path does not exist", () => {
  const dir = fixture("fnwb-nopath");
  assertState(
    dir,
    { id: "w1", family: "file-not-writable-by", path: join(dir, "nope"), principal: "the-principal" },
    "CANNOT_ASSESS",
    envWith(fakeOtherIdentity())
  );
});

check("file-not-writable-by CANNOT_ASSESS — ACL could not be consulted, mode bits alone are refused", () => {
  const dir = fixture("fnwb-aclfail");
  const p = join(dir, "f");
  writeFileSync(p, "x");
  chmodSync(p, 0o600);
  const env: DeploymentFactsEnv = {
    resolvePrincipal: envWith(fakeOtherIdentity()).resolvePrincipal,
    readAcl: () => ({ ok: false, error: "injected: getfacl not installed" }),
  };
  const f = assertState(
    dir,
    { id: "w1", family: "file-not-writable-by", path: p, principal: "the-principal" },
    "CANNOT_ASSESS",
    env
  );
  assert.ok(f.reason.includes("not a sufficient answer"));
});

console.log("\n── door-preconditions ───────────────────────────────────────────");

function assemblerEnv(uid: number): DeploymentFactsEnv {
  return {
    resolvePrincipal: (n) =>
      n === "mica-assembler"
        ? { found: true, identity: { uid, gid: uid, primaryGroupName: null, secondaryGroupNames: [], allGids: new Set([uid]) } }
        : { found: false, reason: "NOT_FOUND", detail: "not mica-assembler" },
  };
}

check("door-preconditions HELD — owned by the assembler, no group/other write, sticky-free but locked-down parent", () => {
  const dir = fixture("door-holds");
  chmodSync(dir, 0o755);
  const p = join(dir, "probe.json");
  writeFileSync(p, "[]");
  chmodSync(p, 0o644);
  assertHeld(dir, { id: "d1", family: "door-preconditions", probeSourcePath: p }, assemblerEnv(ME_UID));
});

check("door-preconditions FACT_ABSENT — owner is not mica-assembler", () => {
  const dir = fixture("door-wrongowner");
  chmodSync(dir, 0o755);
  const p = join(dir, "probe.json");
  writeFileSync(p, "[]");
  chmodSync(p, 0o644);
  const f = assertState(dir, { id: "d1", family: "door-preconditions", probeSourcePath: p }, "FACT_ABSENT", assemblerEnv(ME_UID + 999));
  assert.ok(f.reason.includes("owner is uid"));
});

check("door-preconditions FACT_ABSENT — mode lets a non-owner write it", () => {
  const dir = fixture("door-writable");
  chmodSync(dir, 0o755);
  const p = join(dir, "probe.json");
  writeFileSync(p, "[]");
  chmodSync(p, 0o666);
  const f = assertState(dir, { id: "d1", family: "door-preconditions", probeSourcePath: p }, "FACT_ABSENT", assemblerEnv(ME_UID));
  assert.ok(f.reason.includes("allows a non-owner"));
});

check("door-preconditions FACT_ABSENT — parent directory is replaceable (writable, no sticky bit)", () => {
  const dir = fixture("door-parentwritable");
  chmodSync(dir, 0o777); // no sticky bit
  const p = join(dir, "probe.json");
  writeFileSync(p, "[]");
  chmodSync(p, 0o644);
  const f = assertState(dir, { id: "d1", family: "door-preconditions", probeSourcePath: p }, "FACT_ABSENT", assemblerEnv(ME_UID));
  assert.ok(f.reason.includes("parent"));
});

check("door-preconditions HELD — a world-writable parent WITH the sticky bit is not replaceable", () => {
  const dir = fixture("door-stickyparent");
  chmodSync(dir, 0o777 | 0o1000);
  const p = join(dir, "probe.json");
  writeFileSync(p, "[]");
  chmodSync(p, 0o644);
  assertHeld(dir, { id: "d1", family: "door-preconditions", probeSourcePath: p }, assemblerEnv(ME_UID));
});

check("door-preconditions CANNOT_ASSESS — the probe source path does not exist", () => {
  const dir = fixture("door-nopath");
  assertState(
    dir,
    { id: "d1", family: "door-preconditions", probeSourcePath: join(dir, "nope.json") },
    "CANNOT_ASSESS",
    assemblerEnv(ME_UID)
  );
});

check("door-preconditions FACT_ABSENT — mica-assembler does not exist on this host", () => {
  const dir = fixture("door-noassembler");
  const p = join(dir, "probe.json");
  writeFileSync(p, "[]");
  assertState(dir, { id: "d1", family: "door-preconditions", probeSourcePath: p }, "FACT_ABSENT", {});
});

console.log("\n── UNDECLARED census — visible, never an alarm ─────────────────");

check("a declaration naming only two families leaves the other four UNDECLARED, in FACT_FAMILIES order", () => {
  const dir = fixture("undeclared");
  const p = join(dir, "f");
  writeFileSync(p, "x");
  chmodSync(p, 0o644);
  const decl = loadDeploymentFactsDeclaration(
    writeDecl(dir, [
      { id: "a", family: "principal-uid", name: ME_NAME },
      { id: "b", family: "file-mode", path: p, mode: "644" },
    ])
  );
  const reading = assessDeploymentFacts(decl);
  assert.deepStrictEqual(
    reading.undeclaredFamilies,
    FACT_FAMILIES.filter((f) => f !== "principal-uid" && f !== "file-mode")
  );
});

check("a declaration naming every family leaves nothing UNDECLARED", () => {
  const dir = fixture("alldeclared");
  const p = join(dir, "f");
  writeFileSync(p, "x");
  const facts = FACT_FAMILIES.map((fam, i) => {
    if (fam === "principal-uid") return { id: `f${i}`, family: fam, name: ME_NAME };
    if (fam === "file-owner") return { id: `f${i}`, family: fam, path: p, owner: ME_NAME };
    if (fam === "file-not-writable-by") return { id: `f${i}`, family: fam, path: p, principal: ME_NAME };
    if (fam === "acl-entry") return { id: `f${i}`, family: fam, path: p, entry: "o::r" };
    if (fam === "file-mode") return { id: `f${i}`, family: fam, path: p, mode: "644" };
    if (fam === "unit-last-exit") return { id: `f${i}`, family: fam, unit: "declared-by-the-test.service" };
    if (fam === "unit-listen-loopback") {
      return { id: `f${i}`, family: fam, unit: "declared-by-the-test.service", port: 54321 };
    }
    if (fam === "pilot-review-in-ledger") {
      // A ledger the test writes, and a sha it computes. No literal 64-hex.
      const ledger = join(dir, "mica-log.jsonl");
      const sha = createHash("sha256").update("all-declared chain", "utf8").digest("hex");
      writeFileSync(
        ledger,
        JSON.stringify({
          sequenceNumber: 0,
          timestamp: 1,
          moduleId: "mica-arbiter",
          eventType: "PILOT_CHAIN_REVIEWED",
          outcome: `chain=${sha} subject=mica-subject1 run=pilotX-n5`,
        }) + "\n",
        "utf8"
      );
      return { id: `f${i}`, family: fam, micaLog: ledger, chainSha256: sha };
    }
    return { id: `f${i}`, family: fam, probeSourcePath: p };
  });
  const decl = loadDeploymentFactsDeclaration(writeDecl(dir, facts));
  assert.strictEqual(decl.state, "CONFIGURED", JSON.stringify(decl.problems));
  // The unit reader AND the socket reader are STUBBED here too: no test in this
  // file shells out to systemctl or to ss, so the suite's result cannot depend
  // on which units exist — or what is listening — on whichever machine is
  // running it.
  const reading = assessDeploymentFacts(decl, {
    ...unitEnv(() => ({ ok: true, text: SHOW_RAN_CLEAN })),
    readListeningSockets: () => ({ ok: true, text: SS_HEADER, via: "sudo" }),
  });
  assert.deepStrictEqual(reading.undeclaredFamilies, []);
});

// ══════════════════════════════════════════════════════════════════════════
console.log("\n── unit-last-exit (S127-7) — stubbed systemctl, never shelled out ──");

check("unit-last-exit HELD — last run exited 0 and a start timestamp exists", () => {
  const dir = fixture("unit-held");
  assertHeld(dir, { id: "u-ok", family: "unit-last-exit", unit: "a.service" }, unitEnv(() => ({ ok: true, text: SHOW_RAN_CLEAN })));
});

check("unit-last-exit FACT_ABSENT — a non-zero status, and the reason NAMES it", () => {
  const dir = fixture("unit-failed");
  const f = assertState(
    dir,
    { id: "u-bad", family: "unit-last-exit", unit: "b.service" },
    "FACT_ABSENT",
    unitEnv(() => ({ ok: true, text: SHOW_FAILED_1 }))
  );
  assert.ok(f.reason.includes("exited 1"), f.reason);
  assert.ok(f.reason.includes("exit-code"), f.reason);
});

check("unit-last-exit CANNOT_ASSESS — the VACUOUS-PASS fence: an unknown unit is never HELD", () => {
  const dir = fixture("unit-unknown");
  // systemctl answers for a nonexistent unit with status 0. A check reading
  // only the status would score a typo'd unit name HELD forever.
  const f = assertState(
    dir,
    { id: "u-unknown", family: "unit-last-exit", unit: "no-such-unit-xyz.service" },
    "CANNOT_ASSESS",
    unitEnv(() => ({ ok: true, text: SHOW_UNKNOWN_UNIT }))
  );
  assert.ok(f.reason.includes("ExecMainStartTimestamp"), f.reason);
});

check("unit-last-exit CANNOT_ASSESS — systemctl itself could not be run", () => {
  const dir = fixture("unit-noshow");
  assertState(
    dir,
    { id: "u-noshow", family: "unit-last-exit", unit: "c.service" },
    "CANNOT_ASSESS",
    unitEnv(() => ({ ok: false, error: "spawn systemctl ENOENT" }))
  );
});

check("unit-last-exit CANNOT_ASSESS — a status that is not an integer is not guessed past", () => {
  const dir = fixture("unit-nonint");
  assertState(
    dir,
    { id: "u-nonint", family: "unit-last-exit", unit: "d.service" },
    "CANNOT_ASSESS",
    unitEnv(() => ({ ok: true, text: "Result=success\nExecMainStartTimestamp=Sun 2026-09-13 00:00:00 CEST\nExecMainStatus=\n" }))
  );
});

check("unit-last-exit — properties are read BY KEY, not by the order they come back in", () => {
  const dir = fixture("unit-order");
  assertHeld(
    dir,
    { id: "u-order", family: "unit-last-exit", unit: "e.service" },
    unitEnv(() => ({ ok: true, text: "ExecMainStatus=0\nResult=success\nExecMainStartTimestamp=Mon 2026-09-14 00:00:00 CEST\n" }))
  );
});

check("R8 · the unit name comes from the DECLARATION — this module holds no unit literal", () => {
  const dir = fixture("unit-r8");
  const asked: string[] = [];
  assertHeld(
    dir,
    { id: "u-r8", family: "unit-last-exit", unit: "declared-only-here.timer" },
    unitEnv((unit) => {
      asked.push(unit);
      return { ok: true, text: SHOW_RAN_CLEAN };
    })
  );
  assert.deepStrictEqual(asked, ["declared-only-here.timer"]);
});

check("a unit name with no type suffix is REFUSED at the declaration, never suffixed for the declarer", () => {
  const dir = fixture("unit-badname");
  for (const unit of ["mica-report", "bad name.service", "", "evil;rm -rf.service"]) {
    const decl = loadDeploymentFactsDeclaration(writeDecl(dir, [{ id: "u", family: "unit-last-exit", unit }]));
    assert.strictEqual(decl.state, "CONFIGURED_EMPTY", `${JSON.stringify(unit)} should not validate`);
  }
});

// ══════════════════════════════════════════════════════════════════════════
console.log("\n── unit-listen-loopback (S128) — stubbed systemctl AND ss, neither run ──");

// THE DECLARED PORT IS A FIXTURE NUMBER, 54321, and nowhere near the real one.
// That is the R8 proof for the port the way the unit-name test is for the unit:
// a module carrying a port literal could not pass a test that never names it.
const PORT = 54321;
const OTHER_PORT = 54322;
const fact = (id: string, port = PORT): unknown => ({
  id,
  family: "unit-listen-loopback",
  unit: "declared-only-here.service",
  port,
});

check("ULL-1 HELD — loaded, active, bound 127.0.0.1, and the pid IS the unit's MainPID", () => {
  const dir = fixture("ull-held");
  assertHeld(
    dir,
    fact("ull-ok"),
    listenEnv(SHOW_LOADED_ACTIVE, ssTable(ssRow(`127.0.0.1:${String(PORT)}`, 4242)), "sudo")
  );
});

check("ULL-2 HELD — the same bind with NO visible pid: step 8 only fires when CONTRADICTED", () => {
  const dir = fixture("ull-nopid");
  // Running as the report principal, another account's socket comes back with
  // an empty Process column — the ordinary production case. The check still
  // holds, and the HELD reason narrows its own claim accordingly.
  //
  // WHAT THIS TEST CANNOT REACH, said rather than implied: `assessDeploymentFacts`
  // is negative-only by design, so a HELD reason earns no row and no test in
  // this file can read one. The narrowing sentence is a source property here,
  // not a tested one. What IS tested is the behaviour that matters — an
  // invisible pid must not turn a good bind into a finding.
  assertHeld(
    dir,
    fact("ull-nopid"),
    listenEnv(SHOW_LOADED_ACTIVE, ssTable(ssRow(`127.0.0.1:${String(PORT)}`, null)), "plain")
  );
});

check("ULL-3 FACT_ABSENT — bound 0.0.0.0, and the reason NAMES the bind", () => {
  const dir = fixture("ull-wild4");
  const f = assertState(
    dir,
    fact("ull-wild4"),
    "FACT_ABSENT",
    listenEnv(SHOW_LOADED_ACTIVE, ssTable(ssRow(`0.0.0.0:${String(PORT)}`, 4242)), "sudo")
  );
  assert.ok(f.reason.includes(`0.0.0.0:${String(PORT)}`), f.reason);
  assert.ok(f.reason.includes("every interface"), f.reason);
  assert.ok(f.reason.includes("reachable from off this host"), f.reason);
});

check("ULL-4 FACT_ABSENT — bound [::], the IPv6 wildcard, is the same finding", () => {
  const dir = fixture("ull-wild6");
  const f = assertState(
    dir,
    fact("ull-wild6"),
    "FACT_ABSENT",
    listenEnv(SHOW_LOADED_ACTIVE, ssTable(ssRow(`[::]:${String(PORT)}`, 4242)), "sudo")
  );
  assert.ok(f.reason.includes("every interface"), f.reason);
});

check("ULL-5 FACT_ABSENT — a SPECIFIC non-loopback address is not flattened into 'wildcard'", () => {
  const dir = fixture("ull-other");
  const f = assertState(
    dir,
    fact("ull-other"),
    "FACT_ABSENT",
    listenEnv(SHOW_LOADED_ACTIVE, ssTable(ssRow(`10.255.255.254:${String(PORT)}`, 4242)), "sudo")
  );
  assert.ok(f.reason.includes("10.255.255.254"), f.reason);
  assert.ok(f.reason.includes("a non-loopback address"), f.reason);
  assert.ok(!f.reason.includes("every interface"), f.reason);
});

check("ULL-6 FACT_ABSENT — nothing on the declared port, while other ports ARE listening", () => {
  const dir = fixture("ull-noport");
  const f = assertState(
    dir,
    fact("ull-noport"),
    "FACT_ABSENT",
    listenEnv(SHOW_LOADED_ACTIVE, ssTable(ssRow(`127.0.0.1:${String(OTHER_PORT)}`, 4242)), "sudo")
  );
  assert.ok(f.reason.includes(`nothing is listening on port ${String(PORT)}`), f.reason);
});

check("ULL-7 FACT_ABSENT — the unit is loaded but NOT active, and ss is never consulted", () => {
  const dir = fixture("ull-inactive");
  let ssCalls = 0;
  const decl = loadDeploymentFactsDeclaration(writeDecl(dir, [fact("ull-inactive")]));
  assert.strictEqual(decl.state, "CONFIGURED", JSON.stringify(decl.problems));
  const reading = assessDeploymentFacts(decl, {
    readUnitProperties: () => ({ ok: true, text: SHOW_LOADED_INACTIVE }),
    readListeningSockets: () => {
      ssCalls++;
      return { ok: true, text: SS_HEADER, via: "sudo" };
    },
  });
  const f = findingFor(reading.findings, "ull-inactive");
  assert.ok(f !== undefined && f.state === "FACT_ABSENT", JSON.stringify(reading.findings));
  assert.ok(f.reason.includes("inactive/dead"), f.reason);
  assert.strictEqual(ssCalls, 0, "a dead unit is answered without reading the socket table");
});

check("ULL-8 CANNOT_ASSESS — THE VACUOUS-PASS FENCE: LoadState=not-found is never a finding", () => {
  const dir = fixture("ull-notfound");
  // The captured trap: systemctl answers exit 0 for a unit that does not exist
  // and calls it inactive/dead — which looks EXACTLY like ULL-7's real unit
  // that is merely stopped. Without LoadState, a typo'd unit name would print
  // FACT_ABSENT forever and read as a deployment fault that does not exist.
  const f = assertState(
    dir,
    fact("ull-notfound"),
    "CANNOT_ASSESS",
    listenEnv(SHOW_NOT_FOUND, ssTable(ssRow(`127.0.0.1:${String(PORT)}`, 4242)), "sudo")
  );
  assert.ok(f.reason.includes("LoadState=not-found"), f.reason);
});

check("ULL-9 CANNOT_ASSESS — ss itself could not be run; there is no second source", () => {
  const dir = fixture("ull-noss");
  const f = assertState(
    dir,
    fact("ull-noss"),
    "CANNOT_ASSESS",
    listenEnv(SHOW_LOADED_ACTIVE, { error: "spawn ss ENOENT" }, "plain")
  );
  assert.ok(f.reason.includes("ENOENT"), f.reason);
  assert.ok(f.reason.includes("not a mode bit"), f.reason);
});

check("ULL-10 CANNOT_ASSESS — ss ran and NOTHING parsed: 'I could not see' is not 'not there'", () => {
  const dir = fixture("ull-unparsable");
  const f = assertState(
    dir,
    fact("ull-unparsable"),
    "CANNOT_ASSESS",
    listenEnv(SHOW_LOADED_ACTIVE, "some future ss writes a table this reader does not know\n", "sudo")
  );
  assert.ok(f.reason.includes("ZERO listening rows"), f.reason);
});

check("ULL-11 CANNOT_ASSESS — systemctl itself could not be run", () => {
  const dir = fixture("ull-noshow");
  assertState(
    dir,
    fact("ull-noshow"),
    "CANNOT_ASSESS",
    listenEnv({ error: "spawn systemctl ENOENT" }, ssTable(), "sudo")
  );
});

check("ULL-12 FACT_ABSENT — loopback-only, but held by a pid that is NOT this unit's", () => {
  const dir = fixture("ull-wrongpid");
  const f = assertState(
    dir,
    fact("ull-wrongpid"),
    "FACT_ABSENT",
    listenEnv(SHOW_LOADED_ACTIVE, ssTable(ssRow(`127.0.0.1:${String(PORT)}`, 9999)), "sudo")
  );
  assert.ok(f.reason.includes("9999"), f.reason);
  assert.ok(f.reason.includes("4242"), f.reason);
  assert.ok(f.reason.includes("Something other than the declared unit"), f.reason);
});

check("ULL-13 R8 · the unit AND the port come from the DECLARATION — nothing is asked twice", () => {
  const dir = fixture("ull-r8");
  const asked: string[] = [];
  assertHeld(dir, fact("ull-r8"), {
    readUnitProperties: (unit: string) => {
      asked.push(unit);
      return { ok: true, text: SHOW_LOADED_ACTIVE };
    },
    readListeningSockets: () => ({
      ok: true,
      text: ssTable(ssRow(`127.0.0.1:${String(PORT)}`, 4242)),
      via: "sudo",
    }),
  });
  assert.deepStrictEqual(asked, ["declared-only-here.service"]);
  // And the SAME table read against a different declared port must not hold —
  // which is only possible if the port is read from the declaration.
  const decl = loadDeploymentFactsDeclaration(writeDecl(dir, [fact("ull-r8b", OTHER_PORT)]));
  const reading = assessDeploymentFacts(
    decl,
    listenEnv(SHOW_LOADED_ACTIVE, ssTable(ssRow(`127.0.0.1:${String(PORT)}`, 4242)), "sudo")
  );
  assert.strictEqual(reading.heldCount, 0, "the same sockets, a different declared port");
});

check("ULL-14 the ss parser handles every shape THIS BOX actually prints", () => {
  // Captured 2026-09-13 from `ss -ltnp` here, one of each shape that appeared:
  // a scoped address, both bracket forms, the bare `*`, and an IPv6 ULA.
  const captured =
    SS_HEADER +
    "LISTEN 0      4096                 100.112.17.57:39514      0.0.0.0:*\n" +
    "LISTEN 0      511                      127.0.0.1:18820      0.0.0.0:*    users:((\"openclaw-gatewa\",pid=430,fd=22))\n" +
    "LISTEN 0      4096                 127.0.0.53%lo:53         0.0.0.0:*\n" +
    "LISTEN 0      4096                          [::]:22            [::]:*\n" +
    "LISTEN 0      4096   [fd7a:115c:a1e0::e001:11a9]:35705         [::]:*\n" +
    "LISTEN 0      511                          [::1]:18820         [::]:*    users:((\"openclaw-gatewa\",pid=430,fd=23))\n" +
    "LISTEN 0      511                        *:18851      0.0.0.0:*    users:((\"other\",pid=424,fd=9))\n";
  const rows = parseListeningSockets(captured);
  assert.strictEqual(rows.length, 7, "the header must not parse as a row");
  assert.deepStrictEqual(
    rows.map((r) => [r.address, r.port, classifyBind(r.address)]),
    [
      ["100.112.17.57", 39514, "OTHER"],
      ["127.0.0.1", 18820, "LOOPBACK"],
      ["127.0.0.53", 53, "LOOPBACK"],
      ["::", 22, "WILDCARD"],
      ["fd7a:115c:a1e0::e001:11a9", 35705, "OTHER"],
      ["::1", 18820, "LOOPBACK"],
      ["*", 18851, "WILDCARD"],
    ]
  );
  assert.deepStrictEqual(
    rows.map((r) => r.pid),
    [null, 430, null, null, null, 430, 424]
  );
  // The port is after the LAST colon: splitting on the first would halve every
  // IPv6 address, which is the bug this line exists to keep caught.
  assert.strictEqual(rows[4].port, 35705);
});

check("ULL-15 the declaration REFUSES a bad unit name and a port that is not a port", () => {
  const dir = fixture("ull-baddecl");
  const bad: readonly unknown[] = [
    { id: "u", family: "unit-listen-loopback", unit: "mica-proxy", port: PORT },
    { id: "u", family: "unit-listen-loopback", unit: "a.service" },
    { id: "u", family: "unit-listen-loopback", unit: "a.service", port: 0 },
    { id: "u", family: "unit-listen-loopback", unit: "a.service", port: 65536 },
    { id: "u", family: "unit-listen-loopback", unit: "a.service", port: 1.5 },
    { id: "u", family: "unit-listen-loopback", unit: "a.service", port: "54321" },
  ];
  for (const entry of bad) {
    const decl = loadDeploymentFactsDeclaration(writeDecl(dir, [entry]));
    assert.strictEqual(
      decl.state,
      "CONFIGURED_EMPTY",
      `${JSON.stringify(entry)} should not validate`
    );
  }
});

// ══════════════════════════════════════════════════════════════════════════
console.log("\n── S128-6 · the one granted command, and the named fallback ─────");

check("ULL-16 the SUDO read is named in the reason — the grant is visible when it is in force", () => {
  const dir = fixture("ull-via-sudo");
  const f = assertState(
    dir,
    fact("ull-via-sudo"),
    "FACT_ABSENT",
    listenEnv(SHOW_LOADED_ACTIVE, ssTable(ssRow(`0.0.0.0:${String(PORT)}`, 4242)), "sudo")
  );
  assert.ok(f.reason.includes(`sudo -n ${SS_SUDO_PATH} ${SS_ARGS.join(" ")}`), f.reason);
  assert.ok(!f.reason.includes("WITHOUT sudo"), f.reason);
});

check("ULL-17 the PLAIN read is named too, WITH what it costs — a grant not in force cannot hide", () => {
  const dir = fixture("ull-via-plain");
  // The same box, the same bad bind, the same finding — and a reason a human
  // can tell apart from ULL-16's. "It worked" and "it worked with the privilege
  // it was granted" must not print the same, or the grant is unfalsifiable.
  const f = assertState(
    dir,
    fact("ull-via-plain"),
    "FACT_ABSENT",
    listenEnv(SHOW_LOADED_ACTIVE, ssTable(ssRow(`0.0.0.0:${String(PORT)}`, 4242)), "plain")
  );
  assert.ok(f.reason.includes("WITHOUT sudo"), f.reason);
  assert.ok(f.reason.includes("owning pid"), f.reason);
  assert.ok(!f.reason.includes("sudo -n"), f.reason);
});

check("ULL-18 BOTH reads failing names BOTH errors — the second must not hide the first", () => {
  const dir = fixture("ull-neither");
  // Reported as one error string by readSocketsWithFallback (ULL-19), and this
  // is the end-to-end half: "sudo is not configured" and "ss is not installed"
  // are different deployment facts wanting different repairs.
  const f = assertState(
    dir,
    fact("ull-neither"),
    "CANNOT_ASSESS",
    listenEnv(
      SHOW_LOADED_ACTIVE,
      { error: `sudo -n ${SS_SUDO_PATH} -ltnp failed (a sudo password is required) AND plain ss -ltnp failed (spawn ss ENOENT)` },
      "plain"
    )
  );
  assert.ok(f.reason.includes("a sudo password is required"), f.reason);
  assert.ok(f.reason.includes("spawn ss ENOENT"), f.reason);
  assert.ok(f.reason.includes("no third source"), f.reason);
});

check("ULL-19 the S128-6 ORDER itself — sudo first, plain only on failure, never both", () => {
  // The fallback is factored out precisely so this can be held without
  // shelling out. A ruling no test in the suite can reach is a ruling on paper.
  const calls: string[] = [];
  const sudoOk = (): { readonly ok: true; readonly text: string } => {
    calls.push("sudo");
    return { ok: true, text: "SUDO TABLE" };
  };
  const sudoFails = (): { readonly ok: false; readonly error: string } => {
    calls.push("sudo");
    return { ok: false, error: "a password is required" };
  };
  const plainOk = (): { readonly ok: true; readonly text: string } => {
    calls.push("plain");
    return { ok: true, text: "PLAIN TABLE" };
  };
  const plainFails = (): { readonly ok: false; readonly error: string } => {
    calls.push("plain");
    return { ok: false, error: "spawn ss ENOENT" };
  };

  calls.length = 0;
  const granted = readSocketsWithFallback(sudoOk, plainOk);
  assert.deepStrictEqual(calls, ["sudo"], "a successful sudo read must NOT also run the plain one");
  assert.ok(granted.ok && granted.via === "sudo" && granted.text === "SUDO TABLE");

  calls.length = 0;
  const fellBack = readSocketsWithFallback(sudoFails, plainOk);
  assert.deepStrictEqual(calls, ["sudo", "plain"], "sudo is tried FIRST, then the plain read");
  assert.ok(fellBack.ok && fellBack.via === "plain" && fellBack.text === "PLAIN TABLE");

  calls.length = 0;
  const neither = readSocketsWithFallback(sudoFails, plainFails);
  assert.deepStrictEqual(calls, ["sudo", "plain"]);
  assert.ok(!neither.ok, "neither read produced a table");
  if (!neither.ok) {
    assert.ok(neither.error.includes("a password is required"), neither.error);
    assert.ok(neither.error.includes("spawn ss ENOENT"), neither.error);
  }
});

check("ULL-20 the sudoers drop-in grants EXACTLY the command the reader runs, and no wildcard", () => {
  // The drop-in and SS_SUDO_PATH/SS_ARGS are two halves of one grant, and sudo
  // matches the command WITH ITS ARGUMENTS. If they drift, the grant stops
  // matching — survivable (the plain read runs) but silently weaker, and the
  // point of pinning them together here is that it cannot drift unnoticed.
  const text = readFileSync(join(__dirname, "..", "..", "deploy", "mica-report-ss.sudoers"), "utf8");
  const rules = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  assert.deepStrictEqual(
    rules,
    [`REPLACE-WITH-THE-REPORT-PRINCIPAL ALL=(root) NOPASSWD: ${SS_SUDO_PATH} ${SS_ARGS.join(" ")}`],
    "exactly ONE rule, and it is the command the reader actually runs"
  );
  // `ss -K` closes sockets. A grant of the bare binary would hand this
  // principal the ability to kill any connection on the box, so the argument
  // list is the fence and a wildcard would remove it.
  assert.ok(!rules[0].includes("*"), "no wildcard may appear in the granted command");
  assert.ok(rules[0].includes("NOPASSWD:"), "the reader calls sudo -n and must never meet a prompt");
  // R-V3, the same rule mica-report.service is held to: no guessed account name.
  assert.ok(
    rules[0].startsWith("REPLACE-WITH-THE-REPORT-PRINCIPAL "),
    "the principal is a deploy-time declaration, never checked in"
  );
});

console.log("\n── the whole reading — header counts, negative-only rows ───────");

check("HELD facts earn a count and NO row; FACT_ABSENT/CANNOT_ASSESS facts earn a row each", () => {
  const dir = fixture("wholereading");
  const goodPath = join(dir, "good");
  writeFileSync(goodPath, "x");
  chmodSync(goodPath, 0o644);
  const decl = loadDeploymentFactsDeclaration(
    writeDecl(dir, [
      { id: "held1", family: "file-mode", path: goodPath, mode: "644" },
      { id: "absent1", family: "file-mode", path: goodPath, mode: "600" },
      { id: "cannot1", family: "file-mode", path: join(dir, "nope"), mode: "600" },
    ])
  );
  const reading = assessDeploymentFacts(decl);
  assert.strictEqual(reading.heldCount, 1);
  assert.strictEqual(reading.factAbsentCount, 1);
  assert.strictEqual(reading.cannotAssessCount, 1);
  assert.strictEqual(reading.findings.length, 2, "HELD earns no row — only the other two");
  assert.strictEqual(findingFor(reading.findings, "held1"), undefined);
  assert.ok(findingFor(reading.findings, "absent1") !== undefined);
  assert.ok(findingFor(reading.findings, "cannot1") !== undefined);
});

console.log("\n── CONTROL — the mechanism can actually fail, end to end, from a JSON file on disk ──");

check("CONTROL: a declaration file matching a DELIBERATELY-BROKEN real fixture prints FACT_ABSENT", () => {
  // The VACUOUS-PASS fence: a check never shown to fail is a check nobody
  // has proven works. This exercises the FULL pipeline — a real JSON file on
  // disk, loaded, assessed against a real file whose real mode is wrong.
  const dir = fixture("negative-control");
  const p = join(dir, "clerk.sock");
  writeFileSync(p, "x");
  chmodSync(p, 0o777); // deliberately NOT the declared 660
  const declPath = writeDecl(dir, [{ id: "clerk-socket-mode", family: "file-mode", path: p, mode: "660" }]);
  const decl = loadDeploymentFactsDeclaration(declPath);
  assert.strictEqual(decl.state, "CONFIGURED");
  const reading = assessDeploymentFacts(decl);
  assert.strictEqual(reading.factAbsentCount, 1, "the broken fixture must be CAUGHT, not silently passed");
  assert.strictEqual(reading.heldCount, 0);
  const f = findingFor(reading.findings, "clerk-socket-mode");
  assert.strictEqual(f?.state, "FACT_ABSENT");
});

rmSync(root, { recursive: true, force: true });

// ══════════════════════════════════════════════════════════════════════════
console.log("\n── pilot-review-in-ledger (S133, wire B) — the spine, read as a book ──");

/** One ledger line, written by the test. The sha is computed, never typed. */
function ledgerWith(
  dir: string,
  chainSha256: string,
  moduleId = "mica-arbiter",
  eventType = "PILOT_CHAIN_REVIEWED"
): string {
  const path = join(dir, "mica-log.jsonl");
  writeFileSync(
    path,
    [
      JSON.stringify({
        sequenceNumber: 7,
        timestamp: 1,
        moduleId: "mica-registrar",
        eventType: "DEPOSIT_ACCEPTED",
        outcome: "somebody else's record, in the same book",
      }),
      JSON.stringify({
        sequenceNumber: 3,
        timestamp: 2,
        moduleId,
        eventType,
        outcome: `chain=${chainSha256} subject=mica-subject1 run=pilot8-n5`,
      }),
    ].join("\n") + "\n",
    "utf8"
  );
  return path;
}

const CHAIN_A = createHash("sha256").update("pilot 8's chain", "utf8").digest("hex");
const CHAIN_B = createHash("sha256").update("some other chain", "utf8").digest("hex");

check("pilot-review-in-ledger HELD — the ledger names this chain, and the row says who and where", () => {
  const dir = fixture("plr-held");
  const micaLog = ledgerWith(dir, CHAIN_A);
  const decl = loadDeploymentFactsDeclaration(
    writeDecl(dir, [{ id: "plr", family: "pilot-review-in-ledger", micaLog, chainSha256: CHAIN_A }])
  );
  assert.strictEqual(decl.state, "CONFIGURED", JSON.stringify(decl.problems));
  const reading = assessDeploymentFacts(decl, {});
  assert.strictEqual(reading.findings.length, 0, "a HELD fact earns no row");
  assert.strictEqual(reading.heldCount, 1);
});

check("pilot-review-in-ledger FACT_ABSENT — the ledger is readable and does not name this chain", () => {
  const dir = fixture("plr-absent");
  // The book exists, is well formed, and carries a DIFFERENT chain's review.
  const micaLog = ledgerWith(dir, CHAIN_B);
  const decl = loadDeploymentFactsDeclaration(
    writeDecl(dir, [{ id: "plr", family: "pilot-review-in-ledger", micaLog, chainSha256: CHAIN_A }])
  );
  const reading = assessDeploymentFacts(decl, {});
  assert.strictEqual(reading.findings.length, 1);
  assert.strictEqual(reading.findings[0].state, "FACT_ABSENT");
  assert.ok(reading.findings[0].reason.includes("carries no PILOT_CHAIN_REVIEWED"), reading.findings[0].reason);
});

check("pilot-review-in-ledger CANNOT_ASSESS — an unreadable ledger is NOT an absent review", () => {
  const dir = fixture("plr-unreadable");
  const decl = loadDeploymentFactsDeclaration(
    writeDecl(dir, [
      {
        id: "plr",
        family: "pilot-review-in-ledger",
        micaLog: join(dir, "there-is-no-ledger-here.jsonl"),
        chainSha256: CHAIN_A,
      },
    ])
  );
  const reading = assessDeploymentFacts(decl, {});
  assert.strictEqual(reading.findings.length, 1);
  // THE DISTINCTION THE WHOLE FAMILY TURNS ON. "I could not open the book" is
  // not "the book does not say it", and a reader that collapsed them would
  // report a permission fault as an unreviewed pilot — the same two-valued
  // collapse the registrar refuses with CANNOT_SEE_FRAME.
  assert.strictEqual(reading.findings[0].state, "CANNOT_ASSESS");
  assert.ok(reading.findings[0].reason.includes("could not be read"), reading.findings[0].reason);
});

check("pilot-review-in-ledger FACT_ABSENT — a seat that reviewed its OWN chain is not a review", () => {
  const dir = fixture("plr-selfreview");
  const micaLog = ledgerWith(dir, CHAIN_A, "mica-subject1");
  const decl = loadDeploymentFactsDeclaration(
    writeDecl(dir, [
      {
        id: "plr",
        family: "pilot-review-in-ledger",
        micaLog,
        chainSha256: CHAIN_A,
        writer: "mica-subject1",
      },
    ])
  );
  assert.strictEqual(decl.state, "CONFIGURED", JSON.stringify(decl.problems));
  const reading = assessDeploymentFacts(decl, {});
  assert.strictEqual(reading.findings.length, 1);
  assert.strictEqual(reading.findings[0].state, "FACT_ABSENT");
  assert.ok(reading.findings[0].reason.includes("is the principal declared as the chain's WRITER"), reading.findings[0].reason);
  // AND THE SAME LEDGER WITHOUT THE `writer` DECLARATION READS HELD — so the
  // check is the declaration's doing, never this reader deciding who may review.
  const without = loadDeploymentFactsDeclaration(
    writeDecl(fixture("plr-selfreview-2"), [
      { id: "plr", family: "pilot-review-in-ledger", micaLog, chainSha256: CHAIN_A },
    ])
  );
  assert.strictEqual(assessDeploymentFacts(without, {}).heldCount, 1);
});

check("pilot-review-in-ledger — the WRONG eventType in the book is not a match", () => {
  const dir = fixture("plr-kind");
  // Same chain sha, same writer, a record that says something else happened.
  const micaLog = ledgerWith(dir, CHAIN_A, "mica-arbiter", "DEPOSIT_SUBMITTED");
  const decl = loadDeploymentFactsDeclaration(
    writeDecl(dir, [{ id: "plr", family: "pilot-review-in-ledger", micaLog, chainSha256: CHAIN_A }])
  );
  const reading = assessDeploymentFacts(decl, {});
  assert.strictEqual(reading.findings[0].state, "FACT_ABSENT");
});

check("pilot-review-in-ledger — a malformed declaration collapses the WHOLE file, per this module's rule", () => {
  const dir = fixture("plr-malformed");
  for (const bad of [
    { id: "a", family: "pilot-review-in-ledger", chainSha256: CHAIN_A },
    { id: "b", family: "pilot-review-in-ledger", micaLog: join(dir, "l.jsonl"), chainSha256: "not-a-sha" },
    { id: "c", family: "pilot-review-in-ledger", micaLog: join(dir, "l.jsonl"), chainSha256: CHAIN_A.toUpperCase() },
    { id: "d", family: "pilot-review-in-ledger", micaLog: join(dir, "l.jsonl"), chainSha256: CHAIN_A, writer: "" },
  ]) {
    const decl = loadDeploymentFactsDeclaration(writeDecl(fixture(`plr-bad-${bad.id}`), [bad]));
    assert.strictEqual(decl.state, "CONFIGURED_EMPTY", JSON.stringify(bad));
    assert.strictEqual(decl.problems.length, 1, JSON.stringify(decl.problems));
  }
});



// ── S134 Rb · TWO LINES, ONE ACT, NEVER SUMMED ─────────────────────────
console.log("\n── pilot-review-in-ledger (S134 Rb) — the record book is the authoritative line ──");

/** A record book holding one PILOT_CHAIN_REVIEWED for the given chain sha. */
function recordBookWith(dir: string, chainSha256: string, depositor = "mica-arbiter"): string {
  const bookDir = join(dir, "record", depositor);
  mkdirSync(bookDir, { recursive: true });
  const path = join(bookDir, "records.jsonl");
  const book = new RecordBook({ path });
  book.writeReviewed({
    depositor,
    book: depositor,
    timestamp: 1,
    modality: "NOT_AN_INSTRUCTION",
    chainSha256,
    reviewLogSequenceNumber: 7,
  });
  return path;
}

check("Rb · with NO record book declared, the family reads as it did at S133 and says so", () => {
  const dir = fixture("plr-nobook");
  const micaLog = ledgerWith(dir, CHAIN_A);
  const decl = loadDeploymentFactsDeclaration(
    writeDecl(dir, [{ id: "plr", family: "pilot-review-in-ledger", micaLog, chainSha256: CHAIN_A }])
  );
  const reading = assessDeploymentFacts(decl, {});
  // A HELD fact earns no row, so the detail is not in the reading — what is
  // asserted is that the S133 path still HOLDS when no book is declared, i.e.
  // that adding the book did not make the old declaration shape fail.
  assert.strictEqual(reading.heldCount, 1);
  assert.strictEqual(reading.findings.length, 0);
});

check("Rb · the BOOK is the line the family holds on; the journal corroborates it", () => {
  const dir = fixture("plr-book-held");
  const micaLog = ledgerWith(dir, CHAIN_A);
  const recordBook = recordBookWith(dir, CHAIN_A);
  const decl = loadDeploymentFactsDeclaration(
    writeDecl(dir, [
      { id: "plr", family: "pilot-review-in-ledger", micaLog, chainSha256: CHAIN_A, recordBook },
    ])
  );
  assert.strictEqual(decl.state, "CONFIGURED", JSON.stringify(decl.problems));
  const reading = assessDeploymentFacts(decl, {});
  assert.strictEqual(reading.heldCount, 1);
  assert.strictEqual(reading.findings.length, 0);
});

check("Rb · the journal names it and the BOOK DOES NOT — a narration is not a record", () => {
  // THE CASE THE SECOND BOOK EXISTS FOR. `mica-arbiter` writing "I reviewed this
  // chain" into a journal it owns by ACL is a self-report; the registrar's
  // acceptance under owner-uid identity is the second party. A family that HELD
  // on the journal alone here would be holding on the broadcast.
  const dir = fixture("plr-book-absent");
  const micaLog = ledgerWith(dir, CHAIN_A);
  const recordBook = recordBookWith(dir, CHAIN_B); // a DIFFERENT chain
  const decl = loadDeploymentFactsDeclaration(
    writeDecl(dir, [
      { id: "plr", family: "pilot-review-in-ledger", micaLog, chainSha256: CHAIN_A, recordBook },
    ])
  );
  const reading = assessDeploymentFacts(decl, {});
  assert.strictEqual(reading.heldCount, 0, "a journal-only review was HELD");
  assert.strictEqual(reading.findings.length, 1);
  const said = JSON.stringify(reading.findings[0]);
  assert.ok(said.includes("FACT_ABSENT"), said);
  assert.ok(said.includes("broadcast"), said);
});

check("Rb · an UNREADABLE record book is CANNOT_ASSESS, never a HELD on the journal alone", () => {
  // "I could not open the authoritative line" is not "the authoritative line
  // agrees with the journal". The same two-valued collapse the spine reader and
  // the registrar both refuse.
  const dir = fixture("plr-book-unreadable");
  const micaLog = ledgerWith(dir, CHAIN_A);
  const decl = loadDeploymentFactsDeclaration(
    writeDecl(dir, [
      {
        id: "plr",
        family: "pilot-review-in-ledger",
        micaLog,
        chainSha256: CHAIN_A,
        // A path whose DIRECTORY was never deployed: the book throws rather
        // than creating its own room.
        recordBook: join(dir, "never-deployed", "records.jsonl"),
      },
    ])
  );
  const reading = assessDeploymentFacts(decl, {});
  assert.strictEqual(reading.heldCount, 0);
  const said = JSON.stringify(reading.findings[0]);
  assert.ok(said.includes("CANNOT_ASSESS"), said);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
