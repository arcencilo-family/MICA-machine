// ──────────────────────────────────────────────────────────────────────────────
// ILAS — CLERK 1: SUBMITTER CREDENTIALS. Object A (infrastructure).
//
// THE DEFECT THIS CLOSES. `channel` and `submitter_id` were unauthenticated
// strings the submitter declared and the clerk copied; the clerk's signature
// authenticates the CLERK, never the submitter. So anyone who could reach the
// submit socket could post on any channel as any submitter — including the
// observed system, on a channel belonging to a subsystem it had silenced. A
// dead probe-runner's channel stays warm and the gap detector reports quiet on
// a perfect chain. Silent, free, and it defeats the only completeness signal
// Clerk 1 buys.
//
// DORMANT MECHANISM, EMPTY ROSTER. The shape is Sig's F2 (src/mica/sig/index.ts):
// the mechanism is in scope, the map is not, because the map is
// deployment-specific. Here: WHICH SUBMITTER HOLDS WHICH KEY IS
// DEPLOYMENT-SPECIFIC. This file contains no roster, no default identity, and
// no path that generates a key for a submitter. Enrollment, distribution,
// rotation, revocation policy and certification are not this build's business
// and no code here decides them.
//
// AND, FROM SIG'S PRECEDENT, THE HALF THAT IS EASY TO LOSE: an EMPTY roster
// does not buy a clean reading. It describes zero enrolled submitters, which is
// not the same as zero impostors.
// ──────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "fs";
import type { KeyObject } from "crypto";
import { canonicalise, sha256Hex } from "./canonical";
import { publicKeyFromB64 } from "./signature";

/** The form the submitter signs. Documented so a submitter in any language can
 *  produce it: canonicalise() this object and sign the UTF-8 bytes, Ed25519. */
export const SUBMITTER_AUTH_FORM = "ILAS-CLERK-SUBMITTER-AUTH-1";

/**
 * Deployer-supplied configuration: identifier → base64 SPKI DER public key.
 * Supplied as an object, or as a path to a JSON file of the same shape.
 * THERE IS NO DEFAULT AND NO BUILT-IN ENTRY.
 */
export type SubmitterRoster = Readonly<Record<string, string>>;

export type RosterState =
  /** No roster supplied. Submissions are accepted and stamped unauthenticated. */
  | "ABSENT"
  /** A roster was supplied and holds no entries. Buys no clean reading. */
  | "CONFIGURED_EMPTY"
  /** A roster was supplied with at least one usable entry. */
  | "CONFIGURED";

export interface RosterEntry {
  submitterId: string;
  key: KeyObject;
  /** sha256 of the base64 SPKI, first 16 hex. Identifies the KEY, not the party. */
  fingerprint: string;
}

export interface LoadedRoster {
  state: RosterState;
  entries: ReadonlyMap<string, RosterEntry>;
  /** fingerprint → every identifier that shares that key. Usually one. */
  sharedKeys: ReadonlyMap<string, readonly string[]>;
  /** Hash over the sorted (id, fingerprint) pairs. Stamped in the BOOT record so
   *  a roster change between clerk runs is visible in the chain. */
  rosterFingerprint: string | null;
  /** "absent" | a file path | "inline". Printed, never inferred. */
  source: string;
  /** Load-time problems, recorded and never silently dropped. */
  problems: readonly string[];
}

const EMPTY_ROSTER: LoadedRoster = {
  state: "ABSENT",
  entries: new Map(),
  sharedKeys: new Map(),
  rosterFingerprint: null,
  source: "absent",
  problems: [],
};

export function keyFingerprint(publicKeyB64: string): string {
  return sha256Hex(publicKeyB64.trim()).slice(0, 16);
}

/**
 * Load a deployer-supplied roster. An unreadable or malformed roster is a
 * PROBLEM that is recorded, never a silent fallback to "no roster" — a
 * downgrade that happens quietly is the thing this file exists to prevent.
 */
export function loadRoster(
  config: string | SubmitterRoster | null | undefined
): LoadedRoster {
  if (config === null || config === undefined) return EMPTY_ROSTER;

  const problems: string[] = [];
  let raw: SubmitterRoster;
  let source: string;

  if (typeof config === "string") {
    source = config;
    if (!existsSync(config)) {
      return {
        ...EMPTY_ROSTER,
        state: "CONFIGURED_EMPTY",
        source,
        problems: [
          `roster file ${config} does not exist. A configured-but-missing roster ` +
            `is treated as CONFIGURED_EMPTY, never as ABSENT: the deployment asked ` +
            `for authentication and did not get it, and that must not read the same ` +
            `as never having asked.`,
        ],
      };
    }
    try {
      raw = JSON.parse(readFileSync(config, "utf8")) as SubmitterRoster;
    } catch (err) {
      return {
        ...EMPTY_ROSTER,
        state: "CONFIGURED_EMPTY",
        source,
        problems: [`roster file ${config} is not valid JSON: ${String(err)}`],
      };
    }
  } else {
    source = "inline";
    raw = config;
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ...EMPTY_ROSTER,
      state: "CONFIGURED_EMPTY",
      source,
      problems: ["roster is not an object of identifier → base64 public key"],
    };
  }

  const entries = new Map<string, RosterEntry>();
  const byFingerprint = new Map<string, string[]>();

  for (const submitterId of Object.keys(raw).sort()) {
    const b64 = raw[submitterId];
    if (typeof b64 !== "string" || b64.trim().length === 0) {
      problems.push(`entry \`${submitterId}\` has no public key; skipped`);
      continue;
    }
    let key: KeyObject;
    try {
      key = publicKeyFromB64(b64.trim());
    } catch (err) {
      problems.push(`entry \`${submitterId}\` has an unusable key: ${String(err)}; skipped`);
      continue;
    }
    const fingerprint = keyFingerprint(b64);
    entries.set(submitterId, { submitterId, key, fingerprint });
    const shared = byFingerprint.get(fingerprint) ?? [];
    shared.push(submitterId);
    byFingerprint.set(fingerprint, shared);
  }

  for (const [fp, ids] of byFingerprint) {
    if (ids.length > 1) {
      problems.push(
        `key ${fp} is shared by ${ids.length} identifiers (${ids.join(", ")}). ` +
          `Possession of it does not distinguish between them, and receipts ` +
          `authenticated by it say so.`
      );
    }
  }

  if (entries.size === 0) {
    return {
      ...EMPTY_ROSTER,
      state: "CONFIGURED_EMPTY",
      source,
      problems: [
        ...problems,
        "the roster holds no usable entries. An empty roster describes zero " +
          "enrolled submitters, which is not the same as zero impostors, and it " +
          "buys no clean reading.",
      ],
    };
  }

  const rosterFingerprint = sha256Hex(
    canonicalise(
      [...entries.values()].map((e) => [e.submitterId, e.fingerprint])
    )
  ).slice(0, 32);

  return {
    state: "CONFIGURED",
    entries,
    sharedKeys: byFingerprint,
    rosterFingerprint,
    source,
    problems,
  };
}

// ── what the submitter signs ─────────────────────────────────────────────────
//
// §3's property: the material must be something the submitter cannot choose
// freely and cannot reuse.
//
//   nonce               — CLERK-CHOSEN, single-use, short-lived, and consumed on
//                         first presentation. The submitter cannot choose it and
//                         cannot present it twice. This is what kills replay.
//   clerk_id            — a capture cannot be replayed against a different clerk.
//   channel             — a capture cannot be re-posted on a different channel.
//   submitter_id        — a capture cannot be re-posted under a different name.
//   payload_commitment  — the bytes are bound; the signature is not detachable
//                         from the content it arrived with.
//
// The nonce alone would stop replay. The other four are there so a captured
// submission cannot be re-aimed even inside the window in which its nonce is
// still live — which is the interval a race would need.

export interface SubmitterAuthMaterial {
  form: typeof SUBMITTER_AUTH_FORM;
  clerk_id: string;
  nonce: string;
  submitter_id: string;
  channel: string;
  payload_commitment: string;
}

export function submitterAuthPreimage(m: Omit<SubmitterAuthMaterial, "form">): string {
  const material: SubmitterAuthMaterial = { form: SUBMITTER_AUTH_FORM, ...m };
  return canonicalise(material);
}
