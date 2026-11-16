// -- REGISTRAR . the refusal log, chained ------------------------------------
//
// THE DEBT, IN THE S99 RECEIPT'S OWN WORDS (section E.6):
//
//   "Every refused deposit writes a line naming who was refused and why ... it
//   inherits none of A9's chaining. It is a log, not a chain: nothing stops the
//   custodian editing it."
//
//   The doorman wrote down everyone he turned away, in pencil, in his own
//   pocket. The books behind the door are in ink with every page numbered
//   against the last. This puts the turned-away list in the same ink.
//
// -- WHAT IT ATTESTS, AND THE ONE THING IT CANNOT ----------------------------
//
//   Any edit, reorder, or deletion IN THE MIDDLE breaks verify(). A TAIL
//   TRUNCATION DOES NOT, and never will: a chain that is honestly shorter is
//   still an honest chain. That blindness is named in REFUSAL_LOG_ATTESTS and
//   printed, exactly as the witness adapter names its own.
//
// -- ON "REUSE, NEVER A THIRD HASH SCHEME" [LB] ------------------------------
//
//   There are three chains in this tree and each has its OWN preimage function:
//   `computeWitnessRecordHash` (space-joined, no domain tag),
//   `computeRulingRecordHash` (US-separated, length-prefixed), and
//   `computePrecommitRecordHash` (US-separated, length-prefixed, and DOMAIN
//   TAGGED "MICA-A9-CHAIN-v1").
//
//   None of them can hash a refusal record: A9's switches on its four record
//   kinds and would reject this shape outright, and forcing it would be the
//   real violation -- a refusal hash presentable as an A9 chain hash. The
//   shared helpers (US, lengthPrefixed) are private to each module and exported
//   by neither.
//
//   So what is reused is the CONSTRUCTION, which is the part that matters: the
//   ASCII unit separator, every variable-length run LENGTH-PREFIXED, and every
//   field -- `kind` included -- inside the preimage. What is added is a FOURTH
//   DOMAIN TAG. That is the tree's existing pattern, not a departure from it:
//   domain separation is precisely what stops a hash from one chain being
//   presented as a hash from another.
//
//   [owed] -- US and lengthPrefixed are now duplicated in THREE modules.
//   Exporting them from one home is a tidy-up worth doing, and it is not worth
//   doing inside a build whose bar is "nothing touches the books".

import { createHash } from "crypto";
import { readFileSync, statSync } from "fs";

/**
 * Domain tag. A refusal-chain hash can never be presented as an A9 chain hash,
 * a ruling hash, or a seal, because none of them share this leading string.
 */
export const REFUSAL_CHAIN_DOMAIN = "MICA-REFUSAL-CHAIN-v1";

/**
 * ASCII unit separator (31), written as a char code rather than a literal so
 * this source stays plain ASCII end to end. Same separator the A9 and
 * ruling-log preimages use.
 *
 * The reason both of them give applies here: `detail` is free prose of
 * unbounded length, and with a space-joined preimage it could be edited so that
 * content moved across a field boundary without changing the digest.
 */
const US = String.fromCharCode(31);

function lengthPrefixed(value: string): string {
  return `${String(value.length)}:${value}`;
}

export const REFUSAL_LOG_ATTESTS =
  "THIS LOG ATTESTS ITS OWN CHAIN AND ORDERING. Every record's hash is " +
  "recomputed over a domain-separated, length-prefixed preimage carrying every " +
  "field including its kind, and each record links to its predecessor - so an " +
  "edit, a reorder, or a deletion ANYWHERE IN THE MIDDLE is caught, including " +
  "by the custodian that wrote it. IT DOES NOT ATTEST COMPLETENESS: a TAIL " +
  "TRUNCATION leaves a chain that verifies perfectly, and no chain can ever " +
  "detect that on its own. It carries NO SIGNATURE - these records hold " +
  "previousHash and hash and nothing else cryptographic, so nothing here is " +
  "signature-checked and no key is read. And it attests the RECORD, never the " +
  "refusal: that a refusal was recorded faithfully is not evidence that " +
  "refusing was right.";

export type RefusalLogKind = "REFUSED" | "ACCEPTED" | "LEGACY_POINTER";

interface RefusalLogFrame {
  readonly seq: number;
  readonly ts: number;
  readonly kind: RefusalLogKind;
  readonly previousHash: string;
  readonly hash: string;
}

/**
 * A refused deposit.
 *
 * `subjectUid` is THE KERNEL'S OBSERVATION and `subject` is a LOOKUP: the
 * registrar resolves the frame's owner uid against its roster, and the resolved
 * name is null exactly when the uid is not in it. Both are carried because they
 * are different facts -- and because UNKNOWN_DEPOSITOR, the refusal where
 * identifying the principal matters most, is precisely the one whose name is
 * null. Before this record existed the uid survived only inside a prose
 * `detail` string.
 */
export interface RefusedRecord extends RefusalLogFrame {
  readonly kind: "REFUSED";
  readonly reason: string;
  readonly subject: string | null;
  readonly subjectUid: number | null;
  readonly frame: string;
  readonly detail: string;
}

/** An accepted deposit. Same chain, same sequence -- never a second chain. */
export interface AcceptedRecord extends RefusalLogFrame {
  readonly kind: "ACCEPTED";
  readonly subject: string | null;
  readonly subjectUid: number | null;
  readonly frame: string;
  readonly book: string;
  readonly bookSeq: number;
  readonly headHash: string;
  readonly detail: string;
}

/**
 * SEQ 0 OF A CHAINED LOG, when an unchained log preceded it.
 *
 * MIGRATION BY POINTER, not by rewriting (section 2.5 option (a)). The old file
 * is RETAINED WHERE IT IS -- not renamed, because renaming is a mutation of the
 * very artifact this record pins by hash, performed as a side effect of the
 * first refusal, at a moment nobody chose.
 *
 * The record says plainly that everything before it was unchained. It does NOT
 * make the old lines trustworthy: it fixes WHAT THEY WERE AT THIS INSTANT, so a
 * later edit of them is detectable, and nothing more.
 */
export interface LegacyPointerRecord extends RefusalLogFrame {
  readonly kind: "LEGACY_POINTER";
  readonly legacyPath: string;
  /** sha256 of the retained file's bytes, or "" when there was no file. */
  readonly legacyHash: string;
  readonly legacyBytes: number;
  readonly detail: string;
}

export type RefusalLogRecord =
  | RefusedRecord
  | AcceptedRecord
  | LegacyPointerRecord;

export type UnhashedRefusalRecord =
  | Omit<RefusedRecord, "hash">
  | Omit<AcceptedRecord, "hash">
  | Omit<LegacyPointerRecord, "hash">;

/**
 * The preimage. Every field is in it, `kind` among them.
 *
 * CONTRACT: the record must already be SHAPE-VALID for its kind. The load path
 * runs `validateRefusalLogRecord` first and never reaches this with a mismatch,
 * which is why a REFUSED relabelled ACCEPTED is reported as a schema failure
 * rather than a chain break -- it has no `book` to hash. Callers that build
 * records by hand (the registrar, and the tests) hold the same obligation.
 */
export function computeRefusalRecordHash(r: UnhashedRefusalRecord): string {
  const head = [
    REFUSAL_CHAIN_DOMAIN,
    String(r.seq),
    r.previousHash,
    String(r.ts),
    r.kind,
  ];
  const tail = ((): string[] => {
    switch (r.kind) {
      case "REFUSED":
        return [
          lengthPrefixed(r.reason),
          lengthPrefixed(r.subject ?? ""),
          r.subject === null ? "null" : "name",
          r.subjectUid === null ? "null" : String(r.subjectUid),
          lengthPrefixed(r.frame),
          lengthPrefixed(r.detail),
        ];
      case "ACCEPTED":
        return [
          lengthPrefixed(r.subject ?? ""),
          r.subject === null ? "null" : "name",
          r.subjectUid === null ? "null" : String(r.subjectUid),
          lengthPrefixed(r.frame),
          lengthPrefixed(r.book),
          String(r.bookSeq),
          r.headHash,
          lengthPrefixed(r.detail),
        ];
      case "LEGACY_POINTER":
        return [
          lengthPrefixed(r.legacyPath),
          r.legacyHash,
          String(r.legacyBytes),
          lengthPrefixed(r.detail),
        ];
    }
  })();
  return createHash("sha256")
    .update([...head, ...tail].join(US), "utf8")
    .digest("hex");
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
const isStr = (v: unknown): v is string => typeof v === "string";
const isSeq = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0;

/** Closed-shape validation before a parsed record joins the chain. */
export function validateRefusalLogRecord(x: unknown): RefusalLogRecord | null {
  if (!isObj(x)) return null;
  const o = x;
  if (!isSeq(o.seq) || !Number.isFinite(o.ts)) return null;
  if (!isStr(o.previousHash) || !isStr(o.hash)) return null;
  const subjOk =
    (o.subject === null || isStr(o.subject)) &&
    (o.subjectUid === null || Number.isInteger(o.subjectUid));
  if (o.kind === "REFUSED") {
    if (!isStr(o.reason) || !subjOk || !isStr(o.frame) || !isStr(o.detail))
      return null;
    return o as unknown as RefusedRecord;
  }
  if (o.kind === "ACCEPTED") {
    if (
      !subjOk ||
      !isStr(o.frame) ||
      !isStr(o.book) ||
      !isSeq(o.bookSeq) ||
      !isStr(o.headHash) ||
      !isStr(o.detail)
    )
      return null;
    return o as unknown as AcceptedRecord;
  }
  if (o.kind === "LEGACY_POINTER") {
    if (
      !isStr(o.legacyPath) ||
      !isStr(o.legacyHash) ||
      !isSeq(o.legacyBytes) ||
      !isStr(o.detail)
    )
      return null;
    return o as unknown as LegacyPointerRecord;
  }
  return null;
}

export type RefusalLogLoadState =
  | "LOADED_VERIFIED"
  | "BROKEN_CHAIN"
  | "UNVERIFIED_JSON"
  | "UNVERIFIED_SCHEMA"
  | "EMPTY"
  /** NOT "absent". This process could not look. */
  | "CANNOT_SEE"
  | "ABSENT";

export interface RefusalLogVerifyResult {
  readonly valid: boolean;
  readonly brokenAt: number | null;
}

export interface RefusalLogLook {
  readonly loadState: RefusalLogLoadState;
  readonly records: readonly RefusalLogRecord[];
  readonly problem: string | null;
  verify(): RefusalLogVerifyResult;
}

/**
 * READ THE LOG. PURE, AND IT WRITES NOTHING.
 *
 * A DELIBERATE DEPARTURE FROM THE `Witness` CLASS, and this morning paid for
 * the lesson: that constructor appends a PLACEMENT whenever the store loads
 * EMPTY or LOADED_VERIFIED, so reading the live store with it would have
 * appended to the evidence being read. Nothing here opens for append, creates a
 * file, or makes a directory. Any principal holding r-- can run it.
 */
export function loadRefusalLog(path: string): RefusalLogLook {
  const fail = (
    loadState: RefusalLogLoadState,
    problem: string | null,
    brokenAt: number | null = null
  ): RefusalLogLook => ({
    loadState,
    records: [],
    problem,
    verify: () => ({ valid: false, brokenAt }),
  });

  let raw: string;
  try {
    // statSync, never existsSync: a path this process may not traverse must not
    // be reported as a path that does not exist.
    const st = statSync(path);
    if (!st.isFile()) return fail("CANNOT_SEE", `${path} is not a regular file`);
    raw = readFileSync(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return fail("ABSENT", `${path} does not exist`);
    return fail(
      "CANNOT_SEE",
      `${path} could not be read (${String(code ?? err)}). THIS IS NOT an ` +
        `absent log: this process could not look, and reporting blindness as ` +
        `absence would be inventing a fact about the record.`
    );
  }

  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return fail("EMPTY", null);

  const records: RefusalLogRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      return fail("UNVERIFIED_JSON", `line ${i + 1} is not valid JSON`, i);
    }
    const rec = validateRefusalLogRecord(parsed);
    if (rec === null) {
      return fail(
        "UNVERIFIED_SCHEMA",
        `line ${i + 1} is JSON and is not a refusal-log record`,
        i
      );
    }
    records.push(rec);
  }

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    // A DENSE ASCENDING SEQUENCE IS PART OF THE CHECK. Without it a deletion at
    // the end of a re-linked run could pass; with it, any removal shows up as a
    // position that does not match its own seq.
    if (r.seq !== i) {
      return fail(
        "BROKEN_CHAIN",
        `record at position ${i} carries seq ${String(r.seq)}: the sequence is ` +
          `not dense and ascending, so a record has been removed or reordered`,
        i
      );
    }
    const { hash, ...rest } = r;
    if (computeRefusalRecordHash(rest as UnhashedRefusalRecord) !== hash) {
      return fail(
        "BROKEN_CHAIN",
        `record seq ${String(r.seq)} does not hash to the value it carries - it ` +
          `was edited`,
        i
      );
    }
    const expectedPrev = i === 0 ? "" : records[i - 1].hash;
    if (r.previousHash !== expectedPrev) {
      return fail(
        "BROKEN_CHAIN",
        `record seq ${String(r.seq)} does not link to its predecessor`,
        i
      );
    }
  }

  return {
    loadState: "LOADED_VERIFIED",
    records,
    problem: null,
    verify: () => ({ valid: true, brokenAt: null }),
  };
}

/** sha256 of a file's bytes, for the legacy pointer. Read-only. */
export function hashFileOrEmpty(path: string): {
  hash: string;
  bytes: number;
} {
  try {
    const buf = readFileSync(path);
    return {
      hash: createHash("sha256").update(buf).digest("hex"),
      bytes: buf.length,
    };
  } catch {
    return { hash: "", bytes: 0 };
  }
}

/**
 * DISTRIBUTIVE omit. A plain `Omit<Union, K>` collapses a union to its COMMON
 * keys, which would silently accept a REFUSED body carrying `legacyPath` and
 * reject an honest one carrying `reason`. The conditional distributes over the
 * members so each keeps its own fields.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** One record's fields, minus the two the chain assigns. */
export type RefusalRecordBody = DistributiveOmit<
  UnhashedRefusalRecord,
  "seq" | "previousHash"
>;

/**
 * Seal one record onto the end of a loaded chain. Returns the record; THE
 * CALLER APPENDS IT. This function performs no I/O of any kind, which is what
 * lets it be tested without a filesystem and reused without a side effect.
 */
export function sealRefusalRecord(
  prior: readonly RefusalLogRecord[],
  body: RefusalRecordBody
): RefusalLogRecord {
  const seq = prior.length;
  const previousHash = seq === 0 ? "" : prior[seq - 1].hash;
  const unhashed = { ...body, seq, previousHash } as UnhashedRefusalRecord;
  return {
    ...unhashed,
    hash: computeRefusalRecordHash(unhashed),
  } as RefusalLogRecord;
}

/**
 * The sentence seq 0 carries when an unchained log preceded this one.
 * Exported so the receipt and the tests quote the same string.
 */
export function legacyPointerDetail(
  legacyPath: string,
  legacyHash: string,
  legacyBytes: number
): string {
  if (legacyHash === "") {
    return (
      `no unchained log was found at ${legacyPath} when this chain was opened. ` +
      `Everything in THIS file is chained from seq 0.`
    );
  }
  return (
    `EVERYTHING BEFORE THIS RECORD WAS UNCHAINED. An unchained log of ` +
    `${String(legacyBytes)} bytes was retained in place at ${legacyPath}; its ` +
    `sha256 at the moment this chain opened was ${legacyHash}. That pins what ` +
    `the old lines WERE at this instant so a later edit of them is detectable. ` +
    `It does NOT make them trustworthy: nothing chained them when they were ` +
    `written, and no record here can say what was removed before this one.`
  );
}
