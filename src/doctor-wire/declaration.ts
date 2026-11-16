// ── MICA · doctor wire — the deployment's declaration ────────────────────────
//
// WHO MAY SUBMIT A FINDING, AND WHO MAY RECORD A REPLY, ARE DECLARED FACTS.
//
//   The deployer writes one JSON file naming: the notice directory the bridge
//   already writes its notice book into (so a doctor's raising lands in the same
//   book as every other raising), the reply book, the uids that may submit a
//   finding, and the role each replying uid speaks for.
//
//   A uid is what this process can observe about its caller. Until the doctor,
//   the arbiter and the operator each have their own identity (ROADMAP R-01 to
//   R-05, not built), a declared uid is a DECLARATION, never a proof of who typed
//   the command. Every line this wire prints says so where it names one.

import { readFileSync } from "fs";
import { isAbsolute, join, resolve } from "path";

import { RECIPIENT_ROLES } from "../mica/notify";
import type { RecipientRole } from "../mica/notify";
import { hasExactKeys, isObject, isString } from "../mica/store/validate";
import type { Parsed } from "../mica/store/validate";

export interface DoctorWireDeclaration {
  /** The bridge's noticeDir. The notice book is `notices.jsonl` inside it. */
  readonly noticeDir: string;
  /** The reply book. Its own chained file; never the notice book. */
  readonly replyBook: string;
  /** The uids that may submit a doctor finding. */
  readonly findingSubmitterUids: readonly number[];
  /** uid (as a decimal string) -> the role its replies are recorded under. */
  readonly replyRoles: Readonly<Record<string, RecipientRole>>;
}

const DECLARATION_KEYS = ["noticeDir", "replyBook", "findingSubmitterUids", "replyRoles"] as const;

/** The notice book inside a notice directory, named the way the bridge names it. */
export function noticeBookPath(noticeDir: string): string {
  return join(noticeDir, "notices.jsonl");
}

export const REPLY_BOOK_IS_NOTICE_BOOK =
  "NOT DECLARED — replyBook names the notice book itself. They are two books with " +
  "two shapes; one file cannot be both, and a reply written into the notice book " +
  "would fork it.";

function isUid(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** The declaration's closed shape, or the reason it is refused. */
export function parseDeclaration(value: unknown): DoctorWireDeclaration | string {
  if (!isObject(value) || !hasExactKeys(value as Parsed, DECLARATION_KEYS)) {
    return `the declaration is exactly {${DECLARATION_KEYS.join(", ")}}; this one is not`;
  }
  const o = value as Parsed;
  for (const key of ["noticeDir", "replyBook"] as const) {
    const path = o[key];
    if (!isString(path) || !isAbsolute(path)) return `${key} must be an absolute path`;
  }
  const uids = o.findingSubmitterUids;
  if (!Array.isArray(uids) || !uids.every(isUid)) {
    return "findingSubmitterUids must be a list of uids (non-negative integers)";
  }
  const roles = o.replyRoles;
  if (!isObject(roles)) return "replyRoles must map uid strings to roles";
  for (const [uid, role] of Object.entries(roles as Parsed)) {
    if (!/^(0|[1-9][0-9]*)$/.test(uid)) return `replyRoles key ${JSON.stringify(uid)} is not a uid`;
    if (!isString(role) || !(RECIPIENT_ROLES as readonly string[]).includes(role)) {
      return `replyRoles[${uid}] must be one of ${RECIPIENT_ROLES.join(", ")}`;
    }
  }
  if (resolve(o.replyBook as string) === resolve(noticeBookPath(o.noticeDir as string))) {
    return REPLY_BOOK_IS_NOTICE_BOOK;
  }
  return {
    noticeDir: o.noticeDir as string,
    replyBook: o.replyBook as string,
    findingSubmitterUids: [...(uids as number[])],
    replyRoles: { ...(roles as Record<string, RecipientRole>) },
  };
}

/** Read and parse a declaration file, or the reason it could not be used. */
export function loadDeclaration(path: string): DoctorWireDeclaration | string {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return `cannot read the declaration ${path}: ${String(err)}`;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return `the declaration ${path} is not JSON: ${String(err)}`;
  }
  return parseDeclaration(parsed);
}

/**
 * The line every output carries where it names a uid: "submitted by" for a
 * finding's submitter, "recorded by" for a replier.
 */
export function declaredUidLine(uid: number, as: string, by: "submitted" | "recorded"): string {
  return (
    `${by} by uid ${String(uid)}, declared as ${as}; a declared uid is a ` +
    `declaration, not a proof of who typed it (separate identities: ROADMAP R-02, not built)`
  );
}
