// ── MICA · THE LOG SHAPE MICA DECLARES IT CAN READ ────────────────────────────
//
// This file is MICA's. It is NOT a copy of ILAS's `LogEntry` or of ILAS's
// `LockedEvidenceLog`, and it is deliberately not shaped like either of them.
// It is the answer to one question and only that question:
//
//     WHAT DOES A LOG HAVE TO OFFER BEFORE A MICA SENSOR CAN READ IT?
//
// ── HOW THE WIDTH WAS CHOSEN ──────────────────────────────────────────────────
//
// By census of the read sites, not by inheritance. Every field and every method
// below is cited to the line that reads it. Nothing is here because a
// neighbouring project happened to have it.
//
// THAT DISCIPLINE IS THE WHOLE POINT. A field in this interface is a
// REQUIREMENT IMPOSED ON EVERY FUTURE ADAPTER — on every log anyone ever wants
// to point a MICA sensor at. Carrying a field we do not read would tax every
// one of them for nothing, and would do it invisibly, because a requirement
// nobody reads is a requirement nobody notices they are meeting.
//
//   FIELD             READ AT
//   sequenceNumber    sig/index.ts F1 finding detail; F2 ordering test and
//                     finding detail; eng/index.ts window diagnostic bounds
//   timestamp         sig/index.ts F1 — the adjacent-pair delta, and the detail
//   moduleId          eng/index.ts classKey (half of the event class);
//                     sig/index.ts finding identification
//   eventType         eng/index.ts classKey (the other half); sig/index.ts F2
//                     scope selection and precondition matching
//   outcome           eng/index.ts the dependent value O; sig/index.ts quoted
//                     verbatim in an F2 finding
//   actionId          types.ts actionIdCoverage (the coverage census; the
//                     trail-aware direction reader joins on it in a later
//                     dispatch)
//
//   METHOD            READ AT
//   verify()          types.ts assessLogReadability — the readability gate
//   getLoadState()    types.ts assessLogReadability — the readability gate
//   getAll()          eng/index.ts assessEng; sig/index.ts assessSig
//
// ── WHAT IS DELIBERATELY ABSENT, AND WHY EACH ONE IS ──────────────────────────
//
//   hash, previousHash   ZERO read sites. ILAS carries them; MICA never looks
//                        at them. A log's integrity discipline is that log's
//                        business — MICA asks it `verify()` and believes the
//                        answer, which is a strictly weaker requirement than
//                        demanding a hash chain in the record shape.
//   provenanceTag        ZERO read sites. It is an ILAS lane vocabulary. An
//                        adapter for some other log would have to invent a
//                        value for it, and inventing a value to satisfy a field
//                        nobody reads is how a shape becomes a fiction.
//   parameters           ZERO read sites, and forbidden besides — see below.
//
// ── THE `parameters` TRAP ─────────────────────────────────────────────────────
//
// Standing constraint 4 says MICA stays out of the untyped bag. That rule used
// to be expressed as `keyof Omit<LogEntry, "parameters">`.
//
// THAT EXPRESSION ONLY WORKS WHILE THE KEY EXISTS. `Omit` needs `parameters` to
// be present in order to remove it. On a record type that never declared it,
// `Omit<Rec, "parameters">` is just `Rec` — the guard excludes nothing, names
// nothing, protects nothing, AND STILL COMPILES. It would have gone on looking
// exactly like a live guard forever.
//
// So the exclusion is not expressed by subtraction any more. It is expressed
// three ways that each fail loudly:
//
//   1. MICA_READABLE_FIELDS lists the readable names POSITIVELY, and a
//      compile-time exactness check ties it to `keyof MicaLogRecord` in BOTH
//      directions. Add a field to the record without listing it — or list one
//      that is not on the record — and this file stops compiling.
//   2. MICA_UNREADABLE_FIELDS names the four excluded fields, and a
//      compile-time assertion requires their intersection with the record's
//      keys to be `never`. Put `parameters` back on the record and this file
//      stops compiling.
//   3. log.test.ts pins all of it at runtime, INCLUDING that the two
//      compile-time assertions are still physically present in this file, so
//      that deleting a guard is a test failure rather than a quiet relaxation.
//
// ── WHAT DECLARING THIS SHAPE DOES NOT BUY ────────────────────────────────────
//
// Nothing about independence. MICA still reads a record the observed party
// writes, and every field above is determinable by the observed system —
// unchanged by this file's existence. Declaring your own interface does not
// make an instrument more independent of what it reads. What it buys is that
// MICA can be built and run without ILAS present, and that the requirement MICA
// imposes is stated at its true width instead of inherited whole.

/**
 * One record in a log MICA can read.
 *
 * FIVE REQUIRED FIELDS, every one cited above to a read site, are the demand
 * MICA makes of every readable record — a log lacking any one cannot be read
 * by these sensors at all. `actionId` is conditional: a log lacking it remains
 * readable, but is not creditable to the later trail-aware direction reader.
 * A log carrying more is fine and MICA will not look at the rest.
 *
 * `readonly` throughout because MICA is a reader. It never writes a record and
 * the type says so. (TypeScript does not check `readonly` in assignability, so
 * this constrains MICA rather than constraining an adapter.)
 */
export interface MicaLogRecord {
  readonly sequenceNumber: number;
  readonly timestamp: number;
  readonly moduleId: string;
  readonly eventType: string;
  readonly outcome: string;
  /**
   * The routed action's opaque id, when the writing side threads it — the
   * SHARED-KEY join to the floor trail (FORK ruling 2026-08-23). OPTIONAL:
   * a log without it is readable by every sensor and earns no creditable
   * value evidence from the trail-aware direction reader.
   * CALLER-SUPPLIED. Presence is not provenance: this field is authored by
   * the observed side, like every field on this record, and authenticates
   * nothing. (Fork page, narrowed claim, line 2.)
   */
  readonly actionId?: string;
}

/**
 * What `verify()` answers.
 *
 * `brokenAt` is OPTIONAL and MICA prints it without interpreting it: a log that
 * knows something is wrong but cannot say where is still allowed to say so.
 */
export interface MicaLogVerifyResult {
  readonly valid: boolean;
  readonly brokenAt?: number;
}

/**
 * A log MICA can read. THREE METHODS, not eleven.
 *
 * ON `getLoadState(): string` — the return type is deliberately `string` and
 * not a union. A union would force every adapter to speak ILAS's exact
 * load-state vocabulary. MICA's actual requirement is far smaller: it treats as
 * readable exactly the load states a deployer INJECTS (readableLoadStates; see
 * assessLogReadability in types.ts) and everything else as blind. There is no
 * built-in constant — the 2026-08-12 ruling replaced the old
 * READABLE_LOAD_STATES = ["LOADED_VERIFIED"] with an injected list and no
 * default (RECOMMENDED_READABLE_LOAD_STATES is a recommendation nothing here
 * reads).
 *
 * That fails CLOSED, which is the right direction: an adapter that returns a
 * state outside the injected list gets CANNOT_ASSESS, never a false SILENT. A
 * typo in an adapter blinds the instrument; it cannot make the instrument
 * cheerful.
 */
export interface MicaReadableLog {
  verify(): MicaLogVerifyResult;
  getLoadState(): string;
  getAll(): readonly MicaLogRecord[];
}

/** The typed fields a MICA sensor is permitted to touch. Stated positively. */
export const MICA_READABLE_FIELDS = [
  "sequenceNumber",
  "timestamp",
  "moduleId",
  "eventType",
  "outcome",
  "actionId",
] as const;

/** The methods MICA calls. Three, and no more. */
export const MICA_READABLE_METHODS = [
  "verify",
  "getLoadState",
  "getAll",
] as const;

/**
 * Names that must NEVER appear on MicaLogRecord.
 *
 * `parameters` is the constraint-4 exclusion. The other three are the fields
 * ILAS carries that MICA reads at zero sites: listing them here means a future
 * hand cannot quietly re-inherit them "for symmetry" without tripping a guard.
 */
export const MICA_UNREADABLE_FIELDS = [
  "parameters",
  "hash",
  "previousHash",
  "provenanceTag",
] as const;

/** The typed chained fields a sensor is permitted to touch. */
export type ReadableField = (typeof MICA_READABLE_FIELDS)[number];

// ── COMPILE-TIME GUARD 1 · the field list is exactly the record's keys ────────
// Both directions. A field added to MicaLogRecord and not to MICA_READABLE_FIELDS
// fails here; so does a name in the list that is not on the record.
type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _readableFieldsAreExactlyTheRecordKeys: Exactly<
  ReadableField,
  keyof MicaLogRecord
> = true;
void _readableFieldsAreExactlyTheRecordKeys;

// ── COMPILE-TIME GUARD 2 · none of the excluded names is on the record ────────
// This is the replacement for `Omit<LogEntry, "parameters">`, and unlike Omit it
// FAILS when the key comes back rather than falling silent when it goes away.
type MustBeNever<T extends never> = T;
type _NoUnreadableFieldOnTheRecord = MustBeNever<
  Extract<keyof MicaLogRecord, (typeof MICA_UNREADABLE_FIELDS)[number]>
>;
