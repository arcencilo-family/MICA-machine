// ──────────────────────────────────────────────────────────────────────────────
// ILAS — CLERK 1: the store, WRITER side. Object A (infrastructure).
//
// Append-only in the happy path, and that is the honest width of the claim:
// the process only ever appends, and rewrites exactly one file (head.json,
// which is a statement ABOUT the chain and not part of it). Nothing here makes
// the filesystem append-only. A party with write access to this directory can
// still edit or remove lines — the point is that doing so is visible, not that
// it is prevented.
//
// LOCATION (C6). One directory, configured, documented, stable:
//   1. explicit `storeDir` option / --store flag, else
//   2. process.env.ILAS_CLERK_STORE, else
//   3. <cwd>/.ilas-clerk
// See src/clerk/README.md.
// ──────────────────────────────────────────────────────────────────────────────

import { appendFileSync, renameSync, statSync, writeFileSync } from "fs";
import type { Stats } from "fs";
import { join } from "path";
import { STORE_FILES } from "./types";
import type { ClerkRecord, HeadAnchor } from "./types";

// The location rules live in location.ts, which has no write path, so the
// standalone reader can import them without importing this file.
export { DEFAULT_STORE_DIRNAME, resolveStoreDir, describeStoreDirSource } from "./location";

export class ClerkStoreWriteError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ClerkStoreWriteError";
  }
}

/**
 * A deployment act named in the recipe was never performed. Typed so a caller
 * can tell "the deployer skipped a step" apart from "the disk broke" — the two
 * want different people.
 */
export class ClerkDeploymentActMissingError extends Error {
  constructor(
    message: string,
    readonly path: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "ClerkDeploymentActMissingError";
  }
}

/**
 * The clerk store directory is a DEPLOYMENT ACT (recipe §4.1). This checks; it
 * never creates. Shared with `keys.ts`, whose key file lives in this same
 * directory and therefore rests on the same act.
 *
 * `statSync` rather than `existsSync` so that "I cannot see it" is not reported
 * as "it is not there": a directory this process may not enter fails here too,
 * and the underlying errno rides along in the message saying which.
 */
export function requireClerkStoreDir(
  dir: string,
  subject: string,
  alsoNotDone = ""
): void {
  const signpost =
    `${subject} absent — this is a deployment act (deploy recipe §4.1). ` +
    `Expected: ${dir} at 2750 mica-clerk:mica-readers. ` +
    `Nothing was created${alsoNotDone}.`;
  let stats: Stats;
  try {
    stats = statSync(dir);
  } catch (err) {
    throw new ClerkDeploymentActMissingError(
      `${signpost} (${String(err)})`,
      dir,
      err
    );
  }
  if (!stats.isDirectory()) {
    throw new ClerkDeploymentActMissingError(
      `${signpost} That path exists and is not a directory.`,
      dir
    );
  }
}

export class ClerkStore {
  readonly dir: string;
  readonly receiptsPath: string;
  readonly headPath: string;
  readonly publicKeyPath: string;
  readonly privateKeyPath: string;

  constructor(dir: string) {
    this.dir = dir;
    this.receiptsPath = join(dir, STORE_FILES.receipts);
    this.headPath = join(dir, STORE_FILES.head);
    this.publicKeyPath = join(dir, STORE_FILES.publicKey);
    this.privateKeyPath = join(dir, STORE_FILES.privateKey);
  }

  /**
   * ── THE CLERK DOES NOT CREATE ITS OWN STORE DIRECTORY (S96-D, S97) ─────────
   *
   *   This body was `mkdirSync(this.dir, { recursive: true })` until
   *   2026-08-31, and the method was called `ensure()`. Recipe §4.1 makes this
   *   directory `2750 mica-clerk:mica-readers`, and says the `2` is
   *   load-bearing: without setgid the receipts inside inherit the clerk's
   *   PRIMARY group — a group of exactly one member — and §4.2's `0640` then
   *   grants group-read to nobody. The doctor, the operator and the arbiter are
   *   locked out of the record, and every mode reads exactly as specified.
   *   A directory conjured here is that failure, manufactured on first boot.
   *
   *   The name went with the body. A method called `ensure` that ensures
   *   nothing is a small lie told at every call site, and this file's business
   *   is a record nobody can move later.
   *
   *   **Do not add a create-if-missing flag here**, and do not add one under a
   *   test-only branch: a fence with a bypass is not a fence.
   */
  requireDeployed(): void {
    requireClerkStoreDir(this.dir, "clerk store directory");
  }

  /**
   * Append one record. Throws on failure and never swallows: a clerk that
   * cannot write must not go on stamping receipts nobody will find.
   */
  append(record: ClerkRecord): void {
    try {
      appendFileSync(this.receiptsPath, JSON.stringify(record) + "\n", "utf8");
    } catch (err) {
      throw new ClerkStoreWriteError(
        `cannot append receipt at clerk_seq ${record.clerk_seq}: ${String(err)}`,
        err
      );
    }
  }

  /** Rewrite the signed tail statement. Temp-then-rename, so a crash mid-write
   *  leaves the previous anchor rather than a half-written one. */
  writeHead(anchor: HeadAnchor): void {
    const tmp = this.headPath + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(anchor, null, 2) + "\n", "utf8");
      renameSync(tmp, this.headPath);
    } catch (err) {
      throw new ClerkStoreWriteError(
        `cannot write head anchor at clerk_seq ${anchor.clerk_seq}: ${String(err)}`,
        err
      );
    }
  }
}
