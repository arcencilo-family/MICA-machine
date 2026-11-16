# tools/dry-well-gauge

A re-runnable, disk-reading **gauge on a well**. It folds the house's own
catch-record (the Corrections Ledger) forward and reads one number: **have catches
been arriving, and from how far away?**

> **It measures whether catches have been arriving, and from how far away. It never
> certifies health.**

**This gauge reads the Corrections Ledger only.** It does not read the witness, the
notice log, or any MICA record. **HIGH raises nothing; DRY is the only finding.**

## The direction, stated so nobody re-derives it wrong

- **WET / high** — decorrelated catches have arrived recently. **Raises nothing,
  ever.** Not a health reading, not an alertness reading. There is no top alarm.
- **DRY / low** — the book went quiet. **This is the only finding the gauge has**,
  and it is an admission of blindness rather than a diagnosis:

  > *The book has gone quiet, and I cannot tell whether that is because nothing is
  > wrong or because nobody is looking.*

**And the weights are not the meter.** `EXTERNAL: 1.0` does not mean "very
vigilant"; it means *this single piece of evidence counts fully*, because a stranger
catching your error is real news and you catching your own is you talking about
yourself. **Weights price evidence; the gauge tracks arrival.**

Everything else it prints is a **census** — counts, printed, judged not.

## Run

```
npx ts-node tools/dry-well-gauge/read-gauge.ts [ledger.md]
```

- `[ledger.md]` — path to the Corrections Ledger. Defaults to a ledger in the
  project's own notes folder beside the repository, which is not part of this tree; pass a path.
- **No `--now`, no clock argument.** The fold is timeless by construction. Output is
  stdout only; nothing is written to the Ledger or any book.

## Tests

```
npx ts-node tools/dry-well-gauge/gauge.test.ts
```

This tool lives **outside `src/`** and is **not** part of `npm run test:mica` — it is
run directly, the same placement class as `tools/dashboard` and `tools/notify`.

## The design in six points

1. **Stores nothing.** The reading is a pure function over *(the append-only
   catch-book, a position in its event stream)*. The level falls because
   event-position is an argument, not because anything erodes on disk.

2. **Evaporates over event-index, not wall-clock.** The Ledger carries no per-entry
   timestamp — only a session token and one file mtime. An earlier build halted on
   exactly that. Evaporation is **one index-step per event**: no `Δt`, no `--now`.

3. **Inflow is gated; evaporation is free.** Inflow needs an adjudicated,
   decorrelated catch (its weight); evaporation happens every event regardless. A
   run of uncredited events therefore lowers the level even as the book grows —
   exactly the "checks went quiet" condition the gauge exists to surface.

4. **`SELF` is weighted zero, and weighted — not excluded.** A self-catch is the
   node that made the claim reporting it caught itself: value with no independent
   trail, and under canon's **one-sided weighting rule** not creditable. Zero, not
   negative — a self-catch is *uncredited value*, not *damage*, and evaporation
   already penalises the absence of catches. **Zero weight, never exclusion:** an
   excluded row would not advance the fold at all, so a system that only ever
   self-corrected would produce a *frozen* reading with no finding — silence
   rendered as safety. Weighted zero, the row still evaporates, and the level falls.

5. **Two blindnesses, both honest.** *Young book* (too few events →
   `CANNOT_ASSESS` / `INSUFFICIENT_HISTORY`) and *dry book* both state an ambiguity
   they cannot resolve. The young case says **YOUNG and QUIET are byte-identical
   from this book** — with no timestamps, an old collapsed book also has few events
   — and raises no finding; the dry case is the one finding. Both recommend the same
   probe: plant a fixture defect through the normal catch path and see whether it is
   caught.

6. **One finding, at the bottom.** `WET` prints counts and judges nothing. **`WET`
   asserts only that there is water** — no quantity, no health claim. There is
   deliberately no `FULL` band and no fullness measure: the non-dry band spans nearly
   the whole range, and a judgment word there would convert *no finding* into *all
   good*, false in the reassuring direction.

## The fence — what this gauge never does

Never enters `f()` / the floor / any gate verdict / any disposition. Never feeds back
into MICA's behaviour — a diary the observer keeps about the loop, never a control
input. One shared gauge on the whole loop, never a per-node score.

**Named residual, not closed:** the gauge is only as good as the adjudicator. A
rubber-stamping arbiter fills the well, and the gauge cannot certify the
adjudicator's fitness (the H-row fence). Accountability rests on a human node.

## Calibration

Every knob is a **Willkür proxy**, printed on every reading so none is mistaken for a
finding — *except* `SELF: 0`, which is **ruled, not tuned**, and traces to the
one-sided weighting rule. The pure core consults no default: hand it a broken
calibration and it reports `MISSING_CONFIGURATION` rather than assuming one.

## Name history — recorded, not erased

This instrument shipped as the **Vigilance-Flywheel**, with bands `IDLE`/`MIDDLE`, an
upper bound called `redline`, and a top-end alarm. The arbiter renamed it at S80, and the
reason is worth keeping: every old name proposed a function it does not have.

- **"Vigilance"** names a *state of alertness*. The gauge measures no such thing — it
  measures **whether catching recently occurred**. The name invited the question of
  whether a high reading should mean *more watching*, which is the cut bell
  re-derived from vocabulary.
- **"Flywheel" / "tachometer"** put the drama at the **top**. After the top-end cut
  the top is silent and the **bottom** carries the only finding: the metaphor was
  inverted at exactly the point where the finding lives.
- **`IDLE`** was the worst of the three. In a tachometer, idle means *at rest,
  nothing wrong*. Here it meant **the checks stopped, and this is the only alarm we
  have.** The label said benign at the alarm.
- **`redline`** named a constant with no bell attached once the top-end alarm was
  cut. **`asymptote`** says what it is: the unreachable inflow target, the numeric
  form of *Never 100%*.

**The well metaphor maps completely and its polarity cannot invert:** evaporation is
free, rain fills it, rain from far away counts more, nobody alarms at a full well,
and a dry well is the only alarm.

The build record is not part of this tree.
