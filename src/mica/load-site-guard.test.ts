// -- MICA · the load-site guard — existsSync may not answer for a book -------
//
// House dialect: standalone ts-node script, own check() harness, own counters.
//   npx ts-node src/mica/load-site-guard.test.ts
//
// -- THE CLASS THIS EXISTS TO KEEP CLOSED ------------------------------------
//
//   `existsSync` answers a two-valued question over a three-valued world. It
//   returns FALSE for "there is no such file" AND for "I was not allowed to
//   look". A book that reads the second as the first declares itself a first
//   boot over content it never read — and, where a `mkdirSync(..., {recursive:
//   true})` follows, sets itself PERSISTING too, because recursive mkdir
//   SUCCEEDS on a directory that exists and cannot be entered.
//
//   Cured one organ at a time: `ruling-log.ts` (S98), `precommit.ts` (S99),
//   then `notice-log`, `chokepoint/ledger`, `doctor/history`, `floor-trail`
//   and `fixture-log` (S103). Seven repairs, each by hand, none of them
//   preventing an eighth book from being written the same way tomorrow.
//
// -- THE RULE, PRINTED RATHER THAN IMPLIED -----------------------------------
//
//   FLAG an `existsSync` call whose enclosing function ALSO ASSIGNS
//   `this.loadState`.
//
//   That is the defect exactly: existsSync standing in for a load-state verdict
//   about a book. It is not "existsSync is forbidden" — this repository has
//   honest existence checks (a configured roster, a keypair, a socket, a CLI
//   path argument) and the guard is silent on every one, because none of them
//   is deciding what state a book loaded in.
//
//   WHAT THE RULE DOES NOT CATCH, stated rather than discovered later:
//     - a load site that sets its state through a helper or a returned value
//       instead of assigning `this.loadState` in the same function body;
//     - a free function that computes a load state without `this`;
//     - anything outside `src/**/*.ts`.
//   The rule reads a SHAPE, not an intent, and the shape is the one all seven
//   repairs had. A book written in a different shape is outside it.
//
// -- IT READS WITH node, NOT WITH grep, AND THAT IS LOAD-BEARING (S103) -------
//
//   `src/mica/export/ledger.ts` carries a LITERAL NUL BYTE at offset 5797 — a
//   deliberate one, the field separator in its hash canonicalisation, written
//   as a raw byte rather than as an escape sequence. `file(1)` therefore
//   reports that source as `data`, and **grep skips it silently as binary**.
//
//   That is not a hypothetical. The S103 census that declared this class closed
//   was grep-shaped, could not see that file, and was WRONG: the file held an
//   unrepaired instance of the very defect being censused. A guard built the
//   same way would have inherited the same blindness and passed clean over it.
//   `readFileSync` sees the file perfectly well. So this guard walks and reads
//   with node, and the lesson generalises past this one file: a census whose
//   instrument can skip an input without saying so is not a census.

import assert from "assert";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(error as Error).stack ?? String(error)}`);
    failed++;
  }
}

const SRC_ROOT = join(__dirname, "..");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Blank out comments and string bodies so the scan reads code, not prose. */
export function stripped(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (let j = i; j < stop; j++) out += source[j] === "\n" ? "\n" : " ";
      i = stop;
    } else if (source[i] === '"' || source[i] === "'" || source[i] === "`") {
      const quote = source[i];
      out += quote;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < source.length) {
        out += quote;
        i++;
      }
    } else {
      out += source[i];
      i++;
    }
  }
  return out;
}

/** The body of the innermost `{ ... }` block enclosing `at`. */
export function enclosingBlock(code: string, at: number): string {
  let start = -1;
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    if (code[i] === "}") depth++;
    else if (code[i] === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start === -1) return "";
  let end = code.length;
  depth = 0;
  for (let i = start; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  return code.slice(start, end);
}

/**
 * THE ONE PRINTED EXCEPTION, with its reason. Not a list — a single site, named
 * with the argument for it, so that adding a second costs writing a second
 * argument. A growing exception list is the thing this guard exists to avoid,
 * and the cheapest way to grow one is to make the first entry look like a slot.
 *
 * `witness.ts` reads `existsSync(storePath)` and, when false, CREATES the store
 * file and loads EMPTY. It is not the defect, for two reasons that hold only
 * here:
 *
 *   1. THE DIRECTORY IS ALREADY STAT-GUARDED, one line above the call:
 *      `requireWitnessStoreDir(dirname(storePath))` throws on a directory this
 *      process cannot enter. The traversal failure that makes `existsSync`
 *      ambiguous everywhere else has been ruled out before the call is reached.
 *      With the directory traversable, `existsSync` on the file is honest:
 *      stat needs only the parent's execute bit, so a present-but-unreadable
 *      file returns TRUE and falls to the readFileSync catch.
 *   2. THE FALSE BRANCH THROWS RATHER THAN CLAIMS. It calls
 *      `closeSync(openSync(path, "a"))` with no catch, so a refusal there
 *      leaves the constructor loudly instead of setting a state. There is no
 *      path from a refused look to a quiet EMPTY.
 *
 * If either of those changes — the directory check moves or goes, or the create
 * is wrapped in a catch that sets a state — this exception is void and the site
 * must take the three-valued look. The assertion below fails if the guard stops
 * flagging it, so the exception cannot outlive the thing it excepts.
 */
const PRINTED_EXCEPTION = "witness/witness.ts";

interface LoadSite {
  readonly file: string;
  readonly line: number;
}

/** The whole rule, in one function, so the controls test what ships. */
export function loadSitesUsingExistsSync(files: readonly string[]): LoadSite[] {
  const hits: LoadSite[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("existsSync")) continue;
    const code = stripped(source);
    const re = /\bexistsSync\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      if (!/this\.loadState\s*=/.test(enclosingBlock(code, m.index))) continue;
      hits.push({
        file: relative(SRC_ROOT, file).split(/[\\/]/).join("/"),
        line: code.slice(0, m.index).split("\n").length,
      });
    }
  }
  return hits;
}

const FILES = tsFiles(SRC_ROOT);

// -- LSG-A · the guard cannot be reading nothing -----------------------------

console.log("\n-- load-site guard · existsSync where a book's state is decided --");

check("LSG-A1 · the walk found source, and found the file grep cannot read", () => {
  assert.ok(FILES.length > 0, "walked src/**/*.ts and found nothing — the walk broke");
  const nulFile = FILES.find((f) => f.endsWith(join("mica", "export", "ledger.ts")));
  assert.ok(nulFile !== undefined, "src/mica/export/ledger.ts is not in the walk");
  assert.ok(
    readFileSync(nulFile).includes(0),
    "src/mica/export/ledger.ts no longer carries the NUL byte. If it was removed " +
      "deliberately, good — but this assertion is the reason this guard reads " +
      "with node rather than grep, so replace it with another proof or retire " +
      "the claim in the header. Do not let it pass by finding nothing."
  );
  console.log(`      ${FILES.length} source files walked; the NUL-bearing file is among them`);
});

check("LSG-A2 · honest existence checks are NOT flagged", () => {
  // The rule earns its keep by staying silent on these. If the scanned set ever
  // goes empty the rule has stopped discriminating and is passing for free.
  const isHonest = (f: string): boolean =>
    /clerk[\\/](credentials|keys|clerkd|reader|read-store)\.ts$/.test(f);
  const scanned = FILES.filter(isHonest);
  assert.ok(scanned.length >= 4, `expected the clerk's honest checks; found ${scanned.length}`);
  assert.deepStrictEqual(
    loadSitesUsingExistsSync(scanned),
    [],
    "the guard fired on an existence check that decides no book's load state"
  );
});

// -- LSG-B · the forward-looking controls, run every time ---------------------

check("LSG-B1 · CONTROL: an eighth book written the old way IS named", () => {
  // A new book's load path, in the shape all seven repairs had — built as text,
  // scanned by the shipped rule, never written to disk.
  const eighth = [
    'import { existsSync } from "fs";',
    "export class EighthBook {",
    '  private loadState = "CANNOT_VERIFY";',
    "  private loadFromDisk(): void {",
    "    const path = this.path as string;",
    "    if (!existsSync(path)) {",
    '      this.loadState = "FIRST_BOOT_OR_ERASED";',
    "      return;",
    "    }",
    "  }",
    "}",
  ].join("\n");
  const code = stripped(eighth);
  const at = code.indexOf("existsSync(", code.indexOf("class"));
  assert.ok(at > 0, "the control fixture lost its existsSync call");
  assert.ok(
    /this\.loadState\s*=/.test(enclosingBlock(code, at)),
    "the rule did not fire on an eighth book written the old way"
  );
});

check("LSG-B2 · CONTROL: the same call outside a load site is NOT named", () => {
  const honest = [
    'import { existsSync } from "fs";',
    "export function loadRoster(config: string): string[] {",
    "  if (!existsSync(config)) {",
    '    throw new Error("configured roster is missing");',
    "  }",
    "  return [];",
    "}",
  ].join("\n");
  const code = stripped(honest);
  const at = code.indexOf("existsSync(", code.indexOf("function"));
  assert.ok(at > 0);
  assert.ok(
    !/this\.loadState\s*=/.test(enclosingBlock(code, at)),
    "the rule fired on an existence check that decides no book's load state"
  );
});

check("LSG-B3 · CONTROL: the comment/string stripper does not blind the rule", () => {
  // A guard that scanned raw text would fire on the seven repairs, every one of
  // which discusses `existsSync` at length in its own header prose.
  const prose = [
    "// this book used to call existsSync(path) and set this.loadState wrongly",
    "/* existsSync(path) again, in a block comment, beside this.loadState = x */",
    'const s = "existsSync(path) in a string, next to this.loadState =";',
  ].join("\n");
  const code = stripped(prose);
  assert.ok(
    !/\bexistsSync\s*\(/.test(code),
    "prose survived the stripper and would be scanned as code"
  );
});

// -- LSG-C · THE GUARD ITSELF ------------------------------------------------

console.log("\n-- the guard · every load site in src/ -----------------------");

check("LSG-C0 · the printed exception is still real, and still the only one", () => {
  // An exception nobody re-checks becomes a hole. This fails if the excepted
  // site stops being flagged — because then the exception is stale prose about
  // code that no longer does the thing, which is the defect class next door.
  const flagged = loadSitesUsingExistsSync(FILES).map((h) => h.file);
  assert.ok(
    flagged.includes(PRINTED_EXCEPTION),
    `${PRINTED_EXCEPTION} is no longer flagged. If it was repaired, DELETE the ` +
      "exception and its reasoning above rather than leaving them standing."
  );
});

check("LSG-C · no book decides its load state with existsSync", () => {
  const hits = loadSitesUsingExistsSync(FILES).filter(
    (h) => h.file !== PRINTED_EXCEPTION
  );
  assert.deepStrictEqual(
    hits.map((h) => `${h.file}:${h.line}`),
    [],
    "existsSync is deciding a book's load state. It returns false both for " +
      "'no such file' and for 'not allowed to look', so this book reports an " +
      "absent/first-boot state over content it may simply not be able to read — " +
      "and a following mkdirSync(recursive) will NOT catch it, because recursive " +
      "mkdir succeeds on a directory that exists and cannot be entered. Use the " +
      "three-valued look: ENOENT is the only errno that means absent. Templates: " +
      "src/arbiter/ruling-log.ts and src/precommit/precommit.ts."
  );
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
