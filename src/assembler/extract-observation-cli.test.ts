// ── MICA · extract-observation-cli — tests ────────────────────────────────────
//
// One test, added for the S108 chore that fixed it: a missing `--out` parent
// directory used to reach `writeFileSync` unguarded and stack-trace out of the
// process. This asserts on the CAPTURED refusal text and the filesystem after,
// never on "it exited nonzero" alone (S96-B discipline).

import * as assert from "assert";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { main } from "./extract-observation-cli";

let passed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const root = mkdtempSync(join(tmpdir(), "mica-extract-observation-"));

check(
  "S108-3 · --out into a missing directory is a NAMED refusal, not a stack trace",
  () => {
    const storePath = join(root, "store.jsonl");
    writeFileSync(
      storePath,
      JSON.stringify({
        seq: 1,
        arrivalTs: 1000,
        submitterId: "mica-node",
        kind: "NAMED_HEAD_COMMIT",
        witnessed: {
          seq_no: 1,
          head_hash: "abc123",
          ts: 900,
          witness_set_id: "set-1",
          modality: "OFFERED",
          chain_id: "precommit:book-a",
        },
      }) + "\n"
    );
    const outPath = join(root, "does-not-exist", "out.json");

    const lines: string[] = [];
    const realLog = console.log;
    console.log = (...parts: unknown[]) => lines.push(parts.map(String).join(" "));
    let code: number;
    try {
      code = main([
        "--store", storePath,
        "--chain-id", "precommit:book-a",
        "--out", outPath,
        "--commitment-seq", "0",
        "--target", "t",
      ]);
    } finally {
      console.log = realLog;
    }
    const text = lines.join("\n");

    assert.strictEqual(code, 4, "a write refusal is exit 4, the same as this tool's other refusals");
    assert.ok(
      text.includes("── --out REFUSED · nothing was written ──"),
      "the refusal's own named heading must be in the captured output"
    );
    assert.ok(
      text.includes("This tool does not create the parent directory"),
      "the refusal must say WHY, not just that it failed"
    );
    assert.ok(!text.includes("at Object.openSync"), "no Node stack trace frame in the output");
    assert.ok(!text.includes("errno:"), "no raw ErrnoException dump in the output");
    assert.strictEqual(
      existsSync(outPath),
      false,
      "nothing was written — the directory this tool does not create must stay absent"
    );
    assert.strictEqual(
      existsSync(join(root, "does-not-exist")),
      false,
      "the parent directory itself must not have been created either"
    );
  }
);

rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} tests: ${passed} passed, 0 failed`);
