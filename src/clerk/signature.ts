// ──────────────────────────────────────────────────────────────────────────────
// ILAS — CLERK 1: signature VERIFICATION only.
//
// Split from keys.ts deliberately. keys.ts can create and write a private key;
// this file cannot. The standalone reader imports this and never that, so the
// reader has no code path that touches the private key at all.
//
// Ed25519, from Node's built-in crypto. No new dependencies.
// ──────────────────────────────────────────────────────────────────────────────

import { createPublicKey, verify as cryptoVerify, KeyObject } from "crypto";

export const SIGNATURE_ALG = "ed25519" as const;

export class PublicKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicKeyError";
  }
}

/** base64 SPKI DER → KeyObject. Throws PublicKeyError on anything unusable. */
export function publicKeyFromB64(b64: string): KeyObject {
  try {
    return createPublicKey({
      key: Buffer.from(b64, "base64"),
      format: "der",
      type: "spki",
    });
  } catch (err) {
    throw new PublicKeyError(`unusable public key: ${String(err)}`);
  }
}

/**
 * Verify a detached Ed25519 signature over `preimage`. Returns a boolean and
 * never throws for a bad signature — a malformed signature is a FALSE, which
 * the caller must type, not an exception the caller might swallow.
 */
export function verifySignature(
  preimage: string,
  signatureB64: string,
  publicKey: KeyObject
): boolean {
  let sig: Buffer;
  try {
    sig = Buffer.from(signatureB64, "base64");
  } catch {
    return false;
  }
  if (sig.length === 0) return false;
  try {
    return cryptoVerify(null, Buffer.from(preimage, "utf8"), publicKey, sig);
  } catch {
    return false;
  }
}
