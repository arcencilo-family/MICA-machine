// ──────────────────────────────────────────────────────────────────────────────
// ILAS — CLERK 1 (barrel).
//
// STATUS, at the honest width:
//
//   The clerk EXISTS and works: it receives submissions, canonicalises them,
//   stamps them with its own counter and its own clock, chains them, signs
//   them, and stores them where a person can read them without it.
//
//   The clerk is NOT YET the append path for ILAS's own L0 chain. Nothing under
//   src/l0 was changed by this build and nothing routes through here yet. The
//   pen-frame is AVAILABLE to be taken; for ILAS's own evidence log it has not
//   yet been taken. Rewiring L0's synchronous append() through an out-of-process
//   clerk is a separate dispatch with its own blast radius, and calling this
//   round "the observed system no longer writes its own logbook" would be false.
//
// Two objects, and they are graded differently:
//   Object A — infrastructure: core · store · client · clerkd · canonical · keys
//   Object B — a read instrument: gap.ts, and only gap.ts
// ──────────────────────────────────────────────────────────────────────────────

export * from "./types";
export { canonicalise, commit, sha256Hex, CANONICAL_FORM, CanonicalisationError } from "./canonical";
export { recordHash, recordPreimage, headPreimage } from "./preimage";
export { verifySignature, publicKeyFromB64, PublicKeyError, SIGNATURE_ALG } from "./signature";
export { loadOrCreateKeys, signPreimage } from "./keys";
export {
  loadRoster,
  keyFingerprint,
  submitterAuthPreimage,
  SUBMITTER_AUTH_FORM,
} from "./credentials";
export type {
  SubmitterRoster,
  RosterState,
  RosterEntry,
  LoadedRoster,
  SubmitterAuthMaterial,
} from "./credentials";
export {
  ClerkStore,
  ClerkStoreWriteError,
  ClerkDeploymentActMissingError,
  requireClerkStoreDir,
} from "./store";
export { DEFAULT_STORE_DIRNAME, resolveStoreDir, describeStoreDirSource } from "./location";
export { readStore } from "./read-store";
export type { StoreRead, StoreReadOk, StoreReadBlind, MalformedLine, StoreBlindReason } from "./read-store";
export {
  ClerkCore,
  SubmissionRejected,
  NonceUnavailable,
  DEFAULT_MAX_PAYLOAD_BYTES,
  DEFAULT_NONCE_TTL_MS,
  DEFAULT_MAX_OUTSTANDING_NONCES,
  DEFAULT_REFUSAL_COOLDOWN_MS,
  DEFAULT_MAX_REFUSAL_KEYS,
} from "./core";
export type { ClerkCoreOptions, SubmissionRequest, Challenge } from "./core";
export { verifyChain, renderVerification, INTACT_IS_NOT_HEALTH } from "./verify";
export type {
  ChainVerification,
  BreakFound,
  IntactSinceArrival,
  CannotVerify,
  ChainBreak,
  BreakClass,
  VerifyBlind,
  VerifyBlindClass,
  TrustAnchor,
  VerifyOptions,
} from "./verify";
export { readGaps, renderGapRead, GAP_INSTRUMENT_ID, NO_GAP_IS_NOT_HEALTH, SHAPE_STATEMENT } from "./gap";
export type {
  GapRead,
  GapObserved,
  NoGapObserved,
  CannotAssessCadence,
  GapStop,
  GapObject,
  GapShape,
  GapBlind,
  GapBlindClass,
  ClerkCoverage,
} from "./gap";
export {
  claimFrom,
  assertInScope,
  describeScope,
  ClerkScopeViolation,
  NO_POSITIVE_HEALTH_STATEMENT,
} from "./scope";
export type { ClerkClaim } from "./scope";
export {
  InProcessClerkClient,
  SocketClerkClient,
  SignedSubmitter,
  ClerkProtocolError,
} from "./client";
export type { ClerkClient } from "./client";
export { defaultSocketPath } from "./protocol";
export type {
  ClerkInfo,
  ClerkOp,
  ClerkRequestMessage,
  ClerkResponseMessage,
} from "./protocol";
export { startClerkDaemon, parseArgs as parseClerkdArgs, printBanner } from "./clerkd";
export type { RunningClerk } from "./clerkd";
