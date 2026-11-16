// ── REFERENCE ONLY — NOT SHIPPED MACHINERY ───────────────────────────────────
//
// READ THIS BEFORE READING THE CODE.
//
// This file is a DOCUMENTATION ARTIFACT. It is deliberately parked outside `src/`
// and therefore:
//
//   · outside `tsconfig.json`'s `"include": ["src/**/*"]` — `npm run typecheck`
//     and `npm run build` never see it;
//   · outside `src/mica/closure.test.ts`'s walk (`tsFiles(SRC_ROOT)`) — the
//     seven-name node-builtin allowlist that governs everything under `src/`
//     does not reach here, which is the only reason an `https` import can be
//     written at all;
//   · outside `src/mica/registration.test.ts`'s discovery walk (also `SRC_ROOT`)
//     — nothing here is a suite entry, and nothing here runs in `test:mica`.
//
// NOTHING IMPORTS THIS FILE. It exists so that "MICA ships no transport" is a
// statement about MICA and not a shrug about what a transport would look like.
//
// ── WHY MICA SHIPS NO TRANSPORT ──────────────────────────────────────────────
//
//   MICA owns the ROSTER — which roles exist, what address each carries, and a
//   record of every attempt made against them. The DEPLOYER owns the WIRE.
//
//   The ground is that an address is not a route. A declared endpoint proves
//   nothing: it is not resolved, not reachability-tested, and could name a host
//   that has never existed. So MICA declining to own the transport costs nothing
//   that owning it would have bought — and it avoids the thing owning it WOULD
//   have bought, which is a repository-wide dependency on outbound networking in
//   a codebase whose whole argument is that it can only attest what it observes.
//
//   The ceiling the notify module prints on its own face applies here in full:
//   an injected stub that returns normally every time satisfies EVERYTHING MICA
//   can observe about this layer. MICA observes a function call and its return.
//   It cannot observe a network, a host, an inbox, or a person. Wiring THIS file
//   in changes nothing about that — it only moves the unobservable boundary one
//   step further out.
//
// ── WHAT A DEPLOYER MUST DECIDE, THAT MICA DELIBERATELY DOES NOT ─────────────
//
//   · the timeout, and what expiry means;
//   · whether a non-2xx status is acceptance-of-bytes or a throw;
//   · authentication, and where its secret lives;
//   · TLS trust roots;
//   · whether `tel:` addresses go to a gateway, and which one.
//
//   Every one of those is a deployment fact. MICA records the ATTEMPT and the
//   outcome the wire reported; it chooses none of the above.

import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";

/** Mirrors `src/mica/notify/types.ts`. Copied, not imported: this file is not
 *  part of the build, and a reference artifact must not become a live edge. */
interface NoticeEnvelope {
  readonly sourceId: string;
  readonly kind: string;
  readonly lines: readonly string[];
  readonly sequence: number;
}

interface TransportOutcome {
  readonly detail: string;
}

export interface ReferenceTransportOptions {
  /** Bounded, and the deployer's number. There is no MICA default here. */
  readonly timeoutMs: number;
  /**
   * Whether a non-2xx status throws. FALSE records the status as transport
   * acceptance — the bytes arrived at something that answered — which is what
   * ATTEMPTED means and all it means. TRUE turns it into FAILED. Both readings
   * are defensible; the choice is the deployer's, which is the point.
   */
  readonly nonSuccessStatusThrows: boolean;
}

/**
 * A synchronous seam over an asynchronous protocol is the awkward part, and it
 * is awkward on purpose: the notify layer makes ONE attempt and records it, so
 * there is no place for a promise to be awaited and no retry loop to hang one
 * on. A real deployment resolves this by running the wire in a worker, a queue,
 * or a child process and handing notify a function that returns what that
 * component already knows.
 *
 * The sketch below is written as an async function for readability. It is NOT a
 * `Transport` — a `Transport` returns `TransportOutcome`, not a promise — and it
 * is left this way rather than faked into a synchronous shape, because faking it
 * would hide precisely the decision the deployer has to make.
 */
export function sketchOutboundPost(
  options: ReferenceTransportOptions
): (address: string, envelope: NoticeEnvelope) => Promise<TransportOutcome> {
  return (address, envelope) =>
    new Promise((resolve, reject) => {
      const url = new URL(address);
      const send = url.protocol === "http:" ? httpRequest : httpsRequest;
      const body = JSON.stringify({
        sourceId: envelope.sourceId,
        kind: envelope.kind,
        lines: envelope.lines,
        sequence: envelope.sequence,
      });
      const req = send(
        url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body).toString(),
          },
          timeout: options.timeoutMs,
        },
        (res) => {
          res.resume();
          const status = res.statusCode ?? 0;
          const ok = status >= 200 && status < 300;
          if (!ok && options.nonSuccessStatusThrows) {
            reject(new Error(`status ${String(status)}`));
            return;
          }
          // Recorded as TRANSPORT ACCEPTANCE. It is a fact about a socket and a
          // status line. It is not a fact about a person, and the attempt record
          // must never be read as one.
          resolve({ detail: `status ${String(status)}` });
        }
      );
      req.on("timeout", () => {
        req.destroy(new Error(`no answer within ${String(options.timeoutMs)}ms`));
      });
      req.on("error", reject);
      req.end(body);
    });
}

/**
 * A `tel:` address has no transport here and is not going to grow one. It is on
 * the shipped roster to keep `address` honestly opaque — a roster row carries an
 * ADDRESS, not a URL — and a deployment that keeps a telephone-shaped address
 * must inject a wire that knows what to do with it.
 */
export const TEL_ADDRESSES_HAVE_NO_REFERENCE_WIRE =
  "The shipped operator placeholder is telephone-shaped so that nothing " +
  "downstream assumes an address is a URL. This reference sketch handles http " +
  "and https only; anything else is the deployer's to carry.";
