// ── MICA · the deployment-path prefixes, named once ──────────────────────────
//
// WHY THIS FILE EXISTS
//
//   Three prefixes name the live box: the state root, the deployed tree, and
//   the config directory. Several places in this repo need to say "a test must
//   not name one of these" or "this module must not name one of these", and
//   before S116 each of them spelled the three out again. A list repeated is a
//   list that drifts, and a fence keyed on a stale copy is a fence that stops
//   catching things while still printing green.
//
//   So they are named HERE, once, and every fence imports them.
//
// ── WHY IT LIVES UNDER src/ AND NOT UNDER tools/ ────────────────────────────
//
//   It was written in `tools/` first, beside the fence that reads it, and
//   `src/mica/closure.test.ts` refused it: nothing under `src/` may import a
//   specifier that resolves outside `src/`, and three test files under `src/`
//   need this list. The guard is right and the module moved. (Its failure
//   message says such an edge "leaves MICA-machine", which is not quite what it
//   enforces — `tools/` is inside the repository — but the rule it actually
//   holds, one closed tree under src/, is the one worth keeping.)
//
// ── THIS FILE IS NOT A TEST, AND THAT IS DELIBERATE ─────────────────────────
//
//   `tools/suite-source-fence.test.ts` forbids these literals in `*.test.ts`
//   files.
//   It cannot forbid them here, because here is where they are defined — so
//   they live in a module the fence does not police, and the test files that
//   need them import them rather than retyping them. That is not a hole in the
//   fence: a test that imports this list is naming the CONCEPT, and a test that
//   types the literal is naming the BOX.

/** The three prefixes that name the live deployment. Nothing else belongs here. */
export const DEPLOYMENT_PATH_PREFIXES: readonly string[] = [
  "/var/lib/mica",
  "/opt/",
  "/etc/mica",
];
