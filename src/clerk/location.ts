// ──────────────────────────────────────────────────────────────────────────────
// ILAS — CLERK 1: where the store lives. C6 — a declared, stable location.
//
// Path arithmetic only. No filesystem writes anywhere in this module, so the
// standalone reader can import it without pulling a write path into its closure.
//
// Resolution order, and it does not change:
//   1. an explicit directory (--store, or the `storeDir` option)
//   2. process.env.ILAS_CLERK_STORE
//   3. <cwd>/.ilas-clerk
//
// "Wherever the process happened to put it" is not a location. Documented in
// src/clerk/README.md.
// ──────────────────────────────────────────────────────────────────────────────

import { resolve } from "path";
import { STORE_DIR_ENV } from "./types";

export const DEFAULT_STORE_DIRNAME = ".ilas-clerk";

export function resolveStoreDir(explicit?: string | null): string {
  if (explicit != null && explicit.length > 0) return resolve(explicit);
  const fromEnv = process.env[STORE_DIR_ENV];
  if (fromEnv != null && fromEnv.length > 0) return resolve(fromEnv);
  return resolve(process.cwd(), DEFAULT_STORE_DIRNAME);
}

/** How the location was decided, for printing. */
export function describeStoreDirSource(explicit?: string | null): string {
  if (explicit != null && explicit.length > 0) return "explicit --store / storeDir option";
  const fromEnv = process.env[STORE_DIR_ENV];
  if (fromEnv != null && fromEnv.length > 0) return `${STORE_DIR_ENV} environment variable`;
  return `default: <cwd>/${DEFAULT_STORE_DIRNAME}`;
}
