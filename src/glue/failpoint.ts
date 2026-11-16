// ── GLUE · test-only failpoints — a deterministic, driveable crash mechanism ──
//
// Amendment 1 (Blocker 2): a read-only verifier cannot edit source to insert
// crash points, and killing a live process cannot reliably target a boundary
// that may last microseconds. This is the committed, named mechanism instead:
// a failpoint fires ONLY when BOTH `NODE_ENV=test` AND `MICA_FAILPOINT=<name>`
// are set, and it fires by `process.exit(70)` — an unrecoverable, real process
// exit, not a thrown exception something could catch and paper over. A test
// harness runs the CLI as a CHILD PROCESS with the failpoint set, asserts exit
// 70, then restarts the same command WITHOUT the failpoint set and asserts the
// retry repairs cleanly. `70` is not zero, one, or two — the three codes this
// program's own exit-code contract already owns — so a failpoint firing is
// never misread as a disposition or a usage error.
//
// A failpoint variable set OUTSIDE `NODE_ENV=test` is INERT: it never fires,
// and it says so exactly ONCE on stderr per process, so a stray environment
// variable in a real deployment cannot silently kill anything, and cannot
// silently do nothing without at least one loud line saying so.

let warnedInert = false;

/** Every boundary this build names. Not a validated enum at the CLI — this is a test-only seam. */
export type FailpointName =
  | "after-prepared"
  | "after-final"
  | `after-projection:${"trail" | "ledger" | "history" | "events"}`
  | `after-projection-append-before-marker:${"trail" | "ledger" | "history" | "events"}`;

/**
 * Fire the named failpoint if the environment asks for exactly this one and
 * `NODE_ENV=test` is also set. `process.exit(70)` never returns; callers
 * after this line only run when the failpoint did not match.
 */
export function maybeFailpoint(name: FailpointName): void {
  const requested = process.env.MICA_FAILPOINT;
  if (requested === undefined) return;
  if (process.env.NODE_ENV !== "test") {
    if (!warnedInert) {
      warnedInert = true;
      process.stderr.write(
        `[mica-guard] MICA_FAILPOINT=${requested} is set but NODE_ENV is not ` +
          `"test": every failpoint is INERT outside the test environment. ` +
          `This line prints once per process and nothing will be killed.\n`
      );
    }
    return;
  }
  if (requested !== name) return;
  process.stderr.write(`[mica-guard] FAILPOINT FIRED: ${name} — exiting 70\n`);
  process.exit(70);
}
