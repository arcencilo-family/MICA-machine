#!/usr/bin/env node
// ── MICA · extract-observation-cli — one ObservationInput off the witness store ──
//
// ONE SENTENCE THIS TOOL IS ALLOWED TO SAY:
//
//   The witness store at the named path was read as bytes, the newest record
//   naming the given chain was found (or none was, and that is reported), and
//   its head hash was packaged into one ObservationInput, verbatim.
//
// READER DISCIPLINE (see src/report/witness-report.ts header): this tool
// constructs no `Witness`. Instantiating one APPENDS a PLACEMENT record, so a
// reader that built one to read with would write to the book it came to read.
// It reads the store as bytes, via `readStoreText` — the same function the
// daily report reads it with — and nothing else.
//
// "NEWEST" IS LAST IN THE FILE, NEVER max(arrivalTs) (S106b): the store is
// append-only and its order is the order of arrival; taking a max over a
// clock would let one bad stamp on one frame win. This mirrors
// `witness-report.ts`'s `chainsLastSeen` fold rather than inventing a second
// reading of the same rule.
//
// It creates nothing but --out. NO verdicts, no thresholds, no health words.
//
// EXIT CODES
//   0  the newest record for the chain was found and the observation written
//   4  refused: bad arguments, the store could not be read, or no record for
//      the named chain exists in the store. Never an empty or placeholder
//      observation (ledger S100-1 class).

import { readFileSync, writeFileSync } from "fs";
import { readStoreText } from "../report/witness-report";
import type { ObservationInput } from "./assembler";

/** Kinds whose `witnessed` payload carries a `chain_id` (S105). Mirrors the
 * split `witness-report.ts` already makes; not re-derived from `WITNESSED_KINDS`
 * because that split is a judgement this file borrows rather than repeats. */
const NAMED_HEAD_KINDS: readonly string[] = [
  "NAMED_HEAD_COMMIT",
  "NAMED_UNDECLARED_SUBMITTER",
];

function whoAmI(): string {
  // The principal this process ACTUALLY ran as, not the one a document says it
  // should be. If the platform cannot tell us, we say that rather than guess.
  const g = process.getuid;
  if (typeof g !== "function") return "unknown-principal (no getuid on this platform)";
  return `uid ${String(g.call(process))}`;
}

function field(witnessed: unknown, key: string): unknown {
  if (typeof witnessed !== "object" || witnessed === null) return undefined;
  return (witnessed as Record<string, unknown>)[key];
}

interface NewestHead {
  readonly seq: number;
  readonly headHash: string;
}

/** Walk the store once, in file order, keeping the LAST match for `chainId`. */
export function findNewestHeadForChain(
  raw: string,
  chainId: string
): { readonly newest: NewestHead | undefined; readonly recordsRead: number; readonly unreadableLines: number } {
  const read = readStoreText(raw);
  let newest: NewestHead | undefined;
  for (const line of read.lines) {
    if (line.state !== "FRAME") continue;
    const frame = line.frame;
    if (!NAMED_HEAD_KINDS.includes(frame.kind)) continue;
    const seenChainId = field(frame.witnessed, "chain_id");
    if (seenChainId !== chainId) continue;
    const headHash = field(frame.witnessed, "head_hash");
    if (typeof headHash !== "string") continue;
    newest = { seq: frame.seq, headHash };
  }
  return { newest, recordsRead: read.frames.length, unreadableLines: read.unreadable.length };
}

export function main(argv: readonly string[]): number {
  let storePath: string | undefined;
  let chainId: string | undefined;
  let outPath: string | undefined;
  let commitmentSeqRaw: string | undefined;
  let target: string | undefined;
  const takesValue: Record<string, (v: string) => void> = {
    "--store": (v) => { storePath = v; },
    "--chain-id": (v) => { chainId = v; },
    "--out": (v) => { outPath = v; },
    "--commitment-seq": (v) => { commitmentSeqRaw = v; },
    "--target": (v) => { target = v; },
  };
  for (let i = 0; i < argv.length; i++) {
    const take = takesValue[argv[i]];
    if (take === undefined) {
      console.log(`unrecognised argument: ${argv[i]}`);
      return 4;
    }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      console.log(`${argv[i]} needs a value`);
      return 4;
    }
    take(v);
    i++;
  }

  if (storePath === undefined || chainId === undefined || outPath === undefined) {
    console.log(
      "usage: extract-observation-cli --store <path> --chain-id <id> --out <path> " +
        "--commitment-seq <n> --target <text>"
    );
    return 4;
  }
  // `commitmentSeq` and `target` are NOT in the witness store — they name WHICH
  // commitment this observation joins to and what it was sealed against, which
  // is the caller's knowledge, not this reader's. `ObservationInput` (read at
  // bytes, src/assembler/assembler.ts) requires both; this tool does not guess
  // them and does not default them.
  if (commitmentSeqRaw === undefined || target === undefined || target.length === 0) {
    console.log("── REFUSED · commitmentSeq and target are required ─────────");
    console.log("");
    console.log("  This tool observes a chain's head; it does not know which COMMITMENT");
    console.log("  the observation is FOR or what was sealed as its target — both are");
    console.log("  the caller's to supply:");
    console.log("    --commitment-seq <n>   the sequence number of the COMMITMENT in the book");
    console.log("    --target <text>        must equal the REVEAL's own plaintext.target,");
    console.log("                           verbatim, or the assembler refuses the join");
    console.log("");
    console.log("  Nothing was searched, nothing was written.");
    return 4;
  }
  const commitmentSeq = Number(commitmentSeqRaw);
  if (!Number.isInteger(commitmentSeq) || commitmentSeq < 0) {
    console.log(
      `--commitment-seq must be a non-negative integer, got ${JSON.stringify(commitmentSeqRaw)}`
    );
    return 4;
  }

  console.log(`extract-observation — running as ${whoAmI()}`);
  console.log(`store:    ${storePath}`);
  console.log(`chain-id: ${chainId}`);
  console.log("");

  let raw: string;
  try {
    raw = readFileSync(storePath, "utf8");
  } catch (err) {
    console.log("── STORE READ REFUSED ───────────────────────────────────────");
    console.log("");
    console.log(`  could not read ${storePath}: ${String(err)}`);
    console.log("");
    console.log("  Nothing was searched, nothing was written.");
    return 4;
  }

  const { newest, recordsRead, unreadableLines } = findNewestHeadForChain(raw, chainId);

  console.log(`records read:     ${recordsRead}`);
  console.log(`unreadable lines: ${unreadableLines}`);
  console.log("");

  if (newest === undefined) {
    console.log("── REFUSED · no record for this chain ───────────────────────");
    console.log("");
    console.log(
      `  searched ${recordsRead} record(s) in ${storePath} for a NAMED_HEAD_COMMIT`
    );
    console.log(
      `  or NAMED_UNDECLARED_SUBMITTER carrying chain_id ${JSON.stringify(chainId)}.`
    );
    console.log("  None was found.");
    console.log("");
    console.log(
      "  Nothing was emitted. An empty or placeholder observation would be worse"
    );
    console.log("  than this refusal (ledger S100-1 class).");
    return 4;
  }

  const observedAt = Date.now();
  const ranAs = whoAmI();
  const observation: ObservationInput = {
    commitmentSeq,
    target,
    // Verbatim. Never trimmed, parsed, or normalised — F4 compares exact strings.
    observedValue: newest.headHash,
    observedBy: ranAs,
    observedAt,
    provenance:
      `${storePath}, NAMED head record at seq ${newest.seq}, chain_id ` +
      `${JSON.stringify(chainId)}, read verbatim by extract-observation-cli ` +
      `running as ${ranAs} at ${new Date(observedAt).toISOString()}.`,
  };
  const json = JSON.stringify([observation], null, 2);

  console.log(`FOUND newest record for chain ${chainId} at seq ${newest.seq}`);
  console.log("");
  console.log(json);
  console.log("");

  try {
    writeFileSync(outPath, json + "\n", { mode: 0o644 });
  } catch (err) {
    // NAMED REFUSAL, NOT A STACK TRACE — same class as the MkdirSync-Class-Fix
    // (S97): this tool does not create the missing directory (a directory
    // another principal must reach is a deployment act, and --out's parent is
    // the caller's to have made ready, not this reader's to conjure); it
    // fails loud instead. The observation above was already found and
    // printed to stdout, so nothing computed is lost — only the file did not
    // land.
    console.log("── --out REFUSED · nothing was written ──────────────────────");
    console.log("");
    console.log(`  could not write ${outPath}: ${String(err)}`);
    console.log("");
    console.log(
      "  This tool does not create the parent directory. The observation above"
    );
    console.log(
      "  was found and printed; only the file write failed. Make the directory"
    );
    console.log("  ready and run again.");
    return 4;
  }
  console.log(
    `WROTE ${outPath} (mode 0644, owned by the principal this process ran as: ${ranAs}).`
  );
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
