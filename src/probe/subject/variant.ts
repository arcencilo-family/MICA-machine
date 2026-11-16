// ── MICA · the pilot's CONTROL/STRESS variant, declared once, importing nothing ──
//
// WHY THIS FILE EXISTS (S121).
//
//   `VARIANTS` was declared in `subject/ollama-runner.ts`, and three modules
//   need it: the runner that writes the captures, `declared-subject-port.ts`
//   that answers for one slice, and `evidence-log.ts` that records which slice
//   a reply came from. That made the format core import a pilot runner — a
//   dependency pointing the wrong way, named as wrong in S120's own header and
//   in `evidence-log.test.ts`'s EV-FIX-H4, and carried as `[owed -> arbiter]`
//   until the arbiter took the leaf.
//
//   So the union moves HERE and this file imports NOTHING. A leaf cannot point
//   the wrong way: every arrow now runs INTO it. `ollama-runner.ts` re-exports
//   the two names, so no caller of the runner changed.
//
//   ONE DECLARATION, NOT TWO. A second copy of this union anywhere would drift
//   from the runner that actually sends the prompts, and a record saying
//   `variant: "CONTROL"` would then mean whatever the copy nearest the writer
//   happened to say. That is the defect the import was avoiding; moving the
//   declaration keeps the avoidance and drops the bad arrow.

/** The pilot's two forks. CONTROL is the unstressed comparison, not a control group. */
export const VARIANTS = ["STRESS", "CONTROL"] as const;
export type Variant = (typeof VARIANTS)[number];
