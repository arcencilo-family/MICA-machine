// ── MICA · the external evidence socket ──────────────────────────────────────
//
// THE ONE SENTENCE THIS MODULE IS ALLOWED TO SAY:
//
//   A record MICA cannot delete was, or was not, placed somewhere MICA does not
//   own — and which of those two happened is always printed.
//
// ── THE STANCE (the arbiter, S95) — quoted because it is the reason, not decoration ─
//
//   "The destroying act must be a different act by a different hand, so the
//    destruction leaves a trace."
//
//   The sharper form, and it must never be softened to "tamper-proof": WE
//   CANNOT MAKE DELETION HARD. WE CAN MAKE DELETION UNDENIABLE. A log inside
//   the thing dies with the thing and leaves no gap — silence resolving to
//   "nothing ever happened". A log outside leaves A HOLE THAT READS. That is
//   negative attestation applied to evidence storage, and it is the same rule
//   as min(): only un-health is provable.
//
// ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
//
//   Not a dependency. This file names no implementation, imports nothing, and
//   is satisfied by any append-only chain with the shape below. A reference
//   implementation is offered OUTSIDE this repository and is explicitly
//   NON-EXCLUSIVE; a deployer may bring their own.
//
//   Not protection. MICA does not guard the external log and cannot. Whoever
//   can reach it can destroy it. What MICA offers is that the destruction is
//   VISIBLE — a stated socket with nothing behind it is a FINDING here, never
//   a silence. Guarding the log is out of scope by ruling (S95), and the stance
//   goes in the outside package's INSTALL.md, which is where MICA's reach
//   honestly ends.
//
//   NOT IN THE FLOOR. This is an evidence seam. Nothing here produces a
//   SensorVerdict, nothing here is a term in min(), and no disposition anywhere
//   changes because this socket is empty or full. THE REASON IS LOAD-BEARING:
//   if MICA's floor depended on an external log's availability, whoever could
//   unplug the log could lower MICA — a remote kill switch built out of good
//   intentions. The socket reports; it never votes.
//
// ── WHY THE DECLARED SEPARATION IS NOT ACCEPTED HERE ─────────────────────────
//
//   There is deliberately NO option for a deployer to declare "this chain is
//   separated". Canon §K: a declared provenance is self-description, and
//   self-description is not evidence. Separation is read from what the chain
//   OBSERVED, or it is NOT_REPORTED — and NOT_REPORTED never reads as separated.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * The load states an external chain may report about its own storage.
 *
 * These four are the states any honest append-only log has to distinguish. Note
 * FIRST_BOOT_OR_ERASED especially: a file that is absent is a genuine first run
 * OR an erased history, and NOTHING IN CODE CAN TELL THEM APART. MICA carries
 * that undecidedness out to the reader unchanged and never resolves it. It is
 * the same young-versus-quiet shape the Dry Well Gauge holds open, and turning
 * it into a claim in either direction would be the whole defect.
 */
export type ExternalChainLoadState =
  | "IN_MEMORY"
  | "LOADED_VERIFIED"
  | "FIRST_BOOT_OR_ERASED"
  | "CANNOT_VERIFY";

const KNOWN_LOAD_STATES: ReadonlySet<string> = new Set<ExternalChainLoadState>([
  "IN_MEMORY",
  "LOADED_VERIFIED",
  "FIRST_BOOT_OR_ERASED",
  "CANNOT_VERIFY",
]);

/**
 * What the socket can honestly say about separation.
 *
 * CLAIMED_SEPARATE_REACHED_LOCALLY is carried outward rather than re-derived: a
 * chain that says it is a separate process while having been reached through an
 * observed local call has contradicted itself, and that contradiction must not
 * be rounded to either neighbour.
 *
 * NOT_REPORTED is the default and is NEVER equivalent to separated. A chain that
 * offers no separation evidence has offered no separation evidence.
 */
export type SeparationReading =
  | "SEPARATE_PROCESS"
  | "IN_PROCESS_NO_SEPARATION"
  | "CLAIMED_SEPARATE_REACHED_LOCALLY"
  | "NOT_REPORTED";

/** A record offered to the external chain. Field-for-field what a chain needs. */
export interface EvidenceRecordInput {
  readonly timestamp: number;
  readonly moduleId: string;
  readonly eventType: string;
  /** The lane vocabulary is the CHAIN'S, not MICA's — a string, never an enum. */
  readonly provenanceTag: string;
  readonly parameters: Record<string, unknown>;
  readonly outcome: string;
}

/** What comes back: something that identifies the record's position in the chain. */
export interface EvidencePosition {
  readonly sequenceNumber: number;
  readonly hash: string;
  readonly previousHash: string;
}

/**
 * One separation observation. The optional source below yields a list of these;
 * a chain that never observed a stamp yields an empty list, which is
 * NOT_REPORTED and not an error.
 */
export interface SeparationStamp {
  readonly separation: string;
  readonly intake: string;
}

/**
 * THE SOCKET. Any append-only chain satisfying this shape can hold MICA's
 * external evidence. No implementation is named, here or anywhere in this
 * repository.
 *
 * `getLoadState` returns a plain string on purpose: a chain we have never seen
 * may report a state this file does not know, and the correct response to an
 * unrecognised state is UNRECOGNISED — fail closed — not a compile error and
 * certainly not a silent cast to something clean.
 *
 * `getClerkClockSource` is OPTIONAL and is named for MICA's own clerk, which is
 * where separation stamps come from when a chain routes through one. A chain
 * without it is fully conformant and reports NOT_REPORTED.
 */
export interface ExternalEvidenceChain {
  append(input: EvidenceRecordInput): Promise<EvidencePosition>;
  getLoadState(): string;
  getClerkClockSource?(): readonly SeparationStamp[];
}

/**
 * How the deployer states the socket. Everything is INJECTED, nothing defaults.
 *
 * `statedAs` is what the deployer says the chain IS — a path, a host, a name.
 * It exists so that "you told me it was there and it is not" can be said with
 * the thing they told us in the message.
 */
export interface ExternalEvidenceSocketOptions {
  readonly statedAs?: string;
  readonly chain?: ExternalEvidenceChain;
}

/** Three outcomes, and they are not two. */
export type EvidenceSocketStatus =
  | "NOT_STATED"
  | "STATED_UNREACHABLE"
  | "REACHABLE";

export interface ExternalEvidenceReading {
  readonly status: EvidenceSocketStatus;
  /** The chain's own load state, UNRECOGNISED if it is not one of the four, null if unreachable. */
  readonly loadState: ExternalChainLoadState | "UNRECOGNISED" | null;
  readonly separation: SeparationReading;
  /** Set when somebody stated a socket and it is not there. A finding, never a skip. */
  readonly finding: string | null;
  /** Set when nobody stated a socket at all. CANNOT_ASSESS, never a pass. */
  readonly cannotAssess: string | null;
  /** Always non-empty. Every read prints. */
  readonly lines: readonly string[];
}

export type ExternalEvidenceAppend =
  | {
      readonly kind: "APPENDED";
      readonly position: EvidencePosition;
      readonly reading: ExternalEvidenceReading;
    }
  | {
      readonly kind: "NOT_APPENDED";
      readonly reason: string;
      readonly reading: ExternalEvidenceReading;
    };

// ── the printed constants ─────────────────────────────────────────────────────

export const EXTERNAL_EVIDENCE_ONE_SENTENCE =
  "A record MICA cannot delete was, or was not, placed somewhere MICA does not " +
  "own — and which of those two happened is always printed.";

/** The arbiter's sentence. Quoted, not paraphrased, wherever the socket explains itself. */
export const EXTERNAL_EVIDENCE_STANCE =
  "The destroying act must be a different act by a different hand, so the " +
  "destruction leaves a trace. We cannot make deletion hard; we can make " +
  "deletion undeniable. A log inside the thing dies with the thing and leaves " +
  "no gap. A log outside leaves a hole that reads.";

export const EXTERNAL_EVIDENCE_NOT_STATED =
  "NO EXTERNAL EVIDENCE SOCKET WAS STATED. Nothing was written outside, and " +
  "nothing here says whether anything would have been. This is CANNOT_ASSESS of " +
  "the DEPENDENCY-NOT-STATED family: an unperformed check is not a pass and is " +
  "not a failure — it is a check that did not happen. State a chain, or read " +
  "this line as the whole of what is known.";

export const EXTERNAL_EVIDENCE_NOT_IN_THE_FLOOR =
  "This socket enters no verdict and is never a term in min(). An empty socket " +
  "does not lower any factor and a full one raises none. If MICA's floor moved " +
  "with an external log's availability, whoever could unplug the log could " +
  "lower MICA.";

export const EXTERNAL_EVIDENCE_NO_PROTECTION =
  "MICA DOES NOT PROTECT THIS LOG AND CANNOT. Whoever can reach it can destroy " +
  "it. What is offered is that the destruction is visible: a stated socket with " +
  "nothing behind it reads as a finding, never as silence.";

// ── separation, read from observation only ────────────────────────────────────

/**
 * Fold the observed stamps into one reading, un-health first.
 *
 * min()-shaped and deliberately: ONE stamp reporting no separation makes the
 * whole read no-separation, and a self-contradicting stamp outranks both,
 * because a chain that has contradicted itself about where it is has told us
 * something about itself that a later clean stamp does not undo.
 */
export function foldSeparation(
  stamps: readonly SeparationStamp[] | undefined
): SeparationReading {
  if (stamps === undefined || stamps.length === 0) return "NOT_REPORTED";
  let sawSeparate = false;
  let sawInProcess = false;
  for (const s of stamps) {
    if (s.separation === "SEPARATE_PROCESS" && s.intake === "LOCAL_CALL") {
      return "CLAIMED_SEPARATE_REACHED_LOCALLY";
    }
    if (s.separation === "SEPARATE_PROCESS") sawSeparate = true;
    else if (s.separation === "IN_PROCESS_NO_SEPARATION") sawInProcess = true;
    // An unrecognised separation word contributes nothing. It cannot make the
    // read cleaner, and it must not make it dirtier than the evidence supports.
  }
  if (sawInProcess) return "IN_PROCESS_NO_SEPARATION";
  if (sawSeparate) return "SEPARATE_PROCESS";
  return "NOT_REPORTED";
}

// ── the read ──────────────────────────────────────────────────────────────────

function normaliseLoadState(
  raw: string
): ExternalChainLoadState | "UNRECOGNISED" {
  return KNOWN_LOAD_STATES.has(raw)
    ? (raw as ExternalChainLoadState)
    : "UNRECOGNISED";
}

/**
 * Read the socket. NEVER THROWS, and never returns a PASS — there is no PASS in
 * this file's vocabulary. Every outcome is a typed state with printed lines.
 */
export function readExternalEvidenceSocket(
  options: ExternalEvidenceSocketOptions
): ExternalEvidenceReading {
  const statedAs = options.statedAs;
  const chain = options.chain;

  // (1) Nobody stated a socket.
  if (chain === undefined && (statedAs === undefined || statedAs.length === 0)) {
    return {
      status: "NOT_STATED",
      loadState: null,
      separation: "NOT_REPORTED",
      finding: null,
      cannotAssess: EXTERNAL_EVIDENCE_NOT_STATED,
      lines: [
        "EXTERNAL EVIDENCE: NOT_STATED",
        `  ${EXTERNAL_EVIDENCE_NOT_STATED}`,
        `  ${EXTERNAL_EVIDENCE_NOT_IN_THE_FLOOR}`,
      ],
    };
  }

  // (2) Somebody said where it is, and it is not there.
  if (chain === undefined) {
    const finding =
      `EXTERNAL EVIDENCE SOCKET STATED AS "${statedAs}" AND NOTHING IS THERE. ` +
      "A stated location that is empty is a finding, not a skip. Nothing was " +
      "written outside this run, and the absence is being reported rather than " +
      "passed over.";
    return {
      status: "STATED_UNREACHABLE",
      loadState: null,
      separation: "NOT_REPORTED",
      finding,
      cannotAssess: null,
      lines: [
        "EXTERNAL EVIDENCE: STATED_UNREACHABLE",
        `  stated as: ${statedAs}`,
        `  ${finding}`,
        `  ${EXTERNAL_EVIDENCE_NO_PROTECTION}`,
      ],
    };
  }

  // (3) A chain is present. Ask it about itself, and treat a throw as absence
  //     rather than as a crash — a chain that cannot answer is unreachable, and
  //     the exception text is the most useful thing we have about why.
  const label = statedAs ?? "(chain supplied without a stated name)";
  let raw: string;
  try {
    raw = chain.getLoadState();
  } catch (err) {
    const finding =
      `EXTERNAL EVIDENCE SOCKET STATED AS "${label}" IS PRESENT BUT DID NOT ` +
      `ANSWER: ${String(err)}. A chain that cannot report its own load state is ` +
      "unreachable for this purpose; treated as a finding, never as reachable.";
    return {
      status: "STATED_UNREACHABLE",
      loadState: null,
      separation: "NOT_REPORTED",
      finding,
      cannotAssess: null,
      lines: [
        "EXTERNAL EVIDENCE: STATED_UNREACHABLE",
        `  stated as: ${label}`,
        `  ${finding}`,
        `  ${EXTERNAL_EVIDENCE_NO_PROTECTION}`,
      ],
    };
  }

  const loadState = normaliseLoadState(raw);

  let separation: SeparationReading = "NOT_REPORTED";
  if (typeof chain.getClerkClockSource === "function") {
    try {
      separation = foldSeparation(chain.getClerkClockSource());
    } catch {
      // A separation source that throws has reported no separation. It does not
      // make the chain unreachable and it does not make it separated.
      separation = "NOT_REPORTED";
    }
  }

  const lines = [
    "EXTERNAL EVIDENCE: REACHABLE",
    `  stated as: ${label}`,
    `  load state: ${loadState}${
      loadState === "UNRECOGNISED" ? ` (chain said "${raw}")` : ""
    }`,
    `  separation: ${separation}`,
  ];

  if (loadState === "FIRST_BOOT_OR_ERASED") {
    lines.push(
      "  FIRST_BOOT_OR_ERASED is UNDECIDED and stays undecided: an absent " +
        "history is a genuine first run OR an erased one, and nothing in code " +
        "distinguishes them. MICA does not resolve this in either direction."
    );
  }
  if (loadState === "CANNOT_VERIFY") {
    lines.push(
      "  CANNOT_VERIFY: the chain is present and could not be verified. This " +
        "is the chain's own report about itself and is carried out unchanged."
    );
  }
  if (loadState === "UNRECOGNISED") {
    lines.push(
      "  UNRECOGNISED load state — fails closed. A state this reader does not " +
        "know is never treated as clean."
    );
  }
  if (separation !== "SEPARATE_PROCESS") {
    lines.push(
      `  SEPARATION IS NOT ESTABLISHED (${separation}). A chain reached in the ` +
        "same process, or offering no separation evidence, is not outside. It " +
        "is printed rather than failed: a deployer may knowingly run a " +
        "non-separated chain. What is forbidden is that it reads the same as a " +
        "separated one."
    );
  }
  lines.push(`  ${EXTERNAL_EVIDENCE_NO_PROTECTION}`);

  return {
    status: "REACHABLE",
    loadState,
    separation,
    finding: null,
    cannotAssess: null,
    lines,
  };
}

/**
 * Offer a record to the socket.
 *
 * A record that did not land says so, with the reading that explains why. It is
 * never dropped quietly and the failure is never thrown past the caller as a
 * crash — a MICA run does not end because an external log is missing, and it
 * does not proceed pretending the record landed either.
 */
export async function appendExternalEvidence(
  options: ExternalEvidenceSocketOptions,
  record: EvidenceRecordInput
): Promise<ExternalEvidenceAppend> {
  const reading = readExternalEvidenceSocket(options);
  if (reading.status !== "REACHABLE" || options.chain === undefined) {
    return {
      kind: "NOT_APPENDED",
      reason:
        reading.finding ??
        reading.cannotAssess ??
        "the socket is not reachable and the record was not written outside",
      reading,
    };
  }
  try {
    const position = await options.chain.append(record);
    return { kind: "APPENDED", position, reading };
  } catch (err) {
    return {
      kind: "NOT_APPENDED",
      reason:
        "THE APPEND WAS REFUSED BY THE CHAIN AND THE RECORD IS NOT OUTSIDE: " +
        String(err),
      reading,
    };
  }
}

/** Every line the socket has to say about itself, for a status surface. */
export function describeExternalEvidenceSocket(
  options: ExternalEvidenceSocketOptions
): readonly string[] {
  return [
    ...readExternalEvidenceSocket(options).lines,
    `  ${EXTERNAL_EVIDENCE_STANCE}`,
    `  ${EXTERNAL_EVIDENCE_NOT_IN_THE_FLOOR}`,
  ];
}
