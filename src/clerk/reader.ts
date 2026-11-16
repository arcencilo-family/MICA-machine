#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// ILAS — CLERK 1: THE STANDALONE READER.
//
//   npx ts-node src/clerk/reader.ts --store <dir> [--pubkey <path|base64>]
//                                   [--now <wall_ms>] [--json]
//
// This is a separate entry point a person can run. It is not a library call and
// not a debug flag on the observed system's binary. IT IMPORTS NOTHING FROM THE
// OBSERVED SYSTEM: no `../l0`, no `../index`, no `../types`, no `../mica`, no
// `../s4`. Its whole import closure is node built-ins plus files in this
// directory, and a test walks that closure and fails if it ever stops being
// true. If reading the record required the watched thing's tooling, the record
// would not have left the loop.
//
// It also opens nothing for writing. It cannot repair, compact, or re-sign the
// store it is reading.
// ──────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "fs";
import { describeStoreDirSource, resolveStoreDir } from "./location";
import { readGaps, renderGapRead } from "./gap";
import { readStore } from "./read-store";
import { describeScope } from "./scope";
import {
  IN_PROCESS_WARNING,
  readSubmitterAuth,
  READER_PRESUMPTION,
  SEPARATE_PROCESS_BOUND,
  STORE_DIR_ENV,
  STORE_FILES,
} from "./types";
import type { ClerkRecord, SeparationMode } from "./types";
import { renderVerification, verifyChain } from "./verify";
import type { ChainVerification, TrustAnchor } from "./verify";

interface ReaderArgs {
  store: string | null;
  pubkey: string | null;
  now: number;
  json: boolean;
}

export function parseArgs(argv: readonly string[]): ReaderArgs {
  const args: ReaderArgs = { store: null, pubkey: null, now: Date.now(), json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--store") args.store = argv[++i] ?? null;
    else if (a === "--pubkey") args.pubkey = argv[++i] ?? null;
    else if (a === "--now") args.now = Number(argv[++i]);
    else if (a === "--json") args.json = true;
  }
  if (!Number.isFinite(args.now)) args.now = Date.now();
  return args;
}

/** A --pubkey value is either a path to a key file or the base64 key itself. */
export function resolvePublicKeyArg(
  value: string | null
): { key: string; anchor: TrustAnchor } | null {
  if (value === null) return null;
  if (existsSync(value)) {
    return { key: readFileSync(value, "utf8").trim(), anchor: "OUT_OF_BAND" };
  }
  return { key: value.trim(), anchor: "OUT_OF_BAND" };
}

export interface ReaderReport {
  storeDir: string;
  storeDirSource: string;
  verification: ChainVerification;
  gaps: ReturnType<typeof readGaps> | null;
  separationModesSeen: readonly SeparationMode[];
  clerkPrincipalsSeen: readonly string[];
  recordCounts: Record<string, number>;
  /**
   * Records stamped SEPARATE_PROCESS that the clerk nonetheless received as a
   * direct in-process call. `separation` is what the deployment declared;
   * `intake` is what the clerk observed. When they disagree, the declaration is
   * not supported for those records — and this is the check that catches a
   * clerk daemon started inside the observed system's own process.
   */
  unsupportedSeparationSeqs: readonly number[];
  credentials: CredentialReport;
}

export interface CredentialReport {
  /** From the most recent BOOT record. A v1 BOOT has none — reported as such. */
  rosterState: string;
  rosterSize: number | null;
  rosterFingerprint: string | null;
  rosterSource: string | null;
  rosterProblems: readonly string[];
  /** Every distinct roster fingerprint seen, oldest first. >1 means it changed. */
  rosterHistory: readonly { clerk_seq: number; state: string; fingerprint: string | null }[];
  /** Count of submissions by authentication state. */
  authCounts: Record<string, number>;
  /** declared submitter_id → the key fingerprints that ever authenticated it. */
  submitterKeys: Record<string, readonly string[]>;
  refusals: readonly {
    clerk_seq: number;
    reason: string;
    channel: string;
    declared_submitter_id: string;
    suppressed_since_last: number;
  }[];
  /** AUTHENTICATED submissions the clerk received as a direct in-process call. */
  authenticatedButLocalCallSeqs: readonly number[];
}

export function buildReport(args: ReaderArgs): ReaderReport {
  const storeDir = resolveStoreDir(args.store);
  const store = readStore(storeDir);

  const supplied = resolvePublicKeyArg(args.pubkey);
  const key =
    supplied !== null
      ? supplied.key
      : store.kind === "STORE_READ"
        ? store.storePublicKeyB64
        : null;
  const anchor: TrustAnchor =
    supplied !== null ? supplied.anchor : key === null ? "NONE" : "FROM_STORE";

  const verification = verifyChain(store, { publicKeyB64: key, trustAnchor: anchor });

  const records: readonly ClerkRecord[] =
    store.kind === "STORE_READ" ? store.records : [];

  const gaps =
    records.length === 0 && store.kind !== "STORE_READ"
      ? null
      : readGaps(records, { now: args.now, verification });

  const modes = new Set<SeparationMode>();
  const principals = new Set<string>();
  const counts: Record<string, number> = {};
  const unsupported: number[] = [];
  for (const r of records) {
    modes.add(r.separation);
    principals.add(r.clerk_principal);
    counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    if (r.separation === "SEPARATE_PROCESS" && r.intake === "LOCAL_CALL") {
      unsupported.push(r.clerk_seq);
    }
  }

  return {
    storeDir,
    storeDirSource: describeStoreDirSource(args.store),
    credentials: buildCredentialReport(records),
    verification,
    gaps,
    separationModesSeen: [...modes],
    clerkPrincipalsSeen: [...principals],
    recordCounts: counts,
    unsupportedSeparationSeqs: unsupported,
  };
}

function buildCredentialReport(records: readonly ClerkRecord[]): CredentialReport {
  const rosterHistory: { clerk_seq: number; state: string; fingerprint: string | null }[] = [];
  const authCounts: Record<string, number> = {};
  const submitterKeys: Record<string, Set<string>> = {};
  const refusals: CredentialReport["refusals"] = [];
  const authLocalCall: number[] = [];
  let latestBoot: ClerkRecord | null = null;

  for (const r of records) {
    if (r.kind === "BOOT") {
      latestBoot = r;
      rosterHistory.push({
        clerk_seq: r.clerk_seq,
        // A v1 BOOT record has no roster fields. Say so; do not default it.
        state: r.roster_state ?? "UNKNOWN_PRE_CREDENTIALS",
        fingerprint: r.roster_fingerprint ?? null,
      });
    } else if (r.kind === "SUBMISSION") {
      const auth = readSubmitterAuth(r);
      authCounts[auth.state] = (authCounts[auth.state] ?? 0) + 1;
      if (auth.state === "AUTHENTICATED") {
        if (r.intake === "LOCAL_CALL") authLocalCall.push(r.clerk_seq);
        if (auth.submitter_key_fp !== null) {
          const set = submitterKeys[r.submitter_id] ?? new Set<string>();
          set.add(auth.submitter_key_fp);
          submitterKeys[r.submitter_id] = set;
        }
      }
    } else if (r.kind === "REFUSAL") {
      (refusals as { clerk_seq: number; reason: string; channel: string; declared_submitter_id: string; suppressed_since_last: number }[]).push({
        clerk_seq: r.clerk_seq,
        reason: r.reason,
        channel: r.channel,
        declared_submitter_id: r.declared_submitter_id,
        suppressed_since_last: r.suppressed_since_last,
      });
    }
  }

  const boot = latestBoot !== null && latestBoot.kind === "BOOT" ? latestBoot : null;
  const keys: Record<string, readonly string[]> = {};
  for (const [id, set] of Object.entries(submitterKeys)) keys[id] = [...set];

  return {
    rosterState: boot?.roster_state ?? "UNKNOWN_PRE_CREDENTIALS",
    rosterSize: boot?.roster_size ?? null,
    rosterFingerprint: boot?.roster_fingerprint ?? null,
    rosterSource: boot?.roster_source ?? null,
    rosterProblems: boot?.roster_problems ?? [],
    rosterHistory,
    authCounts,
    submitterKeys: keys,
    refusals,
    authenticatedButLocalCallSeqs: authLocalCall,
  };
}

function renderCredentials(c: CredentialReport): string[] {
  const out: string[] = [];
  out.push(`SUBMITTER CREDENTIALS — who wrote these lines, and what that is worth`);
  out.push(
    `  roster in force : ${c.rosterState}` +
      (c.rosterSize === null ? "" : ` (${c.rosterSize} entries)`) +
      (c.rosterSource === null ? "" : `, source: ${c.rosterSource}`)
  );
  if (c.rosterFingerprint !== null) {
    out.push(`  roster fp       : ${c.rosterFingerprint}`);
  }
  for (const p of c.rosterProblems) out.push(`  roster problem  : ${p}`);

  const distinctRosters = [...new Set(c.rosterHistory.map((h) => `${h.state}:${String(h.fingerprint)}`))];
  if (distinctRosters.length > 1) {
    out.push(
      `  !! THE ROSTER CHANGED DURING THIS STORE'S HISTORY. ` +
        c.rosterHistory
          .map((h) => `clerk_seq ${h.clerk_seq}: ${h.state}/${String(h.fingerprint)}`)
          .join(" → ") +
        `. A change from CONFIGURED to ABSENT or CONFIGURED_EMPTY is a ` +
        `DOWNGRADE of authentication. This reader reports it; nothing prevented it.`
    );
  }

  if (Object.keys(c.authCounts).length === 0) {
    out.push(`  submissions     : none`);
  } else {
    out.push(
      `  submissions     : ` +
        Object.entries(c.authCounts)
          .map(([k, n]) => `${k}=${n}`)
          .join(" ")
    );
  }

  for (const [id, fps] of Object.entries(c.submitterKeys)) {
    if (fps.length > 1) {
      out.push(
        `  !! declared submitter \`${id}\` was authenticated by ${fps.length} ` +
          `DIFFERENT keys over this store's history (${fps.join(", ")}). That is a ` +
          `roster change, a key rotation, or two parties under one name — this ` +
          `reader cannot tell which, and does not guess.`
      );
    }
  }

  if (c.authenticatedButLocalCallSeqs.length > 0) {
    out.push(
      `  !! ${c.authenticatedButLocalCallSeqs.length} AUTHENTICATED submission(s) ` +
        `reached the clerk as a DIRECT IN-PROCESS CALL (clerk_seq ` +
        `${c.authenticatedButLocalCallSeqs.join(", ")}). A credential checked ` +
        `inside the submitter's own address space proves nothing about who ran ` +
        `the code: the caller held the key, the clerk, and the store at once.`
    );
  }

  if (c.refusals.length > 0) {
    out.push(`  refusals recorded (a refusal is an event, never an accusation):`);
    for (const r of c.refusals.slice(0, 20)) {
      out.push(
        `    · clerk_seq ${r.clerk_seq} ${r.reason} channel=${r.channel} ` +
          `declared=${r.declared_submitter_id}` +
          (r.suppressed_since_last > 0
            ? ` (+${r.suppressed_since_last} identical refusals suppressed by rate limit since the last record)`
            : "")
      );
    }
    if (c.refusals.length > 20) {
      out.push(`    … and ${c.refusals.length - 20} more`);
    }
  } else {
    out.push(
      `  refusals        : none recorded. Note the bound: refusal records are ` +
        `RATE-LIMITED, so "none" means none was recorded, not that none occurred.`
    );
  }

  out.push(
    `  WHAT AN AUTHENTICATED CLAIM DOES NOT MEAN. It means the submitting party ` +
      `held the private key this deployment's roster binds to that identifier. ` +
      `It does not mean the party IS that identifier — the binding is the ` +
      `deployer's roster, not this clerk's knowledge. It does not mean anything ` +
      `it said is true; an authenticated liar is authenticated.`
  );
  out.push(
    `  AND THE PRECONDITION THAT DOES NOT GO AWAY. A per-submitter key readable ` +
      `by the attacker buys nothing. If the observed system runs as the same OS ` +
      `principal as a submitter, it reads that submitter's key with an ordinary ` +
      `file read and launders the channel with a perfectly valid signature. This ` +
      `program cannot observe where submitter keys are kept or who can read ` +
      `them, and it does not pretend to: the check it performs is a signature ` +
      `check, and the separation it depends on is a deployment fact reported ` +
      `here as unverified.`
  );
  return out;
}

export function renderReport(report: ReaderReport): string {
  const bar = "─".repeat(76);
  const out: string[] = [];

  out.push(`┌${bar}`);
  out.push(`│ ILAS CLERK 1 — STANDALONE READER`);
  out.push(`│ A separate entry point. Imports nothing from the observed system,`);
  out.push(`│ and opens nothing for writing.`);
  out.push(`├${bar}`);
  for (const line of READER_PRESUMPTION) out.push(`│ ${line}`);
  out.push(`└${bar}`);
  out.push("");

  out.push(`STORE`);
  out.push(`  location : ${report.storeDir}`);
  out.push(`  chosen by: ${report.storeDirSource}`);
  out.push(`  files    : ${STORE_FILES.receipts} (chain) · ${STORE_FILES.head} (signed tail) · ${STORE_FILES.publicKey} (convenience key copy)`);
  out.push(`  configure: --store <dir>, or ${STORE_DIR_ENV}=<dir>`);
  out.push(
    `  records  : ` +
      (Object.keys(report.recordCounts).length === 0
        ? "none"
        : Object.entries(report.recordCounts)
            .map(([k, n]) => `${k}=${n}`)
            .join(" "))
  );
  out.push("");

  out.push(renderVerification(report.verification));
  out.push("");

  out.push(`SEPARATION — what these records are worth against the observed system`);
  if (report.separationModesSeen.length === 0) {
    out.push(`  no records, so no separation claim is made either way.`);
  }
  for (const m of report.separationModesSeen) {
    out.push(`  mode present in this store: ${m}`);
    if (m === "IN_PROCESS_NO_SEPARATION") {
      out.push(`  !! ${IN_PROCESS_WARNING}`);
    } else {
      out.push(`     ${SEPARATE_PROCESS_BOUND}`);
    }
  }
  if (report.separationModesSeen.length > 1) {
    out.push(
      `  !! THIS STORE MIXES MODES. Records written in-process carry no ` +
        `authority against the observed system; records written by a separate ` +
        `process do. Read them per record, never in aggregate.`
    );
  }
  if (report.unsupportedSeparationSeqs.length > 0) {
    out.push(
      `  !! ${report.unsupportedSeparationSeqs.length} record(s) are stamped ` +
        `SEPARATE_PROCESS but the clerk received them as a DIRECT IN-PROCESS ` +
        `CALL (intake=LOCAL_CALL), at clerk_seq ` +
        `${report.unsupportedSeparationSeqs.join(", ")}. \`separation\` is what ` +
        `the deployment declared; \`intake\` is what the clerk observed. For ` +
        `these records the separation claim is NOT SUPPORTED — read them as ` +
        `in-process records regardless of what the mode field says.`
    );
  }
  if (report.clerkPrincipalsSeen.length > 0) {
    out.push(`  clerk ran as OS principal: ${report.clerkPrincipalsSeen.join(", ")}`);
    out.push(
      `  If the observed system runs as that same principal, it can read the ` +
        `clerk's key file and delete this store. That is a deployment fact this ` +
        `program cannot change and does not claim to have changed.`
    );
  }
  out.push("");

  for (const line of renderCredentials(report.credentials)) out.push(line);
  out.push("");

  for (const line of describeScope()) out.push(line);
  out.push("");

  if (report.gaps === null) {
    out.push(`[clerk1.gap] GAP READ: not run — the store could not be opened.`);
  } else {
    out.push(renderGapRead(report.gaps));
  }
  out.push("");

  out.push(`BOUNDS OF THIS READING — stated, not mitigated`);
  out.push(
    `  · Wholesale deletion of this directory is an operator action. The clerk ` +
      `cannot survive its own machine, and a store that never existed is ` +
      `indistinguishable from here from one that was destroyed.`
  );
  out.push(
    `  · Every record here speaks against the observed system only. Nothing in ` +
      `this store is evidence about the operator who owns the machine.`
  );
  out.push(
    `  · A system that lies in real time — submitting false reports promptly, ` +
      `in order, under an honest clock — produces a store that verifies ` +
      `perfectly. The lie is preserved exactly.`
  );

  return out.join("\n");
}

/** Exit code: 0 clean read, 1 break found, 2 could not verify. */
export function exitCodeFor(v: ChainVerification): number {
  if (v.kind === "BREAK_FOUND") return 1;
  if (v.kind === "CANNOT_VERIFY") return 2;
  return 0;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport(args);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderReport(report));
  }
  process.exit(exitCodeFor(report.verification));
}
